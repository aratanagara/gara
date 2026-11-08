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
    swayPitch:0,    // 上下の首振りの振れ幅 (%)。0 で振らない
    rollOffset:0,   // 画面内の回転の基準角 (°)
    centerX:0,      // 画面中心からの横ずれ (%)
    centerY:0,      // 画面中心からの縦ずれ (%)
    stretchX:100,   // 形の横幅 (%)
    stretchY:100,   // 形の縦幅 (%)
    strandSpread:100, // 線同士の位相の開き (%)。上げると線がばらける
    lineWeight:100, // 線の太さ (%)。100 で 1px
    lineOpacity:100,// 線の濃さ (%)
    depthFade:0,    // 奥ほど線が薄くなる強さ (%)
    tipFade:0,      // 線の両端が消える長さ (%)
    dashes:0,       // 線の破線の数 (0 で実線)
    dashDuty:50,    // 破線の線の割合 (%)
    lineHue:0,      // 線の色相 (°)
    lineTint:0,     // 線の色づき (%)。0 で白
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
    ['Sway Pitch',  'swayPitch',  0,   200, 1, 'pct'],
    ['Roll Offset', 'rollOffset', -180, 180, 1, 'deg'],
    ['Center X',    'centerX',    -50, 50,  1, 'pct'],
    ['Center Y',    'centerY',    -50, 50,  1, 'pct'],
    ['Stretch X',   'stretchX',   40,  250, 1, 'pct'],
    ['Stretch Y',   'stretchY',   40,  250, 1, 'pct'],
    ['Strand Spread','strandSpread',20, 300, 1, 'pct'],
    ['Line Weight', 'lineWeight', 100, 600, 1, 'pct'],
    ['Line Opacity','lineOpacity',20,  200, 1, 'pct'],
    ['Depth Fade',  'depthFade',  0,   300, 1, 'pct'],
    ['Tip Fade',    'tipFade',    0,   100, 1, 'pct'],
    ['Dashes',      'dashes',     0,   60,  1, 'int'],
    ['Dash Duty',   'dashDuty',   10,  90,  1, 'pct'],
    ['Line Hue',    'lineHue',    0,   360, 1, 'deg'],
    ['Line Tint',   'lineTint',   0,   100, 1, 'pct'],
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
uniform float uSwayPitch;
uniform float uRollOff;
uniform vec2 uCenter;
uniform vec2 uStretch;
uniform float uStrandSpread;
uniform vec2 uOff;
out float vOpZ; out float vZ; out float vU;
#define PI 3.14159265
mat2 rot(float a){ return mat2(cos(a),-sin(a),sin(a),cos(a)); }
vec3 getP(vec2 idx, float sx){
  idx.y += idx.x*sx*(74.0*uTwist + sin(uTime*0.5)*50.0*uTwistSwing) + uTime*2.0;
  return vec3(sin(idx.x*sin(idx.y*0.5*uWave)) + cos(idx.y)*0.5*uLoop, cos(idx.y) + cos(idx.x)*uArch, sin(idx.y)*uDepthWave);
}
vec3 transformPt(vec3 p){
  p.xz *= rot(sin(uTime*0.2)*0.4*uSwayYaw);
  if(uSwayPitch != 0.0) p.yz *= rot(sin(uTime*0.45 + 1.3)*0.4*uSwayPitch);
  p.xy *= rot(sin(uTime*0.6)*0.4*uSwayRoll + 2.0 + uTime*0.2 + uRollOff);
  p.z += 1.5*uDistance + sin(uTime + sin(uTime))*0.5*uBreathe;
  p.xy /= p.z*3.0*uLens;
  p.xy += uCenter;
  return p;
}
void main(){
  float mul = PI, sx = mul/40.0;   // sx は形状係数(元の itersi=40 固定)。i を細分しても形状は不変
  vec2 idx = vec2(aIdx.x/uMIJ.x*uSpan, aIdx.y/uMIJ.y*uStrandSpread)*mul;
  vec3 op = getP(idx, sx);
  op.xy *= uStretch;
  vU = aIdx.x/uMIJ.x;
  vec3 p = transformPt(op);
  vOpZ = abs(op.z); vZ = p.z;
  if(p.z <= 0.02){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }   // 背面(z<=0)は画面外へ
  float aspect = uRes.x/uRes.y;
  gl_Position = vec4(p.x*2.0/aspect + uOff.x, p.y*2.0 + uOff.y, 0.0, 1.0);
}`;
    const fs = `#version 300 es
