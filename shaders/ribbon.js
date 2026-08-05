// Ribbon — Shadertoy 7tBGDd "Day 558" by jeyko のリボン(パラメトリック曲面のライン)を
// Source : https://www.shadertoy.com/view/7tBGDd
//   GL_LINES で描画。頂点シェーダで座標を計算し 1 発描画するので激軽(元のピクセル毎ブルートフォースを解消)。
//   VJ エンジン IF: init(gl) / update() / render({fbo,w,h,slot})。
const Ribbon = {
  gl: null, initialized: false, prog: null, vbo: null, nVerts: 0, startTime: 0, loc: {},

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
out float vOpZ; out float vZ;
#define PI 3.14159265
mat2 rot(float a){ return mat2(cos(a),-sin(a),sin(a),cos(a)); }
vec3 getP(vec2 idx, float sx){
  idx.y += idx.x*sx*(74.0 + sin(uTime*0.5)*50.0) + uTime*2.0;
  return vec3(sin(idx.x*sin(idx.y*0.5)) + cos(idx.y)*0.5, cos(idx.y) + cos(idx.x), sin(idx.y));
}
vec3 transformPt(vec3 p){
  p.xz *= rot(sin(uTime*0.2)*0.4);
  p.xy *= rot(sin(uTime*0.6)*0.4 + 2.0 + uTime*0.2);
  p.z += 1.5 + sin(uTime + sin(uTime))*0.5;
  p.xy /= p.z*3.0;
  return p;
}
void main(){
  float mul = PI, sx = mul/40.0;   // sx は形状係数(元の itersi=40 固定)。i を細分しても形状は不変
  vec2 idx = vec2(aIdx.x/uMIJ.x, aIdx.y/uMIJ.y)*mul;
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
out vec4 o;
void main(){
  if(vZ <= 0.0) discard;
  o = vec4(1.0, 1.0, 1.0, smoothstep(0.2, 1.0, vOpZ));   // 白ライン(alpha=|op.z| フェード)
}`;
    const p = gl.createProgram();
    gl.attachShader(p, this._compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this._compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aIdx');
    gl.linkProgram(p);
    if(!__glReady(gl, p, true)) console.error('Ribbon link:', gl.getProgramInfoLog(p));
    this.prog = p;
    this.loc = { uTime: gl.getUniformLocation(p,'uTime'), uRes: gl.getUniformLocation(p,'uRes'), uMIJ: gl.getUniformLocation(p,'uMIJ') };
    // GL_LINES: 各 strand(j 固定, MJ本)を i 方向 MI 分割で細かく接続(曲線を滑らかに)
    this.MI = 160; this.MJ = 40;
    const verts = [];
    for(let j=0;j<this.MJ;j++) for(let i=0;i<this.MI;i++){ verts.push(i, j, i+1, j); }
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
    gl.uniform1f(this.loc.uTime, t);
    gl.uniform2f(this.loc.uRes, w, h);
    gl.uniform2f(this.loc.uMIJ, this.MI, this.MJ);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, this.nVerts);
    gl.disableVertexAttribArray(0);
    gl.disable(gl.BLEND);
  }
};
