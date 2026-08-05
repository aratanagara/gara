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
  return wr_tesseract4(p4, vec4(b, bw));
}

vec3  wr_rdg = vec3(0);
float wr_nsdf = 0.;

vec2 wr_blocks(vec3 p, vec3 scl, vec3 rd){
  float t = time;
  bvec3 isEdge = bvec3(true);
  vec3 dMin = vec3(-0.5) * scl;
  vec3 dMax = vec3(0.5) * scl;
  vec3 dMini = dMin;
  vec3 dMaxi = dMax;
  float id = 0.;
  float ITERS = 5.;
  vec3 dim = dMax - dMin;
  for(float i = 0.; i < ITERS; i++){
    vec3 divHash = vec3(0.49, 0.501, 0.511);
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
    float expand = 1.05 + 0.45*(sin(length(center+100.0)*0.35 + t*3.0*WR_PI/3.)*0.5 + 0.5);
    if(isEdge.x){ dim.x += abs(center.x*expand-center.x)*2.0; center.x *= expand; }
    if(isEdge.y){ dim.y += abs(center.y*expand-center.y)*2.0; center.y *= expand; }
    if(isEdge.z){ dim.z += abs(center.z*expand-center.z)*2.0; center.z *= expand; }
  }
  vec3 edgeAxis = mix(dMin, dMax, step(0.0, rd));
  vec3 dAxis = abs(p - edgeAxis) / (abs(rd) + 1E-4);
  float dEdge = min(dAxis.x, min(dAxis.y, dAxis.z));
  b = dEdge;
  dim -= 0.4;
  // 4D 回転体: 各セルを w=0 スライスのテッセラクトとして描画。
  // 4D 回転で時間とともにスライスが変化し、立方体が断面で「うねりながら姿を変える」。
  float a = wr_tesseract_slice(p - center, dim*0.5, t, 0.0) - 0.18;
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
  p.z += w * 0.55;
  // 主 3D 回転(従来の自転)
  float rXY = t*0.5*WR_PI/3. + sin(ph4)*0.45;
  float rYZ = t*0.4*WR_PI/3. + cos(ph4)*0.45;
  float rXZ = sin(ph1 + ph3)*0.5;
  p.xy *= wr_rot(rXY); rd2.xy *= wr_rot(rXY);
  p.yz *= wr_rot(rYZ); rd2.yz *= wr_rot(rYZ);
  p.xz *= wr_rot(rXZ); rd2.xz *= wr_rot(rXZ);
  // スケール脈動(4D の w 由来)
  scl *= vec3(1.0 + sin(ph2)*0.15, 1.0 + cos(ph3)*0.15, 1.0 + sin(ph4)*0.15);
  a = wr_blocks(p, scl, rd2) + 0.01;
  a.x = max(wr_box(p, vec3(scl*1.4)), a.x);
  return vec3(a, wr_nsdf);
}
vec3 wr_norm(vec3 p){
  vec2 e = vec2(0.01, 0.);
  return normalize(wr_map(p).x - vec3(wr_map(p-e.xyy).x, wr_map(p-e.yxy).x, wr_map(p-e.yyx).x));
}

#define WR_AO(a,n,p) smoothstep(-a, a, wr_map(p + n*a).z)

vec3 bg_ravecube(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
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
  for(float i = 0.; i < WR_STEPS; i++){
    p = ro + rd*dO;
    d = wr_map(p);
    dO += d.x*0.99;
    if(abs(d.x) < 0.0001 || i == WR_STEPS-1.){ hit = true; break; }
    if(d.x > WR_MDIST){ dO = WR_MDIST; break; }
  }
  if(hit){
    vec3 n = wr_norm(p);
    vec3 rr = reflect(rd, n);
    // クローム(鏡面反射)
    float env = 0.5 + 0.5*rr.y;
    vec3 chrome = mix(vec3(0.03, 0.035, 0.05), vec3(0.92, 0.94, 1.00), smoothstep(0.12, 0.88, env));
    chrome += pow(env, 8.0) * vec3(0.22);
    float spec = pow(length(sin(rr*5.)*.5 + .5)/sqrt(3.), 6.0);   // 鋭い反射ハイライト
    float fres = pow(1.0 - abs(dot(rd, n)), 4.0);
    chrome += spec * vec3(1.0) * 1.2 + fres * vec3(0.7, 0.75, 0.9) * 0.5;
    float ao = WR_AO(0.3, n, p) * WR_AO(0.5, n, p) * WR_AO(0.9, n, p);
    col = chrome * pow(clamp(ao, 0.0, 1.0), 0.4);
  }
  vec3 bg = mix(vec3(0.05, 0.055, 0.07), vec3(0.12, 0.13, 0.17), length(uv));
  col = mix(col, bg, dO/WR_MDIST);
  return col;
}
