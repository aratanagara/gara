/* ================= Text Deformer (kind:'textdeform') =================
 * Google Drive「text-deformer-presets / text-deform-editor.html」の移植。
 *   元アプリはマウス追従の「レンズ変形」でテキストを変形するエディタ。
 *   VJ 版: 隠しDOMステージにテキストを組版し、仮想ポインタが自動スイープして
 *   文字を変形 → 毎フレーム 2D canvas にラスタライズ → スロット FBO へ転写。
 *   レイアウト計測は DOM を流用(縦書き/折返し/CJK をそのまま活かす)。
 *   変形値はインラインCSS変数から直接読むので getComputedStyle/reflow は毎フレーム発生しない。
 * ==================================================================== */
// 末尾の "Unifont VJ" は全 Unicode をカバーする最終フォールバック (style.css の @font-face)。
// これがあるため、どの書体を選んでも .notdef(豆腐) は出ない。
const TD_UNICODE_FALLBACK = '"Lucida Sans Unicode VJ","Lucida Sans Unicode","Apple Symbols","Noto Sans Symbols 2","Noto Sans Symbols","Segoe UI Symbol","system-ui","Unifont VJ"';
const TD_FONT_UNICODE = TD_UNICODE_FALLBACK + ',sans-serif';
const TD_FONT_ORIGINAL = '"Zen Old Mincho","Hiragino Mincho ProN","Yu Mincho",' + TD_UNICODE_FALLBACK + ',serif';
// 基本の書体 (Adobe Fonts の kit wvw5vyd + 同梱)。欧文 → 和文 → 記号のフォールバック (Unifont VJ まで落ちるので豆腐にならない)
//   明朝 = Garamond (Adobe Garamond Pro → 同梱の EB Garamond) + にじみ明朝 (kit に無ければリュウミン → 游明朝)
//   ゴシック = Aratana (欧文) + 秀英角ゴ銀 (和文)
const TD_GARAMOND = '"adobe-garamond-pro","Adobe Garamond Pro","EB Garamond","Garamond Premier Pro","Garamond"';
const TD_JP_MINCHO = '"nijimi-mincho","にじみ明朝","a-otf-ryumin-pr6n","A-OTF Ryumin Pr6N","Ryumin Pr6N","yu-mincho-pr6n","YuMincho","Yu Mincho","游明朝","Hiragino Mincho ProN"';
const TD_JP_GOTHIC = '"dnp-shuei-gothic-gin-std","DNP Shuei Gothic Gin Std","Hiragino Sans","Noto Sans JP"';
const TD_BASE_MINCHO = TD_GARAMOND + ',' + TD_JP_MINCHO + ',' + TD_UNICODE_FALLBACK + ',serif';
const TD_BASE_GOTHIC = '"Aratana",' + TD_JP_GOTHIC + ',' + TD_UNICODE_FALLBACK + ',sans-serif';
const TD_FONT_MINCHO = TD_BASE_MINCHO;
const TD_FONT_GOTHIC = '"dnp-shuei-gothic-gin-std","DNP Shuei Gothic Gin Std","Zen Kaku Gothic New","Noto Sans JP",' + TD_UNICODE_FALLBACK + ',sans-serif';
// 優先する書体 (Look の書体スタックが基本の書体で始まっていないとき、前に足す。無ければ続く元のスタックに落ちる)。Arial は使わない
const TD_PREF_MINCHO = TD_GARAMOND + ',' + TD_JP_MINCHO;
const TD_PREF_SANS = '"Aratana",' + TD_JP_GOTHIC;
// 共通フォント (全 Look 共通の上書き。P.fontOver)。w = 太さも決めるもの
const TD_FONT_OVER = {
  aratana:   { f: TD_BASE_GOTHIC },
  mincho:    { f: TD_BASE_MINCHO },
  nijimi:    { f: '"nijimi-mincho","にじみ明朝",' + TD_JP_MINCHO + ',serif' },
  yumin:     { f: '"YuMincho","Yu Mincho","游明朝","yu-mincho-pr6n","Hiragino Mincho ProN",serif' },
  ryumin:    { f: '"a-otf-ryumin-pr6n","A-OTF Ryumin Pr6N","Ryumin Pr6N","YuMincho","Yu Mincho","游明朝",serif' },
  shuei:     { f: '"dnp-shuei-gothic-gin-std","DNP Shuei Gothic Gin Std","Hiragino Sans",sans-serif' },
  helvetica: { f: '"Helvetica Neue","Helvetica","dnp-shuei-gothic-gin-std","DNP Shuei Gothic Gin Std",sans-serif', w: 400 },
  helveticaBold: { f: '"Helvetica Neue","Helvetica","dnp-shuei-gothic-gin-std","DNP Shuei Gothic Gin Std",sans-serif', w: 700 },
  garamond:  { f: TD_GARAMOND + ',' + TD_JP_MINCHO + ',serif' },
  ebgaramond: { f: '"EB Garamond",' + TD_JP_MINCHO + ',serif' }
};
const TD_FONT_MONO = '"dnp-shuei-gothic-gin-std","Space Mono",' + TD_UNICODE_FALLBACK + ',"Noto Sans JP",monospace';
// Look が持つキー (色・書体・組版・変形)。版面の位置・倍率 (stageW / marginPct / fitMode / zoom / panX / panY) と文字は持たない
const TD_LOOK_KEYS = ['paper','ink','accent','accentRatio','fontFamily','fontWeight','fontSize','lineHeight','letterSpacing','vertical','randomLaw','rotation','randomness','geoRatio','stretchX','stretchY','flipRate',
  'rotateAngle','skewX','skewY','baselineShift','mirrorX','mirrorY','misregX','misregY','misregColorA','misregColorB','confuseDepth','opChance','gridEnabled','gridCols','gridCell','gridGap',
  'showPct','sizeVar','scatter','tremor','waveAmp','waveLen','lineStagger','slant','swirl','bulge','viewAngle','pivotX','pivotY','stepSize','misregAlpha','misregRatio','trailPct','accentOnMove','rainbow','rainbowSpan','vignette','vignetteColor','grain','grainSize'];

/* ---- Confuse operator: 類字置換の Core 辞書 (元アプリの graded lookalike dictionary 移植) ----
 * Tier 1: 同一文字の形態バリエーション (全角・濁点・小書き・旧字体)
 * Tier 2: 同スクリプトの類字 (ひら⇄カタ・類似漢字・数学英字スタイル)
 * Tier 3: 異スクリプト・装飾 (ギリシャ・キリル・丸囲み・漢字⇄カタカナ)
 * ソーステキストは変更せず、描画グリフだけ差し替える。 */
const TD_CONFUSE_KYUJITAI =
  '亜亞悪惡圧壓囲圍医醫為爲壱壹隠隱栄榮営營衛衞駅驛円圓塩鹽応應桜櫻奥奧横橫温溫価價会會絵繪拡擴学學楽樂勧勸観觀帰歸気氣亀龜旧舊拠據挙擧区區駆驅径徑恵惠継繼鶏鷄芸藝剣劍権權険險圏圈顕顯験驗厳嚴広廣恒恆鉱鑛号號国國済濟斎齋剤劑惨慘賛贊残殘糸絲歯齒児兒辞辭実實写寫舎舍釈釋寿壽収收従從渋澁獣獸縦縱処處緒緖将將焼燒証證乗乘条條浄淨状狀畳疊譲讓触觸嘱囑真眞粋粹酔醉数數声聲静靜斉齊摂攝専專戦戰浅淺銭錢潜潛禅禪曽曾双雙壮壯争爭荘莊捜搜巣巢装裝総總蔵藏臓臟属屬続續対對体體帯帶滞滯台臺滝瀧択擇沢澤単單担擔胆膽団團断斷弾彈遅遲昼晝虫蟲鋳鑄庁廳聴聽鎮鎭転轉点點伝傳灯燈当當党黨盗盜稲稻闘鬪徳德独獨読讀弐貳悩惱脳腦廃廢拝拜売賣麦麥発發髪髮抜拔蛮蠻浜濱払拂仏佛変變辺邊宝寶豊豐没沒満滿万萬黙默訳譯薬藥予豫余餘与與誉譽様樣謡謠来來頼賴乱亂覧覽竜龍両兩塁壘涙淚励勵礼禮霊靈齢齡恋戀労勞楼樓録錄湾灣';
const TD_CONFUSE_SIMILAR_KANJI = [
  '土士', '未末', '己已巳', '人入', '大太', '曰日', '王玉', '千干', '天夭',
  '石右', '微徴', '遣遺', '密蜜', '崇祟', '荻萩', '板坂', '拍柏', '縁緑',
  '積績', '講構', '清晴', '週周', '陳陣', '職織識', '復複', '幸辛', '若苦',
  '爪瓜', '鳥烏', '兎免', '眠眼', '困因', '刀刃', '矢失', '句旬', '斤斥',
  '木本', '水氷', '白百', '牛午', '休体', '侍待', '住往'
];
const TD_CONFUSE_KATA_KANJI = '口ロ二ニ力カ工エ夕タ卜ト八ハ千チ';
const TD_CONFUSE_VOICE_PAIRS =
  'かがきぎくぐけげこごさざしじすずせぜそぞただちぢつづてでとどはばひびふぶへべほぼ' +
  'カガキギクグケゲコゴサザシジスズセゼソゾタダチヂツヅテデトドハバヒビフブヘベホボウヴ' +
  'はぱひぴふぷへぺほぽハパヒピフプヘペホポ';
const TD_CONFUSE_SMALL_KANA = {
  'あ': 'ぁ', 'い': 'ぃ', 'う': 'ぅ', 'え': 'ぇ', 'お': 'ぉ', 'つ': 'っ', 'や': 'ゃ', 'ゆ': 'ゅ', 'よ': 'ょ', 'わ': 'ゎ',
  'ア': 'ァ', 'イ': 'ィ', 'ウ': 'ゥ', 'エ': 'ェ', 'オ': 'ォ', 'ツ': 'ッ', 'ヤ': 'ャ', 'ユ': 'ュ', 'ヨ': 'ョ', 'ワ': 'ヮ', 'カ': 'ヵ', 'ケ': 'ヶ'
};
const TD_CONFUSE_HALF_KATA = {
  'ア': 'ｱ', 'イ': 'ｲ', 'ウ': 'ｳ', 'エ': 'ｴ', 'オ': 'ｵ', 'カ': 'ｶ', 'キ': 'ｷ', 'ク': 'ｸ', 'ケ': 'ｹ', 'コ': 'ｺ',
  'サ': 'ｻ', 'シ': 'ｼ', 'ス': 'ｽ', 'セ': 'ｾ', 'ソ': 'ｿ', 'タ': 'ﾀ', 'チ': 'ﾁ', 'ツ': 'ﾂ', 'テ': 'ﾃ', 'ト': 'ﾄ',
  'ナ': 'ﾅ', 'ニ': 'ﾆ', 'ヌ': 'ﾇ', 'ネ': 'ﾈ', 'ノ': 'ﾉ', 'ハ': 'ﾊ', 'ヒ': 'ﾋ', 'フ': 'ﾌ', 'ヘ': 'ﾍ', 'ホ': 'ﾎ',
  'マ': 'ﾏ', 'ミ': 'ﾐ', 'ム': 'ﾑ', 'メ': 'ﾒ', 'モ': 'ﾓ', 'ヤ': 'ﾔ', 'ユ': 'ﾕ', 'ヨ': 'ﾖ',
  'ラ': 'ﾗ', 'リ': 'ﾘ', 'ル': 'ﾙ', 'レ': 'ﾚ', 'ロ': 'ﾛ', 'ワ': 'ﾜ', 'ヲ': 'ｦ', 'ン': 'ﾝ', 'ー': 'ｰ'
};
const TD_CONFUSE_GREEK = {
  'a': 'α', 'e': 'ε', 'i': 'ι', 'k': 'κ', 'n': 'η', 'o': 'ο', 'p': 'ρ', 't': 'τ', 'u': 'υ', 'v': 'ν', 'w': 'ω', 'x': 'χ', 'y': 'γ',
  'A': 'Α', 'B': 'Β', 'E': 'Ε', 'H': 'Η', 'I': 'Ι', 'K': 'Κ', 'M': 'Μ', 'N': 'Ν', 'O': 'Ο', 'P': 'Ρ', 'T': 'Τ', 'X': 'Χ', 'Y': 'Υ', 'Z': 'Ζ'
};
const TD_CONFUSE_CYRILLIC = {
  'a': 'а', 'c': 'с', 'e': 'е', 'o': 'о', 'p': 'р', 'x': 'х', 'y': 'у', 's': 'ѕ', 'i': 'і', 'j': 'ј',
  'A': 'А', 'B': 'В', 'C': 'С', 'E': 'Е', 'H': 'Н', 'K': 'К', 'M': 'М', 'O': 'О', 'P': 'Р', 'T': 'Т', 'X': 'Х', 'S': 'Ѕ', 'I': 'І', 'J': 'Ј'
};
const TD_CONFUSE_MATH_STYLES = [
  { upper: 0x1D400, lower: 0x1D41A, holes: {} }, // bold
  { upper: 0x1D504, lower: 0x1D51E, holes: { 'C': 'ℭ', 'H': 'ℌ', 'I': 'ℑ', 'R': 'ℜ', 'Z': 'ℨ' } }, // fraktur
  { upper: 0x1D538, lower: 0x1D552, holes: { 'C': 'ℂ', 'H': 'ℍ', 'N': 'ℕ', 'P': 'ℙ', 'Q': 'ℚ', 'R': 'ℝ', 'Z': 'ℤ' } }, // double-struck
  { upper: 0x1D49C, lower: 0x1D4B6, holes: { 'B': 'ℬ', 'E': 'ℰ', 'F': 'ℱ', 'H': 'ℋ', 'I': 'ℐ', 'L': 'ℒ', 'M': 'ℳ', 'R': 'ℛ', 'e': 'ℯ', 'g': 'ℊ', 'o': 'ℴ' } }, // script
  { upper: 0x1D670, lower: 0x1D68A, holes: {} } // monospace
];
const TD_CONFUSE_PUNCT = {
  '。': { t1: ['｡', '．'], t3: ['○', '◦'] },
  '、': { t1: ['､', '，'], t3: ['‚'] },
  '・': { t1: ['･'], t3: ['∙', '•'] },
  'ー': { t2: ['−', '–'], t3: ['—', '一'] },
  '「': { t1: ['｢'], t2: ['『'] },
  '」': { t1: ['｣'], t2: ['』'] },
  '！': { t1: ['!'], t3: ['ǃ'] },
  '？': { t1: ['?'], t3: ['ʔ'] },
  '!': { t1: ['！'], t3: ['ǃ'] },
  '?': { t1: ['？'], t3: ['ʔ'] },
  '.': { t1: ['．'], t3: ['·'] },
  ',': { t1: ['，'], t3: ['‚'] }
};
const TD_CONFUSE_SUPERSCRIPT_DIGITS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
function tdConfusePairLookup(packed, ch){
  const out = [];
  for(let i=0; i<packed.length; i+=2){
    if(packed[i] === ch) out.push(packed[i+1]);
    else if(packed[i+1] === ch) out.push(packed[i]);
  }
  return out;
}

