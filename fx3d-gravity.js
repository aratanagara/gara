'use strict';
/* 3D FX: gravity — 画面の布に重力井戸が 3 つ開き、絵が渦を巻きながら吸い込まれる (Fx3d.EXTRA.gravity)。
   契約は fx3d.js の EXTRA のコメント参照。k = 0 で深さ 0・ねじれ 0・正面カメラ = 元画面と画素一致。
   井戸は画面を 長辺 3 × 短辺 2 に分けた区画へ 1 つずつ置く (深い井戸 / 浅い井戸 / 盛り上がる丘) = 画面全体に構成が散る。
   変形は量に対して早く立ち上がり (少し上げただけで平面でなくなる)、布全体も大きくうねる = 平らな板に見える所を残さない。
   beat は拍ごとに配置の入れ替えへ Ease Out、drone はゆっくり漂う。カメラは斜めから覗き、
   布は画面の外まで余白を持たせて (絵はミラー) 引き込みでも縁が見えないようにする。
   ねじれは井戸の中心ほど大きい有界の角度 (時間で巻き続けない = 絵が千切れない)。 */
(function(){
const COLS = 288, ROWS = 180, MARGIN = 3.0, NW = 6;
const VS = `#version 300 es
precision highp float;
uniform mat4 uView, uProj;
uniform float uAsp, uK, uSpin, uHit, uT, uMargin;
uniform vec2 uC[${NW}];
uniform float uW[${NW}];   // 井戸ごとの深さ (負 = 井戸 / 正 = 丘)
uniform float uR[${NW}];   // 井戸ごとの広がり
out vec2 vUv; out vec3 vW; out float vDeep;
void main(){
  int id = gl_VertexID, quad = id / 6, tv = id - quad * 6;
  int iy = quad / ${COLS}, ix = quad - iy * ${COLS};
  vec2 ab = (tv == 0 || tv == 3) ? vec2(0.0, 0.0) : (tv == 1) ? vec2(1.0, 0.0) : (tv == 2 || tv == 4) ? vec2(1.0, 1.0) : vec2(0.0, 1.0);
  vec2 g = (vec2(float(ix), float(iy)) + ab) / vec2(${COLS}.0, ${ROWS}.0);
  vec2 uv = 0.5 + (g - 0.5) * uMargin;                         // 余白ぶん画面の外まで
  vec2 q = (uv - 0.5) * 2.0 * vec2(uAsp, 1.0);
  vec2 off = vec2(0.0); float z = 0.0, deep = 0.0;
  float kq = 1.0 - (1.0 - uK) * (1.0 - uK) * (1.0 - uK);   // 早く立ち上がる量 (0 → 0 / 少しで大きく)
  for(int i = 0; i < ${NW}; i++){
    vec2 d = q - uC[i];
    float r2 = dot(d, d), r0 = uR[i];
    float f = r0 * r0 / (r2 + r0 * r0);                         // 中心 1 → 遠方 0
    float w = uW[i];
    float ang = kq * uSpin * (2.6 + 1.4 * sin(uT * 0.4 + float(i) * 2.1)) * f * sign(-w) * min(1.0, abs(w));
    float cs = cos(ang), sn = sin(ang);
    vec2 d2 = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs) * (1.0 - 0.38 * kq * f * step(w, 0.0));
    off += d2 - d;
    float fw = pow(r0 * r0 * 0.75 / (r2 + r0 * r0 * 0.75), 0.55);   // 裾の広い漏斗 (中心 1 → 遠方 0)
    z += w * kq * (1.0 + 0.6 * uHit) * fw;
    deep = min(deep, w * fw);
  }
  // 布全体のうねり (大きな波 2 つ。井戸の間も平らにしない)
  z += kq * (0.42 * sin(q.x * 1.25 + uT * 0.45) * cos(q.y * 1.05 - uT * 0.33) + 0.24 * sin(q.x * 0.6 - q.y * 1.9 + uT * 0.27));
  vec3 P = vec3(q + off, z);
  vUv = uv; vW = P; vDeep = deep;
  gl_Position = fx3dApply(uProj * uView * vec4(P, 1.0));
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vW; in float vDeep;
uniform sampler2D uTex; uniform vec3 uEye; uniform float uShade;
out vec4 frag;
${Fx3d.GLSL_LIT}
void main(){
  vec2 u = 1.0 - abs(1.0 - mod(vUv, 2.0));                     // 余白はミラー
  vec4 t0 = texture(uTex, u);
  if(t0.a < 0.5) discard;   // 前の段 (3D FX) が抜いた背景は描かない = 前の段の物体だけがこの段に乗る
  vec3 col = fx3dLit(t0.rgb, vW, uEye, uShade);
  col *= mix(1.0, mix(0.2, 1.0, smoothstep(-2.4, -0.6, vDeep)), uShade);   // 喉の奥を暗く
  frag = vec4(fx3dFoldShade(col), 1.0);
}`;
const U = {};
function uloc(gl, p, n){ const m = U[n] || (U[n] = new WeakMap()); let l = m.get(p); if(l === undefined){ l = gl.getUniformLocation(p, n); m.set(p, l); } return l; }
const h1 = (n, s)=>{ const x = Math.sin(n * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
const easeOut = (x)=>{ const y = 1 - Math.max(0, Math.min(1, x)); return 1 - y * y * y; };

// 拍 m の配置: 長辺を 3 区画に分け、区画の並びを拍ごとに入れ替えて主 (深い井戸) / 副 (浅い井戸) / 丘を置く
function layout(m, asp){
  const land = asp >= 1, Lh = land ? asp : 1, Sh = land ? 1 : asp;
  const perm = [[0,1,2],[1,2,0],[2,0,1],[0,2,1],[1,0,2],[2,1,0]][Math.floor(h1(m, 9.7) * 6) % 6];
  // 区画 = 長辺 3 × 短辺 2。区画の並びは拍で入れ替わる (perm は長辺方向、短辺の上下は拍ごとに反転)
  const C = [], W = [-3.0, -1.8, 1.3, -2.4, -1.2, 0.9], R = [0.46, 0.34, 0.38, 0.40, 0.30, 0.34];
  const flip = h1(m, 2.2) < 0.5;
  for(let i = 0; i < NW; i++){
    const cell = perm[i % 3], row = (Math.floor(i / 3) === 0) !== flip ? -1 : 1;
    const L = (-1 + (cell + 0.5) * 2 / 3 + (h1(m, 3.1 + i) * 2 - 1) * 0.2) * Lh;
    const S = (row * 0.5 + (h1(m, 5.9 + i) * 2 - 1) * 0.22) * Sh;
    C.push(land ? [L, S] : [S, L]);
  }
  return { C, W, R };
}

Fx3d.EXTRA.gravity = {
  foldHook: true,
  render(gl, o){
    const pr = Fx3d.prog(gl, 'gravity', VS, FS);
    if(!pr) return false;
    const post = o.post || {};
    const spin = Math.max(0, Math.min(1, o.dz(+post.fx3dGravitySpin)));
    const asp = o.asp, k = o.k, t = o.clock || 0;
    // beat = 拍ごとの配置へ Ease Out / drone = 0.25 拍/秒相当でゆっくり移り変わる
    const b = o.beatMode ? (o.beat || 0) : t * 0.25;
    const n = Math.floor(b), e = o.beatMode ? easeOut((b - n) / 0.6) : (b - n) * (b - n) * (3 - 2 * (b - n));
    const A = layout(n - 1, asp), B = layout(n, asp);
    const C = [], W = [], R = [];
    for(let i = 0; i < NW; i++){
      C.push(A.C[i][0] + (B.C[i][0] - A.C[i][0]) * e, A.C[i][1] + (B.C[i][1] - A.C[i][1]) * e);
      W.push(A.W[i] + (B.W[i] - A.W[i]) * e); R.push(A.R[i] + (B.R[i] - A.R[i]) * e);
    }
    // 斜めから覗く (奥行きが読める)。余白が広いので傾けても縁は画面に入らない
    const kq = 1 - Math.pow(1 - k, 3);
    const cam = Fx3d.camera(asp, 0.26 * kq * Math.sin(0.2 * t), -0.22 * kq + 0.08 * kq * Math.sin(0.17 * t), 1.35 - 0.12 * kq);
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
    gl.uniform1f(uloc(gl, pr, 'uK'), k);
    gl.uniform1f(uloc(gl, pr, 'uSpin'), spin);
    gl.uniform1f(uloc(gl, pr, 'uHit'), o.hit || 0);
    gl.uniform1f(uloc(gl, pr, 'uT'), t);
    gl.uniform1f(uloc(gl, pr, 'uMargin'), Fx3d.foldFrame ? 1 : MARGIN);   // 折りを掛けるときは紙と同じ大きさ (余白まで折ると手前へ飛び出す)
    gl.uniform2fv(uloc(gl, pr, 'uC'), C);
    gl.uniform1fv(uloc(gl, pr, 'uW'), W);
    gl.uniform1fv(uloc(gl, pr, 'uR'), R);
    gl.uniform1f(uloc(gl, pr, 'uShade'), Fx3d.shade(k));
    Fx3d.fold(gl, pr, cam.proj, 1.35);   // 最後の段なら折りを物体へ (それ以外は uFx3dOn = 0)
    gl.drawArrays(gl.TRIANGLES, 0, COLS * ROWS * 6);
    gl.bindVertexArray(null);
    Fx3d.resolve(gl, o.fbo, o.w, o.h);
    return true;
  },
};
})();
