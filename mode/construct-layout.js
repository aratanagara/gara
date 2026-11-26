'use strict';
// Shared FUDE / Image Construct geometry. Keep FUDE saved layout indices and random call order unchanged.
const FUDE_CV_LAYOUTS = ['hero', 'grid', 'diagonal', 'frame', 'cascade', 'scatter', 'free', 'slash', 'scale', 'cross', 'radial', 'wedge', 'stairs', 'constructivist'];   // 保存値 (noteLayout = 番号 + 1) のため並びは変えない
const FUDE_CV_DROP = { scatter:'hero', free:'hero' };   // 構成的でない (散らすだけ) の型は使わない。保存値が指していたら置き換える
const FUDE_CV_FREE = ['hero', 'scale', 'diagonal', 'slash', 'stairs', 'cascade', 'radial', 'wedge'];   // 位置の角度が自由な型 (Constructivist で位置も角度の刻みの線へ寄せる)
// 古い型を戻すときは FUDE_CV_PATTERNS に入れ直す。
const FUDE_CV_PATTERNS = [
  ['Axis',     ['constructivist']],
  ['Hero',     ['hero', 'scale']],
  ['Grid',     ['grid']],
  ['Frame',    ['frame']],
  ['Diagonal', ['diagonal', 'slash']],
  ['Stairs',   ['stairs', 'cascade']],
  ['Cross',    ['cross']],
  ['Radial',   ['radial', 'wedge']],
];
// constructivist (共有する Axis の型): 45° の斜めの軸に、極端に大きい 1 つと小さい書き置きを片側へ寄せる (非対称)。
// 縦書きを混ぜて軸や大と交差させる。plan.axis = 軸 (Constructivist Brush が On のとき、筆の帯・線・棒・円相をこの軸から作る)。位置は画面の 0..1 (y 下向き)、回転は時計回り (°)
function fudeConstructivist(n, step){   // step = 角度の刻み (45 / 30)
  const R = (a, b)=> a + Math.random()*(b - a), asp = 16/9;
  const sg = Math.random() < 0.5 ? 1 : -1, ang = sg*(step === 30 ? (Math.random() < 0.5 ? 30 : 60) : 45), r = ang*Math.PI/180;   // 軸は 45° (30° 刻みなら 30° か 60°)。書き置きは刻みの線にそろう
  const ux = Math.cos(r)/asp, uy = Math.sin(r), vx = -Math.sin(r)/asp, vy = Math.cos(r);   // 軸の向き / 直交する向き (高さ 1 あたり)
  const left = Math.random() < 0.5, side = left ? 1 : -1;
  const hx = left ? R(0.28, 0.4) : R(0.6, 0.72), hy = R(0.38, 0.6);
  const inside = (x, y)=> x > 0.07 && x < 0.93 && y > 0.09 && y < 0.91;
  const out = [{ x:hx, y:hy, s:R(2.0, 2.6), rot:ang, vert:Math.random() < 0.25 }];
  if(n > 1) out.push({ x:hx + ux*side*0.12, y:hy + uy*side*0.12, s:R(0.55, 0.75), rot:ang, vert:!out[0].vert });   // 大を横切る中くらいの 1 つ
  const ts = [];
  for(let j = 0; j < 28; j++){   // 軸の上の空いている側から順に。入らなければ反対側
    const t = (j < 14 ? side : -side)*(0.36 + 0.13*(j % 14));
    if(inside(hx + ux*t, hy + uy*t)) ts.push(t);
  }
  for(let i = out.length; i < n; i++){
    const k = i % 3, t = ts.length ? ts[(i - 2) % ts.length] : side*(0.3 + 0.1*i);
    const lap = Math.floor((i - 2)/Math.max(1, ts.length));
    const o = k === 2 ? 0 : (k ? 1 : -1)*(0.05 + 0.06*lap + Math.random()*0.03);
    let x = hx + ux*t + vx*o, y = hy + uy*t + vy*o;
    x = Math.max(0.07, Math.min(0.93, x)); y = Math.max(0.09, Math.min(0.91, y));
    // k=1: 軸に沿った横書き / k=2: 縦書きで軸を横切る / k=0: 軸に直交する横書き
    out.push({ x, y, s:R(0.26, 0.48), rot:k === 0 ? ang - sg*90 : ang, vert:k === 2 });
  }
  out.axis = { ang, hx, hy, side };   // 筆の要素 (Constructivist Brush) は _cvBrushPlan がこの軸から作る
  return out;
}

