/* ================= Type Deformer — 組み合わせリスト =================
 * Type Deformer の Random (見出しの Random 🎲 / Random All / Surface の Random) は完全な乱数ではなく、
 * このリストの組み合わせから選ぶ。1 件 = md の見た目 (色・書体・組版・変形) + Surface + Composition。
 *   - 正はサーバー store (presets/store.php?name=tdcombos。全端末で共通、保存のたびに世代を残す)
 *   - store が空のとき (初回・未保存) は初期リスト mode/textdeform-combos.json を使う
 *     (presets/*.json は deploy.yml の mirror で本番を上書きしないため、初期リストは mode/ に置く)
 *   - 保存・上書き・削除は Type Deformer 欄の Combo 行から。保存するとリスト全体を store へ書く
 * ==================================================================== */
(function(){
'use strict';
if(typeof TextDeform === 'undefined') return;
const TD = TextDeform;
const VER = (()=>{ const s = document.currentScript && document.currentScript.src; const m = s && /[?&]v=([^&]+)/.exec(s); return m ? m[1] : ''; })();
// 組み合わせに入れない md のキー: 版面の位置・倍率 (文字列ごとに合わせるもの) と、別に持つ comp / surf
const SKIP = new Set(['comp', 'surf', 'stageW', 'zoom', 'panX', 'panY', 'fitMode', 'marginPct']);
const clone = v => JSON.parse(JSON.stringify(v));

const TDCombos = {
  list: null, _loading: null, _onChange: null, current: -1,
  styleKeys(){ return TD_MD_STYLE_KEYS.filter(k => !SKIP.has(k)); },
  _storeUrl(){ return (typeof App !== 'undefined' && App._storeBase ? App._storeBase() : 'presets/store.php') + '?name=tdcombos'; },
  onChange(fn){ this._onChange = fn; },
  _notify(){ if(this._onChange) try{ this._onChange(this); }catch(e){} },
  load(){
    if(this.list) return Promise.resolve(this.list);
    if(this._loading) return this._loading;
    this._loading = (async ()=>{
      let list = null;
      try{ const r = await fetch(this._storeUrl(), { cache: 'no-store' }); if(r.ok){ const d = await r.json(); if(Array.isArray(d) && d.length) list = d; } }catch(e){}
      if(!list){
        try{ const r = await fetch('mode/textdeform-combos.json' + (VER ? '?v=' + VER : '')); if(r.ok) list = await r.json(); }catch(e){}
      }
      this.list = Array.isArray(list) ? list : [];
      this._loading = null;
      this._notify();
      return this.list;
    })();
    return this._loading;
  },
  async _save(){
    const r = await fetch(this._storeUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.list) });
    if(!r.ok) throw new Error('store ' + r.status);
  },
  // いまの md の見た目を 1 件にする (既定値と同じキーは持たない)
  capture(name){
    const P = TD.P, D = TD.PDefaults || {}, style = {};
    for(const k of this.styleKeys()) if(P[k] !== undefined && JSON.stringify(P[k]) !== JSON.stringify(D[k])) style[k] = clone(P[k]);
    const surf = (typeof TDSurf !== 'undefined' && TDSurf.cfg.enabled) ? TDSurf.snapshot() : null;
    const comp = (typeof TDComp !== 'undefined' && TDComp.enabled()) ? TDComp.snapshot() : null;
    return { name: name || ('Combo ' + ((this.list || []).length + 1)), style, surf, comp };
  },
  // 組み合わせを md i へ当てる。part = 'all' (見た目一式) / 'surf' (Surface だけ)
  apply(idx, part){
    const c = this.list && this.list[idx];
    const i = TD.currentMdIndex ? TD.currentMdIndex() : -1;
    if(!c || i < 0) return false;
    const over = {};
    if(part !== 'surf'){
      const D = TD.PDefaults || {};
      for(const k of this.styleKeys()) over[k] = clone(c.style && c.style[k] !== undefined ? c.style[k] : D[k]);
      over.comp = c.comp ? clone(c.comp) : null;
    }
    over.surf = c.surf ? clone(c.surf) : { enabled: false };
    TD.updateMdStyle(i, over);   // 永続化はしない (md の Save で保存)
    this.current = idx;
    this._notify();
    return true;
  },
  // ランダムに 1 件 (直前と同じものは避ける)。part = 'surf' のときは Surface を持つものだけ
  pickRandom(part){
    const ids = (this.list || []).map((c, i) => i).filter(i => part !== 'surf' || this.list[i].surf);
    if(!ids.length) return -1;
    const pool = ids.length > 1 ? ids.filter(i => i !== this.current) : ids;
    return pool[Math.floor(Math.random()*pool.length)];
  },
  applyRandom(part){ const i = this.pickRandom(part); return i >= 0 && this.apply(i, part); },
  async add(name){ await this.load(); this.list.push(this.capture(name)); this.current = this.list.length - 1; await this._save(); this._notify(); },
  async overwrite(idx){ await this.load(); if(!this.list[idx]) return; this.list[idx] = this.capture(this.list[idx].name); this.current = idx; await this._save(); this._notify(); },
  async remove(idx){ await this.load(); if(!this.list[idx]) return; this.list.splice(idx, 1); this.current = -1; await this._save(); this._notify(); }
};
globalThis.TDCombos = TDCombos;
})();
