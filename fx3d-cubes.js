'use strict';
/* 3D FX: cubes (表示名 Box) — 画面全体を 1 個の直方体にし、拍ごとに画面の X 軸か Y 軸まわりへ 90° 転がる (Fx3d.EXTRA.cubes)。
   契約は fx3d.js の EXTRA のコメント参照。前面 = 画面 (z = 0)、奥行きは縦横の相乗平均。6 面すべてに画面の絵を貼る。
   転がり終わって前に来た面は正立した同じ絵 = 拍の切り目で絵が跳ねない。
   beat = 拍ごとに軸 X / Y と向きを選んで転がる / drone = 流れる波の位相で転がり続ける。転がっている間は少し縮んで手前へ出る。
   (内部は格子の作り。uCg = 1 × 1 で描く)
   k = 0 で回転 0・正面カメラ = 元画面と画素一致。カメラは正面のまま振らない (傾けると画面の外が見えるため)。
   面は 32 × 32 に分割してある (折り系を物体へ掛けたとき折り線が面の中で曲がり、立体シェーダの深度で面を持ち上げたとき物体の形が出るように)。 */
(function(){
const SUB = 32;                                    // 1 面の分割 (SUB × SUB マス。立体シェーダの深度で面を持ち上げたとき、頂点が物体の形を拾える細かさ)
const FV = SUB * SUB * 6;                          // 1 面あたりの頂点数
const PER = 6 * FV;                                // 1 キューブあたりの頂点数
// キューブ cube (0 .. gx*gy-1) の面 face (0 前 / 1 奥 / 2 +x / 3 -x / 4 +y / 5 -y) の面内座標 ab (0..1) → 位置。uvo = 貼る絵の uv、ctr = キューブの中心
// 回転は単位立方体 (-1..1) の上で行い、そのあと (hx, hy, hz) へ伸ばす = マスが正方形でなくても 90° 転がると隙間なく前面に収まる
const SURF = `
uniform float uAsp, uK, uSel, uBeat, uBeatMode, uT, uHit, uGap;
uniform vec2 uCg;
float h1(float p){ return fract(sin(p * 127.1 + 311.7) * 43758.5453); }
float easeOut(float x){ float y = 1.0 - x; return 1.0 - y * y * y; }
vec3 cubeSurf(int cube, int face, vec2 ab, out vec2 uvo, out vec3 ctr){
  int gx = int(uCg.x);
  int cyi = cube / gx, cxi = cube - cyi * gx;
  vec2 cell = vec2(float(cxi), float(cyi));
  vec2 ex = vec2(uAsp, 1.0) * (1.0 + 2.0 * uOvM);   // 3D Overscan: 箱を素材の余白の分だけ大きく (前面の中央が画面。転がると画面の外の絵が見える)
  vec2 hs = ex / uCg;
  float hz = sqrt(hs.x * hs.y);
  vec2 cc = -ex + hs * (2.0 * cell + 1.0);
  float u = ab.x * 2.0 - 1.0, v = ab.y * 2.0 - 1.0;
  // 各面の向き: 90° 転がって前に来たとき u が右・v が上になる (+y 面 = X 軸 +90° / -y 面 = X 軸 -90° / -x 面 = Y 軸 +90° / +x 面 = Y 軸 -90°)
  vec3 p;
  if(face == 0) p = vec3(u, v, 1.0);
  else if(face == 1) p = vec3(-u, v, -1.0);
  else if(face == 2) p = vec3(1.0, v, -u);
  else if(face == 3) p = vec3(-1.0, v, u);
  else if(face == 4) p = vec3(u, 1.0, -v);
  else p = vec3(u, -1.0, v);
  uvo = (cc + vec2(u, v) * hs) / (2.0 * vec2(uAsp, 1.0)) + 0.5;
  // 回転: beat = 拍ごとに選ばれたキューブが 90° 転がる (起点のマスから遅れて波のように伝わる) / drone = 斜めへ流れる波で順に転がり続ける
  float fi = float(cube);
  float tt, bid, delay;
  if(uBeatMode > 0.5){
    bid = floor(uBeat); tt = fract(uBeat);
    vec2 org = floor(vec2(h1(bid * 3.7), h1(bid * 8.1 + 2.3)) * uCg);
    delay = 0.35 * length(cell - org) / length(uCg);
  } else {
    float ph = uT * 0.32 - (cell.x + cell.y) / (uCg.x + uCg.y) * 0.6;
    bid = floor(ph); tt = fract(ph); delay = 0.0;
  }
  float sel = step(h1(fi * 1.31 + bid * 7.7), uSel);
  float pr = easeOut(clamp((tt - delay) / 0.55, 0.0, 1.0)) * sel;
  bool axisY = h1(fi * 3.1 + bid * 2.3) < 0.5;
  float sgn = (h1(bid * 5.3) < 0.5 ? 1.0 : -1.0) * (h1(fi * 2.9 + bid * 1.7) < 0.3 ? -1.0 : 1.0);
  float ang = 1.5707963 * pr * sgn, c = cos(ang), s = sin(ang);
  vec3 q = axisY ? vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c) : vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
  // 転がっている間は縮んで手前へ (隣と刺さらない) + ヒットで押し出し
  float arc = sin(3.14159265 * pr);
  float sc = uGap * (1.0 - 0.29 * arc);
  float push = (0.25 * arc + 0.3 * uHit) * uK * hz;
  ctr = vec3(cc, -hz + push);                         // 前面が z = 0
  return ctr + q * vec3(hs, hz) * sc;
}
`;
const VS = `#version 300 es
precision highp float;
uniform mat4 uView, uProj;
out vec2 vUv; out vec3 vW; out vec3 vN;
${SURF}
// 面内座標 ab の点を、立体シェーダの深度で面の外向きへ持ち上げた位置 (面の法線は差分で求める)
vec3 liftSurf(int cube, int face, vec2 ab, out vec2 uvo, out vec3 ctr){
  vec3 P = cubeSurf(cube, face, ab, uvo, ctr);
  float rl = fx3dRelief(uvo);
  if(rl > 0.0){
    const float E = 1e-3;
    vec2 uvd; vec3 c2;
    vec3 N = normalize(cross(cubeSurf(cube, face, ab + vec2(E, 0.0), uvd, c2) - P, cubeSurf(cube, face, ab + vec2(0.0, E), uvd, c2) - P));
    if(dot(N, P - ctr) < 0.0) N = -N;
    P += N * rl;
  }
  return P;
}
void main(){
  int id = gl_VertexID, cube = id / ${PER}, r = id - cube * ${PER};
  int face = r / ${FV}, q = r - face * ${FV};
  int cell = q / 6, tv = q - cell * 6;
  vec2 ab = (tv == 0 || tv == 3) ? vec2(0.0, 0.0) : (tv == 1) ? vec2(1.0, 0.0) : (tv == 2 || tv == 4) ? vec2(1.0, 1.0) : vec2(0.0, 1.0);
  int cy = cell / ${SUB}, cx = cell - cy * ${SUB};
  ab = (vec2(float(cx), float(cy)) + ab) / float(${SUB});
  vec3 ctr;
  vec3 P = liftSurf(cube, face, ab, vUv, ctr);
  {   // 陰影の法線は、隣のマスの持ち上げた位置から頂点ごとに求める (三角形ごとに明るさが変わって網目に見えるのを防ぐ)
    const float D = 1.0 / float(${SUB});
    vec2 uvd; vec3 c2;
    vec3 N = cross(liftSurf(cube, face, ab + vec2(D, 0.0), uvd, c2) - liftSurf(cube, face, ab - vec2(D, 0.0), uvd, c2),
                   liftSurf(cube, face, ab + vec2(0.0, D), uvd, c2) - liftSurf(cube, face, ab - vec2(0.0, D), uvd, c2));
    vN = normalize(dot(N, P - ctr) < 0.0 ? -N : N);
  }
  P = ctr + (P - ctr) * fx3dPop(float(cube));   // ポップ: キューブごとに中心から
  vW = P;
  gl_Position = fx3dApply(uProj * uView * vec4(P, 1.0));
}`;
// 面を覆う針 (Needle): 各キューブの 6 面を GL.needleCellGLSL の針の面 (三角形・四角形の角錐) で覆い、キューブの外向きへ突起 / 凹み。元の面の代わりに描く
const NV_VS = `#version 300 es
precision highp float;
uniform mat4 uView, uProj;
uniform vec2 uNvGrid;
uniform float uNvSub;
out vec2 vUv; out vec3 vW; out vec3 vN;
${SURF}
void main(){
  int per = (int(uNvGrid.x) + 2) * (int(uNvGrid.y) + 2) * 18 * int(uNvSub) * int(uNvSub);
  int fq = gl_VertexID / per, vid = gl_VertexID - fq * per;
  int cube = fq / 6, face = fq - cube * 6;
  vec2 ab; float w; vec2 key;
  fx3dNeedleVert(vid, uNvGrid, uNvSub, vec2(float(fq) * 5.3, 1.7), ab, w, key);
  const float E = 1e-3;
  vec2 uv0, uvd;
  vec3 ctr, c2;
  vec3 P0 = cubeSurf(cube, face, ab, uv0, ctr);
  vec3 T = (cubeSurf(cube, face, ab + vec2(E, 0.0), uvd, c2) - P0) / E;
  vec3 B = (cubeSurf(cube, face, ab + vec2(0.0, E), uvd, c2) - P0) / E;
  vec3 N = normalize(cross(T, B));
  if(dot(N, P0 - ctr) < 0.0) N = -N;                                                      // キューブの中心から外向きに揃える
  P0 += N * fx3dRelief(uv0);
  float cl = 0.5 * (length(T) / uNvGrid.x + length(B) / uNvGrid.y);                       // 格子 1 つぶんの長さ
  vec3 P = P0 + N * (w * fx3dNeedleH(key, uv0 * vec2(uAsp, 1.0) * 3.2) * cl);
  P = ctr + (P - ctr) * fx3dPop(float(cube));   // ポップ: キューブごとに中心から
  vUv = uv0;
  vW = P;
  vN = vec3(0.0);   // 針の面は三角形ごとの陰影のまま (FS が差分の法線を使う)
  gl_Position = fx3dApply(uProj * uView * vec4(P, 1.0));
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vW; in vec3 vN;
uniform sampler2D uTex; uniform vec3 uEye; uniform float uShade;
out vec4 frag;
${Fx3d.GLSL_LIT}
void main(){
  vec4 t0 = texture(uTex, fx3dSrcC(vUv));
  if(t0.a < 0.5) discard;   // 前の段 (3D FX) が抜いた背景は描かない = 前の段の物体だけがこの段に乗る
  vec3 c = dot(vN, vN) > 0.25 ? fx3dLitN(t0.rgb, normalize(vN), vW, uEye, uShade) : fx3dLit(t0.rgb, vW, uEye, uShade);
  frag = vec4(fx3dFoldShade(c), 1.0);
}`;
const U = {};
function uloc(gl, p, n){ const m = U[n] || (U[n] = new WeakMap()); let l = m.get(p); if(l === undefined){ l = gl.getUniformLocation(p, n); m.set(p, l); } return l; }
const ss = (a, b, x)=>{ const y = Math.max(0, Math.min(1, (x - a) / (b - a))); return y * y * (3 - 2 * y); };

Fx3d.EXTRA.cubes = {
  ov: true,
  foldHook: true,
  spikes: true,
  render(gl, o){
    const pr = Fx3d.prog(gl, 'cubes', VS, FS);
    if(!pr) return false;
    const N = 1;   // 画面全体で 1 個の直方体
    const asp = o.asp, k = o.k, t = o.clock || 0;
    const gx = 1, gy = 1;
    const cubes = gx * gy;
    // カメラは正面のまま (傾けると画面の外が見える)
    const cam = Fx3d.camera(asp, 0, 0, 1.35 - 0.08 * k);
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
      gl.uniform2f(uloc(gl, pr, 'uCg'), gx, gy);
      gl.uniform1f(uloc(gl, pr, 'uK'), k);
      gl.uniform1f(uloc(gl, pr, 'uSel'), ss(0.15, 0.7, k));   // 転がるキューブの割合 (全開で全部)
      gl.uniform1f(uloc(gl, pr, 'uBeat'), o.beat || 0);
      gl.uniform1f(uloc(gl, pr, 'uBeatMode'), o.beatMode ? 1 : 0);
      gl.uniform1f(uloc(gl, pr, 'uT'), t);
      gl.uniform1f(uloc(gl, pr, 'uHit'), o.hit || 0);
      gl.uniform1f(uloc(gl, pr, 'uGap'), 1 - 0.04 * ss(0.1, 0.6, k));   // キューブ同士の隙間 (側面がのぞく)
      gl.uniform1f(uloc(gl, pr, 'uShade'), Fx3d.shade(k));
      Fx3d.popUniforms(gl, pr, 'cubes');
      Fx3d.ovUniforms(gl, pr, o);
      Fx3d.reliefUniforms(gl, pr, [1 / SUB, 1 / SUB]);   // 立体シェーダの深度で面を持ち上げる
      Fx3d.fold(gl, pr, cam.proj, 1.35);   // 最後の段なら折りを物体へ (それ以外は uFx3dOn = 0)
    };
    const nvp = Fx3d.spikeFrame ? Fx3d.prog(gl, 'cubesNeedle', NV_VS, FS) : null;
    if(nvp){
      // Needle: 全キューブの 6 面とも針の面で描く (元の面は描かない = 凹みが面に隠れない)。1 面の格子は max(2, round(14 / N))、頂点が多すぎるときは分割を粗くする
      const g = Math.max(2, Math.round(Fx3d.nvScale(14 / N)));
      let sub = Fx3d.foldFrame ? 3 : 2;
      while(sub > 1 && cubes * 6 * GL.needleCellVerts(g, g, sub) > 1500000) sub--;
      setU(nvp);
      gl.uniform1f(uloc(gl, nvp, 'uShade'), 1);
      gl.uniform1f(uloc(gl, nvp, 'uNvSub'), sub);
      Fx3d.spikeUniforms(gl, nvp);
      gl.uniform2f(uloc(gl, nvp, 'uNvGrid'), g, g);
      gl.drawArrays(gl.TRIANGLES, 0, cubes * 6 * GL.needleCellVerts(g, g, sub));
    } else {
      setU(pr);
      gl.drawArrays(gl.TRIANGLES, 0, cubes * PER);
    }
    gl.bindVertexArray(null);
    Fx3d.resolve(gl, o.fbo, o.w, o.h);
    return true;
  },
};
})();
