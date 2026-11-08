// =====================================================
// bg_juice  (H49)  — 差し替え: "space shield" を浅葱色に寄せた版
//   Source : Shadertoy "space shield"  https://www.shadertoy.com/view/3XtXD2
//   Kali ボリュメトリック・ネビュラ + シールド模様(map)。元は iChannel0 テクスチャの
//   ブラーを使うが、GARA は単一パス・テクスチャ不使用のため手続きの柔らかい雲で代替。
//   全体を浅葱色(asagi)のグラデに寄せて着色。
//   iTime,iResolution → time,resolution / iMouse 固定 / bgZoom・bgCamPx 対応。
//   cosineGradient(uCosGrad)対応 / Slot B は暗部透過。ヘルパは ss_ で名前空間化。
// =====================================================

// @param uDetail 4..10 = 10.0
// @param uSteps 6..14 = 14.0
// @param uTile 60..200 = 100.0
// @param uShield 25..400 = 100.0
// @param uGlow 20..250 = 100.0
uniform float uDetail;   // 模様を折り畳む反復回数 (下げると軽く、単純になる)
uniform float uSteps;   // ネビュラの層の数 (下げると軽く、薄くなる)
uniform float uTile;   // ネビュラのタイルの大きさ (%)
uniform float uShield;   // シールド模様の細かさ (%)
uniform float uGlow;   // ネビュラの明るさ (%)
// @param uRingW      50..200  = 100.0
// @param uSegSize    50..250  = 100.0
// @param uSegSoft    20..180  = 100.0
// @param uDiag       0..100   = 0.0
// @param uFoldOff    70..130  = 100.0
// @param uKaliK      92..108  = 100.0
// @param uStepDepth  50..140  = 100.0
// @param uFalloff    80..110  = 100.0
// @param uShieldPush 0..300   = 100.0
// @param uCloudFreq  30..300  = 100.0
// @param uShieldLight 40..300 = 100.0
uniform float uRingW;   // シールドの同心リングの間隔 (%)
uniform float uSegSize;   // リングの区画の幅 (%)。区画ごとに模様がずれる
uniform float uSegSoft;   // 区画の境目の滑らかさ (%)。下げると段差が急になる
uniform float uDiag;   // 模様の格子から斜め縞への変形 (%)。0 = 格子
uniform float uFoldOff;   // ネビュラのタイル折り返しの位置 (%)。ずらすと左右非対称な構造になる
uniform float uKaliK;   // フラクタルの折り畳み定数 (%)。わずかな変化で形が大きく変わる
uniform float uStepDepth;   // ネビュラの層の間隔 (%)。上げると奥行きが深くなる
uniform float uFalloff;   // 層ごとの減衰 (%)。上げると奥の層まで残る
uniform float uShieldPush;   // シールド模様がネビュラの位置を歪める量 (%)
uniform float uCloudFreq;   // 柔らかい雲の波の細かさ (%)
uniform float uShieldLight;   // シールドの陰影の鋭さ (%)
// @param uCenterX -100..100 = 0.0
// @param uCenterY -100..100 = 0.0
// @param uFovNarrow 60..200 = 100.0
// @param uLookYaw -100..100 = 0.0
// @param uLookPitch -100..100 = 0.0
// @param uOriginX -100..100 = 0.0
// @param uOriginY -100..100 = 0.0
// @param uShieldCenterX -100..100 = 0.0
// @param uShieldCenterY -100..100 = 0.0
// @param uShieldTurn -180..180 = 0.0
// @param uShieldLightYaw -180..180 = 0.0
// @param uShieldFill 0..600 = 100.0
// @param uShieldHue 0..100 = 25.0
// @param uAsagiMix 0..100 = 80.0
// @param uShadowColor color = #ffffff
// @param uMidColor color = #ffffff
// @param uLitColor color = #ffffff
uniform float uCenterX;   // ネビュラの視線の左右 (%)
uniform float uCenterY;   // ネビュラの視線の上下 (%)
uniform float uFovNarrow;   // 画角の狭さ (%。大きいほど望遠)
uniform float uLookYaw;   // 視線の左右の振り (%)
uniform float uLookPitch;   // 視線の上下の振り (%)
uniform float uOriginX;   // ネビュラ内の視点位置 X (%)
uniform float uOriginY;   // ネビュラ内の視点位置 Y (%。上側は効きを抑えてある)
uniform float uShieldCenterX;   // シールド模様の中心の左右 (%)
uniform float uShieldCenterY;   // シールド模様の中心の上下 (%)
uniform float uShieldTurn;   // シールド模様の回転 (度)
uniform float uShieldLightYaw;   // シールドの光の方位 (度)
uniform float uShieldFill;   // シールドの補助光の強さ (%)
uniform float uShieldHue;   // シールドの虹色の混ざり (%)
uniform float uAsagiMix;   // 浅葱グラデへの寄せ具合 (%)
uniform vec3 uShadowColor;   // 浅葱グラデの暗部の色
uniform vec3 uMidColor;   // 浅葱グラデの中間の色
uniform vec3 uLitColor;   // 浅葱グラデの明部の色

