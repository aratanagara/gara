'use strict';
// Master amount contracts. Executes application routes with a recording GL stub; no browser/GPU.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..'), storage = new Map(), elements = new Map();
const ctx = vm.createContext({
  console, matchMedia:()=>({matches:false}), performance:{now:()=>1000}, Event,
  document:{documentElement:{},addEventListener(){},querySelector:s=>elements.get(s)||null,querySelectorAll:()=>[],getElementById:id=>elements.get('#'+id)||null},
  window:{addEventListener(){},matchMedia:()=>({matches:false})}, navigator:{},
  localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  I18n:{t:s=>s}, setTimeout(){},clearTimeout(){},requestAnimationFrame(){},
});
for(const file of ['fx3d.js','app.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
const {App,GL,Fx3d,UI,MIDI,Prefs} = vm.runInContext('({App,GL,Fx3d,UI,MIDI,Prefs})',ctx);
const keys = ['fx3dExtrude','fx3dPhoto','fx3dSlicer','fx3dLayer','fx3dDiorama','fx3dPoints','fx3dCubes','fx3dBlinds',
  'fx3dTunnel','fx3dGravity','fx3dGlobe','origami','kaiser','kaiserOld','fx3dRoll','uzumaki','river'];
const factory = App.postFactoryDefaults();
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const section = html.slice(html.indexOf('<h3>3D '),html.indexOf('<h3>Pattern'));
const source = fs.readFileSync(path.join(root,'app.js'),'utf8');
const ids = new Map([...source.matchAll(/slid\('([^']+)',\s*'([^']+)'/g)].map(m=>[m[1],m[2]]));
const mainKeys = [...section.matchAll(/<input\b[^>]*type="range"[^>]*>/g)]
  .filter(m=>!m[0].includes('data-sub-of')).map(m=>ids.get(m[0].match(/id="([^"]+)"/)[1])).filter(k=>App.POST_AMOUNT_KEYS.has(k));
assert.deepEqual(mainKeys.sort(),[...keys].sort(),'inventory includes every 3D main amount in HTML');
assert.deepEqual([...App.FX3D_AMOUNT_KEYS].sort(),[...keys].sort());
assert.deepEqual([...Object.values(Fx3d.KEY),'origami','kaiser','kaiserOld','fx3dRoll','uzumaki','river'].sort(),[...keys].sort());
assert.equal(App.post.fx3dAmount,1); assert.equal(factory.fx3dAmount,1);
assert.ok(App.POST_GROUPS.fx3d.includes('fx3dAmount'));
assert.ok(!App.POST_AMOUNT_KEYS.has('fx3dAmount'));
const amountInput = section.match(/<input[^>]*id="pxFx3dAmount"[^>]*>/)[0];
for(const attr of ['min="0"','max="1"','value="1"','data-norand="1"']) assert.ok(amountInput.includes(attr));
assert.ok(section.indexOf('id="pxFx3dAmount"')>section.indexOf('>設定</h4>'));
assert.ok(section.indexOf('id="pxFx3dAmount"')<section.indexOf('id="pxFx3dStack"'));
assert.ok(!amountInput.includes('data-no-midi'));
assert.match(source,/slid\('pxFx3dAmount','fx3dAmount', f2\)/);
assert.match(source,/set\('pxFx3dAmount', p.fx3dAmount != null \? p.fx3dAmount : 1, f2\)/);

// Product is taken before the existing dead zone, preserving the exact old calculation at 1.
for(const stack of ['build','chain']) for(const value of [0,0.09,0.1,0.19,0.2,0.4,0.7,1]){
  const raw = {...factory,fx3dStack:stack,...Object.fromEntries(keys.map(k=>[k,value]))};
  const baseline = App.effectivePost(raw);
  for(const master of [1,0.5,0,0.09,0.1]){
    const p = {...raw,fx3dAmount:master}, before = JSON.stringify(p), effective = App.effectivePost(p);
    for(const k of keys){
      assert.equal(App.fx3dAmount(p,k),value*master,k+' raw product');
      assert.equal(effective[k],App.deadParam(value*master),k+' dead zone after product');
    }
    for(const k in baseline) if(k!=='fx3dAmount' && !keys.includes(k)) assert.deepEqual(effective[k],baseline[k],k+' unchanged');
    assert.equal(JSON.stringify(p),before,'rendering does not mutate settings');
  }
  delete raw.fx3dAmount;
  for(const k of keys) assert.equal(App.effectivePost(raw)[k],baseline[k],k+' absent master = 1');
}

// Legacy Audio Drive arithmetic is preserved at 1, including all non-3D parameters.
App._audioEnv=()=>0.6;
function legacyEffective(raw){
  const out={...raw};
  for(const k in out) if(typeof out[k]==='number') out[k]=App.deadParam(out[k]);
  const amt=Math.max(0,Math.min(1,out.audioFx||0));
  for(const k in out){
    if(App.AUDIO_MOD_EXCLUDE[k] || typeof out[k]!=='number' || Math.abs(out[k])<1e-6) continue;
    const base=out[k], r=MIDI.postRange[k], hi=r?r[1]:1, lo=r?r[0]:0;
    out[k]=base+Math.sign(base||1)*Math.max(0,base>=0?hi-base:base-lo)*0.6*amt;
  }
  return out;
}
for(const audioFx of [0,0.4,1]){
  const raw={...factory,audioFx,...Object.fromEntries(keys.map(k=>[k,0.7]))};
  const old=legacyEffective(raw), current=App.effectivePost(raw);
  for(const k in old) assert.deepEqual(current[k],old[k],k+' legacy audio parity');
  const half=App.effectivePost({...raw,fx3dAmount:0.5});
  assert.equal(half.fx3dAmount,0.5+0.5*0.6*App.deadParam(audioFx),'master participates in Drive');
  for(const k of keys){
    assert.ok(half[k]<=App.deadParam(half.fx3dAmount),'Drive respects master ceiling');
    assert.equal(App.effectivePost({...raw,fx3dAmount:0})[k],0,'Drive cannot revive muted FX');
  }
}

// Actual engine routing, H, shape hook, folding, and the Pop off tail in both stack modes.
let nextId=0; const calls=[], routes=[], folds=[];
const gl=new Proxy({}, {get(o,k){
  if(k in o) return o[k];
  if(/^[A-Z_0-9]+$/.test(k)) return o[k]=++nextId;
  return o[k]=(...args)=>{
    calls.push([k,...args]);
    if(k.startsWith('create')) return {id:++nextId};
    if(k==='getUniformLocation') return {p:args[0],name:args[1]};
    if(k.startsWith('uniform') && args[0]) (args[0].p.u||={})[args[0].name]=args.slice(1);
  };
}});
GL.gl=gl; GL.clock=1; GL._finalFBO={w:640,h:360,tex:{},fbo:{}};
GL.slots={A:{kind:'none',params:[]},B:{kind:'none',params:[]}};
GL._ovSync=()=>null; GL._fx3dBgUnder=()=>{};
GL.foldStackProg={}; GL.foldProg={}; GL.uzumakiProg={}; GL.passageProg={};
GL._fx3dHeight={valid:true,frame:GL.frame};
GL._foldBuild=(p,...args)=>{folds.push(args);return {};};
for(const n of Fx3d.ORDER) Fx3d.EXTRA[n]={foldHook:true,spikes:true};
for(const n of ['globe','tunnel']) Fx3d.EXTRA[n].shapeState=o=>({k:o.k});
Fx3d.render=(name,o)=>{routes.push({name,o,shape:Fx3d.shapeFrame,spike:Fx3d.spikeFrame});return false;};
App.visualBeat=()=>1;
for(const stack of ['build','chain']){
  App.post={...factory,fx3dStack:stack,fx3dPop:'off',...Object.fromEntries(keys.map(k=>[k,0.8]))};
  for(const master of [1,0.5]){
    App.post.fx3dAmount=master; const p=App.effectivePost(App.post), e=App.deadParam(0.8*master);
    Fx3d.popFrame(p,false); routes.length=0; folds.length=0;
    GL._apply3dFx(p,false);
    assert.ok(routes.length>0);
    for(const r of routes) assert.equal(r.o.e,e,r.name+' gets effective amount once');
    assert.equal(GL._gravFold,e,'integrated Gravity');
    assert.ok(folds.length>0); assert.deepEqual(folds.at(-1).slice(0,4),[0,e,e,e],'Needle taken by spike; remaining folds attenuated');
    assert.equal(!!routes[0].o.heightOnly,stack==='build');
    assert.equal(!!routes.at(-1).shape,stack==='build');
    assert.equal(routes.at(-1).spike.a,e*Math.min(1,e/0.16)**2*(3-2*Math.min(1,e/0.16)));
    let passage=0;
    GL._runFinalPost=(pr,tmp,bind)=>{passage++;bind(pr);};
    GL._applyPassagePost(p,false);
    assert.equal(passage,1); assert.equal(GL.passageProg.u.uAmount[0],App.deadParam(e),'Passage retains its existing second map');
  }
  App.post.fx3dPop='back'; App.post.fx3dAmount=1;
  Fx3d.popFrame(App.effectivePost(App.post),false);
  const off=App.effectivePost({...App.post,...Object.fromEntries(keys.map(k=>[k,0]))});
  Fx3d.popFrame(off,false);
  assert.ok(Fx3d.ORDER.every(n=>Fx3d.effE[n]>0),'ordinary FX off still has the original Pop tail at 1');
  const muted=App.effectivePost({...App.post,fx3dAmount:0,fx3dOverscan:20});
  GL.compositeProg={};
  assert.equal(GL._matteFrame(muted),null,'no paper extraction even before popFrame clears last frame');
  GL._osHold=60; GL._osM=0.2; GL._osUpdate(muted);
  assert.equal(GL._osM,0,'no retained overscan');
  GL._fx3dForceG=1; GL._fx3dGate=1; GL._fx3dFrame={};
  GL._fx3dUpdate(muted,0.016,640,360);
  assert.equal(GL._fx3dFrame,null); assert.equal(GL._fx3dG,0,'native gate does not linger');
  calls.length=0; routes.length=0;
  GL._fx3dBgPrep(muted,false);
  assert.ok(Fx3d.ORDER.every(n=>Fx3d.effE[n]===0),'no Pop tail');
  GL._apply3dFx(muted,false);
  assert.equal(GL._applyFoldStack(muted,false),false);
  GL._applyKaiserPost(muted,false); GL._applyUzumakiPost(muted,false);
  GL._runFinalPost=()=>assert.fail('Passage must skip'); GL._applyPassagePost(muted,false);
  assert.equal(routes.length,0); assert.equal(calls.length,0,'all 3D passes skip drawing');
  assert.equal(GL._fx3dHeight.valid,false); assert.equal(GL._gravFold,0);
  App.post.fx3dAmount=1; Fx3d.popFrame(App.effectivePost(App.post),false);
  for(const n of Fx3d.ORDER) assert.equal(Fx3d.effE[n],App.deadParam(0.8),'master restores original amount');
}

// Save/Reset, R (including fade target), Esc, preset serialization, and old presets with saved master != 1.
App.uploadDefs=()=>{}; UI.refreshAll=()=>{}; UI.refreshPost=()=>{};
App.resetUserPanZoom=()=>{}; App._undoPushNow=()=>{}; App._undoSnap=()=>({});
GL.startPresetTrans=()=>{}; App._factoryDefaults=null;
App._presetDefaults={post:{...factory}}; App.post={...factory,fx3dAmount:0.6,fx3dPhoto:0.8};
App.savePostGroupDefault('fx3d');
assert.equal(JSON.parse(storage.get('vj.def.post.fx3d')).fx3dAmount,0.6);
App.post.fx3dAmount=0; App.post.fx3dPhoto=0; App.resetPostGroupDefault('fx3d');
assert.equal(App.post.fx3dAmount,0.6); assert.equal(App.post.fx3dPhoto,0.8);
App._fadeBeats=()=>0; App.post.fx3dAmount=0; App.resetParamsAll();
assert.equal(App.post.fx3dAmount,0.6); assert.equal(App.post.fx3dPhoto,0);
const applyFaded=App.applyPostFaded; let fadeTarget;
App.applyPostFaded=t=>{fadeTarget=t;}; App._fadeBeats=()=>1; App.resetParamsAll();
assert.equal(fadeTarget.fx3dAmount,0.6); assert.equal(fadeTarget.fx3dPhoto,0);
App.applyPostFaded=applyFaded; App._fadeBeats=()=>0;
vm.runInContext('var PRESETS=[];',ctx);
App.post.fx3dAmount=0; App.escResetAll(); assert.equal(App.post.fx3dAmount,0.6);
storage.clear(); App._presetDefaults.post={...factory}; App.post.fx3dAmount=0;
App.resetParamsAll(); assert.equal(App.post.fx3dAmount,1);
App.post.fx3dAmount=0; App.escResetAll(); assert.equal(App.post.fx3dAmount,1);
storage.set('vj.def.post.fx3d',JSON.stringify({fx3dPhoto:0.8}));
assert.equal(App.postDefaults().fx3dAmount,1,'old group defaults');
App._presetDefaults.post={...factory,fx3dAmount:0.3};
App._restoreModeStates=()=>{throw 'post-tested';}; App.setSlotABg=()=>{};
const warn=console.warn; console.warn=()=>{};
try{
  for(const state of [{post:{fx3dPhoto:0.8}},{post:{}},{}]){
    App.post={...factory,fx3dAmount:0}; App._applyState(state,{resetMissingDefaults:true,instantPost:true});
    assert.equal(App.post.fx3dAmount,1,'old preset ignores saved master and previous current value');
  }
  for(const amount of [0,0.5,1]){
    App._applyState({post:{fx3dAmount:amount}},{resetMissingDefaults:true,instantPost:true});
    assert.equal(App.post.fx3dAmount,amount);
  }
} finally {console.warn=warn;}
UI.activePresetIdx={A:-1,B:-1}; App.post.fx3dAmount=0.5;
assert.equal(App._collectState().post.fx3dAmount,0.5);

// MIDI target/HUD, actual Random filtering, and translated help.
assert.deepEqual([...MIDI.postRange.fx3dAmount],[0,1]);
assert.equal(MIDI._paramLabel('__post__fx3dAmount'),'3D Amount');
MIDI._continuousValue=(_,v)=>v;
MIDI._applyMapping('*','__post__fx3dAmount','cc:1',64,true);
assert.equal(App.post.fx3dAmount,0.5);
const master={id:'pxFx3dAmount',tagName:'INPUT',dataset:{norand:'1'},min:'0',max:'1',step:'0.01',value:'0.5'};
const photo={id:'pxFx3dPhoto',tagName:'INPUT',dataset:{},min:'0',max:'1',step:'0.01',value:'0',closest:()=>null,
  getAttribute:()=> '0',dispatchEvent(){App.post.fx3dPhoto=+this.value;}};
const sec={querySelector:()=>null,querySelectorAll:s=>s.includes('data-sub-of')?[]:[master,photo]};
for(let i=0;i<8;i++) UI._randomizePostSection(sec);
assert.equal(master.value,'0.5'); assert.equal(App.post.fx3dAmount,0.5);
assert.ok(App.post.fx3dPhoto>=0.25 && App.post.fx3dPhoto<=0.8);
vm.runInContext(fs.readFileSync(path.join(root,'i18n.js'),'utf8'),ctx);
const title=amountInput.match(/title="([^"]+)"/)[1];
assert.match(ctx.window.I18n.t(title),/^Scale all configured 3D FX amounts/);
console.log('PASS: 17 amounts, 1/half/zero + dead-zone boundaries, unchanged subparameters, legacy parity/Audio Drive, Build/Chain/H/shape/folds/Gravity/Passage, zero draw/Pop/native/matte/overscan, Save/Reset/R/Esc/fade/old presets/state, MIDI/HUD/Random/i18n');
