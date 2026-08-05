// =====================================================
// bg_slimeframe  (H42)
//   Source : Shadertoy "Slime Frame" https://www.shadertoy.com/view/M3dyz7
//            (c) leon denise 2024。カレイドスコープ円 + フレームの 2D SDF。
//   改変: 緑の照明を撤去し、表面をクローム(銀の環境反射 + ハイライト + フレネル)に。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは sf_ で名前空間化。
// =====================================================

mat2 sf_rot(float a){ float c = cos(a), s = sin(a); return mat2(c,-s,s,c); }
float sf_smin(float d1, float d2, float k){
  float h = clamp(0.5 + 0.5*(d2-d1)/k, 0.0, 1.0);
  return mix(d2, d1, h) - k*h*(1.0-h);
}
float sf_map(vec2 p){
  vec2 q = p;
  float d = 100.0, a = 1.0;
  float t = 196.0 + time/20.0;
  // break symmetry
  p += vec2(resolution.x/resolution.y, 1.0);
  p *= 0.6;
  // kaleidoscopic circles
  for(float i = 0.0; i < 5.0; ++i){
    p = abs(p) - a;
    float b = length(p);
    p *= sf_rot(t/a + sin(b*5.0/a)*0.05/a);
    p *= 1.0 + 0.2*sin(b*4.0/a + time*a + i*3.0)*a;
    d = sf_smin(d, abs(b - 1.0*a), 0.07);
    a /= 1.4;
  }
  d -= 0.004;                                             // thickness
  // frame
  q = abs(q) - vec2(resolution.x/resolution.y, 1.0);
  float box = abs(max(q.x, q.y));
  d = sf_smin(d, box - 0.02, 0.2);
  return d;
}

vec3 bg_slimeframe(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 p = (2.0*I - resolution.xy) / resolution.y;

  float d = sf_map(p);
  vec2 e = vec2(0.002 + 0.02*length(p), 0.0);
  vec3 n = -normalize(vec3(d) - vec3(sf_map(p+e.xy), sf_map(p+e.yx), 0.0));

  // クローム: 法線から銀の環境反射 + 鋭いハイライト + フレネル(緑照明を置換)
  float ang = atan(n.y, n.x);
  vec3 env = vec3(0.5 + 0.42*sin(ang*2.0 + 1.0));          // 方位方向の映り込み帯
  env = mix(env, vec3(0.96), pow(n.y*0.5 + 0.5, 2.0));     // 上方を明るく(銀の空)
  float spec = pow(max(dot(n, normalize(vec3(0.0, 2.0, 0.5))), 0.0), 30.0);
  float fres = pow(1.0 - abs(n.z), 3.0);
  float cov = smoothstep(0.001, 0.0, d);                   // 線(SDF表面)=1 / 背景=0
  vec3 color = (env + spec + fres*0.35) * cov;
  bgAlpha = cov;                                           // 背景は透明
  return color;
}
