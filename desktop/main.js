// GARA VJ デスクトップアプリ (Electron)
// 内蔵の静的 HTTP サーバ (desktop/server.js) でアプリ一式を配信し、BrowserWindow で開く。
// file:// だと fetch(manifest.json 等) が失敗するため必ず HTTP で配信する。
// プリセット/グラデ等の store.php 同期は app.js 側が本番サーバを参照する(既存動作)。
const { app, BrowserWindow, session, Menu, dialog, desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');
const { createServer } = require('./server');

// ハイブリッド GPU 機で必ず高性能側 GPU を使う (内蔵GPU割当による TDR/クラッシュ対策)
// force_high_performance_gpu は macOS 専用のため、Windows ではレジストリ
// HKCU\Software\Microsoft\DirectX\UserGpuPreferences に GpuPreference=2 (高パフォーマンス) を
// 本 exe に対して登録する (Windows の「グラフィックの設定」と同じ仕組み)。
app.commandLine.appendSwitch('force_high_performance_gpu');
if(process.platform === 'win32'){
  try{
    const { execFileSync } = require('child_process');
    execFileSync('reg.exe', [
      'add', 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences',
      '/v', process.execPath, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f',
    ], { stdio: 'ignore' });
  }catch(_){ /* レジストリに書けなくても起動は継続 */ }
}
// 動画ループ素材をユーザー操作なしで自動再生する
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Projector をフルスクリーンにするとメインウィンドウが「隠れている (occluded)」と判定され、
// Chromium が video-only メディアを省電力で一時停止する (シェーダは動くのに動画だけ
// 止まる/反応しない)。隠れていても通常動作を続けるよう、バックグラウンド抑制と
// メディアの省電力停止を無効化する。
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-media-suspend');
app.commandLine.appendSwitch('disable-features', 'BackgroundVideoPauseOptimization,MediaSuspend');
// 「画面音声」のシステム音声キャプチャ (audio:'loopback') は Windows 以外では既定で無効。
// macOS 13+ は ScreenCaptureKit 経由のループバックがフラグ付きで使える (これが無いと
// 映像だけ取れて音声トラックが空になり、Chrome 等の再生音を拾えない)。
if(process.platform === 'darwin'){
  app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare');
}

const ROOT = path.join(__dirname, '..');   // アプリ一式のルート (開発時もパッケージ後も同じ相対位置)

// デバッグプローブ (AUDIO_PROBE 等) を本番インスタンスと並走させるための userData 切替。
// 二重起動ロックは userData 単位なので、これが無いと本番アプリ起動中はプローブが即終了する。
if(process.env.GARA_USERDATA) app.setPath('userData', process.env.GARA_USERDATA);

let win = null;
let shaderProbeDone = false;

// ── ウィンドウ状態 (位置 / サイズ / フルスクリーン / 最大化) の保存・復元 ──
//   クラッシュ後の再起動でも同じ見た目に戻せるよう、変化のたびにデバウンス保存する。
//   コンテンツ側の状態 (プリセット/パラメータ) は app.js の autosave (vj.state) が担う。
const winStateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWinState(){
  try{ return JSON.parse(fs.readFileSync(winStateFile(), 'utf8')); }catch(_){ return null; }
}
let _winSaveT = null;
function winStateOf(){
  return {
    bounds: win.getNormalBounds ? win.getNormalBounds() : win.getBounds(),
    fullscreen: win.isFullScreen(),
    maximized: win.isMaximized(),
  };
}
function saveWinState(immediate){
  if(!win || win.isDestroyed()) return;
  if(immediate){
    clearTimeout(_winSaveT);
    try{ fs.writeFileSync(winStateFile(), JSON.stringify(winStateOf())); }catch(_){}
    return;
  }
  clearTimeout(_winSaveT);
  _winSaveT = setTimeout(() => {
    try{ if(win && !win.isDestroyed()) fs.writeFileSync(winStateFile(), JSON.stringify(winStateOf())); }catch(_){}
  }, 300);
}

// メインプロセス側の未捕捉例外 → アプリごと再起動 (ウィンドウ/コンテンツ状態は保存済みのものが復元される)
process.on('uncaughtException', (err) => {
  try{ console.error('uncaughtException:', err); }catch(_){}
  // 恒常的な起動時例外で無限再起動ループにならないよう、短時間に繰り返す場合は
  // 再起動せずそのまま落とす (次はユーザーが手動起動 → 原因が見える)。
  let relaunches = 0;
  try{
    const f = path.join(app.getPath('userData'), 'relaunch-guard.json');
    let g = { t: 0, n: 0 };
    try{ g = JSON.parse(fs.readFileSync(f, 'utf8')); }catch(_){}
    const nowMs = Date.now();
    if(nowMs - (g.t || 0) < 60000) relaunches = (g.n || 0) + 1; else relaunches = 1;
    fs.writeFileSync(f, JSON.stringify({ t: nowMs, n: relaunches }));
  }catch(_){ relaunches = 1; }
  if(relaunches <= 3){ try{ app.relaunch(); }catch(_){} }
  app.exit(1);
});

async function createWindow(){
  const server = createServer(ROOT);
  // ポートは固定する。ランダム割当だとオリジンが起動ごとに変わり、localStorage
  // (プリセットキャッシュ / デフォルト / MIDI learn / 前回状態) が毎回空になる。
  // 使用中なら +1 しながら数ポート試し、全滅時のみランダムへフォールバック。
  const FIXED_PORT = 17845;
  let port = 0;
  for(let p = FIXED_PORT; p < FIXED_PORT + 5; p++){
    try{
      await new Promise((res, rej) => {
        server.once('error', rej);
        server.listen(p, '127.0.0.1', () => { server.removeAllListeners('error'); res(); });
      });
      port = p; break;
    }catch(_){ /* 次のポートを試す */ }
  }
  if(!port){
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  }

  // WebMIDI / webcam / マイク等の権限をアプリ内で自動許可 (details 引数の有無どちらの Electron でも動くよう防御的に)
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    const allow = ['media', 'midi', 'midiSysex', 'fullscreen', 'pointerLock', 'clipboard-read', 'clipboard-sanitized-write',
                   'display-capture', 'audioCapture', 'videoCapture', 'window-placement', 'notifications'];
    cb(allow.includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler(() => true);
  // MIDI/HID/シリアル等のデバイスアクセスも自動許可 (一部 Electron 版は device 系を別ハンドラで判定)
  try{ session.defaultSession.setDevicePermissionHandler(() => true); }catch(_){}
  // 「画面音声」ボタン (getDisplayMedia) は Electron ではこのハンドラが無いと必ず失敗する。
  // ピッカーを出さず画面全体をそのまま渡す (音声も要求。BPM 検出/Audio FX 用)。
  // 画面収録権限が無いと getSources が返ってこないことがある → タイムアウトで
  // 空応答にし、レンダラ側が無言で固まらずエラー案内を出せるようにする。
  try{
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      const timeout = new Promise(res => setTimeout(() => res(null), 5000));
      Promise.race([desktopCapturer.getSources({ types: ['screen'] }), timeout]).then(sources => {
        callback(sources && sources.length ? { video: sources[0], audio: 'loopback' } : {});
      }).catch(() => callback({}));
    }, { useSystemPicker: false });
  }catch(_){ /* 古い Electron ではハンドラ未対応 */ }

  // スクリーンショット / 録画などのダウンロードは、保存ダイアログを出さず Downloads へ直接保存する。
  //   app.js は <a download> + Blob URL でダウンロードを発火する → Electron が will-download を発火 →
  //   setSavePath() を呼ぶとダイアログは出ない。同名衝突は連番を付けて回避。
  session.defaultSession.on('will-download', (event, item) => {
    try{
      const dir = app.getPath('downloads');
      const name = item.getFilename() || ('gara-' + Date.now());
      const ext = path.extname(name);
      const base = ext ? name.slice(0, -ext.length) : name;
      let target = path.join(dir, name), n = 1;
      while(fs.existsSync(target)){ target = path.join(dir, base + '-' + (n++) + ext); }
      item.setSavePath(target);   // これでダイアログを抑止して直接保存
      item.once('done', (e, state) => {
        if(state === 'completed' && win && !win.isDestroyed()){
          try{ win.webContents.executeJavaScript(
            "window.toast && toast('保存しました: " + path.basename(target).replace(/'/g, "\\'") + "')", true); }catch(_){}
        }
      });
    }catch(err){ console.warn('will-download handler failed:', err); }
  });

  const saved = loadWinState();
  const b = (saved && saved.bounds && saved.bounds.width > 200 && saved.bounds.height > 150) ? saved.bounds : null;
  win = new BrowserWindow({
    width: b ? b.width : 1440, height: b ? b.height : 900,
    ...(b && typeof b.x === 'number' ? { x: b.x, y: b.y } : {}),
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'GARA VJ',
    webPreferences: {
      backgroundThrottling: false,   // 裏に回っても描画を止めない (VJ 用)
    },
  });
  if(saved && saved.maximized) win.maximize();
  if(saved && saved.fullscreen) win.setFullScreen(true);
  for(const ev of ['resize', 'move', 'enter-full-screen', 'leave-full-screen', 'maximize', 'unmaximize']){
    win.on(ev, () => saveWinState());
  }
  win.on('close', (e) => {
    saveWinState(true);
    // 本番中の Cmd+W / ×ボタン 誤爆でショーが止まらないよう確認する。
    // (Cmd+Q からの終了時は _quitting が立つのでそのまま閉じる)
    if(!app._quitting && !win.__confirmedClose){
      e.preventDefault();
      const r = dialog.showMessageBoxSync(win, {
        type: 'warning', buttons: ['キャンセル', '終了する'], defaultId: 0, cancelId: 0,
        message: 'GARA を終了しますか?', detail: 'VJ 中の誤操作防止のため確認しています。',
      });
      if(r === 1){ win.__confirmedClose = true; win.close(); }
    }
  });

  // ── クラッシュ自動復旧 ──
  //   描画プロセスが落ちたらリロード (コンテンツは autosave = vj.state から復元される)。
  //   60 秒以内に 3 回落ちるようならアプリごと再起動 (GPU プロセス異常などの根本リセット)。
  let crashTimes = [];
  win.webContents.on('render-process-gone', (e, details) => {
    if(details && details.reason === 'clean-exit') return;
    const t = Date.now();
    crashTimes = crashTimes.filter(x => t - x < 60000);
    crashTimes.push(t);
    console.warn('renderer gone:', details && details.reason, '(', crashTimes.length, ')');
    if(crashTimes.length >= 3){ try{ app.relaunch(); }catch(_){} app.exit(0); return; }
    try{ win.webContents.reload(); }catch(_){ try{ app.relaunch(); }catch(__){} app.exit(0); }
  });
  // ハング検知: 応答が無い状態が続いたらレンダラを落として上の復旧経路に乗せる。
  // 重いシェーダの初回コンパイル (ANGLE/FXC) は数十秒ブロックすることがあるため、
  // 正常動作を巻き込まないよう 45 秒と長めに取る。
  let unrespT = null;
  win.webContents.on('unresponsive', () => {
    clearTimeout(unrespT);
    unrespT = setTimeout(() => {
      try{ win.webContents.forcefullyCrashRenderer(); }catch(_){}
    }, 45000);
  });
  win.webContents.on('responsive', () => { clearTimeout(unrespT); unrespT = null; });

  win.loadURL(`http://127.0.0.1:${port}/`);
  if(process.env.SHADER_PROBE){
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      if(/init program failed|shader compile failed|\[boot\]/i.test(message || '')){
        console.log('SHADER_CONSOLE', level, message, sourceId + ':' + line);
      }
    });
    win.webContents.on('did-finish-load', () => {
      const started = Date.now();
      const poll = setInterval(async () => {
        if(shaderProbeDone) return;
        try{
          const result = await win.webContents.executeJavaScript(`(()=>({
            pending:(typeof GL!=='undefined' && GL._initProgPending) ? GL._initProgPending.length : -1,
            failed:(typeof GL!=='undefined' && GL._initFailed) ? GL._initFailed : [],
            composite:(typeof GL!=='undefined') ? !!GL.compositeProg : false,
            fallback:(typeof GL!=='undefined') ? !!GL._compositeFellBack : false,
            boot:(typeof GL!=='undefined' && GL._bootLog) ? GL._bootLog.slice(-12) : []
          }))()`, true);
          if(shaderProbeDone) return;
          if(result.pending === 0 || Date.now() - started > 90000){
            shaderProbeDone = true;
            clearInterval(poll);
            console.log('SHADER_PROBE', JSON.stringify(result));
            app.quit();
          }
        }catch(e){
          if(Date.now() - started > 90000){ clearInterval(poll); console.log('SHADER_PROBE ERR', String(e)); app.quit(); }
        }
      }, 500);
    });
  }
  if(process.env.AUDIO_PROBE){   // デバッグ: AUDIO_PROBE=1 で起動すると画面音声 (getDisplayMedia) の取得結果を stdout に出して終了
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try{
          const r = await win.webContents.executeJavaScript(
            `navigator.mediaDevices.getDisplayMedia({video:true, audio:true}).then(s=>{` +
            ` const a = s.getAudioTracks(), v = s.getVideoTracks();` +
            ` const out = {video: v.length, audio: a.length, audioLabel: a[0] ? a[0].label : null, audioState: a[0] ? a[0].readyState : null};` +
            ` s.getTracks().forEach(t=>t.stop()); return out; })` +
            `.catch(e=>({err: String(e && e.message || e)}))`, true);
          console.log('AUDIO_PROBE', JSON.stringify(r));
        }catch(e){ console.log('AUDIO_PROBE ERR', String(e)); }
        app.exit(0);
      }, 4000);
    });
  }
  if(process.env.MIDI_PROBE){   // デバッグ: MIDI_PROBE=1 で起動すると MIDI 初期化状態を stdout に出す
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try{
          const r = await win.webContents.executeJavaScript(
            `(()=>{ const M = (typeof MIDI !== 'undefined') ? MIDI : null;` +
            ` return {hasAPI: !!navigator.requestMIDIAccess, hasMIDI: !!M, access: !!(M && M.access),` +
            ` inputs: (M && M.access) ? [...M.access.inputs.values()].map(i=>i.name) : null,` +
            ` mapKeys: M ? Object.keys(M.map||{}).length : -1}; })()`, true);
          console.log('MIDI_PROBE', JSON.stringify(r));
        }catch(e){ console.log('MIDI_PROBE ERR', String(e)); }
      }, 6000);
    });
  }
  win.on('closed', () => { win = null; });
}

