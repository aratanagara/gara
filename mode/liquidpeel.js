'use strict';
/* Liquid Peel engine — vj/ の追加レンダリングモード (kind:'liquidpeel')。
   Transmute Flock (mode/transflock.js) の「板 1 枚 = 1 インスタンスの四角形 + 深度テスト」を応用。
   - 本体 (Shape): 液体 (動く円の smooth-min + ノイズの 2D SDF) / 球 / 縦の面 (長方形) / 円柱 / 立方体。
     Deform (不定形) はどの形状にも掛かる: 素の表面を法線方向に 3D ノイズで押し出す (Blobs = こぶの数 / Wobble = 細かい揺らぎ /
     Morph = 変形の速さ)。球 + Deform 1 が「不定形の塊」。surf() (表面への射影 + 変位) を破片の配置・貼り付き時の曲がり・
     本体メッシュで共用する。
   - 本体の表面を、セルより大きい破片 (ジッターした矩形) が鱗のように重なって覆う (セルごとの高さ差で重なり順を固定)。
   - 破片の状態は時間と位置だけで決まる (状態を持たない)。2 つの剥がれ:
       (a) 液体の輪郭が退いて本体の外に出た破片  (b) 全体で 1 本の周期 (Order の順に剥がれ、全部落ちたら一斉に貼り直し)
     どちらも下端をヒンジに、上端から外側へ反り返って 180° 折り返し、先端 (元の上端) が下を向いてぶら下がる。
     剥がれるとその形のまま頭 (先端) から真下へ落ちて薄れる。
   - 破片は縦に上を向いた細長い矩形 (世界座標の上を接平面に投影した向き。Rotate で回せる)。縦 8 分割のストリップで曲げる。
   - 本体は常に描く (Body = 中の色、線 = 輪郭と幾何的な縁を Line の幅で)。重なりは深度テストで解決。
     本体の色は Body Color (bodyCol) か、インク = 破片の色と連動 (bodyLink)。
   - 剥がれ方 (peelMode): 自動 (上の周期) / マウス = クリック・ドラッグした所の破片だけ剥がれる。
     マウスでは破片ごとの進み (0..2.5) を N×N の状態テクスチャ (RGBA8 に 16bit で符号化) に持ち、毎フレーム
     同じ頂点シェーダ (uStateMode=1、破片 1 枚 = 1 点) で「画面上の破片の位置とマウスの距離 < Brush」なら進め、
     落ちきって少し待つと 0 に戻して貼り直す。本描画はその値を lift / 落下に使う。
   - 描画 (塗り / 輪郭 / 線幅 / Line Skip / Detail / Paper Alpha / Ink / Paper) は Transmute Flock と同じ。
   - Drone/Beat: beat モードでは拍ごとに本体が膨らんで縮む。音でも膨らむ。
   IF: init(gl) / update() / render({fbo,w,h,slot,beat,clock,opaque}) / P(params)
*/

