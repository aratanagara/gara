'use strict';
// Stage 2 contracts: routing, shared shader sources, uniforms and persistence. No browser/GPU.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..'), storage = new Map();
const ctx = vm.createContext({
  console, matchMedia:()=>({matches:false}), performance:{now:()=>1000}, Event,
  document:{documentElement:{},addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},getElementById(){return null;}},
  window:{addEventListener(){},matchMedia:()=>({matches:false})}, navigator:{},
  localStorage:{getItem:k=>storage.get(k) ?? null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  I18n:{t:s=>s}, setTimeout(){},clearTimeout(){},requestAnimationFrame(){},
});
const files = ['mode/photoplane.js','mode/slicer.js','fx3d.js','fx3d-extrude.js','fx3d-blinds.js',
  'fx3d-globe.js','fx3d-points.js','fx3d-layers.js','fx3d-cubes.js','fx3d-gravity.js','fx3d-diorama.js','fx3d-tunnel.js','app.js'];
for(const file of files) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
const {GL,Fx3d,App,Slicer,PhotoPlane,UI} = vm.runInContext('({GL,Fx3d,App,Slicer,PhotoPlane,UI})',ctx);
const factory = App.postFactoryDefaults();
assert.equal(App.post.fx3dStack,'build');
assert.equal(factory.fx3dStack,'build');
assert.equal(App.postDefaults().fx3dStack,'build');
storage.set('vj.def.post.fx3d',JSON.stringify({fx3dLayerCount:9}));
assert.equal(App.postDefaults().fx3dStack,'build','old defs are not old presets');
App.post.fx3dStack='chain';
App.resetPostGroupDefault('fx3d');
assert.equal(App.post.fx3dStack,'build');
App.post.fx3dStack='chain'; App.savePostGroupDefault('fx3d');
assert.equal(JSON.parse(storage.get('vj.def.post.fx3d')).fx3dStack,'chain');
assert.equal(App.postDefaults().fx3dStack,'chain','explicit saved preference survives');
storage.clear();
App._presetDefaults={post:{...factory}};
App._restoreModeStates=()=>{}; App.setSlotABg=()=>{};
UI.refreshAll=()=>{}; UI.refreshPost=()=>{};
// Only the post portion is under test: stop at the next mode-restore boundary.
App._restoreModeStates=()=>{throw 'post-tested';};
const warn=console.warn; console.warn=()=>{};
try{
  for(const [state,want] of [[{post:{fx3dGlobe:0.5}},'chain'],[{},'chain'],
    [{post:{fx3dStack:'build'}},'build'],[{post:{fx3dStack:'chain'}},'chain']]){
    App.post={...factory}; App._applyState(state,{resetMissingDefaults:true,instantPost:true});
    assert.equal(App.post.fx3dStack,want);
  }
  App._fadeBeats=()=>1; App._fadeSec=()=>1;
  App._applyState({post:{fx3dStack:'build'}},{resetMissingDefaults:true});
  assert.equal(App.post.fx3dStack,'build','enum switches immediately during parameter fades');
} finally {console.warn=warn;}
// Preset/bank/state serialization retains the current enum.
GL.slots={A:{kind:'none',params:[]},B:{kind:'none',params:[]}};
UI.activePresetIdx={A:-1,B:-1};
assert.equal(App._collectState().post.fx3dStack,'build');

