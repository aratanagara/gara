// =====================================================
// bg_rainbowWater
//   Source : Shadertoy "rainbow water" https://www.shadertoy.com/view/dtySRR
//   Author : flylo
//   元シェーダは Buffer A が本体 (Image パスは素通しコピー) なので Buffer A を移植。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン対応。
//   ヘルパは rw_ で名前空間化。
// =====================================================
// @param uDetail 6..25 = 25.0
// @param uWarp 0..180 = 100.0
// @param uDensity 40..170 = 100.0
// @param uContrast 40..130 = 100.0
// @param uGlow 0..300 = 100.0
uniform float uDetail;   // 波紋の重ね数 (下げると軽く、模様が粗くなる)
uniform float uWarp;   // 水面の歪みの強さ (%)
uniform float uDensity;   // 波紋の密度 (%)
uniform float uContrast;   // 明暗のコントラスト (%)
uniform float uGlow;   // きらめき・コースティクスの強さ (%)
// @param uSourceSpread 30..200 = 100.0
// @param uRingStretch  40..250 = 100.0
// @param uSkew         -100..100 = 0.0
// @param uFreqGrow 0..180 = 100.0
// @param uAmpDecay 92..140 = 100.0
// @param uRingSharp 70..250 = 100.0
// @param uWarpPasses   1..5    = 5.0
// @param uWarpFalloff 60..125 = 100.0
// @param uWarpFreqGain 70..125 = 100.0
// @param uCausticSharp 60..400 = 100.0
// @param uSparkleLevel 60..130 = 100.0
// @param uCenterX -100..100 = 0
// @param uCenterY -100..100 = 0
// @param uRotate -180..180 = 0
// @param uMirrorAxis -100..100 = 0
// @param uSwirl -100..100 = 0
// @param uMosaic 0..60 = 0
// @param uWarpTurn -180..180 = 0
// @param uRainbow 0..200 = 0
// @param uBands 0..6 = 0
// @param uTopFade -100..100 = 0
// @param uGrain 0..100 = 0
// @param uVignette 0..100 = 0
// @param uWaterColor color = #ffffff
// @param uCausticColor color = #ffffff
// @param uSparkleColor color = #ffffff
uniform float uSourceSpread; // 波源の散らばり (%)。下げると中央に集まる
uniform float uRingStretch; // 波紋の横の伸び (%)。楕円の波になる
uniform float uSkew; // 波紋の斜めのずらし (%)。負で逆向き
uniform float uFreqGrow; // 重ねるごとに波が細かくなる速さ (%)
uniform float uAmpDecay; // 重ねるごとの波の弱まり方 (%)
uniform float uRingSharp; // 波の山の鋭さ (%)。大きいほど細い輪
uniform float uWarpPasses; // 歪みを重ねる回数
uniform float uWarpFalloff; // 歪みの各段の弱まり方 (%)
uniform float uWarpFreqGain; // 歪みの各段で細かくなる速さ (%)
uniform float uCausticSharp; // コースティクスの筋の鋭さ (%)
uniform float uSparkleLevel; // きらめきの出る明るさの閾値 (%)
uniform float uCenterX; // 波の見る位置の横ずらし (%)
uniform float uCenterY; // 波の見る位置の縦ずらし (%)
uniform float uRotate; // 水面全体の回転 (度)
uniform float uMirrorAxis; // 左右の鏡像の折り返し位置 (%)。0 でなし
uniform float uSwirl; // 中心からの距離に応じた渦のねじれ (%)。負で逆向き
uniform float uMosaic; // 座標のモザイク化 (%)。大きいほど粗いブロック
uniform float uWarpTurn; // 歪みの向きの回転 (度)
uniform float uRainbow; // 波ごとの虹色の混ざり (%)。0 で白黒の水
uniform float uBands; // 明度を等高線状の段に割る数 (0 でなし)
uniform float uTopFade; // 上下方向のグラデーション (%)。正で上が暗く、負で下が暗い
uniform float uGrain; // 粒状ノイズの量 (%)
uniform float uVignette; // 周辺を暗くする量 (%)
uniform vec3 uWaterColor; // 水面の色の掛け合わせ
uniform vec3 uCausticColor; // コースティクスの色の掛け合わせ
uniform vec3 uSparkleColor; // きらめきの色の掛け合わせ

