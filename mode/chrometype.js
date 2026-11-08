'use strict';
/* Chrome Type engine — vj/ の追加レンダリングモード (kind:'chrometype')。
   任意の文字列を、穴の開いた有機的な塊 (横へ伸びるヒレ・垂れる根つき) に押し出して回す。
   - 焼き (文字や形のパラメータが変わったときだけ): キャンバスに文字・ヒレ・根を描く → GPU で
     ぼかし + しきい値で溶かす → ボロノイの穴 → JFA で符号付き距離。RGBA16F (R=本体 / G,B=奥と手前のヒレ層) に入れる。
     (Worker の CPU 版はこの機械で 1〜3 秒かかったため、全部シェーダのパスにしている)
   - 描画 (毎フレーム): 格子を距離から作る高さで上下に押し出す (両面の高さ場)。縁では上下の面が同じ線で閉じる
     (外側は高さを負に延ばし、補間した高さが 0 未満の画素を捨てる)。法線は画素ごとに距離テクスチャから取る。
     ねじり・曲げ・液状の揺れは頂点シェーダ (法線はヤコビアンの余因子で変換)。
   - 材質: スタジオ照明の映り込み (クローム / 黒クローム) + 拡散 (マット / 赤) + 画像テクスチャ (正面 / 三面 / 映り込み)。
   IF: init(gl) / update() / render({fbo,w,h,slot,beat,clock,opaque}) / P / PDefaults / MATS / setMat(i)
*/

