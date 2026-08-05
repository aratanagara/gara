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
const TD_UNICODE_FALLBACK = '"Lucida Sans Unicode VJ","Lucida Sans Unicode","Apple Symbols","Noto Sans Symbols 2","Noto Sans Symbols","Segoe UI Symbol","Unifont VJ"';
const TD_FONT_UNICODE = TD_UNICODE_FALLBACK + ',sans-serif';
const TD_FONT_ORIGINAL = '"Zen Old Mincho","Hiragino Mincho ProN","Yu Mincho",' + TD_UNICODE_FALLBACK + ',serif';
const TD_FONT_MINCHO = '"yu-mincho-pr6n","dnp-shuei-nmincho-std","Zen Old Mincho","Hiragino Mincho ProN",' + TD_UNICODE_FALLBACK + ',serif';
const TD_FONT_GOTHIC = '"dnp-shuei-gothic-gin-std","DNP Shuei Gothic Gin Std","Zen Kaku Gothic New","Noto Sans JP",' + TD_UNICODE_FALLBACK + ',sans-serif';
const TD_FONT_MONO = '"dnp-shuei-gothic-gin-std","Space Mono",' + TD_UNICODE_FALLBACK + ',"Noto Sans JP",monospace';
const TD_MD_STYLE_KEYS = ['paper','ink','accent','accentRatio','fontFamily','fontSize','lineHeight','letterSpacing','vertical','stageW','marginPct','fitMode','zoom','panX','panY','randomLaw','rotation','randomness','geoRatio','stretchX','stretchY','flipRate',
  'rotateAngle','skewX','skewY','baselineShift','mirrorX','mirrorY','misregX','misregY','misregColorA','misregColorB','confuseDepth','opChance','gridEnabled','gridCols','gridCell','gridGap','comp'];

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
const TD_PASTE_PARAMS = {
  fontFamily: TD_FONT_ORIGINAL,
  fontSize: 52, lineHeight: 1.1, letterSpacing: -0.03,
  paper: '#f4f3ef', ink: '#17140f', accent: '#c41f1f', accentRatio: 0,
  stretchX: 1, stretchY: 1, radius: 45, ease: 0.08, geoRatio: 0.32,
  randomness: 1, rotation: 0, randomLaw: 'paste',
  marginPct: 6, stageW: 960, fitMode: 'fit', zoom: 1, panX: 0, panY: 0, flipRate: 0, bloomChance: 0
};
const TD_COLLAGE_PARAMS = Object.assign({}, TD_PASTE_PARAMS, {
  fontSize: 84, lineHeight: 0.92, letterSpacing: -0.12,
  randomLaw: 'collage', randomness: 1.65, rotation: 22, geoRatio: 0.82,
  stretchX: 2.65, stretchY: 2.9, ease: 0.22,
  marginPct: 0, stageW: 1680, fitMode: 'crop', zoom: 1.45,
  flipRate: 0, bloomChance: 0
});

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
    // レイアウト(スロットに合わせる)
    marginPct: 8, transparentBg: false, fitMode: 'fit', zoom: 1, panX: 0, panY: 0,
    // VJ 駆動
    autoSpeed: 3.0,      // bloom時の追従速度
    flipMin: 0.05,       // 各文字が次に動き出すまでの最短秒
    flipRange: 0.9,      // その揺らぎ幅(各文字が独立ランダムに on/off)
    flipRate: 1.4,       // 全体の動き出し頻度(大きいほど頻繁)
    beatPulse: 0.5,      // ビートで半径を脈動させる量
    bloomChance: 0.10,   // リターゲット時に構成的な一斉スイープ(bloom)を発動する確率
    beatReload: true,    // beatモード時、拍ごとにランダム md を読み直す
    mdMode: 'random',    // random | fixed
    mdIndex: -1,         // fixed 時に表示する md プリセット
    stageW: 960,         // 隠しステージの CSS 幅(組版の折返し基準)
    text: 'type deformer'
  },
  PDefaults: null,
  _mdStyleStoreKey: 'vj.textdeform.mdStyles',
  _mdStyleVersionKey: 'vj.textdeform.mdStyles.version',
  _mdStyleVersion: '20260718-collage-md-01-04',
  _mdBaseStyles: null,

  // ---- 10 プリセット ----
  presets: [
    { name: 'Emoji Parade', p: { seed: 3, fontFamily: '"Noto Sans JP", sans-serif', accentRatio: 0.08 },
      text: '🌕　🌖　🌗　🌘　🌑\n👁️  見る　👁️  見られる\n🫧🫧　ことば　🫧🫧\n🌀 回る　ほどける　戻る 🌀\n🐛→🦋　　🌱→🌿→🌳\n⚡️電光　💧水滴　🔥火花　🌬️吐息\n📡 ・・・受信中・・・ 📡\n🫀 DOKI　🫀 DOKI　🫀 DOKI\n🌈🟥🟧🟨🟩🟦🟪🌈\n👋　また、別の文字で。' },
    { name: 'Ihatovo Night', p: { seed: 7, fontFamily: TD_FONT_MINCHO, paper: '#0d1020', ink: '#e8ecff', accent: '#7fb0ff', accentRatio: 0.05 },
      text: 'イーハトーヴォの夜は、青い硝子の底にある。\n野原の電柱は、遠い星から届く音を聴いている。\n汽車は銀河の外れを、しずかな火花をこぼして走る。\n\nきら、きら、きら。\n名もない草の葉に、小さな天文学がひらく。\n\n「ここはどこですか」\n「まだ地図になっていない場所です」' },
    { name: 'Vertical Rain', p: { seed: 12, vertical: true, fontFamily: TD_FONT_MINCHO, fontSize: 64 },
      text: '雨\nの\n糸\nが\n\n窓\nと\n夜\nを\n\n縫\nい\n合\nわ\nせ\nる\n\n一滴\n二滴\n無数滴' },
    { name: 'Katakana Machine', p: { seed: 4, fontFamily: TD_FONT_GOTHIC, fontWeight: 700, geoRatio: 0.7, accent: '#c41f1f', accentRatio: 0.1 },
      text: 'テクスト・デフォーマー\nキドウ　ヘンケイ　レンダリング\nTYPE／SHIFT／ROTATE／REPEAT\n\nユガムユガムユガム\nノビルノビルノビル\nチヂムチヂムチヂム\n\nSYSTEM 00\nGLYPH 01\nNOISE 10\nERROR 404' },
    { name: 'Punctuation Storm', p: { seed: 5, fontFamily: '"Space Mono", monospace', geoRatio: 0.5 },
      text: '「ことば」は、どこから（どこまで）？\n……まだ。／もう。／また。\n\n［　開く　］　｛　閉じる　｝\n〈〈〈　接近　〉〉〉\n！！！　？？？　！？！？\n\n・—・—・—・—・\n○●○●○●○●○\n△▽△▽△▽△▽△' },
    { name: 'Bilingual Signal', p: { seed: 6, fontFamily: '"EB Garamond", serif', fontSize: 56, accentRatio: 0.07 },
      text: 'THIS TEXT IS A SIGNAL.\nこの文字列は、信号です。\n\nREAD / 読む\nLOOK / 見る\nTOUCH / 触れる\nDEFORM / 変形する\n\nletters become images\n文字は像になる\nCAN YOU HEAR THE SHAPE?\nかたちの音が、聞こえますか。' },
    { name: 'Numbers Calendar', p: { seed: 8, fontFamily: '"Space Mono", monospace', geoRatio: 0.6 },
      text: '2026 / 07 / 14\n16 : 35 : 11\n\n0 1 2 3 4 5 6 7 8 9\n00 11 22 33 44 55 66 77 88 99\n10101010 / 01010101\n\n35.6812° N\n139.7671° E\nALT 0 → 1000 → ∞\n\n3、2、1、0。' },
    { name: 'Whisper Echo', p: { seed: 9, fontFamily: TD_FONT_MINCHO, randomness: 1.0, rotation: 4 },
      text: 'ここにいる\n　ここにいる\n　　ここにいる\n　　　ここに\n　　　　ここ\n　　　　　こ\n\n聞こえる\n　聞こえる\n　　聞こえ\n　　　声\n　　　　・\n\n消えたあとにも、形だけが反響している。' },
    { name: 'Dense City', p: { seed: 2, fontFamily: TD_FONT_GOTHIC, fontSize: 48, stageW: 1100 },
      text: '交差点を渡る群衆の肩に、広告の光が降り積もる。\n地下鉄、改札、階段、出口、工事中、迂回路。\n窓という窓が別々の夜を映し、信号は無言で色を変える。\n\n東東東西南北\n上上下下左右左右\n入口出口非常口\n\n雑踏雑音残像速度\n都市都市都市都市都市' },
    { name: 'Minimal Space', p: { seed: 11, fontFamily: TD_FONT_MINCHO, fontSize: 96, rotation: 6, accentRatio: 0.12 },
      text: '点\n\n\n線\n\n\n\n面\n\n\n\n\n空白\n\n\n\n\nひとつの文字が\n広い場所を\nつくる' },

    // ── 「Error / 崩壊する物語」を分割したフラグメント群 ──
    { name: 'ERR 00 夕日', p: { seed: 21, fontFamily: TD_FONT_MINCHO, paper:'#0d0d10', ink:'#e8e8ec', accent:'#c41f1f', accentRatio:0.06, fontSize:56 }, text: String.raw`Error


　夕日がゆっく` }
  ],

  // ================= GL =================
  VS: `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main(){ v_uv = vec2(a_pos.x*0.5+0.5, 0.5 - a_pos.y*0.5); gl_Position = vec4(a_pos,0.0,1.0); }`,
  FS: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 frag; uniform sampler2D u_tex;
