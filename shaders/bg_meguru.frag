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

vec2 bn_map(vec3 sp){
  sp.zy *= BN_RT(sp.x * 0.2 + bn_t);
  sp.xy *= BN_RT(sp.z * 0.05 + bn_t);
  float dst0 = bn_k3d(sp, vec3(7.0, 5.0, 3.0), vec3(5.0, 0.7, 0.7), 1.7, vec3(2.0, 3.0, 2.0));
  return vec2(dst0, 0.0);
}

vec3 bn_mrch(vec3 ro, vec3 rd){
  float d0 = 0.0;
  float id = 0.0;
  float it = 0.0;
  for(int i=0;i<BN_ITR;i++){
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
  float cosA = cos(angle);
  float sinA = sin(angle);
  uv = vec2(cosA * uv.x - sinA * uv.y, sinA * uv.x + cosA * uv.y);
  uv += camPx / resolution.y * 5.0;
  uv.x *= 0.5;
  float beatKick = freeModeActive ? 0.0 : (j * 10.0);
  bn_t = mod((tm * 0.05) + beatKick, BN_PI * 30.0);
  vec3 ro = vec3(0.5, 0.0, -20.0);
  vec3 w = normalize(-ro);
  vec3 u = normalize(cross(w, vec3(0.0, 1.0, 0.0)));
  vec3 v = cross(u, w);
  vec3 rd = normalize(mat3(u, v, w) * vec3(uv, 0.5));
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
  float spatialGrad = dot(sp, vec3(0.008, 0.006, 0.010));
  float colorParam = spatialGrad + d0 * 0.006 + bn_t * 0.08 + phase;
  float qStep = 0.34;
  float qf = colorParam / qStep;
  float qb = floor(qf);
  float qramp = smoothstep(0.45, 1.00, fract(qf));
  colorParam = (qb + qramp) * qStep;
  vec3 palette = vec3(fract(colorParam));
  if(abs(uCosGrad) > 0.0001){
    float cgInv = uCosGrad < 0.0 ? 0.5 : 0.0;
    // 共有 cosGradColor を使用。自前の時間ドリフト phase を差し引き、回転は共有側(getBeat*0.04)に統一。
    vec3 cosPalette = cosGradColor((colorParam - phase) + cgInv);
    palette = mix(palette, cosPalette, abs(uCosGrad));
  }
  vec3 rainbow_fcl = palette / (d0 * 0.005 + 0.05);
  return amb + clamp(rainbow_fcl, 0.0, 10.0) * 0.15 - 0.35;
}