// GPU プロセスが落ちたらウィンドウをリロードして WebGL を張り直す
app.on('child-process-gone', (e, details) => {
  if(details && details.type === 'GPU' && details.reason !== 'clean-exit'){
    console.warn('GPU process gone:', details.reason);
    try{ if(win && !win.isDestroyed()) win.webContents.reload(); }catch(_){}
  }
});

// 既定メニューには Cmd+R (リロード= 映像が飛ぶ) / Cmd+W (閉じる) が入っている。
// ライブ中の誤爆を避けるため、必要最小限のメニューに差し替える (Cmd+Q とコピペ類は残す)。
function installMenu(){
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: '編集', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { label: '表示', submenu: [
      { role: 'togglefullscreen' },
      { type: 'separator' },
      // リロードは誤爆しにくい Cmd+Shift+R のみに (既定の Cmd+R は割り当てない)
      { label: '再読み込み', accelerator: 'CmdOrCtrl+Shift+R', click: (m, w) => { if(w) w.reload(); } },
      { label: '開発者ツール', accelerator: 'CmdOrCtrl+Alt+I', click: (m, w) => { if(w) w.webContents.toggleDevTools(); } },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('before-quit', () => { app._quitting = true; });

// 二重起動を禁止する。2 個目は別ポート (17846…) で起動し、オリジンが変わるため
// localStorage (前回状態 / プリセットキャッシュ / MIDI learn / ノブ値) が全て空になり、
// 本番直前に「設定が消えた」ように見える事故になる。既存ウィンドウを前面に出すだけにする。
if(!app.requestSingleInstanceLock()){
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if(win && !win.isDestroyed()){
      if(win.isMinimized()) win.restore();
      win.show(); win.focus();
    }
  });
}

app.whenReady().then(() => {
  installMenu();
  createWindow();
  app.on('activate', () => { if(BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { app.quit(); });
