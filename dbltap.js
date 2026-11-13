/* =====================================================================
   dbltap.js — ダブルクリック挙動全般をダブルタップ(タッチ)にも対応
   タッチ/ペンでのダブルタップを検出し、対象要素に合成 dblclick イベントを
   発火する。これにより既存の dblclick ハンドラ (スライダーの初期値リセット等、
   document 上の委譲リスナを含む) がタッチでもそのまま動作する。

   - app.js 等には手を入れず、実行時に window へリスナを足すだけ。
   - 個別の dblclick ハンドラを書き換える必要はない (合成イベントが委譲/直接
     どちらのリスナにもバブリングして届く)。
   - メインキャンバス(#glcanvas)は描画(polydraw)と競合しないよう対象外。

   読み込み: index.html に <script src="dbltap.js" defer></script> を追加。
   ===================================================================== */
(function(){
  'use strict';

  var GAP = 320;   // 2タップ間の最大ミリ秒
  var DIST = 36;   // 2タップ間の最大距離(px)
  var MOVE = 12;   // これ以上動いたら「タップ」でなくドラッグ/スワイプ扱い

  var downX = 0, downY = 0;
  var lastT = 0, lastX = 0, lastY = 0;

  function isTouchLike(e){ return e.pointerType === 'touch' || e.pointerType === 'pen'; }
  function isCanvas(el){ return !!(el && el.id === 'glcanvas'); }

  function onDown(e){
    if(!isTouchLike(e) || e.isPrimary === false) return;
    downX = e.clientX; downY = e.clientY;
  }

  function onUp(e){
    if(!isTouchLike(e) || e.isPrimary === false) return;
    var x = e.clientX, y = e.clientY, t = (performance && performance.now) ? performance.now() : Date.now();

    // 押下位置から大きく動いていたら tap ではない (スライダードラッグ等)
    if(Math.hypot(x - downX, y - downY) > MOVE){ lastT = 0; return; }

    if(t - lastT <= GAP && Math.hypot(x - lastX, y - lastY) <= DIST){
      // ── ダブルタップ確定 ──
      var target = e.target || (document.elementFromPoint ? document.elementFromPoint(x, y) : null);
      if(target && !isCanvas(target)){
        try { e.preventDefault(); } catch(_){}
        var ev;
        try {
          ev = new MouseEvent('dblclick', {
            bubbles: true, cancelable: true, view: window, detail: 2,
            clientX: x, clientY: y,
          });
        } catch(_){
          ev = document.createEvent('MouseEvents');
          ev.initMouseEvent('dblclick', true, true, window, 2, 0, 0, x, y, false, false, false, false, 0, null);
        }
        target.dispatchEvent(ev);
      }
      lastT = 0; // 3タップ目で連続発火しないようリセット
    } else {
      lastT = t; lastX = x; lastY = y;
    }
  }

  function install(){
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup',   onUp,   true);
    window.__dbltap = true;
  }

  // PointerEvent が無い (極めて古い) 環境では何もしない
  if(typeof window.PointerEvent !== 'undefined'){
    install();
  }
})();
