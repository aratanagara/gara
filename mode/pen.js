/* =====================================================================
   Pen — 漫画付けペン 3D (kind:'pen')
   3D ベジェのペンストロークを 生成→伸長→保持→フェード のライフサイクルで
   ミター接合のリボンとして描画する WebGL エンジン。
   スタイル 0/1/2 (幅プロファイル) + カラーモード (mono / ランダム / 共有パレット)。
   カメラは自動回転。写真トレス機能は移植対象外。
   Dropbox/shader/pen/index.html から移植。
===================================================================== */
'use strict';

const Pen = {
  initialized:false,
  gl:null, prog:null, vbuf:null, LOC:null,
  W:0, H:0,
  strokes:[], clock:0, _last:0, _lastTick:null,
  _camTarget:null, _camFrom:null, _camDur:0, _camT:1,
  cam:{ rotX:0.10, rotY:0.0, zoom:1.0 },

  // パラメータ (元 index.html の P。photo 系は除外)
  P:{ count:100, width:1.0, peak:1.0, bleed:1.0, kasure:1.0, len:1.0, depth:0.35, speed:1.0,
      color:1 },   // 0=mono / 1=ランダムパレット / 2=共有パレット

  // 定数
  BLEED:1.52, SPHERE_R:500, STRIDE:5, CAM_DIST:1250, FOV:920,   // 球状ハコ(半径 SPHERE_R)。カメラは奥へ引き FOV で見かけ倍率を維持
  SUBBEAT:2,   // BPM 同期: 1 拍を何分割して spawn するか(2=8分)
  PALETTE_PERIOD:8.0,
  palA:null, palB:null, palPhase:0,

  PALETTES:[
    [[0.5,0.5,0.5],[0.5,0.5,0.5],[1.0,1.0,1.0],[0.0,0.33,0.67]],  // rainbow
    [[0.5,0.5,0.5],[0.5,0.5,0.5],[1.0,1.0,0.5],[0.8,0.9,0.3]],    // warm neon
    [[0.5,0.5,0.5],[0.5,0.5,0.5],[2.0,1.0,0.0],[0.5,0.2,0.25]],   // fire
    [[0.8,0.5,0.4],[0.2,0.4,0.2],[2.0,1.0,1.0],[0.0,0.25,0.25]],  // cool muted
    [[0.5,0.5,0.5],[0.5,0.5,0.5],[1.0,1.0,2.0],[0.0,0.33,0.67]],  // indigo/violet
    [[0.5,0.5,0.5],[0.5,0.5,0.5],[1.0,1.0,1.0],[0.3,0.2,0.2]],    // pastel
    [[0.5,0.5,0.5],[0.5,0.5,0.5],[0.5,0.5,0.5],[0.5,0.5,0.5]],    // greyscale
    [[0.5,0.5,0.5],[0.4,0.4,0.4],[1.0,1.0,1.0],[0.0,0.1,0.2]],    // dark blue
  ],

  VS:`
precision highp float;
attribute vec2  a_pos;
attribute vec2  a_uv;
attribute float a_alpha;
varying   vec2  v_uv;
varying   float v_alpha;
void main(){
  gl_Position = vec4(a_pos,0.0,1.0);
  v_uv = a_uv; v_alpha = a_alpha;
}`,

  FS:`
precision highp float;
varying vec2  v_uv;
varying float v_alpha;
uniform vec3  u_ink;
uniform float u_seed;
uniform float u_kasure;
uniform float u_style;
uniform float u_brot;
uniform float u_bleed;
uniform float u_colorMode;
uniform float u_cosPhase;
uniform vec3  u_cosA;
uniform vec3  u_cosB;
uniform vec3  u_cosC;
uniform vec3  u_cosD;

vec3 cosinePalette(float t){
  return clamp(u_cosA + u_cosB * cos(6.28318*(u_cosC*t + u_cosD)), 0.0, 1.0);
}
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
             mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float brushRadius(float theta, float seed, float bleed){
  vec2 p1 = vec2(cos(theta*1.0), sin(theta*1.0)) * 2.1 + seed*vec2(0.37,1.19);
  vec2 p2 = vec2(cos(theta*3.0), sin(theta*3.0)) * 1.4 + seed*vec2(1.81,0.63);
  vec2 p3 = vec2(cos(theta*8.0), sin(theta*8.0)) * 0.8 + seed*vec2(3.14,2.71);
  float n = vnoise(p1)*0.50 + vnoise(p2)*0.32 + vnoise(p3)*0.18;
  float lumpAmp = 0.38 * bleed;
  return clamp(1.0 - lumpAmp*0.28 + n*lumpAmp*1.56, 0.40, 1.60);
}
void main(){
  float u = v_uv.x;
  float v = v_uv.y;
  float dist = abs(v);
  float theta = u_brot + u*3.14159 + v*1.5708;
  float bRad = brushRadius(theta, u_seed, u_bleed);
  if(u_style > 1.5){
    float ep = max(smoothstep(0.12,0.0,u), smoothstep(0.88,1.0,u));
    bRad = clamp(bRad + ep*0.28*u_bleed, 0.40, 1.65);
  }
  float strokeMask = step(dist, bRad);
  float cr=cos(u_brot), sr=sin(u_brot);
  vec2 kUV = vec2(cr*u - sr*v*0.5, sr*u + cr*v*0.5);
  float kNoise = vnoise(kUV*vec2(9.0,5.5)+u_seed*3.1)*0.60
               + vnoise(kUV*vec2(21.0,13.0)+u_seed*7.7)*0.40;
  float edgeProx  = dist / max(bRad, 0.01);
  float kThresh   = u_kasure * 0.52 * smoothstep(0.15, 1.0, edgeProx);
  float kasureMask = step(kThresh, kNoise);
  float alpha = strokeMask * kasureMask * v_alpha;
  if(alpha < 0.004) discard;

  vec3 col;
  if(u_colorMode > 0.5){
    float t = u_cosPhase + u*0.72;   // fract しない: cos は連続なので継ぎ目(白→黒の急変)が出ない
    col = cosinePalette(t);
    col *= 0.75 + 0.25*(1.0 - edgeProx*0.4);
  } else {
    col = u_ink;
  }
  gl_FragColor = vec4(col, alpha);
}`,

  _mkShader(gl, type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if(!__glReady(gl, s, false)) console.error('Pen', type===gl.VERTEX_SHADER?'VS':'FS', gl.getShaderInfoLog(s));
    return s;
  },

  init(gl){
    if(this.initialized) return true;
    this.gl = gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, this._mkShader(gl, gl.VERTEX_SHADER, this.VS));
    gl.attachShader(prog, this._mkShader(gl, gl.FRAGMENT_SHADER, this.FS));
    gl.linkProgram(prog);
    if(!__glReady(gl, prog, true)){ console.error('Pen link:', gl.getProgramInfoLog(prog)); return false; }
    this.prog = prog;
    this.LOC = {
      pos:       gl.getAttribLocation(prog,  'a_pos'),
      uv:        gl.getAttribLocation(prog,  'a_uv'),
      alpha:     gl.getAttribLocation(prog,  'a_alpha'),
      ink:       gl.getUniformLocation(prog, 'u_ink'),
      seed:      gl.getUniformLocation(prog, 'u_seed'),
      kasure:    gl.getUniformLocation(prog, 'u_kasure'),
      style:     gl.getUniformLocation(prog, 'u_style'),
      brot:      gl.getUniformLocation(prog, 'u_brot'),
      bleed:     gl.getUniformLocation(prog, 'u_bleed'),
      colorMode: gl.getUniformLocation(prog, 'u_colorMode'),
      cosPhase:  gl.getUniformLocation(prog, 'u_cosPhase'),
      cosA:      gl.getUniformLocation(prog, 'u_cosA'),
      cosB:      gl.getUniformLocation(prog, 'u_cosB'),
      cosC:      gl.getUniformLocation(prog, 'u_cosC'),
      cosD:      gl.getUniformLocation(prog, 'u_cosD'),
    };
    this.vbuf = gl.createBuffer();
    this._last = performance.now();
    this.strokes = [];
    for(let i=0;i<this.P.count;i++) this.strokes.push(this.makeRandomStroke(-this._rand(0,1.5)));
    this.initialized = true;
    return true;
  },

  // ── helpers ──
  _rand(a,b){ return a + Math.random()*(b-a); },
  _bez3d(p0,p1,p2,p3,t){
    const m=1-t;
    return [
      m*m*m*p0[0]+3*m*m*t*p1[0]+3*m*t*t*p2[0]+t*t*t*p3[0],
      m*m*m*p0[1]+3*m*m*t*p1[1]+3*m*t*t*p2[1]+t*t*t*p3[1],
      m*m*m*p0[2]+3*m*m*t*p1[2]+3*m*t*t*p2[2]+t*t*t*p3[2],
    ];
  },
  _ballPoint(R){   // 球内一様(方向=球面一様 / 半径=cbrt で体積一様)。ストローク中心の球状配置用。
    const u=this._rand(-1,1), th=this._rand(0,Math.PI*2), r=R*Math.cbrt(Math.random()), s=Math.sqrt(1-u*u);
    return [r*s*Math.cos(th), r*s*Math.sin(th), r*u];
  },
  _catmullRom(P, segs){   // 経由点 P を通る Catmull-Rom スプラインを segs+1 点にサンプル(多段カーブ用)
    const n=P.length, get=i=>P[Math.max(0,Math.min(n-1,i))], out=[];
    for(let s=0;s<=segs;s++){
      const u=s/segs*(n-1), i=Math.min(n-2, Math.floor(u)), t=u-i, t2=t*t, t3=t2*t;
      const p0=get(i-1), p1=get(i), p2=get(i+1), p3=get(i+2), c=[];
      for(let d=0;d<3;d++) c[d]=0.5*((2*p1[d]) + (-p0[d]+p2[d])*t + (2*p0[d]-5*p1[d]+4*p2[d]-p3[d])*t2 + (-p0[d]+3*p1[d]-3*p2[d]+p3[d])*t3);
      out.push(c);
    }
    return out;
  },
  _pickPalette(){ return this.PALETTES[Math.floor(this._rand(0, this.PALETTES.length-0.01))]; },
  _lerpPalette(pa,pb,t){ return pa.map((row,i)=>row.map((v,j)=>v+(pb[i][j]-v)*t)); },
  _ensureSharedPalettes(){ if(!this.palA){ this.palA=this._pickPalette(); this.palB=this._pickPalette(); this.palPhase=0; } },
  _currentSharedPalette(){
    this._ensureSharedPalettes();
    const t = Math.min(this.palPhase/this.PALETTE_PERIOD, 1.0);
    const eased = t*t*(3-2*t);
    return this._lerpPalette(this.palA, this.palB, eased);
  },

  // ── camera ──
  _toView(p){
    const px=p[0],py=p[1],pz=p[2], c=this.cam;
    const cy=Math.cos(c.rotY), sy=Math.sin(c.rotY);
    const x1= px*cy + pz*sy;
    const z1=-px*sy + pz*cy;
    const cx=Math.cos(c.rotX), sx=Math.sin(c.rotX);
    const y2= py*cx - z1*sx;
    const z2= py*sx + z1*cx;
    return [x1, y2, z2 + this.CAM_DIST / c.zoom];
  },
  _proj(vp){
    const vz=vp[2];
    if(vz < 1.0) return null;
    const d=this.FOV/vz;
    return [vp[0]*d/(this.W*0.5), vp[1]*d/(this.H*0.5)];
  },

  makeRandomStroke(born){
    const P=this.P, rand=(a,b)=>this._rand(a,b);
    const penType = Math.random() < 0.60 ? 'milli' : 'gpen';   // 細いミリペン(松本大洋風ダマ)多め / G ペン
    const style = penType==='milli' ? 0 : (Math.random()<0.5 ? 0 : 2);   // FS エッジ質感: gpen は 0/2 で変化 / milli は 0(クリーン)
    const pathType = Math.random() < P.depth ? 'depth' : 'arc';

    let p0,p1,p2,p3;
    const lenScale = P.len;

    if(pathType === 'depth'){
      const ctr=this._ballPoint(this.SPHERE_R);
      const cx=ctr[0], cy=ctr[1], startZ=ctr[2];
      const len=rand(400,900)*lenScale;
      const tiltX=rand(-.5,.5), tiltY=rand(-.5,.5);
      const norm=Math.sqrt(tiltX*tiltX+tiltY*tiltY+1);
      const axX=tiltX/norm, axY=tiltY/norm, axZ=1/norm;
      p0=[cx-axX*len*.5, cy-axY*len*.5, startZ-axZ*len*.5];
      p3=[cx+axX*len*.5, cy+axY*len*.5, startZ+axZ*len*.5];
      const sx=rand(-200,200), sy=rand(-200,200);
      p1=[p0[0]+(p3[0]-p0[0])*.25+sx, p0[1]+(p3[1]-p0[1])*.25+sy, p0[2]+(p3[2]-p0[2])*.25];
      p2=[p0[0]+(p3[0]-p0[0])*.75-sx, p0[1]+(p3[1]-p0[1])*.75-sy, p0[2]+(p3[2]-p0[2])*.75];
    } else {
      const ctr=this._ballPoint(this.SPHERE_R);
      const cx=ctr[0], cy=ctr[1], cz=ctr[2];
      const len=rand(500,1100)*lenScale;
      const ang=rand(0,Math.PI*2);
      const cos=Math.cos(ang), sin=Math.sin(ang);
      const px=-sin, py=cos;
      const cv=rand(120,340)*(Math.random()<.5?1:-1);
      const zb=rand(60,180)*(Math.random()<.5?1:-1);
      p0=[cx-cos*len*.50,           cy-sin*len*.50,           cz   ];
      p1=[cx-cos*len*.13+px*cv*.90, cy-sin*len*.13+py*cv*.90, cz+zb];
      p2=[cx+cos*len*.13+px*cv*.90, cy+sin*len*.13+py*cv*.90, cz-zb];
      p3=[cx+cos*len*.50,           cy+sin*len*.50,           cz   ];
    }

    // 長さに応じた適応分割(短い線は少なく=軽量化)。多段カーブは多め。300固定をやめ平均を大幅減。
    const rawLen = Math.hypot(p3[0]-p0[0], p3[1]-p0[1], p3[2]-p0[2]);
    const multi = Math.random() < 0.22;
    const SEG = Math.max(40, Math.min(160, Math.round(rawLen/8 * (multi?1.4:1))));
    let pts;
    if(multi){
      // たまに二、三段構えのカーブ: p0→p3 の間に振れ点を作り Catmull-Rom で通す(S字/ジグザグ)。
      const nBend = 2 + Math.floor(Math.random()*2);           // 2 or 3 段
      const ax=[p3[0]-p0[0], p3[1]-p0[1], p3[2]-p0[2]];
      const ref=this._ballPoint(1);                            // 適当な参照方向
      let px=ax[1]*ref[2]-ax[2]*ref[1], py=ax[2]*ref[0]-ax[0]*ref[2], pz=ax[0]*ref[1]-ax[1]*ref[0];
      const pl=Math.hypot(px,py,pz)||1; px/=pl; py/=pl; pz/=pl;   // 主軸に垂直な単位ベクトル
      const amp=rand(150,360);
      const way=[p0];
      for(let k=1;k<=nBend;k++){
        const f=k/(nBend+1), sgn=(k%2? 1 : -1);
        const bx=p0[0]+ax[0]*f, by=p0[1]+ax[1]*f, bz=p0[2]+ax[2]*f;
        const j3=this._ballPoint(60);                          // 微小な 3D ゆらぎ
        way.push([bx+px*amp*sgn+j3[0], by+py*amp*sgn+j3[1], bz+pz*amp*sgn+j3[2]]);
      }
      way.push(p3);
      pts = this._catmullRom(way, SEG);
    } else {
      pts=[];
      for(let i=0;i<=SEG;i++) pts.push(this._bez3d(p0,p1,p2,p3, i/SEG));
    }

    // ── 線幅は指数分布(密度 ∝ e^(-λw)、太いほど加速度的に少なく)。[lo,hi] で切断逆関数サンプリング。
    const _expW = (lo, hi, lam) => { const em = 1 - Math.exp(-lam*(hi-lo)); return lo - Math.log(1 - Math.random()*em)/lam; };
    const baseMax = (penType==='milli'
      ? _expW(0.5, 2.8, 1.4)     // 0.5〜2.8
      : _expW(0.8, 12.0, 0.6)    // 0.8〜12.0(指数分布。細主体で稀に太い)
    ) * P.width;
    // 幅のジャンプ(段差): ジャンプ率で 0〜3 段。各ジャンプ点で太さが別レベルへ跳ぶ(細い線の中に急な太細)。
    const jN = Math.random() < 0.55 ? (1 + Math.floor(Math.random()*3)) : 0;
    const jArr=[]; for(let j=0;j<jN;j++) jArr.push({ t:rand(0.12,0.88), mul:rand(0.35,2.1) }); jArr.sort((a,b)=>a.t-b.t);
    const jumpMul = t => { let m=1; for(const jp of jArr){ if(t>=jp.t) m=jp.mul; } return m; };
    const taperT = Math.max(0, Math.min(1, (rawLen - 300) / 800));
    let widthAt;
    if(penType === 'milli'){
      // 松本大洋風ミリペン: 細い等幅 + うねり + ダマ(インク溜まりのコブ)。
      const wob=rand(0.05,0.16), f=rand(2,5), ph=rand(0,Math.PI*2);
      const blobN=Math.floor(rand(1,5)), blobs=[];
      for(let b=0;b<blobN;b++) blobs.push({ tc:rand(0.08,0.92), amp:rand(0.5,1.6), sig:rand(0.012,0.045) });
      const eLen=0.06;   // 端を軽く尖らせる(ハードカット回避)。線形テーパー。
      widthAt = t => {
        const endT = Math.min(t/eLen, (1-t)/eLen, 1);
        let w = baseMax * (0.82 + wob*Math.sin(t*Math.PI*f + ph));
        for(const b of blobs){ const d=(t-b.tc)/b.sig; w += baseMax*b.amp*Math.exp(-d*d); }   // ダマ
        return w * endT;
      };
    } else {
      // G ペン: 入り/抜きは線形ランプ(二次関数的な急激さをやめ、一定率で増減)。抜きは入りよりやや短め。
      const entryLen = 0.22 + 0.16*taperT;
      const exitLen  = 0.18 + 0.14*taperT;
      const swellAmt = Math.min(0.6, (0.05 + rand(0, 0.12)) * P.peak);  // 中央膨らみは控えめ(中央が山にならないように)
      widthAt = t => {
        const inT  = Math.min(t / entryLen, 1.0);          // 線形に増加
        const outT = Math.min((1 - t) / exitLen, 1.0);     // 線形に減少
        const swell = (1.0 - swellAmt) + swellAmt * Math.sin(Math.PI * Math.pow(t, 0.85));
        return baseMax * swell * Math.min(inT, outT);
      };
    }
    const _baseW = widthAt; widthAt = t => _baseW(t) * jumpMul(t);   // 幅ジャンプを合成(端はテーパーで≈0のまま)
    // リボンの向き (3D): ストロークごとにランダムな単位ベクトル。これに沿って平たいリボンを張る
    // → カメラ回転で edge-on になると細くなる(円柱状にならず、平たいリボンに見える)。
    const _bt=rand(0,Math.PI*2), _bp=Math.acos(rand(-1,1));
    const ribbonB=[Math.sin(_bp)*Math.cos(_bt), Math.sin(_bp)*Math.sin(_bt), Math.cos(_bp)];

    const N=SEG*2, cum=[0];
    for(let i=1;i<=N;i++){
      const p = Math.min(widthAt(i/N)/Math.max(baseMax,0.01), 1.0);
      cum.push(cum[i-1] + (0.18+0.82*p)/N);
    }
    const total=cum[N];
    const prog2t = (prog)=>{
      const tgt=prog*total; let lo=0, hi=N;
      while(lo<hi-1){ const m=(lo+hi)>>1; cum[m]<tgt?lo=m:hi=m; }
      return (lo+(tgt-cum[lo])/(cum[hi]-cum[lo]+1e-12))/N;
    };

    const drawMult = style===2 ? rand(1.3,1.9) : 1.0;
    const sSpd = rand(0.7, 3.2);                              // ストロークごとに速度を大きくばらつかせる
    const spd = 1.0/(Math.max(P.speed,0.05) * sSpd);         // sSpd 大 = 速い(duration 短い)。全体的に速め。
    const drawDur=rand(0.35,1.4)*drawMult*spd, holdDur=rand(.12,.7)*spd, fadeDur=rand(.22,.7)*spd;
    const lifespan=drawDur+holdDur+fadeDur;

    const dark=rand(0.0,0.04);
    const ink=[dark+rand(0,.015), dark+rand(0,.010), dark+rand(0,.018)];

    // ミリペンは実線(かすれ少・エッジきれい) / G ペンは かすれ&エッジ変化あり
    const kasure = (penType==='milli' ? rand(.0,.12) : rand(.24,.58)) * P.kasure;
    const bleedVal = (penType==='milli' ? 0.35 : 1.0) * P.bleed;
    const seed=rand(0,100), brot=rand(0,Math.PI*2);
    const cosPhase=rand(0,1);
    const pal = (P.color===2) ? this._currentSharedPalette() : this._pickPalette();

    return { pts, segs:SEG, widthAt, prog2t, ribbonB, born, drawDur, holdDur, fadeDur, lifespan, ink, kasure, seed, style, brot, bleedVal, cosPhase, cosA:pal[0], cosB:pal[1], cosC:pal[2], cosD:pal[3] };
  },

  _buildBuffer(s, time){
    const SEGS=s.segs, BLEED=this.BLEED;
    const age=time-s.born;
    if(age<0 || age>s.lifespan) return null;
    const drawProg=Math.min(1.0, age/s.drawDur);
    const fadeStart=s.drawDur+s.holdDur;
    const fadeProg=age>fadeStart?(age-fadeStart)/s.fadeDur:0;
    const baseA=(1.0-Math.min(1,fadeProg))*0.97;
    const tMax=s.prog2t(drawProg);
    const visSeg=Math.floor(tMax*SEGS);
    if(visSeg<1) return null;
    const segEnd=Math.min(visSeg, SEGS-1);
    const pts=s.pts, B=s.ribbonB;

    // 各点で 3D の幅方向(接線に直交し、リボン面 B に沿う)を求め、両縁を 3D 空間で押し出してから投影。
    // → リボンが edge-on のとき両縁が近づいて細く見える(平たいリボン=常時正対の円柱状にならない)。
    const Lc=[], Rc=[], av=[];
    for(let i=0;i<=segEnd;i++){
      const a=pts[i>0?i-1:0], b=pts[i<SEGS?i+1:SEGS];
      let tx=b[0]-a[0], ty=b[1]-a[1], tz=b[2]-a[2];
      const tl=Math.hypot(tx,ty,tz)||1; tx/=tl; ty/=tl; tz/=tl;
      const dot=B[0]*tx+B[1]*ty+B[2]*tz;
      let wx=B[0]-tx*dot, wy=B[1]-ty*dot, wz=B[2]-tz*dot;
      let wl=Math.hypot(wx,wy,wz);
      if(wl<1e-4){ wx=-tz; wy=0; wz=tx; wl=Math.hypot(wx,wy,wz)||1; }   // 退化(B∥T)時: T×(0,1,0)
      wx/=wl; wy/=wl; wz/=wl;
      const w=s.widthAt(i/SEGS)*BLEED, c=pts[i];
      Lc.push(this._proj(this._toView([c[0]-wx*w, c[1]-wy*w, c[2]-wz*w])));
      Rc.push(this._proj(this._toView([c[0]+wx*w, c[1]+wy*w, c[2]+wz*w])));
      const isTip=(i===visSeg-1 && drawProg<1.0);
      av.push(baseA*(isTip?(tMax*SEGS-i):1.0));
    }

    const data=[];
    for(let i=0;i<segEnd;i++){
      const l0=Lc[i], r0=Rc[i], l1=Lc[i+1], r1=Rc[i+1];
      if(!l0||!r0||!l1||!r1) continue;
      const tA=i/SEGS, tB=(i+1)/SEGS, a0=av[i], a1=av[i+1];
      // 平たいリボン (2 三角形)。UV v: 左縁=-BLEED / 右縁=+BLEED (FS のブラシ/かすれ用)
      data.push(l0[0],l0[1],tA,-BLEED,a0,  r0[0],r0[1],tA,BLEED,a0,  l1[0],l1[1],tB,-BLEED,a1);
      data.push(r0[0],r0[1],tA,BLEED,a0,   r1[0],r1[1],tB,BLEED,a1,  l1[0],l1[1],tB,-BLEED,a1);
    }
    return data.length ? new Float32Array(data) : null;
  },

  update(beatCount){
    const now=performance.now();
    let dt=(now-this._last)/1000; this._last=now;
    if(!(dt>0) || dt>0.1) dt=0.016;   // タブ復帰時などの巨大 dt を抑制
    this.clock += dt;
    if(this.P.color===2){
      this.palPhase += dt;
      if(this.palPhase >= this.PALETTE_PERIOD){ this.palA=this.palB; this.palB=this._pickPalette(); this.palPhase=0; }
    }
    // カメラ自動回転 (ドラッグ操作の代わり)
    // カメラ: 球のランダムな表面地点へ移動(easeInOut で緩急=各点付近で減速→次点へ加速)。
    if(this._camTarget == null || this._camT >= 1){
      this._camFrom = { x:this.cam.rotX, y:this.cam.rotY };
      this._camTarget = { x: this._rand(-1.15, 1.15),                        // 緯度(gimbal 回避のためクランプ)
                          y: this.cam.rotY + this._rand(-Math.PI, Math.PI) }; // 経度(相対で最大 ±180°)
      this._camDur = this._rand(0.9, 2.8);                                   // 移動時間のばらつき=緩急/ペース
      this._camT = 0;
    }
    this._camT += dt / this._camDur;
    const tt = Math.min(1, this._camT);
    const e = tt<0.5 ? 2*tt*tt : 1 - Math.pow(-2*tt+2, 2)/2;                 // easeInOutQuad
    this.cam.rotX = this._camFrom.x + (this._camTarget.x - this._camFrom.x)*e;
    this.cam.rotY = this._camFrom.y + (this._camTarget.y - this._camFrom.y)*e;
    // BPM 同期: sub-beat tick ごとに、寿命切れストロークを一斉に born(ビートに乗って現れる)。
    // 呼び出し側から beat ×A を反映済みの visual beat が渡る。
    const beat = (typeof beatCount === 'number') ? beatCount
      : ((typeof App !== 'undefined' && App.visualBeat) ? App.visualBeat() : ((typeof BPM!=='undefined' && BPM.beatCount) ? BPM.beatCount() : this.clock*2.0));
    const tick = Math.floor(beat * this.SUBBEAT);
    if(this._lastTick == null) this._lastTick = tick;
    const n=Math.min(this.strokes.length, this.P.count);
    if(tick !== this._lastTick){
      this._lastTick = tick;
      for(let i=0;i<n;i++){ const s=this.strokes[i]; if(!s || this.clock-s.born > s.lifespan) this.strokes[i]=this.makeRandomStroke(this.clock); }
    }
  },

  _drawStroke(s){
    const gl=this.gl, L=this.LOC;
    const data=this._buildBuffer(s, this.clock);
    if(!data) return;
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.uniform3fv(L.ink, s.ink);
    gl.uniform1f(L.seed, s.seed);
    gl.uniform1f(L.kasure, s.kasure);
    gl.uniform1f(L.style, s.style);
    gl.uniform1f(L.brot, s.brot);
    gl.uniform1f(L.bleed, s.bleedVal);
    gl.uniform1f(L.colorMode, this.P.color>0 ? 1.0 : 0.0);
    gl.uniform1f(L.cosPhase, s.cosPhase);
    gl.uniform3fv(L.cosA, s.cosA);
    gl.uniform3fv(L.cosB, s.cosB);
    gl.uniform3fv(L.cosC, s.cosC);
    gl.uniform3fv(L.cosD, s.cosD);
    gl.drawArrays(gl.TRIANGLES, 0, data.length/this.STRIDE);
  },

  render(opts){
    if(!this.initialized) return;
    const gl=this.gl, { fbo, w, h, slot }=opts;
    this.W=w; this.H=h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0,0,w,h);
    if(gl.bindVertexArray) gl.bindVertexArray(null);   // 既存 VAO を汚さない
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    if(slot === 'B'){
      // Slot B: 背景透明。ストロークだけを A の上に重ねる(合成側は cb.a<1 でアルファ合成)。
      // アルファは別式で正しく蓄積(over 合成)。
      if(gl.blendFuncSeparate) gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
    } else {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0xdd/255, 0xdd/255, 0xdd/255, 1.0);   // 紙(ライトグレー)
    }
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbuf);
    gl.enableVertexAttribArray(this.LOC.pos);
    gl.enableVertexAttribArray(this.LOC.uv);
    gl.enableVertexAttribArray(this.LOC.alpha);
    gl.vertexAttribPointer(this.LOC.pos,  2, gl.FLOAT, false, 20, 0);
    gl.vertexAttribPointer(this.LOC.uv,   2, gl.FLOAT, false, 20, 8);
    gl.vertexAttribPointer(this.LOC.alpha,1, gl.FLOAT, false, 20, 16);

    const n=Math.min(this.strokes.length, this.P.count);
    for(let i=0;i<n;i++){ const s=this.strokes[i]; if(s) this._drawStroke(s); }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
};
