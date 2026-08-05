'use strict';
/* Slicer engine — /Users/aratanagara/Dropbox/shader/slicer の 3D 断片散布シェーダを VJ 用に移植。
   - 既存の vj WebGL2 コンテキストを共有
   - 指定 FBO に描画 → 通常のクロスフェード/Post FX パイプラインに合流
   - images/slicer/ から画像を自動列挙
   - 元実装の WEBGL_depth_texture は WebGL2 (DEPTH_COMPONENT24) で代替
*/

// 画像ごとの保存対象キー (postScale=品質設定は共通のまま)
const SL_IMG_KEYS = ['pieces','seed','sides','maxSides','explode','bend','curl','warpAmp','warpFreq',
  'overlapShadow','shadowStr','shadowRadius','shadowBias','autorot','camEl','fov','dist',
  'autoMode','autoRebuildBeats','autoZoomAmp','autoElAmp','bgMode'];

const Slicer = {
  gl:null,
  initialized:false,
  prog:null,                 // メインシェーダ (断片描画)
  postProg:null,             // ポストエフェクト (overlap shadow / AO)
  posBuf:null, uvBuf:null, seedBuf:null, idxBuf:null, numIdx:0,
  quadBuf:null,
  sceneFbo:null, sceneColorTex:null, sceneDepthTex:null,
  fboW:0, fboH:0,
  imgTex:null, imgW:1, imgH:1, imgAsp:1, imageReady:false,
  library:[],

  P:{
    pieces:150,
    seed:0,            // 断片配置のランダムシード (offset)
    sides:3,           // N-gon フラグメントの頂点数 (maxSides=0 なら固定)
    maxSides:8,        // 0=固定, 3以上=sides..maxSides のランダム
    explode:2.5,
    bend:0.8,
    curl:0.4,
    warpAmp:0.0,       // グローバル warp 振幅 (0=off。M006 相当に空間全体を曲げる)
    warpFreq:2.0,      // グローバル warp 周波数
    overlapShadow:true,
    shadowStr:0.45,
    shadowRadius:2.2,
    shadowBias:0.006,
    autorot:1.20,      // 自動回転速度 (0.5→1.2)
    camEl:0.30,        // 仰角
    fov:60,            // 視野角 (deg)
    dist:2.5,          // カメラ距離 (元 CAM_Z)
    autoMode:true,     // Auto: パラメータ & カメラを連続変調
    autoRebuildBeats:1,  // Auto 時、シーン再構築の周期 (拍) — 毎拍リシャッフル
    autoZoomAmp:0.75,  // ズーム振幅 (1.0=±100%) — 0.45→0.75 でダイナミック
    autoElAmp:0.65,    // 仰角ドリフト振幅 (rad) — 0.40→0.65
    postScale:0.75,    // ポストエフェクトの解像度スケール (0.75 = 約 56% ピクセル)
    bgMode:'image',    // 'black' | 'white' | 'image' (平均色で画像になじませる)
    // ── 画像選択 (ランタイム設定。画像ごと保存 SL_IMG_KEYS には含めない。
    //    含めると画像を読むたびにモードが上書きされ、Random が即 fixed に戻る) ──
    imgMode:'fixed',   // 'fixed' = 選んだ画像 / 'random' = ランダム表示
    imgBeats:8,        // random 時に画像を切り替える拍数 (0=自動切替なし)
  },
  PDefaults:null,

  cam:{az:0, el:0.3, dist:2.5},
  startTime:0,
  _t:0,
  _needsRebuild:false,

  // ==== shaders ====
  VS:`#version 300 es
in vec3 a_pos;
in vec2 a_uv;
in float a_seed;
uniform mat4 u_proj;
uniform mat4 u_view;
uniform float u_time;
uniform float u_warpAmp;    // グローバル warp 振幅 (M006 相当・空間全体を曲げる)
uniform float u_warpFreq;   // グローバル warp 周波数
out vec2 v_uv;
void main(){
  v_uv = a_uv;
  vec3 pos = a_pos;
  // グローバル warp: 空間全体を正弦場で曲げる/波打たせる (アニメ)
  if(u_warpAmp > 0.0001){
    float wf = u_warpFreq;
    pos.z += u_warpAmp * sin(pos.x*wf + u_time*1.1) * cos(pos.y*wf*0.8 - u_time*0.9);
    pos.x += u_warpAmp * 0.6 * sin(pos.y*wf*0.7 + u_time*0.8);
    pos.y += u_warpAmp * 0.4 * cos(pos.z*wf*0.9 - u_time*0.7);
  }
  float d = 0.004;
  pos.x += sin(u_time*0.17 + a_seed*13.7) * d;
  pos.y += cos(u_time*0.13 + a_seed*7.31) * d * 0.7;
  pos.z += sin(u_time*0.11 + a_seed*5.17) * d * 0.4;
  gl_Position = u_proj * u_view * vec4(pos, 1.0);
}`,
  FS:`#version 300 es
precision highp float;
uniform sampler2D u_map;
in vec2 v_uv;
out vec4 fragOut;
void main(){
  fragOut = vec4(texture(u_map, v_uv).rgb, 1.0);
}`,
  POST_VS:`#version 300 es
in vec2 a_xy;
out vec2 v_uv;
void main(){
  v_uv = a_xy*0.5 + 0.5;
  gl_Position = vec4(a_xy, 0.0, 1.0);
}`,
  POST_FS:`#version 300 es
precision highp float;
uniform sampler2D u_color;
uniform sampler2D u_depth;
uniform vec2 u_invRes;
uniform float u_strength;
uniform float u_radius;
uniform float u_bias;
uniform float u_enabled;
in vec2 v_uv;
out vec4 fragOut;

float getDepth(vec2 uv){
  return texture(u_depth, clamp(uv, 0.0, 1.0)).r;
}
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

void main(){
  vec3 color = texture(u_color, v_uv).rgb;
  // 背景(ジオメトリなし=深度1.0)はアルファ0で透過。断片はアルファ1。
  if(u_enabled < 0.5){ fragOut = vec4(color, getDepth(v_uv) < 0.999999 ? 1.0 : 0.0); return; }
  float centerDepth = getDepth(v_uv);
  if(centerDepth >= 0.999999){ fragOut = vec4(color, 0.0); return; }
  float px = 1.0 + u_radius * 0.55;
  vec2 texel = u_invRes * px;
  vec2 lightDir = normalize(vec2(-0.82, -0.57));
  vec2 perpDir = vec2(-lightDir.y, lightDir.x);
  float dirShadow = 0.0;
  float dirWeight = 0.0;
  // 軽量化: lane 5→3, step max 32→12
  float maxSteps = max(4.0, floor(u_radius * 2.5 + 3.0));
  for(int lane = 0; lane < 3; lane++){
    float laneT = float(lane) - 1.0;
    vec2 laneOffset = perpDir * laneT * texel * 1.4;
    float laneShadow = 0.0;
    float laneWeight = 0.0;
    for(int i = 1; i <= 12; i++){
      float fi = float(i);
      if(fi > maxSteps) break;
      float t = fi / maxSteps;
      vec2 sampleUv = v_uv - lightDir * texel * fi * 1.75 + laneOffset * (0.5 + 0.7 * t);
      float sampleDepth = getDepth(sampleUv);
      float blocker = smoothstep(u_bias * 0.55, u_bias * 4.5 + 0.00022, centerDepth - sampleDepth);
      float falloff = mix(1.0, 0.2, t * t);
      laneShadow += blocker * falloff;
      laneWeight += falloff;
    }
    dirShadow += laneShadow / max(laneWeight, 1e-4);
    dirWeight += 1.0;
  }
  dirShadow /= max(dirWeight, 1e-4);
  // AO: 8 方向 → 4 方向 (X+Y+対角ペア)、step 3→2
  vec2 dirs[4];
  dirs[0]=vec2(1.0,0.0); dirs[1]=vec2(0.0,1.0);
  dirs[2]=normalize(vec2(1.0,1.0));  dirs[3]=normalize(vec2(-1.0,1.0));
  float ao = 0.0, edge = 0.0, aoWeight = 0.0;
  for(int d = 0; d < 4; d++){
    vec2 dir = dirs[d];
    for(int i = 1; i <= 2; i++){
      float fi = float(i);
      float w = 1.0 / fi;
      // ±方向を 1 サンプル内でまとめて評価 (2 方向ぶん)
      vec2 sampleUv1 = v_uv + dir * texel * fi * 0.95;
      vec2 sampleUv2 = v_uv - dir * texel * fi * 0.95;
      float sd1 = getDepth(sampleUv1);
      float sd2 = getDepth(sampleUv2);
      float closer1 = smoothstep(u_bias * 0.3, u_bias * 2.2 + 0.00018, centerDepth - sd1);
      float closer2 = smoothstep(u_bias * 0.3, u_bias * 2.2 + 0.00018, centerDepth - sd2);
      float delta1 = abs(centerDepth - sd1);
      float delta2 = abs(centerDepth - sd2);
      ao   += (closer1 + closer2) * 0.5 * w;
      edge += (smoothstep(u_bias * 0.12, u_bias * 1.2 + 0.00012, delta1)
             + smoothstep(u_bias * 0.12, u_bias * 1.2 + 0.00012, delta2)) * 0.5 * w;
      aoWeight += w;
    }
  }
  ao /= max(aoWeight, 1e-4);
  edge /= max(aoWeight, 1e-4);
  float dFront = getDepth(v_uv - lightDir * texel * 0.9);
  float dBack  = getDepth(v_uv + lightDir * texel * 0.9);
  float edgeSide = smoothstep(u_bias * 0.12, u_bias * 1.8 + 0.00012, dBack - dFront);
  float lum = luma(color);
  float whiteBoost = smoothstep(0.9, 1.0, lum);
  float faintFloor = whiteBoost * (0.016 + 0.032 * ao + 0.05 * dirShadow + 0.03 * edge) * clamp(u_strength, 0.0, 1.5);
  vec3 paperBase = mix(color, vec3(1.0 - faintFloor), whiteBoost);
  float shadowMix =
      dirShadow * (0.22 + 0.12 * whiteBoost) +
      ao        * (0.20 + 0.10 * whiteBoost) +
      edge      * (0.07 + 0.08 * whiteBoost) +
      edgeSide  * 0.08;
  float darken = clamp(shadowMix * clamp(u_strength, 0.0, 1.5), 0.0, 0.42);
  fragOut = vec4(paperBase * (1.0 - darken), 1.0);
}`,

  // ===== math helpers =====
  m4:{
    perspective(fov,asp,n,f){
      const t=1/Math.tan(fov*.5), nf=1/(n-f);
      return new Float32Array([t/asp,0,0,0, 0,t,0,0, 0,0,(f+n)*nf,-1, 0,0,2*f*n*nf,0]);
    },
    lookAt(eye, ctr, up){
      const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
      const norm=(a)=>{const l=Math.hypot(a[0],a[1],a[2]);return l>1e-8?[a[0]/l,a[1]/l,a[2]/l]:[0,1,0];};
      const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
      const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
      const z=norm(sub(eye,ctr));
      const x=norm(cross(up,z));
      const y=cross(z,x);
      return new Float32Array([
        x[0],y[0],z[0],0,
        x[1],y[1],z[1],0,
        x[2],y[2],z[2],0,
        -dot(x,eye),-dot(y,eye),-dot(z,eye),1
      ]);
    },
  },

  init(gl){
    if(this.initialized) return true;
    this.gl = gl;
    this.PDefaults = JSON.parse(JSON.stringify(this.P));
    // メインシェーダ
    this.prog = this._compileProg(this.VS, this.FS);
    this.postProg = this._compileProg(this.POST_VS, this.POST_FS);
    if(!this.prog || !this.postProg){ console.error('Slicer: shader compile failed'); return false; }
    this.locs = {
      a_pos:  gl.getAttribLocation(this.prog,'a_pos'),
      a_uv:   gl.getAttribLocation(this.prog,'a_uv'),
      a_seed: gl.getAttribLocation(this.prog,'a_seed'),
      u_proj: gl.getUniformLocation(this.prog,'u_proj'),
      u_view: gl.getUniformLocation(this.prog,'u_view'),
      u_map:  gl.getUniformLocation(this.prog,'u_map'),
      u_time: gl.getUniformLocation(this.prog,'u_time'),
      u_warpAmp:  gl.getUniformLocation(this.prog,'u_warpAmp'),
      u_warpFreq: gl.getUniformLocation(this.prog,'u_warpFreq'),
    };
    this.pLocs = {
      a_xy:       gl.getAttribLocation(this.postProg,'a_xy'),
      u_color:    gl.getUniformLocation(this.postProg,'u_color'),
      u_depth:    gl.getUniformLocation(this.postProg,'u_depth'),
      u_invRes:   gl.getUniformLocation(this.postProg,'u_invRes'),
      u_strength: gl.getUniformLocation(this.postProg,'u_strength'),
      u_radius:   gl.getUniformLocation(this.postProg,'u_radius'),
      u_bias:     gl.getUniformLocation(this.postProg,'u_bias'),
      u_enabled:  gl.getUniformLocation(this.postProg,'u_enabled'),
    };
    // 全画面 quad
    this.quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    // ダミーテクスチャ
    this.imgTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([180,180,180,255]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    this.startTime = performance.now();
    this.initialized = true;
    return true;
  },

  _compileShader(type, src){
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if(!__glReady(gl, s, false)){
      console.error('Slicer shader error:', gl.getShaderInfoLog(s), src);
      return null;
    }
    return s;
  },
  _compileProg(vs, fs){
    const gl = this.gl;
    const v = this._compileShader(gl.VERTEX_SHADER, vs);
    const f = this._compileShader(gl.FRAGMENT_SHADER, fs);
    if(!v || !f) return null;
    const p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    if(!__glReady(gl, p, true)){
      console.error('Slicer link error:', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  },

  _ensureSceneTargets(w, h){
    const gl = this.gl;
    if(this.sceneFbo && this.fboW===w && this.fboH===h) return;
    if(this.sceneColorTex) gl.deleteTexture(this.sceneColorTex);
    if(this.sceneDepthTex) gl.deleteTexture(this.sceneDepthTex);
    if(this.sceneFbo) gl.deleteFramebuffer(this.sceneFbo);
    if(this.postFbo) gl.deleteFramebuffer(this.postFbo);
    if(this.postColorTex) gl.deleteTexture(this.postColorTex);

    this.fboW = w; this.fboH = h;
    this.sceneFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);

    this.sceneColorTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.sceneColorTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneColorTex, 0);

    this.sceneDepthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.sceneDepthTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,w,h,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.sceneDepthTex, 0);

    // ポスト出力用の小型 FBO (低解像度) — blit で目的 FBO へアップスケール
    this.postFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.postFbo);
    this.postColorTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.postColorTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.postColorTex, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },

  // ====== シーン生成 (元 slicer の buildScene を移植) ======
  buildScene(){
    const A = this.imgAsp;
    const N_FRAGS = this.P.pieces|0;
    const EXPLODE = this.P.explode;
    const BEND    = this.P.bend;
    const CURL    = this.P.curl;
    const CAM_Z   = this.P.dist;

    const posArr=[], uvArr=[], seedArr=[], idxArr=[];
    let vi = 0;
    const SEED = (this.P.seed || 0) * 0.137;
    const rnd  = (s)=> Math.abs(Math.sin((s+SEED)*127.1+1.3)*43758.5453%1);
    const rnds = (s)=> rnd(s)*2-1;

    function wpos(fx, fy, p){
      let lx=fx-p.cx, ly=fy-p.cy;
      let lz=0;
      // ── bend: 曲げ軸に沿って円弧に巻く(弧長保存 → 伸びずに曲がる。x,y も曲げ、z は有界) ──
      const bax=Math.cos(p.bendAxis), bay=Math.sin(p.bendAxis);
      const bpx=-bay, bpy=bax;
      let u = lx*bax + ly*bay;              // 曲げ軸方向
      const wperp = lx*bpx + ly*bpy;        // 直交成分(保持)
      const kb = p.bendAmt*0.6;             // 曲率(大きいほどきつく巻く)
      if(Math.abs(kb) > 1e-4){
        lz += (1 - Math.cos(u*kb))/kb;
        u = Math.sin(u*kb)/kb;              // 巻き込みで軸方向が縮む(=伸びない)
      }
      lx = u*bax + wperp*bpx;
      ly = u*bay + wperp*bpy;
      // ── curl: 直交軸で細かくうねる(振幅は有界・curl大でうねりを細かく。面内も縮めて伸び抑制) ──
      const cax=Math.cos(p.curlAxis), cay=Math.sin(p.curlAxis);
      const v = lx*cax + ly*cay;
      if(Math.abs(p.curlAmt) > 1e-4){
        const amp = Math.min(Math.abs(p.curlAmt), 4.0)*0.28*Math.sign(p.curlAmt);
        const freq = p.curlFreq*(1 + Math.abs(p.curlAmt)*0.3);
        const ph = v*freq;
        lz += Math.sin(ph)*amp;
        const shr = (Math.cos(ph)-1)*Math.abs(amp)*0.5;   // うねる分 軸方向を縮める
        lx += shr*cax; ly += shr*cay;
      }
      // ── tilt(元と同様 z へシア) ──
      const cosY=Math.cos(p.tiltY),sinY=Math.sin(p.tiltY);
      const lz2=-lx*sinY+lz*cosY;
      const cosX=Math.cos(p.tiltX),sinX=Math.sin(p.tiltX);
      const lz3=ly*sinX+lz2*cosX;
      const wz=p.baseZ+lz3;
      const sc=Math.max(0.01,1-wz/CAM_Z);
      return [(p.cx+lx)*sc, (p.cy+ly)*sc, wz];
    }
    function emit(fx, fy, fid, p){
      const w = wpos(fx, fy, p);
      posArr.push(w[0], w[1], w[2]);
      uvArr.push(fx/A*0.5+0.5, 1-(fy*0.5+0.5));
      seedArr.push(fid*7.3713);
      return vi++;
    }
    const SUBDIV = 2; // 3→2 (各三角形 64tri → 16tri)
    function subdivTri(ax,ay,bx,by,cx,cy,fid,p,d){
      if(d<=0){
        idxArr.push(emit(ax,ay,fid,p), emit(bx,by,fid,p), emit(cx,cy,fid,p));
        return;
      }
      const mx=(ax+bx)/2,my=(ay+by)/2;
      const nx=(bx+cx)/2,ny=(by+cy)/2;
      const ox=(cx+ax)/2,oy=(cy+ay)/2;
      d--;
      subdivTri(ax,ay,mx,my,ox,oy,fid,p,d);
      subdivTri(mx,my,bx,by,nx,ny,fid,p,d);
      subdivTri(ox,oy,nx,ny,cx,cy,fid,p,d);
      subdivTri(mx,my,nx,ny,ox,oy,fid,p,d);
    }
    function subdivQuad(ax,ay,bx,by,cx,cy,dx,dy,fid,p,d){
      subdivTri(ax,ay,bx,by,dx,dy,fid,p,d);
      subdivTri(bx,by,cx,cy,dx,dy,fid,p,d);
    }
    function makeParams(fid, cx, cy){
      const s=fid*13.71+3.3;
      const dr=rnd(s+0.80);
      const dbi=dr<0.5?Math.pow(dr*2,1.8)*0.5:1-Math.pow((1-dr)*2,1.8)*0.5;
      const baseZ=(rnd(s+0.81)>0.5?1:-1)*dbi*EXPLODE*1.2;
      return {
        cx, cy, baseZ,
        bendAxis: rnd(s+0.20)*6.2832, bendAmt: rnds(s+0.21)*BEND,
        curlAxis: rnd(s+0.30)*6.2832, curlAmt: rnds(s+0.31)*CURL,
        curlFreq: 1.5+rnd(s+0.32)*6.0,
        tiltX: rnds(s+0.40)*0.5*EXPLODE,
        tiltY: rnds(s+0.41)*0.5*EXPLODE,
      };
    }

    for(let fid=0; fid<N_FRAGS; fid++){
      const s=fid*17.31+1.1;
      const cx=rnds(s+0.1)*A*0.9;
      const cy=rnds(s+0.2)*0.9;
      const p=makeParams(fid, cx, cy);
      const sizeSeed = rnd(s+0.50);
      const sizeClass = rnd(s+0.51);
      let baseSize;
      if(sizeClass < 0.5){
        baseSize = Math.pow(sizeSeed, 2.0) * 0.08 * A + 0.005 * A;
      } else if(sizeClass < 0.82){
        baseSize = (0.05 + sizeSeed * 0.15) * A;
      } else {
        baseSize = (0.15 + sizeSeed * 0.35) * A;
      }
      const rot = rnd(s+0.55)*Math.PI*2;
      const cr=Math.cos(rot), sr=Math.sin(rot);
      const R=(lx,ly,c,ss)=>[lx*c-ly*ss+cx, lx*ss+ly*c+cy];
      const shapeType = Math.floor(rnd(s+0.60)*7);

      if(shapeType===0){
        const minN = Math.max(3, this.P.sides|0);
        const maxN = (this.P.maxSides >= 3) ? Math.max(minN, this.P.maxSides|0) : minN;
        const N = Math.floor(rnd(s+0.67) * (maxN - minN + 1)) + minN;
        for(let k=0;k<N;k++){
          const a0=(k/N)*Math.PI*2+rot;
          const a1=((k+1)/N)*Math.PI*2+rot;
          const r0=baseSize*(0.6+rnd(s+0.61+k*0.07)*0.8);
          const r1=baseSize*(0.6+rnd(s+0.62+k*0.07)*0.8);
          subdivTri(cx, cy,
                    cx+Math.cos(a0)*r0, cy+Math.sin(a0)*r0,
                    cx+Math.cos(a1)*r1, cy+Math.sin(a1)*r1, fid,p,SUBDIV);
        }
      } else if(shapeType===1){
        const w=baseSize*(0.4+rnd(s+0.61)*0.8);
        const h=baseSize*(0.3+rnd(s+0.62)*0.7);
        const shear=(rnd(s+0.63)-0.5)*w*0.6;
        const [ax,ay]=R(-w,-h+shear,cr,sr);
        const [bx,by]=R( w,-h-shear,cr,sr);
        const [ccx,ccy]=R( w, h-shear,cr,sr);
        const [dx,dy]=R(-w, h+shear,cr,sr);
        subdivQuad(ax,ay,bx,by,ccx,ccy,dx,dy,fid,p,SUBDIV);
      } else if(shapeType===2){
        const len=baseSize*(2.0+rnd(s+0.61)*5.0);
        const wid=baseSize*(0.015+rnd(s+0.62)*0.06);
        const [ax,ay]=R(-len*0.5,-wid,cr,sr);
        const [bx,by]=R( len*0.5,-wid*(0.3+rnd(s+0.63)*0.5),cr,sr);
        const [ccx,ccy]=R( len*0.5, wid*(0.3+rnd(s+0.64)*0.5),cr,sr);
        const [dx,dy]=R(-len*0.5, wid,cr,sr);
        subdivQuad(ax,ay,bx,by,ccx,ccy,dx,dy,fid,p,SUBDIV);
      } else if(shapeType===3){
        const w=baseSize*(0.3+rnd(s+0.61)*0.7);
        const h=baseSize*(0.5+rnd(s+0.62)*1.0);
        const [ax,ay]=R(0,-h,cr,sr);
        const [bx,by]=R(w, 0,cr,sr);
        const [ccx,ccy]=R(0, h,cr,sr);
        const [dx,dy]=R(-w,0,cr,sr);
        subdivQuad(ax,ay,bx,by,ccx,ccy,dx,dy,fid,p,SUBDIV);
      } else if(shapeType===4){
        p.bendAmt = (rnd(s+0.67)*0.5+0.8) * BEND * (rnd(s+0.68)>0.5?1:-1);
        p.bendAxis = rot;
        const len=baseSize*(1.5+rnd(s+0.61)*3.0);
        const wid=baseSize*(0.08+rnd(s+0.62)*0.18);
        const [ax,ay]=R(-len*0.5,-wid,cr,sr);
        const [bx,by]=R( len*0.5,-wid,cr,sr);
        const [ccx,ccy]=R( len*0.5, wid,cr,sr);
        const [dx,dy]=R(-len*0.5, wid,cr,sr);
        subdivQuad(ax,ay,bx,by,ccx,ccy,dx,dy,fid,p,SUBDIV);
      } else if(shapeType===5){
        const rx=baseSize*(0.3+rnd(s+0.61)*0.7);
        const ry=baseSize*(0.3+rnd(s+0.62)*0.7);
        const [ax,ay]=R(0,  -ry, cr,sr);
        const [bx,by]=R(rx,   0, cr,sr);
        const [ccx,ccy]=R(0,  ry, cr,sr);
        const [dx,dy]=R(-rx,  0, cr,sr);
        subdivQuad(ax,ay,bx,by,ccx,ccy,dx,dy,fid,p,SUBDIV);
      } else {
        const len=baseSize*(3.0+rnd(s+0.61)*6.0);
        const wid=baseSize*0.008;
        const [ax,ay]=R(-len*0.5,-wid,cr,sr);
        const [bx,by]=R( len*0.5,-wid,cr,sr);
        const [ccx,ccy]=R( len*0.5, wid,cr,sr);
        const [dx,dy]=R(-len*0.5, wid,cr,sr);
        subdivQuad(ax,ay,bx,by,ccx,ccy,dx,dy,fid,p,SUBDIV);
      }
    }

    const gl = this.gl;
    if(this.posBuf) gl.deleteBuffer(this.posBuf);
    if(this.uvBuf)  gl.deleteBuffer(this.uvBuf);
    if(this.seedBuf)gl.deleteBuffer(this.seedBuf);
    if(this.idxBuf) gl.deleteBuffer(this.idxBuf);
    this.posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(posArr), gl.STATIC_DRAW);
    this.uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvArr), gl.STATIC_DRAW);
    this.seedBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.seedBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(seedArr), gl.STATIC_DRAW);
    this.idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    // 頂点数が多いので UNSIGNED_INT 推奨 (WebGL2 ネイティブ対応)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idxArr), gl.STATIC_DRAW);
    this.numIdx = idxArr.length;
    this._needsRebuild = false;
  },

  markDirty(){ this._needsRebuild = true; },

  // 画像ロード
  async loadFromUrl(url){
    if(!url) return false;
    const safe = /^(blob:|data:|https?:|file:)/i.test(url) ? url : url.split('/').map(encodeURIComponent).join('/');
    return new Promise((res)=>{
      const img = new Image();
      if(/^https?:/i.test(safe)){ try{ img.crossOrigin = 'anonymous'; }catch(e){} }
      img.onload = ()=>{
        try{
          const gl = this.gl;
          this.imgW = img.width; this.imgH = img.height;
          this.imgAsp = this.imgW / this.imgH;
          if(this.imgTex) gl.deleteTexture(this.imgTex);
          this.imgTex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          // 平均色を計算 → 補色 (色相180°回転) + 彩度/明度を持ち上げて「原色寄り」へ
          try{
            const cv = document.createElement('canvas');
            const S = 32;
            cv.width = S; cv.height = S;
            const ctx = cv.getContext('2d');
            ctx.drawImage(img, 0, 0, S, S);
            const d = ctx.getImageData(0,0,S,S).data;
            let r=0,g=0,b=0;
            for(let i=0;i<d.length;i+=4){ r+=d[i]; g+=d[i+1]; b+=d[i+2]; }
            const n = (d.length/4);
            const ar = r/n/255, ag = g/n/255, ab = b/n/255;
            // RGB → HSV
            const max = Math.max(ar, ag, ab), min = Math.min(ar, ag, ab);
            const v = max;
            const s = max === 0 ? 0 : (max - min) / max;
            let h = 0;
            if(max !== min){
              if(max === ar) h = ((ag - ab) / (max - min)) % 6;
              else if(max === ag) h = (ab - ar) / (max - min) + 2;
              else h = (ar - ag) / (max - min) + 4;
              h = (h * 60 + 360) % 360;
            }
            // グレースケール (= 彩度が低い) の場合は色付けせず、輝度の反転だけを bg にする
            if(s < 0.08){
              // 平均輝度の補色 (明暗反転)。あまり真っ黒/真っ白にならないよう中央寄せ
              const L = 0.299*ar + 0.587*ag + 0.114*ab;
              const inv = Math.max(0.1, Math.min(0.9, 1.0 - L));
              this.bgFromImage = [inv, inv, inv];
            } else {
              // 彩度ありの画像 → 補色 + 原色寄り (彩度/明度引き上げ)
              const h2 = (h + 180) % 360;
              const s2 = 0.95;
              const v2 = 0.85;
              const c = v2 * s2;
              const x = c * (1 - Math.abs(((h2 / 60) % 2) - 1));
              const m = v2 - c;
              let rr=0, gg=0, bb=0;
              if(h2 <  60){ rr=c; gg=x; bb=0; }
              else if(h2 < 120){ rr=x; gg=c; bb=0; }
              else if(h2 < 180){ rr=0; gg=c; bb=x; }
              else if(h2 < 240){ rr=0; gg=x; bb=c; }
              else if(h2 < 300){ rr=x; gg=0; bb=c; }
              else              { rr=c; gg=0; bb=x; }
              this.bgFromImage = [rr+m, gg+m, bb+m];
            }
          }catch(e){ this.bgFromImage = [0.5,0.5,0.5]; }
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
          this.imageReady = true;
          // 画像名を記録し、その画像に保存済みのパラメータがあれば適用してから構築する
          this.curName = /^(blob:|data:)/i.test(url) ? null
            : decodeURIComponent(url.split('?')[0].split('#')[0].split('/').pop() || '') || null;
          if(this._skipImgParams || !this.curName || !this._applyImgParams(this.curName)) this.noteAutoBase();
          this.buildScene();
        }catch(e){ console.warn('Slicer texture:', e); }
        res(true);
      };
      img.onerror = ()=> res(false);
      img.src = safe;
    });
  },

  // ================= 画像ごとのパラメータ保存 =================
  _imgParamStoreKey: 'vj.slicer.imgParams',
  curName: null,
  _storedImgParams(){
    try{ return JSON.parse(localStorage.getItem(this._imgParamStoreKey) || '{}'); }
    catch(e){ return {}; }
  },
  saveImgParams(){
    if(!this.curName) return false;
    const all = this._storedImgParams();
    // 初期値と同じ値も含めて全キーを保存する (差分保存にしない。md 保存と同じ方針)
    const out = {};
    for(const k of SL_IMG_KEYS) out[k] = this.P[k];
    all[this.curName] = out;
    try{ localStorage.setItem(this._imgParamStoreKey, JSON.stringify(all)); }catch(e){ return false; }
    return true;
  },
  clearImgParams(){
    if(!this.curName) return;
    const all = this._storedImgParams();
    delete all[this.curName];
    try{ localStorage.setItem(this._imgParamStoreKey, JSON.stringify(all)); }catch(e){}
  },
  hasImgParams(name){
    return !!this._storedImgParams()[name || this.curName];
  },
  _applyImgParams(name){
    const saved = this._storedImgParams()[name];
    if(!saved) return false;
    const base = this.PDefaults || this.P;
    for(const k of SL_IMG_KEYS) this.P[k] = (saved[k] !== undefined) ? saved[k] : base[k];
    this.noteAutoBase();
    this._needsRebuild = true;
    return true;
  },
  // ライブラリからランダムに1枚選んで読み込む (画像ごとの保存パラメータもそのまま適用される)
  loadRandomImage(){
    const lib = this.library || [];
    if(!lib.length || this._imgLoading) return false;
    let pick = lib[Math.floor(Math.random()*lib.length)];
    if(lib.length > 1){                                   // 同じ絵の連続を避ける
      let guard = 0;
      while(pick && this.curName && pick.name === this.curName && guard++ < 8) pick = lib[Math.floor(Math.random()*lib.length)];
    }
    if(!pick) return false;
    this._imgLoading = true;
    this.loadFromUrl(pick.url).then(()=>{
      this._imgLoading = false;
      if(typeof UI !== 'undefined' && UI.refreshSlicer) UI.refreshSlicer();
    });
    return true;
  },
  // プリセット/状態復元: 画像を読み直してから、プリセットのパラメータを上書きで再適用する。
  //   画像ごとの保存 (_applyImgParams) はここでは効かせない (プリセットの値が勝つ)。
  restoreImage(name, params){
    if(!name) return;
    const applyParams = ()=>{
      if(params && typeof params === 'object') Object.assign(this.P, params);
      this.noteAutoBase();
      this.markDirty();
      if(typeof UI !== 'undefined' && UI.refreshSlicer) UI.refreshSlicer();
    };
    if(this.curName === name){ applyParams(); return; }
    const pick = ()=>{
      const it = (this.library || []).find(x => x.name === name);
      if(!it){ applyParams(); return; }
      this._skipImgParams = true;
      this.loadFromUrl(it.url).then(()=>{ this._skipImgParams = false; applyParams(); });
    };
    if(this.library && this.library.length) pick();
    else this.scanFolder('images/slicer').then(list=>{ this.library = list; pick(); });
  },
  // Auto モードのドリフト中心を現在値で更新 (画像ロード・スライダー操作・保存時に呼ぶ)
  noteAutoBase(){
    const P = this.P;
    this._autoBase = { explode: P.explode, bend: P.bend, curl: P.curl };
    this._autoEpoch = -1;   // 次フレームで中心を反映して組み直す
  },

  loadFile(file){
    if(!file) return;
    const url = URL.createObjectURL(file);
    this.loadFromUrl(url);
  },

  async scanFolder(dir='images/slicer'){
    const exts = '(?:png|jpe?g|webp|gif|bmp)';
    const list = [];
    try{
      const r = await fetch(dir+'/', {cache:'no-cache'});
      if(r.ok){
        const text = await r.text();
        const ct = r.headers.get('Content-Type') || '';
        if(ct.includes('json') || text.trim().startsWith('[') || text.trim().startsWith('{')){
          try{
            const data = JSON.parse(text);
            const files = Array.isArray(data) ? data : (data.files || []);
            for(const f of files) list.push({url: dir+'/'+f, name: f});
          }catch(e){}
        } else {
          const re = new RegExp('href="([^"]+\\.'+exts+')"', 'gi');
          const set = new Set();
          let m;
          while((m = re.exec(text))){
            let h = m[1];
            if(h === '../' || h.startsWith('?') || h.startsWith('#')) continue;
            const fn = h.split('?')[0].split('#')[0].split('/').pop();
            if(fn) set.add(fn);
          }
          for(const fn of [...set].sort()) list.push({url: dir+'/'+fn, name: fn});
        }
      }
    }catch(e){}
    if(list.length === 0){
      try{
        const r = await fetch(dir+'/manifest.json', {cache:'no-cache'});
        if(r.ok){
          const data = await r.json();
          const files = Array.isArray(data) ? data : (data.files || []);
          for(const f of files) list.push({url: dir+'/'+f, name: f});
        }
      }catch(e){}
    }
    this.library = list;
    return list;
  },

  // 毎フレーム呼ぶ
  update(beatCount, dt){
    if(!this.initialized) return;
    // 全体 speed 反映済みクロック (GL.clock) を使用。利用不可なら従来の実時刻。
    this._t = (typeof GL !== 'undefined' && typeof GL.clock === 'number') ? GL.clock : (performance.now() - this.startTime) / 1000;
    // ズームアウト(<1)はカメラに適用せず base 描画 → 合成段で画面全体をミラータイル化する
    const _uz = (typeof App !== 'undefined' && App.userZoom != null) ? App.userZoom : 1;
    const _zoomedOut = _uz < 1.0;
    const userPanX  = (typeof App !== 'undefined' && !_zoomedOut) ? App.userPan.x : 0;
    const userPanY  = (typeof App !== 'undefined' && !_zoomedOut) ? App.userPan.y : 0;
    const userZoom  = Math.max(1.0, _uz);
    const beatMode  = (typeof App !== 'undefined' ? App.beatMode : 'drone');

    // ── 画像 Random: imgBeats 拍ごとに次の画像へ ──
    if(this.P.imgMode === 'random' && this.P.imgBeats > 0){
      const bAll = (typeof beatCount === 'number') ? beatCount : (typeof BPM !== 'undefined' ? BPM.beatCount() : 0);
      const iEpoch = Math.floor(bAll / this.P.imgBeats);
      if(this._imgEpoch == null) this._imgEpoch = iEpoch;
      else if(this._imgEpoch !== iEpoch){ this._imgEpoch = iEpoch; this.loadRandomImage(); }
    }

    // ── Auto モード: パラメータ & カメラを連続変調 ──
    if(this.P.autoMode){
      const t = this._t;
      // 拍周期 (autoRebuildBeats 拍) ごとにパラメータをドリフト + 再構築
      const bAcc = (typeof beatCount === 'number') ? beatCount : (typeof BPM !== 'undefined' ? BPM.beatCount() : 0);
      const epoch = Math.floor(bAcc / Math.max(0.0625, this.P.autoRebuildBeats));
      if(this._autoEpoch !== epoch){
        this._autoEpoch = epoch;
        // 各パラメータを sin で位相違いにドリフト。
        // 中心は「画像ごとの保存値 / ユーザ設定値」(_autoBase)。無ければ初期値。
        // PDefaults 固定だと画像に保存した explode/bend/curl が Auto に即上書きされてしまう。
        // Pieces はユーザ設定値を保持 (rebuild 時にも変えない)。
        const D = this._autoBase || this.PDefaults;
        const seedT = epoch * 1.0;
        this.P.explode = D.explode * (0.6 + 0.4 * Math.sin(seedT * 0.71));
        this.P.bend    = D.bend    * (0.5 + 0.5 * Math.sin(seedT * 0.83 + 1.7));
        this.P.curl    = D.curl    * (0.5 + 0.5 * Math.sin(seedT * 0.97 + 3.1));
        // シードもエポックごとに更新 → 断片配置を変える
        this.P.seed    = Math.floor(Math.abs(Math.sin(seedT * 1.31 + 4.7)) * 9999);
        this._needsRebuild = true;
      }
      // カメラ自動: ダイナミック回転 + 仰角ドリフト + ズーム呼吸 (複合周期)
      const rotT = (beatMode === 'beat') ? bAcc * 0.35 : t * 0.40;
      this.cam.az = userPanX * Math.PI + rotT * (this.P.autorot > 0.01 ? this.P.autorot : 1.0);
      // 仰角は 2 周期合成 (大きな揺らぎ + 速い揺らぎ)
      const elDrift = (Math.sin(t * 0.17) * 0.7 + Math.sin(t * 0.41 + 1.3) * 0.3) * this.P.autoElAmp;
      this.cam.el = this.P.camEl - userPanY * 0.5 + elDrift;
      // ズーム呼吸も複合周期 (大きく+速く)
      const zoomBreathe = 1.0 + this.P.autoZoomAmp * (Math.sin(t * 0.13) * 0.7 + Math.sin(t * 0.29 + 2.1) * 0.3);
      this.cam.dist = this.P.dist / Math.max(0.1, userZoom) * Math.max(0.15, zoomBreathe);
    } else {
      // 手動モード
      this.cam.az  = userPanX * Math.PI;
      this.cam.el  = this.P.camEl - userPanY * 0.5;
      this.cam.dist = this.P.dist / Math.max(0.1, userZoom);
      if(this.P.autorot > 0.001){
        const rotT = (beatMode === 'beat') ? beatCount * 0.25 : this._t * 0.15;
        this.cam.az += rotT * this.P.autorot;
      }
    }

    if(this._needsRebuild && this.imageReady) this.buildScene();
  },

  render({fbo, w, h, slot}){
    if(!this.initialized) return;
    const gl = this.gl;
    const transparentBg = (slot === 'B');   // Slot B は背景色を塗らず最初から透過で描画
    // postScale 適用: シーン/ポストは低解像度で計算 → blit で目的 FBO へアップスケール
    const ps = Math.max(0.25, Math.min(1.0, this.P.postScale || 1.0));
    const sw = Math.max(2, Math.round(w * ps));
    const sh = Math.max(2, Math.round(h * ps));
    this._ensureSceneTargets(sw, sh);

    // ── pass1: シーンを sceneFbo に描画 (color + depth) ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, sw, sh);
    let bg;
    if(this.P.bgMode === 'white') bg = [1,1,1];
    else if(this.P.bgMode === 'image') bg = this.bgFromImage || [0.5,0.5,0.5];
    else bg = [0,0,0];
    // Slot B: 背景色を塗らず透明(0,0,0,0)でクリア → 断片の縁に背景色が滲まず真に透過。
    if(transparentBg) gl.clearColor(0, 0, 0, 0);
    else gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    if(this.imageReady && this.numIdx > 0){
      gl.useProgram(this.prog);
      const asp = sw / Math.max(1, sh);
      const fovRad = (this.P.fov * Math.PI / 180);
      const proj = this.m4.perspective(fovRad, asp, 0.01, 100);
      const az = this.cam.az, el = this.cam.el, d = this.cam.dist;
      const ex = Math.cos(el) * Math.sin(az) * d;
      const ey = Math.sin(el) * d;
      const ez = Math.cos(el) * Math.cos(az) * d;
      const view = this.m4.lookAt([ex, ey, ez], [0,0,0], [0,1,0]);
      gl.uniformMatrix4fv(this.locs.u_proj, false, proj);
      gl.uniformMatrix4fv(this.locs.u_view, false, view);
      gl.uniform1f(this.locs.u_time, this._t);
      gl.uniform1f(this.locs.u_warpAmp,  this.P.warpAmp || 0);
      gl.uniform1f(this.locs.u_warpFreq, this.P.warpFreq || 2.0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
      gl.uniform1i(this.locs.u_map, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      gl.enableVertexAttribArray(this.locs.a_pos);
      gl.vertexAttribPointer(this.locs.a_pos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
      gl.enableVertexAttribArray(this.locs.a_uv);
      gl.vertexAttribPointer(this.locs.a_uv, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.seedBuf);
      gl.enableVertexAttribArray(this.locs.a_seed);
      gl.vertexAttribPointer(this.locs.a_seed, 1, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
      gl.drawElements(gl.TRIANGLES, this.numIdx, gl.UNSIGNED_INT, 0);
    }

    // ── pass2: ポストエフェクト (低解像度 postFbo へ書き込み) ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.postFbo);
    gl.viewport(0, 0, sw, sh);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.postProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneColorTex);
    gl.uniform1i(this.pLocs.u_color, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneDepthTex);
    gl.uniform1i(this.pLocs.u_depth, 1);
    gl.uniform2f(this.pLocs.u_invRes, 1/sw, 1/sh);
    gl.uniform1f(this.pLocs.u_strength, this.P.shadowStr);
    gl.uniform1f(this.pLocs.u_radius,   this.P.shadowRadius);
    gl.uniform1f(this.pLocs.u_bias,     this.P.shadowBias);
    gl.uniform1f(this.pLocs.u_enabled,  this.P.overlapShadow ? 1 : 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(this.pLocs.a_xy);
    gl.vertexAttribPointer(this.pLocs.a_xy, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // ── pass3: postFbo を blit で目的 FBO へアップスケール (バイリニア) ──
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.postFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
    gl.blitFramebuffer(0, 0, sw, sh, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
  },
};
