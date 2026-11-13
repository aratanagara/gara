// UI 設定 (歯車ボタン) とライト / ダーク切替。
// 値の適用は index.html の head にある VJUI.apply (最初の描画前と共通)。
// 設定はライブで反映し、Save で localStorage['vj.ui'] に保存。保存せずに閉じると保存値へ戻る。
// テーマはトップバーの切替ボタンと同じく、押した時点で localStorage['vj.theme'] に保存する。
(function(){
  const $ = (s) => document.querySelector(s);
  const root = document.documentElement;
  const ACC_SWATCHES = ['#3f00ff', '#ff00aa', '#00b3a4', '#ff5a1f', '#e6c300', '#1f1f1f'];

  function setTheme(theme){
    root.dataset.theme = theme;
    try { localStorage.setItem('vj.theme', theme); } catch (_) {}
    const light = theme === 'light';
    const btn = $('#btnTheme');
    btn.querySelector('.lb').textContent = light ? 'Light' : 'Dark';
    btn.setAttribute('aria-pressed', String(light));
    document.querySelectorAll('#setTheme button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === theme)));
  }

  function init(){
    const modal = $('#settingsModal');
    const ranges = [...modal.querySelectorAll('input[type=range][data-key]')];
    const accIn = $('#setAcc'), accHex = $('#setAccHex'), jpSel = $('#setJp'), dirtyMark = $('#setDirty');
    let saved = VJUI.load();
    let cur = { ...saved };

    const isDirty = () => Object.keys(cur).some(k => cur[k] !== saved[k]);
    const render = () => {
      ranges.forEach(r => { r.value = cur[r.dataset.key]; r.nextElementSibling.textContent = cur[r.dataset.key] + (r.dataset.unit ?? 'px'); });
      accIn.value = cur.acc;
      if(document.activeElement !== accHex) accHex.value = cur.acc;
      jpSel.value = cur.jpFont;
      dirtyMark.hidden = !isDirty();
    };
    const change = (patch) => {
      Object.assign(cur, patch);
      VJUI.apply(cur);
      render();
      if(window.PseudoScroll) PseudoScroll.refresh();
    };
    const save = (s) => {
      saved = { ...s };
      try { localStorage.setItem('vj.ui', JSON.stringify(saved)); } catch (_) {}
      change(saved);
    };

    ranges.forEach(r => r.addEventListener('input', () => change({ [r.dataset.key]: parseInt(r.value, 10) })));
    accIn.addEventListener('input', () => change({ acc: accIn.value }));
    accHex.addEventListener('input', () => {
      const v = accHex.value.trim();
      if(/^#[0-9a-f]{6}$/i.test(v)) change({ acc: v.toLowerCase() });
    });
    accHex.addEventListener('blur', render);
    VJUI.jpFonts.forEach(f => jpSel.add(new Option(f.label, f.id)));
    jpSel.addEventListener('change', () => change({ jpFont: jpSel.value }));
    const sw = $('#setAccSw');
    ACC_SWATCHES.forEach(c => {
      const b = document.createElement('button');
      b.type = 'button'; b.title = c; b.style.background = c;
      b.addEventListener('click', () => change({ acc: c }));
      sw.appendChild(b);
    });
    modal.querySelectorAll('#setTheme button').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.theme)));

    $('#setSave').addEventListener('click', () => save(cur));
    $('#setReset').addEventListener('click', () => save(VJUI.defaults));
    $('#setRandom').addEventListener('click', () => {
      const h = Math.floor(Math.random() * 360), s = 70 + Math.random() * 30, l = 40 + Math.random() * 15;
      const f = (n) => { const k = (n + h / 30) % 12, a = s / 100 * Math.min(l / 100, 1 - l / 100);
        return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
      change({ acc: '#' + f(0) + f(8) + f(4) });
    });

    const open = () => { saved = VJUI.load(); cur = { ...saved }; render(); modal.style.display = 'flex'; };
    const close = () => { modal.style.display = 'none'; if(isDirty()) change({ ...saved }); };
    $('#btnSettings').addEventListener('click', open);
    $('#btnSettingsClose').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if(e.target === modal) close(); });
    // 開いている間は VJ のホットキーへキーを流さない (Esc = 全スロットクリア などを防ぐ)。Esc は閉じるだけ
    window.addEventListener('keydown', (e) => {
      if(modal.style.display !== 'flex') return;
      e.stopImmediatePropagation();
      if(e.key === 'Escape'){ e.preventDefault(); close(); }
    }, true);

    $('#btnTheme').addEventListener('click', () => setTheme(root.dataset.theme === 'light' ? 'dark' : 'light'));
    setTheme(root.dataset.theme === 'light' ? 'light' : 'dark');
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