const TextDeform = {
  initialized: false,
  gl: null,

  // ---- パラメータ(元 params + VJ 追加) ----
  P: {
    // 変形(元アプリ)
    stretchX: 1, stretchY: 1, radius: 56, ease: 0.34, geoRatio: 0.32,
    randomness: 1, rotation: 0, seed: 1, mode: 'flow', randomLaw: 'scatter',
    // 組版
    fontFamily: TD_FONT_MINCHO,
    fontSize: 60, lineHeight: 1.15, letterSpacing: -0.02,
    vertical: false, accentRatio: 0.06, fontWeight: 400,
    ink: '#17140f', paper: '#f4f3ef', accent: '#c41f1f',
    // Operator (元アプリの Operator system 移植。0 で無効、文字が動くたび opChance の確率で乗る)
    rotateAngle: 0,      // 回転 deg (最大値。文字ごとに±ランダム)
    skewX: 0, skewY: 0,  // シアー deg
    baselineShift: 0,    // ベースラインずらし em (縦組では左右)
    mirrorX: 0, mirrorY: 0,   // 鏡映量 0..1 (1 で完全反転)
    misregX: 0, misregY: 0,   // 版ずれ px (2色のインクずれ刷り)
    misregColorA: '#c41f1f', misregColorB: '#1767a6',
    confuseDepth: 0,     // 類字置換の深さ 0..1 (浅=形態違い → 深=異スクリプト)
    confuseMixed: true,  // 異スクリプト置換(Tier3)を許可
    opChance: 0.6,       // 各 Operator が文字に乗る確率
    // グリッド組版 (InDesign風グリッドの簡略版)
    gridEnabled: false,
    gridCols: 12,        // 横組=1行のマス数 / 縦組=1列のマス数
    gridCell: 0,         // マスの px (0 = fontSize から自動)
    gridGap: 0,          // マス間 px
    // 見た目の追加 param (第 2 弾)。既定で従来と同じ絵 (0 / 100 / 元の定数)
    showPct: 100,        // 文字を描く割合 % (低いほど抜ける。添字ハッシュで固定)
    sizeVar: 0,          // 文字ごとの大きさのばらつき % (一様拡縮)
    scatter: 0,          // 文字ごとの固定オフセット (文字サイズ比 %)
    tremor: 0,           // 12Hz で震える量 (文字サイズ比 %)
    waveAmp: 0, waveLen: 10,   // 字送り方向に沿ったうねり: 振れ幅 (文字サイズ比 %) / 波長 (em)
    lineStagger: 0,      // 行ごとの字送り方向のずれ (文字サイズ比 %、sin(行) で揺らす)
    slant: 0,            // 全文字の斜体 deg (Operator の skewX とは別に常時)
    swirl: 0,            // 版面中心からの渦 deg (外周ほど回る)
    bulge: 0,            // 版面中心からの膨らみ/すぼみ % (外周ほど大きく動く + 文字も拡縮)
    viewAngle: 0,        // 版面全体の回転 deg
    pivotX: 50, pivotY: 75,   // 変形 (伸び・回転・鏡映) の支点 (文字枠内 %)
    stepSize: 100,       // 段階的な伸びの刻み幅 % (geo の文字)
    misregAlpha: 72, misregRatio: 65,   // 版ずれ: 刷りの濃さ % / B 版の戻り量 % (A のオフセット比)
    trailPct: 0,         // 残像 % (紙の塗りを薄くして前フレームを残す)
    accentOnMove: 0,     // 動いている文字を accent 色に寄せる量 %
    rainbow: 0, rainbowSpan: 360,   // 文字ごとの虹色 %: 混ぜる量 / 版面全体で回す色相 deg
    vignette: 0, vignetteColor: '#000000',   // 周辺減光 % / 色
    grain: 0, grainSize: 100,        // フィルムグレイン % / 粒の大きさ %
    compAudio: 0,                    // Composition を音で動かす量 (0..1。mode/textdeform-comp.js の audioDrive)
    // レイアウト(スロットに合わせる)
    marginPct: 8, transparentBg: false, fitMode: 'fit', zoom: 1, panX: 0, panY: 0,
    // VJ 駆動
    autoSpeed: 3.0,      // bloom時の追従速度
    flipMin: 0.05,       // 各文字が次に動き出すまでの最短秒
    flipRange: 0.9,      // その揺らぎ幅(各文字が独立ランダムに on/off)
    flipRate: 1.4,       // 全体の動き出し頻度(大きいほど頻繁)
    beatPulse: 0.6,      // 拍で脈動させる量 (Rhythm。beat モード、または rhythmBpm で無音のとき)
    typeOn: 'off', typeSpeed: 2, typeHold: 4,   // 一文字ずつ入力 (全 Look 共通): off / on、1 拍あたりの文字数、全文を見せたまま待つ拍数 (0 = そのまま)
    rhythmMotion: 1,     // Rhythm: 動きの量 (全 Look 共通の倍率。Look の値ではない)
    rhythmAudio: 0.6,    // Rhythm: 音の立ち上がりで脈動させる量
    rhythmBpm: true,     // Rhythm: 無音 (音声入力 Off を含む) でも BPM の拍で脈動させる (drone モードでも)
    palOn: false,        // false / true (3 色固定) / 'paper' (背景だけ固定)        // 共通パレット (全 Look 共通): On なら紙・インク・アクセントを下の色で上書きする (Look の色は書き換えない)
    palPaper: '#f2efe8', palInk: '#111111', palAccent: '#ff3b1f',
    fontOver: '',        // 共通フォント (全 Look 共通): '' = Off (各 Look の書体) / TD_FONT_OVER のキー
    comScaleX: 1, comScaleY: 1,   // 共通の文字の縦横比: 出来上がった版面を横 / 縦に伸ばす倍率 (1 = 等倍)
    comTrack: 0,         // 共通の字間の加算 (em。各 Look の字間に足す)
    comLeading: 1,       // 共通の行送りの倍率 (各 Look の行送りに掛ける)
    canvasOn: false,     // Canvas (全 Look 共通): Look をスタンプのように複数置く。mode/textdeform-canvas.js
    canvasStamps: [],    // [{ look, text, x, y, s, rot, z, seed }] (x, y = 画面の 0..1)
    canvasSource: 'current',   // 押す Look: current = いまの Look / random = Look Pool からランダム
    canvasMax: 12,
    canvasAutoAdd: 0, canvasAutoSwap: 4, canvasAutoClear: 0,   // Canvas の拍の自動 (拍ごと。0 = Off): 自動で押す / Look を差し替える / 一掃
    canvasAutoLayout: 16,   // Canvas: この拍数ごとに別のレイアウトへ組み替える (0 = Off)
    canvasLayout: 'hero',
    // Canvas のスタンプごとのばらつき (var。0 = そろえる。スタンプの seed から決まるので、同じスタンプはいつも同じ向きにばらける)
    cvSize: 0, cvRot: 0, cvPos: 0, cvStretch: 0, cvOpacity: 0, cvHue: 0, cvDrift: 0, cvSpeed: 0, cvAspect: 0, cvTrack: 0, cvLeading: 0, cvReact: 0,   // Canvas のレイアウト: hero / grid / diagonal / frame / cascade / scatter
    canvasPlate: 'auto',
    canvasMainFx: false,    // Canvas の間も本体の Look の周辺減光・グレインを画面全体に掛けるか (既定 Off)
    canvasMove: 'glide',    // Canvas のスタンプの動き: glide = 新しい位置へなめらかに移り、漂う / jump = 瞬間的に置き直す (漂わない)
    canvasJumpEvery: 0,     // この拍数ごとに全スタンプをランダムな位置へ置き直す (0 = Off。大きさ・角度はそのまま)
    canvasTiming: 'sync',   // Canvas のスタンプの出かた: sync = まとめて / gun = 拍の刻みごとに 1 枚ずつ (Manga のマシンガン)
    canvasGunDiv: 4,        // gun: 1 拍に何枚撃つか (1 / 2 / 4 / 8)
    canvasGunOrder: 'layout',   // gun の順番: layout = 大きい順 / random / sweep = 左から
    canvasFull: 'live',     // Canvas の Look の完全再現: live = 置いたとき焼き付け + 順番に描き直す / bake = 置いたときだけ / off = 分身のまま
    canvasFullEvery: 300,   // live の描き直しの間隔 (ms。1 枚ずつ順番に。fps が 45 を切ったら間引く)    // Canvas の文字の見えにくさ対策: auto / paper / shadow / off       // 置ける数 (超えたら古いものから消える。最大 24)
    vecMode: 'off',      // Vector 3D (全 Look 共通・試作): off / fill / wire / points / wirepts。mode/textdeform-vector.js
    vecSpin: 25, vecTilt: 15, vecWave: 0.4, vecAudio: 0.6, vecDepth: 0.5, vecDetail: 3, vecLine: 1.2,
    compRandEvery: 0,    // Comp Random (全 Look 共通): この間隔ごとに Composition をランダムに切り替える (0 = Off)
    compRandUnit: 'beat',   // その単位: beat = 拍 / sec = 秒
    bloomChance: 0.10,   // リターゲット時に構成的な一斉スイープ(bloom)を発動する確率
    // Look (mode/textdeform-looks.js)。look = 'f:<上流プリセット id>' / 's:<保存 Look の名前>' / '' (未選択)
    look: '',
    lookEvery: 0,        // Look Auto: この拍数ごとに Look を引き直す (0 = Off)
    lookPool: 'all',     // Look の一覧・Random・Auto の対象: all / recommended (オススメ) / presets (全プリセット) / saved / 上流の family id
    lookRand: 'recommended',   // ランダム (🎲・Look Auto・Canvas のスタンプ選び) でプリセットから選ぶ範囲: off = ランダムを切る / recommended = オススメだけ / all = 全プリセット
    // 文字の出どころ: look = Look の文字 / random = テキストプリセットから textEvery 拍ごと / custom = textCustom
    textMode: 'look', textPool: 'all', textEvery: 4, textCustom: '',
    stageW: 960,         // 隠しステージの CSS 幅(組版の折返し基準)
    text: 'FORM'
  },
  PDefaults: null,

  // ================= GL =================
  VS: `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main(){ v_uv = vec2(a_pos.x*0.5+0.5, 0.5 - a_pos.y*0.5); gl_Position = vec4(a_pos,0.0,1.0); }`,
  FS: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 frag; uniform sampler2D u_tex; uniform vec2 u_sc;
// u_sc = 共通の文字の縦横比 (comScaleX / Y)。版面の中心から伸ばし、はみ出した外側は隅の色 (紙 / 透明) で埋める
void main(){
  vec2 uv = (v_uv - 0.5) / u_sc + 0.5;
  if(any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) uv = vec2(0.001);
  frag = texture(u_tex, uv);
}`,

  init(gl){
    if(this.initialized) return true;
    this.gl = gl;

    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, this.VS); gl.compileShader(vs);
    if(!__glReady(gl, vs, false)){ console.error('TextDeform vs:', gl.getShaderInfoLog(vs)); return false; }
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, this.FS); gl.compileShader(fs);
    if(!__glReady(gl, fs, false)){ console.error('TextDeform fs:', gl.getShaderInfoLog(fs)); return false; }
    this.prog = gl.createProgram();
    gl.attachShader(this.prog, vs); gl.attachShader(this.prog, fs); gl.linkProgram(this.prog);
    if(!__glReady(gl, this.prog, true)){ console.error('TextDeform link:', gl.getProgramInfoLog(this.prog)); return false; }
    this.locPos = gl.getAttribLocation(this.prog, 'a_pos');
    this.locTex = gl.getUniformLocation(this.prog, 'u_tex');
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([244,243,239,255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 2; this.canvas.height = 2;
    this.ctx = this.canvas.getContext('2d');

    // Confuse 用キャッシュ + グリフ確認ラスタ (フォント未収録の豆腐を弾く)
    this._confuseCache = Object.create(null);
    this._glyphRasterCache = Object.create(null);
    this._missingRasterCache = Object.create(null);
    this._rasterCanvas = document.createElement('canvas');
    this._rasterCanvas.width = this._rasterCanvas.height = 72;
    this._rasterCtx = this._rasterCanvas.getContext('2d', { willReadFrequently: true });

    this._mountDOM();
    this._ensureFonts();
    this._t = 0;
    this._pointer = { x: 0, y: 0 };
    this._createSpans(this.P.text);

    this.initialized = true;
    return true;
  },

  // 隠しステージ + フォント + グリフCSS
  _mountDOM(){
    if(this._stage) return;
    const wrap = document.createElement('div');
    wrap.setAttribute('data-textdeform', '1');
    // 画面外だが layout は保持(offsetLeft/Width が取れる状態)
    wrap.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none;opacity:0;z-index:-1;';
    const stage = document.createElement('div');
    stage.className = 'td-stage';
    wrap.appendChild(stage);
    document.body.appendChild(wrap);
    const st = document.createElement('style');
    st.textContent =
      '.td-stage{ box-sizing:border-box; color:#17140f; position:relative; font-kerning:normal; font-variant-east-asian:proportional-width; font-feature-settings:"palt" 1,"kern" 1; text-rendering:optimizeLegibility; line-break:strict; }' +
      '.td-stage p{ margin:0 0 0.55em; }' +
      '.td-stage.vertical{ writing-mode:vertical-rl; text-orientation:mixed; }' +
      '.td-stage.vertical p{ margin:0 0.55em 0 0; }' +
      '.td-stage .c{ display:inline-block; --ix:1; --iy:1;' +
      '  transform:translateX(var(--tx,0)) translateY(var(--ty,0)) rotate(var(--rot,0deg)) scale(var(--sx,1),var(--sy,1)) scale(var(--ix,1),var(--iy,1));' +
      '  transform-origin:50% 75%; }' +
      '.td-stage .c.punct{ margin-left:-0.03em; margin-right:-0.03em; }';
    document.head.appendChild(st);
    this._stageWrap = wrap; this._stage = stage; this._styleEl = st;
  },

  _ensureFonts(){
    this._ensureAdobeFonts();
    if(document.getElementById('td-gfonts')) return;
    try{
      const l = document.createElement('link');
      l.id = 'td-gfonts'; l.rel = 'stylesheet';
      l.href = 'vendor/gfonts.css';   // 同梱 (完全オフライン対応。CDN 参照をローカル woff2 へ差し替え済み)
      document.head.appendChild(l);
      if(document.fonts){
        try{ document.fonts.load('400 48px "Lucida Sans Unicode VJ"').then(()=>{ this._layoutDirty = true; }); }catch(e){}
        if(document.fonts.ready){ document.fonts.ready.then(()=>{ this._refreshGlyphSupport(); }); }
      }
    }catch(e){}
  },

  // Adobe Fonts は index.html の kit (wvw5vyd) が読み込む。書体が届いたら豆腐判定 (描けない字の置き換え) をやり直す
  _ensureAdobeFonts(){
    if(this._adobeHooked || !document.fonts) return;
    this._adobeHooked = true;
    let tm = null;
    document.fonts.addEventListener('loadingdone', ()=>{ clearTimeout(tm); tm = setTimeout(()=>this._refreshGlyphSupport(), 200); });
  },

  // ================= テキスト/組版 =================
  setText(text){
    this.P.text = text;
    this._applyStageStyle();
    this._createSpans(text);
  },

  // Canvas の焼き付け中なら中断して本体の Look に戻してから書く (焼き終わりの戻しで、書いた値が消えないように)
  _endBake(){ if(typeof TDCanvas !== 'undefined' && TDCanvas._bake) TDCanvas.cancelBake(); },
  setParams(over){
    this._endBake();
    Object.assign(this.P, over || {});
    if(!this.initialized) return;
    this._applyStageStyle();
    // フォント/サイズが変わると組版が変わるので作り直す
    this._createSpans(this.P.text);
  },

  // ================= 文字の出どころ =================
  // P.textMode: look = Look の文字 (上流プリセットの語。保存 Look は文字を持たないので今の文字のまま) /
  //   random = テキストプリセット (mode/textdeform-texts.js) から P.textEvery 拍ごと / custom = P.textCustom。
  // Look (色・書体・Surface) とは独立で、文字が変わっても Look は変わらない
  setTextSource(over){
    this._endBake();
    Object.assign(this.P, over || {});
    if(over && ('textPool' in over || 'textMode' in over)) this._randText = null;
    this._applyTextSource();
  },
  // P.textPool = 使う種類 (カンマ区切りで複数。'all' = 長文以外の全部)。古い保存データの 1 つだけの値もそのまま読める
  textPools(){
    const a = String(this.P.textPool || 'all').split(',').map(s=>s.trim()).filter(Boolean);
    return a.length ? a : ['all'];
  },
  textPool(){
    const g = this.textPools(), T = (typeof TD_TEXT_PRESETS !== 'undefined') ? TD_TEXT_PRESETS : [];
    const out = [];
    // All は長文を含めない (Surface が重くなり、字も小さくなる)。長文は Pool で選んだときだけ
    for(const x of T) if(g.includes(x.group) || (g.includes('all') && x.group !== 'long')) out.push(...x.items);
    return out;
  },
  _pickRandomText(){
    const pool = this.textPool();
    if(!pool.length) return null;
    let t = pool[0];
    for(let k = 0; k < 6; k++){ t = pool[Math.floor(Math.random()*pool.length)]; if(t !== this.P.text) break; }
    return t;
  },
  // いまの P.textMode で表示する文字 (lookText = Look が持つ文字)
  _sourceText(){
    const P = this.P;
    if(P.textMode === 'custom' && String(P.textCustom || '').trim()) return String(P.textCustom);
    if(P.textMode === 'random') return this._randText || (this._randText = this._pickRandomText()) || P.text;
    return this._lookText || P.text;
  },
  _applyTextSource(){
    if(!this.initialized) return;
    const t = this._sourceText();
    if(t !== this.P.text) this.setText(t);
  },
  nextRandomText(){
    this._endBake();
    this._randText = this._pickRandomText();
    this._applyTextSource();
  },

  // ================= Look =================
  // Look = 色・書体・組版・変形 (TD_LOOK_KEYS) + Surface (P.surf)。Composition (P.comp) は Look に含めない (Text のように独立。Look を当てても変わらない)。
  // 選び方・一覧・Auto は mode/textdeform-looks.js (TDLooks)。ここは P へ当てる処理だけ。
  //   over: TD_LOOK_KEYS の値 (無いキーは既定値へ戻す)。text: Look の文字 ('' なら今の文字のまま)
  applyLookStyle(over, text){
    this._endBake();
    const D = this.PDefaults || {};
    const P = this.P;
    for(const k of TD_LOOK_KEYS) P[k] = JSON.parse(JSON.stringify(over && over[k] !== undefined ? over[k] : D[k]));
    this._lookText = text || '';
    this._bloomUntil = 0; this._nextBloomCheck = 0;
    this._applyStageStyle();
    const t = this._sourceText();
    this.setText(t);
  },
  // P の値 (保存デフォルト・状態の復元・Undo の後) を描画へ反映する。Surface / Composition は P.surf / P.comp の
  // アクセサ (各モジュールが定義) が代入の時点で反映済み
  applyP(){
    if(!this.initialized) return;
    this._randText = null;
    this._applyStageStyle();
    this._createSpans(this.P.text);
    // Look が空 (保存デフォルトの無い Reset / R / Esc) なら既定の Look を当てる (素の文字だけに戻さない)
    if(!this.P.look && typeof TDLooks !== 'undefined') TDLooks.start();
  },
  // 保存・Undo 用の P。Canvas がスタンプの Look を焼き付けるために本体の Look を一時的に替えているあいだは、控えた本体の Look を返す
  stateP(){
    const b = (typeof TDCanvas !== 'undefined') ? TDCanvas._bake : null;
    if(!b) return this.P;
    const o = JSON.parse(JSON.stringify(this.P)), s = b.saved;
    Object.assign(o, JSON.parse(JSON.stringify(s.style)), { text: s.text, look: s.look, surf: s.surf });
    return o;
  },
  // Canvas の主役スタンプ: 本体の Look を (Surface / Vector 3D ごと) w×h の透明な別キャンバスに描いて返す
  _renderHero(w, h, zoomMul){
    const cv = this._heroCv || (this._heroCv = document.createElement('canvas'));
    const hctx = this._heroCtx || (this._heroCtx = cv.getContext('2d'));
    const keep = { canvas: this.canvas, ctx: this.ctx, fit: this._fit, bg: this.P.transparentBg, zoom: this.P.zoom };
    this.canvas = cv; this.ctx = hctx; this._heroPass = true; this.P.transparentBg = true; this._fitDirty = true;
    if(zoomMul) this.P.zoom = (+keep.zoom || 1) * zoomMul;   // 伸び縮みで切れないよう広く描くぶん縮める (TDCanvas.draw)
    try{ this._renderToCanvas(w, h); }
    finally{
      this.canvas = keep.canvas; this.ctx = keep.ctx; this._fit = keep.fit; this.P.transparentBg = keep.bg; this.P.zoom = keep.zoom;
      this._heroPass = false; this._fitDirty = true;
    }
    return cv;
  },
  // Slot に読み込まれたとき (app.js の loadPreset)
  start(){
    this._t = 0;
    this._bloomUntil = 0; this._nextBloomCheck = 0;
    this._textSlot = null;
    if(typeof TDLooks !== 'undefined'){ TDLooks._autoSlot = null; TDLooks.load(); }
    this.applyP();   // Look が未選択なら既定の Look を当てる
  },

  _fontStack(fontFamily){
    let f = fontFamily || TD_FONT_MINCHO;
    if(this.P.fontOver && TD_FONT_OVER[this.P.fontOver] && f === TD_FONT_OVER[this.P.fontOver].f) return f.replace(/,\s*(serif|sans-serif)\s*$/i, ',' + TD_UNICODE_FALLBACK + ',$1');
    if(/^\s*["']?Lucida Sans Unicode/.test(f)) return f;   // 記号用の Lucida Unicode を先頭に選んだときだけそのまま (末尾のフォールバックの Lucida は対象外)
    f = this._preferFonts(f);
    const patched = String(f).replace(/,\s*(serif|sans-serif|monospace)\s*$/i, ',' + TD_UNICODE_FALLBACK + ',$1');
    return patched === String(f) ? String(f) + ',' + TD_UNICODE_FALLBACK : patched;
  },

  // 書体スタックの末尾の総称 (serif / sans-serif) で基本の書体を前に足す。monospace はそのまま。
  // 明朝 = Garamond + にじみ明朝、ゴシック = Aratana + 秀英角ゴ銀
  _preferFonts(f){
    const fams = String(f).split(',').map(x=>x.trim()).filter(Boolean);
    const generic = (fams[fams.length - 1] || '').toLowerCase();
    if(generic === 'sans-serif'){
      const rest = fams.filter(x=>!/^["']?Arial( Black)?["']?$/i.test(x));
      if(/^["']?(Aratana|Helvetica)/i.test(rest[0] || '')) return rest.join(',');   // 優先書体から始まるスタック (Look のデータ) はその順のまま
      return TD_PREF_SANS + ',' + rest.join(',');
    }
    if(generic !== 'serif') return fams.join(',');
    if(/^["']?(adobe-garamond-pro|YuMincho)/i.test(fams[0])) return fams.join(',');
    if(/Garamond/i.test(fams[0])) return [TD_GARAMOND, TD_PREF_MINCHO].concat(fams.slice(1)).join(',');
    return TD_PREF_MINCHO + ',' + fams.join(',');
  },

  _applyStageStyle(){
    const P = this.P, s = this._stage;
    if(!s) return;
    s.style.width = P.stageW + 'px';
    s.style.fontFamily = this._fontStack(this.family());
    s.style.fontSize = P.fontSize + 'px';
    s.style.fontWeight = this.weight();
    s.style.lineHeight = this.leading();
    s.style.letterSpacing = this.track() + 'em';
    s.style.color = this.color('ink');
    s.classList.toggle('vertical', !!P.vertical);
  },

  // ---- grapheme / classify (元コード移植) ----
  _seg: (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null,
  _toGraphemes(str){
    if(this._seg) return Array.from(this._seg.segment(str), e => e.segment);
    return Array.from(str);
  },
  _uni: (function(){
    try{ return {
      punct: new RegExp('\\p{P}', 'u'),
      hira: new RegExp('\\p{sc=Hiragana}', 'u'),
      kata: new RegExp('\\p{sc=Katakana}', 'u'),
      han: new RegExp('[\\p{sc=Han}\\p{sc=Hangul}]', 'u'),
      latin: new RegExp('[\\p{sc=Latin}0-9]', 'u'),
      upright: new RegExp('[\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}\\p{sc=Hangul}\\uFF01-\\uFF60\\u3000-\\u303F\\u3040-\\u30FF]|\\p{Extended_Pictographic}', 'u')
    }; }catch(e){ return null; }
  })(),
  _charInfo(ch){
    const u = this._uni; let cls = 'other', punct = false, upright = true;
    if(u){
      punct = u.punct.test(ch);
      if(u.hira.test(ch)) cls = 'hira';
      else if(u.kata.test(ch)) cls = 'kata';
      else if(u.han.test(ch)) cls = 'kanji';
      else if(u.latin.test(ch)) cls = 'latin';
      upright = u.upright.test(ch);
    } else { cls = /[A-Za-z0-9]/.test(ch) ? 'latin' : 'other'; upright = cls !== 'latin'; }
    return { cls, punct, upright };
  },
  _hash(j, cp, k){ return (Math.abs(Math.sin((j+1)*(cp+1)*(k+this.P.seed*13.37)))*43758.5453) % 1; },
  _quant(x, s){ return Math.round(x/s)*s; },
  _randomLaw(){
    const law = String(this.P.randomLaw || 'scatter');
    return /^(paste|collage|scatter|calm|wave|grid|pulse|glitch)$/.test(law) ? law : 'scatter';
  },

  // ================= Confuse operator (類字置換) =================
  _clearConfuseCaches(){
    this._confuseCache = Object.create(null);
    this._glyphRasterCache = Object.create(null);
    this._missingRasterCache = Object.create(null);
    for(const m of this._metrics || []){ m._confStr = null; m.dispCh = null; }
  },

  _confuseScript(value){
    if(!value) return 'common';
    let normalized = value;
    try{ normalized = value.normalize('NFKC'); }catch(e){}
    for(const character of Array.from(normalized)){
      const cp = character.codePointAt(0);
      if(/\p{Script=Latin}/u.test(character)) return 'latin';
      if(/\p{Decimal_Number}/u.test(character)) return cp >= 0x30 && cp <= 0x39 ? 'digit' : 'other-number';
      if(/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character)) return 'kana';
      if(/\p{Script=Han}/u.test(character)) return 'han';
      if(/\p{Script=Greek}/u.test(character)) return 'greek';
      if(/\p{Script=Cyrillic}/u.test(character)) return 'cyrillic';
      if(/\p{Alphabetic}/u.test(character)) return 'other';
    }
    return 'common';
  },

  _confuseFontKey(){
    return this.weight() + '|' + this.family();
  },

  // ステージと同じフォントスタックで 24×24 のアルファマップ化。豆腐/.notdef 判定と漢字の形状ランクに使う。
  // fontFamily/fontWeight を渡すと他モード(ugomeki等)のフォントでも判定できる (family はスタックのまま使用)
  _glyphRaster(value, fontFamily, fontWeight){
    if(!this._rasterCtx){
      // TextDeform.init 前でも他モードから使えるよう遅延生成
      try{
        this._glyphRasterCache = this._glyphRasterCache || Object.create(null);
        this._missingRasterCache = this._missingRasterCache || Object.create(null);
        this._confuseCache = this._confuseCache || Object.create(null);
        this._rasterCanvas = document.createElement('canvas');
        this._rasterCanvas.width = this._rasterCanvas.height = 72;
        this._rasterCtx = this._rasterCanvas.getContext('2d', { willReadFrequently: true });
      }catch(e){}
    }
    if(!this._rasterCtx || !value) return null;
    const stack = fontFamily != null ? String(fontFamily) : this._fontStack(this.family());
    const weight = fontWeight != null ? fontWeight : this.weight();
    const cacheKey = weight + '|' + stack + '|' + value;
    if(Object.prototype.hasOwnProperty.call(this._glyphRasterCache, cacheKey)) return this._glyphRasterCache[cacheKey];
    const ctx = this._rasterCtx, size = this._rasterCanvas.width;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let fontSize = 54;
    ctx.font = weight + ' ' + fontSize + 'px ' + stack;
    const measured = ctx.measureText(value).width;
    if(measured > size - 8){
      fontSize = Math.max(18, fontSize * (size - 8) / measured);
      ctx.font = weight + ' ' + fontSize + 'px ' + stack;
    }
    ctx.fillText(value, size/2, size/2 + 1);
    ctx.restore();
    let image;
    try{ image = ctx.getImageData(0, 0, size, size).data; }
    catch(e){ this._glyphRasterCache[cacheKey] = null; return null; }
    let minX = size, minY = size, maxX = -1, maxY = -1;
    for(let y=0; y<size; y++){
      for(let x=0; x<size; x++){
        if(image[(y*size + x)*4 + 3] > 12){
          if(x < minX) minX = x;
          if(x > maxX) maxX = x;
          if(y < minY) minY = y;
          if(y > maxY) maxY = y;
        }
      }
    }
    if(maxX < minX || maxY < minY){ this._glyphRasterCache[cacheKey] = null; return null; }
    const N = 24;
    const pixels = new Uint8Array(N*N);
    const sourceW = maxX - minX + 1, sourceH = maxY - minY + 1;
    let ink = 0;
    for(let ny=0; ny<N; ny++){
      const sy0 = minY + Math.floor(ny*sourceH/N);
      const sy1 = minY + Math.max(1, Math.ceil((ny+1)*sourceH/N));
      for(let nx=0; nx<N; nx++){
        const sx0 = minX + Math.floor(nx*sourceW/N);
        const sx1 = minX + Math.max(1, Math.ceil((nx+1)*sourceW/N));
        let alpha = 0;
        for(let sy=sy0; sy<sy1 && sy<=maxY; sy++){
          for(let sx=sx0; sx<sx1 && sx<=maxX; sx++) alpha = Math.max(alpha, image[(sy*size + sx)*4 + 3]);
        }
        pixels[ny*N + nx] = alpha;
        ink += alpha;
      }
    }
    const raster = { pixels, ink: ink/(255*pixels.length) };
    this._glyphRasterCache[cacheKey] = raster;
    return raster;
  },

  _rasterDist(left, right){
    if(!left || !right || left.pixels.length !== right.pixels.length) return 1;
    let total = 0;
    for(let i=0; i<left.pixels.length; i++) total += Math.abs(left.pixels[i] - right.pixels[i]);
    return total/(255*left.pixels.length);
  },

  _missingRasters(fontFamily, fontWeight){
    const key = (fontWeight != null ? fontWeight : this.weight()) + '|' +
      (fontFamily != null ? String(fontFamily) : this._fontStack(this.family()));
    this._missingRasterCache = this._missingRasterCache || Object.create(null);
    if(this._missingRasterCache[key]) return this._missingRasterCache[key];
    // .notdef が 16進ラベル入りのブラウザにも □× 箱にも当たるよう複数の未割当/私用領域を試す
    const probes = ['\u0378', '\u0380', '\uE000', String.fromCodePoint(0xF0000), String.fromCodePoint(0x10FFFF)];
    const rasters = [];
    for(const p of probes){
      const raster = this._glyphRaster(p, fontFamily, fontWeight);
      if(raster) rasters.push(raster);
    }
    this._missingRasterCache[key] = rasters;
    return rasters;
  },

  _glyphQuality(sourceChar, candidate){
    const candidateRaster = this._glyphRaster(candidate);
    if(!candidateRaster || candidateRaster.ink < 0.008) return { supported: false, similarity: 0 };
    for(const missing of this._missingRasters()){
      if(this._rasterDist(candidateRaster, missing) < 0.028) return { supported: false, similarity: 0 };
    }
    const distance = this._rasterDist(this._glyphRaster(sourceChar), candidateRaster);
    // フォントに区別が無い異体字は変形にならないので落とす
    if(this._confuseScript(sourceChar) === 'han' && distance < 0.009) return { supported: false, similarity: 1 };
    return { supported: true, similarity: Math.max(0, 1 - distance) };
  },

  _confuseRecords(ch){
    const mixed = !!this.P.confuseMixed;
    const cacheKey = (mixed ? '1' : '0') + '|' + this._confuseFontKey() + '|' + ch;
    const cached = this._confuseCache[cacheKey];
    if(cached) return cached;

    let t1 = [], t2 = [], t3 = [];
    const cp = ch.codePointAt(0);
    if(cp >= 0x3041 && cp <= 0x3096){
      t1 = t1.concat(tdConfusePairLookup(TD_CONFUSE_VOICE_PAIRS, ch));
      if(TD_CONFUSE_SMALL_KANA[ch]) t1.push(TD_CONFUSE_SMALL_KANA[ch]);
      const kata = String.fromCodePoint(cp + 0x60);
      t2.push(kata);
      if(TD_CONFUSE_HALF_KATA[kata]) t2.push(TD_CONFUSE_HALF_KATA[kata]);
    }else if(cp >= 0x30A1 && cp <= 0x30FA || ch === 'ー'){
      t1 = t1.concat(tdConfusePairLookup(TD_CONFUSE_VOICE_PAIRS, ch));
      if(TD_CONFUSE_SMALL_KANA[ch]) t1.push(TD_CONFUSE_SMALL_KANA[ch]);
      if(TD_CONFUSE_HALF_KATA[ch]) t2.push(TD_CONFUSE_HALF_KATA[ch]);
      if(cp >= 0x30A1 && cp <= 0x30F6) t2.push(String.fromCodePoint(cp - 0x60));
      t3 = t3.concat(tdConfusePairLookup(TD_CONFUSE_KATA_KANJI, ch));
    }else if(this._confuseScript(ch) === 'han'){
      t1 = t1.concat(tdConfusePairLookup(TD_CONFUSE_KYUJITAI, ch));
      for(const group of TD_CONFUSE_SIMILAR_KANJI){
        if(group.indexOf(ch) !== -1){
          for(const g of group) if(g !== ch) t2.push(g);
        }
      }
      t3 = t3.concat(tdConfusePairLookup(TD_CONFUSE_KATA_KANJI, ch));
    }else if(cp >= 0x41 && cp <= 0x5A || cp >= 0x61 && cp <= 0x7A){
      t1.push(String.fromCodePoint(cp + 0xFEE0));
      const isUpper = cp <= 0x5A;
      const alphaIndex = isUpper ? cp - 0x41 : cp - 0x61;
      for(const styleDef of TD_CONFUSE_MATH_STYLES){
        t2.push(styleDef.holes[ch] || String.fromCodePoint((isUpper ? styleDef.upper : styleDef.lower) + alphaIndex));
      }
      if(TD_CONFUSE_GREEK[ch]) t3.push(TD_CONFUSE_GREEK[ch]);
      if(TD_CONFUSE_CYRILLIC[ch]) t3.push(TD_CONFUSE_CYRILLIC[ch]);
      t3.push(String.fromCodePoint((isUpper ? 0x24B6 : 0x24D0) + alphaIndex));
    }else if(cp >= 0x30 && cp <= 0x39){
      const d = cp - 0x30;
      t1.push(String.fromCodePoint(cp + 0xFEE0));
      t2.push(String.fromCodePoint(0x1D7CE + d), String.fromCodePoint(0x1D7D8 + d), String.fromCodePoint(0x1D7F6 + d));
      t3.push(d === 0 ? '⓪' : String.fromCodePoint(0x2460 + d - 1), TD_CONFUSE_SUPERSCRIPT_DIGITS[d]);
    }else if(TD_CONFUSE_PUNCT[ch]){
      const punct = TD_CONFUSE_PUNCT[ch];
      if(punct.t1) t1 = t1.concat(punct.t1);
      if(punct.t2) t2 = t2.concat(punct.t2);
      if(punct.t3) t3 = t3.concat(punct.t3);
    }

    const sourceScript = this._confuseScript(ch);
    const isHan = sourceScript === 'han';
    const records = [];
    const seen = Object.create(null);
    const push = (candidate, tier)=>{
      if(!candidate || candidate === ch || seen[candidate]) return;
      const candidateScript = this._confuseScript(candidate);
      const isMixed = sourceScript !== candidateScript && sourceScript !== 'common' && candidateScript !== 'common';
      if(isMixed && !mixed) return;
      // Glyph Guard: 現フォントで描けない候補と、区別のつかない異体字を落とす
      const quality = this._glyphQuality(ch, candidate);
      if(!quality.supported) return;
      seen[candidate] = 1;
      records.push({ text: candidate, tier, similarity: quality.similarity });
    };
    for(const c of t1) push(c, 1);
    for(const c of t2) push(c, 2);
    if(mixed) for(const c of t3) push(c, 3);
    records.sort((a, b)=> (a.tier - b.tier) || (isHan ? b.similarity - a.similarity : 0));
    this._confuseCache[cacheKey] = records;
    return records;
  },

  // 深さ 0..1 を Tier 1→2→3 の段階に割り付けて候補を選ぶ (元 selectConfuseCandidate)
  _selectConfuse(records, strength, letterIndex, codepoint){
    if(!records.length || strength <= 0.001) return null;
    const jitter = 0.82 + this._hash(letterIndex, codepoint, 91.117)*0.36;
    const effective = Math.max(0, Math.min(1, strength*jitter));
    const targetTier = effective < 0.34 ? 1 : (effective < 0.74 ? 2 : 3);
    let tier = records.filter(r => r.tier === targetTier);
    if(!tier.length){
      for(let distance=1; distance<=2 && !tier.length; distance++){
        tier = records.filter(r => r.tier === targetTier - distance);
        if(!tier.length) tier = records.filter(r => r.tier === targetTier + distance);
      }
    }
    if(!tier.length) return null;
    const zoneStart = targetTier === 1 ? 0 : (targetTier === 2 ? 0.34 : 0.74);
    const zoneEnd = targetTier === 1 ? 0.34 : (targetTier === 2 ? 0.74 : 1);
    const progress = Math.max(0, Math.min(1, (effective - zoneStart)/(zoneEnd - zoneStart)));
    let index = Math.min(tier.length - 1, Math.floor(progress*tier.length));
    if(strength >= 0.999) index = tier.length - 1;
    return tier[index].text;
  },

  _confuseDisplay(m, strength){
    if(strength <= 0.001) return null;
    const el = m.el;
    const orig = el.textContent;
    if(Array.from(orig).length !== 1) return null;
    const records = this._confuseRecords(orig);
    if(!records.length) return null;
    return this._selectConfuse(records, strength, el._j || 0, el._cp || 0);
  },

  // ================= 豆腐ガード (描けないグリフの置換) =================
  // 現フォントで .notdef になる文字を、密度の近いグリッチ系代替へ決定論的に置換する。
  // Zalgo クラスタは結合記号を除いた基底文字で判定し、置換後も記号は載せ直す。
  _tofuPool: '▓▒░█▚▞▙▟▛▜◆◉◍〓〼※々〆ЖΨ∴∵≡∞▲●◐◑',
  _tofuPoolCache: null,

  // 引数省略時は TextDeform 自身のフォント。他モードは fontFamily(CSSスタック)/fontWeight を渡す
  _charSupported(ch, fontFamily, fontWeight){
    const raster = this._glyphRaster(ch, fontFamily, fontWeight);
    if(!this._rasterCtx) return true;
    if(!raster || raster.ink < 0.008) return false;
    for(const missing of this._missingRasters(fontFamily, fontWeight)){
      if(this._rasterDist(raster, missing) < 0.028) return false;
    }
    return true;
  },

  _tofuFix(cluster, fontFamily, fontWeight){
    if(!cluster || !cluster.trim()) return cluster;   // 空白/制御は素通し (インク量ゼロ=非対応と誤判定するため)
    let base = cluster;
    try{ base = cluster.replace(/\p{M}/gu, '') || cluster; }catch(e){}
    base = Array.from(base)[0] || cluster;
    if(this._charSupported(base, fontFamily, fontWeight)) return cluster;
    const key = (fontWeight != null ? fontWeight : this.weight()) + '|' +
      (fontFamily != null ? String(fontFamily) : this._fontStack(this.family()));
    this._tofuPoolCache = this._tofuPoolCache || {};
    if(!this._tofuPoolCache[key]){
      const pool = Array.from(this._tofuPool).filter(c => this._charSupported(c, fontFamily, fontWeight));
      this._tofuPoolCache[key] = pool.length ? pool : ['*'];
    }
    const pool = this._tofuPoolCache[key];
    const repl = pool[(base.codePointAt(0) || 42) % pool.length];
    const marks = Array.from(cluster).slice(1).join('');   // Zalgo の結合記号は代替グリフに載せ直す
    return repl + marks;
  },

  // フォント読込完了後に呼ぶ: 判定キャッシュを捨てて組版し直す (読込前の誤判定を訂正)
  _refreshGlyphSupport(){
    this._layoutDirty = true;
    this._clearConfuseCaches();
    this._tofuPoolCache = null;
    if(this.initialized && this._stage) this.setText(this.P.text);
    // 他モード(Ugomeki / Space Type)にも組み直しを促す
    try{ if(typeof Ugomeki !== 'undefined' && Ugomeki.onFontsReady) Ugomeki.onFontsReady(); }catch(e){}
    try{ if(typeof SpaceType !== 'undefined' && SpaceType.onFontsReady) SpaceType.onFontsReady(); }catch(e){}
  },

  /* 他モード共用の豆腐ガード。cluster を渡すと、そのフォントで描けない場合だけ
   * 代替グリフ(結合記号は維持)へ置換して返す。 fontFamily は CSS の font-family 文字列。 */
  fixTofu(cluster, fontFamily, fontWeight){
    if(!cluster) return cluster;
    try{ return this._tofuFix(cluster, fontFamily, fontWeight == null ? 400 : fontWeight); }
    catch(e){ return cluster; }
  },

  _createSpans(text){
    const stage = this._stage;
    if(!stage) return;
    stage.innerHTML = '';
    const letters = [];
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const frag = document.createDocumentFragment();
    for(let li=0; li<lines.length; li++){
      const p = document.createElement('p');
      const chars = this._toGraphemes(lines[li]);
      let hasTok = false;
      for(let j=0; j<chars.length; j++){
        const raw = chars[j];
        const cp = raw.codePointAt(0);
        if(cp === 32 || cp === 9 || cp === 160 || cp === 0x3000){ p.appendChild(document.createTextNode(raw)); continue; }
        const ch = this._tofuFix(raw);   // 豆腐ガード: 描けないグリフは代替へ
        const info = this._charInfo(ch);
        const span = document.createElement('span');
        span.className = 'c' + (info.punct ? ' punct' : '');
        span.textContent = ch;
        span._j = j; span._li = li; span._cp = cp; span._info = info;
        p.appendChild(span);
        letters.push(span);
        hasTok = true;
      }
      if(!hasTok) p.appendChild(document.createElement('br'));
      frag.appendChild(p);
    }
    stage.appendChild(frag);
    this._letters = letters;
    this._applyRandom();
    this._rebuildMetrics();
    this._layoutDirty = true;
  },

  _applyRandom(){
    const P = this.P, letters = this._letters || [];
    const law = this._randomLaw();
    for(let i=0; i<letters.length; i++){
      const span = letters[i], j = span._j, cp = span._cp, info = span._info;
      const isPunct = info.punct, cls = info.cls;
      const li = span._li || 0;
      let r1 = this._hash(j,cp,12.9898), r2 = this._hash(j,cp,78.233), r3 = this._hash(j,cp,192.456),
          r4 = this._hash(j,cp,421.887), r5 = this._hash(j,cp,333.777), r6 = this._hash(j,cp,77.113);
      if(law === 'wave'){
        r1 = 0.5 + 0.5*Math.sin((j+1)*0.55 + li*1.15 + P.seed*0.37);
        r2 = 0.5 + 0.5*Math.cos((j+1)*0.38 + li*0.72 + P.seed*0.51);
        r5 = 0.5 + 0.5*Math.sin((j-li)*0.34 + P.seed*0.29);
      }else if(law === 'collage'){
        r1 = Math.pow(r1, 0.62);
        r2 = Math.pow(r2, 1.35);
        r3 = Math.max(r3, this._hash(j+li, cp, 515.77));
        r5 = this._quant(r5, 0.125);
      }else if(law === 'grid'){
        const b = Math.floor(j/3) + Math.floor(li/2)*5 + P.seed;
        r1 = (b % 2) ? 0.82 : 0.18;
        r2 = (b % 3) / 2;
        r3 = (b % 4) / 3;
        r5 = (b % 5) / 4;
      }else if(law === 'pulse'){
        const d = Math.sqrt(j*j + li*li);
        r1 = 0.5 + 0.5*Math.sin(d*0.62 + P.seed);
        r2 = 0.5 + 0.5*Math.cos(d*0.48 + P.seed*0.7);
      }
      let sxMin=0.78, sxRange=0.56, syMin=0.82, syRange=0.40;
      if(isPunct){ sxMin=0.97; sxRange=0.06; syMin=0.97; syRange=0.06; }
      else if(cls==='latin'){ sxMin=0.86; sxRange=0.38; syMin=0.88; syRange=0.30; }
      else if(cls==='hira'||cls==='kata'){ sxMin=0.76; sxRange=0.52; syMin=0.84; syRange=0.36; }
      else if(cls==='kanji'){ sxMin=0.72; sxRange=0.56; syMin=0.80; syRange=0.40; }
      let R = P.randomness;
      if(law === 'calm') R *= 0.45;
      else if(law === 'glitch') R *= 1.35;
      else if(law === 'grid') R *= 0.82;
      else if(law === 'collage') R *= 1.55;
      let sx = 1-(1-(sxMin+sxRange*r1))*R, sy = 1-(1-(syMin+syRange*r2))*R;
      let tx = ((r1-0.5)*0.026)*R, ty = ((r2-0.5)*0.056)*R;
      if(law === 'glitch'){ tx *= 3.2; ty *= 2.2; sx = this._quant(sx,0.06); sy = this._quant(sy,0.06); }
      else if(law === 'grid'){ tx = 0; ty = 0; sx = this._quant(sx,0.08); sy = this._quant(sy,0.08); }
      else if(law === 'collage'){ tx *= 1.8; ty *= 1.8; }
      sx = this._quant(sx,0.005); sy = this._quant(sy,0.005);
      tx = this._quant(tx,0.002); ty = this._quant(ty,0.002);
      span.style.setProperty('--sx', sx.toFixed(3));
      span.style.setProperty('--sy', sy.toFixed(3));
      span.style.setProperty('--tx', tx.toFixed(3)+'em');
      span.style.setProperty('--ty', ty.toFixed(3)+'em');
      let rot = (r5-0.5)*2*P.rotation;
      if(law === 'calm') rot *= 0.35;
      else if(law === 'grid') rot = Math.round(rot/6)*6;
      else if(law === 'glitch') rot = Math.round(rot/4)*4;
      else if(law === 'collage') rot = Math.round(rot/2)*2;
      span.style.setProperty('--rot', rot.toFixed(2)+'deg');
      const accent = r6 < P.accentRatio;
      span._accent = accent;
      let geoChance = P.geoRatio;
      if(law === 'calm') geoChance *= 0.35;
      else if(law === 'grid') geoChance = Math.min(1, geoChance + 0.18);
      else if(law === 'glitch') geoChance = Math.min(1, geoChance + 0.35);
      else if(law === 'collage') geoChance = Math.min(1, geoChance + 0.25);
      const geo = r3 > (1 - geoChance);
      span._lensX = (r1*2)-1; span._lensY = (r2*2)-1; span._geo = geo;
      if(geo){ span._stepX = 0.22+r3*0.28; span._stepY = 0.26+r4*0.32; span._blend = 0.58+r4*0.24; }
      else  { span._stepX = 0.16+r3*0.10; span._stepY = 0.20+r4*0.12; span._blend = 0.18+r4*0.20; }
    }
  },

  _rebuildMetrics(){
    const H = (el, k)=>this._hash(el._j || 0, el._cp || 0, k);
    this._metrics = (this._letters || []).map(el => ({
      el, relX:0, relY:0, w:0, h:0,
      col: el._j || 0, line: el._li || 0,
      seedX: el._lensX, seedY: el._lensY, geo: el._geo,
      stepX: el._stepX, stepY: el._stepY, blend: el._blend,
      toggled:false, hovered:false, intensity:0, active:false,
      // pattern/collage 系 law 用の決定論的 Operator ロール (g* はゲート判定用)
      opStatic: {
        rot: H(el,11.31)*2-1, gRot: H(el,201.7),
        skx: H(el,23.73)*2-1, gSkx: H(el,211.3),
        sky: H(el,31.97)*2-1, gSky: H(el,221.9),
        bl:  H(el,41.13)*2-1, gBl:  H(el,231.1),
        gMirX: H(el,53.39), gMirY: H(el,61.83),
        mis: 0.5+H(el,71.29)*0.5, gMis: H(el,241.7),
        conf: 0.4+H(el,83.91)*0.6, gConf: H(el,251.3)
      }
    }));
    this._layoutDirty = true;
  },

  // 文字が動き出すたびに、乗る Operator と量をランダムに決める
  _rollOps(m){
    const c = Math.max(0, Math.min(1, this.P.opChance));
    m.op = {
      rot: Math.random() < c ? Math.random()*2 - 1 : 0,
      skx: Math.random() < c ? Math.random()*2 - 1 : 0,
      sky: Math.random() < c ? Math.random()*2 - 1 : 0,
      bl:  Math.random() < c ? Math.random()*2 - 1 : 0,
      mirX: Math.random() < c ? 1 : 0,
      mirY: Math.random() < c ? 1 : 0,
      mis: Math.random() < c ? 0.5 + Math.random()*0.5 : 0,
      conf: Math.random() < c ? 0.4 + Math.random()*0.6 : 0
    };
    m._opStaticApplied = false;
  },

  // 決定論的な law (wave/grid/pulse/collage) 用: 文字固有ロールを opChance でゲートして使う
  _staticOps(m){
    const c = Math.max(0, Math.min(1, this.P.opChance));
    if(m._opStaticApplied && m._opChanceV === c) return;
    const s = m.opStatic || {};
    m.op = {
      rot: s.gRot < c ? s.rot : 0,
      skx: s.gSkx < c ? s.skx : 0,
      sky: s.gSky < c ? s.sky : 0,
      bl:  s.gBl < c ? s.bl : 0,
      mirX: s.gMirX < c ? 1 : 0,
      mirY: s.gMirY < c ? 1 : 0,
      mis: s.gMis < c ? s.mis : 0,
      conf: s.gConf < c ? s.conf : 0
    };
    m._opChanceV = c;
    m._opStaticApplied = true;
  },

  _measureLayout(){
    if(this.P.gridEnabled){
      this._layoutGridCells();
      this._layoutDirty = false;
      this._fitDirty = true;
      return;
    }
    const stage = this._stage, ms = this._metrics || [];
    for(let i=0; i<ms.length; i++){
      const m = ms[i]; let x=0, y=0, o = m.el;
      while(o && o !== stage){ x += o.offsetLeft; y += o.offsetTop; o = o.offsetParent; }
      m.w = m.el.offsetWidth; m.h = m.el.offsetHeight;
      m.relX = x + m.w/2; m.relY = y + m.h/2;
    }
    this._layoutDirty = false;
    this._fitDirty = true;   // 版面が変わったのでフィット再計算
  },

  // グリッド組版: DOM の組版を使わず、原稿用紙状のマスに読み順で流し込む。
  // 横組=行方向に gridCols で折返し / 縦組=列を上→下に流し右→左へ送る。改行は新しい行/列。
  _layoutGridCells(){
    const P = this.P, ms = this._metrics || [];
    const cell = P.gridCell > 0 ? P.gridCell : Math.round(P.fontSize*1.15);
    const gap = Math.max(0, P.gridGap || 0);
    const step = cell + gap;
    const wrap = Math.max(1, P.gridCols | 0);
    let col = 0, row = 0, lastLine = -1, maxCol = 0;
    const cells = [];
    for(const m of ms){
      const li = m.line || 0;
      if(P.vertical){
        if(li !== lastLine){ if(lastLine >= 0) col++; row = 0; lastLine = li; }
        if(row >= wrap){ row = 0; col++; }
        cells.push({ c: col, r: row });
        row++;
      } else {
        if(li !== lastLine){ if(lastLine >= 0) row++; col = 0; lastLine = li; }
        if(col >= wrap){ col = 0; row++; }
        cells.push({ c: col, r: row });
        col++;
      }
      if(cells[cells.length-1].c > maxCol) maxCol = cells[cells.length-1].c;
    }
    for(let i=0; i<ms.length; i++){
      const m = ms[i], cc = cells[i];
      const gx = P.vertical ? (maxCol - cc.c) : cc.c;
      m.w = cell; m.h = cell;
      m.relX = gx*step + cell/2;
      m.relY = cc.r*step + cell/2;
    }
  },

  // ================= レンズ変形(仮想ポインタ) =================
  _lensStep(radius){
    const P = this.P, ms = this._metrics || [], pt = this._pointer;
    const rSq = radius*radius, px = pt.x, py = pt.y;
    for(let i=0; i<ms.length; i++){
      const info = ms[i];
      const dx = px - info.relX, dy = py - info.relY;
      const dSq = dx*dx + dy*dy;
      if(dSq < rSq){ if(!info.hovered){ info.toggled = !info.toggled; info.hovered = true; if(info.toggled) this._rollOps(info); } }
      else info.hovered = false;
      const target = info.toggled ? 1.0 : 0.0;
      const diff = target - info.intensity;
      if(diff < 0.0015 && diff > -0.0015){
        if(info.intensity !== target){ info.intensity = target; this._applyStretch(info); }
        continue;
      }
      info.intensity += diff * P.ease;
      this._applyStretch(info);
    }
  },

  _applyStretch(info){
    const P = this.P;
    const seedX = (info.rX != null ? info.rX : info.seedX);   // 起動ごとにランダム化された向き
    const seedY = (info.rY != null ? info.rY : info.seedY);
    const directional = seedX*0.5;
    // 上流と同じ符号つき伸縮: 正 = 加算で伸びる / 負 = 指数で縮む (ゼロや反転を通らず、細い線まで潰れる)
    const sgn = (amt, resp) => amt >= 0 ? 1 + info.intensity*resp*amt : Math.exp(info.intensity*resp*amt);
    let sX = sgn(+P.stretchX || 0, 1.48 + seedX*0.85 + directional*0.42);
    let sY = sgn(+P.stretchY || 0, 1.82 + seedY*1.05 - directional*0.36);
    const ss = (P.stepSize > 0 ? P.stepSize : 100) / 100;   // 段階の刻み幅 (既定 100 = 1.0)
    const stepX = (info.stepX>0?info.stepX:0.28)*ss, stepY = (info.stepY>0?info.stepY:0.34)*ss, baseBlend = info.blend;
    if(info.geo){
      const blend = Math.min(0.94, Math.max(0.42, baseBlend + info.intensity*0.35));
      const qx = 1 + Math.round((sX-1)/stepX)*stepX, qy = 1 + Math.round((sY-1)/stepY)*stepY;
      sX = sX*(1-blend)+qx*blend; sY = sY*(1-blend)+qy*blend;
      sX += (seedX*0.12+seedY*0.08)*info.intensity; sY += (seedY*0.14-seedX*0.05)*info.intensity;
    } else {
      const sb = Math.max(0, Math.min(0.55, baseBlend*info.intensity));
      if(sb > 0.02){
        const ex = 1 + Math.round((sX-1)/stepX)*stepX, ey = 1 + Math.round((sY-1)/stepY)*stepY;
        sX = sX*(1-sb)+ex*sb; sY = sY*(1-sb)+ey*sb;
      }
    }
    sX = sX<0.04?0.04:(sX>18?18:sX); sY = sY<0.04?0.04:(sY>18?18:sY);
    info.el.style.setProperty('--ix', sX.toFixed(3));
    info.el.style.setProperty('--iy', sY.toFixed(3));
    this._applyOps(info);
  },

  // Operator 各チャンネルの現在値を intensity から算出して metric に載せる (描画は _renderToCanvas)
  _applyOps(info){
    const P = this.P, op = info.op, t = info.intensity;
    if(!op || !t){
      info.opRotV = 0; info.opSkXV = 0; info.opSkYV = 0; info.opBlV = 0;
      info.opMirXV = 1; info.opMirYV = 1; info.opMisXV = 0; info.opMisYV = 0;
      if(info.dispCh){ info.dispCh = null; info._confStr = 0; }
      return;
    }
    info.opRotV = P.rotateAngle * op.rot * t;
    info.opSkXV = P.skewX * op.skx * t;
    info.opSkYV = P.skewY * op.sky * t;
    info.opBlV = P.baselineShift * op.bl * t;
    info.opMirXV = op.mirX ? (1 - 2*t*Math.max(0, Math.min(1, P.mirrorX))) : 1;
    info.opMirYV = op.mirY ? (1 - 2*t*Math.max(0, Math.min(1, P.mirrorY))) : 1;
    info.opMisXV = P.misregX * op.mis * t;
    info.opMisYV = P.misregY * op.mis * t;
    const cs = Math.max(0, Math.min(1, P.confuseDepth * op.conf * t));
    const q = Math.round(cs*25);   // 0.04 刻みでだけ候補を選び直す
    if(q !== info._confStr){
      info._confStr = q;
      info.dispCh = q ? this._confuseDisplay(info, cs) : null;
    }
  },

  // ================= vj フック =================
  update(beat, dt, w, h){
    if(!this.initialized) return;
    if(!this._metrics || !this._metrics.length){ if(this._layoutDirty) this._measureLayout(); return; }
    if(this._layoutDirty) this._measureLayout();
    const P = this.P;
    const d = (dt > 0 && dt < 0.2) ? dt : 1/60;
    this._t += d;
    this._beatNow = beat || 0;
    const beatMode = (typeof App !== 'undefined' && App.beatMode === 'beat');
    const bi = Math.floor(beat || 0);
    // Text: Random は P.textEvery 拍ごと (1/16〜16 拍。拍の端数で数える) に次の文字列へ (Look はそのまま)
    if(P.textMode === 'random'){
      const every = Math.max(0.0625, +P.textEvery || 4), b = (beat || 0) / every;
      const slot = Math.floor(b + 1e-6);
      if(this._textSlot == null || slot < this._textSlot) this._textSlot = slot;
      else if(slot !== this._textSlot){
        this._textSlot = slot;
        // T Type が On のときは、全文を打ち終えるまで替えない (長文が出だしだけで次へ行かないように。次の区切りで替える)
        const typing = P.typeOn === 'on' && (this._twShown || 0) < ((this._metrics && this._metrics.length) || 0);
        if(!typing) this.nextRandomText();
      }
    }
    if(typeof TDLooks !== 'undefined') TDLooks.beatTick(beat);   // Look Auto
    this._compRandTick(beat);
    const sw = this._stage.offsetWidth || P.stageW, sh = this._stage.offsetHeight || P.stageW;
    const inBloom = this._t < (this._bloomUntil || 0);
    const beatPhase = (beat || 0) - bi;
    const pulse = this._rhythmPulse(beatMode, beatPhase), motion = this._dp(+P.rhythmMotion || 0);
    this._pulseNow = pulse; this._motionNow = motion;   // Vector 3D (TDVec) が読む
    if(typeof TDCanvas !== 'undefined'){
      if(TDCanvas.active()) TDCanvas.update(d, pulse, motion, beat);
      else if(TDCanvas._bake || TDCanvas._bakeQ.length || TDCanvas._inst.size || (TDCanvas._ghosts && TDCanvas._ghosts.length)) TDCanvas.release();   // Off にしたら焼き付けをやめて本体の Look を戻し、分身の絵も手放す
    }
    if(inBloom){
      // 構成的な一斉変形: 大きな半径のレンズを一直線にスイープ → 行/列がまとめて伸びる
      const prog = 1 - (this._bloomUntil - this._t) / (this._bloomDur || 0.7);   // 0→1
      if(this._bloomAxis === 0){ this._ptTX = sw*prog; this._ptTY = sh*(0.5 + 0.28*Math.sin(this._t*2.4)); }
      else                     { this._ptTX = sw*(0.5 + 0.28*Math.sin(this._t*2.4)); this._ptTY = sh*prog; }
      const ease = Math.min(0.5, 0.14 * P.autoSpeed), pt = this._pointer;
      pt.x += ((this._ptTX) - pt.x) * ease; pt.y += ((this._ptTY) - pt.y) * ease;
      this._lensStep(P.radius * 2.6 * pulse);
    } else {
      // ときどき bloom を発動
      if(this._t >= (this._nextBloomCheck || 0)){
        this._nextBloomCheck = this._t + 0.3;
        if(Math.random() < P.bloomChance){
          this._bloomDur = 0.6 + Math.random()*0.5;
          this._bloomUntil = this._t + this._bloomDur;
          this._bloomAxis = Math.random() < 0.5 ? 0 : 1;
        }
      }
      // 各文字が独立ランダムに動き出す(散らばったランダム変形)
      this._randomFlipStep(pulse * motion);
    }
    // Composition のループ位相を進める (mode/textdeform-comp.js)
    if(typeof TDComp !== 'undefined') TDComp.advance(d * motion, pulse);
    if(typeof TDSurf !== 'undefined') TDSurf.advance(d * motion, pulse);
  },

  // Comp Random (全 Look 共通): compRandEvery 拍 / 秒ごとに Composition をランダムに切り替える。
  // Comp Random が On なのに Composition が Off のときは、すぐ次の Composition を当てる
  _compRandTick(beat){
    const P = this.P, every = +P.compRandEvery || 0;
    if(!(every > 0) || typeof TDComp === 'undefined'){ this._compRandSlot = null; return; }
    const slot = Math.floor((P.compRandUnit === 'sec' ? performance.now() / 1000 : (beat || 0)) / every + 1e-6);   // 秒は実時間 (this._t はフレーム数で進む)
    if(this._compRandSlot == null || slot < this._compRandSlot || !TDComp.enabled()){ this._compRandSlot = slot; this.randomComposition(); return; }
    if(slot !== this._compRandSlot){ this._compRandSlot = slot; this.randomComposition(); }
  },
  // Comp Random の対象から外す Composition (手動・Comp Saved では選べる)。ヘッドレス Chrome の計測で contourAtlas は 60fps → 6fps、
  // field は字の多い配置で 15〜46fps に落ちた (2026-11-21)
  COMP_RANDOM_HEAVY: ['contourAtlas', 'field'],
  randomComposition(){
    if(typeof TDComp === 'undefined') return;
    const ids = Object.keys(TDComp.defs).filter(id => !this.COMP_RANDOM_HEAVY.includes(id)), cur = TDComp.get();
    const pool = ids.length > 1 ? ids.filter(id => !(cur.enabled && id === cur.type)) : ids;
    TDComp.set({ enabled: true, type: pool[Math.floor(Math.random()*pool.length)], seed: Math.floor(Math.random()*1e6) });
    if(typeof UI !== 'undefined' && UI.refreshTextDeform) UI.refreshTextDeform();
  },

  // 描画に使う書体と太さ (共通フォントが On ならその書体、Off なら Look の値)
  family(){ const o = TD_FONT_OVER[this.P.fontOver]; return o ? o.f : this.P.fontFamily; },
  weight(){ const o = TD_FONT_OVER[this.P.fontOver]; return o && o.w ? o.w : this.P.fontWeight; },
  // 字間・行送り (Look の値 + 共通の加算 / 倍率)
  track(){ return (+this.P.letterSpacing || 0) + (+this.P.comTrack || 0); },
  leading(){ return (+this.P.lineHeight || 1) * (+this.P.comLeading || 1); },

  // 描画に使う色 (k = paper / ink / accent)。共通パレットが On ならその色、Off なら Look の色
  color(k){
    const P = this.P;
    if(P.palOn === 'paper') return k === 'paper' ? P.palPaper : P[k];   // Paper only = 背景だけ固定
    return P.palOn ? P['pal' + k[0].toUpperCase() + k.slice(1)] : P[k];
  },
  // hex にいちばん近い Look の色の役割 (paper / ink / accent。OKLab の距離)
  colorRole(hex){
    const P = this.P, lab = this._hexOKLab(hex);
    let role = null, distance = Infinity;
    if(lab) for(const k of ['paper', 'ink', 'accent']){
      const a = this._hexOKLab(P[k]);
      if(!a) continue;
      const d = (lab[0] - a[0])**2 + (lab[1] - a[1])**2 + (lab[2] - a[2])**2;
      if(d < distance){ role = k; distance = d; }
    }
    return role;
  },
  // 共通パレットの役割で色を移す (On のときだけ。Off / Paper only なら hex のまま)。役割は force か、Look の紙・インク・アクセントのいちばん近いもの (OKLab)。
  // 色みは役割の色に揃え、明るさだけ「Look の役割の色との差」を残す (紙との明暗の向きはパレット側に合わせる)
  roleColor(hex, force){
    const P = this.P;
    if(P.palOn !== true || typeof hex !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return hex;
    const key = JSON.stringify([hex, force, P.paper, P.ink, P.accent, P.palOn, P.palPaper, P.palInk, P.palAccent]);
    const cache = this._roleColorCache || (this._roleColorCache = new Map());
    if(cache.has(key)) return cache.get(key);
    const lab = this._hexOKLab(hex), role = force || this.colorRole(hex);
    let out = hex;
    const anchor = role && this._hexOKLab(P[role]), target = role && this._hexOKLab(this.color(role));
    if(anchor && target){
      // 明暗の向き: 役割の色と「対になる色」(紙なら インク、それ以外は紙) の明るさの順が Look とパレットで逆なら差を反転する
      const pair = role === 'paper' ? 'ink' : 'paper', pa = this._hexOKLab(P[pair]), pt = this._hexOKLab(this.color(pair));
      const flip = pa && pt && Math.sign(anchor[0] - pa[0]) * Math.sign(target[0] - pt[0]) < 0 ? -1 : 1;
      out = this._okLabHex([target[0] + (lab[0] - anchor[0])*flip, target[1], target[2]]);
    }
    cache.set(key, out);
    if(cache.size > 512) cache.clear();
    return out;
  },

  // Rhythm (全 Look 共通): 音の立ち上がり + 拍 (beat モード、または無音で rhythmBpm) で脈動 (1 = 脈動なし)。
  // 動き全体の倍率 rhythmMotion は呼び出し側で文字の動き出しと Surface / Composition の時間に掛ける
  _rhythmPulse(beatMode, beatPhase){
    const P = this.P, A = (typeof Audio !== 'undefined') ? Audio : null;
    const live = !!(A && A.fft && A.mode !== 'off' && (A.bandSmooth || 0) > 0.03);
    let env = 0;
    if(live) env += this._dp(+P.rhythmAudio || 0) * Math.min(1, Math.max(A.react || 0, A.onset || 0));
    if(beatMode || (P.rhythmBpm && !live)) env += this._dp(+P.beatPulse || 0) * Math.pow(1 - beatPhase, 1.6);
    return 1 + env;
  },

  // 各文字が独立の乱数タイミングで on/off。起動ごとに変形量・向き・強さ・モードをランダム化。
  _randomFlipStep(pulse){
    const P = this.P, ms = this._metrics || [], t = this._t;
    const law = this._randomLaw();
    if(law === 'paste'){
      for(let i=0; i<ms.length; i++) ms[i].toggled = false;
      this._easeAll();
      return;
    }
    if(law === 'collage'){
      this._collageFlipStep();
      return;
    }
    if(law === 'wave' || law === 'grid' || law === 'pulse'){
      this._patternFlipStep(law, pulse);
      return;
    }
    const lawRate = law === 'calm' ? 0.45 : (law === 'glitch' ? 2.7 : 1);
    const rangeScale = law === 'calm' ? 1.8 : (law === 'glitch' ? 0.38 : 1);
    const minScale = law === 'glitch' ? 0.25 : 1;
    const rate = Math.max(0.05, P.flipRate * (pulse == null ? 1 : pulse) * lawRate);   // beat時は膨らむ
    for(let i=0; i<ms.length; i++){
      const m = ms[i];
      if(m.flipAt == null) m.flipAt = t + Math.random()*P.flipRange*rangeScale;
      if(t >= m.flipAt){
        m.toggled = !m.toggled;
        if(m.toggled){
          m.rX = Math.random()*2 - 1; m.rY = Math.random()*2 - 1;   // 変形の向き
          m.tgt = 0.45 + Math.random()*0.55;                        // 変形の強さ
          let geoChance = P.geoRatio;
          if(law === 'calm'){ m.tgt = 0.18 + Math.random()*0.42; geoChance *= 0.35; }
          else if(law === 'glitch'){
            m.rX = Math.round(m.rX*2)/2;
            m.rY = Math.round(m.rY*2)/2;
            m.tgt = 0.82 + Math.random()*0.75;
            geoChance = Math.min(1, geoChance + 0.35);
          }
          m.geo = Math.random() < geoChance;                       // 変形モード
          this._rollOps(m);                                        // 乗る Operator も引き直す
        }
        m.flipAt = t + (P.flipMin*minScale + Math.random()*P.flipRange*rangeScale) / rate;
      }
    }
    this._easeAll();
  },

  _collageFlipStep(){
    const P = this.P, ms = this._metrics || [];
    for(let i=0; i<ms.length; i++){
      const m = ms[i], col = m.col || 0, line = m.line || 0, cp = (m.el && m.el._cp) || 0;
      const h1 = this._hash(col + line*17, cp, 911.17);
      const h2 = this._hash(col*3 + line*11, cp, 273.41);
      const h3 = this._hash(col*5 + line*7, cp, 631.93);
      m.toggled = true;
      m.tgt = (0.35 + h1*1.25) * Math.max(0.1, P.randomness);
      m.rX = h2*2 - 1;
      m.rY = h3*2 - 1;
      m.geo = h1 < Math.min(1, P.geoRatio + 0.28);
      this._staticOps(m);
    }
    this._easeAll();
  },

  _patternFlipStep(law, pulse){
    const P = this.P, ms = this._metrics || [], t = this._t;
    const rate = Math.max(0.05, P.flipRate * (pulse == null ? 1 : pulse));
    for(let i=0; i<ms.length; i++){
      const m = ms[i], col = m.col || 0, line = m.line || 0;
      let target = 0, rx = m.seedX || 0, ry = m.seedY || 0, geo = m.geo;
      if(law === 'wave'){
        const ph = t*rate*1.65 + col*0.32 + line*0.78;
        const raw = 0.5 + 0.5*Math.sin(ph);
        target = Math.pow(raw, 1.45);
        rx = Math.sin(ph + 0.8);
        ry = Math.cos(ph*0.7);
        geo = raw > (1 - Math.max(0.05, P.geoRatio));
      }else if(law === 'grid'){
        const block = Math.floor(col/3) + Math.floor(line/2)*3;
        const step = Math.floor(t*rate*2.2);
        const on = ((step + block) % 4) === 0;
        target = on ? (0.55 + ((block % 3) * 0.18)) : 0;
        rx = (block % 2) ? 1 : -1;
        ry = ((block % 3) - 1) * 0.75;
        geo = true;
      }else {
        const dist = Math.sqrt(col*col + line*line);
        const raw = Math.max(0, Math.sin(t*rate*2.6 - dist*0.34));
        target = raw*raw;
        rx = col === 0 ? 0 : (col > 0 ? 1 : -1);
        ry = line === 0 ? 0 : (line > 0 ? 1 : -1);
        geo = raw > (1 - Math.max(0.05, P.geoRatio));
      }
      m.toggled = target > 0.02;
      m.tgt = target;
      m.rX = rx;
      m.rY = ry;
      m.geo = geo;
      this._staticOps(m);
    }
    this._easeAll();
  },

  _easeAll(){
    const P = this.P, ms = this._metrics || [];
    for(let i=0; i<ms.length; i++){
      const info = ms[i];
      const target = info.toggled ? (info.tgt != null ? info.tgt : 1.0) : 0.0;
      const diff = target - info.intensity;
      if(diff < 0.0015 && diff > -0.0015){
        if(info.intensity !== target){ info.intensity = target; this._applyStretch(info); }
        continue;
      }
      info.intensity += diff * P.ease;
      this._applyStretch(info);
    }
  },

  // ---- glyph スナップショット(インライン style + キャッシュ計測から) ----
  // 一文字ずつ入力: 今の拍で見せる文字数 (Off は全部)。文字列か文字数が変わったら、その拍から数え直す
  _typedCount(n){
    const P = this.P;
    if(P.typeOn !== 'on' || this._typeAll) return n;   // _typeAll = Canvas がスタンプを焼き付けている間
    const beat = this._beatNow || 0, key = n + '|' + P.text;
    if(this._twKey !== key || beat < this._twStart){ this._twKey = key; this._twStart = beat; this._twShown = 0; }
    const cpb = Math.max(0.25, +P.typeSpeed || 2), hold = Math.max(0, +P.typeHold || 0);
    let ph = beat - this._twStart;
    if(hold > 0){ const cyc = n/cpb + hold; if(ph >= cyc){ this._twStart += Math.floor(ph/cyc)*cyc; ph = beat - this._twStart; } }
    const want = Math.min(n, Math.floor(ph*cpb) + 1);
    // 速い設定 (16 / 32 per beat) でも 1 フレームに増やすのは 1 文字まで (同時に何文字も出さず、1 文字ずつ打っているように見せる)
    const frame = (typeof GL !== 'undefined' && GL.frame != null) ? GL.frame : 0, prev = this._twShown || 0;
    if(want <= prev || this._twFrame === frame) return this._twShown = Math.min(want, Math.max(prev, 1));
    this._twFrame = frame;
    return this._twShown = prev + 1;
  },
  _snapshotGlyphs(fx){
    const P = this.P, ms = this._metrics || [], out = [];
    const fs = P.fontSize, vert = !!P.vertical, ctr = this._ctr, tt = this._t || 0;
    const tstep = Math.floor(tt*12);
    const typed = this._typedCount(ms.length);
    for(let i=0; i<ms.length; i++){
      if(i >= typed) break;
      const m = ms[i], st = m.el.style;
      const sx = parseFloat(st.getPropertyValue('--sx')) || 1;
      const sy = parseFloat(st.getPropertyValue('--sy')) || 1;
      const ix = parseFloat(st.getPropertyValue('--ix')) || 1;
      const iy = parseFloat(st.getPropertyValue('--iy')) || 1;
      let tx = (parseFloat(st.getPropertyValue('--tx')) || 0) * fs;
      let ty = (parseFloat(st.getPropertyValue('--ty')) || 0) * fs;
      let rot = parseFloat(st.getPropertyValue('--rot')) || 0;
      const x = m.relX - m.w/2, y = m.relY - m.h/2, w = m.w, hh = m.h;
      let scaleX = sx*ix, scaleY = sy*iy, skx = m.opSkXV || 0;
      if(fx.glyph){
        if(fx.show < 100 && this._h(i, 907.31) > fx.show/100) continue;
        if(fx.sizeVar){
          const f = Math.max(0.2, 1 + (this._h(i, 31.7)*2 - 1)*fx.sizeVar/100);
          scaleX *= f; scaleY *= f;
        }
        if(fx.scatter){
          const a = this._h(i, 41.3)*6.2832, r = this._h(i, 53.9)*fx.scatter/100*fs;
          tx += Math.cos(a)*r; ty += Math.sin(a)*r;
        }
        if(fx.tremor){
          const q = fx.tremor/100*fs;
          tx += (this._h(i + tstep*0.7131, 61.9)*2 - 1)*q; ty += (this._h(i + tstep*0.7131, 73.3)*2 - 1)*q;
        }
        if(fx.waveAmp){
          const pos = vert ? y + hh/2 : x + w/2;
          const o = Math.sin(pos/(fs*fx.waveLen)*6.2832 + tt*1.6)*fx.waveAmp/100*fs;
          if(vert) tx += o; else ty += o;
        }
        if(fx.stagger){
          const o = Math.sin((m.line || 0)*1.1)*fx.stagger/100*fs;
          if(vert) ty += o; else tx += o;
        }
        if((fx.swirl || fx.bulge) && ctr){
          const gx = x + w/2 - ctr.x, gy = y + hh/2 - ctr.y;
          const u = Math.min(1, Math.sqrt(gx*gx + gy*gy)/ctr.R);
          let px = gx, py = gy;
          if(fx.swirl){
            const a = fx.swirl*u*Math.PI/180, c = Math.cos(a), sn = Math.sin(a);
            px = gx*c - gy*sn; py = gx*sn + gy*c;
            rot += fx.swirl*u;
          }
          if(fx.bulge){
            const k = Math.max(0.3, 1 + fx.bulge/100*u*u);
            px *= k; py *= k; scaleX *= k; scaleY *= k;
          }
          tx += px - gx; ty += py - gy;
        }
        if(fx.slant) skx += fx.slant;
      }
      out.push({ ch: m.dispCh || m.el.textContent, upright: m.el._info.upright, accent: m.el._accent,
        x, y, w, h: hh, ox: x + w*fx.pivX, oy: y + hh*fx.pivY, tx, ty, rot, scaleX, scaleY,
        opRot: m.opRotV || 0, skx, sky: m.opSkYV || 0, bl: m.opBlV || 0,
        mirX: m.opMirXV == null ? 1 : m.opMirXV, mirY: m.opMirYV == null ? 1 : m.opMirYV,
        misX: m.opMisXV || 0, misY: m.opMisYV || 0, i, n: ms.length, inten: m.intensity || 0 });
    }
    return out;
  },

  // _snapshotGlyphs の 1 文字を上流 type-deformer の snapshotGlyphs 形式へ変換 (Composition / Surface 共通)。
  // off = ステージ座標に足す平行移動量。
  _upstreamGlyph(g, offX, offY){
    const P = this.P, fs = P.fontSize;
    const x = g.x + offX, y = g.y + offY;
    return {
      ch: g.ch, sourceText: g.ch, direction: 'ltr', upright: !!g.upright, accent: !!g.accent, opacity: 1,
      fontFamily: this._fontStack(this.family()), fontWeight: this.weight(), fontAxes: null,
      line: 0, word: 0, batchKey: '', textObject: '',
      x: x, y: y, w: g.w, h: g.h,
      bx: x, by: y, bw: g.w, bh: g.h,
      grid: !!P.gridEnabled,
      ox: g.ox + offX, oy: g.oy + offY,
      tx: g.tx + (P.vertical ? (g.bl || 0)*fs : 0),
      ty: g.ty + (P.vertical ? 0 : -(g.bl || 0)*fs),
      rot: (g.rot || 0) + (g.opRot || 0),
      skewX: g.skx || 0, skewY: g.sky || 0,
      scaleX: (g.scaleX || 1)*(g.mirX == null ? 1 : g.mirX),
      scaleY: (g.scaleY || 1)*(g.mirY == null ? 1 : g.mirY),
      misregX: g.misX || 0, misregY: g.misY || 0
    };
  },

  // 毎フレームの追加 param (第 2 弾) を deadParam を通して読む。glyph = 文字ごとの加工が要るか
  _dp(v){ return (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v; },
  _h(i, k){ const v = Math.sin(i*12.9898 + k*78.233)*43758.5453; return v - Math.floor(v); },
  _hexRGB(hex){
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
  },
  _hexOKLab(hex){
    if(typeof hex !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return null;
    const rgb = this._hexRGB(hex.length === 4 ? '#' + [...hex.slice(1)].map(c=>c + c).join('') : hex);
    const [r, g, b] = rgb.map(v=>{ v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055)**2.4; });
    const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
    const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
    const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
    return [0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
      1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
      0.0259040371*l + 0.7827717662*m - 0.8086757660*s];
  },
  _okLabHex([L, a, b]){
    const l = (L + 0.3963377774*a + 0.2158037573*b)**3;
    const m = (L - 0.1055613458*a - 0.0638541728*b)**3;
    const s = (L - 0.0894841775*a - 1.2914855480*b)**3;
    return '#' + [4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
      -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
      -0.0041960863*l - 0.7034186147*m + 1.7076147010*s].map(v=>{
      v = v <= 0.0031308 ? 12.92*v : 1.055*v**(1 / 2.4) - 0.055;
      return Math.round(Math.max(0, Math.min(255, v*255))).toString(16).padStart(2, '0');
    }).join('');
  },
  _readFx(){
    const P = this.P, n = (v, d)=>{ v = +v; return Number.isFinite(v) ? v : d; };
    const dp = v=>this._dp(v);
    const fx = {
      show: n(P.showPct, 100), sizeVar: dp(n(P.sizeVar, 0)), scatter: dp(n(P.scatter, 0)), tremor: dp(n(P.tremor, 0)),
      waveAmp: dp(n(P.waveAmp, 0)), waveLen: Math.max(1, n(P.waveLen, 10)), stagger: dp(n(P.lineStagger, 0)),
      slant: dp(n(P.slant, 0)), swirl: dp(n(P.swirl, 0)), bulge: dp(n(P.bulge, 0)), viewAngle: dp(n(P.viewAngle, 0)),
      pivX: n(P.pivotX, 50)/100, pivY: n(P.pivotY, 75)/100,
      misA: n(P.misregAlpha, 72)/100, misR: n(P.misregRatio, 65)/100,
      trail: Math.min(90, dp(n(P.trailPct, 0))), aom: dp(n(P.accentOnMove, 0)),
      rb: Math.min(100, dp(n(P.rainbow, 0))), rbSpan: n(P.rainbowSpan, 360),
      vig: Math.min(100, dp(n(P.vignette, 0))), grain: Math.min(100, dp(n(P.grain, 0))), grainSize: Math.max(1, n(P.grainSize, 100)/100)
    };
    fx.glyph = P.typeOn === 'on' || fx.show < 100 || !!(fx.sizeVar || fx.scatter || fx.tremor || fx.waveAmp || fx.stagger || fx.swirl || fx.bulge || fx.slant);
    return fx;
  },
  // 文字色: 虹色 (accent 以外) → accent への寄せ (動いている文字ほど)
  _glyphColor(g, col, fx){
    const c = this._hexRGB(col);
    if(!c) return col;
    let r = c[0], gg = c[1], b = c[2];
    if(fx.rb && !g.accent){
      const hue = (g.n > 1 ? g.i/(g.n - 1) : 0)*fx.rbSpan;
      const a = 0.85*Math.min(0.58, 1 - 0.58);   // 彩度 0.85 / 明度 0.58 の HSL
      const f = k=>{ const q = (k + hue/30) % 12; return 0.58 - a*Math.max(-1, Math.min(Math.min(q - 3, 9 - q), 1)); };
      const k = fx.rb/100;
      r += (f(0)*255 - r)*k; gg += (f(8)*255 - gg)*k; b += (f(4)*255 - b)*k;
    }
    if(fx.aom){
      const k = Math.min(1, g.inten*fx.aom/100), ac = this._hexRGB(this.color('accent'));
      if(k > 0 && ac){ r += (ac[0] - r)*k; gg += (ac[1] - gg)*k; b += (ac[2] - b)*k; }
    }
    return 'rgb(' + Math.round(r) + ',' + Math.round(gg) + ',' + Math.round(b) + ')';
  },
  // 周辺減光 / フィルムグレイン (全面。Composition 有効時にも掛かる)
  _overlayFx(ctx, w, h, fx){
    if(this._heroPass) return;   // Canvas のスタンプの焼き付けには掛けない (縁まで塗られ、スタンプの四角が白く・暗く見えていた)
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation = 'source-over';
    if(fx.vig){
      const c = this._hexRGB(this.P.palOn === true ? this.color('ink') : this.P.vignetteColor) || [0, 0, 0], R = Math.sqrt(w*w + h*h)/2;
      const gr = ctx.createRadialGradient(w/2, h/2, R*0.3, w/2, h/2, R), rgb = c[0] + ',' + c[1] + ',' + c[2];
      gr.addColorStop(0, 'rgba(' + rgb + ',0)'); gr.addColorStop(1, 'rgba(' + rgb + ',' + (fx.vig/100*0.9).toFixed(3) + ')');
      ctx.globalAlpha = 1; ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    }
    if(fx.grain){
      if(!this._grainPat){
        const tc = document.createElement('canvas'); tc.width = tc.height = 128;
        const tx = tc.getContext('2d'), id = tx.createImageData(128, 128), d = id.data;
        for(let k=0; k<16384; k++){
          const v = this._h(k, 5.5);
          d[k*4] = d[k*4+1] = d[k*4+2] = v > 0.5 ? 255 : 0;
          d[k*4+3] = Math.round(Math.abs(v - 0.5)*2*255);
        }
        tx.putImageData(id, 0, 0);
        this._grainPat = ctx.createPattern(tc, 'repeat');
      }
      const gs = fx.grainSize, f = Math.floor((this._t || 0)*24);
      const ox = Math.floor(this._h(f, 9.1)*128), oy = Math.floor(this._h(f, 19.7)*128);
      ctx.setTransform(gs, 0, 0, gs, 0, 0); ctx.translate(-ox, -oy);
      ctx.globalAlpha = fx.grain/100*0.3; ctx.fillStyle = this._grainPat;
      ctx.fillRect(ox, oy, w/gs + 1, h/gs + 1);
      ctx.setTransform(1,0,0,1,0,0);
    }
    ctx.globalAlpha = 1;
  },

  _fontMetrics(ctx){
    ctx.font = this.weight() + ' ' + this.P.fontSize + 'px ' + this._fontStack(this.family());
    const m = ctx.measureText('国Hg');
    const ascent = (m.fontBoundingBoxAscent != null) ? m.fontBoundingBoxAscent : this.P.fontSize*0.88;
    const descent = (m.fontBoundingBoxDescent != null) ? m.fontBoundingBoxDescent : this.P.fontSize*0.12;
    return { ascent, descent };
  },

  // 版面(変形前)の外接矩形からフィット変換を固定計算。変形しても全体がリスケール/シフトしない。
  _computeFit(w, h){
    const P = this.P, ms = this._metrics || [];
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    for(let i=0; i<ms.length; i++){
      const m = ms[i], x0 = m.relX - m.w/2, y0 = m.relY - m.h/2;
      if(x0<minX)minX=x0; if(y0<minY)minY=y0;
      if(m.relX+m.w/2>maxX)maxX=m.relX+m.w/2; if(m.relY+m.h/2>maxY)maxY=m.relY+m.h/2;
    }
    if(!ms.length){ minX=minY=0; maxX=maxY=100; }
    const pad = Math.max(w,h)*0.03;
    const bx=minX-pad, by=minY-pad, bw=(maxX-minX)+pad*2, bh=(maxY-minY)+pad*2;
    const mg = Math.min(w,h) * P.marginPct/100;
    const availW = Math.max(1, w-2*mg), availH = Math.max(1, h-2*mg);
    const mode = String(P.fitMode || 'fit');
    // 共通の縦横比 (comScaleX / Y) は GL で版面の中心から伸ばすので、伸ばした後の大きさで画面に合わせる
    const cx = Math.max(0.1, +P.comScaleX || 1), cy = Math.max(0.1, +P.comScaleY || 1);
    let s = Math.min(availW/(bw*cx), availH/(bh*cy));
    if(mode === 'crop') s = Math.max(availW/(bw*cx), availH/(bh*cy));
    else if(mode === 'actual') s = 1;
    s *= Math.max(0.05, parseFloat(P.zoom) || 1);
    const dx = mg + (availW - bw*s)*0.5 - bx*s + (parseFloat(P.panX) || 0) * w;
    const dy = mg + (availH - bh*s)*0.5 - by*s + (parseFloat(P.panY) || 0) * h;
    this._fit = { s, dx, dy, w, h, cx, cy };
    this._ctr = { x: bx + bw/2, y: by + bh/2, R: Math.max(1, Math.sqrt(bw*bw + bh*bh)/2) };
  },

  // 2D canvas に (w×h の artboard として) 中央フィットで描画
  _renderToCanvas(w, h){
    const P = this.P;
    const cv = this.canvas, ctx = this.ctx;
    if(cv.width !== w || cv.height !== h){ cv.width = w; cv.height = h; }
    const fx = this._readFx();
    // Canvas のスタンプ (分身 = this._stamp) と主役・焼き付け (_heroPass) は全体共通の Composition を描かない (Canvas の間は紙とスタンプのあいだに敷く)
    const comp = !this._stamp && !this._heroPass && (typeof TDComp !== 'undefined' && TDComp.enabled());
    if(!P.transparentBg){
      ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle = this.color('paper');
      if(fx.trail && !comp){ ctx.globalAlpha = 1 - fx.trail/100; ctx.fillRect(0,0,w,h); ctx.globalAlpha = 1; }   // 残像: 紙を薄く塗り重ねる
      else ctx.fillRect(0,0,w,h);
    }
    else { ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,w,h); }
    // Canvas: 紙 → 本体の Composition → スタンプの順に重ねる (本体の文字は描かない)
    if(!this._stamp && !this._heroPass && typeof TDCanvas !== 'undefined' && TDCanvas.active()){
      // 焼き付け中は本体の値がスタンプのものに替わっているので、焼き付けを始めたときの背景 (紙 + Composition) を敷く
      const hold = TDCanvas._bake && TDCanvas._bgHold;
      if(hold && hold.width === w && hold.height === h){ ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,w,h); ctx.drawImage(hold, 0, 0); }
      else if(comp) TDComp.render(ctx, w, h, { noGuides: true });   // スタンプの下に敷くのでガイドの枠線は描かない
      TDCanvas.draw(ctx, w, h);
      // 本体の Look の周辺減光・グレインは、Canvas の間は画面全体に掛けない (C Main FX で戻せる)
      if(P.canvasMainFx) this._overlayFx(ctx, w, h, fx);
      ctx.setTransform(1,0,0,1,0,0);
      return;
    }
    // Composition 有効時は生成シーン描画に切替 (文字の直接描画は行わない)。
    // エンジン読み込み中・生成失敗のとき (render が false) は素の文字を描く
    if(comp && TDComp.render(ctx, w, h) !== false){
      this._overlayFx(ctx, w, h, fx);
      ctx.setTransform(1,0,0,1,0,0);
      return;
    }
    // 固定フィット(版面ベース)。テキスト/サイズ変更 or 解像度変更時のみ再計算。
    const f = this._fit;
    if(!f || f.w !== w || f.h !== h || this._fitDirty || f.cx !== (+P.comScaleX || 1) || f.cy !== (+P.comScaleY || 1)){ this._fitDirty = false; this._computeFit(w, h); }
    const glyphs = this._snapshotGlyphs(fx);
    const s = this._fit.s, dx = this._fit.dx, dy = this._fit.dy;
    const fm = this._fontMetrics(ctx);
    const font = this.weight() + ' ' + P.fontSize + 'px ' + this._fontStack(this.family());
    const grid = !!P.gridEnabled;
    const fs = P.fontSize;
    const va = fx.viewAngle*Math.PI/180;
    // Canvas のスタンプ / 主役: 伸び縮み・ずらしで文字がキャンバスの縁から出る量 (1 = ちょうど収まる)。TDCanvas が次のフレームの余白を決める
    if(this._stamp || this._heroPass){
      let need = 0;
      for(const g of glyphs){
        const sx = Math.abs(g.scaleX*(g.mirX == null ? 1 : g.mirX)) || 1, sy = Math.abs(g.scaleY*(g.mirY == null ? 1 : g.mirY)) || 1;
        const cx = g.ox + g.tx + (g.x + g.w/2 - g.ox)*sx, cy = g.oy + g.ty + (g.y + g.h/2 - g.oy)*sy;
        const r = 0.6*Math.max(g.w, g.h)*Math.max(sx, sy) + Math.abs(g.misX || 0) + Math.abs(g.misY || 0);
        need = Math.max(need, (Math.abs(dx + s*cx - w/2) + s*r)/(w/2), (Math.abs(dy + s*cy - h/2) + s*r)/(h/2));
      }
      this._needPf = need;
    }
    // Vector 3D: 文字の輪郭の頂点を 3D で描く (Surface の効果は重ねない)
    if(!this._stamp && typeof TDVec !== 'undefined' && TDVec.active()){
      TDVec.draw(ctx, glyphs, { w, h, s, dx, dy, va });
      this._overlayFx(ctx, w, h, fx);
      ctx.setTransform(1,0,0,1,0,0);
      return;
    }
    // Surface: 効果が掛かる文字は元の字を sourceAlpha で薄め (hide なら描かない)、上に効果レイヤーを重ねる
    const surf = (!this._stamp && typeof TDSurf !== 'undefined' && TDSurf.active()) ? TDSurf : null;
    const surfSrcA = surf ? surf.sourceAlpha() : 1;
    if(surf) surf.request(glyphs, w, h);
    // Operator を含む1パス描画。misreg のオフセットはフィット前のステージ座標系 (元アプリの page 座標に相当)
    const drawPass = (g, blX, blY, offX, offY, fill, alpha, blend)=>{
      ctx.setTransform(1,0,0,1,0,0);
      if(va){ ctx.translate(w/2, h/2); ctx.rotate(va); ctx.translate(-w/2, -h/2); }
      ctx.translate(dx, dy); ctx.scale(s, s);
      ctx.translate(offX, offY);
      ctx.translate(g.ox+g.tx+blX, g.oy+g.ty+blY);
      ctx.rotate(((g.rot||0)+(g.opRot||0))*Math.PI/180);
      if(g.skx || g.sky) ctx.transform(1, Math.tan((g.sky||0)*Math.PI/180), Math.tan((g.skx||0)*Math.PI/180), 1, 0, 0);
      const mx = Math.abs(g.mirX) < 0.02 ? 0.02 : g.mirX;   // scale 0 の退化行列を避ける
      const my = Math.abs(g.mirY) < 0.02 ? 0.02 : g.mirY;
      ctx.scale(g.scaleX*mx, g.scaleY*my);
      ctx.translate(-g.ox, -g.oy);
      ctx.font = font;
      ctx.fillStyle = fill;
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = blend;
      const put = (px, py)=>{ ctx.fillText(g.ch, px, py); };
      if(P.vertical || grid){
        const cx = g.x+g.w/2, cy = g.y+g.h/2;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if(P.vertical && !g.upright){ ctx.translate(cx,cy); ctx.rotate(Math.PI/2); put(0,0); }
        else put(cx, cy);
      } else {
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        const leading = g.h - (fm.ascent + fm.descent);
        put(g.x, g.y + leading/2 + fm.ascent);
      }
    };
    for(let i=0; i<glyphs.length; i++){
      const g = glyphs[i];
      const sa = (surf && surf.glyphActive(g.i)) ? surfSrcA : 1;
      if(sa <= 0) continue;
      const blX = P.vertical ? g.bl*fs : 0;    // baseline shift: 縦組=左右 / 横組=上下
      const blY = P.vertical ? 0 : -g.bl*fs;
      if(g.misX || g.misY){
        // 版ずれ2色刷り: A=+offset / B=-ratio×offset を multiply で敷き、上に本来のインク
        drawPass(g, blX, blY, g.misX, g.misY, this.roleColor(P.misregColorA, 'accent'), fx.misA*sa, 'multiply');
        drawPass(g, blX, blY, -g.misX*fx.misR, -g.misY*fx.misR, this.roleColor(P.misregColorB, 'ink'), fx.misA*sa, 'multiply');
      }
      let ink = this.color(g.accent ? 'accent' : 'ink');
      if(fx.rb || fx.aom) ink = this._glyphColor(g, ink, fx);
      drawPass(g, blX, blY, 0, 0, ink, sa, 'source-over');
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if(surf){
      surf.draw(ctx, w, h, va);
      // 半透明だった効果を不透明にした Look は、元の字を効果の上にもう一度描く (元の字を隠す作り = sourceAlpha 0 の字は描かない)
      if(surfSrcA > 0 && surf.textOnTop()){
        for(const g of glyphs){
          if(!surf.glyphActive(g.i)) continue;
          let ink = this.color(g.accent ? 'accent' : 'ink');
          if(fx.rb || fx.aom) ink = this._glyphColor(g, ink, fx);
          drawPass(g, P.vertical ? g.bl*fs : 0, P.vertical ? 0 : -g.bl*fs, 0, 0, ink, surfSrcA, 'source-over');
        }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
    }
    this._overlayFx(ctx, w, h, fx);
    ctx.setTransform(1,0,0,1,0,0);
  },

  render(opts){
    if(!this.initialized) return;
    const gl = this.gl, { fbo, w, h } = opts;
    // ステージが空(未計測)なら紙だけ塗る
    const t0 = performance.now();
    // Slot B (opts.opaque === false) は紙を塗らずに描く (保存される P.transparentBg は書き換えない)
    const bg0 = this.P.transparentBg;
    if(opts.opaque === false) this.P.transparentBg = true;
    try{ this._renderToCanvas(w, h); } finally { this.P.transparentBg = bg0; }
    // 描画時間の移動平均 (ms)。Random の負荷ガード (app.js の guardedTextDeformRandom) が見る
    const dt = performance.now() - t0;
    this._renderMs = this._renderMs == null ? dt : this._renderMs*0.7 + dt*0.3;

    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    try{ gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas); }
    catch(e){ return; }

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0,0,w,h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.locTex, 0);
    gl.uniform2f(gl.getUniformLocation(this.prog, 'u_sc'), Math.max(0.1, +this.P.comScaleX || 1), Math.max(0.1, +this.P.comScaleY || 1));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(this.locPos);
    gl.vertexAttribPointer(this.locPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
};
// 既定値はスクリプト読み込み時に取る (init より先に状態の復元が P を書き換えるため)
TextDeform.PDefaults = JSON.parse(JSON.stringify(TextDeform.P));
// Params パネルのホバー説明 (app.js の bindEngineHints)。キー = 行の data-pkey (data-tdp のキー、無い行は操作部品の id)
TextDeform.PARAM_HELP = {
  // Look
  lookRand: 'ランダム (🎲・Look Auto・→ キー・Canvas のスタンプ選び) の範囲。Off = ランダムを切る (🎲・Look Auto・→ は何もしない。Canvas のスタンプは Current Look、C Auto Swap も止まる) / ★ オススメ = 作者のオススメだけ / 全プリセット = 436 案すべて。保存 Look は Look の一覧どおり',
  tdLookPool: '一覧に出す Look の範囲。All = 全プリセット + 保存 Look / ★ Recommended = 作者のオススメ / All presets = 上流の 436 案 / 系統ごと / Saved = 保存 Look。🎲 と Look Auto もこの中から選ぶ (プリセットは L Random の範囲)',
  lookEvery: 'この拍数ごとに一覧から Look を引き直す (Off で止める)。重い Surface を含む Featured は選ばない',
  tdRandGuard: 'Random の負荷ガード: 当てる前に 1 フレーム試し描きし、この fps を保てない Look は引き直す。当てた後も 3 秒見張り、重くなったら元に戻す',
  // Text
  textMode: '表示する文字の出どころ。Look = Look の語 (Featured はサムネと同じ語) / Random = テキストプリセットから拍ごと / Custom = 下の入力欄',
  textPool: 'Random で使う文字の種類。押すたびに On / Off し、On の種類を混ぜて使う (漢字・四字熟語・文学の一節・哲学の言葉など)。All = 長文以外の全部 (ほかを選ぶと外れる)。全部 Off にはならない',
  textEvery: 'Random で文字を替える間隔 (拍)。T Type が On のときは、全文を打ち終えてから次の区切りで替える',
  typeOn: '一文字ずつ入力 (タイプライター)。On = 文字が拍に合わせて一文字ずつ現れる (全 Look 共通・Canvas のスタンプもそれぞれ入力する)。文字が替わると最初から',
  typeSpeed: '入力の速さ (1 拍あたりの文字数)',
  typeHold: '全部入力したあと、最初に戻るまで待つ拍数 (Keep = 全文を出したまま)',
  tdTextCustom: '表示する文字を直接入力する (改行可)。入力すると Text が Custom に切り替わる (パネルの一番上)',
  // Rhythm (全 Look 共通)
  rhythmMotion: '動きの量 (全 Look 共通の倍率)。文字の動き出しの頻度と Surface / Composition の速さに掛かる。Look を切り替えても変わらない',
  rhythmAudio: '音への反応の強さ (全 Look 共通)。音の立ち上がりで動きが脈打つ',
  beatPulse: '拍で脈打つ量 (全 Look 共通)。beat モードのとき、または R BPM が On で無音のときに効く',
  rhythmBpm: 'On なら音が無いとき (音声入力 Off を含む) も BPM の拍で脈打つ。drone モードでも効く',
  // 共通パレット
  palOn: '共通パレット (全 Look 共通)。On = 各 Look の色 (Surface の効果色を含む) を、Look の紙・インク・アクセントのうちいちばん近い役割に割り当て、色みは Key / Base / Accent に揃えて明るさの差だけ残す。版ずれは A = Accent / B = Key、周辺減光は Key。Off = 各 Look の色のまま。Paper only = 背景 (紙) だけ Base に固定し、文字と効果の色は各 Look のまま。Rainbow は対象外',
  palPaper: 'Base = 紙 (背景) と、紙に近い効果の色',
  palInk: 'Key = 文字 (インク) と、インクに近い効果の色',
  palAccent: 'Accent = アクセントと、それに近い効果の色',
  fontOver: '共通フォント (全 Look 共通の上書き)。Off なら各 Look の書体 (明朝 = 游明朝 → リュウミン、ゴシック = 秀英角ゴ銀、欧文サンセリフ = Aratana の優先ルールどおり)。端末に無い書体は次の候補に落ちる',
  comScaleX: '共通の文字の横幅 (全 Look 共通)。1 = 等倍、1 より大きいと横に伸び、小さいと細くなる。Surface・Composition の効果も同じ比率で伸びる',
  comScaleY: '共通の文字の高さ (全 Look 共通)。1 = 等倍、1 より大きいと縦に伸びる',
  comTrack: '共通の字間 (全 Look 共通、em)。各 Look の字間に足す。0 = Look のまま',
  comLeading: '共通の行送り (全 Look 共通の倍率)。各 Look の行送りに掛ける。1 = Look のまま',
  canvasOn: 'Canvas (全 Look 共通): Look をスタンプのように画面に複数置いて一枚の構成を作る。ステージをクリック = 押す / 押したままドラッグ = 連射 / スタンプをドラッグ = 移動 / ホイール = 大きさ / Shift+ホイール = 回転 / Shift+クリック = 削除',
  canvasSource: 'Canvas で押す Look。Current = いまの Look / Random = Look Pool からランダム (重い Surface を含む Featured は除く)',
  cvSize: 'スタンプごとの大きさのばらつき (0 = そろえる、1 = 0.25〜4 倍。途中は連続)',
  cvRot: 'スタンプごとの回転のばらつき (-1〜+1。1 = ±90°、マイナスはスタンプごとに回る向きが逆になる)',
  cvPos: 'スタンプごとの位置のばらつき (画面に対する ± 比)',
  cvStretch: 'スタンプごとの伸び縮み (Stretch X / Y) のばらつき',
  cvOpacity: 'スタンプごとの不透明度のばらつき (1 = 0〜1 の間でばらける)',
  cvHue: 'スタンプごとの色相のばらつき (± 度)',
  cvDrift: 'スタンプごとの漂う動きの大きさと速さのばらつき',
  cvSpeed: 'スタンプごとの文字の動き出しの速さのばらつき',
  cvAspect: 'Canvas のスタンプごとの縦横比のばらつき (1 = 横長〜縦長に大きくばらける)',
  cvTrack: 'Canvas のスタンプごとの字間のばらつき (± em)',
  cvLeading: 'Canvas のスタンプごとの行送りのばらつき (倍率の ±)',
  cvReact: 'Canvas のスタンプごとの拍・音への反応のばらつき (1 = 反応しないもの〜2 倍のものまで)',
  canvasLayout: 'ワンボタンのレイアウト: 選ぶと枚数 (少なければ 7 枚)・大小・位置・角度をまとめて決め、スタンプがその位置へ流れるように動く。Hero = 大 1 を大胆にずらして (端・はみ出し・中央のどれか。組む・Swap・Auto Layout のたびに変わる) / Grid = 格子 / Diagonal = 対角線 / Frame = 縁に並べて中央を空ける / Cascade = 大→小の重なり / Scatter = 余白を保って散らす。Free = 大きさ・角度・位置を自由に (組むたびに変わる。重なりすぎ・画面外ばかりにはしない)。Random = ランダムな周期 (2 / 4 / 8 / 16 拍。beat xA に同期) で構成方法そのものを入れ替え続ける。構成主義の配置: Slash = 強い対角線 / Scale = 極端な大小 / Cross = 縦組み × 横組みの交差 / Radial = 放射 / Wedge = くさびと円 / Stairs = 階段。🎲 = 別のレイアウトをランダムに',
  canvasAutoLayout: 'この拍数ごとに別のレイアウトへ組み替える (スタンプは流れるように移動する)。Off で止める',
  canvasTiming: 'スタンプの出かた。Sync = レイアウトを組むとまとめて出る / Machine Gun = Manga のマシンガンのように、拍の刻みごとに 1 枚ずつ弾んで出る (レイアウトの組み替え・呼び出しのたびに撃ち直す)',
  canvasGunDiv: 'Machine Gun の速さ: 1 拍に何枚撃つか',
  canvasGunOrder: 'Machine Gun の順番: Layout = 大きい順 / Random = ランダム / Sweep = 左から右へ',
  canvasFull: 'Look の完全再現: Surface・Vector 3D を持つスタンプを、本体で描いて焼き付ける。Live = 置いたときに焼き付け、そのあと順番に描き直して動かす (重いときは間引く) / Bake = 置いたときだけ / Off = 文字の動きだけ (Surface などは載らない)',
  canvasFullEvery: 'Live の描き直しの間隔 (ミリ秒)。1 枚ずつ順番に描き直すので、枚数が多いほど 1 枚あたりの更新はゆっくりになる',
  canvasMove: 'スタンプの動き。Glide = レイアウトの組み替え・Swap などで新しい位置へなめらかに移り、ふだんも漂う / Jump = 移動のアニメなしで瞬間的に置き直す (漂わない)',
  canvasJumpEvery: 'この拍数ごとに、全スタンプをランダムな位置へ置き直す (大きさ・角度はそのまま。位置は Random レイアウトと同じく重なりと画面の端を避ける)。Jump と組み合わせると瞬間的に入れ替わる',
  canvasMainFx: 'Canvas の間も、本体の Look の周辺減光 (ビネット)・グレインを画面全体に掛けるか。Off (既定) = 掛けない',
  canvasPlate: '文字の見えにくさ対策。Auto = インクと背景の紙の明るさが近いスタンプにだけ、その Look の紙を敷く / Paper = いつも敷く / Shadow = 柔らかい影 / Off',
  canvasAutoAdd: 'この拍数ごとに自動でスタンプを押す (場所はランダム、Look は C Source のとおり)。Off で止める',
  canvasAutoSwap: 'この拍数ごとに、ランダムなスタンプ 1 つの Look を Look Pool から差し替える (主役と焼き付けは対象外)',
  canvasAutoClear: 'この拍数ごとに一掃して組み直す: 全スタンプを今のレイアウトに並べ直す (流れるように動く。Machine Gun なら 1 枚ずつ撃ち直す)。Auto Add で増えたぶんは 7 枚まで減らす',
  canvasMax: 'Canvas に置ける数。超えたら古いものから消える (多いほど重い)',
  tdCompSaved: '保存した Composition。選ぶと Composition だけを入れ替える (Look とは独立、全端末で共通、保存のたびに世代が残る)。Comp Rand が On なら次の切替で引き直される',
  tdCanvasSaved: '保存した Canvas の構成。選ぶと呼び出す (全端末で共通、保存のたびに世代が残る)',
  vecMode: 'Vector 3D (試作・全 Look 共通): 文字の輪郭を頂点の列にして 3D で描く。Fill = 塗り / Wire = 線 / Points = 頂点の点。On の間は Surface の効果を重ねない',
  vecSpin: 'Vector 3D の Y 軸の回転の速さ (度 / 秒)。Rhythm の量と拍・音の脈動が掛かる',
  vecTilt: 'Vector 3D の前後の傾き (度)',
  vecWave: 'Vector 3D の Z の波 (版面がうねる量)',
  vecAudio: 'Vector 3D の頂点ごとの揺れ。音の立ち上がりと拍で強まる',
  vecDepth: 'Vector 3D の遠近の強さ (0 = ほぼ平行投影、1 = 強い遠近)',
  vecDetail: 'Vector 3D の頂点の間隔 (小さいほど細かく重い)',
  vecLine: 'Vector 3D の線の太さ / 点の大きさ',
  compRandEvery: 'Comp Random (全 Look 共通。Canvas + Composition 欄): 右の単位 (拍 / 秒) の間隔ごとに Composition をランダムに切り替える (重い Contour Atlas と Field は除く。手動・Comp Saved では選べる)。Off なら Composition は変わらない',
  // Type & Color
  paper: 'この Look の紙 (背景) の色',
  ink: 'この Look の文字 (インク) の色',
  accent: 'この Look のアクセント色 (Accent % の割合の文字をこの色で描く)',
  accentRatio: 'アクセント色で描く文字の割合',
  fontFamily: '書体。明朝は游明朝 → リュウミン、ゴシックは秀英角ゴ銀、欧文サンセリフは Aratana (Bold は Helvetica) を優先し、無ければこの書体',
  fontWeight: '文字の太さ (Regular / Bold)',
  fontSize: '組版の文字サイズ (px)。画面には Frame / Zoom で合わせて描く',
  lineHeight: '行送り (文字サイズの倍率)',
  letterSpacing: '字間 (em)。マイナスで詰める',
  vertical: '組方向。横組 / 縦組',
  fitMode: '版面を画面に合わせる方法。Fit = 全体が入る / Crop = 画面を埋める (はみ出しは切る) / Actual = 等倍',
  zoom: '版面の拡大率',
  panX: '版面の左右の位置',
  panY: '版面の上下の位置',
  stageW: '折り返し幅 (組版の 1 行の幅、px)',
  marginPct: '画面の縁の余白 (%)',
  gridEnabled: 'グリッド組版 (原稿用紙のようなマスに 1 文字ずつ置く)',
  gridCols: 'グリッドのマス数 (横組 = 1 行、縦組 = 1 列)',
  gridCell: 'グリッドのマスの大きさ (px)。Auto は文字サイズから決める',
  gridGap: 'グリッドのマスの間隔 (px)',
  // Motion
  randomLaw: '文字が伸び縮みする規則 (scatter = ばらばら / calm = 穏やか / wave = 波 / grid = 格子 / pulse = 脈動 / glitch など)',
  flipRate: '文字が動き出す頻度 (0 で止まる)。Rhythm の量が掛かる',
  stretchX: '動いた文字の横の伸び (0 = 変えない / 正 = 横に伸びる / 負 = 横に潰れる。-2 で細い線まで)',
  stretchY: '動いた文字の縦の伸び (0 = 変えない / 正 = 縦に伸びる / 負 = 縦に潰れる。-2 で細い線まで)',
  rotation: '動いた文字を傾ける量',
  randomness: '伸び・傾きのばらつきの大きさ',
  geoRatio: '段階的 (幾何学的) に伸びる文字の割合',
  stepSize: '段階的な伸びの刻み幅 (%)',
  pivotX: '伸び・回転・鏡映の支点の左右位置 (文字枠内の %)',
  pivotY: '伸び・回転・鏡映の支点の上下位置 (文字枠内の %)',
  // Operators
  opChance: '下の Operator (回転・シアー・ベースライン・鏡映) が動いた文字に乗る確率',
  rotateAngle: '回転 Operator: 文字を回す最大角度 (文字ごとに ± ランダム)',
  skewX: 'シアー Operator: 横方向の斜め変形 (deg)',
  skewY: 'シアー Operator: 縦方向の斜め変形 (deg)',
  baselineShift: 'ベースライン Operator: 文字を上下にずらす量 (em。縦組では左右)',
  mirrorX: '鏡映 Operator: 左右反転の量 (1 で完全反転)',
  mirrorY: '鏡映 Operator: 上下反転の量 (1 で完全反転)',
  confuseDepth: '類字置換の深さ。浅い = 形の似た字、深い = 別の文字体系の似た字へ置き換える',
  misregX: '版ずれ: 2 色のインクを左右にずらす量 (px)',
  misregY: '版ずれ: 2 色のインクを上下にずらす量 (px)',
  misregColorA: '版ずれの A 版の色',
  misregColorB: '版ずれの B 版の色',
  misregAlpha: '版ずれの刷りの濃さ (%)',
  misregRatio: '版ずれの B 版の戻り量 (A 版のずれに対する %)',
  // Effects
  showPct: '文字を描く割合 (%)。低いほど字が抜ける',
  sizeVar: '文字ごとの大きさのばらつき (%)',
  scatter: '文字ごとに位置を散らす量 (文字サイズ比 %)',
  tremor: '文字が細かく震える量 (文字サイズ比 %)',
  waveAmp: '字送り方向に沿ったうねりの振れ幅 (文字サイズ比 %)',
  waveLen: 'うねりの波長 (em)',
  lineStagger: '行ごとに字送り方向へずらす量 (%)',
  slant: '全文字を斜体にする角度 (deg)',
  swirl: '版面の中心から渦を巻かせる角度 (外側ほど回る)',
  bulge: '版面の中心から膨らませる (+) / すぼませる (−) 量 (%)',
  viewAngle: '版面全体の回転 (deg)',
  trailPct: '残像 (%)。紙の塗りを薄くして前のフレームを残す',
  accentOnMove: '動いている文字をアクセント色に寄せる量 (%)',
  rainbow: '文字ごとに虹色を混ぜる量 (%)',
  rainbowSpan: '虹色で版面全体に回す色相の幅 (deg)',
  vignette: '周辺減光の量 (%)',
  vignetteColor: '周辺減光の色 (Palette On のときは Key の色)',
  grain: 'フィルムグレインの量 (%)',
  grainSize: 'グレインの粒の大きさ (%)',
  // Surface
  tdSurfOn: 'Surface 効果 (上流 type-deformer の Operator) を文字に重ねる。On にした時点でエンジンを読み込む',
  tdSurfOp: 'Surface Operator を 1 つ選ぶ (Look の重ね合わせは解除される)',
  tdSurfEdit: '重ねている Operator のうち、下にパラメータを出すもの',
  tdSurfStrength: 'Surface 効果の強さ',
  tdSurfChance: 'Surface 効果を掛ける文字の割合',
  tdSurfSpeed: 'Surface 効果の動く速さ (1 周 / 秒)。Rhythm の量と拍の脈動が掛かる。重い Operator は描き終えるまで止まる',
  tdSurfSource: '効果が掛かった文字の元の字の見せ方 (Operator の既定 / そのまま / 薄く / 隠す)',
  tdSurfOpacity: '効果レイヤーの不透明度',
  tdSurfPixel: '粗さ: 効果を粗い解像度で描き、ドットのまま拡大する (1 = 元の解像度)。ビットマップ系の Look 向け',
  tdSurfBlend: '効果レイヤーの重ね方 (Operator の既定 / 通常 / 乗算 / スクリーンなど)',
  tdSurfColor: '効果の色: Operator の既定色 / Ink / Accent (共通パレット On のときはパレットの色)',
  // Composition
  tdCompType: 'Composition: 文字から生成したシーンを合成する (8 種のエンジン)。On にした時点でエンジンを読み込む。Look とは独立 (Look を当てても変わらない)。Canvas が On のときは、紙とスタンプのあいだに敷かれる',
  tdCompSpeed: 'Composition のループの速さ (1 周 / 秒)。Rhythm の量が掛かる',
  tdCompIntensity: 'Composition の変形の強さ',
  tdCompDensity: 'Composition の密度 (並べる数)',
  tdCompInstability: 'Composition の不安定さ (揺らぎ・ノイズの量)',
  tdCompDepth: 'Composition の奥行き (大きさの変化)',
  tdCompLegibility: 'Composition の読みやすさの下限 (低いほど崩れる)',
  tdCompEcho: 'FX: 残像トレイル (0 で無効)',
  tdCompFeedback: 'FX: フィードバック (ズーム・回転を繰り返し重ねる。0 で無効)',
  tdCompChroma: 'FX: 色収差 (RGB をずらす。0 で無効)',
  tdCompRaster: 'FX: ラスタ質感 (走査線・ノイズ。0 で無効)',
  compAudio: 'Composition を音で動かす量 (Look とは独立)'
};
// 親子 (子の行 = キー → 親の行のキー)。子は字下げ (label.sub-label) し、親が Off で効かないときは PARAM_NEEDS / paramOn で薄くする
TextDeform.PARAM_PARENT = {
  lookEvery: 'tdLookPool', tdRandGuard: 'tdLookPool', lookRand: 'tdLookPool',
  textPool: 'textMode', textEvery: 'textMode', typeSpeed: 'typeOn', typeHold: 'typeOn',
  rhythmAudio: 'rhythmMotion', beatPulse: 'rhythmMotion', rhythmBpm: 'rhythmMotion',
  palPaper: 'palOn', palInk: 'palOn', palAccent: 'palOn',
cvSize: 'canvasOn', cvRot: 'canvasOn', cvPos: 'canvasOn', cvStretch: 'canvasOn', cvOpacity: 'canvasOn', cvHue: 'canvasOn', cvDrift: 'canvasOn', cvSpeed: 'canvasOn', cvAspect: 'fontOver', cvTrack: 'fontOver', cvLeading: 'fontOver', cvReact: 'canvasOn',
  canvasLayout: 'canvasOn', canvasAutoLayout: 'canvasOn', canvasPlate: 'canvasOn', canvasMainFx: 'canvasOn', canvasMove: 'canvasOn', canvasJumpEvery: 'canvasOn', canvasFull: 'canvasOn', canvasFullEvery: 'canvasOn', canvasTiming: 'canvasOn', canvasGunDiv: 'canvasOn', canvasGunOrder: 'canvasOn',
  canvasSource: 'canvasOn', canvasMax: 'canvasOn', canvasAutoAdd: 'canvasOn', canvasAutoSwap: 'canvasOn', canvasAutoClear: 'canvasOn', tdCanvasSaved: 'canvasOn',
  vecSpin: 'vecMode', vecTilt: 'vecMode', vecWave: 'vecMode', vecAudio: 'vecMode', vecDepth: 'vecMode', vecDetail: 'vecMode', vecLine: 'vecMode',
  comScaleX: 'fontOver', comScaleY: 'fontOver', comTrack: 'fontOver', comLeading: 'fontOver',
  gridCols: 'gridEnabled', gridCell: 'gridEnabled', gridGap: 'gridEnabled',
  rotateAngle: 'opChance', skewX: 'opChance', skewY: 'opChance', baselineShift: 'opChance', mirrorX: 'opChance', mirrorY: 'opChance',
  misregColorA: 'misregX', misregColorB: 'misregX', misregAlpha: 'misregX', misregRatio: 'misregX',
  waveLen: 'waveAmp', rainbowSpan: 'rainbow', vignetteColor: 'vignette', grainSize: 'grain',
  tdSurfOp: 'tdSurfOn', tdSurfEdit: 'tdSurfOn', tdSurfStrength: 'tdSurfOn', tdSurfChance: 'tdSurfOn', tdSurfSpeed: 'tdSurfOn', tdSurfSource: 'tdSurfOn',
  tdSurfOpacity: 'tdSurfOn', tdSurfPixel: 'tdSurfOn', tdSurfBlend: 'tdSurfOn', tdSurfColor: 'tdSurfOn',
  tdCompSpeed: 'tdCompType', tdCompIntensity: 'tdCompType', tdCompDensity: 'tdCompType', tdCompInstability: 'tdCompType',
  tdCompDepth: 'tdCompType', tdCompLegibility: 'tdCompType', tdCompEcho: 'tdCompType', tdCompFeedback: 'tdCompType', tdCompChroma: 'tdCompType',
  tdCompRaster: 'tdCompType', compAudio: 'tdCompType'
};
// 0 なら効かない値 (行をグレーにする)
TextDeform.PARAM_NEEDS = {
  rhythmAudio: 'rhythmMotion', beatPulse: 'rhythmMotion', rhythmBpm: 'rhythmMotion',
  gridCols: 'gridEnabled', gridCell: 'gridEnabled', gridGap: 'gridEnabled',
  rotateAngle: 'opChance', skewX: 'opChance', skewY: 'opChance', baselineShift: 'opChance', mirrorX: 'opChance', mirrorY: 'opChance',
  misregColorA: ['misregX', 'misregY'], misregColorB: ['misregX', 'misregY'], misregAlpha: ['misregX', 'misregY'], misregRatio: ['misregX', 'misregY'],
  waveLen: 'waveAmp', rainbowSpan: 'rainbow', vignetteColor: 'vignette', grainSize: 'grain',
  palPaper: 'palOn'
};
TextDeform.paramOn = function(key){
  const P = this.P;
  if(key === 'textPool' || key === 'textEvery') return P.textMode === 'random';
  if(key === 'typeSpeed' || key === 'typeHold') return P.typeOn === 'on';
  if(key === 'palInk' || key === 'palAccent') return P.palOn === true;   // Paper only ではインク・アクセントは各 Look のまま
  if(/^vec/.test(key) && key !== 'vecMode') return !!P.vecMode && P.vecMode !== 'off';
  if(/^cv[A-Z]/.test(key)) return !!P.canvasOn;
  if(key === 'canvasGunDiv' || key === 'canvasGunOrder') return !!P.canvasOn && P.canvasTiming === 'gun';   // Canvas のばらつきは Canvas が On のときだけ
  if(/^tdSurf/.test(key) && key !== 'tdSurfOn') return typeof TDSurf !== 'undefined' && !!TDSurf.cfg.enabled;
  if((/^tdComp/.test(key) && !/^tdComp(Type|Saved|Save|Del)$/.test(key)) || key === 'compAudio') return !!P.comp;
  return true;
};
if(typeof window !== 'undefined') window.TextDeform = TextDeform;
