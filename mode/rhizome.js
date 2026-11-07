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
   - 平らと立ち上がり (Rise / Cycle): 網はすべて地面に置いてあり、Cycle ごとに「平らに見下ろす」と「斜めから見る」を
     繰り返す。斜めのときは地面が奥へ倒れ (Tilt)、回り (Yaw)、四角は菱形に、楕円は潰れた楕円に見える。
     横長の面 (どれも平行に奥へ向く) が蝶番のように 90° 立ち上がり (面ごとに少しずつずれる)、面には人の外側の輪郭が下辺から切り抜かれている
     (腕と股から内側の線は無く、下辺は体の幅だけ切れる。頭が上辺から出る人は上辺も首の幅だけ切れる)。流れる青い矢印は宙に浮き、うねる赤線と
     手前の緑の波の帯が現れる。立ち上がると楕円の半分が菱形に変わり、そこをつなぐ線もサーモン色になる (図 1 → 図 2)。
     Rise 0 で平らのまま (以前と同じ見た目)。
   - Style: 網 (図 1) は平らなときに縦の面・矢印・赤線・帯が出ず、立ち上がるときだけ現れる。
     面と流れ (図 2) / 両方 は菱形が主になり、それらが常に出る (平らなときの面は地面に寝ている)。
   - 時刻だけから決まる (状態を持たない)。逆再生や拍の飛びでもそのまま。C キーでスロットの時計が 0 に戻ると最初から。
     beat モードは拍が時間の単位で、生まれる時刻が半拍にそろい、拍頭でノードがふくらむ (Kick)。drone は秒が単位。
   - 3D は CPU で点を画面へ投影し、1 要素 = 1 インスタンスの四角形を頂点シェーダで置く。形 (線分・楕円・点・四角形) は
     フラグメントで距離から描く。色鉛筆のかすれ (Pencil) と楕円の塗りの筆致もフラグメント。塗りは奥から手前へ重ねる。
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
    style:0,        // 0 = 網 (図 1) / 1 = 面と流れ (図 2) / 2 = 両方
    speed:100,      // 時間の速さ (%)
    life:6,         // ノードの寿命の目安 (秒。beat では拍)
    nodes:180,      // ノードの枠の数 (同時に見えるのはおよそ 6〜7 割)
    links:100,      // 近くのノードへ伸ばす線の量 (%)
    size:100,       // 楕円・四角・菱形の大きさ (%)
    tendrils:100,   // 端に点のある線 (巻きひげ) の量 (%)
    squares:40,     // 茶色の四角の量 (%)
    arcs:100,       // 青い弧 (図 1) と流れる矢印 (図 2) の量 (%)
    planes:100,     // 縦に立つ面の量 (%)
    figures:100,    // 面に人の輪郭が切り抜かれている割合 (%)
    meander:100,    // うねる赤い線の量 (%)
    band:100,       // 手前の緑の波の帯の濃さ (%)
    diamonds:8,     // 菱形の割合 (%。図 2 では菱形が主になる)
    spread:100,     // 子が親から離れて生まれる距離 (%)
    line:100,       // 線の太さ (%)
    pencil:100,     // 色鉛筆のかすれと塗りむら (%)
    hand:100,       // 手描きの揺れ (%)。線がうねり、縁が揺れ、線の太さにむらが出る
    pop:100,        // ポップの弾み (%)
    kick:60,        // 拍でノードがふくらむ量 (%)
    drift:40,       // 画面がゆっくり流れる量 (%)
    rise:100,       // 立ち上がる量 (%)。0 で平らのまま
    cycle:16,       // 平ら → 立ち上がり → 平ら の周期 (秒。beat では拍)
    tilt:60,        // 立ち上がったときの地面の倒れ (deg)
    yaw:45,         // 立ち上がったときの地面の回り (deg)
    seed:0,         // 乱数のシード
    paper:[0.965, 0.958, 0.935],   // 紙の色 (Slot A)。Slot B は透過
  },

  SPECS:[
    {sel:true, label:'Style', key:'style', opts:['網 (図 1)', '面と流れ (図 2)', '両方']},
    ['Speed',    'speed',    0,   300, 1,   'pct'],
    ['Life',     'life',     1,   32,  0.5, 'f2'],
    ['Nodes',    'nodes',    10,  400, 1,   'int'],
    ['Links',    'links',    0,   300, 1,   'pct'],
    ['Size',     'size',     10,  300, 1,   'pct'],
    ['Tendrils', 'tendrils', 0,   300, 1,   'pct'],
    ['Squares',  'squares',  0,   300, 1,   'pct'],
    ['Arcs',     'arcs',     0,   300, 1,   'pct'],
    ['Planes',   'planes',   0,   300, 1,   'pct'],
    ['Figures',  'figures',  0,   100, 1,   'pct'],
    ['Meander',  'meander',  0,   300, 1,   'pct'],
    ['Band',     'band',     0,   200, 1,   'pct'],
    ['Diamonds', 'diamonds', 0,   100, 1,   'pct'],
    ['Spread',   'spread',   10,  300, 1,   'pct'],
    ['Line',     'line',     20,  400, 1,   'pct'],
    ['Pencil',   'pencil',   0,   200, 1,   'pct'],
    ['Hand',     'hand',     0,   300, 1,   'pct'],
    ['Pop',      'pop',      0,   300, 1,   'pct'],
    ['Kick',     'kick',     0,   200, 1,   'pct'],
    ['Drift',    'drift',    0,   300, 1,   'pct'],
    ['Rise',     'rise',     0,   100, 1,   'pct'],
    ['Cycle',    'cycle',    4,   64,  1,   'int'],
    ['Tilt',     'tilt',     20,  70,  1,   'deg'],
    ['Yaw',      'yaw',      -90, 90,  1,   'deg'],
    ['Seed',     'seed',     0,   99,  1,   'int'],
  ],

  COL:{
    lime:[0.73, 0.94, 0.17], limeRim:[0.45, 0.73, 0.15], green:[0.40, 0.73, 0.38], dot:[0.30, 0.58, 0.28],
    salmon:[0.86, 0.52, 0.45], brown:[0.50, 0.28, 0.23], sqLine:[0.58, 0.38, 0.34], sqFill:[0.93, 0.83, 0.80],
    blue:[0.24, 0.54, 0.88], ink:[0.20, 0.19, 0.19], red:[0.85, 0.22, 0.18], band:[0.45, 0.78, 0.40],
  },

  // 立っている人の外側の輪郭 (足元の中央が原点、背の高さ 1)。右の足元 → 頭 → 左の足元。
  // 股から内側の線は持たず、下は閉じない (面の下辺を体の幅だけ切って、切り抜きにする)
  FIG:null,
  FIG_FOOT:0.10,   // 足元の半幅 (下辺を切る幅)
  FIG_HALF:0.11,   // 輪郭のいちばん外 (肩) の半幅
  _figure(){
    if(this.FIG) return this.FIG;
    // 腕は無く、肩から足元までほぼまっすぐ下りる
    const R = [[this.FIG_FOOT,0],[0.10,0.20],[0.105,0.45],[0.11,0.62],[0.105,0.71],[0.085,0.765],[0.05,0.79],[0.03,0.82]];
    const pts = R.slice();
    const hc = 0.895, hr = 0.068;
    for(let k = 0; k <= 12; k++){
      const a = -0.95 + (Math.PI + 1.9) * k / 12;   // 首の右から頭の上をまわって首の左へ
      pts.push([hr * Math.cos(a), hc + hr * Math.sin(a)]);
    }
    for(let k = R.length - 1; k >= 0; k--) pts.push([-R[k][0], R[k][1]]);
    this.FIG = pts;
    return pts;
  },
  // 輪郭の高さ y (背の高さ 1) での半幅 (いちばん外側の交点。上辺を切る幅に使う)
  _figHalfAt(y){
    const F = this._figure();
    let hx = 0;
    for(let m = 0; m + 1 < F.length; m++){
      const a = F[m], b = F[m + 1];
      if((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
      const k = (y - a[1]) / (b[1] - a[1]);
      hx = Math.max(hx, Math.abs(a[0] + (b[0] - a[0]) * k));
    }
    return hx;
  },

  VS:`#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iA;   // 線: 両端 / 楕円・点: 中心 xy と半径 zw / 四角形: 1・2 番目の角
layout(location=2) in vec4 iB;   // 種類, 回転 (四角形は塗りの濃さ), 線の半幅, 不透明度
layout(location=3) in vec4 iC;   // 色
layout(location=4) in vec4 iD;   // 楕円: 縁の色 / 四角形: 3・4 番目の角
uniform vec2 uCam;               // 画面の中心
uniform vec2 uHalf;              // 画面の半幅・半高
uniform float uPx;               // 1px の長さ
uniform float uHand;             // 手描きの揺れ (形が最大で約 8px × uHand ずれる)
out vec2 vW;
flat out vec4 vA;
flat out vec4 vB;
flat out vec4 vC;
flat out vec4 vD;
void main(){
  vA = iA; vB = iB; vC = iC; vD = iD;
  float type = iB.x;
  float pad = iB.z * 1.35 + (3.0 + 8.0 * uHand) * uPx;
  vec2 w;
  if(type < 0.5){                                   // 線分
    vec2 a = iA.xy, b = iA.zw;
    vec2 d = b - a;
    float L = length(d);
    vec2 t = L > 1e-7 ? d / L : vec2(1.0, 0.0);
    vec2 n = vec2(-t.y, t.x);
    w = a + t * (aCorner.x * (L + 2.0 * pad) - pad) + n * ((aCorner.y * 2.0 - 1.0) * pad);
  } else if(type > 2.5 && type < 3.5){              // 四角形
    vec2 mn = min(min(iA.xy, iA.zw), min(iD.xy, iD.zw)) - pad;
    vec2 mx = max(max(iA.xy, iA.zw), max(iD.xy, iD.zw)) + pad;
    w = mix(mn, mx, aCorner);
  } else if(type > 3.5){                            // 紙
    w = uCam + (aCorner * 2.0 - 1.0) * uHalf;
  } else {                                          // 楕円・点
    float R = max(iA.z, iA.w) + pad;
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
uniform float uHand;
uniform vec3 uSqFill;
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
float cr(vec2 a, vec2 b){ return a.x * b.y - a.y * b.x; }
void main(){
  float type = vB.x;
  float px = uPx;
  vec2 w = vW;
  // 色鉛筆のかすれ (紙の目に沿う) と線の太さのむら
  float tooth = vn(w * vec2(900.0, 340.0));
  float grain = 1.0 - uPencil * 0.42 * smoothstep(0.25, 0.95, tooth);
  float wob = (vn(w * 70.0 + 3.1) - 0.5) * 0.9 * px * uPencil;
  // 手描きの揺れ (uHand): 形を測る位置をゆるいノイズ (波長およそ 90px と 30px) でずらす。線は横へうねり、楕円・四角の縁も揺れる。
  // 紙の目とかすれ (上) はずらさない。線の太さには筆圧のようなむらを付ける
  vec2 hq = w / (90.0 * px);
  w += ((vec2(vn(hq + 1.7), vn(hq + 8.3)) - 0.5) * 9.0 + (vec2(vn(hq * 3.1 + 4.4), vn(hq * 3.1 + 2.2)) - 0.5) * 2.2) * px * uHand;
  float press = 1.0 + 0.56 * uHand * (vn(hq * 1.7 + 6.0) - 0.5);
  vec3 col = vC.rgb;
  float a = 0.0;
  if(type < 0.5){                                   // 線分
    float d = seg(w, vA.xy, vA.zw);
    float hw = vB.z * clamp(press, 0.6, 1.3);
    a = (1.0 - smoothstep(hw - 0.5 * px, hw + px, d + wob)) * grain;
  } else if(type < 1.5){                            // 楕円 (塗り + 濃い縁 + 塗りの筆致)
    vec2 q = rot(-vB.y) * (w - vA.xy);
    float de = (length(q / vA.zw) - 1.0) * vA.w;
    // マーカーの塗りは縁から少しずれ、はみ出したり足りなかったりする (uHand。0 で縁と同じ形)
    vec2 fo = (vec2(h2(vA.xy * 913.0), h2(vA.xy * 577.0 + 3.0)) - 0.5) * 0.30 * vA.zw * uHand;
    float dfl = (length((q - fo) / vA.zw) - 1.0) * vA.w;
    float hatch = 0.5 + 0.5 * sin(dot(w, vec2(0.62, 0.78)) * 1100.0 + wob / max(px, 1e-7) * 4.0);
    float rim = smoothstep(-2.6 * px, -0.3 * px, de) * (1.0 - smoothstep(-px, px, de));   // 縁の内側の濃い帯
    float fil = 1.0 - smoothstep(-px, px, dfl);
    col = mix(vC.rgb * (1.0 - (uPencil * 0.07 + uHand * 0.07) * hatch), vD.rgb, rim / max(max(rim, fil), 1e-4));
    a = max(rim, fil) * 0.94;
  } else if(type < 2.5){                            // 点
    float d = length(w - vA.xy) - vA.z;
    a = 1.0 - smoothstep(-0.5 * px, px, d);
  } else if(type < 3.5){                            // 四角形 (淡い塗り vB.y + 縁)
    vec2 p0 = vA.xy, p1 = vA.zw, p2 = vD.xy, p3 = vD.zw;
    float d = min(min(seg(w, p0, p1), seg(w, p1, p2)), min(seg(w, p2, p3), seg(w, p3, p0)));
    float c0 = cr(p1 - p0, w - p0), c1 = cr(p2 - p1, w - p1), c2 = cr(p3 - p2, w - p2), c3 = cr(p0 - p3, w - p3);
    bool inside = (c0 >= 0.0 && c1 >= 0.0 && c2 >= 0.0 && c3 >= 0.0) || (c0 <= 0.0 && c1 <= 0.0 && c2 <= 0.0 && c3 <= 0.0);
    float sd = inside ? -d : d;
    float fa = (1.0 - smoothstep(-px, px, sd)) * vB.y * (1.0 - uPencil * 0.25 * tooth);
    float hw = vB.z * 1.2 * clamp(press, 0.6, 1.3);
    float oa = (1.0 - smoothstep(hw, hw + px, d + wob)) * 0.92 * grain;
    float A = (oa + fa * (1.0 - oa)) * vB.w;
    o = vec4((vC.rgb * oa + uSqFill * fa * (1.0 - oa)) * vB.w, A);
    return;
  } else {                                          // 紙
    col = vC.rgb * (0.985 + 0.03 * vn(vW * vec2(140.0, 52.0)));
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
      this.U = { cam:U('uCam'), half:U('uHalf'), px:U('uPx'), pencil:U('uPencil'), hand:U('uHand'), sqFill:U('uSqFill') };
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

  // 立ち上がりきったときの向き (yaw) の座標 (qx = 画面の横, qy = 奥) から地面へ
  _fromYaw(qx, qy, tx, ty){
    const c = this._cfg;
    return [tx + qx * c.cpsM + qy * c.spsM, ty - qx * c.spsM + qy * c.cpsM];
  },
  // 地面の点 (中心からのずれ) が、立ち上がりきったときの画面に入るか
  _inRisen(dx, dy){
    const c = this._cfg;
    const qx = dx * c.cpsM - dy * c.spsM, qy = dx * c.spsM + dy * c.cpsM;
    const depth = qy * c.sphM + c.D;
    if(depth < 0.3) return false;
    const k = c.D / depth;
    return Math.abs(qx * k) < c.aspect * 0.55 && Math.abs(qy * c.cphM * k) < 0.55;
  },

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
  // (立ち上がりがあるときは、平らな画面と立ち上がった画面のどちらかに入る所)
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
      const tx = this._camX(r.s), ty = this._camY(r.s);
      r.x = tx + (this._hash(r.i, r.n, 10) - 0.5) * c.aspect * 1.04;
      r.y = ty + (this._hash(r.i, r.n, 11) - 0.5) * 1.0;
      for(let k = 0; k < 6 && c.riseK > 0; k++){
        const dx = (this._hash(r.i, r.n, 30 + 2 * k) - 0.5) * 3.2, dy = (this._hash(r.i, r.n, 31 + 2 * k) - 0.5) * 3.2;
        if((Math.abs(dx) < c.aspect * 0.52 && Math.abs(dy) < 0.5) || this._inRisen(dx, dy)){ r.x = tx + dx; r.y = ty + dy; break; }
      }
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
    const sqK = Math.max(0, dz(P.squares) * 0.01), diaK = Math.max(0, dz(P.diamonds) * 0.01), tenK = Math.max(0, dz(P.tendrils) * 0.01);
    const riseK = Math.max(0, Math.min(1, dz(P.rise) * 0.01));
    const deg = Math.PI / 180;
    const tiltM = riseK * Math.max(0, Math.min(70, dz(P.tilt))) * deg, yawM = riseK * Math.max(-90, Math.min(90, dz(P.yaw))) * deg;
    const cfg = {
      // 立ち上がりがあると見える地面が広がるので、枠を増やして平らなときの密度をそろえる
      N: Math.max(1, Math.min(900, Math.round(dz(P.nodes) * (riseK > 0 ? 2.2 : 1)))),
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
      aspect, riseK, D:2.2,
      cphM: Math.cos(tiltM), sphM: Math.sin(tiltM), cpsM: Math.cos(yawM), spsM: Math.sin(yawM),
    };
    const sig = [cfg.N, cfg.life, cfg.beat, cfg.spread, cfg.links, cfg.pSquare, cfg.pDiamond, cfg.pTendril, cfg.drift, aspect.toFixed(3), seed, tiltM.toFixed(4), yawM.toFixed(4)].join('|');
    if(sig !== this._sig || this._memo.size > 60000){ this._memo.clear(); this._sig = sig; }
    this._cfg = cfg;
    this._salt = Math.imul(seed + 1, 0x6a09e667) | 0;

    // 平ら ↔ 立ち上がり: 周期の 0〜30% 平ら / 30〜50% 立ち上がる / 50〜80% 立った / 80〜100% 倒れる
    const sm = (x)=> x * x * (3 - 2 * x);
    const cyc = Math.max(2, dz(P.cycle));
    let ph = (t / cyc) % 1;
    if(ph < 0) ph += 1;
    const rn = riseK <= 0 ? 0 : (ph < 0.3 ? 0 : ph < 0.5 ? sm((ph - 0.3) / 0.2) : ph < 0.8 ? 1 : 1 - sm((ph - 0.8) / 0.2));
    const v2 = style === 0 ? rn : 1;                     // 図 2 の要素 (面・流れ・赤線・帯) の出方
    const v1 = style === 1 ? 0 : 1;                      // 図 1 の要素 (青い弧)
    const phi = rn * tiltM, psi = rn * yawM;
    const cph = Math.cos(phi), sph = Math.sin(phi), cps = Math.cos(psi), sps = Math.sin(psi), D = cfg.D;
    const cx = this._camX(t), cy = this._camY(t);
    // 地面 (x, y) と高さ z を画面へ。[x, y, 奥行き]。平らなとき (phi = psi = 0) は x, y そのまま
    const P3 = (x, y, z)=>{
      const qx0 = x - cx, qy0 = y - cy;
      const qx = qx0 * cps - qy0 * sps, qy = qx0 * sps + qy0 * cps;
      const depth = qy * sph - z * cph + D;
      if(depth < 0.25) return null;
      const k = D / depth;
      return [cx + qx * k, cy + (qy * cph + z * sph) * k, depth];
    };

    const C = this.COL;
    const sizeK = Math.max(0, dz(P.size) * 0.01);
    const lineK = Math.max(0.05, dz(P.line) * 0.01);
    const kick = Math.max(0, dz(P.kick) * 0.01) * (beatMode ? Math.pow(1 - (opts.beat - Math.floor(opts.beat)), 2) : 0);
    const u = 1 / 1080;                        // 1080p の 1px (線幅の単位)
    const hwG = 0.60 * u * lineK, hwB = 0.72 * u * lineK, hwL = 0.90 * u * lineK, rDot = 1.8 * u * lineK;
    const mx = aspect * 0.5 + 0.1, my = 0.6;
    const onScreen = (p)=> p && Math.abs(p[0] - cx) < mx + 0.2 && Math.abs(p[1] - cy) < my + 0.2;

    const inst = (arr, a0, a1, a2, a3, b0, b1, b2, b3, col, d0, d1, d2, d3)=>{
      arr.push(a0, a1, a2, a3, b0, b1, b2, b3, col[0], col[1], col[2], 0, d0, d1, d2, d3);
    };
    const lines = [], arcs = [], figs = [], back = [], fills = [];   // fills: [奥行き, 層, インスタンス 16 個] (奥から重ねる。同じ奥行きは四角 → 楕円・菱形)
    const fill = (depth, a0, a1, a2, a3, b0, b1, b2, b3, col, d0, d1, d2, d3)=>{
      fills.push([depth, (b0 === 3 && b1 > 0) ? 0 : 1, [a0, a1, a2, a3, b0, b1, b2, b3, col[0], col[1], col[2], 0, d0, d1, d2, d3]]);
    };
    // 地面/空中の線分 (3D の両端) を画面へ
    const seg3 = (arr, ax, ay, az, bx, by, bz, hw, al, col)=>{
      const pa = P3(ax, ay, az), pb = P3(bx, by, bz);
      if(!pa || !pb || al <= 0.002) return;
      if(!onScreen(pa) && !onScreen(pb) && Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) < 0.3) return;
      inst(arr, pa[0], pa[1], pb[0], pb[1], 0, 0, hw, al, col, 0, 0, 0, 0);
    };
    // 地面の線分 S→E のうち [u0, u1]
    const pushLine = (sx, sy, ex, ey, u0, u1, hw, col)=>{
      if(u1 <= u0 + 1e-4) return;
      seg3(lines, sx + (ex - sx) * u0, sy + (ey - sy) * u0, 0, sx + (ex - sx) * u1, sy + (ey - sy) * u1, 0, hw, 0.88, col);
    };
    // 曲線 f(u) = [x, y, z] (u = 0..1) のうち [u0, u1] を M 分割の折れ線で描く。dashed で 1 区間おきに抜く
    const pushPoly = (arr, f, M, u0, u1, hw, col, al, dashed)=>{
      if(u1 <= u0 || al <= 0.002) return;
      for(let k = 0; k < M; k++){
        if(dashed && (k & 1)) continue;
        const a = Math.max(u0, k / M), b = Math.min(u1, (k + 1) / M);
        if(b <= a) continue;
        const pa = f(a), pb = f(b);
        seg3(arr, pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], hw, al, col);
      }
    };
    // 矢印の頭: 画面上の最後の向きで描く
    const pushArrow = (arr, tip3, prev3, hw, col, al)=>{
      const pt = P3(tip3[0], tip3[1], tip3[2]), pp = P3(prev3[0], prev3[1], prev3[2]);
      if(!pt || !pp || al <= 0.002) return;
      const dx = pt[0] - pp[0], dy = pt[1] - pp[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, nx = -uy, ny = ux, L = 0.015 * lineK;
      inst(arr, pt[0], pt[1], pt[0] - ux * L + nx * L * 0.55, pt[1] - uy * L + ny * L * 0.55, 0, 0, hw, al, col, 0, 0, 0, 0);
      inst(arr, pt[0], pt[1], pt[0] - ux * L - nx * L * 0.55, pt[1] - uy * L - ny * L * 0.55, 0, 0, hw, al, col, 0, 0, 0, 0);
    };
    // 地面の楕円 (中心・半径・向き) を画面の楕円へ (共役半径から主軸を求める)
    const pushEllipse = (x, y, rx, ry, ang, col, col2)=>{
      const c0 = P3(x, y, 0);
      if(!c0 || !onScreen(c0)) return;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const pa = P3(x + rx * ca, y + rx * sa, 0), pb = P3(x - ry * sa, y + ry * ca, 0);
      if(!pa || !pb) return;
      const ax = pa[0] - c0[0], ay = pa[1] - c0[1], bx = pb[0] - c0[0], by = pb[1] - c0[1];
      const p = ax * ax + bx * bx, q = ay * ay + by * by, rr = ax * ay + bx * by;
      const df = Math.sqrt((p - q) * (p - q) + 4 * rr * rr);
      const l1 = (p + q + df) / 2, l2 = Math.max(1e-12, (p + q - df) / 2);
      fill(c0[2], c0[0], c0[1], Math.sqrt(l1), Math.sqrt(l2), 1, 0.5 * Math.atan2(2 * rr, p - q), 0, 1, col, col2[0], col2[1], col2[2], 0);
    };
    // 地面の四角形 (4 隅) を画面の四角形へ。fa = 塗りの濃さ
    const pushQuad = (cs4, fa, hw, col)=>{
      const pp = cs4.map(([x, y])=>P3(x, y, 0));
      if(pp.some(p=>!p) || !pp.some(onScreen)) return;
      const dep = (pp[0][2] + pp[1][2] + pp[2][2] + pp[3][2]) / 4;
      fill(dep, pp[0][0], pp[0][1], pp[1][0], pp[1][1], 3, fa, hw, 1, col, pp[2][0], pp[2][1], pp[3][0], pp[3][1]);
    };
    const dots = [];
    const pushDot = (x, y, r0, col, sc)=>{
      const p = P3(x, y, 0);
      if(!p || !onScreen(p)) return;
      inst(dots, p[0], p[1], r0 * Math.min(sc, 1.3), 0, 2, 0, 0, 1, col, 0, 0, 0, 0);
    };
    // 線の出方: start から dur で伸び、end の rd 前から縮む。縮む向きは先に消える側へ
    const span = (start, dur, end, rd, shrinkToStart)=>{
      if(t < start || t > end) return null;
      const g = Math.min(1, (t - start) / Math.max(dur, 1e-3));
      const k = Math.max(0, Math.min(1, (t - (end - rd)) / Math.max(rd, 1e-3)));
      return shrinkToStart ? [0, Math.min(g, 1 - k)] : [k, g];
    };
    // 立ち上がると楕円の半分が菱形に変わる (図 1 → 図 2。ノードごとに少しずつずれる)。0 = 楕円 / 1 = 菱形
    const morphOf = (r)=>{
      if(r.kind === 'm') return 1;
      if(r.kind !== 'e' || style === 1 || this._hash(r.i, r.n, 40) >= 0.5) return 0;
      return sm(Math.max(0, Math.min(1, (rn - 0.4 * this._hash(r.i, r.n, 41)) / 0.6)));
    };
    const mixC = (a, b, k)=>[a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    // 線の色: 四角がらみは茶色、菱形どうしはサーモン (変わる途中は混ぜる)、ほかは緑
    const lineCol = (a, b)=> (a.kind === 's' || b.kind === 's') ? [C.brown, hwB] : [mixC(C.green, C.salmon, Math.min(morphOf(a), morphOf(b))), hwG];

    // ── ノードと線 (すべて地面) ──
    const reach = 1.9;   // 立ち上がると見える地面が広がるので、中心からこの範囲までは描く
    for(let i = 0; i < cfg.N; i++){
      const r = this._cycAt(i, t);
      if(!r.present) continue;
      this._place(r);
      if(r.kind === 'd' && !r.parent) continue;   // 端点は親から伸びる線の先にだけ出す
      if(t > r.tDie + 0.8 * r.pin) continue;
      if(Math.abs(r.x - cx) > reach || Math.abs(r.y - cy) > reach) continue;
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
        pushDot(r.x, r.y, rDot, C.dot, sc);
      } else if(r.kind === 's'){
        // 茶色の四角 (地面に置いた正方形。斜めから見ると菱形)
        const hs = 0.115 * (0.30 + 0.12 * hh) * sizeK * sc, a = ((hh * 7.7) % 1 - 0.5) * 0.16, ca = Math.cos(a), sa = Math.sin(a);
        const cs4 = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([ux, uy])=>[r.x + (ux * ca - uy * sa) * hs, r.y + (ux * sa + uy * ca) * hs]);
        pushQuad(cs4, 0.5, hwB, C.sqLine);
      } else {
        const mo = morphOf(r);
        if(mo > 0.001){
          // サーモン色の菱形 (縁だけ)
          const rx = 0.115 * (0.12 + 0.20 * hh) * sizeK * sc * mo, ry = rx * 0.62, a = ((hh * 5.7) % 1 - 0.5) * 0.5, ca = Math.cos(a), sa = Math.sin(a);
          const cs4 = [[rx, 0], [0, ry], [-rx, 0], [0, -ry]].map(([ux, uy])=>[r.x + ux * ca - uy * sa, r.y + ux * sa + uy * ca]);
          pushQuad(cs4, 0, hwG / 1.2, C.salmon);
        }
        if(mo < 0.999){
          const rx = 0.115 * (0.10 + 0.30 * Math.pow(hh, 1.5)) * sizeK * sc * (1 - mo);
          const ry = rx * (0.58 + 0.24 * ((hh * 7.3) % 1));
          pushEllipse(r.x, r.y, rx, ry, ((hh * 13.1) % 1 - 0.5) * 0.7, C.lime, C.limeRim);
        }
      }
    }

    const life2 = (x, grow, out, end)=>{
      if(x > end) return null;
      const g = Math.min(1, x / grow), k = Math.max(0, Math.min(1, (x - out) / (end - out)));
      return g > k ? [k, g] : null;
    };
    const H = (id, n, c)=>this._hash(id, n, c);
    const arcsK = Math.max(0, dz(P.arcs) * 0.01);

    // ── 図 1: 青い弧と矢印 (地面の円弧) ──
    const nArc = v1 > 0 ? Math.round(8 * arcsK) : 0;
    for(let k = 0; k < nArc; k++){
      const id = 100000 + k, cy2 = this._pool(id, t, 1.4), n = cy2.n, s = cy2.s;
      if(H(id, n, 3) > 0.75) continue;
      const lf = life2(cy2.x, 0.25, 0.70, 0.82);
      if(!lf) continue;
      const ccx = this._camX(s) + (H(id, n, 4) - 0.5) * aspect * 0.95;
      const ccy = this._camY(s) + (H(id, n, 5) - 0.5) * 0.9;
      const rr = (0.06 + 0.10 * H(id, n, 6)) * cfg.spread;
      const a0 = H(id, n, 7) * Math.PI * 2;
      const sw = (0.9 + 1.1 * H(id, n, 8)) * (H(id, n, 9) < 0.5 ? -1 : 1);
      const f = (v)=>[ccx + rr * Math.cos(a0 + sw * v), ccy + rr * Math.sin(a0 + sw * v), 0];
      pushPoly(arcs, f, 24, lf[0], lf[1], hwL, C.blue, 0.9 * v1, false);
      if(lf[1] >= 1 && lf[0] <= 0) pushArrow(arcs, f(1), f(0.97), hwL, C.blue, 0.9 * v1);
    }

    // ── 図 2: 流れる矢印・縦の面と切り抜かれた人・うねる赤線・波の帯 ──
    if(v2 > 0.002){
      // 流れる青い矢印 (右上へ向かう二次曲線。立ち上がると宙に浮く。3 割は破線)
      const nFlow = Math.round(18 * arcsK);
      for(let k = 0; k < nFlow; k++){
        const id = 400000 + k, cy2 = this._pool(id, t, 1.2), n = cy2.n, s = cy2.s;
        if(H(id, n, 3) > 0.8) continue;
        const lf = life2(cy2.x, 0.30, 0.65, 0.80);
        if(!lf) continue;
        const tx = this._camX(s), ty = this._camY(s);
        const [x0, y0] = this._fromYaw((H(id, n, 4) - 0.62) * aspect * 1.2, (H(id, n, 5) - 0.45) * 1.4, tx, ty);
        const th = 0.12 + (H(id, n, 6) - 0.5) * 0.9, L = (0.35 + 0.55 * H(id, n, 7)) * cfg.spread;
        const [dxw, dyw] = this._fromYaw(Math.cos(th) * L, Math.sin(th) * L, 0, 0);
        const x1 = x0 + dxw, y1 = y0 + dyw;
        const bend = (H(id, n, 8) - 0.5) * 0.45, xc = (x0 + x1) / 2 - dyw * bend, yc = (y0 + y1) / 2 + dxw * bend;
        const z0 = rn * (0.05 + 0.30 * H(id, n, 10)), z1 = rn * (0.05 + 0.30 * H(id, n, 11));
        const f = (v)=>{ const a = (1 - v) * (1 - v), b = 2 * (1 - v) * v, c2 = v * v; return [a * x0 + b * xc + c2 * x1, a * y0 + b * yc + c2 * y1, z0 + (z1 - z0) * v]; };
        const dashed = H(id, n, 9) < 0.3;
        pushPoly(arcs, f, dashed ? 30 : 20, lf[0], lf[1], hwL, C.blue, 0.85 * v2, dashed);
        if(lf[1] >= 1 && lf[0] <= 0 && !dashed) pushArrow(arcs, f(1), f(0.96), hwL, C.blue, 0.85 * v2);
      }
      // 縦の面 (下辺を蝶番に、寝た状態から 90° 立ち上がる。面ごとに少しずつずれる) と切り抜かれた人
      const nPlane = Math.round(5 * Math.max(0, dz(P.planes) * 0.01));
      const figK = Math.max(0, Math.min(1, dz(P.figures) * 0.01));
      const FIG = this._figure();
      for(let k = 0; k < nPlane; k++){
        const id = 200000 + k, cy2 = this._pool(id, t, 2.2), n = cy2.n, s = cy2.s;
        if(H(id, n, 3) > 0.8) continue;
        const x = cy2.x;
        if(x > 0.88) continue;
        const g = this._ease(Math.min(1, x / 0.08), cfg.pop);
        const yo = Math.max(0, Math.min(1, (x - 0.82) / 0.06));
        const sc = Math.max(0, g * (1 - yo * yo * (3 - 2 * yo)));
        if(sc <= 0.001) continue;
        const tx = this._camX(s), ty = this._camY(s);
        // 人の面は横長 (幅は高さの 1.3〜1.7 倍)。どれも平行に奥へ約 60° 向けて置くので、斜めから細く見える (図 2)。
        // 面ごとに横の持ち場を決め、画面での横の広がり (幅 × cos) がその中に収まる位置にする (隣の面と重ならない)
        const slot = aspect * 1.15 / nPlane;
        const ja = 1.05 + (H(id, n, 8) - 0.5) * 0.16;          // 下辺の向き (画面の横から奥へ)
        const Hb = (0.42 + 0.22 * H(id, n, 6)) * sizeK;
        const W = Math.min(Hb * (1.3 + 0.4 * H(id, n, 7)), slot * 0.9 / Math.cos(ja)), Hh = Hb * sc;
        const [bx, by] = this._fromYaw(-aspect * 0.575 + k * slot + Math.max(0, slot - W * Math.cos(ja)) * H(id, n, 4), (H(id, n, 5) - 0.75) * 0.7, tx, ty);
        const [ex, ey] = this._fromYaw(Math.cos(ja), Math.sin(ja), 0, 0);   // 下辺の向き (地面)
        const nx0 = -ey, ny0 = ex;                             // 地面で下辺に直交
        // 立ち上がりは面ごとにずれ、少し弾んで (90° を少し越えてから) 立つ
        const th = (Math.PI / 2) * riseK * this._ease(Math.max(0, Math.min(1, (rn - 0.3 * H(id, n, 12)) / 0.7)), 0.5 * cfg.pop);
        const ux = nx0 * Math.cos(th), uy = ny0 * Math.cos(th), uz = Math.sin(th);   // 面の上向き
        const al = 0.85 * v2;
        const at = (sa, ua)=>[bx + ex * sa * W + ux * ua, by + ey * sa * W + uy * ua, uz * ua];
        // 人の輪郭 (面の下辺に立つ切り抜き。下辺は体の幅だけ切れる。4 分の 1 は頭が上辺から出て、上辺も首の幅だけ切れる)
        let gapTop = null, gapBot = null;
        if(H(id, n, 13) < figK){
          // 人の半幅 (肩まで FIG_HALF × 背の高さ) と両端の余白が面に収まるようにする。収まらなければ人を小さくする
          const pad = 0.015 * sizeK;
          const hf = Math.min(Hh * (H(id, n, 14) < 0.25 ? 1.10 + 0.05 * H(id, n, 15) : 0.50 + 0.20 * H(id, n, 15)), Math.max(0, W * 0.5 - pad) / this.FIG_HALF);
          const tall = hf * 0.96 > Hh;                         // 頭が上辺から出る
          const m = (this.FIG_HALF * hf + pad) / Math.max(W, 1e-6);   // 立てる位置の端からの余白 (0..1)
          const s0 = m + Math.max(0, 1 - 2 * m) * H(id, n, 16), iw = hf / Math.max(W, 1e-6);
          const fp = (q)=>at(s0 + q[0] * iw, q[1] * hf);
          for(let m = 0; m + 1 < FIG.length; m++){
            const a3 = fp(FIG[m]), b3 = fp(FIG[m + 1]);
            seg3(figs, a3[0], a3[1], a3[2], b3[0], b3[1], b3[2], hwB, al, C.ink);
          }
          gapBot = [s0 - this.FIG_FOOT * iw, s0 + this.FIG_FOOT * iw];
          if(tall){ const hx = this._figHalfAt(Hh / Math.max(hf, 1e-6)) * iw; gapTop = [s0 - hx, s0 + hx]; }
        }
        // 辺 (a→b) を、切れ目 gap (0..1 の区間) を除いて描く
        const edge = (ya, sa0, sa1, gp)=>{
          const parts = gp ? [[sa0, Math.max(sa0, gp[0])], [Math.min(sa1, gp[1]), sa1]] : [[sa0, sa1]];
          for(const [u0, u1] of parts){
            if(u1 - u0 < 1e-4) continue;
            const a3 = at(u0, ya), b3 = at(u1, ya);
            seg3(figs, a3[0], a3[1], a3[2], b3[0], b3[1], b3[2], hwB, al, C.ink);
          }
        };
        const p0 = at(0, 0), p1 = at(1, 0), p2 = at(1, Hh), p3 = at(0, Hh);
        edge(0, 0, 1, gapBot);
        edge(Hh, 0, 1, gapTop);
        seg3(figs, p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], hwB, al, C.ink);
        seg3(figs, p3[0], p3[1], p3[2], p0[0], p0[1], p0[2], hwB, al, C.ink);
      }
      // うねる赤い線 (奥から手前の右へ。途中で輪をつくる)
      const nM = Math.round(1.5 * Math.max(0, dz(P.meander) * 0.01));
      for(let k = 0; k < nM; k++){
        const id = 500000 + k, cy2 = this._pool(id, t, 3.0), n = cy2.n, s = cy2.s;
        if(H(id, n, 3) > 0.85) continue;
        const lf = life2(cy2.x, 0.40, 0.78, 0.92);
        if(!lf) continue;
        const tx = this._camX(s), ty = this._camY(s);
        const qx0 = (H(id, n, 4) - 0.6) * aspect * 0.6, qx1 = qx0 + 0.35 + 0.35 * H(id, n, 5);
        const ph2 = H(id, n, 6) * 6.28, lp = 0.45 + 0.25 * H(id, n, 7), lr = 0.025 + 0.02 * H(id, n, 8);
        const dqx = qx1 - qx0, dqy = -1.12, dl = Math.hypot(dqx, dqy), nqx = -dqy / dl, nqy = dqx / dl;
        const f = (v)=>{
          const wv = 0.035 * Math.sin(v * 14 + ph2) + 0.02 * Math.sin(v * 31 + ph2 * 1.7);
          const lv = Math.max(0, Math.min(1, (v - lp) / 0.08));
          const la = lv * Math.PI * 2, lx = lv > 0 && lv < 1 ? lr * Math.sin(la) : 0, ly = lv > 0 && lv < 1 ? lr * (1 - Math.cos(la)) : 0;
          const [wx, wy] = this._fromYaw(qx0 + dqx * v + nqx * wv + lx, 0.56 + dqy * v + nqy * wv + ly, tx, ty);
          return [wx, wy, 0];
        };
        pushPoly(arcs, f, 90, lf[0], lf[1], hwL, C.red, 0.85 * v2, false);
      }
      // 手前の緑の波の帯 (地面。いまの向きで画面の下端に横いっぱい。中に青い線が 2 本)
      const bandK = Math.max(0, dz(P.band) * 0.01);
      if(bandK > 0){
        for(let k = 0; k < 16; k++){
          const blue = k === 4 || k === 11;
          const f = (v)=>{
            const qx = (v - 0.5) * (aspect + 1.2);
            const qy = -0.42 - 0.25 * rn + k * 0.0105 + 0.03 * Math.sin(qx * 5 + k * 0.35 + t * 0.15) + 0.012 * Math.sin(qx * 13 + k);
            return [cx + qx * cps + qy * sps, cy - qx * sps + qy * cps, 0];
          };
          pushPoly(back, f, 64, 0, 1, blue ? hwL : hwG * 1.5, blue ? C.blue : C.band, Math.min(1, (blue ? 0.7 : 0.6) * bandK) * v2, false);
        }
      }
    }

    // ── 描く: 紙 → 波の帯 → 線 → 弧・流れ・赤線 → 面と人 → 点 → 四角と楕円と菱形 (奥から手前) ──
    const opaque = opts.opaque !== false;
    const paper = Array.isArray(P.paper) ? P.paper : this.PDefaults.paper;
    const bg = [];
    if(opaque) inst(bg, cx, cy, 0, 0, 4, 0, 0, 1, paper, 0, 0, 0, 0);
    fills.sort((a, b)=>(b[0] - a[0]) || (a[1] - b[1]));
    const fl = [];
    for(const f of fills) for(const v of f[2]) fl.push(v);
    const all = bg.concat(back, lines, arcs, figs, dots, fl);
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
      gl.uniform1f(this.U.hand, Math.max(0, dz(P.hand) * 0.01));
      gl.uniform3f(this.U.sqFill, C.sqFill[0], C.sqFill[1], C.sqFill[2]);
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
