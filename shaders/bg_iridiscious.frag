// =====================================================
// bg_iridiscious
//   Source : Shadertoy "Iridiscious" https://www.shadertoy.com/view/3X2Bzz
//   Author : Jaenam
//   License: Creative Commons CC BY-NC-SA 4.0
//   vj ツールの bg 形式に適合 (mainImage → bg 関数 / iTime,iResolution → time,resolution
//   / bgZoom・bgCamPx でズーム/パン対応)。
// =====================================================
// @param uDetail   7..11   = 11.0
// @param uDensity  60..200  = 100.0
// @param uWarp     0..300   = 100.0
// @param uContrast 25..250  = 100.0
// @param uBandSplit 50..200 = 100.0
// @param uCoreGain 20..300 = 100.0
// @param uCoreFloor 30..400 = 100.0
// @param uCoreSharp 50..200 = 100.0
// @param uCarry 60..200 = 100.0
// @param uBandFreq 40..250 = 100.0
// @param uStretchX 50..200 = 100.0
// @param uShear -100..100 = 0.0
// @param uLens -100..100 = 0.0
// @param uCrossWarp -100..100 = 0.0
uniform float uDetail;     // 重ねる層の数 (下げると軽く、模様が単純になる)
uniform float uDensity;    // 模様の細かさ (%)
uniform float uWarp;       // 層ごとの歪みの強さ (%)
uniform float uContrast;   // 明暗の強さ (%)
uniform float uBandSplit; // 赤の帯だけを細かく・粗くする (%)。帯の色のずれ方が変わる
uniform float uCoreGain; // 光の核の強さ (%)
uniform float uCoreFloor; // 光の核の飽和点 (%)。下げると核が鋭く尖る
uniform float uCoreSharp; // 光の核の絞り込み (%)
uniform float uCarry; // 層から層へ持ち越す光の量の逆数 (%)。下げると前の層の光が強く残る
uniform float uBandFreq; // 虹色の帯の細かさ (%)
uniform float uStretchX; // 横方向の伸縮 (%)
uniform float uShear; // 縦位置に応じた横ずれ (%)
uniform float uLens; // 画面端の膨らみ・つぼみ (%)。正で端が引き伸ばされる
uniform float uCrossWarp; // 歪みの縦横の絡め方 (%)。0 = そのまま / 負で逆回り

vec3 bg_iridiscious(vec2 fc){
  // ズーム/パン: 中心基準でスケールしてからパン
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;

  if(uStretchX != 100.0) I.x = (I.x - resolution.x * 0.5) * (uStretchX / 100.0) + resolution.x * 0.5;
  if(uShear != 0.0) I.x += (I.y - resolution.y * 0.5) * (uShear / 100.0);
  if(uLens != 0.0){ vec2 d = (I - resolution * 0.5) / resolution.y; I += (I - resolution * 0.5) * (uLens / 100.0) * 0.5 * dot(d, d); }

  float i = 0.0, s = 14.0 * (uDensity / 100.0);
  vec4 O = vec4(0.0), q = vec4(0.0), l = vec4(0.0);

  for(; i++ < 11.0; ){
    if(i > floor(uDetail + 0.5)) break;
    vec2 qw = q.yx;
    if(uCrossWarp > 0.0) qw = mix(q.yx, q.xy, uCrossWarp / 100.0);
    if(uCrossWarp < 0.0) qw = q.yx * (1.0 + 2.0 * uCrossWarp / 100.0);
    q.xy = sin(time + s * I/resolution.y + qw * 2.0 * (uWarp / 100.0));
    l += (0.1 * (uCoreGain / 100.0)) / max(dot(q = sin(q), q * (4.0 * (uCoreSharp / 100.0))), 0.1 * (uCoreFloor / 100.0));
    s *= 0.8;
    O += sin(l*vec4(3.0 * (uBandSplit / 100.0),2.0,1.0,1.0) * (uBandFreq / 100.0) + i*0.7) / s;
    l /= 4.0 * (uCarry / 100.0);
  }

  O = tanh(O*O * (uContrast / 100.0));

  // 色相だけを差し替え、明度(輝度)は元のまま保持する。
  // tinted = 目標色相 × (元の輝度 / 目標色相の輝度)
  vec3 c = O.rgb;
  const vec3 LW = vec3(0.299, 0.587, 0.114);

  // 黄色〜暖色(低彩度のクリーム/ベージュ)部分 → ガンメタ(クールなブルーグレー)。
  float lum = dot(c, LW);
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float sat = (mx - mn) / max(mx, 1e-3);
  float warm = (c.r + c.g) * 0.5 - c.b;
  float mask = smoothstep(-0.02, 0.08, warm) * (1.0 - smoothstep(0.35, 0.70, sat));
  vec3 gunH = vec3(0.82, 0.88, 1.02);                   // クールなスチール色相
  vec3 gun  = gunH * (lum / dot(gunH, LW));             // 明度保存
  c = mix(c, gun, mask);

  // 残った黄土色/オレンジを青系に(明度保存)
  float ochre = c.r - max(c.g, c.b);
  float wm = smoothstep(0.03, 0.22, ochre);
  float l2 = dot(c, LW);
  vec3 blueH = vec3(0.35, 0.55, 1.10);
  vec3 blued = blueH * (l2 / dot(blueH, LW));
  c = mix(c, blued, wm * 0.9);

  // 水色(シアン) → 浅葱色(青緑寄りのシアン)(明度保存)
  float cyanness = min(c.g, c.b) - c.r;
  float cm = smoothstep(0.06, 0.30, cyanness);
  float l3 = dot(c, LW);
  vec3 asagiH = vec3(0.20, 0.80, 0.95);
  vec3 asagi = asagiH * (l3 / dot(asagiH, LW));
  c = mix(c, asagi, cm * 0.85);

  return clamp(c, 0.0, 1.0);
}