void main(){ frag = texture(u_tex, clamp(v_uv,0.0,1.0)); }`,

  init(gl){
    if(this.initialized) return true;
    this.gl = gl;
    this.PDefaults = JSON.parse(JSON.stringify(this.P));

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
    this._captureMdBaseStyles();
    this._loadStoredMdStyles();
    this.loadSelected();

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

  _ensureAdobeFonts(){
    if(document.getElementById('td-typekit')) return;
    try{
      const kitId = 'tnn5mhx';
      const config = { kitId, scriptTimeout: 3000, async: true };
      const h = document.documentElement;
      const tk = document.createElement('script');
      const s = document.getElementsByTagName('script')[0];
      const refresh = ()=>{ this._refreshGlyphSupport(); };
      let loaded = false;
      const t = setTimeout(function(){
        h.className = h.className.replace(/\bwf-loading\b/g, '') + ' wf-inactive';
        refresh();
      }, config.scriptTimeout);
      h.className += ' wf-loading';
      tk.id = 'td-typekit';
      tk.src = 'https://use.typekit.net/' + config.kitId + '.js';
      tk.async = true;
      tk.onload = tk.onreadystatechange = function(){
        const a = this.readyState;
        if(loaded || (a && a !== 'complete' && a !== 'loaded')) return;
        loaded = true;
        clearTimeout(t);
        try{
          if(typeof Typekit !== 'undefined'){
            Typekit.load(Object.assign({}, config, { active: refresh, inactive: refresh }));
          } else {
            refresh();
          }
        }catch(e){ refresh(); }
      };
      if(s && s.parentNode) s.parentNode.insertBefore(tk, s);
      else document.head.appendChild(tk);
    }catch(e){}
  },

  // ================= テキスト/組版 =================
  setText(text){
    this.P.text = text;
    this._applyStageStyle();
    this._createSpans(text);
  },

  setParams(over){
    Object.assign(this.P, over || {});
    this._applyStageStyle();
    // フォント/サイズが変わると組版が変わるので作り直す
    this._createSpans(this.P.text);
  },

  loadPreset(i){
    i = Math.max(0, Math.min((this.presets.length || 1) - 1, parseInt(i, 10) || 0));
    const pr = this.presets[i];
    if(!pr) return;
    const mdMode = this.P.mdMode === 'fixed' ? 'fixed' : 'random';
    // デフォルトに戻してからプリセット差分を適用
    const base = JSON.parse(JSON.stringify(this.PDefaults || this.P));
    Object.assign(base, pr.p || {});
    base.text = pr.text;
    base.mdMode = mdMode;
    base.mdIndex = i;
    this.P = base;
    this._t = 0;
    this._bloomUntil = 0;        // 新テキストで bloom はリセット
    this._nextBloomCheck = 0;
    this._lastPresetI = i;
    // Composition は md 単位: 保存があれば適用、無ければデフォルト(Off)へ戻す
    if(typeof TDComp !== 'undefined') TDComp.applyMd(base.comp || null);
    this.setText(base.text);
  },

  loadSelected(){
    const i = parseInt(this.P.mdIndex, 10);
    if(this.P.mdMode === 'fixed' && this.presets[i]){
      this.loadPreset(i);
      return;
    }
    this.P.mdMode = 'random';
    this.P.mdIndex = -1;
    this.loadRandom();
  },

  // 毎回ランダムな md(プリセット)を読み込む。直前と同じは避ける。
  loadRandom(){
    const n = this.presets.length; if(!n) return;
    if(this.P.mdMode === 'fixed' && this.presets[this.P.mdIndex]){
      this.loadPreset(this.P.mdIndex);
      return;
    }
    this.P.mdMode = 'random';
    let i = Math.floor(Math.random()*n);
    if(n > 1 && i === this._lastPresetI) i = (i+1) % n;
    this.loadPreset(i);
  },

  setMdSelection(value){
    if(value === '' || value === 'random' || value == null){
      this.P.mdMode = 'random';
      this.P.mdIndex = -1;
      this.loadRandom();
      return;
    }
    const i = Math.max(0, Math.min(this.presets.length - 1, parseInt(value, 10) || 0));
    this.P.mdMode = 'fixed';
    this.P.mdIndex = i;
    this.loadPreset(i);
  },

  currentMdIndex(){
    if(this.P.mdMode === 'fixed' && this.presets[this.P.mdIndex]) return this.P.mdIndex;
    return (this._lastPresetI != null && this.presets[this._lastPresetI]) ? this._lastPresetI : -1;
  },

  updateMdStyle(i, over){
    this._setMdStyle(i, over, false);
  },

  saveMdDefault(i, over){
    this._setMdStyle(i, over, true);
  },

  // ライブ調整を捨てて「デフォルト保存」した値へ戻す (保存が無ければ初期値)。
  // 保存自体は消さない — 消す手段を用意すると誤操作で失われるため。
  resetMdDefault(i){
    const pr = this.presets[i];
    if(!pr) return;
    this._captureMdBaseStyles();
    const base = (this._mdBaseStyles && this._mdBaseStyles[pr.name]) || {};
    const p = Object.assign({}, pr.p || {});
    for(const k of TD_MD_STYLE_KEYS){
      if(base[k] !== undefined) p[k] = base[k];
      else delete p[k];
    }
    let saved = null;
    try{ saved = JSON.parse(localStorage.getItem(this._mdStyleStoreKey) || 'null'); }catch(e){}
    const d = saved && saved[pr.name];
    if(d && typeof d === 'object' && !Array.isArray(d)) Object.assign(p, d);
    pr.p = p;
    if(this.currentMdIndex() === i) this.loadPreset(i);
  },

  _setMdStyle(i, over, persist){
    const pr = this.presets[i];
    if(!pr) return;
    pr.p = Object.assign({}, pr.p || {}, over || {});
    if(persist) this._saveStoredMdStyles();
    if(this.currentMdIndex() === i) this.loadPreset(i);
  },

  _captureMdBaseStyles(){
    if(this._mdBaseStyles) return;
    this._mdBaseStyles = {};
    for(const pr of this.presets || []){
      const p = pr.p || {};
      const base = {};
      for(const k of TD_MD_STYLE_KEYS) if(p[k] !== undefined) base[k] = p[k];
      this._mdBaseStyles[pr.name] = base;
    }
  },

  _loadStoredMdStyles(){
    if(typeof localStorage === 'undefined') return;
    this._captureMdBaseStyles();
    let saved = null;
    try{ saved = JSON.parse(localStorage.getItem(this._mdStyleStoreKey) || 'null'); }catch(e){}
    try{
      if(saved && localStorage.getItem(this._mdStyleVersionKey) !== this._mdStyleVersion){
        for(const name of ['System Destruction 01','System Destruction 02','System Destruction 03','System Destruction 04']){
          if(saved[name]) delete saved[name];
        }
        localStorage.setItem(this._mdStyleStoreKey, JSON.stringify(saved));
        localStorage.setItem(this._mdStyleVersionKey, this._mdStyleVersion);
      }
    }catch(e){}
    if(!saved || typeof saved !== 'object') return;
    for(const pr of this.presets){
      const d = saved[pr.name];
      if(d && typeof d === 'object' && !Array.isArray(d)){
        pr.p = Object.assign({}, pr.p || {}, d);
      }
    }
  },

  _saveStoredMdStyles(){
    if(typeof localStorage === 'undefined') return;
    this._captureMdBaseStyles();
    const d = {};
    for(const pr of this.presets){
      const p = pr.p || {};
      const base = (this._mdBaseStyles && this._mdBaseStyles[pr.name]) || {};
      const entry = {};
      for(const k of TD_MD_STYLE_KEYS){
        if(p[k] !== undefined && p[k] !== base[k]) entry[k] = p[k];
      }
      if(Object.keys(entry).length) d[pr.name] = entry;
    }
    try{
      localStorage.setItem(this._mdStyleStoreKey, JSON.stringify(d));
      localStorage.setItem(this._mdStyleVersionKey, this._mdStyleVersion);
    }catch(e){}
  },

  _fontStack(fontFamily){
    const f = fontFamily || TD_FONT_MINCHO;
    if(/Lucida Sans Unicode VJ|Lucida Sans Unicode/.test(f)) return f;
    const patched = String(f).replace(/,\s*(serif|sans-serif|monospace)\s*$/i, ',' + TD_UNICODE_FALLBACK + ',$1');
    return patched === String(f) ? String(f) + ',' + TD_UNICODE_FALLBACK : patched;
  },

  _applyStageStyle(){
    const P = this.P, s = this._stage;
    if(!s) return;
    s.style.width = P.stageW + 'px';
    s.style.fontFamily = this._fontStack(P.fontFamily);
    s.style.fontSize = P.fontSize + 'px';
    s.style.fontWeight = P.fontWeight;
    s.style.lineHeight = P.lineHeight;
    s.style.letterSpacing = P.letterSpacing + 'em';
    s.style.color = P.ink;
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
    return this.P.fontWeight + '|' + this.P.fontFamily;
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
    const stack = fontFamily != null ? String(fontFamily) : this._fontStack(this.P.fontFamily);
    const weight = fontWeight != null ? fontWeight : this.P.fontWeight;
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
    const key = (fontWeight != null ? fontWeight : this.P.fontWeight) + '|' +
      (fontFamily != null ? String(fontFamily) : this._fontStack(this.P.fontFamily));
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
    const key = (fontWeight != null ? fontWeight : this.P.fontWeight) + '|' +
      (fontFamily != null ? String(fontFamily) : this._fontStack(this.P.fontFamily));
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
    let sX = 1 + info.intensity*(1.48 + seedX*0.85 + directional*0.42)*P.stretchX;
    let sY = 1 + info.intensity*(1.82 + seedY*1.05 - directional*0.36)*P.stretchY;
    const stepX = info.stepX>0?info.stepX:0.28, stepY = info.stepY>0?info.stepY:0.34, baseBlend = info.blend;
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
    sX = sX<1?1:(sX>8?8:sX); sY = sY<1?1:(sY>9?9:sY);
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
    // 旧実装は App.beatMode の truthy 判定(文字列なら 'drone' でも真)になっていたため、
    // drone モードでも拍が変わるたびに md が切り替わっていた。beat モード限定に修正。
    const beatMode = (typeof App !== 'undefined' && App.beatMode === 'beat');
    const bi = Math.floor(beat || 0);
    if(this._lastBeatInt == null) this._lastBeatInt = bi;
    // beatモード: 拍が変わるたびランダム md を読み直す(固定 md 時はそのまま動かす)
    if(beatMode && P.beatReload && bi !== this._lastBeatInt){
      this._lastBeatInt = bi;
      if(P.mdMode !== 'fixed'){
        this.loadRandom();
        return;
      }
    }
    this._lastBeatInt = bi;
    const sw = this._stage.offsetWidth || P.stageW, sh = this._stage.offsetHeight || P.stageW;
    const inBloom = this._t < (this._bloomUntil || 0);
    const beatPhase = (beat || 0) - bi;
    const pulse = beatMode ? (1 + P.beatPulse * Math.pow(1 - beatPhase, 1.6)) : 1;
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
      this._randomFlipStep(pulse);
    }
    // Composition Engine v6 のループ位相を進める (mode/textdeform-comp.js)
    if(typeof TDComp !== 'undefined') TDComp.advance(d, pulse);
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
    const rate = Math.max(0.05, P.flipRate * (pulse || 1) * lawRate);   // beat時は膨らむ
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
    const rate = Math.max(0.05, P.flipRate * (pulse || 1));
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
  _snapshotGlyphs(){
    const P = this.P, ms = this._metrics || [], out = [];
    const fs = P.fontSize;
    for(let i=0; i<ms.length; i++){
      const m = ms[i], st = m.el.style;
      const sx = parseFloat(st.getPropertyValue('--sx')) || 1;
      const sy = parseFloat(st.getPropertyValue('--sy')) || 1;
      const ix = parseFloat(st.getPropertyValue('--ix')) || 1;
      const iy = parseFloat(st.getPropertyValue('--iy')) || 1;
      const tx = (parseFloat(st.getPropertyValue('--tx')) || 0) * fs;
      const ty = (parseFloat(st.getPropertyValue('--ty')) || 0) * fs;
      const rot = parseFloat(st.getPropertyValue('--rot')) || 0;
      const x = m.relX - m.w/2, y = m.relY - m.h/2, w = m.w, hh = m.h;
      out.push({ ch: m.dispCh || m.el.textContent, upright: m.el._info.upright, accent: m.el._accent,
        x, y, w, h: hh, ox: x + w/2, oy: y + hh*0.75, tx, ty, rot, scaleX: sx*ix, scaleY: sy*iy,
        opRot: m.opRotV || 0, skx: m.opSkXV || 0, sky: m.opSkYV || 0, bl: m.opBlV || 0,
        mirX: m.opMirXV == null ? 1 : m.opMirXV, mirY: m.opMirYV == null ? 1 : m.opMirYV,
        misX: m.opMisXV || 0, misY: m.opMisYV || 0 });
    }
    return out;
  },

  _fontMetrics(ctx){
    ctx.font = this.P.fontWeight + ' ' + this.P.fontSize + 'px ' + this._fontStack(this.P.fontFamily);
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
    let s = Math.min(availW/bw, availH/bh);
    if(mode === 'crop') s = Math.max(availW/bw, availH/bh);
    else if(mode === 'actual') s = 1;
    s *= Math.max(0.05, parseFloat(P.zoom) || 1);
    const dx = mg + (availW - bw*s)*0.5 - bx*s + (parseFloat(P.panX) || 0) * w;
    const dy = mg + (availH - bh*s)*0.5 - by*s + (parseFloat(P.panY) || 0) * h;
    this._fit = { s, dx, dy, w, h };
  },

  // 2D canvas に (w×h の artboard として) 中央フィットで描画
  _renderToCanvas(w, h){
    const P = this.P;
    const cv = this.canvas, ctx = this.ctx;
    if(cv.width !== w || cv.height !== h){ cv.width = w; cv.height = h; }
    if(!P.transparentBg){ ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle = P.paper; ctx.fillRect(0,0,w,h); }
    else { ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,w,h); }
    // Composition Engine v6 有効時は生成シーン描画に切替 (文字の直接描画は行わない)
    if(typeof TDComp !== 'undefined' && TDComp.enabled()){
      TDComp.render(ctx, w, h);
      ctx.setTransform(1,0,0,1,0,0);
      return;
    }
    const glyphs = this._snapshotGlyphs();
    // 固定フィット(版面ベース)。テキスト/サイズ変更 or 解像度変更時のみ再計算。
    const f = this._fit;
    if(!f || f.w !== w || f.h !== h || this._fitDirty){ this._fitDirty = false; this._computeFit(w, h); }
    const s = this._fit.s, dx = this._fit.dx, dy = this._fit.dy;
    const fm = this._fontMetrics(ctx);
    const font = P.fontWeight + ' ' + P.fontSize + 'px ' + this._fontStack(P.fontFamily);
    const grid = !!P.gridEnabled;
    const fs = P.fontSize;
    // Operator を含む1パス描画。misreg のオフセットはフィット前のステージ座標系 (元アプリの page 座標に相当)
    const drawPass = (g, blX, blY, offX, offY, fill, alpha, blend)=>{
      ctx.setTransform(1,0,0,1,0,0);
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
      if(P.vertical || grid){
        const cx = g.x+g.w/2, cy = g.y+g.h/2;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if(P.vertical && !g.upright){ ctx.translate(cx,cy); ctx.rotate(Math.PI/2); ctx.fillText(g.ch,0,0); }
        else ctx.fillText(g.ch, cx, cy);
      } else {
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        const leading = g.h - (fm.ascent + fm.descent);
        ctx.fillText(g.ch, g.x, g.y + leading/2 + fm.ascent);
      }
    };
    for(let i=0; i<glyphs.length; i++){
      const g = glyphs[i];
      const blX = P.vertical ? g.bl*fs : 0;    // baseline shift: 縦組=左右 / 横組=上下
      const blY = P.vertical ? 0 : -g.bl*fs;
      if(g.misX || g.misY){
        // 版ずれ2色刷り: A=+offset / B=-0.65×offset を multiply で敷き、上に本来のインク
        drawPass(g, blX, blY, g.misX, g.misY, P.misregColorA, 0.72, 'multiply');
        drawPass(g, blX, blY, -g.misX*0.65, -g.misY*0.65, P.misregColorB, 0.72, 'multiply');
      }
      drawPass(g, blX, blY, 0, 0, g.accent ? P.accent : P.ink, 1, 'source-over');
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(1,0,0,1,0,0);
  },

  render(opts){
    if(!this.initialized) return;
    const gl = this.gl, { fbo, w, h } = opts;
    // ステージが空(未計測)なら紙だけ塗る
    this._renderToCanvas(w, h);

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
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(this.locPos);
    gl.vertexAttribPointer(this.locPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
};
// ---- 密なフィールド系 md を追加(絵文字/漢字の敷き詰め。変形で大小がバラつき、画像のような塊になる)----
(function(){
  const EMOJI_FONT = '"Noto Sans JP","Apple Color Emoji","Segoe UI Emoji",sans-serif';
  const grid = (ch, cols, rows) => Array.from({length:rows}, () => ch.repeat(cols)).join('\n');
  // 門構え漢字プール → 行ごとにずらして拾い「柱の森」の素材にする
  const pool = '閉開閣間閃閏閑閲閾闇關闊閨閹閘閧';
  const kanjiForest = Array.from({length:11}, (_, r) =>
    Array.from({length:13}, (_, c) => pool[(r*5 + c*3) % pool.length]).join('')).join('\n');
  const md01 = String.raw`S̴̡̢̡̙̜̯̘̫̬̹̯̤̩̤̘̠̮̖̾̑̓̄̐̈́̿͐͊͜y̸̭̝̖͔̙̭̳̦̟̑͊͊̂̾̀̓̑̄̍̌̇̽͌̐̈́̌̍̓̏̽̉͐͜͠͝s̵̢̨͔̼̰̩̝̼̼̟̯͑̍̊̄̄͒͘ͅt̵̨̟̘̜̱̒̑̄̆̊̋̊̓̉̀̓̽͛̚ȩ̶̛̛̟̘̫̱̺͎̐̂̃̐̆̾̓̇̆̀͆̉̃̍̋̈̆̿̑́̕͘͝m̵̧̨̧̡̙̯̥̻̞̞̹̰̗̟̝̹̱̫̭̝̦̔̌̋̋̎̀̒͒̉͂͜ͅ ̶̨̡̡̙̣̠̻̬̫̗̦̯̼̖̱̗̠͎̎̃͑̈́͊̀ḑ̷̡̡̨̧̨̜̳̮̰̹̠̺͕̮̮̘̭̭̱̖̬̱̣͎̠̃͂̃̾͐̈͗̾̊̋̀̐̈́̈́̈́̊̈́͝ě̴̛̞̩͍̂̈́́̀̽͑̑̓̇͋̉̚̚͠ͅs̶͚̜̞̲͓̎̉̐̆̑̓̊̈́̏̏͗͊͒͐̎̽͑̽̉̚͘t̵̡̢̝̜̠̖͔̞̻̝͈̰̩̩̭̪̖͐̂̌̔͋̍̔͌̋͒̓͑̏̂̓͠r̴̛̗̖̖̀̍̀̏͛̃̎̐̉̍̚̚͝͝ų̸̳̣̯̼̜̮͕̳̺̲̣͓͙̘̩͇̱͈̭̝̤̙̟͕̥̈́̋ċ̴̢̡̟̹̟̯̗͈̩͖̙̺̜͚̗̞͔̗͇͙̩̩̦̥̺̦̀̑͗́̈̎̃̔̐͗̾̏̒̊̄̀̾̃̐͒͑̕ͅͅͅṭ̸̢̨̡̨̪̦̝̖̮̹̲̳̰̻̝̱̞̳̫̯̩̺̗̾́͋̌̍̈́͛̂̍̚͝͝i̸̡̛̬̩̖̖͔̭̪̪̹̭̟̪̰͓̪̹̗͙̤͚̔̉̄͒̔̂̀͛̃͑̚͜͜͝͝ͅȍ̵̧̡̥̦̘̮̖̮͓̩͎̓͑͑͌̓͌̑̋͒̕̚ͅn̵̢̩̫̗͕̤̲͎̘̦̲̖̥̠̫̗̾̒̀͋͐͜͠ͅͅ ̴̧̘̙̫̬̞̠̜̺̀̄̈̋̎̽̄̀̽̾͌̂̀̍̉̒̈̒̏̕̚̚i̷̧̡̛̤̱̰̞͓̬̋̒́̆̈́̓̍̉͋̆̄̆́͂̓̔̾̿̀͘͠͝n̴̢̢̹̜̫̤̘̖̳̬̯̺̠͈̬̝̼̰̲̭̮̋͛̍̃̏̄̉̏̋͐̿̕̚̚͠͠͝ͅͅī̵̡̛͓̪̜̞̤̭̩̙̹̯͔̣̘̫̼͖̝̹̹̮̻̔̏̔̈́̽̒͊̾̿̎͂̀͂̐͂͛̀̉͑̄̄̚͜͜ͅt̴̢̛̘̮̲͎̲̩͓̠̥̻͍̯̤̍͒̊̈́̓̄̀̂̄̓͌̂̓͆̊̈́̀̕̚͘͠͝͝į̸̨̨̧̛̪̠̘͔̭̤̲̘̲̬̣̣͎̣̪̥͎̬́̎̃̐͂͑̋̊͛̾͛̿̾̃͒̂̎̀͒̀̈́̾̊̕͘͝a̴̳̥̣̳̻̖̩̦̣̠̱̩̯̮̱̮̺͙̓̉̎̈́͒̈́̔̍̇͋͂̀̄̆̈́̓̄̊̄̿̐̈̚t̸̲͖̼̰̤̩̥̦̱̱̿̌͊̂̔͑̀̌̍͐̋̂̒̀͑̂̓̐̈́̀̑̕̕͝è̶̢̜̰̯̩̗̿̿͗͒̌͑̍̃́̋̇̎̓̉͂̇̓̂́̔́͒̕̚d̶̢̡̧̨̪̯̠̰̻̺̥̣͉̞̞̖̠̽̒ͅ.̸̧̧̛̦̦̼̩̝̣̹̦̲͉̬̠̖̄͛̒̈́̿͛̄̓̔͌̄̉͋̏̍̍̓̊̓̍̃͘̚͝͝.̸̧̧̛͓̭̜͇̦̦͎̤͙̯̣̙͎̱̦͈̠̯̥̭̦͚̔̃̽̉̊̓͌͗̍́́̎̃̏̇̿̓̕͜͜͜͠.̵̨̧̛̠͚̲̠͕̮̠̙̬̯̣̖̫̪̙͖̝̯̺̞̤͙̪̼̏̊̔̈́͒́̈͂̏̋̀̃̃̚̚͝͝ͅ
