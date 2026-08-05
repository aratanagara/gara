'use strict';
/* Inkelly engine — Shadertoy "Inkelly" by leon denise (https://www.shadertoy.com/view/McfcRM)
   フィードバック(前フレーム参照)のインク流体。2パス(buffer feedback + edge render)を
   内部ピンポン FBO で実装し、指定 FBO に描画 → 通常のクロスフェード/Post FX に合流。
   beat 同期: spawn ステップを拍に合わせて切替可能。 */
const Inkelly = {
  gl:null,
  initialized:false,
  bufProg:null, imgProg:null,
  quadBuf:null,
  fboA:null, fboB:null, fboW:0, fboH:0,
  _t:0, _beat:0, _dt:1/60,

  P:{
    beatSync:   true,    // true: spawn を拍に同期 / false: 秒(delay)で同期
    spawnBeats: 1,       // beatSync 時: 何拍ごとにインク場を切替
    delay:      4.0,     // 非同期時: 切替周期(秒)
    spawnR:     0.9,     // インク発生リングの半径
    spawnW:     0.012,   // リングの太さ(エッジ)
    curlScale:  0.05,    // curl による発生形状の歪み
    displace:   0.02,    // フィードバック変位(流れの強さ)
    fade:       1.0,     // 軌跡の消える速さ(大きいほど早く消える)
    flow:       3.0,     // インク場の連続ドリフト(0=ステップのみ)
    feather:    0.02,    // エッジ検出の柔らかさ
    size:       1.6,     // 形の大きさ(大きいほど弧が長い)
    sharp:      0.5,     // 尖り具合(大きいほど尖る)
    breathBars: 4,       // ブリージング(密度増減)の周期(小節)
    black: false,        // 濃い黒い絵の具版(ほぼ黒のボディ + 鈍いウェット反射)
    autoHue: false,      // ON: Slot A の最も鮮やかで支配的な色相を自動で bgHue に適用
    bgHue: 0.0,          // 色味: 0=白(Silver)/黒(Black) / >0=色相環(hue)で着色。Slot A クローム & Slot B ライン共通
  },
  PDefaults:null,

  VS:`#version 300 es
in vec2 a_xy; void main(){ gl_Position = vec4(a_xy, 0.0, 1.0); }`,

  // ---- buffer pass (feedback displace) ----
  BUF_FS:`#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform vec2  uRes;
uniform float uStep, uDt, uFlow;
uniform float uSpawnR, uSpawnW, uCurl, uDisplace, uFade;
uniform float uScale, uSharp;   // 形の大きさ / 尖り具合(smooth-abs の eps)
uniform float uBreath;          // 0..1 ブリージング(密度を増減。透明度は変えない)
out vec4 o;
float gyroid(vec3 s){ return dot(sin(s), cos(s.yzx)); }
float fbm(vec2 pos){
  float t = uStep;
  float t2 = t*1.354;
  // 弧の長さ: uScale=大きさ基準 × 時間ゆらぎ(空間周波数を上下させる)
  float freq = uScale * (0.8 + 0.5*sin(uFlow*1.5));
  vec3 p = vec3(pos * freq, t + uFlow);
  float r = 0., a = .5;
  // 折り目の鋭さは uSharp(smooth-abs の eps)で可変。小さいほど尖る。
  for(int i=0;i<3;i++, a/=2.){ float g = gyroid(p/a)*a; r += sqrt(g*g + uSharp); }
  // 帯の数=密度。極端に密 + ブリージングで密度が増減(次第に弱まって強くなるのくり返し)
  float dens = 7.0 * mix(0.4, 1.0, uBreath);
  r = sin(r*6.283185*dens + t2 - pos.x);
  return r;
}
void main(){
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = fc / uRes;
  vec2 pp = (2.*fc - uRes) / uRes.y;
  // 大きいグルーヴ: 低周波の波で場全体をゆっくり大きくうねらせる
  pp += 0.55 * vec2(sin(pp.y*0.8 + uFlow*1.2), sin(pp.x*0.7 - uFlow*1.0));
  vec2 e = vec2(4./uRes.y, 0.);
  vec2 curl = vec2(fbm(pp+e.xy)-fbm(pp-e.xy), fbm(pp+e.yx)-fbm(pp-e.yx)) / (2.*e.x);
  curl = vec2(curl.y, -curl.x);
  pp += curl * uCurl;
  float dist = abs(length(pp) - uSpawnR);
  float mask = smoothstep(uSpawnW, 0., dist);
  curl *= uDisplace;
  vec4 frame = texture(uPrev, uv + curl);
  mask = max(mask, frame.r - uDt*uFade);
  // .a = クローム用の流れる場: 前フレームを curl で移流 + 全面に低周波の源(fbm)を注入。
  // 源を低周波(滑らか)にして、密になってもノイズにならないようにする。
  float inject = fbm(pp*0.6 + 11.0)*0.5 + 0.5;
  float aField = mix(frame.a, inject, 0.045);
  o = vec4(mask, curl, aField);
}`,

  // ---- image pass (edge render) ----
  IMG_FS:`#version 300 es
precision highp float;
uniform sampler2D uBuf;
uniform vec2  uRes;
uniform float uFeather;
uniform float uOpaque;          // 1=Slot A(線に沿った銀の力場) / 0=透過オーバーレイ(白線)
uniform float uTime;            // クローム反射のゆっくりした動き
uniform float uBlack;           // 1=濃い黒い絵の具版(ほぼ黒のボディ + 鈍いウェット反射)
uniform float uBgHue;           // 0=白(Silver)/黒(Black) / >0=色相環(hue)で原色着色
uniform float uLineBW;          // 無彩色時の線: 1=白(黒支配) / 0=黒(白支配)
out vec4 o;

vec3 hsv2rgb(vec3 c){
  vec3 p = abs(fract(c.xxx + vec3(0., 2./3., 1./3.))*6. - 3.);
  return c.z * mix(vec3(1.), clamp(p-1., 0., 1.), c.y);
}

// 線をぼかした滑らかな力場(ポテンシャル)。反射を曲げる(ワープ)用。
float pot(vec2 uv){
  float s = 0., w = 0.;
  for(int i=-3;i<=3;i++){
    float fi = float(i);
    float g = exp(-fi*fi*0.16);
    s += smoothstep(0., uFeather, texture(uBuf, uv + vec2(fi,0.)*6.0/uRes).r)*g;
    s += smoothstep(0., uFeather, texture(uBuf, uv + vec2(0.,fi)*6.0/uRes).r)*g;
    w += 2.0*g;
  }
  return s/w;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 ep = vec3(1./uRes, 0.);
  // 透過オーバーレイ用の白い輪郭線
  float mr = smoothstep(0., uFeather, texture(uBuf, uv).r);
  float edge = abs(smoothstep(0.,uFeather,texture(uBuf,uv+ep.xz).r)-mr)
             + abs(smoothstep(0.,uFeather,texture(uBuf,uv-ep.xz).r)-mr)
             + abs(smoothstep(0.,uFeather,texture(uBuf,uv+ep.zy).r)-mr)
             + abs(smoothstep(0.,uFeather,texture(uBuf,uv-ep.zy).r)-mr);
  float e = clamp(edge/2., 0., 1.);
  if(uOpaque < 0.5){
    // Slot B 透過ライン色: BG Hue(色相環) > モード既定(Silver:白 / Black:黒)
    vec3 richBlackLine = vec3(0.018, 0.023, 0.036);
    richBlackLine = mix(richBlackLine, vec3(dot(richBlackLine, vec3(0.299,0.587,0.114))), 0.30);
    // 無彩色時は白支配→黒線 / 黒支配→白線(uLineBW)。色相があればその原色。
    vec3 lineCol = (uBgHue > 0.0) ? hsv2rgb(vec3(uBgHue, 1.0, 1.0))
                                  : ((uLineBW > 0.5) ? vec3(1.0) : richBlackLine);
    o = vec4(lineCol, e); return;
  }

  // Slot A: H4風の水銀クローム。2パスで全面を流れる滑らかな場(.a)の傾きだけで反射を曲げる
  // → なめらかなグラデが流れて動く(ジャギなし)。線は白で上に乗せる。
  // .a を広めの 3x3 でぼかして滑らかに(密でもノイズにしない)
  float dd = 9.0/uRes.x;
  float c  = texture(uBuf, uv).a;
  float rX = texture(uBuf, uv + vec2(dd,0.)).a;
  float lX = texture(uBuf, uv - vec2(dd,0.)).a;
  float uY = texture(uBuf, uv + vec2(0.,dd)).a;
  float dY = texture(uBuf, uv - vec2(0.,dd)).a;
  float c1 = texture(uBuf, uv + vec2(dd,dd)).a + texture(uBuf, uv + vec2(-dd,dd)).a
           + texture(uBuf, uv + vec2(dd,-dd)).a + texture(uBuf, uv + vec2(-dd,-dd)).a;
  float fA = (c*0.28 + (rX+lX+uY+dY)*0.12 + c1*0.06);   // 3x3 加重平均
  vec2 grad = vec2(rX-lX, uY-dY) * 20.0;                // 弱い傾き(なめらかなグラデ)
  float refl = clamp(uv.y + grad.y - grad.x*0.5 + (fA-0.5)*0.3, 0.0, 1.0);
  // 明るい銀の連続グラデ(階調を広く・滑らか)
  vec3 silver = mix(vec3(0.55,0.58,0.66), vec3(0.99,1.0,1.06), smoothstep(0.0, 1.0, refl));
  // ディープグレーは強い境界だけ(密でも埋め尽くさないようしきい値高め・控えめ)
  float gmag = length(vec2(rX-lX, uY-dY));
  float boundary = smoothstep(0.006, 0.05, gmag);
  silver = mix(silver, vec3(0.26,0.29,0.38), boundary*0.65);
  vec3 bgTint = (uBgHue <= 0.0) ? vec3(1.0) : hsv2rgb(vec3(uBgHue, 1.0, 1.0));  // 0=白 / >0=色相環の原色
  silver *= bgTint;                                // BG = クローム色味(色相環をドラッグで回す)
  if(uBlack > 0.5){                                // 黒い絵の具版: 低明度の塊に、粘度を感じる鈍い濡れハイライトだけを残す
    float g = dot(silver, vec3(0.299,0.587,0.114));
    float mass = clamp(mr*0.55 + fA*0.45 + boundary*0.35, 0.0, 1.0);
    float pooled = pow(clamp(1.0 - g, 0.0, 1.0), 1.55);
    float sheen = pow(smoothstep(0.55, 1.0, refl), 5.0) * (0.35 + 0.65*fA);
    float ridge = pow(boundary, 1.25)*0.55 + pow(e, 1.8)*0.22;
    vec3 deep = vec3(0.006, 0.008, 0.014);
    vec3 body = vec3(0.030, 0.040, 0.060);
    vec3 wet  = vec3(0.095, 0.120, 0.170);
    vec3 cool = vec3(0.045, 0.065, 0.110);
    float flowTone = pow(clamp(fA, 0.0, 1.0), 1.18) * (0.45 + 0.75*mass);
    silver = mix(body, deep, pooled * (0.58 + 0.16*mass));
    silver += body * flowTone * 0.78;
    silver += wet * sheen * 0.50;
    silver += cool * ridge * (0.62 + 0.40*mass);
    silver *= 0.72 + 0.58*mass;
    silver = mix(silver, vec3(dot(silver, vec3(0.299,0.587,0.114))), 0.30);
  }
  o = vec4(clamp(silver, 0.0, 1.0), 1.0);
}`,

  _compile(type, src){
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if(!__glReady(gl, sh, false)) console.warn('Inkelly shader:', gl.getShaderInfoLog(sh), src);
    return sh;
  },
  _link(vsSrc, fsSrc){
    const gl = this.gl;
    const p = gl.createProgram();
    gl.attachShader(p, this._compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, this._compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.bindAttribLocation(p, 0, 'a_xy');
    gl.linkProgram(p);
    if(!__glReady(gl, p, true)) console.warn('Inkelly link:', gl.getProgramInfoLog(p));
    return p;
  },
  _mkFBO(w, h){
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  },
  _resize(w, h){
    const gl = this.gl;
    [this.fboA, this.fboB].forEach(f=>{ if(f){ gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fbo); } });
    this.fboA = this._mkFBO(w, h);
    this.fboB = this._mkFBO(w, h);
    // 初期化: クリア
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA.fbo); gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB.fbo); gl.clear(gl.COLOR_BUFFER_BIT);
    this.fboW = w; this.fboH = h;
  },

  init(gl){
    if(this.initialized) return;
    this.gl = gl;
    this.bufProg = this._link(this.VS, this.BUF_FS);
    this.imgProg = this._link(this.VS, this.IMG_FS);
    this.quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    this.PDefaults = JSON.parse(JSON.stringify(this.P));
    this.startTime = (typeof performance !== 'undefined') ? performance.now()/1000 : 0;
    this.initialized = true;
  },

  update(beat, dt){
    this._beat = beat;
    this._dt = Math.max(0, dt || 1/60);
    this._audioReact = (typeof Audio !== 'undefined') ? (Audio.react || 0) : 0;
    this._attack = (typeof Audio !== 'undefined') ? Math.max(Audio.attack || 0, (Audio.attackEnv || 0) * 0.65) : 0;
    this._t += this._dt * (1.0 + this._attack * 3.5);
  },

  // Slot A の描画を小さく読み戻し、最も彩度が高く支配的な色相を bgHue に滑らかに適用。
  _updateAutoHue(){
    const gl = this.gl;
    const A = (typeof GL !== 'undefined' && GL.slots) ? GL.slots.A : null;
    if(!A || !A.fbos) return;
    const src = A.fbos[A.fbIdx ^ 1];                 // A の最新フレーム
    if(!src || !src.fbo) return;
    const S = 16;
    if(!this._ahFBO) this._ahFBO = this._mkFBO(S, S);
    if(!this._ahPix) this._ahPix = new Uint8Array(S*S*4);
    // src(A) を 16x16 に縮小コピー → CPU 読み戻し
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._ahFBO.fbo);
    gl.blitFramebuffer(0,0, src.w, src.h, 0,0, S, S, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._ahFBO.fbo);
    gl.readPixels(0,0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, this._ahPix);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // 色相ヒストグラム(彩度^2 × 明度 で重み付け → 鮮やかで原色調の色を優先)
    const px = this._ahPix, BINS = 36, hist = new Float32Array(BINS);
    let rSum = 0, gSum = 0, bSum = 0;
    for(let i=0;i<S*S;i++){
      const r=px[i*4]/255, g=px[i*4+1]/255, b=px[i*4+2]/255;
      rSum += r; gSum += g; bSum += b;
      const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
      if(mx<=0.004 || d<=0.004) continue;
      const sat=d/mx;
      let h;
      if(mx===r) h=((g-b)/d)%6; else if(mx===g) h=(b-r)/d+2; else h=(r-g)/d+4;
      h/=6; if(h<0) h+=1;
      hist[Math.min(BINS-1, Math.floor(h*BINS))] += sat*sat*mx;
    }
    // 全体を均した平均色。その彩度が低い(=灰色に近い)なら無彩色扱いで明度から白黒判定。
    const aR=rSum/(S*S), aG=gSum/(S*S), aB=bSum/(S*S);
    const aMx=Math.max(aR,aG,aB), aMn=Math.min(aR,aG,aB);
    const avgSat = aMx>0.004 ? (aMx-aMn)/aMx : 0;
    const avgLuma = 0.299*aR + 0.587*aG + 0.114*aB;
    let bi=0, bv=-1;
    for(let k=0;k<BINS;k++){ if(hist[k]>bv){ bv=hist[k]; bi=k; } }
    let cur = this.P.bgHue || 0;
    if(avgSat < 0.12 || bv <= 0){
      // 平均が灰色に近い → 白(0)へフェード
      cur = (cur < 0.003) ? 0 : cur*0.85;
    }else{
      let target = (bi + 0.5)/BINS;
      let dd = target - cur; dd -= Math.round(dd);   // 色相環の最短方向
      cur += dd*0.3; cur = (cur%1 + 1)%1;
      if(cur < 0.001) cur = 0.001;                   // 0=白 を避ける(赤は 0.001 として扱う)
    }
    this.P.bgHue = cur;
    // 無彩色時の線色: 白支配→黒線 / 黒支配→白線(平均輝度で反転)
    this._grayLineWhite = (avgLuma < 0.5) ? 1 : 0;
    // スライダー表示も追従
    const el = (typeof document !== 'undefined') ? document.getElementById('ikBgHue') : null;
    if(el) el.value = cur;
    const lab = (typeof document !== 'undefined') ? document.getElementById('ikBgHueVal') : null;
    if(lab) lab.textContent = cur.toFixed(3);
  },

  _drawQuad(prog){
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  },

  render({ fbo, w, h, slot }){
    const gl = this.gl;
    if(!this.initialized) this.init(gl);
    if(this.fboW !== w || this.fboH !== h) this._resize(w, h);
    const P = this.P;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);

    // Auto Hue: 数フレームおきに Slot A の支配色相を拾って bgHue に反映
    this._ahCount = (this._ahCount || 0) + 1;
    if(P.autoHue && (this._ahCount % 12 === 0)) this._updateAutoHue();

    // spawn ステップ(拍 or 秒)
    const step = P.beatSync ? Math.floor((this._beat || 0) / Math.max(0.25, P.spawnBeats))
                            : Math.floor(this._t / Math.max(0.1, P.delay));
    const dt = 1/60;
    var _aud = this._audioReact || 0;
    var _atk = this._attack || 0;
    var _drive = Math.min(1.0, _aud * 0.55 + _atk * 1.15);
    const flowT = this._t;

    // --- pass 1: buffer feedback → fboB (reading fboA) ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.bufProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fboA.tex);
    const ub = (n)=>gl.getUniformLocation(this.bufProg, n);
    gl.uniform1i(ub('uPrev'), 0);
    gl.uniform2f(ub('uRes'), w, h);
    gl.uniform1f(ub('uStep'), step);
    gl.uniform1f(ub('uDt'), dt);
    gl.uniform1f(ub('uFlow'), flowT * P.flow * 0.1);
    gl.uniform1f(ub('uSpawnR'), P.spawnR);
    gl.uniform1f(ub('uSpawnW'), P.spawnW * (1.0 + _atk * 0.85));
    // Audio リアクト + Attack: 持続音は緩く、立ち上がりは瞬間的に渦と変位を押す。
    gl.uniform1f(ub('uCurl'), P.curlScale * (1.0 + _aud * 0.6 + _atk * 1.8));
    gl.uniform1f(ub('uDisplace'), P.displace * (1.0 + _aud * 1.0 + _atk * 3.0));
    gl.uniform1f(ub('uFade'), P.fade);
    gl.uniform1f(ub('uScale'), 0.42 / Math.max(0.2, P.size));            // 大きさ → 周波数基準(大きいほど低周波=長い弧)
    gl.uniform1f(ub('uSharp'), 0.10 + (0.0006 - 0.10) * (P.sharp||0));   // 尖り具合 → smooth-abs の eps(0で最も丸い)
    // ブリージング: P.breathBars 小節周期でビート同期ループ(密度を増減)。音量でも密度をブースト。
    var _bars = P.breathBars || 4;
    var _breath = 0.5 + 0.5 * Math.sin(6.2831853 * (this._beat || 0) / (_bars * 4.0));
    _breath = Math.max(_breath, _drive);
    gl.uniform1f(ub('uBreath'), _breath);
    this._drawQuad(this.bufProg);

    // --- pass 2: edge render → target fbo (reading fboB) ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.imgProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fboB.tex);
    const ui = (n)=>gl.getUniformLocation(this.imgProg, n);
    gl.uniform1i(ui('uBuf'), 0);
    gl.uniform2f(ui('uRes'), w, h);
    gl.uniform1f(ui('uFeather'), P.feather);
    gl.uniform1f(ui('uOpaque'), (slot === 'A') ? 1.0 : 0.0);   // Slot A は全面シルバー
    gl.uniform1f(ui('uBlack'), P.black ? 1.0 : 0.0);
    gl.uniform1f(ui('uBgHue'), P.bgHue || 0.0);
    gl.uniform1f(ui('uLineBW'), (this._grayLineWhite != null ? this._grayLineWhite : (P.black ? 0.0 : 1.0)));
    gl.uniform1f(ui('uTime'), flowT);
    this._drawQuad(this.imgProg);

    // swap ping-pong
    const t = this.fboA; this.fboA = this.fboB; this.fboB = t;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },
};