const LiquidPeel = {
  gl:null, initialized:false,
  prog:null, vao:null, cornerVBO:null, stripVerts:4,
  bodyProg3:null, bodyProg2:null, sphereVAO:null, sphereCount:0, cubeVAO:null, cubeCount:0, gridVAO:null, gridCount:0,
  depthRBO:null, depthW:0, depthH:0,
  startTime:0,

  // ── パラメータ (UI から操作)。数値は uniform に渡す直前に App.deadParam を通す (Transmute Flock と同じ) ──
  P:{
    shape:1,          // 0=液体 (2D) / 1=球 / 2=縦の面 / 3=円柱 / 4=立方体
    reveal:0,         // 0=皮を常に表示 / 1=めくれる破片だけ表示 (貼り付いている間は見えず、めくれ始めで現れて落ちる)
    appear:0,         // Reveal の出現時の色 0=本体の色から浮かび上がる / 1=紙色から (紙が黒なら黒い板として現れる)
    order:1,          // 剥がれる順 0=まとまり (ノイズ順) / 1=下から上 / 2=上から下
    edgeOn:1,         // 破片の縁の線 0=なし / 1=あり (塗りでは紙色の帯、輪郭ではインクの線)
    lit:1,            // 本体の陰影 0=なし (Body の色で平坦) / 1=あり
    speed:100,        // 全体の速さ (%)
    morph:1.0,        // 形が変わる速さ (液体の円の動き / Deform の流れ)
    blobs:4,          // 液体: 円の数 / Deform: こぶの数 (低周波の密度)
    size:1.0,         // 本体の大きさ
    wobble:0.5,       // 細かい揺らぎ (液体の輪郭 / Deform の高周波)
    deform:1.0,       // 不定形: 素の形状を法線方向にノイズで押し出す量 (球 + 1.0 = 凸凹の塊)
    cells:36,         // 破片の分割数 (格子の一辺。球・円柱・立方体は二乗が総数)。多いほど小さい破片
    jitter:0.6,       // 破片の大きさ・位置のばらつき (0..2)
    overlap:1.5,      // 破片の大きさ (セル比)。1 より大きいと鱗のように重なる
    aspect:2.2,       // 破片の細長さ (長辺/短辺)。Transmute Flock の筆先と同じ細長い矩形
    rotate:0,         // 破片の向き (度)。0=縦 (長辺が上向き) / 90=横。ヒンジとカールは長辺に追従
    rotVar:0,         // 向きの破片ごとのばらつき (1 で ±90°)
    peel:1.5,         // 液体の輪郭で剥がれ始める帯の幅 (破片サイズ比)
    peelRate:0.35,    // 皮が全部剥がれ落ちてリセットされるまでの周期の速さ
    peelScale:1.5,    // 剥がれるまとまりの大きさ (小さいほど大きな塊がまとまって剥がれる)
    lift:2.4,         // 折り返しのきつさ (総角度 = lift×2 rad。π を超えた分は真っ直ぐ垂れる)
    fall:1.2,         // 落ちる距離 (本体サイズ比)
    drift:0,          // 落ちながら横へ流れる量 (0=真下へ)
    tumble:0,         // 落ちながら揺れる量 (0=反った形のまま)
    tilt:0.5,         // 本体の傾き (rad)。面 (液体・縦の面) は寝ないよう ±0.35 rad まで
    spin:100,         // 本体の回転の速さ (%)。面 (液体・縦の面) は左右の首振り
    swell:0.6,        // beat モードで拍ごとに本体が膨らむ量
    depth:0.5,        // 奥行きによる減衰
    persp:1.0,        // 遠近の強さ
    fill:1.0,         // 塗りつぶし (1=塗る / 0=輪郭だけ)
    body:0.5,         // 本体の中の色 (0=紙色 / 1=本体色。立体は陰影付き)。線 (輪郭・縁) は Line の幅で常に乗る
    bodyLink:1,       // 本体色 0=Body Color を使う / 1=インク (破片の色) と連動
    peelMode:0,       // 剥がれ方 0=自動 (周期) / 1=マウス (クリック・ドラッグした所だけ)
    brush:12,         // マウスの半径 (% 画面高さ比)
    peelVar:0.6,      // 剥がれる速さのムラ (破片ごとに 0.35〜1.65 倍)
    peelAmt:1.0,      // 剥がれる量 (1=全部 / 下げるとノイズで塊状に剥がれない破片が残る)
    line:0.9,         // 輪郭線の太さ (px)。0.2 未満は薄くなり 0.1 で 25% の極細線
    lineSkip:0,       // 縁の線を描かない破片の割合
    detail:0.5,       // 一部の破片 (7%) に出る内側の線の濃さ
    audio:1.0,        // 音の効き (本体が膨らむ)
    paperAlpha:1.0,   // Slot B での紙の不透明度 (1=破片は不透明なカード / 0=線だけ残して透ける)
    ink:[0.914, 0.933, 0.949],    // インクの色
    paper:[0, 0, 0],              // 下地 (紙) の色。Slot A では背景にも敷く
    bodyCol:[0.914, 0.933, 0.949], // 本体の色 (bodyLink=0 のとき)
    posX:0,           // 本体の横位置 (% 画面高さ比。+ で右)
    posY:0,           // 本体の縦位置 (% 画面高さ比。+ で上)
    roll:0,           // 画面の回転 (度。場面全体を視軸まわりに回す。重力の向きも一緒に回る)
    lens:100,         // 画角 (%)。小さいと広角 (遠近が強い) / 大きいと望遠 (平ら)。本体の見かけの大きさは保つ
    yaw:0,            // 本体の向き (度。回転の初期位相。面は首振りの中心もずれる)
    lightA:0,         // 光の向き (度。視軸まわりに回す)
    lightZ:100,       // 光の手前っぽさ (%)。小さいと真横からの光 (陰影が強い) / 大きいと正面光
    pShade:0,         // 破片の陰影 (%)。破片の向き (反り) に応じて明暗がつく
    rim:0,            // 本体の縁の光 (%)。負で縁を暗く
    round:0,          // 破片の角丸 (% 短辺の半分に対する割合)
    taper:0,          // 破片の先細り (%)。負で先が広がる
    twist:0,          // 破片のひねり (%)。めくれるときに長辺まわりにねじれる
    gap:100,          // 破片が本体から浮く高さ (%)
    lenVar:100,       // 破片の長さのばらつき (%)
    widVar:100,       // 破片の幅のばらつき (%)
    fallCurve:2.0,    // 落ち方の曲線 (指数。小さいと最初から速い / 大きいとためてから落ちる)
    fallDir:0,        // 落ちる向き (度。0=真下)
    fadeStart:60,     // 落ちながら薄れ始める位置 (% 落下の進み)
    peelSpan:22,      // 破片 1 枚がめくれて落ちきるまでの長さ (% 周期)
    liftShare:36,     // めくれに使う時間の割合 (% 1 枚の動きのうち。残りが落下)
    peelPhase:0,      // 剥がれ周期の位相 (%)。Peel Rate を 0 にすると、この位置で止まる
    toneVar:0,        // 破片ごとの明るさのばらつき (%)
    hueVar:0,         // 破片ごとの色相のばらつき (度。±)
    bodyLine:100,     // 本体の線の太さ (% Line に対する倍率)
    noiseY:100,       // Deform のノイズの縦の伸び (%)。大きいと縦縞のような起伏
  },
  stateTex:[null, null], stateFBO:[null, null], stateN:0, stateRead:0, _lastClock:null, _stateMode:0,

  init(gl){
    if(this.initialized) return;
    this.gl = gl;
    this.startTime = performance.now()/1000;

    // ── 共通 GLSL (ノイズ / 液体 SDF / 形状の表面)。使う側で uT, uMorph, uBlobs, uS, uWobble, uSwell, uShape, uDeform を宣言すること ──
    const common = `uniform float uEye, uRollA, uLightA, uLightZ, uNoiseY;
uniform vec2  uOff;
#define EYE uEye
float h1(float n){ return fract(sin(n*91.3458)*47453.5453); }
vec2  h2(float n){ return fract(sin(vec2(n*12.9898, n*78.233))*43758.5453); }
vec3  h3(float n){ return fract(sin(vec3(n*12.9898, n*78.233, n*37.719))*43758.5453); }
float vn2(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
  float n = i.x + i.y*57.0;
  return mix(mix(h1(n), h1(n + 1.0), f.x), mix(h1(n + 57.0), h1(n + 58.0), f.x), f.y);
}
float fbm2(vec2 p){ return vn2(p)*0.5 + vn2(p*2.03 + 1.7)*0.25 + vn2(p*4.11 + 3.1)*0.125; }
float h1v(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7)))*43758.5453); }
float vn3(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
  float n000 = h1v(i), n100 = h1v(i + vec3(1,0,0)), n010 = h1v(i + vec3(0,1,0)), n110 = h1v(i + vec3(1,1,0));
  float n001 = h1v(i + vec3(0,0,1)), n101 = h1v(i + vec3(1,0,1)), n011 = h1v(i + vec3(0,1,1)), n111 = h1v(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float fbm3(vec3 p){ return vn3(p)*0.5 + vn3(p*2.03 + 1.7)*0.25 + vn3(p*4.11 + 3.1)*0.125; }
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0); return mix(b, a, h) - k*h*(1.0 - h); }
const vec4 CULL = vec4(0.0, 0.0, -3.0, 1.0);

// ── 液体 (2D): 動く円の smooth-min + ノイズ揺らぎの SDF (負=内側) ──
float body(vec2 p){
  float d = 1e9;
  float t = uT * uMorph;
  for(int k = 0; k < 6; k++){
    if(float(k) >= uBlobs) break;
    float fk = float(k);
    vec3 hk = h3(fk*7.7 + 3.3);
    vec2 c = 0.5*uS*vec2(sin(t*(0.21 + 0.17*hk.x) + hk.y*6.2832), cos(t*(0.17 + 0.19*hk.y) + hk.z*6.2832));
    float r = uS*(0.33 + 0.14*sin(t*(0.3 + 0.2*hk.z) + fk));
    d = smin(d, length(p - c) - r, 0.35*uS);
  }
  d += uWobble * 0.18*uS * (fbm2(p/uS*2.2 + vec2(uT*0.15, -uT*0.11)) - 0.45);
  return d;
}
float bodyS(vec2 p){ return body(p / uSwell) * uSwell; }   // 膨らみ (拍 / 音) は一様スケール

#define RB (0.6*uS*uSwell)                                  // 基準半径 (球の半径。変位量もこれ基準)
// ── Deform (不定形): 変位量 (無次元)。こぶ (Blobs = 低周波の密度) + 細かい揺らぎ (Wobble) が時間で流れる ──
float dAmt(vec3 q){
  q.y *= uNoiseY;
  float t = uT * uMorph;
  float fL = 0.6 + 0.35*uBlobs;
  return 0.55*(fbm3(q*fL + vec3(t*0.3, t*0.2, -t*0.25)) - 0.44) + uWobble*0.15*(fbm3(q*4.5 - vec3(t*0.2)) - 0.44);
}
// ── 形状の素の表面: 近くの点 q を表面へ射影し、その法線も返す ──
//   0=液体 2=縦の面 (z=0 の面) / 1=球 / 3=円柱 (側面) / 4=立方体 (支配軸の面へ。縁をまたぐと隣の面へ回り込む)
void baseSurf(vec3 q, out vec3 P0, out vec3 N0){
  if(uShape < 0.5 || (uShape > 1.5 && uShape < 2.5)){ P0 = vec3(q.x, q.y, 0.0); N0 = vec3(0.0, 0.0, -1.0); }
  else if(uShape < 1.5){ vec3 d = normalize(q); P0 = d * RB; N0 = d; }
  else if(uShape < 3.5){ float R = 0.45*uS*uSwell; vec2 c = normalize(q.xz + vec2(1e-6, 0.0)); P0 = vec3(c.x*R, q.y, c.y*R); N0 = vec3(c.x, 0.0, c.y); }
  else {
    vec3 a = abs(q); float hs = 0.55*uS*uSwell;
    if(a.x >= a.y && a.x >= a.z){ P0 = vec3(sign(q.x)*hs, q.y, q.z); N0 = vec3(sign(q.x), 0.0, 0.0); }
    else if(a.y >= a.z)         { P0 = vec3(q.x, sign(q.y)*hs, q.z); N0 = vec3(0.0, sign(q.y), 0.0); }
    else                        { P0 = vec3(q.x, q.y, sign(q.z)*hs); N0 = vec3(0.0, 0.0, sign(q.z)); }
  }
}
// 変形後の表面 (素の表面 + 法線方向の変位)
vec3 surf(vec3 q){ vec3 P0, N0; baseSurf(q, P0, N0); return P0 + N0 * (RB * uDeform * dAmt(P0 / RB)); }
vec2 rot2(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c*v.x - s*v.y, s*v.x + c*v.y); }
vec3 camX(vec3 w){ if(uRollA != 0.0) w.xy = rot2(w.xy, uRollA); return w + vec3(uOff, 0.0); }   // 画面の回転 → 位置
vec3 camN(vec3 n){ if(uRollA != 0.0) n.xy = rot2(n.xy, uRollA); return n; }
vec3 lightDir(){ return (uLightA == 0.0 && uLightZ == 1.0) ? normalize(vec3(-0.4, 0.6, -0.7)) : normalize(vec3(rot2(vec2(-0.4, 0.6), uLightA), -0.7*uLightZ)); }
`;

    const vs = `#version 300 es
precision highp float;
in vec2 aCorner;                 // 破片ローカル (x: 横 -1..1, y: 縦 -1..1)。縦 8 分割のストリップ
uniform vec2  uRes;
uniform float uT, uFcl, uCells, uS, uShape, uBlobs, uWobble, uMorph, uDeform, uJitter, uOverlap, uAspect, uPeel, uPeelRate, uPeelScale, uLift, uFall, uDrift, uTumble;
uniform float uTilt, uSpinA, uSwell, uDepth, uMinSS, uLineSkip, uRotate, uRotVar, uReveal, uOrder;
uniform float uStateMode, uPeelMode, uDt, uPeelSpd;   // マウス剥がれ: 状態更新パス / 剥がれ方 / フレーム時間 / 進む速さ
uniform float uPeelVar, uPeelAmt;                      // 剥がれる速さのムラ / 量のムラ
uniform float uRound, uTaper, uTwist, uGap, uLenVar, uWidVar, uFallPow, uFallA, uFadeS, uSpan, uLiftSh, uFallSh, uPhase, uPShade, uToneVar, uHueVar;
uniform vec4  uMouse;                                  // (x, y) 0..1 (y 上向き), z = 押している, w = 半径 (画面高さ比)
uniform sampler2D uState;                              // 破片ごとの剥がれの進み (前フレーム)
out float vState;
out vec2  vLoc;
out vec2  vHalfPx;
out float vDepthF;
out float vDet;
out float vLineOn;
out float vHinge;                // 1 = 下辺 (ヒンジ) が接地中 → 下辺の線を描かない
out float vAppear;               // Reveal: 本体の色から浮かび上がる (0=本体と同じ色 / 1=破片の色)
out float vShade;                // 破片の陰影 (1=なし)
out vec2  vVar;                  // 破片ごとの明るさ / 色相のずれ

${common}

// 破片 1 枚の変換 (main で決めて place() が参照)。すべて本体ローカル座標 (3D)
vec3  gN, gA2, gDn, gHp, gFallW;
float gW1, gW2, gK, gTh, gLayer, gLiftMix;
mat3  gM;
// 破片面上の点 (x: 横 -1..1, y: 縦 -1..1, y=-1 が下端=ヒンジ) → ワールド。
//   下端から上へ向かう帯を曲率 gK で法線側へ反らせ、180° で折り返した先は真っ直ぐ下へ垂らす → 面の姿勢 → 落下
float gLiftV = 0.0;
vec3 place(float x, float y){
  if(uTaper != 0.0) x *= 1.0 - uTaper * (y + 1.0) * 0.5;
  float L = (y + 1.0) * gW1;                        // ヒンジ (下端) からの距離 (0..2w1)
  vec3 upv = -gDn;
  vec3 o;
  if(gK > 1e-4){
    float La = 3.14159265 / gK;                     // 折り返し (180°) までの長さ
    if(L <= La){ float a = gK * L; o = (upv * sin(a) + gN * (1.0 - cos(a))) / gK; }
    else        { o = gN * (2.0 / gK) - upv * (L - La); }
  } else o = upv * L;
  if(gTh != 0.0){                                   // 落下中の揺れ: ヒンジ軸まわりに全体を揺らす
    float su = dot(o, upv), sn = dot(o, gN), c = cos(gTh), si = sin(gTh);
    o = upv * (su*c - sn*si) + gN * (su*si + sn*c);
  }
  vec3 Q = gHp + gA2 * (x * gW2) + o + gN * gLayer;
  if(uTwist != 0.0) Q += gN * (x * gW2 * uTwist * gLiftV * (y + 1.0) * 0.5);
  // 貼り付いている間は接平面ではなく実際の表面に沿わせる (形状と Deform なりに曲がる)。めくれ始めると円弧へ移る
  vec3 Qs = surf(gHp + gA2 * (x * gW2) + upv * L) + gN * gLayer;
  Q = mix(Qs, Q, gLiftMix);
  return camX(gM * Q + vec3(0.0, 0.0, EYE) + gFallW);
}
vec2 proj(vec3 p){ return uFcl * p.xy / p.z; }

void main(){
  float n = float(gl_InstanceID);
  float N = uCells;
  float j = floor(n / N), i = n - j*N;
  vec3  hc = h3(i*1.37 + j*19.1 + 0.7);
  vec2  hj = h2(i*3.1 + j*7.7 + 2.2);
  vec2  hs = h2(i*2.7 + j*11.3 + 5.5);
  vec2  hr = h2(i*6.1 + j*1.9 + 8.8);

  // ── 形状ごとの破片の配置: 素の表面上の点 q0、接線 t1/t2、法線の向きの目安 nRef、セルの大きさ cs ──
  float cs, phN, ext, dl;
  float qa = 0.0;                                     // 液体の輪郭による剥がれ
  vec3  q0, t1, t2, nRef;
  if(uShape < 0.5){
    // 液体 (2D): 格子。輪郭の外は qa で剥がれる
    float exx = 1.25*uS;
    cs = 2.0*exx / N;
    vec2 c = ((vec2(i, j) + 0.5)/N*2.0 - 1.0) * exx + (hj - 0.5) * cs * 0.5 * uJitter;
    float d = bodyS(c);
    float m = uPeel * cs * (0.7 + 0.6*hr.x);
    qa = (d + 0.5*m) / (2.0*m);
    q0 = vec3(c, 0.0); t1 = vec3(1.0, 0.0, 0.0); t2 = vec3(0.0, 1.0, 0.0); nRef = vec3(0.0, 0.0, -1.0);
    phN = fbm2(c/uS*uPeelScale + 7.3); ext = exx;
  } else if(uShape < 1.5){
    // 球: フィボナッチ球面に均等配置
    float total = N*N;
    float y = 1.0 - 2.0*(n + 0.5)/total;
    float rr = sqrt(max(0.0, 1.0 - y*y));
    float phi = n * 2.399963;
    vec3 u = vec3(rr*cos(phi), y, rr*sin(phi));
    vec3 a1 = normalize(cross(u, vec3(0.13, 1.0, 0.07)));
    vec3 a2 = cross(u, a1);
    float ca = sqrt(12.566/total);                    // 1 セルぶんの角度
    u = normalize(u + (a1*(hj.x - 0.5) + a2*(hj.y - 0.5)) * ca * 0.6 * uJitter);
    t1 = normalize(cross(u, vec3(0.13, 1.0, 0.07))); t2 = cross(u, t1);
    q0 = u * RB; nRef = u; cs = RB * ca;
    phN = fbm3(u*uPeelScale*1.3 + 7.3); ext = RB*1.45;
  } else if(uShape < 2.5){
    // 縦の面: 長方形の格子
    vec2 hf = vec2(0.8*uS, 0.6*uS);
    cs = 2.0*hf.x / N;
    vec2 c = ((vec2(i, j) + 0.5)/N*2.0 - 1.0) * hf + (hj - 0.5) * cs * 0.5 * uJitter;
    q0 = vec3(c, 0.0); t1 = vec3(1.0, 0.0, 0.0); t2 = vec3(0.0, 1.0, 0.0); nRef = vec3(0.0, 0.0, -1.0);
    phN = fbm2(c/uS*uPeelScale + 7.3); ext = hf.y;
  } else if(uShape < 3.5){
    // 円柱 (側面): 周 × 高さの格子
    float Nt = floor(N*1.42 + 0.5), Ny = max(1.0, floor(N*N/Nt));
    float it = mod(n, Nt), iy = floor(n / Nt);
    if(iy >= Ny){ gl_Position = CULL; return; }
    float R = 0.45*uS*uSwell, H = 1.4*uS*uSwell;
    cs = 6.2832*R / Nt;
    float th = (it + 0.5 + (hj.x - 0.5)*0.5*uJitter)/Nt*6.2832;
    float yy = ((iy + 0.5 + (hj.y - 0.5)*0.5*uJitter)/Ny*2.0 - 1.0)*0.5*H;
    q0 = vec3(R*cos(th), yy, R*sin(th)); nRef = vec3(cos(th), 0.0, sin(th));
    t1 = vec3(-sin(th), 0.0, cos(th)); t2 = vec3(0.0, 1.0, 0.0);
    phN = fbm3(q0/uS*uPeelScale*1.3 + 7.3); ext = 0.5*H*1.1;
  } else {
    // 立方体: 6 面 × 格子
    float m = max(1.0, floor(N / 2.449));
    float face = floor(n / (m*m));
    if(face >= 6.0){ gl_Position = CULL; return; }
    float r = mod(n, m*m);
    vec2 ab = (vec2(mod(r, m), floor(r / m)) + 0.5 + (hj - 0.5)*0.5*uJitter)/m*2.0 - 1.0;
    float hsz = 0.55*uS*uSwell;
    cs = 2.0*hsz / m;
    vec3 Nf, e1, e2;
    if(face < 0.5)     { Nf = vec3( 1.0, 0.0, 0.0); e1 = vec3(0.0, 0.0,-1.0); e2 = vec3(0.0, 1.0, 0.0); }
    else if(face < 1.5){ Nf = vec3(-1.0, 0.0, 0.0); e1 = vec3(0.0, 0.0, 1.0); e2 = vec3(0.0, 1.0, 0.0); }
    else if(face < 2.5){ Nf = vec3(0.0, 1.0, 0.0); e1 = vec3(1.0, 0.0, 0.0); e2 = vec3(0.0, 0.0,-1.0); }
    else if(face < 3.5){ Nf = vec3(0.0,-1.0, 0.0); e1 = vec3(1.0, 0.0, 0.0); e2 = vec3(0.0, 0.0, 1.0); }
    else if(face < 4.5){ Nf = vec3(0.0, 0.0, 1.0); e1 = vec3(1.0, 0.0, 0.0); e2 = vec3(0.0, 1.0, 0.0); }
    else               { Nf = vec3(0.0, 0.0,-1.0); e1 = vec3(-1.0, 0.0, 0.0); e2 = vec3(0.0, 1.0, 0.0); }
    q0 = Nf*hsz + e1*ab.x*hsz + e2*ab.y*hsz; nRef = Nf; t1 = e1; t2 = e2;
    phN = fbm3(q0/uS*uPeelScale*1.3 + 7.3); ext = hsz*1.2;
  }
  dl = cs * 0.5;
  // 表面上の位置と法線。Deform があれば近傍差分、無ければ素の法線
  vec3 gP = surf(q0);
  vec3 gA1;
  if(uDeform > 0.001){
    vec3 P1 = surf(q0 + t1*dl), P2 = surf(q0 + t2*dl);
    gA1 = normalize(P1 - gP);
    gN  = normalize(cross(gA1, P2 - gP));
    if(dot(gN, nRef) < 0.0) gN = -gN;
  } else { gA1 = t1; gN = nRef; }

  // 本体の姿勢: 傾き (X 軸) → 回転 (Y 軸)
  { float ct = cos(uTilt), st = sin(uTilt), cy = cos(uSpinA), sy = sin(uSpinA);
    mat3 rx = mat3(1.0, 0.0, 0.0,  0.0, ct, st,  0.0, -st, ct);
    mat3 ry = mat3(cy, 0.0, -sy,  0.0, 1.0, 0.0,  sy, 0.0, cy);
    gM = ry * rx; }

  // ── 剥がれのムラ: 破片ごとの速さ (Peel Var) と、剥がれるかどうか (Peel Amt。ノイズで塊に) ──
  float tNoise = smoothstep(0.20, 0.68, phN);                       // fbm は中央に偏るので S 字で均す
  float spdK  = mix(1.0, 0.35 + 1.3*h1(i*2.9 + j*5.3 + 1.1), uPeelVar);
  float thrA  = (uPeelAmt >= 0.999) ? 1.0 : clamp(uPeelAmt * (0.4 + 1.2*tNoise), 0.0, 1.0);
  float allow = step(h1(i*7.1 + j*3.9 + 4.4), thrA);

  // ── マウス剥がれの状態更新パス: 破片 1 枚 = 状態テクスチャの 1 点。画面上の破片の位置がマウスの半径内なら進め始める ──
  vState = 0.0;
  if(uStateMode > 0.5){
    vec3  Pw = camX(gM * gP + vec3(0.0, 0.0, EYE));
    vec2  s0 = proj(Pw);                                            // 画面高 = 1 の単位
    float asp = uRes.x / uRes.y;
    vec2  sc = vec2(0.5 + s0.x / asp, 0.5 + s0.y);                  // 0..1 (y 上向き)
    vec2  dm = (sc - uMouse.xy) * vec2(asp, 1.0);                   // 画面高さ単位の差
    float touch = (uMouse.z > 0.5 && Pw.z > 0.25 && length(dm) < uMouse.w) ? allow : 0.0;
    vec4  old = texelFetch(uState, ivec2(i, j), 0);
    float p = (old.r + old.g/255.0) * 2.5;
    if(p <= 0.0 && touch > 0.5) p = 0.001;                          // 触れたら剥がれ始める (Peel Amt で剥がれない破片もある)
    if(p > 0.0) p += uDt * uPeelSpd * spdK;                         // 0..1 めくれ / 1..2 落下 / 2..2.5 待って貼り直し (速さはムラ)
    if(p >= 2.5) p = 0.0;
    vState = p / 2.5;
    gl_Position = vec4(((i + 0.5)/N)*2.0 - 1.0, ((j + 0.5)/N)*2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = 1.0;
    vLoc = vec2(0.0); vHalfPx = vec2(1.0); vDepthF = 1.0; vDet = 0.0; vLineOn = 1.0; vHinge = 0.0; vAppear = 1.0; vShade = 1.0; vVar = vec2(0.0);
    return;
  }

  // ── 剥がれの進み q: 0..1 めくれ上がり / 1..2 落下 ──
  float qb;
  if(uPeelMode > 0.5){
    // マウス: 状態テクスチャの進みをそのまま使う (2 以上 = 落ちきって貼り直し待ち)
    vec4  st = texelFetch(uState, ivec2(i, j), 0);
    float p  = (st.r + st.g/255.0) * 2.5;
    qb = (p >= 2.0) ? 2.0 : p;
  } else {
    // 自動: 全体で 1 本の周期 G。破片は Order の順 (まとまり = ノイズ順 / 下から上 / 上から下) に剥がれ始め、
    //   最後の破片が落ち終わる時刻 = 周期の終わりで全部が一斉に貼り直される (全部落ちきったらリセット)。
    float G  = fract(uT * uPeelRate + uPhase);
    float D = uSpan / spdK;                                          // 1 枚のめくれ + 落下が周期に占める割合 (速さのムラで伸縮)
    float hN  = clamp(0.5 + 0.5 * (gM * gP).y / ext, 0.0, 1.0);     // 0=下端 / 1=上端 (世界座標)
    float tOrd = (uOrder < 0.5) ? 0.85*tNoise
               : ((uOrder < 1.5) ? 0.75*hN : 0.75*(1.0 - hN)) + 0.10*tNoise;   // 高さ順はノイズを少し混ぜて前線を波打たせる
    float sK = (1.0 - uSpan) * clamp(tOrd + 0.15*hr.y, 0.0, 1.0);   // 剥がれ始める時刻
    float pp = (G - sK) / D;
    qb = (pp <= 0.0) ? 0.0 : ((pp < uLiftSh) ? pp/uLiftSh : 1.0 + (pp - uLiftSh)/uFallSh);   // めくれ 36% / 落下 64%
    qb *= allow;                                                    // Peel Amt で剥がれない破片
  }
  float q  = max(qa, qb);
  float lift = clamp(q, 0.0, 1.0);
  float f    = clamp(q - 1.0, 0.0, 1.0);
  if(f >= 0.999){ gl_Position = CULL; return; }
  // Reveal: 貼り付いている破片は描かず、めくれ始めで本体から浮かび上がる
  if(uReveal > 0.5 && lift <= 0.001){ gl_Position = CULL; return; }
  float appear = (uReveal > 0.5) ? smoothstep(0.0, 0.3, lift) : 1.0;

  // ── 破片の向き: 縦に上を向く (世界座標の上を本体ローカルへ戻して接平面に投影)。Rotate で法線まわりに回す ──
  vec3 upW = transpose(gM) * vec3(0.0, 1.0, 0.0);
  vec3 up  = upW - gN*dot(upW, gN);
  if(dot(up, up) < 1e-4) up = gA1;
  up = normalize(up);
  { float rotA = uRotate + (h1(i*4.3 + j*8.1 + 2.2) - 0.5) * 3.1416 * uRotVar;
    vec3 side = normalize(cross(gN, up));
    up = normalize(cos(rotA)*up + sin(rotA)*side); }
  gDn = -up; gA2 = normalize(cross(gN, up));
  // ── 破片の形: Transmute Flock の筆先と同じ細長い矩形。大きさは 3 段階に量子化 ──
  float jit3 = max(0.25, mix(1.0, 0.5 + floor(hs.x*3.0)*0.5, uJitter));
  float bsz  = cs*0.5*uOverlap*jit3;
  float vL = 0.9 + 0.7*fract(hc.y*5.17), vW = 0.5 + 0.4*fract(hc.z*7.31);
  if(uLenVar != 1.0) vL = 1.25 + (vL - 1.25) * uLenVar;
  if(uWidVar != 1.0) vW = 0.7 + (vW - 0.7) * uWidVar;
  gW1 = bsz * sqrt(uAspect) * vL * 0.75;   // 縦の半長
  gW2 = bsz / sqrt(uAspect) * vW * 1.2;    // 横の半幅
  // ── ヒンジ = 下端 (表面の上に置く)。上端から外へ反り返って折り返し、頭が下を向いてぶら下がる ──
  gHp = surf(gP - up*gW1);
  gK  = lift * uLift * 2.0 / max(2.0*gW1, 1e-4);          // 総角度 = lift × Lift × 2 (既定 2.4 → 4.8 rad: 折り返し + 垂れ)
  gLiftMix = smoothstep(0.0, 0.3, lift);                    // めくれ始めで表面沿いから円弧へ
  gTh = f * uTumble * 1.5 * sin(uT*2.0 + hc.z*6.2832);
  gLiftV = lift;
  gLayer = (0.012*uS + 0.025*uS*h1(i*3.7 + j*5.1 + 0.3)) * uGap + f * 0.10*uS;   // 本体から少し浮かせる + 重なり順の高さ差 + 落下中は面から離れる
  // 落下はワールド座標の真下。Drift で横流れ、少し手前へも
  float ff = (uFallPow == 2.0) ? f*f : pow(f, uFallPow);
  gFallW = vec3((hr.y - 0.5) * 2.0 * uDrift * uS * f, -ff * uFall * uS * (0.7 + 0.6*hs.y), -f * 0.06*uS);
  if(uFallA != 0.0) gFallW.xy = rot2(gFallW.xy, uFallA);

  vec3 P0 = place(0.0, 0.0), Pa = place(1.0, 0.0), Pb = place(0.0, 1.0);
  vec3 wp = place(aCorner.x, aCorner.y);
  float zmin = min(min(P0.z, Pa.z), min(Pb.z, wp.z));
  if(zmin < 0.25){ gl_Position = CULL; return; }
  vec2 s0 = proj(P0);
  vec2 f1 = proj(Pa) - s0, f2 = proj(Pb) - s0;
  float ss = min(length(f1), length(f2));
  if(ss < uMinSS || abs(f1.x*f2.y - f1.y*f2.x) < 1e-8){ gl_Position = CULL; return; }   // 真横は描かない

  float asp = uRes.x / uRes.y;
  const float zn = 0.25, zf = 40.0;
  float zc = ((zf + zn) / (zf - zn)) * wp.z - 2.0*zf*zn / (zf - zn);
  gl_Position = vec4(2.0 * uFcl * wp.x / asp, 2.0 * uFcl * wp.y, zc, wp.z);
  vLoc    = aCorner;
  vHalfPx = vec2(length(f1), length(f2)) * uRes.y;
  float fade = 1.0 - smoothstep(uFadeS, 1.0, f);                      // 落ちながら薄れて消える
  vDepthF = mix(1.0, clamp(1.6 - 0.6*(P0.z/EYE), 0.15, 1.0), uDepth) * fade;
  vAppear = appear;
  vShade = 1.0;
  if(uPShade != 0.0){
    vec3 Nw = normalize(cross(Pa - P0, Pb - P0) + vec3(1e-7, 0.0, 0.0));
    if(Nw.z > 0.0) Nw = -Nw;
    vShade = mix(1.0, 0.45 + 0.55*max(0.0, dot(Nw, lightDir())), uPShade);
  }
  vVar = vec2(0.0);
  if(uToneVar != 0.0 || uHueVar != 0.0){ vec2 hv = h2(i*5.3 + j*9.7 + 1.9); vVar = vec2(-uToneVar * hv.x, (hv.y - 0.5) * 2.0 * uHueVar); }
  vDet    = step(fract(hc.z*3.1), 0.07);
  vLineOn = (h1(i*0.531 + j*7.9 + 0.37) < uLineSkip) ? 0.0 : 1.0;
  vHinge  = 1.0 - smoothstep(0.0, 0.2, f);                           // 落ち始めると下辺の線が現れる
}`;

    const fs = `#version 300 es
precision highp float;
in vec2  vLoc;
in vec2  vHalfPx;
in float vDepthF;
in float vDet;
in float vLineOn;
in float vHinge;
in float vAppear;
in float vState;
in float vShade;
in vec2  vVar;
uniform float uRound;
uniform float uLine, uLineK, uFill, uDetail, uOpaque, uPaperAlpha, uEdgeOn, uBodyTone, uAppearPaper, uStateMode;
uniform vec3  uInk, uPaper, uBodyCol;
out vec4 frag;
void main(){
  if(uStateMode > 0.5){                                     // 状態更新パス: 進み (0..1) を 16bit で R, G に符号化
    float v = clamp(vState, 0.0, 1.0);
    frag = vec4(floor(v*255.0)/255.0, fract(v*255.0), 0.0, 1.0);
    return;
  }
  // 縁までの距離 (px) は画面微分で測る (反った部分でも線幅が一定。平らな投影サイズから換算すると太い帯になる)
  vec2  fw   = max(fwidth(vLoc), vec2(1e-5));
  float dx   = (1.0 - abs(vLoc.x)) / fw.x;
  float dTop = (1.0 - vLoc.y) / fw.y;
  float dBot = (1.0 + vLoc.y) / fw.y;
  float d    = min(dx, min(dTop, mix(dBot, 1e5, vHinge)));   // 接地中は下辺 (ヒンジ) の線なし
  if(uRound > 0.0){                                          // 角丸: 縁までの px 距離の角を丸める (外側は捨てる)。接地中の下辺は丸めない
    float ey = min(dTop, mix(dBot, 1e5, vHinge));
    float rr = uRound * min(vHalfPx.x, vHalfPx.y) * 0.95;
    vec2  q  = vec2(rr - dx, rr - ey);
    if(q.x > 0.0 && q.y > 0.0){ float dc = rr - length(q); if(dc < -0.5) discard; d = min(d, max(dc, 0.0)); }
  }
  float lw = max(uLine, 0.05) * 0.5;
  float aa = 0.7;
  float band  = (1.0 - smoothstep(lw, lw + aa, d)) * uLineK * uEdgeOn;   // 縁の線 (塗りでは重なった破片の境のひび割れになる)。Edge なしで消す
  float inner = (1.0 - smoothstep(0.5, 0.5 + aa, abs(d - (2.0*lw + 1.6)))) * vDet * uDetail * uLineK;   // 一部の破片の内側の線
  float lines = max(band, inner) * vLineOn;   // Line Skip の破片は線なし
  // 輪郭モード: 線=インク、内部=紙 / 塗りモード: 内部=インク、線=紙色
  float inkOutline = lines;
  float inkFill    = 1.0 - lines;
  float ink = mix(inkOutline, inkFill, uFill) * vDepthF;
  vec3 inkC = uInk * vShade;
  if(vVar.x != 0.0 || vVar.y != 0.0){                            // 破片ごとの明るさ / 色相のずれ
    inkC *= 1.0 + vVar.x;
    float hc = cos(vVar.y), hs = sin(vVar.y);
    inkC = inkC*hc + cross(vec3(0.57735), inkC)*hs + vec3(0.57735)*dot(vec3(0.57735), inkC)*(1.0 - hc);
    inkC = max(inkC, 0.0);
  }
  vec3 bodyCol = mix(uPaper, uBodyCol, uBodyTone * vDepthF);   // Reveal の出現時はこの色 (Appear=本体の色) か紙色から破片の色へ
  if(uAppearPaper > 0.5) bodyCol = uPaper;
  if(uOpaque > 0.5){ frag = vec4(mix(bodyCol, mix(uPaper, inkC, ink), vAppear), 1.0); }
  else {
    float a = ink + uPaperAlpha * (1.0 - ink);
    vec3  c = (ink * inkC + (1.0 - ink) * uPaperAlpha * uPaper) / max(a, 1e-5);
    frag = vec4(mix(bodyCol, c, vAppear), max(a, 1.0 - vAppear));
  }
}`;

    // ── 本体 (破片の下にある元のオブジェクト)。球・円柱・立方体 = 緯度経度球メッシュを形状へ写す / 液体・縦の面 = 格子メッシュ ──
    const bodyUni = `
uniform vec2  uRes;
uniform float uFcl, uTilt, uSpinA;
uniform float uT, uMorph, uBlobs, uS, uWobble, uSwell, uShape, uDeform;
uniform float uLine, uLineK, uLit, uBodyLine, uRim;
`;
    const bodyPose = `
mat3 pose(){
  float ct = cos(uTilt), st = sin(uTilt), cy = cos(uSpinA), sy = sin(uSpinA);
  return mat3(cy, 0.0, -sy,  0.0, 1.0, 0.0,  sy, 0.0, cy) * mat3(1.0, 0.0, 0.0,  0.0, ct, st,  0.0, -st, ct);
}
vec4 project(vec3 wp){
  float asp = uRes.x / uRes.y;
  const float zn = 0.25, zf = 40.0;
  float zc = ((zf + zn) / (zf - zn)) * wp.z - 2.0*zf*zn / (zf - zn);
  return vec4(2.0 * uFcl * wp.x / asp, 2.0 * uFcl * wp.y, zc, wp.z);
}`;
    const bodyVS3 = `#version 300 es
precision highp float;
in vec3 aDir;    // 球・円柱: 単位球の方向 / 立方体: 単位立方体上の位置
in vec3 aNrm;    // 立方体: 面の法線 (球・円柱では aDir と同じ)
` + bodyUni + common + bodyPose + `
out vec3 vN; out float vZ; out vec2 vPlane; out vec3 vPos; out vec3 vBase; out vec3 vNl;
// メッシュの頂点 → 素の表面の点と法線 (球 / 円柱 (極は端面の中心) / 立方体 (面の格子))
vec3 meshBase(vec3 v, vec3 nrm, out vec3 N0){
  if(uShape < 1.5){ vec3 u = normalize(v); N0 = u; return u * RB; }
  if(uShape < 3.5){
    vec3 u = normalize(v);
    float R = 0.45*uS*uSwell, H = 1.4*uS*uSwell;
    float th = atan(u.z, u.x);
    bool pole = abs(u.y) > 0.9999, cap = abs(u.y) > 0.985;
    N0 = cap ? vec3(0.0, sign(u.y), 0.0) : vec3(cos(th), 0.0, sin(th));
    return pole ? vec3(0.0, sign(u.y)*0.5*H, 0.0) : vec3(R*cos(th), clamp(u.y, -1.0, 1.0)*0.5*H, R*sin(th));
  }
  N0 = nrm; return v * (0.55*uS*uSwell);
}
vec3 meshPt(vec3 v, vec3 nrm, out vec3 P0, out vec3 N0){ P0 = meshBase(v, nrm, N0); return P0 + N0 * (RB * uDeform * dAmt(P0 / RB)); }
void main(){
  vec3 P0, N0;
  vec3 P = meshPt(aDir, aNrm, P0, N0);
  vec3 N = N0;
  if(uDeform > 0.001){                                    // 変形後の法線は近傍差分
    vec3 t1 = normalize(cross(N0, vec3(0.13, 1.0, 0.07))); vec3 t2 = cross(N0, t1);
    vec3 d1, d2, n1, n2;
    vec3 P1 = meshPt(aDir + t1*0.02, aNrm, d1, n1), P2 = meshPt(aDir + t2*0.02, aNrm, d2, n2);
    N = normalize(cross(P1 - P, P2 - P));
    if(dot(N, N0) < 0.0) N = -N;
  }
  mat3 M = pose();
  vec3 wp = camX(M * P + vec3(0.0, 0.0, EYE));
  vN = camN(M * N); vZ = wp.z; vPlane = vec2(0.0); vPos = wp; vBase = P0; vNl = N0;
  gl_Position = project(wp);
}`;
    const bodyVS2 = `#version 300 es
precision highp float;
in vec2 aXY;
` + bodyUni + common + bodyPose + `
out vec3 vN; out float vZ; out vec2 vPlane; out vec3 vPos; out vec3 vBase; out vec3 vNl;
vec3 planePt(vec2 c){ vec3 P0 = vec3(c, 0.0); return P0 + vec3(0.0, 0.0, -1.0) * (RB * uDeform * dAmt(P0 / RB)); }
void main(){
  vec2 hf = (uShape < 0.5) ? vec2(1.25*uS) : vec2(0.8*uS, 0.6*uS);   // 液体 / 縦の面
  vec2 c = aXY * hf;
  vec3 P = planePt(c);
  vec3 N = vec3(0.0, 0.0, -1.0);
  if(uDeform > 0.001){
    float e = 0.02*uS;
    N = normalize(cross(planePt(c + vec2(e, 0.0)) - P, planePt(c + vec2(0.0, e)) - P));
    if(N.z > 0.0) N = -N;
  }
  mat3 M = pose();
  vec3 wp = camX(M * P + vec3(0.0, 0.0, EYE));
  vN = camN(M * N); vZ = wp.z; vPlane = c; vPos = wp; vBase = vec3(c, 0.0); vNl = vec3(0.0, 0.0, -1.0);
  gl_Position = project(wp);
}`;
    const bodyFS = `#version 300 es
precision highp float;
in vec3 vN; in float vZ; in vec2 vPlane; in vec3 vPos; in vec3 vBase; in vec3 vNl;
uniform float uBodyTone, uDepth;
uniform vec3  uInk, uPaper, uBodyCol;
` + bodyUni + common + `
out vec4 frag;
void main(){
  float sd = (uShape < 0.5) ? bodyS(vPlane) : -1e3;
  if(sd > 0.0) discard;                                   // 液体の外は描かない
  vec3  L = lightDir();
  bool flatBody = (uShape < 0.5) || (uShape > 1.5 && uShape < 2.5);
  vec3  Nn = normalize(vN);
  float ndl = (flatBody && uDeform < 0.001) ? 0.75 : max(0.0, dot(Nn, L));   // 平らな面は陰影を付けない
  float shade = (uLit > 0.5) ? 0.45 + 0.55*ndl : 1.0;   // Shading なしは Body の色で平坦
  float depthF = mix(1.0, clamp(1.6 - 0.6*(vZ/EYE), 0.15, 1.0), uDepth);
  // 本体の線 (Line と同じ px 幅): 輪郭 (視線と法線が直交) + 幾何的な縁 (立方体の辺 / 円柱の口 / 長方形と液体の外周)
  float lw = max(uLine * uBodyLine, 0.05) * 0.5, aa = 0.7;
  float ndv = abs(dot(Nn, normalize(-vPos)));
  float silPx = ndv / max(fwidth(ndv), 1e-5);
  float edgeW = 1e3;                                      // 縁までの距離 (素の形状のローカル座標で正確に)
  if(uShape < 0.5) edgeW = -sd;
  else if(uShape > 1.5 && uShape < 2.5){ vec2 hf = vec2(0.8*uS, 0.6*uS); edgeW = min(hf.x - abs(vBase.x), hf.y - abs(vBase.y)); }
  else if(uShape > 2.5 && uShape < 3.5){ float R = 0.45*uS*uSwell, H = 1.4*uS*uSwell;
    edgeW = (abs(vNl.y) > 0.5) ? (R - length(vBase.xz)) : (0.5*H - abs(vBase.y)); }
  else if(uShape > 3.5){ float hs = 0.55*uS*uSwell; vec3 ap = abs(vBase), an = abs(vNl);
    edgeW = (an.x > 0.5) ? hs - max(ap.y, ap.z) : ((an.y > 0.5) ? hs - max(ap.x, ap.z) : hs - max(ap.x, ap.y)); }
  float edgePx = edgeW / max(fwidth(edgeW), 1e-5);
  float sil  = (flatBody && uDeform < 0.001) ? 0.0 : (1.0 - smoothstep(lw, lw + aa, silPx));
  float line = max(sil, 1.0 - smoothstep(lw, lw + aa, edgePx)) * uLineK;
  vec3 col = mix(uPaper, uBodyCol, uBodyTone * shade * depthF);
  if(uRim > 0.0) col += uInk * (uRim * pow(1.0 - ndv, 3.0) * uBodyTone);                              // 縁の光
  else if(uRim < 0.0) col = mix(col, uPaper, clamp(-uRim * pow(1.0 - ndv, 3.0), 0.0, 1.0) * uBodyTone);   // 縁を暗く
  col = mix(col, mix(uPaper, uInk, depthF), line);
  frag = vec4(col, 1.0);                                  // 本体は不透明 (Slot B でも)
}`;

    const link = (vsrc, fsrc)=>{
      const sh = (type, src)=>{
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){ console.error('[liquidpeel] shader error:', gl.getShaderInfoLog(s)); }
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vsrc)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsrc));
      gl.linkProgram(p);
      if(!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error('[liquidpeel] link error:', gl.getProgramInfoLog(p));
      return p;
    };
    this.prog = link(vs, fs);
    this.bodyProg3 = link(bodyVS3, bodyFS);
    this.bodyProg2 = link(bodyVS2, bodyFS);

    // 破片: 縦 8 分割のストリップ (上辺 y=1 → 下辺 y=-1)。曲げ (カール) 用
    this.cornerVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerVBO);
    { const v = []; const SEG = 8;
      for(let k = 0; k <= SEG; k++){ const y = 1 - 2*k/SEG; v.push(-1, y, 1, y); }
      this.stripVerts = v.length / 2;
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW); }
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const aC = gl.getAttribLocation(this.prog, 'aCorner');
    gl.enableVertexAttribArray(aC);
    gl.vertexAttribPointer(aC, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(aC, 0);
    gl.bindVertexArray(null);
    // 本体メッシュ: 単位球 (緯度経度 96×48) と、液体・縦の面用の格子 (48×48)
    { const W = 96, H = 48, dirs = [], idx = [];
      for(let y = 0; y <= H; y++){ const th = Math.PI * y / H;
        for(let x = 0; x <= W; x++){ const ph = 2*Math.PI * x / W;
          dirs.push(Math.sin(th)*Math.cos(ph), Math.cos(th), Math.sin(th)*Math.sin(ph)); } }
      for(let y = 0; y < H; y++) for(let x = 0; x < W; x++){
        const a = y*(W+1) + x, b = a + W + 1;
        idx.push(a, b, a+1,  a+1, b, b+1); }
      this.sphereCount = idx.length;
      this.sphereVAO = gl.createVertexArray(); gl.bindVertexArray(this.sphereVAO);
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(dirs), gl.STATIC_DRAW);
      const aD = gl.getAttribLocation(this.bodyProg3, 'aDir'); gl.enableVertexAttribArray(aD); gl.vertexAttribPointer(aD, 3, gl.FLOAT, false, 0, 0);
      const aN = gl.getAttribLocation(this.bodyProg3, 'aNrm'); if(aN >= 0){ gl.enableVertexAttribArray(aN); gl.vertexAttribPointer(aN, 3, gl.FLOAT, false, 0, 0); }
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      gl.bindVertexArray(null); }
    // 立方体: 面ごとの格子 (辺をまたぐ三角形が無いので辺の線が正確に出る)
    { const n = 24, pos = [], nrm = [], idx = [];
      const faces = [[[1,0,0],[0,0,-1],[0,1,0]], [[-1,0,0],[0,0,1],[0,1,0]], [[0,1,0],[1,0,0],[0,0,-1]],
                     [[0,-1,0],[1,0,0],[0,0,1]], [[0,0,1],[1,0,0],[0,1,0]], [[0,0,-1],[-1,0,0],[0,1,0]]];
      faces.forEach(([Nf, e1, e2])=>{
        const base = pos.length / 3;
        for(let y = 0; y <= n; y++) for(let x = 0; x <= n; x++){
          const a = x/n*2 - 1, b = y/n*2 - 1;
          pos.push(Nf[0] + e1[0]*a + e2[0]*b, Nf[1] + e1[1]*a + e2[1]*b, Nf[2] + e1[2]*a + e2[2]*b);
          nrm.push(Nf[0], Nf[1], Nf[2]); }
        for(let y = 0; y < n; y++) for(let x = 0; x < n; x++){
          const a = base + y*(n+1) + x, b = a + n + 1;
          idx.push(a, b, a+1,  a+1, b, b+1); } });
      this.cubeCount = idx.length;
      this.cubeVAO = gl.createVertexArray(); gl.bindVertexArray(this.cubeVAO);
      const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
      const aD = gl.getAttribLocation(this.bodyProg3, 'aDir'); gl.enableVertexAttribArray(aD); gl.vertexAttribPointer(aD, 3, gl.FLOAT, false, 0, 0);
      const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nrm), gl.STATIC_DRAW);
      const aN = gl.getAttribLocation(this.bodyProg3, 'aNrm'); if(aN >= 0){ gl.enableVertexAttribArray(aN); gl.vertexAttribPointer(aN, 3, gl.FLOAT, false, 0, 0); }
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      gl.bindVertexArray(null); }
    { const G = 48, xy = [], idx = [];
      for(let y = 0; y <= G; y++) for(let x = 0; x <= G; x++) xy.push(x/G*2 - 1, y/G*2 - 1);
      for(let y = 0; y < G; y++) for(let x = 0; x < G; x++){
        const a = y*(G+1) + x, b = a + G + 1;
        idx.push(a, b, a+1,  a+1, b, b+1); }
      this.gridCount = idx.length;
      this.gridVAO = gl.createVertexArray(); gl.bindVertexArray(this.gridVAO);
      const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(xy), gl.STATIC_DRAW);
      const aX = gl.getAttribLocation(this.bodyProg2, 'aXY'); gl.enableVertexAttribArray(aX); gl.vertexAttribPointer(aX, 2, gl.FLOAT, false, 0, 0);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      gl.bindVertexArray(null); }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.initialized = true;
  },

  _ensureDepth(w,h){
    const gl = this.gl;
    if(this.depthRBO && this.depthW===w && this.depthH===h) return;
    if(this.depthRBO) gl.deleteRenderbuffer(this.depthRBO);
    this.depthRBO = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRBO);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    this.depthW = w; this.depthH = h;
  },

  // マウス剥がれの状態テクスチャ (N×N RGBA8 ×2、ping-pong)。作り直すと 0 (全部貼り付き) に戻る
  _ensureState(N){
    const gl = this.gl;
    if(this.stateTex[0] && this.stateN === N) return true;
    for(let k = 0; k < 2; k++){
      if(this.stateTex[k]){ gl.deleteTexture(this.stateTex[k]); gl.deleteFramebuffer(this.stateFBO[k]); }
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(N*N*4));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.stateTex[k] = t; this.stateFBO[k] = f;
      if(!ok){ console.warn('[liquidpeel] state FBO incomplete'); this.stateTex[k] = null; return false; }
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.stateN = N; this.stateRead = 0;
    return true;
  },
  resetPeel(){ this.stateN = 0; },   // 次フレームで状態テクスチャを作り直す = 全部貼り直し

  update(){},

  instanceCount(){
    const dz = (v)=> (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v;
    const N = Math.max(4, Math.min(128, Math.round(dz(this.P.cells))));
    return N * N;
  },

  // 破片プログラムの uniform (状態更新パスと本描画で同じ値)
  _setFragUniforms(U, c){
    const gl = this.gl;
    const P = this.P;
    const dz = (v)=> (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v;
    const { w, h, T, fcl, N, shape, S, deform, tilt, spinA, swell, lineEff, lineK, opaque, ink, paper } = c;
    gl.uniform2f(U('uRes'), w, h);
    gl.uniform1f(U('uT'), T);
    gl.uniform1f(U('uFcl'), fcl);
    gl.uniform1f(U('uCells'), N);
    gl.uniform1f(U('uShape'), shape);
    gl.uniform1f(U('uS'), S);
    gl.uniform1f(U('uBlobs'), Math.max(1, Math.min(6, Math.round(dz(P.blobs)))));
    gl.uniform1f(U('uWobble'), dz(P.wobble));
    gl.uniform1f(U('uMorph'), dz(P.morph));
    gl.uniform1f(U('uDeform'), deform);
    gl.uniform1f(U('uJitter'), dz(P.jitter));
    gl.uniform1f(U('uOverlap'), Math.max(0.5, dz(P.overlap)));
    gl.uniform1f(U('uAspect'), Math.max(1.0, dz(P.aspect)));
    gl.uniform1f(U('uPeel'), Math.max(0.1, dz(P.peel)));
    gl.uniform1f(U('uPeelRate'), dz(P.peelRate));
    gl.uniform1f(U('uPeelScale'), Math.max(0.1, dz(P.peelScale)));
    gl.uniform1f(U('uLift'), dz(P.lift));
    gl.uniform1f(U('uFall'), dz(P.fall));
    gl.uniform1f(U('uDrift'), dz(P.drift));
    gl.uniform1f(U('uTumble'), dz(P.tumble));
    gl.uniform1f(U('uTilt'), tilt);
    gl.uniform1f(U('uSpinA'), spinA);
    gl.uniform1f(U('uSwell'), swell);
    gl.uniform1f(U('uDepth'), dz(P.depth));
    gl.uniform1f(U('uMinSS'), 1.5 / Math.max(1, h));
    gl.uniform1f(U('uLineSkip'), dz(P.lineSkip));
    gl.uniform1f(U('uRotate'), dz(P.rotate) * Math.PI / 180);
    gl.uniform1f(U('uRotVar'), dz(P.rotVar));
    gl.uniform1f(U('uReveal'), Math.round(P.reveal || 0));
    gl.uniform1f(U('uOrder'), Math.round(P.order || 0));
    gl.uniform1f(U('uLine'), lineEff);
    gl.uniform1f(U('uLineK'), lineK);
    gl.uniform1f(U('uFill'), dz(P.fill));
    gl.uniform1f(U('uDetail'), dz(P.detail));
    gl.uniform1f(U('uOpaque'), opaque ? 1 : 0);
    gl.uniform1f(U('uPaperAlpha'), dz(P.paperAlpha));
    gl.uniform1f(U('uEdgeOn'), (P.edgeOn == null) ? 1 : Math.round(P.edgeOn));
    gl.uniform1f(U('uBodyTone'), dz(P.body));
    gl.uniform1f(U('uAppearPaper'), Math.round(P.appear || 0));
    gl.uniform3f(U('uInk'), ink[0], ink[1], ink[2]);
    gl.uniform3f(U('uPaper'), paper[0], paper[1], paper[2]);
    gl.uniform1f(U('uRound'), dz(P.round) * 0.01);
    gl.uniform1f(U('uTaper'), dz(P.taper) * 0.01);
    gl.uniform1f(U('uTwist'), dz(P.twist) * 0.01);
    gl.uniform1f(U('uGap'), Math.max(0, dz(P.gap)) / 100);
    gl.uniform1f(U('uLenVar'), dz(P.lenVar) / 100);
    gl.uniform1f(U('uWidVar'), dz(P.widVar) / 100);
    gl.uniform1f(U('uFallPow'), Math.max(0.5, dz(P.fallCurve)));
    gl.uniform1f(U('uFallA'), dz(P.fallDir) * Math.PI / 180);
    gl.uniform1f(U('uFadeS'), Math.max(0, Math.min(95, dz(P.fadeStart))) / 100);
    gl.uniform1f(U('uSpan'), Math.max(5, Math.min(60, dz(P.peelSpan))) / 100);
    { const ls = Math.max(10, Math.min(80, dz(P.liftShare))) / 100;
      gl.uniform1f(U('uLiftSh'), ls); gl.uniform1f(U('uFallSh'), 1 - ls); }
    gl.uniform1f(U('uPhase'), dz(P.peelPhase) / 100);
    gl.uniform1f(U('uPShade'), dz(P.pShade) * 0.01);
    gl.uniform1f(U('uToneVar'), dz(P.toneVar) * 0.01);
    gl.uniform1f(U('uHueVar'), dz(P.hueVar) * Math.PI / 180);
    this._setCamUniforms(U);
  },
  // カメラ・光 (破片と本体の両プログラム共通)
  _setCamUniforms(U){
    const gl = this.gl, P = this.P;
    const dz = (v)=> (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v;
    const lens = Math.max(0.3, Math.min(3, dz(P.lens) / 100));
    gl.uniform1f(U('uEye'), 3.6 * lens);
    gl.uniform1f(U('uRollA'), dz(P.roll) * Math.PI / 180);
    gl.uniform2f(U('uOff'), dz(P.posX) * 0.02, dz(P.posY) * 0.02);
    gl.uniform1f(U('uLightA'), dz(P.lightA) * Math.PI / 180);
    gl.uniform1f(U('uLightZ'), Math.max(0.1, dz(P.lightZ) / 100));
    gl.uniform1f(U('uNoiseY'), Math.max(0.1, dz(P.noiseY) / 100));
  },

  render(opts){
    const gl = this.gl;
    if(!this.initialized || !this.prog) return;
    const P = this.P;
    const dz = (v)=> (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v;
    const w = opts.w, h = opts.h;
    const clock = (opts.clock != null) ? opts.clock : (performance.now()/1000 - this.startTime);
    // 時間基準は Transmute Flock と同じ: beat モード = 拍数 / drone = time × 6 × bpm/120
    const bpm = (typeof BPM !== 'undefined' && BPM.bpm) ? BPM.bpm : 120;
    const beatMode = (typeof App !== 'undefined' && App.beatMode === 'beat');
    const bt = (beatMode && opts.beat != null) ? opts.beat : clock * 6.0 * (bpm / 120);
    const T = bt * 0.12 * (dz(P.speed) * 0.01);
    const N = Math.max(4, Math.min(128, Math.round(dz(P.cells))));
    const lensK = Math.max(0.3, Math.min(3, dz(P.lens) / 100));
    const fcl = 1.6 / Math.max(0.3, Math.min(2.0, dz(P.persp))) * lensK;
    const audioReact = (typeof Audio !== 'undefined' && Audio.react) ? Math.max(0, Math.min(1, Audio.react)) : 0;
    const kick = beatMode ? Math.pow(1.0 - (bt - Math.floor(bt)), 3.0) * dz(P.swell) : 0;
    const swell = 1.0 + 0.25*kick + 0.3*audioReact*dz(P.audio);
    const lineEff = dz(P.line);
    const lineK = 0.25 + 0.75 * (()=>{ const t = Math.max(0, Math.min(1, lineEff / 0.12)); return t*t*(3 - 2*t); })();
    const shape = Math.round(P.shape || 0);
    const flat = (shape === 0 || shape === 2);     // 面 (液体 / 縦の面) は真横にならないよう往復、立体は回り続ける
    const spinA = (flat ? 0.5 * Math.sin(T * 0.5 * (dz(P.spin) * 0.01)) : T * 0.35 * (dz(P.spin) * 0.01)) + dz(P.yaw) * Math.PI / 180;
    const tilt = flat ? Math.max(-0.35, Math.min(0.35, dz(P.tilt))) : dz(P.tilt);   // 面は寝ないよう傾きを制限
    const S = 0.9 * Math.max(0.1, dz(P.size));
    const ink = P.ink || [0.914, 0.933, 0.949];
    const paper = P.paper || [0,0,0];
    const bodyCol = (Math.round(P.bodyLink == null ? 1 : P.bodyLink) === 1) ? ink : (P.bodyCol || ink);
    const deform = dz(P.deform);
    // マウス剥がれ: フレーム時間、マウス (このスロットがアクティブなときだけ押下を拾う)、進む速さ
    const peelMode = Math.round(P.peelMode || 0);
    const dt = (this._lastClock == null) ? 0 : Math.max(0, Math.min(0.1, clock - this._lastClock));
    this._lastClock = clock;
    const active = (typeof App !== 'undefined' && App.activeSlot === opts.slot);
    const cv = (typeof GL !== 'undefined') ? GL.canvas : null;
    const mouse = (typeof App !== 'undefined' && App.mouse && cv)
      ? [App.mouse.x / Math.max(1, cv.width), App.mouse.y / Math.max(1, cv.height), (active && App.mouse.down) ? 1 : 0, Math.max(0.005, dz(P.brush) * 0.01)]
      : [0, 0, 0, 0.1];
    const peelSpd = (0.8 + 2.0 * dz(P.peelRate)) * (dz(P.speed) * 0.01);
    if(peelMode !== this._stateMode){ this._stateMode = peelMode; this.stateN = 0; }   // 切替時は貼り直し

    // ── マウス剥がれ: 状態更新パス (破片 1 枚 = 1 点。前フレームの状態を読んで次を書く) ──
    const useState = (peelMode === 1) && this._ensureState(N);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    const U = (n)=>gl.getUniformLocation(this.prog, n);
    gl.uniform1i(U('uState'), 0);
    gl.uniform1f(U('uPeelMode'), useState ? 1 : 0);
    gl.uniform4f(U('uMouse'), mouse[0], mouse[1], mouse[2], mouse[3]);
    gl.uniform1f(U('uDt'), dt);
    gl.uniform1f(U('uPeelSpd'), peelSpd);
    gl.uniform1f(U('uPeelVar'), dz(P.peelVar));
    gl.uniform1f(U('uPeelAmt'), dz(P.peelAmt));
    gl.uniform3f(U('uBodyCol'), bodyCol[0], bodyCol[1], bodyCol[2]);
    this._setFragUniforms(U, { w, h, T, fcl, N, shape, S, deform, tilt, spinA, swell, lineEff, lineK, opaque: (opts.opaque !== false), ink, paper });
    gl.activeTexture(gl.TEXTURE0);
    if(useState){
      const rd = this.stateRead, wr = 1 - rd;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.stateFBO[wr]);
      gl.viewport(0, 0, N, N);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.bindTexture(gl.TEXTURE_2D, this.stateTex[rd]);
      gl.uniform1f(U('uStateMode'), 1);
      gl.drawArraysInstanced(gl.POINTS, 0, 1, N * N);
      this.stateRead = wr;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.uniform1f(U('uStateMode'), 0);
    gl.bindTexture(gl.TEXTURE_2D, useState ? this.stateTex[this.stateRead] : null);
    gl.bindVertexArray(null);

    const useRBO = !!opts.fbo;
    if(useRBO){
      this._ensureDepth(w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, opts.fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRBO);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.viewport(0, 0, w, h);
    const opaque = (opts.opaque !== false);
    gl.clearColor(opaque ? paper[0] : 0, opaque ? paper[1] : 0, opaque ? paper[2] : 0, opaque ? 1 : 0);
    gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    // ── 本体 (破片より先に、深度付きで) ──
    {
      const bp = flat ? this.bodyProg2 : this.bodyProg3;
      gl.useProgram(bp);
      const B = (n)=>gl.getUniformLocation(bp, n);
      gl.uniform2f(B('uRes'), w, h);
      gl.uniform1f(B('uFcl'), fcl);
      gl.uniform1f(B('uTilt'), tilt);
      gl.uniform1f(B('uSpinA'), spinA);
      gl.uniform1f(B('uT'), T);
      gl.uniform1f(B('uMorph'), dz(P.morph));
      gl.uniform1f(B('uBlobs'), Math.max(1, Math.min(6, Math.round(dz(P.blobs)))));
      gl.uniform1f(B('uS'), S);
      gl.uniform1f(B('uWobble'), dz(P.wobble));
      gl.uniform1f(B('uSwell'), swell);
      gl.uniform1f(B('uShape'), shape);
      gl.uniform1f(B('uDeform'), deform);
      gl.uniform1f(B('uBodyTone'), dz(P.body));
      gl.uniform1f(B('uLine'), lineEff);
      gl.uniform1f(B('uLineK'), lineK);
      gl.uniform1f(B('uLit'), (P.lit == null) ? 1 : Math.round(P.lit));
      gl.uniform1f(B('uDepth'), dz(P.depth));
      gl.uniform3f(B('uInk'), ink[0], ink[1], ink[2]);
      gl.uniform3f(B('uPaper'), paper[0], paper[1], paper[2]);
      gl.uniform3f(B('uBodyCol'), bodyCol[0], bodyCol[1], bodyCol[2]);
      gl.uniform1f(B('uBodyLine'), dz(P.bodyLine) / 100);
      gl.uniform1f(B('uRim'), dz(P.rim) * 0.01);
      this._setCamUniforms(B);
      if(!flat){ const cube = (shape === 4); gl.bindVertexArray(cube ? this.cubeVAO : this.sphereVAO); gl.drawElements(gl.TRIANGLES, cube ? this.cubeCount : this.sphereCount, gl.UNSIGNED_SHORT, 0); }
      else     { gl.bindVertexArray(this.gridVAO);   gl.drawElements(gl.TRIANGLES, this.gridCount,   gl.UNSIGNED_SHORT, 0); }
      gl.bindVertexArray(null);
    }

    // ── 破片 ──
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, useState ? this.stateTex[this.stateRead] : null);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, this.stripVerts, N * N);
    gl.bindVertexArray(null);

    if(useRBO) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },
};

// PDefaults はスクリプト読込時に確定させる (init より先に state 復元が走るため)
LiquidPeel.PDefaults = JSON.parse(JSON.stringify(LiquidPeel.P));

if (typeof window !== 'undefined') window.LiquidPeel = LiquidPeel;
