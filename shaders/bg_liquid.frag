// =====================================================
// bg_liquid
//   Source : Shadertoy "- liquid -" https://www.shadertoy.com/view/ftd3zX
//   Author : anahit_movsesyan
//   vj ツールの bg 形式に適合 (mainImage → bg 関数 / iTime,iResolution → time,resolution
//   / bgZoom・bgCamPx でズーム/パン対応)。ヘルパは lq_ で名前空間化し衝突回避。
// =====================================================
float lq_rand(vec2 p){
  return fract(sin(dot(p, vec2(12.99, 78.233))) * 43758.545);
}
float lq_noise(vec2 p){
  vec2 f = fract(p);
  f = f * f * f * f * (3.0 - 2.0 * f) * (3.0 - 2.0 * f);
  vec2 i = floor(p);
  return mix(mix(lq_rand(i + vec2(0, 0)), lq_rand(i + vec2(1, 0)), f.x),
             mix(lq_rand(i + vec2(0, 1)), lq_rand(i + vec2(1, 1)), f.x), f.y);
}
// @param uDetail   1..4    = 4.0
// @param uDensity  25..400 = 100.0
// @param uWarp     0..300  = 100.0
// @param uContrast 50..300 = 100.0
// @param uGlow     25..250 = 100.0
uniform float uDetail;    // fbm のオクターブ数 (下げると軽く、模様が粗くなる)
uniform float uDensity;   // 模様の細かさ (%)
uniform float uWarp;      // 流れの歪み量 (%)
uniform float uContrast;  // コントラスト (%。上げると明暗がはっきりする)
uniform float uGlow;      // 明るさ (%)
// @param uLacun    80..130   = 100.0
// @param uGain     75..115   = 100.0
// @param uOctShift 0..300    = 100.0
// @param uAspect   40..250   = 100.0
// @param uWarpX    0..250    = 100.0
// @param uWarpY    0..250    = 100.0
// @param uInner    0..250    = 100.0
// @param uTurn     -180..180 = 0.0
// @param uSwirl    -300..300 = 0.0
// @param uWobble   0..300    = 0.0
// @param uRidge    0..60     = 0.0
// @param uCenterX  -100..100 = 0
// @param uCenterY  -100..100 = 0
// @param uMirror   -80..80    = 0
// @param uFlowSkew -100..100 = 0
// @param uWarpTurn -180..180 = 0
// @param uBreath   0..100    = 0
// @param uContour  0..100    = 0
// @param uVignette 0..150    = 0
// @param uGrain    0..100    = 0
// @param uShadeTint color    = #ffffff
// @param uLightTint color    = #ffffff
uniform float uLacun;     // オクターブごとの周波数の倍率 (%)。上げると細部が一気に細かくなる
uniform float uGain;      // オクターブごとの振幅の減衰 (%)。上げると細かい模様が強く残る
uniform float uOctShift;  // オクターブ間のずらし量 (%)。層の重なり方が変わる
uniform float uAspect;    // 模様の横幅の比 (%)。上げると横に詰まり縦縞気味に
uniform float uWarpX;     // 横方向の流れの歪み (%)
uniform float uWarpY;     // 縦方向の流れの歪み (%)
uniform float uInner;     // 最終段のドメイン歪みの量 (%)。0 で歪みなしの素の fbm
uniform float uTurn;      // 模様全体の回転 (度)
uniform float uSwirl;     // 中心からの距離に比例したねじれ (%)。負で逆回り
uniform float uWobble;    // 座標のうねり (%)。0 = なし
uniform float uRidge;     // 稜線化 (%)。0 = なめらか / 上げると筋状の尾根になる
uniform float uCenterX;   // 模様の見る位置の横ずらし (%)
uniform float uCenterY;   // 模様の見る位置の縦ずらし (%)
uniform float uMirror;    // 左右の鏡像の折り返し位置 (%)。0 = なし / 正で右寄り・負で左寄りに折る
uniform float uFlowSkew;  // 模様の斜めのせん断 (%)。流れが斜めに傾く
uniform float uWarpTurn;  // 流れの歪みの向きの回転 (度)。流れの渦の巻き方が変わる
uniform float uBreath;    // 模様が拡大縮小する呼吸の振れ幅 (%)
uniform float uContour;   // 等高線の濃さ (%)。液面に筋が入る
uniform float uVignette;  // 画面の周辺を暗くする量 (%)
uniform float uGrain;     // 粒状ノイズの量 (%)
uniform vec3 uShadeTint;  // 暗い部分にかけるティント。既定は白で変化なし
uniform vec3 uLightTint;  // 明るい部分にかけるティント。既定は白で変化なし

