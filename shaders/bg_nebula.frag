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

float neb_shape(vec2 uv, float radius, float softness, float noiseIntensity, float noiseOffset){
  float noise = neb_snoise(vec3(uv * 1.2 + noiseOffset, noiseOffset + time * 0.3));
  uv += noise * noiseIntensity;
  float dist = length(uv);
  return smoothstep(radius, radius - softness, dist);
}

vec3 bg_nebula(vec2 fc){
  vec2 I  = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = I / resolution.xy;
  uv -= 0.5;
  uv.x *= resolution.x / resolution.y;
  uv.x *= 0.35;                                   // 横長の星雲

  const vec3 col0 = vec3(0.157, 0.235, 0.424);
  const vec3 col1 = vec3(0.588, 0.682, 0.906);
  const vec3 col2 = vec3(0.325, 0.514, 0.843);

  vec4 bg = vec4(0.0);
  vec4 l0 = vec4(col0, neb_shape(uv, 0.4, 0.3, 0.2, 4.0) * 1.3);
  vec4 l1 = vec4(col1, neb_shape(uv, 0.6, 0.4, 0.1, 6.0) * 1.2);
  vec4 l2 = vec4(col2, neb_shape(uv, 0.4, 0.8, 0.1, 10.0));
  vec4 layers = neb_blend(l0, bg);
  layers = neb_blend(l1, layers);
  layers = neb_blend(l2, layers);
  vec3 color = layers.rgb * layers.a;

  if(abs(uCosGrad) > 0.0001){
    float lum = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(color, cosGradColor(lum) * (0.2 + 1.4*lum), abs(uCosGrad));
  }
  bgAlpha = (uSlotIsA > 0.5) ? 1.0 : clamp(layers.a, 0.0, 1.0);  // Slot B はブロブ部分のみ
  return color;
}
