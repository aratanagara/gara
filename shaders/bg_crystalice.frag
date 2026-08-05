// =====================================================
// bg_crystalice
//   Source : Shadertoy "Crystal Ice Flight" https://www.shadertoy.com/view/33VfRD
//   トンネル飛行レイマーチ(menger風サーフェス + パイプトンネル + グローオーブ)。
//   テクスチャは未使用(common の tex 関数は不要)。smax のみ移植。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパ/マクロは ci_ / CI_ で名前空間化。
// =====================================================
#define CI_P(z) vec3(cos((z)*.04)*32., cos((z)*.05)*32., (z))
#define CI_R(a) mat2(cos((a)+vec4(0,33,11,0)))
#define CI_TRI(s) p += (pi*(abs(2.*fract((s)*p/(2.*pi)+.75)-1.)-.5)).yzx/(s)/3.
#define CI_O(Z,c) ( length( p - vec3(X.x + sin(time*(c)*15.)*2., \
                                     X.y + sin(time*(c)*16.)*2., \
                                     time*1e1 + (Z) + 1e1) ) - (c) )

float ci_smax(float a, float b, float k){
  float f = max(0., 1. - abs(b-a)/k);
  return max(a, b) + k*.25*f*f;
}

float ci_tunnel(vec3 p){
  return (sin(p.z*.1)*3. + 7.) - length((p - CI_P(p.z)).xy);
}

float ci_surface(vec3 p){
  float s, d, pi = 3.14159;
  // 回転(zに沿ってねじる) + 有機的なうねり(カオス & カーブ)
  p.xy *= CI_R(sin(p.z*0.05)*0.9 + p.z*0.015);
  p.yz *= CI_R(cos(p.z*0.04)*0.7);
  p += sin(p.yzx*0.12 + p.zxy*0.08)*1.8;
  CI_TRI(.032);
  CI_TRI(.064);
  CI_TRI(.128);
  CI_TRI(.256);
  s = 24.;
  p = abs(fract(p/s)*s - s*.5);
  d = min(min(max(abs(p.x), abs(p.y)),
              max(abs(p.y), abs(p.z))),
              max(abs(p.x), abs(p.y))) - 1e1;
  return d;
}

float ci_map(vec3 p){ return ci_smax(ci_surface(p), ci_tunnel(p), 4.); }

vec3 bg_crystalice(vec2 u){
  vec2 I = (u - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec3 r = vec3(resolution, 1.0);
  vec2 uu = (I + I - r.xy) / r.y;

  float l, s, d = 0., i = 0.;
  vec3 p = CI_P(time*1e1), ro = p,
       Z = normalize(CI_P(time*1e1 + 5.) - p),
       X = normalize(vec3(Z.z, 0, -Z.x)),
       D = normalize(vec3(CI_R(sin(p.z*.03)*.4) * uu, 1) * mat3(-X, cross(X, Z), Z));

  vec4 o = vec4(0);
  for(; i++ < 110.;){
    p = ro + D*d;
    X = CI_P(p.z);
    l = max(min(CI_O(1., .1), min(CI_O(2., .2), CI_O(3., .3))), .01);
    d += s = min(l, .001 + .7*abs(ci_map(p)));
    o += 1./s
       + 1e3*vec4(1,2,3,0)/l
       + (1. + cos(.3*i + vec4(2,1,0,0)))/s;
  }
  o = tanh(o*o/2e9);
  vec3 col = o.rgb;
  float L = dot(col, vec3(0.3333));
  // 浅葱色(緑寄りの水色)へ。彩度は控えめに。
  vec3 asagi = vec3(0.45, 0.68, 0.70);
  col = mix(col, L * asagi * 1.3, 0.45);
  // 彩度を下げる
  float L2 = dot(col, vec3(0.3333));
  col = mix(col, vec3(L2), 0.35);
  // 透明感: 明部を白く抜いてガラスっぽく + 全体を軽く持ち上げ
  col = mix(col, vec3(1.0), 0.20 * smoothstep(0.25, 1.0, L2));
  col = pow(max(col, 0.0), vec3(0.82));
  return clamp(col, 0.0, 1.0);
}
