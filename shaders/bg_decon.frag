// =====================================================
// bg_decon
//   Source : Shadertoy "jms_decon_study" https://www.shadertoy.com/view/ssdGRs
//   マトリックス風コードレイン。元はフォントatlas(iChannel0)とノイズ(iChannel1)を
//   使用するが、手続き生成のグリフ/ノイズで代替して単体化。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは dc_ で名前空間化。
// =====================================================
float dc_rand(float a){ return fract(cos(sin(a))); }
float dc_hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float dc_noise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  float a=dc_hash(i), b=dc_hash(i+vec2(1,0)), c=dc_hash(i+vec2(0,1)), d=dc_hash(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}

// @param uSize   50..200 = 100.0
// @param uColumn 50..300 = 100.0
// @param uGlow   25..300 = 100.0
// @param uFill   10..90  = 45.0
// @param uAngle -180..180 = 0.0
// @param uStreakFreq 40..250 = 100
// @param uTrail 30..300 = 100
// @param uGlyphRes 3..9 = 5
// @param uGlyphGap -4..12 = 0
// @param uGlyphTall 50..250 = 100
// @param uGlyphVariety 4..96 = 48
// @param uLayer2Width 50..300 = 100
// @param uLayer2Size 50..300 = 100
// @param uLayer2Gain 0..300 = 100
// @param uFlickerScale 30..300 = 100
// @param uColumnSway -100..100 = 0
// @param uTrailCurve -100..100 = 0
// @param uColumnGap 0..90 = 0
// @param uSpeedSpread 0..300 = 100
// @param uFlickerAmount 0..200 = 100
// @param uGlyphSlant -100..100 = 0
// @param uFadeDown -100..100 = 0
// @param uMirrorCode 0..100 = 0
// @param uLayer2Shift -100..100 = 0
// @param uStreakSeed 0..200 = 0
// @param uCodeColor color = #ffffff
// @param uLayer2Color color = #ffffff
uniform float uSize;      // 文字 (グリフ) の大きさ (%)
uniform float uColumn;    // コードの帯の幅 (%)
uniform float uGlow;      // 帯の明るさ (%)
uniform float uFill;      // 文字のドットの埋まり具合 (%)
uniform float uAngle; // コード雨全体の傾き (度)
uniform float uStreakFreq; // 縦の筋の繰り返しの細かさ (%)
uniform float uTrail; // 筋の尾の長さ (%)。下げると尾が短く切れる
uniform float uGlyphRes; // 文字のドット格子の分割数
uniform float uGlyphGap; // 文字の周りの余白 (%)
uniform float uGlyphTall; // 文字の縦横比 (%)。上げると縦長
uniform float uGlyphVariety; // 文字の種類の数
uniform float uLayer2Width; // 奥の帯 (2 層目) の幅 (%)
uniform float uLayer2Size; // 奥の帯 (2 層目) の文字の大きさ (%)
uniform float uLayer2Gain; // 奥の帯 (2 層目) の明るさ (%)
uniform float uFlickerScale; // 明滅ムラの細かさ (%)
uniform float uColumnSway; // 帯が左右にうねる量 (%)。0 でまっすぐ
uniform float uTrailCurve; // 尾の明るさの落ち方 (%)。正で先頭だけ鋭く光り負で尾まで均す
uniform float uColumnGap; // 帯が抜ける割合 (%)。上げると空白の列が増える
uniform float uSpeedSpread; // 帯ごとの流れる速さのばらつき (%)。0 で全帯が同じ速さ
uniform float uFlickerAmount; // 明滅ムラの深さ (%)。0 で均一
uniform float uGlyphSlant; // 文字の斜体の傾き (%)
uniform float uFadeDown; // 画面の縦方向のフェード (%)。正で下へ消え 負で上へ消える
uniform float uMirrorCode; // 左右の鏡像の折り返し位置 (%)。0 = なし / 上げると折り返しが左端から中央へ寄り 100 で中央の完全な左右対称
uniform float uLayer2Shift; // 奥の帯を横へずらす量 (%)
uniform float uStreakSeed; // 帯の並びの乱数の種。値を変えると別の配置になる
uniform vec3 uCodeColor; // コード全体の色味 (掛け算のティント)
uniform vec3 uLayer2Color; // 奥の帯の色味 (掛け算のティント)

