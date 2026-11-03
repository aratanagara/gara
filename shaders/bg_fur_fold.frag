// =====================================================
// bg_fur_fold  —  毛羽立つ折り畳みフラクタル
//   Source : Yohei Nishitsuji (@YoheiNishitsuji) #つぶやきGLSL
//            https://x.com/YoheiNishitsuji/status/2116687150376988716
//   移植: 既定値で元のコードと同じ絵になる。rotate3D / hsv は twigl の定義
//   軽量化: 回転行列と折り畳み量はピクセルに依らないのでループの外で 1 度だけ計算。
//           物体を通り抜けるか光が飽和したら行進を打ち切る
//   追加: beat モードは拍頭で進み、毛が太って光る。iAudio も同じ (uKick)。
//         背景は透過 (bgAlpha)。bgZoom・bgCamPx でズーム/パン
// =====================================================

// @param uSpeed    0..300    = 100.0
// @param uSize     20..300   = 100.0
// @param uTwist    0..300    = 100.0
// @param uRock     0..300    = 100.0
// @param uWarp     0..300    = 100.0
// @param uFreq     20..300   = 100.0
// @param uShift    0..300    = 100.0
// @param uFold     50..150   = 100.0
// @param uBreath   0..300    = 100.0
// @param uRadius   20..300   = 100.0
// @param uSharp    20..300   = 100.0
// @param uGlow     10..300   = 100.0
// @param uKick     0..200    = 100.0
// @param uSteps    20..100   = 100.0
// @param uFolds    5..8      = 8.0
// @param uInk      color     = #e6dac8
uniform float uSpeed;    // 動きの速さ (%)
uniform float uSize;     // 大きさ (%)
uniform float uTwist;    // 折り畳みごとの回転 (%)
uniform float uRock;     // 回転の揺れ (%)
uniform float uWarp;     // 正弦波のうねり (%)
uniform float uFreq;     // うねりの細かさ (%)
uniform float uShift;    // 折り畳みのずれ (%)
uniform float uFold;     // 折り畳みの幅 (%)
uniform float uBreath;   // 折り畳みの幅の呼吸 (%)
uniform float uRadius;   // 毛の太さ (%)
uniform float uSharp;    // 光の締まり (%)
uniform float uGlow;     // 光の強さ (%)
uniform float uKick;     // 拍 / 音の効き (%)
uniform float uSteps;    // 行進の回数 (下げると軽く、毛が粗くなる)
uniform float uFolds;    // 折り畳みの回数
uniform vec3  uInk;      // 色

mat3 ff_rot(float angle, vec3 axis){
  vec3 a = normalize(axis);
  float s = sin(angle), c = cos(angle), r = 1.0 - c;
  return mat3(a.x*a.x*r + c,     a.y*a.x*r + a.z*s, a.z*a.x*r - a.y*s,
              a.x*a.y*r - a.z*s, a.y*a.y*r + c,     a.z*a.y*r + a.x*s,
              a.x*a.z*r + a.y*s, a.y*a.z*r - a.x*s, a.z*a.z*r + c);
}

vec3 bg_fur_fold(vec2 fc){
  float bt   = getBeat();
  float kick = uKick * 0.01;
  // 時間: beat モードは拍頭で加速→減速 (単調増加)、drone は元の速さ
  float T, burst;
  if(isFree()){
    T = time;
    burst = 0.0;
  } else {
    float fb = fract(bt);
    T = (floor(bt) + mix(fb, 1.0 - pow(1.0 - fb, 3.0), clamp(kick, 0.0, 1.0))) * 0.5;
    burst = pow(1.0 - fb, 4.0) * kick;
  }
  T *= uSpeed * 0.01;
  float audio = clamp(iAudio, 0.0, 1.0) * kick;

  vec2 I  = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = (I - 0.5*resolution) / resolution.y * 2.5 * 100.0 / max(uSize, 5.0);

  mat3  R     = ff_rot(0.9*uTwist*0.01 - sin(T)*0.4*uRock*0.01, vec3(1.0, 2.0, 3.0));
  float warp  = 0.2 * uWarp * 0.01;
  float freq  = 3.0 * uFreq * 0.01;
  float shift = 0.3 * uShift * 0.01;
  float fold[8];
  for(int j = 0; j < 8; j++) fold[j] = 0.65*uFold*0.01 - cos(T + float(j + 1))*0.1*uBreath*0.01;

  float rad   = 0.6*uRadius*0.01 + 0.07*burst + 0.1*audio;
  float sharp = 5e3 * uSharp * 0.01;
  vec3  gain  = uInk / 6e1 * uGlow * 0.01 * (1.0 + 0.5*burst + 0.6*audio);

  int   N = int(clamp(uSteps, 1.0, 100.0));
  int   F = int(clamp(uFolds, 1.0, 8.0));
  vec3  o = vec3(0.0);
  float g = 0.0;                                         // 開始を変えると毛の形が変わる (g の差が折り畳みで増幅される)
  for(int i = 0; i < N; i++){
    vec3 p = vec3(uv, g - 9.0);
    for(int j = 0; j < F; j++){
      p = p * R;
      p += sin(p.yzx*freq + T) * warp;
      p = abs(p + p + shift) - fold[j];
    }
    float e = (length(p.xy) - rad) / 7.5e2;
    g += e;
    o = min(o + exp2(-e*sharp)*gain, vec3(1.0));
    if(g > 12.5 || dot(vec3(1.0) - o, gain) <= 0.0) break;   // 通り抜けた / 光が飽和した
  }

  // 暗い毛も早めに不透明にして、明るい背景に重ねても陰影を残す。
  // Slot B の合成は mix(下, 色, a) なので、色を割り戻して黒の上で Slot A と同じ絵にする
  bgAlpha = clamp(max(o.r, max(o.g, o.b)) * 3.0, 0.0, 1.0);
  return uSlotIsA > 0.5 ? o : o / max(bgAlpha, 1e-4);
}
