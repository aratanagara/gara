// GARA 内蔵 HTTP サーバ (Electron デスクトップ版 / scripts/local.sh 共通)
//   - アプリ一式の静的配信 (動画シーク用 Range 対応)
//   - /__media : ローカル素材の取り込み。画像 → images/drop/ 、動画 → movies/ へ実ファイルとして
//     保存し、manifest.json / folders.json を再生成する (= 次回起動でも読み込んだまま残る)。
//   file:// だと fetch(manifest.json 等) が失敗するため、ローカルでも必ず HTTP で配信する。
'use strict';
const http = require('http');
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

function listSorted(dir){
  try{ return fs.readdirSync(dir).sort(); }catch(_){ return []; }
}
function writeJson(file, data, indent){
  fs.writeFileSync(file, JSON.stringify(data, null, indent || 0));
}

// movies/manifest.json を再生成 (deploy.sh の regen_manifest と同じ内容)
function regenMovies(root){
  const dir = path.join(root, 'movies');
  if(!fs.existsSync(dir)) return;   // 公開版など movies/ 自体が無い配布ではスキップ (取り込み時に mkdir される)
  const files = listSorted(dir).filter(f => VID_RE.test(f));
  writeJson(path.join(dir, 'manifest.json'), files);
}

// shaders/manifest.json: bg_*.frag を自動登録 (deploy.sh の PYMANIFEST と同じ規則)。
//   既存エントリの名前・順序は保持し、新規ファイルだけ末尾に追加 / 消えたファイルは除去。
function regenShaders(root){
  const dir = path.join(root, 'shaders');
  const mpath = path.join(dir, 'manifest.json');
  let m;
  try{ m = JSON.parse(fs.readFileSync(mpath, 'utf8')); }catch(_){ return; }
  let changed = false;
  for(const g of (m.groups || [])){
    if(g.type !== 'perBg') continue;
    const bgs = g.bgs || [];
    const known = new Set(bgs.map(b => b.file).concat(g.exclude || []));   // exclude = エンジン用シェーダ (プリセット化しない)
    const disk = listSorted(dir).filter(f => /^bg_.*\.frag$/.test(f));
    for(const f of disk){
      if(known.has(f)) continue;
      let src = ''; try{ src = fs.readFileSync(path.join(dir, f), 'utf8'); }catch(_){ continue; }
      const fn = /vec3\s+(bg_\w+)\s*\(\s*vec2/.exec(src);
      if(!fn) continue;
      const name = f.replace(/^bg_/, '').replace(/\.frag$/, '')
        .split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      bgs.push({ file: f, func: fn[1], name });
      changed = true;
    }
    const kept = bgs.filter(b => fs.existsSync(path.join(dir, b.file || '')));
    if(kept.length !== bgs.length) changed = true;
    g.bgs = kept;
  }
  if(changed){
    fs.writeFileSync(mpath, JSON.stringify(m, null, 1) + '\n');
    console.log('shaders/manifest.json regenerated');
  }
}

// images/ 配下の manifest.json 一式 + images/folders.json を再生成 (deploy.sh の PYIMAGES と同じ規則)
function regenImages(root){
  const base = path.join(root, 'images');
  if(!fs.existsSync(base)) return;
  const folders = [];
  for(const name of listSorted(base)){
    if(name.startsWith('_') || name.startsWith('.') || EXCLUDE_FOLDERS.has(name)) continue;
    const d = path.join(base, name);
    let st; try{ st = fs.statSync(d); }catch(_){ continue; }
    if(!st.isDirectory()) continue;
    const imgs = listSorted(d).filter(f => IMG_RE.test(f));
    if(!imgs.length) continue;
    writeJson(path.join(d, 'manifest.json'), imgs);
    folders.push({ name, dir: 'images/' + name, count: imgs.length, images: imgs });
  }
  // images/ 直下の画像: manifest (Layer のフォールバック) + 一覧の先頭に 1 枚ずつ single エントリ
  const rootImgs = listSorted(base).filter(f => {
    if(!IMG_RE.test(f)) return false;
    try{ return fs.statSync(path.join(base, f)).isFile(); }catch(_){ return false; }
  });
  writeJson(path.join(base, 'manifest.json'), rootImgs);
  for(const f of rootImgs.slice().reverse()){
    folders.unshift({ name: f.replace(/\.[^.]+$/, ''), dir: 'images/' + f, single: true, count: 1, images: [f] });
  }
  writeJson(path.join(base, 'folders.json'), folders, 1);
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

function serveStatic(root, req, res, urlPath){
  const file = path.normalize(path.join(root, urlPath));
  if(!file.startsWith(root + path.sep)){ res.writeHead(403); res.end(); return; }   // ルート外は拒否
  fs.stat(file, (err, st) => {
    if(err || !st.isFile()){ res.writeHead(404); res.end(); return; }
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
  });
}

// root 直下を配信する http.Server を返す (listen は呼び出し側)
function createServer(root){
  root = path.normalize(root);
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
    if(urlPath === '/__media'){
      // GET = 取り込み可否の問い合わせ / POST = ファイル本体を取り込む
      if(req.method === 'GET'){ sendJson(res, 200, { ok:true, writable: writable(root), movies:'movies', images:'images/' + DROP_FOLDER }); return; }
      if(req.method === 'POST'){ importMedia(root, req, res, u); return; }
      res.writeHead(405); res.end(); return;
    }
    if(urlPath === '/') urlPath = '/index.html';
    // manifest 系はファイルシステムから毎回再生成してから配信する。
    // Finder で images/ ・ movies/ ・ shaders/ に置いた/消した素材が、
    // deploy.sh を通さなくてもリロードだけで反映される (ローカル作業を Claude レスで完結)。
    if(writable(root)){
      try{
        if(urlPath === '/images/folders.json' || urlPath.startsWith('/images/') && urlPath.endsWith('/manifest.json')) regenImages(root);
        else if(urlPath === '/movies/manifest.json') regenMovies(root);
        else if(urlPath === '/shaders/manifest.json') regenShaders(root);
      }catch(e){ console.warn('manifest regen failed:', urlPath, e); }
    }
    serveStatic(root, req, res, urlPath);
  });
}

module.exports = { createServer, regenMovies, regenImages, regenShaders, DROP_FOLDER };

// スタンドアローン起動: node desktop/server.js [port]  (scripts/local.sh から使用)
if(require.main === module){
  const port = parseInt(process.argv[2], 10) || 8123;
  const root = path.join(__dirname, '..');
  createServer(root).listen(port, '127.0.0.1', () => {
    console.log('GARA local server: http://localhost:' + port + '/  (root: ' + root + ')');
  });
}
