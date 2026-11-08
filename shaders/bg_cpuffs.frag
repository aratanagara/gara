// =====================================================
// bg_cpuffs  (H47)
//   Source : Shadertoy "Color Puffs" https://www.shadertoy.com/view/W3fGDH
//            蛇行するパスを飛行しながら Kaleidoscopic IFS を描くレイマーチ。
//   改変: iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//         vec3(Z.z,0,-Z) は 5 成分でドライバ依存のため -Z.x に明示。
//   マクロ/ヘルパは CP_ で名前空間化。
// =====================================================

#define CP_P(z) (vec3(tanh(cos((z) * .3) * .4) * (16. * (uSwayX / 100.)), \
                      tanh(cos((z) * .4) * .3) * (16. * (uSwayY / 100.)), (z)))
#define CP_rot(a) mat2(cos(a + vec4(0, 33, 11, 0)))

// @param uDetail   2..6 = 6.0
// @param uMotion   0..300 = 100.0
// @param uPuff     40..150 = 100.0
// @param uFog      20..400 = 100.0
// @param uContrast 40..250 = 100.0
// @param uAngle -180..180 = 0.0
// @param uSteps 30..90 = 90.0
uniform float uDetail; // フラクタルの反復回数 (下げると軽く、形が粗くなる)
uniform float uMotion; // 路面のうねりの振幅 (%)
uniform float uPuff; // もこもこの形の強さ (%)
uniform float uFog; // 奥の霞の届く距離 (%)
uniform float uContrast; // コントラスト (%。大きいほど暗く締まる)
uniform float uAngle; // 向き (度。固定角でずらす)
uniform float uSteps; // レイマーチのステップ数 (下げると軽く、遠景や細部が欠ける)
// @param uSwayX 40..150 = 100
// @param uSwayY 40..150 = 100
// @param uTunnelWidth 70..140 = 100
// @param uRoadHeight 60..140 = 100
// @param uRoadWave 25..250 = 100
// @param uFoldLimit 88..115 = 100
// @param uFoldScale 92..108 = 100
// @param uFoldOffset 94..110 = 100
// @param uInflate 90..115 = 100
// @param uGrainDepth 40..200 = 100
// @param uCamYaw -45..45 = 0
// @param uCamPitch -35..35 = 0
// @param uCamShiftX -100..100 = 0
// @param uCamShiftY -100..100 = 0
// @param uLensFov 50..200 = 100
// @param uLensBarrel -100..100 = 0
// @param uRollSway 0..300 = 100
// @param uLookAhead 40..200 = 100
// @param uVolAmt 0..300 = 100
// @param uSurfAmt 0..300 = 100
// @param uHazeStart 0..100 = 0
// @param uVignette 0..100 = 0
// @param uGrain 0..100 = 0
// @param uVolTint color = #ffffff
// @param uSurfTint color = #ffffff
// @param uFogTint color = #ffffff
uniform float uSwayX; // 道の左右の蛇行の振れ幅 (%)
uniform float uSwayY; // 道の上下の蛇行の振れ幅 (%)
uniform float uTunnelWidth; // 道まわりの空間の広さ (%)
uniform float uRoadHeight; // 路面の高さ (%)
uniform float uRoadWave; // 路面のうねりの細かさ (%)
uniform float uFoldLimit; // 折り畳みの境界の広さ (%)
uniform float uFoldScale; // 折り畳みの拡大率 (%)
uniform float uFoldOffset; // 折り畳みの引き込み量 (%)
uniform float uInflate; // 球状の膨らみ (%)
uniform float uGrainDepth; // 表面の細かい凹凸の深さ (%)
uniform float uCamYaw; // カメラを左右へ振る量 (度)
uniform float uCamPitch; // カメラを上下へ振る量 (度)
uniform float uCamShiftX; // カメラ位置の横ずれ (%)
uniform float uCamShiftY; // カメラ位置の縦ずれ (%)
uniform float uLensFov; // 画角 (%)。大きいほど広角
uniform float uLensBarrel; // レンズの樽型歪み (%)。負で糸巻き型
uniform float uRollSway; // 機体のロールの揺れ幅 (%)
uniform float uLookAhead; // 進行方向を見る先の距離 (%)。大きいほど曲がり角を先読み
uniform float uVolAmt; // 光路に溜まる靄 (体積光) の量 (%)
uniform float uSurfAmt; // 表面に当たった光の量 (%)
uniform float uHazeStart; // 霞が始まる距離 (%)。0 で手前から
uniform float uVignette; // 周辺減光 (%)
uniform float uGrain; // 画面のざらつき (%)
uniform vec3 uVolTint; // 体積光に掛ける色
uniform vec3 uSurfTint; // 表面光に掛ける色
uniform vec3 uFogTint; // 奥へ向かう霞の吸収色

