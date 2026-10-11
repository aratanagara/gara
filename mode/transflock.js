'use strict';
/* Transmute Flock engine — vj/ の追加レンダリングモード (kind:'transflock')。
   shaders/bg_transflock.frag (全ピクセルで群れを再計算する SDF 方式) を、板 1 枚 = 1 インスタンスの
   四角形として頂点シェーダで配置する方式に作り直したもの。数式・乱数・パラメータの意味は frag と同じ。
   - 板 (スタンプ本体 / 小片) は gl_InstanceID から (鳥 k, スタンプ i, 小片 m) を復元し、頂点シェーダで
     軌道・向き・反りを計算して透視投影する。計算は板 1 枚につき 1 回 (frag は 1 ピクセルにつき全板)。
   - 重なりは深度テスト: 手前の板が奥を隠す。塗りのとき板の縁は紙色の線 (= 重なった境のひび割れ)、
     輪郭だけのとき縁はインクの線で内部は紙 (Slot B では透明) + 深度書き込み (奥の線は手前で消える)。
   - 既存の vj WebGL2 コンテキストを共有 / 指定 FBO に描画 → 通常の合成・Post FX に合流
   - Drone/Beat: frag の getBeat() と同じ (beat モード = 拍数 / drone = time × 6 × bpm/120)
   IF: init(gl) / update() / render({fbo,w,h,slot,beat,clock,opaque}) / P(params)
*/

