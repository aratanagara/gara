// =====================================================
// bg_flowcollage  —  流れるコラージュ (クラフト紙のうねる帯)
//   参照: ガタリ経由の参考ポスター (gara_shader_ref_202611041822.jpg)
//   構成 (下から順):
//   1. クラフト紙の地 (uPaperCol) + 紙のグレイン
//   2. 帯レイヤー ×2: 2 段のドメインワーピングで流した等値線を帯に切り、
//      帯ごとに柄を選ぶ (無地 / 平行ストライプ / 市松 / 同心円の渦 / 網点)。
//      上のレイヤーは一部の帯だけ不透明 → 帯が重なり、溶け合って入れ替わる
//   3. 帯の縁の黒線と、流れに沿う細い等高線
//   4. 太陽モチーフ: 放射状の短い線を持つ半円 (流れに乗って漂う)
//   5. 刷りのマチエール: インクのかすれ粒・スクラッチ・版ズレ
//   動き: drone は常にゆっくり流れ、場そのものも漂って新しい構図が入ってくる (uDrift)。
//         beat は拍頭ごとに水をかき混ぜるような渦が入り、帯が一気にねじれて 2〜4 拍かけて収まる (uJump)。
//         一部の帯の柄と色も拍ごとに振り直され、拍の最初の 1/4 で溶けるように入れ替わる (uReroll)。
//         拍の境目ではどの動きも途切れない (飛ばない)。
//         拍頭ではうねりも一瞬強まる。iAudio も同じ (uKick)。bgZoom・bgCamPx でズーム/パン
//   配色: uPalette で 8 種から選ぶ (0 = 現行のくすんだ原色)。帯の色・柄の濃淡のアクセント・太陽・
//         混色・拍ごとの振り直しはすべて同じパレットから引く。紙の色 (uPaperCol) と黒い縁線・等高線は変えない
//   透過: Slot B では紙 (紙地の帯・隙間・かすれ・スクラッチ) が透ける。Slot A は uBgColor が黒なら紙を敷く
//   性能: 値ノイズ 4 オクターブの fbm を 7 回 + 定数回の柄計算のみ (ループの
//         レイマーチなし)。重いときは uDetail を下げる (fbm のオクターブ数)
// =====================================================

