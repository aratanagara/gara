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
// @param uSpanX 20..150 = 100
// @param uSpanY 20..150 = 100
// @param uDiscR 0..60 = 0
// @param uSquash -80..80 = 0
// @param uPhaseRatioX 50..200 = 100
// @param uPhaseRatio 50..200 = 100
// @param uEdge -60..150 = 0
// @param uPowRed 40..250 = 100
// @param uPowBlue 40..250 = 100
uniform float uSpanX;      // 点が動き回る横幅 (%)
uniform float uSpanY;      // 点が動き回る縦幅 (%)
uniform float uDiscR;      // 点を塗りつぶす円の半径 (px 相当)。0 = 点のまま
uniform float uSquash;     // 点の縦横比のつぶし (%)。0 = 円 / 負で縦長
uniform float uPhaseRatioX; // 横方向の位相の進み方 (%)。縦との比で軌跡の形が変わる
uniform float uPhaseRatio; // 縦方向の位相の進み方 (%)。横との比で軌跡の形が変わる
uniform float uEdge;       // 点の縁の硬さ (%)。0 = 従来 / 上げるとシャープ
uniform float uPowRed;     // 赤チャンネルの鋭さ (%)
uniform float uPowBlue;    // 青チャンネルの鋭さ (%)

float dc_cv0(vec3 c, vec2 uv){
  float size = 640.0 / resolution.x * 0.003 / (uSize / 100.0);
  float l = clamp(size * (length(c.xy - uv) - c.z), 0.0, 1.0);
  return 1.0 - l;
}

float dc_cv(vec3 c, vec2 uv){
  float size = 640.0 / resolution.x * 0.003 / (uSize / 100.0);
  vec2 dv = c.xy - uv;
  if(uSquash != 0.0) dv.y *= 1.0 + uSquash / 100.0;
  float l = clamp(size * (length(dv) - c.z), 0.0, 1.0);
  if(uEdge != 0.0) l = pow(l, 1.0 + uEdge / 100.0);
  return 1.0 - l;
}

vec3 bg_discharge(vec2 fc){
  float rotA = radians(uAngle);
  vec2 I = mat2(cos(rotA), -sin(rotA), sin(rotA), cos(rotA)) * (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec3 O = vec3(0.0);
  if(uSpanX != 100.0 || uSpanY != 100.0 || uDiscR != 0.0 || uSquash != 0.0 || uPhaseRatioX != 100.0 || uPhaseRatio != 100.0 || uEdge != 0.0){
    for(int k=0; k<200; k++){
      if(k >= int(uDetail + 0.5)) break;
      float i = float(k) * 13.0;
      vec3 c = vec3(1.0);
      O = dc_mix(O, c * dc_cv(vec3(
        resolution.x * (1.0 + sin(time*0.52 + (i-1400.0)*1.35*(uSpread / 100.0)*(uPhaseRatioX / 100.0)) * (uSpanX / 100.0)) * 0.5,
        resolution.y * (1.0 + sin(time*0.73 + (i-1200.0)*1.61*(uSpread / 100.0)*(uPhaseRatio / 100.0)) * (uSpanY / 100.0)) * 0.5,
        uDiscR * resolution.y / 1000.0), I));
    }
  } else {
    for(int k=0; k<200; k++){
      if(k >= int(uDetail + 0.5)) break;
      float i = float(k) * 13.0;
      vec3 c = vec3(1.0);
      O = dc_mix(O, c * dc_cv0(vec3(
        resolution.x * (1.0 + sin(time*0.52 + (i-1400.0)*1.35*(uSpread / 100.0))) * 0.5,
        resolution.y * (1.0 + sin(time*0.73 + (i-1200.0)*1.61*(uSpread / 100.0))) * 0.5,
        0.0), I));
    }
  }
  O = (1.0 - O) * 1.01;
  O = pow(clamp(O, 0.0, 1.0), vec3(42.0 * (uPowRed / 100.0), 32.0, 12.0 * (uPowBlue / 100.0)) * (uContrast / 100.0));
  if(abs(uCosGrad) > 0.0001){
    float lum = dot(O, vec3(0.299, 0.587, 0.114));
    O = mix(O, cosGradColor(lum) * (0.2 + 1.4*lum), abs(uCosGrad));
  }
  bgAlpha = 1.0;
  return O;
}
