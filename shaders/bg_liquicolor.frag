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
// @param uCenterX   -100..100 = 0.0
// @param uCenterY   -100..100 = 0.0
// @param uRollAngle -180..180 = 0.0
// @param uBarrel    -100..100 = 0.0
// @param uTunnelTwist -100..100 = 0.0
// @param uMirrorX   0..100 = 0.0
// @param uMirrorY   0..100 = 0.0
// @param uFieldShiftX -100..100 = 0.0
// @param uFieldShiftZ -100..100 = 0.0
// @param uFieldTurb 0..100 = 0.0
// @param uFieldRotate -180..180 = 0.0
// @param uChromaPhase -180..180 = 0.0
// @param uContour   0..100 = 0.0
// @param uSolarize 0..100 = 0.0
// @param uVignette  -100..100 = 0.0
// @param uFilmGrain 0..100 = 0.0
// @param uPosterize 0..12 = 0.0
// @param uLightTint color = #ffffff
// @param uShadowTint color = #ffffff
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
uniform float uCenterX;   // 流れの中心の左右位置 (%)
uniform float uCenterY;   // 流れの中心の上下位置 (%)
uniform float uRollAngle; // 画面全体の回転 (度)
uniform float uBarrel;    // 視野の樽型・糸巻き型の歪み (%)。負で糸巻き
uniform float uTunnelTwist; // 中心から外へ向かうねじれ (%)。負で逆回り
uniform float uMirrorX;   // 左右対称に折り返す量 (%)。0 で折り返しなし、100 で中心から完全な鏡像
uniform float uMirrorY;   // 上下対称に折り返す量 (%)。0 で折り返しなし、100 で中心から完全な鏡像
uniform float uFieldShiftX; // ノイズ場の位置を横へずらす (%)。別の模様になる
uniform float uFieldShiftZ; // ノイズ場の位置を奥行きへずらす (%)。別の模様になる
uniform float uFieldTurb; // ノイズ場の座標を波打たせる量 (%)
uniform float uFieldRotate; // ノイズ場を回す角度 (度)
uniform float uChromaPhase; // 色チャンネルの回転の位相 (度)。流れの色の組み合わせが変わる
uniform float uContour;   // 明暗を等高線の縞にする量 (%)
uniform float uSolarize; // 明暗を折り返して反転させる量 (%)
uniform float uVignette;  // 周辺の減光 (%)。負で周辺が明るくなる
uniform float uFilmGrain; // フィルムの粒 (%)
uniform float uPosterize; // 明暗の段数。0 で滑らか、2 以上で階調を落とす
uniform vec3  uLightTint; // 明るい部分の色 (掛け算)
uniform vec3  uShadowTint; // 暗い部分の色 (掛け算)

vec3 lq_field(vec3 p){ return vec3(lq_n3(p), lq_n3(p+19.7), lq_n3(p+43.3)); }

vec3 lq_tint(vec3 c, float lum){
  if(uLightTint == vec3(1.0) && uShadowTint == vec3(1.0)) return c;
  return c * mix(uShadowTint, uLightTint, lum);
}

