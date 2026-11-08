// =====================================================
// bg_stractium  (H58)
//   Source : Shadertoy "Stractium" by Otavio Good (CC0)  https://www.shadertoy.com/view/Mlf3R4
//   球を SinRep(コサイン和)で歪めた塊をレイマーチ。カメラ周回 / 岩肌テクスチャ / 太陽光・フォグ。
//   改変: iTime,iResolution → time,resolution / iMouse 固定 / bgZoom・bgCamPx 対応。
//        重いので march 250→96・SinRep 9→5 に軽量化。変形を激しめに。
//        Slot B のとき背景(空)を透過(bgAlpha=0)。cosineGradient(uCosGrad)対応。
//        ヘルパは st_ で名前空間化(saturate/noise/Rotate 等の衝突回避)。
// =====================================================

const int   ST_SIN_REPS  = 5;     // 元 9。ディテール量(軽量化)
const int   ST_MARCH_REPS = 124;   // 元 250
const float ST_MARCH_MULT = 0.14;  // 元 0.1(激しい変形でも斑点が出にくいよう細かめ)

float st_localTime = 0.0;
const vec2 st_zeroOne = vec2(0.0, 1.0);
vec3 st_sunCol = vec3(258.0, 228.0, 170.0) / 3555.0;

float st_saturate(float a){ return clamp(a, 0.0, 1.0); }
vec2  st_saturate(vec2 a){ return clamp(a, 0.0, 1.0); }
vec3  st_saturate(vec3 a){ return clamp(a, 0.0, 1.0); }

float st_Hash3d(vec3 uv){ float f = uv.x + uv.y*37.0 + uv.z*521.0; return fract(sin(f)*110003.9); }
float st_mixP(float f0, float f1, float a){ return mix(f0, f1, a*a*(3.0-2.0*a)); }
float st_noise(vec3 uv){
  vec3 fr = fract(uv), fl = floor(uv);
  float h000=st_Hash3d(fl),                 h100=st_Hash3d(fl+st_zeroOne.yxx);
  float h010=st_Hash3d(fl+st_zeroOne.xyx),  h110=st_Hash3d(fl+st_zeroOne.yyx);
  float h001=st_Hash3d(fl+st_zeroOne.xxy),  h101=st_Hash3d(fl+st_zeroOne.yxy);
  float h011=st_Hash3d(fl+st_zeroOne.xyy),  h111=st_Hash3d(fl+st_zeroOne.yyy);
  return st_mixP(st_mixP(st_mixP(h000,h100,fr.x), st_mixP(h010,h110,fr.x), fr.y),
                 st_mixP(st_mixP(h001,h101,fr.x), st_mixP(h011,h111,fr.x), fr.y), fr.z);
}

vec3 st_RotateX(vec3 v, float r){ float c=cos(r), s=sin(r); return vec3(v.x, c*v.y+s*v.z, -s*v.y+c*v.z); }
vec3 st_RotateY(vec3 v, float r){ float c=cos(r), s=sin(r); return vec3(c*v.x-s*v.z, v.y, s*v.x+c*v.z); }
vec3 st_RotateZ(vec3 v, float r){ float c=cos(r), s=sin(r); return vec3(c*v.x+s*v.y, -s*v.x+c*v.y, v.z); }

vec3 st_GetSunColorReflection(vec3 rayDir, vec3 sunDir){
  vec3 lr = normalize(rayDir);
  float dist = 1.0 - (dot(lr, sunDir)*0.5 + 0.5);
  float si = 0.015/dist; si = pow(si, 0.3)*100.0;
  si += exp(-dist*12.0)*300.0; si = min(si, 40000.0);
  return st_sunCol * si * 0.0425;
}
vec3 st_GetSunColorSmall(vec3 rayDir, vec3 sunDir){
  vec3 lr = normalize(rayDir);
  float dist = 1.0 - (dot(lr, sunDir)*0.5 + 0.5);
  float si = 0.05/dist; si += exp(-dist*12.0)*300.0; si = min(si, 40000.0);
  return st_sunCol * si * 0.025;
}

