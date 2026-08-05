// Source : https://www.shadertoy.com/view/7sKSDd
// License: Shadertoy default (CC BY-NC-SA 3.0) unless noted by the author
vec3 bg_7sKSDd(vec2 fc){
  float bt = getBeat();
  float tx = randomMoveTime(bt, TAU * 0.08, 201.0);
  float ty = randomMoveTime(bt, TAU * 0.06, 202.0);
  vec3 col = vec3(0.0);
  vec2 uv1 = (fc * 10.0 - resolution.xy) / resolution.y / 10.0 / bgZoom;
  vec2 panUV = bgCamPx / resolution.y * 5.0;
  uv1 = uv1 + panUV;
  uv1 += vec2(tx, ty) / 10.0;
  for(int c=0;c<3;c++){
    vec2 uv = uv1;
    for(int i=0;i<6;i++){
      uv = fract((uv.y + uv.x + uv) / 1.5) * 1.5;
      uv *= (uv.x - uv.y);
      uv += 0.06 * vec2(sin(bt * 0.9 + uv.y * 3.0),
                        cos(bt * 0.8 + uv.x * 3.0));
      col += col.yzx * (uv.x + uv.y) / 8.0;
      col[c] += (uv.y - uv.x);
    }
  }
  vec3 base = fract(col);
  if(abs(uCosGrad) < 0.0001) return base;
  float cgInv = uCosGrad < 0.0 ? 0.5 : 0.0;
  // ON 時のみ: 素の色相を cosine gradient で遷移させる（Meguru 方式）
  float t = fract(dot(col, vec3(0.6, 0.8, 1.0)));
  float qStep = 0.34;
  float qf = t / qStep;
  float qb = floor(qf);
  float qramp = smoothstep(0.45, 1.0, fract(qf));
  t = (qb + qramp) * qStep;
  vec3 outCol = cosGradColor(t + cgInv);
  float shade = 0.6 + 0.4 * (0.5 + 0.5 * sin(t * 6.28318 * 2.0));
  outCol *= shade;
  vec3 glow = outCol * outCol;
  outCol += glow * (0.5 + 0.4 * shade);
  return mix(base, clamp(outCol, 0.0, 1.0), abs(uCosGrad));
}

