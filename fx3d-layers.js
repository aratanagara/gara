'use strict';
/* 3D FX: layers — 画面と同じ形の板を揃えたまま奥へ等間隔に積み、拍ごとに回転の波が 1 枚ずつ遅れて積層を通り抜ける (Fx3d.EXTRA.layer)。
   契約は fx3d.js の EXTRA のコメント参照。fx3dLayerCount = 板の枚数 / fx3dLayerSize = 板の大きさ (%) / fx3dLayerEdge = 板の縁の線。
   回転は拍ごとに軸 (縦 / 横 / 面内) と向きを選んで 1 周 (1 周なので拍の切り目で絵が跳ねない)。積層全体も回り続け、拍頭で板の間隔がふっと開く。
   drone は 0.5 拍/秒の仮想の拍で同じ動き。k = 0 で全部の板が z = 0 で画面に重なり、回転 0・正面カメラ = 元画面と画素一致。
   板は 8 × 8 に分割してある (折り系を物体へ掛けたとき、折り線が板の中で曲がるように)。 */
(function(){
const SUB = 8;                                     // 板の分割 (SUB × SUB マス)
const PER = SUB * SUB * 6;                         // 板 1 枚あたりの頂点数
// 板 pl の面内座標 ab (0..1) → 位置。ctr = 板の中心
const SURF = `
uniform float uAsp, uK, uN, uBeat, uSize, uGap, uSpinY, uSpinX, uSpinW;
float h1(float p){ return fract(sin(p * 127.1 + 311.7) * 43758.5453); }
float easeOut(float x){ float y = 1.0 - clamp(x, 0.0, 1.0); return 1.0 - y * y * y; }
vec3 rotY(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
vec3 rotX(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
vec3 rotZ(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }
vec3 layerSurf(int pl, vec2 ab, out vec3 ctr){
  float fi = float(pl), rel = fi / max(uN - 1.0, 1.0);
  float b = floor(uBeat), ph = fract(uBeat);
  vec3 P = vec3((ab - 0.5) * 2.0 * vec2(uAsp, 1.0) * uSize, 0.0);
  // 回転の波: 手前の板から 1 枚ずつ遅れて 1 周。軸と向きは拍ごと
  float ax = floor(h1(b * 3.1) * 3.0), sg = h1(b * 5.7) < 0.5 ? 1.0 : -1.0;
  float ang = sg * easeOut((ph - rel * 0.45) / 0.5) * 6.2831853 * uK;
  if(ax < 0.5) P = rotY(P, ang); else if(ax < 1.5) P = rotX(P, ang); else P = rotZ(P, ang);
  float z = -fi * uGap + (uN - 1.0) * uGap * 0.5;
  P.z += z;
  ctr = vec3(0.0, 0.0, z);
  // 積層全体の回転 (量が小さいうちは回っていない姿勢と混ぜる = k → 0 で元の画面へ戻る)
  P = mix(P, rotX(rotY(P, uSpinY), uSpinX), uSpinW); ctr = mix(ctr, rotX(rotY(ctr, uSpinY), uSpinX), uSpinW);
  return P;
}
`;
const VS = `#version 300 es
precision highp float;
uniform mat4 uView, uProj;
out vec2 vUv; out vec3 vW;
${SURF}
void main(){
  int id = gl_VertexID, pl = id / ${PER}, q = id - pl * ${PER};
  int cell = q / 6, tv = q - cell * 6;
  vec2 ab = (tv == 0 || tv == 3) ? vec2(0.0, 0.0) : (tv == 1) ? vec2(1.0, 0.0) : (tv == 2 || tv == 4) ? vec2(1.0, 1.0) : vec2(0.0, 1.0);
  int cy = cell / ${SUB}, cx = cell - cy * ${SUB};
  ab = (vec2(float(cx), float(cy)) + ab) / float(${SUB});
  vec3 ctr;
  vec3 P = layerSurf(pl, ab, ctr);
  P = ctr + (P - ctr) * fx3dPop(float(pl));   // ポップ: 板ごとに中心から
  vUv = ab;
  vW = P;
  gl_Position = fx3dApply(uProj * uView * vec4(P, 1.0));
}`;
// 面を覆う針 (Needle): 各板を GL.needleCellGLSL の針の面 (三角形・四角形の角錐) で覆い、板の法線方向へ突起 / 凹み。元の板の代わりに描く
const NV_VS = `#version 300 es
precision highp float;
uniform mat4 uView, uProj;
uniform vec2 uNvGrid;
uniform float uNvSub;
out vec2 vUv; out vec3 vW;
${SURF}
void main(){
  int per = (int(uNvGrid.x) + 2) * (int(uNvGrid.y) + 2) * 18 * int(uNvSub) * int(uNvSub);
  int pl = gl_VertexID / per, vid = gl_VertexID - pl * per;
  vec2 ab; float w; vec2 key;
  fx3dNeedleVert(vid, uNvGrid, uNvSub, vec2(float(pl) * 3.7 + 0.3, 6.1), ab, w, key);
  const float E = 1e-3;
  vec3 ctr, c2;
  vec3 P0 = layerSurf(pl, ab, ctr);
  vec3 T = (layerSurf(pl, ab + vec2(E, 0.0), c2) - P0) / E;
  vec3 B = (layerSurf(pl, ab + vec2(0.0, E), c2) - P0) / E;
  vec3 N = normalize(cross(T, B));
  float cl = 0.5 * (length(T) / uNvGrid.x + length(B) / uNvGrid.y);   // 格子 1 つぶんの長さ
  vec3 P = P0 + N * (w * fx3dNeedleH(key, ab * vec2(uAsp, 1.0) * 3.2) * cl);
  P = ctr + (P - ctr) * fx3dPop(float(pl));
  vUv = ab;
  vW = P;
  gl_Position = fx3dApply(uProj * uView * vec4(P, 1.0));
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vW;
uniform sampler2D uTex; uniform vec3 uEye; uniform float uShade, uEdge;
out vec4 frag;
${Fx3d.GLSL_LIT}
void main(){
  vec4 t0 = texture(uTex, clamp(vUv, 0.0, 1.0));
  if(t0.a < 0.5) discard;   // 前の段 (3D FX) が抜いた背景は描かない = 前の段の物体だけがこの段に乗る
  vec3 c = fx3dLit(t0.rgb, vW, uEye, uShade);
  if(uEdge > 0.001){   // 板の縁の線 (Layers Edge。太さは画面上でほぼ一定)
    vec2 e = min(vUv, 1.0 - vUv) / max(fwidth(vUv), vec2(1e-5));
    c = mix(c, vec3(0.0), (1.0 - smoothstep(0.0, 1.0 + 3.0 * uEdge, min(e.x, e.y))) * uShade);
  }
  frag = vec4(fx3dFoldShade(c), 1.0);
}`;
const U = {};
function uloc(gl, p, n){ const m = U[n] || (U[n] = new WeakMap()); let l = m.get(p); if(l === undefined){ l = gl.getUniformLocation(p, n); m.set(p, l); } return l; }

Fx3d.EXTRA.layer = {
  foldHook: true,
  spikes: true,
  _spin: 0, _t: null,
  render(gl, o){
    const pr = Fx3d.prog(gl, 'layers', VS, FS);
    if(!pr) return false;
    const post = o.post || {};
    const asp = o.asp, k = o.k, t = o.clock || 0;
    const n = Fx3d.popCount('layer', Math.max(1, Math.min(40, Math.round(+post.fx3dLayerCount || 12))), true);   // 枚数を変えても既存の板は同じ (増減した分だけ弾む)
    const pct = Math.max(20, Math.min(300, +post.fx3dLayerSize || 100)) / 100;
    const edge = Math.max(0, Math.min(1, o.dz(+post.fx3dLayerEdge || 0)));
    const beat = o.beatMode ? (o.beat || 0) : t * 0.5;
    // 積層全体の回転: 縦軸まわりに回り続ける + 揺れ (量が小さいうちは回っていない姿勢と混ぜる)
    const dt = this._t == null ? 0 : Math.max(0, Math.min(0.1, t - this._t)); this._t = t;
    this._spin = (this._spin + dt * 0.35) % (Math.PI * 2);
    const spinY = this._spin + 0.9 * Math.sin(t * 0.23), spinX = 0.35 * Math.sin(t * 0.17);
    const spinW = Math.min(1, k / 0.35);
    const ph = beat - Math.floor(beat);
    const gap = 1.5 / Math.max(n - 1, 1) * k * (1 + 0.45 * Math.exp(-ph * 5));   // 積層の厚みは枚数によらず一定 (拍頭で間隔が開く)
    const cam = Fx3d.camera(asp, 0.35 * k, 0.2 * k, 1.35 + 0.85 * k);   // 積層で画面を埋める距離 (余白を作らない / 積層の中に入らない)
    const M = Fx3d.msaa(gl, o.w, o.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, M.fbo);
    gl.viewport(0, 0, o.w, o.h);
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const size = 1 + (0.92 * pct - 1) * k;
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
      gl.uniform1f(uloc(gl, pr, 'uN'), n);
      gl.uniform1f(uloc(gl, pr, 'uBeat'), beat);
      gl.uniform1f(uloc(gl, pr, 'uSize'), size);
      gl.uniform1f(uloc(gl, pr, 'uGap'), gap);
      gl.uniform1f(uloc(gl, pr, 'uSpinY'), spinY);
      gl.uniform1f(uloc(gl, pr, 'uSpinX'), spinX);
      gl.uniform1f(uloc(gl, pr, 'uSpinW'), spinW * spinW * (3 - 2 * spinW));
      gl.uniform1f(uloc(gl, pr, 'uEdge'), edge);
      gl.uniform1f(uloc(gl, pr, 'uShade'), Fx3d.shade(k));
      Fx3d.popUniforms(gl, pr, 'layer');
      Fx3d.fold(gl, pr, cam.proj, 1.35);   // 最後の段なら折りを物体へ (それ以外は uFx3dOn = 0)
    };
    const nvp = Fx3d.spikeFrame ? Fx3d.prog(gl, 'layersNeedle', NV_VS, FS) : null;
    if(nvp){
      // Needle: 板ごとに針の面で覆う。短辺は最低 6 格子 (画面の高さの 1/14 が目安)
      const gy = Math.max(6, Math.round(14 * size)), gx = Math.max(1, Math.round(gy * asp));
      let sub = Fx3d.foldFrame ? 2 : 1;
      while(sub > 1 && n * GL.needleCellVerts(gx, gy, sub) > 1500000) sub--;
      setU(nvp);
      gl.uniform1f(uloc(gl, nvp, 'uShade'), 1);
      gl.uniform1f(uloc(gl, nvp, 'uNvSub'), sub);
      Fx3d.spikeUniforms(gl, nvp);
      gl.uniform2f(uloc(gl, nvp, 'uNvGrid'), gx, gy);
      gl.drawArrays(gl.TRIANGLES, 0, n * GL.needleCellVerts(gx, gy, sub));
    } else {
      setU(pr);
      gl.drawArrays(gl.TRIANGLES, 0, n * PER);
    }
    gl.bindVertexArray(null);
    Fx3d.resolve(gl, o.fbo, o.w, o.h);
    return true;
  },
};
})();
