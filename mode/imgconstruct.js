'use strict';
/* Image Construct: folder images on FUDE's constructivist layouts and isometric faces.
   Layout algorithms live in ConstructLayout / TDCanvas.LAYOUTS, never in this engine.
   Texture residency is bounded (48 images / 16M pixels); loading is three-wide and
   obsolete loads cannot populate a newly selected folder. No media enters saved P. */
const ImageConstruct = {
  initialized:false, overscan:true, gl:null, prog:null, vao:null, vbo:null,
  textures:[], _urls:[], _folderSig:'', _loadToken:0, _loading:false,
  _states:{}, _revision:0, _aspect:16/9, _indexReady:false,
  P:{
    folder:'', look:0, lookAuto:0, lookEvery:16,
    pattern:0, angleSys:0, projection:1, faces:0,
    count:12, size:65, contrast:110, aspect:140,
    cvAngle:0, cvSnap:1, cvMirror:0, cvSpread:100, cvOffX:0, cvOffY:0,
    fit:0, padding:3, mat:1, frame:0.8,
    bg:[0.94,0.91,0.84], paper:[0.98,0.96,0.9], frameColor:[0.12,0.12,0.12],
    timing:0, noteWrite:1, noteHold:8, depth:100, depth3D:1,
  },
  // Empty folder is the factory sentinel: first real folder once the index arrives,
  // images/photo if the index is empty. Explicit saved folder selections always win.
  _angleStep: ConstructLayout._angleStep,
  _dz(v){ return typeof App !== 'undefined' && App.deadParam ? App.deadParam(+v || 0) : (+v || 0); },
  _num(key, min, max){ const v=+this.P[key]; return Math.max(min, Math.min(max, Number.isFinite(v) ? v : this.PDefaults[key])); },
  folders(){ return typeof ImageMode !== 'undefined' ? ImageMode.folders.filter(f=>f && !f.single) : []; },
  _url(path){ return String(path).split('/').map(encodeURIComponent).join('/'); },
  async loadFolders(force){
    if(typeof ImageMode !== 'undefined') await ImageMode.loadFolderIndex(force);
    const first = !this._indexReady;
    this._indexReady = true;
    if(!this.P.folder) this.P.folder = (this.folders()[0] || {}).dir || 'images/photo';
    this._syncFolder(!!force || first);
    this._refreshUI();
  },
  _refreshUI(){
    if(!this._bShift && typeof UI !== 'undefined' && UI.refreshImageConstructParams && typeof App !== 'undefined' && GL.slots[App.activeSlot]?.kind === 'imgconstruct') UI.refreshImageConstructParams();
  },
  _syncFolder(force){
    if(!this.gl) return;
    if(!this.P.folder && this._indexReady) this.P.folder=(this.folders()[0] || {}).dir || 'images/photo';
    const dir = this.P.folder;
    if(!dir) return;
    const f = this.folders().find(f=>f.dir === dir);
    const count = f ? (f._urls || f.images || []).length : 0;
    if(!force && this._sourceDir===dir && this._sourceFolder===f && this._sourceCount===count) return;
    this._sourceDir=dir; this._sourceFolder=f; this._sourceCount=count;
    const urls = f ? (f._urls ? f._urls.slice() : (f.images || []).map(n=>typeof ImageMode.imageURL === 'function' ? ImageMode.imageURL(f,n) : this._url(dir + '/' + n))) : [];
    // Array contents can change after import/delete without replacing the folder object.
    const sig = JSON.stringify([dir, urls]);
    if(!force && this._folderSig === sig) return;
    this._folderSig = sig;
    this._urls = urls;
    this._poolOffset = 0; this._poolPlaced=0; this._imageCursor=0;
    this.restart();
    if(f){ this._loadPool(); return; }
    this._releaseTextures(); this._loading=false;
    const token = ++this._loadToken;
    if(!this._indexReady) return;
    // A fresh/static site may have a manifest but no folder index. Never fetch a
    // disappeared temporary folder; those blob URLs are owned/revoked by ImageMode.
    if(dir.startsWith('images/') && this.folders().length === 0){
      fetch(this._url(dir) + '/manifest.json', {cache:'no-store'}).then(r=>r.ok ? r.json() : []).then(names=>{
        if(token !== this._loadToken || this.P.folder !== dir) return;
        this._urls = Array.isArray(names) ? names.filter(n=>typeof n === 'string').map(n=>this._url(dir + '/' + n)) : [];
        this._loadPool();
      }).catch(()=>{ if(token === this._loadToken){ this._loading=false; this._refreshUI(); } });
    }
  },
  _releaseTextures(){
    if(this.gl) for(const t of this.textures) if(t) this.gl.deleteTexture(t.tex);
    this.textures=[];
  },
  async _loadPool(){
    const token=++this._loadToken, gl=this.gl;
    this._releaseTextures();
    const n=Math.min(48, this._urls.length), cap=Math.min(1024, Math.floor(Math.sqrt(16e6/Math.max(1,n))));
    const urls=Array.from({length:n}, (_,i)=>this._urls[(i+(this._poolOffset || 0))%this._urls.length]);
    this._loading=!!n;
    let next=0;
    const worker=async()=>{
      while(next<n && token===this._loadToken){
        const i=next++, url=urls[i];
        await new Promise(resolve=>{
          const img=new Image();
          img.onload=()=>{
            if(token!==this._loadToken){ resolve(); return; }
            let tex=null;
            try{
              const scale=Math.min(1,cap/Math.max(img.naturalWidth,img.naturalHeight));
              const canvas=document.createElement('canvas');
              canvas.width=Math.max(1,Math.round(img.naturalWidth*scale)); canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
              canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
              tex=gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,tex);
              gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
              gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
              gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
              gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
              gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
              this.textures[i]={tex,aspect:img.naturalWidth/img.naturalHeight};
              canvas.width=canvas.height=0;
            }catch(e){ if(tex) gl.deleteTexture(tex); console.warn('Image Construct: image unavailable', e); }
            resolve();
          };
          img.onerror=()=>resolve(); img.src=url;
        });
      }
    };
    await Promise.all([worker(),worker(),worker()]);
    if(token===this._loadToken){ this.textures=this.textures.filter(Boolean); this._loading=false; this.restart(); this._refreshUI(); }
  },
  applyLook(index){
    const i=Math.max(0,Math.min(this.LOOKS.length-1,Math.round(index))), look=this.LOOKS[i];
    Object.assign(this.P,JSON.parse(JSON.stringify(look.p)),{look:i});
    this.restart(); this._refreshUI();
  },
  randomLook(){
    const n=this.LOOKS.length, old=Math.round(+this.P.look || 0);
    this.applyLook((old+1+Math.floor(Math.random()*(n-1)))%n);
  },
  restart(){ this._states={}; this._cleared=null; this._revision++; },
  clear(){ this.restart(); this._cleared={A:true,B:true}; },
  applyP(){ this.restart(); },
  makePlan(){
    const P=this.P, pattern=ConstructLayout.PATTERNS[Math.round(this._num('pattern',0,7))];
    const types=pattern[1], type=types[Math.floor(Math.random()*types.length)];
    const n=Math.round(this._num('count',1,48));
    const gen=type==='constructivist' ? ConstructLayout.axis : TDCanvas.LAYOUTS[type];
    const plan=gen(n,this._angleStep()).slice(0,n);
    if(type!=='constructivist') ConstructLayout._cvConstructivize.call(this,plan,type);
    const adj={P:{cvAngle:this._dz(P.cvAngle),cvSpread:this._dz(P.cvSpread)/100,cvOffX:this._dz(P.cvOffX)/100,cvOffY:this._dz(P.cvOffY)/100,
      cvSnap:P.cvSnap===2 ? 4 : P.cvSnap ? (this._angleStep()===30 ? 2 : 3) : 0,cvMirror:P.cvMirror},_aspect:this._aspect};
    ConstructLayout._cvAdjust.call(adj,plan);
    if(P.projection){
      ConstructLayout._cvIso.call(this,plan);
      const sets=[['t','l','r'],['t'],['l'],['r'],['l','r'],['t','l'],['t','r']];
      const faces=sets[Math.round(this._num('faces',0,6))];
      // Mixed presets guarantee all requested room faces, even for a small count.
      plan.forEach((o,i)=>{o.face=faces[i%faces.length];});
    }
    const pool=Math.max(1,this.textures.length), first=(this._imageCursor || 0)%pool;
    this._imageCursor=(first+n)%pool;
    const big=plan.reduce((b,o,i)=>o.s>plan[b].s ? i : b,0), contrast=this._dz(P.contrast)/100;
    plan.forEach((o,i)=>{
      o.s=Math.max(0.015,o.s*this._dz(P.size)/100*(i===big ? 1+contrast*0.3 : 1/(1+contrast*0.6)));
      o.tex=(first+i)%pool; o.z=0.65-i/Math.max(1,n)*0.3;
    });
    plan.type=type;
    return plan;
  },
  _time(beat,clock){
    const mode=typeof App !== 'undefined' ? App.beatMode : 'beat';
    const bpm=typeof BPM !== 'undefined' ? BPM.bpm : 120;
    return mode==='beat' && Number.isFinite(beat) ? beat : (Number.isFinite(clock) ? clock : 0)*6*bpm/120;
  },
  step({slot='A',beat=0,clock=0}){
    const t=this._time(beat,clock), P=this.P;
    const signature=()=>JSON.stringify([P.pattern,P.angleSys,P.projection,P.faces,P.count,P.size,P.contrast,P.aspect,P.cvAngle,P.cvSnap,P.cvMirror,P.cvSpread,P.cvOffX,P.cvOffY,P.timing,P.noteWrite,P.noteHold,this._aspect]);
    const sig=signature();
    let s=this._states[slot];
    if(!s || s.sig!==sig || t<s.last){ s=this._states[slot]={sig,start:t,last:t,auto:t,plan:this.makePlan()}; }
    if(P.lookAuto && t-s.auto>=Math.max(0.125,+P.lookEvery || 1)){
      this.randomLook();
      s=this._states[slot]={sig:signature(),start:t,last:t,auto:t,plan:this.makePlan()};
    }
    s.last=t;
    if(this._cleared && this._cleared[slot]){ s.clearUntil=t+Math.max(0.125,this._num('noteWrite',0.125,32)); delete this._cleared[slot]; }
    const write=Math.max(0.125,this._num('noteWrite',0.125,32)), hold=this._num('noteHold',0,32);
    const duration=(P.timing===1 ? write : write*s.plan.length)+hold;
    if(t-s.start>=duration){
      s.start=t; s.plan=this.makePlan();
      this._poolPlaced=(this._poolPlaced || 0)+s.plan.length;
      if(this._urls.length>48 && this._poolPlaced>=48 && !this._loading){ this._poolPlaced=0; this._poolOffset=((this._poolOffset || 0)+48)%this._urls.length; this._loadPool(); }
    }
    // Place mode starts with a blank sheet (C) and adds one image each Write interval.
    // Redraw mode reveals the entire new arrangement at once.
    s.visible=t<(s.clearUntil ?? -Infinity) ? 0 : P.timing===1 ? s.plan.length : Math.min(s.plan.length,Math.floor((t-s.start)/write));
    return s;
  },
  // A true 3D quad whose screen-space basis is exactly FUDE's _faceMat. Orthographic
  // depth slopes along each room face, feeding Code depth / 3D FX without changing axes.
  vertices(o){
    const P=this.P, asp=this._aspect, h=0.42*o.s, w=h*Math.max(0.1,this._dz(P.aspect)/100);
    const f=ConstructLayout._faceMat.call(this,o.face), r=(o.rot || 0)*Math.PI/180, c=Math.cos(r), s=Math.sin(r);
    const out=[];
    for(const [u,v] of [[0,0],[1,0],[0,1],[0,1],[1,0],[1,1]]){
      const x=(u-0.5)*w,y=(v-0.5)*h, a=x*c-y*s,b=x*s+y*c;
      const dz=o.face==='t' ? -(a+b)*0.12 : o.face==='l' ? a*0.16 : o.face==='r' ? -a*0.16 : 0;
      const z=Math.max(0.03,Math.min(0.96,o.z+dz*this._dz(P.depth)/100));
      out.push((o.x-0.5)*2+(f[0]*a+f[2]*b)*2/asp,1-o.y*2-(f[1]*a+f[3]*b)*2,z*2-1,u,v);
    }
    return new Float32Array(out);
  },
  VS:`#version 300 es
  layout(location=0) in vec3 aPos;
  layout(location=1) in vec2 aUV;
  uniform mat4 uProj;
  out vec2 vUV;
  void main(){ vUV=aUV; gl_Position=uProj*vec4(aPos,1.0); }`,
  FS:`#version 300 es
  precision highp float;
  uniform sampler2D uTex;
  uniform float uImageAspect,uAspect,uPadding,uFrame,uMat;
  uniform int uFit;
  uniform vec3 uPaper,uFrameColor;
  in vec2 vUV;
  out vec4 frag;
  void main(){
    vec2 metric=vec2(uAspect,1.0);
    float edge=min(min(vUV.x,1.0-vUV.x)*metric.x,min(vUV.y,1.0-vUV.y));
    if(edge<uFrame){ frag=vec4(uFrameColor,1.0); return; }
    vec2 inset=vec2(uPadding+uFrame)/metric;
    vec2 inner=max(vec2(0.001),1.0-2.0*inset);
    vec2 uv=(vUV-inset)/inner;
    float target=uAspect*inner.x/inner.y;
    vec2 scale=vec2(1.0);
    if(uFit==0) scale=target>uImageAspect ? vec2(1.0,uImageAspect/target) : vec2(target/uImageAspect,1.0);
    if(uFit==1) scale=target>uImageAspect ? vec2(target/uImageAspect,1.0) : vec2(1.0,uImageAspect/target);
    vec2 q=(uv-0.5)*scale+0.5;
    bool inside=all(greaterThanEqual(uv,vec2(0.0))) && all(lessThanEqual(uv,vec2(1.0))) && all(greaterThanEqual(q,vec2(0.0))) && all(lessThanEqual(q,vec2(1.0)));
    vec4 ink=inside ? texture(uTex,q) : vec4(0.0);
    float alpha=ink.a+(1.0-ink.a)*uMat;
    if(alpha<0.001) discard;
    // Each sample remains straight alpha, including white images and clear margins.
    frag=vec4((ink.rgb*ink.a+uPaper*(1.0-ink.a)*uMat)/alpha,alpha);
  }`,
  init(gl){
    if(this.initialized) return true;
    this.gl=gl;
    const shaders=[];
    for(const [type,src] of [[gl.VERTEX_SHADER,this.VS],[gl.FRAGMENT_SHADER,this.FS]]){
      const sh=gl.createShader(type); gl.shaderSource(sh,src); gl.compileShader(sh); shaders.push(sh);
      if(!__glReady(gl,sh,false)){ console.error('Image Construct:',gl.getShaderInfoLog(sh)); shaders.forEach(s=>gl.deleteShader(s)); return false; }
    }
    const prog=gl.createProgram(); shaders.forEach(sh=>gl.attachShader(prog,sh)); gl.linkProgram(prog);
    shaders.forEach(sh=>gl.deleteShader(sh));
    if(!__glReady(gl,prog,true)){ console.error('Image Construct:',gl.getProgramInfoLog(prog)); gl.deleteProgram(prog); return false; }
    this.prog=prog; this.loc={};
    for(const name of ['uProj','uTex','uImageAspect','uAspect','uPadding','uFrame','uMat','uFit','uPaper','uFrameColor']) this.loc[name]=gl.getUniformLocation(prog,name);
    this.vao=gl.createVertexArray(); this.vbo=gl.createBuffer();
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER,6*5*4,gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,20,0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,2,gl.FLOAT,false,20,12);
    gl.bindVertexArray(null);
    this.initialized=true; this.loadFolders(); return true;
  },
  render(opts){
    if(!this.initialized && !this.init(this.gl || GL.gl)) return;
    const {fbo,w,h,slot='A'}=opts, gl=this.gl,P=this.P;
    const os=typeof GL !== 'undefined' && GL._osCur;
    this._aspect=os && os.bw && os.bh ? os.bw/os.bh : w/h;
    this._syncFolder();
    const scene=this.step(opts);
    const keep=typeof GL !== 'undefined' && GL.kindKeepsDepth && GL.kindKeepsDepth(fbo);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
    if(!keep){
      if(!this.depthRBO || this.depthW!==w || this.depthH!==h){
        if(this.depthRBO) gl.deleteRenderbuffer(this.depthRBO);
        this.depthRBO=gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER,this.depthRBO);
        gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,w,h); this.depthW=w; this.depthH=h;
      }
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,this.depthRBO);
    }
    gl.viewport(0,0,w,h); gl.depthMask(true); gl.clearDepth(1);
    const opaque=slot!=='B' && opts.opaque!==false;
    gl.clearColor(...(opaque ? P.bg : [0,0,0]),opaque ? 1 : 0);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog); gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);
    const id=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    gl.uniformMatrix4fv(this.loc.uProj,false,typeof GL !== 'undefined' && GL.osProj ? GL.osProj(id) : id);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(this.loc.uTex,0);
    gl.uniform1i(this.loc.uFit,Math.round(this._num('fit',0,2)));
    gl.uniform1f(this.loc.uAspect,Math.max(0.1,this._dz(P.aspect)/100));
    gl.uniform1f(this.loc.uPadding,Math.min(0.4,this._dz(P.padding)/100));
    gl.uniform1f(this.loc.uFrame,Math.min(0.2,this._dz(P.frame)/100));
    gl.uniform1f(this.loc.uMat,P.mat ? 1 : 0);
    gl.uniform3fv(this.loc.uPaper,P.paper); gl.uniform3fv(this.loc.uFrameColor,P.frameColor);
    for(let i=0;i<scene.visible;i++){
      const o=scene.plan[i], tex=this.textures[o.tex%this.textures.length]; if(!tex) continue;
      gl.bindTexture(gl.TEXTURE_2D,tex.tex); gl.uniform1f(this.loc.uImageAspect,tex.aspect);
      gl.bufferSubData(gl.ARRAY_BUFFER,0,this.vertices(o)); gl.drawArrays(gl.TRIANGLES,0,6);
    }
    // The common compositor expects straight RGBA. Normalize blended transparent
    // pixels in a copy pass; opaque frames / opaque paper mats need no normalization.
    if(!opaque && !P.mat) this._straighten(fbo,w,h);
    this.depthInfo={near:0,far:1,cam:0.5,R:0.5,linear:true};
    if(!keep) gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,null);
    gl.bindVertexArray(null); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  },
  _straighten(fbo,w,h){
    const gl=this.gl;
    if(!this.alphaProg){
      const vs=gl.createShader(gl.VERTEX_SHADER), fs=gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(vs,'#version 300 es\nvoid main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0,1); }');
      gl.shaderSource(fs,'#version 300 es\nprecision highp float; uniform sampler2D uTex; out vec4 frag; void main(){ vec4 c=texelFetch(uTex,ivec2(gl_FragCoord.xy),0); frag=vec4(c.a>0.0001 ? c.rgb/c.a : vec3(0),c.a); }');
      gl.compileShader(vs); gl.compileShader(fs);
      if(!__glReady(gl,vs,false) || !__glReady(gl,fs,false)){ gl.deleteShader(vs); gl.deleteShader(fs); return; }
      const p=gl.createProgram(); gl.attachShader(p,vs); gl.attachShader(p,fs); gl.linkProgram(p);
      gl.deleteShader(vs); gl.deleteShader(fs);
      if(!__glReady(gl,p,true)){ gl.deleteProgram(p); return; }
      this.alphaProg=p; this.alphaLoc=gl.getUniformLocation(p,'uTex'); this.alphaTex=gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D,this.alphaTex);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D,this.alphaTex);
    if(this.alphaW!==w || this.alphaH!==h){ gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null); this.alphaW=w; this.alphaH=h; }
    gl.copyTexSubImage2D(gl.TEXTURE_2D,0,0,0,0,0,w,h);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    gl.useProgram(this.alphaProg); gl.uniform1i(this.alphaLoc,0); gl.drawArrays(gl.TRIANGLES,0,3); gl.depthMask(true);
  },
};

