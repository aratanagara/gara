/* ================= Type Deformer — Surface (上流 0.3 の描画エンジン) =================
 * synomare/type-deformer 0.3 の Surface Operator 100 種を、上流の render-engine.js (MIT) を
 * Worker で動かして TextDeform に重ねる。エンジン本体は mode/typedeformer/ に無改変で同梱し、
 * ON にした時点で初めて読み込む (会場の弱 Wi-Fi 対策)。
 *   - Operator ごとのパラメータ表 = mode/typedeformer/vj-operator-params.json
 *     (上流の UI パネルから scripts/gen_td_params.py で生成)
 *   - 状態は md 単位 (pr.p.surf)。loadPreset が TDSurf.applyMd() で適用し、保存の無い md では Off。
 *   - Worker が描いている間は位相を止め、描き終えたら次のフレームを頼む (上流 editor の clock hold と同じ)。
 *     届いた効果レイヤーは自前のキャンバスへ写してから使う (キューは次の結果で古いビットマップを閉じるため)。
 * 上流のプリセット (436 件) はレシピ・画像とも All rights reserved のため同梱しない。
 * ===================================================================================== */
(function(){
'use strict';
if(typeof TextDeform === 'undefined') return;
const TD = TextDeform;
const UP = globalThis.TDUpstream;   // 共通部 (mode/textdeform-upstream.js)
const SCRIPTS = ['operator-registry.js', 'editor-model.js', 'surface-state.js', 'render-jobs.js'];
const BLENDS = ['source-over', 'multiply', 'screen', 'overlay', 'difference', 'lighter'];
const DEFAULTS = {
  enabled: false, op: 'plotterTrace',
  strength: 1, chance: 1, speed: 0.25,
  source: 'op',            // op = Operator の既定 / keep / ghost / hide (元の文字の見せ方)
  opacity: 1, blend: 'op', // blend: op = Operator の既定
  color: 'op',             // op = Operator の既定色 / ink / accent
  params: {}               // Operator id → { key: value } (既定値との差分)
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
  phase: 0, moshFrame: 0, envelopeScale: 1,
  layer: null, layerInfo: null, lastMs: 0,
  _loading: null, _pending: null, _fontCss: null, _onStatus: null,

  get(){ return this.cfg; },
  snapshot(){ return clone(this.cfg); },
  applyMd(saved){
    this.cfg = merge(DEFAULTS, saved);
    this.layer = null; this.layerInfo = null;   // 別の md (別の文字) に前の効果を重ねない
    this._reset();
    if(this.cfg.enabled) this.ensure();
  },
  set(over){
    const prevOp = this.cfg.op;
    this.cfg = merge(this.cfg, over);
    // Operator を替えたら前の Operator の絵は捨てる (新しい絵が届くまでは元の字をそのまま見せる)
    if(this.cfg.op !== prevOp){ this.layer = null; this.layerInfo = null; }
    // params は Operator ごとの差分なので、値を null で渡したキーは既定値へ戻す
    for(const op of Object.keys(this.cfg.params)){
      const p = this.cfg.params[op];
      for(const k of Object.keys(p)) if(p[k] == null) delete p[k];
    }
    this._reset();
    if(this.cfg.enabled) this.ensure();
  },
  active(){ return !!this.cfg.enabled && this.status === 'ready' && !!this.meta && !!this.meta.ops[this.cfg.op]; },
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
      return this;
    })().catch(e=>{
      this.status = 'error'; this.error = e.message || String(e); this._loading = null;
      console.warn('[TDSurf]', e); this._notify();
      throw e;
    });
    return this._loading;
  },

  // 設定が変わったら位相・レイヤーはそのまま、envelope だけ戻して描き直させる
  _reset(){
    this.envelopeScale = 1; this._noEnvelope = false;
    this._dirty = true;
    if(this.jobs) this.jobs.invalidate();
    if(!this.cfg.enabled){ this.layer = null; this.layerInfo = null; }
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
    const bmp = r.layers && r.layers[req.op];
    if(!bmp) return;
    if(!this.layer) this.layer = document.createElement('canvas');
    const c = this.layer;
    if(c.width !== req.w || c.height !== req.h){ c.width = req.w; c.height = req.h; }
    const x = c.getContext('2d');
    x.setTransform(1,0,0,1,0,0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(bmp, 0, 0);
    this.layerInfo = { w: req.w, h: req.h, opacity: req.opacity, blend: req.blend };
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
  // 元の文字の不透明度 (効果が掛かっている文字だけに使う)
  sourceAlpha(){
    if(!this.layerInfo) return 1;   // 最初の絵が届くまでは元の字を隠さない
    const op = this.cfg.op, P = this._params();
    const reg = this.registry.tables;
    const sk = reg.SURFACE_SOURCE_OPACITY_KEYS[op], mk = reg.SURFACE_SOURCE_MODE_KEYS[op];
    const v = sk ? Number(P[sk]) : NaN;
    if(this.cfg.source === 'op' && isFinite(v)) return Math.max(0, Math.min(1, v));
    const mode = this.cfg.source === 'op' ? (mk && P[mk]) || 'keep' : this.cfg.source;
    return mode === 'hide' ? 0 : (mode === 'ghost' ? 0.22 : 1);
  },
  advance(dt, pulse){
    if(!this.active()) return;
    // Worker が描いている間は進めない (届く絵と位相を揃える)
    if(this.jobs && this.jobs.status().busy) return;
    this.phase = (this.phase + dt * this._dp(+this.cfg.speed || 0) * (pulse || 1)) % 1;
  },

  // Operator の既定値 (上流 editor-model) + md の差分 + vj の書体・色
  opDefaults(op){
    const out = {}, d = this.model ? this.model.PARAM_DEFAULTS : {};
    const meta = this.meta && this.meta.ops[op];
    if(meta) for(const k of meta.keys) out[k.key] = d[k.key];
    return out;
  },
  opValue(op, key){
    const p = this.cfg.params[op];
    if(p && p[key] != null) return p[key];
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
    const P = TD.P, op = this.cfg.op;
    const key = JSON.stringify(this.cfg) + UP.paramsKey();
    if(this._paramsCache && this._paramsKey === key) return this._paramsCache;
    const out = Object.assign(UP.params(), this.cfg.params[op] || {});
    out.activeOperator = op;
    const reg = this.registry.tables;
    const ck = reg.SURFACE_COLOR_KEYS[op];
    const sk = this.meta.ops[op].surfaceKeys || {};
    if(this.cfg.color !== 'op'){
      const main = this.cfg.color === 'accent' ? P.accent : P.ink;
      if(ck) out[ck] = main;
      if(sk.secondaryColor) out[sk.secondaryColor] = this.cfg.color === 'accent' ? P.ink : P.accent;
    }
    const ok = reg.SURFACE_OPACITY_KEYS[op];
    if(ok) out[ok] = Math.max(0, Math.min(1, +this.cfg.opacity));
    this._paramsCache = out; this._paramsKey = key;
    return out;
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
    const op = this.cfg.op, str = this.strength();
    if(str <= 0) return;
    const f = TD._fit;
    if(!f) return;
    const params = this._params();
    const surface = Object.assign({}, params, { [op]: str });
    const up = [];
    for(const g of glyphs){
      const u = TD._upstreamGlyph(g, 0, 0);
      u.surface = this.glyphActive(g.i) ? surface : null;
      up.push(u);
    }
    if(!up.some(g => g.surface)) return;
    const packed = globalThis.TypeDeformerSurfaceState.pack(up, params);
    const reg = this.registry.tables, bk = reg.SURFACE_BLEND_KEYS[op];
    const blend = this.cfg.blend === 'op' ? (bk && params[bk]) : this.cfg.blend;
    this.moshFrame++;
    const frame = {
      kind: 'frame', purpose: 'edit', mobile: false,
      params, composition: { enabled: false, phase: 0 }, text: String(TD.P.text || ''),
      surfacePhase: this.phase, dataMoshFrame: this.moshFrame, blobTrack: { blobs: [] },
      glyphs: packed.glyphs, surfaces: packed.surfaces, fm: TD._fontMetrics(TD.ctx),
      scale: 1, layout: { s: f.s, dx: f.dx, dy: f.dy }, width: w, height: h,
      operators: [op], envelopeScale: this.envelopeScale, noEnvelope: !!this._noEnvelope
    };
    // キー: params は _params() のキャッシュキーで代用 (約 1,000 キーを毎回文字列化しない)
    frame.params = null;
    const key = this._paramsKey + JSON.stringify(frame);
    frame.params = params;
    frame.fontCss = this._collectFontCss(params.fontFamily, frame.text + glyphs.map(g=>g.ch).join(''));
    this._pending = { key, op, w, h, opacity: 1, blend: BLENDS.includes(blend) ? blend : 'source-over' };
    this.jobs.request(key, frame);
  },

  // 効果レイヤーを vj のキャンバスへ重ねる (viewAngle の回転も文字と同じに掛ける)
  draw(ctx, w, h, va){
    if(!this.active() || !this.layer || !this.layerInfo) return;
    const L = this.layerInfo;
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    if(va){ ctx.translate(w/2, h/2); ctx.rotate(va); ctx.translate(-w/2, -h/2); }
    ctx.globalAlpha = L.opacity;
    ctx.globalCompositeOperation = L.blend;
    ctx.drawImage(this.layer, 0, 0, L.w, L.h, 0, 0, w, h);
    ctx.restore();
  }
};
globalThis.TDSurf = TDSurf;
})();