// @param uDetail 1..5 = 5.0
// @param uWarp 0..130 = 100.0
// @param uTwist 0..200 = 100.0
// @param uDensity 50..200 = 100.0
// @param uGlow 30..250 = 100.0
// @param uScale 50..120 = 100.0
// @param uAngle -180..180 = 0.0
// @param uSteps 50..124 = 124.0
uniform float uDetail;   // 変形の細かさ (折り重ね回数)
uniform float uWarp;   // 変形の激しさ (歪み) (%)
uniform float uTwist;   // 渦のねじれの強さ (%)
uniform float uDensity;   // 変形のうねりの細かさ (%)
uniform float uGlow;   // 全体の明るさ (%)
uniform float uScale;   // 物体全体の大きさ (%)
uniform float uAngle;   // 向き (度。固定角でずらす)
uniform float uSteps;   // レイマーチの反復回数 (下げると軽いが、遠景や細部が欠ける)
// @param uCoreRadius 70..120 = 100
// @param uTwistA -250..250 = 0
// @param uTwistB -250..250 = 0
// @param uTwistC -250..250 = 0
// @param uOctaveRatio 80..130 = 100
// @param uBulgeBase 40..170 = 100
// @param uWeightY 0..250 = 100
// @param uRedBand 0..300 = 100
// @param uRockGrain 40..250 = 100
uniform float uCoreRadius; // 球の芯の半径 (%)
uniform float uTwistA;   // 1 軸目のうねりの追加の捻れ (%)。0 = なし / 負で逆
uniform float uTwistB;   // 2 軸目のうねりの追加の捻れ (%)。0 = なし / 負で逆
uniform float uTwistC;   // 3 軸目のうねりの追加の捻れ (%)。0 = なし / 負で逆
uniform float uOctaveRatio; // 折り重ねごとの細かさの倍率 (%)
uniform float uBulgeBase; // 変形の常時ぶんの膨らみ (%)。時間で増減する分とは別
uniform float uWeightY;  // 2 軸目の変形の効き (%)
uniform float uRedBand;  // 膨らんだ部分の赤い色づき (%)
uniform float uRockGrain; // 岩肌の模様の細かさ (%)
// @param uSunAzim -180..180 = 0
// @param uSunElev -50..50 = 0
// @param uSunGain 0..300 = 100
// @param uSkyLight 0..400 = 100
// @param uBounce 0..500 = 100
// @param uShadowSoft 20..200 = 100
// @param uFogAmount 0..400 = 100
// @param uSunReflect 0..400 = 100
// @param uCamPitch -40..40 = 0
// @param uOrbit -180..180 = 0
// @param uOffX -60..60 = 0
// @param uOffY -60..60 = 0
// @param uRimGain 0..300 = 0
// @param uGloss 0..300 = 0
// @param uSunColor color = #ffffff
// @param uRimColor color = #ffffff
// @param uSkyColor color = #ffffff
// @param uRockColor color = #ffffff
// @param uFogColor color = #ffffff
uniform float uSunAzim; // 太陽の方位 (度)
uniform float uSunElev; // 太陽の仰角の傾け (度)
uniform float uSunGain; // 太陽光の強さ (%)
uniform float uSkyLight; // 上からの青い環境光の強さ (%)
uniform float uBounce; // 下からの白い照り返しの強さ (%)
uniform float uShadowSoft; // 影の柔らかさ (%)。下げると硬く、上げると淡く広がる
uniform float uFogAmount; // 遠くが霞む濃さ (%)
uniform float uSunReflect; // 太陽の映り込みの強さ (%)
uniform float uCamPitch; // カメラの俯仰の傾け (度)
uniform float uOrbit; // 周回の開始角 (度)
uniform float uOffX; // 物体の横位置 (%)
uniform float uOffY; // 物体の縦位置 (%)
uniform float uRimGain; // 縁の青白い照り返しの強さ (%)。0 で従来どおり無し
uniform float uGloss; // 太陽のつやのハイライト (%)
uniform vec3  uRimColor; // 縁の照り返しの色のティント
uniform vec3  uSunColor; // 太陽光の色のティント
uniform vec3  uSkyColor; // 環境光の色のティント
uniform vec3  uRockColor; // 岩肌の地色のティント
uniform vec3  uFogColor; // 霞の色のティント

