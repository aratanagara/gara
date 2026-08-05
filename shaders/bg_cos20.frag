// 7) cos 20 loop
vec3 bg_cos20(vec2 fc){
  float bt = getBeat();
  float tBase = randomMoveTime(bt, TAU * 0.10, 701.0);
  float tUVx  = randomMoveTime(bt, TAU * 0.06, 702.0);
  float tUVy  = randomMoveTime(bt, TAU * 0.05, 703.0);
  vec3 col = vec3(0.0);
  for(int c=0;c<3;c++){
    vec2 uv = (fc * 10.0 - resolution.xy) / resolution.y / 10.0 / bgZoom;
    vec2 panUV = bgCamPx / resolution.y * 5.0;
    uv = uv + panUV;
    uv += vec2(tUVx, tUVy) / 10.0;
    float t = tBase + float(c) / 10.0;
    float scale  = 5.0;
    float scale1 = 1.4;
    for(int i=0;i<20;i++){
      float tt = t * 0.5;
      uv = cos(uv / (2.0 + sin((uv.x + uv.y) / 10.0)) - (uv.yx / (2.0 + sin(fract(tt + uv.x + uv.y)))) / scale) * scale / 1.5 + scale1 * scale;
      uv /= scale1;
      uv = uv.yx + col.xy;
    }
    col[c] = fract(uv.x - uv.y);
  }
  vec3 grey = clamp(col, 0.0, 1.0);
  if(abs(uCosGrad) < 0.0001) return grey;
  float cgInv = uCosGrad < 0.0 ? 0.5 : 0.0;
  // ON 時のみ: 色相を cosine gradient で遷移（Hinotori 方式）
  float t = fract(dot(grey, vec3(0.6, 0.8, 1.0)));
  float qStep = 0.34;
  float qf = t / qStep;
  float qb = floor(qf);
  float qramp = smoothstep(0.45, 1.0, fract(qf));
  t = (qb + qramp) * qStep;
  vec3 cosCol = cosGradColor(t + cgInv);
  return mix(grey, cosCol, abs(uCosGrad));
}

