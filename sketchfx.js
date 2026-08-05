'use strict';
/* SketchFX — Shadertoy "Noise distortion 2D" (https://www.shadertoy.com/view/lt33zn)
   iq の fBM ノイズで画面の UV を歪ませる単パス Post FX。
   入力 = 合成済みフレーム(_finalFBO)、結果を _finalFBO に書き戻す。
   amount で歪み強度(0=素通り)、grade で色調補正(合成と同式)。はみ出しは mirror-repeat。
   旧 flockaroo ボールペン版から差し替え(軽量・1パス)。apply() のI/Fは互換。 */
const SketchFX = {
  gl:null, initialized:false,
  prog:null, quad:null, outFBO:null, ow:0, oh:0, t0:0,

  VS:`#version 300 es
in vec2 a_xy; void main(){ gl_Position = vec4(a_xy, 0.0, 1.0); }`,

  FS:`#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uRes; uniform float uTime, uAmount;
uniform float uBri, uCon, uSat, uHue, uGamma, uInv;
out vec4 o;

// lt33zn パラメータ
const float Scale1 = 0.3, Scale2 = 3.5, Amp = 20.0, FreqX = 30.0, FreqY = 30.0;
const mat3 nm = mat3( 0.00, 0.80, 0.60,  -0.80, 0.36, -0.48,  -0.60, -0.48, 0.64 );

float hash(float n){ return fract(sin(n)*43758.5453); }
// iq value noise (https://www.shadertoy.com/view/XslGRr, CC BY-NC-SA 3.0)
float vnoise(vec3 x){
  vec3 p=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  float n=p.x + p.y*57.0 + 113.0*p.z;
  return mix(mix(mix(hash(n+0.0),hash(n+1.0),f.x), mix(hash(n+57.0),hash(n+58.0),f.x),f.y),
             mix(mix(hash(n+113.0),hash(n+114.0),f.x), mix(hash(n+170.0),hash(n+171.0),f.x),f.y),f.z);
}
float myfbm(vec3 p){
  float f  = 0.5000*vnoise(p); p=nm*p*2.02;
        f += 0.2500*vnoise(p); p=nm*p*2.03;
        f += 0.1250*vnoise(p); p=nm*p*2.01;
        f += 0.0625*vnoise(p); p=nm*p*2.05;
        f += 0.0625/2.0*vnoise(p); p=nm*p*2.02;
        f += 0.0625/4.0*vnoise(p);
  return f;
}
vec3 hueShift(vec3 c, float h){
  const mat3 toYIQ = mat3(0.299,0.596,0.211,  0.587,-0.274,-0.523,  0.114,-0.322,0.312);
  const mat3 toRGB = mat3(1.0,1.0,1.0,        0.956,-0.272,-1.106,  0.621,-0.647,1.703);
  vec3 yiq=toYIQ*c; float a=h*6.2831853, ca=cos(a), sa=sin(a);
  vec2 iq=yiq.yz; yiq.y=ca*iq.x-sa*iq.y; yiq.z=sa*iq.x+ca*iq.y;
  return toRGB*yiq;
}
void main(){
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = fc / uRes.y;
  vec3 p = Scale2*vec3(uv, 0.0) - uTime*vec3(1.0,1.0,1.0)*0.1;
  float x = myfbm(p);
  vec3 v = (0.55*sin(x*vec3(FreqX, FreqY, 1.0)*Scale1))/Scale1;   // 中心0の対称変位(左下寄りのバイアスを除去)
  v *= Amp;
  // 時間差でランダムに歪み方向を回転(数秒周期でゆっくり向きが変わる)
  float ra = (vnoise(vec3(uTime*0.13, 5.1, 0.0)) - 0.5) * 6.2831853;
  float rc = cos(ra), rs = sin(ra);
  v.xy = vec2(v.x*rc - v.y*rs, v.x*rs + v.y*rc);
  // amount で歪み強度を制御(0=素通り)
  vec2 duv = 0.02*v.xy*clamp(uAmount, 0.0, 1.0) + fc/uRes;
  duv = 1.0 - abs(1.0 - fract(duv*0.5)*2.0);     // mirror-repeat(はみ出しを連続反射)
  vec3 cc = texture(uSrc, duv).rgb;
  // 色調補正(合成と同式 / 順序: bri→con→sat→hue→invert→gamma)
  cc += uBri;
  cc = (cc-0.5)*uCon + 0.5;
  float Lg = dot(cc, vec3(0.299,0.587,0.114));
  cc = mix(vec3(Lg), cc, uSat);
  cc = hueShift(cc, uHue);
  if(uInv > 0.5) cc = 1.0 - cc;
  cc = pow(max(cc, 0.0), vec3(1.0/uGamma));
  o = vec4(clamp(cc, 0.0, 1.0), 1.0);
}`,

  _compile(type, src){
    const gl=this.gl; const sh=gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if(!__glReady(gl, sh, false)) console.warn('SketchFX shader:', gl.getShaderInfoLog(sh));
    return sh;
  },
  _link(fs){
    const gl=this.gl; const p=gl.createProgram();
    gl.attachShader(p, this._compile(gl.VERTEX_SHADER, this.VS));
    gl.attachShader(p, this._compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'a_xy');
    gl.linkProgram(p);
    if(!__glReady(gl, p, true)) console.warn('SketchFX link:', gl.getProgramInfoLog(p));
    return p;
  },
  _mkFBO(w, h){
    const gl=this.gl;
    const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo=gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  },
  _resize(w, h){
    const gl=this.gl;
    if(this.outFBO){ gl.deleteTexture(this.outFBO.tex); gl.deleteFramebuffer(this.outFBO.fbo); }
    this.outFBO = this._mkFBO(w, h);
    this.ow=w; this.oh=h;
  },

  init(gl){
    if(this.initialized) return;
    this.gl=gl;
    this.prog=this._link(this.FS);
    this.quad=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    this.t0 = performance.now();
    this.initialized=true;
  },

  _bindQuad(){
    const gl=this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  },

  // 合成済み finalFBO を入力に歪ませ、finalFBO に書き戻す
  apply(gl, finalFBO, amount, grade){
    this.init(gl);
    const fw=finalFBO.w, fh=finalFBO.h;
    if(fw!==this.ow || fh!==this.oh) this._resize(fw, fh);

    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
    this._bindQuad();
    const U=(n)=>gl.getUniformLocation(this.prog, n);
    const t=(performance.now()-this.t0)/1000.0;

    // finalFBO → 歪み → outFBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outFBO.fbo); gl.viewport(0,0,fw,fh);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, finalFBO.tex);
    gl.uniform1i(U('uSrc'), 0);
    gl.uniform2f(U('uRes'), fw, fh);
    gl.uniform1f(U('uTime'), t);
    gl.uniform1f(U('uAmount'), amount);
    const G = grade || {};
    const gnum = (v, d)=> (v != null && isFinite(v)) ? v : d;
    gl.uniform1f(U('uBri'),   gnum(G.bri, 0));
    gl.uniform1f(U('uCon'),   gnum(G.con, 1));
    gl.uniform1f(U('uSat'),   gnum(G.sat, 1));
    gl.uniform1f(U('uHue'),   gnum(G.hue, 0));
    gl.uniform1f(U('uGamma'), gnum(G.gamma, 1));
    gl.uniform1f(U('uInv'),   G.inv ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // outFBO → finalFBO に書き戻し
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.outFBO.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, finalFBO.fbo);
    gl.blitFramebuffer(0,0,fw,fh, 0,0,fw,fh, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },
};
