// =====================================================
// bg_discharge  (H52)
//   Source : Shadertoy "Discharge"  https://www.shadertoy.com/view/3tdcW4
//            Alex Kluchikov
//   黒背景に電撃状の白点を MIX(差の絶対値)で蓄積し、反転+急峻な pow で着色。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   cosineGradient(uCosGrad)対応。ヘルパは dc_ で名前空間化。
// =====================================================

vec3  dc_mix(vec3 x, vec3 y){ return abs(x - y); }
// @param uDetail   20..200 = 200.0
// @param uSize     50..320 = 100.0
// @param uContrast 25..400 = 100.0
// @param uSpread   30..300 = 100.0
// @param uAngle    -180..180 = 0.0
uniform float uDetail;     // 電撃の点の数 (下げると軽く、まばらになる)
uniform float uSize;       // 電撃の点ひとつの大きさ (%)
uniform float uContrast;   // 着色の鋭さ = pow の指数 (%)
uniform float uAngle;      // 全体の向き (度)
uniform float uSpread;     // 点の散らばり方 (%)

float dc_cv(vec3 c, vec2 uv){
  float size = 640.0 / resolution.x * 0.003 / (uSize / 100.0);
  float l = clamp(size * (length(c.xy - uv) - c.z), 0.0, 1.0);
  return 1.0 - l;
}

vec3 bg_discharge(vec2 fc){
  float rotA = radians(uAngle);
  vec2 I = mat2(cos(rotA), -sin(rotA), sin(rotA), cos(rotA)) * (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec3 O = vec3(0.0);
  for(int k=0; k<200; k++){
    if(k >= int(uDetail + 0.5)) break;
    float i = float(k) * 13.0;
    vec3 c = vec3(1.0);
    O = dc_mix(O, c * dc_cv(vec3(
      resolution.x * (1.0 + sin(time*0.52 + (i-1400.0)*1.35*(uSpread / 100.0))) * 0.5,
      resolution.y * (1.0 + sin(time*0.73 + (i-1200.0)*1.61*(uSpread / 100.0))) * 0.5,
      0.0), I));
  }
  O = (1.0 - O) * 1.01;
  O = pow(clamp(O, 0.0, 1.0), vec3(42.0, 32.0, 12.0) * (uContrast / 100.0));
  if(abs(uCosGrad) > 0.0001){
    float lum = dot(O, vec3(0.299, 0.587, 0.114));
    O = mix(O, cosGradColor(lum) * (0.2 + 1.4*lum), abs(uCosGrad));
  }
  bgAlpha = 1.0;
  return O;
}
