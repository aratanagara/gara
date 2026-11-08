// =====================================================
// bg_ribbon  (H40)
//   Source : Shadertoy "Reflective Ribbon" https://www.shadertoy.com/view/33yczz
//            (c) Frostbyte (CC BY-NC-SA 4.0)。反射するリボン状の発光フィールド。
//   改変: 引き(ズームアウト) / 背景をシルバーグレーに / 構図を若干右上へ。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
// =====================================================

// @param uSteps 50..100 = 100.0
// @param uDensity 25..400 = 100.0
// @param uGlow 20..250 = 100.0
// @param uSat 0..300 = 100.0
// @param uSoft 10..300 = 100.0
// @param uAngle -180..180 = 0.0
uniform float uSteps;   // レイマーチの反復回数 (下げると軽く、リボンが薄くなる)
uniform float uDensity;   // リボンの模様の密度 (%)
uniform float uGlow;   // 発光の強さ (%)
uniform float uSat;   // 色の彩度 (%)
uniform float uSoft;   // リボン縁のぼかし幅 (%)
uniform float uAngle;   // 向き (度。固定角でずらす)
// @param uRibbonTwist 0..300 = 100.0
// @param uWave 85..250 = 100.0
// @param uRibbonWidth 50..170 = 100.0
// @param uFlutter 25..250 = 100.0
// @param uFlutterFreq 40..250 = 100.0
// @param uRibbonGap 50..125 = 100.0
// @param uHaloHeight 20..200 = 100.0
// @param uHaloGlow 0..400 = 100.0
// @param uSwirl -300..300 = 0.0
// @param uMirror 0..100 = 0.0
// @param uColorBands 20..300 = 100.0
uniform float uRibbonTwist; // リボンが奥行きに沿ってねじれる量 (%)
uniform float uWave;        // リボンの大きなうねりの振れ幅 (%)
uniform float uRibbonWidth; // リボン 1 本の幅 (%)
uniform float uFlutter;     // リボン面のはためき (細かい波) の振れ幅 (%)
uniform float uFlutterFreq; // はためきの細かさ (%)
uniform float uRibbonGap;   // リボン同士の間隔 (%)。下げると詰まり、上げると疎になる
uniform float uHaloHeight;  // 上方の光源の高さ (%)
uniform float uHaloGlow;    // 上方の光源のにじみの強さ (%)
uniform float uSwirl;       // 中心からの距離に比例したねじれ (%)。0 = なし / 負で逆回り
uniform float uMirror;      // 左右の鏡像対称 (%)。0 = なし / 100 で完全な左右対称
uniform float uColorBands;  // 奥行き方向の色帯の細かさ (%)
// @param uCenterX -100..100 = 0
// @param uCenterY -100..100 = 0
// @param uShear -100..100 = 0
// @param uLens -60..100 = 0
// @param uStretch 50..200 = 100
// @param uPhase 0..100 = 0
// @param uHaloX -150..150 = 0
// @param uHaloFalloff 50..200 = 100
// @param uVignette 0..100 = 0
// @param uGrain 0..100 = 0
// @param uRibbonColor color = #ffffff
// @param uHaloColor color = #ffffff
uniform float uCenterX;     // 構図の横位置 (%)
uniform float uCenterY;     // 構図の縦位置 (%)
uniform float uShear;       // 横ずらしの傾き (%)。リボンが斜めに流れる
uniform float uLens;        // 樽型・糸巻き型の歪み (%)
uniform float uStretch;     // 横方向の伸縮 (%)。上げるとリボンが横に広がる
uniform float uPhase;       // 模様の奥行き方向の位相のずらし。リボンの並びが変わる
uniform float uHaloX;       // 上方の光源の横位置 (%)
uniform float uHaloFalloff; // 上方の光源の減衰の指数 (%)。上げると広がりが狭く鋭い
uniform float uVignette;    // 周辺減光 (%)
uniform float uGrain;       // 粒状のざらつき (%)
uniform vec3  uRibbonColor; // リボン本体の色のティント
uniform vec3  uHaloColor;   // 上方の光源のにじみの色のティント

