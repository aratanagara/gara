/* ================= Type Deformer — Look =================
 * Look = 見た目一式。TextDeform.P の色・書体・組版・変形 (TD_LOOK_KEYS) + Surface (P.surf)。Composition (P.comp) は Look に含めず、Text のように独立した値。
 * 文字 (P.text) は Look とは別 (Text 欄)。Look を変えても文字は変わらず、文字を変えても Look は変わらない。
 *   - Featured: 上流 type-deformer の厳選プリセット (mode/typedeformer/vj-presets.json + presets/*.jpg、作者の許諾を得て同梱)。
 *     プリセットの紙・インク・アクセント色、書体・太さ・字間、Surface の Operator と値を当てる。
 *     Text = Look のときはプリセットの語 (FORM など) を表示する
 *   - Saved: 保存 Look。正はサーバー store (presets/store.php?name=tdcombos。全端末で共通、保存のたびに世代を残す)、
 *     空なら初期リスト mode/textdeform-combos.json (presets/*.json は deploy.yml が本番を上書きしないので mode/ に置く)。
 *     1 件 = { name, style (TD_LOOK_KEYS のうち既定値と違うもの), surf, thumb (一覧のサムネ。保存時の描画の data URL、
 *     初期リストは mode/textdeform-combos/<番号>.jpg) }
 *   - P.look = 'f:<id>' / 's:<番号>'。P.lookPool で一覧・Random・Auto の対象を絞り、P.lookEvery 拍ごとに Auto で引き直す。
 *     Random / Auto は重い Operator (TDSurf.HEAVY) を含む Featured を選ばない
 * ======================================================== */
