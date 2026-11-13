// 疑似スクロールバー (anon-press.com 準拠)。
// ネイティブのバーを隠し、スクロール要素の親 (スクロールしない側) に矩形のバーを重ねて描く。
// 縦 = 右端 var(--sb-w) 幅、横 = 下端 var(--sb-w)/2 高さ。地 = --fg、つまみ = --bg (テーマで反転)。
// つまみはドラッグ、地はクリック / 長押しで 70% ずつ送る。
// 対象: SELECTORS と、data-pscroll="y|x|xy" を付けた要素 (後から生成される UI は属性を付けるだけでよい)。
(function(){
  const SELECTORS = [['.pane', 'y'], ['.modal-body', 'y'], ['#code', 'xy'], ['#topbar', 'x']];
  const HIT_EXTRA = 4;        // 見た目の幅より少しだけ広く掴めるように (操作部品に被らない範囲)
  const MIN_THUMB = 24;
  const items = new Set();
  let raf = 0;

  const sbWidth = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sb-w')) || 8;

  function attach(el, axis){
    el._pscroll = el._pscroll || {};
    if(el._pscroll[axis] || !el.parentElement) return;
    const parent = el.parentElement;
    if(getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    const bar = document.createElement('div');
    bar.className = 'pscroll pscroll-' + axis;
    const thumb = document.createElement('div');
    thumb.className = 'pscroll-thumb';
    bar.appendChild(thumb);
    parent.appendChild(bar);
    el.classList.add('pscroll-host');
    // 縦はバーの分だけ右の余白を足し、操作部品がバーの下に潜らないようにする
    if(axis === 'y'){
      const base = parseFloat(getComputedStyle(el).paddingRight) || 0;
      el.style.paddingRight = `calc(${base}px + var(--sb-w))`;
    }
    const it = { el, axis, bar, thumb, parent, size: 0, pos: 0 };
    el._pscroll[axis] = it;
    items.add(it);

    const isY = axis === 'y';
    const client = () => isY ? el.clientHeight : el.clientWidth;
    const total = () => isY ? el.scrollHeight : el.scrollWidth;
    const getPos = () => isY ? el.scrollTop : el.scrollLeft;
    const setPos = (v) => { if(isY) el.scrollTop = v; else el.scrollLeft = v; };
    const pt = (e) => isY ? e.clientY : e.clientX;

    thumb.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      thumb.setPointerCapture(e.pointerId);
      bar.classList.add('is-dragging');
      const start = pt(e), startPos = getPos();
      const trackLen = isY ? bar.clientHeight : bar.clientWidth;
      const move = (ev) => {
        const maxThumb = Math.max(1, trackLen - it.size);
        setPos(startPos + (pt(ev) - start) / maxThumb * (total() - client()));
      };
      const up = () => {
        bar.classList.remove('is-dragging');
        thumb.removeEventListener('pointermove', move);
        thumb.removeEventListener('pointerup', up);
        thumb.removeEventListener('pointercancel', up);
      };
      thumb.addEventListener('pointermove', move);
      thumb.addEventListener('pointerup', up);
      thumb.addEventListener('pointercancel', up);
    });

    let holdT = 0, holdI = 0;
    const stopHold = () => { clearTimeout(holdT); clearInterval(holdI); holdT = holdI = 0; };
    const nudge = (at) => {
      const r = bar.getBoundingClientRect();
      const center = (isY ? r.top : r.left) + it.pos + it.size / 2;
      const dir = at < center ? -1 : 1;
      const step = Math.max(60, client() * 0.7) * dir;
      el.scrollBy(isY ? { top: step, behavior: 'smooth' } : { left: step, behavior: 'smooth' });
    };
    bar.addEventListener('pointerdown', (e) => {
      if(e.target === thumb) return;
      e.preventDefault();
      const at = pt(e);
      stopHold(); nudge(at);
      holdT = setTimeout(() => { holdI = setInterval(() => nudge(at), 110); }, 220);
    });
    window.addEventListener('pointerup', stopHold);
    window.addEventListener('pointercancel', stopHold);

    el.addEventListener('scroll', () => update(it), { passive: true });
    if(window.ResizeObserver) new ResizeObserver(schedule).observe(el);
    update(it);
  }

  function update(it){
    const { el, axis, bar, thumb, parent } = it;
    if(!el.isConnected){ bar.remove(); items.delete(it); return; }
    const isY = axis === 'y';
    const client = isY ? el.clientHeight : el.clientWidth;
    const total = isY ? el.scrollHeight : el.scrollWidth;
    if(!el.getClientRects().length || total <= client + 1){ bar.hidden = true; return; }
    bar.hidden = false;
    const r = el.getBoundingClientRect(), pr = parent.getBoundingClientRect();
    const ox = pr.left + parent.clientLeft - parent.scrollLeft;
    const oy = pr.top + parent.clientTop - parent.scrollTop;
    const w = sbWidth();
    if(isY){
      const bw = w + HIT_EXTRA;
      bar.style.cssText = `top:${r.top - oy}px;height:${r.height}px;left:${r.right - ox - bw}px;width:${bw}px`;
    } else {
      const bh = w / 2 + HIT_EXTRA;
      bar.style.cssText = `left:${r.left - ox}px;width:${r.width}px;top:${r.bottom - oy - bh}px;height:${bh}px`;
    }
    const trackLen = isY ? r.height : r.width;
    const size = Math.max(MIN_THUMB, client / total * trackLen);
    const scrollPos = isY ? el.scrollTop : el.scrollLeft;
    const pos = (trackLen - size) * Math.min(1, scrollPos / (total - client));
    it.size = size; it.pos = pos;
    thumb.style.cssText = isY ? `top:${pos}px;height:${size}px` : `left:${pos}px;width:${size}px`;
  }

  function schedule(){
    if(raf) return;
    raf = requestAnimationFrame(() => { raf = 0; items.forEach(update); });
  }

  function scan(){
    for(const [sel, axes] of SELECTORS){
      document.querySelectorAll(sel).forEach(el => { for(const a of axes) attach(el, a); });
    }
    document.querySelectorAll('[data-pscroll]').forEach(el => {
      if(!el.isConnected) return;
      for(const a of el.dataset.pscroll) if(a === 'x' || a === 'y') attach(el, a);
    });
  }

  function init(){
    scan();
    window.addEventListener('resize', schedule);
    // タブ切替・折りたたみ・モーダル表示などで中身の高さが変わる
    document.addEventListener('click', schedule, true);
    // 中身の増減 (パラメータ欄の作り直しなど) は ResizeObserver で拾えないので、間隔を空けて見直す
    setInterval(() => { scan(); items.forEach(update); }, 500);
  }

  window.PseudoScroll = { attach, refresh: schedule };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
