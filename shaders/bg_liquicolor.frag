// =====================================================
// bg_liquicolor
//   Source : Shadertoy "liquicolor" https://www.shadertoy.com/view/Xc3SDf
//   3Dノイズ場を流れる視線ベクトルの蓄積。元のボリュームテクスチャを手続き3Dノイズで代替。
//   出力はグレースケール、Post FX の Cos Grad (uCosGrad) で彩色(デフォ=グレースケール)。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは lq_ で名前空間化。
// =====================================================
mat2 lq_rotate(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }

float lq_h31(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float lq_n3(vec3 x){
  vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(lq_h31(i+vec3(0,0,0)), lq_h31(i+vec3(1,0,0)), f.x),
                 mix(lq_h31(i+vec3(0,1,0)), lq_h31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(lq_h31(i+vec3(0,0,1)), lq_h31(i+vec3(1,0,1)), f.x),
                 mix(lq_h31(i+vec3(0,1,1)), lq_h31(i+vec3(1,1,1)), f.x), f.y), f.z);
}
vec3 lq_field(vec3 p){ return vec3(lq_n3(p), lq_n3(p+19.7), lq_n3(p+43.3)); }

vec3 lq_slerp(vec3 a, vec3 b, float t){
  float c = clamp(dot(a,b), -1.0, 1.0);
  float theta = acos(c) * t;
  vec3 rel = normalize(b - a*c + 1e-6);
  return a*cos(theta) + rel*sin(theta);
}

// @param uDetail   4..16   = 16.0
// @param uDensity  25..300 = 100.0
// @param uWarp     0..300  = 100.0
// @param uContrast 25..300 = 100.0
// @param uStepLen   50..200 = 100.0
// @param uFieldBias -40..40 = 0.0
// @param uFieldX    50..200 = 100.0
// @param uFieldY    50..200 = 100.0
// @param uFieldZ    50..200 = 100.0
// @param uLensDepth 25..300 = 100.0
// @param uFocal     50..200 = 100.0
// @param uSwirlStep -100..100 = 0.0
// @param uStepRamp  -100..100 = 0.0
// @param uTailFade  0..200 = 0.0
uniform float uDetail;    // 視線を流す反復回数 (下げると軽く、流れが短くなる)
uniform float uDensity;   // ノイズ場の細かさ (%)
uniform float uWarp;      // 視線の曲げ具合 (%)
uniform float uContrast;  // コントラスト (%)
uniform float uStepLen;   // 1 ステップで流れる距離 (%)。下げると流れが短く密、上げると長く伸びる
uniform float uFieldBias; // ノイズ場の奥行き方向の偏り (%)。流れが手前/奥へ寄る
uniform float uFieldX;    // ノイズ場の X 方向の細かさ (%)
uniform float uFieldY;    // ノイズ場の Y 方向の細かさ (%)
uniform float uFieldZ;    // ノイズ場の Z (奥行き) 方向の細かさ (%)
uniform float uLensDepth; // 視点から場に入る初期オフセット (%)
uniform float uFocal;     // 画角の焦点距離 (%)。下げると広角で歪む
uniform float uSwirlStep; // ステップごとの視線のねじれ (%)。負で逆回り
uniform float uStepRamp;  // 後のステップほど歩幅を変える量 (%)
uniform float uTailFade;  // 後のステップの寄与を弱める量 (%)。流れの尾が薄くなる

vec3 bg_liquicolor(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec3 v = normalize(vec3((2.0*I - resolution.xy)/resolution.y, 0.5 * (uFocal / 100.0)));
  vec3 p = vec3(0.5, 0.5, 0.5 + time*0.25) + v*(0.25 * (uLensDepth / 100.0));

  const int N = 16;
  int lqCnt = int(uDetail + 0.5);
  vec3 color = vec3(0.0);
  float tailW = 1.0;
  float tailSum = 0.0;
  float tailDecay = exp2(-uTailFade / 100.0 * 0.35);
  for(int i=0;i<N;i++){
    if(i >= lqCnt) break;
    vec3 c = normalize(lq_field((p * vec3(uFieldX / 100.0, uFieldY / 100.0, uFieldZ / 100.0))*(7.0 * (uDensity / 100.0)))*2.0 - vec3(1.0, 1.0, 1.0 + uFieldBias / 100.0));   // 周波数を上げて空間変化を出す
    if(uTailFade != 0.0){ color += c * tailW; tailSum += tailW; tailW *= tailDecay; } else { color += c; }
    v = lq_slerp(v, c, -0.25 * (uWarp / 100.0));
    if(uSwirlStep != 0.0){ v.xy *= lq_rotate(uSwirlStep / 100.0 * 0.3); }
    float stepK = 16.0;
    if(uStepRamp != 0.0) stepK = 16.0 / max(1.0 + uStepRamp / 100.0 * (float(i) / 8.0 - 1.0), 0.15);
    p += v/(stepK * (uStepLen / 100.0));
  }
  color /= (uTailFade != 0.0) ? tailSum : float(lqCnt);
  color.yz *= lq_rotate(time);
  color = tanh(color*(2.0 * (uContrast / 100.0)))*0.5 + 0.5;

  // グレースケール基調
  float lum = clamp(dot(color, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  vec3 grey = vec3(lum);

  // Cos Grad: OFF(0) でグレースケール、ON で iq パレットに遷移
  if(abs(uCosGrad) < 0.0001) return grey;
  float cgInv = uCosGrad < 0.0 ? 0.5 : 0.0;
  // パレット入力は画面で大きく変化させる(一色化を防ぐ)。flow の色相 + 明度で。
  float t = fract(atan(color.b - color.r, color.g - color.r) * 0.159 + lum*1.3 + time*0.03);
  vec3 cosCol = cosGradColor(t + cgInv);
  vec3 colored = cosCol * (lum * 2.0);           // グレーの明暗を保って着色
  return mix(grey, colored, abs(uCosGrad));
}
