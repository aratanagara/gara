'use strict';
/* Wind Flock engine — vj/ の追加レンダリングモード (kind:'windflock')。線画の風。
   風の先端 (頭) が 3D 空間を往来し、その軌跡に沿って何本もの「風の面」が時間差で連なって運動する。
   面は重なり合う長方形の板の群れで描く。Transmute Flock と同じ、板 1 枚 = 1 インスタンスを
   頂点シェーダで配置する方式。
   - 頭の道: 正弦の和による 3D の往来 (wander で広さ。angle / yaw で道の向き・奥行きの傾き)。
   - 面 (sheet) k: 頭の時刻 τ から k×gap だけ遅れて道をなぞる (連なり)。長さ trail。
     面は道のまわりにらせん状に巻きつき (radius / coil / spin)、ゆらぎ (warp) を持つ。
     spread で面ごとに道の向きをずらし、place で道からの位置をずらす (0 で全員同じ道 = 連なり)。
   - 板は面の流線に沿って一定間隔で並び (前後に重なる)、幅方向にも lanes 枚 (既定 3) 煉瓦状に重なる。
     size で板だけを小さく/大きくできる (面の幅は変えない。小さくして density / lanes を上げると細かい破片の面)。
     面は先端と尾が細い紡錘形で、細い所は板 1 列の鞭になる。
   - jitter で板が少し回転・浮き、gaps で板が欠け (ノイズで塊に)、stray で小片が散る。
     scatter で一部の板が面から剥がれて飛ぶ (ノイズで決まる区間 + 両端ほど多い。距離は scatterDist、
     両端への偏りは scatterEnd)。剥がれた板は流れと一緒に進みながら転がる。
   - 板は distort で四隅がランダムにずれた四角形になり、round で角が丸くなり、curve で長さ方向に
     円弧状に反る (1 枚 = 8 分割の帯)。輪郭は板ローカル座標の画面微分から距離を取って引く
     (歪み・反り・遠近でも線幅は一定)。lineSkip は板が重なり合った内側の縁だけを間引き、群れ全体の
     最外周の線は必ず残す (先に全板の被覆マスクを描き、間引く板では自板の縁の代わりにマスクの境界
     = 線幅の範囲内に被覆の外がある所を線にする。板の継ぎ目や角でも途切れない)。
   - 深度テストで手前の板が奥の板を隠す。輪郭=インク / 内部=紙 (fill=0) または塗り (fill=1)。
     裏向きの板には流れに沿うハッチ or ベタ塗りの影 (shade / shadeFill)。線幅は板ごと・辺ごとに揺らぎ、辺の両端で入り抜き (lineVar)、
     奥で細る (depth)。
   - sizeVar で板の大きさを対数一様 (指数) 分布にばらつかせる (大半が小さく一部が大きい)。seed で全乱数を引き直す。
   - camYaw / camPitch で場面全体をビュー中心まわりに回す (固定アングル)。hold=1 で時刻を phase に固定して静止
     (スクショ用: seed + cam + hold/phase で同じ構図を再現できる)。
   - Drone/Beat: Transmute Flock と同じ時間基準。beat モードは拍頭で流れが加速→減速 (gust)。
   IF: init(gl) / update() / render({fbo,w,h,slot,beat,clock,opaque}) / P(params)
*/

