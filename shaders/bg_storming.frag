// =====================================================
// bg_storming  (H50)
//   Source : Shadertoy "Storming Pixels"  https://www.shadertoy.com/view/Wl2SWG
//            Leon Denise (ponk) 2019 / IQ・McGuire のコード使用
//   改変: iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//         カメラに緩い自動回転を追加。空(sky)合成をやめ、構造のヒット量を被覆率に使って
//         背景透過(bgAlpha)。Slot A=黒背景(不透明) / それ以外=透過して重ねる。
//         cosineGradient(uCosGrad)対応。ヘルパは st_ で名前空間化。
// =====================================================

const float ST_RANGE   = 1.0;
const float ST_RADIUS  = 0.35;
const float ST_BLEND   = 0.7;
const float ST_BALANCE = 1.9;
const float ST_FALLOFF = 1.8;

float st_random(vec2 p){ return fract(1e4 * sin(17.0*p.x + p.y*0.1) * (0.1 + abs(sin(p.y*13.0 + p.x)))); }
mat2  st_rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
float st_smin(float a, float b, float r){ float h = clamp(0.5+0.5*(b-a)/r, 0.0, 1.0); return mix(b,a,h)-r*h*(1.0-h); }
vec3  st_look(vec3 eye, vec3 target, vec2 anchor, float fov){
  vec3 fwd = normalize(target-eye);
  vec3 right = normalize(cross(fwd, vec3(0,1,0)));
  vec3 up = normalize(cross(right, fwd));
  return normalize(fwd*fov + right*anchor.x + up*anchor.y);
}

// @param uDetail 2..6    = 6.0
// @param uSpread 50..200  = 100.0
// @param uSize  25..250  = 100.0
// @param uSoft   20..300  = 100.0
// @param uWarp   0..250   = 100.0
// @param uAngle -180..180 = 0.0
// @param uScale 50..200 = 100.0
// @param uSteps 16..30 = 30.0
// @param uFoldTwist 50..150 = 100.0
// @param uFalloff 80..130 = 100.0
// @param uLevelLift -100..100 = 0.0
// @param uBeatEase 30..300 = 100.0
// @param uBlobFlat 60..160 = 100.0
// @param uEyeHeight 50..150 = 100.0
// @param uFocal 60..160 = 100.0
// @param uWarmHalo 0..250 = 100.0
// @param uHaloReach 40..200 = 100.0
// @param uSkyReach 50..200 = 100.0
// @param uScreenWave 0..250 = 100.0
// @param uBreath 0..300 = 100.0
// @param uEyeOrbit -180..180 = 0.0
// @param uLookShift -100..100 = 0.0
// @param uRoll -180..180 = 0.0
// @param uSwirl 0..250 = 100.0
// @param uBlobTint color = #ffffff
// @param uHaloTint color = #ffffff
// @param uSkyTint color = #ffffff
// @param uDustAmt 0..300 = 100.0
// @param uHitEps 50..400 = 100.0
// @param uShadeCurve 50..200 = 100.0
// @param uSilhouette 30..300 = 100.0
// @param uVignette 0..200 = 0.0
uniform float uDetail;    // 折り畳みの反復回数 (下げると軽く、構造が単純になる)
uniform float uSpread;    // 折り畳みの広がり (%)
uniform float uSize;     // 球塊の大きさ (%)
uniform float uSoft;      // 球塊どうしの融合の柔らかさ (%)
uniform float uWarp;      // 構造のうねり (ドメインワープ) の強さ (%)
uniform float uAngle; // 折り畳みごとの向き (度。固定角でずらす)
uniform float uScale; // 物体全体の大きさ (%。画面・カメラは動かない)
uniform float uSteps; // レイマーチのステップ数 (下げると軽く、遠方が欠ける)
uniform float uFoldTwist; // 折り畳みごとの回転の振れ幅 (%)
uniform float uFalloff; // 段ごとの縮み方 (%)。上げると小さい球が増える
uniform float uLevelLift; // 段ごとの縦のずれ (%)。0 = 水平に折り畳む
uniform float uBeatEase; // 拍ごとの動きの急さ (%)。下げると急に動く
uniform float uBlobFlat; // 球塊の縦横比 (%)。上げると平たく、下げると縦長
uniform float uEyeHeight; // カメラの高さ (%)
uniform float uFocal; // 画角の狭さ (%)。上げると望遠
uniform float uWarmHalo; // 手前の暖色のにじみ (%)
uniform float uHaloReach; // 暖色のにじみの届く距離 (%)
uniform float uSkyReach; // 背景の光の広がり (%)
uniform float uScreenWave; // 画面のうねりの振れ幅 (%)
uniform float uBreath; // 放射状の脈動の振れ幅 (%)
uniform float uEyeOrbit; // カメラを物体の周りに回す角度 (度)
uniform float uLookShift; // 視線の上下のずらし (%)
uniform float uRoll; // 画面の傾き (度)
uniform float uSwirl; // 画面中心からの渦巻きの強さ (%)
uniform vec3 uBlobTint; // 球塊のティント色
uniform vec3 uHaloTint; // 暖色のにじみのティント色
uniform vec3 uSkyTint; // 背景の光のティント色
uniform float uDustAmt; // 表面の粉状の粒立ち (%)
uniform float uHitEps; // 表面とみなす距離のしきい値 (%)。大きいほど輪郭がふくらむ
uniform float uShadeCurve; // 奥行きの陰影の曲線 (%)。上げると暗部が沈む
uniform float uSilhouette; // 球塊と背景の境目の鋭さ (%)。下げると背景が染み込む
uniform float uVignette; // 周辺減光 (%)

