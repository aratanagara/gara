/* ================= SpaceType (kind:'spacetype') =================
 * md テキスト(コンクリートポエトリー等)を 3D 空間タイポグラフィとして表示。
 * 参考: spacetypegenerator.com
 *   文字をグリフアトラス(2D canvas)化 → WebGL の 3D 空間にクアッド配置。
 *   シーン: wave(波打つ文字面) / tunnel(文字リングのトンネル) /
 *           cylinder(回転円筒) / sphere(文字球) / scatter(空間散布) / fall(文字の雨)。
 *   md は TextDeform のプリセット群を共有し、md ごとのパラメータ調整を
 *   localStorage に保存できる(Ugomeki と同仕様)。
 *   ugomeki.js のヘルパ(mtGraphemes/mtN1/mtMulberry/MT_FONTS)と
 *   photoplane.js の行列(PhotoPlane.m4)を共有する。index.html の読込順は
 *   photoplane.js → ugomeki.js → spacetype.js を維持すること。
 * ==================================================================== */

/* md ごとに保存するパラメータのキー */
const ST_MD_KEYS = ['scene','fontFamily','bold','ink','paper','accent','accentRatio',
  'size','density','depth','waveAmp','waveFreq','speed','spin','jitter',
  // 注: sceneBeats / sceneSecs (サイクル周期) は md ごとに保存しない。
  //     保存すると md を送るたびに周期が上書きされ、拍グリッドが再同期されて
  //     シーンの自動切替が止まってしまうため、autoCycle 等と同じランタイム設定として扱う。
  'fov','dist','camEl','beatPulse','seed',
  'camOrbit','orbitSpeed','billboard','depthFade','transparentBg','radius','rowGap','tracking','emojiColor',
  'tiltX','tiltY','roll','extrude','sideShade','sideColorOn','sideColor','fold',
  'lag','swayAmp','swayFreq','droop','twist','faceVel'];

const ST_SCENES = ['wave','wall','arc','tunnel','cylinder','helix','sphere','rings','ribbon','lissajous','vortex','burst','scatter','fall'];

/* カラー絵文字フォント(アトラス描画時に書体の末尾へ足す) */
// 絵文字 → 全 Unicode カバーの Unifont の順で足す (どの書体でも豆腐を出さない)
const ST_EMOJI_FB = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Unifont VJ"';

/* ---- グリフ輪郭抽出 (真の押し出し用) ----
   2値マスクから前景ピクセルの境界エッジを集め、ループに連結 → RDP で単純化。
   戻り値: [-1..1] ローカル座標(y上向き)のループ配列 [[x0,y0,x1,y1,...], ...] */
function stRDP(pts, eps){
  const dseg = (p,a,b)=>{
    const dx=b[0]-a[0], dy=b[1]-a[1]; const l2=dx*dx+dy*dy||1;
    let t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2; t=Math.max(0,Math.min(1,t));
    const qx=a[0]+t*dx-p[0], qy=a[1]+t*dy-p[1]; return qx*qx+qy*qy;
  };
  const rdp = (arr)=>{
    if(arr.length<3) return arr;
    const a=arr[0], b=arr[arr.length-1];
    let mi=-1, md=0;
    for(let i=1;i<arr.length-1;i++){ const d=dseg(arr[i],a,b); if(d>md){ md=d; mi=i; } }
    if(md <= eps*eps) return [a,b];
    const L=rdp(arr.slice(0,mi+1)), R=rdp(arr.slice(mi));
    return L.slice(0,-1).concat(R);
  };
  const closed = pts.concat([pts[0]]);
  const r = rdp(closed); r.pop();
  return r;
}
function stTraceLoops(mask, G, eps){
  const at = (x,y)=> (x>=0&&y>=0&&x<G&&y<G) ? mask[y*G+x] : 0;
  const key = (x,y)=> y*(G+1)+x;
  // 前景を左に見る向き(画像座標で時計回り)の境界エッジ: 頂点→次頂点
  const nxt = new Map();
  for(let y=0;y<G;y++) for(let x=0;x<G;x++){
    if(!at(x,y)) continue;
    if(!at(x,y-1)) nxt.set(key(x,y),     key(x+1,y));
    if(!at(x+1,y)) nxt.set(key(x+1,y),   key(x+1,y+1));
    if(!at(x,y+1)) nxt.set(key(x+1,y+1), key(x,y+1));
    if(!at(x-1,y)) nxt.set(key(x,y+1),   key(x,y));
  }
  const used = new Set(), out = [];
  for(const s of nxt.keys()){
    if(used.has(s)) continue;
    const pts = []; let cur = s, guard = nxt.size + 2, closedLoop = false;
    while(guard-- > 0){
      used.add(cur); pts.push(cur);
      cur = nxt.get(cur);
      if(cur === undefined) break;
      if(cur === s){ closedLoop = true; break; }
      if(used.has(cur)) break;
    }
    if(!closedLoop || pts.length < 4) continue;
    let poly = pts.map(k=>[k%(G+1), Math.floor(k/(G+1))]);
    poly = stRDP(poly, eps);
    if(poly.length < 3) continue;
    const flat = [];
    for(const p of poly){ flat.push(p[0]/G*2-1, 1-p[1]/G*2); }   // y反転(上向き)
    out.push(flat);
  }
  return out;
}

/* 絵文字(カラーグリフ)判定: 絵文字はインク色で塗らず元色のまま描く */
let _stEmojiRe = null;
function stIsEmoji(ch){
  if(_stEmojiRe === null){
    try{ _stEmojiRe = new RegExp('\\p{Extended_Pictographic}', 'u'); }catch(e){ _stEmojiRe = false; }
  }
  if(_stEmojiRe) return _stEmojiRe.test(ch);
  const c = ch.codePointAt(0);   // フォールバック: 主要な絵文字ブロックのみ
  return (c>=0x1F000 && c<=0x1FAFF) || (c>=0x2600 && c<=0x27BF) || (c>=0xFE00 && c<=0xFE0F);
}

