'use strict';
// CPU / GL-call contract checks only. No browser or GPU; shader rendering is checked by Claude.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ctx = vm.createContext({
  console, matchMedia:()=>({matches:false}), performance:{now:()=>1000}, Event,
  document:{addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},getElementById(){return null;}},
  window:{addEventListener(){},matchMedia:()=>({matches:false})}, navigator:{},
  localStorage:{getItem(){return null;},removeItem(){}}, setTimeout(){},clearTimeout(){},requestAnimationFrame(){},
});
for(const file of ['mode/slicer.js','fx3d.js','fx3d-extrude.js','fx3d-blinds.js','fx3d-globe.js','fx3d-points.js',
  'fx3d-layers.js','fx3d-cubes.js','fx3d-gravity.js','fx3d-diorama.js','fx3d-tunnel.js','app.js'])
  vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
const {GL,Fx3d,App,Slicer} = vm.runInContext('({GL,Fx3d,App,Slicer})',ctx);
let id = 0, current = null, boundBuffer = null, unit = 0, complete = true;
const calls = [], draws = [], textures = new Map();
const gl = new Proxy({}, {get(o,k){
  if(k in o) return o[k];
  if(/^[A-Z_0-9]+$/.test(k)) return o[k] = ++id;
  return o[k] = (...args)=>{
    calls.push([k,...args]);
    if(k.startsWith('create')) return {id:++id};
    if(k==='checkFramebufferStatus') return complete ? gl.FRAMEBUFFER_COMPLETE : 0;
    if(k==='getParameter') return args[0]===gl.ALIASED_POINT_SIZE_RANGE ? [1,64] : 8;
    if(k==='getUniformLocation') return {p:args[0],name:args[1]};
    if(k.startsWith('uniform')){ const [loc,...v] = args; if(loc) (loc.p.u ||= {})[loc.name] = v; }
    if(k==='useProgram') current = args[0];
    if(k==='drawArrays'||k==='drawElements') draws.push({p:current,args});
    if(k==='activeTexture') unit = args[0];
    if(k==='bindTexture') textures.set(unit,args[1]);
    if(k==='bindBuffer') boundBuffer = args[1];
    if(k==='bufferData' && boundBuffer) boundBuffer.data = args[1];
    if(k==='getAttribLocation') return ['a_pos','a_uv','a_seed','a_ctr','a_nrm','a_xy'].indexOf(args[1]);
  };
}});
GL.gl = gl; GL.frame = 42;
GL._compile = (type,src)=>({type,src});
GL._link = (vs,fs)=>({vs:vs.src,fs:fs.src,u:{}});
GL.slots = {A:{kind:'none'}, B:{kind:'none'}};
App.post = {fx3dPop:'off',fx3dDepth:0.5};
App.slotVisibleAmount = ()=>1;
App.visualBeat = ()=>1;
const src = {source:true};
const opts = {srcTex:src,fbo:{},w:1920,h:1080,e:0.7,k:1,asp:16/9,clock:1,beat:1,hit:0,beatMode:false,post:App.post,dz:v=>v,ovM:[0.1,0.2]};
const val = (p,n)=>p.u[n]?.[0];

// Target reuse / resize and unsupported attachment are explicit; format is floating point.
let H = GL._fx3dHeightTarget(1920,1080);
assert.ok(H.ready && !H.valid);
assert.ok(calls.some(c=>c[0]==='texStorage2D' && c[3]===gl.RGBA16F && c[4]===1920 && c[5]===1080));
assert.equal(GL._fx3dHeightTarget(1920,1080),H);
const old = H;
H = GL._fx3dHeightTarget(1280,720);
assert.notEqual(H,old);
assert.ok(calls.some(c=>c[0]==='deleteTexture' && c[1]===old.tex));
complete = false;
const savedWarn = console.warn; console.warn = ()=>{};
const bad = GL._fx3dHeightTarget(16,16);
console.warn = savedWarn;
assert.ok(!bad.ready && !bad.valid);
complete = true;

