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
// @param uPowGreen 40..250 = 100
// @param uCenterX -100..100 = 0
// @param uCenterY -100..100 = 0
// @param uShear -100..100 = 0
// @param uRipple 0..100 = 0
// @param uSizeTaper -25..60 = 0
// @param uDiscScatter 0..60 = 0
// @param uDropout 0..80 = 0
// @param uVignette 0..100 = 0
// @param uGrainAmount 0..100 = 0
// @param uBoltColor color = #ffffff
// @param uVoidColor color = #000000
uniform float uPowGreen;   // 緑チャンネルの鋭さ (%)
uniform float uCenterX;    // 点が動き回る中心の横位置 (%)
uniform float uCenterY;    // 点が動き回る中心の縦位置 (%)
uniform float uShear;      // 画面の横ずれ (斜めに流す) (%)
uniform float uRipple;     // 画面を波打たせる振れ幅 (%)
uniform float uSizeTaper;  // 点の大きさの勾配 (%)。正で後ろの点ほど小さく、負で逆
uniform float uDiscScatter; // 一部の点だけ塗りつぶす円の半径のばらつき (px 相当)
uniform float uDropout;    // 点を間引く割合 (%)
uniform float uVignette;   // 四隅の減光 (%)
uniform float uGrainAmount; // 画面のざらつき (%)
uniform vec3 uBoltColor;   // 電撃のティント
uniform vec3 uVoidColor;   // 闇の色 (暗い部分に足す)

float dc_cv0(vec3 c, vec2 uv){
  float size = 640.0 / resolution.x * 0.003 / (uSize / 100.0);
  float l = clamp(size * (length(c.xy - uv) - c.z), 0.0, 1.0);
  return 1.0 - l;
}

float dc_cv(vec3 c, vec2 uv, float sk){
  float size = 640.0 / resolution.x * 0.003 / (uSize / 100.0) * sk;
  vec2 dv = c.xy - uv;
  if(uSquash != 0.0) dv.y *= 1.0 + uSquash / 100.0;
  float l = clamp(size * (length(dv) - c.z), 0.0, 1.0);
  if(uEdge != 0.0) l = pow(l, 1.0 + uEdge / 100.0);
  return 1.0 - l;
}

vec3 bg_discharge(vec2 fc){
  float rotA = radians(uAngle);
  vec2 I = mat2(cos(rotA), -sin(rotA), sin(rotA), cos(rotA)) * (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  if(uShear != 0.0) I.x += (I.y - 0.5 * resolution.y) * (uShear / 100.0);
  if(uRipple != 0.0){
    float rf = 6.2831 * 3.0 / resolution.y;
    I.x += sin(I.y * rf + time * 0.6) * (uRipple / 100.0) * 0.08 * resolution.y;
  }
  vec3 O = vec3(0.0);
  if(uSpanX != 100.0 || uSpanY != 100.0 || uDiscR != 0.0 || uSquash != 0.0 || uPhaseRatioX != 100.0 || uPhaseRatio != 100.0 || uEdge != 0.0 || uCenterX != 0.0 || uCenterY != 0.0 || uSizeTaper != 0.0 || uDiscScatter != 0.0 || uDropout != 0.0){
    vec2 ctr = vec2(uCenterX, uCenterY) * 0.005 * resolution;
    float kx = (uSpread / 100.0) * (uPhaseRatioX / 100.0) * 1.35;
    float ky = (uSpread / 100.0) * (uPhaseRatio / 100.0) * 1.61;
    float spx = uSpanX / 100.0, spy = uSpanY / 100.0;
    float skS = uSizeTaper / 100.0;
    float drs = resolution.y / 1000.0;
    int nDet = int(uDetail + 0.5);
    for(int k=0; k<200; k++){
      if(k >= nDet) break;
      float i = float(k) * 13.0;
      if(uDropout != 0.0 && fract(sin(float(k) * 91.7 + 3.1) * 43758.5453) * 100.0 < uDropout) continue;
      vec3 c = vec3(1.0);
      float sk = 1.0 + skS * (float(k) / 100.0 - 1.0);
      float dr = uDiscR;
      if(uDiscScatter != 0.0) dr += uDiscScatter * (0.5 + 0.5 * sin(i * 0.77));
      O = dc_mix(O, c * dc_cv(vec3(
        resolution.x * (1.0 + sin(time*0.52 + (i-1400.0)*kx) * spx) * 0.5 + ctr.x,
        resolution.y * (1.0 + sin(time*0.73 + (i-1200.0)*ky) * spy) * 0.5 + ctr.y,
        dr * drs), I, sk));
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
  O = pow(clamp(O, 0.0, 1.0), vec3(42.0 * (uPowRed / 100.0), 32.0 * (uPowGreen / 100.0), 12.0 * (uPowBlue / 100.0)) * (uContrast / 100.0));
  if(abs(uCosGrad) > 0.0001){
    float lum = dot(O, vec3(0.299, 0.587, 0.114));
    O = mix(O, cosGradColor(lum) * (0.2 + 1.4*lum), abs(uCosGrad));
  }
  O *= uBoltColor;
  O += uVoidColor;
  if(uVignette != 0.0){
    vec2 vq = (fc / resolution - 0.5) * 2.0;
    O *= 1.0 - uVignette / 100.0 * smoothstep(0.4, 1.6, length(vq));
  }
  if(uGrainAmount != 0.0) O = clamp(O + (fract(sin(dot(fc + fract(time), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * uGrainAmount * 0.01, 0.0, 1.0);
  bgAlpha = 1.0;
  return O;
}
