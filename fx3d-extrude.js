'use strict';
/* 3D FX: extrude (表示名 Extrude) — 画面の絵を形に沿って厚みのある立体に押し出し、カメラを少し傾けて見せる (Fx3d.EXTRA.extrude)。
   契約は fx3d.js の EXTRA のコメント参照。前面 = 画面 (z = 0)、厚みの分だけ奥 (-z) へ押し出す。
   形: 紙抜き (3D Target = Object で深度を出す Visual・@matte) や前の 3D 段の出力のように背景が透過のフレームは alpha、
   それ以外は画面の縁の色 (地の色) との差。地の部分は押し出しの奥 (z = -厚み) に床として残る。
   描き方: 全画面 1 パスのレイキャスト。前面に当たればそのまま元の絵、外れたら厚みの中を進んで最初に形へ入った所が側面
   (色 = 縁の色を少し内側から拾い、形の勾配の法線で陰影 × Shade)。k = 0 では厚み 0・正面カメラ = 元画面と画素一致。
   回転: カメラが傾きの角度のまま左右に振れる (beat = 拍ごとに Ease Out で進む / drone = 時計で流れる)。
   ひねり (Twist): 奥へ行くほど断面を画面の中心まわりに回す (らせん状の押し出し)。
   Mode = Depth: 一律の厚みでなく、表示中のシェーダ / Code の深度 (3D Depth と同じもの) に応じて押し出す (高さの地形)。
   深度が無いフレームは形の濃さ (alpha / 地との差) で代用。
   Round (角丸): 前面と側面の境 (形の縁) を丸める。縁までの距離を輪を広げて探し、縁を 4 分円に落とす (Flat のときだけ)。
   Depth・Round のときは前面の近道を使わず、全部をレイの判定で描く。 */
