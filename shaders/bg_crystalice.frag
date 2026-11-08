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
#define CI_TRI(s) p += (pi*(abs(2.*fract((s)*p/(2.*pi)+.75)-1.)-.5)).yzx/(s)/3.*(uFacet/100.)
#define CI_O(Z,c) ( length( p - vec3(X.x + sin(time*(c)*15.)*2.*(uOrbSwing/100.), \
                                     X.y + sin(time*(c)*16.)*2.*(uOrbSwing/100.), \
                                     time*1e1 + (Z) + 1e1) ) - (c) )

float ci_smax(float a, float b, float k){
  float f = max(0., 1. - abs(b-a)/k);
  return max(a, b) + k*.25*f*f;
}

// @param uCell     50..200 = 100.0
// @param uTunnel   50..130 = 100.0
// @param uTint     0..200  = 100.0
// @param uDesat    0..250  = 100.0
// @param uContrast 50..200 = 100.0
// @param uAngle -180..180 = 0.0
// @param uSteps 40..110 = 110.0
uniform float uCell;      // 結晶格子の大きさ (%)
uniform float uTunnel;    // トンネルの太さ (%)
uniform float uTint;      // 浅葱色への寄せ具合 (%)
uniform float uDesat;     // 彩度を落とす量 (%)
uniform float uContrast;  // ガンマ (%。上げると暗部が沈む)
uniform float uAngle; // カメラのロール (度。固定角でずらす)
uniform float uSteps; // レイマーチのステップ数 (下げると軽く、奥の結晶が粗くなる)
// @param uTwist 0..250 = 100.0
// @param uWobble 0..300 = 100.0
// @param uBar 60..118 = 100.0
// @param uFacet 0..250 = 100.0
// @param uCellSkew -100..100 = 0.0
// @param uCellStretch -50..100 = 0.0
// @param uStrutZ 0..100 = 0.0
// @param uOrbSwing 0..300 = 100.0
// @param uOrbGlow 0..220 = 100.0
uniform float uTwist;        // 結晶格子が軸に沿ってねじれる量 (%)
uniform float uWobble;       // 結晶面のうねりの大きさ (%)。0 で整った格子
uniform float uBar;          // 結晶の梁の太さ (%)。下げると梁が太く詰まる
uniform float uFacet;        // 細かい折れ面 (多段の三角折り) の強さ (%)。0 で滑らか
uniform float uCellSkew;     // 格子セルの斜め歪み (%)。0 = 直方体 / 正負で逆向きに傾く
uniform float uCellStretch;  // セルの奥行き方向の伸び (%)。正で長く負で詰まる
uniform float uStrutZ;       // 奥行き方向の第三の梁を足す量 (%)。0 = なし
uniform float uOrbSwing;     // 光る球の軌道の振れ幅 (%)
uniform float uOrbGlow;      // 光る球のハロの強さ (%)

float ci_tunnel(vec3 p){
  return (sin(p.z*.1)*3. + 7.*(uTunnel/100.)) - length((p - CI_P(p.z)).xy);
}

float ci_surface(vec3 p){
  float s, d, pi = 3.14159;
  // 回転(zに沿ってねじる) + 有機的なうねり(カオス & カーブ)
  p.xy *= CI_R(sin(p.z*0.05)*0.9*(uTwist/100.0) + p.z*0.015);
  p.yz *= CI_R(cos(p.z*0.04)*0.7);
  p += sin(p.yzx*0.12 + p.zxy*0.08)*1.8*(uWobble/100.0);
  CI_TRI(.032);
  CI_TRI(.064);
  CI_TRI(.128);
  CI_TRI(.256);
  s = 24.*(uCell/100.);
  if(uCellSkew != 0.0){ p.x += p.y * uCellSkew / 100.0; }
  if(uCellStretch != 0.0){ p.z *= 1.0 / (1.0 + uCellStretch / 100.0); }
  p = abs(fract(p/s)*s - s*.5);
  d = min(min(max(abs(p.x), abs(p.y)),
              max(abs(p.y), abs(p.z))),
              max(abs(p.x), abs(p.y))) - 1e1*(uCell/100.)*(uBar/100.0);
  if(uStrutZ != 0.0){ d = min(d, max(abs(p.z), abs(p.x)) - 1e1*(uCell/100.)*(uBar/100.0)*(1.0 - uStrutZ/100.0)); }
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
       D = normalize(vec3(CI_R(sin(p.z*.03)*.4 + radians(uAngle)) * uu, 1) * mat3(-X, cross(X, Z), Z));

  vec4 o = vec4(0);
  for(; i++ < floor(uSteps + 0.5);){
    p = ro + D*d;
    X = CI_P(p.z);
    l = max(min(CI_O(1., .1), min(CI_O(2., .2), CI_O(3., .3))), .01);
    d += s = min(l, .001 + .7*abs(ci_map(p)));
    o += 1./s
       + 1e3*(uOrbGlow/100.0)*vec4(1,2,3,0)/l
       + (1. + cos(.3*i + vec4(2,1,0,0)))/s;
  }
  o = tanh(o*o/2e9);
  vec3 col = o.rgb;
  float L = dot(col, vec3(0.3333));
  // 浅葱色(緑寄りの水色)へ。彩度は控えめに。
  vec3 asagi = vec3(0.45, 0.68, 0.70);
  col = mix(col, L * asagi * 1.3, 0.45 * (uTint / 100.0));
  // 彩度を下げる
  float L2 = dot(col, vec3(0.3333));
  col = mix(col, vec3(L2), 0.35 * (uDesat / 100.0));
  // 透明感: 明部を白く抜いてガラスっぽく + 全体を軽く持ち上げ
  col = mix(col, vec3(1.0), 0.20 * smoothstep(0.25, 1.0, L2));
  col = pow(max(col, 0.0), vec3(0.82 * (uContrast / 100.0)));
  return clamp(col, 0.0, 1.0);
}