const WindFlock = {
  gl:null, initialized:false,
  prog:null, vao:null, cornerVBO:null,
  maskFBO:null, maskTex:null, maskW:0, maskH:0, zeroTex:null,
  SEG:8,            // 板 1 枚の長さ方向の分割数 (反りの滑らかさ)
  depthRBO:null, depthW:0, depthH:0,
  startTime:0,

  // ── パラメータ (UI から操作)。数値は uniform に渡す直前に App.deadParam を通す ──
  P:{
    sheets:6,         // 面 (帯) の数
    speed:100,        // 流速 (%)
    angle:15,         // 道の向き (deg)
    yaw:20,           // 道の奥行き方向の傾き (deg。+ で右端が遠ざかる)
    wander:1.0,       // 往来の広さ (頭が 3D 空間を動き回る範囲)
    trail:4.0,        // 帯の長さ (頭からどれだけ後ろまで続くか)
    gap:1.2,          // 帯の間隔 (連なりの時間差)
    spread:0.2,       // 面ごとの道の向きのずれ (0 で全員同じ道 / 1 で ±90°)
    place:0.3,        // 面ごとの道からの位置のずれ
    radius:25,        // らせんの半径 (%)
    coil:100,         // 巻きの密度 (%)
    spin:100,         // 道のまわりの回転 (% 負で逆)
    warp:100,         // 流線のゆらぎ (%)
    width:50,         // 面の幅 (%)
    density:1.0,      // 板の密度 (流れ方向の間隔の逆数)
    lanes:3,          // 面の幅方向の板の枚数
    overlap:1.4,      // 幅方向の重なり (レーン間隔に対する板の幅。1 で隣接、1 超で重なる。流れ方向の重なりは plate)
    plate:2.4,        // 板の長さ (間隔に対する倍率。1 超で前後が重なる)
    size:1.0,         // 板の大きさ (長さ・幅の倍率。面の幅は変えない)
    sizeVar:0.0,      // 大きさの分布 (0=均一 / 上げるほど対数一様 = 大半が小さく一部が大きい。3 で 1/32〜2 倍)
    jitter:0.5,       // 板の角度・大きさ・浮きのばらつき
    distort:0.0,      // 板の歪み (四隅がランダムにずれて台形・菱形になる)
    round:0.0,        // 角丸 (1 で短辺の半分 = 端が半円)
    curve:0.0,        // 反り (板ごとにランダムな向き・量で長さ方向に円弧状に曲がる)
    gaps:0.2,         // 抜け (板が欠ける割合。ノイズで塊になる)
    stray:0.2,        // はぐれ小片の量
    scatter:0.2,      // 散り (面から剥がれて飛ぶ板の割合)
    scatterDist:1.0,  // 散る距離
    scatterEnd:0.6,   // 散りを面の両端に寄せる (0=一様 / 1=端だけ)
    fill:0.0,         // 塗り (0=輪郭だけ・内部は紙 / 1=内部をインクで塗り縁は紙色)
    line:1.2,         // 輪郭線の太さ (px)
    lineVar:1.0,      // 線の抑揚 (板ごと・辺ごとの太さの揺らぎ + 入り抜き)
    lineSkip:0.0,     // 重なった内側の縁を描かない板の割合 (板ごとの乱数で決める。群れの最外周の線は残る)
    detail:0.4,       // 一部の板に出る内側の線の濃さ
    shade:0.5,        // 裏向きの板の影の濃さ
    shadeFill:0.0,    // 影の塗り方 (0=斜めハッチ / 1=ベタ塗り。縁まで塗りつぶし、裏向きの判定も鋭くなる)
    depth:0.7,        // 奥行きによる線の減衰
    persp:1.0,        // 遠近の強さ
    gust:1.0,         // 拍での突風 (流れの加速) と音での面の太り
    seed:0,           // 乱数の種 (全部の乱数を引き直す。構図の再現用)
    camYaw:0,         // カメラの水平回転 (deg。ビュー中心まわりに場面全体を回す)
    camPitch:0,       // カメラの上下回転 (deg)
    hold:0,           // 0=動く / 1=時刻を Phase に固定して静止 (スクショ用)
    phase:0,          // Hold のときの時刻 (秒)
    audio:1.0,        // 音の効き
    ink:[1, 1, 1],    // インク (線) の色
    paper:[0, 0, 0],  // 紙 (板の内部・背景) の色
    paperAlpha:1.0,   // Slot B での紙の不透明度 (1=板は不透明なカード / 0=線だけ残して板の中は透ける)
  },

  // ===== init =====
  init(gl){
    if(this.initialized) return;
    this.gl = gl;
    this.startTime = performance.now()/1000;

    const vs = `#version 300 es
precision highp float;
in vec2 aCorner;                 // 板ローカル (-1..1)。x を 8 分割した帯 (反り用)
uniform vec2  uRes;
uniform float uTau, uFlowT, uDu, uStepsMax, uSheets, uTrail, uGap, uWander;
uniform float uRadius, uCoil, uSpin, uWarp, uWidth, uPlate, uJitter, uGaps, uStray, uSize, uLanes, uOverlap;
uniform float uDepth, uFcl, uAngle, uYaw, uAu, uBurst, uMinSS, uLineVar;
uniform float uSpread, uPlace, uScatter, uScatterDist, uScatterEnd, uDistort, uLineSkip, uCurve;
uniform float uSizeVar, uSeed, uCamYaw, uCamPitch;
out vec2  vLoc;                  // 板ローカル (-1..1。x = 長さ方向, y = 幅方向)
out float vLineOn;               // 縁の線を描く板か (0/1。Line Skip で間引く)
out float vDepthF;               // 奥行き減衰
out float vSeed;                 // 板の乱数 (辺ごとの線幅用)
out float vBack;                 // 裏向き (らせんの内側を見せている) 度合い 0..1
out float vDet;                  // 内側の線を出す板か (0/1)
out float vLw;                   // 板ごとの線幅係数

#define WF_EYE 3.6
#define WF_PI 3.14159265
float wf_h1(float n){ n += uSeed; return fract(sin(n*91.3458)*47453.5453); }   // uSeed で全乱数を引き直す
vec2  wf_h2(float n){ n += uSeed; return fract(sin(vec2(n*12.9898, n*78.233))*43758.5453); }
vec3  wf_h3(float n){ n += uSeed; return fract(sin(vec3(n*12.9898, n*78.233, n*37.719))*43758.5453); }
float wf_vn(float x){ float i = floor(x), f = fract(x); f = f*f*(3.0 - 2.0*f); return mix(wf_h1(i), wf_h1(i + 1.0), f); }
float wf_fbm(float x){ return (wf_vn(x) - 0.5) + 0.5*(wf_vn(x*2.03 + 7.1) - 0.5); }   // -0.75..0.75

// 風の先端 (頭) が往来する 3D の道。u = 道の上の時刻。ex/ey/ez = 道の向きの基底
vec3 wf_path(float u, vec3 ex, vec3 ey, vec3 ez){
  vec3 p = vec3(0.95*sin(u*0.48)       + 0.45*sin(u*1.18 + 1.3),
                0.70*sin(u*0.38 + 2.1) + 0.35*sin(u*1.08 + 0.4),
                0.80*sin(u*0.30 + 4.0) + 0.40*sin(u*0.87 + 2.6));
  p *= uWander * vec3(1.3, 0.8, 0.6);                 // 奥行きは控えめ (カメラに近づきすぎない)
  return vec3(0.0, 0.0, WF_EYE) + ex*p.x + ey*p.y + ez*p.z;
}
// 面 k の、道の時刻 u における 3D 位置: 道のまわりのらせん + ゆらぎ。rad = らせんの外向き半径方向
vec3 wf_pos(float u, float k, vec3 hk, vec3 ex, vec3 ey, vec3 ez, vec3 off, out vec3 rad){
  vec3 Pc = wf_path(u, ex, ey, ez);
  vec3 Tc = normalize(wf_path(u + 0.05, ex, ey, ez) - wf_path(u - 0.05, ex, ey, ez) + vec3(1e-6, 0.0, 0.0));
  vec3 upv = normalize(mix(ey, ez, smoothstep(0.7, 0.95, abs(dot(ey, Tc)))));   // 道が ey に平行なときは ez へ滑らかに切替 (跳びを防ぐ)
  vec3 Nf = normalize(upv - Tc*dot(upv, Tc) + vec3(1e-6, 0.0, 0.0));
  vec3 Bf = cross(Tc, Nf);
  float Ri  = uRadius * (0.45 + 0.8*hk.x) * (0.8 + 0.3*sin(u*0.5 + hk.y*6.0));   // 面ごとの半径 + ふくらみ
  float th  = uCoil*u*(0.7 + 0.6*hk.z) + k*6.2831853/uSheets + hk.x*0.8 + uSpin*uFlowT;
  float dev = uWarp * 0.30 * wf_fbm(u*0.6 + k*11.0);                            // 流線のゆらぎ
  rad = Nf*sin(th) + Bf*cos(th);
  return Pc + rad*Ri + Nf*dev + off;
}
const vec4 CULL = vec4(0.0, 0.0, -3.0, 1.0);   // クリップ外 → 描かれない

void main(){
  float n   = float(gl_InstanceID);
  float slots = uLanes + 1.0;
  float per = uStepsMax * slots;
  float k   = floor(n / per);
  float r   = n - k*per;
  float i   = floor(r / slots);
  float m   = r - i*slots;                // 0..uLanes-1 = 幅方向のレーン / uLanes = はぐれ小片
  if(k >= uSheets){ gl_Position = CULL; return; }
  vec3  hk   = wf_h3(k*3.1 + 7.0);
  float offK = k * uGap * (0.8 + 0.4*hk.y);          // 帯の時間差 (連なり)
  float L    = uTrail * (0.7 + 0.6*hk.z);            // 帯の長さ
  float head = uTau - offK;                          // この帯の先端の時刻
  float i0   = floor((head - L) / uDu);
  float ai   = i0 + i;                               // 絶対インデックス (流れても同じ板を指す)
  float u    = ai * uDu;
  float sf   = (head - u) / L;                       // 0 = 先端 / 1 = 尾
  if(sf < 0.0 || sf > 1.0){ gl_Position = CULL; return; }

  // 道の基底: ex = 道の向き (画面内 uAngle + 奥行き uYaw), ey = 画面内の法線, ez = 残り
  float ca = cos(uAngle), sa = sin(uAngle), cy = cos(uYaw), sy = sin(uYaw);
  vec3 ex0 = vec3(ca*cy, sa*cy, sy);
  vec3 ey0 = vec3(-sa, ca, 0.0);
  vec3 ez0 = cross(ex0, ey0);
  // カメラ (固定アングル): ビュー中心 (0,0,EYE) まわりに場面全体を回す = 基底を回す
  { float cyw = cos(uCamYaw), syw = sin(uCamYaw), cpt = cos(uCamPitch), spt = sin(uCamPitch);
    mat3 camR = mat3(cyw, 0.0, -syw,  0.0, 1.0, 0.0,  syw, 0.0, cyw) * mat3(1.0, 0.0, 0.0,  0.0, cpt, spt,  0.0, -spt, cpt);
    ex0 = camR * ex0; ey0 = camR * ey0; ez0 = camR * ez0; }
  // 面ごとに道の向き (uSpread) と位置 (uPlace) をずらす
  vec3  hk2 = wf_h3(k*7.7 + 13.0);
  vec3  hk3 = wf_h3(k*2.3 + 21.0);
  float sa2 = (hk2.x - 0.5) * 3.14159265 * uSpread;           // 画面内の向きのずれ (±90° × spread)
  float sb2 = (hk2.y - 0.5) * 2.0943951 * uSpread;            // 奥行きの傾きのずれ (±60° × spread)
  vec3 ex = normalize(ex0*cos(sa2)*cos(sb2) + ey0*sin(sa2)*cos(sb2) + ez0*sin(sb2));
  vec3 ey = normalize(ey0 - ex*dot(ey0, ex) + vec3(1e-6, 0.0, 0.0));
  vec3 ez = cross(ex, ey);
  vec3 off = (hk3 - 0.5) * uPlace * vec3(0.8, 0.6, 0.6);
  vec3 rad, r2;
  vec3 P  = wf_pos(u, k, hk, ex, ey, ez, off, rad);
  vec3 Pb = wf_pos(u - 0.5*uDu, k, hk, ex, ey, ez, off, r2);
  vec3 Pf = wf_pos(u + 0.5*uDu, k, hk, ex, ey, ez, off, r2);
  vec3  Td = Pf - Pb;
  float segLen = clamp(length(Td), 1e-5, uDu*4.0);             // 隣の板までの距離 (跳びがあっても板が巨大化しない上限)
  vec3  T  = Td / segLen;                                       // 流線の接線
  vec3  W  = normalize(cross(T, rad) + vec3(1e-6, 0.0, 0.0));   // 面の幅方向 (らせんの表面に接する)
  vec3  N  = cross(T, W);                                       // 面の法線 (≈ 半径方向)

  // 面の幅: 先端と尾が細る紡錘形 (最も太い所は先端寄り)
  float env = pow(max(sin(WF_PI*pow(sf, 0.75)), 0.0), 0.6);
  float hw  = uWidth * (0.4 + 0.5*hk.z) * env * (1.0 + 0.4*uAu + 0.3*uBurst);   // 面の半幅
  if(hw < 0.004){ gl_Position = CULL; return; }
  float hwPlate = hw * 0.975 / uLanes * uOverlap * uSize;       // 板の半幅 (= レーン間隔の半分 × uOverlap)
  vec3  h3 = wf_h3(ai*0.413 + k*5.3 + m*2.7);
  vec2  h2 = wf_h2(ai*0.731 + k*19.7 + m*3.1);
  float jit  = uJitter;
  // 大きさの分布: 対数一様 (2^(-1.6·sv) 〜 2^(0.4·sv))。大半が小さく一部が大きい
  float sv   = exp2(uSizeVar * (2.0*wf_h1(ai*0.769 + k*4.7 + m*1.1 + 5.0) - 1.6));
  float lenH = segLen * uPlate * 0.5 * uSize * sv * (1.0 + (h2.x - 0.5)*0.6*jit);   // 板の半長 (plate>1 で前後が重なる)
  vec3 c, a1, a2; float det;
  if(m < uLanes - 0.5){
    float lane = m - (uLanes - 1.0)*0.5;                        // -(n-1)/2 .. +(n-1)/2
    if(abs(lane) > 0.5 && env < 0.35){ gl_Position = CULL; return; }   // 細い所は中央レーンだけ
    float gapK = uGaps * (0.4 + 0.9*wf_vn(u*0.8 + k*3.3 + m*0.7));    // 抜け (ノイズで塊に)
    if(h3.z < gapK){ gl_Position = CULL; return; }
    float wid = hwPlate * sv * (1.0 + (h2.y - 0.5)*0.5*jit);
    c = P + W*(lane*hw*1.95/uLanes + (h3.x - 0.5)*0.3*hw*jit) + N*(h3.y - 0.5)*0.06*jit
      + T*(wf_h1(ai*0.577 + k*3.3 + m*7.7) - 0.5)*segLen*0.9;       // 流れ方向にずらして煉瓦状に
    // 散り: 一部の板が面から剥がれて飛ぶ。ノイズで決まる区間 (一部だけ) + 両端ほど多い
    float region = smoothstep(0.45, 0.7, wf_vn(u*0.6 + k*7.7 + 3.0));
    float endW   = mix(1.0, 1.0 - env, uScatterEnd);
    float pDet   = clamp(uScatter * (0.2 + 0.8*region) * (0.4 + 0.6*endW) * 1.6, 0.0, 1.0);
    vec3  hd     = wf_h3(ai*0.911 + k*4.1 + m*1.9);
    if(wf_h1(ai*0.323 + k*9.1 + m*5.5) < pDet){
      float dist = uScatterDist * hw * 4.0 * (0.3 + 0.7*hd.x);
      vec3  dir  = normalize((hd - 0.5) * vec3(1.0, 1.4, 0.6) + vec3(1e-5, 0.0, 0.0));   // 面の法線方向へ多め
      c += (W*dir.x + N*dir.y + T*dir.z) * dist;
      float ra = hd.x*6.2831853 + uFlowT*(hd.y - 0.5)*4.0;             // 転がりながら飛ぶ
      float rb = hd.z*3.0 + uFlowT*(hd.x - 0.5)*3.0;
      vec3 Tq = cos(ra)*T + sin(ra)*W, Wq = -sin(ra)*T + cos(ra)*W;
      Wq = cos(rb)*Wq + sin(rb)*N;
      a1 = Tq*lenH*(0.6 + 0.5*hd.y); a2 = Wq*wid*(0.6 + 0.5*hd.z);
    } else {
      float yw = (h2.x - 0.5)*0.5*jit, rl = (h3.y - 0.5)*0.7*jit;    // 面内の回転 / 接線まわりの反り
      vec3 Tp = cos(yw)*T + sin(yw)*W, Wp = -sin(yw)*T + cos(yw)*W;
      Wp = cos(rl)*Wp + sin(rl)*N;
      a1 = Tp*lenH; a2 = Wp*wid;
    }
    det = step(h3.x, 0.12);
  } else {
    if(h3.z > uStray*0.5){ gl_Position = CULL; return; }        // はぐれ小片
    float gsz = 0.25 + 0.4*h2.y;
    c = P + W*(h2.x - 0.5)*5.0*hw + N*(h3.x - 0.5)*3.0*hw + T*(h3.y - 0.5)*segLen;
    float ph = (h2.y - 0.5)*2.5, ps = (h3.x - 0.5)*1.5;
    vec3 Tp = cos(ph)*T + sin(ph)*W, Wp = -sin(ph)*T + cos(ph)*W;
    Wp = cos(ps)*Wp + sin(ps)*N;
    a1 = Tp*lenH*gsz; a2 = Wp*hw*0.45*uSize*sv*gsz*1.5;
    det = 0.0;
  }
  if(c.z < 0.3){ gl_Position = CULL; return; }
  vec3 pa = c + a1, pb = c + a2;
  float zmin = min(min(c.z - abs(a1.z) - abs(a2.z), pa.z), pb.z);
  if(zmin < 0.25){ gl_Position = CULL; return; }
  vec2 s0 = uFcl * c.xy / c.z;
  vec2 f1 = uFcl * pa.xy / pa.z - s0;
  vec2 f2 = uFcl * pb.xy / pb.z - s0;
  float dt = f1.x*f2.y - f1.y*f2.x;
  float ss = min(length(f1), length(f2));
  if(abs(dt) < 1e-7 || ss < uMinSS){ gl_Position = CULL; return; }

  float asp = uRes.x / uRes.y;
  // 板ローカル (lx, ly) → 歪み (四隅のずれを双一次補間) → 反り (長さ方向の円弧)
  float lx = aCorner.x, ly = aCorner.y;
  float hb = ai*0.191 + k*2.9 + m*1.3;
  vec2 d0 = (wf_h2(hb)        - 0.5) * 2.0 * uDistort * 0.3;   // (-1,-1)
  vec2 d1 = (wf_h2(hb + 7.0)  - 0.5) * 2.0 * uDistort * 0.3;   // ( 1,-1)
  vec2 d2 = (wf_h2(hb + 14.0) - 0.5) * 2.0 * uDistort * 0.3;   // (-1, 1)
  vec2 d3 = (wf_h2(hb + 21.0) - 0.5) * 2.0 * uDistort * 0.3;   // ( 1, 1)
  float wx1 = (1.0 + lx)*0.5, wx0 = 1.0 - wx1, wy1 = (1.0 + ly)*0.5, wy0 = 1.0 - wy1;
  vec2  dd = (d0*wx0 + d1*wx1)*wy0 + (d2*wx0 + d3*wx1)*wy1;
  float px = lx + dd.x, py = ly + dd.y;
  vec2  hc = wf_h2(ai*0.271 + k*6.1 + m*2.3 + 3.0);
  float thc = uCurve * (hc.x - 0.5) * 2.0 * 1.4 * (0.4 + 0.6*hc.y);   // 反りの角 (±80° まで。板ごとに向き・量がランダム)
  vec3  Nn = normalize(cross(a1, a2) + vec3(1e-7, 0.0, 0.0));
  vec3  wp;
  if(abs(thc) > 1e-3){
    float phi = px * thc;                                                // 半径 |a1|/thc の円弧
    wp = c + a1 * (sin(phi) / thc) + Nn * (length(a1) * (1.0 - cos(phi)) / thc) + a2 * py;
  } else {
    wp = c + a1 * px + a2 * py;
  }
  const float zn = 0.25, zf = 40.0;
  float zc = ((zf + zn) / (zf - zn)) * wp.z - 2.0*zf*zn / (zf - zn);
  gl_Position = vec4(2.0 * uFcl * wp.x / asp, 2.0 * uFcl * wp.y, zc, max(wp.z, 0.05));
  vLoc    = vec2(lx, ly);
  vLineOn = (wf_h1(ai*0.531 + k*7.9 + m*3.3 + 0.37) < uLineSkip) ? 0.0 : 1.0;
  vDepthF = mix(1.0, clamp(1.6 - 0.6*(c.z/WF_EYE), 0.15, 1.0), uDepth);
  vSeed   = fract(ai*0.137 + k*0.311 + m*0.071);
  vBack   = smoothstep(0.15, 0.6, dot(normalize(rad), normalize(c)));     // 外向き法線が視線と同じ向き = 裏を見ている (強く裏向きの板だけ)
  vDet    = det;
  vLw     = max(1.0 + uLineVar*(h2.y - 0.5)*1.2, 0.2);
}`;

    const fs = `#version 300 es
precision highp float;
in vec2  vLoc;                   // 板ローカル (-1..1)
in float vDepthF;
in float vSeed;
in float vBack;
in float vDet;
in float vLw;
in float vLineOn;
uniform float uLine, uFill, uDetail, uOpaque, uPaperAlpha, uShade, uLineVar, uRound, uShadeFill;
uniform float uPass;             // 0 = 被覆マスク書き込み (深度プリパス) / 1 = 本描画
uniform vec2  uRes;
uniform sampler2D uMask;         // 全板の被覆 (uPass=0 の結果)
uniform vec3  uInk, uPaper;
out vec4 frag;
float wf_fh(float n){ return fract(sin(n*91.3458)*47453.5453); }
void main(){
  // 板ローカル座標の画面微分 → 各辺までの距離 (px)。歪み・反り・遠近があっても画面上の線幅が一定
  vec2  gvx = vec2(dFdx(vLoc.x), dFdy(vLoc.x));
  vec2  gvy = vec2(dFdx(vLoc.y), dFdy(vLoc.y));
  float gx = max(length(gvx), 1e-5);
  float gy = max(length(gvy), 1e-5);
  float dx = (1.0 - abs(vLoc.x)) / gx;          // 端 (長さ方向の両端) まで
  float dy = (1.0 - abs(vLoc.y)) / gy;          // 長い辺まで
  float d1 = min(dx, dy), d2 = max(dx, dy);
  float along, edgeId;                           // 最も近い辺に沿う位置 (-1..1) と辺の番号
  if(dx < dy){ along = vLoc.y; edgeId = (vLoc.x < 0.0) ? 0.0 : 1.0; }
  else       { along = vLoc.x; edgeId = (vLoc.y < 0.0) ? 2.0 : 3.0; }
  // 角丸: 隣り合う 2 辺の距離から丸めた距離を作る。外側は捨てる (深度も書かない)
  float rr = uRound * min(1.0/gx, 1.0/gy) * 0.95;
  vec2  q  = vec2(rr - d1, rr - d2);
  float d  = (q.x > 0.0 && q.y > 0.0) ? rr - length(q) : d1;
  if(d < -0.5) discard;
  d = max(d, 0.0);
  if(uPass < 0.5){ frag = vec4(1.0); return; }   // 被覆マスク: 板の形 (角丸の外は捨てた後) を 1 で描く
  float ev    = 1.0 + uLineVar * (wf_fh(vSeed*97.0 + edgeId*13.0) - 0.5);                  // 辺ごとの太さ
  float taper = mix(1.0, 0.45 + 0.75*sqrt(max(sin((along*0.5 + 0.5)*3.14159265), 0.0)), uLineVar*0.6);   // 入り抜き
  float lw = max(uLine * vLw * ev * taper, 0.15) * 0.5;
  float aa = 0.7;
  // 輪郭。Line Skip の板は自板の縁を描かず、群れ全体の被覆マスクの境界を線にする
  //   (線幅の範囲 8 方向 × 2 半径の 16 点に被覆の外があれば線。板の継ぎ目や角でも途切れない)
  float band;
  if(vLineOn < 0.5){
    float rad2 = lw + aa, miss = 0.0;
    for(int i = 0; i < 8; i++){
      float ang = float(i) * 0.78539816;
      vec2  dir = vec2(cos(ang), sin(ang));
      for(int j = 1; j <= 2; j++){
        ivec2 ip = ivec2(clamp(gl_FragCoord.xy + dir * rad2 * (float(j) * 0.5), vec2(0.5), uRes - 0.5));
        miss += 1.0 - step(0.5, texelFetch(uMask, ip, 0).r);
      }
    }
    band = clamp(miss / 3.0, 0.0, 1.0);
  } else {
    band = 1.0 - smoothstep(lw, lw + aa, d);
  }
  float inner = (1.0 - smoothstep(0.5, 0.5 + aa, abs(d - (2.0*lw + 2.2)))) * vDet * uDetail * vLineOn;   // 一部の板の内側の線
  // 裏向きの板の影: 流れ (板の長さ方向) に沿うハッチ (8px ピッチ、縁の内側だけ) 〜 ベタ塗り (縁まで。uShadeFill)
  float hp    = (vLoc.y / gy) / 8.0;                 // 幅方向の画面距離 → 長さ方向に平行な線 (反りにも沿う)
  float hpat  = (1.0 - smoothstep(0.1, 0.1 + 1.0/8.0, abs(fract(hp) - 0.5))) * 0.8 * smoothstep(2.0*lw + 1.0, 2.0*lw + 3.0, d);
  float back  = mix(vBack, smoothstep(0.35, 0.5, vBack), uShadeFill);   // ベタのときは裏向きの判定を鋭く (灰色の板を減らす)
  float hatch = mix(hpat, 1.0, uShadeFill) * back * uShade;
  float lines = max(max(band, inner), hatch);
  // 輪郭モード: 線=インク、内部=紙 / 塗りモード: 内部=インク、線=紙色
  float ink = mix(lines, 1.0 - lines, uFill) * vDepthF;
  if(uOpaque > 0.5){ frag = vec4(mix(uPaper, uInk, ink), 1.0); }
  else {
    float a = ink + uPaperAlpha * (1.0 - ink);
    vec3  c = (ink * uInk + (1.0 - ink) * uPaperAlpha * uPaper) / max(a, 1e-5);
    frag = vec4(c, a);
  }
}`;

    const link = (vsrc, fsrc, tag)=>{
      const sh = (type, src)=>{
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){ console.error('[windflock:'+tag+'] shader error:', gl.getShaderInfoLog(s)); }
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vsrc)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsrc));
      gl.linkProgram(p);
      if(!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error('[windflock:'+tag+'] link error:', gl.getProgramInfoLog(p));
      return p;
    };
    this.prog = link(vs, fs, 'plates');

    // 板 1 枚 = x を WF_SEG 分割した三角形ストリップ (反り用)。頂点 (x_i,-1),(x_i,+1) を i = 0..WF_SEG
    const seg = this.SEG, corners = [];
    for(let i = 0; i <= seg; i++){ const x = -1 + 2*i/seg; corners.push(x, -1, x, 1); }
    this.cornerVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(corners), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const aC = gl.getAttribLocation(this.prog, 'aCorner');
    gl.enableVertexAttribArray(aC);
    gl.vertexAttribPointer(aC, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(aC, 0);
    gl.bindVertexArray(null);
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

  // 被覆マスク (R8) と、マスク無しのときのダミー (0)
  _ensureMask(w,h){
    const gl = this.gl;
    if(!this.zeroTex){
      this.zeroTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.zeroTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    if(this.maskTex && this.maskW===w && this.maskH===h) return true;
    if(this.maskTex){ gl.deleteTexture(this.maskTex); gl.deleteFramebuffer(this.maskFBO); }
    this.maskTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.maskFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.maskTex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.maskW = w; this.maskH = h;
    if(!ok){ console.warn('[windflock] mask FBO incomplete'); gl.deleteTexture(this.maskTex); this.maskTex = null; }
    return ok;
  },

  update(){},

  // 現在の設定での板 (インスタンス) 数。負荷の目安
  instanceCount(){ const g = this._geom(); return g ? g.instances : 0; },
  _geom(){
    const dz = (v)=> (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v;
    const P = this.P;
    const du = 0.08 / Math.max(0.3, Math.min(6.0, dz(P.density)));   // 板の間隔 (道の時刻)
    const trail = Math.max(0.5, dz(P.trail));
    const stepsMax = Math.ceil(trail * 1.3 / du) + 2;                // 帯の長さ (面ごとに最大 1.3 倍) を覆う
    const sheets = Math.max(1, Math.min(12, Math.ceil(dz(P.sheets))));
    const lanes = Math.max(1, Math.min(6, Math.round(dz(P.lanes))));
    return { du, trail, stepsMax, sheets, lanes, instances: sheets * stepsMax * (lanes + 1) };
  },

  render(opts){
    const gl = this.gl;
    if(!this.initialized || !this.prog) return;
    const P = this.P;
    const dz = (v)=> (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v;
    const w = opts.w, h = opts.h;
    // Hold: 時刻を Phase (秒) に固定して静止 (拍も無視)。スクショ用
    const hold = Math.round(P.hold || 0) === 1;
    const clock = hold ? Math.max(0, +P.phase || 0) : ((opts.clock != null) ? opts.clock : (performance.now()/1000 - this.startTime));
    // 時間基準は Transmute Flock と同じ: beat モード = 拍数 / drone = time × 6 × bpm/120
    const bpm = (typeof BPM !== 'undefined' && BPM.bpm) ? BPM.bpm : 120;
    const beatMode = !hold && (typeof App !== 'undefined' && App.beatMode === 'beat');
    const bt = (beatMode && opts.beat != null) ? opts.beat : clock * 6.0 * (bpm / 120);
    // 突風: beat モードは拍頭で加速→減速 (単調増加のまま)
    const gust = dz(P.gust);
    const fb = bt - Math.floor(bt), ease = 1 - Math.pow(1 - fb, 3);
    const btE = beatMode ? Math.floor(bt) + fb + (ease - fb) * Math.min(gust, 1) : bt;
    const burst = beatMode ? Math.pow(1 - fb, 4) * gust : 0;
    const audioReact = (typeof Audio !== 'undefined' && Audio.react) ? Math.max(0, Math.min(1, Audio.react)) : 0;
    const au = audioReact * dz(P.audio) * gust;

    const g = this._geom();
    const kv = 0.12 * dz(P.speed) * 0.01;        // 1 拍あたり頭が進む道の時刻
    const tau = btE * kv;                         // 頭の時刻
    const flowT = btE * 0.5;                      // 回転・ゆらぎの時間
    const fcl = 1.6 / Math.max(0.3, Math.min(2.0, dz(P.persp)));
    const ink = P.ink || [1,1,1];
    const paper = P.paper || [0,0,0];
    const opaque = (opts.opaque !== false);
    const angle = dz(P.angle) * Math.PI / 180, yaw = dz(P.yaw) * Math.PI / 180;

    const useRBO = !!opts.fbo;
    if(useRBO) this._ensureDepth(w, h);
    const useMask = useRBO && this._ensureMask(w, h);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    const U = (n)=>gl.getUniformLocation(this.prog, n);
    gl.uniform2f(U('uRes'), w, h);
    gl.uniform1i(U('uMask'), 0);
    gl.uniform1f(U('uTau'), tau);
    gl.uniform1f(U('uFlowT'), flowT);
    gl.uniform1f(U('uDu'), g.du);
    gl.uniform1f(U('uStepsMax'), g.stepsMax);
    gl.uniform1f(U('uSheets'), g.sheets);
    gl.uniform1f(U('uTrail'), g.trail);
    gl.uniform1f(U('uGap'), dz(P.gap));
    gl.uniform1f(U('uWander'), dz(P.wander));
    gl.uniform1f(U('uRadius'), dz(P.radius) * 0.013);
    gl.uniform1f(U('uCoil'), dz(P.coil) * 0.01 * 2.4);
    gl.uniform1f(U('uSpin'), dz(P.spin) * 0.01 * 1.5);
    gl.uniform1f(U('uWarp'), dz(P.warp) * 0.01);
    gl.uniform1f(U('uWidth'), dz(P.width) * 0.01 * 0.42);
    gl.uniform1f(U('uPlate'), Math.max(0.3, dz(P.plate)));
    gl.uniform1f(U('uSize'), Math.max(0.05, dz(P.size)));
    gl.uniform1f(U('uLanes'), g.lanes);
    gl.uniform1f(U('uOverlap'), Math.max(0.1, dz(P.overlap)));
    gl.uniform1f(U('uJitter'), dz(P.jitter));
    gl.uniform1f(U('uGaps'), dz(P.gaps) * 0.6);
    gl.uniform1f(U('uStray'), dz(P.stray));
    gl.uniform1f(U('uDepth'), dz(P.depth));
    gl.uniform1f(U('uFcl'), fcl);
    gl.uniform1f(U('uAngle'), angle);
    gl.uniform1f(U('uYaw'), yaw);
    gl.uniform1f(U('uAu'), au);
    gl.uniform1f(U('uBurst'), burst);
    gl.uniform1f(U('uMinSS'), 1.5 / Math.max(1, h));
    gl.uniform1f(U('uLineVar'), dz(P.lineVar));
    gl.uniform1f(U('uSpread'), dz(P.spread));
    gl.uniform1f(U('uPlace'), dz(P.place));
    gl.uniform1f(U('uScatter'), dz(P.scatter));
    gl.uniform1f(U('uScatterDist'), dz(P.scatterDist));
    gl.uniform1f(U('uScatterEnd'), dz(P.scatterEnd));
    gl.uniform1f(U('uDistort'), dz(P.distort));
    gl.uniform1f(U('uLineSkip'), dz(P.lineSkip));
    gl.uniform1f(U('uRound'), dz(P.round));
    gl.uniform1f(U('uCurve'), dz(P.curve));
    gl.uniform1f(U('uSizeVar'), dz(P.sizeVar));
    gl.uniform1f(U('uSeed'), Math.round(+P.seed || 0) * 7.31);
    gl.uniform1f(U('uCamYaw'), (+P.camYaw || 0) * Math.PI / 180);
    gl.uniform1f(U('uCamPitch'), (+P.camPitch || 0) * Math.PI / 180);
    gl.uniform1f(U('uLine'), dz(P.line));
    gl.uniform1f(U('uFill'), dz(P.fill));
    gl.uniform1f(U('uDetail'), dz(P.detail));
    gl.uniform1f(U('uShade'), dz(P.shade));
    gl.uniform1f(U('uShadeFill'), dz(P.shadeFill));
    gl.uniform1f(U('uOpaque'), opaque ? 1 : 0);
    gl.uniform1f(U('uPaperAlpha'), dz(P.paperAlpha));
    gl.uniform3f(U('uInk'), ink[0], ink[1], ink[2]);
    gl.uniform3f(U('uPaper'), paper[0], paper[1], paper[2]);
    const nVerts = 2*(this.SEG + 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.zeroTex);
    // 1) 被覆マスク (深度プリパス): 全板の形を 1 で描く。ここで確定した深度を 2) でそのまま使う
    if(useMask){
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFBO);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRBO);
      gl.clearColor(0, 0, 0, 0); gl.clearDepth(1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      gl.uniform1f(U('uPass'), 0);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, nVerts, g.instances);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
    }
    // 2) 本描画 (マスクを参照して Line Skip の内側の縁を落とす)
    if(useRBO){
      gl.bindFramebuffer(gl.FRAMEBUFFER, opts.fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRBO);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.clearColor(opaque ? paper[0] : 0, opaque ? paper[1] : 0, opaque ? paper[2] : 0, opaque ? 1 : 0);
    if(useMask){ gl.clear(gl.COLOR_BUFFER_BIT); }
    else { gl.clearDepth(1.0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.bindTexture(gl.TEXTURE_2D, useMask ? this.maskTex : this.zeroTex);
    gl.uniform1f(U('uPass'), 1);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, nVerts, g.instances);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindVertexArray(null);

    if(useRBO) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },
};

// PDefaults はスクリプト読込時に確定させる (init より先に state 復元が走るため)
WindFlock.PDefaults = JSON.parse(JSON.stringify(WindFlock.P));

if (typeof window !== 'undefined') window.WindFlock = WindFlock;
