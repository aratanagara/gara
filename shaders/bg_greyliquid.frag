// =====================================================
// bg_greyliquid  (H41)
//   Source : Shadertoy "grey liquid" https://www.shadertoy.com/view/fsdyzf
//            (CC0: Liquid Metal by mrange)。warped FBM + フェイク照明の液体金属。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは lq_ で名前空間化(fbm1/2/3 はオクターブ引数で1関数に共通化)。
// =====================================================

#define LQ_PI  3.141592654
#define LQ_TAU (2.0*LQ_PI)

void lq_rot(inout vec2 p, float a){
  float c = cos(a), s = sin(a);
  p = vec2(c*p.x + s*p.y, -s*p.x + c*p.y);
}
float lq_hash(vec2 co){ return fract(sin(dot(co.xy, vec2(12.9898,58.233))) * 13758.5453); }
float lq_psin(float a){ return 0.5 + 0.5*sin(a); }
float lq_tanh(float x){ float x2 = x*x; return clamp(x*(27.0 + x2)/(27.0 + 9.0*x2), -1.0, 1.0); }
float lq_onoise(vec2 x){
  x *= 0.5;
  float a = sin(x.x), b = sin(x.y);
  return mix(a, b, lq_psin(LQ_TAU*lq_tanh(a*b + a + b)));
}
float lq_vnoise(vec2 x){
  vec2 i = floor(x), w = fract(x);
  vec2 u = w*w*w*(w*(w*6.0 - 15.0) + 10.0);
  float a = lq_hash(i+vec2(0,0)), b = lq_hash(i+vec2(1,0));
  float c = lq_hash(i+vec2(0,1)), d = lq_hash(i+vec2(1,1));
  float k0 = a, k1 = b - a, k2 = c - a, k3 = d - c + a - b;
  return k0 + k1*u.x + k2*u.y + k3*u.x*u.y;
}
// @param uLacunarity 85..125 = 100
// @param uOctGain 60..160 = 100
// @param uOctTwist 25..200 = 100
// @param uBlotch 25..300 = 100
// @param uBlotchScale 25..300 = 100
// @param uCrease 30..300 = 100
uniform float uLacunarity; // オクターブごとの周波数の伸び (%)
uniform float uOctGain;    // オクターブごとの振幅の残り方 (%)
uniform float uOctTwist;   // オクターブごとの回転量 (%)
uniform float uBlotch;     // まだら (反転する斑) の出方 (%)
uniform float uBlotchScale; // まだらの大きさの細かさ (%)
uniform float uCrease;     // 起伏の折れ目の鋭さ (%)
float lq_fbm(vec2 p, int oct){
  vec2 op = p;
  float aa = 0.45 * (uOctGain / 100.0), pp = 2.03 * (uLacunarity / 100.0), rr = 1.2 * (uOctTwist / 100.0);
  const vec2 oo = -vec2(1.23, 1.5);
  float h = 0.0, d = 0.0, a = 1.0;
  for(int i=0; i<7; i++){
    if(i >= oct) break;
    h += a*lq_onoise(p);
    d += a; a *= aa; p += oo; p *= pp; lq_rot(p, rr);
  }
  return mix((h/d), -0.5*(h/d), pow(lq_vnoise(0.9*(uBlotchScale / 100.0)*op), 0.25*(uBlotch / 100.0)));
}
// @param uDetail  2..7 = 7.0
// @param uWarp    0..300 = 100.0
// @param uRelief  20..300 = 100.0
// @param uDensity 25..300 = 100.0
// @param uGlow    0..300 = 100
// @param uRimWidth 25..300 = 100
// @param uRimReach 25..300 = 100
// @param uLightSpread 40..200 = 100.0
// @param uRotate -180..180 = 0
// @param uCenterX -100..100 = 0
// @param uCenterY -100..100 = 0
// @param uMirror -100..100 = 0
// @param uStretchX 40..250 = 100
// @param uLightHeight 25..300 = 100
// @param uLightDepth -100..100 = 0
// @param uKeyLight 30..300 = 100
// @param uFillLight 0..400 = 100
// @param uDiffSharp 25..200 = 100
// @param uNormalReach 30..400 = 100
// @param uContour 0..100 = 0
// @param uVignette 0..100 = 0
// @param uFilmGrain 0..100 = 0
// @param uKeyColor color = #ffffff
// @param uFillColor color = #ffffff
// @param uRimColor color = #ffffff
uniform float uDetail; // ワープ層のオクターブ数 (下げると軽く、模様が粗くなる)
uniform float uWarp; // 歪みの強さ (%)
uniform float uRelief; // 表面の起伏の深さ (%)
uniform float uDensity; // 模様の細かさ (%)
uniform float uGlow; // 縁のハイライトの強さ (%)
uniform float uRimWidth; // 縁のハイライトの幅 (%)
uniform float uRimReach; // 縁のハイライトが光源側へ伸びる距離 (%)
uniform float uLightSpread; // 左右の光源の開き (%)
uniform float uRotate; // 絵全体 (光源ごと) の回転角 (度)
uniform float uCenterX; // 模様の中心の横位置 (%)
uniform float uCenterY; // 模様の中心の縦位置 (%)
uniform float uMirror; // 左右対称の折り返し位置 (%)。+ で左側を、- で右側を折り返す。0 で無効
uniform float uStretchX; // 模様の横の伸び縮み (%)
uniform float uLightHeight; // 光源の面からの高さ (%)。小さいと寝かせて当てる
uniform float uLightDepth; // 光源の奥行き位置 (%)
uniform float uKeyLight; // 右の光源 (メイン) の強さ (%)
uniform float uFillLight; // 左の光源 (補助) の強さ (%)
uniform float uDiffSharp; // 光の当たり方の締まり (%)。大きいと光の面が狭い
uniform float uNormalReach; // 凹凸の読み取り幅 (%)。大きいと細かい起伏がならされる
uniform float uContour; // 等高線の濃さ (%)
uniform float uVignette; // 周辺の暗がり (%)
uniform float uFilmGrain; // ざらつき (%)
uniform vec3 uKeyColor; // 右の光源の色味 (掛け算)
uniform vec3 uFillColor; // 左の光源の色味 (掛け算)
uniform vec3 uRimColor; // 縁のハイライトの色味 (掛け算)

