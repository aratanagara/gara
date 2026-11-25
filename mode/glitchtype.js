'use strict';
/* Glitch Type engine — vj/ の追加レンダリングモード (kind:'glitchtype')。
   ドゥルーズの引用 (mode/glitchtype-quotes.json、または Custom の行) をスイス・タイポグラフィのグリッドに組み、
   ランダムな記号・英数字がスクランブルしながら確定していくグリッチタイピングで打ち続ける。
   - 組版: 引用ごとに 1 回だけ組む (Layout = Hero / Column / Stack / Split / Rotate / Giant / Word / Bleed / Poster / Tower、Auto は引用ごとに引き直す)。
     各字の位置は確定後の文字列で先に決め、スクランブル中の字はその位置に置く (行がガタつかない)。
   - 描画: 毎フレーム Canvas2D に字・罫線・番号・グリッド・端の帯 (ゲージ / ティッカー) を描き、テクスチャに上げて
     紙 (Paper) をシェーダで敷く (Slot B は実 alpha で透過)。グリッドは引用ごとに段数・行数・余白・溝を引き直す。
   - 進み: beat モードは拍、drone モードは時間 (1 拍 = 0.5 秒)。逆再生でも先へ進むよう、進んだ量の絶対値を積む。
   IF: init(gl) / render({fbo,w,h,slot,beat,clock,opaque}) / restart() / P / PDefaults
*/

const GT_UFB = (typeof MT_UNICODE_FB !== 'undefined') ? MT_UNICODE_FB : '"Unifont VJ"';
// 書体: Aratana (ラテン + 記号) を先頭に、和文は秀英角ゴ銀へ落とす。ほかは MT_FONTS を共有する
const GT_FONTS = [{ name:'Aratana', ff:'"Aratana","dnp-shuei-gothic-gin-std","Zen Kaku Gothic New","Noto Sans JP","Hiragino Sans",' + GT_UFB + ',sans-serif' }]
  .concat(typeof MT_FONTS !== 'undefined' ? MT_FONTS : []);

// スクランブルの字。Aratana が持つ字だけで作る (Katakana だけは和文書体に落ちる)
const GT_CHARSETS = {
  alnum:  'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  symbol: '!#$%&*+-/<=>?@[]^_{|}~:;§¶†‡•‰←↑→↓≈≠≤≥●×÷±¤µ',
  mixed:  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&*+-/<=>?@[]^_{|}~§¶†‡●',
  binary: '01',
  hex:    '0123456789ABCDEF',
  katakana: 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン',
};
const GT_LAYOUTS = ['hero', 'column', 'stack', 'split', 'rotate', 'giant', 'word', 'bleed', 'poster', 'tower'];
// Params の欄 (ブロック) ごとの値。Reset はそのブロックの値だけを保存値へ戻す
const GT_BLOCKS = {
  text:['flow', 'order', 'lang', 'sub', 'author', 'custom'],
  type:['font', 'weight', 'upper', 'size', 'leading', 'tracking', 'mainStyle', 'numStyle', 'stroke', 'numStroke'],
  grid:['layout', 'layoutEvery', 'cols', 'margin', 'bandAlign', 'ruleAlign', 'baseline', 'baseShift', 'meta', 'keyword', 'grid', 'kinetic', 'seed', 'layoutVals'],
  lines:['topRuleW', 'botRuleW', 'ruleW', 'accentW', 'gaugeW', 'gridW', 'cursorW'],
  typing:['rate', 'scramble', 'lead', 'scrHz', 'charset', 'flash', 'hold', 'erase', 'eraseBeats', 'cursor'],
  color:['ink', 'paper', 'accent', 'base', 'scrColor'],
  terminal:['gauge', 'ticker', 'tickRate'],
  d3:['depth3D', 'depth'],
};
// Layout ごとに保存する見た目の値 (Layout = Auto のとき、引いた Layout の保存値で描く)
// 帯の仕切り線 (Top / Bottom Rule) の太さは Layout ごとに持たない (どの Layout でも共通)
const GT_LOOK_KEYS = GT_BLOCKS.type.concat(['cols', 'margin', 'meta', 'keyword', 'grid', 'kinetic', 'baseShift'], GT_BLOCKS.lines.filter(k=>k !== 'topRuleW' && k !== 'botRuleW'), GT_BLOCKS.color, ['gauge', 'ticker', 'cursor']);
// ティッカーで打つドゥルーズの概念語
const GT_CONCEPTS = ['RHIZOME','DEVENIR','PLATEAU','LIGNE DE FUITE','DÉTERRITORIALISATION','AGENCEMENT','MACHINE DÉSIRANTE','CORPS SANS ORGANES',
  'DIFFÉRENCE','RÉPÉTITION','PLI','NOMADE','VIRTUEL','INTENSITÉ','MULTIPLICITÉ','RITOURNELLE','SIMULACRE','ÉVÉNEMENT','CONTRÔLE','DIVIDUEL',
  'LISSE / STRIÉ','HECCÉITÉ','MOLÉCULAIRE','IMAGE-TEMPS','IMAGE-MOUVEMENT','CRISTAL','DIAGRAMME','LIGNE ABSTRAITE','DEVENIR-ANIMAL','LITTÉRATURE MINEURE'];

