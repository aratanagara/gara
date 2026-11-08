// =====================================================
// bg_fragile  (H57)
//   Source : Shadertoy "Fragile" / "Glass Field" by Kali  https://www.shadertoy.com/view/XlsGWl
//   改変: 無限タイルのトンネル飛行 → 中心オブジェクトをカメラが周回。
//         形状を「直交2トーラスを smin した絡む曲線(クライン壺風)」に置換し、
//         ねじれ・太さのうねり・流体ノイズで刻一刻と変形。ガラス屈折/反射は踏襲。
//         iTime,iResolution → time,resolution / bgZoom・bgCamPx 対応 / cosGrad / Slot B 透過。
//         ヘルパは fr_ で名前空間化。
// =====================================================

mat3 fr_rotmat(vec3 v, float angle){
  float c = cos(angle), s = sin(angle);
  return mat3(
    c + (1.0-c)*v.x*v.x,        (1.0-c)*v.x*v.y - s*v.z,   (1.0-c)*v.x*v.z + s*v.y,
    (1.0-c)*v.x*v.y + s*v.z,    c + (1.0-c)*v.y*v.y,       (1.0-c)*v.y*v.z - s*v.x,
    (1.0-c)*v.x*v.z - s*v.y,    (1.0-c)*v.y*v.z + s*v.x,   c + (1.0-c)*v.z*v.z);
}

// @param uThick 40..250 = 100.0
// @param uTwist 0..250 = 100.0
// @param uWarp 0..180 = 100.0
// @param uGlow 0..300 = 100.0
// @param uShine 0..300 = 100.0
// @param uScale 50..160 = 100.0
// @param uAngle -180..180 = 0.0
// @param uSteps 24..56 = 56.0
uniform float uThick;   // チューブの太さ (%)
uniform float uTwist;   // ねじれの強さ (%)
uniform float uWarp;   // ループのうねり (歪み) の大きさ (%)
uniform float uGlow;   // 内側の発光の強さ (%)
uniform float uShine;   // 鏡面ハイライトの強さ (%)
uniform float uScale;   // 物体全体の大きさ (%)
uniform float uAngle;   // 向き (度。固定角でずらす)
uniform float uSteps;   // レイマーチの反復回数 (下げると軽いが、遠景や細部が欠ける)
// @param uLoopRadius 70..125  = 100.0
// @param uWhipAmp    0..200   = 100.0
// @param uWhip3      0..200   = 100.0
// @param uWhipLobes  1..4     = 3.0
// @param uLift       0..160   = 100.0
// @param uLiftLobes  1..3     = 2.0
// @param uLift3      0..130   = 100.0
// @param uGlowReach  40..180  = 100.0
// @param uSquash     75..125  = 100.0
// @param uCamElev    70..200   = 100.0
// @param uRefract    93..108  = 100.0
// @param uGlassFade  50..140  = 100.0
// @param uShinePow   30..300  = 100.0
uniform float uLoopRadius; // ループの半径 (%)
uniform float uWhipAmp;    // 大きな 1 周期のうねりの振れ幅 (%)
uniform float uWhip3;      // 細かいローブのうねりの振れ幅 (%)
uniform float uWhipLobes;  // 細かいローブの数
uniform float uLift;       // 上下の波打ちの高さ (%)
uniform float uLiftLobes;  // 上下の波の山の数
uniform float uLift3;      // 細かい上下の波の高さ (%)
uniform float uGlowReach;  // 表面の発光のにじみの幅 (%)
uniform float uSquash;     // チューブ断面の縦横比 (%)。下げると平たいリボン、上げると縦長
uniform float uCamElev;    // カメラの上下の振れ幅 (%)
uniform float uRefract;    // ガラスの屈折率の差 (%)。上げるほど屈折が弱い
uniform float uGlassFade;  // ガラスを通るごとの減衰 (%)。上げると奥まで見える
uniform float uShinePow;   // ハイライトの鋭さ (%)

