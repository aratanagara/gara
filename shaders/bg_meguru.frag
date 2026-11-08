// 1) bg_meguru
// @gradmask — grad map は図柄(α=1)にのみ適用。背景(α=0, 白/グレー)には乗せない
#define BN_DST 45.0
#define BN_ITR 45
#define BN_SRF 0.2546263
#define BN_PI  acos(-1.0)
#define BN_RT(X) mat2(cos(X), sin(X), -sin(X), cos(X))

float bn_t = 0.0;

float bn_hash11(float x){
  return fract(sin(x * 127.1) * 43758.5453123);
}

float bn_box(vec3 sp, vec3 d){
  sp = abs(sp) - d;
  return max(max(sp.x, sp.y), sp.z);
}

float bn_k3d(vec3 sp, vec3 d, vec3 dm, float s, vec3 r){
  float sc  = 1.0;
  float sdf = BN_DST;
  for(int i=0;i<2;i++){
    sp = abs(sp) - d;
    sp.xy *= BN_RT(r.x);
    sp.zy *= BN_RT(r.y);
    sp.zy *= BN_RT(r.z);
    sdf = min(sdf, bn_box(sp, dm) / sc);
    sp *= sc;
    sc *= s;
  }
  return sdf;
}

// @param uSpread 50..150 = 100.0
// @param uThick  30..200 = 100.0
// @param uTwist  0..200 = 100.0
// @param uGlow   60..300 = 100.0
// @param uScale 50..150 = 100.0
// @param uAngle -180..180 = 0.0
// @param uSteps 28..45 = 45.0
// @param uBarLength 50..150 = 100.0
// @param uBarHeight 30..400 = 100.0
// @param uBarDepth  30..200 = 100.0
// @param uOffsetX   90..150 = 100.0
// @param uOffsetZ   70..150 = 100.0
// @param uSubScale  70..150 = 100.0
// @param uKnotA     50..150 = 100.0
// @param uKnotB     85..150 = 100.0
// @param uCoilTwist 75..150 = 100.0
// @param uBandWidth 50..150 = 100.0
// @param uCamHeight -100..100 = 0.0
// @param uCamSide -40..100 = 0.0
// @param uLens 100..200 = 100.0
// @param uStripeScale 0..400 = 100.0
// @param uDepthHue 100..500 = 100.0
// @param uBandEdge 20..110 = 100.0
// @param uBandShift -100..100 = 0.0
// @param uDepthFade 30..100 = 100.0
// @param uTint color = #ffffff
uniform float uSpread; // 構造の広がり (%)
uniform float uThick; // 棒の太さ (%)
uniform float uTwist; // ねじれの強さ (%)
uniform float uGlow; // 明るさ (%)
uniform float uScale; // 物体全体の大きさ (%)
uniform float uAngle; // 向き (度。固定角でずらす)
uniform float uSteps; // レイマーチのステップ数 (下げると軽く、遠景や細部が欠ける)
uniform float uBarLength; // 棒の長さ (%)
uniform float uBarHeight; // 棒の断面の高さ (%)
uniform float uBarDepth; // 棒の断面の奥行き (%)
uniform float uOffsetX; // 折り返しの X 方向の間隔 (%)
uniform float uOffsetZ; // 折り返しの Z 方向の間隔 (%)
uniform float uSubScale; // 2 段目の小さな棒の縮尺 (%)
uniform float uKnotA; // 折り返しごとの回転 (XY 面) の量 (%)
uniform float uKnotB; // 折り返しごとの回転 (ZY 面) の量 (%)
uniform float uCoilTwist; // 奥行き方向 (XY 回転) のねじれの強さ (%)
uniform float uBandWidth; // 色の帯 (量子化段) の幅 (%)
uniform float uCamHeight; // カメラの高さ (%)。0 で元の位置
uniform float uCamSide; // カメラの左右位置 (%)。0 で元の位置
uniform float uLens; // 画角 (%)。大きいほど望遠
uniform float uStripeScale; // 空間に沿った色の縞の細かさ (%)。0 で縞なし
uniform float uDepthHue; // 奥行きによる色変化の量 (%)
uniform float uBandEdge; // 色帯の境目のぼかし開始位置 (%)。小さいほどなだらか
uniform float uBandShift; // 色帯の位置ずらし (%)
uniform float uDepthFade; // 奥ほど暗くなる度合い (%)
uniform vec3 uTint; // 図柄のティント色

vec2 bn_map(vec3 sp){
  float sc = uScale / 100.0;
  sp /= sc;
  sp.zy *= BN_RT(sp.x * 0.2 * (uTwist / 100.0) + bn_t);
  sp.xy *= BN_RT(sp.z * 0.05 * (uTwist / 100.0) * (uCoilTwist / 100.0) + bn_t);
  float dst0 = bn_k3d(sp, vec3(7.0 * (uOffsetX / 100.0), 5.0, 3.0 * (uOffsetZ / 100.0)) * (uSpread / 100.0), vec3(5.0 * (uBarLength / 100.0), 0.7 * (uThick / 100.0) * (uBarHeight / 100.0), 0.7 * (uThick / 100.0) * (uBarDepth / 100.0)), 1.7 * (uSubScale / 100.0), vec3(2.0 * (uKnotA / 100.0), 3.0 * (uKnotB / 100.0), 2.0));
  return vec2(dst0 * sc, 0.0);
}

