'use strict';
/* Movie engine — mp4 / webm / mov などのループ素材を全画面再生する Slot kind。
   - drag-drop もしくは <input type=file> で読み込み
   - 常にループ再生 (loop=true)
   - cover / contain / stretch のフィットモード
   - 再生レート可変, ミュート切替
   - App.userPan / App.userZoom (cursor keys, < >) に対応
*/

const Movie = {
  initialized:false, gl:null,
  prog:null, locs:null, vbo:null,
  library:[],   // [{url, name}, ...] — movies/ フォルダから自動列挙
  _cache:{},    // URL → {frames:[...]|null, complete:bool, persistent?:bool}
  _preloadActive:false,
  _fullCacheEnabled:false, // Load ON 中は復号済み要素/全区間フレームをセッション中ずっと保持
  _bufferDbPromise:null,
  _elCache:{},      // slotKey|url → videoEl (デコード済み要素のキャッシュ → 再選択で即再生)
  _elCacheKeys:[],  // LRU順
  _warmElCache:{},  // URL → 先頭フレームまでデコード済みの待機 videoEl
  _blobUrlBySrc:{}, // Cache API から取り出した Blob URL (同じ動画は再利用)
  // スロット毎の状態 (tex / videoEl / src / fileName / loaded / P / _lastSubBeat)
  // 旧コードからの互換のため、デフォルトのアクセサは現アクティブスロットへ転送
  _slots:{},
  _newSlotState(){
    return {
      tex:null, videoEl:null, src:null, fileName:'', loaded:false,
      P:{
        rate:1.0,
        fit:'auto',           // 'auto' | 'cover' | 'contain' | 'stretch'
      },
      // 再生方向は矢印キー (App.timeDir) で制御。beat モードの拍ジャンプは常時 ON (1 beat)。
      _lastSubBeat:-1,
      _lastFrameT:0,          // dt 計算用
      // フレームバッファ (逆再生用)
      //   forward 再生中に取り込んで _frames へ蓄積、
      //   reverse phase ではこのバッファを backward に走査して描画する
      _frames:[],             // {w,h,data:Uint8ClampedArray, t:sourceTime}[]
      _frameMax:180,          // リバース用バッファ上限 (VRAM 対策: 960px長辺 ×180 ≈ 380MB)
      _captureMaxDim:960,     // 取込解像度の長辺上限 (GPU リング化で 480→960 に向上。0=原寸)
      _captureIntervalMs:66,  // リバース用フレーム取込間隔 (約15fps)
      _bufferComplete:false,  // 1 サイクル蓄積完了 (これ以上 push しない)
      _lastCaptureT:0,
      _captureInflight:false,
      _revCursor:0,
      _revT:0,                // 逆再生中のソース時刻 (videoEl.currentTime 系)
      _modePhase:'forward',   // 'forward' | 'reverse'
      _lastSeekAt:0,
    };
  },
  _slot(key){
    const k = key || (typeof App !== 'undefined' ? App.activeSlot : 'A');
    if(!this._slots[k]) this._slots[k] = this._newSlotState();
    const s = this._slots[k];
    // gl が後から有効になった場合でもテクスチャを補完生成。
    // (init 前に Movie.P 等でスロットが空生成されると tex=null のまま render で黒くなるのを防ぐ)
    if(this.gl && !s.tex){
      const gl = this.gl;
      const mk = ()=>{
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        return t;
      };
      s.tex = mk();
      s.texPrev = mk();   // フレーム補間用 (1 つ前のフレーム)
    }
    return s;
  },
  // 旧 API 互換: 現アクティブスロットの値を取り出す getter
  get P()         { return this._slot().P; },
  get videoEl()   { return this._slot().videoEl; },
  get loaded()    { return this._slot().loaded; },
  get fileName()  { return this._slot().fileName; },
  get src()       { return this._slot().src; },
  get tex()       { return this._slot().tex; },

  VS:`
attribute vec2 a_pos;
varying vec2 v_uv;
void main(){
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0., 1.);
}`,
  FS:`
precision mediump float;
uniform sampler2D u_tex;
uniform sampler2D u_texPrev;  // フレーム補間用: 1 つ前のフレーム
uniform float u_mixT;         // 0=prev .. 1=cur (低速時のフレームブレンド。1 で補間なし)
uniform vec2  u_viewSize;
uniform vec2  u_vidSize;
uniform int   u_fit;     // 0=cover, 1=contain, 2=stretch
uniform vec2  u_pan;     // NDC
uniform float u_zoom;
varying vec2 v_uv;
void main(){
  vec2 uv = v_uv;
  if(u_fit != 2 && u_vidSize.x > 0.5 && u_vidSize.y > 0.5){
    float va = u_viewSize.x / max(u_viewSize.y, 1.0);
    float ta = u_vidSize.x  / max(u_vidSize.y,  1.0);
    vec2 s = vec2(1.0);
    if(u_fit == 0){
      // cover: 画面いっぱい (background-size: cover 相当)。短辺を viewport に合わせて長辺を切る
      s = (va > ta) ? vec2(1.0, va/ta) : vec2(ta/va, 1.0);
    } else {
      // contain: 全体表示 (background-size: contain 相当)。長辺を viewport に合わせて余白は黒
      s = (va > ta) ? vec2(ta/va, 1.0) : vec2(1.0, va/ta);
    }
    uv = (uv - 0.5) / s + 0.5;
  }
  // user pan/zoom
  float z = max(0.001, u_zoom);
  uv = (uv - 0.5) / z + 0.5 + u_pan * 0.5;
  // contain は余白を黒、cover/stretch はラップ
  if(u_fit == 1){
    if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0){
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
  } else {
    uv = fract(uv);
  }
  // 低速時のフレーム補間: 前フレームと現フレームの線形クロスフェード (軽量な frame mix)
  gl_FragColor = (u_mixT >= 0.999) ? texture2D(u_tex, uv)
               : mix(texture2D(u_texPrev, uv), texture2D(u_tex, uv), clamp(u_mixT, 0.0, 1.0));
}`,

  init(gl){
    if(this.initialized) return true;
    this.gl = gl;
    this.PDefaults = JSON.parse(JSON.stringify(this.P));

    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, this.VS); gl.compileShader(vs);
    if(!__glReady(gl, vs, false)){ console.error('Movie vs:', gl.getShaderInfoLog(vs)); return false; }
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, this.FS); gl.compileShader(fs);
    if(!__glReady(gl, fs, false)){ console.error('Movie fs:', gl.getShaderInfoLog(fs)); return false; }
    this.prog = gl.createProgram();
    gl.attachShader(this.prog, vs); gl.attachShader(this.prog, fs); gl.linkProgram(this.prog);
    if(!__glReady(gl, this.prog, true)){ console.error('Movie link:', gl.getProgramInfoLog(this.prog)); return false; }

    this.locs = {
      pos:      gl.getAttribLocation(this.prog, 'a_pos'),
      tex:      gl.getUniformLocation(this.prog, 'u_tex'),
      texPrev:  gl.getUniformLocation(this.prog, 'u_texPrev'),
      mixT:     gl.getUniformLocation(this.prog, 'u_mixT'),
      viewSize: gl.getUniformLocation(this.prog, 'u_viewSize'),
      vidSize:  gl.getUniformLocation(this.prog, 'u_vidSize'),
      fit:      gl.getUniformLocation(this.prog, 'u_fit'),
      pan:      gl.getUniformLocation(this.prog, 'u_pan'),
      zoom:     gl.getUniformLocation(this.prog, 'u_zoom'),
    };
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);

    // 各スロット用の状態は _slot() で遅延生成
    this.initialized = true;
    return true;
  },

  // 動画要素を新規生成 (設定共通)
  _makeEl(s){
    const v = document.createElement('video');
    v.loop = true;
    v.muted = true;   // 常時ミュート
    v.playsInline = true;
    v.autoplay = true;
    v.crossOrigin = 'anonymous';
    v.preload = 'auto';
    return v;
  },
  _resetPlaybackState(s, keepFrames=false){
    const hadComplete = !!s._bufferComplete;
    if(!keepFrames) this._clearFrames(s);
    s._bufferComplete = keepFrames ? hadComplete : false;
    s._modePhase = 'forward';
    s._revT = 0;
    s._revCursor = 0;
    s._lastSubBeat = -1;
    s._lastFrameT = 0;
    s._lastUploadT = undefined;
    s._lastSeekAt = 0;
  },
  _setNativePlayback(s, rate){
    if(!s.videoEl) return;
    const n = Number(rate);
    if(isFinite(n) && Math.abs(n) < 0.0001){
      try{ s.videoEl.pause(); }catch(e){}
      return;
    }
    const r = Math.min(16, Math.max(0.0625, Math.abs(isFinite(n) ? n : 1)));   // Chrome は 16 超で NotSupportedError
    if(s.videoEl.playbackRate !== r) s.videoEl.playbackRate = r;
    if(s.videoEl.paused) s.videoEl.play().catch(()=>{});
  },
  _enterReverse(s, t){
    if(!s._frames.length) return false;
    const newest = s._frames[s._frames.length - 1].t;
    const oldest = s._frames[0].t;
    const tt = isFinite(t) ? Math.max(oldest, Math.min(newest, t)) : newest;
    try{ s.videoEl.pause(); }catch(e){}
    s._modePhase = 'reverse';
    s._revT = tt;
    return true;
  },
  // 要素キャッシュを上限まで間引く (現在表示中の要素は残す)
  _trimElCache(s){
    const LIMIT = this._fullCacheEnabled ? Infinity : 6;
    while(this._elCacheKeys.length > LIMIT){
      const old = this._elCacheKeys.shift();
      const ov = this._elCache[old];
      if(ov && ov !== s.videoEl){ try{ ov.pause(); ov.removeAttribute('src'); ov.load(); }catch(e){} }
      delete this._elCache[old];
    }
  },
  setFullCacheEnabled(on){
    this._fullCacheEnabled = !!on;
    if(!this._fullCacheEnabled){
      for(const url of Object.keys(this._warmElCache)){
        const v = this._warmElCache[url];
        try{ v.pause(); v.removeAttribute('src'); v.load(); }catch(e){}
      }
      this._warmElCache = {};
      const s = this._slot();
      this._trimElCache(s);
    }
  },
  _assetUrl(url){
    url = String(url || '').replace(/(^|\/)videos\//, '$1movies/');   // 旧パス互換: videos/ → movies/
    if(typeof App !== 'undefined' && App._versionedAssetUrl) return App._versionedAssetUrl(url);
    return url;
  },
  _assetCacheName(){
    if(typeof App !== 'undefined' && App._assetCacheName) return App._assetCacheName();
    return 'vj-assets-dev';
  },
  _canUseAssetCache(){
    return !!(typeof App !== 'undefined' && App._canUseAssetCache && App._canUseAssetCache());
  },
  async cacheRaw(url){
    if(!url) return null;
    if(typeof App !== 'undefined' && App.cacheAsset) return App.cacheAsset(url);
    return fetch(this._assetUrl(url), {cache:'force-cache'});
  },
  async cacheLibrary(list, onProgress){
    const movies = Array.isArray(list) ? list : await this.scanFolder();
    const total = movies ? movies.length : 0;
    let done = 0;
    for(const item of movies || []){
      if(onProgress) onProgress(item, done, total);
      try{
        const res = await this.cacheRaw(item.url);
        if(!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 0}`);
      }catch(e){
        console.warn('video raw cache failed:', item.url, e);
      }
      done++;
      if(onProgress) onProgress(item, done, total);
    }
    return done;
  },
  _idbRequest(req){
    return new Promise((resolve, reject)=>{
      req.onsuccess = ()=>resolve(req.result);
      req.onerror = ()=>reject(req.error || new Error('IndexedDB request failed'));
    });
  },
  _idbDone(tx){
    return new Promise((resolve, reject)=>{
      tx.oncomplete = ()=>resolve();
      tx.onabort = tx.onerror = ()=>reject(tx.error || new Error('IndexedDB transaction failed'));
    });
  },
  _openBufferDb(){
    if(this._bufferDbPromise) return this._bufferDbPromise;
    this._bufferDbPromise = new Promise((resolve, reject)=>{
      if(typeof indexedDB === 'undefined'){ reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open('vj-video-buffers', 1);
      req.onupgradeneeded = ()=>{
        const db = req.result;
        if(!db.objectStoreNames.contains('meta')){
          const meta = db.createObjectStore('meta', {keyPath:'key'});
          meta.createIndex('url', 'url', {unique:false});
        }
        if(!db.objectStoreNames.contains('frames')){
          const frames = db.createObjectStore('frames', {keyPath:'key'});
          frames.createIndex('videoKey', 'videoKey', {unique:false});
        }
      };
      req.onsuccess = ()=>resolve(req.result);
      req.onerror = ()=>reject(req.error || new Error('video buffer DB open failed'));
    });
    return this._bufferDbPromise;
  },
  async _bufferIdentity(url){
    const reqUrl = this._assetUrl(url);
    let modified = '', length = '', etag = '';
    try{
      if(this._canUseAssetCache()){
        const cache = await caches.open(this._assetCacheName());
        const hit = await cache.match(reqUrl);
        if(hit){
          modified = hit.headers.get('last-modified') || '';
          length = hit.headers.get('content-length') || '';
          etag = hit.headers.get('etag') || '';
        }
      }
    }catch(e){}
    let canonical = String(url || '');
    try{
      const u = new URL(reqUrl, location.href);
      u.searchParams.delete('v');
      canonical = u.href;
    }catch(e){}
    const signature = etag || ((modified || length) ? `${modified}:${length}` : 'url');
    return {url:canonical, key:`rgba640-f180-v1|${canonical}|${signature}`};
  },
  async _persistentMeta(url){
    try{
      const db = await this._openBufferDb();
      const id = await this._bufferIdentity(url);
      const tx = db.transaction('meta', 'readonly');
      const meta = await this._idbRequest(tx.objectStore('meta').get(id.key));
      return meta && meta.complete && meta.count > 0 ? meta : null;
    }catch(e){ return null; }
  },
  async hasPersistentBuffer(url){
    return !!(await this._persistentMeta(url));
  },
  async _deletePersistentBufferKey(db, key){
    const tx = db.transaction(['meta','frames'], 'readwrite');
    tx.objectStore('meta').delete(key);
    const req = tx.objectStore('frames').index('videoKey').openCursor(IDBKeyRange.only(key));
    req.onsuccess = ()=>{
      const cursor = req.result;
      if(!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    await this._idbDone(tx);
  },
  async _deleteStalePersistentBuffers(db, id){
    const tx = db.transaction('meta', 'readonly');
    const metas = await this._idbRequest(tx.objectStore('meta').index('url').getAll(id.url));
    for(const meta of metas || []){
      if(meta.key !== id.key) await this._deletePersistentBufferKey(db, meta.key);
    }
  },
  async savePersistentBuffer(url, frames){
    const savable = (frames || []).filter(f=>f && f.data && f.w > 0 && f.h > 0);
    if(!savable.length) return false;
    const db = await this._openBufferDb();
    const id = await this._bufferIdentity(url);
    await this._deletePersistentBufferKey(db, id.key).catch(()=>{}); // 前回中断時の半端なレコードを除去
    await this._deleteStalePersistentBuffers(db, id);
    let bytes = 0;
    try{
      const BATCH = 6;
      for(let start=0; start<savable.length; start+=BATCH){
        const tx = db.transaction('frames', 'readwrite');
        const store = tx.objectStore('frames');
        for(let i=start; i<Math.min(start+BATCH, savable.length); i++){
          const f = savable[i];
          bytes += f.data.byteLength || 0;
          store.put({
            key:`${id.key}|${String(i).padStart(4,'0')}`,
            videoKey:id.key, index:i, w:f.w, h:f.h, t:f.t,
            data:f.data,
          });
        }
        await this._idbDone(tx);
      }
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({
        key:id.key, url:id.url, complete:true, count:savable.length,
        bytes, savedAt:Date.now(), format:'rgba640-f180-v1',
      });
      await this._idbDone(tx);
      return true;
    }catch(e){
      await this._deletePersistentBufferKey(db, id.key).catch(()=>{});
      throw e;
    }
  },
  async loadPersistentBuffer(url){
    try{
      const db = await this._openBufferDb();
      const id = await this._bufferIdentity(url);
      const metaTx = db.transaction('meta', 'readonly');
      const meta = await this._idbRequest(metaTx.objectStore('meta').get(id.key));
      if(!meta || !meta.complete || meta.count < 1) return null;
      const tx = db.transaction('frames', 'readonly');
      const rows = await this._idbRequest(tx.objectStore('frames').index('videoKey').getAll(id.key));
      if(!rows || rows.length !== meta.count) return null;
      rows.sort((a,b)=>a.index-b.index);
      const frames = rows.map(r=>({
        w:r.w, h:r.h, t:r.t,
        data:r.data instanceof Uint8ClampedArray ? r.data : new Uint8ClampedArray(r.data),
        cached:true, persistent:true,
      }));
      this._cache[url] = {frames, complete:true, persistent:true};
      return frames;
    }catch(e){
      console.warn('video buffer restore failed:', url, e);
      return null;
    }
  },
  async prewarmLibrary(list, onProgress){
    const movies = Array.isArray(list) ? list : await this.scanFolder();
    let next = 0, done = 0;
    const worker = async ()=>{
      while(next < movies.length){
        const item = movies[next++];
        if(!this._warmElCache[item.url]){
          let v = null;
          try{
            v = this._makeEl();
            v.autoplay = false;
            const mediaSrc = (await this._cachedObjectUrl(item.url)) || this._assetUrl(item.url);
            await new Promise((resolve, reject)=>{
              const timer = setTimeout(()=>reject(new Error('video warm timeout')), 15000);
              v.addEventListener('loadeddata', ()=>{ clearTimeout(timer); resolve(); }, {once:true});
              v.addEventListener('error', ()=>{ clearTimeout(timer); reject(new Error('video warm error')); }, {once:true});
              v.src = mediaSrc;
              v.load();
            });
            v.pause();
            if(this._fullCacheEnabled) this._warmElCache[item.url] = v;
          }catch(e){
            if(v){ try{ v.pause(); v.removeAttribute('src'); v.load(); }catch(_){} }
            console.warn('video decoder warm failed:', item.url, e);
          }
        }
        done++;
        if(onProgress) onProgress(item, done, movies.length);
      }
    };
    await Promise.all(Array.from({length:Math.min(2, movies.length)}, worker));
    return done;
  },
  async _cachedObjectUrl(url){
    if(!url || /^(blob:|data:|mediastream:)/.test(url)) return null;
    if(!this._canUseAssetCache()) return null;
    try{
      const reqUrl = this._assetUrl(url);
      if(this._blobUrlBySrc[reqUrl]) return this._blobUrlBySrc[reqUrl];
      const cache = await caches.open(this._assetCacheName());
      const hit = await cache.match(reqUrl);
      if(!hit) return null;
      const blob = await hit.blob();
      const objUrl = URL.createObjectURL(blob);
      this._blobUrlBySrc[reqUrl] = objUrl;
      return objUrl;
    }catch(e){
      return null;
    }
  },
  // 起動後アイドル時に動画を1つずつプリフェッチ(HTTPキャッシュ)→ 選択時に高速ロード・再利用
  _preloadStarted:false,
  startPreload(){
    if(this._preloadStarted) return; this._preloadStarted = true;
    this.scanFolder().then(movies=>{
      if(!movies || !movies.length) return;
      let i = 0;
      const next = ()=>{
        if(i >= movies.length) return;
        const url = movies[i++].url;
        // force-cache: 既にキャッシュにあれば再取得しない。完了/失敗どちらでも次へ。
        this.cacheRaw(url).catch(()=>{}).finally(()=>{ this._preloadCount=(this._preloadCount||0)+1; setTimeout(next, 2000); });
      };
      const kick = ()=> setTimeout(next, 500);
      if(typeof requestIdleCallback === 'function') requestIdleCallback(kick, {timeout:4000}); else kick();
    }).catch(()=>{});
  },

  async loadUrl(url, name, slotKey){
    if(!url) return;
    // 旧パス互換: videos/ → movies/ (フォルダ改名前に保存されたプリセット/状態を救済)
    url = url.replace(/(^|\/)videos\//, '$1movies/');
    const s = this._slot(slotKey);
    const req = (s._loadReq || 0) + 1;
    s._loadReq = req;
    s.src = url;
    s.fileName = name || url.split('/').pop() || '';
    const key = slotKey + '|' + url;
    const mediaSrc = (await this._cachedObjectUrl(url)) || this._assetUrl(url);
    if(s._loadReq !== req) return;
    let v = this._elCache[key];
    if(!v && this._fullCacheEnabled && this._warmElCache[url]){
      v = this._warmElCache[url];
      delete this._warmElCache[url];
      this._elCache[key] = v;
      this._elCacheKeys.push(key);
    }
    if(v){
      // キャッシュ命中: デコード済み要素を再利用 (再fetch/再デコードなし)
      const i = this._elCacheKeys.indexOf(key); if(i>=0) this._elCacheKeys.splice(i,1);
      this._elCacheKeys.push(key);
      v.playbackRate = s.P.rate; v.muted = true;
      s.videoEl = v;
      s.loaded = (v.readyState >= 2);
      if(!s.loaded) v.addEventListener('loadeddata', ()=>{ s.loaded = true; }, {once:true});
      try{ v.currentTime = 0; }catch(e){}
      v.play().catch(err=>console.warn('video play:', err));
    } else {
      // 未キャッシュ: 新規要素を作ってキャッシュに登録
      v = this._makeEl(s);
      v.src = mediaSrc;
      v.playbackRate = s.P.rate; v.muted = true;
      s.videoEl = v;
      s.loaded = false;
      v.addEventListener('loadeddata', ()=>{ s.loaded = true; }, {once:true});
      v.play().catch(err=>console.warn('video play:', err));
      this._elCache[key] = v; this._elCacheKeys.push(key);
      this._trimElCache(s);
    }
    // 捕獲バッファ。RAMになければIndexedDBへ永続保存した全区間バッファを復元する。
    let cached = this._cache[url];
    if(!cached || !cached.frames){
      const frames = await this.loadPersistentBuffer(url);
      if(s._loadReq !== req) return;
      if(frames && frames.length) cached = this._cache[url];
    }
    // ライブ取込ぶんの GPU テクスチャは解放してから差し替え。
    this._freeFrames(s._frames);
    if(cached && cached.complete && cached.frames && cached.frames.length){ s._frames = cached.frames; s._bufferComplete = true; }
    else { s._frames = []; s._bufferComplete = false; }
    this._resetPlaybackState(s, !!(cached && cached.complete && cached.frames && cached.frames.length));
  },

  // video/ フォルダから .mp4 / .webm / .mov / .m4v / .ogv を列挙
  // 1) ディレクトリリスティング → autoindex から href を抽出
  // 2) フォールバック: video/manifest.json (["a.mp4", ...] or {files:[...]})
  async scanFolder(dir){
    const exts = '(?:mp4|webm|mov|m4v|ogv|ogg)';
    // dir 未指定なら movies / videos / video の順で試す(素材フォルダは movies/)
    const candidates = dir ? [dir] : ['movies','videos','video'];
    for(const d of candidates){
      const list = [];
      // (1) dir/ を fetch — index.php(JSON) / autoindex(HTML) / manifest.json のどれでも対応
      try{
        const r = await fetch(d+'/', {cache:'no-cache'});
        if(r.ok){
          const text = await r.text();
          const ct = r.headers.get('Content-Type') || '';
          if(ct.includes('json') || text.trim().startsWith('[') || text.trim().startsWith('{')){
            // JSON 配列 (index.php または manifest.json 相当)
            try{
              const data = JSON.parse(text);
              const files = Array.isArray(data) ? data : (data.files || []);
              for(const f of files) list.push({url: d+'/'+f, name: f});
            }catch(e){}
          } else {
            // autoindex HTML
            const re = new RegExp('href="([^"]+\\.'+exts+')"', 'gi');
            const set = new Set();
            let m;
            while((m = re.exec(text))){
              let h = m[1];
              if(h === '../' || h.startsWith('?') || h.startsWith('#')) continue;
              const fn = h.split('?')[0].split('#')[0].split('/').pop();
              if(fn) set.add(fn);
            }
            for(const fn of [...set].sort()) list.push({url: d+'/'+fn, name: fn});
          }
        }
      }catch(e){}
      // (2) フォールバック: manifest.json
      if(list.length === 0){
        try{
          const r = await fetch(d+'/manifest.json', {cache:'no-cache'});
          if(r.ok){
            const data = await r.json();
            const files = Array.isArray(data) ? data : (data.files || []);
            for(const f of files) list.push({url: d+'/'+f, name: f});
          }
        }catch(e){}
      }
      if(list.length > 0){
        this.library = list;
        this.libraryDir = d;
        return list;
      }
    }
    this.library = [];
    this.libraryDir = null;
    return [];
  },

  loadFile(file, slotKey){
    if(!file) return;
    const s = this._slot(slotKey);
    if(s.src && s.src.startsWith('blob:')) URL.revokeObjectURL(s.src);
    const url = URL.createObjectURL(file);
    const v = this._makeEl(s);   // ドロップファイルはキャッシュせず新規要素
    v.src = url;
    v.playbackRate = s.P.rate; v.muted = true;
    s.videoEl = v;
    s.src = url;
    s.fileName = file.name || '';
    s.loaded = false;
    v.addEventListener('loadeddata', ()=>{ s.loaded = true; }, {once:true});
    this._resetPlaybackState(s);
    v.play().catch(err=>console.warn('video play:', err));
  },

  setRate(r, slotKey){
    const s = this._slot(slotKey);
    s.P.rate = r;
    if(s.videoEl) s.videoEl.playbackRate = r;
  },
  setFit(f, slotKey){
    if(['auto','cover','contain','stretch'].indexOf(f) < 0) return;
    this._slot(slotKey).P.fit = f;
  },
  togglePlay(slotKey){
    const s = this._slot(slotKey);
    if(!s.videoEl) return;
    if(s.videoEl.paused) s.videoEl.play().catch(()=>{});
    else s.videoEl.pause();
  },

  render({fbo, w, h, slotKey}){
    if(!this.initialized) return;
    const gl = this.gl;
    const s = this._slot(slotKey);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);

    // reverse phase 中は、_revT がバッファ内ならバッファから、外なら動画のネイティブフレームから描画
    const useBuffer = (s._modePhase === 'reverse' && s._frames.length > 0 && s._revInBuffer !== false);
    // テクスチャに実際に上がったフレームのサイズ (アス比計算用)。
    // videoEl.videoWidth は新動画メタデータ取得直後に更新されるが、
    // テクスチャ更新は readyState>=2 で初めて行われるため、ここで実 upload と
    // 同期して _texVw/_texVh を更新することで「旧テクスチャ × 新アス比」歪みを防ぐ。
    // フレーム補間 (軽量 frame mix): 実効レートが低いときだけ、前フレームと現フレームを
    // 線形クロスフェード。u_mixT=1 で補間なし (通常速度は従来どおり)。
    // 常時フレーム補間: 順再生もソース fps (30fps 等) と描画 fps の差をクロスフェードで埋める。
    // 逆再生バッファはさらに疎 (15fps 以下) なので必須。コストはバインド2枚+mix のみ。
    const wantInterp = true;
    let mixT = 1.0;
    let ringTex = null, ringTexPrev = null;
    if(useBuffer){
      // 逆再生バッファ: _revT を挟む 2 フレーム (idx0=下側, idx0+1=上側) をブレンド
      const i1 = Math.max(0, Math.min(s._frames.length - 1, Math.floor(s._revCursor)));
      const f1 = s._frames[i1];
      // 下側 (t <= revT) のフレーム index
      let i0 = i1;
      if(f1 && f1.t > s._revT && i1 > 0) i0 = i1 - 1;
      const iUp = Math.min(s._frames.length - 1, i0 + 1);
      const f0 = s._frames[i0], fU = s._frames[iUp];
      // Load キャッシュ由来の CPU フレーム (data のみ) は初回参照時に一度だけ GPU 化して以後再利用
      const ensureTex = (f)=>{
        if(!f || f.tex || !f.data) return;
        try{
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, f.w, f.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, f.data);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          f.tex = tex;
        }catch(e){}
      };
      ensureTex(f0); ensureTex(fU);
      if(wantInterp && fU && f0 && iUp !== i0 && f0.tex && fU.tex){
        ringTexPrev = f0.tex;
        ringTex = fU.tex;
        s._texVw = fU.w; s._texVh = fU.h;
        mixT = Math.max(0, Math.min(1, (s._revT - f0.t) / Math.max(0.001, fU.t - f0.t)));
      } else if(f0 && f0.tex){
        ringTex = f0.tex;
        s._texVw = f0.w; s._texVh = f0.h;
      }
    } else if(s.videoEl && s.loaded && s.videoEl.readyState >= 2 && s.videoEl.videoWidth > 0){
      // currentTime が変わったときだけアップロード (毎フレーム同じフレームを送らない)
      const ct = s.videoEl.currentTime;
      if(s._lastUploadT !== ct){
        // 新フレーム到着: 旧フレームを texPrev へ回して (swap)、新フレームを tex へ
        if(wantInterp){
          const tmp = s.texPrev; s.texPrev = s.tex; s.tex = tmp;
          const nowMs = performance.now();
          s._upGapMs = Math.max(20, Math.min(600, nowMs - (s._upWallT || nowMs)));
          s._upWallT = nowMs;
        }
        s._lastUploadT = ct;
        gl.bindTexture(gl.TEXTURE_2D, s.tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        try{
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s.videoEl);
          s._texVw = s.videoEl.videoWidth;
          s._texVh = s.videoEl.videoHeight;
        }catch(e){ /* CORS or not ready */ }
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      }
      if(wantInterp && s._upGapMs){
        // 前回のフレーム間隔を基準に、経過時間でクロスフェード位置を進める
        mixT = Math.max(0, Math.min(1, (performance.now() - (s._upWallT || 0)) / s._upGapMs));
      }
    }

    gl.useProgram(this.prog);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(this.locs.pos);
    gl.vertexAttribPointer(this.locs.pos, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ringTex || s.tex);   // 逆再生中はリングのテクスチャを直接バインド (アップロード不要)
    gl.uniform1i(this.locs.tex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, ringTexPrev || ringTex || s.texPrev || s.tex);
    gl.uniform1i(this.locs.texPrev, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(this.locs.mixT, mixT);
    gl.uniform2f(this.locs.viewSize, w, h);
    // アス比は「現在テクスチャに載っているフレーム」のサイズで計算。
    // videoEl.videoWidth は新動画メタデータ確定で先に切り替わるため使わない。
    const vw = s._texVw || 1;
    const vh = s._texVh || 1;
    gl.uniform2f(this.locs.vidSize, vw, vh);
    // 描画対象スロットの pan/zoom を直接参照 (active と異なる場合も正しく反映)。
    // ズームアウト(<1)は内部適用せず base 描画にする → 合成段で画面全体をミラータイル化する
    // (自前でズームアウトすると黒縁付きの縮小映像がタイル化されて崩れるため)。
    let pan = {x:0,y:0}, zoom = 1.0, uz = 1.0;
    if(typeof GL !== 'undefined' && GL.slots && slotKey){
      const sl = GL.slots[slotKey];
      if(sl){
        uz = (sl.userZoom != null) ? sl.userZoom : 1.0;
        zoom = Math.max(1.0, uz);
        if(sl.userPan && uz >= 1.0) pan = sl.userPan;
      }
    } else if(typeof App !== 'undefined'){
      uz = App.userZoom == null ? 1.0 : App.userZoom;
      zoom = Math.max(1.0, uz);
      if(uz >= 1.0) pan = App.userPan;
    }
    let fitMode = s.P.fit;
    if(fitMode === 'auto') fitMode = (vh >= vw) ? 'contain' : 'cover';   // 縦長+正方形は contain (cover だと正方動画が横長に切れる)
    if(uz < 1.0) fitMode = 'cover';   // ミラータイル時は画面いっぱいに埋めて黒帯(継ぎ目)をなくす (shader と同じ見た目に)
    gl.uniform1i(this.locs.fit, fitMode === 'contain' ? 1 : (fitMode === 'stretch' ? 2 : 0));
    gl.uniform2f(this.locs.pan, pan.x, pan.y);
    gl.uniform1f(this.locs.zoom, zoom);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  },

  clear(slotKey){
    const s = this._slot(slotKey);
    if(s.videoEl){ try{ s.videoEl.currentTime = 0; }catch(e){} }
    this._resetPlaybackState(s);
  },

  // 毎フレーム呼ぶ:
  //   - 矢印キー (App.timeDir) で再生方向制御 (→=forward / ←=reverse)
  //   - beat モードのとき、拍に合わせてランダム位置へ seek (常時 ON, 1 beat)
  update(beatCount, beatMode, slotKey){
    const s = this._slot(slotKey);
    if(!s.videoEl || !s.loaded) return;
    const now = performance.now();
    const dt = s._lastFrameT ? Math.min(0.1, (now - s._lastFrameT) / 1000) : 1/60;
    s._lastFrameT = now;
    const dur = s.videoEl.duration;
    // 再生方向は矢印(App.timeDir)のみで決まる
    const mode = (typeof App !== 'undefined' && App.timeDir === -1) ? 'reverse' : 'forward';
    const sp = ((typeof App !== 'undefined' && App.speed) ? App.speed : 1.0)
             * ((typeof App !== 'undefined' && App._audioSpeedMul) ? App._audioSpeedMul : 1.0);   // Audio Transport の速度変調
    // 再生速度は全体 speed パラメータで制御。BEAT モードの seek 頻度は呼び出し側の visual beat で制御。
    const effRate = (s.P.rate || 1) * sp;
    s._effRate = effRate;   // render 側のフレーム補間ゲートで参照

    // 再生方向制御
    // 戦略: forward 中は常にフレームをリングバッファへ取り込んでおく。
    //   reverse / pingpong に切替えた瞬間にバッファ末尾から逆再生開始 → 待ち時間ゼロ。
    //   forward に戻すときは現在表示中のフレームの元 currentTime に seek してから再生 (視覚的連続性)。

    // 常時ローリングバッファに取り込む(forward 中)。→ いつ reverse に切替えても、
    // 直前までの過去フレームが残っているので「途中から」現在位置から遡って逆再生できる。
    // reverse phase では動画を止めてバッファを走査するだけ(取り込まない)。
    if(!s.videoEl.paused && s._modePhase === 'forward'){
      this._captureFrame(s);
    }

    if(mode === 'forward'){
      // reverse phase から戻ってきた場合: 現在の逆再生位置 _revT から順再生を再開。
      // (_revCursor はバッファ外走行中に更新が止まり古い値=先頭付近を指したままのことがあり、
      //  それを参照すると「順再生に戻すとスタートフレームへ飛ぶ」バグになる)
      if(s._modePhase === 'reverse'){
        let t = isFinite(s._revT) ? s._revT : NaN;
        if(!isFinite(t) && s._frames.length > 0){
          const i = Math.max(0, Math.min(s._frames.length - 1, Math.floor(s._revCursor)));
          t = s._frames[i] ? s._frames[i].t : NaN;
        }
        if(isFinite(t)){ try{ s.videoEl.currentTime = t; }catch(e){} }
      }
      this._setNativePlayback(s, effRate);
      s._modePhase = 'forward';
    } else { // mode === 'reverse'
      if(s._modePhase === 'forward'){
        // 満杯/終端を待たず、バッファに 2 枚以上あれば現在位置から即座に逆再生開始(途中から逆再生)。
        if(s._frames.length > 1){
          const ct = s.videoEl.currentTime;
          const oldestT = s._frames[0].t;
          const newestT = s._frames[s._frames.length - 1].t;
          this._enterReverse(s, (ct >= oldestT && ct <= newestT) ? ct : newestT);
        } else {
          this._setNativePlayback(s, effRate);
        }
      }
      if(s._modePhase === 'reverse'){
        if(!s.videoEl.paused){ try{ s.videoEl.pause(); }catch(e){} }
        const rate = Math.abs(effRate);
        s._revT -= rate * dt;
        // 動画の実境界でシームレスにループ: 先頭(0)まで来たら末尾(duration)へラップ。
        // バッファ先頭ではなく動画先頭で折り返すので「取り込み開始点でのループ」が起きない。
        // バッファが全編をカバーしているときは最新取込フレームへクランプ (dur-0.03 が newest より僅かに
        // 先だと、ラップ直後に一瞬バッファ外→ネイティブ seek でフレームが飛ぶため)。
        const newestT = s._frames.length ? s._frames[s._frames.length - 1].t : 0;
        let loopEnd = (isFinite(dur) && dur > 0.1) ? (dur - 0.03) : newestT;
        if(s._bufferComplete && newestT > 0) loopEnd = Math.min(loopEnd, newestT);
        if(s._revT <= 0.02){ s._revT = loopEnd; }
      }
    }
    // ソース時刻 _revT に最も近いフレームを cursor として選ぶ(バッファ内のときのみ)。
    // バッファ外(未取り込みの区間)は render 側で動画をネイティブ seek して補完する。
    if(s._modePhase === 'reverse' && s._frames.length > 0){
      const oldestT = s._frames[0].t, newestT = s._frames[s._frames.length - 1].t;
      s._revInBuffer = (s._revT >= oldestT - 0.05 && s._revT <= newestT + 0.05);
      if(s._revInBuffer){
        let lo = 0, hi = s._frames.length - 1;
        while(lo < hi){
          const mid = (lo + hi) >> 1;
          if(s._frames[mid].t < s._revT) lo = mid + 1;
          else hi = mid;
        }
        let idx = lo;
        if(idx > 0 && Math.abs(s._frames[idx - 1].t - s._revT) < Math.abs(s._frames[idx].t - s._revT)){
          idx = idx - 1;
        }
        s._revCursor = idx;
      } else {
        // バッファ外: 動画を _revT へシーク(ネイティブフレームで補完。多少カクつくが全編を逆再生できる)。
        // 前回の seek が完了する前に次を出すと要求が詰まり「止まる」ため、seeking 中は新規 seek を送らない。
        // (_revT は継続して減り続けるので、seek が落ち着き次第その時点の最新値へ追従する)
        try{
          if(!s.videoEl.seeking && Math.abs(s.videoEl.currentTime - s._revT) > 0.05){
            s.videoEl.currentTime = s._revT;
          } else if(!s.videoEl.seeking){
            // seek が確定したフレームはリングに取り込む → 一度通った区間は次回からバッファ再生できる
            this._captureFromEl(s, s.videoEl);
          }
        }catch(e){}
      }
    }

    // beat モード: 拍に合わせてランダム seek (常時 ON, 1 beat)
    //   forward → videoEl.currentTime をジャンプ / reverse → _revT をジャンプ (そこから逆再生)
    if(beatMode !== 'beat'){ s._lastSubBeat = -1; return; }
    const sb = Math.floor(beatCount);
    if(s._lastSubBeat < 0){ s._lastSubBeat = sb; return; }
    if(sb !== s._lastSubBeat){
      s._lastSubBeat = sb;
      if(isFinite(dur) && dur > 0.1){
        // ジャンプ先 — モードに応じて範囲を決定
        //   forward: 動画の duration 全範囲
        //   reverse/pingpong (reverse phase): バッファ範囲 (取り込み済みのフレームに限定)
        let tMin, tMax;
        if(s._modePhase === 'reverse' && s._frames.length > 0){
          tMin = s._frames[0].t;
          tMax = s._frames[s._frames.length - 1].t;
        } else {
          tMin = 0.05;
          tMax = Math.max(0.1, dur - 0.05);
        }
        // 現在位置から minHop 秒以内には飛ばない (= 視覚的に変化のない近距離ジャンプを抑止)
        //   ジャンプ可能範囲の 1/4 を下限 (上限 1.5 秒) として目安に
        const range = Math.max(0.1, tMax - tMin);
        const minHop = Math.min(1.5, range * 0.25);
        const cur = (s._modePhase === 'reverse') ? s._revT : s.videoEl.currentTime;
        let t = tMin + Math.random() * range;
        // 最大 8 回再試行 (確率的にほぼ確実に minHop 以上離れる)
        for(let tries = 0; tries < 8 && Math.abs(t - cur) < minHop; tries++){
          t = tMin + Math.random() * range;
        }
        // それでも近かったら強制的に minHop 離す (範囲外なら反対側に折り返し)
        if(Math.abs(t - cur) < minHop){
          t = cur + minHop * (Math.random() < 0.5 ? -1 : 1);
          if(t < tMin) t = cur + minHop;
          if(t > tMax) t = cur - minHop;
          t = Math.max(tMin, Math.min(tMax, t));
        }
        if(s._modePhase === 'reverse'){
          s._revT = t;
        } else {
          if(s.videoEl.seeking) return;
          try{ s.videoEl.currentTime = t; s._lastSeekAt = now; }catch(e){}
          this._setNativePlayback(s, effRate);
        }
      }
    }
  },

  // フレームを 30fps throttle で取り込んで _frames に push
  //   ImageBitmap は env により orientation 不定なので、
  //   2D Canvas → ImageData (常に top-down) で保存する。
  //   upload は HTMLVideoElement と同じ FLIP_Y=true ルートを使えるので向き整合性 OK。
  _captureFrame(s){
    this._captureFromEl(s, s.videoEl);
  },

  // ── GPU テクスチャリング取込 ──
  // 旧実装 (drawImage+getImageData で CPU に読み戻し → 逆再生時に毎フレーム texImage2D 再アップロード) は
  // CPU 読戻しの取込コストと逆再生の帯域コストが大きく「ラグい」原因だった。
  // 新実装: video 要素を一時テクスチャへ直接アップロード → blitFramebuffer で GPU 内ダウンスケールして
  // フレームごとの GPU テクスチャに保持。逆再生はテクスチャをバインドするだけ (アップロードゼロ)。
  _grabFrameTex(s, vEl){
    const gl = this.gl;
    if(!gl) return null;
    const vw = vEl.videoWidth, vh = vEl.videoHeight;
    if(!vw || !vh) return null;
    const maxDim = s._captureMaxDim || 0;
    let cw = vw, ch = vh;
    if(maxDim > 0 && Math.max(vw, vh) > maxDim){
      const k = maxDim / Math.max(vw, vh);
      cw = Math.max(1, Math.round(vw * k));
      ch = Math.max(1, Math.round(vh * k));
    }
    const setP = ()=>{
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };
    // 1) video → 一時フル解像度テクスチャ (再利用)。FLIP_Y は順再生アップロードと同じ向きに合わせる
    if(!this._capSrc) this._capSrc = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._capSrc);
    setP();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try{
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, vEl);
    }catch(e){
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      return null;   // CORS / not ready
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // 2) リングフレーム用テクスチャ (縮小サイズ) を確保
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cw, ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    setP();
    // 3) GPU 内で縮小転写
    if(!this._capRFB) this._capRFB = gl.createFramebuffer();
    if(!this._capDFB) this._capDFB = gl.createFramebuffer();
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._capRFB);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._capSrc, 0);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._capDFB);
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.blitFramebuffer(0, 0, vw, vh, 0, 0, cw, ch, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    return { tex, w: cw, h: ch };
  },
  _freeFrame(f){
    // Load キャッシュ由来 (cached=true) のフレームはキャッシュと共有なので解放しない
    if(!f || f.cached || !f.tex) return;
    try{ if(this.gl) this.gl.deleteTexture(f.tex); }catch(e){}
    f.tex = null;
  },
  _freeFrames(list){
    if(!list || !list.length) return;
    for(const f of list) this._freeFrame(f);
  },

  _captureFromEl(s, vEl){
    if(!vEl || vEl.readyState < 2) return;
    const now = performance.now();
    // 取込間隔は動画の長さに追従: 全編が必ずリング(_frameMax枚)に収まる間隔にする。
    // 12秒以下=66ms(15fps)、長尺ほど疎に(上限250ms=4fps)。全編がリング化されると
    // 逆再生でバッファ外に出なくなり、ネイティブ seek 補完(=フレーム飛びの原因)が発生しない。
    const vdur = vEl.duration;
    const iv = (isFinite(vdur) && vdur > 0.1)
      ? Math.max(s._captureIntervalMs || 66, Math.min(250, (vdur * 1000) / (s._frameMax || 180)))
      : (s._captureIntervalMs || 66);
    if(now - (s._lastCaptureT || 0) < iv) return;
    // ★ 連続バッファ方式: 取り込んだ後に t で時刻ソート挿入。
    //   同時刻 (epsilon 内) は上書き → 同じ位置のフレームは最新の取込で更新。
    //   バッファ満杯時のみ古いものを捨てる (FIFO ではなく時刻順)。
    //   wrap 検出は不要 (ソート挿入で自動的に正しい位置に入る)。
    const ct = vEl.currentTime;
    if(!isFinite(ct)) return;
    s._lastCaptureT = now;
    try{
      const rec = this._grabFrameTex(s, vEl);
      if(!rec) return;
      const frame = {w:rec.w, h:rec.h, tex:rec.tex, t: ct};
      // ── t-sorted insert with dedup ──
      // 同時刻判定は取込間隔の約半分。これより小さい(旧: 固定20ms)と、周回ごとに「置換」でなく
      // 「挿入→先頭(古い時刻)追い出し」になり、バッファの古い区間が侵食されて範囲が狭まる
      // (→ reverse の拍ジャンプが狭い同じ区間をループする不具合の原因)。
      const EPS = Math.max(0.02, (iv / 1000) * 0.55);
      let lo = 0, hi = s._frames.length;
      while(lo < hi){
        const mid = (lo + hi) >> 1;
        if(s._frames[mid].t < ct) lo = mid + 1;
        else hi = mid;
      }
      // lo の前後で近接するか確認
      const near = (i)=> i>=0 && i<s._frames.length && Math.abs(s._frames[i].t - ct) < EPS;
      if(near(lo)){
        this._freeFrame(s._frames[lo]);
        s._frames[lo] = frame;  // 上書き
      } else if(near(lo-1)){
        this._freeFrame(s._frames[lo-1]);
        s._frames[lo-1] = frame;
      } else {
        s._frames.splice(lo, 0, frame);  // 挿入
      }
      // 上限超過: 現在の再生位置から遠い側の端を捨てる (常に先頭を捨てると古い区間が侵食される)
      while(s._frames.length > s._frameMax){
        const cur = (s._modePhase === 'reverse') ? s._revT : ct;
        const dFirst = Math.abs(s._frames[0].t - cur);
        const dLast  = Math.abs(s._frames[s._frames.length - 1].t - cur);
        this._freeFrame(dFirst >= dLast ? s._frames.shift() : s._frames.pop());
      }
      if(s._frames.length >= s._frameMax) s._bufferComplete = true;
      // 1 周ぶん埋まったら bufferComplete (Reverse 突入条件として残す。capture は止めない)
      const dur = vEl.duration;
      if(isFinite(dur) && dur > 0 && s._frames.length >= 2){
        const span = s._frames[s._frames.length-1].t - s._frames[0].t;
        if(span >= dur - 0.5) s._bufferComplete = true;
      }
    }catch(e){ /* CORS / decode error */ }
  },

  _clearFrames(s){
    this._freeFrames(s._frames);
    s._frames = [];
    s._revCursor = 0;
    s._lastCaptureT = 0;
    s._bufferComplete = false;
  },

  // ライブラリ全動画を seek-based でプリフィルしてキャッシュに保存。
  //   進捗は onProgress(name, doneCount, totalCount) で通知。
  //   全完了で onComplete() を呼び、Notification API でブラウザ通知も飛ばす。
  async preloadAll(onProgress, onComplete){
    if(this._preloadActive) return;
    if(!this.library || !this.library.length){ if(onComplete) onComplete(0); return; }
    this._preloadActive = true;
    // 通知許可は事前に要求 (allow/deny どちらでも進める)
    if('Notification' in window && Notification.permission === 'default'){
      try{ await Notification.requestPermission(); }catch(e){}
    }
    const list = this.library.slice();
    let done = 0;
    for(const item of list){
      if(this._cache[item.url] && this._cache[item.url].complete){
        done++;
        if(onProgress) onProgress(item.name, done, list.length, true);
        continue;
      }
      if(onProgress) onProgress(item.name, done, list.length, false);
      try{
        if(typeof Diag !== 'undefined') Diag.log('preload', `${done+1}/${list.length} ${item.name}`);
        const frames = await this._prefillToCache(item.url);
        if(frames && frames.length){
          this._cache[item.url] = { frames, complete: true };
        }
      }catch(e){ console.warn('preload failed:', item.url, e); }
      done++;
    }
    this._preloadActive = false;
    if(onComplete) onComplete(done);
    if('Notification' in window && Notification.permission === 'granted'){
      try{
        new Notification('VJ — プリロード完了', {
          body: `${done} 件の動画をリバース用にキャッシュしました`,
          silent: false,
        });
      }catch(e){}
    }
  },

  // URL を 1 本まるごとフレームバッファに展開して返す (キャッシュ用)
  async _prefillToCache(url){
    const v2 = document.createElement('video');
    v2.muted = true;
    v2.playsInline = true;
    v2.preload = 'auto';
    v2.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(v2);
    try{
      const mediaSrc = (await this._cachedObjectUrl(url)) || this._assetUrl(url);
      await new Promise((res, rej)=>{
        let timer = setTimeout(()=>rej(new Error('metadata timeout')), 15000);
        v2.addEventListener('loadedmetadata', ()=>{ clearTimeout(timer); res(); }, {once:true});
        v2.addEventListener('error', ()=>{ clearTimeout(timer); rej(new Error('load error')); }, {once:true});
        v2.src = mediaSrc;
      });
      const dur = v2.duration;
      if(!isFinite(dur) || dur <= 0) throw new Error('no duration');
      const fps = 24;
      // メモリ枯渇防止: フレーム数を上限、解像度も縮小して取り込む
      // (_frameMax はスロット単位のプロパティで Movie 直下には無いため既定値 180 にフォールバック)
      const total = Math.min(this._frameMax || 180, Math.ceil(dur * fps));
      const step = Math.max(1/fps, dur / total);   // 長尺は間隔を広げて全編をカバー (先頭だけで枯れない)
      const MAXDIM = 640; // 取り込み解像度の長辺上限
      const frames = [];
      const cv = document.createElement('canvas');
      const ctx = cv.getContext('2d', { willReadFrequently:true });
      for(let i = 0; i < total; i++){
        const t = Math.min(i * step, dur - 0.001);
        await new Promise((res)=>{
          let done = false;
          const fin = ()=>{ if(done) return; done = true; v2.removeEventListener('seeked', onSeek); res(); };
          const onSeek = fin;
          v2.addEventListener('seeked', onSeek);
          try{ v2.currentTime = t; }catch(e){ fin(); return; }
          setTimeout(fin, 500);
        });
        const vw = v2.videoWidth, vh = v2.videoHeight;
        if(!vw || !vh) continue;
        const sc = Math.min(1, MAXDIM / Math.max(vw, vh));
        const cw = Math.max(1, Math.round(vw * sc)), ch = Math.max(1, Math.round(vh * sc));
        if(cv.width !== cw || cv.height !== ch){ cv.width = cw; cv.height = ch; }
        ctx.drawImage(v2, 0, 0, cw, ch);
        const imgData = ctx.getImageData(0, 0, cw, ch);
        // cached=true: Load キャッシュ共有フレーム (GPU 化された tex はスロット側で解放しない)
        frames.push({ w:cw, h:ch, data:imgData.data, t: v2.currentTime, cached:true });
      }
      return frames;
    } finally {
      if(v2.parentNode) v2.parentNode.removeChild(v2);
    }
  },

  // 隠し videoEl を作り、seek-based でフレームを 1 枚ずつ取り込む。
  // play() に頼らないため autoplay ブロックの影響を受けない。
  async _startPrefill(s, url){
    if(s._prefillV){
      try{ s._prefillV.pause(); }catch(e){}
      if(s._prefillV.parentNode) s._prefillV.parentNode.removeChild(s._prefillV);
      s._prefillV = null;
    }
    const v2 = document.createElement('video');
    v2.muted = true;
    v2.playsInline = true;
    v2.preload = 'auto';
    v2.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(v2);
    s._prefillV = v2;
    s._prefillBlocked = true; // span/wrap での自動凍結を抑止 (この間は明示的に完了を制御)
    try{
      const mediaSrc = (await this._cachedObjectUrl(url)) || this._assetUrl(url);
      await new Promise((res, rej)=>{
        v2.addEventListener('loadedmetadata', res, {once:true});
        v2.addEventListener('error', ()=>rej(new Error('prefill load error')), {once:true});
        v2.src = mediaSrc;
      });
      const dur = v2.duration;
      if(!isFinite(dur) || dur <= 0) throw new Error('no duration');
      // 24fps 想定で 1 周ぶんを seek-by-seek でキャプチャ。
      const fps = 24;
      const total = Math.min(s._frameMax, Math.ceil(dur * fps));
      const step = Math.max(1/fps, dur / total);   // 長尺は間隔を広げて全編をカバー (先頭だけで枯れない)
      // 既存バッファ (main capture が貯めていたぶん) をクリア (GPU テクスチャも解放)
      this._freeFrames(s._frames);
      s._frames = []; s._bufferComplete = false;
      for(let i = 0; i < total; i++){
        if(s._prefillV !== v2) return; // 別のロードで上書き or アンマウント
        const t = Math.min(i * step, dur - 0.001);
        // seeked が来ない seek (currentTime に変化なし、ブラウザ依存) に備えて 500ms フォールバック
        await new Promise((res)=>{
          let done = false;
          const fin = ()=>{ if(done) return; done = true; v2.removeEventListener('seeked', onSeek); res(); };
          const onSeek = fin;
          v2.addEventListener('seeked', onSeek);
          try{ v2.currentTime = t; }catch(e){ fin(); return; }
          setTimeout(fin, 500);
        });
        s._lastCaptureT = 0;
        this._captureFromEl(s, v2);
      }
      s._bufferComplete = true;
    } catch(e){
      console.warn('Movie prefill failed:', e);
    } finally {
      s._prefillBlocked = false;
      if(v2.parentNode) v2.parentNode.removeChild(v2);
      if(s._prefillV === v2) s._prefillV = null;
    }
  },
};
