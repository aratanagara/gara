'use strict';
/* 岩のメッシュ化 (RockMesh) — 表示中のシェーダの SDF をそのままポリゴンにする (S035 Flowing Metal 用)。
   対象: スロットのシェーダが fm_sdf (距離関数)・fm_cam (画面の点 → 目と光線)・fm_camBasis・fm_normal・fm_shade (色付け) を持つとき。
   シェーダのソースは Shader.preprocess で実際にコンパイルされた全文を流用し (SDF のコードを写さない)、main だけ差し替える。
   uniform の値 (時刻・解像度・@param など) はスロットのプログラムから同じ名前のものを写す。
   1) SDF を画面に沿った格子で評価して焼く: 横と縦 = 画面 (EXT だけ外まで広げる = 画面外の岩も拾う)、奥行き = 目からの距離を NEAR〜FAR の対数で刻む。
      格子は (NX × NZ) × NY の 2D 画像に並べる (i + k·NX, j)。
   2) Surface Nets: マスごとに、8 隅の符号が変わる辺の交点の平均 = マスの頂点 (マスの中の位置 0..1) を焼く。
   3) 頂点シェーダ (gl_VertexID): 格子の点ごと・軸ごとに、その辺で符号が変わるなら、辺を囲む 4 マスの頂点を結ぶ四角形 (三角形 2 枚) を張る。
   4) フラグメントシェーダ: 補間したワールドの点で fm_normal (なめらかな法線) と fm_shade (元の色付け) を呼ぶ。
   形は時間でゆっくり動くので、1)〜2) は every フレームおきに作り直す (負荷を抑える)。 */