precision highp float;
in float vOpZ; in float vZ; in float vU;
uniform float uFade;
uniform float uOpacity, uDepthFade, uTipFade, uDashes, uDuty, uCopies;
uniform vec3 uColor;
out vec4 o;
void main(){
  if(vZ <= 0.0) discard;
  if(uDashes > 0.0 && fract(vU*uDashes) > uDuty) discard;
  float a = smoothstep(0.2*uFade, 1.0, vOpZ);   // 白ライン(alpha=|op.z| フェード)
  if(uOpacity != 1.0) a = clamp(a*uOpacity, 0.0, 1.0);
  if(uDepthFade != 0.0) a *= exp(-uDepthFade*1.2*max(vZ - 0.5, 0.0));
  if(uTipFade > 0.0) a *= smoothstep(0.0, uTipFade, vU) * smoothstep(0.0, uTipFade, 1.0 - vU);
  if(uCopies > 1.0) a = 1.0 - pow(1.0 - a, 1.0/uCopies);
  o = vec4(uColor, a);
}`;
    const p = gl.createProgram();
    gl.attachShader(p, this._compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this._compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aIdx');
    gl.linkProgram(p);
    if(!__glReady(gl, p, true)) console.error('Ribbon link:', gl.getProgramInfoLog(p));
    this.prog = p;
    this.loc = {};
    for(const n of ['uTime','uRes','uMIJ','uSpan','uTwist','uTwistSwing','uWave','uLoop','uArch','uDepthWave','uSwayYaw','uSwayRoll','uDistance','uBreathe','uLens','uFade','uSwayPitch','uRollOff','uCenter','uStretch','uStrandSpread','uOff','uOpacity','uDepthFade','uTipFade','uDashes','uDuty','uCopies','uColor'])
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
    gl.uniform1f(this.loc.uSwayPitch, pc('swayPitch'));
    gl.uniform1f(this.loc.uRollOff, dz(P.rollOffset) * Math.PI / 180);
    gl.uniform2f(this.loc.uCenter, dz(P.centerX) / 100, dz(P.centerY) / 100);
    gl.uniform2f(this.loc.uStretch, Math.max(0.05, pc('stretchX')), Math.max(0.05, pc('stretchY')));
    gl.uniform1f(this.loc.uStrandSpread, Math.max(0.05, pc('strandSpread')));
    gl.uniform1f(this.loc.uOpacity, Math.max(0.05, pc('lineOpacity')));
    gl.uniform1f(this.loc.uDepthFade, pc('depthFade'));
    gl.uniform1f(this.loc.uTipFade, 0.5 * Math.min(1, pc('tipFade')));
    gl.uniform1f(this.loc.uDashes, Math.round(dz(P.dashes)));
    gl.uniform1f(this.loc.uDuty, Math.min(0.95, Math.max(0.05, pc('dashDuty'))));
    // 線の色: 白 → 色相 hue の純色へ lineTint (%) だけ寄せる
    const tint = Math.min(1, pc('lineTint')), hh = ((dz(P.lineHue) % 360) + 360) % 360 / 60;
    const hc = [0, 4, 2].map(o => Math.min(1, Math.max(0, Math.abs(((hh + o) % 6) - 3) - 1)));
    gl.uniform3f(this.loc.uColor, 1 + (hc[0] - 1) * tint, 1 + (hc[1] - 1) * tint, 1 + (hc[2] - 1) * tint);
    // 太さ: 1px 超は中心 + 周囲 6 方向へずらして描き重ねる (濃さは重なり分を補正)
    const wt = Math.max(1, pc('lineWeight')), copies = wt > 1.001 ? 7 : 1;
    gl.uniform1f(this.loc.uCopies, copies);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const r = (wt - 1) * 0.5;
    for(let c = 0; c < copies; c++){
      const ang = (c - 1) * Math.PI / 3;
      gl.uniform2f(this.loc.uOff, c === 0 ? 0 : 2 * r * Math.cos(ang) / w, c === 0 ? 0 : 2 * r * Math.sin(ang) / h);
      gl.drawArrays(gl.LINES, 0, nJ * this.MI * 2);
    }
    gl.disableVertexAttribArray(0);
    gl.disable(gl.BLEND);
  }
};
Ribbon.PDefaults = JSON.parse(JSON.stringify(Ribbon.P));   // 既定値はスクリプト読込時に確定 (state 復元より先)