vec3 bg_ribbon(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec3 r = vec3(resolution, 1.0), p = vec3(0.0);
  float t = time, i = 0.0, s = 0.0, d = 0.0;
  vec2 uv = (I - 0.5*r.xy) / r.y;
  float rot = time*0.25 + radians(uAngle);                                       // 画面中心(uv=0)を起点に回転
  uv = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * uv;
  if(uMirror > 0.0) uv.x = mix(uv.x, abs(uv.x), uMirror / 100.0);
  if(uSwirl != 0.0){ float sa = length(uv) * uSwirl / 100.0; uv = mat2(cos(sa), -sin(sa), sin(sa), cos(sa)) * uv; }
  if(uShear != 0.0) uv.x += uv.y * (uShear / 100.0);
  if(uLens != 0.0) uv *= 1.0 + (uLens / 100.0) * dot(uv, uv);
  if(uStretch != 100.0) uv.x /= (uStretch / 100.0);
  if(uCenterX != 0.0 || uCenterY != 0.0) uv -= vec2(uCenterX, uCenterY) * 0.01;
  uv = uv*2.8 + vec2(-0.7, -0.45);  // 引き(×2.8, 全体が見える) + 右上へ

  vec4 o = vec4(0.0);
  vec2 haloOfs = vec2(uHaloX / 100.0, -0.7*(uHaloHeight/100.0));
  float haloLen = length(uv + haloOfs);
  if(uHaloFalloff != 100.0) haloLen = pow(max(haloLen, 1e-4), uHaloFalloff / 100.0);
  vec4 haloC = vec4(1, 1, 3, 1) * vec4(uHaloColor, 1.0);
  for(o *= i; i++ < 100.0; p = 1.5*vec3(uv*d*(uDensity / 100.0), d + t + uPhase)){
    if(i > uSteps) break;
    s = 5e-3 + abs(s)*(0.07*(uRibbonWidth/100.0));
    d += s;
    o += (1.0 + sin(i*(0.5*(uColorBands/100.0)) + 1.5*vec4(3, 1.5, 1, 0)))/s
       + haloC*(uHaloGlow/100.0) / haloLen;
    if(uRibbonTwist != 100.0) p.xy *= mat2(cos(d*(0.1*(uRibbonTwist/100.0)) - 4.0 - vec4(0, 11, 33, 0)));
    else p.xy *= mat2(cos(d*0.1 - 4.0 - vec4(0, 11, 33, 0)));
    s += cos(p.x + p.y)*2.0 + 1.5 + abs(dot(0.2*sin(vec3(p.xy*1.5, p.z + t*5.0)), vec3(0, 9, 2)));
    if(uWave != 100.0) s += cos(p.x + p.y)*(2.0*(uWave/100.0 - 1.0));
    if(uRibbonGap != 100.0) s += 1.5*(uRibbonGap/100.0 - 1.0);
    if(uFlutter != 100.0 || uFlutterFreq != 100.0){
      s += abs(dot((0.2*(uFlutter/100.0))*sin(vec3(p.xy*(1.5*(uFlutterFreq/100.0)), p.z + t*5.0)), vec3(0, 9, 2)))
         - abs(dot(0.2*sin(vec3(p.xy*1.5, p.z + t*5.0)), vec3(0, 9, 2)));
    }
  }
  o = tanh(o*o*(uGlow / 100.0)/3e7);

  // 彩度を下げ、寒色を足して銀調に → 地は黒 (entrypoint が uBgColor で塗る)
  vec3 col = o.rgb;
  float lum = dot(col, vec3(0.3333));
  col = mix(vec3(lum), col, 0.35 * (uSat / 100.0));                         // 彩度を落としてシルバー寄りに
  col *= vec3(0.98, 0.99, 1.03) * uRibbonColor;            // 銀のわずかな寒色
  col *= smoothstep(0.0, 0.22 * (uSoft / 100.0), lum);        // 地を黒に落とす
  bgAlpha = smoothstep(0.0, 0.22 * (uSoft / 100.0), lum);     // 地は透過(リボンのみ残す)
  if(uGrain != 0.0){
    float gn = fract(sin(dot(fc, vec2(12.9898, 78.233)) + time) * 43758.5453);
    col *= 1.0 + (gn - 0.5) * (uGrain / 100.0) * 1.2;
  }
  if(uVignette != 0.0){
    vec2 vq = (fc - resolution*0.5) / resolution.y;
    float vg = 1.0 - (uVignette / 100.0) * smoothstep(0.2, 0.9, length(vq));
    col *= vg; bgAlpha *= vg;
  }
  return clamp(col, 0.0, 1.0);
}