(function(){
const VS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform highp int uSamples;   // 8。ANGLE が色比較ループを巨大展開しないよう uniform 上限
out vec2 vNdc;
flat out vec3 vBg;
void main(){
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vNdc = p;
  gl_Position = vec4(p, 0.0, 1.0);
  // 地の色: 画面の縁 8 点のうち、ほかの点との色の差の合計が最小の点 (縁に字がかかっても地を拾う)
  vec2 pts[8] = vec2[8](vec2(0.02, 0.02), vec2(0.5, 0.02), vec2(0.98, 0.02), vec2(0.02, 0.5),
                        vec2(0.98, 0.5), vec2(0.02, 0.98), vec2(0.5, 0.98), vec2(0.98, 0.98));
  vec3 c[8];
  for(int i = 0; i < uSamples; i++) c[i] = texture(uTex, fx3dSrc(pts[i])).rgb;
  float best = 1e9; vBg = c[0];
  for(int i = 0; i < uSamples; i++){
    float s = 0.0;
    for(int j = 0; j < uSamples; j++) s += length(c[i] - c[j]);
    if(s < best){ best = s; vBg = c[i]; }
  }
}`;
// レイ描画と高さ出力は maskV / hgtD / roundP を同じソースから使う。
const SHAPE = `#version 300 es
precision highp float;
in vec2 vNdc;
flat in vec3 vBg;
uniform sampler2D uTex;
uniform highp int uSamples;
uniform vec3 uEye, uXc, uYc, uZc;
uniform vec2 uRes;
uniform float uAsp, uT, uShade, uUseAlpha, uSteps, uStepPx, uTwist, uMode, uRound, uRz;
//RELIEF
out vec4 frag;
bool inB(vec2 uv){ return all(greaterThanEqual(uv, -uOvM)) && all(lessThanEqual(uv, 1.0 + uOvM)); }   // 余白の外は形なし (ミラーを押し出さない)
vec4 src(vec2 uv){ return texture(uTex, fx3dSrc(uv)); }
float maskV(vec2 uv){
  if(!inB(uv)) return 0.0;
  vec4 c = src(uv);
  return uUseAlpha > 0.5 ? c.a : clamp((length(c.rgb - vBg) - 0.12) / 0.16, 0.0, 1.0);
}
vec2 uvAt(vec3 d, float t){ return (uEye.xy + d.xy * t) / (2.0 * vec2(uAsp, 1.0)) + 0.5; }
// ひねり: 奥行きの割合 fz に比例して断面を画面の中心まわりに回す (前面 z = 0 は回らない)
float twA(vec3 d, float t){ return uTwist * clamp(-(uEye.z + d.z * t) / max(uT, 1e-5), 0.0, 1.0); }
vec2 rot(vec2 q, float a){ float c = cos(a), s = sin(a); return vec2(c * q.x - s * q.y, s * q.x + c * q.y); }
vec2 tuv(vec3 d, float t){ return rot(uEye.xy + d.xy * t, -twA(d, t)) / (2.0 * vec2(uAsp, 1.0)) + 0.5; }   // 厚みの中の点 → 断面 (元の絵) の uv
// 厚みの中を進む歩数: この画素のレイが前面から奥まで断面上を横に動く長さ (px) を uStepPx ごとに。上限 uSteps
//   (カメラの傾きだけで決めると、傾き 0 でも遠近で見えている画面の端の側面が数枚の層に割れていた)。中点を挟んで、ひねりの弧も拾う
int stepsFor(vec3 d, float t0, float t1){ float tm = 0.5 * (t0 + t1); vec2 a = tuv(d, t0), m = tuv(d, tm), b = tuv(d, t1); float L = length((m - a) * uRes) + length((b - m) * uRes); return int(clamp(ceil(L / uStepPx), 4.0, uSteps)); }
// Depth: 0..1 の高さ (形の外は -1)。シェーダの深度を量 (3D Depth × 表示の割合) で割って 0..1 に戻す。深度が無ければ形の濃さ
float hgtD(vec2 uv){
  float m = maskV(uv);
  if(m < 0.35) return -1.0;
  float sc = uReliefMax > 0.5 ? max(uRelief.x, uRelief.y) : uRelief.x + uRelief.y;
  if(sc <= 0.0) return m;
  // 1 点で読む (vjRelief の 5 点の均しはレイの歩数ぶん重なると重い。地形の細かさは歩幅で決まる)
  float a = uRelief.x > 0.0 ? uRelief.x * texture(uDepthA, vjDepthUv(uv, uDepthOs.xy)).r : 0.0;
  float b = uRelief.y > 0.0 ? uRelief.y * texture(uDepthB, vjDepthUv(uv, uDepthOs.zw)).r : 0.0;
  return clamp((uReliefMax > 0.5 ? max(a, b) : a + b) / sc, 0.0, 1.0);
}
// Round: 縁までの距離 (0 = 縁 → 1 = 角丸の半径より内側) を 4 分円の高さに。
//   半径の 1/4 ずつ輪を広げ、輪の 8 点のどれかが形の外に出た所で止める (外に出た点の割合で輪の間を補う)。細い線は低い丸い尾根になる
const vec2 RDIR[8] = vec2[8](vec2(1.0, 0.0), vec2(0.7071, 0.7071), vec2(0.0, 1.0), vec2(-0.7071, 0.7071),
                             vec2(-1.0, 0.0), vec2(-0.7071, -0.7071), vec2(0.0, -1.0), vec2(0.7071, -0.7071));
float roundP(vec2 uv){
  if(maskV(uv) < 0.35) return 0.0;
  float dd = 1.0;
  for(int i = 1; i <= 4; i++){
    float rr = float(i) * 0.25, o = 0.0;
    vec2 r = rr * uRound / uRes;
    for(int j = 0; j < uSamples; j++) if(maskV(uv + r * RDIR[j]) < 0.35) o += 1.0;
    if(o > 0.0){ dd = rr - 0.25 * o / 8.0; break; }
  }
  float s = clamp(dd, 0.0, 1.0);
  return sqrt(1.0 - (1.0 - s) * (1.0 - s));
}
`;
const HEIGHT_FS = SHAPE + `
void main(){
  vec2 uv = fx3dAB(vNdc * 0.5 + 0.5);
  float C = maskV(uv), H = uT * C;
  if(uMode > 0.5) H = uT * max(hgtD(uv), 0.0);
  else if(uRz > 0.0) H = C >= 0.35 ? uT - uRz * (1.0 - roundP(uv)) : 0.0;
  // 最大厚み 0.5 を既存 relief の最大 0.3 に合わせる。k / Depth / Pop は uT に含む。
  frag = vec4(0.6 * H, C, 0.0, 1.0);
}`;
const FS = SHAPE + `
// 前面からの奥行き z の所で、断面 uv が中身か (Depth / Round 用)
float zIn(vec3 d, float t){ return -(uEye.z + d.z * t); }
bool solidAt(vec3 d, float t){
  vec2 uv = tuv(d, t); float z = zIn(d, t);
  if(uMode > 0.5){ float h = hgtD(uv); return h >= 0.0 && z >= uT * (1.0 - h) - 1e-6; }
  if(maskV(uv) < 0.35) return false;
  return z >= uRz || z >= uRz * (1.0 - roundP(uv)) - 1e-6;
}
// 面の奥行き (前面からの深さ)。Depth = 高さの地形 / Round = 縁の丸み
float surfH(vec2 uv){ return uMode > 0.5 ? uT * (1.0 - max(hgtD(uv), 0.0)) : uRz * (1.0 - roundP(uv)); }
// 側面の色と向き: 輪郭のにじみ (地の色・縁取り) を拾うと、その色が奥へ伸びて縞 = 紙を重ねた層に見える。
//   輪郭から 3〜7px 内側を 3 点平均で拾い、向きも広めの幅の勾配で取る (厚み 0 付近は従来どおりその場の色 = 元画面と一致)
vec2 sideN(vec2 uvH){
  vec2 e = 3.0 / uRes;
  vec2 g = vec2(maskV(uvH + vec2(e.x, 0.0)) - maskV(uvH - vec2(e.x, 0.0)), maskV(uvH + vec2(0.0, e.y)) - maskV(uvH - vec2(0.0, e.y)));
  return dot(g, g) > 1e-8 ? -normalize(g) : vec2(0.0);
}
vec4 sideCol(vec2 uvH, vec2 n2){
  vec2 st = n2 / uRes * min(1.0, uT / 0.02);
  vec4 c = vec4(0.0); float w = 0.0;
  for(int i = 0; i < 3; i++){                 // 細い線では内側の点が反対側の地へ抜けるので、形の中の点だけを使う
    vec2 q = uvH - st * (3.0 + 2.0 * float(i));
    float m = step(0.5, maskV(q));
    c += src(q) * m; w += m;
  }
  return w > 0.0 ? c / w : src(uvH - st);
}
// Depth / Round: 前面も含めてレイで判定する
vec4 shapedMain(vec3 d, float t0, float t1, vec2 uv0){
  int N = stepsFor(d, t0, t1);
  float dt = (t1 - t0) / float(N), ta = t0, tb = -1.0;
  if(solidAt(d, t0)) tb = t0;
  else for(int i = 1; i <= N; i++){
    float t = t0 + dt * float(i);
    if(solidAt(d, t)){ tb = t; break; }
    ta = t;
  }
  if(tb < 0.0){
    if(uUseAlpha < 0.5){ vec2 uv1 = uvAt(d, t1); return inB(uv1) ? vec4(src(uv1).rgb, 1.0) : vec4(0.0); }
    return (inB(uv0) ? src(uv0) : vec4(0.0)) * (1.0 - smoothstep(0.0, 0.02, uT));   // 厚み 0 付近は形の縁のにじみも元のまま
  }
  if(tb > t0) for(int j = 0; j < 5; j++){ float tm = 0.5 * (ta + tb); if(solidAt(d, tm)) tb = tm; else ta = tm; }
  vec2 uvH = tuv(d, tb), e = 1.5 / uRes;
  float z = zIn(d, tb), sh = uShade * min(1.0, uT / 0.02);
  vec4 c; vec3 nW;
  if(uMode < 0.5 && z >= uRz - 1e-5 && uRz < uT){
    // 角丸より奥 = 側面 (Flat と同じ: 縁の色を少し内側から拾い、形の勾配の法線)
    vec2 n2 = sideN(uvH);
    c = sideCol(uvH, n2);
    nW = vec3(rot(normalize(vec2(n2.x / uAsp, n2.y) + 1e-6), twA(d, tb)), 1e-3);
  } else {
    // 面 (前面・角丸・深度の地形): 色は縁の近くなら少し内側から拾う (輪郭のにじみに地の色が混ざるため)、法線は面の奥行きの勾配
    vec2 gm = vec2(maskV(uvH + vec2(e.x, 0.0)) - maskV(uvH - vec2(e.x, 0.0)), maskV(uvH + vec2(0.0, e.y)) - maskV(uvH - vec2(0.0, e.y)));
    c = src(uvH + (dot(gm, gm) > 1e-8 ? normalize(gm) : vec2(0.0)) * e * 1.5 * min(1.0, uT / 0.02));
    vec2 g = vec2(surfH(uvH + vec2(e.x, 0.0)) - surfH(uvH - vec2(e.x, 0.0)), surfH(uvH + vec2(0.0, e.y)) - surfH(uvH - vec2(0.0, e.y)));
    g /= 2.0 * e * 2.0 * vec2(uAsp, 1.0);                                        // uv → 画面の座標 (高さ 2)
    nW = vec3(rot(g, twA(d, tb)), 1.0);
  }
  vec3 col = uUseAlpha > 0.5 ? c.rgb / max(c.a, 1e-3) : c.rgb;
  vec3 L = normalize(vec3(-0.45, 0.8, 0.4));
  float lit = clamp(dot(normalize(nW), L) / L.z, 0.25, 1.35);                    // 正面向きの面 = 1 (厚み 0 で元の色)
  return vec4(col * mix(1.0, lit, sh), 1.0);
}
void main(){
  vec3 d = normalize(uXc * (vNdc.x * uAsp / 1.35) + uYc * (vNdc.y / 1.35) - uZc);
  float t0 = -uEye.z / min(d.z, -1e-4), t1 = (-uT - uEye.z) / min(d.z, -1e-4);
  vec2 uv0 = uvAt(d, t0);
  if(uMode > 0.5 || uRz > 0.0){ frag = shapedMain(d, t0, t1, uv0); return; }
  vec4 s0 = inB(uv0) ? src(uv0) : vec4(0.0);
  float m0 = maskV(uv0);
  float w = 0.5 * fwidth(m0) + 1e-4;
  // 前面: 透過のフレームは元の絵 (前乗算) そのもの、地との差で取るフレームは形の被覆
  vec4 F; float cov;
  if(uUseAlpha > 0.5){ F = s0; cov = s0.a; }
  else { cov = smoothstep(0.5 - 2.0 * w, 0.5, m0); F = vec4(s0.rgb, 1.0) * cov; }   // 0.5 以上は全部前面 (側面の判定 >= 0.5 と揃え、厚み 0 で元画面と一致)
  vec4 B = vec4(0.0);
  if(cov < 0.999){
    // 厚みの中を奥へ進み、最初に形へ入った所 = 側面
    int N = stepsFor(d, t0, t1);
    float dt = (t1 - t0) / float(N), ta = t0, tb = -1.0;
    for(int i = 1; i <= N; i++){
      float t = t0 + dt * float(i);
      if(maskV(tuv(d, t)) >= 0.35){ tb = t; break; }   // 0.5 より低め: 1px の細い線も途切れずに壁になる
      ta = t;
    }
    if(tb > 0.0){
      for(int j = 0; j < 5; j++){ float tm = 0.5 * (ta + tb); if(maskV(tuv(d, tm)) >= 0.35) tb = tm; else ta = tm; }
      vec2 uvH = tuv(d, tb), e = 1.5 / uRes;
      vec2 n2 = sideN(uvH);                                                      // 形の外向き
      vec4 c = sideCol(uvH, n2);                                                 // 縁の色を内側から拾う (厚み 0 付近はその場の色 = 元画面と一致)
      vec3 col = uUseAlpha > 0.5 ? c.rgb / max(c.a, 1e-3) : c.rgb;
      vec3 N = normalize(vec3(rot(normalize(vec2(n2.x / uAsp, n2.y) + 1e-6), twA(d, tb)), 1e-3));   // 断面の法線をひねりの分だけ回す
      float lit = max(dot(N, normalize(vec3(-0.45, 0.8, 0.4))), 0.0);
      float fz = clamp(-(uEye.z + d.z * tb) / max(uT, 1e-5), 0.0, 1.0);          // 奥行きの割合 (奥ほど暗く)
      B = vec4(col * mix(1.0, 0.25 + 0.6 * lit * (1.0 - 0.35 * fz), uShade * min(1.0, uT / 0.02)), 1.0);   // 厚み 0 付近は陰影なし (縁の画素が元の色のまま)
    } else if(uUseAlpha < 0.5){
      vec2 uv1 = uvAt(d, t1);                                                    // 地は奥に床として残る
      if(inB(uv1)) B = vec4(src(uv1).rgb, 1.0);
    }
  }
  frag = F + B * (1.0 - cov);
}`;
const U = {};
function uloc(gl, p, n){ const m = U[n] || (U[n] = new WeakMap()); let l = m.get(p); if(l === undefined){ l = gl.getUniformLocation(p, n); m.set(p, l); } return l; }
const num = (v, d)=>{ v = +v; return isFinite(v) ? v : d; };

Fx3d.EXTRA.extrude = {
  ov: true,
  render(gl, o){
    const H = o.heightOnly ? GL._fx3dHeightTarget(o.w, o.h) : null;
    if(H){ H.valid = false; if(!H.ready) return false; }
    const pr = o.heightOnly
      ? Fx3d.prog(gl, 'extrudeHeight', VS, this._hfs || (this._hfs = HEIGHT_FS.replace('//RELIEF', GL.reliefGLSL())))
      : Fx3d.prog(gl, 'extrude', VS, this._fs || (this._fs = FS.replace('//RELIEF', GL.reliefGLSL())));   // 深度 (vjRelief) は FS で読む
    if(!pr) return false;
    const post = o.post || {}, asp = o.asp, k = o.k, t = o.clock || 0;
    const dep = o.dz(num(post.fx3dExtrudeDepth, 0.5)), tilt = o.dz(num(post.fx3dExtrudeTilt, 0.5));
    const spin = o.dz(num(post.fx3dExtrudeSpin, 0.3)), shade = o.dz(num(post.fx3dExtrudeShade, 0.5));
    const tw = k * o.dz(num(post.fx3dExtrudeTwist, 0)) * Math.PI / 2;   // ひねり (厚み全体で最大 ±90°)
    if(!o.heightOnly && post.fx3dExtrudeMode === 'rock' && typeof RockMesh !== 'undefined'){
      // Rock: 表示中のシェーダが SDF を持つ (S035 Flowing Metal) なら、その形をポリゴンに。帯の配置と模様を関数で持つ (S091 SigInt Bands) なら、帯を厚みのある板に。
      //   見えているスロットを優先し (A → B。3D Slot で指定があればそのスロットだけ)、見えていないスロットのシェーダは使わない。どちらでもなければ Depth と同じ
      const keys = post.fx3dSlot === 'A' ? ['A'] : post.fx3dSlot === 'B' ? ['B'] : ['A', 'B'];
      const cf = Math.max(0, Math.min(1, App.crossfade != null ? +App.crossfade : 0));
      const seen = k=> App.slotVisibleAmount(k) > 0 && (keys.length === 1 || (k === 'A' ? cf < 0.999 : cf > 0.001));
      for(const sk of keys.filter(seen).sort((a, b)=> (a === 'B' ? cf : 1 - cf) > (b === 'B' ? cf : 1 - cf) ? -1 : 1)){
        const sl = GL.slots[sk];
        if(RockMesh.supports(sl) && this._rockMesh(gl, o, post, k, t, sl)) return true;
        if(typeof BandMesh !== 'undefined' && BandMesh.supports(sl) && this._rockMesh(gl, o, post, k, t, sl, true)) return true;
      }
    }
    const T = k * (0.03 + 0.47 * dep) * Fx3d.popAt('extrude', 0);   // 厚み (画面の高さ = 2)。3D Pop で弾んで出る
    const mode = (post.fx3dExtrudeMode === 'depth' || post.fx3dExtrudeMode === 'rock') ? 1 : 0;
    const rPx = mode ? 0 : o.dz(num(post.fx3dExtrudeRound, 0)) * 24 * (o.h / 1080);   // 角丸の半径 (px。1080p で最大 24px)
    const Rz = Math.min(T, rPx / (o.h / 2));                                          // 角丸の深さ (画面の座標。厚みを超えない)
    let ph;
    if(o.beatMode){ const b = o.beat || 0, f = b - Math.floor(b), y = 1 - f; ph = (Math.floor(b) + 1 - y * y * y) * spin * Math.PI / 2; }
    else ph = t * spin * 1.2;
    const tl = k * tilt * 0.75;   // 傾き (全開で約 43°)
    const az = tl * Math.sin(ph + 0.8), el = tl * (0.45 + 0.25 * Math.cos(ph * 0.7));
    const cam = o.heightOnly ? null : Fx3d.camera(asp, az, el, 1.35 + 0.3 * k * tilt);
    // 厚みの中を進む歩数は画素ごとにシェーダで決める (stepsFor)。ここは歩幅と上限だけ。Depth は地形がなめらかなので歩幅 2px (+ 二分探索)
    const stepPx = mode ? 2 : 1, steps = mode ? 160 : 256;
    gl.bindFramebuffer(gl.FRAMEBUFFER, H ? H.fbo : o.fbo);
    gl.viewport(0, 0, o.w, o.h);
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(pr);
    if(!GL._emptyVAO) GL._emptyVAO = gl.createVertexArray();
    gl.bindVertexArray(GL._emptyVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, o.srcTex);
    gl.uniform1i(uloc(gl, pr, 'uTex'), 0);
    gl.uniform1i(uloc(gl, pr, 'uSamples'), 8);
    if(cam){
      const v = cam.view;
      gl.uniform3fv(uloc(gl, pr, 'uEye'), cam.eye);
      gl.uniform3f(uloc(gl, pr, 'uXc'), v[0], v[4], v[8]);
      gl.uniform3f(uloc(gl, pr, 'uYc'), v[1], v[5], v[9]);
      gl.uniform3f(uloc(gl, pr, 'uZc'), v[2], v[6], v[10]);
    }
    gl.uniform2f(uloc(gl, pr, 'uRes'), o.w, o.h);
    gl.uniform1f(uloc(gl, pr, 'uAsp'), asp);
    gl.uniform1f(uloc(gl, pr, 'uT'), T);
    gl.uniform1f(uloc(gl, pr, 'uShade'), shade);
    gl.uniform1f(uloc(gl, pr, 'uTwist'), tw);
    gl.uniform1f(uloc(gl, pr, 'uMode'), mode);
    gl.uniform1f(uloc(gl, pr, 'uRound'), rPx);
    gl.uniform1f(uloc(gl, pr, 'uRz'), Rz);
    // 背景が透過で来るフレーム (紙抜き / 前の 3D 段が描いた) は alpha で形を取る
    gl.uniform1f(uloc(gl, pr, 'uUseAlpha'), (GL._matte || GL._fx3dBgNeed) ? 1 : 0);
    gl.uniform1f(uloc(gl, pr, 'uSteps'), steps);
    gl.uniform1f(uloc(gl, pr, 'uStepPx'), stepPx);
    Fx3d.ovUniforms(gl, pr, o);
    Fx3d.reliefUniforms(gl, pr);   // 表示中のシェーダの深度 (Depth で使う)
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    if(H){
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // メッシュのセル幅に応じて読む mip を作る。素材の unit 0 は元のままに戻す。
      gl.activeTexture(gl.TEXTURE0 + 11);
      gl.bindTexture(gl.TEXTURE_2D, H.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.activeTexture(gl.TEXTURE0);
      H.os = (o.ovM || [0, 0]).map(v=>2 * v);
      H.frame = GL.frame;
      H.valid = true;
    }
    return true;
  },
  // Rock (SDF のポリゴン): RockMesh で形を作り直し、縦軸まわりに回るカメラで描く (横・裏も本物の形)
  _rockMesh(gl, o, post, k, t, slot, bands){
    if(!bands && !RockMesh.update(gl, slot)) return false;
    const asp = o.asp, tilt = o.dz(num(post.fx3dExtrudeTilt, 0.5)), spin = o.dz(num(post.fx3dExtrudeSpin, 0.3));
    let ph;
    if(o.beatMode){ const b = o.beat || 0, f = b - Math.floor(b), y = 1 - f; ph = (Math.floor(b) + 1 - y * y * y) * spin * Math.PI / 2; }
    else ph = t * spin * 1.2;
    const az = k * ph, el = k * tilt * 0.75 * (0.45 + 0.25 * Math.cos(ph * 0.7));
    const cam = Fx3d.camera(asp, az, el, 1.35 + k * (1.2 + 0.8 * tilt));   // 回すぶん離れて、岩の中に入らない
    const M = Fx3d.msaa(gl, o.w, o.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, M.fbo);
    gl.viewport(0, 0, o.w, o.h);
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if(bands){
      const dep = o.dz(num(post.fx3dExtrudeDepth, 0.5)), shade = o.dz(num(post.fx3dExtrudeShade, 0.5));
      BandMesh.draw(gl, slot, M.fbo, o.w, o.h, cam.view, cam.proj, k, asp, 0.05 + 0.5 * dep, shade * Math.min(1, k / 0.35));   // 板の厚み = Depth
    } else RockMesh.draw(gl, slot, M.fbo, o.w, o.h, cam.view, cam.proj, k, asp);
    Fx3d.resolve(gl, o.fbo, o.w, o.h);
    return true;
  },
};
})();
