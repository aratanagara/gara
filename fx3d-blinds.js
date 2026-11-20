'use strict';
/* 3D FX: blinds — 画面が帯 (スラット) に割れ、拍ごとに帯が自分の軸で 180° 返る。Twist で返りが長さ方向へ遅れて伝わり、らせんのリボンになる (Fx3d.EXTRA.blinds)。
   契約は fx3d.js の EXTRA のコメント参照。k = 0 で回転角 0・正面カメラ = 元画面と画素一致。
   裏面は帯の中で反転した絵なので、180° 返りきると元の絵に戻る = 拍頭では全部の帯が平ら。
   その拍頭で 4 拍ごとに帯の向き (横 ↔ 縦) と幅の配分 (広い帯・細い帯) を入れ替えるので、絵は跳ねずに構成が変わる。
   返し方は拍ごとに 4 通り (起点からの波 / 一本おき / まばら / 中央から外へ)。drone は 0.5 拍/秒の仮想の拍で同じ動き。 */
(function(){
const SEG = 64, NMAX = 48;
// 帯の形: 帯 slat の面内座標 ab (x = 長さ方向 0..1, y = 幅方向 0..1) → 位置。uv = 絵の座標、Nn = 面の法線、vc = 帯の中心 (短辺方向 0..1)
const SURF = `
uniform mat4 uView, uProj;
uniform float uAsp, uN, uK, uTwist, uBeat, uHit, uVert, uPat, uOrg, uSgn, uSel;
uniform float uEdge[${NMAX + 1}];   // 帯の境界 (短辺方向 -1..1 の位置。拍の区切りでだけ変わる)
float h1(float p){ return fract(sin(p * 127.1 + 311.7) * 43758.5453); }
float easeOut(float x){ float y = 1.0 - x; return 1.0 - y * y * y; }
vec3 bSurf(int slat, vec2 ab, out vec2 uv, out vec3 Nn, out float vc, out vec3 Cs){
  float i = float(slat);
  float u = ab.x * (1.0 + 2.0 * uOvM.x) - uOvM.x;       // 帯の長さ方向 0..1 (3D Overscan: 素材の余白の分だけ画面の外まで伸ばす)
  float local = ab.y * 2.0 - 1.0;                       // 帯の幅方向 -1..1
  float e0 = uEdge[slat], e1 = uEdge[slat + 1];
  float yc = 0.5 * (e0 + e1), hh = 0.5 * (e1 - e0);     // 帯の中心と半幅 (短辺方向 -1..1)
  // 返す帯の選び方 (拍ごとのパターン)
  float sel, d;
  float rel = abs(i - uOrg) / uN;
  if(uPat < 0.5){ sel = 1.0; d = 0.35 * rel; }                                   // 起点から波
  else if(uPat < 1.5){ sel = mod(i + uOrg, 2.0); d = 0.1 * rel; }                // 一本おき
  else if(uPat < 2.5){ sel = step(h1(i + uOrg * 3.1), 0.6); d = 0.25 * h1(i * 1.7 + uOrg); }   // まばら
  else { sel = 1.0; d = 0.4 * (1.0 - abs((i + 0.5) / uN * 2.0 - 1.0)); d = 0.4 - d; }        // 中央から外へ
  sel *= step(h1(i * 2.3 + uOrg * 0.7), uSel);
  d += 0.2 * u * uTwist;
  float th = 3.14159265 * easeOut(clamp((fract(uBeat) - d) / 0.5, 0.0, 1.0)) * sel * uSgn;
  float x = (u - 0.5) * 2.0;                            // 長さ方向 -1..1
  float hs = hh * (1.0 - 0.04 * uK);
  vec3 P = vec3(x, yc + local * hs * cos(th), local * hs * sin(th));
  P.z += uK * (0.10 * sin(u * 3.0 + uBeat * 0.7 + i * 0.4) + 0.15 * uHit) * sin(abs(th));
  Nn = vec3(0.0, -sin(th), cos(th));
  float vy = (yc + local * hh) * 0.5 + 0.5;             // 絵の短辺方向 0..1
  // 横帯: 長さ = 画面の横 (x)、幅 = 縦 (y)。縦帯は入れ替え
  vec2 sc = vec2(uAsp, 1.0);
  if(uVert > 0.5){ P = vec3(P.y * sc.x, P.x * sc.y, P.z); Nn = vec3(Nn.y, Nn.x, Nn.z); uv = vec2(vy, u); }
  else { P = vec3(P.x * sc.x, P.y * sc.y, P.z); uv = vec2(u, vy); }
  Cs = uVert > 0.5 ? vec3(yc * sc.x, 0.0, 0.0) : vec3(0.0, yc * sc.y, 0.0);   // 帯の中心
  vc = yc * 0.5 + 0.5;
  return P;
}
`;
const VS = `#version 300 es
precision highp float;
${SURF}
out vec2 vUv; out vec3 vW, vN; out float vVc, vBack;
void main(){
  int id = gl_VertexID, slat = id / ${SEG * 6}, r = id - slat * ${SEG * 6};
  int seg = r / 6, tv = r - seg * 6;
  vec2 ab = (tv == 0 || tv == 3) ? vec2(0.0, 0.0) : (tv == 1) ? vec2(1.0, 0.0) : (tv == 2 || tv == 4) ? vec2(1.0, 1.0) : vec2(0.0, 1.0);
  vec3 Nn, Cs;
  vec3 P = bSurf(slat, vec2((float(seg) + ab.x) / ${SEG}.0, ab.y), vUv, Nn, vVc, Cs);
  P += Nn * fx3dRelief(vUv);   // 立体シェーダの深度で帯の面を持ち上げる
  P = Cs + (P - Cs) * fx3dPop(float(slat));   // ポップ: 帯ごとに中心から
  vW = P;
  vN = Nn;
  vBack = 0.0;
  gl_Position = fx3dApply(uProj * uView * vec4(P, 1.0));
}`;
// Needle (最後に掛かる): 帯を GL.needleCellGLSL の針の面で覆い、面の法線方向へ突起 / 凹み (表の突起は裏から見ると凹み)。元の帯の代わりに描く。
//   裏から見ている帯は絵を帯の中で反転する (元の帯の gl_FrontFacing の代わりに、土台の面の向きを vBack で渡す)
const NV_VS = `#version 300 es
precision highp float;
${SURF}
uniform vec3 uEye;
uniform vec2 uNvGrid;
uniform float uNvSub;
out vec2 vUv; out vec3 vW, vN; out float vVc, vBack;
void main(){
  int per = (int(uNvGrid.x) + 2) * (int(uNvGrid.y) + 2) * 18 * int(uNvSub) * int(uNvSub);
  int slat = gl_VertexID / per, vid = gl_VertexID - slat * per;
  vec2 ab; float w; vec2 key;
  fx3dNeedleVert(vid, uNvGrid, uNvSub, vec2(float(slat) * 4.7 + 1.3, 8.9), ab, w, key);
  const float E = 1e-3;
  vec3 Nn, Cs, Nd, Cd; vec2 uvd; float vcd;
  vec3 P0 = bSurf(slat, ab, vUv, Nn, vVc, Cs);
  vec3 T = (bSurf(slat, ab + vec2(E, 0.0), uvd, Nd, vcd, Cd) - P0) / E;
  vec3 B = (bSurf(slat, ab + vec2(0.0, E), uvd, Nd, vcd, Cd) - P0) / E;
  vec3 N = normalize(cross(T, B));
  if(dot(N, Nn) < 0.0) N = -N;
  P0 += N * fx3dRelief(vUv);
  float cell = 0.5 * (length(T) / uNvGrid.x + length(B) / uNvGrid.y);
  vec3 P = P0 + N * (w * fx3dNeedleH(key, (vUv - 0.5) * vec2(uAsp, 1.0) * 3.2) * cell);
  P = Cs + (P - Cs) * fx3dPop(float(slat));
  vBack = dot(Nn, uEye - P0) < 0.0 ? 1.0 : 0.0;
  vW = P;
  vN = N;
  gl_Position = fx3dApply(uProj * uView * vec4(P, 1.0));
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vW, vN; in float vVc, vBack;
uniform sampler2D uTex; uniform vec3 uEye; uniform float uShade, uVert, uNv;
out vec4 frag;
void main(){
  vec2 uv = vUv;
  bool back = uNv > 0.5 ? vBack > 0.5 : !gl_FrontFacing;
  if(back){ if(uVert > 0.5) uv.x = 2.0 * vVc - uv.x; else uv.y = 2.0 * vVc - uv.y; }   // 裏面は帯の中で反転 (返りきった帯が元の絵に戻る)
  vec4 t0 = texture(uTex, fx3dSrcC(uv));
  if(t0.a < 0.5) discard;   // 前の段 (3D FX) が抜いた背景は描かない = 前の段の物体だけがこの段に乗る
  vec3 alb = t0.rgb;
  vec3 V = normalize(uEye - vW);
  vec3 N = uNv > 0.5 ? normalize(cross(dFdx(vW), dFdy(vW))) : normalize(vN);   // 針の面は面法線 (角を立てる)
  if(dot(N, V) < 0.0) N = -N;
  vec3 L = normalize(vec3(2.4, 2.0, 3.0));
  vec3 light = vec3(0.50, 0.48, 0.46) * max(0.0, dot(N, L)) + mix(vec3(0.60, 0.61, 0.64), vec3(0.72), N.y * 0.5 + 0.5);
  float spec = pow(max(0.0, dot(N, normalize(L + V))), 26.0);
  frag = vec4(fx3dFoldShade(mix(alb, alb * light + vec3(spec * 0.10), uShade)), 1.0);
}`;
const U = {};
function uloc(gl, p, n){ const m = U[n] || (U[n] = new WeakMap()); let l = m.get(p); if(l === undefined){ l = gl.getUniformLocation(p, n); m.set(p, l); } return l; }
const h1 = (n, s)=>{ const x = Math.sin(n * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };

// 4 拍ごとの区画: 帯の向きと幅の配分 (広い帯と細い帯が混ざる。区画 0 は等幅 = 出始めは素直な帯)
function partition(ep, N){
  const E = new Float32Array(NMAX + 1);
  const w = [];
  let sum = 0;
  for(let i = 0; i < N; i++){ const v = ep === 0 ? 1 : Math.pow(2, (h1(ep * 13.1 + i, 2.3) * 2 - 1) * 1.6); w.push(v); sum += v; }
  let acc = 0;
  E[0] = -1;
  for(let i = 0; i < N; i++){ acc += w[i]; E[i + 1] = -1 + 2 * acc / sum; }
  for(let i = N + 1; i <= NMAX; i++) E[i] = 1;
  return E;
}

Fx3d.EXTRA.blinds = {
  ov: true,
  foldHook: true,
  spikes: true,
  render(gl, o){
    const pr = Fx3d.prog(gl, 'blinds', VS, FS);
    if(!pr) return false;
    const post = o.post || {};
    const N = Fx3d.popCount('blinds', Math.max(2, Math.min(NMAX, Math.round(+post.fx3dBlindsCount || 14))), false);   // 本数を変えると区切りが全部変わる = 全部縮んでから出直す
    const twist = Math.max(0, Math.min(1, o.dz(+post.fx3dBlindsTwist)));
    const asp = o.asp, k = o.k, t = o.clock || 0;
    const b = o.beatMode ? (o.beat || 0) : t * 0.5;
    const bid = Math.floor(b), ep = Math.floor(bid / 4);
    const vert = ep === 0 ? 0 : (h1(ep, 4.4) < 0.5 ? 1 : 0);
    const nUse = vert ? Math.max(2, Math.min(NMAX, Math.round(N * asp))) : N;   // 縦帯は本数を縦横比ぶん増やして帯の太さを揃える
    const key = ep + ':' + nUse;
    if(this._key !== key){ if(this._key != null && ep !== this._ep) Fx3d.popEpoch('blinds'); this._key = key; this._ep = ep; this._E = partition(ep, nUse); }   // 4 拍ごとの組み直しで帯が弾んで出直す
    const pat = Math.floor(h1(bid, 7.7) * 4);
    const org = Math.floor(h1(bid, 1.9) * nUse);
    const sgn = h1(bid, 5.5) < 0.5 ? 1 : -1;
    const cam = Fx3d.camera(asp, 0, 0, 1.35);
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
      gl.uniform1f(uloc(gl, pr, 'uN'), nUse);
      gl.uniform1f(uloc(gl, pr, 'uK'), k);
      gl.uniform1f(uloc(gl, pr, 'uTwist'), twist);
      gl.uniform1f(uloc(gl, pr, 'uBeat'), b);
      gl.uniform1f(uloc(gl, pr, 'uHit'), o.hit || 0);
      gl.uniform1f(uloc(gl, pr, 'uVert'), vert);
      gl.uniform1f(uloc(gl, pr, 'uPat'), pat);
      gl.uniform1f(uloc(gl, pr, 'uOrg'), org);
      gl.uniform1f(uloc(gl, pr, 'uSgn'), sgn);
      gl.uniform1f(uloc(gl, pr, 'uSel'), Math.min(1, k / 0.6));   // 返る帯の割合 (量で増える)
      gl.uniform1fv(uloc(gl, pr, 'uEdge'), this._E);
      gl.uniform1f(uloc(gl, pr, 'uShade'), Fx3d.shade(k));
      Fx3d.popUniforms(gl, pr, 'blinds');
      Fx3d.ovUniforms(gl, pr, o);
      Fx3d.reliefUniforms(gl, pr, [1 / SEG, 1 / nUse]);   // 立体シェーダの深度で面を持ち上げる
      Fx3d.fold(gl, pr, cam.proj, 1.35);   // 最後の段なら折りを物体へ (それ以外は uFx3dOn = 0)
    };
    const nvp = Fx3d.spikeFrame ? Fx3d.prog(gl, 'blindsNeedle', NV_VS, FS) : null;
    if(nvp){
      // Needle: 帯ごとに長さ方向は画面の高さを 14 分割した間隔、幅方向は 2
      const len = vert ? 2 : 2 * asp, gx = Math.max(2, Math.round(len / (2 / 14))), gy = 2;
      setU(nvp);
      gl.uniform1f(uloc(gl, nvp, 'uNv'), 1);
      gl.uniform2f(uloc(gl, nvp, 'uNvGrid'), gx, gy);
      gl.uniform1f(uloc(gl, nvp, 'uNvSub'), 1);
      Fx3d.spikeUniforms(gl, nvp);
      gl.drawArrays(gl.TRIANGLES, 0, nUse * GL.needleCellVerts(gx, gy, 1));
    } else {
      setU(pr);
      gl.uniform1f(uloc(gl, pr, 'uNv'), 0);
      gl.drawArrays(gl.TRIANGLES, 0, nUse * SEG * 6);
    }
    gl.bindVertexArray(null);
    Fx3d.resolve(gl, o.fbo, o.w, o.h);
    return true;
  },
};
})();