vec3 bn_mrch(vec3 ro, vec3 rd){
  float d0 = 0.0;
  float id = 0.0;
  float it = 0.0;
  for(int i=0;i<BN_ITR;i++){
    if(i >= int(uSteps + 0.5)) break;
    it = float(i);
    vec3 sp = ro + rd * d0;
    vec2 ds = bn_map(sp);
    if(abs(ds.x) < BN_SRF || d0 > BN_DST){
      if(abs(ds.x) < BN_SRF){ d0 = 0.0; }else{ break; }
    }
    d0 += ds.x;
    id  = ds.y;
  }
  if(d0 > BN_DST) d0 = 0.0;
  return vec3(d0, id, it);
}

float vnoise2(vec2 p, float salt){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  vec2 s = vec2(salt, salt*1.37);
  float a = hash21(i + vec2(0.0,0.0) + s);
  float b = hash21(i + vec2(1.0,0.0) + s);
  float c = hash21(i + vec2(0.0,1.0) + s);
  float d = hash21(i + vec2(1.0,1.0) + s);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}

float fbm2(vec2 p, float salt){
  float n = 0.0;
  float a = 0.55;
  mat2 m = mat2(0.8, -0.6, 0.6, 0.8);
  for(int i=0;i<5;i++){
    n += a * vnoise2(p, salt + float(i)*19.7);
    p = m * p * 2.02;
    a *= 0.5;
  }
  return n;
}

vec3 bg_meguru(vec2 fc){
  float bt = getBeat();
  bool freeModeActive = isFree();
  float b = floor(bt);
  float j = freeModeActive ? 0.0 : bn_hash11(b);
  vec2 camPx;
  float zoom;
  float angle;
  float tm;
  if(freeModeActive){
    camPx = droneSeamlessCam(bt, 777.0);
    zoom = droneSeamlessZoom(bt, 888.0) * bgZoom;
    angle = droneSeamlessAngle(bt, 999.0);
    tm = bt * 1.20 + sin(bt * 0.35) * 0.8 + sin(bt * 0.11) * 1.6;
  } else {
    camPx = drawRandomCam(bt, 777.0);
    zoom = drawRandomZoom(bt, 888.0) * bgZoom;
    angle = drawRandomAngle(bt, 999.0);
    tm = bt;
  }
  vec2 uv = (fc - 0.5 * resolution) / (resolution.y * zoom);
  float cosA = cos(angle + radians(uAngle));
  float sinA = sin(angle + radians(uAngle));
  uv = vec2(cosA * uv.x - sinA * uv.y, sinA * uv.x + cosA * uv.y);
  uv += camPx / resolution.y * 5.0;
  uv.x *= 0.5;
  float beatKick = freeModeActive ? 0.0 : (j * 10.0);
  bn_t = mod((tm * 0.05) + beatKick, BN_PI * 30.0);
  vec3 ro = vec3(0.5, 0.0, -20.0);
  if(uCamHeight != 0.0) ro.y += uCamHeight * 0.02;
  if(uCamSide != 0.0) ro.x += uCamSide * 0.02;
  vec3 w = normalize(-ro);
  vec3 u = normalize(cross(w, vec3(0.0, 1.0, 0.0)));
  vec3 v = cross(u, w);
  vec3 rd = normalize(mat3(u, v, w) * vec3(uv, 0.5 * (uLens / 100.0)));
  float uvLen = length(uv);
  vec3 bgc = vec3(1.0 - (uvLen - 1.0)) * 0.001;
  vec3 amb = bgc * 0.1;
  vec3 ds = bn_mrch(ro, rd);
  float d0 = ds.x;
  if(d0 <= 0.0){ bgAlpha = 0.0; return vec3(0.0); }   // 背景は黒 + 透明
  vec3 sp = ro + rd * d0;
  // OFF: 素のグレースケール / ON(uCosGrad): 固有の cosine gradient 彩色
  // 空間/距離による位相をソフト量子化してバンド状の濃淡にする
  float phase = freeModeActive ? (tm * 0.0018) : (bt * 0.015 + j * 1.5);
  float spatialGrad = dot(sp, vec3(0.008, 0.006, 0.010)) * (uStripeScale / 100.0);
  float colorParam = spatialGrad + d0 * 0.006 * (uDepthHue / 100.0) + bn_t * 0.08 + phase;
  if(uBandShift != 0.0) colorParam += uBandShift * 0.01;
  float qStep = 0.34 * (uBandWidth / 100.0);
  float qf = colorParam / qStep;
  float qb = floor(qf);
  float qramp = smoothstep(0.45 * (uBandEdge / 100.0), 1.00, fract(qf));
  colorParam = (qb + qramp) * qStep;
  vec3 palette = vec3(fract(colorParam));
  if(abs(uCosGrad) > 0.0001){
    float cgInv = uCosGrad < 0.0 ? 0.5 : 0.0;
    // 共有 cosGradColor を使用。自前の時間ドリフト phase を差し引き、回転は共有側(getBeat*0.04)に統一。
    vec3 cosPalette = cosGradColor((colorParam - phase) + cgInv);
    palette = mix(palette, cosPalette, abs(uCosGrad));
  }
  if(uTint != vec3(1.0)) palette *= uTint;
  vec3 rainbow_fcl = palette / (d0 * 0.005 * (uDepthFade / 100.0) + 0.05);
  return amb + clamp(rainbow_fcl, 0.0, 10.0) * 0.15 * (uGlow / 100.0) - 0.35;
}

