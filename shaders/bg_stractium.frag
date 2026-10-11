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

float st_SinRep(float a){
  float h = 0.0, mult = 1.0;
  for(int i=0; i<ST_SIN_REPS; i++){ h += cos(a*mult)/mult; mult *= 2.0; }
  return h;
}

// 歪んだ球の距離場。変形を激しめに(振幅アップ + 強めの渦)。
vec2 st_DistanceToObject(vec3 p){
  p = st_RotateY(p, p.y*0.7 - cos(st_localTime)*0.7);          // 強めの渦
  float h = 0.0;
  h += st_SinRep(st_RotateY(p, p.z*3.14*0.25).x);
  h += st_SinRep(st_RotateZ(p, p.x*3.14*0.25).y);
  h += st_SinRep(st_RotateX(p, p.y*3.14*0.25).z);
  float material = h;
  float final = length(p) - 4.0 - h*(0.5 + sin(st_localTime)*0.6);  // 変形を激しめ
  return vec2(final, material);
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
  vec2 I  = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = I/resolution.xy * 2.0 - 1.0;

  vec3 camUp = vec3(0.0, 1.0, 0.0);
  vec3 camLookat = vec3(0.0);
  float mx = -0.7 + st_localTime*0.123;                        // iMouse=0(自動周回)
  float my = -sin(st_localTime*0.31)*0.5;
  vec3 camPos = vec3(cos(my)*cos(mx), sin(my), cos(my)*sin(mx)) * 9.2;
  vec3 camVec = normalize(camLookat - camPos);
  vec3 sideNorm = normalize(cross(camUp, camVec));
  vec3 upNorm = cross(camVec, sideNorm);
  vec3 worldFacing = camPos + camVec;
  vec3 worldPix = worldFacing + uv.x*sideNorm*(resolution.x/resolution.y) + uv.y*upNorm;
  vec3 relVec = normalize(worldPix - camPos);

  vec3 iA, iB;
  float hit = st_IntersectSphereAndRay(vec3(0.0), 7.6, camPos, camPos+relVec, iA, iB);

  vec2 distAndMat = vec2(0.05, 0.0);
  float t = 0.0;
  vec3 pos = vec3(0.0);
  float maxDepth;
  camPos = iA;
  maxDepth = distance(iA, iB);
  if(hit > 0.5){
    for(int i=0; i<ST_MARCH_REPS; i++){
      if((t > maxDepth) || (abs(distAndMat.x) < 0.0075)) break;
      pos = camPos + relVec*t;
      distAndMat = st_DistanceToObject(pos);
      t += distAndMat.x * ST_MARCH_MULT;
    }
  } else {
    t = maxDepth + 1.0; distAndMat.x = 1.0;
  }

  vec3 sunDir = normalize(vec3(0.93, 1.0, -1.5));
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
    for(int i=0; i<6; i++){
      float td = st_DistanceToObject(pos + sunDir*iter).x;
      sunShadow *= st_saturate(td*10.0);
      if(td <= 0.0) break;
      iter *= 1.6;
    }
    sunShadow = st_saturate(sunShadow);

    vec3 ref = reflect(relVec, normal);

    vec3 rp = st_RotateY(pos, pos.y*0.4 - cos(st_localTime)*0.4);
    float n = st_noise(rp*4.0) + st_noise(rp*8.0) + st_noise(rp*16.0) + st_noise(rp*32.0);
    n = st_saturate(n*0.25*0.95 + 0.05);
    vec3 texColor = vec3(0.2, 0.3, 0.3)*n;
    texColor += vec3(0.99, 0.21, 0.213) * clamp(length(pos)-4.0, 0.0, 0.4);
    texColor += vec3(1.0, 21.0, 26.0)*0.6 * st_saturate(length(normalU)-0.01);
    texColor -= vec3(0.0, 0.3, 0.5) * st_saturate(-distAndMat.y*(0.9 + sin(st_localTime+0.5)*0.9));
    texColor = max(vec3(0.02), texColor);

    vec3 lightColor = st_sunCol * st_saturate(dot(sunDir, normal)) * sunShadow * 14.0;
    lightColor += vec3(0.1, 0.35, 0.95) * (normal.y*0.5 + 0.5) * ambient * 0.25;
    lightColor += vec3(1.0) * ((-normal.y)*0.5 + 0.5) * ambient * 0.2;
    finalColor = texColor * lightColor;

    vec3 refColor = st_GetSunColorReflection(ref, sunDir)*0.68;
    finalColor += refColor * st_sunCol * sunShadow * 9.0 * texColor.g;

    finalColor = mix(vec3(0.98, 0.981, 0.981) + min(vec3(0.25), st_GetSunColorSmall(relVec, sunDir))*2.0,
                     finalColor, exp(-t*0.007));
  } else {
    finalColor = vec3(0.0);   // 空(背景)は黒 (entrypoint が uBgColor で塗る)
  }

  finalColor *= st_saturate(1.0 - length(uv/2.5));   // ビネット
  finalColor *= 1.95;
  vec3 col = sqrt(clamp(finalColor, 0.0, 1.0));

  if(abs(uCosGrad) > 0.0001){
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, cosGradColor(lum) * (0.2 + 1.4*lum), abs(uCosGrad));
  }
  // 空は透過 (Slot A では entrypoint が不透明化し uBgColor を敷く)
  bgAlpha = hitObj ? 1.0 : 0.0;
  return col;
}
