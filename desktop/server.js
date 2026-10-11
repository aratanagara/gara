// GARA 内蔵 HTTP サーバ (Electron デスクトップ版 / scripts/local.sh 共通)
//   - アプリ一式の静的配信 (動画シーク用 Range 対応)
//   - 素材オーバーレイ: mediaRoot (外部素材フォルダ) を設定すると、movies/ images/ shaders/ presets/
//     はそちらを優先して配信する。素材の追加・差し替えに再ビルドが不要になる。
//     mediaRoot に無いファイルは同梱 (root) へフォールバックするので他マシンでも壊れない。
//   - manifest 配信時自動生成: movies/manifest.json, images/folders.json, images/*/manifest.json,
//     shaders/manifest.json は GET のたびに素材フォルダの実態から再生成する。
//     → Finder でファイルを置いてアプリをリロードするだけで一覧に反映される。
//   - /__media : ローカル素材の取り込み。画像 → images/drop/ 、動画 → movies/ へ実ファイルとして
//     保存し、manifest を再生成する (mediaRoot 設定時はそちらへ保存 = 再ビルドでも消えない)。
//   file:// だと fetch(manifest.json 等) が失敗するため、ローカルでも必ず HTTP で配信する。
'use strict';
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp',
  '.gif':'image/gif', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.bmp':'image/bmp',
  '.mp4':'video/mp4', '.webm':'video/webm', '.mov':'video/quicktime',
  '.m4v':'video/x-m4v', '.ogv':'video/ogg',
  '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf', '.otf':'font/otf',
  '.frag':'text/plain; charset=utf-8', '.glsl':'text/plain; charset=utf-8', '.txt':'text/plain; charset=utf-8',
};

const IMG_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;
const VID_RE = /\.(mp4|webm|mov|m4v|ogv|ogg)$/i;
const DROP_FOLDER = 'drop';                  // ドロップした画像の取り込み先 images/<DROP_FOLDER>/
const EXCLUDE_FOLDERS = new Set(['etc']);    // deploy.sh と同じ (CYBER UI が直接参照する UI 素材)
// 素材オーバーレイの対象 (これ以外のパス = アプリ本体コードは常に同梱 root から配信)
const CONTENT_DIRS = ['movies/', 'images/', 'shaders/', 'presets/'];

function listSorted(dir){
  try{ return fs.readdirSync(dir).sort(); }catch(_){ return []; }
}
// 2 ルートのファイル一覧を統合 (mediaRoot 優先 + 同梱フォールバックの配信実態と一致させる)
function listUnion(primary, fallback){
  const set = new Set(listSorted(primary));
  for(const f of listSorted(fallback || '')) set.add(f);
  return [...set].sort();
}
function existsEither(rel, primaryBase, fallbackBase){
  if(fs.existsSync(path.join(primaryBase, rel))) return true;
  return !!(fallbackBase && fs.existsSync(path.join(fallbackBase, rel)));
}
function writeJson(file, data, indent){
  fs.writeFileSync(file, JSON.stringify(data, null, indent || 0));
}

// movies/manifest.json を再生成 (deploy.sh の regen_manifest と同じ内容)
function regenMovies(root, fallbackRoot){
  const dir = path.join(root, 'movies');
  if(!fs.existsSync(dir)){ try{ fs.mkdirSync(dir, {recursive:true}); }catch(_){ return; } }
  const files = listUnion(dir, fallbackRoot ? path.join(fallbackRoot, 'movies') : null).filter(f => VID_RE.test(f));
  try{ writeJson(path.join(dir, 'manifest.json'), files); }catch(_){}
}