const ChromeType = {
  gl:null, initialized:false, ok:false,
  prog:null, U:null, vao:null, ibo:null, nIdx:0,
  sdfTex:null, bake:null,           // bake = 最後に入った焼き結果 (w,h,cols,rows,grid,F)
  _sdfBack:null, _iboBack:null,     // 焼きは裏へ書き、描くセルが決まったら表と入れ替える (文字が替わっても画面が欠けない)
  _morphTex:null, _morphBack:null,  // 移り変わり: 前の形を今の形の座標へ写したもの (表と裏)
  _morphOn:false, _morph0:0, _morphDur:0, _aspect:16/9,
  depthRBO:null, depthW:0, depthH:0,
  msaa:null,                        // {fbo,color,depth,w,h,samples}
  _bakeKey:'', _pendKey:'', _bakeDirtyAt:0, _baking:false, _bakeTy:'', _fontKey:'',
  _occTok:0, _occSync:false,        // 描くセルの読み戻しの番号 (古い結果を捨てる) / 次は同期で読む
  _cv:null,                         // 焼き用キャンバスの使い回し
  _words:null, _wordsReq:false,     // presets/chrometype.md の文字列
  _ty:null,                         // タイピングの状態 {list, idx, phrase, glines, len, b0, n}
  _tyT:null, _tyLastB:null,         // タイピングの進み (拍)。進んだ量の絶対値を積む
  _yaw:0, _lastT:null, _lastP:null, // 縦軸まわりの角度 (積む) と前のフレームの時間 / Spin Step の進み
  _dir:1, _dirBeat:null, _revFlip:false, _revLeft:0,   // 回転の向き・切り替えた拍・Random Rev の反転中か・次の反転までの拍数
  _atkFlip:false, _atkSeed:null, _atkT:0,   // Attack Rev の反転中か・前の Audio.hitSeed・前に反転した時刻
  BK:null,                          // GPU 焼きの資源 {W,H,mask[4],tA,tB,tC,jA,jB,occ,fbos,progs,vao}
  texImg:null, texTex:null, _texUrl:'', _texAspect:1,
  _matT:null,

  // ── パラメータ (UI から操作)。% は 100 = 既定の効き ──
  P:{
    text:'GARA',
    typing:0,            // presets/chrometype.md の文字列を出す (beat モードは拍で、drone モードは時間で)。0 = 切 / 1 = 1 字ずつ打つ / 2 = 全文を一度に出し Hold 拍ごとに入れ替える。上の text は使わない
    tyRate:1,            // 打つ速さ (字/拍)
    tyHold:4,            // 打ち終えてから次の文字列へ移るまでの拍数
    tyOrder:1,           // 0 = 順番 / 1 = ランダム
    tyErase:0,           // 0 = 一度に消す / 1 = 1 字ずつ消す
    tyMorph:70,          // 1 字ごとの形の移り変わり (1 字の間隔に対する %、0 = 切り替え)。距離場を混ぜて溶けるようにつなぐ
    style:1,             // 形のプリセットの番号 (STYLES)。選ぶと形のパラメータがまとめて入れ替わる
    font:'',             // 空 = MT_FONTS[1] (ゴシック)。値は font-family 文字列
    weight:900,          // 400 / 700 / 900
    stretch:180,         // 文字の横伸ばし (%)
    smooth:100,          // 溶かす半径 (%)。角が丸まり、近い線がつながる
    merge:30,            // つながりやすさ (%)。上げるほど太って一塊になる
    fins:100,            // 本体から横へ伸びるヒレの量 (%)
    finLen:100,          // ヒレの長さ (%)
    layers:100,          // 奥と手前に重なるヒレ層の量 (%)
    tendrils:100,        // 垂れる根の量 (%)
    tenLen:100,          // 根の長さ (%)
    holes:80,            // 穴の量 (%)
    holeSize:100,        // 穴 (ボロノイのセル) の大きさ (%)
    web:100,             // 穴のあいだの網の太さ (%)
    soft:100,            // 稜線の丸み (%)。距離場をぼかして中心線の折れを消す
    seed:0,              // ヒレ・根・穴の配置
    thick:100,           // 厚み (%)
    round:100,           // 縁の丸みの半径 (%)。小さいと平たい板、大きいと膨らんだ管
    puff:25,             // 広い面の膨らみ (%)
    lumps:40,            // 表面のこぶ (%)
    meltX:150,           // 溶かす向き: 横の比率 (%)。上げると文字どうしが横につながって帯になる
    finThick:55,         // ヒレ層の厚み (本体比 %)
    spread:100,          // ヒレ層の前後の離れ (%)
    splay:100,           // ヒレ層の開き角 (%)
    twist:0,             // 横軸まわりのねじり (%、符号で向き)
    bend:0,              // 弓なりの曲げ (%、符号で向き)
    liquid:0,            // 液状の揺れ (%)
    liqFreq:100,         // 揺れの細かさ (%)
    spin:100,            // 縦軸まわりの回転の速さ (%、符号で向き)
    spinRev:0,           // 1 = 逆回転 (Spin と Spin Step の向きを反転。拍の頭で切り替わる)
    revAuto:0,           // 1 = ランダムな拍数 (2〜16 拍) ごとに回転の向きを反転
    revAtk:0,            // 1 = 音のアタック (Audio.hitSeed が変わる) ごとに回転の向きを反転 (すぐ切り替わる)
    tumble:0,            // 横軸まわりの回転の速さ (%)
    tilt:18,             // 前後の傾き (°)。75 前後で寝かせた見え方 (参考画像)
    roll:0,              // 画面内の傾き (°)
    sway:0,              // 首振り (%)。回転の代わりに左右へ振る量
    spinStep:0,          // beat モードで 1 拍ごとに回す角度 (0 = 連続回転 / 45 / 90 / 180 / 360)
    size:100,            // 大きさ (%)
    posY:0,              // 上下の位置 (%)
    speed:100,           // 時間の速さ (%)
    kick:100,            // 拍の効き (%): 拍で膨らみ・揺れが跳ねる
    mat:1,               // 材質プリセットの番号 (MATS)。選ぶと下の材質パラメータが入れ替わる
    metal:100,           // 金属っぽさ (%)
    rough:12,            // 粗さ (%)。映り込みのぼけ
    gloss:100,           // つや (映り込みの強さ, %)
    envBri:100,          // 照明の明るさ (%)
    envRot:0,            // 照明の向き (°)
    sparkle:0,           // ラメ (%)
    irid:0,              // 玉虫色 (%)
    grain:10,            // ざらつき (%)
    surf:0,              // 肌のノイズ (%): 石膏のざらつき・気泡の穴・色むらを形に貼りつけて出す (回しても流れない)
    tint:[0.86, 0.87, 0.90],   // 地の色
    texAmt:0,            // 画像テクスチャの量 (%)
    texMode:0,           // 0 = 正面に貼る / 1 = 三面から貼る / 2 = 映り込みに使う
    texScale:100,        // テクスチャの大きさ (%)
    texFolder:'',        // images/ のフォルダ (folders.json の dir)
    texImage:'',         // フォルダ内のファイル名 (空 = 先頭)
    bgColor:[1, 1, 1],   // Slot A の背景色
    aa:2,                // 縁のギザ取り (MSAA のサンプル数: 0 = なし / 2 / 4)。1080p で 2x は約 2ms、4x は約 3ms 重くなる
  },

  // 材質プリセット: 選ぶと材質パラメータがまとめて入れ替わる (そのあと個別に動かせる)
  MATS:[
    { name:'Matte (石膏)',      metal:0,   rough:85, gloss:15,  envBri:95,  sparkle:0,  irid:0,  grain:8,  surf:100, tint:[0.80,0.79,0.77] },
    { name:'Chrome',            metal:100, rough:10, gloss:100, envBri:100, sparkle:0,  irid:0,  grain:6,  surf:0, tint:[0.90,0.91,0.94] },
    { name:'Black Chrome',      metal:100, rough:16, gloss:100, envBri:80,  sparkle:50, irid:18, grain:16, surf:0, tint:[0.30,0.28,0.30] },
    { name:'Candy Red',         metal:0,   rough:6,  gloss:140, envBri:100, sparkle:0,  irid:0,  grain:4,  surf:0, tint:[0.80,0.02,0.03] },
    { name:'Gold',              metal:100, rough:14, gloss:100, envBri:100, sparkle:10, irid:0,  grain:6,  surf:0, tint:[1.00,0.78,0.38] },
    { name:'Pearl',             metal:20,  rough:30, gloss:80,  envBri:110, sparkle:15, irid:80, grain:8,  surf:0, tint:[0.92,0.90,0.92] },
  ],
  setMat(i){
    const n = this.MATS.length; i = Math.max(0, Math.min(n - 1, Math.round(+i || 0)));
    const m = this.MATS[i];
    this.P.mat = i;
    for(const k of ['metal','rough','gloss','envBri','sparkle','irid','grain','surf']) this.P[k] = m[k];
    this.P.tint = m.tint.slice();
  },

  // 形のプリセット: 読める ↔ 紋章 (参考画像) の間で、溶かし・穴・ヒレ・根をまとめて入れ替える
  STYLES:[
    { name:'Legible (読める)',  stretch:150, smooth:60,  merge:15, meltX:110, holes:50, holeSize:90,  web:110, fins:60,  finLen:80,  layers:50,  tendrils:60,  tenLen:80 },
    { name:'Organic (既定)',    stretch:180, smooth:100, merge:30, meltX:150, holes:80, holeSize:100, web:100, fins:100, finLen:100, layers:100, tendrils:100, tenLen:100 },
    { name:'Sigil (紋章)',      stretch:220, smooth:125, merge:50, meltX:220, holes:90, holeSize:110, web:90,  fins:130, finLen:130, layers:130, tendrils:120, tenLen:120 },
  ],
  setStyle(i){
    const n = this.STYLES.length; i = Math.max(0, Math.min(n - 1, Math.round(+i || 0)));
    const st = this.STYLES[i];
    this.P.style = i;
    for(const k in st) if(k !== 'name') this.P[k] = st[k];
  },

  // 焼きに効くパラメータ (変わったら作り直す)。残りは毎フレームの uniform
  BAKE_KEYS:['text','font','weight','stretch','smooth','merge','meltX','fins','finLen','layers','tendrils','tenLen','holes','holeSize','web','soft','seed'],

  _dz(v){ return (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v; },
  _fontFamily(){
    const P = this.P;
    if(P.font) return P.font;
    return (typeof MT_FONTS !== 'undefined' && MT_FONTS[1]) ? MT_FONTS[1].ff : 'sans-serif';
  },

  // ===== タイピング (presets/chrometype.md の文字列を 1 字ずつ打つ) =====
  WORDS_URL:'presets/chrometype.md',
  loadWords(){
    this._wordsReq = true;
    return this._wordsP = fetch(this.WORDS_URL + '?t=' + Date.now(), { cache:'no-store' })
      .then(r=> r.ok ? r.text() : '').catch(()=> '')
      .then(src=>{ this._words = this.parseWords(src); this._ty = null; return this._words; });
  },
  // 1 行 = 1 つの文字列。先頭の - * + 1. を外し、# の見出し・> の行・空行は読まない。\n で改行
  parseWords(src){
    const out = [];
    for(let ln of String(src || '').split(/\r?\n/)){
      ln = ln.trim();
      if(!ln || ln[0] === '#' || ln[0] === '>' || ln.startsWith('<!--')) continue;
      ln = ln.replace(/^([-*+]|\d+[.)])\s+/, '').replace(/\\n/g, '\n').trim();
      if(ln) out.push(ln);
    }
    return out;
  },
  _graphemes(s){   // 濁点の結合文字や絵文字を 1 字として数える
    if(!this._seg && typeof Intl !== 'undefined' && Intl.Segmenter) this._seg = new Intl.Segmenter('ja', { granularity:'grapheme' });
    return this._seg ? Array.from(this._seg.segment(s), g=>g.segment) : Array.from(s);
  },
  // どの文字列の何字目まで見せるかを決める。打つ → Hold 拍そのまま → 消す → 次の文字列。
  // beat モードは拍に合わせ、drone モードは時間で進む (1 拍 = 0.5 秒)。逆再生 (←) でも先へ進むよう、進んだ量の絶対値を積む
  _typeStep(beat, clock){
    const P = this.P;
    if(!(P.typing > 0)){ this._ty = null; this._tyT = null; this._tyLastB = null; return; }
    if(!this._words){ if(!this._wordsReq) this.loadWords(); this._ty = null; return; }
    const beatMode = (typeof App !== 'undefined' && App.beatMode === 'beat') && beat != null && isFinite(beat);
    const b = beatMode ? beat : (clock != null && isFinite(clock) ? clock*2 : performance.now()/500);
    const d = this._tyLastB == null ? Infinity : b - this._tyLastB;
    this._tyLastB = b;
    const jump = this._tyT == null || Math.abs(d) > 4;   // 位相リセット (R)・モード切替で拍が飛んだ
    if(jump) this._tyT = beatMode ? b : Math.floor(this._tyT || 0);
    else this._tyT += Math.abs(d);
    const T = this._tyT;
    const list = this._words.length ? this._words : [String(P.text || ' ')];
    const rate = Math.max(0.05, +P.tyRate || 1), hold = Math.max(0, +P.tyHold || 0);
    const pick = (prev)=>{
      if(list.length < 2) return 0;
      if(P.tyOrder > 0){ let i; do{ i = Math.floor(Math.random()*list.length); }while(i === prev); return i; }
      return (prev + 1) % list.length;
    };
    const start = (i, b0)=>{
      const glines = list[i].split('\n').map(l=>this._graphemes(l));
      return { list, idx:i, phrase:list[i], glines, len:glines.reduce((a, g)=>a + g.length, 0), b0, n:0 };
    };
    const whole = P.typing >= 2;   // 全文: 1 字ずつ打たず、Hold 拍 (0 なら 1 拍) ごとに丸ごと入れ替える
    const dur = (t)=>{ if(whole) return Math.max(1, hold); const tt = t.len/rate; return tt + hold + (P.tyErase > 0 ? tt : 0); };
    let ty = this._ty;
    if(!ty || ty.list !== list) ty = start(P.tyOrder > 0 ? pick(-1) : 0, Math.floor(T));
    else if(jump) ty = start(ty.idx, Math.floor(T));
    for(let g=0; g<64 && T - ty.b0 >= dur(ty); g++) ty = start(pick(ty.idx), ty.b0 + dur(ty));
    if(T - ty.b0 >= dur(ty)) ty = start(pick(ty.idx), Math.floor(T));
    const t = T - ty.b0, tt = ty.len/rate;
    ty.n = whole ? ty.len
         : t < tt ? Math.min(ty.len, Math.floor(t*rate) + 1)
         : t < tt + hold ? ty.len
         : Math.max(0, ty.len - Math.floor((t - tt - hold)*rate) - 1);
    this._ty = ty;
  },
  // いま見せる文字 (先頭の n 字)。末尾の空白は形が変わらないので外す (焼き直さない)
  _tyShown(){
    const ty = this._ty;
    let left = ty.n;
    return ty.glines.map(g=>{ const k = Math.max(0, Math.min(g.length, left)); left -= k; return g.slice(0, k).join(''); })
      .join('\n').replace(/\s+$/, '');
  },

  init(gl){
    this.gl = gl;
    this.initialized = true;
    const vs = `#version 300 es
precision highp float;
uniform sampler2D uSDF;
uniform vec2 uTexSize;
uniform float uCols, uGrid;
uniform vec2 uWorld;             // テクスチャ全体の大きさ (F 単位)
uniform vec2 uCenter;            // 形の中心 (F 単位)。ここを回転の中心にする
uniform float uR, uPuff, uThick, uFinThick, uSpread, uSplay;
uniform float uTwist, uBend, uLiq, uLiqF, uT;
uniform int uDeform;
uniform int uSide;
uniform vec3 uLayerOn;
uniform mat3 uRot;
uniform float uScale;
uniform vec3 uPos;
uniform mat4 uVP;
out vec2 vUV;
out float vH;
out vec3 vWP, vLP;
out vec3 vC0, vC1, vC2;
flat out int vLayer;
flat out float vSide;
${this._glslProf()}
float ct_h3(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x + p.y + p.z)); }
float ct_vn(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0 - 2.0*f);
  return mix(mix(mix(ct_h3(i), ct_h3(i + vec3(1,0,0)), f.x), mix(ct_h3(i + vec3(0,1,0)), ct_h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(ct_h3(i + vec3(0,0,1)), ct_h3(i + vec3(1,0,1)), f.x), mix(ct_h3(i + vec3(0,1,1)), ct_h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
vec3 ct_deform(vec3 p){
  if(uLiq > 0.0){
    vec3 q = p*uLiqF + vec3(0.0, 0.0, uT*0.6);
    p += uLiq*(vec3(ct_vn(q), ct_vn(q + 31.7), ct_vn(q + 57.3)) - 0.5);
  }
  if(uTwist != 0.0){ float a = uTwist*p.x; float c = cos(a), s = sin(a); p.yz = vec2(c*p.y - s*p.z, s*p.y + c*p.z); }
  if(abs(uBend) > 1e-4){
    float r = 1.0/uBend, a = p.x*uBend, rr = r - p.z;
    p = vec3(rr*sin(a), p.y, r - rr*cos(a));
  }
  return p;
}
void main(){
  int side = uSide;                // 上面 (0) と下面 (1) は別の描画: 下面は巻き方向を逆にして背面カリングを効かせる
  int layer = gl_InstanceID;
  float on = layer == 0 ? uLayerOn.x : (layer == 1 ? uLayerOn.y : uLayerOn.z);
  float id = float(gl_VertexID);
  float gy = floor(id/uCols), gx = id - gy*uCols;
  vec2 px = min(vec2(gx, gy)*uGrid, uTexSize - 1.0);
  vec2 uv = (px + 0.5)/uTexSize;
  vec4 S = ct_S(uv);
  float d = layer == 0 ? S.r : (layer == 1 ? S.g : S.b);
  float th = uThick*(layer == 0 ? 1.0 : uFinThick);
  float h = ct_prof(d, layer, uv, 1.0);
  vH = h;
  vUV = uv;
  vLayer = layer;
  vSide = side == 0 ? 1.0 : -1.0;
  vec3 p = vec3((uv.x - 0.5)*uWorld.x - uCenter.x, (0.5 - uv.y)*uWorld.y - uCenter.y, vSide*th*max(h, -uR));
  // ヒレ層: 前後へ離し、横軸まわりに開く (層 1 = 奥 / 層 2 = 手前)
  mat3 LR = mat3(1.0);
  if(layer > 0){
    float sg = layer == 1 ? -1.0 : 1.0;
    float a = sg*uSplay;
    float c = cos(a), s = sin(a);
    LR = mat3(1.0, 0.0, 0.0,  0.0, c, s,  0.0, -s, c);
    p = LR*p + vec3(0.0, 0.0, sg*uSpread);
  }
  vLP = p;
  vec3 q = p;
  vec3 c0 = LR[0], c1 = LR[1], c2 = LR[2];
  if(uDeform == 1){
    const float e = 0.01;
    vec3 b = ct_deform(p);
    vec3 jx = (ct_deform(p + vec3(e,0,0)) - b)/e, jy = (ct_deform(p + vec3(0,e,0)) - b)/e, jz = (ct_deform(p + vec3(0,0,e)) - b)/e;
    mat3 J = mat3(jx, jy, jz)*LR;
    c0 = cross(J[1], J[2]); c1 = cross(J[2], J[0]); c2 = cross(J[0], J[1]);   // 余因子 = 法線の変換
    q = b;
  }
  vC0 = uRot*c0; vC1 = uRot*c1; vC2 = uRot*c2;
  vec3 wp = uRot*(q*uScale) + uPos;
  vWP = wp;
  gl_Position = on > 0.5 ? uVP*vec4(wp, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;
    const fs = `#version 300 es
precision highp float;
uniform sampler2D uSDF;
uniform sampler2D uTex;
uniform vec2 uTexSize;
uniform vec2 uWorld;
uniform float uR, uPuff, uThick, uFinThick;
uniform vec3 uCam;
uniform float uMetal, uRough, uGloss, uEnvBri, uEnvRot, uSparkle, uIrid, uGrain;
uniform float uSurf;
uniform vec3 uTint;
uniform float uTexAmt, uTexScale, uTexAspect;
uniform int uTexMode, uHasTex;
uniform float uT;
in vec2 vUV;
in float vH;
in vec3 vWP, vLP;
in vec3 vC0, vC1, vC2;
flat in int vLayer;
flat in float vSide;
out vec4 o;
${this._glslProf()}
float ct_hash(vec3 p){ p = fract(p*vec3(443.897, 441.423, 437.195)); p += dot(p, p.yzx + 19.19); return fract((p.x + p.y)*p.z); }
// 値ノイズと勾配 (x = 値 0..1 / yzw = 勾配)。石膏の肌 (Surface) に使う
vec4 ct_vnd(vec3 x){
  vec3 i = floor(x), f = fract(x);
  vec3 u = f*f*(3.0 - 2.0*f), du = 6.0*f*(1.0 - f);
  float a = ct_hash(i), b = ct_hash(i + vec3(1,0,0)), c = ct_hash(i + vec3(0,1,0)), d = ct_hash(i + vec3(1,1,0));
  float e = ct_hash(i + vec3(0,0,1)), f1 = ct_hash(i + vec3(1,0,1)), g = ct_hash(i + vec3(0,1,1)), h = ct_hash(i + vec3(1,1,1));
  float k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + g, k6 = a - b - e + f1, k7 = -a + b + c - d + e - f1 - g + h;
  return vec4(a + k1*u.x + k2*u.y + k3*u.z + k4*u.x*u.y + k5*u.y*u.z + k6*u.z*u.x + k7*u.x*u.y*u.z,
              du*vec3(k1 + k4*u.y + k6*u.z + k7*u.y*u.z, k2 + k5*u.z + k4*u.x + k7*u.z*u.x, k3 + k6*u.x + k5*u.y + k7*u.x*u.y));
}
// スタジオ照明: 暗い床 / 灰色の壁 / 天井の大きな面光源 / 左右の縦長の光 / 水平の細い光
vec3 ct_env(vec3 r, float rough){
  float ca = cos(uEnvRot), sa = sin(uEnvRot);
  r.xz = vec2(ca*r.x - sa*r.z, sa*r.x + ca*r.z);
  float y = r.y;
  float az = atan(r.x, r.z);
  float w = 0.015 + rough*0.55;
  vec3 c = mix(vec3(0.015), vec3(0.10), smoothstep(-1.0, -0.05, y));
  c = mix(c, vec3(0.40, 0.40, 0.41), smoothstep(-0.08, 0.5, y));
  float top = smoothstep(0.62 - w, 0.80 + w*0.5, y);
  c += vec3(1.9)*top*(0.75 + 0.25*smoothstep(-0.5, 0.5, cos(az*2.0)));
  float ring = exp(-pow((y - 0.06)/(0.025 + rough*0.35), 2.0));
  c += vec3(1.25)*ring*(0.55 + 0.45*cos(az*3.0 + 0.7));
  for(int i=0;i<3;i++){
    float a0 = i == 0 ? -1.1 : (i == 1 ? 1.25 : 2.75);
    float da = abs(mod(az - a0 + 3.14159, 6.28318) - 3.14159);
    float strip = 1.0 - smoothstep(0.10, 0.10 + w*1.6, da);
    float vert = smoothstep(-0.35 - w, -0.15, y)*(1.0 - smoothstep(0.55, 0.70 + w, y));
    c += vec3(1.5, 1.48, 1.45)*strip*vert*(i == 2 ? 0.55 : 1.0);
  }
  c += vec3(0.25)*exp(-pow((y + 0.35)/(0.06 + rough*0.3), 2.0))*smoothstep(-0.2, 0.6, cos(az - 0.4));   // 床の照り返し
  return c*uEnvBri;
}
vec3 ct_envImg(vec3 r){
  float ca = cos(uEnvRot), sa = sin(uEnvRot);
  r.xz = vec2(ca*r.x - sa*r.z, sa*r.x + ca*r.z);
  vec2 uv = vec2(atan(r.x, -r.z)/6.28318 + 0.5, acos(clamp(r.y, -1.0, 1.0))/3.14159);
  return texture(uTex, uv).rgb*uEnvBri;
}
vec3 ct_texPlanar(vec2 p){
  vec2 uv = p/(uWorld.y*uTexScale);
  uv.x /= uTexAspect;
  return texture(uTex, fract(uv + 0.5)).rgb;
}
void main(){
  // 縁: 補間した高さが 0 になる線。MSAA 時は alpha-to-coverage で縁をなめらかにする
  // (ぼかすのは線の外側だけ。内側まで薄くすると上面と下面の継ぎ目に背景が透ける)
  float cover = clamp(vH/max(fwidth(vH), 1e-6) + 1.0, 0.0, 1.0);
  float lpw = uSurf > 0.0 ? length(fwidth(vLP)) : 0.0;   // 1 画素あたりの肌の座標の幅 (細かすぎる粒を消す)
  if(cover <= 0.0) discard;
  float th = uThick*(vLayer == 0 ? 1.0 : uFinThick);
  vec2 e = 1.0/uTexSize;
  vec2 ux = vec2(e.x, 0.0), uy = vec2(0.0, e.y);
  float hx1 = ct_prof(ct_sd(vUV + ux, vLayer), vLayer, vUV + ux, 0.0), hx0 = ct_prof(ct_sd(vUV - ux, vLayer), vLayer, vUV - ux, 0.0);
  float hy1 = ct_prof(ct_sd(vUV + uy, vLayer), vLayer, vUV + uy, 0.0), hy0 = ct_prof(ct_sd(vUV - uy, vLayer), vLayer, vUV - uy, 0.0);
  float Hx = (hx1 - hx0)/(2.0*e.x*uWorld.x), Hy = -(hy1 - hy0)/(2.0*e.y*uWorld.y);
  vec3 nL = normalize(vec3(-th*Hx, -th*Hy, vSide));
  vec3 N = normalize(mat3(vC0, vC1, vC2)*nL);
  vec3 V = normalize(uCam - vWP);
  if(dot(N, V) < -0.2) N = -N;
  // 石膏の肌: 形の座標 (vLP, F 単位) に貼りつけたざらつきの凹凸 + 気泡の穴 + 色むら
  float sAlb = 1.0, sCav = 1.0, pw = 0.0;
  if(uSurf > 0.0){
    vec3 lp = vLP + float(vLayer)*7.31;
    vec3 g = vec3(0.0);
    float fr = 100.0, w = 1.0, sp = 0.0;
    for(int i=0;i<3;i++){
      float fade = 1.0 - smoothstep(0.4, 0.95, lpw*fr);
      vec4 n = ct_vnd(lp*fr + float(i)*17.3);
      g += n.yzw*w*fade;
      sp += (n.x - 0.5)*w*fade;
      fr *= 2.1; w *= 0.8;
    }
    g *= 0.34;
    // 気泡の穴: 近い 8 セルの中で一番近い穴 (ないセルもある) をすり鉢にする
    vec3 pc = lp*38.0;
    vec3 b0 = floor(pc - 0.5);
    float pit = 0.0;
    float pfade = 1.0 - smoothstep(0.1, 0.25, lpw*38.0);
    for(int k=0;k<8;k++){
      vec3 c = b0 + vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
      float hs = ct_hash(c + 3.7);
      if(hs > 0.35) continue;
      vec3 ctr = c + 0.5 + (vec3(ct_hash(c + 1.1), ct_hash(c + 2.3), ct_hash(c + 4.9)) - 0.5)*0.5;
      float r = mix(0.10, 0.26, ct_hash(c + 6.1));
      vec3 dv = pc - ctr;
      float t = dot(dv, dv)/(r*r);
      if(t < 1.0){
        float bowl = 1.0 - t;
        if(bowl > pit){ pit = bowl; g += dv*(2.0/(r*r))*0.025*pfade; }
      }
    }
    pit *= pfade;
    float m = ct_vnd(lp*2.6 + 11.7).x;
    float am = min(uSurf, 1.0);
    pw = am;
    // 粉の粒: 形に貼りつけた細かい点のむら (細かすぎる所は消す)
    float gr = ct_hash(floor(lp*280.0));
    float gfade = 1.0 - smoothstep(0.5, 1.0, lpw*280.0);
    sAlb = 1.0 + am*((m - 0.5)*0.08 + sp*0.10 + (gr - 0.5)*0.22*gfade);
    sCav = 1.0 - am*pit*0.6;
    vec3 gw = mat3(vC0, vC1, vC2)*g;
    N = normalize(N - uSurf*(gw - dot(gw, N)*N));
  }
  vec3 R = reflect(-V, N);
  float NV = clamp(dot(N, V), 0.0, 1.0);

  vec3 alb = uTint;
  vec3 env = ct_env(R, uRough);
  if(uHasTex == 1 && uTexAmt > 0.0){
    if(uTexMode == 2){
      env = mix(env, ct_envImg(R), uTexAmt);
    } else {
      vec3 tc;
      if(uTexMode == 1){
        vec3 an = abs(nL); an = pow(an, vec3(4.0)); an /= (an.x + an.y + an.z);
        tc = ct_texPlanar(vLP.zy)*an.x + ct_texPlanar(vLP.xz)*an.y + ct_texPlanar(vLP.xy)*an.z;
      } else {
        tc = ct_texPlanar(vLP.xy);
      }
      alb = mix(alb, tc, uTexAmt);
    }
  }
  alb *= sAlb;
  // 拡散: 上からの大きな面光源 + 左上の主光
  vec3 L = normalize(vec3(-0.45, 0.75, 0.55));
  float wr = 0.7*pw;   // 粉っぽさ: 光が回り込んで影が浮く (影は控えめ)
  float dif = max((dot(N, L) + wr)/(1.0 + wr), 0.0);
  float sky = 0.5 + 0.5*N.y;
  vec3 irr = vec3(0.26)*sky + vec3(0.08 + 0.12*pw) + vec3(0.9)*dif;
  irr *= uEnvBri;
  // 縁の暗がり (高さの低い所 = 穴の縁・付け根を少し落とす)
  float cav = mix(mix(0.72, 1.0, smoothstep(0.0, uR*0.9, vH)), 1.0, 0.45*pw)*sCav;
  vec3 F0 = mix(vec3(0.06), alb, uMetal);
  vec3 Fr = F0 + (1.0 - F0)*pow(1.0 - NV, 5.0)*(1.0 - uRough*0.7);
  vec3 col = alb*irr*(1.0 - uMetal)*cav + env*Fr*uGloss*mix(1.0, cav, 0.5);
  col += alb*pow(1.0 - NV, 2.5)*0.25*pw*uEnvBri*(1.0 - uMetal);   // 粉の縁のふわっとした明るさ
  // 主光の鋭いハイライト (非金属のつや)
  vec3 Hh = normalize(L + V);
  float sp = pow(max(dot(N, Hh), 0.0), mix(400.0, 12.0, uRough));
  col += vec3(1.0)*sp*uGloss*(1.0 - uMetal)*0.6*uEnvBri;
  // 玉虫色 (薄膜): 見る角度で色相が回る
  if(uIrid > 0.0){
    vec3 film = 0.5 + 0.5*cos(6.28318*(vec3(0.0, 0.33, 0.67) + 1.3*(1.0 - NV) + 0.12*vLP.x));
    col = mix(col, col*mix(vec3(1.0), film*1.7, 0.7), uIrid);
  }
  // ラメ: 細かい粒が光の向きで瞬く
  if(uSparkle > 0.0){
    vec3 cell = floor(vLP*vec3(260.0));
    float hsh = ct_hash(cell + float(vLayer)*13.0);
    vec3 fn = normalize(vec3(ct_hash(cell + 1.3), ct_hash(cell + 2.7), ct_hash(cell + 5.1)) - 0.5);
    float g = pow(max(dot(normalize(N + fn*0.6), Hh), 0.0), 60.0)*step(0.55, hsh);
    col += vec3(1.0, 0.97, 0.95)*g*uSparkle*2.5*uEnvBri;
  }
  if(uGrain > 0.0){
    float n = ct_hash(vec3(gl_FragCoord.xy, floor(uT*24.0)));
    col *= 1.0 + (n - 0.5)*uGrain;
  }
  o = vec4(clamp(col, 0.0, 1.0), cover);   // Post FX (Grad Map など) は 0..1 を前提にしている
}`;
    this.prog = this._link(vs, fs);
    this.ok = !!this.prog;
    if(!this.ok) return;
    this.U = {};
    const nU = gl.getProgramParameter(this.prog, gl.ACTIVE_UNIFORMS);
    for(let i=0;i<nU;i++){ const a = gl.getActiveUniform(this.prog, i); this.U[a.name] = gl.getUniformLocation(this.prog, a.name); }
    this.vao = gl.createVertexArray();
    this.ibo = gl.createBuffer();
    this._iboBack = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bindVertexArray(null);
    this.sdfTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.sdfTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array([-4, -4, -4, 0]));
    this.texTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this._bakeKey = '';
    this._initBake();
    // Web フォント (Adobe Fonts など) が後から届いたら焼き直す (先に焼くと代わりの書体のまま残る)
    if(document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', ()=>{ this._bakeKey = ''; this._fontKey = ''; });
  },

  // 距離 → 高さ (F 単位、厚み前)。縁は円弧で立ち上がり (上下の法線が縁で水平に揃う)、広い面は Puff で膨らむ。
  // 外側は負に延ばす: 補間した高さが 0 になる線で上下の面が閉じる
  _glslProf(){ return `
uniform float uLump;
uniform float uEdge;             // 縁の線形区間 (F 単位)。格子で補間したときに縁がギザにならないよう、0 の前後は距離に比例させる
uniform sampler2D uSDFPrev;      // 移り変わり: 前の形 (今の形の座標へ写したもの)
uniform float uMorph;            // 0 = 前の形 → 1 = 今の形
vec4 ct_smax(vec4 a, vec4 b, float k){ vec4 h = max(k - abs(a - b), 0.0)/k; return max(a, b) + h*h*k*0.25; }
// 前半で今の形が芯から育ち、後半で前の形が縁から溶けて消える。なめらかな和でつなぐので途中で痩せない
// (距離をそのまま混ぜると、前後で重ならない所が途中で消えて小さくなる)。削る深さ (F 単位) は浅く一定に進め、両端だけ深くして形を残さない
vec4 ct_S(vec2 uv){
  vec4 s = textureLod(uSDF, uv, 0.0);
  if(uMorph >= 0.999) return s;
  vec4 p = textureLod(uSDFPrev, uv, 0.0);
  float gb = 1.0 - clamp(uMorph*2.0, 0.0, 1.0), ga = clamp(uMorph*2.0 - 1.0, 0.0, 1.0);
  return ct_smax(p - (0.22*ga + 0.8*pow(ga, 6.0)), s - (0.22*gb + 0.8*pow(gb, 6.0)), 0.35);
}
float ct_sd(vec2 uv, int L){ vec4 s = ct_S(uv); return L == 0 ? s.r : (L == 1 ? s.g : s.b); }
float ct_h2(vec2 p){ p = fract(p*vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y)*p.x); }
float ct_vn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
  return mix(mix(ct_h2(i), ct_h2(i + vec2(1,0)), f.x), mix(ct_h2(i + vec2(0,1)), ct_h2(i + vec2(1,1)), f.x), f.y); }
