// =====================================================
// bg_ravecube
//   Source : Shadertoy "Wave Rave Cube" https://www.shadertoy.com/view/fsySWm
//            (Fork of "Box Singularity" by Tater)
//   再帰ボックス分割フラクタルのレイマーチ。配色はクローム(鏡面反射)に置換。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。マウスは自動公転に。
//   ヘルパ/グローバルは wr_ で名前空間化。
// =====================================================
#define WR_MDIST 350.0
#define WR_STEPS 110.0
#define WR_PI 3.1415926535
#define wr_rot(a) mat2(cos(a), sin(a), -sin(a), cos(a))

float wr_h11(float a){ return fract(sin((a)*12.9898)*43758.5453123); }
float wr_box(vec3 p, vec3 b){ vec3 d = abs(p)-b; return max(d.x, max(d.y, d.z)); }
float wr_ebox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
// 三角錐(正四面体) SDF。b の平均をサイズに使う。
float wr_tetra(vec3 p, vec3 b){
  float r = (b.x + b.y + b.z) * (1.0/3.0);
  return (max(abs(p.x + p.y) - p.z, abs(p.x - p.y) + p.z) - r) * 0.5774;
}

// ----- 4D 回転体: 6つの 4D 回転平面の関数群 + テッセラクト/Clifford トーラス SDF -----
vec4 wr_r4XY(vec4 p, float a){ float c=cos(a), s=sin(a); return vec4(p.x*c - p.y*s, p.x*s + p.y*c, p.z, p.w); }
vec4 wr_r4YZ(vec4 p, float a){ float c=cos(a), s=sin(a); return vec4(p.x, p.y*c - p.z*s, p.y*s + p.z*c, p.w); }
vec4 wr_r4XZ(vec4 p, float a){ float c=cos(a), s=sin(a); return vec4(p.x*c - p.z*s, p.y, p.x*s + p.z*c, p.w); }
vec4 wr_r4XW(vec4 p, float a){ float c=cos(a), s=sin(a); return vec4(p.x*c - p.w*s, p.y, p.z, p.x*s + p.w*c); }
vec4 wr_r4YW(vec4 p, float a){ float c=cos(a), s=sin(a); return vec4(p.x, p.y*c - p.w*s, p.z, p.y*s + p.w*c); }
vec4 wr_r4ZW(vec4 p, float a){ float c=cos(a), s=sin(a); return vec4(p.x, p.y, p.z*c - p.w*s, p.z*s + p.w*c); }
// テッセラクト(4D 立方体) SDF
float wr_tesseract4(vec4 p, vec4 b){
  vec4 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(max(q.x, q.y), max(q.z, q.w)), 0.0);
}
// @param uSplitX -30..30 = 0
// @param uSplitY -30..30 = 0
// @param uSplitZ -30..30 = 0
// @param uCellRound 20..250 = 100
// @param uEdgePush -4..25 = 0
// @param uSliceW -150..150 = 0
// @param uWDepth 30..250 = 100
// @param uStretchPulse 0..300 = 100
// @param uCubeBound 45..120 = 100
// @param uSpecSharp 55..300 = 100
// @param uRimSharp 30..300 = 100
// @param uAoReach 30..250 = 100
// @param uFogDist 30..200 = 100
uniform float uSplitX; // X 方向の分割位置のずれ (%)
uniform float uSplitY; // Y 方向の分割位置のずれ (%)
uniform float uSplitZ; // Z 方向の分割位置のずれ (%)
uniform float uCellRound; // 各ボックスの角の丸み (%)
uniform float uEdgePush; // 外縁のボックスを外へ押し広げる量 (%)
uniform float uSliceW; // 4 次元を切る位置 (%)。形がテッセラクトの断面で変わる
uniform float uWDepth; // 4 次元方向の厚み (%)
uniform float uStretchPulse; // ボックスの縦横比の脈動の振れ幅 (%)
uniform float uCubeBound; // 全体を切り出す外枠の大きさ (%)
uniform float uSpecSharp; // 反射ハイライトの鋭さ (%)
uniform float uRimSharp; // 縁の光 (フレネル) の鋭さ (%)
uniform float uAoReach; // 接触影の届く距離 (%)
uniform float uFogDist; // 遠景が背景に溶ける距離 (%)