const ConstructLayout = {
  PATTERNS: FUDE_CV_PATTERNS,
  axis: fudeConstructivist,
  _cvConstructivize(plan, name){
    if(!plan.length) return;
    const big = plan.reduce((b, o, i)=> o.s > plan[b].s ? i : b, 0), second = big === 0 ? 1 : 0;
    const st = this._angleStep(), sg = Math.random() < 0.5 ? 1 : -1, ang = sg*(st === 30 ? (Math.random() < 0.5 ? 30 : 60) : 45);
    const hx = plan[big].x, hy = plan[big].y, vert = Math.random() < 0.25;
    const snap = d=> Math.round(d/st)*st;
    if(FUDE_CV_FREE.includes(name)){
      const asp = Math.max(0.3, this._aspect || 16/9);
      plan.forEach((o, i)=>{
        if(i === big) return;
        const dx = (o.x - hx)*asp, dy = o.y - hy, L = Math.hypot(dx, dy);
        if(L < 1e-4) return;
        const t = snap(Math.atan2(dy, dx)*180/Math.PI)*Math.PI/180, ux = Math.cos(t)/asp, uy = Math.sin(t);
        let l = L;   // 画面からはみ出すなら、線の上のまま距離を縮める
        const x0 = Math.min(0.04, hx), x1 = Math.max(0.96, hx), y0 = Math.min(0.04, hy), y1 = Math.max(0.96, hy);   // 大きい書き置きが端の外なら、そこまでは許す
        if(ux > 1e-6) l = Math.min(l, (x1 - hx)/ux); else if(ux < -1e-6) l = Math.min(l, (x0 - hx)/ux);
        if(uy > 1e-6) l = Math.min(l, (y1 - hy)/uy); else if(uy < -1e-6) l = Math.min(l, (y0 - hy)/uy);
        l = Math.max(0, l);
        o.x = hx + ux*l; o.y = hy + uy*l;
      });
    }
    const cx = plan.length > 1 ? plan.reduce((sum, o, i)=> sum + (i === big ? 0 : o.x), 0)/(plan.length - 1) : hx;
    plan.forEach((o, i)=>{
      o.rot = snap((o.rot || 0) + ang - (i !== big && i % 3 === 0 ? sg*90 : 0));
      o.vert = i === big ? vert : i === second ? !vert : i % 3 === 2;
      o.s *= i === big ? 1.35 : 0.75;
    });
    plan.axis = { ang, hx, hy, side:cx >= hx ? 1 : -1 };
  },
  _angleStep(){ return Math.round(this.P.angleSys || 0) === 1 ? 30 : 45; },
  _cvIso(plan){
    const faces = ['t', 'l', 'r'];
    let k = Math.floor(Math.random()*3);
    for(const o of plan){
      o.face = Math.random() < 0.6 ? faces[k++ % 3] : faces[Math.floor(Math.random()*3)];   // 3 つの向きがだいたい均等に混ざるように
      o.rot = Math.round((o.rot || 0)/90)*90;                      // 面の中では面の軸 (横・縦) にそろえる
    }
  },
  _faceMat(face){
    if(!face) return [1, 0, 0, 1];
    const st = this._angleStep()*Math.PI/180, c = Math.cos(st), s = Math.sin(st);
    return face === 't' ? [c, s, -c, s] : face === 'l' ? [c, -s, 0, 1] : [c, s, 0, 1];
  },
  _cvAdjust(plan){
    const P = this.P, asp = Math.max(0.3, this._aspect || 16/9);
    const ang = +P.cvAngle || 0, sp = +(P.cvSpread ?? 1), ox = +P.cvOffX || 0, oy = +P.cvOffY || 0;
    const nr = +P.cvNoteRot || 0, rv = Math.max(0, +P.cvRotVar || 0), sv = Math.max(0, +P.cvScaleVar || 0);
    const step = [0, 15, 30, 45, 90][Math.round(P.cvSnap || 0)] || 0;
    let mir = Math.round(P.cvMirror || 0);
    if(mir === 4) mir = Math.floor(Math.random()*4);
    if(!ang && sp === 1 && !ox && !oy && !nr && !rv && !sv && !step && !mir) return;
    const r = ang*Math.PI/180, cs = Math.cos(r), sn = Math.sin(r);
    const fix = o=>{
      let dx = (o.x - 0.5)*asp, dy = o.y - 0.5;
      const x2 = dx*cs - dy*sn, y2 = dx*sn + dy*cs;           // 時計回り (y 下向き)
      dx = x2*sp; dy = y2*sp;
      let rot = (o.rot || 0) + ang;
      if(mir & 1){ dx = -dx; rot = -rot; }
      if(mir & 2){ dy = -dy; rot = -rot; }
      o.x = 0.5 + dx/asp + ox; o.y = 0.5 + dy + oy;
      rot += nr + (Math.random()*2 - 1)*rv;
      o.rot = step ? Math.round(rot/step)*step : rot;
      if(sv) o.s = (o.s || 1)*Math.max(0.1, 1 + (Math.random()*2 - 1)*sv);
    };
    plan.forEach(fix);
    if(plan.axis){ const a = { x:plan.axis.hx, y:plan.axis.hy, rot:plan.axis.ang, s:1 }; fix(a); plan.axis.hx = a.x; plan.axis.hy = a.y; plan.axis.ang = a.rot; if(mir & 1) plan.axis.side = -plan.axis.side; }
  },
};
