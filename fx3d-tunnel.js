'use strict';
/* 3D FX: tunnel (Wax Tunnel) — 画面を筒のメッシュに丸め、うねる道に沿ってねじれて脈打つ凸凹の通路にして奥へ進む。
   映像は内壁にタイル状に貼り、奥から流れてくる。奥ほど冷たい影色に沈む (旧 Pattern の Tunnel = Shadertoy X3jXWh の雰囲気を頂点で)。(Fx3d.EXTRA.tunnel)
   契約は fx3d.js の EXTRA のコメント参照。k = 0 で平らな画面・正面カメラ = 元画面と画素一致。
   格子は画面そのもの: 画面の下の端 = 手前、上の端 = 奥、左右の端 = 筒を一周して合わさる。量を上げると画面が奥へ伸びながら丸まる。
   断面はキャンバスの縦横比の長方形 (Round で楕円へ)。Twist / Spin で回し、Curve (うねり) / Bend X・Y (一定の向き) で曲げる。 */
(function(){
const SEG = 96, RING = 320, LEN = 75, CAMZ = 1.35, SC = 5.0, Z0 = CAMZ + SC;   // 入口はカメラの SC 後ろ (横を向いても入口の縁が画角に入らない)
// 格子の点 uv (u = 周り / v = 奥行き) → 位置。uM = 平面 → 筒の割合
const SURF = `
uniform mat4 uView, uProj;
uniform float uAsp, uK, uM, uTrav, uRad, uTwist, uFlip, uCurve, uBump, uPulse, uRound, uSpinA, uT, uHit;
uniform vec2 uBend;   // 一定の向きの曲がり (左右 / 上下)
uniform vec2 uBias;   // うねりの横ずれの平均を打ち消す量 (JS で計算。sin² の山で引く = 両端は動かさない)
float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vn(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// 道の中心 (カメラからの距離 s での横ずれ)。カメラの位置 (s = 0) で位置 0・傾き 0 = 通路はカメラの真正面からまっすぐ始まる
vec2 pathRaw(float s){
  vec2 a = vec2(cos((s + uTrav) * 0.2), sin((s + uTrav) * 0.26));
  vec2 b = vec2(cos(uTrav * 0.2), sin(uTrav * 0.26));
  vec2 db = vec2(-0.2 * sin(uTrav * 0.2), 0.26 * cos(uTrav * 0.26));
  return (a - b - db * s) * 2.2 * uCurve;
}
// 奥の長方形 (終点 s = L) もカメラの真正面に留める = 中間だけがうねり、消失点は常に画面の中央・同じ距離
// Bend: 両端を正面に残したまま、通路を片側へ弓なりに膨らませる (中ほどで最大 6)
vec2 path(float s, float L){ float h = sin(3.14159265 * clamp(s / L, 0.0, 1.0)); return pathRaw(s) - pathRaw(L) * (s * s) / (L * L) + (uBend * 6.0 - uBias) * h * h; }
const float Z0 = ${Z0.toFixed(2)}, SC = ${SC.toFixed(2)};
vec3 tSurf(vec2 uv, out float s){
  vec3 Pf = vec3((uv - 0.5) * 2.0 * vec2(uAsp, 1.0), 0.0);   // 平らな画面
  s = pow(uv.y, 1.6) * ${LEN}.0;                                // 入口からの距離 (手前ほど格子が細かい)
  float g = s + uTrav;                                          // 通路の上の絶対位置 (前へ進むと壁が流れてくる)
  float a = (uv.x - 0.5) * 6.2831853;                           // 周りの角度 (u = 0.5 が床)
  vec2 d = vec2(sin(a), -cos(a));
  // 断面: キャンバスの縦横比の長方形 (半径 1 で入口が画面の縁に重なる)。Round で楕円へ
  float rx = uRad * uAsp, ry = uRad;
  float rRect = min(rx / max(abs(d.x), 1e-4), ry / max(abs(d.y), 1e-4));
  float rEll = inversesqrt((d.x * d.x) / (rx * rx) + (d.y * d.y) / (ry * ry));
  float r = mix(rRect, rEll, uRound) * (1.0 + uPulse * 0.45 * sin(g * 0.9 + cos(g * 0.9)));   // 脈打つ
  vec3 nq = vec3(cos(a), sin(a), g * 0.35);
  r *= 1.0 + uBump * (vn(nq * 2.2) * 0.75 + vn(nq * 5.1) * 0.35 - 0.55);   // 蝋の凸凹
  r *= 1.0 + 0.06 * uHit * uK;
  r *= 1.0 - smoothstep(0.9, 1.0, uv.y) * uM;   // いちばん奥はすぼめて閉じる (開いた端から背景が見えない)
  // 回転: 奥へ行くほどねじれる (Twist) + 断面ごと時間で回る (Spin)。長方形の形そのものを回す
  // ねじれ: Flip 0 = 一定の割合 (進むと同じ向きに回り続ける) / 上げるほど向きが波打ち、通路の途中で入れ替わる (進むと回る向きが行き来する)
  float tw = mix(g, 9.0 * sin(g * 0.11) + 4.0 * sin(g * 0.23 + 1.7), uFlip);
  float rot = uTwist * tw + uSpinA, cr = cos(rot), sr = sin(rot);
  vec2 w = r * d;
  float z0 = mix(1.0, Z0, uM * uM);                             // 入口: 筒になりきるまでは手前 (z = 1) のまま、なりきったらカメラの後ろへ
  float sh = max(z0 - ${CAMZ.toFixed(2)}, 0.0);                  // 入口がカメラより後ろにある分
  vec3 Pt = vec3(path(s - sh, ${LEN}.0 - sh) + vec2(cr * w.x - sr * w.y, sr * w.x + cr * w.y), z0 - s);   // 入口はカメラ (z = 1.35) の後ろ = カメラは常に筒の中
  return mix(Pf, Pt, uM);
}
`;
const VS = `#version 300 es
precision highp float;
${SURF}
out vec2 vUv; out vec3 vW, vN; out float vS;
void main(){
  int quad = gl_VertexID / 6, tv = gl_VertexID - quad * 6;
  int iy = quad / ${SEG}, ix = quad - iy * ${SEG};
  vec2 ab = (tv == 0 || tv == 3) ? vec2(0.0, 0.0) : (tv == 1) ? vec2(1.0, 0.0) : (tv == 2 || tv == 4) ? vec2(1.0, 1.0) : vec2(0.0, 1.0);
  vec2 uv = (vec2(float(ix), float(iy)) + ab) / vec2(${SEG}.0, ${RING}.0);
  float s, sd;
  vec3 P = tSurf(uv, s);
  // 法線は格子の隣の点との差から (面ごとの dFdx だと壁の陰影がカクつく)
  vec3 Tu = tSurf(uv + vec2(0.5 / ${SEG}.0, 0.0), sd) - P, Tv = tSurf(uv + vec2(0.0, 0.5 / ${RING}.0), sd) - P;
  vN = normalize(cross(Tu, Tv));
  P.z += fx3dRelief(uv) * (1.0 - uM);   // 立体シェーダの深度は平らなうちだけ持ち上げる
  vUv = uv; vW = P; vS = s;
  gl_Position = fx3dApply(uProj * uView * vec4(P * fx3dPop(0.0), 1.0));
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vW, vN; in float vS;
uniform sampler2D uTex; uniform vec3 uEye;
uniform float uAsp, uM, uTrav, uRad, uTile, uFlow, uFog, uShine, uShade, uTwist, uEdge;
out vec4 frag;
vec2 mir(vec2 u){ vec2 m = mod(u, 2.0); return mix(m, 2.0 - m, step(1.0, m)); }
void main(){
  // 内壁にタイル状に貼る: 周り uTile 枚、奥行きは映像の縦横比を保つ長さで繰り返し、流れる
  float circ = 4.0 * uRad * (uAsp + 1.0);   // 断面の周の長さ (長方形)
  vec2 tiled = vec2(vUv.x * uTile, (vS + uTrav * uFlow) * uTile / circ * uAsp);
  // Edge: 画面の縁の、壁と同じ向きのピクセルを奥へ伸ばす (縁の色が筋になって通路に流れる)
  float a = (vUv.x - 0.5) * 6.2831853;
  vec2 d = vec2(sin(a), -cos(a));
  vec2 qe = d * min(uAsp / max(abs(d.x), 1e-4), 1.0 / max(abs(d.y), 1e-4));   // 縁の上の点 (画面の座標)
  vec2 px = 1.0 / vec2(textureSize(uTex, 0));
  vec2 edge = clamp(qe / (2.0 * vec2(uAsp, 1.0)) + 0.5, px, 1.0 - px);
  vec2 tuv = mix(vUv, mix(mir(tiled), edge, uEdge), uM);
  vec4 t0 = texture(uTex, tuv);
  if(t0.a < 0.5) discard;   // 前の段 (3D FX) が抜いた背景は描かない
  vec3 alb = t0.rgb;
  vec3 N = normalize(vN);
  vec3 V = normalize(uEye - vW);
  if(dot(N, V) < 0.0) N = -N;
  vec3 L = normalize(uEye + vec3(0.6, 0.8, 0.0) - vW);          // カメラの少し上の灯り (手に持ったライト)
  float diff = 0.55 + 0.45 * max(0.0, dot(N, L));
  float spec = pow(max(0.0, dot(N, normalize(L + V))), 38.0) * uShine;   // 蝋の照り
  // 奥ほど冷たい影色へ沈む (いちばん奥は黒 = 通路の端が見えない)
  float fade = exp(-max(vS - ${SC.toFixed(2)}, 0.0) * uFog) * (1.0 - smoothstep(0.8, 1.0, vUv.y));
  vec3 cold = mix(vec3(1.0), vec3(0.34, 0.40, 0.52), 1.0 - fade);
  vec3 lit = alb * diff * cold * fade + vec3(spec * fade);
  vec3 col = mix(alb, lit, uShade * uM);
  frag = vec4(fx3dFoldShade(col), 1.0);
}`;
const U = {};
function uloc(gl, p, n){ const m = U[n] || (U[n] = new WeakMap()); let l = m.get(p); if(l === undefined){ l = gl.getUniformLocation(p, n); m.set(p, l); } return l; }
const ss = (a, b, x)=>{ const y = Math.max(0, Math.min(1, (x - a) / (b - a))); return y * y * (3 - 2 * y); };

// 投影: Fx3d.camera と同じ画角 (f = 1.35) で、奥の端 (カメラから 80 ほど) まで描けるよう遠い側の切り取りを伸ばす
function tunnelProj(asp){ const f = 1.35, zn = 0.03, zf = 120.0; return [f / asp,0,0,0, 0,f,0,0, 0,0,(zf + zn) / (zn - zf),-1, 0,0,2 * zf * zn / (zn - zf),0]; }
Fx3d.EXTRA.tunnel = {
  // 同じ壁の式・時間積算・カメラを単体描画 / Build で使う。
  shapeGLSL(){ return SURF.replace(/\b(u[A-Z]\w*|h3|vn|pathRaw|path|Z0|SC|tSurf)\b/g, 'f3t_$1'); },
  shapeState(o){
    const post = o.post || {};
    // サブパラメータ (0..1。post = App.post = デッドゾーン前の値)
    const pv = (key, def)=>{ const v = post[key] == null ? def : +post[key]; return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : def; };
    const speed = pv('fx3dTunnelSpeed', 0.5) * 2;
    const rad = 0.5 + 1.0 * pv('fx3dTunnelRadius', 0.5);   // 0.5 で 1 = 入口が画面の縁に重なる
    const twist = (pv('fx3dTunnelTwist', 0.6) - 0.5) * 0.9;
    const curve = pv('fx3dTunnelCurve', 0.5) * 2;
    const bump = 0.6 * pv('fx3dTunnelBump', 0.4);
    const pulse = pv('fx3dTunnelPulse', 0.4);
    const tile = 1 + 5 * pv('fx3dTunnelTile', 0.4);
    const round = pv('fx3dTunnelRound', 0);
    const spinV = (pv('fx3dTunnelSpin', 0.5) - 0.5) * 2;
    const flip = pv('fx3dTunnelFlip', 0.5);
    // 中央 0 のスライダー (-1..1。デッドゾーンあり)
    const sv = (key)=>{ const v = +post[key]; return Number.isFinite(v) ? Math.max(-1, Math.min(1, o.dz ? o.dz(v) : v)) : 0; };
    const bendX = sv('fx3dTunnelBendX'), bendY = sv('fx3dTunnelBendY');
    const fog = 0.01 + 0.12 * pv('fx3dTunnelFog', 0.4);
    const shine = 1.2 * pv('fx3dTunnelShine', 0.5);
    const edge = pv('fx3dTunnelEdge', 0) >= 0.5 ? 1 : 0;   // オプション: 端のピクセルを伸ばす
    const asp = o.asp, k = o.k, t = o.clock || 0;
    const m = ss(0.0, 0.85, k);
    // 進む量: drone = 一定の速さ / beat = 拍の頭でぐっと進んですぐ減速。位相は積み上げる (Speed を動かしても跳ねない)
    const dt = this._lastT == null ? 0 : Math.max(0, Math.min(0.1, t - this._lastT));
    this._lastT = t;
    if(o.beatMode){
      const b = o.beat || 0, f = b - Math.floor(b), y = 1 - f;
      const pos = Math.floor(b) + 1 - y * y * y;
      if(this._bPos == null) this._bPos = pos;
      this._trav += Math.max(0, Math.min(1, pos - this._bPos)) * 1.8 * speed * m;
      this._bPos = pos;
    } else {
      this._bPos = null;
      this._trav += dt * 2.2 * speed * m;
    }
    // Spin の向き: Flip に応じてランダムに逆回りへ (drone = 数秒ごと / beat = 数拍ごと)。向きはなめらかに 0 を通って反転する
    if(this._sDir == null){ this._sDir = 1; this._sTgt = 1; this._sNext = 0; }
    const clockNow = o.beatMode ? (o.beat || 0) : t * 0.5;   // 拍 (drone は 0.5 拍 / 秒)
    if(flip > 0.001 && clockNow >= this._sNext){
      if(this._sNext > 0 && Math.random() < 0.35 + 0.6 * flip) this._sTgt = -this._sTgt;
      this._sNext = clockNow + (o.beatMode ? 4 : 3) * Math.pow(2, Math.floor(Math.random() * 3)) * (1.6 - flip);
    }
    if(flip <= 0.001) this._sTgt = 1;
    this._sDir += (this._sTgt - this._sDir) * Math.min(1, dt * 1.5);
    this._spin = (this._spin || 0) + dt * 0.8 * spinV * this._sDir * m;   // 断面の回転 (位相を積み上げる)
    // Tilt / Pan: カメラの向き (0.5 = 正面)。量 0 では正面 = 元画面と一致
    const tilt = sv('fx3dTunnelTilt') * 0.5 * m, pan = sv('fx3dTunnelPan') * 0.5 * m;
    // カメラは常に真正面の奥の長方形 (通路の終点) を同じ距離で見る (道の両端はカメラの軸に固定してある)。量 0 でも正面 = 元画面と一致
    const eye = [0, 0, CAMZ];
    let dir = [0, 0, -1];
    // Tilt / Pan: 見る向きを上下 / 左右に振る
    const rotY = (v, a)=>[v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];
    const rotX = (v, a)=>[v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
    dir = rotX(rotY(dir, -pan), tilt);
    const nrm = (v)=>{ const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const zc = nrm([-dir[0], -dir[1], -dir[2]]);
    const xc = nrm([zc[2], 0, -zc[0]]);
    const yc = [zc[1] * xc[2] - zc[2] * xc[1], zc[2] * xc[0] - zc[0] * xc[2], zc[0] * xc[1] - zc[1] * xc[0]];
    const dd = (u, v)=>u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const view0 = [xc[0], yc[0], zc[0], 0, xc[1], yc[1], zc[1], 0, xc[2], yc[2], zc[2], 0, -dd(xc, eye), -dd(yc, eye), -dd(zc, eye), 1];
    const cam = { view: (typeof GL !== 'undefined' && GL._stretchView) ? GL._stretchView(view0) : view0, proj: tunnelProj(asp), eye };
    let bias;
    {
      // うねり (Curve) の横ずれの平均を打ち消す: 通路の中ほどが片側へまとめて寄らないよう、手前ほど重く平均を取り、sin² の山で引く。Bend は引かない (意図した曲がり)
      const T = this._trav, z0 = 1 + (Z0 - 1) * m * m, sh = Math.max(z0 - CAMZ, 0), L = LEN - sh;
      const raw = (x)=>[ (Math.cos((x + T) * 0.2) - Math.cos(T * 0.2) + 0.2 * Math.sin(T * 0.2) * x) * 2.2 * curve,
                         (Math.sin((x + T) * 0.26) - Math.sin(T * 0.26) - 0.26 * Math.cos(T * 0.26) * x) * 2.2 * curve ];
      const rL = raw(L);
      let mx = 0, my = 0, mh = 0, ws = 0;
      for(let i = 0; i < 48; i++){
        const x = (i + 0.5) / 48 * L, w = 1 / (1 + 0.15 * x), r = raw(x), q = (x * x) / (L * L), h = Math.sin(Math.PI * x / L) ** 2;
        mx += w * (r[0] - rL[0] * q); my += w * (r[1] - rL[1] * q); mh += w * h; ws += w;
      }
      bias = [mx / mh, my / mh];
    }
    return {cam, k, uniforms:{uAsp:asp, uK:k, uM:m, uTrav:this._trav, uRad:rad, uTwist:twist,
      uFlip:flip, uCurve:curve, uBump:bump, uPulse:pulse, uRound:round, uSpinA:this._spin * m,
      uTile:tile, uFlow:1, uFog:fog, uShine:shine, uEdge:edge, uShade:Fx3d.shade(k), uT:t, uHit:o.hit || 0},
      bias, bend:[bendX * m, bendY * m]};
  },
  shapeUniforms(gl, pr, s, prefix = ''){
    for(const [n,v] of Object.entries(s.uniforms)) gl.uniform1f(uloc(gl, pr, prefix + n), v);
    gl.uniform2f(uloc(gl, pr, prefix + 'uBias'), ...s.bias);
    gl.uniform2f(uloc(gl, pr, prefix + 'uBend'), ...s.bend);
  },
  foldHook: true,
  _trav: 0, _lastT: null, _bPos: null,
  render(gl, o){
    const pr = Fx3d.prog(gl, 'tunnel', VS, FS);
    if(!pr) return false;
    const state = this.shapeState(o), {cam, k} = state;
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
    this.shapeUniforms(gl, pr, state);
    Fx3d.popUniforms(gl, pr, 'tunnel');
    Fx3d.reliefUniforms(gl, pr, [1 / SEG, 1 / RING]);
    Fx3d.fold(gl, pr, cam.proj, 1.35);
    gl.drawArrays(gl.TRIANGLES, 0, SEG * RING * 6);
    gl.bindVertexArray(null);
    Fx3d.resolve(gl, o.fbo, o.w, o.h);
    return true;
  },
};
})();
