'use strict';
/* 3D FX: cubes — 画面を「長辺に沿った直方体 (断面 = 短辺の正方形)」にし、長辺方向に N 本へ輪切りにして、
   各本が長辺の軸まわりに 90° ずつ回る (Fx3d.EXTRA.cubes)。契約は fx3d.js の EXTRA のコメント参照。
   断面が短辺と同じなので、回っている途中も画面の短辺方向は埋まったまま。側面 4 面はどれもその本の範囲の絵で、
   回り終わって前に来た面は正立した同じ絵 = 拍の切り目で絵が跳ねない。k = 0 で回転 0・正面カメラ = 元画面と画素一致。
   面は細かく分割してある (折り系を物体へ掛けたとき、折り線が面の中で曲がるように)。 */
(function(){
const SX = 8, SY = 8, SC = 4;                       // 側面の分割 (長辺 × 短辺方向) / 端面の分割
const PER = 4 * SX * SY * 6 + 2 * SC * SC * 6;      // 1 本あたりの頂点数
// 直方体の表面: 本 seg・面 face (0..3 = 側面 / 4, 5 = 端面) の面内座標 ab (0..1) → 位置。uvo = 貼る絵の uv
const SURF = `
uniform float uAsp, uN, uK, uSel, uBeat, uBeatMode, uT, uHit, uGap;
float h1(float p){ return fract(sin(p * 127.1 + 311.7) * 43758.5453); }
float easeOut(float x){ float y = 1.0 - x; return 1.0 - y * y * y; }
vec2 rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(v.x * c - v.y * s, v.x * s + v.y * c); }
vec3 cubeSurf(int seg, int face, vec2 ab, out vec2 uvo){
  bool land = uAsp >= 1.0;
  float Lh = land ? uAsp : 1.0, Sh = land ? 1.0 : uAsp;   // 長辺・短辺の半分 (紙座標)
  float fi = float(seg);
  float L0 = -Lh + 2.0 * Lh * fi / uN, L1 = -Lh + 2.0 * Lh * (fi + 1.0) / uN;
  float Lc = 0.5 * (L0 + L1), Lw = 0.5 * (L1 - L0) * uGap;
  float L; vec2 sz;                                   // sz = 断面内の位置 (S, z) (軸からの相対)
  vec2 img;                                           // この点に貼る絵の紙座標 (L, S)
  if(face < 4){
    L = Lc + (ab.x * 2.0 - 1.0) * Lw;
    vec2 front = vec2(-Sh + 2.0 * Sh * ab.y, Sh);
    sz = rot(front, -1.5707963 * float(face));        // 面 f は前面を -f×90° 回した位置 (+f×90° 回すと前で正立)
    img = vec2(mix(L0, L1, ab.x), front.x);
  } else {
    L = face == 4 ? Lc - Lw : Lc + Lw;                // 端面: 断面の正方形。絵はその本の範囲を正方形へ縮めて貼る
    sz = vec2(-Sh + 2.0 * Sh * ab.x, -Sh + 2.0 * Sh * ab.y);
    img = vec2(mix(L0, L1, ab.y), sz.x);
  }
  // 回転: beat = 拍ごとに選ばれた本が 90° 回る (向きは拍で揃え、3 割は逆。起点の本から遅れて波のように伝わる)
  //       drone = 長辺方向へ流れる波で順に回り続ける
  float tt, bid, delay;
  if(uBeatMode > 0.5){
    bid = floor(uBeat); tt = fract(uBeat);
    float org = floor(h1(bid * 3.7) * uN);
    delay = 0.35 * abs(fi - org) / max(uN, 1.0);
  } else {
    float ph = uT * 0.32 - fi / max(uN, 1.0) * 0.6;
    bid = floor(ph); tt = fract(ph); delay = 0.0;
  }
  float sel = step(h1(fi * 1.31 + bid * 7.7), uSel);
  float pr = easeOut(clamp((tt - delay) / 0.55, 0.0, 1.0)) * sel;
  float sgn = (h1(bid * 5.3) < 0.5 ? 1.0 : -1.0) * (h1(fi * 2.9 + bid * 1.7) < 0.3 ? -1.0 : 1.0);
  sz = rot(sz, 1.5707963 * pr * sgn);
  // 回っている本は少し手前へ (端面の陰が見える) + ヒットで押し出し
  float push = (0.18 * sin(3.14159265 * pr) + 0.12 * uHit) * uK * Sh;
  vec3 P3 = vec3(L, sz.x, sz.y - Sh + push);         // 軸は z = -Sh (前面が z = 0)
  vec2 im = land ? img : img.yx;
  uvo = im / (2.0 * vec2(uAsp, 1.0)) + 0.5;
  return land ? P3 : vec3(P3.y, P3.x, P3.z);
}
`;
const VS = `#version 300 es
precision highp float;
uniform mat4 uView, uProj;
out vec2 vUv; out vec3 vW;
${SURF}
void main(){
  int id = gl_VertexID, seg = id / ${PER}, r = id - seg * ${PER};
  // 面と面内の座標 (a = 長辺方向 0..1, b = 面の上方向 0..1)
  int face, tv, cell, nx;
  if(r < 4 * ${SX * SY * 6}){ face = r / ${SX * SY * 6}; int q = r - face * ${SX * SY * 6}; cell = q / 6; tv = q - cell * 6; nx = ${SX}; }
  else { int q = r - 4 * ${SX * SY * 6}; face = 4 + q / ${SC * SC * 6}; q -= (face - 4) * ${SC * SC * 6}; cell = q / 6; tv = q - cell * 6; nx = ${SC}; }
  vec2 ab = (tv == 0 || tv == 3) ? vec2(0.0, 0.0) : (tv == 1) ? vec2(1.0, 0.0) : (tv == 2 || tv == 4) ? vec2(1.0, 1.0) : vec2(0.0, 1.0);
  int cy = cell / nx, cx = cell - cy * nx;
  ab = (vec2(float(cx), float(cy)) + ab) / float(nx);
  vec3 P = cubeSurf(seg, face, ab, vUv);
  vec2 uvd;
  vec3 ctr = 0.5 * (cubeSurf(seg, 0, vec2(0.5), uvd) + cubeSurf(seg, 2, vec2(0.5), uvd));   // 本の中心
  P = ctr + (P - ctr) * fx3dPop(float(seg));   // ポップ: 本ごとに中心から
  vW = P;
  gl_Position = fx3dApply(uProj * uView * vec4(P, 1.0));
}`;
// 面を覆う針 (Needle): 各面を GL.needleCellGLSL の針の面 (三角形・四角形の角錐) で覆い、面の法線方向へ突起 / 凹み。元の面の代わりに描く
const NV_VS = `#version 300 es
precision highp float;
uniform mat4 uView, uProj;
uniform vec2 uNvGrid;
uniform float uNvSub, uNvCaps;
out vec2 vUv; out vec3 vW;
${SURF}
void main(){
  int per = (int(uNvGrid.x) + 2) * (int(uNvGrid.y) + 2) * 18 * int(uNvSub) * int(uNvSub);
  int fq = gl_VertexID / per, vid = gl_VertexID - fq * per;
  int seg, face;
  if(uNvCaps > 0.5){ seg = fq / 2; face = 4 + fq - seg * 2; } else { seg = fq / 4; face = fq - seg * 4; }
  vec2 ab; float w; vec2 key;
  fx3dNeedleVert(vid, uNvGrid, uNvSub, vec2(float(fq) * 5.3 + uNvCaps * 91.0, 1.7), ab, w, key);
  const float E = 1e-3;
  vec2 uv0, uvd;
  vec3 P0 = cubeSurf(seg, face, ab, uv0);
  vec3 T = (cubeSurf(seg, face, ab + vec2(E, 0.0), uvd) - P0) / E;
  vec3 B = (cubeSurf(seg, face, ab + vec2(0.0, E), uvd) - P0) / E;
  vec3 N = normalize(cross(T, B));
  vec3 ctr = 0.5 * (cubeSurf(seg, 0, vec2(0.5), uvd) + cubeSurf(seg, 2, vec2(0.5), uvd));   // 本の中心 (向かい合う面の中点)
  if(dot(N, P0 - ctr) < 0.0) N = -N;                                                      // 外向きに揃える
  float cell = 0.5 * (length(T) / uNvGrid.x + length(B) / uNvGrid.y);                     // 格子 1 つぶんの長さ
  vec3 P = P0 + N * (w * fx3dNeedleH(key, uv0 * vec2(uAsp, 1.0) * 3.2) * cell);
  P = ctr + (P - ctr) * fx3dPop(float(seg));   // ポップ: 本ごとに中心から
  vUv = uv0;
  vW = P;
  gl_Position = fx3dApply(uProj * uView * vec4(P, 1.0));
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vW;
uniform sampler2D uTex; uniform vec3 uEye; uniform float uShade;
out vec4 frag;
${Fx3d.GLSL_LIT}
void main(){
  vec4 t0 = texture(uTex, clamp(vUv, 0.0, 1.0));
  if(t0.a < 0.5) discard;   // 前の段 (3D FX) が抜いた背景は描かない = 前の段の物体だけがこの段に乗る
  frag = vec4(fx3dFoldShade(fx3dLit(t0.rgb, vW, uEye, uShade)), 1.0);
}`;
const U = {};
function uloc(gl, p, n){ const m = U[n] || (U[n] = new WeakMap()); let l = m.get(p); if(l === undefined){ l = gl.getUniformLocation(p, n); m.set(p, l); } return l; }
const ss = (a, b, x)=>{ const y = Math.max(0, Math.min(1, (x - a) / (b - a))); return y * y * (3 - 2 * y); };

Fx3d.EXTRA.cubes = {
  foldHook: true,
  spikes: true,
  render(gl, o){
    const pr = Fx3d.prog(gl, 'cubes', VS, FS);
    if(!pr) return false;
    const post = o.post || {};
    const N = Fx3d.popCount('cubes', Math.max(1, Math.min(16, Math.round(+post.fx3dCubesGrid || 1))), false);   // 本数を変えると区切りが全部変わる = 全部縮んでから出直す
    const asp = o.asp, k = o.k, t = o.clock || 0;
    // カメラは軽く振るだけ (断面が短辺 = 画面を満たしたまま回るのを見せる)
    const cam = Fx3d.camera(asp, 0.16 * k * Math.sin(0.19 * t), 0.10 * k * Math.sin(0.13 * t + 1), 1.35 - 0.08 * k);
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
      gl.uniform1f(uloc(gl, pr, 'uN'), N);
      gl.uniform1f(uloc(gl, pr, 'uK'), k);
      gl.uniform1f(uloc(gl, pr, 'uSel'), ss(0.15, 0.7, k));   // 回る本の割合 (全開で全部)
      gl.uniform1f(uloc(gl, pr, 'uBeat'), o.beat || 0);
      gl.uniform1f(uloc(gl, pr, 'uBeatMode'), o.beatMode ? 1 : 0);
      gl.uniform1f(uloc(gl, pr, 'uT'), t);
      gl.uniform1f(uloc(gl, pr, 'uHit'), o.hit || 0);
      gl.uniform1f(uloc(gl, pr, 'uGap'), 1 - 0.06 * ss(0.1, 0.6, k));   // 本と本の隙間 (端面がのぞく)
      gl.uniform1f(uloc(gl, pr, 'uShade'), Fx3d.shade(k));
      Fx3d.popUniforms(gl, pr, 'cubes');
      Fx3d.fold(gl, pr, cam.proj, 1.35);   // 最後の段なら折りを物体へ (それ以外は uFx3dOn = 0)
    };
    const nvp = Fx3d.spikeFrame ? Fx3d.prog(gl, 'cubesNeedle', NV_VS, FS) : null;
    if(nvp){
      // Needle: 6 面とも針の面で描く (元の面は描かない = 凹みが面に隠れない)。側面は短辺方向 14 (重ねたときの紙と同じ間隔)、端面は 14 × 14
      const land = asp >= 1, Lh = land ? asp : 1, Sh = land ? 1 : asp;
      const gy = 14, gx = Math.max(1, Math.round((Lh / N) / (Sh / gy))), sub = Fx3d.foldFrame ? 3 : 2;
      setU(nvp);
      gl.uniform1f(uloc(gl, nvp, 'uShade'), 1);
      gl.uniform1f(uloc(gl, nvp, 'uNvSub'), sub);
      Fx3d.spikeUniforms(gl, nvp);
      gl.uniform2f(uloc(gl, nvp, 'uNvGrid'), gx, gy);
      gl.uniform1f(uloc(gl, nvp, 'uNvCaps'), 0);
      gl.drawArrays(gl.TRIANGLES, 0, N * 4 * GL.needleCellVerts(gx, gy, sub));
      gl.uniform2f(uloc(gl, nvp, 'uNvGrid'), gy, gy);
      gl.uniform1f(uloc(gl, nvp, 'uNvCaps'), 1);
      gl.drawArrays(gl.TRIANGLES, 0, N * 2 * GL.needleCellVerts(gy, gy, sub));
    } else {
      setU(pr);
      gl.drawArrays(gl.TRIANGLES, 0, N * PER);
    }
    gl.bindVertexArray(null);
    Fx3d.resolve(gl, o.fbo, o.w, o.h);
    return true;
  },
};
})();
