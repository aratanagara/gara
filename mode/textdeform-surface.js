/* ================= Type Deformer — Surface (上流 0.3 の描画エンジン) =================
 * synomare/type-deformer 0.3 の Surface Operator 100 種を、上流の render-engine.js (MIT) を
 * Worker で動かして TextDeform に重ねる。エンジン本体は mode/typedeformer/ に無改変で同梱し、
 * ON にした時点で初めて読み込む (会場の弱 Wi-Fi 対策)。
 *   - Operator ごとのパラメータ表 = mode/typedeformer/vj-operator-params.json
 *     (上流の UI パネルから scripts/gen_td_params.py で生成)
 *   - プリセット = 上流の「厳選」147 案 (作者の許諾を得て同梱。mode/typedeformer/vj-presets.json と presets/*.jpg、
 *     scripts/gen_td_presets.py で生成)。1 案に Operator が最大 3 つあり、プリセットの surfaceOrder の順に重ねる。
 *   - 状態は md 単位 (pr.p.surf)。loadPreset が TDSurf.applyMd() で適用し、保存の無い md では Off。
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
const DEFAULTS = {
  enabled: false,
  op: 'plotterTrace',      // パラメータを編集している Operator
  ops: [],                 // 重ねる Operator (空なら [op])。プリセットを選ぶと最大 3 つ
  preset: '',              // 選んだプリセットの id ('' = Custom)
  presetEvery: 0,          // S Auto: この拍数ごとにプリセットをランダムに切り替える (0 = Off)
  strength: 1, chance: 1, speed: 0.25,
  source: 'op',            // op = Operator の既定 / keep / ghost / hide (元の文字の見せ方)
  opacity: 1, blend: 'op', // blend: op = Operator の既定
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
  // 1 フレームが 1.5 秒を超える Operator (約 25 字の md・MacBook で計測)。一覧で (重い) と表示する
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
  applyMd(saved){
    this.cfg = merge(DEFAULTS, saved);
    this.layers = [];   // 別の md (別の文字) に前の効果を重ねない
    this._reset();
    if(this.cfg.enabled) this.ensure();
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
        workerFactory: ()=>new Worker(new URL(UP.BASE + 'vj-surface-worker.js' + UP.q, document.baseURI)),
        encode: job=>({ id: job.id, payload: job.payload }),
        onState: s=>this._onJobState(s)
      });
      this.status = 'ready';
      this._notify();
      this.loadPresets();   // 一覧は後から届けばよい (保存済みの md はプリセットの値を cfg に持っている)
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
  // ランダムに選ぶプリセット (重い Operator を含むものと、いまのものは除く)
  randomPresetId(){
    const L = this.presets ? this.presets.presets.filter(p => p.id !== this.cfg.preset && !p.operators.some(o => this.HEAVY.includes(o))) : [];
    return L.length ? L[Math.floor(Math.random()*L.length)].id : '';
  },
  // S Auto: TextDeform.update から毎フレーム。presetEvery 拍ごとにプリセットを切り替える (md へは書かない = ライブだけ)
  beatTick(beat){
    const every = +this.cfg.presetEvery || 0;
    if(!(every > 0) || !this.active() || !this.presets){ this._autoSlot = null; return; }
    const slot = Math.floor((beat || 0) / every + 1e-6);
    if(this._autoSlot == null || slot < this._autoSlot){ this._autoSlot = slot; return; }
    if(slot === this._autoSlot) return;
    this._autoSlot = slot;
    const id = this.randomPresetId();
    if(id){ const ev = this.cfg.presetEvery; this.applyPreset(id); this.cfg.presetEvery = ev; this._notify(); }
  },
  presetThumb(id){ return UP.BASE + 'presets/' + id + '.jpg' + UP.q; },
  // プリセットを適用: Operator を差し替え、値を Operator ごと (属さないものは '*') に振り分ける。
  // 書体・組版・紙とインクの色は md 側の値のまま (Operator の色はプリセットの値)
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
    this.layers = [];
    this.cfg = merge(this.cfg, {});
    this.cfg.preset = id; this.cfg.ops = p.operators.slice(); this.cfg.op = p.operators[0];
    this.cfg.params = params;
    this.cfg.source = 'op'; this.cfg.blend = 'op'; this.cfg.color = 'op'; this.cfg.opacity = 1;
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
      // 描画範囲を広げすぎて作業上限を超えたときは、拡張をやめて元の範囲で描き直す (はみ出しは切れる)
      if(this.envelopeScale > 1 || !this._noEnvelope){ this.envelopeScale = 1; this._noEnvelope = true; this._dirty = true; return; }
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
      const c = (this.layers[i] && this.layers[i].canvas) || document.createElement('canvas');
      if(c.width !== req.w || c.height !== req.h){ c.width = req.w; c.height = req.h; }
      const x = c.getContext('2d');
      x.setTransform(1,0,0,1,0,0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      x.clearRect(0, 0, c.width, c.height);
      x.drawImage(bmp, 0, 0);
      next.push({ canvas: c, w: req.w, h: req.h, k: req.k || 1, opacity: o.opacity, blend: o.blend });
    });
    if(!next.length) return;
    this.layers = next;
    this.lastMs = r.duration || 0;
    this.error = ''; this._errShown = false;
    this._notify();
  },

  _dp(v){ return TD._dp(v); },
  strength(){ return Math.max(0, Math.min(1, this._dp(+this.cfg.strength || 0))); },
  chance(){ return Math.max(0, Math.min(1, this._dp(+this.cfg.chance || 0))); },
  glyphActive(i){
    const c = this.chance();
    return c > 0 && TD._h(i, 731.17 + (TD.P.seed || 0)*3.1) < c;
  },
  // 元の文字の不透明度 (効果が掛かっている文字だけに使う)。重ねた Operator のうち一番小さい値
  sourceAlpha(){
    if(!this.layers.length) return 1;   // 最初の絵が届くまでは元の字を隠さない
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

  // cfg と md の書体・色が変わったときだけ作り直す (描画のたびに上流の全既定値を複製しない)
  _params(){
    const P = TD.P, ops = this.activeOps();
    const key = JSON.stringify(this.cfg) + UP.paramsKey();
    if(this._paramsCache && this._paramsKey === key) return this._paramsCache;
    const out = Object.assign(UP.params(), this.cfg.params['*'] || {});
    for(const op of ops) Object.assign(out, this.cfg.params[op] || {});
    out.activeOperator = this.cfg.op;
    const reg = this.registry.tables;
    for(const op of ops){
      const ck = reg.SURFACE_COLOR_KEYS[op], sk = (this.meta.ops[op] && this.meta.ops[op].surfaceKeys) || {};
      if(this.cfg.color !== 'op'){
        const main = this.cfg.color === 'accent' ? P.accent : P.ink;
        if(ck) out[ck] = main;
        if(sk.secondaryColor) out[sk.secondaryColor] = this.cfg.color === 'accent' ? P.ink : P.accent;
      }
    }
    this._paramsCache = out; this._paramsKey = key;
    return out;
  },
  _opOpacity(op, params){
    const k = this.registry.tables.SURFACE_OPACITY_KEYS[op];
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
    // 描画中は待つ。ただし設定が変わったときは頼み直す (古い描画は interruptAfter で打ち切られる)
    if(this.jobs.status().busy && !this._dirty) return;
    this._dirty = false;
    const ops = this.activeOps(), str = this.strength();
    if(str <= 0) return;
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
    if(!up.some(g => g.surface)) return;
    const packed = globalThis.TypeDeformerSurfaceState.pack(up, params);
    // 字を大きく拡大した md (fit.s > 1) は効果を縮小解像度で描いて引き伸ばす
    // (等倍以上で描くと作業キャンバスが上限を超えやすく、時間も拡大率に比例して延びる)
    const k = Math.max(1, f.s), rw = Math.max(1, Math.ceil(w/k)), rh = Math.max(1, Math.ceil(h/k));
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
    this._pending = { key, w: rw, h: rh, k, ops: ops.map(op=>({ id: op, opacity: this._opOpacity(op, params), blend: this._opBlend(op, params) })) };
    this.jobs.request(key, frame);
  },

  // 効果レイヤーを重ね順どおりに vj のキャンバスへ重ねる (viewAngle の回転も文字と同じに掛ける)
  draw(ctx, w, h, va){
    if(!this.active() || !this.layers.length) return;
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    if(va){ ctx.translate(w/2, h/2); ctx.rotate(va); ctx.translate(-w/2, -h/2); }
    for(const L of this.layers){
      ctx.globalAlpha = L.opacity;
      ctx.globalCompositeOperation = L.blend;
      ctx.drawImage(L.canvas, 0, 0, L.w, L.h, 0, 0, L.w*L.k, L.h*L.k);
    }
    ctx.restore();
  }
};
globalThis.TDSurf = TDSurf;
})();