float ss_fn1(float v){ return v*16.0*(uShield / 100.0); }
vec2  ss_hash21(float p){
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 19.19);
  return fract(vec2((p3.x+p3.y)*p3.z, (p3.x+p3.z)*p3.y));
}
mat2 ss_rotate2d(float a){ return mat2(cos(a), -sin(a), sin(a), cos(a)); }
vec3 ss_hue(float t){ float h = t*6.2831; return 0.5 + 0.5*cos(h + vec3(0.0, 0.50, 1.0)); }

// シールド模様: 同心セグメント + sin 波
float ss_map(vec2 uv){
  float circle = length(uv)/(0.95 * (uRingW / 100.0));
  float segment = floor(circle/(0.6 * (uSegSize / 100.0)));
  float segFrac = fract(circle);
  float segE1 = 0.5;
  if(uSegSoft != 100.0) segE1 = 0.15 + 0.35 * (uSegSoft / 100.0);
  float limit = segment + smoothstep(0.15, segE1, segFrac);
  uv = normalize(uv)*0.4;
  uv += ss_hash21(limit);
  uv *= ss_rotate2d(time*0.1);
  float m = sin(ss_fn1(uv.x)) * sin(ss_fn1(uv.y));
  if(uDiag != 0.0) m = mix(m, sin(ss_fn1(uv.x) + ss_fn1(uv.y)), uDiag / 100.0);
  return m;
}

