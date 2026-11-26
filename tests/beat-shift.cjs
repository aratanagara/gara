'use strict';
// Static/VM regression checks; no browser, media decoding or GPU is required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ctx = vm.createContext({
  console, matchMedia:()=>({matches:false}), performance:{now:()=>1000}, Event,
  document:{addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},getElementById(){return null;}},
  window:{addEventListener(){},matchMedia:()=>({matches:false})}, navigator:{},
  localStorage:{getItem(){return null;},removeItem(){}},
  setTimeout(){},clearTimeout(){},requestAnimationFrame(){},
});
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const m of html.matchAll(/<script src="([^"?]+)(?:\?[^\"]*)?"/g)){
  const f=m[1];
  if(f==='presets.js'||f.startsWith('mode/')||f.startsWith('shaders/')||f==='app.js')
    vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx,{filename:f});
}
const run = s=>vm.runInContext(s,ctx);
const {BShift,App,BPM,GL,Movie,BSHIFT_STATEFUL} = run('({BShift,App,BPM,GL,Movie,BSHIFT_STATEFUL})');
assert.ok(BSHIFT_STATEFUL.has('shredder'));
// Every available shared-state Code kind has a pristine definition and a private instance.
for(const kind of BSHIFT_STATEFUL){
  const base = BShift.bases[kind];
  if(!base){ assert.equal(kind,'grayscott'); continue; }
  assert.ok(BShift.templates[kind],kind);
  App.slotBOffsetBeats=0;
  assert.equal(BShift.engine(kind,'A'),base);
  assert.equal(BShift.engine(kind,'B'),base);
  // Stub only initialization/render assets; exercise the real isolation/parameter path.
  const t=BShift.templates[kind];
  t.init=function(){this.initialized=true;this.runtime={marks:[]};};
  t.applyP=()=>{}; t.rebuild=()=>{}; t.markDirty=()=>{}; t.generateLayout=()=>{};
  App.slotBOffsetBeats=.5;
  const e=BShift.engine(kind,'B');
  assert.notEqual(e,base,kind);
  assert.notEqual(e.P,base.P,kind+' parameters');
  const original=JSON.stringify(base.P);
  e.runtime.marks.push(1);
  assert.equal(JSON.stringify(base.P),original,kind+' base unchanged');
  if(typeof base.P.seed==='number') assert.equal(e.P.seed,base.P.seed+17,kind+' seed');
  const key=Object.keys(base.P).find(k=>typeof base.P[k]==='number'&&k!=='seed');
  if(key){const old=base.P[key];base.P[key]=old+1;assert.equal(BShift.engine(kind,'B').P[key],old+1);base.P[key]=old;}
  assert.equal(BShift.engine(kind,'A'),base);
  App.slotBOffsetBeats=0;
  assert.equal(BShift.engine(kind,'B'),base,kind+' OFF returns original');
}
assert.equal(BShift.engine('video','B'),Movie);
assert.equal(BShift.engine('image','B'),BShift.bases.image);
// Nested cameras, arrays and typed arrays cannot leak mutations to a base/template.
const p=BShift.instances.photoplane;
p.cam.az=123; assert.notEqual(BShift.bases.photoplane.cam.az,123);
const td=BShift.instances.textdeform, modules=td._modules;
for(const name of ['TDComp','TDSurf','TDLooks','TDVec','TDCanvas','TDUpstream'])
  assert.notEqual(modules[name],run(name),name+' private module');