// 縦に流れるコードの帯(緑のストリーク)
vec3 dc_codeLines(vec2 fc, float reps, vec3 baseCol, float sm){
  fc.x -= mod(fc.x, reps);
  fc.x += uStreakSeed * 7.0;
  float offset = sin(fc.x*15.0);
  float speed  = cos(fc.x)*0.1*(uSpeedSpread / 100.0) + sm;
  float vrep   = dc_rand(fc.x);
  float y = fract((fc.y/resolution.y)*vrep*(uStreakFreq / 100.0) + offset + time*speed);
  if(uTrailCurve != 0.0) y = pow(max(y, 1e-4), exp2(uTrailCurve / 100.0 * 1.5));
  float gp = 1.0;
  if(uColumnGap > 0.0){ gp = step(uColumnGap / 100.0, dc_hash(vec2(fc.x * 0.37, 3.1))); }
  return baseCol * (uGlow / 100.0) / (y*20.0*(uTrail / 100.0)) * gp;
}

// 手続き的グリフ(フォントatlas の代替)。セルごとに時間で切り替わる文字状パターン
float dc_chars(vec2 fc, float reps){
  vec2 rp   = vec2(reps, reps * (uGlyphTall / 100.0));
  vec2 cell = floor(fc/rp);
  vec2 luv  = fract(fc/rp);
  luv.x -= (luv.y - 0.5) * uGlyphSlant / 100.0 * 0.6;
  float gid = floor(dc_noise(cell*0.7 + floor(time*3.0)*0.13) * floor(uGlyphVariety + 0.5));
  vec2 sub  = floor(luv*floor(uGlyphRes + 0.5));                              // 5x5 のドットグリッド
  float on  = step(uFill / 100.0, dc_hash(sub + gid*9.1));
  float mLo = 0.06, mHi = 0.94;
  if(uGlyphGap != 0.0){ mLo += uGlyphGap / 100.0; mHi -= uGlyphGap / 100.0; }
  float margin = step(mLo,luv.x)*step(luv.x,mHi)*step(mLo,luv.y)*step(luv.y,mHi);
  return on * margin;
}

vec3 bg_decon(vec2 fc){
  vec2 I0 = (fc - resolution*0.5) / max(bgZoom, 0.001);
  float aD = radians(uAngle);
  I0 = mat2(cos(aD), -sin(aD), sin(aD), cos(aD)) * I0;
  if(uColumnSway != 0.0) I0.x += sin(I0.y * 0.012) * uColumnSway * 0.4;
  if(uMirrorCode > 0.0){ float mAx = -(100.0 - uMirrorCode) / 100.0 * resolution.x * 0.5; I0.x = abs(I0.x - mAx) + mAx; }
  I0 *= 1.3333;                                       // 拡大率を75%に(パターンを縮小)
  vec2 I  = I0 + resolution*0.5 + bgCamPx;
  vec2 uv = I / resolution;

  vec3 col1 = dc_codeLines(I, 4.0 * (uColumn / 100.0), vec3(.2,.8,.2),  .15) * dc_chars(I, 8.0 * (uSize / 100.0));
  vec2 I2 = I;
  if(uLayer2Shift != 0.0) I2.x += uLayer2Shift / 100.0 * resolution.x * 0.25;
  vec3 col2 = dc_codeLines(I2, 8.0 * (uColumn / 100.0) * (uLayer2Width / 100.0), vec3(.05,.75,.25), .25) * dc_chars(I2, 16.0 * (uSize / 100.0) * (uLayer2Size / 100.0)) * (uLayer2Gain / 100.0);

  // iChannel1 の色変調の代替(ノイズで明滅)
  vec3 nz = vec3(dc_noise(uv*8.0*(uFlickerScale / 100.0) + time*0.10),
                 dc_noise(uv*8.0*(uFlickerScale / 100.0) + 5.0 + time*0.10),
                 dc_noise(uv*8.0*(uFlickerScale / 100.0) + 9.0));
  vec3 nzm = nz * 2.0;
  if(uFlickerAmount != 100.0) nzm = mix(vec3(1.0), nzm, uFlickerAmount / 100.0);
  if(uFadeDown != 0.0){
    float fy = uFadeDown > 0.0 ? uv.y : 1.0 - uv.y;
    nzm *= clamp(1.0 - abs(uFadeDown) / 100.0 * fy * 1.2, 0.0, 1.0);
  }
  vec3 col = (col1 + col2) * nzm;
  bgAlpha = clamp(dot(col, vec3(0.299, 0.587, 0.114)) * 1.5, 0.0, 1.0);  // 文字=不透明 / 隙間=透明
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = vec3(lum);                                                       // グレースケール
  if(uLayer2Color != vec3(1.0)){
    float l1 = dot(col1 * nzm, vec3(0.299, 0.587, 0.114));
    float l2 = dot(col2 * nzm, vec3(0.299, 0.587, 0.114));
    col = vec3(l1) + vec3(l2) * uLayer2Color;
  }
  col *= uCodeColor;
  return col;
}
