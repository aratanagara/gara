// 代理モード (オートパイロット): VJ 中の離席で画面を保たせる。
//   30〜60 秒ごとに「安全な保存プリセット」へ切り替え、fps が落ちたら軽いものへ逃がす。
//   キー・ポインタ・ホイール・MIDI の実入力で即停止。OFF のとき既存の動作は何も変わらない
//   (起動時は常に OFF。vj.state / 保存プリセットには ON を残さない)。
//   呼び出し口: Autopilot.start(opts) / stop(reason) / status()。ホットキー L・上部の Away ボタン・バッジのクリック。
const Autopilot = (()=>{
  // ─── 一覧 (保存プリセットのキー = App._presetKey: 'id:...' か 'nm:名前#出現順') ───
  //   2026-11-21 のヘッドレス全件走査 (scripts ではなく作業ログ) と点検結果 (vj-review/preset_health.csv,
  //   visual_health.csv) から作った。インデックスは追加・削除でずれるのでキーで持つ。
  //   対象 = 保存プリセットのうち下の除外リストと、そのセッション中に fps 低下で逃がしが出たもの (banned) 以外すべて。
  //   新しく保存したプリセットも自動で対象に入る。除外 (対象にしない):
  //    - 落ちた / エラー: P86 (再読み込みで落ちる)、P127 (composite の tick error が断続)
  //    - presetName 食い違い (別のシェーダが焼き込まれていて意図と違う絵になる): P21, P49, P85, P96
  //    - 何も映らないプリセット (両スロットなし・ほぼ真っ黒) と Slot の errors が出るもの
  //    - 重い Visual (visual_health.csv の fps 50 未満): S006 / S085 / S089 / S092 / S095 / S104 / S105 を含むもの
  //    - 走査で fps 50 未満だったもの (Unlimited 計測)

  //   除外 (1 件ずつ。P 番号 = 保存プリセット一覧の並び順 +1):
  //    - P17 storm (Sine Deform | shader): 走査 fps 32 (<50)
  //    - P21 Preset 31 (Pool Caustics (4tV3WD) | metalSlab): preset_health: presetName 食い違い
  //    - P25 Preset 75 (fLOWER | ★ LAYER (3D Planes)): 走査でほぼ黒 (輝度 0.8)
  //    - P30 rock 01 (★ MANGA (Panel Collage) | ★ LAYER (3D Planes)): 走査 fps 46 (<50)
  //    - P35 text (★ NOVEL (Terminal) | (なし / 透明)): 走査 fps 23 (<50) / 走査でほぼ黒 (輝度 5.5)
  //    - P40 hand typing (Cube Surface II (Mty3DV) | Hand Model (msSXDc)): 走査 fps 29 (<50)
  //    - P46 corporate poetry (★ PEN (Manga Ink 3D) | (なし / 透明)): 走査でほぼ黒 (輝度 0.9)
  //    - P47 corporate poetry 02 (★ PEN (Manga Ink 3D) | (なし / 透明)): 走査でほぼ黒 (輝度 0.9)
  //    - P48 corporate poetry 03 (★ PEN (Manga Ink 3D) | (なし / 透明)): 走査でほぼ黒 (輝度 0.9)
  //    - P49 Preset 69 (Flowing Metal | ROMHACK (CD)): preset_health: presetName 食い違い / 走査 fps 44 (<50)
  //    - P51 needle 01 (★ NOVEL (Terminal) | (なし / 透明)): 走査 fps 21 (<50) / 走査でほぼ黒 (輝度 1.4)
  //    - P54 Preset 49 ((なし / 透明) | ★ SHREDDER (Polygon Flock)): 走査でほぼ黒 (輝度 1.4)
  //    - P56 markov 01 ((なし / 透明) | (なし / 透明)): 走査でほぼ黒 (輝度 0.4)
  //    - P57 markov 02 (★ SHREDDER (Polygon Flock) | (なし / 透明)): 走査でほぼ黒 (輝度 0.9)
  //    - P59 hinotori 02 (★ MANGA (Panel Collage) | (なし / 透明)): 走査でほぼ無地
  //    - P63 Preset 74 ((なし / 透明) | Sine Deform): 走査でほぼ黒 (輝度 0.8)
  //    - P76 Preset 83 ((なし / 透明) | Bone Tunnel): 走査 fps 25 (<50)
  //    - P78 Preset 84 (Painty (4dSBDc) | Echeveria (Chrome)): 走査 fps 26 (<50)
  //    - P79 Preset 88 (Painty (4dSBDc) | Echeveria (Chrome)): 走査 fps 39 (<50)
  //    - P80 Preset 85 (Ribbon Surface (7tBGDd) | Matrix Julia (R/B/Silver)): 走査 fps 49 (<50)
  //    - P81 Preset 96 (Bone Tunnel | OSTSEE (mdjXDd)): 走査 fps 18 (<50)
  //    - P82 Preset 99 (Cellular Tiling Clouds (NscSWs) | OSTSEE (mdjXDd)): 走査 fps 33 (<50)
  //    - P84 Preset 93 (Flight Over Dunes (3syGWc) | OSTSEE (mdjXDd)): 走査 fps 38 (<50)
  //    - P85 Preset 104 (Origami | OSTSEE (mdjXDd)): preset_health: presetName 食い違い / 走査 fps 39 (<50)
  //    - P86 Preset 97 (Fractal Foliage 3 (WtByzw) | OSTSEE (mdjXDd)): preset_health: 落ち(再読み込み) / 重い Visual S105 fps36.5 / 走査 fps 31 (<50)
  //    - P87 Preset 99 (crystalPath | OSTSEE (mdjXDd)): 走査 fps 38 (<50)
  //    - P90 Preset 100 (Ribbon Surface (7tBGDd) | ★ INKELLY (Feedback Ink)): 走査 fps 33 (<50)
  //    - P91 Preset 99 (Ribbon Surface (7tBGDd) | ★ INKELLY (Feedback Ink)): 走査 fps 33 (<50)
  //    - P92 Preset 96 (Bone Tunnel | OSTSEE (mdjXDd)): 走査 fps 19 (<50)
  //    - P95 Preset 98 (Chrome Spiral Pieces (XflXzn) | OSTSEE (mdjXDd)): 走査 fps 47 (<50)
  //    - P96 Preset 107 (Slime Frame (Chrome) | (なし / 透明)): preset_health: presetName 食い違い
  //    - P100 Preset 116 (Tunnel of Bones (3lByWh) | ★ CHROME TYPE (有機 3D 文字)): 走査 fps 39 (<50)
  //    - P102 Preset 116 (★ CHROME TYPE (有機 3D 文字) | Glass Frost): 走査でほぼ黒 (輝度 6.6)
  //    - P111 Preset 130 (Boogie Woogie | (なし / 透明)): 走査 fps 37 (<50)
  //    - P117 Preset 130 (Tunnel of Bones (3lByWh) | (なし / 透明)): 走査 fps 48 (<50)
  //    - P127 Preset 110 (Futurist | Sine Deform): preset_health: console.error 断続 (composite の dtex) / 走査 fps 32 (<50)
  //   ※ ほぼ黒の判定は無音のヘッドレス走査。PEN / SHREDDER / NOVEL など音で動く Code は無音だと暗いので除外している。LIQUID PEEL を含むプリセットは一覧に無いため該当なし。
  //   LIGHT (逃がし先。固定) = 走査で除外に入らなかったもののうち走査で fps 58 以上かつ重い Visual (fps 60 未満) を含まないもの。
  const EXCLUDE_KEYS = new Set([
    'nm:storm#1', // P17 storm
    'nm:Preset 31#1', // P21 Preset 31
    'id:pms9qeqvfntpl', // P25 Preset 75
    'nm:rock 01#1', // P30 rock 01
    'nm:text#1', // P35 text
    'nm:hand typing#1', // P40 hand typing
    'nm:corporate poetry#1', // P46 corporate poetry
    'id:pms88oxjlxp8u', // P47 corporate poetry 02
    'id:pms88ppyaaa54', // P48 corporate poetry 03
    'nm:Preset 69#1', // P49 Preset 69
    'id:pmwoq63scfopd', // P51 needle 01
    'nm:Preset 49#1', // P54 Preset 49
    'nm:markov 01#1', // P56 markov 01
    'nm:markov 02#1', // P57 markov 02
    'id:pms8etgjtnmf7', // P59 hinotori 02
    'id:pms9q9jn73l9w', // P63 Preset 74
    'id:pmsofdv4g131p', // P76 Preset 83
    'nm:Preset 84#1', // P78 Preset 84
    'nm:Preset 88#1', // P79 Preset 88
    'nm:Preset 85#1', // P80 Preset 85
    'nm:Preset 96#1', // P81 Preset 96
    'nm:Preset 99#1', // P82 Preset 99
    'nm:Preset 93#1', // P84 Preset 93
    'nm:Preset 104#1', // P85 Preset 104
    'nm:Preset 97#1', // P86 Preset 97
    'nm:Preset 99#2', // P87 Preset 99
    'nm:Preset 100#1', // P90 Preset 100
    'id:pmsu9ypcdnglw', // P91 Preset 99
    'id:pmsu7cya7lho6', // P92 Preset 96
    'nm:Preset 98#1', // P95 Preset 98
    'id:pmv3gpdktcuz8', // P96 Preset 107
    'id:pmw7b1s4mdyor', // P100 Preset 116
    'nm:Preset 116#1', // P102 Preset 116
    'id:pmwmshxao2fu2', // P111 Preset 130
    'id:pmwofiy8fwf7h', // P117 Preset 130
    'id:pmwoqw6lxpa6c', // P127 Preset 110
  ]);
  const LIGHT_KEYS = [
    'id:pms7muw8cib9v', // P1 tcpt — (なし / 透明) | (なし / 透明) (走査 59.9fps)
    'nm:cy#1', // P2 cy — ★ INKELLY (Feedback Ink) | ★ CYBER UI (Audio Clock) (走査 60.2fps)
    'nm:embedded endroll A#1', // P3 embedded endroll A — ★ INKELLY (Feedback Ink) | ★ CYBER UI (Audio Clock) (走査 60.1fps)
    'id:pms4hep2tpr8g', // P4 Preset 42 — ★ INKELLY (Feedback Ink) | (なし / 透明) (走査 59.8fps)
    'nm:Preset 43#1', // P5 Preset 43 — ★ INKELLY (Feedback Ink) | (なし / 透明) (走査 60.2fps)
    'nm:embedded endroll A#2', // P6 embedded endroll A — ★ INKELLY (Feedback Ink) | ★ CYBER UI (Audio Clock) (走査 59.8fps)
    'nm:rings 01#1', // P7 rings 01 — (なし / 透明) | (なし / 透明) (走査 59.9fps)
    'nm:anon-press.com#1', // P8 anon-press.com — ★ SHELF (Book Tower) | (なし / 透明) (走査 59.8fps)
    'id:pmworsb3mxear', // P9 aratanagara A — aratanagara BG | (なし / 透明) (走査 59.8fps)
    'nm:cloud#1', // P11 cloud — ★ NOVEL (Terminal) | (なし / 透明) (走査 60.2fps)
    'nm:Preset 39#1', // P12 Preset 39 — ★ NOVEL (Terminal) | (なし / 透明) (走査 59.9fps)
    'nm:Preset 39#2', // P13 Preset 39 — ★ INKELLY (Feedback Ink) | fLOWER (走査 60.2fps)
    'nm:thunder#1', // P14 thunder — shader | (なし / 透明) (走査 59.9fps)
    'nm:metal 01#1', // P15 metal 01 — (なし / 透明) | Bechamel (4djBzz) (走査 59.9fps)
    'nm:metal 02#1', // P16 metal 02 — (なし / 透明) | (なし / 透明) (走査 59.9fps)
    'nm:Preset 46#1', // P19 Preset 46 — Decoders (3X2Szc) | (なし / 透明) (走査 59.8fps)
    'id:pms5v0gk27xju', // P20 metal 03 — Voronoi Marble | (なし / 透明) (走査 59.9fps)
    'nm:manga A#1', // P22 manga A — (なし / 透明) | ★ SLICER (3D Shatter) (走査 59.9fps)
    'nm:lines#1', // P23 lines — Ribbon Surface (7tBGDd) | ★ INKELLY (Feedback Ink) (走査 60.1fps)
    'nm:dragon#1', // P24 dragon — ★ SHELF (Book Tower) | (なし / 透明) (走査 59.8fps)
    'nm:Preset 76#1', // P27 Preset 76 — TRON Clouds | (なし / 透明) (走査 60.1fps)
    'id:pmworwuiqi3lb', // P28 hyperwirus — (なし / 透明) | ROMHACK (CD) (走査 59.9fps)
    'id:pms5wrxlp31go', // P29 Preset 53 — ★ PEN (Manga Ink 3D) | (なし / 透明) (走査 59.8fps)
    'nm:higuchi#1', // P31 higuchi — video | (なし / 透明) (走査 59.8fps)
    'nm:aratanagara B#1', // P32 aratanagara B — (なし / 透明) | (なし / 透明) (走査 60.2fps)
    'id:pmwopzel4sqzz', // P33 tube — ★ NOVEL (Terminal) | (なし / 透明) (走査 59.8fps)
    'nm:kidlit#1', // P34 kidlit — (なし / 透明) | (なし / 透明) (走査 59.8fps)
    'nm:rock 02#1', // P36 rock 02 — (なし / 透明) | (なし / 透明) (走査 60.3fps)
    'nm:matrix#1', // P37 matrix — (なし / 透明) | (なし / 透明) (走査 59.9fps)
    'nm:smudge#1', // P38 smudge — Diffraction Grating (Ds2XRd) | (なし / 透明) (走査 59.9fps)
    'nm:glitch poison#1', // P39 glitch poison — Fractal Junkyard Glitch (dsBGRh) | (なし / 透明) (走査 60.2fps)
    'nm:Preset 29#1', // P42 Preset 29 — HV Splits (MlcGRl) | Patch SDF (Chrome) (走査 59.9fps)
    'nm:slicer 01#1', // P43 slicer 01 — ★ SLICER (3D Shatter) | (なし / 透明) (走査 59.8fps)
    'nm:slicer 02#1', // P44 slicer 02 — ★ SLICER (3D Shatter) | (なし / 透明) (走査 59.8fps)
    'nm:slicer 03#1', // P45 slicer 03 — ★ SLICER (3D Shatter) | (なし / 透明) (走査 59.8fps)
    'nm:needle 02#1', // P52 needle 02 — ★ SHREDDER (Polygon Flock) | (なし / 透明) (走査 60.2fps)
    'id:pmwox2y5lv5o7', // P53 shuriken — (なし / 透明) | fLOWER (走査 60.2fps)
    'id:pms8q95m8lhqt', // P55 Preset 68 — ★ SPACE TYPE (3D Poetry) | (なし / 透明) (走査 59.8fps)
    'nm:hinotori#1', // P58 hinotori — ★ IMAGE (Folder Slideshow) | (なし / 透明) (走査 60.2fps)
    'nm:thunder#2', // P61 thunder — ★ SHREDDER (Polygon Flock) | (なし / 透明) (走査 59.9fps)
    'nm:Preset 39#3', // P62 Preset 39 — shader | (なし / 透明) (走査 59.9fps)
    'id:pmworzgxgw8sd', // P64 needle — Origami | (なし / 透明) (走査 59.9fps)
    'nm:hinotori#2', // P66 hinotori — ★ SPACE TYPE (3D Poetry) | Hinotori Rings (走査 59.8fps)
    'id:pmwos1i25akry', // P67 hinotori — Polar Rings (ctsfWM) | Hinotori Rings (走査 59.8fps)
    'id:pms9m62sddx9z', // P68 Preset 69 — (なし / 透明) | Futurist (走査 60.2fps)
    'nm:Preset 71#2', // P69 Preset 71 — TRON Clouds | (なし / 透明) (走査 60.2fps)
    'id:pms894b6mccqg', // P70 lines — Ribbon Surface (7tBGDd) | ★ INKELLY (Feedback Ink) (走査 60.2fps)
    'nm:Preset 77#1', // P71 Preset 77 — (なし / 透明) | ROMHACK (CD) (走査 59.9fps)
    'id:pmsof9rqeqga4', // P73 Preset 80 — crystalPath | (なし / 透明) (走査 59.9fps)
    'nm:Preset 81#1', // P75 Preset 81 — Iridiscious | Rainbow Water (走査 60.2fps)
    'nm:Preset 69#3', // P77 Preset 69 — Iridiscious | (なし / 透明) (走査 60.2fps)
    'id:pmstx4e2n35ls', // P93 Preset 92 — ★ SDF CAVERNS (Triquadratic) | (なし / 透明) (走査 59.9fps)
    'nm:Preset 93#2', // P94 Preset 93 — Flight Over Dunes (3syGWc) | (なし / 透明) (走査 60.2fps)
    'id:pmwoifur3iyev', // P97 Preset 109 — ★ WIND FLOCK (風の面) | ★ INKELLY (Feedback Ink) (走査 59.9fps)
    'nm:Preset 114#1', // P98 Preset 114 — ★ CHROME TYPE (有機 3D 文字) | Glass Frost (走査 60.2fps)
    'nm:Preset 115#1', // P99 Preset 115 — ★ CHROME TYPE (有機 3D 文字) | Glass Frost (走査 59.9fps)
    'id:pmw7eukv8zbai', // P101 Preset 117 — Ghost Chamber | ★ CHROME TYPE (有機 3D 文字) (走査 59.5fps)
    'nm:Preset 119#1', // P103 Preset 119 — Kandinsky | (なし / 透明) (走査 59.9fps)
    'nm:Preset 123#1', // P104 Preset 123 — Kandinsky | Glass Frost (走査 59.5fps)
    'nm:Preset 123#2', // P105 Preset 123 — ★ WIND FLOCK (風の面) | (なし / 透明) (走査 59.9fps)
    'nm:Preset 124#1', // P106 Preset 124 — ★ SURREAL FLOAT (浮遊する構造物) | ★ CHROME TYPE (有機 3D 文字) (走査 59.9fps)
    'id:pmwm1226p1q49', // P107 Preset 125 — (なし / 透明) | ★ NOVEL (Terminal) (走査 59.7fps)
    'id:pmwm1atozbwxr', // P108 Preset 125 — ★ RHIZOME 群れの輪 | (なし / 透明) (走査 60.2fps)
    'id:pmwm1b5hzywgw', // P109 Preset 126 — ★ RHIZOME (リゾーム) | (なし / 透明) (走査 60.2fps)
    'id:pmwm1bav636xc', // P110 Preset 127 — ★ RHIZOME 扇 (逃走線) | (なし / 透明) (走査 60.2fps)
    'nm:Preset 130#1', // P113 Preset 130 — ★ CHROME TYPE (有機 3D 文字) | (なし / 透明) (走査 60.3fps)
    'id:pmwof2a4h9pgm', // P115 Preset 127 — ★ WIND FLOCK (風の面) | (なし / 透明) (走査 59.9fps)
    'nm:Preset 129#1', // P116 Preset 129 — ★ PEN (Manga Ink 3D) | (なし / 透明) (走査 60.2fps)
    'id:pmwofoh5ri8t8', // P118 Preset 131 — ROMHACK (CD) | (なし / 透明) (走査 60.2fps)
    'id:pmwoi7gtlb3wk', // P120 Preset 130 — crystalPath | (なし / 透明) (走査 60.2fps)
    'nm:Preset 109#1', // P121 Preset 109 — ★ WIND FLOCK (風の面) | ★ INKELLY (Feedback Ink) (走査 59.9fps)
    'id:pmwof6x8jq89k', // P122 Preset 129 — ★ PEN (Manga Ink 3D) | (なし / 透明) (走査 59.9fps)
    'id:pmwoiynla5449', // P123 Preset 128 — ★ SURREAL FLOAT (浮遊する構造物) | ROMHACK (CD) (走査 59.9fps)
    'id:pmwojn9eabqde', // P124 Preset 129 — (なし / 透明) | Chrome Spiral Pieces (XflXzn) (走査 59.9fps)
    'id:pmwokxucig0id', // P125 Preset 130 — (なし / 透明) | Deep Chrome Twisty (MsyyRc) (走査 59.9fps)
    'id:pmwoliqoxb3oi', // P126 Preset 131 — Diffraction Grating (Ds2XRd) | (なし / 透明) (走査 59.9fps)
    'nm:tube#1', // P130 tube — (なし / 透明) | (なし / 透明) (走査 60.2fps)
    'nm:hinotori#3', // P131 hinotori — Polar Rings (ctsfWM) | Hinotori Rings (走査 59.9fps)
    'id:pmwosabneznjo', // P132 Preset 134 — 41/49 Tower (NdVXDD) | (なし / 透明) (走査 59.9fps)
    'id:pmwoxa2l2ls3m', // P133 Preset 138 — aratanagara BG | (なし / 透明) (走査 59.9fps)
  ];

  const S = {
    on:false, since:0, switches:0, current:{index:-1, name:null}, nextAt:0,
    lastFps:0, minFps:null, minFpsAll:null, fallbacks:0, stoppedBy:null,
    poolKeys:null, floor:30, minSec:30, maxSec:60,
  };
  let banned = new Set(), tickTimer = 0, fpsTimer = 0, lastFrame = 0, lastT = 0, graceUntil = 0, samples = [], bag = [], recent = [], selfBusy = false;
  const FADE_BEATS = 4;      // Trans Beats が 0 のときだけ代理中に使うフェード拍数 (App.transBeats は書き換えない)
  const GRACE_MS = 3500;     // 切替直後はコンパイルで fps が落ちるので計測しない
  const WINDOW = 4;          // この秒数の平均が floor 未満なら逃がす

  const lib = ()=> (typeof App !== 'undefined' && App._loadPresetLib) ? (App._loadPresetLib() || []) : [];
  function keyMap(){        // key → index (現在の一覧)
    const m = {}, seen = {}, L = lib();
    for(let i = 0; i < L.length; i++){ if(L[i] && L[i].state) m[App._presetKey(L[i], seen)] = i; else App._presetKey(L[i] || {}, seen); }
    return m;
  }
  function indexKey(i){
    const L = lib(), seen = {}; let k = null;
    for(let j = 0; j < L.length; j++){ const kk = App._presetKey(L[j] || {}, seen); if(j === i){ k = kk; break; } }
    return k;
  }
  const poolIdx = (m)=> S.poolKeys
    ? toIdx(S.poolKeys, m).filter(i => !isBanned(i))
    : Object.keys(m).filter(k => !EXCLUDE_KEYS.has(k) && !banned.has(k)).map(k => m[k]);
  const isBanned = (i)=>{ const k = indexKey(i); return k != null && banned.has(k); };
  const toIdx = (keys, m)=> keys.map(k => m[k]).filter(i => i != null);
  const rnd = (a, b)=> a + Math.random() * (b - a);
  const nowMs = ()=> performance.now();

  function pickFrom(idxs){
    if(!idxs.length) return -1;
    const cur = S.current.index;
    let c = idxs.filter(i => i !== cur && !recent.includes(i));
    if(!c.length) c = idxs.filter(i => i !== cur);
    if(!c.length) c = idxs;
    return c[Math.floor(Math.random() * c.length)];
  }
  function nextBag(){      // 一巡するまで同じものを出さない
    const idxs = poolIdx(keyMap());
    bag = bag.filter(i => idxs.includes(i));
    if(!bag.length){
      bag = idxs.slice();
      for(let i = bag.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      if(bag.length > 1 && bag[bag.length - 1] === S.current.index){ bag.unshift(bag.pop()); }   // 末尾 = 次に取る
    }
    return bag.pop();
  }
  function applyIdx(i){
    if(i == null || i < 0) return false;
    const L = lib(), p = L[i];
    if(!p || !p.state) return false;
    selfBusy = true;
    try{
      // 既存のプリセット切替トランジションを使う。Trans Beats が 0 の間だけ FADE_BEATS 拍でフェードする
      // (presetApply は beats 0 だと何もしない。ここで先に退避するので App.transBeats は触らず、止めても設定は変わらない)
      if((App.transBeats || 0) <= 0 && typeof GL !== 'undefined' && GL.startPresetTrans) GL.startPresetTrans(FADE_BEATS, App.transStyle || 0);
      App.presetApply(i);
    }catch(e){ console.warn('[Autopilot] presetApply 失敗', e); selfBusy = false; return false; }
    selfBusy = false;
    S.current = { index:i, name:p.name || ('Preset ' + (i + 1)) };
    S.switches++;
    recent.push(i); if(recent.length > 3) recent.shift();
    graceUntil = nowMs() + GRACE_MS; samples = [];
    return true;
  }
  const schedule = ()=>{ S.nextAt = nowMs() + rnd(S.minSec, S.maxSec) * 1000; };
  function effFloor(){
    const cap = (typeof App !== 'undefined') ? (+App._fpsCap || 0) : 0;   // FPS Cap が低いと実測がそれ以上出ないので、上限の 8 割までに丸める
    return cap > 0 ? Math.min(S.floor, cap * 0.8) : S.floor;
  }

  function onTick(){
    if(!S.on) return;
    if(nowMs() >= S.nextAt){ if(!applyIdx(nextBag())) bag = []; schedule(); }
    refreshBadge();
  }
  function onFps(){
    if(!S.on || typeof GL === 'undefined') return;
    const t = nowMs(), f = GL.frame;
    const dt = t - lastT, df = f - lastFrame; lastT = t; lastFrame = f;
    if(document.hidden || dt > 2500 || dt < 400) { samples = []; return; }   // 隠れたタブ・タイマー間引きは計測しない
    const fps = df * 1000 / dt;
    S.lastFps = Math.round(fps * 10) / 10;
    S.minFpsAll = S.minFpsAll == null ? S.lastFps : Math.min(S.minFpsAll, S.lastFps);
    if(t < graceUntil) return;
    S.minFps = S.minFps == null ? S.lastFps : Math.min(S.minFps, S.lastFps);
    samples.push(fps); if(samples.length > WINDOW) samples.shift();
    if(samples.length >= WINDOW && samples.reduce((a, b) => a + b, 0) / WINDOW < effFloor()){
      const curKey = S.current.index >= 0 ? indexKey(S.current.index) : null;
      if(curKey && !LIGHT_KEYS.includes(curKey)) banned.add(curKey);   // 重かったプリセットはこのセッション中は対象から外す (保存しない)
      const light = toIdx(LIGHT_KEYS, keyMap());
      const i = pickFrom(light);
      if(i >= 0 && applyIdx(i)){ S.fallbacks++; schedule(); }
      else samples = [];
    }
  }

  // ─── 実入力で停止 ───
  function onUserInput(e){
    if(!S.on || selfBusy || !e.isTrusted) return;
    const tg = e.target;
    if(tg && tg.closest && tg.closest('#btnAutopilot, #apBadge')) return;   // ボタン・バッジは自分の click で処理する
    stop('input');
  }
  function onKey(e){
    if(!e.isTrusted || selfBusy) return;
    const tg = e.target, editable = tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName));
    if(e.code === 'KeyL' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !editable){
      if(!e.repeat){ S.on ? stop('hotkey') : start(); }
      e.preventDefault(); return;
    }
    if(S.on) stop('input');
  }
  let midiHooked = false;
  function hookMidi(){
    if(midiHooked || typeof MIDI === 'undefined' || typeof MIDI._msg !== 'function') return;
    midiHooked = true;
    const orig = MIDI._msg;
    MIDI._msg = function(e){
      if(S.on && e && e.data){ const s = e.data[0] & 0xf0; if(s >= 0x80 && s < 0xf0) stop('midi'); }   // クロック・Active Sensing (0xF0〜) は無視
      return orig.apply(this, arguments);
    };
  }

  // ─── バッジ (操作画面側の DOM。ステージ・録画・Projector の絵には入らない) ───
  let badge = null;
  function mkBadge(){
    if(badge) return badge;
    badge = document.createElement('div');
    badge.id = 'apBadge'; badge.hidden = true;
    I18n.bind(badge, "クリックで代理モードを停止 (L)", "title");
    badge.addEventListener('click', ()=> stop('badge'));
    document.body.appendChild(badge);
    return badge;
  }
  function refreshBadge(){
    const b = mkBadge(), btn = document.getElementById('btnAutopilot');
    if(btn) btn.classList.toggle('on', S.on);
    b.hidden = !S.on;
    if(!S.on) return;
    const sec = Math.max(0, Math.ceil((S.nextAt - nowMs()) / 1000));
    b.textContent = I18n.t('代理中 次まで {sec} 秒', {sec}) + (S.current.index >= 0 ? ' · P' + (S.current.index + 1) : '');
  }

  function status(){
    const m = keyMap();
    return {
      on:S.on, since:S.since, switches:S.switches,
      current:{ index:S.current.index, name:S.current.name },
      nextInSec: S.on ? Math.max(0, Math.round((S.nextAt - nowMs()) / 100) / 10) : null,
      lastFps:S.lastFps, minFps:S.minFps, minFpsAll:S.minFpsAll, fallbacks:S.fallbacks, stoppedBy:S.stoppedBy,
      floor:S.on ? effFloor() : S.floor, pool:poolIdx(m), banned:toIdx([...banned], m), light:toIdx(LIGHT_KEYS, m),
    };
  }
  function start(opts){
    opts = opts || {};
    if(S.on) return status();
    hookMidi();
    const m = keyMap();
    S.poolKeys = (Array.isArray(opts.pool) && opts.pool.length) ? opts.pool.map(i => indexKey(+i)).filter(Boolean) : null;   // null = 除外リスト以外すべて (呼び出しごとに現在の一覧から数える)
    if(!poolIdx(m).length){ S.stoppedBy = 'nopool'; S.poolKeys = null; return status(); }
    S.minSec = Math.max(1, +opts.minSec || 30);
    S.maxSec = Math.max(S.minSec, +opts.maxSec || 60);
    S.floor = opts.fpsFloor != null ? +opts.fpsFloor : 30;
    S.on = true; S.since = Date.now(); S.switches = 0; S.fallbacks = 0; S.stoppedBy = null;
    S.lastFps = 0; S.minFps = null; S.minFpsAll = null; S.current = { index:-1, name:null };
    bag = []; recent = []; samples = [];
    lastFrame = (typeof GL !== 'undefined') ? GL.frame : 0; lastT = nowMs(); graceUntil = nowMs() + GRACE_MS;
    schedule();
    tickTimer = setInterval(onTick, 500); fpsTimer = setInterval(onFps, 1000);
    refreshBadge();
    return status();
  }
  function stop(reason){
    if(S.on){
      S.on = false; S.stoppedBy = reason || 'api';
      clearInterval(tickTimer); clearInterval(fpsTimer); tickTimer = fpsTimer = 0;
      refreshBadge();
    }
    return status();
  }

  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', onUserInput, true);
  window.addEventListener('wheel', onUserInput, { capture:true, passive:true });
  function init(){
    mkBadge(); hookMidi();
    const btn = document.getElementById('btnAutopilot');
    if(btn) btn.addEventListener('click', ()=>{ S.on ? stop('button') : start(); });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  return { start, stop, status };
})();
window.Autopilot = Autopilot;
