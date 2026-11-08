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

  float h = rn_blob_noises(time, v, uSharp / 100.0);     // 雨粒の高さ場 (0..1)
  vec3  n = rn_blob_normal(time, v, uSharp / 100.0);     // その法線

  // 白黒の雨粒: 暗いガラス背景 + 粒の陰影 + スペキュラのきらめき
  vec3  L    = normalize(vec3(0.5, 0.6, 0.6));
  if(uLightAngle != 0.0){ float la = radians(uLightAngle); float cl = cos(la), sl = sin(la); L.xy = mat2(cl, -sl, sl, cl) * L.xy; }
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 24.0 * (uSpecSharp / 100.0));
  float g = 0.08 + 0.55*h + 0.40*diff*h + spec*0.9*(uSpecAmt / 100.0);
  return vec3(clamp(g, 0.0, 1.0));
}
