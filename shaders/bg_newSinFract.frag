// 6) sin/fract
vec3 bg_newSinFract(vec2 fc){
  float bt = getBeat();
  const int ITERS = 12;
  float t = randomMoveTime(bt, TAU / 16.0, 601.0);
  vec3 col = vec3(0.0), col_prev = vec3(0.0);
  vec2 uv = (fc * 10.0 - resolution.xy) / resolution.y / 10.0 / bgZoom;
  vec2 panUV = bgCamPx / resolution.y * 5.0;
  uv = uv + panUV;
  uv.x += 0.8*sin(t*0.13);
  uv.y += 3.0 + 0.8*sin(t*0.2);
  for(int c=0;c<ITERS;c++){
    float scale  = 2.25;
    float scale1 = 1.9;
    col_prev = col;
    for(int i=0;i<ITERS;i++){
      uv = sin(uv.yx / (scale1*scale)) * (scale1*scale);
      uv = -fract(uv + vec2(uv.x/scale - uv.y/scale1, uv.y/scale - uv.x/scale1) / scale) * scale / scale1;
      uv.y /= -scale1;
      scale1 += (uv.x * (0.005 * fract(uv.x + t * (scale1*scale))));
    }
    col.b = abs(fract(uv.y) - fract(uv.x));
    col = (col + col_prev.yzx) / 2.0;
  }
  vec3 grey = clamp(col * 3.0, 0.0, 1.0);
  if(abs(uCosGrad) < 0.0001) return grey;
  float cgInv = uCosGrad < 0.0 ? 0.5 : 0.0;
  // ON 時のみ: 色相を cosine gradient で遷移（Hinotori 方式）
  float ct = fract(dot(grey, vec3(0.6, 0.8, 1.0)));
  float qStep = 0.34;
  float qf = ct / qStep;
  float qb = floor(qf);
  float qramp = smoothstep(0.45, 1.0, fract(qf));
  ct = (qb + qramp) * qStep;
  vec3 cosCol = cosGradColor(ct + cgInv);
  return mix(grey, cosCol, abs(uCosGrad));
}
