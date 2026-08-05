// =====================================================
// Source : https://www.shadertoy.com/view/MlS3Rt
// bg_ngray  (H59)  — 取り込み: "ngRay1" by Cale Bradbury (Shadertoy MlS3Rt)
//   iq の Raymarching Primitives 改変。球 + 10 個の box を smin 合体し、
//   回転/スキュー行列で刻々と変形する有機的なメタボール群をオービットカメラで撮る。
//   テクスチャ不使用 → 単一パスへそのまま移植。helpers は ng_ で名前空間化。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   cosineGradient(uCosGrad)対応 / Slot B はヒットのみ表示(背景透過)。
// =====================================================

float ng_smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0);
  return mix(b, a, h) - k*h*(1.0-h);
}
float ng_sphere(vec3 p, float s){ return length(p) - s; }
float ng_box(vec3 p, float s){ return length(max(abs(p) - vec3(s), 0.0)); }

// 球 + 10 個の box を回転/スキューしながら smin 合体(刻々と変形)
vec2 ng_map(vec3 pos){
  float res = ng_sphere(pos, 0.5);
  float t   = time;
  float amp = sin(t*0.5)*0.5 + 1.0;
  for(float i = 0.0; i < 10.0; i++){
    float a = i + t;
    vec3 off = vec3(sin(t*1.2 + i*0.3)*amp*5.0,
                    sin(t + cos(i*0.5 + t))*amp,
                    cos(t*0.45 - i*2.0)*amp*2.0);
    vec3 ppos = pos + off;
    float d = length(ppos)*0.3;
    ppos.xy *= mat2(cos(a), sin(a), -sin(a), cos(a));
    ppos.zy *= mat2(cos(-a), sin(a), -sin(a), cos(a));
    ppos *= mat3(1.0, d, d,  d, 1.0, d,  d, d, 1.0);
    ppos *= mat3(sin(d+t), d, d*d,  d, d, d,  -d, i*sin(d+i), -1.0);
    res = ng_smin(res, ng_box(ppos, 0.2), 4.0);
  }
  return vec2(res, 5.0);
}

vec2 ng_castRay(vec3 ro, vec3 rd){
  float tmax = 20.0, precis = 0.01, t = 0.0, m = 0.0;
  for(int i = 0; i < 30; i++){
    vec2 r = ng_map(ro + rd*t);
    if(r.x < precis || t > tmax) break;
    t += r.x; m = r.y;
  }
  if(t > tmax) m = -1.0;
  return vec2(t, m);
}

float ng_softshadow(vec3 ro, vec3 rd, float mint, float tmax){
  float res = 1.0, t = mint;
  for(int i = 0; i < 16; i++){
    float h = ng_map(ro + rd*t).x;
    res = min(res, 8.0*h/t);
    t += clamp(h, 0.02, 0.10);
    if(h < 0.001 || t > tmax) break;
  }
  return clamp(res, 0.0, 1.0);
}

vec3 ng_calcNormal(vec3 pos){
  vec3 e = vec3(0.001, 0.0, 0.0);
  return normalize(vec3(
    ng_map(pos + e.xyy).x - ng_map(pos - e.xyy).x,
    ng_map(pos + e.yxy).x - ng_map(pos - e.yxy).x,
    ng_map(pos + e.yyx).x - ng_map(pos - e.yyx).x));
}

vec3 ng_render(vec3 ro, vec3 rd, float c, out float hitOut){
  vec2 res = ng_castRay(ro, rd);
  float t = res.x, m = res.y;
  hitOut = step(-0.5, m);
  vec3 col = vec3(c);
  if(m > -0.5){
    vec3 pos = ro + t*rd;
    vec3 nor = ng_calcNormal(pos);
    vec3 ref = reflect(rd, nor);
    float occ = 0.5;
    vec3  lig = normalize(vec3(-0.6, 0.7, -0.5));
    float amb = clamp(0.5 + 0.5*nor.y, 0.5, 1.0);
    float dif = clamp(dot(nor, lig), 0.5, 1.0);
    float bac = clamp(dot(nor, normalize(vec3(-lig.x, 0.0, -lig.z))), 0.0, 1.0) * clamp(1.0 - pos.y, 0.0, 1.0);
    float dom = smoothstep(-0.1, 0.1, ref.y);
    float fre = pow(clamp(1.0 + dot(nor, rd), 0.5, 1.0), 2.0);
    float spe = pow(clamp(dot(ref, lig), 0.5, 1.0), 16.0);
    dom *= ng_softshadow(pos, ref, 0.02, 2.5);
    vec3 brdf = vec3(0.0);
    brdf += 1.20*dif;
    brdf += 1.20*spe*dif;
    brdf += 0.30*amb*occ;
    brdf += 0.40*dom*occ;
    brdf += 0.30*bac*occ;
    brdf += 0.40*fre*occ;
    col = brdf;
  }
  return clamp(col, 0.0, 1.0);
}

mat3 ng_setCamera(vec3 ro, vec3 ta, float cr){
  vec3 cw = normalize(ta - ro);
  vec3 cp = vec3(sin(cr), cos(cr), 0.0);
  vec3 cu = normalize(cross(cw, cp));
  vec3 cv = normalize(cross(cu, cw));
  return mat3(cu, cv, cw);
}

vec3 bg_ngray(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 q = I / resolution.xy;
  vec2 p = -1.0 + 2.0*q;
  p.x *= resolution.x / resolution.y;

  float ctime   = 15.0 + time*5.0;                 // カメラ・オービット
  float camDist = 13.0;
  vec3 ro = vec3(-0.5 + camDist*cos(0.1*ctime), 5.0, 0.5 + camDist*sin(0.1*ctime));
  vec3 ta = vec3(-0.001, 0.0, 0.0);
  mat3 ca = ng_setCamera(ro, ta, 0.0);
  vec3 rd = ca * normalize(vec3(p.xy, 2.5));

  float hit;
  vec3 col = ng_render(ro, rd, q.y*0.3 + 0.1, hit);
  col = pow(col, vec3(0.4545));                    // ガンマ
  col *= 1.0 - length(q*2.0 - 1.0)*0.3;            // ビネット

  if(abs(uCosGrad) > 0.0001){
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, cosGradColor(lum) * (0.3 + 1.2*lum), abs(uCosGrad));
  }

  bgAlpha = (uSlotIsA > 0.5) ? 1.0 : hit;          // Slot B はヒットのみ(背景透過)
  return col;
}