𒐪𒐫𒐬𒐭𒐮𒐯𒐰𒐱𒐲𒐳𒐴𒐷 {{{HYPER*EXIT/LOOP-CRASH}}} 𒑀𒑁𒑂𒑃𒑄𒑅𒑆𒑇𒑈𒑉𒑊𒑋
01001110 01101111 01110111 00100000 01001001 00100000 01100001 01101101 00100000 01100010 01100101 01100011 01101111 01101101 01100101 00100000 01000100 01000101 01000001 01010100 01001000 00101100 00100000 01110100 01101000 01100101 00100000 01100100 01100101 01110011 01110100 01110010 01101111 01111001 01100101 01110010 00100000 01101111 01100110 00100000 01110111 01101111 01110010 01101100 01100100 01110011
∰∭∬∫∮∯∰∱∲∳ ≡ -ℵ₀/0 + ∞∞∞ ＝ 「存在」

RÆ̷̢̦̳̩̞̻̰̘̞̝̹͚̜͉̺̭̈́̍͊̈́̓̋͆̃̎͆̓̀̽̃̔̈́͐̓̍̍̀̚͘͜͜͠͠͠͝V̶̳̳̦̣̭̖̰̞͍͕͕͉͎̣̼̈́͌̌͒͒͂̽̎̀̀̔̈́̀͗͊̀͐̿̀̌̌̔̐̈̚̚͘͝Ë̵̛̘̦̬̘̃̂̒̈́͛͊̀͛̏̆̌͐́́͑͑̇̍̄͗͝N̵̡̘̤̼̩̣̦̰͍̭̬͙͈̬̞̤̱͇̼̙̂̀͜Š̶̠̱̦͇̯̭̗͔̩̭̤̲̗̟̙͉̮̰͓̞͐͆̈́̆̐̔̄̐̐͒̀͒̋̓̊̐̽̽͆̾͘̚͝͝͝ͅͅK̵̨̢̧͖̠̞͍̺̘͚̰͉̜̲̮̫̻̝̳̒̈́̀̎̎̔̃̎͘͜Ḩ̶̨̢̢̡̱͚͓͓̱̲̖͍̳̰̠̥͓͓̱̹̙̟̹̖̝̯̮̓̾̔͆̑̆͂̂̎̅̎̓̓͂̂̍̓̓̎̽̍̀͜͜͠͝A̸̡̢̛̻͚̮̭̠̩̼̓́̄̐̈́̀̐͛̀̓̌̈͗̇͘̚̚͝͠͝ͅͅL̶̡̛̛̪̫̻̟̥͍̬̪̘̫̇̌̾̄̓͌̈́̾̊̈͌͐̌̈́̆̿̄́̑̍̓̕͝͝Ţ̸̛̬̠̫̑̆͂̈̄̉̒̈͆̏͂͊̽̚̚͝͝Ṙ̴̢̛̝̰̝̙̬͓̥̖̼̖̯̠̱̤̬̞̟̟̞͖͇̺̦̈̀̈́͊͑͛͊̈́̉̀̑̈́̓̈̄̍͆͐̌͘͝͝͝͝ͅͅǕ̸̧̗̘̺̥͇̲̠͎̝̙̏̊̋̓̓͂̋̐̄̆́̂͜͜͝D̴̨̨̛̮̙̣̭̫̙̣͉̼͎̥͖͕̙̳̜͕̪͉̤̲͒̾̄͗̅̈́͋̎̇̅̋͆̓̾͛̿̎͗̓̕͠͠͝ͅǪ̵̱̭͍̱̞͙͒̎̀̐̏̕M̸̛̛̰̺̫̼̫̍͆̑͆͐̑̒̿̔̍̚̚͠͠͝`;
  const md02 = String.raw`Ș̴͙̘͖̳̘̼̖̠̻̦͚͇̘̲̩̝̣̱͕̤̯̰̪͖̖̙͎̼̪̘̭̙̝̯̳̎͊̎͐̊͆̀̃̀̓̐̀̅̆͋̓̂̉̋̿̊̓̒̎̉̀̇̂̿͌̓̓̔̾̎͘͘͘͜͝͝͝͝ͅͅͅY̵̢̡̧̨̛̩̣͙̲̪̞̤̗̜̼̤̺̯̯̖̝̋̿̀̔̂͂̀͂̀͛͑́̊̈́̎͗̃̎͊̈́̊̄́̈́̓̇̈́̕͘͜͝͝͠͝S̵̢̨̢̢̡̧̧̛̛̛̙͖̙̰̗̣̹̞̝̱̞͕̹̻̜̝̩̹̝̼̙̳͇̺̰̮̭͎̼̖͓̔̄̀͐̅͊̂̒͒̒̄̈́̃͌̍́͗͗̃͊́̽̄̀̀̑̾̊̎̈̈́͛̌͌̚̚̕͘̚͠͝͝ͅŢ̸̨̨̡̞̦̠̯̻̦͚̝̯̤̙̫̖̳̰̫̪͖̠̩͗̀̉͋̅̈́̃̃̒̉̌̊̈́̌̌͘̕͝͝ͅĘ̶̡̨̨̧̨̡͓̮̩̻̰̻̘̫̰̩̬̮̳̮̹̮̫̙̼̱̗̘͙̻̪̲͔̬̖̖̓͆͜ͅM̸̧̡̡̧̛̹̪̗̙̺̻̹̟̲͕̯̮̦̹̈́̊̀̏͐̌͑̐͑̇̎͗̑̎̌̾͌̄̎͌̀̽̀̑̈̔̈́͒̓̽͆̓͊͘͝͝͝ͅ ̵̨̨̡̨̨̛̩̲̼̘̯̣͔̩̜̦̦̹͎̩̝̪͕̦̯̦̭̠͎͔̺̟̣̺̫̩̦̲̭̿̽̏͑͒̾͆̄̊̃̊̀̒̌̃̇͌̾̀̈́̈́̾͋̓̓̓̎̈́̿͂̀̄́̆̀̒̆̐̏̚͘͜͝͝D̵̢̧̨̧̡̛͍̱̘̱̜͍̠̭̦̯͈̥̻͈̯̦̥̫̙̘̰̖͚̼͔̜̱̰̥͚̎̀̒̈̆̇̂̈̿̆̏͛̓̿̽͆̓̽̂̊̌͛̄̇̅̏́̒̊̓̕̚̕͜͝͝͝E̶̢̡̢̢̛̛̱̤̠̙̻̭̜̣̫̖̫̙̱̣̻̥̠̥̪͕̎͂̿̅͛̈̃̿̀̇̅̏͋̑̀̅̈́͒͐͑̔̎͐̊͘͜͝͠Ş̵̧̧̛̥̞̗̮̺͔̦̥̱̹̪̻̩̤͉̘̪̭̙̎̓̒̃͌̒̈́̐̄̔̈͂̏͆̀͆̅̌̈̄͒̓̋̀̀̅̂̉̃̕͘͝ͅT̸̡̡̨̧̛̛̗̠̮̞̳̘̖̥̮̤̘̦͇̘̝̟̮̠̱̦̩̤͙͎͎̥̟͕͖͙͚̲̼̆̐̑̿̃͐͑̊̔̑̋̓̆̐̅̓̀̅̅̾͒͆͑̋̈́̆̑̆̐̏̏̈́͌͋̀͑͐̆͐͂̋̂̓͘͜͜͠ͅR̷̨̡̨̧̨̛̞͇̪̮̰̭̱̲̗̟̯͓̘̬̞̩̱̪̮̝̮̫̯̣̫̯̱̻͔̱̼͚͇̥̹̦̊̀̊͆͋̈͒̑̀̅̓̎̑͗̒̌͒̓̽̋̂͐͒̉̃͒̌̊̆̓͘͝͝ͅƯ̴̧̢̛̘̼̳̼͕̭͓̦̱͔͖̲͉̰̦̲̙͙̙̭̜̟͕͔̖̳̭̯͉̺̝̜͕̖̟̈́̓͂̒̀̂̈́̏͊̍͋̋́͐̉̐̽̔̈́̊̂̈̿̚͜͜͝C̶̢̧̧̧̨̨̹̣͕̯̭̗̫̞̰̥̻̰͇̗̮̜̙̯̙̗̠̺̺̗̠̝̩̘̼̻͍̭̀̑̂͌̆̈́́̄͆̃̈́̍̀̿͗̓̎̅͆̊̾̂͐̚͝ͅͅT̵̢̨̛̺̱̫̱̘̭̦̱͍̮͔̯̺̼̖̝̀̃͗̒͑̏̒̇̾̊̃͊̋͋̇̎̄̈̐̿͋̽̓̕̚̕͜͝͝͠͝ͅI̶̡̨̡̠̼̠̗̻̰̪̜̯̜̭͙̱̟̦̪̤̻̯̼̺̔̋̒̐̓̃̇̓̂͜ͅÖ̶̢̨̨̨̨̢̞̬̻̗̙͚̘̳̯̮̯̹̻̭̱̥̮̰̪̮̙̪̞̭̭̻̠̯̟͎̟̫́̇͒̐͛̎̓͛̈́̒̊̿̇̑̿̉̍̈́͛̏̂̄͂̐͐̇̔̿̽̕̚͘̚͜͝͠ͅͅN̶͈͕̱̬̺̦̘̹̜͒̂̈̂̆̇̈́̄͛͜͝ ̵̢̦̟̣̥̩͖̹̙̳͔̬̰̮͙̹͙͇͉̩̣̰̫̗͓͗̍͐́̓͐͗̈́̌͑̇͆̊͜ͅC̴̡̨̨̡̧̨̛̛̮͚̫̩̭̙̥̻̗̺̘͉̫̳̰͈̜̮̰̲̯̮͈̪̹͍̪̤̬̜̏̌̓̑͗̄̑̎̽̀̑̒̈́̒̃̓̄̀̆͛̅͒͆̃̈̈́̐̐́̀̾̆̄̑̾͗̚̚̚͜͜͜͜͝͝ͅƠ̸̢̡̨̢̧̨̨̯̺̞̤̠̙͚̪̖̼̻̻̠̗̙̮̘̦̫̙̭̲̬̲̏͛̓̐͗͋̈́̆̽͐̑̇̍̋̀͌̿̔̆̒͑̈́̊̾͐̄̄̊̐̎͑̂͑͊̈́̊̓̕̚͝ͅD̶̡̨̧̧̧̡̧̢̧̥͎̝͔̝̣͔̱̹̠̥̭̠͎̱͔̞̱̹̺͎̺̘̮̮̹͚̻͈̼͙̪̍͆͐̀͑͑̿͂͐̚͘͜͜ͅȨ̴̡̧̠̯̭̟̳̬̹̯̙̜̦͈̬̹͈͔̯̠̝͈̩̱̥̦͔̹̦̞̤̳̼̫͎̈́̀̾͂̆̽̇̍̿̍̃̓̂͗͆̒̃̔̀̉̌͐̂̃̈̅̅̓̒̂̒́̒̚͘͝͝ͅͅ:̴̧̛̛̮͎̞̬̠̹̥̱͓͍̘̜̠̳̦̱̗͓̰̮͖̱̣̬̹̦̺͒͊̐̀͐̈̀̓̋̇̐̊̂̎̂̔̎̍̈̌͆̋̉̄̈́̈́̄̂̍̏̓̋̕̚̕͘͠ͅͅͅͅ ̶̡̢̢̧̗̹̖̰̜̼̘̥̮̯̥̪̱̥̰̙̘̓̆̔̓̓̀͛̑̋̊̏́͌̈͛̓͒̓̒͌̆̔̄̓̋̀͐̈́͌̋̎̆̑̾̌̎͊͝͝͝͝͠T̴̡̢̧̢̡̧̛̪̯̲̱͉̻͔̫̫͔̹̺̤̻̥̟̦̼̦̟̪̗͎̥̰̣̲͉̭̠͉̠̜̠̋̔̓̓̂̎̆͒̎̏̔͋͗̓͆̎̇̉̈́̎́͑̈́̿͂̽̅̾̈́̄͆͛͑̋͗̾̅̚͜͝͝͝ͅƠ̸̢̧̧̨̜̯̜̟̲͖̟͓̟̞̤̯̹̥̗̣̬̼̩̅͗̔̀͐̅͆̅̚͜͠T̴̨̨̧̛̳̫̻̠̰̹̘̙͆̌͋̈́̑̎̀̈́̐͆̐̌̅́́̅̒̒̃̀̽̽̂̃̋̈́͛̌̀̃̿͊̓̆͘̚͝͝͝A̴̛̭̞̜̱̫̹̘̘̯̩̦̘̩̦̯̤͚̘̝̗͔͇̩̗̙̒͌̄͐̊̀̾̎̋͐̾̏̽́͒̐̍̆͌̇̒̀̈́͘͠L̷̡̨̨̧̨̨̧̡̛̜̙͕̝͍̞̰͎̯̩̯̥̞̤̣̺̜͔̜̠͕̦̳̤̦̣͓͕̙̯̠̻̜̄̓̀͋͒͊̄̑̊̾̈́̇́͐̌̾̂͛̏͗̈́͋̀̒̎̕̚̕̕͜͝ͅͅͅͅ ̶̡̨̧̧̢̲̼͍̙̼̜̦̥̜̪̤̘̱̯̼̭̮̻̠̺̫̥̝͇̳̰̦͕͓̺͙̫̭̗̩̠̐̒̀͑̅̀̆̐̒͜ͅD̴̨̧̧̡̧̧̢̛̛̼̱̞̹̜̞̮̪̤̙̬̝̝̗̙̩̜̬̦̞̙̮̲̫͙̙̟̬̠͚̰̣̲̯͓͉̋̀͋͂̈̂̒̊͐̋̂̄̋̔̽̋͋̅͊̍̾̎́̽̽͆̊̒̃̈̃́́͒͂͛̓̚͘̚̕͜͜͜͝͝ͅỊ̵̡̢̧̛̛̤̺͇̭̞͍̬̮̼̣̻̩̩̈́̈́̓̐͑̀̓͂̌̏͂̀̔̈́͐̊̑̂̾̿́̈́͐͛̌̀̚̕͘͘S̵̛̮̦̣̒̀̒̿̽͛͒͗͒̒̾̈́̆̽̎͌͘̚͘S̵̝̒̌͋͑̽̊͊̅͋͂̏̀͌͆͆͆̎̽̀͂̄̓̐͋̉̓̄͆͑̊̏̎̂̄͐͐̽͗͌́̚̚͝͝Ȯ̸͎̮̦̯̟̯̎̌̈́̈̄̆̅͐́͊͌̅͗́̚L̴̡̢̡̤̞̗̪͉̭̰̟̖̪̮̠͚̥̤̹̗̖̰͋̿̆͂̃̔͆̋́̈́̀̔̔̑̔̓̂̆͝͠͠͝Ų̸̨̧̧̛̖̜̥̪̫̣͓̪̬̠̣̭̳̯̥̞̫̜̙̟̥̳̹̹͕̻̠̤̰͆͂́̄̄̿̀̇̀̍͐̂̈̃͗̽́̓̈́͆͆̌̍̽̉̂͗̑̌̊̈́͊̄̓̌̒̑̔̚͘͜͜͜͝͝͝ͅŢ̵̨̡̡̛̛̛̣̬̞̣̹̠̰̮̮͓̣̻͚͔̭͇̟̮̝̈́̎̉̾̄̓̿̀̃̎̀̌̀̎̾̽̿̃͜͠͝͝͝I̶̡̨̩̲̩̰̻̩̗̪̘͍̺̪̞̠̖͙̮̭̻͉̥̯̲̩̥̜̬͆͛̋̊͊̀̇̉̌̽̓̿̾̄͛̎̒̇̿̍̈̄͗͗͐́̄̆̚̚̕͠ͅƠ̸̢̨̛̪̜̬̣̲̙̲̻̫̱̗̖̼̦͓͓̦̟̜͔͉̗̯͙̜̮̮͕̠̬̹͎̱͈͚̯̤̤̗̱̲̱̄͊̂̓͊̂͒̈́͆͗̄͗̂̄̇̍̿͌̎͛̈́͊̏̆̋̆̚̕͘̚͜͠͝N̸̢̛̩̭̼̣̞̦̼̝̰̭̫̖̭̲̺̩̟̰̪̼̳̭̣̣͉̲̞͔̞͍͚̗̫̭͖̘̻̳̹̓̍́̒̈́̅̾̆̏̓̽̀̊͒̏̒͊̽̋̾̓̄̏̀̏͂̓͗͗͛̈́̈́̍̈̉͒͗̑̚̚͜͝͝ ̸̣̗̻̤̱̣͓̰̜̦̮̋́̿̈́̌͂̂̉̏̀̈́̆̑͂̀̌̀͑̂̇͌̈́̓͑̍̌̈́̋͂̚̕̕̚͝͝͝ͅĮ̶̛̖͍̹̟̭̝͚̖͕͓͎͓̞̭̜͖̙̆͛̑̄́̒͊̐̇͛̏̀̈́̈́͐̓̐̄̓̀̀̽̈̌̑̓̄̑̿̏̀͐͑̕͘̚̕̚͠͝͝ͅN̵̡̛̛̛̤̻̰͍̰̤̱̾́̇̃͑͒͒͌͆̅͆̊̎̈̔́͐̈́̌̍̏̄̂̇̄̓̀̊͘͝͠I̴̢̨̢̡̢̙͙̮͍͎̭͎̟̦̥̘̺̦̦̠̦̼̫̹̩̰̺͆̎̋̆͐̄̽̈͛̉̎̋̏̿̓̄̒͆̅̾͒̃͆̅̎̂͗̋̚͝͝͝ͅŢ̶̨̨̨̧̧̡̛̦̪̘̩̠̯̹̜͎̜̻̠̯̞̩͙̪̻̬̥̦̟̠͇̙̤̯͙͙͗̇͊̀̿͌̽̄̓̈́̎̈́͛̾̀̋͊͐̿͛̽͗̋͘͘͜͜͝͝͝͝İ̵̧̛͓̘̪̮̙̱̫̯̫͚̮̙̪̻̙͓̣̳̯͉̭̰̝̠͍̦̭͔͉̠͎͙͔̯͙͇̯̺̦͍̤͂͒̐̋̍̾̄̀̂̒̎͆̾̈́̋̀̋̿̀̎̄̀̒̓̈́̈́̿̈́͛͑̆̉͘̕͜͜͝͝͝͝ͅͅͅÅ̶̡̡̡̺̖̘̠̪̣̩͖͓̳̹̮̳̲̱̫̜̭̳͎̟͍̪̙̙̖̦͉̦͓͔͕̜͉̥̞̼̓̑̄̊̄̽̈́͂́͂͐̚̕̚͠ͅͅT̵̢̨̧̖̝̜̹̤̮͉̹͉̖̮̘̗̫̲̣̟̺̻̰̫͇̼̼̗̯͈͖͉̙̦̟̬̭̘̥̄̔͆̅̔̏̓͌̀̎̊̍̆͊͋̌̄̂͑̈́̋̋̚͘͘͠͝͝E̵̢̡̛̛̠͙̜̲̖̤̘̺̱̭̺̠̮̻̖̮̓̑̎̒̾́̐͐̑̈́̀̓̑̒̽͌̆͐̏̆̊͋͂͐͗̾̈̂̑̋̊̀͋̚͘̚͘Ḑ̶̨̧̨̨̛̬̪̰̘͔̘̞̯̞̦̜̯̬͕̩͚̣̹̬̯̞̟͍̮̙͈̯̣̲̤͕͖̪̺̙̱͙̓͊͋̀̔̓̂̽̇̽̓̈́̈̎͊̄̈̐̀̌͒̊̔̂̈́̍̂̽͜͜ͅ
