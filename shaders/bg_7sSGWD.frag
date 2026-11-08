// Source : https://www.shadertoy.com/view/7sSGWD
// License: Shadertoy default (CC BY-NC-SA 3.0) unless noted by the author
// 4) 7sSGWD
// @param uDetail 2..6 = 6.0
// @param uDensity 25..400 = 100.0
// @param uSize 20..150 = 100.0
// @param uSoft 10..300 = 100.0
// @param uContrast 0..800 = 100.0
// @param uTileSpan 94..108 = 100
// @param uSkewBias 70..160 = 100
// @param uCrossDiv 80..140 = 100
// @param uCrossPull 60..160 = 100
// @param uFlipAmt 30..250 = 100
// @param uCarry 70..150 = 100
// @param uRingWidth 0..100 = 0
// @param uCellShear -100..100 = 0
// @param uRowStagger 0..100 = 0
// @param uCellSquare 0..100 = 0
// @param uCellJitter 0..100 = 0
// @param uGridShiftX -100..100 = 0
// @param uGridShiftY -100..100 = 0
// @param uGridRotate -90..90 = 0
// @param uCellVoid 0..90 = 0
// @param uSizeScatter 0..100 = 0
// @param uPhaseSync 0..100 = 0
// @param uRimGlow 0..100 = 0
// @param uChanOffsetG -50..50 = 0
// @param uChanOffsetB -50..50 = 0
// @param uSolarize 0..100 = 0
// @param uPosterize 0..8 = 0
// @param uHighTint color = #ffffff
// @param uShadowTint color = #ffffff
// @param uGrain 0..100 = 0
// @param uVignette 0..100 = 0
// @param uDiscTint color = #ffffff
// @param uBackTint color = #ffffff
uniform float uDetail;   // 反復回数 (下げると模様が粗くなる)
uniform float uDensity;   // マス目の密度 (%)
uniform float uSize;   // 円が広がる大きさ (%)
uniform float uSoft;   // 円の縁のぼかし幅 (%)
uniform float uContrast;   // 円の内外の明暗差 (%)
uniform float uTileSpan;   // 折り返しタイルの周期 (%)
uniform float uSkewBias;   // 斜め方向の折り返しの偏り (%)。下げると偏りが強まる
uniform float uCrossDiv;   // 交差項の分母 (%)。下げると交差が強まる
uniform float uCrossPull;   // 交差項を引き戻す強さ (%)
uniform float uFlipAmt;   // 左右反転に混ぜる前の色の量 (%)
uniform float uCarry;   // 前の色を座標へ持ち越す量 (%)
uniform float uRingWidth;   // 円を輪にくり抜く幅 (%)。0 で円盤のまま
uniform float uCellShear;   // マス目の斜め傾き (%)。0 で正方格子
uniform float uRowStagger;   // 1 行おきのずれ (%)。0 で揃う
uniform float uCellSquare;   // 円を角丸の四角へ寄せる量 (%)。0 で円
uniform float uCellJitter;   // マスごとの中心のばらつき (%)
uniform float uGridShiftX;   // マス目を横へずらす量 (%)。構図が変わる
uniform float uGridShiftY;   // マス目を縦へずらす量 (%)
uniform float uGridRotate;   // マス目全体の回転角 (度)
uniform float uCellVoid;   // 円が出ない空きマスの割合 (%)
uniform float uSizeScatter;   // マスごとの円の大きさのばらつき (%)
uniform float uPhaseSync;   // マスごとの開き方のタイミングを揃える量 (%)。100 で一斉に開く
uniform float uRimGlow;   // 円の縁に出る光の輪の強さ (%)
uniform float uChanOffsetG;   // 緑チャンネルの値をずらす量 (%)。色の配置が変わる
uniform float uChanOffsetB;   // 青チャンネルの値をずらす量 (%)
uniform float uSolarize;   // 明暗を折り返して反転させる量 (%)
uniform float uPosterize;   // 色の段数 (0 で連続)
uniform vec3 uHighTint;   // 明るい部分に掛ける色
uniform vec3 uShadowTint;   // 暗い部分に掛ける色
uniform float uGrain;   // 画面のざらつき (%)
uniform float uVignette;   // 周辺減光 (%)
uniform vec3 uDiscTint;   // 円の内側に掛ける色
uniform vec3 uBackTint;   // 円の外側に掛ける色

