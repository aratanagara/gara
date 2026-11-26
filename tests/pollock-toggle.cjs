'use strict';
// CPU / DOM-event / render-call contracts. Browser and GPU checks belong to Claude.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const storage = new Map(), elements = new Map(), errors = [];
class Element {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase(); this.dataset = {}; this.events = {}; this.style = {};
    this.attrs = attrs; Object.assign(this, attrs);
    this.value = attrs.value || ''; this.checked = false; this.options = [];
    this.row = {style:{}, querySelector:s=>s === 'label.sub-label' && !this.dataset.subOf ? null : {textContent:this.id}};
    for(const [k,v] of Object.entries(attrs)) if(k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())] = v;
  }
  addEventListener(k, fn) { (this.events[k] ||= []).push(fn); }
  dispatchEvent(e) { for(const fn of this.events[e.type] || []) fn(e); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  querySelectorAll() { return []; }
  closest() { return this.row; }
  set selectedIndex(i) { this.value = this.options[i].value; }
  get selectedIndex() { return this.options.findIndex(o=>o.value===this.value); }
}
for(const m of html.matchAll(/<(input|select|div)\b([^>]*\bid="pxPollock[^"]*"[^>]*)>/g)) {
  const attrs = Object.fromEntries([...m[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
  elements.set(attrs.id, new Element(m[1], attrs));
}
const on = elements.get('pxPollockOn'), amount = elements.get('pxPollock'), type = elements.get('pxPollockType');
elements.set('pxMixerShow',new Element('div'));
type.options = [...html.match(/<select id="pxPollockType"[\s\S]*?<\/select>/)[0].matchAll(/value="(\w+)"/g)].map(m=>({value:m[1]}));
const details = [...elements.values()].filter(e=>e.dataset.subOf);
const sec = {
  addEventListener(){},
  querySelector:s=>s.startsWith('#') ? elements.get(s.slice(1)) || null : null,
  querySelectorAll:s=>s === 'input[type=range], select' ? [amount, type, ...details] : s.includes('data-sub-of') ? details : [],
};
const document = {
  addEventListener(){}, querySelector:s=>s.startsWith('#') ? elements.get(s.slice(1)) || null : s.startsWith('.pane') ? sec : null,
  querySelectorAll:()=>[], getElementById:id=>elements.get(id) || null,
};
const renders = [], blurs = [], resets = [];
const PollockFX = {initialized:true, _style:'gloss', alive:false, isAlive(){return this.alive;},
  render(o){renders.push({...o, opts:{...this.opts}}); return 0.5;},
  reset(gl,w,h,style){resets.push(style); this._style=style;}, blur:o=>blurs.push(o)};
const ctx = vm.createContext({
  document, window:{addEventListener(){}, matchMedia:()=>({matches:false})}, navigator:{},
  matchMedia:()=>({matches:false}), performance:{now:()=>1000}, Event,
  localStorage:{getItem:k=>storage.get(k) ?? null, setItem:(k,v)=>storage.set(k,String(v)), removeItem:k=>storage.delete(k)},
  setTimeout(){},clearTimeout(){},requestAnimationFrame(){},
  I18n:{t:s=>s}, console:{...console, warn:(...a)=>errors.push(a), error:(...a)=>errors.push(a)},
  PollockFX, PRESETS:[],
});
vm.runInContext(source, ctx, {filename:'app.js'});
const run = s=>vm.runInContext(s, ctx);
const {App,UI,MIDI,GL,Net} = run('({App,UI,MIDI,GL,Net})');
const plain = v=>JSON.parse(JSON.stringify(v));
const oldKeys = ['pollockGloss','pollockMatt','pollockFlat','pollockMetal'];
const subKeys = ['Size','Length','Density','Drops','Curve','Life','Relief'].map(k=>'pollock'+k);
const noOld = p=>oldKeys.forEach(k=>assert.ok(!(k in p), k+' removed'));
const pk = p=>Object.fromEntries(['pollockOn','pollockType','pollock',...subKeys].filter(k=>k in p).map(k=>[k,p[k]]));
const migrate = p=>App.migratePollockPost({...p});
const factory = App.postFactoryDefaults();
assert.deepEqual(pk(App.post),pk(factory));
assert.equal(factory.pollockOn,0); assert.equal(factory.pollock,0); assert.equal(factory.pollockType,'gloss');
subKeys.forEach(k=>assert.equal(factory[k],0.5)); noOld(factory);
assert.deepEqual(plain(migrate({})),{}); assert.equal(App.migratePollockPost(null),null);
for(const [i,k] of oldKeys.entries()) {
  const p=migrate({[k]:0.63,pollockSize:0.28}); noOld(p);
  assert.deepEqual(pk(p),{pollockOn:1,pollockType:['gloss','matt','flat','metal'][i],pollock:0.63,pollockSize:0.28});
}
for(const [legacy,expected] of [
  [{pollockGloss:.7,pollockMatt:.7},'gloss'],
  [{pollockGloss:.7,pollockMatt:.7,pollockMetal:.7},'metal'],
  [{pollockGloss:.7,pollockMatt:.7,pollockMetal:.7,pollockFlat:.7},'flat'],
  [Object.fromEntries(oldKeys.map(k=>[k,0])),'flat'],
]) assert.equal(migrate(legacy).pollockType,expected);
for(const v of [0,.001,.0011]) assert.equal(migrate({pollockMatt:v}).pollockOn,v>.001?1:0);
const mixed=migrate({pollockOn:0,pollockType:'matt',pollock:.42,pollockFlat:.9});
assert.deepEqual(pk(mixed),{pollockOn:0,pollockType:'matt',pollock:.42}); noOld(mixed);
assert.deepEqual(pk(migrate(mixed)),pk(mixed),'idempotent');

// Compare the real render arguments against the old winner calculation, including the dead zone.
GL.gl={bindFramebuffer(){},blitFramebuffer(){},bindVertexArray(){},viewport(){}};
GL._finalFBO={w:16,h:16,fbo:{}}; GL._pollockTmp={tex:{},fbo:{}}; GL._resizeFBO=()=>{};
App.visualBeat=()=>1;
function legacyDraw(p) {
  const g=App.deadParam(p.pollockGloss||0), m=App.deadParam(p.pollockMatt||0);
  const f=App.deadParam(p.pollockFlat||0), x=App.deadParam(p.pollockMetal||0);
  if(f>=g&&f>=m&&f>=x) return {value:f,flat:f>.001,metal:false};
  if(x>=g&&x>=m) return {value:x,flat:false,metal:true};
  if(g>=m) return {value:g,flat:false,metal:false};
  return {value:-m,flat:false,metal:false};
}
function draw(p,safe=false) {
  renders.length=0; blurs.length=0; App.post={...factory,...p};
  GL._applyPollockFinal(App.effectivePost(App.post),safe);
  return renders[0];
}
const values=[0,.001,.05,.099,.1,.3,.7,1]; let comparisons=0;
PollockFX.alive=true;
for(const g of values) for(const m of values) for(const f of values) for(const x of values) {
  const legacy={pollockGloss:g,pollockMatt:m,pollockFlat:f,pollockMetal:x};
  const r=draw(migrate(legacy));
  assert.deepEqual({value:r.value,flat:r.flat,metal:r.metal},legacyDraw(legacy)); comparisons++;
}
for(const style of ['gloss','matt','flat','metal']) {
  const p={pollockOn:1,pollockType:style,pollock:.7,...Object.fromEntries(subKeys.map((k,i)=>[k,.2+i*.1]))};
  GL._pkCapture=true;
  const r=draw(p);
  assert.equal(resets.at(-1),['matt','flat'].includes(style)?'matt':'gloss');
  assert.equal(GL._pkCapture,false);
  assert.ok(r.opts.size>0); assert.equal(r.opts.drops,1); assert.ok(Math.abs(r.opts.curve-1.2)<1e-12);
  const tail=draw({...p,pollockOn:0});
  assert.deepEqual({value:tail.value,flat:tail.flat,metal:tail.metal},{value:0,flat:false,metal:false});
  assert.deepEqual(tail.opts,r.opts,'shared details survive OFF');
  assert.equal(blurs[0].style,PollockFX._style==='matt'?-1:1,'tail keeps its stored style');
  const safe=draw(p,true); assert.equal(safe.value,0); assert.equal(safe.flat,false); assert.equal(safe.metal,false);
}
PollockFX.alive=false;
assert.equal(draw({pollockOn:0,pollock:.8}),undefined);
assert.equal(draw({pollockOn:1,pollock:.001}),undefined);

// Execute the real render-loop capture detection without creating a WebGL context.
const start=source.indexOf('    const bz = !!(Math.abs(post.boltz||0)');
const end=source.indexOf('    // beat モード時',start);
const capture=vm.runInContext('(function(post){'+source.slice(start,end)+'this._pkPrev=pk;})',ctx);
GL._pkPrev=false; GL._pkCapture=false;
capture.call(GL,{pollockOn:0,pollock:.7}); assert.equal(GL._pkCapture,false);
capture.call(GL,{pollockOn:1,pollock:.7}); assert.equal(GL._pkCapture,true);
GL._pkCapture=false; capture.call(GL,{pollockOn:1,pollock:.8}); assert.equal(GL._pkCapture,false);
capture.call(GL,{pollockOn:0,pollock:.8}); capture.call(GL,{pollockOn:1,pollock:.8}); assert.equal(GL._pkCapture,true);

// Real UI handlers and refresh, with only DOM plumbing replaced.
App.post={...factory}; UI._initSubFold=()=>{}; UI.bindPostFx();
assert.equal(on.checked,false); assert.equal(type.value,'gloss');
assert.equal(details.length,7); details.forEach(el=>assert.equal(el.dataset.subOf,'pxPollock'));
assert.equal(amount.dataset.midiKey,'*:__post__pollock');
amount.value='.71'; amount.dispatchEvent(new Event('input'));
type.value='metal'; type.dispatchEvent(new Event('change'));
on.checked=true; on.dispatchEvent(new Event('change')); UI._syncSubRows();
assert.equal(App.post.pollock,.71); assert.equal(App.post.pollockOn,1); assert.equal(App.post.pollockType,'metal');
details.forEach(el=>assert.equal(el.row.style.opacity,''));
on.checked=false; on.dispatchEvent(new Event('change'));
assert.equal(App.post.pollock,.71); details.forEach(el=>assert.equal(el.row.style.opacity,'0.42'));
App.post.pollockOn=1; App.post.pollockType='flat'; App.post.pollock=.62; UI.refreshPost();
assert.equal(on.checked,true); assert.equal(type.value,'flat'); assert.equal(+amount.value,.62);

// Save / Reset preserve the complete Pollock state and share the legacy-default conversion.
App.uploadDefs=()=>{}; UI.refreshAll=()=>{}; UI.refreshManga=()=>{}; UI.refreshSlot=()=>{};
App._presetDefaults={post:{...factory}};
const saved={pollockOn:1,pollockType:'metal',pollock:.64,...Object.fromEntries(subKeys.map((k,i)=>[k,Number((.21+i*.1).toFixed(2))]))};
Object.assign(App.post,saved); App.savePostGroupDefault('material');
const savedJSON=JSON.parse(storage.get('vj.def.post.material')); noOld(savedJSON);
assert.deepEqual(pk(savedJSON),saved); assert.deepEqual(pk(App._presetDefaults.post),saved);
Object.assign(App.post,{pollockOn:0,pollockType:'gloss',pollock:0,pollockSize:.9});
App.resetPostGroupDefault('material'); assert.deepEqual(pk(App.post),saved);
assert.deepEqual(pk(App.postDefaults()),saved,'startup defaults');
storage.set('vj.def.post.material',JSON.stringify({pollockMatt:.6,pollockLength:.9}));
assert.equal(App.postDefaults().pollockType,'matt'); assert.equal(App.postDefaults().pollock,.6);
App.resetPostGroupDefault('material'); App.savePostGroupDefault('material');
noOld(JSON.parse(storage.get('vj.def.post.material')));
const imported=App._validateDefaultsFile({format:'gara-defaults',version:1,defs:{'post.material':{pollockMetal:.8}}});
assert.equal(imported[0][1].pollockType,'metal'); noOld(imported[0][1]);

// Random can choose every type (including Gloss), enables Pollock, and randomizes its details.
for(const [i,style] of ['gloss','matt','flat','metal'].entries()) {
  run('Math.random=()=>'+((i+.2)/4));
  App.post={...factory}; UI._randomizePostSection(sec);
  assert.equal(App.post.pollockOn,1); assert.equal(App.post.pollockType,style);
  assert.ok(App.post.pollock>=.25&&App.post.pollock<=.8);
  subKeys.forEach(k=>assert.notEqual(App.post[k],undefined));
}
const other=new Element('input',{id:'pxRain',type:'range',min:'0',max:'1',step:'.01',value:'0'});
other.row.querySelector=()=>null;
const material={...sec,querySelectorAll:s=>s==='input[type=range], select'?[other,amount,type,...details]:sec.querySelectorAll(s)};
run('Math.random=()=>0'); UI._randomizePostSection(material);
assert.equal(App.post.pollockOn,0); assert.equal(App.post.pollock,0,'other effect selected');

// R (with a fade), Esc and missing preset amounts turn off; type/details return to saved defaults.
App._factoryDefaults=null; App._presetDefaults={post:{...factory,...saved}};
App._undoPushNow=()=>{}; App._undoSnap=()=>null; App.resetUserPanZoom=()=>{};
GL.startPresetTrans=()=>{}; GL.slots={A:{kind:'none',params:[]},B:{kind:'none',params:[]}};
App.paramFadeBeats=.5; App.post={...factory,...saved}; App.resetParamsAll();
assert.equal(App.post.pollockOn,0); assert.ok(App._paramFades.some(f=>f.key==='pollock'&&f.to===0));
assert.ok(!App._paramFades.some(f=>f.key==='pollockOn'),'toggle never fades through fractions');
App.post={...factory,...saved}; App.escResetAll();
assert.equal(App.post.pollockOn,0); assert.equal(App.post.pollock,0);
assert.equal(App.post.pollockType,'metal'); assert.equal(App.post.pollockSize,saved.pollockSize);
for(const s of [{post:{}},{}]) {
  App.post={...factory,...saved}; App._applyState(s,{resetMissingDefaults:true,instantPost:true});
  assert.equal(App.post.pollockOn,0); assert.equal(App.post.pollock,0); assert.equal(App.post.pollockType,'metal');
}
const oldState={post:{pollockGloss:.2,pollockFlat:.8,pollockLife:.31}};
for(const restore of [
  ()=>App._applyState(oldState,{resetMissingDefaults:true,instantPost:true}),
  ()=>{storage.set('vj.state',JSON.stringify(oldState)); App.paramFadeBeats=0; App.loadLocal();},
  ()=>App._undoApply(JSON.stringify(oldState)),
]) {
  App.post={...factory}; restore(); noOld(App.post);
  assert.equal(App.post.pollockType,'flat'); assert.equal(App.post.pollock,.8); assert.equal(App.post.pollockOn,1);
  assert.equal(App.post.pollockLife,.31);
}
const oldCollect=App._collectState;
App._collectState=()=>({post:{...oldState.post}});
const preset=App._capturePresetState(); noOld(preset.post); assert.equal(preset.post.pollockType,'flat');
App._collectState=oldCollect;

// Audio Drive keeps the previous Material exclusion for both amount and toggle.
App._audioEnv=()=>1;
const driven=App.effectivePost({...factory,...saved,audioFx:1});
assert.equal(driven.pollock,App.deadParam(saved.pollock)); assert.equal(driven.pollockOn,1);

// All stored formats, collisions and tombstones route to the amount without losing old CCs.
const legacyMap=JSON.parse(fs.readFileSync(path.join(root,'midimap.json'),'utf8'));
const map=MIDI.migratePollockMap(legacyMap);
assert.equal(Object.keys(map).length,Object.keys(legacyMap).length);
for(const style of ['Gloss','Matt','Flat','Metal']) {
  for(const key of ['*:__post__pollock'+style,'*:dom~id~pxPollock'+style,'*:dom~Pollock_'+style,'pxPollock'+style]) {
    const mapped=MIDI.migratePollockMap({[key]:{cc:32,type:'cc'}});
    assert.equal(Object.keys(mapped)[0],'*:__post__pollock~'+style.toLowerCase());
  }
}
const tomb=MIDI.migratePollockMap({'*:__post__pollockGloss':null}); assert.equal(tomb['*:__post__pollock~gloss'],null);
assert.deepEqual(plain(MIDI.migratePollockMap(map)),plain(map));
MIDI._continuousValue=(_,v)=>v; MIDI._pickupBlocks=()=>false; MIDI._reversalFade=()=>false;
App.paramFadeBeats=0; App.post={...factory,pollockOn:1,pollockType:'metal'};
for(const pname of ['__post__pollock',...['gloss','matt','flat','metal'].map(t=>'__post__pollock~'+t)]) {
  App.post.pollock=0; MIDI._applyMapping('*',pname,'cc:32',127,false);
  assert.equal(App.post.pollock,1); assert.equal(App.post.pollockType,'metal'); assert.equal(MIDI._paramLabel(pname),'Pollock');
}
MIDI._applyMapping('*','__post__pollockOn','cc:1',0,false); assert.equal(App.post.pollockOn,0);
MIDI._applyMapping('*','__post__pollockOn','cc:1',127,false); assert.equal(App.post.pollockOn,1);
assert.equal(MIDI._applyMapping('*','__post__pollockOn','note:1',127,false),0,'HUD receives the toggled value'); assert.equal(App.post.pollockOn,0);
MIDI._applyMapping('*','__post__pollockOn','note:1',0,false); assert.equal(App.post.pollockOn,0);
MIDI._applyMapping('*','__post__pollockOn','note:1',127,false); assert.equal(App.post.pollockOn,1);
MIDI.map=map; MIDI.values=Object.fromEntries(Object.values(map).filter(Boolean).map(m=>[(m.type||'cc')+':'+m.cc,127]));
App.post.pollock=0; App.post.pollockOn=0;
// Restrict applyAll to Pollock: unrelated MIDI targets require their own UI fixtures.
MIDI.map=Object.fromEntries(Object.entries(map).filter(([k])=>k.includes('__post__pollock')));
MIDI.applyAll(); assert.equal(App.post.pollock,0); assert.equal(App.post.pollockOn,0);
MIDI._fileMap={}; MIDI._uploadMap=()=>{}; MIDI.saveMap();
const persistedMap=JSON.parse(storage.get('vj.midi'));
assert.ok(Object.keys(persistedMap).every(k=>k.startsWith('*:__post__pollock~')));
assert.equal(Object.keys(persistedMap).length,3,'all three bundled Pollock CC assignments survive saving');
assert.ok(!/id="pxPollock(?:Gloss|Matt|Flat|Metal)"/.test(html));
assert.ok(App.POST_AMOUNT_KEYS.has('pollock')&&App.POST_AMOUNT_KEYS.has('pollockOn'));
assert.ok(!App.POST_AMOUNT_KEYS.has('pollockType'));
noOld(MIDI.postRange);

(async()=>{
  Net.fetch=async()=>({ok:true,json:async()=>({post:{pollockMetal:.72,pollockCurve:.24}})});
  App.post={...factory}; await App.applyServerDefaults();
  assert.equal(App.post.pollockType,'metal'); assert.equal(App.post.pollock,.72); assert.equal(App.post.pollockCurve,.24); noOld(App.post);
  assert.deepEqual(errors,[],'no swallowed application errors');
  console.log(`PASS: Pollock defaults, migration, ${comparisons} legacy render comparisons, tails/capture, UI, Save/Reset/Random, R/Esc, preset/state/Undo/defaults, Audio Drive and MIDI`);
})().catch(e=>{console.error(e);process.exitCode=1;});
