// =====================================================
// bg_whitenoise (White Noise)
//   ホワイトノイズ (砂嵐)。整数ハッシュ (PCG) なので sin 由来の縞・格子は出ない。
//   Grain / Aspect で粒の大きさと縦横比、Speed で入れ替わる速さ (100% = 毎秒 60 回)、
//   Color でモノクロ → RGB 別々、Density で黒地のまばらな点、Lines で横に伸びたアナログ TV 風の走査線ノイズ、
//   Flicker で画面全体の明滅、Beat で拍ごとの粒の入れ替え + 明るさのパルス。
//   背景は黒で返し、bgAlpha = 点の有無 (Density < 100 のとき Slot B で下の絵にまばらな点だけが乗る)。
//   書式は bg_composition / bg_flower に合わせた (getBeat / time / iAudio を使用)。
// =====================================================

// @param uGrain    1..64    = 1.0   @desc 粒の大きさ (px)。1 で 1 画素ごとのノイズ
// @param uAspect   25..400  = 100.0 @desc 粒の縦横比 (%)。100 で正方形、上げると横長、下げると縦長
// @param uSpeed    0..200   = 100.0 @desc ノイズの入れ替わる速さ (%)。100 で毎秒 60 回、0 で静止
// @param uContrast 0..300   = 100.0 @desc コントラスト (%)。上げると白黒がはっきり、下げると灰色に寄る
// @param uBright   -100..100 = 0.0  @desc 明るさ (%)。マイナスで暗く、プラスで明るく
// @param uColor    0..100   = 0.0   @desc 色ノイズの量 (%)。0 でモノクロ、100 で RGB が別々のカラーノイズ
// @param uTint     color = #ffffff  @desc ノイズに乗せる色味 (ティント)
// @param uDensity  1..100   = 100.0 @desc 点の密度 (%)。下げると黒地にまばらな点
// @param uLines    0..100   = 0.0   @desc 横に伸びた走査線状のノイズの混ぜ具合 (%)。アナログ TV 風
// @param uFlicker  0..100   = 0.0   @desc 画面全体の明滅 (%)。毎回の入れ替わりで明るさが揺れる
// @param uBeatAmt  0..100   = 0.0   @desc 拍の効き (%)。拍ごとに粒が入れ替わり、拍頭で明るくなる。音にも反応
// @param uSeed     0..100   = 0.0   @desc 乱数の種。値を変えると別のノイズになる
uniform float uGrain;
uniform float uAspect;
uniform float uSpeed;
uniform float uContrast;
uniform float uBright;
uniform float uColor;
uniform vec3  uTint;
uniform float uDensity;
uniform float uLines;
uniform float uFlicker;
uniform float uBeatAmt;
uniform float uSeed;

vec3 wn_pcg3(uvec3 v){
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return vec3(v) * (1.0 / 4294967295.0);
}

vec3 bg_whitenoise(vec2 fc){
  float b = getBeat();
  float bk = uBeatAmt * 0.01;
  // 入れ替え番号: 時間 (Speed) + 拍ごとの入れ替え (Beat > 0 のとき)
  float fr = floor(time * uSpeed * 0.6);
  if(uBeatAmt > 0.0) fr += floor(max(b, 0.0)) * 7919.0;
  uint frame = uint(max(fr, 0.0));
  uint seed = uint(uSeed) * 2654435u;

  vec2 gs = vec2(max(uGrain, 1.0) * max(uAspect, 1.0) * 0.01, max(uGrain, 1.0));
  vec2 cell = floor(fc / gs);
  uvec3 key = uvec3(uint(int(cell.x) + 65536), uint(int(cell.y) + 65536), frame + seed);

  vec3 n3 = wn_pcg3(key);
  vec3 n = mix(vec3(n3.x), n3, uColor * 0.01);

  // 横に伸びた走査線ノイズ: 行ごとにずらした長いセルで 1 本の筋にする
  if(uLines > 0.0){
    float row = floor(fc.y / max(uGrain, 1.0));
    vec3 rh = wn_pcg3(uvec3(uint(int(row) + 65536), frame + seed, 977u));
    float lw = max(uGrain, 1.0) * 24.0 * max(uAspect, 1.0) * 0.01;
    float lx = floor((fc.x + rh.x * 4096.0) / lw);
    vec3 l3 = wn_pcg3(uvec3(uint(int(lx) + 65536), uint(int(row) + 65536), frame * 3u + seed + 31u));
    vec3 ln = mix(vec3(l3.x), l3, uColor * 0.01);
    float scan = 0.85 + 0.15 * rh.y;
    n = mix(n, ln * scan, uLines * 0.01);
  }

  n = (n - 0.5) * (uContrast * 0.01) + 0.5 + uBright * 0.005;

  // 全体の明滅 + 拍頭のパルス + 音
  float fk = uFlicker * 0.01;
  float fl = 1.0 - fk * 0.7 * wn_pcg3(uvec3(frame + seed, 4242u, 7u)).x;
  float pulse = (1.0 - fract(max(b, 0.0)));
  pulse = pulse * pulse * pulse;
  float gain = fl * (1.0 + bk * (pulse * 0.8 + clamp(iAudio, 0.0, 1.0) * 0.6));
  vec3 col = clamp(n * gain, 0.0, 1.0) * uTint;

  // 密度: 点の有無 (黒地 + bgAlpha = 点の割合)
  float dn = wn_pcg3(key + uvec3(101u, 202u, 303u)).y;
  float m = (uDensity >= 100.0) ? 1.0 : step(dn, uDensity * 0.01);
  bgAlpha = m;
  return col * m;
}