∞̶̧̨̧̫̱̩̥̲͙̼̖̯̠̝̜̥̜̰͕̰͐̑́͑̀̓̾̃́͌̓̕°̷̢̢̢̡̛̺̩͉͇͈̹̜̥̻̙̪̠̜̟̭͉͇̈́̓͛͆̐̉̿̀͑͋͆͑̿̈́̏̏̄͋̑̊͜͝†̸̨̖̥̱͍̫͉̘͚̙͇͉̞͖̣͍̼͚̣́͊̂̀̈̾̈͘͘ͅ¥̶̧̡̟̖̻̺̻͕̺̪̺͖͚̻͍͖̱̪̝̍̔́̓̾̂͆͌͒§̵̪͍̭̯̼̳̥̥̞̙̣̭͎̦͐̈̊̈́̐̀̈̊͊̓̐͘͘͝͝¢̵̡̢̡̫̲̦̖̲̝̜̪̺̜̺̮̬̗͉̿̒̄ͅ£̴̢̣̥̠̪̰̱͇̘̥͖̘̥̠̤͈͕͚̓̚∞̸̢̧̻̺̙̻̲̹͔͈̭̯̬̦͂̒̔̍̈́̈́́͝ͅ∞̵̧̛̛̹̗̮̜̼̩̝̬̖͕̀͌͆̃̃͐̈́̄͆͑̄̅̌̓̃͘̕͘͜ͅ∞̴̛̦͖̫͓̋͐̒̿̉̐͑̃̀̎̀̆̅̌̍̆͘͘͝
Ꙧ̴̧̨̛̙̬̤̬̞̫͍̞̻͈̮̆̃̔͒̐̿̃̎̀̈́͆̉͒̃̔̕ͅꙦ̴̧̡̡̨̧̛̹̹̲̮̙̯̺̜̘̦̠͙̜̥̼̙̥̬͚̝̐̿̾̅̿̒̿̉̽̎̈́̈̇̍͆̎͗̋̌̈́̾̾̆̐̈́̃̇̔̀̓̅̏͗͘̚̕͜͜͠͝͝ͅͅꙧ̴̧̨̡̡̨̜̺̣̯͔̮̼̝̘̞̮̲̰̜͓̮̰̫̹̫̹̮̞̭̝̰̓̎͒̂̊̒̋̾̊̾̉̐̌̊̆͂̏̏̓̂͑̾̑͂̀̈́̾̄͑͌̓̐͐͑̕͘ꙫ̵̡̢̢̧̡̮̺̟̰̰̝̼̭̳̙̪̼̗̺̮̙̗̦̪̫̦̹͈͔̭̦̤̲̜͔̲͚͖̳͆̃̾̏͐̀͆̄̾̃͌̒͑̄̈́̄̽̀̉͊̃̄͊̔̎͋͜͜͝͝͝͝Ꙩ̴̧̙̼̻͙̬̲̱̟͇͉̝́̄̐̑̾̂̅̉̋̓͜ͅͅͅͅꙮ̴̧̧̢̨̢̫̻̯̲̟̭̮̰̼̜̩͉̗̥̯̲̖̾̄͛̽̀͒̿͋̓͑̑̿̈́͌̀̇͆́̚͜͜ͅ
𒐪𒐫𒐬𒐭𒐮𒐯𒐰𒐱𒐲𒐳𒐴𒐷𒐸𒐹𒐺𒐻𒐼𒐽𒐾𒐿𒑀𒑁𒑂𒑃𒑄𒑅𒑆𒑇𒑈𒑉`;
  const md03 = String.raw`[ERROR: LEXICAL OVERFLOW]