const SpaceType = {
  initialized: false,
  gl: null,
  ok: false,

  P: {
    scene: 'wave',
    sceneMode: 'saved',    // saved=呼び出した md に保存した scene を再生(既定) / random=毎回ランダム抽選 / fixed=固定
    cycleReload: false,    // 自動サイクルで md を送るとき、md の保存プリセットを読み直す
                           //   (false=テキストだけ差し替えて今の見た目を維持)
    sceneBeats: 16,        // 何拍ごとにシーン/mdを送るか (自動切替は beat モード限定)
    fontFamily: (typeof MT_FONTS !== 'undefined') ? MT_FONTS[1].ff : 'sans-serif',
    bold: false,
    ink: '#f2f0ea', paper: '#0a0a10',
    accent: '#ff4530', accentRatio: 8,   // アクセント色の文字割合%
    size: 1.0,           // 文字の大きさ(ワールド単位)
    density: 1.0,        // 行/リング/文字の密度倍率
    depth: 24,           // 空間の奥行き/広がり
    waveAmp: 1.2,        // 波・うねりの振幅
    waveFreq: 1.0,       // 波の周波数
    speed: 1.0,          // 流れ/落下/前進の速度
    spin: 0.3,           // 回転速度
    jitter: 0.3,         // 文字ごとの揺らぎ
    // 文字自体の 3D 変形
    tiltX: 0,            // 天地方向へ倒す(度)。文字面が奥へ寝る
    tiltY: 0,            // 左右へ振る(度)。面が edge-on になり厚みが見える
    roll: 0,             // 面内回転(度)
    extrude: 0,          // 押し出し(%)。輪郭に沿った側壁で厚みを作る
    sideShade: 45,       // 押し出し側面の明るさ下限(%)。100=陰影なし(前面と同じ Ink 色)
    sideColorOn: false,  // false(既定)=文字の縁の色をそのまま引き延ばす / true=押し出し面を sideColor で塗る
    sideColor: '#303030',// 押し出し面の専用色 (ピッカー操作で有効化、ダブルクリックで既定へ)
    fold: 0,             // 折り(%)。中央の縦線で観音開きに折る
    // 進行方向に対する「しなり」系
    lag: 0,              // 追従遅れ(%)。進行方向の後ろへ引かれて弓なりにしなる
    swayAmp: 0,          // なびき(%)。旗のように波打つ
    swayFreq: 1.5,       // なびきの波数
    droop: 0,            // 垂れ(%)。左右の端が重力で垂れ下がる
    twist: 0,            // ねじれ(度)。字面の左右で軸がねじれる
    faceVel: 0,          // 進行方向へ向く度合い(%)。速度ベクトルに文字が正対
    radius: 1.0,         // tunnel/cylinder/sphere の半径倍率
    rowGap: 1.0,         // 行間(wave の奥行き間隔 / cylinder の段間)倍率
    tracking: 1.0,       // 字送り(wave の字間 / tunnel・cylinder の角度間隔)倍率
    fov: 70, dist: 16, camEl: 0.12,
    autoCycle: true,     // シーン/md の自動送り
    camOrbit: true,      // カメラ自動周回
    orbitSpeed: 0.1,     // カメラ周回速度
    billboard: false,    // 全シーンで文字を常にカメラへ向ける
    depthFade: true,     // 奥/端で文字をフェード (tunnel/fall)
    emojiColor: true,    // 絵文字を元の色のまま描く (OFF=インク色シルエット)
    transparentBg: false, // Slot A でも背景を透過
    beatPulse: 0.35,     // 拍で文字が脈動する量
    seed: 1,
    mdMode: 'random', mdIndex: -1,
    text: '空間の詩\nことばが\nかたちになる'
  },
  PDefaults: null,
  _mdParamStoreKey: 'vj.spacetype.mdParams',

  /* TextDeform と同じ md プリセット群(name/text)を共有 */
  get mdSources(){
    if(typeof TextDeform !== 'undefined' && TextDeform.presets) return TextDeform.presets;
    return [{name:'(builtin)', text: this.P.text}];
  },

  // ================= GL =================
  VS: `#version 300 es
precision highp float;
in vec3 aPos;
in vec2 aUV;
in vec4 aExtra;      // x=alpha, y=accent(0/1), z=カラーグリフ(絵文字)フラグ, w=シェード(押し出し側面)
uniform mat4 uVP;
out vec2 vUv; out vec4 vExtra;
void main(){ vUv = aUV; vExtra = aExtra; gl_Position = uVP * vec4(aPos, 1.0); }`,
  FS: `#version 300 es
precision highp float;
in vec2 vUv; in vec4 vExtra;
uniform sampler2D uTex;
uniform vec3 uInk, uAccent, uSideCol;
out vec4 frag;
void main(){
  vec4 tx = texture(uTex, vUv);
  float a = tx.a * vExtra.x;
  // 側面レイヤー(shade<1)は閾値を上げて硬いエッジに → 層の縞が見えずソリッドな断面になる
  if(a < (vExtra.w < 0.999 ? 0.45 : 0.05)) discard;
  vec3 col = mix(uInk, uAccent, vExtra.y);
  if(vExtra.z > 1.5) col = uSideCol;      // 押し出し面(側壁/背面): 専用色
  else if(vExtra.z > 0.5) col = tx.rgb;   // 絵文字: アトラスの元色をそのまま使う
  col *= vExtra.w;                        // 押し出し側面の陰影(前面=1.0)
  frag = vec4(col, vExtra.w < 0.999 ? vExtra.x : a);
}`,

  MAX_INST: 4000,      // 文字数の上限
  MAX_QUADS: 24000,    // 1フレームに積めるクアッド数 (extrude/fold で1文字が複数枚になる)
  FLOATS_PER_VERT: 9,

  init(gl){
    if(this.initialized) return true;
    this.gl = gl;
    // PDefaults はスクリプト読込時に確定済み(下部)。init 時に取り直すと、
    // 先に走る state 復元で書き換わった P を「デフォルト」として焼き付けてしまう。

    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, this.VS); gl.compileShader(vs);
    if(!__glReady(gl, vs, false)){ console.error('SpaceType vs:', gl.getShaderInfoLog(vs)); this.initialized = true; return false; }
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, this.FS); gl.compileShader(fs);
    if(!__glReady(gl, fs, false)){ console.error('SpaceType fs:', gl.getShaderInfoLog(fs)); this.initialized = true; return false; }
    this.prog = gl.createProgram();
    gl.attachShader(this.prog, vs); gl.attachShader(this.prog, fs);
    gl.bindAttribLocation(this.prog, 0, 'aPos');
    gl.bindAttribLocation(this.prog, 1, 'aUV');
    gl.bindAttribLocation(this.prog, 2, 'aExtra');
    gl.linkProgram(this.prog);
    if(!__glReady(gl, this.prog, true)){ console.error('SpaceType link:', gl.getProgramInfoLog(this.prog)); this.initialized = true; return false; }
    this.loc = {};
    ['uVP','uTex','uInk','uAccent','uSideCol'].forEach(n => this.loc[n] = gl.getUniformLocation(this.prog, n));

    const FPV = this.FLOATS_PER_VERT;
    this.verts = new Float32Array(this.MAX_QUADS * 6 * FPV);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.verts.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, FPV*4, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, FPV*4, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, FPV*4, 20);
    gl.bindVertexArray(null);

    // グリフアトラス用 2D canvas
    this.atlasCanvas = document.createElement('canvas');
    this.atlasCtx = this.atlasCanvas.getContext('2d', {willReadFrequently:true});
    this.atlasTex = gl.createTexture();
    this.glyphs = {};      // grapheme → {u0,v0,u1,v1,adv}
    this._atlasKey = '';

    this.depthRBO = null; this.depthW = 0; this.depthH = 0;
    this._dirty = true;
    this._cycleAcc = 0;
    this._lastCycleBeat = null;
    this._lastCycleT = null;
    this._lastClock = null;
    this.initialized = true; this.ok = true;
    this._loadScenePref();   // ユーザーが選んだ sceneMode を復元 (state/プリセットからは復元しないため)
    this.loadRandom();
    return true;
  },

  // ================= md プリセット選択 (Ugomeki 互換 API) =================
  loadPreset(i){
    const list = this.mdSources;
    i = Math.max(0, Math.min((list.length || 1) - 1, parseInt(i, 10) || 0));
    const src = list[i];
    if(!src) return;
    const mdMode = this.P.mdMode === 'fixed' ? 'fixed' : 'random';
    // デフォルトへ戻す → md 別の保存パラメータを適用
    const base = JSON.parse(JSON.stringify(this.PDefaults || this.P));
    const saved = this._storedMdParams()[src.name];
    if(saved) for(const k of ST_MD_KEYS){ if(saved[k] !== undefined) base[k] = saved[k]; }
    base.text = src.text;
    base.mdMode = mdMode;
    base.mdIndex = i;
    // ランタイム系は現在値を引き継ぐ
    base.sceneMode = this.P.sceneMode;
    base.autoCycle = this.P.autoCycle;
    base.cycleReload = this.P.cycleReload;
    base.sceneBeats = this.P.sceneBeats;   // サイクル周期は md をまたいで維持する
    if(base.sceneMode === 'random') base.scene = this.P.scene;   // シーンはサイクル側で送る
    this.P = base;
    this._lastPresetI = i;
    this._dirty = true;
  },

  loadSelected(){
    const i = parseInt(this.P.mdIndex, 10);
    if(this.P.mdMode === 'fixed' && this.mdSources[i]){ this.loadPreset(i); return; }
    this.P.mdMode = 'random'; this.P.mdIndex = -1;
    this.loadRandom();
  },

  loadRandom(){
    const n = this.mdSources.length; if(!n) return;
    if(this.P.mdMode === 'fixed' && this.mdSources[this.P.mdIndex]){ this.loadPreset(this.P.mdIndex); return; }
    this.P.mdMode = 'random';
    let i = Math.floor(Math.random()*n);
    if(n > 1 && i === this._lastPresetI) i = (i+1) % n;
    this.loadPreset(i);
  },

  /* 自動サイクル用: 次のランダム md へ。
     keepParams=true(既定) はテキストだけ差し替え、今の見た目(パラメータ)を維持する。
     false は md ごとの保存プリセットを完全リロード(=Cycle Reload チェック ON)。 */
  autoNextMd(keepParams){
    const n = this.mdSources.length; if(!n) return;
    let i = Math.floor(Math.random()*n);
    if(n > 1 && i === this._lastPresetI) i = (i+1) % n;
    this.P.mdMode = 'random';
    if(keepParams) this.loadPresetText(i);
    else this.loadPreset(i);
  },

  /* テキストを差し替え、その md に「デフォルト保存」した値があれば読み込む。
     保存が無い md では現在のパラメータをそのまま使う(初期値へ巻き戻さない)。 */
  loadPresetText(i){
    const list = this.mdSources;
    i = Math.max(0, Math.min((list.length || 1) - 1, parseInt(i, 10) || 0));
    const src = list[i];
    if(!src) return;
    this.P.text = src.text;
    this.P.mdIndex = i;
    const saved = this._storedMdParams()[src.name];
    if(saved){
      // 保存済み md は「保存したときの見た目」で出す (保存に無いキーは初期値へ)。
      // scene の扱いは sceneMode 次第:
      //   saved  = その md に保存した scene を適用 (未保存の md は現状維持)
      //   random = サイクラーが抽選するので保存 scene は適用しない
      //   fixed  = ユーザー固定なので適用しない
      const useSavedScene = (this.P.sceneMode === 'saved');
      const D = this.PDefaults || {};
      for(const k of ST_MD_KEYS){
        if(k === 'scene'){
          if(useSavedScene && saved[k] !== undefined && ST_SCENES.includes(saved[k])) this.P[k] = saved[k];
          continue;
        }
        if(saved[k] !== undefined) this.P[k] = saved[k];
        else if(D[k] !== undefined) this.P[k] = JSON.parse(JSON.stringify(D[k]));
      }
    }
    this._lastPresetI = i;
    this._atlasKey = '';   // 書体が保存値で変わることがある
    this._dirty = true;
  },

  setMdSelection(value){
    if(value === '' || value === 'random' || value == null){
      this.P.mdMode = 'random'; this.P.mdIndex = -1;
      this.loadRandom(); return;
    }
    const i = Math.max(0, Math.min(this.mdSources.length - 1, parseInt(value, 10) || 0));
    this.P.mdMode = 'fixed'; this.P.mdIndex = i;
    this.loadPreset(i);
  },

  currentMdIndex(){
    if(this.P.mdMode === 'fixed' && this.mdSources[this.P.mdIndex]) return this.P.mdIndex;
    return (this._lastPresetI != null && this.mdSources[this._lastPresetI]) ? this._lastPresetI : -1;
  },

  // ================= md ごとのパラメータ保存 =================
  _storedMdParams(){
    try{ return JSON.parse(localStorage.getItem(this._mdParamStoreKey) || '{}'); }
    catch(e){ return {}; }
  },
  saveMdParams(i){
    const src = this.mdSources[i]; if(!src) return false;
    const all = this._storedMdParams();
    // 初期値と同じ値も含めて全キーを保存する。
    //   差分保存だと「初期値と同じ項目」が保存に含まれず、md を切り替えても
    //   前の md の値が残って一部だけ切り替わらない、という事故が起きるため。
    const out = {};
    for(const k of ST_MD_KEYS) out[k] = this.P[k];
    all[src.name] = out;
    try{ localStorage.setItem(this._mdParamStoreKey, JSON.stringify(all)); }catch(e){ return false; }
    return true;
  },
  clearMdParams(i){
    const src = this.mdSources[i]; if(!src) return;
    const all = this._storedMdParams();
    delete all[src.name];
    try{ localStorage.setItem(this._mdParamStoreKey, JSON.stringify(all)); }catch(e){}
  },
  hasMdParams(i){
    const src = this.mdSources[i]; if(!src) return false;
    return !!this._storedMdParams()[src.name];
  },

  setParams(over){
    const font = over && (over.fontFamily !== undefined || over.bold !== undefined);
    Object.assign(this.P, over || {});
    if(font) this._atlasKey = '';   // アトラス作り直し
    this._dirty = true;
  },

  setScene(value){
    if(value === 'random'){ this.P.sceneMode = 'random'; this._saveScenePref(); return; }
    if(value === 'saved'){ this.P.sceneMode = 'saved'; this._dirty = true; this._saveScenePref(); return; }
    if(ST_SCENES.includes(value)){ this.P.sceneMode = 'fixed'; this.P.scene = value; this._dirty = true; this._saveScenePref(); }
  },
  // sceneMode はプリセット/state で復元しないランタイム設定なので、ユーザー選択だけを別枠で永続化する
  _saveScenePref(){ try{ localStorage.setItem('vj.spacetype.sceneMode', this.P.sceneMode); }catch(e){} },
  _loadScenePref(){
    try{
      const m = localStorage.getItem('vj.spacetype.sceneMode');
      if(m === 'random' || m === 'saved' || m === 'fixed') this.P.sceneMode = m;
    }catch(e){}
  },

  /* 配色だけをランダム生成 (Random 🎲 から使う)。
     紙と墨で必ずコントラストを付け、アクセントは補色寄りに。rnd 省略時は都度乱数。 */
  randomizeColors(rnd){
    const P = this.P;
    if(typeof rnd !== 'function') rnd = Math.random;
    const baseH = Math.floor(rnd()*360);
    const accH  = (baseH + 120 + Math.floor(rnd()*140)) % 360;
    const tint  = rnd()*0.3;
    if(rnd() < 0.65){   // 暗地×明字 (VJ 向けに暗背景を多めに)
      P.paper = mtHsl(baseH, tint*0.7, 0.03 + rnd()*0.1);
      P.ink   = mtHsl(baseH, tint*0.5, 0.84 + rnd()*0.14);
    }else{              // 明地×暗字
      P.paper = mtHsl(baseH, tint*0.4, 0.86 + rnd()*0.1);
      P.ink   = mtHsl(baseH, tint,     0.05 + rnd()*0.12);
    }
    P.accent = mtHsl(accH, 0.6 + rnd()*0.4, 0.45 + rnd()*0.2);
  },

  /* シード一発でシーン+動き+3D変形+配色を一括生成 */
  randomize(seed){
    const P = this.P, D = this.PDefaults || P;
    for(const k of ['size','density','depth','waveAmp','waveFreq','speed','spin','jitter','fov','dist','camEl',
                    'radius','rowGap','tracking','orbitSpeed','tiltX','tiltY','roll','extrude','fold',
                    'lag','swayAmp','swayFreq','droop','twist','faceVel'])
      P[k] = D[k];
    const rnd = mtMulberry((seed|0) + 1);
    const R = (a,b)=> a + (b-a)*rnd();
    P.scene   = ST_SCENES[Math.floor(rnd()*ST_SCENES.length)];
    P.size    = Math.round(R(0.6, 1.8)*100)/100;
    P.density = Math.round(R(0.6, 2.2)*100)/100;
    P.depth   = Math.round(R(14, 40));
    P.waveAmp = Math.round(R(0.4, 2.6)*10)/10;
    P.waveFreq= Math.round(R(0.4, 2.2)*10)/10;
    P.speed   = Math.round(R(0.4, 2.0)*100)/100;
    P.spin    = Math.round(R(0.05, 0.9)*100)/100;
    P.jitter  = Math.round(R(0, 0.8)*100)/100;
    P.fov     = Math.round(R(50, 95));
    P.dist    = Math.round(R(10, 24)*10)/10;
    P.camEl   = Math.round(R(-0.4, 0.5)*100)/100;
    P.radius  = Math.round(R(0.6, 1.8)*100)/100;
    P.rowGap  = Math.round(R(0.7, 1.6)*100)/100;
    P.tracking= Math.round(R(0.7, 1.4)*100)/100;
    P.orbitSpeed = Math.round(R(0.02, 0.35)*100)/100;
    // 文字自体の 3D 変形: 全部盛りにせず 1〜3 種だけ効かせる
    const fx = [
      ()=> P.tiltX   = Math.round(R(10, 70)),
      ()=> P.tiltY   = Math.round(R(10, 80)),
      ()=> P.roll    = Math.round(R(5, 45)),
      ()=> P.extrude = Math.round(R(15, 70)),
      ()=> P.fold    = Math.round(R(15, 70)),
      ()=> { P.lag = Math.round(R(25, 90)); P.faceVel = Math.round(R(40, 100)); },
      ()=> { P.swayAmp = Math.round(R(20, 80)); P.swayFreq = Math.round(R(0.6, 3.5)*10)/10; },
      ()=> P.droop   = Math.round(R(20, 70)),
      ()=> P.twist   = Math.round(R(15, 60)),
    ];
    const idx = fx.map((_,i)=>i);
    for(let i=idx.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [idx[i],idx[j]]=[idx[j],idx[i]]; }
    const nFx = 1 + Math.floor(rnd()*3);
    for(let k=0;k<nFx;k++) fx[idx[k]]();
    this.randomizeColors(rnd);
    P.accentRatio = Math.round(R(0, 25));
    // 書体もランダム
    P.fontFamily = (this.FONTS && this.FONTS.length) ? this.FONTS[Math.floor(rnd()*this.FONTS.length)].ff : P.fontFamily;
    P.bold = rnd() < 0.35;
    this._atlasKey = '';   // 書体が変わるのでアトラス作り直し
    P.seed    = seed|0;
    this._dirty = true;
  },

  // ================= md テキスト → 行 =================
  /* 軽量 markdown 除去: 見出し/引用/箇条書き記号・強調・コード・リンクを剥がして本文行だけにする */
  _mdToLines(text){
    const out = [];
    let fence = false;
    for(let line of String(text).replace(/\r\n?/g,'\n').split('\n')){
      if(/^\s*```/.test(line)){ fence = !fence; continue; }
      if(fence) continue;
      line = line.replace(/^\s*#{1,6}\s+/, '')
                 .replace(/^\s*>\s?/, '')
                 .replace(/^\s*[-*+]\s+/, '')
                 .replace(/^\s*\d+[.)]\s+/, '')
                 .replace(/\*\*([^*]+)\*\*/g, '$1')
                 .replace(/\*([^*]+)\*/g, '$1')
                 .replace(/`([^`]+)`/g, '$1')
                 .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
                 .trim();
      if(!line) continue;
      // 豆腐ガード: 現フォント(絵文字フォールバック込み)で描けない文字を代替へ (TextDeform 共用)
      if(typeof TextDeform !== 'undefined' && TextDeform.fixTofu){
        const font = this.P.fontFamily + ',' + ST_EMOJI_FB;
        line = mtGraphemes(line).map(g => TextDeform.fixTofu(g, font, this.P.bold ? 700 : 400)).join('');
      }
      const chars = mtGraphemes(line);
      if(chars.length > 48) line = chars.slice(0, 48).join('');
      out.push(line);
      if(out.length >= 64) break;
    }
    return out.length ? out : ['space type'];
  },

  onFontsReady(){
    // フォント読込前の誤判定を訂正: アトラスキーを捨てて次フレームで組み直す
    this._atlasKey = null;
    if(this.initialized){ try{ this._build(); }catch(e){} }
  },

  // ================= グリフアトラス =================
  _ensureAtlas(chars){
    const P = this.P;
    const uniq = [...new Set(chars)];
    const key = (P.bold?'b|':'n|') + P.fontFamily + '|' + uniq.join('');
    if(key === this._atlasKey) return;
    this._atlasKey = key;

    const FS = 88;
    let cell = 108;
    const n = Math.max(1, uniq.length) + 1;              // +1 = セル0を側面用の白パッチに使う
    const cols = Math.ceil(Math.sqrt(n));
    if(cols*cell > 2048) cell = Math.floor(2048/cols);
    const rows = Math.ceil(n/cols);
    const cv = this.atlasCanvas, ctx = this.atlasCtx;
    cv.width = cols*cell; cv.height = rows*cell;
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const drawFS = FS * (cell/108);   // グリフ数が多くセルを縮めた場合も字面比を維持
    // 書体の末尾にカラー絵文字フォントを足す(どの Typeface でも絵文字が色付きで出る)
    ctx.font = (P.bold?'bold ':'') + drawFS + 'px ' + P.fontFamily + ',' + ST_EMOJI_FB;
    // セル0: 押し出し側面用の白パッチ (中央をサンプルするので端のにじみは無関係)
    ctx.fillRect(cell*0.25, cell*0.25, cell*0.5, cell*0.5);
    this._whiteU = (cell*0.5)/cv.width;
    this._whiteV = (cell*0.5)/cv.height;
    this.glyphs = {};
    uniq.forEach((ch, i)=>{
      const ci = i + 1;   // セル0は白パッチ
      const cx = (ci%cols)*cell + cell/2, cy = Math.floor(ci/cols)*cell + cell/2;
      ctx.fillText(ch, cx, cy);
      const adv = Math.min(2, Math.max(0.35, ctx.measureText(ch).width/drawFS));
      this.glyphs[ch] = {
        u0:(cx-cell/2)/cv.width, v0:(cy-cell/2)/cv.height,
        u1:(cx+cell/2)/cv.width, v1:(cy+cell/2)/cv.height,
        adv,
        color: stIsEmoji(ch) ? 1 : 0,   // カラーグリフ(絵文字)は元色で描く
      };
    });
    this._cellEm = cell/drawFS;   // セル/字面比(クアッドのワールドサイズに使う)

    // ── 押し出し用の輪郭抽出: 各グリフのアルファを G×G で2値化 → 境界ループ ──
    {
      const G = 40;
      const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const mask = new Uint8Array(G*G);
      uniq.forEach((ch, i)=>{
        const g = this.glyphs[ch];
        const ci = i + 1;
        const x0 = (ci%cols)*cell, y0 = Math.floor(ci/cols)*cell;
        for(let gy=0; gy<G; gy++){
          const sy = y0 + Math.floor((gy+0.5)*cell/G);
          for(let gx=0; gx<G; gx++){
            const sx = x0 + Math.floor((gx+0.5)*cell/G);
            mask[gy*G+gx] = img[(sy*cv.width+sx)*4+3] > 100 ? 1 : 0;
          }
        }
        let loops = stTraceLoops(mask, G, 1.25);
        let total = loops.reduce((a,l)=>a+l.length/2, 0);
        if(total > 90){ loops = stTraceLoops(mask, G, 2.2); total = loops.reduce((a,l)=>a+l.length/2, 0); }
        // 各輪郭点に「フチ内側の色」をサンプルする UV を付与 (ストライド 2→4: [x,y,u,v,...])。
        // 絵文字の押し出し面はこの UV でアトラスを引き、フチの色をそのまま奥へ伸ばす。
        // 内側方向は接線の±法線のうちマスク前景側を選ぶ(向き推論不要で確実)。
        const at2 = (px,py)=>{ px|=0; py|=0; return (px>=0&&py>=0&&px<G&&py<G) ? mask[py*G+px] : 0; };
        g.loops = loops.map(lp=>{
          const m = lp.length/2, out2 = new Array(m*4);
          for(let k2=0; k2<m; k2++){
            const x = lp[k2*2], y = lp[k2*2+1];
            const xp = lp[((k2-1+m)%m)*2], yp = lp[((k2-1+m)%m)*2+1];
            const xn = lp[((k2+1)%m)*2],  yn = lp[((k2+1)%m)*2+1];
            let tx2 = xn-xp, ty2 = yn-yp;
            const tl = Math.hypot(tx2,ty2) || 1; tx2/=tl; ty2/=tl;
            // ローカル座標(y上向き) → グリッド座標(y下向き)
            const gx = (x+1)/2*G, gy = (1-y)/2*G;
            const INS = 2.2;
            const n1x = ty2, n1y = tx2;      // 候補法線その1 (グリッド系)
            const c1 = at2(gx + n1x*INS, gy + n1y*INS);
            const c2 = at2(gx - n1x*INS, gy - n1y*INS);
            const sgn = (c1 >= c2) ? 1 : -1;
            const sx2 = Math.max(0.5, Math.min(G-0.5, gx + sgn*n1x*INS));
            const sy2 = Math.max(0.5, Math.min(G-0.5, gy + sgn*n1y*INS));
            out2[k2*4]   = x;
            out2[k2*4+1] = y;
            out2[k2*4+2] = (x0 + sx2*cell/G)/cv.width;
            out2[k2*4+3] = (y0 + sy2*cell/G)/cv.height;
          }
          return out2;
        });
        g.wallCount = total;
      });
    }

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  },

  // ================= インスタンス構築 =================
  _build(){
    const P = this.P;
    const lines = this._mdToLines(P.text);
    const allChars = [];
    const lineChars = lines.map(l => { const cs = mtGraphemes(l).filter(c => c.trim() !== ''); allChars.push(...cs); return cs; });
    this._ensureAtlas(allChars);

    const rnd = mtMulberry((P.seed|0)*7919 + 13);
    const inst = [];
    const acc = ()=> rnd()*100 < P.accentRatio ? 1 : 0;
    const scene = ST_SCENES.includes(P.scene) ? P.scene : 'wave';
    const L = lineChars.length;
    const D = Math.max(4, P.depth);
    const dens = Math.max(0.2, P.density);
    // 全文を1本の連なりとして巡回参照(シーン側で好きな数だけ取る)
    const flat = [];
    lineChars.forEach((cs, li)=> cs.forEach(ch => flat.push(ch)));
    if(!flat.length) flat.push('*');

    // 行組みヘルパー: R 行ぶん、各文字の中心x(em, 中央揃え)を字幅+トラッキングで積んで cb へ渡す
    const rowChars = (R, cb)=>{
      for(let r=0; r<R && inst.length<this.MAX_INST; r++){
        const cs = lineChars[r % L];
        if(!cs.length) continue;
        const advs = cs.map(ch => ((this.glyphs[ch] ? this.glyphs[ch].adv : 1) + 0.12) * P.tracking);
        const total = advs.reduce((a,b)=>a+b,0);
        let cum = -total/2;
        for(let ci=0; ci<cs.length && inst.length<this.MAX_INST; ci++){
          cb(cs[ci], cum + advs[ci]/2, r, R, total);
          cum += advs[ci];
        }
      }
    };

    if(scene === 'wave'){
      const rows = Math.max(2, Math.min(24, Math.round(6*dens)));
      rowChars(rows, (ch, x, r, R)=>
        inst.push({ch, a:x, b:(r-(R-1)/2)*(D/R)*P.rowGap, c:0, sd:rnd()*100, acc:acc()}));
    } else if(scene === 'wall'){
      const rows = Math.max(2, Math.min(26, Math.round(L*Math.max(1, dens))));
      rowChars(rows, (ch, x, r, R)=>
        inst.push({ch, a:x, b:r-(R-1)/2, c:0, sd:rnd()*100, acc:acc()}));
    } else if(scene === 'arc'){
      const rows = Math.max(2, Math.min(20, Math.round(L*Math.max(1, dens))));
      rowChars(rows, (ch, x, r, R, total)=>
        inst.push({ch, a:x, b:r-(R-1)/2, c:total, p:(r%2)?-1:1, sd:rnd()*100, acc:acc()}));
    } else if(scene === 'tunnel'){
      const rings = Math.max(4, Math.min(30, Math.round(8*dens)));
      for(let r=0; r<rings && inst.length<this.MAX_INST; r++){
        const cs = lineChars[r % L];
        const n = Math.max(6, cs.length);
        for(let ci=0; ci<n && inst.length<this.MAX_INST; ci++){
          const ch = cs.length ? cs[ci % cs.length] : flat[ci % flat.length];
          inst.push({ch, a:ci/n*Math.PI*2*P.tracking, b:r/rings, c:r, sd:rnd()*100, acc:acc()});
        }
      }
    } else if(scene === 'cylinder'){
      const rows = Math.max(2, Math.min(24, Math.round(6*dens)));
      for(let r=0; r<rows && inst.length<this.MAX_INST; r++){
        const cs = lineChars[r % L];
        const n = Math.max(8, cs.length);
        for(let ci=0; ci<n && inst.length<this.MAX_INST; ci++){
          const ch = cs.length ? cs[ci % cs.length] : flat[ci % flat.length];
          inst.push({ch, a:ci/n*Math.PI*2*P.tracking, b:r, c:rows, sd:rnd()*100, acc:acc()});
        }
      }
    } else if(scene === 'sphere'){
      const count = Math.min(this.MAX_INST, Math.max(40, Math.round(flat.length*dens*2)));
      const ga = Math.PI*(3 - Math.sqrt(5));   // 黄金角(フィボナッチ球)
      for(let i=0; i<count; i++){
        const y = 1 - (i + 0.5)/count*2;
        inst.push({ch:flat[i % flat.length], a:ga*i, b:y, c:Math.sqrt(Math.max(0,1-y*y)), sd:rnd()*100, acc:acc()});
      }
    } else if(scene === 'helix'){
      const turns = Math.max(2, Math.min(10, Math.round(4*dens)));
      const perTurn = Math.max(8, Math.round(14*Math.max(0.3, P.tracking)));
      const count = Math.min(this.MAX_INST, turns*perTurn);
      for(let i=0; i<count; i++)
        inst.push({ch:flat[i % flat.length], a:i/perTurn*Math.PI*2, b:i/Math.max(1,count-1), c:0, sd:rnd()*100, acc:acc()});
    } else if(scene === 'rings'){
      const nR = Math.max(2, Math.min(10, Math.round(4*dens)));
      for(let r=0; r<nR && inst.length<this.MAX_INST; r++){
        const cs = lineChars[r % L];
        const n = Math.max(8, Math.round((cs.length || 8) * (0.6 + (r+1)/nR)));
        for(let ci=0; ci<n && inst.length<this.MAX_INST; ci++){
          const ch = cs.length ? cs[ci % cs.length] : flat[ci % flat.length];
          inst.push({ch, a:ci/n*Math.PI*2*P.tracking, b:r, c:nR, sd:rnd()*100, acc:acc()});
        }
      }
    } else if(scene === 'ribbon' || scene === 'lissajous'){
      const count = Math.min(this.MAX_INST, Math.max(40, Math.round(flat.length*dens*2)));
      for(let i=0; i<count; i++)
        inst.push({ch:flat[i % flat.length], a:i, b:i/Math.max(1,count), c:0, sd:rnd()*100, acc:acc()});
    } else if(scene === 'vortex'){
      const count = Math.min(this.MAX_INST, Math.max(40, Math.round(flat.length*dens*2)));
      for(let i=0; i<count; i++)
        inst.push({ch:flat[i % flat.length], a:rnd()*Math.PI*2, b:rnd(), c:0, sd:rnd()*100, acc:acc()});
    } else if(scene === 'burst'){
      const count = Math.min(this.MAX_INST, Math.max(40, Math.round(flat.length*dens*2)));
      for(let i=0; i<count; i++){
        const th = rnd()*Math.PI*2, ph2 = Math.acos(2*rnd()-1);
        inst.push({ch:flat[i % flat.length], a:Math.sin(ph2)*Math.cos(th), b:Math.cos(ph2), c:Math.sin(ph2)*Math.sin(th), p:rnd(), sd:rnd()*100, acc:acc()});
      }
    } else if(scene === 'scatter'){
      const count = Math.min(this.MAX_INST, Math.max(40, Math.round(flat.length*dens*2)));
      for(let i=0; i<count; i++){
        inst.push({ch:flat[i % flat.length],
          a:(rnd()-0.5)*D, b:(rnd()-0.5)*D*0.7, c:(rnd()-0.5)*D,
          sd:rnd()*100, acc:acc()});
      }
    } else {   // fall
      const count = Math.min(this.MAX_INST, Math.max(40, Math.round(flat.length*dens*2)));
      for(let i=0; i<count; i++){
        inst.push({ch:flat[i % flat.length],
          a:(rnd()-0.5)*D*0.9, b:rnd()*D, c:(rnd()-0.5)*D*0.5,
          sd:rnd()*100, acc:acc()});
      }
    }
    this.inst = inst;
    this._builtScene = scene;
    this._dirty = false;
    this._velReady = false;   // 文字の並びが変わったので速度差分を取り直す
  },

  // ================= フレーム毎の頂点書き込み =================
  _pushQuad(o, cx,cy,cz, rx,ry,rz, ux,uy,uz, u0,v0,u1,v1, alpha, accF, colF, shade){
    const v = this.verts;
    const put = (px,py,pz,u,vv)=>{
      v[o++]=px; v[o++]=py; v[o++]=pz; v[o++]=u; v[o++]=vv; v[o++]=alpha; v[o++]=accF; v[o++]=colF; v[o++]=shade;
    };
    const x00=cx-rx-ux, y00=cy-ry-uy, z00=cz-rz-uz;
    const x10=cx+rx-ux, y10=cy+ry-uy, z10=cz+rz-uz;
    const x01=cx-rx+ux, y01=cy-ry+uy, z01=cz-rz+uz;
    const x11=cx+rx+ux, y11=cy+ry+uy, z11=cz+rz+uz;
    put(x00,y00,z00, u0,v1);
    put(x10,y10,z10, u1,v1);
    put(x11,y11,z11, u1,v0);
    put(x00,y00,z00, u0,v1);
    put(x11,y11,z11, u1,v0);
    put(x01,y01,z01, u0,v0);
    return o;
  },

  /* 押し出し側壁: 任意の4隅 (前面2点+背面2点) を白パッチUVで塗る */
  /* 押し出し側壁1枚。a=前面prev / b=前面cur / c=背面cur / d=背面prev。
     uv は輪郭点ごとの「フチ内側」サンプル位置 (絵文字=colF1 でフチ色が奥へ伸びる)。
     colF: 0=Ink / 1=グリフ色(絵文字) / 2=専用色(uSideCol)。accF=Accent文字フラグ。 */
  _pushWall(o, ax,ay,az, bx,by,bz, cx2,cy2,cz2, dx,dy,dz, ua,va, ub,vb, alpha, shade, colF, accF){
    const v = this.verts;
    const put = (px,py,pz,u,vv)=>{
      v[o++]=px; v[o++]=py; v[o++]=pz; v[o++]=u; v[o++]=vv; v[o++]=alpha; v[o++]=accF; v[o++]=colF; v[o++]=shade;
    };
    put(ax,ay,az, ua,va); put(bx,by,bz, ub,vb); put(cx2,cy2,cz2, ub,vb);
    put(ax,ay,az, ua,va); put(cx2,cy2,cz2, ub,vb); put(dx,dy,dz, ua,va);
    return o;
  },

  /* 1文字を横方向に SEG 分割し、各スライスを「しなり」変位させて描く。
     bend(u) が字面の横位置 u(-1..1) に対する変位を返す: [dR, dU, dN] と ねじれ角。 */
  _pushBent(o, cx,cy,cz, Rx,Ry,Rz, Ux,Uy,Uz, Nx,Ny,Nz, half, g, alpha, accF, colF, shade, SEG, bend){
    const v = this.verts;
    const put = (px,py,pz,u,vv)=>{
      v[o++]=px; v[o++]=py; v[o++]=pz; v[o++]=u; v[o++]=vv; v[o++]=alpha; v[o++]=accF; v[o++]=colF; v[o++]=shade;
    };
    // 各分割線での位置と天地ベクトルを先に求める(バッファは使い回し)
    const ex = this._bentEx || (this._bentEx = new Float64Array(3*33));
    const tw = this._bentTw || (this._bentTw = new Float64Array(3*33));
    for(let k=0;k<=SEG;k++){
      const u = k/SEG*2 - 1;                       // -1..1 (字面の左→右)
      const b = bend(u);                           // [dR, dU, dN, twistAng]
      const px = cx + (Rx*u + Rx*b[0] + Ux*b[1] + Nx*b[2])*half;
      const py = cy + (Ry*u + Ry*b[0] + Uy*b[1] + Ny*b[2])*half;
      const pz = cz + (Rz*u + Rz*b[0] + Uz*b[1] + Nz*b[2])*half;
      // ねじれ: 天地ベクトルを R 軸まわりに回す
      const a = b[3], ca = Math.cos(a), sa = Math.sin(a);
      const j = k*3;
      ex[j]=px; ex[j+1]=py; ex[j+2]=pz;
      tw[j]=(Ux*ca + Nx*sa)*half; tw[j+1]=(Uy*ca + Ny*sa)*half; tw[j+2]=(Uz*ca + Nz*sa)*half;
    }
    const du = (g.u1-g.u0)/SEG;
    for(let k=0;k<SEG;k++){
      const i0=k*3, i1=(k+1)*3;
      const ax=ex[i0], ay=ex[i0+1], az=ex[i0+2], aux=tw[i0], auy=tw[i0+1], auz=tw[i0+2];
      const bx=ex[i1], by=ex[i1+1], bz=ex[i1+2], bux=tw[i1], buy=tw[i1+1], buz=tw[i1+2];
      const ul=g.u0+du*k, ur=g.u0+du*(k+1);
      put(ax-aux, ay-auy, az-auz, ul, g.v1);
      put(bx-bux, by-buy, bz-buz, ur, g.v1);
      put(bx+bux, by+buy, bz+buz, ur, g.v0);
      put(ax-aux, ay-auy, az-auz, ul, g.v1);
      put(bx+bux, by+buy, bz+buz, ur, g.v0);
      put(ax+aux, ay+auy, az+auz, ul, g.v0);
    }
    return o;
  },

  /* 1文字を「折り(fold)」を効かせて描く。foldAng=0 なら1枚のクアッド。
     fold 時は中央の縦線で2分割し、左右の半面を法線方向へ観音開きに折る。 */
  _pushGlyph(o, cx,cy,cz, Rx,Ry,Rz, Ux,Uy,Uz, Nx,Ny,Nz, half, g, alpha, accF, colF, foldAng, shade){
    if(!(foldAng > 0.001))
      return this._pushQuad(o, cx,cy,cz, Rx*half,Ry*half,Rz*half, Ux*half,Uy*half,Uz*half, g.u0,g.v0,g.u1,g.v1, alpha, accF, colF, shade);
    const c = Math.cos(foldAng), s = Math.sin(foldAng), q = half/2;
    const um = (g.u0 + g.u1)/2;
    // 左半面: 中心を -R 側へ、外側が +N へ持ち上がる
    o = this._pushQuad(o,
      cx - Rx*q*c + Nx*q*s, cy - Ry*q*c + Ny*q*s, cz - Rz*q*c + Nz*q*s,
      (Rx*c - Nx*s)*q, (Ry*c - Ny*s)*q, (Rz*c - Nz*s)*q,
      Ux*half, Uy*half, Uz*half,
      g.u0, g.v0, um, g.v1, alpha, accF, colF, shade);
    // 右半面
    return this._pushQuad(o,
      cx + Rx*q*c + Nx*q*s, cy + Ry*q*c + Ny*q*s, cz + Rz*q*c + Nz*q*s,
      (Rx*c + Nx*s)*q, (Ry*c + Ny*s)*q, (Rz*c + Nz*s)*q,
      Ux*half, Uy*half, Uz*half,
      um, g.v0, g.u1, g.v1, alpha, accF, colF, shade);
  },

  _writeVerts(t, pulse, camRight, camUp){
    const P = this.P;
    const scene = this._builtScene;
    const D = Math.max(4, P.depth);
    const S = P.size * (this._cellEm || 1.23) * (1 + pulse*0.5);
    const half = S/2;
    const jit = P.jitter * P.size;
    const T = 8;   // ループノイズ周期
    let o = 0, n = 0;
    const inst = this.inst || [];
    // 文字自体の 3D 変形量 (度 → ラジアン)。押し出しは層数と総厚みに分解。
    const RAD = Math.PI/180;
    const rollA = (P.roll||0)*RAD, pitchA = (P.tiltX||0)*RAD, yawA = (P.tiltY||0)*RAD;
    const foldMax = (P.fold||0)/100 * 1.4;                     // 最大 ~80°
    const exDepth = (P.extrude||0)/100 * S * 1.2;              // 押し出しの厚み(ワールド)
    const exOn = exDepth > 0.0005;
    // 押し出し側面の明るさ下限。100% = 陰影なし(前面と同じ Ink 色)
    const sideBase = Math.max(0, Math.min(1, (P.sideShade == null ? 45 : P.sideShade)/100));
    const quadFloats = 6*this.FLOATS_PER_VERT;
    // ── しなり(進行方向への追従遅れ・なびき・垂れ・ねじれ) ──
    const lagA   = (P.lag||0)/100;
    const swayA  = (P.swayAmp||0)/100;
    const droopA = (P.droop||0)/100;
    const twistA = (P.twist||0)*RAD;
    const faceA  = Math.max(0, Math.min(1, (P.faceVel||0)/100));
    const bendOn = (lagA || swayA || droopA || twistA) ? 1 : 0;
    const SEG = bendOn ? 8 : 1;
    // 速度は前フレームの中心位置との差分から求める(位置計算はシーンごとに分岐しているため)
    const needVel = (lagA > 0 || faceA > 0);
    let prevPos = this._prevPos;
    if(needVel && (!prevPos || prevPos.length < inst.length*3)) prevPos = this._prevPos = new Float32Array(inst.length*3 + 3);
    const dt = (this._lastVelT != null) ? (t - this._lastVelT) : 0;
    const velOk = needVel && dt > 0.0001 && dt < 0.5 && this._velReady;
    this._lastVelT = t;

    for(let i=0; i<inst.length; i++){
      const it = inst[i];
      const g = this.glyphs[it.ch];
      if(!g) continue;
      let cx=0, cy=0, cz=0, alpha=1;
      let rx=half, ry=0, rz=0, ux=0, uy=half, uz=0;   // 既定=XY平面
      if(scene === 'wave'){
        const ay = t*P.spin*0.5;
        const ca = Math.cos(ay), sa = Math.sin(ay);
        const x0 = it.a*S*1.0, z0 = it.b;
        const y = P.waveAmp*Math.sin(x0*P.waveFreq*0.6 + t*P.speed*1.6 + z0*0.35)
                + jit*mtN1(it.sd, t, T);
        cx = x0*ca - z0*sa; cy = y; cz = x0*sa + z0*ca;
        rx = camRight[0]*half; ry = camRight[1]*half; rz = camRight[2]*half;
        ux = camUp[0]*half;    uy = camUp[1]*half;    uz = camUp[2]*half;
      } else if(scene === 'tunnel'){
        const z = D - ((it.b*D + t*P.speed*3.2) % D);           // 奥から手前へ
        const ang = it.a + t*P.spin + it.c*0.35;
        const rad = Math.max(1.5, D*0.18)*P.radius * (1 + 0.12*P.waveAmp*Math.sin(ang*3 + t*P.speed));
        const cA = Math.cos(ang), sA = Math.sin(ang);
        cx = cA*rad; cy = sA*rad; cz = 1.5 - z;
        rx = -sA*half; ry = cA*half; rz = 0;                    // 円周の接線方向
        ux = -cA*half; uy = -sA*half; uz = 0;                   // 文字の頭が中心を向く
        if(P.depthFade){
          const fade = Math.min(1, (z)/(D*0.25)) * Math.min(1, (D - z)/(D*0.2) + 0.15);
          alpha = Math.max(0, Math.min(1, fade));
        }
      } else if(scene === 'cylinder'){
        const dir = (it.b % 2) ? -1 : 1;                        // 行ごとに逆回転
        const ang = it.a + t*P.spin*dir;
        const rad = Math.max(2, D*0.2)*P.radius;
        const rows = it.c;
        const lnStep = S*1.7*P.rowGap;
        const cA = Math.cos(ang), sA = Math.sin(ang);
        cx = sA*rad;
        cy = (it.b-(rows-1)/2)*lnStep + P.waveAmp*0.4*Math.sin(t*P.speed + it.b);
        cz = cA*rad;
        rx = cA*half; ry = 0; rz = -sA*half;                    // 円筒の接線方向
        ux = 0; uy = half; uz = 0;
      } else if(scene === 'sphere'){
        const rad = Math.max(2, D*0.25)*P.radius;
        const ang = it.a + t*P.spin;
        const wob = 1 + P.waveAmp*0.06*mtN1(it.sd, t, T);
        cx = Math.cos(ang)*it.c*rad*wob;
        cy = it.b*rad*wob;
        cz = Math.sin(ang)*it.c*rad*wob;
        rx = camRight[0]*half; ry = camRight[1]*half; rz = camRight[2]*half;
        ux = camUp[0]*half;    uy = camUp[1]*half;    uz = camUp[2]*half;
      } else if(scene === 'wall'){
        const lnStep = S*1.55*P.rowGap;
        cx = it.a*S; cy = -it.b*lnStep;
        cz = P.waveAmp*Math.sin((it.a*S + it.b*lnStep)*P.waveFreq*0.4 - t*P.speed*2)
           + jit*mtN1(it.sd, t, T);
        // 既定=XY平面(正面向き)のまま。壁全体のリップルだけ z に乗せる
      } else if(scene === 'arc'){
        // 行を弧に湾曲させる。曲げ角(総角)が時間で呼吸し、直線↔強いカーブを往復
        const lnStep = S*1.8*P.rowGap;
        const W = Math.max(0.5, it.c*S);
        const bend = (0.12 + 0.88*(0.5 + 0.5*Math.sin(t*P.speed*1.1 + it.b*0.9))) * Math.max(0.05, P.waveAmp) * 1.6;
        const th2 = (it.a*S)/W * bend;                          // 弧に沿った角度 (-bend/2..bend/2)
        const Rc = W/bend;                                      // 曲率半径
        cx = Rc*Math.sin(th2);
        cy = -it.b*lnStep + it.p*(Rc*(1 - Math.cos(th2)));      // 行ごとに上/下へ湾曲
        cz = jit*mtN1(it.sd, t, T);
        rx = Math.cos(th2)*half; ry = it.p*Math.sin(th2)*half; rz = 0;   // 弧の接線に沿う
        ux = -it.p*Math.sin(th2)*half; uy = Math.cos(th2)*half; uz = 0;
      } else if(scene === 'helix'){
        const H = D*0.8*P.rowGap, rad = Math.max(2, D*0.2)*P.radius;
        const ang = it.a + t*P.spin;
        const cA = Math.cos(ang), sA = Math.sin(ang);
        cx = sA*rad;
        cy = (it.b-0.5)*H + P.waveAmp*0.3*mtN1(it.sd, t, T);
        cz = cA*rad;
        rx = cA*half; ry = 0; rz = -sA*half;                    // 螺旋の接線方向
        ux = 0; uy = half; uz = 0;
      } else if(scene === 'rings'){
        const rad = ((it.b+1)/it.c) * D*0.4*P.radius;
        const dir = (it.b % 2) ? -1 : 1;
        const ang = it.a + t*P.spin*dir*(0.4 + 1.2*(1 - it.b/it.c));   // 内側のリングほど速い
        const cA = Math.cos(ang), sA = Math.sin(ang);
        cx = sA*rad; cz = cA*rad;
        cy = P.waveAmp*0.3*mtN1(it.sd, t, T);
        rx = cA*half; ry = 0; rz = -sA*half;                    // リングの接線方向
        ux = 0; uy = half; uz = 0;
      } else if(scene === 'ribbon'){
        // 3D 正弦カーブの帯に沿って文字が流れる
        const span = D*1.5, step = S*1.05;
        const s = ((it.a*step + t*P.speed*2.2) % span + span) % span;
        const x = s - span/2;
        const A = P.waveAmp*1.2, f = P.waveFreq*0.35;
        const p1 = x*f + t*P.speed*0.7, p2 = x*f*0.8 - t*P.speed*0.5;
        cx = x;
        cy = A*Math.sin(p1);
        cz = A*Math.cos(p2);
        let tx2 = 1, ty2 = A*Math.cos(p1)*f, tz2 = -A*Math.sin(p2)*f*0.8;   // 経路の接線
        const tl = Math.hypot(tx2, ty2, tz2) || 1; tx2/=tl; ty2/=tl; tz2/=tl;
        rx = tx2*half; ry = ty2*half; rz = tz2*half;
        let ux2 = -ty2*tx2, uy2 = 1 - ty2*ty2, uz2 = -ty2*tz2;             // Y を接線と直交化
        const ul = Math.hypot(ux2, uy2, uz2) || 1;
        ux = ux2/ul*half; uy = uy2/ul*half; uz = uz2/ul*half;
        if(P.depthFade){
          const e = Math.min(s, span - s);
          alpha = Math.max(0, Math.min(1, e/(span*0.08)));
        }
      } else if(scene === 'lissajous'){
        // 閉じた 3D リサージュ曲線を文字列が周回する
        const uu = (it.b + t*P.speed*0.04)*Math.PI*2;
        const A1 = D*0.35*P.radius, A2 = D*0.22*P.radius*P.rowGap, A3 = D*0.35*P.radius;
        const w2 = 3 + Math.round(Math.max(0, P.waveFreq - 1));   // Wave Freq で縦の巻き数
        cx = A1*Math.sin(2*uu);
        cy = A2*Math.sin(w2*uu + t*P.spin*0.5);
        cz = A3*Math.sin(uu);
        let tx2 = 2*A1*Math.cos(2*uu), ty2 = w2*A2*Math.cos(w2*uu + t*P.spin*0.5), tz2 = A3*Math.cos(uu);
        const tl = Math.hypot(tx2, ty2, tz2) || 1; tx2/=tl; ty2/=tl; tz2/=tl;
        rx = tx2*half; ry = ty2*half; rz = tz2*half;
        let ux2 = -ty2*tx2, uy2 = 1 - ty2*ty2, uz2 = -ty2*tz2;
        const ul = Math.hypot(ux2, uy2, uz2) || 1;
        ux = ux2/ul*half; uy = uy2/ul*half; uz = uz2/ul*half;
      } else if(scene === 'vortex'){
        // 渦: 外周から中心へ吸い込まれながら渦の腕に沿って回る
        const prog = ((it.b + t*P.speed*0.06) % 1 + 1) % 1;      // 0=外 → 1=中心
        const rr = (1-prog)*D*0.38*P.radius + 0.25;
        const ang = it.a + t*P.spin*1.2 + prog*5*P.waveFreq;
        const cA = Math.cos(ang), sA = Math.sin(ang);
        cx = sA*rr; cz = cA*rr;
        cy = (prog-0.5)*P.waveAmp*1.5 + jit*0.3*mtN1(it.sd, t, T);
        rx = cA*half; ry = 0; rz = -sA*half;                    // 渦の接線方向
        ux = 0; uy = half; uz = 0;
        if(P.depthFade) alpha = Math.max(0, Math.min(1, rr/(D*0.05)));
      } else if(scene === 'burst'){
        // 中心から全方向へ放射 → ループ
        const prog = ((it.p + t*P.speed*0.1) % 1 + 1) % 1;
        const rr = Math.pow(prog, 0.55)*D*0.45*P.radius;
        cx = it.a*rr; cy = it.b*rr; cz = it.c*rr;
        const roll = it.sd + prog*P.spin*4;
        const cR = Math.cos(roll), sR = Math.sin(roll);
        rx = (camRight[0]*cR + camUp[0]*sR)*half; ry = (camRight[1]*cR + camUp[1]*sR)*half; rz = (camRight[2]*cR + camUp[2]*sR)*half;
        ux = (camUp[0]*cR - camRight[0]*sR)*half; uy = (camUp[1]*cR - camRight[1]*sR)*half; uz = (camUp[2]*cR - camRight[2]*sR)*half;
        if(P.depthFade){
          alpha = Math.min(1, (1-prog)*2.5) * Math.min(1, prog*10 + 0.1);
          alpha = Math.max(0, Math.min(1, alpha));
        }
      } else if(scene === 'scatter'){
        cx = it.a + P.waveAmp*mtN1(it.sd+1, t, T);
        cy = it.b + P.waveAmp*mtN1(it.sd+2, t, T);
        cz = it.c + P.waveAmp*mtN1(it.sd+3, t, T);
        const roll = it.sd + t*P.spin*(it.sd%2 ? 1 : -1);
        const cR = Math.cos(roll), sR = Math.sin(roll);
        rx = (camRight[0]*cR + camUp[0]*sR)*half; ry = (camRight[1]*cR + camUp[1]*sR)*half; rz = (camRight[2]*cR + camUp[2]*sR)*half;
        ux = (camUp[0]*cR - camRight[0]*sR)*half; uy = (camUp[1]*cR - camRight[1]*sR)*half; uz = (camUp[2]*cR - camRight[2]*sR)*half;
      } else {   // fall
        const spanY = D;
        cy = ((it.b - t*P.speed*2.5) % spanY + spanY) % spanY - spanY/2;
        cx = it.a + P.waveAmp*0.4*mtN1(it.sd, t, T);
        cz = it.c;
        const roll = (it.sd%1)*0.6 - 0.3 + 0.3*mtN1(it.sd+4, t, T)*P.spin;
        const cR = Math.cos(roll), sR = Math.sin(roll);
        rx = (camRight[0]*cR + camUp[0]*sR)*half; ry = (camRight[1]*cR + camUp[1]*sR)*half; rz = (camRight[2]*cR + camUp[2]*sR)*half;
        ux = (camUp[0]*cR - camRight[0]*sR)*half; uy = (camUp[1]*cR - camRight[1]*sR)*half; uz = (camUp[2]*cR - camRight[2]*sR)*half;
        if(P.depthFade){
          alpha = Math.min(1, (spanY/2 - Math.abs(cy))/(spanY*0.12) + 0.2);
          alpha = Math.max(0, Math.min(1, alpha));
        }
      }
      if(P.billboard && (scene === 'tunnel' || scene === 'cylinder')){   // 面の向きを捨てて常にカメラへ向ける
        rx = camRight[0]*half; ry = camRight[1]*half; rz = camRight[2]*half;
        ux = camUp[0]*half;    uy = camUp[1]*half;    uz = camUp[2]*half;
      }

      // ── 速度ベクトル (前フレーム中心との差分)。しなり/進行方向向きに使う ──
      let vx=0, vy=0, vz=0, vlen=0;
      if(needVel){
        const pi = i*3;
        if(velOk){
          vx = (cx - prevPos[pi])/dt; vy = (cy - prevPos[pi+1])/dt; vz = (cz - prevPos[pi+2])/dt;
          vlen = Math.hypot(vx, vy, vz);
          if(vlen > 1e-4){ vx/=vlen; vy/=vlen; vz/=vlen; } else vlen = 0;
        }
        prevPos[pi]=cx; prevPos[pi+1]=cy; prevPos[pi+2]=cz;
      }

      // ── 文字面のローカル基底 (R=字送り方向 / U=天地 / N=面法線) を単位化 ──
      const ih = 1/(half || 1);
      let Rx=rx*ih, Ry=ry*ih, Rz=rz*ih, Ux=ux*ih, Uy=uy*ih, Uz=uz*ih;
      let Nx=Ry*Uz-Rz*Uy, Ny=Rz*Ux-Rx*Uz, Nz=Rx*Uy-Ry*Ux;
      // 進行方向へ正対: 速度を「文字の右方向」に寄せる(faceVel=100 で完全に進行方向へ向く)
      if(faceA > 0 && vlen > 0){
        let nrx = Rx + (vx-Rx)*faceA, nry = Ry + (vy-Ry)*faceA, nrz = Rz + (vz-Rz)*faceA;
        const rl = Math.hypot(nrx,nry,nrz);
        if(rl > 1e-4){
          nrx/=rl; nry/=rl; nrz/=rl;
          // U を新 R と直交化して基底を作り直す
          const d = nrx*Ux + nry*Uy + nrz*Uz;
          let nux = Ux - nrx*d, nuy = Uy - nry*d, nuz = Uz - nrz*d;
          const ul2 = Math.hypot(nux,nuy,nuz);
          if(ul2 > 1e-4){
            Rx=nrx; Ry=nry; Rz=nrz;
            Ux=nux/ul2; Uy=nuy/ul2; Uz=nuz/ul2;
            Nx=Ry*Uz-Rz*Uy; Ny=Rz*Ux-Rx*Uz; Nz=Rx*Uy-Ry*Ux;
          }
        }
      }
      // ── 文字自体の 3D 回転 (roll=面内 / pitch=天地方向へ倒す / yaw=左右へ振る) ──
      if(rollA || pitchA || yawA){
        const rot = (ax,ay,az, ang)=>{   // Rodrigues: 単位軸 (ax,ay,az) まわりに R と U を回す
          const c = Math.cos(ang), s = Math.sin(ang), k = 1-c;
          const dR = ax*Rx+ay*Ry+az*Rz, dU = ax*Ux+ay*Uy+az*Uz;
          const nRx = Rx*c + (ay*Rz-az*Ry)*s + ax*dR*k, nRy = Ry*c + (az*Rx-ax*Rz)*s + ay*dR*k, nRz = Rz*c + (ax*Ry-ay*Rx)*s + az*dR*k;
          const nUx = Ux*c + (ay*Uz-az*Uy)*s + ax*dU*k, nUy = Uy*c + (az*Ux-ax*Uz)*s + ay*dU*k, nUz = Uz*c + (ax*Uy-ay*Ux)*s + az*dU*k;
          Rx=nRx; Ry=nRy; Rz=nRz; Ux=nUx; Uy=nUy; Uz=nUz;
          Nx=Ry*Uz-Rz*Uy; Ny=Rz*Ux-Rx*Uz; Nz=Rx*Uy-Ry*Ux;
        };
        if(rollA)  rot(Nx,Ny,Nz, rollA  * mtN1(it.sd+11, t, T));
        if(pitchA) rot(Rx,Ry,Rz, pitchA * mtN1(it.sd+12, t, T));
        if(yawA)   rot(Ux,Uy,Uz, yawA   * mtN1(it.sd+13, t, T));
      }
      const foldAng = foldMax ? foldMax * (0.5 + 0.5*mtN1(it.sd+14, t, T)) : 0;
      const colF = P.emojiColor ? g.color : 0;

      // ── しなり: 字面の横位置 u(-1..1) に対する変位 [dR, dU, dN, ねじれ角] ──
      //   lag   = 進行方向の逆へ端が引かれる(弓なり)。速度が速いほど大きく反る
      //   sway  = 旗のように波打つ(時間で走る波)
      //   droop = 左右の端が重力で垂れる
      //   twist = 左右で軸がねじれる
      let bendFn = null;
      if(bendOn){
        const spd = vlen > 0 ? Math.min(1.6, vlen*0.12) : 0;
        // 進行方向をローカル基底へ射影(=どちらへ引かれるか)
        const vR = vlen>0 ? (vx*Rx+vy*Ry+vz*Rz) : 0;
        const vU = vlen>0 ? (vx*Ux+vy*Uy+vz*Uz) : 0;
        const vN = vlen>0 ? (vx*Nx+vy*Ny+vz*Nz) : 0;
        const lagK = lagA * spd;
        const ph = t*P.speed*2.4 + it.sd*0.7;
        const swK = swayA * (0.55 + 0.45*mtN1(it.sd+21, t, T));
        const twK = twistA ? twistA*(0.6+0.4*mtN1(it.sd+22, t, T)) : 0;
        const B = this._bendTmp || (this._bendTmp = new Float64Array(4));   // 使い回し(GC回避)
        bendFn = (u)=>{
          const e = u*u;                                   // 端ほど大きく(中央固定)
          B[0] = -vR*lagK*e; B[1] = -vU*lagK*e; B[2] = -vN*lagK*e;
          if(swK) B[2] += swK*Math.sin(u*P.swayFreq*3.1 + ph)*0.5*(0.3+0.7*(u<0?-u:u));
          if(droopA) B[1] -= droopA*e*0.9;
          B[3] = twK*u;
          return B;
        };
      }

      // ── 押し出し(extrude): グリフ輪郭に沿った真の側壁 + 背面/前面キャップ ──
      if(exOn && g.loops && g.loops.length &&
         o + (g.wallCount + 4 + SEG*2)*quadFloats <= this.verts.length){
        // 押し出し面の塗り: 既定(sideColorOn=false)=文字の縁の色をそのまま引き延ばす
        //   (絵文字=フチのサンプル色 / Accent文字=Accent / 通常=Ink)。
        //   専用色(sideColorOn=true)=絵文字以外を uSideCol で塗る。
        const wallColF = (colF === 1) ? 1 : (P.sideColorOn ? 2 : 0);
        const capColF  = (colF === 1) ? 1 : wallColF;
        const wallAccF = (wallColF === 0) ? it.acc : 0;   // 既定時は Accent 文字の側面も Accent
        // 背面キャップ: 前面と同じ色で描く(暗く固定すると背面向きの文字が黒い塊になるため)
        o = bendFn
          ? this._pushBent(o, cx-Nx*exDepth, cy-Ny*exDepth, cz-Nz*exDepth,
                           Rx,Ry,Rz, Ux,Uy,Uz, Nx,Ny,Nz, half, g, alpha, it.acc, capColF, 1, SEG, bendFn)
          : this._pushGlyph(o, cx-Nx*exDepth, cy-Ny*exDepth, cz-Nz*exDepth,
                            Rx,Ry,Rz, Ux,Uy,Uz, Nx,Ny,Nz, half, g, alpha, it.acc, capColF, foldAng, 1);
        // 側壁: 輪郭点を fold/しなり込みでワールドへ写し、隣接点間を面で繋ぐ
        const fc = Math.cos(foldAng), fsn = Math.sin(foldAng);
        const bx2 = Nx*exDepth, by2 = Ny*exDepth, bz2 = Nz*exDepth;   // 背面へのオフセット
        const wu = this._whiteU, wv = this._whiteV;
        for(const lp of g.loops){
          const m = lp.length/4;
          let pfx=0, pfy=0, pfz=0, plx=0, ply=0, pu=0, pv=0, first=true;
          // ループを閉じるため最後→最初も繋ぐ: 先に最終点を prev に据える
          for(let k=0; k<=m; k++){
            const idx = (k%m)*4;
            const lx = lp[idx], ly = lp[idx+1];
            const cu = (wallColF === 1) ? lp[idx+2] : wu;   // 絵文字=フチ内側サンプルUV / 他=白パッチ
            const cv2 = (wallColF === 1) ? lp[idx+3] : wv;
            let X = lx, Y = ly, Z = 0;
            if(foldAng > 0.001){ X = lx*fc; Z = Math.abs(lx)*fsn; }
            if(bendFn){
              const b = bendFn(lx);
              const ca2 = Math.cos(b[3]), sa2 = Math.sin(b[3]);
              X += b[0]; Y = ly*ca2 + b[1]; Z += b[2] + ly*sa2;
            }
            const fx2 = cx + Rx*X*half + Ux*Y*half + Nx*Z*half;
            const fy2 = cy + Ry*X*half + Uy*Y*half + Ny*Z*half;
            const fz2 = cz + Rz*X*half + Uz*Y*half + Nz*Z*half;
            if(!first){
              // 疑似ライティング: 輪郭セグメントの2D法線と光方向で側面の明暗を付ける。
              // Side Shade=100% で陰影なし(前面と同じ色)になる。
              const dx2 = lx-plx, dy2 = ly-ply;
              const dl = Math.hypot(dx2, dy2) || 1;
              const lgt = (dy2/dl)*0.45 + (-dx2/dl)*0.85;
              const shade = sideBase + (1-sideBase)*(0.5 + 0.5*lgt);
              o = this._pushWall(o,
                pfx,pfy,pfz, fx2,fy2,fz2,
                fx2-bx2,fy2-by2,fz2-bz2, pfx-bx2,pfy-by2,pfz-bz2,
                pu,pv, cu,cv2,
                alpha, Math.max(0, Math.min(1, shade)), wallColF, wallAccF);
            }
            pfx=fx2; pfy=fy2; pfz=fz2; plx=lx; ply=ly; pu=cu; pv=cv2; first=false;
          }
        }
      }
      if(o + quadFloats*(SEG+1) > this.verts.length) break;
      o = bendFn
        ? this._pushBent(o, cx,cy,cz, Rx,Ry,Rz, Ux,Uy,Uz, Nx,Ny,Nz, half, g, alpha, it.acc, colF, 1, SEG, bendFn)
        : this._pushGlyph(o, cx,cy,cz, Rx,Ry,Rz, Ux,Uy,Uz, Nx,Ny,Nz, half, g, alpha, it.acc, colF, foldAng, 1);
      n++;
      if(n >= this.MAX_INST) break;
    }
    if(needVel) this._velReady = true;   // 次フレームから速度差分が使える
    return o/(6*this.FLOATS_PER_VERT);   // 実際に積んだクアッド数
  },

  // ================= シーン/md の自動サイクル =================
  _autoCycle(beat, t){
    const P = this.P;
    const beatMode = (typeof App !== 'undefined' && App.beatMode === 'beat');
    // 「実際に進んだ量」の増分積算で周期判定する。
    //   絶対値グリッド (floor(beat/N) の変化) だと、拍元のリセット・逆再生(←キー)・
    //   beat scale 変更などで k が巻き戻るたび再同期し、環境によって永遠に発火しない。
    //   増分の絶対値を積むので、逆再生中でもサイクルは進む。
    const lastB = this._lastCycleBeat; this._lastCycleBeat = beat;
    const lastT = this._lastCycleT;    this._lastCycleT = t;
    if(!P.autoCycle){ this._cycleAcc = 0; this._cycleInfo(beatMode, P, null); return; }
    // md/scene の自動切替は beat モード限定 (drone では時間経過で切り替えない)
    if(!beatMode){ this._cycleAcc = 0; this._cycleInfo(beatMode, P, null); return; }
    let d = (typeof lastB === 'number') ? Math.abs(beat - lastB) : 0; if(d > 4) d = 0;
    this._cycleAcc = (this._cycleAcc || 0) + d;
    const N = Math.max(1, P.sceneBeats);
    this._cycleInfo(beatMode, P, N);
    if(this._cycleAcc < N) return;
    this._cycleAcc = this._cycleAcc % N;
    // 自己修復: UI の Scene セレクトの表示を正とする。
    //   (どの経路で sceneMode が汚染されても、ユーザーが見ている表示と実挙動を必ず一致させる)
    if(typeof document !== 'undefined'){
      const selEl = document.getElementById('stScene');
      const want = selEl ? (selEl.value === 'random' ? 'random' : (selEl.value === 'saved' ? 'saved' : null)) : null;
      if(want && P.sceneMode !== want){
        console.warn('[SPACE TYPE] sceneMode が汚染されていたため UI 表示 (' + want + ') へ自己修復しました');
        P.sceneMode = want;
      }
    }
    const prevScene = this.P.scene;
    if(P.mdMode !== 'fixed') this.autoNextMd(!P.cycleReload);
    if(this.P.sceneMode === 'random'){
      let s = ST_SCENES[Math.floor(Math.random()*ST_SCENES.length)];
      if(s === this.P.scene) s = ST_SCENES[(ST_SCENES.indexOf(s)+1) % ST_SCENES.length];
      this.P.scene = s;
      this._dirty = true;
    }
    // 診断: 発火回数と抽選結果を記録。ステータス行の ⚠revert 検出にも使う。
    this._advCount = (this._advCount || 0) + 1;
    this._pickedScene = this.P.scene;
    try{ console.log('[SPACE TYPE] cycle #' + this._advCount + ' ' + prevScene + ' → ' + this.P.scene
      + ' (md:' + this.currentMdIndex() + ', mode:' + this.P.sceneMode + ')'); }catch(e){}
    if(typeof UI !== 'undefined' && typeof App !== 'undefined'
       && GL.slots[App.activeSlot] && GL.slots[App.activeSlot].kind === 'spacetype'){
      // 全再構築(refreshSpaceType)はスライダー操作中のドラッグを切ってしまうため、値同期のみの軽量版を使う
      if(UI.refreshSpaceTypeLive) UI.refreshSpaceTypeLive();
      else if(UI.refreshSpaceType) UI.refreshSpaceType();
    }
  },

  /* サイクル進行状況を UI に表示。「next が減らない=拍が進んでいない」の切り分けにも使う */
  _cycleInfo(beatMode, P, N){
    if(typeof document === 'undefined') return;
    if((this._ciTick = (this._ciTick || 0) + 1) % 15) return;   // 約4Hzに間引き
    const el = document.getElementById('stCycleInfo');
    if(!el) return;
    // #n=サイクル発火回数 / built=実際に描画中のシーン / scene・md: R=Random / F=Fixed。
    // ⚠revert = 抽選直後に scene が別の何かに書き戻されたことを検出。
    // 不具合報告時はこの行のスクリーンショット1枚で状態を特定できる。
    const flags = ' ｜ scene:' + (P.sceneMode === 'random' ? 'R' : P.sceneMode === 'saved' ? 'S' : 'F')
                + ' md:' + (P.mdMode === 'fixed' ? 'F' : 'R')
                + ' ｜ built:' + (this._builtScene || '-')
                + (this._pickedScene && P.scene !== this._pickedScene ? (' ⚠revert(' + this._pickedScene + '→' + P.scene + ')') : '');
    const head = '#' + (this._advCount || 0) + ' ▸ ' + P.scene;
    if(!P.autoCycle){ el.textContent = 'cycle OFF ' + head + flags; return; }
    if(!beatMode){ el.textContent = 'cycle (beatモード限定) ' + head + flags; return; }
    if(N == null) N = Math.max(1, P.sceneBeats);
    const remain = Math.max(0, N - (this._cycleAcc || 0));
    el.textContent = head + ' ｜ next ' + remain.toFixed(1) + ' beats' + flags;
  },

  _ensureDepth(w,h){
    const gl = this.gl;
    if(this.depthRBO && this.depthW===w && this.depthH===h) return;
    if(this.depthRBO) gl.deleteRenderbuffer(this.depthRBO);
    this.depthRBO = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRBO);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    this.depthW = w; this.depthH = h;
  },

  _hex2rgb(hex){
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex||''));
    if(!m) return [1,1,1];
    const n = parseInt(m[1], 16);
    return [((n>>16)&255)/255, ((n>>8)&255)/255, (n&255)/255];
  },

  // ================= render =================
  render(opts){
    if(!this.ok) return;
    const gl = this.gl, { fbo, w, h } = opts;
    const P = this.P;
    const t = (typeof opts.clock === 'number') ? opts.clock : performance.now()/1000;
    const beat = (typeof opts.beat === 'number') ? opts.beat : 0;

    this._autoCycle(beat, t);
    if(this._dirty || this._builtScene !== P.scene) this._build();

    // 拍パルス (beat モード時のみ)
    let pulse = 0;
    if(typeof App !== 'undefined' && App.beatMode === 'beat' && P.beatPulse > 0){
      const ph = beat - Math.floor(beat);
      pulse = P.beatPulse * Math.pow(1 - ph, 2.0) * 0.6;
    }

    // カメラ: tunnel=中心から奥を見る / その他=周回オービット
    const scene = this._builtScene;
    const m4 = PhotoPlane.m4;
    let eye, center;
    if(scene === 'tunnel'){
      const sway = P.camOrbit ? 1 : 0;
      eye = [0, 0, 1.5]; center = [Math.sin(t*0.2)*0.8*sway, Math.cos(t*0.17)*0.8*sway, -Math.max(4, P.depth)];
    }else{
      const az = P.camOrbit ? t*P.orbitSpeed : 0, el = P.camEl, dist = P.dist;
      eye = [dist*Math.cos(el)*Math.sin(az), dist*Math.sin(el), dist*Math.cos(el)*Math.cos(az)];
      center = [0,0,0];
    }
    const proj = m4.persp(P.fov*Math.PI/180, w/h, 0.05, 300.0);
    const view = m4.lookAt(eye, center, [0,1,0]);
    const vp = m4.mul(proj, view);
    const camRight = [view[0], view[4], view[8]];
    const camUp    = [view[1], view[5], view[9]];

    const quads = this._writeVerts(t, pulse, camRight, camUp);

    this._ensureDepth(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRBO);
    gl.viewport(0, 0, w, h);
    const bg = this._hex2rgb(P.paper);
    const transBg = (opts.slot === 'B') || P.transparentBg;
    gl.clearColor(bg[0], bg[1], bg[2], transBg ? 0.0 : 1.0);   // Slot B / BG透過ON は背景透過
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if(quads > 0){
      gl.useProgram(this.prog);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.verts.subarray(0, quads*6*this.FLOATS_PER_VERT));
      gl.uniformMatrix4fv(this.loc.uVP, false, vp);
      const ink = this._hex2rgb(P.ink), acc = this._hex2rgb(P.accent), sc2 = this._hex2rgb(P.sideColor);
      gl.uniform3f(this.loc.uInk, ink[0], ink[1], ink[2]);
      gl.uniform3f(this.loc.uAccent, acc[0], acc[1], acc[2]);
      gl.uniform3f(this.loc.uSideCol, sc2[0], sc2[1], sc2[2]);
      gl.uniform1i(this.loc.uTex, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
      gl.drawArrays(gl.TRIANGLES, 0, quads*6);
      gl.bindVertexArray(null);
    }

    gl.disable(gl.BLEND);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
};
SpaceType.PDefaults = JSON.parse(JSON.stringify(SpaceType.P));   // 素のデフォルトを確定(汚染前)
SpaceType.FONTS = (typeof MT_FONTS !== 'undefined') ? MT_FONTS : [{name:'Sans', ff:'sans-serif'}];
SpaceType.SCENES = ST_SCENES;
if(typeof window !== 'undefined') window.SpaceType = SpaceType;