float lq_fbm(vec2 p){
  float v = 0.0;
  float a = 1.0;
  for(int i = 0; i < 4; ++i){
    if(i >= int(uDetail + 0.5)) break;
    p = (1.5 * (uLacun / 100.0)) * p + 15.0 * (uOctShift / 100.0);
    a *= 0.5 * (uGain / 100.0);
    v += a * lq_noise(p);
  }
  if(uRidge != 0.0){
    float rg = 0.9 * pow(clamp(1.0 - abs(v - 0.47) * 2.0, 0.0, 1.0), 3.0);
    v = mix(v, rg, uRidge / 100.0);
  }
  return v;
}
vec3 bg_liquid(vec2 fc){
  // ズーム/パン: 中心基準でスケールしてからパン
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 p = 2.0 * I / resolution.y * (uDensity / 100.0);
  p.x *= uAspect / 100.0;
  if(uTurn != 0.0){ float ta = radians(uTurn); float ca = cos(ta), sa = sin(ta); p = mat2(ca, -sa, sa, ca) * p; }
  if(uSwirl != 0.0){ float sw = length(p) * uSwirl / 200.0; float cs = cos(sw), ss = sin(sw); p = mat2(cs, -ss, ss, cs) * p; }
  if(uMirror != 0.0){ float mx = resolution.x / resolution.y * (uDensity / 100.0) * (uAspect / 100.0); float ax = mx * (1.0 + uMirror / 100.0); p.x = ax + abs(p.x - ax); }
  if(uCenterX != 0.0 || uCenterY != 0.0){ p += vec2(uCenterX, uCenterY) / 100.0 * 2.0; }
  if(uFlowSkew != 0.0){ p.x += p.y * uFlowSkew / 100.0; }
  if(uBreath != 0.0){ p *= 1.0 + sin(time * 0.9) * uBreath / 200.0; }
  if(uWobble != 0.0){ p += sin(p.yx * 2.3 + 1.7) * (uWobble / 300.0); }
  float t = time * 2.0;   // 2倍速

  vec2 r1 = vec2(lq_fbm(p + 0.02 * t),  lq_fbm(p + 0.005 * t));
  if(uWarpTurn != 0.0){ float wa = radians(uWarpTurn); float wc = cos(wa), ws = sin(wa); r1 = mat2(wc, -ws, ws, wc) * r1; }
  vec2 r2 = vec2(lq_fbm(p + 0.15 * t + 10.0 * (uWarp / 100.0) * (uWarpX / 100.0) * r1),
                 lq_fbm(p + 0.12 * t + 12.0 * (uWarp / 100.0) * (uWarpY / 100.0) * r1));
  float v = 1.8 * (uGlow / 100.0) * pow(lq_fbm(p + r2 * (uInner / 100.0)), 2.0 * (uContrast / 100.0)) + 0.03;
  if(uContour != 0.0){ float cf = abs(fract(v * 5.0) - 0.5) * 2.0; v *= 1.0 - uContour / 100.0 * (1.0 - smoothstep(0.0, 0.5, cf)) * 0.8; }
  vec3 col = vec3(v);
  if(uShadeTint != vec3(1.0) || uLightTint != vec3(1.0)){ col *= mix(uShadeTint, uLightTint, clamp(v, 0.0, 1.0)); }
  if(uVignette != 0.0){ vec2 vq = (fc - 0.5 * resolution.xy) / resolution.y; col *= 1.0 - clamp(uVignette / 100.0, 0.0, 1.5) * smoothstep(0.25, 0.95, length(vq)); }
  if(uGrain != 0.0){ col += (lq_rand(fc + fract(time) * 97.0) - 0.5) * uGrain / 100.0 * 0.3; }
  return col;
}