const RockMesh = {
  NX: 64, NY: 36, NZ: 64,   // 格子の点の数 (横・縦・奥行き)
  EXT: 0.25,                // 画面の外へ広げる割合 (片側)
  NEAR: 0.6, FAR: 32.0,     // 奥行きの範囲 (目からの距離。レイマーチの最大距離 36 の近くまで)
  every: 3,                 // 形を作り直す間隔 (フレーム)
  ZREF: 3.5,                // 3D FX で奥行きを平らにする基準の距離 (この距離の岩が画面の面 z = 0 にくる)
  _cache: null, _tex: null, _n: 0,

  supports(slot){
    const s = slot && slot.kind === 'shader' ? (slot.src || '') : '';
    return /\bfm_sdf\s*\(/.test(s) && /\bfm_camBasis\s*\(/.test(s) && /\bfm_shade\s*\(/.test(s) && /\bfm_normal\s*\(/.test(s);
  },

  // スロットのソースから 3 つのプログラムを作る (ソースが変わったときだけ)
  _progs(gl, slot){
    if(this._cache && this._cache.src === slot.src) return this._cache;
    if(this._cache) ['sdf', 'cell', 'mesh'].forEach(k=>{ if(this._cache[k]) gl.deleteProgram(this._cache[k]); });
    const pp = Shader.preprocess(slot.src);
    const base = pp.code.replace(/\bvoid\s+main\s*\(\s*(void)?\s*\)/, 'void vjSlotMain_()');
    const iso = /\bconst\s+float\s+FM_EPS\b/.test(pp.code) ? 'FM_EPS' : '0.0';   // fm_sdf は真の距離でないので、0 でなくレイマーチの当たりの値で面を取る
    const setT = /\b_setBgTime\s*\(/.test(pp.code) ? '_setBgTime();' : '';   // bg 関数の time は _bgTime (拍ジャンプ込み) に置き換えられている
    const NX = this.NX, NY = this.NY, NZ = this.NZ;
    const common = `
uniform vec3 uRmExt;   // EXT, NEAR, FAR
vec3 rmWorld(vec3 g){   // 格子の座標 (点の番号。小数可) → ワールドの点
  vec2 sc = (g.xy / vec2(${NX - 1}.0, ${NY - 1}.0)) * (1.0 + 2.0 * uRmExt.x) - uRmExt.x;
  vec3 eye, wd; fm_cam(sc * resolution, eye, wd);
  return eye + wd * (uRmExt.y * pow(uRmExt.z / uRmExt.y, g.z / ${NZ - 1}.0));
}`;
    const sdfFS = base + common + `
void main(){
  ${setT}
  ivec2 px = ivec2(gl_FragCoord.xy);
  int i = px.x % ${NX}, k = px.x / ${NX}, j = px.y;
  _vjFragOut = vec4(fm_sdf(rmWorld(vec3(float(i), float(j), float(k)))) - ${iso}, 0.0, 0.0, 1.0);   // レイマーチが当たりとみなす値 (FM_EPS) の等値面を取る
}`;
    const cellFS = base + `
uniform sampler2D uSdf;
uniform int uRm12;
float S(int i, int j, int k){ return texelFetch(uSdf, ivec2(i + k * ${NX}, j), 0).r; }
const ivec3 RC[8] = ivec3[8](ivec3(0,0,0), ivec3(1,0,0), ivec3(0,1,0), ivec3(1,1,0), ivec3(0,0,1), ivec3(1,0,1), ivec3(0,1,1), ivec3(1,1,1));
const ivec2 RE[12] = ivec2[12](ivec2(0,1), ivec2(2,3), ivec2(4,5), ivec2(6,7), ivec2(0,2), ivec2(1,3), ivec2(4,6), ivec2(5,7), ivec2(0,4), ivec2(1,5), ivec2(2,6), ivec2(3,7));
void main(){
  ivec2 px = ivec2(gl_FragCoord.xy);
  int i = px.x % ${NX - 1}, k = px.x / ${NX - 1}, j = px.y;
  float v[8];
  for(int c = 0; c < 8; c++) v[c] = S(i + RC[c].x, j + RC[c].y, k + RC[c].z);
  vec3 sum = vec3(0.0); float n = 0.0;
  for(int e = 0; e < 12; e++){
    if(e >= uRm12) break;
    float a = v[RE[e].x], b = v[RE[e].y];
    if((a < 0.0) != (b < 0.0)){ float t = a / (a - b); sum += mix(vec3(RC[RE[e].x]), vec3(RC[RE[e].y]), t); n += 1.0; }
  }
  _vjFragOut = n > 0.0 ? vec4(sum / n, 1.0) : vec4(0.0);
}`;
    // メッシュ: 頂点シェーダは格子の点 × 3 軸 × 6 頂点。符号が変わらない辺は画面外へ捨てる
    const meshVS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSdf, uCell;
uniform vec3 uRmExt;
uniform vec2 resolution, iPan;
uniform float time, beat, uBgZoom, iZoom, uCamRoll;
#define bgZoom (uBgZoom * iZoom)
#define bgCamPx (iPan * resolution * 0.5)
uniform mat4 uRmView, uRmProj;   // uRmMode 1 = 3D FX の回るカメラ用
uniform float uRmMode;
uniform vec3 uRmZ;                // 3D FX: 奥行きの基準の距離, 量 k, 縦横比
out vec3 vW;
${this._camGLSL(pp.code)}
float S(int i, int j, int k){ return texelFetch(uSdf, ivec2(i + k * ${NX}, j), 0).r; }
vec3 Cv(int i, int j, int k){ vec4 c = texelFetch(uCell, ivec2(i + k * ${NX - 1}, j), 0); return vec3(float(i), float(j), float(k)) + c.xyz; }
vec3 rmWorld(vec3 g){
  vec2 sc = (g.xy / vec2(${NX - 1}.0, ${NY - 1}.0)) * (1.0 + 2.0 * uRmExt.x) - uRmExt.x;
  vec3 eye, wd; fm_cam(sc * resolution, eye, wd);
  return eye + wd * (uRmExt.y * pow(uRmExt.z / uRmExt.y, g.z / ${NZ - 1}.0));
}
void main(){
  ${setT}
  int id = gl_VertexID, vtx = id % 6, ea = id / 6, ax = ea % 3, pt = ea / 3;
  int i = pt % ${NX}, r = pt / ${NX}, j = r % ${NY}, k = r / ${NY};
  ivec3 d = ax == 0 ? ivec3(1, 0, 0) : ax == 1 ? ivec3(0, 1, 0) : ivec3(0, 0, 1);
  // 辺を囲む 4 マス: 辺の向き以外の 2 軸で -1 / 0
  ivec3 u = ax == 0 ? ivec3(0, 1, 0) : ax == 1 ? ivec3(0, 0, 1) : ivec3(1, 0, 0);
  ivec3 w = ax == 0 ? ivec3(0, 0, 1) : ax == 1 ? ivec3(1, 0, 0) : ivec3(0, 1, 0);
  ivec3 p0 = ivec3(i, j, k), p1 = p0 + d, cmin = p0 - u - w;
  bool ok = all(lessThan(p0, ivec3(${NX - 1}, ${NY - 1}, ${NZ - 1}))) && all(greaterThanEqual(cmin, ivec3(0)));   // 辺の先と 4 マスが格子の中
  float a = ok ? S(p0.x, p0.y, p0.z) : 1.0, b = ok ? S(p1.x, p1.y, p1.z) : 1.0;
  if(!ok || (a < 0.0) == (b < 0.0)){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vW = vec3(0.0); return; }
  // 四角形の隅 q (0..3) → 三角形 2 枚。中身 (負) から外への向きで巻き順をそろえる
  int q = vtx == 0 ? 0 : vtx == 1 ? 1 : vtx == 2 ? 2 : vtx == 3 ? 0 : vtx == 4 ? 2 : 3;
  if(a > 0.0) q = q == 1 ? 3 : q == 3 ? 1 : q;
  ivec3 c = cmin + (q == 1 || q == 2 ? u : ivec3(0)) + (q == 2 || q == 3 ? w : ivec3(0));
  vec3 P = rmWorld(Cv(c.x, c.y, c.z));
  vW = P;
  // シェーダ自身のカメラで写した画面の点 (fm_cam の逆): ワールド → ビュー → 画素
  vec3 eye; mat3 v2w; float zf; fm_camBasis(eye, v2w, zf);
  vec3 v = transpose(v2w) * (P - eye);
  float dist = max(-v.z, 1e-4);
  vec2 xy = v.xy * zf / dist;
  if(uCamRoll != 0.0){ float rl = radians(uCamRoll); float rc = cos(rl), rs = sin(rl); xy = transpose(mat2(rc, -rs, rs, rc)) * xy; }
  vec2 ndc = ((xy - bgCamPx) * max(bgZoom, 0.001) + resolution * 0.5) / resolution * 2.0 - 1.0;
  if(uRmMode < 0.5){
    // 照合用: シェーダの画面そのまま (奥行きは NEAR〜FAR を深度に)
    float dz = (dist - uRmExt.y) / (uRmExt.z - uRmExt.y);
    gl_Position = vec4(ndc * dist, (dz * 2.0 - 1.0) * dist, dist);
  } else {
    // 3D FX: 画面の点を 3D FX の平面 (横 ±縦横比、縦 ±1) に置き、目からの距離を奥行き (z) にして、回るカメラで写す。
    //   奥行きの尺度 = 基準の距離での画面の高さ 2 あたりのワールドの長さ (遠近と同じ割合)。量 k が 0 なら平ら = シェーダの画面と一致
    float zs = resolution.y / zf;                                              // = tan(画角/2)・2 / 画面の高さ 2
    float Z = -(min(dist, uRmZ.x + 8.0) - uRmZ.x) / (uRmZ.x * zs) * uRmZ.y;
    gl_Position = uRmProj * uRmView * vec4(ndc.x * uRmZ.z, ndc.y, Z, 1.0);
  }
}`;
    const meshFS = base + `
in vec3 vW;
void main(){
  ${setT}
  vec3 eye; mat3 v2w; float zf; fm_camBasis(eye, v2w, zf);
  vec3 wd = normalize(vW - eye);
  vec3 col = fm_shade(vW, fm_normal(vW), wd, length(vW - eye), gl_FragCoord.xy);
  _vjFragOut = vec4(col, 1.0);
}`;
    const vsQuad = `#version 300 es
void main(){ vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); gl_Position = vec4(p, 0.0, 1.0); }`;
    const mk = (vs, fs, id)=>{
      const v = GL._compile(gl.VERTEX_SHADER, vs), f = GL._compile(gl.FRAGMENT_SHADER, fs);
      const p = GL._link(v, f);
      if(!p || p.err){ console.error('RockMesh program failed:', id, p && p.err); return null; }
      return p;
    };
    // 深度だけの下書き用 (色付けは手前の面だけに掛ける = 奥に重なった面の重い fm_shade を計算しない)
    const zFS = `#version 300 es
precision highp float;
in vec3 vW;
out vec4 o;
void main(){ o = vec4(0.0); }`;
    this._cache = { src: slot.src, sdf: mk(vsQuad, sdfFS, 'sdf'), cell: mk(vsQuad, cellFS, 'cell'), mesh: mk(meshVS, meshFS, 'mesh'), zpre: mk(meshVS, zFS, 'zpre'), ul: new Map() };
    return this._cache;
  },
  // 頂点シェーダ用に、ソースからカメラまわりの関数 (fm_ry / fm_view / fm_camBasis / fm_cam) と、それが使う uniform を抜き出す
  _camGLSL(code){
    const fn = name=>{
      const m = new RegExp('\\b(?:void|vec3|mat3|float)\\s+' + name + '\\s*\\(').exec(code);
      if(!m) return '';
      let i = code.indexOf('{', m.index), depth = 0, j = i;
      for(; j < code.length; j++){ if(code[j] === '{') depth++; else if(code[j] === '}'){ depth--; if(depth === 0) break; } }
      return code.slice(m.index, j + 1);
    };
    const body = (/\b_setBgTime\s*\(/.test(code) ? 'float _bgTime;\n' : '') + ['_setBgTime', 'fm_ry', 'fm_view', 'fm_camBasis', 'fm_cam'].map(fn).join('\n');
    const used = new Set((body.match(/\bu[A-Z]\w*/g) || []).filter(n=>n !== 'uCamRoll' && n !== 'uBgZoom'));
    const decl = [...used].map(n=>{ const m = new RegExp('uniform\\s+(\\w+)\\s+' + n + '\\b').exec(code); return m ? 'uniform ' + m[1] + ' ' + n + ';' : ''; }).join('\n');
    return decl + '\n' + body;
  },
  // スロットのプログラムから同じ名前の uniform を写す (サンプラーは除く)
  _copyUniforms(gl, from, to, ul){
    let list = ul.get(to);
    if(list && list.from !== from) list = null;   // スロットのプログラムが作り直されたら場所を取り直す
    if(!list){
      list = [];
      const n = gl.getProgramParameter(to, gl.ACTIVE_UNIFORMS);
      for(let i = 0; i < n; i++){
        const u = gl.getActiveUniform(to, i);
        if(!u || u.type === gl.SAMPLER_2D || u.size > 1) continue;
        const lf = gl.getUniformLocation(from, u.name), lt = gl.getUniformLocation(to, u.name);
        if(lf && lt) list.push({ type:u.type, lf, lt });
      }
      list.from = from;
      ul.set(to, list);
    }
    for(const u of list){
      const v = gl.getUniform(from, u.lf);
      if(v == null) continue;
      switch(u.type){
        case gl.FLOAT: gl.uniform1f(u.lt, v); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(u.lt, v); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(u.lt, v); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(u.lt, v); break;
        case gl.INT: case gl.BOOL: gl.uniform1i(u.lt, +v); break;
      }
    }
  },
  _mkTex(gl, w, h){
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  },
  _setCommon(gl, p){
    gl.uniform3f(gl.getUniformLocation(p, 'uRmExt'), this.EXT, this.NEAR, this.FAR);
  },
  // 形を作り直す (every フレームおき、または force)
  update(gl, slot, force){
    const pr = this._progs(gl, slot);
    if(!pr.sdf || !pr.cell || !pr.mesh || !slot.prog) return false;
    const NX = this.NX, NY = this.NY, NZ = this.NZ;
    if(!this._tex){ this._tex = { sdf: this._mkTex(gl, NX * NZ, NY), cell: this._mkTex(gl, (NX - 1) * (NZ - 1), NY - 1) }; force = true; }
    if(!force && (this._n++ % this.every) !== 0) return true;
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE);
    if(!GL._emptyVAO) GL._emptyVAO = gl.createVertexArray();
    gl.bindVertexArray(GL._emptyVAO);
    // 1) SDF
    gl.useProgram(pr.sdf);
    this._copyUniforms(gl, slot.prog, pr.sdf, pr.ul);
    this._setCommon(gl, pr.sdf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._tex.sdf.fbo);
    gl.viewport(0, 0, this._tex.sdf.w, this._tex.sdf.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // 2) マスの頂点
    gl.useProgram(pr.cell);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._tex.sdf.tex);
    gl.uniform1i(gl.getUniformLocation(pr.cell, 'uSdf'), 0);
    gl.uniform1i(gl.getUniformLocation(pr.cell, 'uRm12'), 12);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._tex.cell.fbo);
    gl.viewport(0, 0, this._tex.cell.w, this._tex.cell.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    return true;
  },
  // メッシュを描く。view / proj を渡すとそのカメラ (3D FX)、渡さなければシェーダ自身のカメラ (照合用)
  draw(gl, slot, fbo, w, h, view, proj, k, asp){
    const pr = this._cache;
    if(!pr || !pr.mesh || !this._tex) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._tex.sdf.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._tex.cell.tex);
    if(!GL._emptyVAO) GL._emptyVAO = gl.createVertexArray();
    gl.bindVertexArray(GL._emptyVAO);
    const N = this.NX * this.NY * this.NZ * 18;
    const bind = (p)=>{
      gl.useProgram(p);
      this._copyUniforms(gl, slot.prog, p, pr.ul);
      this._setCommon(gl, p);
      gl.uniform1i(gl.getUniformLocation(p, 'uSdf'), 0);
      gl.uniform1i(gl.getUniformLocation(p, 'uCell'), 1);
      gl.uniform1f(gl.getUniformLocation(p, 'uRmMode'), view ? 1 : 0);
      if(view){
        gl.uniformMatrix4fv(gl.getUniformLocation(p, 'uRmView'), false, view);
        gl.uniformMatrix4fv(gl.getUniformLocation(p, 'uRmProj'), false, proj);
        gl.uniform3f(gl.getUniformLocation(p, 'uRmZ'), this.ZREF, k == null ? 1 : k, asp || w / h);
      }
    };
    // 1) 深度だけ (色は書かない) → 2) 手前の面だけ色付け (深度が同じ所だけ)
    if(pr.zpre){
      bind(pr.zpre);
      gl.colorMask(false, false, false, false);
      gl.depthFunc(gl.LESS);
      gl.drawArrays(gl.TRIANGLES, 0, N);
      gl.colorMask(true, true, true, true);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
    }
    bind(pr.mesh);
    gl.drawArrays(gl.TRIANGLES, 0, N);
    gl.depthMask(true);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    return true;
  },
};