// Height rendering never calls Extrude's camera and writes only the H target.
const camera = Fx3d.camera;
let cameras = 0;
Fx3d.camera = (...a)=>{ cameras++; return camera.apply(Fx3d,a); };
const ex = Fx3d.EXTRA.extrude;
assert.equal(ex.render(gl,{...opts,heightOnly:true}),true);
H = GL._fx3dHeight;
assert.equal(cameras,0);
assert.equal(H.valid,true);
assert.equal(H.frame,GL.frame);
assert.deepEqual(Array.from(H.os),[0.2,0.4]);
assert.equal(textures.get(gl.TEXTURE0),src);
const hp = Fx3d._progs.extrudeHeight;
assert.equal(val(hp,'uSamples'),8);
assert.equal(val(hp,'uFx3dHeightOn'),0,'H cannot sample its own render target');
assert.ok(calls.some(c=>c[0]==='generateMipmap'));
const fullT = val(hp,'uT');
ex.render(gl,{...opts,heightOnly:true,k:0.5});
assert.equal(val(hp,'uT'),fullT/2);
ex.render(gl,{...opts,heightOnly:true,post:{...App.post,fx3dExtrudeDepth:1}});
assert.ok(val(hp,'uT')>fullT);
ex.render(gl,opts);
assert.equal(cameras,1,'standalone still uses its own camera');
for(const signature of ['float maskV(', 'float hgtD(', 'float roundP(']){
  const body = s=>s.slice(s.indexOf(signature),s.indexOf('\n}',s.indexOf(signature))+2);
  assert.equal(body(hp.fs),body(Fx3d._progs.extrude.fs),'same shape formula: '+signature);
}

// Binding: stale frames and Code calls cannot inherit H. Sampler unit is distinct from A/B.
const pr = {u:{}};
GL._fx3dHeightBind(pr,[1/64,1/64]);
assert.equal(val(pr,'uFx3dHeightOn'),1);
assert.equal(val(pr,'uFx3dHeight'),11);
assert.ok(val(pr,'uFx3dHeightLod')>0);
assert.equal(textures.get(gl.TEXTURE0+11),H.tex);
GL._fx3dHeightBind(pr,null,false);
assert.equal(val(pr,'uFx3dHeightOn'),0);
GL.frame++;
GL._fx3dHeightBind(pr);
assert.equal(val(pr,'uFx3dHeightOn'),0);
H.frame = GL.frame;
GL._reliefBind(pr);
assert.equal(val(pr,'uFx3dHeightOn'),1);
assert.deepEqual(pr.u.uRelief,[0,0],'non-depth visuals can receive H');
H.valid = false; GL._reliefBind(pr);
assert.equal(val(pr,'uFx3dHeightOn'),0);
H.valid = true;