bool rw_custom = false;
vec3 rw_poolsC(in vec2 uv){
  float dt  = .5+.5*sin(.18*time);
  float dt2 = .5+.5*sin(.038*time);
  float mdt  = .2+.8*dt;
  float mdt2 = .7+.3*dt2;

  float dt3 = .5+.5*sin(.14*time);
  float dt4 = .5+.5*sin(.033*time);
  float mdt3 = .2+.8*dt3;
  float mdt4 = .7+.3*dt4;

  float dt5 = .5+.5*sin(.11*time);
  float dt6 = .5+.5*sin(1.5+.036*time);
  float mdt5 = .2+.8*dt5;
  float mdt6 = .7+.3*dt6;

  vec3 c = vec3(0.0);
  float a = 1.0;
  float f = 1.0;
  float as = 0.0;
  float dens = uDensity / 100.0;
  int nd = int(uDetail + 0.5);
  float fgr = .3*(uFreqGrow / 100.0);
  float adc = 1.23*(uAmpDecay / 100.0);
  float spr = uSourceSpread / 100.0;
  float rsx = uRingStretch / 100.0;
  bool sharp = (uRingSharp != 100.0);
  float rsp = uRingSharp / 100.0;
  for(int j = 0; j < 25; j++){
    if(j >= nd) break;
    f = 2.0*(1.0+fgr*float(j));
    a = 1.0/(pow(adc, float(j)));
    vec2 rd = uv - vec2(sin(142.31*float(j)), sin(29.321*float(j))) * spr;
    rd.x *= rsx;
    float r2 = length(rd);
    float w1 = .5+.5*sin(7.*time + f*mdt2*7.1*dens*r2);
    float w2 = .5+.5*sin(7.*time + f*mdt4*7.1*dens*r2);
    float w3 = .5+.5*sin(7.*time + f*mdt6*7.1*dens*r2);
    if(sharp){ w1 = pow(w1, rsp); w2 = pow(w2, rsp); w3 = pow(w3, rsp); }
    c.r += mdt *1.4*a*w1;
    c.g += mdt3*1.4*a*w2;
    c.b += mdt5*1.4*a*w3;
    as += a;
  }
  c /= as;
  return c;
}
vec3 rw_pools(in vec2 uv){
  if(rw_custom) return rw_poolsC(uv);
  float dt  = .5+.5*sin(.18*time);
  float dt2 = .5+.5*sin(.038*time);
  float mdt  = .2+.8*dt;
  float mdt2 = .7+.3*dt2;

  float dt3 = .5+.5*sin(.14*time);
  float dt4 = .5+.5*sin(.033*time);
  float mdt3 = .2+.8*dt3;
  float mdt4 = .7+.3*dt4;

  float dt5 = .5+.5*sin(.11*time);
  float dt6 = .5+.5*sin(1.5+.036*time);
  float mdt5 = .2+.8*dt5;
  float mdt6 = .7+.3*dt6;

  vec3 c = vec3(0.0);
  float a = 1.0;
  float f = 1.0;
  float as = 0.0;
  float dens = uDensity / 100.0;
  for(int j = 0; j < 25; j++){
    if(j >= int(uDetail + 0.5)) break;
    f = 2.0*(1.0+.3*float(j));
    a = 1.0/(pow(1.23, float(j)));
    float r2 = length(uv - vec2(sin(142.31*float(j)), sin(29.321*float(j))));
    c.r += mdt *1.4*a*(.5+.5*sin(7.*time + f*mdt2*7.1*dens*r2));
    c.g += mdt3*1.4*a*(.5+.5*sin(7.*time + f*mdt4*7.1*dens*r2));
    c.b += mdt5*1.4*a*(.5+.5*sin(7.*time + f*mdt6*7.1*dens*r2));
    as += a;
  }
  c /= as;
  return c;
}
vec3 rw_warp(in vec2 uv){
  vec3 c = rw_pools(uv);
  int iter = int(uWarpPasses + 0.5);
  float amp = .55 * (uWarpFalloff / 100.0);
  float f = .9 * (uWarp / 100.0);
  float a = 1.0;
  for(int i = 0; i < 5; i++){ if(i < iter){ a *= amp; } }
  float fg = 1.2 * (uWarpFreqGain / 100.0);
  for(int i = 0; i < 5; i++){
    if(i < iter){
      a /= amp;
      f *= fg;
      vec2 wv = vec2(c.r-c.g, c.g-c.b);
      if(uWarpTurn != 0.0){ float wt = radians(uWarpTurn); wv = mat2(cos(wt), -sin(wt), sin(wt), cos(wt)) * wv; }
      c = a*rw_pools(uv + f*wv);
    }
  }
  return c;
}
vec3 bg_rainbowWater(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = I / resolution.xy;
  if(uMirrorAxis != 0.0){ float mx = 0.5 + uMirrorAxis / 100.0 * 0.3; uv.x = mx + abs(uv.x - mx); }
  if(uSwirl != 0.0){
    float sw = (uSwirl / 100.0) * 3.0 * length(uv - 0.5);
    uv = 0.5 + mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * (uv - 0.5);
  }
  if(uRotate != 0.0){ float ra = radians(uRotate); uv = 0.5 + mat2(cos(ra), -sin(ra), sin(ra), cos(ra)) * (uv - 0.5); }
  if(uMosaic != 0.0){ float mn = 120.0 / (1.0 + uMosaic * 0.05); uv = (floor(uv * mn) + 0.5) / mn; }
  if(uCenterX != 0.0 || uCenterY != 0.0) uv += vec2(uCenterX, uCenterY) / 100.0;
  if(uSkew != 0.0) uv.x += (uv.y - 0.5) * (uSkew / 100.0);
  rw_custom = (uSourceSpread != 100.0 || uRingStretch != 100.0 || uFreqGrow != 100.0 || uAmpDecay != 100.0 || uRingSharp != 100.0);
  vec3 c0 = rw_warp(uv);

  // === H18 と同じ水(透明・白黒・明るめ)処理 ===
  c0 = clamp(c0, 0.0, 1.5);
  float L = dot(c0, vec3(0.299, 0.587, 0.114));
  float g = smoothstep(0.0, 0.85, L * (uContrast / 100.0));
  g = 0.40 + 0.60 * g;                                    // 明度を持ち上げて明るく
  float gBase = g;
  float gCau = pow(clamp(L, 0.0, 1.0), 5.0 * (uCausticSharp / 100.0)) * 0.5 * (uGlow / 100.0);                // コースティクス(明るい筋)
  g += gCau;
  float gSpk = pow(clamp((L - 0.70 * (uSparkleLevel / 100.0))/0.30, 0.0, 1.0), 3.0) * 0.6 * (uGlow / 100.0);  // 鋭いきらめき
  g += gSpk;
  bool tinted = (uWaterColor != vec3(1.0) || uCausticColor != vec3(1.0) || uSparkleColor != vec3(1.0));
  if(uBands != 0.0){ float bn = uBands + 1.0; g = floor(clamp(g, 0.0, 1.0) * bn + 0.5) / bn; }
  if(uTopFade != 0.0) g *= 1.0 - (uTopFade / 100.0) * (fc.y / resolution.y - 0.5) * 1.2;
  if(uVignette != 0.0){
    vec2 vq = (fc - 0.5 * resolution.xy) / resolution.y;
    g *= 1.0 - (uVignette / 100.0) * smoothstep(0.3, 1.0, length(vq));
  }
  if(uGrain != 0.0){
    float gh = fract(sin(dot(fc, vec2(12.9898, 78.233)) + time * 0.7) * 43758.5453);
    g += (gh - 0.5) * (uGrain / 100.0) * 0.4;
  }
  bgAlpha = clamp(g * 0.8, 0.0, 0.78);                     // 半透明の水(暗い谷ほど透ける)
  vec3 outc = vec3(clamp(g, 0.0, 1.0));
  if(tinted){
    outc = clamp((gBase * uWaterColor + gCau * uCausticColor + gSpk * uSparkleColor) * (g / max(gBase + gCau + gSpk, 1e-4)), 0.0, 1.0);
  }
  if(uRainbow != 0.0) outc = clamp(outc + (uRainbow / 100.0) * 0.9 * (c0 - L), 0.0, 1.0);
  return outc;
}
