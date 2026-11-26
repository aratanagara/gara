'use strict';
// Allocation/ownership regression. No graphics driver is simulated; browser pixel tests are separate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const cp = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const base = process.argv[2] || '243f55742929a44da4d2e5ca5cb21cafe9ab7c67';
function setup(old = false) {
  const document = {createElement: () => canvas()};
  function canvas(w = 0, h = 0) {
    return {width:w,height:h,getContext(){return {drawImage(){},clearRect(){},setTransform(){}};}};
  }
  const ctx = vm.createContext({document, performance:{now:()=>10000},console,atob});
  vm.runInContext(`globalThis.TextDeform = {P:{canvasFull:'off',cvSize:1,canvasMax:32,canvasStamps:[]},_fit:{s:1,dx:0,dy:0},_dp:v=>v,_upstreamGlyph:g=>g,_fontMetrics:()=>({})};`,ctx);
  for(const file of ['mode/textdeform-budget.js','mode/textdeform-canvas.js','mode/textdeform-surface.js']) {
    const code = old && !file.includes('budget') ? cp.execFileSync('git',['show',base+':'+file],{cwd:root,encoding:'utf8'}) : fs.readFileSync(path.join(root,file),'utf8');
    vm.runInContext(code,ctx,{filename:file});
  }
  return {ctx, C:ctx.TDCanvas, S:ctx.TDSurf, B:ctx.TDPixels, T:ctx.TextDeform, canvas};
}
function stamps(env,n,pf,seed,full=false) {
  const {T,C,canvas}=env;
  T.P.canvasStamps=[];C._inst.clear();C._pixelQ=1;
  C._needsFull=()=>full;
  for(let i=0;i<n;i++) {
    const st={s:1,seed:seed??i*9973+1};T.P.canvasStamps.push(st);
    const cv=canvas();
    C._inst.set(st,{_stamp:true,_pf:pf,_needPf:0,_born:0,P:{},canvas:cv,ctx:cv.getContext('2d')});
  }
}
let cases=0, equal=0;
for(const [w,h] of [[1920,1080],[3840,2160],[4096,4096],[7680,4320]])
for(const n of [1,7,12,32]) for(const pf of [1,2,4]) for(const seed of [undefined,84802]) for(const full of [false,true]) {
  const fresh=setup(), old=setup(true);
  for(const env of [fresh,old]) {stamps(env,n,pf,seed,full);env.C._prepareResolution(w,h,10000);}
  const dims=e=>[...e.C._inst.values()].map(i=>[i._raster.pw,i._raster.ph]);
  const pixels=e=>dims(e).reduce((a,[w,h])=>a+w*h,0);
  assert.ok(pixels(fresh)<=24e6,JSON.stringify({w,h,n,pf,seed,full,px:pixels(fresh)}));
  if(pixels(old)<=24e6){assert.deepEqual(dims(fresh),dims(old));equal++;}
  cases++;
}
console.log(`PASS: ${cases} stamp cases <= 24M; ${equal} under-budget cases identical to baseline`);
{
  const e=setup();stamps(e,32,4,84802);e.C._prepareResolution(1920,1080,10000);
  console.log('32 worst-case stamps:',[...e.C._inst.values()].reduce((a,i)=>a+i._raster.pw*i._raster.ph,0),'pixels; q',e.C._pixelQ);
}
{
  const {C,T}=setup();T.P.canvasStamps=Array.from({length:40},()=>({}));C._make=()=>({});C._sync();assert.equal(C._inst.size,32);assert.equal(T.P.canvasStamps.length,32);
}
function surface(env) {
  const {S,T,ctx}=env;
  S.status='ready';S.meta={ops:{a:{},b:{},c:{}}};S.cfg.enabled=true;S.cfg.ops=['a','b','c'];S.cfg.params={};
  S._params=()=>({});S.strength=()=>1;S.glyphActive=()=>true;S._collectFontCss=()=>[];S._opOpacity=()=>1;S._opBlend=()=> 'source-over';S._forcedOpaque=()=>false;
  ctx.TypeDeformerSurfaceState={pack:g=>({glyphs:g,surfaces:[]})};
  S.jobs={status:()=>({busy:false}),request(key,frame){this.frame=frame;this.key=key;},invalidate(){},cancel(){S._onJobState({busy:false});}};
  T.P.text='TEST';
}
{
  const e=setup(),{T,C,S,B,canvas}=e;surface(e);
  T.canvas=canvas(3840,2160);B.texturePixels=3840*2160;
  for(let i=0;i<24;i++) C._inst.set({}, {_stamp:true,full:canvas(1000,1000),canvas:canvas()});
  T._heroCv=canvas(2000,2000);C._bgHold=canvas(3840,2160);
  S.layers=[{canvas:canvas(1000,1000)}];S._held=S.layers; // shared ownership counts once
  assert.equal(B.used(),65536+3840*2160*3+24e6+4e6+1e6);
  S.request([{i:0,ch:'A'}],3840,2160);
  assert.ok(S.jobs.frame.width<1920);assert.ok(B.used()<=B.limit);
  const pendingPixels=B.reserved(S),req=S._pending;
  S.jobs.status=()=>({busy:true});S._dirty=true;S.request([{i:0,ch:'A'}],640,360);
  assert.equal(B.reserved(S),pendingPixels,'keep larger in-flight reservation when replacing waiting job');
  const r=S._pending;
  const bitmaps={};for(const op of r.ops) bitmaps[op.id]={close(){this.closed=true;}};
  S._onJobState({busy:false,ready:true,key:r.key,result:{kind:'frame',layers:bitmaps}});
  assert.equal(S.layers.length,3);assert.equal(B.reserved(S),0);assert.ok(Object.values(bitmaps).every(b=>b.closed));assert.ok(B.used()<=B.limit);
  S.cfg.enabled=false;S._reset();assert.equal(S.layers.length,0);assert.equal(S._pool.length,0);assert.equal(B.reserved(S),0);
  console.log('PASS: shared 64M budget, Full + held Surface, pending replacement, result close and Off');
}
{
  const e=setup(),{S,B}=e;surface(e);S.cfg.ops=['a','a','b'];assert.equal(S.activeOps().length,2);
  S.request([{i:0,ch:'A'}],1920,1080);assert.equal(S.jobs.frame.width,1920);assert.equal(S.jobs.frame.height,1080);assert.equal(B.reserved(S),1920*1080*4);
  S._onJobState({busy:false,error:'test',key:S._pending.key});assert.equal(B.reserved(S),0);
  const key={};assert.ok(B.reserve(key,B.limit-B.used()));assert.equal(B.fit(100,100).w,0);B.reserve(key,0);
}
console.log('PASS: restore cap, operator deduplication, error cleanup and zero headroom');

