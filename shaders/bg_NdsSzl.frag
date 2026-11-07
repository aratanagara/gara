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

  return clamp(col * 3.0 * (uGlow / 100.0), 0.0, 1.0);
}
