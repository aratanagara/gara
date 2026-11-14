'use strict';
/* 3D FX: cubes — 画面を立方体の壁に割り、拍ごとに何個かが手前へ飛び出して 90° 回る (Fx3d.EXTRA.cubes)。
   契約は fx3d.js の EXTRA のコメント参照。k = 0 で厚み 0・回転 0・正面カメラ = 元画面と画素一致。
   立方体の 6 面は同じ絵 (セルの範囲)。回り終わった面は回転前の前面と同じ向きで正立するので、拍の切り目で絵が跳ねない。 */
(function(){
const VS = `#version 300 es
precision highp float;
uniform mat4 uView, uProj;
uniform float uAsp, uCols, uRows, uK, uSel, uBeat, uBeatMode, uT, uHit, uDepthK, uGap;
out vec2 vUv; out vec3 vW;
float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float easeOut(float x){ float y = 1.0 - x; return 1.0 - y * y * y; }
void main(){
  int id = gl_VertexID, cell = id / 36, vi = id - cell * 36;
  int face = vi / 6, tv = vi - face * 6;
  int icols = int(uCols);
  int cy = cell / icols, cx = cell - cy * icols;
  vec2 ab = (tv == 0 || tv == 3) ? vec2(0.0, 0.0) : (tv == 1) ? vec2(1.0, 0.0) : (tv == 2 || tv == 4) ? vec2(1.0, 1.0) : vec2(0.0, 1.0);
  vec3 p3;
  if(face == 0) p3 = vec3(ab.x - 0.5, ab.y - 0.5, 0.5);
  else if(face == 1) p3 = vec3(0.5 - ab.x, ab.y - 0.5, -0.5);
  else if(face == 2) p3 = vec3(ab.x - 0.5, 0.5, 0.5 - ab.y);
  else if(face == 3) p3 = vec3(ab.x - 0.5, -0.5, ab.y - 0.5);
  else if(face == 4) p3 = vec3(-0.5, ab.y - 0.5, ab.x - 0.5);
  else p3 = vec3(0.5, ab.y - 0.5, 0.5 - ab.x);
  float s = 2.0 * uAsp / uCols;
  vec2 cell2 = vec2(float(cx), float(cy));
  vec2 c = (cell2 + 0.5) * s - vec2(uAsp, uRows * s * 0.5);
  float tt, bid;
  float delay = 0.0;
  if(uBeatMode > 0.5){
    bid = floor(uBeat); tt = fract(uBeat);
    vec2 org = (vec2(h1(vec2(bid, 1.7)), h1(vec2(bid, 5.3))) * 2.0 - 1.0) * vec2(uAsp, 1.0);
    delay = 0.4 * clamp(length(c - org) / (2.0 * uAsp), 0.0, 1.0);
  } else {
    float ph = uT * 0.4 + h1(cell2 + 9.1);
    bid = floor(ph); tt = fract(ph);
  }
  float sel = step(h1(cell2 + bid * 7.7), uSel);
  float pr = easeOut(clamp((tt - delay) / 0.55, 0.0, 1.0)) * sel;
  float hv = h1(cell2 * 1.3 + bid * 3.1 + 0.5);
  float sgn = hv < 0.5 ? 1.0 : -1.0;
  float axisY = step(0.5, fract(hv * 7.31));
  float ang = 1.5707963 * pr * sgn;
  float cs = cos(ang), sn = sin(ang);
  float D = s * uDepthK;
  vec3 P = p3 * vec3(s, s, D) * uGap;
  vec3 Pr = axisY > 0.5 ? vec3(P.x * cs + P.z * sn, P.y, -P.x * sn + P.z * cs)
                        : vec3(P.x, P.y * cs - P.z * sn, P.y * sn + P.z * cs);
  Pr.z -= 0.5 * D * uGap;
  Pr.z += s * 0.75 * sin(3.14159265 * pr) + uHit * 0.15 * uK * s;
  Pr.xy += c;
  // 面の絵: どの面もセルの範囲 (回転して前に来たとき正立する向き)。ab は面内の絵の座標 (p3 の割り当てと対応)
  vec2 pab = face == 1 ? vec2(1.0 - ab.x, ab.y) : ab;   // 裏面は位置どおり (k = 0 で前面と同じ位置・同じ絵になる)
  vec2 paper = c + (pab - 0.5) * s;
  vUv = paper / (2.0 * vec2(uAsp, 1.0)) + 0.5;
  vW = Pr;
  gl_Position = uProj * uView * vec4(Pr, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vW;
uniform sampler2D uTex; uniform vec3 uEye; uniform float uShade;
out vec4 frag;
${Fx3d.GLSL_LIT}
void main(){
  vec2 u = 1.0 - abs(1.0 - mod(vUv, 2.0));
  vec3 col = texture(uTex, u).rgb;
  frag = vec4(fx3dLit(col, vW, uEye, uShade), 1.0);
}`;
const U = {};
function uloc(gl, p, n){ const m = U[n] || (U[n] = new WeakMap()); let l = m.get(p); if(l === undefined){ l = gl.getUniformLocation(p, n); m.set(p, l); } return l; }

Fx3d.EXTRA.cubes = {
  useMsaa: true,
  render(gl, o){
    const pr = Fx3d.prog(gl, 'cubes', VS, FS);
    if(!pr) return false;
    const post = o.post || {};
    const cols = Math.max(1, Math.min(16, Math.round(+post.fx3dCubesGrid || 6)));
    const asp = o.asp, k = o.k;
    const rows = Math.ceil(cols / asp);
    const t = o.clock || 0;
    const cam = Fx3d.camera(asp, 0.5 * k * Math.sin(0.21 * t), 0.3 * k * Math.sin(0.17 * t + 1), 1.35 + 0.9 * k);
    const ss = (a, b, x)=>{ const y = Math.max(0, Math.min(1, (x - a) / (b - a))); return y * y * (3 - 2 * y); };
    let target = o.fbo, M = null;
    if(this.useMsaa){ M = Fx3d.msaa(gl, o.w, o.h); target = M.fbo; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, o.w, o.h);
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(pr);
    if(!GL._emptyVAO) GL._emptyVAO = gl.createVertexArray();
    gl.bindVertexArray(GL._emptyVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, o.srcTex);
    gl.uniform1i(uloc(gl, pr, 'uTex'), 0);
    gl.uniformMatrix4fv(uloc(gl, pr, 'uView'), false, cam.view);
    gl.uniformMatrix4fv(uloc(gl, pr, 'uProj'), false, cam.proj);
    gl.uniform3fv(uloc(gl, pr, 'uEye'), cam.eye);
    gl.uniform1f(uloc(gl, pr, 'uAsp'), asp);
    gl.uniform1f(uloc(gl, pr, 'uCols'), cols);
    gl.uniform1f(uloc(gl, pr, 'uRows'), rows);
    gl.uniform1f(uloc(gl, pr, 'uK'), k);
    gl.uniform1f(uloc(gl, pr, 'uSel'), 0.85 * ss(0.25, 0.7, k));
    gl.uniform1f(uloc(gl, pr, 'uBeat'), o.beat || 0);
    gl.uniform1f(uloc(gl, pr, 'uBeatMode'), o.beatMode ? 1 : 0);
    gl.uniform1f(uloc(gl, pr, 'uT'), t);
    gl.uniform1f(uloc(gl, pr, 'uHit'), o.hit || 0);
    gl.uniform1f(uloc(gl, pr, 'uDepthK'), ss(0, 0.25, k));
    gl.uniform1f(uloc(gl, pr, 'uGap'), 1 - 0.10 * k);
    gl.uniform1f(uloc(gl, pr, 'uShade'), Fx3d.shade(k));
    gl.drawArrays(gl.TRIANGLES, 0, cols * rows * 36);
    gl.bindVertexArray(null);
    if(M) Fx3d.resolve(gl, o.fbo, o.w, o.h);
    return true;
  },
};
})();
