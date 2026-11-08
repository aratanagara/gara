'use strict';
// =============================================================
// shelf.js — anon-press.com トップの「円筒本棚タワー」レンダラを VJ エンジン化。
//   原典: anon-theme/js/anon-shelf-gl.js(Three.js 不使用の手書き WebGL)。
//   ポリゴン生成 + Phong シェーディング。dark モード or Slot B ではワイヤーフレーム表示。
//   VJ エンジン IF: init(gl) / update() / render({fbo,w,h,slot})。深度はスロットFBOに深度RBOを付与。
// =============================================================

const Shelf = {
  initialized:false, ok:false, gl:null,
  prog:null, buf:null, nVerts:0, locs:null,
  depthRBO:null, depthW:0, depthH:0,
  vao:null,
  startTime:0,
  fovY: 2*Math.atan(0.5/1.05),
  P:{ dark:false,
      camDist:100, fovScale:100, camSwing:100, camHeight:0, camRoll:0,
      lightAz:0, lightElev:0, keyLight:100, ambient:100, stairGlow:100, fogDensity:100, spineColors:0,
      bookGaps:100, bookWidth:100, bookHeight:100, shelfPitch:100, helixPitch:100, poleThick:100 },
  // 見出し (Save / Reset / Random) の下に並ぶスライダー。照明・色の列は Slot A の通常表示 (Dark OFF) だけに効く
  SPECS:[
    ['Distance',       'camDist',     50,   110, 1,   'pct'],
    ['Field of View',  'fovScale',    50,   170, 1,   'pct'],
    ['Elev Swing',     'camSwing',    0,    160, 1,   'pct'],
    ['Eye Height',     'camHeight',   -3,   6,   0.1, 'f2'],
    ['Roll',           'camRoll',     -90,  90,  1,   'deg'],
    ['Light Azimuth',  'lightAz',     -180, 180, 1,   'deg'],
    ['Light Elevation','lightElev',   -150, 20,  1,   'deg'],
    ['Key Light',      'keyLight',    0,    160, 1,   'pct'],
    ['Ambient',        'ambient',     0,    300, 1,   'pct'],
    ['Stair Glow',     'stairGlow',   0,    400, 1,   'pct'],
    ['Fog',            'fogDensity',  0,    300, 1,   'pct'],
    ['Spine Colors',   'spineColors', 0,    100, 1,   'pct'],
    ['Book Gaps',      'bookGaps',    0,    500, 1,   'pct'],
    ['Book Width',     'bookWidth',   70,   200, 1,   'pct'],
    ['Book Height',    'bookHeight',  50,   115, 1,   'pct'],
    ['Shelf Spacing',  'shelfPitch',  90,   160, 1,   'pct'],
    ['Stair Pitch',    'helixPitch',  50,   200, 1,   'pct'],
    ['Pole Thickness', 'poleThick',   20,   500, 1,   'pct'],
  ],

  // ── シーン定数（原典と一致）──
  C:{ WALL_R:4.0, WALL_T:0.05, COL_N:16, SHELF_P:0.56, BOOK_D:0.24, UNIT_W:0.1745,
      HELIX_R:1.5, HELIX_P:4.5, STEPS_N:10, STEP_W:0.80, STEP_H:0.14, STEP_T:0.50,
      POLE_R:0.05, Y_MIN:-14.0, Y_MAX:14.0 },   // 原典 ±40 だが遠方はフォグで不可視 → 軽量化のため縮小

  _fr(x){ return x - Math.floor(x); },
  _h1(p){ p=this._fr(p*0.1031); p*=p+33.33; p*=p+p; return this._fr(p); },
  _h2(px,py){ let x=this._fr(px*0.1031), y=this._fr(py*0.1031), z=this._fr(px*0.1031);
    const d=x*(y+33.33)+y*(z+33.33)+z*(x+33.33); x+=d; y+=d; z+=d; return this._fr((x+y)*z); },

  FACES:[
    [[1,0,0],  [1,-1,-1],[1, 1,-1],[1, 1, 1],[1,-1, 1]],
    [[-1,0,0], [-1,-1, 1],[-1, 1, 1],[-1, 1,-1],[-1,-1,-1]],
    [[0,1,0],  [-1,1, 1],[ 1,1, 1],[ 1,1,-1],[-1,1,-1]],
    [[0,-1,0], [-1,-1,-1],[1,-1,-1],[1,-1, 1],[-1,-1, 1]],
    [[0,0,1],  [ 1,-1, 1],[ 1, 1, 1],[-1, 1, 1],[-1,-1, 1]],
    [[0,0,-1], [-1,-1,-1],[-1, 1,-1],[ 1, 1,-1],[ 1,-1,-1]],
  ],

  // ボックスを頂点配列へ（x,y,z, nx,ny,nz, mat, bx,by,bz, phase = 11 floats/vertex）
  // phase: 階段(mat3)のみ helix 基準角 θ を渡す(頂点シェーダで螺旋移動に使用)。他は 0。
  _addBox(arr, cx,cy,cz, hx,hy,hz, rotY, mat, phase){
    phase = phase || 0;
    const c=Math.cos(rotY), s=Math.sin(rotY);
    for(const [[nx,ny,nz], v0,v1,v2,v3] of this.FACES){
      const wnx=nx*c+nz*s, wny=ny, wnz=-nx*s+nz*c;
      const pw=[v0,v1,v2,v3].map(([vx,vy,vz])=>{
        const lx=vx*hx, ly=vy*hy, lz=vz*hz;
        return [cx+lx*c+lz*s, cy+ly, cz-lx*s+lz*c];
      });
      const baryTris=[ [[1,1,0],[0,1,0],[0,1,1]], [[1,0,1],[0,1,1],[0,0,1]] ];
      for(let ti=0;ti<2;ti++)
        for(let vi=0;vi<3;vi++){
          const i=[[0,1,2],[0,2,3]][ti][vi];
          arr.push(pw[i][0],pw[i][1],pw[i][2], wnx,wny,wnz, mat, ...baryTris[ti][vi], phase);
        }
    }
  },

  _dz(v){ return (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v; },
  // メッシュの形を変える param の倍率 (既定 100% = 原典と同じ数値)
  _meshK(){
    const P=this.P, dz=(v)=>this._dz(v);
    return { gap:dz(P.bookGaps)/100, bw:dz(P.bookWidth)/100, bh:dz(P.bookHeight)/100, pitch:dz(P.shelfPitch)/100, helix:dz(P.helixPitch)/100, pole:dz(P.poleThick)/100 };
  },
  _meshSig(k){ return [k.gap,k.bw,k.bh,k.pitch,k.helix,k.pole].join(','); },
  _derive(k){ return Object.assign({}, this.C, { SHELF_P:this.C.SHELF_P*k.pitch, HELIX_P:this.C.HELIX_P*k.helix, POLE_R:this.C.POLE_R*k.pole }); },

  _buildMesh(km){
    const C=this._derive(km), arr=[], TAU=Math.PI*2, PI=Math.PI;
    const secAng=TAU/C.COL_N, colHW=C.WALL_R*PI/C.COL_N;
    const rowMin=Math.floor(C.Y_MIN/C.SHELF_P)-1, rowMax=Math.ceil(C.Y_MAX/C.SHELF_P)+1;
    for(let ci=0; ci<C.COL_N; ci++){
      const colAngle=(ci+0.5)*secAng-PI, rotY=-colAngle, cosA=Math.cos(colAngle), sinA=Math.sin(colAngle);
      for(let row=rowMin; row<=rowMax; row++){
        const shelfCY=(row+0.5)*C.SHELF_P;
        const pLU=-(C.BOOK_D*0.5+C.WALL_T), pSV=-(C.SHELF_P*0.5-0.015), pLA=pLU+C.WALL_R;
        this._addBox(arr, pLA*cosA, shelfCY+pSV, pLA*sinA, C.BOOK_D*0.5+C.WALL_T+0.01, 0.015, colHW, rotY, 1);
        let pos=-colHW + this._h2(ci*7.1, row*11.3)*C.UNIT_W*0.4;
        for(let bi=0; bi<22; bi++){
          const bSeed=this._h2(ci*17.3+bi*3.7, row*2.1);
          if(this._h1(bSeed+5.9)<0.07*km.gap) pos += C.UNIT_W*(0.4+this._h1(bSeed+6.7)*0.4);
          if(pos>=colHW+0.05) break;
          const r_=this._h1(bSeed+3.1);
          const bw=C.UNIT_W*(0.32+r_*r_*0.78)*km.bw;
          const bH=(0.30+this._h1(bSeed)*0.16)*km.bh;
          const bD=C.BOOK_D*(0.45+this._h1(bSeed+1.7)*0.55);
          const bCU=-bD*0.5-C.WALL_T, bCV=-C.SHELF_P*0.5+0.030+bH*0.5, bLW=pos+bw*0.5, bLA=bCU+C.WALL_R;
          this._addBox(arr, bLA*cosA-bLW*sinA, shelfCY+bCV, bLA*sinA+bLW*cosA, bD*0.5, bH*0.5, bw*0.5, rotY, 1, 0.02+0.98*this._h1(bSeed+8.3));
          pos += bw;
          if(pos>=colHW+0.05) break;
        }
      }
    }
    // ダブルヘリックス階段
    const stepAng=TAU/C.STEPS_N;
    for(let arm=0; arm<2; arm++){
      const armOff=arm*PI;
      const kMin=Math.floor((C.Y_MIN*TAU/C.HELIX_P-armOff)/stepAng)-2;
      const kMax=Math.ceil ((C.Y_MAX*TAU/C.HELIX_P-armOff)/stepAng)+2;
      for(let k=kMin; k<=kMax; k++){
        const theta=k*stepAng+armOff, cy=theta*C.HELIX_P/TAU;
        if(cy<C.Y_MIN-1 || cy>C.Y_MAX+1) continue;
        this._addBox(arr, C.HELIX_R*Math.cos(theta), cy, C.HELIX_R*Math.sin(theta), C.STEP_W*0.5, C.STEP_H*0.5, C.STEP_T*0.5, -theta, 3, theta);
      }
    }
    // 背板
    const backR=C.WALL_R-C.WALL_T-0.01, backCY=(C.Y_MIN+C.Y_MAX)*0.5, backHY=(C.Y_MAX-C.Y_MIN)*0.5+0.5;
    for(let ci=0; ci<C.COL_N; ci++){
      const colAngle=(ci+0.5)*secAng-PI, cosA=Math.cos(colAngle), sinA=Math.sin(colAngle);
      this._addBox(arr, backR*cosA, backCY, backR*sinA, 0.01, backHY, colHW-0.02, -colAngle, 2);
    }
    // 床
    this._addBox(arr, 0, C.Y_MIN-0.05, 0, C.WALL_R+2.0, 0.02, C.WALL_R+2.0, 0, 2);
    // 中央ポール
    this._addBox(arr, 0, (C.Y_MIN+C.Y_MAX)*0.5, 0, C.POLE_R, (C.Y_MAX-C.Y_MIN)*0.5+1, C.POLE_R, 0, 0);
    return new Float32Array(arr);
  },

  _perspective(fovY, aspect, near, far){
    const f=1.0/Math.tan(fovY*0.5), nf=1.0/(near-far), m=new Float32Array(16);
    m[0]=f/aspect; m[5]=f; m[10]=(far+near)*nf; m[11]=-1; m[14]=2*far*near*nf; return m;
  },
  _lookAt(ex,ey,ez, cx,cy,cz){
    let fx=cx-ex, fy=cy-ey, fz=cz-ez; const fl=Math.sqrt(fx*fx+fy*fy+fz*fz)||1; fx/=fl; fy/=fl; fz/=fl;
    let rx=-fz, rz=fx; const rl=Math.sqrt(rx*rx+rz*rz)||1; rx/=rl; rz/=rl;
    const ux=-rz*fy, uy=rz*fx-rx*fz, uz=rx*fy;
    const m=new Float32Array(16);
    m[0]=rx;  m[4]=0;  m[8]=rz;  m[12]=-(rx*ex+rz*ez);
    m[1]=ux;  m[5]=uy; m[9]=uz;  m[13]=-(ux*ex+uy*ey+uz*ez);
    m[2]=-fx; m[6]=-fy;m[10]=-fz;m[14]= (fx*ex+fy*ey+fz*ez);
    m[15]=1; return m;
  },
  _mul(a,b){ const m=new Float32Array(16);
    for(let i=0;i<4;i++) for(let j=0;j<4;j++){ let s=0; for(let k=0;k<4;k++) s+=a[i+k*4]*b[k+j*4]; m[i+j*4]=s; } return m; },

  VERT:`#version 300 es
#define TAU 6.28318530718
in vec3 aPos; in vec3 aNor; in float aMat; in vec3 aBary; in float aPhase;
uniform mat4 uMVP; uniform vec3 uCam; uniform float uTime;
uniform vec3 uHelix;   // (HELIX_R, HELIX_P, STEP_ANG)
out vec3 vNor; out float vMat; out float vDist; out float vWorldY; out vec3 vBary; out float vStepWave; out float vBook;
void main(){
  vMat=aMat; vBary=aBary;
  vBook=(aMat>0.5 && aMat<1.5) ? aPhase : 0.0;   // 本 1 冊ごとの値 (棚板は 0)
  vec3 pos=aPos, nrm=aNor;
  vStepWave=0.0;
  if(aMat>2.5){                          // 階段(mat3): helix 軌道に沿って回転しながら上昇(継ぎ目なしループ)
    float th=aPhase;                                   // 元ステップの基準角
    float R=uHelix.x, P=uHelix.y, stepAng=uHelix.z;
    float dth=mod(uTime*1.7, stepAng);                 // 1ステップ分で1周ループ → シームレス上昇
    float th2=th+dth;
    float ct=cos(th), st=sin(th), ct2=cos(th2), st2=sin(th2);
    // world → 局所座標 (中心を戻して R(-th))。中心 = helix 上の点、cy = th*P/TAU
    vec2 d=pos.xz - vec2(R*ct, R*st);
    vec2 loc=vec2(ct*d.x + st*d.y, -st*d.x + ct*d.y);
    float locY=pos.y - th*P/TAU;
    // 新しい角 th2 で helix 上に再配置 (中心 + R(th2)·loc)
    vec2 w=vec2(ct2*loc.x - st2*loc.y, st2*loc.x + ct2*loc.y);
    pos=vec3(R*ct2 + w.x, th2*P/TAU + locY, R*st2 + w.y);
    // 法線も同じ回転 (R(-th) → R(th2))
    vec2 nd=vec2(ct*nrm.x + st*nrm.z, -st*nrm.x + ct*nrm.z);
    vec2 nw=vec2(ct2*nd.x - st2*nd.y, st2*nd.x + ct2*nd.y);
    nrm=vec3(nw.x, nrm.y, nw.y);
    vStepWave=0.5+0.5*sin(th*1.0 - uTime*1.8);         // 上昇する暖色の光バンド
  }
  vNor=nrm; vWorldY=pos.y; vDist=length(pos-uCam);
  gl_Position=uMVP*vec4(pos,1.0);
}`,

  FRAG:`#version 300 es
precision highp float;
in vec3 vNor; in float vMat; in float vDist; in float vWorldY; in vec3 vBary; in float vStepWave; in float vBook;
uniform float uDarkMode;
uniform float uWire;
uniform float uLightAz;     // 光源の方位 (deg)
uniform float uLightElev;   // 光源の仰角の増減 (deg)
uniform float uKey;         // 主光源の強さ
uniform float uAmb;         // 環境光の強さ
uniform float uGlow;        // 階段の光バンド
uniform float uFogK;        // 霧の濃さ
uniform float uSpine;       // 背表紙の色づけ
out vec4 fragColor;
void main(){
  if(uWire > 0.5){
    float e=min(min(vBary.x,vBary.y),vBary.z);
    float fw=fwidth(e);
    float line=1.0-step(fw*0.9, e);
    float fade=clamp(1.0-(vDist-3.0)/6.0, 0.0, 1.0);
    fragColor=vec4(1.0,1.0,1.0, line*fade);
    return;
  }
  vec3 nor=normalize(vNor);
  vec3 lightDir=normalize(vec3(-0.4,1.0,-0.3));
  if(uLightAz != 0.0 || uLightElev != 0.0){
    float el=clamp(asin(lightDir.y)+radians(uLightElev), -1.48, 1.5707963);
    float az=atan(lightDir.z, lightDir.x)+radians(uLightAz);
    lightDir=vec3(cos(el)*cos(az), sin(el), cos(el)*sin(az));
  }
  float darkMode = step(0.5, uDarkMode);
  vec3 lightCol=mix(vec3(1.00,0.97,0.94), vec3(0.74,0.68,0.58), darkMode);
  float diff=max(dot(nor,lightDir),0.0);
  float hemi=clamp(nor.y*0.5+0.5,0.0,1.0);
  vec3 ambLight=mix(vec3(0.60,0.62,0.68), vec3(0.80,0.79,0.77), hemi);
  vec3 ambDark =mix(vec3(0.10,0.11,0.13), vec3(0.22,0.20,0.17), hemi);
  vec3 ambCol=mix(ambLight, ambDark, darkMode);
  vec3 baseLight=(vMat<1.5 || vMat>2.5) ? vec3(0.91,0.90,0.88) : vec3(0.28,0.22,0.16);   // 階段(mat3)も明色
  vec3 baseDark =(vMat<1.5 || vMat>2.5) ? vec3(0.30,0.27,0.22) : vec3(0.12,0.085,0.055);
  vec3 base=mix(baseLight, baseDark, darkMode);
  if(uSpine > 0.0 && vBook > 0.0){   // 本ごとに色相と明るさをずらして背表紙に見立てる
    vec3 tint=0.5+0.5*cos(6.2831853*(vBook*3.0+vec3(0.0,0.33,0.67)));
    base=mix(base, base*tint*(0.55+0.9*fract(vBook*7.0)), uSpine);
  }
  vec3 col=base*(diff*lightCol*1.05*uKey + ambCol*0.30*uAmb);
  col += mix(vec3(1.0,0.92,0.72)*0.30, vec3(0.55,0.38,0.18)*0.24, darkMode)*vStepWave*uGlow; // 階段を上昇する暖色の光バンド
  vec3 darkBg=mix(vec3(0.06,0.06,0.07), vec3(0.010,0.012,0.016), darkMode);
  col=mix(col, darkBg, clamp((1.0-smoothstep(-14.0,8.0,vWorldY))*1.5, 0.0, 1.0));
  vec3 farBg=mix(vec3(0.97,0.97,0.96), vec3(0.070,0.066,0.060), darkMode);
  vec3 bg=mix(darkBg, farBg, smoothstep(-8.0,15.0,vWorldY));
  col=mix(col, bg, clamp((vDist-4.0)/7.0*uFogK, 0.0, 1.0));
  col=pow(clamp(col,0.0,1.0), vec3(0.4545));
  fragColor=vec4(col,1.0);
}`,

  _compile(gl, type, src){
    const sh=gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
    if(!__glReady(gl, sh, false)){ console.error('[Shelf shader]', gl.getShaderInfoLog(sh)); return null; }
    return sh;
  },

  init(gl){
    if(this.initialized) return this.ok;
    this.gl=gl;
    gl.getExtension('OES_standard_derivatives');   // WebGL2 では fwidth はコアだが無害
    const vs=this._compile(gl, gl.VERTEX_SHADER, this.VERT);
    const fs=this._compile(gl, gl.FRAGMENT_SHADER, this.FRAG);
    if(!vs||!fs){ this.initialized=true; this.ok=false; return false; }
    const prog=gl.createProgram(); gl.attachShader(prog,vs); gl.attachShader(prog,fs); gl.linkProgram(prog);
    if(!__glReady(gl, prog, true)){ console.error('[Shelf link]', gl.getProgramInfoLog(prog)); this.initialized=true; this.ok=false; return false; }
    this.prog=prog;
    this._mk=this._meshK(); this._msig=this._meshSig(this._mk); this._Cb=this._derive(this._mk); this._mpend=0;
    const data=this._buildMesh(this._mk);
    this.nVerts=data.length/11;
    this.vao=gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.buf=buf;
    const stride=44;
    const aPos=gl.getAttribLocation(prog,'aPos'), aNor=gl.getAttribLocation(prog,'aNor'),
          aMat=gl.getAttribLocation(prog,'aMat'), aBary=gl.getAttribLocation(prog,'aBary'),
          aPhase=gl.getAttribLocation(prog,'aPhase');
    gl.enableVertexAttribArray(aPos);  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(aNor);  gl.vertexAttribPointer(aNor, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(aMat);  gl.vertexAttribPointer(aMat, 1, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(aBary); gl.vertexAttribPointer(aBary,3, gl.FLOAT, false, stride, 28);
    if(aPhase>=0){ gl.enableVertexAttribArray(aPhase); gl.vertexAttribPointer(aPhase,1, gl.FLOAT, false, stride, 40); }
    gl.bindVertexArray(null);
    this.locs={
      uMVP: gl.getUniformLocation(prog,'uMVP'),
      uCam: gl.getUniformLocation(prog,'uCam'),
      uDarkMode: gl.getUniformLocation(prog,'uDarkMode'),
      uWire: gl.getUniformLocation(prog,'uWire'),
      uTime: gl.getUniformLocation(prog,'uTime'),
      uHelix: gl.getUniformLocation(prog,'uHelix'),
      uLightAz: gl.getUniformLocation(prog,'uLightAz'),
      uLightElev: gl.getUniformLocation(prog,'uLightElev'),
      uKey: gl.getUniformLocation(prog,'uKey'),
      uAmb: gl.getUniformLocation(prog,'uAmb'),
      uGlow: gl.getUniformLocation(prog,'uGlow'),
      uFogK: gl.getUniformLocation(prog,'uFogK'),
      uSpine: gl.getUniformLocation(prog,'uSpine'),
    };
    this.startTime=performance.now()/1000;
    this.initialized=true; this.ok=true;
    return true;
  },

  _ensureDepth(w,h){
    const gl=this.gl;
    if(this.depthRBO && this.depthW===w && this.depthH===h) return;
    if(this.depthRBO) gl.deleteRenderbuffer(this.depthRBO);
    this.depthRBO=gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRBO);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    this.depthW=w; this.depthH=h;
  },

  update(){ /* 時刻は render 内で参照 */ },

  // メッシュの形を変える param が動いたら (指を離して 6 フレーム止まってから) 頂点を作り直す
  _remesh(){
    const km=this._meshK(), sig=this._meshSig(km);
    if(sig===this._msig){ this._mpend=0; return; }
    if(sig!==this._mpendSig){ this._mpendSig=sig; this._mpend=0; return; }
    if(++this._mpend<6) return;
    const gl=this.gl, data=this._buildMesh(km);
    this._mk=km; this._msig=sig; this._Cb=this._derive(km); this._mpend=0;
    this.nVerts=data.length/11;
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  },

  render(opts){
    if(!this.ok) return;
    const gl=this.gl, { fbo, w, h, slot } = opts;
    const dark = !!(this.P && this.P.dark);
    const wire = dark || (slot === 'B');             // dark モード or Slot B = ワイヤーフレーム
    const t = (typeof opts.clock === 'number') ? opts.clock : (performance.now()/1000 - this.startTime);
    this._remesh();
    const dz=(v)=>this._dz(v), P=this.P;
    const kDist=dz(P.camDist)/100, kFov=dz(P.fovScale)/100, kSwing=dz(P.camSwing)/100, roll=dz(P.camRoll);

    // beat 同期: 拍ごとにカメラをわずかに引き寄せてパンチを出す(beat モード時のみ / drone では無反応)
    let beatPulse = 0.0;
    if(typeof App !== 'undefined' && App.beatMode === 'beat' && typeof BPM !== 'undefined' && BPM.beatCount){
      const bc = (typeof opts.beat === 'number') ? opts.beat
        : ((typeof App !== 'undefined' && App.visualBeat) ? App.visualBeat() : BPM.beatCount());
      beatPulse = Math.pow(1.0 - (bc - Math.floor(bc)), 3.0);   // 拍頭=1 → 減衰
    }

    // 自動公転カメラ(anon-press サイトの構図を再現: タワー内部から中央の柱・階段・周囲の棚を見る)
    //   radius 2.1〜3.5(WALL_R=4 の内側)/ 仰角を大きく上下スイング / 注視点は中心(0,0,0)固定 / 連続回転。
    const camAngle  = t*0.6 + Math.sin(t*0.23)*0.3;
    const camElev   = (Math.sin(t*0.31)*0.80 + Math.sin(t*0.53+1.7)*0.45 + Math.sin(t*0.13+3.1)*0.30 + Math.sin(t*0.89+0.5)*0.15) * kSwing;
    const camRadius = Math.max(2.7, Math.min(3.3, 3.0 + Math.sin(t*0.19+2.0)*0.35 + Math.sin(t*0.11)*0.18 + Math.sin(t*0.47+1.0)*0.10)) * (1.0 - beatPulse*0.06) * kDist;   // ズーム変動を穏やかに
    const camTargetY= dz(P.camHeight);
    const ce=Math.cos(camElev), se=Math.sin(camElev), ca=Math.cos(camAngle), sa=Math.sin(camAngle);
    const ex=camRadius*ce*ca, ey=camRadius*se+camTargetY, ez=camRadius*ce*sa;

    this._ensureDepth(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRBO);
    gl.viewport(0,0,w,h);

    if(wire){
      gl.clearColor(0.0,0.0,0.0,1.0);              // 背景透過なし(黒不透明)
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      if(dark) gl.clearColor(0.010,0.012,0.016,1.0);
      else gl.clearColor(0.97,0.97,0.96,1.0);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
      gl.disable(gl.BLEND);
    }
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const proj=this._perspective(this.fovY*kFov, w/h, 0.05, 80.0);
    const view=this._lookAt(ex,ey,ez, 0, camTargetY, 0);
    let mvp=this._mul(proj, view);
    if(roll !== 0){   // 画面の傾き (縦横比を保ったまま回す)
      const a=roll*Math.PI/180, c=Math.cos(a), sn=Math.sin(a), asp=w/h, R=new Float32Array(16);
      R[0]=c; R[1]=sn*asp; R[4]=-sn/asp; R[5]=c; R[10]=1; R[15]=1;
      mvp=this._mul(R, mvp);
    }

    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.locs.uMVP, false, mvp);
    gl.uniform3f(this.locs.uCam, ex,ey,ez);
    gl.uniform1f(this.locs.uDarkMode, dark ? 1.0 : 0.0);
    gl.uniform1f(this.locs.uWire, wire ? 1.0 : 0.0);
    gl.uniform1f(this.locs.uTime, t);
    gl.uniform3f(this.locs.uHelix, this._Cb.HELIX_R, this._Cb.HELIX_P, (Math.PI*2)/this._Cb.STEPS_N);
    gl.uniform1f(this.locs.uLightAz, dz(P.lightAz)); gl.uniform1f(this.locs.uLightElev, dz(P.lightElev));
    gl.uniform1f(this.locs.uKey, dz(P.keyLight)/100); gl.uniform1f(this.locs.uAmb, dz(P.ambient)/100);
    gl.uniform1f(this.locs.uGlow, dz(P.stairGlow)/100); gl.uniform1f(this.locs.uFogK, dz(P.fogDensity)/100);
    gl.uniform1f(this.locs.uSpine, dz(P.spineColors)/100);
    gl.drawArrays(gl.TRIANGLES, 0, this.nVerts);

    // 後始末(他パスへ影響させない)
    gl.bindVertexArray(null);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  }
};
