// Source : https://www.shadertoy.com/view/7sKSDd
// License: Shadertoy default (CC BY-NC-SA 3.0) unless noted by the author
// @param uDetail   1..6     = 6.0
// @param uDensity  50..400  = 100.0
// @param uWarp     0..300   = 100.0
// @param uFeedback 0..300   = 100.0
// @param uAngle -180..180 = 0.0
// @param uFoldPeriod  80..130 = 100.0
// @param uCrossX      80..130 = 100.0
// @param uCrossY      80..130 = 100.0
// @param uPinchX      80..130 = 100.0
// @param uPinchY      80..130 = 100.0
// @param uWaveFreqX   50..200 = 100.0
// @param uWaveFreqY   50..200 = 100.0
// @param uWaveCos     0..200 = 100.0
// @param uInject      70..130 = 100.0
// @param uBands       50..300 = 100.0
// @param uSkew        -100..100 = 0.0
// @param uSwirl       -200..200 = 0.0
// @param uChannelSplit 0..100 = 0.0
uniform float uDetail;    // 折り畳みの反復回数 (下げると軽く、模様が粗くなる)
uniform float uDensity;   // 模様の密度 (%)
uniform float uWarp;      // 歪み (うねり) の強さ (%)
uniform float uFeedback;  // 色の回り込み (チャンネル間フィードバック) の強さ (%)
uniform float uAngle; // 向き (度。固定角でずらす)
uniform float uFoldPeriod;  // 折り畳みの周期 (%)。下げると細かく折れる
uniform float uCrossX;      // 折り畳み前の X 成分の混ぜ具合 (%)
uniform float uCrossY;      // 折り畳み前の Y 成分の混ぜ具合 (%)
uniform float uPinchX;      // 折り畳み後に掛ける (X − Y) の X 側の重み (%)
uniform float uPinchY;      // 折り畳み後に掛ける (X − Y) の Y 側の重み (%)
uniform float uWaveFreqX;   // うねりの X 方向の波数 (%)
uniform float uWaveFreqY;   // うねりの Y 方向の波数 (%)
uniform float uWaveCos;     // Y 方向のうねりの振れ幅 (%)。0 で X 方向のみ
uniform float uInject;      // 各段で色へ足し込む量 (%)
uniform float uBands;       // 出力の縞の本数 (%)
uniform float uSkew;        // 初期座標の横ずれ (%)。Y に比例して X をずらす
uniform float uSwirl;       // 中心からの距離に比例したねじれ (%)。負で逆回り
uniform float uChannelSplit; // RGB チャンネルごとの座標のずれ (%)

vec3 bg_7sKSDd(vec2 fc){
  float bt = getBeat();
  float tx = randomMoveTime(bt, TAU * 0.08, 201.0);
  float ty = randomMoveTime(bt, TAU * 0.06, 202.0);
  vec3 col = vec3(0.0);
  vec2 uv1 = (fc * 10.0 - resolution.xy) / resolution.y / 10.0 / bgZoom * (uDensity / 100.0);
  float a7 = radians(uAngle);
  uv1 = mat2(cos(a7), -sin(a7), sin(a7), cos(a7)) * uv1;
  vec2 panUV = bgCamPx / resolution.y * 5.0;
  uv1 = uv1 + panUV;
  uv1 += vec2(tx, ty) / 10.0;
  if(uSkew != 0.0) uv1.x += uv1.y * uSkew / 100.0;
  if(uSwirl != 0.0){ float ta = length(uv1) * uSwirl / 100.0; float ca = cos(ta), sa = sin(ta); uv1 = mat2(ca, -sa, sa, ca) * uv1; }
  for(int c=0;c<3;c++){
    vec2 uv = uv1;
    if(uChannelSplit != 0.0) uv += float(c) * uChannelSplit / 100.0 * vec2(0.2, 0.13);
    for(int i=0;i<6;i++){
      if(i >= int(uDetail + 0.5)) break;
      uv = fract((uv.y * (uCrossY / 100.0) + uv.x * (uCrossX / 100.0) + uv) / (1.5 * (uFoldPeriod / 100.0))) * (1.5 * (uFoldPeriod / 100.0));
      uv *= (uv.x * (uPinchX / 100.0) - uv.y * (uPinchY / 100.0));
      uv += 0.06 * (uWarp / 100.0) * vec2(sin(bt * 0.9 + uv.y * 3.0 * (uWaveFreqY / 100.0)),
                        cos(bt * 0.8 + uv.x * 3.0 * (uWaveFreqX / 100.0)) * (uWaveCos / 100.0));
      col += col.yzx * (uv.x + uv.y) / 8.0 * (uFeedback / 100.0);
      col[c] += (uv.y - uv.x) * (uInject / 100.0);
    }
  }
  vec3 base = fract(col * (uBands / 100.0));
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

