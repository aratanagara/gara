// =====================================================
// bg_slimeframe  (H42)
//   Source : Shadertoy "Slime Frame" https://www.shadertoy.com/view/M3dyz7
//            (c) leon denise 2024。カレイドスコープ円 + フレームの 2D SDF。
//   改変: 緑の照明を撤去し、表面をクローム(銀の環境反射 + ハイライト + フレネル)に。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは sf_ で名前空間化。
// =====================================================

mat2 sf_rot(float a){ float c = cos(a), s = sin(a); return mat2(c,-s,s,c); }
float sf_smin(float d1, float d2, float k){
  float h = clamp(0.5 + 0.5*(d2-d1)/k, 0.0, 1.0);
  return mix(d2, d1, h) - k*h*(1.0-h);
}
// @param uDetail  2..5 = 5.0
// @param uThick   25..500 = 100.0
// @param uWarp    0..300 = 100.0
// @param uSoft    10..300 = 100.0
// @param uDensity 25..200 = 100.0
// @param uSize 50..115 = 100.0
// @param uAngle -180..180 = 0.0
uniform float uDetail; // カレイドスコープの反復回数 (下げると軽く、円が少なくなる)
uniform float uThick; // 線の太さ (%)
uniform float uWarp; // 円のゆがみ (%)
uniform float uSoft; // 円同士のつながりの柔らかさ (%)
uniform float uDensity; // 円の密度 (%)
uniform float uSize; // 円ひとつの大きさ (%)
uniform float uAngle; // 向き (度。固定角でずらす)
// @param uFoldOffset 85..140 = 100.0
// @param uRingDecay 80..140 = 100.0
// @param uOffCenter 0..250 = 100.0
// @param uRingStretch -40..50 = 0.0
// @param uSquare 0..100 = 0.0
// @param uWobbleFreq 30..250 = 100.0
// @param uBulgeFreq 30..250 = 100.0
// @param uFrameWidth 20..300 = 100.0
// @param uFrameBlend 10..300 = 100.0
// @param uFrameInset 60..120 = 100.0
// @param uChromeBands 1..6 = 2.0
// @param uHighlightSharp 4..80 = 30.0
// @param uFresnelGain 0..300 = 100.0
// @param uBevel 20..400 = 100.0
uniform float uFoldOffset; // 折り返しで円の中心をずらす距離 (%)。大きいと円が離れ、小さいと重なる
uniform float uRingDecay; // 反復ごとに円が小さくなる割合 (%)。上げると奥の円が急に小さくなる
uniform float uOffCenter; // 円群の中心のずれ (%)。0 で左右上下対称
uniform float uRingStretch; // 円の横方向の伸び (%)。正で横長 / 負で縦長
uniform float uSquare; // 円を四角に近づける量 (%)。0 = 円 / 100 = 正方形の輪
uniform float uWobbleFreq; // 円のゆがみ (ねじれ) の細かさ (%)
uniform float uBulgeFreq; // 円のふくらみの波の細かさ (%)
uniform float uFrameWidth; // 外枠の太さ (%)
uniform float uFrameBlend; // 外枠と円のつながりの柔らかさ (%)
uniform float uFrameInset; // 外枠の位置 (%)。下げると内側へ寄る
uniform float uChromeBands; // クロームの映り込み帯の本数
uniform float uHighlightSharp; // ハイライトの鋭さ (大きいほど細く鋭い)
uniform float uFresnelGain; // 縁のフレネル反射の強さ (%)
uniform float uBevel; // 縁の丸み (%)。上げると法線がなだらかになり反射が柔らかい
// @param uFoldTurn -90..90 = 0
// @param uPatX -100..100 = 0
// @param uPatY -100..100 = 0
// @param uFrameRound 0..100 = 0
// @param uFrameWide 40..160 = 100
// @param uFrameTall 40..160 = 100
// @param uRoll -180..180 = 0
// @param uMirror 0..100 = 0
// @param uCenterX -100..100 = 0
// @param uCenterY -100..100 = 0
// @param uLightYaw -180..180 = 0
// @param uSpecGain 0..1500 = 100
// @param uSkyPow 30..400 = 100
// @param uBandDepth 0..200 = 100
// @param uBandPhase 0..360 = 0
// @param uFresnelPow 30..300 = 100
// @param uEnvColor color = #ffffff
// @param uSpecColor color = #ffffff
// @param uFresnelColor color = #ffffff
uniform float uFoldTurn; // 反復ごとの追加の回転 (度)。円群のねじれ方が変わる
uniform float uPatX; // 円群の横位置 (%)。外枠は動かない
uniform float uPatY; // 円群の縦位置 (%)
uniform float uFrameRound; // 外枠の角の丸み (%)
uniform float uFrameWide; // 外枠の横幅 (%)
uniform float uFrameTall; // 外枠の高さ (%)
uniform float uRoll; // 画面ロール (度)
uniform float uMirror; // 左右の鏡像。50 以上で完全な左右対称
uniform float uCenterX; // 全体の横位置 (%)
uniform float uCenterY; // 全体の縦位置 (%)
uniform float uLightYaw; // ハイライトの光源の向き (度)
uniform float uSpecGain; // ハイライトの強さ (%)
uniform float uSkyPow; // 上方の銀の空の広がり (%)。上げると狭く上端だけ明るい
uniform float uBandDepth; // 映り込み帯の明暗差 (%)
uniform float uBandPhase; // 映り込み帯の位相 (度)
uniform float uFresnelPow; // フレネルの絞り (%)。上げると縁の光が細い
uniform vec3  uEnvColor; // 映り込みの地色のティント
uniform vec3  uSpecColor; // ハイライトの色のティント
uniform vec3  uFresnelColor; // 縁のフレネル反射の色のティント