float lq_warp(vec2 p){
  vec2 v = vec2(lq_fbm(p, 5), lq_fbm(p + 0.7*vec2(1.0,1.0), 5));
  lq_rot(v, 1.0 + time*1.8);
  vec2 vv = vec2(lq_fbm(p + 3.7*(uWarp / 100.0)*v, int(uDetail + 0.5)), lq_fbm(p - 2.7*(uWarp / 100.0)*v.yx + 0.7*vec2(1.0,1.0), int(uDetail + 0.5)));
  lq_rot(vv, -1.0 + time*0.8);
  return lq_fbm(p + 9.0*(uWarp / 100.0)*vv, 3);
}
float lq_height(vec2 p){
  float a = 0.045*time;
  p += 9.0*vec2(cos(a), sin(a));
  p *= 2.0 * (uDensity / 100.0); p += 13.0;
  return 0.35*(uRelief / 100.0)*lq_tanh(3.0*(uCrease / 100.0)*lq_warp(p))/3.0;
}
vec3 lq_normal(vec2 p){
  vec2 eps = -vec2(2.0/resolution.y * (uNormalReach / 100.0), 0.0);
  vec3 n;
  n.x = lq_height(p + eps.xy) - lq_height(p - eps.xy);
  n.y = 2.0*eps.x;
  n.z = lq_height(p + eps.yx) - lq_height(p - eps.yx);
  return normalize(n);
}

vec3 bg_greyliquid(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 q = I / resolution.xy;
  vec2 p = -1.0 + 2.0*q;
  p.x *= resolution.x / resolution.y;
  vec2 pScr = p;
  if(uStretchX != 100.0){ p.x *= uStretchX / 100.0; }
  if(uMirror != 0.0){ p.x = (uMirror > 0.0 ? 1.0 : -1.0) * abs(p.x - uMirror * 0.008) + uMirror * 0.008; }
  if(uRotate != 0.0){ float ra = radians(uRotate); float rc = cos(ra), rs = sin(ra); p = vec2(rc*p.x - rs*p.y, rs*p.x + rc*p.y); }
  if(uCenterX != 0.0 || uCenterY != 0.0){ p += vec2(uCenterX, uCenterY) * 0.02; }

  vec3 lp1 = vec3(2.1 * (uLightSpread / 100.0), -0.5 * (uLightHeight / 100.0), -0.1 + uLightDepth * 0.01);
  vec3 lp2 = vec3(-2.1 * (uLightSpread / 100.0), -0.5 * (uLightHeight / 100.0), -0.1 + uLightDepth * 0.01);
  float h = lq_height(p);
  vec3 pp = vec3(p.x, h, p.y);
  float ll1 = length(lp1.xz - pp.xz);
  vec3 ld1 = normalize(lp1 - pp);
  vec3 ld2 = normalize(lp2 - pp);
  vec3 n = lq_normal(p);
  float diff1 = max(dot(ld1, n), 0.0);
  float diff2 = max(dot(ld2, n), 0.0);
  if(uDiffSharp != 100.0){ diff1 = pow(diff1, uDiffSharp / 100.0); diff2 = pow(diff2, uDiffSharp / 100.0); }
  vec3 baseCol1 = vec3(0.5, 0.4, 0.4);
  vec3 baseCol2 = vec3(0.1, 0.1, 0.1);
  float oh = lq_height(p + ll1*(0.05 * (uRimReach / 100.0))*normalize(ld1.xz));
  float level0 = 0.0, level1 = 0.125 * (uRimWidth / 100.0);
  vec3 scol1 = baseCol1*(smoothstep(level0, level1, h) - smoothstep(level0, level1, oh));
  vec3 scol2 = baseCol2*(smoothstep(level0, level1, h) - smoothstep(level0, level1, oh));
  vec3 col = vec3(0.0);
  col += 1.1*baseCol1.zyx*diff1*(uKeyLight / 100.0)*uKeyColor;     // 元は 0.55 を2回加算(同値をまとめ)
  col += 1.1*baseCol2.zyx*diff2*(uFillLight / 100.0)*uFillColor;
  col += scol1*0.5*(uGlow / 100.0)*uRimColor;
  col += scol2*0.5*(uGlow / 100.0)*uRimColor;
  if(uContour != 0.0){ float ct = abs(fract(h * 45.0) - 0.5) * 2.0; col += vec3(0.45, 0.50, 0.70) * (uContour / 100.0) * (1.0 - smoothstep(0.0, 0.2, ct)); }
  if(uVignette != 0.0){ col *= 1.0 - (uVignette / 100.0) * smoothstep(0.6, 2.2, length(pScr)); }
  if(uFilmGrain != 0.0){ col += (fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * (uFilmGrain / 100.0) * 0.2; }
  return col;
}
