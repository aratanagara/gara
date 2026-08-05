// =====================================================
// bg_abstract  (H39)
//   Source : Shadertoy "Another Abstract" https://www.shadertoy.com/view/WfjfRz
//            (c) Frostbyte (CC BY-NC-SA 4.0)。dot_noise 場をレイマーチし
//            場のグロー + 移動オーブを積算、ACES でトーンマップ。
//   改変: iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//         色・カメラは原版のまま。ヘルパは aa_ で名前空間化。
// =====================================================

// ACES Filmic 近似トーンマップ
vec3 aa_aces(vec3 color){
  const mat3 M1 = mat3(
    0.59719, 0.07600, 0.02840,
    0.35458, 0.90834, 0.13383,
    0.04823, 0.01566, 0.83777
  );
  const mat3 M2 = mat3(
    1.60475, -0.10208, -0.00327,
   -0.53108,  1.10813, -0.07276,
   -0.07367, -0.00605,  1.07602
  );
  vec3 v = M1 * color;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return M2 * (a / b);
}

// Dot Noise (XorDev) — golden-ratio 回転による gyroid 風 irrational 場 [-3,+3]
float aa_dot_noise(vec3 p){
  const float PHI = 1.618033988;
  const mat3 GOLD = mat3(
    -0.571464913, +0.814921382, +0.096597072,
    -0.278044873, -0.303026659, +0.911518454,
    +0.772087367, +0.494042493, +0.399753815
  );
  return dot(cos(GOLD * p), sin(PHI * p * GOLD));
}

mat2 aa_rot(float a){
  float c = cos(a), s = sin(a);
  return mat2(c, -s,
              s,  c);
}

vec3 bg_abstract(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;

  float t = -time - 500.0;

  // Normalized device coords
  vec2 uv = (I / resolution.xy) * 2.0 - 1.0;
  uv.x *= resolution.x / resolution.y;

  // Ray direction & camera pos
  vec3 d = normalize(vec3(2.0 * I, 0.0) - resolution.xyy);
  vec3 p = vec3(0, 0, t);

  vec3 l = vec3(0.0);   // accumulated radiance

  // Raymarch loop
  for(float i = 0.0; i < 150.0; i++){
    vec3 rp = p;
    p.xy *= aa_rot(p.z * 0.0001);
    // Step distance (positive safe stepping)
    float s = abs(aa_dot_noise(rp) + (p.y)) * 0.1 + 0.015;

    // Step forward
    p += d * s;

    // Accumulate radiance: field glow + moving orb
    l += (sin(p.z * 0.5 - vec3(0.5, 0.8, 0.9)) /
         (abs(s * 0.001) + 1e-6))
         + 0.3 * vec3(7, 4, 1) /
         (length(uv + vec2(-1.0 + 2.0 * smoothstep(-1.0, 1.0, sin(t * 0.50)),
                           -0.4 + sin(t * 0.25) * 0.3))
          * (1e-3 * abs(sin(t * 0.4) * 0.5 + 2.0)));
  }

  // Tonemap + gamma correction (l*l = 様式的なコントラスト強調)
  //   オーブ項が length→0 で発散するため hdr をクランプ (Inf→ACES→NaN を防ぐ)。
  //   ACES は僅かに負を返すことがあり pow(負, 0.45)=NaN になるため max(.,0)。
  //   最後に [0,1] へ収め、Slot B 合成時の RGB 破綻(NaN/>1 痕)を防ぐ。
  vec3 hdr = clamp(l * l / 3e12, 0.0, 64.0);
  vec3 c = pow(max(aa_aces(hdr), 0.0), vec3(1.0 / 2.2));
  return clamp(c, 0.0, 1.0);
}