let id=0,current=null; const draws=[], calls=[];
const gl = new Proxy({}, {get(o,k){
  if(k in o)return o[k];
  if(/^[A-Z_0-9]+$/.test(k))return o[k]=++id;
  return o[k]=(...a)=>{
    calls.push([k,...a]);
    if(k.startsWith('create'))return {id:++id};
    if(k==='checkFramebufferStatus')return gl.FRAMEBUFFER_COMPLETE;
    if(k==='getParameter')return a[0]===gl.ALIASED_POINT_SIZE_RANGE ? [1,64] : 8;
    if(k==='getUniformLocation')return {p:a[0],name:a[1]};
    if(k.startsWith('uniform')){const [loc,...v]=a;if(loc)(loc.p.u||={})[loc.name]=v;}
    if(k==='useProgram')current=a[0];
    if(k==='drawArrays'||k==='drawElements')draws.push({p:current,args:a});
    if(k==='getAttribLocation')return ['a_pos','a_uv','a_seed','a_ctr','a_nrm','a_xy'].indexOf(a[1]);
  };
}});
GL.gl=gl;GL.frame=42;
GL._compile=(type,src)=>({type,src});GL._link=(vs,fs)=>({vs:vs.src,fs:fs.src,u:{}});
App.post={...factory,fx3dPop:'off'}; App.visualBeat=()=>1;
const opts={srcTex:{},fbo:{},w:640,h:360,e:0.7,k:1,asp:16/9,clock:1,beat:1,hit:0,beatMode:false,post:App.post,dz:v=>v,ovM:[0,0]};
const val=(p,n)=>p.u[n]?.[0];
const H=GL._fx3dHeightTarget(640,360); H.valid=true;H.frame=GL.frame;
Slicer._compileProg=(vs,fs)=>({vs,fs,u:{}}); Slicer.init(gl);
PhotoPlane._compile=(type,src)=>({type,src});
gl.getProgramParameter=()=>true;
gl.shaderSource=()=>{};gl.attachShader=(p,s)=>{if(s.type===gl.VERTEX_SHADER)p.vs=s.src;else p.fs=s.src;};
PhotoPlane.autoLoadFromFolder=()=>{}; PhotoPlane.init(gl);
const slicer=Fx3d.ensure('slicer',gl);slicer.P.pieces=20;slicer.buildScene();
const photo=Fx3d.ensure('photo',gl);photo.generateLayout();
const sources=new Set();
for(const shape of ['globe','tunnel']){
  const state=Fx3d.EXTRA[shape].shapeState(opts);
  for(const name of Fx3d.PARTS){
    for(const needle of [false,true]){
      Fx3d.shapeFrame={name:shape,state};Fx3d.foldFrame=null;
      Fx3d.spikeFrame=needle ? {a:0.5,thick:1,len:1,sides:5} : null;
      H.valid=true; draws.length=0;
      if(name==='photo')photo.render({fbo:{},w:640,h:360,slot:'B'});
      else if(name==='slicer')slicer.render({fbo:{},w:640,h:360,slot:'B'});
      else assert.equal(Fx3d.EXTRA[name].render(gl,opts),true);
      const drawn=draws.filter(d=>val(d.p,'uFx3dShapeOn')>0);
      assert.ok(drawn.length,name+' '+shape+' '+needle);
      const p=drawn[0].p;sources.add(p);
      assert.equal(val(p,'uFx3dShapeOn'),shape==='globe'?1:2);
      assert.equal(val(p,'uFx3dHeightOn'),1);
      assert.equal(val(p,'uFx3dHeightDeferred'),1,'parent must not add H before curvature');
      assert.equal((p.vs.match(/uniform highp sampler2D uFx3dHeight;/g)||[]).length,1);
      assert.match(p.vs,/N \* \(depth \+ fx3dHeightHC\(sourceUv\).r\)/,'H along surface normal');
      assert.match(p.vs,/gl_Position = fx3dApply\(fx3dShape\(/);
      assert.ok(p.vs.indexOf('vec2 fx3dHeightHC')<p.vs.indexOf('vec4 fx3dShape('),'GLSL definitions precede use');
      for(const n of ['uFx3dShapeInvView','uFx3dShapeInvProj','uFx3dShapeProj'])
        assert.ok(Array.from(p.u[n][1]).every(Number.isFinite),n);
    }
  }
}
// Shape is applied before folding; the fold must invert the shape camera, not the parent camera.
Fx3d.shapeFrame={name:'globe',state:Fx3d.EXTRA.globe.shapeState(opts)};
Fx3d.spikeFrame=null;
Fx3d.foldFrame={g:1,zs:0.3,F:GL._foldBuild({kaiser:0.5},0,0.5,0,0,false,640,360)};
for(const name of ['layer','photo']){
  if(name==='photo')photo.render({fbo:{},w:640,h:360,slot:'B'});
  else Fx3d.EXTRA[name].render(gl,opts);
  const p=draws.at(-1).p;
  assert.equal(val(p,'uFx3dOn'),1);
  assert.deepEqual(Array.from(p.u.uFx3dInvProj[1]),Array.from(GL._mat4Inv(Fx3d.shapeFrame.state.cam.proj)));
}
Fx3d.foldFrame=null;
// Code shares programs, so it must explicitly disable both height and shape.
Slicer.imageReady=true;Slicer.P.pieces=20;Slicer.buildScene();Slicer.render({fbo:{},w:640,h:360,slot:'B'});
PhotoPlane.render({fbo:{},w:640,h:360,slot:'B'});
for(const p of [Slicer.prog,PhotoPlane.prog]){
  assert.equal(val(p,'uFx3dShapeOn'),0);assert.equal(val(p,'uFx3dHeightOn'),0);
  assert.equal(val(p,'uFx3dHeightDeferred'),0);
}
Fx3d.shapeFrame=null;Fx3d.spikeFrame=null;
// Shared formula text is identical after namespacing, no second implementation.
for(const [name,fn,pre] of [['globe','gSurf','f3g_'],['tunnel','tSurf','f3t_']]){
  Fx3d.EXTRA[name].render(gl,opts);
  const standalone=Fx3d._progs[name].vs;
  const shared=Fx3d.EXTRA[name].shapeGLSL().replaceAll(pre,'');
  const body=s=>s.slice(s.indexOf('vec3 '+fn+'('),s.indexOf('\n}',s.indexOf('vec3 '+fn+'('))+2);
  assert.equal(body(shared),body(standalone));
}
// Disabled shape leaves the previous engine uniform bindings and render order intact.
App.post.fx3dStack='chain'; H.valid=true;
Fx3d.EXTRA.blinds.render(gl,opts);
assert.equal(val(draws.at(-1).p,'uWidthSeg'),1);
assert.equal(val(draws.at(-1).p,'uFx3dHeightOn'),0);
const render=Fx3d.render, rendered=[];
GL._finalFBO={w:640,h:360,tex:{},fbo:{}};GL._ovSync=()=>null;GL._fx3dBgUnder=()=>{};
GL.foldStackProg={};GL._foldBuild=()=>({});GL._fx3dFrame=null;
Fx3d.render=(name,o)=>{rendered.push({name,o,shape:Fx3d.shapeFrame?.name,fold:Fx3d.foldFrame,spike:Fx3d.spikeFrame});return false;};
function route(e,p={},stack='build'){
  App.post.fx3dStack=stack; Fx3d.effE=e;rendered.length=0;GL._apply3dFx(p,false);return [...rendered];
}
for(const part of Fx3d.PARTS){
  for(const shape of ['globe','tunnel']){
    const out=route({extrude:0.7,[part]:0.5,[shape]:0.7});
    assert.deepEqual(out.map(x=>x.name),['extrude',part]);
    assert.equal(out[0].o.heightOnly,true);assert.equal(out[1].shape,shape);
  }
}
let out=route({slicer:0.5,photo:0.5,layer:0.5,cubes:0.5,blinds:0.5,diorama:0.5,points:0.5,globe:0.7,tunnel:0.7},{kaiser:0.5,origami:0.5});
assert.deepEqual(out.map(x=>x.name),Array.from(Fx3d.PARTS));
assert.equal(out.filter(x=>x.shape).length,1);assert.equal(out.at(-1).shape,'globe');
assert.ok(out.at(-1).fold && out.at(-1).spike);
assert.equal(Fx3d.shapeFrame,null);
out=route({extrude:0.7,photo:0.5,slicer:0.5,layer:0.5,cubes:0.5,blinds:0.5,diorama:0.5,points:0.5,tunnel:0.7,globe:0.7},{},'chain');
assert.deepEqual(out.map(x=>x.name),Array.from(Fx3d.ORDER).filter(n=>n!=='gravity'));
assert.ok(out.every(x=>!x.shape && !x.o.heightOnly));assert.equal(H.valid,false);
for(const shape of ['globe','tunnel'])assert.deepEqual(route({[shape]:0.7}).map(x=>x.name),[shape]);
H.valid=true; Fx3d.shapeFrame={}; GL._apply3dFx({},true);
assert.equal(Fx3d.shapeFrame,null);assert.equal(H.valid,false);
Fx3d.render=render;

// UI IDs / defaults / group memberships stay stable; only Stack is added.
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const section=html.slice(html.indexOf('<h3>3D '),html.indexOf('<h3>Pattern'));
const roles=[...section.matchAll(/<h4[^>]*>(.*?)<\/h4>/g)].map(m=>m[1]);
assert.deepEqual(roles,['高さ','分け方','凹凸','形','複製・場','設定']);
const ids=['pxFx3dExtrude','pxFx3dSlicer','pxFx3dPhoto','pxFx3dLayer','pxFx3dCubes','pxFx3dBlinds','pxFx3dDiorama','pxFx3dPoints','pxOrigami','pxFx3dTunnel','pxFx3dGlobe','pxKaiser','pxKaiserOld','pxFx3dRoll','pxUzumaki','pxFx3dGravity','pxFx3dStack'];
for(let i=1;i<ids.length;i++)assert.ok(section.indexOf('id="'+ids[i-1]+'"')<section.indexOf('id="'+ids[i]+'"'));
assert.ok(App.POST_GROUPS.fx3d.includes('fx3dStack'));
vm.runInContext(fs.readFileSync(path.join(root,'i18n.js'),'utf8'),ctx);
const t=ctx.window.I18n;
for(const key of [...roles,'組み立て','絵の連鎖'])assert.ok(t.t(key)!==key,key+' has EN');
// No new long constant GLSL loops in the actual generated shader sources.
for(const p of sources)for(const src of [p.vs,p.fs]){
  for(const m of src.matchAll(/for\s*\(\s*int\s+\w+\s*=\s*(\d+)\s*;\s*\w+\s*(<|<=)\s*(\d+)\s*;/g))
    assert.ok(+m[3]-m[1]+(m[2]==='<='?1:0)<8,'constant GLSL loop '+m[0]);
}
console.log('PASS: Stack defaults/Save/Reset/presets/fades, 28 shape+Needle engine paths, H normal/defer, shared formulas, Code isolation, Build/Chain routing, precedence, safe/OFF, UI/i18n and GLSL loops');