// Eight FUDE pattern families × six distinct compositions. Palettes and recipes
// contain only presentation values, never folders, filenames, pixels or data URLs.
ImageConstruct.LOOKS = (()=>{
  const names=[
    ['Red Axis','Black Lever','Ivory Beam','Blue Pivot','Floor Signal','Three Axes'],
    ['Red Giant','Small Chorus','White Monument','Blue Counter','Corner Hero','Wall Colossus'],
    ['Red Matrix','Black Modules','Ivory Lattice','Blue Ledger','Floor Tiles','Room Grid'],
    ['Red Border','Black Aperture','Ivory Window','Blue Perimeter','Floor Frame','Wall Portal'],
    ['Red Slash','Black Diagonal','Ivory Wedge','Blue Traverse','Floor Cut','Room Diagonal'],
    ['Red Steps','Black Cascade','Ivory Ascent','Blue Flight','Floor Stairs','Wall Steps'],
    ['Red Cross','Black Junction','Ivory Crossing','Blue Brace','Floor Cross','Room Junction'],
    ['Red Spokes','Black Sector','Ivory Fan','Blue Radius','Floor Rays','Room Fan'],
  ];
  const palettes=[['#e8dfc8','#f9f3df','#b12820'],['#111318','#e6e0d0','#db3226'],['#f2eddf','#fffdf5','#202127'],['#163554','#f4e9cf','#e7ad26'],['#ddd4be','#f6efdf','#a93224'],['#eae5d8','#f7f3e8','#14314d']];
  const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255);
  return names.flatMap((group,pattern)=>group.map((name,v)=>({name,p:{
    pattern,angleSys:v%2,projection:v>=4 || v===2 ? 1 : 0,faces:v===4 ? 1 : v===2 ? 4 : 0,
    count:[9,18,7,24,16,12][v]+(pattern%3)*2,size:[70,48,85,52,64,68][v],
    contrast:[150,240,180,65,90,130][v],aspect:[140,100,175,70,125,150][v],
    cvAngle:[0,90,0,-90,0,0][v],cvSnap:1,cvMirror:[0,1,2,3,0,1][v],
    cvSpread:[95,110,90,100,110,95][v],cvOffX:[-6,10,-12,8,0,5][v],cvOffY:[4,-6,6,-8,3,-3][v],
    fit:v===1 || v===3 ? 1 : 0,padding:[3,6,8,2,1,4][v],mat:v===3 ? 0 : 1,frame:[1.2,0.6,0,2,0.5,1][v],
    bg:rgb(palettes[v][0]),paper:rgb(palettes[v][1]),frameColor:rgb(palettes[v][2]),depth:100,
  }})));
})();
// Capture before init and before App state/default restoration.
Object.assign(ImageConstruct.P, JSON.parse(JSON.stringify(ImageConstruct.LOOKS[5].p)), {look:5});
ImageConstruct.PDefaults = JSON.parse(JSON.stringify(ImageConstruct.P));
ImageConstruct.PARAM_HELP = {
  folder:'画像フォルダを構成主義の配置で組む。取り込み済み・臨時ドロップのフォルダも選べます。',
  pattern:'FUDE と共有する構成: Axis / Hero / Grid / Frame / Diagonal / Stairs / Cross / Radial。',
  projection:'Flat は画面に平らに、Iso は床と左右の壁に画像を貼ります。',
  noteWrite:'1 枚を置く拍数。Redraw は構図全体の切替間隔。Drone も BPM に合わせて進みます。',
  noteHold:'全部を置いたあと、次の構図まで保持する拍数。',
  lookEvery:'Auto で構成プリセットを切り替える拍数。画像フォルダは変えません。',
  fit:'Crop は切り抜き、Contain は縦横比を保って全体表示、Stretch は枠に合わせて伸縮。',
  mat:'余白の紙を表示。Off では画像の外側と透明な画素を透過します。',
};