// 4D の回転体を w=wSlice の 3D スライスで切り出した距離。p:3D 座標、b:3D サイズ。
// 内部で 4D テッセラクトを 4D 回転 → スライス。回転位相 t で形状が連続変化。
float wr_tesseract_slice(vec3 p, vec3 b, float t, float wSlice){
  vec4 p4 = vec4(p, wSlice);
  // 4D 回転(6 平面のうち W を含む 3 つで主に「次元越し」のうねりを起こす)
  p4 = wr_r4XW(p4, t*0.32 + 0.7);
  p4 = wr_r4YW(p4, t*0.43 + 1.3);
  p4 = wr_r4ZW(p4, t*0.55 + 2.1);
  // XY/YZ/XZ で 3D 部分の回転(視認性のため)
  p4 = wr_r4XY(p4, t*0.18);
  p4 = wr_r4YZ(p4, t*0.22 + 1.9);
  // 4D テッセラクト(w 軸長を平均サイズに)
  float bw = (b.x + b.y + b.z) * (1.0/3.0);
  return wr_tesseract4(p4, vec4(b, bw * (uWDepth / 100.0)));
}

vec3  wr_rdg = vec3(0);
float wr_nsdf = 0.;

// @param uDetail 2..5 = 5.0
// @param uMotion 0..300 = 100.0
// @param uWarp   0..300 = 100.0
// @param uGlow   0..300 = 100.0
// @param uSize 60..150 = 100.0
// @param uScale 50..150 = 100.0
// @param uAngle -180..180 = 0.0
// @param uSteps 70..110 = 110.0
uniform float uDetail; // ボックス分割の回数 (下げると軽く、形が大きくなる)
uniform float uMotion; // ボックスの膨らみの振幅 (%)
uniform float uWarp; // 4 次元のうねり (%)
uniform float uGlow; // ハイライト・縁の光 (%)
uniform float uSize; // ボックスひとつの大きさ (%)
uniform float uScale; // 物体全体の大きさ (%)
uniform float uAngle; // 向き (度。固定角でずらす)
uniform float uSteps; // レイマーチのステップ数 (下げると軽く、遠景や細部が欠ける)
// @param uOffX -60..60 = 0
// @param uOffY -60..60 = 0
// @param uEnvShift -60..60 = 0
// @param uStripeAmt 0..100 = 0
// @param uAoPow 0..300 = 100
// @param uFogCurve 40..300 = 100
// @param uBgSpread 0..300 = 100
// @param uSheen 0..100 = 0
// @param uGrain 0..100 = 0
// @param uVignette 0..100 = 0
// @param uChromeColor color = #ffffff
// @param uAoColor color = #ffffff
// @param uSpecColor color = #ffffff
// @param uRimColor color = #ffffff
// @param uBackColor color = #ffffff
uniform float uOffX; // 物体の横位置 (%)
uniform float uOffY; // 物体の縦位置 (%)
uniform float uEnvShift; // 環境反射の地平線の位置 (%)。反射の明暗の境目が動く
uniform float uStripeAmt; // 反射に走る縞の濃さ (%)
uniform float uAoPow; // 接触影の濃さ (%)。上げるとくぼみが暗く沈む
uniform float uFogCurve; // 遠景が溶ける曲線の指数 (%)
uniform float uBgSpread; // 背景の中心から周辺へのグラデーションの広がり (%)
uniform float uSheen; // 虹色の艶 (%)。法線の向きで色が移ろう
uniform float uGrain; // 粒状のざらつき (%)
uniform float uVignette; // 周辺減光 (%)
uniform vec3  uAoColor; // 接触影に掛けるティント
uniform vec3  uChromeColor; // クロームの地色のティント
uniform vec3  uSpecColor; // ハイライトの色のティント
uniform vec3  uRimColor; // 縁のフレネル反射の色のティント
uniform vec3  uBackColor; // 背景・遠景の色のティント

