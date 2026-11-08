'use strict';
/* Fude engine — vj/ の追加レンダリングモード (kind:'fude')。入力した文字を毛筆で書き直す。
   フォントの輪郭をそのまま使わず、グリフから「骨格 (筆の通り道)」を取り出して、その上に筆を走らせる。
   - 骨格: 文字を Canvas2D に描く → 距離変換 (局所の太さ) + Zhang-Suen 細線化 → 端点/交点のグラフ化
     → 短いヒゲを刈る (spur) → 交点でまっすぐ続く枝どうしをつなぐ (merge) → 平滑化 (smooth)。
     グリフごとにキャッシュする。書き順は上→下 / 左→右の近似。
   - 幾何: 骨格 1 本 = リボン 1 本。太さ・テーパー・はらい等は頂点シェーダで計算するので全部ライブに動く
     (文字列・骨格・はね/はらいの長さが変わったときだけ CPU で作り直す)。
   - 墨: リボンを専用 FBO へ描く。R=被覆 / G=濃さ / B=墨溜まり / A=重なり回数。RGB は MAX 合成なので
     自分自身の折り返しでは濃くならず、A だけ加算して交差の濃さ (Overlap) に使う。
     毛の筋・かすれ・毛先の割れは (太さ方向 x, 進行方向 s) の 2D ノイズで作る。
   - 合成: 墨バッファを読み、にじみ (ループ上限は uniform) ・紙の目・艶を足して出力へ。
     Slot B は実 alpha (Transmute / Wind Flock と同じ straight alpha)。
   - 時間基準は Wind Flock と同じ: beat モード = 拍数 / drone = time × 6 × bpm/120
   IF: init(gl) / update() / render({fbo,w,h,slot,beat,clock,opaque}) / restart() / P(params)
*/

const FUDE_MAX_CHARS = 120;     // 文字数の上限 (これ以上は切る)
const FUDE_MAX_SPLATS = 600;    // 飛沫の点数の上限
const FUDE_VARIANTS = 8;        // 1 文字ごとに使い分ける筆の組数
const FUDE_POSTER_TYPES = 16;   // ポスターの型の数
const FUDE_POSTER_UNIT = 6;     // ポスター型の座標: 画面の高さ=6 (筆の太さや飛沫の尺度を他の組み方と揃える)
const FUDE_CELL = 192;          // 骨格抽出の 1 文字のキャンバス (px)
const FUDE_EM = 150;            // 骨格抽出のフォントサイズ (px)

// フォントの候補。fam が端末に無いものは Fude.fontList() が一覧から外す (web=同梱の @font-face は常に出す)
const FUDE_FB = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic",'+MT_UNICODE_FB+',sans-serif';
const FUDE_FONTS = [
  ['Hiragino Sans',          '"Hiragino Sans","Hiragino Kaku Gothic ProN"'],
  ['Hiragino Mincho',        '"Hiragino Mincho ProN"'],
  ['Hiragino Maru Gothic',   '"Hiragino Maru Gothic ProN"'],
  ['Yu Gothic',              '"Yu Gothic","YuGothic"'],
  ['Yu Mincho',              '"Yu Mincho","YuMincho"'],
  ['Klee',                   '"Klee"'],
  ['Tsukushi A Round',       '"Tsukushi A Round Gothic"'],
  ['Toppan Bunkyu Mincho',   '"Toppan Bunkyu Mincho"'],
  ['Kaiti (楷書)',            '"Kaiti SC","Kaiti TC","STKaiti"'],
  ['Xingkai (行楷)',          '"Xingkai SC"'],
  ['Libian (隷書)',           '"Libian SC"'],
  ['Weibei (魏碑)',           '"Weibei SC"'],
  ['Hannotate',              '"Hannotate SC"'],
  ['Wawati',                 '"Wawati SC"'],
  ['HG 教科書体',             '"HGKyokashotai","HG教科書体"'],
  ['HG 行書体',               '"HGGyoshotai","HG行書体"'],
  ['HG 正楷書体',             '"HGSeikaishotaiPRO","HG正楷書体-PRO"'],
  ['UD デジタル教科書体',      '"UD Digi Kyokasho N-R","UD デジタル 教科書体 N-R"'],
  ['Zen Old Mincho',         '"Zen Old Mincho"'],
  ['Noto Sans JP',           '"Noto Sans JP"'],
  ['EB Garamond',            '"EB Garamond"'],
  ['Georgia',                '"Georgia"'],
  ['Aratana',                '"Aratana"', true],
].map(([name, fam, web])=>({ name, fam, web, ff:fam+','+FUDE_FB }));

// 配色のセット: [名前, 濃い墨, 淡い墨, 紙]
const FUDE_COLORS = [
  ['墨と和紙',   '#09090b', '#4d4d54', '#ede8db'],
  ['墨と白',     '#0e0e10', '#5a5a60', '#fafaf7'],
  ['白と墨',     '#f4f1ea', '#a09d96', '#0b0b0d'],
  ['朱と生成り', '#c8321e', '#e8856f', '#f1e9d8'],
  ['藍と白',     '#15306b', '#6c83b8', '#f2f2ee'],
  ['金と黒',     '#d9b562', '#7d6530', '#0c0b09'],
  ['紅と墨',     '#e0263f', '#7d1224', '#0d0a0b'],
  ['緑青と砂',   '#1f6f64', '#6ea69b', '#e9dfc8'],
  ['紫と銀',     '#4b2a86', '#9a86c8', '#e6e4ea'],
  ['蛍光と黒',   '#d7ff2e', '#6f8a12', '#0a0a0a'],
  ['桃と藍',     '#ff7aa8', '#b24a75', '#131b3c'],
].map(([name, ink, ink2, paper])=>{
  const rgb = h=>[1,3,5].map(i=>parseInt(h.slice(i, i+2), 16)/255);
  return { name, ink:rgb(ink), ink2:rgb(ink2), paper:rgb(paper) };
});
const fudeHsl = (h, s, l)=>{
  const f = n=>{ const k = (n + h*12) % 12; return l - s*Math.min(l, 1-l)*Math.max(-1, Math.min(k-3, 9-k, 1)); };
  return [f(0), f(8), f(4)];
};

const fudeContrast = (a, b)=>{
  const lum = c=>c.reduce((sum, v, i)=> sum + [0.2126, 0.7152, 0.0722][i]*(v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4)), 0);
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05)/(Math.min(x, y) + 0.05);
};

// Word Set が空のときに読む文字列 (/ は改行)
const FUDE_WORDS = [
  '永遠', '夢', '無', '空', '風', '光', '心', '龍', '愛', '侘寂', '雪月花',
  '一期一会', '花鳥風月', '色即是空', '諸行無常', '温故知新', '明鏡止水', '行雲流水', '不易流行',
  '和敬清寂', '夢幻泡影', '森羅万象', '百花繚乱', '山紫水明', '春夏秋冬', '一日一生', '日日是好日',
  '花/鳥/風/月', '春/夏/秋/冬', '色即是空/空即是色',
];

// Brush Rand で揺らすキー
const FUDE_BRUSH_KEYS = ['width','fontWidth','nib','pressure','entry','taperIn','taperOut','harai','tome','corner','wobble','kasure','dryStart','splay','rough'];

// 書の書体: パラメータの組。選ぶとスライダーへ入り、そのあと個別に動かせる
const FUDE_STYLES = [
  { name:'Custom', p:null },
  { name:'楷書 (端正)', p:{ width:1.1, fontWidth:0.35, nib:0.6, nibAngle:-35, pressure:0.35, entry:0.9, taperIn:0.6, taperOut:3, harai:1, tome:0.6, corner:0.5, wobble:0.1,
      kasure:0.55, dryStart:0.45, splay:0.3, rough:0.2, smooth:3, link:0, linkThin:0.3, hataku:0, hane:0.8, vary:0.35, stretch:1,
      ease:3, easePow:2, strokeGap:0.12, speedVar:0.1 } },
  { name:'行書 (つなげる)', p:{ width:1.1, fontWidth:0.3, nib:0.45, nibAngle:-35, pressure:0.75, entry:0.4, taperIn:1.6, taperOut:4, harai:1, tome:0.15, corner:0.25, wobble:0.35,
      kasure:0.85, dryStart:0.25, splay:0.5, rough:0.3, smooth:6, link:0.55, linkThin:0.3, hataku:0, hane:0.6, vary:0.7, stretch:1,
      ease:3, easePow:1.5, strokeGap:0.03, speedVar:0.35 } },
  { name:'草書 (一筆で崩す)', p:{ width:1.0, fontWidth:0.15, nib:0.3, nibAngle:-35, pressure:1, entry:0.2, taperIn:2, taperOut:5, harai:1, tome:0, corner:0.1, wobble:0.6,
      kasure:0.9, dryStart:0.25, splay:0.55, rough:0.35, smooth:10, link:1, linkThin:0.2, hataku:0, hane:0.3, vary:1, stretch:1,
      ease:1, easePow:2.2, strokeGap:0, speedVar:0.6 } },
  { name:'隷書 (波磔)', p:{ width:1.25, fontWidth:0.3, nib:0.75, nibAngle:90, pressure:0.3, entry:0.5, taperIn:0.3, taperOut:2, harai:0.6, tome:0.5, corner:0.3, wobble:0.1,
      kasure:0.4, dryStart:0.5, splay:0.2, rough:0.35, smooth:3, link:0, linkThin:0.3, hataku:1, hane:0, vary:0.3, stretch:0.78,
      ease:4, easePow:1.8, strokeGap:0.15, speedVar:0.1 } },
  { name:'篆書 (均一な線)', p:{ width:0.85, fontWidth:0, nib:0, nibAngle:-35, pressure:0.12, entry:0, taperIn:0, taperOut:0.2, harai:0, tome:0, corner:0, wobble:0.12,
      kasure:0.2, dryStart:0.7, splay:0, rough:0.15, smooth:5, link:0, linkThin:0.3, hataku:0, hane:0, vary:0.2, stretch:1.2,
      ease:0, easePow:2, strokeGap:0.08, speedVar:0 } },
];

