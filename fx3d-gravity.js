'use strict';
/* 3D FX: gravity — 画面の布がブラックホール (台風の目) に吸い込まれる (Fx3d.EXTRA.gravity)。
   契約は fx3d.js の EXTRA のコメント参照。k = 0 で深さ 0・ねじれ 0・めくれ 0・正面カメラ = 元画面と画素一致。
   主の井戸 = 1/r の深い漏斗 (喉の奥は暗い) + 中心ほど強い渦巻きのねじれ (有界の角度でゆっくり呼吸 = 絵が千切れない)。
   副の井戸 5 つは主の周りを公転する (降着円盤の破片)。拍ごとに布の一部がページのようにめくれて裏返り、拍の終わりに戻る。
   変形は量に対して早く立ち上がり (少し上げただけで平面でなくなる)、布全体も大きくうねる。
   布は画面の外まで余白を持たせ (絵はミラー)、引き込み・めくれでも縁が見えないようにする。 */
(function(){
const COLS = 288, ROWS = 180, MARGIN = 3.0, NW = 6;
// 布の形: 格子座標 g (0..1, 余白込み) → 位置。uv = 絵の座標 (余白はミラー前)、deep = 喉の深さ (陰影)
const SURF = `
uniform mat4 uView, uProj;
uniform float uAsp, uK, uSpin, uHit, uT, uMargin;
uniform vec2 uC[${NW}];
uniform float uW[${NW}];   // 井戸ごとの深さ (負 = 井戸 / 正 = 丘)
uniform float uR[${NW}];   // 井戸ごとの広がり
uniform vec2 uFD;          // めくれの線の向き (単位)
uniform float uFS, uFT, uFR;   // めくれの線の位置 / 返す角度 (π = 裏返し) / 巻きの半径
vec3 gSurf(vec2 g, out vec2 uv, out float deep){
  uv = 0.5 + (g - 0.5) * uMargin;                              // 余白ぶん画面の外まで
  vec2 q = (uv - 0.5) * 2.0 * vec2(uAsp, 1.0);
  vec2 off = vec2(0.0); float z = 0.0; deep = 0.0;
  float kq = 1.0 - (1.0 - uK) * (1.0 - uK) * (1.0 - uK);   // 早く立ち上がる量 (0 → 0 / 少しで大きく)
  for(int i = 0; i < ${NW}; i++){
    vec2 d = q - uC[i];
    float r2 = dot(d, d), r0 = uR[i];
    float f = r0 * r0 / (r2 + r0 * r0);                         // 中心 1 → 遠方 0
    float w = uW[i];
    // 渦: 中心ほど強いねじれ (主の井戸は最大 1 周強)。丘は逆向きに弱く
    float sw = i == 0 ? 1.0 : 0.45;
    float ang = kq * mix(0.45, 1.0, uSpin) * sw * (5.5 + 2.0 * sin(uT * 0.35 + float(i) * 2.1)) * pow(f, 0.8) * sign(-w) * min(1.0, abs(w));
    float cs = cos(ang), sn = sin(ang);
    vec2 d2 = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs) * (1.0 - 0.5 * kq * f * step(w, 0.0));   // 井戸へ引き込む
    off += d2 - d;
    float rr = sqrt(r2);
    float fw = i == 0 ? r0 / (rr + r0) : pow(r0 * r0 * 0.75 / (r2 + r0 * r0 * 0.75), 0.55);   // 主 = 1/r の深い喉 / 副 = 裾の広い漏斗
    z += w * kq * (1.0 + 0.6 * uHit) * fw;
    deep = min(deep, w * fw);
  }
  // 布全体のうねり (大きな波 2 つ。井戸の間も平らにしない)
  z += kq * (0.42 * sin(q.x * 1.25 + uT * 0.45) * cos(q.y * 1.05 - uT * 0.33) + 0.24 * sin(q.x * 0.6 - q.y * 1.9 + uT * 0.27));
  vec3 P = vec3(q + off, z);
  // めくれ: 線 (向き uFD, 位置 uFS) より先の布を半径 uFR の筒に巻いて角度 uFT まで返し、その先は平らに折り返す (ページをめくる形)
  if(uFT > 0.001){
    float u = dot(P.xy, uFD) - uFS;
    if(u > 0.0){
      vec2 nv = vec2(-uFD.y, uFD.x);
      float v = dot(P.xy, nv), arc = uFR * uFT, a, x, zz;
      if(u < arc){ a = u / uFR; x = uFR * sin(a); zz = uFR * (1.0 - cos(a)); }
      else { a = uFT; float rest = u - arc; x = uFR * sin(a) + rest * cos(a); zz = uFR * (1.0 - cos(a)) + rest * sin(a); }
      x -= P.z * sin(a); zz += P.z * cos(a);   // 井戸の深さも布の向きごと回す
      P = vec3(uFD * (uFS + x) + nv * v, zz);
    }
  }
  return P;
}
`;
const VS = `#version 300 es
precision highp float;
${SURF}
out vec2 vUv; out vec3 vW; out float vDeep;
void main(){
  int id = gl_VertexID, quad = id / 6, tv = id - quad * 6;
  int iy = quad / ${COLS}, ix = quad - iy * ${COLS};
  vec2 ab = (tv == 0 || tv == 3) ? vec2(0.0, 0.0) : (tv == 1) ? vec2(1.0, 0.0) : (tv == 2 || tv == 4) ? vec2(1.0, 1.0) : vec2(0.0, 1.0);
  vec2 g = (vec2(float(ix), float(iy)) + ab) / vec2(${COLS}.0, ${ROWS}.0);
  vec2 uv; float deep;
  vec3 P = gSurf(g, uv, deep);
  P *= fx3dPop(0.0);   // ポップ: 布ごと中心から
  vUv = uv; vW = P; vDeep = deep;
  gl_Position = fx3dApply(uProj * uView * vec4(P, 1.0));
}`;
// Needle (最後に掛かる): 布を GL.needleCellGLSL の針の面で覆い、布の法線方向へ突起 / 凹み。元の布の代わりに描く
const NV_VS = `#version 300 es
precision highp float;
${SURF}
uniform vec2 uNvGrid;
uniform float uNvSub;
uniform vec3 uEye;
out vec2 vUv; out vec3 vW; out float vDeep;
void main(){
  vec2 g; float w; vec2 key;
  fx3dNeedleVert(gl_VertexID, uNvGrid, uNvSub, vec2(3.3, 7.1), g, w, key);
  const float E = 1e-3;
  vec2 uv, uvd; float deep, dd;
  vec3 P0 = gSurf(g, uv, deep);
  vec3 T = (gSurf(g + vec2(E, 0.0), uvd, dd) - P0) / E;
  vec3 B = (gSurf(g + vec2(0.0, E), uvd, dd) - P0) / E;
  vec3 N = normalize(cross(T, B));
  float cell = min(0.5 * (length(T) / uNvGrid.x + length(B) / uNvGrid.y), 2.0 / 14.0);   // 引き伸ばされた所 (カメラの近く) でも針は大きくしない
  cell *= clamp((length(uEye - P0) - 0.25) / 1.1, 0.12, 1.0);   // カメラのすぐ近くの針は短く (遠近で画面を塞がない)
  vec3 P = P0 + N * (w * fx3dNeedleH(key, (uv - 0.5) * vec2(uAsp, 1.0) * 3.2) * cell);
  P *= fx3dPop(0.0);
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

// 拍 m の配置: 主の井戸は画面の中ほど (拍で少し移る)、副の 5 つは主の周りを公転する (t で回り続ける。外ほどゆっくり)
function layout(m, asp, t){
  const land = asp >= 1, Lh = land ? asp : 1, Sh = land ? 1 : asp;
  const C = [], W = [-5.2, -1.6, -1.2, 1.1, -0.9, 0.8], R = [0.55, 0.28, 0.24, 0.30, 0.22, 0.26];
  const c0 = [(h1(m, 3.1) * 2 - 1) * 0.35 * Lh, (h1(m, 5.9) * 2 - 1) * 0.25 * Sh];
  C.push(c0);
  const dir = h1(m, 8.8) < 0.5 ? 1 : -1;
  for(let i = 1; i < NW; i++){
    const r = (0.7 + 0.18 * i + 0.25 * h1(m, 2.3 + i)) * Sh;
    const a = h1(i, 7.7) * 6.2832 + h1(m, 4.4 + i) * 1.2 + dir * t * 0.55 / r;
    C.push([c0[0] + Math.cos(a) * r * (land ? 1.4 : 1), c0[1] + Math.sin(a) * r * (land ? 1 : 1.4)]);
  }
  return { C, W, R };
}

Fx3d.EXTRA.gravity = {
  foldHook: true,
  spikes: true,
  render(gl, o){
    const pr = Fx3d.prog(gl, 'gravity', VS, FS);
    if(!pr) return false;
    const post = o.post || {};
    const spin = Math.max(0, Math.min(1, o.dz(+post.fx3dGravitySpin)));
    const asp = o.asp, k = o.k, t = o.clock || 0;
    // beat = 拍ごとの配置へ Ease Out / drone = 0.25 拍/秒相当でゆっくり移り変わる
    const b = o.beatMode ? (o.beat || 0) : t * 0.25;
    const n = Math.floor(b), e = o.beatMode ? easeOut((b - n) / 0.6) : (b - n) * (b - n) * (3 - 2 * (b - n));
    const A = layout(n - 1, asp, t), B = layout(n, asp, t);
    const C = [], W = [], R = [];
    for(let i = 0; i < NW; i++){
      C.push(A.C[i][0] + (B.C[i][0] - A.C[i][0]) * e, A.C[i][1] + (B.C[i][1] - A.C[i][1]) * e);
      W.push(A.W[i] + (B.W[i] - A.W[i]) * e); R.push(A.R[i] + (B.R[i] - A.R[i]) * e);
    }
    // めくれ: 拍ごとに線の向き・位置・返す角度を選び、拍の前半で返して後半で戻す (拍頭は 0 = 線が変わっても跳ねない)
    const kq = 1 - Math.pow(1 - k, 3);
    // 途中の角度 (直角付近) は布が壁のように立つので短く通り過ぎ、裏返しきって重なった形で止まる
    const ph = b - n, env = easeOut(ph / 0.26) * (1 - (x=>x * x * (3 - 2 * x))(Math.max(0, Math.min(1, (ph - 0.74) / 0.26))));
    const fa = h1(n, 6.1) * 6.2832, fsd = (0.35 + 0.55 * h1(n, 7.3)) * (asp >= 1 ? 1 : asp);   // 線は中心から外寄り = 画面の端の側がめくれ返る
    const ft = Math.PI * Math.min(1, kq * 1.6) * env;
    // 斜めから覗く (奥行きが読める)。余白が広いので傾けても縁は画面に入らない
    const cam = Fx3d.camera(asp, 0.26 * kq * Math.sin(0.2 * t), -0.22 * kq + 0.08 * kq * Math.sin(0.17 * t), 1.35 - 0.12 * kq);
    const M = Fx3d.msaa(gl, o.w, o.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, M.fbo);
    gl.viewport(0, 0, o.w, o.h);
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const setU = (pr)=>{
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
      gl.uniform2f(uloc(gl, pr, 'uFD'), Math.cos(fa), Math.sin(fa));
      gl.uniform1f(uloc(gl, pr, 'uFS'), fsd);
      gl.uniform1f(uloc(gl, pr, 'uFT'), ft);
      gl.uniform1f(uloc(gl, pr, 'uFR'), 0.18);   // 小さい巻き = 裏返った布は元の布のすぐ上に重なる (カメラの前を塞がない)
      gl.uniform1f(uloc(gl, pr, 'uShade'), Fx3d.shade(k));
      Fx3d.popUniforms(gl, pr, 'gravity');
      Fx3d.fold(gl, pr, cam.proj, 1.35);   // 最後の段なら折りを物体へ (それ以外は uFx3dOn = 0)
    };
    const nvp = Fx3d.spikeFrame ? Fx3d.prog(gl, 'gravityNeedle', NV_VS, FS) : null;
    if(nvp){
      // Needle: 布を針の面で覆う (重ねたときの紙と同じ間隔 = 画面の高さを 14 分割。布は余白ぶん大きい)
      const m = Fx3d.foldFrame ? 1 : MARGIN, gy = Math.round(14 * m), gx = Math.round(14 * m * asp);
      setU(nvp);
      gl.uniform2f(uloc(gl, nvp, 'uNvGrid'), gx, gy);
      gl.uniform1f(uloc(gl, nvp, 'uNvSub'), 1);
      Fx3d.spikeUniforms(gl, nvp);
      gl.drawArrays(gl.TRIANGLES, 0, GL.needleCellVerts(gx, gy, 1));
    } else {
      setU(pr);
      gl.drawArrays(gl.TRIANGLES, 0, COLS * ROWS * 6);
    }
    gl.bindVertexArray(null);
    Fx3d.resolve(gl, o.fbo, o.w, o.h);
    return true;
  },
};
})();
