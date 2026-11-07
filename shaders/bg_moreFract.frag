// Shadertoy 7XSGW3 "More Fract" (Martijn Steinrucken / The Art of Code, MIT)
// Source : https://www.shadertoy.com/view/7XSGW3
// raymarched IFS。元の iChannel0 キューブマップ反射は手続き的な環境色で代替。
#define MF_MAX_STEPS 96
#define MF_MAX_DIST 10.0
#define MF_SURF_DIST 0.002

mat2 mfRot(float a){ float s=sin(a), c=cos(a); return mat2(c,-s,s,c); }

float mfHash(vec3 p){
  p = fract(p*0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
}
float mfNoise(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f*f*(3.0-2.0*f);
  return mix(mix(mix(mfHash(i+vec3(0,0,0)), mfHash(i+vec3(1,0,0)), f.x),
                 mix(mfHash(i+vec3(0,1,0)), mfHash(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(mfHash(i+vec3(0,0,1)), mfHash(i+vec3(1,0,1)), f.x),
                 mix(mfHash(i+vec3(0,1,1)), mfHash(i+vec3(1,1,1)), f.x), f.y), f.z);
}

vec3 mfPal(float t, vec3 a, vec3 b, vec3 c, vec3 d){ return a + b*cos(6.28318*(c*t+d)); }

// 反射方向から環境色を生成 (キューブマップの代わり)
vec3 mfEnv(vec3 d){
  float y = d.y*0.5+0.5;
  vec3 sky = mix(vec3(0.04,0.05,0.09), vec3(0.85,0.92,1.0), y);
  sky += 0.35*mfPal(d.x*0.5+d.z*0.5, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0,0.33,0.66));
  return sky;
}

// @param uDetail   3..8 = 8.0
// @param uWarp     0..300 = 100.0
// @param uDensity  25..300 = 100.0
// @param uThick    20..200 = 100.0
// @param uContrast 50..200 = 100.0
// @param uScale 50..150 = 100.0
// @param uAngle -180..180 = 0.0
// @param uSteps 55..96 = 96.0
uniform float uDetail; // IFS の反復回数 (下げると軽く、形が粗くなる)
uniform float uWarp; // 縮小率のゆらぎ (%)
uniform float uDensity; // ゆらぎの細かさ (%)
uniform float uThick; // 線の太さ (%)
uniform float uContrast; // コントラスト (%。大きいほど暗く締まる)
uniform float uScale; // 物体全体の大きさ (%)
uniform float uAngle; // 向き (度。固定角でずらす)
uniform float uSteps; // レイマーチのステップ数 (下げると軽く、遠景や細部が欠ける)

float mfGetDist(vec3 p, float tm){
  float sc = uScale / 100.0;
  p /= sc;
  p.xz = mfRot(radians(uAngle)) * p.xz;
  vec2 uv = p.xz;
  uv.x = abs(uv.x);
  float th = 0.4*p.y - 0.6*tm;
  float n = floor(uDetail + 0.5);
  float m = 1.8;
  vec2 q = vec2(1.0,0.0);
  for(float i=0.0;i<8.0;i++){
    if(i >= n) break;
    uv -= m*q;
    th += 0.5*p.y + 0.05*tm;
    uv = mfRot(th)*uv;
    uv.x = abs(uv.x);
    m *= 0.05*(uWarp / 100.0)*cos(8.0*(uDensity / 100.0)*length(uv)) + 0.55;
  }
  float nz = mfNoise(p*0.6);
  nz = nz*nz;          // 細線は残しつつ、幅のある線を増やす (nz³→nz²)
  float w = 0.12*(uThick / 100.0)*exp(4.0*nz);
  float d = length(uv) - 2.0*m*w;
  return 0.5*d*sc;
}

float mfRayMarch(vec3 ro, vec3 rd, float tm){
  float dO = 0.0;
  for(int i=0;i<MF_MAX_STEPS;i++){
    if(i >= int(uSteps + 0.5)) break;
    vec3 p = ro + rd*dO;
    float dS = mfGetDist(p, tm);
    dO += dS;
    if(dO>MF_MAX_DIST || abs(dS)<MF_SURF_DIST) break;
  }
  return dO;
}

vec3 mfNormal(vec3 p, float tm){
  float d = mfGetDist(p, tm);
  vec2 e = vec2(0.001, 0.0);
  vec3 n = d - vec3(
    mfGetDist(p-e.xyy, tm),
    mfGetDist(p-e.yxy, tm),
    mfGetDist(p-e.yyx, tm));
  return normalize(n);
}

vec3 mfRayDir(vec2 uv, vec3 p, vec3 l, float z){
  vec3 f = normalize(l-p),
       r = normalize(cross(vec3(0,1,0), f)),
       u = cross(f, r),
       c = f*z,
       i = c + uv.x*r + uv.y*u;
  return normalize(i);
}

vec3 bg_moreFract(vec2 fc){
  float T = randomMoveTime(getBeat(), 0.2, 522.0);
  float tm = 12.0 + T;
  vec2 uv = (fc - 0.5*resolution.xy)/resolution.y;
  uv /= bgZoom;
  uv += bgCamPx/resolution.y;

  vec3 ro = vec3(5.5, 0.1*T, 0.0);
  vec3 rd = mfRayDir(uv, ro, vec3(0.0, 0.1*T, 0.0), 2.0);
  vec3 col = vec3(0.0);

  float d = mfRayMarch(ro, rd, tm);
  if(d < MF_MAX_DIST){
    vec3 p = ro + rd*d;
    vec3 nrm = mfNormal(p, tm);
    vec3 rfl = reflect(rd, nrm);

    float ambient = 0.3;
    float difPower = 0.4;
    float dif = max(dot(nrm, normalize(vec3(1,2,3))), 0.0);
    col = vec3(dif*difPower + ambient);
    col *= mfEnv(rfl);
    col *= 1.0 + rfl.y;
    col = clamp(col, 0.0, 1.0);
    vec3 e = vec3(1.0);
    col *= mfPal(rfl.y, e, e, e, 0.35*vec3(0.0,0.33,0.66));
  }
  col = pow(col, vec3(0.4545 * (uContrast / 100.0)));
  return col;
}