const Fude = {
  gl:null, initialized:false,
  strokeProg:null, splatProg:null, compProg:null,
  vao:null, vbo:null, ibo:null, indexCount:0,
  splatVAO:null, splatVBO:null, splatCount:0,
  emptyVAO:null,
  inkFBO:null, inkTex:null, inkW:0, inkH:0,
  startTime:0,
  _sig:'', _lastBuild:0, _fontGen:0, _fontWait:{}, _glyphs:new Map(),
  _bbox:[1,1], _box:null, _compT:-1, _compSeed:null, _compBag:[], _aspect:0, _vt:[{ id:0, st:null, mul:null }], _nUnits:[0,0], _t0:null, _cycle:0, _beatBase:null, _curText:null, _curRaw:'', _wordIdx:-1, _setChanged:false, _wasText:'', _onSeed:null,

  // ── パラメータ (UI から操作)。数値は uniform に渡す直前に App.deadParam を通す ──
  P:{
    text:'永遠',
    words:'',         // 文字列セット (1 行 1 文字列、/ で改行)
    textPick:0,       // 0=Text をそのまま / 1=セットからランダム / 2=セットから順番に
    fontFamily:FUDE_FONTS[0].ff,
    style:0,          // 書の書体 (FUDE_STYLES の番号)。0=Custom
    bold:0,           // 0=標準 / 1=太字 (骨格の取れ方が変わる)
    layout:0,         // 0=横組 / 1=縦組 / 2=ランダム配置 (全文字を画面にばらまく) / 3=毎回ランダム / 4=毎回ランダム (ずらし・大きさも)
    align:0,          // 0=中央 / 1=先頭 / 2=末尾
    tracking:0.04,    // 字間 (em)
    leading:0.3,      // 行間 (em)
    wrap:0,           // 1 行の文字数で折り返す (0=改行のみ)
    // 骨格
    smooth:3,         // 平滑化の回数
    spur:1.6,         // 刈るヒゲの長さ (局所の太さに対する比)
    merge:50,         // 交点をまっすぐ通過させる角度の許容 (°)
    hane:0.6,         // 下へ止まる線に「はね」を付ける確率
    haraiLen:1.0,     // 斜めの線を「はらい」として延ばす長さ
    hataku:0,         // 波磔: 右へ走る横画の終わりを跳ね上げる (隷書)
    link:0,           // 連綿: 1 文字の中で画と画を筆脈でつなぐ確率 (行書・草書)
    linkThin:0.3,     // 連綿の線の細さ
    // 1 文字ごとの配置 (Seed で変わる)
    scatter:0,        // 位置のランダム (全方向、em)
    shift:0,          // ずらし: 組の方向と直交にランダム (基線のばらつき)
    stagger:0,        // ずらし: 1 文字おきに互い違い
    stair:0,          // ずらし: 1 文字ごとに階段状に
    scatterRot:0,     // 傾きのランダム (°)
    sizeMin:1,        // 大きさのランダムの下限 (倍)
    sizeMax:1,        // 大きさのランダムの上限 (倍)
    sizeSkew:1,       // 大きさの偏り (1=均等 / 大きいほど小さい字が多く、たまに大きい字)
    aspect:1,         // 文字の縦横比 (1=正方形、大きいほど横長)
    aspectRand:0,     // 縦横比のランダム
    slantRand:0,      // 傾斜のランダム
    compose:1,        // ランダム配置: 1=構成 (階層・格子・構図) / 0=完全に乱数
    even:0.6,         // 完全に乱数のときの散らばりの均等さ (0=純粋な乱数)
    area:1,           // ランダム配置の広さ
    // ランダムの単位。0=固定 / 1=1 文字ごと / 2=1 セットごと (1 セット=文章を 1 回書く間)
    styleRand:0,      // 書の書体
    fontRand:0,       // フォント
    brushRand:0,      // 筆の値
    brushAmt:0.5,     // 筆の値の揺れ幅
    layoutRand:0,     // 位置・傾き・大きさ: 0=1 文字ごと / 1=1 セットごと (全文字が同じ値)
    seed:1,           // 乱数の種
    reseed:1,         // 0=Seed を固定 / 1=毎回変える (Loop の周回・C・プリセット読込)
    vary:0.6,         // Seed で変わる字形・筆致の幅 (0 で毛の模様と飛沫だけが変わる)
    // 筆
    width:1.15,       // 筆の太さ
    fontWidth:0.35,   // 元の書体の太さをどれだけ引き継ぐか
    nib:0.6,          // 筆の向きによる太細 (明朝の縦太横細)
    nibAngle:-35,     // 筆の向き (°)
    pressure:0.7,     // 筆圧のゆらぎ
    pressFreq:4,      // 筆圧のゆらぎの細かさ
    entry:0.7,        // 打ち込みのふくらみ
    taperIn:1.2,      // 書き出しの細り (筆幅の倍数)
    taperOut:3,       // はらいの長さ (筆幅の倍数)
    taperPow:1.1,     // はらいの細り方
    harai:1,          // はらいの強さ (0 で全部止め)
    tome:0.35,        // 止めのふくらみ
    corner:0.3,       // 曲がり角の溜め
    wobble:0.2,       // 手ぶれ
    wobbleFreq:5,     // 手ぶれの細かさ
    // 毛
    bristles:18,      // 毛の本数
    streak:9,         // 筋の長さ (筆幅の倍数)
    bristleContrast:1.4, // 筋のコントラスト
    kasure:1.0,       // かすれ
    dryStart:0.2,     // かすれ始める位置 (墨の残量)
    speedDry:0.7,     // 曲がり角はかすれにくい (筆が遅い)
    refill:2,         // 墨継ぎの間隔 (画数)
    splay:0.5,        // 毛先の割れ
    rough:0.3,        // 縁の荒れ
    edgeSoft:0,       // 線の縁のぼけ
    bristleLean:0,    // 毛の筋の傾き (線に対して斜めの筋)
    fineHair:38,      // 細い毛の筋の割合 (%)
    rimDry:40,        // 線の縁のかすれやすさ (%)
    // 墨
    density:0.9,      // 墨の濃さ (低いと Ink 2 へ寄る = 淡墨)
    tone:0.35,        // 濃淡のむら
    pool:0.5,         // 墨溜まり
    overlap:0.4,      // 線が交わる所の濃さ
    bleed:0.2,        // にじみ
    bleedScale:14,    // にじみの模様の細かさ
    bleedFiber:0.5,   // 紙の繊維に沿う度合い
    bleedTaps:8,      // にじみのサンプル数 (負荷)
    splatter:0.12,    // 飛沫の量
    splatSize:0.7,    // 飛沫の大きさ
    splatSpread:1,    // 飛沫の飛距離
    sheen:0,          // 濡れた墨の艶
    sheenAngle:129.8, // 艶の光の向き (°)
    sheenPower:6,     // 艶の締まり (大きいほど細く鋭い)
    inkGamma:1,       // 墨の濃淡のカーブ (1 より大きいと淡い部分が増える)
    edgeRing:0,       // 縁だけ濃く残す (中が抜けて輪郭になる)
    bleedHalo:100,    // にじみの滲み出し (%)
    grain:0.3,        // 紙の目
    grainSize:100,    // 紙の目の粗さ (%)
    paperMottle:0,    // 紙の雲むら (低周波の濃淡)
    paperVignette:0,  // 紙の四隅の焼け
    paperAlpha:0,     // Slot B での紙の不透明度
    colorMode:0,      // 0=指定色 (Ink / Ink 2 / Paper) / 1=セットから選ぶ / 2=セットからランダム / 3=完全ランダム
    colorSet:0,       // colorMode=1 のセットの番号
    ink:[0.035, 0.035, 0.045],    // 濃い墨の色
    ink2:[0.3, 0.3, 0.33],        // 淡い墨の色
    paper:[0.93, 0.91, 0.86],     // 紙の色。Slot A では背景に敷く
    // 書き順
    write:1,          // 0=全表示 / 1=Loop / 2=Once
    beatMode:0,       // 0=Off (Write の設定で書く) / 1=A: Beat ごとに 1 筆 / 2=B: Beat ごとに 1 文字 / 3=C: Beat ごとに全文字列
    beatBar:4,        // beat モードで全部を書き切る拍数 (1/32〜32)。この長さごとに次のセットへ
    beatRate:1,       // 1 単位の拍数 (1/32〜32)。beat モードの A / B は Bar に収まらなければ詰める
    penTime:0.8,      // 1 単位のうち筆で書く割合 (0=一気に表示)
    beatHold:4,       // A / B: 全部出たあと止まる拍数
    writeBeats:24,    // 書き上げるまでの拍数
    holdBeats:24,     // 書いた後に止まる拍数
    setTrans:0,       // セットが変わるときの Transition の拍数 (0=Off)
    setTransStyle:-1, // Transition の演出 (-1=Mix の設定)
    exit:0,           // 消え方: 0=フェード (drone のみ) / 1=一気に消える / 2=1 筆・1 文字ずつ消える (Beat Write の A / B)
    fadeBeats:6,      // フェードの拍数
    ease:0,           // 1 画の速度カーブ。0=一定 / 1=加速 / 2=減速 / 3=加速→減速 / 4=減速→加速 (途中で溜める)
    easeAll:0,        // 文章全体の速度カーブ (同じ 5 種)
    easePow:2,        // カーブの強さ
    strokeGap:0.05,   // 画と画の間 (筆を運ぶ時間)
    speedVar:0,       // 画ごとの速さのばらつき
    // 動き
    flow:0,           // 毛の筋が線に沿って流れる
    boil:0,           // コマごとに毛を引き直す (手描きのガタつき)
    boilRate:8,       // 引き直しの回数 / 秒 (beat モードでは拍ごと)
    sway:0,           // 文字のゆれ
    pulse:0.25,       // 拍で筆が太る / 飛沫が跳ねる
    audio:1.0,        // 音の効き
    hold:0,           // 1=静止 (Phase の時刻で固定)
    phase:0,          // Hold 時の時刻 (秒)
    // 配置
    zoom:1,           // 拡大
    posX:0, posY:0,   // 位置 (-1..1)
    rotate:0,         // 回転 (°)
    slant:0,          // 傾き
    stretch:1,        // 縦の伸び
  },

  // いま使う色 {ink, ink2, paper}。ランダムは Seed で決まるので書体や単語と一緒に切り替わる
  _colors(){
    const P = this.P, mode = Math.round(P.colorMode || 0);
    if(!mode) return P;
    if(mode === 1) return FUDE_COLORS[Math.max(0, Math.min(FUDE_COLORS.length-1, Math.round(P.colorSet || 0)))];
    const seed = Math.round(P.seed || 0), key = mode + '|' + seed;
    if(this._colKey === key) return this._col;
    const r = this._rng(seed + 1201);
    if(mode === 2) this._col = FUDE_COLORS[Math.floor(r()*FUDE_COLORS.length)];
    else {
      // 明るい紙 + 濃い字 か、暗い紙 + 明るい字 のどちらか (明るさの差で読める状態を保つ)
      const hue = r(), lightPaper = r() < 0.5, pHue = r() < 0.5 ? hue : (hue + 0.5 + (r()-0.5)*0.3) % 1;
      const paper = lightPaper ? fudeHsl(pHue, 0.15 + r()*0.45, 0.84 + r()*0.1) : fudeHsl(pHue, 0.2 + r()*0.5, 0.05 + r()*0.08);
      const sat = 0.45 + r()*0.5;
      let lit = lightPaper ? 0.12 + r()*0.22 : 0.68 + r()*0.22, ink = fudeHsl(hue, sat, lit);
      // 黄色は同じ明度でも明るいので、実際のコントラストが 4.5 に届くまで字の明度を離す
      for(let i=0; i<12 && fudeContrast(ink, paper) < 4.5; i++){
        lit = lightPaper ? lit*0.82 : lit + (1 - lit)*0.25;
        ink = fudeHsl(hue, sat, lit);
      }
      this._col = { ink, ink2:ink.map((v, i)=> v*0.6 + paper[i]*0.4), paper };
    }
    this._colKey = key;
    return this._col;
  },

  // 速度カーブ: 頂点シェーダの ease() と同じ式
  _ease(t, type, p){
    if(t <= 0 || t >= 1 || !type) return t;
    if(type === 1) return Math.pow(t, p);
    if(type === 2) return 1 - Math.pow(1-t, p);
    if(type === 3) return t < 0.5 ? 0.5*Math.pow(2*t, p) : 1 - 0.5*Math.pow(2-2*t, p);
    return t < 0.5 ? 0.5*(1 - Math.pow(1-2*t, p)) : 0.5 + 0.5*Math.pow(2*t-1, p);
  },

  // ===== 書き順を先頭へ (C キー) =====
  restart(){ this._t0 = null; this._cycle = 0; this._beatBase = null; this.nextSet(); },
  // 次のセットへ: 文字列を選び直して Seed を引き直す
  nextSet(force){ this._pickText(); this.reseed(force); this._setChanged = true; },
  // 周回での切替: 直前の画面を残して Transition で次のセットへ混ぜる (C と読込は app.js 側で掛かる)
  _advance(){
    const P = this.P, beats = +P.setTrans || 0, style = Math.round(P.setTransStyle ?? -1);
    if(beats > 0 && typeof GL !== 'undefined' && GL.startPresetTrans){
      GL.startPresetTrans(beats, (style < 0 || style > 11) ? (App.transStyle || 0) : style);   // 無い番号は Mix の設定
      if(GL._presetTr) GL._presetTr.seed = 0.37;           // Glitch 系も毎回同じ動きにする (Style の指定どおりに見せる)
    }
    this.nextSet();
  },
  _pickText(){
    const mode = Math.round(this.P.textPick || 0);
    if(!mode){ this._curText = null; return; }
    const typed = String(this.P.words || '').split('\n').map(t=>t.trim()).filter(Boolean);
    const list = typed.length ? typed : FUDE_WORDS;
    let i;
    if(mode === 2) i = this._wordIdx = (this._wordIdx + 1) % list.length;
    else {
      i = Math.floor(Math.random()*list.length);
      if(list.length > 1 && list[i] === this._curRaw) i = (i + 1) % list.length;   // 同じ文字列を続けない
    }
    this._curRaw = list[i];
    this._curText = list[i].replace(/\s*\/\s*/g, '\n');
  },
  _text(){ return this._curText !== null ? this._curText : this.P.text; },
  // Seed を引き直す。force で固定中でも引く (New Seed ボタン)
  reseed(force){
    if(!force && Math.round(this.P.reseed || 0) !== 1) return;
    this.P.seed = Math.floor(Math.random()*10000);
    if(this._onSeed) this._onSeed();
  },

  // この端末で使えるフォントだけを返す。fam が無ければ両方のフォールバックと同じ絵になる
  // (fam 自身が serif 等の既定フォントのこともあるので、片方と同じなだけでは無いとは言えない)
  fontList(){
    if(this._fontList) return this._fontList;
    const ctx = this._ctx(), N = FUDE_CELL;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#000';
    const shot = ff=>{
      ctx.clearRect(0, 0, N, N);
      ctx.font = '40px ' + ff;
      ctx.fillText('永あ', 2, 50); ctx.fillText('Ag', 2, 110);
      const d = ctx.getImageData(0, 0, N, N).data;
      let h = 0;
      for(let i=3; i<d.length; i+=4) h = (h*31 + d[i]) | 0;
      return h;
    };
    const mono = shot('monospace'), serif = shot('serif');
    this._fontList = FUDE_FONTS.filter(f=> f.web || shot(f.fam+',monospace') !== mono || shot(f.fam+',serif') !== serif);
    return this._fontList;
  },
  applyStyle(i){
    const st = FUDE_STYLES[i];
    this.P.style = i;
    if(st && st.p) Object.assign(this.P, st.p);
  },

  // ===== グリフ → 骨格 =====
  _ctx(){
    if(this._cv) return this._cvx;
    this._cv = document.createElement('canvas');
    this._cv.width = this._cv.height = FUDE_CELL;
    this._cvx = this._cv.getContext('2d', { willReadFrequently:true });
    return this._cvx;
  },
  _fontStr(ff){
    return (Math.round(this.P.bold||0) === 1 ? 'bold ' : '') + FUDE_EM + 'px ' + (ff || this.P.fontFamily);
  },
  // 非同期に読まれるフォントが揃ったら作り直す
  _ensureFont(chars){
    if(!document.fonts || !document.fonts.load) return;
    const key = this._fontStr() + '|' + chars;
    if(this._fontWait[key]) return;
    this._fontWait[key] = 1;
    document.fonts.load(this._fontStr(), chars).then(()=>{ this._fontGen++; this._sig = ''; }).catch(()=>{});
  },
  // 1 文字の骨格。戻り値 {adv, strokes:[Float32Array x,y,r 繰り返し (em 単位、セル中心原点)]}
  _glyph(ch, ff, smooth){
    const P = this.P;
    const key = [this._fontGen, this._fontStr(ff), smooth, P.spur, P.merge, ch].join('|');
    let g = this._glyphs.get(key);
    if(g) return g;
    if(this._glyphs.size > 600) this._glyphs.clear();
    const ctx = this._ctx(), N = FUDE_CELL, em = FUDE_EM;
    ctx.clearRect(0, 0, N, N);
    ctx.font = this._fontStr(ff);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#000';
    ctx.fillText(ch, N/2, (N-em)/2 + em*0.88);
    const adv = Math.min(1.2, ctx.measureText(ch).width / em);
    const img = ctx.getImageData(0, 0, N, N).data;
    const bin = new Uint8Array(N*N);
    for(let i=0; i<N*N; i++) bin[i] = img[i*4+3] > 110 ? 1 : 0;
    g = { adv, strokes: this._trace(bin, this._distance(bin), smooth) };
    this._glyphs.set(key, g);
    return g;
  },
  // 距離変換 (3-4 チャンファー)。戻り値は px
  _distance(bin){
    const N = FUDE_CELL, d = new Float32Array(N*N);
    for(let i=0; i<N*N; i++) d[i] = bin[i] ? 1e6 : 0;
    for(let y=1; y<N-1; y++) for(let x=1; x<N-1; x++){
      const i = y*N+x; if(!d[i]) continue;
      d[i] = Math.min(d[i], d[i-1]+3, d[i-N]+3, d[i-N-1]+4, d[i-N+1]+4);
    }
    for(let y=N-2; y>0; y--) for(let x=N-2; x>0; x--){
      const i = y*N+x; if(!d[i]) continue;
      d[i] = Math.min(d[i], d[i+1]+3, d[i+N]+3, d[i+N+1]+4, d[i+N-1]+4);
    }
    for(let i=0; i<N*N; i++) d[i] /= 3;
    return d;
  },
  // Zhang-Suen 細線化 (bin を書き換える)
  _thin(bin){
    const N = FUDE_CELL;
    const del = [];
    for(let changed=true, it=0; changed && it<80; it++){
      changed = false;
      for(let pass=0; pass<2; pass++){
        del.length = 0;
        for(let y=1; y<N-1; y++) for(let x=1; x<N-1; x++){
          const i = y*N+x; if(!bin[i]) continue;
          const p2=bin[i-N], p3=bin[i-N+1], p4=bin[i+1], p5=bin[i+N+1], p6=bin[i+N], p7=bin[i+N-1], p8=bin[i-1], p9=bin[i-N-1];
          const B = p2+p3+p4+p5+p6+p7+p8+p9;
          if(B<2 || B>6) continue;
          const A = (!p2&&p3)+(!p3&&p4)+(!p4&&p5)+(!p5&&p6)+(!p6&&p7)+(!p7&&p8)+(!p8&&p9)+(!p9&&p2);
          if(A !== 1) continue;
          if(pass===0 ? (p2&&p4&&p6)||(p4&&p6&&p8) : (p2&&p4&&p8)||(p2&&p6&&p8)) continue;
          del.push(i);
        }
        if(del.length){ changed = true; for(const i of del) bin[i] = 0; }
      }
    }
  },
  // 骨格をグラフにして、ヒゲ刈り → 交点の接続 → 線の列にする
  _trace(bin, dist, smooth){
    const N = FUDE_CELL, em = FUDE_EM, P = this.P;
    this._thin(bin);
    const NB = [-N, -N+1, 1, N+1, N, N-1, -1, -N-1];      // 周回順の 8 近傍
    const crossing = i=>{ let c=0; for(let k=0;k<8;k++) if(!bin[i+NB[k]] && bin[i+NB[(k+1)%8]]) c++; return c; };
    // ノード: 端点 (crossing=1 かつ隣 1 個) / 交点 (crossing>=3)。隣接する交点画素は 1 ノードにまとめる
    const nodeOf = new Int32Array(N*N).fill(-1);
    const nodes = [];
    const pixels = [];
    for(let y=1; y<N-1; y++) for(let x=1; x<N-1; x++){ const i=y*N+x; if(bin[i]) pixels.push(i); }
    for(const i of pixels){
      if(nodeOf[i] >= 0) continue;
      const cn = crossing(i);
      if(cn === 2) continue;
      const id = nodes.length, stack = [i], list = [];
      nodeOf[i] = id;
      while(stack.length){
        const c = stack.pop(); list.push(c);
        if(cn < 3) continue;
        for(const o of NB){ const j=c+o; if(bin[j] && nodeOf[j]<0 && crossing(j)>=3){ nodeOf[j]=id; stack.push(j); } }
      }
      let sx=0, sy=0, r=0;
      for(const c of list){ sx += c%N; sy += Math.floor(c/N); r = Math.max(r, dist[c]); }
      nodes.push({ x:sx/list.length, y:sy/list.length, r, px:list, ends:[] });
    }
    // 辺: ノードから未訪問の画素を辿る
    const seen = new Uint8Array(N*N), edges = [];
    const walk = (start, first, a)=>{
      const pts = [];
      const add = i=>{ pts.push([i%N, Math.floor(i/N), dist[i]]); };
      if(a >= 0) pts.push([nodes[a].x, nodes[a].y, nodes[a].r]); else add(start);
      let cur = first, b = -1;
      for(;;){
        if(nodeOf[cur] >= 0){ b = nodeOf[cur]; break; }
        seen[cur] = 1; add(cur);
        let next = -1;
        for(const k of [0,2,4,6,1,3,5,7]){          // 上下左右を優先
          const j = cur + NB[k];
          if(bin[j] && !seen[j] && nodeOf[j] < 0){ next = j; break; }
        }
        if(next < 0){
          for(const o of NB){ const j=cur+o; if(bin[j] && nodeOf[j]>=0 && (nodeOf[j]!==a || pts.length>4)){ next=j; break; } }
          if(next < 0) break;
        }
        cur = next;
      }
      if(b >= 0) pts.push([nodes[b].x, nodes[b].y, nodes[b].r]);
      return { pts, a, b };
    };
    for(let a=0; a<nodes.length; a++){
      for(const c of nodes[a].px) for(const o of NB){
        const j = c+o;
        if(bin[j] && nodeOf[j]<0 && !seen[j]) edges.push(walk(c, j, a));
      }
    }
    for(const i of pixels){                           // ノードのない輪 (○ など)
      if(seen[i] || nodeOf[i]>=0) continue;
      const e = walk(i, i, -1);
      if(e.pts.length > 3){ e.pts.push(e.pts[0].slice()); e.closed = true; }
      edges.push(e);
    }
    const len = pts=>{ let l=0; for(let i=1;i<pts.length;i++) l += Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]); return l; };
    const degree = ()=>{ const d=new Int32Array(nodes.length); for(const e of edges){ if(e.a>=0) d[e.a]++; if(e.b>=0) d[e.b]++; } return d; };
    // ヒゲ刈り: 片方が行き止まりの短い辺を、つながっている先の太さを基準に落とす
    for(let pass=0; pass<3; pass++){
      const d = degree();
      for(let i=edges.length-1; i>=0; i--){
        const e = edges[i];
        if(e.a<0 || e.b<0) { if(e.a<0 && e.b<0) continue; }
        const aEnd = e.a>=0 && d[e.a]===1, bEnd = e.b<0 || d[e.b]===1;
        if(aEnd === bEnd) continue;
        const hub = nodes[aEnd ? e.b : e.a];
        if(hub && len(e.pts) < hub.r * P.spur + 2) edges.splice(i, 1);
      }
    }
    // 交点の接続: 各ノードで、まっすぐ続く端どうしを角度の良い順につなぐ
    const dirAt = (e, atStart, hub)=>{
      const pts = e.pts, n = pts.length, skip = Math.min(n-1, Math.max(2, Math.round(hub.r*0.9)));
      const far = Math.min(n-1, skip + 8);
      const p = atStart ? pts[skip] : pts[n-1-skip], q = atStart ? pts[far] : pts[n-1-far];
      const dx=q[0]-p[0], dy=q[1]-p[1], m=Math.hypot(dx,dy)||1;
      return [dx/m, dy/m];                            // ノードから外向き
    };
    const link = new Map();                           // 'edgeIndex:end' → 'edgeIndex:end'
    const cosMax = Math.cos((P.merge||0)*Math.PI/180);
    nodes.forEach((nd, id)=>{
      const ends = [];
      edges.forEach((e, ei)=>{
        if(e.a===id) ends.push({ei, end:0, d:dirAt(e,true,nd)});
        if(e.b===id) ends.push({ei, end:1, d:dirAt(e,false,nd)});
      });
      const pairs = [];
      for(let i=0;i<ends.length;i++) for(let j=i+1;j<ends.length;j++){
        if(ends[i].ei === ends[j].ei) continue;
        const c = -(ends[i].d[0]*ends[j].d[0] + ends[i].d[1]*ends[j].d[1]);
        if(c >= cosMax) pairs.push([c, ends[i], ends[j]]);
      }
      pairs.sort((p,q)=>q[0]-p[0]);
      const used = new Set();
      for(const [,u,v] of pairs){
        const ku=u.ei+':'+u.end, kv=v.ei+':'+v.end;
        if(used.has(ku) || used.has(kv)) continue;
        used.add(ku); used.add(kv); link.set(ku,kv); link.set(kv,ku);
      }
    });
    // つないだ端は交点付近の歪んだ画素を捨てる (骨格は交点で引き寄せられて曲がるため)
    const trim = (pts, atStart, r)=>{
      const cut = Math.min(Math.floor(pts.length/3), Math.round(r*0.9));
      return atStart ? pts.slice(cut) : pts.slice(0, pts.length-cut);
    };
    const used = new Uint8Array(edges.length), out = [];
    const startOf = i=>{                              // つながりの端から辿り始める
      for(const end of [0,1]) if(!link.has(i+':'+end)) return end;
      return 0;
    };
    edges.forEach((e0, i0)=>{
      if(used[i0]) return;
      let ei = i0, end = startOf(i0), chain = [];
      for(;;){
        used[ei] = 1;
        const e = edges[ei], fwd = end===0;
        let pts = fwd ? e.pts : e.pts.slice().reverse();
        const headLink = chain.length>0;
        const tailKey = ei+':'+(fwd?1:0), next = link.get(tailKey);
        const hub = nodes[fwd ? e.b : e.a];
        const headHub = nodes[fwd ? e.a : e.b];
        if(headLink && headHub) pts = trim(pts, true, headHub.r);
        if(next && hub) pts = trim(pts, false, hub.r);
        chain = chain.concat(pts);
        if(!next) break;
        const [nei, nend] = next.split(':').map(Number);
        if(used[nei]) break;
        ei = nei; end = nend;
      }
      if(chain.length >= 2) out.push(chain);
    });
    // どの辺にも属さない孤立点 (点・濁点など)
    nodes.forEach((nd, id)=>{
      if(edges.some(e=>e.a===id || e.b===id)) return;
      if(nd.r < 1) return;
      const h = Math.max(1.5, nd.r*0.6);
      out.push([[nd.x-h*0.5, nd.y-h, nd.r], [nd.x+h*0.5, nd.y+h, nd.r]]);
    });
    // 等間隔化 → 平滑化 → em 単位へ。向きを書き順に揃える
    const res = [];
    for(const chain of out){
      const closed = Math.hypot(chain[0][0]-chain[chain.length-1][0], chain[0][1]-chain[chain.length-1][1]) < 3 && chain.length>12;
      let pts = this._resample(chain, 2);
      if(pts.length < 2) continue;
      for(let pass=0; pass<smooth; pass++){
        const q = pts.map(p=>p.slice());
        for(let i=1; i<pts.length-1; i++) for(let c=0; c<3; c++) q[i][c] = (pts[i-1][c] + 2*pts[i][c] + pts[i+1][c]) / 4;
        pts = q;
      }
      const a = pts[0], b = pts[pts.length-1];
      const dx = b[0]-a[0], dy = b[1]-a[1];
      const flip = closed ? false : (Math.abs(dy) > Math.abs(dx)*0.6 ? dy<0 : dx<0);
      if(flip) pts.reverse();
      const f = new Float32Array(pts.length*3);
      pts.forEach((p,i)=>{ f[i*3]=(p[0]-N/2)/em; f[i*3+1]=(p[1]-N/2)/em; f[i*3+2]=p[2]/em; });
      res.push(f);
    }
    res.sort((u,v)=>(u[1]+u[0]*0.4) - (v[1]+v[0]*0.4));
    return res;
  },
  _resample(pts, step){
    const out = [pts[0].slice()];
    let carry = 0;
    for(let i=1; i<pts.length; i++){
      const a=pts[i-1], b=pts[i], l=Math.hypot(b[0]-a[0], b[1]-a[1]);
      if(l <= 0) continue;
      let t = (step - carry);
      while(t <= l){
        const f=t/l;
        out.push([a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f]);
        t += step;
      }
      carry = (carry + l) % step;
    }
    const e = pts[pts.length-1], k = out[out.length-1];
    if(Math.hypot(e[0]-k[0], e[1]-k[1]) > step*0.3) out.push(e.slice());
    return out;
  },

  // ===== 文字組 =====
  _layout(){
    const P = this.P;
    const lr = this._rng(Math.round(P.seed||0) + 331);    // 配置専用の乱数 (他の乱数の消費に影響されない)
    this._box = null;
    const pick = Math.round(P.layout||0), mode = pick >= 3 ? Math.floor(lr()*3) : pick, vertical = mode === 1;
    const track = +P.tracking||0, lead = 1 + (+P.leading||0);
    let wrap = Math.round(P.wrap||0), align = Math.round(P.align||0);
    let sMin = Math.max(0.05, +P.sizeMin||1), sMax = Math.max(0.05, +P.sizeMax||1), skew = Math.max(0.1, +P.sizeSkew||1);
    // 1 セットごとなら全文字が同じ値を引く
    const perSet = Math.round(P.layoutRand||0) === 1, setVals = [];
    const rr = i=>{ if(!perSet) return lr(); if(setVals[i] === undefined) setVals[i] = lr(); return setVals[i]; };
    let sizeEach = false;                                  // true なら Layout Rand に関わらず 1 文字ごとに大きさを引く
    const sizeOf = ()=> sMin + (sMax-sMin)*Math.pow(sizeEach ? lr() : rr(0), skew);
    let scatter = this._dz(P.scatter), shift = this._dz(P.shift), stagger = this._dz(P.stagger), stair = this._dz(P.stair);
    let rotMax = this._dz(P.scatterRot)*Math.PI/180;
    let aspRand = this._dz(P.aspectRand), slantMax = this._dz(P.slantRand);
    if(pick === 4){
      // セットごとに配置の値も引き直す。lr()*lr() で穏やかな値を多く、たまに大きく振る
      const n = mtGraphemes(String(this._text()||'').replace(/\s/g, '')).length;
      sMin = 0.5 + lr()*0.5; sMax = 1 + lr()*lr()*1.8; skew = 1 + lr()*2;
      scatter = lr()*lr()*0.6; shift = lr()*lr()*0.8; stagger = (lr()-0.5)*lr()*1.2; stair = (lr()-0.5)*lr()*0.2;
      rotMax = lr()*lr()*25*Math.PI/180;
      aspRand = lr()*lr()*0.7; slantMax = lr()*lr()*0.4;
      align = Math.floor(lr()*3);
      wrap = (n > 4 && lr() < 0.6) ? Math.ceil(Math.sqrt(n)*(0.8 + lr()*0.6)) : 0;
    }
    // ランダム配置: 7 割は大きさもばらけ、3 割は揃う。スライダーで幅を指定しているときはそちらを使う
    const composed = mode === 2 && Math.round(P.compose ?? 1) === 1;
    if(mode === 2 && !composed && (pick === 4 || sMin === sMax)){
      if(lr() < 0.7){
        sMin = 0.45 + lr()*0.35; sMax = 1.3 + lr()*1.4; skew = 1.5 + lr()*2; sizeEach = true;
      } else if(pick === 4){
        sMin = sMax = 1;
      }
    }
    // 改行 + 折り返し → 行ごとの文字
    let total = 0;
    const lines = [];
    for(const line of String(this._text()||'').split('\n')){
      let row = [];
      for(const ch of mtGraphemes(line)){
        if(total >= FUDE_MAX_CHARS) break;
        total++;
        row.push(ch);
        if(wrap > 0 && row.length >= wrap){ lines.push(row); row = []; }
      }
      if(row.length || !line.length) lines.push(row);   // 折り返しちょうどで終わった行の次に空行を作らない
    }
    const blank = ch=>/^\s+$/.test(ch);
    // 縦横比: 面積を保って横に ax 倍、縦に 1/ax 倍する (aspect は幅/高さなので平方根を取る)
    const aspectOf = ()=> Math.sqrt(Math.max(0.05, +P.aspect||1) * Math.exp((rr(5)-0.5)*2*aspRand*Math.log(3)));
    const pickV = this._variants();
    const glyph = ch=>{ const k = pickV(); return { g:this._glyph(ch, k.font, k.v.smooth), v:k.v }; };
    const cells = [];
    const finish = (c, along, across, i)=>{
      // along=組の方向 / across=直交の方向。ずらしは直交方向へ、位置のランダムは全方向へ
      const off = (rr(1)-0.5)*shift + (i%2 ? 0.5 : -0.5)*stagger + i*stair;
      const ax = along + (rr(2)-0.5)*scatter, ay = across + off + (rr(3)-0.5)*scatter;
      c.x = vertical ? -ay : ax;
      c.y = vertical ? ax : ay;
      c.rot = (rr(4)-0.5)*2*rotMax;
      c.sk = (rr(6)-0.5)*2*slantMax;
      cells.push(c);
    };
    if(composed){
      // 構成: ポスターの型に沿って文字を置く。座標は画面の高さ=1 で、大きい字は画面の外へ出てよい
      const list = lines.flat().filter(ch=>!blank(ch));
      if(!list.length) return cells;
      const A = Math.max(0.3, this._aspect || 16/9);
      const U = FUDE_POSTER_UNIT / Math.max(0.1, +P.area||1);
      this._box = [A*FUDE_POSTER_UNIT, FUDE_POSTER_UNIT, 1];
      this._poster(list.length, A, lr).forEach((slot, i)=>{
        const c = Object.assign(glyph(list[i]), { size:slot.s*U, ax:aspectOf()*slot.ax });
        finish(c, (slot.x - A/2)*U, (slot.y - 0.5)*U, i);
        c.rot += slot.rot;
      });
      return cells;
    }
    if(mode === 2){
      // 完全に乱数: 候補を複数引いて、既存の文字から一番遠い所へ置く (even=0 なら 1 候補 = 純粋な乱数)
      const chars = lines.flat().filter(ch=>!blank(ch)).map(ch=>Object.assign(glyph(ch), { size:sizeOf(), ax:aspectOf() }));
      const asp = Math.sqrt(Math.max(0.3, this._aspect || 16/9));
      const side = (Math.sqrt(chars.length)*1.3 + 0.9) * Math.max(0.1, +P.area||1);
      const W = side*asp, H = side/asp, tries = 1 + Math.round(this._dz(P.even)*24);
      this._box = [W, H, 0.92];                            // この範囲 = 画面の 92%。中心は 7 割強に置くので、大きい字だけ端で切れる
      chars.forEach((c, i)=>{
        let best = null, bestD = -1e9;
        for(let t=0; t<tries; t++){
          const x = (lr()-0.5)*W*0.72, y = (lr()-0.5)*H*0.72;
          let d = 1e9;
          for(const o of cells) d = Math.min(d, Math.hypot(x-o.x, y-o.y) - (c.size+o.size)*0.5);
          if(d > bestD){ bestD = d; best = [x, y]; }
        }
        finish(c, best[0], best[1], i);
      });
      return cells;
    }
    // 横組 / 縦組: 大きい字はそのぶん送りと行送りも広がる
    const rows = lines.map(row=>{
      const out = [];
      let pen = 0, big = 0;
      for(const ch of row){
        if(blank(ch)){ pen += 0.5 + track; continue; }
        const c = glyph(ch), size = sizeOf(), ax = aspectOf(), adv = (vertical ? 1/ax : c.g.adv*ax)*size;
        out.push(Object.assign(c, { size, ax, at:pen + adv/2 }));
        pen += adv + track;
        big = Math.max(big, size);
      }
      return { out, big:big || 1, len:Math.max(0, pen - track) };
    });
    const maxLine = Math.max(0, ...rows.map(r=>r.len));
    let across = 0;
    rows.forEach((r, li)=>{
      if(li) across += (rows[li-1].big + r.big)/2 * lead;
      const start = align===1 ? 0 : align===2 ? maxLine-r.len : (maxLine-r.len)/2;
      r.out.forEach((c, i)=> finish(c, start + c.at, across, i));
    });
    return cells;
  },
  // ポスターの型。画面の高さ=1 の座標で、読む順に置き場 [{x,y,s,ax}] を返す。
  //   大小の差を極端に付け、主役は画面の外へ出す。同じ型は続けない (同じ Seed の作り直しでは型を変えない)
  _poster(n, A, lr){
    const seed = Math.round(this.P.seed || 0);
    if(seed !== this._compSeed){
      // 全種類を一巡するまで同じ型を出さない (袋から引く。袋が空になったら詰め直す)
      if(!this._compBag.length){
        this._compBag = Array.from({ length:FUDE_POSTER_TYPES }, (_, i)=>i);
        for(let i=this._compBag.length-1; i>0; i--){
          const j = Math.floor(Math.random()*(i+1)), v = this._compBag[i];
          this._compBag[i] = this._compBag[j]; this._compBag[j] = v;
        }
        if(this._compBag[this._compBag.length-1] === this._compT) this._compBag.reverse();
      }
      this._compT = this._compBag.pop(); this._compSeed = seed;
    }
    const t = this._compT, out = [];
    const put = (x, y, s, ax = 1, rot = 0)=>{ out.push({ x, y, s, ax, rot }); };
    // 残りの文字を矩形へ、大きさ maxS までで詰める
    const fill = (from, x, y, w, h, maxS)=>{
      const m = n - from;
      if(m <= 0) return;
      const rows = Math.max(1, Math.round(Math.sqrt(m*h/w))), cols = Math.ceil(m/rows);
      const size = Math.min(w/cols, h/rows, maxS);
      for(let i=0; i<m; i++) put(x + (i%cols + 0.5)*size, y + (Math.floor(i/cols) + 0.5)*size, size*0.94);
    };
    const flipX = lr() < 0.5, flipY = lr() < 0.5;
    if(t === 7){
      // 行揃えブロック: 行ごとの字数を変え、どの行も幅いっぱいに。字数の少ない行ほど大きい
      const rows = Math.max(1, Math.min(n, 5, Math.round(Math.sqrt(n)*(0.6 + lr()*0.5))));
      const cnt = Array(rows).fill(1);
      for(let i=rows; i<n; i++) cnt[Math.floor(lr()*rows)]++;
      const inv = cnt.map(c=>1/c), sum = inv.reduce((a, b)=>a + b, 0);
      let y = -0.02, k = 0;
      cnt.forEach((c, r)=>{
        const h = inv[r]/sum*1.04, w = (A + 0.04)/c;
        for(let i=0; i<c; i++, k++) put(-0.02 + (i + 0.5)*w, y + h/2, Math.sqrt(w*h)*1.06, Math.max(0.5, Math.min(2, Math.sqrt(w/h))));
        y += h;
      });
    } else if(t === 8){
      // 軌道: 中央の巨大な字のまわりを小さな字が回る
      const big = n === 1 ? 1.3 : 0.95 + lr()*0.45, a0 = lr()*Math.PI*2, rest = n - 1;
      put(A*(0.42 + lr()*0.16), 0.5, big);
      const size = Math.min(0.26, 3.4/Math.max(1, rest)), rx = A*(0.38 + lr()*0.08), ry = 0.38 + lr()*0.08;
      for(let i=0; i<rest; i++){ const a = a0 + i/rest*Math.PI*2; put(A/2 + Math.cos(a)*rx, 0.5 + Math.sin(a)*ry, size); }
    } else if(t === 9){
      // 斜めの帯: 全体が傾いた行。両端は画面の外へ抜ける
      const ang = (flipX ? -1 : 1)*(0.2 + lr()*0.32);
      const per = Math.max(2, Math.min(n, Math.ceil(Math.sqrt(n*A*1.07)), Math.max(Math.ceil(A*1.3/(0.34 + lr()*0.3)), Math.ceil(Math.sqrt(n*A*1.07)))));
      const size = A*1.34/per, lines = Math.ceil(n/per), c = Math.cos(ang), sn = Math.sin(ang);
      for(let i=0; i<n; i++){
        const u = (i%per - (per-1)/2)*size, v = (Math.floor(i/per) - (lines-1)/2)*size*1.04;
        put(A/2 + u*c - v*sn, 0.5 + u*sn + v*c, size, 1, ang);
      }
    } else if(t === 10){
      // 重ね刷り: 巨大な字を少しずらして重ねる
      const big = 1.15 + lr()*0.35;
      put(A*(0.34 + lr()*0.1), 0.44 + lr()*0.1, big);
      if(n > 1) put(A*(0.58 + lr()*0.12), 0.54 + lr()*0.1, big*(0.8 + lr()*0.2));
      fill(2, A*0.05, 0.05, A*0.34, 0.26, 0.12);
    } else if(t === 11){
      // 隅の塊: 大小の字を隅に詰め、残りは全部余白にする
      const W = Math.min(A*0.96, A*(0.42 + lr()*0.2)*Math.max(1, Math.sqrt(n/14))), s0 = 0.46 + lr()*0.2;
      const floor = Math.min(0.07, Math.sqrt(W*0.9/n)*0.8);
      let x = 0.03, y = 0.03, rowH = 0;
      for(let i=0; i<n; i++){
        const size = Math.max(floor, s0*Math.pow(i + 1, -0.55));
        if(x + size > W && i){ x = 0.03; y += rowH*1.02; rowH = 0; }
        put(x + size/2, y + size/2, size*0.96);
        x += size*1.02; rowH = Math.max(rowH, size);
      }
    } else if(t === 12){
      // 放射: 画面の外の点から字が扇状に開く
      const cx = -A*0.04, cy = 1.06, arcs = Math.max(1, Math.round(Math.sqrt(n)*0.8));
      const reach = Math.hypot(A, 1)*(0.9 + lr()*0.12), weight = [];
      for(let k=0; k<arcs; k++) weight.push(k + 1);
      const sum = weight.reduce((a, b)=>a + b, 0);
      let i = 0;
      for(let k=0; k<arcs; k++){
        const m = k === arcs-1 ? n - i : Math.max(1, Math.round(n*weight[k]/sum));
        const r = reach*(k + 1)/arcs, size = Math.min(reach/arcs*0.82, r*1.4/Math.max(1, m));
        for(let j=0; j<m && i<n; j++, i++){
          const a = -Math.PI/2 + 0.12 + (Math.PI/2 - 0.24)*(j + 0.5)/m;
          put(cx + Math.cos(a)*r, cy + Math.sin(a)*r, size, 1, a + Math.PI/2);
        }
      }
    } else if(t === 13){
      // L 字: 上に大きな行、右に下がる列
      const k = Math.max(1, Math.ceil(n*(0.4 + lr()*0.3))), m = n - k;
      const size = Math.min(0.62, A*1.02/k);
      for(let i=0; i<k; i++) put((i + 0.5)*size - 0.01, size*0.5 + 0.01, size);
      const cs = m ? Math.min(size, (1 - size)/m) : 0;
      for(let i=0; i<m; i++) put(A - cs/2 - 0.02, size + (i + 0.5)*cs + 0.02, cs);
    } else if(t === 14){
      // 幅違いの段組: 列ごとに字の大きさが違う
      const cols = Math.max(2, Math.min(n, 3 + Math.floor(lr()*3) + Math.floor(Math.sqrt(n)*0.5))), w = [];
      for(let i=0; i<cols; i++) w.push(Math.pow(0.55 + lr()*0.2, i));
      const sum = w.reduce((a, b)=>a + b, 0);
      let x = 0, left = n;
      w.forEach((wi, c)=>{
        const size = wi/sum*A, room = c === cols-1 ? left : Math.max(1, Math.min(left - (cols-c-1), Math.ceil(1.15/size)));
        const y0 = (lr() - 0.5)*size*0.6;
        for(let i=0; i<room; i++) put(x + size/2, y0 + (i + 0.5)*size, size*0.98);
        left -= room; x += size;
      });
    } else if(t === 15){
      // 左右二分割: 片側に断ち切りの主役、反対側に字を詰める
      put(A*(0.2 + lr()*0.08), 0.5 + (lr()-0.5)*0.2, 1.3 + lr()*0.4);
      fill(1, A*0.54, 0.06, A*0.42, 0.88, 0.34);
    } else if(t === 0){
      // 巨大な 1 字 + 小さなキャプション
      const big = n === 1 ? 1.25 : 1.2 + lr()*0.8;
      put(n === 1 ? A*0.5 : A*(0.52 + lr()*0.3), n === 1 ? 0.5 : 0.42 + lr()*0.36, big);
      fill(1, A*0.05, 0.07, A*(0.24 + lr()*0.14), 0.3 + lr()*0.3, 0.17);
    } else if(t === 1){
      // 黄金分割: 正方形を渦状に切り取り、字を大きい順に置く。残りは最後の矩形へ詰める
      let x = 0, y = 0, w = A, h = 1;
      for(let i=0, side=0; i<n; i++){
        if(i === n-1){ put(x + w/2, y + h/2, Math.sqrt(w*h)*1.08, Math.max(0.6, Math.min(1.7, Math.sqrt(w/h)))); break; }
        if(i >= (n > 10 ? 2 : 5)){ fill(i, x, y, w, h, 1); break; }
        const c = Math.min(w, h);
        if(w >= h){
          if(side%2 === 0){ put(x + c/2, y + c/2, c*1.06); x += c; } else { put(x + w - c/2, y + c/2, c*1.06); }
          w -= c;
        } else {
          if(side%2 === 0){ put(x + c/2, y + c/2, c*1.06); y += c; } else { put(x + c/2, y + h - c/2, c*1.06); }
          h -= c;
        }
        side++;
      }
    } else if(t === 2){
      // ブロック分割: 画面全体を分割して字を変形して埋める
      const split = (from, to, x, y, w, h)=>{
        const c = to - from;
        if(c === 1){ put(x + w/2, y + h/2, Math.sqrt(w*h)*1.08, Math.max(0.55, Math.min(1.9, Math.sqrt(w/h)))); return; }
        const k = Math.max(1, Math.min(c-1, Math.round(c*(0.32 + lr()*0.36))));
        const f = (k/c)*(0.75 + lr()*0.5), r = Math.max(0.2, Math.min(0.8, f));
        if(w/h > 1.1) { split(from, from+k, x, y, w*r, h); split(from+k, to, x + w*r, y, w*(1-r), h); }
        else { split(from, from+k, x, y, w, h*r); split(from+k, to, x, y + h*r, w, h*(1-r)); }
      };
      split(0, n, -0.02, -0.02, A + 0.04, 1.04);
    } else if(t === 3){
      // 縦の巨大列: 上下が切れる縦組。右の列から読み、反対側に余白を残す
      const cols = n <= 3 ? n : Math.ceil(Math.sqrt(n*0.45)), k = Math.ceil(n/cols);
      const size = Math.min((1.02 + lr()*0.3)/k, A*0.84/cols), step = (0.05 + lr()*0.2)*size;
      for(let i=0; i<n; i++){
        const j = Math.floor(i/k), r = i%k;
        put(A*0.97 - (j + 0.5)*size*1.02, (r + 0.5)*size - 0.07 + (j%2 ? step : 0), size);
      }
    } else if(t === 4){
      // 対角の大小: 巨大な字から極小の字へ流れる
      let s0 = n === 1 ? 1.2 : 1.45;
      const sEnd = Math.max(0.07, 0.3/Math.sqrt(n)), r = n > 1 ? Math.pow(sEnd/s0, 1/(n-1)) : 1;
      const dx = A*(0.6 + lr()*0.3), dy = 0.5 + lr()*0.4, m = Math.hypot(dx, dy);
      let total = 0;                                       // 字の列の全長が道に収まるよう全体を縮める
      for(let i=0, z=1; i<n-1; i++, z*=r) total += z*(1 + r)*0.43;
      if(n > 1) s0 = Math.min(s0, m*1.12/total);
      let x = A*(0.1 + lr()*0.12), y = 0.1 + lr()*0.12, size = s0;
      for(let i=0; i<n; i++){
        put(x, y, size);
        const next = size*r, step = (size + next)*0.43;
        x += dx/m*step; y += dy/m*step; size = next;
      }
    } else if(t === 5){
      // 巨大な帯: 字が左右と下へはみ出す。残りは上に小さく
      const g = Math.min(n, n <= 4 ? n : 3), size = Math.min(1.35, A*1.14/g);
      const band = 0.8 + lr()*0.24 - size*0.42;
      for(let i=0; i<g; i++) put(A/2 + (i - (g-1)/2)*size*0.98, band, size);
      fill(g, A*0.05, 0.06, A*0.9, Math.max(0.1, 0.56 - size*0.5), 0.13);
    } else {
      // 見出し + 本文: 幅いっぱいの見出しと細かい字
      const head = Math.max(1, Math.min(6, Math.ceil(n*0.5))), size = Math.min(n > head ? 0.66 : 1, A*1.04/head);
      const top = 0.08 + size*0.5;
      for(let i=0; i<head; i++) put(A/2 + (i - (head-1)/2)*size, top, size);
      fill(head, A*0.05, top + size*0.62, A*0.9, Math.max(0.08, 0.94 - top - size*0.62), 0.12);
    }
    // 反転: 行が読める向きを保てる型だけ左右に。上下はほとんどの型で許す
    const canX = [0, 1, 2, 3, 4, 8, 10, 11, 12, 14, 15].includes(t), canY = t !== 9 && t !== 3;
    if(canX && flipX) for(const o of out){ o.x = A - o.x; o.rot = -o.rot; }
    if(canY && flipY) for(const o of out){ o.y = 1 - o.y; o.rot = -o.rot; }
    // 3 割は全体を少し傾け、大きくして角度を付ける (傾いた分は画面の外へ抜ける)
    if(lr() < 0.3 && t !== 9 && t !== 12){
      const a = (lr() < 0.5 ? -1 : 1)*(0.06 + lr()*0.16), z = 1.1 + lr()*0.2, c = Math.cos(a), sn = Math.sin(a);
      for(const o of out){
        const u = (o.x - A/2)*z, v = (o.y - 0.5)*z;
        o.x = A/2 + u*c - v*sn; o.y = 0.5 + u*sn + v*c; o.s *= z; o.rot += a;
      }
    }
    // どの字も 3 割は画面に残す (断ち切りはいいが、字が丸ごと消えると読めない)
    for(const o of out){
      const m = o.s*0.2;
      o.x = Math.max(-m, Math.min(A + m, o.x));
      o.y = Math.max(-m, Math.min(1 + m, o.y));
    }
    return out;
  },
  // 筆の組 (書体 + 揺らし) を作り、1 文字ぶんの組とフォントを返す関数を返す
  _variants(){
    const P = this.P, seed = Math.round(P.seed||0);
    const vr = this._rng(seed + 613), cr = this._rng(seed + 877);
    const sm = Math.round(P.styleRand||0), bm = Math.round(P.brushRand||0), fm = Math.round(P.fontRand||0);
    const amt = this._dz(P.brushAmt);
    const pickStyle = ()=> FUDE_STYLES[1 + Math.floor(vr()*(FUDE_STYLES.length-1))].p;
    const pickMul = ()=>{
      const m = {};
      for(const k of FUDE_BRUSH_KEYS) m[k] = 1 + (vr()-0.5)*2*amt;
      m.nibOff = (vr()-0.5)*120*amt;
      return m;
    };
    const setStyle = sm === 2 ? pickStyle() : null, setMul = bm === 2 ? pickMul() : null;
    const n = (sm === 1 || bm === 1) ? FUDE_VARIANTS : 1;
    const table = [];
    for(let i=0; i<n; i++){
      const v = { id:i, st: sm === 1 ? pickStyle() : setStyle, mul: bm === 1 ? pickMul() : setMul };
      v.smooth = Math.round(this._val(v, 'smooth'));
      table.push(v);
    }
    this._vt = table;
    const fonts = this.fontList();
    const anyFont = ()=> fonts[Math.floor(cr()*fonts.length)].ff;
    const setFont = fm === 2 ? anyFont() : P.fontFamily;
    return ()=>({ v:table[Math.floor(cr()*n)], font: fm === 1 ? anyFont() : setFont });
  },
  // その組での値: 書体の値 (無ければ P) × 揺らし
  _val(v, k){
    const b = (v.st && v.st[k] !== undefined) ? v.st[k] : this.P[k];
    return (v.mul && v.mul[k] !== undefined) ? b*v.mul[k] : b;
  },

  // ===== 幾何の組み立て =====
  _rng(seed){ let s = (seed|0) * 2654435761 >>> 0 || 1; return ()=>{ s ^= s<<13; s>>>=0; s ^= s>>>17; s ^= s<<5; s>>>=0; return s/4294967296; }; },
  _strokeShape(src, rnd, vt){
    let pts = [];
    for(let i=0; i<src.length; i+=3) pts.push([src[i], src[i+1], src[i+2]]);
    const n = pts.length;
    const k = Math.min(n-1, 6);
    const dx = pts[n-1][0]-pts[n-1-k][0], dy = pts[n-1][1]-pts[n-1-k][1], m = Math.hypot(dx,dy)||1;
    const tx = dx/m, ty = dy/m;
    let total = 0;
    for(let i=1;i<n;i++) total += Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]);
    // 終わり方: 斜めに下がる線はほぼ「はらい」。真下の線は「はね」か「針」か「止め」
    const diag = Math.min(Math.abs(tx), ty);
    const sm = x=>{ x=Math.max(0,Math.min(1,x)); return x*x*(3-2*x); };
    let kind = sm((diag-0.2)/0.3);
    const r0 = rnd(), r1 = rnd(), r2 = rnd();
    const v = this._vary();
    const step = 2/FUDE_EM, rEnd = pts[n-1][2];
    const hataku = this._dz(this._val(vt, 'hataku')), haraiLen = +this._val(vt, 'haraiLen') || 0;
    if(hataku > 0 && Math.abs(ty) < 0.35 && tx > 0.8 && total > 0.28){
      // 波磔: 終わりでいったん沈み、右上へ跳ね上げて抜く
      const L = 0.13 * hataku * (1 + (r2-0.5)*0.8*v);
      let x=pts[n-1][0], y=pts[n-1][1], ang=Math.atan2(ty,tx) + 0.25;
      for(let d=step; d<L; d+=step){
        ang -= step/L*0.95;
        x += Math.cos(ang)*step; y += Math.sin(ang)*step;
        pts.push([x,y,rEnd]);
      }
      kind = Math.max(kind, 0.85);
    } else if(kind > 0.3 && haraiLen > 0){
      // 進行方向へ、少し外へ開きながら延ばす
      const L = 0.12 * haraiLen * kind * (1 + (r2-0.5)*1.2*v);
      const bend = (tx>0 ? 1 : -1) * 0.25;
      let x=pts[n-1][0], y=pts[n-1][1], vx=tx, vy=ty;
      for(let d=step; d<L; d+=step){
        const c=Math.cos(-bend*step*8), s=Math.sin(-bend*step*8);
        const nx=vx*c-vy*s, ny=vx*s+vy*c; vx=nx; vy=ny;
        x+=vx*step; y+=vy*step; pts.push([x,y,rEnd]);
      }
    } else if(ty > 0.85 && total > 0.22 && r0 < (+this._val(vt, 'hane')||0)){
      // はね: 下へ来て左上へ小さく返す
      const R = 0.045, arc = 2.1;
      let x=pts[n-1][0], y=pts[n-1][1], ang=Math.atan2(ty,tx);
      for(let d=step; d<R*arc; d+=step){
        ang += step/R;
        x += Math.cos(ang)*step; y += Math.sin(ang)*step;
        pts.push([x,y,rEnd]);
      }
      kind = 1;
    } else if(ty > 0.85 && r1 < 0.35){
      kind = 0.8;                                     // 懸針 (そのまま細く抜く)
    }
    return { pts, kind };
  },
  _dz(v){ v = +v || 0; return (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v; },
  _vary(){ return this._dz(this.P.vary); },
  // 連綿: 終点から次の始点へ、それぞれの向きを保った曲線でつなぐ。p[3] はその点の太さの倍率
  _linkBridge(a, b, thinV){
    const na = a.length, ax = a[na-1][0], ay = a[na-1][1], bx = b[0][0], by = b[0][1];
    const d = Math.hypot(bx-ax, by-ay), k = Math.min(na-1, 5), j = Math.min(b.length-1, 5);
    const am = Math.hypot(ax-a[na-1-k][0], ay-a[na-1-k][1])||1, bm = Math.hypot(b[j][0]-bx, b[j][1]-by)||1;
    const c1x = ax + (ax-a[na-1-k][0])/am*d*0.5, c1y = ay + (ay-a[na-1-k][1])/am*d*0.5;
    const c2x = bx - (b[j][0]-bx)/bm*d*0.5, c2y = by - (b[j][1]-by)/bm*d*0.5;
    const thin = Math.max(0.05, +thinV || 0), m = Math.max(4, Math.ceil(d*1.5/(2/FUDE_EM)));
    const out = [];
    for(let i=1; i<m; i++){
      const t = i/m, u = 1-t;
      out.push([ u*u*u*ax + 3*u*u*t*c1x + 3*u*t*t*c2x + t*t*t*bx,
                 u*u*u*ay + 3*u*u*t*c1y + 3*u*t*t*c2y + t*t*t*by,
                 Math.min(a[na-1][2], b[0][2]),
                 1 - (1-thin)*Math.pow(Math.sin(Math.PI*t), 0.6) ]);
    }
    return out;
  },
  // 1 画の位置・傾き・長さ・反りを Seed でずらす (書くたびに字形が変わる)
  _strokeJitter(pts, rnd){
    const v = this._vary();
    const n = pts.length, cx = (pts[0][0]+pts[n-1][0])/2, cy = (pts[0][1]+pts[n-1][1])/2;
    const a = (rnd()-0.5)*0.2*v, sc = 1 + (rnd()-0.5)*0.26*v;
    const ox = (rnd()-0.5)*0.05*v, oy = (rnd()-0.5)*0.05*v, bend = (rnd()-0.5)*0.09*v;
    const c = Math.cos(a), s = Math.sin(a);
    const dx = pts[n-1][0]-pts[0][0], dy = pts[n-1][1]-pts[0][1], m = Math.hypot(dx,dy)||1;
    pts.forEach((p,i)=>{
      const x = (p[0]-cx)*sc, y = (p[1]-cy)*sc, b = Math.sin(Math.PI*i/Math.max(1,n-1))*bend;
      p[0] = cx + x*c - y*s + ox - dy/m*b;
      p[1] = cy + x*s + y*c + oy + dx/m*b;
    });
  },
  _build(){
    const gl = this.gl, P = this.P;
    const seed = Math.round(P.seed||0);
    const rnd = this._rng(seed + 11);
    const cells = this._layout();
    const strokes = [];
    let nChar = 0;
    let minX=1e9, minY=1e9, maxX=-1e9, maxY=-1e9;
    cells.forEach((c, ci)=>{
      const crand = rnd();
      // 1 文字全体のずれ (傾き・基線・大きさ)
      const v = this._vary(), ca = (rnd()-0.5)*0.18*v + c.rot, cs = (1 + (rnd()-0.5)*0.16*v)*c.size;
      const sy = (+this._val(c.v, 'stretch')||1) / Math.max(0.05, +P.stretch||1);   // 書体ごとの縦横比
      const cox = (rnd()-0.5)*0.08*v, coy = (rnd()-0.5)*0.08*v, cc = Math.cos(ca), ss = Math.sin(ca);
      const inChar = [];
      c.g.strokes.forEach(src=>{
        const sh = this._strokeShape(src, rnd, c.v);
        this._strokeJitter(sh.pts, rnd);
        const wm = (1 + (rnd()-0.5)*0.9*v)*c.size, dm = 1 + (rnd()-0.5)*1.4*v, tm = (1 + (rnd()-0.5)*1.6*v)*c.size;
        for(const p of sh.pts){
          const y = p[1]*cs*sy/c.ax, x = p[0]*cs*c.ax - y*c.sk;
          p[0] = c.x + x*cc - y*ss + cox; p[1] = c.y + x*ss + y*cc + coy;
          minX=Math.min(minX,p[0]); maxX=Math.max(maxX,p[0]); minY=Math.min(minY,p[1]); maxY=Math.max(maxY,p[1]);
        }
        inChar.push({ pts:sh.pts, kind:sh.kind, cx:c.x, cy:c.y, crand, rand:rnd(), wm, dm, tm, vid:c.v.id, ci:nChar });
      });
      // 連綿: 近い次の画へ、確率でつなげて 1 本にする
      const link = this._dz(this._val(c.v, 'link'));
      let cur = inChar[0];
      for(let i=1; i<inChar.length; i++){
        const nx = inChar[i], e = cur.pts[cur.pts.length-1];
        const roll = rnd();
        if(roll < link && Math.hypot(nx.pts[0][0]-e[0], nx.pts[0][1]-e[1]) < 0.6){
          cur.pts = cur.pts.concat(this._linkBridge(cur.pts, nx.pts, this._val(c.v, 'linkThin')), nx.pts);
          cur.kind = nx.kind;
        } else { strokes.push(cur); cur = nx; }
      }
      if(cur){ strokes.push(cur); nChar++; }
    });
    this._nUnits = [strokes.length, nChar];
    if(!strokes.length){ this.indexCount = 0; this.splatCount = 0; return; }
    const box = this._box;
    const ox = box ? 0 : (minX+maxX)/2, oy = box ? 0 : (minY+maxY)/2;
    // fit は bbox を画面の 84% に収める。ランダム配置は範囲の box[2] 倍が画面になるようにする
    const m = box ? 0.84/box[2] : 1;
    this._bbox = box ? [box[0]*m, box[1]*m] : [Math.max(0.6, maxX-minX), Math.max(0.6, maxY-minY)];

    // 書き順の時間: 長さに比例 + 画の間に筆を運ぶ間
    const tr = this._rng(seed + 449);
    let tAcc = 0;
    for(const s of strokes){
      let L = 0;
      for(let i=1;i<s.pts.length;i++) L += Math.hypot(s.pts[i][0]-s.pts[i-1][0], s.pts[i][1]-s.pts[i-1][1]);
      const vt = this._vt[s.vid];                         // 間と速さは書体ごと
      const gap = Math.max(0, +this._val(vt, 'strokeGap') || 0);
      const dur = L * (1 + (tr()-0.5)*1.8*this._dz(this._val(vt, 'speedVar')));   // 速い画は短く、遅い画は長く
      s.len = L; s.t0 = tAcc; s.t1 = tAcc + dur; tAcc = s.t1 + gap;
    }
    // 1 文字の中での書き順の時間 (Beat Write の B を筆で書くとき)
    const cRange = [];
    for(const s of strokes){
      const r = cRange[s.ci] || (cRange[s.ci] = [s.t0, s.t1]);
      r[0] = Math.min(r[0], s.t0); r[1] = Math.max(r[1], s.t1);
    }
    for(const s of strokes){
      const r = cRange[s.ci], d = Math.max(r[1]-r[0], 1e-5);
      s.g0 = (s.t0-r[0])/d; s.g1 = (s.t1-r[0])/d;
    }
    const FLOATS = 25;
    let nv = 0, ni = 0;
    for(const s of strokes){ const m=s.pts.length + 2; nv += m*2; ni += (m-1)*6; }
    const V = new Float32Array(nv*FLOATS), I = new Uint32Array(ni);
    let vi = 0, ii = 0, base = 0;
    strokes.forEach((s, idx)=>{
      const pts = s.pts, n = pts.length;
      // 接線
      const tan = new Float32Array(n*2);
      for(let i=0;i<n;i++){
        const a=pts[Math.max(0,i-2)], b=pts[Math.min(n-1,i+2)];
        const dx=b[0]-a[0], dy=b[1]-a[1], m=Math.hypot(dx,dy)||1;
        tan[i*2]=dx/m; tan[i*2+1]=dy/m;
      }
      // 曲率 (0..1 に丸めて、なだらかにする)
      let curv = new Float32Array(n);
      for(let i=1;i<n-1;i++){
        const c = tan[(i-1)*2]*tan[(i+1)*2] + tan[(i-1)*2+1]*tan[(i+1)*2+1];
        const ang = Math.acos(Math.max(-1,Math.min(1,c)));
        curv[i] = Math.min(1, ang/(2*2/FUDE_EM) / 22);
      }
      for(let pass=0; pass<4; pass++){
        const q = curv.slice();
        for(let i=1;i<n-1;i++) q[i] = (curv[i-1]+2*curv[i]+curv[i+1])/4;
        curv = q;
      }
      const put = (i, cap, sv)=>{
        const p = pts[i];
        for(const side of [-1,1]){
          V[vi++]=p[0]-ox; V[vi++]=p[1]-oy;
          V[vi++]=tan[i*2]; V[vi++]=tan[i*2+1];
          V[vi++]=side; V[vi++]=sv; V[vi++]=s.len; V[vi++]=p[2];
          V[vi++]=s.rand; V[vi++]=s.t0/tAcc; V[vi++]=s.t1/tAcc; V[vi++]=idx;
          V[vi++]=curv[i]; V[vi++]=s.kind; V[vi++]=cap;
          V[vi++]=s.cx-ox; V[vi++]=s.cy-oy; V[vi++]=s.crand;
          V[vi++]=s.wm*(p[3]===undefined ? 1 : p[3]); V[vi++]=s.dm; V[vi++]=s.tm; V[vi++]=s.vid; V[vi++]=s.ci; V[vi++]=s.g0; V[vi++]=s.g1;
        }
      };
      put(0, -1, 0);
      let acc = 0;
      for(let i=0;i<n;i++){
        if(i>0) acc += Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]);
        put(i, 0, acc);
      }
      put(n-1, 1, s.len);
      const m = n + 2;
      for(let i=0;i<m-1;i++){
        const a=base+i*2;
        I[ii++]=a; I[ii++]=a+1; I[ii++]=a+2; I[ii++]=a+1; I[ii++]=a+3; I[ii++]=a+2;
      }
      base += m*2;
    });
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, V, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
    this.indexCount = ii;

    // 飛沫: 線の終わり近くに多く、線の進行方向へ飛ぶ
    const S = new Float32Array(FUDE_MAX_SPLATS*12);
    const sr = this._rng(seed + 977);
    for(let i=0; i<FUDE_MAX_SPLATS; i++){
      const si = Math.floor(sr()*strokes.length), s = strokes[si];
      const n = s.pts.length;
      const u = Math.pow(sr(), 0.4);
      const j = Math.min(n-1, Math.floor(u*(n-1)));
      const a = s.pts[Math.max(0,j-2)], b = s.pts[j];
      const dx=b[0]-a[0], dy=b[1]-a[1], m=Math.hypot(dx,dy)||1;
      const fw = sr()*sr()*0.5, side = (sr()-0.5)*0.25*(1-fw);
      const o = i*12;
      S[o]=b[0]-ox; S[o+1]=b[1]-oy;
      S[o+2]=dx/m*fw - dy/m*side; S[o+3]=dy/m*fw + dx/m*side;
      S[o+4]=0.004 + 0.022*Math.pow(sr(),3);
      S[o+5]=(s.t0 + (s.t1-s.t0)*u)/tAcc;
      S[o+6]=sr();
      S[o+7]=s.cx-ox; S[o+8]=s.cy-oy; S[o+9]=s.crand;
      S[o+10]=si; S[o+11]=s.ci;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.splatVBO);
    gl.bufferData(gl.ARRAY_BUFFER, S, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.splatCount = FUDE_MAX_SPLATS;
  },

  // ===== init =====
  init(gl){
    if(this.initialized) return;
    this.gl = gl;
    this.startTime = performance.now()/1000;

    const NOISE = `
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y);
}`;
    const PLACE = `
uniform vec2  uRes, uPos;
uniform float uFit, uZoom, uRot, uSlant, uStretch, uSway, uTime;
mat2 rot2(float a){ float c=cos(a), s=sin(a); return mat2(c, s, -s, c); }
vec4 place(vec2 p, vec3 ch){
  float cr = ch.z;
  float a  = uSway*0.12*sin(uTime*0.35 + cr*40.0);
  vec2 off = uSway*0.05*vec2(sin(uTime*0.27 + cr*17.0), cos(uTime*0.31 + cr*29.0));
  vec2 q = rot2(a)*(p-ch.xy) + ch.xy + off;
  q.x -= q.y*uSlant;
  q.y *= uStretch;
  q = rot2(uRot)*q;
  vec2 px = q*uFit*uZoom + vec2(uPos.x, -uPos.y)*uRes*0.5;
  return vec4(px/(uRes*0.5)*vec2(1.0, -1.0), 0.0, 1.0);
}`;

    const strokeVS = `#version 300 es
precision highp float;
in vec2 aPos;
in vec2 aTan;
in vec4 aA;      // side, s, len, r
in vec4 aB;      // rand, t0, t1, idx
in vec3 aC;      // curv, endKind, cap
in vec3 aD;      // charX, charY, charRand
in vec4 aE;      // 1 画の個性: 太さ, かすれ, テーパーの長さ (倍率), 筆の組の番号
in float aF;     // 文字の番号
in vec2 aG;      // 1 文字の中での書き順の時間 (0..1)
uniform vec4  uVT[${FUDE_VARIANTS*5}];     // 筆の組 × 5 vec4
uniform float uW0, uPressF, uWobbleF, uBreath, uReveal, uShown, uFrac, uGone;
uniform int   uUnit;
out float vS, vLen, vV, vW, vRand, vKind, vCurv, vIdx, vSLim, vDry, vGone, vSize;
flat out int vId;
vec4 T0, T1, T2, T3, T4;
#define uFontW    T0.x
#define uNib      T0.y
#define uNibAng   T0.z
#define uPress    T0.w
#define uEntry    T1.x
#define uTaperIn  T1.y
#define uTaperOut T1.z
#define uTaperPow T1.w
#define uHarai    T2.x
#define uTome     T2.y
#define uCorner   T2.z
#define uWobble   T2.w
#define uRough    T3.y
#define uSplay    T3.z
${NOISE}
${PLACE}
float ease(float t){
  int   type = int(T4.x + 0.5);
  float p = T4.y;
  if(type == 1) return pow(t, p);
  if(type == 2) return 1.0 - pow(1.0-t, p);
  if(type == 3) return t < 0.5 ? 0.5*pow(2.0*t, p) : 1.0 - 0.5*pow(2.0-2.0*t, p);
  if(type == 4) return t < 0.5 ? 0.5*(1.0 - pow(1.0-2.0*t, p)) : 0.5 + 0.5*pow(2.0*t-1.0, p);
  return t;
}
void main(){
  vId = int(aE.w + 0.5);
  T0 = uVT[vId*5]; T1 = uVT[vId*5+1]; T2 = uVT[vId*5+2]; T3 = uVT[vId*5+3]; T4 = uVT[vId*5+4];
  float side = aA.x, s = aA.y, len = aA.z, r = aA.w;
  float rnd = aB.x, kind = aC.y, curv = aC.x, cap = aC.z;
  float W = uW0 * T3.x * aE.x * mix(1.0, clamp(r/0.035, 0.3, 3.0), uFontW);
  float ang = atan(aTan.y, aTan.x);
  W *= mix(1.0, 0.25 + 1.5*abs(sin(ang - uNibAng)), uNib);
  float sN = s/max(aE.z, 0.05);      // 字の大きさで割った距離 (大きい字でもゆらぎの見え方を変えない)
  W *= 1.0 + uPress*(vn(vec2(sN*uPressF + rnd*91.0, rnd*7.0)) - 0.5)*1.4;
  // 打ち込み
  float e = sN/(uW0*2.2);
  W *= 1.0 + uEntry*exp(-e*e);
  // 書き出しの細り
  float tIn = uTaperIn*uW0*aE.z;
  if(tIn > 1e-4) W *= 0.35 + 0.65*smoothstep(0.0, min(tIn, len*0.5), s);
  // はらい / 止め
  float rem = max(0.0, len - s);
  float h = kind*uHarai;
  float tOut = min(uTaperOut*uW0*aE.z*(1.0 + 2.0*h), len*0.85);
  W *= mix(1.0, pow(clamp(rem/max(tOut,1e-4), 0.0, 1.0), uTaperPow), h);
  float q = rem/(uW0*2.0*max(aE.z, 0.05));
  W *= 1.0 + uTome*(1.0-h)*exp(-q*q);
  W *= 1.0 + uCorner*curv;
  W *= 1.0 + uBreath;
  W = max(W, 0.0025);

  float ext = 1.2 + 0.6*uRough + 0.8*uSplay;
  vec2 nrm = vec2(-aTan.y, aTan.x);
  vec2 p = aPos + nrm*(vn(vec2(sN*uWobbleF + rnd*37.0, rnd*3.0)) - 0.5)*uWobble*0.03*aE.z;
  p += nrm*side*W*ext + aTan*cap*W*ext;

  float rev = (uReveal - aB.y)/max(aB.z - aB.y, 1e-5);
  if(uUnit > 0){
    // uShown 個目の単位を uFrac まで書く。手前は全部、先はまだ出さない
    float d = (uUnit == 1 ? aB.w : aF) - (uShown - 1.0);
    rev = d < -0.5 ? 2.0 : d > 0.5 ? -1.0 : uUnit == 1 ? uFrac : (uFrac - aG.x)/max(aG.y - aG.x, 1e-5);
  }
  vSLim = rev >= 1.0 ? 1e6 : ease(max(rev, 0.0))*len;
  vS = s + cap*W*ext; vLen = len; vV = side*W*ext; vW = W;
  vRand = rnd; vKind = kind; vCurv = curv; vIdx = aB.w; vDry = aE.y; vSize = max(aE.z, 0.05);
  // uGone 個目までの単位は消えた。次の 1 個が消えている途中
  vGone = uUnit > 0 ? clamp((uUnit == 1 ? aB.w : aF) + 1.0 - uGone, 0.0, 1.0) : 1.0;
  gl_Position = (rev <= 0.0 || vGone <= 0.0) ? vec4(2.0, 2.0, 2.0, 1.0) : place(p, aD);
}`;
    const strokeFS = `#version 300 es
precision highp float;
in float vS, vLen, vV, vW, vRand, vKind, vCurv, vIdx, vSLim, vDry, vGone, vSize;
flat in int vId;
uniform vec4  uVF[${FUDE_VARIANTS*2}];     // 筆の組 × 2 vec4
uniform float uW0, uBristles, uStreak, uBContrast, uRefill;
#define uKasure   F0.x
#define uDryStart F0.y
#define uSpeedDry F0.z
#define uSplay    F0.w
#define uRough    F1.x
uniform float uTone, uPool, uFlowT, uBoilOff, uSoft, uLean, uFine, uRim;
out vec4 frag;
${NOISE}
void main(){
  vec4 F0 = uVF[vId*2], F1 = uVF[vId*2+1];
  float x = vV/vW;
  float s = clamp(vS, 0.0, vLen);
  float L = vLen;
  float u = s/L;
  float sW = s/(uW0*vSize);
  float rnd = vRand*61.0;
  // 形: 両端は丸いキャップ。縁は進行方向のノイズで荒らす
  float over = max(0.0, max(-vS, vS - vLen))/vW;
  float edge = 1.0 - uRough*0.4*vn(vec2(sW*1.1 + rnd, x > 0.0 ? 3.0 : 9.0));
  float tailTip = max(0.0, vS - vSLim)/vW;
  float r = length(vec2(x, max(over, tailTip)))/edge;
  float aa = clamp(fwidth(r), 0.02, 0.35) + uSoft*0.6;
  float mask = 1.0 - smoothstep(1.0 - aa, 1.0 + aa*0.5, r);
  if(mask <= 0.0) discard;

  // 毛の筋: 太さ方向に細かく、進行方向に長いノイズ
  float bid = x*uBristles*0.5 + rnd + uBoilOff;
  float ys  = sW/uStreak + uFlowT + rnd*0.37 + x*uLean;
  float b = mix(vn(vec2(bid, ys)), vn(vec2(bid*2.7 + 5.0, ys*1.7 + 9.0)), uFine);
  b = clamp((b - 0.5)*uBContrast + 0.5, 0.0, 1.0);

  // 墨の残量: uRefill 画ごとに墨を継ぐ
  float inkT = (mod(vIdx, uRefill) + u)/uRefill;
  inkT += 0.14*(vn(vec2(sW*0.25, vRand*9.0)) - 0.5);
  float dry = uKasure*vDry*smoothstep(uDryStart, 1.0, inkT);
  dry *= 1.0 - uSpeedDry*smoothstep(0.1, 0.7, vCurv);
  dry += uKasure*uRim*smoothstep(0.5, 1.0, abs(x))*smoothstep(uDryStart*0.6, 1.0, inkT);
  dry = min(dry, 0.8);                               // どれだけ乾いても筋は残す (線が消えると字にならない)
  float t = dry*1.15 - 0.22;
  float cov = smoothstep(t - 0.05, t + 0.07, b);

  // 毛先の割れ: 線の終わりに向かって毛束に分かれる
  float split = uSplay*smoothstep(0.55, 1.0, u)*(0.4 + 0.6*vKind);
  float tuft = vn(vec2(x*2.6 + rnd*1.3, sW*0.05));
  cov *= smoothstep(split*0.75 - 0.12, split*0.75 + 0.06, tuft*1.15);

  float a = mask*cov*vGone;
  float tone = 1.0 - uTone*(vn(vec2(sW*0.14 + rnd, x*0.7))*0.75 + 0.25*inkT);
  tone *= 1.0 - uTone*1.1*(1.0 - b);
  float rem = (L - s)/vW;
  float pool = uPool*clamp(smoothstep(0.65, 1.0, abs(x))*0.55 + vCurv*0.7 + exp(-rem*0.45)*(1.0 - vKind), 0.0, 1.0);
  frag = vec4(a, a*tone, a*pool, a*0.25);
}`;
    const splatVS = `#version 300 es
precision highp float;
in vec2 aPos;
in vec2 aDir;
in vec3 aS;      // size, t, rand
in vec3 aD;
in vec2 aU;      // 画の番号, 文字の番号
uniform float uSpread, uSize, uPx, uReveal, uSplatKick, uShown, uGone;
uniform int   uUnit;
out float vR;
${PLACE}
void main(){
  vR = aS.z;
  vec2 p = aPos + aDir*uSpread*(1.0 + uSplatKick*aS.z);
  float unitId = uUnit == 1 ? aU.x : aU.y;
  bool hide = uUnit > 0 ? (unitId >= uShown || unitId + 1.0 <= uGone) : uReveal < aS.y;
  gl_Position = hide ? vec4(2.0, 2.0, 2.0, 1.0) : place(p, aD);
  gl_PointSize = clamp(aS.x*uSize*uPx, 1.0, 64.0);
}`;
    const splatFS = `#version 300 es
precision highp float;
in float vR;
out vec4 frag;
${NOISE}
void main(){
  vec2 q = gl_PointCoord*2.0 - 1.0;
  float d = length(q) + (vn(q*2.5 + vR*50.0) - 0.5)*0.5;
  float a = 1.0 - smoothstep(0.7, 0.95, d);
  if(a <= 0.0) discard;
  frag = vec4(a, a*0.85, 0.0, 0.0);
}`;
    const compVS = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2);
  vUv = p;
  gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
}`;
    const compFS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2  uRes;
uniform vec3  uInk, uInk2, uPaper;
uniform float uDensity, uOverlap, uBleed, uBleedS, uFiber, uGrain, uSheen, uFade, uOpaque, uPaperAlpha;
uniform float uSheenAng, uSheenPow, uGamma, uRing, uHalo, uGrainS, uMottle, uVig;
uniform int   uTaps;
out vec4 frag;
${NOISE}
void main(){
  vec4 t = texture(uTex, vUv);
  float a = t.r, tone = t.g, pool = t.b, over = t.a;
  vec2 asp = vec2(uRes.x/uRes.y, 1.0);
  vec2 p = vUv*asp;
  if(uTaps > 0){
    // にじみ: 紙の繊維ノイズでゆがめて周囲の墨を集める
    float R = uBleed*0.022;
    vec2 wv = vec2(vn(p*uBleedS), vn(p*uBleedS + 17.0)) - 0.5;
    wv += (vec2(vn(p*uBleedS*vec2(5.0, 0.7)), vn(p*uBleedS*vec2(0.7, 5.0))) - 0.5)*uFiber;
    float sum = 0.0;
    for(int i=0; i<uTaps; i++){
      float ang = float(i)*2.39996, rr = sqrt((float(i)+0.5)/float(uTaps));
      vec2 o = (vec2(cos(ang), sin(ang))*rr + wv*1.2)*R/asp;
      sum += texture(uTex, vUv + o).r;
    }
    sum /= float(uTaps);
    float fib = vn(p*uBleedS*3.0)*0.5 + 0.5;
    float halo = smoothstep(0.12, 0.62, sum*fib*1.4);
    float wet = max(a, min(1.0, halo*0.82*uHalo));
    tone += (wet - a)*0.72;
    a = wet;
  }
  float tooth = vn(p*uRes.y*0.33*uGrainS)*0.6 + vn(p*uRes.y*0.11*uGrainS + 3.0)*0.4;
  float dryEdge = 1.0 - smoothstep(0.55, 1.0, a);
  a *= 1.0 - uGrain*smoothstep(0.42, 0.78, tooth)*(0.4 + 0.6*dryEdge);

  float dark = clamp(uDensity*(a > 0.001 ? clamp(tone/max(t.r, 0.02), 0.0, 1.0) : 1.0) + pool*0.6 + over*uOverlap, 0.0, 1.0);
  if(uGamma != 1.0) dark = pow(dark, uGamma);
  if(uRing > 0.0){
    float rp = uRes.y/180.0;
    vec2 q = rp/uRes;
    float nb = 0.25*(texture(uTex, vUv + vec2(q.x, 0.0)).r + texture(uTex, vUv - vec2(q.x, 0.0)).r + texture(uTex, vUv + vec2(0.0, q.y)).r + texture(uTex, vUv - vec2(0.0, q.y)).r);
    float ring = clamp((t.r - nb)*3.0, 0.0, 1.0);
    dark *= mix(1.0, 0.2 + 0.8*ring, uRing);
  }
  vec3 ink = mix(uInk2, uInk, dark);
  if(uSheen > 0.0){
    vec2 px = 2.0/uRes;
    float gx = texture(uTex, vUv + vec2(px.x, 0.0)).r - texture(uTex, vUv - vec2(px.x, 0.0)).r;
    float gy = texture(uTex, vUv + vec2(0.0, px.y)).r - texture(uTex, vUv - vec2(0.0, px.y)).r;
    ink += uSheen*0.5*pow(clamp(dot(normalize(vec3(gx, gy, 0.6)), normalize(vec3(cos(uSheenAng), sin(uSheenAng), 0.6/0.7810250))), 0.0, 1.0), uSheenPow);
  }
  a = clamp(a, 0.0, 1.0)*uFade;
  vec3 paper = uPaper*(1.0 - uGrain*0.07*(tooth - 0.5));
  if(uMottle > 0.0) paper *= 1.0 - uMottle*0.3*(vn(p*3.0 + 41.0)*0.65 + vn(p*7.5 + 13.0)*0.35);
  if(uVig > 0.0){ vec2 vc = vUv*2.0 - 1.0; paper *= 1.0 - uVig*0.55*smoothstep(0.35, 1.5, length(vc)); }
  if(uOpaque > 0.5){ frag = vec4(mix(paper, ink, a), 1.0); }
  else {
    float o = a + uPaperAlpha*(1.0 - a);
    vec3  c = (a*ink + (1.0 - a)*uPaperAlpha*paper)/max(o, 1e-5);
    frag = vec4(c, o);
  }
}`;
    const link = (vsrc, fsrc, tag)=>{
      const sh = (type, src)=>{
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('[Fude] '+tag+' shader:', gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vsrc));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsrc));
      gl.linkProgram(p);
      if(!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error('[Fude] '+tag+' link:', gl.getProgramInfoLog(p));
      p._u = {};
      return p;
    };
    this.strokeProg = link(strokeVS, strokeFS, 'stroke');
    this.splatProg = link(splatVS, splatFS, 'splat');
    this.compProg = link(compVS, compFS, 'comp');

    const attr = (prog, name, size, stride, off)=>{
      const loc = gl.getAttribLocation(prog, name);
      if(loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride*4, off*4);
    };
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    this.ibo = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    [['aPos',2,0],['aTan',2,2],['aA',4,4],['aB',4,8],['aC',3,12],['aD',3,15],['aE',4,18],['aF',1,22],['aG',2,23]].forEach(([n,s,o])=>attr(this.strokeProg, n, s, 25, o));
    this.splatVAO = gl.createVertexArray();
    this.splatVBO = gl.createBuffer();
    gl.bindVertexArray(this.splatVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.splatVBO);
    [['aPos',2,0],['aDir',2,2],['aS',3,4],['aD',3,7],['aU',2,10]].forEach(([n,s,o])=>attr(this.splatProg, n, s, 12, o));
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.emptyVAO = gl.createVertexArray();

    if(document.fonts && document.fonts.addEventListener){
      document.fonts.addEventListener('loadingdone', ()=>{ this._fontGen++; this._sig = ''; });
    }
    this.initialized = true;
  },

  // ===== 毎フレーム: 文字組・骨格が変わったときだけ作り直す =====
  update(force){
    if(!this.initialized) return;
    const P = this.P;
    if(Math.round(P.textPick || 0) === 0) this._curText = null;
    else if(this._curText === null) this._pickText();
    const sig = [this._text(), P.fontFamily, Math.round(P.bold||0), Math.round(P.layout||0), Math.round(P.align||0), P.tracking, P.leading, P.wrap,
                 P.scatter, P.shift, P.stagger, P.stair, P.scatterRot, P.compose, P.aspect, P.aspectRand, P.slantRand, P.sizeMin, P.sizeMax, P.sizeSkew, P.even, P.area, (this._aspect||0).toFixed(2),
                 P.styleRand, P.fontRand, P.brushRand, P.brushAmt, P.layoutRand, P.link, P.linkThin, P.hataku, P.stretch,
                 Math.round(P.smooth), P.spur, P.merge, P.hane, P.haraiLen, Math.round(P.seed||0), P.vary, P.strokeGap, P.speedVar, this._fontGen].join('\u0001');
    if(sig === this._sig) return;
    const t = performance.now();
    if(!force && this._sig && t - this._lastBuild < 90) return;   // スライダードラッグ中の連続再構築を間引く
    this._lastBuild = t;
    this._sig = sig;
    this._ensureFont(String(this._text()||'').slice(0, 60) || '永');
    this._build();
    if(P.text !== this._wasText){ this._wasText = P.text; this._t0 = null; }
  },

  _ensureInk(w, h){
    const gl = this.gl;
    if(this.inkFBO && this.inkW === w && this.inkH === h) return;
    if(this.inkTex) gl.deleteTexture(this.inkTex);
    if(!this.inkFBO) this.inkFBO = gl.createFramebuffer();
    this.inkTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.inkTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.inkFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.inkTex, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.inkW = w; this.inkH = h;
  },

  // ===== render =====
  render(opts){
    const gl = this.gl;
    if(!this.initialized || !this.strokeProg) return;
    const P = this.P;
    const dz = (v)=> (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v;
    const w = opts.w, h = opts.h;
    const hold = Math.round(P.hold || 0) === 1;
    const clock = hold ? Math.max(0, +P.phase || 0) : ((opts.clock != null) ? opts.clock : (performance.now()/1000 - this.startTime));
    const bpm = (typeof BPM !== 'undefined' && BPM.bpm) ? BPM.bpm : 120;
    const beatMode = !hold && (typeof App !== 'undefined' && App.beatMode === 'beat');
    const bt = (beatMode && opts.beat != null) ? opts.beat : clock * 6.0 * (bpm / 120);
    const fb = bt - Math.floor(bt);
    const kick = beatMode ? Math.pow(1 - fb, 4) : 0.5 + 0.5*Math.sin(bt*0.3);
    const audioReact = (typeof Audio !== 'undefined' && Audio.react) ? Math.max(0, Math.min(1, Audio.react)) : 0;
    const au = audioReact * dz(P.audio);
    const pulse = dz(P.pulse);

    // 書き順
    const mode = Math.round(P.write || 0);
    // beat モードの Off は C と同じ (1 拍の中で全文字列を書き切る)。drone の Off は Write の設定で書く
    const beatM = hold ? 0 : (Math.round(P.beatMode || 0) || (beatMode ? 3 : 0));
    let reveal = 1, fade = 1, unit = 0, shown = 0, frac = 1, gone = 0;
    if(this._t0 === null || hold || bt < this._t0) this._t0 = hold ? 0 : bt;   // 時計の巻き戻しでは書き直す
    const easeAll = Math.round(P.easeAll || 0), easeP = Math.max(1, +P.easePow || 1);
    // Transition があるときは文字を残したまま切り替える (直前の画面から混ざるので、消えていると演出が見えない)
    // beat モードのフェードも同じく切替まで文字を残す。1 筆・1 文字ずつは消すこと自体を選んだ設定なので残す
    const exitChoice = Math.round(P.exit || 0);
    const exitMode = (+P.setTrans > 0 || (beatMode && exitChoice === 0)) ? 1 : exitChoice;
    const fbs = exitMode === 1 ? 0 : Math.max(0, +P.fadeBeats || 0);   // 一気に消すならフェードの時間を取らない
    if(beatM && beatMode){
      // beat モード: Bar Beats の中で全部を書き切る。A / B は Beat Rate で進み、収まらなければ詰める
      const btSec = 60 / bpm, lead = (1/60) / btSec;       // lead: 切替の瞬間が白紙にならないよう 1 コマ先を見る
      const barBt = Math.max(1/32, +P.beatBar || 4), m = Math.floor(bt / barBt), t = bt - m*barBt;
      const atk = Math.max(0, Math.min(1, +P.penTime || 0));
      if(this._beatBase === null || m < this._beatBase) this._beatBase = m;
      else if(m !== this._beatBase){ this._beatBase = m; this._advance(); }
      if(beatM === 3){
        const wr = barBt*atk;
        reveal = wr*btSec >= 0.03 ? this._ease(Math.min(1, (t + lead) / wr), easeAll, easeP) : 1;
        const f = Math.min(fbs, barBt*Math.min(0.5, 1 - atk));   // 書き終えてから消す
        if(f > 0) fade = Math.min(1, (barBt - t) / f);
      } else {
        unit = beatM;
        const nU = this._nUnits[unit-1], oneByOne = exitMode === 2;
        const budget = barBt*(oneByOne ? 0.45 : (atk > 0 ? atk : 0.8));   // 1 単位ずつ消すなら後半は消す時間
        const rate = Math.max(1/32, +P.beatRate || 1);
        const stepBt = nU*rate > budget ? budget / Math.max(1, nU) : rate;
        const idx = Math.floor(t / stepBt), fr = t / stepBt - idx;
        const tooShort = barBt*btSec < 0.05;               // 数フレームしか無い Bar は全部出す
        shown = tooShort ? nU : Math.min(nU, idx + 1);
        frac = (!tooShort && idx < nU && atk*stepBt*btSec >= 0.03) ? Math.min(1, (fr + lead/stepBt) / atk) : 1;
        if(oneByOne){
          const ex = barBt*0.55;
          if(t > ex && nU > 0) gone = (t - ex) / (barBt*0.45 / nU);
        } else {
          const f = Math.min(fbs, barBt - Math.min(nU*stepBt, barBt));
          if(f > 0 && t > barBt - f) fade = (barBt - t) / f;
        }
      }
    } else if(beatM){
      // Beat Write (drone): 実際の拍の頭に揃えて 1 単位ずつ進める (drone の bt は実際の拍の 3 倍)
      const btPerBeat = beatMode ? 1 : 3, btSec = 60 / bpm / btPerBeat;
      const stepBt = Math.max(1/32, +P.beatRate || 1) * btPerBeat, n = Math.floor(bt / stepBt), fr = bt / stepBt - n;
      const atk = Math.max(0, Math.min(1, +P.penTime || 0)), fadeBt = fbs * btPerBeat;
      // 筆で書く時間が 2 フレームも無いときは一気に出す。切替の瞬間が白紙にならないよう 1 コマ先を見る
      const pen = atk*stepBt*btSec >= 0.03 ? Math.min(1, (fr + (1/60)/btSec/stepBt) / atk) : 1;
      if(this._beatBase === null || n < this._beatBase) this._beatBase = n;
      if(beatM === 3){
        if(n !== this._beatBase){ this._beatBase = n; this._advance(); }
        reveal = this._ease(pen, easeAll, easeP);
        const f = Math.min(fadeBt, stepBt*Math.min(0.5, 1 - atk));   // 書き終えてから消す
        if(f > 0) fade = Math.min(1, (1 - fr)*stepBt / f);
      } else {
        unit = beatM;
        const nU = this._nUnits[unit-1];
        const holdSteps = Math.ceil(Math.max(0, +P.beatHold || 0)*btPerBeat / stepBt);
        // 1 筆・1 文字ずつ消すなら書いた数だけ後ろに足す。消しきった拍で次のセットの 1 単位目が始まる
        const oneByOne = exitMode === 2;
        const fadeSteps = oneByOne ? 0 : Math.ceil(fadeBt / stepBt), exitSteps = oneByOne ? nU : 0;
        let idx = n - this._beatBase;
        if(nU > 0 && idx >= nU + holdSteps + fadeSteps + exitSteps){ this._beatBase = n; idx = 0; this._advance(); }
        shown = Math.min(nU, idx + 1);
        frac = idx < nU ? pen : 1;
        const tail = idx - nU - holdSteps + fr;
        if(tail >= 0 && oneByOne) gone = tail;
        else if(tail >= 0 && fadeSteps > 0) fade = 1 - tail / fadeSteps;
      }
    } else if(mode){
      const e = Math.max(0, bt - this._t0);
      const wb = Math.max(0.25, +P.writeBeats || 1), hb = Math.max(0, +P.holdBeats || 0);
      if(mode === 1){
        const period = wb + hb + fbs, cycle = Math.floor(e / period);
        if(!hold && cycle !== this._cycle){ this._cycle = cycle; this._advance(); }   // 周回の境目は何も見えていない
        const ph = e % period;
        reveal = this._ease(Math.min(1, ph / wb), easeAll, easeP);
        if(fbs > 0 && ph > wb + hb) fade = 1 - (ph - wb - hb) / fbs;
      } else {
        reveal = this._ease(Math.min(1, e / wb), easeAll, easeP);
      }
    }

    // セットが変わったフレームで作り直す (1 フレーム遅れると前の文字がちらつく)
    if(this._setChanged){ this._setChanged = false; this.update(true); }

    const col = this._colors();
    const ink = col.ink || [0,0,0], ink2 = col.ink2 || ink, paper = col.paper || [1,1,1];
    const opaque = (opts.opaque !== false);
    const fit = Math.min(w*0.84/this._bbox[0], h*0.84/this._bbox[1]);
    const W0 = 0.03 * dz(P.width);
    const bleed = dz(P.bleed);
    const taps = bleed > 0 ? Math.max(4, Math.min(12, Math.round(+P.bleedTaps || 8))) : 0;
    const boilStep = beatMode ? Math.floor(bt) : Math.floor(clock * Math.max(1, +P.boilRate || 1));
    const boilOff = dz(P.boil) * 40 * (Math.abs(Math.sin(boilStep*12.9898)*43758.5453) % 1);

    this._aspect = w / h;
    this._ensureInk(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.inkFBO);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
    gl.depthMask(false);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const U = (p, n)=> (p._u[n] !== undefined) ? p._u[n] : (p._u[n] = gl.getUniformLocation(p, n));
    const setPlace = (p)=>{
      gl.uniform2f(U(p,'uRes'), w, h);
      gl.uniform2f(U(p,'uPos'), +P.posX||0, +P.posY||0);
      gl.uniform1f(U(p,'uFit'), fit);
      gl.uniform1f(U(p,'uZoom'), Math.max(0.05, +P.zoom||1));
      gl.uniform1f(U(p,'uRot'), (+P.rotate||0)*Math.PI/180);
      gl.uniform1f(U(p,'uSlant'), +P.slant||0);
      gl.uniform1f(U(p,'uStretch'), +P.stretch||1);
      gl.uniform1f(U(p,'uSway'), dz(P.sway));
      gl.uniform1f(U(p,'uTime'), bt);
    };

    if(this.indexCount > 0){
      gl.enable(gl.BLEND);
      gl.blendEquationSeparate(gl.MAX, gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE);

      const sp = this.strokeProg;
      gl.useProgram(sp);
      setPlace(sp);
      const f = (n, v)=> gl.uniform1f(U(sp,n), v);
      f('uW0', W0); f('uPressF', +P.pressFreq||1); f('uWobbleF', +P.wobbleFreq||1);
      f('uBreath', kick*pulse*0.22 + au*0.3); f('uReveal', reveal); f('uShown', shown); f('uFrac', frac); f('uGone', gone);
      gl.uniform1i(U(sp,'uUnit'), unit);
      // 筆の組: スライダーをライブに効かせるため毎フレーム詰める
      const VT = this._vtBuf || (this._vtBuf = new Float32Array(FUDE_VARIANTS*20));
      const VF = this._vfBuf || (this._vfBuf = new Float32Array(FUDE_VARIANTS*8));
      this._vt.forEach((v, i)=>{
        const val = k=> dz(this._val(v, k));
        const nibOff = (v.mul && v.mul.nibOff) || 0;
        VT.set([ val('fontWidth'), val('nib'), ((+this._val(v,'nibAngle')||0) + nibOff)*Math.PI/180, val('pressure'),
                 val('entry'), val('taperIn')*2.0, val('taperOut')*2.0, Math.max(0.1, +this._val(v,'taperPow')||1),
                 val('harai'), val('tome'), val('corner'), val('wobble'),
                 val('width')/Math.max(dz(P.width), 0.01), val('rough'), val('splay'), 0,
                 Math.round(this._val(v,'ease')||0), Math.max(1, +this._val(v,'easePow')||1), 0, 0 ], i*20);
        VF.set([ val('kasure'), Math.min(0.98, +this._val(v,'dryStart')||0), val('speedDry'), val('splay'),
                 val('rough'), 0, 0, 0 ], i*8);
      });
      gl.uniform4fv(U(sp,'uVT'), VT);
      gl.uniform4fv(U(sp,'uVF'), VF);
      f('uBristles', Math.max(1, +P.bristles||1)); f('uStreak', Math.max(0.1, +P.streak||1)); f('uBContrast', +P.bristleContrast||1);
      f('uRefill', Math.max(1, Math.round(+P.refill||1)));
      f('uTone', dz(P.tone)); f('uPool', dz(P.pool));
      f('uSoft', dz(P.edgeSoft)); f('uLean', dz(P.bristleLean));
      f('uFine', Math.max(0, Math.min(100, +P.fineHair))/100); f('uRim', Math.max(0, +P.rimDry)/100);
      f('uFlowT', (+P.flow||0)*bt*0.1); f('uBoilOff', boilOff);
      gl.bindVertexArray(this.vao);
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);

      const count = Math.min(this.splatCount, Math.floor(dz(P.splatter) * FUDE_MAX_SPLATS));
      if(count > 0){
        const pp = this.splatProg;
        gl.useProgram(pp);
        setPlace(pp);
        gl.uniform1f(U(pp,'uSpread'), +P.splatSpread||0);
        gl.uniform1f(U(pp,'uSize'), (+P.splatSize||0) * (1 + kick*pulse*0.6 + au*0.6));
        gl.uniform1f(U(pp,'uPx'), fit * Math.max(0.05, +P.zoom||1) * 2.0);
        gl.uniform1f(U(pp,'uReveal'), reveal);
        gl.uniform1f(U(pp,'uShown'), shown);
        gl.uniform1f(U(pp,'uGone'), gone);
        gl.uniform1i(U(pp,'uUnit'), unit);
        gl.uniform1f(U(pp,'uSplatKick'), kick*pulse + au);
        gl.bindVertexArray(this.splatVAO);
        gl.drawArrays(gl.POINTS, 0, count);
      }
      gl.blendEquation(gl.FUNC_ADD);
      gl.disable(gl.BLEND);
    }

    // 合成
    gl.bindFramebuffer(gl.FRAMEBUFFER, opts.fbo || null);
    gl.viewport(0, 0, w, h);
    const cp = this.compProg;
    gl.useProgram(cp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.inkTex);
    gl.uniform1i(U(cp,'uTex'), 0);
    gl.uniform2f(U(cp,'uRes'), w, h);
    gl.uniform3fv(U(cp,'uInk'), ink); gl.uniform3fv(U(cp,'uInk2'), ink2); gl.uniform3fv(U(cp,'uPaper'), paper);
    const c = (n, v)=> gl.uniform1f(U(cp,n), v);
    c('uDensity', dz(P.density)); c('uOverlap', dz(P.overlap)); c('uBleed', bleed); c('uBleedS', Math.max(0.5, +P.bleedScale||1));
    c('uFiber', dz(P.bleedFiber)); c('uGrain', dz(P.grain)); c('uSheen', dz(P.sheen)); c('uFade', Math.max(0, Math.min(1, fade)));
    c('uOpaque', opaque ? 1 : 0); c('uPaperAlpha', dz(P.paperAlpha));
    c('uSheenAng', (+P.sheenAngle||0)*Math.PI/180); c('uSheenPow', Math.max(1, +P.sheenPower||1)); c('uGamma', Math.max(0.1, +P.inkGamma||1));
    c('uRing', dz(P.edgeRing)); c('uHalo', Math.max(0, +P.bleedHalo)/100); c('uGrainS', Math.max(0.1, +P.grainSize)/100);
    c('uMottle', dz(P.paperMottle)); c('uVig', dz(P.paperVignette));
    gl.uniform1i(U(cp,'uTaps'), taps);
    gl.bindVertexArray(this.emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.depthMask(true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },
};

// PDefaults はスクリプト読込時に確定させる (init より先に state 復元が走るため)
Fude.PDefaults = JSON.parse(JSON.stringify(Fude.P));
Fude.STYLES = FUDE_STYLES;
Fude.COLORS = FUDE_COLORS;
