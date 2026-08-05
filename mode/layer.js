'use strict';
/* Layer engine — vj/ の追加レンダリングモード。
   shaders/layer/index.html (Image Spheres) の plane モードのみを移植。
   - 既存の vj WebGL2 コンテキストを共有
   - 指定 FBO に描画 → 通常のクロスフェード/Post FX パイプラインに合流
   - Drone/Beat モード切替対応 (BPM/iBeatPhase に同期)
*/

const Layer = {
  gl:null,
  initialized:false,
  programs:{},
  geo:{},
  shadowMap:null, shadowRBO:null, shadowFBO:null,
  defaultTex:null,
  SHADOW_SZ:1024,

  // ステート (デフォルト値は実機で確認した好みの値)
  P:{
    bgColor:[1,1,1],
    bg:1.0,            // 背景の明るさ (0=黒 … 1=白)。下げると Grad Map / 陰影が効きやすい
    count:0,           // プレーン枚数 (0=auto: 画像数と8の大きい方)
    size:0.50, sizeVar:1.50, spread:12.0, seed:42,
    spin:0.30, float:0.0, autorot:0.50,
    curvature:0.30,
    ambient:1.00, rim:0.00, fog:0.000, lightAz:0,
    fov:75, dist:15.0,
    shadowOn:false, shadowStr:0.00, shadowSoft:0.0,
    showGround:false, groundMult:-1.0, groundBrt:0.25,
    camEl:0.30, camAz:0,
    pngAlpha:false,
  },
  textures:[], texAspects:[], texKeyColors:[],
  planes:[], // 各 plane のスロット情報
  startTime:0,
  cam:{az:0, el:0.3, dist:15, target:[0,0,0]},

  // ===== math helpers =====
  v3:{
    sub(a,b){return [a[0]-b[0], a[1]-b[1], a[2]-b[2]];},
    scale(a,s){return [a[0]*s, a[1]*s, a[2]*s];},
    norm(a){const l=Math.hypot(a[0],a[1],a[2]); return l>1e-8?[a[0]/l,a[1]/l,a[2]/l]:[0,1,0];},
    cross(a,b){return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];},
    dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];},
  },
  m4:{
    id(){return new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);},
    mul(a,b){
      const o=new Float32Array(16);
      for(let c=0;c<4;c++) for(let r=0;r<4;r++){
        let s=0; for(let k=0;k<4;k++) s+=a[k*4+r]*b[c*4+k];
        o[c*4+r]=s;
      }
      return o;
    },
    perspective(fov,asp,n,f){
      const t=1/Math.tan(fov*.5), nf=1/(n-f);
      return new Float32Array([t/asp,0,0,0, 0,t,0,0, 0,0,(f+n)*nf,-1, 0,0,2*f*n*nf,0]);
    },
    ortho(l,r,b,t,n,f){
      return new Float32Array([
        2/(r-l),0,0,0, 0,2/(t-b),0,0, 0,0,-2/(f-n),0,
        -(r+l)/(r-l),-(t+b)/(t-b),-(f+n)/(f-n),1
      ]);
    },
    lookAt(eye,ctr,up){
      const z=Layer.v3.norm(Layer.v3.sub(eye,ctr));
      const x=Layer.v3.norm(Layer.v3.cross(up,z));
      const y=Layer.v3.cross(z,x);
      return new Float32Array([
        x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
        -Layer.v3.dot(x,eye), -Layer.v3.dot(y,eye), -Layer.v3.dot(z,eye), 1
      ]);
    },
    T(tx,ty,tz){return new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,tx,ty,tz,1]);},
    S(s){return new Float32Array([s,0,0,0,0,s,0,0,0,0,s,0,0,0,0,1]);},
    Sv(sx,sy,sz){return new Float32Array([sx,0,0,0,0,sy,0,0,0,0,sz,0,0,0,0,1]);},
    axisAngle(axis,angle){
      const [x,y,z]=Layer.v3.norm(axis), c=Math.cos(angle), s=Math.sin(angle), t=1-c;
      return new Float32Array([
        t*x*x+c, t*x*y+s*z, t*x*z-s*y, 0,
        t*x*y-s*z, t*y*y+c, t*y*z+s*x, 0,
        t*x*z+s*y, t*y*z-s*x, t*z*z+c, 0,
        0,0,0,1
      ]);
    }
  },

  _rng(seed){
    let s=seed|0;
    return ()=>{ s=Math.imul(s^(s>>>13), s^(s<<5))^(s>>>7); return (s>>>0)/0xffffffff; };
  },

  // ===== shader sources (GLSL ES 100 — WebGL2 でも互換) =====
  VS_SHD:`
attribute vec3 a_pos;
uniform mat4 u_lightMVP;
uniform vec3 u_planeBend;
vec3 deformPlanePos(vec3 p){
  float axis=u_planeBend.z;
  float coord=mix(p.x, p.y, axis);
  float disp=u_planeBend.x*sin(coord*1.5707963)+u_planeBend.y*sin(coord*3.1415926);
  vec3 lp=p; lp.z+=disp; return lp;
}
void main(){
  vec3 lp=a_pos;
  if(abs(u_planeBend.x)+abs(u_planeBend.y)>0.001) lp=deformPlanePos(lp);
  gl_Position=u_lightMVP*vec4(lp,1.);
}`,
  FS_SHD:`
precision highp float;
void main(){
  float d=gl_FragCoord.z;
  vec4 enc=fract(vec4(1., 255., 65025., 16581375.)*d);
  enc-=enc.yzww*vec4(1./255., 1./255., 1./255., 0.);
  gl_FragColor=enc;
}`,

  VS_GND:`
attribute vec3 a_pos;
uniform mat4 u_mvp; uniform mat4 u_model;
varying vec3 v_wpos;
void main(){
  vec4 wp=u_model*vec4(a_pos,1.); v_wpos=wp.xyz;
  gl_Position=u_mvp*vec4(a_pos,1.);
}`,
  FS_GND:`
precision mediump float;
uniform vec3  u_color;
uniform vec3  u_camPos;
uniform vec3  u_fogColor;
uniform float u_fog;
uniform sampler2D u_shadowMap;
uniform mat4  u_lightVP;
uniform float u_shadowStr;
uniform float u_shadowSoft;
uniform float u_shadowSize;
varying vec3  v_wpos;
float unpack(vec4 r){return dot(r, vec4(1., 1./255., 1./65025., 1./16581375.));}
float getShadow(vec3 wp){
  vec4 lp=u_lightVP*vec4(wp,1.);
  vec3 c=lp.xyz/lp.w*.5+.5;
  if(c.x<0.||c.x>1.||c.y<0.||c.y>1.) return 0.;
  float bias=0.002;
  float sh=0.;
  float st=u_shadowSoft/u_shadowSize;
  for(int x=-2;x<=2;x++) for(int y=-2;y<=2;y++){
    float d=unpack(texture2D(u_shadowMap, c.xy+vec2(float(x), float(y))*st));
    sh+=(c.z-bias>d)?1.:0.;
  }
  return sh/25.;
}
void main(){
  float shadow=getShadow(v_wpos);
  float lit=1.-shadow*u_shadowStr;
  vec3 col=u_color*lit;
  float fogF=exp(-length(u_camPos-v_wpos)*u_fog);
  gl_FragColor=vec4(mix(u_fogColor, col, fogF), 1.);
}`,

  VS_PL:`
attribute vec3 a_pos; attribute vec3 a_nrm; attribute vec2 a_uv;
uniform mat4 u_mvp; uniform mat4 u_model;
uniform vec3 u_planeBend;
varying vec2 v_uv; varying vec3 v_nrm; varying vec3 v_wpos;
vec3 deformPlanePos(vec3 p){
  float axis=u_planeBend.z;
  float coord=mix(p.x, p.y, axis);
  float disp=u_planeBend.x*sin(coord*1.5707963)+u_planeBend.y*sin(coord*3.1415926);
  vec3 lp=p; lp.z+=disp; return lp;
}
vec3 deformPlaneNormal(vec3 p){
  float axis=u_planeBend.z;
  float coord=mix(p.x, p.y, axis);
  float slope=u_planeBend.x*1.5707963*cos(coord*1.5707963)+u_planeBend.y*3.1415926*cos(coord*3.1415926);
  return mix(normalize(vec3(-slope, 0., 1.)), normalize(vec3(0., -slope, 1.)), axis);
}
void main(){
  vec3 lp=a_pos; vec3 ln=a_nrm;
  if(abs(u_planeBend.x)+abs(u_planeBend.y)>0.001){
    lp=deformPlanePos(lp);
    ln=deformPlaneNormal(a_pos);
  }
  vec4 wp=u_model*vec4(lp,1.); v_wpos=wp.xyz;
  v_nrm=normalize(vec3(
    u_model[0][0]*ln.x+u_model[1][0]*ln.y+u_model[2][0]*ln.z,
    u_model[0][1]*ln.x+u_model[1][1]*ln.y+u_model[2][1]*ln.z,
    u_model[0][2]*ln.x+u_model[1][2]*ln.y+u_model[2][2]*ln.z));
  v_uv=a_uv;
  gl_Position=u_mvp*vec4(lp,1.);
}`,
  FS_PL:`
precision mediump float;
uniform sampler2D u_tex;
uniform sampler2D u_shadowMap;
uniform mat4  u_lightVP;
uniform vec3  u_camPos;
uniform vec3  u_lightDir;
uniform vec3  u_fogColor;
uniform float u_ambient;
uniform float u_rim;
uniform float u_fog;
uniform float u_keyAlpha;
uniform vec3  u_keyColor;
uniform float u_shadowStr;
uniform float u_shadowSoft;
uniform float u_shadowSize;
uniform float u_shadowOn;
varying vec2 v_uv; varying vec3 v_nrm; varying vec3 v_wpos;
float unpack(vec4 r){return dot(r, vec4(1., 1./255., 1./65025., 1./16581375.));}
float getShadow(vec3 wp, float bias){
  vec4 lp=u_lightVP*vec4(wp,1.);
  vec3 c=lp.xyz/lp.w*.5+.5;
  if(c.x<0.||c.x>1.||c.y<0.||c.y>1.) return 0.;
  float sh=0.;
  float st=u_shadowSoft/u_shadowSize;
  for(int x=-2;x<=2;x++) for(int y=-2;y<=2;y++){
    float d=unpack(texture2D(u_shadowMap, c.xy+vec2(float(x), float(y))*st));
    sh+=(c.z-bias>d)?1.:0.;
  }
  return sh/25.;
}
void main(){
  vec4 tex=texture2D(u_tex, v_uv);
  vec3 n=normalize(v_nrm);
  vec3 l=normalize(u_lightDir);
  vec3 v=normalize(u_camPos-v_wpos);
  vec3 h=normalize(l+v);
  float nv=max(dot(n,v), 0.);
  float diff=max(dot(n,l), 0.);
  float spec=pow(max(dot(n,h), 0.), 48.)*.2;
  float rim=pow(1.-nv, 3.)*u_rim;
  float bias=mix(.002, .010, 1.-diff)*u_shadowOn;
  float shadow=getShadow(v_wpos, bias)*u_shadowOn;
  float light=u_ambient+(1.-u_ambient)*diff*(1.-shadow*u_shadowStr*.7);
  vec3 col=tex.rgb*light+rim*vec3(.4, .6, 1.)+spec;
  float fogF=exp(-length(u_camPos-v_wpos)*u_fog);
  float keyDist=length(tex.rgb-u_keyColor);
  float alpha=u_keyAlpha>.5?smoothstep(.05, .12, keyDist)*tex.a:tex.a;
  gl_FragColor=vec4(mix(u_fogColor, col, fogF), alpha);
}`,

  _compile(src, type){
    const gl=this.gl;
    const s=gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if(!__glReady(gl, s, false)){
      console.error('Layer shader compile error:', gl.getShaderInfoLog(s), '\n', src);
      gl.deleteShader(s);
      return null;
    }
    return s;
  },
  _link(vs, fs){
    const gl=this.gl;
    const p=gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.linkProgram(p);
    if(!__glReady(gl, p, true)){
      console.error('Layer link error:', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  },

  init(gl){
    if(this.initialized) return true;
    // 起動時の値を「デフォルト」としてスナップショット (dblclick reset 用)
    if(!this.PDefaults) this.PDefaults = JSON.parse(JSON.stringify(this.P));
    this.gl=gl;
    const VS_SHD=this._compile(this.VS_SHD, gl.VERTEX_SHADER);
    const FS_SHD=this._compile(this.FS_SHD, gl.FRAGMENT_SHADER);
    const VS_GND=this._compile(this.VS_GND, gl.VERTEX_SHADER);
    const FS_GND=this._compile(this.FS_GND, gl.FRAGMENT_SHADER);
    const VS_PL=this._compile(this.VS_PL, gl.VERTEX_SHADER);
    const FS_PL=this._compile(this.FS_PL, gl.FRAGMENT_SHADER);
    if(!VS_SHD||!FS_SHD||!VS_GND||!FS_GND||!VS_PL||!FS_PL) return false;

    this.programs.shd=this._link(VS_SHD, FS_SHD);
    this.programs.gnd=this._link(VS_GND, FS_GND);
    this.programs.pl =this._link(VS_PL,  FS_PL);

    // ロケーション
    const P=this.programs;
    this.locs={
      shd:{
        pos:gl.getAttribLocation(P.shd,'a_pos'),
        lmvp:gl.getUniformLocation(P.shd,'u_lightMVP'),
        bend:gl.getUniformLocation(P.shd,'u_planeBend'),
      },
      gnd:{
        pos:gl.getAttribLocation(P.gnd,'a_pos'),
        mvp:gl.getUniformLocation(P.gnd,'u_mvp'),
        model:gl.getUniformLocation(P.gnd,'u_model'),
        color:gl.getUniformLocation(P.gnd,'u_color'),
        cam:gl.getUniformLocation(P.gnd,'u_camPos'),
        fogC:gl.getUniformLocation(P.gnd,'u_fogColor'),
        fog:gl.getUniformLocation(P.gnd,'u_fog'),
        smap:gl.getUniformLocation(P.gnd,'u_shadowMap'),
        lvp:gl.getUniformLocation(P.gnd,'u_lightVP'),
        sstr:gl.getUniformLocation(P.gnd,'u_shadowStr'),
        ssoft:gl.getUniformLocation(P.gnd,'u_shadowSoft'),
        ssize:gl.getUniformLocation(P.gnd,'u_shadowSize'),
      },
      pl:{
        pos:gl.getAttribLocation(P.pl,'a_pos'),
        nrm:gl.getAttribLocation(P.pl,'a_nrm'),
        uv:gl.getAttribLocation(P.pl,'a_uv'),
        mvp:gl.getUniformLocation(P.pl,'u_mvp'),
        model:gl.getUniformLocation(P.pl,'u_model'),
        tex:gl.getUniformLocation(P.pl,'u_tex'),
        smap:gl.getUniformLocation(P.pl,'u_shadowMap'),
        lvp:gl.getUniformLocation(P.pl,'u_lightVP'),
        cam:gl.getUniformLocation(P.pl,'u_camPos'),
        light:gl.getUniformLocation(P.pl,'u_lightDir'),
        fogC:gl.getUniformLocation(P.pl,'u_fogColor'),
        amb:gl.getUniformLocation(P.pl,'u_ambient'),
        rim:gl.getUniformLocation(P.pl,'u_rim'),
        fog:gl.getUniformLocation(P.pl,'u_fog'),
        keyA:gl.getUniformLocation(P.pl,'u_keyAlpha'),
        keyC:gl.getUniformLocation(P.pl,'u_keyColor'),
        bend:gl.getUniformLocation(P.pl,'u_planeBend'),
        sstr:gl.getUniformLocation(P.pl,'u_shadowStr'),
        ssoft:gl.getUniformLocation(P.pl,'u_shadowSoft'),
        ssize:gl.getUniformLocation(P.pl,'u_shadowSize'),
        son:gl.getUniformLocation(P.pl,'u_shadowOn'),
      }
    };

    // plane geometry (16 segments で curvature 用に細分)
    this.geo.plane=this._buildPlane(16);
    this.geo.ground=this._buildGround();

    // シャドウマップ FBO
    this.shadowMap=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowMap);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.SHADOW_SZ, this.SHADOW_SZ, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.shadowRBO=gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.shadowRBO);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, this.SHADOW_SZ, this.SHADOW_SZ);
    this.shadowFBO=gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.shadowMap, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.shadowRBO);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // デフォルトテクスチャ (チェッカー)
    this.defaultTex=this._mkCheckerTex();

    this.startTime=performance.now()/1000;
    this.cam.dist=this.P.dist;
    this.cam.el=this.P.camEl;
    this.cam.az=this.P.camAz;
    this.initialized=true;
    this.generateLayout();
    return true;
  },

  _buildPlane(seg){
    const pos=[],nrm=[],uv=[],idx=[];
    for(let r=0;r<=seg;r++) for(let s=0;s<=seg;s++){
      pos.push(s/seg*2-1, r/seg*2-1, 0);
      nrm.push(0,0,1);
      uv.push(s/seg, r/seg);
    }
    for(let r=0;r<seg;r++) for(let s=0;s<seg;s++){
      const a=r*(seg+1)+s, b=a+seg+1;
      idx.push(a, b, a+1, b, b+1, a+1);
    }
    const gl=this.gl;
    const posB=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, posB); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
    const nrmB=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nrmB); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nrm), gl.STATIC_DRAW);
    const uvB=gl.createBuffer();  gl.bindBuffer(gl.ARRAY_BUFFER, uvB);  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv),  gl.STATIC_DRAW);
    const idxB=gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxB); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    return {posB, nrmB, uvB, idxB, count:idx.length};
  },
  _buildGround(){
    const gl=this.gl;
    const pos=new Float32Array([-1,0,-1, 1,0,-1, 1,0,1, -1,0,1]);
    const idx=new Uint16Array([0,1,2, 0,2,3]);
    const posB=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, posB); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    const idxB=gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxB); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    return {posB, idxB, count:6};
  },
  _mkCheckerTex(){
    const gl=this.gl;
    const sz=64, d=new Uint8Array(sz*sz*4);
    for(let y=0;y<sz;y++) for(let x=0;x<sz;x++){
      const i=(y*sz+x)*4, c=((x>>3)+(y>>3))&1;
      d[i]=c?180:60; d[i+1]=c?180:60; d[i+2]=c?200:80; d[i+3]=255;
    }
    const t=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sz, sz, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  },

  async loadImages(files){
    const gl=this.gl;
    const arr=Array.from(files).filter(f=>f.type && f.type.startsWith('image/'));
    if(!arr.length) return 0;
    // 既存テクスチャを削除
    this.textures.forEach(t=>gl.deleteTexture(t));
    this.textures=[]; this.texAspects=[]; this.texKeyColors=[];

    const loads=arr.map(file=>new Promise(res=>{
      const img=new Image();
      const url=URL.createObjectURL(file);
      img.onload=()=>{
        const t=gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        let key=null;
        const isPng = file.type==='image/png' || /\.png$/i.test(file.name||'');
        if(isPng){
          try{
            const kc=document.createElement('canvas'); kc.width=1; kc.height=1;
            const kx=kc.getContext('2d'); kx.drawImage(img, 0, 0, 1, 1);
            const d=kx.getImageData(0,0,1,1).data;
            key=[d[0]/255, d[1]/255, d[2]/255];
          }catch(e){}
        }
        URL.revokeObjectURL(url);
        res({t, asp:img.width/Math.max(1,img.height), key});
      };
      img.onerror=()=>{ URL.revokeObjectURL(url); res(null); };
      img.src=url;
    }));
    const results=(await Promise.all(loads)).filter(Boolean);
    this.textures=results.map(r=>r.t);
    this.texAspects=results.map(r=>r.asp);
    this.texKeyColors=results.map(r=>r.key);
    this.generateLayout();
    return this.textures.length;
  },

  clearImages(){
    const gl=this.gl;
    this.textures.forEach(t=>gl.deleteTexture(t));
    this.textures=[]; this.texAspects=[]; this.texKeyColors=[];
    this.generateLayout();
  },

  // URL 配列から直接ロード (auto-load 用)
  async loadFromUrls(urls){
    const gl=this.gl;
    this.textures.forEach(t=>gl.deleteTexture(t));
    this.textures=[]; this.texAspects=[]; this.texKeyColors=[];
    const loads=urls.map(rawUrl=>new Promise(res=>{
      // URL に空白などを含む場合に備えてエンコード (相対パスのまま使えるよう pathname のみ encode)
      const url = /^(blob:|data:|https?:|file:)/i.test(rawUrl) ? rawUrl : rawUrl.split('/').map(encodeURIComponent).join('/');
      const img=new Image();
      // crossOrigin は http(s) のときだけ — file:// では逆にロード失敗する
      if(/^https?:/i.test(url)){ try{ img.crossOrigin='anonymous'; }catch(e){} }
      img.onload=()=>{
        try{
          const t=gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          let key=null;
          if(/\.png(\?.*)?$/i.test(url)){
            try{
              const kc=document.createElement('canvas'); kc.width=1; kc.height=1;
              const kx=kc.getContext('2d'); kx.drawImage(img, 0, 0, 1, 1);
              const d=kx.getImageData(0,0,1,1).data;
              key=[d[0]/255, d[1]/255, d[2]/255];
            }catch(e){}
          }
          res({t, asp:img.width/Math.max(1,img.height), key});
        }catch(e){ res(null); }
      };
      img.onerror=()=>res(null);
      img.src=url;
    }));
    const results=(await Promise.all(loads)).filter(Boolean);
    this.textures=results.map(r=>r.t);
    this.texAspects=results.map(r=>r.asp);
    this.texKeyColors=results.map(r=>r.key);
    this.generateLayout();
    return this.textures.length;
  },

  // images/ フォルダから自動ロード
  //   1) ディレクトリリスティング HTML (VS Code Live Server / python -m http.server 等) をパース
  //   2) フォールバック: images/manifest.json (["a.png","b.jpg"] or {files:[...]})
  async autoLoadFromFolder(dir='images'){
    // 1) dir/ を fetch — index.php(JSON) / autoindex(HTML) どちらでも対応
    try{
      const r=await fetch(dir+'/', {cache:'no-cache'});
      if(r.ok){
        const text=await r.text();
        const ct=r.headers.get('Content-Type')||'';
        if(ct.includes('json') || text.trim().startsWith('[') || text.trim().startsWith('{')){
          try{
            const data=JSON.parse(text);
            const files=Array.isArray(data)?data:(data.files||[]);
            if(files.length) return await this.loadFromUrls(files.map(f=>dir+'/'+f));
          }catch(e){}
        } else {
          const re=/href="([^"]+\.(?:png|jpe?g|webp|gif|bmp))"/gi;
          const set=new Set();
          let m;
          while((m=re.exec(text))){
            let h=m[1];
            if(h==='../'||h.startsWith('?')||h.startsWith('#')) continue;
            const fn=h.split('?')[0].split('#')[0].split('/').pop();
            if(fn) set.add(dir+'/'+fn);
          }
          if(set.size>0){
            const urls=[...set].sort();
            return await this.loadFromUrls(urls);
          }
        }
      }
    }catch(e){}
    // 2) manifest.json
    try{
      const r=await fetch(dir+'/manifest.json', {cache:'no-cache'});
      if(r.ok){
        const data=await r.json();
        const files=Array.isArray(data)?data:(data.files||[]);
        if(files.length){
          return await this.loadFromUrls(files.map(f=>dir+'/'+f));
        }
      }
    }catch(e){}
    return 0;
  },

  generateLayout(){
    const n=(this.P.count && this.P.count>0) ? Math.max(1, this.P.count|0) : Math.max(this.textures.length, 8);
    const rng=this._rng(this.P.seed);
    this.planes=Array.from({length:n}, (_,i)=>{
      const theta=rng()*2*Math.PI;
      const phi=Math.acos(2*rng()-1);
      const r=Math.cbrt(rng())*this.P.spread;
      const tIdx = this.textures.length>0 ? (i % this.textures.length) : -1;
      const bendSeed=Math.pow(rng(), 0.72);
      const mainBend=(0.2+bendSeed*0.8)*(rng()>.5 ? 1 : -1);
      const secondaryChance=bendSeed>0.68 ? rng() : 0;
      const secondaryBend=secondaryChance>0.45
        ? (0.2+secondaryChance*0.55)*(rng()>.7?1:-1)*mainBend
        : 0;
      return{
        pos:[r*Math.sin(phi)*Math.cos(theta), r*Math.sin(phi)*Math.sin(theta), r*Math.cos(phi)],
        axis:this.v3.norm([rng()-.5, rng()-.5, rng()-.5]),
        spinSign:rng()>.5?1:-1,
        floatOff:rng()*Math.PI*2,
        floatFreq:.3+rng()*.7,
        sizeRandom:rng(),
        curvatureBase:mainBend,
        curvatureSecondary:secondaryBend,
        curvatureAxis:rng()>.5?1:0,
        texIdx:tIdx,
        imgAspect:tIdx>=0?(this.texAspects[tIdx]||1):1,
        keyColor:tIdx>=0?this.texKeyColors[tIdx]:null,
        autoAngle:0, floatY:0,
      };
    });
  },

  _effectiveScale(sp){
    return this.P.size * Math.pow(3, (sp.sizeRandom-.5)*2*this.P.sizeVar);
  },
  _planeBendUniform(sp){
    return [
      (sp.curvatureBase||0)*this.P.curvature*2.5,
      (sp.curvatureSecondary||0)*this.P.curvature*2.5,
      sp.curvatureAxis||0,
    ];
  },

  _camEye(){
    const t=this.cam.target;
    return [
      t[0]+this.cam.dist*Math.cos(this.cam.el)*Math.sin(this.cam.az),
      t[1]+this.cam.dist*Math.sin(this.cam.el),
      t[2]+this.cam.dist*Math.cos(this.cam.el)*Math.cos(this.cam.az)
    ];
  },
  _camAxes(){
    const eye=this._camEye();
    const z=this.v3.norm(this.v3.sub(eye, this.cam.target));
    const x=this.v3.norm(this.v3.cross([0,1,0], z));
    const y=this.v3.cross(z, x);
    return {z, x, y};
  },
  _getLightDir(){
    const az=this.P.lightAz*Math.PI/180;
    return this.v3.norm([Math.sin(az)*1.7, 2.0, Math.cos(az)*1.7]);
  },
  _makeLightVP(){
    const ld=this._getLightDir();
    const dist=this.P.spread*5;
    const eye=this.v3.scale(ld, dist);
    const lview=this.m4.lookAt(eye, [0,0,0], [0,1,0]);
    const sc=(Math.abs(this.P.groundMult)+2.5)*this.P.spread+this.P.size*3;
    const lproj=this.m4.ortho(-sc, sc, -sc, sc, 0.5, dist*2.5);
    return this.m4.mul(lproj, lview);
  },

  // === メイン描画 ===
  // opts: { fbo, w, h, beatMode:'drone'|'beat', beat, beatPhase }
  render(opts){
    if(!this.initialized) return;
    const gl=this.gl;
    const {fbo, w, h, beatMode, beat, beatPhase, slot} = opts;

    // 時間／拍数からアニメ駆動
    const sp = (typeof App !== 'undefined' && App.speed) ? App.speed : 1.0;
    // 全体 speed 反映済みクロック (GL.clock) を使用。利用不可なら従来の実時刻。
    const t = (typeof GL !== 'undefined' && typeof GL.clock === 'number') ? GL.clock : (performance.now()/1000 - this.startTime);

    // motion: beat モードなら拍ベース、それ以外は時間ベース
    let motionT;
    if(beatMode === 'beat'){
      motionT = (beat || 0);
    } else {
      motionT = t;
    }

    // カメラを自動回転
    this.cam.az += this.P.autorot * (1/60) * sp;
    this.cam.dist = this.P.dist;
    this.cam.el = this.P.camEl;

    // planes の autoAngle / floatY を更新
    for(const sp of this.planes){
      sp.autoAngle = motionT * this.P.spin * sp.spinSign;
      if(beatMode === 'beat'){
        // 拍頭で sin(πφ) パルス
        sp.floatY = Math.sin((beatPhase||0) * Math.PI) * this.P.float * (0.5 + sp.floatFreq*0.5);
      } else {
        sp.floatY = Math.sin(t * sp.floatFreq + sp.floatOff) * this.P.float;
      }
    }

    // モデル行列
    const models=this.planes.map(sp=>{
      const sc=this._effectiveScale(sp);
      const rot=this.m4.axisAngle(sp.axis, sp.autoAngle);
      const ar=sp.imgAspect||1;
      return this.m4.mul(
        this.m4.T(sp.pos[0], sp.pos[1]+sp.floatY, sp.pos[2]),
        this.m4.mul(rot, this.m4.Sv(sc*ar, sc, sc))
      );
    });

    const lightVP=this._makeLightVP();
    const lightDir=this._getLightDir();
    const asp=w/Math.max(1,h);
    const proj=this.m4.perspective(this.P.fov*Math.PI/180, asp, .05, 1000);
    const eye=this._camEye();
    const vp=this.m4.mul(proj, this.m4.lookAt(eye, this.cam.target, [0,1,0]));
    const bgv=(this.P.bg!=null)?this.P.bg:1.0;
    const bg=[bgv,bgv,bgv];

    // === Shadow pass ===
    if(this.P.shadowOn && this.planes.length){
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO);
      gl.viewport(0, 0, this.SHADOW_SZ, this.SHADOW_SZ);
      gl.clearColor(1,1,1,1);
      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.BLEND);
      gl.useProgram(this.programs.shd);
      const L=this.locs.shd;
      const geo=this.geo.plane;
      gl.bindBuffer(gl.ARRAY_BUFFER, geo.posB);
      gl.enableVertexAttribArray(L.pos);
      gl.vertexAttribPointer(L.pos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geo.idxB);
      for(let i=0;i<this.planes.length;i++){
        gl.uniformMatrix4fv(L.lmvp, false, this.m4.mul(lightVP, models[i]));
        gl.uniform3fv(L.bend, this._planeBendUniform(this.planes[i]));
        gl.drawElements(gl.TRIANGLES, geo.count, gl.UNSIGNED_SHORT, 0);
      }
    }

    // === Main pass — 指定 FBO に描く ===
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(bg[0], bg[1], bg[2], slot === 'B' ? 0 : 1);   // Slot B は背景を透過(下の A が透ける)
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);

    // ground
    if(this.P.showGround){
      gl.useProgram(this.programs.gnd);
      const L=this.locs.gnd;
      const geo=this.geo.ground;
      const groundY=this.P.groundMult*this.P.spread;
      const groundSc=Math.max(this.P.spread, 5)*5;
      const gndModel=this.m4.mul(this.m4.T(0, groundY, 0), this.m4.S(groundSc));
      gl.bindBuffer(gl.ARRAY_BUFFER, geo.posB);
      gl.enableVertexAttribArray(L.pos);
      gl.vertexAttribPointer(L.pos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geo.idxB);
      gl.uniformMatrix4fv(L.mvp, false, this.m4.mul(vp, gndModel));
      gl.uniformMatrix4fv(L.model, false, gndModel);
      const b=this.P.groundBrt;
      gl.uniform3fv(L.color, [bg[0]*b, bg[1]*b, bg[2]*b]);
      gl.uniform3fv(L.cam, eye);
      gl.uniform3fv(L.fogC, bg);
      gl.uniform1f(L.fog, this.P.fog);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.P.shadowOn ? this.shadowMap : this.defaultTex);
      gl.uniform1i(L.smap, 1);
      gl.uniformMatrix4fv(L.lvp, false, lightVP);
      gl.uniform1f(L.sstr, this.P.shadowOn ? this.P.shadowStr : 0);
      gl.uniform1f(L.ssoft, this.P.shadowSoft);
      gl.uniform1f(L.ssize, this.SHADOW_SZ);
      gl.drawElements(gl.TRIANGLES, geo.count, gl.UNSIGNED_SHORT, 0);
    }

    // planes
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.programs.pl);
    const L=this.locs.pl;
    const geo=this.geo.plane;
    gl.uniform3fv(L.light, lightDir);
    gl.uniform3fv(L.fogC, bg);
    gl.uniform3fv(L.cam, eye);
    gl.uniform1f(L.amb, this.P.ambient);
    gl.uniform1f(L.rim, this.P.rim);
    gl.uniform1f(L.fog, this.P.fog);
    gl.uniform1f(L.sstr, this.P.shadowStr);
    gl.uniform1f(L.ssoft, this.P.shadowSoft);
    gl.uniform1f(L.ssize, this.SHADOW_SZ);
    gl.uniform1f(L.son, this.P.shadowOn?1:0);
    gl.uniformMatrix4fv(L.lvp, false, lightVP);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(L.tex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.P.shadowOn ? this.shadowMap : this.defaultTex);
    gl.uniform1i(L.smap, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, geo.posB);
    gl.enableVertexAttribArray(L.pos); gl.vertexAttribPointer(L.pos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, geo.nrmB);
    gl.enableVertexAttribArray(L.nrm); gl.vertexAttribPointer(L.nrm, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, geo.uvB);
    gl.enableVertexAttribArray(L.uv);  gl.vertexAttribPointer(L.uv,  2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geo.idxB);

    for(let i=0;i<this.planes.length;i++){
      const sp=this.planes[i];
      gl.uniformMatrix4fv(L.mvp, false, this.m4.mul(vp, models[i]));
      gl.uniformMatrix4fv(L.model, false, models[i]);
      gl.uniform1f(L.keyA, (this.P.pngAlpha && sp.keyColor)?1:0);
      gl.uniform3fv(L.keyC, sp.keyColor || [0,0,0]);
      gl.uniform3fv(L.bend, this._planeBendUniform(sp));
      const tex=(this.textures.length>0 && sp.texIdx>=0) ? this.textures[sp.texIdx] : this.defaultTex;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.drawElements(gl.TRIANGLES, geo.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.disable(gl.BLEND);

    // 後始末: 一部の attribute は VAO に縛られていないため、外側で必要なら再 bind される
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
};
