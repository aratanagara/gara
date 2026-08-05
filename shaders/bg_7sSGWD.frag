// Source : https://www.shadertoy.com/view/7sSGWD
// License: Shadertoy default (CC BY-NC-SA 3.0) unless noted by the author
// 4) 7sSGWD
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
    float s1 = scale1 * scale;
    for(int i=0;i<6;i++){
      uv = fract(uv / s1) * s1;
      uv = -fract(uv / (2.0 - abs((uv.x - uv.y) / 16.0)) - (uv / (2.5 + fract(uv.x + uv.y))) / scale) * scale / scale1 + s1;
      uv /= scale1 + col.yx;
      uv = uv.yx + col.xy;
      uv.x *= -(1.0 + col.x / scale);
      col[c] = fract((0.25 * col[c] + col.x + uv.y - uv.x) / 2.5);
    }
  }
  vec2 cell = floor(uv * 6.0);
  vec2 lc = fract(uv * 6.0) - 0.5;
  float ph = fract(sin(dot(cell, vec2(27.13, 61.97))) * 9123.7);
  float grow = easeOutQuint(fract(fract(bt) + ph));
  float radius = grow * 0.72;
  float dl = length(lc);
  float reveal = smoothstep(radius + 0.06, radius - 0.12, dl);
  vec3 grey = clamp(col, 0.0, 1.0);
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
  outCol *= mix(0.92, 1.06, reveal);
  return outCol;
}
