// =====================================================
// bg_ribpillar  (H33)
//   Source : Shadertoy "Noise Racer" https://www.shadertoy.com/view/WcVyDw
//            (motion blur trick by @FabriceNeyret2)
//   トンネル/路面のノイズ地形を飛ぶ light orb を追うレイマーチ。
//   改変: レイマーチを 64→36 段に削減して軽量化(グリッチ許容)。
//          画素ごとの時間ジッタでレトロなモーションブラー風グリッチ。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパ/グローバルは rp_ で名前空間化。
// =====================================================
#define RP_P(z) (vec3(cos((z)*.003)*128.+cos((z)*.005)*256., \
                      cos((z)*.006)*256., (z)))
#define RP_N normalize

float rp_T;
float rp_lights;
float rp_orbX;
float rp_orbZ;

mat2 rp_r2(float a){ float s=sin(a), c=cos(a); return mat2(c,s,-s,c); }

// @param uTwist  0..200  = 100.0
// @param uWarp   0..150  = 100.0
// @param uGlow   25..300 = 100.0
// @param uGlitch 0..300  = 100.0
// @param uFog    0..200  = 100.0
// @param uAngle -180..180 = 0.0
// @param uSteps 16..36 = 36.0
// @param uSquashFreq 50..200 = 100
// @param uBlockFine 0..250 = 100
// @param uWallGap 60..150 = 100
// @param uCeilGap 60..150 = 100
// @param uRoadGap 60..150 = 100
// @param uTerrainDepth 40..200 = 100
// @param uBlockHeight 0..250 = 100
// @param uHoleDepth 0..250 = 100
// @param uBlockFreq 50..200 = 100
// @param uTwistPitch 0..300 = 100
// @param uSideWave 0..300 = 100
// @param uEdgeGlow 0..160 = 100
// @param uFov 60..160 = 100
// @param uCamX -12..12 = 0
// @param uCamY -10..10 = 0
// @param uMirror 0..100 = 0
// @param uOrbSwing 0..300 = 100
// @param uOrbAhead 40..250 = 100
// @param uSilver 0..200 = 100
// @param uHorizon -40..40 = 0
// @param uFarStart 30..300 = 100
// @param uVignette 0..100 = 0
// @param uGrain 0..100 = 0
// @param uDepthGlow 0..300 = 100
// @param uPathGlow 0..300 = 100
// @param uHorizonBand 0..300 = 100
// @param uMosaic 0..100 = 0
// @param uOrbColor color = #ffffff
// @param uEdgeColor color = #ffffff
// @param uMetalColor color = #ffffff
// @param uFarColor color = #ffffff
uniform float uFov; // 画角 (%)。大きいと広角
uniform float uCamX; // カメラの左右位置 (コース内)
uniform float uCamY; // カメラの高さ (コース内)
uniform float uMirror; // 右側を左側の鏡像にする度合い (%)。100 で完全な左右対称
uniform float uOrbSwing; // 光源 orb の左右の揺れ幅 (%)
uniform float uOrbAhead; // 光源 orb までの距離 (%)
uniform float uSilver; // 明部のシルバー脱色の強さ (%)
uniform float uHorizon; // 背景メタリックの地平線の高さ (%)
uniform float uFarStart; // 奥の群青が効き始める距離 (%)
uniform float uVignette; // 四隅の暗がり (%)
uniform float uGrain; // フィルムの粒 (%)
uniform float uDepthGlow; // 奥ほど光が強まる度合い (%)
uniform float uPathGlow; // コース全体にかかる青い面光の強さ (%)
uniform float uHorizonBand; // 背景メタリックの地平線の白い帯の強さ (%)
uniform float uMosaic; // 画面をモザイク状に粗くする度合い (%)
uniform vec3 uOrbColor; // 光源 orb の光の色 (ティント)
uniform vec3 uEdgeColor; // 白いエッジ光の色 (ティント)
uniform vec3 uMetalColor; // 背景メタリックの色 (ティント)
uniform vec3 uFarColor; // 奥の群青の色 (ティント)
uniform float uTwist;     // コースのねじれ (%)
uniform float uWarp;      // 横縦の潰れ・伸びの強さ (%)
uniform float uGlow;      // 光源 (orb) の光の強さ (%)
uniform float uGlitch;    // 画素ごとの時間ジッタ (モーションブラー風グリッチ) の量 (%)
uniform float uFog;       // 奥の群青のかかり具合 (%)
uniform float uAngle; // トンネルの向き = ロール (度。固定角でずらす)
uniform float uSteps; // レイマーチのステップ数 (下げると軽く、奥が粗くなる)
uniform float uSquashFreq; // 横縦の潰れ・伸びの波の細かさ (%)
uniform float uBlockFine; // 中くらいの段差ブロックの高さ (%)
uniform float uWallGap; // 左右の壁の間隔 (%)
uniform float uCeilGap; // 天井の高さ (%)
uniform float uRoadGap; // 路面の深さ (%)
uniform float uTerrainDepth; // ノイズ地形の食い込む深さ (%)
uniform float uBlockHeight; // 階段状ブロックの段差の高さ (%)
uniform float uHoleDepth; // 細かい穴の深さ (%)
uniform float uBlockFreq; // ブロック模様の細かさ (%)
uniform float uTwistPitch; // 進むにつれて巻くねじれの量 (%)
uniform float uSideWave; // 横うねりの振れ幅 (%)
uniform float uEdgeGlow; // 白いエッジ光の量 (%)

