'use strict';
/* 3D FX: blinds — 画面が横長の帯 (スラット) に割れ、帯が自分の軸で回る。Twist で回転が長さ方向へ遅れて伝わり、らせんのリボンになる (Fx3d.EXTRA.blinds)。
   契約は fx3d.js の EXTRA のコメント参照。k = 0 で回転角 0・うねり 0・正面カメラ = 元画面と画素一致。
   beat は選ばれた帯が 0 → 180° 反転する。裏面は帯の中で v を反転した絵なので、180° で元の絵に戻り、拍の切り目で跳ねない。 */
(function(){
const SEG = 64;
const VS = `#version 300 es
precision highp float;
uniform mat4 uView, uProj;
uniform float uAsp, uN, uK, uTwist, uBeat, uBeatMode, uT, uHit;
out vec2 vUv; out vec3 vW, vN; out float vVc;
float h1(float p){ return fract(sin(p * 127.1 + 311.7) * 43758.5453); }
float easeOut(float x){ float y = 1.0 - x; return 1.0 - y * y * y; }
void main(){
  int id = gl_VertexID, slat = id / ${SEG * 6}, r = id - slat * ${SEG * 6};
  int seg = r / 6, tv = r - seg * 6;
  vec2 ab = (tv == 0 || tv == 3) ? vec2(0.0, 0.0) : (tv == 1) ? vec2(1.0, 0.0) : (tv == 2 || tv == 4) ? vec2(1.0, 1.0) : vec2(0.0, 1.0);
  float i = float(slat);
  float u = (float(seg) + ab.x) / ${SEG}.0;
  float local = ab.y * 2.0 - 1.0;
  float yc = (i + 0.5) / uN * 2.0 - 1.0, hh = 1.0 / uN;
  float th;
  if(uBeatMode > 0.5){
    float bid = floor(uBeat);
    float i0 = floor(h1(bid * 1.7) * uN);
    float d = 0.2 * u * uTwist + 0.25 * abs(i - i0) / uN;
    float sel = step(h1(i + bid * 3.1), uK);
    th = 3.14159265 * easeOut(clamp((fract(uBeat) - d) / 0.5, 0.0, 1.0)) * sel;
  } else {
    th = uK * 3.14159265 * sin(uT * (0.5 + 0.3 * h1(i)) + i * 0.6 + u * uTwist * 6.2831853);
  }
  float x = (u - 0.5) * 2.0 * uAsp;
  float hs = hh * (1.0 - 0.05 * uK);
  vec3 P = vec3(x, yc + local * hs * cos(th), local * hs * sin(th));
  P.z += uK * 0.22 * sin(u * 3.0 + uT * 0.7 + i * 0.4) * (1.0 + uHit);
  vUv = vec2(u, (yc + local * hh) * 0.5 + 0.5);
  vVc = yc * 0.5 + 0.5;
  vW = P;
  vN = vec3(0.0, -sin(th), cos(th));   // 帯の面の法線 (長さ方向のねじれは無視。三角形ごとの縞を避けるため頂点で渡す)
  gl_Position = uProj * uView * vec4(P, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vW, vN; in float vVc;
uniform sampler2D uTex; uniform vec3 uEye; uniform float uShade;
out vec4 frag;
void main(){
  vec2 uv = vUv;
  if(!gl_FrontFacing) uv.y = 2.0 * vVc - uv.y;   // 裏面は帯の中で上下反転 (反転しきった帯が元の絵に戻る)
  vec3 alb = texture(uTex, uv).rgb;
  vec3 V = normalize(uEye - vW);
  vec3 N = normalize(vN);
  if(dot(N, V) < 0.0) N = -N;
  vec3 L = normalize(vec3(2.4, 2.0, 3.0));
  vec3 light = vec3(0.50, 0.48, 0.46) * max(0.0, dot(N, L)) + mix(vec3(0.60, 0.61, 0.64), vec3(0.72), N.y * 0.5 + 0.5);
  float spec = pow(max(0.0, dot(N, normalize(L + V))), 26.0);
  frag = vec4(mix(alb, alb * light + vec3(spec * 0.10), uShade), 1.0);
}`;
const U = {};
function uloc(gl, p, n){ const m = U[n] || (U[n] = new WeakMap()); let l = m.get(p); if(l === undefined){ l = gl.getUniformLocation(p, n); m.set(p, l); } return l; }

Fx3d.EXTRA.blinds = {
  render(gl, o){
    const pr = Fx3d.prog(gl, 'blinds', VS, FS);
    if(!pr) return false;
    const post = o.post || {};
    const N = Math.max(2, Math.min(48, Math.round(+post.fx3dBlindsCount || 14)));
    const twist = Math.max(0, Math.min(1, o.dz(+post.fx3dBlindsTwist)));
    const asp = o.asp, k = o.k, t = o.clock || 0;
    const cam = Fx3d.camera(asp, 0.35 * k * Math.sin(0.2 * t), 0.25 * k * Math.sin(0.15 * t), 1.35 + 0.5 * k);
    const M = Fx3d.msaa(gl, o.w, o.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, M.fbo);
    gl.viewport(0, 0, o.w, o.h);
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
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
    gl.uniform1f(uloc(gl, pr, 'uN'), N);
    gl.uniform1f(uloc(gl, pr, 'uK'), k);
    gl.uniform1f(uloc(gl, pr, 'uTwist'), twist);
    gl.uniform1f(uloc(gl, pr, 'uBeat'), o.beat || 0);
    gl.uniform1f(uloc(gl, pr, 'uBeatMode'), o.beatMode ? 1 : 0);
    gl.uniform1f(uloc(gl, pr, 'uT'), t);
    gl.uniform1f(uloc(gl, pr, 'uHit'), o.hit || 0);
    gl.uniform1f(uloc(gl, pr, 'uShade'), Fx3d.shade(k));
    gl.drawArrays(gl.TRIANGLES, 0, N * SEG * 6);
    gl.bindVertexArray(null);
    Fx3d.resolve(gl, o.fbo, o.w, o.h);
    return true;
  },
};
})();
