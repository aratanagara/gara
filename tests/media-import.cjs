'use strict';
// HTTP integration + real import/ImageMode/UI methods in a VM (no browser, no app build).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {File} = require('node:buffer');
const {createServer} = require('../desktop/server.js');
const repo = path.resolve(__dirname, '..');
// All generated files stay inside this worktree and are removed in finally.
const temp = fs.mkdtempSync(path.join(__dirname, '.media-import-'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII=', 'base64');
const servers = [];
function write(root, rel, data = png){
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(file, data);
}
async function start(root, media){
  const server = createServer(root, media);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const request = async (params, method = 'POST', body) => {
    const r = await fetch(base + '__media?' + new URLSearchParams(params), {method, body});
    return {status:r.status, ...await r.json()};
  };
  return {
    base, request,
    create: name => request({create:'1', folder:name}),
    put: (name, folder) => request({name, ...(folder ? {folder} : {})}, 'POST', png),
    remove: file => request({path:file}, 'DELETE'),
    folders: async () => (await fetch(base + 'images/folders.json')).json(),
  };
}
const plain = value => JSON.parse(JSON.stringify(value));

async function serverTests(){
  const root = path.join(temp, 'local');
  write(root, 'images/drop/legacy.png');
  write(root, 'images/manual/keep.png');
  write(root, 'images/single.png');
  const api = await start(root);
  assert.equal((await api.request({}, 'GET')).writable, true);
  let folders = await api.folders();
  assert.equal(folders.find(f => f.name === 'drop').imported, true, 'legacy drop counts as an import folder');
  assert.equal(folders.find(f => f.name === 'manual').imported, false, 'hand-made folder is not removable');
  const single = await api.put('new.png');
  assert.equal(single.status, 200);
  assert.equal(single.dir, 'images/drop');
  assert.deepEqual(fs.readFileSync(path.join(root, single.url)), png);
  assert.ok(fs.existsSync(path.join(root, 'images/drop/legacy.png')));
  const repeat = await api.put('new.png');
  assert.equal(repeat.name, 'new-1.png');
  const concurrent = await Promise.all([api.put('parallel.png'), api.put('parallel.png')]);
  assert.equal(new Set(concurrent.map(r => r.name)).size, 2, 'parallel uploads do not overwrite');

  const first = await api.create('写真 #100%');
  assert.equal(first.folder, '写真 #100%');
  assert.equal((await api.create('写真 #100%')).folder, '写真 #100%-2');
  assert.equal((await api.create('写真 #100%')).folder, '写真 #100%-3');
  assert.equal((await api.create('manual')).folder, 'manual-2');
  assert.equal((await api.create('etc')).folder, 'etc-2', 'reserved folder stays visible under a different name');
  const imported = await api.put('写真 #1%.png', first.folder);
  await api.put('写真 #1%.png', first.folder); // Nested duplicate basenames are flattened safely.
  assert.equal(imported.dir, first.dir);
  const encoded = imported.url.split('/').map(encodeURIComponent).join('/');
  assert.deepEqual(Buffer.from(await (await fetch(api.base + encoded)).arrayBuffer()), png);
  assert.equal((await api.create('._写真/\\:*?"<>|\u0001')).folder, '写真' + '_'.repeat(10));
  const long = '写'.repeat(70);
  assert.equal((await api.create(long)).folder, '写'.repeat(64));
  assert.equal((await api.create(long)).folder, '写'.repeat(62) + '-2');
  for(const folder of ['..', '../escape', 'a/../escape', '..\\escape']){
    assert.equal((await api.create(folder)).status, 400, folder);
    assert.equal((await api.put('bad.png', folder)).status, 400, folder);
  }
  assert.equal((await api.put('bad.png', 'manual')).ok, false);
  assert.ok(!fs.existsSync(path.join(root, 'images/manual/.gara-import')));
  const batch = await api.create('drop-20261126-123456');
  await api.put('a.png', batch.folder);
  assert.equal((await api.create('drop-20261126-123456')).folder, batch.folder + '-2');
  folders = await api.folders();
  assert.equal(folders.find(f => f.dir === first.dir).count, 2);
  assert.equal(folders.find(f => f.dir === first.dir).imported, true);
  assert.equal(folders.find(f => f.dir === first.dir).removable, true);
  assert.equal(folders.find(f => f.name === 'manual').removable, false);
  assert.equal((await api.remove('images/manual')).status, 403);
  for(const rel of ['images/..', 'images/../manual', 'images/..\\manual', 'images/drop/new.png']){
    assert.equal((await api.remove(rel)).status, 400, rel);
  }
  const removed = await api.remove(first.dir);
  assert.equal(removed.status, 200);
  assert.match(removed.trash, /^images\/_trash\/写真 #100%-\d{8}-\d{6}\/$/);
  assert.ok(!fs.existsSync(path.join(root, first.dir)));
  assert.deepEqual(fs.readFileSync(path.join(root, removed.trash, imported.name)), png);
  assert.ok(fs.existsSync(path.join(root, removed.trash, '.gara-import')));
  const removedSingle = await api.remove('images/single.png');
  assert.equal(removedSingle.status, 200);
  assert.deepEqual(fs.readFileSync(path.join(root, removedSingle.trash, 'single.png')), png);
  write(root, 'images/single.png');
  const removedAgain = await api.remove('images/single.png');
  assert.notEqual(removedAgain.trash, removedSingle.trash);
  assert.deepEqual(fs.readFileSync(path.join(root, removedSingle.trash, 'single.png')), png);
  folders = await api.folders();
  assert.ok(!folders.some(f => f.dir === first.dir || f.dir === 'images/single.png' || f.dir.includes('_trash')));
  assert.ok(!JSON.parse(fs.readFileSync(path.join(root, 'images/manifest.json'))).includes('single.png'));
  assert.equal((await api.remove('images/drop')).status, 200);
  assert.ok(!(await api.folders()).some(f => f.dir === 'images/drop'));

  const bundle = path.join(temp, 'bundle'), media = path.join(temp, 'media');
  write(bundle, 'images/同梱/builtin.png');
  write(bundle, 'images/同梱/.gara-import', 'bundled marker');
  write(bundle, 'images/builtin.png');
  fs.mkdirSync(media);
  const overlay = await start(bundle, media);
  assert.equal((await overlay.folders()).find(f => f.name === '同梱').removable, false);
  assert.equal((await overlay.remove('images/同梱')).ok, false);
  assert.equal((await overlay.create('同梱')).folder, '同梱-2');
  const external = await overlay.put('external.png', '同梱-2');
  assert.ok(fs.existsSync(path.join(media, external.url)));
  assert.ok(!fs.existsSync(path.join(bundle, external.url)));
  assert.ok((await overlay.folders()).some(f => f.dir === 'images/同梱'));
  assert.equal((await overlay.remove(external.dir)).status, 200);
  assert.deepEqual(fs.readFileSync(path.join(bundle, 'images/同梱/builtin.png')), png);
  // A symlink is never an import folder or a writable upload/trash destination.
  fs.symlinkSync(path.join(root, 'images/manual'), path.join(media, 'images/link'));
  assert.equal((await overlay.put('bad.png', 'link')).ok, false);
  assert.equal((await overlay.remove('images/link')).status, 403);
  assert.ok(!fs.existsSync(path.join(root, 'images/manual/bad.png')));
  console.log('PASS: media HTTP persistence, Japanese/sanitized names, numbering, traversal, markers, trash, protected folders and mediaRoot');
  return api;
}

async function clientTests(api){
  const elements = new Map(), messages = [], revoked = [], storage = new Map();
  let serial = 0, online = false;
  function element(tag){
    return {tag, dataset:{}, style:{}, children:[], events:{}, textContent:'', isConnected:true,
      appendChild(el){ this.children.push(el); }, addEventListener(type, fn){ this.events[type] = fn; },
      getAttribute(key){ return this[key] || null; }, setAttribute(key, value){ this[key] = value; },
      set innerHTML(value){ this.children = []; }, get innerHTML(){ return ''; },
      getContext(){ return {fillRect(){}, drawImage(){}}; },
    };
  }
  const document = {
    documentElement:{}, querySelector:s=>elements.get(s) || null, querySelectorAll:()=>[],
    createElement:element, addEventListener(){}, dispatchEvent(){},
  };
  const ctx = vm.createContext({
    console, document, window:{addEventListener(){}}, navigator:{language:'ja'},
    localStorage:{getItem:k=>storage.get(k) || null, setItem:(k,v)=>storage.set(k,v)},
    CustomEvent:class {}, setTimeout(){}, clearTimeout(){}, requestAnimationFrame(){},
    performance:{now:()=>1000}, location:{hostname:'example.com'},
    URL:{createObjectURL:()=> 'blob:test-' + ++serial, revokeObjectURL:url=>revoked.push(url)},
    Image:class {}, VJIcon:{set(){}},
    fetch:(url, opts)=>{ assert.ok(online, 'session import/remove must not request a writable server'); return fetch(new URL(url, api.base), opts); },
  });
  vm.runInContext(fs.readFileSync(path.join(repo, 'i18n.js'), 'utf8'), ctx);
  ctx.I18n = ctx.window.I18n;
  vm.runInContext(fs.readFileSync(path.join(repo, 'mode/image.js'), 'utf8'), ctx);
  // Load the actual MediaImport object and UI methods; avoid starting the app.
  const source = fs.readFileSync(path.join(repo, 'app.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('const MediaImport = {'), source.indexOf('\n/* ===', source.indexOf('const MediaImport = {'))), ctx);
  ctx.GL = {gl:null, slots:{A:{kind:'image'}}};
  ctx.App = {activeSlot:'A', _confirm:(text, fn)=>{ messages.push(text); return fn(); }};
  ctx.toast = msg=>messages.push(msg);
  ctx.$ = selector=>document.querySelector(selector);
  ctx.UI = {refreshMix(){}, refreshAll(){}, _imgFx:()=>[], bindEngineHints(){}};
  for(const [start, end] of [['_importTile(what, inputSel, cat){', '  // 遅延ローディング'],
                            ['_drawFolderThumb(cv, folder){', '  _imgFx(){'],
                            ['refreshImageMode(){', '\n  bindPhoto(){']]){
    const pos = source.indexOf('  ' + start);
    const method = source.slice(pos, source.indexOf(end, pos));
    Object.assign(ctx.UI, vm.runInContext('({' + method + '})', ctx));
  }
  const {MediaImport:imp, ImageMode:mode} = vm.runInContext('({MediaImport, ImageMode})', ctx);
  const file = (name, type = '', rel) => Object.assign(new File([png], name, {type}), rel ? {webkitRelativePath:rel} : {});
  const fileEntry = f => ({name:f.name, isFile:true, file:resolve=>resolve(f)});
  const directory = (name, batches) => ({name, isDirectory:true, createReader(){ let i = 0; return {readEntries:resolve=>resolve(batches[i++] || [])}; }});
  const nested = directory('写真', [
    [fileEntry(file('a.png')), fileEntry(file('.hidden.png')), fileEntry(file('readme.txt'))],
    [directory('sub', [[fileEntry(file('a.png')), fileEntry(file('movie.mp4'))]]), directory('.cache', [[fileEntry(file('hidden.png'))]])],
  ]);
  const grid = element('div'); elements.set('#imageFolderGrid', grid);
  assert.equal(await imp.acceptDrop({items:[{kind:'file', webkitGetAsEntry:()=>nested, getAsFile:()=>null}], files:[]}), 2);
  const session = mode.folders[0];
  assert.equal(session.name, '写真 (臨時)');
  assert.deepEqual(plain(session.images), ['a.png', 'a-2.png']);
  assert.equal(await imp.acceptDirectoryFiles([file('p.png', '', '選択/sub/p.png'), file('no.png', '', '選択/.cache/no.png'), file('text.txt', '', '選択/text.txt')]), 1);
  assert.equal(mode.folders[0].name, '選択 (臨時)');
  assert.equal(await imp.acceptFolder([file('b.png')], '写真'), 1);
  assert.equal(mode.folders[0].name, '写真-2 (臨時)');
  assert.equal(await imp.acceptDrop({files:[file('fallback.png')]}), 1, 'FileList fallback without entries');
  assert.equal(await imp.acceptDrop({items:[nested, directory('別フォルダ', [[fileEntry(file('x.png'))]])].map(entry=>({kind:'file', webkitGetAsEntry:()=>entry, getAsFile:()=>null})), files:[]}), 3);
  assert.ok(mode.folders.some(f=>f.name === '別フォルダ (臨時)' && f.count === 1));
  assert.equal(await imp.accept([file('one.png')]), 1);
  assert.equal(mode.folders[0].single, true);
  assert.ok(mode.folders[0]._urls.length === 1);
  ctx.UI.refreshImageMode();
  assert.equal(grid.children[1].textContent, '＋ フォルダ');
  assert.equal(grid.children[0].style.gridColumn, 'auto');
  assert.equal(grid.children[1].style.gridColumn, 'auto');
  assert.ok(grid.children[2].children.some(el=>el.tag === 'button'), 'session single has ×');
  const keptDir = mode.folders[0].dir;
  mode.setFolder(session.dir, 'A'); mode.setFolder(session.dir, 'B');
  const token = mode.S.A.loadToken;
  ctx.UI.refreshImageMode();
  const tile = grid.children.find(el=>el.children.some(c=>c.textContent === session.name + ' (2)'));
  tile.children.find(el=>el.tag === 'button').events.click({stopPropagation(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(messages.some(msg=>msg.includes('(一覧から外します)')));
  assert.equal(mode._folderByDir(session.dir), null);
  assert.equal(mode.S.A.P.folder, ''); assert.equal(mode.S.B.list.length, 0);
  assert.ok(mode.S.A.loadToken > token);
  assert.ok(session._urls.every(url=>revoked.includes(url)));
  await imp.accept([file('next.png')]);
  assert.ok(mode.folders.every((f,i,all)=>all.findIndex(x=>x.dir === f.dir) === i), 'deletion cannot reuse a live blob ID');
  assert.ok(mode._folderByDir(keptDir));
  // The drop event stops bubbling (grid and Visual pane both listen).
  const target = element('div'); let stopped = false;
  imp.bindDropZone(target);
  target.events.drop({dataTransfer:{types:['Files'], files:[]}, preventDefault(){}, stopPropagation(){stopped = true;}});
  assert.ok(stopped);

  // Use the same frontend against the real local API and ensure persisted UI never says temporary.
  online = true; ctx.location.hostname = '127.0.0.1'; imp._probe = null; ctx.UI._mediaLocal = true;
  assert.equal(await imp.acceptFolder([file('saved.png')], '保存フォルダ'), 1);
  const persisted = mode.folders.find(f=>f.dir === 'images/保存フォルダ');
  assert.ok(persisted.imported && persisted.removable);
  assert.ok(messages.at(-1).includes('images/保存フォルダ/'));
  assert.ok(!/臨時|このセッション/.test(messages.at(-1)));
  assert.equal(await imp.acceptFolder([file('another.png')], '保存フォルダ'), 1);
  assert.ok(mode._folderByDir('images/保存フォルダ-2'));
  assert.equal(await imp.accept([file('loose-a.png'), file('loose-b.png')]), 2);
  assert.match(mode.P.folder, /^images\/drop-\d{8}-\d{6}$/);
  assert.equal(await imp.accept([file('loose-one.png')]), 1);
  assert.equal(mode.P.folder, 'images/drop');
  ctx.UI.refreshImageMode();
  const manualTile = grid.children.find(el=>el.children.some(c=>c.textContent === 'manual (1)'));
  assert.ok(!manualTile.children.some(el=>el.tag === 'button'));
  const persistedTile = grid.children.find(el=>el.children.some(c=>c.textContent === persisted.name + ' (1)'));
  persistedTile.children.find(el=>el.tag === 'button').events.click({stopPropagation(){}});
  // Confirmed callback is async, so wait for the observable list refresh.
  for(let i = 0; i < 100 && mode._folderByDir(persisted.dir); i++) await new Promise(resolve=>setTimeout(resolve, 10));
  assert.equal(mode._folderByDir(persisted.dir), null);
  assert.ok(messages.some(msg=>msg.includes('(images/_trash へ移します)')));
  assert.equal(mode.imageURL({dir:'images/写真 #100%'}, 'file #1%.png'), 'images/' + encodeURIComponent('写真 #100%') + '/' + encodeURIComponent('file #1%.png'));
  ctx.I18n.setLanguage('en');
  for(const key of ['フォルダ', ' (臨時)', ' (images/_trash へ移します)', '一覧から外す (このセッション)']) assert.notEqual(ctx.I18n.t(key), key);
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  assert.match(html, /id="fileImageFolderImport"[^>]*webkitdirectory/);
  assert.ok(!ctx.I18n.t('html.721').includes('temporary'));
  console.log('PASS: recursive paginated drops, directory picker, blob cleanup, × UI, persistence UI, multi-file batches and i18n (VM only)');
}

(async()=>{
  try{ await clientTests(await serverTests()); }
  finally{
    for(const server of servers){ server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
    fs.rmSync(temp, {recursive:true, force:true});
  }
})().catch(error=>{ console.error(error); process.exitCode = 1; });
