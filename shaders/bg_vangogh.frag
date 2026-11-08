// =====================================================
// Backgrounds
// =====================================================

// Meguru と共用するコサインパレット (本ファイルに重複定義: 各 bg は単独コンパイルされるため)
vec3 vg_cosineGradient(float tt, vec3 a, vec3 b, vec3 c, vec3 d){
  return a + b * cos(6.28318 * (c * tt + d));
}

// 0) VanGogh
// @param uDetail 1..4 = 4.0
// @param uWarp 0..200 = 100.0
// @param uDensity 25..400 = 100.0
// @param uSat 0..250 = 100.0
// @param uBandW 25..400 = 100.0
// @param uCenterX -100..100 = 0
// @param uCenterY -100..100 = 0
// @param uRingAspect 40..250 = 100
// @param uRingStep 1..8 = 3
// @param uDriftAmp 0..300 = 100
// @param uCrinkle 0..300 = 100
// @param uWarpSkew 30..300 = 100
// @param uSpokes 0..12 = 0
// @param uBandEdge 5..90 = 30
uniform float uDetail;   // 歪ませる反復回数 (下げると模様が単純になる)
uniform float uWarp;   // 渦の歪みの強さ (%)
uniform float uDensity;   // 同心の帯の密度 (%)
uniform float uSat;   // 色の彩度 (%)
uniform float uBandW;   // 色の段の幅 (%)
uniform float uCenterX;   // 渦の中心の横位置 (%)
uniform float uCenterY;   // 渦の中心の縦位置 (%)
uniform float uRingAspect;   // 同心の帯の縦横比 (%)。小さいほど横長の楕円
uniform float uRingStep;   // 帯の段数の割り (3 = 既定)。小さいと段差が荒く、大きいと細かい
uniform float uDriftAmp;   // 渦全体が流れる振れ幅 (%)
uniform float uCrinkle;   // 渦の縁のうねりの深さ (%)
uniform float uWarpSkew;   // 縦方向の歪みの強さ (%)。横に対する比
uniform float uSpokes;   // 放射状の羽根の本数。0 = なし
uniform float uBandEdge;   // 色の段のなだらかな立ち上がり位置 (%)。小さいほど段が丸い

vec3 bg_vangogh(vec2 fc){
  float bt   = getBeat();
  float blk  = floor(bt);
  float seed = 0.0;
  if(isFree()){
    seed = freeSeed(bt, 0.07, 777.1);
  }else{
    seed = hash21(vec2(blk, blk * 7.1));
  }
  float t = randomMoveTime(bt, TAU * (0.18 + 0.10 * seed), 101.0) + seed * 6.0;
  vec2 p = (fc - 0.5 * resolution.xy) / uRingZoom / bgZoom;
  p.x *= resolution.x / resolution.y;
  vec2 panUV = bgCamPx / resolution.y * 5.0;
  p = p + panUV;
  vec2 off = vec2(1.0);
  if(isFree()){
    float ox = freeSeed(bt, 0.05, 33.1);
    float oy = freeSeed(bt, 0.05, 91.7);
    off = vec2(ox, oy) - 0.5;
  }else{
    off = vec2(hash21(vec2(blk, 33.1)), hash21(vec2(blk, 91.7))) - 0.5;
  }
  p += off * 0.35;
  if(uCenterX != 0.0 || uCenterY != 0.0){ p += vec2(uCenterX, uCenterY) / 100.0 * 2.0; }
  for(int i=0;i<TIMES;i++){
    if(i >= int(uDetail + 0.5)) break;
    float d = ceil(-sin(t) + length(p * vec2(1.0, uRingAspect / 100.0)) * 6.0 * (uDensity / 100.0)) / uRingStep;
    if(uSpokes != 0.0){ d += sin(atan(p.y, p.x) * floor(uSpokes + 0.5) + t) * 0.6; }
    p += vec2(
      sin(p.y + sin(d) * (uCrinkle / 100.0)) - sin(t / 4.0) * (uDriftAmp / 100.0),
     -sin(p.x - sin(d) * (uCrinkle / 100.0)) - cos(t / 4.0) * (uDriftAmp / 100.0)
    ) * (uWarp / 100.0) * vec2(1.0, uWarpSkew / 100.0);
  }
  // Meguru と同じカラーシステム: 異周期 sin で a/b/c/d を連続ドリフト + 量子化
  float pt = bt * 0.05;
  vec3 a  = vec3(0.50, 0.50, 0.50)
          + vec3(0.10 * sin(pt * 0.71 + 0.0),
                 0.10 * sin(pt * 0.83 + 1.7),
                 0.10 * sin(pt * 0.97 + 3.1));
  vec3 b0 = vec3(0.50, 0.50, 0.50)
          + vec3(0.15 * sin(pt * 0.61 + 2.3),
                 0.15 * sin(pt * 0.79 + 4.1),
                 0.15 * sin(pt * 0.89 + 0.7));
  vec3 cP = vec3(1.00, 1.00, 1.00)
          + vec3(0.20 * sin(pt * 0.43 + 1.1),
                 0.20 * sin(pt * 0.57 + 3.5),
                 0.20 * sin(pt * 0.67 + 5.0));
  vec3 d4 = vec3(0.00, 0.33, 0.67)
          + vec3(pt * 0.030, pt * 0.027, pt * 0.024);
  float phase = isFree() ? (t * 0.005) : (bt * 0.05 + seed * 1.5);
  float spatialGrad = dot(p, vec2(0.020, 0.016));
  float colorParam = spatialGrad + length(p) * 0.006 + bt * 0.08 + phase;
  // ソフト量子化: band プラトー + 境界 smoothstep で中間色を温存
  float vStep = 0.16 * (uBandW / 100.0);
  float fv = colorParam / vStep;
  float bv = floor(fv);
  float frv = fract(fv);
  float rampv = smoothstep(uBandEdge / 100.0, 1.00, frv);
  colorParam = (bv + rampv) * vStep;
  vec3 c = vg_cosineGradient(colorParam, a, b0, cP, d4);
  c = saturateColor(c, 1.15 * (uSat / 100.0));
  return clamp(c, 0.0, 1.0);
}