float rp_map(vec3 p){
  vec3 q = RP_P(p.z);
  // entity (flying light orb): z を時間で前進する球
  float e = length(p - vec3(q.x + rp_orbX,
                            q.y,
                            rp_orbZ)) - .001;
  rp_lights += 1e1/e;            // orb の光を蓄積

  p.xy -= q.xy;                  // パスに沿って空間を移動
  // コースをねじる + 潰す + うねらせる(カオス。穴あきOK)
  p.xy *= rp_r2((sin(p.z*0.02)*1.8 + p.z*0.013*(uTwistPitch / 100.0)) * (uTwist / 100.0) + radians(uAngle));     // ねじり(コルク栓状)
  p.x  *= 1.0 + 0.55*(uWarp / 100.0)*sin(p.z*0.03*(uSquashFreq / 100.0) + 1.0);           // 横方向に潰れる/伸びる
  p.y  *= 1.0 + 0.55*(uWarp / 100.0)*sin(p.z*0.04*(uSquashFreq / 100.0));                 // 縦方向に潰れる/伸びる
  p.x  += sin(p.z*0.06)*6.0*(uSideWave / 100.0);                         // 横うねり

  float r = 4e1*(uRoadGap / 100.0) - p.y;           // 路面
  p = abs(p);                    // 角トンネルのミラー
  float t = min(4e1*(uWallGap / 100.0) - p.x, 32.*(uCeilGap / 100.0) - p.y);
  float s = -p.y - 26.*(uTerrainDepth / 100.0);          // ノイズ地形
  s -= abs(dot(round(sin((.1*p + .1*p.yzx) * (uBlockFreq / 100.0))), vec3(4.*(uBlockHeight / 100.0))));
  s -= abs(dot(round(sin((.1*p*0.5 + .1*p.yzx*0.5) * (uBlockFreq / 100.0))*16.)*0.125, vec3(6.*(uBlockFine / 100.0))));
  s -= abs(dot(round(sin(.07*p - .05*p.zxy)*8.)*0.22, vec3(5.*(uHoleDepth / 100.0))));  // 追加ノイズ(穴)
  return min(e, max(t + s*0.1, r + s));
}

