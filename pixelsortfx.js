/* PixelSortFX — Freeangle Pixelsort (Post FX / Audio FX)
   ref: Shadertoy "Freeangle Pixelsort" https://www.shadertoy.com/view/NdGXWD
   2パス: (1) destination マップ(各ピクセルのソート先 uv)を計算 → (2) gather で並べ替え。
   閾値(THRESHOLD)と角度を音声(uHit)で駆動 = Audio FX。apply() I/F は SketchFX 互換。 */
const PixelSortFX = {
  gl:null, initialized:false,
  progB:null, progI:null, quad:null,
  dstFBO:null, outFBO:null, ow:0, oh:0, floatOK:false,
  VS:`#version 300 es
in vec2 a_xy; void main(){ gl_Position = vec4(a_xy, 0.0, 1.0); }`,

  // Pass B: 各ピクセルのソート先 uv を計算 (Shadertoy Buffer B 相当)
  FS_B:`#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2  uRes;
uniform float uThresh;
uniform float uAngle;
uniform float uMaxScan;
out vec4 o;
float grey(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 color = texture(uSrc, uv).rgb;
  float g = grey(color);
  if(g < uThresh){ o = vec4(uv, 1.0, 1.0); return; }   // 閾値以下は動かない
  vec2 dir = vec2(cos(uAngle), sin(uAngle)) / uRes;
  float rank = 0.0;
  vec2 headPos = uv;
  // 後方(-dir): セグメント先頭を探しつつ rank を数える
  for(float i=0.0; i<uMaxScan; i+=1.0){
    vec2 uv2 = uv - dir*i;
    if(uv2.x<0.0||uv2.y<0.0||uv2.x>=1.0||uv2.y>=1.0){ headPos=uv2; break; }
    float gi = grey(texture(uSrc, uv2).rgb);
    if(gi < uThresh){ headPos = uv2; break; }
    if(gi <= g) rank += 1.0;
    headPos = uv2;
  }
  // 前方(+dir): rank を数える
  for(float i=0.0; i<uMaxScan; i+=1.0){
    vec2 uv2 = uv + dir*i;
    if(uv2.x<0.0||uv2.y<0.0||uv2.x>=1.0||uv2.y>=1.0) break;
    float gi = grey(texture(uSrc, uv2).rgb);
    if(gi <= uThresh) break;
    if(gi < g) rank += 1.0;
  }
  o = vec4(headPos + rank * dir, 1.0, 1.0);   // このピクセルのソート先
}`,

  // Image: dst マップを使って gather (Shadertoy Image 相当)
  FS_I:`#version 300 es
precision highp float;
uniform sampler2D uSrc;   // 元の色
uniform sampler2D uDst;   // ソート先マップ
uniform vec2  uRes;
uniform float uAngle;
uniform float uMaxScan;
uniform float uMix;
out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float pixelSize = 3.0 / uRes.x;
  vec2 dir = vec2(cos(uAngle), sin(uAngle)) / uRes;
  vec3 src = texture(uSrc, uv).rgb;
  vec3 result = texture(uSrc, texture(uDst, uv).xy).rgb;   // 既定
  for(float i=0.0; i<uMaxScan; i+=1.0){
    vec2 a = uv - dir*i;
    if(length(uv - texture(uDst, a).xy) < pixelSize){ result = texture(uSrc, a).rgb; break; }
    vec2 b = uv + dir*i;
    if(length(uv - texture(uDst, b).xy) < pixelSize){ result = texture(uSrc, b).rgb; break; }
  }
  o = vec4(mix(src, result, uMix), 1.0);
}`,

  _compile(type, src){
    const gl=this.gl; const sh=gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if(!__glReady(gl, sh, false)) console.warn('PixelSortFX shader:', gl.getShaderInfoLog(sh));
    return sh;
  },
  _link(fs){
    const gl=this.gl; const p=gl.createProgram();
    gl.attachShader(p, this._compile(gl.VERTEX_SHADER, this.VS));
    gl.attachShader(p, this._compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'a_xy');
    gl.linkProgram(p);
    if(!__glReady(gl, p, true)) console.warn('PixelSortFX link:', gl.getProgramInfoLog(p));
    return p;
  },
  _mkFBO(w, h, internal, fmt, type){
    const gl=this.gl;
    const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, fmt, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo=gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return {tex, fbo};
  },
  _resize(w, h){
    const gl=this.gl;
    if(this.dstFBO){ gl.deleteTexture(this.dstFBO.tex); gl.deleteFramebuffer(this.dstFBO.fbo); }
    if(this.outFBO){ gl.deleteTexture(this.outFBO.tex); gl.deleteFramebuffer(this.outFBO.fbo); }
    // dst マップは sub-pixel 精度が要るので float 優先
    this.dstFBO = this.floatOK ? this._mkFBO(w,h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT)
                               : this._mkFBO(w,h, gl.RGBA8,   gl.RGBA, gl.UNSIGNED_BYTE);
    this.outFBO = this._mkFBO(w,h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.ow=w; this.oh=h;
  },
  init(gl){
    if(this.initialized) return;
    this.gl=gl;
    this.floatOK = !!gl.getExtension('EXT_color_buffer_float');
    this.progB=this._link(this.FS_B);
    this.progI=this._link(this.FS_I);
    this.quad=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    this.initialized=true;
  },
  _bindQuad(){
    const gl=this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  },
  // 合成済み finalFBO を pixelsort して finalFBO に書き戻す。
  //   amount: スライダー(0..1) / audioHit: 音声エンベロープ(0..1)
  apply(gl, finalFBO, amount, audioHit, time){
    this.init(gl);
    const fw=finalFBO.w, fh=finalFBO.h;
    if(fw!==this.ow || fh!==this.oh) this._resize(fw, fh);
    const a = Math.max(0, Math.min(1, amount));
    const hit = Math.max(0, Math.min(1, audioHit||0));
    // 音量/スライダーが大きいほど閾値を下げる = ソート量が増える
    const thresh = Math.max(0.05, Math.min(0.95, 0.80 - a*0.45 - hit*0.22));
    // 音を拾うたび(hitSeed が更新される)にランダムな方向へ切替。次の発火まで保持。
    const seed = (typeof Audio !== 'undefined') ? (Audio.hitSeed || 0) : 0;
    // リセット(hitSeed 変化)のたび、前回の方向から 90°〜270°(常に 90°以上)回転させる
    if(seed !== this._psSeed){
      this._psSeed = seed;
      const turn = 1.5708 + (Math.floor(seed*16.0)/16.0) * 3.1416;   // 90°(π/2) 〜 約260°
      this._psAngle = (this._psAngle || 0) + turn;
    }
    const angle = this._psAngle || 0;
    const mixAmt = Math.max(0, Math.min(1, 0.35 + a*0.65));
    const MAXSCAN = 170.0;

    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
    this._bindQuad();

    // --- Pass B: dst マップ ---
    let U=(n)=>gl.getUniformLocation(this.progB, n);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.dstFBO.fbo); gl.viewport(0,0,fw,fh);
    gl.useProgram(this.progB);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, finalFBO.tex);
    gl.uniform1i(U('uSrc'),0);
    gl.uniform2f(U('uRes'),fw,fh);
    gl.uniform1f(U('uThresh'),thresh);
    gl.uniform1f(U('uAngle'),angle);
    gl.uniform1f(U('uMaxScan'),MAXSCAN);
    gl.drawArrays(gl.TRIANGLES,0,3);

    // --- Image: gather ---
    U=(n)=>gl.getUniformLocation(this.progI, n);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outFBO.fbo); gl.viewport(0,0,fw,fh);
    gl.useProgram(this.progI);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, finalFBO.tex);
    gl.uniform1i(U('uSrc'),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.dstFBO.tex);
    gl.uniform1i(U('uDst'),1);
    gl.uniform2f(U('uRes'),fw,fh);
    gl.uniform1f(U('uAngle'),angle);
    gl.uniform1f(U('uMaxScan'),MAXSCAN);
    gl.uniform1f(U('uMix'),mixAmt);
    gl.drawArrays(gl.TRIANGLES,0,3);

    // outFBO → finalFBO
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.outFBO.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, finalFBO.fbo);
    gl.blitFramebuffer(0,0,fw,fh, 0,0,fw,fh, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
  },
};
