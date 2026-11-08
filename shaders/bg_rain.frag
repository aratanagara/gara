// =====================================================
// bg_rain
//   Source : Shadertoy "Rain Screen" https://www.shadertoy.com/view/4ljXDy
//   Author : Jakob Thomsen (2015)  License: CC BY-NC-SA 3.0
//   元は背景画像(iChannel0)を雨粒で屈折させる効果。ここでは背景画像を使わず、
//   雨粒の高さ場+法線を白黒でシェーディングしてテクスチャ用グレースケールに。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン対応。
//   ヘルパは rn_ で名前空間化。
// =====================================================
#define RN_PI 3.1415926
vec2 rn_hash(vec2 p){
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 18.5453);
}
// @param uLayerRatio 30..200  = 100.0
// @param uLayerGain  50..130  = 100.0
// @param uDropAspect 50..250  = 100.0
// @param uOrbit      0..200   = 100.0
// @param uOrbitPhase 0..200   = 100.0
// @param uSlant      -100..100 = 0.0
// @param uCore       0..30    = 0.0
// @param uBulge      30..300  = 100.0
// @param uSpecSharp  20..400  = 100.0
// @param uSpecAmt    0..300   = 100.0
// @param uLightAngle -180..180 = 0.0
uniform float uLayerRatio; // 層ごとの粒の細かさの増え方 (%)。下げると各層が似た大きさになる
uniform float uLayerGain;  // 層ごとの寄与の増減 (%)。上げると細かい層が強く、下げると粗い層が主役
uniform float uDropAspect; // 粒の縦横比 (%)。上げると縦に潰れた横長の粒、下げると縦に伸びた粒
uniform float uOrbit;      // 粒がセル内で揺れる半径 (%)。0 で動かない
uniform float uOrbitPhase; // 揺れの軌道の形 (%)。0 で直線往復、100 で円
uniform float uSlant;      // 雨粒の傾き (%)。負で逆向き
uniform float uCore;       // 粒の中心の平らな部分 (%)。0 = なし
uniform float uBulge;      // 粒の盛り上がり (%)。下げると斜面が急で縁が強く光る
uniform float uSpecSharp;  // ハイライトの鋭さ (%)
uniform float uSpecAmt;    // ハイライトの量 (%)
uniform float uLightAngle; // 光の向き (度)
// @param uRotate      -180..180 = 0
// @param uMeander     0..100    = 0
// @param uShiftX      -100..100 = 0
// @param uShiftY      -100..100 = 0
// @param uLightHeight 30..300   = 100
// @param uDiffAmt     0..300    = 100
// @param uBodyAmt     0..200    = 100
// @param uRimLight    0..120    = 0
// @param uGrain       0..100    = 0
// @param uGlassTint   color = #ffffff
// @param uDropTint    color = #ffffff
// @param uSpecTint    color = #ffffff
// @param uRimTint     color = #ffffff
uniform float uRotate;      // 雨粒の流れる向きの回転 (度)。0 = 真下
uniform float uMeander;     // 流れの蛇行の振れ幅 (%)。0 = まっすぐ
uniform float uShiftX;      // 雨粒の配置の横ずれ (%)。別の並びにする
uniform float uShiftY;      // 雨粒の配置の縦ずれ (%)。別の並びにする
uniform float uLightHeight; // 光源の高さ (%)。下げると斜めから当たり陰影が強く、上げると正面から
uniform float uDiffAmt;     // 粒の陰影 (拡散光) の強さ (%)
uniform float uBodyAmt;     // 粒そのものの明るさ (%)。ガラス地との差が変わる
uniform float uRimLight;    // 粒の縁の光 (%)。0 = なし
uniform float uGrain;       // ガラスのざらつき (%)。0 = なし
uniform vec3  uGlassTint;   // ガラス地の色
uniform vec3  uDropTint;    // 粒の色
uniform vec3  uSpecTint;    // ハイライトの色
uniform vec3  uRimTint;     // 縁の光の色
float rn_grid_noise(float t, vec2 v){
  vec2 fl = floor(v), fr = fract(v);
  float mindist = 1e9;
  for(int y = -1; y <= 1; y++)
  for(int x = -1; x <= 1; x++){
    vec2 offset = vec2(x, y);
    vec2 pos = 0.5 + (0.5 * (uOrbit / 100.0)) * cos(2. * RN_PI * (t*0.1 + rn_hash(fl + offset)) + vec2(0, 1.6 * (uOrbitPhase / 100.0)));
    mindist = min(mindist, length(pos + offset - fr));
  }
  if(uCore != 0.0) mindist = max(mindist - uCore / 100.0 * 0.5, 0.0);
  return mindist;
}
// @param uDensity 30..300 = 100.0
// @param uDetail  1..3 = 3.0
// @param uSharp   30..400 = 100.0
// @param uSize    40..300 = 100.0
uniform float uDensity; // 雨粒の密度 (%)
uniform float uDetail; // 粒の層の数 (下げると軽く、まばらになる)
uniform float uSharp; // 粒の縁のくっきり度 (%)
uniform float uSize; // 雨粒の大きさ (%)

