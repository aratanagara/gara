'use strict';
/* Rhizome engine — vj/ の追加レンダリングモード (kind:'rhizome')。
   リゾーム的なダイアグラム (黄緑の楕円のノード・緑の細い線・茶色の四角と線・矢印付きの青い弧) の要素が、
   次々とポップアップして現れては消えていく。
   - ノードは nodes 個の枠がそれぞれ自分の周期 (Life のまわりでばらつく) で生まれ直し、周期ごとに種類と位置を引き直す。
     生まれるときは、生きている親の近くに出て親から線が伸び、届いた所でふくらんで (少し弾んで) 現れる。
     親がいなければ画面のどこかに単独で出る。現れたあと、近くにいる他のノードへも線を伸ばす。
     消えるときは先に線が縮み、続いてノードがしぼむ。親が先に消えても子は残る。
     親子の深さは周期ごとの段 (0〜3) で決め、段の浅いノードにだけつながる (再帰が必ず止まる)。
   - 種類: 黄緑の楕円 (大半) / 線の端の点 (巻きひげ) / 茶色の四角 (茶色の線でつながる) / サーモン色の菱形
   - 青い弧: 別の枠で、弧が伸びて矢印が付き、しばらくして尾が先端へ追いついて消える。
   - 時刻だけから決まる (状態を持たない)。逆再生や拍の飛びでもそのまま。C キーでスロットの時計が 0 に戻ると最初から。
     beat モードは拍が時間の単位で、生まれる時刻が半拍にそろい、拍頭でノードがふくらむ (Kick)。drone は秒が単位。
   - 描画は 1 要素 = 1 インスタンスの四角形を頂点シェーダで置き、形 (線分・楕円・菱形・四角・点・弧) はフラグメントで
     距離から描く。色鉛筆のかすれ (Pencil) と楕円の塗りの筆致もフラグメント。
   - Slot A は紙 (paper) を敷く。Slot B は背景を透過する (前乗算アルファ)。
   参照したのは Marc Ngui による『千のプラトー』のためのドローイングの雰囲気。配置は乱数から生成していて、トレースではない。
   IF: init(gl) / update() / render({fbo,w,h,slot,beat,clock,opaque}) / P / PDefaults / SPECS
*/

