// Source : https://www.shadertoy.com/view/sdjGWR
// License: Shadertoy default (CC BY-NC-SA 3.0) unless noted by the author
// 3) sdjGWR
// @param uDetail  1..6    = 6.0
// @param uFoldScale 70..115 = 100.0
// @param uSize    40..400 = 100.0
// @param uReveal  0..200  = 100.0
// @param uAngle   -180..180 = 0.0
// @param uContrast 0..800 = 100.0
// @param uCellShape -100..100 = 0.0
// @param uCellStagger 0..100 = 0.0
// @param uCellAspect 50..200 = 100.0
// @param uRevealSoft 20..300 = 100.0
// @param uFoldRatio 85..125 = 100.0
// @param uFoldTaper 85..125 = 100.0
// @param uFoldSkew 85..125 = 100.0
// @param uColFeed 0..200 = 100.0
// @param uFoldBias 85..125 = 100.0
// @param uCellInvert 0..100 = 0.0
// @param uCenterX -100..100 = 0.0
// @param uCenterY -100..100 = 0.0
// @param uFoldRotate -180..180 = 0.0
// @param uFoldMirror 0..100 = 0.0
// @param uFoldSwirl -100..100 = 0.0
// @param uLevels 0..8 = 0.0
// @param uTint color = #ffffff
// @param uCellTint color = #ffffff
// @param uCellBorder 0..100 = 0.0
// @param uCellVary 0..100 = 0.0
// @param uCellEmpty 0..90 = 0.0
// @param uCellHalo 0..100 = 0.0
// @param uVignette 0..200 = 0.0
// @param uGrainAmt 0..100 = 0.0
uniform float uDetail;    // 折り畳みの反復回数 (下げると軽く、模様が単純になる)
uniform float uFoldScale;    // 折り畳みの基準スケール (%)
uniform float uSize;      // 円形セルひとつの大きさ (%)
uniform float uAngle;     // 円形セル格子の向き (度)
uniform float uReveal;    // 拍ごとに広がる円の大きさ (%)
uniform float uContrast;  // 円の内外の明暗差 (%)
uniform float uCellShape; // セルの形。正で四角、負でひし形に寄る (%)。0 = 円
uniform float uCellStagger; // 段ごとの半セルずらし (%)。100 でレンガ積み
uniform float uCellAspect; // セルの横幅 (%)。下げると縦長の楕円
uniform float uRevealSoft; // 円の縁のぼかし幅 (%)
uniform float uFoldRatio; // 折り畳みの縮尺比 (%)。畳み込みの密度が変わる
uniform float uFoldTaper; // 斜め方向の畳み込みの効き (%)。下げると斜めの歪みが強まる
uniform float uFoldSkew; // 横方向の反転・圧縮の度合い (%)
uniform float uColFeed; // 前の色が畳み込みへ戻る量 (%)
uniform float uFoldBias; // 畳み込みの波長のずれ (%)
uniform float uCellInvert; // 円の内側の色を反転する量 (%)
uniform float uCenterX; // 折り畳みの中心の X 位置 (%)。0 で元の位置
uniform float uCenterY; // 折り畳みの中心の Y 位置 (%)。0 で元の位置
uniform float uFoldRotate; // 折り畳みへ入れる前の画面の回転 (度)
uniform float uFoldMirror; // 折り畳み前の左右鏡像。0 = なし、値で鏡の軸が右へずれる (%)
uniform float uFoldSwirl; // 折り畳み前の渦巻きのねじれ (%)。正負で逆向き
uniform float uLevels; // 色の階調数 (ポスタリゼーション)。0 = 滑らか
uniform vec3 uTint; // 全体のティント色
uniform vec3 uCellTint; // 円の内側のティント色
uniform float uCellBorder; // 円の縁の暗い線の濃さ (%)
uniform float uCellVary; // 円の大きさのばらつき (%)
uniform float uCellEmpty; // 円が現れないセルの割合 (%)
uniform float uCellHalo; // 円の外側ににじむ明るいハロ (%)
uniform float uVignette; // 周辺減光 (%)
uniform float uGrainAmt; // 細かいざらつき (%)

