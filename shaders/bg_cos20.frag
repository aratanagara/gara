// 7) cos 20 loop
// @param uDetail  2..20 = 20.0
// @param uWarp    75..150 = 100.0
// @param uDensity 80..190 = 100.0
// @param uChroma  0..500 = 100.0
// @param uDrift   0..400 = 100.0
// @param uBend    70..130 = 100.0
// @param uRipple  0..200 = 100.0
// @param uShear   50..300 = 100.0
// @param uMirror  0..100 = 0.0
// @param uFeed    25..300 = 100.0
// @param uPush    40..200 = 100.0
// @param uFold    85..125 = 100.0
// @param uStripes 25..400 = 100.0
// @param uTwirl   -300..300 = 0.0
uniform float uDetail; // 反復回数 (下げると軽く、模様が粗くなる)
uniform float uWarp; // 歪みの強さ (%)
uniform float uDensity; // 模様の密度 (%)
uniform float uChroma; // RGB チャンネル間のずれ (%)
uniform float uDrift; // 全体の漂いの振れ幅 (%)
uniform float uBend; // 1 段目の折り返しの分母 (%)。下げると渦が締まり鋭く折れる
uniform float uRipple; // 対角方向のさざ波の細かさ (%)。0 で波打ちなし
uniform float uShear; // 2 段目 (入れ替え軸) の分母 (%)。下げると横ずれが強まる
uniform float uMirror; // 左右の鏡像対称 (%)。0 = なし / 100 で完全な左右対称
uniform float uFeed; // 前チャンネルの色を座標へ戻す量 (%)。RGB の絡み合い
uniform float uPush; // 各段の平行移動量 (%)
uniform float uFold; // 各段の振れ幅 (%)
uniform float uStripes; // 縞の本数 (%)
uniform float uTwirl; // 中心からの距離に比例したねじれ (%)。0 = なし / 負で逆回り

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
    uv += vec2(tUVx, tUVy) / 10.0 * (uDrift / 100.0);
    if(uMirror > 0.0) uv.x = mix(uv.x, abs(uv.x), uMirror / 100.0);
    if(uTwirl != 0.0){ float ta = length(uv) * uTwirl / 100.0; float ca = cos(ta), sa = sin(ta); uv = mat2(ca, -sa, sa, ca) * uv; }
    float t = tBase + float(c) / 10.0 * (uChroma / 100.0);
    float scale  = 5.0 * (uWarp / 100.0);
    float scale1 = 1.4 * (uDensity / 100.0);
    for(int i=0;i<20;i++){
      if(i >= int(uDetail + 0.5)) break;
      float tt = t * 0.5;
      uv = cos(uv / (2.0 * (uBend / 100.0) + sin((uv.x + uv.y) / 10.0 * (uRipple / 100.0))) - (uv.yx / (2.0 * (uShear / 100.0) + sin(fract(tt + uv.x + uv.y)))) / scale) * scale / 1.5 * (uFold / 100.0) + scale1 * scale * (uPush / 100.0);
      uv /= scale1;
      uv = uv.yx + col.xy * (uFeed / 100.0);
    }
    col[c] = fract((uv.x - uv.y) * (uStripes / 100.0));
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