// images/ 配下の manifest.json 一式 + images/folders.json を再生成 (deploy.sh の PYIMAGES と同じ規則)
function regenImages(root, fallbackRoot){
  const base = path.join(root, 'images');
  const fbase = fallbackRoot ? path.join(fallbackRoot, 'images') : null;
  if(!fs.existsSync(base)){ try{ fs.mkdirSync(base, {recursive:true}); }catch(_){ return; } }
  const folders = [];
  const dirNames = new Set();
  for(const name of listUnion(base, fbase)){
    if(name.startsWith('_') || name.startsWith('.') || EXCLUDE_FOLDERS.has(name)) continue;
    const isDir = (p)=>{ try{ return fs.statSync(p).isDirectory(); }catch(_){ return false; } };
    const inP = isDir(path.join(base, name)), inF = fbase && isDir(path.join(fbase, name));
    if(!inP && !inF) continue;
    dirNames.add(name);
    const imgs = listUnion(inP ? path.join(base, name) : path.join(fbase, name),
                           (inP && inF) ? path.join(fbase, name) : null).filter(f => IMG_RE.test(f));
    if(!imgs.length) continue;
    // フォルダ manifest は書ける側 (primary) へ。primary に無いフォルダは fallback の manifest をそのまま使う
    if(inP){ try{ writeJson(path.join(base, name, 'manifest.json'), imgs); }catch(_){} }
    folders.push({ name, dir: 'images/' + name, count: imgs.length, images: imgs });
  }
  // images/ 直下の画像: manifest (Layer のフォールバック) + 一覧の先頭に 1 枚ずつ single エントリ
  const isFile = (p)=>{ try{ return fs.statSync(p).isFile(); }catch(_){ return false; } };
  const rootImgs = listUnion(base, fbase).filter(f => IMG_RE.test(f)
    && (isFile(path.join(base, f)) || (fbase && isFile(path.join(fbase, f)))));
  try{ writeJson(path.join(base, 'manifest.json'), rootImgs); }catch(_){}
  for(const f of rootImgs.slice().reverse()){
    folders.unshift({ name: f.replace(/\.[^.]+$/, ''), dir: 'images/' + f, single: true, count: 1, images: [f] });
  }
  try{ writeJson(path.join(base, 'folders.json'), folders, 1); }catch(_){}
}

