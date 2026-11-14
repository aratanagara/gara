'use strict';
/* 3D FX: globe — 画面が左右から巻かれて筒になり、上下が閉じて球になって回る。Detail を下げると面が角張り、ミラーボールになる (Fx3d.EXTRA.globe)。
   契約は fx3d.js の EXTRA のコメント参照。k = 0 で曲率 0 の平面・正面カメラ = 元画面と画素一致。
   平面 → 球を直接混ぜると面が交差するので、まず曲げ (交差しない) で筒にし、そこから球へ混ぜる。 */
(function(){
const VS = `#version 300 es
precision highp float;
uniform mat4 uView, uProj;
uniform float uAsp, uCols, uRows, uK, uSpin, uHit;
out vec2 vUv; out vec3 vW, vN;
float ss(float a, float b, float x){ float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
void main(){
  int id = gl_VertexID, quad = id / 6, tv = id - quad * 6;
  int icols = int(uCols);
  int iy = quad / icols, ix = quad - iy * icols;
  vec2 ab = (tv == 0 || tv == 3) ? vec2(0.0, 0.0) : (tv == 1) ? vec2(1.0, 0.0) : (tv == 2 || tv == 4) ? vec2(1.0, 1.0) : vec2(0.0, 1.0);
  vec2 uv = (vec2(float(ix), float(iy)) + ab) / vec2(uCols, uRows);
  vec2 q = (uv - 0.5) * 2.0 * vec2(uAsp, 1.0);
  float m1 = ss(0.0, 0.55, uK), m2 = ss(0.35, 1.0, uK);
  float kap = m1 * 3.14159265 / uAsp;
  vec3 Pc = kap < 1e-5 ? vec3(q, 0.0) : vec3(sin(kap * q.x) / kap, q.y, (cos(kap * q.x) - 1.0) / kap);
  float R = uAsp / 3.14159265, lam = 3.14159265 * q.x / uAsp, phi = 1.5707963 * q.y;
  vec3 Ps = vec3(R * cos(phi) * sin(lam), R * sin(phi), R * cos(phi) * cos(lam) - R);
  vec3 Nc = kap < 1e-5 ? vec3(0.0, 0.0, 1.0) : vec3(sin(kap * q.x), 0.0, cos(kap * q.x));
  vec3 Ns = vec3(cos(phi) * sin(lam), sin(phi), cos(phi) * cos(lam));
  vec3 N = normalize(mix(Nc, Ns, m2));
  vec3 P = mix(Pc, Ps, m2);
  P.z += R * ss(0.3, 0.8, uK);
  float sp = uSpin * ss(0.5, 0.8, uK);
  float cs = cos(sp), sn = sin(sp);
  P.xz = vec2(P.x * cs + P.z * sn, -P.x * sn + P.z * cs);
  N.xz = vec2(N.x * cs + N.z * sn, -N.x * sn + N.z * cs);
  P *= mix(1.0, 1.6, m2) * (1.0 + 0.08 * uHit * uK);
  vUv = uv; vW = P; vN = N;
  gl_Position = uProj * uView * vec4(P, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vW, vN;
uniform sampler2D uTex; uniform vec3 uEye; uniform float uShade, uMirror, uFacet, uSeam;
out vec4 frag;
void main(){
  vec3 alb = texture(uTex, vUv).rgb;
  if(uSeam > 0.0){   // 画面の左右端が球の裏で合う継ぎ目: 端から uSeam の幅で反対側の絵と混ぜて、段差を消す
    float d = min(vUv.x, 1.0 - vUv.x);
    float w = 0.5 * (1.0 - smoothstep(0.0, uSeam, d));
    alb = mix(alb, texture(uTex, vec2(1.0 - vUv.x, vUv.y)).rgb, w);
  }
  vec3 Nf = normalize(cross(dFdx(vW), dFdy(vW)));
  vec3 V = normalize(uEye - vW);
  if(dot(Nf, V) < 0.0) Nf = -Nf;
  vec3 Ns = normalize(vN);
  if(dot(Ns, V) < 0.0) Ns = -Ns;
  vec3 N = normalize(mix(Ns, Nf, uFacet));   // Detail が高いほどなめらか、低いほど面が立つ
  vec3 L = normalize(vec3(2.4, 2.0, 3.0));
  float ndl = max(0.0, dot(N, L));
  vec3 light = vec3(0.50, 0.48, 0.46) * ndl + mix(vec3(0.60, 0.61, 0.64), vec3(0.72), N.y * 0.5 + 0.5);
  float spec = pow(max(0.0, dot(N, normalize(L + V))), 26.0);
  vec3 col = mix(alb, alb * light + vec3(spec * 0.10), uShade);
  col += vec3(pow(max(0.0, dot(reflect(-V, N), L)), 60.0) * uMirror);
  frag = vec4(col, 1.0);
}`;
const U = {};
function uloc(gl, p, n){ const m = U[n] || (U[n] = new WeakMap()); let l = m.get(p); if(l === undefined){ l = gl.getUniformLocation(p, n); m.set(p, l); } return l; }
const ss = (a, b, x)=>{ const y = Math.max(0, Math.min(1, (x - a) / (b - a))); return y * y * (3 - 2 * y); };

Fx3d.EXTRA.globe = {
  render(gl, o){
    const pr = Fx3d.prog(gl, 'globe', VS, FS);
    if(!pr) return false;
    const post = o.post || {};
    const detail = Math.max(6, Math.min(96, Math.round(+post.fx3dGlobeDetail || 64)));
    const rows = detail, cols = detail * 2;
    const asp = o.asp, k = o.k, t = o.clock || 0;
    const m2 = ss(0.35, 1.0, k);
    const cam = Fx3d.camera(asp, 0, 0.25 * k * Math.sin(0.2 * t), 1.35 + 0.85 * k);
    let spin;
    if(o.beatMode){ const b = o.beat || 0, f = b - Math.floor(b), y = 1 - f; spin = (Math.floor(b) + 1 - y * y * y) * Math.PI / 2; }
    else spin = 0.4 * t;
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
    gl.uniform1f(uloc(gl, pr, 'uCols'), cols);
    gl.uniform1f(uloc(gl, pr, 'uRows'), rows);
    gl.uniform1f(uloc(gl, pr, 'uK'), k);
    gl.uniform1f(uloc(gl, pr, 'uSpin'), spin);
    gl.uniform1f(uloc(gl, pr, 'uHit'), o.hit || 0);
    gl.uniform1f(uloc(gl, pr, 'uShade'), Fx3d.shade(k));
    gl.uniform1f(uloc(gl, pr, 'uSeam'), 0.1 * ss(0.4, 0.8, k));
    gl.uniform1f(uloc(gl, pr, 'uFacet'), 1 - ss(16, 56, detail));
    gl.uniform1f(uloc(gl, pr, 'uMirror'), m2 * (0.9 + (0.15 - 0.9) * detail / 96));
    gl.drawArrays(gl.TRIANGLES, 0, cols * rows * 6);
    gl.bindVertexArray(null);
    Fx3d.resolve(gl, o.fbo, o.w, o.h);
    return true;
  },
};
})();
