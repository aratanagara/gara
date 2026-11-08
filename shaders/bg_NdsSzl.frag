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

vec3 bg_NdsSzl(vec2 fc){
  float bt = getBeat();
  const int ITERS = 12;
  float t  = randomMoveTime(bt, TAU * 0.06, 501.0);
  float tx = randomMoveTime(bt, TAU * 0.05, 502.0);

  vec3 col = vec3(0.0), col_prev = vec3(0.0);
  vec2 uv = (fc * 10.0 - resolution.xy) / resolution.y / 10.0;
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

  return clamp(col * 3.0 * (uGlow / 100.0), 0.0, 1.0);
}
