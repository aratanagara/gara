// =====================================================
// bg_liquid
//   Source : Shadertoy "- liquid -" https://www.shadertoy.com/view/ftd3zX
//   Author : anahit_movsesyan
//   vj ツールの bg 形式に適合 (mainImage → bg 関数 / iTime,iResolution → time,resolution
//   / bgZoom・bgCamPx でズーム/パン対応)。ヘルパは lq_ で名前空間化し衝突回避。
// =====================================================
float lq_rand(vec2 p){
  return fract(sin(dot(p, vec2(12.99, 78.233))) * 43758.545);
}
float lq_noise(vec2 p){
  vec2 f = fract(p);
  f = f * f * f * f * (3.0 - 2.0 * f) * (3.0 - 2.0 * f);
  vec2 i = floor(p);
  return mix(mix(lq_rand(i + vec2(0, 0)), lq_rand(i + vec2(1, 0)), f.x),
             mix(lq_rand(i + vec2(0, 1)), lq_rand(i + vec2(1, 1)), f.x), f.y);
}
float lq_fbm(vec2 p){
  float v = 0.0;
  float a = 1.0;
  for(int i = 0; i < 4; ++i){
    p = 1.5 * p + 15.0;
    a *= 0.5;
    v += a * lq_noise(p);
  }
  return v;
}
vec3 bg_liquid(vec2 fc){
  // ズーム/パン: 中心基準でスケールしてからパン
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 p = 2.0 * I / resolution.y;
  float t = time * 2.0;   // 2倍速

  vec2 r1 = vec2(lq_fbm(p + 0.02 * t),  lq_fbm(p + 0.005 * t));
  vec2 r2 = vec2(lq_fbm(p + 0.15 * t + 10.0 * r1),
                 lq_fbm(p + 0.12 * t + 12.0 * r1));
  float v = 1.8 * pow(lq_fbm(p + r2), 2.0) + 0.03;
  return vec3(v);
}
