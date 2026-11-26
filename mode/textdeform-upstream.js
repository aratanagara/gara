/* ================= Type Deformer — 上流 0.3 エンジンの共通部 =================
 * mode/typedeformer/ (synomare/type-deformer 0.3 の描画エンジン、MIT) を
 * Surface (textdeform-surface.js) と Composition (textdeform-comp.js) で共有する。
 *   - load(): スクリプトを 1 回だけ読み込む (両方が同じファイルを頼んでも二重に実行しない)
 *   - params(): 上流の既定 params に、TextDeform の書体・組版・色を上書きしたもの
 * ============================================================================ */
function createTDUpstream(TD, peers){
'use strict';
peers = peers || globalThis;
if(!TD) return;
const BASE = 'mode/typedeformer/';
const VER = (()=>{ const s = document.currentScript && document.currentScript.src; const m = s && /[?&]v=([^&]+)/.exec(s); return m ? m[1] : ((globalThis.TDUpstream && globalThis.TDUpstream.q || '').replace(/^\?v=/, '')); })();
const q = VER ? '?v=' + VER : '';
// メインスレッドでエンジンを作るときの一覧 (vj-surface-worker.js の importScripts と同じ順)
const ENGINE = ['operator-registry.js', 'shared-surface-renderers.js', 'surface-state.js', 'render-context.js', 'render-envelope.js',
  'parameter-model.js', 'parameter-definitions.js', 'font-axes.js', 'text-layout.js',
  'numerical-kernels.js', 'structural-operators.js', 'pattern-tension-operators.js', 'wave-growth-operators.js', 'order-matter-operators.js',
  'hyperbolic-atlas-operator.js', 'loadpath-foundry-operator.js', 'nodal-glaze-operator.js', 'spinodal-alloy-operator.js', 'density-recast-operator.js',
  'hopf-loom-operator.js', 'miura-vault-operator.js', 'vortex-bath-operator.js', 'stress-glass-operator.js', 'excess-body-operators.js',
  'ramified-body-operators.js', 'folded-body-operators.js', 'letterform-body-operators.js', 'metamorphic-body-operators.js', 'gravity-lens-operator.js',
  'liquid-rope-body.js', 'wulff-body-operator.js', 'repulsive-curves-body.js', 'wasserstein-letters.js', 'field-material-operators.js',
  'conditions-of-type.js', 'editor-model.js', 'render-engine.js', 'surface-worker-adapter.js'];
const loaded = new Map();
function loadScript(src){
  return new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = src; s.async = false;
    s.onload = ()=>resolve(); s.onerror = ()=>{ s.remove(); reject(new Error(src + ' を読み込めませんでした')); };
    document.head.appendChild(s);
  });
}

const TDUpstream = {
  BASE, q, ENGINE,
  load(files){
    return files.reduce((p, f)=>p.then(()=>{
      if(!loaded.has(f)) loaded.set(f, loadScript(BASE + f + q).catch(e=>{ loaded.delete(f); throw e; }));
      return loaded.get(f);
    }), Promise.resolve());
  },
  model(){
    if(!this._model){
      const r = globalThis.TypeDeformerOperatorRegistry;
      this._model = globalThis.TypeDeformerEditorModel.create({ registry: r, surfaceIds: r.surfaceIds, dictionary: ()=>null });
    }
    return this._model;
  },
  params(){
    const P = TD.P, out = Object.assign({}, this.model().PARAM_DEFAULTS);
    out.fontFamily = TD._fontStack(TD.family());
    out.fontWeight = TD.weight(); out.fontSize = P.fontSize; out.lineHeight = TD.leading();
    out.vertical = !!P.vertical;
    out.ink = TD.color('ink'); out.paper = TD.color('paper'); out.accent = TD.color('accent');
    if(P.misregColorA) out.misregColorA = TD.roleColor(P.misregColorA, 'accent');
    if(P.misregColorB) out.misregColorB = TD.roleColor(P.misregColorB, 'ink');
    return out;
  },
  // params() のキャッシュキー (md の書体・組版・色が変わったら作り直す)
  paramsKey(){
    const P = TD.P;
    return JSON.stringify([TD.family(), TD.weight(), P.fontSize, TD.leading(), P.fontOver, P.vertical, String(P.palOn), TD.color('ink'), TD.color('paper'), TD.color('accent'), P.paper, P.ink, P.accent, P.misregColorA, P.misregColorB]);
  }
};

return TDUpstream;
}
if(typeof TextDeform !== 'undefined') globalThis.TDUpstream = createTDUpstream(TextDeform);