float st_geometry0(vec3 pos, float tm){
  // 流れるドメインワープ: 折り畳み前に pos を正弦場でうねらせる(有機的な歪み)
  pos += 0.16 * (uWarp / 100.0) * sin(pos.zxy * 1.7 + tm * 0.6);
  float a = 1.0;
  float scene = 1.0;
  float t = tm + pos.x/4.0;
  if(uBeatEase != 100.0) t = floor(t) + pow(fract(t), 0.5 * (uBeatEase / 100.0));
  else t = floor(t) + pow(fract(t), 0.5);
  for(int i=6; i>0; --i){
    if(6 - i >= int(uDetail + 0.5)) break;
    pos.xy *= st_rot(cos(t)*ST_BALANCE*(uFoldTwist / 100.0)/a + a*2.0 + radians(uAngle));
    pos.zy *= st_rot(sin(t)*ST_BALANCE*(uFoldTwist / 100.0)/a + a*2.0 + radians(uAngle));
    pos.xz = abs(pos.xz) - ST_RANGE*(uSpread / 100.0)*a;
    if(uLevelLift != 0.0) pos.y -= (uLevelLift / 100.0) * a;
    float ln = length(pos);
    if(uBlobFlat != 100.0){ float kf = 100.0 / uBlobFlat; ln = length(pos * vec3(1.0, kf, 1.0)) / max(kf, 1.0); }
    scene = st_smin(scene, ln-ST_RADIUS*(uSize / 100.0)*a, ST_BLEND*(uSoft / 100.0)*a);
    a /= ST_FALLOFF * (uFalloff / 100.0);
  }
  return scene;
}

// 物体全体のスケール (距離も補正)
float st_geometry(vec3 pos, float tm){
  float sc = uScale / 100.0;
  return st_geometry0(pos / sc, tm) * sc;
}

float st_raymarch(vec3 eye, vec3 ray, float tm, out float total){
  float dither = st_random(ray.xy + fract(time));
  total = 0.0;
  const int count = 30;
  int cnt = int(uSteps + 0.5);
  float dk = 0.9, dm = 0.1, hk = 0.001;
  if(uDustAmt != 100.0){ dm = 0.1*(uDustAmt / 100.0); dk = 1.0 - dm; }
  if(uHitEps != 100.0) hk = 0.001*(uHitEps / 100.0);
  for(int k=0; k<count; k++){
    if(k >= cnt) break;
    int index = cnt - k;
    float dist = st_geometry(eye + ray*total, tm);
    dist *= dk + dm*dither;                 // 原典どおり(微細な粒揺らぎ)
    total += dist;
    if(dist < hk*total){
      float sh = float(index)/float(cnt);
      if(uShadeCurve != 100.0) sh = pow(sh, uShadeCurve / 100.0);
      return sh;
    }
  }
  return 0.0;
}