// 高さ (F 単位、厚み前)。uv はこぶ (Lumps) の位置に使う
// lin = 1 (頂点): 縁の前後を距離に比例させる。lin = 0 (画素の法線): 円弧のまま (折れ目の帯を出さない)
float ct_prof(float d, int L, vec2 uv, float lin){
  float R = L == 0 ? uR : uR*0.7;
  if(lin > 0.5){
    float E = min(uEdge, R*0.5);
    float hE = R*sqrt(max(1.0 - (1.0 - E/R)*(1.0 - E/R), 0.0));
    if(d <= -E) return -R*sqrt(min(-d/R, 1.0)) + (R*sqrt(E/R) - hE);
    if(d < E) return d*(hE/E);
  } else if(d <= 0.0) return -R*sqrt(min(-d/R, 1.0));
  float x = min(d/R, 1.0);
  float h = R*sqrt(max(1.0 - (1.0 - x)*(1.0 - x), 0.0));
  h += uPuff*(sqrt(max(d - R, 0.0) + 0.0025) - 0.05);
  if(uLump > 0.0){
    vec2 q = uv*uWorld*2.2 + float(L)*7.3;
    float n = ct_vn2(q)*0.65 + ct_vn2(q*2.3 + 5.1)*0.35;
    h *= 1.0 + uLump*(n - 0.45)*1.6;
  }
  return h;
}`; },

  _link(vsSrc, fsSrc){
    const gl = this.gl;
    const mk = (t, s)=>{ const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh);
      if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){ console.error('ChromeType shader:', gl.getShaderInfoLog(sh)); return null; } return sh; };
    const v = mk(gl.VERTEX_SHADER, vsSrc), f = mk(gl.FRAGMENT_SHADER, fsSrc);
    if(!v || !f) return null;
    const p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)){ console.error('ChromeType link:', gl.getProgramInfoLog(p)); return null; }
    return p;
  },

  // ===== 焼き =====
  _key(){ const P = this.P; return JSON.stringify(this.BAKE_KEYS.map(k=>P[k])); },
  update(opts){
    if(!this.initialized || !this.ok) return;
    this._typeStep(opts ? opts.beat : null, opts ? opts.clock : null);
    const k = this._key(), tk = this._ty ? '\u0001' + this._tyShown() : '';
    const now = performance.now();
    if(k !== this._bakeKey || tk !== this._bakeTy){
      // 初回とタイピングの 1 字は即座に焼く。スライダーや MIDI で続けて動いている間は待つ (止まって 120ms 後に焼く)
      if(!this._baking && (!this.bake || k === this._bakeKey)){ this._bakeKey = k; this._bakeTy = tk; this._startBake(); }
      else if(k !== this._bakeKey){
        if(this._pendKey !== k){ this._pendKey = k; this._bakeDirtyAt = now; }
        else if(now - this._bakeDirtyAt > 120 && !this._baking){ this._bakeKey = k; this._bakeTy = tk; this._startBake(); }
      }
    }
    this._syncTexture();
  },
  // slot ごとにキャンバスを使い回す。縁の点を読み出す 'full' だけ CPU 側に置き、ほかは GPU のキャンバスにする
  // (テクスチャへの転送が GPU 内のコピーで済む。CPU 側のキャンバスからだと 1 回の焼きで 20ms 以上かかる)
  _ctx2d(w, h, slot){
    const pool = this._cv || (this._cv = {});
    const c = pool[slot] || (pool[slot] = document.createElement('canvas'));
    if(c.width !== w || c.height !== h){ c.width = w; c.height = h; }
    const ctx = c.getContext('2d', { willReadFrequently: slot === 'full' });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);   // 黒地に白で描く (R = 覆い)
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff';
    return ctx;
  },
  async _startBake(){
    const P = this.P;
    this._baking = true;
    const ty = this._ty;
    const text = ty ? this._tyShown() : String(P.text == null ? '' : P.text);
    const fontText = ty ? ty.phrase : text;   // タイピング中は文字列ごとに 1 回だけ読み込みを待つ (1 字ごとはその場で焼く)
    const ff = this._fontFamily();
    const wt = Math.round(+P.weight || 900);
    const F0 = 160;
    const fontStr = (s)=> wt + ' ' + s + 'px ' + ff;
    const fk = fontStr(F0) + '\u0000' + fontText;
    if(fk !== this._fontKey){
      try{ if(document.fonts && document.fonts.load) await document.fonts.load(fontStr(F0), fontText || ' '); }catch(e){}
      this._fontKey = fk;
    }
    try{
      // タイピング中は描くセルを数フレーム後に読み戻す (その場で待つと 1 字ごとに 30ms 止まる)
      this._gpuBake(this._prepJob(F0, fontStr, text), ty && !this._occSync ? 'async' : 'sync');
      this._occSync = false;
    }catch(e){ console.error('ChromeType bake:', e); }
    this._baking = false;
  },

  // キャンバスに 文字 / ヒレと根 / 奥と手前のヒレ層 を描く (溶かす・穴・距離は GPU)
  _prepJob(F0, fontStr, text){
    const P = this.P;
    const dz = (v)=>this._dz(v);
    const pc = (v, lo, hi)=> Math.max(lo, Math.min(hi, dz(v)*0.01));
    const seed = Math.round(+P.seed || 0);
    const R = (()=>{ let s = (seed*2246822519 + 12345) >>> 0 || 7; return ()=>{ s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
    const lines = String(text).split('\n').map(s=>s.replace(/\s+$/,'')).filter((s, i, a)=> s.length || a.length === 1);
    if(!lines.length) lines.push(' ');
    const stretch = pc(P.stretch, 0.3, 4);
    const finK = pc(P.fins, 0, 4), finL = pc(P.finLen, 0.1, 4);
    const layK = pc(P.layers, 0, 4);
    const tenK = pc(P.tendrils, 0, 4), tenL = pc(P.tenLen, 0.1, 4);
    const sm = pc(P.smooth, 0, 4), mg = pc(P.merge, 0, 1), mX = pc(P.meltX, 0.3, 6);
    // 寸法 (F0 基準 px)
    const m = this._ctx2d(4, 4, 'm');
    m.font = fontStr(F0);
    let asc = F0*0.8, desc = F0*0.2;
    const lw = lines.map(s=>{ const mm = m.measureText(s); asc = Math.max(asc, mm.actualBoundingBoxAscent || 0); desc = Math.max(desc, mm.actualBoundingBoxDescent || 0); return mm.width*stretch; });
    const tw = Math.max(F0*0.5, ...lw);
    const lh = (asc + desc)*1.02;
    const th = lh*lines.length;
    const finMax = (finK > 0 || layK > 0) ? F0*finL*2.0 : 0;
    const mx = F0*0.35 + F0*0.09*sm*mX + finMax;
    const mTop = F0*0.4 + F0*0.09*sm;
    const mBot = F0*0.4 + F0*0.09*sm + (tenK > 0 ? F0*1.4*tenL : 0);
    const W0 = tw + mx*2, H0 = th + mTop + mBot;
    const s = Math.min(1.3, 2048/W0, 1024/H0, Math.sqrt(1.6e6/(W0*H0)));
    const W = Math.max(16, Math.ceil(W0*s)), H = Math.max(16, Math.ceil(H0*s));
    const F = F0*s;
    const cx = W/2;
    // 本体: 文字 (GPU のキャンバス)
    const drawText = (ctx, k)=>{
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
      ctx.font = fontStr(F0);
      lines.forEach((ln, i)=>{
        ctx.setTransform(s*stretch*k, 0, 0, s*k, cx*k, (mTop + asc + i*lh)*s*k);
        ctx.fillText(ln, 0, 0);
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
    const c0 = this._ctx2d(W, H, 'body');
    drawText(c0, 1);
    // 縁の点と外向きの向き (覆いの勾配)。半分の解像度で描いた CPU のキャンバスから拾う (座標は元の解像度)
    const hw = Math.ceil(W/2), hh = Math.ceil(H/2);
    const cE = this._ctx2d(hw, hh, 'full');
    drawText(cE, 0.5);
    const a0 = cE.getImageData(0, 0, hw, hh).data;
    const cov = (x, y)=> a0[(y*hw + x)*4]/255;
    const edge = [];
    let minX = W, maxX = 0, minY = H, maxY = 0;
    for(let y=2;y<hh-2;y++) for(let x=2;x<hw-2;x++){
      if(cov(x, y) < 0.5) continue;
      const X = x*2, Y = y*2;
      if(X < minX) minX = X; if(X > maxX) maxX = X; if(Y < minY) minY = Y; if(Y > maxY) maxY = Y;
      if(cov(x-1, y) < 0.5 || cov(x+1, y) < 0.5 || cov(x, y-1) < 0.5 || cov(x, y+1) < 0.5){
        let gx = 0, gy = 0;
        for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){ const v = cov(x + dx, y + dy); gx -= v*dx; gy -= v*dy; }
        const gn = Math.hypot(gx, gy) || 1;
        edge.push([X, Y, gx/gn, gy/gn]);
      }
    }
    if(maxX < minX){ minX = W*0.4; maxX = W*0.6; minY = H*0.4; maxY = H*0.6; }
    const tW = Math.max(1, (maxX - minX)/2), tcx = (minX + maxX)/2;
    const bb = [minX, minY, maxX, maxY];
    const grow = (x, y)=>{ if(x < bb[0]) bb[0] = x; if(x > bb[2]) bb[2] = x; if(y < bb[1]) bb[1] = y; if(y > bb[3]) bb[3] = y; };
    const pickEdge = (wf)=>{   // 重み付きの抽選 (棄却法)
      if(!edge.length) return null;
      for(let k=0;k<60;k++){ const e = edge[Math.floor(R()*edge.length)]; if(R() < wf(e)) return e; }
      return edge[Math.floor(R()*edge.length)];
    };
    // 葉の形の刃: 背骨が弧を描き、幅は根元から膨らんで先で尖る (上下の縁で膨らみ方が違う)
    const blade = (ctx, x, y, ang, L, wb, bend, bulge, asym)=>{
      const dx = Math.cos(ang), dy = Math.sin(ang), px = -dy, py = dx;
      const room = Math.min(dx > 0 ? (W - 6 - x)/dx : (dx < 0 ? (x - 6)/-dx : 1e9), dy > 0 ? (H - 6 - y)/dy : (dy < 0 ? (y - 6)/-dy : 1e9)) - Math.abs(bend) - wb;
      L = Math.max(0, Math.min(L, room));
      if(L < wb) return;
      const NS = 28, up = [], dn = [];
      for(let i=0;i<=NS;i++){
        const t = i/NS;
        const cxp = x + dx*L*t + px*bend*t*t, cyp = y + dy*L*t + py*bend*t*t;
        const wt = wb*Math.pow(1 - t, 0.85)*(1 + bulge*Math.sin(Math.PI*Math.min(1, t*1.4)));
        up.push([cxp + px*wt*(1 + asym), cyp + py*wt*(1 + asym)]);
        dn.push([cxp - px*wt*(1 - asym), cyp - py*wt*(1 - asym)]);
      }
      ctx.beginPath();
      ctx.moveTo(up[0][0], up[0][1]);
      for(let i=1;i<=NS;i++){ ctx.lineTo(up[i][0], up[i][1]); grow(up[i][0], up[i][1]); }
      for(let i=NS;i>=0;i--){ ctx.lineTo(dn[i][0], dn[i][1]); grow(dn[i][0], dn[i][1]); }
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, wb, 0, Math.PI*2); ctx.fill();
    };
    const nChars = lines.reduce((a, l)=>a + [...l].length, 0);
    const ca = this._ctx2d(W, H, 'blades');              // ヒレと根 (本体を溶かしたあとで足す)
    // ヒレ (本体につながる): 横向きの縁から、ほぼ水平に外へ。両端ほど長い
    const nFin = Math.min(90, Math.round(finK*(3 + nChars*1.0)));
    for(let k=0;k<nFin;k++){
      const e = pickEdge(e=>{ const ex = Math.abs(e[0] - tcx)/tW; return Math.pow(Math.abs(e[2]), 1.5)*(0.2 + ex*ex*ex); });
      if(!e) break;
      const sg = e[2] >= 0 ? 1 : -1;
      const ex = Math.abs(e[0] - tcx)/tW;
      const ang = Math.atan2(e[3]*0.3 + (R() - 0.5)*0.4, sg);
      const L = F*finL*(0.45 + 1.3*Math.pow(R(), 1.5))*(0.5 + 0.8*ex);
      const wb = F*(0.045 + 0.13*Math.pow(R(), 1.3));
      blade(ca, e[0] - Math.cos(ang)*wb, e[1] - Math.sin(ang)*wb, ang, L, wb, (R() - 0.5)*L*0.35, 0.3 + 0.9*R(), (R() - 0.5)*0.9);
    }
    // 根: 中央寄りの下向きの縁から垂れて枝分かれし、先が鉤のように巻く。線分は太さごとにまとめて描く
    const nTen = Math.min(40, Math.round(tenK*(1 + nChars*0.2)));
    const segs = new Map();
    const root = (x, y, ang, w, len, depth)=>{
      const seg = Math.max(1.5, F*0.025);
      const steps = Math.max(2, Math.round(len/seg));
      const wEnd = Math.max(0.7, F*0.007);
      const taper = Math.pow(wEnd/Math.max(w, wEnd + 0.01), 1/steps);
      const hook = (R() < 0.5 ? -1 : 1)*(0.6 + 0.8*R());
      let a = ang;
      for(let i=0;i<steps;i++){
        const pr = i/steps;
        a += (R() - 0.5)*0.3 + hook*0.16*Math.pow(pr, 2.2);
        a += (Math.PI/2 - a)*0.05*(1 - pr)*(depth === 0 ? 1 : 0.4);   // 根元ほど下へ向かう
        const nx = x + Math.cos(a)*seg, ny = y + Math.sin(a)*seg;
        const key = Math.max(1, Math.round(w*4));
        let arr = segs.get(key); if(!arr){ arr = []; segs.set(key, arr); }
        arr.push(x, y, nx, ny);
        grow(nx, ny);
        x = nx; y = ny; w *= taper;
        if(depth < 3 && i > 2 && pr < 0.8 && R() < 0.10){
          const sg = R() < 0.5 ? -1 : 1;
          root(x, y, a + sg*(0.5 + 0.7*R()), w*0.78, (steps - i)*seg*(0.5 + 0.45*R()), depth + 1);
        }
        if(y > H - 4 || x < 4 || x > W - 4) break;
      }
    };
    for(let k=0;k<nTen;k++){
      const e = pickEdge(e=>{
        if(e[3] <= 0.4) return 0;
        const cxk = (e[0] - tcx)/(tW*0.45);
        return Math.pow(e[3], 2)*Math.exp(-cxk*cxk)*(0.25 + 0.75*Math.max(0, (e[1] - minY)/Math.max(1, maxY - minY)));
      });
      if(!e || e[3] <= 0.3) continue;
      const w0 = F*(0.03 + 0.035*R());
      root(e[0] - e[2]*w0, e[1] - e[3]*w0, Math.PI/2 + (R() - 0.5)*0.8 + e[2]*0.3, w0, F*tenL*(0.6 + 0.8*R()), 0);
    }
    ca.lineCap = 'round'; ca.lineJoin = 'round';
    for(const [key, arr] of segs){
      ca.lineWidth = key*0.5;
      ca.beginPath();
      for(let i=0;i<arr.length;i+=4){ ca.moveTo(arr[i], arr[i+1]); ca.lineTo(arr[i+2], arr[i+3]); }
      ca.stroke();
    }
    // ヒレ層 (奥と手前): 文字の左右の端寄りから外へ、幅の広い刃・板を重ねる
    const lay = [null, null];
    const nLay = Math.min(30, Math.round(layK*(1.5 + nChars*0.35)));
    for(let L=0; L<2 && nLay > 0; L++){
      const c = this._ctx2d(W, H, 'lay' + L);
      for(let k=0;k<nLay;k++){
        const sg = R() < 0.5 ? -1 : 1;
        const ex = 0.45 + 0.55*R();
        const fx = tcx + sg*tW*ex;
        const fy = minY + (maxY - minY)*(0.2 + 0.6*R());
        const ang = Math.atan2((R() - 0.5)*0.2, sg);
        const L2 = F*finL*(0.6 + 1.2*R())*(0.6 + 0.6*ex);
        const wb = F*(0.07 + 0.16*Math.pow(R(), 1.4));
        blade(c, fx - sg*F*0.25, fy, ang, L2 + F*0.25, wb, (R() - 0.5)*L2*0.2, 0.2 + 0.7*R(), (R() - 0.5)*0.8);
      }
      lay[L] = c.canvas;
    }
    const mg2 = F*0.09*sm;
    return {
      w:W, h:H, F, canvases:[c0.canvas, ca.canvas, lay[0], lay[1]],
      bbox:[Math.max(0, bb[0] - mg2*mX), Math.max(0, bb[1] - mg2), Math.min(W - 1, bb[2] + mg2*mX), Math.min(H - 1, bb[3] + mg2)],
      smooth: mg2, thr: 0.5 - 0.36*mg, meltX: mX,
      holes: pc(P.holes, 0, 1), cell: F*0.30*pc(P.holeSize, 0.15, 4), web: F*0.06*pc(P.web, 0.1, 4), rim: F*0.04,
      soft: F*0.03*pc(P.soft, 0, 4), seed,
      grid: Math.max(1.5, Math.min(3, Math.sqrt(W*H/220000))),
    };
  },

  // ===== GPU 焼き =====
  _initBake(){
    const gl = this.gl;
    if(!gl.getExtension('EXT_color_buffer_float')) console.warn('ChromeType: EXT_color_buffer_float がありません');
    const VS = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p*2.0 - 1.0, 0.0, 1.0); }`;
    const H = `#version 300 es
precision highp float;
out vec4 o;
`;
    const src = {
      // 1 方向のガウスぼかし。uN は uniform (ANGLE の展開を避ける)。uMul / uClamp で距離の単位換算もここで行う
      blur: H + `uniform sampler2D uSrc; uniform vec2 uDir, uSize; uniform float uR, uMul, uClamp; uniform int uN;
void main(){
  vec2 uv = gl_FragCoord.xy/uSize;
  vec4 acc = vec4(0.0); float ws = 0.0;
  float st = uN > 0 ? uR/float(uN) : 0.0, sg = max(uR*0.5, 0.5);
  for(int i = -uN; i <= uN; i++){
    float x = float(i)*st, w = exp(-x*x/(2.0*sg*sg));
    acc += texture(uSrc, uv + uDir*x/uSize)*w; ws += w;
  }
  o = vec4(clamp(acc.r/ws*uMul, -uClamp, uClamp));   // 値は .r だけを使う (チャンネル書き込み用に全部へ配る)
}`,
      // しきい値 (+ 別の覆いとの和)
      thr: H + `uniform sampler2D uA, uB; uniform float uThr, uUseB;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  float m = step(uThr, texelFetch(uA, p, 0).r);
  if(uUseB > 0.5) m = max(m, step(0.5, texelFetch(uB, p, 0).r));
  o = vec4(m, 0.0, 0.0, 1.0);
}`,
      // JFA: RG = 内側の画素から最も近い外側の画素 / BA = 外側の画素から最も近い内側の画素
      jinit: H + `uniform sampler2D uM;
void main(){
  vec2 p = floor(gl_FragCoord.xy);   // 整数の画素番号 (半精度でも 2048 まで正確)
  o = texelFetch(uM, ivec2(p), 0).r > 0.5 ? vec4(-1.0, -1.0, p) : vec4(p, -1.0, -1.0);
}`,
      jstep: H + `uniform sampler2D uJ; uniform float uStep; uniform vec2 uSize; uniform int uOne;
void main(){
  vec2 p = floor(gl_FragCoord.xy);
  vec4 b = vec4(-1.0);
  float d1 = 1e20, d2 = 1e20;
  for(int j = -uOne; j <= uOne; j++) for(int i = -uOne; i <= uOne; i++){
    vec2 q = p + vec2(float(i), float(j))*uStep;
    if(q.x < 0.0 || q.y < 0.0 || q.x >= uSize.x || q.y >= uSize.y) continue;
    vec4 s = texelFetch(uJ, ivec2(q), 0);
    if(s.x >= 0.0){ vec2 e = s.xy - p; float d = dot(e, e); if(d < d1){ d1 = d; b.xy = s.xy; } }
    if(s.z >= 0.0){ vec2 e = s.zw - p; float d = dot(e, e); if(d < d2){ d2 = d; b.zw = s.zw; } }
  }
  o = b;
}`,
      // 符号付き距離 (px、内側が正)
      dist: H + `uniform sampler2D uJ, uM;
void main(){
  vec2 p = floor(gl_FragCoord.xy);
  vec4 s = texelFetch(uJ, ivec2(p), 0);
  float sd = texelFetch(uM, ivec2(p), 0).r > 0.5 ? (s.x < 0.0 ? 4096.0 : length(s.xy - p) - 0.5) : (s.z < 0.0 ? -4096.0 : 0.5 - length(s.zw - p));
  o = vec4(sd, 0.0, 0.0, 1.0);
}`,
      // ボロノイの穴: セルの内側を (網の太さを残して) 抜く。縁に近いところは網を太らせて抜けないようにする
      punch: H + `uniform sampler2D uM, uSD; uniform float uCell, uHoles, uWeb, uRim, uSeed; uniform int uOne;
vec2 h22(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p)*43758.5453); }
void main(){
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec2 p = gl_FragCoord.xy;
  float m = texelFetch(uM, ip, 0).r, dd = texelFetch(uSD, ip, 0).r;
  if(m < 0.5 || dd <= uRim){ o = vec4(m, 0.0, 0.0, 1.0); return; }
  vec2 c = floor(p/uCell);
  float d1 = 1e20, d2 = 1e20, on1 = 0.0;
  for(int j = -uOne; j <= uOne; j++) for(int i = -uOne; i <= uOne; i++){
    vec2 cc = c + vec2(float(i), float(j));
    vec2 hh = h22(cc + uSeed*17.13);
    vec2 sp = (cc + 0.12 + 0.76*hh)*uCell;
    vec2 e = sp - p; float q = dot(e, e);
    float on = step(h22(cc*1.37 + uSeed*3.1 + 11.0).x, uHoles);
    if(q < d1){ d2 = d1; d1 = q; on1 = on; } else if(q < d2) d2 = q;
  }
  float e = (sqrt(d2) - sqrt(d1))*0.5;
  float need = uWeb*0.5 + max(0.0, uRim*2.2 - dd)*0.9;
  o = vec4((on1 > 0.5 && e > need) ? 0.0 : 1.0, 0.0, 0.0, 1.0);
}`,
      // 描く格子の頂点ごとの「形の近く」フラグ (読み戻して描くセルを選ぶ)
      occ: H + `uniform sampler2D uSDF, uSDF2; uniform float uGrid, uMargin, uUse2; uniform vec2 uTexSize;
void main(){
  vec2 px = min((gl_FragCoord.xy - 0.5)*uGrid, uTexSize - 1.0);
  vec2 uv = (px + 0.5)/uTexSize;
  vec4 s = textureLod(uSDF, uv, 0.0);
  if(uUse2 > 0.5) s = max(s, textureLod(uSDF2, uv, 0.0));   // 移り変わり中は前の形のセルも描く
  o = vec4(max(s.r, max(s.g, s.b)) > uMargin ? 1.0 : 0.0, 0.0, 0.0, 1.0);
}`,
      // 移り変わり: いま見えている形 (uA = 表、uB = 表の前の形。uT で混ぜる) を、この焼きの画素へ写す。距離は uK 倍して今の形の単位に
      warp: H + `uniform sampler2D uA, uB; uniform vec2 uWA, uWB, uSrcSize; uniform float uT, uK;
void main(){
  vec2 pp = uWA*(gl_FragCoord.xy - 0.5) + uWB;
  vec4 v = vec4(-4.0, -4.0, -4.0, 0.0);
  if(all(greaterThanEqual(pp, vec2(0.0))) && all(lessThanEqual(pp, uSrcSize - 1.0))){
    vec2 uv = (pp + 0.5)/uSrcSize;
    v = mix(textureLod(uB, uv, 0.0), textureLod(uA, uv, 0.0), uT);
    v.rgb = max(v.rgb*uK, vec3(-4.0));
  }
  o = v;
}`,
    };
    const progs = {};
    for(const k in src){
      const p = this._link(VS, src[k]);
      if(!p){ this.ok = false; return; }
      const U = {};
      const nU = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for(let i=0;i<nU;i++){ const a = gl.getActiveUniform(p, i); U[a.name] = gl.getUniformLocation(p, a.name); }
      progs[k] = { p, U };
    }
    this.BK = { W:0, H:0, progs, vao:gl.createVertexArray(), fbos:new Map(), size:new Map(), mask:[null, null, null, null] };
  },
  _bkTex(fmt, w, h, filter){
    const gl = this.gl;
    const t = gl.createTexture();
    if(this.BK) this.BK.size.set(t, [w, h]);
    gl.bindTexture(gl.TEXTURE_2D, t);
    if(fmt === 'r8') gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    else if(fmt === 'rgba8') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    else if(fmt === 'f16') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    const f = filter ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  },
  _bkFbo(tex){
    const gl = this.gl, B = this.BK;
    let f = B.fbos.get(tex);
    if(!f){
      f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      B.fbos.set(tex, f);
    }
    return f;
  },
  _bkResize(W, H, cols, rows){
    const gl = this.gl, B = this.BK;
    if(B.W !== W || B.H !== H){
      for(const f of B.fbos.values()) gl.deleteFramebuffer(f);
      B.fbos.clear();
      for(const k of ['tA','tB','tC','jA','jB','hA','hB','hC','hjA','hjB']) if(B[k]){ gl.deleteTexture(B[k]); B.size.delete(B[k]); }
      B.mask.forEach(t=>{ if(t){ gl.deleteTexture(t); B.size.delete(t); } });
      B.tA = this._bkTex('f16', W, H, true); B.tB = this._bkTex('f16', W, H, true); B.tC = this._bkTex('f16', W, H, true);
      B.jA = this._bkTex('f16', W, H, false); B.jB = this._bkTex('f16', W, H, false);
      const W2 = Math.max(8, W >> 1), H2 = Math.max(8, H >> 1);   // ヒレ層は半分の解像度
      B.hA = this._bkTex('f16', W2, H2, true); B.hB = this._bkTex('f16', W2, H2, true); B.hC = this._bkTex('f16', W2, H2, true);
      B.hjA = this._bkTex('f16', W2, H2, false); B.hjB = this._bkTex('f16', W2, H2, false);
      B.mask = [0, 1, 2, 3].map(()=>this._bkTex('r8', W, H, true));
      B.W = W; B.H = H;
    }
    for(const k of ['_sdfBack', '_morphBack']){   // 裏だけ大きさを合わせる (表は入れ替えまで描くのに使う)
      const t = this[k], bs = t && B.size.get(t);
      if(bs && bs[0] === W && bs[1] === H) continue;
      if(t){
        const f = B.fbos.get(t); if(f){ gl.deleteFramebuffer(f); B.fbos.delete(t); }
        gl.deleteTexture(t); B.size.delete(t);
      }
      this[k] = this._bkTex('f16', W, H, true);
    }
    if(!B.occ || B.occW !== cols || B.occH !== rows){
      if(B.occ){ const f = B.fbos.get(B.occ); if(f){ gl.deleteFramebuffer(f); B.fbos.delete(B.occ); } gl.deleteTexture(B.occ); B.size.delete(B.occ); }
      B.occ = this._bkTex('rgba8', cols, rows, false); B.occW = cols; B.occH = rows;
    }
  },
  // mode: 'sync' = 描くセルをその場で読み戻して入れ替える / 'async' = 数フレーム後に届いたら入れ替える
  _gpuBake(job, mode){
    const gl = this.gl, B = this.BK;
    if(!B) return;
    const W = job.w, H = job.h, cs = job.grid;
    const nx = Math.ceil((W - 1)/cs), ny = Math.ceil((H - 1)/cs), cols = nx + 1, rows = ny + 1;
    this._bkResize(W, H, cols, rows);
    const dst = this._sdfBack;
    // 覆いを上げる (キャンバスの R)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const has = job.canvases.map(Boolean);
    job.canvases.forEach((cv, i)=>{
      if(!cv) return;
      gl.bindTexture(gl.TEXTURE_2D, B.mask[i]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, cv);
    });
    gl.bindVertexArray(B.vao);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
    const run = (name, target, uni, texs)=>{
      const P = B.progs[name];
      gl.useProgram(P.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._bkFbo(target));
      const ts = B.size.get(target); gl.viewport(0, 0, ts[0], ts[1]);
      let unit = 0;
      for(const k in (texs || {})){
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texs[k]);
        if(P.U[k]) gl.uniform1i(P.U[k], unit);
        unit++;
      }
      for(const k in (uni || {})){
        const v = uni[k], loc = P.U[k];
        if(!loc) continue;
        if(Array.isArray(v)) gl.uniform2f(loc, v[0], v[1]);
        else if(k === 'uN' || k === 'uOne') gl.uniform1i(loc, v);
        else gl.uniform1f(loc, v);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const size = [W, H];
    const blur = (src, dst, dir, r, mul, clampV)=>{   // r は書き込み先の画素単位
      const n = r < 0.5 ? 0 : Math.min(40, Math.ceil(r));
      run('blur', dst, { uDir:dir, uSize:B.size.get(dst), uR:r, uN:n, uMul:mul || 1, uClamp:clampV || 1e4 }, { uSrc:src });
    };
    const thr = (a, dst, t, b)=> run('thr', dst, { uThr:t, uUseB:b ? 1 : 0 }, { uA:a, uB:b || a });
    // JFA: 使う距離は形の太さ程度まで (それより遠い所は ±4F に丸める) なので、歩幅は F 程度から始める
    const jfa = (mTex, half)=>{
      const jA = half ? B.hjA : B.jA, jB = half ? B.hjB : B.jB, sz = B.size.get(jA);
      run('jinit', jA, {}, { uM:mTex });
      let src = jA, dst = jB;
      let st = 1; while(st < Math.min(Math.max(sz[0], sz[1]), job.F*(half ? 0.5 : 1)*1.2)) st *= 2;
      for(st = st/2; st >= 1; st /= 2){ run('jstep', dst, { uStep:st, uSize:sz, uOne:1 }, { uJ:src }); const t = src; src = dst; dst = t; }
      run('jstep', dst, { uStep:1, uSize:sz, uOne:1 }, { uJ:src }); const t = src; src = dst; dst = t;   // JFA+1
      return src;
    };
    const dist = (mTex, dst, half)=>{ const j = jfa(mTex, half); run('dist', dst, {}, { uJ:j, uM:mTex }); };
    const invF = 1/job.F;
    const writeChannel = (ch, src, pxScale)=>{   // src (px の距離) を縦にぼかしながら F 単位で sdfTex の 1 チャンネルへ
      gl.colorMask(ch === 0, ch === 1, ch === 2, false);
      blur(src, dst, [0, 1], job.soft, invF*(pxScale || 1), 4);
      gl.colorMask(true, true, true, true);
    };
    const clearChannel = (ch)=>{
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._bkFbo(dst));
      gl.colorMask(ch === 0, ch === 1, ch === 2, ch === 3);
      gl.clearColor(-4, -4, -4, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.colorMask(true, true, true, true);
    };
    clearChannel(3);
    // 本体: 文字を溶かす → 穴 → ヒレと根を足して付け根だけ軽く溶かす (細い根やヒレの先は溶かしすぎない)
    blur(B.mask[0], B.tA, [1, 0], job.smooth*job.meltX);
    blur(B.tA, B.tB, [0, 1], job.smooth);
    thr(B.tB, B.tC, job.thr);                                         // tC = 溶かした文字
    if(job.holes > 0){
      dist(B.tC, B.tA);                                               // tA = 内側の距離
      run('punch', B.tB, { uCell:job.cell, uHoles:job.holes, uWeb:job.web, uRim:job.rim, uSeed:job.seed, uOne:1 }, { uM:B.tC, uSD:B.tA });
      blur(B.tB, B.tA, [1, 0], job.web*0.7);                          // 穴の縁を丸める
      blur(B.tA, B.tC, [0, 1], job.web*0.7);
    }
    thr(B.tC, B.tB, 0.5, B.mask[1]);                                  // tB = 本体 + ヒレと根
    const fr = Math.max(1, job.smooth*0.28);
    blur(B.tB, B.tA, [1, 0], fr);
    blur(B.tA, B.tC, [0, 1], fr);
    thr(B.tC, B.tB, 0.42, B.mask[1]);                                 // 付け根のなめらかなつなぎ目 (細い根の先は元の形を残す)
    dist(B.tB, B.tA);
    blur(B.tA, B.tC, [1, 0], job.soft);
    writeChannel(0, B.tC);
    // ヒレ層 (半分の解像度で処理して、書き込みで元の解像度へ戻す)
    for(let L=1; L<3; L++){
      if(!has[L + 1]){ clearChannel(L); continue; }
      const r = Math.max(1, job.smooth*0.125);
      blur(B.mask[L + 1], B.hA, [1, 0], r);
      blur(B.hA, B.hB, [0, 1], r);
      thr(B.hB, B.hC, 0.5);
      dist(B.hC, B.hA, true);
      blur(B.hA, B.hC, [1, 0], job.soft*0.35);
      writeChannel(L, B.hC, 2);
    }
    // 描くセルを選ぶ: 格子の頂点ごとに形の近くかを出して読み戻す (焼きのときだけの小さな同期読み出し)
    const meta = { w:W, h:H, cols, rows, grid:cs, F:job.F, bbox:job.bbox };
    // 移り変わり (タイピング中): いま見えている形を、この焼きの座標へ写して裏の morph に置く (画面上の位置と大きさはそのまま)
    const morph = mode === 'async' && !!this.bake && this._dz(this.P.tyMorph) > 0;
    if(morph){
      const A = this.bake, fa = this._fit(A, this._aspect), fc = this._fit(meta, this._aspect);
      const r = fc.fit/fa.fit, ax = r*A.F/job.F;
      const bx = ((-W/2/job.F - fc.center[0])*r + fa.center[0])*A.F + A.w/2;
      const by = A.h/2 - ((H/2/job.F - fc.center[1])*r + fa.center[1])*A.F;
      run('warp', this._morphBack, { uWA:[ax, ax], uWB:[bx, by], uSrcSize:[A.w, A.h], uT:this._morphT(), uK:fa.fit/fc.fit },
          { uA:this.sdfTex, uB:this._morphTex || this.sdfTex });
    }
    run('occ', B.occ, { uGrid:cs, uMargin:-2.5*cs*invF, uTexSize:size, uUse2:morph ? 1 : 0 }, { uSDF:dst, uSDF2:morph ? this._morphBack : dst });
    const build = (occ)=>{
      const keep = (i)=> occ[i*4] > 127;
      const idx = [];
      for(let j=0;j<ny;j++) for(let i=0;i<nx;i++){
        const a = j*cols + i, b = a + 1, c = a + cols, d = c + 1;
        if(keep(a) || keep(b) || keep(c) || keep(d)) idx.push(a, c, b, b, c, d);
      }
      return idx;
    };
    const tok = ++this._occTok;
    let occNow = null;
    if(mode === 'async' && typeof GL !== 'undefined' && GL.asyncReadPixels){
      GL.asyncReadPixels(cols, rows, (px)=>{
        if(tok !== this._occTok) return;            // あとの焼きが来ている
        if(!px){ this._bakeTy = ''; this._occSync = true; return; }   // 読めなかった: 次のフレームで同期して焼き直す
        this._present(build(px), meta, morph);
      });
    } else {
      occNow = new Uint8Array(cols*rows*4);
      gl.readPixels(0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, occNow);
    }
    // 後片付け (vj の他の描画に状態を残さない)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(null);
    gl.clearColor(0, 0, 0, 0);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    for(let u=0;u<3;u++){ gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, null); }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
    if(occNow) this._present(build(occNow), meta, morph);
  },
  // 裏に焼いた sdf と描くセルを表と入れ替える
  _present(idx, meta, morph){
    const gl = this.gl;
    const prev = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._iboBack);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(prev);
    [this.sdfTex, this._sdfBack] = [this._sdfBack, this.sdfTex];
    [this.ibo, this._iboBack] = [this._iboBack, this.ibo];
    this.nIdx = idx.length;
    this.bake = meta;
    this._morphOn = !!morph;
    if(morph){
      [this._morphTex, this._morphBack] = [this._morphBack, this._morphTex];
      this._morph0 = performance.now();
      const P = this.P, rate = Math.max(0.05, +P.tyRate || 1);
      const beatSec = (typeof App !== 'undefined' && App.beatMode === 'beat' && typeof BPM !== 'undefined' && BPM.bpm) ? 60/BPM.bpm/(App.beatScale || 1) : 0.5;
      const stepBeats = P.typing >= 2 ? Math.min(2, Math.max(1, +P.tyHold || 0)) : 1/rate;   // 1 字の間隔 (全文は入れ替えの間隔。長くても 2 拍で移る)
      this._morphDur = 1000*Math.min(1, this._dz(P.tyMorph)*0.01)*beatSec*stepBeats;
    }
  },
  // 移り変わりの進み (0〜1)。移り変わっていないときは 1 (緩急はシェーダの削り方でつける)
  _morphT(){
    if(!this._morphOn) return 1;
    const t = (performance.now() - this._morph0)/Math.max(1, this._morphDur);
    if(t >= 1){ this._morphOn = false; return 1; }
    return t;
  },
  // 形を画面に収める: 世界の大きさ (F 単位)・外形の幅と高さ・中心・倍率 (Size の前)。描画と移り変わりの写像で共有
  _fit(B, aspect){
    const world = B ? [B.w/B.F, B.h/B.F] : [1, 1];
    const bb = B ? B.bbox : [0, 0, 1, 1];
    const bw = B ? Math.max(0.2, (bb[2] - bb[0])/B.F) : 1, bh = B ? Math.max(0.2, (bb[3] - bb[1])/B.F) : 1;
    const center = B ? [((bb[0] + bb[2])*0.5/B.w - 0.5)*world[0], (0.5 - (bb[1] + bb[3])*0.5/B.h)*world[1]] : [0, 0];
    const half = 6.0*Math.tan(15*Math.PI/180);   // カメラ距離 6・画角 30° の画面の半分の高さ
    return { world, bw, bh, center, fit:Math.min(half*aspect*0.88/(bw*0.5), half*0.85/(bh*0.5)) };
  },

  // ===== 画像テクスチャ (images/ のフォルダ。ImageMode のフォルダ一覧を使う) =====
  texUrl(){
    const P = this.P;
    if(!P.texFolder || typeof ImageMode === 'undefined' || !ImageMode.folders) return '';
    const f = ImageMode.folders.find(x=>x && x.dir === P.texFolder);
    if(!f) return '';
    const names = f.images || [];
    let i = Math.max(0, names.indexOf(P.texImage));
    if(f._urls) return f._urls[i] || '';
    if(f.single) return f.dir;
    return names[i] ? f.dir + '/' + names[i] : '';
  },
  _syncTexture(){
    const url = this.texUrl();
    if(url === this._texUrl) return;
    this._texUrl = url;
    this._texReady = false;
    if(!url) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = ()=>{
      if(this._texUrl !== url) return;
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.texTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.bindTexture(gl.TEXTURE_2D, null);
      this._texAspect = img.naturalWidth/Math.max(1, img.naturalHeight);
      this._texReady = true;
    };
    img.onerror = ()=>{ console.warn('ChromeType: texture load failed', url); };
    img.src = url;
  },

  // ===== 描画 =====
  _ensureDepth(w, h){
    const gl = this.gl;
    if(this.depthRBO && this.depthW === w && this.depthH === h) return;
    if(this.depthRBO) gl.deleteRenderbuffer(this.depthRBO);
    this.depthRBO = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRBO);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    this.depthW = w; this.depthH = h;
  },
  _mat3(yaw, pitch, roll){   // R = Ry(yaw) * Rx(pitch) * Rz(roll)  (列優先)
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    const Ry = [cy,0,-sy, 0,1,0, sy,0,cy];
    const Rx = [1,0,0, 0,cp,sp, 0,-sp,cp];
    const Rz = [cr,sr,0, -sr,cr,0, 0,0,1];
    const mul = (A, B)=>{ const o = new Array(9); for(let c=0;c<3;c++) for(let r=0;r<3;r++) o[c*3+r] = A[r]*B[c*3] + A[3+r]*B[c*3+1] + A[6+r]*B[c*3+2]; return o; };
    return mul(Ry, mul(Rx, Rz));
  },

  render(opts){
    const gl = this.gl;
    if(!this.initialized || !this.ok) return;
    const P = this.P;
    const dz = (v)=>this._dz(v);
    const w = opts.w, h = opts.h, aspect = w/Math.max(1, h);
    const clock = (opts.clock != null) ? opts.clock : performance.now()/1000;
    const beatMode = (typeof App !== 'undefined' && App.beatMode === 'beat') && opts.beat != null;
    const spd = dz(P.speed)*0.01;
    const T = clock*spd;
    const kick = Math.max(0, dz(P.kick)*0.01);
    const audio = (typeof Audio !== 'undefined' && Audio.react) ? Math.max(0, Math.min(1, Audio.react)) : 0;
    const bph = beatMode ? opts.beat - Math.floor(opts.beat) : 0;
    const pulse = kick*(beatMode ? Math.exp(-bph*5.0) : audio*0.6);
    const deg = Math.PI/180;

    // 回転
    // 向き (Reverse / Random Rev) は拍の頭で切り替える (Attack Rev だけはアタックの瞬間) (drone モードは 0.5 秒 = 1 拍)。角度は毎フレーム積むので向きが変わっても飛ばない
    const step = Math.round(+P.spinStep || 0);
    const bt = beatMode ? opts.beat*spd : T*2, bti = Math.floor(bt);
    if(this._dirBeat == null || Math.abs(bti - this._dirBeat) > 64){ this._dirBeat = bti; this._dir = P.spinRev > 0 ? -1 : 1; this._revFlip = false; this._revLeft = 0; this._atkFlip = false; }
    if(bti !== this._dirBeat){
      this._dirBeat = bti;
      if(P.revAuto > 0){
        if(--this._revLeft <= 0){
          if(this._revLeft === 0) this._revFlip = !this._revFlip;   // 初回は周期を決めるだけ
          this._revLeft = [2, 4, 4, 8, 8, 16][Math.floor(Math.random()*6)];
        }
      } else { this._revFlip = false; this._revLeft = 0; }
      this._dir = (P.spinRev > 0 ? -1 : 1)*(this._revFlip ? -1 : 1)*(this._atkFlip ? -1 : 1);
    }
    // Attack Rev: アタックで拾った瞬間に反転 (拍を待たない)。0.12 秒以内の連打は 1 回とみなす
    const seed = (typeof Audio !== 'undefined') ? (Audio.hitSeed || 0) : 0;
    if(P.revAtk > 0){
      const now = performance.now();
      if(this._atkSeed != null && seed !== this._atkSeed && now - this._atkT > 120){
        this._atkFlip = !this._atkFlip; this._atkT = now;
        this._dir = -this._dir;
      }
    } else if(this._atkFlip){ this._atkFlip = false; this._dir = -this._dir; }
    this._atkSeed = seed;
    if(beatMode && step > 0){
      const b = opts.beat*spd, bi = Math.floor(b), bf = b - bi;
      const p = bi + 1 - Math.pow(1 - Math.min(1, bf*2.2), 3);
      const dp = (this._lastP == null || Math.abs(p - this._lastP) > 8) ? 0 : p - this._lastP;
      this._yaw += dp*step*deg*Math.sign(dz(P.spin) || 1)*this._dir;
      this._lastP = p; this._lastT = null;
    } else {
      const dT = (this._lastT == null || Math.abs(T - this._lastT) > 2) ? 0 : T - this._lastT;
      this._yaw += dT*0.5*dz(P.spin)*0.01*this._dir;
      this._lastT = T; this._lastP = null;
    }
    let yaw = this._yaw;
    const sway = dz(P.sway)*0.01;
    if(sway) yaw += Math.sin(T*0.7)*sway*1.2;
    const pitch = dz(P.tilt)*deg + T*0.4*dz(P.tumble)*0.01;
    const R3 = this._mat3(yaw, pitch, dz(P.roll)*deg);

    // カメラと大きさ
    const fov = 30*deg, camZ = 6.0;
    const B = this.bake;
    this._aspect = aspect;
    const { world, bw, center, fit } = this._fit(B, aspect);
    const halfW = camZ*Math.tan(fov/2)*aspect, halfH = camZ*Math.tan(fov/2);
    const scale = fit*Math.max(0.05, dz(P.size)*0.01);
    const f = 1/Math.tan(fov/2), near = 0.1, far = 40;
    const proj = [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)/(near-far),-1, 0,0,2*far*near/(near-far),0];
    const view = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,-camZ,1];
    const vp = new Float32Array(16);
    for(let c=0;c<4;c++) for(let r=0;r<4;r++){ let s = 0; for(let k=0;k<4;k++) s += proj[k*4+r]*view[c*4+k]; vp[c*4+r] = s; }

    const opaque = opts.opaque !== false;
    const bg = Array.isArray(P.bgColor) ? P.bgColor : [1, 1, 1];

    // 描く先: MSAA (縁のギザ取り) → 解決して slot の FBO へ
    const aa = Math.round(+P.aa || 0);
    const useMS = !!opts.fbo && aa >= 2 && this._ensureMSAA(w, h, aa);
    if(useMS){
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaa.fbo);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, opts.fbo || null);
      if(opts.fbo){ this._ensureDepth(w, h); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRBO); }
    }
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    if(opaque) gl.clearColor(bg[0], bg[1], bg[2], 1); else gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1.0);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if(B && this.nIdx > 0){
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      gl.useProgram(this.prog);
      const U = this.U;
      const u1 = (n, v)=>{ if(U[n]) gl.uniform1f(U[n], v); };
      const i1 = (n, v)=>{ if(U[n]) gl.uniform1i(U[n], v); };
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.sdfTex); i1('uSDF', 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texTex); i1('uTex', 1);
      const mt = this._morphT();
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, mt < 1 ? this._morphTex : this.sdfTex); i1('uSDFPrev', 2);
      u1('uMorph', mt);
      if(U.uTexSize) gl.uniform2f(U.uTexSize, B.w, B.h);
      u1('uCols', B.cols); u1('uGrid', B.grid);
      if(U.uWorld) gl.uniform2f(U.uWorld, world[0], world[1]);
      if(U.uCenter) gl.uniform2f(U.uCenter, center[0], center[1]);
      const rnd = Math.max(0.01, dz(P.round)*0.01);
      u1('uR', 0.11*rnd);
      u1('uEdge', 1.2*B.grid/B.F);
      u1('uPuff', 0.30*dz(P.puff)*0.01*(1 + pulse*0.8));
      u1('uLump', Math.max(0, Math.min(1.5, dz(P.lumps)*0.01))*0.6);
      u1('uThick', Math.max(0.02, dz(P.thick)*0.01)*(1 + pulse*0.35));
      u1('uFinThick', Math.max(0.02, dz(P.finThick)*0.01));
      u1('uSpread', 0.10*dz(P.spread)*0.01);
      u1('uSplay', 0.10*dz(P.splay)*0.01);
      u1('uTwist', 0.5*dz(P.twist)*0.01/Math.max(1, bw*0.25));
      u1('uBend', 0.6*dz(P.bend)*0.01/Math.max(1, bw*0.5));
      const liq = Math.max(0, dz(P.liquid)*0.01)*(1 + pulse);
      u1('uLiq', 0.18*liq);
      u1('uLiqF', 1.6*Math.max(0.05, dz(P.liqFreq)*0.01));
      u1('uT', T);
      i1('uDeform', (dz(P.twist) || dz(P.bend) || liq > 0) ? 1 : 0);
      if(U.uLayerOn) gl.uniform3f(U.uLayerOn, 1, dz(P.layers) > 0 ? 1 : 0, dz(P.layers) > 0 ? 1 : 0);
      if(U.uRot) gl.uniformMatrix3fv(U.uRot, false, new Float32Array(R3));
      u1('uScale', scale);
      if(U.uPos) gl.uniform3f(U.uPos, 0, dz(P.posY)*0.01*halfH, 0);
      if(U.uVP) gl.uniformMatrix4fv(U.uVP, false, vp);
      if(U.uCam) gl.uniform3f(U.uCam, 0, 0, camZ);
      u1('uMetal', Math.max(0, Math.min(1, dz(P.metal)*0.01)));
      u1('uRough', Math.max(0, Math.min(1, dz(P.rough)*0.01)));
      u1('uGloss', Math.max(0, dz(P.gloss)*0.01));
      u1('uEnvBri', Math.max(0, dz(P.envBri)*0.01));
      u1('uEnvRot', dz(P.envRot)*deg);
      u1('uSparkle', Math.max(0, dz(P.sparkle)*0.01));
      u1('uIrid', Math.max(0, Math.min(1, dz(P.irid)*0.01)));
      u1('uGrain', Math.max(0, dz(P.grain)*0.01)*0.5);
      u1('uSurf', Math.max(0, dz(P.surf)*0.01));
      const tint = Array.isArray(P.tint) ? P.tint : [0.8, 0.8, 0.8];
      if(U.uTint) gl.uniform3f(U.uTint, tint[0], tint[1], tint[2]);
      u1('uTexAmt', this._texReady ? Math.max(0, Math.min(1, dz(P.texAmt)*0.01)) : 0);
      u1('uTexScale', Math.max(0.05, dz(P.texScale)*0.01));
      u1('uTexAspect', this._texAspect || 1);
      i1('uTexMode', Math.round(+P.texMode || 0));
      i1('uHasTex', this._texReady ? 1 : 0);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      const nInst = dz(P.layers) > 0 ? 3 : 1;
      if(useMS) gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      // 上面と下面は閉じた面なので、外から見えるのは表向きの三角形だけ (裏の面を塗らずに済む)
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      for(let side=0; side<2; side++){
        gl.frontFace(side === 0 ? gl.CW : gl.CCW);
        i1('uSide', side);
        gl.drawElementsInstanced(gl.TRIANGLES, this.nIdx, gl.UNSIGNED_INT, 0, nInst);
      }
      gl.frontFace(gl.CCW); gl.disable(gl.CULL_FACE);
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.disable(gl.DEPTH_TEST);
    if(useMS){
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaa.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, opts.fbo);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    } else if(opts.fbo){
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 0);
  },

  // MSAA の描画先 (slot の RGBA16F と同じ形式で、blit で解決する)。作れなければ false (直接描く)
  _ensureMSAA(w, h, want){
    const gl = this.gl;
    if(this._msaaBad) return false;
    if(this.msaa && this.msaa.w === w && this.msaa.h === h && this.msaa.want === want) return true;
    if(this.msaa){ gl.deleteFramebuffer(this.msaa.fbo); gl.deleteRenderbuffer(this.msaa.color); gl.deleteRenderbuffer(this.msaa.depth); this.msaa = null; }
    try{
      if(!gl.getExtension('EXT_color_buffer_float')){ this._msaaBad = true; return false; }
      const samples = Math.min(want, gl.getParameter(gl.MAX_SAMPLES) || 0);
      if(samples < 2){ this._msaaBad = true; return false; }
      const color = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, color);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA16F, w, h);
      const depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      const okFB = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if(!okFB){ gl.deleteFramebuffer(fbo); gl.deleteRenderbuffer(color); gl.deleteRenderbuffer(depth); this._msaaBad = true; return false; }
      this.msaa = { fbo, color, depth, w, h, samples, want };
      return true;
    }catch(e){ this._msaaBad = true; return false; }
  },
};

// PDefaults はスクリプト読込時に確定させる (init より先に state 復元が走るため)
ChromeType.PDefaults = JSON.parse(JSON.stringify(ChromeType.P));
