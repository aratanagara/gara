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
float rn_grid_noise(float t, vec2 v){
  vec2 fl = floor(v), fr = fract(v);
  float mindist = 1e9;
  for(int y = -1; y <= 1; y++)
  for(int x = -1; x <= 1; x++){
    vec2 offset = vec2(x, y);
    vec2 pos = 0.5 + 0.5 * cos(2. * RN_PI * (t*0.1 + rn_hash(fl + offset)) + vec2(0, 1.6));
    mindist = min(mindist, length(pos + offset - fr));
  }
  return mindist;
}
float rn_blob_noises(float t, vec2 p, float s){
  float h = 0.0;
  const float n = 3.0;
  for(float i = 0.0; i < n; i++){
    vec2 q = vec2(0.0, t * (i + 1.0) / n) + p;
    h += pow(0.5 + 0.5 * cos(RN_PI * clamp(rn_grid_noise(t, q * (i + 1.0)) * 2.0, 0.0, 1.0)), s);
  }
  return h / n;
}
vec3 rn_blob_normal(float t, vec2 p, float s){
  float d = 0.01;
  return normalize(vec3(
    rn_blob_noises(t, p + vec2( d, 0), s) - rn_blob_noises(t, p + vec2(-d, 0), s),
    rn_blob_noises(t, p + vec2(0,  d), s) - rn_blob_noises(t, p + vec2(0, -d), s),
    d));
}
vec3 bg_rain(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 r = vec2(1.0, resolution.y / resolution.x);
  vec2 p = I / resolution.xy;
  vec2 v = 25.0 * p * r;

  float h = rn_blob_noises(time, v, 1.0);     // 雨粒の高さ場 (0..1)
  vec3  n = rn_blob_normal(time, v, 1.0);     // その法線

  // 白黒の雨粒: 暗いガラス背景 + 粒の陰影 + スペキュラのきらめき
  vec3  L    = normalize(vec3(0.5, 0.6, 0.6));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 24.0);
  float g = 0.08 + 0.55*h + 0.40*diff*h + spec*0.9;
  return vec3(clamp(g, 0.0, 1.0));
}