{
  const {B}=setup();
  const header=Buffer.alloc(48);header.write('RIFF',0);header.write('WEBP',8);header.write('VP8X',12);header.writeUIntLE(4095,24,3);header.writeUIntLE(2047,27,3);
  const src=()=> 'data:image/webp;base64,'+header.toString('base64');
  assert.equal(B.webpPixels(src()),4096*2048);
  header[20]=2;assert.equal(B.webpPixels(src()),0);header[20]=0;
  header.write('VP8 ',12);header[23]=157;header[24]=1;header[25]=42;header.writeUInt16LE(640,26);header.writeUInt16LE(360,28);
  assert.equal(B.webpPixels(src()),640*360);
  header.write('VP8L',12);header[20]=47;header[21]=127;header[22]=194;header[23]=89;header[24]=0;
  assert.equal(B.webpPixels(src()),640*360);
  assert.equal(B.webpPixels('data:image/png;base64,'),0);
  console.log('PASS: static WebP dimensions checked before decode; animated/unknown inputs rejected');
}
// Exercise the real render queue: invalidate keeps the in-flight lease, discarded results close,
// timeout/cancel release, and a received frame replaces the reservation with actual canvases.
{
  const e=setup(),{ctx,S,B}=e;surface(e);
  const workers=[],timers=new Map();let timerId=0;
  ctx.setTimeout=fn=>{timers.set(++timerId,fn);return timerId;};ctx.clearTimeout=id=>timers.delete(id);
  vm.runInContext(fs.readFileSync(path.join(root,'mode/typedeformer/render-jobs.js'),'utf8'),ctx);
  S.jobs=ctx.TypeDeformerRenderJobs.create({
    editTimeout:30000,interruptAfter:180,
    workerFactory(){const w={postMessage(job){this.job=job;},terminate(){this.stopped=true;}};workers.push(w);return w;},
    onState:s=>S._onJobState(s)
  });
  S.request([{i:0,ch:'A'}],1920,1080);const worker=workers[0],first=worker.job;
  const reservation=B.reserved(S);assert.ok(reservation>0);
  S._reset();assert.equal(B.reserved(S),reservation);
  S.request([{i:0,ch:'B'}],640,360);assert.equal(B.reserved(S),reservation);
  const stale={close(){this.closed=true;}};
  worker.onmessage({data:{type:'result',id:first.id,result:{layers:{a:stale}}}});
  assert.ok(stale.closed);assert.ok(B.reserved(S)>0);
  const latest=worker.job;const layers=Object.fromEntries(['a','b','c'].map(id=>[id,{close(){this.closed=true;}}]));
  worker.onmessage({data:{type:'result',id:latest.id,result:{kind:'frame',layers}}});
  assert.equal(S.layers.length,3);assert.equal(B.reserved(S),0);assert.ok(B.used()<=B.limit);
  S.request([{i:0,ch:'C'}],1920,1080);assert.ok(B.reserved(S)>0);
  for(const fn of [...timers.values()]) fn();assert.equal(B.reserved(S),0);
  S._retryAt=0;S.request([{i:0,ch:'D'}],1920,1080);
  S.cfg.enabled=false;S._reset();assert.equal(B.reserved(S),0);assert.equal(S.layers.length,0);
  console.log('PASS: real queue invalidate, stale reply, queued replacement, timeout and cancel');
}
// Allocation transitions, not just final sizes: every individual width/height assignment stays
// within the shared cap when ownership includes old Full images, ghosts and Surface pools.
{
  const {B,C,S,T}=setup();let peak=0;
  function tracked(w=0,h=0){
    const c={_w:w,_h:h};
    for(const k of ['width','height'])Object.defineProperty(c,k,{get(){return this[k==='width'?'_w':'_h'];},set(v){this[k==='width'?'_w':'_h']=v;peak=Math.max(peak,B.used());assert.ok(B.used()<=B.limit);}});
    return c;
  }
  T.canvas=tracked(3840,2160);B.texturePixels=3840*2160;
  for(let i=0;i<32;i++)C._inst.set({}, {_stamp:true,canvas:tracked(),full:tracked()});
  T._heroCv=tracked();C._bgHold=tracked();C._heroCache=tracked();
  const targets=[...C._inst.values()].flatMap(i=>[i.canvas,i.full]).concat([T._heroCv,C._bgHold,C._heroCache]);
  for(let frame=0;frame<80;frame++){
    const i=frame%targets.length,c=targets[i];B.resize(c,4000-frame*17,3000+frame*9);
    if(frame%4===0){B.free(c);C._pool.push(c);C._pool.pop();}
  }
  assert.ok(peak<=64e6);console.log('PASS: allocation transitions peak',peak,'pixels <= 64M');
}
{
  const {ctx,C,B,T}=setup();
  class Image {
    constructor(){this.width=this.height=this.naturalWidth=this.naturalHeight=0;}
    removeAttribute(){this.width=this.height=this.naturalWidth=this.naturalHeight=0;this.src='';}
  }
  ctx.Image=Image;
  const header=Buffer.alloc(48);header.write('RIFF',0);header.write('WEBP',8);header.write('VP8X',12);header.writeUIntLE(999,24,3);header.writeUIntLE(499,27,3);
  const st={img:'data:image/webp;base64,'+header.toString('base64')};T.P.canvasStamps=[st];C._sync();
  const im=C._inst.get(st).img;assert.equal(B.reserved(im),500000);assert.equal(B.used(),565536);
  im.naturalWidth=1000;im.naturalHeight=500;im.onload();assert.equal(B.reserved(im),0);assert.equal(B.used(),565536);
  C._drop(st);assert.equal(B.used(),65536);
  C._sync();const loading=C._inst.get(st).img;C._drop(st);assert.equal(B.reserved(loading),0);
  console.log('PASS: decoded WebP replaces its reservation once; deletion cancels pending decode');
}
// With identical glyph snapshots, under-budget drawing commands (including colors/transforms)
// stay byte-for-byte equal. This is a deterministic rendering-input check, not a GPU pixel test.
function renderTrace(old,variant) {
  const ctx=vm.createContext({console}),trace=[];
  vm.runInContext(fs.readFileSync(path.join(root,'mode/textdeform-budget.js'),'utf8'),ctx);
  vm.runInContext(old?cp.execFileSync('git',['show',base+':mode/textdeform.js'],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,'mode/textdeform.js'),'utf8'),ctx);
  const T=vm.runInContext('TextDeform',ctx);
  T.canvas={width:640,height:360};
  T.ctx=new Proxy({}, {get:(_,k)=>(...args)=>trace.push([k,...args]),set:(_,k,v)=>{trace.push(['set',k,v]);return true;}});
  T._fit={w:640,h:360,s:1,dx:2,dy:3,cx:1,cy:1};T._fitDirty=false;
  Object.assign(T.P,{canvasOn:false,transparentBg:variant%2===1,vertical:variant>=2,palOn:variant===3});
  T._readFx=()=>({viewAngle:12,misA:0.4,misR:0.7});T._overlayFx=()=>{};
  T._snapshotGlyphs=()=>[{ch:'A',i:0,x:10,y:20,w:30,h:40,ox:25,oy:40,tx:2,ty:-1,scaleX:1.2,scaleY:0.8,mirX:1,mirY:1,rot:5,bl:0.2,misX:3,misY:2}];
  T._fontMetrics=()=>({ascent:30,descent:10});
  T._renderToCanvas(640,360);
  return trace;
}
for(let variant=0;variant<4;variant++)assert.deepEqual(renderTrace(false,variant),renderTrace(true,variant));
console.log('PASS: 4 under-budget render command traces match baseline (transparent, vertical, palette/misregistration)');