// @param uSpeed    0..300    = 100.0 @desc 流れの速さ (%)。0 で止まる
// @param uScale    20..300   = 100.0 @desc 柄の大きさ (%)。大きいほど柄が拡大される
// @param uWarp     0..300    = 100.0 @desc 帯のうねり (ドメインワーピングの強さ、%)。拍・音でも一時的に強まる
// @param uBands    20..300   = 100.0 @desc 帯の本数 (%)。大きいほど帯が細かく増える
// @param uStripe   20..300   = 100.0 @desc ストライプ・市松 (流れ方向)・渦の細かさ (%)
// @param uLayer    0..200    = 100.0 @desc 上のレイヤーで不透明になる帯の割合 (%)。大きいほど下の帯が隠れる
// @param uPaper    0..200    = 100.0 @desc 紙地のまま見える帯の割合 (%)
// @param uLines    0..300    = 100.0 @desc 流れに沿う等高線の量 (%)。100 超は出る領域も広がる
// @param uEdge     0..200    = 100.0 @desc 縁に黒線が入る帯の割合 (%)
// @param uDots     0..200    = 100.0 @desc 網点の帯の出やすさ (%)
// @param uSuns     0..300    = 100.0 @desc 放射線つき半円 (太陽) の出る数 (%)。0 で出ない
// @param uGrain    0..300    = 100.0 @desc 紙の粒状ノイズの強さ (%)
// @param uWorn     0..300    = 100.0 @desc インクのかすれ・スクラッチ・黒い粒の全体量 (%)。0 で出ない
// @param uKick     0..200    = 100.0 @desc 拍と音量への反応の強さ (%)。拍頭の押し出し・渦・うねりの強まりに効く
// @param uDetail   2..5      = 4.0 @desc ノイズのオクターブ数。下げると軽く、輪郭が丸くなる
// @param uSeed     0..100    = 0.0 @desc 柄と配色の乱数シード。値を変えると別の構図・配色になる
// @param uJump     0..300    = 100.0 @desc beat 時、拍頭でかき混ぜる渦の強さ (%)。0 でその場の揺れだけ
// @param uBeatFlow 0..300    = 100.0 @desc beat 時、1 拍で帯が押し流される量 (%)
// @param uDrift    0..300    = 100.0 @desc drone 時、場が漂って新しい構図が入ってくる量 (%)
// @param uReroll   0..100    = 40.0 @desc beat 時、拍ごとに柄と色を振り直す帯の割合 (%)
// @param uMixCol   0..100    = 0.0 @desc 隣り合う帯の色が境目で溶け合う量 (%)。0 でくっきり塗り分け
// @param uPalette  0..7      = 0.0 @desc 配色 (0 現行 / 1 パステル / 2 モノクロ / 3 補色 / 4 ネオン / 5 リソ / 6 海 / 7 夕焼け)
// @param uPaperCol color     = #c9ad8e @desc 紙地の色。紙地の帯と背景に使う
// @param uWhiteLines 0..200  = 100.0 @desc 暗い帯の上の白抜き等高線 (%)。100 まで濃さ、超えると太さ
// @param uFieldRotate -180..180 = 0.0 @desc 場全体の回転 (度)
// @param uFieldMirror 0..100 = 0.0 @desc 左右鏡像の軸位置 (%)。0 で鏡像なし、値で軸が右へずれる
// @param uBandSlope 0..300 = 100.0 @desc 帯が斜めに流れる方向性の強さ (%)
// @param uBandGap 0..150 = 100.0 @desc 帯と帯のすき間の大きさ (%)。混色では閉じる
// @param uPlainShare 0..300 = 100.0 @desc 無地の帯の出やすさ (%)
// @param uStripeShare 0..300 = 100.0 @desc ストライプの帯の出やすさ (%)
// @param uCheckShare 0..300 = 100.0 @desc 市松の帯の出やすさ (%)。残りは渦になる
// @param uStripeDuty 40..160 = 100.0 @desc ストライプの地色の線の太さ (%)。上げると別色の線が細くなる
// @param uCheckWidth 30..300 = 100.0 @desc 市松の幅方向の細かさ (%)
// @param uCheckLength 30..300 = 100.0 @desc 市松の流れ方向の細かさ (%)
// @param uDotPitch 40..300 = 100.0 @desc 網点の間隔 (%)
// @param uDotSize 40..160 = 100.0 @desc 網点ひとつの大きさ (%)
// @param uRingFreq 30..300 = 100.0 @desc 渦の同心円の細かさ (%)
// @param uRingTwist 0..300 = 100.0 @desc 渦の角度によるねじれの強さ (%)
// @param uSunSize 40..200 = 100.0 @desc 太陽の半円の大きさ (%)
// @param uSunRays 4..24 = 11.0 @desc 太陽の放射線の本数 (半円まわりの目安)
// @param uSunRayLen 40..250 = 100.0 @desc 太陽の放射線の長さ (%)
// @param uSunRayWidth 30..250 = 100.0 @desc 太陽の放射線の太さ (%)
// @param uEdgeWidth 30..400 = 100.0 @desc 帯の縁の黒線の太さ (%)
// @param uLineWidth 40..300 = 100.0 @desc 等高線の太さ (%)
// @param uLineCover -100..100 = 0.0 @desc 等高線が出る領域の広さ (%)。負で狭く、正で広く
// @param uFiber 0..400 = 100.0 @desc 紙の繊維の低周波ムラの強さ (%)
// @param uScratchAmt 0..300 = 100.0 @desc スクラッチの量 (%)
// @param uSpeckAmt 0..300 = 100.0 @desc 黒い粒の量 (%)
// @param uVignette 0..200 = 0.0 @desc 周辺減光の強さ (%)
// @param uInkTint color = #ffffff @desc 墨 (縁・等高線・輪郭) の色味 (掛け算のティント)
// @param uCreamTint color = #ffffff @desc オフホワイト (網点・白抜き・スクラッチ) の色味 (掛け算のティント)
// @param uSunTint color = #ffffff @desc 太陽の塗りの色味 (掛け算のティント)
// @param uLowerTint color = #ffffff @desc 下のレイヤーの帯の色味 (掛け算のティント)
// @param uUpperTint color = #ffffff @desc 上のレイヤーの帯の色味 (掛け算のティント)
uniform float uSpeed;    // 流れの速さ (%)
uniform float uScale;    // 柄の大きさ (%)
uniform float uWarp;     // うねり (ドメインワーピングの強さ, %)
uniform float uBands;    // 帯の本数 (%)
uniform float uStripe;   // ストライプ・渦の細かさ (%)
uniform float uLayer;    // 上のレイヤーの重なり量 (%)
uniform float uPaper;    // 紙地が見える量 (%)
uniform float uLines;    // 等高線の量 (%)
uniform float uEdge;     // 帯の縁の黒線 (%)
uniform float uDots;     // 網点の帯の量 (%)
uniform float uSuns;     // 太陽モチーフの量 (%)
uniform float uGrain;    // 紙のグレイン (%)
uniform float uWorn;     // インクのかすれ・スクラッチ (%)
uniform float uKick;     // 拍 / 音の効き (%)
uniform float uDetail;   // fbm のオクターブ数 (下げると軽く、輪郭が丸くなる)
uniform float uSeed;     // 柄と配色の乱数シード
uniform float uBeatFlow; // beat: 1 拍で元の帯が流れる量 (%。渦 (uJump) とは別に、帯そのものが拍ごとに押し流される)
uniform float uJump;     // beat: 拍頭でかき混ぜる渦の強さ (%。0 = 従来どおりその場で揺れる)
uniform float uDrift;    // drone: 場が漂って新しい構図が入ってくる量 (%)
uniform float uMixCol;   // 混色: 隣り合う帯の色が境目で溶け合う (%。0 = くっきり塗り分け)
uniform float uReroll;   // beat: 拍ごとに柄と色を振り直す帯の割合 (%)
uniform float uPalette;  // 配色 (0 現行 / 1 パステル / 2 モノクロ / 3 補色 / 4 ネオン / 5 リソ / 6 海 / 7 夕焼け)
float FC_ROLL = 0.0;     // 振り直しの拍番号 (beat のみ。drone は 0 = 振り直さない)
float FC_FADE = 1.0;     // 振り直しの溶け具合 (拍の最初の 1/4 で前の拍の柄から溶ける。1 = 溶け終わり)
int   FC_PAL  = 0;       // 選んだパレットの番号 (uPalette を丸めたもの)
vec3  FC_DK   = vec3(0.09, 0.09, 0.11);   // 柄のアクセントの濃色 (パレットのスロット 6)
vec3  FC_LT   = vec3(0.91, 0.87, 0.78);   // 柄のアクセントの淡色 (パレットのスロット 7)
uniform vec3  uPaperCol; // 紙の色
uniform float uWhiteLines; // 暗い帯の上の白抜きの等高線 (%。0 = 出さない / 〜100 = 濃さ / 100〜 = 太さ)
uniform float uFieldRotate; // 場全体の回転 (度)
uniform float uFieldMirror; // 場の左右鏡像。0 = なし、値で鏡の軸が右へずれる (%)
uniform float uBandSlope; // 帯が斜めに流れる方向性の強さ (%)
uniform float uBandGap; // 帯と帯のすき間の大きさ (%)
uniform float uPlainShare; // 無地の帯の出やすさ (%)
uniform float uStripeShare; // ストライプの帯の出やすさ (%)
uniform float uCheckShare; // 市松の帯の出やすさ (%)。残りは渦
uniform float uStripeDuty; // ストライプの線の太さ (%)
uniform float uCheckWidth; // 市松の幅方向の細かさ (%)
uniform float uCheckLength; // 市松の流れ方向の細かさ (%)
uniform float uDotPitch; // 網点のピッチ (%)
uniform float uDotSize; // 網点ひとつの大きさ (%)
uniform float uRingFreq; // 渦の同心円の細かさ (%)
uniform float uRingTwist; // 渦の角度によるねじれ (%)
uniform float uSunSize; // 太陽の半円の大きさ (%)
uniform float uSunRays; // 太陽の放射線の本数
uniform float uSunRayLen; // 太陽の放射線の長さ (%)
uniform float uSunRayWidth; // 太陽の放射線の太さ (%)
uniform float uEdgeWidth; // 帯の縁の黒線の太さ (%)
uniform float uLineWidth; // 等高線の太さ (%)
uniform float uLineCover; // 等高線が出る領域の広さ (%)
uniform float uFiber; // 紙の繊維の低周波ムラ (%)
uniform float uScratchAmt; // スクラッチの量 (%)
uniform float uSpeckAmt; // 黒い粒の量 (%)
uniform float uVignette; // 周辺減光 (%)
uniform vec3 uInkTint; // 墨 (縁・等高線・輪郭) のティント色
uniform vec3 uCreamTint; // オフホワイト (網点・白抜き・スクラッチ) のティント色
uniform vec3 uSunTint; // 太陽の塗りのティント色
uniform vec3 uLowerTint; // 下のレイヤーの帯の色のティント
uniform vec3 uUpperTint; // 上のレイヤーの帯の色のティント