vec3 bg_ribpillar(vec2 fc){
  vec2 I = (fc - resolution*0.5)/max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 u = (I - resolution*0.5)/resolution.y;
  if(uMirror != 0.0){ float ax = (resolution.x / resolution.y * 0.5) * (1.0 - uMirror / 100.0); u.x = ax - abs(u.x - ax); }
  if(uMosaic != 0.0){ float mc = (uMosaic / 100.0) * 0.12; u = (floor(u / mc) + 0.5) * mc; }

  // グリッチ: 画素ごとの時間ジッタ(モーションブラー風のレトロノイズ)
  rp_T = time*1e2 + fract(1e4*sin(dot(fc, vec2(137.0, -13.0))))*1.6*(uGlitch / 100.0);

  float i = 0.0, s, d = .4 + .5*dot(fract(sin(u)), sin(u));
  vec4 o = vec4(0.0);
  vec3 p = RP_P(rp_T), ro = p,
       Z = RP_N(RP_P(rp_T + 2.0) - p),
       X = RP_N(vec3(Z.z, 0.0, -Z.x)),
       D = vec3(u, 100.0 / uFov) * mat3(-X, cross(X, Z), Z);

  if(uCamX != 0.0 || uCamY != 0.0){ ro += X*uCamX + cross(X, Z)*uCamY; }
  rp_lights = 0.0;
  rp_orbX = sin(rp_T*.05)*(uOrbSwing / 100.0);
  rp_orbZ = 48.*(uOrbAhead / 100.0) + rp_T + sin(.005*rp_T)*32.;
  vec4 orbTint = vec4(uOrbColor, 1.0);
  vec4 edgeTint = vec4(uEdgeColor, 1.0);
  // 64 → 36 段に削減(軽量化)
  for(; i++ < floor(uSteps + 0.5) && d < 2e3;){
    p = ro + D * d;
    d += s = max(rp_map(p) * .65, .001);
    o += 6.0*(uGlow / 100.0)*(vec4(1,2,5,0)*orbTint)*rp_lights + edgeTint*(1.6*(uEdgeGlow / 100.0)/s);   // 白いエッジ光を増やす
  }

  // ライン光源を赤→群青(ウルトラマリン)に
  o = tanh(o*o / 8e9 * exp(d/9e1*(uDepthGlow / 100.0))
     + abs(vec4(1,2,7,0) / dot(cos(p*.03), vec3(4e1)))*(uPathGlow / 100.0));

  vec3 col = o.rgb;

  // 白い部分にシルバー感(明部をわずかに脱色・寒色化)
  float lum = dot(col, vec3(0.3333));
  col = mix(col, vec3(lum)*vec3(0.95, 0.97, 1.02), 0.4*(uSilver / 100.0)*smoothstep(0.4, 1.0, lum));

  // 背景をメタリック(クローム)グラデに(暗部へ流す)
  float gy = clamp(u.y*0.5 + 0.5, 0.0, 1.0);
  if(uHorizon != 0.0){ gy = clamp(gy - uHorizon / 100.0, 0.0, 1.0); }
  vec3 metal = mix(vec3(0.12, 0.13, 0.17), vec3(0.52, 0.55, 0.64), smoothstep(0.0, 0.7, gy));
  metal += smoothstep(0.40, 0.50, gy) * (1.0 - smoothstep(0.50, 0.62, gy)) * vec3(0.40, 0.42, 0.48) * (uHorizonBand / 100.0);
  metal *= uMetalColor;
  col = mix(metal, col, smoothstep(0.02, 0.30, lum));

  // 奥に行くほど濃い群青(ウルトラマリン)
  float far = clamp(d / (1.1e3*(uFarStart / 100.0)), 0.0, 1.0);
  col = mix(col, vec3(0.05, 0.08, 0.34)*uFarColor, far*0.5*(uFog / 100.0));
  // 任意: uCosGrad で色付け
  if(abs(uCosGrad) > 0.0001){
    float tt = d*0.01;
    vec3 cg = cosGradColor(tt);
    col = mix(col, col*cg*1.6, abs(uCosGrad));
  }
  if(uVignette != 0.0){ col *= 1.0 - (uVignette / 100.0)*smoothstep(0.3, 1.1, length(u)); }
  if(uGrain != 0.0){ col += (fract(sin(dot(fc + time, vec2(12.9898, 78.233)))*43758.5453) - 0.5)*(uGrain / 100.0)*0.35; }
  return clamp(col, 0.0, 1.0);
}
