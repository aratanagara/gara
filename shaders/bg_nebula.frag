// =====================================================
// bg_nebula  (H55)
//   Source : Shadertoy "Nebula WIP"  https://www.shadertoy.com/view/lf3XRj
//   simplex noise でゆらぐ 3 枚のブロブを重ねた星雲。テクスチャ不使用。
//   改変: iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//         cosineGradient(uCosGrad)対応 / Slot B はブロブの不透明度で透過。
//         ヘルパは neb_ で名前空間化(snoise 等の衝突回避)。
// =====================================================

vec3 neb_mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 neb_mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 neb_permute(vec4 x){ return neb_mod289(((x * 34.0) + 10.0) * x); }
vec4 neb_taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float neb_snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = neb_mod289(i);
  vec4 p = neb_permute(neb_permute(neb_permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = neb_taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m *= m;
  return 105.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

vec4 neb_blend(vec4 fg, vec4 bg){ return fg * fg.a + bg * (1.0 - fg.a); }

// @param uWarp 0..300 = 100.0
// @param uDensity 25..400 = 100.0
// @param uSoft 40..200 = 100.0
// @param uSize 60..160 = 100.0
// @param uGlow 20..200 = 100.0
// @param uAngle -180..180 = 0.0
// @param uAspect 40..250 = 100.0
// @param uCoreR      50..140 = 100.0
// @param uMidR       50..125 = 100.0
// @param uOuterR     50..160 = 100.0
// @param uCoreWobble 0..300 = 100.0
// @param uMidWobble  0..300 = 100.0
// @param uOuterWobble 0..300 = 100.0
// @param uBlobOffsetX -70..70 = 0.0
// @param uBlobOffsetY -60..60 = 0.0
// @param uHaze       40..200 = 100.0
// @param uCoreAlpha  30..130 = 100.0
// @param uNebTwist   -200..200 = 0.0
// @param uCenterX    -100..100 = 0
// @param uCenterY    -100..100 = 0
// @param uMirrorX    0..100 = 0
// @param uCoreAspect 40..250 = 100
// @param uMidAspect  40..250 = 100
// @param uOuterAspect 40..250 = 100
// @param uMidTilt    -90..90 = 0
// @param uOuterTilt  -90..90 = 0
// @param uCoreSoft   30..300 = 100
// @param uMidSoft    60..250 = 100
// @param uMidAlpha   30..120 = 100
// @param uOuterAlpha 30..130 = 100
// @param uAlphaCurve -100..100 = 0
// @param uStars      0..100 = 0
// @param uGrainAmt   0..100 = 0
// @param uVignetteAmt 0..100 = 0
// @param uCoreTint   color = #ffffff
// @param uMidTint    color = #ffffff
// @param uOuterTint  color = #ffffff
uniform float uWarp;   // ブロブのゆらぎ (歪み) の強さ (%)
uniform float uDensity;   // ゆらぎの細かさ (%)
uniform float uSoft;   // ブロブの縁のぼかし幅 (%)
uniform float uSize;   // ブロブの大きさ (%)
uniform float uGlow;   // 明るさ (%)
uniform float uAngle;   // 向き (度。固定角でずらす)
uniform float uAspect;   // 星雲の横長さ (%)
uniform float uCoreR;      // 暗い芯のブロブの半径 (%)
uniform float uMidR;       // 明るい中間のブロブの半径 (%)
uniform float uOuterR;     // 外側の青いブロブの半径 (%)
uniform float uCoreWobble; // 芯のブロブの縁のうねり (%)
uniform float uMidWobble;  // 中間のブロブの縁のうねり (%)
uniform float uOuterWobble; // 外側のブロブの縁のうねり (%)
uniform float uBlobOffsetX; // 中間と外側のブロブを互いに逆へずらす量 X (%)
uniform float uBlobOffsetY; // 中間と外側のブロブを互いに逆へずらす量 Y (%)
uniform float uHaze;       // 外側のブロブの縁のぼかし (%)。上げると霞のように広がる
uniform float uCoreAlpha;  // 芯のブロブの濃さ (%)
uniform float uNebTwist;   // 中心からの距離に比例したねじれ (%)。負で逆回り
uniform float uCenterX;    // 星雲全体を左右へずらす量 (%)
uniform float uCenterY;    // 星雲全体を上下へずらす量 (%)
uniform float uMirrorX;    // 左右の鏡像の折り返し位置 (%)。0 = なし / 上げると折り返しが左端から中央へ寄り 100 で中央の完全な左右対称
uniform float uCoreAspect; // 暗い芯の横長さ (%)
uniform float uMidAspect;  // 明るい中間の横長さ (%)
uniform float uOuterAspect; // 外側の青いブロブの横長さ (%)
uniform float uMidTilt;    // 中間ブロブの楕円の傾き (度)
uniform float uOuterTilt;  // 外側ブロブの楕円の傾き (度)
uniform float uCoreSoft;   // 芯のブロブの縁のぼかし幅 (%)
uniform float uMidSoft;    // 中間のブロブの縁のぼかし幅 (%)
uniform float uMidAlpha;   // 中間のブロブの濃さ (%)
uniform float uOuterAlpha; // 外側のブロブの濃さ (%)
uniform float uAlphaCurve; // 星雲の濃淡の落ち方 (%)。正で芯だけ濃く / 負で全体に薄く広がる
uniform float uStars;      // 星屑の量 (%)
uniform float uGrainAmt;   // 粒子ノイズの量 (%)
uniform float uVignetteAmt; // 周辺を暗く落とす量 (%)
uniform vec3 uCoreTint;    // 暗い芯の色味 (掛け算のティント)
uniform vec3 uMidTint;     // 明るい中間の色味 (掛け算のティント)
uniform vec3 uOuterTint;   // 外側の青の色味 (掛け算のティント)

float neb_shape(vec2 uv, float radius, float softness, float noiseIntensity, float noiseOffset){
  float noise = neb_snoise(vec3(uv * (1.2 * (uDensity / 100.0)) + noiseOffset, noiseOffset + time * 0.3));
  uv += noise * noiseIntensity * (uWarp / 100.0);
  float dist = length(uv);
  float rK = radius * (uSize / 100.0);
  return smoothstep(rK, rK - softness * (uSoft / 100.0), dist);
}

vec3 bg_nebula(vec2 fc){
  vec2 I  = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = I / resolution.xy;
  uv -= 0.5;
  uv.x *= resolution.x / resolution.y;
  float ang = radians(uAngle);
  uv = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * uv;
  uv.x *= 0.35 / (uAspect / 100.0);                                   // 横長の星雲
  if(uCenterX != 0.0 || uCenterY != 0.0) uv -= vec2(uCenterX * 0.35, uCenterY) / 100.0 * 0.3;
  if(uMirrorX > 0.0){ float mAx = -(100.0 - uMirrorX) / 100.0 * 0.35; uv.x = abs(uv.x - mAx) + mAx; }

  if(uNebTwist != 0.0){ float ta = length(uv) * uNebTwist / 100.0 * 3.0; float ca = cos(ta), sa = sin(ta); uv = mat2(ca, -sa, sa, ca) * uv; }
  vec2 blobSh = vec2(uBlobOffsetX, uBlobOffsetY) / 100.0 * 0.3;

  const vec3 col0 = vec3(0.157, 0.235, 0.424);
  const vec3 col1 = vec3(0.588, 0.682, 0.906);
  const vec3 col2 = vec3(0.325, 0.514, 0.843);

  vec2 uvC = uv;
  vec2 uvM = uv - blobSh;
  vec2 uvO = uv + blobSh;
  uvC.x *= 100.0 / uCoreAspect;
  if(uMidTilt != 0.0){ float ma = radians(uMidTilt); uvM = mat2(cos(ma), -sin(ma), sin(ma), cos(ma)) * uvM; }
  uvM.x *= 100.0 / uMidAspect;
  if(uOuterTilt != 0.0){ float oa = radians(uOuterTilt); uvO = mat2(cos(oa), -sin(oa), sin(oa), cos(oa)) * uvO; }
  uvO.x *= 100.0 / uOuterAspect;

  vec4 bg = vec4(0.0);
  vec4 l0 = vec4(col0 * uCoreTint, neb_shape(uvC, 0.4 * (uCoreR / 100.0), 0.3 * (uCoreSoft / 100.0), 0.2 * (uCoreWobble / 100.0), 4.0) * 1.3 * (uCoreAlpha / 100.0));
  vec4 l1 = vec4(col1 * uMidTint, neb_shape(uvM, 0.6 * (uMidR / 100.0), 0.4 * (uMidSoft / 100.0), 0.1 * (uMidWobble / 100.0), 6.0) * 1.2 * (uMidAlpha / 100.0));
  vec4 l2 = vec4(col2 * uOuterTint, neb_shape(uvO, 0.4 * (uOuterR / 100.0), 0.8 * (uHaze / 100.0), 0.1 * (uOuterWobble / 100.0), 10.0) * (uOuterAlpha / 100.0));
  vec4 layers = neb_blend(l0, bg);
  layers = neb_blend(l1, layers);
  layers = neb_blend(l2, layers);
  if(uAlphaCurve != 0.0) layers.a = pow(clamp(layers.a, 0.0, 1.0), exp2(uAlphaCurve / 100.0 * 1.5));
  vec3 color = layers.rgb * layers.a * (uGlow / 100.0);

  if(abs(uCosGrad) > 0.0001){
    float lum = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(color, cosGradColor(lum) * (0.2 + 1.4*lum), abs(uCosGrad));
  }
  if(uStars > 0.0){
    float cs = 18.0;
    vec2 sg = fc / cs;
    vec2 sid = floor(sg);
    vec2 sf = fract(sg) - 0.5;
    float sh = fract(sin(dot(sid, vec2(127.1, 311.7))) * 43758.5453);
    float sh2 = fract(sin(dot(sid, vec2(269.5, 183.3))) * 43758.5453);
    vec2 spos = (vec2(sh, sh2) - 0.5) * 0.6;
    float sv = step(1.0 - uStars / 100.0 * 0.3, fract(sh * 7.31 + sh2 * 3.7)) * smoothstep(0.2, 0.0, length(sf - spos)) * (0.5 + sh);
    color += vec3(0.85, 0.92, 1.0) * sv;
    layers.a = max(layers.a, sv);
  }
  if(uVignetteAmt > 0.0){
    vec2 vq = fc / resolution.xy - 0.5;
    color *= 1.0 - uVignetteAmt / 100.0 * clamp(dot(vq, vq) * 3.0, 0.0, 1.0);
  }
  if(uGrainAmt > 0.0){
    float gn = fract(sin(dot(fc + fract(time) * 37.0, vec2(12.9898, 78.233))) * 43758.5453);
    color += (gn - 0.5) * uGrainAmt / 100.0 * 0.15 * (0.3 + layers.a);
  }
  bgAlpha = clamp(layers.a, 0.0, 1.0);  // Slot B はブロブ部分のみ
  return color;
}
