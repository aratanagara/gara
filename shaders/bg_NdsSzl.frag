// Source : https://www.shadertoy.com/view/NdsSzl
// License: Shadertoy default (CC BY-NC-SA 3.0) unless noted by the author
// =====================================================
// 5) bg_NdsSzl（元のfract版・復元）
// =====================================================
vec3 bg_NdsSzl(vec2 fc){
  float bt = getBeat();
  const int ITERS = 12;
  float t  = randomMoveTime(bt, TAU * 0.06, 501.0);
  float tx = randomMoveTime(bt, TAU * 0.05, 502.0);

  vec3 col = vec3(0.0), col_prev = vec3(0.0);
  vec2 uv = (fc * 10.0 - resolution.xy) / resolution.y / 10.0;
  uv.x += tx * 0.20;
  uv.y += t  * 0.20;

  for(int c=0;c<ITERS;c++){
    float scale = 2.48;
    float scale1 = 1.045;
    col_prev = col;

    for(int i=0;i<ITERS;i++){
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

  return clamp(col * 3.0, 0.0, 1.0);
}
