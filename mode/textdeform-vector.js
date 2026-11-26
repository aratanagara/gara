/* ================= Type Deformer — Vector 3D (試作) =================
 * 文字の輪郭を頂点の列 (ベクターの折れ線) として取り出し、頂点ごとに Z を持たせて 3D で回す・波打たせる・音で揺らす。
 *   - 輪郭: 文字を一度オフスクリーンに描き、Marching Squares で等値線を取り出して頂点列にする (書体ファイルを読まずに、
 *     どの書体・どの文字体系でも同じ手順で取れる)。文字・書体・太さ・細かさごとにキャッシュ
 *   - 表示: Fill (輪郭を塗る) / Wire (線) / Points (頂点の点) / Wire + Points
 *   - 動き: V Spin (Y 軸の回転) × Rhythm の量・拍の脈動、V Tilt (前後の傾き)、V Wave (Z の波)、V Audio (頂点ごとの揺れ。音と拍で強まる)
 *   - 状態は TextDeform.P の vec* (全 Look 共通。TD_LOOK_KEYS に入れない)。色は TextDeform.color、配置は TextDeform の組版と Motion をそのまま使う
 * ==================================================================== */
function createTDVec(TD, peers){
'use strict';
peers = peers || globalThis;
if(!TD) return;
const RS = 128;   // 輪郭を取るときの文字の解像度 (px)

const TDVec = {
  _cache: new Map(), _ang: 0, _last: 0, ms: 0,
  active(){ const m = TD.P.vecMode; return !!m && m !== 'off'; },

  // 文字 1 つの輪郭 (文字枠の中心を原点、単位 = フォントサイズ 1 あたり)。[[x0,y0,x1,y1,...], ...]
  contours(ch, weight, stack, detail){
    const key = ch + '|' + weight + '|' + stack + '|' + detail;
    let c = this._cache.get(key);
    if(c) return c;
    if(this._cache.size > 600) this._cache.clear();
    const cv = this._cv || (this._cv = document.createElement('canvas'));
    cv.width = RS; cv.height = RS;
    const x = cv.getContext('2d', { willReadFrequently: true });
    x.clearRect(0, 0, RS, RS);
    const F = RS * 0.72;
    x.font = weight + ' ' + F + 'px ' + stack;
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#000';
    x.fillText(ch, RS/2, RS/2);
    const a = x.getImageData(0, 0, RS, RS).data;
    c = this._march(a, detail).map(pl => pl.map((v, i) => (v - RS/2) / F));
    this._cache.set(key, c);
    return c;
  },
  // Marching Squares: alpha 128 の等値線を折れ線にし、detail px より細かい頂点を間引く
  _march(a, detail){
    const T = 128, W = RS, al = (x, y) => (x < 0 || y < 0 || x >= W || y >= W) ? 0 : a[(y*W + x)*4 + 3];
    const pts = new Map(), adj = new Map();
    const lerp = (p, q) => (T - p) / ((q - p) || 1);
    const edgePt = (k, x, y, e, va, vb) => {
      if(!pts.has(k)){
        const t = Math.max(0, Math.min(1, lerp(va, vb)));
        pts.set(k, e === 't' ? [x + t, y] : e === 'r' ? [x + 1, y + t] : e === 'b' ? [x + t, y + 1] : [x, y + t]);
      }
      return k;
    };
    const link = (p, q) => {
      (adj.get(p) || adj.set(p, []).get(p)).push(q);
      (adj.get(q) || adj.set(q, []).get(q)).push(p);
    };
    for(let y = -1; y < W; y++) for(let x = -1; x < W; x++){
      const A = al(x, y), B = al(x + 1, y), C = al(x + 1, y + 1), D = al(x, y + 1);
      const ia = A >= T, ib = B >= T, ic = C >= T, id = D >= T;
      const n = (ia?1:0) + (ib?1:0) + (ic?1:0) + (id?1:0);
      if(n === 0 || n === 4) continue;
      const E = {};
      if(ia !== ib) E.t = edgePt('h' + x + ',' + y, x, y, 't', A, B);
      if(ib !== ic) E.r = edgePt('v' + (x + 1) + ',' + y, x, y, 'r', B, C);
      if(id !== ic) E.b = edgePt('h' + x + ',' + (y + 1), x, y, 'b', D, C);
      if(ia !== id) E.l = edgePt('v' + x + ',' + y, x, y, 'l', A, D);
      const ks = Object.keys(E);
      if(ks.length === 2){ link(E[ks[0]], E[ks[1]]); continue; }
      // 鞍点 (対角の 2 隅だけが内側): 内側の隅ごとに、その隅の 2 辺を結ぶ
      if(ia){ link(E.t, E.l); link(E.r, E.b); } else { link(E.t, E.r); link(E.b, E.l); }
    }
    const used = new Set(), out = [];
    for(const start of adj.keys()){
      if(used.has(start)) continue;
      const line = []; let cur = start, prev = null;
      while(cur != null && !used.has(cur)){
        used.add(cur); line.push(pts.get(cur));
        const nb = adj.get(cur) || [];
        const nx = nb.find(k => k !== prev && !used.has(k));
        prev = cur; cur = nx;
      }
      if(line.length < 4) continue;
      const flat = [], d2 = detail*detail;
      let lx = Infinity, ly = Infinity;
      for(const [px, py] of line){
        if((px - lx)*(px - lx) + (py - ly)*(py - ly) < d2) continue;
        flat.push(px, py); lx = px; ly = py;
      }
      if(flat.length >= 6) out.push(flat);
    }
    return out;
  },

  // TextDeform._renderToCanvas から。glyphs = _snapshotGlyphs の結果、o = { w, h, s, dx, dy, va }
  draw(ctx, glyphs, o){
    const t0 = performance.now();
    const P = TD.P, dz = v => TD._dp(+v || 0);
    const now = t0 / 1000, dt = this._last ? Math.min(0.1, now - this._last) : 0;
    this._last = now;
    const pulse = TD._pulseNow || 1, motion = TD._motionNow == null ? 1 : TD._motionNow;
    const env = Math.max(0, pulse - 1);   // 拍・音の脈動 (0 = なし)
    this._ang += dt * (+P.vecSpin || 0) * motion * (1 + env*0.5) * Math.PI/180;
    const ctr = TD._ctr || { x: 0, y: 0, R: 100 }, R = ctr.R;
    const tilt = (+P.vecTilt || 0) * Math.PI/180;
    const ca = Math.cos(this._ang), sa = Math.sin(this._ang), ct = Math.cos(tilt), st = Math.sin(tilt);
    const wave = dz(P.vecWave) * R * 0.35, wt = now * 2 * Math.max(0.2, motion);
    // 揺れの量は文字サイズ基準 (拍・音の脈動で強まる)。位置に沿ったなめらかな揺れなので、隣の頂点は一緒に動く
    const shake = dz(P.vecAudio) * P.fontSize * 0.06 * (0.3 + env*1.5 + Math.min(1, (typeof Audio !== 'undefined' && Audio.react) || 0));
    const depth = Math.max(0, Math.min(1, +P.vecDepth || 0));
    const D = R * (1.2 + 8*(1 - depth));   // 視点までの距離 (Depth が大きいほど遠近が強い)
    const mode = P.vecMode, fill = mode === 'fill', wire = mode === 'wire' || mode === 'wirepts', dots = mode === 'points' || mode === 'wirepts';
    const fs = P.fontSize, weight = TD.weight(), stack = TD._fontStack(TD.family());
    const detail = Math.max(0.5, +P.vecDetail || 3);
    const lw = Math.max(0.3, +P.vecLine || 1);
    const { w, h, s, dx, dy, va } = o;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if(va){ ctx.translate(w/2, h/2); ctx.rotate(va); ctx.translate(-w/2, -h/2); }
    ctx.lineJoin = 'round'; ctx.lineWidth = lw;
    let nv = 0;
    for(const g of glyphs){
      const cs = this.contours(g.ch, weight, stack, detail);
      if(!cs.length) continue;
      const col = TD.color(g.accent ? 'accent' : 'ink');
      const rr = ((g.rot || 0) + (g.opRot || 0)) * Math.PI/180, cr = Math.cos(rr), sr = Math.sin(rr);
      const sxg = g.scaleX * (g.mirX == null ? 1 : g.mirX), syg = g.scaleY * (g.mirY == null ? 1 : g.mirY);
      const gcx = g.x + g.w/2, gcy = g.y + g.h/2;
      ctx.fillStyle = col; ctx.strokeStyle = col;
      if(fill || wire) ctx.beginPath();
      for(const pl of cs){
        for(let i = 0; i < pl.length; i += 2){
          // 文字の中の頂点 → 組版の位置 (TextDeform の伸び・回転・鏡映をそのまま当てる)
          const vx = gcx + pl[i]*fs, vy = gcy + pl[i + 1]*fs;
          const qx = (vx - g.ox) * sxg, qy = (vy - g.oy) * syg;
          const X0 = qx*cr - qy*sr + g.ox + g.tx - ctr.x, Y0 = qx*sr + qy*cr + g.oy + g.ty - ctr.y;
          // Z: 版面の波 + 頂点の揺れ (位置に沿ったなめらかな波なので、輪郭はぎざぎざにならず全体がうねる)
          const u = X0 / P.fontSize, v = Y0 / P.fontSize;
          const Z0 = wave * Math.sin(X0/R*2.6 + wt) * Math.cos(Y0/R*1.7 - wt*0.6) + shake * 2 * Math.sin(u*2.1 + now*5.3) * Math.cos(v*1.7 - now*4.1);
          const jx = shake * Math.sin(v*2.9 + now*6.1), jy = shake * Math.cos(u*2.3 - now*5.7);
          // 3D: Y 軸で回し、X 軸で傾け、遠近をつける
          const X1 = (X0 + jx)*ca + Z0*sa, Z1 = -(X0 + jx)*sa + Z0*ca;
          const Y1 = (Y0 + jy)*ct - Z1*st, Z2 = (Y0 + jy)*st + Z1*ct;
          const f = D / Math.max(R*0.2, D + Z2);
          const px = dx + s*(ctr.x + X1*f), py = dy + s*(ctr.y + Y1*f);
          if(fill || wire){ if(i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
          if(dots){ const r = lw * 1.4 * f; ctx.fillRect(px - r, py - r, r*2, r*2); }
          nv++;
        }
        if(fill || wire) ctx.closePath();
      }
      if(fill) ctx.fill('evenodd');
      else if(wire) ctx.stroke();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.vertices = nv;
    this.ms = this.ms*0.8 + (performance.now() - t0)*0.2;
  }
};

return TDVec;
}
if(typeof TextDeform !== 'undefined') globalThis.TDVec = createTDVec(TextDeform);