float st_SinRep(float a){
  float h = 0.0, mult = 1.0;
  for(int i=0; i<ST_SIN_REPS; i++){ if(i >= int(uDetail + 0.5)) break; h += cos(a*mult*(uDensity / 100.0))/mult; mult *= 2.0; }
  return h;
}

float st_SinRepC(float a){
  float h = 0.0, mult = 1.0;
  for(int i=0; i<ST_SIN_REPS; i++){ if(i >= int(uDetail + 0.5)) break; h += cos(a*mult*(uDensity / 100.0))/mult; mult *= 2.0 * (uOctaveRatio / 100.0); }
  return h;
}

// 歪んだ球の距離場。変形を激しめに(振幅アップ + 強めの渦)。
vec2 st_DistanceToObjectC(vec3 p){
  float sc = uScale / 100.0;
  p /= sc;
  p = st_RotateY(p, p.y*0.7*(uTwist / 100.0) - cos(st_localTime)*0.7 + radians(uAngle));          // 強めの渦
  float h = 0.0;
  vec3 pa = st_RotateY(p, p.z*3.14*0.25);
  if(uTwistA != 0.0) pa = st_RotateY(pa, p.z*uTwistA/100.0);
  h += st_SinRepC(pa.x);
  vec3 pb = st_RotateZ(p, p.x*3.14*0.25);
  if(uTwistB != 0.0) pb = st_RotateZ(pb, p.x*uTwistB/100.0);
  h += st_SinRepC(pb.y) * (uWeightY / 100.0);
  vec3 pc = st_RotateX(p, p.y*3.14*0.25);
  if(uTwistC != 0.0) pc = st_RotateX(pc, p.y*uTwistC/100.0);
  h += st_SinRepC(pc.z);
  float material = h;
  float final = length(p) - 4.0 * (uCoreRadius / 100.0) - h*(0.5 * (uBulgeBase / 100.0) + sin(st_localTime)*0.6) * (uWarp / 100.0);  // 変形を激しめ
  return vec2(final * sc, material);
}

vec2 st_DistanceToObject(vec3 p){
  if(uCoreRadius != 100.0 || uTwistA != 0.0 || uTwistB != 0.0 || uTwistC != 0.0 || uOctaveRatio != 100.0 || uBulgeBase != 100.0 || uWeightY != 100.0) return st_DistanceToObjectC(p);
  float sc = uScale / 100.0;
  p /= sc;
  p = st_RotateY(p, p.y*0.7*(uTwist / 100.0) - cos(st_localTime)*0.7 + radians(uAngle));          // 強めの渦
  float h = 0.0;
  h += st_SinRep(st_RotateY(p, p.z*3.14*0.25).x);
  h += st_SinRep(st_RotateZ(p, p.x*3.14*0.25).y);
  h += st_SinRep(st_RotateX(p, p.y*3.14*0.25).z);
  float material = h;
  float final = length(p) - 4.0 - h*(0.5 + sin(st_localTime)*0.6) * (uWarp / 100.0);  // 変形を激しめ
  return vec2(final * sc, material);
}

float st_IntersectSphereAndRay(vec3 pos, float radius, vec3 posA, vec3 posB, out vec3 iA, out vec3 iB){
  vec3 ev = normalize(posB - posA);
  float dp = dot(ev, pos - posA);
  vec3 pol = ev*dp + posA;
  float dist = length(pol - pos);
  float ac = radius*radius - dist*dist;
  float rl = (ac >= 0.0) ? sqrt(ac) : 0.0;
  iA = pol - ev*rl; iB = pol + ev*rl;
  return (dist <= radius) ? 1.0 : 0.0;
}

