'use strict';
/* Overlay v5 — 元の polygon ツール (/Users/aratanagara/Dropbox/shader/polygon) と
   同じ形状アルゴリズム (Delaunay 三角化 + 各ブラシの本家ロジック) を移植。

   - 各 beat trigger で 1 ストローク生成
   - 寿命前半 (searchPhase) で始点固定/終点ぶれの "探る" モーション → 残り時間で確定形状
   - 描画は始点周辺の合成画面 (sourceTex) をテクスチャとして拾いブラシ形状に再投影
   - persist=ON で確定後も保持 (シェーダ下のアニメは継続)

   ブラシ: warp / rise / smear / smudge(dry) / smudgeWet / curve / polygon
*/

const Overlay = {
  gl:null, initialized:false,
  prog:null, locs:null, vbo:null, ibo:null,
  sourceTex:null,
  P:{
    enabled:false,
    brushMode:'smear',
    persist:false,
    maxStrokes:300,

    subdiv:8,
    spawnCount:1,

    centerMode:'random',
    direction:'radial',
    strokeLen:2.5,
    strokeLenVar:0.25,
    curveAmt:1.0,

    sides:15,           // 元 P.N (Points) — min (maxSides=0 なら固定値)
    maxSides:0,         // 0=固定, 3以上=3..maxSides のランダム
    size:0.15,          // 元 P.R を short edge 比に正規化
    sizeVar:1.0,
    warp:0.5,           // 元 P.warp
    explode:0.5,        // 元 P.explode (perspective Z)
    focal:5,            // 元 P.focal
    stamps:25,          // SMUDGE/CURVE 用
    smudgeSpeed:0.5,
    tipShape:'round',   // SMUDGE 筆先形状: round=丸筆 / flat=平筆 / gpen=Gペン / finger=指先
    drawBeats:0,        // SMUDGE 描画時間(拍)。0=Trigger連動(発生間隔と同じ)。>0で発生と描画を分離
    rotPerStamp:0.0,
    spin:4.0,

    life:1.5,
    searchPhase:0.05,
    searchAmp:0.2,
    searchFreq:5.0,
    fadePhase:0.15,
    fadeShape:'pulse',

    // Color/Tint は UI から削除済 (常にテクスチャそのまま表示)
    color:[1.0, 1.0, 1.0],
    hueRand:false,
    alpha:1.0,
    blendMode:'normal',
    // pollock 仕上げ: 'gloss' (シャープで光沢, 重ね描き) / 'matt' (にじみと擦れの強い質感)
    finish:'matt',
  },
  // ブラシごとの初期値セット — モード切替時に自動適用
  //   subdiv / strokeLen / strokeLenVar / curveAmt / stamps + 形状系 (sides, size, sizeVar, warp, explode, focal)
  //   imagon TOOL_DEFAULTS 由来 (n→sides / s/1000→size / w/100→warp / e/100→explode / p→focal)
  BRUSH_DEFAULTS:{
    // imagon mode 0 (GLASS) を vj の warp に
    warp: {
      subdiv:8, strokeLen:2.5, strokeLenVar:0.4, curveAmt:0.0, stamps:18,
      sides:16, maxSides:0, size:0.20, sizeVar:0.4, warp:0.60, explode:0.30, focal:80,
    },
    // imagon mode 1 (RISE)
    rise: {
      subdiv:8, strokeLen:1.0, strokeLenVar:0.5, curveAmt:0.0, stamps:18,
      sides:18, maxSides:0, size:0.11, sizeVar:0.4, warp:0.35, explode:0.32, focal:80,
    },
    // imagon mode 2 (WARP-tool / buildSmear)
    smear: {
      subdiv:8, strokeLen:1.5, strokeLenVar:0.3, curveAmt:0.0, stamps:18,
      sides:10, maxSides:0, size:0.10, sizeVar:0.3, warp:0.15, explode:0.15, focal:80,
    },
    // 指先ツール (SMUDGE): warp = 引きずり強度 (1 で始点の色を最後まで運ぶ)
    smudge: {
      subdiv:8, strokeLen:2.5, strokeLenVar:0.4, curveAmt:0.0, stamps:40, smudgeSpeed:0.5, tipShape:'round', drawBeats:0,
      sides:12, maxSides:0, size:0.13, sizeVar:0.4, warp:0.70, explode:0.20, focal:80,
    },
    // Wet: 開始位置のテクスチャをコピーして経路方向に伸ばす SMUDGE 派生
    smudgeWet: {
      subdiv:8, strokeLen:2.5, strokeLenVar:0.4, curveAmt:0.0, stamps:40, smudgeSpeed:0.5, tipShape:'round', drawBeats:0,
      sides:12, maxSides:0, size:0.13, sizeVar:0.4, warp:0.82, explode:0.20, focal:80,
    },
    // imagon mode 4 (CURVE)
    curve: {
      subdiv:8, strokeLen:2.5, strokeLenVar:0.25, curveAmt:1.0, stamps:25,
      sides:10, maxSides:0, size:0.22, sizeVar:1.0, warp:0.65, explode:0.45, focal:80,
    },
    // imagon mode 5 (RANDOM)
    random: {
      subdiv:8, strokeLen:2.5, strokeLenVar:0.3, curveAmt:0.0, stamps:18,
      sides:11, maxSides:0, size:0.17, sizeVar:1.0, warp:1.00, explode:1.00, focal:80,
    },
    // imagon mode 6 (SPIKE)
    spike: {
      subdiv:8, strokeLen:1.0, strokeLenVar:0.5, curveAmt:0.0, stamps:18,
      sides:6, maxSides:0, size:0.06, sizeVar:0.4, warp:0.50, explode:0.20, focal:80,
    },
    // imagon mode 7 (SWOOSH)
    swoosh: {
      subdiv:8, strokeLen:2.8, strokeLenVar:0.35, curveAmt:0.0, stamps:18,
      sides:3, maxSides:0, size:0.07, sizeVar:0.3, warp:0.60, explode:0.35, focal:80,
    },
    // vj 固有
    polygon: {
      subdiv:8, strokeLen:2.5, strokeLenVar:0.4, curveAmt:0.0, stamps:18,
      sides:3, maxSides:9, size:0.10, sizeVar:0.4, warp:0.30, explode:0.00, focal:80,
    },
    pollock: {
      subdiv:16, strokeLen:2.5, strokeLenVar:0.4, curveAmt:1.75, stamps:25,
      sides:5, maxSides:0, size:0.015, sizeVar:0.82, warp:1.0, explode:0.0, focal:5,
    },
    // G ペン: size=線の基準スケール / sizeVar=太さの上限 / warp=ジッタ・うねり / curveAmt=反り
    gpen: {
      subdiv:16, strokeLen:2.5, strokeLenVar:0.4, curveAmt:1.0, stamps:25,
      sides:5, maxSides:0, size:0.02, sizeVar:0.5, warp:0.4, explode:0.0, focal:5,
    },
  },
  // ブラシ毎の保持パラメータ (init 時に BRUSH_DEFAULTS をディープコピー)。
  //   スライダーを変更するとここに書き戻され、ブラシ切替で各自の値がロードされる。
  brushParams:null,
  // 「ブラシ毎に保持する」キーセット
  BRUSH_KEYS:['strokeLen','strokeLenVar','curveAmt','stamps','smudgeSpeed','tipShape','drawBeats','sides','maxSides','size','sizeVar','warp','explode','focal'],
  GLOBAL_KEYS:['subdiv'],
  TRIGGER_STEPS:[0.03125, 0.0625, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32],
  _brushName(name){
    if(name === 'smudgeStretch') return 'smudgeWet';
    if(name === 'gpen' || name === 'pollock' || name === 'polygon') return 'smudge';
    return name;
  },
  _normalizeSubdiv(v){
    const n = Number(v);
    if(!Number.isFinite(n)) return 1;
    let best = this.TRIGGER_STEPS[0], bd = Math.abs(n - best);
    for(const s of this.TRIGGER_STEPS){
      const d = Math.abs(n - s);
      if(d < bd){ best = s; bd = d; }
    }
    return best;
  },
  // 指定ブラシのパラメータを P に流し込む (brushParams を優先、なければ BRUSH_DEFAULTS)
  // MIDI の同じブラシボタンを続けて押したときに TRIGGER / BRUSH SHAPE をランダム化する。
  //   (1 回目 = 工場プリセットのまま / 2 回目以降 = 押すたびに引き直し)
  randomizeBrushTriggerShape(){
    const P = this.P;
    const R = (a, b)=> a + Math.random()*(b - a);
    const pick = (arr)=> arr[Math.floor(Math.random()*arr.length)];
    // ── TRIGGER (発生タイミング / 本数 / 位置 / 向き / ストローク) ──
    P.subdiv      = pick([1, 2, 3, 4, 6, 8, 12, 16]);
    P.spawnCount  = Math.round(R(1, 6));                      // 1..8
    P.centerMode  = pick(['random', 'center', 'edge', 'grid']);
    P.direction   = pick(['radial', 'random', 'horizontal', 'vertical']);
    const snap = (v, st)=> Math.round(v / st) * st;
    P.strokeLen   = +snap(R(0.3, 4.5), 0.05).toFixed(2);
    P.strokeLenVar= +snap(R(0, 0.9), 0.05).toFixed(2);
    P.curveAmt    = +snap(R(-1, 1), 0.05).toFixed(2);      // UI は -1..1
    P.life        = +snap(R(0.3, 3.5), 0.1).toFixed(1);    // step 0.1
    P.fadePhase   = +snap(R(0.05, 0.6), 0.05).toFixed(2);
    // ── BRUSH SHAPE (形) ──
    P.sides       = Math.round(R(3, 30));                     // 3..40
    P.maxSides    = Math.random() < 0.5 ? 0 : Math.round(R(Math.max(3, P.sides), 40));
    P.size        = +snap(R(0.02, 0.45), 0.001).toFixed(3);   // 0.001..0.6
    P.sizeVar     = +snap(R(0, 1), 0.01).toFixed(2);          // 0..1
    P.warp        = +snap(R(0, 1), 0.01).toFixed(2);          // 0..1
    P.explode     = +snap(R(0, 1), 0.01).toFixed(2);          // 0..1
    P.focal       = snap(R(5, 120), 5);                       // 5..300 / step 5
    P.stamps      = Math.round(R(6, 60));                     // 2..300
    P.rotPerStamp = +snap(R(-0.6, 0.6), 0.05).toFixed(2);     // -1.5..1.5
    P.spin        = +snap(R(-4, 4), 0.05).toFixed(2);         // -4..4
    if(P.tipShape !== undefined) P.tipShape = pick(['round', 'flat', 'gpen', 'finger']);
    if(P.smudgeSpeed !== undefined) P.smudgeSpeed = +snap(R(0.1, 1.5), 0.01).toFixed(2);
  },
  applyBrushDefaults(name){
    name = this._brushName(name);
    this.P.brushMode = name;
    if(!this.brushParams){
      this.brushParams = {};
      for(const k in this.BRUSH_DEFAULTS) this.brushParams[k] = Object.assign({}, this.BRUSH_DEFAULTS[k]);
    }
    if(!this.brushParams[name] && name === 'smudgeWet' && this.brushParams.smudgeStretch){
      this.brushParams[name] = Object.assign({}, this.brushParams.smudgeStretch);
    }
    if(!this.brushParams[name] && this.BRUSH_DEFAULTS[name]){
      this.brushParams[name] = Object.assign({}, this.BRUSH_DEFAULTS[name]);
    }
    const d = this.brushParams[name] || this.BRUSH_DEFAULTS[name];
    if(!d) return false;
    for(const k of this.BRUSH_KEYS) if(d[k] !== undefined) this.P[k] = d[k];
    // ユーザー保存のモード別デフォルト (localStorage) を上書き適用
    // enabled は対象外: ON/OFF はユーザー操作 (O キー / チェックボックス) だけが変え、切替後も持続する
    const saved = this.loadModeDefault(name) || (name === 'smudgeWet' ? this.loadModeDefault('smudgeStretch') : null);
    if(saved){ for(const k in saved){ if(k === 'brushMode' || k === 'enabled' || this.GLOBAL_KEYS.indexOf(k) >= 0) continue; this.P[k] = saved[k]; if(this.BRUSH_KEYS.indexOf(k) >= 0) this.brushParams[name][k] = saved[k]; } }
    if(name === 'smudge' || name === 'smudgeWet'){
      const def = this.BRUSH_DEFAULTS[name] || this.BRUSH_DEFAULTS.smudge;
      const minSmoothStamps = def.stamps || 40;
      if((this.P.stamps|0) < minSmoothStamps){
        this.P.stamps = minSmoothStamps;
        this.brushParams[name].stamps = minSmoothStamps;
      }
      this.P.finish = name === 'smudgeWet' ? 'wet' : 'dry';
    } else if(this.P.finish !== 'gloss' && this.P.finish !== 'matt'){
      this.P.finish = 'gloss';
    }
    return true;
  },
  // ─── モード別デフォルト値保存 (localStorage 'vj.def.overlay.<mode>') ───────
  // Overlay パネルの「デフォルト保存」ボタンから呼ぶ。現在のブラシモードの P を保存 (enabled は除外)。
  saveModeDefault(){
    const mode = this.P.brushMode;
    const d = Object.assign({}, this.P);
    delete d.enabled;
    for(const k of this.GLOBAL_KEYS) delete d[k];
    try{ localStorage.setItem('vj.def.overlay.'+mode, JSON.stringify(d)); }catch(e){}
    return mode;
  },
  loadModeDefault(mode){
    let d = null;
    try{ d = JSON.parse(localStorage.getItem('vj.def.overlay.'+mode) || 'null'); }catch(e){}
    return (d && typeof d === 'object') ? d : null;
  },
  // ライブ調整を捨てて「デフォルト保存」した値へ戻す (保存が無ければ初期値)。保存自体は消さない。
  resetModeDefault(){
    const mode = this._brushName(this.P.brushMode);
    if(this.PDefaults) Object.assign(this.P, JSON.parse(JSON.stringify(this.PDefaults)));
    this.P.brushMode = mode;
    this.resetBrushParams(mode);
    this.applyBrushDefaults(mode);
    return mode;
  },
  // 現在のブラシに、操作中のスライダー値を保存する
  saveBrushParam(key, value){
    if(this.BRUSH_KEYS.indexOf(key) < 0) return;
    if(!this.brushParams) this.applyBrushDefaults(this.P.brushMode); // 初期化
    const mode = this.P.brushMode;
    if(!this.brushParams[mode]) this.brushParams[mode] = {};
    this.brushParams[mode][key] = value;
  },
  // 指定ブラシのパラメータを工場出荷状態 (BRUSH_DEFAULTS) に戻す
  resetBrushParams(name){
    name = this._brushName(name);
    if(!this.BRUSH_DEFAULTS[name]) return;
    if(!this.brushParams) this.brushParams = {};
    this.brushParams[name] = Object.assign({}, this.BRUSH_DEFAULTS[name]);
  },
  PDefaults:null,
  strokes:[],
  lastSubBeat:-1,

  init(gl){
    if(this.initialized) return true;
    this.gl = gl;
    this.PDefaults = JSON.parse(JSON.stringify(this.P));

    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, `
attribute vec2 a_pos;
attribute vec2 a_uv;
attribute float a_soft;
varying vec2 v_uv;
varying float v_soft;
void main(){
  v_uv = a_uv;
  v_soft = a_soft;
  gl_Position = vec4(a_pos, 0., 1.);
}`);
    gl.compileShader(vs);
    if(!__glReady(gl, vs, false)){ console.error('Overlay vs:', gl.getShaderInfoLog(vs)); return false; }

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, `
precision mediump float;
uniform sampler2D u_tex;
uniform vec4 u_tint;
varying vec2 v_uv;
varying float v_soft;
void main(){
  vec2 uv = clamp(v_uv, vec2(0.001), vec2(0.999));
  vec3 c = texture2D(u_tex, uv).rgb;
  gl_FragColor = vec4(c * u_tint.rgb, u_tint.a * v_soft);
}`);
    gl.compileShader(fs);
    if(!__glReady(gl, fs, false)){ console.error('Overlay fs:', gl.getShaderInfoLog(fs)); return false; }

    this.prog = gl.createProgram();
    gl.attachShader(this.prog, vs);
    gl.attachShader(this.prog, fs);
    gl.linkProgram(this.prog);
    if(!__glReady(gl, this.prog, true)){ console.error('Overlay link:', gl.getProgramInfoLog(this.prog)); return false; }

    this.locs = {
      pos:  gl.getAttribLocation(this.prog, 'a_pos'),
      uv:   gl.getAttribLocation(this.prog, 'a_uv'),
      soft: gl.getAttribLocation(this.prog, 'a_soft'),
      tex:  gl.getUniformLocation(this.prog, 'u_tex'),
      tint: gl.getUniformLocation(this.prog, 'u_tint'),
    };
    this.vbo = gl.createBuffer();
    this.ibo = gl.createBuffer();
    this.initialized = true;
    this.applyBrushDefaults(this.P.brushMode);   // 起動時に保存済みモード別デフォルトを反映
    return true;
  },

  /* ─── 元ツールから移植: hash + Delaunay ───────────────── */
  _fh(n){ return Math.abs(Math.sin(n*127.1 + 311.7) * 43758.5453) % 1; },
  // 蛇行パス: 始点→終点の間に numSeg-1 個のウェイポイントを交互に perp 方向へ振って作る。
  //   amp=振れ幅(Warp/Curve 由来)。numSeg=区間数(Explode 由来)。戻り値は Catmull-Rom 用の点+接線。
  _serpentinePath(cx, cy, cex, cey, perpX, perpY, seed, numSeg, amp){
    const ddx = cex - cx, ddy = cey - cy;
    const wps = [{x:cx, y:cy}];
    for(let i=1; i<numSeg; i++){
      const tt = i / numSeg;
      const lx = cx + ddx*tt, ly = cy + ddy*tt;
      const fi = seed*500 + i*73;
      let sign = (i % 2 === 1) ? 1 : -1;
      if(this._fh(fi*2.3) > 0.78) sign = -sign;              // たまに同じ側へ (単調な蛇行を崩す)
      const mag = (0.45 + this._fh(fi*3.7) * 0.55) * amp;
      wps.push({x: lx + perpX*sign*mag, y: ly + perpY*sign*mag});
    }
    wps.push({x:cex, y:cey});
    const tension = 0.5, tangs = [];
    for(let i=0; i<wps.length; i++){
      if(i === 0)                   tangs.push({x:(wps[1].x - wps[0].x)*tension, y:(wps[1].y - wps[0].y)*tension});
      else if(i === wps.length - 1) tangs.push({x:(wps[i].x - wps[i-1].x)*tension, y:(wps[i].y - wps[i-1].y)*tension});
      else                          tangs.push({x:(wps[i+1].x - wps[i-1].x)*tension, y:(wps[i+1].y - wps[i-1].y)*tension});
    }
    return {wps, tangs};
  },
  // Hermite スプライン評価。tt(0..1) を全区間へ写し、位置(x,y)と接線(tx,ty)を返す。
  _hermiteAt(wps, tangs, tt){
    const n = wps.length;
    if(n < 2){ const p = wps[0] || {x:0,y:0}; return {x:p.x, y:p.y, tx:1, ty:0}; }
    let seg = Math.max(0, Math.min(1, tt)) * (n - 1);
    let i = Math.floor(seg); if(i > n-2) i = n-2; if(i < 0) i = 0;
    const lt = seg - i;
    const p0 = wps[i], p1 = wps[i+1], m0 = tangs[i], m1 = tangs[i+1];
    const t2 = lt*lt, t3 = t2*lt;
    const h00 = 2*t3 - 3*t2 + 1, h10 = t3 - 2*t2 + lt, h01 = -2*t3 + 3*t2, h11 = t3 - t2;
    const dh00 = 6*t2 - 6*lt, dh10 = 3*t2 - 4*lt + 1, dh01 = -6*t2 + 6*lt, dh11 = 3*t2 - 2*lt;
    return {
      x: h00*p0.x + h10*m0.x + h01*p1.x + h11*m1.x,
      y: h00*p0.y + h10*m0.y + h01*p1.y + h11*m1.y,
      tx: dh00*p0.x + dh10*m0.x + dh01*p1.x + dh11*m1.x,
      ty: dh00*p0.y + dh10*m0.y + dh01*p1.y + dh11*m1.y,
    };
  },

	  _delaunay(pts){
	    const n = pts.length;
	    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	    for(const p of pts){
	      if(p.x < minX) minX = p.x; if(p.x > maxX) maxX = p.x;
	      if(p.y < minY) minY = p.y; if(p.y > maxY) maxY = p.y;
	    }
	    const span = Math.max(maxX - minX, maxY - minY, 1);
	    const cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5;
	    const M = span * 32;
	    const sup = [{x:cx,y:cy-M*3}, {x:cx-M*3,y:cy+M*2}, {x:cx+M*3,y:cy+M*2}];
    const all = pts.concat(sup);
    let tris = [[n, n+1, n+2]];
    function cc(a, b, c){
      const ax=all[a].x, ay=all[a].y, bx=all[b].x, by=all[b].y, cx=all[c].x, cy=all[c].y;
      const D = 2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by));
      if(Math.abs(D) < 1e-10) return null;
      const ux = ((ax*ax+ay*ay)*(by-cy) + (bx*bx+by*by)*(cy-ay) + (cx*cx+cy*cy)*(ay-by))/D;
      const uy = ((ax*ax+ay*ay)*(cx-bx) + (bx*bx+by*by)*(ax-cx) + (cx*cx+cy*cy)*(bx-ax))/D;
      return {x:ux, y:uy, r2:(ax-ux)*(ax-ux)+(ay-uy)*(ay-uy)};
    }
    for(let i=0; i<n; i++){
      const px=pts[i].x, py=pts[i].y, bad=[], edges=[];
      for(let t=0; t<tris.length; t++){
        const c = cc(tris[t][0], tris[t][1], tris[t][2]);
        if(!c) continue;
        if((px-c.x)*(px-c.x)+(py-c.y)*(py-c.y) <= c.r2*1.000001) bad.push(t);
      }
      for(let b=0; b<bad.length; b++){
        const tr = tris[bad[b]];
        for(let e=0; e<3; e++){
          const ea=tr[e], eb=tr[(e+1)%3];
          let shared = false;
          for(let b2=0; b2<bad.length; b2++){
            if(b2 === b) continue;
            const t2 = tris[bad[b2]];
            for(let e2=0; e2<3; e2++){
              if((ea===t2[e2] && eb===t2[(e2+1)%3]) || (ea===t2[(e2+1)%3] && eb===t2[e2])){
                shared = true; break;
              }
            }
            if(shared) break;
          }
          if(!shared) edges.push([ea, eb]);
        }
      }
      bad.sort((a,b)=>b-a);
      for(let b=0; b<bad.length; b++) tris.splice(bad[b], 1);
      for(let e=0; e<edges.length; e++) tris.push([edges[e][0], edges[e][1], i]);
    }
    return tris.filter(t => t[0]<n && t[1]<n && t[2]<n);
  },

  _isInsidePoly(x, y, arr){
    let inside = false;
    for(let i=0, j=arr.length-1; i<arr.length; j=i++){
      const xi=arr[i].x, yi=arr[i].y, xj=arr[j].x, yj=arr[j].y;
      const hit = ((yi>y) !== (yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi+1e-6)+xi);
      if(hit) inside = !inside;
    }
    return inside;
  },

  /* ─── 補助 ─────────────────────────────────────────── */
  _hsv2rgb(h, s, v){
    h = ((h%1)+1)%1;
    const i = Math.floor(h*6), f = h*6 - i;
    const p = v*(1-s), q = v*(1-f*s), t = v*(1-(1-f)*s);
    switch(i%6){
      case 0: return [v,t,p]; case 1: return [q,v,p]; case 2: return [p,v,t];
      case 3: return [p,q,v]; case 4: return [t,p,v]; case 5: return [v,p,q];
    }
    return [v,v,v];
  },

  _computeAnchor(){
    const m = this.P.centerMode;
    if(m === 'center') return [(Math.random()-0.5)*0.4, (Math.random()-0.5)*0.4];
    if(m === 'grid'){
      const gx = Math.floor(Math.random()*3), gy = Math.floor(Math.random()*3);
      return [(gx-1)*0.6, (gy-1)*0.6];
    }
    if(m === 'edge'){                          // 画面外周(4辺)に配置 → inward と組み合わせて「外→中心」
      const s = Math.floor(Math.random()*4), t = (Math.random()*2-1)*0.85;
      if(s === 0) return [t, -0.9];
      if(s === 1) return [t,  0.9];
      if(s === 2) return [-0.9, t];
      return [0.9, t];
    }
    return [(Math.random()*2-1)*0.75, (Math.random()*2-1)*0.75];
  },
  _computeAngle(ax, ay){
    const d = this.P.direction;
    switch(d){
      case 'horizontal': return Math.random() < 0.5 ? 0 : Math.PI;
      case 'vertical':   return Math.random() < 0.5 ? Math.PI*0.5 : -Math.PI*0.5;
      case 'rising':     return -Math.PI*0.25 + (Math.random()-0.5)*Math.PI/6;   // ↗ 右上がり
      case 'falling':    return  Math.PI*0.25 + (Math.random()-0.5)*Math.PI/6;   // ↘ 右下がり
      case 'radial':     return Math.atan2(ay, ax) + (Math.random()-0.5)*0.3;            // 中心→外
      case 'inward':     return Math.atan2(ay, ax) + Math.PI + (Math.random()-0.5)*0.3;  // 外→中心
      case 'spin': {     // 角度が拍に沿って回転していく
        const tt = (typeof BPM !== 'undefined' && BPM.beatCount) ? BPM.beatCount() : (performance.now()/1000);
        return tt * 0.9 + (Math.random()-0.5)*0.4;
      }
      default:           return Math.random()*Math.PI*2;
    }
  },

  spawnStroke(){
    const P = this.P;
    const brushMode = this._brushName(P.brushMode);
    const isSmudge = brushMode === 'smudge' || brushMode === 'smudgeWet';
    const smudgeSpeed = Math.max(0.05, Math.min(4.0, P.smudgeSpeed == null ? 0.5 : P.smudgeSpeed));
    const smudgeMoveSpeed = smudgeSpeed * 0.25;
    const triggerRate = this._normalizeSubdiv(P.subdiv);
    const triggerBeats = 1 / Math.max(0.125, triggerRate);
    const [ax, ay] = this._computeAnchor();
    const ang = this._computeAngle(ax, ay);
    const len = Math.max(0.05, P.strokeLen * (1 + (Math.random()-0.5)*P.strokeLenVar));
    const sx = ax, sy = ay;
    const targetEx = sx + Math.cos(ang) * len;
    const targetEy = sy + Math.sin(ang) * len;
    const perpX = -Math.sin(ang), perpY = Math.cos(ang);
    // 方向指示(左右/上下/斜め)のときは Curve/蛇行を無効化して、その向きの直線ストロークにする。
    const d = P.direction;
    const straight = (d === 'horizontal' || d === 'vertical' || d === 'rising' || d === 'falling');
    const curve = straight ? 0 : P.curveAmt * len * 0.5 * (Math.random() < 0.5 ? 1 : -1);
    const cpX = (sx + targetEx) * 0.5 + perpX * curve;
    const cpY = (sy + targetEy) * 0.5 + perpY * curve;
    const color = P.hueRand ? this._hsv2rgb(Math.random(), 0.85, 1.0) : P.color.slice();
    const searchPhase = Math.max(0.01, Math.min(0.95, P.searchPhase));
    const fadePhase = Math.max(0.01, Math.min(0.95, P.fadePhase));
    // 描画時間: 0=Trigger連動(発生間隔) / >0=独立指定。発生(Trigger)と描画を分離する。
    const drawBeatsEff = isSmudge ? ((P.drawBeats > 0) ? P.drawBeats : triggerBeats) : 0;
    const lifeBeats = isSmudge
      ? Math.max(0.05, P.life, triggerBeats / Math.max(0.05, 1 - fadePhase), drawBeatsEff)
      : Math.max(0.05, P.life);

    this.strokes.push({
      sx, sy, targetEx, targetEy,
      currentEx: sx, currentEy: sy,
      cpX, cpY,
      brushMode,
      life: 1.0,
      lifeBeats,
      drawBeats: drawBeatsEff,
      searchPhase,
      searchAmp: P.searchAmp,
      searchFreq: P.searchFreq,
      fadePhase,
      fadeShape: P.fadeShape,
      sides: (P.maxSides >= 3)
        ? (Math.floor(Math.random() * (Math.max(3, P.maxSides|0) - 3 + 1)) + 3)
        : Math.max(3, Math.min(40, P.sides|0)),  // 元 P.N
	      size: Math.max(0.001, P.size * (1 + (Math.random()-0.5)*P.sizeVar)),
      sizeVar: P.sizeVar,
      warp: P.warp,
      explode: P.explode,
      focal: P.focal,
	      stamps: Math.max(2, Math.min(300, P.stamps|0)),
	      smudgeSpeed,
	      tipShape: P.tipShape || 'round',
	      rotPerStamp: P.rotPerStamp,
      spinRate: P.spin,
      curveAmt: P.curveAmt,
      straight,
      color,
      alpha: P.alpha,
      seed: Math.random() * 1000,
      nibAng: Math.random() * Math.PI,   // 平筆: 始点のペン先角 (ストロークごとにランダム確定)
      elapsed: 0,
      persist: P.persist,
      minLife: Math.max(0, 1 - Math.max(0.01, Math.min(0.95, searchPhase / (isSmudge ? smudgeMoveSpeed : 1)))),
      finish: P.finish || 'gloss',
    });

    if(P.persist){
      const cap = Math.max(1, P.maxStrokes|0);
      while(this.strokes.length > cap) this.strokes.shift();
    }
  },

  _updateProbing(s){
    const u = 1 - s.life;
    const isSmudge = s.brushMode === 'smudge' || s.brushMode === 'smudgeWet' || s.brushMode === 'smudgeStretch';
    const speed = isSmudge ? Math.max(0.05, Math.min(4.0, s.smudgeSpeed == null ? 0.5 : s.smudgeSpeed)) * 0.25 : 1;
    const searchU = Math.min(1, (u * speed) / Math.max(0.001, s.searchPhase));
    const reach = 1 - Math.pow(1 - searchU, 2);
    const baseEx = s.sx + (s.targetEx - s.sx) * reach;
    const baseEy = s.sy + (s.targetEy - s.sy) * reach;
    const strokeLenLocal = Math.hypot(s.targetEx - s.sx, s.targetEy - s.sy);
    const dAng = Math.atan2(s.targetEy - s.sy, s.targetEx - s.sx);
    const perpX = -Math.sin(dAng), perpY = Math.cos(dAng);
    const dirX = Math.cos(dAng), dirY = Math.sin(dAng);
    const wobScale = (1 - searchU);
    const wob1 = Math.sin(s.elapsed * s.searchFreq * 6.2831 + s.seed)         * s.searchAmp * strokeLenLocal * wobScale;
    const wob2 = Math.cos(s.elapsed * s.searchFreq * 6.2831 * 0.6 + s.seed*1.3) * s.searchAmp * strokeLenLocal * wobScale * 0.4;
    s.currentEx = baseEx + perpX * wob1 + dirX * wob2;
    s.currentEy = baseEy + perpY * wob1 + dirY * wob2;
  },

  update(beatCount, dt){
    if(!this.initialized) return;
    if(!this.P.enabled){
      if(this.strokes.length) this.strokes.length = 0;
      this.lastSubBeat = -1;
      return;
    }
    const bps = (BPM.bpm || 120) / 60;
    for(const s of this.strokes){
      s.elapsed += dt * bps;
      const minLife = s.persist ? s.minLife : 0;
      if(s.life > minLife){
        s.life -= (dt * bps) / s.lifeBeats;
        if(s.life < minLife) s.life = minLife;
      }
      this._updateProbing(s);
    }
    if(!this.P.persist){
      this.strokes = this.strokes.filter(s => s.life > 0);
    } else {
      const cap = Math.max(1, this.P.maxStrokes|0);
      while(this.strokes.length > cap) this.strokes.shift();
    }
    const sd = this._normalizeSubdiv(this.P.subdiv);
    if(this.P.subdiv !== sd) this.P.subdiv = sd;
    const sb = Math.floor(beatCount * sd);
    if(this.lastSubBeat < 0){
      this.lastSubBeat = sb;
    } else if(sb !== this.lastSubBeat){
      const n = Math.max(1, this.P.spawnCount|0);
      for(let i=0; i<n; i++) this.spawnStroke();
      this.lastSubBeat = sb;
    }
  },

  _computeAlpha(s){
    if(s.persist) return s.alpha;
    const u = 1 - s.life;
    const fadeStart = 1 - s.fadePhase;
    if(u <= fadeStart) return s.alpha;
    const fadeT = Math.min(1, (u - fadeStart) / Math.max(0.001, s.fadePhase));
    const ff = Math.max(0, 1 - fadeT);
    let f;
    if(s.fadeShape === 'easeOut')    f = ff * ff;
    else if(s.fadeShape === 'pulse') f = Math.sin(ff * Math.PI * 0.5);
    else                              f = ff;
    return s.alpha * f;
  },

  /* ─── pixel ⇄ NDC 変換ヘルパ ─────────────────────────── */
  // NDC(-1..1, y up) → pixel(0..W, 0..H, y up)
  _ndcToPx(nx, ny, W, H){ return [(nx+1)*0.5*W, (ny+1)*0.5*H]; },
  // 結果 NDC は y up のままで OK (vj の合成は y up で書き込み, sourceTex も y up)
  _pxToNdc(px, py, W, H){ return [px/W*2 - 1, py/H*2 - 1]; },

  /* ─── 共通: uvPts / posPts / tris から VBO+IBO データ生成 ─ */
  _makeGeom(uvPts, posPts, tris, W, H, softArr){
    const n = uvPts.length;
    const verts = new Float32Array(n * 5);   // [x, y, u, v, soft]。soft=頂点アルファ (1=不透明)
    for(let i=0; i<n; i++){
      // POS は pixel → NDC
      const [nx, ny] = this._pxToNdc(posPts[i].px, posPts[i].py, W, H);
      // UV は pixel → [0,1]
      const u = uvPts[i].x / W;
      const v = uvPts[i].y / H;
      verts[i*5]     = nx;
      verts[i*5 + 1] = ny;
      verts[i*5 + 2] = u;
      verts[i*5 + 3] = v;
      verts[i*5 + 4] = softArr ? softArr[i] : 1.0;   // 指先など縁ぼかし用。未指定は 1 (硬い縁・従来通り)
    }
    const indices = new Uint16Array(tris.length * 3);
    for(let t=0; t<tris.length; t++){
      indices[t*3]     = tris[t][0];
      indices[t*3+1]   = tris[t][1];
      indices[t*3+2]   = tris[t][2];
    }
    return {verts, indices};
  },

  /* ─── 元 buildWarp 移植 ───────────────────────────── */
  _buildWarp(s, W, H){
    const [cx, cy] = this._ndcToPx(s.sx, s.sy, W, H);
    const [cex, cey] = this._ndcToPx(s.currentEx, s.currentEy, W, H);
    const ddx = cex - cx, ddy = cey - cy;
    const dLen = Math.hypot(ddx, ddy);
    const hasDrag = dLen > 4;
    const dAng = hasDrag ? Math.atan2(ddy, ddx) : 0;
    const R = Math.min(W, H) * s.size;
    const N = s.sides;
    const seed = s.seed;

    const uvPts = [{x: cx, y: cy}];
    for(let i=1; i<N; i++){
      const fi = seed * 1000 + i * 37;
      const ang = this._fh(fi * 4.1) * Math.PI * 2;
      let r = Math.sqrt(this._fh(fi * 5.7)) * R;
      if(hasDrag) r *= 1 + Math.max(0, Math.cos(ang - dAng)) * (dLen / R) * 0.8;
      uvPts.push({x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r});
    }
    const tris = this._delaunay(uvPts);

    const posPts = uvPts.map((p, i) => {
      const fi = seed * 2000 + i * 53;
      const wAng = this._fh(fi * 6.3) * Math.PI * 2;
      const wR = this._fh(fi * 7.1) * R * s.warp;
      const wx = (p.x - cx) + Math.cos(wAng) * wR;
      const wy = (p.y - cy) + Math.sin(wAng) * wR;
      const zA = R * s.explode;
      let z = (this._fh(fi * 3.71) - 0.5) * 2 * zA + (this._fh(fi * 7.13) - 0.5) * zA * 0.5;
      if(hasDrag) z += (wx * Math.cos(dAng) + wy * Math.sin(dAng)) / R * (dLen / R) * zA;
      const sc = s.focal * R / Math.max(s.focal * R + z, R * 0.05);
      return {px: cx + wx * sc, py: cy + wy * sc};
    });
    return this._makeGeom(uvPts, posPts, tris, W, H);
  },

  /* ─── 元 buildRise 移植 ───────────────────────────── */
  _buildRise(s, W, H){
    const [cx, cy] = this._ndcToPx(s.sx, s.sy, W, H);
    const [cex, cey] = this._ndcToPx(s.currentEx, s.currentEy, W, H);
    const ddx = cex - cx, ddy = cey - cy;
    const dLen = Math.hypot(ddx, ddy);
    const hasDrag = dLen > 4;
    const dAng = hasDrag ? Math.atan2(ddy, ddx) : 0;
    const R = Math.min(W, H) * s.size;
    const N = s.sides;
    const seed = s.seed;

    const uvPts = [{x: cx, y: cy}];
    for(let i=1; i<N; i++){
      const fi = seed * 1000 + i * 37;
      const ang = this._fh(fi * 4.1) * Math.PI * 2;
      const rBase = Math.sqrt(this._fh(fi * 5.7)) * R;
      let lx, ly;
      if(hasDrag){
        const stretch = Math.min(dLen, R * 3);
        const rx = rBase * (1 + stretch / R);
        const ry = rBase * 0.6;
        const lx0 = Math.cos(ang) * rx;
        const ly0 = Math.sin(ang) * ry;
        lx = lx0 * Math.cos(dAng) - ly0 * Math.sin(dAng);
        ly = lx0 * Math.sin(dAng) + ly0 * Math.cos(dAng);
      } else {
        lx = Math.cos(ang) * rBase;
        ly = Math.sin(ang) * rBase;
      }
      uvPts.push({x: cx + lx, y: cy + ly});
    }
    const tris = this._delaunay(uvPts);

    const posPts = uvPts.map((p, i) => {
      const fi = seed * 2000 + i * 53;
      const dx = p.x - cx, dy = p.y - cy;
      const proj = hasDrag ? (dx * Math.cos(dAng) + dy * Math.sin(dAng)) : 0;
      const perp = hasDrag ? (-dx * Math.sin(dAng) + dy * Math.cos(dAng)) : 0;
      const falloff = Math.exp(-perp * perp / (R * R * 0.4));
      const rise = (proj > 0 ? proj / R * dLen : proj / R * dLen * 0.2) * s.explode * 1.4 * falloff;
      const wAng = this._fh(fi * 6.3) * Math.PI * 2;
      const wR = this._fh(fi * 7.1) * R * s.warp * 0.3;
      return {
        px: p.x + Math.cos(dAng) * rise + Math.cos(wAng) * wR,
        py: p.y + Math.sin(dAng) * rise + Math.sin(wAng) * wR,
      };
    });
    return this._makeGeom(uvPts, posPts, tris, W, H);
  },

  /* ─── 元 buildSmear 移植 (簡略化) ─────────────────── */
  _buildSmear(s, W, H){
    const [cx, cy] = this._ndcToPx(s.sx, s.sy, W, H);
    const [cex, cey] = this._ndcToPx(s.currentEx, s.currentEy, W, H);
    const ddx = cex - cx, ddy = cey - cy;
    const dLen = Math.hypot(ddx, ddy);
    const hasDrag = dLen > 2;
    const dAng = hasDrag ? Math.atan2(ddy, ddx) : 0;
    const ux = Math.cos(dAng), uy = Math.sin(dAng);
    const perpX = -uy, perpY = ux;
    const R = Math.min(W, H) * s.size;
    const polyN = s.sides;
    const seed = s.seed;
    const jitter = 0.35 + s.warp * 0.55;

    // 輪郭ポリゴン
    const poly = [];
    for(let i=0; i<polyN; i++){
      const a = i / polyN * Math.PI * 2;
      const fi = seed * 1000 + i * 31;
      let r = R * (0.45 + this._fh(fi * 2.7) * 0.70);
      if(this._fh(fi * 4.9) > 0.62) r *= 0.35 + this._fh(fi * 6.1) * 0.35;
      const gx = (this._fh(fi * 7.3) - 0.5) * R * jitter * 0.22;
      const gy = (this._fh(fi * 8.1) - 0.5) * R * jitter * 0.22;
      poly.push({x: cx + Math.cos(a) * r + gx, y: cy + Math.sin(a) * r + gy});
    }
    // 内部点を追加
    const pts = poly.slice();
    const innerN = Math.max(8, polyN * 2);
    let added = 0, tries = 0;
    const maxTries = innerN * 20;
    while(added < innerN && tries < maxTries){
      tries++;
      const fi = seed * 2000 + tries * 43;
      const a = this._fh(fi * 3.7) * Math.PI * 2;
      const r = Math.sqrt(this._fh(fi * 5.9)) * R;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if(this._isInsidePoly(x, y, poly)){ pts.push({x, y}); added++; }
    }
    pts.push({x: cx, y: cy});

    const tris = this._delaunay(pts);

    // POS 変形: ドラッグ方向へ延長
    const stretch = dLen * (0.9 + s.explode * 2.6);
    const posPts = pts.map((p, i) => {
      const lx = p.x - cx, ly = p.y - cy;
      const along = lx * ux + ly * uy;
      const side  = Math.abs(lx * perpX + ly * perpY);
      const front = hasDrag ? Math.max(0, (along + R) / (2 * R)) : 0;
      const sideFall = Math.max(0, 1 - side / (R * 1.15));
      const pull = front * stretch * (0.25 + 0.75 * sideFall);
      const fi = seed * 3000 + i * 17;
      const wobble = (this._fh(fi * 4.3) - 0.5) * R * s.warp * 0.12 * front;
      return {
        px: p.x + ux * pull + perpX * wobble,
        py: p.y + uy * pull + perpY * wobble,
      };
    });

    // 輪郭外の三角形を除外
    const filtered = [];
    for(let t=0; t<tris.length; t++){
      const tx = (pts[tris[t][0]].x + pts[tris[t][1]].x + pts[tris[t][2]].x) / 3;
      const ty = (pts[tris[t][0]].y + pts[tris[t][1]].y + pts[tris[t][2]].y) / 3;
      if(this._isInsidePoly(tx, ty, poly)) filtered.push(tris[t]);
    }
    return this._makeGeom(pts, posPts, filtered, W, H);
  },

  /* ─── smudge ローカル形状 (Delaunay 含む) を生成 ─ stroke 単位で 1 回だけ呼ぶ
     pts: ローカル座標 (中心=原点), tris: 三角形 index 配列。
     stamp の sx/sy/ex/ey/ang0/ang1 は _smudgeApplyTransform で当てる。 */
  _buildSmudgeLocal(s, stepSeed, radMul, flow, W, H, sidesOverride, cleanShape){
    const rScale = (radMul == null) ? 1 : radMul;
    const aMul = (flow == null) ? 1 : Math.max(0.0, Math.min(1, flow));
    const R = Math.min(W, H) * s.size * Math.max(0.0, rScale);
    const polyN = (sidesOverride|0) || s.sides;
    // 軽量化: interior 点数を polyN*2→polyN, edge sample 32→14 に削減
    const interiorN = Math.max(polyN, 6);
    // 筆先形状: [scaleFwd(進行方向), scaleAcross(直交方向)]。丸=等方 / Gペン=進行方向に細長く尖る /
    //   指先=丸筆に縁ぼかし(中心→縁で頂点アルファ 1→0)。※平筆は別経路(リボン掃引)で描く。
    const TIP = { round:[1.0, 1.0], gpen:[1.55, 0.5], finger:[1.0, 1.0] };
    const tip = TIP[s.tipShape] || TIP.round;
    const scaleFwd = tip[0];
    const scaleAcross = tip[1];
    const softTip = (s.tipShape === 'finger');   // 縁を柔らかくぼかす筆先

    const poly = [];
    const baseJ = 0.08 + s.warp * 0.18;
    let jitter = (sidesOverride && sidesOverride < 10) ? (baseJ + 0.45) : baseJ;
    if(cleanShape) jitter = 0;
    for(let k=0; k<polyN; k++){
      const fi = stepSeed * 700 + k * 19;
      const ang = (k / polyN) * Math.PI * 2;
      const rr = R * (0.84 + this._fh(fi * 2.1) * jitter);
      poly.push({x: Math.cos(ang) * rr * scaleFwd, y: Math.sin(ang) * rr * scaleAcross});
    }
    const pts = [{x: 0, y: 0}];
    for(let i=0; i<poly.length; i++) pts.push({x: poly[i].x, y: poly[i].y});
    let added = 0, tries = 0;
    const maxTries = interiorN * 12;
    while(added < interiorN && tries < maxTries){
      tries++;
      const fi = stepSeed * 1000 + tries * 37;
      const ang = this._fh(fi * 4.1) * Math.PI * 2;
      const r = Math.sqrt(this._fh(fi * 5.7)) * R * 0.98;
      const x = Math.cos(ang) * r * scaleFwd, y = Math.sin(ang) * r * scaleAcross;
      if(this._isInsidePoly(x, y, poly)){ pts.push({x, y}); added++; }
    }
    const edgeSamples = Math.max(2, Math.ceil(14 / polyN));
    for(let i=0; i<polyN; i++){
      const a = poly[i], b = poly[(i+1) % polyN];
      for(let p=0; p<=edgeSamples; p++){
        const t = p / edgeSamples;
        pts.push({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t});
      }
    }
    // Delaunay はローカル座標で 1 度だけ実行 → stamp ごとに再利用
    const tris = this._delaunay(pts);
    // 縁ぼかし: 頂点ごとのアルファ (中心=1 → 縁=0 の smoothstep 放射falloff)。指先のみ。
    let soft = null;
    if(softTip){
      soft = new Array(pts.length);
      for(let i=0; i<pts.length; i++){
        const rn = Math.min(1, Math.hypot(pts[i].x / scaleFwd, pts[i].y / scaleAcross) / R);
        const t = 1 - rn;
        soft[i] = t * t * (3 - 2 * t);
      }
    }
    return {pts, tris, aMul, soft};
  },

  // ローカル形状を sx/sy (UV center) と ex/ey (POS center) へ適用して geom を返す
  // scale/posScale: POS 側の縮尺。UV 側は等倍のまま = 拾う範囲は Size のまま維持する。
  _smudgeApplyTransform(local, sx, sy, ex, ey, ang0, ang1, W, H, scale, posScale){
    const sc = (scale == null) ? 1 : scale;
    const ps = (posScale == null) ? 1 : Math.max(0.001, posScale);
    const c0 = Math.cos(ang0), s0 = Math.sin(ang0);
    const c1 = Math.cos(ang1), s1 = Math.sin(ang1);
    const sameAng = (ang0 === ang1) && (sc === 1) && (ps === 1);
    const uvPts = new Array(local.pts.length);
    const posPts = new Array(local.pts.length);
    for(let i=0; i<local.pts.length; i++){
      const p = local.pts[i];
      const u0x = p.x * c0 - p.y * s0, u0y = p.x * s0 + p.y * c0;
      uvPts[i] = {x: sx + u0x, y: sy + u0y};
      if(sameAng){
        posPts[i] = {px: ex + u0x, py: ey + u0y};
      } else {
        const q0x = (p.x * c1 - p.y * s1) * sc * ps, q0y = (p.x * s1 + p.y * c1) * sc * ps;
        posPts[i] = {px: ex + q0x, py: ey + q0y};
      }
    }
    return this._makeGeom(uvPts, posPts, local.tris, W, H, local.soft);
  },

  /* ─── buildCurve 移植 (imagon 最新: マルチセグメント Catmull-Rom) ─
   *   EXPLODE 0→1 で 1..9 セグメント。1 段は古典的な S/U 字ベジェ。
   *   複数段は Catmull-Rom で C1 連続な蛇行ストローク。WARP は振れ幅。
   */
  _buildCurve(s, W, H){
    const [cx, cy] = this._ndcToPx(s.sx, s.sy, W, H);
    const [cex, cey] = this._ndcToPx(s.currentEx, s.currentEy, W, H);
    const ddx = cex - cx, ddy = cey - cy;
    const dLen = Math.hypot(ddx, ddy);
    if(dLen < 4) return null;
    const dAng = Math.atan2(ddy, ddx);
    const perpX = -Math.sin(dAng), perpY = Math.cos(dAng);
    const R = Math.min(W, H) * s.size;
    const seed = s.seed;
    const r1 = this._fh(seed*111.7), r2 = this._fh(seed*222.3+17),
          r3 = this._fh(seed*333.9+43), r4 = this._fh(seed*444.1+71);
    const strokeWBase = R * 0.07 * (0.5 + r4 * 1.0) * 5;
    // 方向指示(左右/上下/斜め)のときは蛇行/曲げを無効化して直線にする。
    const numSeg = s.straight ? 1 : Math.max(1, Math.round(1 + s.explode * 4));

    // 単一ベジェ (古典的 S/U 字)
    if(numSeg === 1){
      const maxOff = s.straight ? 0 : dLen * 0.5 * s.warp;
      let off1, off2;
      if(r3 > 0.38){
        off1 = (r1 - 0.5) * 2 * maxOff;
        off2 = (r2 - 0.5) * 2 * maxOff;
        if(off1 * off2 > 0) off2 = -off2;
      } else {
        const side = r1 > 0.5 ? 1 : -1;
        off1 = side * (0.5 + r1 * 0.5) * maxOff;
        off2 = side * (0.5 + r2 * 0.5) * maxOff;
      }
      const cp1x = cx + ddx * (0.30 + r1 * 0.10) + perpX * off1;
      const cp1y = cy + ddy * (0.30 + r1 * 0.10) + perpY * off1;
      const cp2x = cx + ddx * (0.65 + r2 * 0.10) + perpX * off2;
      const cp2y = cy + ddy * (0.65 + r2 * 0.10) + perpY * off2;
      const steps = Math.max(20, Math.min(300, Math.floor(dLen * 0.8)));
      const pts = [];
      for(let i=0; i<=steps; i++){
        const t = i / steps, mt = 1 - t;
        const bx = mt*mt*mt*cx + 3*mt*mt*t*cp1x + 3*mt*t*t*cp2x + t*t*t*cex;
        const by = mt*mt*mt*cy + 3*mt*mt*t*cp1y + 3*mt*t*t*cp2y + t*t*t*cey;
        const tdx = 3*mt*mt*(cp1x-cx) + 6*mt*t*(cp2x-cp1x) + 3*t*t*(cex-cp2x);
        const tdy = 3*mt*mt*(cp1y-cy) + 6*mt*t*(cp2y-cp1y) + 3*t*t*(cey-cp2y);
        const tLen = Math.sqrt(tdx*tdx + tdy*tdy);
        const nx = tLen > 0.001 ? -tdy / tLen : perpX;
        const ny = tLen > 0.001 ?  tdx / tLen : perpY;
        const taper = Math.pow(Math.sin(Math.PI * t), 0.55);
        pts.push({bx, by, nx, ny, w: strokeWBase * taper, gt: t});
      }
      return this._buildCurveStrip(pts, perpX, perpY, cx, cy, ddx, ddy, W, H);
    }

    // マルチセグメント Catmull-Rom 蛇行
    const maxOff = dLen * 0.45 * s.warp / Math.sqrt(numSeg);
    const wps = [{x:cx, y:cy}];
    for(let i=1; i<numSeg; i++){
      const tt = i / numSeg;
      const lx = cx + ddx * tt, ly = cy + ddy * tt;
      const fi = seed*500 + i*73;
      let sign = (i % 2 === 1) ? 1 : -1;
      if(this._fh(fi*2.3) > 0.78) sign = -sign;
      const mag = (0.45 + this._fh(fi*3.7) * 0.55) * maxOff;
      wps.push({x: lx + perpX*sign*mag, y: ly + perpY*sign*mag});
    }
    wps.push({x:cex, y:cey});
    const tension = 0.5;
    const tangs = [];
    for(let i=0; i<wps.length; i++){
      const prev = wps[Math.max(0, i-1)], next = wps[Math.min(wps.length-1, i+1)];
      if(i === 0)                   tangs.push({x:(wps[1].x - wps[0].x)*tension, y:(wps[1].y - wps[0].y)*tension});
      else if(i === wps.length - 1) tangs.push({x:(wps[i].x - wps[i-1].x)*tension, y:(wps[i].y - wps[i-1].y)*tension});
      else                          tangs.push({x:(next.x - prev.x)*tension, y:(next.y - prev.y)*tension});
    }
    const totalSteps = Math.max(20, Math.min(400, Math.floor(dLen * 0.9)));
    const sps = Math.max(4, Math.ceil(totalSteps / numSeg));
    const totalPts = numSeg * sps + 1;
    const pts = []; let ptIdx = 0;
    for(let seg=0; seg<numSeg; seg++){
      const w0 = wps[seg], w3 = wps[seg+1];
      const t0 = tangs[seg], t3 = tangs[seg+1];
      const p1x = w0.x + t0.x/3, p1y = w0.y + t0.y/3;
      const p2x = w3.x - t3.x/3, p2y = w3.y - t3.y/3;
      const si = (seg === 0) ? 0 : 1;
      for(let i=si; i<=sps; i++){
        const t = i / sps, mt = 1 - t;
        const gt = ptIdx / (totalPts - 1);
        const bx = mt*mt*mt*w0.x + 3*mt*mt*t*p1x + 3*mt*t*t*p2x + t*t*t*w3.x;
        const by = mt*mt*mt*w0.y + 3*mt*mt*t*p1y + 3*mt*t*t*p2y + t*t*t*w3.y;
        const tdx = 3*mt*mt*(p1x - w0.x) + 6*mt*t*(p2x - p1x) + 3*t*t*(w3.x - p2x);
        const tdy = 3*mt*mt*(p1y - w0.y) + 6*mt*t*(p2y - p1y) + 3*t*t*(w3.y - p2y);
        const tLen = Math.sqrt(tdx*tdx + tdy*tdy);
        const nx = tLen > 0.001 ? -tdy/tLen : perpX;
        const ny = tLen > 0.001 ?  tdx/tLen : perpY;
        const taper = Math.pow(Math.sin(Math.PI * gt), 0.55);
        pts.push({bx, by, nx, ny, w: strokeWBase * taper, gt});
        ptIdx++;
      }
    }
    return this._buildCurveStrip(pts, perpX, perpY, cx, cy, ddx, ddy, W, H);
  },

  /* imagon 流の線形 UV クワッドストリップ (Curve 専用) */
  _buildCurveStrip(pts, perpX, perpY, cx, cy, ddx, ddy, W, H){
    const n = pts.length;
    const verts = new Float32Array(n * 2 * 5);   // 頂点 5要素 [x,y,u,v,soft]。strip は縁ぼかし無し (soft=1)
    for(let i=0; i<n; i++){
      const p = pts[i];
      const lx = p.bx + p.nx * p.w, ly = p.by + p.ny * p.w;
      const rx = p.bx - p.nx * p.w, ry = p.by - p.ny * p.w;
      const uvBx = cx + ddx * p.gt, uvBy = cy + ddy * p.gt;
      const uvLx = uvBx + perpX * p.w, uvLy = uvBy + perpY * p.w;
      const uvRx = uvBx - perpX * p.w, uvRy = uvBy - perpY * p.w;
      const [nLx, nLy] = this._pxToNdc(lx, ly, W, H);
      const [nRx, nRy] = this._pxToNdc(rx, ry, W, H);
      verts[i*10 + 0] = nLx; verts[i*10 + 1] = nLy;
      verts[i*10 + 2] = uvLx / W; verts[i*10 + 3] = uvLy / H; verts[i*10 + 4] = 1.0;
      verts[i*10 + 5] = nRx; verts[i*10 + 6] = nRy;
      verts[i*10 + 7] = uvRx / W; verts[i*10 + 8] = uvRy / H; verts[i*10 + 9] = 1.0;
    }
    const triCount = (n - 1) * 2;
    const indices = new Uint16Array(triCount * 3);
    for(let i=0; i<n-1; i++){
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      indices[i * 6 + 0] = a; indices[i * 6 + 1] = b; indices[i * 6 + 2] = c;
      indices[i * 6 + 3] = b; indices[i * 6 + 4] = d; indices[i * 6 + 5] = c;
    }
    return {verts, indices};
  },

  // ストローク両端に半円のラウンドキャップを付ける(アクションペインティングの丸い先端)。
  _addRoundCaps(pts){
    const n = pts.length;
    if(n < 2) return pts;
    const CAP = 6;
    // 終点キャップ(進行方向へ半円)
    const last = pts[n-1], prevL = pts[n-2];
    let tx = last.bx - prevL.bx, ty = last.by - prevL.by, tl = Math.hypot(tx,ty)||1; tx/=tl; ty/=tl;
    const endCap = [];
    for(let k=1; k<=CAP; k++){
      const a = (k/CAP) * Math.PI*0.5;
      endCap.push({bx: last.bx + tx*Math.sin(a)*last.w, by: last.by + ty*Math.sin(a)*last.w,
                   nx: last.nx, ny: last.ny, w: Math.max(0.5, Math.cos(a)*last.w), gt: last.gt});
    }
    // 始点キャップ(逆方向へ半円 → 逆順で先頭に付与)
    const first = pts[0], nextF = pts[1];
    let sx = first.bx - nextF.bx, sy = first.by - nextF.by, sl = Math.hypot(sx,sy)||1; sx/=sl; sy/=sl;
    const startCap = [];
    for(let k=1; k<=CAP; k++){
      const a = (k/CAP) * Math.PI*0.5;
      startCap.push({bx: first.bx + sx*Math.sin(a)*first.w, by: first.by + sy*Math.sin(a)*first.w,
                     nx: first.nx, ny: first.ny, w: Math.max(0.5, Math.cos(a)*first.w), gt: first.gt});
    }
    startCap.reverse();
    return startCap.concat(pts, endCap);
  },
  _buildQuadStrip(pts, cx, cy, cex, cey, W, H){
    // strip vertices: 各 t で 2 頂点 (左右側)
    const n = pts.length;
    const verts = new Float32Array(n * 2 * 5);   // 頂点 5要素 [x,y,u,v,soft]。strip は縁ぼかし無し (soft=1)
    for(let i=0; i<n; i++){
      const p = pts[i];
      // POS pixel
      const lx = p.bx + p.nx * p.w, ly = p.by + p.ny * p.w;
      const rx = p.bx - p.nx * p.w, ry = p.by - p.ny * p.w;
      // UV: 始点 (cx, cy) 周辺を t に沿ってスイープ。ストローク全体で「始点の色を引きずる」効果
      // 進行方向に「始点付近」の色を流す: 始点周辺の円を strip 幅でサンプル
      const uvCx = cx, uvCy = cy;
      const uvR = Math.hypot(p.w, p.w) * 1.0;
      const uvSweepX = Math.cos(p.gt * Math.PI * 2) * uvR * 0.7;
      const uvSweepY = Math.sin(p.gt * Math.PI * 2) * uvR * 0.7;
      const uvLx = uvCx + uvSweepX + p.nx * p.w * 0.5;
      const uvLy = uvCy + uvSweepY + p.ny * p.w * 0.5;
      const uvRx = uvCx + uvSweepX - p.nx * p.w * 0.5;
      const uvRy = uvCy + uvSweepY - p.ny * p.w * 0.5;
      // pixel → NDC + UV → [0,1]
      const [nLx, nLy] = this._pxToNdc(lx, ly, W, H);
      const [nRx, nRy] = this._pxToNdc(rx, ry, W, H);
      verts[i*10 + 0] = nLx; verts[i*10 + 1] = nLy;
      verts[i*10 + 2] = uvLx / W; verts[i*10 + 3] = uvLy / H; verts[i*10 + 4] = 1.0;
      verts[i*10 + 5] = nRx; verts[i*10 + 6] = nRy;
      verts[i*10 + 7] = uvRx / W; verts[i*10 + 8] = uvRy / H; verts[i*10 + 9] = 1.0;
    }
    // strip → triangles 化
    const triCount = (n - 1) * 2;
    const indices = new Uint16Array(triCount * 3);
    for(let i=0; i<n-1; i++){
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      indices[i * 6 + 0] = a; indices[i * 6 + 1] = b; indices[i * 6 + 2] = c;
      indices[i * 6 + 3] = b; indices[i * 6 + 4] = d; indices[i * 6 + 5] = c;
    }
    return {verts, indices};
  },

  /* ─── pollock: ペン軌跡 (進行に応じて伸びる書道風ストローク) ───
     - 三次ベジェ + ジッタ + 圧力パルスで「書いている感」を出す
     - 寿命の進行 (1 - s.life) でヘッドが先端 t=1 に向かって伸びる
     - 始点は固定。終点は targetEx/Ey (currentEx/Ey は使わず最終形を確定)
  */
  _buildPollock(s, W, H){
    const [cx, cy]   = this._ndcToPx(s.sx, s.sy, W, H);
    const [cex, cey] = this._ndcToPx(s.targetEx, s.targetEy, W, H);
    const ddx = cex - cx, ddy = cey - cy;
    const dLen = Math.hypot(ddx, ddy);
    if(dLen < 4) return null;
    const dAng = Math.atan2(ddy, ddx);
    const perpX = -Math.sin(dAng), perpY = Math.cos(dAng);
    const R = Math.min(W, H) * s.size;

    const seed = s.seed;
    const r1 = this._fh(seed*111.7), r2 = this._fh(seed*222.3+17),
          r3 = this._fh(seed*333.9+43), r4 = this._fh(seed*444.1+71);
    // bezier 制御点 (単弓 or S字)
    const isS = r3 > 0.55;
    const bendSign = r1 > 0.5 ? 1 : -1;
    const bendAmt  = dLen * s.curveAmt * (0.15 + r2 * 0.22) * s.warp;
    const cp1x = cx + ddx * 0.33 + perpX * bendAmt * bendSign;
    const cp1y = cy + ddy * 0.33 + perpY * bendAmt * bendSign;
    const cp2x = cx + ddx * 0.67 + perpX * bendAmt * (isS ? -bendSign : bendSign);
    const cp2y = cy + ddy * 0.67 + perpY * bendAmt * (isS ? -bendSign : bendSign);

    // 進行度: stroke 寿命の最初 80% でヘッドが先端に到達。残り 20% は完成形を保持
    const u = 1 - s.life;
    const headT = Math.max(0.001, Math.min(1.0, u / 0.80));

    // パス分割数 (ヘッド到達分のみ)
    const fullSteps = Math.max(24, Math.min(400, Math.floor(dLen * 0.9)));
    const steps = Math.max(2, Math.floor(fullSteps * headT));

    // 圧力パルス (calligraphic) — gaussian peaks
    const p1c = 0.18 + r1*0.14, p1w = 0.08 + r2*0.06, p1a = 0.55 + r3*0.45;
    const p2c = 0.48 + r2*0.14, p2w = 0.09 + r3*0.06, p2a = 0.70 + r4*0.55;
    const p3c = 0.78 + r3*0.10, p3w = 0.07 + r4*0.05, p3a = 0.45 + r1*0.45;
    const microFreq  = 2.5 + r4 * 3.5;
    const microPhase = r1 * Math.PI * 2;

    const baseW = R * (0.5 + r4 * 0.6);

    // gloss=低ジッタ・狭幅 / matt=高ジッタ・広幅 (滲み感)
    const isMatt = (s.finish === 'matt');
    const jitterMul = isMatt ? 0.45 : 0.18;
    const widthMul  = isMatt ? 1.25 : 1.0;

    // 軌跡サンプル (頂点ごとに偏微分接線で normal を出して幅を変える)
    const pts = [];
    let jx = 0, jy = 0;
    const jitterAmp = baseW * jitterMul * s.warp;
    for(let i=0; i<=steps; i++){
      const t = i / Math.max(1, fullSteps);
      const mt = 1 - t;
      const bx = mt*mt*mt*cx + 3*mt*mt*t*cp1x + 3*mt*t*t*cp2x + t*t*t*cex;
      const by = mt*mt*mt*cy + 3*mt*mt*t*cp1y + 3*mt*t*t*cp2y + t*t*t*cey;
      // 相関ノイズ (滑らかな手ぶれ)
      jx = jx * 0.78 + (Math.random() - 0.5) * jitterAmp * 0.22;
      jy = jy * 0.78 + (Math.random() - 0.5) * jitterAmp * 0.22;
      const px = bx + jx, py = by + jy;
      // 接線 → 法線
      const tdx = 3*mt*mt*(cp1x-cx) + 6*mt*t*(cp2x-cp1x) + 3*t*t*(cex-cp2x);
      const tdy = 3*mt*mt*(cp1y-cy) + 6*mt*t*(cp2y-cp1y) + 3*t*t*(cey-cp2y);
      const tLen = Math.sqrt(tdx*tdx + tdy*tdy);
      const nx = tLen > 0.001 ? -tdy / tLen : perpX;
      const ny = tLen > 0.001 ?  tdx / tLen : perpY;
      // 圧力 (mainEnvelope + 3 gaussian pulses + micro)
      const env = Math.sin(Math.PI * Math.pow(t, 0.82));
      const g1 = p1a * Math.exp(-Math.pow((t - p1c) / p1w, 2));
      const g2 = p2a * Math.exp(-Math.pow((t - p2c) / p2w, 2));
      const g3 = p3a * Math.exp(-Math.pow((t - p3c) / p3w, 2));
      const micro = 0.14 * Math.max(0, Math.sin(t * Math.PI * microFreq + microPhase));
      const pressure = Math.max(0.18, Math.min(1.8, env * 0.45 + g1 + g2 + g3 + micro));
      // アクションペインティング: 端は尖らせず圧力幅のまま → 両端を丸キャップで仕上げる
      const w = baseW * widthMul * Math.max(0.15, pressure);
      pts.push({bx: px, by: py, nx, ny, w, gt: t});
    }
    if(pts.length < 2) return null;
    return this._buildQuadStrip(this._addRoundCaps(pts), cx, cy, cex, cey, W, H);
  },

  /* ─── gpen: 漫画用 G ペン (入り鋭く / 抜きより鋭く / 先端 1px / 中央膨らみ) ─────
       Dropbox/shader/pen の widthAt プロファイルを移植。Size Var = 太さの上限。 */
  _buildGpen(s, W, H){
    const [cx, cy]   = this._ndcToPx(s.sx, s.sy, W, H);
    const [cex, cey] = this._ndcToPx(s.targetEx, s.targetEy, W, H);
    const ddx = cex - cx, ddy = cey - cy;
    const dLen = Math.hypot(ddx, ddy);
    if(dLen < 4) return null;
    const dAng = Math.atan2(ddy, ddx);
    const perpX = -Math.sin(dAng), perpY = Math.cos(dAng);
    const R = Math.min(W, H) * s.size;
    const seed = s.seed;
    const r1 = this._fh(seed*111.7), r2 = this._fh(seed*222.3+17),
          r3 = this._fh(seed*333.9+43), r4 = this._fh(seed*444.1+71);
    // bezier 制御点 (単弓 or S字)
    const isS = r3 > 0.55;
    const bendSign = r1 > 0.5 ? 1 : -1;
    const bendAmt  = dLen * s.curveAmt * (0.15 + r2 * 0.22) * s.warp;
    const cp1x = cx + ddx * 0.33 + perpX * bendAmt * bendSign;
    const cp1y = cy + ddy * 0.33 + perpY * bendAmt * bendSign;
    const cp2x = cx + ddx * 0.67 + perpX * bendAmt * (isS ? -bendSign : bendSign);
    const cp2y = cy + ddy * 0.67 + perpY * bendAmt * (isS ? -bendSign : bendSign);
    // 進行度: ヘッドが伸びる
    const u = 1 - s.life;
    const headT = Math.max(0.001, Math.min(1.0, u / 0.80));
    const fullSteps = Math.max(24, Math.min(400, Math.floor(dLen * 0.9)));
    const steps = Math.max(2, Math.floor(fullSteps * headT));
    // 最大幅: Size Var が太さを決める (0=最小 / 1 に近づくほど太く)
    const baseMax = R * (0.10 + s.sizeVar * (0.5 + r4 * 1.5));
    // 入り抜き: 抜き(exit)をより鋭く。長い stroke ほどテーパー区間が伸びる。
    const taperT = Math.max(0.0, Math.min(1.0, (dLen - 60) / 340));
    const entryLen = 0.10 * (0.4 + 0.6*taperT);
    const exitLen  = 0.16 * (0.4 + 0.6*taperT);
    const entryK = 1.8 + r2*1.2;
    const exitK  = 2.6 + r3*2.4;          // 抜きの方が鋭く尾を引く
    const swellAmt = 0.25 + r1*0.25;      // 中央の膨らみ(筆圧感)
    const isMatt = (s.finish === 'matt');
    const jitterAmp = baseMax * (isMatt ? 0.30 : 0.10) * s.warp;
    const pts = [];
    let jx = 0, jy = 0;
    for(let i=0; i<=steps; i++){
      const t = i / Math.max(1, fullSteps);
      const mt = 1 - t;
      const bx = mt*mt*mt*cx + 3*mt*mt*t*cp1x + 3*mt*t*t*cp2x + t*t*t*cex;
      const by = mt*mt*mt*cy + 3*mt*mt*t*cp1y + 3*mt*t*t*cp2y + t*t*t*cey;
      jx = jx * 0.82 + (Math.random() - 0.5) * jitterAmp * 0.2;
      jy = jy * 0.82 + (Math.random() - 0.5) * jitterAmp * 0.2;
      const px = bx + jx, py = by + jy;
      const tdx = 3*mt*mt*(cp1x-cx) + 6*mt*t*(cp2x-cp1x) + 3*t*t*(cex-cp2x);
      const tdy = 3*mt*mt*(cp1y-cy) + 6*mt*t*(cp2y-cp1y) + 3*t*t*(cey-cp2y);
      const tLen = Math.sqrt(tdx*tdx + tdy*tdy);
      const nx = tLen > 0.001 ? -tdy / tLen : perpX;
      const ny = tLen > 0.001 ?  tdx / tLen : perpY;
      // 入りテーパー / 抜きテーパー → 先端は 0 (= 1px にクランプ)
      const inT  = (t < entryLen) ? Math.pow(t / entryLen, entryK) : 1.0;
      const outT = (t > 1 - exitLen) ? Math.pow((1 - t) / exitLen, exitK) : 1.0;
      const swell = (1.0 - swellAmt) + swellAmt * Math.sin(Math.PI * Math.pow(t, 0.85));
      const w = baseMax * swell * Math.min(inT, outT);
      // 伸長中のヘッド先端も細く
      const headTaper = (i >= steps - 3) ? Math.max(0.2, (steps - i) / 3) : 1.0;
      pts.push({bx: px, by: py, nx, ny, w: Math.max(1, w * headTaper), gt: t});
    }
    if(pts.length < 2) return null;
    return this._buildQuadStrip(pts, cx, cy, cex, cey, W, H);
  },

  /* ─── polygon: シンプル N 角形 (Delaunay 不要) ──── */
  _buildPolygon(s, W, H){
    const [cx, cy] = this._ndcToPx(s.sx, s.sy, W, H);
    const R = Math.min(W, H) * s.size;
    const N = s.sides;
    const uvPts = [{x: cx, y: cy}];
    const posPts = [{px: cx, py: cy}];
    const tris = [];
    for(let k=0; k<N; k++){
      const a = (k / N) * Math.PI * 2;
      const jr = 1 + Math.sin(s.seed + k * 7.1) * 0.3 * s.warp;
      const x = cx + Math.cos(a) * R * jr;
      const y = cy + Math.sin(a) * R * jr;
      uvPts.push({x, y});
      posPts.push({px: x, py: y});
    }
    for(let k=0; k<N; k++){
      tris.push([0, k+1, ((k+1) % N) + 1]);
    }
    return this._makeGeom(uvPts, posPts, tris, W, H);
  },

  /* ─── SPIKE 移植 (imagon buildBlob): ウニ/びっくり吹き出し ─ */
  _buildSpike(s, W, H){
    const [cx, cy] = this._ndcToPx(s.sx, s.sy, W, H);
    const [cex, cey] = this._ndcToPx(s.currentEx, s.currentEy, W, H);
    const ddx = cex - cx, ddy = cey - cy;
    const dLen = Math.hypot(ddx, ddy);
    const hasDrag = dLen > 4;
    const dAng = hasDrag ? Math.atan2(ddy, ddx) : 0;
    const R = Math.min(W, H) * s.size;
    const ux = Math.cos(dAng), uy = Math.sin(dAng), pxn = -uy, pyn = ux;
    const spikeN = Math.max(3, Math.min(24, s.sides|0));
    const seed = s.seed;

    const tips = [];
    for(let i=0;i<spikeN;i++){
      const fi = seed*1000 + i*31;
      const a = i/spikeN*Math.PI*2 + (this._fh(fi*9.1)-0.5)*(Math.PI*2/spikeN)*0.7;
      const rr = R*(0.7 + this._fh(fi*2.7)*0.5);
      tips.push({x: cx+Math.cos(a)*rr, y: cy+Math.sin(a)*rr, a});
    }
    const valley = R*(0.25 + s.warp*0.4);
    const poly = [];
    const subdiv = 10;
    for(let i=0;i<spikeN;i++){
      const t0 = tips[i], t1 = tips[(i+1)%spikeN];
      const ma = t0.a + ((((t1.a - t0.a) % (Math.PI*2)) + Math.PI*2) % (Math.PI*2))/2;
      const fi = seed*1700 + i*53;
      const vr = valley*(0.5 + this._fh(fi*3.1)*0.9);
      const off = (this._fh(fi*5.3)-0.5)*0.5;
      const va = ma + off*(Math.PI*2/spikeN);
      const vx = cx+Math.cos(va)*vr, vy = cy+Math.sin(va)*vr;
      for(let st=0;st<subdiv;st++){
        const t = st/subdiv, mt = 1-t;
        poly.push({x: mt*mt*t0.x + 2*mt*t*vx + t*t*t1.x, y: mt*mt*t0.y + 2*mt*t*vy + t*t*t1.y});
      }
    }
    const stretch = dLen*(0.3 + s.explode*1.1);
    const rise = (x,y) => {
      if(!hasDrag) return {x, y};
      const lx = x-cx, ly = y-cy;
      const proj = lx*ux + ly*uy;
      const perp = lx*pxn + ly*pyn;
      const falloff = Math.exp(-perp*perp/(R*R*0.6));
      const pull = (proj>0 ? proj/R : proj/R*0.3)*stretch*falloff;
      return {x: x+ux*pull, y: y+uy*pull};
    };
    const uvShrink = 0.35;
    const N = poly.length;
    const ctr = rise(cx, cy);
    const uvPts = [{x: cx, y: cy}];
    const posPts = [{px: ctr.x, py: ctr.y}];
    for(let i=0;i<N;i++){
      uvPts.push({x: cx+(poly[i].x-cx)*uvShrink, y: cy+(poly[i].y-cy)*uvShrink});
      const d = rise(poly[i].x, poly[i].y);
      posPts.push({px: d.x, py: d.y});
    }
    const tris = [];
    for(let i=0;i<N;i++) tris.push([0, i+1, ((i+1)%N)+1]);
    return this._makeGeom(uvPts, posPts, tris, W, H);
  },

  /* ─── 内部判定 / カーブ接続ヘルパ (RANDOM 用) ───────── */
  _pointInPoly(x, y, arr){
    let inside = false;
    for(let i=0, j=arr.length-1; i<arr.length; j=i++){
      const xi=arr[i].x, yi=arr[i].y, xj=arr[j].x, yj=arr[j].y;
      const hit = ((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi+1e-6)+xi);
      if(hit) inside = !inside;
    }
    return inside;
  },
  _curveConnectPoly(corners, subdivisions, seed, mag, R){
    const n = corners.length, out = [];
    const minOff = R*0.12;
    let gx=0, gy=0;
    for(let g=0; g<n; g++){ gx+=corners[g].x; gy+=corners[g].y; }
    gx/=n; gy/=n;
    for(let i=0;i<n;i++){
      const p0=corners[i], p1=corners[(i+1)%n];
      const dx=p1.x-p0.x, dy=p1.y-p0.y;
      const len=Math.hypot(dx,dy);
      if(len<0.01){ out.push({x:p0.x,y:p0.y}); continue; }
      const nx=-dy/len, ny=dx/len;
      const fi=seed*7919 + i*131;
      const r1=this._fh(fi*2.7), r2=this._fh(fi*3.3);
      const midx=(p0.x+p1.x)*0.5, midy=(p0.y+p1.y)*0.5;
      const inward=((gx-midx)*nx+(gy-midy)*ny)>0?1:-1;
      const mag1=(0.4+r1*0.7)*mag*len + minOff*(0.4+r1*0.5);
      const mag2=(0.4+r2*0.7)*mag*len + minOff*(0.4+r2*0.5);
      const c1x=p0.x+dx*0.33+nx*inward*mag1, c1y=p0.y+dy*0.33+ny*inward*mag1;
      const c2x=p0.x+dx*0.67+nx*inward*mag2, c2y=p0.y+dy*0.67+ny*inward*mag2;
      const sub=Math.max(10, subdivisions);
      for(let st=0; st<sub; st++){
        const t=st/sub, mt=1-t;
        out.push({
          x: mt*mt*mt*p0.x + 3*mt*mt*t*c1x + 3*mt*t*t*c2x + t*t*t*p1.x,
          y: mt*mt*mt*p0.y + 3*mt*mt*t*c1y + 3*mt*t*t*c2y + t*t*t*p1.y,
        });
      }
    }
    return out;
  },

  /* ─── RANDOM 移植 (imagon buildBloom) ───────────────── */
  _buildRandom(s, W, H){
    const [cx, cy] = this._ndcToPx(s.sx, s.sy, W, H);
    const [cex, cey] = this._ndcToPx(s.currentEx, s.currentEy, W, H);
    const ddx = cex - cx, ddy = cey - cy;
    const dLen = Math.hypot(ddx, ddy);
    const dAng = dLen > 1 ? Math.atan2(ddy, ddx) : 0;
    const R = Math.min(W, H) * s.size;
    const dSeed = s.seed + Math.floor(dLen / Math.max(8, R*0.25));
    const polyN = Math.max(3, Math.min(40, s.sides|0));
    const stretchX = 1 + Math.min(dLen/(R*2), 1.2)*0.8;
    const ux=Math.cos(dAng), uy=Math.sin(dAng), pxn=-uy, pyn=ux;
    const corners = [];
    for(let i=0;i<polyN;i++){
      const fi = dSeed*1000 + i*37;
      const a = i/polyN*Math.PI*2 + this._fh(fi*8.3)*0.4;
      let rBase = R*(0.45 + this._fh(fi*5.7)*0.55);
      if(this._fh(fi*4.9) > 0.62) rBase *= 0.35 + this._fh(fi*6.1)*0.35;
      const lx = Math.cos(a)*rBase*stretchX, ly = Math.sin(a)*rBase;
      corners.push({x: cx+lx*ux+ly*pxn, y: cy+lx*uy+ly*pyn});
    }
    const poly = this._curveConnectPoly(corners, 20, dSeed, 0.5 + s.warp*0.7, R);
    const pts = poly.slice();
    const innerN = Math.max(24, (s.sides|0)*3);
    let added=0, tries=0; const maxTries = innerN*20;
    while(added<innerN && tries<maxTries){
      tries++;
      const fi = dSeed*2000 + tries*43;
      const ang = this._fh(fi*3.7)*Math.PI*2;
      const r = Math.sqrt(this._fh(fi*5.9))*R*1.6;
      const x = cx+Math.cos(ang)*r, y = cy+Math.sin(ang)*r;
      if(this._pointInPoly(x, y, poly)){ pts.push({x, y}); added++; }
    }
    pts.push({x: cx, y: cy});
    const allTris = this._delaunay(pts);
    const tris = [];
    for(const tri of allTris){
      const cxT=(pts[tri[0]].x+pts[tri[1]].x+pts[tri[2]].x)/3;
      const cyT=(pts[tri[0]].y+pts[tri[1]].y+pts[tri[2]].y)/3;
      if(this._pointInPoly(cxT, cyT, poly)) tris.push(tri);
    }
    const distMag = R*(0.25 + s.warp*0.6 + s.explode*0.5);
    const posPts = pts.map((p,i) => {
      const fi = dSeed*3000 + i*53;
      const d = Math.hypot(p.x-cx, p.y-cy);
      const falloff = Math.max(0, 1 - d/(R*1.2));
      const a = this._fh(fi*4.3)*Math.PI*2;
      const m = (0.4 + this._fh(fi*6.1)*0.6)*distMag*falloff;
      return {px: p.x+Math.cos(a)*m, py: p.y+Math.sin(a)*m};
    });
    return this._makeGeom(pts, posPts, tris, W, H);
  },

  /* ─── SWOOSH 移植 (imagon buildSwoosh): 始点→終点のスウッシュ ─ */
  _buildSwoosh(s, W, H){
    const [cx, cy] = this._ndcToPx(s.sx, s.sy, W, H);
    const [cex, cey] = this._ndcToPx(s.currentEx, s.currentEy, W, H);
    const ddx = cex - cx, ddy = cey - cy;
    const dLen = Math.hypot(ddx, ddy);
    const hasDrag = dLen > 4;
    const R = Math.min(W, H) * s.size;
    const seed = s.seed;
    const ang = hasDrag ? Math.atan2(ddy, ddx) : this._fh(seed*3.1) * Math.PI * 2;
    const ux = Math.cos(ang), uy = Math.sin(ang), pxn = -uy, pyn = ux;
    const L = hasDrag ? dLen : R * 1.6;
    const tailX = cx, tailY = cy;
    const tipX = cx + ux*L, tipY = cy + uy*L;
    const bendSign = (this._fh(seed*7.3) > 0.5) ? 1 : -1;
    const bend = L * s.warp * 0.7 * bendSign;
    const jit = s.explode;
    const o1 = bend*0.70 + (this._fh(seed*4.1) - 0.5) * jit * L * 0.9;
    const o2 = bend*0.15 + (this._fh(seed*5.7) - 0.5) * jit * L * 0.9;
    const s1 = (this._fh(seed*6.3) - 0.5) * jit * 1.2;
    const s2 = (this._fh(seed*8.1) - 0.5) * jit * 1.2;
    const c1X = tailX + (tipX - tailX) * (0.30 + s1) + pxn * o1;
    const c1Y = tailY + (tipY - tailY) * (0.30 + s1) + pyn * o1;
    const c2X = tailX + (tipX - tailX) * (0.70 + s2) + pxn * o2;
    const c2Y = tailY + (tipY - tailY) * (0.70 + s2) + pyn * o2;
    const center = (t)=>{
      const mt = 1 - t;
      return {
        x: mt*mt*mt*tailX + 3*mt*mt*t*c1X + 3*mt*t*t*c2X + t*t*t*tipX,
        y: mt*mt*mt*tailY + 3*mt*mt*t*c1Y + 3*mt*t*t*c2Y + t*t*t*tipY,
        tx: 3*mt*mt*(c1X - tailX) + 6*mt*t*(c2X - c1X) + 3*t*t*(tipX - c2X),
        ty: 3*mt*mt*(c1Y - tailY) + 6*mt*t*(c2Y - c1Y) + 3*t*t*(tipY - c2Y),
      };
    };
    const maxW = R * 0.22;
    const width = (t)=> maxW * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, 0.6))), 1.8);
    const ucx = (cx + tipX) * 0.5, ucy = (cy + tipY) * 0.5, uvShrink = 0.4;
    const uvOf = (x, y)=>({x: ucx + (x - ucx) * uvShrink, y: ucy + (y - ucy) * uvShrink});

    const N = 56;
    const uvPts = [], posPts = [], tris = [];
    let prevL = null, prevR = null, idx = 0;
    for(let i=0; i<=N; i++){
      const t = i / N, c = center(t);
      const tl = Math.sqrt(c.tx*c.tx + c.ty*c.ty) || 1;
      const nx = -c.ty / tl, ny = c.tx / tl, w = width(t);
      const Le = {x: c.x + nx*w, y: c.y + ny*w};
      const Rr = {x: c.x - nx*w, y: c.y - ny*w};
      const uL = uvOf(Le.x, Le.y), uR = uvOf(Rr.x, Rr.y);
      uvPts.push(uL); posPts.push({px:Le.x, py:Le.y});         // index idx*2
      uvPts.push(uR); posPts.push({px:Rr.x, py:Rr.y});         // index idx*2+1
      if(i > 0){
        const a = (idx-1)*2, b = (idx-1)*2 + 1, c2 = idx*2, d = idx*2 + 1;
        tris.push([a, b, c2]);
        tris.push([b, d, c2]);
      }
      prevL = Le; prevR = Rr;
      idx++;
    }
    return this._makeGeom(uvPts, posPts, tris, W, H);
  },

  /* ─── render ────────────────────────────────────── */
  render(w, h){
    if(!this.initialized || !this.P.enabled) return;
    if(this.strokes.length === 0) return;
    if(!this.sourceTex) return;
    const gl = this.gl;

    gl.useProgram(this.prog);
    gl.enable(gl.BLEND);
    const bm = this.P.blendMode;
    if(bm === 'add')           gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    else if(bm === 'multiply') gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    else if(bm === 'screen')   gl.blendFunc(gl.ONE_MINUS_DST_COLOR, gl.ONE);
    else                       gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
    gl.uniform1i(this.locs.tex, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(this.locs.pos);
    gl.vertexAttribPointer(this.locs.pos, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(this.locs.uv);
    gl.vertexAttribPointer(this.locs.uv, 2, gl.FLOAT, false, 20, 8);
    if(this.locs.soft >= 0){ gl.enableVertexAttribArray(this.locs.soft); gl.vertexAttribPointer(this.locs.soft, 1, gl.FLOAT, false, 20, 16); }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);

    for(const s of this.strokes){
      const alpha = this._computeAlpha(s);
      if(alpha < 0.001) continue;
      gl.uniform4f(this.locs.tint, s.color[0], s.color[1], s.color[2], alpha);

      if(s.brushMode === 'smudge' || s.brushMode === 'smudgeWet' || s.brushMode === 'smudgeStretch'){
        // 指先ツール (Photoshop の指先) : 始点付近のピクセルを経路に沿って引きずる。
        // UV は経路を後方に圧縮した位置から拾う (strength=1 で常に始点 = 無限に引きずる)。
        // 先端は太く不透明、尾に向かって先細り + フェードで「指でこすった」筋になる。
        // WARP スライダー = 引きずり強度 (strength)。
	        const stretchSource = s.brushMode === 'smudgeWet' || s.brushMode === 'smudgeStretch';
	        const fingerTip = s.tipShape === 'finger';
        const [cx, cy] = this._ndcToPx(s.sx, s.sy, w, h);
        const [cex, cey] = this._ndcToPx(s.targetEx, s.targetEy, w, h);
        const ddx = cex - cx, ddy = cey - cy;
        const dLen = Math.hypot(ddx, ddy);
        if(dLen < 1) continue;
        // 軌道: Explode=曲がり回数 / Warp+Curve=振れ幅 の蛇行パス(Catmull-Rom/Hermite)。
        const _perpX = -ddy / (dLen || 1), _perpY = ddx / (dLen || 1);
        // 方向指示(左右/上下/斜め)のときは蛇行させず直線にする。
        let numSeg = s.straight ? 1 : (1 + Math.round(s.explode * 4));
        if(!s.straight && numSeg < 2 && (Math.abs(s.curveAmt) > 0.05 || s.warp > 0.05)) numSeg = 2;   // Curve/Warp があれば最低 1 曲がり
        const _amp = s.straight ? 0 : dLen * (0.32 * s.warp + 0.26 * Math.abs(s.curveAmt));
        const _sp = this._serpentinePath(cx, cy, cex, cey, _perpX, _perpY, s.seed, numSeg, _amp);
        const pathAt = (tt)=> this._hermiteAt(_sp.wps, _sp.tangs, tt);
        let pathLen = 0;
        let prevPath = pathAt(0);
        for(let pi=1; pi<=8; pi++){
          const p = pathAt(pi / 8);
          pathLen += Math.hypot(p.x - prevPath.x, p.y - prevPath.y);
          prevPath = p;
        }
        const R = Math.min(w, h) * s.size;
        const strength = Math.max(0.05, Math.min(1, s.warp));
        const speed = Math.max(0.05, Math.min(4.0, s.smudgeSpeed == null ? 0.5 : s.smudgeSpeed));
        const drawBeats = Math.max(0.05, s.drawBeats || s.lifeBeats || 1);
        const headT = Math.max(0.001, Math.min(1.0, s.elapsed / drawBeats));
        // stamp 密度: UI の Stamps を下限に、長いストロークは 0.18R 間隔まで補間して滑らかにする。
        const requested = Math.max(40, Math.min(300, s.stamps|0));
        let denseN = Math.max(requested, Math.ceil(pathLen / Math.max(1, R * 0.18)));
        denseN = Math.min(300, denseN);
        const ldt = (typeof GL !== 'undefined') ? (GL.lastDt || 0.016) : 0.016;
        if(ldt > 1/40) denseN = Math.max(requested, Math.floor(denseN * 0.75));
        if(ldt > 1/28) denseN = Math.max(requested, Math.floor(denseN * 0.65));
        const fullStamps = denseN;
        const stamps = Math.max(2, Math.ceil(fullStamps * headT));
        // スタンプ数が増えても濃くなり過ぎないよう flow は薄めに保つ。
        const flow = stretchSource
          ? Math.max(0.022, Math.min(0.28, 6.6 / fullStamps))
          : Math.max(0.028, Math.min(0.34, 8.4 / fullStamps));
        // 平筆 = 固定角のペン先(nib)で描く非交差リボン。スタンプ連打ではなく 1 枚のストリップ。
        //   接線と nib の角度差から見かけ幅を計算し、軌道の法線方向へ展開する。
	        if(s.tipShape === 'flat'){
	          // 平先端(nib)は始点で決めたランダム固定角。ストローク中は一切回転させない。
	          //   固定線分を直接掃引すると細い箇所で bowtie が生じるため、POS は常に軌道法線へ出す。
	          const nibHalf = R * 1.1;                                 // ペン先の半長
	          const dAng = Math.atan2(cey - cy, cex - cx);             // ストローク全体の向き
	          const nibAng = (s.nibAng !== undefined) ? s.nibAng : this._fh(s.seed * 5.17 + 2.3) * Math.PI;   // 始点で確定したランダム角
          const nibUx = Math.cos(nibAng), nibUy = Math.sin(nibAng);
          const nbx = nibUx * nibHalf, nby = nibUy * nibHalf;
          const minHalf = 1.25;                                    // ピンチ点でも三角形を消失させない
          const N = Math.max(2, Math.min(stamps, 120));
          const verts = new Float32Array(N * 2 * 5);
          let prevTx = Math.cos(dAng), prevTy = Math.sin(dAng);
          for(let i=0; i<N; i++){
            const t = (i / (N - 1)) * headT;
            const dst = pathAt(t);
            let tangentLen = Math.hypot(dst.tx, dst.ty);
            let tx = prevTx, ty = prevTy;
            if(tangentLen > 0.001){
              tx = dst.tx / tangentLen;
              ty = dst.ty / tangentLen;
              // Hermite の折り返し付近でも法線の左右を反転させず、帯の接続を安定させる。
              if(tx * prevTx + ty * prevTy < 0){ tx = -tx; ty = -ty; }
            }
            prevTx = tx; prevTy = ty;
            const nx = -ty, ny = tx;
            const widthHalf = Math.max(minHalf, nibHalf * Math.abs(tx * nibUy - ty * nibUx));
            const offX = nx * widthHalf, offY = ny * widthHalf;
            let srcT;
            if(stretchSource){
              const lag = (0.035 + strength * 0.22) * Math.sqrt(speed);
              const behindT = Math.max(0, t - lag * (0.45 + 0.55 * t));
              const loadedT = t * Math.pow(1 - strength, 2.2) * 0.35;
              const carry = Math.min(0.64, 0.16 + strength * 0.48);
              srcT = behindT * (1 - carry) + loadedT * carry;
            } else {
              srcT = t * (1 - strength);
            }
            const src = pathAt(srcT);
            const [pLx, pLy] = this._pxToNdc(dst.x + offX, dst.y + offY, w, h);
            const [pRx, pRy] = this._pxToNdc(dst.x - offX, dst.y - offY, w, h);
            verts[i*10+0]=pLx; verts[i*10+1]=pLy;
            verts[i*10+2]=(src.x + nbx)/w; verts[i*10+3]=(src.y + nby)/h; verts[i*10+4]=1;
            verts[i*10+5]=pRx; verts[i*10+6]=pRy;
            verts[i*10+7]=(src.x - nbx)/w; verts[i*10+8]=(src.y - nby)/h; verts[i*10+9]=1;
          }
          const indices = new Uint16Array((N - 1) * 6);
          for(let i=0; i<N-1; i++){
            const a=i*2, b=i*2+1, c=(i+1)*2, d=(i+1)*2+1;
            indices[i*6]=a; indices[i*6+1]=b; indices[i*6+2]=c;
            indices[i*6+3]=b; indices[i*6+4]=d; indices[i*6+5]=c;
          }
          gl.uniform4f(this.locs.tint, s.color[0], s.color[1], s.color[2], alpha);
          gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);
	          gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
	          continue;
	        }
	        if(s.tipShape === 'gpen'){
	          const dAng = Math.atan2(cey - cy, cex - cx);
	          const baseHalf = Math.max(0.55, Math.min(2.2, R * (0.45 + s.sizeVar * 0.8)));
	          const N = Math.max(2, Math.min(fullStamps, 420));
	          const verts = new Float32Array(N * 2 * 5);
	          let prevTx = Math.cos(dAng), prevTy = Math.sin(dAng);
	          for(let i=0; i<N; i++){
	            const t = (i / (N - 1)) * headT;
	            const dst = pathAt(t);
	            let tangentLen = Math.hypot(dst.tx, dst.ty);
	            let tx = prevTx, ty = prevTy;
	            if(tangentLen > 0.001){
	              tx = dst.tx / tangentLen;
	              ty = dst.ty / tangentLen;
	              if(tx * prevTx + ty * prevTy < 0){ tx = -tx; ty = -ty; }
	            }
	            prevTx = tx; prevTy = ty;
	            const nx = -ty, ny = tx;
	            const taper = Math.max(0.42, Math.pow(Math.sin(Math.PI * Math.min(1, t / Math.max(0.001, headT))), 0.45));
	            const widthHalf = baseHalf * taper;
	            let srcT;
	            if(stretchSource){
	              const lag = (0.035 + strength * 0.22) * Math.sqrt(speed);
	              const behindT = Math.max(0, t - lag * (0.45 + 0.55 * t));
	              const loadedT = t * Math.pow(1 - strength, 2.2) * 0.35;
	              const carry = Math.min(0.64, 0.16 + strength * 0.48);
	              srcT = behindT * (1 - carry) + loadedT * carry;
	            } else {
	              srcT = t * (1 - strength);
	            }
	            const src = pathAt(srcT);
	            const offX = nx * widthHalf, offY = ny * widthHalf;
	            const [pLx, pLy] = this._pxToNdc(dst.x + offX, dst.y + offY, w, h);
	            const [pRx, pRy] = this._pxToNdc(dst.x - offX, dst.y - offY, w, h);
	            verts[i*10+0]=pLx; verts[i*10+1]=pLy;
	            verts[i*10+2]=(src.x + offX)/w; verts[i*10+3]=(src.y + offY)/h; verts[i*10+4]=1;
	            verts[i*10+5]=pRx; verts[i*10+6]=pRy;
	            verts[i*10+7]=(src.x - offX)/w; verts[i*10+8]=(src.y - offY)/h; verts[i*10+9]=1;
	          }
	          const indices = new Uint16Array((N - 1) * 6);
	          for(let i=0; i<N-1; i++){
	            const a=i*2, b=i*2+1, c=(i+1)*2, d=(i+1)*2+1;
	            indices[i*6]=a; indices[i*6+1]=b; indices[i*6+2]=c;
	            indices[i*6+3]=b; indices[i*6+4]=d; indices[i*6+5]=c;
	          }
	          gl.uniform4f(this.locs.tint, s.color[0], s.color[1], s.color[2], alpha);
	          gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
	          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);
	          gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
	          continue;
	        }
	        // stroke ごとにローカル形状 (Delaunay 込み) を 1 度だけ生成 → stamp で変換して再利用
	        if(!s._smudgeLocal){
	          s._smudgeLocal = this._buildSmudgeLocal(s, s.seed, 1.0, flow, w, h, stretchSource ? Math.max(22, s.sides) : Math.max(12, s.sides), stretchSource);
	        }
	        const local = s._smudgeLocal;
	        const posScale = 1;
        for(let i=0; i<stamps; i++){
          const t = (i / Math.max(1, stamps - 1)) * headT;
          const dst = pathAt(t);                            // 置く位置: Curve に沿った経路上
          let srcT;
          if(stretchSource){
            const lag = (0.035 + strength * 0.22) * Math.sqrt(speed);
            const behindT = Math.max(0, t - lag * (0.45 + 0.55 * t));
            const loadedT = t * Math.pow(1 - strength, 2.2) * 0.35;
            const carry = Math.min(0.64, 0.16 + strength * 0.48);
            srcT = behindT * (1 - carry) + loadedT * carry;
          } else {
            srcT = t * (1 - strength);
          }
          const src = pathAt(srcT);                         // Wet は少し後ろの色を連続的に引っ張る
          const taper = stretchSource ? (1 - 0.18 * t) : (1 - 0.4 * t);
          const fade = stretchSource
            ? (0.72 + 0.28 * (1 - t * (1 - strength * 0.45)))
            : (1 - t * (1 - strength * 0.55));              // 尾ほど薄く (強度が高いほど色が残る)
          const srcAng = Math.atan2(src.ty, src.tx) + i * s.rotPerStamp;
          const dstAng = Math.atan2(dst.ty, dst.tx) + i * s.rotPerStamp;
	          const drawAlpha = fingerTip ? alpha * flow * Math.max(0, fade) : alpha;
	          gl.uniform4f(this.locs.tint, s.color[0], s.color[1], s.color[2], drawAlpha);
	          const geom = this._smudgeApplyTransform(local, src.x, src.y, dst.x, dst.y, srcAng, dstAng, w, h, taper, posScale);
          gl.bufferData(gl.ARRAY_BUFFER, geom.verts, gl.DYNAMIC_DRAW);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.indices, gl.DYNAMIC_DRAW);
          gl.drawElements(gl.TRIANGLES, geom.indices.length, gl.UNSIGNED_SHORT, 0);
        }
        continue;
      }

      let geom;
      switch(s.brushMode){
        case 'warp':    geom = this._buildWarp(s, w, h);    break;
        case 'rise':    geom = this._buildRise(s, w, h);    break;
        case 'smear':   geom = this._buildSmear(s, w, h);   break;
        case 'curve':   geom = this._buildCurve(s, w, h);   break;
        case 'pollock': geom = this._buildPollock(s, w, h); break;
        case 'gpen':    geom = this._buildGpen(s, w, h);    break;
        case 'polygon': geom = this._buildPolygon(s, w, h); break;
        case 'spike':   geom = this._buildSpike(s, w, h);   break;
        case 'random':  geom = this._buildRandom(s, w, h);  break;
        case 'swoosh':  geom = this._buildSwoosh(s, w, h);  break;
        default:        geom = this._buildWarp(s, w, h);
      }
      if(!geom) continue;
      gl.bufferData(gl.ARRAY_BUFFER, geom.verts, gl.DYNAMIC_DRAW);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.indices, gl.DYNAMIC_DRAW);
      gl.drawElements(gl.TRIANGLES, geom.indices.length, gl.UNSIGNED_SHORT, 0);
    }
    gl.disable(gl.BLEND);
  },

  clear(){
    this.strokes.length = 0;
    this.lastSubBeat = -1;
  }
};
