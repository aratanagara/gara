// =====================================================
// 4用) bg_sinFBM  ★流体版★
//    curl noise 近似でUVを歪め、流体のような渦巻き動作
// =====================================================
// @param uWarp  0..300 = 100.0
// @param uTurb  0..150 = 100.0
// @param uSheen 0..300 = 100.0
// @param uGlow  0..300 = 100.0
uniform float uWarp;    // 流体の大きな渦の歪み (%)
uniform float uTurb;    // 細かい乱流のうねり (%)
uniform float uSheen;   // 水銀の反射が傾きで曲がる量 (%)
uniform float uGlow;    // 水平線のグリントの強さ (%)
// @param uFlowScale 50..160 = 100.0
// @param uFlowCouple  0..250   = 100.0
// @param uStretch 60..160 = 100.0
// @param uBandFreq 40..200 = 100.0
// @param uHorizon     25..75   = 50.0
// @param uHorizonSoft 40..200 = 100.0
// @param uGlintSharp 10..200 = 100.0
// @param uBulge       0..300   = 100.0
// @param uSheenCross  -200..300 = 100.0
// @param uSkyLight    25..200  = 100.0
uniform float uFlowScale; // 大きな渦の細かさ (%)。大きいほど渦が小さく密になる
uniform float uFlowCouple; // 渦同士が巻き込み合う強さ (%)
uniform float uStretch; // 縦方向の引き伸ばし (%)。下げると縦に潰れた流れになる
uniform float uBandFreq; // 色の帯 (縞) の細かさ (%)
uniform float uHorizon; // 反射の水平線の高さ (%)
uniform float uHorizonSoft; // 水平線の立ち上がりのなだらかさ (%)
uniform float uGlintSharp; // 水平線グリントの鋭さ (%)
uniform float uBulge; // 塊の高さが反射を押し上げる量 (%)
uniform float uSheenCross; // 傾きの横成分が反射を曲げる量 (%)。負で逆向き
uniform float uSkyLight; // 上側 (空) の反射の明るさ (%)

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

  I.y *= uStretch / 100.0;

  // 流体的UV歪み（curl場近似）
  vec2 Ic = I * (uFlowScale / 100.0);
  float cp = uFlowCouple / 100.0;
  vec2 q = vec2(
    sin(Ic.x * 0.7 + t * 0.4) + sin(Ic.y * 0.5 - t * 0.3),
    sin(Ic.y * 0.7 - t * 0.4) + sin(Ic.x * 0.5 + t * 0.3)
  );
  vec2 r = vec2(
    sin(Ic.x * 1.3 + q.y * 1.2 * cp + t * 0.7) + sin(Ic.y * 0.9 + q.x * 0.8 * cp - t * 0.5),
    sin(Ic.y * 1.3 - q.x * 1.2 * cp + t * 0.7) + sin(Ic.x * 0.9 - q.y * 0.8 * cp + t * 0.5)
  );
  I += r * 1.8 * (uWarp / 100.0);

  // 元の3パス sin fBm
  vec4 O = vec4(0.0);

  for(int ni = 1; ni <= 2; ni++){
    float n = float(ni);
    I += 1.6 * (uTurb / 100.0) * sin(I.yx * n + t * n) / n;
  }
  O += 1.0 + sin(I.x * 0.8 * (uBandFreq / 100.0) + 2.0 * vec4(0.0, 1.0, 2.0, 0.0));

  for(int ni = 1; ni <= 2; ni++){
    float n = float(ni);
    I += 1.6 * (uTurb / 100.0) * sin(I.yx * n + t * n) / n;
  }
  O += 1.0 + sin(I.x * 0.8 * (uBandFreq / 100.0) + 1.0 * vec4(0.0, 1.0, 2.0, 0.0));

  for(int ni = 1; ni <= 2; ni++){
    float n = float(ni);
    I += 1.6 * (uTurb / 100.0) * sin(I.yx * n + t * n) / n;
  }
  O += 1.0 + sin(I.x * 0.8 * (uBandFreq / 100.0) + 1.0 * vec4(0.0, 1.0, 2.0, 0.0));

  O /= 6.0;

  // === 水銀 / クロムの光沢 ===
  //   流体の傾き(微分)で反射の座標を曲げ、環境の水平線ハイライトが
  //   ブロブの上を転がるように見せる = 水銀の映り込み。
  float h = clamp(dot(O.rgb, vec3(0.4, 0.4, 0.2)), 0.0, 1.0);
  vec2 grad = vec2(dFdx(h), dFdy(h));          // 流体表面の傾き
  // 反射座標: 縦方向 + 傾きで強く曲げる
  float refl = clamp(fc.y / resolution.y + grad.y * 12.0 * (uSheen / 100.0) - grad.x * 6.0 * (uSheen / 100.0) * (uSheenCross / 100.0) + (h - 0.5) * 0.4 * (uBulge / 100.0), 0.0, 1.0);
  // 環境: 下=暗 / 中=水平線(白く強光) / 上=中明 のクロム反射
  vec3 ground  = vec3(0.02, 0.03, 0.06);
  vec3 horizon = vec3(1.00, 1.00, 1.00);
  vec3 sky     = vec3(0.42, 0.48, 0.60);
  sky *= uSkyLight / 100.0;
  float hz = uHorizon / 100.0;
  float hs = uHorizonSoft / 100.0;
  float hLo = 0.18, hHi = 0.72;
  if(uHorizon != 50.0 || uHorizonSoft != 100.0){ hLo = hz - 0.32 * hs; hHi = hz + 0.22 * hs; }
  vec3 grey = (refl < hz) ? mix(ground, horizon, smoothstep(hLo, hz, refl))
                          : mix(horizon, sky,     smoothstep(hz, hHi, refl));
  // 鋭い鏡面グリント (水平線付近を一段白く)
  grey += vec3(1.0) * pow(max(1.0 - abs(refl - hz) * 2.0, 0.0), 8.0 * (uGlintSharp / 100.0)) * 0.6 * (uGlow / 100.0);
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

