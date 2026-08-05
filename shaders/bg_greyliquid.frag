// =====================================================
// bg_greyliquid  (H41)
//   Source : Shadertoy "grey liquid" https://www.shadertoy.com/view/fsdyzf
//            (CC0: Liquid Metal by mrange)。warped FBM + フェイク照明の液体金属。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは lq_ で名前空間化(fbm1/2/3 はオクターブ引数で1関数に共通化)。
// =====================================================

#define LQ_PI  3.141592654
#define LQ_TAU (2.0*LQ_PI)

void lq_rot(inout vec2 p, float a){
  float c = cos(a), s = sin(a);
  p = vec2(c*p.x + s*p.y, -s*p.x + c*p.y);
}
float lq_hash(vec2 co){ return fract(sin(dot(co.xy, vec2(12.9898,58.233))) * 13758.5453); }
float lq_psin(float a){ return 0.5 + 0.5*sin(a); }
float lq_tanh(float x){ float x2 = x*x; return clamp(x*(27.0 + x2)/(27.0 + 9.0*x2), -1.0, 1.0); }
float lq_onoise(vec2 x){
  x *= 0.5;
  float a = sin(x.x), b = sin(x.y);
  return mix(a, b, lq_psin(LQ_TAU*lq_tanh(a*b + a + b)));
}
float lq_vnoise(vec2 x){
  vec2 i = floor(x), w = fract(x);
  vec2 u = w*w*w*(w*(w*6.0 - 15.0) + 10.0);
  float a = lq_hash(i+vec2(0,0)), b = lq_hash(i+vec2(1,0));
  float c = lq_hash(i+vec2(0,1)), d = lq_hash(i+vec2(1,1));
  float k0 = a, k1 = b - a, k2 = c - a, k3 = d - c + a - b;
  return k0 + k1*u.x + k2*u.y + k3*u.x*u.y;
}
float lq_fbm(vec2 p, int oct){
  vec2 op = p;
  const float aa = 0.45, pp = 2.03, rr = 1.2;
  const vec2 oo = -vec2(1.23, 1.5);
  float h = 0.0, d = 0.0, a = 1.0;
  for(int i=0; i<7; i++){
    if(i >= oct) break;
    h += a*lq_onoise(p);
    d += a; a *= aa; p += oo; p *= pp; lq_rot(p, rr);
  }
  return mix((h/d), -0.5*(h/d), pow(lq_vnoise(0.9*op), 0.25));
}
float lq_warp(vec2 p){
  vec2 v = vec2(lq_fbm(p, 5), lq_fbm(p + 0.7*vec2(1.0,1.0), 5));
  lq_rot(v, 1.0 + time*1.8);
  vec2 vv = vec2(lq_fbm(p + 3.7*v, 7), lq_fbm(p - 2.7*v.yx + 0.7*vec2(1.0,1.0), 7));
  lq_rot(vv, -1.0 + time*0.8);
  return lq_fbm(p + 9.0*vv, 3);
}
float lq_height(vec2 p){
  float a = 0.045*time;
  p += 9.0*vec2(cos(a), sin(a));
  p *= 2.0; p += 13.0;
  return 0.35*lq_tanh(3.0*lq_warp(p))/3.0;
}
vec3 lq_normal(vec2 p){
  vec2 eps = -vec2(2.0/resolution.y, 0.0);
  vec3 n;
  n.x = lq_height(p + eps.xy) - lq_height(p - eps.xy);
  n.y = 2.0*eps.x;
  n.z = lq_height(p + eps.yx) - lq_height(p - eps.yx);
  return normalize(n);
}

vec3 bg_greyliquid(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 q = I / resolution.xy;
  vec2 p = -1.0 + 2.0*q;
  p.x *= resolution.x / resolution.y;

  const vec3 lp1 = vec3(2.1, -0.5, -0.1);
  const vec3 lp2 = vec3(-2.1, -0.5, -0.1);
  float h = lq_height(p);
  vec3 pp = vec3(p.x, h, p.y);
  float ll1 = length(lp1.xz - pp.xz);
  vec3 ld1 = normalize(lp1 - pp);
  vec3 ld2 = normalize(lp2 - pp);
  vec3 n = lq_normal(p);
  float diff1 = max(dot(ld1, n), 0.0);
  float diff2 = max(dot(ld2, n), 0.0);
  vec3 baseCol1 = vec3(0.5, 0.4, 0.4);
  vec3 baseCol2 = vec3(0.1, 0.1, 0.1);
  float oh = lq_height(p + ll1*0.05*normalize(ld1.xz));
  const float level0 = 0.0, level1 = 0.125;
  vec3 scol1 = baseCol1*(smoothstep(level0, level1, h) - smoothstep(level0, level1, oh));
  vec3 scol2 = baseCol2*(smoothstep(level0, level1, h) - smoothstep(level0, level1, oh));
  vec3 col = vec3(0.0);
  col += 1.1*baseCol1.zyx*diff1;     // 元は 0.55 を2回加算(同値をまとめ)
  col += 1.1*baseCol2.zyx*diff2;
  col += scol1*0.5;
  col += scol2*0.5;
  return col;
}