vec3 bg_stractium(vec2 fc){
  st_localTime = time - 1.6;
  vec2 I  = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + (bgCamPx - vec2(uOffX, uOffY) * (0.01 * resolution.y));
  vec2 uv = I/resolution.xy * 2.0 - 1.0;

  vec3 camUp = vec3(0.0, 1.0, 0.0);
  vec3 camLookat = vec3(0.0);
  float mx = -0.7 + st_localTime*0.123 + radians(uOrbit);                        // iMouse=0(自動周回)
  float my = -sin(st_localTime*0.31)*0.5 + radians(uCamPitch);
  vec3 camPos = vec3(cos(my)*cos(mx), sin(my), cos(my)*sin(mx)) * 9.2;
  vec3 camVec = normalize(camLookat - camPos);
  vec3 sideNorm = normalize(cross(camUp, camVec));
  vec3 upNorm = cross(camVec, sideNorm);
  vec3 worldFacing = camPos + camVec;
  vec3 worldPix = worldFacing + uv.x*sideNorm*(resolution.x/resolution.y) + uv.y*upNorm;
  vec3 relVec = normalize(worldPix - camPos);

  vec3 iA, iB;
  float hit = st_IntersectSphereAndRay(vec3(0.0), 7.6 * (uScale / 100.0), camPos, camPos+relVec, iA, iB);

  vec2 distAndMat = vec2(0.05, 0.0);
  float t = 0.0;
  vec3 pos = vec3(0.0);
  float maxDepth;
  camPos = iA;
  maxDepth = distance(iA, iB);
  if(hit > 0.5){
    for(int i=0; i<ST_MARCH_REPS; i++){
      if(i >= int(uSteps + 0.5)) break;
      if((t > maxDepth) || (abs(distAndMat.x) < 0.0075)) break;
      pos = camPos + relVec*t;
      distAndMat = st_DistanceToObject(pos);
      t += distAndMat.x * ST_MARCH_MULT;
    }
  } else {
    t = maxDepth + 1.0; distAndMat.x = 1.0;
  }

  vec3 sunDir = normalize(vec3(0.93, 1.0, -1.5));
  if(uSunAzim != 0.0 || uSunElev != 0.0){
    sunDir = st_RotateY(sunDir, radians(uSunAzim));
    sunDir = normalize(st_RotateZ(sunDir, radians(uSunElev)));
  }
  vec3 finalColor = vec3(0.0);
  bool hitObj = (abs(distAndMat.x) < 0.75);

  if(hitObj){
    vec3 sv = vec3(0.005, 0.0, 0.0);
    vec3 normalU = vec3(distAndMat.x - st_DistanceToObject(pos - sv.xyy).x,
                        distAndMat.x - st_DistanceToObject(pos - sv.yxy).x,
                        distAndMat.x - st_DistanceToObject(pos - sv.yyx).x);
    vec3 normal = normalize(normalU);

    // AO(タップ数を削減)
    float ambient = st_saturate(st_DistanceToObject(pos + normal*0.1).x*10.0);
    ambient *= st_saturate(st_DistanceToObject(pos + normal*0.4).x*2.5);
    ambient *= st_saturate(st_DistanceToObject(pos + normal*1.6).x*0.625);
    ambient = max(0.15, pow(ambient, 0.3));
    ambient = st_saturate(ambient);

    // 太陽シャドウ(反復削減)
    float sunShadow = 1.0, iter = 0.2;
    float ssoft = 10.0;
    if(uShadowSoft != 100.0) ssoft = 10.0 * (uShadowSoft / 100.0);
    for(int i=0; i<6; i++){
      float td = st_DistanceToObject(pos + sunDir*iter).x;
      sunShadow *= st_saturate(td*ssoft);
      if(td <= 0.0) break;
      iter *= 1.6;
    }
    sunShadow = st_saturate(sunShadow);

    vec3 ref = reflect(relVec, normal);

    vec3 rp = st_RotateY(pos, pos.y*0.4 - cos(st_localTime)*0.4);
    float n;
    if(uRockGrain == 100.0) n = st_noise(rp*4.0) + st_noise(rp*8.0) + st_noise(rp*16.0) + st_noise(rp*32.0);
    else n = st_noise(rp*(4.0*(uRockGrain / 100.0))) + st_noise(rp*(8.0*(uRockGrain / 100.0))) + st_noise(rp*(16.0*(uRockGrain / 100.0))) + st_noise(rp*(32.0*(uRockGrain / 100.0)));
    n = st_saturate(n*0.25*0.95 + 0.05);
    vec3 texColor = vec3(0.2, 0.3, 0.3)*n;
    if(uRockColor != vec3(1.0)) texColor *= uRockColor;
    if(uRedBand == 100.0) texColor += vec3(0.99, 0.21, 0.213) * clamp(length(pos)-4.0, 0.0, 0.4);
    else texColor += vec3(0.99, 0.21, 0.213) * clamp(length(pos)-4.0, 0.0, 0.4) * (uRedBand / 100.0);
    texColor += vec3(1.0, 21.0, 26.0)*0.6 * st_saturate(length(normalU)-0.01);
    texColor -= vec3(0.0, 0.3, 0.5) * st_saturate(-distAndMat.y*(0.9 + sin(st_localTime+0.5)*0.9));
    texColor = max(vec3(0.02), texColor);

    vec3 lightColor = st_sunCol * st_saturate(dot(sunDir, normal)) * sunShadow * 14.0;
    lightColor += vec3(0.1, 0.35, 0.95) * (normal.y*0.5 + 0.5) * ambient * 0.25;
    lightColor += vec3(1.0) * ((-normal.y)*0.5 + 0.5) * ambient * 0.2;
    if(uSunGain != 100.0 || uSkyLight != 100.0 || uBounce != 100.0 || uSunColor != vec3(1.0) || uSkyColor != vec3(1.0)){
      lightColor = st_sunCol * uSunColor * st_saturate(dot(sunDir, normal)) * sunShadow * 14.0 * (uSunGain / 100.0);
      lightColor += vec3(0.1, 0.35, 0.95) * uSkyColor * (normal.y*0.5 + 0.5) * ambient * 0.25 * (uSkyLight / 100.0);
      lightColor += vec3(1.0) * ((-normal.y)*0.5 + 0.5) * ambient * 0.2 * (uBounce / 100.0);
    }
    finalColor = texColor * lightColor;

    vec3 refColor = st_GetSunColorReflection(ref, sunDir)*0.68;
    if(uSunReflect != 100.0) refColor *= uSunReflect / 100.0;
    finalColor += refColor * st_sunCol * sunShadow * 9.0 * texColor.g;

    if(uRimGain != 0.0) finalColor += pow(1.0 - st_saturate(dot(normal, -relVec)), 3.0) * vec3(0.12, 0.2, 0.36) * uRimColor * (uRimGain / 100.0) * ambient;
    if(uGloss != 0.0) finalColor += st_sunCol * pow(max(dot(ref, sunDir), 0.0), 24.0) * sunShadow * (uGloss / 100.0) * 100.0;
    if(uFogAmount != 100.0 || uFogColor != vec3(1.0))
      finalColor = mix(vec3(0.98, 0.981, 0.981) * uFogColor + min(vec3(0.25), st_GetSunColorSmall(relVec, sunDir))*2.0,
                       finalColor, exp(-t*(0.007 * (uFogAmount / 100.0))));
    else
      finalColor = mix(vec3(0.98, 0.981, 0.981) + min(vec3(0.25), st_GetSunColorSmall(relVec, sunDir))*2.0,
                       finalColor, exp(-t*0.007));
  } else {
    finalColor = vec3(0.0);   // 空(背景)は黒 (entrypoint が uBgColor で塗る)
  }

  finalColor *= st_saturate(1.0 - length(uv/2.5));   // ビネット
  finalColor *= 1.95 * (uGlow / 100.0);
  vec3 col = sqrt(clamp(finalColor, 0.0, 1.0));

  if(abs(uCosGrad) > 0.0001){
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, cosGradColor(lum) * (0.2 + 1.4*lum), abs(uCosGrad));
  }
  // 空は透過 (Slot A では entrypoint が不透明化し uBgColor を敷く)
  bgAlpha = hitObj ? 1.0 : 0.0;
  return col;
}
