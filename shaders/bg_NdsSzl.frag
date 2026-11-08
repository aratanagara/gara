// Source : https://www.shadertoy.com/view/NdsSzl
// License: Shadertoy default (CC BY-NC-SA 3.0) unless noted by the author
// =====================================================
// 5) bg_NdsSzl（元のfract版・復元）
// =====================================================
// @param uLayers  2..12   = 12.0
// @param uDetail  1..12   = 12.0
// @param uGlow    25..200 = 100.0
// @param uAngle -180..180 = 0.0
uniform float uLayers;    // 色を重ねる外側の反復回数 (下げると軽く、色の混ざりが減る)
uniform float uDetail;    // 折り畳みの内側の反復回数 (下げると模様が粗くなる)
uniform float uGlow;      // 明るさ (%)
uniform float uAngle; // 向き (度。固定角でずらす)
// @param uCellScale 99..104 = 100.0
// @param uAspect 99.5..103 = 100.0
// @param uCross 96..110 = 100.0
// @param uTriFold 0..6 = 0.0
// @param uSkew      -100..100 = 0.0
// @param uLayerShift -3..3 = 0.0
// @param uBlend     95..130   = 100.0
// @param uBandX     50..200   = 100.0
// @param uBandY     50..200   = 100.0
uniform float uCellScale; // 折り畳みの升目の大きさ (%)
uniform float uAspect; // 升目の横の伸び (%)
uniform float uCross; // 縦横の絡み合いの強さ (%)
uniform float uTriFold; // のこぎり波を三角波へ変える量 (%)。0 で従来
uniform float uSkew; // 全体の斜めのずらし (%)。負で逆向き
uniform float uLayerShift; // 層ごとの平行移動 (%)。0 でなし
uniform float uBlend; // 層を重ねる際の持ち越し量 (%)
uniform float uBandX; // 横方向の縞の細かさ (%)
uniform float uBandY; // 縦方向の縞の細かさ (%)
// @param uCenterX   -100..100 = 0
// @param uCenterY   -100..100 = 0
// @param uMirrorAxis -100..100  = 0
// @param uSwirl     -100..100 = 0
// @param uMosaic    0..100    = 0
// @param uChanSwap  0..100    = 0
// @param uChanSwapB 0..100    = 0
// @param uPosterize 0..12     = 0
// @param uGrain     0..100    = 0
// @param uVignette  0..100    = 0
// @param uTint color = #ffffff
// @param uShadowTint color = #ffffff
// @param uLightTint color = #ffffff
uniform float uCenterX; // 模様の見る位置の横ずらし (%)
uniform float uCenterY; // 模様の見る位置の縦ずらし (%)
uniform float uMirrorAxis; // 左右の鏡像の折り返し位置 (%)。0 でなし、動かすと左側の絵が右へ写る
uniform float uSwirl; // 中心からの距離に応じた渦のねじれ (%)。負で逆向き
uniform float uMosaic; // 座標のモザイク化 (%)。大きいほど粗いブロック
uniform float uChanSwap; // 色チャンネルの入れ替え量 R→G→B (%)
uniform float uChanSwapB; // 色チャンネルの逆回し入れ替え量 (%)
uniform float uPosterize; // 色の階調数を落とす (0 でなし)
uniform float uGrain; // 粒状ノイズの量 (%)
uniform float uVignette; // 周辺を暗くする量 (%)
uniform vec3 uTint; // 全体の色の掛け合わせ
uniform vec3 uShadowTint; // 暗部の色の掛け合わせ
uniform vec3 uLightTint; // 明部の色の掛け合わせ