vec3 bg_sdjGWR(vec2 fc){
  float bt = getBeat();
  float tx = randomMoveTime(bt, TAU * 0.07, 301.0);
  float ty = randomMoveTime(bt, TAU * 0.05, 302.0);
  vec3 col = vec3(0.0);
  vec2 uv = (fc * 10.0 - resolution.xy) / resolution.y / 10.0 / bgZoom;
  vec2 panUV = bgCamPx / resolution.y * 5.0;
  uv = uv + panUV;
  uv += vec2(tx * 0.5, ty * 0.33) / 4.0;
  if(uCenterX != 0.0 || uCenterY != 0.0) uv += vec2(uCenterX, uCenterY) * 0.01;
  if(uFoldMirror != 0.0) uv.x = abs(uv.x - uFoldMirror * 0.003);
  if(uFoldRotate != 0.0){ float fa = radians(uFoldRotate); uv = mat2(cos(fa), -sin(fa), sin(fa), cos(fa)) * uv; }
  if(uFoldSwirl != 0.0){ float sa = uFoldSwirl * 0.01 * length(uv) * 3.0; uv = mat2(cos(sa), -sin(sa), sin(sa), cos(sa)) * uv; }
  for(int c=0;c<3;c++){
    float scale = 5.6 * (uFoldScale / 100.0);
    float scale1 = 1.5 * (uFoldRatio / 100.0);
    float s1 = scale1 * scale;
    for(int i=0;i<6;i++){
      if(i >= int(uDetail + 0.5)) break;
      uv = fract(uv / s1) * s1;
      uv = -fract(uv / (2.0 - abs((uv.x - uv.y) / (16.0 * (uFoldTaper / 100.0)))) - (uv / (2.5 * (uFoldBias / 100.0) + fract(uv.x + uv.y))) / scale) * scale / scale1 + s1;
      uv /= scale1 + col.yx * (uColFeed / 100.0);
      uv = uv.yx + col.xy;
      uv.x /= -(1.1 * (uFoldSkew / 100.0));
      col[c] = fract((0.25 * col[c] + col.x + uv.y - uv.x) / 2.0);
    }
  }
  float cellA = radians(uAngle);
  vec2 cuv = mat2(cos(cellA), -sin(cellA), sin(cellA), cos(cellA)) * uv * 6.0 / (uSize / 100.0);
  cuv.x *= uCellAspect / 100.0;
  if(uCellStagger != 0.0) cuv.x += floor(cuv.y) * 0.5 * (uCellStagger / 100.0);
  vec2 cell = floor(cuv);
  vec2 lc = fract(cuv) - 0.5;
  float ph = fract(sin(dot(cell, vec2(27.13, 61.97))) * 9123.7);
  float emptyMask = 1.0;
  if(uCellEmpty != 0.0) emptyMask = step(uCellEmpty * 0.01, fract(ph * 7.31 + 0.17));
  float grow = easeOutQuint(fract(fract(bt) + ph));
  float radius = grow * 0.72 * (uReveal / 100.0);
  if(uCellVary != 0.0) radius *= 1.0 - (uCellVary / 100.0) * 0.8 * fract(ph * 13.7);
  float dl = length(lc);
  if(uCellShape > 0.0) dl = mix(dl, max(abs(lc.x), abs(lc.y)), uCellShape / 100.0);
  if(uCellShape < 0.0) dl = mix(dl, (abs(lc.x) + abs(lc.y)) * 0.70710678, -uCellShape / 100.0);
  float reveal = smoothstep(radius + 0.06 * (uRevealSoft / 100.0), radius - 0.12 * (uRevealSoft / 100.0), dl);
  if(uCellEmpty != 0.0) reveal *= emptyMask;
  vec3 grey = clamp(col, 0.0, 1.0);
  if(uLevels != 0.0){ float nl = max(uLevels, 2.0); grey = floor(grey * nl + 0.5) / nl; }
  vec3 outCol = grey;
  if(abs(uCosGrad) > 0.0001){
    float cgInv = uCosGrad < 0.0 ? 0.5 : 0.0;
    // ON 時のみ: 色相を cosine gradient で遷移（Meguru 方式）
    float t = fract(dot(col, vec3(0.6, 0.8, 1.0)));
    float qStep = 0.34;
    float qf = t / qStep;
    float qb = floor(qf);
    float qramp = smoothstep(0.45, 1.0, fract(qf));
    t = (qb + qramp) * qStep;
    vec3 cosCol = cosGradColor(t + cgInv);
    outCol = mix(grey, cosCol, abs(uCosGrad));
  }
  if(uCellInvert != 0.0) outCol = mix(outCol, 1.0 - outCol, reveal * (uCellInvert / 100.0));
  if(uCellTint != vec3(1.0)) outCol *= mix(vec3(1.0), uCellTint, reveal);
  if(uCellHalo != 0.0) outCol += (uCellHalo / 100.0) * 0.6 * smoothstep(radius + 0.35, radius, dl) * (1.0 - reveal) * emptyMask;
  if(uCellBorder != 0.0) outCol *= 1.0 - (uCellBorder / 100.0) * (1.0 - smoothstep(0.0, 0.07, abs(dl - radius))) * emptyMask;
  float ctK = uContrast / 100.0;
  outCol *= mix(mix(1.0, 0.92, ctK), mix(1.0, 1.06, ctK), reveal);
  if(uTint != vec3(1.0)) outCol *= uTint;
  if(uVignette != 0.0){ vec2 vv = (fc - 0.5 * resolution) / resolution.y; outCol *= max(1.0 - (uVignette / 100.0) * 0.6 * dot(vv, vv) * 2.0, 0.0); }
  if(uGrainAmt != 0.0) outCol += (fract(sin(dot(fc, vec2(12.9898, 78.233)) + time) * 43758.5453) - 0.5) * 0.25 * (uGrainAmt / 100.0);
  return outCol;
}

