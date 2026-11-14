'use strict';
/* 3D FX: gravity — 画面の布の中央が沈んで漏斗になり、絵が渦を巻きながら吸い込まれる (Fx3d.EXTRA.gravity)。
   契約は fx3d.js の EXTRA のコメント参照。k = 0 で深さ 0・ねじれ 0・正面カメラ = 元画面と画素一致。
   ねじれは井戸の中心ほど大きい有界の角度 (時間で巻き続けない = 絵が千切れない)。 */
(function(){
const COLS = 128, ROWS = 72;
const VS = `#version 300 es
precision highp float;
uniform mat4 uView, uProj;
uniform float uAsp, uK, uSpin, uHit, uT;
uniform vec2 uC;
out vec2 vUv; out vec3 vW;
void main(){
  int id = gl_VertexID, quad = id / 6, tv = id - quad * 6;
  int iy = quad / ${COLS}, ix = quad - iy * ${COLS};
  vec2 ab = (tv == 0 || tv == 3) ? vec2(0.0, 0.0) : (tv == 1) ? vec2(1.0, 0.0) : (tv == 2 || tv == 4) ? vec2(1.0, 1.0) : vec2(0.0, 1.0);
  vec2 uv = (vec2(float(ix), float(iy)) + ab) / vec2(${COLS}.0, ${ROWS}.0);
  vec2 q = (uv - 0.5) * 2.0 * vec2(uAsp, 1.0);
  vec2 d = q - uC;
  float r2 = dot(d, d), r0 = 0.35;
  float f = r0 * r0 / (r2 + r0 * r0);                          // 中心 1 → 遠方 0
  float ang = uK * uSpin * (2.5 + 1.5 * sin(uT * 0.4)) * f;
  float cs = cos(ang), sn = sin(ang);
  vec2 d2 = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs) * (1.0 - 0.35 * uK * f);
  float fw = pow(0.09 / (r2 + 0.09), 0.55);                    // 深さは裾の広い漏斗 (中心 1 → 遠方 0)
  vec3 P = vec3(q + (d2 - d), -3.6 * uK * (1.0 + 0.5 * uHit) * fw);
  vUv = uv; vW = P;
  gl_Position = uProj * uView * vec4(P, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vW;
uniform sampler2D uTex; uniform vec3 uEye; uniform float uShade, uK;
out vec4 frag;
${Fx3d.GLSL_LIT}
void main(){
  vec3 col = fx3dLit(texture(uTex, vUv).rgb, vW, uEye, uShade);
  float deep = smoothstep(-3.6, -1.2, vW.z / max(uK, 1e-3));   // 喉の奥を暗く (出始めは Shade と同じ立ち上がり)
  col *= mix(1.0, mix(0.15, 1.0, deep), uShade);
  frag = vec4(col, 1.0);
}`;
const U = {};
function uloc(gl, p, n){ const m = U[n] || (U[n] = new WeakMap()); let l = m.get(p); if(l === undefined){ l = gl.getUniformLocation(p, n); m.set(p, l); } return l; }
const h1 = (n, s)=>{ const x = Math.sin(n * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
const easeOut = (x)=>{ const y = 1 - Math.max(0, Math.min(1, x)); return 1 - y * y * y; };

Fx3d.EXTRA.gravity = {
  render(gl, o){
    const pr = Fx3d.prog(gl, 'gravity', VS, FS);
    if(!pr) return false;
    const post = o.post || {};
    const spin = Math.max(0, Math.min(1, o.dz(+post.fx3dGravitySpin)));
    const asp = o.asp, k = o.k, t = o.clock || 0;
    // 井戸の中心: drone は ±0.3 の範囲をゆっくり漂う / beat は拍ごとに乱数位置へ Ease Out で移る
    let cx, cy;
    if(o.beatMode){
      const b = o.beat || 0, n = Math.floor(b), e = easeOut(b - n);
      const pt = (m)=>[(h1(m, 1.3) * 2 - 1) * 0.3 * asp, (h1(m, 7.1) * 2 - 1) * 0.3];
      const a = pt(n - 1), c = pt(n);
      cx = a[0] + (c[0] - a[0]) * e; cy = a[1] + (c[1] - a[1]) * e;
    } else { cx = 0.3 * asp * Math.sin(0.23 * t); cy = 0.3 * Math.sin(0.31 * t + 1); }
    const cam = Fx3d.camera(asp, 0.6 * k * Math.sin(0.2 * t), -1.05 * k, 1.35 + 0.9 * k);
    const M = Fx3d.msaa(gl, o.w, o.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, M.fbo);
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
    gl.uniform1f(uloc(gl, pr, 'uK'), k);
    gl.uniform1f(uloc(gl, pr, 'uSpin'), spin);
    gl.uniform1f(uloc(gl, pr, 'uHit'), o.hit || 0);
    gl.uniform1f(uloc(gl, pr, 'uT'), t);
    gl.uniform2f(uloc(gl, pr, 'uC'), cx, cy);
    gl.uniform1f(uloc(gl, pr, 'uShade'), Fx3d.shade(k));
    gl.drawArrays(gl.TRIANGLES, 0, COLS * ROWS * 6);
    gl.bindVertexArray(null);
    Fx3d.resolve(gl, o.fbo, o.w, o.h);
    return true;
  },
};
})();
