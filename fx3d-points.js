'use strict';
/* 3D FX: points = 画面を点群にして、明るさを奥行きに取り、音で散らす (Fx3d.EXTRA.points)。
   契約は fx3d.js の EXTRA のコメント参照。
   点は面を埋められないので、この案だけ出始めに短いクロスフェードがある (不透明度 a0 = smoothstep(0, 0.25, k))。
   点は元の画面と同じ位置・同じ色から出るので、a0 が 0 に近い出始めは元画面と一致 (0.10 の境界で跳ねない)。
   gl.POINTS (gl_VertexID から格子を作る) + 深度テスト、FS で円の外を discard。 */
(function(){
  const VS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform mat4 uView, uProj;
uniform float uAsp, uCols, uRows, uK, uHit, uT, uSign, uCellPx, uDist, uMaxPt;
out vec3 vCol;
out float vA;
float h1(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  int cols = int(uCols);
  int cx = gl_VertexID % cols, cy = gl_VertexID / cols;
  vec2 cell = vec2(float(cx), float(cy));
  vec2 uv = fx3dAB((cell + 0.5) / vec2(uCols, uRows));   // 3D Overscan: 点の格子は素材の余白まで広げる
  vec4 c4 = textureLod(uTex, fx3dSrcC(uv), 0.0);
  vec3 c = c4.rgb;
  vA = c4.a;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vec2 q = (uv - 0.5) * 2.0 * vec2(uAsp, 1.0);
  vec3 P = vec3(q, (l - 0.5) * 1.2 * uK * uSign);
  float r1 = h1(cell + 0.3), r2 = h1(cell + 3.3);
  vec3 dir = vec3(r1, r2, h1(cell + 9.1)) * 2.0 - 1.0;
  P += dir * (0.08 * uK * uK * sin(uT * 0.6 + r1 * 6.2832) + 0.45 * uHit * uK * r2);   // 漂い + ヒットで散る
  vec4 vp = uView * vec4(P, 1.0);
  gl_Position = fx3dApply(uProj * vp);
  float viewZ = max(0.05, -vp.z);
  float pp = fx3dPop(float(gl_VertexID));   // ポップ: 点ごとに大きさが弾む (0 の点は描かない)
  gl_PointSize = min(uMaxPt, max(1.0, uCellPx * (1.15 - 0.45 * uK) * (uDist / viewZ) * pp));
  if(pp < 0.02) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vCol = c;
}`;
  const FS = `#version 300 es
precision highp float;
uniform float uA0;
in vec3 vCol;
in float vA;
out vec4 frag;
void main(){
  float d = length(gl_PointCoord - 0.5);
  if(d > 0.5 || vA < 0.5) discard;   // 前の段が抜いた背景の点は出さない
  frag = vec4(vCol, 1.0) * uA0;
}`;

  // Needle (最後に掛かる): 点を 1 つずつ角錐の針にする (底は Max Sides の辺数の多角形、頂点は手前 +z へ。GL.needleCellGLSL の高さ = 突起 / 凹み)。
  //   底の大きさは点と同じ (Thick 倍)、高さは底の大きさに比例 (Length)。点の代わりに描く
  const NV_VS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform mat4 uView, uProj;
uniform float uAsp, uCols, uRows, uK, uHit, uT, uSign, uSides, uThick;
out vec3 vCol; out vec3 vW;
out float vA;
float h1(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  int sides = int(uSides), per = sides * 3;
  int pt = gl_VertexID / per, r = gl_VertexID - pt * per;
  int tri = r / 3, cn = r - tri * 3;
  int cols = int(uCols);
  int cx = pt % cols, cy = pt / cols;
  vec2 cell = vec2(float(cx), float(cy));
  vec2 uv = fx3dAB((cell + 0.5) / vec2(uCols, uRows));
  vec4 c4 = textureLod(uTex, fx3dSrcC(uv), 0.0);
  vec3 c = c4.rgb;
  vA = c4.a;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vec2 q = (uv - 0.5) * 2.0 * vec2(uAsp, 1.0);
  vec3 P = vec3(q, (l - 0.5) * 1.2 * uK * uSign);
  float r1 = h1(cell + 0.3), r2 = h1(cell + 3.3);
  vec3 dir = vec3(r1, r2, h1(cell + 9.1)) * 2.0 - 1.0;
  P += dir * (0.08 * uK * uK * sin(uT * 0.6 + r1 * 6.2832) + 0.45 * uHit * uK * r2);
  float pp = fx3dPop(float(pt));
  float cl = 2.0 * (1.0 + 2.0 * uOvM.y) / uRows * (1.15 - 0.45 * uK) * uThick * pp;   // 底の差し渡し = 点の大きさ
  if(cn == 0){
    vec2 key = cell * vec2(1.37, 2.11) + 31.7;
    P.z += fx3dNeedleH(key, uv * vec2(uAsp, 1.0) * 3.2) * cl;
  } else {
    float an = (float(tri + cn - 1) + h1(cell + 5.7)) * 6.2831853 / uSides;
    P.xy += vec2(cos(an), sin(an)) * 0.5 * cl;
  }
  vW = P;
  gl_Position = fx3dApply(uProj * uView * vec4(P, 1.0));
  if(pp < 0.02) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vCol = c;
}`;
  const NV_FS = `#version 300 es
precision highp float;
uniform float uA0;
uniform vec3 uEye;
in vec3 vCol; in vec3 vW;
in float vA;
out vec4 frag;
${Fx3d.GLSL_LIT}
void main(){
  if(vA < 0.5) discard;
  frag = vec4(fx3dLit(vCol, vW, uEye, 1.0), 1.0) * uA0;
}`;

  const hash = (n)=>{ const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const smooth01 = (a, b, x)=>{ const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  Fx3d.EXTRA.points = {
    ov: true,
    foldHook: true,
    spikes: true,
    render(gl, o){
      const sf = Fx3d.spikeFrame;
      const nvp = sf ? Fx3d.prog(gl, 'pointsNeedle', NV_VS, NV_FS) : null;
      const p = nvp || Fx3d.prog(gl, 'points', VS, FS);
      if(!p) return false;
      let D = Math.max(60, Math.min(400, Math.round(+(o.post && o.post.fx3dPointsDensity) || 200)));
      const om = o.ovM || [0, 0];
      const sides = sf && sf.sides != null ? sf.sides : 5;
      if(nvp){   // Needle: 頂点数 (点 × 辺数 × 3) が 1.5M を超えるなら点を粗くする (縦長・Overscan で増える)
        const v = D * (1 + 2 * om[0]) * Math.ceil(D / o.asp) * (1 + 2 * om[1]) * sides * 3;
        if(v > 1500000) D = Math.max(20, Math.floor(D * Math.sqrt(1500000 / v)));
      }
      const rows = Math.max(1, Math.ceil(D / o.asp));
      const k = o.k, t = o.clock;
      // beat: 拍ごとに奥行きの向き (手前 / 奥) を Ease Out で入れ替える。drone は常に明るいほど手前
      let sign = 1;
      if(o.beatMode){
        const bid = Math.floor(o.beat), f = o.beat - bid;
        const ease = 1 - Math.pow(1 - Math.min(1, f / 0.24), 3);
        const sb = (b)=>hash(b) > 0.35 ? 1 : -1;
        sign = sb(bid) + (sb(bid + 1) - sb(bid)) * ease;
      }
      const az = 0.6 * k * Math.sin(0.25 * t), el = 0.2 * k * Math.sin(0.19 * t);
      const dist = 1.35 + 0.4 * k;
      const cam = Fx3d.camera(o.asp, az, el, dist);
      const maxPt = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, nvp ? Fx3d.msaa(gl, o.w, o.h).fbo : o.fbo);   // Needle の細い角錐は MSAA で描く
      gl.viewport(0, 0, o.w, o.h);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.useProgram(p);
      if(!GL._emptyVAO) GL._emptyVAO = gl.createVertexArray();
      gl.bindVertexArray(GL._emptyVAO);
      const u = (n)=>gl.getUniformLocation(p, n);
      gl.uniformMatrix4fv(u('uView'), false, cam.view);
      gl.uniformMatrix4fv(u('uProj'), false, cam.proj);
      gl.uniform1f(u('uAsp'), o.asp);
      // 3D Overscan: 余白の分だけ点を増やして画面の外まで並べる (点の大きさ・間隔は画面の中と同じ)
      const cols2 = Math.round(D * (1 + 2 * om[0])), rows2 = Math.round(rows * (1 + 2 * om[1]));
      gl.uniform1f(u('uCols'), cols2);
      gl.uniform1f(u('uRows'), rows2);
      Fx3d.ovUniforms(gl, p, o);
      gl.uniform1f(u('uK'), k);
      gl.uniform1f(u('uHit'), o.hit);
      gl.uniform1f(u('uT'), t);
      gl.uniform1f(u('uSign'), sign);
      gl.uniform1f(u('uCellPx'), Math.max(o.w / D, o.h / rows));
      gl.uniform1f(u('uDist'), dist);
      gl.uniform1f(u('uMaxPt'), maxPt);
      gl.uniform1f(u('uA0'), smooth01(0, 0.25, k));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, o.srcTex);
      gl.uniform1i(u('uTex'), 0);
      Fx3d.popUniforms(gl, p, 'points');
      Fx3d.fold(gl, p, cam.proj, 1.35);   // 最後の段なら折りを物体へ (それ以外は uFx3dOn = 0)
      if(nvp){
        gl.uniform1f(u('uSides'), sides);
        gl.uniform1f(u('uThick'), sf.thick || 1);
        gl.uniform3fv(u('uEye'), cam.eye);
        Fx3d.spikeUniforms(gl, p);
        gl.drawArrays(gl.TRIANGLES, 0, cols2 * rows2 * sides * 3);
        Fx3d.resolve(gl, o.fbo, o.w, o.h);
      } else gl.drawArrays(gl.POINTS, 0, cols2 * rows2);
      return true;
    },
  };
})();
