/* ================= Type Deformer — Canvas (第 1 段階) =================
 * Look をスタンプのように画面に複数置いて、一枚の構成を作る。
 *   - スタンプ = TextDeform の分身 (Object.create(TextDeform))。Look の値 (TD_LOOK_KEYS) と文字だけを個別に持ち、
 *     それ以外 (共通パレット・共通フォント・Rhythm・縦横比など) は本体の P をそのまま読む (分身の P は本体の P を親にした object)
 *   - 文字の伸び縮み・Operator・Effects は分身ごとに毎フレーム動く。Surface / Vector 3D は分身では描かない
 *   - 主役スタンプ (hero: true) と焼き付けスタンプ (img: 透過 WebP の data URL) は、前の保存データにあれば描く (置く UI は Full Look に役割が重なるのでやめた)。
 *     主役 = 本体の Look を Surface・Vector 3D ごと生きたまま描く (TextDeform._renderHero)
 *   - 置き方: ステージをクリック = いまの Look (または Look Pool からランダム) を押す / 押したままドラッグ = 連射 /
 *     スタンプをドラッグ = 移動 (前面へ) / ホイール = 大きさ / Shift+ホイール = 回転 / Shift+クリック = 削除
 *   - 拍 (第 3 段階、Manga の BEAT と同じ考え方): canvasAutoAdd 拍ごとに自動で押す / canvasAutoSwap 拍ごとにランダムな分身の Look を差し替える /
 *     canvasAutoClear 拍ごとに分身を一掃 (主役と焼き付けは残す)。どれも 0 = Off。新しいスタンプは弾むように出てくる (Manga の easeOutElastic)
 *   - Look の完全再現 (P.canvasFull): Surface / Vector 3D を持つスタンプは、本体にそのスタンプの Look を一時的に当てて
 *     主役用の透明キャンバスに描き、Surface の絵が届いたら焼き付ける (full)。bake = 置いたとき (A) だけ / live = さらに
 *     P.canvasFullEvery ms ごとに 1 枚ずつ順番に描き直す (B。fps が 45 を切ったら間引く) / off = 分身のまま。
 *     本体を切り替えているあいだ、主役スタンプは直前の絵を出す
 *   - 出るタイミング (P.canvasTiming): sync = 今どおりまとめて出る / gun = Manga のマシンガンと同じく、拍を canvasGunDiv 分割した
 *     刻みごとに 1 枚ずつ順に出す (レイアウトを組む・組み替える・呼び出すたびに全スタンプを撃ち直す)。順番 = canvasGunOrder
 *     (layout = 大きい順 / random / sweep = 左から)。拍の刻みは floor(拍 × 分割) が変わるたび (Manga.tickBurst と同じ)
 *   - ばらつき (var): P.cv* (大きさ・回転・位置・伸縮・縦横比・字間・行送り・不透明度・色相・拍への反応・漂い・速さ)。
 *     スタンプの seed から決まる -1..1 の値 × 幅。伸縮・字間・行送りは分身の P に、それ以外は描くときに掛ける
 *   - 状態: TextDeform.P.canvasOn / canvasStamps ([{ look, text, x, y, s, rot, z, seed }]。x, y = 画面の 0..1) / canvasSource / canvasMax。
 *     Visual の Save・状態の復元・Undo は P と一緒に読み書きする。構成の保存は store「tdcanvas」(保存のたびに世代が残る)
 * ==================================================================== */