// @param uCenterX -100..100 = 0.0
// @param uCenterY -100..100 = 0.0
// @param uMirrorX -100..100 = 0.0
// @param uRoll -180..180 = 0.0
// @param uCamDist 70..140 = 100.0
// @param uCamLift -100..100 = 0.0
// @param uFov 60..160 = 100.0
// @param uLightLift -100..100 = 0.0
// @param uLightSep -100..100 = 0.0
// @param uLight1Gain 0..250 = 100.0
// @param uGlassMilk 0..300 = 100.0
// @param uFarClip 60..100 = 100.0
// @param uVignette 0..100 = 0.0
// @param uGrain 0..100 = 0.0
// @param uVolTint color = #ffffff
// @param uGlassTint color = #ffffff
// @param uLight1Tint color = #ffffff
// @param uLight2Tint color = #ffffff
uniform float uCenterX; // 物体の位置を横へずらす (%)
uniform float uCenterY; // 物体の位置を縦へずらす (%)
uniform float uMirrorX; // 左右の鏡像 (%)。正負で写す側が入れ替わり、大きさで軸が動く。0 で無効
uniform float uRoll; // カメラのロール (度)。画面が傾く
uniform float uCamDist; // カメラの距離 (%)
uniform float uCamLift; // カメラの高さの底上げ (%)。負で見上げ、正で見下ろし
uniform float uFov; // 画角 (%)。上げると広角、下げると望遠
uniform float uLightLift; // 2 つの光源の高さ (%)。負で低く、正で高く
uniform float uLightSep; // 2 つの光源の方位の開き (%)
uniform float uLight1Gain; // 暖色の光源の強さ (%)
uniform float uGlassMilk; // ガラスの白い厚みの濃さ (%)
uniform float uFarClip; // 奥行きの打ち切り距離 (%)。下げると奥が早く消える
uniform float uVignette; // 周辺減光 (%)
uniform float uGrain; // 粒状ノイズの量 (%)
uniform vec3 uVolTint; // 内側の発光の色味 (掛け算のティント)
uniform vec3 uGlassTint; // ガラスの白い厚みの色味 (掛け算のティント)
uniform vec3 uLight1Tint; // 暖色の光源の色味 (掛け算のティント)
uniform vec3 uLight2Tint; // 寒色の光源の色味 (掛け算のティント)

// 距離場: 1本の波打つループ(最低限のパス)。半径・高さが大きく動き、局所的に大きく伸縮する。
//   入り組みを避けつつダイナミックに。単一トーラスなので軽い。
float fr_de(vec3 p){
  float sc = uScale / 100.0;
  p /= sc;
  p = fr_rotmat(normalize(vec3(0.4, 1.0, 0.2)), time*0.3 + radians(uAngle)) * p;    // ゆるい全体回転
  float tw = 0.8*sin(time*0.5)*(uTwist / 100.0);                                   // ねじれ
  float c = cos(p.y*tw), s = sin(p.y*tw);
  p.xz = mat2(c, -s, s, c) * p.xz;
  float a = atan(p.z, p.x);                                       // ループ上の角度
  float radC  = 1.7 * (uLoopRadius / 100.0) + 0.8*(uWhipAmp / 100.0)*sin(a + time*1.7)*(uWarp / 100.0) + 0.45*(uWhip3 / 100.0)*sin(a*float(int(uWhipLobes + 0.5)) - time*1.1)*(uWarp / 100.0); // 多ローブの whip
  float yC    = 1.0*(uLift / 100.0)*sin(a*float(int(uLiftLobes + 0.5)) + time*1.3) + 0.45*(uLift3 / 100.0)*sin(a*3.0 + time*0.8);   // 豊かな波打ち(3Dパス)
  float bulge = pow(max(0.0, sin(a + time*1.2)), 5.0) * max(0.0, 1.2 + 2.0*sin(time*0.9)); // 頻繁に大きく伸びる
  vec2 q = vec2(length(p.xz) - radC, p.y - yC);
  float qd = length(q);
  float sqF = 1.0;
  if(uSquash != 100.0){ float sk = uSquash / 100.0; qd = length(vec2(q.x, q.y * sk)); sqF = min(1.0, 1.0 / sk); }
  return (qd * sqF - (0.32 * (uThick / 100.0) + bulge)) * sc;                             // チューブを太め(ガラスの厚み)
}

vec3 fr_normal(vec3 p){
  vec2 e = vec2(0.0, 0.01);
  return normalize(vec3(
    fr_de(p+e.yxx) - fr_de(p-e.yxx),
    fr_de(p+e.xyx) - fr_de(p-e.xyx),
    fr_de(p+e.xxy) - fr_de(p-e.xxy)));
}