const TransFlock = {
  gl:null, initialized:false,
  prog:null, vao:null, cornerVBO:null,
  depthRBO:null, depthW:0, depthH:0,
  startTime:0,

  // ── パラメータ (UI から操作)。名前は frag の @param から u を外したもの。工場値は frag の @param 既定値 ──
  //    数値は uniform に渡す直前に App.deadParam を通す (frag ハーネスが @param にそうしていたのと同じ)
  P:{
    birds:7,          // 鳥 (ストローク) の数
    speed:100,        // 飛ぶ速さ (%)
    wheel:160,        // 群れ全体の旋回の速さ (%)
    trail:10,         // ストロークの長さ (拍)
    step:0.07,        // スタンプ間隔 (拍)
    gap:0.9,          // 鳥どうしの時間差 (拍)
    spread:1.3,       // 群れの横の広がり
    brush:1.0,        // 筆の太さ
    pressure:0.7,     // 筆圧のうねり
    jitter:0.4,       // スタンプごとの大きさ・角度のばらつき
    cluster:0.6,      // 大きいスタンプの周りに集まる小片の量
    grain:0.22,       // 小片の大きさ (スタンプに対する比)
    stray:0.3,        // はぐれ小片の群れの量
    islands:0.5,      // 破片の「島」(密集/過疎のコントラスト)
    islandLen:1.0,    // 島の長さ (拍)
    fill:1.0,         // 塗りつぶし (1=塗る / 0=輪郭だけ)
    line:0.9,         // 輪郭線の太さ (px)。0.2 未満は薄くなり 0.1 で 25% の極細線
    detail:0.5,       // 一部の板 (7%) に出る内側の線の濃さ (塗り時は紙色 / 輪郭時はインク)
    persp:1.0,        // 遠近の強さ
    depth:0.7,        // 奥行きによる減衰
    warp:0.5,         // 板を軌道に沿ってねじる量 (反り)
    audio:1.0,        // 音の効き (筆が太くなる)
    ink:[0.914, 0.933, 0.949],    // インクの色 (#e9eef2)
    paper:[0, 0, 0],              // Slot A のときの下地 (紙) の色
  },

  // ===== init =====
  init(gl){
    if(this.initialized) return;
    this.gl = gl;
    this.startTime = performance.now()/1000;

    const vs = `#version 300 es
precision highp float;
in vec2 aCorner;                 // 板ローカルの四隅 (-1..1)
uniform vec2  uRes;
uniform float uU, uLu, uDsu, uI0, uStampsMax, uBirds;
uniform float uGap, uSpread, uWheel, uFcl, uBrush, uAu;
uniform float uIslK, uIslands, uPressure, uJitter, uCluster, uGrain, uStray, uWarp, uDepth;
uniform float uMinSS;            // 投影短軸の下限 (画面高=1 の単位)。これ未満は真横なので描かない
out vec2  vLoc;                  // 板ローカル (-1..1)
out vec2  vHalfPx;               // 投影した 2 半軸の長さ (px)
out float vDepthF;               // 奥行き減衰
out float vTint;                 // 色パラメータ (未使用: Grad Map は合成段で全スロットに掛かる)
out float vDet;                  // 内側の線を出す板か (0/1)

#define TF_EYE 3.6
#define TF_F1 0.48
#define TF_F2 1.18
#define TF_F3 0.38
#define TF_F4 1.08
#define TF_F5 0.30
#define TF_F6 0.87
float tf_h1(float n){ return fract(sin(n*91.3458)*47453.5453); }
vec2  tf_h2(float n){ return fract(sin(vec2(n*12.9898, n*78.233))*43758.5453); }
vec3  tf_h3(float n){ return fract(sin(vec3(n*12.9898, n*78.233, n*37.719))*43758.5453); }
float tf_vn(float x){ float i = floor(x), f = fract(x); f = f*f*(3.0 - 2.0*f); return mix(tf_h1(i), tf_h1(i + 1.0), f); }
vec3 tf_path(float u){
  return vec3(0.95*sin(u*TF_F1)       + 0.45*sin(u*TF_F2 + 1.3),
              0.70*sin(u*TF_F3 + 2.1) + 0.35*sin(u*TF_F4 + 0.4),
              0.80*sin(u*TF_F5 + 4.0) + 0.40*sin(u*TF_F6 + 2.6));
}
vec3 tf_pathVel(float u){
  return vec3(0.95*TF_F1*cos(u*TF_F1)       + 0.45*TF_F2*cos(u*TF_F2 + 1.3),
              0.70*TF_F3*cos(u*TF_F3 + 2.1) + 0.35*TF_F4*cos(u*TF_F4 + 0.4),
              0.80*TF_F5*cos(u*TF_F5 + 4.0) + 0.40*TF_F6*cos(u*TF_F6 + 2.6));
}
vec3 tf_pathAcc(float u){
  return -vec3(0.95*TF_F1*TF_F1*sin(u*TF_F1)       + 0.45*TF_F2*TF_F2*sin(u*TF_F2 + 1.3),
               0.70*TF_F3*TF_F3*sin(u*TF_F3 + 2.1) + 0.35*TF_F4*TF_F4*sin(u*TF_F4 + 0.4),
               0.80*TF_F5*TF_F5*sin(u*TF_F5 + 4.0) + 0.40*TF_F6*TF_F6*sin(u*TF_F6 + 2.6));
}
mat3 tf_frame(float w){
  float cx = cos(w*0.71 + 0.3), sx = sin(w*0.71 + 0.3);
  float cy = cos(w*1.13),       sy = sin(w*1.13);
  float cz = cos(w*0.47 + 1.0), sz = sin(w*0.47 + 1.0);
  mat3 rx = mat3(1.0, 0.0, 0.0,  0.0, cx, sx,  0.0, -sx, cx);
  mat3 ry = mat3(cy, 0.0, -sy,  0.0, 1.0, 0.0,  sy, 0.0, cy);
  mat3 rz = mat3(cz, sz, 0.0,  -sz, cz, 0.0,  0.0, 0.0, 1.0);
  return rz * ry * rx;
}
// 鳥 k の、軌道時刻 t における 3D 位置と速度 (frag の tf_bird と同じ)
void tf_bird(float t, float k, float gap, float spread, mat3 M, vec3 follow, out vec3 P, out vec3 V, out vec3 A){
  vec3  hk = tf_h3(k*3.1 + 7.0);
  float fm = 1.0 + (hk.x - 0.5) * 0.16 * spread;
  float tk = (t - k*gap) * fm;
  vec3  amp = vec3(0.85, 0.75, 1.6) * (1.0 + (hk.y - 0.5) * 0.3 * spread);
  float breath = 1.0 + 0.55 * sin(t * 0.21 + 0.7);
  vec3  off = (hk - 0.5) * 0.9 * spread * breath;
  vec3  flutter = 0.07 * spread * vec3(sin(t*1.9 + k*2.0), sin(t*1.3 + k*4.0), sin(t*1.6 + k*6.0));
  P = vec3(0.0, 0.0, TF_EYE) + M * (tf_path(tk) * amp + off + flutter) - follow;
  V = M * (tf_pathVel(tk) * amp * fm);
  A = M * (tf_pathAcc(tk) * amp * fm * fm);
}
const vec4 CULL = vec4(0.0, 0.0, -3.0, 1.0);   // クリップ外 → 描かれない

void main(){
  float n   = float(gl_InstanceID);
  float per = uStampsMax * 4.0;
  float k   = floor(n / per);
  float r   = n - k*per;
  float il  = floor(r / 4.0);
  float m   = r - il*4.0;                 // 0=本体 / 1..3=小片
  float i   = uI0 + il;
  float ti  = i * uDsu;                   // このスタンプを打った時刻
  float s   = uU - ti;                    // 筆先からの遡り
  if(k >= uBirds || s < 0.0 || s > uLu){ gl_Position = CULL; return; }

  // 群れの座標系 (旋回) と追従カメラ (frag の main 冒頭と同じ)
  mat3 R = tf_frame(uU * uWheel);
  float cy = uU * uWheel * 0.9, cc = cos(cy), sn = sin(cy);
  mat3 cam = mat3(cc, 0.0, -sn,  0.0, 1.0, 0.0,  sn, 0.0, cc);
  mat3 M = cam * R;
  vec3 follow;
  { vec3 P0, V0, A0; tf_bird(uU, 0.0, 0.0, 0.0, M, vec3(0.0), P0, V0, A0);
    follow = vec3(P0.xy * 0.85, (P0.z - TF_EYE) * 0.3); }

  vec3 P, V, A; tf_bird(ti, k, uGap, uSpread, M, follow, P, V, A);
  if(P.z < 0.3){ gl_Position = CULL; return; }
  vec2  h2 = tf_h2(i*0.731 + k*19.7);
  vec3  h3 = tf_h3(i*0.413 + k*5.3);
  float isl  = smoothstep(0.2, 0.8, tf_vn(ti * uIslK + k*3.7));
  float dens = mix(1.0, isl, uIslands);
  float keep = step(fract(h3.z*2.7), mix(1.0, 0.06 + 0.94*dens, uIslands));
  float press = mix(1.0, 0.45 + 0.55*(0.5 + 0.5*sin(ti*2.3 + k*7.0)), uPressure);
  float tail  = mix(1.0, 0.3, smoothstep(0.45*uLu, 0.95*uLu, s));
  float jit   = mix(1.0, 0.5 + floor(h2.x*3.0)*0.5, uJitter);
  float w     = uBrush * press * tail * jit * (1.0 + 0.6*uAu);
  float depthF = mix(1.0, clamp(1.6 - 0.6*(P.z/TF_EYE), 0.15, 1.0), uDepth);
  vec3  T = normalize(V + vec3(1e-5, 0.0, 0.0));
  vec3  S = normalize(cross(T, vec3(0.13, 1.0, 0.07)));
  vec3  N = cross(S, T);
  vec3  Nc = A - T * dot(A, T);
  float kc = clamp(length(Nc) * 1.5, 0.0, 1.0);
  Nc = normalize(Nc + vec3(1e-6, 0.0, 0.0));
  float roll = (h2.y - 0.5) * 0.18 * uJitter + uWarp * 0.9 * sin(ti*0.55 + k*1.7);
  vec3  Sw = normalize(cos(roll)*S + sin(roll)*N);
  Sw = normalize(mix(Sw, Nc * sign(dot(Nc, Sw) + 1e-6), uWarp * 0.45 * kc));
  { vec3 vd = normalize(P);
    vec3 Sb = normalize(cross(T, vd) + vec3(1e-6, 0.0, 0.0));
    float face = abs(dot(normalize(cross(T, Sw)), vd));
    Sw = normalize(mix(Sb * sign(dot(Sb, Sw) + 1e-6), Sw, smoothstep(0.08, 0.45, face))); }
  float strayOn = step(1.0 - uStray*0.12, h3.x);
  vec3  C3 = P + Sw * strayOn * (h2.y - 0.5) * 7.0 * w;
  float w1 = w * (0.9 + 0.7*fract(h2.x*5.17)), w2 = w * (0.5 + 0.4*fract(h3.y*7.31));
  vec3 c, a1, a2; float det;
  if(m < 0.5){
    if(strayOn > 0.5 || keep < 0.5){ gl_Position = CULL; return; }
    c = P; a1 = T * w1; a2 = Sw * w2;
    det = step(fract(h3.z*3.1), 0.07);
  } else {
    float clusterOn = max(strayOn, step(fract(h3.y*4.7), uCluster * mix(1.0, 0.35 + 1.1*dens, uIslands)));
    if(clusterOn < 0.5){ gl_Position = CULL; return; }
    float gsz = uGrain * (strayOn > 0.5 ? 1.3 : 1.0) * mix(1.0, 0.55 + 0.6*dens, uIslands);
    float fm  = m - 1.0;
    vec2  hm = tf_h2(i*0.157 + k*3.9 + fm*11.3);
    float gw = gsz * (0.6 + 0.8*fract(hm.x*6.1 + hm.y*3.3));
    float ph = (hm.y - 0.5) * 2.2, ps = (hm.x - 0.5) * 0.25;
    c  = C3 + T * (hm.x - 0.5) * w1 * 2.4 + Sw * (hm.y - 0.5) * w2 * 2.6;
    a1 = (cos(ph)*T + sin(ph)*Sw) * w1 * gw;
    a2 = ((-sin(ph)*T + cos(ph)*Sw) * cos(ps) + N * sin(ps)) * w2 * gw;
    det = step(fract(hm.x*9.1), 0.10);
  }
  // 投影 (frag の tf_sdQuad と同じ条件で捨てる)
  if(c.z < 0.3){ gl_Position = CULL; return; }
  vec3 pa = c + a1, pb = c + a2;
  float zmin = min(min(c.z - abs(a1.z) - abs(a2.z), pa.z), pb.z);
  if(zmin < 0.25){ gl_Position = CULL; return; }
  vec2 s0 = uFcl * c.xy / c.z;
  vec2 f1 = uFcl * pa.xy / pa.z - s0;
  vec2 f2 = uFcl * pb.xy / pb.z - s0;
  float dt = f1.x*f2.y - f1.y*f2.x;
  float ss = min(length(f1), length(f2));
  if(abs(dt) < 1e-7 || ss < uMinSS){ gl_Position = CULL; return; }

  vec3 wp = c + a1 * aCorner.x + a2 * aCorner.y;
  float asp = uRes.x / uRes.y;
  // 画面高 = 1 の単位 (frag の p) → NDC は ×2。深度は near 0.25 / far 40 の透視
  const float zn = 0.25, zf = 40.0;
  float zc = ((zf + zn) / (zf - zn)) * wp.z - 2.0*zf*zn / (zf - zn);
  gl_Position = vec4(2.0 * uFcl * wp.x / asp, 2.0 * uFcl * wp.y, zc, wp.z);
  vLoc    = aCorner;
  vHalfPx = vec2(length(f1), length(f2)) * uRes.y;
  vDepthF = depthF;
  vTint   = fract(k*0.17 + ti*0.05);
  vDet    = det;
}`;

    const fs = `#version 300 es
precision highp float;
in vec2  vLoc;
in vec2  vHalfPx;
in float vDepthF;
in float vTint;
in float vDet;
uniform float uLine, uLineK, uFill, uDetail, uOpaque;
uniform vec3  uInk, uPaper;
out vec4 frag;
void main(){
  vec2  e  = (1.0 - abs(vLoc)) * vHalfPx;     // 縁までの距離 (px)
  float d  = min(e.x, e.y);
  float lw = max(uLine, 0.05) * 0.5;
  float aa = 0.7;
  float band  = (1.0 - smoothstep(lw, lw + aa, d)) * uLineK;   // 縁の線 (塗りでは重なった板の境のひび割れになる)
  float inner = (1.0 - smoothstep(0.5, 0.5 + aa, abs(d - (2.0*lw + 1.6)))) * vDet * uDetail * uLineK;   // 一部の板の内側の線
  float lines = max(band, inner);
  // 輪郭モード: 線=インク、内部=紙 / 塗りモード: 内部=インク、線=紙色
  float inkOutline = lines;
  float inkFill    = 1.0 - lines;
  float ink = mix(inkOutline, inkFill, uFill) * vDepthF;
  if(uOpaque > 0.5) frag = vec4(mix(uPaper, uInk, ink), 1.0);
  else              frag = vec4(uInk, ink);   // Slot B: 実 alpha (内部が透明でも深度は書く = 奥の線を隠す)
}`;

    const link = (vsrc, fsrc)=>{
      const sh = (type, src)=>{
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){ console.error('[transflock] shader error:', gl.getShaderInfoLog(s)); }
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vsrc)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsrc));
      gl.linkProgram(p);
      if(!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error('[transflock] link error:', gl.getProgramInfoLog(p));
      return p;
    };
    this.prog = link(vs, fs);

    this.cornerVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const aC = gl.getAttribLocation(this.prog, 'aCorner');
    gl.enableVertexAttribArray(aC);
    gl.vertexAttribPointer(aC, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(aC, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.initialized = true;
  },

  _ensureDepth(w,h){
    const gl = this.gl;
    if(this.depthRBO && this.depthW===w && this.depthH===h) return;
    if(this.depthRBO) gl.deleteRenderbuffer(this.depthRBO);
    this.depthRBO = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRBO);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    this.depthW = w; this.depthH = h;
  },

  update(){},

  // 現在の設定での板 (インスタンス) 数。負荷の目安
  instanceCount(){
    const g = this._geom(); return g ? g.instances : 0;
  },
  _geom(){
    const dz = (v)=> (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v;
    const P = this.P;
    const kv  = 0.22 * (dz(P.speed) * 0.01);
    const Lu  = Math.max(dz(P.trail), 0.2) * kv;
    let   dsu = Math.max(dz(P.step), 0.02) * kv;
    dsu = Math.max(dsu, Lu / 8 / 20);                 // frag と同じ下限 (1 区間 TF_NW-2 枚)
    const stampsMax = Math.ceil(Lu / dsu) + 2;
    const birds = Math.max(1, Math.min(12, Math.ceil(dz(P.birds))));
    return { kv, Lu, dsu, stampsMax, birds, instances: birds * stampsMax * 4 };
  },

  render(opts){
    const gl = this.gl;
    if(!this.initialized || !this.prog) return;
    const P = this.P;
    const dz = (v)=> (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v;
    const w = opts.w, h = opts.h;
    const clock = (opts.clock != null) ? opts.clock : (performance.now()/1000 - this.startTime);
    // 時間基準は frag の getBeat() と同じ: beat モード = 拍数 / drone = time × 6 × bpm/120
    const bpm = (typeof BPM !== 'undefined' && BPM.bpm) ? BPM.bpm : 120;
    const beatMode = (typeof App !== 'undefined' && App.beatMode === 'beat');
    const bt = (beatMode && opts.beat != null) ? opts.beat : clock * 6.0 * (bpm / 120);

    const g = this._geom();
    const u = bt * g.kv;
    const i0 = Math.floor((u - g.Lu) / g.dsu) - 1;
    const wheel = 0.07 * (dz(P.wheel) * 0.01) / Math.max(g.kv, 1e-4);
    const fcl = 1.6 / Math.max(0.3, Math.min(2.0, dz(P.persp)));
    const audioReact = (typeof Audio !== 'undefined' && Audio.react) ? Math.max(0, Math.min(1, Audio.react)) : 0;
    const au = audioReact * dz(P.audio);
    const lineEff = dz(P.line);
    const lineK = 0.25 + 0.75 * (()=>{ const t = Math.max(0, Math.min(1, lineEff / 0.12)); return t*t*(3 - 2*t); })();

    const useRBO = !!opts.fbo;
    if(useRBO){
      this._ensureDepth(w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, opts.fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRBO);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.viewport(0, 0, w, h);
    const opaque = (opts.opaque !== false);
    const paper = P.paper || [0,0,0];
    gl.clearColor(opaque ? paper[0] : 0, opaque ? paper[1] : 0, opaque ? paper[2] : 0, opaque ? 1 : 0);
    gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    const U = (n)=>gl.getUniformLocation(this.prog, n);
    gl.uniform2f(U('uRes'), w, h);
    gl.uniform1f(U('uU'), u);
    gl.uniform1f(U('uLu'), g.Lu);
    gl.uniform1f(U('uDsu'), g.dsu);
    gl.uniform1f(U('uI0'), i0);
    gl.uniform1f(U('uStampsMax'), g.stampsMax);
    gl.uniform1f(U('uBirds'), Math.max(1, Math.min(12, dz(P.birds))));
    gl.uniform1f(U('uGap'), dz(P.gap) * g.kv);
    gl.uniform1f(U('uSpread'), dz(P.spread));
    gl.uniform1f(U('uWheel'), wheel);
    gl.uniform1f(U('uFcl'), fcl);
    gl.uniform1f(U('uBrush'), 0.06 * dz(P.brush));
    gl.uniform1f(U('uAu'), au);
    gl.uniform1f(U('uIslK'), 1.0 / Math.max(2.0 * g.kv * dz(P.islandLen), 1e-4));
    gl.uniform1f(U('uIslands'), dz(P.islands));
    gl.uniform1f(U('uPressure'), dz(P.pressure));
    gl.uniform1f(U('uJitter'), dz(P.jitter));
    gl.uniform1f(U('uCluster'), dz(P.cluster));
    gl.uniform1f(U('uGrain'), dz(P.grain));
    gl.uniform1f(U('uStray'), dz(P.stray));
    gl.uniform1f(U('uWarp'), dz(P.warp));
    gl.uniform1f(U('uDepth'), dz(P.depth));
    gl.uniform1f(U('uMinSS'), 1.5 / Math.max(1, h));
    gl.uniform1f(U('uLine'), lineEff);
    gl.uniform1f(U('uLineK'), lineK);
    gl.uniform1f(U('uFill'), dz(P.fill));
    gl.uniform1f(U('uDetail'), dz(P.detail));
    gl.uniform1f(U('uOpaque'), opaque ? 1 : 0);
    const ink = P.ink || [0.914, 0.933, 0.949];
    gl.uniform3f(U('uInk'), ink[0], ink[1], ink[2]);
    gl.uniform3f(U('uPaper'), paper[0], paper[1], paper[2]);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, g.instances);
    gl.bindVertexArray(null);

    if(useRBO) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },
};

// PDefaults はスクリプト読込時に確定させる (init より先に state 復元が走るため)
TransFlock.PDefaults = JSON.parse(JSON.stringify(TransFlock.P));

if (typeof window !== 'undefined') window.TransFlock = TransFlock;
