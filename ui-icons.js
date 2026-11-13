// 線アイコン (見出しの開閉の山形と同じ線幅・大きさにそろえる)。
// 文字の記号 (⇄ ✎ ⟳ × ＋ など) はフォントごとに太さ・大きさがばらつくので、UI の記号はここの SVG を使う。
//   JS から: VJIcon.set(el, 'close') / VJIcon.svg('plus')
//   HTML から: <button data-icon="close"></button> (読み込み時に中身を入れる)
// 見た目 (線幅・大きさ) は style.css の .ico、画像やグラデの上に置く小ボタンは .ico-btn。
window.VJIcon = (function(){
  const PATHS = {
    plus:    'M5 1V9M1 5H9',
    close:   'M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5',
    swap:    'M1 3H9M6.5 0.5L9 3L6.5 5.5M9 7H1M3.5 4.5L1 7L3.5 9.5',
    edit:    'M1 9L1.5 6.5L6.8 1.2L8.8 3.2L3.5 8.5Z',
    refresh: 'M8.5 5A3.5 3.5 0 1 1 7.3 2.4M8 0.5V2.8H5.7',
    reset:   'M1.5 5A3.5 3.5 0 1 0 2.7 2.4M2 0.5V2.8H4.3',
  };
  const svg = (name) => `<svg class="ico" viewBox="0 0 10 10" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`;
  const set = (el, name) => { el.innerHTML = svg(name); return el; };
  const scan = (root) => (root || document).querySelectorAll('[data-icon]').forEach(el => set(el, el.dataset.icon));
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scan());
  else scan();
  return { svg, set, scan };
})();