float sf_map(vec2 p){
  vec2 q = p;
  float d = 100.0, a = 1.0;
  float t = 196.0 + time/20.0;
  p = sf_rot(radians(uAngle)) * p;
  // break symmetry
  p += vec2(resolution.x/resolution.y, 1.0)*(uOffCenter / 100.0);
  if(uPatX != 0.0 || uPatY != 0.0) p += vec2(uPatX, uPatY) * 0.01;
  p *= 0.6 * (uDensity / 100.0);
  // kaleidoscopic circles
  for(float i = 0.0; i < 5.0; ++i){
    if(i >= floor(uDetail + 0.5)) break;
    p = abs(p) - a*(uFoldOffset / 100.0);
    if(uRingStretch != 0.0){ p.x *= 1.0 + uRingStretch / 100.0; }
    float b = length(p);
    if(uSquare != 0.0){ b = mix(b, max(abs(p.x), abs(p.y)), uSquare / 100.0); }
    p *= sf_rot(t/a + sin(b*(5.0*(uWobbleFreq / 100.0))/a)*0.05*(uWarp / 100.0)/a);
    if(uFoldTurn != 0.0) p *= sf_rot(radians(uFoldTurn));
    p *= 1.0 + 0.2*(uWarp / 100.0)*sin(b*(4.0*(uBulgeFreq / 100.0))/a + time*a + i*3.0)*a;
    d = sf_smin(d, abs(b - 1.0*(uSize / 100.0)*a), 0.07 * (uSoft / 100.0));
    a /= (1.4*(uRingDecay / 100.0));
  }
  d -= 0.004 * (uThick / 100.0);                                             // thickness
  // frame
  vec2 fsz = vec2(resolution.x/resolution.y, 1.0);
  if(uFrameWide != 100.0 || uFrameTall != 100.0) fsz *= vec2(uFrameWide / 100.0, uFrameTall / 100.0);
  q = abs(q) - fsz*(uFrameInset / 100.0);
  float box = abs(max(q.x, q.y));
  if(uFrameRound != 0.0){
    float fr = uFrameRound * 0.008;
    vec2 qr = q + fr;
    box = abs(length(max(qr, 0.0)) + min(max(qr.x, qr.y), 0.0) - fr);
  }
  d = sf_smin(d, box - 0.02*(uFrameWidth / 100.0), 0.2*(uFrameBlend / 100.0));
  return d;
}


vec3 bg_slimeframe(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 p = (2.0*I - resolution.xy) / resolution.y;
  if(uCenterX != 0.0 || uCenterY != 0.0) p -= vec2(uCenterX, uCenterY) * 0.02;
  if(uRoll != 0.0){
    float rc = cos(radians(uRoll)), rs = sin(radians(uRoll));
    p = vec2(rc*p.x - rs*p.y, rs*p.x + rc*p.y);
  }
  if(uMirror >= 50.0) p.x = abs(p.x);

  float d = sf_map(p);
  vec2 e = vec2((0.002 + 0.02*length(p))*(uBevel / 100.0), 0.0);
  vec3 n = -normalize(vec3(d) - vec3(sf_map(p+e.xy), sf_map(p+e.yx), 0.0));

  // クローム: 法線から銀の環境反射 + 鋭いハイライト + フレネル(緑照明を置換)
  float ang = atan(n.y, n.x);
  vec3 env = vec3(0.5 + 0.42*sin(ang*floor(uChromeBands + 0.5) + 1.0));
  if(uBandDepth != 100.0 || uBandPhase != 0.0) env = vec3(0.5 + 0.42*(uBandDepth / 100.0)*sin(ang*floor(uChromeBands + 0.5) + 1.0 + radians(uBandPhase)));          // 方位方向の映り込み帯
  if(uSkyPow != 100.0) env = mix(env, vec3(0.96), pow(n.y*0.5 + 0.5, 2.0*(uSkyPow / 100.0)));
  else env = mix(env, vec3(0.96), pow(n.y*0.5 + 0.5, 2.0));     // 上方を明るく(銀の空)
  vec3 Ld = normalize(vec3(0.0, 2.0, 0.5));
  if(uLightYaw != 0.0){
    float lc = cos(radians(uLightYaw)), ls = sin(radians(uLightYaw));
    Ld = normalize(vec3(lc*Ld.x - ls*Ld.y, ls*Ld.x + lc*Ld.y, Ld.z));
  }
  float spec = pow(max(dot(n, Ld), 0.0), uHighlightSharp);
  float fres = pow(1.0 - abs(n.z), 3.0);
  if(uFresnelPow != 100.0) fres = pow(1.0 - abs(n.z), 3.0*(uFresnelPow / 100.0));
  float cov = smoothstep(0.001, 0.0, d);                   // 線(SDF表面)=1 / 背景=0
  vec3 color = (env + spec + fres*(0.35*(uFresnelGain / 100.0))) * cov;
  if(uSpecGain != 100.0 || uEnvColor != vec3(1.0) || uSpecColor != vec3(1.0) || uFresnelColor != vec3(1.0))
    color = (env*uEnvColor + spec*(uSpecGain / 100.0)*uSpecColor + fres*(0.35*(uFresnelGain / 100.0))*uFresnelColor) * cov;
  bgAlpha = cov;                                           // 背景は透明
  return color;
}