// shaders/manifest.json: bg_*.frag を自動登録 (deploy.sh の PYMANIFEST の JS 版)。
// 既存エントリの名前・順序は保持し、新規ファイルだけ末尾へ追加 / 消えたファイルは除去。
function regenShaders(root, fallbackRoot){
  const dir = path.join(root, 'shaders');
  const mpath = path.join(dir, 'manifest.json');
  let m;
  try{ m = JSON.parse(fs.readFileSync(mpath, 'utf8')); }catch(_){ return; }
  let changed = false;
  for(const g of (m.groups || [])){
    if(g.type !== 'perBg') continue;
    const bgs = g.bgs || [];
    const known = new Set(bgs.map(b => b.file).concat(g.exclude || []));
    const fdir = fallbackRoot ? path.join(fallbackRoot, 'shaders') : null;
    const disk = listUnion(dir, fdir).filter(f => /^bg_.*\.frag$/.test(f));
    for(const f of disk){
      if(known.has(f)) continue;
      let src = '';
      try{ src = fs.readFileSync(path.join(dir, f), 'utf8'); }
      catch(_){ try{ src = fs.readFileSync(path.join(fdir, f), 'utf8'); }catch(__){ continue; } }
      const fn = src.match(/vec3\s+(bg_\w+)\s*\(\s*vec2/);
      if(!fn) continue;   // vec3 bg_*(vec2) が無いものはスキップ (deploy.sh と同じ)
      const name = f.replace(/^bg_/, '').replace(/\.frag$/, '')
        .split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      bgs.push({ file: f, func: fn[1], name });
      changed = true;
    }
    const kept = bgs.filter(b => fs.existsSync(path.join(dir, b.file || ''))
      || (fallbackRoot && fs.existsSync(path.join(fallbackRoot, 'shaders', b.file || ''))));
    if(kept.length !== bgs.length) changed = true;
    g.bgs = kept;
  }
  if(changed){
    try{ fs.writeFileSync(mpath, JSON.stringify(m, null, 1) + '\n'); }catch(_){}
  }
}

// manifest 系のリクエストパス → 再生成処理 (配信直前に呼ぶ)
function regenForPath(contentRoot, fallbackRoot, urlPath){
  try{
    if(urlPath === '/movies/manifest.json') regenMovies(contentRoot, fallbackRoot);
    else if(urlPath === '/images/folders.json' || urlPath === '/images/manifest.json'
            || /^\/images\/[^/]+\/manifest\.json$/.test(urlPath)) regenImages(contentRoot, fallbackRoot);
    else if(urlPath === '/shaders/manifest.json') regenShaders(contentRoot, fallbackRoot);
  }catch(_){ /* 再生成失敗時は既存ファイルをそのまま配信 */ }
}

function sendJson(res, code, obj){
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  res.end(body);
}

// 取り込み先が書き込み可能か (パッケージ済みアプリを読み取り専用の場所へ置いた場合は false)
function writable(root){
  try{ fs.accessSync(root, fs.constants.W_OK); return true; }catch(_){ return false; }
}

function importMedia(root, req, res, u){
  const raw = String(u.searchParams.get('name') || '');
  const name = path.basename(raw).replace(/[\\/:*?"<>|]/g, '_').replace(/[\u0000-\u001f]/g, '');
  const isVid = VID_RE.test(name), isImg = IMG_RE.test(name);
  if(!name || (!isVid && !isImg)){ sendJson(res, 400, { ok:false, error:'unsupported file: ' + raw }); return; }
  const relDir = isVid ? 'movies' : ('images/' + DROP_FOLDER);
  const dir = path.join(root, relDir);
  let target;
  try{
    fs.mkdirSync(dir, { recursive: true });
    // 同名は連番を付けて既存素材を上書きしない
    const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
    target = path.join(dir, name);
    for(let n = 1; fs.existsSync(target); n++) target = path.join(dir, stem + '-' + n + ext);
  }catch(e){ sendJson(res, 500, { ok:false, error: String(e && e.message || e) }); return; }
  const tmp = target + '.part';
  const ws = fs.createWriteStream(tmp);
  const fail = (e)=>{ try{ fs.unlinkSync(tmp); }catch(_){} if(!res.headersSent) sendJson(res, 500, { ok:false, error: String(e && e.message || e) }); };
  ws.on('error', fail);
  req.on('aborted', ()=>{ try{ ws.destroy(); fs.unlinkSync(tmp); }catch(_){} });
  ws.on('finish', ()=>{
    try{
      fs.renameSync(tmp, target);
      if(isVid) regenMovies(root); else regenImages(root);
    }catch(e){ fail(e); return; }
    const file = path.basename(target);
    sendJson(res, 200, { ok:true, kind: isVid ? 'video' : 'image', dir: relDir, name: file, url: relDir + '/' + file });
  });
  req.pipe(ws);
}

function serveFile(req, res, file, st){
  const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  if(range){
    // 動画シーク用の Range 対応 (bytes=start-end)
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
    if(isNaN(start) || start >= st.size) start = 0;
    if(isNaN(end) || end >= st.size) end = st.size - 1;
    res.writeHead(206, {
      'Content-Type': mime,
      'Content-Range': `bytes ${start}-${end}/${st.size}`,
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file, {start, end}).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': st.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  }
}

let activeTap = null;   // /__sysaudio のヘルパプロセス (同時 1 本)

// root (同梱) + mediaRoot (外部素材、任意) を配信する http.Server を返す (listen は呼び出し側)
function createServer(root, mediaRoot){
  root = path.normalize(root);
  mediaRoot = mediaRoot ? path.normalize(mediaRoot) : null;
  const isContentPath = (urlPath)=> CONTENT_DIRS.some(d => urlPath.startsWith('/' + d));
  // 取り込み先: mediaRoot があればそちら (再ビルドでも消えない)
  const importRoot = ()=> (mediaRoot && writable(mediaRoot)) ? mediaRoot : root;
  return http.createServer((req, res) => {
    // DNS リバインディング対策: ループバック以外の Host を名乗るリクエストは拒否
    const host = String(req.headers.host || '');
    if(!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)){ res.writeHead(403); res.end(); return; }
    let u;
    try{ u = new URL(req.url, 'http://x'); }
    catch(e){ res.writeHead(400); res.end(); return; }
    let urlPath;
    try{ urlPath = decodeURIComponent(u.pathname); }
    catch(e){ res.writeHead(400); res.end(); return; }
    if(urlPath === '/__sysaudio'){
      // システム音声ストリーム (macOS): Discord 等を除外した CoreAudio プロセスタップ。
      // gara-audio-tap を spawn し、1 行目の JSON ヘッダを HTTP ヘッダに変換して
      // 以降の f32 PCM をそのまま流す。切断でヘルパも終了。同時 1 本のみ。
      if(req.method !== 'GET'){ res.writeHead(405); res.end(); return; }
      const bin = path.join(root, 'desktop', 'bin', 'gara-audio-tap');
      if(process.platform !== 'darwin' || !fs.existsSync(bin)){ res.writeHead(404); res.end(); return; }
      if(activeTap){ try{ activeTap.kill('SIGTERM'); }catch(_){} activeTap = null; }
      const child = spawn(bin, ['discord'], { stdio: ['ignore', 'pipe', 'pipe'] });
      activeTap = child;
      child.stderr.on('data', d => console.log('[sysaudio]', String(d).trim()));
      let headBuf = Buffer.alloc(0), headed = false;
      child.stdout.on('data', chunk => {
        if(headed){ res.write(chunk); return; }
        headBuf = Buffer.concat([headBuf, chunk]);
        const nl = headBuf.indexOf(0x0a);
        if(nl < 0){ if(headBuf.length > 4096){ child.kill(); res.writeHead(500); res.end(); } return; }
        let info = {};
        try{ info = JSON.parse(headBuf.slice(0, nl).toString()); }catch(_){}
        headed = true;
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-store',
          'X-Audio-Rate': String(info.rate || 48000),
          'X-Audio-Channels': String(info.ch || 2),
        });
        if(headBuf.length > nl + 1) res.write(headBuf.slice(nl + 1));
        headBuf = null;
      });
      child.on('exit', () => { if(activeTap === child) activeTap = null; if(headed) res.end(); else { try{ res.writeHead(503); res.end(); }catch(_){} } });
      res.on('close', () => { try{ child.kill('SIGTERM'); }catch(_){} });
      return;
    }
    if(urlPath === '/__media'){
      // GET = 取り込み可否の問い合わせ / POST = ファイル本体を取り込む
      if(req.method === 'GET'){ sendJson(res, 200, { ok:true, writable: writable(importRoot()), mediaRoot: mediaRoot || null, movies:'movies', images:'images/' + DROP_FOLDER }); return; }
      if(req.method === 'POST'){ importMedia(importRoot(), req, res, u); return; }
      res.writeHead(405); res.end(); return;
    }
    if(urlPath === '/') urlPath = '/index.html';

    // 素材パス: mediaRoot 優先 (manifest はその場で再生成) → 同梱へフォールバック
    if(isContentPath(urlPath)){
      const contentRoot = mediaRoot || root;
      regenForPath(contentRoot, mediaRoot ? root : null, urlPath);
      const candidates = mediaRoot ? [mediaRoot, root] : [root];
      const tryNext = (i)=>{
        if(i >= candidates.length){ res.writeHead(404); res.end(); return; }
        const base = candidates[i];
        const file = path.normalize(path.join(base, urlPath));
        if(!file.startsWith(base + path.sep)){ res.writeHead(403); res.end(); return; }
        fs.stat(file, (err, st) => {
          if(err || !st.isFile()){ tryNext(i + 1); return; }
          serveFile(req, res, file, st);
        });
      };
      tryNext(0);
      return;
    }

    // アプリ本体 (コード) は常に同梱 root から
    const file = path.normalize(path.join(root, urlPath));
    if(!file.startsWith(root + path.sep)){ res.writeHead(403); res.end(); return; }   // ルート外は拒否
    fs.stat(file, (err, st) => {
      if(err || !st.isFile()){ res.writeHead(404); res.end(); return; }
      serveFile(req, res, file, st);
    });
  });
}

module.exports = { createServer, regenMovies, regenImages, regenShaders, DROP_FOLDER };

// スタンドアローン起動: node desktop/server.js [port] [mediaRoot]  (scripts/local.sh から使用)
if(require.main === module){
  const port = parseInt(process.argv[2], 10) || 8123;
  const root = path.join(__dirname, '..');
  const mediaRoot = process.argv[3] || null;
  createServer(root, mediaRoot).listen(port, '127.0.0.1', () => {
    console.log('GARA local server: http://localhost:' + port + '/  (root: ' + root + (mediaRoot ? ' / media: ' + mediaRoot : '') + ')');
  });
}
