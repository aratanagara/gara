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

// @param uCenterX -100..100 = 0.0
// @param uCenterY -100..100 = 0.0
// @param uRoll -180..180 = 0.0
// @param uMirrorX -100..100 = 0.0
// @param uPixelate 0..100 = 0.0
// @param uWarpPhase -180..180 = 0.0
// @param uLayerDecay 98..102 = 100.0
// @param uLayerPhase 80..130 = 100.0
// @param uSteelAmount 0..150 = 100.0
// @param uBlueAmount 0..150 = 100.0
// @param uAsagiAmount 0..150 = 100.0
// @param uVignette 0..100 = 0.0
// @param uGrain 0..100 = 0.0
// @param uSteelTint color = #ffffff
// @param uBlueTint color = #ffffff
// @param uAsagiTint color = #ffffff
uniform float uCenterX; // 模様の中心を横へずらす (%)
uniform float uCenterY; // 模様の中心を縦へずらす (%)
uniform float uRoll; // 模様全体の回転 (度)
uniform float uMirrorX; // 左右の鏡像 (%)。正負で写す側が入れ替わり、大きさで軸が動く。0 で無効
uniform float uPixelate; // 座標のモザイク化 (%)。上げるほど粗いブロック
uniform float uWarpPhase; // 歪みの位相のずれ (度)。うねり方の形を変える
uniform float uLayerDecay; // 層ごとの細かさの縮み方 (%)。下げるほど奥の層が細かくなる
uniform float uLayerPhase; // 層ごとの色の位相の進み (%)。層ごとの色のずれ方が変わる
uniform float uSteelAmount; // クリーム色をガンメタに置き換える量 (%)
uniform float uBlueAmount; // 黄土色を青に置き換える量 (%)
uniform float uAsagiAmount; // 水色を浅葱色に置き換える量 (%)
uniform float uVignette; // 周辺減光 (%)
uniform float uGrain; // 粒状ノイズの量 (%)
uniform vec3 uSteelTint; // ガンメタ部分の色味 (掛け算のティント)
uniform vec3 uBlueTint; // 青部分の色味 (掛け算のティント)
uniform vec3 uAsagiTint; // 浅葱部分の色味 (掛け算のティント)

vec3 bg_iridiscious(vec2 fc){
  // ズーム/パン: 中心基準でスケールしてからパン
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;

  if(uRoll != 0.0){ float ra = radians(uRoll); vec2 rd = I - resolution * 0.5; I = resolution * 0.5 + mat2(cos(ra), -sin(ra), sin(ra), cos(ra)) * rd; }
  if(uMirrorX != 0.0){ float ax = resolution.x * 0.5 + uMirrorX / 100.0 * resolution.y * 0.25; I.x = ax + sign(uMirrorX) * abs(I.x - ax); }
  if(uCenterX != 0.0 || uCenterY != 0.0) I += vec2(uCenterX, uCenterY) / 100.0 * resolution.y * 0.5;
  if(uPixelate != 0.0){ float pz = uPixelate / 100.0 * 40.0; I = (floor(I / pz) + 0.5) * pz; }
  if(uStretchX != 100.0) I.x = (I.x - resolution.x * 0.5) * (uStretchX / 100.0) + resolution.x * 0.5;
  if(uShear != 0.0) I.x += (I.y - resolution.y * 0.5) * (uShear / 100.0);
  if(uLens != 0.0){ vec2 d = (I - resolution * 0.5) / resolution.y; I += (I - resolution * 0.5) * (uLens / 100.0) * 0.5 * dot(d, d); }

  float i = 0.0, s = 14.0 * (uDensity / 100.0);
  float tm = time;
  if(uWarpPhase != 0.0) tm += radians(uWarpPhase);
  vec4 O = vec4(0.0), q = vec4(0.0), l = vec4(0.0);

  for(; i++ < 11.0; ){
    if(i > floor(uDetail + 0.5)) break;
    vec2 qw = q.yx;
    if(uCrossWarp > 0.0) qw = mix(q.yx, q.xy, uCrossWarp / 100.0);
    if(uCrossWarp < 0.0) qw = q.yx * (1.0 + 2.0 * uCrossWarp / 100.0);
    q.xy = sin(tm + s * I/resolution.y + qw * 2.0 * (uWarp / 100.0));
    l += (0.1 * (uCoreGain / 100.0)) / max(dot(q = sin(q), q * (4.0 * (uCoreSharp / 100.0))), 0.1 * (uCoreFloor / 100.0));
    s *= 0.8 * (uLayerDecay / 100.0);
    O += sin(l*vec4(3.0 * (uBandSplit / 100.0),2.0,1.0,1.0) * (uBandFreq / 100.0) + i*0.7*(uLayerPhase / 100.0)) / s;
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
  vec3 gunT = gunH * uSteelTint;
  vec3 gun  = gunT * (lum / dot(gunT, LW));             // 明度保存
  c = mix(c, gun, clamp(mask * (uSteelAmount / 100.0), 0.0, 1.0));

  // 残った黄土色/オレンジを青系に(明度保存)
  float ochre = c.r - max(c.g, c.b);
  float wm = smoothstep(0.03, 0.22, ochre);
  float l2 = dot(c, LW);
  vec3 blueH = vec3(0.35, 0.55, 1.10);
  vec3 blueT = blueH * uBlueTint;
  vec3 blued = blueT * (l2 / dot(blueT, LW));
  c = mix(c, blued, clamp(wm * 0.9 * (uBlueAmount / 100.0), 0.0, 1.0));

  // 水色(シアン) → 浅葱色(青緑寄りのシアン)(明度保存)
  float cyanness = min(c.g, c.b) - c.r;
  float cm = smoothstep(0.06, 0.30, cyanness);
  float l3 = dot(c, LW);
  vec3 asagiH = vec3(0.20, 0.80, 0.95);
  vec3 asagiT = asagiH * uAsagiTint;
  vec3 asagi = asagiT * (l3 / dot(asagiT, LW));
  c = mix(c, asagi, clamp(cm * 0.85 * (uAsagiAmount / 100.0), 0.0, 1.0));

  if(uVignette != 0.0){ vec2 vq = (fc * 2.0 - resolution) / resolution.y; c *= 1.0 - clamp(dot(vq, vq) * 0.35, 0.0, 1.0) * uVignette / 100.0; }
  if(uGrain != 0.0) c += (fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * uGrain / 100.0 * 0.6;
  return clamp(c, 0.0, 1.0);
}