const Rhizome = {
  gl:null, initialized:false, ok:false,
  prog:null, vao:null, cornerVBO:null, instVBO:null, instCap:0, U:null,
  _memo:null, _sig:'', _cfg:null, _salt:0,

  // ── パラメータ (UI から操作)。数値は使う直前に App.deadParam を通す ──
  P:{
    style:0,        // 0 = 網 (図 1: 楕円・線・四角・弧) / 1 = 面と流れ (図 2: 菱形の網・縦の面・人・流れる矢印・うねる赤線・波の帯) / 2 = 両方
    speed:100,      // 時間の速さ (%)
    life:6,         // ノードの寿命の目安 (秒。beat では拍)
    nodes:180,      // ノードの枠の数 (同時に見えるのはおよそ 6〜7 割)
    links:100,      // 近くのノードへ伸ばす線の量 (%)
    size:100,       // 楕円・四角・菱形の大きさ (%)
    tendrils:100,   // 端に点のある線 (巻きひげ) の量 (%)
    squares:40,     // 茶色の四角の量 (%)
    arcs:100,       // 青い弧 (図 1) と流れる矢印 (図 2) の量 (%)
    planes:100,     // 縦に立つ面の量 (%。図 2)
    figures:100,    // 人の輪郭の量 (%。図 2)
    meander:100,    // うねる赤い線の量 (%。図 2)
    band:100,       // 下を流れる緑の波の帯の濃さ (%。図 2)
    diamonds:8,     // 菱形の割合 (%。図 2 では菱形が主になる)
    spread:100,     // 子が親から離れて生まれる距離 (%)
    line:100,       // 線の太さ (%)
    pencil:100,     // 色鉛筆のかすれと塗りむら (%)
    pop:100,        // ポップの弾み (%)
    kick:60,        // 拍でノードがふくらむ量 (%)
    drift:40,       // 画面がゆっくり流れる量 (%)
    seed:0,         // 乱数のシード
    paper:[0.965, 0.958, 0.935],   // 紙の色 (Slot A)。Slot B は透過
  },

  SPECS:[
    {sel:true, label:'Style', key:'style', opts:['網 (図 1)', '面と流れ (図 2)', '両方']},
    ['Speed',    'speed',    0,  300, 1,   'pct'],
    ['Life',     'life',     1,  32,  0.5, 'f2'],
    ['Nodes',    'nodes',    10, 400, 1,   'int'],
    ['Links',    'links',    0,  300, 1,   'pct'],
    ['Size',     'size',     10, 300, 1,   'pct'],
    ['Tendrils', 'tendrils', 0,  300, 1,   'pct'],
    ['Squares',  'squares',  0,  300, 1,   'pct'],
    ['Arcs',     'arcs',     0,  300, 1,   'pct'],
    ['Planes',   'planes',   0,  300, 1,   'pct'],
    ['Figures',  'figures',  0,  300, 1,   'pct'],
    ['Meander',  'meander',  0,  300, 1,   'pct'],
    ['Band',     'band',     0,  200, 1,   'pct'],
    ['Diamonds', 'diamonds', 0,  100, 1,   'pct'],
    ['Spread',   'spread',   10, 300, 1,   'pct'],
    ['Line',     'line',     20, 400, 1,   'pct'],
    ['Pencil',   'pencil',   0,  200, 1,   'pct'],
    ['Pop',      'pop',      0,  300, 1,   'pct'],
    ['Kick',     'kick',     0,  200, 1,   'pct'],
    ['Drift',    'drift',    0,  300, 1,   'pct'],
    ['Seed',     'seed',     0,  99,  1,   'int'],
  ],

  COL:{
    lime:[0.73, 0.94, 0.17], limeRim:[0.45, 0.73, 0.15], green:[0.40, 0.73, 0.38], dot:[0.30, 0.58, 0.28],
    salmon:[0.86, 0.52, 0.45], brown:[0.50, 0.28, 0.23], sqLine:[0.58, 0.38, 0.34], sqFill:[0.93, 0.83, 0.80],
    blue:[0.24, 0.54, 0.88], ink:[0.20, 0.19, 0.19], red:[0.85, 0.22, 0.18], band:[0.45, 0.78, 0.40],
  },

  VS:`#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iA;   // 線: 両端 / 形: 中心 xy と半径 zw / 弧: 中心 xy と半径 z
layout(location=2) in vec4 iB;   // 種類, 回転, 線の半幅, 不透明度
layout(location=3) in vec4 iC;   // 色
layout(location=4) in vec4 iD;   // 2 番目の色 / 弧: 始まりの角度と符号付きの開き
uniform vec2 uCam;               // 画面の中心 (ワールド)
uniform vec2 uHalf;              // 画面の半幅・半高 (ワールド)
uniform float uPx;               // 1px のワールド長
out vec2 vW;
flat out vec4 vA;
flat out vec4 vB;
flat out vec4 vC;
flat out vec4 vD;
void main(){
  vA = iA; vB = iB; vC = iC; vD = iD;
  float type = iB.x;
  float pad = iB.z + 3.0 * uPx;
  vec2 w;
  if(type < 0.5){
    vec2 a = iA.xy, b = iA.zw;
    vec2 d = b - a;
    float L = length(d);
    vec2 t = L > 1e-7 ? d / L : vec2(1.0, 0.0);
    vec2 n = vec2(-t.y, t.x);
    w = a + t * (aCorner.x * (L + 2.0 * pad) - pad) + n * ((aCorner.y * 2.0 - 1.0) * pad);
  } else if(type > 5.5 && type < 6.5){
    w = uCam + (aCorner * 2.0 - 1.0) * uHalf;
  } else {
    float R = (type > 4.5 ? iA.z : max(iA.z, iA.w)) + pad;
    w = iA.xy + (aCorner * 2.0 - 1.0) * R;
  }
  vW = w;
  gl_Position = vec4((w - uCam) / uHalf, 0.0, 1.0);
}`,

  FS:`#version 300 es
precision highp float;
in vec2 vW;
flat in vec4 vA;
flat in vec4 vB;
flat in vec4 vC;
flat in vec4 vD;
uniform float uPx;
uniform float uPencil;
out vec4 o;
float h2(vec2 p){
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float vn(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
}
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float seg(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0);
  return length(pa - ba * h);
}
void main(){
  float type = vB.x;
  float px = uPx;
  vec2 w = vW;
  // 色鉛筆のかすれ (紙の目に沿う) と線の太さのむら
  float tooth = vn(w * vec2(900.0, 340.0));
  float grain = 1.0 - uPencil * 0.42 * smoothstep(0.25, 0.95, tooth);
  float wob = (vn(w * 70.0 + 3.1) - 0.5) * 0.9 * px * uPencil;
  vec3 col = vC.rgb;
  float a = 0.0;
  if(type < 0.5){                                   // 線分
    float d = seg(w, vA.xy, vA.zw);
    a = (1.0 - smoothstep(vB.z - 0.5 * px, vB.z + px, d + wob)) * grain;
  } else if(type < 1.5){                            // 楕円 (塗り + 濃い縁 + 塗りの筆致)
    vec2 q = rot(-vB.y) * (w - vA.xy);
    float de = (length(q / vA.zw) - 1.0) * vA.w;
    float hatch = 0.5 + 0.5 * sin(dot(w, vec2(0.62, 0.78)) * 1100.0 + wob / max(px, 1e-7) * 4.0);
    col = mix(vC.rgb, vD.rgb, smoothstep(-2.6 * px, -0.3 * px, de)) * (1.0 - uPencil * 0.07 * hatch);
    a = (1.0 - smoothstep(-px, px, de)) * 0.94;
  } else if(type < 2.5){                            // 菱形 (縁だけ)
    vec2 q = rot(-vB.y) * (w - vA.xy);
    float dd = (abs(q.x) / vA.z + abs(q.y) / vA.w - 1.0) * vA.w * 0.85;
    a = (1.0 - smoothstep(vB.z, vB.z + px, abs(dd) + wob)) * 0.9 * grain;
  } else if(type < 3.5){                            // 四角 (淡い塗り + 縁)
    vec2 q = rot(-vB.y) * (w - vA.xy);
    vec2 aq = abs(q);
    float dq = max(aq.x, aq.y) - vA.z;
    float fa = (1.0 - smoothstep(-px, px, dq)) * 0.5 * (1.0 - uPencil * 0.25 * tooth);
    float oa = (1.0 - smoothstep(vB.z * 1.2, vB.z * 1.2 + px, abs(dq) + wob)) * 0.92 * grain;
    float A = (oa + fa * (1.0 - oa)) * vB.w;
    o = vec4((vC.rgb * oa + vD.rgb * fa * (1.0 - oa)) * vB.w, A);
    return;
  } else if(type < 4.5){                            // 点
    float d = length(w - vA.xy) - vA.z;
    a = 1.0 - smoothstep(-0.5 * px, px, d);
  } else if(type < 5.5){                            // 弧
    vec2 q = w - vA.xy;
    float r = vA.z, a0 = vD.x, sw = vD.y;
    float sg = sw < 0.0 ? -1.0 : 1.0;
    float rel = mod((atan(q.y, q.x) - a0) * sg, 6.28318530718);
    float d;
    if(rel <= abs(sw)){
      d = abs(length(q) - r);
    } else {
      vec2 p0 = vA.xy + r * vec2(cos(a0), sin(a0));
      vec2 p1 = vA.xy + r * vec2(cos(a0 + sw), sin(a0 + sw));
      d = min(length(w - p0), length(w - p1));
    }
    a = (1.0 - smoothstep(vB.z - 0.5 * px, vB.z + px, d + wob)) * grain;
  } else if(type > 6.5){                            // 人の輪郭 (足元 xy・背の高さ z。頭・胴・脚・腕の和の縁)
    float hg = max(vA.z, 1e-6);
    vec2 q = (w - vA.xy) / hg;
    float d = length(q - vec2(0.0, 0.90)) - 0.075;
    d = min(d, seg(q, vec2(0.0, 0.76), vec2(0.0, 0.47)) - 0.075);
    d = min(d, seg(q, vec2(-0.03, 0.47), vec2(-0.045, 0.02)) - 0.032);
    d = min(d, seg(q, vec2(0.03, 0.47), vec2(0.045, 0.02)) - 0.032);
    d = min(d, seg(q, vec2(-0.07, 0.73), vec2(-0.10, 0.45)) - 0.025);
    d = min(d, seg(q, vec2(0.07, 0.73), vec2(0.10, 0.45)) - 0.025);
    a = (1.0 - smoothstep(vB.z, vB.z + px, abs(d * hg) + wob)) * 0.9 * grain;
  } else {                                          // 紙
    col = vC.rgb * (0.985 + 0.03 * vn(w * vec2(140.0, 52.0)));
    a = 1.0;
  }
  a *= vB.w;
  o = vec4(col * a, a);
}`,

  _compile(type, src){
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('Rhizome shader:', gl.getShaderInfoLog(s));
    return s;
  },
  _link(vs, fs){
    const gl = this.gl;
    const p = gl.createProgram();
    gl.attachShader(p, this._compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this._compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)){ console.error('Rhizome link:', gl.getProgramInfoLog(p)); return null; }
    return p;
  },

  init(gl){
    this.gl = gl;
    this.prog = this._link(this.VS, this.FS);
    this.ok = !!this.prog;
    if(this.ok){
      const U = (n)=>gl.getUniformLocation(this.prog, n);
      this.U = { cam:U('uCam'), half:U('uHalf'), px:U('uPx'), pencil:U('uPencil') };
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      this.cornerVBO = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerVBO);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 1,1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.instVBO = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instVBO);
      for(let k = 0; k < 4; k++){
        gl.enableVertexAttribArray(1 + k);
        gl.vertexAttribPointer(1 + k, 4, gl.FLOAT, false, 64, k * 16);
        gl.vertexAttribDivisor(1 + k, 1);
      }
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    this._memo = new Map();
    this.initialized = true;
  },
  update(){},

  // ── 乱数 (整数 3 つ + シードから 0..1) ──
  _hash(a, b, c){
    let x = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x2f6b2f8b) ^ this._salt;
    x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
    x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
    x ^= x >>> 15;
    return (x >>> 0) / 4294967296;
  },

  // 画面のゆっくりした流れ (時間の単位ごと)
  _camX(t){ return this._cfg.drift * (0.05 * t + 0.15 * Math.sin(t * 0.07)); },
  _camY(t){ return this._cfg.drift * 0.10 * Math.sin(t * 0.05 + 1.0); },

  // 枠 id の要素の、時刻 t を含む周期 (寿命 = Life × lifeMul のまわりでばらつく)。x は周期内の位置 0..1
  _pool(id, t, lifeMul){
    const c = this._cfg;
    let T = c.life * lifeMul * (0.7 + 0.6 * this._hash(id, 0, 1));
    if(c.beat) T = Math.max(1, Math.round(T * 2) / 2);
    let o = this._hash(id, 0, 2) * T;
    if(c.beat) o = Math.floor(o * 2) / 2;
    const n = Math.floor((t + o) / T), s = n * T - o;
    return { n, s, T, x:(t - s) / T };
  },
  // ノード i の周期と位相のずれ。beat では半拍にそろえる
  _period(i){
    const c = this._cfg;
    let T = c.life * (0.6 + 0.9 * this._hash(i, 0, 1));
    if(c.beat) T = Math.max(1, Math.round(T * 2) / 2);
    return T;
  },
  _cycAt(i, t){
    const T = this._period(i);
    let o = this._hash(i, 0, 2) * T;
    if(this._cfg.beat) o = Math.floor(o * 2) / 2;
    return this._cyc(i, Math.floor((t + o) / T), T, o);
  },
  // ノード i の n 回目の周期 (種類・段・寿命)。位置は _place で決める
  _cyc(i, n, T, o){
    const key = i + ':' + n;
    let r = this._memo.get(key);
    if(r) return r;
    const c = this._cfg;
    const s = n * T - o;
    const hk = this._hash(i, n, 4);
    let kind = 'e';                                       // e = 楕円 / d = 端点 / s = 四角 / m = 菱形
    if(hk < c.pSquare) kind = 's';
    else if(hk < c.pSquare + c.pDiamond) kind = 'm';
    else if(hk < c.pSquare + c.pDiamond + c.pTendril) kind = 'd';
    const pin = Math.min(0.5, Math.max(0.12, 0.1 * T));
    r = {
      i, n, s, T, pin, kind,
      present: this._hash(i, n, 3) < 0.86,
      tier: Math.floor(this._hash(i, n, 5) * 3.999),
      h: this._hash(i, n, 9),
      x:0, y:0, parent:null, placed:false, links:null,
      tPop:s, tDie:s + 0.8 * T,
    };
    this._memo.set(key, r);
    return r;
  },
  // 位置: 段が浅く、生まれる時点で生きている親がいればその近く。いなければ画面のどこか
  _place(r){
    if(r.placed) return r;
    r.placed = true;
    const c = this._cfg;
    // 親の候補を 4 つまで当たる
    for(let tr = 0; tr < 4 && r.tier > 0 && c.N > 1 && !r.parent; tr++){
      let j = Math.floor(this._hash(r.i, r.n, 20 + tr) * c.N);
      if(j === r.i) j = (j + 1) % c.N;
      const p = this._cycAt(j, r.s);
      if(!p.present || p.tier >= r.tier || p.kind === 'd') continue;
      this._place(p);
      if(r.s < p.tPop + p.pin || r.s >= p.tDie - p.pin) continue;
      const a = this._hash(r.i, r.n, 7) * Math.PI * 2;
      const dist = c.spread * (0.07 + 0.16 * this._hash(r.i, r.n, 8)) * (r.kind === 'd' ? 2.2 : 1.0);
      r.x = p.x + Math.cos(a) * dist;
      r.y = p.y + Math.sin(a) * dist * 0.8;
      r.parent = p;
    }
    if(!r.parent){
      r.x = this._camX(r.s) + (this._hash(r.i, r.n, 10) - 0.5) * c.aspect * 1.04;
      r.y = this._camY(r.s) + (this._hash(r.i, r.n, 11) - 0.5) * 1.0;
    }
    // 親がいれば線が伸びて届いた所でポップ
    if(r.parent){
      const d = Math.hypot(r.x - r.parent.x, r.y - r.parent.y);
      r.tPop = r.s + Math.min(1.2, Math.max(0.15, d / 0.35));
    }
    if(r.tPop + r.pin > r.tDie) r.tPop = Math.max(r.s, r.tDie - r.pin);
    return r;
  },
  // 現れたとき近くで生きているノード (親を除く) へ伸ばす線の相手
  _linksOf(r){
    if(r.links) return r.links;
    r.links = [];
    const c = this._cfg;
    if(r.kind === 'd' || c.links <= 0) return r.links;
    const want = Math.round(c.links * (1.5 + 3.0 * this._hash(r.i, r.n, 12)));
    if(want <= 0) return r.links;
    // 近くのノード (R 以内) / 網をまたぐ遠くのノード (R〜2.6R、長い線) / 四角どうしはさらに遠くまで (茶色の長い線)
    const R = 0.40 * c.spread, RL = 2.6 * R, RS = 0.9 * c.spread, t0 = r.tPop;
    const cand = [], far = [], sq = [];
    for(let j = 0; j < c.N; j++){
      if(j === r.i) continue;
      const q = this._cycAt(j, t0);
      if(!q.present || q.kind === 'd' || q === r.parent) continue;
      this._place(q);
      if(t0 < q.tPop + q.pin || t0 > q.tDie - 0.5 * q.pin) continue;
      const dx = q.x - r.x, dy = q.y - r.y, d2 = dx * dx + dy * dy;
      if(d2 < R * R) cand.push([d2, q]);
      else if(d2 < RL * RL) far.push([this._hash(r.i * 977 + j, r.n, 13), q]);   // 遠くは距離でなく乱数で選ぶ
      if(r.kind === 's' && q.kind === 's' && d2 >= R * R && d2 < RS * RS) sq.push([d2, q]);
    }
    cand.sort((a, b)=>a[0] - b[0]);
    for(let k = 0; k < Math.min(want, cand.length); k++) r.links.push(cand[k][1]);
    far.sort((a, b)=>a[0] - b[0]);
    const nFar = Math.floor(c.links * 1.2 * this._hash(r.i, r.n, 14) + 0.5);
    for(let k = 0; k < Math.min(nFar, far.length); k++) r.links.push(far[k][1]);
    sq.sort((a, b)=>a[0] - b[0]);
    for(let k = 0; k < Math.min(2, sq.length); k++) if(!r.links.includes(sq[k][1])) r.links.push(sq[k][1]);
    return r.links;
  },

  _ease(x, k){ const c1 = 1.7 * k, c3 = c1 + 1, y = x - 1; return 1 + c3 * y * y * y + c1 * y * y; },
  // ノードの大きさ: tPop でふくらんで (弾んで) 現れ、tDie からしぼむ
  _scale(r, t){
    const c = this._cfg;
    if(t < r.tPop) return 0;
    const pout = 0.8 * r.pin;
    if(t > r.tDie + pout) return 0;
    const g = this._ease(Math.min(1, (t - r.tPop) / r.pin), c.pop);
    const y = Math.max(0, Math.min(1, (t - r.tDie) / pout));
    const k = (1 - y * y * (3 - 2 * y)) * (1 + 0.25 * c.pop * Math.sin(y * Math.PI));
    return Math.max(0, g * k);
  },

  render(opts){
    const gl = this.gl;
    if(!this.initialized || !this.ok || !opts.fbo) return;
    const P = this.P;
    const dz = (v)=> (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v;
    const w = opts.w, h = opts.h, aspect = w / Math.max(1, h);
    const clock = (opts.clock != null) ? opts.clock : performance.now() / 1000;
    const beatMode = (typeof App !== 'undefined' && App.beatMode === 'beat') && opts.beat != null;
    const spd = Math.max(0, dz(P.speed)) * 0.01;
    const t = (beatMode ? opts.beat : clock) * spd;

    // 設定と記憶 (設定が変わったら引き直す)
    const seed = Math.round(dz(P.seed) || 0);
    const style = Math.max(0, Math.min(2, Math.round(P.style) || 0));   // 0 = 図 1 / 1 = 図 2 / 2 = 両方
    const fig1 = style !== 1, fig2 = style !== 0;
    const sqK = Math.max(0, dz(P.squares) * 0.01), diaK = Math.max(0, dz(P.diamonds) * 0.01), tenK = Math.max(0, dz(P.tendrils) * 0.01);
    const cfg = {
      N: Math.max(1, Math.min(600, Math.round(dz(P.nodes)))),
      life: Math.max(0.5, dz(P.life)),
      beat: beatMode,
      spread: Math.max(0.05, dz(P.spread) * 0.01),
      links: Math.max(0, dz(P.links) * 0.01),
      // 種類の割合: 図 1 は楕円が主、図 2 は菱形が主 (四角なし)、両方はその間
      pSquare: Math.min(0.4, sqK * (style === 0 ? 0.12 : (style === 2 ? 0.06 : 0))),
      pDiamond: Math.min(0.8, style === 0 ? diaK : (style === 1 ? 0.5 + 0.5 * diaK : 0.25 + 0.5 * diaK)),
      pTendril: Math.min(0.6, tenK * (style === 1 ? 0.20 : 0.30)),
      drift: Math.max(0, dz(P.drift) * 0.01) * 0.4,
      pop: Math.max(0, dz(P.pop) * 0.01),
      aspect,
    };
    const sig = [cfg.N, cfg.life, cfg.beat, cfg.spread, cfg.links, cfg.pSquare, cfg.pDiamond, cfg.pTendril, cfg.drift, aspect.toFixed(3), seed].join('|');
    if(sig !== this._sig || this._memo.size > 40000){ this._memo.clear(); this._sig = sig; }
    this._cfg = cfg;
    this._salt = Math.imul(seed + 1, 0x6a09e667) | 0;

    const C = this.COL;
    const sizeK = Math.max(0, dz(P.size) * 0.01);
    const lineK = Math.max(0.05, dz(P.line) * 0.01);
    const kick = Math.max(0, dz(P.kick) * 0.01) * (beatMode ? Math.pow(1 - (opts.beat - Math.floor(opts.beat)), 2) : 0);
    const u = 1 / 1080;                        // 1080p の 1px (線幅の単位)
    const hwG = 0.60 * u * lineK, hwB = 0.72 * u * lineK, hwL = 0.90 * u * lineK, rDot = 1.8 * u * lineK;
    const cx = this._camX(t), cy = this._camY(t);
    const mx = aspect * 0.5 + 0.25, my = 0.75;

    const lines = [], arcs = [], dots = [], squares = [], shapes = [];
    const push = (arr, ax, ay, az, aw, type, rotA, hw, al, col, col2, dx, dy)=>{
      arr.push(ax, ay, az, aw, type, rotA, hw, al, col[0], col[1], col[2], 0, col2 ? col2[0] : (dx || 0), col2 ? col2[1] : (dy || 0), col2 ? col2[2] : 0, 0);
    };
    // 線分 S→E のうち [u0, u1] を描く
    const pushLine = (sx, sy, ex, ey, u0, u1, hw, col)=>{
      if(u1 <= u0 + 1e-4) return;
      const ax = sx + (ex - sx) * u0, ay = sy + (ey - sy) * u0, bx = sx + (ex - sx) * u1, by = sy + (ey - sy) * u1;
      push(lines, ax, ay, bx, by, 0, 0, hw, 0.88, col);
    };
    // 線の出方: start から dur で伸び、end の rd 前から縮む。縮む向きは先に消える側へ
    const span = (start, dur, end, rd, shrinkToStart)=>{
      if(t < start || t > end) return null;
      const g = Math.min(1, (t - start) / Math.max(dur, 1e-3));
      const k = Math.max(0, Math.min(1, (t - (end - rd)) / Math.max(rd, 1e-3)));
      return shrinkToStart ? [0, Math.min(g, 1 - k)] : [k, g];
    };
    // 線の色: 四角がらみは茶色、菱形どうしはサーモン、ほかは緑
    const lineCol = (a, b)=> (a.kind === 's' || b.kind === 's') ? [C.brown, hwB] : ((a.kind === 'm' && b.kind === 'm') ? [C.salmon, hwG] : [C.green, hwG]);

    for(let i = 0; i < cfg.N; i++){
      const r = this._cycAt(i, t);
      if(!r.present) continue;
      this._place(r);
      if(r.kind === 'd' && !r.parent) continue;   // 端点は親から伸びる線の先にだけ出す
      if(t > r.tDie + 0.8 * r.pin) continue;
      if(Math.abs(r.x - cx) > mx + 0.3 || Math.abs(r.y - cy) > my + 0.3) continue;
      // 親からの線 (伸びて届いた所でポップ)
      if(r.parent){
        const p = r.parent;
        const end = Math.min(r.tDie, p.tDie);
        const sp = span(r.s, r.tPop - r.s, end, 0.7 * r.pin, r.tDie <= p.tDie);
        if(sp){ const [lc, hw] = lineCol(r, p); pushLine(p.x, p.y, r.x, r.y, sp[0], sp[1], hw, lc); }
      }
      // 現れたあと近くのノードへ伸ばす線
      if(t >= r.tPop){
        for(const q of this._linksOf(r)){
          const d = Math.hypot(q.x - r.x, q.y - r.y);
          const end = Math.min(r.tDie, q.tDie);
          const sp = span(r.tPop + 0.5 * r.pin, Math.min(1.4, Math.max(0.2, d / 0.4)), end, 0.7 * r.pin, r.tDie <= q.tDie);
          if(sp){ const [lc, hw] = lineCol(r, q); pushLine(r.x, r.y, q.x, q.y, sp[0], sp[1], hw, lc); }
        }
      }
      // ノード
      const sc = this._scale(r, t) * (1 + 0.15 * kick);
      if(sc <= 0.001) continue;
      const hh = r.h;
      if(r.kind === 'd'){
        push(dots, r.x, r.y, rDot * Math.min(sc, 1.3), 0, 4, 0, 0, 1, C.dot);
      } else if(r.kind === 's'){
        const hs = 0.115 * (0.30 + 0.12 * hh) * sizeK * sc;
        push(squares, r.x, r.y, hs, hs * 1.42, 3, ((hh * 7.7) % 1 - 0.5) * 0.16, hwB, 1, C.sqLine, C.sqFill);   // w は描く範囲 (回転した角まで)
      } else if(r.kind === 'm'){
        const rx = 0.115 * (0.12 + 0.20 * hh) * sizeK * sc;
        push(shapes, r.x, r.y, rx, rx * 0.62, 2, ((hh * 5.7) % 1 - 0.5) * 0.5, hwG, 1, C.salmon);
      } else {
        const rx = 0.115 * (0.10 + 0.30 * Math.pow(hh, 1.5)) * sizeK * sc;
        const ry = rx * (0.58 + 0.24 * ((hh * 7.3) % 1));
        push(shapes, r.x, r.y, rx, ry, 1, ((hh * 13.1) % 1 - 0.5) * 0.7, 0, 1, C.lime, C.limeRim);
      }
    }

    // 矢印の頭 (先端 tx,ty・進む向き dx,dy)
    const pushArrow = (arr, tx, ty, dx, dy, hw, col)=>{
      const l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, nx = -uy, ny = ux, L = 0.015 * lineK;
      push(arr, tx, ty, tx - ux * L + nx * L * 0.55, ty - uy * L + ny * L * 0.55, 0, 0, hw, 0.9, col);
      push(arr, tx, ty, tx - ux * L - nx * L * 0.55, ty - uy * L - ny * L * 0.55, 0, 0, hw, 0.9, col);
    };
    // 曲線 f(u) (u = 0..1) のうち [u0, u1] を M 分割の折れ線で描く。dashed で 1 区間おきに抜く
    const pushPoly = (arr, f, M, u0, u1, hw, col, al, dashed)=>{
      if(u1 <= u0) return;
      for(let k = 0; k < M; k++){
        if(dashed && (k & 1)) continue;
        const a = Math.max(u0, k / M), b = Math.min(u1, (k + 1) / M);
        if(b <= a) continue;
        const pa = f(a), pb = f(b);
        push(arr, pa[0], pa[1], pb[0], pb[1], 0, 0, hw, al, col);
      }
    };
    // 枠の要素の出方: 周期の頭 grow で伸び (ポップ)、out から縮んで end で消える。[尾, 先端]
    const life2 = (x, grow, out, end)=>{
      if(x > end) return null;
      const g = Math.min(1, x / grow), k = Math.max(0, Math.min(1, (x - out) / (end - out)));
      return g > k ? [k, g] : null;
    };
    const H = (id, n, c)=>this._hash(id, n, c);
    const arcsK = Math.max(0, dz(P.arcs) * 0.01);

    // ── 図 1: 青い弧と矢印 ──
    const nArc = fig1 ? Math.round(8 * arcsK) : 0;
    for(let k = 0; k < nArc; k++){
      const id = 100000 + k, cy2 = this._pool(id, t, 1.4), n = cy2.n, s = cy2.s;
      if(H(id, n, 3) > 0.75) continue;
      const lf = life2(cy2.x, 0.25, 0.70, 0.82);
      if(!lf) continue;
      const [kk, g] = lf;
      const ccx = this._camX(s) + (H(id, n, 4) - 0.5) * aspect * 0.95;
      const ccy = this._camY(s) + (H(id, n, 5) - 0.5) * 0.9;
      const rr = (0.06 + 0.10 * H(id, n, 6)) * cfg.spread;
      const a0 = H(id, n, 7) * Math.PI * 2;
      const sw = (0.9 + 1.1 * H(id, n, 8)) * (H(id, n, 9) < 0.5 ? -1 : 1);
      push(arcs, ccx, ccy, rr, 0, 5, 0, hwL, 0.9, C.blue, null, a0 + sw * kk, sw * (g - kk));
      if(g >= 1 && kk <= 0){
        const ae = a0 + sw, sg = Math.sign(sw);
        pushArrow(arcs, ccx + rr * Math.cos(ae), ccy + rr * Math.sin(ae), -Math.sin(ae) * sg, Math.cos(ae) * sg, hwL, C.blue);
      }
    }

    // ── 図 2: 流れる矢印・縦の面・人・うねる赤線・波の帯 ──
    const figs = [], back = [];
    if(fig2){
      // 流れる青い矢印 (右上へ向かう二次曲線。3 割は破線)
      const nFlow = Math.round(14 * arcsK);
      for(let k = 0; k < nFlow; k++){
        const id = 400000 + k, cy2 = this._pool(id, t, 1.2), n = cy2.n, s = cy2.s;
        if(H(id, n, 3) > 0.8) continue;
        const lf = life2(cy2.x, 0.30, 0.65, 0.80);
        if(!lf) continue;
        const x0 = this._camX(s) + (H(id, n, 4) - 0.62) * aspect * 0.95, y0 = this._camY(s) + (H(id, n, 5) - 0.55) * 0.85;
        const th = 0.12 + (H(id, n, 6) - 0.5) * 0.9, L = (0.35 + 0.55 * H(id, n, 7)) * cfg.spread;
        const x1 = x0 + Math.cos(th) * L, y1 = y0 + Math.sin(th) * L;
        const bend = (H(id, n, 8) - 0.5) * 0.45 * L;
        const xc = (x0 + x1) / 2 - Math.sin(th) * bend, yc = (y0 + y1) / 2 + Math.cos(th) * bend;
        const f = (v)=>{ const a = (1 - v) * (1 - v), b = 2 * (1 - v) * v, c2 = v * v; return [a * x0 + b * xc + c2 * x1, a * y0 + b * yc + c2 * y1]; };
        const dashed = H(id, n, 9) < 0.3;
        pushPoly(arcs, f, dashed ? 30 : 20, lf[0], lf[1], hwL, C.blue, 0.85, dashed);
        if(lf[1] >= 1 && lf[0] <= 0 && !dashed) pushArrow(arcs, x1, y1, x1 - xc, y1 - yc, hwL, C.blue);
      }
      // 縦に立つ面 (下辺から伸び上がる平行四辺形)
      const nPlane = Math.round(5 * Math.max(0, dz(P.planes) * 0.01));
      for(let k = 0; k < nPlane; k++){
        const id = 200000 + k, cy2 = this._pool(id, t, 2.2), n = cy2.n, s = cy2.s;
        if(H(id, n, 3) > 0.8) continue;
        const x = cy2.x;
        if(x > 0.88) continue;
        const g = this._ease(Math.min(1, x / 0.08), cfg.pop);
        const yo = Math.max(0, Math.min(1, (x - 0.82) / 0.06));
        const sc = Math.max(0, g * (1 - yo * yo * (3 - 2 * yo)));
        if(sc <= 0.001) continue;
        const bx = this._camX(s) + (H(id, n, 4) - 0.5) * aspect * 0.9, by = this._camY(s) - 0.42 + 0.22 * H(id, n, 5);
        const hh = (0.40 + 0.35 * H(id, n, 6)) * sizeK * sc, ww = (0.07 + 0.09 * H(id, n, 7)) * sizeK;
        const sl = (0.05 + 0.12 * H(id, n, 8)) * (H(id, n, 9) < 0.75 ? 1 : -1) * sizeK * sc;   // 上辺の横ずれ (高さと一緒に伸びる)
        const p0 = [bx, by], p1 = [bx + ww, by + ww * 0.25], p2 = [p1[0] + sl, p1[1] + hh], p3 = [bx + sl, by + hh];
        for(const [a, b] of [[p0, p1], [p1, p2], [p2, p3], [p3, p0]]) push(figs, a[0], a[1], b[0], b[1], 0, 0, hwB, 0.85, C.ink);
      }
      // 人の輪郭 (足元から伸び上がる)
      const nFig = Math.round(5 * Math.max(0, dz(P.figures) * 0.01));
      for(let k = 0; k < nFig; k++){
        const id = 300000 + k, cy2 = this._pool(id, t, 2.0), n = cy2.n, s = cy2.s;
        if(H(id, n, 3) > 0.8) continue;
        const x = cy2.x;
        if(x > 0.88) continue;
        const g = this._ease(Math.min(1, x / 0.07), cfg.pop);
        const yo = Math.max(0, Math.min(1, (x - 0.82) / 0.06));
        const sc = Math.max(0, g * (1 - yo * yo * (3 - 2 * yo)));
        if(sc <= 0.001) continue;
        const fx = this._camX(s) + (H(id, n, 4) - 0.5) * aspect * 0.85, fy = this._camY(s) - 0.40 + 0.25 * H(id, n, 5);
        push(figs, fx, fy, (0.13 + 0.07 * H(id, n, 6)) * sizeK * sc, 0, 7, 0, hwB, 1, C.ink);
      }
      // うねる赤い線 (上から右下へ。途中で輪をつくる)
      const nM = Math.round(1.5 * Math.max(0, dz(P.meander) * 0.01));
      for(let k = 0; k < nM; k++){
        const id = 500000 + k, cy2 = this._pool(id, t, 3.0), n = cy2.n, s = cy2.s;
        if(H(id, n, 3) > 0.85) continue;
        const lf = life2(cy2.x, 0.40, 0.78, 0.92);
        if(!lf) continue;
        const x0 = this._camX(s) + (H(id, n, 4) - 0.6) * aspect * 0.6, y0 = this._camY(s) + 0.56;
        const x1 = x0 + 0.35 + 0.35 * H(id, n, 5), y1 = this._camY(s) - 0.56;
        const ph = H(id, n, 6) * 6.28, lp = 0.45 + 0.25 * H(id, n, 7), lr = 0.025 + 0.02 * H(id, n, 8);
        const dx = x1 - x0, dy = y1 - y0, dl = Math.hypot(dx, dy), nx = -dy / dl, ny = dx / dl;
        const f = (v)=>{
          const wv = 0.035 * Math.sin(v * 14 + ph) + 0.02 * Math.sin(v * 31 + ph * 1.7);
          const lv = Math.max(0, Math.min(1, (v - lp) / 0.08));
          const la = lv * Math.PI * 2, lx = lv > 0 && lv < 1 ? lr * Math.sin(la) : 0, ly = lv > 0 && lv < 1 ? lr * (1 - Math.cos(la)) : 0;
          return [x0 + dx * v + nx * wv + lx, y0 + dy * v + ny * wv + ly];
        };
        pushPoly(arcs, f, 90, lf[0], lf[1], hwL, C.red, 0.85, false);
      }
      // 下を流れる緑の波の帯 (画面幅いっぱい。中に青い線が 2 本)
      const bandK = Math.max(0, dz(P.band) * 0.01);
      if(bandK > 0){
        const x0 = cx - aspect * 0.5 - 0.05, x1 = cx + aspect * 0.5 + 0.05, yb = cy - 0.40;
        for(let k = 0; k < 11; k++){
          const blue = k === 3 || k === 8;
          const f = (v)=>{ const xx = x0 + (x1 - x0) * v; return [xx, yb + k * 0.011 + 0.03 * Math.sin(xx * 5 + k * 0.35 + t * 0.15) + 0.012 * Math.sin(xx * 13 + k)]; };
          pushPoly(back, f, 64, 0, 1, blue ? hwL : hwG * 1.3, blue ? C.blue : C.band, Math.min(1, (blue ? 0.7 : 0.55) * bandK), false);
        }
      }
    }

    // ── 描く: 紙 → 波の帯 → 線 → 弧・流れ・赤線 → 面と人 → 点 → 四角 → 楕円と菱形 ──
    const opaque = opts.opaque !== false;
    const paper = Array.isArray(P.paper) ? P.paper : this.PDefaults.paper;
    const bg = [];
    if(opaque) push(bg, cx, cy, 0, 0, 6, 0, 0, 1, paper);
    const all = bg.concat(back, lines, arcs, figs, dots, squares, shapes);
    const count = all.length / 16;
    const data = new Float32Array(all);

    gl.bindFramebuffer(gl.FRAMEBUFFER, opts.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if(count > 0){
      gl.useProgram(this.prog);
      gl.uniform2f(this.U.cam, cx, cy);
      gl.uniform2f(this.U.half, aspect * 0.5, 0.5);
      gl.uniform1f(this.U.px, 1 / Math.max(1, h));
      gl.uniform1f(this.U.pencil, Math.max(0, dz(P.pencil) * 0.01));
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instVBO);
      if(data.byteLength > this.instCap){
        this.instCap = Math.max(data.byteLength, this.instCap * 2, 65536);
        gl.bufferData(gl.ARRAY_BUFFER, this.instCap, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },
};
Rhizome.PDefaults = JSON.parse(JSON.stringify(Rhizome.P));
