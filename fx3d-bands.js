'use strict';
/* 帯の立体化 (BandMesh) — S091 SigInt Bands の 16 本の帯を、厚みのある板として 3D に並べる。
   対象: スロットのシェーダが sb_bandH (帯の高さ)・sb_band (高さ y の帯)・sb_wave (帯の中の波形)・sb_color (色) を持つとき。
   シェーダのソースは Shader.preprocess で実際にコンパイルされた全文を流用し (配置や模様のコードを写さない)、main だけ差し替える。
   uniform の値はスロットのプログラムから同じ名前のものを写す。
   板: 帯ごとに、横 = 画面の幅、縦 = 帯の高さ、奥行き = 厚み。前の面は横に SEG 分割し、波形 v で手前へ凹凸をつける (縞の山が盛り上がる)。
   後ろの面・上下の面・左右の端も閉じる。帯ごとに奥行きを少しずつずらして並べる (回ると段違いに見える)。
   色は前の面の点の uv で sb_color (元の模様)。上下・左右の面も同じ帯の模様を奥へ伸ばし、後ろの面は鏡写し。
   量 k = 0 では凹凸・厚み・ずれが 0 = 元の画面と一致。 */
const BandMesh = {
  SEG: 512,                 // 前の面の横の分割
  _cache: null,

  supports(slot){
    const s = slot && slot.kind === 'shader' ? (slot.src || '') : '';
    return /\bsb_bandH\s*\(/.test(s) && /\bsb_wave\s*\(/.test(s) && /\bsb_color\s*\(/.test(s);
  },
  _progs(gl, slot){
    if(this._cache && this._cache.src === slot.src) return this._cache;
    if(this._cache && this._cache.mesh) gl.deleteProgram(this._cache.mesh);
    const pp = Shader.preprocess(slot.src);
    const base = pp.code.replace(/\bvoid\s+main\s*\(\s*(void)?\s*\)/, 'void vjSlotMain_()');
    const SEG = this.SEG;
    // 頂点シェーダ用に、配置と波形の関数 (hash11 / sb_bandH / sb_wave) と、それが使う uniform をソースから抜き出す
    const fn = name=>{
      const m = new RegExp('\\b(?:void|vec4|vec3|float)\\s+' + name + '\\s*\\(').exec(pp.code);
      if(!m) return '';
      let i = pp.code.indexOf('{', m.index), depth = 0, j = i;
      for(; j < pp.code.length; j++){ if(pp.code[j] === '{') depth++; else if(pp.code[j] === '}'){ depth--; if(depth === 0) break; } }
      return pp.code.slice(m.index, j + 1);
    };
    const body = ['hash11', 'sb_bandH', 'sb_wave'].map(fn).join('\n');
    const used = new Set((body.match(/\b(?:u[A-Z]\w*|iTime|iResolution)\b/g) || []).concat(['uBandCount']));
    const decl = [...used].map(n=>{ const m = new RegExp('uniform\\s+(\\w+)\\s+' + n + '\\b').exec(pp.code); return m ? 'uniform ' + m[1] + ' ' + n + ';' : ''; }).join('\n');
    const meshVS = `#version 300 es
precision highp float;
precision highp int;
uniform mat4 uBmView, uBmProj;
uniform vec3 uBmK;    // 量 k, 縦横比, 厚み (画面の高さ 2 あたり)
out vec2 vUv;         // 模様を読む点 (前の面の uv)
out float vSeed, vTop, vH, vFace;   // 帯の番号・上端・高さ・面 (0 = 前, 1 = 後ろ, 2 = 上下左右)
out vec3 vN;
${decl}
${body}
void main(){
  int id = gl_VertexID;
  int per = ${SEG} * 6 * 4 + 6 * 2;               // 帯 1 本: 前・後ろ・上・下 (SEG 分割) + 左右の端
  int band = id / per, r = id - band * per;
  float fi = float(band);
  int nB = int(clamp(floor(uBandCount + 0.5), 1.0, 16.0));
  // 帯の上端と高さ (sb_band と同じ積み方。最後の帯は残りを埋める)
  float cum = 0.0, h = 0.0;
  for(int i = 0; i < 16; i++){ h = sb_bandH(float(i)); if(i == band) break; cum += h; }
  if(band == nB - 1) h = max(h, 1.0 - cum);
  if(band >= nB || cum >= 1.0){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  h = min(h, 1.0 - cum);
  float k = uBmK.x, asp = uBmK.y, T = uBmK.z * k;
  float zOff = (hash11(fi * 9.7 + 4.1) - 0.5) * 0.5 * k;      // 帯ごとの奥行きのずれ (段違いに並ぶ)
  int face, seg, c;
  if(r < ${SEG} * 24){ face = r / (${SEG} * 6); int rr = r - face * ${SEG} * 6; seg = rr / 6; c = rr - seg * 6; }
  else { int rr = r - ${SEG} * 24; face = 4 + rr / 6; seg = 0; c = rr - (face - 4) * 6; }
  vec2 ab = (c == 0 || c == 3) ? vec2(0.0) : (c == 1) ? vec2(1.0, 0.0) : (c == 2 || c == 4) ? vec2(1.0, 1.0) : vec2(0.0, 1.0);
  float x0, yv, zz;
  vec3 nrm;
  // 前の面の凹凸: 波形 v (0..1) で手前へ。量 k に比例
  float u = (float(seg) + ab.x) / float(${SEG});
  float bump = 0.18 * k;
  if(face == 0){        // 前
    float v = sb_wave(vec2(u, cum + ab.y * h), fi, cum);
    x0 = u; yv = cum + ab.y * h; zz = zOff + T * 0.5 + bump * v; nrm = vec3(0.0, 0.0, 1.0);
  } else if(face == 1){ // 後ろ (巻き順を逆に)
    x0 = 1.0 - u; yv = cum + ab.y * h; zz = zOff - T * 0.5; nrm = vec3(0.0, 0.0, -1.0);
    u = x0;
  } else if(face == 2 || face == 3){   // 上 / 下: 前の縁 (凹凸込み) と後ろの縁を結ぶ
    float yy = face == 2 ? cum + h : cum;
    float v = sb_wave(vec2(u, yy), fi, cum);
    x0 = u; yv = yy; zz = mix(zOff - T * 0.5, zOff + T * 0.5 + bump * v, face == 2 ? ab.y : 1.0 - ab.y);
    nrm = vec3(0.0, face == 2 ? 1.0 : -1.0, 0.0);
  } else {              // 左右の端
    float xx = face == 4 ? 0.0 : 1.0;
    x0 = xx; yv = cum + ab.x * h; zz = mix(zOff - T * 0.5, zOff + T * 0.5, face == 4 ? ab.y : 1.0 - ab.y);
    u = xx; nrm = vec3(face == 4 ? -1.0 : 1.0, 0.0, 0.0);
  }
  vUv = vec2(u, yv); vSeed = fi; vTop = cum; vH = h; vFace = face == 0 ? 0.0 : face == 1 ? 1.0 : 2.0; vN = nrm;
  vec3 P = vec3((x0 * 2.0 - 1.0) * asp, yv * 2.0 - 1.0, zz);
  gl_Position = uBmProj * uBmView * vec4(P, 1.0);
}`;
    const meshFS = base + `
in vec2 vUv;
in float vSeed, vTop, vH, vFace;
in vec3 vN;
uniform float uBmShade;
void main(){
  vec2 uv = vUv;
  if(uMirrorX != 0.0){ uv.x = mix(uv.x, 1.0 - abs(uv.x * 2.0 - 1.0), uMirrorX / 100.0); }
  vec4 O = sb_color(uv, uv * iResolution.xy, vSeed, vTop, vH);
  // 面の向きで陰影 (前の面は量 0 で元の色のまま)
  vec3 L = normalize(vec3(-0.45, 0.7, 0.55));
  float lit = vFace < 0.5 ? 1.0 : clamp(0.35 + 0.75 * max(dot(normalize(vN), L), 0.0), 0.2, 1.1);
  O.rgb *= mix(1.0, lit, uBmShade);
  _vjFragOut = vec4(O.rgb, 1.0);
}`;
    const v = GL._compile(gl.VERTEX_SHADER, meshVS), f = GL._compile(gl.FRAGMENT_SHADER, meshFS);
    const p = GL._link(v, f);
    if(!p || p.err){ console.error('BandMesh program failed', v && v.err, f && f.err); }
    this._cache = { src: slot.src, mesh: (p && !p.err) ? p : null, ul: new Map() };
    return this._cache;
  },
  // 描く (o.fbo へ。呼び出し側が MSAA・深度を用意する)
  draw(gl, slot, fbo, w, h, view, proj, k, asp, thick, shade){
    const pr = this._progs(gl, slot);
    if(!pr.mesh || !slot.prog) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(pr.mesh);
    RockMesh._copyUniforms(gl, slot.prog, pr.mesh, pr.ul);
    gl.uniformMatrix4fv(gl.getUniformLocation(pr.mesh, 'uBmView'), false, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(pr.mesh, 'uBmProj'), false, proj);
    gl.uniform3f(gl.getUniformLocation(pr.mesh, 'uBmK'), k, asp, thick);
    gl.uniform1f(gl.getUniformLocation(pr.mesh, 'uBmShade'), shade);
    if(!GL._emptyVAO) GL._emptyVAO = gl.createVertexArray();
    gl.bindVertexArray(GL._emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 16 * (this.SEG * 6 * 4 + 12));
    gl.bindVertexArray(null);
    return true;
  },
};
