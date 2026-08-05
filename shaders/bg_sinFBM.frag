// =====================================================
// 4用) bg_sinFBM  ★流体版★
//    curl noise 近似でUVを歪め、流体のような渦巻き動作
// =====================================================
vec3 bg_sinFBM(vec2 fc){
  float bt = getBeat();

  // 時間：水銀のように重く粘性のある流れ
  float t = time * (bpm / 120.0) * 0.88;

  // UV: zoom + pan
  vec2 I = 4.0 * (fc + fc - resolution.xy) / resolution.y / bgZoom;
  I += bgCamPx / resolution.y * 8.0;

  // DRONE: 緩やかに浮遊、BEAT: 拍ごとにジャンプ
  if(isFree()){
    float slow = bt * 0.08;
    I += vec2(fbm1(slow, 41.3), fbm1(slow, 82.7)) * 12.0;
  } else {
    float blk = floor(bt);
    I += vec2(hash21(vec2(blk,13.7)), hash21(vec2(blk,71.3))) * 20.0 - 10.0;
  }

  // 流体的UV歪み（curl場近似）
  vec2 q = vec2(
    sin(I.x * 0.7 + t * 0.4) + sin(I.y * 0.5 - t * 0.3),
    sin(I.y * 0.7 - t * 0.4) + sin(I.x * 0.5 + t * 0.3)
  );
  vec2 r = vec2(
    sin(I.x * 1.3 + q.y * 1.2 + t * 0.7) + sin(I.y * 0.9 + q.x * 0.8 - t * 0.5),
    sin(I.y * 1.3 - q.x * 1.2 + t * 0.7) + sin(I.x * 0.9 - q.y * 0.8 + t * 0.5)
  );
  I += r * 1.8;

  // 元の3パス sin fBm
  vec4 O = vec4(0.0);

  for(int ni = 1; ni <= 2; ni++){
    float n = float(ni);
    I += 1.6 * sin(I.yx * n + t * n) / n;
  }
  O += 1.0 + sin(I.x * 0.8 + 2.0 * vec4(0.0, 1.0, 2.0, 0.0));

  for(int ni = 1; ni <= 2; ni++){
    float n = float(ni);
    I += 1.6 * sin(I.yx * n + t * n) / n;
  }
  O += 1.0 + sin(I.x * 0.8 + 1.0 * vec4(0.0, 1.0, 2.0, 0.0));

  for(int ni = 1; ni <= 2; ni++){
    float n = float(ni);
    I += 1.6 * sin(I.yx * n + t * n) / n;
  }
  O += 1.0 + sin(I.x * 0.8 + 1.0 * vec4(0.0, 1.0, 2.0, 0.0));

  O /= 6.0;

  // === 水銀 / クロムの光沢 ===
  //   流体の傾き(微分)で反射の座標を曲げ、環境の水平線ハイライトが
  //   ブロブの上を転がるように見せる = 水銀の映り込み。
  float h = clamp(dot(O.rgb, vec3(0.4, 0.4, 0.2)), 0.0, 1.0);
  vec2 grad = vec2(dFdx(h), dFdy(h));          // 流体表面の傾き
  // 反射座標: 縦方向 + 傾きで強く曲げる
  float refl = clamp(fc.y / resolution.y + grad.y * 12.0 - grad.x * 6.0 + (h - 0.5) * 0.4, 0.0, 1.0);
  // 環境: 下=暗 / 中=水平線(白く強光) / 上=中明 のクロム反射
  vec3 ground  = vec3(0.02, 0.03, 0.06);
  vec3 horizon = vec3(1.00, 1.00, 1.00);
  vec3 sky     = vec3(0.42, 0.48, 0.60);
  vec3 grey = (refl < 0.5) ? mix(ground, horizon, smoothstep(0.18, 0.50, refl))
                           : mix(horizon, sky,     smoothstep(0.50, 0.72, refl));
  // 鋭い鏡面グリント (水平線付近を一段白く)
  grey += vec3(1.0) * pow(1.0 - abs(refl - 0.5) * 2.0, 8.0) * 0.6;
  grey = clamp(grey, 0.0, 1.0);
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