function createTDLooks(TD, peers){
'use strict';
peers = peers || globalThis;
if(!TD) return;
const VER = (()=>{ const s = document.currentScript && document.currentScript.src; const m = s && /[?&]v=([^&]+)/.exec(s); return m ? m[1] : ((globalThis.TDUpstream && globalThis.TDUpstream.q || '').replace(/^\?v=/, '')); })();
const clone = v => JSON.parse(JSON.stringify(v));
const DEFAULT_LOOK = 'f:055-mirrored-sigil';   // 既定の Look (Surface が軽く、サムネと同じ構図になるもの)
// Surface の Worker では描かない上流の Operator のうち、TextDeform 側に同じ名前の値があるもの (プリセットの値をそのまま当てる)
const NATIVE_OPS = { skew: ['skewX', 'skewY'], rotate: ['rotateAngle'], baselineShift: ['baselineShift'], mirror: ['mirrorX', 'mirrorY'] };

const TDLooks = {
  saved: null, _loading: null, _onChange: null, _busy: false, _autoSlot: null,
  _storeUrl(){ return (typeof App !== 'undefined' && App._storeBase ? App._storeBase() : 'presets/store.php') + '?name=tdcombos'; },
  onChange(fn){ this._onChange = fn; },
  _notify(){ if(this._onChange) try{ this._onChange(this); }catch(e){} },

  // ---- 一覧 ----
  load(){
    const f = (typeof peers.TDSurf !== 'undefined') ? peers.TDSurf.loadPresets() : Promise.resolve();
    return Promise.all([f, this.loadSaved()]).then(()=>{ this._notify(); return this; });
  },
  loadSaved(){
    if(this.saved) return Promise.resolve(this.saved);
    if(this._loading) return this._loading;
    this._loading = (async ()=>{
      let list = null;
      try{ const r = await fetch(this._storeUrl(), { cache: 'no-store' }); if(r.ok){ const d = await r.json(); if(Array.isArray(d) && d.length) list = d; } }catch(e){}
      if(!list){
        try{ const r = await fetch('mode/textdeform-combos.json' + (VER ? '?v=' + VER : '')); if(r.ok) list = await r.json(); }catch(e){}
      }
      this.saved = Array.isArray(list) ? list : [];
      this._loading = null;
      this._notify();
      return this.saved;
    })();
    return this._loading;
  },
  // 上流のプリセット全件 (436 案、作者の許諾済み)。作者のオススメは p.featured
  featured(){ return (typeof peers.TDSurf !== 'undefined' && peers.TDSurf.presets) ? peers.TDSurf.presets.presets : []; },
  families(){ return (typeof peers.TDSurf !== 'undefined' && peers.TDSurf.presets) ? peers.TDSurf.presets.families : []; },
  heavy(p){ return !!p && p.operators.some(o => peers.TDSurf.HEAVY.includes(o)); },
  // pool の Look の id (表示順)。pool = all / saved / featured / family id
  // pool = all (全プリセット + 保存) / recommended (作者のオススメ = p.featured) / presets (全プリセット) / 系統 id / saved。前の 'featured' はオススメとして読む
  ids(pool){
    pool = pool || TD.P.lookPool || 'all';
    if(pool === 'featured') pool = 'recommended';
    const out = [];
    if(pool !== 'saved') for(const p of this.featured()) if(pool === 'all' || pool === 'presets' || (pool === 'recommended' && p.featured) || p.family === pool) out.push('f:' + p.id);
    if(pool === 'all' || pool === 'saved') (this.saved || []).forEach((c, i)=>out.push('s:' + i));
    return out;
  },
  get(id){
    id = String(id || '');
    if(id.startsWith('f:')){ const p = this.featured().find(x => x.id === id.slice(2)); return p ? { kind: 'f', item: p } : null; }
    if(id.startsWith('s:')){ const c = (this.saved || [])[parseInt(id.slice(2), 10)]; return c ? { kind: 's', item: c } : null; }
    return null;
  },
  label(id){
    const L = this.get(id);
    if(!L) return '';
    return L.kind === 'f' ? String(L.item.n).padStart(3, '0') + ' ' + L.item.name : L.item.name;
  },
  thumb(id){
    if(id.startsWith('f:')) return peers.TDSurf.presetThumb(id.slice(2));
    const L = this.get(id);
    return (L && L.item.thumb) || '';
  },
  // いまの描画 (TextDeform のキャンバス) を Featured のサムネと同じ 600:370 に切り抜いた JPEG の data URL
  snapshotThumb(){
    const src = TD.canvas;
    if(!src || !src.width || !src.height) return '';
    const W = 300, H = 185, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const s = Math.max(W/src.width, H/src.height), sw = W/s, sh = H/s;
    c.getContext('2d').drawImage(src, (src.width - sw)/2, (src.height - sh)/2, sw, sh, 0, 0, W, H);
    try{ return c.toDataURL('image/jpeg', 0.8); }catch(e){ return ''; }
  },

  // ---- 適用 ----
  // Featured の見た目 (色・書体・字間 + TextDeform 側で描く Operator の値)。それ以外は既定値
  featuredStyle(p){
    const st = { paper: p.paper, ink: p.ink, accent: p.accent };
    if(p.fontFamily) st.fontFamily = p.fontFamily;
    if(p.fontWeight != null) st.fontWeight = p.fontWeight;
    if(p.letterSpacing != null) st.letterSpacing = p.letterSpacing;
    if(p.lineHeight != null) st.lineHeight = p.lineHeight;
    let native = false;
    for(const op of p.skipped || []) for(const k of NATIVE_OPS[op] || []){
      if(p.params[k] != null){ st[k] = p.params[k]; native = true; }
    }
    if(native) st.opChance = 1;
    return st;
  },
  async apply(id){
    let L = this.get(id);
    if(!L){ await this.load(); L = this.get(id); }
    if(!L) return false;
    if(L.kind === 'f'){
      try{ await peers.TDSurf.ensure(); }catch(e){ return false; }
      TD.applyLookStyle(this.featuredStyle(L.item), L.item.text);
      peers.TDSurf.applyPreset(L.item.id);
    } else {
      const c = L.item;
      TD.applyLookStyle(c.style || {}, '');
      TD.P.surf = c.surf ? clone(c.surf) : { enabled: false };
    }
    TD.P.look = id;
    this._notify();
    return true;
  },
  // pool からランダムに 1 つ (重い Featured と、いまの Look は除く)
  // ランダムの対象: P.lookRand = off (ランダムを切る。🎲・Look Auto・→ は何もせず、Canvas のスタンプは Current Look) / recommended (既定。プリセットはオススメだけ) / all (全プリセット)。保存 Look は Look Pool どおり
  pickRandom(pool){
    if(TD.P.lookRand === 'off') return '';
    const recOnly = (TD.P.lookRand || 'recommended') !== 'all';
    const ids = this.ids(pool).filter(id => !(id.startsWith('f:') && (this.heavy(this.get(id).item) || (recOnly && !this.get(id).item.featured))));
    const L = ids.length > 1 ? ids.filter(id => id !== TD.P.look) : ids;
    return L.length ? L[Math.floor(Math.random()*L.length)] : '';
  },
  async applyRandom(pool){
    await this.load();
    const id = this.pickRandom(pool);
    return id ? this.apply(id) : false;
  },
  // Look が未選択のとき (初回・保存デフォルトの無い Reset) に既定の Look を当てる (TextDeform.applyP から)
  start(){
    if(TD.P.look || this._starting) return;
    this._starting = true;
    this.apply(DEFAULT_LOOK).finally(()=>{ this._starting = false; });
  },
  // Look Auto: TextDeform.update から毎フレーム。P.lookEvery 拍ごとに pool からランダムに引き直す
  beatTick(beat){
    const every = +TD.P.lookEvery || 0;
    if(!(every > 0)){ this._autoSlot = null; return; }
    const slot = Math.floor((beat || 0) / every + 1e-6);
    if(this._autoSlot == null || slot < this._autoSlot){ this._autoSlot = slot; return; }
    if(slot === this._autoSlot || this._busy) return;
    this._autoSlot = slot;
    const now = performance.now();
    if(now - (this._autoAt || 0) < 400) return;   // ×A で極端に速くしても、読み込みが休みなく続いて固まらないように 0.4 秒は空ける
    this._autoAt = now;
    this._busy = true;
    this.applyRandom().finally(()=>{ this._busy = false; });
  },

  // ---- 保存 Look ----
  capture(name){
    TD._endBake();   // 焼き付け中はスタンプの Look が本体に入っているので、本体の Look に戻してから保存する
    const P = TD.P, D = TD.PDefaults || {}, style = {};
    for(const k of TD_LOOK_KEYS) if(P[k] !== undefined && JSON.stringify(P[k]) !== JSON.stringify(D[k])) style[k] = clone(P[k]);
    const surf = peers.TDSurf.cfg.enabled ? peers.TDSurf.snapshot() : null;
    return { name: name || ('Look ' + ((this.saved || []).length + 1)), style, surf, thumb: this.snapshotThumb() };
  },
  async _save(){
    const r = await fetch(this._storeUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.saved) });
    if(!r.ok) throw new Error('store ' + r.status);
  },
  async add(name){ await this.loadSaved(); this.saved.push(this.capture(name)); TD.P.look = 's:' + (this.saved.length - 1); await this._save(); this._notify(); },
  async overwrite(i){ await this.loadSaved(); if(!this.saved[i]) return; this.saved[i] = this.capture(this.saved[i].name); TD.P.look = 's:' + i; await this._save(); this._notify(); },
  async remove(i){ await this.loadSaved(); if(!this.saved[i]) return; this.saved.splice(i, 1); TD.P.look = ''; await this._save(); this._notify(); }
};

return TDLooks;
}
if(typeof TextDeform !== 'undefined') globalThis.TDLooks = createTDLooks(TextDeform);