vec2 wr_blocks(vec3 p, vec3 scl, vec3 rd){
  float t = time;
  bvec3 isEdge = bvec3(true);
  vec3 dMin = vec3(-0.5) * scl;
  vec3 dMax = vec3(0.5) * scl;
  vec3 dMini = dMin;
  vec3 dMaxi = dMax;
  float id = 0.;
  float ITERS = floor(uDetail + 0.5);
  vec3 dim = dMax - dMin;
  for(float i = 0.; i < 5.; i++){
    if(i >= ITERS) break;
    vec3 divHash = vec3(0.49, 0.501, 0.511);
    if(uSplitX != 0.0 || uSplitY != 0.0 || uSplitZ != 0.0) divHash += vec3(uSplitX, uSplitY, uSplitZ) / 100.0;
    vec3 divide = divHash * dim + dMin;
    dMax = mix(dMax, divide, step(p, divide));
    dMin = mix(divide, dMin, step(p, divide));
    float pad = 0.01;
    if(dMaxi.x > dMax.x+pad && dMini.x < dMin.x-pad) isEdge.x = false;
    if(dMaxi.y > dMax.y+pad && dMini.y < dMin.y-pad) isEdge.y = false;
    if(dMaxi.z > dMax.z+pad && dMini.z < dMin.z-pad) isEdge.z = false;
    vec3 diff = mix(-divide, divide, step(p, divide));
    id = length(diff + 10.0);
    dim = dMax - dMin;
  }
  vec3 center = (dMin + dMax)/2.0;
  float b = 0.;
  if(any(isEdge)){
    float expandBase = 1.05;
    if(uEdgePush != 0.0) expandBase += uEdgePush / 100.0;
    float expand = expandBase + 0.45*(uMotion / 100.0)*(sin(length(center+100.0)*0.35 + t*3.0*WR_PI/3.)*0.5 + 0.5);
    if(isEdge.x){ dim.x += abs(center.x*expand-center.x)*2.0; center.x *= expand; }
    if(isEdge.y){ dim.y += abs(center.y*expand-center.y)*2.0; center.y *= expand; }
    if(isEdge.z){ dim.z += abs(center.z*expand-center.z)*2.0; center.z *= expand; }
  }
  vec3 edgeAxis = mix(dMin, dMax, step(0.0, rd));
  vec3 dAxis = abs(p - edgeAxis) / (abs(rd) + 1E-4);
  float dEdge = min(dAxis.x, min(dAxis.y, dAxis.z));
  b = dEdge;
  dim -= 0.4 * ((200.0 - uSize) / 100.0);
  // 4D 回転体: 各セルを w=0 スライスのテッセラクトとして描画。
  // 4D 回転で時間とともにスライスが変化し、立方体が断面で「うねりながら姿を変える」。
  float a;
  if(uSliceW != 0.0) a = wr_tesseract_slice(p - center, dim*0.5, t, uSliceW / 100.0) - 0.18 * (uCellRound / 100.0);
  else a = wr_tesseract_slice(p - center, dim*0.5, t, 0.0) - 0.18 * (uCellRound / 100.0);
  wr_nsdf = a;
  a = min(a, b);
  id = wr_h11(id)*1000.0;
  return vec2(a, id);
}