(function(){
'use strict';
if(typeof TextDeform === 'undefined') return;
const TD = TextDeform;
const clone = v => JSON.parse(JSON.stringify(v));
const BASE = 0.42;   // 大きさ 1 のスタンプの幅・高さ (画面に対する比)
const STAMP_PIXEL_BUDGET = 24e6;   // 分身・Full Look の合計画素数 (余白込み)。表示サイズは保ち、描画解像度だけを落とす (12M では 32 枚で文字がぼけた)
const rnd = (a, b) => a + Math.random()*(b - a);
// 大小の階層: 大 1・中 2〜3・小の残り (どのレイアウトもこの順に大きい位置から埋める)
const tier = (i, n) => i === 0 ? 1 : (i <= Math.min(3, Math.ceil(n/3)) ? 0.62 : 0.42);
// ワンボタンのレイアウト。n 枚分の位置 { x, y, s, rot } を大きい順に返す (x, y = 画面の 0..1、s = 大きさ)
// C Layout = Random (cycle) の入れ替え周期の候補 (拍。beat xA を掛けた拍で数える)
const CYCLE_BEATS = [2, 4, 8, 16];
const LAYOUTS = {
  hero(n){   // 大 1 を大胆にずらして (端に寄せる・一部はみ出す。真ん中のこともある)、残りは空いている所へ
    const spots = [[0.5, 0.5], [0.18, 0.5], [0.82, 0.5], [0.5, 0.2], [0.5, 0.82], [0.22, 0.25], [0.78, 0.75], [0.08, 0.7], [0.92, 0.3], [0.35, 0.9]];
    const sp = spots[Math.floor(Math.random()*spots.length)];
    const big = { x: sp[0] + rnd(-0.06, 0.06), y: sp[1] + rnd(-0.06, 0.06), s: rnd(1.5, 2.2), rot: rnd(-8, 8) }, out = [big];
    for(let i = 1; i < n; i++){
      const s = tier(i, n)*1.1, p = TDCanvas._emptiest(out, s);
      out.push({ x: Math.min(0.9, Math.max(0.1, p.x)), y: Math.min(0.88, Math.max(0.12, p.y)), s, rot: rnd(-14, 14) });
    }
    return out;
  },
  grid(n){   // 格子 (先頭の 1 枚だけ 2 マス分の大きさ)
    const cols = Math.max(2, Math.ceil(Math.sqrt(n*1.7))), rows = Math.max(1, Math.ceil((n + 1)/cols));
    const cw = 0.9/cols, ch = 0.86/rows, s = Math.min(cw/BASE, ch/BASE)*0.92, out = [];
    const cells = [];
    for(let r = 0; r < rows; r++) for(let c = 0; c < cols; c++) cells.push({ x: 0.05 + cw*(c + 0.5), y: 0.07 + ch*(r + 0.5) });
    out.push({ x: (cells[0].x + cells[1].x)/2, y: cells[0].y, s: s*1.8, rot: 0 });
    for(let i = 2; out.length < n && i < cells.length; i++) out.push({ x: cells[i].x, y: cells[i].y, s, rot: 0 });
    while(out.length < n) out.push({ x: rnd(0.15, 0.85), y: rnd(0.15, 0.85), s: s*0.8, rot: 0 });
    return out;
  },
  diagonal(n){   // 左上から右下への対角線 (真ん中が大きく、端ほど小さい)
    const out = [], ang = rnd(-24, -14);
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.abs(a - (n - 1)/2) - Math.abs(b - (n - 1)/2));
    for(const i of order){
      const t = n > 1 ? i/(n - 1) : 0.5, d = Math.abs(t - 0.5)*2;
      out.push({ x: 0.12 + t*0.76, y: 0.16 + t*0.68, s: 1.25 - d*0.75, rot: ang + rnd(-3, 3) });
    }
    return out;
  },
  frame(n){   // 縁に並べて中央を空ける (先頭は中央に大きく)
    const out = [{ x: 0.5, y: 0.5, s: 1.1, rot: 0 }], m = n - 1;
    for(let i = 0; i < m; i++){
      const t = i/m*4, side = Math.floor(t), f = t - side;
      const p = side === 0 ? [0.1 + f*0.8, 0.12] : side === 1 ? [0.9, 0.12 + f*0.76] : side === 2 ? [0.9 - f*0.8, 0.88] : [0.1, 0.88 - f*0.76];
      out.push({ x: p[0], y: p[1], s: tier(i + 1, n)*0.95, rot: side % 2 ? 90*(side === 1 ? 1 : -1) : 0 });
    }
    return out;
  },
  cascade(n){   // 大→小へ重ねてずらす
    const out = [], dx = rnd(0.07, 0.1)*(Math.random() < 0.5 ? 1 : -1), x0 = dx > 0 ? 0.3 : 0.7;
    for(let i = 0; i < n; i++) out.push({ x: x0 + dx*i, y: 0.32 + 0.065*i, s: Math.max(0.35, 1.35 - i*0.14), rot: -5 + i*1.5 });
    return out;
  },
  scatter(n){   // 余白を保って散らす (大きいものから、既存と一番離れた候補へ)
    const out = [];
    for(let i = 0; i < n; i++){
      const s = tier(i, n)*(i === 0 ? 1.3 : 1.1);
      out.push(Object.assign(TDCanvas._emptiest(out, s), { s, rot: rnd(-16, 16) }));
    }
    return out;
  },
  free(n){   // Random (自由配置): 大きさ・角度・位置を自由に。重なりすぎと画面外ばかりにならないよう、候補のうち既存から離れた所を選ぶ (少しのはみ出しは許す)
    const out = [];
    for(let i = 0; i < n; i++){
      const s = Math.exp(rnd(Math.log(0.35), Math.log(1.7))), p = TDCanvas._freeSpot(out, s);
      out.push({ x: p.x, y: p.y, s, rot: rnd(-45, 45) });
    }
    return out.sort((a, b) => b.s - a.s);   // 大きいものを奥に
  },
  // ---- 構成主義 (ロトチェンコ / リシツキー / ステンベルク兄弟のポスターの考え方) の配置 ----
  slash(n){   // 強い対角線 (30〜45°): 大 1 を対角の上に、残りを同じ角度で並べ、太い帯を通す
    const ang = -rnd(30, 45)*(Math.random() < 0.5 ? 1 : -1), r = ang*Math.PI/180, out = [];
    const cx = rnd(0.42, 0.58), cy = rnd(0.42, 0.58), dx = Math.cos(r), dy = Math.sin(r)*1.6;
    out.push({ x: cx, y: cy, s: 1.7, rot: ang });
    for(let i = 1; i < n; i++){
      const t = (i % 2 ? 1 : -1)*(0.17 + 0.07*Math.floor((i - 1)/2));
      out.push({ x: cx + dx*t, y: cy + dy*t*0.6 + 0.1*(i % 2 ? 1 : -1), s: tier(i, n)*0.9, rot: ang });
    }
    return out;
  },
  scale(n){   // 極端な大小: 画面からはみ出すほどの大 1 と、隅の小さな字
    const sx = Math.random() < 0.5 ? 0.38 : 0.62, out = [{ x: sx, y: 0.55, s: 2.4, rot: rnd(-6, 6) }];
    const corners = [[0.86, 0.12], [0.12, 0.88], [0.88, 0.86], [0.14, 0.14], [0.6, 0.1], [0.4, 0.92]];
    for(let i = 1; i < n; i++){ const c = corners[(i - 1) % corners.length]; out.push({ x: c[0], y: c[1], s: i === 1 ? 0.55 : 0.32, rot: 0 }); }
    return out;
  },
  cross(n){   // 縦組み × 横組み の交差: 横の大と縦の大を中心からずれた点で交差させる
    const px = rnd(0.36, 0.44), py = rnd(0.36, 0.46), out = [{ x: px + 0.12, y: py, s: 1.5, rot: 0 }, { x: px, y: py + 0.2, s: 1.3, rot: -90 }];
    for(let i = 2; i < n; i++) out.push({ x: px + 0.3 + 0.07*(i - 2), y: py + 0.18 + 0.1*(i - 2), s: tier(i, n)*0.8, rot: i % 2 ? -90 : 0 });
    return out;
  },
  radial(n){   // 放射: 中心からずらした一点から外へ (字は放射の向きに回す)、中心に円
    const ox = rnd(0.3, 0.38), oy = rnd(0.55, 0.65), a0 = rnd(-80, -60), span = rnd(110, 150), out = [];
    for(let i = 0; i < n; i++){
      const a = (a0 + span*(n > 1 ? i/(n - 1) : 0.5))*Math.PI/180, d = i === 0 ? 0.3 : 0.24 + 0.1*(i % 3);
      out.push({ x: ox + Math.cos(a)*d*1.1, y: oy + Math.sin(a)*d*1.5, s: i === 0 ? 1.25 : tier(i, n)*0.85, rot: a*180/Math.PI });
    }
    return out;
  },
  wedge(n){   // くさびと円 (「赤いくさびで白を打て」): 赤いくさびが円へ刺さり、字はくさびに沿う
    const cx = rnd(0.62, 0.7), cy = rnd(0.42, 0.52), ang = rnd(-15, 5), out = [{ x: cx - 0.3, y: cy + 0.05, s: 1.35, rot: ang }];
    for(let i = 1; i < n; i++) out.push({ x: cx - 0.28 + 0.1*(i % 4), y: cy + (i % 2 ? -0.22 : 0.25) + 0.04*Math.floor(i/4), s: tier(i, n)*0.75, rot: i % 3 === 0 ? -90 : ang });
    return out;
  },
  stairs(n){   // 階段状: 斜めに一段ずつ下がり、だんだん小さく
    const up = Math.random() < 0.5, ang = up ? -30 : 30, out = [];
    for(let i = 0; i < n; i++){
      const t = n > 1 ? i/(n - 1) : 0;
      out.push({ x: 0.16 + t*0.68, y: up ? 0.78 - t*0.56 : 0.22 + t*0.56, s: Math.max(0.35, 1.4 - i*0.15), rot: ang });
    }
    return out;
  }
};

const TDCanvas = {
  _inst: new Map(),   // スタンプ (canvasStamps の要素) → 分身
  _drag: null, _gunAt: 0, ms: 0,
  saved: null,
  active(){ return !!TD.P.canvasOn; },
  stamps(){ return Array.isArray(TD.P.canvasStamps) ? TD.P.canvasStamps : (TD.P.canvasStamps = []); },
  max(){ return Math.max(1, Math.min(32, +TD.P.canvasMax || 12)); },

  // 全枚数の余白込みの面積から共通倍率を決める。焼き付けも同じ寸法を使う。
  // 下げるのは即時、戻すのは余裕ができてから。0.125 刻み (下限 0.5) で再確保の往復を防ぐ。
  _pixelQ: 1,
  _prepareResolution(W, H, now){
    let pixels = 0;
    for(const [st, inst] of this._inst){
      if(inst.img) continue;   // 保存済み画像は元画像の解像度を使う
      const es = this._es(st), sw0 = W*BASE*es;
      const sw = Math.max(16, Math.min(1280, Math.round(sw0))), sh = Math.max(16, Math.min(1280, Math.round(H*BASE*es)));
      // 1280px で頭打ちになった分は、描くときに拡大して見た目の大きさを保つ。基準は「今までの描き方 (st.s で頭打ち) × Var Size」なので、Var Size 0 なら 1 (従来と同じ)
      const over = Math.max(16, Math.min(1280, W*BASE*st.s))*(es/st.s)/sw;
      const full = this._needsFull(st);
      let pf;
      if(full && (inst.full || now - (inst._born || 0) < 1500)){
        pf = inst.full ? inst.fullPf || 1 : Math.min(4, Math.max(1, inst._pf || Math.max(+inst.P.stretchX || 1, +inst.P.stretchY || 1)*1.3));
      } else {
        const cur = inst._pf || 1, needObj = inst.hero ? TD : inst;
        const want = needObj._needPf > 0 ? Math.min(4, Math.max(1, needObj._needPf*cur*1.08)) : cur;
        const step = Math.min(4, Math.ceil(want*4)/4);
        pf = inst._pf = step > cur ? step : (want < cur - 0.5 ? step : cur);
        // Full を Off にしたあとの、もう描かない焼き付けを抱えない。
        if(inst.full){ this._giveCanvas(inst.full); inst.full = null; }
      }
      const r = inst._raster || (inst._raster = {});
      Object.assign(r, { sw, sh, pf, full, over });
      // 通常描画の 16px 切り上げ分も予算に入れる。
      pixels += Math.ceil(sw*pf/16)*16 * Math.ceil(sh*pf/16)*16;
    }
    const limit = Math.min(1, Math.sqrt(STAMP_PIXEL_BUDGET/Math.max(1, pixels)));
    // 0.125 刻み。ふだんは半分の解像度まで (それ以下は文字が目に見えてぼける) で収まるが、それでも上限を超えるときは 1/4 まで下げて上限を守る
    let q = Math.max(0.25, Math.floor(limit*8)/8);
    // 上げるのは余裕があり、かつ最後に下げてから 4 秒たってから (枚数の入れ替えで 0.5⇄1 を数秒ごとに往復し、そのたび全スタンプを確保し直していた)
    if(q > this._pixelQ && (pixels*q*q > STAMP_PIXEL_BUDGET*0.85 || now - (this._pixelQDownAt || 0) < 4000)) q = this._pixelQ;
    if(q < this._pixelQ) this._pixelQDownAt = now;
    this._pixelQ = q;
    for(const [st, inst] of this._inst){
      const r = inst._raster; if(inst.img || !r) continue;
      const scale = q*Math.min(1, 4096/Math.max(r.sw*r.pf, r.sh*r.pf));   // 1 枚の長辺は 4096px まで (2048 では大きなスタンプに余白が付くと 0.4 倍まで落ちてぼけた。全体は STAMP_PIXEL_BUDGET が抑える)
      // 制限中は切り下げ、16px の切り上げで上限を超えないようにする。
      const size = x => Math.max(16, q < 1 ? Math.floor(x*scale/16)*16 : (r.full ? Math.round(x*scale) : Math.ceil(x*scale/16)*16));
      r.pw = size(r.sw*r.pf); r.ph = size(r.sh*r.pf);
      // まだ表示しない分身に、プールから来た大きな描画メモリを残さない。
      if(inst._stamp && !inst.full && (this._gunHidden.has(st) || r.full && now - (inst._born || 0) < 1500)){
        if(inst.canvas.width || inst.canvas.height){ inst.canvas.width = 0; inst.canvas.height = 0; }
      }
      if(r.full && inst.full){
        // 縮小は焼き直しを待たず適用。大きい旧画像を抱えたまま上限を超え続けない。
        if(inst.full.width*inst.full.height > r.pw*r.ph){
          const old = inst.full, cv = inst.canvas;
          cv.width = r.pw; cv.height = r.ph;
          inst.ctx.drawImage(old, 0, 0, cv.width, cv.height);
          inst.full = cv; inst.canvas = old; inst.ctx = old.getContext('2d');
          inst.fullS = this._es(st);   // 縮めた絵の大きさ。ここからまた大きくなったら下で焼き直す
        }
        // 焼いたときより 15% 以上大きくなった (Auto Layout・Jump・ホイールなど) なら、引き伸ばしてぼけたままにせず先頭で焼き直す
        // (順番の焼き直しは fps が低いと間引かれるので、それを待たない)
        if(inst.fullS && this._es(st) > inst.fullS*1.15 && inst._grewFor !== this._es(st)){
          inst._grewFor = this._es(st);
          if(!this._bake || this._bake.st !== st) this._enqueue(st, true);
        }
        // 焼き付け済みの分身キャンバスは描かれない。プールから来た大きな箱も解放する。
        if(inst.canvas.width || inst.canvas.height){ inst.canvas.width = 0; inst.canvas.height = 0; }
        // 倍率の段が焼いたときより上がったときだけ予約 (下がったときは上の縮小で足りる)。毎フレーム列へ入れ直さない。
        if(q > (inst._fullPixelQ || 0) && inst._queuedPixelQ !== q){
          inst._queuedPixelQ = q;
          if(!this._bake || this._bake.st !== st) this._enqueue(st, false);
        }
      }
    }
  },

  // ---- 分身 ----
  _make(st){
    const o = this._makeInner(st);
    o._born = performance.now();   // 出現のアニメ (弾む)
    if(this._needsFull(st)) this._enqueue(st, true);   // 置いたらすぐ Look を焼き付ける (A)
    return o;
  },
  // ---- Look の完全再現 (焼き付け) ----
  _fullMode(){ const m = TD.P.canvasFull; return m === 'off' || m === 'bake' ? m : 'live'; },
  // Surface / Vector 3D があり、分身だけでは Look を再現できないスタンプ
  _needsFull(st){
    if(this._fullMode() === 'off' || st.hero || st.img || typeof TDLooks === 'undefined') return false;
    if(TD.P.vecMode && TD.P.vecMode !== 'off') return true;
    const L = TDLooks.get(st.look); if(!L) return false;
    if(L.kind === 'f') return (L.item.operators || []).length > 0;
    return !!(L.item.surf && L.item.surf.enabled);
  },
  _bakeQ: [], _bake: null, _lastBakeEnd: 0, _fpsEma: 60, _rr: 0,
  // 焼き付けの順番待ち: 消えたスタンプは外し、置いているスタンプの数より長くしない (前は消えたスタンプが列の後ろに溜まり続けていた)
  _enqueue(st, front){
    const live = new Set(this.stamps());
    const q = this._bakeQ = this._bakeQ.filter(x => x !== st && live.has(x));
    if(front) q.unshift(st); else q.push(st);
    if(q.length > live.size) q.length = live.size;
  },
  // 2D キャンバスの使い回し。スタンプの小キャンバスと焼き付けは作り捨てず、ここへ返して次に使う
  // (Auto Swap などで毎秒 10 枚ほど作り捨てていて、GC までの間 GPU 側の描画メモリが溜まり、メモリの少ない機体でコンテキストが失われていた)
  _pool: [],
  _takeCanvas(){ return this._pool.pop() || document.createElement('canvas'); },
  // 箱の中身は合計 16M 画素まで (大きな焼き付けを何枚も抱えたままにすると、それ自体が GPU メモリを圧迫する)
  _giveCanvas(c){
    if(!c) return;
    const px = this._pool.reduce((a, x) => a + x.width*x.height, 0);
    if(this._pool.length < 16 && px + c.width*c.height <= 16e6) this._pool.push(c);
    else { c.width = 0; c.height = 0; }   // 余ったものはすぐ描画メモリを手放す
  },
  // 本体の Look (値・文字・Surface) を控える / 戻す
  _saveMain(){
    const P = TD.P, style = {};
    for(const k of TD_LOOK_KEYS) style[k] = clone(P[k]);
    return { style, text: P.text, look: P.look, surf: TDSurf.snapshot(), layers: TDSurf.layers, twKey: TD._twKey, twStart: TD._twStart };
  },
  _restoreMain(s){
    const P = TD.P;
    for(const k of TD_LOOK_KEYS) P[k] = s.style[k];
    P.text = s.text; P.look = s.look;
    TD._applyStageStyle(); TD._createSpans(P.text);
    const baked = TDSurf.layers;   // apply が layers を空にするので先に控える
    TDSurf.apply(s.surf);
    for(const L of baked) if(!s.layers.includes(L)) TDSurf._giveCanvas(L.canvas);   // 焼き付けで作った効果の絵は使い回す
    TDSurf.layers = s.layers; TDSurf._fresh = false;   // 主役がすぐ元の絵を出せるよう、前の効果の絵を戻す
    TD._twKey = s.twKey; TD._twStart = s.twStart;   // 一文字ずつ入力の進み具合も本体のものに戻す
    this._heroHoldUntil = performance.now() + 1500;
  },
  // 本体にスタンプの Look を当てる (分身の値 = Look + ばらつき、文字、Surface)
  _applyToMain(st, inst){
    const P = TD.P, L = TDLooks.get(st.look);
    for(const k of TD_LOOK_KEYS) P[k] = clone(inst.P[k]);
    P.text = inst.P.text; P.look = st.look;
    TD._applyStageStyle(); TD._createSpans(P.text);
    if(L && L.kind === 'f') TDSurf.applyPreset(L.item.id);
    else if(L){ P.surf = L.item.surf ? clone(L.item.surf) : { enabled: false }; }
  },
  // 焼き付ける瞬間のスタンプの文字ごとの伸び縮み (向き・強さ・段階・Operator) を本体の文字へ写す。
  // 写さないと本体は組み直したばかりで全文字が素の縦横比のまま焼かれ、Look 付きスタンプの文字の変形が絵に出なかった
  _copyLetters(inst){
    if(TD._layoutDirty) TD._measureLayout();
    const a = inst._metrics, b = TD._metrics;
    if(!a || !b || a.length !== b.length) return;
    for(let i = 0; i < a.length; i++){
      const s = a[i], d = b[i];
      d.toggled = s.toggled; d.hovered = s.hovered; d.intensity = s.intensity; d.tgt = s.tgt; d.flipAt = s.flipAt;
      d.rX = s.rX; d.rY = s.rY; d.geo = s.geo; d.op = s.op; d.opStatic = s.opStatic;
      TD._applyStretch(d);
    }
    TD._twKey = inst._twKey; TD._twStart = inst._twStart;   // 一文字ずつ入力の進み具合もスタンプのものにする (本体の文字を替えると数え直していた)
  },
  // 1 フレームぶん焼き付けを進める (TDCanvas.draw の先頭から)
  _stepBake(now){
    const list = this.stamps();
    if(!this._bake){
      if(TDSurf.status !== 'ready'){ if(this._bakeQ.length) TDSurf.ensure().catch(()=>{}); return; }
      let st = null;
      while(this._bakeQ.length && !st){ const c = this._bakeQ.shift(); if(list.includes(c) && this._inst.get(c) && this._inst.get(c)._stamp && this._needsFull(c)) st = c; }
      if(!st) return;
      this._bake = { st, t0: now, frames: 0, saved: this._saveMain() };
      this._applyToMain(st, this._inst.get(st));
      return;
    }
    const b = this._bake, inst = this._inst.get(b.st);
    if(!list.includes(b.st) || !inst || !inst._stamp){ this._restoreMain(b.saved); this._bake = null; return; }
    try{ this._bakeFrame(b, inst, now); }
    catch(e){ this._restoreMain(b.saved); this._bake = null; this._lastBakeEnd = now; console.warn('[TDCanvas] bake failed', e); }   // 本体が Look を替えたままにならないように
  },
  _bakeFrame(b, inst, now){
    const { pf, pw, ph } = inst._raster;
    this._copyLetters(inst);
    const cv = TD._renderHero(pw, ph, 1/pf);   // 描くことで Surface の Worker へも頼む
    b.frames++;
    // Vector 3D の間は Surface を描かない (TextDeform._renderToCanvas) ので、その絵を待たない (待つと毎回 2.5 秒の打ち切りまで素の文字が出ていた)
    const vecOn = !!TD.P.vecMode && TD.P.vecMode !== 'off';
    const surfOk = vecOn || !TDSurf.cfg.enabled || TDSurf.layers.length > 0;
    if((surfOk && b.frames >= 3) || now - b.t0 > 2500){
      const f = inst.full || (inst.full = this._takeCanvas());
      f.width = cv.width; f.height = cv.height;
      const fx = f.getContext('2d'); fx.clearRect(0, 0, f.width, f.height); fx.drawImage(cv, 0, 0);
      inst.fullPf = pf; inst.fullS = this._es(b.st);
      inst._fullPixelQ = this._pixelQ; inst._queuedPixelQ = null;
      inst.canvas.width = 0; inst.canvas.height = 0;
      this._featherIfOpaque(f, b.st.look);   // 縁まで塗られた Look は四角が見えないよう縁を抜く
      if(!inst._shown){ inst._shown = true; inst._born = now; inst._a = null; }   // 焼き上がってはじめて弾んで出る
      this._restoreMain(b.saved); this._bake = null; this._lastBakeEnd = now;
    }
  },
  // B: 余裕があるとき、Look の完全再現が要るスタンプを 1 枚ずつ順番に描き直す
  _scheduleLive(now){
    if(this._fullMode() !== 'live' || this._bake || this._bakeQ.length) return;
    if(now - this._lastBakeEnd < Math.max(50, +TD.P.canvasFullEvery || 300)) return;
    if(this._fpsEma < 45) return;   // 重いときは間引く
    const cand = this.stamps().filter(s => this._needsFull(s));
    if(!cand.length) return;
    this._rr = (this._rr + 1) % cand.length;
    this._enqueue(cand[this._rr], false);
  },
  _makeInner(st){
    if(st.hero) return { hero: true };
    if(st.img){ const im = new Image(); im.src = st.img; return { img: im }; }
    const inst = Object.create(TD);
    const P = inst.P = Object.create(TD.P);
    const L = (typeof TDLooks !== 'undefined') ? TDLooks.get(st.look) : null;
    const style = L ? (L.kind === 'f' ? TDLooks.featuredStyle(L.item) : (L.item.style || {})) : {};
    const D = TD.PDefaults || {};
    for(const k of TD_LOOK_KEYS) P[k] = clone(style[k] !== undefined ? style[k] : D[k]);
    P.text = st.text || 'FORM';
    P.transparentBg = true; P.fitMode = 'fit'; P.zoom = 1; P.panX = 0; P.panY = 0; P.marginPct = 4;
    P.trailPct = 0; P.vignette = 0; P.grain = 0;   // 画面全体に掛ける効果は本体の紙の上でだけ
    // ばらつき (伸縮・字間・行送り) は分身の Look の値に掛ける
    const TP = TD.P;
    if(+TP.cvStretch){ const v = +TP.cvStretch; const vary = (b, r) => { b = Number.isFinite(+b) ? +b : 1; if(!b) return v*r; const x = b * (1 + v*r); return b > 0 ? Math.max(0.2, x) : x; }; P.stretchX = vary(P.stretchX, this._r(st, 1)); P.stretchY = vary(P.stretchY, this._r(st, 2)); }   // 伸縮 0 (変えない) は掛け算でなく足してばらつかせる
    if(+TP.cvTrack) P.letterSpacing = (+P.letterSpacing || 0) + (+TP.cvTrack)*this._r(st, 3);
    if(+TP.cvLeading) P.lineHeight = Math.max(0.5, (+P.lineHeight || 1) * (1 + (+TP.cvLeading)*this._r(st, 4)));
    inst._stamp = true;
    inst.canvas = this._takeCanvas();
    inst.ctx = inst.canvas.getContext('2d');
    // 組版用の隠しステージ (分身ごと。スタイル要素は本体のものを共有)
    const wrap = document.createElement('div');
    wrap.setAttribute('data-textdeform', 'stamp');
    wrap.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none;opacity:0;z-index:-1;';
    const stage = document.createElement('div'); stage.className = 'td-stage';
    wrap.appendChild(stage); document.body.appendChild(wrap);
    inst._stageWrap = wrap; inst._stage = stage;
    inst._t = (st.seed || 0) % 10; inst._pointer = { x: 0, y: 0 };
    inst._metrics = null; inst._letters = null; inst._fit = null; inst._ctr = null;
    inst._bloomUntil = 0; inst._nextBloomCheck = 1e12; inst._randText = null; inst._textSlot = null;
    inst._layoutDirty = true; inst._fitDirty = true;
    inst._applyStageStyle();
    inst._createSpans(P.text);
    return inst;
  },
  // ghost = true: 画面から減るとき (Clear・削除・レイアウトで枚数が減る・Auto Clear)。最後に描いた絵を写し取り、出るときの弾み (_elastic) の逆で消す
  _drop(st, ghost){
    const inst = this._inst.get(st);
    if(ghost && inst && inst._ld && inst._ld.src && inst._ld.src.width){
      try{
        const ld = inst._ld;
        let c;
        // 消える分身の絵はそのまま残像に回す (写し取らない)。主役・画像のように分身の持ち物でない絵だけ写す
        if(inst._stamp && (ld.src === inst.full || ld.src === inst.canvas)){
          c = ld.src;
          if(c === inst.full) inst.full = null; else inst.canvas = null;
        } else {
          c = this._takeCanvas();
          c.width = ld.src.width; c.height = ld.src.height;
          const cx = c.getContext('2d'); cx.clearRect(0, 0, c.width, c.height); cx.drawImage(ld.src, 0, 0);
        }
        const g = this._ghosts || (this._ghosts = []);
        g.push({ c, ld: Object.assign({}, ld, { src: null }), born: performance.now() });
        this._trimGhosts(48);
      }catch(e){}
    }
    if(inst && inst._stageWrap) inst._stageWrap.remove();
    if(inst && inst._stamp){ this._giveCanvas(inst.canvas); this._giveCanvas(inst.full); inst.canvas = inst.full = null; }
    this._inst.delete(st);
  },
  // 残像は 48 枚・合計 8M 画素まで。あふれた分と消え終わった分の絵は使い回しへ返す (前は参照を外すだけで GC まで描画メモリを抱えていた)
  _trimGhosts(maxN, now){
    const g = this._ghosts; if(!g) return;
    const keep = [];
    let px = 0;
    for(let i = g.length - 1; i >= 0; i--){
      const x = g[i], a = x.c.width*x.c.height;
      if(keep.length < maxN && (now == null || now - x.born < 600) && px + a <= 8e6){ keep.unshift(x); px += a; }
      else this._giveCanvas(x.c);
    }
    this._ghosts = keep;
  },
  // Canvas を Off にしたら分身・残像・控えの絵と隠しステージを手放す (On に戻すと _sync が作り直す)
  release(){
    this.abort();
    for(const st of Array.from(this._inst.keys())) this._drop(st);
    this._trimGhosts(0);
    for(const c of this._pool){ c.width = 0; c.height = 0; }
    this._pool.length = 0;
    for(const k of ['_bgHold', '_heroCache']) if(this[k]){ this[k].width = 0; this[k].height = 0; this[k] = null; }
  },
  // canvasStamps と分身を揃える (状態の復元・Undo で配列が差し替わったとき)
  _sync(){
    const list = this.stamps(), live = new Set(list);
    for(const st of Array.from(this._inst.keys())) if(!live.has(st)) this._drop(st);
    for(const st of list) if(!this._inst.has(st)) this._inst.set(st, this._make(st));
  },
  // 共通フォントなど本体の書体が変わったら、分身の組版も作り直す
  // スタンプごとの -1..1 (seed と番号から決まる。同じスタンプはいつも同じ値)
  _r(st, k){ const x = Math.sin(((st.seed || 0) % 100000)*12.9898 + k*78.233)*43758.5453; return (x - Math.floor(x))*2 - 1; },
  // Var Size: スタンプごとの大きさの倍率 4^(cvSize × 乱数)。0 = 1 倍、1 = 0.25〜4 倍 (途中は連続)
  _vSize(st){ const v = +TD.P.cvSize || 0; return v ? Math.pow(4, v*this._r(st, 5)) : 1; },
  // 実効の大きさ (st.s × Var Size)。描く解像度・焼き付け・当たり判定はこの大きさで決める (拡大してもぼけない)
  _es(st){ return st.s*this._vSize(st); },
  // 分身の Look に掛けるばらつき (伸縮・字間・行送り) が変わったら分身を作り直す
  rebuild(){ for(const st of Array.from(this._inst.keys())) this._drop(st); this._sync(); },
  relayout(){ for(const inst of this._inst.values()){ if(!inst._stamp) continue; inst._applyStageStyle(); inst._createSpans(inst.P.text); } },

  // ---- 置く・動かす ----
  _sourceLook(){
    if(TD.P.canvasSource === 'random' && typeof TDLooks !== 'undefined'){ const id = TDLooks.pickRandom(); if(id) return id; }
    return TD.stateP().look || 'f:055-mirrored-sigil';   // 焼き付け中も本体の Look (スタンプの Look ではなく)
  },
  // 重なりと画面の端を避けた位置を、大きいものから順に選ぶ (Random レイアウトと C Motion = Jump の置き直しで使う)
  _freeSpot(out, s){
    const best = { x: 0.5, y: 0.5 };
    let bd = -Infinity;
    for(let k = 0; k < 18; k++){
      const x = rnd(0.04, 0.96), y = rnd(0.06, 0.94);
      let d = Math.min(x + 0.08, 1.08 - x, y + 0.08, 1.08 - y) * 1.5;   // 画面の外へ大きく出る候補ほど不利
      for(const o of out) d = Math.min(d, Math.hypot((x - o.x)*1.6, y - o.y) - (o.s + s)*BASE*0.32);
      d += Math.random()*0.04;   // 同じ形に揃いすぎないよう少し揺らす
      if(d > bd){ bd = d; best.x = x; best.y = y; }
    }
    return best;
  },
  // 空いている場所: 候補を何点か試して、既存のスタンプ (大きさを考慮) から一番離れた所
  _emptiest(list, s){
    let best = { x: 0.5, y: 0.5 }, bd = -1;
    for(let k = 0; k < 24; k++){
      const x = rnd(0.12, 0.88), y = rnd(0.14, 0.86);
      let d = Math.min(x, 1 - x, y, 1 - y) * 2;   // 縁からの距離も見る
      for(const o of list) d = Math.min(d, Math.hypot((x - o.x)*1.6, y - o.y) - (o.s + s)*BASE*0.45);
      if(d > bd){ bd = d; best = { x, y }; }
    }
    return best;
  },
  // ワンボタンのレイアウト: 枚数をそろえ (少なければ 7 枚)、大小・位置・角度をまとめて決める。位置へはなめらかに移る
  layout(name){
    const P = TD.P, names = Object.keys(LAYOUTS);
    // cycle (C Layout の Random) = ランダムな周期で構成方法を入れ替える。P.canvasLayout は 'cycle' のまま残し、今の構成は _layoutName に持つ
    const req = name;
    if(req === 'cycle'){ name = 'random'; this._cycleNext = null; }   // 次の入れ替えの拍は _beatAuto が決める
    if(name === 'random') name = names.filter(x => x !== this._layoutName)[Math.floor(Math.random()*(names.length - 1))];
    if(!LAYOUTS[name]) name = 'hero';
    this._layoutName = name;
    // Random (cycle) を選んだ / cycle 中に自動・🎲 で組み直した → 'cycle' のまま。具体的な構成を選んだ → その構成 (cycle をやめる)
    if(req === 'cycle' || (req === 'random' && P.canvasLayout === 'cycle')) P.canvasLayout = 'cycle';
    else P.canvasLayout = name;
    const list = this.stamps();
    const n = Math.min(this.max(), Math.max(list.length >= 3 ? list.length : 7, 3));
    while(list.length < n) this.add(rnd(0.3, 0.7), rnd(0.3, 0.7), true);
    while(list.length > n){ const i = list.findIndex(s => !s.hero && !s.img); if(i < 0) break; this._drop(list[i], true); list.splice(i, 1); }
    const slots = LAYOUTS[name](list.length);
    // 主役 → 焼き付け → 分身 (ランダム) の順に、大きい位置から
    const order = list.filter(s => s.hero).concat(list.filter(s => s.img), list.filter(s => !s.hero && !s.img).sort(() => Math.random() - 0.5));
    order.forEach((st, i) => { const t = slots[i]; if(!t) return; st.x = t.x; st.y = t.y; st.s = t.s; st.rot = t.rot; });
    // 大きいものを後ろ、小さいものを手前に
    order.forEach((st, i) => { st.z = i + 1; });
    this._gunFire(order);
    this._changed();
    return name;
  },
  // マシンガン: いまのスタンプを隠し、拍の刻みごとに 1 枚ずつ出す (order = 大きい順)
  _gunQ: [], _gunHidden: new Set(), _gunStep: null,
  _gunFire(order){
    if(TD.P.canvasTiming !== 'gun'){ this._gunQ = []; this._gunHidden.clear(); return; }
    let q = (order || this.stamps().slice().sort((a, b) => (a.z || 0) - (b.z || 0))).slice();
    const how = TD.P.canvasGunOrder || 'layout';
    if(how === 'random') q.sort(() => Math.random() - 0.5);
    else if(how === 'sweep') q.sort((a, b) => a.x - b.x || a.y - b.y);
    this._gunQ = q; this._gunHidden = new Set(q); this._gunStep = null;
  },
  _gunTick(beat){
    if(!this._gunQ.length){ if(this._gunHidden.size) this._gunHidden.clear(); return; }
    if(TD.P.canvasTiming !== 'gun'){ this._gunQ = []; this._gunHidden.clear(); return; }
    const step = Math.floor((beat || 0) * Math.max(1, +TD.P.canvasGunDiv || 4));
    if(step === this._gunStep) return;
    this._gunStep = step;
    const list = this.stamps();
    while(this._gunQ.length){
      const st = this._gunQ.shift();
      if(!list.includes(st)){ this._gunHidden.delete(st); continue; }
      this._gunHidden.delete(st);
      const inst = this._inst.get(st); if(inst){ inst._born = performance.now(); inst._a = null; }   // 弾んで出る
      break;
    }
  },
  // ランダムな位置へ置き直す (大きさ・角度はそのまま。位置は重なりと画面の端を避ける)。C Motion = Jump なら瞬間的に移る
  jump(){
    const list = this.stamps().slice().sort((a, b) => b.s - a.s), placed = [];
    for(const st of list){ const p = this._freeSpot(placed, st.s); st.x = p.x; st.y = p.y; placed.push(st); }
    this._changed();
  },
  add(x, y, silent){
    const list = this.stamps();
    const z = list.reduce((m, s) => Math.max(m, s.z || 0), 0) + 1;
    const st = { look: this._sourceLook(), text: String(TD.stateP().text || 'FORM'), x, y, s: 0.6 + Math.random()*0.5, rot: (Math.random()*2 - 1)*12, z, seed: Math.floor(Math.random()*1e6) };
    list.push(st);
    // 上限を超えたら古いものから消す
    while(list.length > this.max()){
      let oi = 0; for(let i = 1; i < list.length; i++) if((list[i].z || 0) < (list[oi].z || 0)) oi = i;
      this._drop(list[oi], true); list.splice(oi, 1);
    }
    this._inst.set(st, this._make(st));
    return st;
  },
  remove(st){ const list = this.stamps(), i = list.indexOf(st); if(i >= 0){ this._drop(st, true); list.splice(i, 1); } },
  clear(){ this.abort(); for(const st of this.stamps()) this._drop(st, true); TD.P.canvasStamps = []; this._emptyOk = true; },
  // 焼き付けを中止し、本体の Look を戻す (Canvas を Off にしたとき・Clear・呼び出し)
  // 焼き付けを中断して本体の Look を戻す (Look・文字・パラメータを本体に書く前に呼ぶ。焼き終わりの戻しで書いた値が消えないように)
  // drop = false なら、そのスタンプを順番待ちの先頭に戻して焼き直す
  cancelBake(drop){
    const b = this._bake; if(!b) return;
    this._bake = null; this._restoreMain(b.saved);
    if(!drop) this._enqueue(b.st, true);
  },
  abort(){ if(this._bake){ const s = this._bake.saved; this._bake = null; this._restoreMain(s); } this._bakeQ.length = 0; },
  _front(st){ st.z = this.stamps().reduce((m, s) => Math.max(m, s.z || 0), 0) + 1; },
  // 画面の (u, v) にある一番上のスタンプ
  hit(u, v){
    const W = this._w || 1, H = this._h || 1;
    const list = this.stamps().slice().sort((a, b) => (b.z || 0) - (a.z || 0));
    for(const st of list){
      const sw = W*BASE*this._es(st), sh = H*BASE*this._es(st), a = -(st.rot || 0)*Math.PI/180;
      const px = (u - st.x)*W, py = (v - st.y)*H;
      const lx = px*Math.cos(a) - py*Math.sin(a), ly = px*Math.sin(a) + py*Math.cos(a);
      if(Math.abs(lx) <= sw/2 && Math.abs(ly) <= sh/2) return st;
    }
    return null;
  },
  pointerDown(u, v, e){
    const st = this.hit(u, v);
    if(st && e && e.shiftKey){ this.remove(st); this._changed(); return; }
    if(st){ this._front(st); this._drag = { st, du: st.x - u, dv: st.y - v }; return; }
    this._drag = { gun: true, u, v };
    this.add(u, v); this._gunAt = performance.now(); this._changed();
  },
  pointerMove(u, v){
    const d = this._drag; if(!d) return;
    if(d.st){ d.st.x = u + d.du; d.st.y = v + d.dv; return; }
    d.u = u; d.v = v;
  },
  pointerUp(){ if(this._drag){ this._drag = null; this._changed(); } },
  wheel(u, v, dy, shift){
    const st = this.hit(u, v); if(!st) return false;
    if(shift) st.rot = ((st.rot || 0) + (dy > 0 ? 5 : -5));
    else st.s = Math.max(0.15, Math.min(3, st.s * (dy > 0 ? 0.92 : 1.08)));
    this._changed();
    return true;
  },
  _changed(){ if(typeof App !== 'undefined' && App._undoSchedule) App._undoSchedule(); if(this._onChange) try{ this._onChange(); }catch(e){} },

  // 拍の自動: P の canvasAuto* 拍ごとに 1 回 (拍の番号で数えるので、拍が戻ったときは数え直す)
  _beatAuto(beat){
    const P = TD.P;
    const tick = (key, slotKey, fn)=>{
      let every = +P[key] || 0;
      if(!(every > 0)){ this[slotKey] = null; return; }
      if(every < 1){ every = 1; P[key] = 1; }   // 最短は 1 拍 (1 拍より細かい保存値は 1 拍に丸める)
      const slot = Math.floor((beat || 0) / every + 1e-6);
      if(this[slotKey] == null || slot < this[slotKey]){ this[slotKey] = slot; return; }
      if(slot !== this[slotKey]){ this[slotKey] = slot; fn(); }
    };
    // 一掃: スタンプを捨てずに今のレイアウトへ組み直す (Machine Gun なら 1 枚ずつ撃ち直す)。
    // 捨てると焼き付けが毎回やり直しになり、1 拍ごとの一掃では焼き上がる前に消えて画面がほぼ空になっていた。
    // Auto Add で増えたぶんは、焼き上がっているものを優先して 7 枚まで残す
    tick('canvasAutoClear', '_clrSlot', ()=>{
      const live = this.stamps().filter(s => !s.hero && !s.img);
      const keep = live.slice().sort((a, b) => (this._inst.get(b) && this._inst.get(b).full ? 1 : 0) - (this._inst.get(a) && this._inst.get(a).full ? 1 : 0) || (b.z || 0) - (a.z || 0)).slice(0, 7);
      for(const st of live) if(!keep.includes(st)) this.remove(st);
      this.layout(TD.P.canvasLayout || 'hero');   // 新しい位置へ流れるように動く (全部を 0 から弾ませ直すと、その瞬間だけ画面が空になる)
    });
    tick('canvasAutoAdd', '_addSlot', ()=>{ const p = this._emptiest(this.stamps(), 0.6); this.add(p.x, p.y); });
    tick('canvasAutoLayout', '_layoutSlot', ()=>{ this.layout('random'); });
    // C Layout = Random (cycle): 2 / 4 / 8 / 16 拍 (beat xA を掛けた拍) からランダムに選んだ周期で、構成方法を入れ替える
    if(P.canvasLayout === 'cycle'){
      const b = beat || 0;
      if(this._cycleNext == null || b < this._cycleNext - 64) this._cycleNext = b + CYCLE_BEATS[Math.floor(Math.random() * CYCLE_BEATS.length)];
      else if(b >= this._cycleNext){ this.layout('random'); this._cycleNext = b + CYCLE_BEATS[Math.floor(Math.random() * CYCLE_BEATS.length)]; }
    } else this._cycleNext = null;
    tick('canvasJumpEvery', '_jumpSlot', ()=>{ this.jump(); });
    tick('canvasAutoSwap', '_swpSlot', ()=>{
      const live = this.stamps().filter(s => !s.hero && !s.img);
      if(!live.length || typeof TDLooks === 'undefined') return;
      const st = live[Math.floor(Math.random()*live.length)];
      const id = TDLooks.pickRandom(); if(!id) return;
      if(this._bake && this._bake.st === st) this.cancelBake(true);   // 焼いている途中のスタンプを替えるなら、旧 Look の焼き付けはやめる
      // 新しい Look の焼き付けができるまでは、前の焼き付けを出しておく (素の文字を見せない)
      const old = this._inst.get(st), prev = old && old.full, prevPf = old && old.fullPf;
      if(old) old.full = null;   // 前の焼き付けは新しい分身が使うので、_drop で使い回しの箱へ返さない
      this._drop(st); st.look = id;
      const ni = this._make(st);
      if(prev){ ni.full = prev; ni.fullPf = prevPf; ni._shown = true; ni._born = 0; }
      this._inst.set(st, ni);
      if(this._layoutName === 'hero' && !TD.P.canvasAutoLayout) this.layout('hero');   // Hero は Swap のたびに大の位置も変える (Auto Layout 中はそちらに任せる)
    });
  },
  // ---- 毎フレーム (TextDeform.update から) ----
  update(d, pulse, motion, beat){
    this._sync();
    this._gunTick(beat);
    // On にしたとき空なら、選んでいるレイアウトで組む (Clear で空にしたときはそのまま)
    if(!this.stamps().length && !this._emptyOk) this.layout(TD.P.canvasLayout || 'hero');
    this._beatAuto(beat);
    // 押したままのドラッグ = 連射 (0.12 秒ごと)
    const g = this._drag;
    if(g && g.gun && performance.now() - this._gunAt > 120){ this._gunAt = performance.now(); this.add(g.u + (Math.random() - 0.5)*0.02, g.v + (Math.random() - 0.5)*0.02); }
    for(const inst of this._inst.values()){
      if(!inst._stamp) continue;   // 主役・焼き付けは分身を持たない
      inst._t += d; inst._beatNow = beat || 0;
      if(inst._layoutDirty) inst._measureLayout();
      if(inst._metrics && inst._metrics.length) inst._randomFlipStep(pulse * motion * (inst._spd || 1));
    }
    this._pulse = pulse; this._motion = motion;
  },
  // ---- 描画 (TextDeform._renderToCanvas から。紙を塗った後) ----
  draw(ctx, W, H){
    const t0 = performance.now();
    this._w = W; this._h = H;
    this._sync();
    this._prepareResolution(W, H, t0);
    const env = Math.max(0, (this._pulse || 1) - 1), m = this._motion == null ? 1 : this._motion, now = t0/1000;
    const dt = this._lastDraw ? Math.min(0.1, now - this._lastDraw) : 0; this._lastDraw = now;
    if(dt > 0) this._fpsEma = this._fpsEma*0.95 + (1/dt)*0.05;
    // Look の完全再現: 焼き付けを 1 フレームぶん進め、余裕があれば次の描き直しを予約する
    const wasBaking = !!this._bake;
    this._scheduleLive(t0); this._stepBake(t0);
    // 焼き付けを始めた瞬間の背景 (紙 + 本体の Composition) を控える。焼き付け中は本体の値がスタンプのものに替わるので、
    // 背景はこの絵を敷く (描き直すと、Composition と紙がスタンプの文字・色に一瞬替わり、重い作り直しも 2 回走っていた)
    if(this._bake && !wasBaking){
      const bg = this._bgHold || (this._bgHold = document.createElement('canvas'));
      if(bg.width !== ctx.canvas.width || bg.height !== ctx.canvas.height){ bg.width = ctx.canvas.width; bg.height = ctx.canvas.height; }
      const bx = bg.getContext('2d'); bx.setTransform(1, 0, 0, 1, 0, 0); bx.clearRect(0, 0, bg.width, bg.height); bx.drawImage(ctx.canvas, 0, 0);
    }
    const holdHero = !!this._bake || t0 < (this._heroHoldUntil || 0) && TDSurf.cfg.enabled && !TDSurf.layers.length;
    const list = this.stamps().slice().sort((a, b) => (a.z || 0) - (b.z || 0));
    for(const st of list){
      const inst = this._inst.get(st); if(!inst) continue;
      if(this._gunHidden.has(st)) continue;   // マシンガンの順番待ち
      const sw = inst._raster ? inst._raster.sw : Math.max(16, Math.min(1280, Math.round(W*BASE*this._es(st))));
      const sh = inst._raster ? inst._raster.sh : Math.max(16, Math.min(1280, Math.round(H*BASE*this._es(st))));
      // 伸び縮み・ずらしで文字が小キャンバスの縁で切れないよう、実際に描いた文字のはみ出し量 (TextDeform._needPf) から
      // 次のフレームの余白 pf を決めて広く描き、そのぶん中の文字を縮めて (zoom) 同じ大きさに見せる。
      // 広げるときはすぐ、狭めるときはゆっくり。最大 4 倍、長辺 4096px を超えるぶんは解像度を落とす
      let src, pf = 1;
      if(inst.img){ if(!inst.img.complete || !inst.img.naturalWidth) continue; src = inst.img; }
      else if(inst.full && this._needsFull(st)){ src = inst.full; pf = inst.fullPf || 1; }   // 焼き付けた Look (大きさは今の st.s に合わせて伸縮)
      else if(inst._stamp && this._needsFull(st) && t0 - (inst._born || 0) < 1500) continue;   // 焼き上がるまで出さない (1.5 秒を過ぎたら分身のまま出す)
      else if(inst.hero && holdHero && this._heroCache){ src = this._heroCache; pf = this._heroCachePf || 1; }   // 本体を切り替えているあいだは直前の主役
      else {
        const { pw, ph } = inst._raster;
        pf = inst._raster.pf;
        if(inst.hero){
          src = TD._renderHero(pw, ph, 1/pf);
          const hc = this._heroCache || (this._heroCache = document.createElement('canvas'));
          if(hc.width !== pw || hc.height !== ph){ hc.width = pw; hc.height = ph; }
          const hx = hc.getContext('2d'); hx.clearRect(0, 0, pw, ph); hx.drawImage(src, 0, 0); this._heroCachePf = pf;
        }
        else {
          const z0 = inst.P.zoom; inst.P.zoom = 1/pf;
          inst._renderToCanvas(pw, ph); src = inst.canvas;
          inst.P.zoom = z0;
          if(inst._lastPf !== pf){ inst._lastPf = pf; inst._fitDirty = true; }
        }
      }
      // 表示位置はレイアウトの位置へなめらかに追いつく (レイアウトを替えたとき流れるように動く)
      const a = inst._a || (inst._a = { x: st.x, y: st.y, s: st.s, r: st.rot || 0 });
      // C Motion: Glide = 新しい位置へなめらかに追いつく / Jump = 瞬間的に移る (漂い・ゆらぎもなし)
      const jumpMode = TD.P.canvasMove === 'jump', f = jumpMode ? 1 : 1 - Math.exp(-dt*5);
      a.x += (st.x - a.x)*f; a.y += (st.y - a.y)*f; a.s += (st.s - a.s)*f; a.r += ((st.rot || 0) - a.r)*f;
      // Rhythm: 拍・音で大きさが脈打ち、動きの量に合わせて漂い・ゆらぐ。出てきた直後は弾む (0.6 秒)
      const age = Math.min(1, (t0 - (inst._born || 0)) / 600);
      // ばらつき (var): 大きさ・回転・位置・縦横比・不透明度・色相・拍への反応・漂い
      const VP = TD.P, R = k => this._r(st, k);
      const vSize = (inst._raster && inst._raster.over) || 1, vRot = this._rotVar(VP.cvRot)*R(6), vPx = (+VP.cvPos || 0)*R(7), vPy = (+VP.cvPos || 0)*R(8);
      const vAsp = 1 + (+VP.cvAspect || 0)*0.6*R(9), vReact = Math.max(0, 1 + (+VP.cvReact || 0)*R(10));
      const vDrift = Math.max(0, 1 + (+VP.cvDrift || 0)*2*R(11)), vAlpha = 1 - (+VP.cvOpacity || 0)*(R(12)*0.5 + 0.5), vHue = (+VP.cvHue || 0)*R(13);
      inst._spd = Math.max(0.05, 1 + (+VP.cvSpeed || 0)*R(14));
      const k = (1 + env*0.08*vReact) * this._elastic(age) * (a.s / Math.max(0.05, st.s)) * vSize, wob = jumpMode ? 0 : Math.sin(now*0.9 + (st.seed % 97))*3*m*vDrift;
      if(k <= 0.001 || vAlpha <= 0.01) continue;
      const sd = st.seed || 0, ds = 0.6 + 0.4*vDrift, dm = jumpMode ? 0 : 0.008*m*vDrift, drx = Math.sin(now*0.23*ds + sd)*dm, dry = Math.cos(now*0.19*ds + sd*1.3)*dm;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate((a.x + drx + vPx)*W, (a.y + dry + vPy)*H);
      ctx.rotate((a.r + wob + vRot)*Math.PI/180);
      ctx.scale(k*vAsp, k/vAsp);
      ctx.globalAlpha = vAlpha;
      if(vHue) ctx.filter = 'hue-rotate(' + vHue.toFixed(0) + 'deg)';
      this._plate(ctx, inst, sw, sh);
      // 小キャンバスは 16px 刻みで取るので、縦横比は描いた絵のものを保つ (幅を合わせる)
      const dw = sw*pf, dh = inst.img ? sh*pf : dw*src.height/src.width;
      ctx.drawImage(src, -dw/2, -dh/2, dw, dh);
      inst._ld = { src, x: (a.x + drx + vPx)*W, y: (a.y + dry + vPy)*H, r: a.r + wob + vRot, k, asp: vAsp, alpha: vAlpha, hue: vHue, dw, dh };   // 消えるときの弾み用 (今見えている大きさから縮める)
      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; ctx.globalAlpha = 1; ctx.filter = 'none';
    }
    // 消えていくスタンプ: 出るときの弾み (_elastic) を逆にたどって 0 へ (0.6 秒)
    if(this._ghosts && this._ghosts.length){
      this._trimGhosts(48, t0);
      for(const g of this._ghosts){
        const ld = g.ld, sc = ld.k * this._elastic(1 - (t0 - g.born)/600);
        if(sc <= 0.001) continue;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.translate(ld.x, ld.y); ctx.rotate(ld.r*Math.PI/180); ctx.scale(sc*ld.asp, sc/ld.asp);
        ctx.globalAlpha = ld.alpha; if(ld.hue) ctx.filter = 'hue-rotate(' + ld.hue.toFixed(0) + 'deg)';
        ctx.drawImage(g.c, -ld.dw/2, -ld.dh/2, ld.dw, ld.dh);
        ctx.globalAlpha = 1; ctx.filter = 'none';
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ms = this.ms*0.8 + (performance.now() - t0)*0.2;
  },

  // 文字の見えにくさ対策 (P.canvasPlate): auto = インクと背景の紙の明るさが近い分身にだけ、その Look の紙を敷く /
  //   paper = 分身には常に敷く / shadow = 背景と逆の明るさの柔らかい影 / off
  _lum(hex){ const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if(!m) return 0.5; const v = parseInt(m[1], 16); return (0.2126*((v >> 16) & 255) + 0.7152*((v >> 8) & 255) + 0.0722*(v & 255))/255; },
  _plate(ctx, inst, sw, sh){
    const mode = TD.P.canvasPlate || 'auto';
    if(mode === 'off') return;
    const bgL = this._lum(TD.color('paper'));
    if(mode === 'shadow' || !inst._stamp){
      if(mode === 'shadow'){ ctx.shadowColor = bgL < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 22; }
      return;
    }
    if(mode === 'auto' && Math.abs(this._lum(inst.color('ink')) - bgL) >= 0.3) return;
    const w = sw*0.98, h = sh*0.9, r = Math.min(w, h)*0.08;
    ctx.save(); ctx.globalAlpha = 0.94; ctx.fillStyle = inst.color('paper');
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-w/2, -h/2, w, h, r) : ctx.rect(-w/2, -h/2, w, h); ctx.fill(); ctx.restore();
  },
  // 焼き付けた絵の縁 (上下左右 1px) の平均の不透明度を測り、塗られていれば (背景・ビネット・全面の Composition / Surface を持つ Look)
  // 上下左右の端 8px を透明へ抜く (前は 16% で、縁が白くぼけて見えた)。縁が透明な Look (大多数) は何もしない。戻り値 = 縁の平均の不透明度 (0〜1)
  // 測るのは Look ごとに最初の 1 回だけ (毎回 GPU から読み戻すと重い)
  _edgeOf: new Map(),
  _featherIfOpaque(c, look){
    const x = c.getContext('2d'), w = c.width, h = c.height;
    if(w < 8 || h < 8) return 0;
    let edge = this._edgeOf.get(look);
    if(edge == null){
      let sum = 0, n = 0;
      for(const d of [x.getImageData(0, 0, w, 1).data, x.getImageData(0, h - 1, w, 1).data, x.getImageData(0, 0, 1, h).data, x.getImageData(w - 1, 0, 1, h).data]){
        for(let i = 3; i < d.length; i += 16){ sum += d[i]; n++; }
      }
      edge = n ? sum/n/255 : 0;
      this._edgeOf.set(look, edge);
    }
    if(edge < 0.04) return edge;
    x.save(); x.globalCompositeOperation = 'destination-in';
    const fx = Math.min(0.5, 8/w), fy = Math.min(0.5, 8/h);   // 抜くのは端の 8px だけ (文字の輪郭はぼかさない)
    let g = x.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(fx, 'rgba(0,0,0,1)'); g.addColorStop(1 - fx, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(fy, 'rgba(0,0,0,1)'); g.addColorStop(1 - fy, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.restore();
    return edge;
  },
  // Var Rot は -1..1 (1 = ±90°。負は回る向きが逆)。前の保存データの度 (|値| > 1) はそのまま度として読む
  _rotVar(v){ v = +v || 0; return Math.abs(v) > 1 ? v : v*90; },
  _elastic(x){ if(x >= 1) return 1; const c4 = (2*Math.PI)/3; return x <= 0 ? 0 : Math.pow(2, -10*x)*Math.sin((x*10 - 0.75)*c4) + 1; },

  // ---- 構成の保存 (store「tdcanvas」) ----
  _url(){ return (typeof App !== 'undefined' && App._storeBase ? App._storeBase() : 'presets/store.php') + '?name=tdcanvas'; },
  async loadSaved(){
    if(this.saved) return this.saved;
    let list = [];
    try{ const r = await fetch(this._url(), { cache: 'no-store' }); if(r.ok){ const d = await r.json(); if(Array.isArray(d)) list = d; } }catch(e){}
    return (this.saved = list);
  },
  async _save(){
    const r = await fetch(this._url(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.saved) });
    if(!r.ok) throw new Error('store ' + r.status);
  },
  async saveAs(name){
    await this.loadSaved();
    const thumb = (typeof TDLooks !== 'undefined') ? TDLooks.snapshotThumb() : '';
    this.saved.push({ name: name || ('Canvas ' + (this.saved.length + 1)), thumb, stamps: clone(this.stamps()) });
    await this._save();
    return this.saved.length - 1;
  },
  async load(i){
    await this.loadSaved();
    const c = this.saved[i]; if(!c) return false;
    this.clear();
    TD.P.canvasStamps = clone(c.stamps || []);
    TD.P.canvasOn = true;
    this._sync(); this._gunFire();   // マシンガンなら呼び出した構成も順に撃つ
    this._changed();
    return true;
  },
  async removeSaved(i){ await this.loadSaved(); if(!this.saved[i]) return; this.saved.splice(i, 1); await this._save(); }
};
globalThis.TDCanvas = TDCanvas;
})();