run('TDLooks.saved=[{name:"late",style:{}}]; TDSurf.presets={presets:[],families:[]};');
App.slotBOffsetBeats=.5; BShift.engine('textdeform','B');
assert.equal(modules.TDLooks.saved,run('TDLooks.saved'),'late Look catalog is available to B');
assert.equal(modules.TDSurf.presets,run('TDSurf.presets'));
const oldSurf=JSON.stringify(run('TextDeform.P.surf'));
td.P.surf={enabled:true,op:'plotterTrace',speed:.7};
assert.equal(modules.TDSurf.cfg.speed,.7);
assert.equal(JSON.stringify(run('TextDeform.P.surf')),oldSurf,'surface accessor stays private');
td.P.comp={enabled:true,type:'field',seed:73};
assert.equal(modules.TDComp.get().seed,73);
assert.notEqual(run('TDComp.get().seed'),73,'composition accessor stays private');
modules.TDCanvas._inst.set('B',{});
assert.equal(run('TDCanvas._inst.has("B")'),false);
// Load fresh simulation definitions so the stubs above cannot
// conceal shared WebGL buffers. Capture uploaded particle seeds without a GPU.
let resource=0; const uploads=[];
const gl=new Proxy({}, {get(o,k){
  if(k in o) return o[k];
  if(/^[A-Z_0-9]+$/.test(k)) return o[k]=++resource;
  return o[k]=(...args)=>{
    if(k==='texImage2D' && ArrayBuffer.isView(args.at(-1)) && args.at(-1).BYTES_PER_ELEMENT===4) uploads.push(args.at(-1).slice());
    if(k.startsWith('create')) return {resource:++resource};
    if(k==='getExtension'||k==='getShaderParameter'||k==='getProgramParameter') return true;
    if(k==='getAttribLocation') return 0;
    if(k==='getUniformLocation') return {resource:++resource};
  };
}});
// Evaluate real methods in their existing context (typed arrays belong to that context).
ctx.testGL=gl;
run('GL.gl=testGL; GL.needleCellGLSL=()=>"";');
const src=fs.readFileSync(path.join(root,'mode/shredder.js'),'utf8');
run(src.replace('const Shredder =','const TestShredder =').replaceAll('Shredder.','TestShredder.')+'; globalThis.testShredder=TestShredder;');
const a=ctx.testShredder, b=BShift.copy(a);
a.init(gl); b.P.seed+=17; b.init(gl);
assert.notEqual(a.sim,b.sim); assert.notEqual(a.sim.tex[0],b.sim.tex[0]);assert.notEqual(a.seedTex,b.seedTex);
assert.notEqual(a.cam,b.cam);
assert.ok(uploads.length >= 4);
assert.notDeepEqual(uploads[0], uploads[uploads.length-1], 'particle initial positions differ');
const fluidSrc=fs.readFileSync(path.join(root,'shaders/boltzmann.js'),'utf8');
run(fluidSrc.replace('const Boltzmann =','const TestBoltzmann =').replaceAll('Boltzmann.','TestBoltzmann.')+'; globalThis.testBoltzmann=TestBoltzmann;');
const fa=ctx.testBoltzmann, fb=BShift.copy(fa);
fa._loadImage=fb._loadImage=()=>{};
fa.init(gl);fb.init(gl);fa._resize(32,18);fb._resize(32,18);
for(const k of ['A0','A1','D0','D1','Bbuf','Cbuf']){assert.notEqual(fa[k],fb[k]);assert.notEqual(fa[k].tex,fb[k].tex);}
fa.render({fbo:null,w:32,h:18});fb.render({fbo:null,w:32,h:18});
assert.notEqual(fa._seed,fb._seed,'fluid seed is independent');
// The real dispatch passes a shifted beat/clock to B and restores GL.clock afterward.
const calls=[];const code=BShift.bases.cyberui;
code.initialized=true;code.update=()=>{};code.render=o=>calls.push({beat:o.beat,clock:o.clock});
BShift.instances.cyberui.render=code.render; BShift.instances.cyberui.update=()=>{};
GL._kdBegin=()=>{}; GL._kdEnd=()=>{};
GL.slots={A:{kind:'cyberui',_beat:7,_scaledBeat:14,_clock:3,fbIdx:0,fbos:[{fbo:{},w:1,h:1},{fbo:{},w:1,h:1}]},B:{kind:'cyberui',_beat:7,_scaledBeat:14,_clock:3,fbIdx:0,fbos:[{fbo:{},w:1,h:1},{fbo:{},w:1,h:1}]}};
GL.clock=99;BPM.bpm=120;App.slotBOffsetBeats=.5;
GL._renderAnySlot('A');GL._renderAnySlot('B');
assert.deepEqual(calls,[{beat:14,clock:3},{beat:14.5,clock:3.25}]);assert.equal(GL.clock,99);
App.slotBOffsetBeats=0;GL._renderAnySlot('B');assert.deepEqual(calls.at(-1),calls[0]);
// Slicer can use the same dropped/blob image without owning/deleting A's texture.
const slicer=BShift.bases.slicer, shiftedSlicer=BShift.instances.slicer;
const source={resource:'source'}, oldPrivate={resource:'private'}, deleted=[];
gl.deleteTexture=t=>deleted.push(t);
slicer.imgTex=source;slicer.imageReady=true;slicer.imgW=40;slicer.imgH=20;slicer.imgAsp=2;
shiftedSlicer.imgTex=oldPrivate;App.slotBOffsetBeats=.5;
BShift.engine('slicer','B');assert.equal(shiftedSlicer.imgTex,source);assert.ok(deleted.includes(oldPrivate));
assert.ok(!deleted.includes(source));assert.equal(shiftedSlicer._bShiftSourceTex,source);
// Drone offsets: tempo changes are not seek requests, OFF undoes actual applied seconds.
let seeks=0, time=5;
const video={duration:30,get currentTime(){return time;},set currentTime(v){time=v;seeks++;}};
const s=Movie._newSlotState(); Object.assign(s,{loaded:true,videoEl:video});
BPM.bpm=120; Movie._applyBeatShift(s,1,'drone'); assert.equal(time,5.5);assert.equal(seeks,1);
for(const bpm of [120.01,90,140,60]){BPM.bpm=bpm;Movie._applyBeatShift(s,1,'drone');}
assert.equal(seeks,1,'BPM wobble must not seek');
Movie._applyBeatShift(s,2,'drone');assert.equal(time,6.5);assert.equal(seeks,2);
Movie._applyBeatShift(s,0,'drone');assert.equal(time,5);
Movie._clearFrames=()=>{};
Movie._resetPlaybackState(s);assert.equal(s._bShiftSec,0);assert.equal(s._bShiftBeats,0);
Movie._applyBeatShift(s,1,'drone');assert.equal(time,6,'new media gets offset');
Movie._resetPlaybackState(s,false,false);Movie._applyBeatShift(s,1,'drone');
assert.equal(time,6,'late buffer restore does not apply twice');
s._modePhase='reverse';s._revT=4;Movie._applyBeatShift(s,2,'drone');assert.equal(s._revT,5);
const n=seeks;BPM.bpm=200;Movie._applyBeatShift(s,2,'drone');assert.equal(seeks,n);
Movie._applyBeatShift(s,0,'drone');assert.equal(s._revT,3);
Movie._applyBeatShift(s,.5,'beat');assert.equal(s._bShiftBeats,0);
console.log('PASS: all Code kinds, private state/seed/TD modules, Shredder/Boltzmann GPU ownership, dispatch clocks, video BPM/OFF/reload/reverse');
