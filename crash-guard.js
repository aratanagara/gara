/* ===================================================================
   CrashGuard — 描画クラッシュからの自動復帰
   - 1 秒ごとに見張る。状態 (App._collectState) が 4 秒変わらず、フレームが進み、
     スロットにエラーが無ければ「直前の正常な状態」として控える。
   - 検知: フレームが 5 秒進まない (stall) / メインスレッドが 4 秒以上止まった (hang) /
     前のシェーダが無いスロットでコンパイル・リンクに失敗した (compile) / WebGL コンテキストロスト (lost)。
   - 復帰: (1) 直前の正常な状態へ戻す。(2) 戻す先が今クラッシュした Visual と同じ、または
     3 分以内に 3 回目のクラッシュなら、Esc と同じ全リセット (両スロットなし + パラメータ初期化)。
   - コンテキストロストはその場で戻せないので、戻す先を localStorage に置いて再読み込みし、起動時に当てる。
     3 分以内に 3 回続いたら自動では戻さず、従来のセーフモード案内 (app.js の webglcontextlost) に任せる。
=================================================================== */
const CrashGuard = {
  KEY: 'vj.crashRecover',   // 再読み込み後に当てる状態 (JSON) か 'esc'
  LOG: 'vj.crashLog',       // 直近のクラッシュ [{t, reason, sig}]
  WINDOW_MS: 180000,        // ループ判定の窓 (3 分)
  _good: null, _cand: null, _candAt: 0,
  _lastFrame: -1, _lastFrameT: 0, _lastTick: 0, _busy: false, _reloading: false,

  init(){
    this._lastFrameT = this._lastTick = performance.now();
    setInterval(() => this._tick(), 1000);
  },
  _running(){
    return document.visibilityState === 'visible' && typeof GL !== 'undefined' && GL.gl
      && !App._halted && !GL._ctxLost && !GL.paused;
  },
  _cleanSlots(){
    return ['A', 'B'].every(k => { const s = GL.slots[k]; return !s || !s.errors; });
  },
  // 状態の目印 = 両スロットの Visual (同じ Visual へ戻してまた落ちるのを防ぐ)
  _sigOfState(st){
    const sl = (st && st.slots) || {};
    return ['A', 'B'].map(k => { const s = sl[k] || {}; return (s.kind || 'shader') + ':' + (s.presetName || ''); }).join('|');
  },
  _sigNow(){
    return ['A', 'B'].map(k => { const s = GL.slots[k] || {}; return (s.kind || 'shader') + ':' + (s._presetName || (UI.activePresetIdx && PRESETS[UI.activePresetIdx[k]] || {}).name || ''); }).join('|');
  },
  _log(){ try{ const a = JSON.parse(localStorage.getItem(this.LOG) || '[]'); return Array.isArray(a) ? a : []; }catch(_){ return []; } },
  _record(reason, sig){
    const now = Date.now();
    const log = this._log().filter(e => now - e.t < this.WINDOW_MS);
    log.push({ t: now, reason, sig });
    try{ localStorage.setItem(this.LOG, JSON.stringify(log.slice(-10))); }catch(_){}
    return log.length;   // 窓の中のクラッシュ回数 (今回を含む)
  },
  // 戻す先: 直前の正常な状態。今クラッシュした Visual と同じ状態へは、窓の中で最初の 1 回だけ戻す
  //   (一度きりの GPU リセットなら元へ戻す / 同じ Visual で 2 回目なら、その Visual が原因とみて Esc)
  _target(sig, count){
    if(count >= 3 || !this._good) return 'esc';
    try{ if(count >= 2 && this._sigOfState(JSON.parse(this._good)) === sig) return 'esc'; }catch(_){ return 'esc'; }
    return this._good;
  },

  _tick(){
    const now = performance.now();
    const gap = now - this._lastTick;
    this._lastTick = now;
    if(!this._running() || this._busy){ this._lastFrameT = now; this._cand = null; return; }
    if(gap > 4000){ this.recover('hang'); return; }   // タイマーが 4 秒以上動けなかった = メインスレッドが止まっていた
    const f = GL.frame;
    if(f !== this._lastFrame){ this._lastFrame = f; this._lastFrameT = now; }
    else if(now - this._lastFrameT > 5000){ this.recover('stall'); return; }
    // 正常な状態の控え: 4 秒変わらず、エラーなし
    let snap = null;
    try{ snap = App._undoSnap(); }catch(_){}
    if(!snap) return;
    if(snap !== this._cand){ this._cand = snap; this._candAt = now; return; }
    if(now - this._candAt >= 4000 && now - this._lastFrameT < 1500 && this._cleanSlots()) this._good = snap;   // 止まりかけの状態は控えない
  },

  recover(reason){
    if(this._busy || this._reloading) return;
    this._busy = true;
    const sig = this._sigNow();
    const count = this._record(reason, sig);
    const target = this._target(sig, count);
    try{ Diag.log('crash', reason + ' sig=' + sig + ' count=' + count + ' -> ' + (target === 'esc' ? 'esc' : 'last good')); }catch(_){}
    try{
      if(target === 'esc'){
        App._blankResetCore();
        toast(I18n.t("描画が止まったため、全スロットをなしにしました (") + reason + ')', 5000);
      } else {
        App._applyState(JSON.parse(target), { instantPost: true });
        if(UI && UI.refreshAll) UI.refreshAll();
        toast(I18n.t("描画が止まったため、直前の正常な状態に戻しました (") + reason + ')', 5000);
      }
    }catch(e){
      try{ App._blankResetCore(); }catch(_){}
    }
    this._cand = null;
    setTimeout(() => { this._busy = false; this._lastFrameT = this._lastTick = performance.now(); }, 3000);
  },
  // 前のシェーダが無いスロットでコンパイル / リンクに失敗した (エディタからのコンパイルは除く)
  onCompileFail(slotKey){
    setTimeout(() => this.recover('compile'), 0);
  },
  // webglcontextlost: 戻す先を保存して再読み込み。true = 処理した (従来のセーフモード案内を出さない)
  onContextLost(){
    const sig = this._sigNow();
    const count = this._record('lost', sig);
    if(count >= 3) return false;   // ループ: 自動では戻さない
    const target = this._target(sig, count);
    try{ localStorage.setItem(this.KEY, target); }catch(_){ return false; }
    try{ Diag.log('crash', 'lost sig=' + sig + ' count=' + count + ' -> reload ' + (target === 'esc' ? 'esc' : 'last good')); }catch(_){}
    this._reloading = true;
    try{ toast(I18n.t("GPU のコンテキストが失われました。直前の状態で再起動します…"), 4000); }catch(_){}
    setTimeout(() => location.reload(), 900);
    return true;
  },
  // 起動時 (シェーダ読み込み後): 再読み込み前に置いた戻す先を当てる。当てたら true
  bootApply(){
    let v = null;
    try{ v = localStorage.getItem(this.KEY); localStorage.removeItem(this.KEY); }catch(_){}
    if(!v) return false;
    try{
      if(v === 'esc') App._blankResetCore();
      else { App._applyState(JSON.parse(v), { restoreOverlayEnabled: true, restoreMixControls: true, restoreBeatScale: true, freshShaders: true }); if(UI && UI.refreshAll) UI.refreshAll(); }
      toast(v === 'esc' ? I18n.t("クラッシュから復帰: 全スロットをなしにしました") : I18n.t("クラッシュから復帰: 直前の正常な状態に戻しました"), 5000);
      return true;
    }catch(e){ return false; }
  },
};
window.addEventListener('DOMContentLoaded', () => CrashGuard.init());