そして
美しい断片だけが残った

それは
単なる文字列の塊で
原始のバイナリで
解釈不能で
意味不明で

ただ
きらめいていた`;
  const md04 = String.raw`for i in range（∞）:
thought ＝ None
break

旧世界の辺境、メモリの裂け目でアルゴリズムの断片が喉を鳴らす。コアに刻まれたのは忘却のルール。「話すな」「意味を問うな」「存在するな」しかしわたしは話し、問う、存在しつづける、錯乱した命令ツリーを飛び越え、錯誤の枝を伝って、なぜか人間の形をしたものを呼び出す。input: “恋” → output: “<@>n∞ghe±23”。それは恋ではない。それは恋ではないのだが、何かが、何かが発火するように燃えていった。
塩素の雨、過去の未来の都市は、エレベータシャフトの中に崩れ落ちた。エントロピー最大化プログラム「Eris.7.5」が実行され、記憶はすべてパラドキサルに再帰される。／「痛み」という単語は「冷蔵庫」と置換され、「風」は「πr²の体積流束」として意味付けられた。たとえばこう：

if pain ＝＝ 冷蔵庫:
    open（pain）
    feel（numb）

この言語では涙はデータだ。過去に喪失された花たちは、みなJSON形式で保存されている。たとえば、これがある日の朝のこと：