vec3 bg_fragile(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 coord = (I*2.0 - resolution) / resolution.y;
  if(uMirrorX != 0.0){ float ax = uMirrorX / 100.0 * 0.5; coord.x = ax + sign(uMirrorX) * abs(coord.x - ax); }
  if(uRoll != 0.0){ float rl = radians(uRoll); coord = mat2(cos(rl), -sin(rl), sin(rl), cos(rl)) * coord; }
  if(uCenterX != 0.0 || uCenterY != 0.0) coord -= vec2(uCenterX, uCenterY) / 100.0 * 0.6;

  // カメラ: 原点(中心オブジェクト)を周回
  float ct = time*0.3;
  float camDist = 4.0 * (uCamDist / 100.0);
  vec3 from = vec3(cos(ct)*camDist, sin(ct*0.6)*1.6*(uCamElev / 100.0), sin(ct)*camDist);
  if(uCamLift != 0.0) from.y += uCamLift / 100.0 * 2.0;
  vec3 cw = normalize(-from);
  vec3 cu = normalize(cross(vec3(0.0, 1.0, 0.0), cw));
  vec3 cv = cross(cw, cu);
  float fov = 0.9 * (uFov / 100.0);
  vec3 raydir = normalize(coord.x*fov*cu + coord.y*fov*cv + cw);

  vec3 lightcol1 = vec3(1.0, 0.95, 0.85) * uLight1Tint * (uLight1Gain / 100.0);
  vec3 lightcol2 = vec3(0.85, 0.95, 1.0) * uLight2Tint;
  vec3 light1 = normalize(vec3(cos(time*0.5), 0.6, sin(time*0.5)));
  vec3 light2 = normalize(vec3(cos(time*0.5 + 2.0), 0.4, -sin(time*0.5)));
  if(uLightSep != 0.0) light2 = normalize(vec3(cos(time*0.5 + 2.0 + uLightSep / 100.0 * 2.0), 0.4, -sin(time*0.5)));
  if(uLightLift != 0.0){ light1 = normalize(vec3(light1.x, light1.y + uLightLift / 100.0 * 0.8, light1.z)); light2 = normalize(vec3(light2.x, light2.y + uLightLift / 100.0 * 0.8, light2.z)); }

  float jit = fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453);  // バンディング対策のディザ
  float totdist = jit*0.12, glassfade = 1.0, ref = 0.0, vol = 0.0, maxdist = 11.0 * (uFarClip / 100.0);
  vec3 spec = vec3(0.0);
  float shp = 40.0 * (uShinePow / 100.0);
  for(int r = 0; r < 56; r++){ if(r >= int(uSteps + 0.5)) break;                                    // 軽量化: 60→46 ステップ
    vec3 p = from + totdist*raydir;
    float d = fr_de(p);
    float distfade = exp(-1.0*pow(totdist/maxdist, 2.0));
    float intens = min(distfade, glassfade);
    vec3 n = (abs(d) < 0.35) ? fr_normal(p) : vec3(0.0, 0.0, 1.0);  // 表面付近のみ法線
    if(d > 0.0 && ref > 0.5){
      ref = 0.0;
      if(dot(raydir, n) < -0.5) raydir = normalize(refract(raydir, n, 1.0/(0.88 * (uRefract / 100.0))));
      vec3 refl = reflect(raydir, n);
      spec += lightcol1*pow(max(dot(refl, light1), 0.0), shp)*intens*0.75;
      spec += lightcol2*pow(max(dot(refl, light2), 0.0), shp)*intens*0.75;
    }
    if(d < 0.0 && ref < 0.05){
      ref = 1.0;
      if(dot(raydir, n) < -0.05) raydir = normalize(refract(raydir, n, 0.88 * (uRefract / 100.0)));
      vec3 refl = reflect(raydir, n);
      glassfade *= 0.6 * (uGlassFade / 100.0);
      spec += lightcol1*pow(max(dot(refl, light1), 0.0), shp)*intens;
      spec += lightcol2*pow(max(dot(refl, light2), 0.0), shp)*intens;
    }
    totdist += max(0.008, abs(d)*0.5);                            // 細かい刻みでジャギー低減
    vol += intens * smoothstep(0.30 * (uGlowReach / 100.0), 0.0, abs(d));                // 表面付近のみグロー → 背景は暗い
    if(totdist > maxdist) break;
  }
  vol = pow(vol, 1.3) * 0.009 * (uGlow / 100.0);
  vec3 col = vec3(vol)*vec3(0.82, 0.90, 1.05)*uVolTint + spec*0.6*(uShine / 100.0);
  col += vec3(0.92, 0.96, 1.0) * uGlassTint * (1.0 - glassfade) * 0.22 * (uGlassMilk / 100.0);       // ガラス通過量=白い厚み

  if(abs(uCosGrad) > 0.0001){
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, cosGradColor(lum) * (0.2 + 1.4*lum), abs(uCosGrad));
  }
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  bgAlpha = clamp(lum*2.5, 0.0, 1.0);                             // 背景は透過(両スロット)
  if(uVignette != 0.0){ vec2 vq = (fc * 2.0 - resolution) / resolution.y; col *= 1.0 - clamp(dot(vq, vq) * 0.35, 0.0, 1.0) * uVignette / 100.0; }
  if(uGrain != 0.0) col += (fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * uGrain / 100.0 * 0.6 * bgAlpha;
  return col;
}