const GlitchType = {
  gl:null, initialized:false, ok:false,
  overscan: true,   // 3D Overscan に対応 (スロットに余白があれば、組版は画面の位置のまま紙を外まで敷く)
  prog:null, U:null, vao:null, tex:null,
  cv:null, ctx:null,
  quotes:null, _quotesReq:false,
  _fontKey:'', _fontReady:false,
  _T:null, _lastB:null,             // 進み (拍)。進んだ量の絶対値を積む
  _q:null,                          // 今の引用 {idx, t0, serial, layoutName}
  _lay:null, _layKey:'',            // 組版の結果と、組み直しの判定キー
  _serial:0, _restart:false,

  // ── パラメータ (UI から操作)。% は 100 = 既定の効き ──
  P:{
    lang:'fr',           // 主の言語 fr / en / ja
    sub:'ja',            // 添える言語 none / fr / en / ja
    order:1,             // 0 = 順番 / 1 = ランダム
    custom:'',           // 空 = ドゥルーズの引用。行ごとに 1 つの文として打つ
    author:'NICK LAND',  // meta の帯に出す著者名
    font:'',             // 空 = Aratana
    weight:500,          // 200〜700 (Aratana の可変軸。2026-11-23 時点の Aratana は 600 以上で l の輪郭が抜ける)
    layout:'auto',       // auto / hero / column / stack / split / rotate
    flow:1,              // 1 = 全引用を 1 本の長文として同じ枠に打ち続ける (枠が埋まったら行を上へ送る) / 0 = 引用ごとに打って消す
    layoutEvery:1,       // グリッドを組み替える拍数。0 = 引用ごと (Flow では今打っている引用が替わるたび)
    size:100,            // 本文の大きさ (%)
    leading:100,         // 行送り (%)
    tracking:0,          // 字間 (1/1000 em)
    cols:0,              // グリッドの段数。0 = Auto (引用ごとに 4〜16 段から引き直す)
    margin:100,          // 余白 (%)
    upper:0,             // 主の文を大文字にする
    rate:6,              // 打つ速さ (字/拍)
    scramble:1.5,        // 1 字がスクランブルしてから確定するまでの拍数
    lead:8,              // カーソルの先でスクランブルを始める字数
    scrHz:20,            // スクランブルの字の入れ替え (回/秒)
    charset:'mixed',     // alnum / symbol / mixed / binary / hex / katakana
    flash:100,           // 確定した瞬間に Scramble 色で光る長さ (%)
    hold:2,              // 打ち終えてから消すまでの拍数
    erase:'scramble',    // scramble = 崩して消す / wipe = 1 字ずつ消す / cut = 一度に消す
    eraseBeats:1,        // 消し終えるまでの拍数 (Cut 以外)
    cursor:1,            // 0 = なし / 1 = ブロック / 2 = 縦棒 / 3 = 下線
    meta:1,              // 番号・著者・出典・罫線
    keyword:1,           // キーワードを Accent 色に
    grid:0,              // グリッド線の濃さ (%)
    kinetic:0,           // 行ごとに拍でグリッドの段ずつ横へ滑る量 (%)
    mainStyle:0,         // 本文 0 = Fill / 1 = Outline / 2 = Outline + キーワードだけ Fill
    numStyle:0,          // 番号 0 = Fill / 1 = Outline
    stroke:100,          // 本文の輪郭の太さ (%)
    numStroke:100,       // 番号の輪郭の太さ (%)
    ruleW:100,           // 段の仕切り線 (Base 色) の太さ (%)
    ruleAlign:'column',  // 段の仕切り線の位置: column = カラムの中心 / gutter = 溝の中心 / center = 画面の左右ど真ん中
    bandAlign:'cell',    // 帯の仕切り線 (Top / Bottom Rule) の位置: cell = グリッドの最初 / 最後の行の上下中央 / line = 行線の上 / free = 字の大きさで決める
    baseline:1,          // 1 = 本文と添えの行送り・ベースラインをグリッドの行に合わせる
    baseShift:0,         // ベースラインを刻みに対して上下にずらす量 (刻みの %、+ で下へ)。Layout ごとに保存できる
    accentW:100,         // 強調の帯 (Key 色) の太さ (%)
    gridW:100,           // グリッド線の太さ (%。100 = 1080p で 1px)
    topRuleW:100,        // 上の帯 (meta か端の帯、Layout で入れ替わる) の仕切り線の太さ (%)
    botRuleW:100,        // 下の帯の仕切り線の太さ (%)
    gaugeW:100,          // ゲージの空き目盛りの太さ (%)
    cursorW:100,         // カーソル (縦棒・下線) の太さ (%)
    ink:[0.06,0.06,0.06],
    paper:[0.93,0.92,0.89],
    accent:[0.89,0.11,0.07],
    base:[0.06,0.06,0.06],
    scrColor:[0.89,0.11,0.07],
    gauge:1,             // 端の帯にゲージ (進み・番号・字数のカウンタ)
    ticker:1,            // 端の帯に概念語を途切れなく打つ行
    tickRate:8,          // ティッカーを打つ速さ (字/拍)
    seed:0,
    depth3D:1,           // 3D Mode: 文字・罫線を深度として出し、3D FX で持ち上げる (0 = 平らな紙)
    depth:60,            // 持ち上げる高さ (%)
    layoutVals:{},       // Layout ごとの見た目の保存値 { hero:{...}, giant:{...} }。Save Layout で今の値を入れ、Save で P ごと保存される
  },

  _dz(v){ return (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v; },
  _ff(){ const P = this.P; const f = GT_FONTS.find(x=>x.ff === P.font); return f ? f.ff : GT_FONTS[0].ff; },

  init(gl){
    this.gl = gl; this.initialized = true;
    this.cv = document.createElement('canvas');
    this.ctx = this.cv.getContext('2d');
    const vs = `#version 300 es
out vec2 vUv;
void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); vUv = p; gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;
    const fs = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform vec3 uPaper; uniform float uOpaque; uniform float uDepthOut, uDepthH;
void main(){
  vec4 c = texture(uTex, vUv);
  o = uOpaque > 0.5 ? vec4(c.rgb + uPaper*(1.0 - c.a), 1.0) : c;
  // 3D: 字や線のあるところを高さ uDepthH まで持ち上げる (線形の深度。紙 = 1 = 外れ)
  gl_FragDepth = (uDepthOut > 0.5 && c.a > 0.05) ? 1.0 - uDepthH * c.a : 1.0;
}`;
    const mk = (type, src)=>{ const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){ console.warn('[GlitchType]', gl.getShaderInfoLog(s)); return null; } return s; };
    const v = mk(gl.VERTEX_SHADER, vs), f = mk(gl.FRAGMENT_SHADER, fs);
    if(!v || !f) return;
    const p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)){ console.warn('[GlitchType]', gl.getProgramInfoLog(p)); return; }
    this.prog = p; this.U = {};
    ['uTex','uPaper','uOpaque','uDepthOut','uDepthH'].forEach(n=>{ this.U[n] = gl.getUniformLocation(p, n); });
    this.vao = gl.createVertexArray();
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.ok = true;
    this.loadQuotes();
  },

  loadQuotes(){
    if(this._quotesReq) return; this._quotesReq = true;
    fetch('mode/glitchtype-quotes.json?v=' + Date.now()).then(r=>r.json()).then(j=>{ this.quotes = Array.isArray(j) ? j : []; })
      .catch(e=>{ console.warn('[GlitchType] quotes', e); this.quotes = []; });
  },

  // 書体の読み込みを待つ (待たないと黙ってフォールバックの書体で組まれる)。3 秒で諦めてそのまま組む
  _ensureFont(){
    const key = this._ff() + '|' + this.P.weight;
    if(key === this._fontKey) return this._fontReady;
    this._fontsOk = this._fontsOk || new Set();
    this._fontKey = key; this._lay = null;
    if(this._fontsOk.has(key)){ this._fontReady = true; return true; }
    this._fontReady = false;
    const first = this._ff().split(',')[0];
    const loads = [document.fonts.load(this.P.weight + ' 64px ' + first, 'AZaz09'), document.fonts.load(this.P.weight + ' 64px ' + first, 'あア漢')];
    Promise.race([Promise.all(loads), new Promise(r=>setTimeout(r, 3000))])
      .then(()=>{ this._fontsOk.add(key); if(this._fontKey === key){ this._fontReady = true; this._lay = null; } });
    return false;
  },

  restart(){ this._restart = true; },

  // Layout ごとの保存: 今の見た目の値を、選んでいる Layout の保存値にする / Layout を選んだとき保存値を P へ読む
  saveLayout(name){
    const P = this.P, v = {};
    for(const k of GT_LOOK_KEYS) v[k] = JSON.parse(JSON.stringify(P[k]));
    P.layoutVals = Object.assign({}, P.layoutVals || {}, { [name]: v });
  },
  clearLayout(name){ const L = Object.assign({}, this.P.layoutVals || {}); delete L[name]; this.P.layoutVals = L; },
  loadLayout(name){
    const v = (this.P.layoutVals || {})[name];
    if(v) for(const k of GT_LOOK_KEYS) if(k in v) this.P[k] = JSON.parse(JSON.stringify(v[k]));   // GT_LOOK_KEYS にない値 (Top / Bottom Rule) は読まない
    this._lay = null;
  },
  // 描くときの値: Layout = Auto なら、引いた Layout の保存値を P に重ねる (P 自体は書き換えない)
  _overlay(base, name){
    const v = base.layout === 'auto' && name && base.layoutVals && base.layoutVals[name];
    if(!v) return base;
    const o = Object.create(base);
    for(const k of GT_LOOK_KEYS) if(k in v) o[k] = v[k];   // 前に保存した Top / Bottom Rule などの値は重ねない
    return o;
  },

  _list(){
    const P = this.P;
    const cus = this._customLines(P.custom);
    if(cus.length) return cus.map(s=>({ main:s, sub:'', src:'', year:'', key:'' }));
    const Q = this.quotes || [];
    return Q.map(q=>({ main:q[P.lang] || q.fr || '', sub:(P.sub !== 'none' && P.sub !== P.lang) ? (q[P.sub] || '') : '', src:q.src || '', year:q.year || '', key:q.key || '' }));
  },

  // Custom の文章を段落に分ける。Markdown を貼ってもよい: 見出しの # と引用の > は外し、記号だけの行は捨て、Notes / References 以降 (注) は読まない
  _customLines(txt){
    const out = [];
    for(let s of String(txt || '').split('\n')){
      s = s.trim();
      if(/^#{1,6}\s*(notes?|references?|bibliography|注|参考文献)\s*$/i.test(s)) break;
      s = s.replace(/^#{1,6}\s+/, '').replace(/^(>\s?)+/, '').trim();
      if(!s || s.length < 2 || /^[\W_]{1,3}$/.test(s)) continue;
      out.push(s);
    }
    return out;
  },

  // 進み: beat モードは拍、drone モードは時間 (1 拍 = 0.5 秒)
  _step(beat, clock){
    const beatMode = (typeof App !== 'undefined' && App.beatMode === 'beat') && beat != null && isFinite(beat);
    const b = beatMode ? beat : (clock != null && isFinite(clock) ? clock*2 : performance.now()/500);
    const d = this._lastB == null ? Infinity : b - this._lastB;
    this._lastB = b;
    if(this._T == null || Math.abs(d) > 4) this._T = (this._T == null) ? 0 : this._T;
    else this._T += Math.abs(d);
    return beatMode;
  },

  _pick(prev, n){
    if(n < 2) return 0;
    if(this.P.order > 0){ let i; do{ i = Math.floor(Math.random()*n); }while(i === prev); return i; }
    return (prev + 1) % n;
  },

  _graphemes(s){
    if(!this._seg && typeof Intl !== 'undefined' && Intl.Segmenter) this._seg = new Intl.Segmenter('ja', { granularity:'grapheme' });
    return this._seg ? Array.from(this._seg.segment(s), g=>g.segment) : Array.from(s);
  },

  // 行に割る。ラテンは語の切れ目で、和文は 1 字ごとに (行頭禁則の約物は前の行に付ける)
  // breakAll = word-break: break-all (語の途中でも 1 字ごとに折り返す。特大の組み方で行を幅いっぱいまで詰める)
  _wrap(ctx, text, maxW, track, breakAll){
    const g = this._graphemes(text);
    const isCJK = ch=>breakAll || /[　-鿿＀-￯]/.test(ch);
    const noHead = /^[、。，．・：；！？」』）〕】ー…ゝゞヽヾ々]$/;
    const toks = []; let cur = '';
    for(const ch of g){
      if(breakAll && ch === ' '){ if(toks.length) toks[toks.length - 1] += ' '; continue; }
      if(isCJK(ch)){
        if(cur){ toks.push(cur); cur = ''; }
        if(noHead.test(ch) && toks.length) toks[toks.length - 1] += ch; else toks.push(ch);
      } else if(ch === ' '){ cur += ' '; toks.push(cur); cur = ''; }
      else cur += ch;
    }
    if(cur) toks.push(cur);
    const W = s=> ctx.measureText(s).width + this._graphemes(s).length*track;
    const lines = []; let line = '';
    for(const t of toks){
      const test = line + t;
      if(line && W(test.replace(/ +$/, '')) > maxW){ lines.push(line.replace(/ +$/, '')); line = t.replace(/^ +/, ''); }
      else line = test;
    }
    if(line.trim()) lines.push(line.replace(/ +$/, ''));
    return lines;
  },

  // 1 ブロックを組む: 字ごとの位置 (ローカル座標) を確定後の文字列で決める
  _block(ctx, o){
    const P = this.P;
    let px = o.px;
    const fontOf = s=> P.weight + ' ' + Math.round(s) + 'px ' + this._ff();
    let lines, lh, track;
    const bg = (P.baseline > 0 && !o.rot && !o.noGrid && (o.role === 'main' || o.role === 'sub')) ? this._bgrid : null;   // Baseline: 本文と添えをグリッドに乗せる (倒した本文と、大きさを枠に合わせて決めた特大の字は除く)
    for(let it=0; it<(o.fit || 8); it++){
      ctx.font = fontOf(px);
      track = (o.track != null ? o.track : P.tracking/1000) * px;
      lh = px * (o.lh || 1.12) * (P.leading/100);
      if(bg) lh = this._snapLH(lh, bg.u);   // 行送りをグリッドに合わせる
      lines = o.split ? o.text.split(/\s+/).filter(Boolean) : this._wrap(ctx, o.text, o.maxW, track, o.breakAll);
      const tooWide = o.split && lines.some(l=>ctx.measureText(l).width > o.maxW);
      if((!o.maxH || lines.length*lh <= o.maxH) && !tooWide) break;
      px *= 0.86;
    }
    let by = o.y;
    if(bg) by = bg.y0 + Math.ceil((o.y + px*0.8 - bg.y0)/lh - 1e-6)*lh - px*0.8 + this._dz(P.baseShift)/100*lh;   // Baseline Shift: 刻みに対して上下にずらす
    const chars = [];
    const keyRe = o.key ? o.key.toLowerCase() : '';
    const orig = this._graphemes(o.text);   // 元の文字列での位置 (行末で落とした空白も数える) = 組み替えても同じ字は同じ番号
    let op = 0;
    lines.forEach((ln, li)=>{
      const g = this._graphemes(ln);
      const low = ln.toLowerCase();
      const kAt = keyRe ? low.indexOf(keyRe) : -1;
      let acc = '', ci = 0, cu = 0;   // cu = UTF-16 位置 (キーワード判定)
      for(const ch of g){
        const x = ctx.measureText(acc).width + ci*track;
        const isKey = kAt >= 0 && cu >= kAt && cu < kAt + keyRe.length;
        while(op < orig.length && orig[op] !== ch && /^\s$/.test(orig[op])) op++;
        chars.push({ ch, x, y: px*0.8 + li*lh, line:li, key:isKey, space: /^\s$/.test(ch), oi:op });
        op++;
        acc += ch; ci++; cu += ch.length;
      }
    });
    return { font:fontOf(px), px, lh, chars, n:orig.length, lines:lines.length, x:o.x, y:by, rot:o.rot || 0, color:o.color || 'ink', w:o.maxW,
      h:lines.length*lh, role:o.role, align:o.align || 'left', px0:o.px, maxH:o.maxH, lhf:(o.lh || 1.12), track:o.track, minLines:o.minLines, breakAll:!!o.breakAll, noGrid:!!o.noGrid };
  },

  // 引用 1 本の組版。グリッド (段数・行数・余白・溝) も引用ごとに引き直し、Layout ごとに要素を置く
  _layout(W, H, q, idx, total, name, rnd){
    const ctx = this.ctx, P = this.P;
    const pickI = (a, b)=> a + Math.floor(rnd()*(b - a + 1));
    const base = Math.min(W, H*1.6) * (P.size/100);
    const C = P.cols > 0 ? Math.round(P.cols) : [4, 5, 6, 7, 8, 9, 10, 12, 14, 16][pickI(0, 9)];
    const R = pickI(4, 9);
    const m = Math.min(W, H) * 0.06 * (P.margin/100);   // 0 = 余白なし (画面の端まで組む)
    const gut = Math.min(W, H) * 0.06 * (0.2 + rnd()*0.45);
    const colW = (W - 2*m - (C - 1)*gut)/C;
    const rowH = (H - 2*m)/R;
    const cc = v=> Math.max(0, Math.min(C - 1, Math.round(v)));
    const cx = c=> m + cc(c)*(colW + gut);
    const span = n=>{ n = Math.max(1, Math.min(C, Math.round(n))); return n*colW + (n - 1)*gut; };   // 段数を超えない (Cols = 1 のとき 2 段ぶんの幅で画面の外へはみ出していた)
    const main = P.upper > 0 ? q.main.toUpperCase() : q.main;
    const meta = P.meta > 0;
    const blocks = [], rules = [];
    const num = String(idx + 1).padStart(2, '0');
    const smallPx = Math.max(10, base*0.0125);
    const ruleH = Math.max(2, base*0.004);   // 線の基準の太さは一定 (組み替えのたびに変わらない。太さは各 Rule のスライダーで)
    // meta (著者・出典) は上か下の帯に、端の帯 (ゲージ / ティッカー) はその反対側に。帯の仕切り線 (Top / Bottom Rule) で本文と仕切る
    // Band Align: cell = 帯をグリッドの最初 / 最後の行に入れ、仕切り線をその行の上下中央に / line = 行線の上に / free = 字の大きさで決める (グリッドに乗せない)
    const metaBottom = meta && rnd() < 0.3;
    const foot = P.gauge > 0 || P.ticker > 0, footTop = metaBottom;
    const hasTop = (meta && !metaBottom) || (foot && footTop), hasBot = metaBottom || (foot && !footTop);
    const align = P.bandAlign === 'line' || P.bandAlign === 'free' ? P.bandAlign : 'cell';
    let topLine = null, botLine = null, topY, botY;
    if(align === 'free'){
      if(hasTop) topLine = m + smallPx*1.9;
      if(hasBot) botLine = H - m - smallPx*2.2;
      topY = (meta && !metaBottom ? m + smallPx*3.2 : m) + (foot && footTop ? smallPx*3.2 : 0);
      botY = (metaBottom ? H - m - smallPx*2.6 : H - m) - (foot && !footTop ? smallPx*2.6 : 0);
    } else {
      const off = align === 'cell' ? rowH/2 : rowH;
      if(hasTop) topLine = m + off;
      if(hasBot) botLine = H - m - off;
      topY = hasTop ? m + rowH : m;
      botY = hasBot ? H - m - rowH : H - m;
    }
    // 帯の字は、上の帯なら線の上、下の帯なら線の下に置く
    const bandTextY = top=> top ? topLine - smallPx*1.9 : botLine + smallPx*1.1;
    const metaY = meta ? bandTextY(!metaBottom) : m;
    const footY = foot ? bandTextY(footTop) : m;
    if(meta){
      const a0 = rnd() < 0.6 ? 0 : cc(C*0.25*rnd());
      const s0 = cc(C*(0.4 + rnd()*0.3));
      blocks.push(this._block(ctx, { text:String(P.author || '').trim() || ' ', px:smallPx, maxW:span(Math.max(1, s0 - a0)), x:cx(a0), y:metaY, role:'meta', color:'base', track:0.04 }));
      if(q.src) blocks.push(this._block(ctx, { text:q.src + (q.year ? ', ' + q.year : ''), px:smallPx, maxW:span(C - s0), x:cx(s0), y:metaY, role:'meta', color:'base' }));
      const ly = metaBottom ? botLine : topLine;
      rules.push({ x:m, y:ly - ruleH/2, w:W - 2*m, h:ruleH, color:'base', band:metaBottom ? 'bot' : 'top' });
    }
    // 段の仕切り線: グリッドに沿わせ (Rule Align)、上下の帯の仕切り線まで伸ばしてつなぐ
    const vy0 = topLine != null ? topLine : m, vy1 = botLine != null ? botLine : H - m;
    const vRule = c=>{   // c = 仕切る位置 (この段の左)
      const x = P.ruleAlign === 'center' ? W/2 : (P.ruleAlign === 'column') ? cx(Math.max(0, c - 1)) + colW/2 : cx(c) - gut/2;
      rules.push({ x:x - ruleH/2, y:vy0, w:ruleH, h:Math.max(1, vy1 - vy0), color:'base' });
    };
    const availH = botY - topY;
    const Rc = align === 'free' ? R : Math.max(1, R - (hasTop ? 1 : 0) - (hasBot ? 1 : 0));   // 本文に使える行の数
    const rowU = availH/Rc;
    this._bgrid = { u:rowU, y0:topY };   // ベースラインのグリッド (行の高さと上端)
    const rowAt = r=> topY + Math.max(0, Math.min(Rc - 1, r)) * rowU;
    const hasKey = P.keyword > 0 ? q.key : '';
    const sub = (o)=>{ if(q.sub) blocks.push(this._block(ctx, Object.assign({ text:q.sub, role:'sub', lh:1.4 }, o))); };
    const numB = (o)=>{ if(meta) blocks.push(this._block(ctx, Object.assign({ text:num, role:'num', color:'accent', lh:0.9 }, o))); };
    let mirror = rnd() < 0.35;
    if(name === 'hero'){
      const c0 = cc(C*0.25*rnd()), c1 = Math.max(c0 + 2, C - cc(C*0.2*rnd()));
      const r0 = pickI(0, Math.floor(R/3));
      const mainB = this._block(ctx, { text:main, px:base*(0.06 + rnd()*0.03), maxW:span(c1 - c0), x:cx(c0), y:rowAt(r0), maxH:botY - rowAt(r0) - base*0.08, role:'main', key:hasKey, lh:1.04, track:-0.02 });
      blocks.push(mainB);
      const sc = cc(C*(0.45 + rnd()*0.2)), sw = Math.max(2, C - sc - pickI(0, 1));
      const spx = base*(0.016 + rnd()*0.008);
      sub({ px:spx, maxW:span(sw), x:cx(sc), y:Math.max(mainB.y + mainB.h + base*0.03, botY - spx*1.4*3), maxH:botY - mainB.y - mainB.h, lh:1.4 });
      numB({ px:base*(0.02 + rnd()*0.06), maxW:span(3), x:cx(0), y:botY - base*0.07 });
    } else if(name === 'column'){
      let c0 = cc(C*(0.33 + rnd()*0.25));
      if(P.ruleAlign === 'center') c0 = Math.ceil(C/2);
      numB({ px:Math.min(availH*(0.4 + rnd()*0.3), span(c0)*0.62), maxW:span(c0), x:cx(0) - base*0.006, y:rowAt(pickI(0, Math.floor(R/2))), track:-0.06 });
      vRule(c0);
      const r0 = pickI(0, Math.floor(R/4));
      const mainB = this._block(ctx, { text:main, px:base*(0.034 + rnd()*0.02), maxW:span(C - c0), x:cx(c0), y:rowAt(r0), maxH:availH*0.7, role:'main', key:hasKey, lh:1.1, track:-0.01 });
      blocks.push(mainB);
      sub({ px:base*0.017, maxW:span(Math.max(2, C - c0 - pickI(0, 2))), x:cx(c0), y:mainB.y + mainB.h + base*0.03, maxH:botY - mainB.y - mainB.h - base*0.03, lh:1.45 });
    } else if(name === 'stack'){
      const c0 = pickI(0, Math.max(0, Math.floor(C/4)));
      const mainB = this._block(ctx, { text:main, px:base*(0.08 + rnd()*0.05), maxW:span(C - c0), x:cx(c0), y:topY, maxH:availH*0.95, role:'main', key:hasKey, lh:0.92, split:true, track:-0.03 });
      blocks.push(mainB);
      const sw = Math.max(2, Math.round(C/4)), spx = base*0.016;
      sub({ px:spx, maxW:span(sw), x:cx(C - sw), y:botY - spx*1.45*4, lh:1.45 });
      numB({ px:base*(0.04 + rnd()*0.04), maxW:span(3), x:cx(C - 3), y:topY });
    } else if(name === 'split'){
      const midY = rowAt(Math.round(R*(0.45 + rnd()*0.2)));
      const c0 = rnd() < 0.5 ? 0 : cc(C*0.2);
      const mainB = this._block(ctx, { text:main, px:base*(0.045 + rnd()*0.02), maxW:span(C - c0), x:cx(c0), y:topY, maxH:midY - topY - base*0.02, role:'main', key:hasKey, lh:1.05, track:-0.02 });
      blocks.push(mainB);
      { const h = Math.max(3, ruleH*2); rules.push({ x:m, y:midY - h/2, w:W - 2*m, h, color:'accent' }); }   // 太さの中心を行線に乗せる
      const sc = cc(C*(0.25 + rnd()*0.2));
      sub({ px:base*(0.024 + rnd()*0.01), maxW:span(C - sc), x:cx(sc), y:midY + base*0.03, maxH:botY - midY - base*0.03, lh:1.3 });
      numB({ px:base*0.03, maxW:span(Math.max(1, sc)), x:cx(0), y:midY + base*0.03, lh:1 });
    } else if(name === 'giant'){ // giant: 1 カラムで本文を画面いっぱいに。入る限りいちばん大きく組み、1 行目のアセンダを本文の枠の上端に揃える (番号・添えは出さない)
      const mainB = this._block(ctx, { text:main, px:availH*0.95, maxW:W - 2*m, x:m, y:topY, maxH:availH, role:'main', key:hasKey, lh:0.88, track:-0.035, fit:40, minLines:2, breakAll:true, noGrid:true });
      mainB.y = topY + this._ascR(ctx, main)*mainB.px - mainB.px*0.8;
      blocks.push(mainB);
    } else if(name === 'word'){ // word: 1 語 (キーワードか、いちばん長い語) を画面の幅いっぱいに。アセンダとベースラインをグリッドの行線に揃える。引用の全文は添えとして小さく
      const toks = this._bigTokens(main);
      const kw = hasKey && main.toLowerCase().includes(hasKey.toLowerCase()) ? (P.upper > 0 ? hasKey.toUpperCase() : hasKey) : toks.slice().sort((a, b)=>this._graphemes(b).length - this._graphemes(a).length)[0] || main;
      const fw = W - 2*m, aR = this._ascR(ctx, kw);
      let px = this._fitPx(ctx, kw, fw, availH/Math.max(0.3, aR), -0.04);
      const kRows = Math.floor(aR*px/rowU + 1e-6);
      if(kRows >= 1) px = kRows*rowU/aR;                                  // 字の高さ (アセンダ〜ベースライン) をグリッドの行の整数倍に
      const capRows = Math.max(1, Math.round(aR*px/rowU));
      const r = rnd() < 0.5 ? capRows : Rc;                               // ベースラインを置く行線 (上寄せ / 下寄せ)
      const baseY = topY + r*rowU, capY = baseY - aR*px;
      blocks.push(this._block(ctx, { text:kw, px, maxW:fw*1.02, x:m, y:baseY - px*0.8, role:'main', key:hasKey, lh:0.9, track:-0.04, noGrid:true }));
      const top = capY - topY > botY - baseY;                              // 空いているほうに添え
      const spx = base*(0.018 + rnd()*0.008), sw = Math.max(2, Math.round(C*(0.4 + rnd()*0.25)));
      const gap = rowU*0.5;
      blocks.push(this._block(ctx, { text:main, role:'sub', px:spx, maxW:span(sw), x:cx(rnd() < 0.5 ? 0 : C - sw), y:top ? topY : baseY + gap, maxH:top ? capY - topY - gap : botY - baseY - gap, lh:1.35 }));
      numB({ px:base*0.03, maxW:span(2), x:cx(C - 2), y:top ? baseY + gap : topY, lh:1 });
    } else if(name === 'bleed'){ // bleed: 本文を画面からはみ出す大きさで組み、端で切る。1 行目のアセンダを枠の上端、最後の行のベースラインを枠の下端に揃える
      mirror = false;
      const nl = rnd() < 0.5 ? 2 : 3, lhf = 0.86, lhK = lhf*(P.leading/100);
      const aR = this._ascR(ctx, main);
      const px = availH/(aR + (nl - 1)*lhK);                              // アセンダ + (行数 - 1) × 行送り = 枠の高さ
      const x0 = m - W*(0.04 + rnd()*0.16);
      const b = this._block(ctx, { text:main, px, maxW:W*(1.25 + rnd()*0.5), x:x0, y:topY + aR*px - px*0.8, role:'main', key:hasKey, lh:lhf, track:-0.045, breakAll:true, noGrid:true });
      b.chars = b.chars.filter(c=>c.line < nl); b.lines = Math.min(b.lines, nl);   // 枠に入る行だけ (続きは打たない)
      blocks.push(b);
    } else if(name === 'poster'){ // poster: 数語ずつの行にして、行ごとに幅いっぱいまで拡大し、行どうしをアセンダとベースラインで詰めて積む (枠の上端〜下端)
      const fw = W - 2*m, ref = 100, tr = -0.04;
      const words = this._bigTokens(main).slice(0, 16);
      const tot = words.reduce((a, w)=>a + this._graphemes(w).length, 0);
      const nL = Math.max(2, Math.min(6, Math.round(Math.sqrt(tot/2.5))));
      const target = tot/nL, lines = [];
      let cur = '';
      for(const w of words){
        const sep = /[　-鿿＀-￯]/.test(w) ? '' : ' ';
        if(cur && this._graphemes(cur + sep + w).length > target*1.3){ lines.push(cur); cur = w; }
        else cur = cur ? cur + sep + w : w;
      }
      if(cur) lines.push(cur);
      ctx.font = P.weight + ' ' + ref + 'px ' + this._ff();
      const L2 = lines.slice(0, 7).map(t=>{ const g = this._graphemes(t).length, mt = ctx.measureText(t);
        return { t, px:ref*fw/Math.max(1, mt.width + g*tr*ref), aR:Math.max(0.3, mt.actualBoundingBoxAscent/ref) }; });
      const capSum = ()=>L2.reduce((a, l)=>a + l.aR*l.px, 0);
      const minGap = availH*0.025;
      const need = capSum() + minGap*(L2.length - 1);
      if(need > availH){ const k = (availH - minGap*(L2.length - 1))/capSum(); L2.forEach(l=>{ l.px *= k; }); }
      const gap = L2.length > 1 ? (availH - capSum())/(L2.length - 1) : 0;   // 余りは行間に配って、最後の行のベースラインを枠の下端に
      let capY = topY;
      L2.forEach(l=>{ const baseY = capY + l.aR*l.px;
        blocks.push(this._block(ctx, { text:l.t, px:l.px, maxW:fw*1.02, x:m, y:baseY - l.px*0.8, role:'main', key:hasKey, lh:0.9, track:tr, noGrid:true }));
        capY = baseY + gap; });
    } else if(name === 'tower'){ // tower: 本文を 90° 倒し、画面の高さいっぱいに 1〜2 段で上から下へ流す
      mirror = false;
      const fw = W - 2*m;
      const mainB = this._block(ctx, { text:main, px:Math.min(fw*0.9, availH*0.5), maxW:availH, x:m + fw, y:topY, maxH:fw, role:'main', key:hasKey, lh:0.88, rot:Math.PI/2, track:-0.03, fit:40, breakAll:true });
      blocks.push(mainB);
    } else { // rotate: 本文を 90° 倒して端の段に上から下へ流す (行は右の段から左へ。左右は引き直す)
      mirror = false;
      const left = rnd() < 0.6;
      let wc = Math.max(2, Math.round(C*(0.35 + rnd()*0.15)));
      const ctr = P.ruleAlign === 'center';
      if(ctr) wc = Math.max(1, Math.floor(C/2));
      const mainB = this._block(ctx, { text:main, px:base*(0.06 + rnd()*0.02), maxW:availH, x:(left ? cx(0) : cx(C - wc)) + span(wc), y:topY, maxH:span(wc), role:'main', key:hasKey, lh:1.0, rot:Math.PI/2, track:-0.02, fit:30 });   // 長い引用でも段の幅に収まるまで縮める
      blocks.push(mainB);
      const c0 = left ? (ctr ? Math.ceil(C/2) : wc) : 0, cw = ctr ? Math.max(1, Math.floor(C/2)) : C - wc;
      const spx = base*0.022;
      sub({ px:spx, maxW:span(cw), x:cx(c0), y:botY - spx*1.35*4, lh:1.35 });
      numB({ px:base*(0.08 + rnd()*0.06), maxW:span(cw), x:cx(c0), y:topY + base*0.02, track:-0.05 });
      vRule(left ? wc : C - wc);
    }
    // 罫線をもう 1 本 (Accent の短い帯) 行の線に置くことがある
    if(rnd() < 0.4){ const c0 = pickI(0, C - 1), n = pickI(1, Math.max(1, Math.floor(C/3))); const h = Math.max(3, ruleH*2.5); rules.push({ x:cx(c0), y:rowAt(pickI(1, R - 1)) - h/2, w:span(Math.min(n, C - c0)), h, color:'accent' }); }   // 太さの中心を行線に乗せる
    // 左右反転: 箱の位置だけ写す (字は左揃えのまま)
    if(mirror){
      blocks.forEach(b=>{ if(!b.rot) b.x = W - b.x - b.w; });
      rules.forEach(r=>{ r.x = W - r.x - r.w; });
    }
    // 打つ順: meta → 番号 と 本文 → 添え の 2 本を同時に打つ (本文を待たせない)
    const ord = { meta:0, num:1, main:2, sub:3 };
    blocks.sort((a, b)=>ord[a.role] - ord[b.role]);
    const lane = [0, 0];
    blocks.forEach(b=>{ const k = (b.role === 'main' || b.role === 'sub') ? 1 : 0; b.chars.forEach(c=>{ c.g = lane[k] + c.oi; }); lane[k] += b.n; });
    const g = Math.max(lane[0], lane[1]);
    this._bgrid = null;
    // 本文・添えを打ってよい上下の範囲: 帯の仕切り線から先 (帯の部分には字を打たない)
    const clipY0 = topLine != null ? topLine + ruleH : -1e9, clipY1 = botLine != null ? botLine - ruleH : 1e9;
    return { clipY0, clipY1, blocks, rules, N:g, C, R:align === 'free' ? R : R, m, gut, colW, rowH:align === 'free' ? availH/R : rowH, gridY0:align === 'free' ? topY : m, topY, W, H, mirror, foot, footTop, footY, smallPx, ruleH, footLine:foot ? (footTop ? topLine : botLine) : null };
  },

  // 特大の組み方 (Word / Poster) の語: ラテンは空白で、和文 (空白のない長い文) は 2〜4 字ずつに切る
  _bigTokens(s){
    const t = String(s || '').split(/\s+/).filter(Boolean);
    if(t.length > 1) return t;
    const g = this._graphemes(String(s || '').trim());
    if(g.length <= 4) return g.length ? [g.join('')] : [];
    const out = [];
    for(let i = 0; i < g.length;){ const n = Math.min(g.length - i, g.length - i <= 5 ? g.length - i : 2 + ((i * 7) % 3)); out.push(g.slice(i, i + n).join('')); i += n; }
    return out;
  },
  // 字の高さ (アセンダ = ベースラインから字のいちばん上まで) の、字の大きさに対する比
  _ascR(ctx, text){
    const ref = 100;
    ctx.font = this.P.weight + ' ' + ref + 'px ' + this._ff();
    const a = ctx.measureText(String(text || 'H')).actualBoundingBoxAscent;
    return Math.max(0.3, Math.min(1.2, (a > 0 ? a : 72)/ref));
  },
  // 1 行の字を幅 w に収まるいちばん大きな大きさに (高さの上限 h)
  _fitPx(ctx, text, w, h, track){
    const ref = 100;
    ctx.font = this.P.weight + ' ' + ref + 'px ' + this._ff();
    const g = this._graphemes(text).length;
    return Math.min(h, ref*w/Math.max(1, ctx.measureText(text).width + g*track*ref));
  },

  _snapLH(lh, u){
    if(!(u > 0)) return lh;
    return lh <= u ? u/Math.max(1, Math.round(u/lh)) : u*Math.max(1, Math.round(lh/u));
  },

  _rgba(c, a){ return 'rgba(' + Math.round(c[0]*255) + ',' + Math.round(c[1]*255) + ',' + Math.round(c[2]*255) + ',' + a + ')'; },

  render(opts){
    const gl = this.gl;
    if(!this.initialized || !this.ok) return;
    const P = this.P;
    const W = Math.max(2, opts.w|0), H = Math.max(2, opts.h|0);
    const os = (typeof GL !== 'undefined' && GL._osCur && GL._osCur.fbo === opts.fbo && GL._osCur.pad) ? GL._osCur.pad : [0, 0];   // 3D Overscan の余白 (片側 px)
    const SW = Math.max(2, W - 2*os[0]), SH = Math.max(2, H - 2*os[1]);   // 画面の大きさ (組版はこの大きさで)
    const clock = (opts.clock != null && isFinite(opts.clock)) ? opts.clock : performance.now()/1000;
    const beatMode = this._step(opts.beat, clock);
    const T = this._T;
    const cv = this.cv, ctx = this.ctx;
    if(cv.width !== W || cv.height !== H){ cv.width = W; cv.height = H; this._lay = null; }
    const list = this._list();
    const base = P;
    let name = this._layName || null;
    for(let pass=0; pass<2; pass++){
      const P = this.P = this._overlay(base, name);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
      ctx.setTransform(1, 0, 0, 1, os[0], os[1]);
      if(!list.length || !this._ensureFont()) break;
      const set = GT_CHARSETS[P.charset] || GT_CHARSETS.mixed;
      // 1 フレームぶんの共通の値
      const F = {
        W:SW, H:SH, T, clock, beatMode, list, set,
        rate:Math.max(0.1, +P.rate || 1), scr:Math.max(0, +P.scramble || 0), lead:Math.max(0, Math.round(P.lead || 0)),
        tick:Math.floor(clock * Math.max(1, +P.scrHz || 20)), flashB:0.35*(P.flash/100),
        bph:beatMode ? (opts.beat - Math.floor(opts.beat)) : (T % 1),
        col:{ ink:P.ink, accent:P.accent, base:P.base, scr:P.scrColor },
      };
      if(P.flow > 0) this._renderFlow(F); else this._renderQuote(F);
      if(this._layName === name || base.layout !== 'auto') break;
      name = this._layName;
    }
    const paper = this.P.paper;
    this.P = base;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // テクスチャへ上げ、紙を敷いて出す
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, opts.fbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    const kd = (typeof GL !== 'undefined' && GL.kindKeepsDepth && opts.fbo) ? GL.kindKeepsDepth(opts.fbo) : false;   // GL が共通の深度を付けている (Code の 3D 深度)
    this.depthInfo = { near:0, far:1, cam:0.5, R:0.5, linear:true };   // 深度 = 1 - z (字 = 高さ、紙 = 外れ)
    if(kd){ gl.depthMask(true); gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.ALWAYS); }
    else gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.U.uTex, 0);
    gl.uniform3fv(this.U.uPaper, paper);
    gl.uniform1f(this.U.uOpaque, opts.opaque === false ? 0 : 1);
    gl.uniform1f(this.U.uDepthOut, kd ? 1 : 0);
    gl.uniform1f(this.U.uDepthH, Math.max(0, Math.min(1, this._dz(base.depth)/100)));
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },

  _hash(a, b, s){ const x = Math.sin(a*12.9898 + b*78.233 + s*3.17)*43758.5453; return x - Math.floor(x); },
  _colOf(F, c){ return c === 'accent' ? F.col.accent : (c === 'base' ? F.col.base : F.col.ink); },

  // 組版のキャッシュ: 大きさや段数を変えたら、その場で組み直す (進みは保つ)
  _layoutFor(F, q, qIdx, serial, step){
    const P = this.P;
    const key = [F.W, F.H, P.lang, P.sub, P.author, P.custom, P.layout, P.size, P.leading, P.tracking, P.cols, P.margin, P.bandAlign, P.ruleAlign, P.baseline, P.baseShift, P.upper, P.meta, P.keyword, P.gauge, P.ticker, P.seed, this._fontKey, serial, step].join('|');
    if(this._lay && this._layKey === key){ this._layName = this._lay.name; return this._lay; }
    let s = (serial*7919 + step*31337 + (P.seed|0)*104729) >>> 0;
    const rnd = ()=>{ s = (s*1664525 + 1013904223) >>> 0; return s/4294967296; };
    const name = P.layout === 'auto' ? GT_LAYOUTS[Math.floor(rnd()*GT_LAYOUTS.length)] : P.layout;
    this._lay = this._layout(F.W, F.H, q, qIdx, F.list.length, GT_LAYOUTS.includes(name) ? name : 'hero', rnd);
    this._lay.name = GT_LAYOUTS.includes(name) ? name : 'hero';
    this._layKey = key; this._layT0 = F.T; this._layName = this._lay.name;
    return this._lay;
  },

  // グリッド線 (組み替えのたびに引き直したグリッド)
  _drawGrid(ctx, F, L, blh){
    if(!(this.P.grid > 0)) return;
    ctx.fillStyle = this._rgba(F.col.base, Math.min(1, this.P.grid/100)*0.5);
    const lw = Math.max(0.5, F.H/1080*(this.P.gridW/100)), o = lw/2;
    for(let c=0; c<L.C; c++){ const x = L.m + c*(L.colW + L.gut); ctx.fillRect(x - o, 0, lw, F.H); ctx.fillRect(x + L.colW - o, 0, lw, F.H); }
    for(let r=0; r<=L.R; r++) ctx.fillRect(0, L.gridY0 + r*L.rowH - o, F.W, lw);
    ctx.fillRect(0, L.m - o, F.W, lw); ctx.fillRect(0, F.H - L.m - o, F.W, lw);
    // Baseline: 本文の行送りの刻み (ベースラインの位置) をさらに薄く
    if(this.P.baseline > 0 && blh > 0){
      ctx.fillStyle = this._rgba(F.col.base, Math.min(1, this.P.grid/100)*0.22);
      for(let y=L.gridY0 + blh; y<F.H - L.m; y+=blh) ctx.fillRect(0, y - o, F.W, lw);
    }
  },
  // 罫線: 組み替えた直後に 1/4 拍で伸びる (grow で外から縮められる)
  _drawRules(ctx, F, L, grow){
    const g = grow * Math.min(1, (F.T - (this._layT0 || 0))/0.25);
    L.rules.forEach(r=>{
      const k = (r.band ? (r.band === 'top' ? this.P.topRuleW : this.P.botRuleW) : (r.color === 'accent' ? this.P.accentW : this.P.ruleW))/100;   // 太さは中心線を保って変える (0 で消す)。帯の仕切りは上 / 下の位置で決める
      if(k <= 0) return;
      ctx.fillStyle = this._rgba(this._colOf(F, r.color), 1);
      if(r.w >= r.h){ const h = Math.max(1, r.h*k); ctx.fillRect(r.x, r.y + (r.h - h)/2, r.w*g, h); }
      else { const w = Math.max(1, r.w*k); ctx.fillRect(r.x + (r.w - w)/2, r.y, w, r.h*g); }
    });
  },

  // 1 ブロックの字を描く。items = [{ch, x, y, col, key}] (ブロックのローカル座標)。
  // 輪郭は字ごとのストロークではなく、塗りの面を合成した外形線: 太さ 2 倍のストロークを描いてから同じ字の塗りで内側を抜く
  _drawItems(ctx, b, items){
    if(!items.length) return;
    const P = this.P;
    const sty = b.role === 'main' ? (P.mainStyle|0) : (b.role === 'num' ? (P.numStyle|0) : 0);   // 0 = Fill / 1 = Outline / 2 = Outline + キーワードだけ Fill
    const isOut = it=> sty === 1 || (sty === 2 && !it.key);
    ctx.save();
    const L = this._lay;
    if(L && (b.role === 'main' || b.role === 'sub') && (L.clipY0 > -1e8 || L.clipY1 < 1e8)){   // 帯 (Top / Bottom Rule) の部分には字を打たない
      ctx.beginPath(); ctx.rect(-1e5, Math.max(-1e5, L.clipY0), 2e5, Math.min(2e5, L.clipY1 - Math.max(-1e5, L.clipY0))); ctx.clip();
    }
    ctx.translate(b.x, b.y); if(b.rot) ctx.rotate(b.rot);
    ctx.font = b.font; ctx.textBaseline = 'alphabetic';
    if(items.some(isOut)){
      const W = this.cv.width, H = this.cv.height;
      if(!this._ol){ this._ol = document.createElement('canvas'); this._olx = this._ol.getContext('2d'); }
      const ol = this._ol, ox = this._olx;
      if(ol.width !== W || ol.height !== H){ ol.width = W; ol.height = H; }
      ox.setTransform(1, 0, 0, 1, 0, 0); ox.clearRect(0, 0, W, H);
      ox.setTransform(ctx.getTransform());
      ox.font = b.font; ox.textBaseline = 'alphabetic';
      ox.lineWidth = 2*Math.max(1, b.px*0.03*((b.role === 'num' ? P.numStroke : P.stroke)/100)); ox.lineJoin = 'round';   // 番号は Number Stroke
      ox.globalCompositeOperation = 'source-over';
      for(const it of items) if(isOut(it)){ ox.strokeStyle = this._rgba(it.col, 1); ox.strokeText(it.ch, it.x, it.y); }
      ox.globalCompositeOperation = 'destination-out';
      ox.fillStyle = '#000';
      for(const it of items) ox.fillText(it.ch, it.x, it.y);
      ox.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(ol, 0, 0); ctx.restore();
    }
    for(const it of items) if(!isOut(it)){ ctx.fillStyle = this._rgba(it.col, 1); ctx.fillText(it.ch, it.x, it.y); }
    ctx.restore();
  },

  // ブロックの字を、打ち始めからの時間 t で並べて描く (隠れ → スクランブル → 確定、消すときは逆)。戻り値 = 確定した字数
  _blockItems(F, b, t, ser, eraseT, D, out){
    const P = this.P, items = [];
    let typed = 0;
    const kin = b.role === 'main' ? this._dz(P.kinetic/100) : 0, bInt = Math.floor(F.T);
    for(const c of b.chars){
      const a0 = (c.g - F.lead)/F.rate, f0 = c.g/F.rate + F.scr;
      let st = t < a0 ? 0 : (t < f0 ? 1 : 2);
      if(st === 2) typed++;
      if(eraseT >= 0){
        if(P.erase === 'cut') st = eraseT < 0.25 ? 1 : 0;
        else { const e0 = (c.g/Math.max(1, D.N))*D.er*0.6;   // 消す拍数のうち 6 割で頭から順に崩し、残りで消し切る
          if(P.erase === 'wipe'){ if(eraseT > e0) st = 0; }
          else if(eraseT > e0 + D.er*0.4) st = 0; else if(eraseT > e0) st = 1; }
      }
      if(out && c.g === out.curG && !out.cur && (b.role === 'main' || b.role === 'sub')) out.cur = { b, x:c.x, y:c.y };
      if(st === 0 || c.space) continue;
      const dx = kin > 0 ? this._kinDx(F, c.line, bInt, kin, ser) : 0;
      if(st === 1) items.push({ ch:F.set[Math.floor(this._hash(c.g, F.tick, ser)*F.set.length) % F.set.length], x:c.x + dx, y:c.y, col:F.col.scr, key:c.key });
      else items.push({ ch:c.ch, x:c.x + dx, y:c.y, col:(eraseT < 0 && t - f0 < F.flashB) ? F.col.scr : (c.key ? F.col.accent : this._colOf(F, b.color)), key:c.key });
    }
    this._drawItems(this.ctx, b, items);
    return typed;
  },
  // Kinetic: 行ごとに拍でグリッドの段ずつ横へ滑る
  _kinDx(F, line, bInt, kin, ser){
    const L = this._lay;
    const e = F.beatMode ? Math.min(1, F.bph*4) : 1;
    const from = Math.round((this._hash(line + 1, bInt - 1, ser) - 0.5)*4), to = Math.round((this._hash(line + 1, bInt, ser) - 0.5)*4);
    return (from + (to - from)*(1 - Math.pow(1 - e, 3))) * (L.colW + L.gut) * kin * 0.5;
  },

  // ── Quote: 引用を 1 本ずつ打つ → Hold → 消す → 次の引用 ──
  _renderQuote(F){
    const P = this.P, ctx = this.ctx, list = F.list, T = F.T;
    const hold = Math.max(0, +P.hold || 0);
    if(!this._q || this._restart || this._q.n !== list.length){
      const idx = (this._q && !this._restart && this._q.n === list.length) ? this._q.idx : (P.order > 0 ? this._pick(-1, list.length) : 0);
      this._q = { idx, t0:T, serial:++this._serial, n:list.length };
      this._restart = false;
    }
    const every = +P.layoutEvery || 0, step = every > 0 ? Math.floor(T/every) : 0;   // 拍の頭でパッと組み替える (0 = 引用ごと)
    const dur = (L)=>{ const typeD = (L.N - 1)/F.rate + F.scr; const er = P.erase === 'cut' ? 0.25 : Math.max(0.25, +P.eraseBeats || 1); return { N:L.N, typeD, er, all:typeD + hold + er }; };
    let L;
    for(let guard=0; guard<8; guard++){
      L = this._layoutFor(F, list[this._q.idx % list.length], this._q.idx, this._q.serial, step);
      if(T - this._q.t0 < dur(L).all) break;
      this._q = { idx:this._pick(this._q.idx, list.length), t0:this._q.t0 + dur(L).all, serial:++this._serial, n:list.length };
    }
    const D = dur(L), t = T - this._q.t0, eraseT = t - D.typeD - hold, ser = this._q.serial;
    { const mb = L.blocks.find(b=>b.role === 'main' && !b.rot); this._drawGrid(ctx, F, L, mb ? mb.lh : 0); }
    this._drawRules(ctx, F, L, Math.min(1, t/Math.max(0.5, Math.min(D.typeD, 4))) * (eraseT > 0 ? Math.max(0, 1 - eraseT/D.er) : 1));
    const out = { curG:Math.min(L.N, Math.floor(t*F.rate + F.lead)), cur:null };
    let typed = 0;
    for(const b of L.blocks) typed += this._blockItems(F, b, t, ser, eraseT, D, out);
    // カーソル (打っている間は点灯、打ち終えたら点滅)
    if(P.cursor > 0 && eraseT < 0){
      const lb = L.blocks.filter(b=>b.role === 'main' || b.role === 'sub').pop();
      const lc = lb && lb.chars[lb.chars.length - 1];
      if(out.cur) this._cursor(ctx, out.cur.b, out.cur.x, out.cur.y, out.cur.b.px, F.col.accent);
      else if(lc && Math.floor(T*2) % 2 === 0){ ctx.font = lb.font; this._cursor(ctx, lb, lc.x + ctx.measureText(lc.ch).width, lc.y, lb.px, F.col.accent); }
    }
    const prog = eraseT >= 0 ? Math.max(0, 1 - eraseT/D.er) : Math.min(1, t/Math.max(0.1, D.typeD));
    this._drawFoot(ctx, F, L, { prog, phase:eraseT >= 0 ? 'ERASE' : (t >= D.typeD ? 'HOLD ' : 'TYPE '), q:this._q.idx, typed, ser });
  },

  // ── Flow: 全引用を 1 本の長文につなぎ、同じ枠に延々と打ち続ける。枠が埋まったら行を上へ送る ──
  _renderFlow(F){
    const P = this.P, ctx = this.ctx, T = F.T;
    if(this._flowT0 == null || this._restart){ this._flowT0 = T; this._restart = false; this._fq = null; }
    const S = this._streamFor(F.list);
    const p = (T - this._flowT0)*F.rate;               // 打った字数 (通し)
    const cyc = Math.floor(p/S.len), i = Math.floor(p) - cyc*S.len;
    let seg = 0; while(seg + 1 < S.segs.length && S.segs[seg + 1].start <= i) seg++;
    const sg = S.segs[seg];
    const segSerial = cyc*S.segs.length + seg + 1;
    if(!this._fq || this._fq.serial !== segSerial) this._fq = { serial:segSerial, t0:T };
    const every = +P.layoutEvery || 0;   // 0 = 今打っている引用が替わるたびに組み替える
    const L = this._layoutFor(F, F.list[sg.q], sg.q, every > 0 ? 0 : segSerial, every > 0 ? Math.floor(T/every) : 0);
    this._drawGrid(ctx, F, L, this._flowLH || 0);
    this._drawRules(ctx, F, L, 1);
    // meta・番号・添えは、今打っている引用が替わった時点から打ち直す
    const tq = T - this._fq.t0;
    for(const b of L.blocks) if(b.role !== 'main') this._blockItems(F, b, tq, segSerial, -1, null, null);
    // 本文の枠: Layout の本文ブロックの位置・幅・高さを使い、文字の大きさは 4 行以上入るまで下げる
    const mb = L.blocks.find(b=>b.role === 'main');
    if(!mb) return;
    const boxH = mb.maxH || F.H*0.5;
    const lhf = mb.lhf * (P.leading/100);
    const px = Math.max(6, Math.min(mb.px0, boxH/((mb.minLines || 4)*lhf)));
    const font = P.weight + ' ' + Math.round(px) + 'px ' + this._ff();
    const lh = P.baseline > 0 && !mb.rot && !mb.noGrid ? this._snapLH(px*lhf, L.rowH) : px*lhf;
    let maxLines = Math.max(1, Math.floor(boxH/lh));
    this._flowLH = mb.rot ? 0 : lh;
    const Wr = this._wrapStream(S, font, mb.w, (mb.track != null ? mb.track : P.tracking/1000)*px, mb.breakAll);
    const lines = Wr.lines;
    let li = 0, lo = 0, hi = lines.length - 1;
    while(lo <= hi){ const mid = (lo + hi) >> 1; if(lines[mid].s <= i){ li = mid; lo = mid + 1; } else hi = mid - 1; }
    let fy = mb.y;
    if(P.baseline > 0 && !mb.rot && !mb.noGrid){ const y0 = L.topY; fy = y0 + Math.ceil((mb.y + px*0.8 - y0)/lh - 1e-6)*lh - px*0.8 + this._dz(P.baseShift)/100*lh; }   // Flow の枠もベースラインを刻みに乗せる
    if(!mb.rot) maxLines = Math.max(1, Math.min(maxLines, Math.floor((mb.y + boxH - fy)/lh + 1e-6)));   // ベースラインを刻みに乗せて下へずれた分、枠からはみ出さない行数に
    const frame = { x:mb.x, y:fy, rot:mb.rot, font, px, role:'main' };
    const items = [];
    const curG = Math.floor(p + F.lead), tt = p/F.rate;
    let cur = null;
    const kin = this._dz(P.kinetic/100), bInt = Math.floor(T);
    for(let k=0; k<maxLines; k++){
      let L2 = li - (maxLines - 1) + k, c2 = cyc;
      if(L2 < 0){ if(cyc === 0) continue; L2 += lines.length; c2 = cyc - 1; }
      const ln = lines[L2], y = px*0.8 + k*lh;
      const dx = kin > 0 ? this._kinDx(F, L2, bInt, kin, 0) : 0;
      for(let j=ln.s; j<ln.e; j++){
        const g = c2*S.len + j, x = Wr.x[j] - Wr.x[ln.s] + dx;
        if(g === curG && !cur) cur = { x, y };
        const a0 = (g - F.lead)/F.rate, f0 = g/F.rate + F.scr;
        if(tt < a0) break;
        const ch = S.g[j];
        if(/^\s$/.test(ch)) continue;
        const key = !!S.key[j];
        if(tt < f0) items.push({ ch:F.set[Math.floor(this._hash(g, F.tick, 0)*F.set.length) % F.set.length], x, y, col:F.col.scr, key });
        else items.push({ ch, x, y, col:(tt - f0 < F.flashB) ? F.col.scr : (key ? F.col.accent : F.col.ink), key });
      }
      if(!cur && L2 === li && curG >= c2*S.len + ln.e) cur = { x:Wr.x[ln.e] - Wr.x[ln.s] + dx, y };
    }
    this._drawItems(ctx, frame, items);
    if(P.cursor > 0 && cur) this._cursor(ctx, frame, cur.x, cur.y, px, F.col.accent);
    this._drawFoot(ctx, F, L, { prog:Math.min(1, (i - sg.start)/Math.max(1, sg.len)), phase:'FLOW ', q:sg.q, typed:Math.floor(p), ser:segSerial });
  },

  // Flow の文字列: 引用 (主の言語) を ' — ' でつなぐ。順番 / ランダム (Seed で並べ替え)。キーワードの位置も持つ
  _streamFor(list){
    const P = this.P;
    const key = list.map(q=>q.main).join('\u0001') + '|' + P.order + '|' + P.seed + '|' + P.upper + '|' + P.keyword;
    if(this._st && this._stKey === key) return this._st;
    const ord = list.map((_, i)=>i);
    if(P.order > 0){
      let s = ((P.seed|0)*2654435761 + 977) >>> 0;
      const rnd = ()=>{ s = (s*1664525 + 1013904223) >>> 0; return s/4294967296; };
      for(let i=ord.length - 1; i>0; i--){ const j = Math.floor(rnd()*(i + 1)); const tmp = ord[i]; ord[i] = ord[j]; ord[j] = tmp; }
    }
    const g = [], keyM = [], segs = [];
    for(const qi of ord){
      const q = list[qi];
      const gg = this._graphemes(P.upper > 0 ? q.main.toUpperCase() : q.main);
      const start = g.length;
      let kStart = -1, kLen = 0;
      if(P.keyword > 0 && q.key){
        const low = gg.map(c=>c.toLowerCase()), kk = this._graphemes(q.key.toLowerCase());
        for(let a=0; a + kk.length <= low.length; a++){ if(kk.every((c, b)=>low[a + b] === c)){ kStart = a; kLen = kk.length; break; } }
      }
      gg.forEach((c, k)=>{ g.push(c); keyM.push(kStart >= 0 && k >= kStart && k < kStart + kLen ? 1 : 0); });
      segs.push({ q:qi, start, len:gg.length });
      for(const c of ' — '){ g.push(c); keyM.push(0); }
    }
    this._stKey = key; this._wr = null;
    return (this._st = { g, key:keyM, segs, len:g.length });
  },
  // Flow の行割り: 字幅を 1 字ずつ測って足す (語の切れ目と和文の 1 字ごとで折る。行頭禁則の約物は前の行に残す)
  _wrapStream(S, font, maxW, track, breakAll){
    const key = font + '|' + maxW + '|' + track + '|' + (breakAll ? 1 : 0);
    if(this._wr && this._wr.st === S && this._wr.key === key) return this._wr;
    const ctx = this.ctx;
    ctx.font = font;
    const cache = new Map(), n = S.g.length, w = new Float32Array(n), x = new Float32Array(n + 1);
    for(let j=0; j<n; j++){ const c = S.g[j]; let v = cache.get(c); if(v == null){ v = ctx.measureText(c).width; cache.set(c, v); } w[j] = v + track; x[j + 1] = x[j] + w[j]; }
    const isCJK = c=>/[　-鿿＀-￯]/.test(c), noHead = /^[、。，．・：；！？」』）〕】ー…]$/;
    const lines = [];
    let s = 0, brk = -1;
    for(let j=0; j<n; j++){
      const c = S.g[j];
      if(c === ' ') brk = j + 1;
      else if((breakAll || isCJK(c)) && j > s && !noHead.test(c)) brk = j;
      if(x[j + 1] - x[s] > maxW && j > s){
        const e = (brk > s && brk <= j) ? brk : j;
        lines.push({ s, e });
        s = e; while(s < n && S.g[s] === ' ') s++;
        brk = -1;
      }
    }
    if(s < n) lines.push({ s, e:n });
    return (this._wr = { st:S, key, lines, x, w });
  },

  // 端の帯: ティッカー (概念語を途切れなく打つ) とゲージ (進み・カウンタ)
  _drawFoot(ctx, F, L, info){
    const P = this.P;
    if(!L.foot) return;
    const W = F.W, T = F.T, base = F.col.base, acc = F.col.accent;
    const px = L.smallPx, adv = px*0.64, y = L.footY + px*0.8;
    const both = P.ticker > 0 && P.gauge > 0;
    const tkW = both ? (W - 2*L.m)*0.5 : W - 2*L.m;
    ctx.font = P.weight + ' ' + Math.round(px) + 'px ' + this._ff();
    ctx.fillStyle = this._rgba(base, 1);
    const bw = L.footTop ? P.topRuleW : P.botRuleW;   // 端の帯の仕切り線: 帯が上なら Top Rule、下なら Bottom Rule
    if(bw > 0 && L.footLine != null){ const h = Math.max(1, L.ruleH*(bw/100)); ctx.fillRect(L.m, L.footLine - h/2, W - 2*L.m, h); }   // meta の仕切り線と同じ太さの基準 (縦の仕切りとつながる)
    const fw = P.gaugeW > 0 ? Math.max(1, px*0.08*(P.gaugeW/100)) : 0;
    if(P.ticker > 0){
      const S = this._ticker();
      const n = Math.max(4, Math.floor((tkW - adv*3)/(px*0.74)));   // 大文字の平均字幅で見積もる
      const pos = Math.floor(T * Math.max(0.5, +P.tickRate || 8));
      const st0 = pos - (pos % n);
      ctx.fillText('>', L.m, y);
      let x = L.m + adv*2;   // 字幅どおりに送る (位置は確定後の字で決め、スクランブル中も動かない)
      for(let j=0; j<=pos - st0; j++){
        const i = st0 + j, ch = S[i % S.length];
        const live = pos - i < 3;
        if(ch !== ' '){
          ctx.fillStyle = this._rgba(live ? F.col.scr : base, 1);
          ctx.fillText(live ? F.set[Math.floor(this._hash(i + 7777, F.tick, 0)*F.set.length) % F.set.length] : ch, x, y);
        }
        x += ctx.measureText(ch).width + px*0.04;
      }
      this._cursor(ctx, { px }, x + px*0.1, y, px, acc, P.cursor || 1);
    }
    if(P.gauge > 0){
      const x0 = both ? L.m + tkW + adv*2 : L.m, x1 = W - L.m;
      const prog = Math.max(0, Math.min(1, info.prog));
      const pad = (v, k)=> String(v).padStart(k, '0');
      const left = '|/-\\'[Math.floor(T*4) & 3] + ' ' + info.phase;
      const right = pad(Math.round(prog*100), 3) + '%  Q' + pad(info.q + 1, 2) + '/' + pad(F.list.length, 2) + '  ' + pad(info.typed % 10000, 4) + ' CHR  0x' + pad(((info.ser*4099 + info.typed*37 + Math.floor(T*8)) & 0xffff).toString(16).toUpperCase(), 4);
      ctx.fillStyle = this._rgba(base, 1);
      ctx.fillText(left, x0, y);
      const rw = ctx.measureText(right).width;
      ctx.fillText(right, x1 - rw, y);
      const bx0 = x0 + ctx.measureText(left).width + adv*1.5, bx1 = x1 - rw - adv*1.5;
      const nSeg = Math.max(4, Math.floor((bx1 - bx0)/(adv*0.9)));
      const sw = (bx1 - bx0)/nSeg, fill = Math.round(prog*nSeg);
      for(let k=0; k<nSeg; k++){
        const on = k < fill;
        ctx.fillStyle = this._rgba(on && k === fill - 1 && prog < 1 ? acc : base, 1);
        if(on) ctx.fillRect(bx0 + k*sw, y - px*0.72, sw*0.72, px*0.78);
        else if(fw > 0) ctx.fillRect(bx0 + k*sw, y - px*0.02 - fw/2, sw*0.72, fw);
      }
    }
  },

  // カーソル: 1 = ブロック / 2 = 縦棒 / 3 = 下線
  _cursor(ctx, b, x, y, px, col, kind){
    const k = kind || this.P.cursor, cw = px*0.55;
    ctx.save();
    ctx.fillStyle = this._rgba(col, 1);
    if(b.rot != null && b.x != null){ ctx.translate(b.x, b.y); if(b.rot) ctx.rotate(b.rot); }
    if(k === 1) ctx.fillRect(x, y - px*0.78, cw, px*0.9);
    const lw = Math.max(1, px*0.08*(this.P.cursorW/100));
    if(k === 2) ctx.fillRect(x, y - px*0.8, lw, px*0.95);
    else if(k !== 1) ctx.fillRect(x, y + px*0.08, cw, lw);
    ctx.restore();
  },

  // ティッカーの文字列: ドゥルーズの概念語を引用ごとの seed で並べ替えてつなぐ
  _ticker(){
    const key = this.P.seed|0;
    if(this._tk && this._tkKey === key) return this._tk;
    let s = (key*2654435761 + 12345) >>> 0;
    const rnd = ()=>{ s = (s*1664525 + 1013904223) >>> 0; return s/4294967296; };
    const a = GT_CONCEPTS.slice();
    for(let i=a.length - 1; i>0; i--){ const j = Math.floor(rnd()*(i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    this._tkKey = key;
    return (this._tk = a.join(' / ') + ' / ');
  },
};

// PDefaults はスクリプト読込時に確定させる (init より先に state 復元が走るため)
GlitchType.PDefaults = JSON.parse(JSON.stringify(GlitchType.P));
GlitchType.FONTS = GT_FONTS;
GlitchType.CHARSETS = GT_CHARSETS;
GlitchType.LAYOUTS = GT_LAYOUTS;
GlitchType.BLOCKS = GT_BLOCKS;

// Params パネルのホバー説明・効かないパラメータのグレー表示
GlitchType.PARAM_HELP = {
  lang:'主に打つ言語', sub:'添える言語 (小さく組む)。None で添えない', order:'次の引用の選び方',
  author:'meta の帯に出す著者名', custom:'空ならドゥルーズの引用。貼った文章を行 (段落) ごとに区切って打つ。長文は Flow で延々と打ち続ける',
  font:'書体。Aratana は和文を秀英角ゴ銀で組む', weight:'太さ (Aratana の可変軸 200〜700)',
  layout:'組み方。Giant は 1 カラムで画面いっぱいの大きさ / Word は 1 語を画面の幅いっぱいに / Bleed は画面からはみ出す大きさで端を切る / Poster は 1 語 1 行で行ごとに幅いっぱい / Tower は縦に倒して高さいっぱい / Rotate は縦に倒して上から下へ。Auto は組み替えのたびに引き直す', layoutEvery:'グリッドと組み方を組み替える拍数。Quote は引用を書き終わるまで替えない', layoutVals:'Layout ごとの保存値。Layout を選んで Save Layout で保存し、Auto のとき引いた Layout の値で描く', flow:'Flow = 全部の文を 1 本の長文として同じ枠に延々と打ち続ける (枠が埋まったら行を上へ送る)。Quote = 1 本ずつ打って消す', size:'本文の大きさ', leading:'行送り', tracking:'字間 (1/1000 em)',
  cols:'グリッドの段数。Auto は引用ごとに引き直す', margin:'画面の余白。0 で余白なし (画面の端まで組む)', upper:'主の文を大文字にする',
  rate:'打つ速さ (字/拍)', scramble:'1 字がスクランブルしてから確定するまでの拍数', lead:'カーソルの先でスクランブルを始める字数',
  scrHz:'スクランブルの字の入れ替え (回/秒)', charset:'スクランブルに使う字', flash:'確定した瞬間に Scramble 色で光る長さ',
  hold:'打ち終えてから消すまでの拍数', erase:'消し方', eraseBeats:'消し終えるまでの拍数', cursor:'カーソルの形',
  meta:'番号・著者・出典・罫線を組む', keyword:'キーワードを Accent 色にする', grid:'グリッド線の濃さ',
  kinetic:'本文の行が拍ごとにグリッドの段ずつ横へ滑る量',
  ink:'文字の色 (本文と添え)', paper:'背景の色 (Slot B では透ける)', accent:'キーカラー: キーワード・番号・強調の罫線・カーソル・ゲージの先頭', base:'ベースカラー: 著者・出典・罫線・ゲージ・ティッカー・グリッド線', scrColor:'スクランブル中の字の色',
  topRuleW:'上の帯の仕切り線の太さ (著者・出典の帯か端の帯か、上にあるほう)', botRuleW:'下の帯の仕切り線の太さ', ruleW:'段の仕切り線 (Base 色) の太さ', baseShift:'ベースラインを刻みに対して上下にずらす量 (刻みの %、+ で下へ)。Save Layout で Layout ごとに保存できる', baseline:'On で本文と添えの行送りをグリッドの行の高さに合わせ (整数で割るか整数倍)、ベースラインをその刻みに乗せる', bandAlign:'帯の仕切り線 (Top / Bottom Rule) をどこに通すか。Cell = 帯をグリッドの最初 / 最後の行に入れ、その行の上下中央 / Line = 行線の上 / Free = 字の大きさで決める', ruleAlign:'段の仕切り線をどこに通すか。Column = カラムの中心 / Gutter = 溝の中心 / Center = 画面の左右ど真ん中。上下の帯の線までつながる', accentW:'強調の帯 (Key 色) の太さ', gaugeW:'ゲージの空き目盛りの太さ', gridW:'グリッド線の太さ', cursorW:'カーソル (Bar / Underscore) の太さ',
  mainStyle:'本文を塗るか輪郭か。Key Fill は輪郭でキーワードだけ塗る', numStyle:'番号を塗るか輪郭か', stroke:'本文の輪郭の太さ (Main Style が Outline / Key Fill のとき)', numStroke:'番号の輪郭の太さ (Number Style が Outline のとき)',
  gauge:'端の帯にターミナル風のゲージ (進み・番号・字数のカウンタ)', ticker:'端の帯にドゥルーズの概念語を途切れなく打つ行', tickRate:'ティッカーを打つ速さ (字/拍)',
  seed:'グリッドと組み方、ティッカーの並びの乱数',
  depth3D:'On で文字・罫線を深度として出し、3D FX で持ち上げる。Off は平らな紙', depth:'3D FX で文字・罫線を持ち上げる高さ',
};
GlitchType.paramOn = function(key){
  const P = this.P;
  if(key === 'sub' || key === 'lang') return !String(P.custom || '').trim();
  if(key === 'hold' || key === 'erase' || key === 'eraseBeats') return !(P.flow > 0);
  if(key === 'baseShift') return P.baseline > 0;
  if(key === 'depth') return P.depth3D > 0;
  if(key === 'stroke') return P.mainStyle > 0;
  if(key === 'numStroke') return P.numStyle > 0;
  if(key === 'tickRate') return P.ticker > 0;
  if(key === 'lead' || key === 'scrHz' || key === 'charset' || key === 'flash') return P.scramble > 0 || key === 'lead';
  return true;
};