vec3 wr_map(vec3 p){
  float t = time;
  vec2 a = vec2(1);
  vec3 scl = vec3(15, 15, 15);
  vec3 rd2 = wr_rdg;
  float sc = uScale / 100.0;
  p /= sc;
  float ang0 = radians(uAngle);
  p.xz *= wr_rot(ang0); rd2.xz *= wr_rot(ang0);
  // 4次元: 3D 主回転(XY/YZ/XZ) + W 軸を仮想4次元として導入し、
  // XW/YW/ZW 回転で (x,w)/(y,w)/(z,w) を組み替え、最終的に w を z に投影。
  float ph1 = t*0.18;
  float ph2 = t*0.23 + 1.3;
  float ph3 = t*0.31 + 2.1;
  float ph4 = t*0.27 + 0.7;
  // 4次元目 W の初期値(時間で振動 + 位置依存で「視点の w 移動」感を出す)
  float w = sin(t*0.22) * 1.4 + cos(t*0.17 + length(p.xy)*0.08) * 0.6;
  // XW 回転: (x, w) → (x*c - w*s, x*s + w*c)
  float c, s;
  c = cos(ph1); s = sin(ph1);
  vec2 xw = vec2(p.x*c - w*s, p.x*s + w*c); p.x = xw.x; w = xw.y;
  // YW 回転
  c = cos(ph2); s = sin(ph2);
  vec2 yw = vec2(p.y*c - w*s, p.y*s + w*c); p.y = yw.x; w = yw.y;
  // ZW 回転
  c = cos(ph3); s = sin(ph3);
  vec2 zw = vec2(p.z*c - w*s, p.z*s + w*c); p.z = zw.x; w = zw.y;
  // W を Z 方向に射影(残り w が空間を歪ませる)
  p.z += w * 0.55 * (uWarp / 100.0);
  // 主 3D 回転(従来の自転)
  float rXY = t*0.5*WR_PI/3. + sin(ph4)*0.45;
  float rYZ = t*0.4*WR_PI/3. + cos(ph4)*0.45;
  float rXZ = sin(ph1 + ph3)*0.5;
  p.xy *= wr_rot(rXY); rd2.xy *= wr_rot(rXY);
  p.yz *= wr_rot(rYZ); rd2.yz *= wr_rot(rYZ);
  p.xz *= wr_rot(rXZ); rd2.xz *= wr_rot(rXZ);
  // スケール脈動(4D の w 由来)
  scl *= vec3(1.0 + sin(ph2)*0.15*(uStretchPulse / 100.0), 1.0 + cos(ph3)*0.15*(uStretchPulse / 100.0), 1.0 + sin(ph4)*0.15*(uStretchPulse / 100.0));
  a = wr_blocks(p, scl, rd2) + 0.01;
  a.x = max(wr_box(p, vec3(scl*1.4*(uCubeBound / 100.0))), a.x);
  return vec3(a.x * sc, a.y, wr_nsdf * sc);
}
vec3 wr_norm(vec3 p){
  vec2 e = vec2(0.01, 0.);
  return normalize(wr_map(p).x - vec3(wr_map(p-e.xyy).x, wr_map(p-e.yxy).x, wr_map(p-e.yyx).x));
}

#define WR_AO(a0,n,p) smoothstep(-(a0)*(uAoReach / 100.0), (a0)*(uAoReach / 100.0), wr_map(p + n*((a0)*(uAoReach / 100.0))).z)