vec3 bg_juice(vec2 fc){
  vec2 I  = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = I/resolution.xy - 0.5;
  uv.y *= resolution.y/resolution.x;
  if(uCenterX != 0.0 || uCenterY != 0.0) uv += vec2(uCenterX, uCenterY) * 0.005;
  vec3 dir = normalize(vec3(uv*(0.8 * (uFovNarrow / 100.0)), 1.03));
  if(uLookYaw != 0.0 || uLookPitch != 0.0){
    dir = normalize(dir + vec3(uLookYaw, uLookPitch, 0.0) * 0.005);
  }
  dir.z += time*0.1;

  // シールド模様 + ライティング
  vec2 uv2 = (2.0*I - resolution)/resolution.y; uv2 *= 3.0;
  if(uShieldCenterX != 0.0 || uShieldCenterY != 0.0) uv2 += vec2(uShieldCenterX, uShieldCenterY) * 0.03;
  if(uShieldTurn != 0.0) uv2 = ss_rotate2d(radians(uShieldTurn)) * uv2;
  float d = ss_map(uv2);
  vec2 eps = vec2(0.005*length(uv2), 0.0);
  vec3 normal = -normalize(vec3(d - ss_map(uv2+eps.xy), d - ss_map(uv2+eps.yx), 1.0));
  vec3 lightDir1 = normalize(vec3(1.0, 0.1, 0.0));
  if(uShieldLightYaw != 0.0){ lightDir1.xy = ss_rotate2d(radians(uShieldLightYaw)) * lightDir1.xy; lightDir1 = normalize(lightDir1); }
  vec3 lightDir2 = normalize(vec3(0.6, -0.5, -3.0));
  vec3 color = vec3(0.0);
  color += pow(dot(normal, lightDir1)*0.5 + 0.5, 5.0 * (uShieldLight / 100.0));
  color += vec3(0.1) * (uShieldFill / 100.0) * pow(dot(normal, lightDir2)*0.5 + 0.5, 0.6);
  vec3 mixedColor = mix(color, ss_hue(d), uShieldHue / 100.0);
  color /= max(mixedColor, vec3(1e-3));
  color = clamp(color, 0.0, 4.0);

  // テクスチャブラーの代替: 手続きの柔らかい雲
  vec3 col1 = vec3(0.45) + 0.25*ss_hue(0.3*sin(uv.x*7.0*(uCloudFreq / 100.0) + time*0.1) + 0.3*sin(uv.y*6.0*(uCloudFreq / 100.0)) + 0.1);

  vec3 from = vec3(1.0, 0.5, 0.5) + color*col1*(uShieldPush / 100.0);
  if(uOriginX != 0.0 || uOriginY != 0.0) from.xy += vec2(uOriginX, uOriginY * (uOriginY > 0.0 ? 0.2 : 1.0)) * 0.0025;

  // ボリュメトリック・ネビュラ(Kali)
  float s = 0.1, fade = 1.0;
  vec3 v = vec3(0.0);
  for(int r=0; r<14; r++){
    if(r >= int(uSteps + 0.5)) break;
    vec3 p = from + s*dir*0.5;
    p = abs(vec3(0.85 * (uTile / 100.0) * (uFoldOff / 100.0)) - mod(p, vec3(1.7 * (uTile / 100.0))));     // tiling fold
    float pa, a = pa = 0.0;
    for(int i=0; i<10; i++){
      if(i >= int(uDetail + 0.5)) break;
      p = abs(p)/dot(p,p) - 0.53 * (uKaliK / 100.0);
      p.xy *= ss_rotate2d(time*0.02);
      a += abs(length(p) - pa);
      pa = length(p);
    }
    float dm = max(0.0, 0.30 - a*a*0.001);
    a *= a*a;
    if(r>2) fade *= 1.3 - dm;
    v += fade;
    v += vec3(s, s*s, s*s*s*s)*a*0.0015*fade;
    fade *= 0.73 * (uFalloff / 100.0);
    s += 0.1 * (uStepDepth / 100.0);
  }
  v = mix(vec3(length(v)), v, 0.85);
  vec3 col = v * 0.03 * (uGlow / 100.0);

  // 浅葱色(asagi)に寄せる: 輝度→濃紺→浅葱→淡水色のグラデ
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 aDark = vec3(0.02, 0.10, 0.15) * uShadowColor;
  vec3 aMid  = vec3(0.00, 0.46, 0.56) * uMidColor;   // 浅葱
  vec3 aLit  = vec3(0.68, 0.93, 0.98) * uLitColor;   // 淡い水色
  vec3 grad = (lum < 0.5) ? mix(aDark, aMid, lum*2.0) : mix(aMid, aLit, (lum-0.5)*2.0);
  col = mix(col, grad, uAsagiMix / 100.0);

  if(abs(uCosGrad) > 0.0001){
    col = mix(col, cosGradColor(lum) * (0.2 + 1.4*lum), abs(uCosGrad));
  }
  bgAlpha = clamp(lum*2.5, 0.0, 1.0);   // Slot B は暗部透過
  return col;
}
