'use strict';
/* 3D FX: diorama = 明るさで画面を N 層の切り絵に分け、奥行きに並べて視差を出す (Fx3d.EXTRA.diorama)。
   契約は fx3d.js の EXTRA のコメント参照。
   全面クアッドを奥から N 枚 (深度テストなし、前乗算ブレンド)。層 l は「明るさ >= l/N」の画素だけ (最下層は全面)。
   明るい画素ほど手前の層に乗る。各層は画面を満たす大きさに補正する (視差は層の位置とカメラの振りだけで出る)。
   k = 0 で全層が z=0・dist 1.35 の正面・影 0 (同じ色を重ねるだけ) = 元画面と一致。 */
(function(){
  const VS = `#version 300 es
uniform mat4 uView, uProj;
uniform float uAsp, uN, uGap, uDist, uMargin;
out vec2 vUv;
flat out int vLayer;
uniform int uGrid;
#define G uGrid   // 層を G×G に分割 (折りの線が層の中で曲がるように)
void main(){
  int layer = gl_VertexID / (G * G * 6);
  int r = gl_VertexID - layer * G * G * 6;
  int cell = r / 6, c = r - cell * 6;
  int gy = cell / G, gx = cell - gy * G;
  // 2 三角形: (0,0)(1,0)(0,1) (1,0)(1,1)(0,1)
  vec2 u = (vec2(float(gx), float(gy)) + vec2(float((c == 1 || c == 3 || c == 4) ? 1 : 0), float((c == 2 || c == 4 || c == 5) ? 1 : 0))) / float(G);
  float z = (float(layer) - (uN - 1.0) * 0.5) * uGap;
  vec2 q = (u - 0.5) * 2.0 * vec2(uAsp, 1.0);                 // 紙座標 (uv 0..1 が画面)
  float sc = (uDist - z) / 1.35 * uMargin;                    // 層ごとに画面を満たす大きさへ (正面から見たら全層が同じ大きさ)
  vUv = 0.5 + (u - 0.5) * uMargin;                            // 余白ぶんは uv が 0..1 の外へ出る (FS でミラー)
  z += fx3dHeight(vUv);
  vLayer = layer;
  gl_Position = fx3dApply(fx3dShape(uProj * uView * vec4(q * sc * fx3dPop(float(layer)), z, 1.0), vUv));   // ポップ: 層ごとに中心から
}`;
  const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uN, uK;
uniform vec2 uShadowOff;
in vec2 vUv;
flat in int vLayer;
out vec4 frag;
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
vec2 mirror(vec2 p){ return fx3dSrc(p); }   // 余白は素材の余白 (3D Overscan)、その外はミラー
void main(){
  vec2 uv = mirror(vUv);
  vec4 t0 = texture(uTex, uv);
  if(t0.a < 0.5) discard;   // 前の段 (3D FX) が抜いた背景は描かない = 前の段の物体だけがこの段に乗る
  vec3 c = t0.rgb;
  float l = luma(c);
  float layer = float(vLayer);
  float thr = layer / uN;
  float a = vLayer == 0 ? 1.0 : smoothstep(thr - 0.015, thr + 0.015, l);
  if(a <= 0.0) discard;
  if(vLayer < int(uN) - 1 && uK > 0.0){
    // 上の層が落とす影: 少しずらした位置が上の層の中なら、(この層は上の層に覆われていない所で) 暗くする
    float t1 = (layer + 1.0) / uN;
    float l2 = luma(texture(uTex, mirror(vUv + uShadowOff)).rgb);
    float sh = smoothstep(t1 - 0.015, t1 + 0.015, l2) * (1.0 - smoothstep(t1 - 0.015, t1 + 0.015, l));
    c *= 1.0 - 0.35 * uK * sh;
  }
  frag = vec4(fx3dFoldShade(fx3dShapeShade(c, c)) * a, a);
}`;

  // Needle (最後に掛かる): 各層を GL.needleCellGLSL の針の面で覆い、層の法線 (手前 +z) へ突起 / 凹み。元の層の代わりに描く。
  //   切り抜きは元と同じ (明るさ >= 層の閾値の画素だけ)。針が上下の層を突き抜けるので、深度テストありの不透明で描く
  const NV_VS = `#version 300 es
precision highp float;
uniform mat4 uView, uProj;
uniform float uAsp, uN, uGap, uDist, uMargin;
uniform vec2 uNvGrid;
uniform float uNvSub;
out vec2 vUv; out vec3 vW;
flat out int vLayer;
void main(){
  int per = (int(uNvGrid.x) + 2) * (int(uNvGrid.y) + 2) * 18 * int(uNvSub) * int(uNvSub);
  int layer = gl_VertexID / per, vid = gl_VertexID - layer * per;
  vec2 u; float w; vec2 key;
  fx3dNeedleVert(vid, uNvGrid, uNvSub, vec2(float(layer) * 3.7 + 0.3, 2.9), u, w, key);
  float z = (float(layer) - (uN - 1.0) * 0.5) * uGap;
  float sc = (uDist - z) / 1.35 * uMargin;
  vUv = 0.5 + (u - 0.5) * uMargin;
  float cl = 0.6 * 2.0 * sc / uNvGrid.y;                      // 格子 1 つぶんの長さ。カメラが近く層が画面より広いぶん、見かけを Layers の針にそろえて 0.6 倍
  float pp = fx3dPop(float(layer));
  vec3 P = vec3((u - 0.5) * 2.0 * vec2(uAsp, 1.0) * sc * pp, z + w * fx3dNeedleH(key, vUv * vec2(uAsp, 1.0) * 3.2) * cl * pp);
  vLayer = layer;
  P.z += fx3dHeight(vUv);
  vW = P;
  gl_Position = fx3dApply(fx3dShape(uProj * uView * vec4(P, 1.0), vUv));
}`;
  const NV_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uN;
uniform vec3 uEye;
in vec2 vUv; in vec3 vW;
flat in int vLayer;
out vec4 frag;
${Fx3d.GLSL_LIT}
void main(){
  vec4 t0 = texture(uTex, fx3dSrc(vUv));
  if(t0.a < 0.5) discard;
  if(vLayer > 0 && dot(t0.rgb, vec3(0.299, 0.587, 0.114)) < float(vLayer) / uN) discard;
  frag = vec4(fx3dFoldShade(fx3dShapeShade(fx3dLit(t0.rgb, vW, uEye, 1.0), t0.rgb)), 1.0);
}`;

  const hash = (n)=>{ const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  Fx3d.EXTRA.diorama = {
    ov: true,
    foldHook: true,
    spikes: true,
    render(gl, o){
      const nvp = Fx3d.spikeFrame ? Fx3d.prog(gl, 'dioramaNeedle', NV_VS, NV_FS) : null;
      const p = nvp || Fx3d.prog(gl, 'diorama', VS, FS);
      if(!p) return false;
      const N = Fx3d.popCount('diorama', Math.max(2, Math.min(24, Math.round(+(o.post && o.post.fx3dDioramaLayers) || 8))), false);   // 層数を変えると区切りが全部変わる = 全層が縮んでから出直す
      const k = o.k, t = o.clock;
      // カメラ (FX タブの Diorama の詳細): Swing = 振りの大きさ (0.5 = 従来、0 = 止める) / Speed = 振りの速さ (drone は角速度、beat は向きを替える拍数 4〜1/4)
      //   Pan / Tilt = 振りの中心の向き (左右 / 上下) / Zoom = 寄り (+) と引き (-)
      const post = o.post || {}, dz = (v, d)=>App.deadParam(v != null ? +v : d);
      const swing = 2 * Math.max(0, dz(post.fx3dDioramaSwing, 0.5)), speed = Math.max(0, Math.min(1, dz(post.fx3dDioramaSpeed, 0.5)));
      const pan = dz(post.fx3dDioramaPan, 0), tilt = dz(post.fx3dDioramaTilt, 0), zoom = dz(post.fx3dDioramaZoom, 0);
      // 振り: drone = ゆっくり連続、beat = 拍ごとの乱数の向きへ Ease Out (Needle と同じ bid / ease)
      const ts = t * 2 * speed;
      let az = 0.35 * Math.sin(0.3 * ts), el = 0.22 * Math.sin(0.23 * ts);
      if(o.beatMode){
        const step = Math.pow(2, Math.round((0.5 - speed) * 4));   // Speed 0.5 = 1 拍ごと、0 = 4 拍、1 = 1/4 拍
        const b = o.beat / step, bid = Math.floor(b), f = b - bid;
        const ease = 1 - Math.pow(1 - Math.min(1, f / 0.24), 3);
        const A = (b)=>[(hash(b) * 2 - 1) * 0.4, (hash(b + 17.3) * 2 - 1) * 0.22];
        const a0 = A(bid), a1 = A(bid + 1);
        az = a0[0] + (a1[0] - a0[0]) * ease; el = a0[1] + (a1[1] - a0[1]) * ease;
      }
      az = (az * swing + pan * 1.1) * k; el = (el * swing + tilt * 0.65) * k;
      const dist = (1.35 + 0.35 * k) * (1 - 0.45 * zoom * k);
      const gap = (0.6 * k + 0.25 * o.hit * k) / N;
      const cam = Fx3d.camera(o.asp, az, el, dist);
      const margin = 1 + 3.5 * k;
      if(nvp) return this._needle(gl, o, nvp, N, gap, dist, margin, cam);
      const wasCull = gl.isEnabled(gl.CULL_FACE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, o.fbo);
      gl.viewport(0, 0, o.w, o.h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if(Fx3d.shapeFrame){ gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); }
      else gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(p);
      if(!GL._emptyVAO) GL._emptyVAO = gl.createVertexArray();
      gl.bindVertexArray(GL._emptyVAO);
      const u = (n)=>gl.getUniformLocation(p, n);
      gl.uniformMatrix4fv(u('uView'), false, cam.view);
      gl.uniformMatrix4fv(u('uProj'), false, cam.proj);
      gl.uniform1f(u('uAsp'), o.asp);
      gl.uniform1f(u('uN'), N);
      gl.uniform1f(u('uGap'), gap);
      gl.uniform1f(u('uDist'), dist);
      gl.uniform1f(u('uMargin'), margin);
      gl.uniform1f(u('uK'), k);
      const so = 0.03 * k * (1 + o.hit);
      gl.uniform2f(u('uShadowOff'), so, -so * 1.3);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, o.srcTex);
      gl.uniform1i(u('uTex'), 0);
      Fx3d.popUniforms(gl, p, 'diorama');
      Fx3d.ovUniforms(gl, p, o);
      Fx3d.fold(gl, p, cam.proj, 1.35, cam.view);   // 最後の段なら折りを物体へ (それ以外は uFx3dOn = 0)
      const grid = Fx3d.shapeFrame || (GL._fx3dHeight?.valid && App.post.fx3dStack !== 'chain') ? 48 : 12;
      gl.uniform1i(u('uGrid'), grid);
      GL._fx3dHeightBind(p, [1 / grid, 1 / grid]);
      gl.drawArrays(gl.TRIANGLES, 0, N * grid * grid * 6);
      gl.disable(gl.BLEND);
      if(wasCull) gl.enable(gl.CULL_FACE);
      return true;
    },
    _needle(gl, o, p, N, gap, dist, margin, cam){
      // 層は画面の margin 倍の広さ。格子の細かさは画面に対して Layers と同じ (画面の高さの 1/14 が目安)、頂点数が多すぎれば粗くする
      let gy = Math.max(Math.round(Fx3d.nvScale(6)), Math.round(Fx3d.nvScale(14 * margin))), gx = Math.max(1, Math.round(gy * o.asp));
      let sub = Fx3d.foldFrame ? 2 : 1;
      while(sub > 1 && N * GL.needleCellVerts(gx, gy, sub) > 1500000) sub--;
      while(gy > 6 && N * GL.needleCellVerts(gx, gy, sub) > 1500000){ gy--; gx = Math.max(1, Math.round(gy * o.asp)); }
      const M = Fx3d.msaa(gl, o.w, o.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, M.fbo);
      gl.viewport(0, 0, o.w, o.h);
      gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      gl.clearColor(0, 0, 0, 0); gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(p);
      if(!GL._emptyVAO) GL._emptyVAO = gl.createVertexArray();
      gl.bindVertexArray(GL._emptyVAO);
      const u = (n)=>gl.getUniformLocation(p, n);
      gl.uniformMatrix4fv(u('uView'), false, cam.view);
      gl.uniformMatrix4fv(u('uProj'), false, cam.proj);
      gl.uniform3fv(u('uEye'), cam.eye);
      gl.uniform1f(u('uAsp'), o.asp);
      gl.uniform1f(u('uN'), N);
      gl.uniform1f(u('uGap'), gap);
      gl.uniform1f(u('uDist'), dist);
      gl.uniform1f(u('uMargin'), margin);
      gl.uniform2f(u('uNvGrid'), gx, gy);
      gl.uniform1f(u('uNvSub'), sub);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, o.srcTex);
      gl.uniform1i(u('uTex'), 0);
      Fx3d.popUniforms(gl, p, 'diorama');
      Fx3d.ovUniforms(gl, p, o);
      Fx3d.spikeUniforms(gl, p);
      GL._fx3dHeightBind(p, [1 / gx, 1 / gy]);
      Fx3d.fold(gl, p, cam.proj, 1.35, cam.view);
      gl.drawArrays(gl.TRIANGLES, 0, N * GL.needleCellVerts(gx, gy, sub));
      gl.bindVertexArray(null);
      Fx3d.resolve(gl, o.fbo, o.w, o.h);
      return true;
    },
  };
})();