vec3 bg_ravecube(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + (bgCamPx - vec2(uOffX, uOffY) * (0.01 * resolution.y));
  vec2 uv = (I - 0.5*resolution) / resolution.y;
  float t = time;
  vec3 col = vec3(0);
  vec3 ro = vec3(0, 11.5, -20) * 1.8;
  ro.xz *= wr_rot(-WR_PI/4. + t*0.18);          // 自動公転
  vec3 lk = vec3(0, 0., 0);
  vec3 f = normalize(lk - ro);
  vec3 r = normalize(cross(vec3(0,1,0), f));
  vec3 rd = normalize(f*(0.99) + uv.x*r + uv.y*cross(f, r));
  wr_rdg = rd;
  vec3 p = ro;
  float dO = 0.;
  vec3 d = vec3(0);
  bool hit = false;
  float nS = floor(uSteps + 0.5);
  for(float i = 0.; i < WR_STEPS; i++){
    if(i >= nS) break;
    p = ro + rd*dO;
    d = wr_map(p);
    dO += d.x*0.99;
    if(abs(d.x) < 0.0001 || i == nS - 1.){ hit = true; break; }
    if(d.x > WR_MDIST){ dO = WR_MDIST; break; }
  }
  if(hit){
    vec3 n = wr_norm(p);
    vec3 rr = reflect(rd, n);
    // クローム(鏡面反射)
    float env = 0.5 + 0.5*rr.y;
    if(uEnvShift != 0.0) env += uEnvShift / 100.0;
    vec3 chrome = mix(vec3(0.03, 0.035, 0.05), vec3(0.92, 0.94, 1.00), smoothstep(0.12, 0.88, env));
    if(uChromeColor != vec3(1.0)) chrome *= uChromeColor;
    chrome += pow(env, 8.0) * vec3(0.22);
    if(uStripeAmt != 0.0) chrome *= 1.0 - (uStripeAmt / 100.0) * (0.5 + 0.5*sin(atan(rr.z, rr.x)*6.0 + rr.y*3.0));
    float spec = pow(length(sin(rr*5.)*.5 + .5)/sqrt(3.), 6.0 * (uSpecSharp / 100.0));   // 鋭い反射ハイライト
    float fres = pow(1.0 - abs(dot(rd, n)), 4.0 * (uRimSharp / 100.0));
    if(uSpecColor != vec3(1.0) || uRimColor != vec3(1.0)) chrome += (spec * uSpecColor * 1.2 + fres * vec3(0.7, 0.75, 0.9) * uRimColor * 0.5) * (uGlow / 100.0);
    else chrome += (spec * vec3(1.0) * 1.2 + fres * vec3(0.7, 0.75, 0.9) * 0.5) * (uGlow / 100.0);
    float ao = WR_AO(0.3, n, p) * WR_AO(0.5, n, p) * WR_AO(0.9, n, p);
    col = chrome * pow(clamp(ao, 0.0, 1.0), 0.4);
    if(uAoPow != 100.0) col = chrome * pow(clamp(ao, 0.0, 1.0), 0.4*(uAoPow / 100.0));
    if(uAoColor != vec3(1.0)) col *= mix(uAoColor, vec3(1.0), pow(clamp(ao, 0.0, 1.0), 0.4));
    if(uSheen != 0.0) col *= 1.0 + (uSheen / 100.0) * (cos(6.2831853 * ((n.y*0.5 + 0.5 + n.x*0.25) + vec3(0.0, 0.33, 0.67))) * 0.5 - 0.1);
  }
  vec3 bg = mix(vec3(0.05, 0.055, 0.07), vec3(0.12, 0.13, 0.17), length(uv));
  if(uBgSpread != 100.0 || uBackColor != vec3(1.0)) bg = mix(vec3(0.05, 0.055, 0.07), vec3(0.12, 0.13, 0.17), length(uv)*(uBgSpread / 100.0)) * uBackColor;
  float fogK = dO/(WR_MDIST * (uFogDist / 100.0));
  if(uFogDist != 100.0) fogK = clamp(fogK, 0.0, 1.0);
  if(uFogCurve != 100.0) fogK = pow(clamp(fogK, 0.0, 1.0), uFogCurve / 100.0);
  col = mix(col, bg, fogK);
  if(uGrain != 0.0){
    float gn = fract(sin(dot(fc, vec2(12.9898, 78.233)) + time) * 43758.5453);
    col *= 1.0 + (gn - 0.5) * (uGrain / 100.0) * 1.2;
  }
  if(uVignette != 0.0) col *= 1.0 - (uVignette / 100.0) * smoothstep(0.2, 0.9, length(uv));
  return col;
}
