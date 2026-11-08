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

// @param uPhi 94..110 = 100.0
uniform float uPhi; // 場の模様の比率 (%)。模様の並びが変わる

// Dot Noise (XorDev) — golden-ratio 回転による gyroid 風 irrational 場 [-3,+3]
float aa_dot_noise(vec3 p){
  const float PHI = 1.618033988;
  const mat3 GOLD = mat3(
    -0.571464913, +0.814921382, +0.096597072,
    -0.278044873, -0.303026659, +0.911518454,
    +0.772087367, +0.494042493, +0.399753815
  );
  float PHIk = PHI * (uPhi / 100.0);
  return dot(cos(GOLD * p), sin(PHIk * p * GOLD));
}

mat2 aa_rot(float a){
  float c = cos(a), s = sin(a);
  return mat2(c, -s,
              s,  c);
}

// @param uGlow    10..300 = 100.0
// @param uDensity 40..300 = 100.0
// @param uWarp    0..500 = 100.0
// @param uOrb     0..300 = 100.0
// @param uSteps 50..150 = 150.0
// @param uOrbSweep 0..200 = 100.0
// @param uOrbBob 0..300 = 100.0
// @param uBandFreq 50..200 = 100.0
// @param uMinStep 50..200 = 100.0
// @param uStepGain 50..200 = 100.0
// @param uGround 0..250 = 100.0
// @param uFieldFlat 50..200 = 100.0
// @param uCamHeight -100..100 = 0.0
// @param uCamSway 0..200 = 0.0
// @param uRoll -90..90 = 0.0
// @param uFocal 60..160 = 100.0
// @param uOrbX -100..100 = 0.0
// @param uOrbY -100..100 = 0.0
// @param uOrbPulse 0..250 = 100.0
// @param uOrbColor color = #ffffff
// @param uBandShift -100..100 = 0.0
// @param uBandHue -100..100 = 0.0
// @param uCamX -100..100 = 0.0
// @param uCamBob 0..200 = 0.0
// @param uCamYaw -45..45 = 0.0
// @param uCamPitch -45..45 = 0.0
// @param uBarrel -100..100 = 0.0
// @param uSqueezeX 50..200 = 100.0
// @param uMirrorX 0..100 = 0.0
// @param uMirrorY 0..100 = 0.0
// @param uVignette -100..100 = 0.0
// @param uFilmGrain 0..100 = 0.0
// @param uLightTint color = #ffffff
// @param uShadowTint color = #ffffff
uniform float uGlow; // 全体の明るさ (%)
uniform float uDensity; // 場の模様の細かさ (%)
uniform float uWarp; // 奥行きに沿ったねじれ (%)
uniform float uOrb; // 移動オーブの明るさ (%)
uniform float uSteps; // レイマーチのステップ数 (下げると軽く、遠景や細部が欠ける)
uniform float uOrbSweep; // オーブが左右へ動く幅 (%)
uniform float uOrbBob; // オーブの上下の揺れ (%)
uniform float uBandFreq; // 奥行き方向の色の帯の細かさ (%)
uniform float uMinStep; // 1 ステップの最小の進み (%)。上げると遠くまで届く
uniform float uStepGain; // 場の距離に応じた進みの係数 (%)
uniform float uGround; // 地面の傾きの強さ (%)。0 で地面のない塊
uniform float uFieldFlat; // 場の縦方向の細かさ (%)
uniform float uCamHeight; // カメラの高さ。正で場の上へ
uniform float uCamSway; // カメラの左右の揺れ (%)
uniform float uRoll; // 画面の傾き (度)
uniform float uFocal; // 画角の広さ (%)。上げると広角
uniform float uOrbX; // オーブの中心の左右位置 (%)
uniform float uOrbY; // オーブの中心の上下位置 (%)
uniform float uOrbPulse; // オーブの明滅の振れ幅 (%)
uniform vec3  uOrbColor; // オーブの色 (掛け算)
uniform float uBandShift; // 色の帯を奥行き方向へずらす (%)
uniform float uBandHue; // 色の帯の R/G/B の位相差 (%)。帯の色合いが変わる
uniform float uCamX; // カメラの左右位置 (%)
uniform float uCamBob; // カメラの上下の揺れ (%)
uniform float uCamYaw; // カメラの左右の向き (度)
uniform float uCamPitch; // カメラの上下の向き (度)
uniform float uBarrel; // 視野の樽型・糸巻き型の歪み (%)。負で糸巻き
uniform float uSqueezeX; // 画の横の伸縮 (%)
uniform float uMirrorX; // 左右に折り返す量 (%)。100 で中心から鏡像
uniform float uMirrorY; // 上下に折り返す量 (%)。100 で中心から鏡像
uniform float uVignette; // 周辺の減光 (%)。負で周辺が明るくなる
uniform float uFilmGrain; // フィルムの粒 (%)
uniform vec3  uLightTint; // 明るい部分の色 (掛け算)
uniform vec3  uShadowTint; // 暗い部分の色 (掛け算)