// Actual engine render/bind paths, both regular and Needle variants.
for(const name of ['layer','cubes','gravity','globe','blinds','points']){
  for(const needle of [false,true]){
    Fx3d.spikeFrame = needle ? {a:0.5,thick:1,len:1,sides:5} : null;
    draws.length = 0;
    assert.equal(Fx3d.EXTRA[name].render(gl,opts),true,name);
    const p = draws.at(-1).p;
    assert.equal(val(p,'uFx3dHeightOn'),1,name+' height binding');
    assert.equal((p.vs.match(/uniform highp sampler2D uFx3dHeight;/g)||[]).length,1,name+' shader injection');
    assert.match(p.vs,/fx3d(?:Height|Relief)\(/);
  }
}
Fx3d.spikeFrame = null;
H.valid = false; draws.length = 0;
Fx3d.EXTRA.blinds.render(gl,opts);
const legacyCount = draws.at(-1).args[2];
assert.equal(val(draws.at(-1).p,'uWidthSeg'),1);
H.valid = true; draws.length = 0;
Fx3d.EXTRA.blinds.render(gl,opts);
assert.equal(draws.at(-1).args[2],legacyCount*8);
assert.equal(val(draws.at(-1).p,'uWidthSeg'),8);

// Slicer normals are generated from geometry, without reading height back to the CPU.
Slicer._compileProg = (vs,fs)=>({vs,fs,u:{}});
Slicer.init(gl);
const slicer = Fx3d.ensure('slicer',gl);
slicer.P.pieces = 20;
slicer.buildScene();
assert.ok(slicer.nrmBuf && slicer.nrmBuf.data.length===slicer.posBuf.data.length);
for(let i=0;i<slicer.nrmBuf.data.length;i+=3)
  assert.ok(Math.abs(Math.hypot(...slicer.nrmBuf.data.slice(i,i+3))-1)<1e-5);
assert.ok(!calls.some(c=>c[0]==='readPixels'),'no CPU height readback');
slicer.render({fbo:{},w:640,h:360,slot:'B'});
assert.equal(val(slicer.prog,'uFx3dHeightOn'),1);
Fx3d.spikeFrame = {a:0.5,thick:1,len:1,sides:5};
slicer.render({fbo:{},w:640,h:360,slot:'B'});
assert.equal(val(Fx3d._progs.slicerSpike,'uFx3dHeightOn'),1);
assert.match(Fx3d._progs.slicerSpike.vs,/h \+= fx3dHeight/);
Fx3d.spikeFrame = null;
// Same shared program, but plain Code must turn it off.
Slicer.imgAsp = 16/9; Slicer.P.pieces = 20; Slicer.imageReady = true;
Slicer.buildScene(); Slicer.render({fbo:{},w:640,h:360,slot:'B'});
assert.equal(val(Slicer.prog,'uFx3dHeightOn'),0);
assert.equal(Slicer.nrmBuf,null);
assert.ok(slicer.nrmBuf,'Code rebuild did not delete FX normals');

// Routing uses full screen H resolution even when 3D Res is 50%, and bypasses colour compositing.
const render = Fx3d.render, ovSync = GL._ovSync, bgUnder = GL._fx3dBgUnder, foldBuild = GL._foldBuild;
const rendered = [];
GL._finalFBO = {w:1920,h:1080,tex:src,fbo:{}};
GL._ovSync = ()=>null; GL._fx3dBgUnder = ()=>{}; GL._foldBuild = ()=>({});
GL.foldStackProg = {};
App.post.fx3dScale = 0.5;
Fx3d.render = (name,o)=>{rendered.push({name,o});return false;};
for(const next of [...Fx3d.ORDER.slice(1),'origami','kaiser','kaiserOld','fx3dRoll','uzumaki','needle']){
  const p = Fx3d.KEY[next] ? {} : {[next]:0.5};
  Fx3d.effE = {extrude:0.7,...(Fx3d.KEY[next] ? {[next]:0.5} : {})};
  rendered.length = 0;
  GL._apply3dFx(p,false);
  const first = rendered[0];
  assert.equal(first.name,'extrude');
  assert.equal(first.o.heightOnly,true,next+' triggers H');
  assert.equal(first.o.srcTex,src);
  assert.equal(first.o.w,1920); assert.equal(first.o.h,1080);
}
Fx3d.effE = {extrude:0.7}; rendered.length = 0;
GL._apply3dFx({},false);
assert.equal(rendered[0].o.heightOnly,undefined);
assert.equal(rendered[0].o.w,960);
H.valid = true; GL._apply3dFx({},true);
assert.equal(H.valid,false,'safe mode clears H before early return');
Fx3d.effE = {}; H.valid = true; GL._apply3dFx({},false);
assert.equal(H.valid,false,'Extrude OFF clears H');
Fx3d.render = render; GL._foldBuild = foldBuild;

// Exercise the unified paper bindings with the actual shader source and fold builders.
const appSource = fs.readFileSync(path.join(root,'app.js'),'utf8');
const foldSource = appSource.slice(appSource.indexOf('const FVS = `#version 300 es'),appSource.indexOf('const fvs = this._compile(gl.VERTEX_SHADER, FVS)'));
GL.foldStackProg = vm.runInContext('(function(){'+foldSource+'return {vs:FVS,fs:FFS,u:{}};}).call(GL)',ctx);
GL._foldStackGrid = [192,108];
H.valid = true; H.frame = GL.frame;
for(const p of [{kaiser:0.5},{kaiserOld:0.5},{fx3dRoll:0.5},{uzumaki:0.5},{origami:0.5}]){
  App.post.kaiserSoft = p.kaiser ? 0.5 : 0;
  GL._gravFold = p.fx3dRoll ? 0.5 : 0;
  assert.equal(GL._applyFoldStack(p,false),true,JSON.stringify(p));
  assert.equal(val(GL.foldStackProg,'uFx3dHeightOn'),1);
  if(p.uzumaki){
    assert.equal(GL._foldStackTookUzumaki,true);
    assert.deepEqual(GL.foldStackProg.u.uGrid,[72,42]);
  }
}
H.valid = false; GL._gravFold = 0;
assert.equal(GL._applyFoldStack({uzumaki:0.5},false),false,'plain Uzumaki retains its old route');
GL._ovSync = ovSync; GL._fx3dBgUnder = bgUnder;

console.log('PASS: H target, resize/failure, shared shape formulas, scale, frame/Code isolation, 12 engine variants, Blinds x8, Slicer normals, 16 downstream routes, unified folds/Gravity/Uzumaki, standalone/safe/OFF');