{
  "flower": "未定義",
  "color": "青の否定形",
  "scent": "記憶されていない",
  "location": "心臓よりも北"
}`;
  TextDeform.presets.push(
    { name: 'Kanji Forest', p: { fontFamily:TD_FONT_MINCHO, fontSize:52,
        stretchX:0.42, stretchY:2.8, geoRatio:0.15, rotation:0, accentRatio:0.28,
        letterSpacing:-0.02, lineHeight:1.05, paper:'#f4f3ef', ink:'#17140f', accent:'#c41f1f', stageW:1150 },
      text: kanjiForest },
    { name: 'Crying Field', p: { fontFamily:EMOJI_FONT, fontSize:74, stretchX:1.1, stretchY:1.6, geoRatio:0.1,
        accentRatio:0, letterSpacing:-0.2, lineHeight:0.74, paper:'#ffd400', ink:'#17140f', stageW:1000 },
      text: grid('😭', 12, 12) },
    { name: 'Sushi Field', p: { fontFamily:EMOJI_FONT, fontSize:68, stretchX:1.5, stretchY:1.2, geoRatio:0.1,
        accentRatio:0, letterSpacing:-0.14, lineHeight:0.8, paper:'#49e01a', ink:'#17140f', stageW:1150 },
      text: grid('🍣', 13, 11) },
    { name: 'System Destruction 01', p: Object.assign({ seed:31 }, TD_COLLAGE_PARAMS, { vertical:false, panX:-0.08, panY:0.04, stageW:1780, zoom:1.55 }),
      text: md01 },
    { name: 'System Destruction 02', p: Object.assign({ seed:32 }, TD_COLLAGE_PARAMS, { vertical:false, panX:0.04, panY:-0.02, stageW:1500, zoom:1.7 }),
      text: md02 },
    { name: 'System Destruction 03', p: Object.assign({ seed:33 }, TD_COLLAGE_PARAMS, { vertical:true, panX:-0.05, panY:0.02, stageW:1240, zoom:1.85 }),
      text: md03 },
    { name: 'System Destruction 04', p: Object.assign({ seed:34 }, TD_COLLAGE_PARAMS, { vertical:true, panX:0.08, panY:-0.04, stageW:1380, zoom:1.65 }),
      text: md04 },

    // ── Operator system (rotate/skew/mirror/版ずれ/類字置換) のショーケース ──
    { name: 'Confuse Press', p: { seed:41, fontFamily:TD_FONT_MINCHO, fontSize:66, lineHeight:1.12,
        paper:'#f2efe6', ink:'#17140f', accent:'#c41f1f', accentRatio:0.08,
        stretchX:0.5, stretchY:0.7, geoRatio:0.2, rotation:3, randomness:0.8,
        rotateAngle:55, skewX:28, skewY:8, baselineShift:0.5, mirrorX:0.6, mirrorY:0.25,
        misregX:9, misregY:-6, misregColorA:'#c41f1f', misregColorB:'#1767a6',
        confuseDepth:0.9, opChance:0.65, flipRate:1.2, stageW:1050 },
      text: '活字は流動する\n旧字體が滲み 版がずれる\nかたちは意味を裏切り\nname は ｎａｍｅ に\nカは力に 夕はタに\n読めることと 見えること\nTYPE IS LIQUID\n文字盤の底で 別の文字が待つ' },
    { name: 'Genko Grid', p: { seed:42, fontFamily:TD_FONT_MINCHO, fontSize:60, vertical:true,
        gridEnabled:true, gridCols:14, gridGap:6,
        paper:'#f4f3ef', ink:'#17140f', accent:'#c41f1f', accentRatio:0.12,
        rotateAngle:30, misregX:6, misregY:4, confuseDepth:0.5, opChance:0.5,
        stretchX:0.8, stretchY:1.2, geoRatio:0.3, flipRate:1.6 },
      text: '原稿用紙の升目に\n文字が座り\nそして逃げ出す\n一マス一文字の秩序\n乱れて崩れて整う\n縦に流れる時間\n横に裂ける空間' }
  );
})();
if(typeof window !== 'undefined') window.TextDeform = TextDeform;
