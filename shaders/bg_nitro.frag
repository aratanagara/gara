// =====================================================
// bg_nitro  (H56)
//   Source : Shadertoy "Nitrostasis b"  https://www.shadertoy.com/view/MtdBRs
//   Author : Otavio Good (CC0)
//   手続き値ノイズの雲ボリュームをレイマーチ + 距離フォグ。テクスチャ不使用。
//   改変: iTime,iResolution → time,resolution / iMouse 固定 / bgZoom・bgCamPx 対応。
//         重いのでステップ 150→80・オクターブを削減。cosineGradient(uCosGrad)対応。
//         ヘルパは nit_ で名前空間化(hash1/smin/mx 等の衝突回避)。
//         距離場の表面近接度から実アルファを生成し、フォグ背景は透過。
// =====================================================

const float NIT_PI = 3.14159265359;
float nit_sat(float a){ return clamp(a, 0.0, 1.0); }

float nit_smin(float a, float b, float k){ float h = nit_sat(0.5 + 0.5*(b-a)/k); return mix(b,a,h) - k*h*(1.0-h); }
float nit_smax(float a, float b, float k){ return -nit_smin(-a, -b, k); }

// sin を使わない安価なハッシュ(軽量化)。
float nit_hash1(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float nit_hash1(vec3 p){ p = fract(p*0.1031); p += dot(p, p.yzx+33.33); return fract((p.x+p.y)*p.z); }
vec3  nit_hash3(vec2 u){ return vec3(nit_hash1(u)*0.91, nit_hash1(u+37.0), nit_hash1(u+47.0))*0.01; }

void nit_diff3(vec3 u, vec2 e, inout vec4 a, inout vec4 b){
  a = vec4(nit_hash1(u+e.xxx), nit_hash1(u+e.yxx), nit_hash1(u+e.xyx), nit_hash1(u+e.yyx));
  b = vec4(nit_hash1(u+e.xxy), nit_hash1(u+e.yxy), nit_hash1(u+e.xyy), nit_hash1(u+e.yyy));
}
float nit_mx (float a, vec2 b){ return mix(b.x, b.y, a); }
float nit_mx2(vec2 u, vec4 a){ return mix(nit_mx(u.x, a.xy), nit_mx(u.x, a.zw), u.y); }
float nit_mx3(vec3 u, vec4 a, vec4 b){ return mix(nit_mx2(u.xy, a), nit_mx2(u.xy, b), u.z); }
vec3  nit_h3core(vec3 u){ return u*u*(3.0 - 2.0*u); }

float nit_noise1v(vec3 u){
  vec4 a = vec4(0.0), b = vec4(0.0);
  nit_diff3(floor(u), vec2(0.0, 1.0), a, b);
  return nit_mx3(nit_h3core(fract(u)), a, b);
}

vec2 nit_minx(vec2 a, vec2 b){ return mix(b, a, step(a.x, b.x)); }

// 距離場: 多オクターブ雲ノイズ - 厚み。距離の太陽(マテリアル 6)。
vec2 nit_dist(vec3 p, vec3 camLookat){
  p.y += nit_noise1v(p*0.5)*0.5;
  float n = nit_noise1v(p*2.0 + time*0.6)
          + nit_noise1v(p*4.0 + time*0.7)*0.5
          + nit_noise1v(p*8.0)*0.25
          + nit_noise1v(p*16.0)*0.125;
  float dist = n*0.25 - 0.27;
  dist = nit_smax(dist, -(abs(fract(p.y*4.0) - 0.5) - 0.15), 0.4);
  vec2 distMat = vec2(dist, 0.0);
  distMat = nit_minx(distMat, vec2(length(p - camLookat - vec3(0.0, 0.5, -1.0)) - 0.6, 6.0));
  return distMat;
}

vec3 bg_nitro(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 u = I / resolution.xy * 2.0 - 1.0;
  float zoom = 1.7;
  u /= zoom;

  vec3 camUp = vec3(0.0, 1.0, 0.0);
  vec3 camLookat = vec3(0.0);
  float mxa = 0.375*NIT_PI*2.0 - 0.7;          // iMouse=0 相当の固定方位
  float mya = 0.0;
  vec3 camPos = vec3(0.0);
  camPos += vec3(cos(mya)*cos(mxa), sin(mya), cos(mya)*sin(mxa)) * 3.2;
  camPos.z   -= time*0.5;                       // 雲の中を前進
  camLookat.z -= time*0.5;
  camPos += nit_hash3(u);                       // カメラジッタ(粗い根探しを隠す)

  vec3 camVec = normalize(camLookat - camPos);
  vec3 sideNorm = normalize(cross(camUp, camVec));
  vec3 upNorm = cross(camVec, sideNorm);
  vec3 worldFacing = camPos + camVec;
  vec3 worldPix = worldFacing + u.x*sideNorm*(resolution.x/resolution.y) + u.y*upNorm;
  vec3 rayVec = normalize(worldPix - camPos);

  vec2 distAndMat = vec2(0.5, 0.0);
  const float nearClip = 0.02;
  float t = nearClip;
  float maxDepth = 8.0;
  vec3 pos = vec3(0.0);
  float marchCount = 0.0;
  float minSurfaceDist = 1e6;
  for(int i = 0; i < 52; i++){
    pos = camPos + rayVec*t;
    distAndMat = nit_dist(pos, camLookat);
    minSurfaceDist = min(minSurfaceDist, abs(distAndMat.x));
    if((t > maxDepth) || (abs(distAndMat.x) < 0.0025)) break;
    t += distAndMat.x * 0.85;
    marchCount += 1.0/distAndMat.x;
  }

  vec3 c = vec3(0.0);
  if(abs(distAndMat.x) < 0.0025){
    vec3 e = vec3(0.0);
    if(distAndMat.y == 6.0) e = vec3(0.5, 0.2, 0.1)*10.0;   // 太陽
    c = e;
  }
  c += marchCount*(1.5 - vec3(4.2, 1.0, 0.41))*0.0001;       // 半直接光の赤み
  c = mix(1.5 - vec3(0.91, 0.81, 0.99)*1.75, c, exp(-t*0.15)); // 距離フォグ
  if(t <= nearClip) c = (1.5 - vec3(1.9, 1.1, 0.9))*0.25;
  c *= pow(nit_sat(1.0 - length(u/2.5)), 2.0);               // 周辺減光
  c *= 1.2;
  c *= 0.85;
  c = clamp(c, 0.0, 1.0);
  c = sqrt(c);

  if(abs(uCosGrad) > 0.0001){
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, cosGradColor(lum) * (0.2 + 1.4*lum), abs(uCosGrad));
  }
  // 色のクロマキーではなく、レイが距離場表面へ近づいた量を直接alphaにする。
  // 実ヒットは完全不透明、輪郭近傍だけを柔らかくし、距離フォグ単体は透明に落とす。
  float surfaceAlpha = 1.0 - smoothstep(0.012, 0.115, minSurfaceDist);
  float actualHit = step(abs(distAndMat.x), 0.0025) * step(t, maxDepth);
  bgAlpha = max(surfaceAlpha, actualHit);
  return c;
}
