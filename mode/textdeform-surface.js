/* ================= Type Deformer — Surface (上流 0.3 の描画エンジン) =================
 * synomare/type-deformer 0.3 の Surface Operator 100 種を、上流の render-engine.js (MIT) を
 * Worker で動かして TextDeform に重ねる。エンジン本体は mode/typedeformer/ に無改変で同梱し、
 * ON にした時点で初めて読み込む (会場の弱 Wi-Fi 対策)。
 *   - Operator ごとのパラメータ表 = mode/typedeformer/vj-operator-params.json
 *     (上流の UI パネルから scripts/gen_td_params.py で生成)
 *   - プリセット = 上流の「厳選」147 案 (作者の許諾を得て同梱。mode/typedeformer/vj-presets.json と presets/*.jpg、
 *     scripts/gen_td_presets.py で生成)。1 案に Operator が最大 3 つあり、プリセットの surfaceOrder の順に重ねる。
 *   - 状態は TextDeform.P.surf (末尾のアクセサ)。Look の一部として保存デフォルト・状態の復元・Undo・保存 Look と
 *     一緒に読み書きする。プリセットの選択・Auto は mode/textdeform-looks.js (TDLooks)。
 *   - エンジンは On の状態で描画が始まった時点 (advance) で読み込む。状態の復元だけでは読み込まない。
 *   - Worker が描いている間は位相を止め、描き終えたら次のフレームを頼む (上流 editor の clock hold と同じ)。
 *     届いた効果レイヤーは自前のキャンバスへ写してから使う (キューは次の結果で古いビットマップを閉じるため)。
 * ===================================================================================== */
