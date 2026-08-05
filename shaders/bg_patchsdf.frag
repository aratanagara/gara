// =====================================================
// bg_patchsdf  (H43)
//   Source : Shadertoy "Fast Bilinear Patch SDF (Fork)" https://www.shadertoy.com/view/W3GXR3
//            (Forked from Inigo Quilez)。変形する立方体(bilinear patch 6面)のレイマーチ。
//   改変: 背景を真っ黒に(床・影・グリッドテクスチャを撤去)、表面をクローム(銀の環境反射)に。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは bp_ で名前空間化(求解は METHOD 2=最小二乗のみ採用)。
// =====================================================

vec3 bp_barycentric(vec3 p0, vec3 p1, vec3 p2, vec3 p3, vec2 uv){
  float u1 = 1.0 - uv.x, v1 = 1.0 - uv.y;
  return p0*u1*v1 + p1*uv.x*v1 + p2*uv.x*uv.y + p3*uv.y*u1;
}

vec3 bp_sdBilinearPatch(vec3 p, vec3 p0, vec3 p1, vec3 p2, vec3 p3){
  vec3 A = p1-p0, B = p3-p0, C = p2-p3-p1+p0;
  vec2 uv = vec2(0.5);
  for(int i=0; i<3; i++){
    vec3 dPdu = A + uv.y*C;
    vec3 dPdv = B + uv.x*C;
    float m = -dot(dPdu, dPdv);
    mat2 metric = mat2(dot(dPdv,dPdv), m, m, dot(dPdu,dPdu));
    float det = determinant(metric);
    if(abs(det) < 1e-6) break;
    vec3 dEdp = bp_barycentric(p0,p1,p2,p3,uv) - p;
    vec2 dEduv = vec2(dot(dPdu,dEdp), dot(dPdv,dEdp));
    if(dot(dEduv,dEduv) < 1e-6) break;
    uv = clamp(uv - dEduv*metric/det, 0.0, 1.0);
  }
  return vec3(length(bp_barycentric(p0,p1,p2,p3,uv) - p), uv);
}

vec3 bp_verts[8];
const float BP_ROUND = 0.03;

vec3 bp_map(vec3 p){
  vec3 res = vec3(length(p - bp_verts[0]), 0.0, 0.0);
  vec3 tmp;
  tmp = bp_sdBilinearPatch(p, bp_verts[0], bp_verts[2], bp_verts[3], bp_verts[1]); if(tmp.x<res.x) res=tmp;
  tmp = bp_sdBilinearPatch(p, bp_verts[7], bp_verts[6], bp_verts[4], bp_verts[5]); if(tmp.x<res.x) res=tmp;
  tmp = bp_sdBilinearPatch(p, bp_verts[0], bp_verts[1], bp_verts[5], bp_verts[4]); if(tmp.x<res.x) res=tmp;
  tmp = bp_sdBilinearPatch(p, bp_verts[2], bp_verts[6], bp_verts[7], bp_verts[3]); if(tmp.x<res.x) res=tmp;
  tmp = bp_sdBilinearPatch(p, bp_verts[0], bp_verts[4], bp_verts[6], bp_verts[2]); if(tmp.x<res.x) res=tmp;
  tmp = bp_sdBilinearPatch(p, bp_verts[1], bp_verts[3], bp_verts[7], bp_verts[5]); if(tmp.x<res.x) res=tmp;
  res.x -= BP_ROUND;
  return res;
}

vec2 bp_iSphere(vec3 ro, vec3 rd, vec4 sph){
  vec3 oc = ro - sph.xyz;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - sph.w*sph.w;
  float h = b*b - c;
  if(h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2(-b-h, -b+h);
}

int bp_raycast(vec3 ro, vec3 rd, out vec3 oUVT){
  float tmin = 2.0, tmax = 5.0;
  vec2 uv = vec2(0.0);
  vec2 bs = bp_iSphere(ro, rd, vec4(0.0, 0.0, 0.0, sqrt(3.0)+BP_ROUND));
  if(bs.y > 0.0){
    tmin = max(tmin, bs.x);
    tmax = min(tmax, bs.y);
    float t = tmin;
    for(int i=0; i<256; i++){
      vec3 pos = ro + t*rd;
      vec3 duv = bp_map(pos);
      uv = duv.yz;
      if(duv.x < 0.001) break;
      t += duv.x;
      if(t > tmax) break;
    }
    if(t < tmax){ oUVT = vec3(uv, t); return 2; }
  }
  return 0;
}

vec3 bp_calcNormal(vec3 pos){
  vec3 n = vec3(0.0);
  for(int i=0; i<4; i++){
    vec3 e = 0.5773*(2.0*vec3((((i+3)>>1)&1), ((i>>1)&1), (i&1)) - 1.0);
    n += e*bp_map(pos + 0.001*e).x;
  }
  return normalize(n);
}

vec2 bp_rot(vec2 p, float an){
  return mat2(cos(an), sin(an), -sin(an), cos(an)) * p;
}

// クロームが映す疑似環境(銀)
vec3 bp_env(vec3 d){
  float up = d.y*0.5 + 0.5;
  vec3 c = mix(vec3(0.06, 0.07, 0.09), vec3(0.93, 0.95, 1.0), smoothstep(0.0, 0.9, up));
  c += vec3(0.6) * pow(max(d.y, 0.0), 5.0);             // 天頂のソフトライト
  float az = atan(d.x, d.z);
  c += vec3(0.3) * pow(max(cos(az*2.0), 0.0), 8.0);     // 横の反射帯
  return c;
}

vec3 bg_patchsdf(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = (2.0*I - resolution.xy) / resolution.y;

  vec3 ro = vec3(0.0, 0.0, 4.0);
  vec3 rd = normalize(vec3(uv, -2.0));

  // 頂点変形(立方体を時間で歪ませる)
  float amp = 1.5 * smoothstep(0.0, 0.2, 0.5 - 0.5*cos(6.2831*time/15.0));
  for(int i=0; i<8; i++){
    vec3 p = vec3((ivec3(i) >> ivec3(0,1,2)) & 1) * 2.0 - 1.0;
    p.xz = bp_rot(p.xz,  amp*cos(time*3.0*6.2831/15.0 + p.y + 0.0)/2.0);
    p.yz = bp_rot(p.yz, -amp*cos(time*1.0*6.2831/15.0 + p.x + 2.0)/1.0);
    p.xz = bp_rot(p.xz,  4.0 + time*1.0*6.2831/15.0);
    bp_verts[i] = p;
  }

  vec3 col = vec3(0.0);
  bgAlpha = 0.0;                                         // 背景は透明
  vec3 uvt;
  int obj = bp_raycast(ro, rd, uvt);
  if(obj > 0){
    bgAlpha = 1.0;                                       // 被写体は不透明
    float t = uvt.z;
    vec3 pos = ro + t*rd;
    vec3 nor = bp_calcNormal(pos);
    // クローム: 環境反射 + フレネル + 鋭いハイライト(テクスチャを置換)
    vec3 rr = reflect(rd, nor);
    vec3 env = bp_env(rr);
    float fres = pow(1.0 - max(dot(nor, -rd), 0.0), 4.0);
    vec3 lig = normalize(vec3(6.0, 5.0, -1.0));
    float spe = pow(max(dot(nor, normalize(lig - rd)), 0.0), 60.0);
    col = mix(env*0.55, env, fres) + spe*vec3(1.0)*1.6;
    col *= exp2(-t*0.1);
  }

  col = col*2.0/(1.0 + col);                // gain
  col = pow(max(col, 0.0), vec3(0.4545));   // gamma
  return col;
}