vec3 bg_abstract(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;

  float t = -time - 500.0;

  // Normalized device coords
  vec2 uv = (I / resolution.xy) * 2.0 - 1.0;
  uv.x *= resolution.x / resolution.y;

  // Ray direction & camera pos
  vec3 dd = vec3(2.0 * I, 0.0) - resolution.xyy;
  dd.z *= 100.0 / uFocal;
  if(uSqueezeX != 100.0){ dd.x *= 100.0 / uSqueezeX; }
  if(uMirrorX != 0.0){ float ma = -(1.0 - uMirrorX / 100.0) * resolution.x; dd.x = abs(dd.x - ma) + ma; }
  if(uMirrorY != 0.0){ float mb = -(1.0 - uMirrorY / 100.0) * resolution.y; dd.y = abs(dd.y - mb) + mb; }
  if(uBarrel != 0.0){ vec2 bq = dd.xy / resolution.y; dd.xy *= 1.0 + uBarrel / 100.0 * 0.5 * dot(bq, bq); }
  vec3 d = normalize(dd);
  if(uRoll != 0.0){ float ra = radians(uRoll); float rc = cos(ra), rs = sin(ra); d.xy = mat2(rc, -rs, rs, rc) * d.xy; }
  if(uCamYaw != 0.0){ float ya = radians(uCamYaw); float yc = cos(ya), ys = sin(ya); d.xz = mat2(yc, -ys, ys, yc) * d.xz; }
  if(uCamPitch != 0.0){ float pa = radians(uCamPitch); float pc = cos(pa), ps = sin(pa); d.yz = mat2(pc, -ps, ps, pc) * d.yz; }
  vec3 p = vec3(0, uCamHeight / 100.0, t);
  if(uCamSway != 0.0) p.x = sin(t * 0.2) * (uCamSway / 100.0);
  if(uCamX != 0.0) p.x += uCamX / 100.0;
  if(uCamBob != 0.0) p.y += sin(t * 0.3) * (uCamBob / 100.0 * 0.5);
  vec2 uv0 = uv;
  if(uOrbX != 0.0 || uOrbY != 0.0){ uv -= vec2(uOrbX * 1.8, uOrbY) / 100.0; }
  vec3 bandC = vec3(0.5, 0.8, 0.9);
  if(uBandShift != 0.0){ bandC -= vec3(uBandShift / 100.0 * 3.0); }
  if(uBandHue != 0.0){ bandC -= vec3(0.0, 1.0, 2.0) * (uBandHue / 100.0 * 2.0); }
  vec3 orbCol = vec3(7, 4, 1) * uOrbColor;
  float orbR = 1e-3 * abs(sin(t * 0.4) * (0.5 * (uOrbPulse / 100.0)) + 2.0);

  vec3 l = vec3(0.0);   // accumulated radiance

  // Raymarch loop
  for(float i = 0.0; i < 150.0; i++){
    if(i >= floor(uSteps + 0.5)) break;
    vec3 rp = p;
    p.xy *= aa_rot(p.z * 0.0001 * (uWarp / 100.0));
    // Step distance (positive safe stepping)
    vec3 rq = rp * (uDensity / 100.0);
    rq.y *= uFieldFlat / 100.0;
    float s = abs(aa_dot_noise(rq) + (p.y * (uGround / 100.0))) * (0.1 * (uStepGain / 100.0)) + 0.015 * (uMinStep / 100.0);

    // Step forward
    p += d * s;

    // Accumulate radiance: field glow + moving orb
    l += (sin(p.z * (0.5 * (uBandFreq / 100.0)) - bandC) /
         (abs(s * 0.001) + 1e-6))
         + 0.3 * (uOrb / 100.0) * orbCol /
         (length(uv + vec2(-1.0 * (uOrbSweep / 100.0) + 2.0 * (uOrbSweep / 100.0) * smoothstep(-1.0, 1.0, sin(t * 0.50)),
                           -0.4 + sin(t * 0.25) * (0.3 * (uOrbBob / 100.0))))
          * orbR);
  }

  // Tonemap + gamma correction (l*l = 様式的なコントラスト強調)
  //   オーブ項が length→0 で発散するため hdr をクランプ (Inf→ACES→NaN を防ぐ)。
  //   ACES は僅かに負を返すことがあり pow(負, 0.45)=NaN になるため max(.,0)。
  //   最後に [0,1] へ収め、Slot B 合成時の RGB 破綻(NaN/>1 痕)を防ぐ。
  vec3 hdr = clamp(l * l / 3e12 * (uGlow / 100.0), 0.0, 64.0);
  vec3 c = pow(max(aa_aces(hdr), 0.0), vec3(1.0 / 2.2));
  if(uLightTint != vec3(1.0) || uShadowTint != vec3(1.0)){
    c *= mix(uShadowTint, uLightTint, clamp(dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 1.0));
  }
  if(uVignette != 0.0){ c *= clamp(1.0 - uVignette / 100.0 * 0.3 * dot(uv0, uv0), 0.0, 2.0); }
  if(uFilmGrain != 0.0){
    float gr = fract(sin(dot(fc, vec2(12.9898, 78.233)) + floor(time * 24.0) * 3.1) * 43758.5453);
    c += (gr - 0.5) * (uFilmGrain / 100.0) * 0.25;
  }
  return clamp(c, 0.0, 1.0);
}