// ─── 乱数 / ノイズ ────────────────────────────────────────
float fc_h1(float n){ return fract(sin(n*127.1 + uSeed*17.37)*43758.5453); }
float fc_h2(vec2 p){
  p = fract(p*vec2(443.897, 441.423) + uSeed*0.137);
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y)*p.x);
}
float fc_vn(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0 - 2.0*f);
  return mix(mix(fc_h2(i),               fc_h2(i + vec2(1.0, 0.0)), u.x),
             mix(fc_h2(i + vec2(0.0, 1.0)), fc_h2(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fc_fbm(vec2 p){
  const mat2 R = mat2(0.80, 0.60, -0.60, 0.80);
  int   O = int(clamp(uDetail, 1.0, 5.0));
  float a = 0.5, s = 0.0, n = 0.0;
  for(int i = 0; i < 5; i++){
    if(i >= O) break;
    s += a*fc_vn(p);
    n += a;
    p = R*p*2.03 + 17.1;
    a *= 0.5;
  }
  return s / n;
}

// ─── パレット ────────────────────────────────────────────
// 8 種 × 10 色 (FC_PALS[パレット番号*10 + スロット])。スロット 2・3 は太陽の色 (明るい暖色・目立つ色)、6 = 柄の濃色、7 = 柄の淡色
const vec3 FC_PALS[80] = vec3[80](
  // 0: 現行 (くすんだ原色)
  vec3(0.17, 0.29, 0.60), // コバルトブルー
  vec3(0.76, 0.26, 0.17), // 朱赤
  vec3(0.84, 0.47, 0.18), // オレンジ
  vec3(0.83, 0.65, 0.22), // マスタード
  vec3(0.40, 0.29, 0.52), // 紫
  vec3(0.17, 0.33, 0.27), // 深緑
  vec3(0.09, 0.09, 0.11), // 黒
  vec3(0.91, 0.87, 0.78), // オフホワイト
  vec3(0.11, 0.15, 0.27), // 紺
  vec3(0.40, 0.18, 0.20), // 臙脂
  // 1: パステル
  vec3(0.56, 0.69, 0.86), // 水色
  vec3(0.94, 0.62, 0.60), // コーラル
  vec3(0.97, 0.75, 0.55), // ピーチ
  vec3(0.97, 0.88, 0.58), // レモンクリーム
  vec3(0.75, 0.67, 0.87), // ラベンダー
  vec3(0.62, 0.82, 0.71), // ミント
  vec3(0.32, 0.33, 0.41), // 薄墨
  vec3(0.98, 0.96, 0.92), // クリーム
  vec3(0.49, 0.57, 0.75), // ペリウィンクル
  vec3(0.89, 0.66, 0.77), // ローズ
  // 2: モノクロ
  vec3(0.30),
  vec3(0.52),
  vec3(0.82),
  vec3(0.72),
  vec3(0.42),
  vec3(0.20),
  vec3(0.07),
  vec3(0.94),
  vec3(0.13),
  vec3(0.62),
  // 3: 補色 (青 × 橙)
  vec3(0.12, 0.30, 0.64), // コバルト
  vec3(0.91, 0.44, 0.12), // 橙
  vec3(0.96, 0.60, 0.20), // 明るい橙
  vec3(0.98, 0.77, 0.42), // 杏
  vec3(0.27, 0.50, 0.80), // 青
  vec3(0.58, 0.74, 0.89), // 水色
  vec3(0.05, 0.08, 0.15), // 濃紺の黒
  vec3(0.95, 0.92, 0.86), // オフホワイト
  vec3(0.07, 0.15, 0.36), // 紺
  vec3(0.66, 0.28, 0.08), // 焦げ橙
  // 4: ネオン
  vec3(0.05, 0.85, 0.95), // シアン
  vec3(1.00, 0.13, 0.56), // ショッキングピンク
  vec3(1.00, 0.56, 0.05), // 蛍光オレンジ
  vec3(0.94, 0.96, 0.10), // 蛍光イエロー
  vec3(0.62, 0.22, 1.00), // バイオレット
  vec3(0.22, 1.00, 0.38), // 蛍光グリーン
  vec3(0.04, 0.03, 0.08), // 黒
  vec3(0.97, 0.97, 1.00), // 白
  vec3(0.12, 0.28, 1.00), // エレクトリックブルー
  vec3(1.00, 0.16, 0.16), // 赤
  // 5: リソ (蛍光ピンク × 青 × 黄と、その刷り重ね)
  vec3(0.00, 0.47, 0.75), // 青
  vec3(1.00, 0.28, 0.52), // 蛍光ピンク
  vec3(1.00, 0.45, 0.30), // ピンク × 黄
  vec3(1.00, 0.91, 0.00), // 黄
  vec3(0.45, 0.30, 0.62), // ピンク × 青
  vec3(0.00, 0.62, 0.52), // 青 × 黄
  vec3(0.10, 0.10, 0.12), // 黒
  vec3(0.95, 0.93, 0.88), // 紙白
  vec3(0.16, 0.25, 0.56), // フェデラルブルー
  vec3(0.88, 0.20, 0.26), // 赤
  // 6: 海 (寒色)
  vec3(0.10, 0.36, 0.56), // 青
  vec3(0.12, 0.56, 0.60), // ティール
  vec3(0.55, 0.82, 0.86), // アクア
  vec3(0.86, 0.93, 0.88), // 泡
  vec3(0.26, 0.30, 0.56), // 藍
  vec3(0.10, 0.42, 0.40), // 深いティール
  vec3(0.03, 0.07, 0.12), // 深海
  vec3(0.91, 0.95, 0.96), // 白波
  vec3(0.06, 0.16, 0.31), // 紺
  vec3(0.36, 0.62, 0.78), // 空色
  // 7: 夕焼け (暖色)
  vec3(0.36, 0.16, 0.42), // 深紫
  vec3(0.90, 0.30, 0.28), // 珊瑚
  vec3(0.98, 0.60, 0.25), // 夕日
  vec3(0.99, 0.82, 0.40), // 金
  vec3(0.62, 0.22, 0.42), // 赤紫
  vec3(0.78, 0.42, 0.50), // 桃
  vec3(0.12, 0.06, 0.12), // 宵闇
  vec3(0.99, 0.92, 0.82), // 薄明
  vec3(0.22, 0.12, 0.30), // 茄子紺
  vec3(0.58, 0.18, 0.20)  // 臙脂
);
vec3 fc_palI(int i){ return FC_PALS[FC_PAL*10 + min(i, 9)]; }
vec3 fc_pal(float x){ return fc_palI(int(floor(fract(x)*10.0))); }

// 帯 1 本ぶんの柄。band = 帯座標 (整数部 = 帯 ID)、al = 帯に沿う座標、
// r = ワープ後の座標、px = 画素座標 (網点のピッチ用)。返り値 = (色, 不透明度)
// 帯の ID (拍ごとの振り直し込み)。隣の帯の色を引くときにも使う
float fc_id(float b, float layer){
  float id = b + layer*97.0;
  // 拍ごとに一部の帯だけ別の柄・色へ (どの帯が変わるかも拍ごとに違う)
  id += step(fc_h1(id + 211.0 + FC_ROLL*3.1), clamp(uReroll*0.01, 0.0, 1.0)) * FC_ROLL * 31.7 * step(0.5, FC_ROLL);
  return id;
}
// 下のレイヤーの紙地の帯か (1 = 紙地)
float fc_isPaper(float id, float paper){
  return fc_h1(id + 29.3) < 0.30*paper ? 1.0 : 0.0;
}
// 下のレイヤーの帯の地の色 (紙地の帯は紙の色)
vec3 fc_baseCol(float id, float paper){
  return fc_isPaper(id, paper) > 0.5 ? uPaperCol : fc_pal(fc_h1(id + 13.7));
}

// pap = 返す色に含まれる紙の割合 (Slot B で紙を透かすのに使う)
vec4 fc_pattern(float band, float al, vec2 r, vec2 px, float layer, float dens, float paper, out float pap){
  float id  = fc_id(floor(band), layer);
  float mixc = clamp(uMixCol*0.01, 0.0, 1.0);
  float tb  = fract(band);
  float hA  = fc_h1(id);
  float hB  = fc_h1(id + 13.7);
  float hC  = fc_h1(id + 29.3);
  vec3  tintL = layer > 0.5 ? uUpperTint : uLowerTint;
  vec3  c1  = fc_pal(hB) * tintL;
  vec3  c2  = fc_pal(hB + 0.3 + 0.4*hC) * tintL;
  float aa  = fwidth(band) + 1e-4;

  // 上のレイヤーは帯の一部だけを不透明にする (残りは下が透ける)
  float alpha = 1.0;
  if(layer > 0.5){
    alpha = step(hC, 0.36*clamp(uLayer*0.01, 0.0, 2.0));
  } else {
    // 紙地の帯 (下のレイヤーのみ)
    if(hC < 0.30*paper) alpha = 0.0;
  }

  // 混色: 下のレイヤーの紙地の帯も紙色で塗り、隣の帯と溶け合えるようにする
  bool paperBand = layer < 0.5 && alpha < 0.5;
  if(paperBand && mixc > 0.0) alpha = 1.0;

  // 帯ごとの太さムラ: 帯の端を少し削って隙間 (紙地) を作る。混色では隙間を閉じ、上のレイヤーの縁をぼかす
  float gap = (layer > 0.5 ? 0.22 + 0.30*fc_h1(id + 7.7) : 0.06 + 0.10*hC) * (layer > 0.5 ? 1.0 : 1.0 - mixc) * (uBandGap / 100.0);
  float soft = aa*1.5 + (layer > 0.5 ? mixc*0.3 : 0.0);
  alpha *= smoothstep(0.0, soft, tb - gap*0.5) * smoothstep(0.0, soft, 1.0 - gap*0.5 - tb);
  if(layer > 0.5) alpha *= 1.0 - 0.45*mixc;   // 上のレイヤーは半透明にして、重なりの色も混ぜる

  vec3 col;
  float kind = hA;
  float dotP = 0.12*clamp(uDots*0.01, 0.0, 2.0);
  float t1 = dotP + 0.20 * (uPlainShare / 100.0);
  float t2 = t1 + 0.32 * (uStripeShare / 100.0);
  float t3 = t2 + 0.16 * (uCheckShare / 100.0);
  if(kind < dotP){
    // 網点: 帯の中で濃度が流れに沿って変わるハーフトーン
    float pitch = 7.0 * (uDotPitch / 100.0);
    mat2  rt  = mat2(0.7071, 0.7071, -0.7071, 0.7071);
    vec2  g   = rt*px / pitch;
    vec2  cel = fract(g) - 0.5;
    float tone = 0.25 + 0.6*(0.5 + 0.5*sin(al*1.7 + hB*6.28));
    float rad  = sqrt(tone)*0.5*(uDotSize / 100.0);
    float pw   = fwidth(g.x) + 1e-4;
    float dotm = 1.0 - smoothstep(rad - pw, rad + pw, length(cel));
    col = mix(FC_LT * uCreamTint, c1, dotm);
  } else if(kind < t1){
    col = c1;                                                    // 無地
  } else if(kind < t2){
    // 平行ストライプ (帯の縁に平行)
    float k  = floor(2.0 + 5.0*hC) * dens;
    float s  = tb*k;
    float sw = fwidth(s) + 1e-4;
    float duty = 0.5 * (uStripeDuty / 100.0);
    float m  = smoothstep(duty - sw, duty + sw, abs(fract(s) - 0.5)*2.0);
    vec3  c3 = hC > 0.6 ? FC_DK : FC_LT * uCreamTint;
    col = mix(c1, (fract(floor(s)*0.5) > 0.25 && hC > 0.35) ? c2 : c3, m);
  } else if(kind < t3){
    // 市松: 帯の幅方向 × 帯に沿う方向
    vec2  q  = vec2(tb*2.0*(uCheckWidth / 100.0), al*2.5*dens*(uCheckLength / 100.0));
    vec2  qw = fwidth(q) + 1e-4;
    vec2  sq = smoothstep(0.5 - qw, 0.5 + qw, fract(q));
    float m  = abs(sq.x - sq.y);
    col = mix(c1, hB > 0.5 ? FC_DK : FC_LT * uCreamTint, m);
  } else {
    // 同心円の渦: 帯ごとの中心から、角度でねじれたリング
    vec2  cen = vec2(fc_h1(id + 3.1), fc_h1(id + 5.9))*8.0 - 4.0;
    vec2  d   = r - cen;
    float ang = atan(d.y, d.x);
    float s   = (length(d)*3.0*(uRingFreq / 100.0) + ang*0.35*(uRingTwist / 100.0)*(hB - 0.5)*4.0) * dens;
    float sw  = fwidth(s) + 1e-4;
    float m   = smoothstep(0.5 - sw, 0.5 + sw, abs(fract(s) - 0.5)*2.0);
    col = mix(c1, c2, m);
  }

  pap = 0.0;
  if(paperBand && mixc > 0.0){ col = uPaperCol; pap = 1.0; }
  // 混色: 帯の端へ向かって隣の帯の地の色へ寄せる。境目ではちょうど両側の色の半々になってつながる
  if(layer < 0.5 && mixc > 0.0){
    float b0 = floor(band);
    float wP = 0.5*(1.0 - smoothstep(0.0, 0.5, tb));
    float wN = 0.5*smoothstep(0.5, 1.0, tb);
    float iP = fc_id(b0 - 1.0, 0.0), iN = fc_id(b0 + 1.0, 0.0);
    col = mix(col, fc_baseCol(iP, paper), wP*mixc);
    pap = mix(pap, fc_isPaper(iP, paper), wP*mixc);
    col = mix(col, fc_baseCol(iN, paper), wN*mixc);
    pap = mix(pap, fc_isPaper(iN, paper), wN*mixc);
  }

  // 縁の黒線 (一部の帯。混色では消えていく)
  float edgeOn = step(fc_h1(id + 41.0), 0.55*clamp(uEdge*0.01, 0.0, 2.0)) * (1.0 - mixc);
  float e = min(tb - gap*0.5, 1.0 - gap*0.5 - tb);
  float ew = aa*(0.9 + 0.8*hA)*(uEdgeWidth / 100.0);
  float ed = edgeOn*(1.0 - smoothstep(ew*0.6, ew*1.6, e));
  col = mix(col, vec3(0.08, 0.08, 0.10) * uInkTint, ed);
  pap *= 1.0 - ed;
  return vec4(col, alpha);
}

vec3 bg_flowcollage(vec2 fc){
  FC_PAL = int(clamp(floor(uPalette + 0.5), 0.0, 7.0));
  FC_DK  = fc_palI(6);
  FC_LT  = fc_palI(7);
  float bt   = getBeat();
  float kick = uKick * 0.01;
  // 時間: beat モードは拍頭で押し出してから減速 (単調増加。1 拍の量は uBeatFlow)、drone は一定の速さ
  float T, burst;
  if(isFree()){
    T = time;
    burst = 0.0;
  } else {
    float fb = fract(bt);
    T = (floor(bt) + mix(fb, 1.0 - pow(1.0 - fb, 3.0), clamp(kick, 0.0, 1.0))) * 1.5 * uBeatFlow * 0.01;   // 100% = 1 拍で従来の 3 倍流れる
    burst = smoothstep(0.0, 0.08, fb) * pow(1.0 - fb, 3.0) * kick;   // 拍頭で 0 から立ち上げる (拍の境目で飛ばない)
  }
  T *= uSpeed * 0.01;
  float audio = clamp(iAudio, 0.0, 1.0) * kick;

  vec2 I  = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  float sc = 100.0 / max(uScale, 5.0);
  vec2 p  = (I - 0.5*resolution) / resolution.y * 3.0 * sc;
  if(uFieldRotate != 0.0){ float fa = radians(uFieldRotate); p = mat2(cos(fa), -sin(fa), sin(fa), cos(fa)) * p; }
  if(uFieldMirror != 0.0) p.x = abs(p.x - uFieldMirror * 0.02);
  // drone: 場がゆっくり漂う
  // beat : 水をかき混ぜる。拍頭ごとに場所・大きさ・向きが違う渦を入れ、一気にねじる。
  //        渦は 1/4 拍で立ち上がり、そのあとも少し回り続け、2〜4 拍かけて収まる (直近 4 拍分を重ねる)
  if(isFree()){
    p += vec2(0.06, 0.025) * T * uDrift * 0.01;
  } else {
    float n  = floor(bt);
    float st = uJump * 0.01;
    float asp = resolution.x / resolution.y;
    for(int k = 0; k < 4; k++){
      float m   = n - float(k);
      float age = bt - m;
      vec2  c   = (vec2(fc_h1(m*1.31 + 4.0), fc_h1(m*2.17 + 9.0)) - 0.5) * vec2(3.0*asp, 3.0) * sc;
      float R   = (0.9 + 1.4*fc_h1(m*3.7 + 2.0)) * sc;
      float dirS = fc_h1(m*5.3 + 1.0) < 0.5 ? -1.0 : 1.0;
      float ang = dirS * 3.2 * st * (smoothstep(0.0, 0.25, age) + 0.25*age) * (1.0 - smoothstep(1.5, 4.0, age));
      vec2  d   = p - c;
      float a   = ang * exp(-dot(d, d)/(R*R));
      float ca  = cos(a), sa = sin(a);
      p = c + mat2(ca, sa, -sa, ca) * d;
    }
    FC_ROLL = n + 1.0;
    FC_FADE = smoothstep(0.0, 0.25, fract(bt));
  }
  vec2 px = I;                                                   // 網点・粒は画素基準 (ズームで粗くなる)

  // ─── 2 段ドメインワーピング (液体のような流れ) ───
  float t    = T * 0.10;
  float warp = uWarp * 0.01 * (1.0 + 0.45*burst + 0.5*audio);
  vec2 w1 = vec2(fc_fbm(p*0.55 + vec2(0.0, t)),
                 fc_fbm(p*0.55 + vec2(5.2, 1.3) - vec2(t, 0.0)));
  vec2 q  = p + (w1 - 0.5)*2.4*warp;
  vec2 w2 = vec2(fc_fbm(q*0.75 + vec2(1.7, 9.2) + t*0.7),
                 fc_fbm(q*0.75 + vec2(8.3, 2.8) - t*0.6));
  vec2 r  = q + (w2 - 0.5)*1.8*warp;

  float nb    = 3.2 * uBands * 0.01;
  float dens  = uStripe * 0.01;
  float paper = clamp(uPaper * 0.01, 0.0, 2.0);

  // 帯座標: 等値線 + ゆるい方向性 (帯が塊ではなくリボンになる)
  float f1 = fc_fbm(r*0.45 + vec2(t*0.3, 0.0));
  float b1 = (f1*3.5 + (0.22*r.y + 0.06*r.x) * (uBandSlope / 100.0)) * nb;
  float a1 = dot(r, vec2(0.86, -0.50)) + w2.x*2.0;
  float f2 = fc_fbm(r*0.38 + vec2(11.0, 4.0) - t*0.25);
  float b2 = (f2*3.2 + (-0.20*r.x + 0.08*r.y) * (uBandSlope / 100.0)) * nb * 1.1 + 40.0;
  float a2 = dot(r, vec2(0.50, 0.86)) + w2.y*2.0;

  // ─── 合成 ───
  // 紙の成分も並べて追う (Slot B で紙を透かす): pc = 色に含まれる紙の色、wp = 紙の割合
  vec3 col = uPaperCol;
  vec3 pc  = uPaperCol;
  float wp = 1.0;
  float k1, k2;
  vec4 L1 = fc_pattern(b1, a1, r, px, 0.0, dens, paper, k1);
  col = mix(col, L1.rgb, L1.a);
  pc  = mix(pc, uPaperCol*k1, L1.a);
  wp  = mix(wp, k1, L1.a);
  vec4 L2 = fc_pattern(b2, a2, r + 3.7, px, 1.0, dens, paper, k2);
  col = mix(col, L2.rgb, L2.a);
  pc  = mix(pc, uPaperCol*k2, L2.a);
  wp  = mix(wp, k2, L2.a);
  float ink = max(L1.a, L2.a);
  // 振り直しの溶け: 拍の最初の 1/4 だけ前の拍の柄も描いて、そこから溶かす (拍頭で柄が飛ばない)
  if(FC_FADE < 1.0 && uReroll > 0.0){
    FC_ROLL -= 1.0;
    vec3 c0 = uPaperCol;
    vec3 pc0 = uPaperCol;
    float wp0 = 1.0;
    vec4 P1 = fc_pattern(b1, a1, r, px, 0.0, dens, paper, k1);
    c0  = mix(c0, P1.rgb, P1.a);
    pc0 = mix(pc0, uPaperCol*k1, P1.a);
    wp0 = mix(wp0, k1, P1.a);
    vec4 P2 = fc_pattern(b2, a2, r + 3.7, px, 1.0, dens, paper, k2);
    c0  = mix(c0, P2.rgb, P2.a);
    pc0 = mix(pc0, uPaperCol*k2, P2.a);
    wp0 = mix(wp0, k2, P2.a);
    FC_ROLL += 1.0;
    col = mix(c0, col, FC_FADE);
    pc  = mix(pc0, pc, FC_FADE);
    wp  = mix(wp0, wp, FC_FADE);
    ink = mix(max(P1.a, P2.a), ink, FC_FADE);
  }

  // ─── 等高線: 流れに沿う細い黒線 (領域ごとに出たり消えたり) ───
  float lineAmt = uLines * 0.01;
  if(lineAmt > 0.0){
    float h    = fc_fbm(r*0.6 + vec2(2.0, 7.0) + t*0.2) * 9.0 * nb/3.2 + r.y*0.4;
    float hw   = fwidth(h) + 1e-4;
    float dd   = abs(fract(h + 0.5) - 0.5) / hw / (uLineWidth / 100.0);                 // 画素単位の線からの距離
    float gate = smoothstep(0.52, 0.64, fc_vn(r*0.35 + vec2(t*0.2, 3.0)) + 0.12*(lineAmt - 1.0) + uLineCover * 0.003);
    float ln   = (1.0 - smoothstep(0.5, 1.3, dd)) * gate * clamp(lineAmt, 0.0, 1.0);
    // 暗い帯の上では白抜きの線にする
    float lum  = dot(col, vec3(0.299, 0.587, 0.114));
    if(lum < 0.28){
      // 白抜きの線: uWhiteLines 〜100% は濃さ、100% を超えると線が太くなる
      float wl = uWhiteLines*0.01;
      float lw = (1.0 - smoothstep(0.5, 1.3, dd/max(1.0, wl))) * gate * clamp(lineAmt, 0.0, 1.0);
      ln = lw*min(wl, 1.0);
      col = mix(col, vec3(0.90, 0.86, 0.77) * uCreamTint, ln);
    }
    else           col = mix(col, vec3(0.08, 0.08, 0.10) * uInkTint, ln);
    pc *= 1.0 - ln;
    wp *= 1.0 - ln;
  }

  // ─── 太陽モチーフ: 放射線つきの半円 ───
  float sunP = 0.10 * uSuns * 0.01;
  if(sunP > 0.0){
    // ワープの強い r ではなく、ゆるく流した座標で描く (半円が溶けずに漂う)
    float cs   = 1.3;
    vec2  sp   = (p + (w1 - 0.5)*0.5*warp + vec2(t*0.25, t*0.4)) / cs;
    vec2  cell = floor(sp);
    for(int k = 0; k < 4; k++){                                 // 隣接セルもみて端切れを防ぐ
      vec2  cc = cell + vec2(float(k - (k/2)*2), float(k/2)) - 0.5 + step(0.5, fract(sp));
      float hs = fc_h2(cc + 71.3);
      if(hs > sunP) continue;
      vec2  ctr = cc + 0.3 + 0.4*vec2(fc_h2(cc + 2.1), fc_h2(cc + 4.7));
      vec2  d   = (sp - ctr) * cs;
      float an  = fc_h2(cc + 9.9) * 6.2832;
      vec2  dir = vec2(cos(an), sin(an));
      float R   = (0.12 + 0.09*fc_h2(cc + 6.6)) * (uSunSize / 100.0);
      float dl  = length(d);
      float pw  = fwidth(dl) + 1e-4;
      float half_ = smoothstep(-pw, pw, dot(d, dir));
      float disk = (1.0 - smoothstep(R - pw, R + pw, dl)) * half_;
      // 放射線: 半円の外側、半周に短い線
      float th   = atan(dot(d, vec2(-dir.y, dir.x)), dot(d, dir));     // -π..π, 0 = 半円の向き
      float nr   = uSunRays;
      float rs   = (th / 3.1416 * 0.5 + 0.5) * nr * 2.0;
      float rw   = fwidth(rs) + 1e-4;
      float ray  = 1.0 - smoothstep(0.18*(uSunRayWidth / 100.0) - rw, 0.18*(uSunRayWidth / 100.0) + rw, abs(fract(rs) - 0.5));
      ray *= smoothstep(R*1.12 - pw, R*1.12 + pw, dl) * (1.0 - smoothstep(R*(1.75*(uSunRayLen / 100.0)) - pw, R*(1.75*(uSunRayLen / 100.0)) + pw, dl));
      ray *= step(abs(th), 1.5708);
      vec3 sunC = fc_pal(0.2 + 0.1*floor(fc_h2(cc + 8.8)*2.0) + 0.05) * uSunTint;  // オレンジ / マスタード
      col = mix(col, sunC, disk);
      float rim = (1.0 - smoothstep(pw*0.8, pw*2.0, abs(dl - R))) * half_;          // 半円の輪郭
      float rr  = clamp(rim + ray, 0.0, 1.0);
      col = mix(col, vec3(0.08, 0.08, 0.10) * uInkTint, rr);
      pc *= (1.0 - disk)*(1.0 - rr);
      wp *= (1.0 - disk)*(1.0 - rr);
      ink = max(ink, disk);
    }
  }

  // ─── マチエール ───
  float worn = uWorn * 0.01;
  // インクのかすれ: 細かいノイズで刷りが抜け、紙が覗く
  float spk  = fc_vn(px*0.35) * 0.6 + fc_vn(px*0.09 + 13.0) * 0.4;
  float drop = smoothstep(0.86 - 0.08*worn, 0.90 - 0.08*worn, spk) * ink * clamp(worn, 0.0, 1.5);
  drop = clamp(drop, 0.0, 1.0);
  col = mix(col, uPaperCol * 1.05, drop);
  pc  = mix(pc, uPaperCol * 1.05, drop);
  wp  = mix(wp, 1.0, drop);
  // スクラッチ: 細長い異方性ノイズ (紙が覗く扱い)
  float scr  = fc_vn(vec2(px.x*0.012 + px.y*0.004, px.y*0.45));
  float sk   = smoothstep(0.965, 0.995, scr) * clamp(worn, 0.0, 1.5) * 0.7 * (uScratchAmt / 100.0);
  vec3  skC  = vec3(0.93, 0.89, 0.80) * uCreamTint;
  col = mix(col, skC, sk);
  pc  = mix(pc, skC, sk);
  wp  = mix(wp, 1.0, sk);
  // 黒い粒
  float spec = fc_h2(floor(px*0.5) + floor(T*2.0)*0.0);
  float bk   = step(0.9985 - 0.0010*worn, spec) * 0.6 * clamp(worn, 0.0, 1.5) * (uSpeckAmt / 100.0);
  col *= 1.0 - bk;
  pc  *= 1.0 - bk;
  wp  *= 1.0 - bk;
  // 紙のグレイン (画素ノイズ + 繊維の低周波ムラ)
  float gr  = (fc_h2(px) - 0.5) * 0.10 + (fc_vn(px*0.03) - 0.5) * 0.08 * (uFiber / 100.0);
  col *= 1.0 + gr * uGrain * 0.01;
  pc  *= 1.0 + gr * uGrain * 0.01;

  if(uVignette != 0.0){ vec2 vv = (fc - 0.5 * resolution) / resolution.y; float vg = max(1.0 - (uVignette / 100.0) * 0.6 * dot(vv, vv) * 2.0, 0.0); col *= vg; pc *= vg; }

  // 透過: bgAlpha = 紙以外の割合 (Slot に関係なく実カバレッジ)。
  //   Slot A: uBgColor が黒なら紙を敷いたまま (従来の絵)。uBgColor を入れると紙の代わりにその色が敷かれる
  //   Slot B: 紙を透かす。合成 (sampleAB) は straight alpha なので、紙を除いた色を alpha で割って返す
  float cov = clamp(1.0 - wp, 0.0, 1.0);
  bgAlpha = cov;
  vec3 inkP = col - pc;                                          // 紙を除いた色 (alpha 乗算済み)
  if(uSlotIsA > 0.5){
    float paperOn = step(max(uBgColor.r, max(uBgColor.g, uBgColor.b)), 0.004);
    return clamp(paperOn > 0.5 ? col : inkP, 0.0, 1.0);
  }
  return clamp(inkP / max(cov, 1e-3), 0.0, 1.0);
}
