// Ribbon — Shadertoy 7tBGDd "Day 558" by jeyko のリボン(パラメトリック曲面のライン)を
// Source : https://www.shadertoy.com/view/7tBGDd
//   GL_LINES で描画。頂点シェーダで座標を計算し 1 発描画するので激軽(元のピクセル毎ブルートフォースを解消)。
//   VJ エンジン IF: init(gl) / update() / render({fbo,w,h,slot})。
const Ribbon = {
  gl: null, initialized: false, prog: null, vbo: null, nVerts: 0, startTime: 0, loc: {},

  // ── パラメータ (UI から操作。使う直前に App.deadParam を通す)。既定値 = 移植元と同一の絵 ──
  P:{
    strands:40,     // リボンを編む線の本数
    span:100,       // 線の長さ = 曲面の i 方向の範囲 (%)
    twist:100,      // ねじれの強さ (%)
    twistSwing:100, // ねじれの強さの揺れ幅 (%)
    wave:100,       // 横うねりの細かさ (%)
    loop:100,       // 輪の横幅 (%)
    arch:100,       // 縦のアーチ (%)
    depthWave:100,  // 奥行き方向のうねり (%)
    swayYaw:100,    // 左右の首振りの振れ幅 (%)
    swayRoll:100,   // 画面内の回転の振れ幅 (%)
    distance:100,   // カメラからの距離 (%)
    breathe:100,    // 距離の呼吸の振れ幅 (%)
    lens:100,       // 遠近の強さ (%)。下げると広角に広がる
    fade:100,       // 奥の線を消すしきい値 (%)。0 で奥の線もすべて見える
  },
  PDefaults:null,
  SPECS:[
    ['Strands',     'strands',    4,   96,  1, 'int'],
    ['Span',        'span',       20,  300, 1, 'pct'],
    ['Twist',       'twist',      20,  300, 1, 'pct'],
    ['Twist Swing', 'twistSwing', 0,   300, 1, 'pct'],
    ['Wave',        'wave',       0,   400, 1, 'pct'],
    ['Loop',        'loop',       0,   400, 1, 'pct'],
    ['Arch',        'arch',       0,   300, 1, 'pct'],
    ['Depth Wave',  'depthWave',  30,  300, 1, 'pct'],
    ['Sway Yaw',    'swayYaw',    0,   400, 1, 'pct'],
    ['Sway Roll',   'swayRoll',   0,   400, 1, 'pct'],
    ['Distance',    'distance',   50,  180, 1, 'pct'],
    ['Breathe',     'breathe',    0,   250, 1, 'pct'],
    ['Lens',        'lens',       30,  300, 1, 'pct'],
    ['Fade',        'fade',       0,   400, 1, 'pct'],
  ],
  MAXJ: 96,   // VBO は最大本数ぶん確保し、strands 本だけ描く

  _compile(gl, type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if(!__glReady(gl, s, false)) console.error('Ribbon shader:', gl.getShaderInfoLog(s));
    return s;
  },

  init(gl){
    this.gl = gl;
    const vs = `#version 300 es
precision highp float;
in vec2 aIdx;                     // (i, j) グリッド添字
uniform float uTime; uniform vec2 uRes; uniform vec2 uMIJ;   // (MI=i分割, MJ=strand数)
uniform float uSpan;
uniform float uTwist;
uniform float uTwistSwing;
uniform float uWave;
uniform float uLoop;
uniform float uArch;
uniform float uDepthWave;
uniform float uSwayYaw;
uniform float uSwayRoll;
uniform float uDistance;
uniform float uBreathe;
uniform float uLens;
out float vOpZ; out float vZ;
#define PI 3.14159265
mat2 rot(float a){ return mat2(cos(a),-sin(a),sin(a),cos(a)); }
vec3 getP(vec2 idx, float sx){
  idx.y += idx.x*sx*(74.0*uTwist + sin(uTime*0.5)*50.0*uTwistSwing) + uTime*2.0;
  return vec3(sin(idx.x*sin(idx.y*0.5*uWave)) + cos(idx.y)*0.5*uLoop, cos(idx.y) + cos(idx.x)*uArch, sin(idx.y)*uDepthWave);
}
vec3 transformPt(vec3 p){
  p.xz *= rot(sin(uTime*0.2)*0.4*uSwayYaw);
  p.xy *= rot(sin(uTime*0.6)*0.4*uSwayRoll + 2.0 + uTime*0.2);
  p.z += 1.5*uDistance + sin(uTime + sin(uTime))*0.5*uBreathe;
  p.xy /= p.z*3.0*uLens;
  return p;
}
void main(){
  float mul = PI, sx = mul/40.0;   // sx は形状係数(元の itersi=40 固定)。i を細分しても形状は不変
  vec2 idx = vec2(aIdx.x/uMIJ.x*uSpan, aIdx.y/uMIJ.y)*mul;
  vec3 op = getP(idx, sx);
  vec3 p = transformPt(op);
  vOpZ = abs(op.z); vZ = p.z;
  if(p.z <= 0.02){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }   // 背面(z<=0)は画面外へ
  float aspect = uRes.x/uRes.y;
  gl_Position = vec4(p.x*2.0/aspect, p.y*2.0, 0.0, 1.0);
}`;
    const fs = `#version 300 es
precision highp float;
in float vOpZ; in float vZ;
uniform float uFade;
out vec4 o;
void main(){
  if(vZ <= 0.0) discard;
  o = vec4(1.0, 1.0, 1.0, smoothstep(0.2*uFade, 1.0, vOpZ));   // 白ライン(alpha=|op.z| フェード)
}`;
    const p = gl.createProgram();
    gl.attachShader(p, this._compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this._compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aIdx');
    gl.linkProgram(p);
    if(!__glReady(gl, p, true)) console.error('Ribbon link:', gl.getProgramInfoLog(p));
    this.prog = p;
    this.loc = {};
    for(const n of ['uTime','uRes','uMIJ','uSpan','uTwist','uTwistSwing','uWave','uLoop','uArch','uDepthWave','uSwayYaw','uSwayRoll','uDistance','uBreathe','uLens','uFade'])
      this.loc[n] = gl.getUniformLocation(p, n);
    // GL_LINES: 各 strand(j 固定)を i 方向 MI 分割で細かく接続(曲線を滑らかに)。最大 MAXJ 本ぶん積み、strands 本だけ描く
    this.MI = 160;
    const verts = [];
    for(let j=0;j<this.MAXJ;j++) for(let i=0;i<this.MI;i++){ verts.push(i, j, i+1, j); }
    this.nVerts = verts.length / 2;
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    this.startTime = performance.now() / 1000;
    this.initialized = true;
  },

  update(){ /* 時刻は render 内で参照 */ },

  render(opts){
    if(!this.initialized) return;
    const gl = this.gl, { fbo, w, h } = opts;
    const t = (typeof opts.clock === 'number') ? opts.clock : (performance.now() / 1000 - this.startTime);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.0, 0.0, 0.0, 0.0);          // 実 alpha: 背景は透明 (Slot A では合成側が rgb=黒として扱う)
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    // alpha も蓄積する (dstA = srcA + dstA*(1-srcA)) → 線のある所だけ不透明になり Slot B で実 alpha 透過
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    const P = this.P;
    const dz = (v)=> (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v;
    const pc = (k)=> dz(P[k]) / 100;
    const nJ = Math.max(1, Math.min(this.MAXJ, Math.round(dz(P.strands)) || 1));
    gl.uniform1f(this.loc.uTime, t);
    gl.uniform2f(this.loc.uRes, w, h);
    gl.uniform2f(this.loc.uMIJ, this.MI, nJ);
    gl.uniform1f(this.loc.uSpan, Math.max(0.05, pc('span')));
    for(const k of ['twist','twistSwing','wave','loop','arch','depthWave','swayYaw','swayRoll','breathe','fade'])
      gl.uniform1f(this.loc['u' + k[0].toUpperCase() + k.slice(1)], pc(k));
    gl.uniform1f(this.loc.uDistance, Math.max(0.05, pc('distance')));
    gl.uniform1f(this.loc.uLens, Math.max(0.05, pc('lens')));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, nJ * this.MI * 2);
    gl.disableVertexAttribArray(0);
    gl.disable(gl.BLEND);
  }
};
Ribbon.PDefaults = JSON.parse(JSON.stringify(Ribbon.P));   // 既定値はスクリプト読込時に確定 (state 復元より先)