vec3 st_cosgrad(vec3 col, float param){
  if(abs(uCosGrad) < 0.0001) return col;
  float cgInv = uCosGrad < 0.0 ? 0.5 : 0.0;
  vec3 cosCol = cosGradColor(param + cgInv);
  float lum = dot(col, vec3(0.299,0.587,0.114));
  cosCol *= 0.35 + 0.95*lum;
  return mix(col, clamp(cosCol,0.0,1.0), abs(uCosGrad));
}

vec3 bg_storming(vec2 fc){
  // 原作 Wl2SWG そのまま(改変なし)。粉状=フラクタルの微細な当たり/外れ+dither による per-pixel スペックル。
  //   ハーネス対応: fc→bgZoom/bgCamPx、iTime→time。カメラは原作どおり固定 eye=(1,3.5,1)。
  vec2 I  = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = 2.0*(I - 0.5*resolution) / resolution.y;

  // ワープ/カーブ: 画面 uv を「中心からの距離に応じた渦巻き」+「うねり」で歪める
  if(uRoll != 0.0) uv = st_rot(radians(uRoll)) * uv;
  float rr = length(uv);
  uv *= st_rot((0.35 + 0.35*sin(time*0.25)) * rr);
  if(uSwirl != 100.0) uv *= st_rot((0.35 + 0.35*sin(time*0.25)) * rr * (uSwirl / 100.0 - 1.0));                       // 距離依存の渦巻き(カーブ)
  uv += 0.14 * (uScreenWave / 100.0) * vec2(sin(uv.y*3.0 + time*0.7), cos(uv.x*3.0 + time*0.6));  // うねりワープ
  uv *= 1.0 + 0.10 * (uBreath / 100.0) * sin(rr*3.5 - time*0.8);                             // 放射状のうねり(脈動)

  vec3 eye = vec3(1.0, 3.5 * (uEyeHeight / 100.0), 1.0);
  if(uEyeOrbit != 0.0) eye.xz = st_rot(radians(uEyeOrbit)) * eye.xz;
  vec3 ray = st_look(eye, vec3(0.0, uLookShift * 0.03, 0.0), uv, 2.0 * (uFocal / 100.0));

  float total = 0.0;
  vec3 o = vec3(0.0);
  // 原作の motion_frames ループ(1回)
  float dither = st_random(ray.xy + fract(time + 1.0));
  float tm = time + (dither + 1.0)/10.0;
  o = vec3(st_raymarch(eye, ray, tm, total));

  // 原作の色処理そのまま(最後のガンマ pow(.4545) は原作に無い)
  float gray = o.r;
  o *= vec3(0.8, 0.8, 0.9);
  if(uBlobTint != vec3(1.0)) o *= uBlobTint;
  float d = smoothstep(0.0, 2.0 * (uSkyReach / 100.0), length(uv));
  vec3 sky = mix(vec3(0.35, 0.37, 0.4), vec3(0.0), d);
  if(uSkyTint != vec3(1.0)) sky *= uSkyTint;
  d = smoothstep(5.0 * (uHaloReach / 100.0), 0.0, total);
  if(uHaloTint == vec3(1.0)) o += vec3(0.8, 0.7, 0.6) * d * (uWarmHalo / 100.0);
  else o += vec3(0.8, 0.7, 0.6) * uHaloTint * d * (uWarmHalo / 100.0);
  if(uSilhouette == 100.0) o = mix(sky, o, pow(clamp(o.r, 0.0, 1.0), 0.3));
  else o = mix(sky, o, pow(clamp(o.r, 0.0, 1.0), 0.3 * (uSilhouette / 100.0)));

  o = st_cosgrad(o, gray);
  bgAlpha = clamp(pow(clamp(gray, 0.0, 1.0), 0.3), 0.0, 1.0);
  if(uVignette != 0.0) o *= max(1.0 - (uVignette / 100.0) * 0.3 * rr * rr, 0.0);
  return clamp(o, 0.0, 1.0);
}
