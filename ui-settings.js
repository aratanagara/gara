// 設定パネル / Help パネル (トップバーの歯車・Help で右パネルを切り替える) とライト / ダーク切替。
// 表示: 値の適用は index.html の head にある VJUI.apply (最初の描画前と共通)。
//   ライブで反映し、Save で localStorage['vj.ui'] に保存。保存せずにパネルを離れると保存値へ戻る。
// テーマは押した時点で localStorage['vj.theme'] に保存する。
// 動作・性能・Audio・BPM・MIDI・録画: 変えた時点で反映・保存する。解像度 / Fade 対象 / BPM Detect / MIDI Relative / Full Cache は
//   app.js が id で直接つなぐコントロール。ここでは起動時に読む保存先への書き込みだけを足す。
//   data-pref のコントロールは端末ごとの設定 (localStorage['vj.<key>'] = Prefs)。サーバーには送らない。
(function(){
  const $ = (s) => document.querySelector(s);
  const root = document.documentElement;
  const ACC_SWATCHES = ['#3f00ff', '#ff00aa', '#00b3a4', '#ff5a1f', '#e6c300', '#1f1f1f'];
  const HEX = /^#[0-9a-f]{6}$/i;

  function setTheme(theme){
    root.dataset.theme = theme;
    try { localStorage.setItem('vj.theme', theme); } catch (_) {}
    document.querySelectorAll('#setTheme button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === theme)));
  }

  // テーマ既定の枠線色 (rgba) を color input 用の不透明 hex にする (パネル地の色と合成)
  function themeColorHex(prop){
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;color:var(' + prop + ');background:var(--panel2)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const p = (v) => (v.match(/[\d.]+/g) || []).map(Number);
    const c = p(cs.color), b = p(cs.backgroundColor);
    probe.remove();
    const a = c.length > 3 ? c[3] : 1;
    return '#' + [0, 1, 2].map(i => Math.round(c[i] * a + (b[i] || 0) * (1 - a)).toString(16).padStart(2, '0')).join('');
  }

  // ── 動作: チェックボックス (data-fn) ──
  const FN = {
    restore: {
      get: () => { try { return localStorage.getItem('vj.restore') !== '0'; } catch (_) { return true; } },
      set: (on) => {
        try { localStorage.setItem('vj.restore', on ? '1' : '0'); } catch (_) {}
        if(typeof App !== 'undefined') App._restoreOn = on;
        if(typeof toast === 'function') toast(on ? '復元 ON (次回起動から前回状態を復元)' : '復元 OFF (次回起動はクリーン)');
      }
    },
    mixPrev: {
      get: () => typeof App !== 'undefined' && App.mixPrevVisible !== false,
      set: (on) => { if(typeof App !== 'undefined' && App.mixPrevVisible !== on) App.toggleMixPreviews(); }
    },
    mouse: {
      get: () => { try { return localStorage.getItem('vj.mouseCapture') === '1'; } catch (_) { return false; } },
      set: (on) => { try { localStorage.setItem('vj.mouseCapture', on ? '1' : '0'); } catch (_) {} }   // 起動時の値だけ。今の状態は M キー
    }
  };

  // data-pref 設定を変えた直後に、動いている機能へ反映する (起動時にだけ読むものは載せない)
  const PREF_HOOKS = {
    fpsCap: (v) => { App._fpsCap = +v; App._fpsCapLast = 0; },
    syncTimeout: () => toast('サーバー同期の設定は次回起動から効きます'),
    shareDefaults: () => toast('デフォルト共有の設定は次回起動から効きます'),
    hideCursor: () => App.applyHideCursor(),
    wakeLock: () => App.applyWakeLock(),
    videoPreload: (v) => { if(v === '1' && typeof Movie !== 'undefined' && Movie.startPreload) Movie.startPreload(); },
    midiLed: (v) => {
      MIDI.ledEnabled = v === '1';
      MIDI.resetLeds();
      if(MIDI.ledEnabled) MIDI.refreshLeds();
    },
    midiPickup: (v) => { MIDI.pickup = v === '1'; if(!MIDI.pickup) MIDI._pickupArmed = {}; },
    micProcessing: () => restartMic(),
    micDevice: () => restartMic()
  };
  function restartMic(){
    if(Audio.mode !== 'mic') return;
    Audio.start('mic').then(() => UI.refreshAudioButtons());
  }

  // Mic Device: 接続中の入力を並べる (ラベルはマイク権限を許可するまで空なので連番で代用)
  async function fillMicDevices(sel){
    if(!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    let list = [];
    try { list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications'); } catch (_) { return; }
    const want = Prefs.get('micDevice', '');
    sel.textContent = '';
    sel.add(new Option('OS default (OS の既定)', ''));
    list.forEach((d, i) => sel.add(new Option(d.label || ('Mic ' + (i + 1)), d.deviceId)));
    if(want && !list.some(d => d.deviceId === want)) sel.add(new Option('(未接続の保存デバイス)', want));
    sel.value = want;
  }

  // Fade 対象は Transition のデフォルト保存先 (vj.def.transition) の paramFadeScope だけを書き換えて残す
  function persistFadeScope(v){
    let d = {};
    try { d = JSON.parse(localStorage.getItem('vj.def.transition') || '{}') || {}; } catch (_) {}
    d.paramFadeScope = v;
    try { localStorage.setItem('vj.def.transition', JSON.stringify(d)); } catch (_) {}
    if(typeof App !== 'undefined' && App._putServerDef) App._putServerDef('transition', d);   // サーバーの defs はこの 1 キーだけ差し替える
  }

  // 歯車 / Help = 右パネルを Settings / Help に切り替える。開いている間は Slot A/B とタブを隠す (#side.side-sub)。
  // もう一度押すか Esc で開く前のタブへ戻る。Tab は開く前のタブを起点に送る。
  function bindSubPanes(defs){
    const side = $('#side');
    let cur = null, prevTab = 'preset';
    const leave = () => {
      if(!cur) return;
      const d = cur; cur = null;
      d.btn.classList.remove('on');
      side.classList.remove('side-sub');
      if(d.onLeave) d.onLeave();
    };
    const back = () => {
      leave();
      const t = document.querySelector('.tab[data-tab="' + prevTab + '"]');
      if(t) t.click();
    };
    const open = (d) => {
      if(cur) leave();
      else { const t = document.querySelector('.tab.on'); if(t) prevTab = t.dataset.tab; }
      cur = d;
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('on'));
      document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p === d.pane));
      d.btn.classList.add('on');
      side.classList.add('side-sub');
      if(d.onOpen) d.onOpen();
      if(window.PseudoScroll) PseudoScroll.refresh();
    };
    defs.forEach(d => d.btn.addEventListener('click', () => cur === d ? back() : open(d)));
    defs.forEach(d => { const x = d.pane.querySelector('.modal-close'); if(x) x.addEventListener('click', back); });
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', leave));
    // 開いている間: Esc = 閉じるだけ (全スロットのリセットへ流さない) / Tab = 開く前のタブを起点に送る
    window.addEventListener('keydown', (e) => {
      if(!cur) return;
      const ae = document.activeElement;
      if(ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName) && ae.type !== 'checkbox' && ae.type !== 'range' && e.key !== 'Tab') return;
      if(e.key === 'Escape'){ e.preventDefault(); e.stopImmediatePropagation(); back(); }
      else if(e.key === 'Tab'){
        leave();
        const t = document.querySelector('.tab[data-tab="' + prevTab + '"]');
        if(t) t.classList.add('on');   // app.js のタブ送りがここを起点に次のタブを開く
      }
    }, true);
  }

  function init(){
    const pane = $('#settingsPane');
    const btn = $('#btnSettings');
    const colors = [...pane.querySelectorAll('input[type=color][data-ckey]')];
    const accHex = $('#setAccHex'), jpSel = $('#setJp'), dirtyMark = $('#setDirty');
    const fnChecks = [...pane.querySelectorAll('input[type=checkbox][data-fn]')];
    const prefs = [...pane.querySelectorAll('[data-pref]')];
    const micSel = $('#setMicDev');
    $('#setWakeLock').dataset.def = Prefs.touch ? '1' : '0';   // Wake Lock の既定はタッチ端末だけ ON
    let saved = VJUI.load();
    let cur = { ...saved };

    const isDirty = () => Object.keys(cur).some(k => cur[k] !== saved[k]);
    const hexOf = (k) => k === 'acc' ? accHex : pane.querySelector('[data-hex="' + k + '"]');
    const render = () => {
      colors.forEach(c => {
        const k = c.dataset.ckey, v = cur[k] || themeColorHex('--' + k);
        c.value = v;
        const h = hexOf(k);
        if(document.activeElement !== h) h.value = cur[k] || (k === 'acc' ? v : 'Auto');
      });
      pane.querySelectorAll('[data-auto]').forEach(b => b.setAttribute('aria-pressed', String(!cur[b.dataset.auto])));
      jpSel.value = cur.jpFont;
      const hidden = cur.hideStats.split(' ');
      pane.querySelectorAll('#setStats button').forEach(b => b.setAttribute('aria-pressed', String(!hidden.includes(b.dataset.stat))));
      pane.querySelectorAll('#setThumbCols button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.cols === +cur.thumbCols)));
      dirtyMark.hidden = !isDirty();
    };
    const renderFn = () => {
      fnChecks.forEach(c => { c.checked = FN[c.dataset.fn].get(); });
      prefs.forEach(el => {
        if(el === micSel) return;
        if(el.type === 'checkbox') el.checked = Prefs.on(el.dataset.pref, el.dataset.def);
        else el.value = Prefs.get(el.dataset.pref, el.dataset.def);
      });
    };
    const change = (patch) => {
      Object.assign(cur, patch);
      VJUI.apply(cur);
      render();
      if(window.PseudoScroll) PseudoScroll.refresh();
    };
    const save = (s) => {
      saved = { ...s };
      try { localStorage.setItem('vj.ui', JSON.stringify(saved)); } catch (_) {}
      change(saved);
    };

    colors.forEach(c => {
      const k = c.dataset.ckey, h = hexOf(k);
      c.addEventListener('input', () => change({ [k]: c.value }));
      h.addEventListener('input', () => { const v = h.value.trim(); if(HEX.test(v)) change({ [k]: v.toLowerCase() }); });
      h.addEventListener('blur', render);
    });
    pane.querySelectorAll('[data-auto]').forEach(b => b.addEventListener('click', () => change({ [b.dataset.auto]: '' })));
    VJUI.jpFonts.forEach(f => jpSel.add(new Option(f.label, f.id)));
    jpSel.addEventListener('change', () => change({ jpFont: jpSel.value }));
    pane.querySelectorAll('#setStats button').forEach(b => b.addEventListener('click', () => {
      const hidden = cur.hideStats.split(' ').filter(Boolean);
      const i = hidden.indexOf(b.dataset.stat);
      if(i < 0) hidden.push(b.dataset.stat); else hidden.splice(i, 1);
      change({ hideStats: hidden.join(' ') });
    }));
    pane.querySelectorAll('#setThumbCols button').forEach(b => b.addEventListener('click', () => change({ thumbCols: +b.dataset.cols })));
    const sw = $('#setAccSw');
    ACC_SWATCHES.forEach(c => {
      const b = document.createElement('button');
      b.type = 'button'; b.title = c; b.style.background = c;
      b.addEventListener('click', () => change({ acc: c }));
      sw.appendChild(b);
    });
    pane.querySelectorAll('#setTheme button').forEach(b => b.addEventListener('click', () => { setTheme(b.dataset.theme); render(); }));

    fnChecks.forEach(c => c.addEventListener('change', () => FN[c.dataset.fn].set(c.checked)));
    prefs.forEach(el => el.addEventListener('change', () => {
      const v = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value;
      Prefs.set(el.dataset.pref, v);
      const hook = PREF_HOOKS[el.dataset.pref];
      if(hook) hook(v);
    }));
    if(navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => fillMicDevices(micSel));
    $('#transParamFadeScope').addEventListener('change', (e) => persistFadeScope(e.target.value));

    $('#setSave').addEventListener('click', () => save(cur));
    $('#setReset').addEventListener('click', () => save(VJUI.defaults));
    $('#setRandom').addEventListener('click', () => {
      const h = Math.floor(Math.random() * 360), s = 70 + Math.random() * 30, l = 40 + Math.random() * 15;
      const f = (n) => { const k = (n + h / 30) % 12, a = s / 100 * Math.min(l / 100, 1 - l / 100);
        return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
      change({ acc: '#' + f(0) + f(8) + f(4) });
    });

    // 説明は title 属性にしか無いのでタップでは読めない: ラベルのタップでトーストに出す
    pane.addEventListener('click', (e) => {
      const lb = e.target.closest('.row[title] > label');
      if(lb && App._coarse()) toast(lb.parentElement.title);   // タッチ端末だけ (PC はホバーで読める)
    });

    // for 無しの行ラベルをタップ → 同じ行の最初のチェックボックスを切り替える (Settings は説明トースト優先で除外)
    $('#side')?.addEventListener('click', (e) => {
      const lb = e.target.closest('.row > label');
      if(!lb || lb.htmlFor || lb.querySelector('input') || lb.closest('#settingsPane')) return;
      lb.parentElement.querySelector('input[type=checkbox]')?.click();
    });

    const isOpen = () => pane.classList.contains('on');
    $('#setVisDefReset')?.addEventListener('click', () => App.resetVisualDefaults());
    bindSubPanes([
      { btn, pane,
        onOpen: () => { saved = VJUI.load(); cur = { ...saved }; render(); renderFn(); fillMicDevices(micSel); },
        onLeave: () => { if(isDirty()) change({ ...saved }); } },
      { btn: $('#btnHelp'), pane: $('#helpPane') }
    ]);
    // P キーで変えた Grad / Blend の表示を、開いている間も拾い直す
    document.addEventListener('keyup', () => { if(isOpen()) renderFn(); });

    setTheme(root.dataset.theme === 'light' ? 'light' : 'dark');
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
