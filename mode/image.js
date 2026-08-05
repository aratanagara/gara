/* ================= Image (kind:'image') =================
 * images/ 傘下のフォルダを1枚ずつ全画面表示するスライドショー Slot kind。
 *   - フォルダは images/folders.json で列挙 (各フォルダの manifest.json = 画像ファイル一覧)。
 *   - Slot A/B で別々の状態 (フォルダ / 画像 / 順序 / fit) を持つ (Movie._slots と同方式)。
 *     UI (ImageMode.P) は常にアクティブスロットの状態を指す。
 *   - beat モード時は everyBeats 拍ごとに次の画像へ。C キー押下でも送り (App 側から advance)。
 *     order='single' は自動送りなし = 単一画像の固定表示 (Prev/Next で選ぶ)。
 *   - 表示は contain (全体表示・余白は透明)。
 * ==================================================================== */
const ImageMode = {
  initialized: false,
  gl: null,
  DEFAULTS: {
    folder: '',          // 選択中フォルダ dir (例 'images/photo')
    order: 'seq',        // seq | random | single (single=自動送りなしの単一画像固定)
    everyBeats: 4,       // beat モードで何拍ごとに送るか
    fit: 'contain',      // contain | cover | drone
    image: '',           // 現在の画像名 (single の復元用。送りのたび更新)
    transBeats: -1,      // 切替トランジション: -1=Trans 連動 / 0=カット / n=拍数 (startPresetTrans)
    transStyle: -1       // 切替演出: -1=Style 連動 (App.transStyle) / 0=なし (素の Crossfade) / 1..=各演出
  },
  PDefaults: null,

  // スロット別状態
  S: { A: null, B: null },
  _mk(){
    return {
      P: JSON.parse(JSON.stringify(this.DEFAULTS)),
      list: [], names: [], idx: 0,
      texReady: false, nextAdvanceBeat: null, loadToken: 0,
      texA: null, texB: null, curTex: null, prevTex: null,
      curSize: [1,1], prevSize: [1,1],
      mixT: 1, fadeStart: 0
    };
  },
  _uiKey(){ return (typeof App !== 'undefined' && App.activeSlot === 'B') ? 'B' : 'A'; },
  _slot(key){
    key = key === 'B' ? 'B' : 'A';
    if(!this.S[key]) this.S[key] = this._mk();
    const st = this.S[key];
    if(this.gl && !st.texA) this._ensureTex(st);
    return st;
  },
  // UI / 状態保存はアクティブスロットの P を見る (従来の ImageMode.P 互換)
  get P(){ return this._slot(this._uiKey()).P; },

  folders: [],           // [{name, dir, count, images:[...]}] (全スロット共有)

  VS: `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main(){ v_uv = a_pos*0.5+0.5; gl_Position = vec4(a_pos,0.0,1.0); }`,
  FS: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 frag;
uniform sampler2D u_tex;      // 現在の画像
uniform sampler2D u_texPrev;  // 直前の画像 (切替クロスフェード用)
uniform vec2 u_viewSize;
uniform vec2 u_imgSize;
uniform vec2 u_imgSizePrev;
uniform int  u_fit;      // 0=contain, 1=cover, 2=drone (cover ベースでゆっくり寄り引き + 浮遊パン)
uniform float u_time;    // drone 用の時間 (GL.clock = Space フリーズ/逆再生に追従)
uniform float u_seed;    // 画像ごとの位相ずらし
uniform float u_mixT;    // 0=prev .. 1=cur
vec4 sampleFit(sampler2D tex, vec2 imgSize){
  vec2 uv = v_uv;
  uv.y = 1.0 - uv.y;     // 画像は上下反転でアップロードされるので戻す
  if(imgSize.x > 0.5 && imgSize.y > 0.5){
    float va = u_viewSize.x / max(u_viewSize.y, 1.0);
    float ta = imgSize.x  / max(imgSize.y,  1.0);
    vec2 s = (u_fit >= 1) ? ((va > ta) ? vec2(1.0, va/ta) : vec2(ta/va, 1.0))
                          : ((va > ta) ? vec2(ta/va, 1.0) : vec2(1.0, va/ta));
    uv = (uv - 0.5) / s + 0.5;
    if(u_fit == 2){
      // ドローン風: ~20 秒周期でズームし、余白の範囲でリサージュに漂う (常に cover を維持)
      float z = 1.18 + 0.16 * sin(u_time * 0.32 + u_seed);
      float m = 0.5 * (1.0 - 1.0 / z);
      uv = (uv - 0.5) / z + 0.5
         + m * vec2(sin(u_time * 0.23 + u_seed * 1.7), cos(u_time * 0.19 + u_seed * 2.3));
    }
  }
  if(u_fit == 0 && (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)) return vec4(0.0);   // contain の余白は透明
  return texture(tex, clamp(uv, 0.0, 1.0));
}
void main(){
  vec4 cur = sampleFit(u_tex, u_imgSize);
  if(u_mixT >= 0.999){ frag = cur; return; }
  vec4 prev = sampleFit(u_texPrev, u_imgSizePrev);
  frag = mix(prev, cur, clamp(u_mixT, 0.0, 1.0));
}`,

  init(gl){
    if(this.initialized) return true;
    this.gl = gl;

    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, this.VS); gl.compileShader(vs);
    if(!__glReady(gl, vs, false)){ console.error('ImageMode vs:', gl.getShaderInfoLog(vs)); return false; }
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, this.FS); gl.compileShader(fs);
    if(!__glReady(gl, fs, false)){ console.error('ImageMode fs:', gl.getShaderInfoLog(fs)); return false; }
    this.prog = gl.createProgram();
    gl.attachShader(this.prog, vs); gl.attachShader(this.prog, fs); gl.linkProgram(this.prog);
    if(!__glReady(gl, this.prog, true)){ console.error('ImageMode link:', gl.getProgramInfoLog(this.prog)); return false; }
    this.locPos = gl.getAttribLocation(this.prog, 'a_pos');
    this.locTex = gl.getUniformLocation(this.prog, 'u_tex');
    this.locTexPrev = gl.getUniformLocation(this.prog, 'u_texPrev');
    this.locView = gl.getUniformLocation(this.prog, 'u_viewSize');
    this.locImg = gl.getUniformLocation(this.prog, 'u_imgSize');
    this.locImgPrev = gl.getUniformLocation(this.prog, 'u_imgSizePrev');
    this.locFit = gl.getUniformLocation(this.prog, 'u_fit');
    this.locTime = gl.getUniformLocation(this.prog, 'u_time');
    this.locSeed = gl.getUniformLocation(this.prog, 'u_seed');
    this.locMixT = gl.getUniformLocation(this.prog, 'u_mixT');
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    this._fadeDur = 0.35;

    this.initialized = true;
    this.loadFolderIndex();
    return true;
  },

  // ピンポン2枚: 切替時に旧画像(prevTex)→新画像(curTex)をクロスフェード (スロット別)
  _ensureTex(st){
    const gl = this.gl;
    const mkTex = ()=>{
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,0]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    st.texA = mkTex(); st.texB = mkTex();
    st.curTex = st.texA; st.prevTex = st.texB;
  },

  // images/folders.json を読む (キャッシュバスト)
  async loadFolderIndex(){
    if(this.folders.length) return this.folders;
    try{
      const r = await fetch('images/folders.json?t=' + Date.now(), { cache:'no-store' });
      if(r.ok){
        const d = await r.json();
        if(Array.isArray(d)) this.folders = d;
      }
    }catch(e){ console.warn('ImageMode: folders.json load failed', e); }
    // 一覧より先に state 復元で P.folder が入っていたスロットへ再適用 (復元値を優先)
    for(const key of ['A', 'B']){
      const st = this.S[key];
      if(st && st.P.folder && !st.list.length && this._folderByDir(st.P.folder)) this.setFolder(st.P.folder, key, {noSaved:true, noTrans:true});
    }
    if(typeof UI !== 'undefined' && UI.refreshImageMode) UI.refreshImageMode();
    return this.folders;
  },

  _folderByDir(dir){ return this.folders.find(f => f.dir === dir) || null; },

  // ドラッグ&ドロップの臨時フォルダ (セッション限り。blob URL なのでリロードで消える)
  DROP_DIR: '(drop)',
  addDroppedFiles(files){
    let f = this._folderByDir(this.DROP_DIR);
    if(!f){
      f = { name:'ドロップ (臨時)', dir:this.DROP_DIR, count:0, images:[], _urls:[] };
      this.folders.unshift(f);
    }
    let added = 0;
    for(const file of (files || [])){
      if(!file || !file.type || file.type.indexOf('image/') !== 0) continue;
      f._urls.push(URL.createObjectURL(file));
      f.images.push(file.name || ('drop ' + (f._urls.length)));
      added++;
    }
    f.count = f._urls.length;
    if(added) this.setFolder(this.DROP_DIR);   // アクティブスロットへ
    return added;
  },

  // ================= フォルダ/画像ごとの設定保存 (md の mdParams と同方式) =================
  //   キーは folders.json の dir (単一画像エントリはファイルパス) なので両方を一意に扱える。
  //   'vj.def.' プレフィックスで defs サーバー同期にも自動で乗る (別端末へも反映)。
  _folderParamKey: 'vj.def.image.folderParams',
  FOLDER_KEYS: ['order', 'everyBeats', 'fit', 'transBeats', 'transStyle'],
  _storedFolderParams(){
    try{ return JSON.parse(localStorage.getItem(this._folderParamKey) || '{}'); }
    catch(e){ return {}; }
  },
  saveFolderParams(key){
    const st = this._slot(key || this._uiKey());
    if(!st.P.folder) return false;
    const all = this._storedFolderParams();
    // 初期値と同じ値も含めて全キーを保存 (差分保存だと前の選択の値が残る事故が起きる)
    const out = {};
    for(const k of this.FOLDER_KEYS) out[k] = st.P[k];
    all[st.P.folder] = out;
    try{ localStorage.setItem(this._folderParamKey, JSON.stringify(all)); }catch(e){ return false; }
    if(typeof App !== 'undefined' && App.uploadDefs) App.uploadDefs();
    return true;
  },
  clearFolderParams(key){
    const st = this._slot(key || this._uiKey());
    if(!st.P.folder) return;
    const all = this._storedFolderParams();
    delete all[st.P.folder];
    try{ localStorage.setItem(this._folderParamKey, JSON.stringify(all)); }catch(e){}
    if(typeof App !== 'undefined' && App.uploadDefs) App.uploadDefs();
  },
  hasFolderParams(dir){ return !!(dir && this._storedFolderParams()[dir]); },

  // フォルダを選択 → 画像 URL 配列を構築して先頭 (P.image があればその画像) を表示
  //   opts.noSaved: フォルダごとの保存設定を適用しない (プリセット/state 復元 = 復元値を優先)
  setFolder(dir, key, opts){
    const st = this._slot(key || this._uiKey());
    const f = this._folderByDir(dir);
    if(!f){ st.P.folder = ''; st.list = []; st.names = []; return; }
    st.P.folder = dir;
    if(!(opts && opts.noSaved)){
      const saved = this._storedFolderParams()[dir];
      if(saved){ for(const k of this.FOLDER_KEYS) if(saved[k] !== undefined) st.P[k] = saved[k]; }
    }
    st.names = (f.images || []).slice();
    // single エントリ (images/ 直下の 1 枚もの) は dir 自体がファイルパス
    st.list = f._urls ? f._urls.slice() : (f.single ? [f.dir] : st.names.map(name => dir + '/' + name));
    st.idx = 0;
    st.nextAdvanceBeat = null;
    if(st.P.image){
      const i = st.names.indexOf(st.P.image);
      if(i >= 0) st.idx = i;
    }
    if(st.P.order === 'random' && !st.P.image) st.idx = Math.floor(Math.random() * Math.max(1, st.list.length));
    this._loadCurrent(st, opts && opts.noTrans);
    if(typeof UI !== 'undefined' && UI.refreshImageMode) UI.refreshImageMode();
  },

  // プリセット/state 復元。新形式 {A:P, B:P} はスロット別に、旧形式 (単一 P) は両スロットへ適用
  applyState(d){
    if(!d || typeof d !== 'object') return;
    const perSlot = (d.A || d.B) ? d : null;
    for(const key of ['A', 'B']){
      const src = perSlot ? perSlot[key] : d;
      if(!src || typeof src !== 'object') continue;
      const st = this._slot(key);
      const before = { folder: st.P.folder, image: st.P.image };
      Object.assign(st.P, JSON.parse(JSON.stringify(src)));
      // 同一フォルダ・同一画像ならリスト再構築も画像リロードもしない
      // (プリセット呼出のたびに再読込するとちらつき + トランジション二重発火になる)
      const unchanged = st.P.folder === before.folder && st.P.image === before.image && st.list.length > 0;
      // フォルダ一覧が未ロード (起動直後の state 復元) なら P を保持したままにする
      // → loadFolderIndex 完了時に再適用される
      // noSaved: 復元値を優先 / noTrans: プリセット側のトランジションに任せる (二重発火防止)
      if(!unchanged && st.P.folder && this._folderByDir(st.P.folder)) this.setFolder(st.P.folder, key, {noSaved:true, noTrans:true});
      else if(!st.P.folder){ st.list = []; st.names = []; st.idx = 0; }
    }
  },

  _now(){ return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000; },

  // noTrans: プリセット/state 復元からの読込 → 全画面トランジションを発火しない
  //   (プリセット側のトランジションと二重になるため。内蔵クロスフェードのみでつなぐ)
  _loadCurrent(st, noTrans){
    const url = st.list[st.idx];
    if(!url || !this.gl) return;
    st.P.image = st.names[st.idx] || '';
    const token = ++st.loadToken;
    const img = new Image();
    img.decoding = 'async';
    img.onload = ()=>{
      if(token !== st.loadToken || !this.initialized) return;
      const gl = this.gl;
      if(!st.texA) this._ensureTex(st);
      // 旧画像を prev に退避し、新画像を空いている方のテクスチャへアップロード → フェード開始
      const target = st.prevTex;                 // 描画に使っていない方
      st.prevTex = st.curTex; st.prevSize = st.curSize;
      gl.bindTexture(gl.TEXTURE_2D, target);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      try{
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        st.curTex = target;
        st.curSize = [img.naturalWidth || 1, img.naturalHeight || 1];
        st.texReady = true;
        // Transition: P.transBeats で選択 (-1=グローバル Trans 連動 / 0=カット / n=拍数指定)。
        // 拍数 > 0 なら VJ 標準の presetTrans (Style 適用)、それ以外はシェーダ内の簡易クロスフェード。
        const own = (typeof st.P.transBeats === 'number') ? st.P.transBeats : -1;
        const beats = own >= 0 ? own : ((typeof App !== 'undefined') ? (App.transBeats || 0) : 0);
        const first = !(st.prevSize[0] > 1);
        if(!first && !noTrans && beats > 0 && typeof GL !== 'undefined' && GL.startPresetTrans){
          st.mixT = 1;                                     // 内部フェードは使わない
          const style = (typeof st.P.transStyle === 'number' && st.P.transStyle >= 0) ? st.P.transStyle : ((typeof App !== 'undefined') ? (App.transStyle || 0) : 0);
          GL.startPresetTrans(beats, style);
        } else if(!first && own === 0){
          st.mixT = 1;                                     // カット: 即時切替
        } else {
          st.fadeStart = this._now();
          st.mixT = first ? 1 : 0;                         // 初回(prev 未設定)はフェードなし
        }
      }catch(e){ st.texReady = false; }
      if(typeof UI !== 'undefined' && UI.refreshImageMode) UI.refreshImageMode();
    };
    img.onerror = ()=>{};
    img.src = url;
  },

  // 次の画像へ (C キー / beat 送り / UI ボタン)。key 省略時はアクティブスロット
  advance(dir, key){
    const st = this._slot(key || this._uiKey());
    const n = st.list.length;
    if(!n) return;
    if(st.P.order === 'random'){
      let i = Math.floor(Math.random() * n);
      if(n > 1 && i === st.idx) i = (i + 1) % n;
      st.idx = i;
    } else {
      st.idx = ((st.idx + (dir < 0 ? -1 : 1)) % n + n) % n;
    }
    this._loadCurrent(st);
  },

  currentInfo(key){
    const st = this._slot(key || this._uiKey());
    const n = st.list.length;
    if(!n) return { n:0, idx:0, name:'' };
    return { n, idx: st.idx, name: st.names[st.idx] || '' };
  },

  // 毎フレーム (スロット描画から): beat モードなら everyBeats 拍ごとに送る。single は送りなし
  update(beat, beatMode, key){
    if(!this.initialized) return;
    const st = this._slot(key);
    if(!st.list.length) return;
    if(!beatMode || st.P.order === 'single'){ st.nextAdvanceBeat = null; return; }   // single のみ自動送りなし
    const every = Math.max(1, st.P.everyBeats | 0);
    if(st.nextAdvanceBeat == null){
      st.nextAdvanceBeat = Math.ceil((beat + 0.0001) / every) * every;
      return;
    }
    if(beat >= st.nextAdvanceBeat){
      st.nextAdvanceBeat += every;
      // 拍が大きく跳んだ場合 (クロックリセット / 逆再生からの復帰等) は再同期して
      // 1 枚だけ送る。差分を毎フレーム消化すると連続送りで一周してしまう
      if(beat >= st.nextAdvanceBeat) st.nextAdvanceBeat = Math.ceil((beat + 0.0001) / every) * every;
      this.advance(1, key);
    }
  },

  render(opts){
    if(!this.initialized) return;
    const gl = this.gl, { fbo, w, h } = opts;
    const key = opts.slot === 'B' ? 'B' : 'A';
    const st = this._slot(key);
    // クロスフェード進行 (smoothstep)
    if(st.mixT < 1){
      const u = this._fadeDur > 0 ? (this._now() - st.fadeStart) / this._fadeDur : 1;
      st.mixT = u >= 1 ? 1 : Math.max(0, u*u*(3 - 2*u));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if(!st.texA) this._ensureTex(st);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, st.curTex);
    gl.uniform1i(this.locTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, st.prevTex);
    gl.uniform1i(this.locTexPrev, 1);
    gl.uniform2f(this.locView, w, h);
    gl.uniform2f(this.locImg, st.curSize[0], st.curSize[1]);
    gl.uniform2f(this.locImgPrev, st.prevSize[0], st.prevSize[1]);
    gl.uniform1i(this.locFit, st.P.fit === 'drone' ? 2 : (st.P.fit === 'cover' ? 1 : 0));
    gl.uniform1f(this.locTime, (typeof GL !== 'undefined' && typeof GL.clock === 'number') ? GL.clock : this._now());
    gl.uniform1f(this.locSeed, (st.idx * 2.399 + (key === 'B' ? 1.234 : 0)) % 6.2832);
    gl.uniform1f(this.locMixT, st.mixT);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(this.locPos);
    gl.vertexAttribPointer(this.locPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
};
// PDefaults はスクリプト読込時に確定する (state 復元が init より先に走っても汚染されないように)
ImageMode.PDefaults = JSON.parse(JSON.stringify(ImageMode.DEFAULTS));
if(typeof window !== 'undefined') window.ImageMode = ImageMode;