float rn_blob_noises(float t, vec2 p, float s){
  float h = 0.0;
  const float n = 3.0;
  float nl = floor(uDetail + 0.5);
  for(float i = 0.0; i < n; i++){
    if(i >= nl) break;
    vec2 q = vec2(0.0, t * (i + 1.0) / n) + p;
    h += pow(uLayerGain / 100.0, i) * pow(0.5 + 0.5 * cos(RN_PI * clamp(rn_grid_noise(t, q * (1.0 + i * (uLayerRatio / 100.0))) * 2.0 / (uSize / 100.0), 0.0, 1.0)), s);
  }
  return h / nl;
}
vec3 rn_blob_normal(float t, vec2 p, float s){
  float d = 0.01;
  return normalize(vec3(
    rn_blob_noises(t, p + vec2( d, 0), s) - rn_blob_noises(t, p + vec2(-d, 0), s),
    rn_blob_noises(t, p + vec2(0,  d), s) - rn_blob_noises(t, p + vec2(0, -d), s),
    d * (uBulge / 100.0)));
}
vec3 bg_rain(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 r = vec2(1.0, resolution.y / resolution.x);
  vec2 p = I / resolution.xy;
  vec2 v = 25.0 * (uDensity / 100.0) * p * r;

  v.y *= uDropAspect / 100.0;
  if(uSlant != 0.0) v.x += v.y * uSlant / 100.0;
  if(uMeander != 0.0) v.x += sin(v.y * 0.6) * uMeander / 100.0 * 1.5;
  if(uRotate != 0.0){ float ra = radians(uRotate); float cr = cos(ra), sr = sin(ra); v = mat2(cr, -sr, sr, cr) * v; }
  if(uShiftX != 0.0 || uShiftY != 0.0) v += vec2(uShiftX, uShiftY) / 100.0 * 5.0;

  float h = rn_blob_noises(time, v, uSharp / 100.0);     // 雨粒の高さ場 (0..1)
  vec3  n = rn_blob_normal(time, v, uSharp / 100.0);     // その法線

  // 白黒の雨粒: 暗いガラス背景 + 粒の陰影 + スペキュラのきらめき
  vec3  L    = normalize(vec3(0.5, 0.6, 0.6 * (uLightHeight / 100.0)));
  if(uLightAngle != 0.0){ float la = radians(uLightAngle); float cl = cos(la), sl = sin(la); L.xy = mat2(cl, -sl, sl, cl) * L.xy; }
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 24.0 * (uSpecSharp / 100.0));
  vec3 g = 0.08 * uGlassTint + 0.55*h*(uBodyAmt / 100.0) * uDropTint + 0.40*diff*h*(uDiffAmt / 100.0) + spec*0.9*(uSpecAmt / 100.0) * uSpecTint;
  if(uRimLight != 0.0) g += pow(1.0 - clamp(n.z, 0.0, 1.0), 3.0) * uRimLight / 100.0 * 0.6 * uRimTint;
  if(uGrain != 0.0) g += (rn_hash(fc).x - 0.5) * uGrain / 100.0 * 0.15;
  return clamp(g, 0.0, 1.0);
}
