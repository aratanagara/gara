// =====================================================
// bg_water
//   Source : Shadertoy https://www.shadertoy.com/view/NdVXDd  by Alex Kluchikov
//   フロー模様をベースに「透明な水」風へ加工 (深い青緑→淡いシアンのグラデ +
//   コースティクスのきらめき + グリント)。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン対応。
//   ヘルパは wk_ で名前空間化。
// =====================================================
#define WK_PI 3.141592654
vec2 wk_rot(vec2 p, float a){
  float c = cos(a*15.83);
  float s = sin(a*15.83);
  return p * mat2(s, c, c, -s);
}
// @param uDetail   8..30   = 30.0
// @param uDensity  25..400  = 100.0
// @param uWarp     0..300   = 100.0
// @param uGlow     0..300   = 100.0
// @param uContrast 25..300  = 100.0
// @param uStreakX 40..200 = 100
// @param uStreakY 40..200 = 100
// @param uSlant 0..300 = 100
// @param uLayerGrowth 0..400 = 100
// @param uWarpRamp 0..400 = 100
// @param uZigzag 0..300 = 100
// @param uCenterX -100..100 = 0
// @param uCenterY -100..100 = 0
// @param uCornerSpread 75..130 = 100
// @param uCausticFreq 40..250 = 100
// @param uSparkleLevel 40..95 = 70
// @param uDepthFade 0..100 = 0
uniform float uDetail;     // 水の層の数 (下げると軽く、うねりが単純になる)
uniform float uDensity;    // 模様の細かさ (%)
uniform float uWarp;       // 層どうしの絡み・歪みの強さ (%)
uniform float uGlow;       // コースティクスの明るさ (%)
uniform float uContrast;   // きらめきの鋭さ (%)
uniform float uStreakX;    // 横方向の縞の細かさ (%)
uniform float uStreakY;    // 縦方向の縞の細かさ (%)
uniform float uSlant;      // 層ごとの斜めの縞の細かさ (%)
uniform float uLayerGrowth; // 奥の層ほど縞が細かくなる度合い (%)
uniform float uWarpRamp;   // 奥の層ほど歪みが強くなる度合い (%)
uniform float uZigzag;     // 斜め縞の層ごとの振り分け (%)
uniform float uCenterX;    // 水面の模様の中心の横位置 (%)
uniform float uCenterY;    // 水面の模様の中心の縦位置 (%)
uniform float uCornerSpread; // 3 つの角から広がる色の種の広がり (%)
uniform float uCausticFreq; // コースティクスの筋の細かさ (%)
uniform float uSparkleLevel; // きらめきが出始める明るさ (%)
uniform float uDepthFade;  // 奥の層ほど寄与を弱める度合い (%)。0 = なし

vec3 bg_water(vec2 fc){
  // ズーム/パン
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = I / resolution.xx;
  uv = vec2(.125, .75) + (uv - vec2(.125, .75)) * (.03 * (uDensity / 100.0));
  if(uCenterX != 0.0 || uCenterY != 0.0){ uv += vec2(uCenterX, uCenterY) / 100.0 * 0.03; }
  float T = time * .65;

  vec3 c = clamp(1. - .7*(uCornerSpread / 100.0)*vec3(
      length(uv - vec2(.1, 0)),
      length(uv - vec2(.9, 0)),
      length(uv - vec2(.5, 1))
      ), 0., 1.) * 2. - 1.;

  vec3 c0 = vec3(0);
  float w0 = 0.;
  const float N = 30.;
  for(float i = 0.; i < N; i++){
    if(i >= floor(uDetail + 0.5)) break;
    float wt = (i*i/N/N - .2) * .3;
    float wp = 0.5 + (i + 1.)*(i + 1.5)*0.001*(uLayerGrowth / 100.0);
    float wb = (.05 + i/N*0.1*(uWarpRamp / 100.0)) * (uWarp / 100.0);
    c.zx = wk_rot(c.zx, 0.1 + T*0.1*wt + (uv.x + .7)*23.*(uStreakX / 100.0)*wp);
    c.xy = wk_rot(c.xy, c.z*c.x*wb + 1.7 + T*wt + (uv.y + 1.1)*15.*(uStreakY / 100.0)*wp);
    c.yz = wk_rot(c.yz, c.x*c.y*wb + 2.4 - T*0.79*wt + (uv.x + uv.y*(fract(i/2.) - 0.25)*4.*(uZigzag / 100.0))*17.*(uSlant / 100.0)*wp);
    c.zx = wk_rot(c.zx, c.y*c.z*wb + 1.6 - T*0.65*wt + (uv.x + .7)*23.*wp);
    float w = (100.5 - i/N);
    if(uDepthFade != 0.0){ w *= 1.0 - uDepthFade / 100.0 * i / N; }
    c0 += c*w;
    w0 += w;
  }
  c0 = c0/w0*2. + .5;
  c0 *= .5 + dot(c0, vec3(1,1,1))/sqrt(3.)*.5;
  c0 += pow(length(sin(c0*WK_PI*4.*(uCausticFreq / 100.0)))/sqrt(3.)*1.0, 20. * (uContrast / 100.0)) * (.3 + .7*c0);

  // === 白黒の水(明るめ) ===
  c0 = clamp(c0, 0.0, 1.5);
  float L = dot(c0, vec3(0.299, 0.587, 0.114));
  float g = smoothstep(0.0, 0.85, L);
  g = 0.40 + 0.60 * g;                                    // 明度を持ち上げて明るく
  g += pow(clamp(L, 0.0, 1.0), 5.0) * 0.5 * (uGlow / 100.0);                // コースティクス(明るい筋)
  g += pow(clamp((L - uSparkleLevel / 100.0)/0.30, 0.0, 1.0), 3.0) * 0.6;  // 鋭いきらめき
  bgAlpha = clamp(g * 0.8, 0.0, 0.78);                     // 半透明の水(暗い谷ほど透ける)
  return vec3(clamp(g, 0.0, 1.0));
}
