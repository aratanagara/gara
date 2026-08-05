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
  P:{ dark:false },

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

  _buildMesh(){
    const C=this.C, arr=[], TAU=Math.PI*2, PI=Math.PI;
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
          if(this._h1(bSeed+5.9)<0.07) pos += C.UNIT_W*(0.4+this._h1(bSeed+6.7)*0.4);
          if(pos>=colHW+0.05) break;
          const r_=this._h1(bSeed+3.1);
          const bw=C.UNIT_W*(0.32+r_*r_*0.78);
          const bH=0.30+this._h1(bSeed)*0.16;
          const bD=C.BOOK_D*(0.45+this._h1(bSeed+1.7)*0.55);
          const bCU=-bD*0.5-C.WALL_T, bCV=-C.SHELF_P*0.5+0.030+bH*0.5, bLW=pos+bw*0.5, bLA=bCU+C.WALL_R;
          this._addBox(arr, bLA*cosA-bLW*sinA, shelfCY+bCV, bLA*sinA+bLW*cosA, bD*0.5, bH*0.5, bw*0.5, rotY, 1);
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
out vec3 vNor; out float vMat; out float vDist; out float vWorldY; out vec3 vBary; out float vStepWave;
void main(){
  vMat=aMat; vBary=aBary;
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
in vec3 vNor; in float vMat; in float vDist; in float vWorldY; in vec3 vBary; in float vStepWave;
uniform float uDarkMode;
uniform float uWire;
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
  vec3 col=base*(diff*lightCol*1.05 + ambCol*0.30);
  col += mix(vec3(1.0,0.92,0.72)*0.30, vec3(0.55,0.38,0.18)*0.24, darkMode)*vStepWave; // 階段を上昇する暖色の光バンド
  vec3 darkBg=mix(vec3(0.06,0.06,0.07), vec3(0.010,0.012,0.016), darkMode);
  col=mix(col, darkBg, clamp((1.0-smoothstep(-14.0,8.0,vWorldY))*1.5, 0.0, 1.0));
  vec3 farBg=mix(vec3(0.97,0.97,0.96), vec3(0.070,0.066,0.060), darkMode);
  vec3 bg=mix(darkBg, farBg, smoothstep(-8.0,15.0,vWorldY));
  col=mix(col, bg, clamp((vDist-4.0)/7.0, 0.0, 1.0));
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
    const data=this._buildMesh();
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

  render(opts){
    if(!this.ok) return;
    const gl=this.gl, { fbo, w, h, slot } = opts;
    const dark = !!(this.P && this.P.dark);
    const wire = dark || (slot === 'B');             // dark モード or Slot B = ワイヤーフレーム
    const t = (typeof opts.clock === 'number') ? opts.clock : (performance.now()/1000 - this.startTime);

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
    const camElev   = Math.sin(t*0.31)*0.80 + Math.sin(t*0.53+1.7)*0.45 + Math.sin(t*0.13+3.1)*0.30 + Math.sin(t*0.89+0.5)*0.15;
    const camRadius = Math.max(2.7, Math.min(3.3, 3.0 + Math.sin(t*0.19+2.0)*0.35 + Math.sin(t*0.11)*0.18 + Math.sin(t*0.47+1.0)*0.10)) * (1.0 - beatPulse*0.06);   // ズーム変動を穏やかに
    const camTargetY= 0.0;
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

    const proj=this._perspective(this.fovY, w/h, 0.05, 80.0);
    const view=this._lookAt(ex,ey,ez, 0, camTargetY, 0);
    const mvp=this._mul(proj, view);

    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.locs.uMVP, false, mvp);
    gl.uniform3f(this.locs.uCam, ex,ey,ez);
    gl.uniform1f(this.locs.uDarkMode, dark ? 1.0 : 0.0);
    gl.uniform1f(this.locs.uWire, wire ? 1.0 : 0.0);
    gl.uniform1f(this.locs.uTime, t);
    gl.uniform3f(this.locs.uHelix, this.C.HELIX_R, this.C.HELIX_P, (Math.PI*2)/this.C.STEPS_N);
    gl.drawArrays(gl.TRIANGLES, 0, this.nVerts);

    // 後始末(他パスへ影響させない)
    gl.bindVertexArray(null);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  }
};