vec3 bg_NdsSzl(vec2 fc){
  float bt = getBeat();
  const int ITERS = 12;
  float t  = randomMoveTime(bt, TAU * 0.06, 501.0);
  float tx = randomMoveTime(bt, TAU * 0.05, 502.0);

  vec3 col = vec3(0.0), col_prev = vec3(0.0);
  vec2 uv = (fc * 10.0 - resolution.xy) / resolution.y / 10.0;
  if(uMirrorAxis != 0.0){
    float mcx = 0.4 * resolution.x / resolution.y + uMirrorAxis / 100.0 * 0.3;
    uv.x = mcx + abs(uv.x - mcx);
  }
  if(uSwirl != 0.0){
    float sw = (uSwirl / 100.0) * 3.0 * length(uv - vec2(0.4 * resolution.x / resolution.y, 0.4));
    uv = vec2(0.4 * resolution.x / resolution.y, 0.4) + mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * (uv - vec2(0.4 * resolution.x / resolution.y, 0.4));
  }
  if(uMosaic != 0.0){
    float mn = 120.0 / (1.0 + uMosaic * 0.1);
    uv = (floor(uv * mn) + 0.5) / mn;
  }
  if(uCenterX != 0.0 || uCenterY != 0.0) uv += vec2(uCenterX, uCenterY) / 100.0;
  float aN = radians(uAngle);
  uv = mat2(cos(aN), -sin(aN), sin(aN), cos(aN)) * uv;
  uv.x += tx * 0.20;
  uv.y += t  * 0.20;
  if(uSkew != 0.0) uv.x += uv.y * (uSkew / 100.0);

  if(uCellScale != 100.0 || uAspect != 100.0 || uCross != 100.0 || uTriFold != 0.0 || uLayerShift != 0.0 || uBlend != 100.0 || uBandX != 100.0 || uBandY != 100.0){
    for(int c=0;c<ITERS;c++){
      if(c >= int(uLayers + 0.5)) break;
      float scale = 2.48 * (uCellScale / 100.0);
      float scale1 = 1.045 * (uAspect / 100.0);
      col_prev = col;
      if(uLayerShift != 0.0) uv += vec2(0.37, 0.21) * (uLayerShift / 100.0);

      for(int i=0;i<ITERS;i++){
        if(i >= int(uDetail + 0.5)) break;
        vec2 f1 = fract(-uv.yx / (scale1 * scale));
        if(uTriFold != 0.0) f1 = mix(f1, 1.0 - abs(2.0 * f1 - 1.0), uTriFold / 100.0);
        uv = f1 * scale;
        uv.x *= scale1;
        uv = fract(
               uv + vec2(uv.x/scale - (uv.y/scale1) * (uCross / 100.0),
                         uv.y/scale - (uv.x/scale1) * (uCross / 100.0)) / scale
             ) / scale1;
        uv.y /= -scale1;
      }

      col.b = abs(fract(uv.y * (uBandY / 100.0)) - fract(uv.x * (uBandX / 100.0)));
      col = (col + col_prev.yzx) / (2.125 * (uBlend / 100.0));
    }
  } else {
  for(int c=0;c<ITERS;c++){
    if(c >= int(uLayers + 0.5)) break;
    float scale = 2.48;
    float scale1 = 1.045;
    col_prev = col;

    for(int i=0;i<ITERS;i++){
      if(i >= int(uDetail + 0.5)) break;
      uv = fract(-uv.yx / (scale1 * scale)) * scale;
      uv.x *= scale1;
      uv = fract(
             uv + vec2(uv.x/scale - uv.y/scale1,
                       uv.y/scale - uv.x/scale1) / scale
           ) / scale1;
      uv.y /= -scale1;
    }

    col.b = abs(fract(uv.y) - fract(uv.x));
    col = (col + col_prev.yzx) / 2.125;
  }
  }

  col = clamp(col * 3.0 * (uGlow / 100.0), 0.0, 1.0);
  if(uChanSwap != 0.0) col = mix(col, col.gbr, uChanSwap / 100.0);
  if(uChanSwapB != 0.0) col = mix(col, col.brg, uChanSwapB / 100.0);
  if(uShadowTint != vec3(1.0) || uLightTint != vec3(1.0)){
    float lm2 = dot(col, vec3(0.299, 0.587, 0.114));
    col *= mix(uShadowTint, uLightTint, lm2);
  }
  if(uTint != vec3(1.0)) col *= uTint;
  if(uPosterize != 0.0){
    float pn = uPosterize + 1.0;
    col = floor(clamp(col, 0.0, 1.0) * pn + 0.5) / pn;
  }
  if(uGrain != 0.0){
    float gh = fract(sin(dot(fc, vec2(12.9898, 78.233)) + time * 0.7) * 43758.5453);
    col += (gh - 0.5) * (uGrain / 100.0) * 0.5;
  }
  if(uVignette != 0.0){
    vec2 vq = (fc - 0.5 * resolution.xy) / resolution.y;
    col *= 1.0 - (uVignette / 100.0) * smoothstep(0.3, 1.0, length(vq));
  }
  return clamp(col, 0.0, 1.0);
}
