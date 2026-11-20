// =====================================================
// bg_linetone — 線のトーン (parallel / curved / concentric screentone)
//   画面高あたり uLines 本。角度・曲がり・波・同心円を 1 本の座標に混ぜ、
//   間隔のランダムと太さのばらつきは線ごとに一定 (線の途中で割れない)。
//   uGrad は画面を横切って線の太さが変わるグラデトーン。
//   背景は黒、bgAlpha は線の実カバレッジ。uPaper=100 で白地に黒線。
//   getBeat() を使うので beat モードでも time が拍境界で飛ばない。
// =====================================================

// @param uAngle   0..360  = 28.0
// @param uLines   2..160  = 34.0
// @param uThick   2..90   = 38.0
// @param uSpace   0..100  = 0.0
// @param uThickJ  0..100  = 18.0
// @param uCurve   0..100  = 0.0
// @param uWave    0..100  = 0.0
// @param uWaveN   1..16   = 3.0
// @param uRadial  0..100  = 0.0
// @param uGrad    0..100  = 0.0
// @param uGradDir 0..360  = 118.0
// @param uAnim    0..100  = 28.0
// @param uSpin    0..100  = 0.0
// @param uSeed    0..999  = 1.0
// @param uPaper   0..100  = 0.0
// @param uInk     color   = #ffffff
uniform float uAngle;    // 線の角度 (deg)
uniform float uLines;    // 線数 (画面高あたり)
uniform float uThick;    // 太さ (ピッチに対する %)
uniform float uSpace;    // 間隔のランダム (0=等間隔)
uniform float uThickJ;   // 太さのばらつき
uniform float uCurve;    // 曲がり
uniform float uWave;     // 波の量
uniform float uWaveN;    // 波の数 (画面を横切る山の数)
uniform float uRadial;   // 同心円 (0=平行 / 100=同心)
uniform float uGrad;     // グラデーション (太さが画面を横切って変わる)
uniform float uGradDir;  // グラデーションの方向 (deg)
uniform float uAnim;     // 線が流れる速さ
uniform float uSpin;     // 角度が回る速さ
uniform float uSeed;     // 間隔 / 太さの乱数シード
uniform float uPaper;    // 原稿モード (白地に黒 %)
uniform vec3  uInk;      // 線の色

float lt_hash(float n){ return fract(sin(n * 127.1 + 311.7) * 43758.5453); }

// s は「1 = 1 ピッチ」。近傍 3 本を見て、間隔を崩しても交差しない。
float lt_cov(float s, float seed, float duty, float space, float jit, float aa){
  float base = floor(s);
  float cov = 0.0;
  for(int k = -1; k <= 1; k++){
    float id = base + float(k);
    float h = lt_hash(id * 1.37 + seed);
    float h2 = lt_hash(id * 2.91 + seed + 8.2);
    float shift = (h - 0.5) * space * 0.88;
    float center = id + 0.5 + shift;
    float w = duty * mix(1.0, mix(0.38, 1.70, h2), jit);
    w = clamp(w, 0.0, 0.94);
    float hw = w * 0.5;
    float d = abs(s - center);
    cov = max(cov, 1.0 - smoothstep(hw, hw + aa, d));
  }
  return cov;
}

vec3 bg_linetone(vec2 fc){
  float bt = getBeat();
  float T = isFree() ? time : bt * (60.0 / max(bpm, 1.0));

  vec2 I = (fc - resolution * 0.5) / max(bgZoom, 0.001) + resolution * 0.5 + bgCamPx;
  vec2 p = (I - 0.5 * resolution) / resolution.y;

  float ang = radians(uAngle) + T * (clamp(uSpin, 0.0, 100.0) * 0.01) * 0.25;
  float curve = clamp(uCurve, 0.0, 100.0) * 0.01;
  float wave = clamp(uWave, 0.0, 100.0) * 0.01;
  float freq = max(floor(uWaveN + 0.5), 1.0);
  float phase = T * 0.65;
  float along = p.x * cos(ang) + p.y * sin(ang);
  float across = -p.x * sin(ang) + p.y * cos(ang);
  across += curve * 1.15 * along * along;
  across += wave * 0.18 * sin(along * freq * 2.35 + phase);

  // 同心は中心の atan 切れ目を使わない。曲がり = 中心をずらす、波 = 角度の sin (中心では消す)。
  float r0 = length(p);
  float a = atan(p.y, p.x);
  float amp = wave * 0.075 * smoothstep(0.05, 0.24, r0);
  vec2 origin = vec2(curve * 0.18, curve * -0.06);
  float rings = length(p - origin) + amp * sin(a * freq + phase);
  float radial = clamp(uRadial, 0.0, 100.0) * 0.01;
  float coord = mix(across, rings, radial);

  float nLines = max(uLines, 1.0);
  float pitch = 1.0 / nLines;
  float drift = T * (clamp(uAnim, 0.0, 100.0) * 0.01) * 1.15;
  float s = coord / pitch + drift;

  float g = dot(p, vec2(cos(radians(uGradDir)), sin(radians(uGradDir))));
  float g01 = smoothstep(-0.62, 0.62, g);
  float grad = clamp(uGrad, 0.0, 100.0) * 0.01;
  float duty = clamp(uThick, 0.0, 100.0) * 0.01;
  duty *= mix(1.0, mix(0.08, 1.45, g01), grad);
  duty = clamp(duty, 0.0, 0.95);

  float space = clamp(uSpace, 0.0, 100.0) * 0.01;
  float jit = clamp(uThickJ, 0.0, 100.0) * 0.01;
  float seed = floor(uSeed + 0.5) + 1.7;
  // 1px 相当。曲がりで密度が変わっても線幅の AA が追従する。
  float aa = max(length(vec2(dFdx(s), dFdy(s))) * 0.75, 0.45 / nLines);
  float ink = lt_cov(s, seed, duty, space, jit, aa);
  ink = clamp(ink, 0.0, 1.0);

  float paper = clamp(uPaper, 0.0, 100.0) * 0.01;
  vec3 rgb = uInk * ink;
  rgb = mix(rgb, vec3(1.0 - ink), paper);
  bgAlpha = mix(ink, 1.0, paper);
  return rgb;
}