vec3 bg_liquicolor(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 lqUv = (2.0*I - resolution.xy)/resolution.y;
  vec2 lqUv0 = lqUv;
  if(uCenterX != 0.0 || uCenterY != 0.0){ lqUv -= vec2(uCenterX, uCenterY) / 100.0; }
  if(uMirrorX != 0.0){ float lqMa = -(1.0 - uMirrorX / 100.0) * 2.2; lqUv.x = abs(lqUv.x - lqMa) + lqMa; }
  if(uMirrorY != 0.0){ float lqMb = -(1.0 - uMirrorY / 100.0) * 1.2; lqUv.y = abs(lqUv.y - lqMb) + lqMb; }
  if(uBarrel != 0.0){ lqUv *= 1.0 + uBarrel / 100.0 * 0.5 * dot(lqUv, lqUv); }
  if(uTunnelTwist != 0.0){ lqUv = lq_rotate(uTunnelTwist / 100.0 * 1.5 * length(lqUv)) * lqUv; }
  if(uRollAngle != 0.0){ lqUv = lq_rotate(radians(uRollAngle)) * lqUv; }
  vec3 v = normalize(vec3(lqUv, 0.5 * (uFocal / 100.0)));
  vec3 p = vec3(0.5, 0.5, 0.5 + time*0.25) + v*(0.25 * (uLensDepth / 100.0));
  if(uFieldShiftX != 0.0 || uFieldShiftZ != 0.0){ p += vec3(uFieldShiftX, 0.0, uFieldShiftZ) / 100.0 * 2.0; }
  mat2 lqFR = mat2(1.0);
  if(uFieldRotate != 0.0){ lqFR = lq_rotate(radians(uFieldRotate)); }

  const int N = 16;
  int lqCnt = int(uDetail + 0.5);
  vec3 color = vec3(0.0);
  float tailW = 1.0;
  float tailSum = 0.0;
  float tailDecay = exp2(-uTailFade / 100.0 * 0.35);
  if(uFieldTurb != 0.0 || uFieldRotate != 0.0){
    for(int i=0;i<N;i++){
      if(i >= lqCnt) break;
      vec3 fq = p;
      if(uFieldTurb != 0.0){ fq += sin(fq.yzx * 5.0 + fq.zxy * 3.0) * (uFieldTurb / 100.0 * 0.12); }
      if(uFieldRotate != 0.0){ fq.xy = lqFR * (fq.xy - 0.5) + 0.5; }
      vec3 c = normalize(lq_field((fq * vec3(uFieldX / 100.0, uFieldY / 100.0, uFieldZ / 100.0))*(7.0 * (uDensity / 100.0)))*2.0 - vec3(1.0, 1.0, 1.0 + uFieldBias / 100.0));   // 周波数を上げて空間変化を出す
      if(uTailFade != 0.0){ color += c * tailW; tailSum += tailW; tailW *= tailDecay; } else { color += c; }
      v = lq_slerp(v, c, -0.25 * (uWarp / 100.0));
      if(uSwirlStep != 0.0){ v.xy *= lq_rotate(uSwirlStep / 100.0 * 0.3); }
      float stepK = 16.0;
      if(uStepRamp != 0.0) stepK = 16.0 / max(1.0 + uStepRamp / 100.0 * (float(i) / 8.0 - 1.0), 0.15);
      p += v/(stepK * (uStepLen / 100.0));
    }
  } else {
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
  }
  color /= (uTailFade != 0.0) ? tailSum : float(lqCnt);
  if(uChromaPhase != 0.0) color.yz *= lq_rotate(time + radians(uChromaPhase));
  else color.yz *= lq_rotate(time);
  color = tanh(color*(2.0 * (uContrast / 100.0)))*0.5 + 0.5;

  // グレースケール基調
  float lum = clamp(dot(color, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  if(uContour != 0.0) lum = mix(lum, abs(fract(lum * 3.0) * 2.0 - 1.0), uContour / 100.0);
  if(uSolarize != 0.0) lum = mix(lum, abs(lum * 2.0 - 1.0), uSolarize / 100.0);
  if(uVignette != 0.0) lum = clamp(lum * (1.0 - uVignette / 100.0 * 0.08 * dot(lqUv0, lqUv0)), 0.0, 1.0);
  if(uFilmGrain != 0.0){
    float lqG = fract(sin(dot(fc, vec2(12.9898, 78.233)) + floor(time * 24.0) * 3.1) * 43758.5453);
    lum = clamp(lum + (lqG - 0.5) * (uFilmGrain / 100.0) * 0.3, 0.0, 1.0);
  }
  if(uPosterize >= 2.0) lum = floor(lum * uPosterize) / (uPosterize - 1.0);
  lum = clamp(lum, 0.0, 1.0);
  vec3 grey = vec3(lum);

  // Cos Grad: OFF(0) でグレースケール、ON で iq パレットに遷移
  if(abs(uCosGrad) < 0.0001) return lq_tint(grey, lum);
  float cgInv = uCosGrad < 0.0 ? 0.5 : 0.0;
  // パレット入力は画面で大きく変化させる(一色化を防ぐ)。flow の色相 + 明度で。
  float t = fract(atan(color.b - color.r, color.g - color.r) * 0.159 + lum*1.3 + time*0.03);
  vec3 cosCol = cosGradColor(t + cgInv);
  vec3 colored = cosCol * (lum * 2.0);           // グレーの明暗を保って着色
  return lq_tint(mix(grey, colored, abs(uCosGrad)), lum);
}
