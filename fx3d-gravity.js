'use strict';
/* 3D FX: gravity — 画面の布がブラックホール (台風の目) に吸い込まれる (Fx3d.EXTRA.gravity)。
   契約は fx3d.js の EXTRA のコメント参照。k = 0 で深さ 0・ねじれ 0・めくれ 0・正面カメラ = 元画面と画素一致。
   主の井戸 (喉) = 1/r の深い漏斗 (喉の奥は暗い) + 中心ほど強い渦巻きのねじれ (有界の角度でゆっくり呼吸 = 絵が千切れない)。
   喉の数は Gravity Points (1〜4、既定 2) で選ぶ。喉は画面に構図として散らし、渦の向きは喉ごとに交互にする。
   残りの井戸 (全 6 つのうち喉でないもの) は最寄りの喉の周りを公転する (降着円盤の破片)。拍ごとに布の一部がページのようにめくれて裏返り、拍の終わりに戻る。
   変形は量に対して早く立ち上がり (少し上げただけで平面でなくなる)、布全体も大きくうねる。
   布は画面の外まで余白を持たせ (絵はミラー)、引き込み・めくれでも縁が見えないようにする。 */
(function(){
const COLS = 288, ROWS = 180, MARGIN = 3.0, NW = 6;
// 重力の場: 位置 P (紙の座標 xy = q、z = 高さ) → 吸い込まれた位置。deep = 喉の深さ (陰影)。
//   Gravity 自身の布 (gSurf) と、Origami / Kaiser / Roll / Uzumaki のあとに掛ける統合パス (GL の foldStack) が共有する。
//   uniform は他のシェーダとぶつからないよう uG で始める (fieldUniforms が送る)
const FIELD = `
uniform float uGAsp, uGK, uGSpin, uGHit, uGT, uGDepth, uGWave;   // uGDepth / uGWave: Depth / Wave (1 = 標準)
uniform float uGDir;        // 渦の向き (+1 / -1。ランダムな周期で反転し、その間はなめらかに 0 を通る)
uniform vec2 uGC[${NW}];
uniform float uGW[${NW}];   // 井戸ごとの深さ (負 = 井戸 / 正 = 丘)
uniform float uGM[${NW}];   // 井戸ごとの喉度 (1 = 主の喉 / 0 = 副の井戸。拍の移り変わりで滑らかに入れ替わる)
uniform float uGR[${NW}];   // 井戸ごとの広がり
uniform vec2 uGFD;          // めくれの線の向き (単位)
uniform float uGFS, uGFT, uGFR;   // めくれの線の位置 / 返す角度 (π = 裏返し) / 巻きの半径
vec3 gField(vec3 P0, out float deep){
  vec2 q = P0.xy;
  vec2 off = vec2(0.0); float z = 0.0; deep = 0.0;
  float kq = 1.0 - (1.0 - uGK) * (1.0 - uGK) * (1.0 - uGK);   // 早く立ち上がる量 (0 → 0 / 少しで大きく)
  for(int i = 0; i < ${NW}; i++){
    vec2 d = q - uGC[i];
    float r2 = dot(d, d), r0 = uGR[i];
    float f = r0 * r0 / (r2 + r0 * r0);                         // 中心 1 → 遠方 0
    float w = uGW[i];
    // 渦: 中心ほど強いねじれ (主の井戸は最大 1 周強)。丘は逆向きに弱く
    float th = uGM[i];
    float sw = mix(0.45, 1.0, th);
    float alt = mix(1.0, (i - 2 * (i / 2)) == 0 ? 1.0 : -1.0, th);   // 喉は渦の向きを交互に
    float ang = kq * mix(0.45, 1.0, uGSpin) * sw * alt * uGDir * (5.5 + 2.0 * sin(uGT * 0.35 + float(i) * 2.1)) * pow(f, 0.8) * sign(-w) * min(1.0, abs(w));
    float cs = cos(ang), sn = sin(ang);
    vec2 d2 = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs) * (1.0 - 0.5 * kq * f * step(w, 0.0));   // 井戸へ引き込む
    off += d2 - d;
    float rr = sqrt(r2);
    float fw = mix(pow(r0 * r0 * 0.75 / (r2 + r0 * r0 * 0.75), 0.55), r0 / (rr + r0), th);   // 主 = 1/r の深い喉 / 副 = 裾の広い漏斗
    z += w * kq * uGDepth * (1.0 + 0.6 * uGHit) * fw;
    deep = min(deep, w * fw);
  }
  // 布全体のうねり (大きな波 2 つ。井戸の間も平らにしない)
  z += kq * uGWave * (0.42 * sin(q.x * 1.25 + uGT * 0.45) * cos(q.y * 1.05 - uGT * 0.33) + 0.24 * sin(q.x * 0.6 - q.y * 1.9 + uGT * 0.27));
  vec3 P = vec3(q + off, P0.z + z);
  // めくれ: 線 (向き uGFD, 位置 uGFS) より先の布を半径 uGFR の筒に巻いて角度 uGFT まで返し、その先は平らに折り返す (ページをめくる形)
  if(uGFT > 0.001){
    float u = dot(P.xy, uGFD) - uGFS;
    if(u > 0.0){
      vec2 nv = vec2(-uGFD.y, uGFD.x);
      float v = dot(P.xy, nv), arc = uGFR * uGFT, a, x, zz;
      if(u < arc){ a = u / uGFR; x = uGFR * sin(a); zz = uGFR * (1.0 - cos(a)); }
      else { a = uGFT; float rest = u - arc; x = uGFR * sin(a) + rest * cos(a); zz = uGFR * (1.0 - cos(a)) + rest * sin(a); }
      x -= P.z * sin(a); zz += P.z * cos(a);   // 井戸の深さも布の向きごと回す
      P = vec3(uGFD * (uGFS + x) + nv * v, zz);
    }
  }
  return P;
}
`;
// 布の形: 格子座標 g (0..1, 余白込み) → 位置。uv = 絵の座標 (余白はミラー前)、deep = 喉の深さ (陰影)
const SURF = `
uniform mat4 uView, uProj;
uniform float uMargin;
${FIELD}
vec3 gSurf(vec2 g, out vec2 uv, out float deep){
  uv = 0.5 + (g - 0.5) * uMargin;                              // 余白ぶん画面の外まで
  return gField(vec3((uv - 0.5) * 2.0 * vec2(uGAsp, 1.0), fx3dRelief(uv)), deep);   // 立体シェーダの深度で持ち上げた布を吸い込む
}
`;
const VS = `#version 300 es
precision highp float;
${SURF}
out vec2 vUv; out vec3 vW; out float vDeep; out vec3 vN;
void main(){
  int id = gl_VertexID, quad = id / 6, tv = id - quad * 6;
  int iy = quad / ${COLS}, ix = quad - iy * ${COLS};
  vec2 ab = (tv == 0 || tv == 3) ? vec2(0.0, 0.0) : (tv == 1) ? vec2(1.0, 0.0) : (tv == 2 || tv == 4) ? vec2(1.0, 1.0) : vec2(0.0, 1.0);
  vec2 g = (vec2(float(ix), float(iy)) + ab) / vec2(${COLS}.0, ${ROWS}.0);
  vec2 uv; float deep;
  vec3 P = gSurf(g, uv, deep);
  {   // 陰影の法線は、隣の格子点の位置から頂点ごとに求める (深度で持ち上げた所が三角形ごとの網目に見えるのを防ぐ)
    const vec2 D = 1.0 / vec2(${COLS}.0, ${ROWS}.0);
    vec2 uvd; float dd;
    vN = normalize(cross(gSurf(g + vec2(D.x, 0.0), uvd, dd) - gSurf(g - vec2(D.x, 0.0), uvd, dd),
                         gSurf(g + vec2(0.0, D.y), uvd, dd) - gSurf(g - vec2(0.0, D.y), uvd, dd)));
  }
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
out vec2 vUv; out vec3 vW; out float vDeep; out vec3 vN;
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
  vec3 P = P0 + N * (w * fx3dNeedleH(key, (uv - 0.5) * vec2(uGAsp, 1.0) * 3.2) * cell);
  P *= fx3dPop(0.0);
  vUv = uv; vW = P; vDeep = deep;
  vN = vec3(0.0);   // 針の面は三角形ごとの陰影のまま (FS が差分の法線を使う)
  gl_Position = fx3dApply(uProj * uView * vec4(P, 1.0));
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vW; in float vDeep; in vec3 vN;
uniform sampler2D uTex; uniform vec3 uEye; uniform float uShade;
out vec4 frag;
${Fx3d.GLSL_LIT}
void main(){
  vec2 u = fx3dSrc(vUv);                                         // 余白は素材の余白 (3D Overscan)、その外はミラー
  vec4 t0 = texture(uTex, u);
  if(t0.a < 0.5) discard;   // 前の段 (3D FX) が抜いた背景は描かない = 前の段の物体だけがこの段に乗る
  vec3 col = dot(vN, vN) > 0.25 ? fx3dLitN(t0.rgb, normalize(vN), vW, uEye, uShade) : fx3dLit(t0.rgb, vW, uEye, uShade);
  col *= mix(1.0, mix(0.2, 1.0, smoothstep(-2.4, -0.6, vDeep)), uShade);   // 喉の奥を暗く
  frag = vec4(fx3dFoldShade(col), 1.0);
}`;
const U = {};
function uloc(gl, p, n){ const m = U[n] || (U[n] = new WeakMap()); let l = m.get(p); if(l === undefined){ l = gl.getUniformLocation(p, n); m.set(p, l); } return l; }
const h1 = (n, s)=>{ const x = Math.sin(n * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
const easeOut = (x)=>{ const y = 1 - Math.max(0, Math.min(1, x)); return 1 - y * y * y; };

// 喉の数 (1〜4)。拍が変わった所で切り替える (拍の間に変わると配置が 1 フレームで飛ぶため。前の拍の配置から Ease で移る)
const gst = { n: null, cur: 2, prev: 2 };

// 喉の軌道: 4 拍ごとにくじを引き、直線 (往復) / 円 / 曲線 (8 の字) のどれかの上を動く。切り替えは前の軌道から Ease で混ぜる (位置は時間の連続関数 = 瞬間移動しない)。
//   全体の広がり (spread) がゆっくり呼吸し、喉どうしが近づいては離れる。座標は半幅・半高に対する割合
const sstep = (x)=>{ x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
function trackPos(j, P, sg, s){
  const a0 = h1(sg, 3.1) * 6.2832, rad = P === 1 ? 0 : P === 2 ? 0.45 : P === 3 ? 0.5 : 0.55;
  const aa = a0 + (P === 2 ? Math.PI * j : 6.2832 * j / P);
  const ax = Math.cos(aa) * rad, ay = Math.sin(aa) * rad;
  const sp = 0.42 + 0.58 * (0.5 + 0.5 * Math.sin(6.2832 * s / 9 + h1(sg, 1.7) * 6.2832));   // 広がり 0.42〜1
  const ty = Math.floor(h1(sg, 20 + j * 3.7) * 3), w = (0.45 + 0.5 * h1(sg, 30 + j)) * (h1(sg, 40 + j) < 0.5 ? 1 : -1), ph = h1(sg, 50 + j) * 6.2832, ang = h1(sg, 60 + j) * 3.1416;
  const A = 0.3 + 0.3 * h1(sg, 70 + j);
  let dx, dy;
  if(ty === 0){ const v = Math.sin(w * s + ph) * A * 1.4; dx = Math.cos(ang) * v; dy = Math.sin(ang) * v; }
  else if(ty === 1){ dx = Math.cos(w * s + ph) * A; dy = Math.sin(w * s + ph) * A; }
  else { const u = Math.sin(w * s + ph) * A * 1.3, v = Math.sin(2 * w * s + ph) * A * 0.6; dx = Math.cos(ang) * u - Math.sin(ang) * v; dy = Math.sin(ang) * u + Math.cos(ang) * v; }
  return [ax * sp + dx, ay * sp + dy];
}
function throatPos(j, P, s, hx, hy){
  const seg = Math.floor(s / 4), e = sstep((s / 4 - seg) / 0.5);
  const p0 = trackPos(j, P, seg - 1, s), p1 = trackPos(j, P, seg, s);
  return [Math.max(-0.85, Math.min(0.85, p0[0] + (p1[0] - p0[0]) * e)) * hx, Math.max(-0.85, Math.min(0.85, p0[1] + (p1[1] - p0[1]) * e)) * hy];
}

// 拍 m の配置: 主の井戸 (喉) P 個は軌道の上を動く (時間 s = 拍)。
//   残りは最寄りの喉 (順番に割り当て) の周りを公転する (t で回り続ける。外ほどゆっくり)。喉は P>1 のとき少し浅く・狭くして間の布も読めるようにする
function layout(m, asp, t, P, s){
  const land = asp >= 1, Lh = land ? asp : 1, Sh = land ? 1 : asp;
  const hx = asp, hy = 1;   // 紙の座標での半幅・半高
  const C = [], M = [];
  const W = [], R = [];
  const SW = [-1.6, -1.2, 1.1, -0.9, 0.8], SR = [0.28, 0.24, 0.30, 0.22, 0.26];
  const tw = P > 1 ? -5.2 * 0.85 : -5.2, tr = P > 1 ? 0.5 : 0.55;
  for(let j = 0; j < P; j++) C.push(throatPos(j, P, s, hx, hy));
  for(let j = 0; j < P; j++){ W.push(tw); R.push(tr); M.push(1); }
  const dir = h1(m, 8.8) < 0.5 ? 1 : -1, sc = P > 1 ? 0.75 : 1;
  for(let i = P; i < NW; i++){
    const c0 = C[(i - P) % P];
    const r = (0.7 + 0.18 * i + 0.25 * h1(m, 2.3 + i)) * Sh * sc;
    const a = h1(i, 7.7) * 6.2832 + h1(m, 4.4 + i) * 1.2 + dir * t * 0.55 / r;
    C.push([c0[0] + Math.cos(a) * r * (land ? 1.4 : 1), c0[1] + Math.sin(a) * r * (land ? 1 : 1.4)]);
    W.push(SW[i - P]); R.push(SR[i - P]); M.push(0);
  }
  return { C, W, R, M };
}

// 場のパラメータ (井戸の配置・めくれ)。o = { asp, k, clock, beat, beatMode, hit, spin }
function fieldParams(o){
  const asp = o.asp, k = o.k, t = o.clock || 0;
  // beat = 拍ごとの配置へ Ease Out / drone = 0.25 拍/秒相当でゆっくり移り変わる
  const b = o.beatMode ? (o.beat || 0) : t * 0.25;
  const n = Math.floor(b), e = o.beatMode ? easeOut((b - n) / 0.6) : (b - n) * (b - n) * (3 - 2 * (b - n));
  const P = Math.max(1, Math.min(4, Math.round(+((o.post || {}).fx3dGravityPoints != null ? o.post.fx3dGravityPoints : 2)) || 2));
  if(gst.n === null){ gst.cur = gst.prev = P; gst.n = n; }
  else if(gst.n !== n){ gst.prev = gst.cur; gst.cur = P; gst.n = n; }
  const sm = o.beatMode ? b : t * 0.5;   // 軌道の時間 (拍)
  const A = layout(n - 1, asp, t, gst.prev, sm), B = layout(n, asp, t, gst.cur, sm);
  const C = [], W = [], R = [], M = [];
  for(let i = 0; i < NW; i++){
    C.push(A.C[i][0] + (B.C[i][0] - A.C[i][0]) * e, A.C[i][1] + (B.C[i][1] - A.C[i][1]) * e);
    M.push(A.M[i] + (B.M[i] - A.M[i]) * e); W.push(A.W[i] + (B.W[i] - A.W[i]) * e); R.push(A.R[i] + (B.R[i] - A.R[i]) * e);
  }
  // めくれ: 拍ごとに線の向き・位置・返す角度を選び、拍の前半で返して後半で戻す (拍頭は 0 = 線が変わっても跳ねない)
  const kq = 1 - Math.pow(1 - k, 3);
  // 途中の角度 (直角付近) は布が壁のように立つので短く通り過ぎ、裏返しきって重なった形で止まる
  const ph = b - n, env = easeOut(ph / 0.26) * (1 - (x=>x * x * (3 - 2 * x))(Math.max(0, Math.min(1, (ph - 0.74) / 0.26))));
  const fa = h1(n, 6.1) * 6.2832, fsd = (0.35 + 0.55 * h1(n, 7.3)) * (asp >= 1 ? 1 : asp);   // 線は中心から外寄り = 画面の端の側がめくれ返る
  const ft = Math.PI * Math.min(1, kq * 1.6) * env;
  // 渦の向き: 拍 (drone は 4 秒) ごとにくじを引き、前の反転から 2 拍以上たっていれば 3 割で反転 = ランダムな周期。反転した拍の前半でなめらかに切り替える
  if(gst.dn === undefined || n < gst.dn || n - gst.dn > 64){ gst.dn = n; gst.dSign = 1; gst.dPrev = 1; gst.dLast = n; }
  while(gst.dn < n){
    gst.dn++;
    gst.dPrev = gst.dSign;
    if(gst.dn - gst.dLast >= 2 && h1(gst.dn, 9.3) < 0.3){ gst.dSign = -gst.dSign; gst.dLast = gst.dn; }
  }
  const dir = gst.dPrev + (gst.dSign - gst.dPrev) * easeOut(ph / 0.5);
  return { C, W, R, M, fa, fsd, ft, kq, dir };
}

Fx3d.EXTRA.gravity = {
  ov: true,
  foldHook: true,
  spikes: true,
  FIELD,
  // 場の uniform (uG*) を送る。GL の foldStack も Uzumaki のあとに場を掛けるときに使う (o.noFlip でめくれを止める)
  fieldUniforms(gl, pr, o){
    const F = fieldParams(o), U = (n)=>gl.getUniformLocation(pr, n);
    gl.uniform1f(U('uGAsp'), o.asp);
    gl.uniform1f(U('uGK'), o.k);
    gl.uniform1f(U('uGSpin'), o.spin);
    gl.uniform1f(U('uGHit'), o.hit || 0);
    gl.uniform1f(U('uGT'), o.clock || 0);
    gl.uniform2fv(U('uGC'), F.C.flat ? F.C.flat() : F.C);
    gl.uniform1fv(U('uGW'), F.W);
    gl.uniform1fv(U('uGR'), F.R);
    gl.uniform1fv(U('uGM'), F.M);
    gl.uniform1f(U('uGDir'), F.dir);
    gl.uniform2f(U('uGFD'), Math.cos(F.fa), Math.sin(F.fa));
    gl.uniform1f(U('uGFS'), F.fsd);
    const post = o.post || {}, dz = (v, d)=>Math.max(0, Math.min(1, App.deadParam(v != null ? +v : d)));
    gl.uniform1f(U('uGDepth'), 2 * dz(post.fx3dGravityDepth, 0.5));
    gl.uniform1f(U('uGWave'), 2 * dz(post.fx3dGravityWave, 0.5));
    gl.uniform1f(U('uGFT'), o.noFlip ? 0 : Math.min(Math.PI, F.ft * 2 * dz(post.fx3dGravityFlip, 0.5)));   // noFlip: 折った紙に掛けるときはめくれない (紙の半分が丸ごと手前へ倒れるため)
    gl.uniform1f(U('uGFR'), 0.18);   // 小さい巻き = 裏返った布は元の布のすぐ上に重なる (カメラの前を塞がない)
  },
  render(gl, o){
    const pr = Fx3d.prog(gl, 'gravity', VS, FS);
    if(!pr) return false;
    const post = o.post || {};
    const spin = Math.max(0, Math.min(1, o.dz(+post.fx3dGravitySpin)));
    const asp = o.asp, k = o.k, t = o.clock || 0;
    const kq = 1 - Math.pow(1 - k, 3);
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
      gl.uniform1f(uloc(gl, pr, 'uMargin'), Fx3d.foldFrame ? 1 : MARGIN);   // 折りを掛けるときは紙と同じ大きさ (余白まで折ると手前へ飛び出す)
      this.fieldUniforms(gl, pr, Object.assign({}, o, { spin }));
      gl.uniform1f(uloc(gl, pr, 'uShade'), Fx3d.shade(k));
      Fx3d.popUniforms(gl, pr, 'gravity');
      Fx3d.ovUniforms(gl, pr, o);
      Fx3d.reliefUniforms(gl, pr, [MARGIN / COLS, MARGIN / ROWS]);   // 立体シェーダの深度で面を持ち上げる
      Fx3d.fold(gl, pr, cam.proj, 1.35);   // 最後の段なら折りを物体へ (それ以外は uFx3dOn = 0)
    };
    const nvp = Fx3d.spikeFrame ? Fx3d.prog(gl, 'gravityNeedle', NV_VS, FS) : null;
    if(nvp){
      // Needle: 布を針の面で覆う (重ねたときの紙と同じ間隔 = 画面の高さを 14 分割。布は余白ぶん大きい)
      const m = Fx3d.foldFrame ? 1 : MARGIN, gy = Math.round(Fx3d.nvScale(14 * m)), gx = Math.round(Fx3d.nvScale(14 * m * asp));
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
