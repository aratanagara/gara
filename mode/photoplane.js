'use strict';
/* PhotoPlane engine — vj/ の追加レンダリングモード (kind:'photoplane')。
   images/photo/ の写真をランダムな長方形にトリミングして 3D 空間のプレーンにし、
   回転 / 曲げ(bend) / ワープ(warp) で動かす。layer.js を下敷きにした叩き台。
   - 既存の vj WebGL2 コンテキストを共有 / 指定 FBO に描画 → 通常の合成・Post FX に合流
   - Drone/Beat モード対応 (拍で回転・ワープをパルス)
   IF: init(gl) / update() / render({fbo,w,h,slot,beat,clock}) / P(params)
*/

const PhotoPlane = {
  gl:null, initialized:false,
  prog:null, vao:null, vbo:null, ibo:null, idxCount:0,
  depthRBO:null, depthW:0, depthH:0,
  defaultTex:null,
  textures:[], texAspects:[],
  planes:[],
  startTime:0,
  cam:{az:0, el:0.28, dist:14},

  // ── パラメータ (UI から操作) ──
  P:{
    count:24,          // プレーン枚数
    size:1.3, sizeVar:0.7,   // 大きさ / ばらつき
    spread:9.0,        // 空間の広がり
    cropMin:0.25, cropMax:0.7,  // トリミング矩形の長辺の最小/最大 (元画像比)
    stretch:0.4,       // 長細さ (0=正方形寄り / 1=極端に長細い矩形が増える)
    spin:0.25,         // 各プレーンの自転速度
    autorot:0.35,      // カメラ自動公転
    bend:0.6,          // 曲げ強度
    warpAmp:0.18, warpFreq:6.0,  // ワープ 振幅 / 周波数
    fov:70, dist:14.0, camEl:0.28,
    ambient:0.82,      // 環境光 (0=陰影強 / 1=写真そのまま・フラット)
    beatPulse:0.35,    // 拍での回転/ワープの弱いキック
    seed:7,
    bg:[0.05,0.05,0.06],
  },

  // ===== math =====
  m4:{
    id(){ return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); },
    mul(a,b){ const o=new Float32Array(16); for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;} return o; },
    persp(fov,asp,n,f){ const t=1/Math.tan(fov*0.5), nf=1/(n-f); return new Float32Array([t/asp,0,0,0, 0,t,0,0, 0,0,(f+n)*nf,-1, 0,0,2*f*n*nf,0]); },
    lookAt(e,c,u){ const z=PhotoPlane._norm([e[0]-c[0],e[1]-c[1],e[2]-c[2]]); const x=PhotoPlane._norm(PhotoPlane._cross(u,z)); const y=PhotoPlane._cross(z,x);
      return new Float32Array([x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0, -PhotoPlane._dot(x,e),-PhotoPlane._dot(y,e),-PhotoPlane._dot(z,e),1]); },
    trans(x,y,z){ const m=PhotoPlane.m4.id(); m[12]=x;m[13]=y;m[14]=z; return m; },
    // 任意軸回転
    rotAxis(ax,ang){ const [x,y,z]=PhotoPlane._norm(ax); const c=Math.cos(ang),s=Math.sin(ang),t=1-c;
      return new Float32Array([ t*x*x+c, t*x*y+s*z, t*x*z-s*y, 0,  t*x*y-s*z, t*y*y+c, t*y*z+s*x, 0,  t*x*z+s*y, t*y*z-s*x, t*z*z+c, 0,  0,0,0,1 ]); },
  },
  _cross(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; },
  _dot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; },
  _norm(a){ const l=Math.hypot(a[0],a[1],a[2])||1; return [a[0]/l,a[1]/l,a[2]/l]; },
  _rng(seed){ let s=seed>>>0||1; return ()=>{ s^=s<<13; s^=s>>>17; s^=s<<5; s>>>=0; return s/4294967296; }; },
  // カメラ: ランダムな新ターゲット位置を選ぶ (snap=即移動)
  _newCamTarget(snap){
    const el0 = (this.P.camEl==null?0.28:this.P.camEl);
    this.cam.tAz = Math.random()*Math.PI*2;
    this.cam.tEl = Math.max(-1.2, Math.min(1.3, el0 + (Math.random()-0.5)*1.5));
    this.cam.tDist = this.P.dist * (0.72 + Math.random()*0.55);
    if(snap){ this.cam.az=this.cam.tAz; this.cam.el=this.cam.tEl; this.cam.dist=this.cam.tDist; }
  },
  _angLerp(a,b,k){ let d=b-a; while(d>Math.PI)d-=Math.PI*2; while(d<-Math.PI)d+=Math.PI*2; return a+d*k; },

  // ===== init =====
  init(gl){
    if(this.initialized) return;
    this.gl = gl;
    const vs = `#version 300 es
precision highp float;
in vec2 aPos;   // -0.5..0.5
in vec2 aUV;    // 0..1
uniform mat4 uMVP, uModel;
uniform float uTime, uAspect, uScale, uSeed, uBendMul, uWarpAmp, uWarpFreq;
uniform vec2 uBend;      // 端の反り x,y
uniform vec4 uCrop;      // u0,v0,u1,v1
out vec2 vUv; out vec3 vN; out vec3 vWorld;
vec3 displace(vec2 q){
  vec2 p = q; p.x *= uAspect;
  float z = 0.0;
  z += uBend.x*uBendMul * (p.x*p.x - 0.0833);
  z += uBend.y*uBendMul * (p.y*p.y - 0.0833);
  float f = uWarpFreq;
  z += uWarpAmp * sin(p.x*f + uTime*1.3 + uSeed) * cos(p.y*f*0.8 - uTime*0.9 + uSeed*1.7);
  return vec3(p, z);
}
void main(){
  vec3 pc = displace(aPos);
  float e = 0.02;
  vec3 n = normalize(cross(displace(aPos+vec2(e,0.0))-pc, displace(aPos+vec2(0.0,e))-pc));
  vec4 wp = uModel * vec4(pc*uScale, 1.0);
  vWorld = wp.xyz;
  vN = mat3(uModel) * n;
  vUv = mix(uCrop.xy, uCrop.zw, aUV);
  gl_Position = uMVP * wp;
}`;
    const fs = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vN; in vec3 vWorld;
uniform sampler2D uTex;
uniform vec3 uCam;
uniform float uAmbient;
out vec4 frag;
void main(){
  vec3 tex = texture(uTex, vUv).rgb;
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vWorld);
  if(dot(N,V) < 0.0) N = -N;                 // 両面
  vec3 L = normalize(vec3(0.35, 0.85, 0.55));
  float diff = max(dot(N,L), 0.0);
  vec3 col = tex * (uAmbient + (1.0-uAmbient)*diff);
  frag = vec4(col, 1.0);
}`;
    this.prog = this._link(vs, fs);
    if(!this.prog){ this.initialized=true; this.ok=false; return; }
    this._buildGeo(28);
    // デフォルトのプレースホルダ (画像未ロード時): グレー市松
    this.defaultTex = this._checkerTex();
    this.startTime = performance.now()/1000;
    this.generateLayout();
    this.initialized = true; this.ok = true;
    // 画像を非同期ロード (images/photo/)
    this.autoLoadFromFolder('images/photo');
  },

  _compile(type, src){ const gl=this.gl, sh=gl.createShader(type); gl.shaderSource(sh,src); gl.compileShader(sh);
    if(!__glReady(gl, sh, false)){ console.error('[PhotoPlane]', gl.getShaderInfoLog(sh)); return null; } return sh; },
  _link(vs,fs){ const gl=this.gl; const v=this._compile(gl.VERTEX_SHADER,vs), f=this._compile(gl.FRAGMENT_SHADER,fs); if(!v||!f) return null;
    const p=gl.createProgram(); gl.attachShader(p,v); gl.attachShader(p,f); gl.bindAttribLocation(p,0,'aPos'); gl.bindAttribLocation(p,1,'aUV'); gl.linkProgram(p);
    if(!__glReady(gl, p, true)){ console.error('[PhotoPlane link]', gl.getProgramInfoLog(p)); return null; }
    this.loc={}; ['uMVP','uModel','uTime','uAspect','uScale','uSeed','uBend','uBendMul','uWarpAmp','uWarpFreq','uCrop','uTex','uCam','uAmbient'].forEach(n=>this.loc[n]=gl.getUniformLocation(p,n)); return p; },

  // 細分プレーン (N×N グリッド) — bend/warp をなめらかに
  _buildGeo(N){
    const gl=this.gl; const pos=[], uv=[], idx=[];
    for(let j=0;j<=N;j++) for(let i=0;i<=N;i++){ const u=i/N, v=j/N; pos.push(u-0.5, v-0.5); uv.push(u, 1.0-v); }
    const w=N+1;
    for(let j=0;j<N;j++) for(let i=0;i<N;i++){ const a=j*w+i,b=a+1,c=a+w,d=c+1; idx.push(a,b,c, b,d,c); }
    this.idxCount=idx.length;
    const inter=[]; for(let k=0;k<pos.length/2;k++){ inter.push(pos[k*2],pos[k*2+1], uv[k*2],uv[k*2+1]); }
    this.vao=gl.createVertexArray(); gl.bindVertexArray(this.vao);
    this.vbo=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(inter),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,16,0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,2,gl.FLOAT,false,16,8);
    this.ibo=gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(idx),gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  },

  _checkerTex(){ const gl=this.gl; const s=8, d=new Uint8Array(s*s*4); for(let y=0;y<s;y++)for(let x=0;x<s;x++){ const c=((x^y)&1)?150:90; const o=(y*s+x)*4; d[o]=c;d[o+1]=c;d[o+2]=c;d[o+3]=255; }
    const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,s,s,0,gl.RGBA,gl.UNSIGNED_BYTE,d);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE); return t; },

  // ===== 画像ロード =====
  async autoLoadFromFolder(dir='images/photo'){
    let files=[];
    try{ const r=await fetch(dir+'/manifest.json',{cache:'no-cache'}); if(r.ok){ const d=await r.json(); files=Array.isArray(d)?d:(d.files||[]); } }catch(e){}
    if(!files.length){
      try{ const r=await fetch(dir+'/',{cache:'no-cache'}); if(r.ok){ const t=await r.text();
        const re=/href="([^"]+\.(?:png|jpe?g|webp|gif|bmp))"/gi; const set=new Set(); let m;
        while((m=re.exec(t))){ const fn=m[1].split('?')[0].split('#')[0].split('/').pop(); if(fn) set.add(fn); }
        files=[...set].sort(); } }catch(e){}
    }
    if(!files.length) return 0;
    return this.loadFromUrls(files.map(f=>dir+'/'+f));
  },
  async loadFromUrls(urls){
    const gl=this.gl;
    this.textures.forEach(t=>{ if(t!==this.defaultTex) gl.deleteTexture(t); });
    this.textures=[]; this.texAspects=[];
    const jobs=urls.map(url=>new Promise(res=>{ const img=new Image(); img.crossOrigin='anonymous';
      img.onload=()=>{ const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        res({t, a:img.naturalWidth/Math.max(1,img.naturalHeight)}); };
      img.onerror=()=>res(null); img.src=url; }));
    const results=(await Promise.all(jobs)).filter(Boolean);
    this.textures=results.map(r=>r.t); this.texAspects=results.map(r=>r.a);
    this.generateLayout();
    return this.textures.length;
  },
  rescan(){ return this.autoLoadFromFolder('images/photo'); },

  // ===== レイアウト生成 (枚数 / crop / 配置) =====
  generateLayout(){
    const P=this.P; const n=Math.max(1, Math.min(400, P.count|0));
    const rng=this._rng((P.seed|0) + (this._layoutSalt|0)*7919);   // beat rescan は salt で配置を引き直す
    const nTex=this.textures.length;
    this.planes=Array.from({length:n},(_,i)=>{
      const theta=rng()*2*Math.PI, phi=Math.acos(2*rng()-1), r=Math.cbrt(rng())*P.spread;
      // ランダム長方形トリミング (u0,v0,u1,v1)。長辺 long / 短辺 short を stretch で長細く。
      const long = P.cropMin + (P.cropMax-P.cropMin)*rng();          // 長辺(元画像比)
      const s = Math.max(0, Math.min(1, P.stretch==null?0.4:P.stretch));
      const thinMin = 1.0 - s;                                       // s 大 → 短辺が細くなりうる
      const thin = Math.max(0.04, thinMin + (1.0-thinMin)*(rng()*rng()));  // 細い側へ偏らせる
      const shortS = Math.max(0.02, long*thin);
      let cw, ch;
      if(rng() < 0.5){ cw=Math.min(1,long);   ch=Math.min(1,shortS); }  // 横長
      else           { cw=Math.min(1,shortS); ch=Math.min(1,long);   }  // 縦長
      const u0=rng()*(1-cw), v0=rng()*(1-ch);
      const tIdx = nTex>0 ? (i%nTex) : -1;
      const imgAsp = tIdx>=0 ? (this.texAspects[tIdx]||1) : 1;
      // プレーンのアスペクト = crop の実寸比 (画像アスペクト × crop幅/高さ比)
      const aspect = imgAsp * (cw/ch);
      return {
        pos:[r*Math.sin(phi)*Math.cos(theta), r*Math.sin(phi)*Math.sin(theta), r*Math.cos(phi)],
        axis:this._norm([rng()-.5, rng()-.5, rng()-.5]),
        phase:rng()*Math.PI*2, spinSign:rng()>.5?1:-1,
        scale: P.size*Math.pow(2.4,(rng()-.5)*2*P.sizeVar),
        aspect,
        bend:[(rng()-.5)*2, (rng()-.5)*2],
        seed:rng()*10,
        crop:[u0, v0, u0+cw, v0+ch],
        texIdx:tIdx,
      };
    });
  },

  update(){ /* 時刻は render 内で参照 */ },

  _ensureDepth(w,h){ const gl=this.gl; if(this.depthRBO && this.depthW===w && this.depthH===h) return;
    if(this.depthRBO) gl.deleteRenderbuffer(this.depthRBO);
    this.depthRBO=gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER,this.depthRBO);
    gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,w,h); this.depthW=w; this.depthH=h; },

  render(opts){
    if(!this.ok) return;
    const gl=this.gl, { fbo, w, h } = opts;
    const P=this.P;
    const t = (typeof opts.clock==='number') ? opts.clock : (performance.now()/1000 - this.startTime);

    // 拍パルス (beat モード時のみ)
    let pulse=0;
    if(typeof App!=='undefined' && App.beatMode==='beat' && typeof BPM!=='undefined'){
      const bc=(typeof opts.beat==='number')?opts.beat:BPM.beatCount();
      pulse=Math.pow(1-(bc-Math.floor(bc)),2.0)*P.beatPulse;
    }

    // ── カメラ: ランダムな位置へ roaming。drone=なめらかに巡回 / beat=拍ごとに新位置へスナップ(リセット) ──
    let dt = (this._lastT!=null) ? (t - this._lastT) : 0;
    if(dt < 0 || dt > 1.0) dt = 0;                 // 時刻巻き戻し(リセット)・長ギャップは 0
    this._lastT = t;
    const beatMode = (typeof App!=='undefined' && App.beatMode==='beat');
    const beatC = (typeof opts.beat==='number') ? opts.beat : (typeof BPM!=='undefined' ? BPM.beatCount() : 0);
    const speed = Math.max(0.05, P.autorot);
    if(this.cam.tAz==null) this._newCamTarget(true);
    // リセット検出: C(clock→0) / R(beat 巻き戻し) で新位置へスナップ
    if((t < 0.05 && (this._lastCamT||0) > 0.5) || (this._lastBeatC!=null && beatC < this._lastBeatC - 0.4)){
      this._newCamTarget(true);
    }
    this._lastCamT = t; this._lastBeatC = beatC;
    if(beatMode){
      const bi = Math.floor(beatC);
      if(this._lastBeatInt==null) this._lastBeatInt = bi;
      if(bi !== this._lastBeatInt){ this._lastBeatInt = bi; this._newCamTarget(true); this._layoutSalt=(this._layoutSalt||0)+1; this.generateLayout(); }   // 拍ごとにカメラスナップ + 配置を Rescan(引き直し)
    } else {
      this._retargetT = (this._retargetT!=null ? this._retargetT : 0) - dt*speed;
      if(this._retargetT <= 0){ this._newCamTarget(false); this._retargetT = 1.6 + Math.random()*2.4; }
      const kk = Math.min(1, dt*(0.4 + speed*0.8));
      this.cam.az = this._angLerp(this.cam.az, this.cam.tAz, kk);
      this.cam.el += (this.cam.tEl - this.cam.el)*kk;
      this.cam.dist += (this.cam.tDist - this.cam.dist)*kk;
    }
    const az=this.cam.az, el=this.cam.el, dist=this.cam.dist;
    const eye=[dist*Math.cos(el)*Math.sin(az), dist*Math.sin(el), dist*Math.cos(el)*Math.cos(az)];
    const proj=this.m4.persp(P.fov*Math.PI/180, w/h, 0.05, 200.0);
    const view=this.m4.lookAt(eye,[0,0,0],[0,1,0]);
    const vp=this.m4.mul(proj,view);

    this._ensureDepth(w,h);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,this.depthRBO);
    gl.viewport(0,0,w,h);
    const isB = (opts.slot === 'B');
    gl.clearColor(P.bg[0],P.bg[1],P.bg[2], isB ? 0.0 : 1.0);   // Slot B は背景透過(下の Slot A が透ける)
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.loc.uMVP,false,vp);
    gl.uniform1f(this.loc.uTime,t);
    gl.uniform3f(this.loc.uCam,eye[0],eye[1],eye[2]);
    gl.uniform1f(this.loc.uAmbient,P.ambient);
    gl.uniform1f(this.loc.uWarpAmp,P.warpAmp*(1.0+pulse*0.5));
    gl.uniform1f(this.loc.uWarpFreq,P.warpFreq);
    gl.uniform1f(this.loc.uBendMul,P.bend);
    gl.uniform1i(this.loc.uTex,0);
    gl.activeTexture(gl.TEXTURE0);

    for(const pl of this.planes){
      const ang = pl.phase + t*P.spin*pl.spinSign + pulse*0.5*pl.spinSign;   // 拍で少し余分に回す(加算kick, ジャンプしない)
      const model = this.m4.mul(this.m4.trans(pl.pos[0],pl.pos[1],pl.pos[2]), this.m4.rotAxis(pl.axis,ang));
      gl.uniformMatrix4fv(this.loc.uModel,false,model);
      gl.uniform1f(this.loc.uScale,pl.scale);
      gl.uniform1f(this.loc.uAspect,pl.aspect);
      gl.uniform1f(this.loc.uSeed,pl.seed);
      gl.uniform2f(this.loc.uBend,pl.bend[0],pl.bend[1]);
      gl.uniform4f(this.loc.uCrop,pl.crop[0],pl.crop[1],pl.crop[2],pl.crop[3]);
      const tex=(pl.texIdx>=0 && this.textures[pl.texIdx])?this.textures[pl.texIdx]:this.defaultTex;
      gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.drawElements(gl.TRIANGLES,this.idxCount,gl.UNSIGNED_SHORT,0);
    }

    gl.bindVertexArray(null);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,null);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  },
};

if(typeof window!=='undefined') window.PhotoPlane = PhotoPlane;