vec3 bg_7sSGWD(vec2 fc){
  float bt = getBeat();
  float tx = randomMoveTime(bt, TAU * 0.07, 401.0);
  float ty = randomMoveTime(bt, TAU * 0.05, 402.0);
  vec3 col = vec3(0.0);
  vec2 uv = (fc * 10.0 - resolution.xy) / resolution.y / 10.0 / bgZoom;
  vec2 panUV = bgCamPx / resolution.y * 5.0;
  uv = uv + panUV;
  uv += vec2(tx * 0.5, ty * 0.33) / 4.0;
  for(int c=0;c<3;c++){
    float scale = 5.5;
    float scale1 = 1.4;
    float s1 = scale1 * scale * (uTileSpan / 100.0);
    float skewD = 16.0 * (uSkewBias / 100.0);
    float crossD = 2.5 * (uCrossDiv / 100.0);
    float pullK = uCrossPull / 100.0;
    float carryK = uCarry / 100.0;
    float flipK = uFlipAmt / 100.0;
    for(int i=0;i<6;i++){
      if(i >= int(uDetail + 0.5)) break;
      uv = fract(uv / s1) * s1;
      uv = -fract(uv / (2.0 - abs((uv.x - uv.y) / skewD)) - (uv / (crossD + fract(uv.x + uv.y))) / scale * pullK) * scale / scale1 + s1;
      uv /= scale1 + col.yx;
      uv = uv.yx + col.xy * carryK;
      uv.x *= -(1.0 + col.x / scale * flipK);
      col[c] = fract((0.25 * col[c] + col.x + uv.y - uv.x) / 2.5);
    }
  }
  float gridK = 6.0 * (uDensity / 100.0);
  vec2 guv = uv * gridK;
  if(uGridRotate != 0.0){
    float ga = radians(uGridRotate);
    guv = mat2(cos(ga), sin(ga), -sin(ga), cos(ga)) * guv;
  }
  if(uGridShiftX != 0.0) guv.x += uGridShiftX / 50.0;
  if(uGridShiftY != 0.0) guv.y += uGridShiftY / 50.0;
  if(uCellShear != 0.0) guv.x += guv.y * (uCellShear / 100.0);
  if(uRowStagger != 0.0) guv.x += mod(floor(guv.y), 2.0) * (uRowStagger / 200.0);
  vec2 cell = floor(guv);
  vec2 lc = fract(guv) - 0.5;
  float ph = fract(sin(dot(cell, vec2(27.13, 61.97))) * 9123.7);
  if(uCellJitter != 0.0) lc -= (vec2(fract(ph * 7.31), fract(ph * 13.77)) - 0.5) * (uCellJitter / 100.0) * 0.5;
  float phT = ph;
  if(uPhaseSync != 0.0) phT = ph * (1.0 - uPhaseSync / 100.0);
  float grow = easeOutQuint(fract(fract(bt) + phT));
  float radius = grow * 0.72 * (uSize / 100.0);
  if(uSizeScatter != 0.0) radius *= 1.0 - (uSizeScatter / 100.0) * 0.7 * fract(ph * 31.7);
  float dl = length(lc);
  if(uCellSquare != 0.0) dl = mix(dl, max(abs(lc.x), abs(lc.y)), uCellSquare / 100.0);
  float reveal = smoothstep(radius + 0.06 * (uSoft / 100.0), radius - 0.12 * (uSoft / 100.0), dl);
  if(uRingWidth != 0.0) reveal *= smoothstep(radius * (1.0 - uRingWidth / 110.0) - 0.04, radius * (1.0 - uRingWidth / 110.0) + 0.02, dl) ;
  if(uCellVoid != 0.0) reveal *= step(uCellVoid / 100.0, fract(ph * 53.9));
  float cellK = max(max(abs(uCellShear), uRowStagger), max(uCellSquare, max(uCellJitter, max(uRingWidth, max(uCellVoid, uSizeScatter))))) / 100.0;
  if(uChanOffsetG != 0.0 || uChanOffsetB != 0.0) col = fract(col + vec3(0.0, uChanOffsetG, uChanOffsetB) / 100.0);
  vec3 grey = clamp(col, 0.0, 1.0);
  if(uSolarize != 0.0) grey = mix(grey, abs(grey * 2.0 - 1.0), uSolarize / 100.0);
  if(uPosterize != 0.0){
    float pl = max(uPosterize, 2.0);
    grey = floor(grey * pl + 0.5) / pl;
  }
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
  float ctK = uContrast / 100.0;
  outCol *= mix(mix(1.0, 0.92, ctK), mix(1.0, 1.06, ctK), reveal);
  if(cellK > 0.0) outCol *= mix(1.0 - 0.45 * cellK, 1.0, reveal);
  if(uRimGlow != 0.0){
    float rimD = abs(dl - radius * 0.92) / (0.05 + 0.04 * (uSoft / 100.0));
    outCol += (uRimGlow / 100.0) * 0.6 * exp(-rimD * rimD) * step(0.001, radius);
  }
  if(uHighTint != vec3(1.0) || uShadowTint != vec3(1.0)){
    float lum = dot(outCol, vec3(0.299, 0.587, 0.114));
    outCol *= mix(uShadowTint, uHighTint, smoothstep(0.25, 0.75, lum));
  }
  if(uDiscTint != vec3(1.0)) outCol *= mix(vec3(1.0), uDiscTint, reveal);
  if(uBackTint != vec3(1.0)) outCol *= mix(uBackTint, vec3(1.0), reveal);
  if(uGrain != 0.0){
    float gh = fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453);
    outCol = max(outCol + (gh - 0.5) * (uGrain / 100.0) * 0.35, 0.0);
  }
  if(uVignette != 0.0){
    vec2 vq = fc / resolution.xy - 0.5;
    outCol *= 1.0 - (uVignette / 100.0) * smoothstep(0.25, 0.8, length(vq));
  }
  return outCol;
}
