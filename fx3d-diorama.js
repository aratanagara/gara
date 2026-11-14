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
void main(){
  int layer = gl_VertexID / 6;
  int c = gl_VertexID % 6;
  // 2 三角形: (0,0)(1,0)(0,1) (1,0)(1,1)(0,1)
  vec2 u = vec2(float((c == 1 || c == 3 || c == 4) ? 1 : 0), float((c == 2 || c == 4 || c == 5) ? 1 : 0));
  float z = (float(layer) - (uN - 1.0) * 0.5) * uGap;
  vec2 q = (u - 0.5) * 2.0 * vec2(uAsp, 1.0);                 // 紙座標 (uv 0..1 が画面)
  float sc = (uDist - z) / 1.35 * uMargin;                    // 層ごとに画面を満たす大きさへ (正面から見たら全層が同じ大きさ)
  vUv = 0.5 + (u - 0.5) * uMargin;                            // 余白ぶんは uv が 0..1 の外へ出る (FS でミラー)
  vLayer = layer;
  gl_Position = uProj * uView * vec4(q * sc, z, 1.0);
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
vec2 mirror(vec2 p){ return 1.0 - abs(1.0 - mod(p, 2.0)); }
void main(){
  vec2 uv = mirror(vUv);
  vec3 c = texture(uTex, uv).rgb;
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
  frag = vec4(c * a, a);
}`;

  const hash = (n)=>{ const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  Fx3d.EXTRA.diorama = {
    render(gl, o){
      const p = Fx3d.prog(gl, 'diorama', VS, FS);
      if(!p) return false;
      const N = Math.max(2, Math.min(24, Math.round(+(o.post && o.post.fx3dDioramaLayers) || 8)));
      const k = o.k, t = o.clock;
      // カメラの振り: drone = ゆっくり連続、beat = 拍ごとの乱数の向きへ Ease Out (Needle と同じ bid / ease)
      let az = 0.35 * Math.sin(0.3 * t), el = 0.22 * Math.sin(0.23 * t);
      if(o.beatMode){
        const bid = Math.floor(o.beat), f = o.beat - bid;
        const ease = 1 - Math.pow(1 - Math.min(1, f / 0.24), 3);
        const A = (b)=>[(hash(b) * 2 - 1) * 0.4, (hash(b + 17.3) * 2 - 1) * 0.22];
        const a0 = A(bid), a1 = A(bid + 1);
        az = a0[0] + (a1[0] - a0[0]) * ease; el = a0[1] + (a1[1] - a0[1]) * ease;
      }
      az *= k; el *= k;
      const dist = 1.35 + 0.35 * k;
      const gap = (0.6 * k + 0.25 * o.hit * k) / N;
      const cam = Fx3d.camera(o.asp, az, el, dist);
      const wasCull = gl.isEnabled(gl.CULL_FACE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, o.fbo);
      gl.viewport(0, 0, o.w, o.h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
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
      gl.uniform1f(u('uMargin'), 1 + 3.5 * k);
      gl.uniform1f(u('uK'), k);
      const so = 0.03 * k * (1 + o.hit);
      gl.uniform2f(u('uShadowOff'), so, -so * 1.3);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, o.srcTex);
      gl.uniform1i(u('uTex'), 0);
      gl.drawArrays(gl.TRIANGLES, 0, N * 6);
      gl.disable(gl.BLEND);
      if(wasCull) gl.enable(gl.CULL_FACE);
      return true;
    },
  };
})();