(function(){
'use strict';
if(typeof TextDeform === 'undefined') return;
const TD = TextDeform;
const UP = globalThis.TDUpstream;   // 共通部 (mode/textdeform-upstream.js)
const SCRIPTS = ['operator-registry.js', 'editor-model.js', 'surface-state.js', 'render-jobs.js'];
const BLENDS = ['source-over', 'multiply', 'screen', 'overlay', 'difference', 'lighter'];
// 半透明そのものが表現の Operator (版ずれ・重ね刷り・光の重なり・残像や時間の蓄積・掠れ・透過開口)。これ以外は Look の値に関係なく効果を不透明で描く
// (全体の透明度は Surface の Opacity と Canvas の Opacity で決める)
const KEEP_ALPHA = new Set(['misregistration', 'risoSeparation', 'causticGlass', 'copyDecay', 'dataMosh', 'slitSweep', 'diffractiveGlyph', 'plotterTrace', 'blobTrack', 'softBlob', 'ligatureCrypt', 'naveCutter']);
// 共通パレットで役割を固定する色 (版ずれは A = Accent / B = Key。ほかはいちばん近い役割)
const MISREG_ROLE = { misregColorA: 'accent', misregColorB: 'ink' };
const DEFAULTS = {
  enabled: false,
  op: 'plotterTrace',      // パラメータを編集している Operator
  ops: [],                 // 重ねる Operator (空なら [op])。プリセットを選ぶと最大 3 つ
  preset: '',              // 選んだプリセットの id ('' = Custom)
  strength: 1, chance: 1, speed: 0.25,
  source: 'op',            // op = Operator の既定 / keep / ghost / hide (元の文字の見せ方)
  opacity: 1, blend: 'op', // blend: op = Operator の既定
  pixel: 1,                // 粗さ: 効果をこの倍率で粗く描き、ドットのまま拡大する (1 = 従来の解像度)
  color: 'op',             // op = Operator の既定色 / ink / accent
  params: {}               // Operator id → { key: value } (既定値との差分)。'*' = Operator に属さない共通の値
};
const clone = v => JSON.parse(JSON.stringify(v));
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over){
  const out = clone(base);
  if(!isObj(over)) return out;
  for(const k of Object.keys(over)){
    if(isObj(over[k]) && isObj(out[k])) out[k] = merge(out[k], over[k]);
    else out[k] = clone(over[k]);
  }
  return out;
}

const TDSurf = {
  // 1 フレームが 1.5 秒を超える Operator (約 25 字の文章・MacBook で計測)。一覧で (重い) と表示する
  HEAVY: ['counterformEngine','sinewTorque','hyperbolicAtlas','loadpathFoundry','tensionMembrane','differentialType','diffractiveGlyph','hopfLoom',
    'ornamentReserve','vortexBath','gillArray','screwExtrusion','harmonicCage','enneperBody','nibRecast','growthBuckle','inversionBody','gravityLens',
    'repulsiveCurves','wassersteinLetters','gyroidSculpture','causticGlass','riemannRamification'],
  cfg: clone(DEFAULTS),
  status: 'idle', error: '', meta: null, model: null, registry: null, jobs: null,
  presets: null, _presetsLoading: null,
  phase: 0, moshFrame: 0, envelopeScale: 1,
  layers: [], lastMs: 0,
  _loading: null, _pending: null, _fontCss: null, _onStatus: null,

  get(){ return this.cfg; },
  snapshot(){ return clone(this.cfg); },
  // 保存値を当てる (P.surf への代入)。エンジンの読み込みは advance で
  apply(saved){
    this.cfg = merge(DEFAULTS, saved);
    this.layers = []; this._fresh = !!this.cfg.enabled;
    this._reset();
  },
  set(over){
    const prev = this.activeOps().join();
    this.cfg = merge(this.cfg, over);
    if(over && Array.isArray(over.ops)) this.cfg.ops = over.ops.slice();
    // 重ねる Operator が変わったら前の絵は捨てる (新しい絵が届くまでは元の字をそのまま見せる)
    if(this.activeOps().join() !== prev) this.layers = [];
    // params は差分なので、値を null で渡したキーは既定値へ戻す
    for(const op of Object.keys(this.cfg.params)){
      const p = this.cfg.params[op];
      for(const k of Object.keys(p)) if(p[k] == null) delete p[k];
    }
    this._reset();
    if(this.cfg.enabled) this.ensure();
  },
  // 重ねる Operator (プリセットの surfaceOrder、無ければ上流の既定の重ね順)
  activeOps(){
    const list = (this.cfg.ops && this.cfg.ops.length ? this.cfg.ops : [this.cfg.op]).filter(o=>!this.meta || this.meta.ops[o]);
    const order = String((this.cfg.params['*'] || {}).surfaceOrder || '').split(',').filter(Boolean);
    const base = order.length ? order : (this.registry ? this.registry.renderOrder : []);
    return list.slice().sort((a, b)=>{
      const ia = base.indexOf(a), ib = base.indexOf(b);
      return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    });
  },
  active(){ return !!this.cfg.enabled && this.status === 'ready' && !!this.meta && this.activeOps().length > 0; },
  onStatus(fn){ this._onStatus = fn; },
  _notify(){ if(this._onStatus) try{ this._onStatus(this); }catch(e){} },

  ensure(){
    if(this.status === 'ready') return Promise.resolve(this);
    if(this._loading) return this._loading;
    this.status = 'loading'; this.error = ''; this._notify();
    this._loading = (async ()=>{
      await UP.load(SCRIPTS);
      const res = await fetch(UP.BASE + 'vj-operator-params.json' + UP.q);
      if(!res.ok) throw new Error('vj-operator-params.json ' + res.status);
      this.meta = await res.json();
      this.registry = globalThis.TypeDeformerOperatorRegistry;
      this.model = UP.model();
      if(!globalThis.TypeDeformerRenderJobs.supportsSurfaceWorker()) throw new Error('この環境は OffscreenCanvas Worker に未対応です');
      this.jobs = globalThis.TypeDeformerRenderJobs.create({
        editTimeout: 30000, interruptAfter: 180,
        workerFactory: ()=>{
          // importScripts の一時的な読み込み失敗などで Worker が落ちても画面のエラー表示へは上げない (_onJobState が作り直す)
          const w = new Worker(new URL(UP.BASE + 'vj-surface-worker.js' + UP.q, document.baseURI));
          w.addEventListener('error', e=>{ e.preventDefault(); console.warn('[TDSurf] worker', e.message || e); });
          return w;
        },
        encode: job=>({ id: job.id, payload: job.payload }),
        onState: s=>this._onJobState(s)
      });
      this.status = 'ready';
      this._notify();
      this.loadPresets();   // 一覧は後から届けばよい (保存済みの Surface はプリセットの値を cfg に持っている)
      return this;
    })().catch(e=>{
      this.status = 'error'; this.error = e.message || String(e); this._loading = null;
      console.warn('[TDSurf]', e); this._notify();
      throw e;
    });
    return this._loading;
  },
  loadPresets(){
    if(this.presets) return Promise.resolve(this.presets);
    if(this._presetsLoading) return this._presetsLoading;
    this._presetsLoading = fetch(UP.BASE + 'vj-presets.json' + UP.q).then(r=>{
      if(!r.ok) throw new Error('vj-presets.json ' + r.status);
      return r.json();
    }).then(d=>{
      d.presets = d.presets.filter(p=>p.operators.length);   // Surface の Operator を含まない案は除く
      this.presets = d; this._notify(); return d;
    }).catch(e=>{ this._presetsLoading = null; console.warn('[TDSurf]', e); });
    return this._presetsLoading;
  },
  presetThumb(id){ return UP.BASE + 'presets/' + id + '.jpg' + UP.q; },
  // プリセットの Surface を適用: Operator を差し替え、値を Operator ごと (属さないものは '*') に振り分ける。
  // 色・書体・文字は TDLooks が TextDeform.P へ当てる (Operator の色はプリセットの値)。
  // 前の Look の絵はすぐ捨てる (新しい色・書体の上に前の Look の効果が残らないように)。新しい絵が届くまでの元の字は新しい Look の sourceAlpha で描く
  applyPreset(id){
    const p = this.presets && this.presets.presets.find(x=>x.id === id);
    if(!p || !this.meta) return;
    const owner = {};
    for(const op of p.operators){
      const m = this.meta.ops[op];
      if(!m) continue;
      for(const k of m.keys) owner[k.key] = op;
      for(const k of Object.values(m.surfaceKeys || {})) owner[k] = op;
    }
    const params = {};
    for(const k of Object.keys(p.params)){
      const op = owner[k] || '*';
      (params[op] || (params[op] = {}))[k] = p.params[k];
    }
    this.cfg = merge(this.cfg, {});
    this.cfg.enabled = true;
    this.cfg.preset = id; this.cfg.ops = p.operators.slice(); this.cfg.op = p.operators[0];
    this.cfg.params = params;
    this.cfg.source = 'op'; this.cfg.blend = 'op'; this.cfg.color = 'op'; this.cfg.opacity = 1; this.cfg.pixel = 1;
    this.layers = []; this._fresh = true;
    this._reset();
    if(this.cfg.enabled) this.ensure();
  },

  // 設定が変わったら位相・レイヤーはそのまま、envelope だけ戻して描き直させる
  _reset(){
    this.envelopeScale = 1; this._noEnvelope = false;
    this._dirty = true;
    if(this.jobs) this.jobs.invalidate();
    if(!this.cfg.enabled) this.layers = [];
    this._notify();
  },

  _onJobState(s){
    if(s.error && this._pending && s.key === this._pending.key){
      this._pending = null;
      // Worker ごと落ちた (読み込み失敗・クラッシュ) ときは間を空けて作り直す。描画範囲の問題ではないので envelope は触らない
      if(s.errorCode === 'RENDER_WORKER_FAILED' && (this._workerRetry || 0) < 4){
        const n = this._workerRetry = (this._workerRetry || 0) + 1;
        this._retryAt = performance.now() + 500 * n * n;
        return;
      }
      // 描画範囲を広げすぎて作業上限を超えたときは、拡張をやめて元の範囲で描き直す (はみ出しは切れる)
      if(this.envelopeScale > 1 || !this._noEnvelope){ this.envelopeScale = 1; this._noEnvelope = true; this._dirty = true; return; }
      this._fresh = false;
      if(!this._errShown){ this._errShown = true; this.error = s.error; console.warn('[TDSurf]', s.error); this._notify(); }
      return;
    }
    if(!s.ready || !s.result || !this._pending || s.key !== this._pending.key) return;
    const req = this._pending; this._pending = null;
    const r = s.result;
    if(r.kind === 'envelope'){
      this.envelopeScale = Math.max(this.envelopeScale * 1.5, r.requiredScale || 1);
      return;
    }
    const next = [];
    req.ops.forEach((o, i)=>{
      const bmp = r.layers && r.layers[o.id];
      if(!bmp) return;
      const c = (this.layers[i] && this.layers[i].canvas) || this._takeCanvas();
      if(c.width !== req.w || c.height !== req.h){ c.width = req.w; c.height = req.h; }
      const x = c.getContext('2d');
      x.setTransform(1,0,0,1,0,0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      x.clearRect(0, 0, c.width, c.height);
      x.drawImage(bmp, 0, 0);
      next.push({ canvas: c, w: req.w, h: req.h, k: req.k || 1, px: req.px || 1, opacity: o.opacity, blend: o.blend, under: !!o.under });
    });
    if(!next.length) return;
    this.layers = next; this._fresh = false;
    this.lastMs = r.duration || 0;
    this.error = ''; this._errShown = false; this._workerRetry = 0;
    this._notify();
  },

  // 効果の絵のキャンバスの使い回し (Canvas の焼き付けで毎回作り捨てると GPU 側の描画メモリが溜まる)
  _pool: [],
  _takeCanvas(){ return this._pool.pop() || document.createElement('canvas'); },
  _giveCanvas(c){
    if(!c) return;
    const px = this._pool.reduce((a, x) => a + x.width*x.height, 0);
    if(this._pool.length < 8 && px + c.width*c.height <= 8e6) this._pool.push(c); else { c.width = 0; c.height = 0; }   // 合計 8M 画素まで
  },
  _dp(v){ return TD._dp(v); },
  strength(){ return Math.max(0, Math.min(1, this._dp(+this.cfg.strength || 0))); },
  chance(){ return Math.max(0, Math.min(1, this._dp(+this.cfg.chance || 0))); },
  glyphActive(i){
    const c = this.chance();
    return c > 0 && TD._h(i, 731.17 + (TD.P.seed || 0)*3.1) < c;
  },
  // 元の文字の不透明度 (効果が掛かっている文字だけに使う)。重ねた Operator のうち一番小さい値
  // Look では半透明だった効果を不透明で描いている (KEEP_ALPHA に無い Operator の Opacity が 1 未満) なら true。
  // そのときは元の字を効果の上にもう一度描く (効果が不透明になって文字を隠さないように)
  textOnTop(){
    if(!this.layers.length) return false;
    const P = this._params();
    return this.activeOps().some(op => this._forcedOpaque(op, P));
  },
  // Look では半透明 (Opacity < 1) なのに、表現上必要な Operator ではないので不透明で描いている効果か
  _forcedOpaque(op, params){
    const k = !KEEP_ALPHA.has(op) && this.registry.tables.SURFACE_OPACITY_KEYS[op];
    return !!k && Number(params[k]) < 1;
  },
  sourceAlpha(){
    if(!this.layers.length && !this._fresh) return 1;   // Surface を手で入れたときは最初の絵が届くまで元の字を隠さない (Look の切り替えでは隠す)
    const P = this._params(), reg = this.registry.tables;
    let a = 1;
    for(const op of this.activeOps()){
      const sk = reg.SURFACE_SOURCE_OPACITY_KEYS[op], mk = reg.SURFACE_SOURCE_MODE_KEYS[op];
      const v = sk ? Number(P[sk]) : NaN;
      let s;
      if(this.cfg.source === 'op' && isFinite(v)) s = Math.max(0, Math.min(1, v));
      else {
        const mode = this.cfg.source === 'op' ? (mk && P[mk]) || 'keep' : this.cfg.source;
        s = mode === 'hide' ? 0 : (mode === 'ghost' ? 0.22 : 1);
      }
      a = Math.min(a, s);
    }
    return a;
  },
  advance(dt, pulse){
    if(this.cfg.enabled && this.status === 'idle') this.ensure().catch(()=>{});
    if(!this.active()) return;
    // Worker が描いている間は進めない (届く絵と位相を揃える)
    if(this.jobs && this.jobs.status().busy) return;
    this.phase = (this.phase + dt * this._dp(+this.cfg.speed || 0) * (pulse || 1)) % 1;
  },

  opValue(op, key){
    const p = this.cfg.params[op], g = this.cfg.params['*'];
    if(p && p[key] != null) return p[key];
    if(g && g[key] != null) return g[key];
    return this.model ? this.model.PARAM_DEFAULTS[key] : undefined;
  },
  randomize(op){
    const meta = this.meta && this.meta.ops[op];
    if(!meta) return;
    const p = {};
    for(const k of meta.keys){
      if(k.kind === 'range'){
        const n = Math.round((k.max - k.min)/k.step);
        p[k.key] = +(k.min + Math.floor(Math.random()*(n + 1))*k.step).toFixed(6);
      } else if(k.kind === 'select' && k.options.length){
        p[k.key] = k.options[Math.floor(Math.random()*k.options.length)][0];
      }
    }
    this.set({ params: { [op]: Object.assign({}, this.cfg.params[op] || {}, p) } });
  },
  resetParams(op){
    const params = clone(this.cfg.params); delete params[op];
    this.cfg.params = params;
    this._reset();
  },

  // cfg と TextDeform の書体・色が変わったときだけ作り直す (描画のたびに上流の全既定値を複製しない)
  _params(){
    const P = TD.P, ops = this.activeOps();
    const key = JSON.stringify(this.cfg) + UP.paramsKey();
    if(this._paramsCache && this._paramsKey === key) return this._paramsCache;
    const out = UP.params();
    if(P.palOn && this.cfg.color === 'op' && ops.includes('misregistration')){
      if(P.misregColorA) out.misregColorA = P.misregColorA;
      if(P.misregColorB) out.misregColorB = P.misregColorB;
    }
    Object.assign(out, this.cfg.params['*'] || {});
    for(const op of ops) Object.assign(out, this.cfg.params[op] || {});
    out.activeOperator = this.cfg.op;
    const reg = this.registry.tables;
    // 共通パレットは Operator の色も近い役割へ色差を保って移す。Paper only は Base の役割だけ
    const palAll = P.palOn === true, colMode = this.cfg.color;
    if(P.palOn) out.paper = TD.color('paper');
    if(palAll){ out.ink = TD.color('ink'); out.accent = TD.color('accent'); }
    for(const op of ops){
      const ck = reg.SURFACE_COLOR_KEYS[op], sk = (this.meta.ops[op] && this.meta.ops[op].surfaceKeys) || {};
      if(colMode !== 'op'){
        const main = TD.color(colMode === 'accent' ? 'accent' : 'ink');
        if(ck) out[ck] = main;
        if(sk.secondaryColor) out[sk.secondaryColor] = TD.color(colMode === 'accent' ? 'ink' : 'accent');
      } else if(P.palOn){
        // 2 色目が 1 色目と同じ役割になったら、もう一方 (Key ⇄ Accent) へ回して 2 色刷りを保つ
        const sc = sk.secondaryColor, has = k=>k && typeof out[k] === 'string';
        const r1 = has(ck) && (MISREG_ROLE[ck] || TD.colorRole(out[ck]));
        let r2 = has(sc) && (MISREG_ROLE[sc] || TD.colorRole(out[sc]));
        if(r2 && r2 === r1) r2 = r1 === 'accent' ? 'ink' : 'accent';
        if(r1) out[ck] = TD.roleColor(out[ck], r1);
        if(r2) out[sc] = TD.roleColor(out[sc], r2);
      }
    }
    this._paramsCache = out; this._paramsKey = key;
    return out;
  },
  _opOpacity(op, params){
    const k = KEEP_ALPHA.has(op) && this.registry.tables.SURFACE_OPACITY_KEYS[op];
    const v = k ? Number(params[k]) : 1;
    return (isFinite(v) ? Math.max(0, Math.min(1, v)) : 1) * Math.max(0, Math.min(1, +this.cfg.opacity));
  },
  _opBlend(op, params){
    const k = this.registry.tables.SURFACE_BLEND_KEYS[op];
    const b = this.cfg.blend === 'op' ? (k && params[k]) : this.cfg.blend;
    return BLENDS.includes(b) ? b : 'source-over';
  },

  // ドキュメントの @font-face を Worker へ渡す (Worker は document のフォントを見られない)。
  // 書体スタックに含まれ、文字の unicode-range に掛かる規則だけに絞る (全部だと 1 回 600KB を超える)
  _collectFontCss(stack, text){
    const key = document.styleSheets.length + '|' + stack + '|' + text;
    if(this._fontCss && this._fontCssKey === key) return this._fontCss;
    const fams = new Set(String(stack).split(',').map(f=>f.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean));
    const cps = Array.from(new Set(Array.from(text))).map(ch=>ch.codePointAt(0));
    const inRange = range=>{
      if(!range) return true;
      return range.split(',').some(r=>{
        r = r.trim().replace(/^U\+/i, '');
        const ab = r.includes('?') ? [parseInt(r.replace(/\?/g, '0'), 16), parseInt(r.replace(/\?/g, 'F'), 16)] : r.split('-').map(x=>parseInt(x, 16));
        const lo = ab[0], hi = ab[1] == null ? ab[0] : ab[1];
        return cps.some(cp=>cp >= lo && cp <= hi);
      });
    };
    const out = [];
    for(const sheet of Array.from(document.styleSheets)){
      let rules = null;
      try{ rules = sheet.cssRules; }catch(e){ if(sheet.href) out.push({ href: sheet.href }); continue; }
      if(!rules) continue;
      let css = '';
      for(const r of Array.from(rules)){
        if(r.type !== 5) continue;   // CSSFontFaceRule
        const fam = (r.style.getPropertyValue('font-family') || '').trim().replace(/^['"]|['"]$/g, '');
        if(fams.has(fam) && inRange(r.style.getPropertyValue('unicode-range'))) css += r.cssText + '\n';
      }
      if(css) out.push({ text: css, base: sheet.href || location.href });
    }
    this._fontCss = out; this._fontCssKey = key;
    return out;
  },

  // TextDeform._renderToCanvas から毎フレーム呼ぶ。Worker が空いていれば次のフレームを頼む。
  request(glyphs, w, h){
    if(!this.active() || !this.jobs) return;
    if(this._retryAt){ if(performance.now() < this._retryAt) return; this._retryAt = 0; }
    // 描画中は待つ。ただし設定が変わったときは頼み直す (古い描画は interruptAfter で打ち切られる)
    if(this.jobs.status().busy && !this._dirty) return;
    this._dirty = false;
    const ops = this.activeOps(), str = this.strength();
    if(str <= 0){ this._fresh = false; return; }
    const f = TD._fit;
    if(!f) return;
    const params = this._params();
    const surface = Object.assign({}, params);
    for(const op of ops) surface[op] = str;
    const up = [];
    for(const g of glyphs){
      const u = TD._upstreamGlyph(g, 0, 0);
      u.surface = this.glyphActive(g.i) ? surface : null;
      up.push(u);
    }
    if(!up.some(g => g.surface)){ this._fresh = false; return; }
    const packed = globalThis.TypeDeformerSurfaceState.pack(up, params);
    // 字を大きく拡大した版面 (fit.s > 2) は効果を拡大率の半分の縮小解像度で描いて引き伸ばす
    // (等倍で描くと作業キャンバスが上限を超えやすく、時間も拡大率に比例して延びる。拡大率そのままでは 1 語の Look がぼやける)
    // Pixel (粗さ) > 1 はさらにその倍率で粗く描き、draw でドットのまま拡大する
    const px = Math.max(1, Math.min(16, Math.round(+this.cfg.pixel || 1)));
    const k = Math.max(1, f.s / 2) * px, rw = Math.max(1, Math.ceil(w/k)), rh = Math.max(1, Math.ceil(h/k));
    this.moshFrame++;
    const frame = {
      kind: 'frame', purpose: 'edit', mobile: false,
      params, composition: { enabled: false, phase: 0 }, text: String(TD.P.text || ''),
      surfacePhase: this.phase, dataMoshFrame: this.moshFrame, blobTrack: { blobs: [] },
      glyphs: packed.glyphs, surfaces: packed.surfaces, fm: TD._fontMetrics(TD.ctx),
      scale: 1, layout: { s: f.s/k, dx: f.dx/k, dy: f.dy/k }, width: rw, height: rh,
      operators: ops, envelopeScale: this.envelopeScale, noEnvelope: !!this._noEnvelope
    };
    // キー: params は _params() のキャッシュキーで代用 (約 1,000 キーを毎回文字列化しない)
    frame.params = null;
    const key = this._paramsKey + JSON.stringify(frame);
    frame.params = params;
    frame.fontCss = this._collectFontCss(params.fontFamily, frame.text + glyphs.map(g=>g.ch).join(''));
    this._pending = { key, w: rw, h: rh, k, px, ops: ops.map(op=>({ id: op, opacity: this._opOpacity(op, params), blend: this._opBlend(op, params), under: this._forcedOpaque(op, params) })) };
    this.jobs.request(key, frame);
  },

  // 効果レイヤーを重ね順どおりに vj のキャンバスへ重ねる (viewAngle の回転も文字と同じに掛ける)
  draw(ctx, w, h, va){
    if(!this.active() || !this.layers.length) return;
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    if(va){ ctx.translate(w/2, h/2); ctx.rotate(va); ctx.translate(-w/2, -h/2); }
    // 半透明から不透明にした効果 (under) を先に下へ敷き、字の形を描く効果をその上に重ねる (不透明になった効果が文字を隠さないように)
    for(const under of [true, false]) for(const L of this.layers){
      if(!!L.under !== under) continue;
      ctx.globalAlpha = L.opacity;
      ctx.globalCompositeOperation = L.blend;
      ctx.imageSmoothingEnabled = L.px <= 1;
      ctx.drawImage(L.canvas, 0, 0, L.w, L.h, 0, 0, L.w*L.k, L.h*L.k);
    }
    ctx.restore();
  }
};
globalThis.TDSurf = TDSurf;
// P.surf = Surface の保存値。JSON 化・Object.assign がこのアクセサを通る
Object.defineProperty(TD.P, 'surf', { enumerable: true, configurable: true,
  get(){ return TDSurf.snapshot(); },
  set(v){ TDSurf.apply(v); } });
})();
