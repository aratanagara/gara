'use strict';
/* Boltzmann engine — Shadertoy "Lattice Boltzmann" by ... (https://www.shadertoy.com/view/WdyGzy)
   5パス流体シミュ(Image + Buffer A/D/B/C, フィードバックあり)をモードとして移植。
   A:流体発展(自己参照) D:位置場(自己参照) B:位置で手続き画像をルックアップ
   C:Bにライティング Image:レンズフレア。元画像入力は手続きパターンで代替。
   再生速度8倍 = 1フレームにつきシミュ更新を 8 反復。
   バッファは全て RGBA16F(EXT_color_buffer_float)。シム解像度は上限384幅に制限。 */
const Boltzmann = {
  gl:null, initialized:false, ok:false,
  aProg:null, dProg:null, bProg:null, cProg:null, imgProg:null, warpProg:null,
  quad:null,
  A0:null, A1:null, D0:null, D1:null, Bbuf:null, Cbuf:null,
  srcImg:null, imgReady:false,
  IMG_DIR: 'images/fluid/',   // ここからランダムに1枚選んで溶かす(null=手続き的カラーソース)
  sw:0, sh:0, seeded:false,
  MAXW: 384,
  SUBSTEPS: 8,   // 8倍速

  VS:`#version 300 es
in vec2 a_xy; void main(){ gl_Position=vec4(a_xy,0.,1.); }`,

  A_FS:`#version 300 es
precision highp float;
uniform sampler2D uA, uD, uB; uniform vec2 uRes; uniform float uInit, uT, uAmp, uSeed, uEnv, uDir, uSettle; out vec4 Q;
#define R uRes
#define T(U) texture(uA,(U)/R)
#define Bp(U) texture(uB,(U)/R)
vec2 vel(vec4 b){ return vec2(b.x-b.y, b.z-b.w); }
float pr(vec4 b){ return 0.25*(b.x+b.y+b.z+b.w); }
vec4 Av(vec2 U){ U-=.5*vel(T(U)); U-=.5*vel(T(U)); return T(U); }
void main(){
  vec2 U=gl_FragCoord.xy;
  float st = clamp(uSettle, 0.0, 1.0);
  Q=Av(U);
  vec4 n=Av(U+vec2(0,1)), e=Av(U+vec2(1,0)), s=Av(U-vec2(0,1)), w=Av(U-vec2(1,0));
  float px=0.25*(pr(e)-pr(w));
  float py=0.25*(pr(n)-pr(s));
  Q += 0.25*(n.w+e.y+s.z+w.x) - pr(Q) - vec4(px,-px,py,-py);
  float z=.8-length(Bp(U).xyz);
  // 4近傍平均は市松(checkerboard)モードを正確に殺す。強い力ほど市松不安定が育つため uAmp で増強。
  Q = mix(mix(Q,0.25*(n+e+s+w), 0.01 + 0.07*uAmp*uAmp), vec4(pr(Q)), .01*(1.-z));
  // 力場: 上向き一辺倒をやめ、時間で回転する方向 + 中心まわりの渦。
  // 明度依存を弱めて(fz)流れの圧縮=特定色への集中(面積比の崩れ)を抑える。
  // uAmp(0..1) で運動の性格が変わる: 力の強さ / 回転速度 / 渦 / 乱流 / 放射バースト。
  // 二次カーブ(uAmp²)で低域は繊細なまま、MAX はキャンバスから溢れるほど暴れる。
  // uSeed(リセットごとにランダム) で初期位相・渦の向き/中心・乱流位相が毎回変わる。
  float a2 = uAmp*uAmp;
  float fa = uT*mix(0.12, 1.1, a2) + uSeed*6.2831;                                  // ゆっくり強く回る(全体のうねり)
  vec2 ctr = U - R*(0.5 + 0.3*(vec2(fract(uSeed*3.71), fract(uSeed*5.33)) - 0.5));  // 渦中心もランダム
  float vdir = (uDir != 0.0) ? uDir : mix(-1.0, 1.0, step(0.5, fract(uSeed*7.31)));  // uDir!=0: 左右(符号)で渦の向き / 0: シード依存
  vec2 fd = normalize(vec2(sin(fa), -cos(fa)) + vdir*mix(0.35, 3.6, uAmp)*normalize(vec2(-ctr.y, ctr.x) + 1e-4));
  // 大きなうねり: 低周波(画面半分スケール)の揺らぎで全体をぐわんと動かす(細かい乱流ではなく)
  fd = normalize(fd + a2*2.2*vec2(sin(U.y*0.03 + uT*1.3 + uSeed*13.7), cos(U.x*0.025 - uT*1.1 + uSeed*31.4)));
  float fz = mix(0.4, z, 0.6);
  vec2 fv = fd*mix(0.25, 28.0, a2);
  fv += a2*24.0*sin(uT*1.6 + uSeed*6.2831)*normalize(ctr + 1e-4);                   // 膨張⇔収縮の放射スウェル(ぐわん)
  fv *= mix(0.3, 1.9, uEnv);   // 拍頭バースト → easeOutQuint 減衰の混色リズム(BPM同期)
  Q += (st > 0.0 ? 0.0 : 0.0008)*fz*vec4(fv.x, -fv.x, fv.y, -fv.y);
  Q = mix(Q, vec4(pr(Q)), st);
  if(uInit>0.5) Q=vec4(.2);
  if(U.x<3.||R.x-U.x<3.||U.y<3.||R.y-U.y<3.) Q=vec4(pr(Q));
  Q = clamp(Q, vec4(-12.0), vec4(12.0));   // 強い力での数値暴走(NaN/発散)を防止
}`,

  D_FS:`#version 300 es
precision highp float;
uniform sampler2D uA, uD; uniform vec2 uRes; uniform float uInit, uSettle; out vec4 Q;
#define R uRes
#define A(U) texture(uA,(U)/R)
#define dd(U) texture(uD,(U)/R)
vec2 vel(vec4 b){ return vec2(b.x-b.y,b.z-b.w); }
vec4 Dv(vec2 U){ U-=.5*vel(A(U)); U-=.5*vel(A(U)); return dd(U); }
void main(){
  vec2 U=gl_FragCoord.xy;
  Q=Dv(U);
  vec4 q=A(U), n=A(U+vec2(0,1)), e=A(U+vec2(1,0)), s=A(U-vec2(0,1)), w=A(U-vec2(1,0)),
       N=Dv(U+vec2(0,1)), E=Dv(U+vec2(1,0)), S=Dv(U-vec2(0,1)), W=Dv(U-vec2(1,0));
  Q += 0.25*((n.w-q.z)*(N-Q)+(e.y-q.x)*(E-Q)+(s.z-q.w)*(S-Q)+(w.x-q.y)*(W-Q));
  Q = mix(Q, 0.25*(N+E+S+W), 0.008);  // 位置場の拡散は控えめ(輪郭ソリッドとノイズ抑制のバランス)
  if(uInit>0.5) Q=vec4(U,0,0);
  // 暴走・NaN の浄化: 壊れた位置(ホワイトノイズ源)は恒等位置へリセット。
  // NaN は比較が常に false になり下流の検出を全て素通りするため、ここで断つ。
  if(any(isnan(Q)) || any(greaterThan(abs(Q.xy - U), vec2(4.0)*R))) Q = vec4(U, 0, 0);
  Q = mix(Q, vec4(U, 0, 0), clamp(uSettle, 0.0, 1.0));
}`,

  B_FS:`#version 300 es
precision highp float;
uniform sampler2D uD, uImg, uSrc; uniform vec2 uRes; uniform float uHasImg, uUseSrc; out vec4 Q;
#define R uRes
#define D(U) texture(uD,(U)/R)
// 画像未ロード時のフォールバック(滑らかなカラー場)
vec3 img(vec2 uv){
  vec3 c = 0.5 + 0.42*vec3(
    sin(6.2831*uv.x + 0.0),
    sin(6.2831*uv.y + 2.1),
    sin(6.2831*(uv.x+uv.y)*0.7 + 4.2));
  return c*0.5 + 0.28;
}
void main(){
  vec2 U=gl_FragCoord.xy;
  vec2 loc=D(U).xy/R;                          // 流された位置で画像をルックアップ(原典どおり)
  // 位置場の局所勾配から mip を自動選択(かき混ぜられた所ほどぼかす → 点状のゴミをグラデに)
  vec2 gx=(D(U+vec2(1,0)).xy - D(U-vec2(1,0)).xy)*0.5/R;
  vec2 gy=(D(U+vec2(0,1)).xy - D(U-vec2(0,1)).xy)*0.5/R;
  // 適応ぼかし: コヒーレントな引き伸ばし(閾値以下)はシャープ=輪郭ソリッド、
  // 位置場がカオス化した領域(ホワイトノイズ源)だけ急速に強ぼかしして洗い流す。
  // カオス検出は片側差分の最大値(中央差分では +a/-a の市松状の乱れが打ち消されて見えない)。
  vec2 d0c = D(U).xy;
  float ch = max(max(length(D(U+vec2(1,0)).xy - d0c), length(D(U-vec2(1,0)).xy - d0c)),
                 max(length(D(U+vec2(0,1)).xy - d0c), length(D(U-vec2(0,1)).xy - d0c))) / R.x;
  float gm = max(max(length(gx), length(gy)), ch);
  const float t = 0.02;                                  // ~10倍ストレッチまでシャープ
  float g2 = (gm <= t) ? gm : t + (gm - t)*3.0;          // 閾値超はぼかしを3倍勾配で強化
  g2 = min(g2, 0.18);
  float base = max(length(gx), length(gy));
  if(base < 1e-6){ gx = vec2(g2, 0.0); gy = vec2(0.0, g2); }
  else { float sc = g2/base; gx *= sc; gy *= sc; }
  vec3 c = (uUseSrc > 0.5) ? texture(uSrc, clamp(loc, vec2(0.001), vec2(0.999))).xyz
         : (uHasImg > 0.5) ? textureGrad(uImg, loc, gx, gy).xyz
         : img(loc);
  Q=vec4(c, 1.0);
}`,

  C_FS:`#version 300 es
precision highp float;
uniform sampler2D uB; uniform vec2 uRes; out vec4 Q;
#define R uRes
#define T(U) texture(uB,(U)/R)
void main(){
  vec2 U=gl_FragCoord.xy;
  vec3 base=T(U).xyz;                       // 流された画像の色
  // 高さ場(輝度)から法線 → 柔らかな陰影 + ハイライト(色は保持)
  float n=length(T(U+vec2(0,1))), e=length(T(U+vec2(1,0))), s=length(T(U-vec2(0,1))), w=length(T(U-vec2(1,0)));
  vec3 no=normalize(vec3((e-w)*3.0, (n-s)*3.0, 1.0));
  float spec=pow(max(dot(reflect(no, vec3(0,0,1)), normalize(vec3(1))), 0.0), 12.0);
  vec3 col = base*(0.5 + 0.5*no.z) + spec*vec3(0.85,0.9,1.0)*0.3;   // 平坦=×1.0(等倍)。彩度を落とすスペキュラは控えめ
  Q=vec4(col, 1.0);
}`,

  WARP_FS:`#version 300 es
precision highp float;
uniform sampler2D uSrc, uD, uA, uB;
uniform vec2 uSim, uOut;
uniform float uAmount, uPulse;
out vec4 Q;
#define Dp(U) texture(uD,(U)/uSim)
#define Ap(U) texture(uA,(U)/uSim)
#define Bp(U) texture(uB,(U)/uSim)
vec2 vel(vec4 b){ return vec2(b.x-b.y, b.z-b.w); }
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 src(vec2 uv){ return texture(uSrc, clamp(uv, vec2(0.001), vec2(0.999))).rgb; }
void main(){
  vec2 uv = gl_FragCoord.xy / uOut;
  vec2 U = gl_FragCoord.xy * uSim / uOut;
  vec2 suv = U / uSim;
  float amt = clamp(uAmount, 0.0, 1.0);
  float drive = pow(max(amt, 0.0001), 0.55);
  vec2 loc = clamp(Dp(U).xy / uSim, vec2(-0.45), vec2(1.45));
  vec2 v = vel(Ap(U));
  vec2 adv = (loc - suv) * (0.46 + 1.20 * drive);
  vec2 vwarp = v / uSim * (3.8 + 24.0 * drive);
  vec2 warp = adv + vwarp;
  vec2 wuv = clamp(uv + warp, vec2(0.001), vec2(0.999));

  vec2 dir = normalize(warp + vec2(0.00001));
  float flow = clamp(length(v) * 0.052 + length(warp) * 2.7, 0.0, 1.0);
  vec2 sm = dir / uOut * (1.4 + 15.0 * drive) * flow;
  vec3 col = src(wuv);
  col = mix(col, (src(wuv + sm) + col + src(wuv - sm)) / 3.0, flow * drive * 0.58);

  float b0 = lum(Bp(U).rgb);
  float bx = lum(Bp(U + vec2(1.0, 0.0)).rgb) - lum(Bp(U - vec2(1.0, 0.0)).rgb);
  float by = lum(Bp(U + vec2(0.0, 1.0)).rgb) - lum(Bp(U - vec2(0.0, 1.0)).rgb);
  vec3 n = normalize(vec3(-bx * 4.0, -by * 4.0, 1.0));
  vec3 l = normalize(vec3(-0.45, 0.55, 0.70));
  float edge = clamp(length(vec2(bx, by)) * 4.0, 0.0, 1.0);
  float diff = dot(n, l);
  float relief = edge * drive;
  col *= 1.0 - max(0.0, -diff) * relief * 0.13;
  col += vec3(0.92, 0.96, 1.0) * max(0.0, diff) * relief * 0.07;
  col += vec3(1.0) * pow(max(0.0, dot(reflect(-l, n), vec3(0.0,0.0,1.0))), 24.0) * relief * 0.08;
  Q = vec4(clamp(col, 0.0, 1.0), 1.0);
}`,

  IMG_FS:`#version 300 es
precision highp float;
uniform sampler2D uC; uniform vec2 uSim, uOut; out vec4 Q;
#define T(U) texture(uC,(U)/uSim)
// 明るい部分のみ穏やかにブルーム(色は保持)
vec4 Fl(vec2 U, vec2 r){ vec3 t=T(U+r).xyz; return vec4(exp(-.018*dot(r,r))*max(t-0.6, 0.0), 0.0); }
void main(){
  vec2 U=gl_FragCoord.xy * uSim / uOut;   // 出力座標 → シム座標
  vec3 bloom=vec3(0);
  for(float i=0.;i<7.;i+=1.3){
    bloom+=Fl(U, vec2(-i,i)).xyz; bloom+=Fl(U, vec2(i,i)).xyz;
    bloom+=Fl(U,-vec2(-i,i)).xyz; bloom+=Fl(U,-vec2(i,i)).xyz;
  }
  vec3 c0 = T(U).xyz;
  // 輪郭をソリッドに: コヒーレントな境界のみアンシャープ。荒れた領域(ノイズ)は逆に平滑化。
  vec3 cN = (T(U+vec2(0,1)).xyz + T(U+vec2(1,0)).xyz + T(U-vec2(0,1)).xyz + T(U-vec2(1,0)).xyz)*0.25;
  float varn = length(c0 - cN);
  float w = smoothstep(0.22, 0.08, varn);              // 1=コヒーレント(シャープ), 0=荒れ(平滑)
  vec3 col = mix(mix(c0, cN, 0.85), c0 + (c0 - cN)*0.6, w) + 0.05*bloom;
  col = clamp(col, 0.0, 1.0);             // 明度・彩度は等倍(トーンマップ/ガンマなし)
  Q=vec4(col, 1.0);
}`,

  _compile(type, src){
    const gl=this.gl; const sh=gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if(!__glReady(gl, sh, false)) console.warn('Boltzmann shader:', gl.getShaderInfoLog(sh));
    return sh;
  },
  _link(fs){
    const gl=this.gl; const p=gl.createProgram();
    gl.attachShader(p, this._compile(gl.VERTEX_SHADER, this.VS));
    gl.attachShader(p, this._compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'a_xy');
    gl.linkProgram(p);
    if(!__glReady(gl, p, true)) console.warn('Boltzmann link:', gl.getProgramInfoLog(p));
    return p;
  },
  _mkFBO(w, h, f32){
    const gl=this.gl;
    const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // f32: 位置場(D)用の高精度。half だと絶対座標が ~0.2px に量子化され境界がカクつく。
    if(f32) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    else    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
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
    [this.A0,this.A1,this.D0,this.D1,this.Bbuf,this.Cbuf].forEach(f=>{ if(f){ gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fbo); } });
    this.A0=this._mkFBO(w,h); this.A1=this._mkFBO(w,h);
    this.D0=this._mkFBO(w,h,this.f32lin); this.D1=this._mkFBO(w,h,this.f32lin);
    this.Bbuf=this._mkFBO(w,h); this.Cbuf=this._mkFBO(w,h);
    this.sw=w; this.sh=h; this.seeded=false;
  },

  init(gl){
    if(this.initialized) return;
    this.gl=gl;
    if(!gl.getExtension('EXT_color_buffer_float')){
      console.warn('Boltzmann: EXT_color_buffer_float 未対応 — 無効化');
      this.initialized=true; this.ok=false; return;
    }
    // 位置場を float32 で持てるか (linear フィルタ対応が必要)。非対応なら half にフォールバック。
    this.f32lin = !!gl.getExtension('OES_texture_float_linear');
    this.aProg=this._link(this.A_FS);
    this.dProg=this._link(this.D_FS);
    this.bProg=this._link(this.B_FS);
    this.cProg=this._link(this.C_FS);
    this.imgProg=this._link(this.IMG_FS);
    this.warpProg=this._link(this.WARP_FS);
    this.quad=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    this._loadImage();
    this.initialized=true; this.ok=true;
  },

  _loadImage(){
    const gl=this.gl;
    const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128,128,128,255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.srcImg=tex;
    this.pickRandomImage();
  },

  // fluid フォルダの manifest からランダムに1枚選んでロード
  pickRandomImage(){
    this._extSrc = false;   // プリセットモード: フォルダ画像を再び使う
    if(!this.IMG_DIR) return;
    fetch(this.IMG_DIR + 'manifest.json', { cache:'no-cache' })
      .then(r=>r.json())
      .then(list=>{
        list = (list||[]).filter(n=>/\.(png|jpe?g|webp|gif|bmp)$/i.test(n));
        if(!list.length) return;
        const name = list[Math.floor(Math.random()*list.length)];
        this._loadImageFile(this.IMG_DIR + encodeURIComponent(name));
      })
      .catch(e=>console.warn('Boltzmann: manifest 読み込み失敗', e));
  },
  _loadImageFile(url){
    const im=new Image();
    im.onload=()=>{
      const g=this.gl; if(!g) return;
      if(this._extSrc) return;   // Post FX が捕獲フレームを使用中は上書きしない
      g.bindTexture(g.TEXTURE_2D, this.srcImg);
      g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, im);
      g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
      g.generateMipmap(g.TEXTURE_2D);   // textureGrad のぼかし(グラデ溶け)用
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.REPEAT);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.REPEAT);
      this.imgReady=true;
    };
    im.onerror=()=>{ console.warn('Boltzmann: 画像ロード失敗', url); };
    im.src=url;
  },

  update(beat, dt){},

  _bindQuad(){
    const gl=this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  },
  _u(prog,n){ return this.gl.getUniformLocation(prog,n); },

  // A: uA(Acur) uD(Dcur) uB(Bbuf) → Anext
  _stepA(init){
    const gl=this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.A1.fbo); gl.viewport(0,0,this.sw,this.sh);
    gl.useProgram(this.aProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.A0.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.D0.tex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.Bbuf.tex);
    gl.uniform1i(this._u(this.aProg,'uA'),0); gl.uniform1i(this._u(this.aProg,'uD'),1); gl.uniform1i(this._u(this.aProg,'uB'),2);
    gl.uniform2f(this._u(this.aProg,'uRes'), this.sw, this.sh);
    gl.uniform1f(this._u(this.aProg,'uInit'), init?1:0);
    gl.uniform1f(this._u(this.aProg,'uT'), performance.now()*0.001);
    gl.uniform1f(this._u(this.aProg,'uAmp'), (this._amp != null) ? this._amp : 0.32);
    gl.uniform1f(this._u(this.aProg,'uDir'), this._dir || 0);   // 渦の向き(post-FX の符号 / 0=シード依存)
    gl.uniform1f(this._u(this.aProg,'uSeed'), this._seed || 0);
    gl.uniform1f(this._u(this.aProg,'uEnv'), (this._env != null) ? this._env : 0.55);
    gl.uniform1f(this._u(this.aProg,'uSettle'), this._settle || 0);
    gl.drawArrays(gl.TRIANGLES,0,3);
    const t=this.A0; this.A0=this.A1; this.A1=t;
  },
  // D: uA(Acur) uD(Dcur) → Dnext
  _stepD(init){
    const gl=this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.D1.fbo); gl.viewport(0,0,this.sw,this.sh);
    gl.useProgram(this.dProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.A0.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.D0.tex);
    gl.uniform1i(this._u(this.dProg,'uA'),0); gl.uniform1i(this._u(this.dProg,'uD'),1);
    gl.uniform2f(this._u(this.dProg,'uRes'), this.sw, this.sh);
    gl.uniform1f(this._u(this.dProg,'uInit'), init?1:0);
    gl.uniform1f(this._u(this.dProg,'uSettle'), this._settle || 0);
    gl.drawArrays(gl.TRIANGLES,0,3);
    const t=this.D0; this.D0=this.D1; this.D1=t;
  },
  // B: uD(Dcur) + 画像 → Bbuf
  _stepB(srcTex=null){
    const gl=this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.Bbuf.fbo); gl.viewport(0,0,this.sw,this.sh);
    gl.useProgram(this.bProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.D0.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.srcImg);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, srcTex || this.srcImg);
    gl.uniform1i(this._u(this.bProg,'uD'),0);
    gl.uniform1i(this._u(this.bProg,'uImg'),1);
    gl.uniform1i(this._u(this.bProg,'uSrc'),2);
    gl.uniform1f(this._u(this.bProg,'uHasImg'), this.imgReady ? 1 : 0);
    gl.uniform1f(this._u(this.bProg,'uUseSrc'), srcTex ? 1 : 0);
    gl.uniform2f(this._u(this.bProg,'uRes'), this.sw, this.sh);
    gl.drawArrays(gl.TRIANGLES,0,3);
  },

  renderWarp({ srcTex, fbo, w, h, amount, pulse, settle=0 }){
    const gl=this.gl;
    if(!srcTex) return this.render({ fbo, w, h, amount, pulse });
    this._env = (pulse != null) ? Math.pow(1.0 - Math.min(1, Math.max(0, pulse)), 4.0) : 0.55;
    this._settle = Math.max(0, Math.min(0.08, +settle || 0));
    const amt = Math.max(0, Math.min(1, Math.abs(amount) || 0));   // 強度 (0..1)
    if(this._dir == null) this._dir = 1;                           // 向きは reseed 時に App 側でランダム抽選 (符号では決めない)
    const drive = Math.pow(Math.max(amt, 0.0001), 0.55);
    this._amp = Math.min(1, 0.07 + drive * 0.76);
    const steps = this._settle > 0 ? Math.max(4, Math.round(5 + drive*9)) : Math.max(2, Math.round(2 + drive*12));
    if(!this.initialized) this.init(gl);
    if(!this.ok){
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0,0,w,h);
      gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); return;
    }
    let sw=Math.min(w, this.MAXW); let sh=Math.max(2, Math.round(sw*h/w));
    if(sw!==this.sw || sh!==this.sh) this._resize(sw, sh);

    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
    this._bindQuad();

    if(!this.seeded){
      this._seed = Math.random();
      this._stepA(true); this._stepD(true); this._stepB(srcTex);
      this.seeded=true;
    }
    for(let k=0;k<steps;k++){
      this._stepA(false);
      this._stepD(false);
      this._stepB(srcTex);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0,0,w,h);
    gl.useProgram(this.warpProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.D0.tex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.A0.tex);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.Bbuf.tex);
    gl.uniform1i(this._u(this.warpProg,'uSrc'),0);
    gl.uniform1i(this._u(this.warpProg,'uD'),1);
    gl.uniform1i(this._u(this.warpProg,'uA'),2);
    gl.uniform1i(this._u(this.warpProg,'uB'),3);
    gl.uniform2f(this._u(this.warpProg,'uSim'), this.sw, this.sh);
    gl.uniform2f(this._u(this.warpProg,'uOut'), w, h);
    gl.uniform1f(this._u(this.warpProg,'uAmount'), amt);
    gl.uniform1f(this._u(this.warpProg,'uPulse'), this._env);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },

  render({ fbo, w, h, amount, pulse }){
    const gl=this.gl;
    // pulse(拍位相 0..1): 拍頭=1 → easeOutQuint で減衰する混色エンベロープ。未指定は中庸固定。
    this._env = (pulse != null) ? Math.pow(1.0 - Math.min(1, Math.max(0, pulse)), 4.0) : 0.55;
    // amount(0..1, Post FX スライダー): 力の強さ(uAmp) + シミュ更新回数(=動きの速さ)。
    // 未指定(プリセットモード)は従来挙動: uAmp 0.32 ≒ 力1.0倍 / SUBSTEPS 固定。
    const amt = (amount != null) ? Math.max(0, Math.min(1, amount)) : null;
    this._settle = 0;
    this._amp = (amt != null) ? amt : 0.42;   // プリセットモードは中庸の運動(力≒1.0倍相当)
    this._dir = 0;                            // プリセットモードは渦の向きをシード依存に(従来通り)
    const steps = (amt != null) ? Math.max(1, Math.round(2 + amt*18)) : this.SUBSTEPS;
    if(!this.initialized) this.init(gl);
    if(!this.ok){ // 非対応: ターゲットを黒で残す
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0,0,w,h);
      gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); return;
    }
    let sw=Math.min(w, this.MAXW); let sh=Math.max(2, Math.round(sw*h/w));
    if(sw!==this.sw || sh!==this.sh) this._resize(sw, sh);

    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
    this._bindQuad();

    if(!this.seeded){
      this._seed = Math.random();   // リセットごとに動きの性格を変えるシード
      this._stepA(true); this._stepD(true); this._stepB();
      this.seeded=true;
    }
    for(let k=0;k<steps;k++){
      this._stepA(false);
      this._stepD(false);
      this._stepB();
    }
    // C: ライティング → Cbuf
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.Cbuf.fbo); gl.viewport(0,0,this.sw,this.sh);
    gl.useProgram(this.cProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.Bbuf.tex);
    gl.uniform1i(this._u(this.cProg,'uB'),0);
    gl.uniform2f(this._u(this.cProg,'uRes'), this.sw, this.sh);
    gl.drawArrays(gl.TRIANGLES,0,3);

    // Image: レンズフレア → target(スロット解像度)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0,0,w,h);
    gl.useProgram(this.imgProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.Cbuf.tex);
    gl.uniform1i(this._u(this.imgProg,'uC'),0);
    gl.uniform2f(this._u(this.imgProg,'uSim'), this.sw, this.sh);
    gl.uniform2f(this._u(this.imgProg,'uOut'), w, h);
    gl.drawArrays(gl.TRIANGLES,0,3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },
};
