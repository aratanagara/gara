// =====================================================
// bg_cpuffs  (H47)
//   Source : Shadertoy "Color Puffs" https://www.shadertoy.com/view/W3fGDH
//            蛇行するパスを飛行しながら Kaleidoscopic IFS を描くレイマーチ。
//   改変: iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//         vec3(Z.z,0,-Z) は 5 成分でドライバ依存のため -Z.x に明示。
//   マクロ/ヘルパは CP_ で名前空間化。
// =====================================================

#define CP_P(z) (vec3(tanh(cos((z) * .3) * .4) * 16., \
                      tanh(cos((z) * .4) * .3) * 16., (z)))
#define CP_rot(a) mat2(cos(a + vec4(0, 33, 11, 0)))

vec3 bg_cpuffs(vec2 fc){
  vec2 u = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;

  float T = time, a, d = 0., s = .002, l, w, ws, j;
  float f = tanh(sin(T*1.5)*1.35)*.25;
  vec2 r = resolution.xy;
  vec3 p = CP_P(T), q = p,
       Z = normalize(CP_P(T + 3.) - p),
       X = normalize(vec3(Z.z, 0, -Z.x)),
       D = vec3(CP_rot(f)*(u - r/2.)/r.y, 1)
           * mat3(-X, cross(X, Z), Z);
  vec3 o = vec3(0);
  for(int i = 0; i++ < 90 && s > .001;) {
    p = q + D*d;
    o += sin(p*.3)*.01 + .01;
    p.xy -= CP_P(p.z).xy;
    p.xy *= .5;
    p.y -= 1.75;
    p.y += (.15*(sin(p.x + T*3.5) +
                 sin(p.z + T*1.5) +
                 sin(p.z + T*2.8)));
    ws = .6;
    w = .3;
    for(j = 0.; j++ < 6.; p *= l, w *= l)
      p = clamp(p, -2.0, 2.0) * 2.0 - p,
      p = abs(sin(p)) - 1.,
      l = ws/dot(p, p) + 1.2;
    o += sin(p*.3)*.05 + .009;
    s = length(p)/w;
    for(a = .2; a < 1.;
        s -= abs(dot(sin(T + (q + D*d)*a*14.), vec3(.008)))/a,
        a += a);
    d += s;
  }
  o = pow(max((1. - o) * exp(-d/4.), 0.0), vec3(.45));
  return clamp(o, 0.0, 1.0);   // HDR(>1)を残すと半透明シェーダを重ねた時スクリーン化するので 0..1 に収める
}