vec3 bg_cpuffs(vec2 fc){
  vec2 u = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;

  float T = time, a, d = 0., s = .002, l, w, ws, j;
  float f = tanh(sin(T*1.5)*1.35)*.25 * (uRollSway / 100.);
  float nd = floor(uDetail + .5);
  vec2 r = resolution.xy;
  if(uLensFov != 100.0) u = r*0.5 + (u - r*0.5) * (uLensFov / 100.);
  if(uLensBarrel != 0.0){
    vec2 bq = (u - r*0.5) / r.y;
    u = r*0.5 + (u - r*0.5) * (1. + (uLensBarrel / 100.) * 2. * dot(bq, bq));
  }
  if(uCamYaw != 0.0 || uCamPitch != 0.0) u -= vec2(tan(radians(uCamYaw)), tan(radians(uCamPitch))) * r.y;
  vec3 p = CP_P(T), q = p,
       Z = normalize(CP_P(T + 3. * (uLookAhead / 100.)) - p),
       X = normalize(vec3(Z.z, 0, -Z.x)),
       D = vec3(CP_rot(f + radians(uAngle))*(u - r/2.)/r.y, 1)
           * mat3(-X, cross(X, Z), Z);
  if(uCamShiftX != 0.0 || uCamShiftY != 0.0) q.xy += vec2(uCamShiftX * 0.008, uCamShiftY * 0.01);
  vec3 o = vec3(0);
  for(int i = 0; i++ < 90 && i <= int(uSteps + 0.5) && s > .001;) {
    p = q + D*d;
    o += (sin(p*.3)*.01 + .01) * (uVolAmt / 100.) * uVolTint;
    p.xy -= CP_P(p.z).xy;
    p.xy *= .5 * (uTunnelWidth / 100.);
    p.y -= 1.75 * (uRoadHeight / 100.);
    p.y += (.15*(uMotion / 100.)*(sin(p.x * (uRoadWave / 100.) + T*3.5) +
                 sin(p.z * (uRoadWave / 100.) + T*1.5) +
                 sin(p.z * (uRoadWave / 100.) + T*2.8)));
    ws = .6 * (uPuff / 100.);
    w = .3;
    for(j = 0.; j++ < 6. && j <= nd; p *= l, w *= l)
      p = clamp(p, -2.0 * (uFoldLimit / 100.), 2.0 * (uFoldLimit / 100.)) * (2.0 * (uFoldScale / 100.)) - p,
      p = abs(sin(p)) - (uFoldOffset / 100.),
      l = ws/dot(p, p) + 1.2 * (uInflate / 100.);
    o += (sin(p*.3)*.05 + .009) * (uSurfAmt / 100.) * uSurfTint;
    s = length(p)/w;
    for(a = .2; a < 1.;
        s -= abs(dot(sin(T + (q + D*d)*a*14.), vec3(.008 * (uGrainDepth / 100.))))/a,
        a += a);
    d += s;
  }
  float dFog = d;
  if(uHazeStart != 0.0) dFog = max(d - uHazeStart * 0.15, 0.0);
  o = pow(max((1. - o) * exp(-dFog/(4. * (uFog / 100.)) * (vec3(2.) - uFogTint)), 0.0), vec3(.45 * (uContrast / 100.)));
  if(uVignette != 0.0){
    vec2 vq = fc / resolution.xy - 0.5;
    o *= 1.0 - (uVignette / 100.) * smoothstep(0.25, 0.8, length(vq));
  }
  if(uGrain != 0.0){
    float gh = fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453);
    o = max(o + (gh - 0.5) * (uGrain / 100.) * 0.3, 0.0);
  }
  return clamp(o, 0.0, 1.0);   // HDR(>1)を残すと半透明シェーダを重ねた時スクリーン化するので 0..1 に収める
}
