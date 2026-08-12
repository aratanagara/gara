'use strict';
/* VJ App — WebGL2 fragment-shader stage with Shadertoy compatibility.
   Single-file logic. UI bindings at bottom. */

// ── 共通: シェーダ状態照会の Windows/ANGLE 対策ヘルパ ──
// compileShader/linkProgram 直後に COMPILE_STATUS/LINK_STATUS を照会すると、D3D11(ANGLE) では
// FXC のコンパイル完了まで GPU プロセスを同期ブロックし、ウォッチドッグにプロセスごと殺される(context lost)。
// KHR_parallel_shader_compile があれば COMPLETION_STATUS を先にポーリングしてから状態照会する。
// 各エンジン(mode/*, shaders/*, *FX)の getShaderParameter/getProgramParameter をこの関数に置換して使う。
const __glExtCache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
function __glParallelExt(gl){
  if(!gl) return null;
  if(__glExtCache && __glExtCache.has(gl)) return __glExtCache.get(gl);
  let ext = null; try{ ext = gl.getExtension('KHR_parallel_shader_compile'); }catch(e){}
  if(__glExtCache) __glExtCache.set(gl, ext);
  return ext;
}
// isProgram=true → LINK_STATUS を返す / false → COMPILE_STATUS を返す (完了待ちしてから照会)
function __glReady(gl, obj, isProgram){
  const ext = __glParallelExt(gl);
  if(ext){
    let g = 0;
    try{ while(g++ < 400000 && gl[isProgram ? 'getProgramParameter' : 'getShaderParameter'](obj, ext.COMPLETION_STATUS_KHR) !== true){} }catch(e){}
  }
  return isProgram ? gl.getProgramParameter(obj, gl.LINK_STATUS)
                   : gl.getShaderParameter(obj, gl.COMPILE_STATUS);
}
if(typeof window !== 'undefined'){ window.__glReady = __glReady; window.__glParallelExt = __glParallelExt; }

const $  = (s,p=document)=>p.querySelector(s);
const $$ = (s,p=document)=>[...p.querySelectorAll(s)];
const clamp = (v,a,b)=>v<a?a:v>b?b:v;
const now = ()=>performance.now()/1000;
const isTextEntryTarget = el=>{
  if(!el) return false;
  if(el.isContentEditable) return true;
  const tag = el.tagName;
  if(tag === 'TEXTAREA') return true;
  if(tag !== 'INPUT') return false;
  const type = (el.type || 'text').toLowerCase();
  return /^(text|search|number|password|email|url|tel|date|datetime-local|month|time|week)$/.test(type);
};

function toast(msg, t=1500){
  const el = $('#toast'); if(!el) return;
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(()=>el.classList.remove('show'), t);
}

/* ===================================================================
   INPUTS REGISTRY  — images, videos, webcam, audio FFT, system inputs
=================================================================== */
const Inputs = {
  reg: new Map(),     // id -> entry
  _seq: 0,
  /* entry: {kind:'image'|'video'|'webcam'|'audio'|'feedbackA'|'feedbackB'|'slotA'|'slotB'|'empty',
             label, tex, width, height, video?, img?, _stream?} */
  add(kind, label, opts={}){
    const id = `${kind}-${++this._seq}`;
    const e = {id, kind, label, tex:null, width:1, height:1, ...opts};
    this.reg.set(id, e);
    UI.refreshInputs();
    return id;
  },
  remove(id){
    const e = this.reg.get(id); if(!e) return;
    if(e._stream) e._stream.getTracks().forEach(t=>t.stop());
    if(e.video){ e.video.pause(); e.video.srcObject=null; }
    if(e.tex && GL.gl) GL.gl.deleteTexture(e.tex);
    this.reg.delete(id);
    UI.refreshInputs();
  },
  byId(id){ return this.reg.get(id); },
  list(){ return [...this.reg.values()]; },

  async addImageFile(file){
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    const id = this.add('image', file.name || 'image', {img, width:img.naturalWidth, height:img.naturalHeight});
    const e = this.reg.get(id);
    e.tex = GL.makeTexFromImage(img);
    UI.refreshInputs();
    return id;
  },
  async addImageURL(url, label){
    // 同じ URL は再利用 (プリセット再ロードで増殖させない)
    const existing = this.list().find(x=>x.kind==='image' && x.label===(label||url));
    if(existing) return existing.id;
    const img = new Image();
    img.src = url;
    await img.decode();
    const id = this.add('image', label || url, {img, width:img.naturalWidth, height:img.naturalHeight});
    const e = this.reg.get(id);
    e.tex = GL.makeTexFromImage(img);
    UI.refreshInputs();
    return id;
  },
  async addVideoFile(file){
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.src = url; v.loop = true; v.muted = true; v.playsInline = true;
    await new Promise(r=>{ v.onloadeddata = r; });
    await v.play();
    const id = this.add('video', file.name || 'video', {video:v, width:v.videoWidth, height:v.videoHeight});
    const e = this.reg.get(id);
    e.tex = GL.makeTexEmpty();
    return id;
  },
  async addWebcam(){
    if (this._webcamId) return this._webcamId;
    try{
      const stream = await navigator.mediaDevices.getUserMedia({video:{width:1280,height:720}, audio:false});
      const v = document.createElement('video'); v.srcObject = stream; v.muted = true; v.playsInline = true;
      await v.play();
      const id = this.add('webcam', 'Webcam', {video:v, _stream:stream, width:v.videoWidth, height:v.videoHeight});
      const e = this.reg.get(id); e.tex = GL.makeTexEmpty();
      this._webcamId = id;
      return id;
    }catch(err){ toast('Webcam error: '+err.message); return null; }
  },
  updateDynamic(){
    if(!GL.gl) return;
    for(const e of this.reg.values()){
      if((e.kind==='video' || e.kind==='webcam') && e.video && e.video.readyState>=2){
        // currentTime が変わったときだけアップロード (毎フレーム同じフレームを送らない)
        const ct = e.video.currentTime;
        if(e._lastUploadT !== ct){
          e._lastUploadT = ct;
          GL.uploadVideo(e.tex, e.video);
          e.width = e.video.videoWidth || e.width;
          e.height = e.video.videoHeight || e.height;
        }
      }
    }
  }
};

/* ===================================================================
   MediaImport — 画像 / 動画をスロット素材として読み込む
   ローカル起動 (デスクトップ版 / scripts/local.sh) では内蔵サーバの /__media へ
   POST して images/drop/ ・ movies/ に実ファイルとして取り込む (manifest も再生成
   されるので次回起動でも残る)。本番など書き込めない配信ではセッション限りの
   blob URL として読み込む (リロードで消える)。
=================================================================== */
const MediaImport = {
  IMG_RE: /\.(png|jpe?g|webp|gif|bmp)$/i,
  VID_RE: /\.(mp4|webm|mov|m4v|ogv|ogg)$/i,
  _probe: null,
  storedVideos: [],   // 書き込み不可配信で IndexedDB から復元した動画 [{url(blob), name}] — Visual グリッドへ足す

  // ── 書き込み不可の配信 (github.io / 本番) 用の永続化: IndexedDB に blob 保存 ──
  //   実ファイル取り込みができない環境でも「次回起動でも読み込んだまま」を成立させる。
  _dbP: null,
  _openDb(){
    if(this._dbP) return this._dbP;
    this._dbP = new Promise((res, rej)=>{
      const rq = indexedDB.open('gara.media', 1);
      rq.onupgradeneeded = ()=>{ rq.result.createObjectStore('files', {keyPath:'id', autoIncrement:true}); };
      rq.onsuccess = ()=> res(rq.result);
      rq.onerror = ()=> rej(rq.error);
    });
    return this._dbP;
  },
  async _dbAll(){ const db = await this._openDb(); return new Promise((res, rej)=>{ const rq = db.transaction('files').objectStore('files').getAll(); rq.onsuccess = ()=>res(rq.result || []); rq.onerror = ()=>rej(rq.error); }); },
  async _dbPut(rec){ const db = await this._openDb(); return new Promise((res, rej)=>{ const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(rec); tx.oncomplete = res; tx.onerror = ()=>rej(tx.error); }); },
  async _dbClear(){ const db = await this._openDb(); return new Promise((res, rej)=>{ const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').clear(); tx.oncomplete = res; tx.onerror = ()=>rej(tx.error); }); },

  // 起動時: IndexedDB に保存した素材を復元して一覧へ戻す (取り込みサーバがある環境では実ファイル側を使うので何もしない)
  async restore(){
    if(await this.local()) return;
    let recs = [];
    try{ recs = await this._dbAll(); }catch(e){ return; }
    if(!recs.length) return;
    const imgs = recs.filter(r => r.kind === 'image' && r.blob);
    const vids = recs.filter(r => r.kind === 'video' && r.blob);
    if(imgs.length && typeof ImageMode !== 'undefined'){
      if(!ImageMode.initialized && GL.gl) ImageMode.init(GL.gl);
      // addDroppedFiles はアクティブスロットへ即ロードするので、復元では登録だけ行う
      let f = ImageMode._folderByDir(ImageMode.DROP_DIR);
      if(!f){ f = { name:'ドロップ (臨時)', dir:ImageMode.DROP_DIR, count:0, images:[], _urls:[] }; ImageMode.folders.unshift(f); }
      for(const r of imgs){ f._urls.push(URL.createObjectURL(r.blob)); f.images.push(r.name || ('drop ' + f._urls.length)); }
      f.count = f._urls.length;
    }
    for(const r of vids) this.storedVideos.push({ url: URL.createObjectURL(r.blob), name: r.name || 'drop' });
    if(typeof UI !== 'undefined'){
      if(vids.length && UI.populatePresets) UI.populatePresets();
      if(imgs.length && UI.refreshImageMode) UI.refreshImageMode();
    }
    toast('取り込み済み素材 ' + recs.length + ' 件を復元しました');
  },

  async clearStored(){
    try{ await this._dbClear(); }catch(e){}
    this.storedVideos = [];
    toast('ブラウザ保存の取り込み素材を削除しました (リロードで一覧から消えます)');
  },

  // 内蔵サーバ (取り込み可能) かどうか。1 セッションに 1 回だけ問い合わせる
  local(){
    if(!this._probe) this._probe = (async ()=>{
      try{
        const r = await fetch('__media', { cache:'no-store' });
        if(!r.ok) return false;
        const d = await r.json();
        return !!(d && d.ok && d.writable);
      }catch(e){ return false; }
    })();
    return this._probe;
  },

  kindOf(file){
    const n = (file && file.name) || '';
    const t = (file && file.type) || '';
    if(/^image\//.test(t) || this.IMG_RE.test(n)) return 'image';
    if(/^video\//.test(t) || this.VID_RE.test(n)) return 'video';
    return '';
  },

  async put(file){
    const r = await fetch('__media?name=' + encodeURIComponent(file.name || ''), { method:'POST', body:file });
    const d = await r.json().catch(()=>null);
    if(!r.ok || !d || !d.ok) throw new Error((d && d.error) || ('HTTP ' + r.status));
    return d;   // {kind, dir, name, url}
  },

  // ドロップ / ファイル選択の入口。取り込んだ最後の 1 件をアクティブスロットへ載せる
  async accept(files){
    const list = Array.from(files || []).filter(f => this.kindOf(f));
    if(!list.length){ toast('画像 / 動画ファイルがありません'); return 0; }
    if(await this.local()) return this._importLocal(list);
    return this._importBlob(list);
  },

  async _importLocal(list){
    const done = [];
    for(const f of list){
      toast('取り込み中… ' + f.name);
      try{ done.push(await this.put(f)); }
      catch(e){ console.warn('media import failed:', f.name, e); toast('取り込み失敗: ' + f.name); }
    }
    if(!done.length) return 0;
    const vids = done.filter(d => d.kind === 'video');
    const imgs = done.filter(d => d.kind === 'image');
    if(imgs.length && typeof ImageMode !== 'undefined'){
      if(!ImageMode.initialized && GL.gl) ImageMode.init(GL.gl);
      await ImageMode.loadFolderIndex(true);
    }
    // 動画があれば動画を優先してスロットへ (画像は Image モードのフォルダに積むだけでも見える)
    if(vids.length){
      const v = vids[vids.length - 1];
      if(typeof Movie !== 'undefined'){
        if(!Movie.initialized && GL.gl) Movie.init(GL.gl);
        await Movie.scanFolder();
      }
      App.transitionVideo(v.url, v.name);
    } else if(imgs.length){
      const im = imgs[imgs.length - 1];
      this._toImageSlot(im.dir, im.name);
    }
    if(typeof UI !== 'undefined'){
      if(vids.length && UI.populatePresets) UI.populatePresets();   // Visual グリッドの Movie 一覧を作り直す
      if(UI.refreshImageMode) UI.refreshImageMode();
      if(UI.refreshMix) UI.refreshMix();
    }
    toast(done.length + ' 件を取り込みました (' + (vids.length ? 'movies/ ' : '') + (imgs.length ? 'images/drop/' : '') + ')');
    return done.length;
  },

  // 書き込めない配信 (本番 / github.io): blob として読み込み + IndexedDB へ保存して次回起動でも復元
  _importBlob(list){
    const vids = list.filter(f => this.kindOf(f) === 'video');
    const imgs = list.filter(f => this.kindOf(f) === 'image');
    let n = 0;
    if(imgs.length && typeof ImageMode !== 'undefined'){
      if(!ImageMode.initialized && GL.gl) ImageMode.init(GL.gl);
      n += ImageMode.addDroppedFiles(imgs);
      const f = ImageMode._folderByDir(ImageMode.DROP_DIR);
      if(!vids.length && f) this._toImageSlot(ImageMode.DROP_DIR, f.images[f.images.length - 1] || '');
    }
    if(vids.length && typeof Movie !== 'undefined'){
      if(!Movie.initialized && GL.gl) Movie.init(GL.gl);
      for(const f of vids) this.storedVideos.push({ url: URL.createObjectURL(f), name: f.name || 'drop' });
      const last = this.storedVideos[this.storedVideos.length - 1];
      App.transitionVideo(last.url, last.name);
      n += vids.length;
    }
    // 次回起動でも復元できるよう IndexedDB へ保存 (容量超過などの失敗はセッション限りに落ちるだけ)
    (async ()=>{
      let saved = true;
      for(const f of list){
        try{ await this._dbPut({ name: f.name || '', kind: this.kindOf(f), blob: f, t: Date.now() }); }
        catch(e){ saved = false; console.warn('media store failed:', f.name, e); }
      }
      toast(n + ' 件を読み込みました' + (saved ? ' (ブラウザに保存。次回起動でも残ります)' : ' (保存失敗: このセッション限り)'));
    })();
    if(typeof UI !== 'undefined'){
      if(vids.length && UI.populatePresets) UI.populatePresets();
      if(UI.refreshAll) UI.refreshAll();
    }
    return n;
  },

  // アクティブスロットを Image モードにして dir / name を表示する
  _toImageSlot(dir, name){
    if(typeof ImageMode === 'undefined') return;
    const slot = GL.slots[App.activeSlot];
    if(!slot || slot.kind !== 'image'){
      const idx = PRESETS.findIndex(p => p.kind === 'image');
      if(idx >= 0) App.loadPreset(idx, App.activeSlot);
    }
    ImageMode.showImage(dir, name);
    App.crossfade = (App.activeSlot === 'A') ? 0 : 1;
  },

  // 要素をドロップ受け皿にする (Visual タブ全体 / Image フォルダグリッド)
  bindDropZone(el){
    if(!el || el.dataset.mediaDrop) return;
    el.dataset.mediaDrop = '1';
    const hasFiles = (e)=>{
      const t = e.dataTransfer;
      return !!(t && t.types && Array.prototype.indexOf.call(t.types, 'Files') >= 0);
    };
    const off = ()=>{ el.style.outline = ''; el.style.outlineOffset = ''; };
    el.addEventListener('dragover', (e)=>{
      if(!hasFiles(e)) return;
      e.preventDefault();
      try{ e.dataTransfer.dropEffect = 'copy'; }catch(_){}
      el.style.outline = '2px dashed var(--acc, #7c4dff)';
      el.style.outlineOffset = '-3px';
    });
    el.addEventListener('dragleave', off);
    el.addEventListener('drop', (e)=>{
      if(!hasFiles(e)) return;
      e.preventDefault();
      off();
      this.accept(e.dataTransfer.files);
    });
  }
};

/* ===================================================================
   GL  — WebGL2 renderer
=================================================================== */
const GL = {
  gl:null, canvas:null,
  vs:null, quadVAO:null, quadBuf:null,
  compositeProg:null,
  audioTex:null,
  bsodTex:null, bsodRows:48,   // BSOD 実テキスト テクスチャ (H29)
  slots:{}, // A,B: {prog, src, errors, params:[], channels:[id|null x4], fbo:[a,b], fbIdx, w,h, ready}
  startTime:0, lastTime:0, frame:0, paused:false,
  clock:0, clockDt:0, _lastReal:0, // speed 反映済みの累積時刻 (App.speed で進む)

  init(){
    this.canvas = $('#glcanvas');
    // powerPreference: ハイブリッドGPU機(Intel内蔵+NVIDIA等)で省電力側の内蔵GPUに割り当てられると
    // 過負荷で context lost (TDR) が頻発するため、必ず高性能側の GPU を要求する。
    const gl = this.canvas.getContext('webgl2', {antialias:false, preserveDrawingBuffer:false, alpha:false, powerPreference:'high-performance'});
    if(!gl){ alert('WebGL2 not available'); return false; }
    this.gl = gl;
    // 実際に使われている GPU 名 (ハイブリッドGPU機で内蔵GPUに割り当てられていないかの診断用)
    try{
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      this.rendererStr = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER) || '');
      console.log('WebGL renderer:', this.rendererStr);
    }catch(_){ this.rendererStr = ''; }
    gl.getExtension('EXT_color_buffer_float');
    // 並列シェーダコンパイル (Windows/ANGLE で同期コンパイルが UI を固める対策)。
    //   対応環境では compileSlot がコンパイルを投げっぱなしにし、tick で完了をポーリングして差し替える。
    this._parallelCompileExt = gl.getExtension('KHR_parallel_shader_compile');
    this._pendingCompiles = [];
    // GPU 実行時間計測 (Chrome=対応 / Safari=非対応→'—'表示)
    this._gpuExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this._gpuInflight = []; this._gpuQ = null; this._gpuMs = 0;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    // fullscreen triangle
    this.quadVAO = gl.createVertexArray();
    this.quadBuf = gl.createBuffer();
    gl.bindVertexArray(this.quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const VS_SRC = `#version 300 es
layout(location=0) in vec2 a;
out vec2 vUv;
void main(){ vUv = a*0.5+0.5; gl_Position = vec4(a,0.,1.); }`;
    this.vs = this._compile(gl.VERTEX_SHADER, VS_SRC);
    // 自己回復: 頂点シェーダ(自明に正当)が失敗したら、並列コンパイル拡張が
    //   同期コンパイルを壊している疑い(Windows/ANGLE)。拡張を無効化して再コンパイルする。
    if((!this.vs || this.vs.err) && this._parallelCompileExt){
      console.warn('VS compile failed with KHR_parallel_shader_compile — disabling it and retrying (Windows/ANGLE workaround)');
      this._parallelCompileExt = null;
      this.vs = this._compile(gl.VERTEX_SHADER, VS_SRC);
    }
    if(!this.vs || this.vs.err){ console.error('Vertex shader compile failed:', this.vs && this.vs.err); this.vs = null; return false; }

    // スロット内トランジション用 mix(旧→新)。
    // style: 0=crossfade 1=blackfade 2=addglow 3=wipeH 4=wipeV
    //        5=Glitch Slide 6=Block Datamosh 7=RGB Split Dissolve 8=Scanline Tear 9=Noise Dissolve 10=Wave Warp
    this._linkDeferred('slotTransProg', `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uPrev, uCur;
uniform float uPhase; uniform int uStyle;
uniform float uTrSeed;          // 転換ごとに引き直す乱数 (0..1)。演出の強さ/パターンをランダム化
float h11(float n){ return fract(sin(n*127.1)*43758.5453); }
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
void main(){
  vec2 uv = vUv;
  vec4 a = texture(uPrev, uv);
  vec4 b = texture(uCur, uv);
  float t = uPhase;
  if(uStyle == 1){ float k=t*2.0; frag=(k<1.0)?vec4(a.rgb*(1.0-k), a.a*(1.0-k)):vec4(b.rgb*(k-1.0), b.a*(k-1.0)); return; }
  if(uStyle == 2){ vec3 base=mix(a.rgb,b.rgb,t); float g=sin(t*3.14159265); float aa=clamp(mix(a.a,b.a,t)+(a.a+b.a)*g*0.6,0.0,1.0); frag=vec4(base+(a.rgb+b.rgb)*g*0.6, aa); return; }
  if(uStyle == 3 || uStyle == 4){ float coord=(uStyle==3)?uv.x:uv.y; float m=t*1.2-0.1; frag=(coord<m)?b:a; return; }

  if(uStyle == 11){                            // Barcode: 行/バーに量子化した引き延ばしへ分解しつつ切替 (中盤で最大)
    // 転換ごとに「かかる量」をランダムに (弱く粗い回 / 全面バーコードになる回 が混ざる)
    float peak = mix(0.35, 1.0, h11(uTrSeed*97.3 + 1.7));
    float bias = mix(0.6, 1.8, h11(uTrSeed*53.9 + 4.3));      // 山の形 (早く効く/遅く効く)
    float amt = pow(sin(t*3.14159265), bias) * peak;
    float unit = max(2.0, mix(220.0, 7.0, amt));
    float iy    = floor((uv.y - 0.5)*unit + 512.0);
    float rowCy = clamp((iy + 0.5 - 512.0)/unit + 0.5, 0.0, 1.0);
    float seed  = iy*13.7 + floor(t*8.0)*7.3 + uTrSeed*311.1;
    float segs  = mix(mix(420.0, 36.0, amt), mix(900.0, 130.0, amt), h11(seed*1.13 + 4.7));
    float wob   = sin(t*9.0 + uv.x*8.0 + iy*3.3) * 0.10 * amt;      // バー模様の横伸縮
    float lq    = floor((uv.x - 0.5)*segs + 512.0);                  // 色はその画素の足元から
    vec2  sp    = vec2(clamp((lq + 0.5 - 512.0)/segs + 0.5, 0.0, 1.0), rowCy);
    vec4  pa = texture(uPrev, sp), pb = texture(uCur, sp);
    float bq = floor((uv.x + wob - 0.5)*segs + 512.0);               // 明暗パターンはワープ側
    float qz = step(0.14, h11(bq*1.31 + seed*2.7));
    float qLev = mix(0.42, 1.55, h11(iy*5.9 + seed*0.31));
    float shade = mix(1.0, mix(qLev, 1.0, qz) * mix(0.78, 1.34, h11(bq*4.3 + seed*0.7)), amt);
    vec4 m = mix(pa, pb, t);
    vec4 plain = mix(a, b, t);
    frag = mix(plain, vec4(m.rgb*shade, m.a), amt);                  // 立ち上がり/終わりは素のクロスフェードへ
    return;
  }

  // ── Glitch 系 (5=Slide ベース / 6..10 テスト) ──
  float g = sin(t*3.14159265);                 // 中盤で最大の強度

  if(uStyle == 5){                             // Glitch Slice: 横スライスがずれながら新へ切替 (Post FX Slice ベース)
    float seed = floor(t*5.0);                 // ずれパターンは進行で変化
    // 可変高さの行を上から積む (Post FX applySlice と同配分: 大 1/4~1/3 / 細 / 中)
    float pos = 0.0, band = 0.0;
    int _gsIt = int(min(48.0, 48.0 + uPhase * 0.0));   // uniform依存の上限で ANGLE の強制ループ展開を抑止
    for(int i = 0; i < _gsIt; i++){
      float fi = float(i);
      float ht = h11(fi*1.7 + seed*3.1 + 0.5);
      float hh;
      if(ht < 0.12)      hh = 0.25 + 0.08*h11(fi*5.0 + seed);    // 大
      else if(ht < 0.30) hh = 0.002 + 0.004*h11(fi*7.0 + seed);  // 細(1-4px相当)
      else               hh = 0.036 + 0.047*h11(fi*9.0 + seed);  // 中
      band = fi;
      if(uv.y < pos + hh) break;
      pos += hh;
    }
    float r    = h21(vec2(band*1.91 + seed, 4.7));               // 行ごとの横シフト乱数
    float act  = step(0.30, h21(vec2(band*2.37 + seed, 9.1)));   // 一部の行だけ動く
    float shift = (r - 0.5) * 0.5 * g * act;                     // 中盤で最大の横ずれ
    vec2 uu = vec2(fract(uv.x + shift), uv.y);
    float thr = h21(vec2(band*0.7 + seed, 2.0));                 // 行ごとの切替閾値
    float rev = step(thr, t);                                    // thr<t で新へ
    vec3 cp = texture(uPrev, uu).rgb;                            // RGB split なし(色味を出さない)
    vec3 cc = texture(uCur,  uu).rgb;
    frag = vec4(mix(cp, cc, rev), mix(a.a, b.a, rev)); return;
  }
  if(uStyle == 9){                             // Noise Dissolve: ハッシュ閾値で溶ける + 境界スパーク
    // 粒は 1px 単位 (Dither Blur と同じ粒度)。固定グリッド(220x124)だと 960x540 で
    // 約 4.4px のブロックになるため、gl_FragCoord をそのまま使う。
    float n = h21(floor(gl_FragCoord.xy));
    float m = step(n, t);
    vec3 c = mix(a.rgb, b.rgb, m) + ((abs(n - t) < 0.04) ? g : 0.0);
    frag = vec4(c, mix(a.a,b.a,m)); return;
  }
  frag = mix(a, b, t);
}`);

    // 軽量フォールバック合成を先に投げる: 本命の巨大 composite の完成(Windows/FXC では数十秒かかりうる)や
    // 失敗に関係なく、こちらが先に上がった時点でステージを描き始められる。本命完成後は自動で切替。
    this._linkDeferred('compositeFallbackProg', COMPOSITE_FALLBACK_FS);
    this._linkDeferred('compositeProg', `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uA, uB;
uniform float uMix;
uniform float uShowA, uShowB;
uniform float uZoomA, uZoomB;   // mode エンジン用 テクスチャズーム (shader は iZoom で処理済のため 1.0)
uniform vec2  uPanA, uPanB;     // mode エンジン用 テクスチャパン
uniform int   uBlendMode;  // 0=mix(crossfade) 1=add 2=multiply 3=screen 4=暗い色(DarkerColor) 5=明るい色(LighterColor) 6=difference 7=overlay
uniform int   uTransStyle; // 切替演出(Mix時): 0=crossfade 1=blackfade 2=addglow 3=wipeH 4=wipeV
uniform float uTime;
uniform float uBeat;       // accumulated beats
uniform float uBeatPhase;  // fract(beat) 0..1
uniform int   uBeatMode;   // 0=drone 1=beat
uniform vec2  uRes;
// post effects
uniform float uGamma, uSat, uHue, uBri, uCon;
uniform float uVig, uChr;
uniform float uAScan, uARgb;  // 音声反応 Post FX 各効果の強度(0..1)
uniform vec3  uFxLineCol;      // Slice/Mondrian/Rings 線色: キャンバスの支配的な鮮やか色相(inkelly方式)
uniform float uFxLineOn;       // 1=色相を採用 / 0=無彩色フォールバック(白黒)
uniform float uAStrobe;   // 0..1 Audio Strobe: アタックで一瞬フラッシュ(発火ごとに白/反転ランダム)
uniform float uAShock;    // 0..1 Kick Shockwave: 拍頭(beat)/アタック(drone)で中心から屈折リング
uniform float uAExplode;  // 0..1 Pixel Explode: 拍/アタックでセルが飛散→吸い戻し
uniform float uSlitScan;  // -1..1 Slit-scan(スクロール型): 符号=向き / |値|=速度(要 uFbTex)
uniform float uSlitBand;  // 走査帯の高さ(=1フレームの走査移動量。JS が実測して供給。隙間防止)
uniform float uSlitFade;  // 0..1 Slit-scan フェード(0にしたときトレイルを流したまま生フレームへ溶かす)
uniform float uSlitDecay; // Slit-scan 前フレーム減衰(<1: 明るいスジが伸びきらず輝度蓄積を防ぐ)
uniform float uEnergy, uOnset; // 音量(平滑) / オンセット(立ち上がり)
uniform float uAttack, uAttackEnv; // スペクトルフラックス由来の短いアタック / 少し長いアタック包絡
uniform float uHit, uHitSeed;  // AR エンベロープ(音中ホールド→減衰, 0..1) / 発火ごとに変わる乱数シード
uniform sampler2D uFFT;        // 音声スペクトル(512x2 LUMINANCE: row0=FFT)
uniform float uPix;       // 0 = off; >0 = block size (px)
uniform int   uMir;       // mirror mode
uniform float uScn, uGrn;
uniform float uTexN;       // テクスチャノイズ強度 (Photoshop の「ノイズを加える」相当)
uniform float uBKeyBlack;  // Slot B が黒背景エンジン(novel 等)のとき、黒をキーして透過(下の A を出す)
uniform float uBKeyWhite;  // Slot B が白背景(ribbon 等)のとき、白をキーして透過(明部→透明 / 暗線→不透明)
uniform int   uPalette;    // 統一パレット: 0=off 1..7=プリセット 8=Slot A 抽出
uniform float uPaletteAmt; // パレット適用量(0=元のまま, 1=完全にパレット化)
uniform vec3  uAutoPal0, uAutoPal1, uAutoPal2, uAutoPal3;  // 抽出元スロット(Auto Map 符号で A/B)の 4 色(暗→明)
uniform float uGradMix;       // グラデーションマップ強度
uniform vec3  uGradStops[8];  // グラデ停止点の色 (最大8)
uniform float uGradPos[8];    // 停止点の位置 (0..1)
uniform int   uGradN;         // 有効な停止点数 (2..8)
uniform float uCosGrad;    // Cos Grad (in-shader 未処理スロット向けの汎用マッピング強度)
uniform int   uCosPalette; // cosineGradient パレット選択 (0=浅葱5/1=Rainbow)
uniform float uHueRot;     // 自動色相ローテートの累積位相 (0..1, JS 側で計算)
uniform float uPos;       // posterize levels (0=off)
uniform float uBlm;
uniform float uUnsharp;       // アンシャープマスク強度 (0=off)
uniform float uUnsharpRadius; // 半径 (px, 4-tap オフセット)
uniform float uInv;
// glitch-style FX (ported from hinotori-vj visual.frag)
uniform float uGlass;     // 0..1 Hipass (旧Glass / Liquid Glass)
uniform float uSlice;     // 0..1
uniform float uSplit;     // 0..1 Split Glitch (グリッドのセルごとにランダム方向へ変位)
uniform float uMosaic;    // 0..1 — block 単位の RGB swap
uniform float uShake;     // 0..1
uniform float uMblur;     // 0..1 (directional motion blur)
uniform float uGain;      // -1..+1 明滅 (拍同期, 0=無効, +=フラッシュ, -=ダーク)
uniform float uVoxel;     // 0..1 ボクセル化 (立方体ピクセル + 擬似3D陰影)
uniform float uRain;      // 0..1 Rain Screen (雨粒で屈折)
uniform float uSketch;    // 0..1 Ballpoint Sketch (青ボールペン・クロスハッチ)
uniform float uRings;     // 0..1 Twisting Rings (同心円リングごとに映像をねじる, CD風可変幅)
uniform float uCandy;     // 0..1 Tunnel (X3jXWh: 映像をトンネル壁にマップ。値=分割数(タイル反復)+ON/OFF)
uniform int   uCandyMode; // Tunnel 2パス: 0=通常 1=前段パス(トンネルのみ描く) 2=本パス(sampleAB がトンネルを土台に返す)
uniform sampler2D uCandyTex; // 前段パスで描いたトンネル
// 画質補完系 (Quality)
uniform float uClarity;   // 0..1 CAS 風の適応シャープ (局所コントラストに応じて輪郭を立てる)
uniform float uDenoise;   // 0..1 エッジ保存平滑 (バイラテラル風。輪郭を残して面のノイズを均す)
uniform float uDeband;    // 0..1 バンディング除去 (グラデ段差を溶かす + 微細ディザ)
uniform float uVibrance;  // -1..1 自然な彩度 (低彩度ほど強く持ち上げ / ハイライト保護。負で控えめに脱色)
uniform int   uGradMask;  // 1=@gradmask シェーダ: grad map をサンプル α でマスク (背景 α=0 は元色のまま)
uniform int   uEmptyAB;   // 1=両スロットが空(なし)。Tex Noise を warp 可能な土台スタティックにする
uniform float uFbAdd;      // 0..1 明るい残像
uniform float uFbMultiply; // 0..1 暗く沈む残像
uniform float uFbZoom;    // -1..1 フィードバックのズーム (正=トンネル状に拡大)
uniform float uFbRot;     // -1..1 フィードバックの回転
uniform float uGlitchTrail; // 0..1 Datamosh トレイル (ctVGWw): 方向性ワープ蓄積グリッチ
uniform sampler2D uFbTex; // 前フレームの最終出力 (Feedback 用)

vec3 hueShift(vec3 c, float h){
  const mat3 toYIQ = mat3(0.299,0.596,0.211,  0.587,-0.274,-0.523,  0.114,-0.322,0.312);
  const mat3 toRGB = mat3(1.0,1.0,1.0,        0.956,-0.272,-1.106,  0.621,-0.647,1.703);
  vec3 yiq = toYIQ * c;
  float a = h * 6.2831853;
  float ca = cos(a), sa = sin(a);
  vec2 iq = yiq.yz;
  yiq.y = ca*iq.x - sa*iq.y;
  yiq.z = sa*iq.x + ca*iq.y;
  return toRGB * yiq;
}
// RGB <-> HSL (invert で明度だけ反転するのに使用。hue/saturation は保持)
vec3 _rgb2hsl(vec3 c){
  float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) * 0.5, h = 0.0, s = 0.0, d = mx - mn;
  if(d > 1e-5){
    s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    if(mx == c.r)      h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if(mx == c.g) h = (c.b - c.r) / d + 2.0;
    else               h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}
float _hue2rgb(float p, float q, float t){
  if(t < 0.0) t += 1.0;
  if(t > 1.0) t -= 1.0;
  if(t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if(t < 0.5)     return q;
  if(t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}
vec3 _hsl2rgb(vec3 hsl){
  float h = hsl.x, s = hsl.y, l = hsl.z;
  if(s <= 1e-5) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(_hue2rgb(p, q, h + 1.0/3.0), _hue2rgb(p, q, h), _hue2rgb(p, q, h - 1.0/3.0));
}
// cosineGradient 共有パレット (perBg 側 palette.frag と同一。回転は uBeat*0.04 で同期)
vec3 cosGradColor(float t){
  t = fract(t + uBeat * 0.04);
  if(uCosPalette == 1){   // Rainbow (classic)
    return vec3(0.55) + vec3(0.45) * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
  }
  // 0: gradient map の "cosine" プリセット (#04001a→#f0eeea) と同一パレット
  vec3 stops[8] = vec3[8](
    vec3(0.016, 0.000, 0.102),   // #04001a
    vec3(0.200, 0.000, 0.820),   // #3300d1
    vec3(0.333, 0.533, 0.667),   // #5588aa
    vec3(0.161, 0.663, 0.690),   // #29a9b0
    vec3(0.667, 0.722, 0.690),   // #aab8b0
    vec3(0.702, 0.933, 0.149),   // #b3ee26
    vec3(1.000, 0.549, 0.478),   // #ff8c7a
    vec3(0.941, 0.933, 0.918)    // #f0eeea
  );
  float u = t * 8.0;
  int i = int(floor(u));
  float f = smoothstep(0.0, 1.0, fract(u));
  return mix(stops[i % 8], stops[(i + 1) % 8], f);
}
float rnd(vec2 p){return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453);}
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }  // 無相関ハッシュ(斜め縞が出ない)

vec2 applyMirror(vec2 uv, int mode){
  if(mode==1){ // horizontal
    uv.x = abs(uv.x - 0.5)*1.0 + 0.5; // not folding, just fold from center
    uv.x = 0.5 + abs(uv.x - 0.5);
  } else if(mode==2){
    uv.y = 0.5 + abs(uv.y - 0.5);
  } else if(mode==3){
    uv = vec2(0.5) + abs(uv - 0.5);
  } else if(mode>=4){
    // kaleido
    float seg = (mode==4) ? 3.0 : (mode==5) ? 4.0 : (mode==6) ? 6.0 : 8.0;
    vec2 p = uv - 0.5;
    float a = atan(p.y, p.x);
    float r = length(p);
    float s = 3.14159265/seg;
    a = mod(a, 2.0*s);
    a = abs(a - s);
    uv = vec2(cos(a), sin(a)) * r + 0.5;
  }
  return uv;
}

vec3 _blendOverlay(vec3 a, vec3 b){
  return mix(2.0*a*b, 1.0 - 2.0*(1.0-a)*(1.0-b), step(0.5, a));
}
// Auto Map のパレット再彩色 (適用先は sampleAB で uPaletteAmt の符号により切替)
vec3 fl_applyPalette(vec3 c){
  if(uPalette == 0 || abs(uPaletteAmt) < 0.0001) return c;
  float L = clamp(dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float sat = mx > 1e-4 ? (mx - mn) / mx : 0.0;
  float hue = 0.0;
  if(mx - mn > 1e-4){
    if(mx == c.r)      hue = fract((c.g - c.b) / (mx - mn) / 6.0);
    else if(mx == c.g) hue = ((c.b - c.r) / (mx - mn) + 2.0) / 6.0;
    else               hue = ((c.r - c.g) / (mx - mn) + 4.0) / 6.0;
    hue = fract(hue);
  }
  vec3 p0, p1, p2, p3;
  if(uPalette == 1){      p0=vec3(0.07,0.03,0.16); p1=vec3(0.78,0.12,0.45); p2=vec3(0.02,0.82,0.90); p3=vec3(0.85,0.97,1.0); }
  else if(uPalette == 2){ p0=vec3(0.05,0.03,0.01); p1=vec3(0.36,0.22,0.10); p2=vec3(0.78,0.60,0.36); p3=vec3(1.0,0.94,0.82); }
  else if(uPalette == 3){ p0=vec3(0.02,0.0,0.06);  p1=vec3(0.85,0.05,0.55); p2=vec3(0.95,0.85,0.10); p3=vec3(0.10,0.95,0.95); }
  else if(uPalette == 4){ p0=vec3(0.0);            p1=vec3(0.33);           p2=vec3(0.7);            p3=vec3(1.0); }
  else if(uPalette == 5){ p0=vec3(0.0);            p1=vec3(0.65,0.05,0.0);  p2=vec3(1.0,0.55,0.0);   p3=vec3(1.0,1.0,0.85); }
  else if(uPalette == 6){ p0=vec3(0.0,0.02,0.10);  p1=vec3(0.0,0.35,0.7);   p2=vec3(0.35,0.85,1.0);  p3=vec3(0.92,1.0,1.0); }
  else if(uPalette == 7){ p0=vec3(0.16,0.66,0.69); p1=vec3(0.20,0.0,0.82);  p2=vec3(1.0,0.55,0.48);  p3=vec3(0.70,0.93,0.15); }
  else {                  p0=uAutoPal0; p1=uAutoPal1; p2=uAutoPal2; p3=uAutoPal3; }
  float t = (uPalette == 8) ? L : mix(L, hue, smoothstep(0.06, 0.35, sat));
  vec3 pc = t<0.333 ? mix(p0,p1,t/0.333) : t<0.666 ? mix(p1,p2,(t-0.333)/0.333) : mix(p2,p3,(t-0.666)/0.334);
  pc *= 0.45 + 1.10*L;
  return mix(c, clamp(pc, 0.0, 1.0), abs(uPaletteAmt));
}
// Grad Map (輝度 → 多色グラデーション)。中央0/負値で反転。スロット単位で適用するため関数化。
vec3 _gradMap(vec3 c){
  float L = dot(c, vec3(0.299, 0.587, 0.114));
  float t_g = clamp(uGradMix >= 0.0 ? L : 1.0 - L, 0.0, 1.0);
  vec3 mapped = uGradStops[0];
  for(int i = 0; i < 7; i++){
    if(i < uGradN - 1){
      float p0 = uGradPos[i], p1 = uGradPos[i+1];
      if(t_g >= p0){ float f = clamp((t_g - p0) / max(p1 - p0, 0.0001), 0.0, 1.0); mapped = mix(uGradStops[i], uGradStops[i+1], f); }
    }
  }
  return mix(c, mapped, abs(uGradMix));
}
// 空スロット用の土台スタティック。value noise(補間ノイズ)なので低周波の構造を持ち、
// UV warp(twist/mondrian/audio 等)で視覚的に歪む = glitch/Audio FX が効く。
float _bnH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float _bnV(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
  return mix(mix(_bnH(i), _bnH(i+vec2(1.0,0.0)), f.x),
             mix(_bnH(i+vec2(0.0,1.0)), _bnH(i+vec2(1.0,1.0)), f.x), f.y);
}
vec3 _baseNoise(vec2 uv){
  float asp = uRes.x / max(uRes.y, 1.0);
  vec2 p = vec2(uv.x*asp, uv.y) * 300.0;      // セル密度(warp が効く程度の粒)
  float t = floor(uTime * 20.0);              // パラパラ(離散フレーム)
  // シード: +t の平行移動だと横に流れて見える。ティックごとに無相関な大オフセットへ
  // ジャンプさせ、TV 砂嵐のようにフレーム毎へ浮かぶホワイトノイズにする。
  vec2 seed = vec2(fract(sin(t*127.1 + 1.7)*43758.5453),
                   fract(sin(t*311.7 + 9.2)*43758.5453)) * 1000.0;
  // グレースケール: RGB に別々の値を入れるとカラーノイズになるので 1 つの値を全チャンネルへ
  return vec3(_bnV(p + seed));
}
vec4 _slotVisMix(vec4 ca, vec4 cb, vec4 both, float showA, float showB){
  float a = clamp(showA, 0.0, 1.0);
  float b = clamp(showB, 0.0, 1.0);
  float wBoth = a * b;
  float wA = a * (1.0 - b);
  float wB = b * (1.0 - a);
  float wNone = (1.0 - a) * (1.0 - b);
  return both*wBoth + ca*wA + cb*wB + vec4(0.0, 0.0, 0.0, 1.0)*wNone;
}
// ズームアウト/パンで領域外に出た分は上下左右ミラーでタイル化 (映像がミラー状に繋がる)。範囲内(ズームイン/等倍)は恒等。
vec2 fl_mirror(vec2 p){ return 1.0 - abs(mod(p, 2.0) - 1.0); }
vec4 sampleAB(vec2 uv){
  vec4 ca = texture(uA, fl_mirror((uv - 0.5) / uZoomA + 0.5 - uPanA));   // mode エンジンの user zoom/pan (領域外はミラー)
  vec4 cb = texture(uB, fl_mirror((uv - 0.5) / uZoomB + 0.5 - uPanB));
  float showA = clamp(uShowA, 0.0, 1.0);
  float showB = clamp(uShowB, 0.0, 1.0);
  // 両スロットが空: Tex Noise を「warp 可能な土台スタティック」に (Twist/Mondrian/Audio FX を効かせる)。
  if(showA > 0.001 && uEmptyAB == 1 && abs(uTexN) > 0.001){
    ca.rgb = mix(ca.rgb, _baseNoise(uv), clamp(abs(uTexN), 0.0, 1.0));
    ca.a = 1.0;
  }
  // Auto Map: 正 = B を A のパレットへ / 負 = A を B のパレットへ (抽出元は JS 側で符号に応じて切替)
  if(showB > 0.001 && uPaletteAmt > 0.0001)  cb.rgb = fl_applyPalette(cb.rgb);
  if(showA > 0.001 && uPaletteAmt < -0.0001) ca.rgb = fl_applyPalette(ca.rgb);
  // Grad Map は合成・INVERT の後(色補正段)でまとめて適用する(sampleAB では適用しない)。
  if(showB > 0.001 && uBKeyBlack > 0.5){ float kl = smoothstep(0.03, 0.16, dot(cb.rgb, vec3(0.299,0.587,0.114))); cb.a = min(cb.a, kl); }  // 黒背景キー: novel 等を Slot B で透過(暗部→透明 / 文字→不透明)
  if(showB > 0.001 && uBKeyWhite > 0.5){ float kw = 1.0 - smoothstep(0.84, 0.97, dot(cb.rgb, vec3(0.299,0.587,0.114))); cb.a = min(cb.a, kw); }  // 白背景キー: ribbon 等を Slot B で透過(明部→透明 / 暗線→不透明)
  vec4 both;
  // Slot B が透過シェーダ(実アルファ<1)なら、チェック不要で自動的に A の上へ合成する。
  // 不透明な内容(cb.a==1)は下の通常クロスフェード/ブレンドへ。背景が透明な箇所は
  // 単独表示ならキャンバスの黒で黒く見え(暫定的に黒)、B では下の A が透ける。
  if(cb.a < 0.999){
    float la = clamp(cb.a, 0.0, 1.0) * uMix;
    both = vec4(mix(ca.rgb, cb.rgb, la), max(ca.a, la));
  } else if(uBlendMode == 0){
    if(uTransStyle == 1){                 // 黒フェード(一度暗転してから次を出す)
      float k = uMix*2.0;
      vec3 c = (k < 1.0) ? ca.rgb*(1.0-k) : cb.rgb*(k-1.0);
      both = vec4(c, max(ca.a, cb.a));
    } else if(uTransStyle == 2){          // 加算グロー(切替の最中だけ光って混ざる)
      vec3 base = mix(ca.rgb, cb.rgb, uMix);
      float g = sin(uMix*3.14159265);
      both = vec4(base + (ca.rgb + cb.rgb)*g*0.6, max(ca.a, cb.a));
    } else if(uTransStyle == 3 || uTransStyle == 4){   // ワイプ(3=左右, 4=上下)。glitch系(>=5)は切替演出(slotTransProg)側で処理し、ここはクロスフェード
      float coord = (uTransStyle == 3) ? vUv.x : vUv.y;
      float m = uMix*1.2 - 0.1;           // uMix=0/1 で完全 A/B になるよう端を伸ばす
      float e = step(m, coord);           // ハードエッジ(境界をぼかさない)
      both = mix(cb, ca, e);              // coord<m 側が B、反対が A
    } else {
      both = mix(ca, cb, uMix);           // 0=クロスフェード/ディゾルブ
    }
  } else {
    vec3 res;
    if(uBlendMode == 1)      res = ca.rgb + cb.rgb;                       // add
    else if(uBlendMode == 2) res = ca.rgb * cb.rgb;                       // multiply
    else if(uBlendMode == 3) res = 1.0 - (1.0-ca.rgb)*(1.0-cb.rgb);       // screen
    else if(uBlendMode == 4) res = (dot(ca.rgb, vec3(0.299,0.587,0.114)) <= dot(cb.rgb, vec3(0.299,0.587,0.114))) ? ca.rgb : cb.rgb;  // 暗い色 Darker Color (明度比較で暗い方の色をまるごと)
    else if(uBlendMode == 5) res = (dot(ca.rgb, vec3(0.299,0.587,0.114)) >= dot(cb.rgb, vec3(0.299,0.587,0.114))) ? ca.rgb : cb.rgb;  // 明るい色 Lighter Color
    else if(uBlendMode == 6) res = abs(ca.rgb - cb.rgb);                  // difference
    else if(uBlendMode == 7) res = _blendOverlay(ca.rgb, cb.rgb);         // overlay
    else                     res = mix(ca.rgb, cb.rgb, uMix);
    // uMix を blend 強度として作用 (0=A のまま, 1=blend 結果, 中間で線形補間)
    res = mix(ca.rgb, res, uMix);
    both = vec4(res, max(ca.a, cb.a));
  }
  vec4 abRes = _slotVisMix(ca, cb, both, showA, showB);
  // Tunnel 本パス: 前段パスで描いたトンネルを土台として返す。
  // 以降の全 FX (Hipass/Outline/ブラー等) が sampleAB を再サンプルしてもトンネルが対象になり、元映像が透けない。
  if(uCandyMode == 2){
    abRes = vec4(texture(uCandyTex, fl_mirror(uv)).rgb, 1.0);
  }
  return abRes;
}

// hash helpers (lightweight, used by glitch FX)
float h11(float x){ x = fract(x*0.1031); x *= x+33.33; x *= x+x; return fract(x); }
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }

// Twist は後段の独立パス (_applyTwistPost) へ移設。

// === Split glitch (Shadertoy "split glitch effect" wfcfRB 移植) ===
// グリッドごとに fbm 的ハッシュで UV をブロック状にずらす。uSlice で強度、拍で脈動。
float sg_f(vec2 uv){
  float c = 0.0;
  for(int k=0; k<8; k++){
    c = fract(uv.x + c*(-38.0) + sin(uv.y*62.0 + c*36.0) + c*uv.x*0.2);
  }
  return c;
}
vec2 applySlice(vec2 uv){
  float beatHit = (uBeatMode == 1) ? pow(1.0 - uBeatPhase, 1.5) : 0.0;   // 拍頭で強く→拍内で減衰 (beat モード時のみ)
  float str = uSlice * max(uHit, beatHit);      // 音 or 拍で駆動
  if(str <= 0.001) return uv;
  float seed = floor(uBeat);            // 行のパターンは拍ごとに変化
  // 上から可変高さの行を積む: 大(画面1/4~1/3)が1-2個 / 中くらい多め / 1-4px の細行を散り散り。
  float yPx = uv.y * uRes.y;
  float pos = 0.0, band = 0.0;
  int _slIt = int(min(48.0, 48.0 + uRes.x * 0.0));   // uniform依存の上限で ANGLE(D3D11) の強制ループ展開を抑止 (コンパイル爆発→TDR対策)
  for(int i = 0; i < _slIt; i++){
    float fi = float(i);
    float t = h11(fi*1.7 + seed*3.1 + 0.5);
    float h;
    if(t < 0.12)      h = uRes.y * (0.25 + 0.08*h11(fi*5.0 + seed));  // 大: 画面1/4~1/3
    else if(t < 0.30) h = 1.0 + 3.0*h11(fi*7.0 + seed);              // 細: 1-4px(アクセント)
    else              h = 26.0 + 34.0*h11(fi*9.0 + seed);            // 中: 26-60px
    band = fi;
    if(yPx < pos + h) break;
    pos += h;
  }
  float r = sg_f(vec2(band*1.91 + seed, 4.7));              // 行ごとの横シフト乱数
  float act = step(0.30, sg_f(vec2(band*2.37 + seed, 9.1)));// 一部の行だけ動く
  float shift = (r - 0.5) * str * 0.45 * act;
  return uv + vec2(shift, 0.0);
}

// === Split Glitch (Shadertoy "split glitch effect" wfcfRB) ===
// グリッドのセルごとにカオス値を出し、各セルをランダム方向へ変位。uSplit で強度・音/拍で増幅。
vec2 applySplit(vec2 uv){
  float beatHit = (uBeatMode == 1) ? pow(1.0 - uBeatPhase, 1.5) : 0.0;
  float str = uSplit * (0.30 + 1.2*max(uHit, beatHit));   // 値 + 音/拍で増幅
  if(str <= 0.001) return uv;
  float fine = clamp(uSplit, 0.0, 1.0);
  float splitCurve = pow(smoothstep(0.42, 0.98, fine), 1.70);
  float amount = str * 0.14 * mix(0.025, 1.0, splitCurve);  // 中間までは控えめ、高値側で指数的に拡大
  // 拍(beat)の切り替わりで分割パターンを初期化。ふだんは uTime でごくゆるやかに動く。
  float bN = (uBeatMode == 1) ? floor(uBeat) : 0.0;       // beat モード時は拍番号、drone は固定
  vec2 BS = vec2(bN*1.73, bN*2.31);                       // 拍ごとに変わるシードオフセット
  // モンドリアン状に再帰分割。比例分割で大小の面ができ、小さい面ほど変位する。
  // 値が大きいほど分割を深く続けて「細かいパーツ」を増やす(大面は一部残す)。
  vec2 lo = vec2(0.0), hi = vec2(1.0);
  float id = 1.0;
  int _spIt = int(min(12.0, 12.0 + uRes.x * 0.0));   // ループ展開抑止
  for(int i = 0; i < _spIt; i++){
    vec2 sz = hi - lo;
    float ar = sz.x * sz.y;
    if(ar < 0.0015) break;                                // より小さい面まで分割可(細かいパーツ)
    float r = sg_f(lo*11.3 + hi*7.1 + id*0.37 + BS);
    // モンドリアン構図: 大きな面を 1-2 個ドンと残し、縁に帯や小矩形が集まるよう
    // 大セルはかなり残りやすく、小セルもほどほどで止める(細かくなり過ぎない)
    if(i >= 1){ float pStop = (ar > 0.14) ? mix(0.78, 0.60, fine) : mix(0.30, 0.08, fine); if(r < pStop) break; }
    // 分割位置: 中央二分割を避けて端寄りの非対称比 (0.20-0.38 / 0.62-0.80)。
    // 約 18% は極端な位置 (0.10-0.18) で「細い帯」を切り出す(モンドリアンの縁の帯)
    float tr = sg_f(lo*5.7 + hi*9.3 + id*0.71 + 2.0 + BS);
    float bandR = sg_f(lo*2.9 + hi*4.3 + id*1.13 + 5.0 + BS);
    float tBase;
    // 細帯は低い側(左/下)だけでなく高い側(右/上)からも 50/50 で切る (左寄り偏りの修正)
    if(bandR < 0.18){     tBase = 0.10 + 0.08*tr; if(bandR >= 0.11) tBase = 1.0 - tBase; }   // 閾値 0.11 = 実測で左右均衡
    else if(tr < 0.5)     tBase = 0.20 + 0.36*tr;
    else                  tBase = 0.62 + 0.36*(tr - 0.5);
    float t = clamp(tBase + 0.03*sin(uTime*0.03 + sg_f(vec2(id*1.7, id*2.1)+BS)*6.2831), 0.07, 0.93);
    // 主に長辺を割る(正方形寄り)が、約25%は短辺を割る → 縦長・横長の矩形ができる
    bool wide = sz.x > sz.y;
    float axr = sg_f(lo*3.7 + hi*8.1 + id*0.5 + BS);
    bool splitX = wide ? (axr < 0.75) : (axr < 0.25);
    if(splitX){
      float sx = mix(lo.x, hi.x, t);
      if(uv.x < sx){ hi.x = sx; id = id*2.0 + 1.0; } else { lo.x = sx; id = id*2.0 + 2.0; }
    } else {
      float sy = mix(lo.y, hi.y, t);
      if(uv.y < sy){ hi.y = sy; id = id*2.0 + 1.0; } else { lo.y = sy; id = id*2.0 + 2.0; }
    }
  }
  // 大きな面ほど動きにくい。「動く面/動かない面」を時間でごくゆっくり入れ替える
  vec2 csz = hi - lo;
  float area = csz.x * csz.y;
  float ph = sg_f(lo*3.1 + hi*5.7 + id*0.91 + BS) * 6.2831;
  float activate = smoothstep(0.3, 0.8, 0.5 + 0.5*sin(uTime*0.06 + ph));   // ゆるやかに動く⇄止まる
  // 縦長・横長・正方形・行/列をまたぐ結合セル、すべて変位対象。小片はよく動き、大矩形は控えめに動く。
  float moveRnd = step(0.35, sg_f(lo*23.1 + hi*5.9 + id*1.7 + BS));    // 一部のセルだけ動く(大小・位置のばらつき)
  float sizeFall = mix(0.5, 1.0, 1.0 - smoothstep(0.01, 0.4, area));   // 小片はよく動く / 大矩形は控えめに動く
  float sizeAmt = moveRnd * sizeFall * activate;
  float c = sg_f(lo*17.0 + hi*3.3 + id*0.53 + BS);        // 矩形ごとの変位方向
  float ang = c*6.2831 + uTime*0.05;                      // 方向をごくゆっくり回す
  vec2 disp = vec2(cos(ang), sin(ang)) * amount * sizeAmt;
  // ジャンプ: 値が大きいほど多くのセルが「元画像の別の場所」を表示する (取り出し座標を大きくずらす)。
  // floor(uTime*1.7) 刻みで取り出し位置が切り替わり、パチパチとジャンプする。
  float jt = floor(uTime * 1.7);
  float jr = sg_f(lo*29.3 + hi*13.7 + id*2.3 + jt*0.61 + BS);
  float jGate = step(1.0 - 0.7*fine*fine, jr);
  vec2 jv = vec2(sg_f(lo*7.7 + id*3.1 + jt*1.3 + BS),
                 sg_f(hi*9.1 + id*4.7 + jt*2.1 + 3.0 + BS)) - 0.5;
  disp += jv * jGate * (0.2 + 0.8*fine) * (0.4 + 0.6*sizeAmt) * max(0.025, splitCurve);
  return uv + disp;
}

// === Beat-driven screen shake ===
vec2 applyShake(vec2 uv){
  float str = uShake * uHit;               // Audio FX: 値 × 強い音の発火エンベロープ
  if(str <= 0.001) return uv;
  float sx = (h11(uHitSeed*53.1) - 0.5);   // 発火ごとにシェイク方向をランダム
  float sy = (h11(uHitSeed*97.7 + 7.13) - 0.5);
  return uv + vec2(sx, sy) * str * 0.06;
}
// === Twisting Rings (Audio FX) ===
//   同心円リングごとに映像を回転=ねじる。リング幅は CD のように非等間隔で時間変化(最小~2px)。
vec2 applyRings(vec2 uv){
  float rExp = (exp2(4.0*clamp(uRings, 0.0, 1.0)) - 1.0) / 15.0;   // 指数カーブ: 低値で弱く高値で一気に
  float audioSpin = 4.8*pow(clamp(uHit,0.0,1.0),0.62)
                  + 1.8*pow(clamp(uAttack,0.0,1.0),0.72);
  float amt = rExp * (0.72 + audioSpin);        // 通常回転を保ち、Audioヒットでは大きくねじる
  if(amt <= 0.001) return uv;
  float fine = clamp(uRings, 0.0, 1.0);        // 本数はパラメータに対して線形に増やす
  float aspect = uRes.x / uRes.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float rPx = length(c) * uRes.y;              // 中心からの半径(px)
  // 全体は本数少なめ(疎・幅広)に保つ
  float freq = mix(0.0004, 0.0026, fine);       // 線と分割を約1/10にして広いリングに
  float warpAmp = mix(0.5, 2.0, fine);
  float warp = warpAmp*sin(rPx*0.011 + uTime*0.6) + 0.55*warpAmp*sin(rPx*0.019 - uTime*0.4);
  // 局所的な高周波リングは使わず、パラメータで決まる少数のリングだけにする。
  float ringId = floor(rPx*freq + warp);
  // リングごとに異なる回転量(有界) → 同心円がバラバラにねじれる
  float twist = 0.6*sin(ringId*0.7) + 0.4*sin(ringId*1.9 + 1.3);
  float ang = twist * amt * 2.2;               // 回転量アップ
  float s = sin(ang), co = cos(ang);
  vec2 cc = uv - 0.5;
  cc = mat2(co, -s, s, co) * cc;
  return cc + 0.5;
}

// Slice / Mondrian / Rings の境界線マスク。線自体は main の色に合わせて白黒を決める。
float sliceEdgeMask(vec2 uv){
  float beatHit = (uBeatMode == 1) ? pow(1.0 - uBeatPhase, 1.5) : 0.0;
  float str = uSlice * max(uHit, beatHit);
  if(str <= 0.001) return 0.0;
  float yPx = uv.y * uRes.y, pos = 0.0, bandH = 0.0;
  float seed = floor(uBeat);
  int it = int(min(48.0, 48.0 + uRes.x * 0.0));
  for(int i=0;i<it;i++){
    float fi = float(i), t = h11(fi*1.7 + seed*3.1 + 0.5), h;
    if(t < 0.12) h = uRes.y * (0.25 + 0.08*h11(fi*5.0 + seed));
    else if(t < 0.30) h = 1.0 + 3.0*h11(fi*7.0 + seed);
    else h = 26.0 + 34.0*h11(fi*9.0 + seed);
    bandH = h;
    if(yPx < pos + h) break;
    pos += h;
  }
  float localY = clamp((yPx - pos) / max(bandH, 0.0001), 0.0, 1.0);
  float dTop = (pos > 0.5) ? localY : 1.0;
  float dBottom = (pos + bandH < uRes.y - 0.5) ? (1.0 - localY) : 1.0;
  float edgeDist = min(dTop, dBottom);
  // 微分値ではなく帯の実ピクセル高さから算出。境界位置によらず必ず1px分を拾う。
  // 境界の両側を拾わないよう、中心から0.5px相当だけを線にする。
  float lineW = 0.5 / max(bandH * uRes.y, 1.0);
  return step(edgeDist, lineW);
}

float splitEdgeMask(vec2 uv){
  if(uSplit <= 0.001) return 0.0;
  float bN = (uBeatMode == 1) ? floor(uBeat) : 0.0;
  vec2 BS = vec2(bN*1.73, bN*2.31);
  float fine = clamp(uSplit, 0.0, 1.0);
  vec2 lo = vec2(0.0), hi = vec2(1.0);
  float id = 1.0;
  int it = int(min(12.0, 12.0 + uRes.x * 0.0));
  for(int i=0;i<it;i++){
    vec2 sz = hi - lo;
    float ar = sz.x * sz.y;
    if(ar < 0.0015) break;
    float r = sg_f(lo*11.3 + hi*7.1 + id*0.37 + BS);
    if(i >= 1){ float pStop = (ar > 0.14) ? mix(0.78, 0.60, fine) : mix(0.30, 0.08, fine); if(r < pStop) break; }
    float tr = sg_f(lo*5.7 + hi*9.3 + id*0.71 + 2.0 + BS);
    float bandR = sg_f(lo*2.9 + hi*4.3 + id*1.13 + 5.0 + BS);
    float tBase = (bandR < 0.18) ? ((bandR >= 0.11) ? 0.90 - 0.08*tr : 0.10 + 0.08*tr)
                 : ((tr < 0.5) ? 0.20 + 0.36*tr : 0.62 + 0.36*(tr - 0.5));   // 細帯は左右 50/50 (applySplit と同一ロジック必須)
    float t = clamp(tBase + 0.03*sin(uTime*0.03 + sg_f(vec2(id*1.7, id*2.1)+BS)*6.2831), 0.07, 0.93);
    bool wide = sz.x > sz.y;
    float axr = sg_f(lo*3.7 + hi*8.1 + id*0.5 + BS);
    bool splitX = wide ? (axr < 0.75) : (axr < 0.25);
    if(splitX){ float sx=mix(lo.x,hi.x,t); if(uv.x<sx){hi.x=sx;id=id*2.0+1.0;}else{lo.x=sx;id=id*2.0+2.0;} }
    else { float sy=mix(lo.y,hi.y,t); if(uv.y<sy){hi.y=sy;id=id*2.0+1.0;}else{lo.y=sy;id=id*2.0+2.0;} }
  }
  float dx = 1.0, dy = 1.0;
  if(lo.x > 0.002) dx = min(dx, abs(uv.x-lo.x));
  if(hi.x < 0.998) dx = min(dx, abs(hi.x-uv.x));
  if(lo.y > 0.002) dy = min(dy, abs(uv.y-lo.y));
  if(hi.y < 0.998) dy = min(dy, abs(hi.y-uv.y));
  // x/yそれぞれの0.5px範囲だけを拾い、AA由来の太りを避ける。
  float lineX = 0.5 / max(uRes.x, 1.0);
  float lineY = 0.5 / max(uRes.y, 1.0);
  return max(step(dx, lineX), step(dy, lineY));
}

float ringsEdgeMask(vec2 uv){
  if(uRings <= 0.001) return 0.0;
  float rExp = (exp2(4.0*clamp(uRings, 0.0, 1.0)) - 1.0) / 15.0;
  float amt = rExp * 0.72;
  if(amt <= 0.001) return 0.0;
  float fine = clamp(uRings, 0.0, 1.0), aspect = uRes.x/uRes.y;
  float rPx = length((uv-0.5)*vec2(aspect,1.0))*uRes.y;
  float freq = mix(0.0004,0.0026,fine), warpAmp = mix(0.5,2.0,fine);
  float warp = warpAmp*sin(rPx*0.011+uTime*0.6) + 0.55*warpAmp*sin(rPx*0.019-uTime*0.4);
  float ringCoord = rPx*freq + warp;
  float edgeDist = min(fract(ringCoord), 1.0-fract(ringCoord));
  // fwidthは境界の両側を含むため、半分にして実線幅を約1pxに固定。
  float lineW = max(0.00005, 0.5 * fwidth(ringCoord));
  return step(edgeDist, lineW);
}

// 音声反応 Post FX(個別): Scanline を強度で適用。RGB色収差は main 側。
vec2 applyAudioFX(vec2 uv){
  if(uAScan > 0.001){                                          // 走査線ずらし: オンセットで行ブロック横ずれ
    float band = floor(uv.y*48.0);
    float j = fract(sin(band*12.9898 + floor(uTime*10.0)*7.13)*43758.5453);
    uv.x += (j-0.5) * max(uOnset, uAttack) * uAScan * 0.6 * step(0.55, j);
  }
  // Kick Shockwave: 拍頭(beat) / アタック(drone) で中心から屈折の衝撃波リングが広がる
  if(uAShock > 0.001){
    float ph = (uBeatMode == 1) ? uBeatPhase : clamp(1.0 - uHit, 0.0, 1.0);
    float asp = uRes.x / uRes.y;
    vec2 q = (uv - 0.5) * vec2(asp, 1.0);
    float r = length(q);
    float band2 = r - ph * 0.85;                              // 広がるリングとの距離
    vec2 disp = (q / max(r, 1e-4)) * band2 * exp(-band2*band2*140.0)
              * (uAShock * 1.6 * (1.0 - ph));                 // リング縁で屈折・進むほど減衰
    disp.x /= asp;
    uv -= disp;
  }
  // Pixel Explode: 拍頭(beat) / アタック(drone) でセルが粒子状に飛散 → 吸い戻される
  if(uAExplode > 0.001){
    float pulse = (uBeatMode == 1) ? pow(1.0 - uBeatPhase, 2.2) : uHit * uHit;
    if(pulse > 0.004){
      float sd = (uBeatMode == 1) ? floor(uBeat) : floor(uHitSeed * 97.0);  // 発火ごとに飛散パターン変更
      float cellPx = max(1.0, mix(40.0, 1.0, clamp(uAExplode, 0.0, 1.0)));  // 値大ほど粒を細かく(最終1px単位)
      vec2 cell = floor(uv * uRes / cellPx);
      vec2 dirc = vec2(rnd(cell + sd*13.7), rnd(cell + 71.3 + sd*7.7)) - 0.5;
      float spd = 0.35 + rnd(cell + 5.1 + sd);
      uv -= dirc * pulse * spd * uAExplode * 0.45;
    }
  }
  return uv;
}

// Hipass 用の素直なガウスぼかし。固定リングを避けるため半径を軽く崩し、内側を埋めてもや状にする。
vec3 sampleGaussClean(vec2 uv, float radPx){
  int N = int(min(72.0, 72.0 + uRes.x * 0.0));   // ループ展開抑止 (sampleAB が72回インライン展開されるのを防ぐ = FXC爆発の筆頭)
  const float GA = 2.39996323;
  vec2 rad = radPx / uRes;
  float centerW = mix(1.0, 0.035, smoothstep(6.0, 72.0, radPx));
  float falloff = mix(4.8, 2.85, smoothstep(18.0, 260.0, radPx));
  float fill = smoothstep(5.0, 42.0, radPx);
  float haze = smoothstep(28.0, 180.0, radPx);
  vec3 acc = sampleAB(uv).rgb * centerW;
  float wsum = centerW;
  for(int i=0; i<N; i++){
    float ji = fract(sin((float(i) + 1.0) * 91.171) * 43758.5453);
    float fi = clamp((float(i) + 0.5 + (ji - 0.5) * 0.72) / float(N), 0.0, 1.0);
    float r  = sqrt(fi);
    float a  = float(i) * GA + 0.78539816;
    vec2 off = vec2(cos(a), sin(a)) * r * rad;
    float wt = exp(-falloff * fi);
    wt *= 1.0 - 0.42 * haze * smoothstep(0.70, 1.0, fi);
    acc += sampleAB(uv + off).rgb * wt;
    wsum += wt;
    if(fill > 0.001){
      float wi = wt * fill * (0.58 + 0.18*haze);
      float wj = wt * fill * haze * 0.38;
      float s1 = 0.35 + 0.38 * fract(ji * 1.6180339);
      float s2 = 0.14 + 0.34 * fract(ji * 2.4142136);
      vec2 bend = vec2(-off.y, off.x) * (0.10 + 0.18 * fract(ji * 3.113));
      acc += sampleAB(uv + off * s1).rgb * wi;
      acc += sampleAB(uv + off * s2 + bend).rgb * wj;
      wsum += wi;
      wsum += wj;
    }
  }
  return acc / wsum;
}

vec3 hipassSuppressYellow(vec3 c, float amt){
  vec3 lumaW = vec3(0.299, 0.587, 0.114);
  float hi = max(c.r, max(c.g, c.b));
  float lo = min(c.r, min(c.g, c.b));
  float sat = hi - lo;
  float yellow = smoothstep(0.018, 0.16, min(c.r, c.g) - c.b)
               * smoothstep(0.045, 0.24, sat)
               * smoothstep(0.18, 0.82, max(c.r, c.g));
  float lime = smoothstep(0.018, 0.18, c.g - max(c.r, c.b) * 0.78)
             * smoothstep(0.04, 0.22, c.g - c.b)
             * smoothstep(0.045, 0.24, sat);
  float mask = clamp(max(yellow, lime), 0.0, 1.0);
  float l = dot(c, lumaW);
  vec3 neutral = vec3(l);
  return mix(c, neutral, mask * amt);
}

vec4 sampleAB_mblur(vec2 uv){
  if(uMblur <= 0.001) return sampleAB(uv);
  float ang = h11(floor((uBeatMode == 1) ? uBeat*0.5 : uTime*0.25)) * 6.2831;
  vec2 dir = vec2(cos(ang), sin(ang));
  float pulse = (uBeatMode == 1) ? pow(sin(uBeatPhase * 3.14159), 1.0) : 0.7;
  float amp = uMblur * 0.04 * pulse;
  vec4 acc = vec4(0.0);
  int _mbIt = int(min(3.0, 3.0 + uRes.x * 0.0));   // ループ展開抑止
  for(int i=-_mbIt;i<=_mbIt;i++){
    acc += sampleAB(uv + dir * float(i) * amp * 0.142857);
  }
  return acc / 7.0;
}

// =============================================================
// Voxel Pillars  (ref: Shadertoy s3XGWH "Voxel Pillars webcam Y28"
//   by Yusef28, CC BY-NC-SA). 3D レイマーチでセル毎の角柱を立て、
//   高さ=画像の輝度, 側面/上面=ピクセル色。中央=消失点で手前に飛び出す。
//   webcam テクスチャの代わりに sampleAB を高さ&色マップとして使用。
// =============================================================
float vxCW;                                 // 1セルのワールド幅
float vxAmp;                                // 輝度→高さ係数(柱の高さ)
float vxSpan;                               // 画面高さに対応するワールド幅(オルソ原寸の基準)
float vxAspect;                             // uRes.x / uRes.y
const float VXBASE = -3.0;                   // ピン基準高さ
// ワールド xz → 画像 uv。オルソで画面=ワールドを 1:1 マップ → 原寸表示(拡大なし)。
vec2  vxUV(vec2 id){
  vec2 w = (id + 0.5) * vxCW;
  return clamp(vec2(w.x/(vxSpan*vxAspect), w.y/vxSpan) + 0.5, 0.0, 1.0);
}
vec3  vxColAt(vec2 id){ return sampleAB(vxUV(id)).rgb; }
float vxH(vec2 id){ return dot(vxColAt(id), vec3(0.299,0.587,0.114)) * vxAmp; }
// セル領域を平均した単色(最終色用)。3x3 タップで平均。
vec3 vxColAvg(vec2 id){
  vec2 c = vxUV(id);
  vec2 s = vec2(vxCW/(vxSpan*vxAspect), vxCW/vxSpan) * 0.7;
  vec3 a = vec3(0.0);
  int _vx3 = int(min(1.0, 1.0 + uRes.x * 0.0));   // ループ展開抑止 (sampleAB ×9 のインライン化を防ぐ)
  for(int i=-_vx3;i<=_vx3;i++)
  for(int j=-1;j<=1;j++)
    a += sampleAB(clamp(c + vec2(float(i),float(j))*s, 0.0, 1.0)).rgb;
  return a / 9.0;
}
// AABB レイ交差。box [bmin,bmax]。戻り値: x=tNear(<0で無し), yzw=ヒット面の法線。
vec4 vxHitBox(vec3 ro, vec3 invD, vec3 bmin, vec3 bmax){
  vec3 t0 = (bmin - ro) * invD;
  vec3 t1 = (bmax - ro) * invD;
  vec3 tsm = min(t0, t1), tbg = max(t0, t1);
  float tN = max(max(tsm.x, tsm.y), tsm.z);
  float tF = min(min(tbg.x, tbg.y), tbg.z);
  if(tF < max(tN, 0.0)) return vec4(-1.0);              // 交差なし
  vec3 n = -sign(invD) * step(tsm.yzx, tsm.xyz) * step(tsm.zxy, tsm.xyz);
  return vec4(tN, n);
}
vec3 vxRender(){
  float v = clamp(uVoxel, 0.0, 1.0);
  vxAspect = uRes.x / max(uRes.y, 1.0);
  vxSpan = 30.0;                             // 画面高さ=30ワールド(オルソ原寸基準)
  float cellsW = 190.0;                        // 画面幅あたりのセル数(分割数=細かさ)
  vxCW = (vxSpan * vxAspect) / cellsW;         // セル幅(ワールド)
  vxAmp = mix(4.0, 24.0, sqrt(v));            // 起伏(柱の高さ): シリンダー状。低つまみでも起伏あり
  vec2 q = (gl_FragCoord.xy - uRes*0.5)/uRes.y;
  // 透視投影: カメラ(eye)を中央上空に固定し、各画素を床のワールド位置へ向ける。
  // → 画面中央は正面(真下)、外周ほど外向き = 中央を基点に角柱が放射状へ飛び出る。
  float vxEyeY = 40.0;
  vec3 ro = vec3(0.0, vxEyeY, 0.0);
  vec3 rd = normalize(vec3(q.x*vxSpan, VXBASE - vxEyeY, q.y*vxSpan));
  vec3 invD = 1.0 / rd;
  // 柱は上方向のみ(VXBASE→上)。帯を半減して DDA を軽量化。
  float yTop = VXBASE + vxAmp, yBot = VXBASE - 1.0;

  // --- xz グリッド(間隔 vxCW)を DDA で前→奥に辿り、各セルの角柱と交差判定 ---
  vec3 P0  = ro + rd * max(0.0, (yTop + 0.05 - ro.y) * invD.y);
  vec2 cell = floor(P0.xz / vxCW);
  vec2 stp  = sign(rd.xz);
  vec2 tDelta = abs(vxCW * invD.xz);                       // 1セル進む t
  vec2 nextB = (cell + max(stp, 0.0)) * vxCW;              // 次境界のワールド座標
  vec2 tMax = (nextB - ro.xz) * invD.xz;
  vec4 hb = vec4(-1.0); vec2 hitId = cell;
  int _vxIt = int(min(100.0, 100.0 + uRes.x * 0.0));   // ループ展開抑止 (100反復×大ボディ = FXC爆発対策)
  for(int i=0; i<_vxIt; i++){
    float h = vxH(cell);
    float ov = vxCW * 0.04;                                                  // 境界を少し重ねて隙間(黒線)を消す
    // 値が ~0.2 までは角柱の横幅を細く(画面上 ~2px)、0.2 付近で通常のセル幅へ
    float px2w = 2.0 * vxSpan / max(uRes.y, 1.0);
    float halfW = mix(px2w*0.5, vxCW*0.5 + ov, smoothstep(0.0, 0.2, v));
    float cx = (cell.x + 0.5) * vxCW;
    float cz = (cell.y + 0.5) * vxCW;
    vec3 bmin = vec3(cx - halfW,                VXBASE - 1.0, cz - halfW);
    vec3 bmax = vec3(cx + halfW,                VXBASE + h,   cz + halfW);
    vec4 r = vxHitBox(ro, invD, bmin, bmax);
    if(r.x > 0.0){ hb = r; hitId = cell; break; }
    if(tMax.x < tMax.y){ cell.x += stp.x; tMax.x += tDelta.x; }
    else               { cell.y += stp.y; tMax.y += tDelta.y; }
    if(ro.y + rd.y * min(tMax.x, tMax.y) < yBot - 0.05) break;  // 帯を抜けた
  }
  if(hb.x < 0.0){
    // ピンに当たらず谷(隙間)に抜けた → その地点の床タイル色。
    // 隙間の影: 周囲のピンが高い(囲まれた深い谷)ほどライトグレーを乗算して陰を落とす。
    float tg = (VXBASE - ro.y) * invD.y;
    vec2 g = ro.xz + rd.xz * tg;
    vec2 fcell = floor(g / vxCW);
    vec3 base = vxColAvg(fcell);
    float occ = (vxH(fcell+vec2(1.0,0.0)) + vxH(fcell+vec2(-1.0,0.0))
               + vxH(fcell+vec2(0.0,1.0)) + vxH(fcell+vec2(0.0,-1.0))) * 0.25;
    float sh = clamp(occ / max(vxAmp, 0.001), 0.0, 1.0);   // 0=開けた谷 / 1=囲まれた深い谷
    return base * mix(vec3(1.0), vec3(0.62), sh);           // ライトグレー(0.62)を乗算
  }

  // 各ボクセルはセル領域を平均した単色。上面=その色, 側面=同色を控えめに陰影。
  vec3 sn = hb.yzw;
  vec3 tcol = vxColAvg(hitId);
  return (sn.y > 0.5) ? tcol : tcol * 0.9;
}

// === Rain Screen (Post FX) : Shadertoy 4ljXDy by Jakob Thomsen (CC BY-NC-SA 3.0) ===
//   ガラスに付いた雨粒で映像(sampleAB)を屈折させる。雨粒の高さ場→法線で UV をずらす。
vec2  rx_hash(vec2 p){ p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))); return fract(sin(p)*18.5453); }
float rx_grid(float t, vec2 v){
  vec2 fl=floor(v), fr=fract(v); float md=1e9;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 o=vec2(x,y);
    vec2 pos=0.5+0.5*cos(6.2831853*(t*0.1 + rx_hash(fl+o)) + vec2(0.0,1.6));
    md=min(md, length(pos+o-fr));
  }
  return md;
}
float rx_blob(float t, vec2 p, float s){
  float h=0.0; const float n=3.0;
  for(float i=0.0;i<n;i++){
    vec2 q=vec2(0.0, t*(i+1.0)/n)+p;
    h+=pow(0.5+0.5*cos(3.1415926*clamp(rx_grid(t, q*(i+1.0))*2.0, 0.0, 1.0)), s);
  }
  return h/n;
}
vec3 rx_normal(float t, vec2 p, float s){
  float d=0.01;
  return normalize(vec3(
    rx_blob(t,p+vec2( d,0),s)-rx_blob(t,p+vec2(-d,0),s),
    rx_blob(t,p+vec2(0, d),s)-rx_blob(t,p+vec2(0,-d),s), d));
}

// === Ballpoint Sketch (Post FX) : approximation of Shadertoy XlKBzc by flockaroo (CC BY-NC-SA 3.0) ===
//   元は3パス+粒子ストロークの非リアルタイム手法。ここでは輝度勾配に沿った
//   等高線方向のクロスハッチ+輪郭線で単パス近似。青ボールペンを紙に描いた風。
float sk_lum(vec2 uv){ return dot(sampleAB(uv).rgb, vec3(0.299,0.587,0.114)); }
vec3 sk_sketch(vec2 uv){
  vec2 px = uv * uRes;
  float sc = uRes.y / 720.0;
  vec2 e  = 1.4 / uRes;
  float l  = sk_lum(uv);
  float lx = sk_lum(uv+vec2(e.x,0.)) - sk_lum(uv-vec2(e.x,0.));
  float ly = sk_lum(uv+vec2(0.,e.y)) - sk_lum(uv-vec2(0.,e.y));
  vec2  g  = vec2(lx, ly);
  float gl = length(g);
  vec2  gdir = (gl > 1e-4) ? g/gl : vec2(1.0, 0.0);   // 勾配方向(=ハッチを横切る向き)

  // 手描き風に位相をゆらす
  float jit = (rx_hash(floor(px*0.25)).x - 0.5) * 0.6;
  float freq = 0.16 / sc;                              // 約6pxピッチ
  float dark = clamp(1.0 - l, 0.0, 1.0);

  // 暗いほどレイヤを重ねるクロスハッチ
  float ink = 0.0;
  for(int i=0;i<4;i++){
    float th = float(i)*0.7;                           // レイヤ間の角度差
    vec2  d  = vec2(gdir.x*cos(th)-gdir.y*sin(th), gdir.x*sin(th)+gdir.y*cos(th));
    float ph = dot(px, d) * freq + jit;
    float tri = abs(fract(ph) - 0.5) * 2.0;            // 0..1 (1=線中心)
    float line = smoothstep(0.62, 1.0, tri);
    float on  = smoothstep(float(i)*0.22, float(i)*0.22 + 0.20, dark);
    ink = max(ink, line * on);
  }
  // 輪郭線(強い勾配)
  ink = max(ink, smoothstep(0.05, 0.14, gl));
  ink = clamp(ink, 0.0, 1.0);

  // 紙の粒状感 + 軽いビネット
  vec2 sc2 = (uv - 0.5);
  float vign = 1.0 - 0.35 * dot(sc2, sc2);
  float grain = (rx_hash(floor(px)).y - 0.5) * 0.06;
  vec3 paper = vec3(0.96, 0.95, 0.91) * vign + grain;
  vec3 inkc  = vec3(0.07, 0.13, 0.42);                 // 青ボールペン
  return mix(paper, inkc, ink);
}

// Hipass (旧Glass): なめらかな metaball を数個 + 全体のうねりでフロスト濃度を作る。
float glassH(vec2 q, float t){
  float h = 0.0;
  for(int i=0;i<3;i++){
    float fi = float(i)+1.0;
    vec2 c = 0.42*vec2(sin(t*0.6*fi + fi*2.1), cos(t*0.5*fi + fi*1.3));
    h += smoothstep(0.55, 0.0, length(q - c));
  }
  h += 0.18*sin(q.x*4.0 + t) + 0.18*sin(q.y*3.5 - t*0.8);
  return h;
}

// Dither Blur は後段の独立パス (_applyDitherPost) へ移設。

// ── Tunnel (Shadertoy X3jXWh "CandyTunnel VFX" by Eboman / aiekick Wax Tunnel ベース) 移植 ──
// 元コードのデフォルト状態 (mouse.x=0 → uMzero=0.98 / キー無し) を再現:
//   df・path・camera・march は原文どおり / iChannel2(変位テクスチャ)は手続きノイズで代替。
//   テクスチャ投影は Q モード(トライプレナー): uv2 の寄与は 1-uMzero=2% なので元映像は透けない。
//   減光は原文の「End of tunnel darkness」式 (1.25 - d*uMfive/10 - 0.25*(1-uMfive))。uMfive を上げて奥を黒に潰す。
mat3 ct_RotZ(float a){ return mat3(cos(a),-sin(a),0.,sin(a),cos(a),0.,0.,0.,1.); }
float ct_noise(vec2 p){ return _bnV(p*3.0)*0.7 + _bnV(p*7.0+11.3)*0.5 + _bnV(p*15.0+31.7)*0.2; }
float gCandyZero;
float gCandyWarp;
vec2 ct_path(float t){ return vec2(cos(t*0.2), sin(t*0.2)) * (2.0 * gCandyWarp); }
vec2 ct_df(vec3 p){
  p.xy -= ct_path(p.z);
  p *= ct_RotZ(p.z * mix(0.06, 0.45, gCandyWarp));
  float tunnelPulse = 0.56 + 0.44 * sin(p.z + cos(p.z));
  p.xy *= mix(1.0, tunnelPulse, gCandyWarp);
  float y = 1.72*gCandyZero - max(max(p.x, -p.x)*75.0 + p.y, -p.y);
  float d = ct_noise(vec2(max(p.x, -p.x), p.z)*0.06) * mix(0.12, 1.0, gCandyWarp);
  return vec2(y + d, 1.0);
}
vec3 ct_nor(vec3 pos, float prec){
  vec3 e = vec3(prec, 0.0, 0.0);
  return normalize(vec3(
    ct_df(pos+e.xyy).x - ct_df(pos-e.xyy).x,
    ct_df(pos+e.yxy).x - ct_df(pos-e.yxy).x,
    ct_df(pos+e.yyx).x - ct_df(pos-e.yyx).x));
}
vec3 ct_cam(vec2 uv, vec3 ro, vec3 cv){
  vec3 cu = vec3(0.0, 1.0, 0.0);
  vec3 z = normalize(cv - ro);
  vec3 x = normalize(cross(cu, z));
  vec3 y = cross(z, x);
  return normalize(z + uv.x*x + uv.y*y);
}
vec3 applyCandyTunnel(vec3 col, vec2 uv2){
  vec3 base = sampleAB(uv2).rgb;
  float raw = clamp(uCandy, 0.0, 1.0);
  if(raw < 0.001) return base;
  // 透明度フェードではなく、スクリーンUVからトンネル投影UVへ変形してつなぐ。
  // 低パラメータでは中身の投影UVを先に歪ませ、高パラメータで通路・捻り・タイル投影が立ち上がる。
  float rawEase = raw * raw * (3.0 - 2.0 * raw);
  float warp = pow(rawEase, 1.30);
  // 内部投影は低値で先行して暴れやすいため、高値側で立ち上がるカーブにする。
  float innerWarp = pow(rawEase, 1.25);
  float geom = pow(rawEase, 1.05);
  gCandyWarp = mix(0.01, 1.0, geom);
  gCandyZero = mix(0.42, 0.98, geom);
  float t = uTime * mix(1.0, 3.0, geom);
  vec2 si = uRes;
  vec2 uv = (2.0*(uv2*si) - si) / si.y;
  vec3 ro = vec3(ct_path(t), t);
  vec3 cv = vec3(ct_path(t+0.1), t+0.1);
  vec3 rd = ct_cam(uv, ro, cv);
  // 低値では近距離の緩い変形しか見えないため、探索距離と反復数も形状量に合わせる。
  // 0.01でも96反復を走らせていた従来のGPUスパイクを避け、高値だけ原作相当へ増やす。
  float workRise=pow(geom,0.62);
  float md=mix(18.0,100.0,workRise), s=1.0, d=1.0;
  int ctIter=int(floor(mix(28.0,96.0,workRise)+0.5));
  for(int i=0;i<96;i++){
    if(i>=ctIter) break;
    if(s < 0.002*log(d*d) || d > md) break;
    s = ct_df(ro + rd*d).x;
    d += s * (s > 0.1 ? 0.15 : 0.1);
  }
  vec3 outc = base;
  if(d < md){
    vec3 p = ro + rd*d;
    vec3 n = abs(ct_nor(p, 0.001));
    // Q モード(トライプレナー): 面の向きごとに映像をタイル投影。
    // uv2(平面スクリーンUV)は一切混ぜない。カメラ正面(z向き)の壁は p.xy だけだと
    // 映像がほぼ無変形で貼られ「元画像が残る」ため、z でスクロールさせて静止させない。
    float projScale = 0.145;
    vec2 qXZ = fract(p.xz * projScale);
    vec2 qYZ = fract(p.yz * projScale);
    vec2 qXY = fract(p.xy * projScale + p.z * mix(0.02, 0.13, geom));
    vec2 flow = vec2(
      sin(p.z*0.30 + p.y*0.42),
      cos(p.z*0.34 + p.x*0.38)
    ) * (0.020 * innerWarp);
    vec2 srcUv = clamp(uv2 + flow, vec2(0.0), vec2(1.0));
    vec3 vXZ = sampleAB(mix(srcUv, qXZ, innerWarp)).rgb;
    vec3 vYZ = sampleAB(mix(srcUv, qYZ, innerWarp)).rgb;
    vec3 vXY = sampleAB(mix(srcUv, qXY, innerWarp)).rgb;
    // 重みを鋭くして支配軸の1投影だけをほぼ選ぶ。3投影を混ぜると映像が多重露光になり
    // 乗算/加算のように濃くなったり明るくなったりするため(境界だけ僅かにブレンド)。
    vec3 w = pow(n, vec3(mix(5.0, 12.0, geom)));
    w /= max(w.x + w.y + w.z, 1e-5);
    vec3 video = vYZ*w.x + vXZ*w.y + vXY*w.z;
    // 奥行きグラデーション: 距離 d に対して単調になめらかに暗くする。
    // 実測でヒット距離は d ≈ 0〜4 (画面中心が最奥で約1、周辺は約0.1)。旧実装は
    // 1.25 - d*0.08 や exp(-(d-2)*0.3) と d が数十ある前提だったため実質効いていなかった。
    float caveAmt = max(warp, innerWarp * 0.55);
    float kFall = mix(2.4, 1.15, geom);                       // 減衰の速さ (低値ほど浅い変形=近景なので強め)
    float fade = exp(-max(d - 0.15, 0.0) * kFall);             // 1=手前 → 0=最奥 (単調・境目なし)
    float depthT = 1.0 - fade;
    vec3 coldTint = mix(vec3(1.0), vec3(0.34, 0.40, 0.52), depthT);   // 奥は冷たい影色へ
    vec3 shaded = video * coldTint * fade;
    outc = mix(video, shaded, caveAmt);
  }
  return outc;   // 前段パス専用: uCandy は透明度ではなく変形量として使う
}

void main(){
  // Tunnel 前段パス: 実 A/B 合成からトンネルだけを専用 FBO に描いて終了。
  if(uCandyMode == 1){ frag = vec4(applyCandyTunnel(vec3(0.0), vUv), 1.0); return; }

  vec2 uv = vUv;

  // mirror / kaleido
  if(uMir > 0) uv = applyMirror(uv, uMir);

  // pixelate (uPix in pixels)
  if(uPix > 0.5){
    vec2 g = uRes / uPix;
    uv = (floor(uv * g) + 0.5) / g;
  }

  // beat-driven UV warps (Twist は後段パスへ移設)
  vec2 sliceLineUv = uv;
  uv = applySlice(uv);
  vec2 splitLineUv = uv;
  uv = applySplit(uv);
  uv = applyShake(uv);
  vec2 ringsLineUv = uv;
  uv = applyRings(uv);
  uv = applyAudioFX(uv);


  // Rain Screen: 雨粒で映像を屈折
  vec3 rainN = vec3(0.0, 0.0, 1.0);
  if(uRain > 0.001){
    vec2 rp = vUv * vec2(uRes.x/uRes.y, 1.0) * 22.0;     // 雨粒スケール
    rainN = rx_normal(uTime, rp, 1.0);
    uv += 0.06 * rainN.xy * uRain;                        // 屈折
  }

  // Hipass (旧Glass): 磨りガラスのフロスト量。ガラス面のうねり + 拍で広がる。
  float glassFrost = 0.0;
  if(uGlass > 0.001){
    float gmn = min(uRes.x, uRes.y);
    vec2 gq = (gl_FragCoord.xy - 0.5*uRes)/gmn;            // 中心基準・アスペクト補正
    float gh = glassH(gq, uTime*0.25);                     // ガラス面のうねり(濃淡)
    float glassPulse = max(uHit, (uBeatMode == 1) ? pow(1.0 - uBeatPhase, 1.5) : 0.0); // ビート同期 (beat モード時のみ。音では常時発火)
    glassFrost = clamp(0.45 + gh*0.45 + glassPulse*0.45, 0.0, 1.0);
  }

  // chromatic aberration: separate R / G / B sampling (motion-blur aware)
  vec3 col;
  float srcA = 1.0;   // @gradmask 用: サンプル時の α (背景 α=0 のシェーダで grad map をマスク)
  float chrAmt = uChr + uARgb*max(uEnergy, uAttackEnv)*0.06;   // 音量/アタックで色収差(RGB分離)を加算
  if(chrAmt > 0.0001){
    vec2 d = (uv - 0.5);
    col.r = sampleAB_mblur(uv + d*chrAmt).r;
    vec4 sg_ = sampleAB_mblur(uv);
    col.g = sg_.g; srcA = sg_.a;
    col.b = sampleAB_mblur(uv - d*chrAmt).b;
  } else {
    vec4 s0_ = sampleAB_mblur(uv);
    col = s0_.rgb; srcA = s0_.a;
  }

  // Slice / Mondrian / Rings の境界線。線色は inkelly と同じくキャンバスの支配的な鮮やか色相を採用。
  // 無彩色時(uFxLineOn=0)は従来どおり地色の明暗で白黒を反転する。
  float fxEdge = max(sliceEdgeMask(sliceLineUv), max(splitEdgeMask(splitLineUv), ringsEdgeMask(ringsLineUv)));
  if(fxEdge > 0.001){
    float fxLuma = dot(col, vec3(0.299, 0.587, 0.114));
    vec3 fxLine = (uFxLineOn > 0.5) ? uFxLineCol : ((fxLuma < 0.48) ? vec3(1.0) : vec3(0.0));
    col = mix(col, fxLine, clamp(fxEdge, 0.0, 1.0));
  }
  // Tunnel は 2パス処理: 前段パス(uCandyMode==1)で描き、本パスでは sampleAB が返すためここでは何もしない。

  // Hipass (旧Glass): 序盤はぼかしではなく高域強調だけを即座に効かせ、後段でブラーを広げる。
  if(uGlass > 0.001){
    float raw = clamp(uGlass, 0.0, 1.0);
    float ga = clamp(raw / 0.75, 0.0, 1.0);
    float hpRise = pow(smoothstep(0.0, 0.045, raw), 0.42);
    float spread = smoothstep(0.16, 0.75, raw);
    float over = smoothstep(0.75, 1.0, raw);
    float overExp = (exp2(over * 3.4) - 1.0) / (exp2(3.4) - 1.0);
    float blurPx = 0.04 + 0.45*hpRise
                 + 3.0*hpRise*pow(spread, 1.70)
                 + 145.0*pow(spread, 1.35)
                 + 320.0 * overExp;
    vec3 src = col;
    vec3 lumaW = vec3(0.299, 0.587, 0.114);
    vec3 frost = sampleGaussClean(uv, blurPx);
    frost = hipassSuppressYellow(frost, smoothstep(0.10, 1.0, raw) * 0.78);
    float srcL = dot(src, lumaW);
    float frostL = dot(frost, lumaW);
    vec3 srcChroma = src - vec3(srcL);
    vec3 frostChroma = frost - vec3(frostL);
    float chromaBlur = clamp(0.10 + 0.44*spread + 0.20*over, 0.0, 0.74);
    frost = vec3(frostL) + mix(srcChroma, frostChroma, chromaBlur);
    float blurMixRise = smoothstep(0.16, 0.72, raw);
    float strongMix = 0.04 + 0.94*pow(blurMixRise, 0.78);
    float mixAmt = clamp(strongMix * blurMixRise, 0.0, 0.985);
    col = mix(src, frost, mixAmt);
    vec2 hpTx = vec2(0.35 + 1.35*pow(hpRise, 0.92) + 1.80*pow(spread, 0.85)) / uRes;
    vec3 hpBlur = (sampleAB(uv + vec2( hpTx.x, 0.0)).rgb
                 + sampleAB(uv + vec2(-hpTx.x, 0.0)).rgb
                 + sampleAB(uv + vec2(0.0,  hpTx.y)).rgb
                 + sampleAB(uv + vec2(0.0, -hpTx.y)).rgb) * 0.25;
    float hp = dot(src - hpBlur, lumaW);
    float hpAmt = (0.075 + 0.32*ga) * hpRise;
    col = max(col + vec3(clamp(hp, -0.20, 0.20)) * hpAmt, vec3(0.0));
    float hpEdge = smoothstep(0.006, 0.075, abs(hp)) * hpRise;
    col = hipassSuppressYellow(col, clamp(0.18 + 0.42*hpEdge + 0.14*spread, 0.0, 0.82));
  }


  // Rain Screen: 雨粒の縁にハイライト(ガラスの照り)を足して粒を見せる
  if(uRain > 0.001){
    float gl = pow(clamp(dot(rainN, normalize(vec3(0.4, 0.5, 0.75))), 0.0, 1.0), 6.0);
    col += gl * vec3(0.35) * uRain;
  }

  // ── Quality: 画質補完系 (Denoise → Deband → Clarity の順。平滑してからシャープ) ──
  // Denoise: エッジ保存平滑。色が近い近傍だけ重み付き平均(バイラテラル風 8-tap)
  if(uDenoise > 0.001){
    vec2 tx = (1.0 + uDenoise*1.5) / uRes;
    const vec2 DOFF[8] = vec2[8](vec2(-1,-1), vec2(0,-1), vec2(1,-1), vec2(-1,0), vec2(1,0), vec2(-1,1), vec2(0,1), vec2(1,1));
    vec3 acc = col; float wsum = 1.0;
    float sig = 0.06 + 0.22*uDenoise;
    int _dnIt = int(min(8.0, 8.0 + uRes.x * 0.0));   // ループ展開抑止
    for(int i=0;i<_dnIt;i++){
      vec3 c2 = sampleAB(uv + DOFF[i]*tx).rgb;
      float w = exp(-dot(c2 - col, c2 - col) / (2.0*sig*sig));
      acc += c2*w; wsum += w;
    }
    col = mix(col, acc/wsum, clamp(uDenoise, 0.0, 1.0));
  }

  // Deband: 差が小さい面(=グラデ段差)だけ広めの近傍平均へ置換 + 微細ディザで残段差を粉砕
  if(uDeband > 0.001){
    float ang = rnd(uv*uRes)*6.28318;
    vec2 dbd = vec2(cos(ang), sin(ang));
    vec2 tx = (2.0 + 6.0*uDeband) / uRes;
    vec3 avg = (sampleAB(uv + dbd*tx).rgb + sampleAB(uv - dbd*tx).rgb
              + sampleAB(uv + vec2(-dbd.y, dbd.x)*tx).rgb + sampleAB(uv + vec2(dbd.y, -dbd.x)*tx).rgb) * 0.25;
    float t = smoothstep(0.12, 0.03, length(avg - col));
    col = mix(col, avg, t * clamp(uDeband, 0.0, 1.0));
    col += (rnd(uv*uRes + fract(uTime)*931.7) - 0.5) * 0.012 * uDeband;
  }

  // Clarity: CAS (Contrast Adaptive Sharpening) 風。局所コントラストが低い所ほど強くシャープ
  if(uClarity > 0.001){
    vec2 tx = 1.0 / uRes;
    vec3 ca_ = sampleAB(uv + vec2(0.0, -tx.y)).rgb;
    vec3 cb_ = sampleAB(uv + vec2(-tx.x, 0.0)).rgb;
    vec3 cc_ = sampleAB(uv + vec2( tx.x, 0.0)).rgb;
    vec3 cd_ = sampleAB(uv + vec2(0.0,  tx.y)).rgb;
    vec3 mn = min(min(ca_, cb_), min(cc_, min(cd_, col)));
    vec3 mx = max(max(ca_, cb_), max(cc_, max(cd_, col)));
    vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
    vec3 w = amp * mix(-0.125, -0.2, clamp(uClarity, 0.0, 1.0));
    vec3 sharp = (col + (ca_ + cb_ + cc_ + cd_) * w) / (1.0 + 4.0*w);
    col = mix(col, clamp(sharp, 0.0, 1.0), clamp(uClarity, 0.0, 1.0));
  }

  // Water (旧 Sketch): fBM ノイズの UV 歪み — 実体は多パス SketchFX 側で処理 (uSketch は常に 0)
  if(uSketch > 0.001){
    col = mix(col, sk_sketch(uv), clamp(uSketch, 0.0, 1.0));
  }

  // Pollock は composite shader 内では描かず、捕獲フレームを Canvas2D で蓄積描画する
  // PollockFX (2-pass Post FX) としてこの後段で適用する。

  // Unsharp mask: Photoshop の「アンシャープマスク」相当。
  //   元 col との差分 (high-pass) を amount 倍して加算 → エッジ強調 / ディテール強化。
  //   サンプル元は uA/uB (sampleAB) なので CA 後の col との差で実装。十分シャープになる。
  if(abs(uUnsharp) > 0.0001 && uVoxel < 0.001){
    // 正=シャープ / 負=ぼかし。半径は効果量の絶対値に応じて指数的に拡大 (Unsharp R が基準)。
    // 固定リングではなく、中心から外へ連続減衰するGaussianディスクを使う。
    // 外側のサンプルほど重みが下がるため、複数の輪郭層ではなく霧状のぼかしになる。
    float r = max(0.5, uUnsharpRadius) * exp2(abs(uUnsharp) * 1.9);   // 半径を強めに拡大(+シャープ/-ぼかし共通)
    vec3 blur = sampleGaussClean(uv, r);
    if(uUnsharp > 0.0) col += uUnsharp * 2.8 * (col - blur);  // シャープ (ハイパス加算・ゲイン強化)
    else col = mix(col, blur, clamp(-uUnsharp, 0.0, 1.0));    // ぼかし(半径拡大でより強く)
    col = max(col, vec3(0.0));
  }

  // bloom (cheap 4-tap blur of bright parts)
  if(uBlm > 0.0001 && uVoxel < 0.001){
    vec2 tx = vec2(1.5) / uRes;
    vec3 b = vec3(0.0);
    b += sampleAB(uv + tx*vec2( 1, 1)).rgb;
    b += sampleAB(uv + tx*vec2(-1, 1)).rgb;
    b += sampleAB(uv + tx*vec2( 1,-1)).rgb;
    b += sampleAB(uv + tx*vec2(-1,-1)).rgb;
    b *= 0.25;
    b = max(b - 0.6, 0.0); // threshold
    col += b * uBlm;
  }


  // === Voxel Pillars: 構造系 FX の後・色 FX の前に適用 → 色変化(Bri/Con/Sat/Grad/Cos/Hue)が角柱に乗る ===
  if(uVoxel > 0.001){
    col = vxRender();
  }

  // invert: 明度(lightness)だけ反転。hue / saturation は保持。
  // uInv は 0..1 の連続量 (Param Fade でなめらかに ON/OFF できるよう閾値の代わりに mix)。
  if(uInv > 0.001){ vec3 hsl = _rgb2hsl(col); hsl.z = mix(hsl.z, 1.0 - hsl.z, uInv); col = _hsl2rgb(hsl); }

  // ── Color pipeline: Brightness → Contrast → Saturation → Grad Map → Hue Shift ──(Auto Palette は Slot B 側で適用済み)
  // brightness
  if(abs(uBri) > 0.0001) col = col + uBri;
  // contrast
  if(abs(uCon - 1.0) > 0.001) col = (col - 0.5) * uCon + 0.5;
  // saturation
  if(abs(uSat - 1.0) > 0.001){
    float L = dot(col, vec3(0.299,0.587,0.114));
    col = mix(vec3(L), col, uSat);
  }
  // Vibrance: 自然な彩度。低彩度ほど強く持ち上げ、既に鮮やかな色とハイライトは保護(負で控えめに脱色)
  if(abs(uVibrance) > 0.001){
    float vmx = max(col.r, max(col.g, col.b));
    float vsat = vmx - min(col.r, min(col.g, col.b));
    float vL = dot(col, vec3(0.299,0.587,0.114));
    float boost = uVibrance * (1.0 - clamp(vsat, 0.0, 1.0)) * (1.0 - smoothstep(0.75, 1.0, vL));
    col = mix(vec3(vL), col, 1.0 + boost);
  }
  // Grad Map (INVERT の後に適用。両スロット合成後の col にかける)。
  // @gradmask シェーダはサンプル α でマスク: 背景(α=0)は grad が乗らず白/グレーのまま。
  if(abs(uGradMix) > 0.0001){
    vec3 gmc = _gradMap(col);
    col = (uGradMask == 1) ? mix(col, gmc, clamp(srcA, 0.0, 1.0)) : gmc;
  }
  // hue shift (手動 + 自動ローテートの累積位相を加算)
  float hueTotal = uHue + uHueRot;
  if(abs(hueTotal) > 0.001) col = hueShift(col, hueTotal);


  // posterize
  if(uPos >= 1.5){
    col = floor(col * uPos) / uPos;
  }

  // Texture Noise: 正=黒みがかった / 負=白みがかった粒ノイズ。色調補正の直後・他 Post FX の前に適用。
  if(abs(uTexN) > 0.0001 && uVoxel < 0.001 && uEmptyAB == 0){   // voxel時と空スロット(土台スタティック)時は乗せない
    float blk = 1.0;                                   // 1px 単位(最細粒度の粒ノイズ)
    vec2 g = floor(vUv * uRes / blk);                  // ピクセル単位
    float n = hash13(vec3(g, floor(uTime * 60.0)));    // ピクセル毎・フレーム毎に無相関(斜め縞/波が出ない純粋なザラザラ)
    n = 0.5 + (n - 0.5) * 0.25;                         // コントラストを抑えてフラットに(粒の振れ幅を小さく)
    col += vec3(n) * (-uTexN);                          // +uTexN=黒みがかり / -uTexN=白みがかり
  }

  // === Mosaic: ブロック (セル) 単位の RGB チャンネル swap (Audio FX: 値 × 強い音の発火) ===
  float mosStr = uMosaic * uHit;
  if(mosStr > 0.001){
    float sr = uHitSeed;                              // 発火ごとにセル配置をランダム
    float mosaicSize = mix(4.0, 32.0, h11(sr*7.3));
    vec2 cell = floor((vUv * uRes - uRes * 0.5) / mosaicSize);
    vec3 m = col;
    float bh = h21(cell + vec2(sr*7.7, sr*3.3));
    if(bh > 0.7)       m = col.gbr;
    else if(bh > 0.4)  m = col.brg;
    col = mix(col, m, mosStr);
  }


  // vignette
  if(uVig > 0.0001){
    float d = distance(vUv, vec2(0.5));
    float v = 1.0 - smoothstep(0.3, 0.85, d) * uVig;
    col *= v;
  }

  // scanlines: 中央0=無効。正値は黒線、負値は同じ位置に白線を出す。
  if(abs(uScn) > 0.0001){
    float s = 0.5 + 0.5*sin(vUv.y * uRes.y * 3.14159);
    if(uScn > 0.0){
      col *= mix(1.0, s, uScn);
    }else{
      float white = (-uScn) * (1.0 - s);
      col = mix(col, vec3(1.0), white);
    }
  }

  // grain
  if(uGrn > 0.0001){
    float n = rnd(vUv * uRes + uTime*60.0) - 0.5;
    col += n * uGrn;
  }

  // gain (拍同期の明滅: 拍頭で瞬間ピーク → 高速減衰)
  if(abs(uGain) > 0.001){
    float pulse = pow(1.0 - uBeatPhase, 16.0); // 拍頭=1.0, すぐ0へ
    col *= (1.0 + uGain * pulse);
    // 正方向は「黒でも白へ寄る」加算フラッシュを重ねる((1-col)で明るい部分は素通り→既存の見た目を維持)。
    // これで Slot A=なし(黒シェーダ)でも拍で明滅する。
    if(uGain > 0.0) col += uGain * pulse * (1.0 - col) * 0.85;
    col = max(col, vec3(0.0));
  }

  // gamma
  col = pow(max(col, 0.0), vec3(1.0/uGamma));

  // Feedback トレイル: 明るい残像と暗い残像を独立して合成する。
  if(max(uFbAdd,uFbMultiply) > 0.001){
    vec2 q = vUv - 0.5;
    float fa = uFbRot * 0.15;
    float fc = cos(fa), fs = sin(fa);
    q = vec2(q.x*fc - q.y*fs, q.x*fs + q.y*fc);
    q /= (1.0 + uFbZoom*0.06);
    vec3 fb = texture(uFbTex, q + 0.5).rgb;
    if(uFbAdd > 0.001){
      float addGain = 0.55 + 0.44*clamp(uFbAdd,0.0,1.0);
      col = max(col,fb*addGain);
    }
    if(uFbMultiply > 0.001){
      float multiplyGain = 0.55 + 0.44*clamp(uFbMultiply,0.0,1.0);
      col = min(col,mix(vec3(1.0),fb,multiplyGain));
    }
  }

  // Datamosh トレイル (ctVGWw) は独立ポストパス _applyGlitchTrail で適用する。
  //   (原作 Buffer A の自己フィードバック=正規化 acc を専用バッファに保持する必要があるため)

  // Slit-scan (時間差スライス) は独立ポストパス _applySlitScan で適用する(履歴バッファが必要なため)。

  // Audio Strobe: アタックで一瞬フラッシュ(発火ごとに 白 / 反転 をランダム)
  if(uAStrobe > 0.001){
    float fl = smoothstep(0.15, 0.75, uAttack) * uAStrobe;
    vec3 fc = (uHitSeed > 0.35) ? vec3(1.0) : (vec3(1.0) - col);
    col = mix(col, fc, clamp(fl, 0.0, 1.0));
  }

  frag = vec4(col, 1.0);
}`);

    // Needle: shared crystal nuclei grow connected planar facets on an irregular triangle mesh.
    {
      const gl = this.gl;
      const OGVS = `#version 300 es
precision highp float;
in vec3 aPos;
in vec2 aUv;
in float aFacet;
uniform vec2 uRes; uniform float uAmount, uTime, uHit, uBeat, uBeatMode, uShadowPass;
out vec2 vSrcUv; out vec3 vWorld; out vec3 vEye; out vec4 vLightClip; flat out float vFacet; flat out vec3 vLightPos;
float hash21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
vec2 hash22(vec2 p){ float n=hash21(p); return vec2(n,hash21(p+n+19.19)); }
vec3 movingLight(){
  float motion=mix(uTime*1.26,uBeat*0.55,step(0.5,uBeatMode));
  float k=floor(motion), ph=fract(motion); ph=ph*ph*(3.0-2.0*ph);
  vec3 a=vec3(hash21(vec2(k,11.7)),hash21(vec2(k,37.1)),hash21(vec2(k,73.9)));
  vec3 b=vec3(hash21(vec2(k+1.0,11.7)),hash21(vec2(k+1.0,37.1)),hash21(vec2(k+1.0,73.9)));
  vec3 r=mix(a,b,ph);
  return vec3(mix(-7.5,7.5,r.x),mix(-5.5,6.5,r.y),mix(7.0,13.0,r.z));
}
vec4 lightClipAt(vec3 world,vec3 lightPos){
  vec3 target=vec3(0.0,0.0,0.8), lz=normalize(lightPos-target);
  vec3 lx=normalize(cross(vec3(0.0,1.0,0.0),lz)), ly=cross(lz,lx);
  vec3 d=world-lightPos;
  float z=dot(lz,d), nearZ=0.1, farZ=32.0, extent=12.0;
  return vec4(dot(lx,d)/extent,dot(ly,d)/extent,(-2.0*z-(farZ+nearZ))/(farZ-nearZ),1.0);
}
void main(){
  // 結晶ジオメトリは JS 側でベクター生成 (グリッド量子化なし)。VS は変換のみ。
  vec3 world=aPos;
  vSrcUv=aUv;
  vFacet=aFacet;
  vWorld=world;
  vLightPos=movingLight();
  vLightClip=lightClipAt(world,vLightPos);
  float asp=uRes.x/max(uRes.y,1.0);
  float t=uTime*1.5;
  vec2 droneEye=vec2(0.6*sin(t*0.2),0.4*cos(t*0.15));
  float camBeatId=floor(uBeat), camBp=fract(uBeat);
  float camQ=clamp(camBp/0.24,0.0,1.0), camEase=1.0-pow(1.0-camQ,3.0);
  vec2 camA=(hash22(vec2(camBeatId*5.7+301.1,camBeatId*11.3+337.9))-0.5)*vec2(1.2,0.8);
  vec2 camB=(hash22(vec2((camBeatId+1.0)*5.7+301.1,(camBeatId+1.0)*11.3+337.9))-0.5)*vec2(1.2,0.8);
  vec2 eyeXY=mix(droneEye,mix(camA,camB,camEase),step(0.5,uBeatMode));
  vec3 eye=vec3(eyeXY,9.2);                                        // beat mode snaps, drone mode drifts
  vEye=eye;
  vec3 tgt=vec3(0.0,0.0,0.6);
  vec3 up=vec3(0.0,1.0,0.0);
  vec3 zc=normalize(eye-tgt), xc=normalize(cross(up,zc)), yc=cross(zc,xc);
  mat4 view=mat4(xc.x,yc.x,zc.x,0.0, xc.y,yc.y,zc.y,0.0, xc.z,yc.z,zc.z,0.0, -dot(xc,eye),-dot(yc,eye),-dot(zc,eye),1.0);
  float fov=radians(52.0), f=1.0/tan(fov*0.5), zn=0.1, zf=60.0;
  mat4 proj=mat4(f/asp,0.0,0.0,0.0, 0.0,f,0.0,0.0, 0.0,0.0,(zf+zn)/(zn-zf),-1.0, 0.0,0.0,(2.0*zf*zn)/(zn-zf),0.0);
  vec4 cameraClip=proj*view*vec4(world,1.0);
  gl_Position=mix(cameraClip,vLightClip,step(0.5,uShadowPass));
}`;
      const OGFS = `#version 300 es
precision highp float;
in vec2 vSrcUv; in vec3 vWorld; in vec3 vEye; in vec4 vLightClip; flat in float vFacet; flat in vec3 vLightPos; out vec4 frag;
uniform sampler2D uTex, uShadowTex; uniform float uAmount, uTime, uShadowEnabled; uniform vec2 uShadowTexel;
float castShadow(vec3 N,vec3 L){
  if(uShadowEnabled<0.5) return 0.0;
  vec3 sc=vLightClip.xyz/max(vLightClip.w,0.0001)*0.5+0.5;
  if(sc.x<=0.0||sc.x>=1.0||sc.y<=0.0||sc.y>=1.0||sc.z<=0.0||sc.z>=1.0) return 0.0;
  float bias=max(0.0007,0.0032*(1.0-max(dot(N,L),0.0)));
  float shadow=0.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    float dep=texture(uShadowTex,sc.xy+vec2(float(x),float(y))*uShadowTexel).r;
    shadow+=step(dep+bias,sc.z);
  }
  return shadow/9.0;
}
// Neutral studio environment: broad panels and a horizon, without synthetic rainbow bands.
vec3 oreEnv(vec3 r){
  float sky=clamp(r.y*0.5+0.5,0.0,1.0);
  float panelA=pow(max(dot(r,normalize(vec3(-0.62,0.48,0.62))),0.0),22.0);
  float panelB=pow(max(dot(r,normalize(vec3(0.73,-0.18,0.66))),0.0),34.0);
  float horizon=pow(max(0.0,1.0-abs(r.y)),10.0);
  return mix(vec3(0.035,0.042,0.055),vec3(0.62,0.68,0.78),sky)
       +vec3(1.0)*panelA*1.15+vec3(0.78,0.84,0.94)*panelB*0.82
       +vec3(0.32,0.36,0.42)*horizon;
}
void main(){
  vec3 N=normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 V=normalize(vEye-vWorld);
  if(dot(N,V)<0.0) N=-N;
  vec3 L=normalize(vLightPos-vWorld);
  float amp=uAmount*uAmount*(3.0-2.0*uAmount);
  vec2 uv=clamp(vSrcUv,0.0,1.0);
  float NoV=max(dot(N,V),0.0);
  vec2 refrOff=N.xy*(0.0015+0.0095*amp)*(0.35+0.65*(1.0-NoV));
  vec3 alb=texture(uTex,uv).rgb;
  vec3 frontSample=texture(uTex,clamp(uv+refrOff,0.0,1.0)).rgb;
  vec3 innerSample=texture(uTex,clamp(uv-refrOff*1.85,0.0,1.0)).rgb;
  float albPeak=max(max(alb.r,alb.g),alb.b);
  vec3 gemHue=albPeak>0.025?alb/albPeak:vec3(1.0);
  float ndl=clamp(dot(N,L),0.0,1.0);
  float shadow=castShadow(N,L);
  float direct=ndl*(1.0-shadow);
  vec3 Hh=normalize(L+V);
  float rough=mix(0.07,0.21,vFacet);
  float specPower=clamp(2.0/(rough*rough)-2.0,18.0,180.0);
  float spec=pow(max(dot(N,Hh),0.0),specPower);
  vec3 L2=normalize(vec3(0.7,-0.25,0.65));
  float spec2=pow(max(dot(N,normalize(L2+V)),0.0),specPower*1.35);
  float fres=0.055+0.945*pow(1.0-NoV,5.0);
  vec3 R=reflect(-V,N);
  vec3 env=oreEnv(R);
  float envLum=dot(env,vec3(0.2126,0.7152,0.0722));
  vec2 reflectUv=clamp(uv+R.xy*(0.014+0.050*amp),0.0,1.0);
  vec3 reflectedSample=texture(uTex,reflectUv).rgb;
  vec3 transmitted=mix(alb,frontSample,0.14*amp);
  transmitted=mix(transmitted,innerSample,0.10+0.08*amp);
  float facetShade=mix(0.58,1.18,smoothstep(0.08,0.92,direct+envLum*0.16));
  vec3 col=transmitted*facetShade;
  col*=mix(1.0,0.62,shadow);
  float tir=smoothstep(0.18,0.82,1.0-NoV);
  col=mix(col,reflectedSample*(0.72+0.22*envLum)+transmitted*0.18,tir*(0.10+0.22*amp));
  col+=vec3(1.0)*(spec*2.15*(1.0-shadow)+spec2*1.18);
  float internal=pow(max(dot(R,normalize(vec3(-0.35,0.18,0.92))),0.0),18.0);
  col+=gemHue*albPeak*internal*(0.22+0.38*amp);
  col+=gemHue*albPeak*envLum*fres*0.12;
  col+=vec3(1.0)*fres*fres*(0.045+0.11*envLum);
  col=mix(col,alb,0.24);                                            // retain readable source pattern on every facet
  frag=vec4(mix(alb,col,amp),1.0);
}`;
      const ovs=this._compile(gl.VERTEX_SHADER, OGVS);
      const ofs=this._compile(gl.FRAGMENT_SHADER, OGFS);
      const prog=this._link(ovs, ofs);
      this.origamiProg=(prog && !prog.err)?prog:null;
      if(!prog || prog.err) console.error('origami crystal program failed:', prog && prog.err);
      const shadowFs=this._compile(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
out vec4 frag;
void main(){ frag=vec4(1.0); }`);
      const shadowProg=this._link(this._compile(gl.VERTEX_SHADER, OGVS),shadowFs);
      this.origamiShadowProg=(shadowProg && !shadowProg.err)?shadowProg:null;
      if(!shadowProg || shadowProg.err) console.error('origami shadow program failed:',shadowProg && shadowProg.err);
    }

    // Relief is a standalone pass so it remains available while the large
    // composite shader is still compiling or has fallen back on a given GPU.
    this._linkDeferred('reliefProg', `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uAmount, uTime;
float reliefLum(vec2 uv){
  vec2 px=1.0/uRes;
  float l=dot(texture(uTex,uv).rgb,vec3(0.299,0.587,0.114))*0.4;
  l+=dot(texture(uTex,uv+vec2( px.x,0.0)).rgb,vec3(0.299,0.587,0.114))*0.15;
  l+=dot(texture(uTex,uv+vec2(-px.x,0.0)).rgb,vec3(0.299,0.587,0.114))*0.15;
  l+=dot(texture(uTex,uv+vec2(0.0, px.y)).rgb,vec3(0.299,0.587,0.114))*0.15;
  l+=dot(texture(uTex,uv+vec2(0.0,-px.y)).rgb,vec3(0.299,0.587,0.114))*0.15;
  return l;
}
void main(){
  vec3 col=texture(uTex,vUv).rgb;
  if(uAmount<=0.001){ frag=vec4(col,1.0); return; }
  vec2 e=2.5/uRes;
  float lx=reliefLum(vUv+vec2(e.x,0.0))-reliefLum(vUv-vec2(e.x,0.0));
  float ly=reliefLum(vUv+vec2(0.0,e.y))-reliefLum(vUv-vec2(0.0,e.y));
  float clean=smoothstep(0.006,0.03,length(vec2(lx,ly)));
  lx*=clean; ly*=clean;
  vec3 n=normalize(vec3(-lx*3.0,-ly*3.0,0.5));
  vec3 V=vec3(0.0,0.0,1.0);
  vec3 L=normalize(vec3(cos(uTime*0.5),0.6,0.7));
  float spec=pow(max(0.0,dot(reflect(-L,n),V)),32.0);
  float fres=pow(1.0-max(0.0,dot(n,V)),3.0);
  vec3 metal=col*0.25+spec*vec3(1.0)+fres*vec3(0.4,0.55,0.9);
  frag=vec4(mix(col,metal,clamp(uAmount,0.0,1.0)),1.0);
}`);

    // Bleed: 水彩/インクのにじみ。輝度勾配に沿って暗い側の色を引き込み、
    // 輪郭を滲ませる。エッジには水彩特有の暗溜まり(rim)、面には粒状のむらを乗せる。
    // Twist (後段パス): composite から移設。折り紙系まで済んだ画を力場でうねらせる。
    this._linkDeferred('twistProg', `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uTime, uTwistAcc, uTwistSeed, uTwistSeed2, uTwistMix;
float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
vec2 mirUv(vec2 v){ return 1.0 - abs(1.0 - fract(v*0.5)*2.0); }
// 各波: 位相を測る軸・変位する方向・周期・位相をすべてシードからランダム化 (composite 時代と同一)。
vec2 twistField(vec2 p, float seed){
  vec2 disp = vec2(0.0);
  int _twIt = int(min(5.0, 5.0 + uRes.x * 0.0));   // ループ展開抑止
  for(int i=0;i<_twIt;i++){
    float fi = float(i);
    float aAxis = rnd(vec2(seed + fi, 1.7)) * 6.2832;
    float aDir  = rnd(vec2(seed + fi, 3.3)) * 6.2832;
    float freq  = 0.25 + rnd(vec2(seed + fi, 5.1)) * 0.75;
    float phase = rnd(vec2(seed + fi, 7.9)) * 6.2832;
    float drift = uTime * (0.10 + fi*0.045);
    vec2 axis = vec2(cos(aAxis), sin(aAxis));
    vec2 dir  = vec2(cos(aDir),  sin(aDir));
    disp += dir * sin(dot(p, axis) * freq * 6.2832 + phase + drift) / (1.0 + fi*0.6);
  }
  return disp;
}
void main(){
  vec2 uv = vUv;
  if(uTwistAcc >= 0.001){
    float asp = uRes.x / uRes.y;
    vec2 p = uv * vec2(asp, 1.0);
    vec2 disp = mix(twistField(p, uTwistSeed), twistField(p, uTwistSeed2), uTwistMix);
    p += uTwistAcc * 0.5 * disp;
    uv = p / vec2(asp, 1.0);
  }
  frag = vec4(texture(uTex, mirUv(uv)).rgb, 1.0);
}`);

    // Dither Blur (後段パス): composite から移設 (ジッター付き 2 半径 Kawase ブラー)
    this._linkDeferred('ditherProg', `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uAmount;
float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
vec3 kawase(vec2 uv, float r){
  vec2 jitter = vec2(rnd(uv), rnd(uv + 0.47));
  vec2 o = jitter * r * vec2(uRes.x/uRes.y, 1.0);
  vec3 c = texture(uTex, clamp(uv + o*vec2( 1.0,  1.0), 0.0, 1.0)).rgb;
  c     += texture(uTex, clamp(uv + o*vec2(-1.0,  1.0), 0.0, 1.0)).rgb;
  c     += texture(uTex, clamp(uv + o*vec2(-1.0, -1.0), 0.0, 1.0)).rgb;
  c     += texture(uTex, clamp(uv + o*vec2( 1.0, -1.0), 0.0, 1.0)).rgb;
  return c * 0.25;
}
void main(){
  float d = (exp2(4.0*uAmount) - 1.0) / 15.0;   // 指数カーブ: 低値で弱く高値で一気に
  float r = 0.12 * d;
  frag = vec4(0.5 * (kawase(vUv, r) + kawase(vUv, r*2.0)), 1.0);
}`);

    this._linkDeferred('bleedProg', `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uAmount;
float lum(vec3 c){ return dot(c,vec3(0.299,0.587,0.114)); }
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float blum(vec2 uv){
  vec2 px=1.5/uRes;
  float l=lum(texture(uTex,uv).rgb)*0.4;
  l+=lum(texture(uTex,uv+vec2( px.x,0.0)).rgb)*0.15;
  l+=lum(texture(uTex,uv+vec2(-px.x,0.0)).rgb)*0.15;
  l+=lum(texture(uTex,uv+vec2(0.0, px.y)).rgb)*0.15;
  l+=lum(texture(uTex,uv+vec2(0.0,-px.y)).rgb)*0.15;
  return l;
}
void main(){
  vec3 col=texture(uTex,vUv).rgb;
  if(uAmount<=0.001){ frag=vec4(col,1.0); return; }
  vec2 e=2.0/uRes;
  vec2 g=vec2(blum(vUv+vec2(e.x,0.0))-blum(vUv-vec2(e.x,0.0)),
              blum(vUv+vec2(0.0,e.y))-blum(vUv-vec2(0.0,e.y)));
  float gl2=length(g);
  vec2 dir=(gl2>1e-5)?(g/gl2):vec2(0.0);
  // 低周波ノイズで滲みの向きを揺らす (濡れた紙のむら)
  float wob=vnoise(vUv*uRes*0.02)*6.28318;
  vec2 wdir=normalize(dir+0.55*vec2(cos(wob),sin(wob)));
  float radius=mix(3.0,16.0,uAmount);
  vec3 acc=col; float w=1.0;
  for(int i=1;i<=9;i++){
    float t=float(i)/9.0;
    float jit=0.65+0.7*hash(vUv*uRes+float(i)*17.3);
    vec2 off=wdir*t*jit*radius/uRes;
    vec3 s1=texture(uTex,vUv-off).rgb;      // 暗い側から色を引き込む
    float wt=(1.0-t)*(1.0-t)*1.4;
    // 暗い色ほど強く滲む (顔料が流れる)
    wt*=mix(1.0,1.8,1.0-lum(s1));
    acc+=s1*wt; w+=wt;
  }
  vec3 bled=acc/w;
  // 水彩の暗溜まり: エッジに沿って顔料が濃くなる
  float edge=smoothstep(0.015,0.09,gl2);
  bled*=1.0-edge*0.30*uAmount;
  // 粒状のむら (granulation)
  bled*=0.95+0.10*vnoise(vUv*uRes*0.45);
  frag=vec4(mix(col,bled,clamp(uAmount*1.25,0.0,1.0)),1.0);
}`);

    // Impasto: 油絵の厚塗り。輝度+筆致ノイズを高さ場にして強いバンプ照明で起こす。
    // 元の色を保ったまま、絵の具の盛り上がり・筆すじ・ハイライトが乗る。
    this._linkDeferred('impastoProg', `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uAmount;
float lum(vec3 c){ return dot(c,vec3(0.299,0.587,0.114)); }
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float hgt(vec2 uv){
  vec2 px=1.5/uRes;
  float l=lum(texture(uTex,uv).rgb)*0.4;
  l+=lum(texture(uTex,uv+vec2( px.x,0.0)).rgb)*0.15;
  l+=lum(texture(uTex,uv+vec2(-px.x,0.0)).rgb)*0.15;
  l+=lum(texture(uTex,uv+vec2(0.0, px.y)).rgb)*0.15;
  l+=lum(texture(uTex,uv+vec2(0.0,-px.y)).rgb)*0.15;
  vec2 p=uv*uRes;
  float brush=vnoise(p*vec2(0.2,0.75))*0.65+vnoise(p*vec2(0.6,1.8))*0.35;   // 横方向の筆すじ
  return l+brush*0.22;
}
void main(){
  vec3 col=texture(uTex,vUv).rgb;
  if(uAmount<=0.001){ frag=vec4(col,1.0); return; }
  vec2 e=1.4/uRes;
  float hx=hgt(vUv+vec2(e.x,0.0))-hgt(vUv-vec2(e.x,0.0));
  float hy=hgt(vUv+vec2(0.0,e.y))-hgt(vUv-vec2(0.0,e.y));
  float bump=mix(1.6,5.0,uAmount);
  vec3 n=normalize(vec3(-hx*bump,-hy*bump,0.9));
  vec3 L=normalize(vec3(-0.45,0.65,0.62));
  vec3 V=vec3(0.0,0.0,1.0);
  float diff=max(0.0,dot(n,L));
  float spec=pow(max(0.0,dot(reflect(-L,n),V)),24.0);
  // 絵の具: 拡散は元色、ハイライトは絵の具の艶(すこし色を残す)
  vec3 paint=col*(0.68+0.44*diff)+spec*mix(vec3(1.0),col,0.35)*0.38;
  frag=vec4(mix(col,paint,clamp(uAmount,0.0,1.0)),1.0);
}`);

    // Chrome: マットキャップ流の液体金属。輝度勾配法線でスタジオ照明バンドの環境を引き、
    // 映像の色味を残したまま全体を金属質に変える。光源はゆっくり回転。
    this._linkDeferred('chromeProg', `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uAmount, uTime;
float lum(vec3 c){ return dot(c,vec3(0.299,0.587,0.114)); }
// 密なディスクぼかし (13タップ): 点・粒を消しつつランプ幅は数px に留める
float blum(vec2 uv){
  vec2 px=1.0/uRes;
  float l=lum(texture(uTex,uv).rgb)*0.16;
  for(int i=0;i<6;i++){
    float a=float(i)*1.0471976;
    vec2 d=vec2(cos(a),sin(a));
    l+=lum(texture(uTex,uv+d*3.0*px).rgb)*0.08;
    l+=lum(texture(uTex,uv+d*6.0*px).rgb)*0.06;
  }
  return l;
}
void main(){
  vec3 col=texture(uTex,vUv).rgb;
  if(uAmount<=0.001){ frag=vec4(col,1.0); return; }
  vec2 e=2.5/uRes;
  float lx=blum(vUv+vec2(e.x,0.0))-blum(vUv-vec2(e.x,0.0));
  float ly=blum(vUv+vec2(0.0,e.y))-blum(vUv-vec2(0.0,e.y));
  // Relief と同じ方式: 弱い勾配(点)だけデッドゾーンで無視し、
  // 勾配に比例した法線で自然な丸い起伏にする (飽和させない)
  float clean=smoothstep(0.005,0.03,length(vec2(lx,ly)));
  lx*=clean; ly*=clean;
  float steep=mix(1.0,2.2,uAmount);
  vec3 n=normalize(vec3(-lx*steep,-ly*steep,0.5));
  // 光源をゆっくり回す
  float a=uTime*0.25;
  mat2 R=mat2(cos(a),-sin(a),sin(a),cos(a));
  vec2 nr=R*n.xy;
  // スタジオ照明バンド (matcap): 上下の帯 + 天窓 + ソフトボックス + 側面窓
  // 環境参照だけ法線を増幅: 起伏は低いまま、緩い傾きでも明暗が大きく振れるクロムのコントラストを出す
  vec2 nrE=clamp(nr*2.6,-1.0,1.0);
  float band=nrE.y*0.5+0.5;
  vec3 env=mix(vec3(0.02,0.025,0.035), vec3(1.25,1.28,1.35), pow(smoothstep(0.05,0.95,band),1.6));
  env+=vec3(1.0)*pow(max(0.0,nrE.y),14.0)*1.2;                    // 天窓の鋭い反射
  env+=vec3(1.05,1.07,1.1)*pow(max(0.0,1.0-abs(nrE.y-0.30)*2.6),5.0)*0.6; // ソフトボックスのハイライト帯
  env+=vec3(0.55,0.62,0.75)*smoothstep(0.5,0.95,abs(nrE.x))*0.55; // 側面の窓
  env+=vec3(0.9)*pow(max(0.0,-nrE.y),12.0)*0.4;                   // 床の照り返し
  // 映像の色味をクロームへ流し込む (金属感を優先して控えめ)
  vec3 tint=col/max(0.35,lum(col));
  vec3 metal=env*mix(vec3(1.0),clamp(tint,0.0,2.2),0.35);
  // 回転光源のスペキュラグリント (縁の上を光の粒が走る)
  vec3 V=vec3(0.0,0.0,1.0);
  vec3 Ldir=normalize(vec3(cos(a*1.7)*0.7, 0.35+0.4*sin(a*1.3), 0.65));
  float spec=pow(max(0.0,dot(reflect(-Ldir,n),V)),80.0);
  metal+=spec*mix(vec3(1.0),clamp(tint,0.0,2.2),0.25)*1.5;
  float fres=pow(1.0-max(0.0,n.z),2.0);
  metal+=fres*vec3(0.25,0.35,0.6)*0.55;
  frag=vec4(mix(col,metal,clamp(uAmount,0.0,1.0)),1.0);
}`);

    // Barcode: 画面をランダム高の行に割り、各行をランダム周期のセルに刻む。
    // 各セルはソースの 1 点を横に引き延ばした色 = 「引き延ばされたピクセル」。
    // セルごとにバー高さ/隙間が変わり、行ごとに違う速さでシードが変異していく。
    // Barcode: 画面をランダム高の行に割り、各行を「元画の 1 点を横に引き延ばしたバー」で敷き詰める。
    // 拡縮の基点は画面中央。地は行の連続ストリーク(=引き延ばした元画)で、素の元画は見せない。
    // Amount: 低=細かい分割(元画像に近い) → 高=少ない太い行・太いバー(抽象化)。
    this._linkDeferred('barcodeProg', `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uAmount, uTime;
float h11(float n){ return fract(sin(n*127.1)*43758.5453); }
void main(){
  vec3 src = texture(uTex, vUv).rgb;
  if(uAmount<=0.001){ frag=vec4(src,1.0); return; }
  float amt = clamp(uAmount, 0.0, 1.0);

  // ── 行分割 (中央基準): 行数は amt 連動。行高は時間で連続伸縮 + 構成も時々組み替え ──
  float fadeIn = smoothstep(0.0, 0.3, amt);   // 0.1(開始)直後は元画像とシームレスに繋がるよう各要素をフェードイン
  float unitBase = mix(300.0, 6.0, amt);
  float unit = max(2.0, unitBase * (0.72 + 0.38*sin(uTime*0.11 + 1.7)));
  float rEp  = floor(uTime*0.15)*13.7;
  float yc   = (vUv.y - 0.5) * unit + 512.0;      // 中央を基点に拡縮
  float iy   = floor(yc);
  float blk  = floor(iy / 4.0);
  float sub  = iy - blk * 4.0;
  float rowStart, rowSize;
  if(h11(blk*1.7 + 3.1 + rEp) < 0.26){ rowStart = blk*4.0; rowSize = 4.0; }
  else {
    float half_ = floor(sub / 2.0);
    if(h11(blk*7.3 + half_*13.7 + 1.9 + rEp) < 0.5){ rowStart = blk*4.0 + half_*2.0; rowSize = 2.0; }
    else { rowStart = iy; rowSize = 1.0; }
  }
  float rowY0 = (rowStart - 512.0) / unit + 0.5;
  float rowH  = rowSize / unit;
  float rowCy = clamp(rowY0 + rowH*0.5, 0.0, 1.0);   // この行の読み取りライン

  // ── 変異: 行ごとに違う速さでシード更新 ──
  float mrate = mix(0.12, 2.4, h11(rowStart*2.3 + 9.1));
  float seed  = rowStart*31.7 + floor(uTime * mrate);

  // ── バーの横伸縮: 行ごとの位相・速さで x を連続ワープ ──
  float wrate = 0.35 + 1.5*h11(rowStart*1.1 + 7.7);
  float wfreq = 6.283 * (0.5 + 1.6*h11(rowStart*2.9 + 5.3));
  float bx = vUv.x + sin(uTime*wrate + vUv.x*wfreq + rowStart*3.3) * 0.14 * amt * fadeIn;

  // ── バー分割 (中央基準): 4 セル階層併合で可変幅 ──
  float segs  = mix(mix(520.0, 28.0, amt), mix(1100.0, 110.0, amt), pow(h11(seed*1.13 + 4.7), 1.4));
  float xc    = (bx - 0.5) * segs + 512.0;
  float ix    = floor(xc);
  float bblk  = floor(ix / 4.0);
  float bsub  = ix - bblk * 4.0;
  float barStart, barSize;
  if(h11(bblk*3.1 + seed*0.7) < 0.30){ barStart = bblk*4.0; barSize = 4.0; }
  else {
    float bh = floor(bsub / 2.0);
    if(h11(bblk*11.3 + bh*5.7 + seed*1.3) < 0.5){ barStart = bblk*4.0 + bh*2.0; barSize = 2.0; }
    else { barStart = ix; barSize = 1.0; }
  }
  float barX0 = (barStart - 512.0) / segs + 0.5;

  // ── バー色: その画素の近傍から拾う ──
  //    ワープ後の座標から拾うと色が横滑りして「遠くから来た」ように見えるため、
  //    無ワープの自分の位置をバー幅で量子化した点 (= すぐ足元) をサンプルする。
  float lq  = floor((vUv.x - 0.5) * segs + 512.0);
  float lx0 = (lq + 0.5 - 512.0) / segs + 0.5;
  vec3 bar = texture(uTex, vec2(clamp(lx0, 0.0, 1.0), rowCy)).rgb;
  //  濃淡は 1.0 を中心に明暗両方向へ振る (乗算のみだと全体が暗く沈むため)
  float lev = mix(0.78, 1.34, h11(barStart*4.3 + seed*0.7));
  vec3 ink = bar * mix(1.0, lev, fadeIn);

  // ── 地(クワイエットゾーン)も「引き延ばし」: 行の読み取りラインの連続ストリークを暗めに ──
  vec3 streak = texture(uTex, vec2(clamp(bx, 0.0, 1.0), rowCy)).rgb;
  float gap = step(0.10 + 0.26*amt, h11(barStart*1.31 + seed*2.7));
  //  クワイエットゾーンも一律に暗くせず、行ごとに明側/暗側へ振る (紙白のバーコードにも見えるように)
  float qLev = mix(0.42, 1.55, h11(rowStart*5.9 + seed*0.31));
  vec3 quiet = streak * mix(1.0, qLev, fadeIn);
  vec3 col = mix(quiet, ink, gap);

  frag = vec4(col, 1.0);
}`);

    this._linkDeferred('gaussianProg', `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uAmount;
vec3 gauss(vec2 uv,float radPx){
  int N=int(min(20.0,20.0+uRes.x*0.0));
  const float GA=2.39996323;
  vec2 rad=radPx/uRes;
  float jit=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)*6.28318;
  vec3 acc=texture(uTex,uv).rgb;
  float wsum=1.0;
  for(int i=0;i<N;i++){
    float fi=(float(i)+0.5)/float(N);
    float r=sqrt(fi), a=float(i)*GA+jit;
    vec2 off=vec2(cos(a),sin(a))*r*rad;
    float wt=exp(-3.0*fi);
    if(fi>0.55){
      acc.r+=texture(uTex,uv+off*0.70).r*wt;
      acc.g+=texture(uTex,uv+off).g*wt;
      acc.b+=texture(uTex,uv+off*1.35).b*wt;
    }else acc+=texture(uTex,uv+off).rgb*wt;
    wsum+=wt;
  }
  return acc/wsum;
}
// mix を 2 倍まで外挿する式 (〜0.5: ふつうのぼかし / 0.5〜: detail が反転し輪郭が際立つ)
void main(){
  vec3 orig=texture(uTex,vUv).rgb;
  if(uAmount<=0.001){ frag=vec4(orig,1.0); return; }
  vec3 blurred=gauss(vUv,uAmount*25.0);
  frag=vec4(clamp(mix(orig,blurred,uAmount*2.0),0.0,1.0),1.0);
}`);

    // Pixel-perfect Outline pass 1: color-aware Scharr gradient + structure-tensor direction.
    this._linkDeferred('outlineEdgeProg', `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex;
vec3 edgeSpace(vec3 c){
  float y=dot(c,vec3(0.2126,0.7152,0.0722));
  float co=(c.r-c.b)*0.5;
  float cg=c.g-(c.r+c.b)*0.5;
  return vec3(y,co*0.68,cg*0.68);
}
vec3 at(ivec2 p){
  ivec2 sz=textureSize(uTex,0);
  return edgeSpace(texelFetch(uTex,clamp(p,ivec2(0),sz-1),0).rgb);
}
void main(){
  ivec2 p=ivec2(gl_FragCoord.xy);
  vec3 tl=at(p+ivec2(-1, 1)), tc=at(p+ivec2(0, 1)), tr=at(p+ivec2(1, 1));
  vec3 ml=at(p+ivec2(-1, 0)),                              mr=at(p+ivec2(1, 0));
  vec3 bl=at(p+ivec2(-1,-1)), bc=at(p+ivec2(0,-1)), br=at(p+ivec2(1,-1));
  vec3 gx=(3.0*(tr-tl)+10.0*(mr-ml)+3.0*(br-bl))/16.0;
  vec3 gy=(3.0*(bl-tl)+10.0*(bc-tc)+3.0*(br-tr))/16.0;
  float jxx=dot(gx,gx), jyy=dot(gy,gy), jxy=dot(gx,gy);
  float theta=0.5*atan(2.0*jxy,jxx-jyy);
  vec2 dir=vec2(cos(theta),sin(theta));
  float mag=sqrt(max(jxx+jyy,0.0));
  float disc=sqrt(max((jxx-jyy)*(jxx-jyy)+4.0*jxy*jxy,0.0));
  float coherence=disc/max(jxx+jyy,0.000001);
  frag=vec4(mag,dir*0.5+0.5,coherence);
}`);

    // Pass 2: 4-direction non-maximum suppression + one-step Canny hysteresis.
    // texelFetch + hard binary output keeps the redrawn contour exactly one output pixel wide.
    this._linkDeferred('outlineDrawProg', `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex, uEdge;
uniform float uAmount;
float em(ivec2 p){
  ivec2 sz=textureSize(uEdge,0);
  return texelFetch(uEdge,clamp(p,ivec2(0),sz-1),0).r;
}
void main(){
  ivec2 sz=textureSize(uTex,0);
  ivec2 p=clamp(ivec2(gl_FragCoord.xy),ivec2(0),sz-1);
  vec4 e=texelFetch(uEdge,p,0);
  vec2 d=e.gb*2.0-1.0;
  vec2 ad=abs(d);
  ivec2 o;
  if(ad.x>ad.y*2.41421356) o=ivec2(1,0);
  else if(ad.y>ad.x*2.41421356) o=ivec2(0,1);
  else o=ivec2(1,(d.x*d.y>=0.0)?1:-1);
  float m=e.r, mf=em(p+o), mb=em(p-o);
  bool ridge=(m>mf && m>=mb);                    // asymmetric tie-break leaves one pixel on flat ridges
  float a=clamp(uAmount,0.0,1.0);
  float high=mix(0.205,0.048,pow(a,0.68));
  float low=high*0.46;
  float nearStrong=0.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    if(x!=0||y!=0) nearStrong=max(nearStrong,em(p+ivec2(x,y)));
  }
  bool linked=(m>=high)||(m>=low&&nearStrong>=high);
  bool directional=(e.a>0.10)||(m>=high*1.35);    // reject weak isotropic texture, retain corners/strong edges
  float ink=(ridge&&linked&&directional)?1.0:0.0;
  vec3 src=texelFetch(uTex,p,0).rgb;
  vec3 pixelOutline=mix(vec3(1.0),vec3(0.0),ink);
  frag=vec4(mix(src,pixelOutline,a),1.0);
}`);

    // Flames owns its long ray-march program. Keeping the 90-step loop out of
    // compositeProg makes all lightweight Post FX available immediately.
    this._linkDeferred('flamesProg', `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uAmount, uTime;
float rvTT;
mat2 rvR2(float r){ return mat2(cos(r),sin(r),-sin(r),cos(r)); }
float rvBox(vec3 p,vec3 b){ vec3 d=abs(p)-b; return length(max(d,0.0))+min(max(d.x,max(d.y,d.z)),0.0); }
float rvMenger(vec3 p){
  float d=rvBox(p,vec3(1.0));
  float s=1.0;
  for(int m=0;m<3;m++){
    vec3 a=mod(p*s,2.0)-1.0;
    s*=3.0;
    vec3 r=abs(1.0-3.0*abs(a));
    float c=(min(max(r.x,r.y),min(max(r.y,r.z),max(r.z,r.x)))-1.0)/s;
    d=max(d,c);
  }
  return d;
}
vec2 rvMap(vec3 p){
  p.xy*=rvR2(rvTT*0.05);
  return vec2(rvMenger(mod(p,2.0)-1.0),3.0);
}
vec2 rvTrace(vec3 ro,vec3 rd,float shape){
  vec2 h,t=vec2(0.1);
  for(int i=0;i<90;i++){
    vec2 sc=rvMap(ro+rd*t.x);
    h=mix(vec2(12.0-t.x,5.0),sc,shape);
    if(h.x<0.0006||t.x>18.0) break;
    t.x+=h.x*0.85; t.y=h.y;
  }
  if(t.x>18.0) t.x=0.0;
  return t;
}
vec3 rvNormal(vec3 p){
  vec2 e=vec2(0.001,0.0);
  return normalize(vec3(
    rvMap(p+e.xyy).x-rvMap(p-e.xyy).x,
    rvMap(p+e.yxy).x-rvMap(p-e.yxy).x,
    rvMap(p+e.yyx).x-rvMap(p-e.yyx).x));
}
float rvRise(float x){ x=pow(clamp(x,0.0,1.0),1.25); return x*x*(3.0-2.0*x); }
void main(){
  vec3 baseCol=texture(uTex,vUv).rgb;
  if(uAmount<=0.00001){ frag=vec4(baseCol,1.0); return; }
  float shape=rvRise(uAmount);
  vec2 uv=vUv-0.5;
  uv/=vec2(uRes.y/uRes.x,1.0);
  rvTT=mod(uTime,1000.0);
  vec3 ro=vec3(0.6*sin(rvTT*0.15),0.5*cos(rvTT*0.12),rvTT*0.9);
  vec3 ta=ro+vec3(0.15*sin(rvTT*0.1),0.1*cos(rvTT*0.11),1.0);
  vec3 cw=normalize(ta-ro);
  vec3 cu=normalize(cross(cw,vec3(0.0,1.0,0.0)));
  vec3 cv=cross(cu,cw);
  vec3 rd=normalize(mat3(cu,cv,cw)*vec3(uv,1.3));
  vec3 col=vec3(0.0);
  float t=rvTrace(ro,rd,shape).x;
  if(t>0.0){
    vec3 nrm=rvNormal(ro+rd*t);
    float depth=clamp(1.2-t*0.10,0.18,1.0);
    float diff=0.45+0.55*clamp(dot(nrm,normalize(vec3(0.5,0.7,0.45))),0.0,1.0);
    col=baseCol*mix(1.0,depth*diff*1.35,shape);
  }
  frag=vec4(col,1.0);
}`);

    // PiP 用: Post FX 適用付き転写プログラム (Slot tex → 小 RGBA8 FBO)
    // Origami (fold) パス: 一枚のキャンバス(紙メッシュ)を頂点シェーダで実際に折りたたむ。
    //   紙平面のグリッドメッシュに順方向の折り(折り線でフラップを 3D 回転)を K 段適用して
    //   ラスタライズする。UV は頂点に固定なので画像は一枚の紙として完全に連続 (柄が飛ばない)。
    //   折り線(紙空間)と 3D 折り軸(前段の折りを適用済み)は JS 側で毎フレーム計算して uniform で渡す。
    //   uAmount×K で折りが 1 段ずつ連続活性化: 0=平面(元画像そのまま全画面) → 1=深く畳まれた塊。
    //   各折りは時間で開閉し続け、Audio ヒットで一段深く折れる。裏面は紙+透けたインク。
    // Kaiser: 一枚のキャンバスをシャープに折りたたむ (ベクター方式)。
    // 紙をポリゴンとして CPU で保持し、折り線で正確に切断してフラップを剛体回転する (毎フレーム)。
    // 折り目は数学的な直線 = グリッド由来のギザギザ/リップルが原理的に出ない。
    // ポリゴン数は数百程度 → 数百万頂点のグリッドより桁違いに軽い。折り目は丸みなしのシャープ。
    {
      const gl = this.gl;
      const KVS = `#version 300 es
precision highp float;
in vec3 aPos;
in vec2 aUv;
in vec3 aNrm;
uniform float uMode;                 // 0=背景(全画面三角形) / 1=紙ポリゴン
uniform mat4 uView, uProj;
uniform mat3 uModel;                 // 紙全体の 3D 回転 (折り重心起点)
uniform vec3 uCenter;                // 折り上がった紙の重心 (JS で計算)
out vec2 vUv; out vec3 vWorld; out vec3 vNormal;
void main(){
  if(uMode < 0.5){                   // 背景: 全画面三角形 (最遠深度)
    vec2 c = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    vUv = c;
    vWorld = vec3(0.0);
    vNormal = vec3(0.0, 0.0, 1.0);
    gl_Position = vec4(c * 2.0 - 1.0, 0.99999, 1.0);
    return;
  }
  vec3 P = uModel * (aPos - uCenter);
  vUv = aUv;
  vNormal = uModel * aNrm;           // (uModel は等方スケール込み → FS で正規化)
  vWorld = P;
  gl_Position = uProj * (uView * vec4(P, 1.0));
}`;
      const KFS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vWorld; in vec3 vNormal; out vec4 frag;
uniform sampler2D uTex;
uniform float uMode, uShade, uBgDark;
uniform vec3 uEye;
void main(){
  if(uMode < 0.5){                   // 背景 = 黒 (低パラメータで速やかに黒へ / uBgDark)
    vec3 b = texture(uTex, vUv).rgb;
    frag = vec4(b * (1.0 - uBgDark), 1.0);
    return;
  }
  vec3 alb = texture(uTex, clamp(vUv, 0.0, 1.0)).rgb;              // 裏面も同じイメージ (裏から見るため左右反転に見える)
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uEye - vWorld);
  if(dot(N, V) < 0.0) N = -N;
  vec3 L = normalize(vec3(2.4, 2.0, 3.0));
  float ndl = max(0.0, dot(N, L));
  vec3 light = vec3(0.50, 0.48, 0.46) * ndl + mix(vec3(0.60, 0.61, 0.64), vec3(0.72), N.y * 0.5 + 0.5);
  float spec = pow(max(0.0, dot(N, normalize(L + V))), 26.0);
  vec3 res = alb * light + vec3(1.0) * spec * 0.10;
  frag = vec4(mix(alb, res, uShade), 1.0);                         // 0 付近は素の画像 → 深折りで陰影
}`;
      const kvs = this._compile(gl.VERTEX_SHADER, KVS);
      const kfs = this._compile(gl.FRAGMENT_SHADER, KFS);
      const prog = this._link(kvs, kfs);
      this.foldProg = (prog && !prog.err) ? prog : null;
      if(!prog || prog.err) console.error('kaiser fold program failed:', prog && prog.err);
      if(this.foldProg){
        this._kaiserAttrs = {
          pos: gl.getAttribLocation(this.foldProg, 'aPos'),
          uv:  gl.getAttribLocation(this.foldProg, 'aUv'),
          nrm: gl.getAttribLocation(this.foldProg, 'aNrm')
        };
      }
    }

    // Kaiser (元 = グリッドメッシュのリボン裂け折り。Kaiser_202607152021.zip 由来)
    // 分割面と最大折り数は単体/統合で共通 (Needle 変位も統合では同じメッシュ上で解像)。
    this._foldGrid = [72, 42];
    this._kaiserOldGrid = this._foldGrid;
    this._foldStackGrid = this._foldGrid;
    this._kaiserOldK = 14;   // Origami と同数に統一
    {
      const gl = this.gl;
      const KVS = `#version 300 es
precision highp float;
uniform vec2 uRes, uGrid;
uniform float uMode, uTwist, uWarp2, uWt2, uCollapse;
uniform mat4 uView, uProj;
uniform vec3 uCenter;                // 折り上がりの重心 → 画面中央に来るよう平行移動
uniform int uFoldN;
uniform vec2 uCreaseP[14];
uniform vec2 uCreaseN[14];
uniform float uTheta[14];
uniform vec3 uAxisO[14];
uniform vec3 uAxisD[14];
out vec2 vUv; out vec3 vWorld;
void main(){
  if(uMode < 0.5){
    vec2 c = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    vUv = c;
    vWorld = vec3(0.0);
    gl_Position = vec4(c * 2.0 - 1.0, 0.99999, 1.0);
    return;
  }
  int vid = gl_VertexID;
  int cell = vid / 6, corner = vid - cell * 6;
  int GW = int(uGrid.x);
  int cx = cell - (cell / GW) * GW, cy = cell / GW;
  vec2 co[6] = vec2[6](vec2(0.,0.), vec2(1.,0.), vec2(1.,1.), vec2(0.,0.), vec2(1.,1.), vec2(0.,1.));
  vec2 uv = (vec2(float(cx), float(cy)) + co[corner]) / uGrid;
  vUv = uv;
  float asp = uRes.x / max(uRes.y, 1.0);
  vec2 q = (uv - 0.5) * 2.0 * vec2(asp, 1.0);
  // 蛇腹プリーツ (三角波): 折り前の紙に鋭い山谷。面は平面のままなので刃の鋭さは保たれ、
  // 裂けたフラップの断面が蛇腹の刃として覗く = Origami との差別化要素
  float jab = uWarp2 * 0.30 * (abs(fract(q.x * 1.5 + uWt2 * 0.055) - 0.5) * 4.0 - 1.0);
  vec3 P = vec3(q, jab);
  for(int i = 0; i < 14; i++){
    if(i >= uFoldN) break;
    float s = dot(q - uCreaseP[i], uCreaseN[i]);   // 側判定は「元の紙座標」= 前の折りを横切るとリボン状に裂ける
    float k = clamp(-s / 0.0022, 0.0, 1.0);         // 折り目をほぼハードエッジに = 刃のように鋭い
    if(k > 0.0){
      float th = uTheta[i] * k;
      vec3 ax = uAxisD[i];
      vec3 rel = P - uAxisO[i];
      float ct = cos(th), st = sin(th);
      P = uAxisO[i] + rel * ct + cross(ax, rel) * st + ax * dot(ax, rel) * (1.0 - ct);
    }
  }
  P -= uCenter;                      // 折り重心を原点へ = 画面中央に固定
  // 最後に全体を巨大変形 (面はフラットのまま = 角丸が出ない大域変形)
  float ang = P.y * uTwist + uWt2 * 0.3;           // 高さに沿った巨大なひねり
  float cs = cos(ang), sn = sin(ang);
  P.xz = mat2(cs, -sn, sn, cs) * P.xz;
  // 直交ひねり (雑巾絞り): x に沿った第2のねじり軸
  float ang2 = q.x * uTwist * 0.45 - uWt2 * 0.22;
  float c2 = cos(ang2), s2 = sin(ang2);
  P.yz = mat2(c2, -s2, s2, c2) * P.yz;
  P.z += uWarp2 * sin(P.x * 0.8 + uWt2)            // 大域の低周波うねり
       + uWarp2 * 0.7 * cos(P.y * 0.6 - uWt2 * 0.8);
  P *= uCollapse;                    // ブラックホール: 周期的に原点(画面中央)へ吸い込まれ 0 になる
  vWorld = P;
  gl_Position = uProj * (uView * vec4(P, 1.0));
}`;
      const KFS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vWorld; out vec4 frag;
uniform sampler2D uTex;
uniform float uMode, uShade, uBgDark;
uniform vec3 uEye;
void main(){
  if(uMode < 0.5){
    vec3 b = texture(uTex, vUv).rgb;
    frag = vec4(b * (1.0 - uBgDark), 1.0);
    return;
  }
  vec3 alb = texture(uTex, clamp(vUv, 0.0, 1.0)).rgb;              // 裏面も同じイメージ (裏から見るため左右反転に見える)
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 V = normalize(uEye - vWorld);
  if(dot(N, V) < 0.0) N = -N;
  vec3 L = normalize(vec3(2.4, 2.0, 3.0));
  float ndl = max(0.0, dot(N, L));
  vec3 light = vec3(1.06, 1.02, 0.96) * ndl + mix(vec3(0.50, 0.52, 0.56), vec3(0.74), N.y * 0.5 + 0.5);
  float spec = pow(max(0.0, dot(N, normalize(L + V))), 26.0);
  vec3 res = alb * light + vec3(1.0) * spec * 0.20;
  frag = vec4(mix(alb, res, uShade), 1.0);
}`;
      const kvs = this._compile(gl.VERTEX_SHADER, KVS);
      const kfs = this._compile(gl.FRAGMENT_SHADER, KFS);
      const kprog = this._link(kvs, kfs);
      this.kaiserOldProg = (kprog && !kprog.err) ? kprog : null;
      if(!kprog || kprog.err) console.error('kaiser(grid) program failed:', kprog && kprog.err);

      // ── 統合折りエンジン (Needle 変位 + Origami 折り + Kaiser 折り + ひねり を1メッシュの頂点で合成) ──
      // スライダーが2つ以上上がったとき起動。単体時は従来の各パスを使う。
      const FVS = `#version 300 es
precision highp float;
uniform vec2 uRes, uGrid;
uniform float uMode, uTwist, uWarp2, uWt2, uNeedleAmt, uNt, uFitScale;
uniform float uBeat, uBeatMode, uHit;
uniform mat4 uView, uProj;
uniform vec3 uCenter;
uniform int uFoldN;
uniform vec2 uCreaseP[28];
uniform vec2 uCreaseN[28];
uniform float uTheta[28];
uniform float uEps[28];
uniform vec3 uAxisO[28];
uniform vec3 uAxisD[28];
out vec2 vUv; out vec3 vWorld;
float h1(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// Needle: 格子状に丘 + 針(尖ったコーン)。針座標を max 合成 → 鋭い先端
float needleH(vec2 q, float t){
  vec2 g = q * 3.0, gi = floor(g);
  float hill = 0.0, C = 0.0;   // hill=緩やかな起伏, C=最も突出した凹凸(山/谷)
  // Beat モード: 単体 Needle と同じく拍ごとの乱数目標へ Ease Out で変形 (拍頭で大きく動く)
  float bid = floor(uBeat);
  float ease = 1.0 - pow(1.0 - clamp(fract(uBeat) / 0.24, 0.0, 1.0), 3.0);
  for(int dy = -1; dy <= 1; dy++){
    for(int dx = -1; dx <= 1; dx++){
      vec2 cell = gi + vec2(float(dx), float(dy));
      float r1 = h1(cell + 0.13), r2 = h1(cell + 7.7), r3 = h1(cell + 3.3);
      vec2 c = (cell + vec2(0.2 + 0.6 * r1, 0.2 + 0.6 * r3)) / 3.0;
      // Each nucleus drifts continuously at its own rate. Moving the height-field center in VS keeps
      // facets, normals and depth coherent when Needle is combined with Origami / Kaiser.
      float driftRate = mix(0.16,0.38,h1(cell+19.4));
      float driftAmp = mix(0.055,0.125,h1(cell+31.7));
      vec2 drift = vec2(
        sin(t*driftRate+r1*6.2831),
        cos(t*driftRate*0.83+r3*6.2831)
      )*driftAmp;
      c += drift;
      float d = length(q - c);
      hill += 0.04 * exp(-d * d * 6.0) * (0.4 * sin(t * 0.32 + r1 * 6.2831));
      if(r2 < 0.5){
        // 高さを二極化: 低い針と高い針が隣り合う極端なギザギザ (単体 Needle と同じ)
        float jr = h1(cell + 9.9);
        float amp = (jr < 0.45) ? mix(0.05, 0.35, jr / 0.45) : mix(1.05, 1.9, pow(h1(cell + 1.1), 3.0));
        // osc の符号で 山(+)/谷(-)。時間で行き来し、山が急に谷にもなる。
        float osc = sin(t * (0.22 + 0.26 * r1) + h1(cell + 5.5) * 6.2831);
        osc = sign(osc) * pow(abs(osc), 0.5);              // 中間を素早く通り山/谷に長く留まる = 急な反転
        float bA = h1(cell + bid * 7.7 + 11.3) * 2.0 - 1.0;
        float bB = h1(cell + (bid + 1.0) * 7.7 + 11.3) * 2.0 - 1.0;
        float bosc = mix(bA, bB, ease);
        bosc = sign(bosc) * pow(abs(bosc), 0.5);
        osc = mix(osc, bosc, uBeatMode);                   // beat: 拍ごとの目標 / drone: 連続サイン
        float cone = osc * amp * max(0.0, 1.0 - d * 6.0);  // 山も谷も同じ鋭い円錐
        if(abs(cone) > abs(C)) C = cone;                   // 最も突出した凹凸を採用
      }
    }
  }
  return C + hill;
}
void main(){
  if(uMode < 0.5){
    vec2 c = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    vUv = c;
    vWorld = vec3(0.0);
    gl_Position = vec4(c * 2.0 - 1.0, 0.99999, 1.0);
    return;
  }
  int vid = gl_VertexID;
  int cell = vid / 6, corner = vid - cell * 6;
  int GW = int(uGrid.x);
  int cx = cell - (cell / GW) * GW, cy = cell / GW;
  vec2 co[6] = vec2[6](vec2(0.,0.), vec2(1.,0.), vec2(1.,1.), vec2(0.,0.), vec2(1.,1.), vec2(0.,1.));
  vec2 uv = (vec2(float(cx), float(cy)) + co[corner]) / uGrid;
  vUv = uv;
  float asp = uRes.x / max(uRes.y, 1.0);
  vec2 q = (uv - 0.5) * 2.0 * vec2(asp, 1.0);
  // Needle 変位を折り前に足す。ヒット増幅は単体 Needle の depth 係数と同じ (beat 0.46 / drone 0.10)
  float nHitBoost = 1.0 + mix(0.10, 0.46, uBeatMode) * pow(clamp(uHit, 0.0, 1.0), 0.65);
  float nz = uNeedleAmt > 0.001 ? needleH(q, uNt) * uNeedleAmt * nHitBoost : 0.0;
  // 蛇腹プリーツ (三角波): Kaiser 固有の折り前変形 (単体 Kaiser と同じ)
  float jab = uWarp2 * 0.30 * (abs(fract(q.x * 1.5 + uWt2 * 0.055) - 0.5) * 4.0 - 1.0);
  vec3 P = vec3(q, nz + jab);
  for(int i = 0; i < 28; i++){
    if(i >= uFoldN) break;
    float s = dot(q - uCreaseP[i], uCreaseN[i]);   // 側判定は元の紙座標
    float k = clamp(-s / uEps[i], 0.0, 1.0);
    if(k > 0.0){
      float th = uTheta[i] * k;
      vec3 ax = uAxisD[i];
      vec3 rel = P - uAxisO[i];
      float ct = cos(th), st = sin(th);
      P = uAxisO[i] + rel * ct + cross(ax, rel) * st + ax * dot(ax, rel) * (1.0 - ct);
    }
  }
  P -= uCenter;
  // ひねりは折り前の紙座標基準 (静的レバー): 折りの運動が P.y 経由で高速回転に増幅されるのを防ぐ
  float ang = q.y * uTwist + uWt2 * 0.3;
  float cs = cos(ang), sn = sin(ang);
  P.xz = mat2(cs, -sn, sn, cs) * P.xz;
  // 直交ひねり (雑巾絞り): x に沿った第2のねじり軸 (単体 Kaiser と同じ)
  float ang2 = q.x * uTwist * 0.45 - uWt2 * 0.22;
  float c2 = cos(ang2), s2 = sin(ang2);
  P.yz = mat2(c2, -s2, s2, c2) * P.yz;
  P.z += uWarp2 * sin(P.x * 0.8 + uWt2) + uWarp2 * 0.7 * cos(P.y * 0.6 - uWt2 * 0.8);
  P *= uFitScale;                    // 折り上がりの大きさを一定化 (サイズがまちまちにならない)
  vWorld = P;
  gl_Position = uProj * (uView * vec4(P, 1.0));
}`;
      // 統合 FS: 紙 (Origami/Kaiser 単体と同一のシェーディング) と結晶 (単体 Needle の
      // 屈折/フレネル/内部反射) を効果量の比 uNeedleMix でブレンド = 3種の合わせ技。
      // 裏面も表と同じイメージ (裏から見るため左右反転に見える)。
      const FFS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vWorld; out vec4 frag;
uniform sampler2D uTex;
uniform float uMode, uShade, uBgDark, uNeedleAmt, uNeedleMix;
uniform vec3 uEye;
void main(){
  if(uMode < 0.5){
    vec3 b = texture(uTex, vUv).rgb;
    frag = vec4(b * (1.0 - uBgDark), 1.0);
    return;
  }
  vec2 uv = clamp(vUv, 0.0, 1.0);
  vec3 alb = texture(uTex, uv).rgb;
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 V = normalize(uEye - vWorld);
  if(dot(N, V) < 0.0) N = -N;
  vec3 L = normalize(vec3(2.4, 2.0, 3.0));
  float ndl = max(0.0, dot(N, L));
  float specBase = max(0.0, dot(N, normalize(L + V)));
  // 紙 (Origami / Kaiser): 単体パスと同一
  vec3 light = vec3(1.06, 1.02, 0.96) * ndl + mix(vec3(0.50, 0.52, 0.56), vec3(0.74), N.y * 0.5 + 0.5);
  vec3 paper = alb * light + vec3(1.0) * pow(specBase, 26.0) * 0.20;
  // 結晶 (Needle): 元映像を内部反射へ使う質感を移植
  float NoV = max(dot(N, V), 0.0);
  float namp = clamp(uNeedleAmt, 0.0, 1.0);
  vec2 refrOff = N.xy * (0.0015 + 0.0095 * namp) * (0.35 + 0.65 * (1.0 - NoV));
  vec3 frontSample = texture(uTex, clamp(uv + refrOff, 0.0, 1.0)).rgb;
  vec3 innerSample = texture(uTex, clamp(uv - refrOff * 1.85, 0.0, 1.0)).rgb;
  vec3 R = reflect(-V, N);
  vec3 reflSample = texture(uTex, clamp(uv + R.xy * (0.014 + 0.050 * namp), 0.0, 1.0)).rgb;
  float fres = 0.055 + 0.945 * pow(1.0 - NoV, 5.0);
  vec3 crystal = mix(alb, frontSample, 0.14 * namp);
  crystal = mix(crystal, innerSample, 0.10 + 0.08 * namp);
  crystal *= mix(0.58, 1.18, smoothstep(0.08, 0.92, ndl));
  float tir = smoothstep(0.18, 0.82, 1.0 - NoV);
  crystal = mix(crystal, reflSample * 0.9 + crystal * 0.18, tir * (0.10 + 0.22 * namp));
  crystal += vec3(1.0) * (pow(specBase, 96.0) * 1.6 + fres * fres * 0.10);
  crystal = mix(crystal, alb, 0.24);
  vec3 res = mix(paper, crystal, uNeedleMix);
  frag = vec4(mix(alb, res, uShade), 1.0);
}`;
      const fvs = this._compile(gl.VERTEX_SHADER, FVS);
      const ffs = this._compile(gl.FRAGMENT_SHADER, FFS);
      const fprog = this._link(fvs, ffs);
      this.foldStackProg = (fprog && !fprog.err) ? fprog : null;
      if(!fprog || fprog.err) console.error('foldStack program failed:', fprog && fprog.err);
    }

    // Feedback ブレンド (独立ポストパス): 合成シェーダ内ではなく fold などの後段で適用する。
    this._linkDeferred('feedbackProg', `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex, uFbTex;
uniform float uFbAdd, uFbMultiply, uFbZoom, uFbRot;
void main(){
  vec3 col = texture(uTex, vUv).rgb;
  vec2 q = vUv - 0.5;
  float fa = uFbRot * 0.15;
  float fc = cos(fa), fs = sin(fa);
  q = vec2(q.x*fc - q.y*fs, q.x*fs + q.y*fc);
  q /= (1.0 + uFbZoom*0.06);
  vec3 fb = texture(uFbTex, q + 0.5).rgb;
  if(uFbAdd > 0.001){ float g = 0.55 + 0.44*clamp(uFbAdd,0.0,1.0); col = max(col, fb*g); }
  if(uFbMultiply > 0.001){ float g = 0.55 + 0.44*clamp(uFbMultiply,0.0,1.0); col = min(col, mix(vec3(1.0), fb, g)); }
  frag = vec4(col, 1.0);
}`);

    this._linkDeferred('pipProg', MINI_FX_FS);

    // FXAA (1パス, NVIDIA Timothy Lottes 風の軽量版)
    this._linkDeferred('fxaaProg', `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex;
uniform vec2 uTexel;
const float EDGE_MIN = 1.0/128.0;
const float EDGE_MAX = 1.0/8.0;
const float SPAN_MAX = 8.0;
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec3 c  = texture(uTex, vUv).rgb;
  vec3 nw = texture(uTex, vUv + vec2(-1.0,-1.0)*uTexel).rgb;
  vec3 ne = texture(uTex, vUv + vec2( 1.0,-1.0)*uTexel).rgb;
  vec3 sw = texture(uTex, vUv + vec2(-1.0, 1.0)*uTexel).rgb;
  vec3 se = texture(uTex, vUv + vec2( 1.0, 1.0)*uTexel).rgb;
  float lc = lum(c), lnw = lum(nw), lne = lum(ne), lsw = lum(sw), lse = lum(se);
  float lmin = min(lc, min(min(lnw, lne), min(lsw, lse)));
  float lmax = max(lc, max(max(lnw, lne), max(lsw, lse)));
  vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), ((lnw + lsw) - (lne + lse)));
  float dirRed = max((lnw + lne + lsw + lse) * 0.25 * EDGE_MAX, EDGE_MIN);
  float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirRed);
  dir = clamp(dir * rcpMin, vec2(-SPAN_MAX), vec2(SPAN_MAX)) * uTexel;
  vec3 a = 0.5 * (texture(uTex, vUv + dir*(1.0/3.0 - 0.5)).rgb
                + texture(uTex, vUv + dir*(2.0/3.0 - 0.5)).rgb);
  vec3 b = a*0.5 + 0.25*(texture(uTex, vUv + dir*-0.5).rgb
                       + texture(uTex, vUv + dir* 0.5).rgb);
  float lb = lum(b);
  frag = vec4((lb < lmin || lb > lmax) ? a : b, 1.0);
}`);

    // Slit-scan (移動式 / 参照元スクロール) ポストパス:
    //   前フレームのバッファをスクロールし、注入端に現在フレームを入れる。
    //   ただし注入は固定エッジ線の繰り返しではなく、参照元(source)の読み取り位置も帯内でずらして読む
    //   → 時間とともに全ての行が取り込まれ、エッジ線のスメアにならず映像全体がロールする。
    this._linkDeferred('slitProg', `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uLive;    // 現在のクリーンフレーム(注入源)
uniform sampler2D uPrev;    // 前フレームの slit バッファ
uniform float uScroll;      // 1フレームのスクロール量(帯内ローカルUV, >=0)
uniform float uSrcPos;      // 参照元の読み取り位置(帯内0..1, スクロールと同期して進む)
uniform float uSign;        // +1/-1 スクロール方向
uniform float uBands;       // 画面の縦分割数
uniform float uSlitSize;    // 書き込みスリットの高さ(帯内ローカルUV)
uniform float uSeed;        // 帯高さランダム用シード
uniform vec2 uRes;          // 線幅を1px基準にするための解像度
uniform vec3 uFxLineCol;    // 線色: キャンバスの支配的な鮮やか色相 or 明暗反転色(inkelly方式)
uniform float uFxLineOn;    // 1=採用 / 0=従来の白黒フォールバック
float h11(float n){ return fract(sin(n*127.1)*43758.5453); }
float slitWeight(float i, float count, float seed){
  float t = h11(i*1.7 + seed*3.1 + 0.5);
  if(count < 4.5) return 0.65 + 0.70*h11(i*5.0 + seed);       // 低分割は極端に細い帯を作らない
  if(t < 0.12)      return 2.70 + 0.95*h11(i*5.0 + seed);     // 大
  else if(t < 0.30) return 0.22 + 0.32*h11(i*7.0 + seed);     // 細
  return 0.75 + 1.05*h11(i*9.0 + seed);                       // 中
}
void main(){
  float count = clamp(floor(uBands + 0.5), 1.0, 64.0);
  float total = 0.0;
  int _sl1 = int(min(64.0, 64.0 + uBands * 0.0));   // ループ展開抑止
  for(int i = 0; i < _sl1; i++){
    float fi = float(i);
    if(fi >= count) break;
    total += slitWeight(fi, count, uSeed);
  }
  float bandStart = 0.0, bandH = 1.0;
  float pos = 0.0;
  int _sl2 = int(min(64.0, 64.0 + uBands * 0.0));   // ループ展開抑止
  for(int i = 0; i < _sl2; i++){
    float fi = float(i);
    if(fi >= count) break;
    float hh = slitWeight(fi, count, uSeed) / max(total, 0.0001);
    bandStart = pos;
    bandH = hh;
    if(vUv.y < pos + hh || fi >= count - 1.0) break;
    pos += hh;
  }
  float localY = clamp((vUv.y - bandStart) / max(bandH, 0.0001), 0.0, 1.0);
  float e = (uSign >= 0.0) ? localY : (1.0 - localY);       // 各帯の注入端(e=0)からの距離
  float writeH = max(uScroll, clamp(uSlitSize, 0.0, 1.0));
  vec3 outc;
  if(e < writeH){
    float srcE = fract(uSrcPos + e);                       // 参照元も帯内でずらす → 該当するキャンバス範囲を取り込む
    float srcLocal = (uSign >= 0.0) ? srcE : (1.0 - srcE);
    float srcVy = bandStart + srcLocal * bandH;
    outc = texture(uLive, vec2(vUv.x, srcVy)).rgb;
  } else {
    float pe = e - uScroll;                                // 前バッファを帯内で uScroll だけスクロール
    float prevLocal = (uSign >= 0.0) ? pe : (1.0 - pe);
    float pvy = bandStart + prevLocal * bandH;
    outc = texture(uPrev, vec2(vUv.x, pvy)).rgb;
  }
  // 帯と帯の境界に1px前後の線を追加。地色の輝度に応じて白/黒を自動反転する。
  float topInterior = step(0.001, bandStart);
  float bottomInterior = step(bandStart + bandH, 0.999);
  float dTop = (topInterior > 0.5) ? localY : 1.0;
  float dBottom = (bottomInterior > 0.5) ? (1.0 - localY) : 1.0;
  // 各帯の中で live と prev が切り替わる位置も「スリットの切れ目」として線を引く。
  float slitEdge = (writeH < 0.999) ? abs(e - writeH) : 1.0;
  float edgeDist = min(min(dTop, dBottom), slitEdge);
  // 境界の両側を含めず、最寄りの1pxだけを線にする。
  float lineW = max(0.00005, 0.5 * fwidth(localY));
  float lineMask = step(edgeDist, lineW);
  // 境界自身の画素ではなく、上下1pxの現在地色を平均して線色を決める。
  // これで明るい断片/暗い断片が線上に重なっても、線が地色へ埋もれにくい。
  float ypx = 1.0 / max(uRes.y, 1.0);
  vec3 edgeBase = 0.5 * (texture(uLive, vec2(vUv.x, clamp(vUv.y - ypx, 0.0, 1.0))).rgb
                      + texture(uLive, vec2(vUv.x, clamp(vUv.y + ypx, 0.0, 1.0))).rgb);
  float baseLuma = dot(edgeBase, vec3(0.299, 0.587, 0.114));
  vec3 lineCol = (uFxLineOn > 0.5) ? uFxLineCol : ((baseLuma < 0.48) ? vec3(1.0) : vec3(0.0));
  outc = mix(outc, lineCol, lineMask);
  frag = vec4(outc, 1.0);                                  // 純粋なロール(帰還用) / スライス・フェードは別パス
}`);

    // Slice パス: クリーンなロールバッファを表示に溶かし込む。
    //   パラメータは速度ではなく分割数だけに使う → 低値は大きな1〜数本、高値ほど細かい帯。
    this._linkDeferred('sliceProg', `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uRoll;    // クリーンなロールバッファ
uniform sampler2D uLive;    // 現在フレーム(フェード先)
uniform vec2 uRes;          // texelFetch用の解像度
uniform float uFade;        // 0..1 効果の溶かし込み
void main(){
  vec3 live = texture(uLive, vUv).rgb;
  if(uFade <= 0.001){ frag = vec4(live, 1.0); return; }
  ivec2 ip = ivec2(clamp(vUv * uRes, vec2(0.0), uRes - 1.0));
  vec3 sliced = texelFetch(uRoll, ip, 0).rgb;
  frag = vec4(mix(live, sliced, clamp(uFade, 0.0, 1.0)), 1.0);
}`);

    // Datamosh: source pixels are moved as opaque macroblocks instead of color-processed trails.
    // Integer texel copies preserve the source hue/luminance while temporal block reuse creates datamosh.
    this._linkDeferred('glitchProg', `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uPrev;
uniform sampler2D uCur;
uniform vec2 uRes;
uniform float uTime;
uniform float uBeat;
uniform float uMode;
uniform float uAmt;
float hash12(vec2 p){
  vec3 p3=fract(vec3(p.xyx)*0.1031);
  p3+=dot(p3,p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}
vec2 hash22(vec2 p){
  float n=hash12(p);
  return vec2(n,hash12(p+n+19.19));
}
ivec2 safePx(ivec2 p,ivec2 sz){ return clamp(p,ivec2(0),sz-1); }
void mondrianCell(vec2 uv,float a,out vec2 lo,out vec2 hi,out float id){
  lo=vec2(0.0); hi=vec2(1.0); id=1.0;
  float maxDepth=floor(mix(4.0,6.0,pow(a,0.78))+0.5);
  for(int i=0;i<6;i++){
    if(float(i)>=maxDepth) break;
    if(i==1){
      float keepLarge=hash12(lo*23.9+hi*41.7+vec2(id*0.81,59.2));
      if(keepLarge<mix(0.22,0.13,a)) break;       // preserve some almost-unsplit half-screen faces
    }
    // Different branches stop at different depths: very large and very small faces coexist.
    if(i>=2){
      float stopRnd=hash12(lo*47.1+hi*19.3+vec2(id*0.63,71.9));
      float stopChance=mix(0.34,0.22,a);
      if(stopRnd<stopChance) break;
    }
    vec2 spanPx=(hi-lo)*uRes;
    if(max(spanPx.x,spanPx.y)<9.0) break;
    float axisRnd=hash12(lo*13.7+hi*29.1+vec2(id*0.37,17.3));
    bool splitX=(spanPx.x>spanPx.y*1.22)||(spanPx.x>9.0&&axisRnd<0.48);
    if(spanPx.x<8.0) splitX=false;
    if(spanPx.y<6.0) splitX=true;
    float sr=hash12(lo*31.3+hi*11.9+vec2(id*0.91,43.7));
    float t;
    if(sr<0.10) t=0.055+sr*1.05;                // rare very thin faces expand the size jump ratio
    else if(sr>0.90) t=0.84+(sr-0.90)*1.05;
    else t=0.20+(sr-0.10)*(0.60/0.80);
    t=clamp(t+0.055*sin(uTime*0.19+id*1.73),0.07,0.93);
    if(splitX){
      float s=mix(lo.x,hi.x,t);
      if(uv.x<s){ hi.x=s; id=id*2.0+1.0; }
      else       { lo.x=s; id=id*2.0+2.0; }
    }else{
      float s=mix(lo.y,hi.y,t);
      if(uv.y<s){ hi.y=s; id=id*2.0+1.0; }
      else       { lo.y=s; id=id*2.0+2.0; }
    }
  }
}
void main(){
  ivec2 sz=ivec2(uRes);
  ivec2 ip=safePx(ivec2(gl_FragCoord.xy),sz);
  if(uMode < 0.5){
    float a=clamp(uAmt,0.0,1.0);
    // Mondrian subdivision supplies irregular MPEG-like prediction regions.
    vec2 uv=(vec2(ip)+0.5)/uRes;
    vec2 cellLo,cellHi;
    float cellId;
    mondrianCell(uv,a,cellLo,cellHi,cellId);
    vec2 region=vec2(cellId,hash12(cellLo+cellHi)*37.0);
    float syncPick=hash12(region+vec2(23.7,91.1));
    float cellArea=(cellHi.x-cellLo.x)*(cellHi.y-cellLo.y);
    float fineBias=1.0-smoothstep(0.012,0.16,cellArea);
    float largeBias=smoothstep(0.20,0.48,cellArea);
    syncPick=clamp(syncPick-fineBias*0.28+largeBias*0.30,0.0,0.9999);
    float beatStep;
    if(syncPick<0.22) beatStep=0.0;               // 1/16 beat
    else if(syncPick<0.42) beatStep=1.0;          // 1/8 beat
    else if(syncPick<0.58) beatStep=2.0;          // 1/4 beat
    else if(syncPick<0.70) beatStep=3.0;          // 1/2 beat
    else if(syncPick<0.80) beatStep=4.0;          // 1 beat
    else if(syncPick<0.87) beatStep=5.0;          // 2 beats
    else if(syncPick<0.93) beatStep=6.0;          // 4 beats
    else if(syncPick<0.97) beatStep=7.0;          // 8 beats
    else beatStep=8.0;                            // 16 beats
    float cellBeats=exp2(beatStep-4.0);
    float vectorPhase=uBeat/cellBeats;
    float vectorTick=floor(vectorPhase);
    float vectorBlend=smoothstep(0.0,1.0,fract(vectorPhase));
    float regionTick=floor(uBeat*0.5);
    float regionGate=hash12(region+vec2(regionTick*0.71,regionTick*1.13));
    bool mosh=regionGate<mix(0.12,0.92,pow(a,0.68));

    // A stable per-region motion vector is applied a few pixels per frame; feedback accumulates it into trails.
    vec2 rnd0=hash22(region+vec2(vectorTick*0.43,vectorTick*0.79));
    vec2 rnd1=hash22(region+vec2((vectorTick+1.0)*0.43,(vectorTick+1.0)*0.79));
    vec2 rnd=mix(rnd0,rnd1,vectorBlend)-0.5;
    ivec2 anchor=safePx(ivec2(((cellLo+cellHi)*0.5)*uRes),sz);
    vec3 anchorCol=texelFetch(uPrev,anchor,0).rgb;
    vec2 colorDir=vec2(anchorCol.r-anchorCol.b,anchorCol.g-(anchorCol.r+anchorCol.b)*0.5);
    vec2 dir=rnd+colorDir*0.85;
    dir/=max(length(dir),0.12);
    float speedRnd0=hash12(region+vec2(vectorTick*1.31,61.7));
    float speedRnd1=hash12(region+vec2((vectorTick+1.0)*1.31,61.7));
    float speedRnd=mix(speedRnd0,speedRnd1,vectorBlend);
    float speedMul=mix(0.15,4.6,pow(speedRnd,2.65));
    float stepPx=mix(0.85,8.6,pow(a,0.90))*speedMul;
    vec2 mv=dir*stepPx;
    // Broad horizontal or vertical prediction errors add directional datamosh pulls.
    float band=floor(((cellLo.y+cellHi.y)*0.5)*uRes.y/72.0);
    float tear=hash12(vec2(band,vectorTick*0.37));
    if(tear<0.10+0.24*a){
      float side=hash12(vec2(band,vectorTick+17.0))<0.5?-1.0:1.0;
      float tearDist=side*mix(3.0,20.0,a)*mix(0.35,1.0,speedRnd);
      if(hash12(region+vec2(vectorTick,29.3))<0.5) mv.x+=tearDist;
      else mv.y+=tearDist;
    }
    // A narrow prediction band races across the frame and leaves its displaced result in feedback.
    float scanClock=uBeat*2.0;                    // one complete sweep per 1/2 beat
    float scanCycle=floor(scanClock);
    float scanHead=fract(scanClock);
    bool scanReverse=hash12(vec2(scanCycle,14.7))<0.5;
    if(scanReverse) scanHead=1.0-scanHead;
    bool verticalScan=hash12(vec2(scanCycle,38.1))>0.78;
    float scanAxisPx=verticalScan?float(ip.x):float(ip.y);
    float scanSizePx=verticalScan?uRes.x:uRes.y;
    float scanWidth=mix(3.0,24.0,hash12(vec2(scanCycle,91.3)))*mix(0.65,1.25,a);
    float scanHeadPx=scanHead*scanSizePx;
    float shortMask=step(abs(scanAxisPx-scanHeadPx),scanWidth);
    bool longStroke=hash12(vec2(scanCycle,66.2))<mix(0.14,0.38,a);
    float strokeRnd=hash12(vec2(scanCycle,103.7));
    float strokeLength=mix(48.0,180.0,pow(strokeRnd,0.62))*mix(0.75,1.35,a);
    float behind=scanReverse?(scanAxisPx-scanHeadPx):(scanHeadPx-scanAxisPx);
    float longMask=step(0.0,behind)*step(behind,strokeLength);
    float scanMask=longStroke?longMask:shortMask;
    // Clip most scan bands into independent spans and selected Mondrian faces.
    float scanOrtho=verticalScan?uv.y:uv.x;
    float scanSegments=0.0;
    for(int s=0;s<2;s++){
      float fs=float(s);
      float segCenter=hash12(vec2(scanCycle*7.3+fs*19.1,141.7));
      float segHalf=mix(0.055,0.27,hash12(vec2(scanCycle*3.9+fs*11.7,157.2)));
      scanSegments=max(scanSegments,step(abs(scanOrtho-segCenter),segHalf));
    }
    float scanFaceGate=step(hash12(region+vec2(scanCycle*2.3,166.4)),mix(0.42,0.72,a));
    float scanFull=step(hash12(vec2(scanCycle,174.8)),0.055);
    scanMask*=max(scanFull,scanSegments*scanFaceGate);
    float scanSide=hash12(vec2(scanCycle,53.9))<0.5?-1.0:1.0;
    float scanDist=scanSide*mix(10.0,132.0,pow(a,0.82))
                  *mix(0.35,1.0,hash12(vec2(scanCycle,77.7)));
    if(longStroke) scanDist*=mix(1.45,2.8,strokeRnd);
    if(verticalScan) mv.y+=scanMask*scanDist;
    else{
      mv.x+=scanMask*scanDist;
      float scanWaves=mix(2.0,8.0,hash12(vec2(scanCycle,119.4)));
      float scanWave=sin((float(ip.x)/uRes.x)*6.2831853*scanWaves
                        +uTime*mix(5.0,14.0,a)+scanCycle*1.71);
      float scanWaveAmp=mix(2.0,34.0,pow(a,0.78))
                       *mix(0.35,1.0,hash12(vec2(scanCycle,127.8)));
      if(longStroke) scanWaveAmp*=1.55;
      mv.y+=scanMask*scanWave*scanWaveAmp;
    }

    // Clustered scan errors: several hard shifts fire rapidly, followed by a short pause.
    float burstClock=uBeat;                       // one clustered burst per beat
    float burstGroup=floor(burstClock);
    float burstPhase=fract(burstClock);
    float burstSpan=mix(0.42,0.68,hash12(vec2(burstGroup,12.4)));
    float burstShots=floor(mix(3.0,8.0,hash12(vec2(burstGroup,31.8))));
    float shotCoord=(burstPhase/max(burstSpan,0.001))*burstShots;
    float shotIndex=floor(shotCoord);
    float shotPhase=fract(shotCoord);
    float shotOn=step(burstPhase,burstSpan)*step(shotPhase,mix(0.30,0.48,a));
    vec2 shotSeed=vec2(burstGroup*11.7+shotIndex*3.1,burstGroup*5.3+shotIndex*17.9);
    bool burstVertical=hash12(shotSeed+4.2)>0.82;
    float burstAxisPx=burstVertical?float(ip.x):float(ip.y);
    float burstSizePx=burstVertical?uRes.x:uRes.y;
    float burstPos=hash12(shotSeed+21.6)*burstSizePx;
    float burstWidth=mix(4.0,32.0,pow(hash12(shotSeed+44.1),1.4));
    float burstMask=shotOn*step(abs(burstAxisPx-burstPos),burstWidth);
    float burstOrtho=burstVertical?uv.y:uv.x;
    float burstSegments=0.0;
    for(int s=0;s<2;s++){
      float fs=float(s);
      float segCenter=hash12(shotSeed+vec2(fs*13.7,181.2));
      float segHalf=mix(0.04,0.22,hash12(shotSeed+vec2(fs*23.1,197.6)));
      burstSegments=max(burstSegments,step(abs(burstOrtho-segCenter),segHalf));
    }
    float burstFaceGate=step(hash12(region+shotSeed*0.17),mix(0.38,0.68,a));
    float burstFull=step(hash12(shotSeed+211.4),0.04);
    burstMask*=max(burstFull,burstSegments*burstFaceGate);
    float burstSide=hash12(shotSeed+72.5)<0.5?-1.0:1.0;
    float burstDist=burstSide*mix(14.0,190.0,pow(a,0.78))
                   *mix(0.25,1.0,pow(hash12(shotSeed+88.3),0.55));
    if(burstVertical) mv.y+=burstMask*burstDist;
    else{
      mv.x+=burstMask*burstDist;
      float burstWaves=mix(3.0,11.0,hash12(shotSeed+131.6));
      float burstWave=sin((float(ip.x)/uRes.x)*6.2831853*burstWaves
                         +uTime*mix(8.0,22.0,a)+shotIndex*1.37);
      float burstWaveAmp=mix(3.0,42.0,pow(a,0.74))
                        *mix(0.3,1.0,hash12(shotSeed+149.2));
      mv.y+=burstMask*burstWave*burstWaveAmp;
    }
    ivec2 shift=ivec2(round(mv));
    ivec2 moved=safePx(ip-shift,sz);

    vec4 live=texelFetch(uCur,ip,0);
    vec4 old=texelFetch(uPrev,moved,0);
    bool valid=old.a>0.5;
    float dl=abs(dot(live.rgb-old.rgb,vec3(0.2126,0.7152,0.0722)));
    bool movingEdge=dl>mix(0.16,0.035,a);
    // Whole broad regions retain the warped previous frame. Static areas refresh from the live source.
    bool hold=valid&&((mosh&&(movingEdge||regionGate<mix(0.035,0.42,a)))
                     ||scanMask>0.5||burstMask>0.5);
    frag=hold?vec4(old.rgb,1.0):vec4(live.rgb,1.0);
  } else {
    // The accumulator already contains a complete opaque image.
    frag=vec4(texelFetch(uPrev,ip,0).rgb,1.0);
  }
}`);


    // WebGL コンテキストロス検出 (ロスト中は GL 描画をスキップ)
    //   GPU 過負荷で TDR → コンテキストロスト → 再起動 → 復元でまたクラッシュ、の
    //   無限ループ(画面明滅)を断ち切るため、ロストしたら重い FX を即無効化し
    //   セーフモードを localStorage に記録。次回起動でも重い FX を抑止する。
    this.canvas.addEventListener('webglcontextlost', (e)=>{
      e.preventDefault();
      this._ctxLost = true;
      // 描画ループを完全停止 → これ以上 GPU を叩かない (明滅ループを止める最優先策)
      if(typeof App !== 'undefined') App._halted = true;
      try{
        let n = (parseInt(localStorage.getItem('vj.ctxLoss') || '0', 10) || 0) + 1;
        localStorage.setItem('vj.ctxLoss', String(n));
        if(typeof App !== 'undefined'){
          App.safeMode = true;
          if(App.post){ App.post.voxel = 0; App.post.slit2 = 0; App.post.outline = 0; App.post.mblur = 0; }
          localStorage.setItem('vj.safeMode', '1');
          localStorage.setItem('vj.lowRes', '1');   // 初回ロストから低解像度(512x384)で再起動 → 再発を強く抑制
          try{ App.saveLocal(); }catch(_){}
        }
        // 自動リロードはしない(ループ助長を避ける)。画面に復旧手順を表示。
        const d = document.createElement('div');
        d.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,.88);color:#fff;font:16px/1.6 sans-serif;text-align:center;padding:24px';
        // 内蔵GPU(Intel iGPU 等)で動いていたら、それが原因の可能性が高い旨と OS 側の対処を明示する
        const ren = this.rendererStr || '';
        const isIGPU = /Intel.*(UHD|HD Graphics|Iris)|Microsoft Basic Render/i.test(ren);
        const gpuLine = ren ? ('<small style="color:#aaa">使用中のGPU: ' + ren.replace(/</g,'&lt;') + '</small><br>') : '';
        const igpuHint = isIGPU
          ? '<div style="max-width:640px;margin:10px auto;padding:10px 14px;border:1px solid #fa4;border-radius:8px;color:#ffd9a0;font-size:14px;text-align:left">'
            + 'ブラウザが<b>内蔵GPU</b>で動いています。専用GPU搭載機では、<br>'
            + 'Windows 設定 → システム → ディスプレイ → <b>グラフィック</b> で Chrome / Edge を追加し「<b>高パフォーマンス</b>」に割り当ててからブラウザを再起動してください。</div>'
          : '';
        const steps = (this._bootLog || []).slice(-3).map(s=>String(s).replace(/</g,'&lt;')).join(' → ');
        const stepLine = steps ? ('<small style="color:#888">最終ステップ: ' + steps + '</small><br>') : '';
        d.innerHTML = 'GPU が過負荷でコンテキストが失われました。描画を停止しました。<br>'
          + gpuLine + stepLine + igpuHint + '<br>'
          + '<button id="vjReload" style="font:16px sans-serif;padding:10px 22px;margin:6px;border-radius:8px;border:0;background:#4af;color:#000;cursor:pointer">セーフモードで再起動</button>'
          + '<button id="vjReset" style="font:16px sans-serif;padding:10px 22px;margin:6px;border-radius:8px;border:0;background:#fa4;color:#000;cursor:pointer">完全リセット (?reset)</button>'
          + '<br><br><small>繰り返す場合は「完全リセット」で保存状態を破棄してください</small>';
        document.body.appendChild(d);
        const rl = document.getElementById('vjReload'); if(rl) rl.onclick = ()=>location.reload();
        const rs = document.getElementById('vjReset'); if(rs) rs.onclick = ()=>{ location.href = location.pathname + '?reset'; };
      }catch(_){}
      try{ Diag.log('webgl', 'context lost (frame='+this.frame+')'); }catch(_){}
    }, false);
    this.canvas.addEventListener('webglcontextrestored', ()=>{ this._ctxLost = false; try{ Diag.log('webgl', 'context restored'); }catch(_){} }, false);

    this.audioTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.audioTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 512, 2, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array(512*2));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // BSOD(ブルースクリーン)実テキストのテクスチャ生成 (H29 が uBsodText で参照)
    this._buildBsodTexture();

    for(const k of ['A','B']) this.slots[k] = this._mkSlot();

    this._applyLowResIfNeeded();   // 前回ロスト多発時は低解像度で起動
    this.resize();
    // #stage(外枠)を監視。stageInner 自身を監視すると _fitStage の px 変更で再帰してしまう。
    const _stageEl = (this.canvas.parentElement && this.canvas.parentElement.parentElement) || this.canvas.parentElement;
    new ResizeObserver(()=>this.resize()).observe(_stageEl);
    this.startTime = now();
    return true;
  },

  // BSOD 全文を等幅フォントでキャンバスに描画 → テクスチャ化。H29 が typewriter 表示。
  _buildBsodTexture(){
    const gl = this.gl;
    const W = 1024, H = 768;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#000'; cx.fillRect(0, 0, W, H);
    cx.fillStyle = '#cdd6ff'; cx.textBaseline = 'top';
    // 16進ダンプ行を生成
    const hx = '0123456789abcdef';
    const rnd = (n)=>{ let s=''; for(let i=0;i<n;i++) s+=hx[(Math.random()*16)|0]; return s; };
    const lines = [];
    lines.push('*** STOP: 0x0000007B (0x808004F0,0x00000000,0x00000000,0x00000000)');
    lines.push('INACCESSIBLE_BOOT_DEVICE');
    lines.push('');
    lines.push('CPUID:GenuineIntel 6.a.7  irql:0  SYSVER 0xf0000565');
    lines.push('');
    lines.push('Dll Base DateStmp - Name            Dll Base DateStmp - Name');
    lines.push('80100000 2bbb9fb1 - ntoskrnl.exe    80010000 3lec6c32 - hal.dll');
    lines.push('80001000 2bd49628 - atapi.sys       800cb000 3lec6c74 - SCSIPORT.SYS');
    lines.push('80007000 3lec63f9 - Ntfs.sys        802c0000 3lec6c7a - CLASS2.SYS');
    lines.push('');
    lines.push('Address  dword dump      Build [1381]                     - Name');
    for(let i=0;i<46;i++){
      lines.push(rnd(8)+'  '+rnd(8)+' '+rnd(8)+' '+rnd(8)+' '+rnd(8)+' '+rnd(8)+'  - ntoskrnl.exe');
    }
    lines.push('');
    lines.push('Restart and set the recovery options in system control panel');
    lines.push('or the /CRASHDEBUG system start option. If this message reappears,');
    lines.push('contact your system administrator or technical support group.');
    this.bsodRows = lines.length;
    const fsz = Math.floor((H - 12) / lines.length);
    cx.font = (fsz)+'px Menlo, Monaco, monospace';
    let y = 6;
    for(const ln of lines){ cx.fillText(ln, 8, y); y += (H - 12) / lines.length; }
    // テクスチャ化
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.bsodTex = tex;
  },

  _mkSlot(){
    return { kind:'shader',
             prog:null, src:'', errors:'', params:[], channels:[null,null,null,null],
             fbos:[this._mkFBO(2,2), this._mkFBO(2,2)], fbIdx:0, ready:false,
             uniforms:{}, customLocs:{},
             // ── ユーザ pan/zoom はスロット毎に保持 (シェーダ/動画ごと) ──
             userPan:{x:0, y:0}, userZoom:1.0,
             _clock:0, _beat:null, _scaledBeat:null, _frame:0,
             _snap:null, _tr:null };   // _snap=切替直前フレーム, _tr=スロット内トランジション状態
  },
  // 切替直前のフレームを退避(後で旧→新の mix に使う)
  _snapSlot(k){
    const gl=this.gl, slot=this.slots[k];
    const src=slot.fbos[slot.fbIdx ^ 1];
    if(!slot._snap) slot._snap=this._mkFBO(src.w, src.h);
    else this._resizeFBO(slot._snap, src.w, src.h);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, slot._snap.fbo);
    gl.blitFramebuffer(0,0,src.w,src.h, 0,0,slot._snap.w,slot._snap.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },
  // スロット内トランジション: 退避した旧フレームと現フレームを style で mix し、最新出力に書き戻す
  _applySlotTrans(k){
    const slot=this.slots[k];
    if(!slot._tr || !slot._tr.on || !slot._snap || !this.slotTransProg) return;
    const gl=this.gl;
    let ph=(BPM.beatCount()-slot._tr.t0)/Math.max(0.0625, slot._tr.beats);
    if(slot._tr.rdur) ph=Math.max(ph, (now()-slot._tr.rt0)/slot._tr.rdur);   // 実時間フォールバック(同上)
    ph=Math.min(1, Math.max(0, ph));
    const phEnd = ph>=1;                       // 完了判定は線形 ph で行う
    ph = 1 - Math.pow(1 - ph, 5);              // easeOutQuint (全トランジション共通)
    const cur=slot.fbos[slot.fbIdx ^ 1], dst=slot.fbos[slot.fbIdx];
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo); gl.viewport(0,0,dst.w,dst.h);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.slotTransProg);
    gl.bindVertexArray(this.quadVAO);
    const U=(n)=>gl.getUniformLocation(this.slotTransProg,n);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, slot._snap.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, cur.tex);
    gl.uniform1i(U('uPrev'),0); gl.uniform1i(U('uCur'),1);
    gl.uniform1f(U('uPhase'), ph);
    gl.uniform1i(U('uStyle'), App.transStyle||0);
    gl.uniform1f(U('uTrSeed'), (slot._tr.seed != null) ? slot._tr.seed : 0.0);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.bindVertexArray(null);
    slot.fbIdx ^= 1;
    if(phEnd) slot._tr.on=false;
  },
  // ── プリセット切替の全画面トランジション (slotTransProg を最終出力に応用) ──
  _presetTr: null,
  snapFinal(){                                  // 現在の最終出力を退避 (トランジションの「旧」)
    const gl=this.gl; if(!this._finalFBO) return;
    const w=this._finalFBO.w, h=this._finalFBO.h;
    if(!this._presetSnap) this._presetSnap=this._mkFBO(w,h); else this._resizeFBO(this._presetSnap,w,h);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._finalFBO.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._presetSnap.fbo);
    gl.blitFramebuffer(0,0,w,h, 0,0,w,h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },
  startPresetTrans(beats, style){               // プリセット適用直後に呼ぶ
    if(!(beats>0) || !this._finalFBO) return;
    this.snapFinal();
    this._presetTr = { on:true, t0:BPM.beatCount(), beats:beats, style:style||0, seed: Math.random(),
                       rt0: now(), rdur: Math.max(0.05, beats*60/Math.max(20, BPM.bpm)) };
  },
  _applyPresetTrans(){                          // 旧(snap) と 新(_finalFBO) を style で mix → _finalFBO に書き戻し
    const tr=this._presetTr;
    if(!tr || !tr.on || !this._presetSnap || !this._finalFBO || !this.slotTransProg) return;
    const gl=this.gl;
    let ph=(BPM.beatCount()-tr.t0)/Math.max(0.0625, tr.beats);
    if(tr.rdur) ph=Math.max(ph, (now()-tr.rt0)/tr.rdur);   // 実時間フォールバック: ビート位相リセット(setBpm/tap/reset)で固まらない
    ph=Math.min(1, Math.max(0, ph));
    const phEnd = ph>=1;
    ph = 1 - Math.pow(1-ph, 5);                 // easeOutQuint (スロット転換と共通)
    const w=this._finalFBO.w, h=this._finalFBO.h;
    if(!this._presetTrTmp) this._presetTrTmp=this._mkFBO(w,h); else this._resizeFBO(this._presetTrTmp,w,h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._presetTrTmp.fbo); gl.viewport(0,0,w,h);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.slotTransProg);
    gl.bindVertexArray(this.quadVAO);
    const U=(n)=>gl.getUniformLocation(this.slotTransProg,n);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._presetSnap.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._finalFBO.tex);
    gl.uniform1i(U('uPrev'),0); gl.uniform1i(U('uCur'),1);
    gl.uniform1f(U('uPhase'), ph);
    gl.uniform1i(U('uStyle'), tr.style||0);
    gl.uniform1f(U('uTrSeed'), (tr.seed != null) ? tr.seed : 0.0);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._presetTrTmp.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._finalFBO.fbo);
    gl.blitFramebuffer(0,0,w,h, 0,0,w,h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if(phEnd) tr.on=false;
  },
  _mkFBO(w,h){
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {tex, fbo, w, h};
  },
  _resizeFBO(o,w,h){
    if(o.w===w && o.h===h) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, o.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    o.w=w; o.h=h;
  },

  // 描画解像度の既定 (初回訪問時 = vj.res 未保存のときに使用。録画 / Projector 出力サイズの初期値)
  FIXED_W:960, FIXED_H:540,
  // ロストが続いた場合(シェーダ自体が重い等)は解像度を半分に落として負荷を1/4に
  _applyLowResIfNeeded(){
    try{
      if(localStorage.getItem('vj.lowRes') === '1'){ this.FIXED_W = 512; this.FIXED_H = 384; }
      const rs = localStorage.getItem('vj.res');           // 解像度プルダウンの保存値(4:3)
      if(rs && /^\d+x\d+$/.test(rs)){ const a = rs.split('x'); this.FIXED_W = +a[0]; this.FIXED_H = +a[1]; }
    }catch(_){}
  },
  resize(){
    const w = this.FIXED_W, h = this.FIXED_H;
    if(this.canvas.width !== w) this.canvas.width = w;
    if(this.canvas.height !== h) this.canvas.height = h;
    for(const k of ['A','B']){
      const s = this.slots[k];
      this._resizeFBO(s.fbos[0], w, h);
      this._resizeFBO(s.fbos[1], w, h);
      if(s._snap) this._resizeFBO(s._snap, w, h);
    }
    this._fitStage();
  },
  // 表示枠を「親 #stageMain に収まる FIXED_W:FIXED_H の最大ボックス」へ px 指定(contain)。
  // CSS の aspect-ratio + height:100% だと、導出幅が枠を超えた時に幅だけ max-width で詰められ
  // 高さが残ってアスペクト比が破れる(円が縦長/横長になる)。JS で両軸 letterbox して確実に防ぐ。
  _fitStage(){
    const si = document.getElementById('stageInner');
    if(!si) return;
    // 縦長出力なら stage を左右レイアウトに切替 (CSS .portrait)
    const stageEl = document.getElementById('stage');
    if(stageEl) stageEl.classList.toggle('portrait', this.FIXED_H > this.FIXED_W);
    const main = si.parentElement;
    if(!main) return;
    const cw = main.clientWidth, ch = main.clientHeight;
    if(cw <= 0 || ch <= 0) return;
    const ar = this.FIXED_W / this.FIXED_H;
    let bw = cw, bh = Math.round(cw / ar);
    if(bh > ch){ bh = ch; bw = Math.round(ch * ar); }
    si.style.width  = bw + 'px';
    si.style.height = bh + 'px';
  },
  // 描画解像度をプルダウンから変更(4:3)。canvas/各 FBO は resize と
  // 毎フレームの _ensureFinalFBO / Post FX が canvas サイズに追従して再構成する。
  setResolution(w, h){
    this.FIXED_W = w|0; this.FIXED_H = h|0;
    // 表示枠のアスペクト比を先に解像度へ追従(縦長/正方/横長すべて歪まず表示)。
    // resize() が例外を投げても確実に適用されるよう resize より前に設定。
    var si = document.getElementById('stageInner');
    if(si) si.style.aspectRatio = this.FIXED_W + ' / ' + this.FIXED_H;
    this.resize();
    try{ localStorage.setItem('vj.res', this.FIXED_W + 'x' + this.FIXED_H); }catch(_){}
  },

  // 並列コンパイル拡張が有効なとき、状態照会の前にコンパイル/リンク完了を待つ。
  //   ANGLE(Windows) では拡張有効下で COMPILE_STATUS を早すぎるタイミングで照会すると
  //   未完了のまま false(=失敗)が返り、正常なシェーダまで壊れることがあるための保険。
  _awaitGLComplete(obj, isProgram){
    const gl = this.gl, ext = this._parallelCompileExt;
    if(!ext) return;
    const q = isProgram ? (o)=>gl.getProgramParameter(o, ext.COMPLETION_STATUS_KHR)
                        : (o)=>gl.getShaderParameter(o, ext.COMPLETION_STATUS_KHR);
    let guard = 0;
    try{ while(guard++ < 100000 && q(obj) !== true){} }catch(e){}
  },

  // ── ブート診断: どこまで初期化が進んだかを記録 (Windows のロード中クラッシュ切り分け用) ──
  _bootLog: [],
  _boot(step){
    try{
      this._bootLog.push(step);
      if(this._bootLog.length > 40) this._bootLog.shift();
      console.log('[boot]', step);
    }catch(_){}
  },

  // ── 起動時プログラムの非同期リンク ──
  // ステータス照会をせず compile/link を投げっぱなしにし、tick の _pollInitProgs で完了後に this[name] へ代入。
  // 同期照会 (getShaderParameter/getProgramParameter) は Windows/ANGLE では FXC の長時間コンパイルを
  // GPU プロセスのスレッド上で待つことになり、ブラウザの GPU ウォッチドッグにプロセスごと殺される
  // (= "context lost")。これが Windows のロード中クラッシュの主因。
  _initProgPending: [],
  _linkDeferred(name, fsSrc){
    const gl = this.gl;
    this._boot('compile ' + name);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSrc);
    gl.compileShader(fs);
    const p = gl.createProgram();
    try{ gl.attachShader(p, this.vs); gl.attachShader(p, fs); }catch(e){ console.warn('linkDeferred attach failed:', name, e); this[name] = null; return; }
    gl.linkProgram(p);
    this._initProgPending.push({ name, prog: p, fs });
    this[name] = null;   // 完了までは未使用 (各描画パスは null ガードでスキップ)
  },
  _pollInitProgs(){
    if(!this._initProgPending.length) return;
    const gl = this.gl, ext = this._parallelCompileExt;
    const still = [];
    let compositeFailed = false;
    for(const r of this._initProgPending){
      let done = true;
      if(ext){ try{ done = gl.getProgramParameter(r.prog, ext.COMPLETION_STATUS_KHR); }catch(e){ done = true; } }
      if(!done){ still.push(r); continue; }
      if(gl.getProgramParameter(r.prog, gl.LINK_STATUS)){
        this[r.name] = r.prog;
        this._boot('ready ' + r.name);
      } else {
        let log = '';
        try{ log = gl.getShaderParameter(r.fs, gl.COMPILE_STATUS) ? (gl.getProgramInfoLog(r.prog) || 'link error') : gl.getShaderInfoLog(r.fs); }catch(e){}
        console.error('init program failed:', r.name, log);
        this._boot('FAILED ' + r.name);
        (this._initFailed = this._initFailed || []).push({ name: r.name, log: String(log).slice(0, 400) });
        try{ Diag.log('shader', r.name + ' failed: ' + String(log).slice(0, 300)); }catch(_){}
        try{ gl.deleteProgram(r.prog); }catch(_){}
        if(r.name === 'compositeProg') compositeFailed = true;
      }
      try{ gl.deleteShader(r.fs); }catch(_){}
    }
    this._initProgPending = still;
    // 合成シェーダが D3D11(ANGLE) 等でリンク失敗 → フォールバック合成(init で併走コンパイル済み)で描き続ける
    if(compositeFailed && !this._compositeFellBack){
      this._compositeFellBack = true;
      this._boot('composite fallback (link failed)');
    }
    if(this._initFailed && this._initFailed.length && !this._initFailBanner) this._showInitFailBanner();
  },
  initProgsReady(){ return this._initProgPending.length === 0; },
  // ステージを描き始められるか (本命 or フォールバックのどちらかの合成が完成していれば true)
  stageReady(){ return !!(this.compositeProg || this.compositeFallbackProg); },
  _showInitFailBanner(){
    this._initFailBanner = true;
    try{
      const names = this._initFailed.map(f=>f.name.replace('Prog','')).join(', ');
      const first = this._initFailed[0];
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;left:8px;bottom:8px;max-width:72vw;z-index:99998;background:rgba(120,20,20,.95);color:#fff;font:11px/1.5 monospace;padding:8px 26px 8px 12px;border-radius:8px;white-space:pre-wrap;overflow:auto;max-height:42vh';
      d.textContent = 'このGPUで一部シェーダのコンパイルに失敗しました: ' + names
        + (this._compositeFellBack ? '\n→ 合成は簡易フォールバックで描画中 (Post FX は制限されます)' : '')
        + (first ? ('\n\n[' + first.name + ']\n' + first.log) : '');
      const close = document.createElement('div');
      close.textContent = '×';
      close.style.cssText = 'position:absolute;top:4px;right:8px;cursor:pointer;font-size:15px;line-height:1';
      close.onclick = ()=>{ try{ d.remove(); }catch(_){} };
      d.appendChild(close);
      document.body.appendChild(d);
    }catch(_){}
  },
  _compile(type, src){
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    this._awaitGLComplete(sh, false);
    if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){
      const log = gl.getShaderInfoLog(sh);
      console.warn('shader compile failed:', log, src.slice(0, 200));
      gl.deleteShader(sh);
      return {err:log};
    }
    return sh;
  },
  _link(vs, fs){
    if(!vs || vs.err || !fs || fs.err) return null;   // vs.err も見る(頂点シェーダ失敗で attachShader が落ちるのを防ぐ)
    const gl = this.gl;
    const p = gl.createProgram();
    try{
      gl.attachShader(p, vs); gl.attachShader(p, fs);
    }catch(e){
      try{ gl.deleteProgram(p); }catch(_){}
      return {err:String(e)};
    }
    gl.linkProgram(p);
    this._awaitGLComplete(p, true);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)){
      const log = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      return {err:log};
    }
    return p;
  },

  compileSlot(slotKey, src, opts){
    opts = opts || {};
    const gl = this.gl;
    const slot = this.slots[slotKey];
    const pp = Shader.preprocess(src);
    // 前処理エラー(GLSL 変換前の @param 等)はここでは出ない。compile/link は投げっぱなしにして
    // ステータス照会(=同期ブロックの原因)を遅延する。
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, pp.code);
    gl.compileShader(fs);
    const prog = gl.createProgram();
    gl.attachShader(prog, this.vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    const rec = { slotKey, src, pp, fs, prog };
    // 並列コンパイル対応 & 同期強制でなければ、ステータス照会を tick へ遅延(UI を固めない)。
    //   旧 slot.prog はそのまま描画し続け、完了後に差し替える(黒フラッシュ無し)。
    if(this._parallelCompileExt && !opts.sync){
      this._cancelPendingCompile(slotKey);   // 同じ Slot の未完了コンパイルは破棄(最新のみ)
      this._pendingCompiles.push(rec);
      return true;   // 楽観的に成功扱い。実エラーは finalize で slot.errors に反映。
    }
    return this._finalizeCompile(rec, false);
  },
  // 同じ Slot に対する未完了の非同期コンパイルを破棄
  _cancelPendingCompile(slotKey){
    if(!this._pendingCompiles || !this._pendingCompiles.length) return;
    const gl = this.gl, keep = [];
    for(const r of this._pendingCompiles){
      if(r.slotKey === slotKey){ try{ gl.deleteShader(r.fs); gl.deleteProgram(r.prog); }catch(e){} }
      else keep.push(r);
    }
    this._pendingCompiles = keep;
  },
  // tick から毎フレーム: 非同期コンパイルの完了をポーリングして差し替える
  _pollCompiles(){
    if(!this._pendingCompiles || !this._pendingCompiles.length) return;
    const gl = this.gl, ext = this._parallelCompileExt;
    const still = [];
    for(const r of this._pendingCompiles){
      let done = true;
      try{ done = gl.getProgramParameter(r.prog, ext.COMPLETION_STATUS_KHR); }catch(e){ done = true; }
      if(done) this._finalizeCompile(r, true);
      else still.push(r);
    }
    this._pendingCompiles = still;
  },
  // コンパイル/リンク結果を確定してスロットへ適用 (deferred=非同期完了時: UI を再同期)
  _finalizeCompile(rec, deferred){
    const gl = this.gl;
    const { slotKey, src, pp, fs, prog } = rec;
    const slot = this.slots[slotKey];
    // 同期確定(deferred=false)のときは、拡張有効下でも完了を待ってから状態照会する
    if(!deferred) this._awaitGLComplete(prog, true);
    // ここで初めてステータス照会 (parallel 拡張下では既に完了しているので非ブロック)
    if(!gl.getProgramParameter(prog, gl.LINK_STATUS)){
      let log = '';
      if(!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) log = gl.getShaderInfoLog(fs);
      else log = gl.getProgramInfoLog(prog) || 'link error';
      try{ gl.deleteShader(fs); gl.deleteProgram(prog); }catch(e){}
      slot.errors = Shader.remapErrors(log, pp.headerLines);
      if(!slot.prog) slot.ready = false;   // 旧 prog があれば描画は継続(直近の正常シェーダを維持)
      if(deferred && typeof UI !== 'undefined' && UI.showError) UI.showError(slot.errors);
      return false;
    }
    gl.deleteShader(fs);
    if(slot.prog) gl.deleteProgram(slot.prog);
    slot.prog = prog;
    slot.src = src;
    slot.cosGradInShader = (src.match(/uCosGrad/g) || []).length > 1;
    slot.beatJump = !/_setBgTime|getBeat|iBeat\b|iBeatPhase|iBeatMode/.test(src);
    slot.gradMask = /@gradmask/.test(src);
    slot.bKey = /@bkey/.test(src);
    slot.params = pp.params;
    if(typeof App !== 'undefined' && App.applyShaderParamDefaults) App.applyShaderParamDefaults(slot);   // 保存済みシェーダ既定値を反映
    slot.errors = '';
    slot.ready = true;
    slot.format = pp.format;
    slot.uniforms = {};
    const U = (n)=> gl.getUniformLocation(prog, n);
    for(const n of ['iResolution','iTime','iTimeDelta','iFrame','iMouse','iDate','iSampleRate',
                    'iChannel0','iChannel1','iChannel2','iChannel3',
                    'iBPM','iBeat','iBeatPhase','iEnergy','iAttack','iAttackEnv','iCrossfade','iBeatMode','iPan','iZoom',
                    'time','mouse','resolution','backbuffer','beat','uCosGrad','uCosPalette','uFFT','uBsodText','uSlotIsA','iAudio','iAudioSeed','uGradStops[0]','uGradPos[0]','uGradN']){
      slot.uniforms[n] = U(n);
    }
    slot.uniforms.iChannelResolution = U('iChannelResolution[0]');
    slot.customLocs = {};
    for(const p of pp.params) slot.customLocs[p.name] = U(p.name);
    try{
      const fsrc = slot.fbos && slot.fbos[slot.fbIdx];
      if(fsrc){
        gl.bindFramebuffer(gl.FRAMEBUFFER, fsrc.fbo);
        gl.viewport(0, 0, 1, 1);
        gl.useProgram(prog);
        gl.bindVertexArray(this.quadVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
    }catch(e){ /* ウォームアップ失敗は致命的でない */ }
    // 非同期完了時: パラメータ UI 等を新シェーダに再同期(loadPreset の初回 refresh は旧 params だったため)
    if(deferred && typeof UI !== 'undefined' && UI.refreshAll) UI.refreshAll();
    // Draw フリーズ / Pause 中でも、コンパイル完了した新シェーダを 1 フレーム描画して切替を見せる
    this.forceRenderOnce();
    return true;
  },

  makeTexEmpty(){
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  },
  makeTexFromImage(img){
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return t;
  },
  uploadVideo(tex, video){
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  },

  _bindChannel(slot, otherSlot, chIdx, unit){
    const gl = this.gl;
    const id = slot.channels[chIdx];
    let tex = null, w=1, h=1;
    if(id){
      if(id === '__feedback__'){
        const fb = slot.fbos[slot.fbIdx ^ 1]; // previous
        tex = fb.tex; w=fb.w; h=fb.h;
      }else if(id === '__slotA__'){
        const fb = this.slots.A.fbos[this.slots.A.fbIdx];
        tex = fb.tex; w=fb.w; h=fb.h;
      }else if(id === '__slotB__'){
        const fb = this.slots.B.fbos[this.slots.B.fbIdx];
        tex = fb.tex; w=fb.w; h=fb.h;
      }else if(id === '__audio__'){
        tex = this.audioTex; w=512; h=2;
      }else{
        const e = Inputs.byId(id);
        if(e && e.tex){ tex = e.tex; w=e.width||1; h=e.height||1; }
      }
    }
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex || this._blankTex());
    return [w,h,1];
  },
  _blankTex(){
    if(!this.__bt) this.__bt = this.makeTexEmpty();
    return this.__bt;
  },

  renderSlot(slotKey){
    const gl = this.gl;
    const slot = this.slots[slotKey];
    if(!slot.ready || !slot.prog) return;
    const target = slot.fbos[slot.fbIdx];
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0,0,target.w,target.h);
    gl.useProgram(slot.prog);
    gl.bindVertexArray(this.quadVAO);

    const u = slot.uniforms;
    const dt = this.clockDt;
    // B Offset: A/B に同じシェーダを入れたとき、Slot B だけ位相(拍)をずらして重ねられる (Mix タブ)。
    const offB = (slotKey === 'B') ? (App.slotBOffsetBeats || 0) : 0;
    const offSec = offB * 60 / Math.max(20, BPM.bpm);
    const slotBeat = (typeof slot._beat === 'number') ? slot._beat : BPM.beatCount();
    const slotScaledBeat = (typeof slot._scaledBeat === 'number') ? slot._scaledBeat
      : (App.visualBeat ? App.visualBeat(slotBeat) : slotBeat * (App.beatScale || 1));
    const slotFrame = (typeof slot._frame === 'number') ? slot._frame : this.frame;
    // beat モード時、ビート非対応シェーダは拍ごとに time/iTime をランダムジャンプ(perBg と同じ式)。
    let t = this.clock + offSec;
    if(slot.beatJump && App.beatMode === 'beat'){
      const b = slotScaledBeat + offB;
      const blk = Math.floor(b);
      const s = Math.sin(blk*78.233 + 1.7) * 4373.7;
      t = this.clock + offSec + (s - Math.floor(s)) * 1000.0;   // 拍ごとに固定のランダムオフセット
    }
    if(u.iResolution) gl.uniform3f(u.iResolution, target.w, target.h, 1);
    if(u.iTime) gl.uniform1f(u.iTime, t);
    if(u.iTimeDelta) gl.uniform1f(u.iTimeDelta, dt);
    if(u.iFrame) gl.uniform1i(u.iFrame, slotFrame);
    // iMouse / Sandbox mouse: M キーで拾う/拾わないをトグル(App.mouseCapture)。
    // 拾う間は、そのスロットがアクティブなときだけ実マウスを反映(非アクティブ/OFFは最後の値で凍結)。
    if(App.mouseCapture && slotKey === App.activeSlot){ slot._mouse = { x: App.mouse.x, y: App.mouse.y, dx: App.mouse.dx, dy: App.mouse.dy }; }
    const m = slot._mouse || { x: 0, y: 0, dx: 0, dy: 0 };
    if(u.iMouse) gl.uniform4f(u.iMouse, m.x, m.y, m.dx, m.dy);
    if(u.iSampleRate) gl.uniform1f(u.iSampleRate, Audio.sampleRate || 44100);
    const d = new Date();
    if(u.iDate) gl.uniform4f(u.iDate, d.getFullYear(), d.getMonth(), d.getDate(),
        d.getHours()*3600 + d.getMinutes()*60 + d.getSeconds() + d.getMilliseconds()/1000);
    if(u.iBPM) gl.uniform1f(u.iBPM, BPM.bpm);
    if(u.iBeat) gl.uniform1f(u.iBeat, slotBeat + offB);
    if(u.iBeatPhase) gl.uniform1f(u.iBeatPhase, (slotBeat + offB) % 1);
    if(u.iBeatMode) gl.uniform1i(u.iBeatMode, App.beatMode==='beat' ? 1 : 0);
    { // このスロットがズームアウト(<1)のときは合成段でミラータイル化する (この間シェーダは base 描画)。
      // ズームイン/等倍(>=1)は従来どおりシェーダ内プロシージャルズーム。
      // ズームは各スロット独立 (アクティブスロットの値は参照しない)。
      const uz = slot.userZoom == null ? 1.0 : slot.userZoom;
      const up = slot.userPan || {x:0, y:0};
      const inShader = uz >= 1.0;
      if(u.iPan)  gl.uniform2f(u.iPan, inShader ? up.x : 0, inShader ? up.y : 0);
      if(u.iZoom) gl.uniform1f(u.iZoom, inShader ? uz : 1.0);
    }
    if(u.iEnergy) gl.uniform1f(u.iEnergy, Audio.energy);
    if(u.iAttack) gl.uniform1f(u.iAttack, Audio.attack || 0);
    if(u.iAttackEnv) gl.uniform1f(u.iAttackEnv, Audio.attackEnv || 0);
    if(u.iCrossfade) gl.uniform1f(u.iCrossfade, App.crossfade);
    // hinotori 互換: beat<0 = drone モード
    if(u.beat) gl.uniform1f(u.beat, App.beatMode==='beat' ? slotScaledBeat + offB : -1.0);
    // in-shader cosGrad は廃止。シェーダはグレースケール出力にし、Grad Map は sampleAB で全スロットに適用する。
    if(u.uCosGrad){ gl.uniform1f(u.uCosGrad, 0.0); }
    if(u.uCosPalette) gl.uniform1i(u.uCosPalette, (App.post && App.post.cosPalette) || 0);
    if(u.uSlotIsA) gl.uniform1f(u.uSlotIsA, slotKey === 'A' ? 1.0 : 0.0);   // 透過対応シェーダが A=黒背景 判定に使用
    if(u.iAudio) gl.uniform1f(u.iAudio, Audio.react || 0);                   // 音域+アタックで整形した音声リアクト
    if(u.iAudioSeed) gl.uniform1f(u.iAudioSeed, Audio.hitSeed || 0);         // アタックごとに変わる乱数

    // channels
    const chRes = new Float32Array(12);
    for(let i=0;i<4;i++){
      const [w,h,d_] = this._bindChannel(slot, null, i, i);
      const chLoc = u['iChannel'+i];
      if(chLoc) gl.uniform1i(chLoc, i);
      chRes[i*3]=w; chRes[i*3+1]=h; chRes[i*3+2]=d_;
    }
    if(u.iChannelResolution) gl.uniform3fv(u.iChannelResolution, chRes);

    // GLSL Sandbox aliases
    if(u.time) gl.uniform1f(u.time, t);
    if(u.resolution) gl.uniform2f(u.resolution, target.w, target.h);
    if(u.mouse) gl.uniform2f(u.mouse, m.x/Math.max(1,target.w), m.y/Math.max(1,target.h));
    if(u.backbuffer){
      // unit 4: previous frame of this slot
      gl.activeTexture(gl.TEXTURE0 + 4);
      gl.bindTexture(gl.TEXTURE_2D, slot.fbos[slot.fbIdx ^ 1].tex);
      gl.uniform1i(u.backbuffer, 4);
    }
    if(u.uFFT){
      // unit 5: 音声スペクトル(FFT)テクスチャ
      gl.activeTexture(gl.TEXTURE0 + 5);
      gl.bindTexture(gl.TEXTURE_2D, this.audioTex);
      gl.uniform1i(u.uFFT, 5);
    }
    if(u.uBsodText && this.bsodTex){
      // unit 6: BSOD 実テキスト テクスチャ
      gl.activeTexture(gl.TEXTURE0 + 6);
      gl.bindTexture(gl.TEXTURE_2D, this.bsodTex);
      gl.uniform1i(u.uBsodText, 6);
    }

    // custom params
    for(const p of slot.params){
      const loc = slot.customLocs[p.name]; if(!loc) continue;
      if(p.type==='color') gl.uniform3f(loc, p.value[0], p.value[1], p.value[2]);
      else gl.uniform1f(loc, App.deadParam ? App.deadParam(p.value) : p.value);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    slot.fbIdx ^= 1;
  },

  _ensureFinalFBO(){
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    if(!this._finalFBO){
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this._finalFBO = {fbo, tex, w, h};
    } else if(this._finalFBO.w !== w || this._finalFBO.h !== h){
      gl.bindTexture(gl.TEXTURE_2D, this._finalFBO.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this._finalFBO.w = w; this._finalFBO.h = h;
    }
    // Tunnel用FBOをスライダー操作時ではなく通常描画の初期化中に確保し、ON直後の一回だけ止まる症状を避ける。
    if(!this._candyFBO) this._candyFBO = this._mkFBO(w,h);
    else if(this._candyFBO.w !== w || this._candyFBO.h !== h) this._resizeFBO(this._candyFBO,w,h);
    const mw=Math.max(2,Math.ceil(w*0.5)), mh=Math.max(2,Math.ceil(h*0.5));
    const lw=Math.max(2,Math.ceil(w*0.25)), lh=Math.max(2,Math.ceil(h*0.25));
    if(!this._candyFBOMid) this._candyFBOMid=this._mkFBO(mw,mh);
    else if(this._candyFBOMid.w!==mw || this._candyFBOMid.h!==mh) this._resizeFBO(this._candyFBOMid,mw,mh);
    if(!this._candyFBOLow) this._candyFBOLow=this._mkFBO(lw,lh);
    else if(this._candyFBOLow.w!==lw || this._candyFBOLow.h!==lh) this._resizeFBO(this._candyFBOLow,lw,lh);
    if(!this._candyWarmFBO) this._candyWarmFBO=this._mkFBO(4,4);
  },

  _warmCandyProgram(){
    if(this._candyWarmed || !this.compositeProg || !this._candyWarmFBO) return;
    const gl=this.gl, P=this.compositeProg, U=(n)=>gl.getUniformLocation(P,n);
    const A=this.slots.A.fbos[this.slots.A.fbIdx^1], B=this.slots.B.fbos[this.slots.B.fbIdx^1];
    if(!A || !B) return;
    this._candyWarmed=true;
    gl.useProgram(P);
    gl.bindVertexArray(this.quadVAO);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,A.tex); gl.uniform1i(U('uA'),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,B.tex); gl.uniform1i(U('uB'),1);
    gl.uniform1f(U('uShowA'),1); gl.uniform1f(U('uShowB'),1); gl.uniform1f(U('uMix'),0.5);
    gl.uniform1f(U('uZoomA'),1); gl.uniform1f(U('uZoomB'),1);
    gl.uniform2f(U('uPanA'),0,0); gl.uniform2f(U('uPanB'),0,0);
    gl.uniform2f(U('uRes'),4,4); gl.uniform1f(U('uTime'),0);
    gl.uniform1f(U('uCandy'),0.35); gl.uniform1i(U('uCandyMode'),1);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this._candyWarmFBO.fbo);
    gl.viewport(0,0,4,4);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.flush();
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  },

  composite(toDefault=true){
    const gl = this.gl;
    // 本命の巨大合成シェーダが完成するまでは軽量フォールバックで描く (Windows/FXC はコンパイルに
    // 数十秒〜数分かかることがあり、待っている間ステージが黒くなるのを防ぐ)。完成したら自動で切替。
    const P = this.compositeProg || this.compositeFallbackProg;
    if(!P) return;   // 両方とも未完成 (ローディング画面が出ている)
    // Overlay でテクスチャとして再利用するため、まず中間 FBO に composite
    this._ensureFinalFBO();
    if(P===this.compositeProg && !this._candyWarmed) this._warmCandyProgram();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._finalFBO.fbo);
    gl.viewport(0, 0, this._finalFBO.w, this._finalFBO.h);
    gl.useProgram(P);
    gl.bindVertexArray(this.quadVAO);
    const A = this.slots.A.fbos[this.slots.A.fbIdx ^ 1];
    const B = this.slots.B.fbos[this.slots.B.fbIdx ^ 1];
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, B.tex);
    const U = (n)=>gl.getUniformLocation(P, n);
    gl.uniform1i(U('uA'), 0);
    gl.uniform1i(U('uB'), 1);
    gl.uniform1f(U('uMix'),       App.crossfade);
    gl.uniform1f(U('uShowA'),     App.slotVisibleAmount ? App.slotVisibleAmount('A') : (App.slotVisible && App.slotVisible.A === false ? 0 : 1));
    gl.uniform1f(U('uShowB'),     App.slotVisibleAmount ? App.slotVisibleAmount('B') : (App.slotVisible && App.slotVisible.B === false ? 0 : 1));
    // mode エンジン(FBO 独立描画)には user zoom/pan を合成段でテクスチャ適用 (shader は iZoom 済のため 1.0)
    { const modeSet = GL._modeZoomSet || (GL._modeZoomSet = new Set(App.modeStateKinds || []));
      const zp = (key)=>{
        const s=this.slots[key]; if(!s) return [1,0,0];
        // ズームは各スロット独立。ズームアウト(<1) はそのスロットだけミラータイル化
        const uz = s.userZoom==null?1:s.userZoom;
        const p = s.userPan||{x:0,y:0};
        if(uz < 1.0) return [uz, p.x, p.y];
        if(modeSet.has(s.kind)) return [uz, p.x, p.y];       // mode エンジンのズームイン(拡大)
        return [1,0,0];                                      // シェーダのズームイン/等倍はシェーダ内で処理済
      };
      const za=zp('A'), zb=zp('B');
      gl.uniform1f(U('uZoomA'), za[0]); gl.uniform2f(U('uPanA'), za[1], za[2]);
      gl.uniform1f(U('uZoomB'), zb[0]); gl.uniform2f(U('uPanB'), zb[1], zb[2]);
    }
    gl.uniform1i(U('uBlendMode'), App.blendModeIdx());
    gl.uniform1i(U('uTransStyle'), App.transStyle || 0);
    gl.uniform1f(U('uTime'),      (this.postClock != null ? this.postClock : this.clock));   // Post FX は D フリーズ中も進む時計
    gl.uniform1f(U('uBeat'),      BPM.beatCount());
    gl.uniform1f(U('uBeatPhase'), BPM.beatPhase());
    gl.uniform1i(U('uBeatMode'),  App.beatMode === 'beat' ? 1 : 0);
    gl.uniform2f(U('uRes'),       this.canvas.width, this.canvas.height);
    const pRaw = App.post || {};
    const p = App.effectivePost ? App.effectivePost(pRaw) : pRaw;
    // Sketch 有効時は合成側の色調補正を中立化し、SketchFX 出力側で適用(二重適用回避)
    const _sk = (typeof SketchFX !== 'undefined') && p && (p.sketch || 0) > 0.001 && !(App.safeMode);
    const _safe = (typeof App !== 'undefined' && App.safeMode);
    gl.uniform1f(U('uGamma'),     _sk ? 1 : p.gamma);
    // Sat/Hue/Brightness/Contrast は最終段で一括適用する。
    gl.uniform1f(U('uSat'),       1);
    gl.uniform1f(U('uHue'),       0);
    gl.uniform1f(U('uBri'),       0);
    gl.uniform1f(U('uCon'),       1);
    gl.uniform1f(U('uVig'),       p.vig);
    gl.uniform1f(U('uChr'),       p.chr);
    gl.uniform1f(U('uAScan'),  p.aScan  || 0);
    gl.uniform1f(U('uARgb'),   p.aRgb   || 0);
    { const c = this._fxLineRGB || [1,1,1]; gl.uniform3f(U('uFxLineCol'), c[0], c[1], c[2]); gl.uniform1f(U('uFxLineOn'), this._fxLineOn ? 1 : 0); }
    gl.uniform1f(U('uAStrobe'),  p.aStrobe  || 0);
    gl.uniform1f(U('uAShock'),   p.aShock   || 0);
    gl.uniform1f(U('uAExplode'), p.aExplode || 0);
    // Slit-scan(時間差スライス)は _applySlitScan で適用(履歴バッファ使用)。ここでは何もしない。
    gl.uniform1f(U('uEnergy'),    (typeof Audio!=='undefined') ? (Audio.energy||0) : 0);
    gl.uniform1f(U('uOnset'),     (typeof Audio!=='undefined') ? (Audio.onset||0) : 0);
    gl.uniform1f(U('uAttack'),    (typeof Audio!=='undefined') ? (Audio.attack||0) : 0);
    gl.uniform1f(U('uAttackEnv'), (typeof Audio!=='undefined') ? (Audio.attackEnv||0) : 0);
    gl.uniform1f(U('uHit'),       (typeof Audio!=='undefined') ? (Audio.hit||0) : 0);
    gl.uniform1f(U('uHitSeed'),   (typeof Audio!=='undefined') ? (Audio.hitSeed||0) : 0);
    if(this.audioTex){ gl.activeTexture(gl.TEXTURE0 + 5); gl.bindTexture(gl.TEXTURE_2D, this.audioTex); gl.uniform1i(U('uFFT'), 5); }
    gl.uniform1f(U('uPix'),       p.pix);
    gl.uniform1i(U('uMir'),       p.mir|0);
    gl.uniform1f(U('uScn'),       p.scn);
    gl.uniform1f(U('uGrn'),       p.grn);
    gl.uniform1f(U('uTexN'),      p.texNoise || 0);
    gl.uniform1i(U('uPalette'),    p.palette || 0);
    gl.uniform1f(U('uPaletteAmt'), (p.paletteAmt != null ? p.paletteAmt : 0));
    { const ap = App._autoPal || [[0,0,0],[0.33,0.33,0.33],[0.66,0.66,0.66],[1,1,1]];
      gl.uniform3f(U('uAutoPal0'), ap[0][0], ap[0][1], ap[0][2]);
      gl.uniform3f(U('uAutoPal1'), ap[1][0], ap[1][1], ap[1][2]);
      gl.uniform3f(U('uAutoPal2'), ap[2][0], ap[2][1], ap[2][2]);
      gl.uniform3f(U('uAutoPal3'), ap[3][0], ap[3][1], ap[3][2]); }
    gl.uniform1f(U('uHueRot'),    0);
    _uploadGradStops(gl, U, p);
    // Grad Map は sampleAB 内で全スロットにスロット単位で適用(両スロット均一)。シェーダの in-shader cosGrad は廃止。
    gl.uniform1f(U('uGradMix'),   p.gradMix || 0);
    gl.uniform1f(U('uCosGrad'),   0.0);                 // Cos Grad は廃止(composite では常に 0)
    gl.uniform1i(U('uCosPalette'), p.cosPalette || 0);
    gl.uniform1f(U('uBKeyBlack'), this.slots.B.bKey ? 1.0 : 0.0);   // @bkey シェーダ(保存プリセットの焼き込み src 互換)のみ黒キー。novel/ribbon は実 alpha に移行
    gl.uniform1f(U('uBKeyWhite'), this.slots.B.bKeyWhite ? 1.0 : 0.0);   // ribbon 等を Slot B で白キー透過
    gl.uniform1f(U('uPos'),       p.pos);
    gl.uniform1f(U('uBlm'),       p.blm);
    gl.uniform1f(U('uUnsharp'),       p.unsharp || 0);
    gl.uniform1f(U('uUnsharpRadius'), App.unsharpRadiusFromValue ? App.unsharpRadiusFromValue(p.unsharp) : (p.unsharpRadius || 1.5));
    gl.uniform1f(U('uInv'),       _sk ? 0 : (p.inv === true ? 1 : (Number(p.inv) || 0)));
    gl.uniform1f(U('uSlice'),     p.slice);
    gl.uniform1f(U('uSplit'),     p.split || 0);
    gl.uniform1f(U('uMosaic'),    p.mosaic);
    gl.uniform1f(U('uShake'),     p.shake);
    // セーフモード時は GPU 過負荷の主因になる重い FX を強制 0 にクランプ(明滅/クラッシュ防止)
    gl.uniform1f(U('uMblur'),     _safe ? 0 : p.mblur);
    gl.uniform1f(U('uGlass'),     _safe ? 0 : (p.glass || 0.0));
    gl.uniform1f(U('uGain'),      p.gain);
    gl.uniform1f(U('uVoxel'),     _safe ? 0 : (p.voxel || 0));
    gl.uniform1f(U('uRain'),      _safe ? 0 : (p.rain || 0));
    // Flames Post FX
    gl.uniform1f(U('uSketch'),    0);   // 単パス近似は無効(多パス SketchFX エンジンで処理)
    gl.uniform1f(U('uRings'),     _safe ? 0 : (p.rings || 0));
    const _candyBlocked = _sk || _safe;
    const _candyRaw = _candyBlocked ? 0 : Math.max(0, Math.min(1, p.candy || 0));
    const _candyBeatNow = App.visualBeat ? App.visualBeat() : ((typeof BPM !== 'undefined' && BPM.beatCount ? BPM.beatCount() : 0) * (App.beatScale || 1));
    const _candyDt = Math.max(0.001, Math.min(0.1, this.lastDt || 1/60));
    let _candyAmt = _candyRaw;
    if(_candyBlocked){
      this._candyRunning = false;
      this._candyTailStart = null;
      this._candyTailFrom = 0;
      this._candyLastAmount = 0;
      this._candySmooth = 0;
      _candyAmt = 0;
    } else if(_candyRaw > 0.001){
      const _candyPrev = isFinite(this._candySmooth) ? this._candySmooth : 0;
      const _candyRate = _candyRaw > _candyPrev ? 12.0 : 7.0;
      const _candyFollow = 1.0 - Math.exp(-_candyRate * _candyDt);
      _candyAmt = _candyPrev + (_candyRaw - _candyPrev) * _candyFollow;
      if(Math.abs(_candyAmt - _candyRaw) < 0.001) _candyAmt = _candyRaw;
      this._candySmooth = _candyAmt;
      this._candyRunning = true;
      this._candyTailStart = null;
      this._candyTailFrom = _candyAmt;
      this._candyLastAmount = _candyAmt;
    } else {
      if(this._candyRunning && this._candyTailStart == null){
        this._candyTailStart = _candyBeatNow;
        this._candyTailFrom = Math.max(0, this._candyLastAmount || 0);
      }
      if(this._candyTailStart != null){
        const _candyPh = Math.max(0, Math.min(1, _candyBeatNow - this._candyTailStart));
        const _candyEase = _candyPh * _candyPh * (3 - 2 * _candyPh);
        _candyAmt = (this._candyTailFrom || 0) * (1 - _candyEase);
        this._candySmooth = _candyAmt;
        if(_candyPh >= 1 || _candyAmt <= 0.001){
          _candyAmt = 0;
          this._candyRunning = false;
          this._candyTailStart = null;
          this._candyTailFrom = 0;
          this._candyLastAmount = 0;
          this._candySmooth = 0;
        }
      } else {
        this._candyRunning = false;
        this._candyTailFrom = 0;
        this._candyLastAmount = 0;
        this._candySmooth = 0;
      }
    }
    gl.uniform1f(U('uCandy'),     _candyAmt);
    gl.uniform1f(U('uClarity'),   p.clarity || 0);
    gl.uniform1f(U('uDenoise'),   _safe ? 0 : (p.denoise || 0));
    gl.uniform1f(U('uDeband'),    _safe ? 0 : (p.deband || 0));
    gl.uniform1f(U('uVibrance'),  p.vibrance || 0);
    gl.uniform1i(U('uGradMask'),  (this.slots.A.gradMask || this.slots.B.gradMask) ? 1 : 0);
    gl.uniform1i(U('uEmptyAB'),   (this.slots.A.kind === 'none' && this.slots.B.kind === 'none') ? 1 : 0);
    const _feedbackSafe = _safe || Math.abs(p.river || 0) > 0.001;
    // Feedback は合成段では適用せず、後段の独立パス _applyFeedbackBlend で適用する (fold の後)。
    gl.uniform1f(U('uFbAdd'),      0);
    gl.uniform1f(U('uFbMultiply'), 0);
    gl.uniform1f(U('uFbZoom'),    p.fbZoom || 0);
    gl.uniform1f(U('uFbRot'),     p.fbRot || 0);
    gl.uniform1f(U('uGlitchTrail'), p.glitchTrail || 0);   // 軽量(feedback 1サンプル)なのでセーフモードでも有効
    gl.activeTexture(gl.TEXTURE0 + 6);
    gl.bindTexture(gl.TEXTURE_2D, this._fbTrail ? this._fbTrail.tex : null);
    gl.uniform1i(U('uFbTex'), 6);
    gl.activeTexture(gl.TEXTURE0);
    // Tunnel 2パス: 前段で実 A/B 合成からトンネルを専用 FBO に描き、
    // 本パスでは sampleAB がそれを土台に返す(後段 FX が元映像を混ぜ戻して透ける問題の対策)。
    const _candyOn = _candyAmt > 0.001;
    if(_candyOn){
      const candyTarget = _candyAmt < 0.18 ? this._candyFBOLow : (_candyAmt < 0.48 ? this._candyFBOMid : this._candyFBO);
      const cw = candyTarget.w, ch = candyTarget.h;
      // 前フレームの本パスでユニット7に描画先テクスチャが残っていると
      // フィードバックループ (INVALID_OPERATION) になるため、描く前に必ず解除する。
      gl.activeTexture(gl.TEXTURE0 + 7);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(U('uCandyMode'), 1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, candyTarget.fbo);
      gl.uniform2f(U('uRes'), cw, ch);
      gl.viewport(0, 0, cw, ch);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._finalFBO.fbo);
      gl.uniform2f(U('uRes'), this._finalFBO.w, this._finalFBO.h);
      gl.viewport(0, 0, this._finalFBO.w, this._finalFBO.h);
      gl.uniform1i(U('uCandyMode'), 2);
      gl.activeTexture(gl.TEXTURE0 + 7);
      gl.bindTexture(gl.TEXTURE_2D, candyTarget.tex);
      gl.uniform1i(U('uCandyTex'), 7);
      gl.activeTexture(gl.TEXTURE0);
    } else {
      gl.uniform1i(U('uCandyMode'), 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    // ── Post FX パス順 (グループ順。composite 内のものは括弧で明記) ──
    //   1) Rain(合成内) + Water + Boltzmann
    //   2) Mondrian/Rings(合成内) + Slit-scan
    //   3) Barcode + Voxel(合成内) + Datamosh + Pixelsort
    //   4) マチエール: Relief + Bleed + Impasto + Chrome
    //   5) 色調補正 (Bri/Con/Sat/Hue。Grad/Auto Map はスロット単位のため合成内)
    //   6) 折り紙系: Needle → Origami → Kaiser (+Flames)
    //   7) Twist + FB Add/Multiply
    //   8) FXAA + Outline + Dither Blur + Gaussian Blur
    //   9) Pollock (最後・他 FX の影響を受けない)

    // 1) Water (Ballpoint Sketch) / Boltzmann
    if(typeof SketchFX !== 'undefined' && p && (p.sketch || 0) > 0.001 && !(App.safeMode)){
      const sketchPost = Object.assign({}, p, { bri:0, con:1, sat:1, hue:0 });
      SketchFX.apply(gl, this._finalFBO, p.sketch, sketchPost);
      gl.viewport(0, 0, this._finalFBO.w, this._finalFBO.h);
    }
    this._applyBoltzmannFinal(p);

    // 2) Slit-scan (境界線は Slice / Rings の線と同様この段階で乗る)
    this._applySlitScan(p, _safe);

    // 3) Barcode / Datamosh / Pixelsort (グリッチ系)
    this._applyBarcodePost(p, _safe);
    this._applyGlitchTrail(p);
    if(typeof PixelSortFX !== 'undefined' && p && (p.pixsort || 0) > 0.001 && !(App.safeMode)){
      const psHit = (typeof Audio !== 'undefined') ? (Audio.hit || 0) : 0;
      const psTime = this.clock || 0;
      PixelSortFX.apply(gl, this._finalFBO, p.pixsort, psHit, psTime);
      gl.viewport(0, 0, this._finalFBO.w, this._finalFBO.h);
    }

    // 4) マチエール系: 質感を乗せた画に、後段の色調補正を掛ける
    this._applyReliefPost(p, _safe);
    this._applyBleedPost(p, _safe);
    this._applyImpastoPost(p, _safe);
    this._applyChromePost(p, _safe);

    this._applyPresetTrans();   // プリセット切替の全画面トランジション (色調補正の直前)

    // 5) 色調補正 (Sat/Hue/Brightness/Contrast)
    this._applyFinalColorGrade();

    // 6) 折り紙系 (Needle → Origami → Kaiser)。2つ以上有効なら統合パスで頂点ごと重ねがけ。
    const _stacked = this._applyFoldStack(p, _safe);
    if(!_stacked){
      this._applyOrigamiPost(p, _safe);      // 表示: Needle
      this._applyKaiserPost(p, _safe);       // 表示: Origami
      this._applyKaiserOldPost(p, _safe);    // 表示: Kaiser
    }
    this._applyFlamesPost(p, _safe);

    // 7) Twist / Feedback (折った結果ごとうねらせ、トレイルを残す)
    this._applyTwistPost(p, _safe);
    this._applyFeedbackBlend(p, _safe);

    // 8) 仕上げの線とブラー (FXAA → Outline → Dither Blur → Gaussian Blur)
    if(App.post && App.post.fxaa){ this._applyFXAA(); }
    this._applyOutlinePost(p, _safe);
    this._applyDitherPost(p, _safe);
    this._applyGaussianPost(p, _safe);

    // 9) Pollock (最後)
    this._applyPollockFinal(p, _safe);

    // Feedback トレイル: Add / Multiply のどちらかが有効なら次フレーム用に保持。
    if(p && (Math.max(p.fbAdd || 0,p.fbMultiply || 0) > 0.001)){
      const w = this._finalFBO.w, h = this._finalFBO.h;
      if(!this._fbTrail) this._fbTrail = this._mkFBO(w, h);
      else if(this._fbTrail.w !== w || this._fbTrail.h !== h) this._resizeFBO(this._fbTrail, w, h);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._finalFBO.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._fbTrail.fbo);
      gl.blitFramebuffer(0,0,w,h, 0,0,w,h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else if(this._fbTrail){
      // 無効時は破棄する。OFF 時点の映像を持ち続けると、後で FB Add/Multiply を
      // 上げた瞬間に「以前表示していた映像」が一瞬混ざって表示される。
      gl.deleteTexture(this._fbTrail.tex);
      gl.deleteFramebuffer(this._fbTrail.fbo);
      this._fbTrail = null;
    }

    // _finalFBO → default FB に blit (toDefault=true のとき)
    if(toDefault){
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._finalFBO.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(
        0, 0, this._finalFBO.w, this._finalFBO.h,
        0, 0, this.canvas.width, this.canvas.height,
        gl.COLOR_BUFFER_BIT, gl.NEAREST
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
  },

  _applyBoltzmannFinal(p){
    const gl = this.gl;
    if(!p || typeof Boltzmann === 'undefined' || !this._finalFBO) return;
    const target = +p.boltz || 0;
    const active = Math.abs(target) > 0.001;
    const wasRunning = !!this._boltzRunning;
    const beatNow = App.visualBeat ? App.visualBeat() : ((typeof BPM !== 'undefined' && BPM.beatCount ? BPM.beatCount() : 0) * (App.beatScale || 1));
    let amount = target;
    let settle = 0;
    let finishAfter = false;
    if(active){
      this._boltzRunning = true;
      this._boltzTailStart = null;
      this._boltzLastAmount = target;
    } else {
      if(wasRunning && this._boltzTailStart == null) this._boltzTailStart = beatNow;
      if(this._boltzTailStart == null) return;
      const ph = Math.max(0, Math.min(1, beatNow - this._boltzTailStart));
      const ease = ph * ph * (3 - 2 * ph);
      amount = (this._boltzLastAmount || 0.35) * (1 - ease);
      settle = 0.020 + ease * 0.060;
      finishAfter = ph >= 1;
    }
    if(!Boltzmann.initialized) Boltzmann.init(gl);
    if(!Boltzmann.ok) return;
    if(this._bzCapture){
      Boltzmann.seeded = false;            // シミュをリセットしてワープ場を作り直す
      Boltzmann._dir = (Math.random() < 0.5) ? -1 : 1;   // 攪拌の向きはランダム (符号ではなく毎リセットで抽選)
      this._bzCapture = false;
      this._boltzTailStart = null;
      this._boltzRunning = active;
    }
    const w = this._finalFBO.w, h = this._finalFBO.h;
    if(!this._boltzTmp) this._boltzTmp = this._mkFBO(w, h); else this._resizeFBO(this._boltzTmp, w, h);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._finalFBO.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._boltzTmp.fbo);
    gl.blitFramebuffer(0,0,w,h, 0,0,w,h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    Boltzmann.renderWarp({ srcTex:this._boltzTmp.tex, fbo:this._finalFBO.fbo, w, h,
                           amount,
                           settle,
                           pulse: (((beatNow * 2) % 1 + 1) % 1) });   // 1/2拍位相(×A連動)
    gl.bindVertexArray(null);
    gl.viewport(0, 0, this._finalFBO.w, this._finalFBO.h);
    if(finishAfter){
      this._boltzRunning = false;
      this._boltzTailStart = null;
      this._boltzLastAmount = 0;
      Boltzmann.seeded = false;
    }
  },

  _applyPollockFinal(p, safe){
    const gl = this.gl;
    if(!p || typeof PollockFX === 'undefined' || !this._finalFBO) return;
    // Gloss / Matt / Flat の 3 スライダー(各0..1)から合成。最大の 1 つが有効 (uStyle は単一のため)。
    const pkG = safe ? 0 : (+p.pollockGloss || 0);
    const pkM = safe ? 0 : (+p.pollockMatt || 0);
    const pkF = safe ? 0 : (+p.pollockFlat || 0);
    let pkVal, pkFlat = false;
    if(pkF >= pkG && pkF >= pkM){ pkVal = pkF; pkFlat = pkF > 0.001; }   // Flat: gloss ジオメトリ + uFlat
    else if(pkG >= pkM){ pkVal = pkG; }
    else { pkVal = -pkM; }
    const pkAlive = Math.abs(pkVal) > 0.001 || (PollockFX.isAlive && PollockFX.isAlive());
    if(!pkAlive) return;
    if(!PollockFX.initialized) PollockFX.init(gl);
    if(this._pkCapture){
      PollockFX.reset(gl, this._finalFBO.w, this._finalFBO.h, pkFlat ? 'matt' : (pkVal >= 0 ? 'gloss' : 'matt'));
      this._pkCapture = false;
    }
    const w = this._finalFBO.w, h = this._finalFBO.h;
    if(!this._pollockTmp) this._pollockTmp = this._mkFBO(w, h); else this._resizeFBO(this._pollockTmp, w, h);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._finalFBO.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._pollockTmp.fbo);
    gl.blitFramebuffer(0,0,w,h, 0,0,w,h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    const beatNow = App.visualBeat ? App.visualBeat() : BPM.beatCount() * App.beatScale;
    const pkDrawAmount = PollockFX.render({ srcTex:this._pollockTmp.tex, fbo:this._finalFBO.fbo, w, h,
                       value:pkVal, flat:pkFlat, pulse: ((beatNow * 2) % 1 + 1) % 1,
                       beat:beatNow, bpm:BPM.bpm, transBeats:App.transBeats||0,
                       transStyle:App.transStyle||0, time:this.clock||0 });
    gl.bindVertexArray(null);
    gl.viewport(0, 0, this._finalFBO.w, this._finalFBO.h);

    if(pkDrawAmount > 0.001 && this._pollockTmp && PollockFX.blur && (pkVal >= 0 || PollockFX._style === 'gloss')){
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._finalFBO.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._pollockTmp.fbo);
      gl.blitFramebuffer(0,0,w,h, 0,0,w,h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      const pkBlurStyle = Math.abs(pkVal) > 0.001 ? pkVal : (PollockFX._style === 'matt' ? -1 : 1);
      const pkBlurAmount = pkBlurStyle >= 0 ? pkDrawAmount * 0.72 : pkDrawAmount;
      PollockFX.blur({ srcTex:this._pollockTmp.tex, fbo:this._finalFBO.fbo, w, h, amount:pkBlurAmount, style:pkBlurStyle });
      gl.bindVertexArray(null);
      gl.viewport(0, 0, this._finalFBO.w, this._finalFBO.h);
    }
  },

  // スクリーンショット: 最終フレーム(_finalFBO)を PNG でダウンロード
  screenshot(){
    const gl = this.gl;
    this.render();                 // 最新フレームを確実に用意
    const fb = this._finalFBO;
    if(!fb){ return; }
    const w = fb.w, h = fb.h;
    const px = new Uint8Array(w*h*4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    for(let y=0; y<h; y++){               // 上下反転(GL は下が原点)
      const srow = (h-1-y)*w*4, drow = y*w*4;
      img.data.set(px.subarray(srow, srow + w*4), drow);
    }
    ctx.putImageData(img, 0, 0);
    const fname = 'gara_' + Date.now() + '.png';
    // dataURL → Blob(同期)。navigator.share は user gesture 内で同期的に呼ぶ必要があるため toBlob(非同期)は使わない
    const dataUrl = c.toDataURL('image/png');
    const bin = atob(dataUrl.split(',')[1]);
    const arr = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type:'image/png' });
    const doDownload = ()=>{
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = fname;
      document.body.appendChild(a); a.click();
      setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      if(typeof toast === 'function') toast('Screenshot saved');
    };
    // モバイル(タッチ)は Web Share API で共有シートを開く(「写真に保存」が選べる)
    const isMobile = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if(isMobile && navigator.canShare){
      const file = new File([blob], fname, { type:'image/png' });
      if(navigator.canShare({ files:[file] })){
        navigator.share({ files:[file], title:'GARA' })
          .then(()=>{ if(typeof toast === 'function') toast('共有シートから「写真に保存」を選べます'); })
          .catch((e)=>{ if(e && e.name === 'AbortError') return; doDownload(); });   // キャンセルは無視 / 失敗はDL
        return;
      }
    }
    doDownload();
  },

  // プリセットのサムネ用に最終出力を小さな canvas でキャプチャ (全mode対応のスナップショット)
  grabThumbCanvas(maxW){
    const gl = this.gl;
    if(!gl) return null;
    this.render();
    const fb = this._finalFBO;
    if(!fb) return null;
    const w = fb.w, h = fb.h;
    let px;
    try{
      px = new Uint8Array(w*h*4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb.fbo);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }catch(e){ return null; }
    const full = document.createElement('canvas'); full.width = w; full.height = h;
    const fctx = full.getContext('2d');
    const img = fctx.createImageData(w, h);
    for(let y=0; y<h; y++){ const s=(h-1-y)*w*4, d=y*w*4; img.data.set(px.subarray(s, s+w*4), d); }  // 上下反転
    fctx.putImageData(img, 0, 0);
    maxW = maxW || 256;
    const sc = Math.min(1, maxW / w);
    const tw = Math.max(1, Math.round(w*sc)), th = Math.max(1, Math.round(h*sc));
    const small = document.createElement('canvas'); small.width = tw; small.height = th;
    small.getContext('2d').drawImage(full, 0, 0, tw, th);
    return small;
  },
  // 上記 canvas を JPEG dataURL に (静止サムネ用)
  grabThumbDataURL(maxW){
    const c = this.grabThumbCanvas(maxW);
    if(!c) return null;
    try{ return c.toDataURL('image/jpeg', 0.72); }catch(e){ return null; }
  },

  // 最終カラーグレード: Sat/Hue/Brightness/Contrast は通常 Post FX / Transition の後にだけ適用する。
  // Boltzmann / Pollock はこの後に描くので、カラーグレードや Audio FX を被らない。
  _applyFinalColorGrade(){
    const gl = this.gl;
    if(!this.pipProg || !this._finalFBO) return;
    const p = App.effectivePost ? App.effectivePost(App.post || {}) : (App.post || {});
    // 手動 Hue(1.0=180°)と自動ローテート位相(全周)は別々に渡す。スケール変換は _applyMiniFxUniforms に集約。
    const hueImage = App.imageHue ? App.imageHue(Object.assign({}, p, {hueAuto: App._hueRotPhase || 0})) : 0;
    const hueManual = 0;                    // 手動 Hue は imageHue に集約 (常にライブで最終出力へ)
    const hueAuto = App._hueRotPhase || 0;
    const sat = (p.sat != null ? p.sat : 1);
    const bri = p.bri || 0;
    const con = (p.con != null ? p.con : 1);
    if(Math.abs(bri) <= 0.0001 && Math.abs(con - 1) <= 0.0001 && Math.abs(sat - 1) <= 0.0001 && Math.abs(hueImage) <= 0.0001) return;
    const w = this._finalFBO.w, h = this._finalFBO.h;
    if(!this._finalGradeTmp || this._finalGradeTmp.w !== w || this._finalGradeTmp.h !== h){
      if(this._finalGradeTmp){ gl.deleteTexture(this._finalGradeTmp.tex); gl.deleteFramebuffer(this._finalGradeTmp.fbo); }
      this._finalGradeTmp = this._mkRGBA8FBO(w, h);
    }
    const post = {
      bri, con, sat, hue: hueManual, hueAuto, hueImage,
      gradMix:0,
      gamma:1,
      unsharp:0,
      unsharpRadius:1.5,
      slit2:0,
    };
    gl.useProgram(this.pipProg);
    gl.bindVertexArray(this.quadVAO);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._finalGradeTmp.fbo);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._finalFBO.tex);
    _applyMiniFxUniforms(gl, this.pipProg, w, h, false, post);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._finalGradeTmp.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._finalFBO.fbo);
    gl.blitFramebuffer(0,0,w,h, 0,0,w,h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },

  // FXAA: _finalFBO に対して 1パス適用して書き戻す
  // Slit-scan (移動式 / 参照元スクロール) を最終フレームに適用。前フレームバッファを ping-pong で保持。
  // Datamosh: 専用 ping-pong バッファでマクロブロックの時間残留を保持する。
  _applyGlitchTrail(p){
    const gl = this.gl;
    if(!this.glitchProg || !this._finalFBO) return;
    const amt = p ? (p.glitchTrail || 0) : 0;   // glitch は軽いので safe でも有効
    const w = this._finalFBO.w, h = this._finalFBO.h;
    if(!(amt > 0.001)){
      // 無効時はバッファを破棄(再有効化時に古い残像を出さない)
      if(this._glitchPP){ for(const f of this._glitchPP){ gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fbo); } this._glitchPP = null; }
      return;
    }
    if(!this._glitchPP || this._glitchPP[0].w !== w || this._glitchPP[0].h !== h){
      if(this._glitchPP){ for(const f of this._glitchPP){ gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fbo); } }
      this._glitchPP = [this._mkFBO(w,h), this._mkFBO(w,h)];
      this._glitchIdx = 0;
    }
    if(!this._glitchDisp || this._glitchDisp.w !== w || this._glitchDisp.h !== h){
      if(this._glitchDisp){ gl.deleteTexture(this._glitchDisp.tex); gl.deleteFramebuffer(this._glitchDisp.fbo); }
      this._glitchDisp = this._mkFBO(w, h);
    }
    const prev = this._glitchPP[this._glitchIdx];
    const next = this._glitchPP[this._glitchIdx ^ 1];
    gl.useProgram(this.glitchProg);
    gl.bindVertexArray(this.quadVAO);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    const U = (n)=>gl.getUniformLocation(this.glitchProg, n);
    // Pass 1: acc 更新 → next  (uPrev=前 acc / uCur=シーン)
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, prev.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._finalFBO.tex);
    gl.uniform1i(U('uPrev'), 0);
    gl.uniform1i(U('uCur'), 1);
    gl.uniform2f(U('uRes'), w, h);
    gl.uniform1f(U('uTime'), this.clock || 0);
    const glitchBeat = (typeof App !== 'undefined' && App.visualBeat)
      ? App.visualBeat()
      : ((typeof BPM !== 'undefined' && BPM.beatCount) ? BPM.beatCount() : 0);
    gl.uniform1f(U('uBeat'), glitchBeat);
    gl.uniform1f(U('uMode'), 0.0);
    gl.uniform1f(U('uAmt'), amt);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Pass 2: 表示ブレンド → _glitchDisp  (uPrev=新 acc / uCur=シーン)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._glitchDisp.fbo);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, next.tex);
    gl.uniform1f(U('uMode'), 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    // _glitchDisp → _finalFBO
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._glitchDisp.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._finalFBO.fbo);
    gl.blitFramebuffer(0,0,w,h, 0,0,w,h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._glitchIdx ^= 1;
  },

  _applySlitScan(p, safe){
    const gl = this.gl;
    if(!this.slitProg || !this.sliceProg || !this._finalFBO) return;
    const target = safe ? 0 : (p.slitScan || 0);
    const aT = Math.abs(target);
    const active = aT > 0.001;
    const wasRunning = !!this._slitRunning;
    if(active){
      this._slitRunning = true;
      this._slitTail = 0;
      // 上下方向はランダムなタイミングで反転 (符号では決めない)。
      if(!this._slitLastDir) this._slitLastDir = (Math.random() < 0.5) ? -1 : 1;
      const tNow = now();
      if(this._slitDirFlipAt == null) this._slitDirFlipAt = tNow + 1.2 + Math.random() * 3.0;
      if(tNow >= this._slitDirFlipAt){
        this._slitLastDir = -this._slitLastDir;
        this._slitDirFlipAt = tNow + 1.2 + Math.random() * 3.0;   // 次の反転まで 1.2〜4.2 秒
      }
      this._slitLastA = aT;
    } else {
      this._slitDirFlipAt = null;
      if(wasRunning && !(this._slitTail > 0)) this._slitTail = 1.0;
      if(!(this._slitTail > 0)){
        this._slitPrevBase = null; this._slitAcc = 0; this._slitSrc = 0; this._slitBands = null; this._slitSeed = null; this._slitRunning = false; this._slitTail = 0; return;
      }
    }

    const a = active ? aT : (this._slitLastA || 0.35);
    const an = Math.min(1, a);
    const bands = 1.0 + Math.floor(Math.pow(an, 2.8) * 23.999); // |値|=分割数。低値はかなり少ない広い帯で粘り、高値で最大24分割
    const baseC = App.visualBeat ? App.visualBeat() : ((typeof BPM !== 'undefined' && BPM.beatCount ? BPM.beatCount() : 0) * (App.beatScale || 1));
    const resetSeed = ()=>{
      this._slitSeed = Math.floor(baseC) * 17 + bands * 131 + (this._slitLastDir < 0 ? 53 : 0);
    };

    const w = this._finalFBO.w, h = this._finalFBO.h;
    const refill = ()=>{                              // 両バッファを現在フレームで埋める(黒/古い残りを避ける)
      for(const f of this._slitPP){
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._finalFBO.fbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, f.fbo);
        gl.blitFramebuffer(0,0,w,h, 0,0,w,h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };
    if(!this._slitPP || this._slitPP[0].w !== w || this._slitPP[0].h !== h){
      if(this._slitPP){ for(const f of this._slitPP){ gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fbo); } }
      this._slitPP = [this._mkFBO(w,h), this._mkFBO(w,h)];
      this._slitIdx = 0; this._slitSrc = 0; this._slitAcc = 0; this._slitPrevBase = null;
      resetSeed();
      refill();
    } else if(!wasRunning && active){
      this._slitSrc = 0; this._slitAcc = 0; this._slitPrevBase = null;
      resetSeed();
      refill();                                        // 再有効化時に古い残像をリセット
    }
    if(!Number.isFinite(this._slitSeed)) resetSeed();
    this._slitBands = bands;

    // スクロール量(整数テクセル, 端数持ち越し)。常に visual beat で1拍1周。
    const db = baseC - (this._slitPrevBase != null ? this._slitPrevBase : baseC);
    this._slitPrevBase = baseC;
    const stepv = bands / h;                            // 1pxぶんを「帯内ローカルUV」に換算
    this._slitAcc = (this._slitAcc || 0) + Math.abs(db);
    let px = Math.trunc(this._slitAcc / stepv);
    const maxpx = Math.max(1, Math.floor(0.5 * h / bands));
    if(px > maxpx) px = maxpx;
    this._slitAcc -= px * stepv;
    const scroll = px * stepv;
    this._slitSrc = (((this._slitSrc || 0) + scroll) % 1 + 1) % 1;   // 参照元の読み取り位置も同期して進む
    let finishAfter = false;
    if(!active){
      this._slitTail = Math.max(0, (this._slitTail || 0) - scroll);
      finishAfter = this._slitTail <= 0;
    }

    const prev = this._slitPP[this._slitIdx];
    const next = this._slitPP[this._slitIdx ^ 1];
    gl.useProgram(this.slitProg);
    gl.bindVertexArray(this.quadVAO);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._finalFBO.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, prev.tex);
    const U1 = (n)=>gl.getUniformLocation(this.slitProg, n);
    gl.uniform1i(U1('uLive'), 0);
    gl.uniform1i(U1('uPrev'), 1);
    gl.uniform1f(U1('uScroll'), scroll);
    gl.uniform1f(U1('uSrcPos'), this._slitSrc);
    gl.uniform1f(U1('uSign'), this._slitLastDir || 1);
    gl.uniform1f(U1('uBands'), bands);
    gl.uniform1f(U1('uSlitSize'), Math.min(0.90, Math.max(0.16, 0.95 / Math.sqrt(bands))));
    gl.uniform1f(U1('uSeed'), this._slitSeed || 0);
    gl.uniform2f(U1('uRes'), w, h);
    { const c = this._fxLineRGB || [1,1,1]; gl.uniform3f(U1('uFxLineCol'), c[0], c[1], c[2]); gl.uniform1f(U1('uFxLineOn'), this._fxLineOn ? 1 : 0); }
    gl.drawArrays(gl.TRIANGLES, 0, 3);   // → next = クリーンなロール(帰還用)

    // 2) Slice パス: next(ロール) を _slitDisp へ反映
    if(!this._slitDisp || this._slitDisp.w !== w || this._slitDisp.h !== h){
      if(this._slitDisp){ gl.deleteTexture(this._slitDisp.tex); gl.deleteFramebuffer(this._slitDisp.fbo); }
      this._slitDisp = this._mkFBO(w, h);
    }
    gl.useProgram(this.sliceProg);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._slitDisp.fbo);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, next.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._finalFBO.tex);
    const U2 = (n)=>gl.getUniformLocation(this.sliceProg, n);
    gl.uniform1i(U2('uRoll'), 0);
    gl.uniform1i(U2('uLive'), 1);
    gl.uniform2f(U2('uRes'), w, h);
    gl.uniform1f(U2('uFade'), 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    // _slitDisp → _finalFBO (表示/スクショ用)。next はクリーンなまま帰還に残す。
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._slitDisp.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._finalFBO.fbo);
    gl.blitFramebuffer(0,0,w,h, 0,0,w,h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._slitIdx ^= 1;
    if(finishAfter){
      this._slitPrevBase = null;
      this._slitAcc = 0;
      this._slitSrc = 0;
      this._slitBands = null;
      this._slitSeed = null;
      this._slitRunning = false;
      this._slitTail = 0;
    }
  },

  _applyOrigamiPost(p, safe){
    const gl = this.gl;
    const amount = safe ? 0 : Math.max(0, Math.min(1, +(p && p.origami) || 0));
    if(amount <= 0.001 || !this.origamiProg || !this._finalFBO) return;
    const w = this._finalFBO.w, h = this._finalFBO.h;
    // 2x スーパーサンプリング + MSAA: 結晶エッジをベクター品質で解決 (等倍 FBO 直描きだとラスターのギザが出る)
    const SSn = 2;
    const w2 = w * SSn, h2 = h * SSn;
    if(!this._origamiTmp || this._origamiTmp.w !== w2 || this._origamiTmp.h !== h2){
      if(this._origamiTmp){
        gl.deleteRenderbuffer(this._origamiTmp.color); gl.deleteRenderbuffer(this._origamiTmp.depth); gl.deleteFramebuffer(this._origamiTmp.fbo);
        gl.deleteTexture(this._origamiTmp.rtex); gl.deleteFramebuffer(this._origamiTmp.rfbo); gl.deleteTexture(this._origamiTmp.srcTex);
      }
      const samples = Math.min(8, gl.getParameter(gl.MAX_SAMPLES) || 0);
      const color = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, color);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w2, h2);
      const depth = gl.createRenderbuffer();                        // 交差する結晶の前後関係を解くための深度
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w2, h2);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      const rtex = gl.createTexture();                              // MSAA 解決先 (2x テクスチャ)
      gl.bindTexture(gl.TEXTURE_2D, rtex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w2, h2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const rfbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, rfbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rtex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // 紙テクスチャ用ソース: ミップマップ + 異方性 (急斜面の縮小サンプルのドットノイズ防止)
      const srcTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
      if(aniso){
        const maxA = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1;
        gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxA));
      }
      this._origamiTmp = {fbo, color, depth, rtex, rfbo, srcTex, w: w2, h: h2};
    }
    const shadowSize = 1024;
    if(this.origamiShadowProg && !this._origamiShadow && !this._origamiShadowFailed){
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, shadowSize, shadowSize, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this._origamiShadow = complete ? {tex, fbo, size:shadowSize} : null;
      if(!complete){ this._origamiShadowFailed = true; gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); }
    }
    const P = this.origamiProg;
    const SP = this.origamiShadowProg;
    const postTime = this.postClock != null ? this.postClock : this.clock;
    const visualBeat = (typeof App !== 'undefined' && App.visualBeat) ? App.visualBeat() : ((typeof BPM !== 'undefined' && BPM.beatCount) ? BPM.beatCount() : 0);
    const hit = (typeof Audio !== 'undefined') ? (Audio.hit || 0) : 0;
    const beatMode = (typeof App !== 'undefined' && App.beatMode === 'beat') ? 1 : 0;

    // ── 結晶ジオメトリを CPU で生成 (ベクター方式: グリッド量子化のギザギザが原理的に出ない) ──
    // 各結晶 = 三角錐 (底面三角形 + 頂点)。crystalLayer のセル列挙/ビート駆動を JS に移植。
    const asp = w / Math.max(1, h);
    const extX = 4.4 * asp, extY = 4.4;
    const amp = amount * amount * (3 - 2 * amount);
    const hitBoost = beatMode ? 0.46 : 0.10;
    // onset エンベロープ: デッドゾーン直後の depth 下駄(0.10)による突然の凹凸を抑え、0 から立ち上げる。
    const onF = (a=>{ const t = Math.max(0, Math.min(1, a / 0.16)); return t*t*(3-2*t); })(amount);
    const depth = onF * (0.10 + 3.65 * amp) * (1 + hitBoost * Math.pow(Math.max(0, Math.min(1, hit)), 0.65));
    const frac = (x)=>x - Math.floor(x);
    const h21 = (px, py)=>{
      let ax = frac(px * 123.34), ay = frac(py * 456.21);
      const d = ax * (ax + 45.32) + ay * (ay + 45.32);
      ax += d; ay += d;
      return frac(ax * ay);
    };
    const h22 = (px, py)=>{ const n = h21(px, py); return [n, h21(px + n + 19.19, py + n + 19.19)]; };
    const sstep = (a, b, x)=>{ const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const mixf = (a, b, t)=>a + (b - a) * t;
    const beatId = Math.floor(visualBeat), bp = visualBeat - beatId;
    const beatQ = Math.max(0, Math.min(1, bp / 0.24));
    const beatEase = 1 - Math.pow(1 - beatQ, 3);
    const beatPulse = Math.pow(Math.sin(beatQ * Math.PI), 2) * beatMode;
    const motionTime = postTime * mixf(3.0, 1.0, beatMode);        // Droneだけ連続運動を前倒し。Beatの拍頭変形は維持
    const verts = [];
    const pushV = (x, y, z, u, v, f2)=>{ verts.push(x, y, z, u, v, f2); };
    const uvOf = (wx, wy)=>[wx / (2 * extX) + 0.5, wy / (2 * extY) + 0.5];
    // ── キャンバスをランダム三角形分割した一枚のメッシュ。丘も針も同じメッシュの種点の隆起 ──
    // として生やす (別ジオメトリの円錐を置かない) = 飛び地が構造的に発生しない。
    const S = 6.4;                                                 // 格子密度。細かな三角面を約1.9倍に増やす
    const nxC = Math.ceil(S * asp) + 1, nyC = Math.ceil(S) + 1;
    const seeds = [];
    const napex = [];                                              // 針の頂点 (橋用)
    for(let cy = -1; cy <= nyC; cy++){
      const row = [];
      for(let cx = -1; cx <= nxC; cx++){
        const rnd = h22(cx + 17.3, cy + 41.9);
        let sx = cx + mixf(0.18, 0.82, rnd[0]), sy = cy + mixf(0.18, 0.82, rnd[1]);
        const phase = h21(cx + 54.6, cy + 77.1) * Math.PI * 2;
        const mA = h22(cx + beatId * 7.13 + 31.7, cy + beatId * 3.91 + 83.2);
        const mB = h22(cx + (beatId + 1) * 7.13 + 31.7, cy + (beatId + 1) * 3.91 + 83.2);
        const bmx = mixf(mA[0] - 0.5, mB[0] - 0.5, beatEase), bmy = mixf(mA[1] - 0.5, mB[1] - 0.5, beatEase);
        const dmx = Math.sin(motionTime * 0.075 + phase) * 0.5, dmy = Math.cos(motionTime * 0.061 + phase * 1.37) * 0.5;
        const travel = mixf(0.16, 0.5, beatMode);
        sx += mixf(dmx, bmx, beatMode) * travel;
        sy += mixf(dmy, bmy, beatMode) * travel;
        const su = sx / (S * asp), sv2 = sy / S;
        // 丘 (全種点): 低い起伏
        const hdens = h21(cx + 281.3, cy + 109.4);
        let hrise = 0.5 + 0.5 * Math.sin(motionTime * mixf(0.1, 0.25, h21(cx + 293.4, cy + 105.2)) + phase);
        hrise = hrise * hrise * (3 - 2 * hrise);
        // 丘は低く抑える (丸い土台がギザギザの輪郭を埋めないように)
        const hillRaw = mixf(0.02, 0.9, Math.pow(hdens, 3.5)) * mixf(0.4, 1.1, hrise) * depth * 0.2;
        const hillDisp = hillRaw / Math.sqrt(1 + hillRaw * hillRaw / (7.2 * 7.2));
        // 針 (約 1/3 の種点): 高い隆起 + リーン。同じ種点から生える
        let nx3 = 0, ny3 = 0, nz3 = hillDisp;
        const isN = h21(cx + 401.7, cy + 77.3) < 0.55;
        let dispN = 0;
        if(isN){
          const speed = mixf(0.22, 0.68, h21(cx + 93.4, cy + 5.2));
          const droneCycle = motionTime * speed * 0.38 + phase;
          const rA = h21(cx + beatId * 17.7 + 104.8, cy + beatId * 7.3 + 18.3);
          const rB = h21(cx + (beatId + 1) * 17.7 + 104.8, cy + (beatId + 1) * 7.3 + 18.3);
          let rise = mixf(0.5 + 0.5 * Math.sin(droneCycle), mixf(rA, rB, beatEase), beatMode);
          rise = rise * rise * (3 - 2 * rise);
          let density = h21(cx + 181.3, cy + 9.4);
          const centerW = 1 - sstep(0.06, 0.52, Math.hypot(su - 0.5, sv2 - 0.5));
          density = Math.max(0, Math.min(1, density + centerW * 0.14));
          const primary = sstep(0.62, 0.84, density);
          const slender = Math.pow(h21(cx + 219.4, cy + 47.3), 1.2);
          const summit = mixf(0.22, 1.0, sstep(0.48, 0.82, density));
          const peak = mixf(1.90, 9.20, Math.pow(density, 3.15)) * summit * mixf(1.0, 1.55, slender) * mixf(1.0, 1.82, primary);
          let growth = mixf(mixf(0.78, 1.22, rise), mixf(0.48, 1.72, rise) * (1 + beatPulse * 0.82), beatMode);
          const primaryGrowth = mixf(1.02, 1.58, rise) * (1 + beatPulse * 0.42);
          growth = mixf(growth, primaryGrowth, primary);
          // 高さを二極化: 低い針と高い針が隣り合い、横から見た輪郭が極端なギザギザになる
          const jagR = h21(cx + 331.9, cy + 157.1);
          const jag = jagR < 0.45 ? mixf(0.06, 0.32, jagR / 0.45) : mixf(0.9, 1.8, (jagR - 0.45) / 0.55);
          const raw = peak * growth * 1.05 * depth * jag;
          const heightCap = mixf(7.2, 10.8, primary);
          dispN = raw / Math.sqrt(1 + raw * raw / (heightCap * heightCap));
          const lA = h21(cx + beatId * 9.7 + 121.7, cy + 31.6) * 2 - 1;
          const lB = h21(cx + (beatId + 1) * 9.7 + 121.7, cy + 31.6) * 2 - 1;
          const leanMotion = mixf(Math.sin(droneCycle * 0.73), mixf(lA, lB, beatEase), beatMode);
          const leanAng = h21(cx + 121.7, cy + 31.6) * Math.PI * 2 + 0.72 * leanMotion;
          const leanAmt = mixf(0.48, 0.98, rnd[0]) * (0.82 + 0.32 * rise + 0.34 * beatPulse) * mixf(1.0, 0.24, primary);
          const lxv = Math.cos(leanAng) * leanAmt, lyv = Math.sin(leanAng) * leanAmt;
          const sl = Math.hypot(lxv, lyv, 1);
          // 鍾乳洞: 針を上下(±z)両面に生やす。約半数を下向き(石筍↑ / 鍾乳石↓)= 山と谷が交互に突き出す
          const zdir = h21(cx + 61.3, cy + 137.9) < 0.5 ? 1 : -1;
          const cap = mixf(7.6, 11.3, primary);
          nx3 = (lxv / sl) * dispN;
          ny3 = (lyv / sl) * dispN;
          const zext = (1 / sl) * dispN;
          nz3 = zdir > 0 ? Math.min(cap, hillDisp + zext) : Math.max(-cap, hillDisp - zext);
        }
        const pt = { x: (su - 0.5) * 2 * extX + nx3, y: (sv2 - 0.5) * 2 * extY + ny3, z: nz3, u: su, v: sv2, d: isN ? dispN : 0 };
        row.push(pt);
        if(isN && dispN > 1.0) napex.push({ x: pt.x, y: pt.y, z: pt.z, u: pt.u, v: pt.v, f: h21(cx + 101.0, cy + 211.7) });
      }
      seeds.push(row);
    }
    // ── 局所適応テッセレーション (針の周辺だけ細分化) ──
    // エッジの分割判定は両端の種点の針高 d のみで決まる(=そのエッジを共有する隣接三角形で
    // 必ず一致)→ T字クラックが出ない。細分頂点には二次変位を足し、針の岩肌を細かく刻む。
    const DTHR = 1.4;                                              // このエッジ長以上の針高で細分
    const rawTri = (a, b, c, ff)=>{ pushV(a.x, a.y, a.z, a.u, a.v, ff); pushV(b.x, b.y, b.z, b.u, b.v, ff); pushV(c.x, c.y, c.z, c.u, c.v, ff); };
    const needSplit = (a, b)=> Math.max(a.d, b.d) > DTHR;
    // エッジ中点 (a,b に対して対称に計算 → 呼び順に依らず同一頂点)
    const edgeMid = (a, b)=>{
      const u = (a.u + b.u) * 0.5, v = (a.v + b.v) * 0.5;
      const localD = 0.5 * (a.d + b.d);                            // 針が高いエッジほど岩肌を強く刻む
      const hz = h21(u * 96.7 + 5.3, v * 96.7 + 11.9) - 0.5;       // ±z の細かい凹凸 (二次針)
      const hx = h21(u * 71.3 + 23.1, v * 71.3 + 3.7) - 0.5;
      const hy = h21(u * 58.9 + 41.7, v * 58.9 + 61.3) - 0.5;
      return { x: (a.x + b.x) * 0.5 + hx * localD * 0.10,
               y: (a.y + b.y) * 0.5 + hy * localD * 0.10,
               z: (a.z + b.z) * 0.5 + hz * localD * 0.42,
               u, v, d: localD };
    };
    // A,B,C を分割エッジに応じてクラックなく再分割 (red-green パターン)
    const emitTri = (A, B, C, ff)=>{
      const sAB = needSplit(A, B), sBC = needSplit(B, C), sCA = needSplit(C, A);
      const n = (sAB ? 1 : 0) + (sBC ? 1 : 0) + (sCA ? 1 : 0);
      if(n === 0){ rawTri(A, B, C, ff); return; }
      const ab = sAB ? edgeMid(A, B) : null, bc = sBC ? edgeMid(B, C) : null, ca = sCA ? edgeMid(C, A) : null;
      if(n === 3){
        rawTri(A, ab, ca, ff); rawTri(ab, B, bc, ff); rawTri(ca, bc, C, ff); rawTri(ab, bc, ca, ff);
      } else if(n === 1){
        if(ab){ rawTri(A, ab, C, ff); rawTri(ab, B, C, ff); }
        else if(bc){ rawTri(A, B, bc, ff); rawTri(A, bc, C, ff); }
        else { rawTri(A, B, ca, ff); rawTri(ca, B, C, ff); }
      } else { // n === 2
        if(ab && bc){ rawTri(ab, B, bc, ff); rawTri(A, ab, bc, ff); rawTri(A, bc, C, ff); }
        else if(ab && ca){ rawTri(A, ab, ca, ff); rawTri(ab, B, C, ff); rawTri(ab, C, ca, ff); }
        else { rawTri(bc, C, ca, ff); rawTri(A, B, bc, ff); rawTri(A, bc, ca, ff); }
      }
    };
    // 三角形分割 (対角線は市松で交互) → 各三角形を適応再分割
    for(let cy = 0; cy < seeds.length - 1; cy++) for(let cx = 0; cx < seeds[0].length - 1; cx++){
      const s00 = seeds[cy][cx], s10 = seeds[cy][cx + 1], s01 = seeds[cy + 1][cx], s11 = seeds[cy + 1][cx + 1];
      const ff1 = h21(cx * 3.1 + 11.3, cy * 7.7 + 5.9), ff2 = h21(cx * 9.2 + 1.7, cy * 2.9 + 40.1);
      if(((cx + cy) & 1) === 0){ emitTri(s00, s10, s11, ff1); emitTri(s00, s11, s01, ff2); }
      else                     { emitTri(s10, s11, s01, ff1); emitTri(s10, s01, s00, ff2); }
    }
    // 橋: 各針を近い順に 2 本まで鞍状の屋根で接続 (最近傍グラフ)
    const links = new Set();
    for(let i = 0; i < napex.length; i++){
      const dists = [];
      for(let j = 0; j < napex.length; j++){
        if(j === i) continue;
        const d = Math.hypot(napex[i].x - napex[j].x, napex[i].y - napex[j].y);
        if(d > 1e-4) dists.push([d, j]);
      }
      dists.sort((a, b)=>a[0] - b[0]);
      let added = 0;
      for(const [d, j] of dists){
        if(added >= 2) break;
        if(d > 7.0) break;
        const key = (i < j) ? i * 4096 + j : j * 4096 + i;
        if(!links.has(key)){ links.add(key); added++; }
      }
    }
    for(const key of links){
      const A2 = napex[Math.floor(key / 4096)], B2 = napex[key % 4096];
      const dxy = Math.hypot(A2.x - B2.x, A2.y - B2.y);
      const mx2 = (A2.x + B2.x) / 2, my2 = (A2.y + B2.y) / 2;
      const dirx = (B2.x - A2.x) / dxy, diry = (B2.y - A2.y) / dxy;
      const wd = 0.55;
      const gL = [mx2 - diry * wd, my2 + dirx * wd], gR = [mx2 + diry * wd, my2 - dirx * wd];
      const uL = uvOf(gL[0], gL[1]), uR = uvOf(gR[0], gR[1]);
      const ff = frac(A2.f + B2.f);
      pushV(A2.x, A2.y, A2.z, A2.u, A2.v, ff); pushV(B2.x, B2.y, B2.z, B2.u, B2.v, ff); pushV(gL[0], gL[1], 0.15, uL[0], uL[1], ff);
      pushV(B2.x, B2.y, B2.z, B2.u, B2.v, ff); pushV(A2.x, A2.y, A2.z, A2.u, A2.v, ff); pushV(gR[0], gR[1], 0.15, uR[0], uR[1], ff);
    }
    const vertCount = verts.length / 6;
    if(!this._needleVBO){
      this._needleVBO = gl.createBuffer();
      const mkVAO = (prog)=>{
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._needleVBO);
        const lp = gl.getAttribLocation(prog, 'aPos');
        const lu = gl.getAttribLocation(prog, 'aUv');
        const lf = gl.getAttribLocation(prog, 'aFacet');
        if(lp >= 0){ gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 3, gl.FLOAT, false, 24, 0); }
        if(lu >= 0){ gl.enableVertexAttribArray(lu); gl.vertexAttribPointer(lu, 2, gl.FLOAT, false, 24, 12); }
        if(lf >= 0){ gl.enableVertexAttribArray(lf); gl.vertexAttribPointer(lf, 1, gl.FLOAT, false, 24, 20); }
        gl.bindVertexArray(null);
        return vao;
      };
      this._needleVAO = mkVAO(this.origamiProg);
      if(this.origamiShadowProg) this._needleShadowVAO = mkVAO(this.origamiShadowProg);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this._needleVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    const setGeomUniforms = (prog, shadowPass)=>{
      gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), w, h);
      gl.uniform1f(gl.getUniformLocation(prog, 'uAmount'), amount);
      gl.uniform1f(gl.getUniformLocation(prog, 'uTime'), postTime);
      gl.uniform1f(gl.getUniformLocation(prog, 'uHit'), hit);
      gl.uniform1f(gl.getUniformLocation(prog, 'uBeat'), visualBeat);
      gl.uniform1f(gl.getUniformLocation(prog, 'uBeatMode'), beatMode);
      gl.uniform1f(gl.getUniformLocation(prog, 'uShadowPass'), shadowPass);
    };
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
    if(SP && this._origamiShadow){
      gl.useProgram(SP);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._origamiShadow.fbo);
      gl.viewport(0, 0, shadowSize, shadowSize);
      gl.colorMask(false, false, false, false);
      gl.clearDepth(1.0); gl.clear(gl.DEPTH_BUFFER_BIT);
      setGeomUniforms(SP, 1);
      gl.bindVertexArray(this._needleShadowVAO);
      gl.drawArrays(gl.TRIANGLES, 0, vertCount);
      gl.colorMask(true, true, true, true);
    }
    gl.useProgram(P);
    // 現フレームをミップマップ付きソースへコピー
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._origamiTmp.srcTex);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._finalFBO.fbo);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._origamiTmp.fbo);
    gl.viewport(0, 0, w2, h2);
    gl.clearColor(0.0, 0.0, 0.0, 1.0); gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1i(gl.getUniformLocation(P, 'uTex'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._origamiShadow ? this._origamiShadow.tex : null);
    gl.uniform1i(gl.getUniformLocation(P, 'uShadowTex'), 1);
    gl.uniform1f(gl.getUniformLocation(P, 'uShadowEnabled'), (SP && this._origamiShadow) ? 1 : 0);
    gl.uniform2f(gl.getUniformLocation(P, 'uShadowTexel'), 1/shadowSize, 1/shadowSize);
    gl.activeTexture(gl.TEXTURE0);
    setGeomUniforms(P, 0);
    gl.bindVertexArray(this._needleVAO);
    gl.drawArrays(gl.TRIANGLES, 0, vertCount);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._origamiTmp.fbo);   // MSAA resolve (同サイズ)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._origamiTmp.rfbo);
    gl.blitFramebuffer(0,0,w2,h2, 0,0,w2,h2, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._origamiTmp.rfbo);  // 2x → 1x LINEAR 縮小
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._finalFBO.fbo);
    gl.blitFramebuffer(0,0,w2,h2, 0,0,w,h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },

  _runFinalPost(P, tmpKey, setup){
    const gl = this.gl;
    if(!P || !this._finalFBO) return;
    const w = this._finalFBO.w, h = this._finalFBO.h;
    let tmp = this[tmpKey];
    if(!tmp || tmp.w !== w || tmp.h !== h){
      if(tmp){ gl.deleteTexture(tmp.tex); gl.deleteFramebuffer(tmp.fbo); }
      tmp = this[tmpKey] = this._mkRGBA8FBO(w, h);
    }
    gl.useProgram(P);
    gl.bindVertexArray(this.quadVAO);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tmp.fbo);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._finalFBO.tex);
    gl.uniform1i(gl.getUniformLocation(P, 'uTex'), 0);
    gl.uniform2f(gl.getUniformLocation(P, 'uRes'), w, h);
    setup(P, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, tmp.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._finalFBO.fbo);
    gl.blitFramebuffer(0,0,w,h, 0,0,w,h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },

  _applyReliefPost(p, safe){
    const amount = safe ? 0 : Math.max(0, Math.min(1, +(p && p.sdfChrome) || 0));
    if(amount <= 0.001 || !this.reliefProg) return;
    this._runFinalPost(this.reliefProg, '_reliefTmp', (P)=>{
      this.gl.uniform1f(this.gl.getUniformLocation(P, 'uAmount'), amount);
      this.gl.uniform1f(this.gl.getUniformLocation(P, 'uTime'), this.postClock != null ? this.postClock : this.clock);
    });
  },

  _applyGaussianPost(p, safe){
    const amount = safe ? 0 : Math.max(0, Math.min(1, +(p && p.slit2) || 0));
    if(amount <= 0.001 || !this.gaussianProg) return;
    this._runFinalPost(this.gaussianProg, '_gaussianTmp', (P)=>{
      this.gl.uniform1f(this.gl.getUniformLocation(P, 'uAmount'), amount);
    });
  },

  // Twist (後段パス): 蓄積量 _twistAcc は render() 冒頭で従来どおり時間積分している
  _applyTwistPost(p, safe){
    const acc = safe ? 0 : (this._twistAcc || 0);
    if(acc <= 0.001 || !this.twistProg) return;
    this._runFinalPost(this.twistProg, '_twistTmp', (P)=>{
      const gl = this.gl;
      gl.uniform1f(gl.getUniformLocation(P, 'uTime'), this.postClock != null ? this.postClock : this.clock);
      gl.uniform1f(gl.getUniformLocation(P, 'uTwistAcc'),  acc);
      gl.uniform1f(gl.getUniformLocation(P, 'uTwistSeed'), this._twistSeed || 0);
      gl.uniform1f(gl.getUniformLocation(P, 'uTwistSeed2'), this._twistSeed2 != null ? this._twistSeed2 : (this._twistSeed || 0));
      gl.uniform1f(gl.getUniformLocation(P, 'uTwistMix'),  this._twistMix || 0);
    });
  },

  // Dither Blur (後段パス)。Sketch (Water) 有効時は従来どおり無効化。
  _applyDitherPost(p, safe){
    const sk = (typeof SketchFX !== 'undefined') && p && (p.sketch || 0) > 0.001 && !(App.safeMode);
    const amount = (safe || sk) ? 0 : Math.max(0, Math.min(1, +(p && p.dither) || 0));
    if(amount <= 0.001 || !this.ditherProg) return;
    this._runFinalPost(this.ditherProg, '_ditherTmp', (P)=>{
      this.gl.uniform1f(this.gl.getUniformLocation(P, 'uAmount'), amount);
    });
  },

  // マチエール系 (Relief と同族の質感 FX)。いずれも単独パス・uAmount のみ。
  _applyBleedPost(p, safe){
    const amount = safe ? 0 : Math.max(0, Math.min(1, +(p && p.bleed) || 0));
    if(amount <= 0.001 || !this.bleedProg) return;
    this._runFinalPost(this.bleedProg, '_bleedTmp', (P)=>{
      this.gl.uniform1f(this.gl.getUniformLocation(P, 'uAmount'), amount);
    });
  },
  _applyImpastoPost(p, safe){
    const amount = safe ? 0 : Math.max(0, Math.min(1, +(p && p.impasto) || 0));
    if(amount <= 0.001 || !this.impastoProg) return;
    this._runFinalPost(this.impastoProg, '_impastoTmp', (P)=>{
      this.gl.uniform1f(this.gl.getUniformLocation(P, 'uAmount'), amount);
    });
  },
  _applyBarcodePost(p, safe){
    // デッドゾーンは App.deadParam が全 Post FX 共通で掛けている (ここで再マップすると二重掛けになる)
    const amount = safe ? 0 : Math.max(0, Math.min(1, +(p && p.barcode) || 0));
    if(amount <= 0.001 || !this.barcodeProg) return;
    this._runFinalPost(this.barcodeProg, '_barcodeTmp', (P)=>{
      this.gl.uniform1f(this.gl.getUniformLocation(P, 'uAmount'), amount);
      this.gl.uniform1f(this.gl.getUniformLocation(P, 'uTime'), this.postClock != null ? this.postClock : this.clock);
    });
  },
  _applyChromePost(p, safe){
    const amount = safe ? 0 : Math.max(0, Math.min(1, +(p && p.chrome) || 0));
    if(amount <= 0.001 || !this.chromeProg) return;
    this._runFinalPost(this.chromeProg, '_chromeTmp', (P)=>{
      this.gl.uniform1f(this.gl.getUniformLocation(P, 'uAmount'), amount);
      this.gl.uniform1f(this.gl.getUniformLocation(P, 'uTime'), this.postClock != null ? this.postClock : this.clock);
    });
  },

  _applyOutlinePost(p, safe){
    const amount=safe ? 0 : Math.max(0,Math.min(1,+(p&&p.outline)||0));
    if(amount<=0.001||!this.outlineEdgeProg||!this.outlineDrawProg||!this._finalFBO) return;
    const gl=this.gl, w=this._finalFBO.w, h=this._finalFBO.h;
    if(!this._outlineEdge||this._outlineEdge.w!==w||this._outlineEdge.h!==h){
      if(this._outlineEdge){ gl.deleteTexture(this._outlineEdge.tex); gl.deleteFramebuffer(this._outlineEdge.fbo); }
      this._outlineEdge=this._mkFBO(w,h);
    }
    if(!this._outlineTmp||this._outlineTmp.w!==w||this._outlineTmp.h!==h){
      if(this._outlineTmp){ gl.deleteTexture(this._outlineTmp.tex); gl.deleteFramebuffer(this._outlineTmp.fbo); }
      this._outlineTmp=this._mkRGBA8FBO(w,h);
    }
    gl.bindVertexArray(this.quadVAO);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.viewport(0,0,w,h);
    gl.useProgram(this.outlineEdgeProg);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this._outlineEdge.fbo);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,this._finalFBO.tex);
    gl.uniform1i(gl.getUniformLocation(this.outlineEdgeProg,'uTex'),0);
    gl.drawArrays(gl.TRIANGLES,0,3);

    gl.useProgram(this.outlineDrawProg);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this._outlineTmp.fbo);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,this._finalFBO.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,this._outlineEdge.tex);
    gl.uniform1i(gl.getUniformLocation(this.outlineDrawProg,'uTex'),0);
    gl.uniform1i(gl.getUniformLocation(this.outlineDrawProg,'uEdge'),1);
    gl.uniform1f(gl.getUniformLocation(this.outlineDrawProg,'uAmount'),amount);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,this._outlineTmp.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,this._finalFBO.fbo);
    gl.blitFramebuffer(0,0,w,h,0,0,w,h,gl.COLOR_BUFFER_BIT,gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  },

  _applyFlamesPost(p, safe){
    const amount = safe ? 0 : Math.max(0, Math.min(1, +(p && p.river) || 0));
    if(amount <= 0.001 || !this.flamesProg) return;
    this._runFinalPost(this.flamesProg, '_flamesTmp', (P)=>{
      this.gl.uniform1f(this.gl.getUniformLocation(P, 'uAmount'), amount);
      this.gl.uniform1f(this.gl.getUniformLocation(P, 'uTime'), this.postClock != null ? this.postClock : this.clock);
    });
  },

  // ブラックホール周期スケール: 点(0)から生まれ → 提示(最大) → 吸い込まれて点(0)へ、を 8拍ごとに繰り返す。
  //   BPM.beatCount() は setBpm(BPM更新)で origin がリセットされ 0 に戻る → beat も自動でリセット。
  //   Origami / Kaiser / 統合パスで共通(全パス同期)。0 付近は吸い込みの加速(ease-in)、立ち上がりは点から膨らむ(ease-out)。
  _holeScale(){
    const beats = (typeof BPM !== 'undefined' && BPM.beatCount) ? BPM.beatCount() : 0;
    let phase = (beats / 8.0) % 1;                          // 8拍で 0→最大→0 を1周
    phase = (phase % 1 + 1) % 1;
    if(phase < 0.08){ const u = phase / 0.08; return 1.0 - Math.pow(1.0 - u, 5); }   // 0→1 復帰: easeOutQuint (点から素早く膨らみ、最大手前で減速)
    if(phase < 0.78) return 1.0;                                                      // 最大 (大半はこの状態)
    const u = (phase - 0.78) / 0.22;                                                 // 1→0 吸い込み: easeInQuint (最大付近で粘り、点へ一気に加速)
    return Math.max(0.0, 1.0 - Math.pow(u, 5));
  },

  // Needle(origami) / Origami(kaiser) / Kaiser(kaiserOld) を1メッシュの頂点で重ねがけ。
  // 2つ以上が有効なときだけ起動し、各単体パスはスキップ(this._foldStackActive)。
  // 戻り値 true = このパスで処理した(呼び出し側は個別パスを飛ばす)。
  _applyFoldStack(p, safe){
    const gl = this.gl;
    const aN = safe ? 0 : Math.max(0, Math.min(1, +(p && p.origami) || 0));   // Needle
    const aO = safe ? 0 : Math.max(0, Math.min(1, +(p && p.kaiser) || 0));    // Origami
    const aK = safe ? 0 : Math.max(0, Math.min(1, +(p && p.kaiserOld) || 0)); // Kaiser
    const active = (aN > 0.001 ? 1 : 0) + (aO > 0.001 ? 1 : 0) + (aK > 0.001 ? 1 : 0);
    if(active < 2 || !this.foldStackProg || !this._finalFBO){ this._foldStackActive = false; return false; }
    this._foldStackActive = true;
    const w = this._finalFBO.w, h = this._finalFBO.h;
    if(!this._foldStackTmp || this._foldStackTmp.w !== w || this._foldStackTmp.h !== h){
      const old = this._foldStackTmp;
      if(old){ if(old.tex) gl.deleteTexture(old.tex); if(old.color) gl.deleteRenderbuffer(old.color); if(old.depth) gl.deleteRenderbuffer(old.depth); gl.deleteFramebuffer(old.fbo); }
      // MSAA: 細いトゲや折り目のエッジのちらつき(時間的エイリアス)を抑える
      const samples = Math.min(8, gl.getParameter(gl.MAX_SAMPLES) || 0);
      const color = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, color);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
      const depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this._foldStackTmp = { fbo, color, depth, w, h };
    }
    if(!this._emptyVAO) this._emptyVAO = gl.createVertexArray();

    const asp = w / Math.max(1, h);
    const hit = (typeof Audio !== 'undefined') ? Math.max(0, Math.min(1, Audio.hit || 0)) : 0;
    const tn = now();
    const fdt = Math.max(0, Math.min(0.1, tn - (this._foldLastT != null ? this._foldLastT : tn)));
    this._foldClock = (this._foldClock || 0) + fdt;
    this._foldLastT = tn;
    // 運動の合成 (案B): 折り構造(本数・深さ)は全量のまま、時間変化(位相の進み・揺れ振幅・ヒット寄与)を
    // 効果量比で正規化 → 2系合計の運動量が単体1つ分に収まり、重ねがけでも極端にチラつかない。
    const wO = aO / Math.max(aO + aK, 1e-6);
    const wK = aK / Math.max(aO + aK, 1e-6);
    this._foldPhO = (this._foldPhO || 0) + fdt * (0.9 + 0.9 * aO) * 1.35 * wO;
    this._foldPhK = (this._foldPhK || 0) + fdt * (0.55 + 0.45 * aK) * wK;
    // onset エンベロープ: デッドゾーンを抜けた 0 付近で変形量を 0 から立ち上げ、元映像へ連続。
    const onF = (a=>{ const t = Math.max(0, Math.min(1, a / 0.16)); return t*t*(3-2*t); })(Math.max(aN, aO, aK));
    const beatMode = (typeof App !== 'undefined' && App.beatMode === 'beat');
    const beatId = (App.visualBeat ? App.visualBeat() : ((typeof BPM !== 'undefined' && BPM.beatCount) ? BPM.beatCount() : 0));
    const H = (n)=>{ const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
    const rodrigues = (P, O, D, th)=>{
      const rx = P[0]-O[0], ry = P[1]-O[1], rz = P[2]-O[2];
      const ct = Math.cos(th), st = Math.sin(th);
      const dp = D[0]*rx + D[1]*ry + D[2]*rz;
      const cx = D[1]*rz - D[2]*ry, cy = D[2]*rx - D[0]*rz, cz = D[0]*ry - D[1]*rx;
      return [ O[0] + rx*ct + cx*st + D[0]*dp*(1-ct),
               O[1] + ry*ct + cy*st + D[1]*dp*(1-ct),
               O[2] + rz*ct + cz*st + D[2]*dp*(1-ct) ];
    };
    // Kaiser の折り軸は Kaiser 自身の折りだけで連鎖させる (単体 Kaiser と同じ)。
    // Origami の折りまで含めると、Origami の運動で Kaiser フラップが軸ごと振り回され速度が暴れる。
    const appliedK = [];
    const foldPt = (q, z0)=>{
      let P = [q[0], q[1], z0 || 0];
      for(const f of appliedK){
        const s = (q[0]-f.C[0])*f.N[0] + (q[1]-f.C[1])*f.N[1];
        const k = Math.max(0, Math.min(1, -s / f.eps));
        if(k > 0) P = rodrigues(P, f.axO, f.axD, f.th * k);
      }
      return P;
    };
    const foldsU = [];    // uniform 送信用 {C,N,th,axO,axD,eps}
    // 重ねがけ時のちらつき対策: 折り目をグリッドのセル幅程度に和らげる。
    //   単体パスは鋭いまま(eps 極小)だが、統合は 72x42 グリッド上で 28本の鋭い折り線が掃引すると
    //   頂点が一気に折れ側へスナップして「急な変形/ちらつき」に見える。セル幅(≈2/42)の 0.6 倍ほどに
    //   広げると、頂点がフレーム間で連続的に折れ、ポップが消える(見た目の鋭さはほぼ維持)。
    const CREASE_EPS = 0.028;
    // Origami 折り (2D→z=0 平面軸)。_applyKaiserPost と同じ折り線生成。
    if(aO > 0.001 && foldsU.length < 28){
      const K = 14, CYC = 23, SEED = 57.3;
      const T = this._foldPhO;
      const cyc = ((T / CYC) % 1 + 1) % 1;
      const smo = (a, b, x)=>{ const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      const genv = beatMode ? 1.0 : smo(0.0, 0.045, cyc) * (1 - smo(0.975, 0.998, cyc));
      const csd = beatMode ? (Math.floor(beatId) * 13.77 + SEED) : (Math.floor(T / CYC) * 13.77 + SEED);
      const nAct = Math.max(1, Math.min(K, Math.ceil(aO * K + 1e-6)));
      for(let i = 0; i < nAct; i++){
        const wgt = Math.max(0, Math.min(1, aO * K - i));
        const ang = H(i + 3.7 + csd) * Math.PI * 2;
        const N = [Math.cos(ang), Math.sin(ang)];
        const off = (H(i + 9.1 + csd) * 2 - 1) * 0.80 * Math.pow(0.88, i);
        const C = [N[0] * off, N[1] * off];
        const sp = 0.55 + 0.55 * H(i + 17.2 + csd);
        const ph = H(i + 41.6 + csd) * Math.PI * 2;
        const sgn = (H(i + 27.9 + csd) < 0.5) ? -1 : 1;
        const th = onF * genv * sgn * wgt * (Math.PI * (0.52 + 0.46 * wO * Math.sin(T * sp + ph)) + 0.6 * hit * wO);
        if(Math.abs(th) <= 1e-4) continue;
        const f = { C, N, th, axO: [C[0], C[1], 0], axD: [-N[1], N[0], 0], eps: CREASE_EPS };
        foldsU.push(f);
        if(foldsU.length >= 28) break;
      }
    }
    // Kaiser 折り (3D 軸 = 前段の折りを適用した端点から)。_applyKaiserOldPost と同じ。
    if(aK > 0.001 && foldsU.length < 28){
      const K = this._kaiserOldK;
      const T = this._foldPhK;
      const bs = beatMode ? Math.floor(beatId) * 19.73 : 0;
      const nAct = Math.min(K, Math.ceil(aK * K + 1e-6));
      for(let i = 0; i < nAct; i++){
        const wgt = Math.max(0, Math.min(1, aK * K - i));
        const ang = H(i + 3.7 + bs) * Math.PI * 2 + 0.15 * Math.sin(T * 0.21 + i * 1.7);
        const N = [Math.cos(ang), Math.sin(ang)];
        const Dir = [-Math.sin(ang), Math.cos(ang)];
        const off = (H(i + 9.1 + bs) * 2 - 1) * 0.92 * Math.pow(0.87, i);
        const C = [N[0] * off, N[1] * off];
        const sp = 0.31 + 0.27 * H(i + 17.2 + bs);
        const ph = H(i + 41.6 + bs) * Math.PI * 2;
        const sgn = (H(i + 27.9 + bs) < 0.5) ? -1 : 1;
        const th = onF * sgn * wgt * (Math.PI * (0.85 + 0.95 * wK * Math.sin(T * sp + ph)) + 0.5 * hit * wK);
        const L = 0.55;
        const a3 = foldPt([C[0] - Dir[0]*L, C[1] - Dir[1]*L]);
        const b3 = foldPt([C[0] + Dir[0]*L, C[1] + Dir[1]*L]);
        let dx = b3[0]-a3[0], dy = b3[1]-a3[1], dz = b3[2]-a3[2];
        const len = Math.hypot(dx, dy, dz) || 1;
        const f = { C, N, th, axO: a3, axD: [dx/len, dy/len, dz/len], eps: CREASE_EPS };
        foldsU.push(f); appliedK.push(f);
        if(foldsU.length >= 28) break;
      }
    }
    const twist = 2.6 * aK * onF, warp2 = 0.85 * aK * onF, wt2 = this._foldPhK * 0.7 * onF;   // ひねり/うねりも onset で 0 から。運動は Kaiser 比の正規化位相
    // 折り上がりの重心と広がりをサンプル計測 → 中央化 + 平紙の半径を超えたときだけ縮小。
    // 2系の折りでフラップが外へ広がっても単体パスと同等の画面占有に収まる (単体相当の状態では等倍)。
    const foldAll = (q)=>{
      let P = [q[0], q[1], 0];
      for(const f of foldsU){
        const s = (q[0]-f.C[0])*f.N[0] + (q[1]-f.C[1])*f.N[1];
        const k = Math.max(0, Math.min(1, -s / f.eps));
        if(k > 0) P = rodrigues(P, f.axO, f.axD, f.th * k);
      }
      return P;
    };
    let ctrT = [0, 0, 0];
    const fitSamples = [];
    for(let gy = 0; gy < 5; gy++) for(let gx = 0; gx < 9; gx++){
      const P = foldAll([ (gx/8 - 0.5) * 2 * asp, (gy/4 - 0.5) * 2 ]);
      ctrT[0] += P[0]; ctrT[1] += P[1]; ctrT[2] += P[2]; fitSamples.push(P);
    }
    ctrT = [ctrT[0]/fitSamples.length, ctrT[1]/fitSamples.length, ctrT[2]/fitSamples.length];
    // 広がりは「飛び出した1枚のフラップ」に過敏な max ではなく分位点(88%)を採用。
    // → 1枚が外へ振れるたびに全体が縮む/戻る脈動(=重ねがけ時のちらつき)を抑える。
    const dists = fitSamples.map(P => Math.hypot(P[0]-ctrT[0], P[1]-ctrT[1], P[2]-ctrT[2])).sort((a,b)=>a-b);
    const sprawl = dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.88))];
    const R0 = Math.hypot(asp, 1) * 0.92;                           // 平紙の半径よりやや小さめを基準サイズに
    const fitT = Math.max(0.55, Math.min(1, R0 / Math.max(sprawl, 1e-4)));
    // 時間ベースの平滑(フレームレート非依存)+ レート制限で急なサイズ/位置変化を抑える。
    const aFit = 1 - Math.exp(-fdt / 0.34);                         // サイズは特にゆっくり追従
    const aCtr = 1 - Math.exp(-fdt / 0.24);
    const lerp3 = (a, b, t)=>[a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
    this._foldCtr = this._foldCtr ? lerp3(this._foldCtr, ctrT, aCtr) : ctrT;
    if(this._foldFit == null) this._foldFit = fitT;
    else {
      const dMax = 0.9 * fdt;                                       // 1秒あたり最大 0.9 までしか変化させない(急縮小/急拡大を禁止)
      let nf = this._foldFit + (fitT - this._foldFit) * aFit;
      nf = Math.max(this._foldFit - dMax, Math.min(this._foldFit + dMax, nf));
      this._foldFit = nf;
    }
    const ctr = this._foldCtr;
    const hs = this._holeScale();                        // ブラックホール周期スケール
    const fitScale = this._foldFit * hs;

    const T2 = this._foldClock;
    const orb = aK * (0.34 * Math.sin(T2 * 0.19) + 0.16 * Math.sin(T2 * 0.077));
    const elv = aK * (0.22 * Math.sin(T2 * 0.143) + 0.08);
    // カメラ距離: 単体パスの遠い方を基準に、両方の折り系が強い分だけさらに引く。
    // 2系の折りが重なると塊の密度/高さが増えて大きく見えるため、その分の画角余裕。
    // 片方が 0 に近いときは単体パスと同一距離 → 単体⇔統合の切替でサイズが飛ばない。
    const dK = aK > 0.001 ? (1.75 + 0.5 * aK) : 0;   // 単体 Kaiser
    const dO = aO > 0.001 ? (1.7 + 0.45 * aO) : 0;   // 単体 Origami
    // onset シームレス: amount→0 でカメラを f(=1.35, 平らな紙が画面を満たす距離)へ収束させ、
    // 背景の暗転も 0 から立ち上げる → パラメータ 0→0.1 で「元映像 → 折り」が連続的に繋がる。
    const D = 1.35 + (((Math.max(dK, dO) || 1.5) + 1.05 * Math.min(aO, aK)) - 1.35) * onF;
    const eye = [D * Math.cos(elv) * Math.sin(orb), D * Math.sin(elv), D * Math.cos(elv) * Math.cos(orb)];
    const norm3 = (v)=>{ const l = Math.hypot(v[0],v[1],v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; };
    const zc = norm3(eye);
    const xc = norm3([zc[2], 0, -zc[0]]);
    const yc = [ zc[1]*xc[2]-zc[2]*xc[1], zc[2]*xc[0]-zc[0]*xc[2], zc[0]*xc[1]-zc[1]*xc[0] ];
    const dotv = (a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    const view = [ xc[0],yc[0],zc[0],0, xc[1],yc[1],zc[1],0, xc[2],yc[2],zc[2],0, -dotv(xc,eye),-dotv(yc,eye),-dotv(zc,eye),1 ];
    const f = 1.35, zn = 0.03, zf = 30.0;   // 単体 Origami/Kaiser と同じ画角に揃える
    const proj = [ f/asp,0,0,0, 0,f,0,0, 0,0,(zf+zn)/(zn-zf),-1, 0,0,2*zf*zn/(zn-zf),0 ];
    const shade = Math.min(1, Math.max(0, Math.max(aO, aK, aN) / 0.22));
    const bgDark = Math.max(onF, 1 - hs);   // 吸い込み(hs→0)で背景を黒へ → ブラックホールに呑まれる

    const P = this.foldStackProg;
    gl.useProgram(P);
    gl.bindVertexArray(this._emptyVAO);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._foldStackTmp.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1); gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._finalFBO.tex);
    const U = (n)=>gl.getUniformLocation(P, n);
    gl.uniform1i(U('uTex'), 0);
    gl.uniform2f(U('uRes'), w, h);
    gl.uniform2f(U('uGrid'), this._foldStackGrid[0], this._foldStackGrid[1]);
    gl.uniformMatrix4fv(U('uView'), false, view);
    gl.uniformMatrix4fv(U('uProj'), false, proj);
    gl.uniform1f(U('uShade'), shade);
    gl.uniform1f(U('uBgDark'), bgDark);
    gl.uniform1f(U('uTwist'), twist);
    gl.uniform1f(U('uWarp2'), warp2);
    gl.uniform1f(U('uWt2'), wt2);
    gl.uniform1f(U('uNeedleAmt'), aN * onF);          // needle 変位も onset で 0 から立ち上げ
    gl.uniform1f(U('uNt'), this._foldClock * 0.5);   // 統合時は needle の動きを控えめに
    gl.uniform1f(U('uBeat'), beatId);
    gl.uniform1f(U('uBeatMode'), beatMode ? 1 : 0);
    gl.uniform1f(U('uHit'), hit);
    gl.uniform1f(U('uNeedleMix'), aN / Math.max(aN + aO + aK, 1e-6));   // 結晶シェーディングの寄与比
    gl.uniform1f(U('uFitScale'), fitScale);
    gl.uniform3f(U('uCenter'), ctr[0], ctr[1], ctr[2]);
    gl.uniform3f(U('uEye'), eye[0], eye[1], eye[2]);
    gl.uniform1i(U('uFoldN'), foldsU.length);
    for(let i = 0; i < foldsU.length; i++){
      const fd = foldsU[i];
      gl.uniform2f(U('uCreaseP['+i+']'), fd.C[0], fd.C[1]);
      gl.uniform2f(U('uCreaseN['+i+']'), fd.N[0], fd.N[1]);
      gl.uniform1f(U('uTheta['+i+']'), fd.th);
      gl.uniform1f(U('uEps['+i+']'), fd.eps);
      gl.uniform3f(U('uAxisO['+i+']'), fd.axO[0], fd.axO[1], fd.axO[2]);
      gl.uniform3f(U('uAxisD['+i+']'), fd.axD[0], fd.axD[1], fd.axD[2]);
    }
    gl.uniform1f(U('uMode'), 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.uniform1f(U('uMode'), 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, this._foldStackGrid[0] * this._foldStackGrid[1] * 6);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._foldStackTmp.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._finalFBO.fbo);
    gl.blitFramebuffer(0,0,w,h, 0,0,w,h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  },

  _applyKaiserOldPost(p, safe){
    // Kaiser (グリッドメッシュのリボン裂け折り。Kaiser_202607152021.zip 由来)
    const gl = this.gl;
    const amount = safe ? 0 : Math.max(0, Math.min(1, +(p && p.kaiserOld) || 0));
    if(amount <= 0.001 || !this.kaiserOldProg || !this._finalFBO) return;
    const w = this._finalFBO.w, h = this._finalFBO.h;
    if(!this._kaiserOldTmp || this._kaiserOldTmp.w !== w || this._kaiserOldTmp.h !== h){
      if(this._kaiserOldTmp){ gl.deleteTexture(this._kaiserOldTmp.tex); gl.deleteFramebuffer(this._kaiserOldTmp.fbo); if(this._kaiserOldTmp.depth) gl.deleteRenderbuffer(this._kaiserOldTmp.depth); }
      const t = this._mkRGBA8FBO(w, h);
      const depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      t.depth = depth;
      this._kaiserOldTmp = t;
    }
    if(!this._emptyVAO) this._emptyVAO = gl.createVertexArray();

    const K = this._kaiserOldK;
    const asp = w / Math.max(1, h);
    const hit = (typeof Audio !== 'undefined') ? Math.max(0, Math.min(1, Audio.hit || 0)) : 0;
    const tn = now();
    this._kaiserOldClock = (this._kaiserOldClock || 0) + Math.max(0, Math.min(0.1, tn - (this._kaiserOldLastT != null ? this._kaiserOldLastT : tn)));
    this._kaiserOldLastT = tn;
    const T = this._kaiserOldClock * (0.55 + 0.45 * amount);
    // onset エンベロープ: デッドゾーン(実効0)を抜けた 0 付近で変形量を 0 から立ち上げる。
    // 折り角・ひねり・カメラ・背景すべてに掛け、amount→0 で「平らな紙=元映像」に収束させる。
    const onF = (a=>{ const t = Math.max(0, Math.min(1, a / 0.16)); return t*t*(3-2*t); })(amount);
    const H = (n)=>{ const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
    // Beat 対応 = リセット: beat モードでは拍ごとに seed を切替 → 別の折りへハードカット(毎回違うフレーム)
    const beatMode = (typeof App !== 'undefined' && App.beatMode === 'beat');
    const bs = beatMode ? Math.floor((App.visualBeat ? App.visualBeat() : ((typeof BPM !== 'undefined' && BPM.beatCount) ? BPM.beatCount() : 0))) * 19.73 : 0;
    const rodrigues = (P, O, D, th)=>{
      const rx = P[0]-O[0], ry = P[1]-O[1], rz = P[2]-O[2];
      const ct = Math.cos(th), st = Math.sin(th);
      const dp = D[0]*rx + D[1]*ry + D[2]*rz;
      const cx = D[1]*rz - D[2]*ry, cy = D[2]*rx - D[0]*rz, cz = D[0]*ry - D[1]*rx;
      return [ O[0] + rx*ct + cx*st + D[0]*dp*(1-ct),
               O[1] + ry*ct + cy*st + D[1]*dp*(1-ct),
               O[2] + rz*ct + cz*st + D[2]*dp*(1-ct) ];
    };
    const folds = [];
    const foldPt = (q)=>{
      let P = [q[0], q[1], 0];
      for(const f of folds){
        const s = (q[0]-f.C[0])*f.N[0] + (q[1]-f.C[1])*f.N[1];
        let k = Math.max(0, Math.min(1, -s / 0.0022));   // VS と同じシャープさ
        if(k > 0) P = rodrigues(P, f.axO, f.axD, f.th * k);
      }
      return P;
    };
    const nAct = Math.min(K, Math.ceil(amount * K + 1e-6));
    for(let i = 0; i < nAct; i++){
      const wgt = Math.max(0, Math.min(1, amount * K - i));
      const ang = H(i + 3.7 + bs) * Math.PI * 2 + 0.15 * Math.sin(T * 0.21 + i * 1.7);
      const N = [Math.cos(ang), Math.sin(ang)];
      const Dir = [-Math.sin(ang), Math.cos(ang)];
      const off = (H(i + 9.1 + bs) * 2 - 1) * 0.92 * Math.pow(0.87, i);   // 折り線を広く散らす → 前の折りを横切り裂ける
      const C = [N[0] * off, N[1] * off];
      const sp = 0.31 + 0.27 * H(i + 17.2 + bs);
      const ph = H(i + 41.6 + bs) * Math.PI * 2;
      const sgn = (H(i + 27.9 + bs) < 0.5) ? -1 : 1;
      // 折り角を大きく(最大 ~1.6π)振る → フラップが1回転近く回って他層を貫き、めっちゃ交差する
      const th = onF * sgn * wgt * (Math.PI * (0.85 + 0.95 * Math.sin(T * sp + ph)) + 0.5 * hit);
      const L = 0.55;
      const a3 = foldPt([C[0] - Dir[0]*L, C[1] - Dir[1]*L]);
      const b3 = foldPt([C[0] + Dir[0]*L, C[1] + Dir[1]*L]);
      let dx = b3[0]-a3[0], dy = b3[1]-a3[1], dz = b3[2]-a3[2];
      const len = Math.hypot(dx, dy, dz) || 1;
      folds.push({C, N, th, axO: a3, axD: [dx/len, dy/len, dz/len]});
    }

    // 折り上がりの重心 (粗いサンプル点に全折りを適用して平均) → 画面中央に固定するため VS で減算
    let ctr = [0, 0, 0], ccnt = 0;
    for(let gy = 0; gy < 4; gy++) for(let gx = 0; gx < 7; gx++){
      const P = foldPt([ (gx/6 - 0.5) * 2 * asp, (gy/3 - 0.5) * 2 ]);
      ctr[0] += P[0]; ctr[1] += P[1]; ctr[2] += P[2]; ccnt++;
    }
    ctr = [ctr[0]/ccnt, ctr[1]/ccnt, ctr[2]/ccnt];

    const T2 = this._kaiserOldClock;
    const orb = amount * (0.34 * Math.sin(T2 * 0.19) + 0.16 * Math.sin(T2 * 0.077));
    const elv = amount * (0.22 * Math.sin(T2 * 0.143) + 0.08);
    // 広角レンズ: FOV を広く (f 小)。近すぎたので少し引いて程よい距離に。
    // 値が上がるほど少し引く相対感は維持。蛇腹プリーツ/直交ひねりで外に広がるぶん引く。
    // onset シームレス: amount→0 で f(=1.35, 平らな紙が画面を満たす距離)へ収束 → 元映像と連続。
    const D = 1.35 + ((1.75 + 0.5 * amount) - 1.35) * onF;
    const eye = [D * Math.cos(elv) * Math.sin(orb), D * Math.sin(elv), D * Math.cos(elv) * Math.cos(orb)];
    const norm3 = (v)=>{ const l = Math.hypot(v[0],v[1],v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; };
    const zc = norm3(eye);
    const xc = norm3([zc[2], 0, -zc[0]]);
    const yc = [ zc[1]*xc[2]-zc[2]*xc[1], zc[2]*xc[0]-zc[0]*xc[2], zc[0]*xc[1]-zc[1]*xc[0] ];
    const dotv = (a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    const view = [ xc[0],yc[0],zc[0],0, xc[1],yc[1],zc[1],0, xc[2],yc[2],zc[2],0, -dotv(xc,eye),-dotv(yc,eye),-dotv(zc,eye),1 ];
    const f = 1.35, zn = 0.03, zf = 30.0;   // 広角 (fovY ≈ 73°)
    const proj = [ f/asp,0,0,0, 0,f,0,0, 0,0,(zf+zn)/(zn-zf),-1, 0,0,2*zf*zn/(zn-zf),0 ];
    const shade = Math.min(1, Math.max(0, amount / 0.22));
    const hs = this._holeScale();                        // ブラックホール周期スケール
    const bgDark = Math.max(onF, 1 - hs);   // 吸い込み(hs→0)で背景を黒へ

    const P = this.kaiserOldProg;
    gl.useProgram(P);
    gl.bindVertexArray(this._emptyVAO);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._kaiserOldTmp.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1); gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._finalFBO.tex);
    const U = (n)=>gl.getUniformLocation(P, n);
    gl.uniform1i(U('uTex'), 0);
    gl.uniform2f(U('uRes'), w, h);
    gl.uniform2f(U('uGrid'), this._kaiserOldGrid[0], this._kaiserOldGrid[1]);
    gl.uniformMatrix4fv(U('uView'), false, view);
    gl.uniformMatrix4fv(U('uProj'), false, proj);
    gl.uniform1f(U('uShade'), shade);
    gl.uniform1f(U('uBgDark'), bgDark);
    gl.uniform1f(U('uTwist'), 2.6 * amount * onF);        // 巨大なひねり (onset で 0 から立ち上げ)
    gl.uniform1f(U('uWarp2'), 0.85 * amount * onF);       // 大域うねりワープ量 (蛇腹プリーツ含む)
    gl.uniform1f(U('uWt2'), T * 0.7 * onF);               // ひねり位相も onset でゼロ化 (定数回転項が残らない)
    gl.uniform1f(U('uCollapse'), hs);                     // ブラックホール: 周期的に画面中央へ吸い込む
    gl.uniform3f(U('uCenter'), ctr[0], ctr[1], ctr[2]);
    gl.uniform3f(U('uEye'), eye[0], eye[1], eye[2]);
    gl.uniform1i(U('uFoldN'), folds.length);
    for(let i = 0; i < folds.length; i++){
      const fd = folds[i];
      gl.uniform2f(U('uCreaseP['+i+']'), fd.C[0], fd.C[1]);
      gl.uniform2f(U('uCreaseN['+i+']'), fd.N[0], fd.N[1]);
      gl.uniform1f(U('uTheta['+i+']'), fd.th);
      gl.uniform3f(U('uAxisO['+i+']'), fd.axO[0], fd.axO[1], fd.axO[2]);
      gl.uniform3f(U('uAxisD['+i+']'), fd.axD[0], fd.axD[1], fd.axD[2]);
    }
    gl.uniform1f(U('uMode'), 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.uniform1f(U('uMode'), 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, this._kaiserOldGrid[0] * this._kaiserOldGrid[1] * 6);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._kaiserOldTmp.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._finalFBO.fbo);
    gl.blitFramebuffer(0,0,w,h, 0,0,w,h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },

  _applyKaiserPost(p, safe){
    // Kaiser (ベクター折り): 紙をポリゴンとして保持し、折り線で正確に切断してフラップを剛体回転。
    // 側判定は元の紙座標 → 折り線が前の折りを横切るとフラップがリボン状に裂ける造形はそのまま。
    const gl = this.gl;
    const amount = safe ? 0 : Math.max(0, Math.min(1, +(p && p.kaiser) || 0));
    if(amount <= 0.001 || !this.foldProg || !this._finalFBO) return;
    const w = this._finalFBO.w, h = this._finalFBO.h;
    // ── 2x スーパーサンプリング + MSAA ターゲット (+ミップマップ付きソース) ──
    const SS = 2;
    const w2 = w * SS, h2 = h * SS;
    let tmp = this._kaiserTmp;
    if(!tmp || tmp.w !== w2 || tmp.h !== h2){
      if(tmp){
        gl.deleteRenderbuffer(tmp.color); gl.deleteRenderbuffer(tmp.depth); gl.deleteFramebuffer(tmp.fbo);
        gl.deleteTexture(tmp.rtex); gl.deleteFramebuffer(tmp.rfbo); gl.deleteTexture(tmp.srcTex);
      }
      const samples = Math.min(8, gl.getParameter(gl.MAX_SAMPLES) || 0);
      const color = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, color);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w2, h2);
      const depth = gl.createRenderbuffer();                       // 折り重なったフラップの前後関係
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w2, h2);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      const rtex = gl.createTexture();                             // MSAA 解決先 (2x テクスチャ)
      gl.bindTexture(gl.TEXTURE_2D, rtex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w2, h2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const rfbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, rfbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rtex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // 紙テクスチャ用ソース: ミップマップ + 異方性フィルタ (斜め圧縮のドットノイズ防止)
      const srcTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
      if(aniso){
        const maxA = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1;
        gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxA));
      }
      tmp = this._kaiserTmp = {fbo, color, depth, rtex, rfbo, srcTex, w: w2, h: h2};
    }
    if(!this._emptyVAO) this._emptyVAO = gl.createVertexArray();

    // ── 折りパラメータ ──
    const K = 14, spd = 1.35, CYC = 23, SEED = 57.3;
    const asp = w / Math.max(1, h);
    const hit = (typeof Audio !== 'undefined') ? Math.max(0, Math.min(1, Audio.hit || 0)) : 0;
    // 折り専用の実時間クロック (beat モードの App.speed 脈動に影響されない)
    const tn = now();
    this._kaiserClock = (this._kaiserClock || 0) + Math.max(0, Math.min(0.1, tn - (this._kaiserClockLastT != null ? this._kaiserClockLastT : tn)));
    this._kaiserClockLastT = tn;
    const T = this._kaiserClock * (0.9 + 0.9 * amount) * spd;
    // onset エンベロープ: デッドゾーンを抜けた 0 付近で変形量を 0 から立ち上げ、元映像へ連続。
    const onF = (a=>{ const t = Math.max(0, Math.min(1, a / 0.16)); return t*t*(3-2*t); })(amount);
    const H = (n)=>{ const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
    const cyc = ((T / CYC) % 1 + 1) % 1;
    const smo = (a, b, x)=>{ const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    // Beat 対応 = リセット: beat モードでは折れたまま拍ごとに折りパターンを切替(別フレームへハードカット)。
    // drone モードは従来どおり周期で折る→開く。
    const beatMode = (typeof App !== 'undefined' && App.beatMode === 'beat');
    const beatId = (App.visualBeat ? App.visualBeat() : ((typeof BPM !== 'undefined' && BPM.beatCount) ? BPM.beatCount() : 0));
    const genv = beatMode ? 1.0 : smo(0.0, 0.045, cyc) * (1 - smo(0.975, 0.998, cyc));
    const cs = beatMode ? (Math.floor(beatId) * 13.77 + SEED) : (Math.floor(T / CYC) * 13.77 + SEED);
    const nAct = Math.max(1, Math.min(K, Math.ceil(amount * K + 1e-6)));
    const folds = [];
    for(let i = 0; i < nAct; i++){
      const wgt = Math.max(0, Math.min(1, amount * K - i));        // この折りの活性率 (連続に立ち上がる)
      const ang = H(i + 3.7 + cs) * Math.PI * 2;
      const N = [Math.cos(ang), Math.sin(ang)];
      const off = (H(i + 9.1 + cs) * 2 - 1) * 0.80 * Math.pow(0.88, i);
      const C = [N[0] * off, N[1] * off];
      const sp = 0.55 + 0.55 * H(i + 17.2 + cs);
      const ph = H(i + 41.6 + cs) * Math.PI * 2;
      const sgn = (H(i + 27.9 + cs) < 0.5) ? -1 : 1;               // 山折り / 谷折り
      const th = onF * genv * sgn * wgt * (Math.PI * (0.52 + 0.46 * Math.sin(T * sp + ph)) + 0.6 * hit);
      if(Math.abs(th) > 1e-4) folds.push({C, N, th});
    }

    // ── ベクター折り (帯付き): 旧ラスター版の「伸び」を正確に再現する ──
    // 側判定は元の紙座標。折り線に平行な帯レベル (幅 BEND を BANDN 分割) でポリゴンを切断し、
    // 頂点ごとに θ(s) 回転する。帯が keep 側とフラップ側の間で引き伸ばされてリボン状に繋がる
    // (=旧版の伸び)。切断線は常に折り線と平行な直線なので、エッジはベクター品質のまま。
    const BEND = 0.005, BANDN = 2;   // 接続ストリップは極小幅 = 角は丸めずシャープに (繋がりだけ維持)
    const rodr = (P, O, D, th)=>{
      const rx = P[0]-O[0], ry = P[1]-O[1], rz = P[2]-O[2];
      const ct = Math.cos(th), st = Math.sin(th);
      const dp = D[0]*rx + D[1]*ry + D[2]*rz;
      const cxv = D[1]*rz - D[2]*ry, cyv = D[2]*rx - D[0]*rz, czv = D[0]*ry - D[1]*rx;
      return [ O[0] + rx*ct + cxv*st + D[0]*dp*(1-ct),
               O[1] + ry*ct + cyv*st + D[1]*dp*(1-ct),
               O[2] + rz*ct + czv*st + D[2]*dp*(1-ct) ];
    };
    const rodrDir = (V, D, th)=>{
      const ct = Math.cos(th), st = Math.sin(th);
      const dp = D[0]*V[0] + D[1]*V[1] + D[2]*V[2];
      const cxv = D[1]*V[2] - D[2]*V[1], cyv = D[2]*V[0] - D[0]*V[2], czv = D[0]*V[1] - D[1]*V[0];
      return [ V[0]*ct + cxv*st + D[0]*dp*(1-ct),
               V[1]*ct + cyv*st + D[1]*dp*(1-ct),
               V[2]*ct + czv*st + D[2]*dp*(1-ct) ];
    };
    // 頂点ごとに q(紙座標) / p(3D) / n(法線) / lf(累積折り数=厚み) を持つ
    let polys = [{ q: [[-asp,-1],[asp,-1],[asp,1],[-asp,1]],
                   p: [[-asp,-1,0],[asp,-1,0],[asp,1,0],[-asp,1,0]],
                   n: [[0,0,1],[0,0,1],[0,0,1],[0,0,1]],
                   lf: [0,0,0,0] }];
    const EPS = 1e-6;
    for(const fd of folds){
      const axO = [fd.C[0], fd.C[1], 0], axD = [-fd.N[1], fd.N[0], 0];
      const bandN = 1;   // 帯は常に 1 枚の平面ストリップ: 折り線エッジと回転後エッジを直線で結ぶ = 幾何的な伸び
      const xform = (poly)=>{                                      // 頂点ごとに θ(s) 回転 + 法線回転 + 厚み加算
        for(let i = 0; i < poly.q.length; i++){
          const sd = (poly.q[i][0]-fd.C[0])*fd.N[0] + (poly.q[i][1]-fd.C[1])*fd.N[1];
          const k = Math.max(0, Math.min(1, -sd / BEND));          // 線形ランプ = 角ばった面で繋がる (幾何的なトゲ感)
          if(k <= 0) continue;
          const th = fd.th * k;
          poly.p[i] = rodr(poly.p[i], axO, axD, th);
          poly.n[i] = rodrDir(poly.n[i], axD, th);
          poly.lf[i] += k;
        }
        return poly;
      };
      const out = [];
      for(const poly of polys){
        const sv = poly.q.map(q => (q[0]-fd.C[0])*fd.N[0] + (q[1]-fd.C[1])*fd.N[1]);
        let smin = 1e9, smax = -1e9;
        for(const sd of sv){ if(sd < smin) smin = sd; if(sd > smax) smax = sd; }
        if(smin >= -EPS){ out.push(poly); continue; }              // 全部 keep 側: 触らない
        if(smax <= -BEND + EPS){ out.push(xform(poly)); continue; }// 全部フラップ側: 切らずに全角回転
        // 帯を横切るポリゴンだけ、帯レベル (折り線に平行) で局所的に分割
        let pieces = [poly];
        for(let j = 0; j <= bandN; j++){
          const L = -BEND * j / bandN;
          if(L > smax || L < smin) continue;                       // このレベルは範囲外
          const nxt = [];
          for(const pc of pieces){
            const pv = pc.q.map(q => (q[0]-fd.C[0])*fd.N[0] + (q[1]-fd.C[1])*fd.N[1] - L);
            let hasA = false, hasB = false;
            for(const sd of pv){ if(sd > EPS) hasA = true; else if(sd < -EPS) hasB = true; }
            if(!hasA || !hasB){ nxt.push(pc); continue; }
            const Aq = [], Ap = [], An = [], Al = [], Bq = [], Bp = [], Bn = [], Bl = [];
            const nV = pc.q.length;
            for(let i = 0; i < nV; i++){
              const k2 = (i + 1) % nV, si = pv[i], sj = pv[k2];
              if(si >= -EPS){ Aq.push(pc.q[i]); Ap.push(pc.p[i]); An.push(pc.n[i]); Al.push(pc.lf[i]); }
              if(si <= EPS){ Bq.push(pc.q[i]); Bp.push(pc.p[i]); Bn.push(pc.n[i]); Bl.push(pc.lf[i]); }
              if((si > EPS && sj < -EPS) || (si < -EPS && sj > EPS)){
                const t = si / (si - sj);
                const qa = pc.q[i], qb = pc.q[k2], pa = pc.p[i], pb = pc.p[k2], na = pc.n[i], nb = pc.n[k2];
                const qx = [qa[0]+(qb[0]-qa[0])*t, qa[1]+(qb[1]-qa[1])*t];
                const px = [pa[0]+(pb[0]-pa[0])*t, pa[1]+(pb[1]-pa[1])*t, pa[2]+(pb[2]-pa[2])*t];
                let nx2 = [na[0]+(nb[0]-na[0])*t, na[1]+(nb[1]-na[1])*t, na[2]+(nb[2]-na[2])*t];
                const nl = Math.hypot(nx2[0], nx2[1], nx2[2]) || 1;
                nx2 = [nx2[0]/nl, nx2[1]/nl, nx2[2]/nl];
                const lx = pc.lf[i] + (pc.lf[k2] - pc.lf[i]) * t;
                Aq.push(qx); Ap.push(px); An.push(nx2); Al.push(lx);
                Bq.push(qx.slice()); Bp.push(px.slice()); Bn.push(nx2.slice()); Bl.push(lx);
              }
            }
            if(Aq.length >= 3) nxt.push({q:Aq, p:Ap, n:An, lf:Al});
            if(Bq.length >= 3) nxt.push({q:Bq, p:Bp, n:Bn, lf:Bl});
          }
          pieces = nxt;
        }
        for(const pc of pieces) out.push(xform(pc));
      }
      polys = out;
      if(polys.length > 16000) break;
    }

    // ── 重心 / 法線 + 紙の厚み / 三角形化 ──
    let ctr = [0, 0, 0], cnt = 0;
    for(const poly of polys) for(const pt of poly.p){ ctr[0] += pt[0]; ctr[1] += pt[1]; ctr[2] += pt[2]; cnt++; }
    ctr = [ctr[0]/Math.max(1,cnt), ctr[1]/Math.max(1,cnt), ctr[2]/Math.max(1,cnt)];
    let rad = 0.12;                                                // 折り上がりの実サイズ (重心からの最大半径)
    for(const poly of polys) for(const pt of poly.p){
      const d = Math.hypot(pt[0]-ctr[0], pt[1]-ctr[1], pt[2]-ctr[2]);
      if(d > rad) rad = d;
    }
    let triN = 0;
    for(const poly of polys) triN += Math.max(0, poly.p.length - 2);
    const data = new Float32Array(triN * 3 * 8);                   // [pos3, uv2, nrm3]
    let o = 0;
    for(const poly of polys){
      // 位置は頂点法線オフセット (隣接ピースと隙間なく繋がる)。
      // シェーディング法線は三角形ごとのフラット法線 = 折り目が角丸に見えない。
      const put = (i, fn)=>{
        const pt = poly.p[i], q = poly.q[i], nv = poly.n[i];
        const lift = poly.lf[i] * 0.013;                           // 紙の厚み: 層分離 (z-fighting 防止)
        data[o++] = pt[0] + nv[0]*lift; data[o++] = pt[1] + nv[1]*lift; data[o++] = pt[2] + nv[2]*lift;
        data[o++] = (q[0]/asp) * 0.5 + 0.5; data[o++] = q[1] * 0.5 + 0.5;
        data[o++] = fn[0]; data[o++] = fn[1]; data[o++] = fn[2];
      };
      for(let i = 1; i < poly.p.length - 1; i++){
        const a = poly.p[0], b = poly.p[i], c = poly.p[i + 1];
        const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2];
        const vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
        let fx = uy*vz - uz*vy, fy = uz*vx - ux*vz, fz = ux*vy - uy*vx;
        const fl = Math.hypot(fx, fy, fz) || 1;
        const fn = [fx/fl, fy/fl, fz/fl];
        put(0, fn); put(i, fn); put(i + 1, fn);
      }
    }
    const A = this._kaiserAttrs || {pos:0, uv:1, nrm:2};
    if(!this._kaiserVBO){
      this._kaiserVBO = gl.createBuffer();
      this._kaiserVAO = gl.createVertexArray();
      gl.bindVertexArray(this._kaiserVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._kaiserVBO);
      if(A.pos >= 0){ gl.enableVertexAttribArray(A.pos); gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, 32, 0); }
      if(A.uv  >= 0){ gl.enableVertexAttribArray(A.uv);  gl.vertexAttribPointer(A.uv,  2, gl.FLOAT, false, 32, 12); }
      if(A.nrm >= 0){ gl.enableVertexAttribArray(A.nrm); gl.vertexAttribPointer(A.nrm, 3, gl.FLOAT, false, 32, 20); }
      gl.bindVertexArray(null);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this._kaiserVBO);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // ── カメラ: 0=真正面(紙が画面を満たす) → 深折りほど寄り + 控えめな軌道回転 ──
    const T2 = this._kaiserClock * spd;
    const orb = amount * (0.42 * Math.sin(T2 * 0.31) + 0.2 * Math.sin(T2 * 0.13));
    const elv = amount * (0.3 * Math.sin(T2 * 0.23) + 0.08);
    // 広角レンズ: FOV を広く (f 小) + カメラを近くして強いパースに。値が上がるほど少し引く。
    // onset シームレス: amount→0 で f(=1.35, 平らな紙が画面を満たす距離)へ収束 → 元映像と連続。
    const D = 1.35 + ((1.7 + 0.45 * amount) - 1.35) * onF;
    const eye = [D * Math.cos(elv) * Math.sin(orb), D * Math.sin(elv), D * Math.cos(elv) * Math.cos(orb)];
    const norm3 = (v)=>{ const l = Math.hypot(v[0],v[1],v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; };
    const zc = norm3(eye);                                         // 注視点 = 原点
    const xc = norm3([zc[2], 0, -zc[0]]);                          // cross(up=(0,1,0), zc)
    const yc = [ zc[1]*xc[2]-zc[2]*xc[1], zc[2]*xc[0]-zc[0]*xc[2], zc[0]*xc[1]-zc[1]*xc[0] ];
    const dotv = (a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    const view = [ xc[0],yc[0],zc[0],0, xc[1],yc[1],zc[1],0, xc[2],yc[2],zc[2],0, -dotv(xc,eye),-dotv(yc,eye),-dotv(zc,eye),1 ];
    const f = 1.35, zn = 0.05, zf = 14.0;   // 広角 (fovY ≈ 73°)
    const proj = [ f/asp,0,0,0, 0,f,0,0, 0,0,(zf+zn)/(zn-zf),-1, 0,0,2*zf*zn/(zn-zf),0 ];
    const shade = Math.min(1, Math.max(0, amount / 0.22));
    const hs = this._holeScale();                        // ブラックホール周期スケール
    const bgDark = Math.max(onF, 1 - hs);   // 吸い込み(hs→0)で背景を黒へ

    const P = this.foldProg;
    gl.useProgram(P);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tmp.fbo);
    gl.viewport(0, 0, w2, h2);
    gl.clearColor(0, 0, 0, 1); gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // 現フレームをミップマップ付きソースへコピー
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tmp.srcTex);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._finalFBO.fbo);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tmp.fbo);
    const U = (n)=>gl.getUniformLocation(P, n);
    gl.uniform1i(U('uTex'), 0);
    gl.uniformMatrix4fv(U('uView'), false, view);
    gl.uniformMatrix4fv(U('uProj'), false, proj);
    {
      // 紙全体の 3D 回転 (折り重心起点) + 深折り時のスケール補償。onset で 0 から立ち上げ。
      const ry = onF * amount * (T2 * 0.45 + 0.55 * Math.sin(T2 * 0.147));
      const rx = onF * amount * (0.62 * Math.sin(T2 * 0.191) + 0.25 * Math.sin(T2 * 0.073));
      const rz = onF * amount * 0.28 * Math.sin(T2 * 0.113);
      const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx), cz = Math.cos(rz), sz = Math.sin(rz);
      // 自動フィルは弱める → Kaiser と同じくらいの引きにする (寄せすぎない)。
      const fill = Math.max(1, Math.min(1.4, 1.35 / rad));
      const sc = (1 + (fill - 1) * shade) * hs;   // ブラックホール: 周期的に 0 へ吸い込む
      const m = [
        (cz*cy + sz*sx*sy)*sc,  (sz*cx)*sc,  (-cz*sy + sz*sx*cy)*sc,
        (-sz*cy + cz*sx*sy)*sc, (cz*cx)*sc,  (sz*sy + cz*sx*cy)*sc,
        (cx*sy)*sc,             (-sx)*sc,    (cx*cy)*sc
      ];
      gl.uniformMatrix3fv(U('uModel'), false, m);
      gl.uniform3f(U('uCenter'), ctr[0]*shade, ctr[1]*shade, ctr[2]*shade);
    }
    gl.uniform1f(U('uShade'), shade);
    gl.uniform1f(U('uBgDark'), bgDark);
    gl.uniform3f(U('uEye'), eye[0], eye[1], eye[2]);
    gl.uniform1f(U('uMode'), 0.0);                                 // 背景 (沈めた元画像、最遠深度)
    gl.bindVertexArray(this._emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.uniform1f(U('uMode'), 1.0);                                 // 紙ポリゴン
    gl.bindVertexArray(this._kaiserVAO);
    gl.drawArrays(gl.TRIANGLES, 0, triN * 3);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, tmp.fbo);              // MSAA resolve (同サイズ)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, tmp.rfbo);
    gl.blitFramebuffer(0,0,w2,h2, 0,0,w2,h2, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, tmp.rfbo);             // 2x → 1x LINEAR 縮小
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._finalFBO.fbo);
    gl.blitFramebuffer(0,0,w2,h2, 0,0,w,h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },

  _applyFeedbackBlend(p, safe){
    const gl = this.gl;
    if(!this.feedbackProg || !this._finalFBO || !this._fbTrail) return;
    const fbAdd = safe ? 0 : (p && p.fbAdd || 0);
    const fbMul = safe ? 0 : (p && p.fbMultiply || 0);
    if(Math.max(fbAdd, fbMul) <= 0.001) return;
    this._runFinalPost(this.feedbackProg, '_feedbackTmp', (P)=>{
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this._fbTrail.tex);
      gl.uniform1i(gl.getUniformLocation(P, 'uFbTex'), 1);
      gl.uniform1f(gl.getUniformLocation(P, 'uFbAdd'), fbAdd);
      gl.uniform1f(gl.getUniformLocation(P, 'uFbMultiply'), fbMul);
      gl.uniform1f(gl.getUniformLocation(P, 'uFbZoom'), (p && p.fbZoom) || 0);
      gl.uniform1f(gl.getUniformLocation(P, 'uFbRot'), (p && p.fbRot) || 0);
      gl.activeTexture(gl.TEXTURE0);
    });
  },

  _applyFXAA(){
    const gl = this.gl;
    if(!this.fxaaProg || !this._finalFBO) return;
    const w = this._finalFBO.w, h = this._finalFBO.h;
    if(!this._fxaaTmp || this._fxaaTmp.w !== w || this._fxaaTmp.h !== h){
      if(this._fxaaTmp){ gl.deleteTexture(this._fxaaTmp.tex); gl.deleteFramebuffer(this._fxaaTmp.fbo); }
      this._fxaaTmp = this._mkRGBA8FBO(w, h);
    }
    // _finalFBO.tex → fxaaTmp.fbo (FXAA 適用)
    gl.useProgram(this.fxaaProg);
    gl.bindVertexArray(this.quadVAO);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fxaaTmp.fbo);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._finalFBO.tex);
    gl.uniform1i(gl.getUniformLocation(this.fxaaProg, 'uTex'), 0);
    gl.uniform2f(gl.getUniformLocation(this.fxaaProg, 'uTexel'), 1.0/w, 1.0/h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    // fxaaTmp → _finalFBO に blit (これで _finalFBO に FXAA 結果が入る)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._fxaaTmp.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._finalFBO.fbo);
    gl.blitFramebuffer(0,0,w,h, 0,0,w,h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },

  // ── PiP: 非アクティブスロットの縮小サムネを別 2D canvas に表示 ──
  //    captureStream で録画/Projector に映らないよう glcanvas には描かず、
  //    inactive slot FBO を小 FBO へ blit → readPixels → 2D canvas へ転写。
  _mkRGBA8FBO(w,h){
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {tex, fbo, w, h};
  },
  // inkelly と同じアルゴリズムで Slot A の支配的な鮮やか色相を拾い、FX 線色 RGB を決める。
  // 無彩色時は「白支配→黒 / 黒支配→白」(平均輝度で反転)。結果は _fxLineRGB / _fxLineOn。
  _hsv2rgb(h, s, v){
    const f = (n)=>{ const k=(n + h*6) % 6; return v - v*s*Math.max(0, Math.min(Math.min(k, 4-k), 1)); };
    return [f(5), f(3), f(1)];
  },
  _updateFxLineColor(){
    const src = this._finalFBO;   // 表示中の合成キャンバス(前フレーム)から支配色を拾う
    if(!src || !src.fbo){ this._fxLineOn = 0; return; }
    if(this._fxHuePending) return;                       // 前回の非同期読み戻しが飛行中
    const gl = this.gl, S = 16;
    if(!this._fxHueFBO) this._fxHueFBO = this._mkRGBA8FBO(S, S);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._fxHueFBO.fbo);
    gl.blitFramebuffer(0,0, src.w, src.h, 0,0, S, S, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fxHueFBO.fbo);
    this._fxHuePending = true;
    this.asyncReadPixels(S, S, (px)=>{                   // 非同期: 数フレーム遅れの線色更新で十分
      this._fxHuePending = false;
      if(px) this._applyFxLineColor(px, S);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },
  _applyFxLineColor(px, S){
    const BINS = 36, hist = new Float32Array(BINS);
    let rSum = 0, gSum = 0, bSum = 0;
    for(let i=0;i<S*S;i++){
      const r=px[i*4]/255, g=px[i*4+1]/255, b=px[i*4+2]/255;
      rSum += r; gSum += g; bSum += b;
      const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
      if(mx<=0.004 || d<=0.004) continue;
      const sat=d/mx;
      let h; if(mx===r) h=((g-b)/d)%6; else if(mx===g) h=(b-r)/d+2; else h=(r-g)/d+4;
      h/=6; if(h<0) h+=1;
      hist[Math.min(BINS-1, Math.floor(h*BINS))] += sat*sat*mx;
    }
    // 全体を均した平均色。その彩度が低い(=灰色に近い)なら明度で白黒判定。
    const aR=rSum/(S*S), aG=gSum/(S*S), aB=bSum/(S*S);
    const aMx=Math.max(aR,aG,aB), aMn=Math.min(aR,aG,aB);
    const avgSat = aMx>0.004 ? (aMx-aMn)/aMx : 0;
    const avgLuma = 0.299*aR + 0.587*aG + 0.114*aB;
    let bi=0, bv=-1;
    for(let k=0;k<BINS;k++){ if(hist[k]>bv){ bv=hist[k]; bi=k; } }
    if(avgSat < 0.12 || bv <= 0){
      this._fxLineRGB = (avgLuma > 0.5) ? [0,0,0] : [1,1,1];   // 白支配→黒 / 黒支配→白
    } else {
      let cur = this._fxLineHue || 0;
      let target = (bi + 0.5)/BINS;
      let dd = target - cur; dd -= Math.round(dd);
      cur += dd*0.3; cur = (cur%1 + 1)%1;
      if(cur < 0.001) cur = 0.001;
      this._fxLineHue = cur;
      this._fxLineRGB = this._hsv2rgb(cur, 1, 1);
    }
    this._fxLineOn = 1;
  },
  _ensureSlotPrev(key){
    const PW = 256;
    const PH = Math.max(2, Math.round(PW * this.canvas.height / Math.max(1, this.canvas.width)));
    if(!this._sprev) this._sprev = {};
    if(!this._sprev[key]){
      const cvs = document.getElementById('prev' + key);
      this._sprev[key] = { cvs, ctx: cvs ? cvs.getContext('2d') : null, fbo:null, w:0, h:0, img:null };
    }
    const p = this._sprev[key];
    if(!p.ctx) return null;
    if(p.w !== PW || p.h !== PH){
      if(p.fbo){ this.gl.deleteTexture(p.fbo.tex); this.gl.deleteFramebuffer(p.fbo.fbo); }
      p.fbo = this._mkRGBA8FBO(PW, PH);
      p.w = PW; p.h = PH;
      p.cvs.width = PW; p.cvs.height = PH;
      p.img = p.ctx.createImageData(PW, PH);
    }
    return p;
  },
  // Slot A/B の下段プレビュー。呼び出しごとに片側ずつ更新 (readPixels 負荷を旧 PiP と同等に保つ)
  // 透明を表す市松模様 (Photoshop 風のグレー+白)。パターンはキャッシュして使い回す。
  _checkerPattern(ctx){
    if(!GL._checkerPat){
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 16, 16);
      g.fillStyle = '#cbcbcb'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
      GL._checkerSrc = c;
    }
    return ctx.createPattern(GL._checkerSrc, 'repeat');
  },
  _fillChecker(ctx, w, h){
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this._checkerPattern(ctx);
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  },

  // ── 非同期 readPixels (PBO + fence) ──
  //   同期 readPixels は呼んだ時点で GPU パイプライン全体の完了を CPU が待ってしまい、
  //   フレーム時間を支配していた (A/B プレビュー / Auto Palette / FX 線色)。
  //   PBO へ積んで即リターンし、数フレーム後の fence 完了時にコールバックへ渡す。
  //   呼び出し側は READ_FRAMEBUFFER をバインドした状態で呼ぶこと。
  _asyncReads: [],
  asyncReadPixels(w, h, cb){
    const gl = this.gl;
    if(!gl || this._ctxLost || this._asyncReads.length > 8){ cb(null); return; }   // 溢れ保険 (タブ非表示等)
    const pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, w * h * 4, gl.STREAM_READ);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    this._asyncReads.push({ pbo, sync, size: w * h * 4, cb });
  },
  _pollAsyncReads(){
    if(!this._asyncReads.length) return;
    const gl = this.gl;
    if(!gl || this._ctxLost || (gl.isContextLost && gl.isContextLost())){
      for(const r of this._asyncReads){ try{ r.cb(null); }catch(e){} }
      this._asyncReads.length = 0;
      return;
    }
    for(let i = 0; i < this._asyncReads.length; ){
      const r = this._asyncReads[i];
      const st = gl.clientWaitSync(r.sync, 0, 0);
      if(st === gl.TIMEOUT_EXPIRED){ i++; continue; }
      this._asyncReads.splice(i, 1);
      let buf = null;
      if(st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED){
        buf = new Uint8Array(r.size);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, r.pbo);
        try{ gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, buf); }catch(e){ buf = null; }
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      }
      gl.deleteSync(r.sync); gl.deleteBuffer(r.pbo);
      try{ r.cb(buf); }catch(e){}
    }
  },

  drawSlotPreviews(){
    if(this._ctxLost) return;
    const gl = this.gl;
    if(gl.isContextLost && gl.isContextLost()) return;
    if(!this.pipProg) return;
    const key = (this._sprevTurn = !this._sprevTurn) ? 'A' : 'B';
    const s = this.slots[key];
    const src = s && s.fbos[s.fbIdx ^ 1];
    if(!src || src.w < 2) return;
    const p = this._ensureSlotPrev(key);
    if(!p || p._pending) return;   // 前回の非同期読み戻しがまだ飛行中ならスキップ
    // slot tex → 小 RGBA8 FBO へ素通し転写 (Y 反転は FS 側)。
    // A/B プレビューは Post FX を掛けない = スロット単体の生の絵を見せる (中立 post override)。
    gl.bindFramebuffer(gl.FRAMEBUFFER, p.fbo.fbo);
    gl.viewport(0, 0, p.w, p.h);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.pipProg);
    gl.bindVertexArray(this.quadVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    _applyMiniFxUniforms(gl, this.pipProg, p.w, p.h, true, {});
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    // 非同期読み戻し: 数フレーム遅れてプレビューに反映される (同期ストールの主因だった)
    const kind = s.kind;
    p._pending = true;
    this.asyncReadPixels(p.w, p.h, (buf)=>{
      p._pending = false;
      if(!buf || !p.img || buf.length !== p.img.data.length) return;
      p.img.data.set(buf);
      // 透明部分には市松模様を敷く。putImageData は alpha ごと上書きしてしまうので、
      // 一度オフスクリーンに置いてから drawImage で市松の上へ alpha 合成する。
      this._fillChecker(p.ctx, p.w, p.h);
      if(kind !== 'none'){
        if(!p._tmp){
          p._tmp = document.createElement('canvas');
          p._tmp.width = p.w; p._tmp.height = p.h;
          p._tmpCtx = p._tmp.getContext('2d');
        }
        p._tmpCtx.putImageData(p.img, 0, 0);
        p.ctx.drawImage(p._tmp, 0, 0);
      }
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  },

  // Blend Mode 一覧プレビュー (グラデーションバーの下)。A/B スロットプレビューのバッファを
  // CPU で合成するだけなので GPU 負荷ゼロ。数秒ごとに更新。合成式は sampleAB と同一。
  BLEND_MODES: [
    {key:'mix',        label:'Mix'},
    {key:'add',        label:'Add'},
    {key:'multiply',   label:'Mul'},
    {key:'screen',     label:'Scr'},
    {key:'darken',     label:'Dark'},
    {key:'lighten',    label:'Lite'},
    {key:'difference', label:'Diff'},
    {key:'overlay',    label:'Ovl'}
  ],
  // A/B を 1 ピクセル分ブレンド (mi = blend mode index)。式は sampleAB と同一。
  _blendPix(ar, ag, av, aa, br, bg, bv, ba, mi, mix, out){
    if(ba < 0.999){                                  // Slot B が実 alpha 透過 → A の上へ合成
      const la = ba*mix;
      out[0] = ar + (br-ar)*la; out[1] = ag + (bg-ag)*la; out[2] = av + (bv-av)*la;
      out[3] = aa > la ? aa : la;
      return;
    }
    let r, g, b;
    switch(mi){
      case 1: r = ar+br; g = ag+bg; b = av+bv; break;
      case 2: r = ar*br; g = ag*bg; b = av*bv; break;
      case 3: r = 1-(1-ar)*(1-br); g = 1-(1-ag)*(1-bg); b = 1-(1-av)*(1-bv); break;
      case 4: { const dk = (ar*0.299+ag*0.587+av*0.114) <= (br*0.299+bg*0.587+bv*0.114);
                r = dk?ar:br; g = dk?ag:bg; b = dk?av:bv; break; }
      case 5: { const lt = (ar*0.299+ag*0.587+av*0.114) >= (br*0.299+bg*0.587+bv*0.114);
                r = lt?ar:br; g = lt?ag:bg; b = lt?av:bv; break; }
      case 6: r = Math.abs(ar-br); g = Math.abs(ag-bg); b = Math.abs(av-bv); break;
      case 7: { const ov = (p,q)=> (p < 0.5) ? (2*p*q) : (1 - 2*(1-p)*(1-q));
                r = ov(ar,br); g = ov(ag,bg); b = ov(av,bv); break; }
      default: r = ar + (br-ar)*mix; g = ag + (bg-ag)*mix; b = av + (bv-av)*mix;
    }
    if(mi !== 0){ r = ar + (r-ar)*mix; g = ag + (g-ag)*mix; b = av + (b-av)*mix; }   // uMix = ブレンド強度
    out[0] = r; out[1] = g; out[2] = b; out[3] = aa > ba ? aa : ba;
  },
  // Grad Map (composite の _gradMap と同一式) を 1 ピクセルへ適用
  _gradMapPix(c, stops, gm){
    const L = c[0]*0.299 + c[1]*0.587 + c[2]*0.114;
    let tg = gm >= 0 ? L : 1.0 - L;
    tg = tg < 0 ? 0 : (tg > 1 ? 1 : tg);
    let m = stops[0].rgb;
    for(let i = 0; i < stops.length - 1; i++){
      const p0 = stops[i].t, p1 = stops[i+1].t;
      if(tg >= p0){
        const f = Math.min(1, Math.max(0, (tg - p0) / Math.max(p1 - p0, 0.0001)));
        const s0 = stops[i].rgb, s1 = stops[i+1].rgb;
        m = [s0[0]+(s1[0]-s0[0])*f, s0[1]+(s1[1]-s0[1])*f, s0[2]+(s1[2]-s0[2])*f];
      }
    }
    const k = Math.abs(gm);
    c[0] += (m[0]-c[0])*k; c[1] += (m[1]-c[1])*k; c[2] += (m[2]-c[2])*k;
  },
  // Invert (composite の uInv と同じ: HSL の L だけ反転して色相は保つ) の CPU 版
  _invPix(c){
    const r=c[0], g=c[1], b=c[2];
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
    const l=(mx+mn)*0.5;
    let h=0, s=0;
    if(d>1e-6){
      s=d/(1-Math.abs(2*l-1));
      if(mx===r) h=((g-b)/d)%6; else if(mx===g) h=(b-r)/d+2; else h=(r-g)/d+4;
      if(h<0) h+=6;
    }
    const L=1-l;
    const C=(1-Math.abs(2*L-1))*Math.min(1,Math.max(0,s));
    const X=C*(1-Math.abs(h%2-1));
    const m=L-C*0.5;
    let rr,gg,bb;
    if(h<1){rr=C;gg=X;bb=0;} else if(h<2){rr=X;gg=C;bb=0;} else if(h<3){rr=0;gg=C;bb=X;}
    else if(h<4){rr=0;gg=X;bb=C;} else if(h<5){rr=X;gg=0;bb=C;} else {rr=C;gg=0;bb=X;}
    c[0]=rr+m; c[1]=gg+m; c[2]=bb+m;
  },

  // プレビュー更新要求。which: 'blend' = Blend Mode 一覧 (B キー) / 'grad' = Grad サムネ (G キー) / 'all'
  requestMixPreview(which){
    const w = which || 'all';
    this._mixReq = (this._mixReq && this._mixReq !== w) ? 'all' : w;
    this._mixQueue = null;                             // 途中のキューは捨てて作り直す
  },
  // Grad Preset 一覧 (各グラデを適用した状態) と Blend Mode 一覧のサムネを CPU で作る。
  // 素材は A/B スロットプレビューのバッファなので GPU 負荷ゼロ。2 秒ごとに全 18 枚を作り直すが、
  // 一度に全部描くと 1 フレーム落ちるので 1 フレーム 2 枚ずつに分散する (実測 最大 2.2ms/フレーム)。
  _mixPrevAt: 0,
  drawMixPreviews(){
    if(typeof App !== 'undefined' && App.mixPrevVisible === false){ this._mixQueue = null; return; }
    const gbar = document.getElementById('gradQuickBar');
    const bbar = document.getElementById('blendPrevBar');
    if(!gbar && !bbar) return;
    // アクティブ表示 (枠) だけは常に追従させる (描き直しは伴わないので軽い)
    if(this._mixOnMode !== App.blendMode){
      this._mixOnMode = App.blendMode;
      if(bbar) [...bbar.children].forEach((c,i)=>c.classList.toggle('on', GL.BLEND_MODES[i] && GL.BLEND_MODES[i].key === App.blendMode));
    }
    { const invOn = !!(App.post && (App.post.inv || 0) > 0.5);
      if(this._mixOnGrad !== App._activeGradPreset || this._mixOnInv !== invOn){
        this._mixOnGrad = App._activeGradPreset; this._mixOnInv = invOn;
        if(gbar) [...gbar.children].forEach((c,i)=>c.classList.toggle('on', i === App._activeGradPreset && !invOn));
        const gibar = document.getElementById('gradQuickBarInv');
        if(gibar) [...gibar.children].forEach((c,i)=>c.classList.toggle('on', i === App._activeGradPreset && invOn));
      } }
    const q = this._mixQueue;
    if(!q || !q.length){
      const t = now();
      // スロットの中身 (シェーダ) が変わったら 2 秒を待たずに更新。切替直後は絵が来ていないので少しだけ待つ。
      { const s = this.slots, sg = (x)=> x ? ((x.kind || 'shader') + ':' + ((x.src || '').length)) : '-';
        const ssig = sg(s && s.A) + '|' + sg(s && s.B);
        if(this._mixSlotSig !== ssig){
          this._mixSlotSig = ssig;
          // 切替の最中は src が行き来するので、最初の変化だけで予約する (毎回後ろへずらさない)
          if(!this._mixArmed){ this._mixArmed = true; this._mixPrevAt = t - 1.75; }
        } }
      // Grad Map / Hue / Invert が変わったら (フェード中も) すぐ追従
      { const p = App.post || {};
        const csig = [p.gradMix||0, p.hue||0, p.hueAuto||0, (p.inv||0) > 0.5 ? 1 : 0,
                      (p.gradStops||[]).map(o=>o.t.toFixed(2)+':'+o.rgb.map(v=>v.toFixed(2)).join(',')).join('|')].join('/');
        if(this._mixColorSig !== csig){ this._mixColorSig = csig; this._mixReq = this._mixReq || 'all'; } }
      if(!this._mixReq && t - this._mixPrevAt < 2.0) return;   // 2 秒ごと (要求があれば即時)
      const A = this._sprev && this._sprev.A, B = this._sprev && this._sprev.B;
      if(!A || !B || !A.buf || !B.buf || A.w !== B.w || A.h !== B.h) return;
      const which = this._mixReq || 'all';
      this._mixReq = null;
      this._mixPrevAt = t;
      this._mixArmed = false;
      const sw = A.w;
      const W = Math.max(2, Math.round(sw * 0.375));   // 軽量化のため 3/8 に間引き (表示 48〜108px)
      const H = Math.max(2, Math.round(W * 0.42));     // 横長に中央クロップ (バーの高さを抑える)
      if(!this._bpTmp){
        this._bpTmp = document.createElement('canvas');
        this._bpTmpCtx = this._bpTmp.getContext('2d');
      }
      if(this._bpTmp.width !== W || this._bpTmp.height !== H){
        this._bpTmp.width = W; this._bpTmp.height = H;
        this._bpImg = this._bpTmpCtx.createImageData(W, H);
        this._bpBase = new Float32Array(W*H*4);
      }
      this._mixSt = { ab:A.buf, bb:B.buf, sw, W, H,
                      y0: Math.max(0, ((A.h >> 1) - H) >> 1),
                      mix: Math.min(1, Math.max(0, App.crossfade != null ? App.crossfade : 1)),
                      curMode: App.blendModeIdx(), baseDone:false };
      const modes = GL.BLEND_MODES;
      if(bbar && bbar.children.length !== modes.length) UI.buildBlendBar(bbar, modes);
      // 現在の Blend の結果 (= Grad 一覧の素材) を最初に作る
      const jobs = [{kind:'blend', i:this._mixSt.curMode}];
      if(which !== 'grad'){
        for(let i = 0; i < modes.length; i++) if(i !== this._mixSt.curMode) jobs.push({kind:'blend', i});
      }
      if(which !== 'blend' && gbar){
        for(let n = 0; n < gbar.children.length; n++) jobs.push({kind:'grad', i:n});
      }
      { const gibar = document.getElementById('gradQuickBarInv');
        if(which !== 'blend' && gibar){
          for(let n = 0; n < gibar.children.length; n++) jobs.push({kind:'gradinv', i:n});
        } }
      this._mixQueue = jobs;
    }
    for(let k = 0; k < 2 && this._mixQueue.length; k++) this._drawMixCell(this._mixQueue.shift());
  },
  _drawMixCell(job){
    const st = this._mixSt; if(!st) return;
    const bar = document.getElementById(job.kind === 'blend' ? 'blendPrevBar' : (job.kind === 'gradinv' ? 'gradQuickBarInv' : 'gradQuickBar'));
    const cell = bar ? bar.children[job.i] : null;
    const {ab, bb, sw, W, H, y0, mix} = st;
    const img = this._bpImg, d = img.data, base = this._bpBase;
    const put = (di, r, g, b, a)=>{
      d[di]   = r < 0 ? 0 : (r > 1 ? 255 : r*255);
      d[di+1] = g < 0 ? 0 : (g > 1 ? 255 : g*255);
      d[di+2] = b < 0 ? 0 : (b > 1 ? 255 : b*255);
      d[di+3] = a < 0 ? 0 : (a > 1 ? 255 : a*255);
    };
    if(job.kind === 'blend'){
      const modes = GL.BLEND_MODES;
      if(cell) cell.classList.toggle('on', App.blendMode === modes[job.i].key);
      const keep = (job.i === st.curMode);
      if(!cell && !keep) return;
      // 表示は現在有効な Invert / Grad Map / Hue を通す (base には素の合成結果を残す = Grad 一覧の素材)
      const p = App.post || {};
      const gm = p.gradMix || 0;
      const invOn = (p.inv || 0) > 0.5;
      const stops = (p.gradStops && p.gradStops.length >= 2 && Math.abs(gm) > 0.0001) ? p.gradStops : null;
      const hsB = (typeof UI !== 'undefined' && UI._gradEditor) ? UI._gradEditor : null;   // Hue は Grad の後段に常時ライブ
      const px = [0,0,0,1], c = [0,0,0];
      for(let y = 0; y < H; y++){
        let si = ((y + y0)*2)*sw*4, di = y*W*4;
        for(let x = 0; x < W; x++, si += 8, di += 4){
          this._blendPix(ab[si]/255, ab[si+1]/255, ab[si+2]/255, ab[si+3]/255,
                         bb[si]/255, bb[si+1]/255, bb[si+2]/255, bb[si+3]/255, job.i, mix, px);
          if(keep){ base[di]=px[0]; base[di+1]=px[1]; base[di+2]=px[2]; base[di+3]=px[3]; }
          c[0] = px[0]; c[1] = px[1]; c[2] = px[2];
          if(invOn) this._invPix(c);                 // 実機と同順: Invert → Grad Map → Hue
          if(stops) this._gradMapPix(c, stops, gm);
          if(hsB) { const o = hsB._hueShifted(c); c[0]=o[0]; c[1]=o[1]; c[2]=o[2]; }
          put(di, c[0], c[1], c[2], 1);   // 画面(alpha なしキャンバス)と同じく rgb をそのまま見せる
        }
      }
      if(keep) st.baseDone = true;
    } else {
      // 1〜9 = 保存パレットを適用した状態 / 0 = 通常色 (Grad Map なし + Hue Shift を映像へ)
      // kind==='gradinv' は同じ内容に Invert (L 反転) を掛けた下段プレビュー
      if(!cell || !cell.__ctx || !st.baseDone) return;
      const inv = (job.kind === 'gradinv');
      const hs = (typeof UI !== 'undefined' && UI._gradEditor) ? UI._gradEditor : null;
      const c = [0,0,0];
      if(job.i === 9){
        for(let di = 0; di < W*H*4; di += 4){
          c[0] = base[di]; c[1] = base[di+1]; c[2] = base[di+2];
          if(inv) this._invPix(c);              // 実機と同順: Invert → Hue
          const o = hs ? hs._hueShifted(c) : c;
          put(di, o[0], o[1], o[2], 1);
        }
      } else {
        const list = (typeof UI !== 'undefined' && UI._gradStore) ? UI._gradStore.list : [];
        const item = list[job.i];
        if(!item || !item.stops || item.stops.length < 2) return;
        const gmRaw = App.post.gradMix || 0;
        const gm = (Math.abs(gmRaw) > 0.0001) ? gmRaw : 1.0;   // OFF 時はクリック後の 1.0 で見せる
        const stops = App.hueRotatedStops(item.stops);   // 現在の Hue Shift での見え方 (出力はシェーダが Grad 後段で回す = 同一色)
        for(let di = 0; di < W*H*4; di += 4){
          c[0] = base[di]; c[1] = base[di+1]; c[2] = base[di+2];
          if(inv) this._invPix(c);              // 実機と同順: Invert → Grad Map (方向が反転して映る)
          this._gradMapPix(c, stops, gm);
          put(di, c[0], c[1], c[2], 1);
        }
      }
    }
    if(!cell || !cell.__ctx) return;
    const cvs = cell.__cvs, ctx = cell.__ctx;
    if(cvs.width !== W || cvs.height !== H){ cvs.width = W; cvs.height = H; }
    this._bpTmpCtx.putImageData(img, 0, 0);
    ctx.drawImage(this._bpTmp, 0, 0);                  // 合成結果 = 画面と同じ (市松は敷かない)
  },

  beginGpuTimer(){
    const ext = this._gpuExt; if(!ext) return;
    // GPU 状態変化(disjoint)時は計測中クエリを破棄してやり直し
    if(this.gl.getParameter(ext.GPU_DISJOINT_EXT)){ this._gpuInflight.forEach(q=>this.gl.deleteQuery(q)); this._gpuInflight = []; }
    this._gpuQ = this.gl.createQuery();
    this.gl.beginQuery(ext.TIME_ELAPSED_EXT, this._gpuQ);
  },
  endGpuTimer(){
    const ext = this._gpuExt; if(!ext || !this._gpuQ) return;
    this.gl.endQuery(ext.TIME_ELAPSED_EXT);
    this._gpuInflight.push(this._gpuQ); this._gpuQ = null;
    // 結果が出た古いクエリから GPU 時間 (ms) を回収して移動平均
    while(this._gpuInflight.length){
      const q = this._gpuInflight[0];
      if(!this.gl.getQueryParameter(q, this.gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = this.gl.getQueryParameter(q, this.gl.QUERY_RESULT);
      this._gpuMs = this._gpuMs*0.85 + (ns/1e6)*0.15;
      this.gl.deleteQuery(q); this._gpuInflight.shift();
    }
  },
  forceRenderOnce(){
    this._forceRenderOnce = true;
    this.render();
  },
  render(){
    const force = !!this._forceRenderOnce;
    this._forceRenderOnce = false;
    if(this.paused && !force) return;
    if(this._ctxLost) return;
    const real = now();
    const realDt = force ? 0 : (this._lastReal ? Math.max(0, Math.min(0.1, real - this._lastReal)) : 0);
    if(!force) this._lastReal = real;
    const freezeRequested = App._drawFrozen;
    const frozen = freezeRequested && !force;
    // Post FX 用の時計(D フリーズ中も進む → texNoise/grain/twist 等の Post FX は動き続ける)
    this.postClock = (this.postClock != null ? this.postClock : this.clock) + realDt * App.speed;
    if(App.updateAudioTransport) App.updateAudioTransport();   // Audio Transport: timeDir / _audioSpeedMul を音で更新
    this.clockDt = frozen ? 0 : realDt * App.speed * (App._audioSpeedMul || 1) * (App.timeDir || 1);   // シェーダ/mode の時刻(D で停止 / ←→で順逆)
    this.clock += this.clockDt;
    const dt = this.clockDt;
    // BOLTZMANN / Pollock は動画/シェーダを止めず、合成後の現在フレームをワープする。
    const post = App.effectivePost ? App.effectivePost(App.post || {}) : (App.post || {});
    // FX 線色(Slice/Mondrian/Rings/Slit-scan): inkelly と同じくキャンバスの支配色を採用。有効時のみ間引き更新(readbackはコスト有)。
    {
      const fxActive = (Math.abs(post.slice||0) + Math.abs(post.split||0) + Math.abs(post.rings||0) + Math.abs(post.slitScan||0)) > 0.001;
      if(fxActive){ this._fxLineTick = (this._fxLineTick||0) + 1; if(this._fxLineTick % 5 === 1) this._updateFxLineColor(); }
      else this._fxLineOn = 0;
    }
    // Twist は時間蓄積型: スライダー=深さ/速度。力場はシード固定で、同じ流れに沿って深まり続ける。
    // beat モード: 拍ごとに蓄積リセット + シード引き直し(拍内は位相駆動で 0→深)。
    // drone モード: 連続蓄積、0 で徐々に巻き戻る。シードは蓄積 0→正 の瞬間に引き直す。
    {
      const twRate = Math.abs(+post.twist || 0);
      const twEff = twRate > 0.001 ? (Math.pow(2, 4 * twRate) - 1) / 15 : 0;   // 指数カーブ: 低値で弱く高値で一気に
      const twDt = realDt * App.speed;
      if(App.beatMode === 'beat'){
        if(twRate > 0.001){
          const vb = App.visualBeat ? App.visualBeat() : BPM.beatCount() * App.beatScale;
          const bi = Math.floor(vb);
          if(this._twistBeat !== bi){ this._twistBeat = bi; this._twistSeed = Math.random() * 100.0; this._twistSeed2 = this._twistSeed; this._twistMix = 0; }
          this._twistAcc = Math.min(2.6, twEff * 2.6 * (vb - bi));
        }else{ this._twistAcc = 0; this._twistBeat = null; }
      }else if(twRate > 0.001){
        // drone モード: beat モードと同じ速さ (1 スケール拍で上限) で立ち上げ、以後は上限に
        //   張り付いたまま掛かり続ける。リセット/巻き戻しをしないので途切れない
        //   (力場の位相はシェーダ側でゆっくり時間ドリフトするので画は動き続ける)。
        if(!(this._twistAcc > 0)){ this._twistSeed = Math.random() * 100.0; this._twistSeed2 = Math.random() * 100.0; this._twistMix = 0; }
        const cap = 2.6 * twEff;
        const X = Math.max(0.0625, App._normalizeBeatScale ? App._normalizeBeatScale(App.beatScale) : (App.beatScale || 1));
        const dBeat = realDt * ((typeof BPM !== 'undefined' && BPM.bpm) ? BPM.bpm : 120) / 60 * X;   // beat モードと同じ進み
        this._twistAcc = Math.min(cap, (this._twistAcc || 0) + cap * dBeat);
        this._twistBeat = null;
        // 力場のシードを 8 拍かけて次のシードへ渡り、着いたら新しい次シードを引く (振幅は落とさない)
        this._twistMix = (this._twistMix || 0) + dBeat / 8.0;
        if(this._twistMix >= 1){ this._twistSeed = this._twistSeed2; this._twistSeed2 = Math.random() * 100.0; this._twistMix = 0; }
      }else if(this._twistAcc > 0){
        this._twistAcc = Math.max(0, this._twistAcc - twDt * 0.25);
      }
    }
    const bz = !!(Math.abs(post.boltz||0) > 0.001) && typeof Boltzmann !== 'undefined';
    if(bz && !this._bzPrev) this._bzCapture = true;
    const pkVal = Math.max(+post.pollockGloss || 0, +post.pollockMatt || 0, +post.pollockFlat || 0);
    const pk = !!(pkVal > 0.001 && typeof PollockFX !== 'undefined');
    if(pk && !this._pkPrev) this._pkCapture = true;
    // beat モード時は 1 小節(4拍)ごとにワープ場をリセット。
    // beat scale (×A) を反映: ×1/2 なら実拍8拍(2倍の長さ)、×2 なら2拍。
    if(bz && App.beatMode === 'beat'){
      const bar = Math.floor((App.visualBeat ? App.visualBeat() : BPM.beatCount() * App.beatScale) / 4);
      if(this._bzBar !== bar){ this._bzBar = bar; this._bzCapture = true; }
    }
    this._bzPrev = bz;
    this._pkPrev = pk;
    // リセット待ち: 新シェーダの描画が安定するまで数フレーム置いてから流体/ブラシ場を作り直す
    if(this._bzCaptureWait > 0 && bz){
      this._bzCaptureWait--;
      if(this._bzCaptureWait === 0) this._bzCapture = true;
    }
    if(this._pkCaptureWait > 0 && pk){
      this._pkCaptureWait--;
      if(this._pkCaptureWait === 0) this._pkCapture = true;
    }
    if(frozen){
      this._freezeSources(realDt);                 // シェーダ/mode/video の更新を停止(前フレーム保持)
    } else {
      if(this._wasFrozen && !freezeRequested) this._resumeVideos();     // フリーズ解除で動画を再開
      this._renderVisibleSlot('A', dt, realDt);
      this._renderVisibleSlot('B', dt, realDt);
    }
    this._wasFrozen = frozen || freezeRequested;
    // Overlay は _finalFBO に焼き込んでから画面へ present する。
    //   こうしないと Overlay がキャンバス(デフォルトFBO)にだけ乗り、_finalFBO から読む
    //   screenshot / サムネ / 録画に反映されない。
    const ovOn = (typeof Overlay !== 'undefined' && Overlay.initialized);
    if(ovOn) Overlay.update(BPM.beatCount(), realDt * App.speed);   // フリーズ中も動く(Post FX 扱い)
    const drawOv = ovOn && Overlay.P.enabled && Overlay.strokes.length > 0 && this._finalFBO;
    this.composite(!drawOv);                        // Overlay を描くフレームは _finalFBO に留める(まだ画面に出さない)
    if(drawOv){
      const gl = this.gl, fb = this._finalFBO;
      // pickup ソース = _finalFBO のコピー (同一テクスチャの read/write 衝突を避ける)
      if(!this._ovSrcFBO) this._ovSrcFBO = this._mkFBO(fb.w, fb.h); else this._resizeFBO(this._ovSrcFBO, fb.w, fb.h);
      const os = this._ovSrcFBO;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, os.fbo);
      gl.blitFramebuffer(0,0,fb.w,fb.h, 0,0,os.w,os.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      // Overlay を _finalFBO に上描き
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb.fbo);
      gl.viewport(0,0,fb.w,fb.h);
      Overlay.sourceTex = os.tex;
      Overlay.render(fb.w, fb.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // 画面へ present (Overlay 込み)
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0,0,fb.w,fb.h, 0,0,this.canvas.width,this.canvas.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0,0,this.canvas.width,this.canvas.height);
    }
    this._pollAsyncReads();                             // 非同期 readPixels (PBO) の完了分を回収
    // 録画中はプレビュー類の更新を間引いて描画・エンコードに帯域を譲る
    const recActive = (typeof Record !== 'undefined' && Record.active);
    if(this.frame % (recActive ? 15 : 3) === 0) this.drawSlotPreviews();   // 通常: 3フレームごとに A/B 交互 = 各6フレーム周期
    this.drawMixPreviews();                             // Grad / Blend 一覧 (2 秒ごと / 1 フレーム 2 枚ずつ)
    // FX バッジ (MIDI / キー / Param Fade でも値は動くので描画ループから追従。変化時のみ DOM 更新)
    if(this.frame % (recActive ? 30 : 10) === 0 && typeof UI !== 'undefined' && UI.refreshPreviewBadges) UI.refreshPreviewBadges();
    this.lastTime = this.clock;
    this.frame++;
  },
  // D フリーズ: startTime 駆動 mode の経過時刻を固定 + 動画を一時停止(解除時にジャンプさせない)。
  //   スロット描画自体は render 側でスキップ(前フレーム保持)。GL.clock 駆動の shader/mode は clockDt=0 で停止済み。
  _freezeSources(realDt){
    const tS = realDt;
    [ typeof NovelTerminal!=='undefined'?NovelTerminal:0, typeof Caverns!=='undefined'?Caverns:0,
      typeof Shelf!=='undefined'?Shelf:0, typeof Ribbon!=='undefined'?Ribbon:0,
      typeof Inkelly!=='undefined'?Inkelly:0, typeof Layer!=='undefined'?Layer:0,
      typeof Manga!=='undefined'?Manga:0, typeof CyberUI!=='undefined'?CyberUI:0
    ].forEach(E=>{ if(E && typeof E.startTime==='number') E.startTime += tS; });   // 秒単位
    if(typeof Slicer!=='undefined' && typeof Slicer.startTime==='number') Slicer.startTime += realDt*1000;  // ms
    if(typeof Movie!=='undefined' && Movie._slots){
      for(const k of ['A','B']){ const vs=Movie._slots[k]; if(vs && vs.videoEl && !vs.videoEl.paused){ try{ vs.videoEl.pause(); }catch(e){} } }
    }
  },
  _resumeVideos(){
    // [ / ] で非表示にしたスロットも裏で再生し続けるので、_slotVisible では絞り込まない。
    if(typeof Movie!=='undefined' && Movie._slots){
      for(const k of ['A','B']){ const vs=Movie._slots[k]; if(vs && vs.videoEl && vs.videoEl.paused && this.slots[k].kind==='video'){ try{ vs.videoEl.play(); }catch(e){} } }
    }
  },
  _slotVisible(slotKey){
    return !(App.slotVisible && App.slotVisible[slotKey] === false);
  },
  _resetSlotClock(slotKey, clock=0){
    const slot = this.slots && this.slots[slotKey];
    if(!slot) return;
    slot._clock = Math.max(0, Number(clock) || 0);
    slot._beat = (typeof BPM !== 'undefined' && BPM.beatCount) ? BPM.beatCount() : 0;
    slot._scaledBeat = App.visualBeat ? App.visualBeat(slot._beat) : slot._beat * (App.beatScale || 1);
    slot._frame = 0;
  },
  _advanceSlotClock(slotKey, dt, realDt){
    const slot = this.slots[slotKey];
    if(!slot) return;
    if(typeof slot._clock !== 'number') slot._clock = this.clock;
    if(typeof slot._beat !== 'number') slot._beat = (typeof BPM !== 'undefined' && BPM.beatCount) ? BPM.beatCount() : 0;
    if(typeof slot._frame !== 'number') slot._frame = this.frame;
    const dir = App.timeDir || 1;   // ←→で順逆(逆再生時は時計・拍とも巻き戻す)
    const dBeat = Math.max(0, realDt || 0) * ((typeof BPM !== 'undefined' && BPM.bpm) ? BPM.bpm : 120) / 60 * dir;
    slot._clock += (dt || 0);       // dt = clockDt に timeDir 反映済み(負を許可=逆再生で凍結しない)
    slot._beat += dBeat;
    if(typeof slot._scaledBeat !== 'number'){
      slot._scaledBeat = App.visualBeat ? App.visualBeat(slot._beat) : slot._beat * (App.beatScale || 1);
    } else {
      slot._scaledBeat += dBeat * (App.beatScale || 1);
    }
  },
  // 合成出力に一切寄与しないスロットは 3 フレームに 1 回だけ描画する (GPU 負荷をほぼ半減)。
  //   時間進行 (_advanceSlotClock) は毎フレーム行うので、再表示時も時刻は連続する。
  //   下段の A/B プレビュータイルが ~1/3 fps になるだけで本編への影響はない。
  //   誤判定すると見えているスロットがカクつくため、判定 (_slotOccluded) は保守的に。
  _renderVisibleSlot(slotKey, dt, realDt){
    this._advanceSlotClock(slotKey, dt, realDt);
    this._syncSlotVisibility(slotKey);
    if(this._slotOccluded(slotKey) && (this.frame + (slotKey === 'B' ? 1 : 0)) % 3 !== 0) return;
    this._renderAnySlot(slotKey);
    this._applySlotTrans(slotKey);
    const slot = this.slots[slotKey];
    if(slot && typeof slot._frame === 'number') slot._frame++;
  },
  // 合成に寄与しない (完全に隠れている) スロットか。確実に不可視のときだけ true を返す。
  _slotOccluded(slotKey){
    if(typeof App === 'undefined') return false;
    if(App.slotVisibleAmount && App.slotVisibleAmount(slotKey) <= 0.001) return true;   // [ / ] の非表示トグル
    const cf = App.crossfade;
    // B の寄与は全ブレンド/トランジション/透過経路で uMix 倍 → crossfade 0 なら完全不可視
    if(slotKey === 'B') return cf <= 0.001;
    // A は crossfade 1 でも B が透過だと透ける (image contain の余白 / 実 alpha シェーダ / none)。
    // B が常に不透明と分かる video のときだけ、通常 Mix + 演出なしに限って間引く。
    const b = this.slots.B;
    return cf >= 0.999 && App.blendModeIdx && App.blendModeIdx() === 0 && (App.transStyle || 0) === 0
        && !!(b && b.kind === 'video' && b.ready);
  },
  _syncSlotVisibility(slotKey){
    const slot = this.slots[slotKey];
    if(!slot || slot.kind !== 'video' || typeof Movie === 'undefined' || !Movie._slots) return;
    const vs = Movie._slots[slotKey];
    if(!vs || !vs.videoEl) return;
    // [ / ] の非表示は動画の再生/一時停止に影響させない (裏で再生し続ける)。
    const visible = !this.paused && !App._drawFrozen;
    if(visible){
      if(vs.videoEl.paused) try{ vs.videoEl.play().catch(()=>{}); }catch(e){}
    } else if(!vs.videoEl.paused){
      try{ vs.videoEl.pause(); }catch(e){}
    }
  },

  _renderAnySlot(slotKey){
    const slot = this.slots[slotKey];
    const slotBeat = (slot && typeof slot._beat === 'number') ? slot._beat : BPM.beatCount();
    const slotScaledBeat = (slot && typeof slot._scaledBeat === 'number') ? slot._scaledBeat
      : (App.visualBeat ? App.visualBeat(slotBeat) : slotBeat * (App.beatScale || 1));
    const prevClock = this.clock;
    if(slot && typeof slot._clock === 'number') this.clock = slot._clock;
    try {
    if(slot.kind === 'none'){
      // 無選択: A の「なし」= 不透明な黒シェーダ(Post FX が乗る土台。gain 等で反応)。
      //         B の「なし」= 完全透明(下の A が透ける)。
      const gl = this.gl;
      const target = slot.fbos[slot.fbIdx];
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, slotKey === 'A' ? 1 : 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      slot.fbIdx ^= 1;
      return;
    }
    if(slot.kind === 'layer'){
      if(!Layer.initialized) Layer.init(this.gl);
      const target = slot.fbos[slot.fbIdx];
      Layer.render({
        fbo: target.fbo, w: target.w, h: target.h,
        beatMode: App.beatMode,
        beat: slotScaledBeat,
        beatPhase: slotScaledBeat % 1,
        slot: slotKey,
      });
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      slot.fbIdx ^= 1;
      return;
    }
    if(slot.kind === 'manga'){
      if(typeof Manga === 'undefined') return;
      if(!Manga.initialized) Manga.init(this.gl);
      const target = slot.fbos[slot.fbIdx];
      Manga.update(slotScaledBeat, 1/60, target.w, target.h);
      // Slot B は背景を実 alpha で透過 (貼られた画像だけ残して下の Slot A を見せる)
      Manga.render({ fbo: target.fbo, w: target.w, h: target.h, opaque: slotKey !== 'B' });
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      slot.fbIdx ^= 1;
      return;
    }
    if(slot.kind === 'textdeform'){
      if(typeof TextDeform === 'undefined') return;
      if(!TextDeform.initialized) TextDeform.init(this.gl);
      const target = slot.fbos[slot.fbIdx];
      TextDeform.update(slotScaledBeat, 1/60, target.w, target.h);
      TextDeform.render({ fbo: target.fbo, w: target.w, h: target.h });
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      slot.fbIdx ^= 1;
      return;
    }
    if(slot.kind === 'ugomeki'){
      if(typeof Ugomeki === 'undefined') return;
      if(!Ugomeki.initialized) Ugomeki.init(this.gl);
      const target = slot.fbos[slot.fbIdx];
      Ugomeki.update(slotScaledBeat, 1/60, target.w, target.h);
      Ugomeki.render({ fbo: target.fbo, w: target.w, h: target.h });
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      slot.fbIdx ^= 1;
      return;
    }
    if(slot.kind === 'spacetype'){
      if(typeof SpaceType === 'undefined') return;
      if(!SpaceType.initialized) SpaceType.init(this.gl);
      const target = slot.fbos[slot.fbIdx];
      SpaceType.render({ fbo: target.fbo, w: target.w, h: target.h, slot: slotKey, beat: slotScaledBeat, clock: slot._clock });
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      slot.fbIdx ^= 1;
      return;
    }
    if(slot.kind === 'video'){
      if(typeof Movie === 'undefined') return;
      if(!Movie.initialized) Movie.init(this.gl);
      // beat モード時は拍に同期してランダム再生位置にジャンプ
      Movie.update(slotScaledBeat, App.beatMode, slotKey);
      const target = slot.fbos[slot.fbIdx];
      Movie.render({ fbo: target.fbo, w: target.w, h: target.h, slotKey });
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      slot.fbIdx ^= 1;
      return;
    }
    if(slot.kind === 'aratanagara'){
      if(typeof Aratanagara === 'undefined') return;
      if(!Aratanagara.initialized) Aratanagara.init(this.gl);
      const target = slot.fbos[slot.fbIdx];
      Aratanagara.render({ fbo: target.fbo, w: target.w, h: target.h, slot: slotKey, beat: slotScaledBeat, clock: slot._clock });
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      slot.fbIdx ^= 1;
      return;
    }
    if(slot.kind === 'slicer'){
      if(typeof Slicer === 'undefined') return;
      if(!Slicer.initialized) Slicer.init(this.gl);
      Slicer.update(slotScaledBeat, 1/60);
      const target = slot.fbos[slot.fbIdx];
      Slicer.render({ fbo: target.fbo, w: target.w, h: target.h, slot: slotKey });
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      slot.fbIdx ^= 1;
      return;
    }
    if(slot.kind === 'cyberui'){
      if(typeof CyberUI === 'undefined') return;
      if(!CyberUI.initialized) CyberUI.init(this.gl);
      CyberUI.update();
      const target = slot.fbos[slot.fbIdx];
      CyberUI.render({ fbo: target.fbo, w: target.w, h: target.h, beat: slotScaledBeat, clock: slot._clock });
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      slot.fbIdx ^= 1;
      return;
    }
    if(slot.kind === 'novel'){
      if(typeof NovelTerminal === 'undefined') return;
      if(!NovelTerminal.initialized) NovelTerminal.init(this.gl);
      NovelTerminal.update();
      const target = slot.fbos[slot.fbIdx];
      NovelTerminal.render({ fbo: target.fbo, w: target.w, h: target.h, beat: slotScaledBeat, clock: slot._clock });
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      slot.fbIdx ^= 1;
      return;
    }
    if(slot.kind === 'grayscott'){
      if(typeof GrayScott === 'undefined') return;
      if(!GrayScott.initialized) GrayScott.init(this.gl);
      GrayScott.update();
      const target = slot.fbos[slot.fbIdx];
      GrayScott.render({ fbo: target.fbo, w: target.w, h: target.h });
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      slot.fbIdx ^= 1;
      return;
    }
    if(slot.kind === 'inkelly'){
      if(typeof Inkelly === 'undefined') return;
      if(!Inkelly.initialized) Inkelly.init(this.gl);
      Inkelly.update(slotScaledBeat, (1/60) * (App.beatScale || 1));
      const target = slot.fbos[slot.fbIdx];
      Inkelly.render({ fbo: target.fbo, w: target.w, h: target.h, slot: slotKey });
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      slot.fbIdx ^= 1;
      return;
    }
    if(slot.kind === 'pen'){
      if(typeof Pen === 'undefined') return;
      if(!Pen.initialized) Pen.init(this.gl);
      Pen.update(slotScaledBeat);
      const target = slot.fbos[slot.fbIdx];
      Pen.render({ fbo: target.fbo, w: target.w, h: target.h, slot: slotKey });
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      slot.fbIdx ^= 1;
      return;
    }
    if(slot.kind === 'boltzmann'){
      if(typeof Boltzmann === 'undefined') return;
      if(!Boltzmann.initialized) Boltzmann.init(this.gl);
      const target = slot.fbos[slot.fbIdx];
      Boltzmann.render({ fbo: target.fbo, w: target.w, h: target.h });
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      slot.fbIdx ^= 1;
      return;
    }
    if(slot.kind === 'caverns'){
      if(typeof Caverns === 'undefined') return;
      if(!Caverns.initialized) Caverns.init(this.gl);
      Caverns.update();
      const target = slot.fbos[slot.fbIdx];
      Caverns.render({ fbo: target.fbo, w: target.w, h: target.h, slot: slotKey, beat: slotBeat, clock: slot._clock });
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      slot.fbIdx ^= 1;
      return;
    }
    if(slot.kind === 'image'){
      if(typeof ImageMode === 'undefined') return;
      if(!ImageMode.initialized) ImageMode.init(this.gl);
      ImageMode.update(slotScaledBeat, App.beatMode, slotKey);
      const target = slot.fbos[slot.fbIdx];
      ImageMode.render({ fbo: target.fbo, w: target.w, h: target.h, slot: slotKey });
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      slot.fbIdx ^= 1;
      return;
    }
    if(slot.kind === 'photoplane'){
      if(typeof PhotoPlane === 'undefined') return;
      if(!PhotoPlane.initialized) PhotoPlane.init(this.gl);
      PhotoPlane.update();
      const target = slot.fbos[slot.fbIdx];
      PhotoPlane.render({ fbo: target.fbo, w: target.w, h: target.h, slot: slotKey, beat: slotScaledBeat, clock: slot._clock });
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      slot.fbIdx ^= 1;
      return;
    }
    if(slot.kind === 'shredder'){
      if(typeof Shredder === 'undefined') return;
      if(!Shredder.initialized) Shredder.init(this.gl);
      Shredder.update();
      const target = slot.fbos[slot.fbIdx];
      Shredder.render({ fbo: target.fbo, w: target.w, h: target.h, slot: slotKey, beat: slotScaledBeat, clock: slot._clock, opaque: slotKey !== 'B' });
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      slot.fbIdx ^= 1;
      return;
    }
    if(slot.kind === 'shelf'){
      if(typeof Shelf === 'undefined') return;
      if(!Shelf.initialized) Shelf.init(this.gl);
      Shelf.update();
      const target = slot.fbos[slot.fbIdx];
      Shelf.render({ fbo: target.fbo, w: target.w, h: target.h, slot: slotKey, beat: slotScaledBeat, clock: slot._clock });
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      slot.fbIdx ^= 1;
      return;
    }
    if(slot.kind === 'ribbon'){
      if(typeof Ribbon === 'undefined') return;
      if(!Ribbon.initialized) Ribbon.init(this.gl);
      Ribbon.update();
      const target = slot.fbos[slot.fbIdx];
      Ribbon.render({ fbo: target.fbo, w: target.w, h: target.h, slot: slotKey, beat: slotBeat, clock: slot._clock });
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      slot.fbIdx ^= 1;
      return;
    }
    this.renderSlot(slotKey);
    } finally {
      this.clock = prevClock;
    }
  }
};

/* ===================================================================
   Shader  — Shadertoy preprocessor
=================================================================== */
const Shader = {
  HEADER:
`#version 300 es
precision highp float;
precision highp int;
uniform vec3  iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform int   iFrame;
uniform vec4  iMouse;
uniform vec4  iDate;
uniform float iSampleRate;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
uniform vec3  iChannelResolution[4];
// VJ extensions
uniform float iBPM;
uniform float iBeat;
uniform float iBeatPhase;
uniform int   iBeatMode;  // 0=drone (time駆動), 1=beat (拍同期)
uniform float iEnergy;
uniform float iAttack;    // 短いアタックピーク 0..1
uniform float iAttackEnv; // 少し長いアタック包絡 0..1
uniform float iCrossfade;
uniform vec2  iPan;   // ユーザ操作パン (NDC, cursor keys)
uniform float iZoom;  // ユーザ操作ズーム (1.0 = no zoom)
#define texture2D texture
#define textureCube texture
out vec4 _vjFragOut;
`,

  preprocess(src){
    // strip user #version (we own it)
    let body = src.replace(/^[ \t]*#version[^\n]*\n?/m, '');
    // strip any user-declared `out vec4 ...;` (we own _vjFragOut)
    body = body.replace(/^\s*out\s+vec4\s+\w+\s*;\s*$/gm, '');
    // strip user `precision ...;` lines (we set highp ourselves; ES 100 → ES 300 redeclare is fine but cleaner to drop)
    body = body.replace(/^\s*precision\s+(lowp|mediump|highp)\s+(float|int)\s*;\s*$/gm, '');
    // GLSL ES 100 → ES 300: varying/attribute keywords aren't expected in fragment shaders, but be safe
    body = body.replace(/\bvarying\b/g, 'in');

    // parse @param directives
    const params = [];
    const re = /\/\/\s*@param\s+(\w+)\s+(.+)$/gm;
    let m;
    while((m = re.exec(body))){
      const name = m[1].trim();
      const spec = m[2].trim();
      let p;
      if(/^color\s*=/.test(spec)){
        const c = spec.match(/=\s*#([0-9a-fA-F]{6})/);
        const v = c ? [parseInt(c[1].slice(0,2),16)/255, parseInt(c[1].slice(2,4),16)/255, parseInt(c[1].slice(4,6),16)/255] : [1,1,1];
        p = {name, type:'color', value:v, defaultValue:v.slice()};
      } else if(/^bool\s*=/.test(spec)){
        const v = /=\s*true/i.test(spec) ? 1 : 0;
        p = {name, type:'bool', value:v, defaultValue:v};
      } else {
        const mm = spec.match(/(-?\d*\.?\d+)\s*\.\.\s*(-?\d*\.?\d+)\s*(?:=\s*(-?\d*\.?\d+))?/);
        if(!mm) continue;
        const mi = parseFloat(mm[1]), ma = parseFloat(mm[2]);
        const dv = mm[3] !== undefined ? parseFloat(mm[3]) : (mi+ma)/2;
        p = {name, type:'float', min:mi, max:ma, value:dv, defaultValue:dv};
      }
      params.push(p);
    }

    // ---- Format detection ----
    const hasMainImage = /\bvoid\s+mainImage\s*\(/.test(body);
    // GLSL Sandbox: uses `void main()` + any of the well-known Sandbox uniforms / gl_FragColor
    const sbxDecl = {
      time:       /\buniform\s+float\s+time\s*;/.test(body),
      mouse:      /\buniform\s+vec2\s+mouse\s*;/.test(body),
      resolution: /\buniform\s+vec2\s+resolution\s*;/.test(body),
      backbuffer: /\buniform\s+sampler2D\s+backbuffer\s*;/.test(body),
      surfacePosition: /\b(varying|in)\s+vec2\s+surfacePosition\s*;/.test(body),
    };
    const looksSandbox = !hasMainImage && (
      sbxDecl.time || sbxDecl.mouse || sbxDecl.resolution || sbxDecl.backbuffer || sbxDecl.surfacePosition ||
      /gl_FragColor/.test(body)
    );

    // For Sandbox, inject any of the well-known uniforms the user didn't declare.
    let inject = '';
    if(looksSandbox){
      if(!sbxDecl.time)       inject += 'uniform float time;\n';
      if(!sbxDecl.mouse)      inject += 'uniform vec2  mouse;\n';
      if(!sbxDecl.resolution) inject += 'uniform vec2  resolution;\n';
      if(!sbxDecl.backbuffer) inject += 'uniform sampler2D backbuffer;\n';
    }

    const format = hasMainImage ? 'shadertoy' : (looksSandbox ? 'sandbox' : 'raw');

    let code;
    if(hasMainImage){
      code = this.HEADER + inject + body + `
void main(){
  vec4 c;
  mainImage(c, gl_FragCoord.xy);
  _vjFragOut = c;
}
`;
    } else {
      const translated = body.replace(/gl_FragColor/g,'_vjFragOut');
      code = this.HEADER + inject + translated;
    }
    const headerLines = (this.HEADER + inject).split('\n').length - 1;
    return {code, params, headerLines, format, sbxDecl};
  },

  remapErrors(log, headerLines){
    // remap "ERROR: 0:LINE:" to user-visible line
    return log.replace(/(\d+):(\d+):/g, (_,c,l)=>`${c}:${Math.max(1,parseInt(l)-headerLines)}:`);
  },

  errorLines(log){
    const out = [];
    log.replace(/:(\d+):/g,(_,l)=>{ out.push(parseInt(l)); return _; });
    return out;
  }
};

/* ===================================================================
   Audio  — mic / display, FFT + waveform texture, energy
=================================================================== */
const Audio = {
  ctx:null, analyser:null, src:null, mode:'off',
  fft:null, wav:null, texData:null, energy:0, sampleRate:44100,
  smoothEnergy:0, prevEnergy:0, onset:0,
  attack:0, attackEnv:0, attackFlux:0, attackBase:0, _prevFluxBins:null, _fluxReady:false,
  hit:0, hitSeed:0, _fxArmed:true,   // AR エンベロープ(音中ホールド→止んだら減衰) / 位置シード(立ち上がりで更新)
  bandSmooth:0, bandBase:0, react:0, // 音域(Band)を切り出した平滑/ベースライン と アタック整形済みリアクト値(0..1)
  _bpmPrevBins:null,
  _bpmBandBase:new Float32Array(6), _bpmBandDev:new Float32Array(6),
  _bpmBandScore:new Float32Array(6), _bpmBandEnergy:new Float32Array(6), _bpmBandReady:false,
  _bpmBandSums:new Float32Array(6), _bpmBandLevels:new Float32Array(6),
  _bpmBandCounts:new Uint16Array(6), _bpmBandNorm:new Float32Array(6), _bpmBandRaw:new Float32Array(6),
  bpmBandLabel:'',

  _starting:false,

  async start(mode='mic'){
    if(this._starting){ toast('Audio: 起動中…'); return false; }
    this._starting = true;
    // 既存があれば先に停止 (例外は無視)
    await this.stop().catch(()=>{});
    let ctx=null, stream=null, src=null, analyser=null;
    try{
      ctx = new (window.AudioContext||window.webkitAudioContext)();
      if(mode==='display'){
        if(!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia){
          throw new Error('このブラウザは画面音声キャプチャに非対応');
        }
        // アプリ版 (Electron) はピッカーを出さず「画面全体 + システム音声」を自動取得する
        // (desktop/main.js の setDisplayMediaRequestHandler)。案内とエラー文言を分ける。
        const isApp = /Electron/i.test(navigator.userAgent || '');
        if(isApp){
          toast('画面全体のシステム音声を取得します', 3000);
        } else {
          // ブラウザ版 (Chrome 系): ピッカーで「Chrome タブ」を選択 (Window/Screen は音声非対応) +
          // 下部の「タブの音声を共有」にチェック。この案内をピッカー前にトーストで出しておく
          toast('ピッカーで「Chromeタブ」を選び「タブの音声を共有」にチェック', 4500);
        }
        // 少し待ってからピッカーを開く (トーストが見える時間を確保)
        await new Promise(r=>setTimeout(r, 50));
        try{
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: { width: 320, height: 180, frameRate: 1 }, // dummy 軽量 video (audio 取得に必須)
            audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false },
            preferCurrentTab: false,
          });
        }catch(e){
          // getDisplayMedia の典型的な失敗パターンを分解して報告
          const name = e && e.name;
          if(isApp && (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'NotReadableError')){
            throw new Error('システム音声を取得できません: システム設定 → プライバシーとセキュリティ → 画面収録とシステムオーディオ録音 で GARA を許可 → アプリ再起動');
          } else if(name === 'NotAllowedError' || name === 'PermissionDeniedError'){
            throw new Error('権限拒否: ピッカーで「タブ」を選び「タブの音声を共有」にチェック (Window/Screen は音声非対応)');
          } else if(name === 'NotFoundError'){
            throw new Error('共有可能なソースが見つかりません');
          } else if(name === 'NotSupportedError'){
            throw new Error('このブラウザは画面音声キャプチャに非対応');
          } else if(name === 'AbortError'){
            throw new Error('共有がキャンセルされました');
          }
          throw e;
        }
        if(stream.getAudioTracks().length === 0){
          stream.getTracks().forEach(t=>t.stop());
          throw new Error(isApp
            ? 'システム音声を取得できません: システム設定 → プライバシーとセキュリティ → 画面収録とシステムオーディオ録音 で GARA を許可 → アプリ再起動'
            : '音声トラックなし: 「タブの音声を共有」にチェックを入れて再試行');
        }
        // video トラックは使わない。ブラウザ (タブ共有) では止めて負荷を下げるが、
        // アプリ版のシステム音声 (SCK loopback) は映像トラックを止めるとキャプチャ
        // セッションごと終了して音声トラックも即 ended になる → 1fps ダミーのまま保持する
        if(!isApp) stream.getVideoTracks().forEach(t=>t.stop());
      } else {
        try{
          stream = await navigator.mediaDevices.getUserMedia({audio:true});
        }catch(e){
          if(e && e.name === 'NotAllowedError'){
            throw new Error('マイク権限が拒否されました (ブラウザの URL 横の鍵アイコンから許可してください)');
          }
          throw e;
        }
      }
      src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.45;
      src.connect(analyser);
      // バッファをすべて用意してから analyser を最後に公開
      // (update() との競合で getByteFrequencyData(null) を防ぐ)
      const fft = new Uint8Array(analyser.frequencyBinCount);
      const wav = new Uint8Array(analyser.fftSize);
      const texData = new Uint8Array(512*2);
      const prevFluxBins = new Float32Array(analyser.frequencyBinCount);
      this.ctx = ctx;
      this.sampleRate = ctx.sampleRate;
      this._stream = stream;
      this.src = src;
      this.fft = fft;
      this.wav = wav;
      this.texData = texData;
      this._prevFluxBins = prevFluxBins;
      this._bpmPrevBins = new Float32Array(analyser.frequencyBinCount);
      this.resetBpmAdaptation();
      this._fluxReady = false;
      this.mode = mode;
      this.analyser = analyser; // ★ 必ず最後
      if(typeof BPM !== 'undefined' && BPM.auto && BPM.resetAutoDetection) BPM.resetAutoDetection();
      // 共有/マイクが外部終了したら停止してボタン点灯を消す
      stream.getAudioTracks().forEach(t=>{ t.onended = ()=>{ Audio.stop().then(()=>{ if(typeof UI!=='undefined' && UI.refreshAudioButtons) UI.refreshAudioButtons(); }); }; });
      console.log('Audio started:', mode, 'rate=', ctx.sampleRate);
      toast('Audio: '+mode);
      return true;
    }catch(err){
      console.warn('Audio start failed:', err);
      // 後始末
      try{ if(src) src.disconnect(); }catch(e){}
      try{ if(stream) stream.getTracks().forEach(t=>t.stop()); }catch(e){}
      try{ if(ctx) await ctx.close(); }catch(e){}
      this.mode='off';
      toast('Audio error: '+(err.message||err));
      return false;
    }finally{
      this._starting = false;
    }
  },

  async stop(){
    // 最初に analyser を切ってから後始末 (update が触らないように)
    this.analyser = null;
    try{ if(this.src) this.src.disconnect(); }catch(e){}
    this.src = null;
    if(this._stream){
      try{ this._stream.getTracks().forEach(t=>t.stop()); }catch(e){}
      this._stream = null;
    }
    if(this.ctx){
      try{ await this.ctx.close(); }catch(e){}
      this.ctx = null;
    }
    this.mode = 'off';
    this.energy = 0;
    this.smoothEnergy = 0;
    this.onset = 0;
    this.attack = 0;
    this.attackEnv = 0;
    this.attackFlux = 0;
    this.attackBase = 0;
    this._prevFluxBins = null;
    this._fluxReady = false;
    this._bpmPrevBins = null;
    this.resetBpmAdaptation();
    this.hit = 0;
    this.react = 0;
    this.bandSmooth = 0;
    this.bandBase = 0;
  },
  resetDetection(){
    this.attack = 0;
    this.attackEnv = 0;
    this.attackFlux = 0;
    this.attackBase = 0;
    this.onset = 0;
    this.hit = 0;
    this.react = 0;
    this.bandSmooth = 0;
    this.bandBase = 0;
    this._fxArmed = true;
    this._fluxReady = false;
    if(this._prevFluxBins) this._prevFluxBins.fill(0);
    if(this._bpmPrevBins) this._bpmPrevBins.fill(0);
    this.resetBpmAdaptation();
  },
  resetBpmAdaptation(){
    this._bpmBandBase.fill(0); this._bpmBandDev.fill(0);
    this._bpmBandScore.fill(0); this._bpmBandEnergy.fill(0);
    this._bpmBandReady = false; this.bpmBandLabel = '';
  },
  _measureBpmFeatures(gain){
    const edges = [35, 140, 280, 700, 1500, 3200, 6500];
    const sums=this._bpmBandSums, levels=this._bpmBandLevels, counts=this._bpmBandCounts;
    const norm=this._bpmBandNorm, raw=this._bpmBandRaw;
    sums.fill(0); levels.fill(0); counts.fill(0); norm.fill(0); raw.fill(0);
    const kp = this._bpmPrevBins || (this._bpmPrevBins = new Float32Array(this.fft.length));
    const binHz = (this.sampleRate || 44100) / (this.analyser.fftSize || 1024);
    const hi = Math.min(this.fft.length, Math.ceil(edges[edges.length-1] / binHz));
    let fullFlux = 0, fullW = 0;
    for(let i=1;i<hi;i++){
      const hz = i * binHz;
      let b = 0;
      while(b < 5 && hz >= edges[b+1]) b++;
      if(hz < edges[0]) continue;
      const mag = Math.log1p(10 * Math.min(255, this.fft[i]*gain) / 255);
      const prev = kp[i] || 0;
      const d = Math.max(0, mag-prev);
      kp[i] = prev*0.18 + mag*0.82;
      sums[b] += d; levels[b] += mag; counts[b]++;
      const fw = 1 / Math.sqrt(1+i*0.055);
      fullFlux += d*fw; fullW += fw;
    }
    let maxEnergy = 1e-5;
    for(let b=0;b<6;b++){
      raw[b] = sums[b] / Math.max(1, counts[b]);
      const level = levels[b] / Math.max(1, counts[b]);
      if(!this._bpmBandReady){
        this._bpmBandBase[b] = raw[b];
        this._bpmBandDev[b] = Math.max(0.0002, raw[b]*0.12);
        this._bpmBandEnergy[b] = level;
      }else{
        const delta = raw[b]-this._bpmBandBase[b];
        this._bpmBandBase[b] += delta*(delta>0 ? 0.006 : 0.035);
        this._bpmBandDev[b] = this._bpmBandDev[b]*0.978 + Math.abs(delta)*0.022;
        this._bpmBandEnergy[b] = this._bpmBandEnergy[b]*0.985 + level*0.015;
        norm[b] = Math.min(6, Math.max(0,delta)/(this._bpmBandDev[b]*0.88+0.00025));
        const quality = Math.min(3,norm[b]) * Math.sqrt(Math.max(0,this._bpmBandEnergy[b]));
        this._bpmBandScore[b] = this._bpmBandScore[b]*0.992 + quality*0.008;
      }
      maxEnergy = Math.max(maxEnergy,this._bpmBandEnergy[b]);
    }
    this._bpmBandReady = true;

    const full = fullFlux/Math.max(1e-4,fullW);
    const target = (typeof BPM !== 'undefined' && BPM.target) ? BPM.target : 'auto';
    if(target === 'kick'){
      this.bpmBandLabel = '35-280 Hz';
      const selected = raw[0]*0.84+raw[1]*0.16;
      return {low:selected, full:selected*0.86+full*0.14};
    }
    if(target === 'snare'){
      this.bpmBandLabel = '140 Hz-3.2 kHz';
      const selected = raw[1]*0.42+raw[2]*0.25+raw[3]*0.23+raw[4]*0.10;
      return {low:selected, full:selected*0.82+full*0.18};
    }
    if(target === 'drum'){
      this.bpmBandLabel = '35 Hz-6.5 kHz';
      const selected = raw[0]*0.46+raw[1]*0.18+raw[3]*0.13+raw[4]*0.13+raw[5]*0.10;
      return {low:selected, full:selected*0.76+full*0.24};
    }
    if(target === 'full'){
      this.bpmBandLabel = '35 Hz-6.5 kHz';
      return {low:raw[0]*0.62+raw[1]*0.38, full};
    }

    const ranked = Array.from({length:6},(_,b)=>{
      const presence = Math.sqrt(Math.max(0,this._bpmBandEnergy[b])/maxEnergy);
      return {b, weight:(0.06+this._bpmBandScore[b])*presence};
    }).sort((a,b)=>b.weight-a.weight);
    const active = ranked.slice(0,3);
    let autoFlux=0, autoW=0;
    for(const item of active){ autoFlux += norm[item.b]*item.weight; autoW += item.weight; }
    autoFlux /= Math.max(0.0001,autoW);
    const shown = active.slice(0,2).map(item=>`${edges[item.b]}-${edges[item.b+1]}Hz`).join(' + ');
    this.bpmBandLabel = shown || 'learning';
    return {low:autoFlux, full:full*0.32+autoFlux*0.68};
  },
  _audioTargetRanges(target){
    if(typeof App !== 'undefined' && App.audioDetectRanges) return App.audioDetectRanges(target);
    return null;
  },
  _measureTargetBand(target, gain){
    const ranges = this._audioTargetRanges(target);
    if(!ranges || !this.analyser || !this.fft) return null;
    const len = this.fft.length;
    const binHz = (this.sampleRate || 44100) / (this.analyser.fftSize || 1024);
    const weights = this._targetWeights || (this._targetWeights = new Float32Array(len));
    weights.fill(0);
    for(const r of ranges){
      const lo = Math.max(1, Math.floor(r[0] / binHz));
      const hi = Math.min(len, Math.ceil(r[1] / binHz));
      const wt = Math.max(0, r[2] || 1);
      for(let i = lo; i < hi; i++) weights[i] += wt;
    }
    const prevBins = this._prevFluxBins;
    const fluxReady = this._fluxReady;
    let sum = 0, flux = 0, wsum = 0;
    for(let i = 1; i < len; i++){
      const wt = weights[i];
      if(wt <= 0) continue;
      const v = Math.min(255, this.fft[i] * gain) / 255;
      sum += v * wt;
      wsum += wt;
      if(prevBins){
        const pv = prevBins[i] || 0;
        if(fluxReady && v > pv) flux += (v - pv) * wt;
        prevBins[i] = pv*0.20 + v*0.80;
      }
    }
    if(prevBins) this._fluxReady = true;
    const denom = Math.max(1e-4, wsum);
    return { energy: sum / denom, flux: flux / denom };
  },

  update(){
    const an = this.analyser;
    if(!an || !this.fft || !this.wav || !this.texData) return;
    try{
      an.getByteFrequencyData(this.fft);
      an.getByteTimeDomainData(this.wav);
      // 感度: FFT 入力を audioGain 倍してから検知/テクスチャに反映(小音量でも反応させる)。
      //   audioGain は指数ゲイン(中立0系でない)ので deadParam は掛けない。
      const g = (typeof App !== 'undefined' && App.post && App.post.audioGain != null) ? App.post.audioGain : 0.5;
      for(let i=0;i<512;i++){
        this.texData[i] = Math.min(255, this.fft[i]*g);
        this.texData[512+i] = (g === 1.0) ? this.wav[i*2]
                            : Math.max(0, Math.min(255, 128 + (this.wav[i*2]-128)*g));
      }
      const gl = GL.gl;
      if(gl && GL.audioTex){
        gl.bindTexture(gl.TEXTURE_2D, GL.audioTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 2, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.texData);
      }
      // エネルギー (低〜中域, 全体) と オンセット (transient) 検出 — 汎用シェーダ(iEnergy)向けに従来通り
      let sum=0;
      for(let i=2;i<96;i++) sum += Math.min(255, this.fft[i]*g);
      const e = sum/(94*255);
      this.smoothEnergy = this.smoothEnergy*0.85 + e*0.15;
      this.energy = this.smoothEnergy;
      // baseline をゆっくり追従させて、急な立ち上がりだけ拾う
      this.prevEnergy = this.prevEnergy*0.88 + e*0.12;
      const energyOnset = Math.max(0, e - this.prevEnergy - 0.02);

      // --- 音域(Band) + アタック(Attack) で整形した音声リアクト値 (H48 棘 / Audio FX hit 用) ---
      const target = (App.post && App.post.audioTarget != null) ? App.post.audioTarget : 'manual';
      const bandRaw = (App.post && App.post.audioBand   != null) ? App.post.audioBand   : 0.0;  // 0=低音 → 1=高音
      const atkRaw  = (App.post && App.post.audioAttack != null) ? App.post.audioAttack : 0.5;  // 0=持続 / 1=トランジェント
      const band = (App.deadParam ? App.deadParam(bandRaw) : bandRaw);
      const atk  = (App.deadParam ? App.deadParam(atkRaw) : atkRaw);
      let be = 0, specFlux = 0;
      const targetMeasure = target === 'manual' ? null : this._measureTargetBand(target, g);
      if(targetMeasure){
        be = targetMeasure.energy;
        specFlux = targetMeasure.flux;
      }else{
        const width = 48;
        const maxLo = Math.max(1, this.fft.length - width - 1);
        const lo = Math.max(1, Math.floor(Math.pow(Math.max(0, Math.min(1, band)), 1.35) * maxLo));
        const hi = Math.min(this.fft.length, lo + width);
        const nBins = Math.max(1, hi - lo);
        let bsum=0, flux=0;
        const prevBins = this._prevFluxBins;
        const fluxReady = this._fluxReady;
        for(let i=lo;i<hi;i++){
          const v = Math.min(255, this.fft[i]*g) / 255;
          bsum += v;
          if(prevBins){
            const pv = prevBins[i] || 0;
            if(fluxReady && v > pv) flux += (v - pv);
            prevBins[i] = pv*0.20 + v*0.80;
          }
        }
        if(prevBins) this._fluxReady = true;
        be = bsum/nBins;                                    // 選択帯域のエネルギー 0..1
        specFlux = flux/nBins;                              // 選択帯域の増分だけを平均化
      }
      this.bandSmooth = this.bandSmooth*0.80 + be*0.20;
      this.bandBase   = this.bandBase*0.88 + be*0.12;
      const bOnset = Math.max(0, be - this.bandBase - 0.015);   // 帯域内トランジェント
      this.attackBase = this.attackBase*0.94 + specFlux*0.06;
      const fluxAttack = Math.max(0, specFlux - this.attackBase*1.12 - 0.0025);
      const atkGain = 7.5 + atk*8.0;
      const attackRaw = Math.min(1, Math.max(fluxAttack*atkGain, bOnset*5.5));
      this.attackFlux = specFlux;
      this.attack = Math.max(attackRaw, this.attack*0.52);
      if(attackRaw > this.attackEnv){
        this.attackEnv += (attackRaw - this.attackEnv) * (0.42 + atk*0.46);
      }else{
        this.attackEnv *= (0.78 - atk*0.18);
      }
      this.onset = Math.max(energyOnset, this.attack*0.60);
      // attack=0: 持続(平滑エネルギー) / attack=1: トランジェント強調
      this.react = Math.min(1, this.bandSmooth*(1.0-atk) + this.attackEnv*atk);   // H48 棘 / INKELLY 用(従来どおり)
      // hit = AR エンベロープ(全 Audio FX 共通): 音が続く間はホールドして効き、止んだら減衰(リリース)。
      // Attack スライダー = 立ち上がり速度(高=即時 / 低=ゆっくりスウェル)。
      const lvl  = Math.max(0.0, this.bandSmooth - 0.02);         // デッドゾーン(無音=0)
      const gate = Math.min(1.0, Math.max(lvl * 2.2, this.attackEnv * (0.70 + atk*0.55))); // 音/アタックの目標レベル
      const atkRate = 0.08 + 0.9*atk;                            // 立ち上がり速度
      if(gate > this.hit) this.hit += (gate - this.hit) * atkRate;   // attack(立ち上がり)
      else                this.hit = Math.max(gate, this.hit*0.92);  // hold(音中) / release(止んだら減衰)
      const oth = 0.02;
      // 位置シード: トランジェント(bOnset)の立ち上がりごとに更新 → 音を拾うたびに Twist 等の位置がランダム移動。
      // (react のしきい値ではなく bOnset を使う。bOnset は拍間で~0 に戻るため attack 設定に依らず確実に再アームする)
      if(this.attack > oth){
        if(this._fxArmed){ this.hitSeed = Math.random(); this._fxArmed = false; }
      }else if(this.attack < oth*0.4){
        this._fxArmed = true;
      }
      BPM.feedODF(this._measureBpmFeatures(g), now());
    }catch(err){
      // 例外で rAF ループを死なせない
      console.warn('Audio.update error, disabling:', err);
      this.analyser = null;
      this.energy = 0;
      this.attack = 0;
      this.attackEnv = 0;
      this.hit = 0;
      this.react = 0;
      this._fluxReady = false;
    }
  }
};

/* ===================================================================
   BPM  — tap, manual, audio auto-detect
     自動検出: 低域/全帯域の2本の適応正規化ODFを50Hzで記録し、
     正規化自己相関・倍音コム・オンセット間隔投票の合意からテンポを推定。
     候補履歴の中央値で倍テン/半テンの瞬間的な乗り換えを抑え、位相だけを
     直近オンセットの円環平均へゆっくり追従させる。
=================================================================== */
const BPM = {
  bpm:120, origin: now(), taps:[], auto:true, target:'auto',
  ODF_SR:50, ODF_N:600, ODF_MIN:300,         // 最大12秒、6秒から解析開始
  _odfLow:null, _odfFull:null, _odfSlot:-1, _odfCount:0,
  _featBase:{low:0,full:0}, _featDev:{low:0,full:0}, _featReady:{low:false,full:false},
  _onArmed:true, _onsets:[], _lastOnsetT:-1,
  _candHist:[], _lastAnalyze:0, _manualT:0,
  autoState:'idle', autoBpm:0, autoConf:0,
  setBpm(b){ this.bpm = clamp(b, 20, 300); this.origin = now(); this._manualT = now(); this._candHist = []; if(typeof App !== 'undefined' && App.resetBeatScalePhase) App.resetBeatScalePhase(); UI.refreshBPM(); },
  resetPhase(){ this.origin = now(); if(typeof App !== 'undefined' && App.resetBeatScalePhase) App.resetBeatScalePhase(); },
  beatCount(){ return (now() - this.origin) * (this.bpm/60); },
  beatPhase(){ return this.beatCount() % 1; },
  setTarget(target){
    const allowed = ['auto','kick','snare','drum','full'];
    this.target = allowed.includes(target) ? target : 'auto';
    try{ localStorage.setItem('vj.bpmTarget',this.target); }catch(e){}
    if(typeof Audio !== 'undefined' && Audio.resetBpmAdaptation) Audio.resetBpmAdaptation();
    this.resetAutoDetection();
    if(typeof UI !== 'undefined' && UI.refreshBPM) UI.refreshBPM();
  },
  resetAutoDetection(){
    if(this._odfLow) this._odfLow.fill(0);
    if(this._odfFull) this._odfFull.fill(0);
    this._odfSlot = -1; this._odfCount = 0; this._lastAnalyze = 0;
    this._featBase.low = this._featBase.full = 0;
    this._featDev.low = this._featDev.full = 0;
    this._featReady.low = this._featReady.full = false;
    this._onArmed = true; this._onsets = []; this._lastOnsetT = -1;
    this._candHist = []; this.autoState = 'idle'; this.autoBpm = 0; this.autoConf = 0;
  },
  // 手動タップ (T キー / ボタン / MIDI)。隣接間隔の中央値で安定化。
  tap(){
    const t = now();
    this._manualT = t; this._candHist = [];
    this.taps.push(t);
    if(this.taps.length>8) this.taps.shift();
    if(this.taps.length>=2){
      const ints=[];
      for(let i=1;i<this.taps.length;i++) ints.push(this.taps[i]-this.taps[i-1]);
      ints.sort((a,b)=>a-b);
      const med = ints[ints.length>>1];
      let cand = 60/med;
      while(cand < 60 && cand > 0) cand *= 2;
      while(cand > 180) cand *= 0.5;
      if(cand>=40 && cand<=300) this.bpm = this.bpm*0.3 + cand*0.7;
      this.origin = this.taps[this.taps.length-1];
      if(typeof App !== 'undefined' && App.resetBeatScalePhase) App.resetBeatScalePhase();
    }
    UI.refreshBPM();
  },

  _normalizeFeature(v, name){
    v = Math.max(0, Number.isFinite(v) ? v : 0);
    if(!this._featReady[name]){
      this._featReady[name] = true;
      this._featBase[name] = v;
      this._featDev[name] = Math.max(0.0001, v*0.1);
      return 0;
    }
    const base = this._featBase[name];
    const delta = v - base;
    // ピークには遅く、減衰には速く追従するベースライン。音圧上昇を拍と誤認しにくい。
    this._featBase[name] = base + delta*(delta > 0 ? 0.012 : 0.065);
    this._featDev[name] = this._featDev[name]*0.965 + Math.abs(delta)*0.035;
    const excess = Math.max(0, delta - this._featDev[name]*0.28);
    return Math.min(4, excess/(this._featDev[name]*0.90 + 0.00035));
  },

  // Audio.update から毎フレーム呼ぶ。低域と全帯域を独立に正規化して50Hzへ再サンプルする。
  feedODF(features, t){
    if(!this._odfLow) this._odfLow = new Float32Array(this.ODF_N);
    if(!this._odfFull) this._odfFull = new Float32Array(this.ODF_N);
    const rawLow = (features && typeof features === 'object') ? features.low : features;
    const rawFull = (features && typeof features === 'object') ? features.full : features;
    const low = this._normalizeFeature(rawLow, 'low');
    const full = this._normalizeFeature(rawFull, 'full');
    const s = Math.floor(t * this.ODF_SR);
    if(this._odfSlot < 0) this._odfSlot = s - 1;
    if(s - this._odfSlot > this.ODF_N){ this.resetAutoDetection(); this._odfSlot = s - 1; }
    while(this._odfSlot < s){
      this._odfSlot++; this._odfCount++;
      const j = this._odfSlot % this.ODF_N;
      this._odfLow[j] = 0;
      this._odfFull[j] = 0;
    }
    const i = s % this.ODF_N;
    this._odfLow[i] = Math.max(this._odfLow[i], low);
    this._odfFull[i] = Math.max(this._odfFull[i], full);

    // 位相合わせには低域優先の強いピークだけを使う。最短180msでハイハット連打を抑制。
    const onset = low*0.74 + full*0.26;
    if(this._onArmed && onset > 0.78 && (this._lastOnsetT < 0 || t-this._lastOnsetT > 0.18)){
      this._onArmed = false;
      this._lastOnsetT = t;
      this._onsets.push(t);
      if(this._onsets.length > 40) this._onsets.shift();
    }else if(onset < 0.26){
      this._onArmed = true;
    }
    if(this.auto && t-this._lastAnalyze > 1.0){ this._lastAnalyze = t; this._analyze(t); }
  },

  // 現在の拍位相(beatCount)を保ったまま BPM だけ変更する。
  _retune(newBpm, t){
    const bc = (t - this.origin) * (this.bpm/60);
    this.bpm = clamp(newBpm, 20, 300);
    this.origin = t - bc * 60/this.bpm;
  },

  _fillAnalysis(src, dst, M){
    const start = this._odfSlot - M + 1;
    let mean = 0;
    for(let k=0;k<M;k++){
      const v = src[((start+k)%this.ODF_N+this.ODF_N)%this.ODF_N];
      dst[k] = v; mean += v;
    }
    mean /= M;
    let energy = 0;
    for(let k=0;k<M;k++){ dst[k] -= mean; energy += dst[k]*dst[k]; }
    return energy;
  },

  _normalizedAC(buf, out, M, minL, acLen){
    out.fill(0);
    for(let L=minL;L<=acLen;L++){
      let sum=0, e0=0, e1=0;
      for(let k=L;k<M;k++){
        const w = 0.35 + 0.65*k/Math.max(1,M-1);   // 最近のテンポをやや重視
        const a=buf[k], b=buf[k-L];
        sum += w*a*b; e0 += w*a*a; e1 += w*b*b;
      }
      out[L] = sum/Math.sqrt(Math.max(1e-12,e0*e1));
    }
  },

  _ioiScore(bpm, t){
    const per = 60/bpm;
    let score=0, total=0;
    for(let i=1;i<this._onsets.length;i++){
      const ti=this._onsets[i];
      if(t-ti > 10) continue;
      for(let j=Math.max(0,i-8);j<i;j++){
        const dt=ti-this._onsets[j];
        if(dt<0.24 || dt>2.4) continue;
        const mult=Math.round(dt/per);
        if(mult<1 || mult>4) continue;
        const err=Math.abs(dt/per-mult);
        const w=(1/mult)*(0.55+0.45*Math.max(0,1-(t-ti)/10));
        score += w*Math.exp(-0.5*Math.pow(err/0.075,2));
        total += w;
      }
    }
    return total>0 ? score/total : 0;
  },

  _analyze(t){
    const SR=this.ODF_SR, M=Math.min(this.ODF_N,this._odfCount);
    if(!this._odfLow || !this._odfFull || M<this.ODF_MIN){ this.autoState='listen'; return; }
    const lowBuf=this._anLow || (this._anLow=new Float32Array(this.ODF_N));
    const fullBuf=this._anFull || (this._anFull=new Float32Array(this.ODF_N));
    const lowEnergy=this._fillAnalysis(this._odfLow,lowBuf,M);
    const fullEnergy=this._fillAnalysis(this._odfFull,fullBuf,M);
    if(lowEnergy+fullEnergy<1e-7){ this.autoState='listen'; this.autoConf=0; return; }

    const minL=Math.floor(SR*60/200), maxL=Math.ceil(SR*60/60);
    const acLen=Math.min(M-2,maxL*3+2);
    const acLow=this._acLow || (this._acLow=new Float32Array(maxL*3+4));
    const acFull=this._acFull || (this._acFull=new Float32Array(maxL*3+4));
    this._normalizedAC(lowBuf,acLow,M,minL,acLen);
    this._normalizedAC(fullBuf,acFull,M,minL,acLen);
    const at=(a,x)=>{
      if(x<minL || x>acLen) return 0;
      const i=Math.floor(x), f=x-i;
      return a[i]*(1-f)+(a[Math.min(acLen,i+1)]||0)*f;
    };
    const periodic=(lag)=>{
      const mixAt=(x)=>0.64*Math.max(0,at(acLow,x))+0.36*Math.max(0,at(acFull,x));
      return mixAt(lag)+0.48*mixAt(lag*2)+0.22*mixAt(lag*3);
    };

    const candidates=[];
    for(let bpm=60;bpm<=200;bpm+=0.25){
      const lag=SR*60/bpm;
      const acScore=periodic(lag);
      const ioi=this._ioiScore(bpm,t);
      const prior=Math.exp(-0.5*Math.pow(Math.log2(bpm/120)/1.05,2));
      const continuity=this.autoState==='lock' ? Math.exp(-0.5*Math.pow(Math.log2(bpm/this.bpm)/0.32,2)) : 1;
      // ACFを主軸にしつつ、オンセット間隔との合意で整数ラグ由来の半テン候補を補正する。
      // 間隔投票を強くしすぎるとオフビートのハイハットを倍テンと誤認するため24%に留める。
      const score=(0.76*acScore+0.24*ioi)*(0.84+0.16*prior)*(0.92+0.08*continuity);
      candidates.push({bpm,score,acScore,ioi});
    }
    candidates.sort((a,b)=>b.score-a.score);
    let best=candidates[0];
    if(!best || best.score<0.085){ this.autoState='listen'; this.autoConf=0; UI.refreshBPM(); return; }

    // 同程度の半テン/倍テン候補なら、ロック中は現在値へ近い側、未ロック時は極端なテンポを避ける。
    const near=(b)=>candidates.reduce((p,c)=>Math.abs(c.bpm-b)<Math.abs(p.bpm-b)?c:p,candidates[0]);
    const octave=[];
    if(best.bpm/2>=60) octave.push(near(best.bpm/2));
    if(best.bpm*2<=200) octave.push(near(best.bpm*2));
    for(const alt of octave){
      // 50Hzでは130〜140 BPM付近の1拍ラグが半端なサンプル数になり、
      // 2拍ラグ(見かけ65〜70 BPM)のほうが鋭いピークになる。倍テン側にも
      // 十分な周期性がある場合だけ、長いラグの量子化誤差を補正する。
      const fastLagCorrection=best.bpm<70 && alt.bpm>100 && alt.bpm<150 && alt.score>=best.score*0.62;
      if(!fastLagCorrection && alt.score<best.score*0.90) continue;
      if(fastLagCorrection){ best=alt; continue; }
      if(this.autoState==='lock'){
        if(Math.abs(Math.log2(alt.bpm/this.bpm))<Math.abs(Math.log2(best.bpm/this.bpm))) best=alt;
      }else if((best.bpm>172 || best.bpm<72) && Math.abs(Math.log2(alt.bpm/120))<Math.abs(Math.log2(best.bpm/120))){
        best=alt;
      }
    }

    const second=candidates.find(c=>Math.abs(c.bpm-best.bpm)/best.bpm>0.055) || {score:0};
    const separation=Math.max(0,(best.score-second.score)/Math.max(0.001,best.score));
    const periodicConf=Math.max(0,Math.min(1,(best.acScore-0.06)/0.42));
    this.autoConf=Math.max(0,Math.min(1,0.58*periodicConf+0.27*Math.min(1,separation*3.5)+0.15*best.ioi));

    this._candHist.push(best.bpm);
    if(this._candHist.length>6) this._candHist.shift();
    const recent=this._candHist.slice(-4).sort((a,b)=>a-b);
    const cand=recent.length ? (recent.length%2 ? recent[recent.length>>1] : 0.5*(recent[recent.length/2-1]+recent[recent.length/2])) : best.bpm;
    const stable=recent.length>=4 && (recent[recent.length-1]-recent[0])/Math.max(1,cand)<0.018;
    this.autoBpm=cand;
    if(t-this._manualT<8){ this.autoState=stable?'lock':'listen'; UI.refreshBPM(); return; }

    const relDiff=Math.abs(cand-this.bpm)/this.bpm;
    if(relDiff<0.03 && this.autoConf>0.18){
      this._retune(this.bpm*0.82+cand*0.18,t);
      this.autoState='lock';
    }else if(stable && this.autoConf>0.30){
      this._retune(cand,t);
      this.autoState='lock';
    }else{
      this.autoState='listen';
    }
    if(this.autoState==='lock') this._phaseNudge(t);
    UI.refreshBPM();
  },

  // 直近オンセットの平均位相へ拍グリッドをゆっくり寄せる。
  _phaseNudge(t){
    const per=60/this.bpm;
    let sx=0, sy=0, n=0;
    for(const ot of this._onsets){
      if(t-ot>8) continue;
      const a=(((ot-this.origin)/per)%1)*6.2831853;
      sx+=Math.cos(a); sy+=Math.sin(a); n++;
    }
    if(n<4 || Math.sqrt(sx*sx+sy*sy)/n<0.48) return;
    const off=Math.atan2(sy,sx)/6.2831853;
    this.origin+=Math.max(-0.04,Math.min(0.04,off*0.18))*per;
  }
};

/* ===================================================================
   MIDI  — CC mapping
=================================================================== */
const MIDI = {
  access:null, learn:null /* {slot,name} */, map:{}, // key="A:speed" -> {ch,cc}
  postRange:{ gradMix:[-1,1], cosGrad:[-1,1], sat:[-1,1], hue:[-1,1], gain:[-1,1], unsharp:[-1,1], inv:[0,1], twist:[0,1], slice:[0,1], split:[0,1], mosaic:[0,1], mblur:[0,1], bri:[-1,1], con:[-1,1], scn:[-1,1], texNoise:[-1,1], slit2:[0,1], glass:[0,1], outline:[0,1], voxel:[0,1], rain:[0,1], sketch:[0,1], pixsort:[0,1], rings:[0,1], pollockGloss:[0,1], pollockMatt:[0,1], pollockFlat:[0,1], boltz:[0,1], aScan:[0,1], aRgb:[0,1], aStrobe:[0,1], aShock:[0,1], aExplode:[0,1], slitScan:[0,1], paletteAmt:[-1,1], fbAdd:[0,1], fbMultiply:[0,1], fbZoom:[-1,1], fbRot:[-1,1], clarity:[0,1], denoise:[0,1], deband:[0,1], vibrance:[-1,1], dither:[0,1], candy:[0,1], origami:[0,1], kaiser:[0,1], kaiserOld:[0,1], glitchTrail:[0,1], sdfChrome:[0,1], river:[0,1], bleed:[0,1], impasto:[0,1], chrome:[0,1], barcode:[0,1], audioFx:[0,1], audioFxAttack:[0,1], audioFxRelease:[0.05,1.5] },
  _last:{}, // CC値の直前値 (モメンタリ押下の立ち上がり検出用)
  _buttonEventAt:{},
  values:{}, _valSaveT:null, // 直近の CC 値 (リロード時の復元用)
  _rise(cc, v){ const p = this._last[cc] || 0; this._last[cc] = v; return p < 64 && v >= 64; },
  _buttonPress(cc, v){
    // XL3 Custom ModeのToggleは2回目がOff value=3または0で届く。
    // 値では判定せず、複数ポート由来の同時イベントだけをまとめて1押下にする。
    const isCc = typeof cc === 'string' && cc.indexOf('cc:') === 0;
    const num = isCc ? parseInt(cc.slice(3), 10) : -1;
    const isXL3 = isCc && num >= 45 && num <= 52
      && this.outputs.some(o=>this._isLCXL3Port(o));
    if(isXL3){
      const t = performance.now();
      const duplicate = t - (this._buttonEventAt[cc] || -Infinity) < 80;
      this._buttonEventAt[cc] = t;
      this._last[cc] = v;
      return !duplicate;
    }
    return this._rise(cc, v);
  },
  // MIDI 操作のデッドゾーン: 絶対値 0.15 未満は 0 扱い (ノブ中央/端の遊びで FX がうっすら残るのを防ぐ)
  _dead(v){ return (typeof v === 'number' && isFinite(v) && Math.abs(v) < 0.15) ? 0 : v; },
  // ── 相対(エンドレス)エンコーダ対応 ──
  //   絶対 CC ではなく増分を送るノブ用。
  //   lcxl3 はCustom Modeの絶対CCを前回差分へ変換し、端の0/127周回も補正する。
  //   absdelta は絶対 CC の前回差分で増減を見る。
  //   relStep = ノブ 1 周ぶんのクリック数。1 クリックの内部変化量は 127 / relStep。
  //   連続値パラメータ(post/crossfade/dom スライダー/shader float)のみで使用。ボタン/トグルは対象外。
  relative:true, relMode:'absdelta', relStep:48, _relVal:{}, _relRaw:{},
  _relAbsoluteDelta(key, v){
    const prev = this._relRaw[key];
    this._relRaw[key] = v;
    if(prev == null) return 0;
    let d = v - prev;
    if(d > 64) d -= 128;
    else if(d < -64) d += 128;
    return d;
  },
  // 相対 CC バイト値 v → 符号付き増分 (1クリック分)。方式ごとに CW/CCW の符号化が異なる。
  _relDelta(key, v){
    let d;
    if(this.relMode === 'lcxl3'){
      if(this._lcxlCenteredEvent){
        d = Math.sign(v - 64);                                   // 公式相対: 65=CW、63=CCW
      }else{
        // Feature Controlを受け取れない環境向けの絶対CCフォールバック。
        d = Math.sign(this._relAbsoluteDelta(key, v));
      }
    }
    else if(this.relMode === 'absdelta'){                        // 絶対 CC: 前回値との差分。左回しで raw が下がる機種向け
      d = this._relAbsoluteDelta(key, v);
    }else if(this.relMode === 'offset') d = v - 64;               // オフセットバイナリ: 中央64, 65..=CW / 63..=CCW
    else if(this.relMode === 'signed'){                          // 符号ビット: bit6 が方向。1..63=CW / 65..127=CCW
      d = (v < 64) ? v : -(v - 64);
    }else{
      d = (v < 64) ? v : (v - 128);                              // 2の補数: 1..63=CW / 127..65=CCW
    }
    return d;
  },
  _relScale(){
    return 127 / Math.max(1, Math.min(960, this.relStep || 48));
  },
  _relAbs(key, v, initial){
    if(!this.relative) return v;
    const init = (typeof initial === 'number' && isFinite(initial)) ? initial : 0;
    const d = this._relDelta(key, v) * this._relScale();
    // 常に「現在の実値(init)」を基準に増分を足す。仮想値(_relVal)を持ち越すと
    // プリセット/UI/フェード/デッドゾーンで実値が変わったときにズレが蓄積し、
    // 「一度 0/1 の端まで振らないと、その閾値から上げ下げできない」stuck が起きる。
    let nv = Math.max(0, Math.min(127, init + d));
    // 刻み(quantStep)有効時: 現在値を刻みに合わせたうえで最低1刻み動かす。
    //   単純に丸めるだけだと、1クリック分(≈2.6)が毎回丸めで消えてつまみが動かなくなる。
    //   速く回して d が大きいときは、その分だけ多く進む。
    const q = this.quantStep || 0;
    if(q > 0 && d !== 0){
      const step = q * 127;
      const cur = Math.round(init / step) * step;                  // 現在値を刻みへ寄せる
      const mag = Math.max(step, Math.abs(d));                     // 最低1刻みは進める
      nv = Math.max(0, Math.min(127, cur + Math.sign(d) * mag));
      nv = this._quantize(nv);
      // デッドゾーン (|値|<0.1) の中は効かないので刻みを 1 段浪費させない。
      //   上げるときは 0 → 0.1 (効き始め) へ直行 / 下げるときは 0.1 → 0 へ落とす。
      const DZ = 0.1 * 127;
      if(d > 0 && nv > 0 && nv < DZ) nv = DZ;
      else if(d < 0 && nv > 0 && nv < DZ) nv = 0;
    }
    // 絶対ノブ(absdelta)の物理端スナップ: ノブと実値がズレていても、端まで回し切れば
    // パラメータも必ず端に届く (端の手前で止まって動かせなくなる症状の解消)
    if(this.relMode === 'absdelta'){
      if(v <= 0) nv = 0;
      else if(v >= 127) nv = 127;
    }
    this._relVal[key] = nv;
    return nv;
  },
  _isFaderCC(c){
    if(typeof c !== 'string' || c.indexOf('cc:') !== 0) return false;
    const n = parseInt(c.slice(3), 10);
    return n >= 5 && n <= 12;
  },
  // つまみの刻み幅 (正規化 0..1 での量子化ステップ)。0 = 量子化なし(連続)。
  //   0.05 なら 0.00 / 0.05 / 0.10 … の 21 段。レンジ 0..1 のパラメータでは実値も 0.05 刻み。
  quantStep: 0.05,
  _quantize(v){
    const q = this.quantStep || 0;
    if(!(q > 0)) return v;
    const step = q * 127;
    return Math.max(0, Math.min(127, Math.round(v / step) * step));
  },
  _continuousValue(key, v, initial, c){
    // XL3の8本の物理フェーダー(CC5〜12)は常に絶対値。
    if(this._isFaderCC(c)) return this._quantize(v);
    return this._relAbs(key, v, initial);   // 相対つまみは _relAbs 内で刻みを適用
  },
  syncRelativeUi(){ if(typeof UI !== 'undefined' && UI.refreshMidiRelative) UI.refreshMidiRelative(); this._relUiDirty = false; },
  saveRelativeDefault(){
    const d = { relative:!!this.relative, relMode:this.relMode, relStep:this.relStep };
    try{
      localStorage.setItem('vj.def.midiRelative', JSON.stringify(d));
      toast('デフォルト保存: MIDI Relative');
    }catch(e){ toast('保存失敗'); }
  },
  resetRelativeDefault(){
    const d = { relative:true, relMode:'absdelta', relStep:48 };
    this.relative = d.relative;
    this.relMode = d.relMode;
    this.relStep = d.relStep;
    this._relVal = {}; this._relRaw = {};
    try{
      localStorage.setItem('vj.def.midiRelative', JSON.stringify(d));
      localStorage.setItem('vj.midiRel', '1');
      localStorage.setItem('vj.midiRelMode', d.relMode);
      localStorage.setItem('vj.midiRelStep', String(d.relStep));
    }catch(e){}
    this._configureLCXL3Relative(false);
    const rel = $('#midiRelative'); if(rel) rel.checked = true;
    const mode = $('#midiRelMode'); if(mode) mode.value = d.relMode;
    const step = $('#midiRelStep'); if(step) step.value = String(d.relStep);
    const stepVal = $('#midiRelStepVal'); if(stepVal) stepVal.textContent = String(d.relStep);
    toast('デフォルトをリセット: MIDI Relative');
  },
  // ── 逆回転フェード ──
  //   MIDI つまみを速く逆方向へ切り返したら、ガクッと飛ばさず Param Fade の時間をかけて中立値へ
  //   なめらかに戻し、そこから現在値の追従を再開する。
  _knob:{}, _suppress:{},
  _REV_WINDOW: 0.28,   // 逆転判定の時間窓 (秒)
  _REV_THRESH: 40,     // その窓内での移動量しきい値 (0..127。約 1/3 回転)
  _postNeutral(pk, r){
    const NEU = { sat:0, con:0 };                 // centered UI values
    if(pk in NEU) return NEU[pk];
    return 0;                                      // [-1,1] / [0,x] とも中立は 0
  },
  // 発動したら true (呼び出し側は直接適用しない)。
  // ─── ピックアップ (プリセット読込後の取り込み待ち) ─────────────────
  //   プリセットを読むと実値が変わり、MIDI つまみの物理位置とズレる。
  //   そのままだと次に触った瞬間に飛ぶ/ズレたまま動くので、
  //   「つまみが基準点(-1..1 なら中央 0 / 0..1 なら下端)を通過するまで反映しない」状態にする。
  //   通過したら解除して、以後は通常どおり動く。
  pickup: true,
  _pickupArmed: {},          // mapKey → {ref, side} 取り込み待ち
  // 正規化 0..127 での基準点。両極性(min<0<max)は中央、それ以外は下端。
  _pickupRef(r){
    if(!r) return 0;
    if(r[0] < 0 && r[1] > 0) return (0 - r[0]) / (r[1] - r[0]) * 127;   // 値 0 の位置
    return 0;                                                           // 下端
  },
  // プリセット/リセット等で実値が外部から変わったときに呼ぶ。以後 MIDI は基準点通過まで無視。
  armPickup(){
    if(!this.pickup) return;
    this._pickupArmed = {};
    for(const mapKey in this.map){
      const pname = (this.map[mapKey] && this.map[mapKey].name) || mapKey;
      this._pickupArmed[mapKey] = { ref: null, side: null };
    }
    this._pickupCount = Object.keys(this._pickupArmed).length;
  },
  // つまみ位置 v(0..127) が基準点 ref を通過したか。通過するまで true(=無視) を返す。
  //   相対エンコーダ(上段つまみ)は現在値からの増分なので値が飛ばない → 取り込み不要で常に素通し。
  //   取り込み待ちの対象は絶対値コントロール(XL3 のフェーダー CC5〜12 / 絶対モード時の全部)のみ。
  _pickupBlocks(mapKey, v, r, c){
    if(!this.pickup) return false;
    if(this.relative && !this._isFaderCC(c)){ delete this._pickupArmed[mapKey]; return false; }
    const st = this._pickupArmed[mapKey];
    if(!st) return false;
    const ref = this._pickupRef(r);
    const near = Math.abs(v - ref) <= 3.5;                 // 基準点にほぼ一致 = 取り込み
    const side = v < ref ? -1 : 1;
    if(st.side == null) st.side = side;                    // 最初の位置を記録
    if(near || side !== st.side){                          // 基準点に到達 or またいだ
      delete this._pickupArmed[mapKey];
      if(!Object.keys(this._pickupArmed).length) toast('MIDI: つまみを取り込みました');
      return false;
    }
    return true;                                           // まだ基準点を通っていない → 無視
  },
  _reversalFade(mapKey, pk, v, r){
    if(!(App._fadeBeatsLive() > 0)) return false;    // Param Fade OFF なら通常動作 (Sync 時は transBeats を見る)
    const t = now();
    const st = this._knob[mapKey] || (this._knob[mapKey] = {v, dir:0, accum:0, accT:t});
    if(this._suppress[mapKey]){ st.v = v; return false; }   // フェード中は追従も逆転判定もしない
    const dv = v - st.v;
    const ndir = dv > 0 ? 1 : (dv < 0 ? -1 : st.dir);
    const reversed = st.dir !== 0 && ndir !== 0 && ndir !== st.dir;
    if(t - st.accT > this._REV_WINDOW){ st.accum = 0; st.accT = t; }
    st.accum += Math.abs(dv);
    const fast = st.accum >= this._REV_THRESH;
    st.v = v;
    if(ndir) st.dir = ndir;
    if(reversed && fast){
      App.fadePostNum(pk, this._postNeutral(pk, r), App._fadeSecLive());   // 現在値 → 中立へフェード
      this._suppress[mapKey] = true;                                   // フェード中は直接適用を止める
      clearTimeout(st._supT);
      st._supT = setTimeout(()=>{
        this._suppress[mapKey] = false;
        const k = this._knob[mapKey];                                  // 方向状態をリセット (再開時に誤発火しない)
        if(k){ k.dir = 0; k.accum = 0; k.accT = now(); }
        if(UI.refreshPost) UI.refreshPost();
      }, App._fadeSecLive()*1000 + 40);
      st.accum = 0; st.accT = t; st.dir = 0;
      return true;
    }
    return false;
  },
  // CC/Note マッピングキー → 右上 HUD 用の表示名
  _paramLabel(pname){
    if(pname && pname.indexOf('dom~') === 0) return pname.split('~').pop().replace(/_/g, ' ');   // dom~layerParams~Count → "Count"
    const k = pname.replace(/__$/, '').replace(/^.*__/, '');
    const L = { pixsort:'Pixelsort', slit2:'Gaussian Blur', glass:'Hipass', outline:'Outline', sketch:'Water', texNoise:'Tex Noise', rings:'Rings', pollock:'Pollock', pollockGloss:'Pollock Gloss', pollockMatt:'Pollock Matt', pollockFlat:'Pollock Flat', voxel:'Voxel', rain:'Rain', boltz:'Boltzmann', aStrobe:'Audio Strobe', aShock:'Shockwave', aExplode:'Pixel Explode', slitScan:'Slit-scan', gain:'Gain', gradMix:'Grad Map', cosGrad:'Cos Grad', sat:'Saturation', hue:'Hue Shift', hueRot:'Hue Rotate', bri:'Brightness', con:'Contrast', gamma:'Gamma', inv:'Invert', vig:'Vignette', chr:'Chroma Ab', pix:'Pixelate', scn:'Scanlines', grn:'Grain', unsharp:'Unsharp', pos:'Posterize', blm:'Bloom', shake:'Shake', fxaa:'FXAA', aScan:'Audio Scanline', aRgb:'Audio RGB', mosaic:'Mosaic', mblur:'Motion Blur', slice:'Slice', twist:'Twist', split:'Mondrian', fbAdd:'FB Add', fbMultiply:'FB Multiply', fbZoom:'Fb Zoom', fbRot:'Fb Rot', fbZoomRot:'Fb Zoom/Rot', clarity:'Clarity', denoise:'Denoise', deband:'Deband', vibrance:'Vibrance', dither:'Dither Blur', candy:'Tunnel', origami:'Needle', kaiser:'Origami', kaiserOld:'Kaiser', glitchTrail:'Datamosh', sdfChrome:'Relief', river:'Flames', bleed:'Bleed', impasto:'Impasto', chrome:'Chrome', barcode:'Barcode', audioFx:'Audio → FX', audioFxAttack:'Audio FX Attack', audioFxRelease:'Audio FX Release', crossfade:'Crossfade', transBeats:'Trans Beats', slotSwap:'Slot Swap', beatMode:'Beat Mode', mix:'Blend: Mix', add:'Blend: Add', multiply:'Blend: Multiply', screen:'Blend: Screen', darken:'Blend: Darken', lighten:'Blend: Lighten', difference:'Blend: Difference', overlay:'Blend: Overlay', warp:'Brush: Warp', smear:'Brush: Smear', curve:'Brush: Curve', smudgeWet:'Brush: Smudge Wet', pollockBrush:'Brush: Pollock', random:'Brush: Random' };
    return L[k] || k;
  },
  async init(){
    if(!navigator.requestMIDIAccess) return;
    // 既定マップを midimap.json から読込 (全オリジン共通)。localStorage の個別設定で上書き。
    let fileMap = {};
    try{
      const r = await fetch('midimap.json?t=' + Date.now(), {cache:'no-store'});
      if(r.ok) fileMap = await r.json();
    }catch(e){}
    let lsMap = {};
    try{ lsMap = JSON.parse(localStorage.getItem('vj.midi')||'{}'); }catch(e){}
    // learn 差分をサーバーからも取得してマージ (localStorage はオリジン/アプリごとに別なので、
    // ブラウザとデスクトップアプリでマップがずれる。サーバー値を正としてローカルへ流し込む)。
    try{
      const rs = await fetch(this._mapUrl(), {cache:'no-store'});
      if(rs.ok){
        const sm = await rs.json();
        // 未設定は [] (store.php の既定) で返る → この端末の差分を種まき
        const hasServer = sm && typeof sm === 'object' && !Array.isArray(sm) && Object.keys(sm).length;
        if(hasServer){
          lsMap = sm;
          try{ localStorage.setItem('vj.midi', JSON.stringify(sm)); }catch(e){}
        }else if(Object.keys(lsMap).length){
          this._uploadMap(lsMap);
        }
      }
    }catch(e){}
    // 旧仕様の残骸を掃除 (古い __blend__* マッピング等が残っていると新仕様の同 Note と衝突する)
    delete lsMap['*:__overlayEnabled__'];
    // blend は CC37〜44 へ移行。旧既定の Note 25〜28 が localStorage に残っていると
    // fileMap の新 CC 既定を上書きしてしまうため掃除する。
    for(const [bk, oldNote] of [['multiply',25],['screen',26],['darken',27],['lighten',28]]){
      const e = lsMap['*:__blend__'+bk];
      if(e && (e.type||'cc') === 'note' && e.cc === oldNote) delete lsMap['*:__blend__'+bk];
    }
    if(fileMap['*:__post__fb'] && !fileMap['*:__post__fbAdd']) fileMap['*:__post__fbAdd'] = fileMap['*:__post__fb'];
    if(lsMap['*:__post__fb'] && !lsMap['*:__post__fbAdd']) lsMap['*:__post__fbAdd'] = lsMap['*:__post__fb'];
    delete fileMap['*:__post__fb']; delete lsMap['*:__post__fb'];
    if(lsMap['*:__brush__pollock'] && (lsMap['*:__brush__pollock'].type||'cc') === 'note' && lsMap['*:__brush__pollock'].cc === 11) delete lsMap['*:__brush__pollock'];
    if(lsMap['*:__brush__random'] && (lsMap['*:__brush__random'].type||'cc') === 'note' && lsMap['*:__brush__random'].cc === 12) delete lsMap['*:__brush__random'];
    // ブラシは CC 列 (45〜52) へ移行済み。旧 Note 割り当ての残骸が localStorage に残っていると
    // fileMap の新 CC 既定を上書きし、CC45/47/49/52 が反応しなくなる → 旧既定 Note を掃除。
    for(const [bk, oldCc] of [['warp',9],['smear',10],['curve',11],['smudgeWet',12]]){
      const e = lsMap['*:__brush__'+bk];
      if(e && (e.type||'cc') === 'note' && e.cc === oldCc) delete lsMap['*:__brush__'+bk];
    }
    delete fileMap.__version__; delete lsMap.__version__;
    this._fileMap = Object.assign({}, fileMap);     // midimap.json の既定 (saveMap の差分計算用)
    // 既定(midimap.json 最新) + 個別 learn 差分。midimap.json の更新は反映され、learn 分だけ保持される
    // lsMap の null は「既定割当を外した」墓標 → マージ後に削除
    this.map = Object.assign({}, fileMap, lsMap);
    for(const k in this.map){ if(this.map[k] == null) delete this.map[k]; }
    // 直近の CC 値(ノブ位置)の復元は「復元モード」に従う。OFFならクリーン起動(前回値を適用しない)。
    const _restore = (typeof App === 'undefined') || (App._restoreOn !== false);
    try{ this.values = _restore ? JSON.parse(localStorage.getItem('vj.midivals')||'{}') : {}; }catch(e){ this.values = {}; }
    // 相対(エンドレス)エンコーダ設定。保存済みデフォルトを優先し、旧個別キーは未保存時の互換用。
    let relDef = null;
    try{
      // MIDI Relativeの既定値を一度だけ確定。プリセット復元や旧保存値で初期化されないようにする。
      if(localStorage.getItem('vj.midiRelativeDefaultV3') !== '1'){
        relDef = { relative:true, relMode:'absdelta', relStep:48 };
        localStorage.setItem('vj.def.midiRelative', JSON.stringify(relDef));
        localStorage.setItem('vj.midiRelativeDefaultV3', '1');
      }else{
        relDef = JSON.parse(localStorage.getItem('vj.def.midiRelative') || 'null');
      }
    }catch(_){}
    if(relDef && typeof relDef === 'object'){
      this._relUiDirty = true;                 // 復元したので UI 同期が必要
      this.relative = !!relDef.relative;
      if(relDef.relMode==='lcxl3'||relDef.relMode==='absdelta'||relDef.relMode==='twos'||relDef.relMode==='offset'||relDef.relMode==='signed') this.relMode = relDef.relMode;
      const rs = parseInt(relDef.relStep, 10);
      if(rs) this.relStep = Math.max(4, Math.min(960, rs));
    }else{
      try{ this.relative = (localStorage.getItem('vj.midiRel') === '1'); }catch(_){}
      try{ const rm = localStorage.getItem('vj.midiRelMode'); if(rm==='lcxl3'||rm==='absdelta'||rm==='twos'||rm==='offset'||rm==='signed') this.relMode = rm; }catch(_){}
      try{
        const rs = parseInt(localStorage.getItem('vj.midiRelStep')||'',10);
        if(rs) this.relStep = Math.max(4, Math.min(960, rs < 8 ? Math.round(127 / Math.max(1, rs)) : rs));
      }catch(_){}
    }
    // 復元した値を UI へ反映。MIDI.init はパネル構築より先/後どちらもあり得るので
    //   直後と次のタスクの両方で試す (どちらかで UI が存在する)。
    this.syncRelativeUi();
    setTimeout(()=>this.syncRelativeUi(), 0);
    // 接続状態をトップバーに常時表示 (デバイス数)。拾えないときの切り分け用。
    const _midiStat = ()=>{
      const md = $('#statMidi'); if(!md || !this.access) return;
      const n = [...this.access.inputs.values()].length;
      md.textContent = n ? `MIDI ${n}` : 'MIDI 0台';
    };
    // requestMIDIAccess をタイムアウト付きでリトライする。
    //   Electron(特に Finder 起動の署名アプリ)では初回の requestMIDIAccess が解決しないまま
    //   ハングすることがある(権限確定待ち)。2.5秒で打ち切り→再試行すると次回以降で解決する。
    const _reqMIDI = async (tries)=>{
      for(let i=0;i<tries;i++){
        try{
          return await Promise.race([
            // XL3のRGB LED制御はSysExを使うため、Chromeにも明示的に許可を要求する。
            navigator.requestMIDIAccess({sysex:true}),
            new Promise((_,rej)=>setTimeout(()=>rej(new Error('midi-timeout')), 2500)),
          ]);
        }catch(e){ if(i < tries-1) await new Promise(r=>setTimeout(r, 700)); else throw e; }
      }
    };
    try{
      this.access = await _reqMIDI(6);
      for(const inp of this.access.inputs.values()) inp.onmidimessage = e=>this._msg(e);
      this.outputs = this.access.outputs ? [...this.access.outputs.values()] : [];
      this._configureLCXL3Relative(this.relative && this.relMode === 'lcxl3');
      this.access.onstatechange = e=>{
        if(e.port.type==='input' && e.port.state==='connected') e.port.onmidimessage = ev=>this._msg(ev);
        this.outputs = this.access.outputs ? [...this.access.outputs.values()] : [];
        if(e.port.state==='connected') this._configureLCXL3Relative(this.relative && this.relMode === 'lcxl3');
        _midiStat();
        if(this.ledEnabled){ this.resetLeds(); this.refreshLeds(); }
      };
      _midiStat();
      if(![...this.access.inputs.values()].length) toast('MIDI 入力デバイスが見つかりません (接続すると自動認識します)', 3500);
    }catch(e){
      const md = $('#statMidi'); if(md) md.textContent = 'MIDI ×';
      toast('MIDI アクセス失敗: ' + e, 4000);
    }
    // 起動時: 直近に受信した CC 値を全マッピングへ適用 (連続値のみ)。復元OFFなら適用しない。
    if(_restore && !this.relative) this.applyAll();
    // LED は既定で無効。有効時のみ全消去 → アクティブなトグル点灯。
    if(this.ledEnabled){ this.resetLeds(); this.refreshLeds(); }
  },
  outputs:[],
  _isLCXL3Port(port){
    if(!port) return false;
    // Chrome/Web MIDI reports the same hardware with slightly different names
    // depending on the driver and whether DAW/Custom Mode is active.
    const name = String(port.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return name.includes('lcxl3')
      || name.includes('launchcontrolxl3')
      || name.includes('launchcontrolxlmk3')
      || (name.includes('launchcontrol') && name.includes('xl'));
  },
  // Standalone/Custom ModeとLEDを保ったままFeature Controlだけを有効にし、
  // Encoder 3列を公式の中心64相対出力へ切り替える。DAW Mode自体は必ずOFFにする。
  _configureLCXL3Relative(on){
    const outs = (this.outputs || []).filter(o=>this._isLCXL3Port(o));
    for(const out of outs){
      try{
        out.send([0x9F, 0x0C, 0x00]);
        out.send([0x9F, 0x0B, on ? 0x7F : 0x00]);
        out.send([0xB6, 0x45, on ? 0x7F : 0x00]);
        out.send([0xB6, 0x48, on ? 0x7F : 0x00]);
        out.send([0xB6, 0x49, on ? 0x7F : 0x00]);
      }catch(e){}
    }
    if(!on){ this._lcxlOfficialSeen = false; this._lcxlOfficialAt = {}; }
  },
  _noteChan:{}, // Note 番号 → 実際に受信したチャンネル (LED 出力用)
  _ccChan:{},   // CC 番号 → 実際に受信したチャンネル (CC LED 出力用)
  // Novation Launch Control / Launchpad 系 LED カラー: velocity = 16*緑 + 赤 + 12(フラグ)
  //   緑点灯=60, 赤=15, 橙=63、消灯=12。
  //   消灯は必ず 12 を使う(フラグ bit2/3=copy/clear で両バッファに書く)。0 にすると
  //   片バッファのみ更新になり、もう片方の残データと交互表示されて明滅する。
  // DAW/旧Launch Controlのパレット値。XL3 Custom Modeのボタン値とは分ける。
  ledOn:3, ledOff:12,
  // Componentsの現在設定: On value=127 / Off value=3。
  // Custom ModeへCCを返す場合はパレット番号ではなく、この値で状態を保持する。
  lcxl3ButtonOn:127, lcxl3ButtonOff:3,
  // 既定で LED 出力は無効 (無印 Launch Control 等で明滅/点灯トラブルが出るため)。
  // フィードバックが欲しい場合のみ MIDI.ledEnabled=true にする。
  ledEnabled:true,
  // 全 LED リセット(消灯 + フラッシュ/二重バッファ状態を解除)。Launchpad/Launch Control 共通: CC0=0。
  // 無印 Launch Control はテンプレ毎にチャンネルが違うため、全 16ch へ送って確実に当てる。
  resetLeds(){
    if(!this.outputs || !this.outputs.length) return;
    for(let ch=0; ch<16; ch++){
      const data = [0xB0 | ch, 0x00, 0x00];
      for(const out of this.outputs){ try{ out.send(data); }catch(e){} }
    }
  },
  // ON 状態の Note トグルをコントローラの LED に反映 (velocity で色指定)
  _sendNote(ch, note, on){
    if(!this.ledEnabled || !this.outputs || !this.outputs.length) return;
    const data = [0x90 | ((ch||0) & 0x0f), note & 0x7f, on ? this.ledOn : this.ledOff];
    for(const out of this.outputs){ try{ out.send(data); }catch(e){} }
  },
  _sendNoteOff(ch, note){
    if(!this.ledEnabled || !this.outputs || !this.outputs.length) return;
    const data = [0x80 | ((ch||0) & 0x0f), note & 0x7f, 0];
    for(const out of this.outputs){ try{ out.send(data); }catch(e){} }
  },
  _sendCC(ch, cc, on){
    if(!this.ledEnabled || !this.outputs || !this.outputs.length) return;
    // Launch Control XL3のCC LEDは値を色番号として解釈する。12=消灯、60=緑点灯。
    const data = [0xB0 | ((ch||0) & 0x0f), cc & 0x7f, on ? this.ledOn : this.ledOff];
    for(const out of this.outputs){ try{ out.send(data); }catch(e){} }
  },
  _lcxl3UsbInOutputs(){
    // Custom ModeとDAW経路でポート名が異なるため、XL3のUSB出力は絞り込まない。
    // 本体が受け付けない経路への送信はWeb MIDI側で無視され、LED制御可能な経路だけが反応する。
    return (this.outputs || []).filter(out=>this._isLCXL3Port(out));
  },
  // XL3のボタンLEDへ、Custom ModeのOn/Off CCとRGB SysExを送る。
  // CC45〜52はCustom Modeごとにチャンネルが変わり得るため、受信チャンネルも含めて送る。
  _sendLCXL3ButtonLed(cc, on, channels){
    if(!this.ledEnabled) return;
    const outs = this._lcxl3UsbInOutputs();
    if(!outs.length) return;
    const chans = [...new Set((channels && channels.length ? channels : [0]).map(ch=>(ch|0)&0x0f))];
    const buttonValue = on ? this.lcxl3ButtonOn : this.lcxl3ButtonOff;
    const rgb = on ? [127, 127, 127] : [0, 0, 0];
    const sysex = [0xF0,0x00,0x20,0x29,0x02,0x15,0x01,0x53,cc & 0x7f,
      rgb[0],rgb[1],rgb[2],0xF7];
    for(const out of outs){
      try{ out.send(sysex); }catch(e){}
      for(const ch of chans){
        try{ out.send([0xB0 | ch, cc & 0x7f, buttonValue]); }catch(e){}
      }
    }
  },
  _sendLCXL3Color(cc, on){
    if(!this.ledEnabled || !this.outputs || !this.outputs.length) return;
    // Custom ModeのRGB LEDはメインMIDI InポートへSysExで直接指定する。RGBは7bit値。
    const rgb = on ? [127, 127, 127] : [0, 0, 0]; // active=white / inactive=off
    const data = [0xF0,0x00,0x20,0x29,0x02,0x15,0x01,0x53,cc & 0x7f,
      rgb[0],rgb[1],rgb[2],0xF7];
    const targets = this._lcxl3UsbInOutputs();
    for(const out of targets){
      try{ out.send(data); }catch(e){}
    }
  },
  // デバッグ: 出力ポートと観測チャンネルを表示し、全 LED に色を送ってみる
  ledInfo(color){
    const outs = (this.outputs||[]).map(o=>o.name);
    console.log('MIDI outputs:', outs, 'noteChan:', this._noteChan, 'map notes:',
      Object.keys(this.map).filter(k=>(this.map[k].type||'cc')==='note'));
    if(color != null){
      for(const k in this.map){
        const m = this.map[k];
        if(!m || (m.type||'cc')!=='note') continue;
        const ch = (m.ch!=null) ? m.ch : (this._noteChan[m.cc]!=null ? this._noteChan[m.cc] : 0);
        const data = [0x90|(ch&0x0f), m.cc&0x7f, color&0x7f];
        for(const out of this.outputs){ try{ out.send(data); }catch(e){} }
      }
    }
    return outs;
  },
  refreshLeds(){
    if(!this.outputs || !this.outputs.length) return;
    const hasLCXL3 = this.outputs.some(o=>this._isLCXL3Port(o));
    // CC42〜52はXL3のボタン範囲。未登録の番号や前回の点灯状態も残さないよう、
    // 受信済みチャンネルとXL3のDAW/Mode16チャンネルを先に全消灯する。
    const buttonChannels = new Set([0]);
    if(this.outputs.some(o=>this._isLCXL3Port(o))) buttonChannels.add(15);
    for(const cc of Object.keys(this._ccChan)) buttonChannels.add(this._ccChan[cc]);
    for(const k in this.map){
      const m = this.map[k];
      if(m && m.cc >= 42 && m.cc <= 52 && m.ch != null) buttonChannels.add(m.ch);
    }
    for(const ch of buttonChannels){
      for(let cc=42; cc<=52; cc++){
        if(hasLCXL3 && cc >= 45 && cc <= 52) this._sendLCXL3ButtonLed(cc, false, [ch]);
        else {
          this._sendCC(ch, cc, false);
          this._sendNoteOff(ch, cc);
        }
      }
    }
    if(hasLCXL3){
      for(let cc=42; cc<=52; cc++) this._sendLCXL3Color(cc, false);
    }
    for(const k in this.map){
      const m = this.map[k];
      if(!m) continue;
      const pname = k.split(':')[1];
      let on = null;
      if(pname==='__overlayEnabled__') on = (typeof Overlay!=='undefined') ? !!Overlay.P.enabled : null;
      else if(pname==='__slotAB__')    on = (App.activeSlot === 'B');
      else if(pname==='__beatMode__')  on = (App.beatMode === 'beat');
      else if(pname && pname.indexOf('__blend__')===0){
        // 25-28: screen / darken / lighten / overlay。それぞれ自身のモード時のみ点灯。
        // どれも該当しない(mix=通常 等)場合は全 OFF。
        const mode = pname.slice(9), bm = App.blendMode;
        on = (bm === mode);
      }
      else if(pname && pname.indexOf('__post__')===0 && m.cc >= 42 && m.cc <= 52){
        // CC42〜44もボタン枠。連続パラメータはニュートラル値から動いた時だけ点灯。
        const pk = pname.slice(8), pv = App.post && App.post[pk];
        const neutral = (pk === 'sat' || pk === 'con') ? (Math.abs((pv == null ? 1 : pv) - 1) < 0.01) : Math.abs(Number(pv) || 0) < 0.01;
        on = !neutral;
      }
      else if(pname && pname.indexOf('__brush__')===0){
        on = (typeof Overlay!=='undefined') && Overlay.P.enabled && Overlay.P.brushMode === pname.slice(9);
      }
      if(on === null) continue;
      // ch が未指定(null)なら実際に受信したチャンネルへ送る (テンプレ依存対策)
      const kind = m.type || 'cc';
      const ch = (m.ch != null) ? m.ch
        : (kind === 'cc' && this._ccChan[m.cc] != null ? this._ccChan[m.cc]
        : (this._noteChan[m.cc] != null ? this._noteChan[m.cc] : 0));
      // CC42〜52はLaunch Control XL3のボタン。全消灯後、選択中だけ点灯する。
      if(kind === 'cc' && m.cc >= 42 && m.cc <= 52){
        if(on){
          if(hasLCXL3){
            const activeChans = m.ch != null ? [ch] : [...buttonChannels];
            this._sendLCXL3ButtonLed(m.cc, true, activeChans);
          }
          else if(m.ch != null) this._sendCC(ch, m.cc, true);
          else for(const ledCh of buttonChannels) this._sendCC(ledCh, m.cc, true);
        }
      } else this._sendNote(ch, m.cc, on);
    }
  },
  // UI/プリセット側から状態が変わったとき、本体のToggle更新後にも同じ状態を再送する。
  syncLeds(){
    if(!this.ledEnabled) return;
    this.refreshLeds();
    clearTimeout(this._stateLedRefreshT);
    this._stateLedRefreshT = setTimeout(()=>{
      this._stateLedRefreshT = null;
      this.refreshLeds();
    }, 120);
  },
  // この端末の learn 差分をサーバーへ送る (他端末はリロード or Pull で反映)
  async pushMap(){
    let diff = {};
    try{ diff = JSON.parse(localStorage.getItem('vj.midi') || '{}'); }catch(e){}
    const n = Object.keys(diff).length;
    if(typeof App !== 'undefined' && App._storeWritable && !App._storeWritable()){ toast('この公開版ではサーバー共有はできません'); return; }
    try{
      const r = await fetch(this._mapUrl() + '&force=1', {method:'POST', headers:{'Content-Type':'application/json'},
                                                          body: JSON.stringify(diff)});
      if(!r.ok) throw new Error('HTTP ' + r.status);
      toast('MIDI マップを共有しました (' + n + ' 件)');
    }catch(e){ toast('共有に失敗: ' + e.message); }
  },
  // サーバーの learn 差分をこの端末へ取り込む
  async pullMap(){
    try{
      const r = await fetch(this._mapUrl(), {cache:'no-store'});
      if(!r.ok) throw new Error('HTTP ' + r.status);
      const sm = await r.json();
      if(!sm || typeof sm !== 'object' || Array.isArray(sm)){ toast('サーバーにマップがありません'); return; }
      const n = Object.keys(sm).length;
      localStorage.setItem('vj.midi', JSON.stringify(sm));
      this.map = Object.assign({}, this._fileMap || {}, sm);
      for(const k in this.map){ if(this.map[k] == null) delete this.map[k]; }
      if(this.syncLeds) this.syncLeds(); else if(this.refreshLeds) this.refreshLeds();
      toast('MIDI マップを取り込みました (' + n + ' 件)');
    }catch(e){ toast('取り込みに失敗: ' + e.message); }
  },
  // 現在のマップを midimap.json としてダウンロード (リポジトリに置けば全オリジン共通の既定になる)
  exportMapFile(){
    const blob = new Blob([JSON.stringify(this.map, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'midimap.json';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  },
  saveMap(){
    // midimap.json (既定) と異なる learn 差分だけ保存。map 全体を保存すると古い midimap が
    // localStorage に焼き付き、後で midimap.json を更新しても古いキーマップに戻ってしまう。
    const fm = this._fileMap || {};
    const diff = {};
    for(const k in this.map){ if(JSON.stringify(fm[k]) !== JSON.stringify(this.map[k])) diff[k] = this.map[k]; }
    // 既定(midimap.json)にあるが現マップから消えたキーは null の墓標で保持 (learn の1つまみ1対応で外れた既定割当がリロードで復活しないように)
    for(const k in fm){ if(!(k in this.map)) diff[k] = null; }
    try{ localStorage.setItem('vj.midi', JSON.stringify(diff)); }catch(e){}
    this._uploadMap(diff);   // 端末間 (ブラウザ / デスクトップアプリ) で learn を共有
  },
  // learn 差分のサーバーストア (presets/store.php?name=midimap)
  _mapUrl(){
    const base = (typeof App !== 'undefined' && App._storeBase) ? App._storeBase() : 'presets/store.php';
    return base + '?name=midimap';
  },
  _uploadMap(diff){
    try{
      if(typeof App !== 'undefined' && App._storeWritable && !App._storeWritable()) return;
      // force=1: learn で割当を外すとキーが減る。store.php の縮小ガードに弾かれると
      // 以後の同期が固定化するため、意図した縮小として通す。
      fetch(this._mapUrl() + '&force=1', {method:'POST', headers:{'Content-Type':'application/json'},
                                          body: JSON.stringify(diff || {})}).catch(()=>{});
    }catch(e){}
  },
  _msg(e){
    const [s,c,v] = e.data;
    const status = s & 0xf0;
    const ch0 = s & 0x0f;
    const lcxlCentered = this.relative && this.relMode === 'lcxl3' && status === 0xB0 && ch0 === 15 && c >= 77 && c <= 100;
    this._lcxlCenteredEvent = lcxlCentered;
    const midiNow = performance.now();
    if(!this._lcxlOfficialAt) this._lcxlOfficialAt = {};
    if(lcxlCentered){
      this._lcxlOfficialSeen = true;
      this._lcxlOfficialAt[c - 64] = midiNow;
    }
    // 同じ操作が公式相対/Standalone絶対の両ポートから並行して届く場合だけ絶対側を落とす。
    // 一度公式イベントを見た後にそのストリームが途切れても、通常CCを永久に無視しない。
    if(this.relative && this.relMode === 'lcxl3' && status === 0xB0 && c >= 13 && c <= 36 && !lcxlCentered
      && midiNow - (this._lcxlOfficialAt[c] || -Infinity) < 140) return;
    // CC (0xB0) と Note On/Off (0x90/0x80) を受け付ける。
    // 多くの MIDI コンの「押すボタン/パッド」は Note で送られる。
    let kind, num, val;
    if(status === 0xB0){ kind='cc';   num=c; val=v; }
    else if(status === 0x90){ kind='note'; num=c; val=v; }     // Note On (v=0 は離鍵扱い)
    else if(status === 0x80){ kind='note'; num=c; val=0; }     // Note Off
    else return;
    const ch = s & 0x0f;
    // XL3のDAW相対モードでは通常のEncoder CC 13..36が64増えたCC 77..100になる。
    // 既存のLearn/マッピングをそのまま使えるよう、受信直後に元のCC番号へ正規化する。
    if(lcxlCentered){
      num -= 64;
    }
    // CC45〜52はXL3のボタン列。押下値を受けた瞬間にもLEDを更新し、
    // Custom Modeのチャンネル設定や後段のマッピング処理に依存しないようにする。
    if(kind === 'cc' && num >= 45 && num <= 52 && val >= 64 && this.outputs.some(o=>this._isLCXL3Port(o))){
      this._sendLCXL3ButtonLed(num, true, [ch, 0, 15]);
    }
    if(kind==='note') this._noteChan[num] = ch; // LED 出力用に実チャンネルを記憶
    else this._ccChan[num] = ch;
    const label = (kind==='note' ? 'Note' : 'CC') + num;
    const md = $('#statMidi');
    const hudNow = performance.now();
    if(md && hudNow >= (this._hudMappedUntil || 0)) md.textContent = val+' '+label+' (ch'+(ch+1)+')';
    if(this.learn){
      // 1つのつまみには1パラメータのみ: 同じ CC/Note (同ch または 全ch指定) の既存割当を外してから登録
      for(const k in this.map){
        const m = this.map[k];
        if(m && m.cc===num && (m.type||'cc')===kind && (m.ch==null || m.ch===ch)) delete this.map[k];
      }
      this.map[this.learn] = {ch, cc:num, type:kind};
      const sel = this.learn; this.learn = null;
      this.saveMap();
      UI.refreshParams();
      toast('Mapped '+sel+' ← '+label);
      return;
    }
    // 直近の値をキャッシュ (リロード時の復元用)。CC と Note の同番号衝突を避けて type 付きキー
    const vk = kind+':'+num;
    this.values[vk] = val;
    this._saveValues();
    let hitParam = null, hitSlot = null, hitV = val;
    for(const k in this.map){
      const m = this.map[k];
      if((m.ch==null || m.ch===ch) && m.cc===num && (m.type||'cc')===kind){
        const [slotKey, pname] = k.split(':');
        const ev = this._applyMapping(slotKey, pname, vk, val, false);
        if(!hitParam){ hitParam = pname; hitSlot = slotKey; if(typeof ev === 'number') hitV = ev; }   // 相対モードでは蓄積した実効値を HUD に表示 (生の増分バイトではなく)
      }
    }
    // XL3のToggleボタンは本体がLED状態を保持する。リリース時に全消灯→再描画すると
    // 本体の保持状態をGARA側で消してしまうため、押下時だけ状態を再描画する。
    if(kind === 'cc' && num >= 45 && num <= 52 && this.outputs.some(o=>this._isLCXL3Port(o))){
      if(val >= 64) this.refreshLeds();
      else {
        // Momentary互換のリリース後に、本体が消したLEDだけを現在状態から再送する。
        clearTimeout(this._lcxl3LedRefreshT);
        this._lcxl3LedRefreshT = setTimeout(()=>{
          this._lcxl3LedRefreshT = null;
          if(this.outputs && this.outputs.some(o=>this._isLCXL3Port(o))) this.refreshLeds();
        }, 120);
      }
    }
    // マッピング処理後の実効値を右パネルへ再同期。相対入力や同一ノブの複数ポート受信でも
    // 生の増分値(1/63/65/127)がUIへ残らないよう、状態オブジェクトを表示の基準にする。
    if(hitParam){
      if(hitParam.indexOf('__post__') === 0 || hitParam === '__fbZoomRot__'){
        if(UI.refreshPost) UI.refreshPost();
      }else if(hitParam === '__crossfade__'){
        if(UI.refreshMix) UI.refreshMix();
      }else if(hitSlot === 'A' || hitSlot === 'B'){
        const slot = GL.slots[hitSlot];
        const p = slot && slot.params && slot.params.find(x=>x.name===hitParam);
        if(p && UI.updateParamUI) UI.updateParamUI(hitSlot, p);
      }
    }
    // 操作中パラメータ名を右上 HUD に表示 (マッピング済みのみ。未マッピングは CC番号のまま)
    // 既定 (midimap.json) 由来の割当でも CC/Note 番号を併記 → 「CC25 Pixelsort 0.35」
    if(hitParam && md){
      this._hudMappedUntil = hudNow + 300;
      const key = hitParam.replace(/__$/, '').replace(/^.*__/, '');
      const r = this.postRange[key];
      const rv = r ? (r[0] + (r[1]-r[0])*hitV/127) : hitV/127;
      // 右上 HUD: 「CC番号 (Param名) 数値」右揃え。等幅なので幅220pxに収まる文字数を実測し、
      //   パラメータ名がはみ出す分だけ … で省略(CC番号と数値は常に表示。右余白を空けない)。
      const valStr = App.deadDisplay(rv, x=>x.toFixed(2));
      let pn = this._paramLabel(hitParam);
      if(this._hudMaxChars == null){
        const cs = getComputedStyle(md);
        if(!this._hudCtx){ this._hudCtx = document.createElement('canvas').getContext('2d'); }
        this._hudCtx.font = cs.font || '11px monospace';
        const charW = this._hudCtx.measureText('0').width || 6.6;
        this._hudMaxChars = Math.max(8, Math.floor((parseFloat(cs.maxWidth) || 220) / charW));
      }
      const fixedLen = (label + ' () ' + valStr).length;
      const over = fixedLen + pn.length - this._hudMaxChars;
      if(over > 0) pn = pn.slice(0, Math.max(1, pn.length - over - 1)) + '…';
      md.textContent = label + ' (' + pn + ') ' + valStr;
    }
  },
  // 1 マッピングを適用。fromLoad=true のときはモメンタリ(toggle)系をスキップ
  _applyMapping(slotKey, pname, c, v, fromLoad){
    // 汎用 DOM 駆動 (mode エンジン param / トグル): data-midi-key の要素を直接動かして input/change を発火。
    //   各エンジンの既存リスナがそのまま走るので、パラメータごとの個別配線が不要。
    if(pname && pname.indexOf('dom~') === 0){
      const el = document.querySelector('[data-midi-key="' + slotKey + ':' + pname + '"]');
      if(!el) return;
      if(el.type === 'checkbox'){
        const isNote = (typeof c === 'string' && c.indexOf('note:') === 0);
        if(isNote){                                  // Note(ボタン/パッド): 押下の立ち上がりでトグル
          if(!fromLoad && this._rise(c, v)){ el.checked = !el.checked; el.dispatchEvent(new Event('change', {bubbles:true})); }
        } else {                                     // CC(つまみ/スイッチ): 閾値 64 で ON/OFF
          const on = v >= 64;
          if(el.checked !== on){ el.checked = on; el.dispatchEvent(new Event('change', {bubbles:true})); }
        }
      } else {
        const mi = parseFloat(el.min); const ma = parseFloat(el.max);
        const lo = isFinite(mi) ? mi : 0, hi = isFinite(ma) ? ma : 1;
        const cur = parseFloat(el.value);
        const init = (hi !== lo && isFinite(cur)) ? (cur - lo) / (hi - lo) * 127 : 0;
        const ev = this._continuousValue(slotKey + ':' + pname, v, init, c);
        el.value = lo + (hi - lo) * (ev / 127);
        el.dispatchEvent(new Event('input', {bubbles:true}));
        return ev;
      }
      return;
    }
    if(pname==='__crossfade__'){ const ev = this._continuousValue('__crossfade__', v, App.crossfade * 127, c); App.crossfade = ev/127; UI.refreshMix(); return ev; }
    if(pname==='__bpm__'){ BPM.setBpm(60 + v); return; }
    if(pname==='__slotAB__'){
      // 押した瞬間 (立ち上がり) にトグルしてハードカット。離しても保持
      if(!fromLoad && this._rise(c, v)) App.toggleSlot();
      return;
    }
    if(pname==='__slotSwap__'){ if(!fromLoad && this._rise(c, v)) App.swapSlots(); return; }
    if(pname==='__transBeats__'){
      // つまみ 0-127 を UI プルダウンと同じ拍リストにマップ (1/32 〜 32 拍)
      const opts = [0, 0.03125, 0.0625, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32];
      App.transBeats = opts[Math.min(opts.length - 1, Math.floor((v / 127.0) * opts.length))];
      if(typeof UI !== 'undefined' && UI.refreshMix) UI.refreshMix();
      return;
    }
    if(pname && pname.indexOf('__blend__')===0){
      // 25-28: screen/darken/lighten/overlay。同じボタン再押下で mix(通常)へ戻る = トグル。
      if(!fromLoad && this._rise(c, v)){
        const mode = pname.slice(9);
        App.setBlendMode((App.blendMode === mode) ? 'mix' : mode);
        const cb = document.querySelector('#cfBlend'); if(cb) cb.value = App.blendMode;
        this.refreshLeds();
      }
      return;
    }
    if(pname==='__beatMode__'){ if(!fromLoad && this._rise(c, v)) App.toggleBeatMode(); return; }
    if(pname==='__beatScaleUp__'){ if(!fromLoad && this._rise(c, v)) App.beatScaleTap(1); return; }
    if(pname==='__beatScaleDn__'){ if(!fromLoad && this._rise(c, v)) App.beatScaleTap(-1); return; }
    if(pname==='__tap__'){ if(!fromLoad && this._rise(c, v)) BPM.tap(); return; }
    if(pname==='__resetPhase__'){ if(!fromLoad && this._rise(c, v)) BPM.resetPhase(); return; }
    if(pname==='__overlayEnabled__'){
      if(!fromLoad && this._buttonPress(c, v) && typeof Overlay !== 'undefined'){
        Overlay.P.enabled = !Overlay.P.enabled;
        if(UI.refreshOverlay) UI.refreshOverlay();
        this.refreshLeds();
      }
      return;
    }
    // __brush__<name> = ブラシ即切替 (押した瞬間)。
    //   押すたびにそのブラシの工場プリセット (BRUSH_DEFAULTS) を再ロード
    //   Overlay 無効なら → 有効化 + そのブラシへ
    //   既に有効 & そのブラシなら → 無効化 (トグル)
    //   既に有効 & 別ブラシなら → そのブラシへ切替 (有効維持)
    if(pname && pname.indexOf('__brush__')===0){
      if(!fromLoad && this._buttonPress(c, v) && typeof Overlay !== 'undefined'){
        const name = pname.slice(9);
        if(Overlay.P.enabled && Overlay.P.brushMode === name){
          Overlay.P.enabled = false;
          if(typeof Overlay.clear === 'function') Overlay.clear();
        } else {
          Overlay.P.brushMode = name;
          // プリセットを工場出荷状態に戻してから読込 (毎押下でリフレッシュ)
          if(Overlay.resetBrushParams) Overlay.resetBrushParams(name);
          if(Overlay.applyBrushDefaults) Overlay.applyBrushDefaults(name);
          // 同じボタンで呼び出すたびに TRIGGER / BRUSH SHAPE をランダム化
          //   (1 回目 = デフォルト値のまま / 2 回目以降 = 押すたびに引き直し)
          this._brushCall = this._brushCall || {};
          const nth = (this._brushCall[name] = (this._brushCall[name] || 0) + 1);
          if(nth > 1 && Overlay.randomizeBrushTriggerShape) Overlay.randomizeBrushTriggerShape();
          Overlay.P.enabled = true;
        }
        if(UI.refreshOverlay) UI.refreshOverlay();
        this.refreshLeds();
      }
      return;
    }
    if(pname==='__fbZoomRot__'){
      // 双極ノブ: 上半分(>=64)=Fb Zoom 0..1 / 下半分(<64)=Fb Rot 0..1 (中央=両方0)。生値保存(描画時に deadParam)。
      const init = (App.post.fbZoom > 0) ? 64 + App.post.fbZoom * 63 : 64 - (App.post.fbRot || 0) * 64;
      const ev = this._continuousValue(pname, v, init, c);
      if(ev >= 64){ App.post.fbZoom = (ev - 64) / 63; App.post.fbRot = 0; }
      else        { App.post.fbZoom = 0; App.post.fbRot = (64 - ev) / 64; }
      if(UI.refreshPost) UI.refreshPost();
      return ev;
    }
    if(pname && pname.indexOf('__post__')===0){
      const pk = pname.slice(8);
      const r = MIDI.postRange[pk];
      if(!r) return;
      const cur = App.post[pk];
      const centered = pk === 'sat' || pk === 'con';
      const displayCur = centered ? (cur - 1.0) : cur;
      const init = (r[1] !== r[0] && typeof displayCur === 'number' && isFinite(displayCur)) ? (displayCur - r[0]) / (r[1]-r[0]) * 127 : 0;
      const vv = this._continuousValue(pname, v, init, c);           // フェーダー以外は相対モードの仮想絶対値
      if(!fromLoad && this._pickupBlocks(pname, vv, r, c)) return;   // 取り込み待ち: 基準点を通るまで反映しない
      if(!this.relative && !fromLoad && this._reversalFade(pname, pk, vv, r)) return;   // 逆回転フェード(絶対モード時のみ)
      if(this._suppress[pname]) return;                             // フェード中は無視
      const displayValue = r[0] + (r[1]-r[0])*(vv/127);
      const targetVal = App.snapPost(pk, centered ? displayValue + 1.0 : displayValue); // 生値保存 (描画時に deadParam)
      // Param Fade 有効時は MIDI ノブの目標値へ拍数かけてランプ追従 (即時=従来どおりスナップ)。
      // ノブを回すたびに現在値→最新目標へ再フェード → 手の動きに ~拍数ぶん遅れて滑らかに追う。
      if(App._fadeBeatsLive() > 0) App.fadePostNum(pk, targetVal);
      else App.post[pk] = targetVal;
      if(UI.refreshPost) UI.refreshPost();
      return vv;
    }
    const slot = GL.slots[slotKey]; if(!slot) return;
    const p = slot.params.find(x=>x.name===pname); if(!p) return;
    let ev;
    if(p.type==='float'){
      const init = (p.max !== p.min && typeof p.value === 'number' && isFinite(p.value)) ? (p.value - p.min) / (p.max-p.min) * 127 : 0;
      ev = this._continuousValue(slotKey+':'+pname, v, init, c);
      p.value = p.min + (p.max-p.min)*(ev/127);
    }   // 生値保存 (描画時に deadParam)
    else if(p.type==='bool') p.value = v>63?1:0;
    UI.updateParamUI(slotKey, p);
    return ev;
  },
  // 起動時: キャッシュ済み CC 値を全マッピングへ適用 (連続値のみ。toggle 系はスキップ)
  applyAll(){
    for(const k in this.map){
      const m = this.map[k];
      if(!m || m.cc==null) continue;
      const vk = (m.type||'cc')+':'+m.cc;
      const v = this.values[vk];
      if(typeof v !== 'number') continue;
      const [slotKey, pname] = k.split(':');
      if(pname === '__post__boltz' || pname === '__post__pollockGloss' || pname === '__post__pollockMatt' || pname === '__post__pollockFlat') continue;  // 副作用(フレーム捕獲+フリーズ)があるため起動時に復元しない
      this._applyMapping(slotKey, pname, vk, v, true);
    }
  },
  _saveValues(){
    if(this._valSaveT) return; // 過剰書き込みを避けるデバウンス
    this._valSaveT = setTimeout(()=>{
      this._valSaveT = null;
      try{ localStorage.setItem('vj.midivals', JSON.stringify(this.values)); }catch(e){}
    }, 400);
  }
};

/* ===================================================================
   Recorder + Projector
=================================================================== */
const Record = {
  mr:null, chunks:[], stream:null, canvasStream:null, audioIncluded:false,
  _mb:null,   // WebCodecs (Mediabunny) 録画セッション

  start(){
    if(this.mr || this._mb) return false;
    // 既定: WebCodecs + Mediabunny で .mov (QuickTime) を書く。
    // MediaRecorder の mp4 muxer はプリセット切替時に H.264 ストリームを壊すバグがあり
    // (フレームは存在するのに切替時点以降デコード不能になる。再現条件は特定できず)、
    // タイムスタンプと多重化をアプリ管理に置き換えて構造的に回避する。
    if(typeof Mediabunny !== 'undefined' && typeof VideoEncoder !== 'undefined' && typeof GL !== 'undefined' && GL.canvas){
      try{ return this._startMB(); }
      catch(err){ console.warn('WebCodecs record init failed, fallback to MediaRecorder:', err); }
    }
    return this._startMR();
  },

  // ── WebCodecs + Mediabunny 経路 ──
  _startMB(){
    const canvas = GL.canvas;
    // 解像度連動 (~0.25 bit/px/frame): 720p ≈ 17 Mbps / 1080p ≈ 39 Mbps。下限 12 / 上限 45 Mbps。
    // 高すぎる要求 (旧 50〜200M) は AVE (HW エンコーダ) に巨大バッファを確保させ、メモリ逼迫時に
    // ドライバの DART/IOMMU 違反 (= カーネルパニック 2026-08-12 実測) を誘発した。実効ビットレートは
    // 元々 ~18M 程度で頭打ちだったため、この水準でも画質は実質変わらない。
    const vbps = Math.min(45_000_000, Math.max(12_000_000, Math.round(canvas.width * canvas.height * 60 * 0.25)));
    const output = new Mediabunny.Output({
      format: new Mediabunny.MovOutputFormat(),
      target: new Mediabunny.BufferTarget(),
    });
    const videoSource = new Mediabunny.CanvasSource(canvas, { codec: 'avc', bitrate: vbps });
    output.addVideoTrack(videoSource);
    let hasAudio = false;
    let audioSource = null;
    if(typeof Audio !== 'undefined' && Audio.mode === 'display' && Audio._stream){
      const at = Audio._stream.getAudioTracks().find(t => t && t.readyState === 'live' && t.enabled !== false);
      if(at){
        audioSource = new Mediabunny.MediaStreamAudioTrackSource(at, { codec: 'aac', bitrate: 256_000 });
        output.addAudioTrack(audioSource);
        hasAudio = true;
        audioSource.errorPromise.catch(err => {
          try{ Diag.log('record', 'audio source error: ' + (err && err.message || err)); }catch(_){}
          try{ toast('録画の音声にエラー (ここまでを保存します)', 5000); }catch(_){}
          if(this._mb) this.stop();
        });
      }
    }
    const mb = this._mb = {
      output, videoSource, audioSource,
      t0: 0, raf: 0, lastFrame: -1, frames: 0,
      stopping: false, started: false,
    };
    this.audioIncluded = hasAudio;
    this.ext = 'mov';
    this.mime = 'video/quicktime';
    // フレームポンプ: GL.frame が進んだフレームだけを、開始からの実時間 (単調増加) で追加
    const pump = ()=>{
      if(this._mb !== mb || mb.stopping) return;
      mb.raf = requestAnimationFrame(pump);
      if(!mb.started) return;
      if(GL.frame !== mb.lastFrame){
        mb.lastFrame = GL.frame;
        const t = (performance.now() - mb.t0) / 1000;
        mb.frames++;
        videoSource.add(t).catch(err => {
          if(mb.stopping || this._mb !== mb) return;
          try{ Diag.log('record', 'video encode error: ' + (err && err.message || err)); }catch(_){}
          try{ toast('録画エラー (ここまでを保存します)', 5000); }catch(_){}
          this.stop();
        });
      }
    };
    output.start().then(()=>{
      if(this._mb !== mb) return;
      mb.t0 = performance.now();
      mb.started = true;
    }).catch(err => {
      console.warn('WebCodecs record start failed:', err);
      if(this._mb === mb){
        this._mb = null;
        try{ toast('録画開始に失敗: ' + (err && err.message || err)); }catch(_){}
      }
    });
    pump();
    this._watchStartMB(mb);
    try{ Diag.log('record', 'start mov webcodecs avc vbps=' + Math.round(vbps/1e6) + 'M' + (hasAudio ? ' +aac' : '')); }catch(_){}
    toast(`録画開始 (mov${hasAudio ? '+audio' : ''})`);
    return true;
  },

  // WebCodecs 経路のウォッチドッグ: フレーム追加数を監視 (captureStream 版と同じ通知)
  _watchStartMB(mb){
    let last = 0;
    this._watchStall = 0;
    this._watchTimer = setInterval(()=>{
      const got = mb.frames - last; last = mb.frames;
      if(got === 0 && mb.started){
        this._watchStall += 2;
        if(this._watchStall === 4){
          const si = (k)=>{ try{ const s = GL.slots[k]; return k + '=' + (s.kind || '?'); }catch(e){ return k + '=?'; } };
          try{ Diag.log('record', 'frame supply stalled (' + si('A') + ' ' + si('B') + ')'); }catch(_){}
          try{ toast('録画へのフレーム供給が止まっています (Diag に記録)', 5000); }catch(_){}
          const rb = document.getElementById('btnRec'); if(rb) rb.classList.add('rec-stall');
        }
      } else if(got > 0){
        if(this._watchStall >= 4){
          try{ Diag.log('record', 'frame supply recovered'); }catch(_){}
          const rb = document.getElementById('btnRec'); if(rb) rb.classList.remove('rec-stall');
        }
        this._watchStall = 0;
      }
    }, 2000);
  },

  async _stopMB(){
    const mb = this._mb;
    if(!mb) return false;
    mb.stopping = true;
    this._mb = null;
    if(mb.raf) cancelAnimationFrame(mb.raf);
    this._watchStop();
    toast('録画停止 (書き出し中…)');
    try{
      await mb.output.finalize();
      const buf = mb.output.target.buffer;
      if(!buf || !buf.byteLength) throw new Error('empty output');
      const blob = new Blob([buf], { type: 'video/quicktime' });
      try{ Diag.log('record', 'stop bytes=' + blob.size + ' frames=' + mb.frames); }catch(_){}
      this._saveBlob(blob, `vj-${Date.now()}.mov`);
    }catch(err){
      console.warn('record finalize failed:', err);
      try{ Diag.log('record', 'finalize error: ' + (err && err.message || err)); }catch(_){}
      toast('録画の書き出しに失敗: ' + (err && err.message || err));
      return false;
    }
    return true;
  },

  // Blob をダウンロード保存 (Electron は will-download が Downloads へ直接保存する)
  _saveBlob(blob, fname){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname; a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    const ua = navigator.userAgent || '';
    if(/iPad|iPhone|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Mac/.test(ua) && !/Electron/i.test(ua))){
      // iOS Safari は a.download で自動保存できないので、新規タブで開いて「共有→保存」させる
      setTimeout(()=>{ window.open(url, '_blank'); }, 200);
      toast('iOS: 開いたページで [共有] → [ビデオを保存] で保存');
    }
    setTimeout(()=>URL.revokeObjectURL(url), 60000);
  },

  // ── 従来の MediaRecorder 経路 (WebCodecs 不可時のフォールバック) ──
  _startMR(){
    // captureStream(0) + requestFrame(): フレーム供給をアプリ側で明示制御する。
    // 自動キャプチャ (60) はタイムスタンプが重複・逆行することがあり、音声トラックと同時に
    // 記録すると Chromium の mp4 muxer が H.264 ストリームを壊す (実測)。
    this.canvasStream = GL.canvas.captureStream(0);
    this.stream = new MediaStream(this.canvasStream.getVideoTracks());
    this.audioIncluded = false;
    {
      const vt = this.canvasStream.getVideoTracks()[0];
      let lastFrame = -1;
      const pace = ()=>{
        if(!this.mr && this._paceArm !== true){ this._paceRaf = null; return; }
        if(typeof GL !== 'undefined' && GL.frame !== lastFrame){
          lastFrame = GL.frame;
          try{ if(vt.requestFrame) vt.requestFrame(); }catch(e){}
        }
        this._paceRaf = requestAnimationFrame(pace);
      };
      this._paceArm = true;   // mr 生成前から回し始めるためのアーム (開始失敗時は cleanup で止まる)
      pace();
    }
    // 画面音声: SCK loopback トラックを直接 muxer に渡すと、プリセット切替などで映像フレームが
    // 揺れた瞬間に mp4 muxer が H.264 ストリームを壊す (Chromium バグ。切替時点以降デコード不能になる。
    // 実測で再現・特定)。WebAudio (MediaStreamAudioDestinationNode) を経由してクロックを揃えた
    // トラックを渡すことで回避する。
    if(typeof Audio !== 'undefined' && Audio.mode === 'display' && Audio.ctx && Audio.src){
      try{
        this._audioDest = Audio.ctx.createMediaStreamDestination();
        Audio.src.connect(this._audioDest);
        for(const t of this._audioDest.stream.getAudioTracks()){
          this.stream.addTrack(t);
          this.audioIncluded = true;
        }
      }catch(e){ console.warn('record audio route failed:', e); }
    }
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Mac/.test(ua));
    // フォールバック (WebCodecs 不可時のみ)。MediaRecorder の mp4 muxer は
    // プリセット切替で H.264 を壊すため mp4/mov 系は使わず、実績のある webm に限定する。
    // (iOS Safari など webm 不可の環境のみ mp4 を最後の手段として許す)
    const hasAudio = this.stream.getAudioTracks().length > 0;
    const candidates = hasAudio ? [
      {mime:'video/webm;codecs=vp9,opus',             ext:'webm'},
      {mime:'video/webm;codecs=vp8,opus',             ext:'webm'},
      {mime:'video/webm',                             ext:'webm'},
      {mime:'video/mp4',                              ext:'mp4'},
    ] : [
      {mime:'video/webm;codecs=vp9',         ext:'webm'},
      {mime:'video/webm;codecs=vp8',         ext:'webm'},
      {mime:'video/webm',                    ext:'webm'},
      {mime:'video/mp4',                     ext:'mp4'},   // iOS Safari 17+ はこれのみ通る
    ];
    let chosen = null;
    for(const c of candidates){
      if(MediaRecorder.isTypeSupported(c.mime)){ chosen = c; break; }
    }
    if(!chosen) chosen = {mime:'', ext:'webm'};
    // 解像度連動 (~0.75 bit/px/frame): 1080p60 ≈ 93 Mbps。下限 50 / 上限 200 Mbps
    const px = (GL.canvas && GL.canvas.width ? GL.canvas.width * GL.canvas.height : 1920 * 1080);
    const vbps = Math.min(45_000_000, Math.max(12_000_000, Math.round(px * 60 * 0.25)));   // _startMB と同基準 (AVE 過負荷 = パニック対策)
    const opts = chosen.mime ? {mimeType:chosen.mime, videoBitsPerSecond:vbps} : {videoBitsPerSecond:vbps};
    if(hasAudio) opts.audioBitsPerSecond = 256_000;
    try{
      this.mr = new MediaRecorder(this.stream, opts);
    }catch(err){
      console.warn('MediaRecorder start failed:', err);
      this._cleanupStream();
      toast('録画開始に失敗: '+(err.message||err));
      return false;
    }
    this.chunks=[];
    this.ext = chosen.ext;
    this.mime = chosen.mime || 'video/webm';
    this.mr.ondataavailable = e=>{ if(e.data.size) this.chunks.push(e.data); };
    // 異常検知: エンコーダエラー / canvas トラック終了は録画が沈黙死する経路 → 記録して自動保存
    this.mr.addEventListener('error', (e)=>{
      const m = (e.error && e.error.message) || 'unknown';
      try{ Diag.log('record', 'MediaRecorder error: ' + m); }catch(_){}
      try{ toast('録画エラー: ' + m + ' (ここまでを保存します)', 5000); }catch(_){}
      if(this.mr) this.stop();
    });
    { const vt = this.stream.getVideoTracks()[0];
      if(vt) vt.onended = ()=>{
        try{ Diag.log('record', 'canvas video track ended'); }catch(_){}
        try{ toast('録画の映像トラックが終了しました (ここまでを保存します)', 5000); }catch(_){}
        if(this.mr) this.stop();
      };
    }
    this.mr.onstop = ()=>{
      try{
        const blob = new Blob(this.chunks, {type:this.mime});
        try{ Diag.log('record', 'stop bytes=' + blob.size + ' framesDelivered=' + (this._watchTotal || 0)); }catch(_){}
        const url = URL.createObjectURL(blob);
        const fname = `vj-${Date.now()}.${this.ext}`;
        const a = document.createElement('a');
        a.href = url; a.download = fname; a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        // iOS Safari は a.download で自動保存できないので、新規タブで開いて「共有→保存」させる
        if(isIOS){
          setTimeout(()=>{ window.open(url, '_blank'); }, 200);
          toast('iOS: 開いたページで [共有] → [ビデオを保存] で保存');
        }
        setTimeout(()=>URL.revokeObjectURL(url), 60000);
      }finally{
        this._cleanupStream();
      }
    };
    try{
      this.mr.start(1000);
    }catch(err){
      console.warn('MediaRecorder start failed:', err);
      this.mr = null;
      this._cleanupStream();
      toast('録画開始に失敗: '+(err.message||err));
      return false;
    }
    this._watchStart();
    try{ Diag.log('record', 'start ' + this.ext + ' ' + (chosen.mime || 'default') + ' vbps=' + Math.round(vbps/1e6) + 'M' + (hasAudio ? ' +audio' : '')); }catch(_){}
    toast(`録画開始 (${this.ext}${hasAudio ? '+audio' : ''})`);
    return true;
  },
  // ── 録画ウォッチドッグ ──
  //   録画中に「レコーダーへのフレーム供給」が止まると、mov は直前フレームで固まったまま
  //   時間だけが進む (プリセット切替後に映像が止まる報告の症状)。供給を rvfc で数え、
  //   4 秒連続ゼロで Diag へ状況を記録し、トーストと Record ボタンの点滅で知らせる。
  _watchStart(){
    if(!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return;
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true;
    try{ v.srcObject = new MediaStream(this.canvasStream.getVideoTracks()); v.play().catch(()=>{}); }catch(e){ return; }
    this._watchVideo = v;
    this._watchFrames = 0;
    this._watchTotal = 0;
    this._watchStall = 0;          // 連続供給ゼロの秒数
    const pump = ()=>{ this._watchFrames++; this._watchTotal++; if(this._watchVideo === v) v.requestVideoFrameCallback(pump); };
    v.requestVideoFrameCallback(pump);
    this._watchGLFrame = (typeof GL !== 'undefined') ? GL.frame : 0;
    this._watchTimer = setInterval(()=>{
      const glAdv = (typeof GL !== 'undefined') ? GL.frame - this._watchGLFrame : -1;
      if(typeof GL !== 'undefined') this._watchGLFrame = GL.frame;
      const got = this._watchFrames; this._watchFrames = 0;
      if(got === 0){
        this._watchStall += 2;
        if(this._watchStall === 4){    // 停止イベントにつき一度だけ記録
          const si = (k)=>{ try{ const s = GL.slots[k]; return k + '=' + (s.kind || '?'); }catch(e){ return k + '=?'; } };
          const msg = 'frame supply stalled (renderAdv=' + glAdv + '/2s, ' + si('A') + ' ' + si('B')
                    + ', cf=' + (typeof App !== 'undefined' && App.crossfade != null ? App.crossfade.toFixed(2) : '?') + ')';
          try{ Diag.log('record', msg); }catch(e){}
          try{ toast('録画へのフレーム供給が止まっています (Diag に記録)', 5000); }catch(e){}
          const rb = document.getElementById('btnRec'); if(rb) rb.classList.add('rec-stall');
        }
      } else {
        if(this._watchStall >= 4){
          try{ Diag.log('record', 'frame supply recovered after ~' + this._watchStall + 's'); }catch(e){}
          const rb = document.getElementById('btnRec'); if(rb) rb.classList.remove('rec-stall');
        }
        this._watchStall = 0;
      }
    }, 2000);
  },
  _watchStop(){
    if(this._watchTimer){ clearInterval(this._watchTimer); this._watchTimer = null; }
    if(this._watchVideo){ try{ this._watchVideo.srcObject = null; }catch(e){} this._watchVideo = null; }
    const rb = document.getElementById('btnRec'); if(rb) rb.classList.remove('rec-stall');
  },
  _cleanupStream(){
    this._watchStop();
    this._paceArm = false;
    if(this._paceRaf){ cancelAnimationFrame(this._paceRaf); this._paceRaf = null; }
    if(this._audioDest){
      try{ if(typeof Audio !== 'undefined' && Audio.src) Audio.src.disconnect(this._audioDest); }catch(e){}
      try{ this._audioDest.stream.getTracks().forEach(t=>t.stop()); }catch(e){}
      this._audioDest = null;
    }
    if(this.canvasStream){
      try{ this.canvasStream.getTracks().forEach(t=>t.stop()); }catch(e){}
    }
    this.canvasStream = null;
    this.stream = null;
    this.audioIncluded = false;
  },
  // 録画中か (WebCodecs / MediaRecorder どちらの経路でも)
  get active(){ return !!(this._mb || this.mr); },

  stop(){
    if(this._mb){ this._stopMB(); return true; }
    if(!this.mr) return false;
    const mr = this.mr;
    this.mr = null;
    mr.stop();
    toast('録画停止');
    return true;
  }
};

const Projector = {
  win:null,
  // 既存の Projector window があれば stream だけ差し替え、無ければ新規 open。
  //   メインコントローラをリロード後でも、Projector 窓が残っていれば再アタッチ可能。
  _attachStream(w){
    try{
      const v = w.document.getElementById('v');
      if(!v) return false;
      v.srcObject = GL.canvas.captureStream(60);
      // F キー = フルスクリーン切替。inline script 持ちの新規窓だけでなく、
      // 再アタッチした既存窓 (古い HTML のまま) にも必ずここで付け直す。
      try{
        if(!w.__vjFsBound){
          w.__vjFsBound = true;
          w.document.addEventListener('keydown', (e)=>{
            if(e.key === 'f' || e.key === 'F'){
              const d = w.document;
              if(d.fullscreenElement) d.exitFullscreen();
              else d.documentElement.requestFullscreen();
            }
          });
        }
      }catch(e){}
      this.win = w;
      try{ localStorage.setItem('vj.projector.open', '1'); }catch(e){}
      this._watchClose();   // 窓が閉じられたらフラグを消す (= 開いているときだけ Save)
      return true;
    }catch(e){ return false; }
  },
  open(){
    // 1) 同セッションで既に win を持っているなら再利用
    if(this.win && !this.win.closed){
      this.win.focus();
      this._attachStream(this.win);
      return;
    }
    // 2) 名前付きウィンドウ "vjproj" が残っていれば取得して再アタッチ (再書き込みしない)
    const existing = window.open('', 'vjproj');
    if(existing){
      // 既に video 要素があれば stream 差し替えだけで完了
      if(this._attachStream(existing)) return;
      // 空白 / 別ページなら HTML を書き出して初期化
      try{
        existing.document.open();
        existing.document.write(`<!doctype html><html><head><title>VJ Output</title>
          <style>html,body{margin:0;height:100%;background:#000;overflow:hidden;cursor:none}
            video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}</style>
          </head><body><video id=v autoplay muted playsinline></video>
          </body></html>`);
        existing.document.close();
        if(this._attachStream(existing)) return;
        existing.close();
      }catch(e){ try{ existing.close(); }catch(_){} }
    }
    // 3) 新規 open (ユーザー操作必須)
    const w = window.open('', 'vjproj', 'width=800,height=600');
    if(!w){ toast('Popup blocked'); return; }
    w.document.write(`<!doctype html><html><head><title>VJ Output</title>
      <style>html,body{margin:0;height:100%;background:#000;overflow:hidden;cursor:none}
        video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}</style>
      </head><body><video id=v autoplay muted playsinline></video>
      </body></html>`);
    w.document.close();
    this._attachStream(w);
  },
  close(){
    if(this.win) this.win.close();
    this.win = null;
    if(this._watch){ clearInterval(this._watch); this._watch = null; }
    try{ localStorage.removeItem('vj.projector.open'); }catch(e){}
  },
  // Projector 窓が(×ボタン等で)閉じられたらフラグを消す → 次回リロードで開き直さない
  _watchClose(){
    if(this._watch) clearInterval(this._watch);
    this._watch = setInterval(()=>{
      if(!this.win || this.win.closed){
        this.win = null;
        try{ localStorage.removeItem('vj.projector.open'); }catch(e){}
        if(this._watch){ clearInterval(this._watch); this._watch = null; }
      }
    }, 1500);
  },
  // メインリロード後の自動再アタッチ (フラグがあれば試行。失敗しても無音)
  tryReattach(){
    let flag = null;
    try{ flag = localStorage.getItem('vj.projector.open'); }catch(e){}
    if(flag !== '1') return false;
    try{
      const w = window.open('', 'vjproj');
      if(!w) return false;
      if(this._attachStream(w)) return true;
      // 既存ウィンドウじゃなく新規に空白で開いた = Projector は閉じられていた → 閉じてフラグも消す
      try{ w.close(); }catch(_){}
      try{ localStorage.removeItem('vj.projector.open'); }catch(e){}
    }catch(e){}
    return false;
  }
};

/* ===================================================================
   Preview  — small off-DOM WebGL2 canvas, per-preset shader cache,
              used to render thumbnails (static + on hover live).
=================================================================== */
// 共用ミニ Post FX シェーダ (Preview / Slot PiP の両方で使う)
//   主要な色補正・γ・ぼかし・アンシャープのみ。拍駆動 FX は静止プレビューで意味薄いため省略。
// 合成シェーダのフォールバック (最小): A/B クロスフェード + ブレンド + スロット可視 + 透過のみ。
// 巨大な本来の compositeProg が D3D11(ANGLE) 等でリンク失敗した時に使う。Post FX は無いが黒画面は防ぐ。
const COMPOSITE_FALLBACK_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uA, uB;
uniform float uMix, uShowA, uShowB;
uniform float uZoomA, uZoomB;
uniform vec2  uPanA, uPanB;
uniform int   uBlendMode;
vec2 _mir(vec2 p){ return 1.0 - abs(mod(p, 2.0) - 1.0); }
void main(){
  float za = (uZoomA==0.0)?1.0:uZoomA, zb = (uZoomB==0.0)?1.0:uZoomB;
  vec4 ca = texture(uA, _mir((vUv-0.5)/za + 0.5 - uPanA));
  vec4 cb = texture(uB, _mir((vUv-0.5)/zb + 0.5 - uPanB));
  float a = clamp(uShowA, 0.0, 1.0), b = clamp(uShowB, 0.0, 1.0);
  vec4 both;
  if(cb.a < 0.999){
    float la = clamp(cb.a, 0.0, 1.0) * uMix;
    both = vec4(mix(ca.rgb, cb.rgb, la), max(ca.a, la));
  } else {
    vec3 res;
    if(uBlendMode == 1) res = ca.rgb + cb.rgb;
    else if(uBlendMode == 2) res = ca.rgb * cb.rgb;
    else if(uBlendMode == 3) res = 1.0 - (1.0-ca.rgb)*(1.0-cb.rgb);
    else if(uBlendMode == 4) res = (dot(ca.rgb, vec3(0.299,0.587,0.114)) <= dot(cb.rgb, vec3(0.299,0.587,0.114))) ? ca.rgb : cb.rgb;
    else if(uBlendMode == 5) res = (dot(ca.rgb, vec3(0.299,0.587,0.114)) >= dot(cb.rgb, vec3(0.299,0.587,0.114))) ? ca.rgb : cb.rgb;
    else if(uBlendMode == 6) res = abs(ca.rgb - cb.rgb);
    else if(uBlendMode == 7) res = mix(2.0*ca.rgb*cb.rgb, 1.0 - 2.0*(1.0-ca.rgb)*(1.0-cb.rgb), step(vec3(0.5), ca.rgb));
    else res = mix(ca.rgb, cb.rgb, uMix);
    if(uBlendMode != 0) res = mix(ca.rgb, res, uMix);
    both = vec4(res, max(ca.a, cb.a));
  }
  float wBoth=a*b, wA=a*(1.0-b), wB=b*(1.0-a), wNone=(1.0-a)*(1.0-b);
  frag = both*wBoth + ca*wA + cb*wB + vec4(0.0,0.0,0.0,1.0)*wNone;
}`;

const MINI_FX_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex;
uniform vec2  uRes;
uniform float uFlipY;            // 0 = そのまま / 1 = Y 反転 (PiP 用)
uniform float uBri, uCon, uSat, uHue;
uniform float uGradMix; uniform vec3 uGradStops[8]; uniform float uGradPos[8]; uniform int uGradN;
uniform float uCosGrad;
uniform float uGamma;
uniform float uUnsharp, uUnsharpR;
uniform float uBlurAmt;
vec3 hueShift(vec3 c, float h){
  // YIQ 色空間で I/Q を回転(輝度保持・彩度を歪めない正しい色相回転。composite 側と同一)
  const mat3 toYIQ = mat3(0.299,0.596,0.211,  0.587,-0.274,-0.523,  0.114,-0.322,0.312);
  const mat3 toRGB = mat3(1.0,1.0,1.0,        0.956,-0.272,-1.106,  0.621,-0.647,1.703);
  vec3 yiq = toYIQ * c;
  float a = h * 6.2831853;
  float ca = cos(a), sa = sin(a);
  vec2 iq = yiq.yz;
  yiq.y = ca*iq.x - sa*iq.y;
  yiq.z = sa*iq.x + ca*iq.y;
  return toRGB * yiq;
}
vec2 _uv(vec2 v){ return vec2(v.x, mix(v.y, 1.0 - v.y, uFlipY)); }
vec3 sampleBlur(vec2 uv, float radPx){
  int N = int(min(16.0, 16.0 + uRes.x * 0.0));   // ループ展開抑止
  const float GA = 2.39996323;
  vec2 rad = radPx / uRes;
  float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453)*6.28318;
  vec3 acc = texture(uTex, _uv(uv)).rgb; float wsum = 1.0;
  for(int i=0;i<N;i++){
    float fi = (float(i)+0.5)/float(N);
    float r = sqrt(fi); float a = float(i)*GA + jit;
    vec2 off = vec2(cos(a),sin(a))*r*rad;
    float wt = exp(-3.0*fi);
    acc.r += texture(uTex, _uv(uv+off*0.45)).r*wt;
    acc.g += texture(uTex, _uv(uv+off)).g*wt;
    acc.b += texture(uTex, _uv(uv+off*1.75)).b*wt;
    wsum += wt;
  }
  return acc/wsum;
}
void main(){
  vec4 src0 = texture(uTex, _uv(vUv));
  vec3 col = src0.rgb;
  // 1) Blur
  if(uBlurAmt > 0.001){
    vec3 b = sampleBlur(vUv, uBlurAmt*50.0);
    float keepAmt = 1.0 - smoothstep(0.0, 0.65, uBlurAmt);
    col = mix(b, col, keepAmt);
  }
  // 2) Unsharp (色補正より先)。正=シャープ / 負=ぼかし。Gaussianディスクで外側へ連続減衰。
  if(abs(uUnsharp) > 0.0001){
    float r = max(0.5, uUnsharpR) * exp2(abs(uUnsharp) * 1.15);
    vec3 blur = sampleBlur(vUv, r);
    col = (uUnsharp > 0.0) ? max(col + uUnsharp*(col - blur), vec3(0.0))
                           : mix(col, blur, clamp(-uUnsharp, 0.0, 1.0));
  }
  // 3) Color
  if(abs(uBri) > 0.0001) col += uBri;
  if(abs(uCon - 1.0) > 0.001) col = (col-0.5)*uCon + 0.5;
  if(abs(uSat - 1.0) > 0.001){
    float L = dot(col, vec3(0.299,0.587,0.114));
    col = mix(vec3(L), col, uSat);
  }
  if(abs(uGradMix) > 0.0001){
    float L = dot(col, vec3(0.299,0.587,0.114));
    float t_g = clamp(uGradMix >= 0.0 ? L : 1.0 - L, 0.0, 1.0);
    vec3 mapped = uGradStops[0];
    for(int i = 0; i < 7; i++){
      if(i < uGradN - 1){
        float p0 = uGradPos[i], p1 = uGradPos[i+1];
        if(t_g >= p0){
          float f = clamp((t_g - p0) / max(p1 - p0, 0.0001), 0.0, 1.0);
          mapped = mix(uGradStops[i], uGradStops[i+1], f);
        }
      }
    }
    col = mix(col, mapped, abs(uGradMix));
  }
  if(abs(uHue) > 0.001) col = hueShift(col, uHue);
  // 4) Gamma
  col = pow(max(col, 0.0), vec3(1.0/uGamma));
  frag = vec4(col, src0.a);          // alpha は素通し (スロットプレビューの実 alpha を保つ)
}`;

// グラデーションストップ配列を uniform にアップロード (composite / MINI_FX 共通)
function _uploadGradStops(gl, U, p){
  const gA = p.gradA || [0.8,0.8,0.8], gB = p.gradB || [0.247,0,1];
  const stops = (p.gradStops && p.gradStops.length >= 2)
    ? p.gradStops.slice(0, 8)
    : [{t:0,rgb:gA},{t:1,rgb:gB}];
  const N = stops.length;
  const last = stops[N-1];
  const colData = new Float32Array(24), posData = new Float32Array(8);
  for(let i = 0; i < 8; i++){
    const s = i < N ? stops[i] : last;
    colData[i*3] = s.rgb[0]; colData[i*3+1] = s.rgb[1]; colData[i*3+2] = s.rgb[2];
    posData[i]   = i < N ? s.t : 1.0;
  }
  gl.uniform1i(U('uGradN'), N);
  gl.uniform3fv(U('uGradStops[0]'), colData);
  gl.uniform1fv(U('uGradPos[0]'), posData);
}

// 共用ヘルパ: MINI_FX_FS 用 uniform を App.post から流し込む
function _applyMiniFxUniforms(gl, prog, W, H, flipY, postOverride){
  const U = (n)=>gl.getUniformLocation(prog, n);
  const dz = (v)=> (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v;
  gl.uniform1i(U('uTex'), 0);
  gl.uniform2f(U('uRes'), W, H);
  gl.uniform1f(U('uFlipY'), flipY ? 1 : 0);
  const p = postOverride || ((typeof App !== 'undefined' && App.post) ? App.post : {});
  gl.uniform1f(U('uBri'),       dz(p.bri || 0));
  gl.uniform1f(U('uCon'),       dz(p.con != null ? p.con : 1));
  gl.uniform1f(U('uSat'),       dz(p.sat != null ? p.sat : 1));
  // Hue Shift: Grad Map ON = パレットの色相を回す(映像には掛けない) / OFF(通常色) = 映像へ掛ける。
  gl.uniform1f(U('uHue'),       dz(p.hueImage != null ? p.hueImage : ((typeof App !== 'undefined' && App.imageHue) ? App.imageHue(p) : (p.hueAuto || 0))));

  gl.uniform1f(U('uGradMix'),   dz(p.gradMix || 0));
  _uploadGradStops(gl, U, p);
  gl.uniform1f(U('uCosGrad'),   0.0);   // Cos Grad 廃止
  gl.uniform1f(U('uGamma'),     dz(p.gamma != null ? p.gamma : 1));
  gl.uniform1f(U('uUnsharp'),   dz(p.unsharp || 0));
  gl.uniform1f(U('uUnsharpR'),  dz(App.unsharpRadiusFromValue ? App.unsharpRadiusFromValue(p.unsharp) : (p.unsharpRadius != null ? p.unsharpRadius : 1.5)));
  gl.uniform1f(U('uBlurAmt'),   dz(p.slit2 || 0));
}

const Preview = {
  canvas:null, gl:null, vs:null, quadVAO:null, quadBuf:null,
  audioTex:null, blankTex:null,
  cache:new Map(),     // src → {prog, locs, params, format} | {err}
  staticQueue:[],      // [presetIdx] — to render once after build
  hoveredIdx:-1,       // -1 = none
  startTime:0,
  W:192, H:108,   // タイル表示は 113px 幅。軽量化のため実解像度は控えめ

  init(){
    this.canvas = document.createElement('canvas');
    this.canvas.width  = this.W;
    this.canvas.height = this.H;
    const gl = this.canvas.getContext('webgl2', {alpha:false, antialias:false, preserveDrawingBuffer:true, powerPreference:'high-performance'});
    if(!gl){ console.warn('Preview: WebGL2 not available'); return false; }
    this.gl = gl;
    this._parallelExt = gl.getExtension('KHR_parallel_shader_compile');   // サムネも非同期コンパイル (Windows/ANGLE 対策)
    this.startTime = now();

    // fullscreen triangle
    this.quadVAO = gl.createVertexArray();
    this.quadBuf = gl.createBuffer();
    gl.bindVertexArray(this.quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // vertex shader
    this.vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(this.vs, `#version 300 es
layout(location=0) in vec2 a;
out vec2 vUv;
void main(){ vUv = a*0.5+0.5; gl_Position = vec4(a,0.,1.); }`);
    gl.compileShader(this.vs);

    // blank 1×1 tex for unbound iChannel*
    this.blankTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.blankTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    // シェーダ描画を一旦受け取る FBO (FX パスのソースになる)
    this.srcFBO = (()=>{
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.W, this.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return {fbo:fb, tex};
    })();

    // Preview 用ミニ Post FX シェーダ (主要な色補正・γ・ぼかし・アンシャープのみ)。
    // 非同期リンク: ステータス照会をせず投げっぱなし。完了までサムネは FX なしで描く (Windows/ANGLE 対策)。
    {
      const fxFs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fxFs, MINI_FX_FS);
      gl.compileShader(fxFs);
      const p = gl.createProgram();
      gl.attachShader(p, this.vs);
      gl.attachShader(p, fxFs);
      gl.linkProgram(p);
      this.fxProg = null;
      this._fxPending = { prog: p, fs: fxFs };
    }

    // ホバー合成プレビュー用の A/B 合成シェーダ (本番の合成フォールバックを共用)
    {
      const cFs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(cFs, COMPOSITE_FALLBACK_FS);
      gl.compileShader(cFs);
      const p = gl.createProgram();
      gl.attachShader(p, this.vs);
      gl.attachShader(p, cFs);
      gl.linkProgram(p);
      this.compProg = null;
      this._compPending = { prog: p, fs: cFs };
    }

    return true;
  },
  _pollFx(){
    this._pollProg('_fxPending', 'fxProg', 'fx');
    this._pollProg('_compPending', 'compProg', 'composite');
  },
  _pollProg(pendKey, progKey, label){
    const r = this[pendKey]; if(!r) return;
    const gl = this.gl, ext = this._parallelExt;
    let done = true;
    if(ext){ try{ done = gl.getProgramParameter(r.prog, ext.COMPLETION_STATUS_KHR); }catch(e){ done = true; } }
    if(!done) return;
    this[pendKey] = null;
    if(gl.getProgramParameter(r.prog, gl.LINK_STATUS)){
      this[progKey] = r.prog;
    } else {
      console.warn('Preview ' + label + ' link:', gl.getProgramInfoLog(r.prog));
      try{ gl.deleteProgram(r.prog); }catch(e){}
    }
    try{ gl.deleteShader(r.fs); }catch(e){}
  },

  // FX パス: srcFBO のテクスチャに「色調補正だけ」(Bri/Con/Sat/Hue/Grad/Gamma) を掛けて canvas に出力。
  // Unsharp / Blur 等の Post FX はサムネには掛けない (シェーダの素の絵が判別できるように)。
  _applyFX(post){
    const gl = this.gl;
    if(!this.fxProg) return false;
    gl.useProgram(this.fxProg);
    gl.bindVertexArray(this.quadVAO);
    gl.viewport(0, 0, this.W, this.H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcFBO.tex);
    const s0 = post || ((typeof App !== 'undefined' && App.post) ? App.post : {});
    const grade = { bri: s0.bri, con: s0.con, sat: s0.sat,
                    hue: s0.hue, hueAuto: s0.hueAuto, hueImage: s0.hueImage,
                    gradMix: s0.gradMix, gradStops: s0.gradStops, gradA: s0.gradA, gradB: s0.gradB,
                    gamma: s0.gamma };
    _applyMiniFxUniforms(gl, this.fxProg, this.W, this.H, false, grade);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    return true;
  },

  // 非同期コンパイル: ステータス照会をせず compile/link を投げっぱなしにし、完了後に確定する。
  // 同期照会は Windows/ANGLE では FXC の長時間コンパイルを GPU プロセス上で待つことになり、
  // サムネ生成のたびにプロセスが固まって context lost の原因になる。
  // 戻り値: 完了エントリ / {err} / {pending:true}(コンパイル中 → 呼び出し側が後で再試行)
  _pending: new Map(),
  _compile(src){
    if(this.cache.has(src)) return this.cache.get(src);
    if(this._pending.has(src)){
      this._pollPending();
      return this.cache.has(src) ? this.cache.get(src) : {pending:true};
    }
    const gl = this.gl;
    const pp = Shader.preprocess(src);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, pp.code);
    gl.compileShader(fs);
    const prog = gl.createProgram();
    gl.attachShader(prog, this.vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    this._pending.set(src, {fs, prog, pp});
    if(!this._parallelExt){   // 拡張なし(旧環境): 従来同様その場で確定(同期)
      this._pollPending(true);
      return this.cache.get(src) || {pending:true};
    }
    return {pending:true};
  },
  _pollPending(force){
    if(!this._pending.size) return;
    const gl = this.gl, ext = this._parallelExt;
    for(const [src, r] of [...this._pending]){
      let done = true;
      if(ext && !force){ try{ done = gl.getProgramParameter(r.prog, ext.COMPLETION_STATUS_KHR); }catch(e){ done = true; } }
      if(!done) continue;
      this._pending.delete(src);
      if(!gl.getProgramParameter(r.prog, gl.LINK_STATUS)){
        let log = '';
        try{ log = gl.getShaderParameter(r.fs, gl.COMPILE_STATUS) ? gl.getProgramInfoLog(r.prog) : gl.getShaderInfoLog(r.fs); }catch(e){}
        try{ gl.deleteShader(r.fs); gl.deleteProgram(r.prog); }catch(e){}
        this.cache.set(src, {err: log});
        continue;
      }
      gl.deleteShader(r.fs);
      const pp = r.pp, prog = r.prog;
      const locs = {};
      const names = ['iResolution','iTime','iTimeDelta','iFrame','iMouse','iDate','iSampleRate',
                     'iChannel0','iChannel1','iChannel2','iChannel3',
                     'iBPM','iBeat','iBeatPhase','iEnergy','iAttack','iAttackEnv','iCrossfade','iBeatMode','iPan','iZoom','uSlotIsA',
                     'time','mouse','resolution','backbuffer','beat','uCosGrad','iChannelResolution[0]'];
      for(const n of names) locs[n.replace('[0]','')] = gl.getUniformLocation(prog, n);
      const customLocs = {};
      for(const p of pp.params) customLocs[p.name] = gl.getUniformLocation(prog, p.name);
      this.cache.set(src, {prog, locs, customLocs, params: pp.params, format: pp.format});
    }
  },

  render(src, paramValues){
    if(!this.gl) return false;
    if(this._fxPending || this._compPending) this._pollFx();
    const e = this._compile(src);
    if(!e || e.err || e.pending) return false;   // pending = コンパイル中(呼び出し側が再試行)
    const gl = this.gl;
    // Visual タブのサムネ/ホバーは元シェーダの素の絵を出す (Grad Map / Hue 等の色補正は掛けない)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.W, this.H);
    this._drawShader(e, paramValues);
    return true;
  },
  // コンパイル済み 1 シェーダを現在の FBO/viewport へ描画 (FBO/FX/BLEND は呼び出し側が管理)
  _drawShader(e, paramValues){
    const gl = this.gl;
    gl.useProgram(e.prog);
    gl.bindVertexArray(this.quadVAO);
    // 通常はプレビュー独自の時計。合成プレビューでは本番と位相を合わせるため GL.clock を使う。
    const t = (this._timeOverride != null) ? this._timeOverride : (now() - this.startTime);
    const u = e.locs;
    if(u.iResolution) gl.uniform3f(u.iResolution, this.W, this.H, 1);
    if(u.iTime) gl.uniform1f(u.iTime, t);
    if(u.iTimeDelta) gl.uniform1f(u.iTimeDelta, 1/60);
    if(u.iFrame) gl.uniform1i(u.iFrame, Math.floor(t*60));
    if(u.iMouse) gl.uniform4f(u.iMouse, 0, 0, 0, 0);
    if(u.iSampleRate) gl.uniform1f(u.iSampleRate, 44100);
    if(u.iBPM) gl.uniform1f(u.iBPM, BPM.bpm);
    if(u.iBeat) gl.uniform1f(u.iBeat, BPM.beatCount());
    if(u.iBeatPhase) gl.uniform1f(u.iBeatPhase, BPM.beatPhase());
    if(u.iBeatMode) gl.uniform1i(u.iBeatMode, App.beatMode==='beat' ? 1 : 0);
    if(u.uSlotIsA) gl.uniform1f(u.uSlotIsA, this._slotIsA || 0);   // 既定 0 = 単体サムネは従来どおり
    if(u.iPan)  gl.uniform2f(u.iPan, 0, 0);
    if(u.iZoom) gl.uniform1f(u.iZoom, 1.0);
    if(u.iEnergy) gl.uniform1f(u.iEnergy, Audio.energy);
    if(u.iAttack) gl.uniform1f(u.iAttack, Audio.attack || 0);
    if(u.iAttackEnv) gl.uniform1f(u.iAttackEnv, Audio.attackEnv || 0);
    if(u.iCrossfade) gl.uniform1f(u.iCrossfade, 0);
    if(u.time) gl.uniform1f(u.time, t);
    if(u.resolution) gl.uniform2f(u.resolution, this.W, this.H);
    if(u.mouse) gl.uniform2f(u.mouse, 0.5, 0.5);
    if(u.beat) gl.uniform1f(u.beat, App.beatMode==='beat' ? (App.visualBeat ? App.visualBeat() : BPM.beatCount() * App.beatScale) : -1.0);
    // in-shader cosGrad は廃止。シェーダはグレースケール出力にし、Grad Map は sampleAB で全スロットに適用する。
    if(u.uCosGrad){ gl.uniform1f(u.uCosGrad, 0.0); }

    // blank channels
    for(let i=0;i<4;i++){
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.blankTex);
      if(u['iChannel'+i]) gl.uniform1i(u['iChannel'+i], i);
    }
    if(u.backbuffer){
      gl.activeTexture(gl.TEXTURE0 + 4);
      gl.bindTexture(gl.TEXTURE_2D, this.blankTex);
      gl.uniform1i(u.backbuffer, 4);
    }
    if(u.iChannelResolution){
      const r = new Float32Array(12);
      for(let i=0;i<4;i++){ r[i*3]=1; r[i*3+1]=1; r[i*3+2]=1; }
      gl.uniform3fv(u.iChannelResolution, r);
    }

    // custom @param uniforms — use saved values when available, else defaults
    for(const p of e.params){
      const loc = e.customLocs[p.name]; if(!loc) continue;
      let val = (paramValues && paramValues[p.name] !== undefined) ? paramValues[p.name] : p.value;
      if(p.type==='color') gl.uniform3f(loc, val[0], val[1], val[2]);
      else gl.uniform1f(loc, App.deadParam ? App.deadParam(val) : val);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  },
  // プリセット(Slot A+B クロスフェード + 色補正Post FX)を描画 → Preview.canvas。ホバープレビュー用(低fps)。
  renderPreset(state){
    if(this._fxPending || this._compPending) this._pollFx();
    if(!this.gl || !this.fxProg || !state || !state.slots) return false;
    const gl = this.gl;
    const isShader = (s)=> s && s.src && (!s.kind || s.kind === 'shader');
    const A = state.slots.A, B = state.slots.B;
    if(!isShader(A) && !isShader(B)) return false;     // 動画/manga 等はライブ不可
    const cf = (state.crossfade != null) ? state.crossfade : 1.0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.srcFBO.fbo);
    gl.viewport(0, 0, this.W, this.H);
    gl.disable(gl.BLEND);
    let drewB = false;
    if(isShader(B)){ const eB = this._compile(B.src); if(eB && !eB.err && !eB.pending){ this._drawShader(eB, B.params); drewB = true; } }
    if(isShader(A)){
      const eA = this._compile(A.src);
      if(eA && !eA.err && !eA.pending){
        if(drewB){                                     // 合成: A*(1-cf) + B*cf (定数αブレンド)
          gl.enable(gl.BLEND);
          gl.blendColor(0, 0, 0, 1.0 - cf);
          gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
        }
        this._drawShader(eA, A.params);
        gl.disable(gl.BLEND);
      } else if(!drewB){ return false; }
    }
    this._applyFX(state.post);                          // プリセットの色補正 Post FX
    return true;
  },

  drawTo(canvas2d){
    const ctx = canvas2d.getContext('2d');
    ctx.drawImage(this.canvas, 0, 0, canvas2d.width, canvas2d.height);
    this._markDrawn(canvas2d);
  },
  _markDrawn(canvas2d){
    canvas2d.__hasThumb = true;                       // 描画済み (Preset タブが流用)
    // remove placeholder once we've drawn
    const tile = canvas2d.parentElement;
    if(tile){
      const ph = tile.querySelector('.placeholder');
      if(ph) ph.remove();
    }
  },

  _mkTexFBO(w, h){
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {fbo:fb, tex};
  },

  // schedule static (one-shot) renders for all presets
  queueAll(){
    this.staticQueue = [];
    for(let i=0;i<PRESETS.length;i++) this.staticQueue.push(i);
  },

  // ライブ描画できるプリセット = フラグメントシェーダのみ (mode 系 / 動画 / 画像はプレースホルダのまま)
  _isLive(p){ return !!(p && p.src && (!p.kind || p.kind === 'shader')); },

  // called every frame from App.tick
  tick(){
    if(!this.gl) return;
    const grid = UI.thumbCanvases;
    if(!grid || grid.length===0) return;

    // hovered → シェーダ単体の素の絵をライブプレビュー
    //   (スロットへはめたときの合成結果は出さない = 元シェーダが判別できるように)
    if(this.hoveredIdx >= 0 && this.hoveredIdx < PRESETS.length){
      const p = PRESETS[this.hoveredIdx];
      if(!this._isLive(p)) return;
      const c = grid[this.hoveredIdx];
      if(this.render(p.src)){
        if(c) this.drawTo(c);
      }
      return;
    }


    // else process static queue (one per frame)
    while(this.staticQueue.length > 0){
      const idx = this.staticQueue.shift();
      if(idx >= PRESETS.length) continue;
      const p = PRESETS[idx];
      if(!this._isLive(p)) continue;
      if(!grid[idx]) continue;
      if(this.render(p.src)){
        this.drawTo(grid[idx]);
      } else if(this._pending && this._pending.has(p.src)){
        this.staticQueue.unshift(idx);   // 非同期コンパイル中 → 次フレーム再試行
      }
      return; // one per frame
    }
  }
};

/* ===================================================================
   ColorWheelPopup — iro.js を使ったポップアップカラーホイール
=================================================================== */
const ColorWheelPopup = {
  popEl:null, picker:null, onChange:null,
  _ensureEl(){
    if(this.popEl) return;
    const el = document.createElement('div');
    el.id = 'cw-pop';
    el.innerHTML = '<div class="cw-wheel"></div><div class="cw-hex"><span>#</span><input type="text" id="cw-hex-in" maxlength="7" spellcheck="false"></div>';
    document.body.appendChild(el);
    this.popEl = el;
    // 外側クリックで閉じる
    document.addEventListener('mousedown', (e)=>{
      if(!this.popEl.classList.contains('show')) return;
      if(this.popEl.contains(e.target) || (this._anchor && this._anchor.contains(e.target))) return;
      this.close();
    });
    document.addEventListener('keydown', (e)=>{
      if(e.key === 'Escape' && this.popEl.classList.contains('show')) this.close();
    });
  },
  open(anchor, hexInit, onChange){
    if(typeof iro === 'undefined'){ console.warn('iro.js not loaded'); return; }
    this._ensureEl();
    this._anchor = anchor;
    this.onChange = onChange;
    // 仮に anchor 直下に表示 → サイズ計測後、画面内に収まる位置へ調整 (コンテキストメニュー風)
    const r = anchor.getBoundingClientRect();
    this.popEl.style.left = (r.left - 6) + 'px';
    this.popEl.style.top  = (r.bottom + 6) + 'px';
    this.popEl.classList.add('show');
    // 次フレームで実寸を取って端からはみ出していたら反対側に寄せる
    requestAnimationFrame(()=>{
      const pr = this.popEl.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      let left = pr.left, top = pr.top;
      const PAD = 6;
      // 右からはみ出 → anchor の右端 - popup 幅 で右寄せ。それでも左に出るなら anchor の左に出す
      if(pr.right > vw - PAD){
        left = Math.max(PAD, r.right - pr.width);
      }
      if(left < PAD) left = PAD;
      // 下からはみ出 → anchor 上に出す
      if(pr.bottom > vh - PAD){
        top = Math.max(PAD, r.top - pr.height - 6);
      }
      if(top < PAD) top = PAD;
      this.popEl.style.left = left + 'px';
      this.popEl.style.top  = top + 'px';
    });
    // iro picker を毎回作り直し (color 同期のため簡素化)
    const wheelHost = this.popEl.querySelector('.cw-wheel');
    wheelHost.innerHTML = '';
    this.picker = new iro.ColorPicker(wheelHost, {
      width: 160,
      color: hexInit || '#ffffff',
      layout: [
        { component: iro.ui.Wheel },
        { component: iro.ui.Slider, options: { sliderType: 'value' } },
      ],
    });
    const hexIn = this.popEl.querySelector('#cw-hex-in');
    hexIn.value = (hexInit || '#ffffff').replace('#','');
    this.picker.on('color:change', (c)=>{
      hexIn.value = c.hexString.replace('#','');
      if(this.onChange) this.onChange(c.hexString);
    });
    // 1 文字ごとには反映しない: 入力中は何もせず、6 桁揃ったか blur/Enter で確定。
    const applyHex = ()=>{
      const clean = hexIn.value.replace(/[^0-9a-fA-F]/g,'').slice(0,6);
      if(clean.length !== 6) return;
      const v = '#' + clean;
      try{ this.picker.color.hexString = v; }catch(e){}
      if(this.onChange) this.onChange(v);
    };
    hexIn.addEventListener('input', ()=>{
      // 6 桁ちょうど揃った時だけ反映 (3桁→4桁→...→6桁 で確定)
      if(hexIn.value.replace(/[^0-9a-fA-F]/g,'').length === 6) applyHex();
    });
    hexIn.addEventListener('change', applyHex);
    hexIn.addEventListener('blur', applyHex);
    hexIn.addEventListener('keydown', e=>{ if(e.key === 'Enter'){ applyHex(); hexIn.blur(); } });
  },
  close(){
    if(this.popEl) this.popEl.classList.remove('show');
    this._anchor = null; this.onChange = null;
  },
};

/* ===================================================================
   Diag  — クラッシュ/エラー診断ログ (localStorage 永続化)
     - error / unhandledrejection / WebGL context lost を記録
     - メモリ(usedJSHeapSize)と FPS を 5 秒ごとにハートビート記録
     - クラッシュ後もリロードで残るので原因(特に OOM)を追跡できる
=================================================================== */
const Diag = {
  EV_KEY:'vj.diag.events', HB_KEY:'vj.diag.heartbeat',
  events:[], hb:[], _lastFrame:0, _lastT:0,
  init(){
    try{ this.events = JSON.parse(localStorage.getItem(this.EV_KEY)||'[]'); }catch(e){ this.events = []; }
    try{ this.hb = JSON.parse(localStorage.getItem(this.HB_KEY)||'[]'); }catch(e){ this.hb = []; }
    // 前回が clean shutdown でなければ異常終了の可能性を通知
    const last = this.events[this.events.length-1];
    if(last && last.type !== 'shutdown'){
      try{ if(typeof toast === 'function') toast('前回異常終了の可能性。Tempo→Diagnostics でログ確認', 4000); }catch(e){}
    }
    this.log('boot', (navigator.userAgent||'').slice(0,160));
    window.addEventListener('error', (e)=>{
      this.log('error', (e.message||'') + ' @ ' + (e.filename||'') + ':' + (e.lineno||0) + ':' + (e.colno||0));
    });
    window.addEventListener('unhandledrejection', (e)=>{
      const r = e.reason;
      this.log('reject', (r && (r.stack || r.message)) ? (r.stack || r.message) : String(r));
    });
    window.addEventListener('pagehide', ()=>{ this.log('shutdown', ''); });
    setInterval(()=>this._heartbeat(), 5000);
  },
  log(type, msg){
    const rec = { t:new Date().toISOString(), type, msg:String(msg).slice(0,500) };
    this.events.push(rec);
    while(this.events.length > 120) this.events.shift();
    try{ localStorage.setItem(this.EV_KEY, JSON.stringify(this.events)); }catch(e){}
    if(type==='error'||type==='reject'||type==='webgl') console.warn('[Diag]', type, msg);
    return rec;
  },
  _heartbeat(){
    let fps = 0;
    if(typeof GL !== 'undefined' && GL.frame != null){
      const t2 = performance.now();
      if(this._lastT) fps = Math.round((GL.frame - this._lastFrame) * 1000 / Math.max(1, t2 - this._lastT));
      this._lastFrame = GL.frame; this._lastT = t2;
    }
    let memMB = null;
    if(performance && performance.memory) memMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
    const rec = { t:new Date().toISOString(), fps, memMB,
      a:(typeof GL!=='undefined' && GL.slots && GL.slots.A) ? GL.slots.A.kind : '?',
      b:(typeof GL!=='undefined' && GL.slots && GL.slots.B) ? GL.slots.B.kind : '?' };
    this.hb.push(rec);
    while(this.hb.length > 90) this.hb.shift();
    try{ localStorage.setItem(this.HB_KEY, JSON.stringify(this.hb)); }catch(e){}
    const ds = (typeof $ === 'function') ? $('#diagStat') : null;
    if(ds) ds.textContent = (memMB!=null ? memMB+'MB ' : '') + fps + 'fps';
  },
  dump(){ console.log('=== Diag events ==='); console.table(this.events); console.log('=== Diag heartbeat ==='); console.table(this.hb); return { events:this.events, hb:this.hb }; },
  download(){
    const data = { ua:navigator.userAgent, when:new Date().toISOString(), events:this.events, hb:this.hb };
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'vj-diag.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  },
  clear(){ this.events = []; this.hb = []; try{ localStorage.removeItem(this.EV_KEY); localStorage.removeItem(this.HB_KEY); }catch(e){} },
};

/* ===================================================================
   App  — coordinator
=================================================================== */
const App = {
  activeSlot:'A',
  timeDir:1,       // 視覚の時間方向 (+1=順再生 / -1=逆再生)。カーソル←→で切替
  beatMode:'beat', // 'drone' | 'beat' — Layer 系エンジンの動き方
  crossfade:1,
  slotVisible:{A:true, B:true}, // 一時表示トグル。保存状態には含めない
  slotBOffsetBeats:0,   // B Offset: Slot B のシェーダ位相ずらし (拍)。同一シェーダの重ね掛け用
  blendMode:'mix', // 'mix' | 'add' | 'multiply' | 'screen' | 'darken' | 'lighten' | 'difference' | 'overlay'
  modeKinds:['none','layer','manga','video','aratanagara','slicer','cyberui','novel','inkelly','boltzmann','grayscott','pen','caverns','shelf','ribbon','photoplane','image','textdeform','ugomeki','spacetype','shredder'],
  modeStateKinds:['layer','manga','video','aratanagara','slicer','cyberui','novel','inkelly','boltzmann','grayscott','pen','caverns','shelf','ribbon','photoplane','image','textdeform','ugomeki','spacetype','shredder'],
  _presetDefaults:null,
  _factoryDefaults:null,
  // Blend 切替はプリセット扱い: 視覚トランジションを掛けてから切り替える
  setBlendMode(mode){
    if(!mode || mode === this.blendMode){ this.blendMode = mode || this.blendMode; return; }
    if(typeof GL !== 'undefined' && GL.startPresetTrans) GL.startPresetTrans(this.transBeats||0, this.transStyle||0);
    this.blendMode = mode;
    if(typeof UI !== 'undefined' && UI.refreshMix) UI.refreshMix();
    if(typeof MIDI !== 'undefined' && MIDI.refreshLeds) MIDI.refreshLeds();
  },
  blendModeIdx(){
    return {mix:0,add:1,multiply:2,screen:3,darken:4,lighten:5,difference:6,overlay:7}[this.blendMode] || 0;
  },
  autoCF:{on:false, beats:8, t0:0, fromA:true, mode:'crossfade', tail:null}, // mode: 'crossfade' | 'switch' / tail: {target, lastBeat} = OFF 後に 0/1 へ到達させる残り遷移
  transBeats: 1,   // 切替を N 拍かけてフェードする拍数 (0=即時 / 1 / 2 / 4 / 8)
  transStyle: 0,   // 切替演出: 0=crossfade 1=blackfade 2=addglow 3=wipeH 4=wipeV
  _transTo: null,  // フェード先スロット (完了時に activeSlot にする)
  // 切替の共通処理。表示中スロットを変えるときだけ、非表示スロットへ新内容を読み込み
  // N 拍でクロスフェード(ディゾルブ)。非表示スロットへの操作や 0 拍は即時。
  //   loadInto(slotKey) = 指定スロットへ内容を読み込む関数。
  _transition(loadInto, label, slotKey){
    const N = this.transBeats || 0;
    const k = slotKey || this.activeSlot;
    if(N <= 0){ loadInto(k); return; }
    // スロット内トランジション: いじったスロット自身が旧→新へ転換 (A→A')。B は巻き込まない。
    GL._snapSlot(k);
    loadInto(k);
    GL.slots[k]._tr = { on:true, t0:BPM.beatCount(), beats:N, seed: Math.random(), rt0: now(), rdur: Math.max(0.05, N*60/Math.max(20, BPM.bpm)) };
    toast(`${label} へ ${N} 拍でトランジション`);
  },
  // Visual タイルをスロットプレビューへドロップ: 指定スロットへ (トランジション付きで) ロードし操作対象に
  loadPresetInto(idx, slotKey){
    const p = PRESETS[idx]; if(!p) return;
    if(p.kind === 'none'){
      const N = this.transBeats || 0;
      if(N > 0 && typeof GL !== 'undefined' && GL.startPresetTrans) GL.startPresetTrans(N, this.transStyle||0);
      this.loadPreset(idx, slotKey);
    } else {
      this._transition((slot)=>this.loadPreset(idx, slot), p.name, slotKey);
    }
    if(this.activeSlot !== slotKey){
      this.activeSlot = slotKey;
      if(typeof UI !== 'undefined' && UI.refreshSlot) UI.refreshSlot();
      if(typeof MIDI !== 'undefined') MIDI.refreshLeds();
    }
    toast(`Slot ${slotKey} ← ${p.name}`);
  },
  transitionTo(idx){
    const k = this.activeSlot;
    // 同じスロットで同じシェーダを再クリック → 「なし(透明)」に戻す(トグル)
    if(typeof UI !== 'undefined' && UI.activePresetIdx && UI.activePresetIdx[k] === idx && idx !== 0){
      idx = 0;
    }
    const p = PRESETS[idx]; if(!p) return;
    // 「なし(透明)」へは per-slot トランジションだと新フレームが透明で旧フレームが即消えるため、
    // 現在の最終出力を退避して全画面クロスフェードで転換する。
    if(p.kind === 'none'){
      const N = this.transBeats || 0;
      if(N > 0 && typeof GL !== 'undefined' && GL.startPresetTrans) GL.startPresetTrans(N, this.transStyle||0);
      this.loadPreset(idx, k);
      return;
    }
    this._transition((slot)=>this.loadPreset(idx, slot), p.name);
  },

  _assetVersion(){
    if(this._assetVer) return this._assetVer;
    let v = '';
    try{
      const s = document.querySelector('script[src*="app.js"]');
      const u = s ? new URL(s.getAttribute('src'), location.href) : null;
      v = u ? (u.searchParams.get('v') || '') : '';
    }catch(e){}
    this._assetVer = v || 'dev';
    return this._assetVer;
  },
  _assetCacheName(){ return 'vj-assets-' + this._assetVersion(); },
  _canUseAssetCache(){
    try{ return !!window.caches && location.protocol !== 'file:'; }catch(e){ return false; }
  },
  _versionedAssetUrl(url){
    try{
      if(!url || /^(blob:|data:|mediastream:)/.test(url)) return url;
      const u = new URL(url, location.href);
      if(u.origin !== location.origin) return url;
      const v = this._assetVersion();
      if(v && !u.searchParams.has('v')) u.searchParams.set('v', v);
      return u.href;
    }catch(e){ return url; }
  },
  async cacheAsset(url){
    const reqUrl = this._versionedAssetUrl(url);
    if(!this._canUseAssetCache()){
      return fetch(reqUrl, {cache:'force-cache'});
    }
    let cache = null;
    try{
      cache = await caches.open(this._assetCacheName());
      const hit = await cache.match(reqUrl);
      if(hit) return hit.clone();
    }catch(e){}
    const res = await fetch(reqUrl, {cache:'force-cache'});
    if(cache && res && res.ok){
      try{ await cache.put(reqUrl, res.clone()); }catch(e){}
    }
    return res;
  },
  fullCacheEnabled:false,
  async cacheStaticLibraries(onProgress){
    const manifests = [
      ['images/manifest.json', 'images'],
      ['images/manga/manifest.json', 'images/manga'],
      ['images/photo/manifest.json', 'images/photo'],
      ['images/slicer/manifest.json', 'images/slicer'],
      ['images/fluid/manifest.json', 'images/fluid'],
    ];
    const urls = new Set([
      'images/etc/cd_bar_bottom.png', 'images/etc/cd_bar_left.png',
      'images/etc/cd_bar_right.png', 'images/etc/cd_emblem.png',
      'images/etc/cd_frame.png', 'images/etc/clock.png', 'images/etc/nn.png',
    ]);
    for(const [manifestUrl, dir] of manifests){
      try{
        const res = await this.cacheAsset(manifestUrl);
        if(!res || !res.ok) continue;
        const data = await res.json();
        const files = Array.isArray(data) ? data : (data.files || []);
        for(const file of files) urls.add(`${dir}/${file}`);
      }catch(e){ console.warn('asset manifest cache failed:', manifestUrl, e); }
    }
    const list = [...urls];
    let next = 0, done = 0;
    const worker = async ()=>{
      while(next < list.length){
        const url = list[next++];
        try{
          const res = await this.cacheAsset(url);
          if(!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 0}`);
        }catch(e){ console.warn('asset cache failed:', url, e); }
        done++;
        if(onProgress) onProgress(done, list.length, url);
      }
    };
    await Promise.all(Array.from({length:Math.min(6, list.length)}, worker));
    return {done, total:list.length};
  },
  async fetchTextCached(url){
    const res = await this.cacheAsset(url);
    if(!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 0} ${url}`);
    return res.text();
  },
  async cleanupAssetCaches(){
    if(!this._canUseAssetCache()) return;
    try{
      const keep = this._assetCacheName();
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => /^vj-assets-/.test(k) && k !== keep).map(k => caches.delete(k)));
    }catch(e){}
  },

  // 全体の再生速度倍率 (シェーダ time / 動画 playbackRate に乗算)
  speed:1.0,
  setSpeed(v){
    this.speed = clamp(v, 0.0, 4.0);
    if(UI && UI.refreshSpeed) UI.refreshSpeed();
  },

  // Audio Transport: 音 (Audio.hit / Audio.energy) で再生方向 (timeDir) と速度を制御。
  //   dirMode:   off / flip (アタックで反転) / flipAcc (アタック累積で反転) /
  //              revHit (音の間だけ逆) / fwdHit (通常は逆)
  //   speedMode: off / energy (音量→速度) / hit (アタックで加速) / duck (アタックでスロー)
  //   depth=速度変調の深さ / threshold=方向発火の閾値 (Audio.hit がこの値以上で発火)
  audioTime:{ dirMode:'off', speedMode:'off', depth:0.5, threshold:0.5 },
  audioTimeDefaults(){ return { dirMode:'off', speedMode:'off', depth:0.5, threshold:0.5 }; },
  _audioSpeedMul:1,   // 毎フレーム更新される速度倍率 (App.speed に乗算。GL.clockDt / 動画 playbackRate へ)
  _atHitOn:false,     // flip 用のエッジ検出 (発火中フラグ)
  updateAudioTransport(){
    const at = this.audioTime || (this.audioTime = this.audioTimeDefaults());
    const on = (typeof Audio !== 'undefined') && Audio.mode !== 'off' && Audio.analyser;
    const hit = on ? Math.max(0, Math.min(1, Audio.hit || 0)) : 0;
    const energy = on ? Math.max(0, Math.min(1, Audio.energy || 0)) : 0;
    const thr = Math.max(0.02, +at.threshold || 0);   // 0 だと常時発火になるので下限
    const hitOn = hit >= thr;
    if(at.dirMode === 'flip'){
      if(hitOn && !this._atHitOn) this.timeDir = ((this.timeDir || 1) > 0) ? -1 : 1;   // 立ち上がりで反転
    }else if(at.dirMode === 'flipAcc'){
      // アタック累積: hit を時間積分し、しきい値ぶん溜まったら反転してリセット。
      //   激しいパートほど頻繁に反転し、静かなパートではほとんど反転しない。
      //   threshold = 必要な累積量 (低いほどすぐ反転)
      const tnow = now();
      const dt = Math.min(0.1, Math.max(0, tnow - (this._atAccT || tnow)));
      this._atAccT = tnow;
      this._atAcc = (this._atAcc || 0) + Math.max(0, hit - 0.12) * dt;
      const need = 0.2 + thr * 3.8;
      if(this._atAcc >= need){
        this._atAcc = 0;
        this.timeDir = ((this.timeDir || 1) > 0) ? -1 : 1;
      }
    }else if(at.dirMode === 'revHit'){
      this.timeDir = hitOn ? -1 : 1;
    }else if(at.dirMode === 'fwdHit'){
      this.timeDir = hitOn ? 1 : -1;
    }
    this._atHitOn = hitOn;
    let mul = 1;
    const depth = Math.max(0, Math.min(1, at.depth != null ? +at.depth : 0.5));
    if(at.speedMode === 'energy'){
      // 音量→速度: energy 0.5 で等速、無音で ×1/(1+3d)、大音量で ×(1+3d)
      mul = Math.pow(1 + 3*depth, energy*2 - 1);
    }else if(at.speedMode === 'hit'){
      mul = 1 + 3*depth*hit;
    }else if(at.speedMode === 'duck'){
      mul = 1 - 0.95*depth*hit;
    }
    this._audioSpeedMul = mul;
  },
  // Direction 切替の共通口 (プルダウン / F キー)。off へ戻すとき逆再生に張り付かないよう順再生へ。
  setAudioDirMode(mode){
    const at = this.audioTime || (this.audioTime = this.audioTimeDefaults());
    at.dirMode = mode;
    this._atAcc = 0;
    if(mode === 'off'){ this.timeDir = 1; this._atHitOn = false; }
    if(typeof UI !== 'undefined' && UI.refreshAudioTransport) UI.refreshAudioTransport();
  },
  // F キー: flip → flipAcc → off の順で切替 (revHit / fwdHit 中は flip へ)
  cycleAudioDirMode(){
    const order = ['flip','flipAcc','off'];
    const at = this.audioTime || {};
    const next = order[(order.indexOf(at.dirMode) + 1) % order.length];
    this.setAudioDirMode(next);
    const sel = $('#atDirMode');
    const opt = sel && sel.querySelector('option[value="' + next + '"]');
    toast('Audio → Direction: ' + (opt ? opt.textContent : next));
  },

  // beat 速度倍率 (逆数〜整数倍。シェーダへ渡す beat に乗算)
  beatScale:1.0,
  _beatScaleOffset:0,
  beatScaleSteps:[1/16, 1/8, 1/4, 1/2, 1, 2, 4, 8, 16],
  visualBeat(srcBeat){
    const b = (typeof srcBeat === 'number') ? srcBeat : ((typeof BPM !== 'undefined' && BPM.beatCount) ? BPM.beatCount() : 0);
    const s = this._normalizeBeatScale ? this._normalizeBeatScale(this.beatScale) : (this.beatScale || 1);
    const off = Number.isFinite(this._beatScaleOffset) ? this._beatScaleOffset : 0;
    return b * s + off;
  },
  resetBeatScalePhase(){
    this._beatScaleOffset = 0;
    if(typeof GL !== 'undefined' && GL.slots){
      for(const k of ['A','B']){
        const slot = GL.slots[k];
        if(slot){
          slot._beat = (typeof BPM !== 'undefined' && BPM.beatCount) ? BPM.beatCount() : 0;
          slot._scaledBeat = this.visualBeat(slot._beat);
        }
      }
    }
  },
  _normalizeBeatScale(v){
    const steps = this.beatScaleSteps || [1];
    const n = Number(v);
    if(!Number.isFinite(n) || n <= 0) return 1.0;
    let best = steps[0], bd = Math.abs(n - best);
    for(const s of steps){
      const d = Math.abs(n - s);
      if(d < bd){ best = s; bd = d; }
    }
    return best;
  },
  setBeatScale(v, preservePhase=true){
    const next = this._normalizeBeatScale(v);
    const raw = (typeof BPM !== 'undefined' && BPM.beatCount) ? BPM.beatCount() : 0;
    const prevVisual = this.visualBeat(raw);
    this.beatScale = next;
    this._beatScaleOffset = preservePhase ? (prevVisual - raw * next) : 0;
    this.setSpeed(next); // beat ×A に合わせて全体 speed も連動 (0..4 にクランプ)
    return next;
  },
  stepBeatScale(dir){
    const steps = this.beatScaleSteps;
    let i = steps.indexOf(this._normalizeBeatScale(this.beatScale));
    if(i < 0) i = 4; // 1.0
    i = Math.max(0, Math.min(steps.length-1, i + dir));
    const s = this.setBeatScale(steps[i], true);
    toast('BEAT ×' + (s < 1 ? '1/' + Math.round(1/s) : s));
  },
  _lastBeatScaleTap:0,
  // 116/117 の超高速ダブルタップ (0.16秒以内) で標準ビート(×1)に戻す
  beatScaleTap(dir){
    const t = now();
    if(t - this._lastBeatScaleTap < 0.16){
      this._lastBeatScaleTap = 0;
      this.setBeatScale(1.0, true);
      toast('BEAT ×1 (reset)');
      return;
    }
    this._lastBeatScaleTap = t;
    this.stepBeatScale(dir);
  },
  toggleSlot(){
    this.activeSlot = this.activeSlot === 'A' ? 'B' : 'A';
    this.crossfade = this.activeSlot === 'A' ? 0 : 1;
    UI.refreshSlot();
    UI.refreshMix();
    if(typeof MIDI !== 'undefined') MIDI.refreshLeds();
  },
  setSlotVisible(slot, visible){
    if(slot !== 'A' && slot !== 'B') return;
    if(!this.slotVisible) this.slotVisible = {A:true, B:true};
    const next = !!visible;
    if((this.slotVisible[slot] !== false) === next) return;
    const beats = Math.max(0, Number(this.transBeats) || 0);
    if(beats > 0 && typeof GL !== 'undefined' && GL.startPresetTrans){
      GL.startPresetTrans(beats, this.transStyle || 0);
    }
    this.slotVisible[slot] = !!visible;
    if(typeof GL !== 'undefined' && GL._syncSlotVisibility) GL._syncSlotVisibility(slot);
    if(typeof UI !== 'undefined' && UI.refreshSlotVisibility) UI.refreshSlotVisibility();
    if(typeof MIDI !== 'undefined' && MIDI.refreshLeds) MIDI.refreshLeds();
  },
  slotVisibleAmount(slot){
    if(slot !== 'A' && slot !== 'B') return 1;
    return this.slotVisible && this.slotVisible[slot] === false ? 0 : 1;
  },
  toggleSlotVisible(slot){
    if(!this.slotVisible) this.slotVisible = {A:true, B:true};
    const visible = this.slotVisible[slot] !== false;
    this.setSlotVisible(slot, !visible);
    toast('Slot ' + slot + ': ' + (!visible ? 'ON' : 'OFF'));
  },
  // アクティブスロットを「なし(透明)」にする (Backspace)
  clearActiveSlot(){
    const ni = PRESETS.findIndex(p => p && p.kind === 'none');
    if(ni < 0) return;
    this.loadPreset(ni, this.activeSlot);
    toast('Slot ' + this.activeSlot + ' → なし(透明)');
  },
  handleVisualKey(key){
    const slot = (typeof GL !== 'undefined' && GL.slots) ? GL.slots[this.activeSlot] : null;
    const kind = slot && slot.kind;
    if(key === 'Enter'){
      if(kind === 'manga' && typeof Manga !== 'undefined'){
        if(!Manga.initialized && typeof GL !== 'undefined' && GL.gl) Manga.init(GL.gl);
        if(Manga.initialized && !Manga.isBursting()){
          if(Manga.startBurst()) toast('Manga burst');
        }
        return true;
      }
      return false;
    }
    if(key === 'Backspace'){
      if(kind === 'cyberui' && typeof CyberUI !== 'undefined' && CyberUI.P){
        CyberUI.P.bars = CyberUI.P.bars ? 0 : 1;
        if(typeof UI !== 'undefined' && UI.refreshCyberParams) UI.refreshCyberParams();
        toast('CYBER UI Bars: ' + (CyberUI.P.bars ? 'ON' : 'OFF'));
        return true;
      }
      if(kind === 'inkelly' && typeof Inkelly !== 'undefined' && Inkelly.P){
        Inkelly.P.black = !Inkelly.P.black;
        if(typeof UI !== 'undefined' && UI.refreshInkelly) UI.refreshInkelly();
        toast('INKELLY Black: ' + (Inkelly.P.black ? 'ON' : 'OFF'));
        return true;
      }
      if(kind === 'shelf' && typeof Shelf !== 'undefined'){
        if(!Shelf.P) Shelf.P = {dark:false};
        Shelf.P.dark = !Shelf.P.dark;
        toast('SHELF Dark: ' + (Shelf.P.dark ? 'ON' : 'OFF'));
        return true;
      }
      if(kind === 'textdeform' && typeof TextDeform !== 'undefined' && TextDeform.P){
        TextDeform.setParams({ vertical: !TextDeform.P.vertical });   // 横組 ⇔ 縦組
        toast('TYPE 組方向: ' + (TextDeform.P.vertical ? '縦組' : '横組'));
        return true;
      }
    }
    return false;
  },
  // Slot A と B の中身(シェーダ/種別/パラメータ等)をまるごと入れ替える
  swapSlots(){
    if(typeof GL === 'undefined' || !GL.slots) return;
    const t = GL.slots.A; GL.slots.A = GL.slots.B; GL.slots.B = t;
    if(typeof UI !== 'undefined' && UI.activePresetIdx){
      const ti = UI.activePresetIdx.A; UI.activePresetIdx.A = UI.activePresetIdx.B; UI.activePresetIdx.B = ti;
    }
    // 種別エンジンの per-slot 状態も入れ替え
    if(typeof Movie !== 'undefined' && Movie._slots){
      const tv = Movie._slots.A; Movie._slots.A = Movie._slots.B; Movie._slots.B = tv;
    }
    if(UI.refreshAll) UI.refreshAll();
    if(typeof MIDI !== 'undefined') MIDI.refreshLeds();
    toast('Slot A ⇄ B 交換');
  },
  toggleBeatMode(){
    this.beatMode = this.beatMode === 'beat' ? 'drone' : 'beat';
    UI.refreshBeatMode();
    toast('Motion: ' + (this.beatMode === 'beat' ? 'BEAT' : 'DRONE'));
    if(typeof MIDI !== 'undefined') MIDI.refreshLeds();
  },

  audioDetectPresets:{
    manual:{ label:'Manual', gain:0.5, band:0.00, attack:0.50, ranges:null },
    kick:{ label:'Kick', gain:0.90, band:0.03, attack:0.82, ranges:[[45,160,1.45],[160,260,0.30]] },
    snare:{ label:'Snare / Clap', gain:0.85, band:0.22, attack:0.88, ranges:[[170,380,0.85],[1200,4600,1.10]] },
    hat:{ label:'Hi-Hat', gain:1.15, band:0.82, attack:0.95, ranges:[[4200,12500,1.25]] },
    drum:{ label:'Drum Mix', gain:0.80, band:0.12, attack:0.86, ranges:[[45,170,1.10],[180,420,0.75],[1800,9500,0.55]] },
    bass:{ label:'Bass', gain:0.70, band:0.04, attack:0.55, ranges:[[38,260,1.10]] },
    vocal:{ label:'Vocal / Mid', gain:0.90, band:0.34, attack:0.45, ranges:[[260,3600,0.95]] },
    house:{ label:'House / Techno', gain:0.82, band:0.10, attack:0.86, ranges:[[45,170,1.25],[4200,11500,0.45]] },
    hiphop:{ label:'Hip-Hop', gain:0.85, band:0.15, attack:0.84, ranges:[[45,190,1.05],[170,420,0.85],[700,3200,0.35]] },
    rock:{ label:'Rock', gain:0.85, band:0.20, attack:0.78, ranges:[[55,190,0.75],[170,480,1.05],[2500,9000,0.45]] },
  },
  audioDetectPreset(key){
    const k = key || 'manual';
    return this.audioDetectPresets[k] || this.audioDetectPresets.manual;
  },
  audioDetectRanges(key){
    const p = this.audioDetectPreset(key);
    return p ? p.ranges : null;
  },
  audioDetectInfo(key){
    const p = this.audioDetectPreset(key);
    if(!p || !p.ranges) return 'Manual: Band slider controls the detection range';
    return p.ranges.map(r => `${Math.round(r[0])}-${Math.round(r[1])}Hz x${(+r[2] || 1).toFixed(2)}`).join(' / ');
  },
  applyAudioDetectPreset(key){
    const k = key || 'manual';
    const p = this.audioDetectPreset(k);
    this.post.audioTarget = this.audioDetectPresets[k] ? k : 'manual';
    this.post.audioGain = p.gain;
    this.post.audioBand = p.band;
    this.post.audioAttack = p.attack;
    if(typeof Audio !== 'undefined' && Audio.resetDetection) Audio.resetDetection();
    if(typeof UI !== 'undefined' && UI.refreshPost) UI.refreshPost();
  },

  // 数値パラメータは絶対値 0.1 「未満」を 0 扱いにする (0.1 ちょうどは有効)。
  deadParam(v){
    // |v|<0.1 は 0(無効)。0.1 から連続的に立ち上げ、|v|=1 で元の 1 に戻る(0.1で急に効き始めない)。
    // |v|>1 の非正規化値(palette 等)は素通し。
    if(!(typeof v === 'number' && isFinite(v))) return v;
    const a = Math.abs(v);
    if(a < 0.1) return 0;
    if(a > 1) return v;
    // 0.1 が 0 に潰れないよう、立ち上がりの起点を 1 ステップ手前 (0.09) に置く
    return Math.sign(v) * (a - 0.09) / 0.91;
  },
  // Sensitivity (audioGain): スライダー位置 s∈[0,1] ↔ 実ゲイン。中央 0.5=ゲイン0.5、上ほど指数で強く。
  //   gain = 0.5 * 2^((s-0.5)*8)  →  s=0:0.031 / 0.5:0.5 / 1:8
  againFromSlider(s){ return 0.5 * Math.pow(2, (Math.max(0, Math.min(1, s)) - 0.5) * 8); },
  againToSlider(g){ return Math.max(0, Math.min(1, 0.5 + Math.log2(Math.max(1e-4, g) / 0.5) / 8)); },
  // Unsharp: スライダー位置 s∈[0,1](中央0.5=0) ↔ 双極指数値。正=シャープ / 負=ぼかし。
  //   value = sign(o) * (2^(|o|*K)-1)/(2^K-1) * MAX   (o=(s-0.5)*2, K=3, MAX=4)
  _USH_K:3, _USH_MAX:4,
  unsharpFromSlider(s){
    const o = (Math.max(0, Math.min(1, s)) - 0.5) * 2;
    const K = this._USH_K, MAX = this._USH_MAX;
    const mag = (Math.pow(2, Math.abs(o) * K) - 1) / (Math.pow(2, K) - 1) * MAX;
    return (o < 0 ? -1 : 1) * mag;
  },
  unsharpToSlider(u){
    const K = this._USH_K, MAX = this._USH_MAX;
    const sgn = u < 0 ? -1 : 1;
    const mag = Math.min(MAX, Math.abs(u || 0));
    const o = sgn * Math.log2(mag / MAX * (Math.pow(2, K) - 1) + 1) / K;
    return Math.max(0, Math.min(1, 0.5 + o / 2));
  },
  // Unsharp R は独立操作にせず、強度の絶対値に連動させる。0付近は狭く、強くするほど半径も広がる。
  unsharpRadiusFromValue(u){
    const mag = Math.max(0, Math.min(1, Math.abs(Number(u) || 0)));
    return 1.0 + 2.0 * Math.pow(mag, 1.35);
  },
  // パラメータ欄用: |v|<0.1 は実効 0 なので "0.0" と表示 (0.1 は有効なのでそのまま表示)。
  effDisplay(v, fmt){
    fmt = fmt || (x => (+x).toFixed(2));
    if(typeof v === 'number' && isFinite(v) && Math.abs(v) < 0.1) return fmt(0);
    return fmt(v);
  },
  // HUD 用: |v|<0.1 は実効 0 → その桁数で "0.00" 等と表示(生値の括弧併記はしない)。
  deadDisplay(v, fmt){
    fmt = fmt || (x => (+x).toFixed(2));
    if(typeof v === 'number' && isFinite(v) && Math.abs(v) < 0.1) return fmt(0);
    return fmt(v);
  },
  // ── Audio → Post FX: 音でエフェクト全般を揺らす ────────────────────────
  //   対象外: 色調補正 (Post FX 見出し配下) と Grad / Auto Map、および Audio FX 見出し配下
  //   (後者は元から音駆動なので二重に掛けない)。設定値・離散値も対象外。
  AUDIO_MOD_EXCLUDE: {
    inv:1, gamma:1, bri:1, con:1, sat:1, hue:1, hueRot:1, hueRotSpeed:1, hueAuto:1,
    palette:1, cosPalette:1, paletteAmt:1, gradMix:1, cosGrad:1, gradA:1, gradB:1, gradStops:1,
    gain:1, aScan:1, aRgb:1, aStrobe:1, aShock:1, aExplode:1,
    audioTarget:1, audioGain:1, audioBand:1, audioAttack:1, mir:1, fxaa:1,
    texNoiseScale:1, unsharpRadius:1, postScale:1, audioFx:1, audioFxAttack:1, audioFxRelease:1,
    // Material (質感): 音で暴れると絵肌が壊れるので対象外
    sdfChrome:1, bleed:1, impasto:1, chrome:1, rain:1, sketch:1,
    pollockGloss:1, pollockMatt:1, pollockFlat:1,
    // Texture: 同様に地の質感なので対象外
    scn:1, grn:1, texNoise:1, pos:1, blm:1, voxel:1,
    // Quality (画質補完) も量ではないので対象外
    clarity:1, denoise:1, deband:1, vibrance:1, unsharp:1,
  },
  // 音の包絡 0..1。他の Audio FX と同じ信号を使う:
  //   持続 = Audio.react (Audio Detect の対象/感度を反映済み。生の smoothEnergy は
  //          実音声で 0.05〜0.2 程度にしかならず反応が見えないため使わない)
  //   打点 = Audio.hit (AR エンベロープ)
  //   小音量でも動くよう緩いカーブを掛ける。
  _audioEnvRaw(){
    if(typeof Audio === 'undefined') return 0;
    const cont = Math.max(0, Math.min(1,
      (Audio.react != null && Audio.react > 0) ? Audio.react : (Audio.smoothEnergy || Audio.energy || 0) * 3.0));
    const h = Math.max(0, Math.min(1, Math.max(Audio.hit || 0, Audio.onset || 0)));
    const atk = Math.max(0, Math.min(1, (this.post && this.post.audioFxAttack != null) ? this.post.audioFxAttack : 0.6));
    // 打点は「加算」で跳ねさせる (クロスフェードだと持続に埋もれてアタックが分からない)。
    //   持続は Attack を上げても完全には消えない / 打点は sqrt カーブで小さい音でも大きく出る。
    const sustain = cont * (1 - atk * 0.7);
    const punch   = Math.sqrt(h) * (0.35 + atk * 1.15);
    return Math.max(0, Math.min(1, sustain + punch));
  },
  // 打点でパッと立ち上げ、ゆっくり戻す (アタックが 1〜2 フレームで消えると目で追えないため)。
  //   1 フレーム内で複数回呼ばれても減衰は 1 回だけ進める。
  _audioEnv(){
    const t = (typeof now === 'function') ? now() : performance.now()/1000;
    if(this._afeT != null && (t - this._afeT) < 0.002) return this._afeVal || 0;
    const raw = this._audioEnvRaw();
    const dt = (this._afeT != null) ? Math.min(0.1, t - this._afeT) : 0.016;
    this._afeT = t;
    let v = this._afeVal || 0;
    const rel = Math.max(0.05, (this.post && this.post.audioFxRelease != null) ? this.post.audioFxRelease : 0.28);
    if(raw >= v) v = raw;                          // アタックは即立ち上げ
    else v = Math.max(raw, v - dt / rel);          // rel 秒かけて戻す
    this._afeVal = v;
    return Math.max(0, Math.min(1, Math.pow(v, 0.65)));
  },
  effectivePost(src){
    const out = Object.assign({}, src || {});
    for(const k in out){
      if(typeof out[k] === 'number') out[k] = this.deadParam(out[k]);
    }
    const amt = Math.max(0, Math.min(1, (out.audioFx != null) ? out.audioFx : 0));
    if(amt > 0.001){
      const env = this._audioEnv();
      if(env > 0.0005){
        const R = (typeof MIDI !== 'undefined' && MIDI.postRange) ? MIDI.postRange : null;
        const EX = this.AUDIO_MOD_EXCLUDE;
        for(const k in out){
          if(EX[k] || typeof out[k] !== 'number') continue;
          const base = out[k];
          if(Math.abs(base) < 1e-6) continue;          // 切っている FX は音でも鳴らさない
          const r = R && R[k];
          const hi = r ? r[1] : 1, lo = r ? r[0] : 0;
          // 現在値を基準に、上へ余っている分だけ音で持ち上げる (下げない = 消えない)
          const head = Math.max(0, (base >= 0 ? hi - base : base - lo));
          out[k] = base + Math.sign(base || 1) * head * env * amt;
        }
      }
    }
    return out;
  },
  snapPost(key, v){
    // 生値をそのまま保存する (デッドゾーンは描画時に effectivePost/deadParam で適用)。
    // 保存時に 0 化すると「0.0(-0.03)」の生値表示ができなくなるため。
    return v;
  },

  // ── Param Fade: post 数値パラメータを拍数かけて補間 ─────────────
  //   プリセット適用 / Grad Preset 切替 / G・-・0 キーで発動。0 = 即時(off)。
  paramFadeBeats: 0.5,
  _paramFades: [],           // {key, from, to, t0, dur(実秒)}
  _gradFade: null,           // Grad 色替えの dip-to-zero: {fromMix, stops, targetMix, phase, t0, dur}
  // Hue Shift (手動スライダー / MIDI / プリセット適用 / Param Fade 補間 / 自動ローテート) の
  // 変化を検出して、Grad Map のバーと Preset 欄のパレット一覧を描き直す。
  // DOM 再構築があるので、実際に値が動いたときだけ・最大 20fps に間引く。
  _syncHuePreview(){
    const P = this.post; if(!P) return;
    const h = (P.hue || 0) + (P.hueAuto || 0);
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if(this._huePrev === undefined){ this._huePrev = h; return; }
    if(Math.abs(h - this._huePrev) < 0.0005) return;
    if(now - (this._huePrevT || 0) < 50) return;   // 20fps 上限
    this._huePrev = h; this._huePrevT = now;
    if(typeof UI === 'undefined') return;
    if(UI._gradEditor && UI._gradEditor.render) UI._gradEditor.render();
    if(UI._refreshGradList) UI._refreshGradList();
  },

  // paramFadeBeats < 0 (= Sync) のときは Transition の Beat 拍数 (transBeats) に追従する
  _fadeBeats(){
    const v = this.paramFadeBeats || 0;
    return (v < 0) ? (this.transBeats || 0) : v;
  },
  _fadeSec(){ return this._fadeBeats() * 60 / Math.max(20, (typeof BPM !== 'undefined' ? BPM.bpm : 120)); },
  // 適用範囲: 'all' = プリセット切替もライブ操作(MIDI/スライダー/キー)もフェード
  //           'preset' = プリセット/状態の切替だけフェードし、ライブ操作は即反映
  paramFadeScope: 'all',
  _fadeBeatsLive(){ return this.paramFadeScope === 'preset' ? 0 : this._fadeBeats(); },
  _fadeSecLive(){  return this.paramFadeScope === 'preset' ? 0 : this._fadeSec(); },
  fadePostNum(key, to, dur){
    if(dur == null) dur = this._fadeSec();
    const from = (typeof this.post[key] === 'number') ? this.post[key] : 0;
    if(!(dur > 0.01) || Math.abs(from - to) < 1e-6){ this.post[key] = to; return; }
    this._paramFades = this._paramFades.filter(f => f.key !== key);
    this._paramFades.push({key, from, to, t0: now(), dur});
  },
  // プリセットの post を適用: 数値はフェード / bool・配列・enum(palette 等)は即時
  // Param Fade で補間せず常に瞬時反映するキー。
  //   離散値(palette/cosPalette/mir)に加えて、Post FX 見出し配下の色調補正
  //   (色の基調そのものは切り替え時に一気に変わってほしい)と、
  //   Audio FX 見出し配下(音/拍に対して瞬時に反応する必要があり、フェードすると
  //   トリガーが鈍る)を対象外にする。
  POST_FADE_IMMEDIATE: {
    palette:1, cosPalette:1, mir:1,
    // Post FX
    inv:1, gamma:1, bri:1, con:1, sat:1, paletteAmt:1, gradMix:1, hue:1, hueRot:1,
    // Audio FX
    gain:1, aScan:1, aRgb:1, aStrobe:1, aShock:1, aExplode:1, mosaic:1, shake:1, slice:1, split:1, pixsort:1, rings:1,
    // Glitch FX のうち音/拍で発火するもの (uHit/uOnset 駆動)。
    // フェードで強度が遅れて上がるとトリガーの瞬発力が鈍るため瞬時反映。
    glass:1, twist:1, origami:1, kaiser:1, kaiserOld:1,
  },
  applyPostFaded(target){
    const dur = this._fadeSec();
    const IMMEDIATE = this.POST_FADE_IMMEDIATE;
    for(const k in target){
      const v = target[k];
      if(typeof v === 'number' && !IMMEDIATE[k] && typeof this.post[k] === 'number'){
        this.fadePostNum(k, v, dur);
      } else {
        this.post[k] = v;
      }
    }
  },
  // Grad Preset の色替え: いったん gradMix を 0 へ落とし、色を差し替えてから戻す
  // 実際に出力に効いているストップ (先読みプレビュー _gradPreview ではなく post の現在値)
  _curGradStops(){
    const s = this.post.gradStops;
    if(Array.isArray(s) && s.length >= 2) return s.map(o=>({t:o.t, rgb:o.rgb.slice()}));
    return [{t:0, rgb:(this.post.gradA || [0.8,0.8,0.8]).slice()},
            {t:1, rgb:(this.post.gradB || [0.247,0,1]).slice()}];
  },
  fadeGradTo(stops, targetMix){
    const dur = this._fadeSec();
    const cur = this.post.gradMix || 0;
    const ge = (typeof UI !== 'undefined') ? UI._gradEditor : null;
    if(!(dur > 0.01) || !ge){   // 即時
      this._gradPreview = null;
      if(ge) ge.set(stops, 0);
      this.post.gradMix = targetMix;
      if(typeof UI !== 'undefined' && UI.refreshPost) UI.refreshPost();
      return;
    }
    this._paramFades = this._paramFades.filter(f => f.key !== 'gradMix');
    if(Math.abs(cur) < 0.0001){   // 現在 OFF → 色を差し替えて 0→target のフェードだけ
      this._gradPreview = null;
      ge.set(stops, 0);
      this.post.gradMix = 0;
      this._gradFade = { from:null, to:null, ts:null, fromMix:0, targetMix, t0: now(), dur };
    } else {
      // 現在のグラデ → 次のグラデへ直接クロスフェード (一度 OFF にしてから掛け直さない)。
      // 両者のストップ位置の合併点で色を補間する (8 個を超えるときは等間隔 8 点で近似)。
      const from = this._curGradStops();
      let ts = [...new Set(from.map(s=>s.t).concat(stops.map(s=>s.t)).map(v=>Math.round(v*500)/500))].sort((a,b)=>a-b);
      if(ts.length > 8) ts = [0,1,2,3,4,5,6,7].map(i=>i/7);
      // 出力は補間で滑らかに変わるが、プレビュー(バー/ハンドル)は待たずに新グラデを見せる
      this._gradPreview = stops.map(s=>({t:s.t, rgb:s.rgb.slice()}));
      ge.render();
      this._gradFade = { from, to: stops.map(s=>({t:s.t, rgb:s.rgb.slice()})), ts,
                         fromMix: cur, targetMix, t0: now(), dur };
    }
  },
  _tickParamFades(){
    const t = now();
    let done = false;
    if(this._paramFades.length){
      this._paramFades = this._paramFades.filter(f => {
        let u = (t - f.t0) / f.dur;
        if(u >= 1){ this.post[f.key] = f.to; done = true; return false; }
        u = u*u*(3 - 2*u);   // smoothstep
        this.post[f.key] = f.from + (f.to - f.from) * u;
        return true;
      });
    }
    const g = this._gradFade;
    if(g){
      const u = (t - g.t0) / g.dur;
      if(u >= 1){
        const ge = (typeof UI !== 'undefined') ? UI._gradEditor : null;
        this._gradPreview = null;                   // 実際の値が追いついたので先読みプレビューを解除
        if(g.to && ge) ge.set(g.to, 0);             // 端点はストップをそのまま入れて誤差を残さない
        this.post.gradMix = g.targetMix;
        this._gradFade = null; done = true;
      } else {
        const s = u*u*(3 - 2*u);                    // smoothstep
        this.post.gradMix = g.fromMix + (g.targetMix - g.fromMix) * s;
        if(g.to && g.from && g.ts){                 // 現在のグラデ → 次のグラデを直接補間
          const ge = (typeof UI !== 'undefined') ? UI._gradEditor : null;
          if(ge){
            const st = g.ts.map(tt => {
              const a = ge.colorAt(g.from, tt), b = ge.colorAt(g.to, tt);
              return {t: tt, rgb: [a[0]+(b[0]-a[0])*s, a[1]+(b[1]-a[1])*s, a[2]+(b[2]-a[2])*s]};
            });
            this.post.gradStops = st;               // UI は _gradPreview を見るので DOM 更新は不要
            this.post.gradA = st[0].rgb.slice();
            this.post.gradB = st[st.length-1].rgb.slice();
          }
        }
      }
    }
    if(done && !this._paramFades.length && !this._gradFade){
      if(typeof UI !== 'undefined' && UI.refreshPost) UI.refreshPost();   // 完了時に一度だけ UI 同期
    }
  },

  // ── ユーザ操作の pan/zoom (cursor keys, < >) — スロット毎に保持 ──
  // App.userPan / userZoom は active slot の値を直接参照する getter
  _fallbackPan:{x:0, y:0},
  _fallbackZoom:1.0,
  get userPan(){
    const s = (typeof GL !== 'undefined' && GL.slots) ? GL.slots[this.activeSlot] : null;
    if(s){ if(!s.userPan) s.userPan = {x:0, y:0}; return s.userPan; }
    return this._fallbackPan;
  },
  get userZoom(){
    const s = (typeof GL !== 'undefined' && GL.slots) ? GL.slots[this.activeSlot] : null;
    if(s){ if(s.userZoom === undefined) s.userZoom = 1.0; return s.userZoom; }
    return this._fallbackZoom;
  },
  set userZoom(v){
    const s = (typeof GL !== 'undefined' && GL.slots) ? GL.slots[this.activeSlot] : null;
    if(s) s.userZoom = v;
    else this._fallbackZoom = v;
  },
  _panAcc:2.0,        // NDC/s²
  _panMax:5.0,         // NDC/s
  _zoomVel:1.5,        // 加算/秒 (linear)
  _panKey:{left:false, right:false, up:false, down:false},
  _panSpeed:{left:0, right:0, up:0, down:0},
  _panAngles:{left:Math.PI, right:0, up:Math.PI*0.5, down:-Math.PI*0.5},
  _zoomKey:{in:false, out:false},
  _lastPanPressT:0,
  _lastPanReleaseT:0,
  _lastTickT:0,

  onPanKeyDown(dir){
    if(!(dir in this._panKey)) return;
    const t = performance.now();
    const tsl = Math.min((t - this._lastPanReleaseT)/1000, (t - this._lastPanPressT)/1000);
    if(tsl > 0.5) this._panSpeed[dir] = 0;
    const base = {left:Math.PI, right:0, up:Math.PI*0.5, down:-Math.PI*0.5}[dir];
    const jitter = (Math.random()*2-1)*(15*Math.PI/180); // ±15°
    this._panAngles[dir] = base + jitter;
    this._panKey[dir] = true;
    this._lastPanPressT = t;
  },
  onPanKeyUp(dir){
    if(!(dir in this._panKey)) return;
    this._panKey[dir] = false;
    this._lastPanReleaseT = performance.now();
  },
  // 指定スロットのズームに倍率を掛ける (ホイールズームの共通口)
  zoomSlot(key, factor){
    const s = (typeof GL !== 'undefined' && GL.slots) ? GL.slots[key] : null;
    if(!s) return;
    if(s.userZoom === undefined) s.userZoom = 1.0;
    s.userZoom = Math.max(0.125, Math.min(8.0, (s.userZoom || 1) * factor));
  },
  onZoomKeyDown(dir){ if(dir in this._zoomKey) this._zoomKey[dir] = true; },
  onZoomKeyUp(dir){ if(dir in this._zoomKey) this._zoomKey[dir] = false; },
  _lastZoomTap:0,
  // , / . の超高速ダブルタップ (0.16秒以内) で拡大率をデフォルト(×1)へ戻す
  zoomTap(dir){
    const t = now();
    if(t - this._lastZoomTap < 0.16){
      this._lastZoomTap = 0;
      this._zoomKey.in = this._zoomKey.out = false;
      this._camTween = null;
      this.userZoom = 1.0;
      toast('Zoom ×1 (reset)');
      return;
    }
    this._lastZoomTap = t;
    this.onZoomKeyDown(dir);
  },

  _updateUserPanZoom(dt){
    const now = performance.now();
    // 手動操作があればリセットアニメをキャンセル
    const anyKey = this._panKey.left || this._panKey.right || this._panKey.up || this._panKey.down
                || this._zoomKey.in || this._zoomKey.out;
    if(anyKey) this._camTween = null;
    // リセットアニメ(1 beat)を進める
    if(this._camTween){
      const tw = this._camTween;
      tw.t += dt;
      let u = Math.min(tw.t / Math.max(0.001, tw.dur), 1.0);
      u = u*u*(3.0 - 2.0*u);                       // ease in-out
      this.userPan.x = tw.fx * (1.0 - u);
      this.userPan.y = tw.fy * (1.0 - u);
      this.userZoom  = tw.fz + (1.0 - tw.fz) * u;
      if(tw.t >= tw.dur){ this.userPan.x = 0; this.userPan.y = 0; this.userZoom = 1.0; this._camTween = null; }
      return;                                       // アニメ中は手動操作を無視
    }
    const tsl = Math.min((now - this._lastPanReleaseT)/1000, (now - this._lastPanPressT)/1000);
    for(const d of ['left','right','up','down']){
      if(this._panKey[d]){
        this._panSpeed[d] = Math.min(this._panSpeed[d] + this._panAcc * dt, this._panMax);
        const ang = this._panAngles[d];
        this.userPan.x += Math.cos(ang) * this._panSpeed[d] * dt;
        this.userPan.y += Math.sin(ang) * this._panSpeed[d] * dt;
      } else if(tsl > 0.5){
        this._panSpeed[d] = 0;
      }
    }
    if(this._zoomKey.in)  this.userZoom = Math.min(8.0, this.userZoom + this._zoomVel * dt);
    if(this._zoomKey.out) this.userZoom = Math.max(0.125, this.userZoom - this._zoomVel * dt);
  },

  // 自動色相ローテート: 速度を smooth-random (低周波) で正負振動させながら位相を累積
  _hueRotPhase:0,
  _hueRotDirT:0,
  _updateHueRot(dt){
    const spRaw = this.post && this.post.hueRotSpeed || 0;
    const sp = this.deadParam ? this.deadParam(spRaw) : spRaw;
    if(sp < 0.001){
      // 0 にしたら元の色相へ素早く減衰 (見た目はほぼ即時、ただしカクつき防止)
      if(Math.abs(this._hueRotPhase) > 0.0005){
        // 最短経路で 0 へ (0..1 ラップを考慮: 0.5 を境に左右どちらに行くか決定)
        const ph = this._hueRotPhase;
        const target = 0;
        let diff = target - ph;
        if(diff > 0.5) diff -= 1.0; else if(diff < -0.5) diff += 1.0;
        const step = Math.sign(diff) * Math.min(Math.abs(diff), dt * 4.0); // 1/4 秒で 1 周ぶん
        this._hueRotPhase = (ph + step + 1.0) % 1.0;
      } else {
        this._hueRotPhase = 0;
      }
      return;
    }
    // 0.4Hz 程度の三角合成 sin で方向 (符号) と速度倍率を作る
    this._hueRotDirT += dt;
    const t = this._hueRotDirT;
    const dir = Math.sin(t * 0.41) * 0.7 + Math.sin(t * 0.93 + 1.7) * 0.5 + Math.sin(t * 0.19 + 3.1) * 0.4;
    this._hueRotPhase = (this._hueRotPhase + dir * sp * dt) % 1.0;
    if(this._hueRotPhase < 0) this._hueRotPhase += 1.0;
  },

  _camTween: null,
  resetUserPanZoom(){
    // 1 beat かけて (0,0,zoom=1) へなめらかに戻す
    const dur = 60.0 / Math.max(1.0, (typeof BPM !== 'undefined' ? BPM.bpm : 120));
    this._camTween = { t: 0, dur: dur, fx: this.userPan.x, fy: this.userPan.y, fz: this.userZoom };
    for(const d in this._panSpeed) this._panSpeed[d] = 0;
  },
  // アクティブスロットが textdeform / ugomeki のとき、次のランダム md を読み込む。
  // 読み込んだ md 名を返す(対象エンジンでなければ null)。→ / c キーから呼ぶ。
  nextRandomMd(){
    const slot = (typeof GL !== 'undefined' && GL.slots) ? GL.slots[this.activeSlot] : null;
    const kind = slot && slot.kind;
    if(kind === 'textdeform' && typeof TextDeform !== 'undefined' && TextDeform.initialized){
      TextDeform.P.mdMode = 'random';
      if(TextDeform.loadRandom) TextDeform.loadRandom();
      if(UI && UI.refreshTextDeform) UI.refreshTextDeform();
      const i = TextDeform.currentMdIndex ? TextDeform.currentMdIndex() : -1;
      const pr = TextDeform.presets && TextDeform.presets[i];
      return (pr && pr.name) || 'random';
    }
    if(kind === 'ugomeki' && typeof Ugomeki !== 'undefined' && Ugomeki.initialized){
      if(Ugomeki.autoNextMd) Ugomeki.autoNextMd();
      if(UI && UI.refreshUgomeki) UI.refreshUgomeki();
      const i = Ugomeki.currentMdIndex ? Ugomeki.currentMdIndex() : -1;
      const pr = Ugomeki.mdSources && Ugomeki.mdSources[i];
      return (pr && pr.name) || 'random';
    }
    if(kind === 'spacetype' && typeof SpaceType !== 'undefined' && SpaceType.initialized){
      if(SpaceType.autoNextMd) SpaceType.autoNextMd(!SpaceType.P.cycleReload);   // 既定=見た目を維持してテキストだけ送る
      if(UI && UI.refreshSpaceType) UI.refreshSpaceType();
      const i = SpaceType.currentMdIndex ? SpaceType.currentMdIndex() : -1;
      const pr = SpaceType.mdSources && SpaceType.mdSources[i];
      return (pr && pr.name) || 'random';
    }
    return null;
  },
  gamma:1.0, // kept for backward-compat (mirrors post.gamma)
  // 9 = 通常色(Grad Map OFF / ホットキー 0)。Grad パレット UI のハイライトと旧保存の互換判定に使う。
  _activeGradPreset: 9,
  post:{
    hueLive:1,   // Hue ライブ適用世代のマーカー (postDefaults と同値を維持)
    gamma:1.0, sat:1.0, hue:0.0, bri:0.0, con:1.0,
    vig:0.0, chr:0.0, pix:0.0, mir:0,
    scn:0.0, grn:0.0, pos:0.0, blm:0.0, inv:0,
    twist:0.0, slice:0.0, split:0.0, mosaic:0.0, shake:0.0, mblur:0.0, gain:0.0, slit2:0.0, glass:0.0, outline:0.0, voxel:0.0, rain:0.0, sketch:0.0, pixsort:0.0, rings:0.0, pollockGloss:0.0, pollockMatt:0.0, pollockFlat:0.0, fxaa:true, boltz:0.0, aScan:0.0, aRgb:0.0, aStrobe:0.0, aShock:0.0, aExplode:0.0, slitScan:0.0, palette:8, paletteAmt:0,
    dither:0.0, candy:0.0, origami:0.0, kaiser:0.0, kaiserOld:0.0,
    sdfChrome:0.0, river:0.0, bleed:0.0, impasto:0.0, chrome:0.0, barcode:0.0,
    audioFx:0.0, audioFxAttack:0.6,   // Audio → Post FX 全般の変調量 / 打点(1)〜持続(0)
    audioFxRelease:0.28,              // 打点で跳ねたあと戻るまでの秒数
    fbAdd:0.0, fbMultiply:0.0, fbZoom:0.0, fbRot:0.0, glitchTrail:0.0,
    clarity:0.0, denoise:0.0, deband:0.0, vibrance:0.0,
    texNoise:0, texNoiseScale:8,
    unsharp:0, unsharpRadius:1.0,
    gradMix:0.0, gradA:[0.8,0.8,0.8], gradB:[0.247,0,1], gradStops:null, cosGrad:0.0, cosPalette:0,
    audioTarget:'manual', // Audio Detect の対象: manual / kick / snare / hat / drum / bass / vocal / genre presets
    audioGain:0.5, // 音声検知の感度(FFT入力倍率)。大きいほど小音量でも反応(energy/onset/hit/uFFT 全体に効く)
    audioBand:0.0, // 音域: 0=低音 → 1=高音 (H48 棘 / Audio FX hit が拾う帯域)
    audioAttack:0.5, // アタック: 0=持続(サステイン) / 1=トランジェント強調
    hueRotSpeed:0.0, // 自動色相ローテート速度 (0..2 cycles/sec、方向はランダムに揺れる)
  },
  // 外部 JSON (defaults.json / startup.json) 由来の post 値を有効レンジへ丸める。
  //   範囲外の値がそのまま入ると、UI を開くまで気付かないまま最大量の効果がかかり続けるため。
  //   (例: unsharp:1.5 が入っていて、レンジ [-1,1] の上限 1.0 = 最大シャープが常時適用されていた)
  sanitizePost(p){
    if(!p || typeof p !== 'object') return p;
    const R = (typeof MIDI !== 'undefined' && MIDI.postRange) ? MIDI.postRange : null;
    if(!R) return p;
    // レンジ外 (|v|>1) の Unsharp は UI では作れない値 = 旧デフォルト(半径 1.5 等)の焼き付き。
    // 下のレンジ丸めに任せると上限 1.0 = 最大シャープが毎回かかってしまうので、丸める前に 0 にする。
    if(typeof p.unsharp === 'number' && Math.abs(p.unsharp) > 1.0) p.unsharp = 0;
    for(const k in R){
      const v = p[k];
      if(typeof v !== 'number' || !isFinite(v)) continue;
      // sat / con は「保存値=乗数(中立1.0) / postRange=オフセット表示域(-1..1)」の二重規約。
      // オフセット域でクランプすると正のコントラスト(>1.0)が全部 1.0=中立へ潰れるので +1 して判定する。
      const off = (k === 'sat' || k === 'con') ? 1 : 0;
      const lo = R[k][0] + off, hi = R[k][1] + off;
      if(v < lo || v > hi){
        console.warn('[post] ' + k + '=' + v + ' はレンジ外 [' + lo + ',' + hi + '] → 丸めました');
        p[k] = Math.max(lo, Math.min(hi, v));
      }
    }
    // MIDI リレーティブノブのジッター (1/127 = 0.0079 の倍数の微小値) が保存データに
    // 焼き付いていることがある。実効的に見えない微小 Unsharp は 0 に丸めて
    // 「プリセットを呼ぶと Unsharp バッジが付く」のを防ぐ。
    if(typeof p.unsharp === 'number' && Math.abs(p.unsharp) < 0.1) p.unsharp = 0;
    if(typeof p.unsharp === 'number') p.unsharpRadius = this.unsharpRadiusFromValue(p.unsharp);
    return p;
  },
  migrateFeedbackPost(p){
    if(!p || typeof p !== 'object') return p;
    if(typeof p.fb === 'number'){
      if(typeof p.fbAdd !== 'number') p.fbAdd = Math.max(0,p.fb);
      if(typeof p.fbMultiply !== 'number') p.fbMultiply = Math.max(0,-p.fb);
      delete p.fb;
    }
    // inv: 旧仕様は真偽値のハード切替。0..1 の連続量(Param Fade 対応)へ移行。
    if(typeof p.inv === 'boolean') p.inv = p.inv ? 1 : 0;
    return p;
  },
  postDefaults(){ return {
    hueLive:1,   // Hue ライブ適用世代のマーカー (旧保存 = 焼き込み済みストップ との判別用)
    gamma:1.0, sat:1.0, hue:0.0, bri:0.0, con:1.0,
    vig:0.0, chr:0.0, pix:0.0, mir:0,
    scn:0.0, grn:0.0, pos:0.0, blm:0.0, inv:0,
    twist:0.0, slice:0.0, split:0.0, mosaic:0.0, shake:0.0, mblur:0.0, gain:0.0, slit2:0.0, glass:0.0, outline:0.0, voxel:0.0, rain:0.0, sketch:0.0, pixsort:0.0, rings:0.0, pollockGloss:0.0, pollockMatt:0.0, pollockFlat:0.0, fxaa:true, boltz:0.0, aScan:0.0, aRgb:0.0, aStrobe:0.0, aShock:0.0, aExplode:0.0, slitScan:0.0, palette:8, paletteAmt:0,
    dither:0.0, candy:0.0, origami:0.0, kaiser:0.0, kaiserOld:0.0,
    sdfChrome:0.0, river:0.0, bleed:0.0, impasto:0.0, chrome:0.0, barcode:0.0,
    audioFx:0.0, audioFxAttack:0.6,   // Audio → Post FX 全般の変調量 / 打点(1)〜持続(0)
    audioFxRelease:0.28,              // 打点で跳ねたあと戻るまでの秒数
    fbAdd:0.0, fbMultiply:0.0, fbZoom:0.0, fbRot:0.0, glitchTrail:0.0,
    clarity:0.0, denoise:0.0, deband:0.0, vibrance:0.0,
    texNoise:0, texNoiseScale:8,
    unsharp:0, unsharpRadius:1.0,
    gradMix:0.0, gradA:[0.8,0.8,0.8], gradB:[0.247,0,1], gradStops:null, cosGrad:0.0, cosPalette:0,
    audioTarget:'manual', // Audio Detect の対象: manual / kick / snare / hat / drum / bass / vocal / genre presets
    audioGain:0.5, // 音声検知の感度(FFT入力倍率)。大きいほど小音量でも反応(energy/onset/hit/uFFT 全体に効く)
    audioBand:0.0, // 音域: 0=低音 → 1=高音 (H48 棘 / Audio FX hit が拾う帯域)
    audioAttack:0.5, // アタック: 0=持続(サステイン) / 1=トランジェント強調
    hueRotSpeed:0.0, // 自動色相ローテート速度 (0..2 cycles/sec、方向はランダムに揺れる)
  };},
  mouse:{x:0,y:0,dx:0,dy:0, down:false},
  mouseCapture:false,   // M キーで iMouse 取得を ON/OFF(既定=拾わない)
  paused:false,

  async init(){
    // ?reset : 保存状態(localStorage)を全破棄してクリーン起動。フリーズ復旧・原因切り分け用。
    try{
      if(/[?&]reset\b/.test(location.search)){
        ['vj.state','vj.midivals','vj.midi','vj.safeMode','vj.ctxLoss','vj.lowRes'].forEach(k=>{ try{ localStorage.removeItem(k); }catch(_){} });
      }
    }catch(_){}
    const LOAD = (m, p)=>{ try{ window.__vjLoad && window.__vjLoad(m, p); }catch(_){} try{ GL._boot && GL._boot(m); }catch(_){} };
    LOAD('Initializing GPU…', 8);
    Diag.init();
    if(!GL.init()) return;
    // モバイル(特に Chrome iOS の WKWebView)はメモリ制限が厳しく、起動時の一括画像ロード
    // (Layer/Manga 合計 276 枚) で OOM クラッシュ ("このページを開けません") する。
    // → モバイルでは Layer/Manga の autoLoad をスキップし、モード選択時に遅延ロードする。
    this.isMobile = (navigator.maxTouchPoints > 1) || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    LOAD('Initializing engines…', 18);
    // Overlay エンジンを起動時に初期化 (Post FX 後段で重ね描き)
    if(typeof Overlay !== 'undefined') Overlay.init(GL.gl);
    // Layer エンジンを起動時に初期化 + images/ から自動ロード
    Layer.init(GL.gl);
    // Manga エンジン (panel collage, 画像ベース) + auto-load
    if(typeof Manga !== 'undefined') Manga.init(GL.gl);
    if(!this.isMobile){
      if(typeof Manga !== 'undefined'){
        Manga.autoLoadFromFolder('images/manga').then(n=>{
          if(n > 0){
            const ls = $('#mangaStatus');
            if(ls) ls.textContent = `${n} images auto-loaded from images/manga/`;
            console.log(`Manga: auto-loaded ${n} images`);
            if(GL.slots[App.activeSlot].kind === 'manga') UI.refreshManga();
          } else {
            const ls = $('#mangaStatus');
            if(ls) ls.textContent = 'images/manga/ 未検出';
          }
        }).catch(()=>{});
      }
      Layer.autoLoadFromFolder('images/manga').then(n=>{
        const ls = $('#layerStatus');
        if(n > 0){
          if(ls) ls.textContent = `${n} images auto-loaded from images/manga/`;
          console.log(`Layer: auto-loaded ${n} images from images/manga/`);
          if(GL.slots[App.activeSlot].kind === 'layer') UI.refreshLayerParams();
        }else{
          if(ls) ls.textContent = 'images/manga/ 未検出 — D&D or ボタンで読込';
        }
      }).catch(()=>{});
    } else {
      const lm = $('#mangaStatus'); if(lm) lm.textContent = 'mobile: 選択時に読込';
      const ll = $('#layerStatus'); if(ll) ll.textContent = 'mobile: 選択時に読込';
    }
    // Slicer (デスクトップのみ自動ロード)
    if(typeof Slicer !== 'undefined'){
      Slicer.init(GL.gl);
      if(!this.isMobile){
        Slicer.scanFolder('images/slicer').then(list=>{
          if(list.length > 0){
            Slicer.loadFromUrl(list[0].url).then(()=>{
              if(GL.slots[App.activeSlot].kind === 'slicer') UI.refreshSlicer && UI.refreshSlicer();
            });
          }
        });
      }
    }
    Preview.init();
    // Built-in な特殊プリセットを先頭に追加
    PRESETS.unshift({ name:'★ IMAGE (Folder Slideshow)', kind:'image', ch:[], src:'' });
    PRESETS.unshift({ name:'★ VIDEO (Loop Player)', kind:'video', ch:[], src:'' });
    PRESETS.unshift({ name:'(なし / 透明)', kind:'none', ch:[], src:'' });   // 一番左上: 無選択=透過
    LOAD('Loading settings…', 28);
    // サーバー共通の既定値 (defaults.json) を localStorage より先に適用
    await this.applyServerDefaults();
    // 保存デフォルト (vj.def.*) をサーバーから同期 (別端末でも同じデフォルトになる)
    await this._loadServerDefs();
    // プリセットで欠落している項目を戻す基準を、保存状態の復元前に確定する。
    this._capturePresetDefaults();
    // 前回起動でコンテキストロスト(GPU過負荷)が起きていたらセーフモードで起動
    try{ this.safeMode = (localStorage.getItem('vj.safeMode') === '1'); }catch(_){ this.safeMode = false; }
    UI.init();
    // 復元モード(既定ON)。OFFなら前回状態を復元せずクリーン起動。
    this._restoreOn = true;
    try{ this._restoreOn = (localStorage.getItem('vj.restore') !== '0'); }catch(_){}
    this.applyMixDefault();                    // Mix のデフォルト値をベースに適用(Save復元があれば上書きされる)
    this.applyTransDefault();                   // Transition のデフォルト値をベースに適用
    this.applyAudioTransportDefault();          // Audio Transport のデフォルト値をベースに適用
    // セーフモードでは前回状態を復元しない(重いレイマーチ slot が復元されて再びコンテキストロストするのを防ぐ)
    if(this._restoreOn && !this.safeMode) this.loadLocal();
    // 「デフォルト保存」した値は state 復元より優先する (state にも同じキーが載っているため、
    //  復元後に適用し直さないと保存が毎回上書きされ「保存できない」ように見える)。
    this.applyAudioTransportDefault();
    this.applyAudioDetectDefault();
    MIDI.init();
    if(this.safeMode){
      // 重い FX を確実に無効化 (復元/MIDI 値より優先)
      if(this.post){ this.post.voxel = 0; this.post.slit2 = 0; this.post.outline = 0; this.post.mblur = 0; }
      if(UI.refreshPost) UI.refreshPost();
      setTimeout(()=>{ try{ toast('セーフモードで起動中 (軽量プリセット + 重い FX 無効)。安定後に通常起動へ戻ります'); }catch(_){} }, 800);
    }
    // 15秒間ロスト無しで生き延びたらセーフモード解除 (重い FX は既に0で保存済みなので次回も安全)
    setTimeout(()=>{ try{ localStorage.removeItem('vj.ctxLoss'); localStorage.removeItem('vj.safeMode'); localStorage.removeItem('vj.lowRes'); App.safeMode = false; }catch(_){} }, 15000);
    // 外部シェーダ読込後、① 起動プリセット startup.json を自動適用 → ②無ければデフォルト Liquid
    // (どちらも「保存状態を復元しなかった場合」だけ。復元済みならユーザーの最新状態を優先)
    LOAD('Loading shaders…', 35);
    this.cleanupAssetCaches();
    this._shadersReadyPromise = this.loadExternalShaders();   // Load ボタンが完了待ちに使う
    // 何が起きても最終的にローディング画面は消す(ハング時の保険。準備完了で即消える)
    setTimeout(()=>{ try{ window.__vjLoadDone && window.__vjLoadDone(); }catch(_){} }, 15000);
    this._shadersReadyPromise.then(async ()=>{
      LOAD('Applying startup preset…', 96);
      let dv = PRESETS.findIndex(p => p && /liquid/i.test(p.name || ''));
      if(dv < 0) dv = PRESETS.findIndex(p => p && /vangogh/i.test(p.name || ''));  // フォールバック
      // セーフモード: startup / 復元を無視し、軽量プリセットを両スロットに強制ロード(再ロスト防止)
      if(this.safeMode){
        if(dv >= 0){ this.loadPreset(dv,'A'); this.loadPreset(dv,'B'); MIDI.applyAll(); }
        return;
      }
      const applied = await this._loadStartupConfig();   // startup.json (あれば適用)
      if(applied){ MIDI.applyAll(); return; }
      // startup.json 未適用・未復元時のデフォルトは両スロット「なし(透明)」。
      const ni = PRESETS.findIndex(p => p && p.kind === 'none');
      if(ni < 0) return;
      let changed = false;
      if(!GL.slots.A.src && GL.slots.A.kind === 'shader'){ this.loadPreset(ni,'A'); changed = true; }
      if(!GL.slots.B.src && GL.slots.B.kind === 'shader'){ this.loadPreset(ni,'B'); changed = true; }
      if(changed) MIDI.applyAll();
    }).finally(()=>{
      // ステージを描ける状態(本命 or フォールバックの合成が完成)になり、最初の描画フレームが出てから
      // ローディング画面を消す。本命の巨大合成(Windows/FXC で数十秒かかりうる)はバックグラウンドで
      // コンパイルを続け、完成したら自動で差し替わる。
      const waitReady = ()=>{
        try{ GL._pollInitProgs(); }catch(_){}   // tick(rAF) が止まっていても(バックグラウンド等)ここで自走ポーリング
        if(GL.stageReady && !GL.stageReady()){
          LOAD('Compiling GPU programs…', 98);
          setTimeout(waitReady, 120);
          return;
        }
        requestAnimationFrame(()=>requestAnimationFrame(()=>{ try{ window.__vjLoadDone && window.__vjLoadDone(); }catch(_){} }));
      };
      waitReady();
    });
    requestAnimationFrame(()=>this.tick());
    this.bindGlobal();
    this._autosaveStart();   // 状態の自動保存 (定期 + 終了時)
    // 1 フレーム待ってから (canvas が初回描画されてから) Projector 再アタッチを試す。
    // クラッシュ復旧のリロード直後は Projector 窓の再生成が間に合わないことがあるので、
    // 成功するまで数回リトライする (ライブ中に出力が黒いまま残るのを防ぐ)。
    {
      let tries = 0;
      const retry = ()=>{
        if(typeof Projector === 'undefined' || !Projector.tryReattach) return;
        let flag = null;
        try{ flag = localStorage.getItem('vj.projector.open'); }catch(e){}
        if(flag !== '1') return;                       // ユーザーが閉じた → 再接続しない
        if(Projector.tryReattach()){ toast('Projector 再接続'); return; }
        if(++tries < 8) setTimeout(retry, 700);
      };
      setTimeout(retry, 300);
    }
    toast('Ready');
  },

  // shaders/manifest.json を読んで各グループの .frag を結合し PRESETS に登録する
  // file:// から開いている場合は fetch がブロックされる可能性あり (要 http サーバ)
  async loadExternalShaders(){
    let manifest;
    try{
      manifest = JSON.parse(await this.fetchTextCached('shaders/manifest.json'));
    }catch(e){
      console.warn('shaders/manifest.json not found or unreadable:', e);
      if(location.protocol === 'file:'){
        toast('外部シェーダ未ロード: file:// では fetch 不可。ローカル http サーバで開いてください', 4000);
      }
      return;
    }
    const groups = manifest.groups || [];
    for(let gi=0; gi<groups.length; gi++){
      const g = groups[gi];
      try{
        try{ window.__vjLoad && window.__vjLoad(`Loading shaders… (${gi+1}/${groups.length}) ${g.name||''}`, 35 + Math.round((gi+1)/Math.max(groups.length,1)*55)); }catch(_){}
        if(g.type === 'perBg'){
          await this._loadPerBgGroup(g);
        }else{
          await this._loadCombinedGroup(g);
        }
      }catch(e){
        console.warn(`External shader load failed (${g.name}):`, e);
        toast(`${g.name} load failed: ${e.message}`, 3000);
        // 弱いネットワークでの取りこぼしはシェーダが丸ごと消えたように見える → 少し待って再試行
        try{
          await new Promise(r => setTimeout(r, 4000));
          if(g.type === 'perBg') await this._loadPerBgGroup(g);
          else await this._loadCombinedGroup(g);
          toast(`${g.name}: 再試行で読込`);
        }catch(e2){ console.warn(`retry failed (${g.name}):`, e2); }
      }
    }
  },

  // 旧来の挙動: ファイルを順に連結して 1 プリセット化
  async _loadCombinedGroup(g){
    const files = g.files || [];
    const texts = await Promise.all(files.map(f => this.fetchTextCached(`${g.dir}/${f}`)));
    let src = '';
    for(let i=0;i<files.length;i++){
      src += `// ---- ${g.dir}/${files[i]} ----\n`;
      src += texts[i];
      if(!texts[i].endsWith('\n')) src += '\n';
      src += '\n';
    }
    const idx = PRESETS.push({ name: `${PRESETS.length + 1} ${g.name}`, ch: [], src }) - 1;
    console.log(`✓ Combined ${files.length} chunks: ${g.name} → PRESETS[${idx}]`);
    UI.populatePresets();
    toast(`${g.name}: ${files.length} chunks loaded`);
  },

  // 新挙動: helpers を共通ヘッダとして使い、各 bgs エントリを単独シェーダ化
  async _loadPerBgGroup(g){
    const helpers = g.helpers || [];
    const bgs = g.bgs || [];

    // helpers を 1 度だけ取得
    const helperTexts = await Promise.all(helpers.map(f => this.fetchTextCached(`${g.dir}/${f}`)));
    let helperBlock = helpers.map((f,i) => `// ---- ${g.dir}/${f} ----\n${helperTexts[i]}`).join('\n');
    helperBlock = this._injectGradMap(helperBlock);   // cosGradColor を Grad Map(uGradStops)ベースに

    // 各 bg ごとに 1 プリセット生成
    for(const bg of bgs){
      try{
        const bgText = await this.fetchTextCached(`${g.dir}/${bg.file}`);
        const src = this._buildStandaloneBgShader(g, bg, helperBlock, bgText);
        PRESETS.push({ name: bg.name, ch: bg.ch || [], src });   // ch = manifest でのチャンネル指定 (画像パス等)
        console.log(`✓ Generated standalone preset: ${bg.name}`);
      }catch(e){
        console.warn(`Failed to load bg "${bg.name}":`, e);
      }
    }
    UI.populatePresets();
    toast(`${g.name}: ${bgs.length} bg shaders loaded`);
  },

  // 旧Cos Grad対応 shader を Grad Map(uGradStops)対応に: cosGradColor を uGradStops ベースに差し替え + uniform 注入
  _injectGradMap(src){
    if(!/cosGradColor/.test(src)) return src;
    let s = src;
    if(!/uniform\s+vec3\s+uGradStops/.test(s)) s = 'uniform vec3 uGradStops[8];\nuniform float uGradPos[8];\nuniform int uGradN;\n' + s;
    s = s.replace(/vec3\s+cosGradColor\s*\(\s*float\s+t\s*\)\s*\{[\s\S]*?return col;\s*\n\}/,
      'vec3 cosGradColor(float t){\n  float tt = clamp(t, 0.0, 1.0);\n  if(uGradN < 2) return vec3(tt);\n  vec3 mapped = uGradStops[0];\n  for(int i=0;i<7;i++){ if(i < uGradN-1){ float p0=uGradPos[i],p1=uGradPos[i+1]; if(tt>=p0){ float f=clamp((tt-p0)/max(p1-p0,0.0001),0.0,1.0); mapped=mix(uGradStops[i],uGradStops[i+1],f); } } }\n  return mapped;\n}');
    return s;
  },
  // 単独 bg シェーダ用ソース生成
  //  - GLSL Sandbox 流 (time/resolution は vj 側 Sandbox 互換で自動接続)
  //  - hinotori 独自 uniform は @param 化、または const 固定
  //  - beat = -1 で "free" モード強制 (time 駆動アニメ)
  _buildStandaloneBgShader(g, bg, helperBlock, bgText){
    // 内部で getBeat() を使っているシェーダは自前で beat 対応済みとみなしラップしない。
    // それ以外は beat モード時、拍ごとに time をランダムオフセット = フレームが「飛ぶ」。
    const usesBeat = /\bgetBeat\s*\(/.test(bgText);
    // bg 関数内の time 参照を _bgTime に置換し、外側で _bgTime を beat ジャンプ込みで設定。
    const patchedBgText = usesBeat ? bgText : bgText.replace(/\btime\b/g, '_bgTime');
    const beatTimeBlock = usesBeat ? '' : `
float _bgTime;
void _setBgTime(){
  if(beat >= 0.0){
    // 各拍ごとに大きなランダムオフセットを time に加算 → フレームが拍境界でジャンプ
    float blk = floor(beat);
    float ofs = fract(sin(blk*78.233 + 1.7)*4373.7) * 1000.0;
    _bgTime = time + ofs;
  } else {
    _bgTime = time;
  }
}`;
    const callSetBgTime = usesBeat ? '' : '_setBgTime();';
    return `// === auto-generated standalone bg shader ===
// source: ${g.dir}/${bg.file}  (func: ${bg.func})
// 各 uniform はスライダーから調整可。time/resolution は vj が自動供給。

// @param uRingZoom      10..200  = 58.0
// @param uHoldProb      0..1     = 0.18
// @param uFreeHoverGain 0..30    = 12.0
// @param uFreeDriftGain 0..1     = 0.10
// @param uFreeZoomAmp   0..1.5   = 0.50
// @param uFreeZoomRate  0..1     = 0.10
// @param uBPM           20..220  = 120
// @param uBgZoom        0.1..4   = 1.0

uniform float uRingZoom;
uniform float uHoldProb;
uniform float uFreeHoverGain;
uniform float uFreeDriftGain;
uniform float uFreeZoomAmp;
uniform float uFreeZoomRate;
uniform float uBPM;
uniform float uBgZoom;
uniform float uCosGrad;   // Post FX の Cos Grad 強度を bg 側に供給 (各シェーダ固有の彩色を ON)
uniform float uSlotIsA;   // 1=このシェーダは Slot A (ベース) / 0=Slot B 等。透過対応シェーダが背景色判定に使用
uniform float iAudio;     // 音域(Band)+アタック(Attack)で整形した音声リアクト値 0..1 (vj が供給)
uniform float iAudioSeed; // アタックを拾うたびに変わる乱数 0..1 (vj が供給。棘ごとの係数変化用)

// Sandbox-compat (vj が自動接続)
uniform float time;
uniform vec2  resolution;
uniform sampler2D uFFT;   // 音声スペクトル(512x2 LUMINANCE: row0=FFT) vj が接続
uniform sampler2D uBsodText;  // BSOD 実テキスト(1024x768 RGBA) vj が接続

// iPan / iZoom は HEADER で宣言済 (vj が cursor keys / < > から供給)

// hinotori uniform 名にエイリアス
#define bpm    uBPM
#define bgZoom (uBgZoom * iZoom)

// beat は vj 側の Motion Mode (drone/beat) で切替:
//   drone (App.beatMode='drone')→ -1.0 (= isFree=true、time 駆動)
//   beat  (App.beatMode='beat') → BPM.beatCount() (拍数、isFree=false)
uniform float beat;

// 一部 bg / helper が参照する未使用 uniform / 値を const で吸収
#define bgCamPx (iPan * resolution * 0.5)
const vec2  bgPhotoSize   = vec2(1024.0);
// bg 関数が出力する透明度 (既定 1.0=不透明)。透過対応シェーダだけが書き換える。
float bgAlpha = 1.0;
const float manualZoomOffset = 1.0;

// ---- helpers (constants/utils/beat/smooth_random/free_zoom/camera/palette/color_beat/free_motion/drone_seamless) ----
${helperBlock}

// ---- beat-mode time jump (内部で getBeat 未使用のシェーダ用) ----
${beatTimeBlock}

// ---- bg function: ${bg.func} ----
${patchedBgText}

// ---- entrypoint (Shadertoy-form; vj が main() にラップ) ----
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  ${callSetBgTime}
  vec3 col = ${bg.func}(fragCoord);
  fragColor = vec4(col, bgAlpha);
}
`;
  },

  bindGlobal(){
    window.addEventListener('keydown', e=>{
      // Shift 単押し検出: Shift の down〜up の間に他のキー/クリックが無ければ keyup で発火
      if(e.key === 'Shift'){ if(!e.repeat) this._shiftSolo = true; }
      else this._shiftSolo = false;
      // Tab: パネルのタブを Preset → Visual → Mix → … の順に送る (Shift+Tab で逆順)。
      // 他要素へのタブ送りは無効化。検索バーへのフォーカスは Enter に割り当てている。
      if(e.key === 'Tab'){
        e.preventDefault();
        const ae = document.activeElement;
        if(ae && (ae.id === 'presetSearch' || ae.id === 'visualSearch')) ae.blur();
        const tabs = [...document.querySelectorAll('.tab')].filter(t => t.offsetParent !== null);
        if(!tabs.length) return;
        let cur = tabs.findIndex(t => t.classList.contains('on'));
        if(cur < 0) cur = 0;
        const next = tabs[(cur + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length];
        if(next) next.click();
        return;
      }
      // フォーカス中のパラメータバーは左右キーで1 stepずつ調整する。
      // グローバルの逆再生/順再生ショートカットより優先し、既存UI処理へイベントを流す。
      const keyRange = e.target && e.target.tagName === 'INPUT' && e.target.type === 'range';
      if(keyRange && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.metaKey && !e.ctrlKey){
        e.preventDefault();
        try{
          if(e.key === 'ArrowRight') e.target.stepUp(1);
          else e.target.stepDown(1);
        }catch(_){}
        e.target.dispatchEvent(new Event('input', {bubbles:true}));
        e.target.dispatchEvent(new Event('change', {bubbles:true}));
        return;
      }
      // 検索バーからの脱出は isTextEntryTarget の early-return より前に処理する。
      // (後段だと Enter/Esc が捨てられ、Enter でフォーカスした後に抜けられず
      //  全ホットキーが文字入力になる = ライブ中の操作不能に直結していた)
      if(e.key === 'Enter' || e.key === 'Escape'){
        const ae = document.activeElement;
        if(ae && (ae.id === 'presetSearch' || ae.id === 'visualSearch')){
          e.preventDefault(); e.stopPropagation();
          try{ ae.blur(); }catch(_){}
          return;
        }
      }
      if(isTextEntryTarget(e.target)) return;
      // Undo / Redo (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Cmd/Ctrl+Y)
      if((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')){
        e.preventDefault();
        if(e.shiftKey) this.redo(); else this.undo();
        return;
      }
      if((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')){ e.preventDefault(); this.redo(); return; }
      // Enter: 表示中のパネルの検索バーへフォーカス (再度 Enter または Esc 相当で blur)。
      //   Manga のマシンガン配置 (handleVisualKey('Enter')) は、アクティブスロットが
      //   manga のときだけ従来どおり Enter で撃てるようにしておく。
      if(e.key === 'Enter' && !e.ctrlKey && !e.metaKey){
        e.preventDefault();
        const slot = (typeof GL !== 'undefined' && GL.slots) ? GL.slots[this.activeSlot] : null;
        if(slot && slot.kind === 'manga'){
          this.handleVisualKey('Enter');
          this._undoSchedule();
          return;
        }
        const ae = document.activeElement;
        if(ae && (ae.id === 'presetSearch' || ae.id === 'visualSearch')){ ae.blur(); return; }
        const pane = document.querySelector('.pane.on');
        let inp = null;
        if(pane){
          if(pane.dataset.pane === 'preset')      inp = document.getElementById('presetSearch');
          else if(pane.dataset.pane === 'shader') inp = document.getElementById('visualSearch');
        }
        if(!inp || inp.offsetParent === null){    // 非表示なら表示中の検索欄へ
          inp = ['presetSearch','visualSearch'].map(id=>document.getElementById(id)).find(el=>el && el.offsetParent !== null) || inp;
        }
        if(inp){ inp.focus(); try{ inp.select(); }catch(_){} }
        return;
      }
      if(e.key === 'Backspace' && !e.ctrlKey && !e.metaKey){
        e.preventDefault();
        if(!e.repeat){
          // Backspace = アクティブスロットを「なし(透明)」に / Shift+Backspace = 従来の Visual ごとの操作
          if(e.shiftKey) this.handleVisualKey('Backspace');
          else this.clearActiveSlot();
        }
        this._undoSchedule();
        return;
      }
      // カーソルキー: ↑↓ = beat ×倍率の上げ下げ / ←→ = visual 類の逆再生・順再生
      {
        if(e.key === 'ArrowUp'){   if(!e.repeat) this.stepBeatScale(1);  e.preventDefault(); return; }  // beat scale up
        if(e.key === 'ArrowDown'){ if(!e.repeat) this.stepBeatScale(-1); e.preventDefault(); return; }  // beat scale down
        // アクティブスロットが image のときは ←→ をそのスロットの画像送りに割り当てる (timeDir は変えない)
        if((e.key === 'ArrowLeft' || e.key === 'ArrowRight')
           && GL.slots[this.activeSlot] && GL.slots[this.activeSlot].kind === 'image'
           && typeof ImageMode !== 'undefined' && ImageMode.initialized){
          ImageMode.advance(e.key === 'ArrowLeft' ? -1 : 1, this.activeSlot);
          const info = ImageMode.currentInfo(this.activeSlot);
          if(info.n) toast('Image ' + (e.key === 'ArrowLeft' ? '◀ ' : '▶ ') + info.name + ' (' + (info.idx+1) + '/' + info.n + ')');
          e.preventDefault(); return;
        }
        if(e.key === 'ArrowLeft'){  if(!e.repeat){ this.timeDir = -1; toast('◀ Reverse'); }  e.preventDefault(); return; }  // 逆再生
        if(e.key === 'ArrowRight'){ if(!e.repeat){
          // 逆再生中はまず順再生へ復帰する。md 系スロット(textdeform/ugomeki/spacetype)が
          // アクティブだと nextRandomMd が常に成功して timeDir が戻せず、拍が減り続けて
          // 自動サイクルが止まったままになる罠があった。
          if((this.timeDir || 1) < 0){ this.timeDir = 1; toast('▶ Forward'); }
          else { const nm = this.nextRandomMd(); if(nm) toast('md: '+nm); else { this.timeDir = 1; toast('▶ Forward'); } }
        }  e.preventDefault(); return; }  // 逆再生中=順再生へ / md系=次のランダムmd / それ以外=順再生
        // < / > : ズーム (単独タップ=ズーム / 高速ダブルタップ=×1 リセット / 長押し=連続ズーム)
        if(e.code === 'Comma'){  if(e.repeat) this.onZoomKeyDown('out'); else this.zoomTap('out'); e.preventDefault(); return; }
        if(e.code === 'Period'){ if(e.repeat) this.onZoomKeyDown('in');  else this.zoomTap('in');  e.preventDefault(); return; }
      }
      const k = e.key.toLowerCase();
      if(k==='f' && e.shiftKey){ this.toggleFullscreen(); }                       // Shift+F = フルスクリーン
      else if(k==='f'){ if(!e.repeat) this.cycleAudioDirMode(); }                 // F = Audio Direction 切替 (flip → flipAcc → off)
      else if(k===' '){ e.preventDefault(); App._drawFrozen = !App._drawFrozen; toast('Draw: ' + (App._drawFrozen ? 'FREEZE (フレーム更新OFF)' : 'ON')); }   // Space = Draw フリーズ (シェーダ類の時間更新 ON/OFF)
      else if(k==='t'){ BPM.tap(); }
      // 録画 = Cmd/Ctrl+R / スクショ = Cmd/Ctrl+S
      else if(k==='r' && (e.metaKey||e.ctrlKey) && !e.altKey && !e.shiftKey){
        e.preventDefault();   // ブラウザのリロードを抑止
        if(!e.repeat){ const recBtn=document.getElementById('btnRec'); if(recBtn) recBtn.click(); }
      }
      // R = Post などのパラメータを保存値/初期値へリセット (スロットは保持。Esc のスロットクリアなし版)
      else if(k==='r' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey){
        if(!e.repeat) this.resetParamsAll();
      }
      else if(k==='s' && (e.metaKey||e.ctrlKey) && !e.altKey && !e.shiftKey){
        e.preventDefault();   // ブラウザの保存ダイアログを抑止
        if(!e.repeat) GL.screenshot();
      }
      else if(k==='d'){ App.toggleBeatMode(); }   // D = beat ↔ drone トグル
      else if(k==='['){ e.preventDefault(); if(!e.repeat) this.toggleSlotVisible('A'); }
      else if(k===']'){ e.preventDefault(); if(!e.repeat) this.toggleSlotVisible('B'); }
      else if(k==='\\'){ this.crossfade = this.crossfade<0.5?1:0; UI.refreshMix(); }
      else if(k==='a'){
        // A: Auto Map をアクティブスロットへ適用 (A なら A ← B の -1.0 / B なら B ← A の +1.0)。
        //    同じ向きで既に効いていればもう一度 A で 0 に戻す。
        const amt = (this.activeSlot === 'B') ? 1.0 : -1.0;
        this.post.palette = 8;
        const nextAmt = ((this.post.paletteAmt || 0) === amt) ? 0 : amt;
        // Auto Map はプリセット扱い: Preset only でも Param Fade を効かせる
        this.fadePostNum('paletteAmt', nextAmt, this._fadeSec());
        if(UI.refreshPost) UI.refreshPost();
        toast(nextAmt
          ? ('Auto Map ' + (amt > 0 ? '+1.0 (B ← A)' : '-1.0 (A ← B)'))
          : 'Auto Map OFF');
      }
      else if(k==='p'){ this.toggleMixPreviews(); }   // P: Grad / Blend プレビューの表示トグル (重いとき用)
      else if(e.key === 'Escape'){
        // Esc: 全スロットを「なし(透明)」にし、各パラメータを保存値/初期値へリセットする。
        // ColorWheelPopup / Help モーダル等が開いている間はそちらの Esc(閉じる)を優先しスキップ。
        if(typeof ColorWheelPopup !== 'undefined' && ColorWheelPopup.popEl && ColorWheelPopup.popEl.classList.contains('show')) return;
        { const hm = document.getElementById('helpModal'); if(hm && hm.style.display === 'flex') return; }
        // MIDI Learn 待ちの解除を優先。MIDI コンが繋がっていないと CC が来ず、
        // 学習待ちのまま抜けられなくなる (割当ボタンを覚えていないと解除不能)。
        if(typeof MIDI !== 'undefined' && MIDI.learn){
          MIDI.learn = null;
          if(typeof UI !== 'undefined' && UI.refreshAll) UI.refreshAll();
          toast('MIDI Learn 解除');
          return;
        }
        this.escResetAll();
      }
      else if(k==='o'){
        // Overlay ON/OFF トグル
        if(typeof Overlay !== 'undefined'){
          Overlay.P.enabled = !Overlay.P.enabled;
          if(!Overlay.P.enabled && Overlay.clear) Overlay.clear();
          const cb = document.getElementById('ovEnable'); if(cb) cb.checked = Overlay.P.enabled;
          if(typeof MIDI !== 'undefined') (MIDI.syncLeds ? MIDI.syncLeds() : MIDI.refreshLeds());
          toast('Overlay: ' + (Overlay.P.enabled ? 'ON' : 'OFF'));
        }
      }
      else if(k==='x'){
        if(e.shiftKey){ this.swapSlots(); }   // Shift+X: Slot A ⇄ B 交換(シェーダだけ入れ替え/値は維持)
        else { this.activeSlot = (this.activeSlot==='A') ? 'B' : 'A'; UI.refreshSlot(); toast('Slot '+this.activeSlot); }  // X: 選択スロット切替
      }
      else if(k==='m'){   // M: iMouse を拾う/拾わないをトグル(拾う間はアクティブスロットのみ反映)
        this.mouseCapture = !this.mouseCapture;
        toast('iMouse: ' + (this.mouseCapture ? 'ON (マウスで操作)' : 'OFF (凍結)'));
      }
      else if(k==='c'){
        // C: 描画系のリセットを集約 + 初期フレームに戻す(shader / mode / 動画)
        //    リセットの飛びを緩めるため、プリセット扱いで視覚トランジションを掛ける
        if(typeof GL !== 'undefined' && GL.startPresetTrans) GL.startPresetTrans(this.transBeats||0, this.transStyle||0);
        const parts = [];
        if(typeof Overlay !== 'undefined' && Overlay.initialized){ Overlay.clear(); parts.push('overlay'); }
        this.resetUserPanZoom(); parts.push('cam');
        if(typeof Manga !== 'undefined' && Manga.initialized){ Manga.clear(); parts.push('manga'); }
        // ── 初期フレームに戻す ──
        if(typeof GL !== 'undefined'){
          GL.clock = 0; GL.lastTime = 0;                                      // shader iTime / GL.clock 系 mode
          if(GL._resetSlotClock){ GL._resetSlotClock('A', 0); GL._resetSlotClock('B', 0); }
        }
        const tS = performance.now()/1000;
        [ typeof NovelTerminal!=='undefined'?NovelTerminal:0,
          typeof Caverns!=='undefined'?Caverns:0,
          typeof Shelf!=='undefined'?Shelf:0,
          typeof Ribbon!=='undefined'?Ribbon:0,
          typeof Inkelly!=='undefined'?Inkelly:0,
          typeof Layer!=='undefined'?Layer:0,
          typeof Manga!=='undefined'?Manga:0
        ].forEach(E=>{ if(E && typeof E.startTime==='number') E.startTime = tS; });   // 秒単位 startTime
        if(typeof CyberUI!=='undefined' && CyberUI.reset) CyberUI.reset(tS);
        if(typeof Slicer!=='undefined' && typeof Slicer.startTime==='number') Slicer.startTime = performance.now();  // slicer は ms
        if(typeof Aratanagara!=='undefined'){ Aratanagara._flowTime = 0; Aratanagara._ftPrev = undefined; }
        if(typeof Pen!=='undefined' && Pen.initialized){ Pen.clock = 0; if(Pen.strokes){ Pen.strokes.length = 0; for(let i=0;i<(Pen.P.count||0);i++) Pen.strokes.push(Pen.makeRandomStroke(-Pen._rand(0,1.5))); } }
        if(typeof Boltzmann!=='undefined' && Boltzmann.initialized) Boltzmann.seeded = false;   // 次フレームで再シード
        if(typeof GrayScott!=='undefined' && GrayScott.initialized && GrayScott.reseed) GrayScott.reseed();
        if(typeof Ugomeki!=='undefined' && Ugomeki.initialized && Ugomeki.reseed){ Ugomeki.reseed(); Ugomeki._typeT = 0; Ugomeki._mdStartBeat = null; }   // 文字ごとの揺れを再ランダム化＋書き出しを先頭へ
        if(typeof TextDeform!=='undefined' && TextDeform.initialized){   // 変形を全解除して組版し直し(初期フレーム)
          TextDeform._t = 0; TextDeform._bloomUntil = 0; TextDeform._nextBloomCheck = 0;
          TextDeform.setText(TextDeform.P.text);
        }
        if(typeof TDComp!=='undefined' && TDComp.get) TDComp.get().phase = 0;                     // Composition のループ位相を先頭へ
        if(typeof SpaceType!=='undefined' && SpaceType.initialized) SpaceType._cycleAcc = 0;      // 自動サイクルの経過を先頭へ(動き自体は GL.clock リセットで戻る)
        if(typeof Movie!=='undefined' && Movie._slots){ for(const kk of ['A','B']){ const vs=Movie._slots[kk]; if(vs && vs.videoEl){ try{ vs.videoEl.currentTime = 0; vs._revT = 0; }catch(e){} } } }   // 動画を先頭へ
        if(typeof ImageMode!=='undefined' && ImageMode.initialized){
          // C で次の画像へ 1 枚だけ送る (image スロットごと)。拍スケジュールはリセット後の拍から再計算
          // (クロックリセットで拍が跳ぶと、差分消化の連続送りで一周して見えるため)
          let advanced = false;
          for(const kk of ['A','B']){
            const s2 = GL.slots[kk];
            if(!s2 || s2.kind !== 'image') continue;
            const st2 = ImageMode._slot(kk);
            if(!st2.list.length) continue;
            ImageMode.advance(1, kk);
            st2.nextAdvanceBeat = null;
            advanced = true;
          }
          if(advanced) parts.push('image');
        }
        if(typeof GL !== 'undefined' && GL.forceRenderOnce) GL.forceRenderOnce();   // Pause / Draw Freeze 中でもリセット結果を即反映
        parts.push('frame');
        toast(parts.length ? `Reset: ${parts.join(' / ')}` : 'Nothing to reset');
      }
      else if(k==='-'){
        // -: Gradient Map を反転(+↔-)。OFF のときは反転(−)で ON (Param Fade 対応: 0 を通って反転)
        const cur = this.post.gradMix || 0;
        const wasOff = Math.abs(cur) <= 0.0001;
        const next = wasOff ? -1.0 : -cur;
        // OFF(通常色/_activeGradPreset===9) から ON にする場合は「通常色」状態を解除しておく (UI ハイライト用)。
        if(wasOff) this._activeGradPreset = -1;
        this.fadePostNum('gradMix', next);
        if(UI.refreshPost) UI.refreshPost();
        toast('Grad Map ' + (next < 0 ? '反転 (−)' : '通常 (+)'));
      }
      else if(k==='i'){
        // I: Invert トグル。瞬間切替にせず、Param Fade 拍数(0 なら即時)でなめらかに ON/OFF する。
        const next = ((this.post.inv || 0) > 0.5) ? 0 : 1;
        this.fadePostNum('inv', next, this._fadeSecLive());
        const cb = document.getElementById('pxInv'); if(cb) cb.checked = (next > 0.5);
        if(UI.refreshPost) UI.refreshPost();
        toast('Invert: ' + (next > 0.5 ? 'ON' : 'OFF') + (this._fadeSecLive() > 0.01 ? ' (fade)' : ''));
      }
      else if(k==='u'){
        // U: 色相反転(+180°)。hue は 1.0=180° なので +1.0。周期は 2.0(全周)。2回で元へ。
        // 瞬間切替にせず、Param Fade 拍数(0 なら即時)でなめらかに回す。
        let h = (this.post.hue || 0) + 1.0;
        h = ((h + 1.0) % 2.0 + 2.0) % 2.0 - 1.0;   // [-1,1) に折り返し
        this.fadePostNum('hue', h, this._fadeSecLive());
        if(UI.refreshPost) UI.refreshPost();
        toast('色相反転 (+180°)' + (this._fadeSecLive() > 0.01 ? ' (fade)' : ''));
      }
      else if(/^Digit[0-9]$/.test(e.code)){
        // 1〜9 / 0 = Grad Preset 切替 (1→0番目 .. 9→8番目 / 0→9番目)
        const d = e.code.slice(5);                          // '0'..'9'
        if(d === '0'){
          this.applyGradPreset(9);
        } else {
          this.applyGradPreset(parseInt(d, 10) - 1);
        }
      }
      else if((e.ctrlKey||e.metaKey) && k==='enter'){ UI.compileFromEditor(); }
      // 状態の手動保存は Cmd/Ctrl+Shift+S へ退避 (Cmd+S はスクリーンショットに割当)。
      // 3秒ごとの自動保存と Save ボタンもあるため、通常は使わなくてよい。
      else if((e.ctrlKey||e.metaKey) && e.shiftKey && k==='s'){ e.preventDefault(); this.saveLocal(); toast('Saved'); }
      this._undoSchedule();   // ホットキー操作後に状態をスナップショット(変化があれば履歴に積む)
    });

    // Undo 用: UI 操作(スライダー/セレクト/チェックボックス等)もスナップショット対象
    document.addEventListener('input',  ()=>{ this._undoSchedule(); }, true);
    document.addEventListener('change', ()=>{ this._undoSchedule(); }, true);
    // Undo 用: input/change を経由しない変更 (MIDI / プレビューバークリック / Param Fade 等) も
    // 拾えるよう、状態を監視して「変化が止まって1周期経ったら」1回だけ履歴に積む。
    // 動き続ける値 (Auto Crossfade 等) は安定しないので積まれない = スパムしない。
    setInterval(()=>{
      if(this._undoBusy || this._undoTimer) return;   // 明示的スケジュール進行中はそちらに任せる
      if((this._paramFades && this._paramFades.length) || this._gradFade) return;   // フェード中の中間値は記録しない
      const cur = this._undoSnap();
      if(cur === null) return;
      if(cur !== this._undoWatchSig){ this._undoWatchSig = cur; return; }   // まだ動いている → 安定待ち
      if(cur !== this._undoLast) this._undoCommit();
    }, 500);

    // keyup: 全シェーダ共通 pan/zoom + Manga burst
    window.addEventListener('keyup', e=>{
      // Shift 単押し = 旧 Backspace の Visual ごとの操作 (CYBER UI 背景切替 / INKELLY 黒背景 /
      // SHELF Dark / TYPE 組方向 など)。Shift+他キーの組み合わせでは発火しない。
      if(e.key === 'Shift'){
        const solo = this._shiftSolo; this._shiftSolo = false;
        if(solo && !isTextEntryTarget(e.target)){
          if(this.handleVisualKey('Backspace')) this._undoSchedule();
        }
      }
      if(typeof Manga !== 'undefined' && Manga.initialized && Manga.isBursting && Manga.isBursting()){
        if(e.key === 'Enter') Manga.stopBurst();
      }
      if(e.key === 'ArrowLeft')  this.onPanKeyUp('left');
      if(e.key === 'ArrowRight') this.onPanKeyUp('right');
      if(e.key === 'ArrowUp')    this.onPanKeyUp('up');
      if(e.key === 'ArrowDown')  this.onPanKeyUp('down');
      if(e.code === 'Comma')  this.onZoomKeyUp('out');
      if(e.code === 'Period') this.onZoomKeyUp('in');
    });
    // Shift を押しながらクリック/ホイール操作をした場合は Shift 単押し扱いにしない
    window.addEventListener('mousedown', ()=>{ this._shiftSolo = false; }, true);
    window.addEventListener('wheel', ()=>{ this._shiftSolo = false; }, {capture:true, passive:true});

    // mouse on canvas → iMouse / Sandbox mouse
    const c = GL.canvas;
    // ドラッグパン状態
    let _panDrag = null; // {sx, sy, baseX, baseY}
    const isPanDragEvent = (e)=>{
      // 中ボタン / 右ボタン / Alt+左ドラッグ / Space + 左ドラッグ
      return e.button === 1 || e.button === 2 || (e.button === 0 && (e.altKey || e.metaKey));
    };
    // Manga: アクティブスロットが manga のとき、画面上を左ドラッグでマシンガンを走らせる。
    //   カーソル位置が照準になる (Enter の 8 方向自走とは排他)。
    let _mangaDrag = false;
    const mangaSlotActive = ()=>{
      const sl = (typeof GL !== 'undefined' && GL.slots) ? GL.slots[App.activeSlot] : null;
      return !!(sl && sl.kind === 'manga' && typeof Manga !== 'undefined' && Manga.initialized);
    };
    const mangaAim = (e)=>{
      const rect = c.getBoundingClientRect();
      const u = (e.clientX - rect.left) / Math.max(1, rect.width);
      const v = (e.clientY - rect.top)  / Math.max(1, rect.height);
      if(Manga.aimBurst) Manga.aimBurst(u, v);
    };
    c.addEventListener('mousedown', e=>{
      if(isPanDragEvent(e)){
        App._camTween = null;   // リセットアニメ中の操作はキャンセル
        _panDrag = { sx:e.clientX, sy:e.clientY, baseX:App.userPan.x, baseY:App.userPan.y };
        e.preventDefault();
        return;
      }
      if(e.button === 0 && mangaSlotActive()){
        _mangaDrag = true;
        mangaAim(e);
        e.preventDefault();
      }
      this.mouse.down=true; this._mouse(e, false);
    });
    c.addEventListener('mouseup',   (e)=>{
      if(_panDrag){ _panDrag = null; return; }
      if(_mangaDrag){
        _mangaDrag = false;
        if(typeof Manga !== 'undefined' && Manga.stopBurst) Manga.stopBurst();
      }
      this.mouse.down=false;
    });
    // キャンバス外でボタンを離しても止める。
    // _panDrag もここで必ず解除する: サイドパネル上で離すとキャンバスの mouseup が
    // 発火せずフラグが残り、ボタンを押していないのにカーソルを動かすだけで映像が
    // 勝手にパンし続け、iMouse も凍結していた (パンは画面端へ向かう操作なので頻発)。
    window.addEventListener('mouseup', ()=>{
      if(_mangaDrag){
        _mangaDrag = false;
        if(typeof Manga !== 'undefined' && Manga.stopBurst) Manga.stopBurst();
      }
      _panDrag = null;
      this.mouse.down = false;
    });
    c.addEventListener('mousemove', e=>{
      if(_mangaDrag && mangaSlotActive()){ mangaAim(e); this._mouse(e, true); return; }
      if(_panDrag){
        const rect = c.getBoundingClientRect();
        // NDC ベース: ドラッグ距離 / 半画面サイズ で正規化 (ズームの逆数を掛けて見かけ等速)
        // 最小化 / フルスクリーン遷移中などで rect が 0 になると 0 除算で NaN が入り、
        // 以後パン量が NaN のまま映像が壊れるため下限を入れる。
        const rw = Math.max(1, rect.width), rh = Math.max(1, rect.height);
        const z = Math.max(0.01, App.userZoom || 1);
        App.userPan.x = _panDrag.baseX + (e.clientX - _panDrag.sx) / (rw * 0.5) / z;
        App.userPan.y = _panDrag.baseY - (e.clientY - _panDrag.sy) / (rh * 0.5) / z;
        return;
      }
      this._mouse(e, true);
    });
    // 右クリックメニュー抑制 (右ドラッグパン用)
    c.addEventListener('contextmenu', e=>{ if(e.button===2 || _panDrag) e.preventDefault(); });
    // メインステージ (A+B) のホイールズームは無効。ズームは下段 A/B タイルのホイール
    // (そのスロットのみ) と `,` `.` キー (アクティブスロット) で行う。
    c.addEventListener('wheel', e=>{ e.preventDefault(); }, { passive:false });

  },
  _mouse(e, moveOnly){
    const r = GL.canvas.getBoundingClientRect();
    const x = (e.clientX-r.left)/r.width * GL.canvas.width;
    const y = (1-(e.clientY-r.top)/r.height) * GL.canvas.height;
    this.mouse.x = x; this.mouse.y = y;
    if(!moveOnly){ this.mouse.dx = x; this.mouse.dy = y; } // latch on click for Shadertoy iMouse.zw
  },

  toggleFullscreen(){
    const el = $('#stage');
    if(document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen();
  },

  _fpsCap: 24,   // 描画フレームレートの上限 (fps)
  frameBudgetMs(){
    const cap = +this._fpsCap || 0;
    if(cap > 0) return 1000 / cap;
    const dtMs = (typeof GL !== 'undefined' && GL.lastDt) ? GL.lastDt * 1000 : (1000 / 60);
    return Math.max(1, dtMs || (1000 / 60));
  },
  loadPercent(ms){
    const pct = ((+ms || 0) / this.frameBudgetMs()) * 100;
    return Math.max(0, Math.min(100, pct));
  },
  tick(){
    if(this._halted) return;   // コンテキストロスト時は描画ループを止めて GPU 過負荷ループを断つ
    if(this._fpsCap > 0){      // fps 上限: 間隔に満たなければこのフレームはスキップ
      const _t = performance.now();
      if(this._fpsCapLast && (_t - this._fpsCapLast) < (1000 / this._fpsCap) - 1.0){
        requestAnimationFrame(()=>this.tick());
        return;
      }
      this._fpsCapLast = _t;
    }
    try{
      const tNow = performance.now();
      const dt = this._lastTickT ? Math.min(0.1, (tNow - this._lastTickT)/1000) : 0;
      this._lastTickT = tNow;
      this._updateUserPanZoom(dt);
      this._updateHueRot(dt);
      this._checkPendingPreset();
      Inputs.updateDynamic();
      Audio.update();
      if(this.autoCF.on){
        const beats = BPM.beatCount() - this.autoCF.t0;
        if(this.autoCF.mode === 'switch'){
          // 即時切替: N 拍ごとに 0↔1 をパチンと反転
          const step = Math.floor(beats / Math.max(0.0625, this.autoCF.beats));
          this.crossfade = (step % 2 === 0) ? 0 : 1;
        } else {
          // crossfade: 2N 拍周期で 0→1→0 の三角波
          let t = (beats / this.autoCF.beats) % 2;
          if(t<0) t += 2;
          this.crossfade = t<1 ? t : 2-t;
        }
        UI.refreshMix(true);
      } else if(this.autoCF.tail){
        // OFF 後の尾引き: 0 or 1 に到達するまで同じ速度で動かす
        const T = this.autoCF.tail;
        const dBeats = BPM.beatCount() - T.lastBeat;
        T.lastBeat = BPM.beatCount();
        // 1 拍あたりの crossfade 移動量: 三角波 (period=2N) なので 1 ビートで 1/N 進む
        const speed = 1 / Math.max(0.0625, this.autoCF.beats);
        const step = dBeats * speed * (T.target > 0.5 ? 1 : -1);
        this.crossfade = clamp(this.crossfade + step, 0, 1);
        if((T.target > 0.5 && this.crossfade >= 1) || (T.target < 0.5 && this.crossfade <= 0)){
          this.crossfade = T.target;
          this.autoCF.tail = null;
          // フェード完了: 新内容のスロットをアクティブに
          if(this._transTo){
            this.activeSlot = this._transTo; this._transTo = null;
            if(UI.refreshSlot) UI.refreshSlot();
            if(typeof MIDI !== 'undefined') MIDI.refreshLeds();
          }
        }
        UI.refreshMix(true);
      }
      this._tickParamFades();   // Param Fade: post 数値パラメータの補間を進める
      this._syncHuePreview();   // Hue Shift の変化をグラデバー / パレット一覧へ即反映
      GL._pollCompiles();       // 非同期シェーダコンパイルの完了確認・差し替え
      GL._pollInitProgs();      // 起動時プログラム(composite 等)の非同期リンク完了確認
      GL.beginGpuTimer();
      GL.render();
      GL.endGpuTimer();
      // Auto Palette(Slot A 抽出): ON の間は常に色を追従する。readPixels(GPU同期)を含むため
      //   毎フレームは避け、8フレーム間引き(約7.5fps 更新) + 失敗(暗いフレーム等)時は次フレーム即リトライ。
      if(this.post && this.post.palette === 8){
        this._autoPalTick = (this._autoPalTick || 0) + 1;
        if(!this._palPending && (this._autoPalRetry || (this._autoPalTick % 8 === 0))){
          this._autoPalRetry = !this.extractSlotAPalette();   // 成否は非同期読み戻し側でも更新される
        }
      }
      if(!(typeof Record !== 'undefined' && Record.active) || (GL.frame % 4 === 0)) Preview.tick();   // 録画中は 1/4 に間引き
      UI.repaintPresetThumbs();
      UI.animatePresetThumbs();
      App._cpuMs = (App._cpuMs||0)*0.85 + (performance.now() - tNow)*0.15;   // メインループの CPU 処理時間 (ms)
      UI.refreshHUD();
    }catch(err){
      // どこで落ちても rAF ループは止めない
      console.error('tick error:', err);
    }
    requestAnimationFrame(()=>this.tick());
  },

  // 拍ベース予約: 次拍の境界 (= 整数 beatCount を跨いだ瞬間) で loadPreset を発火
  queuePreset(idx, slotKey){
    const p = PRESETS[idx]; if(!p) return;
    const slotName = slotKey || this.activeSlot;
    const beatNow = (typeof BPM !== 'undefined' ? BPM.beatCount() : 0);
    this._pendingPreset = {
      idx, slotKey: slotName,
      armBeat: Math.floor(beatNow),  // この拍を超えたら発火
    };
    toast(`Queue ${slotName} ← ${p.name} (next beat)`);
  },
  _checkPendingPreset(){
    if(!this._pendingPreset) return;
    const beatNow = (typeof BPM !== 'undefined' ? BPM.beatCount() : 0);
    if(Math.floor(beatNow) > this._pendingPreset.armBeat){
      const pp = this._pendingPreset;
      this._pendingPreset = null;
      if(typeof pp.fn === 'function') pp.fn();           // 汎用アクション (動画切替など)
      else this.loadPreset(pp.idx, pp.slotKey);
    }
  },
  // 動画切替も Transition (transBeats) でフェード。
  transitionVideo(url, name){
    const k = this.activeSlot;
    const cur = GL.slots[k];
    // 二重発火/ダブルクリック対策: 同じ動画への連続呼び出しが極短時間(<0.3s)なら無視。
    // ロード直後に「なし」へ落ちる誤動作を防ぐ。間を置いた再タップでのトグルは残す。
    const tnow = now();
    const rapidSame = this._lastVidTap && this._lastVidTap.url === url && (tnow - this._lastVidTap.t) < 0.30;
    this._lastVidTap = { url, t: tnow };
    if(rapidSame) return;
    // 同じビデオを再選択 → なし(OFF)に戻す (トグル)
    if(cur && cur.kind === 'video' && cur._vidUrl === url){
      cur.kind = 'none'; cur.ready = true; cur.src = ''; cur.params = []; cur.format = ''; cur._vidUrl = '';
      if(typeof UI !== 'undefined' && UI.refreshAll) UI.refreshAll();
      toast(`Slot ${k} ← なし`);
      return;
    }
    this._transition((slot)=>{
      const s = GL.slots[slot];
      if(s){
        s.kind = 'video'; s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'video';
        s._vidUrl = url;   // トグル判定用
      }
      if(typeof Movie !== 'undefined'){
        if(!Movie.initialized) Movie.init(GL.gl);
        Movie.loadUrl(url, name, slot);
      }
      if(typeof UI !== 'undefined'){
        if(UI.refreshVideo) UI.refreshVideo();
        if(UI.refreshAll) UI.refreshAll();
      }
    }, name);
    // セットしたスロットを表示側へ (Crossfade を編集中スロットに合わせる → セットしたら必ず映る)
    this.crossfade = (k === 'A') ? 0 : 1;
    if(typeof UI !== 'undefined' && UI.refreshMix) UI.refreshMix(true);
  },

  loadPreset(idx, slotKey, opts){
    opts = opts || {};
    const p = PRESETS[idx]; if(!p) return;
    // Draw フリーズ (Space) / Pause 中でも切替結果を 1 フレーム描画する。
    // フリーズ中は Post FX が動き続けて「止まっている」ように見えないため、
    // 切替が映らないと「シェーダが変えられない」バグに見える。
    if(typeof GL !== 'undefined' && GL.forceRenderOnce) GL.forceRenderOnce();
    this._undoSchedule();   // プリセット変更を Undo 履歴に積む(デバウンス後にスナップショット)
    const s = GL.slots[slotKey];
    s.bKey = false; s.bKeyWhite = false;   // キー透過フラグを一旦リセット(@bkey シェーダ / ribbon で再設定)
    // 溶解FX(Boltzmann)中の切替: スイッチは維持し、新シェーダを数フレーム描画してから再捕獲して溶かし直す
    if(Math.abs(this.deadParam ? this.deadParam(this.post.boltz||0) : (this.post.boltz||0)) > 0.001){ GL._bzCaptureWait = 5; }
    { const pk = Math.max(this.post.pollockGloss||0, this.post.pollockMatt||0, this.post.pollockFlat||0);
      if((this.deadParam ? this.deadParam(pk) : pk) > 0.001){ GL._pkCaptureWait = 5; } }
    // シェーダ/モード切替時は overlay の古いストロークをリセット
    if(typeof Overlay !== 'undefined' && Overlay.clear) Overlay.clear();
    // 非シェーダ種別は in-shader cos grad を持たない → 汎用 cos grad を適用させる
    s.cosGradInShader = false;
    // shader / mode / movie 切替時は Auto Map の色相(自動ローテート位相)を初期化
    this._hueRotPhase = 0;
    // Layer (非シェーダ) プリセットの場合
    if(p.kind === 'layer'){
      s.kind = 'layer';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'layer';
      if(!Layer.initialized) Layer.init(GL.gl);
      // 遅延ロード (モバイル時): 選択した時に初めて画像を読み込む
      if(this.isMobile && (!Layer.images || Layer.images.length === 0)){
        Layer.autoLoadFromFolder('images/manga').then(n=>{
          if(GL.slots[App.activeSlot].kind === 'layer') UI.refreshLayerParams();
        }).catch(()=>{});
      }
      if(!opts.skipEngineDefault) this.applyEngineDefault('layer');
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    // Manga (panel collage) プリセット
    if(p.kind === 'manga'){
      s.kind = 'manga';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'manga';
      if(typeof Manga !== 'undefined' && !Manga.initialized) Manga.init(GL.gl);
      // 遅延ロード (モバイル時)
      if(this.isMobile && typeof Manga !== 'undefined' && (!Manga.images || Manga.images.length === 0)){
        Manga.autoLoadFromFolder('images/manga').then(n=>{
          if(GL.slots[App.activeSlot].kind === 'manga') UI.refreshManga();
        }).catch(()=>{});
      }
      if(!opts.skipEngineDefault) this.applyEngineDefault('manga');
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    // Text Deform (type graphic) プリセット
    if(p.kind === 'textdeform'){
      s.kind = 'textdeform';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'textdeform';
      if(typeof TextDeform !== 'undefined' && !TextDeform.initialized) TextDeform.init(GL.gl);
      if(!opts.skipEngineDefault) this.applyEngineDefault('textdeform');
      if(typeof TextDeform !== 'undefined' && TextDeform.loadSelected) TextDeform.loadSelected();   // Mix の md 選択に従う
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    // Ugomeki (文字アニメーション) プリセット
    if(p.kind === 'ugomeki'){
      s.kind = 'ugomeki';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'ugomeki';
      if(typeof Ugomeki !== 'undefined' && !Ugomeki.initialized) Ugomeki.init(GL.gl);
      if(!opts.skipEngineDefault) this.applyEngineDefault('ugomeki');
      if(typeof Ugomeki !== 'undefined' && Ugomeki.loadSelected) Ugomeki.loadSelected();   // md 選択に従う
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    // SpaceType (3D 空間タイポ) プリセット
    if(p.kind === 'spacetype'){
      s.kind = 'spacetype';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'spacetype';
      if(typeof SpaceType !== 'undefined' && !SpaceType.initialized) SpaceType.init(GL.gl);
      if(!opts.skipEngineDefault) this.applyEngineDefault('spacetype');
      if(typeof SpaceType !== 'undefined' && SpaceType.loadSelected) SpaceType.loadSelected();   // md 選択に従う
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    // Movie (loop player) プリセット
    if(p.kind === 'video'){
      s.kind = 'video';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'video';
      if(typeof Movie !== 'undefined' && !Movie.initialized) Movie.init(GL.gl);
      // 何も読まれていなければ cy.mp4 をデフォルトでロード (該当 slot へ)
      if(typeof Movie !== 'undefined'){
        const slotLoaded = Movie._slots && Movie._slots[slotKey] && Movie._slots[slotKey].loaded;
        if(!slotLoaded){
          try{ Movie.loadUrl('movies/cy.mp4', 'cy.mp4', slotKey); }catch(e){}
        }
      }
      if(!opts.skipEngineDefault) this.applyEngineDefault('video');
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    if(p.kind === 'aratanagara'){
      s.kind = 'aratanagara';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'aratanagara';
      if(typeof Aratanagara !== 'undefined' && !Aratanagara.initialized) Aratanagara.init(GL.gl);
      if(!opts.skipEngineDefault) this.applyEngineDefault('aratanagara');
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    if(p.kind === 'image'){
      s.kind = 'image';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'image';
      if(typeof ImageMode !== 'undefined'){
        if(!ImageMode.initialized) ImageMode.init(GL.gl);
        ImageMode.loadFolderIndex().then(()=>{
          // このスロットでフォルダ未選択なら最初のフォルダを自動選択
          if(!ImageMode._slot(slotKey).P.folder && ImageMode.folders.length) ImageMode.setFolder(ImageMode.folders[0].dir, slotKey);
        });
      }
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    // Slicer (3D 断片散布) プリセット
    if(p.kind === 'none'){
      s.kind = 'none';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'none';
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    if(p.kind === 'slicer'){
      s.kind = 'slicer';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'slicer';
      if(typeof Slicer !== 'undefined' && !Slicer.initialized) Slicer.init(GL.gl);
      if(!opts.skipEngineDefault) this.applyEngineDefault('slicer');
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    if(p.kind === 'cyberui'){
      s.kind = 'cyberui';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'cyberui';
      if(typeof CyberUI !== 'undefined' && !CyberUI.initialized) CyberUI.init(GL.gl);
      if(!opts.skipEngineDefault) this.applyEngineDefault('cyberui');
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    if(p.kind === 'novel'){
      s.kind = 'novel';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'novel';
      if(typeof NovelTerminal !== 'undefined' && !NovelTerminal.initialized) NovelTerminal.init(GL.gl);
      if(!opts.skipEngineDefault) this.applyEngineDefault('novel');
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    if(p.kind === 'inkelly'){
      s.kind = 'inkelly';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'inkelly';
      if(typeof Inkelly !== 'undefined' && !Inkelly.initialized) Inkelly.init(GL.gl);
      if(!opts.skipEngineDefault) this.applyEngineDefault('inkelly');
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    if(p.kind === 'pen'){
      s.kind = 'pen';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'pen';
      if(typeof Pen !== 'undefined' && !Pen.initialized) Pen.init(GL.gl);
      if(!opts.skipEngineDefault) this.applyEngineDefault('pen');
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    if(p.kind === 'boltzmann'){
      s.kind = 'boltzmann';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'boltzmann';
      if(typeof Boltzmann !== 'undefined'){ if(!Boltzmann.initialized) Boltzmann.init(GL.gl); else { Boltzmann.seeded = false; Boltzmann.pickRandomImage(); } }
      if(!opts.skipEngineDefault) this.applyEngineDefault('boltzmann');
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    if(p.kind === 'caverns'){
      s.kind = 'caverns';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'caverns';
      if(typeof Caverns !== 'undefined' && !Caverns.initialized) Caverns.init(GL.gl);
      if(!opts.skipEngineDefault) this.applyEngineDefault('caverns');
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    if(p.kind === 'shelf'){
      s.kind = 'shelf';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'shelf';
      if(typeof Shelf !== 'undefined' && !Shelf.initialized) Shelf.init(GL.gl);
      if(!opts.skipEngineDefault) this.applyEngineDefault('shelf');
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    if(p.kind === 'photoplane'){
      s.kind = 'photoplane';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'photoplane';
      if(typeof PhotoPlane !== 'undefined' && !PhotoPlane.initialized) PhotoPlane.init(GL.gl);
      if(!opts.skipEngineDefault) this.applyEngineDefault('photoplane');
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    if(p.kind === 'shredder'){
      s.kind = 'shredder';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'shredder';
      if(typeof Shredder !== 'undefined' && !Shredder.initialized) Shredder.init(GL.gl);
      if(!opts.skipEngineDefault) this.applyEngineDefault('shredder');
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    if(p.kind === 'ribbon'){
      s.kind = 'ribbon';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'ribbon';
      if(typeof Ribbon !== 'undefined' && !Ribbon.initialized) Ribbon.init(GL.gl);
      if(!opts.skipEngineDefault) this.applyEngineDefault('ribbon');
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    if(p.kind === 'grayscott'){
      s.kind = 'grayscott';
      s.ready = true; s.errors = ''; s.src = ''; s.params = []; s.format = 'grayscott';
      if(typeof GrayScott !== 'undefined'){ if(!GrayScott.initialized) GrayScott.init(GL.gl); else GrayScott.reseed(); }
      if(!opts.skipEngineDefault) this.applyEngineDefault('grayscott');
      UI.activePresetIdx[slotKey] = idx;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
      return;
    }
    s.kind = 'shader';
    s._presetName = p.name;   // shader params デフォルト保存/適用のキー
    const ok = GL.compileSlot(slotKey, p.src);
    if(ok){
      // apply channel hints
      for(let i=0;i<4;i++){
        const want = (p.ch && p.ch[i]) || '';
        if(!want){ s.channels[i] = null; continue; }
        if(want==='feedback') s.channels[i] = '__feedback__';
        else if(want==='audio') s.channels[i] = '__audio__';
        else if(want==='slotA') s.channels[i] = '__slotA__';
        else if(want==='slotB') s.channels[i] = '__slotB__';
        else if(want==='webcam'){
          Inputs.addWebcam().then(id=>{ s.channels[i] = id; UI.refreshChannels(); });
        }else if(want==='image'){
          const e = Inputs.list().find(x=>x.kind==='image');
          if(e) s.channels[i] = e.id;
        }else if(/\.(png|jpe?g|webp|gif)$/i.test(want)){
          // パス指定: プロジェクト内の画像を直接チャンネルへ (例 "images/etc/cd_emblem.png")
          Inputs.addImageURL(want, want).then(id=>{ if(id){ s.channels[i] = id; UI.refreshChannels(); } });
        }
      }
      UI.activePresetIdx[slotKey] = idx;
      if(this.activeSlot===slotKey) $('#code').value = p.src;
      UI.refreshAll();
      toast(`Slot ${slotKey} ← ${p.name}`);
    } else {
      UI.showError(s.errors);
    }
  },

  // ─── エンジン option のデフォルト値保存 (localStorage 'vj.def.<kind>') ───────
  // 各 mode の option パネルの「デフォルト保存」ボタンから呼ぶ。次回そのエンジンを
  // ロードした時に applyEngineDefault で流し込まれる。
  _engineP(kind){
    switch(kind){
      case 'layer':   return (typeof Layer   !== 'undefined') ? Layer.P   : null;
      case 'pen':     return (typeof Pen      !== 'undefined') ? Pen.P     : null;
      case 'manga':   return (typeof Manga    !== 'undefined') ? Manga.P   : null;
      case 'video':   return (typeof Movie    !== 'undefined') ? Movie.P   : null;
      case 'aratanagara': return (typeof Aratanagara !== 'undefined' && Aratanagara.P) ? Aratanagara.P : null;
      case 'slicer':  return (typeof Slicer   !== 'undefined') ? Slicer.P  : null;
      case 'inkelly': return (typeof Inkelly  !== 'undefined') ? Inkelly.P : null;
      case 'novel':   return (typeof NovelTerminal !== 'undefined') ? NovelTerminal.P : null;
      case 'cyberui': return (typeof CyberUI  !== 'undefined') ? CyberUI.P  : null;
      case 'boltzmann': return (typeof Boltzmann !== 'undefined' && Boltzmann.P) ? Boltzmann.P : null;
      case 'grayscott': return (typeof GrayScott !== 'undefined' && GrayScott.P) ? GrayScott.P : null;
      case 'caverns': return (typeof Caverns !== 'undefined' && Caverns.P) ? Caverns.P : null;
      case 'shelf':   return (typeof Shelf    !== 'undefined') ? Shelf.P    : null;
      case 'ribbon':  return (typeof Ribbon   !== 'undefined' && Ribbon.P) ? Ribbon.P : null;
      case 'photoplane': return (typeof PhotoPlane !== 'undefined' && PhotoPlane.P) ? PhotoPlane.P : null;
      case 'shredder': return (typeof Shredder !== 'undefined' && Shredder.P) ? Shredder.P : null;
      case 'textdeform': return (typeof TextDeform !== 'undefined' && TextDeform.P) ? TextDeform.P : null;
      case 'ugomeki': return (typeof Ugomeki !== 'undefined' && Ugomeki.P) ? Ugomeki.P : null;
      case 'spacetype': return (typeof SpaceType !== 'undefined' && SpaceType.P) ? SpaceType.P : null;
    }
    return null;
  },
  _capturePresetDefaults(){
    const clone = (v)=>{
      try{ return JSON.parse(JSON.stringify(v)); }catch(e){ return v; }
    };
    const factory = {
      modes: {},
      mix: {
        crossfade: this.crossfade,
        blendMode: this.blendMode,
        mixControls: clone(this._captureMixControls())
      },
      transition: {
        transBeats: this.transBeats,
        transStyle: this.transStyle,
        paramFadeBeats: this.paramFadeBeats,
        paramFadeScope: this.paramFadeScope
      }
    };
    const d = {
      beatMode: this.beatMode || 'beat',
      beatScale: 1.0,
      crossfade: 1.0,
      blendMode: 'mix',
      gamma: 1.0,
      slotBOffsetBeats: 0,
      post: clone(this.post),
      modes: {},
      overlay: null,
      overlayBrushParams: null,
      mixControls: {auto:false, beats:8, mode:'crossfade'}
    };
    for(const kind of (this.modeStateKinds || [])){
      const P = this._engineP(kind);
      if(!P) continue;
      const base = clone(P);
      factory.modes[kind] = clone(base);
      // エンジン側の「デフォルト保存」があれば、プリセットの欠落項目にも適用する。
      try{
        const saved = JSON.parse(localStorage.getItem('vj.def.'+kind) || 'null');
        if(saved && typeof saved === 'object' && !Array.isArray(saved)) Object.assign(base, saved);
      }catch(e){}
      d.modes[kind] = base;
    }
    if(typeof Overlay !== 'undefined'){
      d.overlay = clone(Overlay.PDefaults || Overlay.P);
      d.overlayBrushParams = clone(Overlay.brushParams || {});
    }
    this._factoryDefaults = factory;
    this._presetDefaults = d;
    return d;
  },
  _hasSavedModeState(state, kind){
    if(!state || !kind || !(this.modeKinds || []).includes(kind)) return false;
    const d = state[kind];
    return !!(d && typeof d === 'object' && !Array.isArray(d));
  },
  _restoreModeStates(state, opts){
    if(!state || typeof state !== 'object') return;
    opts = opts || {};
    const kinds = this.modeStateKinds || [];
    // SpaceType のサイクル運転系(+scene)はランタイム設定として扱い、状態復元では上書きしない。
    const ST_RUNTIME = ['sceneMode','autoCycle','cycleReload','sceneBeats'];
    const stStrip = (o)=>{ o = Object.assign({}, o); for(const k of ST_RUNTIME) delete o[k]; return o; };
    for(const kind of kinds){
      if(kind === 'image') continue;   // image はスロット別 {A,B} 形式 → 末尾の ImageMode.applyState で適用
      let d = state[kind];
      const P = this._engineP(kind);
      if(!P) continue;
      const hasData = !!(d && typeof d === 'object' && !Array.isArray(d));
      if(opts.resetMissingDefaults && this._presetDefaults && this._presetDefaults.modes[kind]){
        // spacetype: この既定値は「セッション最初のプリセット呼出時の P のスナップショット」。
        //   spacetype データを持たない古いプリセットの呼出でこれを無条件適用すると、
        //   呼出のたびに scene がスナップショット時点の値へ戻り
        //   「後に呼ぶプリセット全部が最初の scene になる」ため、
        //   spacetype はプリセット自身にデータがあるときだけ(ランタイムキーを除いて)適用する。
        if(kind !== 'spacetype') Object.assign(P, JSON.parse(JSON.stringify(this._presetDefaults.modes[kind])));
        else if(hasData) Object.assign(P, stStrip(JSON.parse(JSON.stringify(this._presetDefaults.modes[kind]))));
      }
      if(hasData){
        if(kind === 'spacetype') d = stStrip(d);
        Object.assign(P, d);
      }
    }
    if(state.pen && typeof Pen !== 'undefined' && Pen.P && Pen.strokes){
      while(Pen.strokes.length < Pen.P.count) Pen.strokes.push(Pen.makeRandomStroke((Pen.clock||0) - Pen._rand(0,1.5)));
      if(typeof UI !== 'undefined' && UI.refreshPenParams) UI.refreshPenParams();
    }
    // Slicer は画像も復元する (P だけだと画像が切り替わらない)。
    //   画像読込後にプリセットの P を再適用する = 画像ごとの保存より優先。
    if(state.slicerImg && typeof Slicer !== 'undefined' && Slicer.restoreImage){
      Slicer.restoreImage(state.slicerImg, state.slicer);
    }
    if(state.novel && typeof UI !== 'undefined' && UI.refreshNovelParams) UI.refreshNovelParams();
    if(state.cyberui && typeof UI !== 'undefined' && UI.refreshCyberParams) UI.refreshCyberParams();
    // image はフォルダのリスト再構築が必要 (P 代入だけでは表示が切り替わらない)。両スロットへ適用。
    if(state.image && typeof ImageMode !== 'undefined' && ImageMode.applyState) ImageMode.applyState(state.image);
  },
  saveEngineDefault(kind){
    const P = this._engineP(kind);
    if(!P){ toast('保存対象がありません'); return; }
    try{ localStorage.setItem('vj.def.'+kind, JSON.stringify(P)); this.uploadDefs(); toast('デフォルト保存: '+kind); }
    catch(e){ toast('保存失敗'); }
  },
  // ライブ調整を捨てて「デフォルト保存」した値へ戻す (保存が無ければ工場出荷値)。保存自体は消さない。
  resetEngineDefault(kind){
    const P = this._engineP(kind);
    const base = this._factoryDefaults && this._factoryDefaults.modes[kind];
    if(!P || !base){ toast('リセット対象がありません'); return; }
    Object.assign(P, JSON.parse(JSON.stringify(base)));
    this.applyEngineDefault(kind);   // 保存済みデフォルトを再適用
    if(kind === 'pen' && typeof Pen !== 'undefined' && Pen.strokes){
      while(Pen.strokes.length < (Pen.P.count||0)) Pen.strokes.push(Pen.makeRandomStroke((Pen.clock||0) - Pen._rand(0,1.5)));
      if(Pen.strokes.length > (Pen.P.count||0)) Pen.strokes.length = Pen.P.count||0;
    }
    if(typeof UI !== 'undefined' && UI.refreshAll) UI.refreshAll();
    toast('保存値へ戻しました: ' + kind);
  },
  // ─── shader @param のデフォルト保存/適用 (シェーダ名ごと localStorage 'vj.def.sparam.<name>') ───
  //   Shader Params パネルの「デフォルト保存」から現在値を保存 → 次回そのシェーダ読込時に反映。
  saveShaderParamDefaults(slotKey){
    const slot = GL.slots[slotKey || this.activeSlot];
    if(!slot || (slot.kind && slot.kind !== 'shader')){ toast('シェーダスロットではありません'); return; }
    if(!slot.params || !slot.params.length){ toast('保存対象のパラメータがありません'); return; }
    const name = slot._presetName;
    if(!name){ toast('シェーダ名が不明です'); return; }
    const d = {};
    for(const p of slot.params){ d[p.name] = Array.isArray(p.value) ? p.value.slice() : p.value; }
    try{ localStorage.setItem('vj.def.sparam.' + name, JSON.stringify(d)); this.uploadDefs(); toast('デフォルト保存: ' + name); }
    catch(e){ toast('保存失敗'); }
  },
  applyShaderParamDefaults(slot){
    if(!slot || !slot.params || !slot.params.length || !slot._presetName) return;
    for(const p of slot.params){
      if(p._factoryDefaultValue === undefined){
        const v = p.defaultValue !== undefined ? p.defaultValue : p.value;
        p._factoryDefaultValue = Array.isArray(v) ? v.slice() : v;
      }
    }
    let saved = null;
    try{ saved = JSON.parse(localStorage.getItem('vj.def.sparam.' + slot._presetName) || 'null'); }catch(e){}
    if(!saved || typeof saved !== 'object') return;
    for(const p of slot.params){
      if(saved[p.name] == null) continue;
      const v = saved[p.name];
      p.value = Array.isArray(v) ? v.slice() : v;
      p.defaultValue = Array.isArray(v) ? v.slice() : v;   // ダブルクリックリセットも新デフォルトへ
    }
  },
  // ライブ調整を捨てて「デフォルト保存」した @param へ戻す (保存が無ければ工場出荷値)。保存自体は消さない。
  clearShaderParamDefaults(slotKey){
    const slot = GL.slots[slotKey || this.activeSlot];
    const name = slot && slot._presetName;
    if(!name){ toast('シェーダ名が不明です'); return; }
    for(const p of (slot.params || [])){
      const v = p._factoryDefaultValue !== undefined ? p._factoryDefaultValue : p.defaultValue;
      p.value = Array.isArray(v) ? v.slice() : v;
      p.defaultValue = Array.isArray(v) ? v.slice() : v;
    }
    this.applyShaderParamDefaults(slot);   // 保存済みデフォルトを再適用
    if(typeof UI !== 'undefined' && UI.refreshParams) UI.refreshParams();
    toast('保存値へ戻しました: ' + name);
  },
  // ダブルクリックで戻す値の出どころ: 「デフォルト保存」した値 → 無ければ工場出荷値
  savedEngineDefault(kind){
    try{ const d = JSON.parse(localStorage.getItem('vj.def.' + kind) || 'null');
         return (d && typeof d === 'object') ? d : null; }catch(e){ return null; }
  },
  resetValueFor(kind, key, factory){
    const d = this.savedEngineDefault(kind);
    return (d && d[key] !== undefined) ? d[key] : factory;
  },
  applyEngineDefault(kind){
    const P = this._engineP(kind);
    if(!P) return;
    let saved = null;
    try{ saved = JSON.parse(localStorage.getItem('vj.def.'+kind) || 'null'); }catch(e){}
    if(!saved || typeof saved !== 'object') return;
    if(kind === 'spacetype'){   // サイクル運転系はランタイム設定: どの復元経路でも上書きしない
      saved = Object.assign({}, saved);
      for(const k of ['sceneMode','autoCycle','cycleReload','sceneBeats','scene']) delete saved[k];
    }
    Object.assign(P, saved);
    if(kind === 'pen' && typeof Pen !== 'undefined' && Pen.strokes){   // count 増加ぶんのストロークを追加
      while(Pen.strokes.length < (Pen.P.count||0)) Pen.strokes.push(Pen.makeRandomStroke((Pen.clock||0) - Pen._rand(0,1.5)));
    }
  },
  // ─── Mix パネル(crossfade/blend/transition)のデフォルト値保存 ───────
  saveMixDefault(){
    const d = { crossfade:this.crossfade, blendMode:this.blendMode, mixControls:this._captureMixControls() };
    try{ localStorage.setItem('vj.def.mix', JSON.stringify(d)); this.uploadDefs(); toast('デフォルト保存: mix'); }
    catch(e){ toast('保存失敗'); }
  },
  // ─── Esc: 両スロットを「なし(透明)」+ 各パラメータをリセット ───────
  //   「リセット」の意味は各パネルの Reset ボタンと同じ = 起動時の値 + 保存済みデフォルト。
  //   Preset 0 (presetBlankBoth) は applyServerDefaults() で defaults.json を fetch して
  //   post / manga / layer を流し込むため「プリセットを読む」挙動になる。Esc はそれを避ける。
  // Post / Mix / Transition / 各 mode / Overlay / Pan・Zoom を保存値・初期値へ戻す (スロットは保持)。
  // R キー = これ単体 / Esc = 両スロットなし + これ。
  _undoPushNow(){
    clearTimeout(this._undoTimer); this._undoTimer = null;
    this._undoCommit(true);   // リセット直前の状態は (フェード中でも) 必ず積む
    const preSnap = this._undoSnap();
    if(preSnap !== null){
      this._undoStack.push(preSnap);
      if(this._undoStack.length > 60) this._undoStack.shift();
      this._redoStack.length = 0;
      this._undoLast = preSnap;
    }
  },
  resetParamsAll(){
    this._undoPushNow();
    // R はプリセット扱い: 視覚トランジション + Param Fade を効かせる (Esc は瞬時のまま)
    if(typeof GL !== 'undefined' && GL.startPresetTrans) GL.startPresetTrans(this.transBeats||0, this.transStyle||0);
    this._resetParamsCore({faded:true});
    this._undoLast = this._undoSnap();
    toast('パラメータをリセット (Cmd+Z で戻せます)');
  },
  _resetParamsCore(opts){
    opts = opts || {};
    const clone = (v)=>{ try{ return JSON.parse(JSON.stringify(v)); }catch(e){ return v; } };
    const F = this._factoryDefaults;

    // 2) Post FX を起動時の値へ (post は _presetDefaults 側に入る)
    // 進行中の Param Fade を先に破棄しておかないと、リセット直後の値をフェードが
    // 数フレームかけて上書きし続け、瞬時のはずのリセットが古い値に引き戻されてしまう。
    this._paramFades.length = 0;
    this._gradFade = null;
    this._activeGradPreset = 9;   // gradMix を 0 へ戻すので「通常色」状態も合わせておく
    if(typeof MIDI !== 'undefined' && MIDI.armPickup) MIDI.armPickup();   // つまみ位置とズレるので取り込み待ちへ
    const post0 = (this._presetDefaults && this._presetDefaults.post) || (F && F.post);
    if(post0){
      if(opts.faded && this._fadeBeats() > 0) this.applyPostFaded(clone(post0));   // R: 拍数かけて戻す
      else Object.assign(this.post, clone(post0));                                 // Esc / Preset0: 瞬時
    }

    // 3) Mix / Transition (起動時の値 → 保存済みデフォルトを再適用)
    if(F && F.mix){
      this.crossfade = F.mix.crossfade;
      this.blendMode = F.mix.blendMode;
      this._applyMixControls(F.mix.mixControls);
      this.applyMixDefault();
    }
    if(F && F.transition){
      this.transBeats = F.transition.transBeats;
      this.transStyle = F.transition.transStyle;
      this.paramFadeBeats = F.transition.paramFadeBeats;
      this.paramFadeScope = F.transition.paramFadeScope || 'all';
      this.applyTransDefault();
    }
    this.gamma = 1.0;
    this.slotVisible = {A:true, B:true};
    if(this.autoCF) this.autoCF.on = false;

    // 4) 各エンジン (mode) のパラメータ
    if(F && F.modes){
      for(const kind of Object.keys(F.modes)){
        const P = this._engineP(kind);
        if(!P) continue;
        Object.assign(P, clone(F.modes[kind]));
        this.applyEngineDefault(kind);
      }
    }

    // 5) Overlay + 6) User Pan/Zoom
    if(typeof Overlay !== 'undefined'){
      if(Overlay.resetModeDefault) Overlay.resetModeDefault();
      Overlay.P.enabled = false;
      if(Overlay.clear) Overlay.clear();
    }
    if(this.resetUserPanZoom) this.resetUserPanZoom();
    if(typeof Audio !== 'undefined'){ Audio.hit = 0; Audio.react = 0; }

    if(typeof MIDI !== 'undefined') (MIDI.syncLeds ? MIDI.syncLeds() : MIDI.refreshLeds());
    if(typeof UI !== 'undefined' && UI.refreshAll) UI.refreshAll();
  },
  escResetAll(){
    // リセットは 3 秒後の autosave で vj.state に焼き付くため、直前状態を undo へ確定させる
    this._undoPushNow();

    // 1) 両スロットを「なし(透明)」に (転換は挟まない)
    this.transBeats = 0; this.transStyle = 0;
    const ni = PRESETS.findIndex(p => p && p.kind === 'none');
    if(ni >= 0){ for(const k of ['A','B']) this.loadPreset(ni, k); }
    // 進行中の転換が残ると最終出力が古いスナップショットに占有され「何も出ない」状態になる
    if(typeof GL !== 'undefined'){
      if(GL._presetTr) GL._presetTr.on = false;
      for(const k of ['A','B']){ const sl = GL.slots && GL.slots[k]; if(sl && sl._tr) sl._tr.on = false; }
    }

    this._resetParamsCore();
    this._undoLast = this._undoSnap();
    toast('両スロットなし / パラメータをリセット (Cmd+Z で戻せます)');
  },

  resetMixDefault(){
    const d = this._factoryDefaults && this._factoryDefaults.mix;
    if(!d) return;
    this.crossfade = d.crossfade;
    this.blendMode = d.blendMode;
    this._applyMixControls(d.mixControls);
    this.applyMixDefault();   // 保存済みデフォルトを再適用 (保存は消さない)
    if(typeof UI !== 'undefined' && UI.refreshMix) UI.refreshMix();
    toast('保存値へ戻しました: mix');
  },
  applyMixDefault(){
    let d = null;
    try{ d = JSON.parse(localStorage.getItem('vj.def.mix') || 'null'); }catch(e){}
    if(!d || typeof d !== 'object') return;
    if(typeof d.crossfade === 'number')  this.crossfade  = d.crossfade;
    if(typeof d.blendMode === 'string')  this.blendMode  = d.blendMode;
    if(d.mixControls) this._applyMixControls(d.mixControls);
    else if(d.mode === 'switch' || d.mode === 'crossfade' || typeof d.auto === 'boolean' || typeof d.beats === 'number') this._applyMixControls(d);
    if(typeof UI !== 'undefined' && UI.refreshMix) UI.refreshMix();
  },
  // ─── Transition (拍数 / Style / Param Trans) のデフォルト値保存 ───────
  saveTransDefault(){
    const d = { transBeats:this.transBeats, transStyle:this.transStyle, paramFadeBeats:this.paramFadeBeats, paramFadeScope:this.paramFadeScope };
    try{ localStorage.setItem('vj.def.transition', JSON.stringify(d)); this.uploadDefs(); toast('デフォルト保存: transition'); }
    catch(e){ toast('保存失敗'); }
  },
  resetTransDefault(){
    const d = this._factoryDefaults && this._factoryDefaults.transition;
    if(!d) return;
    this.transBeats = d.transBeats;
    this.transStyle = d.transStyle;
    this.paramFadeBeats = d.paramFadeBeats;
    this.applyTransDefault();   // 保存済みデフォルトを再適用 (保存は消さない)
    if(typeof UI !== 'undefined' && UI.refreshMix) UI.refreshMix();
    toast('保存値へ戻しました: transition');
  },
  applyTransDefault(){
    let d = null;
    try{ d = JSON.parse(localStorage.getItem('vj.def.transition') || 'null'); }catch(e){}
    if(!d || typeof d !== 'object') return;
    if(typeof d.transBeats === 'number') this.transBeats = d.transBeats;
    if(typeof d.transStyle === 'number') this.transStyle = [6,7,8,10].includes(d.transStyle) ? 0 : d.transStyle;   // 撤去済みスタイルは Crossfade へ
    if(typeof d.paramFadeBeats === 'number') this.paramFadeBeats = d.paramFadeBeats;
    if(d.paramFadeScope === 'all' || d.paramFadeScope === 'preset') this.paramFadeScope = d.paramFadeScope;
    if(typeof UI !== 'undefined' && UI.refreshMix) UI.refreshMix();
  },
  // ─── Audio Detect (Target / Sensitivity / Band / Attack) のデフォルト保存 ───
  //   post 側の値だが Audio FX 扱いでプリセットには保存されないため、専用の保存口を持つ。
  AUDIO_DETECT_KEYS: ['audioTarget', 'audioGain', 'audioBand', 'audioAttack'],
  saveAudioDetectDefault(){
    const d = {};
    for(const k of this.AUDIO_DETECT_KEYS) d[k] = this.post[k];
    try{ localStorage.setItem('vj.def.audioDetect', JSON.stringify(d)); this.uploadDefs(); toast('デフォルト保存: audioDetect'); }
    catch(e){ toast('保存失敗'); }
  },
  applyAudioDetectDefault(){
    let d = null;
    try{ d = JSON.parse(localStorage.getItem('vj.def.audioDetect') || 'null'); }catch(e){}
    if(!d || typeof d !== 'object') return;
    if(typeof d.audioTarget === 'string') this.post.audioTarget = d.audioTarget;
    for(const k of ['audioGain', 'audioBand', 'audioAttack']){
      if(typeof d[k] === 'number') this.post[k] = Math.max(0, Math.min(1, d[k]));
    }
    if(typeof UI !== 'undefined' && UI.refreshPost) UI.refreshPost();
  },
  resetAudioDetectDefault(){
    const f = this._factoryDefaults && this._factoryDefaults.post;
    if(f) for(const k of this.AUDIO_DETECT_KEYS) if(f[k] !== undefined) this.post[k] = f[k];
    this.applyAudioDetectDefault();   // 保存済みデフォルトを再適用 (保存は消さない)
    if(typeof UI !== 'undefined' && UI.refreshPost) UI.refreshPost();
    toast('保存値へ戻しました: audioDetect');
  },
  saveAudioTransportDefault(){
    try{ localStorage.setItem('vj.def.audioTransport', JSON.stringify(this.audioTime)); this.uploadDefs(); toast('デフォルト保存: audioTransport'); }
    catch(e){ toast('保存失敗'); }
  },
  resetAudioTransportDefault(){
    Object.assign(this.audioTime, this.audioTimeDefaults());
    this.applyAudioTransportDefault();   // 保存済みデフォルトを再適用 (保存は消さない)
    if(this.audioTime.dirMode === 'off'){ this.timeDir = 1; this._atHitOn = false; }
    if(this.audioTime.speedMode === 'off') this._audioSpeedMul = 1;
    if(typeof UI !== 'undefined' && UI.refreshAudioTransport) UI.refreshAudioTransport();
    toast('保存値へ戻しました: audioTransport');
  },
  applyAudioTransportDefault(){
    let d = null;
    try{ d = JSON.parse(localStorage.getItem('vj.def.audioTransport') || 'null'); }catch(e){}
    if(!d || typeof d !== 'object') return;
    if(['off','flip','flipAcc','revHit','fwdHit'].includes(d.dirMode)) this.audioTime.dirMode = d.dirMode;
    if(['off','energy','hit','duck'].includes(d.speedMode)) this.audioTime.speedMode = d.speedMode;
    if(typeof d.depth === 'number') this.audioTime.depth = Math.max(0, Math.min(1, d.depth));
    if(typeof d.threshold === 'number') this.audioTime.threshold = Math.max(0, Math.min(1, d.threshold));
    if(typeof UI !== 'undefined' && UI.refreshAudioTransport) UI.refreshAudioTransport();
  },
  _captureMixControls(){
    const ac = this.autoCF || {};
    return {
      auto: !!ac.on,
      beats: Math.max(1, Math.min(64, parseInt(ac.beats, 10) || 8)),
      mode: ac.mode === 'switch' ? 'switch' : 'crossfade'
    };
  },
  _applyMixControls(d){
    if(!d || typeof d !== 'object') return;
    if(!this.autoCF) this.autoCF = {on:false, beats:8, t0:0, fromA:true, mode:'crossfade', tail:null};
    if(typeof d.beats === 'number') this.autoCF.beats = Math.max(1, Math.min(64, parseInt(d.beats, 10) || 8));
    if(d.mode === 'switch' || d.mode === 'crossfade') this.autoCF.mode = d.mode;
    const hasAuto = typeof d.auto === 'boolean' || typeof d.on === 'boolean';
    if(hasAuto){
      const on = typeof d.auto === 'boolean' ? d.auto : d.on;
      this.autoCF.on = !!on;
      this.autoCF.tail = null;
      if(this.autoCF.on){
        const beats = Math.max(0.0625, this.autoCF.beats || 8);
        const tStart = this.autoCF.mode === 'switch' ? 0 : (this.crossfade || 0);
        this.autoCF.t0 = (typeof BPM !== 'undefined' && BPM.beatCount) ? BPM.beatCount() - tStart * beats : 0;
      }
    }
	  },

	  _captureOverlayState(){
	    if(typeof Overlay === 'undefined') return { overlay:null, overlayBrushParams:null };
	    const clone = (v)=>{
	      try{ return JSON.parse(JSON.stringify(v)); }catch(e){ return v; }
	    };
	    const overlay = clone(Overlay.P);
	    let overlayBrushParams = clone(Overlay.brushParams || {});
	    if(!overlayBrushParams || typeof overlayBrushParams !== 'object') overlayBrushParams = {};
	    const mode = overlay && overlay.brushMode
	      ? ((Overlay._brushName) ? Overlay._brushName(overlay.brushMode) : overlay.brushMode)
	      : null;
	    if(mode){
	      const keys = Overlay.BRUSH_KEYS || [];
	      const cur = Object.assign({}, overlayBrushParams[mode] || {});
	      for(const k of keys) if(overlay[k] !== undefined) cur[k] = clone(overlay[k]);
	      overlayBrushParams[mode] = cur;
	    }
	    return { overlay, overlayBrushParams };
	  },

	  // 現在の全状態をオブジェクトにまとめる(localStorage 保存 / バンク保存で共用)
	  _collectState(){
	    const pn = (k)=>{ const i = UI.activePresetIdx[k]; return (i>=0 && PRESETS[i]) ? PRESETS[i].name : null; };
	    // スロットに読み込まれている動画(URL/名前)を保存 → ロード時に同じ動画を復元
	    const vidOf = (k)=>{
	      if(typeof Movie === 'undefined' || !Movie._slots || !Movie._slots[k]) return null;
	      const vs = Movie._slots[k];
	      return vs.src ? { src: vs.src, name: vs.fileName || '' } : null;
	    };
	    const ovState = this._captureOverlayState();
	    // iMouse (スロットごとの凍結値) をプリセットへ保存する。
    // キャンバス解像度が変わってもズレないよう 0..1 に正規化して持つ。
    const mouseOf = (k)=>{
      const m = GL.slots[k] && GL.slots[k]._mouse;
      if(!m) return null;
      const w = Math.max(1, GL.canvas ? GL.canvas.width : 1);
      const h = Math.max(1, GL.canvas ? GL.canvas.height : 1);
      return { x:m.x/w, y:m.y/h, dx:(m.dx||0)/w, dy:(m.dy||0)/h };
    };
    // チャンネル: 画像入力の ID はセッション限りなので、パス由来の画像 (label=URL) は
    // パス文字列で保存する → リロード後の復元で再束縛できる (ID のままだと未束縛=黒になる)
    const chOf = (k)=> (GL.slots[k].channels || []).map(c => {
      if(typeof c === 'string' && c.indexOf('__') !== 0 && typeof Inputs !== 'undefined'){
        const e = Inputs.list().find(x => x.id === c);
        if(e && e.kind === 'image' && /\.(png|jpe?g|webp|gif)$/i.test(e.label || '')) return e.label;
      }
      return c;
    });
    return {
      slots:{
        A:{src:GL.slots.A.src, kind:GL.slots.A.kind, channels:chOf('A'), params:GL.slots.A.params, presetName: pn('A'), video: vidOf('A'), mouse: mouseOf('A')},
        B:{src:GL.slots.B.src, kind:GL.slots.B.kind, channels:chOf('B'), params:GL.slots.B.params, presetName: pn('B'), video: vidOf('B'), mouse: mouseOf('B')}
      },
      beatMode: this.beatMode,
      audioTime: Object.assign({}, this.audioTime),
      bpm: BPM.bpm, crossfade: this.crossfade, blendMode: this.blendMode, gamma: this.gamma,
      slotBOffsetBeats: this.slotBOffsetBeats || 0,
      transBeats: this.transBeats,
      transStyle: this.transStyle,
      post: this.post,
	      overlay: ovState.overlay,
	      overlayBrushParams: ovState.overlayBrushParams,
      manga: (typeof Manga !== 'undefined') ? Manga.P : null,
      layer: (typeof Layer !== 'undefined') ? Layer.P : null,
      aratanagara: (typeof Aratanagara !== 'undefined' && Aratanagara.P) ? Aratanagara.P : null,
      slicer: (typeof Slicer !== 'undefined' && Slicer.P) ? Slicer.P : null,
      slicerImg: (typeof Slicer !== 'undefined' && Slicer.curName) ? Slicer.curName : null,   // 選択中の画像 (images/slicer/ のファイル名)
      inkelly: (typeof Inkelly !== 'undefined' && Inkelly.P) ? Inkelly.P : null,
      pen: (typeof Pen !== 'undefined' && Pen.P) ? Pen.P : null,
      novel: (typeof NovelTerminal !== 'undefined' && NovelTerminal.P) ? NovelTerminal.P : null,
      cyberui: (typeof CyberUI !== 'undefined' && CyberUI.P) ? CyberUI.P : null,
      boltzmann: (typeof Boltzmann !== 'undefined' && Boltzmann.P) ? Boltzmann.P : null,
      grayscott: (typeof GrayScott !== 'undefined' && GrayScott.P) ? GrayScott.P : null,
      caverns: (typeof Caverns !== 'undefined' && Caverns.P) ? Caverns.P : null,
	      shelf: (typeof Shelf !== 'undefined' && Shelf.P) ? Shelf.P : null,
	      ribbon: (typeof Ribbon !== 'undefined' && Ribbon.P) ? Ribbon.P : null,
	      photoplane: (typeof PhotoPlane !== 'undefined' && PhotoPlane.P) ? PhotoPlane.P : null,
	      shredder: (typeof Shredder !== 'undefined' && Shredder.P) ? Shredder.P : null,
	      textdeform: (typeof TextDeform !== 'undefined' && TextDeform.P) ? TextDeform.P : null,
	      ugomeki: (typeof Ugomeki !== 'undefined' && Ugomeki.P) ? Ugomeki.P : null,
	      spacetype: (typeof SpaceType !== 'undefined' && SpaceType.P) ? SpaceType.P : null,
	      video: (typeof Movie !== 'undefined' && Movie.P) ? Movie.P : null,
	      image: (typeof ImageMode !== 'undefined' && ImageMode._slot) ? { A: ImageMode._slot('A').P, B: ImageMode._slot('B').P } : null
    };
  },
  saveLocal(){
    try{ localStorage.setItem('vj.state', JSON.stringify(this._collectState())); }catch(e){}
  },
  // ─── Undo / Redo (Cmd+Z / Cmd+Shift+Z) ───────────────
  //   操作後にデバウンスで _collectState() のスナップショットを取り、変化があれば履歴に積む。
  _undoStack: [], _redoStack: [], _undoLast: null, _undoBusy: false, _undoTimer: null,
  _delPresetStack: [],   // 削除したプリセット(戻るで復元)。{item, index}
  _undoSnap(){ try{ return JSON.stringify(this._collectState()); }catch(e){ return null; } },
  _undoCommit(force){
    if(this._undoBusy) return;
    // Param Fade 進行中は中間値を履歴に積まない (「個別の指示」だけを記録する)。
    // フェードが終わるまで再スケジュールし、落ち着いた結果を1回だけ積む。
    if(!force && ((this._paramFades && this._paramFades.length) || this._gradFade)){ this._undoSchedule(); return; }
    const cur = this._undoSnap();
    if(cur === null) return;
    if(this._undoLast === null){ this._undoLast = cur; return; }   // 初回=基準だけ設定
    if(cur === this._undoLast) return;                              // 変化なし
    this._undoStack.push(this._undoLast);
    if(this._undoStack.length > 60) this._undoStack.shift();
    this._redoStack.length = 0;                                     // 新しい操作で redo を破棄
    this._undoLast = cur;
  },
  _undoSchedule(){ clearTimeout(this._undoTimer); this._undoTimer = setTimeout(()=>{ this._undoTimer = null; this._undoCommit(); }, 350); },
  _undoApply(snap){
    this._undoBusy = true;
    try{ this._applyState(JSON.parse(snap), {instantPost:true}); if(UI && UI.refreshAll) UI.refreshAll(); }catch(e){}
    this._undoLast = snap;
    this._undoBusy = false;
  },
  undo(){
    clearTimeout(this._undoTimer); this._undoTimer = null;
    const cur = this._undoSnap();
    if(this._undoLast !== null && cur !== null && cur !== this._undoLast){   // 未コミットの状態変化 → それを優先で巻き戻す
      this._redoStack.push(cur);
      this._undoApply(this._undoLast);
      toast('元に戻す'); return;
    }
    if(this._delPresetStack.length){                       // 直近の削除プリセットを復元(undo履歴の有無に依らず)
      const { item, index } = this._delPresetStack.pop();
      const lib = this._loadPresetLib();
      const at = Math.min(Math.max(index, 0), lib.length);
      lib.splice(at, 0, item);
      this._savePresetLib();
      this._tombRemoveMany([this._presetContentKey(item)]);   // 復元したので墓標を消す
      if(UI && UI.refreshPresetLib) UI.refreshPresetLib();
      toast('プリセットを復元: ' + (item && item.name || ''));
      return;
    }
    if(this._undoLast === null){ this._undoLast = cur; toast('これ以上戻せません'); return; }
    if(!this._undoStack.length){ toast('これ以上戻せません'); return; }
    this._redoStack.push(cur !== null ? cur : this._undoLast);
    this._undoApply(this._undoStack.pop());
    toast('元に戻す');
  },
  redo(){
    clearTimeout(this._undoTimer); this._undoTimer = null;
    if(!this._redoStack.length){ toast('やり直す操作がありません'); return; }
    const cur = this._undoSnap();
    if(cur !== null) this._undoStack.push(cur);
    this._undoApply(this._redoStack.pop());
    toast('やり直す');
  },
  // ─── プリセットライブラリ (動的: 追加/削除可。先頭10件が 1〜0 キー) ───────
  _presetLibKey: 'vj.presets',
  _presetLib: null,
  _loadPresetLib(){
    if(this._presetLib) return this._presetLib;
    let arr = null;
    try{ arr = JSON.parse(localStorage.getItem(this._presetLibKey)||'null'); }catch(e){}
    if(!Array.isArray(arr)){
      arr = [];                                          // 既存の vj.bank.1〜0 から移行
      for(const n of ['1','2','3','4','5','6','7','8','9','0']){
        let s=null; try{ s=JSON.parse(localStorage.getItem('vj.bank.'+n)||'null'); }catch(e){}
        if(s) arr.push({ name:'Preset '+n, state:s });
      }
    }
    this._presetLib = arr;
    this._syncPresetsFromServer();   // 初回のみサーバー(presets/store.php)と同期
    return this._presetLib;
  },
  // github.io 配信では共有ストアは読み取り専用 (閲覧者がサーバーデータを上書きできない)
  _storeWritable(){ try{ return !/\.github\.io$/.test(location.hostname); }catch(e){ return true; } },
  _storeBase(){
    // 本番(同一オリジン)は相対 / ローカル・file:// 等は本番サーバーを参照して同期(store.php が CORS 許可)
    // github.io (静的ホスティング) では PHP が動かないため、共有ストアへ保存する
    try{ if(/\.github\.io$/.test(location.hostname)) return 'https://vj.aratanagara.com/gara-store/store.php'; }catch(e){}
    return 'presets/store.php';
  },
  _presetApiUrl(){ return this._storeBase(); },
  // ローカルキャッシュへ保存。thumb(base64 GIF) はデータの ~88% を占め、
  // 全体が localStorage の 5MB 上限を超えると setItem が QuotaExceededError で失敗する。
  // 以前は握りつぶしていたため「ローカルには保存済み」と言いながら実際は何も残らず、
  // サーバー保存に失敗した回のプリセットが復元不能になっていた。
  // → 超過時は thumb を落とした軽量版で再試行する (thumb は次回描画で作り直せる)。
  _savePresetLocal(json){
    try{ localStorage.setItem(this._presetLibKey, json); return 'full'; }catch(e){}
    try{
      const slim = (this._presetLib||[]).map(p => { const q = Object.assign({}, p); delete q.thumb; return q; });
      localStorage.setItem(this._presetLibKey, JSON.stringify(slim));
      return 'slim';
    }catch(e){}
    if(!this._presetLocalWarned){
      this._presetLocalWarned = true;
      toast('ローカル保存が容量超過で失敗 — サーバー側の履歴から復元できます');
    }
    return 'failed';
  },
  _savePresetLib(){
    const json = JSON.stringify(this._presetLib||[]);
    this._savePresetLocal(json);
    this._savePresetLibServer(json);
  },
  // サーバー一覧の thumb を、手元の thumb 欠け分へ移す (キー一致)。
  //   ローカルキャッシュは容量超過対策で thumb 抜きになるため、同期前に保存が走ると
  //   thumb 抜き一覧でサーバーを上書き = サムネ全滅、が起きていた。その防御。
  _mergeServerThumbs(remote){
    try{
      if(!Array.isArray(remote)) return;
      const seenR = {}, map = {};
      remote.forEach(p => { const k = this._presetKey(p, seenR); if(p && p.thumb) map[k] = p.thumb; });
      const seenL = {};
      (this._presetLib||[]).forEach(p => { const k = this._presetKey(p, seenL); if(p && !p.thumb && map[k]) p.thumb = map[k]; });
    }catch(e){}
  },
  // サーバーへ非同期保存。thumb 欠けがある一覧をそのまま POST するとサーバーの
  // サムネを消してしまうため、初回はサーバー一覧から thumb をマージしてから送る。
  _savePresetLibServer(json){
    const needMerge = !this._presetThumbMerged
                   && (this._presetLib||[]).some(p => p && p.state && !p.thumb);
    if(needMerge){
      fetch(this._presetApiUrl(), {cache:'no-store'})
        .then(r => r.ok ? r.json() : null)
        .then(remote => {
          this._mergeServerThumbs(remote);
          this._presetThumbMerged = true;
          this._savePresetLibServerNow(JSON.stringify(this._presetLib||[]));
        })
        .catch(()=> this._savePresetLibServerNow(json));
      return;
    }
    this._savePresetLibServerNow(json);
  },
  _savePresetLibServerNow(json){
    if(this._storeWritable && !this._storeWritable()) return;
    json = json || JSON.stringify(this._presetLib||[]);
    // 送信直前にローカル墓標で削除済みを除外する。リロードしていない古いセッションが
    // メモリ上の古い一覧を丸ごと POST すると削除済みが復活するため、保存の choke point で毎回濾す。
    // 墓標由来の縮小は「意図した削除」なので force=1 で store.php の縮小ガードを通す
    // (ガードに弾かれると掃除の POST が永遠に成功せず、復活が固定化する)。
    let url = this._presetApiUrl();
    try{
      const dead = new Set(this._loadTombs().map(tb => tb.k));
      if(dead.size){
        const arr = JSON.parse(json);
        if(Array.isArray(arr)){
          const alive = arr.filter(p => !dead.has(this._presetContentKey(p)));
          if(alive.length !== arr.length){
            json = JSON.stringify(alive);
            url += (url.indexOf('?') >= 0 ? '&' : '?') + 'force=1';
          }
        }
      }
    }catch(e){}
    this._presetPendingJson = json;
    let f;
    try{
      f = fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body:json, keepalive: json.length < 60000});
    }catch(e){ this._presetSaveFailed('例外: ' + e); return; }
    f.then(res => {
      if(!res.ok){ this._presetSaveFailed('HTTP ' + res.status); return; }
      if(this._presetPendingJson === json) this._presetPendingJson = null;
      this._presetSaveWarned = false;
    }).catch(e => this._presetSaveFailed(String(e)));
  },
  // ─── プリセット世代履歴 (presets/store.php の history) ───────────────
  //   保存のたびにサーバーへ thumb 抜きスナップショットが残る。ここから復元できる。
  async presetHistoryList(){
    try{
      const res = await fetch(this._presetApiUrl() + '?name=presets&history=1', {cache:'no-store'});
      if(!res.ok) return [];
      const arr = await res.json();
      return Array.isArray(arr) ? arr : [];
    }catch(e){ return []; }
  },
  // 世代を復元。現在の一覧に「その世代にしか無いプリセット」を足す(既存は消さない)。
  async presetHistoryRestore(file){
    let snap = null;
    try{
      const res = await fetch(this._presetApiUrl() + '?name=presets&restore=' + encodeURIComponent(file), {cache:'no-store'});
      if(!res.ok){ toast('履歴の取得に失敗 (HTTP ' + res.status + ')'); return; }
      snap = await res.json();
    }catch(e){ toast('履歴の取得に失敗: ' + e); return; }
    if(!Array.isArray(snap)){ toast('履歴の形式が不正です'); return; }
    const cur = this._loadPresetLib();
    const seenC = {}, ck = new Set(cur.map(p => this._presetKey(p, seenC)));
    const seenS = {};
    const add = snap.filter(p => !ck.has(this._presetKey(p, seenS)));
    if(!add.length){ toast('この世代に、今無いプリセットはありません'); return; }
    this._presetLib = cur.concat(add);
    this._savePresetLib();
    this._tombRemoveMany(add.map(p => this._presetContentKey(p)));   // 復元したので墓標を消す
    if(UI && UI.refreshPresetLib) UI.refreshPresetLib();
    toast('履歴から ' + add.length + ' 件を復元しました (サムネは再生成されます)');
  },
  _presetSaveFailed(why){
    if(!this._presetSaveWarned){
      this._presetSaveWarned = true;
      toast('プリセットのサーバー保存に失敗 (' + why + ') — ローカルには保存済み。再試行します');
    }
    if(this._presetRetryT) return;
    this._presetRetryT = setTimeout(()=>{
      this._presetRetryT = null;
      if(this._presetPendingJson) this._savePresetLibServer(this._presetPendingJson);
    }, 15000);
  },
  // プリセットの同一性キー。id があれば id、無ければ名前 + 同名の出現順。
  //   state の内容は比較に使わない (同じプリセットでもローカルで再保存すると中身が変わり、
  //   別物と誤判定して重複追加になるため)。
  _presetKey(p, seen){
    if(p && p.id) return 'id:' + p.id;
    const base = 'nm:' + ((p && p.name) || '');
    const n = (seen[base] = (seen[base] || 0) + 1);
    return base + '#' + n;
  },
  // ─── 削除の墓標 (tombstone): 消したプリセットの復活防止 ─────────────
  //   古いローカルキャッシュを持つブラウザが起動時同期で「ローカルにしか無い」と
  //   誤認して再アップロードすると、削除済みプリセットが復活してしまう。
  //   削除時に内容キーを墓標として記録し (ローカル + サーバー store)、
  //   同期時に墓標に載っているものを両側の一覧から除外する。
  //   復元 (Cmd+Z / 履歴復元) したときは墓標を消す。180 日で失効。
  _tombLSKey: 'vj.presetTombstones',
  _presetContentKey(p){
    if(p && p.id) return 'id:' + p.id;
    let h = 5381;
    try{
      const str = JSON.stringify((p && p.state) || null);
      for(let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    }catch(e){}
    return 'nk:' + ((p && p.name) || '') + ':' + h.toString(36);
  },
  _loadTombs(){
    try{ const a = JSON.parse(localStorage.getItem(this._tombLSKey) || '[]');
         return Array.isArray(a) ? a : []; }catch(e){ return []; }
  },
  _saveTombsLocal(tombs){
    try{ localStorage.setItem(this._tombLSKey, JSON.stringify(tombs)); }catch(e){}
  },
  _mergeTombs(a, b){
    const m = {};
    [].concat(a || [], b || []).forEach(tb => {
      if(!tb || !tb.k) return;
      if(!m[tb.k] || (tb.t || 0) > m[tb.k].t) m[tb.k] = { k: tb.k, t: tb.t || 0 };
    });
    const cut = Date.now() - 180 * 864e5;
    return Object.values(m).filter(tb => (tb.t || 0) > cut);
  },
  // サーバーの墓標と統合してから mutate を適用し、ローカル保存 + サーバーへ書き戻す
  _syncTombsServer(mutate){
    const apply = (serverTombs)=>{
      let merged = this._mergeTombs(this._loadTombs(), serverTombs || []);
      if(mutate) merged = mutate(merged) || merged;
      this._saveTombsLocal(merged);
      try{ if(this._storeWritable && !this._storeWritable()) throw 0; fetch(this._presetApiUrl() + '?name=presetTombstones',
                 {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(merged)}); }catch(e){}
    };
    fetch(this._presetApiUrl() + '?name=presetTombstones', {cache:'no-store'})
      .then(r => r.ok ? r.json() : [])
      .then(a => apply(Array.isArray(a) ? a : []))
      .catch(()=> apply([]));
  },
  _tombAdd(p){
    const k = this._presetContentKey(p);
    this._syncTombsServer(t => this._mergeTombs(t, [{ k, t: Date.now() }]));
  },
  _tombRemoveMany(keys){
    const set = new Set(keys || []);
    if(!set.size) return;
    this._syncTombsServer(t => t.filter(x => !set.has(x.k)));
  },

  // サーバーとローカルを初回だけ同期。サーバーを基準にしつつ、ローカルにしか無いものは足して
  // 押し戻す (POST 取りこぼし・オフラインで追加した分が消えないようにするため)。
  // 墓標に載っているものは「オフライン追加」ではなく「削除済み」なので復元しない。
  async _syncPresetsFromServer(){
    if(this._presetSynced) return; this._presetSynced = true;
    let remote = null, offline = false;
    try{
      const res = await fetch(this._presetApiUrl(), {cache:'no-store'});
      if(res.ok) remote = await res.json();
    }catch(e){
      // サーバー到達不可 → 同梱の静的スナップショット (presets/presets.json) へフォールバック。
      // ローカル配信 (http.server 等) でのオフライン運用向け。読むだけでサーバーへは押し戻さない。
      remote = await this._loadPresetSnapshot();
      if(!Array.isArray(remote)) return;   // スナップショットも無ければローカルのまま
      offline = true;
      toast('オフライン: 同梱プリセット ' + remote.length + ' 件を読み込みました');
    }
    if(!Array.isArray(remote)) return;
    const local = this._presetLib || [];
    if(remote.length === 0 && local.length){
      if(!offline) this._savePresetLibServer();   // サーバー空 & ローカルに既存 → 移行アップロード
      return;
    }
    // 墓標を取得・統合し、削除済みを両側から除外 (復活防止)
    let tombs = this._loadTombs();
    try{
      const tr = await fetch(this._presetApiUrl() + '?name=presetTombstones', {cache:'no-store'});
      if(tr.ok){ const ta = await tr.json(); if(Array.isArray(ta)) tombs = this._mergeTombs(tombs, ta); }
    }catch(e){}
    this._saveTombsLocal(tombs);
    const dead = new Set(tombs.map(tb => tb.k));
    const remoteAlive = remote.filter(p => !dead.has(this._presetContentKey(p)));
    const remoteHadDead = remoteAlive.length !== remote.length;
    remote = remoteAlive;
    const seenR = {}, rk = new Set(remote.map(p => this._presetKey(p, seenR)));
    const seenL = {};
    const localOnly = local.filter(p => !rk.has(this._presetKey(p, seenL))
                                     && !dead.has(this._presetContentKey(p)));
    this._presetLib = localOnly.length ? remote.concat(localOnly) : remote;
    // ローカル (このセッションで撮った thumb) がサーバー側に無ければ残す
    {
      const seenL2 = {}, lmap = {};
      local.forEach(p => { const k = this._presetKey(p, seenL2); if(p && p.thumb) lmap[k] = p.thumb; });
      const seenM = {};
      this._presetLib.forEach(p => { const k = this._presetKey(p, seenM); if(p && !p.thumb && lmap[k]) p.thumb = lmap[k]; });
    }
    this._presetThumbMerged = true;
    this._savePresetLocal(JSON.stringify(this._presetLib));
    if((localOnly.length || remoteHadDead) && !offline){
      this._savePresetLibServer();   // ローカルにしか無い分の復元 / 墓標ぶんの削除を反映
      if(localOnly.length) toast('サーバーに無いプリセット ' + localOnly.length + ' 件を復元してアップロードしました');
    }
    if(typeof UI !== 'undefined' && UI.refreshPresetLib) UI.refreshPresetLib();
  },
  // store.php 不通時の読み取り専用フォールバック。deploy.sh が毎回サーバー全件を
  // presets/presets.json にバックアップしているので、ローカル配信でもそれを読める。
  async _loadPresetSnapshot(){
    try{
      const res = await fetch('presets/presets.json', {cache:'no-store'});
      if(res.ok){ const a = await res.json(); if(Array.isArray(a)) return a; }
    }catch(e){}
    return null;
  },
  _capturePresetState(){
    // 各モード(inkelly 等)の設定や post は App の生オブジェクト参照なので、JSON で深いコピーを取り
    // スナップショット化する(同一セッション内で保存→変更→再呼出しても保存時の値=INKELLYの色等が復元される)。
    const data = JSON.parse(JSON.stringify(this._collectState()));
    // beat×A (beatScale) は演奏中に手で決めるライブ設定 → プリセットには保存しない
    data.mixControls = this._captureMixControls();
    // MIDI相対は全Visual共通の端末設定。プリセットには保存しない。
    delete data.midiRelative; delete data.midiRelMode; delete data.midiRelStep;
    // 保存: Shader / Mix(Blend・crossfade) / Visual Beat / Overlay / Post FX / 各mode。除外: テンポ・Transition・Style・Audio FX。
    delete data.bpm;
    delete data.beatMode;                    // beat / drone は演奏中に手で決めるライブ設定
    delete data.transBeats; delete data.transStyle;
    if(data.post){
      const AUDIO_FX = ['audioTarget','audioGain','audioBand','audioAttack','aScan','aRgb','aStrobe','aShock','aExplode'];
      AUDIO_FX.forEach(k => delete data.post[k]);   // Post FX は保存 / Audio FX のみ除外
    }
    return data;
  },
  // Slot A の出力から主要色 4 色(暗→明)を抽出 → Auto Palette(uPalette==8)の色に使う
  extractSlotAPalette(){
    try{
      // 抽出元: Auto Map 正 = Slot A (B を A に合わせる) / 負 = Slot B (A を B に合わせる)
      const gl = GL.gl, slot = GL.slots[((this.post && this.post.paletteAmt) || 0) < 0 ? 'B' : 'A'];
      if(!gl || !slot || !slot.fbos) return false;
      const src = slot.fbos[slot.fbIdx ^ 1];
      if(!src || !src.fbo) return false;
      // Slot A は RGBA16F(HALF_FLOAT)で UNSIGNED_BYTE/FLOAT 読み不可 → 小さな RGBA8 へ blit して読む
      const tw = 128, th = Math.max(1, Math.round(128 * src.h / src.w));
      let d = this._palFBO;
      if(!d || d.w !== tw || d.h !== th){
        if(d){ gl.deleteFramebuffer(d.fbo); gl.deleteTexture(d.tex); }
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        d = this._palFBO = { fbo, tex, w: tw, h: th };
      }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, d.fbo);
      gl.blitFramebuffer(0, 0, src.w, src.h, 0, 0, tw, th, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, d.fbo);
      this._palPending = true;
      GL.asyncReadPixels(tw, th, (px)=>{   // 非同期: パレットが数フレーム遅れて更新されるだけ
        this._palPending = false;
        this._autoPalRetry = !(px && this._applyExtractedPalette(px));
      });
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return true;
    }catch(e){ return false; }
  },
  // 読み戻した縮小ピクセルから 4 色パレットを構築 (成功時 true)
  _applyExtractedPalette(px){
    try{
      const sum = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
      let total = 0;
      for(let i=0;i<px.length;i+=4){
        const r=px[i]/255, g=px[i+1]/255, b=px[i+2]/255;
        if(r+g+b < 0.06) continue;                            // 背景(黒)は除外
        const L = 0.299*r + 0.587*g + 0.114*b;
        const bk = Math.max(0, Math.min(3, Math.floor(L*4)));
        sum[bk][0]+=r; sum[bk][1]+=g; sum[bk][2]+=b; sum[bk][3]++; total++;
      }
      if(total < 8) return false;                             // ほぼ真っ黒 → 既存パレット維持(黒つぶれ防止)
      const pal = [];
      for(let k=0;k<4;k++){ const s=sum[k]; pal[k] = s[3]>0 ? [s[0]/s[3], s[1]/s[3], s[2]/s[3]] : null; }
      for(let k=0;k<4;k++) if(!pal[k]){                       // 空バケットは隣接から補間
        const a = pal[k-1] || pal[k+1] || [k/3, k/3, k/3];
        const b = pal[k+1] || pal[k-1] || a;
        pal[k] = [(a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2];
      }
      // 最明色が暗い場合は引き上げて黒つぶれを防ぐ(色相は保つ)
      const lum = c => 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
      const top = lum(pal[3]);
      if(top > 0.02 && top < 0.55){ const k = 0.8 / top; for(let j=1;j<4;j++) pal[j] = pal[j].map(v => Math.min(1, v*k)); }
      this._autoPal = pal;
      return true;
    }catch(e){ return false; }
  },
  // 最終出力のスナップショット (全mode対応のサムネ dataURL)。失敗時は null。
  _grabPresetThumb(){
    try{ return (typeof GL !== 'undefined' && GL.grabThumbDataURL) ? GL.grabThumbDataURL(256) : null; }catch(e){ return null; }
  },
  // プリセットのサムネ用 GIF アニメ: 現出力を一定間隔でキャプチャ → gif.js でエンコード。失敗時 null。
  _captureGifThumb(opts){
    opts = opts || {};
    const maxW = opts.maxW || 128, frames = opts.frames || 16, delay = opts.delay || 70;
    return new Promise((resolve)=>{
      try{
        if(typeof GIF === 'undefined' || typeof GL === 'undefined' || !GL.grabThumbCanvas){ resolve(null); return; }
        const first = GL.grabThumbCanvas(maxW);
        if(!first){ resolve(null); return; }
        const gif = new GIF({ workers: 2, quality: 8, width: first.width, height: first.height, workerScript: 'gif.worker.js', dither: false });
        let k = 0;
        const grab = ()=>{
          const cv = (k === 0) ? first : GL.grabThumbCanvas(maxW);
          if(cv) gif.addFrame(cv, { copy: true, delay: delay });
          k++;
          if(k < frames){ setTimeout(grab, delay); }
          else {
            gif.on('finished', (blob)=>{ const r = new FileReader(); r.onload = ()=>resolve(r.result); r.onerror = ()=>resolve(null); r.readAsDataURL(blob); });
            gif.render();
          }
        };
        grab();
      }catch(e){ resolve(null); }
    });
  },
  // Mode の共通 GIF サムネをサーバー(modegifs.json)から取得 → UI._modeGifMap (全端末共通)
  async _loadModeGifs(){
    try{
      const r = await fetch(this._storeBase() + '?name=modegifs', {cache:'no-cache'});
      if(r.ok){
        const d = await r.json();
        if(d && typeof d === 'object' && !Array.isArray(d) && typeof UI !== 'undefined'){
          UI._modeGifMap = d;
          if(UI.populatePresets) UI.populatePresets();
        }
      }
    }catch(e){}
  },
  // Mode GIF をサーバーへ保存 (全端末共通)。{slug: dataURL} を累積 POST。
  async _saveModeGif(slug, dataUrl){
    try{
      const cur = (typeof UI !== 'undefined' && UI._modeGifMap) ? UI._modeGifMap : {};
      cur[slug] = dataUrl;
      if(typeof UI !== 'undefined') UI._modeGifMap = cur;
      if(this._storeWritable && !this._storeWritable()) return;
      await fetch(this._storeBase() + '?name=modegifs', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(cur)});
    }catch(e){}
  },
  // Visual の Mode タイル用 GIF サムネ。Mode はオフスクリーン描画不可のため、一時的にその
  // モードをロードして実出力を GIF 化し、終わったら元の状態へ自動復元する。
  captureVisualGif(i){
    const p = PRESETS[i]; if(!p) return;
    if(this._capturingGif){ toast('別のGIF生成中です'); return; }
    this._confirm(p.name + ' のGIFサムネを現在の表示で更新しますか？', ()=>{
      this._capturingGif = true;
      toast(p.name + ' のGIFサムネを生成中…(現在の表示から)');
      // Visual は切り替えず、現在の出力をそのまま GIF 化 (そのモードを表示中に押す運用)
      this._captureGifThumb({ maxW:128, frames:16, delay:70 }).then(gif=>{
        this._capturingGif = false;
        if(!gif){ toast('GIF生成に失敗'); return; }
        const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        this._saveModeGif(slug, gif);   // サーバー(全端末共通)に保存・固定
        if(UI && UI.populatePresets) UI.populatePresets();
        toast(p.name + ' GIFサムネ更新完了');
      });
    });
  },
  // Movie タイル用 GIF サムネ: 動画をロードして実出力を GIF 化しサーバー保存 (全端末共通)
  captureMovieGif(url, name){
    if(this._capturingGif){ toast('別のGIF生成中です'); return; }
    this._confirm((name||'動画') + ' のGIFサムネを現在の表示で更新しますか？', ()=>{
      this._capturingGif = true;
      toast((name||'動画') + ' のGIFサムネを生成中…(現在の表示から)');
      // Visual は切り替えず、現在の出力をそのまま GIF 化 (その動画を表示中に押す運用)
      this._captureGifThumb({ maxW:128, frames:16, delay:70 }).then(gif=>{
        this._capturingGif = false;
        if(!gif){ toast('GIF生成に失敗'); return; }
        const slug = 'movie_' + (name||'').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        this._saveModeGif(slug, gif);
        if(UI && UI.populatePresets) UI.populatePresets();
        toast((name||'動画') + ' GIFサムネ更新完了');
      });
    });
  },
  presetAdd(name){
    const lib = this._loadPresetLib();
    lib.push({ id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
               name: name || ('Preset '+(lib.length+1)), state: this._capturePresetState(), thumb: this._grabPresetThumb() });
    this._savePresetLib();
    if(UI && UI.refreshPresetLib) UI.refreshPresetLib();
    toast('プリセットを追加');
  },
  // 固定 Preset 0: 全パラメータをデフォルトに初期化 + 両スロットを「なし(透明)」に (上書き不可)
  presetBlankBoth(){
    const N = this.transBeats || 0, style = this.transStyle || 0;   // reset で消える前に退避
    if(N > 0 && typeof GL !== 'undefined' && GL.startPresetTrans) GL.startPresetTrans(N, style);  // 現出力を退避→クロスフェード
    this.resetToDefaults();                 // 全 FX / 設定をデフォルトへ
    const ni = PRESETS.findIndex(p=>p && p.kind==='none');
    const idx = ni < 0 ? 0 : ni;
    this.loadPreset(idx, 'A');              // 両スロットなし
    this.loadPreset(idx, 'B');
    if(this.resetUserPanZoom) this.resetUserPanZoom();
    if(UI && UI.refreshAll) UI.refreshAll();
    toast('Preset 0: 全パラメータ初期化');
  },
  presetApply(i){
    const lib = this._loadPresetLib();
    const p = lib[i];
    if(!p || !p.state){ toast('プリセット '+(i+1)+' は空です'); return; }
    if(typeof GL !== 'undefined' && GL.startPresetTrans) GL.startPresetTrans(this.transBeats||0, this.transStyle||0);  // 現出力を退避→Beat拍で転換
    // beat×A (beatScale) は演奏中に手で決める設定なので、プリセット呼出では復元しない
    this._applyState(p.state, {restoreOverlayEnabled:true, restoreBeatScale:false, restoreBeatMode:false, restoreMixControls:true, resetMissingDefaults:true});
    if(typeof GL !== 'undefined' && GL.forceRenderOnce) GL.forceRenderOnce();   // Draw フリーズ / Pause 中でも呼出結果を即反映
    // 実値が入れ替わり MIDI つまみの物理位置とズレるので、基準点を通すまで取り込み待ちにする
    if(typeof MIDI !== 'undefined' && MIDI.armPickup) MIDI.armPickup();
    if(UI && UI.refreshAll) UI.refreshAll();
    toast('プリセット: '+p.name);
    this._undoSchedule();
    if(!p.thumb){   // 未取得プリセットは描画後にスナップショットを保存 (移行バンク等を順次補完)。転換完了を待つ。
      const cap = ()=>{
        if(p.thumb) return;
        if(typeof GL !== 'undefined' && GL._presetTr && GL._presetTr.on){ setTimeout(cap, 300); return; }
        const t = this._grabPresetThumb();
        if(t){ p.thumb = t; this._savePresetLib(); if(UI && UI.refreshPresetLib) UI.refreshPresetLib(); }
      };
      setTimeout(cap, 400);
    }
  },
  // Grad / Blend プレビュー (プレビュー欄の上下のバー) の表示トグル。負荷対策で消せる。
  mixPrevVisible: true,
  applyMixPrevVisible(){
    const g = document.getElementById('gradQuickBar'), b = document.getElementById('blendPrevBar');
    const gi = document.getElementById('gradQuickBarInv');
    const v = this.mixPrevVisible ? '' : 'none';
    if(g) g.style.display = v;
    if(gi) gi.style.display = v;
    if(b) b.style.display = v;
    if(this.mixPrevVisible && typeof GL !== 'undefined' && GL.requestMixPreview) GL.requestMixPreview('all');
  },
  toggleMixPreviews(){
    this.mixPrevVisible = !this.mixPrevVisible;
    try{ localStorage.setItem('vj.mixPrev', this.mixPrevVisible ? '1' : '0'); }catch(e){}
    this.applyMixPrevVisible();
    toast(this.mixPrevVisible ? 'Grad / Blend プレビュー: 表示' : 'Grad / Blend プレビュー: 非表示');
  },
  // 映像に掛ける色相回転量。Hue Shift は常にライブで最終出力へ掛かる (Grad Map の後段)。
  //   Grad Map ON のときは Grad 出力の色相が回る = パレットを回すのと同じ色になる
  //   (hueShift は線形変換なので「ストップを回してから写像」と「写像後に回す」は同一)。
  //   焼き込み・確定を廃止したので、値を戻せば色も必ず元に戻る (可逆)。
  //   手動 Hue は 1.0 = 180°(*0.5) / 自動ローテートは加算。
  imageHue(p){
    const P = p || this.post || {};
    return (P.hue || 0) * 0.5 + (P.hueAuto || 0);
  },
  // Hue Shift (post.hue) を掛けたストップを返す (プレビュー表示用。出力はシェーダが Grad 後段でライブに回す)。
  hueRotatedStops(stops){
    const ge = (typeof UI !== 'undefined') ? UI._gradEditor : null;
    if(!ge || !ge._hueShifted) return stops.map(s=>({t:s.t, rgb:s.rgb.slice()}));
    return stops.map(s=>({t:s.t, rgb:ge._hueShifted(s.rgb)}));
  },
  applyGradPreset(n){   // n: 0..8 = Grad Preset (キー 1〜9) / 9 = 通常色 = Grad Map OFF (キー 0)
    const ge = (typeof UI !== 'undefined') ? UI._gradEditor : null;
    if(!ge) return;
    if(n === 9){                        // 通常色: Grad Map を切るだけ (Hue Shift はライブのまま = 色は確定しない)
      this.fadePostNum('gradMix', 0);
      this._activeGradPreset = 9;
      if(UI.refreshPost) UI.refreshPost();
      if(UI._refreshGradList) UI._refreshGradList();
      toast('通常色 (Grad Map OFF)');
      return;
    }
    const list = (typeof UI !== 'undefined' && UI._gradStore) ? UI._gradStore.list : [];
    const item = list[n];
    if(!item || !item.stops){ toast('Grad '+(n+1)+' は空'); return; }
    // 同じ数字を 2 回押しても解除しない。Grad Map を切るのは 0 (通常色)。
    // Param Fade: gradMix を一度 0 へ落として色を差し替え、目標値まで戻す(即時なら従来どおり)
    const curMix = this.post.gradMix || 0;
    const targetMix = (Math.abs(curMix) > 0.0001) ? curMix : 1.0;
    // ストップは保存色のまま適用する (焼き込みなし)。Hue Shift はシェーダで Grad 出力の
    // 後段にライブで掛かるので、見た目は従来 (回したパレット) と同一で、かつ可逆。
    this.fadeGradTo(item.stops.map(s=>({t:s.t, rgb:s.rgb.slice()})), targetMix);
    this._activeGradPreset = n;
    if(UI.refreshPost) UI.refreshPost();
    if(UI._refreshGradList) UI._refreshGradList();
    toast('Grad: '+item.name);
  },
  presetOverwrite(i, name){
    const lib0 = this._loadPresetLib();
    const nm = name || (lib0[i] && lib0[i].name) || ('Preset '+(i+1));
    this._confirm('プリセット「'+nm+'」を現在の状態で上書きしますか？', ()=>{
      const lib = this._loadPresetLib();
      while(lib.length <= i) lib.push({ name:'Preset '+(lib.length+1), state:null });
      lib[i] = { name: name || (lib[i] && lib[i].name) || ('Preset '+(i+1)), state: this._capturePresetState(), thumb: this._grabPresetThumb() };
      this._savePresetLib();
      if(UI && UI.refreshPresetLib) UI.refreshPresetLib();
      toast('プリセット '+(i+1)+' を上書き — GIF生成中…');
      // 更新のたびに GIF アニメサムネを生成して差し替え
      this._captureGifThumb({ maxW:128, frames:16, delay:70 }).then(gif=>{
        if(!gif){ toast('GIF生成に失敗 (静止画のまま)'); return; }
        const cur = this._loadPresetLib();
        if(cur[i]){ cur[i].thumb = gif; this._savePresetLib(); if(UI && UI.refreshPresetLib) UI.refreshPresetLib(); toast('プリセット '+(i+1)+' GIF更新完了'); }
      });
    });
  },
  presetRename(i, name){
    const lib = this._loadPresetLib();
    if(lib[i]){ lib[i].name = name; this._savePresetLib(); }
  },
  presetDelete(i){
    const lib = this._loadPresetLib();
    if(i<0 || i>=lib.length) return;
    const nm = lib[i].name;
    this._confirm('プリセット「'+nm+'」を削除しますか？', ()=>{
      const del = lib[i];
      lib.splice(i,1);
      this._savePresetLib();
      this._tombAdd(del);                                   // 墓標: 同期での復活を防ぐ
      this._delPresetStack.push({ item: del, index: i });   // 戻る(Cmd+Z)で復元できるよう退避
      if(this._delPresetStack.length > 30) this._delPresetStack.shift();
      if(UI && UI.refreshPresetLib) UI.refreshPresetLib();
      toast('削除: '+nm+'(戻るで復元可)');
    });
  },
  // before=true: to の手前へ / false: to の後ろへ挿入 (Visual タブの shaderReorder と同仕様)
  presetReorder(from, to, before){
    const lib = this._loadPresetLib();
    if(from<0 || from>=lib.length || to<0 || to>=lib.length || from===to) return;
    const [it] = lib.splice(from, 1);
    const ti = (to > from) ? to - 1 : to;   // 取り除いた後の to の位置
    lib.splice(before ? ti : ti + 1, 0, it);
    this._savePresetLib();
    if(UI && UI.refreshPresetLib) UI.refreshPresetLib();
  },
  // ─── シェーダ(PRESETS カタログ)のドラッグ並べ替え ────────────────────
  _isShaderPreset(p){
    if(!p || p.kind === 'none' || p.kind === 'video') return false;
    const MODE_KINDS = ['none','layer','manga','video','aratanagara','slicer','cyberui','novel','inkelly','boltzmann','grayscott','pen','caverns','shelf','ribbon','photoplane','image','textdeform','ugomeki','spacetype','shredder'];
    const SHADER_ENGINES = ['caverns','boltzmann','grayscott','inkelly','ribbon'];
    return !(MODE_KINDS.includes(p.kind) && !SHADER_ENGINES.includes(p.kind));
  },
  // 既定のシェーダ並び順(本番 vj.aratanagara.com の現行順を焼き込み)。
  //   localStorage['vj.shaderOrder'] が無いとき(新規ブラウザ/ローカル)にこの順を適用 → 本番と sid が一致。
  _defaultShaderOrder: ["Webcam Mirror","Ribbon Surface (7tBGDd)","★ SDF CAVERNS (Triquadratic)","★ INKELLY (Feedback Ink)","★ BOLTZMANN (Fluid)","Alien Megacity (tlBcDh)","Flight Over Dunes (3syGWc)","Krypto Planes (MdVBRy)","Viscous Drip (ttVcRt/tlKcDd)","Fractal Junkyard Glitch (dsBGRh)","Deterioration (3dBSW3)","Diffraction Grating (Ds2XRd)","Tunnel of Bones (3lByWh)","OSTSEE (mdjXDd)","Alien Neurons Glitch (ctsyDj)","Bechamel (4djBzz)","Vangogh","Meguru","Hinotori_03","Hinotori_01","Hinotori_02","NdsSzl","newSinFract","cos20","sinFBM","Liquid","moreFract","crystalPath","mandelbaum","metalSlab","Iridiscious","Rainbow Water","Water","Watercolors","Flowing Metal","Rain (B/W)","Flowers (CPPN)","Echeveria (Chrome)","fLOWER","Voronoi Marble","Rave Cube (Chrome)","Matrix Decon","Ghost Chamber","Matrix Julia (R/B/Silver)","TRON Clouds","Spell Demon Souls","Liquicolor","Crystal Ice Flight","Noise Racer","Bone Tunnel","Sine Deform","Paper Fractal (Blue)","Formation","Origami","Another Abstract","Reflective Ribbon","Grey Liquid","Slime Frame (Chrome)","Patch SDF (Chrome)","Spiky (Chrome)","Twistors (Chrome)","KuKo Helix","Color Puffs","Spike Ball (Audio Chrome)","Space Shield (Asagi)","Storming Pixels","Liquid Mountains (Chrome)","Discharge","Crystal Flow (Julia)","Crystal Noise","ROMHACK (CD)","Nebula","Nitrostasis","Fragile (Glass)","Stractium","ngRay (Morph Blobs)","Manga","Wildstyle SDF","Cube Surface II (Mty3DV)","Hand Model (msSXDc)","HV Splits (MlcGRl)","Metal Meta (4ssGWS)","Spicy Plasma (DsffWM)","Ice Cave Spikes (w3GSR3)","Strange Lab Goop (dt2cD3)","Gyroid Cavern","Jungle Burrow (Wd23RD)","4D Julia Fractal (tt2fRw)","Glitch Aesthetic (wfjfRm)","EvilSeed (llBGRd)","SigInt Bands (4syfDV)","Cave at the Edge of the Universe (ttfBDH)","Wierd Moving Voronoi (WsX3zS)","Klaksrotate (MljyDt)","Smoked Cherry (4cBcz1)","Polar Rings (ctsfWM)","City Maker (lscGz2)","Flickering Crystals (tdSfRd)","Redmond Wrinkle Petals (7lGyD1)","Distant Rings of Light (3ssfD8)","Cellular Tiling Clouds (NscSWs)"],
  // 保存済みの並び順(名前配列)に合わせて PRESETS 内のシェーダ項目を並べ替える(非シェーダの位置は不変)
  _applyShaderOrder(){
    let order = null;
    try{ order = JSON.parse(localStorage.getItem('vj.shaderOrder') || 'null'); }catch(e){}
    if(!Array.isArray(order) || !order.length) order = this._defaultShaderOrder;   // 既定=本番の現行並び順
    if(!Array.isArray(order) || !order.length) return;
    const pos = [];
    PRESETS.forEach((p, i)=>{ if(this._isShaderPreset(p)) pos.push(i); });
    const shaders = pos.map(i => PRESETS[i]);
    shaders.sort((a, b)=>{
      let ia = order.indexOf(a.name), ib = order.indexOf(b.name);
      if(ia < 0) ia = 1e9; if(ib < 0) ib = 1e9;
      return ia - ib;
    });
    pos.forEach((i, k)=>{ PRESETS[i] = shaders[k]; });
  },
  shaderReorder(fromIdx, toIdx, before){
    if(!this._isShaderPreset(PRESETS[fromIdx]) || !this._isShaderPreset(PRESETS[toIdx]) || fromIdx === toIdx) return;
    const names = PRESETS.filter(p => this._isShaderPreset(p)).map(p => p.name);
    const fromName = PRESETS[fromIdx].name, toName = PRESETS[toIdx].name;
    const fi = names.indexOf(fromName);
    if(fi >= 0) names.splice(fi, 1);
    let ti = names.indexOf(toName);
    if(ti < 0) return;
    names.splice(before ? ti : ti + 1, 0, fromName);
    try{ localStorage.setItem('vj.shaderOrder', JSON.stringify(names)); }catch(e){}
    if(UI && UI.populatePresets) UI.populatePresets();
  },
  // ─── プリセットバンク (数字キー 1〜0 に全状態を保存/呼出) ───────────────
  saveBank(n){
    let exists = false;
    try{ exists = !!localStorage.getItem('vj.bank.'+n); }catch(e){}
    const msg = exists ? `Bank ${n} を上書き保存しますか？（既存の保存は消えます）`
                       : `Bank ${n} に現在の状態を保存しますか？`;
    this._confirm(msg, ()=>{
      const data = this._collectState();
      // バンクには BPM / Transition は含めない (テンポ・演出は維持したまま構成だけ切替)
      delete data.bpm; delete data.transBeats; delete data.transStyle;
      try{ localStorage.setItem('vj.bank.'+n, JSON.stringify(data)); }catch(e){}
      if(UI && UI.refreshBanks) UI.refreshBanks();
      toast('Bank '+n+' に保存');
    });
  },
  // Enter=OK / Esc=キャンセル に対応した確認モーダル (フルスクリーン/VJ でも確実に動作)
  _confirm(message, onOk){
    if(this._confirmClose) this._confirmClose();   // 既存があれば閉じる
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:1000000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)';
    const box = document.createElement('div');
    box.style.cssText = 'background:#1a1a22;border:1px solid #444;border-radius:8px;padding:18px 20px;max-width:360px;color:#eee;font:13px/1.5 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.6)';
    const p = document.createElement('div'); p.textContent = message; p.style.marginBottom = '14px';
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
    const cancel = document.createElement('button'); cancel.textContent = 'キャンセル (Esc)';
    cancel.style.cssText = 'padding:6px 12px;border-radius:6px;border:1px solid #555;background:#2a2a33;color:#ccc;cursor:pointer';
    const ok = document.createElement('button'); ok.textContent = 'OK (Enter)';
    ok.style.cssText = 'padding:6px 12px;border-radius:6px;border:1px solid #6a5cff;background:#6a5cff;color:#fff;cursor:pointer';
    row.appendChild(cancel); row.appendChild(ok); box.appendChild(p); box.appendChild(row); ov.appendChild(box);
    document.body.appendChild(ov);
    const close = ()=>{ try{ ov.remove(); }catch(e){} window.removeEventListener('keydown', onKey, true); this._confirmClose = null; };
    const doOk = ()=>{ close(); if(onOk) onOk(); };
    const onKey = (e)=>{
      if(e.key === 'Enter'){ e.preventDefault(); e.stopImmediatePropagation(); doOk(); }
      else if(e.key === 'Escape'){ e.preventDefault(); e.stopImmediatePropagation(); close(); }
    };
    window.addEventListener('keydown', onKey, true);   // capture でアプリ側の keydown より先に処理
    ok.addEventListener('click', doOk);
    cancel.addEventListener('click', close);
    ov.addEventListener('click', e=>{ if(e.target === ov) close(); });   // 背景クリックでキャンセル
    ok.focus();
    this._confirmClose = close;
  },
  // window.prompt の代替 (Electron では prompt() が使えず、リネーム系が無反応になる)。
  // _confirm と同じ DOM モーダル + テキスト入力。onOk(value) はキャンセル時は呼ばれない。
  _prompt(message, defValue, onOk){
    if(this._confirmClose) this._confirmClose();
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:1000000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)';
    const box = document.createElement('div');
    box.style.cssText = 'background:#1a1a22;border:1px solid #444;border-radius:8px;padding:18px 20px;min-width:280px;max-width:400px;color:#eee;font:13px/1.5 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.6)';
    const p = document.createElement('div'); p.textContent = message; p.style.marginBottom = '10px';
    const input = document.createElement('input');
    input.type = 'text'; input.value = defValue == null ? '' : String(defValue);
    input.style.cssText = 'width:100%;box-sizing:border-box;margin-bottom:14px;padding:6px 8px;border-radius:6px;border:1px solid #555;background:#111118;color:#eee;font:13px system-ui,sans-serif';
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
    const cancel = document.createElement('button'); cancel.textContent = 'キャンセル (Esc)';
    cancel.style.cssText = 'padding:6px 12px;border-radius:6px;border:1px solid #555;background:#2a2a33;color:#ccc;cursor:pointer';
    const ok = document.createElement('button'); ok.textContent = 'OK (Enter)';
    ok.style.cssText = 'padding:6px 12px;border-radius:6px;border:1px solid #6a5cff;background:#6a5cff;color:#fff;cursor:pointer';
    row.appendChild(cancel); row.appendChild(ok);
    box.appendChild(p); box.appendChild(input); box.appendChild(row); ov.appendChild(box);
    document.body.appendChild(ov);
    const close = ()=>{ try{ ov.remove(); }catch(e){} window.removeEventListener('keydown', onKey, true); this._confirmClose = null; };
    const doOk = ()=>{ const v = input.value; close(); if(onOk) onOk(v); };
    const onKey = (e)=>{
      e.stopImmediatePropagation();   // 入力中のキーをアプリのホットキーへ流さない
      if(e.key === 'Enter'){ e.preventDefault(); doOk(); }
      else if(e.key === 'Escape'){ e.preventDefault(); close(); }
    };
    window.addEventListener('keydown', onKey, true);
    ok.addEventListener('click', doOk);
    cancel.addEventListener('click', close);
    ov.addEventListener('click', e=>{ if(e.target === ov) close(); });
    input.focus(); input.select();
    this._confirmClose = close;
  },
  loadBank(n){
    let s = null;
    try{ s = JSON.parse(localStorage.getItem('vj.bank.'+n)||'null'); }catch(e){}
    if(!s){ toast('Bank '+n+' は空です'); return; }
    this._applyState(s);
    if(UI && UI.refreshAll) UI.refreshAll();
    toast('Bank '+n+' を呼出');
    this._undoSchedule();
  },
  // 0 キー: すべての FX / 設定をデフォルトへ戻す (スロットのシェーダ選択は維持)
  resetToDefaults(){
    // 進行中の Param Fade を破棄してから直接代入する (でないと数フレーム後にフェードが上書きする)
    this._paramFades.length = 0;
    this._gradFade = null;
    this._activeGradPreset = 9;   // gradMix を 0 へ戻すので「通常色」状態も合わせておく
    if(typeof MIDI !== 'undefined' && MIDI.armPickup) MIDI.armPickup();   // つまみ位置とズレるので取り込み待ちへ
    if(this.postDefaults) Object.assign(this.post, this.postDefaults());
    this.crossfade = 1.0;
    this.blendMode = 'mix';
    this.slotVisible = {A:true, B:true};
    this.gamma = 1.0;
    this.transBeats = 0; this.transStyle = 0;
    if(typeof Overlay !== 'undefined'){
      Overlay.P.enabled = false;
      if(Overlay.clear) Overlay.clear();
    }
    if(typeof Audio !== 'undefined'){ Audio.hit = 0; Audio.react = 0; }
    Object.assign(this.audioTime, this.audioTimeDefaults());   // Audio Transport も初期値へ
    this._audioSpeedMul = 1; this._atHitOn = false; this.timeDir = 1;
    // デプロイ既定(defaults.json)を上書き適用してから UI 全更新
    this.applyServerDefaults();
    if(UI && UI.refreshAll) UI.refreshAll();
    toast('すべてデフォルトに戻しました');
    this._undoSchedule();
  },
  // 自動保存 (定期 + 終了時)。最後に表示していた状態を復帰用に残す。
  _autosaveStart(){
    if(this._autosaveTimer) return;
    this._autosaveTimer = setInterval(()=>{ try{ this.saveLocal(); }catch(e){} }, 3000);
    window.addEventListener('beforeunload', ()=>{ try{ this.saveLocal(); }catch(e){} });
  },
  // ─── 保存デフォルト (vj.def.*) のサーバー同期 ─────────────────────
  //   localStorage は端末ローカルなので、モバイル等の別端末では「デフォルト保存」した値が
  //   反映されない。起動時にサーバー store (?name=defs) から localStorage へ流し込み、
  //   保存のたびに全キーをアップロードする。MIDI まわり (midiRelative / ctlDefaults) は
  //   端末依存の設定なので同期しない。
  _defsSyncSkip: ['midiRelative', 'ctlDefaults'],
  _defsUrl(){ return this._storeBase() + '?name=defs'; },
  async _loadServerDefs(){
    try{
      let server = null;
      try{
        const r = await fetch(this._defsUrl(), {cache:'no-store'});
        if(r.ok){ const d = await r.json(); if(d && typeof d === 'object' && !Array.isArray(d)) server = d; }
      }catch(e){}
      if(!server) return;   // 到達不可/形式不正 → 何もしない (誤アップロードでサーバーを潰さない)
      // サーバー値を localStorage へ (キーの値はサーバーが正。明示的な「デフォルト保存」だけが値を更新する)
      for(const k in server){
        if(this._defsSyncSkip.indexOf(k) >= 0) continue;
        try{ localStorage.setItem('vj.def.' + k, JSON.stringify(server[k])); }catch(e){}
      }
      // この端末にしか無いキーはサーバーへ追加する (既存キーの値は変えない)。
      // 「サーバーが空のときだけ種まき」だと、別端末が先に少数キーを載せた時点で
      // 本命端末の一式が永遠にアップロードされなくなるため、常に不足分をマージする。
      let added = false;
      for(let i = 0; i < localStorage.length; i++){
        const key = localStorage.key(i);
        if(!key || key.indexOf('vj.def.') !== 0) continue;
        const k = key.slice('vj.def.'.length);
        if(this._defsSyncSkip.indexOf(k) >= 0 || Object.prototype.hasOwnProperty.call(server, k)) continue;
        try{ server[k] = JSON.parse(localStorage.getItem(key)); added = true; }catch(e){}
      }
      if(added){
        if(this._storeWritable && !this._storeWritable()) return;
        fetch(this._defsUrl(), {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(server)}).catch(()=>{});
      }
    }catch(e){}
  },
  uploadDefs(){
    try{
      const out = {};
      for(let i = 0; i < localStorage.length; i++){
        const key = localStorage.key(i);
        if(!key || key.indexOf('vj.def.') !== 0) continue;
        const k = key.slice('vj.def.'.length);
        if(this._defsSyncSkip.indexOf(k) >= 0) continue;
        try{ out[k] = JSON.parse(localStorage.getItem(key)); }catch(e){}
      }
      if(!Object.keys(out).length) return;   // 何も無い端末が空でサーバーを潰さないように
      fetch(this._defsUrl(), {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(out)}).catch(()=>{});
    }catch(e){}
  },
  // 全オリジン共通の既定値を defaults.json から適用 (JS 既定 → defaults.json → localStorage の順で上書き)
  async applyServerDefaults(){
    let d = null;
    try{
      const r = await fetch('defaults.json', {cache:'no-cache'});
      if(r.ok) d = await r.json();
    }catch(e){}
    if(!d || typeof d !== 'object') return;
    if(d.beatMode === 'beat' || d.beatMode === 'drone') this.beatMode = d.beatMode;
    if(typeof d.speed === 'number') this.speed = clamp(d.speed, 0, 4);
    if(typeof d.crossfade === 'number') this.crossfade = clamp(d.crossfade, 0, 1);
    if(d.blendMode) this.blendMode = d.blendMode;
    if(typeof d.bpm === 'number') BPM.setBpm(d.bpm);
    if(d.post && typeof d.post === 'object') Object.assign(this.post, this.sanitizePost(this.migrateFeedbackPost(Object.assign({},d.post))));
    if(d.manga && typeof Manga !== 'undefined') Object.assign(Manga.P, d.manga);
    if(d.layer && typeof Layer !== 'undefined') Object.assign(Layer.P, d.layer);
    if(d.overlay && typeof Overlay !== 'undefined') Object.assign(Overlay.P, d.overlay);
    if(d.video && typeof Movie !== 'undefined' && Movie.P) Object.assign(Movie.P, d.video);
    if(d.slicer && typeof Slicer !== 'undefined' && Slicer.P) Object.assign(Slicer.P, d.slicer);
    if(d.slicerImg && typeof Slicer !== 'undefined' && Slicer.restoreImage) Slicer.restoreImage(d.slicerImg, d.slicer);
  },
  loadLocal(){
    try{
      const s = JSON.parse(localStorage.getItem('vj.state')||'null'); if(!s) return;
      this._applyState(s, {restoreMixControls:true});
      this.crossfade = 1.0;   // Mix は起動時は常に既定100%(復元しても 100%)
    }catch(e){ console.warn(e); }
  },
  // 起動プリセット: リポジトリ直下の startup.json (state 形式) を起動時に自動適用する。
  //   保存状態を復元した場合(復元ON + vj.state あり)は、ユーザーの最新状態を優先してスキップ。
  //   → 別 PC / 初回起動 (localStorage 空) でも決まった初期シーンで立ち上がる。
  //   戻り値: 適用したら true。
  async _loadStartupConfig(){
    let hasSaved = false;
    try{ hasSaved = !!localStorage.getItem('vj.state'); }catch(_){}
    if(this._restoreOn && hasSaved) return false;   // 復元を優先
    let s = null;
    try{
      const r = await fetch('startup.json', {cache:'no-cache'});
      if(!r.ok) return false;
      s = await r.json();
    }catch(e){ return false; }
    if(!s || typeof s !== 'object') return false;
    try{
      this._applyState(s, {restoreOverlayEnabled:true, restoreMixControls:true, restoreBeatScale:true});
      this.crossfade = 1.0;   // 起動時 Mix は常に 100%
      if(typeof UI !== 'undefined' && UI.refreshAll) UI.refreshAll();
      toast('起動プリセット (startup.json) を適用');
      return true;
    }catch(e){ console.warn('startup.json apply failed:', e); return false; }
  },
  // 現在の状態を startup.json としてダウンロード(差し替えて deploy すれば次回起動から反映)。
  //   コンソールで App.saveStartupConfig() を実行。
  saveStartupConfig(){
    try{
      const data = JSON.stringify(this._collectState(), null, 2);
      const blob = new Blob([data], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'startup.json';
      document.body.appendChild(a); a.click();
      setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 500);
      toast('startup.json を書き出しました');
    }catch(e){ console.warn(e); toast('書き出し失敗'); }
  },
  // 状態オブジェクトを現在のアプリへ適用 (localStorage 復元 / バンク呼出 / プリセット呼出で共用)
  _applyState(s, opts){
    opts = opts || {};
    try{
      const presetDefaults = opts.resetMissingDefaults
        ? (this._presetDefaults || this._capturePresetDefaults())
        : null;
      if(presetDefaults){
        if(!('beatMode' in s) && opts.restoreBeatMode !== false) this.beatMode = presetDefaults.beatMode;
        if(!('crossfade' in s)) this.crossfade = presetDefaults.crossfade;
        if(!('blendMode' in s)) this.blendMode = presetDefaults.blendMode;
        if(!('gamma' in s)) this.gamma = presetDefaults.gamma;
        if(!('slotBOffsetBeats' in s)) this.slotBOffsetBeats = presetDefaults.slotBOffsetBeats;
        if(opts.restoreBeatScale && typeof s.beatScale !== 'number' && this.setBeatScale){
          this.setBeatScale(presetDefaults.beatScale, false);
        }
      }
      if(s.bpm) BPM.setBpm(s.bpm);
      if(opts.restoreBeatScale && typeof s.beatScale === 'number'){
        const bs = this._normalizeBeatScale ? this._normalizeBeatScale(s.beatScale) : s.beatScale;
        if(this.setBeatScale) this.setBeatScale(bs, false);
        else { this.beatScale = bs; this.setSpeed(bs); }
      }
      if(typeof s.crossfade==='number') this.crossfade = s.crossfade;
      if(typeof s.slotBOffsetBeats==='number'){ this.slotBOffsetBeats = s.slotBOffsetBeats; const bo=$('#mixBOffset'); if(bo){ bo.value = s.slotBOffsetBeats; const bv=$('#mixBOffsetVal'); if(bv) bv.textContent = s.slotBOffsetBeats.toFixed(2); } }
      if(s.blendMode){ this.blendMode = s.blendMode; const cb=document.querySelector('#cfBlend'); if(cb) cb.value = s.blendMode; }
      if(opts.restoreMixControls){
        if(s.mixControls) this._applyMixControls(s.mixControls);
        else if(presetDefaults && presetDefaults.mixControls) this._applyMixControls(presetDefaults.mixControls);
      }
      if(typeof s.gamma==='number') this.gamma = s.gamma;
      // Transition (拍数/Style/Param Trans) は state から復元しない。
      // プリセットやSave復元で変わらず、Transition の「デフォルト保存」(applyTransDefault)でのみ設定される。
      // undo/redo は瞬時反映 (フェード経由だと次の undo が「フェード中の変化」を拾って多段で戻れない)
      const _fadeB = opts.instantPost ? 0 : this._fadeBeats();
      if(opts.instantPost){ this._paramFades.length = 0; this._gradFade = null; }
      if(s.post && typeof s.post === 'object'){
        const sp = this.sanitizePost(this.migrateFeedbackPost(Object.assign({},s.post)));   // Auto Map 量(paletteAmt)も保存値どおり復元する
        if(presetDefaults){
          const target = Object.assign({}, presetDefaults.post || {});
          // Audio FX はプリセット保存対象外なので、切替前の値を維持する。
          const AUDIO_FX = ['audioTarget','audioGain','audioBand','audioAttack','aScan','aRgb','aStrobe','aShock','aExplode'];
          for(const k of AUDIO_FX) if(this.post[k] !== undefined) target[k] = this.post[k];
          Object.assign(target, sp);
          if(_fadeB > 0) this.applyPostFaded(target);  // 欠落項目もデフォルトへフェード
          else Object.assign(this.post, target);
        } else if(_fadeB > 0) this.applyPostFaded(sp); // Param Fade: 数値パラメータを拍数かけて補間
        else Object.assign(this.post, sp);
      }
      else if(presetDefaults){
        const target = Object.assign({}, presetDefaults.post || {});
        const AUDIO_FX = ['audioTarget','audioGain','audioBand','audioAttack','aScan','aRgb','aStrobe','aShock','aExplode'];
        for(const k of AUDIO_FX) if(this.post[k] !== undefined) target[k] = this.post[k];
        if(_fadeB > 0) this.applyPostFaded(target);
        else Object.assign(this.post, target);
      } else if(typeof s.gamma === 'number') this.post.gamma = s.gamma; // migrate old saves
      // gradMix は POST_FADE_IMMEDIATE により上の分岐で瞬時に確定済み。
      // その値に合わせて「通常色」判定用の _activeGradPreset も同期する
      // (プリセット/state 復元は名前付き Grad Preset 経由ではないので、9 か「不明な ON」の二択)。
      this._activeGradPreset = (Math.abs(this.post.gradMix || 0) <= 0.0001) ? 9 : -1;
      // 旧仕様の保存 (post.hueLive マーカー無し) は Grad ON 時に Hue がストップへ焼き込み済み。
      // ライブ Hue を重ねると二重回転になるため 0 へ。新仕様の保存はそのまま復元する。
      if(this._activeGradPreset !== 9 && !(s.post && s.post.hueLive)) this.post.hue = 0;
      // Overlay state 復元。プリセット適用時だけ enabled も復元し、local/bank/undo では ON/OFF を維持する。
      if(typeof Overlay !== 'undefined'){
        if(presetDefaults && presetDefaults.overlay){
          Object.assign(Overlay.P, JSON.parse(JSON.stringify(presetDefaults.overlay)));
          if(presetDefaults.overlayBrushParams){
            try{ Overlay.brushParams = JSON.parse(JSON.stringify(presetDefaults.overlayBrushParams)); }
            catch(e){ Overlay.brushParams = Object.assign({}, presetDefaults.overlayBrushParams); }
          }
        }
        const hasOverlay = !!(s.overlay && typeof s.overlay === 'object');
	        if(s.overlayBrushParams && typeof s.overlayBrushParams === 'object'){
	          try{ Overlay.brushParams = JSON.parse(JSON.stringify(s.overlayBrushParams)); }
	          catch(e){ Overlay.brushParams = Object.assign({}, s.overlayBrushParams); }
	        }
	        if(hasOverlay){
	          let ov = {};
	          try{ ov = JSON.parse(JSON.stringify(s.overlay)); }catch(e){ ov = Object.assign({}, s.overlay); }
	          if(!opts.restoreOverlayEnabled) delete ov.enabled;
	          Object.assign(Overlay.P, ov);
	          const mode = Overlay.P.brushMode
	            ? ((Overlay._brushName) ? Overlay._brushName(Overlay.P.brushMode) : Overlay.P.brushMode)
	            : null;
	          if(mode && Overlay.BRUSH_KEYS){
	            if(!Overlay.brushParams || typeof Overlay.brushParams !== 'object') Overlay.brushParams = {};
	            const cur = Object.assign({}, Overlay.brushParams[mode] || {});
	            for(const k of Overlay.BRUSH_KEYS) if(Overlay.P[k] !== undefined) cur[k] = Overlay.P[k];
	            Overlay.brushParams[mode] = cur;
	          }
	          if(opts.restoreOverlayEnabled && !Overlay.P.enabled && Overlay.clear) Overlay.clear();
	        } else if(s.overlayBrushParams && Overlay.P.brushMode && Overlay.applyBrushDefaults){
	          Overlay.applyBrushDefaults(Overlay.P.brushMode);
	        }
	      }
      // 各 mode の state 復元。Preset復元時は、この保存値が loadPreset のデフォルト適用で潰れないようにする。
      this._restoreModeStates(s, opts);
      // 復元後に UI を同期
      if(typeof UI !== 'undefined' && UI.refreshPost) UI.refreshPost();
      if(typeof UI !== 'undefined' && UI.refreshOverlay) UI.refreshOverlay();
      if(typeof UI !== 'undefined' && UI.refreshManga) UI.refreshManga();
      // MIDI マッピングは state に含めない (midimap.json + localStorage 専用。state 復元で上書きしないことで「初期化」を防ぐ)
      if(opts.restoreBeatMode !== false && (s.beatMode === 'beat' || s.beatMode === 'drone')) this.beatMode = s.beatMode;
      if(s.audioTime && typeof s.audioTime === 'object'){
        Object.assign(this.audioTime, s.audioTime);
        if(typeof UI !== 'undefined' && UI.refreshAudioTransport) UI.refreshAudioTransport();
      }
      const ENGINE_KINDS = this.modeKinds || ['none','layer','manga','video','aratanagara','slicer','cyberui','novel','inkelly','boltzmann','grayscott','pen','caverns','shelf','ribbon','photoplane','image','textdeform','ugomeki','shredder'];
      for(const k of ['A','B']){
        const sk = s.slots && s.slots[k];
        // iMouse (凍結値) を復元。M キーが OFF のままでもこの値が使われる
        // (拾うのは mouseCapture かつアクティブスロットのときだけなので上書きされない)。
        if(sk && sk.mouse && GL.slots[k]){
          const w = Math.max(1, GL.canvas ? GL.canvas.width : 1);
          const h = Math.max(1, GL.canvas ? GL.canvas.height : 1);
          const mm = sk.mouse;
          GL.slots[k]._mouse = { x:(mm.x||0)*w, y:(mm.y||0)*h, dx:(mm.dx||0)*w, dy:(mm.dy||0)*h };
        }
        if(sk && sk.kind === 'aratanagara' && sk.presetName === 'aratanagara BG'){
          const idx = PRESETS.findIndex(p => p && p.name === 'aratanagara BG');
          if(idx >= 0){
            this.loadPreset(idx, k);
            continue;
          }
        }
        if(sk && ENGINE_KINDS.includes(sk.kind)){
          // 動画は presetName が none プリセット名 ('(なし / 透明)') のまま保存されることがあり、
          // 名前一致で none をロードして黒くなる。動画は transitionVideo と同じ手順で直接復元する。
          if(sk.kind === 'video'){
            const vurl = (sk.video && (sk.video.src || sk.video.url)) || sk._vidUrl || '';
            if(vurl && typeof Movie !== 'undefined'){
              const sl = GL.slots[k];
              sl.kind='video'; sl.ready=true; sl.errors=''; sl.src=''; sl.params=[]; sl.format='video'; sl._vidUrl=vurl;
              if(!Movie.initialized) Movie.init(GL.gl);
              try{ Movie.loadUrl(vurl, (sk.video && sk.video.name) || vurl, k); }catch(e){}
              continue;
            }
          }
          // kind エンジン(layer/manga/none 等)はプリセット名から正式にロード (エンジン初期化込み)
          let idx = -1;
          if(sk.presetName) idx = PRESETS.findIndex(p => p && p.name === sk.presetName);
          if(idx < 0) idx = PRESETS.findIndex(p => p && p.kind === sk.kind);
          if(idx >= 0){
            const hasSavedModeState = this._hasSavedModeState(s, sk.kind);
            this.loadPreset(idx, k, {skipEngineDefault: hasSavedModeState});
            continue;
          }
        }
        // シェーダで src を持たず presetName だけの指定 (手書き startup.json 等) → 名前でロード
        if(sk && !sk.src && sk.presetName){
          const pi = PRESETS.findIndex(p => p && p.name === sk.presetName);
          if(pi >= 0){
            this.loadPreset(pi, k);
            if(sk.params){
              const saved = sk.params;
              for(const pp of GL.slots[k].params){
                const m = saved.find(x=>x.name===pp.name);
                if(m && (typeof m.value==='number' || Array.isArray(m.value))) pp.value = m.value;
              }
            }
            continue;
          }
        }
        if(sk && sk.src){
          // エンジン → シェーダ切替時に kind を 'shader' へ戻す(残っていると描画系がエンジンを描き続ける)
          GL.slots[k].kind = sk.kind || 'shader';
          GL.compileSlot(k, sk.src);
          GL.slots[k].channels = (sk.channels || [null,null,null,null]).slice();
          // パス保存された画像チャンネルを再束縛 (Inputs の ID はセッション限りのため)
          (sk.channels || []).forEach((c, ci) => {
            if(typeof c === 'string' && /\.(png|jpe?g|webp|gif)$/i.test(c)){
              const slotKey2 = k;
              GL.slots[slotKey2].channels[ci] = null;
              Inputs.addImageURL(c, c).then(id => {
                if(id){ GL.slots[slotKey2].channels[ci] = id; if(typeof UI !== 'undefined' && UI.refreshChannels) UI.refreshChannels(); }
              });
            }
          });
          // restore param values
          if(sk.params){
            const saved = sk.params;
            for(const p of GL.slots[k].params){
              const m = saved.find(x=>x.name===p.name);
              if(m && (typeof m.value==='number' || Array.isArray(m.value))) p.value = m.value;
            }
          }
          // UI 同期: プリセット名からインデックスを引いてサムネ/スロット表示を更新
          if(sk.presetName && typeof UI !== 'undefined'){
            const pi = PRESETS.findIndex(p => p && p.name === sk.presetName);
            if(pi >= 0) UI.activePresetIdx[k] = pi;
          }
        }
      }
      // スロット表示/サムネのハイライトを同期
      if(typeof UI !== 'undefined' && UI.refreshSlot) UI.refreshSlot();
      if(typeof MIDI !== 'undefined'){
        if(MIDI.syncLeds) MIDI.syncLeds();
        else if(MIDI.refreshLeds) MIDI.refreshLeds();
      }
    }catch(e){ console.warn(e); }
  },
};

/* ===================================================================
   UI  — bindings
=================================================================== */
const UI = {
  thumbCanvases: [],
  activePresetIdx: {A:-1, B:-1},

  init(){
    // tabs
    $$('.tab').forEach(t=>t.addEventListener('click', ()=>this.openTab(t.dataset.tab)));
    this.openTab('preset');

    // Visual タブ: 検索 + カテゴリ(タグ)フィルタ
    { const si = $('#visualSearch');
      if(si) si.addEventListener('input', ()=>this.applyVisualFilter());
      $$('.visFilter').forEach(b=>b.addEventListener('click', ()=>{
        $$('.visFilter').forEach(x=>x.classList.remove('on'));
        b.classList.add('on');
        this.applyVisualFilter();
      }));
    }

    // Preset タブ: 検索 + カテゴリ(タグ)フィルタ (Visual と同仕様)
    { const ps = $('#presetSearch');
      if(ps) ps.addEventListener('input', ()=>this.applyPresetFilter());
      $$('.preFilter').forEach(b=>b.addEventListener('click', ()=>{
        $$('.preFilter').forEach(x=>x.classList.remove('on'));
        b.classList.add('on');
        this.applyPresetFilter();
      }));
    }

    // slot select (global)
    $$('#slotSel button').forEach(b=>b.addEventListener('click',()=>{
      App.activeSlot = b.dataset.slot;
      this.refreshSlot();
      if(typeof MIDI !== 'undefined') MIDI.refreshLeds();
    }));
    // メインプレビューのクリックではアクティブスロットを変えない。
    // (以前は Slot A へ切り替えていたが、パン操作 / iMouse / フォーカスクリックのたびに
    //  気づかず切り替わり「選択が正しくない」事故になるため撤去。
    //  切替は上部 Slot A/B ボタン・下段タイル・X キー・ドラッグ投入の明示操作のみ)

    // 下段 Slot A/B プレビュー: クリック=操作対象に / ダブル=表示切替(Mix 0↔1) /
    // ホイール=ズーム / もう一方へドラッグ&ドロップ= Slot A ⇄ B 交換
    $$('.slotPrev').forEach(tile=>{
      const slot = tile.dataset.slot;
      let clickTimer = null;
      tile.addEventListener('click', ()=>{
        if(tile._dragged){ tile._dragged = false; return; }  // ドラッグ直後は無視
        // スロット選択は即時に行う。ダブルクリック判定 (280ms) の完了を待つ実装だと、
        // タイルをクリックした直後に Visual をクリックすると旧アクティブスロットへ
        // 入ってしまい「Slot B の Visual が変えられない」ように見える。
        if(App.activeSlot !== slot){
          App.activeSlot = slot;
          this.refreshSlot();
          if(typeof MIDI !== 'undefined') MIDI.refreshLeds();
        }
        if(clickTimer){
          clearTimeout(clickTimer); clickTimer = null;
          // ダブルクリック: 表示切替
          App.crossfade = (App.crossfade < 0.5) ? 1 : 0;
          this.refreshMix();
          this.refreshSlot();
          if(typeof MIDI !== 'undefined') MIDI.refreshLeds();
          return;
        }
        clickTimer = setTimeout(()=>{ clickTimer = null; }, 280);
      });
      // ホイール = このタイルのスロットだけをズーム (A+B 両方はメインステージのホイール)
      tile.addEventListener('wheel', (e)=>{
        e.preventDefault();
        App._camTween = null;
        const factor = Math.exp(-e.deltaY * 0.0015);
        App.zoomSlot(slot, factor);
      }, { passive:false });
      // ドラッグでもう一方のタイルへ → Slot A ⇄ B 交換
      let drag = null;
      tile.addEventListener('pointerdown', (e)=>{
        if(e.button !== 0) return;
        drag = { x:e.clientX, y:e.clientY, moved:false };
        try{ tile.setPointerCapture(e.pointerId); }catch(_){}
      });
      tile.addEventListener('pointermove', (e)=>{
        if(!drag) return;
        if(!drag.moved && Math.hypot(e.clientX-drag.x, e.clientY-drag.y) < 6) return;
        drag.moved = true;
        tile.classList.add('dragging');
        const other = document.querySelector('.slotPrev[data-slot="' + (slot === 'A' ? 'B' : 'A') + '"]');
        if(other){
          const r = other.getBoundingClientRect();
          const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
          other.classList.toggle('dropTarget', over);
          drag.over = over;
        }
      });
      const dragEnd = (e)=>{
        if(!drag) return;
        const { moved, over } = drag;
        drag = null;
        try{ tile.releasePointerCapture(e.pointerId); }catch(_){}
        tile.classList.remove('dragging');
        const other = document.querySelector('.slotPrev[data-slot="' + (slot === 'A' ? 'B' : 'A') + '"]');
        if(other) other.classList.remove('dropTarget');
        if(!moved) return;
        tile._dragged = true;   // 直後の click を抑制
        if(over && e.type === 'pointerup') App.swapSlots();
      };
      tile.addEventListener('pointerup', dragEnd);
      tile.addEventListener('pointercancel', dragEnd);
      // Visual タブのタイルをドロップ → そのスロットへロード
      tile.addEventListener('dragover', (e)=>{
        if(this._visDragIdx == null) return;
        e.preventDefault();
        try{ e.dataTransfer.dropEffect = 'copy'; }catch(_){}
        tile.classList.add('dropTarget');
      });
      tile.addEventListener('dragleave', ()=>tile.classList.remove('dropTarget'));
      tile.addEventListener('drop', (e)=>{
        tile.classList.remove('dropTarget');
        let idx = this._visDragIdx;
        if(idx == null){
          const t = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
          idx = /^\d+$/.test(t) ? parseInt(t, 10) : null;
        }
        if(idx == null || !PRESETS[idx]) return;
        e.preventDefault();
        App.loadPresetInto(idx, slot);
      });
    });

    // code editor
    $('#code').addEventListener('input', ()=>this.updateGutter());
    $('#code').addEventListener('scroll', ()=>{ $('#gutter').scrollTop = $('#code').scrollTop; });
    $('#btnCompile').addEventListener('click', ()=>this.compileFromEditor());
    $('#btnNewShader').addEventListener('click', ()=>{
      $('#code').value = `// New shader
// @param speed 0..3 = 1
uniform float speed;

void mainImage(out vec4 o, in vec2 f){
  vec2 uv = f/iResolution.xy;
  o = vec4(uv, 0.5+0.5*sin(iTime*speed), 1.);
}`;
      this.compileFromEditor();
    });

    // mix
    $('#cf').dataset.midiKey = '*:__crossfade__';   // 右クリック MIDI Learn 対象
    $('#cf').addEventListener('input', e=>{
      // 手動で Mix を動かしたら Auto は即停止 (尾引きもキャンセル)
      if(App.autoCF.on || App.autoCF.tail){
        App.autoCF.on = false;
        App.autoCF.tail = null;
        const cb = $('#cfAuto'); if(cb) cb.checked = false;
      }
      App.crossfade = parseFloat(e.target.value);
      this.refreshMix(false);
    });
    { const bo = $('#mixBOffset'), bv = $('#mixBOffsetVal');
      if(bo) bo.addEventListener('input', ()=>{
        App.slotBOffsetBeats = parseFloat(bo.value) || 0;
        if(bv) bv.textContent = App.slotBOffsetBeats.toFixed(2);
      }); }
    $('#cfAuto').addEventListener('change', e=>{
      const turningOn = e.target.checked;
      if(turningOn){
        App.autoCF.on = true;
        // 現状の Mix 値から開始 (上昇方向)。t = cf, beats_elapsed = cf * beats → t0 を逆算
        const cf = App.crossfade;
        const beats = Math.max(0.0625, App.autoCF.beats);
        const tStart = (App.autoCF.mode === 'switch') ? 0 : cf;
        App.autoCF.t0 = BPM.beatCount() - tStart * beats;
        App.autoCF.tail = null;
      } else {
        // 進行方向の終点 (0 or 1) を決め、その方向へ動かし続ける
        if(App.autoCF.mode === 'crossfade'){
          const beats = BPM.beatCount() - App.autoCF.t0;
          let t = (beats / Math.max(0.0625, App.autoCF.beats)) % 2;
          if(t<0) t += 2;
          App.autoCF.tail = { target: (t < 1) ? 1 : 0, lastBeat: BPM.beatCount() };
        } else {
          // switch モードはもともと 0/1 のみなので尾引き不要
          App.autoCF.tail = null;
        }
        App.autoCF.on = false;
      }
    });
    $('#cfBeats').addEventListener('change', e=>{ App.autoCF.beats = parseInt(e.target.value)||8; });
    const am = $('#cfAutoMode');
    if(am){
      am.value = App.autoCF.mode || 'crossfade';
      am.addEventListener('change', ()=>{ App.autoCF.mode = am.value; App.autoCF.t0 = BPM.beatCount(); });
    }
    const cb = $('#cfBlend');
    if(cb){
      cb.value = App.blendMode;
      cb.addEventListener('change', ()=>{ App.setBlendMode(cb.value); });
    }
    const tdSel = $('#tdMdSelect');
    if(tdSel){
      tdSel.addEventListener('change', ()=>{
        if(typeof TextDeform === 'undefined') return;
        if(!TextDeform.initialized && typeof GL !== 'undefined' && GL.gl) TextDeform.init(GL.gl);
        if(TextDeform.setMdSelection) TextDeform.setMdSelection(tdSel.value);
        this.refreshTextDeform();
        App._undoSchedule();
        const idx = TextDeform.currentMdIndex ? TextDeform.currentMdIndex() : -1;
        const pr = TextDeform.presets && TextDeform.presets[idx];
        toast('TYPE md: ' + (tdSel.value === 'random' ? 'Random' : (pr && pr.name || '')));
      });
    }
    const tdApplyMdStyle = (over)=>{
        if(typeof TextDeform === 'undefined' || !TextDeform.updateMdStyle) return;
        const i = this._fixedTextDeformMdIndex ? this._fixedTextDeformMdIndex() : -1;
        if(i < 0) return;
        TextDeform.updateMdStyle(i, over);
        this.refreshTextDeform();
        App._undoSchedule();
    };
    const bindTdColor = (id, key)=>{
      const el = $('#'+id);
      if(el) el.addEventListener('input', ()=>tdApplyMdStyle({ [key]: el.value }));
    };
    const bindTdNumber = (id, key)=>{
      const el = $('#'+id);
      if(el) el.addEventListener('input', ()=>tdApplyMdStyle({ [key]: parseFloat(el.value) }));
    };
    bindTdColor('tdMdPaper', 'paper');
    bindTdColor('tdMdInk', 'ink');
    bindTdColor('tdMdAccent', 'accent');
    bindTdNumber('tdMdAccentRatio', 'accentRatio');
    bindTdNumber('tdMdFontSize', 'fontSize');
    bindTdNumber('tdMdLineHeight', 'lineHeight');
    bindTdNumber('tdMdLetterSpacing', 'letterSpacing');
    bindTdNumber('tdMdZoom', 'zoom');
    bindTdNumber('tdMdPanX', 'panX');
    bindTdNumber('tdMdPanY', 'panY');
    bindTdNumber('tdMdStageW', 'stageW');
    bindTdNumber('tdMdMarginPct', 'marginPct');
    bindTdNumber('tdMdRotation', 'rotation');
    bindTdNumber('tdMdRandomness', 'randomness');
    bindTdNumber('tdMdGeoRatio', 'geoRatio');
    bindTdNumber('tdMdStretchX', 'stretchX');
    bindTdNumber('tdMdStretchY', 'stretchY');
    bindTdNumber('tdMdFlipRate', 'flipRate');
    bindTdNumber('tdMdRotateAngle', 'rotateAngle');
    bindTdNumber('tdMdSkewX', 'skewX');
    bindTdNumber('tdMdSkewY', 'skewY');
    bindTdNumber('tdMdBaselineShift', 'baselineShift');
    bindTdNumber('tdMdMirrorX', 'mirrorX');
    bindTdNumber('tdMdMirrorY', 'mirrorY');
    bindTdNumber('tdMdMisregX', 'misregX');
    bindTdNumber('tdMdMisregY', 'misregY');
    bindTdColor('tdMdMisregColorA', 'misregColorA');
    bindTdColor('tdMdMisregColorB', 'misregColorB');
    bindTdNumber('tdMdConfuseDepth', 'confuseDepth');
    bindTdNumber('tdMdOpChance', 'opChance');
    bindTdNumber('tdMdGridCols', 'gridCols');
    bindTdNumber('tdMdGridCell', 'gridCell');
    bindTdNumber('tdMdGridGap', 'gridGap');
    const tdGrid = $('#tdMdGrid');
    if(tdGrid){
      tdGrid.addEventListener('change', ()=>{
        tdApplyMdStyle({ gridEnabled: tdGrid.value === 'on' });
      });
    }
    // Composition Engine v6 (md 単位: live 適用 + 選択中 md へ書き込み → デフォルト保存で永続化)
    const tdCompSet = (over)=>{
      if(typeof TDComp === 'undefined') return;
      TDComp.set(over);
      const i = this._fixedTextDeformMdIndex ? this._fixedTextDeformMdIndex() : -1;
      const pr = (i >= 0 && typeof TextDeform !== 'undefined') ? TextDeform.presets[i] : null;
      if(pr) pr.p = Object.assign({}, pr.p || {}, { comp: TDComp.snapshot() });
      this.refreshTextDeform();
      App._undoSchedule();
    };
    const tdCompType = $('#tdCompType');
    if(tdCompType){
      tdCompType.addEventListener('change', ()=>{
        tdCompSet(tdCompType.value === 'off' ? { enabled: false } : { enabled: true, type: tdCompType.value });
        toast('TYPE Comp: ' + (tdCompType.value === 'off' ? 'Off' : tdCompType.options[tdCompType.selectedIndex].text));
      });
    }
    const tdCompReseed = $('#tdCompReseed');
    if(tdCompReseed) tdCompReseed.addEventListener('click', ()=>tdCompSet({ seed: Math.floor(Math.random()*1e6) }));
    const tdRandOne = $('#tdMdRandOne');
    if(tdRandOne) tdRandOne.addEventListener('click', ()=> UI.randomizeTextDeformMd());
    const bindComp = (id, fn)=>{
      const el = $('#'+id);
      if(el) el.addEventListener('input', ()=>fn(parseFloat(el.value)));
    };
    bindComp('tdCompSpeed', v=>tdCompSet({ speed: v }));
    bindComp('tdCompIntensity', v=>tdCompSet({ macros: { intensity: v } }));
    bindComp('tdCompDensity', v=>tdCompSet({ macros: { density: v } }));
    bindComp('tdCompInstability', v=>tdCompSet({ macros: { instability: v } }));
    bindComp('tdCompDepth', v=>tdCompSet({ macros: { depth: v } }));
    bindComp('tdCompLegibility', v=>tdCompSet({ macros: { legibility: v } }));
    bindComp('tdCompEcho', v=>tdCompSet({ fxRack: { echo: { enabled: v > 0, amount: v } } }));
    bindComp('tdCompFeedback', v=>tdCompSet({ fxRack: { feedback: { enabled: v > 0, amount: v } } }));
    bindComp('tdCompChroma', v=>tdCompSet({ fxRack: { chromaticSplit: { enabled: v > 0, amount: v } } }));
    bindComp('tdCompRaster', v=>tdCompSet({ fxRack: { rasterMaterial: { enabled: v > 0, amount: v } } }));
    const tdLaw = $('#tdMdRandomLaw');
    if(tdLaw){
      tdLaw.addEventListener('change', ()=>{
        tdApplyMdStyle({ randomLaw: tdLaw.value });
      });
    }
    const tdDir = $('#tdMdDirection');
    if(tdDir){
      tdDir.addEventListener('change', ()=>{
        tdApplyMdStyle({ vertical: tdDir.value === 'vertical' });
      });
    }
    const tdFit = $('#tdMdFitMode');
    if(tdFit){
      tdFit.addEventListener('change', ()=>{
        tdApplyMdStyle({ fitMode: tdFit.value });
      });
    }
    const tdFont = $('#tdMdFont');
    if(tdFont){
      tdFont.addEventListener('change', ()=>{
        tdApplyMdStyle({ fontFamily: tdFont.value });
      });
    }
    const tb = $('#mixTransBeats');
    if(tb){
      tb.value = String(App.transBeats || 0);
      tb.addEventListener('change', ()=>{ App.transBeats = parseInt(tb.value)||0; });
    }
    const tsy = $('#transStyle');
    if(tsy){
      tsy.value = String(App.transStyle || 0);
      tsy.addEventListener('change', ()=>{ App.transStyle = parseInt(tsy.value)||0; });
    }
    const pfd = $('#transParamFade');
    if(pfd){
      pfd.value = String(App.paramFadeBeats || 0);
      pfd.addEventListener('change', ()=>{ App.paramFadeBeats = parseFloat(pfd.value)||0; });
    }
    const pfs = $('#transParamFadeScope');
    if(pfs){
      pfs.value = App.paramFadeScope || 'all';
      pfs.addEventListener('change', ()=>{
        App.paramFadeScope = (pfs.value === 'preset') ? 'preset' : 'all';
        // ライブ操作を即反映へ切り替えた瞬間に、進行中のフェードが残らないようにする
        if(App.paramFadeScope === 'preset' && App._paramFades) App._paramFades.length = 0;
      });
    }
    // 描画解像度プルダウン(横長/正方/縦長)。表示枠のアスペクトも追従。
    const rsel = $('#resSel');
    if(rsel){
      rsel.value = GL.FIXED_W + 'x' + GL.FIXED_H;
      const si0 = document.getElementById('stageInner');
      if(si0) si0.style.aspectRatio = GL.FIXED_W + ' / ' + GL.FIXED_H;
      rsel.addEventListener('change', ()=>{ const a = rsel.value.split('x'); GL.setResolution(+a[0], +a[1]); });
    }
    // gamma moved to Post tab (see bindPostFx)

    // BPM
    { const target = $('#bpmTarget');
      let saved = 'auto';
      try{ saved = localStorage.getItem('vj.bpmTarget') || 'auto'; }catch(e){}
      if(!['auto','kick','snare','drum','full'].includes(saved)) saved = 'auto';
      BPM.target = saved;
      if(target){
        target.value = saved;
        target.addEventListener('change',()=>{
          BPM.setTarget(target.value);
          toast('BPM Detect: '+target.options[target.selectedIndex].text);
        });
      }
    }
    $('#bpmInput').addEventListener('change', e=>{ BPM.setBpm(parseFloat(e.target.value)); });
    $('#btnTap').addEventListener('click', ()=>BPM.tap());
    $('#btnReset').addEventListener('click', ()=>BPM.resetPhase());
    $('#bpmAuto').addEventListener('change', e=>{
      BPM.auto = e.target.checked;
      if(BPM.auto){
        // 検出状態をクリアして真っさらから解析
        if(Audio.resetBpmAdaptation) Audio.resetBpmAdaptation();
        BPM.resetAutoDetection();
        if(!Audio.mode || Audio.mode === 'off'){
          toast('Audio がオフです — マイクか画面音声をオンにしてください', 3500);
        } else {
          toast('BPM Auto: 音響から検出中…');
        }
      } else {
        toast('BPM Auto: OFF');
      }
    });
    $('#bpmHalf').addEventListener('click',()=>BPM.setBpm(BPM.bpm/2));
    $('#bpmDouble').addEventListener('click',()=>BPM.setBpm(BPM.bpm*2));
    $('#bpmMidiLearn').addEventListener('click',()=>{ MIDI.learn = '*:__bpm__'; toast('MIDI Learn → BPM: CCを動かして'); });
    $('#cfMidiLearn').addEventListener('click',()=>{ MIDI.learn = '*:__crossfade__'; toast('MIDI Learn → Crossfade: CCを動かして'); });
    { const rel = $('#midiRelative'), stp = $('#midiRelStep'), stpV = $('#midiRelStepVal'), mode = $('#midiRelMode');
      if(rel){
        rel.checked = !!MIDI.relative;
        rel.addEventListener('change', ()=>{ MIDI.relative = rel.checked; MIDI._relVal = {}; MIDI._relRaw = {}; MIDI._configureLCXL3Relative(MIDI.relative && MIDI.relMode === 'lcxl3'); try{ localStorage.setItem('vj.midiRel', rel.checked?'1':'0'); }catch(_){} toast('MIDI 相対モード: ' + (rel.checked?'ON (エンドレスエンコーダ)':'OFF (絶対)')); });
      }
      if(mode){
        mode.value = MIDI.relMode;
        mode.addEventListener('change', ()=>{ MIDI.relMode = mode.value; MIDI._relVal = {}; MIDI._relRaw = {}; MIDI._configureLCXL3Relative(MIDI.relative && MIDI.relMode === 'lcxl3'); try{ localStorage.setItem('vj.midiRelMode', mode.value); }catch(_){} toast('MIDI 相対エンコーダ方式: ' + mode.options[mode.selectedIndex].text); });
      }
      if(stp){
        const showStep = ()=>{
          MIDI.relStep = Math.max(4, Math.min(960, parseInt(stp.value,10)||48));
          if(stpV) stpV.textContent = String(MIDI.relStep);
        };
        stp.value = MIDI.relStep; showStep();
        stp.addEventListener('input', ()=>{
          showStep();
          MIDI._relVal = {};
          MIDI._relRaw = {};
          try{ localStorage.setItem('vj.midiRelStep', String(MIDI.relStep)); }catch(_){}
        });
      } }
    { const b = $('#tapMidiLearn'); if(b) b.addEventListener('click',()=>{ MIDI.learn = '*:__tap__'; toast('MIDI Learn → Tap: midiコンのボタンを押して'); }); }
    { const b = $('#resetMidiLearn'); if(b) b.addEventListener('click',()=>{ MIDI.learn = '*:__resetPhase__'; toast('MIDI Learn → Reset Φ: midiコンのボタンを押して'); }); }
    { const b = $('#btnMidiPush'); if(b) b.addEventListener('click',()=>{ MIDI.pushMap(); }); }
    { const b = $('#btnMidiPull'); if(b) b.addEventListener('click',()=>{ MIDI.pullMap(); }); }
    { const b = $('#btnDiagDownload'); if(b) b.addEventListener('click',()=>{ Diag.download(); toast('診断ログを保存しました'); }); }
    { const b = $('#btnDiagShow');     if(b) b.addEventListener('click',()=>{ Diag.dump(); toast('コンソールに表示 (F12)'); }); }
    { const b = $('#btnDiagClear');    if(b) b.addEventListener('click',()=>{ Diag.clear(); toast('診断ログをクリア'); }); }

    // audio (ON のボタンに色を付ける / 点灯中の再クリックで OFF にトグル)
    $('#btnAudioMic').addEventListener('click', async ()=>{ if(Audio.mode==='mic'){ await Audio.stop(); } else { await Audio.start('mic'); } UI.refreshAudioButtons(); });
    $('#btnAudioDisp').addEventListener('click', async ()=>{ if(Audio.mode==='display'){ await Audio.stop(); } else { await Audio.start('display'); } UI.refreshAudioButtons(); });
    this.refreshAudioButtons();
    // マイクを自動 ON にする。権限が既に許可済みならプロンプトなしで started、
    // 未許可/失敗時は最初のユーザー操作 (クリック/キー) で 1 回だけ再試行する
    // (ブラウザによっては権限プロンプトにジェスチャが要るため)。
    {
      let tries = 0, busy = false, done = false;
      const onUser = ()=>{ autoMic(); };
      const finish = ()=>{
        done = true;
        window.removeEventListener('pointerdown', onUser);
        window.removeEventListener('keydown', onUser);
      };
      const autoMic = async ()=>{
        if(done || busy || Audio.mode !== 'off') return;
        if(tries >= 3){ finish(); return; }        // 拒否され続けるなら諦める (毎操作の再試行を防ぐ)
        busy = true; tries++;
        const ok = await Audio.start('mic').catch(()=>false);
        busy = false;
        if(ok){ this.refreshAudioButtons(); finish(); }
      };
      autoMic();
      window.addEventListener('pointerdown', onUser, {passive:true});
      window.addEventListener('keydown', onUser);
    }

    // channels
    $('#btnLoadImg').addEventListener('click',()=>$('#fileImg').click());
    $('#fileImg').addEventListener('change', async e=>{
      for(const f of e.target.files){
        if(/^image\//.test(f.type)) await Inputs.addImageFile(f);
        else if(/^video\//.test(f.type)) await Inputs.addVideoFile(f);
      }
      e.target.value='';
    });
    $('#btnWebcam').addEventListener('click', ()=>Inputs.addWebcam());

    // output (Fullscreen ボタンは撤去。F キーで代替)
    $('#btnProj').addEventListener('click',()=>Projector.open());
    $('#btnRec').addEventListener('click',()=>{
      if(Record.mr){ Record.stop(); $('#btnRec').innerHTML='<span class="ic">⏺</span><span class="lb">Record</span>'; $('#btnRec').classList.remove('on'); }
      else if(Record.start()){ $('#btnRec').innerHTML='<span class="ic">⏹</span><span class="lb">Stop</span>'; $('#btnRec').classList.add('on'); }
    });
    { const sb=$('#btnShot'); if(sb) sb.addEventListener('click',()=>GL.screenshot()); }

    // プリセットライブラリ (Preset タブ): 追加ボタン + 一覧描画。
    { const addBtn = $('#btnPresetAdd');
      if(addBtn) addBtn.addEventListener('click', ()=>App.presetAdd());
      const hisBtn = $('#btnPresetHistory');
      if(hisBtn) hisBtn.addEventListener('click', ()=>UI.showPresetHistory());
      this.refreshPresetLib();
    }

    // 本番用フルキャッシュ。ON 中は素材の永続キャッシュと動画の全区間バッファを保持する。
    { const lb=$('#btnLoadAll');
      if(lb){
        const loadLabel=lb.querySelector('.lb');
        const setLoadLabel=(text)=>{ if(loadLabel) loadLabel.textContent=text; };
        let on=false;
        try{ on=(localStorage.getItem('vj.fullCache')==='1'); }catch(_){}
        App.fullCacheEnabled=on;
        if(typeof Movie !== 'undefined' && Movie.setFullCacheEnabled) Movie.setFullCacheEnabled(on);
        lb.classList.toggle('on', on);
        const runFullCache = async ()=>{
          if(lb.dataset.busy === '1') return;   // 実行中は多重起動しない
          lb.dataset.busy = '1';
          try{
            try{ if(navigator.storage && navigator.storage.persist) await navigator.storage.persist(); }catch(_){}
            // 1) シェーダ一式(起動時に fetch 開始済み。未完了ならここで待つ)
            if(App._shadersReadyPromise) await App._shadersReadyPromise;
            // 2) 画像ライブラリ一式を Cache Storage に保存
            if(App.cacheStaticLibraries){
              await App.cacheStaticLibraries((done,total)=>{ setLoadLabel(`Assets ${done}/${total}`); });
            }
            // 3) 動画一式をダウンロード + 逆再生用フレームバッファを事前構築
            //   (Movie._prefillToCache が seek ベースでフル復号 → Movie._cache に格納。
            //    選択時に即座に _bufferComplete=true となり、逆再生が最初から待ち時間ゼロで使える)
            if(typeof Movie !== 'undefined'){
              if(Movie.setFullCacheEnabled) Movie.setFullCacheEnabled(true);
              if(!Movie.initialized && typeof GL !== 'undefined' && GL.gl) Movie.init(GL.gl);
              const movies = await Movie.scanFolder();
              const total = movies ? movies.length : 0;
              let done = 0, failed = 0;
              if(total > 0){
                if(Movie.cacheLibrary){
                  setLoadLabel(`Cache 0/${total}`);
                  await Movie.cacheLibrary(movies, (_item, cacheDone, cacheTotal)=>{
                    setLoadLabel(`Cache ${cacheDone}/${cacheTotal}`);
                  });
                }
                if(Movie.prewarmLibrary){
                  setLoadLabel(`Decode 0/${total}`);
                  await Movie.prewarmLibrary(movies, (_item, warmDone, warmTotal)=>{
                    setLoadLabel(`Decode ${warmDone}/${warmTotal}`);
                  });
                }
                const CONCURRENCY = 2;   // フル復号(180 seek/本)は重いので並列数は控えめ
                let idx = 0;
                const worker = async ()=>{
                  while(idx < movies.length){
                    const item = movies[idx++];
                    setLoadLabel(`Load ${done}/${total}`);
                    try{
                      const memory = Movie._cache[item.url];
                      const onDisk = Movie.hasPersistentBuffer ? await Movie.hasPersistentBuffer(item.url) : false;
                      if(onDisk){
                        if(!memory || !memory.frames) Movie._cache[item.url] = {frames:null, complete:true, persistent:true};
                      } else {
                        const frames = memory && memory.frames ? memory.frames : await Movie._prefillToCache(item.url);
                        if(frames && frames.length){
                          Movie._cache[item.url] = {frames, complete:true, persistent:false};
                          setLoadLabel(`Save ${done}/${total}`);
                          if(Movie.savePersistentBuffer){
                            const saved = await Movie.savePersistentBuffer(item.url, frames);
                            if(!saved) throw new Error(`buffer save failed: ${item.url}`);
                            Movie._cache[item.url].persistent = true;
                          }
                        }
                      }
                    }catch(e){ failed++; console.warn('preload failed:', item.url, e); }
                    done++;
                    setLoadLabel(`Load ${done}/${total}`);
                  }
                };
                await Promise.all(Array.from({length:Math.min(CONCURRENCY, total)}, worker));
                if(failed) throw new Error(`${failed} video buffers failed to persist`);
              }
            }
            setLoadLabel('Load');
            lb.classList.toggle('on', App.fullCacheEnabled);
            toast('全素材・動画バッファのフルキャッシュが完了しました');
          }catch(e){
            setLoadLabel('Load');
            lb.classList.toggle('on', App.fullCacheEnabled);
            toast('フルキャッシュ中にエラーが発生しました');
          } finally {
            lb.dataset.busy = '0';
          }
        };
        lb.addEventListener('click', async ()=>{
          if(lb.dataset.busy === '1') return;
          on=!on;
          App.fullCacheEnabled=on;
          try{ localStorage.setItem('vj.fullCache', on?'1':'0'); }catch(_){}
          if(typeof Movie !== 'undefined' && Movie.setFullCacheEnabled) Movie.setFullCacheEnabled(on);
          lb.classList.toggle('on', on);
          if(on) await runFullCache();
          else toast('フルキャッシュ OFF（保存済みデータは保持）');
        });
        if(on) setTimeout(()=>runFullCache(), 800);
      } }
    { const rb=$('#btnRestore');
      if(rb){
        let on=true; try{ on=(localStorage.getItem('vj.restore')!=='0'); }catch(_){}
        rb.classList.toggle('on', on);
        rb.addEventListener('click', ()=>{
          on=!on;
          try{ localStorage.setItem('vj.restore', on?'1':'0'); }catch(_){}
          rb.classList.toggle('on', on);
          App._restoreOn = on;
          toast(on ? '復元 ON (次回起動から前回状態を復元)' : '復元 OFF (次回起動はクリーン)');
        });
      } }
    { const hb=$('#btnHelp'), hm=$('#helpModal'), hc=$('#btnHelpClose');
      if(hb && hm){
        const open = ()=>{ hm.style.display='flex'; };
        const close = ()=>{ hm.style.display='none'; };
        hb.addEventListener('click', open);
        if(hc) hc.addEventListener('click', close);
        hm.addEventListener('click', (e)=>{ if(e.target===hm) close(); });
        window.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && hm.style.display==='flex') close(); });
      } }

    this.bindPostFx();
    this.bindCollapse();
    this.bindOverlay();
    this.bindLayer();
    this.bindManga();
    this.bindVideo();
    this.bindSlicer();
    this.bindInkelly();
    this.bindPhoto();
    this.bindImage();
    this.bindUgomeki();
    this.bindSpaceType();
    this.bindBeatMode();
    this.bindAudioTransport();
    this.populatePresets();
    this.refreshPost();
    this._bindSliderResetOnDblclick();
    this._bindSliderMidiLearn();

    this.refreshSlot();
  },

  // 右クリック MIDI Learn: data-midi-key 付きスライダーを右クリック → 直後に動かした CC/Note を割当。
  //   もう一度右クリックで解除。割当済みでも右クリック→つまみ操作で上書きできる。
  _bindSliderMidiLearn(){
    // #side 内のスライダー / チェックボックスを自動的に MIDI 割当可能にする (data-midi-key 付与)。
    this._midiAutoTag();
    document.addEventListener('contextmenu', (e)=>{
      const el = (e.target && e.target.closest) ? e.target.closest('input[data-midi-key]') : null;
      if(!el || (el.type !== 'range' && el.type !== 'checkbox')) return;
      e.preventDefault();
      const key = el.dataset.midiKey;
      if(MIDI.learn === key){ MIDI.learn = null; toast('MIDI Learn 解除'); return; }
      MIDI.learn = key;
      // ラベル: 近傍 <label> → 無ければキーから推定
      const row = el.closest('.row');
      const lb = row ? row.querySelector('label') : null;
      const label = (lb ? lb.textContent.trim() : '') || MIDI._paramLabel(key.split(':')[1] || key);
      toast('MIDI Learn → ' + label + (el.type === 'checkbox' ? ': スイッチ/ボタンを操作' : ': つまみを動かして'));
    });
  },

  // #side 配下の range / checkbox に data-midi-key を自動付与する (mode エンジン param・トグルを一括対応)。
  //   既に data-midi-key を持つもの (post FX / shader @param) はそのまま。
  //   パネル再生成でも同じキーになるよう、要素 id か「コンテナ id + ラベル文字列」で導出する。
  _midiAutoTag(){
    const side = document.getElementById('side');
    if(!side || side._midiTagObs) return;
    const tag = (el)=>{
      if(!el || el.dataset.midiKey) return;
      if(el.type !== 'range' && el.type !== 'checkbox') return;
      // 左のラベル文字列をキーに使う (dom~id~pxAGain のような機械的表記を避ける)。
      const row = el.closest('.row') || el.parentElement;
      const lb = row ? row.querySelector('label') : null;
      let label = (lb ? lb.textContent.trim() : '').replace(/^[·・\s]+/, '').trim();
      if(!label){ const ti = el.getAttribute('title'); if(ti) label = ti.split(/[。\n(（]/)[0].trim(); }
      let key;
      if(el.id){
        // 静的要素(id あり)は一意なのでラベルのみ。ラベルが無ければ id。
        key = '*:dom~' + (label || el.id).replace(/\s+/g, '_');
      } else {
        if(!label) return;
        // 動的パネル(mode エンジン等)は同名ラベル衝突回避にコンテナ id を接頭辞。
        const cont = el.closest('[id]');
        key = '*:dom~' + (cont ? cont.id + '~' : '') + label.replace(/\s+/g, '_');
      }
      el.dataset.midiKey = key;
    };
    const scan = ()=>{ side.querySelectorAll('input[type=range], input[type=checkbox]').forEach(tag); };
    const obs = new MutationObserver(()=>scan());
    obs.observe(side, {childList:true, subtree:true});
    side._midiTagObs = obs;
    scan();
  },

  // 全 range/number 入力で「ダブルクリック → デフォルト値復帰」
  //   静的 HTML スライダーは初期 value 属性をデフォルトとして記録
  //   動的生成スライダーは生成側で data-default を埋めること
  // ダブルクリックで戻す値: 「デフォルト保存」を押した時点の各コントロール値を保持する
  _ctlDefaultsKey: 'vj.def.ctlDefaults',
  _loadCtlDefaults(){
    try{ const d = JSON.parse(localStorage.getItem(this._ctlDefaultsKey) || '{}');
         return (d && typeof d === 'object') ? d : {}; }catch(e){ return {}; }
  },
  // 「デフォルト保存」時に、そのパネル内コントロールの現在値を戻り先として記録
  _snapshotCtlDefaults(section){
    if(!section) return;
    const store = this._loadCtlDefaults();
    section.querySelectorAll('input[type=range], input[type=number], input[type=color]').forEach(el=>{
      if(!el.id || el.disabled) return;
      el.dataset.default = el.value;
      store[el.id] = el.value;
    });
    try{ localStorage.setItem(this._ctlDefaultsKey, JSON.stringify(store)); }catch(e){}
  },
  _bindSliderResetOnDblclick(){
    // 静的スライダーの初期値スナップショット
    document.querySelectorAll('input[type=range], input[type=number]').forEach(el=>{
      if(el.dataset.default === undefined){
        // value 属性 (= 初期値) を優先、なければ現在 value
        el.dataset.default = el.getAttribute('value') ?? el.value;
      }
    });
    // 起動時: 「デフォルト保存」済みコントロールの値を戻り先として復元
    const stored0 = this._loadCtlDefaults();
    Object.keys(stored0).forEach(id=>{
      const el = document.getElementById(id);
      if(el) el.dataset.default = stored0[id];
    });
    // グローバル dblclick リスナ (動的生成にも有効)
    document.addEventListener('dblclick', e=>{
      const el = e.target;
      if(!el || el.tagName !== 'INPUT') return;
      if(el.type !== 'range' && el.type !== 'number' && el.type !== 'color') return;
      // 戻り先: 「デフォルト保存」した値 → 無ければ初期値
      const store = UI._loadCtlDefaults();
      const saved = (el.id && store[el.id] !== undefined) ? store[el.id] : undefined;
      if(saved === undefined && el.dataset.default === undefined) return;
      el.value = saved !== undefined ? saved : el.dataset.default;
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
    });
    // 数値表示 (.val) のダブルクリック = 直接入力。
    //   同じ行の range スライダーを探して値を流し込む (全パネルの動的生成にも有効)。
    //   範囲外の入力は min/max へクランプ (= 一番近い有効値)。Enter 確定 / Esc 取消。
    document.addEventListener('dblclick', e=>{
      const val = e.target.closest ? e.target.closest('.val') : null;
      if(!val || val.querySelector('input')) return;
      const row = val.parentElement;
      const r = row ? row.querySelector('input[type=range]') : null;
      if(!r || r.disabled) return;
      const prev = val.textContent;
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = String(parseFloat(r.value));
      inp.style.cssText = 'width:100%;box-sizing:border-box;background:rgba(0,0,0,0.55);color:inherit;border:1px solid var(--acc,#888);border-radius:3px;font:inherit;text-align:right;padding:0 2px;outline:none';
      val.textContent = '';
      val.appendChild(inp);
      inp.focus(); inp.select();
      let done = false;
      const finish = (commit)=>{
        if(done) return; done = true;
        const txt = inp.value;
        val.textContent = prev;                     // 確定時は下の input イベントで正式表示に上書きされる
        if(!commit) return;
        let v = parseFloat(String(txt).replace(',', '.'));
        if(!isFinite(v)) return;                    // 数値でなければ元のまま
        const lo = parseFloat(r.min), hi = parseFloat(r.max);
        if(isFinite(lo) && v < lo) v = lo;          // 範囲外は一番近い有効値へ
        if(isFinite(hi) && v > hi) v = hi;
        r.value = v;
        r.dispatchEvent(new Event('input', {bubbles:true}));
        r.dispatchEvent(new Event('change', {bubbles:true}));
      };
      inp.addEventListener('keydown', ev=>{
        if(ev.key === 'Enter') finish(true);
        else if(ev.key === 'Escape') finish(false);
        ev.stopPropagation();                       // アプリのホットキーに食われない
      });
      inp.addEventListener('blur', ()=> finish(true));
      e.preventDefault();
      e.stopPropagation();
    }, true);
  },

  bindOverlay(){
    if(typeof Overlay === 'undefined') return;
    const O = Overlay.P;
	    const normOverlayBrush = mode => (Overlay && Overlay._brushName) ? Overlay._brushName(mode) : mode;
	    const isSmudgeMode = mode => {
	      mode = normOverlayBrush(mode);
	      return mode === 'smudge' || mode === 'smudgeWet' || mode === 'smudgeStretch';
	    };
	    O.brushMode = normOverlayBrush(O.brushMode);

    this.installRandomButtons();   // Save/Reset の並びに Random を追加
    this.installSliderDefaults();  // スライダーのダブルクリック = 既定値へ
    // option / overlay パネルのデフォルト保存・リセット (delegated)
    const side = $('#side');
    if(side && !side._saveDefBound){
      side._saveDefBound = true;
      side.addEventListener('click', (e)=>{
        const b = e.target.closest('.saveDefBtn, .resetDefBtn, .randDefBtn'); if(!b) return;
        e.preventDefault();
        e.stopPropagation();
        const kind = b.dataset.kind;
        if(b.classList.contains('randDefBtn')){ UI.randomizeSection(b.closest('.section'), kind); return; }
        if(b.classList.contains('resetDefBtn')){
          if(kind === 'overlay'){
            const m = Overlay.resetModeDefault();
            UI.refreshOverlay();
            Overlay.clear();
            if(typeof MIDI !== 'undefined') (MIDI.syncLeds ? MIDI.syncLeds() : MIDI.refreshLeds());
            toast('デフォルトをリセット: overlay (' + m + ')');
          }else if(kind === 'textdeformMd') UI.resetTextDeformMdDefault();
          else if(kind === 'ugomekiMd') UI.resetUgomekiMdDefault();
          else if(kind === 'spacetypeMd') UI.resetSpaceTypeMdDefault();
          else if(kind === 'slicerImg') UI.resetSlicerImgDefault();
          else if(kind === 'mix') App.resetMixDefault();
          else if(kind === 'transition') App.resetTransDefault();
          else if(kind === 'audioTransport') App.resetAudioTransportDefault();
          else if(kind === 'audioDetect') App.resetAudioDetectDefault();
          else if(kind === 'midiRelative') MIDI.resetRelativeDefault();
          else if(kind === 'sparam') App.clearShaderParamDefaults(App.activeSlot);
          else if(kind === 'image') UI.resetImageDefault();
          else App.resetEngineDefault(kind);
          return;
        }
        if(!/Md$/.test(kind || '')) UI._snapshotCtlDefaults(b.closest('.section'));
        // Save で「既定値」が変わるので、ダブルクリック復帰用の控えも更新する
        { const sec = b.closest('.section');
          if(sec) sec.querySelectorAll('input[type=range]').forEach(el=>{ el.dataset.defval = el.value; }); }
        if(kind === 'overlay'){ const m = Overlay.saveModeDefault(); toast('デフォルト保存: overlay ('+m+')'); }
        else if(kind === 'textdeformMd') UI.saveTextDeformMdDefault();
        else if(kind === 'ugomekiMd') UI.saveUgomekiMdDefault();
        else if(kind === 'spacetypeMd') UI.saveSpaceTypeMdDefault();
        else if(kind === 'slicerImg') UI.saveSlicerImgDefault();
        else if(kind === 'mix') App.saveMixDefault();
        else if(kind === 'transition') App.saveTransDefault();
        else if(kind === 'audioTransport') App.saveAudioTransportDefault();
        else if(kind === 'audioDetect') App.saveAudioDetectDefault();
        else if(kind === 'midiRelative') MIDI.saveRelativeDefault();
        else if(kind === 'sparam') App.saveShaderParamDefaults(App.activeSlot);
        else if(kind === 'image') UI.saveImageDefault();
        else App.saveEngineDefault(kind);
      }, true);
    }

    // チェックボックス
    const en = $('#ovEnable');  if(en){ en.checked = O.enabled; en.addEventListener('change', ()=>{ O.enabled = en.checked; if(!en.checked) Overlay.clear(); if(typeof MIDI !== 'undefined') (MIDI.syncLeds ? MIDI.syncLeds() : MIDI.refreshLeds()); }); }
    const pe = $('#ovPersist'); if(pe){ pe.checked = O.persist; pe.addEventListener('change', ()=>{ O.persist = pe.checked; if(!pe.checked) Overlay.clear(); }); }

    // select
    const br = $('#ovBrush');
    if(br){
      br.value = isSmudgeMode(O.brushMode) ? 'smudge' : O.brushMode;
      br.addEventListener('change', ()=>{
        O.brushMode = br.value;
        // 各ブラシ専用の初期値をロード + UI を再同期 (data-default も更新)
        Overlay.applyBrushDefaults(O.brushMode);
        UI.refreshOverlay();
        Overlay.clear(); // 古いストロークは消す (異モードが混ざらないように)
        if(typeof MIDI !== 'undefined') (MIDI.syncLeds ? MIDI.syncLeds() : MIDI.refreshLeds());
      });
    }
    const sd = $('#ovSubdiv');    if(sd){
      O.subdiv = Overlay._normalizeSubdiv ? Overlay._normalizeSubdiv(O.subdiv) : parseFloat(O.subdiv);
      sd.value = String(O.subdiv);
      sd.addEventListener('change', ()=>{
        O.subdiv = Overlay._normalizeSubdiv ? Overlay._normalizeSubdiv(sd.value) : parseFloat(sd.value);
        sd.value = String(O.subdiv);
        Overlay.lastSubBeat = -1;
      });
    }
    const cn = $('#ovCenter');    if(cn){ cn.value = O.centerMode; cn.addEventListener('change', ()=>{ O.centerMode = cn.value; }); }
    const dr = $('#ovDirection'); if(dr){ dr.value = O.direction;  dr.addEventListener('change', ()=>{ O.direction  = dr.value; }); }
    const fd = $('#ovFade');      if(fd){ fd.value = O.fadeShape;  fd.addEventListener('change', ()=>{ O.fadeShape  = fd.value; }); }
    const fn = $('#ovFinish');    if(fn){ fn.addEventListener('change', ()=>{
      if(isSmudgeMode(O.brushMode)){
        const next = fn.value === 'wet' ? 'smudgeWet' : 'smudge';
        if(O.brushMode !== next){
          O.brushMode = next;
          Overlay.applyBrushDefaults(next);
          UI.refreshOverlay();
          Overlay.clear();
          if(typeof MIDI !== 'undefined') (MIDI.syncLeds ? MIDI.syncLeds() : MIDI.refreshLeds());
        }
        return;
      }
      O.finish = fn.value;
    }); }

    // Clear Canvas
    const cc = $('#btnOverlayClear');
    if(cc) cc.addEventListener('click', ()=>{ Overlay.clear(); toast('Overlay cleared'); });

    // Random 🎲 (NOVEL 等と同じ「パラメータのみランダム化」。Brush の選択と Trigger / Paint Mode / Max Strokes は変えない)
    const rb = $('#btnOverlayRandom');
    if(rb) rb.addEventListener('click', ()=>{
      const R = (a, b)=> a + Math.random()*(b - a);
      const ch = (p)=> Math.random() < p;
      const pick = (arr)=> arr[(Math.random()*arr.length)|0];
      O.strokeLen    = +R(0.3, 4.5).toFixed(2);
      O.strokeLenVar = +R(0, 1).toFixed(2);
      O.curveAmt     = +R(-1, 1).toFixed(2);
      O.stamps       = 2 + ((Math.random()*118)|0);
      O.smudgeSpeed  = +R(0.1, 2.0).toFixed(2);
      O.searchPhase  = +R(0.05, 0.6).toFixed(2);
      O.searchAmp    = +R(0, 0.8).toFixed(2);
      O.searchFreq   = +R(0.5, 12).toFixed(1);
      O.fadePhase    = +R(0.05, 0.7).toFixed(2);
      O.sides        = 3 + ((Math.random()*28)|0);
      O.maxSides     = ch(0.6) ? 0 : Math.min(40, O.sides + ((Math.random()*10)|0));
      O.size         = +R(0.02, 0.35).toFixed(3);
      O.sizeVar      = +R(0, 1).toFixed(2);
      O.warp         = +R(0, 1).toFixed(2);
      O.explode      = +R(0, 1).toFixed(2);
      O.focal        = 5 + 5*((Math.random()*60)|0);
      O.rotPerStamp  = ch(0.5) ? 0 : +R(-1, 1).toFixed(2);
      O.spin         = ch(0.5) ? 0 : +R(-3, 3).toFixed(2);
      O.life         = +R(0.3, 4).toFixed(1);
      O.spawnCount   = 1 + ((Math.random()*3)|0);
      O.tipShape     = pick(['round', 'flat', 'gpen', 'finger']);
      O.centerMode   = ch(0.5) ? 'random' : pick(['center', 'grid', 'edge']);
      O.direction    = ch(0.5) ? 'random' : pick(['horizontal', 'vertical', 'rising', 'falling', 'radial', 'inward', 'spin']);
      O.fadeShape    = pick(['linear', 'easeOut', 'pulse']);
      // スライダー操作と同じ扱いで、ブラシ別保持キーへも反映する
      for(const k of (Overlay.BRUSH_KEYS || [])) if(O[k] !== undefined) Overlay.saveBrushParam(k, O[k]);
      UI.refreshOverlay();
      App._undoSchedule();
      toast('Overlay randomize');
    });

    // range スライダー (Post と同じヘルパー)。BRUSH_KEYS の場合は brushParams にも保存
    const brushKeySet = new Set(Overlay.BRUSH_KEYS || []);
    const slid = (id, key, format, valId)=>{
      const el = $('#'+id); const val = $('#'+(valId||(id+'Val')));
      if(!el) return;
      // O[key] 未定義(古い保存状態にキーが無い等)なら HTML の初期値で補完してクラッシュを防ぐ
      if(O[key] === undefined || O[key] === null) O[key] = parseFloat(el.value) || 0;
      el.value = O[key];
      if(val) val.textContent = format(O[key]);
      el.addEventListener('input', ()=>{
        const v = parseFloat(el.value);
        O[key] = v;
        if(val) val.textContent = format(O[key]);
        if(brushKeySet.has(key) && Overlay.saveBrushParam) Overlay.saveBrushParam(key, v);
      });
    };
    const f2 = v=>v.toFixed(2), f3 = v=>v.toFixed(3), f1 = v=>v.toFixed(1), fi = v=>String(v|0);
    slid('ovMaxStr',       'maxStrokes',   fi);
    slid('ovSpawnCnt',     'spawnCount',   fi);
    // Stroke Path
    slid('ovStrokeLen',    'strokeLen',    f2);
    slid('ovStrokeLenVar', 'strokeLenVar', f2);
    slid('ovCurve',        'curveAmt',     f2);
    slid('ovStamps',       'stamps',       fi);
    slid('ovSmudgeSpeed',  'smudgeSpeed',  f2);
    { const ts = $('#ovTipShape'); if(ts){   // 筆先形状 select (brushParams にも保存)
        if(O.tipShape === undefined || O.tipShape === null) O.tipShape = ts.value || 'round';
        ts.value = O.tipShape;
        ts.addEventListener('change', ()=>{
          O.tipShape = ts.value;
          if(Overlay.saveBrushParam) Overlay.saveBrushParam('tipShape', ts.value);
        }); } }
    { const db = $('#ovDrawBeats'); if(db){   // 拍単位の select (Trigger 連動=0 / それ以外は拍数)
        db.value = String(O.drawBeats == null ? 0 : O.drawBeats);
        db.addEventListener('change', ()=>{ O.drawBeats = parseFloat(db.value) || 0; }); } }
    // Probe motion
    slid('ovSearchPhase',  'searchPhase',  f2);
    slid('ovSearchAmp',    'searchAmp',    f2);
    slid('ovSearchFreq',   'searchFreq',   f1);
    slid('ovFadePhase',    'fadePhase',    f2);
    // Brush Shape (元 polygon ツールと同じ名前)
    slid('ovSides',        'sides',        fi);
    slid('ovMaxSides',    'maxSides',     fi);
    slid('ovSize',         'size',         f3);
    slid('ovSizeVar',      'sizeVar',      f2);
    slid('ovWarp',         'warp',         f2);
    slid('ovExplode',      'explode',      f2);
    slid('ovFocal',        'focal',        fi);
    slid('ovRotStep',      'rotPerStamp',  f2);
    slid('ovSpin',         'spin',         f2);
    slid('ovLife',         'life',         f1);

  },

	  refreshOverlay(){
	    if(typeof Overlay === 'undefined') return;
	    const O = Overlay.P;
	    const normOverlayBrush = mode => (Overlay && Overlay._brushName) ? Overlay._brushName(mode) : mode;
	    const isSmudgeMode = mode => {
	      mode = normOverlayBrush(mode);
	      return mode === 'smudge' || mode === 'smudgeWet' || mode === 'smudgeStretch';
	    };
	    O.brushMode = normOverlayBrush(O.brushMode);
    // 現ブラシの初期値 (dblclick リセット先)
    const bd = (Overlay.BRUSH_DEFAULTS && Overlay.BRUSH_DEFAULTS[O.brushMode]) || {};
    // 全ブラシ共通の dblclick リセット先 (検索/フェード系)
    const generalDef = {
      maxStrokes:300, spawnCount:1,
      searchPhase:0.05, searchAmp:0.35, searchFreq:5.0, fadePhase:0.35,
      smudgeSpeed:0.5,
      rotPerStamp:0.0, spin:0.0, life:1.5,
    };
    const setR = (id, v, fmt, key)=>{
      const el = $('#'+id), out = $('#'+id+'Val');
      if(el){
        el.value = v;
        // data-default 更新: ブラシ別 → 共通 → 現値 の順で優先
        const def = (bd[key] !== undefined) ? bd[key]
                   : (generalDef[key] !== undefined) ? generalDef[key]
                   : v;
        el.dataset.default = String(def);
      }
      if(out && fmt) out.textContent = fmt(v);
    };
    const setCb = (id, v)=>{
      const el = $('#'+id);
      if(el) el.checked = !!v;
    };
    const setSel = (id, v)=>{
      const el = $('#'+id);
      if(el) el.value = String(v);
    };
    const f2 = v=>v.toFixed(2), f3 = v=>v.toFixed(3), f1 = v=>v.toFixed(1), fi = v=>String(v|0);

    setCb('ovEnable',  O.enabled);
    setCb('ovPersist', O.persist);
    setR('ovMaxStr',       O.maxStrokes,   fi, 'maxStrokes');
    setR('ovSpawnCnt',     O.spawnCount,   fi, 'spawnCount');
    setR('ovStrokeLen',    O.strokeLen,    f2, 'strokeLen');
    setR('ovStrokeLenVar', O.strokeLenVar, f2, 'strokeLenVar');
    setR('ovCurve',        O.curveAmt,     f2, 'curveAmt');
    setR('ovStamps',       O.stamps,       fi, 'stamps');
    setR('ovSmudgeSpeed',  O.smudgeSpeed == null ? 0.5 : O.smudgeSpeed, f2, 'smudgeSpeed');
    { const ts = $('#ovTipShape'); if(ts) ts.value = O.tipShape || 'round'; }
    { const db = $('#ovDrawBeats'); if(db) db.value = String(O.drawBeats == null ? 0 : O.drawBeats); }
    setR('ovSearchPhase',  O.searchPhase,  f2, 'searchPhase');
    setR('ovSearchAmp',    O.searchAmp,    f2, 'searchAmp');
    setR('ovSearchFreq',   O.searchFreq,   f1, 'searchFreq');
    setR('ovFadePhase',    O.fadePhase,    f2, 'fadePhase');
    setR('ovSides',        O.sides,        fi, 'sides');
    setR('ovMaxSides',    O.maxSides,    fi, 'maxSides');
    setR('ovSize',         O.size,         f3, 'size');
    setR('ovSizeVar',      O.sizeVar,      f2, 'sizeVar');
    setR('ovWarp',         O.warp,         f2, 'warp');
    setR('ovExplode',      O.explode,      f2, 'explode');
    setR('ovFocal',        O.focal,        fi, 'focal');
    setR('ovRotStep',      O.rotPerStamp,  f2, 'rotPerStamp');
    setR('ovSpin',         O.spin,         f2, 'spin');
    setR('ovLife',         O.life,         f1, 'life');
    setSel('ovBrush',     isSmudgeMode(O.brushMode) ? 'smudge' : O.brushMode);
    O.subdiv = Overlay._normalizeSubdiv ? Overlay._normalizeSubdiv(O.subdiv) : O.subdiv;
    setSel('ovSubdiv',    O.subdiv);
    setSel('ovCenter',    O.centerMode);
    setSel('ovDirection', O.direction);
    setSel('ovFade',      O.fadeShape);
    const fn = document.getElementById('ovFinish');
    if(fn){
      const smudge = isSmudgeMode(O.brushMode);
      const optionMode = smudge ? 'smudge' : 'paint';
      if(fn.dataset.optionMode !== optionMode){
        fn.dataset.optionMode = optionMode;
        fn.innerHTML = '';
        const opts = smudge ? [['dry', 'Dry'], ['wet', 'Wet']] : [['gloss', 'Gloss'], ['matt', 'Matt']];
        for(const optData of opts){
          const opt = document.createElement('option');
          opt.value = optData[0];
          opt.textContent = optData[1];
          fn.appendChild(opt);
        }
      }
      fn.value = smudge
        ? ((O.brushMode === 'smudgeWet' || O.brushMode === 'smudgeStretch') ? 'wet' : 'dry')
        : (O.finish || 'gloss');
    }
	    // Finish 行は Smudge の Dry/Wet 切替として表示
	    const fr = document.getElementById('ovFinishRow');
	    if(fr) fr.style.display = isSmudgeMode(O.brushMode) ? '' : 'none';
    const ssr = document.getElementById('ovSmudgeSpeedRow');
    if(ssr) ssr.style.display = isSmudgeMode(O.brushMode) ? '' : 'none';
    const tfr = document.getElementById('ovTipShapeRow');
    if(tfr) tfr.style.display = isSmudgeMode(O.brushMode) ? '' : 'none';
    const smShow = isSmudgeMode(O.brushMode) ? '' : 'none';
    const dbr = document.getElementById('ovDrawBeatsRow');  if(dbr)  dbr.style.display  = smShow;
    const dbh = document.getElementById('ovDrawBeatsHelp');  if(dbh) dbh.style.display = smShow;
  },

  bindManga(){
    if(typeof Manga === 'undefined') return;
    const M = Manga.P;
    const f2 = v=>v.toFixed(2), f1 = v=>v.toFixed(1), fi = v=>String(v|0);
    const slid = (id, key, format)=>{
      const el = $('#'+id); const val = $('#'+id+'Val');
      if(!el) return;
      el.value = M[key];
      if(val) val.textContent = format(M[key]);
      el.addEventListener('input', ()=>{
        M[key] = parseFloat(el.value);
        if(val) val.textContent = format(M[key]);
      });
    };

    // ファイル読込 (個別 / フォルダ)
    const lb = $('#btnMangaLoad');
    const fi_ = $('#fileMangaImg');
    if(lb && fi_){
      lb.addEventListener('click', ()=>fi_.click());
      fi_.addEventListener('change', async e=>{
        if(!Manga.initialized) Manga.init(GL.gl);
        const n = await Manga.loadFromFiles(e.target.files);
        const st = $('#mangaStatus');
        if(st) st.textContent = `${n} images loaded`;
        e.target.value = '';
      });
    }
    const ldb = $('#btnMangaLoadDir');
    const fdi = $('#fileMangaDir');
    if(ldb && fdi){
      ldb.addEventListener('click', ()=>fdi.click());
      fdi.addEventListener('change', async e=>{
        if(!Manga.initialized) Manga.init(GL.gl);
        const files = Array.from(e.target.files).filter(f => /^image\//.test(f.type));
        const n = await Manga.loadFromFiles(files);
        const st = $('#mangaStatus');
        if(st) st.textContent = `${n} images loaded (folder)`;
        e.target.value = '';
      });
    }
    const rs = $('#btnMangaReseed');
    if(rs) rs.addEventListener('click', ()=>{ Manga.reseed(); toast('Manga reseeded'); });
    const cc = $('#btnMangaClear');
    if(cc) cc.addEventListener('click', ()=>{ Manga.clear(); toast('Manga cleared'); });

    // Motion mode
    const md = $('#mgModeDrone'), mb = $('#mgModeBeat');
    const syncMode = ()=>{
      md.classList.toggle('on', M.motionMode === 'drone');
      mb.classList.toggle('on', M.motionMode === 'beat');
    };
    if(md && mb){
      syncMode();
      md.addEventListener('click', ()=>{
        M.motionMode = 'drone';
        syncMode();
        // DRONE はカメラが全面パン → キャンバス全体に panel が必要なので再フィル
        if(Manga.images.length > 0) Manga.reseed();
        toast('Manga: DRONE');
      });
      mb.addEventListener('click', ()=>{
        M.motionMode = 'beat';
        syncMode();
        Manga.lastBeatStep = -1; // 即時にトリガ可能に
        toast('Manga: BEAT');
      });
    }

    // Subdiv
    const sd = $('#mgSubdiv');
    if(sd){
      sd.value = String(M.subdiv);
      sd.addEventListener('change', ()=>{ M.subdiv = parseFloat(sd.value); Manga.lastBeatStep = -1; });
    }

    // Auto reset checkbox
    const ar = $('#mgAuto');
    if(ar){
      ar.checked = !!M.autoReset;
      ar.addEventListener('change', ()=>{ M.autoReset = ar.checked; });
    }

    slid('mgSpawnMin',  'spawnMin',     fi);
    slid('mgSpawnMax',  'spawnMax',     fi);
    slid('mgJitter',    'jitterPx',     fi);
    slid('mgPnlMin',    'panelSizeMin', f2);
    slid('mgPnlMax',    'panelSizeMax', f2);
    slid('mgReset',     'resetProb',    f2);
    slid('mgCamRate',   'droneCamRate', f2);
    slid('mgZBase',     'droneZoomBase',f2);
    slid('mgZAmp',      'droneZoomAmp', f2);
    slid('mgZRate',     'droneZoomRate',f2);
    slid('mgBZoom',     'beatZoom',     f2);
    slid('mgInit',      'initialCount', fi);
    slid('mgPageScale', 'pageScale',    f1);
    slid('mgManualZoom','manualZoom',   f2);

    // BG color
    const bg = $('#mgBg');
    if(bg){
      const toHex = arr=>'#'+arr.map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
      bg.value = toHex(M.bgColor);
      bg.dataset.default = toHex(App.resetValueFor('manga', 'bgColor', Manga.PDefaults.bgColor));
      bg.addEventListener('input', ()=>{
        const v = bg.value;
        M.bgColor = [parseInt(v.slice(1,3),16)/255, parseInt(v.slice(3,5),16)/255, parseInt(v.slice(5,7),16)/255];
        // BG 変更を反映するため次回 clearPage で適用 (ここでは何もしない)
      });
    }
  },

  bindVideo(){
    if(typeof Movie === 'undefined') return;
    // 再生設定のみ (手動プレイヤー / ライブラリ UI は Movie サムネと重複のため廃止)
    const fit = $('#vidFit');
    if(fit) fit.addEventListener('change', ()=>{ Movie.setFit(fit.value); });
    const rate = $('#vidRate'); const rv = $('#vidRateVal');
    if(rate) rate.addEventListener('input', ()=>{
      const v = parseFloat(rate.value);
      Movie.setRate(v);
      if(rv) rv.textContent = v.toFixed(2);
    });
  },

  refreshBeatMode(){
    const dr = $('#btnModeDrone'), be = $('#btnModeBeat');
    if(!dr || !be) return;
    dr.classList.toggle('on', App.beatMode==='drone');
    be.classList.toggle('on', App.beatMode==='beat');
  },
  bindBeatMode(){
    const dr = $('#btnModeDrone'), be = $('#btnModeBeat');
    if(!dr || !be) return;
    this.refreshBeatMode();
    dr.addEventListener('click', ()=>{ App.beatMode='drone'; this.refreshBeatMode(); toast('Motion: DRONE'); });
    be.addEventListener('click', ()=>{ App.beatMode='beat';  this.refreshBeatMode(); toast('Motion: BEAT'); });
    const sp = $('#globalSpeed');
    if(sp){
      sp.addEventListener('input', ()=>{ App.setSpeed(parseFloat(sp.value)); });
      this.refreshSpeed();
    }
  },
  refreshSpeed(){
    const sp = $('#globalSpeed'), v = $('#globalSpeedVal');
    if(sp) sp.value = App.speed;
    if(v) v.textContent = App.speed.toFixed(2);
  },

  bindAudioTransport(){
    const at = App.audioTime;
    const dir = $('#atDirMode'), spd = $('#atSpeedMode');
    if(dir) dir.addEventListener('change', ()=>{
      App.setAudioDirMode(dir.value || 'off');
      toast('Audio → Direction: '+dir.options[dir.selectedIndex].text);
    });
    if(spd) spd.addEventListener('change', ()=>{
      at.speedMode = spd.value || 'off';
      if(at.speedMode === 'off') App._audioSpeedMul = 1;
      toast('Audio → Speed: '+spd.options[spd.selectedIndex].text);
    });
    const dep = $('#atDepth'), depV = $('#atDepthVal');
    if(dep) dep.addEventListener('input', ()=>{ at.depth = parseFloat(dep.value); if(depV) depV.textContent = at.depth.toFixed(2); });
    const thr = $('#atThr'), thrV = $('#atThrVal');
    if(thr) thr.addEventListener('input', ()=>{ at.threshold = parseFloat(thr.value); if(thrV) thrV.textContent = at.threshold.toFixed(2); });
    this.refreshAudioTransport();
  },
  refreshAudioTransport(){
    const at = App.audioTime || {};
    const dir = $('#atDirMode'); if(dir) dir.value = at.dirMode || 'off';
    const spd = $('#atSpeedMode'); if(spd) spd.value = at.speedMode || 'off';
    const dep = $('#atDepth'), depV = $('#atDepthVal');
    if(dep){ dep.value = (at.depth != null) ? at.depth : 0.5; if(depV) depV.textContent = (+dep.value).toFixed(2); }
    const thr = $('#atThr'), thrV = $('#atThrVal');
    if(thr){ thr.value = (at.threshold != null) ? at.threshold : 0.5; if(thrV) thrV.textContent = (+thr.value).toFixed(2); }
  },

  bindLayer(){
    const fileBtn = $('#btnLayerLoad');
    const fileInp = $('#fileLayerImg');
    if(fileBtn && fileInp){
      fileBtn.addEventListener('click', ()=>fileInp.click());
      fileInp.addEventListener('change', async e=>{
        const files = e.target.files;
        if(!files || !files.length) return;
        if(!Layer.initialized) Layer.init(GL.gl);
        const n = await Layer.loadImages(files);
        $('#layerStatus').textContent = `${n} images loaded`;
        e.target.value = '';
      });
    }
    const dirBtn = $('#btnLayerLoadDir');
    const dirInp = $('#fileLayerDir');
    if(dirBtn && dirInp){
      dirBtn.addEventListener('click', ()=>dirInp.click());
      dirInp.addEventListener('change', async e=>{
        const files = Array.from(e.target.files).filter(f => /^image\//.test(f.type));
        if(!files.length) return;
        if(!Layer.initialized) Layer.init(GL.gl);
        const n = await Layer.loadImages(files);
        $('#layerStatus').textContent = `${n} images loaded (folder)`;
        e.target.value = '';
      });
    }
    const clr = $('#btnLayerClear');
    if(clr) clr.addEventListener('click', ()=>{ if(Layer.initialized){ Layer.clearImages(); $('#layerStatus').textContent='no images'; }});
    const rs = $('#btnLayerReseed');
    if(rs) rs.addEventListener('click', ()=>{ if(Layer.initialized){ Layer.P.seed = Math.floor(Math.random()*999); Layer.generateLayout(); }});
  },

  // Layer Option パネル: Post タブと同一の .row レイアウトで動的生成
  refreshLayerParams(){
    const root = $('#layerParams');
    if(!root) return;
    root.innerHTML = '';
    if(!Layer.initialized){
      root.innerHTML = '<div class="help">Layer preset を選ぶと初期化されます</div>';
      return;
    }
    const specs = [
      // [label, key, min, max, step, fmt, onChange?]
      ['Count',         'count',      0,   120, 1,     v=>((v|0)===0?'auto':String(v|0)), ()=>Layer.generateLayout()],
      ['BG',            'bg',         0,   1,   0.02,  v=>v.toFixed(2)],
      ['Size',          'size',       0.1, 4.0, 0.05,  v=>v.toFixed(2)],
      ['Size Var',      'sizeVar',    0,   1.5, 0.05,  v=>v.toFixed(2)],
      ['Spread',        'spread',     1,   40,  0.5,   v=>v.toFixed(1),  ()=>Layer.generateLayout()],
      ['Seed',          'seed',       0,   999, 1,     v=>String(v|0),   ()=>Layer.generateLayout()],
      ['Curvature',     'curvature',  0,   1,   0.05,  v=>v.toFixed(2)],
      ['Spin',          'spin',       0,   3,   0.05,  v=>v.toFixed(2)],
      ['Float',         'float',      0,   2,   0.05,  v=>v.toFixed(2)],
      ['Cam Orbit',     'autorot',    0,   1,   0.01,  v=>v.toFixed(2)],
      ['Distance',      'dist',       2,   80,  0.5,   v=>v.toFixed(1)],
      ['FOV',           'fov',        10,  150, 1,     v=>String(v|0)],
      ['Cam Elev',      'camEl',     -1.4, 1.4, 0.05,  v=>v.toFixed(2)],
      ['Ambient',       'ambient',    0,   1,   0.05,  v=>v.toFixed(2)],
      ['Rim',           'rim',        0,   1,   0.05,  v=>v.toFixed(2)],
      ['Fog',           'fog',        0,   0.2, 0.002, v=>v.toFixed(3)],
      ['Light Az',      'lightAz',    0,   360, 1,     v=>String(v|0)],
      ['Shadow Str',    'shadowStr',  0,   1,   0.05,  v=>v.toFixed(2)],
      ['Shadow Soft',   'shadowSoft', 0,   10,  0.5,   v=>v.toFixed(1)],
      ['Ground Mult',   'groundMult', -3,  0.5, 0.1,   v=>v.toFixed(1)],
      ['Ground Brt',    'groundBrt',  0,   1,   0.05,  v=>v.toFixed(2)],
    ];
    for(const [label, key, mi, ma, st, fmt, cb] of specs){
      const row = document.createElement('div'); row.className = 'row';
      const lab = document.createElement('label'); lab.textContent = label;
      const inp = document.createElement('input'); inp.type='range'; inp.min=mi; inp.max=ma; inp.step=st; inp.value=Layer.P[key];
      // ダブルクリックで戻すデフォルト値 (Layer.PDefaults スナップショット)
      const dvFac = (Layer.PDefaults && Layer.PDefaults[key] !== undefined) ? Layer.PDefaults[key] : Layer.P[key];
      inp.dataset.default = String(App.resetValueFor('layer', key, dvFac));
      const val = document.createElement('div'); val.className='val'; val.textContent = fmt(Layer.P[key]);
      inp.addEventListener('input', ()=>{
        Layer.P[key] = parseFloat(inp.value);
        val.textContent = fmt(Layer.P[key]);
        if(cb) cb();
      });
      row.appendChild(lab); row.appendChild(inp); row.appendChild(val);
      root.appendChild(row);
    }

    // トグル系: チェックボックスで Post タブ (Invert 行と同じスタイル) に揃える
    const mkToggle = (label, key)=>{
      const row = document.createElement('div'); row.className='row';
      const lab = document.createElement('label'); lab.textContent = label;
      const inp = document.createElement('input'); inp.type='checkbox'; inp.checked = !!Layer.P[key];
      inp.addEventListener('change', ()=>{ Layer.P[key] = inp.checked; });
      row.appendChild(lab); row.appendChild(inp);
      root.appendChild(row);
    };
    mkToggle('Shadow', 'shadowOn');
    mkToggle('Ground', 'showGround');
    mkToggle('PNG α',  'pngAlpha');

    // BG Color (color picker を Post タブと同じ .row 構造で)
    const bgRow = document.createElement('div'); bgRow.className='row';
    const bgLab = document.createElement('label'); bgLab.textContent = 'BG Color';
    const bgInp = document.createElement('input'); bgInp.type='color';
    const toHex = (rgb)=>'#'+rgb.map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
    bgInp.value = toHex(Layer.P.bgColor);
    const bgDef = (Layer.PDefaults && Layer.PDefaults.bgColor) ? toHex(Layer.PDefaults.bgColor) : bgInp.value;
    bgInp.dataset.default = bgDef;
    bgInp.addEventListener('input', ()=>{
      const v = bgInp.value;
      Layer.P.bgColor = [parseInt(v.slice(1,3),16)/255, parseInt(v.slice(3,5),16)/255, parseInt(v.slice(5,7),16)/255];
    });
    bgRow.appendChild(bgLab); bgRow.appendChild(bgInp);
    root.appendChild(bgRow);
  },

  refreshPenParams(){
    const root = $('#penParams');
    if(!root) return;
    root.innerHTML = '';
    if(typeof Pen === 'undefined' || !Pen.initialized){
      root.innerHTML = '<div class="help">Pen preset を選ぶと初期化されます</div>';
      return;
    }
    if(!Pen._PDef) Pen._PDef = Object.assign({}, Pen.P);
    const growStrokes = ()=>{ while(Pen.strokes && Pen.strokes.length < Pen.P.count) Pen.strokes.push(Pen.makeRandomStroke((Pen.clock||0) - Pen._rand(0,1.5))); };
    const specs = [
      // [label, key, min, max, step, fmt, onChange?]
      ['Count',   'count',  10,  400, 10,   v=>String(v|0), growStrokes],
      ['Width',   'width',  0.2, 3.0, 0.05, v=>v.toFixed(2)],
      ['Length',  'len',    0.2, 3.0, 0.05, v=>v.toFixed(2)],
      ['Bleed',   'bleed',  0,   2.5, 0.05, v=>v.toFixed(2)],
      ['Kasure',  'kasure', 0,   2.5, 0.05, v=>v.toFixed(2)],
      ['Peak',    'peak',   0,   2.5, 0.05, v=>v.toFixed(2)],
      ['Depth',   'depth',  0,   1.0, 0.05, v=>v.toFixed(2)],
      ['Speed',   'speed',  0.1, 3.0, 0.05, v=>v.toFixed(2)],
      ['Color',   'color',  0,   2,   1,    v=>(['Mono','Random','Shared'][v|0] || String(v|0))],
    ];
    for(const [label, key, mi, ma, st, fmt, cb] of specs){
      const row = document.createElement('div'); row.className = 'row';
      const lab = document.createElement('label'); lab.textContent = label;
      const inp = document.createElement('input'); inp.type='range'; inp.min=mi; inp.max=ma; inp.step=st; inp.value=Pen.P[key];
      inp.dataset.default = String(App.resetValueFor('pen', key, Pen._PDef[key] !== undefined ? Pen._PDef[key] : Pen.P[key]));
      const val = document.createElement('div'); val.className='val'; val.textContent = fmt(Pen.P[key]);
      inp.addEventListener('input', ()=>{ Pen.P[key] = parseFloat(inp.value); val.textContent = fmt(Pen.P[key]); if(cb) cb(); });
      row.appendChild(lab); row.appendChild(inp); row.appendChild(val);
      root.appendChild(row);
    }
  },

  // MIDI Relative の UI を MIDI の現在値へ同期。
  //   バインドは MIDI の localStorage 復元より先に走るため、復元後にこれを呼ばないと
  //   「Save したのに戻っていない」ように見える (内部値は復元済みでも UI が HTML 既定値のまま)。
  refreshMidiRelative(){
    if(typeof MIDI === 'undefined') return;
    const rel = $('#midiRelative'); if(rel) rel.checked = !!MIDI.relative;
    const mode = $('#midiRelMode'); if(mode && MIDI.relMode) mode.value = MIDI.relMode;
    const stp = $('#midiRelStep');  if(stp) stp.value = String(MIDI.relStep);
    const stpV = $('#midiRelStepVal'); if(stpV) stpV.textContent = String(MIDI.relStep);
  },
  refreshNovelParams(){
    const root = $('#novelParams');
    if(!root) return;
    root.innerHTML = '';
    if(typeof NovelTerminal === 'undefined' || !NovelTerminal.P){
      root.innerHTML = '<div class="help">Novel preset を選ぶと初期化されます</div>';
      return;
    }
    const P = NovelTerminal.P;
    if(!NovelTerminal._PDef) NovelTerminal._PDef = Object.assign({}, P);
    const mkRow = (label)=>{
      const row = document.createElement('div'); row.className = 'row';
      const lab = document.createElement('label'); lab.textContent = label;
      row.appendChild(lab); root.appendChild(row);
      return row;
    };
    // ── Scene 選択 (Random / 各シーン) ──
    {
      const row = mkRow('Scene');
      const sel = document.createElement('select'); sel.style.flex = '1';
      sel.title = 'Random=Scene Beats 拍ごとに抽選 (beatモードのみ。droneでは現在のシーンを維持) / それ以外=固定';
      const items = [['random','Random'],['fluid','Fluid (構図)'],['melt','Meltdown'],['columns','Columns (段組)'],['vert','Vertical (縦書き)'],['typer','Typer'],['render','ASCII Render']];
      for(const [v, name] of items){ const o = document.createElement('option'); o.value = v; o.textContent = name; sel.appendChild(o); }
      sel.value = items.some(i=>i[0]===P.scene) ? P.scene : 'fluid';
      sel.addEventListener('change', ()=>{ P.scene = sel.value; NovelTerminal._scEp = undefined; App._undoSchedule(); });
      row.appendChild(sel);
    }
    // ── Random 🎲 (パラメータのみランダム化。scene 選択は変えない) ──
    {
      const row = mkRow('Randomize');
      const b = document.createElement('button'); b.style.flex = '1'; b.textContent = 'Random 🎲';
      b.title = '動き・密度・色などのパラメータをランダム生成 (Scene の選択は変えない。保存は右上の Save)';
      b.addEventListener('click', ()=>{
        const R = (a, bb)=> a + Math.random()*(bb - a);
        const ch = (pp)=> Math.random() < pp;
        P.speed      = +R(0.5, 1.8).toFixed(2);
        P.charSize   = +R(0.7, 1.8).toFixed(2);
        P.sceneSpeed = +R(0.5, 2.2).toFixed(2);
        P.density    = +R(0.6, 1.6).toFixed(2);
        P.drift      = +R(0.2, 2.2).toFixed(2);
        P.split      = +R(0, 1.2).toFixed(2);
        P.glitch     = +R(0, 2.5).toFixed(2);
        P.alpha      = +R(0.7, 1.4).toFixed(2);
        P.tint       = +R(0, 2).toFixed(2);
        P.inkMode    = ch(0.55) ? 0 : (Math.random()*4)|0;
        P.palette    = ch(0.4) ? -1 : (Math.random()*6)|0;
        P.vertLayer  = ch(0.75);
        P.holeLayer  = ch(0.7);
        P.cursor     = ch(0.6);
        this.refreshNovelParams();
        App._undoSchedule();
        toast('NOVEL randomize');
      });
      row.appendChild(b);
    }
    // ── スライダー ──
    const specs = [
      // [label, key, min, max, step, fmt, title]
      ['Scene Beats', 'sceneBeats', 1,   64,  1,    v=>String(v|0), 'Scene=Random 時に切り替える拍数 (beatモードのみ)'],
      ['Speed',       'speed',      0.1, 3.0, 0.05, v=>v.toFixed(2), '全体の時間スケール'],
      ['Char Size',   'charSize',   0.5, 2.5, 0.05, v=>v.toFixed(2), '文字サイズ倍率'],
      ['Density',     'density',    0.3, 2.0, 0.05, v=>v.toFixed(2), 'Fluid: 文字の詰まり具合'],
      ['Drift',       'drift',      0,   3.0, 0.05, v=>v.toFixed(2), 'Fluid: 文字面がゆっくり流れる量'],
      ['Split',       'split',      0,   1.2, 0.05, v=>v.toFixed(2), 'Fluid: 矩形分割コンポジションの強さ'],
      ['Glitch',      'glitch',     0,   4.0, 0.05, v=>v.toFixed(2), '半角カナグリッチ置換の頻度'],
      ['Alpha',       'alpha',      0.3, 2.0, 0.05, v=>v.toFixed(2), '文字の濃度'],
      ['Fluid Cycle', 'sceneSpeed', 0.2, 3.0, 0.05, v=>v.toFixed(2), 'Fluid 内部の構図サイクル速度'],
      ['Terminal Tint','tint',      0,   2.5, 0.05, v=>v.toFixed(2), '端末グリーンの混色量'],
      ['Beat Flash',  'beatFlash',  0,   3.0, 0.05, v=>v.toFixed(2), '拍頭フラッシュ量'],
      ['Morph',       'morph',      0,   3.0, 0.05, v=>v.toFixed(2), '旧シーン間の変形トランジション秒数 (0=カット)'],
    ];
    for(const [label, key, mi, ma, st2, fmt, title] of specs){
      const row = mkRow(label);
      const inp = document.createElement('input'); inp.type='range'; inp.min=mi; inp.max=ma; inp.step=st2; inp.value=P[key];
      if(title) inp.title = title;
      inp.dataset.default = String(App.resetValueFor('novel', key, NovelTerminal._PDef[key] !== undefined ? NovelTerminal._PDef[key] : P[key]));
      const val = document.createElement('div'); val.className='val'; val.textContent = fmt(P[key]);
      inp.addEventListener('input', ()=>{ P[key] = parseFloat(inp.value); val.textContent = fmt(P[key]); });
      row.appendChild(inp); row.appendChild(val);
    }
    // ── Ink / Palette セレクト ──
    {
      const row = mkRow('Ink');
      const sel = document.createElement('select'); sel.style.flex = '1';
      sel.title = '文字色: Variant=構図ごとの配色 / 品詞=文字種で色分け / Mono=白 / Terminal=緑';
      [['0','Variant'],['1','品詞カラー'],['2','Mono'],['3','Terminal']].forEach(([v,n])=>{ const o=document.createElement('option'); o.value=v; o.textContent=n; sel.appendChild(o); });
      sel.value = String(P.inkMode|0);
      sel.addEventListener('change', ()=>{ P.inkMode = parseInt(sel.value,10)||0; App._undoSchedule(); });
      row.appendChild(sel);
    }
    {
      const row = mkRow('Palette');
      const sel = document.createElement('select'); sel.style.flex = '1';
      sel.title = 'ASCII Render シーンの配色';
      [['-1','Random'],['0','Amber'],['1','Cyan'],['2','Pink'],['3','Green'],['4','Burn'],['5','Mono']].forEach(([v,n])=>{ const o=document.createElement('option'); o.value=v; o.textContent=n; sel.appendChild(o); });
      sel.value = String(P.palette|0);
      sel.addEventListener('change', ()=>{ P.palette = parseInt(sel.value,10); App._undoSchedule(); });
      row.appendChild(sel);
    }
    // ── チェックボックス ──
    {
      const row = mkRow('Layers');
      const mkCb = (key, name, title)=>{
        const lab = document.createElement('label');
        lab.style.cssText = 'display:flex;align-items:center;gap:4px;min-width:auto';
        if(title) lab.title = title;
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = P[key] !== false;
        cb.addEventListener('change', ()=>{ P[key] = cb.checked; App._undoSchedule(); });
        lab.appendChild(cb); lab.appendChild(document.createTextNode(name));
        row.appendChild(lab);
      };
      mkCb('vertLayer', '縦書き', 'Fluid: 右→左の縦書きレイヤー');
      mkCb('holeLayer', '黒抜き', 'Fluid: 図形内を黒文字で抜くレイヤー');
      mkCb('cursor', 'カーソル', 'Fluid: 下部の走査カーソル');
    }
  },

  refreshCyberParams(){
    const root = $('#cyberParams');
    if(!root) return;
    root.innerHTML = '';
    if(typeof CyberUI === 'undefined' || !CyberUI.P){
      root.innerHTML = '<div class="help">CYBER UI preset を選ぶと初期化されます</div>';
      return;
    }
    const P = CyberUI.P;
    if(!CyberUI._PDef) CyberUI._PDef = Object.assign({}, P);
    // スライダー系
    const sliders = [
      ['Spin',       'spin',      0,   4,   0.05, v=>v.toFixed(2)],   // リング回転速度
      ['Speed',      'speed',     0.1, 3,   0.05, v=>v.toFixed(2)],   // 全体の時間速度
      ['Audio Sync', 'audioSync', 0,   1,   0.02, v=>v.toFixed(2)],   // 音量同期(0=常時 / 1=無音で引っ込む)
      ['Bar Length', 'barLen',    0.2, 2,   0.05, v=>v.toFixed(2)],   // バーの長さ倍率
    ];
    for(const [label, key, mi, ma, st, fmt] of sliders){
      const row = document.createElement('div'); row.className = 'row';
      const lab = document.createElement('label'); lab.textContent = label;
      const inp = document.createElement('input'); inp.type='range'; inp.min=mi; inp.max=ma; inp.step=st; inp.value=P[key];
      inp.dataset.default = String(App.resetValueFor('cyberui', key, CyberUI._PDef[key] !== undefined ? CyberUI._PDef[key] : P[key]));
      const val = document.createElement('div'); val.className='val'; val.textContent = fmt(P[key]);
      inp.addEventListener('input', ()=>{ P[key] = parseFloat(inp.value); val.textContent = fmt(P[key]); });
      row.appendChild(lab); row.appendChild(inp); row.appendChild(val);
      root.appendChild(row);
    }
    // トグル系 (有無)
    const toggles = [
      ['Black',   'black'],     // 黒いHUD線
      ['Bars',    'bars'],      // FFT バーリング
      ['Clock',   'clock'],     // 時計の針
      ['Emblem',  'emblem'],    // 中央エンブレム
      ['CD Bars', 'cdBars'],    // 縁のマーキー帯
      ['Console', 'console'],   // 端末ログ
    ];
    for(const [label, key] of toggles){
      const row = document.createElement('div'); row.className = 'row';
      const lab = document.createElement('label'); lab.textContent = label;
      const cbx = document.createElement('input'); cbx.type='checkbox'; cbx.checked = !!P[key];
      cbx.addEventListener('change', ()=>{ P[key] = cbx.checked ? 1 : 0; });
      const wrap = document.createElement('div'); wrap.appendChild(cbx);
      row.appendChild(lab); row.appendChild(wrap);
      root.appendChild(row);
    }
  },

  // セクション見出し (h3) クリックで折りたたみ。状態は localStorage に保持。
  bindCollapse(){
    const KEY = 'vj.ui.collapsed';
    let saved = {};
    try{ saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }catch(e){}
    const keyOf = (h3)=>{
      const pane = h3.closest('.pane');
      const t = ((h3.childNodes[0] && h3.childNodes[0].textContent) || h3.textContent || '').trim();
      return (pane && pane.dataset.pane ? pane.dataset.pane + ':' : '') + t;
    };
    document.querySelectorAll('#side .section > h3').forEach(h3=>{
      if(saved[keyOf(h3)]) h3.parentElement.classList.add('collapsed');
    });
    const side = document.getElementById('side');
    if(side) side.addEventListener('click', (e)=>{
      const h3 = e.target.closest('.section > h3');
      if(!h3) return;
      if(e.target.closest('button, input, select, a')) return;   // 見出し内の操作要素は除外
      const sec = h3.parentElement;
      sec.classList.toggle('collapsed');
      const k = keyOf(h3);
      if(sec.classList.contains('collapsed')) saved[k] = true; else delete saved[k];
      try{ localStorage.setItem(KEY, JSON.stringify(saved)); }catch(e2){}
    });
  },

  bindPostFx(){
    // slid() で作った Post スライダーは登録簿に控え、refreshPost で機械的に同期する。
    //   refreshPost は元々 set() の明示リストで、新しい FX を足すたびに追記が漏れ
    //   「MIDI で動かしても UI が動かない」事故になっていたため。
    UI._postSlid = UI._postSlid || [];
    const slid = (id, key, format)=>{
      const el = $('#'+id); const val = $('#'+id+'Val');
      if(!el) return;
      el.value = App.post[key];
      // パラメータ欄は実効値のみ表示 (|値|<0.1 は "0.0")。生値の括弧併記は右上 HUD 側で行う。
      const disp = (v)=> App.effDisplay(v, format);
      if(val) val.textContent = disp(App.post[key]);
      if(MIDI.postRange[key]) el.dataset.midiKey = '*:__post__' + key;   // 右クリック MIDI Learn 対象
      if(!UI._postSlid.some(r => r.id === id)) UI._postSlid.push({id, key, disp});
      el.addEventListener('input', ()=>{
        App.post[key] = App.snapPost(key, parseFloat(el.value));
        if(val) val.textContent = disp(App.post[key]);
      });
    };
    const f2 = v=>v.toFixed(2), f3 = v=>v.toFixed(3), fi = v=>String(v|0);
    slid('pxGamma','gamma',f2);
    // Saturation: UI/MIDI は -1..+1 (0=中立)、描画内部値は 0..2 (1=中立)。
    { const el = $('#pxSat'), val = $('#pxSatVal');
      if(el){
        el.value = (App.post.sat != null ? App.post.sat : 1.0) - 1.0;
        if(val) val.textContent = f2(parseFloat(el.value));
        el.dataset.midiKey = '*:__post__sat';
        el.addEventListener('input', ()=>{
          const d = parseFloat(el.value);
          App.post.sat = App.snapPost('sat', d + 1.0);
          if(val) val.textContent = f2(d);
        });
      }
    }
    slid('pxHue',  'hue',  f3);
    { const el = document.getElementById('pxHue');
      if(el) el.addEventListener('input', ()=>{
        if(UI._gradEditor) UI._gradEditor.render();      // グラデバー
        if(UI._refreshGradList) UI._refreshGradList();   // Preset 欄のパレット一覧
      }); }
    slid('pxHueRot','hueRotSpeed', f2);
    slid('pxBri',  'bri',  f2);
    // Contrast: GUI は -1〜+1(中央0=中立)。実 con は乗数 0〜2(con = slider + 1)。MIDI(postRange [0,2])と同じ実値域。
    { const el = $('#pxCon'), val = $('#pxConVal');
      if(el){
        el.value = (App.post.con != null ? App.post.con : 1.0) - 1.0;
        if(val) val.textContent = f2(parseFloat(el.value));
        el.dataset.midiKey = '*:__post__con';   // 右クリック MIDI Learn 対象
        el.addEventListener('input', ()=>{ App.post.con = App.snapPost('con', parseFloat(el.value) + 1.0); if(val) val.textContent = f2(parseFloat(el.value)); });
      } }
    slid('pxVig',  'vig',  f2);
    slid('pxChr',  'chr',  f3);
    slid('pxPix',  'pix',  fi);
    slid('pxScn',  'scn',  f2);
    slid('pxGrn',  'grn',  f2);
    slid('pxTexN', 'texNoise', f2);
    // Unsharp: UI/MIDIとも -1..+1 (0=無効、負=ぼかし、正=シャープ)。
    { const el = $('#pxUnsharp'), val = $('#pxUnsharpVal');
      if(el){
        const u = Math.max(-1, Math.min(1, Number(App.post.unsharp) || 0));
        App.post.unsharp = u;
        el.value = u;
        el.dataset.midiKey = '*:__post__unsharp';
        const showU = ()=>{ if(val) val.textContent = f2(App.post.unsharp); };
        showU();
        el.addEventListener('input', ()=>{
          App.post.unsharp = Math.max(-1, Math.min(1, App.snapPost('unsharp', parseFloat(el.value))));
          App.post.unsharpRadius = App.unsharpRadiusFromValue(App.post.unsharp);
          showU();
        });
      } }
    slid('pxGradMix','gradMix', f2);
    slid('pxPaletteAmt','paletteAmt', f2);
    { const pa = $('#pxPaletteAmt'); if(pa) pa.addEventListener('input', ()=>{ if(Math.abs(App.post.paletteAmt||0) > 0.001 && App.post.palette !== 8){ App.post.palette = 8; } }); }
    const hexToRGB = (h)=>{ h=h.replace('#',''); return [parseInt(h.slice(0,2),16)/255, parseInt(h.slice(2,4),16)/255, parseInt(h.slice(4,6),16)/255]; };
    const rgbToHex = (a)=>'#'+a.map(v=>{const x=Math.max(0,Math.min(255,Math.round(v*255))).toString(16);return x.length<2?'0'+x:x;}).join('');
    // ── グラデーションマップ エディタ (多色ストップ: バークリックで追加 / つまみドラッグで移動 / クリックで色変更 / ダブルクリックで削除) ──
    const GradEditor = {
      bar: $('#pxGradBar'), handles: $('#pxGradHandles'), sel: 0,
      get(){
        let s = App._gradPreview || App.post.gradStops;   // Param Fade 中は差し替え後のグラデを即時プレビュー
        if(!Array.isArray(s) || s.length < 2){
          s = [{t:0, rgb:(App.post.gradA||[0.8,0.8,0.8])},
               {t:1, rgb:(App.post.gradB||[0.247,0,1])}];
        }
        return s.map(o=>({t:o.t, rgb:o.rgb.slice()}));
      },
      set(stops, sel){                                    // sel: index数値 / または stop参照(sort後に追従)
        stops.sort((a,b)=>a.t-b.t);
        App.post.gradStops = stops;
        App.post.gradA = stops[0].rgb.slice();
        App.post.gradB = stops[stops.length-1].rgb.slice();
        if(!App.post.gradMix){                            // 編集を始めたら Grad Map を有効化
          App.post.gradMix = 1;
          const gme = $('#pxGradMix'), gmv = $('#pxGradMixVal');
          if(gme) gme.value = 1; if(gmv) gmv.textContent = '1.00';
        }
        if(sel != null){
          const idx = (typeof sel === 'number') ? sel : stops.indexOf(sel);
          this.sel = Math.max(0, Math.min(stops.length-1, idx));
        }
        this.render();
      },
      colorAt(stops, t){                                  // bar 上の位置 t の補間色
        if(t <= stops[0].t) return stops[0].rgb.slice();
        const last = stops[stops.length-1];
        if(t >= last.t) return last.rgb.slice();
        for(let i=0;i<stops.length-1;i++){
          const a=stops[i], b=stops[i+1];
          if(t>=a.t && t<=b.t){
            const f=(t-a.t)/Math.max(b.t-a.t,1e-4);
            return [a.rgb[0]+(b.rgb[0]-a.rgb[0])*f, a.rgb[1]+(b.rgb[1]-a.rgb[1])*f, a.rgb[2]+(b.rgb[2]-a.rgb[2])*f];
          }
        }
        return last.rgb.slice();
      },
      // Post の Hue Shift (YIQ 回転。シェーダ hueShift と同一の行列) を表示色に反映する。
      // 実際の出力は Grad Map → Hue Shift の順なので、バーも同じ見え方になる。
      _hueShifted(rgb){
        // 最終段のアップロードと同一式: dz(hue*0.5 + hueAuto)
        const P = (typeof App !== 'undefined') ? App.post : null;
        const h = (P && App.deadParam) ? App.deadParam((P.hue || 0) * 0.5 + (P.hueAuto || 0)) : 0;
        if(Math.abs(h) < 0.001) return rgb;
        const [r,g,b] = rgb;
        const y = 0.299*r + 0.587*g + 0.114*b;
        let ii = 0.596*r - 0.274*g - 0.322*b;
        let q  = 0.211*r - 0.523*g + 0.312*b;
        const a = h * 6.2831853, ca = Math.cos(a), sa = Math.sin(a);
        const i2 = ca*ii - sa*q, q2 = sa*ii + ca*q;
        const cl = v=>Math.max(0, Math.min(1, v));
        return [cl(y + 0.956*i2 + 0.621*q2), cl(y - 0.272*i2 - 0.647*q2), cl(y - 1.106*i2 + 1.703*q2)];
      },
      render(){
        if(!this.bar) return;
        const stops = this.get();
        this.bar.style.background = 'linear-gradient(90deg, ' +
          stops.map(s=>rgbToHex(s.rgb)+' '+(s.t*100).toFixed(1)+'%').join(', ') + ')';
        this.handles.innerHTML = '';
        stops.forEach((s, i)=>{
          const h = document.createElement('div');
          h.className = 'grad-handle' + (i===this.sel ? ' sel' : '');
          h.style.left = (s.t*100) + '%';
          h.style.background = rgbToHex(s.rgb);
          h.dataset.i = i;
          this.handles.appendChild(h);
        });
      },
      addStopAt(clientX){
        const r = this.bar.getBoundingClientRect();
        const t = Math.max(0, Math.min(1, (clientX - r.left)/r.width));
        const stops = this.get();
        const nb = {t, rgb: this.colorAt(stops, t)};
        stops.push(nb);
        this.set(stops, nb);
      },
      _startDrag(i){
        const stops = this.get();
        const dragObj = stops[i];
        const r = this.bar.getBoundingClientRect();
        const self = this; let moved = false, outside = false;
        return {
          move(cx, cy){
            moved = true;
            outside = (cy > r.bottom + 20 || cy < r.top - 20);    // バー外(上下)へ外すと削除予告
            dragObj.t = Math.max(0, Math.min(1, (cx - r.left)/r.width));
            self.set(stops, dragObj);
            const h = self.handles.children[self.sel];
            if(h) h.style.opacity = outside ? '0.25' : '';
          },
          end(){
            if(moved && outside){                                 // バー外で離した → 削除 (最低2つは残す)
              if(stops.length > 2){
                const idx = stops.indexOf(dragObj);
                stops.splice(idx, 1);
                self.set(stops, Math.max(0, idx-1));
              } else {
                self.set(stops, dragObj);
                toast('ストップは最低2つ必要です');
              }
              return;
            }
            if(moved){ self.set(stops, dragObj); return; }        // 通常移動の確定 (opacity をクリア)
            const ht = self.handles.children[self.sel] || self.bar;   // 動かさず離した → カラーホイール
            ColorWheelPopup.open(ht, rgbToHex(dragObj.rgb), (hex)=>{
              dragObj.rgb = hexToRGB(hex);
              self.set(stops, dragObj);
            });
          }
        };
      },
      init(){
        if(!this.bar) return;
        const self = this;
        const xOf = e => (e.touches ? e.touches[0].clientX : e.clientX);
        const yOf = e => (e.touches ? e.touches[0].clientY : e.clientY);
        const barAdd = (e)=>{
          if(e.button != null && e.button !== 0) return;   // 左クリック/タップのみ追加
          self.addStopAt(xOf(e)); if(e.cancelable) e.preventDefault();
        };
        this.bar.addEventListener('mousedown', barAdd);
        this.bar.addEventListener('touchstart', barAdd, {passive:false});
        const handleDown = (e)=>{
          const ht = e.target.closest('.grad-handle'); if(!ht) return;
          if(e.button != null && e.button !== 0) return;   // 右クリックは削除に回す
          e.stopPropagation(); if(e.cancelable) e.preventDefault();
          const isTouch = !!e.touches, i = +ht.dataset.i;
          self.sel = i; self.render();
          const d = self._startDrag(i);
          const move = (ev)=>{ d.move(xOf(ev), yOf(ev)); if(ev.cancelable) ev.preventDefault(); };
          const up = ()=>{
            window.removeEventListener(isTouch?'touchmove':'mousemove', move);
            window.removeEventListener(isTouch?'touchend':'mouseup', up);
            d.end();
          };
          window.addEventListener(isTouch?'touchmove':'mousemove', move, {passive:false});
          window.addEventListener(isTouch?'touchend':'mouseup', up);
        };
        this.handles.addEventListener('mousedown', handleDown);
        this.handles.addEventListener('touchstart', handleDown, {passive:false});
        this.bar.parentElement.addEventListener('contextmenu', e=>e.preventDefault());   // エディタ内のメニュー抑制
        this.render();
      }
    };
    GradEditor.init();
    UI._gradEditor = GradEditor;
    // グラデの向きを反転 (ストップを t→1-t で左右入れ替え。バーが目に見えて反転する)
    const gradRevBtn = $('#pxGradReverse');
    if(gradRevBtn) gradRevBtn.addEventListener('click', ()=>{
      const cur = GradEditor.get();
      const rev = cur.map(s=>({t: 1 - s.t, rgb: s.rgb.slice()}));
      GradEditor.set(rev, (cur.length - 1) - GradEditor.sel);
      toast('グラデの向きを反転');
    });
    // 組み込みグラデ (1〜9,0 キー / リスト番号に対応)
    const BUILTIN_GRADS = [
      { name:'cosine',      hex:'#04001a,#3300d1,#5588aa,#29a9b0,#aab8b0,#b3ee26,#ff8c7a,#f0eeea' },
      { name:'aratanagara', hex:'#0a0038,#3f00ff,#8088c0,#aeb9cb,#dfe4ec' },
      { name:'aratanagara web', stops:[{t:0,rgb:[0.247,0,1]},{t:0.38,rgb:[0.34,0.2,0.86]},{t:0.6,rgb:[0.42,0.47,0.58]},{t:1,rgb:[0.69,0.733,0.8]}] },   // aratanagara.com ホバー時の背景画像グラデマップ(青→シルバー)
      { name:'blood',       hex:'#ece9e4,#cdcbc6,#a3a19c,#86847e,#c23a14,#ee2008,#8e0a00' },
      { name:'モンドリアン', hex:'#f0eeea,#ffd400,#d2241b,#143a8c,#111111' },
      { name:'Vaporwave',   hex:'#1a0633,#5e2a8c,#c81e73,#ff6ad5,#26c6da' },
      { name:'Chrome',      hex:'#0a0a12,#3a4a5a,#8a9aa8,#e8ecf0' },
      { name:'Ember',       hex:'#0a0400,#5a1500,#c83200,#ff7a00,#ffd24a' },
      { name:'B&W',         hex:'#000000,#ffffff' },
      // 0-7 の作風(中間輝度で鮮やかな色相ジャンプ / 補色・トライアド / グレー stop)
      { name:'Jungle Pop',   hex:'#0a1000,#a8e01f,#7a1fd0,#ff8a1f,#eef0e0' },
      { name:'Citrus Punch', hex:'#ff6a1f,#3f5aa8,#b8c0b8,#1fd0c8,#ffe040' },   // 補色 橙⇔青
      { name:'Bubblegum',    hex:'#ff3f9a,#1fc0c0,#c0d0c8,#8ae82f,#6a3fd0' },
      { name:'Miami',        hex:'#1fc0e0,#e83fb0,#5a5ac8,#ffd84a,#e8eef2' },
      { name:'Primary Pop',  hex:'#1f3fd0,#e02a2a,#ffd41f,#2a2a2a,#f0eeea' },   // 原色(モンドリアン系)
      { name:'Sonic',        hex:'#2f3fd0,#1fd0e0,#c8c0b0,#ff8a2a,#e04a2a' },   // 補色 青⇔橙
      { name:'Poison',       hex:'#a8e82f,#e01fb0,#2a9a86,#ffe84a,#4a2fb0' },
      { name:'Coral Reef',   hex:'#ff6a6a,#2fc0c0,#aeb6ae,#b3ee26,#3a5ad0' },
      { name:'Grape Punch',  hex:'#7a2fe0,#ff4a9a,#c8c0c8,#a8e02f,#ffd84a' },
      { name:'Signal',       hex:'#e82a3a,#1fc8d0,#b0b8b8,#ffd41f,#2a3aa8' },   // 補色 赤⇔シアン
      { name:'Cyber',        hex:'#e01fc8,#1fd0e0,#a8e82f,#c0c0c8,#4a2fb0' },   // トライアド CMY寄り
      { name:'Fiesta',       hex:'#ff7a2a,#e83f9a,#2fc0b0,#ffe040,#4a3fc8' },
      { name:'Iceberg',      hex:'#1f3fd0,#2fb0e0,#8ad0e8,#cadcea,#f0f5fa' },
      { name:'Sunburst',     hex:'#ffe01f,#ff9a1f,#ff3f3a,#e01f8a,#f0e0d0' },
      { name:'Retro Sun',    hex:'#ff3f7a,#ff8a2a,#ffd41f,#b8a89a,#3a6ad0' },
      { name:'Electric Lime',hex:'#2f3fd0,#a8e82f,#e01fb0,#c0c8c0,#ffe84a' },   // トライアド 青緑/紫
      // 低彩度(同じ作風で彩度を落とした版)
      { name:'Dust Blue',    hex:'#5a6aa0,#c88a7a,#b0b0a8,#7a9a90,#e8e4dc' },
      { name:'Clay',         hex:'#a86a4a,#8a9a6a,#c0b8a0,#6a7a8a,#e8e0d4' },
      { name:'Overcast',     hex:'#4a5a6a,#8a7a8a,#aaa2aa,#c8bcb0,#e6e2e0' },
      { name:'Fade Rose',    hex:'#a86a70,#6a9a92,#b0a8a0,#c8b8a8,#e8e0d8' },
    ];
    UI._builtinGrads = BUILTIN_GRADS;
    // 保存グラデのサーバーストア (presets/store.php?name=grads)
    const GradStore = {
      list: [],
      url(){ return App._storeBase() + '?name=grads'; },
      async load(){ let fetchedOk=false; try{ const res = await fetch(this.url(), {cache:'no-store'}); if(res.ok){ const a = await res.json(); fetchedOk=true; if(Array.isArray(a) && a.length) this.list = a; } }catch(e){}
        // store.php 不通時は同梱スナップショット (presets/grads.json) を読み取り専用で使う (fetchedOk=false のままなので save() はしない)
        if(!fetchedOk && !this.list.length){ try{ const res = await fetch('presets/grads.json', {cache:'no-store'}); if(res.ok){ const a = await res.json(); if(Array.isArray(a) && a.length) this.list = a; } }catch(e){} }
        // builtins 種まきは fetch が「確実に成功して空」のときだけ save() する。fetch 失敗/不通時はメモリ表示のみで
        // サーバーを上書きしない(失敗のたびに保存済みグラデが builtins で潰れる事故を防ぐ)。
        if(!this.list.length){ this.list = BUILTIN_GRADS.map(g=>{ if(g.stops) return {name:g.name, stops:g.stops.map(s=>({t:s.t, rgb:s.rgb.slice()}))}; const a=g.hex.split(',').map(s=>s.trim()).filter(Boolean); return {name:g.name, stops:a.map((h,i)=>({t:i/Math.max(a.length-1,1), rgb:hexToRGB(h)}))}; }); if(fetchedOk) this.save(); }
        UI._refreshGradList && UI._refreshGradList(); },
      save(){ try{ if(App._storeWritable && !App._storeWritable()) return; fetch(this.url(), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(this.list)}).catch(()=>{}); }catch(e){} },
      add(name, stops){ this.list.push({name, stops}); this.save(); UI._refreshGradList && UI._refreshGradList(); },
      remove(i){ this.list.splice(i,1); this.save(); UI._refreshGradList && UI._refreshGradList(); },
      update(i, stops){ if(this.list[i]){ this.list[i].stops = stops; this.save(); UI._refreshGradList && UI._refreshGradList(); } },
      rename(i, name){ if(this.list[i]){ this.list[i].name = name; this.save(); UI._refreshGradList && UI._refreshGradList(); } },
      move(from, to){ const a=this.list; if(from===to||from<0||from>=a.length||to<0||to>=a.length) return; const [x]=a.splice(from,1); a.splice(to,0,x); this.save(); UI._refreshGradList && UI._refreshGradList(); }
    };
    UI._gradStore = GradStore;
    UI._gradEditor = GradEditor;
    // Post の Hue Shift をパレット表示にも反映する (GradEditor._hueShifted と同じ YIQ 回転)
    const _hs = (rgb01)=> (UI._gradEditor && UI._gradEditor._hueShifted) ? UI._gradEditor._hueShifted(rgb01) : rgb01;
    const _hsCssColor = (str)=>{
      // 'rgb(r,g,b)' / '#rrggbb' / '#rgb' を hue shift して 'rgb(...)' で返す
      let r, g, b;
      let m = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(str);
      if(m){ r=+m[1]; g=+m[2]; b=+m[3]; }
      else {
        m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(str.trim());
        if(!m) return str;                      // 解釈できない指定はそのまま
        const h = m[1].length === 3 ? m[1].split('').map(c=>c+c).join('') : m[1];
        r = parseInt(h.slice(0,2),16); g = parseInt(h.slice(2,4),16); b = parseInt(h.slice(4,6),16);
      }
      const o = _hs([r/255, g/255, b/255]);
      return `rgb(${Math.round(o[0]*255)},${Math.round(o[1]*255)},${Math.round(o[2]*255)})`;
    };
    const _gradCss = (sh)=>{
      let c;
      if(typeof sh==='string'){ c = sh.split(',').map(s=>s.trim()).filter(Boolean).map(_hsCssColor); }
      else { c = (sh||[]).map(s=>{ const o=_hs(s.rgb); return `rgb(${Math.round(o[0]*255)},${Math.round(o[1]*255)},${Math.round(o[2]*255)})`; }); }
      return c.length?('linear-gradient(90deg,'+c.join(',')+')'):'#222';
    };
    // 現在のグラデを名前付きでサーバー保存(追加)
    const addCurrentGrad = ()=>{ const stops = GradEditor.get(); App._prompt('保存するグラデの名前:', 'grad '+(GradStore.list.length+1), (name)=>{ if(!name || !name.trim()) return; GradStore.add(name.trim(), stops); toast('グラデを保存: '+name.trim()); }); };
    // グラデリスト UI (色見本 + 番号 + 名前。番号 1〜9,0 がキーに対応。最上部=現在編集中で sticky)
    UI._refreshGradList = ()=>{
      const box = $('#pxGradList'); if(!box) return;
      const prevScroll = (document.getElementById('pxGradScroll') || {}).scrollTop || 0;   // 再構築でスクロール位置が飛ぶのを防ぐ
      const items = GradStore.list.map((g,i)=>({name:g.name, css:_gradCss(g.stops), saved:i}));
      const mkRow = (no, css, name)=>{
        const r = document.createElement('div');
        r.style.cssText = 'position:relative;flex:0 0 20px;cursor:pointer;border-radius:3px;border:1px solid var(--line);overflow:hidden;background:'+css;
        r.innerHTML = `<span style="position:absolute;left:5px;top:0;line-height:20px;font-weight:bold;color:#fff;text-shadow:0 0 2px #000,0 0 4px #000">${no}</span>`
          + `<span style="position:absolute;left:21px;right:4px;top:0;line-height:20px;font-size:11px;color:#fff;text-shadow:0 0 2px #000,0 0 4px #000,0 1px 1px #000;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</span>`;
        return r;
      };
      box.innerHTML = '';
      box.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:2px';
      // 現在行(固定ヘッダー)= 現在のグラデを表示 + 右端に「+」追加ボタン
      const cur = mkRow('●', _gradCss(GradEditor.get()), '現在');
      cur.dataset.cur = '1'; cur.style.outline='1px solid #9be';
      const addBtn = document.createElement('span');
      addBtn.textContent = '+'; addBtn.title = '現在のグラデを名前付きで保存';
      addBtn.style.cssText = 'position:absolute;top:0;right:0;width:20px;line-height:20px;text-align:center;font-weight:bold;font-size:15px;color:#9be;cursor:pointer;background:rgba(0,0,0,0.4);text-shadow:0 0 2px #000,0 0 3px #000';
      addBtn.addEventListener('click', e=>{ e.stopPropagation(); addCurrentGrad(); });
      cur.appendChild(addBtn);
      box.appendChild(cur);
      // プリセット一覧は「+」の下のスクロール領域に置く(ここにスクロールバーが出る)
      const scroll = document.createElement('div');
      scroll.id = 'pxGradScroll';
      scroll.style.cssText = 'display:flex;flex-direction:column;gap:2px;max-height:160px;overflow-y:auto';
      box.appendChild(scroll);
      items.forEach((it, n)=>{
        const key = (n===9)?'0':(n<9?String(n+1):'·');
        const row = mkRow(key, it.css, it.name);
        row.draggable = true;
        row.addEventListener('dragstart', e=>{ e.dataTransfer.setData('text/plain', String(n)); e.dataTransfer.effectAllowed='move'; row.style.opacity='0.4'; });
        row.addEventListener('dragend', ()=>{ row.style.opacity=''; });
        row.addEventListener('dragover', e=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; });
        row.addEventListener('drop', e=>{ e.preventDefault(); const from=parseInt(e.dataTransfer.getData('text/plain'),10); if(!isNaN(from)) GradStore.move(from, n); });
        row.addEventListener('click', ()=> App.applyGradPreset(n));
        if(it.saved != null){
          const si = it.saved, nm = it.name;
          const mkBtn = (txt, title, right, col, fn)=>{ const b=document.createElement('span'); b.textContent=txt; b.title=title;
            b.style.cssText='position:absolute;top:0;line-height:20px;width:16px;text-align:center;text-shadow:0 0 2px #000,0 0 3px #000;cursor:pointer;font-size:11px;right:'+right+'px;color:'+col;
            b.addEventListener('click', e=>{ e.stopPropagation(); fn(); }); row.appendChild(b); };
          mkBtn('✎', '名前を変更', 36, '#cde', ()=>{ App._prompt('グラデ名を変更:', nm, (nn)=>{ if(nn && nn.trim()){ GradStore.rename(si, nn.trim()); toast('名前変更: '+nn.trim()); } }); });
          mkBtn('⟳', '現在のグラデで上書き更新', 19, '#9be', ()=>{ App._confirm('「'+nm+'」を現在のグラデで上書きしますか？', ()=>{ GradStore.update(si, GradEditor.get()); toast('更新: '+nm); }); });
          mkBtn('×', '削除', 2, '#fdd', ()=>{ App._confirm('「'+nm+'」を削除しますか？', ()=>{ GradStore.remove(si); toast('削除: '+nm); }); });
        }
        scroll.appendChild(row);
      });
      scroll.scrollTop = prevScroll;   // スクロール位置を復元

      // プレビュー欄の上のクイックバー: 1〜9/0 の順 (applyGradPreset と同じ index) で並べる。
      // 中身は「そのグラデを適用した映像」のサムネ (GL.drawMixPreviews が 2 秒ごとに描く)。
      // サムネが来るまでは Hue Shift 反映済みのグラデーション CSS を下地に見せる。
      const qb = document.getElementById('gradQuickBar');
      if(qb){
        // 1〜9 = 保存パレット / 0 = デフォルト (Hue Shift をかけた既定色)
        const qItems = items.slice(0, 9);
        while(qItems.length < 9) qItems.push({name:'(空)', css:'#222'});
        qItems.push({name:'通常色 (Grad Map OFF / Hue Shift は映像へ)', css:'#333'});
        const cnt = qItems.length;
        // 下段 = 同じ 1〜0 を Invert ON で見たプレビュー (クリック = パレット適用 + Invert ON)
        const qbi = document.getElementById('gradQuickBarInv');
        const bars = qbi ? [qb, qbi] : [qb];
        let rebuilt = false;
        for(const bar of bars){
          const isInv = (bar === qbi);
          // 枚数が変わらない間はタイルを作り直さない (canvas を消さない = サムネを保持)
          const reuse = (bar.children.length === cnt) && [...bar.children].every(c=>c.__cvs);
          if(!reuse){ bar.innerHTML = ''; rebuilt = true; }
          for(let n = 0; n < cnt; n++){
            const it = qItems[n];
            const label = (n === 9 ? '0' : String(n + 1));
            let d;
            if(reuse){
              d = bar.children[n];
            } else {
              d = document.createElement('div');
              d.className = 'gq';
              const cvs = document.createElement('canvas');
              cvs.width = 96; cvs.height = 40;            // 実サイズと同じ比率 (描画時に再設定される)
              const lb = document.createElement('span');
              lb.textContent = label;
              d.appendChild(cvs); d.appendChild(lb);
              d.__cvs = cvs; d.__ctx = cvs.getContext('2d');
              if(isInv){
                d.addEventListener('click', ()=>{
                  App.applyGradPreset(n);
                  App.fadePostNum('inv', 1);
                  const cb = document.getElementById('pxInv'); if(cb) cb.checked = true;
                  if(UI.refreshPost) UI.refreshPost();
                });
              } else {
                d.addEventListener('click', ()=>{
                  App.applyGradPreset(n);
                  // 上段クリック = Invert OFF へ戻す (下段との対で状態が分かるように)
                  if((App.post.inv || 0) > 0.5){
                    App.fadePostNum('inv', 0);
                    const cb = document.getElementById('pxInv'); if(cb) cb.checked = false;
                    if(UI.refreshPost) UI.refreshPost();
                  }
                });
              }
              bar.appendChild(d);
            }
            const invOn = (App.post && (App.post.inv || 0) > 0.5);
            d.classList.toggle('on', App._activeGradPreset === n && (isInv ? invOn : !invOn));
            d.style.background = it.css;                  // サムネ未描画時の下地 (Hue 反映済み)
            d.title = label + ': ' + it.name + (isInv ? ' + Invert' : '');
          }
        }
        if(rebuilt) GL.requestMixPreview('all');        // 作り直した直後は 2 秒を待たずに描く
      }
    };
    GradStore.load();
    UI._refreshGradList();
    // Grad / Blend プレビューの表示状態を復元 (P キーのトグル)
    try{ App.mixPrevVisible = localStorage.getItem('vj.mixPrev') !== '0'; }catch(e){}
    App.applyMixPrevVisible();
    slid('pxPos',  'pos',  fi);
    slid('pxBlm',  'blm',  f2);
    slid('pxTwist','twist',f2);
    slid('pxSlice','slice',f2);
    slid('pxSplit','split',f2);
    slid('pxMos',  'mosaic',f2);
    slid('pxSlit2','slit2', f2);
    slid('pxGlass','glass', f2);
    slid('pxOutline','outline', f2);
    slid('pxDither','dither', f2);
    slid('pxCandy','candy', f2);
    slid('pxOrigami','origami', f2);
    slid('pxKaiser','kaiser', f2);
    slid('pxKaiserOld','kaiserOld', f2);
    slid('pxShake','shake',f2);
    slid('pxMblur','mblur',f2);
    slid('pxGain', 'gain', f2);
    slid('pxVoxel', 'voxel', f2);
    slid('pxRain', 'rain', f2);
    slid('pxSketch', 'sketch', f2);
    slid('pxPixsort', 'pixsort', f2);
    slid('pxRings', 'rings', f2);
    slid('pxFbAdd', 'fbAdd', f2);
    slid('pxFbMultiply', 'fbMultiply', f2);
    slid('pxFbZoom', 'fbZoom', f2);
    slid('pxFbRot', 'fbRot', f2);
    slid('pxGlitchTrail', 'glitchTrail', f2);
    slid('pxSdfChrome', 'sdfChrome', f2);
    slid('pxRiver',     'river',     f2);
    slid('pxBleed',   'bleed',   f2);
    slid('pxImpasto', 'impasto', f2);
    slid('pxChrome',  'chrome',  f2);
    slid('pxBarcode', 'barcode', f2);
    slid('pxAudioFx',    'audioFx',       f2);
    slid('pxAudioFxAtk', 'audioFxAttack', f2);
    slid('pxAudioFxRel', 'audioFxRelease', f2);
    // Atk / Rel は本体 (Audio → FX) が 0 だと効かない。
    //   Atk の既定が 0.6 なので「ON に見えるのに反応しない」と誤解されるため、
    //   本体 0 のときは行を淡色+disabled にし、触ったら気づけるようトーストを出す。
    {
      const fx = $('#pxAudioFx'), atk = $('#pxAudioFxAtk'), rel = $('#pxAudioFxRel');
      const sync = ()=>{
        const on = (App.post.audioFx || 0) > 0.001;
        [atk, rel].forEach(el=>{
          if(!el) return;
          el.disabled = !on;
          const row = el.closest('.row');
          if(row) row.style.opacity = on ? '' : '0.42';
        });
      };
      UI._syncAudioFxRows = sync;
      if(fx) fx.addEventListener('input', sync);
      [atk, rel].forEach(el=>{
        if(!el) return;
        el.addEventListener('pointerdown', ()=>{
          if((App.post.audioFx || 0) <= 0.001) toast('Audio → FX を上げると有効になります (現在 0 = 無効)', 2600);
        });
      });
      sync();
    }
    slid('pxClarity', 'clarity', f2);
    slid('pxDenoise', 'denoise', f2);
    slid('pxDeband', 'deband', f2);
    slid('pxVibrance', 'vibrance', f2);
    slid('pxPollockGloss', 'pollockGloss', f2);
    slid('pxPollockMatt',  'pollockMatt',  f2);
    slid('pxPollockFlat',  'pollockFlat',  f2);
    App.post.boltz = +App.post.boltz || 0;   // 旧チェックボックス時代の boolean 保存値を数値へ
    slid('pxBoltz',  'boltz',  f2);
    { const el = $('#pxATarget');
      if(el){
        el.value = App.post.audioTarget || 'manual';
        el.addEventListener('change', ()=>{
          App.applyAudioDetectPreset(el.value || 'manual');
        });
      } }
    // Sensitivity: 位置(0..1)→ゲインは指数マップ。中央0.5=ゲイン0.5。表示は実ゲイン。
    { const el = $('#pxAGain'), val = $('#pxAGainVal');
      if(el){
        el.value = App.againToSlider(App.post.audioGain != null ? App.post.audioGain : 0.5);
        const showG = ()=>{ if(val) val.textContent = App.againFromSlider(parseFloat(el.value)).toFixed(2); };
        showG();
        el.addEventListener('input', ()=>{ App.post.audioGain = App.againFromSlider(parseFloat(el.value)); showG(); });
      } }
    slid('pxABand',  'audioBand', f2);
    slid('pxAAttack','audioAttack', f2);
    slid('pxAScan',  'aScan',  f2);
    slid('pxARgb',   'aRgb',   f2);
    slid('pxAStrobe',  'aStrobe',  f2);
    slid('pxAShock',   'aShock',   f2);
    slid('pxAExplode', 'aExplode', f2);
    slid('pxSlitScan', 'slitScan', f2);
    const cpal = $('#pxCosPalette');
    if(cpal){
      cpal.value = String(App.post.cosPalette || 0);
      cpal.addEventListener('change', ()=>{ App.post.cosPalette = parseInt(cpal.value)||0; });
    }
    App.post.palette = 8;  // Auto Palette は常時 ON (Slot A 抽出 → Slot B)
    const mir = $('#pxMir');
    if(mir){
      mir.value = String(App.post.mir|0);
      mir.addEventListener('change', ()=>{ App.post.mir = parseInt(mir.value)|0; });
    }
    const inv = $('#pxInv');
    if(inv){
      inv.checked = (App.post.inv || 0) > 0.5;
      inv.addEventListener('change', ()=>{ App.fadePostNum('inv', inv.checked ? 1 : 0); });
    }
    const fxa = $('#pxFxaa');
    if(fxa){
      fxa.checked = !!App.post.fxaa;
      fxa.addEventListener('change', ()=>{ App.post.fxaa = fxa.checked; });
    }
    const reset = $('#btnPostReset');
    if(reset) reset.addEventListener('click', ()=>{
      App.post = App.postDefaults();
      this.refreshPost();
      toast('Post FX reset');
    });
  },

  refreshPost(){
    const set = (id, val, fmt, plain)=>{
      const el = $('#'+id); const out = $('#'+id+'Val');
      if(el) el.value = val;
      if(out && fmt) out.textContent = plain ? fmt(val) : App.effDisplay(val, fmt);   // |値|<0.1 は "0.0"
    };
    const f2 = v=>v.toFixed(2), f3 = v=>v.toFixed(3), fi = v=>String(v|0);
    const p = App.post;
    for(const k in p){
      if(typeof p[k] === 'number') p[k] = App.snapPost(k, p[k]);
    }
    // slid() 登録分をまとめて同期 (明示 set() の追記漏れを防ぐ)。
    //   con / sat のようなオフセット表示のものは下の明示 set() が後から上書きする。
    for(const r of (UI._postSlid || [])){
      const el = $('#'+r.id), out = $('#'+r.id+'Val');
      if(!el) continue;
      const v = p[r.key];
      if(typeof v !== 'number') continue;
      el.value = v;
      if(out && r.disp) out.textContent = r.disp(v);
    }
    if(UI._syncAudioFxRows) UI._syncAudioFxRows();
    set('pxGamma', p.gamma, f2);
    set('pxSat',   (p.sat != null ? p.sat : 1.0) - 1.0, f2, true);
    set('pxHue',   p.hue,   f3);
    set('pxHueRot',p.hueRotSpeed || 0, f2);
    set('pxBri',   p.bri,   f2);
    set('pxCon',   (p.con != null ? p.con : 1.0) - 1.0,   f2, true);   // con はオフセット表示なので生値表記しない
    set('pxVig',   p.vig,   f2);
    set('pxChr',   p.chr,   f3);
    set('pxPix',   p.pix,   fi);
    set('pxScn',   p.scn,   f2);
    set('pxGrn',   p.grn,   f2);
    set('pxTexN',  p.texNoise || 0, f2);
    { const el=$('#pxUnsharp'), out=$('#pxUnsharpVal');
      const u = Math.max(-1, Math.min(1, Number(p.unsharp) || 0));
      p.unsharp = u;
      p.unsharpRadius = App.unsharpRadiusFromValue(u);
      if(el) el.value = u;
      if(out) out.textContent = f2(u);
    }
    set('pxGradMix',  p.gradMix || 0, f2);
    if(UI._gradEditor) UI._gradEditor.render();   // Grad Map エディタを現状の stops で再描画
    set('pxPos',   p.pos,   fi);
    set('pxBlm',   p.blm,   f2);
    set('pxTwist', p.twist, f2);
    set('pxSlice', p.slice, f2);
    set('pxSplit', p.split || 0, f2);
    set('pxMos',   p.mosaic,f2);
    set('pxSlit2', p.slit2 || 0, f2);
    set('pxGlass', p.glass || 0, f2);
    set('pxOutline', p.outline || 0, f2);
    set('pxDither', p.dither || 0, f2);
    set('pxCandy', p.candy || 0, f2);
    set('pxOrigami', p.origami || 0, f2);
    set('pxKaiser', p.kaiser || 0, f2);
    set('pxKaiserOld', p.kaiserOld || 0, f2);
    set('pxShake', p.shake, f2);
    set('pxMblur', p.mblur, f2);
    set('pxGain',  p.gain,  f2);
    set('pxVoxel', p.voxel, f2);
    set('pxRain', p.rain, f2);
    set('pxSketch', p.sketch, f2);
    set('pxPixsort', p.pixsort, f2);
    set('pxRings', p.rings || 0, f2);
    set('pxFbAdd', p.fbAdd || 0, f2);
    set('pxFbMultiply', p.fbMultiply || 0, f2);
    set('pxFbZoom', p.fbZoom || 0, f2);
    set('pxFbRot', p.fbRot || 0, f2);
    set('pxGlitchTrail', p.glitchTrail || 0, f2);
    set('pxClarity', p.clarity || 0, f2);
    set('pxDenoise', p.denoise || 0, f2);
    set('pxDeband', p.deband || 0, f2);
    set('pxVibrance', p.vibrance || 0, f2);
    set('pxPollockGloss', p.pollockGloss || 0, f2);
    set('pxPollockMatt',  p.pollockMatt  || 0, f2);
    set('pxPollockFlat',  p.pollockFlat  || 0, f2);
    if($('#pxMir')) $('#pxMir').value = String(p.mir|0);
    if($('#pxInv')) $('#pxInv').checked = (p.inv || 0) > 0.5;
    if($('#pxFxaa')) $('#pxFxaa').checked = !!p.fxaa;
    set('pxBoltz', p.boltz||0, f2);
    if($('#pxATarget')) $('#pxATarget').value = p.audioTarget || 'manual';
    { const info = $('#pxATargetInfo'); if(info) info.textContent = App.audioDetectInfo ? App.audioDetectInfo(p.audioTarget || 'manual') : ''; }
    { const el=$('#pxAGain'), out=$('#pxAGainVal'); const g=(p.audioGain==null?0.5:p.audioGain);
      if(el) el.value = App.againToSlider(g);
      if(out) out.textContent = g.toFixed(2); }
    set('pxABand', p.audioBand||0, f2);
    set('pxAAttack', (p.audioAttack==null?0.5:p.audioAttack), f2);
    set('pxAScan', p.aScan||0, f2);
    set('pxARgb', p.aRgb||0, f2);
    set('pxAStrobe', p.aStrobe||0, f2);
    set('pxAShock', p.aShock||0, f2);
    set('pxAExplode', p.aExplode||0, f2);
    set('pxSlitScan', p.slitScan||0, f2);
    set('pxPaletteAmt', p.paletteAmt||0, f2);
    if($('#pxCosPalette')) $('#pxCosPalette').value = String(p.cosPalette||0);
  },

  // GIFサムネを通常は静止(1フレーム目をcanvas)、ホバー時のみアニメ(img)で表示
  _gifStillHover(tile, ph, gifUrl){
    const cv = document.createElement('canvas');
    cv.width = Preview.W; cv.height = Preview.H;
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1';
    tile.appendChild(cv);
    const im = new Image();
    im.onload = ()=>{ try{ cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); }catch(e){} if(ph && ph.parentNode) ph.style.display = 'none'; };
    im.onerror = ()=>{ cv.remove(); };
    im.src = gifUrl;
    let gimg = null;
    tile.addEventListener('mouseenter', ()=>{
      if(!gimg){
        gimg = document.createElement('img');
        gimg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2';
        tile.appendChild(gimg);
      }
      gimg.src = gifUrl;            // 毎回 src 設定でアニメを先頭から再生
      gimg.style.display = 'block';
    });
    tile.addEventListener('mouseleave', ()=>{ if(gimg) gimg.style.display = 'none'; });
  },
  // シェーダ並べ替えのドロップ挿入線をクリア
  _clearShDrop(){ if(this._shDropTile){ this._shDropTile.style.boxShadow = ''; this._shDropTile = null; } },
  // Preset タブのドラッグ挿入線 (Visual タブと同仕様: タイル間にピンクの線)
  _clearPrDrop(){ if(this._prDropTile){ this._prDropTile.style.boxShadow = ''; this._prDropTile = null; } },
  // Visual タイルの表示名オーバーライド (サーバー保存=presets/store.php?name=visualnames + localStorage キャッシュ。key=元名)
  _visualNames(){ try{ return JSON.parse(localStorage.getItem('vj.visualNames')||'{}'); }catch(e){ return {}; } },
  _visualNamesUrl(){ return App._storeBase() + '?name=visualnames'; },
  _saveVisualNamesServer(m){ m = m || this._visualNames();
    try{ fetch(this._visualNamesUrl(), {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(m)}).catch(()=>{}); }catch(e){} },
  _saveVisualName(key, name){ const m=this._visualNames(); const v=(name||'').trim(); if(v) m[key]=v; else delete m[key];
    try{ localStorage.setItem('vj.visualNames', JSON.stringify(m)); }catch(e){}
    this._saveVisualNamesServer(m); },
  // 初回だけサーバーと同期: サーバーに保存があれば採用(ローカルにマージ→再描画) / 空ならローカルを移行アップロード
  async _syncVisualNamesFromServer(){
    if(this._visNamesSynced) return; this._visNamesSynced = true;
    let remote=null;
    try{ const res=await fetch(this._visualNamesUrl(), {cache:'no-store'}); if(res.ok) remote=await res.json(); }
    catch(e){ return; }
    const local=this._visualNames();
    if(remote && typeof remote==='object' && !Array.isArray(remote) && Object.keys(remote).length){
      const merged=Object.assign({}, local, remote);   // サーバー優先
      try{ localStorage.setItem('vj.visualNames', JSON.stringify(merged)); }catch(e){}
      if(Object.keys(local).some(k=>!(k in remote))) this._saveVisualNamesServer(merged);   // ローカルのみの分を移行
      if(this.populatePresets) this.populatePresets();
    } else if(Object.keys(local).length){
      this._saveVisualNamesServer(local);              // サーバー空 & ローカルに既存 → 移行アップロード
    }
  },
  _renameVisualTile(key, sidPrefix, lblEl){
    const cur = this._visualNames()[key] || (lblEl ? lblEl.textContent.replace(sidPrefix,'') : '');
    App._prompt('表示名', cur, (nn)=>{
      const v = nn.trim();
      this._saveVisualName(key, (v && v !== key) ? v : '');
      if(lblEl) lblEl.textContent = sidPrefix + (v || key);
      if(this.applyVisualFilter) this.applyVisualFilter();
    });
  },
  // Visual タブ: Mode > Movie > Shader の順でグリッド表示 (Movie は動画ファイルを統合)
  populatePresets(){
    const grid = $('#thumbGrid');
    if(!grid) return;
    this._syncVisualNamesFromServer();   // 初回のみ Visual 表示名をサーバーと同期(完了後に再描画)
    if(!App._modeGifFetched){ App._modeGifFetched = true; App._loadModeGifs(); }   // 共通GIFを一度だけ取得
    grid.innerHTML = '';
    this.thumbCanvases = new Array(PRESETS.length);

    // 遅延ローディング: サムネ JPG が無いシェーダは、タイルが画面に入って初めて live コンパイルする。
    //   (全プリセットを起動時に一括コンパイルすると、重いレイマーチャで初回ロードが固まるため)
    if(this._thumbObserver){ try{ this._thumbObserver.disconnect(); }catch(_){} }
    if(typeof IntersectionObserver !== 'undefined'){
      this._thumbObserver = new IntersectionObserver((entries)=>{
        for(const e of entries){ if(e.isIntersecting) UI._queueThumb(e.target); }
      }, { root:null, rootMargin:'300px 0px', threshold:0.01 });
    } else {
      this._thumbObserver = null;   // 非対応環境: 従来通り(onerror で即キュー)
    }
      const MODE_KINDS = ['none','layer','manga','video','aratanagara','slicer','cyberui','novel','inkelly','boltzmann','grayscott','pen','caverns','shelf','ribbon','photoplane','image','textdeform','ugomeki','spacetype','shredder'];
      // p5.js/WebGL の多パスシェーダ系エンジンは「Shader」分類に含める(モード扱いしない)
      const SHADER_ENGINES = ['caverns','boltzmann','grayscott','inkelly','ribbon'];
      const isModeKind = (k)=> MODE_KINDS.includes(k) && !SHADER_ENGINES.includes(k);

    App._applyShaderOrder();   // 保存済みのシェーダ並び順を適用(ドラッグ並べ替え)

    // 連番 (sid): 表示順のまま シェーダ=S001〜 / Code(旧mode)=C001〜。「なし」「MOVIE」は無番(Movie タイルは M001〜 で別採番)。
    //   → 並び替え(shaderReorder)すると順番通りに振り直される。表示専用で p.name は変えない(サムネ slug 維持=番号を含めない)。
    {
      let sn = 0, mn = 0;
      for(const p of PRESETS){
        if(p.kind === 'none' || p.kind === 'video'){ p.sid = ''; continue; }
        if(p.kind && isModeKind(p.kind)){ mn++; p.sid = 'C' + String(mn).padStart(3, '0'); continue; }   // Code(旧 mode)= C001〜
        sn++;
        p.sid = 'S' + String(sn).padStart(3, '0');
      }
    }

    const addLabel = (text)=>{
      const h = document.createElement('div');
      h.textContent = text;
      h.className = 'visLabel';
      h.dataset.lbl = text.toLowerCase();
      h.style.cssText = 'grid-column:1/-1;font:600 10px var(--mono);color:var(--dim);letter-spacing:1px;margin:7px 0 1px;border-bottom:1px solid var(--line);padding-bottom:2px';
      grid.appendChild(h);
      return h;
    };

    // 1 プリセット分のタイル (thumbCanvases[i] に canvas を割当)。クリックで現スロットにロード。
    const makeTile = (i, catOverride)=>{
      const p = PRESETS[i];
      if(p.kind === 'video') return;   // VIDEO (Loop Player) は非表示
      const tile = document.createElement('div');
      tile.className = 'thumb-tile';
      tile.dataset.idx = String(i);
      tile.dataset.cat = catOverride || (isModeKind(p.kind) ? 'mode' : 'shader');
      if(p.kind === 'layer') tile.classList.add('layer-tile');
      if(p.kind === 'manga') tile.classList.add('manga-tile');
      const c = document.createElement('canvas');
      c.width = Preview.W; c.height = Preview.H;
      tile.appendChild(c);
      {
        const tf = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const tImg = new Image();
        tImg.onload = ()=>{
          c.__thumbImg = tImg; c.__hasThumb = true;
          try{ c.getContext('2d').drawImage(tImg, 0, 0, c.width, c.height); }catch(e){}
          c.dispatchEvent(new Event('__drawn__'));
        };
        tImg.onerror = ()=>{
          if(!(p.src && (!p.kind || p.kind === 'shader'))) return;
          c.__needsLive = true;   // JPG 無し → live コンパイルが必要
          // observer 非対応、または既に画面内なら即キュー。画面外は observer がスクロール時に拾う。
          if(!UI._thumbObserver){ if(Preview.staticQueue.indexOf(i) < 0) Preview.staticQueue.push(i); return; }
          const r = tile.getBoundingClientRect(), vh = window.innerHeight || 0;
          if(r.top < vh + 300 && r.bottom > -300) UI._queueThumb(tile);
        };
        tImg.src = 'shaders/thumbs/' + tf + '.jpg';
      }
      const ph = document.createElement('div');
      ph.className = 'placeholder';
      ph.textContent = (p.kind === 'none') ? 'なし'
                     : (p.kind === 'layer') ? 'LAYER\n3D'
                     : (p.kind === 'manga') ? 'MANGA\nCOLLAGE'
                     : (p.kind === 'video') ? 'VIDEO\nLOOP'
                     : (p.kind === 'aratanagara') ? 'ARATA\nFRAG'
                     : (p.kind === 'cyberui') ? 'CYBER\nUI'
                     : (p.kind === 'novel') ? 'NOVEL'
                     : (p.kind === 'grayscott') ? 'GRAY\nSCOTT'
                     : (p.kind === 'inkelly') ? 'INKELLY\nINK'
                     : (p.kind === 'pen') ? 'PEN\nINK'
                     : (p.kind === 'boltzmann') ? 'BOLTZMANN\nFLUID'
                     : (p.kind === 'caverns') ? 'SDF\nCAVERNS'
                     : (p.kind === 'shelf') ? 'SHELF\nTOWER'
                     : (p.kind === 'photoplane') ? 'PHOTO\nPLANE'
                     : (p.kind === 'shredder') ? 'POLYGON\nSHREDDER'
                     : (p.kind === 'spacetype') ? 'SPACE\nTYPE'
                     : (p.kind === 'ribbon') ? 'RIBBON\nLINES'
                     : '…';
      ph.style.whiteSpace = 'pre'; ph.style.textAlign = 'center'; ph.style.lineHeight = '1.2';
      if(p.kind === 'none'){
        // 「なし」= 透明。Photoshop 風の市松模様で透過であることを示す
        ph.style.backgroundImage = 'linear-gradient(45deg,#cbcbcb 25%,transparent 25%,transparent 75%,#cbcbcb 75%),'
                                 + 'linear-gradient(45deg,#cbcbcb 25%,transparent 25%,transparent 75%,#cbcbcb 75%)';
        ph.style.backgroundColor = '#ffffff';
        ph.style.backgroundSize = '16px 16px';
        ph.style.backgroundPosition = '0 0, 8px 8px';
        ph.style.color = '#333'; ph.style.fontSize = '12px'; ph.style.fontWeight = '700';
        ph.style.display = 'flex'; ph.style.alignItems = 'center'; ph.style.justifyContent = 'center';
      }
      if(MODE_KINDS.includes(p.kind)){
        ph.style.color = 'var(--acc)'; ph.style.fontSize = '13px'; ph.style.fontWeight = '700'; ph.style.letterSpacing = '2px';
      } else {
        // シェーダ系: サムネが来るまで「読込中」のダミー箱(シマー)を表示
        ph.classList.add('loading');
        ph.textContent = p.sid || '…';
      }
      tile.appendChild(ph);
      // Mode: GIF サムネ (サーバー modegifs = ⟳ で生成・固定) + 生成(⟳)ボタン
      if(MODE_KINDS.includes(p.kind)){
        const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const smap = UI._modeGifMap || {};
        if(smap[slug]) UI._gifStillHover(tile, ph, smap[slug]);   // 通常静止/ホバーでアニメ
        const b = document.createElement('div');
        b.textContent = '⟳'; b.title = 'このモードに切替してGIFサムネを生成';
        b.style.cssText = 'position:absolute;top:2px;right:2px;font:10px/1 var(--mono);background:rgba(0,0,0,.72);color:#9be;padding:2px 5px;border-radius:3px;cursor:pointer;z-index:3';
        b.addEventListener('click', e=>{ e.stopPropagation(); App.captureVisualGif(i); });
        tile.appendChild(b);
      }
      const _sidPre = (p.sid ? p.sid + ' ' : '');
      const _disp = UI._visualNames()[p.name] || p.name;
      const lbl = document.createElement('div'); lbl.className = 'label'; lbl.textContent = _sidPre + _disp; tile.appendChild(lbl);
      { const eb = document.createElement('div'); eb.textContent = '✎'; eb.title = '名前変更';
        eb.style.cssText = 'position:absolute;top:2px;left:2px;font:10px/1 var(--mono);background:rgba(0,0,0,.72);color:#ccd;padding:2px 5px;border-radius:3px;cursor:pointer;z-index:3';
        eb.addEventListener('click', e=>{ e.stopPropagation(); UI._renameVisualTile(p.name, _sidPre, lbl); });
        tile.appendChild(eb); }
      tile.addEventListener('mouseenter', ()=>{ Preview.hoveredIdx = i; });
      tile.addEventListener('mouseleave', ()=>{ if(Preview.hoveredIdx === i) Preview.hoveredIdx = -1; });
      tile.addEventListener('contextmenu', e=>{ e.preventDefault(); });
      tile.addEventListener('click', ()=>{ App.transitionTo(i); });
      // 全タイル: 下段 Slot A/B プレビューへドラッグ投入可 (シェーダ並べ替えとは独立に index を記録)
      tile.draggable = true;
      tile.addEventListener('dragstart', e=>{ UI._visDragIdx = i; try{ e.dataTransfer.setData('text/plain', String(i)); }catch(_){} });
      tile.addEventListener('dragend', ()=>{ setTimeout(()=>{ UI._visDragIdx = null; }, 0); });
      // シェーダのみドラッグ並べ替え可(間にピンクの挿入線)
      if(tile.dataset.cat === 'shader'){
        tile.draggable = true;
        tile.addEventListener('dragstart', e=>{ UI._shDragFrom = i; tile.style.opacity = '0.4'; try{ e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }catch(_){} });
        tile.addEventListener('dragend', ()=>{ tile.style.opacity = ''; UI._clearShDrop(); UI._shDragFrom = null; });
        tile.addEventListener('dragover', e=>{
          if(UI._shDragFrom == null || UI._shDragFrom === i || !App._isShaderPreset(PRESETS[i])) return;
          e.preventDefault(); try{ e.dataTransfer.dropEffect = 'move'; }catch(_){}
          const rect = tile.getBoundingClientRect();
          const before = (e.clientX - rect.left) < rect.width / 2;
          UI._clearShDrop();
          tile.style.boxShadow = (before ? '-3px 0 0 0 ' : '3px 0 0 0 ') + '#ff2d9b';
          UI._shDropTile = tile; UI._shDropBefore = before;
        });
        tile.addEventListener('drop', e=>{
          e.preventDefault();
          const before = UI._shDropBefore; UI._clearShDrop();
          const from = UI._shDragFrom; UI._shDragFrom = null;
          if(from != null && from !== i) App.shaderReorder(from, i, before);
        });
      }
      grid.appendChild(tile);
      this.thumbCanvases[i] = c;
      c.addEventListener('__drawn__', ()=>{ if(ph.parentNode) ph.parentNode.removeChild(ph); });
      // 遅延ローディング対象として監視 (シェーダ系のみ。可視時に _queueThumb で compile)
      if(this._thumbObserver && !isModeKind(p.kind)) this._thumbObserver.observe(tile);
    };

    // 動画ファイル 1 個分のタイル (クリックで現スロットへロード)。tile を返すだけ(挿入は呼び出し側)。
    const makeMovieTile = (item, vnum)=>{
      const tile = document.createElement('div');
      tile.className = 'thumb-tile';
      tile.dataset.cat = 'movie';
      tile.title = item.name;
      const cv = document.createElement('canvas'); cv.width = Preview.W; cv.height = Preview.H; tile.appendChild(cv);
      const ph = document.createElement('div'); ph.className = 'placeholder'; ph.textContent = '▶'; ph.style.fontSize = '18px'; ph.style.color = 'var(--acc)'; tile.appendChild(ph);
      const vsid = 'M' + String(vnum).padStart(3, '0');
      const _mbase = item.name.replace(/\.[^.]+$/, '');
      const _mpre = vsid + ' ';
      const lbl = document.createElement('div'); lbl.className = 'label'; lbl.textContent = _mpre + (UI._visualNames()[_mbase] || _mbase); tile.appendChild(lbl);
      { const eb = document.createElement('div'); eb.textContent = '✎'; eb.title = '名前変更';
        eb.style.cssText = 'position:absolute;top:2px;left:2px;font:10px/1 var(--mono);background:rgba(0,0,0,.72);color:#ccd;padding:2px 5px;border-radius:3px;cursor:pointer;z-index:3';
        eb.addEventListener('click', e=>{ e.stopPropagation(); UI._renameVisualTile(_mbase, _mpre, lbl); });
        tile.appendChild(eb); }
      const img = new Image();
      img.onload = ()=>{
        try{
          const ctx = cv.getContext('2d'), iw = img.naturalWidth, ih = img.naturalHeight;
          const cw = cv.width, ch = cv.height;
          const scale = Math.max(cw/iw, ch/ih);
          const dw = iw*scale, dh = ih*scale;
          ctx.drawImage(img, (cw-dw)/2, (ch-dh)/2, dw, dh);
        }catch(e){}
        if(ph.parentNode) ph.remove();
      };
      img.onerror = ()=>{};
      img.src = item.url.replace(/([^/]+)\.[^.]+$/, 'thumbs/$1.jpg');
      // サーバー共通 GIF サムネ (あれば) + 生成(⟳)ボタン
      const mslug = 'movie_' + item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const smap = UI._modeGifMap || {};
      if(smap[mslug]) UI._gifStillHover(tile, ph, smap[mslug]);   // 通常静止/ホバーでアニメ
      const gb = document.createElement('div');
      gb.textContent = '⟳'; gb.title = 'この動画でGIFサムネを生成';
      gb.style.cssText = 'position:absolute;top:2px;right:2px;font:10px/1 var(--mono);background:rgba(0,0,0,.72);color:#9be;padding:2px 5px;border-radius:3px;cursor:pointer;z-index:3';
      gb.addEventListener('click', e=>{ e.stopPropagation(); App.captureMovieGif(item.url, item.name); });
      tile.appendChild(gb);
      tile.addEventListener('click', ()=>{ if(App.transitionVideo) App.transitionVideo(item.url, item.name); });
      return tile;
    };

    const modeIdx = [], shaderIdx = [];
    PRESETS.forEach((p, i)=>{ (isModeKind(p.kind) ? modeIdx : shaderIdx).push(i); });

    // 「なし(透明)」は各セクションの先頭に置く (どのカテゴリで絞っても選べるように)
    const noneIdx = PRESETS.findIndex(p => p && p.kind === 'none');
    // Mode / Shader は同期描画、Movie はフォルダ走査後に Mode と Shader の間へ挿入
    // Code エントリが「なし」以外に無ければセクションごと出さない (VIDEO はタイル非表示なので除外)
    const codeCount = modeIdx.filter(i => PRESETS[i].kind !== 'none' && PRESETS[i].kind !== 'video').length;
    if(codeCount){ addLabel('Code');   modeIdx.forEach(i => makeTile(i)); }
    const movieLbl  = addLabel('Movie');
    if(noneIdx >= 0) makeTile(noneIdx, 'movie');            // Movie セクションの先頭
    const shaderLbl = addLabel('Shader');
    if(noneIdx >= 0) makeTile(noneIdx, 'shader');           // Shader セクションの先頭
    shaderIdx.forEach(i => makeTile(i));

    const cnt = $('#thumbCount');
    if(cnt) cnt.textContent = String(PRESETS.length);
    this.refreshActiveThumb();
    this.applyVisualFilter();

    (async ()=>{
      let movies = [];
      try{ if(typeof Movie !== 'undefined'){ if(!Movie.initialized && typeof GL !== 'undefined' && GL.gl) Movie.init(GL.gl); movies = await Movie.scanFolder(); } }catch(e){}
      // 書き込み不可配信でブラウザ保存 (IndexedDB) した取り込み動画も一覧へ足す
      movies = (movies || []).concat((typeof MediaImport !== 'undefined') ? MediaImport.storedVideos : []);
      if(shaderLbl.parentNode !== grid) return;   // await 中に再ビルドされたら旧ラベルは detach 済み → insertBefore 例外を防ぐ
      if(!movies || !movies.length){
        // Movie セクションごと畳む (先頭の「なし」タイルも残さない)
        const nx = movieLbl.nextElementSibling;
        if(nx && nx.classList && nx.classList.contains('thumb-tile') && nx.dataset.cat === 'movie') nx.remove();
        if(movieLbl.parentNode) movieLbl.remove(); return; }
      movies.forEach((item, i) => grid.insertBefore(makeMovieTile(item, i + 1), shaderLbl));
      UI.applyVisualFilter();
    })();
  },

  // 遅延ローディング: タイルが可視になったら (JPG が無い場合のみ) live コンパイルのキューへ積む。
  _queueThumb(tile){
    if(!tile) return;
    const idx = Number(tile.dataset.idx);
    if(!Number.isFinite(idx)) return;
    const c = this.thumbCanvases && this.thumbCanvases[idx];
    if(!c){ return; }
    if(c.__hasThumb){ if(this._thumbObserver) this._thumbObserver.unobserve(tile); return; }  // JPG 取得済み
    if(!c.__needsLive) return;   // JPG 読込中 → onerror 後に再評価される
    if(Preview.staticQueue.indexOf(idx) < 0) Preview.staticQueue.push(idx);
    if(this._thumbObserver) this._thumbObserver.unobserve(tile);   // compile は一度きり
  },

  refreshActiveThumb(){
    // mark active preset (per slot) — 並び替え後も preset index (data-idx) で照合
    const aIdx = this.activePresetIdx[App.activeSlot];
    $$('#thumbGrid .thumb-tile').forEach(t => t.classList.toggle('on', t.dataset.idx !== undefined && Number(t.dataset.idx) === aIdx));
  },

  // Visual タブ: 検索ボックス + カテゴリ(タグ)ボタンでグリッドを絞り込む
  applyVisualFilter(){
    const inp = $('#visualSearch');
    const q = (inp ? inp.value : '').toLowerCase().trim();
    const onBtn = document.querySelector('.visFilter.on');
    const cat = onBtn ? onBtn.dataset.cat : 'all';
    $$('#thumbGrid .thumb-tile').forEach(t=>{
      const name = ((t.querySelector('.label')||{}).textContent || t.title || '').toLowerCase();
      const okQ = !q || name.includes(q);
      const okCat = (cat === 'all') || (t.dataset.cat === cat);
      t.style.display = (okQ && okCat) ? '' : 'none';
    });
    $$('#thumbGrid .visLabel').forEach(l=>{
      let show = true;
      if(q) show = false;                          // 検索中は見出しを隠す(結果が混在)
      else if(cat !== 'all') show = (l.dataset.lbl === cat);
      l.style.display = show ? '' : 'none';
    });
  },

  openTab(name){
    // 検索バーがアクティブなまま Preset ⇄ Visual を行き来したら、移動先の検索バーへフォーカスを引き継ぐ
    const ae = document.activeElement;
    const wasSearch = !!(ae && (ae.id === 'visualSearch' || ae.id === 'presetSearch'));
    $$('.tab').forEach(t=>t.classList.toggle('on', t.dataset.tab===name));
    $$('.pane').forEach(p=>p.classList.toggle('on', p.dataset.pane===name));
    if(name === 'shader' && this.refreshImageMode) this.refreshImageMode();   // Visual を開いたら Image フォルダを反映
    if(wasSearch){
      const inp = name === 'preset' ? $('#presetSearch') : (name === 'shader' ? $('#visualSearch') : null);
      if(inp){ inp.focus(); try{ inp.select(); }catch(_){} }
    }
  },

  compileFromEditor(){
    const src = $('#code').value;
    if(!src.trim()){ toast('Editor is empty'); return; }
    // Editor からのコンパイルはシェーダモードへ切替。手動編集は即時エラー表示のため同期コンパイル。
    GL.slots[App.activeSlot].kind = 'shader';
    const ok = GL.compileSlot(App.activeSlot, src, {sync:true});
    if(ok){ this.hideError(); this.refreshParams(); this.updateGutter([]); this.refreshFmt(); this.refreshSlot(); toast('Compiled ('+GL.slots[App.activeSlot].format+')'); }
    else { this.showError(GL.slots[App.activeSlot].errors); this.updateGutter(Shader.errorLines(GL.slots[App.activeSlot].errors)); this.refreshFmt(); }
  },
  refreshFmt(){
    const f = GL.slots[App.activeSlot].format || '—';
    const el = $('#fmtBadge'); if(!el) return;
    el.textContent = f;
    el.style.color = f==='shadertoy' ? 'var(--acc2)' : f==='sandbox' ? 'var(--warn)' : 'var(--dim)';
  },
  showError(msg){ const e=$('#errbox'); e.textContent = msg; e.classList.add('show'); },
  hideError(){ $('#errbox').classList.remove('show'); },

  updateGutter(errLines){
    const code = $('#code').value;
    const n = code.split('\n').length;
    const g = $('#gutter');
    const errs = new Set(errLines||[]);
    let html='';
    for(let i=1;i<=n;i++) html += errs.has(i)?`<span class="errline">${i}</span>\n`:`${i}\n`;
    g.innerHTML = html;
  },

  /* プレビュー右上の FX バッジ。
     合成プレビュー = 出力全体に効いているもの、A/B = そのスロットに固有のもの。
     切り忘れやすい「かかりっぱなし」を一目で分かるようにするのが目的。 */
  _fxBadgeSig: {},
  // Blend Mode プレビュー行のタイルを一度だけ作る (中身の描画は GL.drawMixPreviews)
  buildBlendBar(bar, modes){
    bar.innerHTML = '';
    modes.forEach(m=>{
      const cell = document.createElement('div');
      cell.className = 'bp';
      cell.title = 'Blend: ' + m.key + ' (クリックで適用)';
      const cvs = document.createElement('canvas');
      const lb = document.createElement('span');
      lb.textContent = m.label;
      cell.appendChild(cvs); cell.appendChild(lb);
      cell.__cvs = cvs; cell.__ctx = cvs.getContext('2d');
      cell.addEventListener('click', ()=>{
        App.setBlendMode(m.key);
        const cb = document.querySelector('#cfBlend'); if(cb) cb.value = m.key;
        if(typeof MIDI !== 'undefined' && MIDI.refreshLeds) MIDI.refreshLeds();
        [...bar.children].forEach((c,i)=>c.classList.toggle('on', modes[i].key === m.key));
        toast('Blend: ' + m.key);
      });
      bar.appendChild(cell);
    });
  },
  refreshPreviewBadges(){
    const P = (typeof App !== 'undefined' && App.post) ? App.post : {};
    const dz = (v)=> (App.deadParam ? App.deadParam(v || 0) : (v || 0));
    const on = (v, th)=> Math.abs(dz(v)) > (th == null ? 0.001 : th);
    const main = [], a = [], b = [];

    // Auto Map: 符号で適用先が変わる (負 = A を B のパレットへ / 正 = B を A のパレットへ)。
    // A/B プレビュー自体は素の絵だが、どちらが再彩色対象かは知らせたいので該当スロットにも出す。
    const pal = dz(P.paletteAmt);
    if(Math.abs(pal) > 0.001){
      main.push({ t:'AUTO MAP', c:'hot', title:'Auto Map ' + (pal < 0 ? '(A ← B)' : '(B ← A)') });
      (pal < 0 ? a : b).push({ t:'AUTO MAP', c:'hot', title:'このスロットが相手のパレットで再彩色されて出力されます (プレビューは素の絵)' });
    }
    // 色パイプライン (出力全体 = 合成プレビューにのみ表示。A/B プレビューは Post FX 非適用)
    if(on(P.gradMix))  main.push({ t:'GRAD', title:'Grad Map' + (dz(P.gradMix) < 0 ? ' (反転)' : '') });
    if(on(P.hueRot))   main.push({ t:'HUE ROT', title:'Hue Rotate' });
    if(on(P.hue))      main.push({ t:'HUE', title:'Hue Shift' });
    if(on(P.inv))      main.push({ t:'INV', title:'Invert' });
    if(on(P.sat, 0.01) && Math.abs(dz(P.sat) - 1) > 0.01) main.push({ t:'SAT', title:'Saturation' });
    if(on(P.gain))     main.push({ t:'GAIN', title:'Gain' });

    // 合成のみ: 出力全体の状態
    if(typeof Overlay !== 'undefined' && Overlay.P && Overlay.P.enabled && (Overlay.strokes||[]).length)
      main.push({ t:'OVL', title:'Overlay 描画中' });
    if(App._drawFrozen) main.push({ t:'FREEZE', c:'warn', title:'Draw フリーズ中 (Space)' });
    if(App.blendMode && App.blendMode !== 'normal')
      main.push({ t:String(App.blendMode).toUpperCase().slice(0,6), title:'Blend: ' + App.blendMode });
    if(App.autoCF && App.autoCF.on) main.push({ t:'AUTO CF', title:'Crossfade 自動' });

    // スロット固有: 非表示
    const vis = App.slotVisible || {};
    if(vis.A === false) a.push({ t:'HIDDEN', c:'warn', title:'Slot A 非表示 ([ で切替)' });
    if(vis.B === false) b.push({ t:'HIDDEN', c:'warn', title:'Slot B 非表示 (] で切替)' });

    this._paintBadges('fxBadgesMain', main);
    this._paintBadges('fxBadgesA', a);
    this._paintBadges('fxBadgesB', b);
  },
  _paintBadges(id, list){
    const box = document.getElementById(id);
    if(!box) return;
    const sig = list.map(x=>x.t + (x.c||'')).join('|');
    if(this._fxBadgeSig[id] === sig) return;   // 変化が無ければ DOM を触らない
    this._fxBadgeSig[id] = sig;
    box.innerHTML = '';
    for(const x of list){
      const el = document.createElement('span');
      el.className = 'fxBadge' + (x.c ? ' ' + x.c : '');
      el.textContent = x.t;
      if(x.title) el.title = x.title;
      box.appendChild(el);
    }
  },

  refreshSlotVisibility(){
    const v = App.slotVisible || (App.slotVisible = {A:true, B:true});
    $$('#slotSel button').forEach(b=>{
      const slot = b.dataset.slot;
      const visible = v[slot] !== false;
      b.classList.toggle('slot-hidden', !visible);
      b.setAttribute('aria-pressed', visible ? 'true' : 'false');
      b.title = `Slot ${slot}: ${visible ? '表示中' : '非表示'} (${slot === 'A' ? '[' : ']'} で切替)`;
    });
    $$('.slotPrev').forEach(tile=>tile.classList.toggle('slot-hidden', v[tile.dataset.slot] === false));
  },

  refreshSlot(){
    // editing = 操作中 (activeSlot) → マゼンタ枠 / shown = A 固定(ベース)。Mix は B の重ね具合。
    const shown = 'A';
    $$('#slotSel button').forEach(b=>{
      b.classList.toggle('editing', b.dataset.slot === App.activeSlot);
      b.classList.toggle('shown',   b.dataset.slot === shown);
    });
    // 下段 Slot A/B プレビューに編集中マーカーを反映
    $$('.slotPrev').forEach(tile=>tile.classList.toggle('editing', tile.dataset.slot === App.activeSlot));
    this.refreshSlotVisibility();
    $('#slotPill') && ($('#slotPill').textContent = App.activeSlot);
    const slot = GL.slots[App.activeSlot];
    const kindPill = $('#slotKindPill');
    if(kindPill){
      kindPill.textContent = slot.kind || 'shader';
      kindPill.style.color = slot.kind === 'layer' ? 'var(--acc)' : 'var(--dim)';
    }
    // mode 別の UI セクションを切り替え
    const isLayer = slot.kind === 'layer';
    const isManga = slot.kind === 'manga';
    const isVideo = slot.kind === 'video';
    const isAratanagara = slot.kind === 'aratanagara';
    const isSlicer = slot.kind === 'slicer';
    const isInkelly = slot.kind === 'inkelly';
    const isTextDeform = slot.kind === 'textdeform';
    const isUgomeki = slot.kind === 'ugomeki';
    const isSpaceType = slot.kind === 'spacetype';
    const isShader = !isLayer && !isManga && !isVideo && !isAratanagara && !isSlicer && !isInkelly && !isTextDeform && !isUgomeki && !isSpaceType && slot.kind !== 'cyberui' && slot.kind !== 'novel' && slot.kind !== 'boltzmann' && slot.kind !== 'pen' && slot.kind !== 'caverns' && slot.kind !== 'shelf' && slot.kind !== 'ribbon' && slot.kind !== 'photoplane' && slot.kind !== 'shredder';
    $$('.shader-mode').forEach(el => el.style.display = isShader ? '' : 'none');
    $$('.layer-mode').forEach(el  => el.style.display = isLayer  ? '' : 'none');
    $$('.manga-mode').forEach(el  => el.style.display = isManga  ? '' : 'none');
    $$('.video-mode').forEach(el  => el.style.display = isVideo  ? '' : 'none');
    $$('.slicer-mode').forEach(el => el.style.display = isSlicer ? '' : 'none');
    $$('.inkelly-mode').forEach(el => el.style.display = isInkelly ? '' : 'none');
    $$('.textdeform-mode').forEach(el => el.style.display = isTextDeform ? '' : 'none');
    $$('.ugomeki-mode').forEach(el => el.style.display = isUgomeki ? '' : 'none');
    $$('.spacetype-mode').forEach(el => el.style.display = isSpaceType ? '' : 'none');
    const isPhoto = slot.kind === 'photoplane';
    $$('.photoplane-mode').forEach(el => el.style.display = isPhoto ? '' : 'none');
    const isShred = slot.kind === 'shredder';
    $$('.shredder-mode').forEach(el => el.style.display = isShred ? '' : 'none');
    if(isShred && this.refreshShredderParams) this.refreshShredderParams();
    if(isPhoto && this.refreshPhotoParams) this.refreshPhotoParams();
    const isPen = slot.kind === 'pen';
    $$('.pen-mode').forEach(el => el.style.display = isPen ? '' : 'none');
    if(isPen && this.refreshPenParams) this.refreshPenParams();
    const isNovel = slot.kind === 'novel';
    $$('.novel-mode').forEach(el => el.style.display = isNovel ? '' : 'none');
    if(isNovel && this.refreshNovelParams) this.refreshNovelParams();
    const isCyber = slot.kind === 'cyberui';
    $$('.cyberui-mode').forEach(el => el.style.display = isCyber ? '' : 'none');
    if(isCyber && this.refreshCyberParams) this.refreshCyberParams();
    if(isInkelly && this.refreshInkelly) this.refreshInkelly();
    if(this.refreshImageMode) this.refreshImageMode();   // image はスロット別状態 → 切替時に選択表示を追従

    $('#code').value = slot.src || '';
    this.updateGutter();
    if(slot.errors) this.showError(slot.errors); else this.hideError();
    this.refreshChannels();
    this.refreshParams();
    this.refreshFmt();
    this.refreshActiveThumb();
    if(isLayer) this.refreshLayerParams();
    if(isManga) this.refreshManga();
    if(isVideo) this.refreshVideo();
    if(isSlicer) this.refreshSlicer();
    if(isTextDeform) this.refreshTextDeform();
    if(isUgomeki) this.refreshUgomeki();
    if(isSpaceType) this.refreshSpaceType();
  },

  refreshVideo(){
    if(typeof Movie === 'undefined') return;
    const v = Movie;
    const fit = $('#vidFit'); if(fit) fit.value = v.P.fit;
    const rate = $('#vidRate'); const rv = $('#vidRateVal');
    if(rate){ rate.value = v.P.rate; if(rv) rv.textContent = v.P.rate.toFixed(2); }
  },

  bindImage(){
    const IM = ()=> (typeof ImageMode !== 'undefined') ? ImageMode : null;
    const ensure = ()=>{ const m = IM(); if(m && !m.initialized && typeof GL !== 'undefined' && GL.gl) m.init(GL.gl); return m; };
    const every = $('#imgEveryBeats');
    if(every) every.addEventListener('input', ()=>{
      const m = ensure(); if(!m) return;
      m.P.everyBeats = parseInt(every.value) || 4;
      const out = $('#imgEveryBeatsVal'); if(out) out.textContent = m.P.everyBeats + '拍';
      m._nextAdvanceBeat = null;
    });
    const order = $('#imgOrder');
    if(order) order.addEventListener('change', ()=>{ const m = ensure(); if(m) m.P.order = order.value; });
    const fit = $('#imgFit');
    if(fit) fit.addEventListener('change', ()=>{ const m = ensure(); if(m) m.P.fit = fit.value; });
    const trans = $('#imgTrans');
    if(trans) trans.addEventListener('change', ()=>{ const m = ensure(); if(m) m.P.transBeats = parseFloat(trans.value); });
    const tstyle = $('#imgTransStyle');
    if(tstyle) tstyle.addEventListener('change', ()=>{ const m = ensure(); if(m) m.P.transStyle = parseInt(tstyle.value, 10); });
    // フォルダ/画像ごとの設定保存 (md の mdParams と同方式)
    const fsave = $('#imgFolderSave');
    if(fsave) fsave.addEventListener('click', ()=>{
      const m = ensure(); if(!m) return;
      if(!m.P.folder){ toast('フォルダ/画像を選択してください'); return; }
      const f = m._folderByDir(m.P.folder);
      if(m.saveFolderParams()) toast('設定を保存: ' + (f ? f.name : m.P.folder));
      else toast('保存失敗');
      this.refreshImageMode();
    });
    const fclear = $('#imgFolderClear');
    if(fclear) fclear.addEventListener('click', ()=>{
      const m = ensure(); if(!m || !m.P.folder) return;
      const f = m._folderByDir(m.P.folder);
      m.clearFolderParams();
      toast('保存設定を削除: ' + (f ? f.name : m.P.folder));
      this.refreshImageMode();
    });
    const prev = $('#imgPrev');
    if(prev) prev.addEventListener('click', ()=>{ const m = ensure(); if(m) m.advance(-1); });
    const next = $('#imgNext');
    if(next) next.addEventListener('click', ()=>{ const m = ensure(); if(m) m.advance(1); });
    const m0 = ensure();
    if(m0) m0.loadFolderIndex().then(()=>{ this.applyImageDefault(); this.refreshImageMode(); });
    // 画像 / 動画のドロップ: Visual タブ全体とフォルダグリッドの両方で受ける。
    // ローカル起動なら images/drop/ ・ movies/ へ実ファイルとして取り込む (MediaImport)。
    MediaImport.bindDropZone(document.querySelector('.pane[data-pane="shader"]'));
    MediaImport.bindDropZone($('#imageFolderGrid'));
    const mBtn = $('#btnMediaImport'), mFile = $('#fileMedia'), mClr = $('#btnMediaClear');
    if(mBtn && mFile){
      mBtn.addEventListener('click', ()=> mFile.click());
      mFile.addEventListener('change', async ()=>{ await MediaImport.accept(mFile.files); mFile.value = ''; });
      MediaImport.local().then(ok=>{
        mBtn.title = ok ? '画像 / 動画を images/drop/ ・ movies/ へ取り込む (次回起動でも残る)'
                        : '画像 / 動画を読み込む (ブラウザに保存され、次回起動でも残ります)';
        if(mClr) mClr.style.display = ok ? 'none' : '';   // 実ファイル取り込み環境では Finder で消せるので不要
      });
    }
    if(mClr) mClr.addEventListener('click', ()=>{
      if(confirm('ブラウザに保存した取り込み画像 / 動画をすべて削除しますか?')) MediaImport.clearStored();
    });
    MediaImport.restore();   // 書き込み不可配信: IndexedDB に保存した素材を復元
  },

  _imageDefKey: 'vj.def.image',
  saveImageDefault(){
    if(typeof ImageMode === 'undefined') return;
    const P = ImageMode.P;
    const d = { folder: P.folder, order: P.order, everyBeats: P.everyBeats, fit: P.fit, image: P.image, transBeats: P.transBeats, transStyle: P.transStyle };
    try{ localStorage.setItem(this._imageDefKey, JSON.stringify(d)); }catch(e){}
    toast('デフォルト保存: image' + (P.folder ? ' (' + P.folder.split('/').pop() + ')' : ''));
  },
  applyImageDefault(){
    if(typeof ImageMode === 'undefined') return;
    let d = null;
    try{ d = JSON.parse(localStorage.getItem(this._imageDefKey) || 'null'); }catch(e){}
    if(!d || typeof d !== 'object') return;
    const P = ImageMode.P;
    if(typeof d.order === 'string') P.order = d.order;
    if(typeof d.everyBeats === 'number') P.everyBeats = d.everyBeats;
    if(typeof d.fit === 'string') P.fit = d.fit;
    if(typeof d.image === 'string') P.image = d.image;
    if(typeof d.transBeats === 'number') P.transBeats = d.transBeats;
    if(typeof d.transStyle === 'number') P.transStyle = d.transStyle;
    if(typeof d.folder === 'string' && d.folder && ImageMode._folderByDir(d.folder)) ImageMode.setFolder(d.folder);
    this.refreshImageMode();
  },
  resetImageDefault(){
    if(typeof ImageMode === 'undefined') return;
    // 保存が無ければ初期値、あれば保存値へ
    Object.assign(ImageMode.P, JSON.parse(JSON.stringify(ImageMode.PDefaults || {})));
    this.applyImageDefault();
    this.refreshImageMode();
    toast('保存値へ戻しました: image');
  },

  // フォルダの中身を 3×2 (6分割) で敷き詰めたサムネを描く (preset/shader サムネと同じ 4:3)
  _drawFolderThumb(cv, folder){
    const ctx = cv.getContext('2d');
    const imgs = folder.images || [];
    // 1 枚もの (single / 直下の個別画像) は分割せず全面 1 コマで描く
    const COLS = imgs.length > 1 ? 3 : 1, ROWS = imgs.length > 1 ? 2 : 1, CELLS = COLS*ROWS;
    const W = cv.width, H = cv.height, cw = W/COLS, ch = H/ROWS;
    ctx.fillStyle = '#0b0b0f'; ctx.fillRect(0, 0, W, H);
    if(!imgs.length) return;
    const srcOf = (idx)=> folder._urls ? folder._urls[idx]                     // 臨時(ドロップ)フォルダは blob URL
                        : (folder.single ? folder.dir : folder.dir + '/' + imgs[idx]);   // single は dir 自体がファイルパス
    // 均等に CELLS 枚を選ぶ (少なければ繰り返し)
    const pick = [];
    for(let i=0; i<CELLS; i++){
      const idx = imgs.length >= CELLS ? Math.round(i * (imgs.length - 1) / (Math.max(CELLS-1,1))) : (i % imgs.length);
      pick.push(srcOf(idx));
    }
    pick.forEach((url, i)=>{
      const gx = (i % COLS) * cw, gy = ((i/COLS)|0) * ch;
      const im = new Image();
      im.onload = ()=>{
        // cover でセルに収める
        const ia = im.naturalWidth / Math.max(1, im.naturalHeight), ca = cw/ch;
        let sw, sh, sx, sy;
        if(ia > ca){ sh = im.naturalHeight; sw = sh * ca; sx = (im.naturalWidth - sw)/2; sy = 0; }
        else       { sw = im.naturalWidth;  sh = sw / ca; sx = 0; sy = (im.naturalHeight - sh)/2; }
        try{ ctx.drawImage(im, sx, sy, sw, sh, gx, gy, cw, ch); }catch(e){}
      };
      im.src = url;
    });
  },

  refreshImageMode(){
    if(typeof ImageMode === 'undefined') return;
    const m = ImageMode, P = m.P;
    const every = $('#imgEveryBeats'); if(every){ every.value = String(P.everyBeats); const o=$('#imgEveryBeatsVal'); if(o) o.textContent = P.everyBeats + '拍'; }
    const order = $('#imgOrder'); if(order) order.value = P.order;
    const fit = $('#imgFit'); if(fit) fit.value = P.fit;
    const trans = $('#imgTrans'); if(trans) trans.value = String(typeof P.transBeats === 'number' ? P.transBeats : -1);
    const tstyle = $('#imgTransStyle'); if(tstyle) tstyle.value = String(typeof P.transStyle === 'number' ? P.transStyle : -1);
    { const fsave = $('#imgFolderSave'), fclear = $('#imgFolderClear');
      const f = P.folder ? m._folderByDir(P.folder) : null;
      const saved = m.hasFolderParams ? m.hasFolderParams(P.folder) : false;
      if(fsave){ fsave.textContent = 'Save ▸ ' + (f ? f.name : 'フォルダ設定') + (saved ? ' ●' : ''); fsave.disabled = !P.folder; }
      if(fclear) fclear.disabled = !saved; }
    const info = m.currentInfo();
    const cur = $('#imageCurInfo');
    if(cur) cur.textContent = info.n ? (info.name + '  ' + (info.idx+1) + '/' + info.n) : '';
    const grid = $('#imageFolderGrid');
    if(grid){
      const sig = (m.folders || []).map(f => f.dir + ':' + f.count).join('|') + '#' + P.folder;
      if(grid.dataset.sig !== sig){
        grid.dataset.sig = sig;
        grid.innerHTML = '';
        for(const f of (m.folders || [])){
          const tile = document.createElement('div');
          tile.className = 'thumb-tile' + (f.dir === P.folder ? ' on' : '');
          const cv = document.createElement('canvas');
          cv.width = 192; cv.height = 144;   // 4:3 (preset/shader サムネと同じ)
          cv.style.cssText = 'width:100%;height:100%;display:block;object-fit:cover';
          this._drawFolderThumb(cv, f);
          const lab = document.createElement('div');
          lab.textContent = f.name + ' (' + f.count + ')';
          lab.style.cssText = 'position:absolute;left:0;bottom:0;right:0;font:600 10px/1.4 var(--mono);color:#fff;background:rgba(0,0,0,.6);padding:1px 5px;pointer-events:none';
          tile.appendChild(cv); tile.appendChild(lab);
          tile.addEventListener('click', ()=>{
            if(!m.initialized && typeof GL !== 'undefined' && GL.gl) m.init(GL.gl);
            m.setFolder(f.dir);
            // アクティブスロットが image でなければ image プリセットをロード
            const slot = GL.slots[App.activeSlot];
            if(!slot || slot.kind !== 'image'){
              const idx = PRESETS.findIndex(p => p.kind === 'image');
              if(idx >= 0) App.loadPreset(idx, App.activeSlot);
            }
            App.crossfade = (App.activeSlot === 'A') ? 0 : 1;
            this.refreshImageMode();
            if(typeof UI !== 'undefined' && UI.refreshMix) UI.refreshMix();
            toast('Image: ' + f.name);
          });
          grid.appendChild(tile);
        }
      }
    }
  },

  bindPhoto(){
    const rescan = $('#btnPhotoRescan');
    if(rescan) rescan.addEventListener('click', async ()=>{
      if(typeof PhotoPlane === 'undefined') return;
      if(!PhotoPlane.initialized) PhotoPlane.init(GL.gl);
      const n = await PhotoPlane.rescan();
      const st = $('#photoStatus'); if(st) st.textContent = (n||0) + ' photos (images/photo/)';
      if(this.refreshPhotoParams) this.refreshPhotoParams();
    });
    const reseed = $('#btnPhotoReseed');
    if(reseed) reseed.addEventListener('click', ()=>{
      if(typeof PhotoPlane !== 'undefined' && PhotoPlane.P){
        PhotoPlane.P.seed = (Math.random()*999|0) + 1;
        if(PhotoPlane.generateLayout) PhotoPlane.generateLayout();
        if(this.refreshPhotoParams) this.refreshPhotoParams();
      }
    });
  },
  refreshPhotoParams(){
    const root = $('#photoParams'); if(!root) return;
    root.innerHTML = '';
    if(typeof PhotoPlane === 'undefined' || !PhotoPlane.initialized){
      root.innerHTML = '<div class="help">PHOTOPLANE preset を選ぶと初期化されます</div>'; return;
    }
    const P = PhotoPlane.P;
    const st = $('#photoStatus'); if(st) st.textContent = (PhotoPlane.textures.length||0) + ' photos (images/photo/)';
    const specs = [
      ['Count','count',1,120,1,v=>String(v|0),true],
      ['Size','size',0.2,4,0.05,v=>v.toFixed(2),true],
      ['Size Var','sizeVar',0,4,0.05,v=>v.toFixed(2),true],
      ['Spread','spread',2,20,0.5,v=>v.toFixed(1),true],
      ['Crop Min','cropMin',0.1,1,0.02,v=>v.toFixed(2),true],
      ['Crop Max','cropMax',0.1,1,0.02,v=>v.toFixed(2),true],
      ['Stretch','stretch',0,1,0.02,v=>v.toFixed(2),true],
      ['Spin','spin',0,2,0.02,v=>v.toFixed(2),false],
      ['Roam Speed','autorot',0,2,0.02,v=>v.toFixed(2),false],
      ['Bend','bend',0,2,0.02,v=>v.toFixed(2),false],
      ['Warp Amp','warpAmp',0,0.6,0.01,v=>v.toFixed(2),false],
      ['Warp Freq','warpFreq',0.5,16,0.1,v=>v.toFixed(1),false],
      ['FOV','fov',30,110,1,v=>String(v|0),false],
      ['Distance','dist',5,40,0.5,v=>v.toFixed(1),false],
      ['Cam Elev','camEl',-1.2,1.2,0.02,v=>v.toFixed(2),false],
      ['Ambient','ambient',0,1,0.02,v=>v.toFixed(2),false],
      ['Beat Pulse','beatPulse',0,1.5,0.05,v=>v.toFixed(2),false],
      ['Seed','seed',1,999,1,v=>String(v|0),true],
    ];
    for(const [label,key,mi,ma,step,fmt,relayout] of specs){
      const row=document.createElement('div'); row.className='row';
      const lab=document.createElement('label'); lab.textContent=label;
      const inp=document.createElement('input'); inp.type='range'; inp.min=mi; inp.max=ma; inp.step=step; inp.value=P[key];
      const val=document.createElement('div'); val.className='val'; val.textContent=fmt(P[key]);
      inp.addEventListener('input', ()=>{ P[key]=parseFloat(inp.value); val.textContent=fmt(P[key]); if(relayout && PhotoPlane.generateLayout) PhotoPlane.generateLayout(); });
      row.appendChild(lab); row.appendChild(inp); row.appendChild(val); root.appendChild(row);
    }
  },
  // すべてのスライダーに「ダブルクリックで既定値へ戻す」を付ける。
  //   既定値 = そのスライダーが最初に組まれた時点の値 (= Save/Reset が復元する値)。
  //   動的に作られるセクションも拾うため MutationObserver で新しい range に印を付ける。
  installSliderDefaults(){
    const stamp = (root, force)=>{
      (root.querySelectorAll ? root.querySelectorAll('input[type=range]') : []).forEach(el=>{
        if(force || el.dataset.defval === undefined) el.dataset.defval = el.value;
      });
      if(root.tagName === 'INPUT' && root.type === 'range' && (force || root.dataset.defval === undefined)) root.dataset.defval = root.value;
    };
    // 初回は init 内の各 slid() が値を入れ終わってから控える (静的 HTML の value は既定値ではない)
    setTimeout(()=>stamp(document, true), 0);
    if(!this._sliderDefObs){
      this._sliderDefObs = new MutationObserver(muts=>{
        for(const m of muts) m.addedNodes.forEach(n=>{ if(n.nodeType === 1) stamp(n); });
      });
      const side = document.getElementById('side');
      this._sliderDefObs.observe(side || document.body, {childList:true, subtree:true});
    }
    const host = document.getElementById('side') || document.body;
    if(host._sliderDblBound) return;
    host._sliderDblBound = true;
    host.addEventListener('dblclick', (e)=>{
      const el = e.target.closest && e.target.closest('input[type=range]');
      if(!el || el.dataset.defval === undefined) return;
      e.preventDefault(); e.stopPropagation();
      el.value = el.dataset.defval;
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
      const row = el.closest('.row');
      const lab = row ? (row.querySelector('label') || {}).textContent : '';
      toast('既定値に戻しました' + (lab ? ': ' + lab : '') + ' (' + el.value + ')');
      App._undoSchedule && App._undoSchedule();
    });
  },
  // Save / Reset がある見出しには Random も置く (セクション内のスライダー/プルダウンをランダム化)
  installRandomButtons(){
    document.querySelectorAll('.default-actions').forEach(box=>{
      if(box.querySelector('.randDefBtn')) return;
      const ref = box.querySelector('.saveDefBtn') || box.querySelector('.resetDefBtn');
      if(!ref) return;
      const b = document.createElement('button');
      b.className = 'randDefBtn';
      b.textContent = 'Random';
      b.title = 'このセクションのパラメータをランダム化';
      b.dataset.kind = ref.dataset.kind || '';
      box.insertBefore(b, box.firstChild);
    });
  },
  // セクション内の range / select をランダム化。各エンジンの min/max/step と input ハンドラを
  // そのまま使うので、値域も反映処理(再構築など)もエンジン側の実装に従う。
  randomizeSection(sec, kind){
    if(!sec) return;
    const rnd = (a,b)=> a + Math.random()*(b-a);
    let n = 0;
    sec.querySelectorAll('input[type=range]').forEach(inp=>{
      const mi = parseFloat(inp.min), ma = parseFloat(inp.max);
      if(!isFinite(mi) || !isFinite(ma) || ma <= mi) return;
      const lab = ((inp.parentElement && inp.parentElement.querySelector('label')) || {}).textContent || '';
      // 個数・反復系は重くなりすぎないよう下側 60% に収める
      const heavy = /count|grid|steps|iter|枚数|個数/i.test(lab);
      const step = parseFloat(inp.step) || 0.01;
      let v = rnd(mi, heavy ? mi + (ma - mi)*0.6 : ma);
      v = Math.round(v/step)*step;
      v = Math.max(mi, Math.min(ma, v));
      inp.value = String(v);
      inp.dispatchEvent(new Event('input', {bubbles:true}));
      n++;
    });
    sec.querySelectorAll('select').forEach(sl=>{
      if(!sl.options.length || sl.disabled) return;
      sl.selectedIndex = Math.floor(Math.random()*sl.options.length);
      sl.dispatchEvent(new Event('change', {bubbles:true}));
      n++;
    });
    if(typeof MIDI !== 'undefined' && MIDI.refreshLeds) MIDI.refreshLeds();
    App._undoSchedule && App._undoSchedule();
    toast('ランダム化: ' + (kind || 'section') + ' (' + n + ' 項目)');
  },
  refreshShredderParams(){
    const root = document.getElementById('shredParams'); if(!root) return;
    if(typeof Shredder === 'undefined' || !Shredder.initialized){
      root.innerHTML = '<div class="help">SHREDDER preset を選ぶと初期化されます</div>'; return;
    }
    const P = Shredder.P;
    const specs = [
      ['Count',      'grid',       16, 192, 4,    v=>String((v|0)*(v|0)), true],
      ['Scale',      'scale',      0.2, 3,  0.02, v=>v.toFixed(2), false],
      ['Spike',      'spike',      0.2, 5,  0.05, v=>v.toFixed(2), false],
      ['Blades',     'blades',     1,   6,  1,    v=>String(v|0), true],
      ['Twist',      'twist',      0,   2,  0.02, v=>v.toFixed(2), false],
      ['Shape Rand', 'shapeRand',  0,   1,  0.02, v=>v.toFixed(2), false],
      ['Bend',       'bend',       -1,  1,  0.02, v=>v.toFixed(2), false],
      ['Bend Turn',  'bendTurn',   0,   1,  0.02, v=>v.toFixed(2), false],
      ['Speed',      'speed',      0,   3,  0.02, v=>v.toFixed(2), false],
      ['Evolution',  'evolution',  0,   2,  0.02, v=>v.toFixed(2), false],
      ['Turbulence', 'turbulence', 0.2, 3,  0.02, v=>v.toFixed(2), false],
      ['Radius',     'radius',     0.4, 4,  0.05, v=>v.toFixed(2), false],
      ['Outflow',    'outflow',    0,   1.5, 0.02, v=>v.toFixed(2), false],
      ['Flock',      'flock',      0,   1,  0.02, v=>v.toFixed(2), false],
      ['Cohesion',   'cohesion',   0,   1.5, 0.02, v=>v.toFixed(2), false],
      ['Speed Var',  'speedVar',   0,   1,  0.02, v=>v.toFixed(2), false],
      ['Smoothness', 'inertia',    0,   1,  0.01, v=>v.toFixed(2), false],
      {sel:true, label:'Aim (向き)',   key:'aim',       opts:['進行方向','後ろ','外向き','中心向き','画面内','個体固定']},
      {sel:true, label:'Shape (形)',    key:'shape',     opts:['三角','矢','針','薄片','十字']},
      {sel:true, label:'Color',         key:'colorMode', opts:['aratanagara','モノクローム','表裏同色','速度で色相']},
      {sel:true, label:'Cam Path',      key:'camPath',   opts:['周回','螺旋','静止','ドリフト']},
      {sel:true, label:'Path (軌跡)',    key:'path',      opts:['なし','円','無限(∞)','リサージュ','トーラス結び目','8の字(縦)']},
      {sel:true, label:'Emitter (湧き)', key:'emitter',   opts:['空間全体','中心の球殻','外殻から中へ','中心の点']},
      {sel:true, label:'Near Mode',      key:'nearMode',  opts:['透明度','ディザ','背景へ溶かす','なし']},
      ['Life',       'life',       20, 400, 5,    v=>String(v|0), false],
      ['FOV',        'fov',        30, 150, 1,    v=>String(v|0)+'°', false],
      ['Fisheye',    'fisheye',    0,   1,  0.02, v=>v.toFixed(2), false],
      ['Distance',   'dist',       3,  24,  0.2,  v=>v.toFixed(1), false],
      ['Cam Elev',   'camEl',      -1.2, 1.2, 0.02, v=>v.toFixed(2), false],
      ['Orbit',      'autorot',    0,   2,  0.02, v=>v.toFixed(2), false],
      ['Spin Rate',  'spinRate',   0,   4,  0.02, v=>v.toFixed(2), false],
      ['Spin Var',   'spinVar',    0,   1,  0.02, v=>v.toFixed(2), false],
      ['Path Size',  'pathSize',   0,   8,  0.05, v=>v.toFixed(2), false],
      ['Path Rate',  'pathRate',   0,   1.5, 0.02, v=>v.toFixed(2), false],
      ['Path Pull',  'pathPull',   0,   2,  0.02, v=>v.toFixed(2), false],
      ['Cam Follow', 'camFollow',  0,   1,  0.02, v=>v.toFixed(2), false],
      ['Swirl',      'swirl',      -1.5, 1.5, 0.02, v=>v.toFixed(2), false],
      ['Swirl Tilt', 'swirlTilt',  -1,  1,  0.02, v=>v.toFixed(2), false],
      ['Orbit Tilt', 'orbitTilt',  0,   1,  0.02, v=>v.toFixed(2), false],
      ['Tilt Rate',  'orbitTiltRate', 0, 2, 0.02, v=>v.toFixed(2), false],
      ['Ellipse',    'orbitEllip', 0,   0.8, 0.02, v=>v.toFixed(2), false],
      ['Hue',        'hue',        -1,  1,  0.01, v=>v.toFixed(2), false],
      ['Saturation', 'sat',        0,   1.6, 0.02, v=>v.toFixed(2), false],
      ['Chrome',     'chrome',     0,   1,  0.02, v=>v.toFixed(2), false],
      ['Blue Light', 'blueLight',  0,   2,  0.02, v=>v.toFixed(2), false],
      ['Chrome Light','chromeLight',0,  2,  0.02, v=>v.toFixed(2), false],
      ['Chrome Con', 'chromeCon',  0,   2,  0.02, v=>v.toFixed(2), false],
      ['Chrome Floor','chromeFloor',0,  0.6, 0.01, v=>v.toFixed(2), false],
      ['Stripe Freq', 'stripeFreq', 2,  80,  0.5,  v=>v.toFixed(1), false],
      ['Stripe Scale','stripeScale',0,   4,  0.02, v=>v.toFixed(2), false],
      ['Stripe Amt',  'stripeAmt',  0,   1,  0.02, v=>v.toFixed(2), false],
      ['Stripe Width','stripeW',    0,   1,  0.02, v=>v.toFixed(2), false],
      ['Glint',       'glintAmt',   0,   1,  0.02, v=>v.toFixed(2), false],
      ['Glint Sharp', 'glintSharp', 4, 120,  1,    v=>String(v|0), false],
      ['Specular',    'specAmt',    0,   2,  0.02, v=>v.toFixed(2), false],
      ['Near Clear', 'nearFade',   0,   6,  0.05, v=>v.toFixed(2), false],
      ['Near Cull',  'nearCull',   0,   3,  0.05, v=>v.toFixed(2), false],
      ['Bg Light',   'bgLight',    0,   1,  0.02, v=>v.toFixed(2), false],
      ['Fog',        'fog',        0,   1.5, 0.02, v=>v.toFixed(2), false],
      ['Fog Near',   'fogNear',    0,   3,  0.02, v=>v.toFixed(2), false],
      ['Fog Far',    'fogFar',     0.2, 6,  0.05, v=>v.toFixed(2), false],
      ['Beat Kick',  'beatKick',   0,   1.5, 0.05, v=>v.toFixed(2), false],
      ['Seed',       'seed',       1, 999,  1,    v=>String(v|0), true],
    ];
    root.innerHTML = '';
    for(const spec of specs){
      const row=document.createElement('div'); row.className='row';
      if(spec.sel){                                   // 選択肢はプルダウン
        const lab=document.createElement('label'); lab.textContent=spec.label;
        const sel=document.createElement('select');
        spec.opts.forEach((name,i)=>{ const o=document.createElement('option'); o.value=i; o.textContent=name; sel.appendChild(o); });
        sel.value = String(Math.round(P[spec.key] || 0));
        sel.addEventListener('change', ()=>{ P[spec.key] = parseInt(sel.value, 10); App._undoSchedule && App._undoSchedule(); });
        row.appendChild(lab); row.appendChild(sel); root.appendChild(row);
        continue;
      }
      const [label,key,mi,ma,step,fmt,rebuild] = spec;
      const lab=document.createElement('label'); lab.textContent=label;
      const inp=document.createElement('input'); inp.type='range'; inp.min=mi; inp.max=ma; inp.step=step; inp.value=P[key];
      const val=document.createElement('div'); val.className='val'; val.textContent=fmt(P[key]);
      inp.addEventListener('input', ()=>{ P[key]=parseFloat(inp.value); val.textContent=fmt(P[key]);
        if(rebuild && Shredder.rebuild) Shredder.rebuild(); });
      row.appendChild(lab); row.appendChild(inp); row.appendChild(val); root.appendChild(row);
    }
  },
  // ─── Ugomeki (文字アニメーション) ───────────────────────────────
  bindUgomeki(){
    const sel = $('#mtMdSelect');
    if(sel) sel.addEventListener('change', ()=>{
      if(typeof Ugomeki === 'undefined') return;
      if(!Ugomeki.initialized && typeof GL !== 'undefined' && GL.gl) Ugomeki.init(GL.gl);
      Ugomeki.setMdSelection(sel.value);
      this.refreshUgomeki();
      App._undoSchedule();
      const idx = Ugomeki.currentMdIndex();
      const pr = Ugomeki.mdSources[idx];
      toast('UGOMEKI md: ' + (sel.value === 'random' ? 'Random' : (pr && pr.name || '')));
    });
    const seedIn = $('#mtSeed');
    const applySeed = (seed)=>{
      if(typeof Ugomeki === 'undefined' || !Ugomeki.initialized) return;
      Ugomeki.randomizeAnim(seed);
      if(seedIn) seedIn.value = seed;
      this.refreshUgomeki();
      App._undoSchedule();
      toast('UGOMEKI 種: ' + seed);
    };
    const sApply = $('#mtSeedApply');
    if(sApply) sApply.addEventListener('click', ()=> applySeed(Math.max(0, parseInt(seedIn && seedIn.value, 10) || 0)));
    const sRand = $('#mtSeedRand');
    if(sRand) sRand.addEventListener('click', ()=> applySeed(Math.floor(Math.random()*100000)));
    const reseed = $('#mtReseed');
    if(reseed) reseed.addEventListener('click', ()=>{
      if(typeof Ugomeki !== 'undefined' && Ugomeki.initialized){ Ugomeki.reseed(); toast('UGOMEKI 揺れパターン変更'); }
    });
  },
  refreshUgomeki(){
    if(typeof Ugomeki === 'undefined') return;
    const T = Ugomeki, P = T.P;
    const sel = $('#mtMdSelect');
    if(sel){
      const list = T.mdSources || [];
      if(sel.dataset.count !== String(list.length)){
        sel.innerHTML = '';
        const any = document.createElement('option');
        any.value = 'random'; any.textContent = 'Random';
        sel.appendChild(any);
        list.forEach((pr, i)=>{
          const opt = document.createElement('option');
          opt.value = String(i);
          opt.textContent = pr.name || ('md ' + (i + 1));
          sel.appendChild(opt);
        });
        sel.dataset.count = String(list.length);
      }
      [...sel.options].forEach(o=>{
        if(o.value === 'random') return;
        const i = parseInt(o.value, 10);
        o.textContent = (list[i] && list[i].name) || ('md ' + (i + 1));
      });
      sel.value = (P.mdMode === 'fixed' && list[P.mdIndex]) ? String(P.mdIndex) : 'random';
    }
    const seedIn = $('#mtSeed');
    if(seedIn && P.animSeed != null) seedIn.value = P.animSeed;
    // 組版チェック・セレクト
    const vert = $('#mtVertical');
    if(vert){ vert.checked = !!P.vertical; if(!vert._mtBound){ vert._mtBound = true;
      vert.addEventListener('change', ()=>{ T.setParams({ vertical: vert.checked }); App._undoSchedule(); }); } }
    const bold = $('#mtBold');
    if(bold){ bold.checked = !!P.bold; if(!bold._mtBound){ bold._mtBound = true;
      bold.addEventListener('change', ()=>{ T.setParams({ bold: bold.checked }); App._undoSchedule(); }); } }
    const font = $('#mtFont');
    if(font){
      if(font.dataset.built !== '1' && T.FONTS){   // 書体プルダウンを MT_FONTS から生成(Unicodeフォールバック込み)
        font.innerHTML = '';
        for(const f of T.FONTS){ const o = document.createElement('option'); o.value = f.ff; o.textContent = f.name; font.appendChild(o); }
        font.dataset.built = '1';
      }
      font.value = P.fontFamily; if(font.selectedIndex < 0) font.selectedIndex = 0;
      if(!font._mtBound){ font._mtBound = true;
        font.addEventListener('change', ()=>{ T.setParams({ fontFamily: font.value }); App._undoSchedule(); }); } }
    const align = $('#mtAlign');
    if(align){ align.value = P.align || 'center';
      if(!align._mtBound){ align._mtBound = true;
        align.addEventListener('change', ()=>{ T.setParams({ align: align.value }); App._undoSchedule(); }); } }
    const spacing = $('#mtSpacing');
    if(spacing){ spacing.value = P.spacing || 'grid';
      if(!spacing._mtBound){ spacing._mtBound = true;
        spacing.addEventListener('change', ()=>{ T.setParams({ spacing: spacing.value }); App._undoSchedule(); }); } }
    const overflow = $('#mtOverflow');
    if(overflow){ overflow.value = P.overflow || 'page';
      if(!overflow._mtBound){ overflow._mtBound = true;
        overflow.addEventListener('change', ()=>{ T.setParams({ overflow: overflow.value }); App._undoSchedule(); }); } }
    const paper = $('#mtPaper');
    if(paper){ paper.value = P.paper; if(!paper._mtBound){ paper._mtBound = true;
      paper.addEventListener('input', ()=>{ T.setParams({ paper: paper.value }); }); } }
    const ink = $('#mtInk');
    if(ink){ ink.value = P.ink; if(!ink._mtBound){ ink._mtBound = true;
      ink.addEventListener('input', ()=>{ T.setParams({ ink: ink.value }); }); } }
    // スライダー一覧 (spec から生成)
    const root = $('#mtParams'); if(!root) return;
    root.innerHTML = '';
    const specs = [
      ['Line Len',   'lineLen',    0, 40,  1,   v=>v ? (v|0)+'ch' : 'no wrap', true],
      ['Lines',      'lineCount',  1, 40,  1,   v=>(v|0)+'ln', true],
      ['Tracking',   'letterSpace',0, 3,   0.05,v=>v.toFixed(2), true],
      ['Leading',    'lineSpace',  0, 3,   0.05,v=>v.toFixed(2), true],
      ['Size %',     'fontScale',  10, 400,5,   v=>(v|0)+'%', true],
      ['Margin %',   'marginPct',  0, 30,  1,   v=>(v|0)+'%', true],
      ['Type Speed', 'typeCps',    0, 60, 0.2, v=>v<=0?'cut':Math.round(v*60)+'/min', true],
      ['Type Hold',  'typeHold',   0, 8,   0.5, v=>v.toFixed(1)+'s', false],
      ['Cut Beats',  'cutBeats',   0.25, 32, 0.25, v=>v+' beat', false],
      ['Sway',       'amp',        0, 40,  0.5, v=>v.toFixed(1)+'%', false],
      ['Rotate',     'rot',        0, 45,  0.5, v=>v.toFixed(1)+'°', false],
      ['Scale',      'scale',      0, 60,  1,   v=>(v|0)+'%', false],
      ['Blink',      'blink',      0, 100, 1,   v=>(v|0)+'%', false],
      ['Cut V',      'cutV',       0, 100, 1,   v=>(v|0)+'%', false],
      ['Cut H',      'cutH',       0, 100, 1,   v=>(v|0)+'%', false],
      ['Cut Diag',   'cutD',       0, 100, 1,   v=>(v|0)+'%', false],
      ['Float',      'float',      0, 150, 1,   v=>(v|0)+'%', false],
      ['Beam',       'beam',       0, 100, 1,   v=>(v|0)+'%', false],
      ['Beam Dist',  'beamDist',   0, 100, 1,   v=>(v|0)+'px', false],
      ['Echo',       'echo',       0, 100, 1,   v=>(v|0)+'%', false],
      ['Echo Gap',   'echoLen',    0, 1000,5,   v=>String(v|0), false],
      ['Aspect',     'aspect',     0, 120, 1,   v=>(v|0)+'%', false],
      ['Double',     'dbl',        0, 100, 1,   v=>(v|0)+'%', false],
      ['Glitch',     'glitch',     0, 100, 1,   v=>(v|0)+'%', false],
      ['Wave',       'wave',       0, 120, 1,   v=>(v|0)+'%', false],
      ['Hue Shift',  'hue',        0, 100, 1,   v=>(v|0)+'%', false],
      ['Blur',       'blur',       0, 80,  1,   v=>(v|0)+'%', false],
      ['Flip H',     'flipH',      0, 100, 1,   v=>(v|0)+'%', false],
      ['Flip V',     'flipV',      0, 100, 1,   v=>(v|0)+'%', false],
      ['Serial/Par', 'mix',        0, 100, 1,   v=>v<=0?'Serial':(v>=100?'Parallel':'Par '+(v|0)+'%'), false],
      ['Ease',       'tame',      -100,100, 1,  v=>v===0?'Even':(v<0?'In '+(-v|0):'Out '+(v|0)), false],
      ['Duration',   'dur',        1, 30,  1,   v=>(v|0)+'s', false],
      ['FPS',        'fps',        1, 60,  1,   v=>String(v|0), false],
      ['Body Kanji', 'bodyKanji',  20, 120, 1,  v=>(v|0)+'%', false],
      ['Body Hira',  'bodyHira',   20, 120, 1,  v=>(v|0)+'%', false],
      ['Body Kana',  'bodyKana',   20, 120, 1,  v=>(v|0)+'%', false],
      ['Body Latin', 'bodyLatin',  20, 120, 1,  v=>(v|0)+'%', false],
      ['Beat Pulse', 'beatPulse',  0, 1,   0.05,v=>v.toFixed(2), false],
    ];
    const sliderMap = {};
    // beam と echo はどちらか一方だけ: 片方を上げたらもう片方を0に落とす
    const excl = { beam:'echo', echo:'beam' };
    const dropOther = (key)=>{
      const other = excl[key];
      if(!other || !(P[key] > 0)) return;
      P[other] = 0;
      const s = sliderMap[other];
      if(s){ s.inp.value = 0; s.val.textContent = s.fmt(0); }
    };
    for(const [label,key,mi,ma,step,fmt,relayout] of specs){
      const row=document.createElement('div'); row.className='row';
      const lab=document.createElement('label'); lab.textContent=label;
      const inp=document.createElement('input'); inp.type='range'; inp.min=mi; inp.max=ma; inp.step=step; inp.value=P[key];
      const val=document.createElement('div'); val.className='val'; val.textContent=fmt(P[key]);
      sliderMap[key] = {inp, val, fmt};
      inp.addEventListener('input', ()=>{
        P[key]=parseFloat(inp.value); val.textContent=fmt(P[key]);
        dropOther(key);
        if(relayout) T._layout = null;
      });
      // ダブルクリックでデフォルト値へ戻す
      inp.addEventListener('dblclick', ()=>{
        const d = (T.PDefaults && T.PDefaults[key] !== undefined) ? T.PDefaults[key] : parseFloat(inp.min);
        P[key]=d; inp.value=d; val.textContent=fmt(d);
        dropOther(key);
        if(relayout) T._layout = null;
        App._undoSchedule();
      });
      row.appendChild(lab); row.appendChild(inp); row.appendChild(val); root.appendChild(row);
    }
  },

  // ─── SpaceType (3D 空間タイポ) ───────────────────────────────
  bindSpaceType(){
    const sel = $('#stMdSelect');
    if(sel) sel.addEventListener('change', ()=>{
      if(typeof SpaceType === 'undefined') return;
      if(!SpaceType.initialized && typeof GL !== 'undefined' && GL.gl) SpaceType.init(GL.gl);
      SpaceType.setMdSelection(sel.value);
      this.refreshSpaceType();
      App._undoSchedule();
      const idx = SpaceType.currentMdIndex();
      const pr = SpaceType.mdSources[idx];
      toast('SPACE TYPE md: ' + (sel.value === 'random' ? 'Random' : (pr && pr.name || '')));
    });
    const scene = $('#stScene');
    if(scene) scene.addEventListener('change', ()=>{
      if(typeof SpaceType === 'undefined') return;
      SpaceType.setScene(scene.value);
      App._undoSchedule();
      toast('SPACE TYPE scene: ' + scene.value);
    });
    const rand = $('#stRandom');
    if(rand) rand.addEventListener('click', ()=>{
      if(typeof SpaceType === 'undefined' || !SpaceType.initialized) return;
      // sceneMode には触らない。以前ここで 'fixed' に書き換えていたため、
      // 🎲 を一度押すと Scene=Random のつもりでもシーン自動切替が止まる罠になっていた。
      SpaceType.randomize((Math.random()*99999)|0);
      this.refreshSpaceType();
      App._undoSchedule();
      toast('SPACE TYPE randomize: ' + SpaceType.P.scene);
    });
  },
  refreshSpaceType(){
    if(typeof SpaceType === 'undefined') return;
    const T = SpaceType, P = T.P;
    const sel = $('#stMdSelect');
    if(sel){
      const list = T.mdSources || [];
      if(sel.dataset.count !== String(list.length)){
        sel.innerHTML = '';
        const any = document.createElement('option');
        any.value = 'random'; any.textContent = 'Random';
        sel.appendChild(any);
        list.forEach((pr, i)=>{
          const opt = document.createElement('option');
          opt.value = String(i);
          opt.textContent = pr.name || ('md ' + (i + 1));
          sel.appendChild(opt);
        });
        sel.dataset.count = String(list.length);
      }
      sel.value = (P.mdMode === 'fixed' && list[P.mdIndex]) ? String(P.mdIndex) : 'random';
    }
    const scene = $('#stScene');
    if(scene){
      if(scene.dataset.built !== '2'){
        scene.innerHTML = '';
        const sv = document.createElement('option');
        sv.value = 'saved'; sv.textContent = 'Saved (mdごとの保存scene)';
        scene.appendChild(sv);
        const any = document.createElement('option');
        any.value = 'random'; any.textContent = 'Random (毎回抽選)';
        scene.appendChild(any);
        for(const s of (T.SCENES || [])){ const o = document.createElement('option'); o.textContent = s; o.value = s; scene.appendChild(o); }
        scene.dataset.built = '2';
      }
      scene.value = (P.sceneMode === 'random') ? 'random' : (P.sceneMode === 'saved') ? 'saved' : P.scene;
      // Saved/Random 中はどのシーンを表示中かが分からないので、選択肢のラベルに現在のシーンを出す
      if(scene.options[0]) scene.options[0].textContent = (P.sceneMode === 'saved') ? ('Saved ▸ ' + P.scene) : 'Saved (mdごとの保存scene)';
      if(scene.options[1]) scene.options[1].textContent = (P.sceneMode === 'random') ? ('Random ▸ ' + P.scene) : 'Random (毎回抽選)';
    }
    const font = $('#stFont');
    if(font){
      if(font.dataset.built !== '1' && T.FONTS){
        font.innerHTML = '';
        for(const f of T.FONTS){ const o = document.createElement('option'); o.value = f.ff; o.textContent = f.name; font.appendChild(o); }
        font.dataset.built = '1';
      }
      font.value = P.fontFamily; if(font.selectedIndex < 0) font.selectedIndex = 0;
      if(!font._stBound){ font._stBound = true;
        font.addEventListener('change', ()=>{ T.setParams({ fontFamily: font.value }); App._undoSchedule(); }); } }
    const bold = $('#stBold');
    if(bold){ bold.checked = !!P.bold; if(!bold._stBound){ bold._stBound = true;
      bold.addEventListener('change', ()=>{ T.setParams({ bold: bold.checked }); App._undoSchedule(); }); } }
    // トグル群 (id, Pキー)
    for(const [id, key] of [['stAutoCycle','autoCycle'],['stCycleReload','cycleReload'],['stCamOrbit','camOrbit'],['stBillboard','billboard'],['stDepthFade','depthFade'],['stTransBg','transparentBg'],['stEmojiColor','emojiColor']]){
      const cb = $('#'+id);
      if(!cb) continue;
      cb.checked = !!P[key];
      if(!cb._stBound){ cb._stBound = true;
        cb.addEventListener('change', ()=>{ T.P[key] = cb.checked; App._undoSchedule(); }); }
    }
    const paper = $('#stPaper');
    if(paper){ paper.value = P.paper; if(!paper._stBound){ paper._stBound = true;
      paper.addEventListener('input', ()=>{ T.setParams({ paper: paper.value }); }); } }
    const ink = $('#stInk');
    if(ink){ ink.value = P.ink; if(!ink._stBound){ ink._stBound = true;
      ink.addEventListener('input', ()=>{ T.setParams({ ink: ink.value }); }); } }
    const accent = $('#stAccent');
    if(accent){ accent.value = P.accent; if(!accent._stBound){ accent._stBound = true;
      accent.addEventListener('input', ()=>{ T.setParams({ accent: accent.value }); }); } }
    const sideCol = $('#stSideColor');
    if(sideCol){ sideCol.value = P.sideColor; if(!sideCol._stBound){ sideCol._stBound = true;
      // ピッカーで色を選んだら専用色モードに。ダブルクリックで既定(縁の色を引き延ばす)へ戻す。
      sideCol.addEventListener('input', ()=>{ T.setParams({ sideColor: sideCol.value, sideColorOn: true }); });
      sideCol.addEventListener('dblclick', ()=>{ T.setParams({ sideColorOn: false }); App._undoSchedule(); toast('押し出し面色: 既定 (文字の縁を引き延ばす)'); }); } }
    // スライダー一覧 (spec から生成)
    const root = $('#stParams'); if(!root) return;
    root.innerHTML = '';
    this._stSliders = [];   // refreshSpaceTypeLive 用の値同期マップ
    const specs = [
      ['Size',       'size',       0.2, 3,  0.05, v=>v.toFixed(2), false],
      ['Density',    'density',    0.2, 3,  0.05, v=>v.toFixed(2), true],
      ['Depth',      'depth',      6, 60,   1,    v=>String(v|0), true],
      ['Wave Amp',   'waveAmp',    0, 5,    0.1,  v=>v.toFixed(1), false],
      ['Wave Freq',  'waveFreq',   0.1, 4,  0.1,  v=>v.toFixed(1), false],
      ['Speed',      'speed',      0, 4,    0.05, v=>v.toFixed(2), false],
      ['Spin',       'spin',       0, 2,    0.02, v=>v.toFixed(2), false],
      ['Jitter',     'jitter',     0, 2,    0.02, v=>v.toFixed(2), false],
      ['Tilt X',     'tiltX',      0, 90,   1,    v=>(v|0)+'°', false],
      ['Tilt Y',     'tiltY',      0, 90,   1,    v=>(v|0)+'°', false],
      ['Roll',       'roll',       0, 90,   1,    v=>(v|0)+'°', false],
      ['Extrude',    'extrude',    0, 100,  1,    v=>(v|0)+'%', false],
      ['Side Shade', 'sideShade',  0, 100,  1,    v=>(v|0)+'%', false],
      ['Fold',       'fold',       0, 100,  1,    v=>(v|0)+'%', false],
      ['Lag (しなり)','lag',       0, 100,  1,    v=>(v|0)+'%', false],
      ['Face Vel',   'faceVel',    0, 100,  1,    v=>(v|0)+'%', false],
      ['Sway',       'swayAmp',    0, 100,  1,    v=>(v|0)+'%', false],
      ['Sway Freq',  'swayFreq',   0.2, 6,  0.1,  v=>v.toFixed(1), false],
      ['Droop',      'droop',      0, 100,  1,    v=>(v|0)+'%', false],
      ['Twist',      'twist',      0, 90,   1,    v=>(v|0)+'°', false],
      ['Radius',     'radius',     0.3, 3,  0.05, v=>v.toFixed(2), false],
      ['Row Gap',    'rowGap',     0.3, 3,  0.05, v=>v.toFixed(2), true],
      ['Tracking',   'tracking',   0.3, 2.5,0.05, v=>v.toFixed(2), true],
      ['Accent %',   'accentRatio',0, 60,   1,    v=>(v|0)+'%', true],
      ['FOV',        'fov',        30, 110, 1,    v=>String(v|0), false],
      ['Distance',   'dist',       4, 40,   0.5,  v=>v.toFixed(1), false],
      ['Cam Elev',   'camEl',     -1.2, 1.2,0.02, v=>v.toFixed(2), false],
      ['Orbit Speed','orbitSpeed', 0, 1,    0.01, v=>v.toFixed(2), false],
      ['Cycle Beats','sceneBeats', 1, 64,   1,    v=>(v|0)+' beat', false],
      ['Beat Pulse', 'beatPulse',  0, 1.5,  0.05, v=>v.toFixed(2), false],
      ['Seed',       'seed',       1, 999,  1,    v=>String(v|0), true],
    ];
    for(const [label,key,mi,ma,step,fmt,rebuild] of specs){
      const row=document.createElement('div'); row.className='row';
      const lab=document.createElement('label'); lab.textContent=label;
      const inp=document.createElement('input'); inp.type='range'; inp.min=mi; inp.max=ma; inp.step=step; inp.value=P[key];
      const val=document.createElement('div'); val.className='val'; val.textContent=fmt(P[key]);
      // SpaceType.P は loadPreset で別オブジェクトへ差し替わることがあるため、
      // クロージャに P を捕まえず毎回 live 参照する (捕まえると死んだ P に書いて効かなくなる)
      inp.addEventListener('input', ()=>{
        const PP = SpaceType.P;
        PP[key]=parseFloat(inp.value); val.textContent=fmt(PP[key]);
        if(rebuild) SpaceType._dirty = true;
      });
      // ダブルクリックでデフォルト値へ戻す
      inp.addEventListener('dblclick', ()=>{
        const PP = SpaceType.P;
        const d = (SpaceType.PDefaults && SpaceType.PDefaults[key] !== undefined) ? SpaceType.PDefaults[key] : parseFloat(inp.min);
        PP[key]=d; inp.value=d; val.textContent=fmt(d);
        if(rebuild) SpaceType._dirty = true;
        App._undoSchedule();
      });
      this._stSliders.push({key, inp, val, fmt});
      row.appendChild(lab); row.appendChild(inp); row.appendChild(val); root.appendChild(row);
    }
  },

  /* 自動サイクルからの軽量同期: セレクト/スウォッチ/スライダー値だけ更新し、DOM を作り直さない。
     (全再構築だと #stParams のスライダーがドラッグ中に消えて操作が切れる) */
  refreshSpaceTypeLive(){
    if(typeof SpaceType === 'undefined') return;
    const P = SpaceType.P;
    const sel = $('#stMdSelect');
    if(sel && sel.dataset.count) sel.value = (P.mdMode === 'fixed' && SpaceType.mdSources[P.mdIndex]) ? String(P.mdIndex) : 'random';
    const scene = $('#stScene');
    if(scene && scene.dataset.built === '2'){
      scene.value = (P.sceneMode === 'random') ? 'random' : (P.sceneMode === 'saved') ? 'saved' : P.scene;
      if(scene.options[0]) scene.options[0].textContent = (P.sceneMode === 'saved') ? ('Saved ▸ ' + P.scene) : 'Saved (mdごとの保存scene)';
      if(scene.options[1]) scene.options[1].textContent = (P.sceneMode === 'random') ? ('Random ▸ ' + P.scene) : 'Random (毎回抽選)';
    }
    const paper = $('#stPaper');  if(paper)  paper.value = P.paper;
    const ink = $('#stInk');      if(ink)    ink.value = P.ink;
    const accent = $('#stAccent');if(accent) accent.value = P.accent;
    const sideCol = $('#stSideColor');if(sideCol) sideCol.value = P.sideColor;
    const font = $('#stFont');
    if(font && font.dataset.built === '1'){ font.value = P.fontFamily; if(font.selectedIndex < 0) font.selectedIndex = 0; }
    const bold = $('#stBold');    if(bold)   bold.checked = !!P.bold;
    for(const s of (this._stSliders || [])){
      if(document.activeElement === s.inp) continue;   // 操作中のスライダーは触らない
      if(P[s.key] === undefined) continue;
      s.inp.value = P[s.key]; s.val.textContent = s.fmt(P[s.key]);
    }
  },

  bindInkelly(){
    if(typeof Inkelly === 'undefined') return;
    const P = Inkelly.P;
    const slid = (id, key, fmt)=>{
      const el = $('#'+id), val = $('#'+id+'Val');
      if(!el) return;
      el.value = P[key]; if(val) val.textContent = fmt(P[key]);
      el.addEventListener('input', ()=>{ P[key] = parseFloat(el.value); if(val) val.textContent = fmt(P[key]); });
    };
    slid('ikSpawnBeats', 'spawnBeats', v=>String(v));
    slid('ikDelay',      'delay',      v=>v.toFixed(1));
    slid('ikSpawnR',     'spawnR',     v=>v.toFixed(2));
    slid('ikSpawnW',     'spawnW',     v=>v.toFixed(3));
    slid('ikSize',       'size',       v=>v.toFixed(2));
    slid('ikSharp',      'sharp',      v=>v.toFixed(2));
    slid('ikCurl',       'curlScale',  v=>v.toFixed(3));
    slid('ikDisplace',   'displace',   v=>v.toFixed(4));
    slid('ikFade',       'fade',       v=>v.toFixed(1));
    slid('ikFlow',       'flow',       v=>v.toFixed(2));
    slid('ikBreathBars', 'breathBars', v=>String(v));
    slid('ikFeather',    'feather',    v=>v.toFixed(3));
    const bs = $('#ikBeatSync');
    if(bs){ bs.checked = !!P.beatSync; bs.addEventListener('change', ()=>{ P.beatSync = bs.checked; }); }
    const bk = $('#ikBlack');
    if(bk){ bk.checked = !!P.black; bk.addEventListener('change', ()=>{ P.black = bk.checked; }); }
    const ah = $('#ikAutoHue');
    if(ah){ ah.checked = !!P.autoHue; ah.addEventListener('change', ()=>{ P.autoHue = ah.checked; }); }
    slid('ikBgHue', 'bgHue', v=>v.toFixed(3));
  },
  refreshInkelly(){
    if(typeof Inkelly === 'undefined') return;
    const P = Inkelly.P;
    const set = (id, v, fmt)=>{ const el=$('#'+id), val=$('#'+id+'Val'); if(el) el.value=v; if(val && fmt) val.textContent=fmt(v); };
    set('ikSpawnBeats', P.spawnBeats, v=>String(v));
    set('ikDelay',      P.delay,      v=>v.toFixed(1));
    set('ikSpawnR',     P.spawnR,     v=>v.toFixed(2));
    set('ikSpawnW',     P.spawnW,     v=>v.toFixed(3));
    set('ikSize',       P.size,       v=>v.toFixed(2));
    set('ikSharp',      P.sharp,      v=>v.toFixed(2));
    set('ikCurl',       P.curlScale,  v=>v.toFixed(3));
    set('ikDisplace',   P.displace,   v=>v.toFixed(4));
    set('ikFade',       P.fade,       v=>v.toFixed(1));
    set('ikFlow',       P.flow,       v=>v.toFixed(2));
    set('ikBreathBars', P.breathBars, v=>String(v));
    set('ikFeather',    P.feather,    v=>v.toFixed(3));
    const bs=$('#ikBeatSync'); if(bs) bs.checked=!!P.beatSync;
    const bk=$('#ikBlack'); if(bk) bk.checked=!!P.black;
    const ah=$('#ikAutoHue'); if(ah) ah.checked=!!P.autoHue;
    set('ikBgHue', P.bgHue||0, v=>v.toFixed(3));
  },
  bindSlicer(){
    if(typeof Slicer === 'undefined') return;
    const S = Slicer.P;
    // ファイル読込
    const bL = $('#btnSlicerLoad'), fL = $('#fileSlicerLoad');
    if(bL && fL){
      bL.addEventListener('click', ()=> fL.click());
      fL.addEventListener('change', e=>{
        const f = e.target.files && e.target.files[0]; if(f){ Slicer.loadFile(f); this.refreshSlicer(); }
        fL.value = '';
      });
    }
    // ライブラリ
    const grid = $('#slicerLibGrid');
    const renderLib = (list)=>{
      if(!grid) return;
      grid.innerHTML = '';
      if(!list.length){
        const msg = document.createElement('div');
        msg.style.cssText = 'grid-column:1/-1;color:var(--dim);font-size:10px;padding:6px';
        msg.textContent = 'images/slicer/ 未検出';
        grid.appendChild(msg);
        return;
      }
      // 左上に Random スロット (md の Random と同じ役割: 画像をランダム表示)
      {
        const rt = document.createElement('div');
        rt.className = 'slRandTile';
        rt.style.cssText = 'position:relative;cursor:pointer;border:1px solid #555;border-radius:3px;overflow:hidden;'
          + 'background:linear-gradient(135deg,#1b1b22,#2a2130);aspect-ratio:1/1;display:flex;align-items:center;'
          + 'justify-content:center;font:600 11px var(--mono);color:#ddd;letter-spacing:0.5px';
        rt.title = '画像をランダム表示 (Img Beats 拍ごとに切替。画像ごとの保存値もそのまま適用)';
        rt.innerHTML = '<span style="text-align:center;line-height:1.5">🎲<br>Random</span>';
        rt.addEventListener('click', ()=>{
          Slicer.P.imgMode = 'random';
          Slicer._imgEpoch = null;
          Slicer.loadRandomImage();
          this.refreshSlicer();
        });
        grid.appendChild(rt);
      }
      for(const it of list){
        const tile = document.createElement('div');
        tile.style.cssText = 'position:relative;cursor:pointer;border:1px solid #333;border-radius:3px;overflow:hidden;background:#000;aspect-ratio:1/1';
        tile.title = it.name;
        tile.setAttribute('data-sl-url', it.url);
        const im = document.createElement('img');
        im.src = it.url;
        im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
        const lbl = document.createElement('div');
        lbl.textContent = it.name.replace(/\.[^.]+$/, '');
        lbl.style.cssText = 'position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,0.65);color:#fff;font-size:9px;padding:2px 4px;text-overflow:ellipsis;overflow:hidden;white-space:nowrap';
        tile.appendChild(im); tile.appendChild(lbl);
        tile.addEventListener('click', ()=>{
          Slicer.P.imgMode = 'fixed';
          Slicer.loadFromUrl(it.url).then(()=> this.refreshSlicer());
        });
        grid.appendChild(tile);
      }
    };
    const rescan = async ()=>{
      const list = await Slicer.scanFolder('images/slicer');
      renderLib(list);
    };
    const rs = $('#btnSlicerRescan');
    if(rs) rs.addEventListener('click', ()=>{ rescan().then(()=> toast(`Slicer lib: ${Slicer.library.length}`)); });
    rescan();

    // パラメータ slider helper
    const slid = (id, key, fmt, rebuild)=>{
      const el = $('#'+id); const val = $('#'+id+'Val');
      if(!el) return;
      el.value = S[key];
      if(val) val.textContent = fmt(S[key]);
      el.addEventListener('input', ()=>{
        S[key] = parseFloat(el.value);
        if(val) val.textContent = fmt(S[key]);
        // Auto のドリフト中心をユーザ操作値へ更新 (でないと次の拍で初期値中心へ戻される)
        if(key === 'explode' || key === 'bend' || key === 'curl') Slicer.noteAutoBase();
        if(rebuild) Slicer.markDirty();
      });
    };
    const fi = v=>String(v|0), f2 = v=>v.toFixed(2), f3 = v=>v.toFixed(3);
    slid('slPieces',   'pieces',  fi, true);
    slid('slSides',    'sides',   fi, true);
    slid('slMaxSides', 'maxSides',fi, true);
    slid('slSeed',     'seed',    fi, true);
    const sr = $('#btnSlSeedRand');
    if(sr) sr.addEventListener('click', ()=>{
      // 🎲 = 表示中の画像のパラメータをランダム化 (画像自体は変えない。
      //      画像のランダム選択はライブラリ左上の Random スロットの役割)
      const R = (a,b)=> a + Math.random()*(b-a);
      S.seed    = Math.floor(Math.random() * 9999);
      S.pieces  = Math.round(R(60, 420));
      S.sides   = Math.round(R(3, 7));
      S.maxSides= Math.random() < 0.35 ? 0 : Math.round(R(Math.max(3, S.sides), 10));
      S.explode = +R(0.6, 4.5).toFixed(2);
      S.bend    = +R(0, 1.8).toFixed(2);
      S.curl    = +R(0, 1.2).toFixed(2);
      if(Math.random() < 0.4){ S.warpAmp = +R(0.05, 0.5).toFixed(2); S.warpFreq = +R(0.5, 4).toFixed(1); }
      else S.warpAmp = 0;
      Slicer.noteAutoBase();
      Slicer.markDirty();
      this.refreshSlicer();
    });
    slid('slExplode',  'explode', f2, true);
    slid('slBend',     'bend',    f2, true);
    slid('slCurl',     'curl',    f2, true);
    slid('slWarpAmp',  'warpAmp', f2, false);   // VS uniform (再構築不要・アニメ)
    slid('slWarpFreq', 'warpFreq',v=>v.toFixed(1), false);
    slid('slAutorot',  'autorot', f2, false);
    const ab = $('#slAutoBeats');
    if(ab){
      ab.value = String(S.autoRebuildBeats);
      ab.addEventListener('change', ()=>{ S.autoRebuildBeats = parseFloat(ab.value); Slicer._autoEpoch = -1; });
    }
    slid('slImgBeats', 'imgBeats', fi, false);
    slid('slAutoZoom', 'autoZoomAmp', f2, false);
    slid('slAutoEl',   'autoElAmp',   f2, false);
    const am = $('#slAutoMode');
    if(am){ am.checked = !!S.autoMode; am.addEventListener('change', ()=>{ S.autoMode = am.checked; Slicer._autoEpoch = -1; }); }
    slid('slCamEl',    'camEl',   f2, false);
    slid('slFov',      'fov',     fi, false);
    slid('slShadowStr','shadowStr',f2, false);
    slid('slShadowRad','shadowRadius', v=>v.toFixed(1), false);
    slid('slShadowBias','shadowBias',  f3, false);
    slid('slPostScale', 'postScale',   f2, false);
    const os = $('#slOverlapShadow');
    if(os){ os.checked = !!S.overlapShadow; os.addEventListener('change', ()=>{ S.overlapShadow = os.checked; }); }
    const bm = $('#slBgMode');
    if(bm){ bm.value = S.bgMode || 'image'; bm.addEventListener('change', ()=>{ S.bgMode = bm.value; }); }
  },

  refreshSlicer(){
    if(typeof Slicer === 'undefined') return;
    const S = Slicer.P;
    const st = $('#slicerStatus');
    if(st){
      const rnd = S.imgMode === 'random' ? '🎲 ' : '';
      if(Slicer.imageReady) st.textContent = `▶ ${rnd}${Slicer.imgW}×${Slicer.imgH}, pieces=${S.pieces}`;
      else st.textContent = 'no image';
    }
    // ライブラリの選択ハイライト (Random スロット / 現在の画像)
    { const grid = $('#slicerLibGrid');
      if(grid){
        const isRand = S.imgMode === 'random';
        [...grid.children].forEach(el=>{
          const on = el.classList.contains('slRandTile') ? isRand
                   : (!isRand && !!Slicer.curName && (el.dataset.slUrl||'').split('/').pop() === encodeURIComponent(Slicer.curName));
          el.style.outline = on ? '2px solid #ff2d9b' : '';
          el.style.outlineOffset = on ? '-2px' : '';
        });
      } }
    const set = (id, v, fmt)=>{
      const el = $('#'+id); const out = $('#'+id+'Val');
      if(el){ if(el.type==='checkbox') el.checked = !!v; else el.value = v; }
      if(out && fmt) out.textContent = fmt(v);
    };
    const fi = v=>String(v|0), f2 = v=>v.toFixed(2), f3 = v=>v.toFixed(3);
    set('slPieces',   S.pieces,   fi);
    set('slSides',    S.sides,    fi);
    set('slMaxSides', S.maxSides, fi);
    set('slSeed',     S.seed,     fi);
    set('slExplode', S.explode, f2);
    set('slBend', S.bend, f2);
    set('slCurl', S.curl, f2);
    set('slAutorot', S.autorot, f2);
    set('slAutoMode', S.autoMode);
    const ab = $('#slAutoBeats'); if(ab) ab.value = String(S.autoRebuildBeats);
    set('slImgBeats', S.imgBeats, fi);
    set('slAutoZoom', S.autoZoomAmp, f2);
    set('slAutoEl',   S.autoElAmp,   f2);
    set('slCamEl', S.camEl, f2);
    set('slFov', S.fov, fi);
    set('slOverlapShadow', S.overlapShadow);
    set('slShadowStr', S.shadowStr, f2);
    set('slShadowRad', S.shadowRadius, v=>v.toFixed(1));
    set('slShadowBias', S.shadowBias, f3);
    set('slPostScale',  S.postScale,  f2);
    const bm = $('#slBgMode'); if(bm) bm.value = S.bgMode || 'image';
  },

	  refreshManga(){
	    if(typeof Manga === 'undefined') return;
    const M = Manga.P;
    const set = (id, v, fmt)=>{
      const el = $('#'+id); const out = $('#'+id+'Val');
      if(el){
        if(el.type === 'checkbox') el.checked = !!v;
        else el.value = v;
      }
      if(out && fmt) out.textContent = fmt(v);
    };
    const f2 = v=>v.toFixed(2), f1 = v=>v.toFixed(1), fi = v=>String(v|0);
    set('mgSpawnMin',   M.spawnMin,      fi);
    set('mgSpawnMax',   M.spawnMax,      fi);
    set('mgJitter',     M.jitterPx,      fi);
    set('mgPnlMin',     M.panelSizeMin,  f2);
    set('mgPnlMax',     M.panelSizeMax,  f2);
    set('mgReset',      M.resetProb,     f2);
    set('mgAuto',       M.autoReset);
    set('mgCamRate',    M.droneCamRate,  f2);
    set('mgZBase',      M.droneZoomBase, f2);
    set('mgZAmp',       M.droneZoomAmp,  f2);
    set('mgZRate',      M.droneZoomRate, f2);
    set('mgBZoom',      M.beatZoom,      f2);
    set('mgInit',       M.initialCount,  fi);
    set('mgPageScale',  M.pageScale,     f1);
    set('mgManualZoom', M.manualZoom,    f2);
    if($('#mgSubdiv')) $('#mgSubdiv').value = String(M.subdiv);
    // Motion mode buttons
    if($('#mgModeDrone')) $('#mgModeDrone').classList.toggle('on', M.motionMode === 'drone');
    if($('#mgModeBeat'))  $('#mgModeBeat').classList.toggle('on',  M.motionMode === 'beat');
    if($('#mgBg')){
      const toHex = arr=>'#'+arr.map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
      $('#mgBg').value = toHex(M.bgColor);
    }
    if($('#mangaStatus')){
      $('#mangaStatus').textContent = Manga.images.length > 0
        ? `${Manga.images.length} images loaded`
        : 'no images';
	    }
	  },

  _fixedTextDeformMdIndex(){
    if(typeof TextDeform === 'undefined') return -1;
    const T = TextDeform;
    const P = T.P || {};
    return (P.mdMode === 'fixed' && T.presets && T.presets[P.mdIndex]) ? P.mdIndex : -1;
  },

  // Ugomeki の md別プリセット保存 (Type Deformer と同じ仕様)
  _fixedUgomekiMdIndex(){
    if(typeof Ugomeki === 'undefined') return -1;
    const P = Ugomeki.P || {};
    return (P.mdMode === 'fixed' && Ugomeki.mdSources && Ugomeki.mdSources[P.mdIndex]) ? P.mdIndex : -1;
  },
  saveUgomekiMdDefault(){
    if(typeof Ugomeki === 'undefined' || !Ugomeki.initialized) return;
    const i = this._fixedUgomekiMdIndex();
    if(i < 0){ toast('保存するmdを選択してください'); return; }
    const ok = Ugomeki.saveMdParams(i);
    this.refreshUgomeki();
    App._undoSchedule();
    const pr = Ugomeki.mdSources[i];
    toast(ok ? ('mdデフォルト保存: ' + (pr && pr.name || 'md')) : '保存に失敗しました');
  },
  resetUgomekiMdDefault(){
    if(typeof Ugomeki === 'undefined' || !Ugomeki.initialized) return;
    const i = this._fixedUgomekiMdIndex();
    if(i < 0){ toast('リセットするmdを選択してください'); return; }
    Ugomeki.loadPreset(i);               // 再読込 = 保存値 (無ければ初期値) へ戻る
    this.refreshUgomeki();
    App._undoSchedule();
    const pr = Ugomeki.mdSources[i];
    toast('mdを保存値へ戻しました: ' + ((pr && pr.name) || 'md'));
  },

  // SpaceType の md別プリセット保存 (Ugomeki と同じ仕様)
  _fixedSpaceTypeMdIndex(){
    if(typeof SpaceType === 'undefined') return -1;
    const P = SpaceType.P || {};
    return (P.mdMode === 'fixed' && SpaceType.mdSources && SpaceType.mdSources[P.mdIndex]) ? P.mdIndex : -1;
  },
  saveSpaceTypeMdDefault(){
    if(typeof SpaceType === 'undefined' || !SpaceType.initialized) return;
    const i = this._fixedSpaceTypeMdIndex();
    if(i < 0){ toast('保存するmdを選択してください'); return; }
    const ok = SpaceType.saveMdParams(i);
    this.refreshSpaceType();
    App._undoSchedule();
    const pr = SpaceType.mdSources[i];
    toast(ok ? 'mdデフォルト保存: ' + (pr && pr.name || 'md') : '保存失敗');
  },
  // リセット: ライブ調整を捨てて「デフォルト保存」した内容へ戻す (保存が無ければ初期値)。
  //   Shift+クリック時のみ保存そのものを削除して初期値へ。
  //   md 未固定(Random)でも、今表示中の md を対象にする。
  resetSpaceTypeMdDefault(){
    if(typeof SpaceType === 'undefined' || !SpaceType.initialized) return;
    const i = this._fixedSpaceTypeMdIndex() >= 0 ? this._fixedSpaceTypeMdIndex() : SpaceType.currentMdIndex();
    if(i < 0){ toast('リセットするmdがありません'); return; }
    const had = SpaceType.hasMdParams(i);
    SpaceType.loadPreset(i);          // 初期値へ戻す → 保存済み md パラメータを再適用
    this.refreshSpaceType();
    App._undoSchedule();
    const pr = SpaceType.mdSources[i], nm = (pr && pr.name) || 'md';
    toast(had ? ('mdを保存値へ戻しました: ' + nm) : ('初期値へリセット(保存なし): ' + nm));
  },

  // ─── Slicer: 画像ごとのデフォルト保存 (md セクションと同じ操作系) ───────
  saveSlicerImgDefault(){
    if(typeof Slicer === 'undefined' || !Slicer.saveImgParams) return;
    if(!Slicer.curName){ toast('images/slicer/ の画像を選択してください'); return; }
    if(Slicer.saveImgParams()){ Slicer.noteAutoBase(); App._undoSchedule(); toast('画像デフォルト保存: ' + Slicer.curName); }
    else toast('保存失敗');
  },
  resetSlicerImgDefault(){
    if(typeof Slicer === 'undefined' || !Slicer.PDefaults) return;
    const name = Slicer.curName;
    const had = name && Slicer.hasImgParams(name);
    for(const k of Object.keys(Slicer.PDefaults)) Slicer.P[k] = Slicer.PDefaults[k];   // 初期値へ
    if(!name || !Slicer._applyImgParams(name)) Slicer.noteAutoBase();                  // 保存があれば再適用
    Slicer.markDirty();
    this.refreshSlicer();
    App._undoSchedule();
    toast(had ? ('画像の保存値へ戻しました: ' + name) : '初期値へリセット(保存なし)');
  },

  // ─── C003: 表示中の md にランダムスタイルを適用 (保存はセクション右上の Save で) ───────
  randomizeTextDeformMd(){
    if(typeof TextDeform === 'undefined' || !TextDeform.updateMdStyle) return;
    const T = TextDeform;
    const i = T.currentMdIndex ? T.currentMdIndex() : -1;
    if(i < 0){ toast('対象のmdがありません'); return; }
    T.updateMdStyle(i, this._randomTextDeformStyle());   // 永続化はしない
    this.refreshTextDeform();
    App._undoSchedule();
    toast('TYPE randomize: ' + ((T.presets && T.presets[i] && T.presets[i].name) || 'md'));
  },
  // TextDeform 用のランダムスタイル生成 (UI スライダーのレンジ内。レイアウト系 zoom/pan/stageW は触らない)
  _randomTextDeformStyle(){
    const R = (a,b)=> a + (b-a)*Math.random();
    const chance = p=> Math.random() < p;
    const hex = (h,s,l)=>{
      const f = (n)=>{ const k=(n + h/30) % 12; const c = l - s*Math.min(l,1-l)*Math.max(-1, Math.min(Math.min(k-3, 9-k), 1)); return Math.round(c*255).toString(16).padStart(2,'0'); };
      return '#' + f(0) + f(8) + f(4);
    };
    const baseH = Math.floor(Math.random()*360);
    const inkH  = (baseH + (chance(0.3) ? 180 : 0)) % 360;
    const accH  = (baseH + 90 + Math.floor(Math.random()*180)) % 360;
    const dark = chance(0.5);
    const over = {
      paper: dark ? hex(baseH, R(0,0.25), R(0.04,0.16)) : hex(baseH, R(0,0.18), R(0.86,0.97)),
      ink:   dark ? hex(inkH,  R(0,0.30), R(0.80,0.96)) : hex(inkH,  R(0,0.35), R(0.05,0.20)),
      accent: hex(accH, R(0.6,0.95), R(0.48,0.62)),
      accentRatio: +R(0, 0.3).toFixed(2),
      vertical: chance(0.35),
      fontSize: Math.round(R(30, 110)),
      lineHeight: +R(0.8, 1.6).toFixed(2),
      letterSpacing: +R(-0.15, 0.15).toFixed(2),
      rotation: chance(0.5) ? +R(0, 14).toFixed(1) : 0,
      randomness: +R(0.4, 1.6).toFixed(2),
      geoRatio: +R(0, 0.8).toFixed(2),
      stretchX: chance(0.4) ? +R(0.6, 2.2).toFixed(2) : 1,
      stretchY: chance(0.4) ? +R(0.6, 2.2).toFixed(2) : 1,
      flipRate: +R(0, 3.5).toFixed(2),
      rotateAngle: chance(0.35) ? Math.round(R(10, 120)) : 0,
      skewX: chance(0.35) ? Math.round(R(-45, 45)) : 0,
      skewY: chance(0.25) ? Math.round(R(-30, 30)) : 0,
      baselineShift: chance(0.3) ? +R(-1.2, 1.2).toFixed(2) : 0,
      mirrorX: chance(0.25) ? +R(0.2, 1).toFixed(2) : 0,
      mirrorY: chance(0.15) ? +R(0.2, 1).toFixed(2) : 0,
      misregX: chance(0.3) ? +R(-20, 20).toFixed(1) : 0,
      misregY: chance(0.2) ? +R(-14, 14).toFixed(1) : 0,
      confuseDepth: chance(0.3) ? +R(0.1, 0.8).toFixed(2) : 0,
      opChance: +R(0.3, 1).toFixed(2),
    };
    if(chance(0.3)) over.misregColorA = hex((accH+180)%360, R(0.6,0.9), R(0.45,0.6));
    if(chance(0.3)) over.misregColorB = hex((accH+300)%360, R(0.6,0.9), R(0.45,0.6));
    // 書体: UI の選択肢から
    const fsel = document.getElementById('tdMdFont');
    if(fsel && fsel.options.length) over.fontFamily = fsel.options[Math.floor(Math.random()*fsel.options.length)].value;
    // グリッド組版はたまに
    if(chance(0.25)){
      over.gridEnabled = true;
      over.gridCols = Math.round(R(4, 24));
      over.gridGap  = chance(0.5) ? Math.round(R(0, 30)) : 0;
    } else over.gridEnabled = false;
    return over;
  },

  saveTextDeformMdDefault(){
    if(typeof TextDeform === 'undefined' || !TextDeform.saveMdDefault) return;
    const T = TextDeform;
    const i = this._fixedTextDeformMdIndex();
    if(i < 0){ toast('保存するmdを選択してください'); return; }
    const over = this._readTextDeformMdControls();
    T.saveMdDefault(i, over);
    this.refreshTextDeform();
    App._undoSchedule();
    const pr = T.presets && T.presets[i];
    toast('mdデフォルト保存: ' + (pr && pr.name || 'md'));
  },

  resetTextDeformMdDefault(){
    if(typeof TextDeform === 'undefined' || !TextDeform.resetMdDefault) return;
    const T = TextDeform;
    const i = this._fixedTextDeformMdIndex();
    if(i < 0){ toast('リセットするmdを選択してください'); return; }
    T.resetMdDefault(i);
    this.refreshTextDeform();
    App._undoSchedule();
    const pr = T.presets && T.presets[i];
    toast('mdを保存値へ戻しました: ' + ((pr && pr.name) || 'md'));
  },

  _readTextDeformMdControls(){
    const over = {};
    const addColor = (id, key)=>{
      const el = $('#'+id);
      if(el && /^#[0-9a-f]{6}$/i.test(el.value)) over[key] = el.value;
    };
    const addNum = (id, key)=>{
      const el = $('#'+id);
      if(!el) return;
      const v = parseFloat(el.value);
      if(Number.isFinite(v)) over[key] = v;
    };
    addColor('tdMdPaper', 'paper');
    addColor('tdMdInk', 'ink');
    addColor('tdMdAccent', 'accent');
    addNum('tdMdAccentRatio', 'accentRatio');
    addNum('tdMdFontSize', 'fontSize');
    addNum('tdMdLineHeight', 'lineHeight');
    addNum('tdMdLetterSpacing', 'letterSpacing');
    addNum('tdMdZoom', 'zoom');
    addNum('tdMdPanX', 'panX');
    addNum('tdMdPanY', 'panY');
    addNum('tdMdStageW', 'stageW');
    addNum('tdMdMarginPct', 'marginPct');
    addNum('tdMdRotation', 'rotation');
    addNum('tdMdRandomness', 'randomness');
    addNum('tdMdGeoRatio', 'geoRatio');
    addNum('tdMdStretchX', 'stretchX');
    addNum('tdMdStretchY', 'stretchY');
    addNum('tdMdFlipRate', 'flipRate');
    addNum('tdMdRotateAngle', 'rotateAngle');
    addNum('tdMdSkewX', 'skewX');
    addNum('tdMdSkewY', 'skewY');
    addNum('tdMdBaselineShift', 'baselineShift');
    addNum('tdMdMirrorX', 'mirrorX');
    addNum('tdMdMirrorY', 'mirrorY');
    addNum('tdMdMisregX', 'misregX');
    addNum('tdMdMisregY', 'misregY');
    addColor('tdMdMisregColorA', 'misregColorA');
    addColor('tdMdMisregColorB', 'misregColorB');
    addNum('tdMdConfuseDepth', 'confuseDepth');
    addNum('tdMdOpChance', 'opChance');
    addNum('tdMdGridCols', 'gridCols');
    addNum('tdMdGridCell', 'gridCell');
    addNum('tdMdGridGap', 'gridGap');
    const gridSel = $('#tdMdGrid');
    if(gridSel) over.gridEnabled = gridSel.value === 'on';
    if(typeof TDComp !== 'undefined') over.comp = TDComp.snapshot();
    const fontSel = $('#tdMdFont');
    if(fontSel) over.fontFamily = fontSel.value;
    const lawSel = $('#tdMdRandomLaw');
    if(lawSel) over.randomLaw = lawSel.value;
    const dirSel = $('#tdMdDirection');
    if(dirSel) over.vertical = dirSel.value === 'vertical';
    const fitSel = $('#tdMdFitMode');
    if(fitSel) over.fitMode = fitSel.value;
    return over;
  },

  refreshTextDeform(){
    if(typeof TextDeform === 'undefined') return;
    const T = TextDeform;
    const P = T.P || {};
    const sel = $('#tdMdSelect');
    if(sel){
      const count = T.presets ? T.presets.length : 0;
      if(sel.dataset.count !== String(count)){
        const cur = sel.value;
        sel.innerHTML = '';
        const any = document.createElement('option');
        any.value = 'random';
        any.textContent = 'Random';
        sel.appendChild(any);
        (T.presets || []).forEach((pr, i)=>{
          const opt = document.createElement('option');
          opt.value = String(i);
          opt.textContent = pr.name || ('md ' + (i + 1));
          sel.appendChild(opt);
        });
        sel.dataset.count = String(count);
        if(cur) sel.value = cur;
      }
      sel.value = (P.mdMode === 'fixed' && T.presets && T.presets[P.mdIndex]) ? String(P.mdIndex) : 'random';
    }
    const fixed = !!(P.mdMode === 'fixed' && T.presets && T.presets[P.mdIndex]);
    const idx = fixed ? P.mdIndex : (T.currentMdIndex ? T.currentMdIndex() : -1);
    const pr = (T.presets && idx >= 0) ? T.presets[idx] : null;
    const pp = (pr && pr.p) || {};
    const valFor = (key, fallback)=> pp[key] !== undefined ? pp[key] : (P[key] !== undefined ? P[key] : fallback);
    const colorFor = (key, fallback)=>{
      const v = String(valFor(key, fallback) || '');
      return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
    };
    const setColor = (id, valId, key, fallback)=>{
      const v = colorFor(key, fallback);
      const el = $('#'+id), out = $('#'+valId);
      if(el){
        el.value = v;
        el.disabled = !fixed;
        el.dataset.default = v;
      }
      if(out) out.textContent = fixed ? v : 'Random';
    };
    const setRange = (id, valId, key, fallback, fmt)=>{
      const raw = parseFloat(valFor(key, fallback));
      const v = Number.isFinite(raw) ? raw : fallback;
      const el = $('#'+id), out = $('#'+valId);
      if(el){
        el.value = String(v);
        el.disabled = !fixed;
        el.dataset.default = String(v);
      }
      if(out) out.textContent = fixed ? fmt(v) : 'Random';
    };
    setColor('tdMdPaper', 'tdMdPaperVal', 'paper', '#050507');
    setColor('tdMdInk', 'tdMdInkVal', 'ink', '#e8fff5');
    setColor('tdMdAccent', 'tdMdAccentVal', 'accent', '#ff2b6d');
    setRange('tdMdAccentRatio', 'tdMdAccentRatioVal', 'accentRatio', 0.06, v=>Math.round(v * 100) + '%');
    setRange('tdMdFontSize', 'tdMdFontSizeVal', 'fontSize', 60, v=>String(Math.round(v)));
    setRange('tdMdLineHeight', 'tdMdLineHeightVal', 'lineHeight', 1.15, v=>v.toFixed(2));
    setRange('tdMdLetterSpacing', 'tdMdLetterSpacingVal', 'letterSpacing', -0.02, v=>v.toFixed(2));
    setRange('tdMdZoom', 'tdMdZoomVal', 'zoom', 1, v=>v.toFixed(2));
    setRange('tdMdPanX', 'tdMdPanXVal', 'panX', 0, v=>v.toFixed(2));
    setRange('tdMdPanY', 'tdMdPanYVal', 'panY', 0, v=>v.toFixed(2));
    setRange('tdMdStageW', 'tdMdStageWVal', 'stageW', 960, v=>String(Math.round(v)));
    setRange('tdMdMarginPct', 'tdMdMarginPctVal', 'marginPct', 8, v=>String(Math.round(v)));
    const dirSel = $('#tdMdDirection');
    if(dirSel){
      dirSel.value = valFor('vertical', false) ? 'vertical' : 'horizontal';
      dirSel.disabled = !fixed;
    }
    const fitSel = $('#tdMdFitMode');
    if(fitSel){
      const fitMode = String(valFor('fitMode', 'fit'));
      fitSel.value = Array.from(fitSel.options).some(o => o.value === fitMode) ? fitMode : 'fit';
      fitSel.disabled = !fixed;
    }
    setRange('tdMdRotation', 'tdMdRotationVal', 'rotation', 0, v=>v.toFixed(1).replace(/\.0$/, '') + 'deg');
    setRange('tdMdRandomness', 'tdMdRandomnessVal', 'randomness', 1, v=>v.toFixed(2));
    setRange('tdMdGeoRatio', 'tdMdGeoRatioVal', 'geoRatio', 0.32, v=>Math.round(v * 100) + '%');
    setRange('tdMdStretchX', 'tdMdStretchXVal', 'stretchX', 1, v=>v.toFixed(2));
    setRange('tdMdStretchY', 'tdMdStretchYVal', 'stretchY', 1, v=>v.toFixed(2));
    setRange('tdMdFlipRate', 'tdMdFlipRateVal', 'flipRate', 1.4, v=>v.toFixed(2));
    setRange('tdMdRotateAngle', 'tdMdRotateAngleVal', 'rotateAngle', 0, v=>Math.round(v) + 'deg');
    setRange('tdMdSkewX', 'tdMdSkewXVal', 'skewX', 0, v=>Math.round(v) + 'deg');
    setRange('tdMdSkewY', 'tdMdSkewYVal', 'skewY', 0, v=>Math.round(v) + 'deg');
    setRange('tdMdBaselineShift', 'tdMdBaselineShiftVal', 'baselineShift', 0, v=>v.toFixed(2));
    setRange('tdMdMirrorX', 'tdMdMirrorXVal', 'mirrorX', 0, v=>Math.round(v * 100) + '%');
    setRange('tdMdMirrorY', 'tdMdMirrorYVal', 'mirrorY', 0, v=>Math.round(v * 100) + '%');
    setRange('tdMdMisregX', 'tdMdMisregXVal', 'misregX', 0, v=>v.toFixed(1).replace(/\.0$/, '') + 'px');
    setRange('tdMdMisregY', 'tdMdMisregYVal', 'misregY', 0, v=>v.toFixed(1).replace(/\.0$/, '') + 'px');
    setColor('tdMdMisregColorA', 'tdMdMisregColorAVal', 'misregColorA', '#c41f1f');
    setColor('tdMdMisregColorB', 'tdMdMisregColorBVal', 'misregColorB', '#1767a6');
    setRange('tdMdConfuseDepth', 'tdMdConfuseDepthVal', 'confuseDepth', 0, v=>Math.round(v * 100) + '%');
    setRange('tdMdOpChance', 'tdMdOpChanceVal', 'opChance', 0.6, v=>Math.round(v * 100) + '%');
    const gridSel = $('#tdMdGrid');
    if(gridSel){
      gridSel.value = valFor('gridEnabled', false) ? 'on' : 'off';
      gridSel.disabled = !fixed;
    }
    setRange('tdMdGridCols', 'tdMdGridColsVal', 'gridCols', 12, v=>String(Math.round(v)));
    setRange('tdMdGridCell', 'tdMdGridCellVal', 'gridCell', 0, v=>v > 0 ? String(Math.round(v)) : 'Auto');
    setRange('tdMdGridGap', 'tdMdGridGapVal', 'gridGap', 0, v=>String(Math.round(v)));
    const lawSel = $('#tdMdRandomLaw');
    if(lawSel){
      const law = String(valFor('randomLaw', 'scatter'));
      lawSel.value = Array.from(lawSel.options).some(o => o.value === law) ? law : 'scatter';
      lawSel.disabled = !fixed;
    }
    const fontSel = $('#tdMdFont');
    if(fontSel){
      const font = pp.fontFamily || P.fontFamily || fontSel.options[0].value;
      if(!Array.from(fontSel.options).some(o => o.value === font)){
        const opt = document.createElement('option');
        opt.value = font;
        opt.textContent = font.replace(/"/g, '').split(',')[0];
        fontSel.appendChild(opt);
      }
      fontSel.value = font;
      fontSel.disabled = !fixed;
    }
    const saveBtn = $('#tdMdSaveDefault');
    const resetBtn = $('#tdMdResetDefault');
    if(saveBtn) saveBtn.disabled = !fixed;
    if(resetBtn) resetBtn.disabled = !fixed;
    // Composition Engine v6 (md 単位 — 他の md コントロール同様、固定 md 選択時のみ編集可)
    if(typeof TDComp !== 'undefined'){
      const c = TDComp.get();
      const compSel = $('#tdCompType');
      if(compSel){ compSel.value = c.enabled ? c.type : 'off'; compSel.disabled = !fixed; }
      const reseedBtn = $('#tdCompReseed');
      if(reseedBtn) reseedBtn.disabled = !fixed;
      const setComp = (id, valId, v, fmt)=>{
        const el = $('#'+id), out = $('#'+valId);
        if(el){ el.value = String(v); el.disabled = !fixed; }
        if(out) out.textContent = fmt(v);
      };
      const pct = v=>Math.round(v * 100) + '%';
      const offPct = v=>v > 0 ? pct(v) : 'Off';
      setComp('tdCompSpeed', 'tdCompSpeedVal', c.speed, v=>v.toFixed(2));
      setComp('tdCompIntensity', 'tdCompIntensityVal', c.macros.intensity, pct);
      setComp('tdCompDensity', 'tdCompDensityVal', c.macros.density, pct);
      setComp('tdCompInstability', 'tdCompInstabilityVal', c.macros.instability, pct);
      setComp('tdCompDepth', 'tdCompDepthVal', c.macros.depth, pct);
      setComp('tdCompLegibility', 'tdCompLegibilityVal', c.macros.legibility, pct);
      setComp('tdCompEcho', 'tdCompEchoVal', c.fxRack.echo.enabled ? c.fxRack.echo.amount : 0, offPct);
      setComp('tdCompFeedback', 'tdCompFeedbackVal', c.fxRack.feedback.enabled ? c.fxRack.feedback.amount : 0, offPct);
      setComp('tdCompChroma', 'tdCompChromaVal', c.fxRack.chromaticSplit.enabled ? c.fxRack.chromaticSplit.amount : 0, offPct);
      setComp('tdCompRaster', 'tdCompRasterVal', c.fxRack.rasterMaterial.enabled ? c.fxRack.rasterMaterial.amount : 0, offPct);
    }
  },

  refreshAll(){
    this.refreshMidiRelative();
    this.refreshAudioTransport();
    this.refreshSlot();
    this.refreshMix();
    this.refreshBPM();
    this.refreshInputs();
    this.refreshActiveThumb();
    this.refreshPresetLib();
  },

  refreshChannels(){
    const slot = GL.slots[App.activeSlot];
    const root = $('#chans'); if(!root) return; root.innerHTML='';
    const sources = [
      {id:'', label:'— なし —', kind:'empty'},
      {id:'__audio__', label:'Audio FFT', kind:'audio'},
      {id:'__feedback__', label:'Feedback (前フレーム)', kind:'feedback'},
      {id:'__slotA__', label:'Slot A output', kind:'slot'},
      {id:'__slotB__', label:'Slot B output', kind:'slot'},
      ...Inputs.list().map(e=>({id:e.id, label:`${e.label} (${e.kind})`, kind:e.kind}))
    ];
    for(let i=0;i<4;i++){
      const row = document.createElement('div'); row.className='ch';
      const th = document.createElement('div'); th.className='thumb'; th.textContent='ch'+i;
      const cur = slot.channels[i];
      const entry = cur ? sources.find(s=>s.id===cur) : null;
      if(entry){
        if(entry.id.startsWith('__')) th.textContent = entry.label.split(' ')[0];
        else {
          const e = Inputs.byId(entry.id);
          if(e && e.img){ const img=document.createElement('img'); img.src=e.img.src; th.innerHTML=''; th.appendChild(img); }
          else if(e && e.video){ const v=document.createElement('video'); v.srcObject=e.video.srcObject||null; if(!v.srcObject) v.src=e.video.src; v.muted=true; v.autoplay=true; v.playsInline=true; th.innerHTML=''; th.appendChild(v); }
          else th.textContent = entry.label;
        }
      }
      const cfg = document.createElement('div'); cfg.className='cfg';
      const top = document.createElement('div'); top.className='top';
      const sel = document.createElement('select');
      for(const s of sources){
        const o = document.createElement('option'); o.value=s.id; o.textContent=s.label;
        if((cur||'')===s.id) o.selected=true;
        sel.appendChild(o);
      }
      sel.addEventListener('change',()=>{ slot.channels[i] = sel.value || null; this.refreshChannels(); });
      top.appendChild(sel);
      const nameLab = document.createElement('div'); nameLab.className='name'; nameLab.textContent = `iChannel${i}`;
      cfg.appendChild(top); cfg.appendChild(nameLab);
      row.appendChild(th); row.appendChild(cfg);
      root.appendChild(row);
    }
  },

  refreshInputs(){
    const root = $('#inputList'); if(!root) return;
    root.innerHTML='';
    for(const e of Inputs.list()){
      const r = document.createElement('div'); r.className='ch';
      const th = document.createElement('div'); th.className='thumb';
      if(e.img){ const i=document.createElement('img'); i.src=e.img.src; th.appendChild(i); }
      else if(e.video){ th.textContent = e.kind; }
      else th.textContent = e.kind;
      const cfg = document.createElement('div'); cfg.className='cfg';
      const top = document.createElement('div'); top.className='top';
      const lab = document.createElement('div'); lab.className='name'; lab.textContent = e.label;
      const del = document.createElement('button'); del.textContent='×'; del.addEventListener('click',()=>Inputs.remove(e.id));
      top.appendChild(lab); top.appendChild(del);
      cfg.appendChild(top);
      r.appendChild(th); r.appendChild(cfg);
      root.appendChild(r);
    }
    this.refreshChannels();
  },

  refreshParams(){
    const slot = GL.slots[App.activeSlot];
    const root = $('#params'); if(!root) return; root.innerHTML='';
    const sec = $('#shaderParamsSec');
    const pill = $('#paramsSlotPill'); if(pill) pill.textContent = App.activeSlot;
    // シェーダ(kind='shader' or 未設定) かつ @param があるときだけ表示。
    //   モード/エンジン系(none/layer/video 等)は旧 params が残っていても非表示にする。
    const isShaderKind = (!slot.kind || slot.kind === 'shader');
    if(!isShaderKind || !slot.params || !slot.params.length){
      if(sec) sec.style.display = 'none';
      return;
    }
    if(sec) sec.style.display = '';
    for(const p of slot.params){
      const row = document.createElement('div'); row.className='par';
      const lab = document.createElement('label'); lab.textContent = p.name;
      row.appendChild(lab);
      if(p.type==='float'){
        const r = document.createElement('input'); r.type='range'; r.min=p.min; r.max=p.max;
        r.step = (p.max-p.min) / 1000;
        r.value = p.value;
        r.dataset.default = String(p.defaultValue ?? p.value);
        // 生値を保存 (デッドゾーンは描画時 deadParam)。パラメータ欄は |値|<0.1 を "0.0" 表示。
        const pf3 = x=>(+x).toFixed(3);
        const pdisp = (v)=> App.effDisplay(v, pf3);
        r.addEventListener('input',()=>{ p.value = parseFloat(r.value); val.textContent = pdisp(p.value); });
        row.appendChild(r);
        const val = document.createElement('div'); val.className='val'; val.textContent = pdisp(p.value);
        row.appendChild(val);
        p._uiRange = r; p._uiVal = val; p._uiDisp = pdisp;
      } else if(p.type==='bool'){
        const c = document.createElement('input'); c.type='checkbox'; c.checked = p.value>0.5;
        c.style.cssText = 'width:16px;height:16px;accent-color:var(--acc);cursor:pointer';
        const val = document.createElement('div'); val.className='val';
        const sync = ()=>{ val.textContent = c.checked ? 'ON' : 'OFF'; };
        c.addEventListener('change',()=>{ p.value = c.checked?1:0; sync(); });
        sync();
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;align-items:center';
        wrap.appendChild(c);
        row.appendChild(wrap);
        row.appendChild(val);
        p._uiBox = c; p._uiVal = val;
      } else if(p.type==='color'){
        const col = document.createElement('input'); col.type='color';
        const toHex = arr=>'#'+arr.map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
        col.value = toHex(p.value);
        col.dataset.default = toHex(p.defaultValue || p.value);
        col.addEventListener('input',()=>{
          const v = col.value;
          p.value = [parseInt(v.slice(1,3),16)/255, parseInt(v.slice(3,5),16)/255, parseInt(v.slice(5,7),16)/255];
        });
        row.appendChild(col);
        const val = document.createElement('div'); val.className='val'; val.textContent = '';
        row.appendChild(val);
      }
      // midi badge
      const key = App.activeSlot+':'+p.name;
      if(p._uiRange) p._uiRange.dataset.midiKey = key;   // スライダー右クリックでも MIDI Learn
      const badge = document.createElement('div'); badge.className='midi'; badge.title='MIDI Learn';
      const m = MIDI.map[key];
      badge.textContent = m ? `CC${m.cc}` : 'MIDI';
      badge.addEventListener('click',()=>{
        if(MIDI.map[key]){ delete MIDI.map[key]; MIDI.saveMap(); this.refreshParams(); return; }
        MIDI.learn = key; badge.classList.add('learn'); badge.textContent='…';
        toast(`MIDI Learn → ${p.name}: CCを動かして`);
      });
      row.appendChild(badge);
      root.appendChild(row);
    }
  },
  updateParamUI(slotKey, p){
    if(slotKey!==App.activeSlot) return;
    if(p._uiRange) p._uiRange.value = p.value;
    if(p._uiVal) p._uiVal.textContent = p._uiDisp ? p._uiDisp(p.value) : (+p.value).toFixed(3);
    if(p._uiBox) p._uiBox.checked = p.value>0.5;
  },

  refreshMix(updateSlider=true){
    if(updateSlider) $('#cf').value = App.crossfade;
    $('#cfVal').textContent = App.crossfade.toFixed(2);
    const cb = $('#cfBlend'); if(cb) cb.value = App.blendMode;
    const ca = $('#cfAuto'); if(ca) ca.checked = !!(App.autoCF && App.autoCF.on);
    const cab = $('#cfBeats'); if(cab) cab.value = String((App.autoCF && App.autoCF.beats) || 8);
    const cam = $('#cfAutoMode'); if(cam) cam.value = (App.autoCF && App.autoCF.mode) || 'crossfade';
    const tb = $('#mixTransBeats'); if(tb) tb.value = String(App.transBeats || 0);
    const tsy = $('#transStyle'); if(tsy) tsy.value = String(App.transStyle || 0);
    const pfd = $('#transParamFade'); if(pfd) pfd.value = String(App.paramFadeBeats || 0);
    const pfs = $('#transParamFadeScope'); if(pfs) pfs.value = App.paramFadeScope || 'all';
    // A 固定(ベース) を青背景にする。Mix 値で入れ替わらない。
    const shown = 'A';
    $$('#slotSel button').forEach(b=>b.classList.toggle('shown', b.dataset.slot === shown));
    // 下段 Slot A/B プレビューの editing 枠も再評価
    $$('.slotPrev').forEach(tile=>tile.classList.toggle('editing', tile.dataset.slot === App.activeSlot));
    this.refreshSlotVisibility();
  },

  refreshBPM(){
    $('#bpmInput').value = BPM.bpm.toFixed(1);
    $('#bpmBig').textContent = BPM.bpm.toFixed(1);
    const target=$('#bpmTarget'); if(target) target.value=BPM.target||'auto';
  },

  // プリセットライブラリ一覧を描画 (先頭10件に 1〜0 キーラベル / 追加・削除・名前編集)
  // プリセット保存履歴のダイアログ。世代を選ぶと「今は無いプリセット」だけを足して復元する。
  async showPresetHistory(){
    let pop = document.getElementById('presetHistPop');
    if(pop) pop.remove();
    pop = document.createElement('div');
    pop.id = 'presetHistPop';
    pop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:9999;display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--panel,#191b22);border:1px solid var(--line,#333);border-radius:8px;padding:14px 16px;max-height:76vh;width:min(560px,92vw);overflow:auto;font:12px var(--mono,monospace);color:var(--fg,#ddd)';
    box.innerHTML = '<div style="font-weight:700;margin-bottom:4px">プリセット保存履歴</div>'
      + '<div style="color:var(--dim,#888);font-size:10px;margin-bottom:10px">保存のたびにサーバーへ残る世代です。選ぶと「今の一覧に無いプリセット」だけを追加で復元します(既存は消えません)。サムネは復元後に再生成されます。</div>'
      + '<div id="presetHistList">読み込み中…</div>';
    pop.appendChild(box);
    document.body.appendChild(pop);
    const close = ()=>pop.remove();
    pop.addEventListener('mousedown', e=>{ if(e.target === pop) close(); });
    document.addEventListener('keydown', function esc(e){ if(e.key === 'Escape'){ close(); document.removeEventListener('keydown', esc); } });

    const list = await App.presetHistoryList();
    const cur = App._loadPresetLib() || [];
    const el = box.querySelector('#presetHistList');
    if(!list.length){
      el.innerHTML = '<div style="color:var(--dim,#888)">まだ履歴がありません。<br>この機能を入れた後の保存から記録されます。</div>';
      return;
    }
    el.innerHTML = '';
    for(const h of list){
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 4px;border-bottom:1px solid var(--line,#2a2d36)';
      // ファイル名の 20260726-101530Z → 2026-07-26 10:15:30 UTC
      const m = /(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(h.time || '');
      const when = m ? (m[1]+'-'+m[2]+'-'+m[3]+' '+m[4]+':'+m[5]+':'+m[6]+' UTC') : (h.time || h.file);
      const diff = h.count - cur.length;
      const info = document.createElement('div');
      info.style.cssText = 'flex:1';
      info.innerHTML = '<div>' + when + '</div><div style="color:var(--dim,#888);font-size:10px">'
        + h.count + ' 件' + (diff > 0 ? ('　(今より +' + diff + ')') : '') + '</div>';
      const btn = document.createElement('button');
      btn.textContent = 'この世代から復元';
      btn.style.cssText = 'font-size:10px;padding:3px 8px';
      btn.addEventListener('click', async ()=>{ btn.disabled = true; btn.textContent = '復元中…'; await App.presetHistoryRestore(h.file); close(); });
      row.appendChild(info); row.appendChild(btn);
      el.appendChild(row);
    }
  },
  refreshPresetLib(){
    const wrap = $('#presetList'); if(!wrap) return;
    const lib = App._loadPresetLib();
    { const pc = $('#presetCount'); if(pc) pc.textContent = String(lib.length); }
    wrap.innerHTML = '';
    // 固定 Preset 0 のタイルは非表示 (同じ操作は Esc キーで行う)。
    // presetBlankBoth() 自体は 0 キー等から呼ばれるので残す。
    if(!lib.length){
      const empty = document.createElement('div');
      empty.className = 'help'; empty.style.cssText = 'font-size:10px;padding:6px 2px;grid-column:1/-1';
      empty.textContent = 'プリセットがありません。「+ 現在を保存」で追加してください。';
      wrap.appendChild(empty);
      return;
    }
    // プリセット状態の代表スロット (表示寄り→A→B) を取り出す
    const repr = (st)=>{
      if(!st || !st.slots) return null;
      const shown = (typeof st.crossfade === 'number' && st.crossfade >= 0.5) ? 'B' : 'A';
      const ks = [shown, 'A', 'B'];
      for(const s of ks){ const sl = st.slots[s]; if(sl && (sl.presetName || sl.video)) return sl; }
      return null;
    };
    // 動画スロット → その動画自身のサムネ URL (movies/thumbs/<name>.jpg)
    const videoThumb = (sl)=>{
      if(!sl || !sl.video) return null;
      const src = sl.video.src || '', name = sl.video.name || '';
      if(/\.(mp4|webm|mov|m4v|ogv)$/i.test(src)) return src.replace(/([^/]+)\.[^.]+$/, 'thumbs/$1.jpg');
      if(name) return 'movies/thumbs/' + name.replace(/\.[^.]+$/, '') + '.jpg';
      return null;
    };
    this._presetThumbs = [];
    lib.forEach((p, i) => {
      const tile = document.createElement('div');
      tile.className = 'thumb-tile';
      tile.title = 'クリック=呼出 / Shift+クリック=上書き保存';
      const r = repr(p.state);
      const isShaderPreset = !!(r && r.src && (!r.kind || r.kind === 'shader'));
      const isVideo = !!(r && r.kind === 'video' && r.video);
      tile.dataset.cat = isVideo ? 'movie' : (isShaderPreset ? 'shader' : 'mode');   // Visual と同じカテゴリ分け
      const ph = document.createElement('div');
      ph.className = 'placeholder';
      ph.style.fontSize = '9px'; ph.style.padding = '2px'; ph.style.textAlign = 'center'; ph.style.whiteSpace = 'pre';
      tile.appendChild(ph);
      const entry = { canvas: null, ph, shaderName: null, srcIdx: -1, drawn: false, isVideo, _state: p.state, hover: false };
      const showImg = (url)=>{
        if(!url) return;
        const img = document.createElement('img');
        img.style.cssText = 'width:100%;height:100%;display:block;object-fit:cover';
        img.onload = ()=>{ if(ph.parentNode) ph.remove(); };
        img.onerror = ()=>{ img.remove(); };
        img.src = url;
        tile.appendChild(img);
      };
      if(p.thumb && /^data:image\/gif/.test(p.thumb)){
        // GIF サムネ: 通常静止/ホバーでアニメ
        ph.textContent = (r && r.presetName) || ((r && r.kind) ? r.kind.toUpperCase() : '');
        UI._gifStillHover(tile, ph, p.thumb);
        entry.drawn = true; entry.isGif = true;
      } else if(isShaderPreset){
        // シェーダプリセット: 静止=スナップショット(合成+post FX) or Shader タブのサムネ流用 / ホバー=合成ライブ
        const cv = document.createElement('canvas');
        cv.width = Preview.W; cv.height = Preview.H;
        tile.appendChild(cv);
        const nm = r && r.presetName;
        ph.textContent = nm || (p.state ? '∅' : '空');
        entry.canvas = cv;
        entry.shaderName = nm || null;
        entry.srcIdx = nm ? PRESETS.findIndex(pp => pp.name === nm) : -1;
        if(p.thumb){
          const im = new Image();
          im.onload = ()=>{ try{ cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); }catch(e){} entry.drawn = true; if(ph.parentNode) ph.remove(); };
          im.src = p.thumb;
        }
      } else if(p.thumb){
        // 非シェーダ mode: 保存済みの実出力スナップショット (全mode対応)
        ph.textContent = (r && r.kind) ? r.kind.toUpperCase() : '…';
        showImg(p.thumb);
      } else if(isVideo){
        // 動画(スナップショット未取得): 動画固有のサムネ
        ph.textContent = r.video.name || 'VIDEO';
        showImg(videoThumb(r));
      } else {
        // スナップショット未取得の mode: 呼び出すと描画後に自動でサムネ生成される
        ph.textContent = ((r && r.kind) ? r.kind.toUpperCase()+'\n' : '') + '(呼出でサムネ生成)';
      }
      this._presetThumbs.push(entry);
      // プリセット名ラベル(P001〜)/ キー
      const psid = 'P' + String(i+1).padStart(3, '0');
      const lbl = document.createElement('div'); lbl.className = 'label'; lbl.textContent = psid + ' ' + (p.name || ('Preset '+(i+1)));
      tile.appendChild(lbl);
      const key = (i < 9) ? String(i+1) : '';   // 数字キーはGrad Preset用。全体Presetはクリックで呼出
      if(key){ const k = document.createElement('div'); k.className = 'key'; k.textContent = key; tile.appendChild(k); }
      // 削除 / 名前変更 (左上の小ボタン)
      const mkBtn = (txt, col, left, title, fn)=>{
        const b = document.createElement('div'); b.textContent = txt; b.title = title;
        b.style.cssText = 'position:absolute;top:2px;left:'+left+'px;font:10px/1 var(--mono);background:rgba(0,0,0,.72);color:'+col+';padding:2px 5px;border-radius:3px;cursor:pointer;z-index:3';
        b.addEventListener('click', e=>{ e.stopPropagation(); fn(); });
        tile.appendChild(b);
      };
      mkBtn('×', '#f88', 3, '削除', ()=>App.presetDelete(i));
      mkBtn('✎', '#ccd', 24, '名前変更', ()=>{ App._prompt('プリセット名', p.name || ('Preset '+(i+1)), (nn)=>{ App.presetRename(i, nn); UI.refreshPresetLib(); }); });
      mkBtn('⟳', '#9be', 44, '現在の状態で上書き保存(更新)', ()=>App.presetOverwrite(i, p.name));
      tile.addEventListener('click', e=>{ if(e.shiftKey) App.presetOverwrite(i, p.name); else App.presetApply(i); });
      // ホバー = 毎フレーム優先描画 (シェーダプリセットは常時ラウンドロビンでアニメ。animatePresetThumbs)
      tile.addEventListener('mouseenter', ()=>{ entry.hover = true; });
      tile.addEventListener('mouseleave', ()=>{ entry.hover = false; });
      // ドラッグで並べ替え (Preset 0 は固定・対象外)
      tile.draggable = true;
      tile.addEventListener('dragstart', e=>{ UI._dragFrom = i; tile.style.opacity = '0.4'; try{ e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }catch(_){} });
      tile.addEventListener('dragend', ()=>{ tile.style.opacity = ''; UI._clearPrDrop(); UI._dragFrom = null; });
      tile.addEventListener('dragover', e=>{
        if(UI._dragFrom == null || UI._dragFrom === i) return;
        e.preventDefault(); try{ e.dataTransfer.dropEffect = 'move'; }catch(_){}
        const rect = tile.getBoundingClientRect();
        const before = (e.clientX - rect.left) < rect.width / 2;   // 左半分=手前へ / 右半分=後ろへ
        UI._clearPrDrop();
        tile.style.boxShadow = (before ? '-3px 0 0 0 ' : '3px 0 0 0 ') + '#ff2d9b';
        UI._prDropTile = tile; UI._prDropBefore = before;
      });
      tile.addEventListener('drop', e=>{
        e.preventDefault();
        const before = UI._prDropBefore; UI._clearPrDrop();
        const from = UI._dragFrom; UI._dragFrom = null;
        if(from != null && from !== i) App.presetReorder(from, i, before);
      });
      wrap.appendChild(tile);
    });
    this.applyPresetFilter();     // 検索/カテゴリの絞り込みを再適用
    this.repaintPresetThumbs();   // 既に描画済みのサムネを即反映
  },

  // Preset タブ: 検索ボックス + カテゴリ(タグ)ボタンで一覧を絞り込む (Visual と同仕様)
  applyPresetFilter(){
    const inp = $('#presetSearch');
    const q = (inp ? inp.value : '').toLowerCase().trim();
    const onBtn = document.querySelector('.preFilter.on');
    const cat = onBtn ? onBtn.dataset.cat : 'all';
    $$('#presetList .thumb-tile').forEach(t=>{
      const name = ((t.querySelector('.label')||{}).textContent || t.title || '').toLowerCase();
      const okQ = !q || name.includes(q);
      const okCat = (cat === 'all') || (t.dataset.cat === cat);
      t.style.display = (okQ && okCat) ? '' : 'none';
    });
  },
  // Shader タブの描画済みサムネ canvas を Preset タイルへコピー (通常は一度 / ホバー中は毎フレーム=ライブ)
  repaintPresetThumbs(){
    const arr = this._presetThumbs; if(!arr || !arr.length) return;
    const pane = document.querySelector('.pane[data-pane="preset"]');
    if(!pane || !pane.classList.contains('on')) return;     // Preset タブ表示中のみ
    const src = this.thumbCanvases; if(!src) return;
    for(const t of arr){
      if(!t.canvas) continue;                               // 動画タイルは img なのでスキップ
      if(t.drawn) continue;                                 // 静的サムネは一度だけコピー (ホバーは別途インターバル)
      if(t.srcIdx < 0 && t.shaderName) t.srcIdx = PRESETS.findIndex(pp => pp.name === t.shaderName);  // 遅延解決
      if(t.srcIdx < 0) continue;
      const s = src[t.srcIdx];
      if(!s || !s.__hasThumb) continue;
      try{ t.canvas.getContext('2d').drawImage(s, 0, 0, t.canvas.width, t.canvas.height); t.drawn = true; if(t.ph && t.ph.parentNode) t.ph.remove(); }catch(e){}
    }
  },
  // シェーダプリセットのタイルを常時アニメ (gif 風)。ホバー優先 / それ以外はラウンドロビン1枚/フレーム。
  _presetAnimI: 0,
  animatePresetThumbs(){
    const arr = this._presetThumbs; if(!arr || !arr.length) return;
    const pane = document.querySelector('.pane[data-pane="preset"]');
    if(!pane || !pane.classList.contains('on')) return;     // Preset タブ表示中のみ
    const render = (t)=>{
      if(!t || !t.canvas || !t._state) return false;
      if(!Preview.renderPreset(t._state)) return false;     // 非シェーダ(動画/mode)は false → 静止のまま
      try{ t.canvas.getContext('2d').drawImage(Preview.canvas, 0, 0, t.canvas.width, t.canvas.height); }catch(e){ return false; }
      if(t.ph && t.ph.parentNode) t.ph.remove();
      t.drawn = true;
      return true;
    };
    const hovered = arr.find(t => t.hover && t.canvas);
    if(hovered){ render(hovered); return; }                 // ホバー中はそのタイルを毎フレーム
    this._presetAnimTick = (this._presetAnimTick || 0) + 1;
    const _recEvery = (typeof Record !== 'undefined' && Record.active) ? 12 : 3;   // 録画中はさらに間引く
    if(this._presetAnimTick % _recEvery) return;            // 非ホバーのラウンドロビンは 3 フレームに 1 枚 (負荷対策)
    const n = arr.length;                                   // ラウンドロビンで次のシェーダタイル1枚
    for(let step = 0; step < n; step++){
      this._presetAnimI = (this._presetAnimI + 1) % n;
      if(render(arr[this._presetAnimI])) break;
    }
  },
  // プリセットバンクのボタン表示更新 (保存済みは点灯 + ● 表示)
  refreshBanks(){
    const row = $('#bankRow'); if(!row) return;
    row.querySelectorAll('.bankBtn').forEach(b=>{
      const n = b.dataset.bank;
      let filled = false;
      try{ filled = !!localStorage.getItem('vj.bank.'+n); }catch(e){}
      b.textContent = n + (filled ? ' ●' : '');
      b.style.background = filled ? 'var(--acc)' : '';
      b.style.color = filled ? '#fff' : '';
      b.style.borderColor = filled ? 'var(--acc)' : '';
    });
  },

  // マイク/画面音声が ON のとき該当ボタンを点灯
  refreshAudioButtons(){
    const mode = (typeof Audio !== 'undefined') ? Audio.mode : 'off';
    const m = $('#btnAudioMic'), d = $('#btnAudioDisp');
    if(m) m.classList.toggle('audio-on', mode === 'mic');
    if(d) d.classList.toggle('audio-on', mode === 'display');
  },

  refreshHUD(){
    const phase = BPM.beatPhase();
    const beatIdx = Math.floor(BPM.beatCount()) % 4;
    $$('#bpmDots div').forEach((d,i)=>d.classList.toggle('on', i===beatIdx && phase<0.25));
    $('#statFps').textContent = (1/Math.max(0.001, GL.lastDt||0.016)).toFixed(0);
    { const e=$('#statBpm'); if(e) e.textContent = (typeof BPM!=='undefined') ? Math.round(BPM.bpm) : '—'; }
    { const e=$('#autoBpmStat'); if(e){
        let txt, lock = false;
        if(!BPM.auto) txt = 'OFF';
        else if(typeof Audio === 'undefined' || !Audio.analyser) txt = '入力なし (マイク/画面音声をON)';
        else if(BPM.autoState === 'lock'){ txt = '● LOCK ' + BPM.autoBpm.toFixed(1) + ' (' + Math.round(BPM.autoConf*100) + '%)'; lock = true; }
        else if(BPM.autoBpm > 0) txt = '… 解析中 ' + BPM.autoBpm.toFixed(1) + ' (' + Math.round(BPM.autoConf*100) + '%)';
        else txt = '… 解析中';
        if(BPM.auto && Audio && Audio.bpmBandLabel) txt += ' · ' + Audio.bpmBandLabel;
        e.textContent = txt;
        e.style.color = lock ? 'var(--acc2)' : 'var(--dim)';
      } }
    { const e=$('#statCpu'); if(e) e.textContent = Math.round(App.loadPercent ? App.loadPercent(App._cpuMs||0) : 0) + '%'; }
    { const e=$('#statGpu'); if(e) e.textContent = GL._gpuExt ? Math.round(App.loadPercent ? App.loadPercent(GL._gpuMs||0) : 0) + '%' : '—'; }
    // ATK: 音声入力あり かつ Sensitivity/Attack を織り込んだアタック包絡が閾値を超えて「検出」された瞬間だけ ON。
    { const e=$('#statAtk'); if(e){ const on = (typeof Audio!=='undefined' && Audio.mode !== 'off' && (Audio.attackEnv||0) > 0.15);
        e.textContent = on ? 'ON' : 'OFF'; e.style.color = on ? 'var(--acc)' : 'var(--dim)'; } }
    const bEl = $('#statBeat');
    if(bEl){
      const bc = BPM.beatCount();
      // 4 拍周期 (4/4 拍子) で 1/4 → 2/4 → 3/4 → 4/4 をくり返し表示
      const inBar = ((Math.floor(bc) % 4) + 4) % 4;
      const sc = App.beatScale;
      const scLabel = sc < 1 ? '1/' + Math.round(1/sc) : String(sc);
      bEl.textContent = `${inBar + 1}/4` + (sc !== 1 ? ` ×${scLabel}` : '');
    }
  }
};

window.addEventListener('DOMContentLoaded', ()=>App.init());
// ページロードが一通り終わったら、アイドル時に動画を1つずつプリフェッチ(遅延ローディング/キャッシュ)
window.addEventListener('load', ()=>{ setTimeout(()=>{ try{ if(typeof Movie!=='undefined' && Movie.startPreload) Movie.startPreload(); }catch(e){} }, 3000); });

/* dt tracking */
let _lastT = now();
function _measureDt(){ const t = now(); GL.lastDt = t - _lastT; _lastT = t; requestAnimationFrame(_measureDt); }
requestAnimationFrame(_measureDt);
