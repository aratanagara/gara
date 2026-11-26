'use strict';
// No browser, image files, network, build or GPU required. Exercise the real engine,
// app persistence/dispatch and UI handlers; WebGL calls are recorded, not rasterized.
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'), read=f=>fs.readFileSync(path.join(root,f),'utf8');
const storage=new Map(), elements=new Map(), docEvents={};
class Element {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.events={};this.dataset={};this.style={};this.value='';this.className='';}
  set innerHTML(v){this.children=[];} get innerHTML(){return '';}
  appendChild(el){this.children.push(el);el.parentElement=this;return el;}
  addEventListener(k,fn){(this.events[k] ||= []).push(fn);}
  dispatchEvent(e){for(const fn of this.events[e.type]||[]) fn(e);}
  querySelector(s){return s==='label' ? this.children.find(x=>x.tagName==='LABEL') : s==='input' ? this.children.find(x=>x.tagName==='INPUT') : null;}
  querySelectorAll(s){const all=this.children.flatMap(x=>[x,...x.querySelectorAll(s)]);return all.filter(x=>s==='[data-pkey]' ? x.dataset.pkey : s==='input[type=range], input[type=checkbox]' ? ['range','checkbox'].includes(x.type) : false);}
  closest(s){if(s==='.row' && this.className==='row' || s==='[id]' && this.id)return this;return this.parentElement?.closest(s)||null;}
  getAttribute(){return null;} removeAttribute(){} remove(){} focus(){} select(){} click(){} getContext(){return {drawImage(){}};}
  classList={add(){},remove(){}};
}
const document={addEventListener(k,fn){(docEvents[k] ||= []).push(fn);},querySelector:s=>elements.get(s)||null,querySelectorAll:()=>[],getElementById:id=>elements.get('#'+id)||null,createElement:tag=>new Element(tag),body:new Element('body')};
const uploadSizes=[], calls=[], constants=new Map();let nextConst=1;
const gl=new Proxy({}, {get(o,k){if(k in o)return o[k];if(k===k.toUpperCase()){if(!constants.has(k))constants.set(k,nextConst++);return constants.get(k);}return (...args)=>{calls.push([k,...args]);if(k==='texImage2D' && args.at(-1)?.tagName==='CANVAS')uploadSizes.push([args.at(-1).width,args.at(-1).height]);return k.startsWith('create') ? {kind:k,id:calls.length} : k==='getUniformLocation' ? args[1] : k.startsWith('get') ? true : undefined;};}});
let pending=[],autoImages=true;
class FakeImage {
  constructor(){this.naturalWidth=2400;this.naturalHeight=1600;}
  set src(v){this.url=v;pending.push(this);if(autoImages)queueMicrotask(()=>{this.onload();});}
}
const ctx=vm.createContext({console,document,window:{addEventListener(){},matchMedia:()=>({matches:false})},navigator:{},matchMedia:()=>({matches:false}),performance:{now:()=>1000},requestAnimationFrame(){},setTimeout(){},clearTimeout(){},Event,Image:FakeImage,MutationObserver:class {observe(){}},
 I18n:{t:s=>s,bind(){}}, localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
 fetch:async()=>({ok:true,json:async()=>[]}),queueMicrotask});
const html=read('index.html'), app=read('app.js');
for(const [,file] of html.matchAll(/<script src="([^"?]+)(?:\?[^\"]*)?"/g))
 if(file==='presets.js'||file.startsWith('mode/')||file.startsWith('shaders/')||file==='overlay.js'||file==='app.js')vm.runInContext(read(file),ctx,{filename:file});
const run=s=>vm.runInContext(s,ctx), {ImageConstruct:E,ConstructLayout:C,Fude,TDCanvas,App,GL,UI,BPM,BShift,MIDI}=run('({ImageConstruct,ConstructLayout,Fude,TDCanvas,App,GL,UI,BPM,BShift,MIDI})');
const plain=x=>JSON.parse(JSON.stringify(x));
run('__glReady=()=>true');
GL.gl=gl;GL.slots={A:{kind:'imgconstruct',params:[],renderScale:1},B:{kind:'none',params:[]}};
App.activeSlot='A'; App.uploadDefs=()=>{}; UI.refreshAll=()=>{};UI.refreshParams=()=>{};UI.refreshPost=()=>{};UI.bindEngineHints=()=>{};
E._refreshUI=()=>{};
const factory=plain(E.PDefaults);
App._capturePresetDefaults();
assert.equal(E.initialized,false);assert.deepEqual(plain(E.P),factory);assert.notEqual(E.P.bg,E.PDefaults.bg);
assert.equal(E.P.projection,1);assert.equal(E.P.folder,'');
// Golden values captured from 19928d1 before extraction: saved values and 24 seeded
// layout/adjust/iso traces must stay identical, including random call order.
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
assert.equal(hash(run('JSON.stringify(Fude.PDefaults)')),'70d66101a545da293b459320e6484dafb17a64150113b8495edae67e67b0d8fe');
const beforeFude=plain(Fude.P);ctx.savedRandom=run('Math.random');
const geometry=run(`(()=>{let seed=123456789;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const out=[];
for(const angleSys of [0,1])for(const name of FUDE_CV_PATTERNS.flatMap(p=>p[1])){Fude.P.angleSys=angleSys;
  Fude._aspect=16/9;
  const plan=(name==='constructivist'?fudeConstructivist:TDCanvas.LAYOUTS[name])(7,Fude._angleStep());
  if(name!=='constructivist')Fude._cvConstructivize(plan,name);
  Object.assign(Fude.P,{cvAngle:30,cvSpread:1.15,cvOffX:0.03,cvOffY:-0.1,cvSnap:2,cvMirror:3,cvRotVar:4,cvScaleVar:0.3});
  Fude._cvAdjust(plan);
  Fude._cvIso(plan);
  out.push({name,angleSys,axis:plan.axis,plan:plan.map(o=>({...o,faceMat:Fude._faceMat(o.face)}))});}
return JSON.stringify(out,(_,v)=>typeof v==='number'?+v.toPrecision(12):v);})()`);
assert.equal(hash(geometry),'c5516c6722a603eece5c4dfd644b415fe69c70e1a8f1b83ededefbf692119736');
Object.assign(Fude.P,beforeFude);run('Math.random=savedRandom');
assert.equal(C.PATTERNS,Fude.CV_PATTERNS);
for(const k of ['_cvAdjust','_cvConstructivize','_cvIso','_faceMat','_angleStep'])assert.equal(Fude[k],C[k]);
assert.deepEqual(plain(Fude.CV_LAYOUTS),['hero','grid','diagonal','frame','cascade','scatter','free','slash','scale','cross','radial','wedge','stairs','constructivist']);
assert.equal(E.LOOKS.length,48);assert.equal(new Set(E.LOOKS.map(l=>l.name)).size,48);
const allowed=new Set(C.PATTERNS.flatMap(p=>p[1]));assert.equal(allowed.has('scatter'),false);assert.equal(allowed.has('free'),false);
// Every recipe is usable, contains no media, and invokes the actual shared generator.
let delegated=0;
for(const name of allowed){if(name==='constructivist')continue;const original=TDCanvas.LAYOUTS[name];TDCanvas.LAYOUTS[name]=(...args)=>{delegated++;return original(...args);};}
for(let i=0;i<E.LOOKS.length;i++){
 const l=E.LOOKS[i];assert.ok(!('folder' in l.p));assert.doesNotMatch(JSON.stringify(l),/data:|blob:|images\//);
 E.P.folder='images/keep';E.applyLook(i);assert.equal(E.P.folder,'images/keep');
 const plan=E.makePlan();assert.equal(plan.length,E.P.count);assert.ok(allowed.has(plan.type));
 assert.ok([0,1].includes(E.P.angleSys));assert.equal(E.P.cvSnap,1);
 for(const o of plan){for(const k of ['x','y','s','rot','z'])assert.ok(Number.isFinite(o[k]),l.name+' '+k);assert.ok(o.s>0);assert.equal(Math.abs(o.rot%(E.P.projection ? 90 : E._angleStep())),0);assert.ok([...E.vertices(o)].every(Number.isFinite));}
 assert.ok(Math.max(...plan.map(o=>o.s))>Math.min(...plan.map(o=>o.s))*1.2);
 if(E.P.projection){assert.deepEqual([...new Set(plan.map(o=>o.face))].sort(),E.P.faces===1 ? ['t'] : E.P.faces===4 ? ['l','r'] : ['l','r','t']);}
}
assert.ok(delegated>=42);
for(let i=0;i<30;i++){const old=E.P.look;E.randomLook();assert.notEqual(E.P.look,old);}
assert.deepEqual(plain(E.PDefaults),factory);
Object.assign(E.P,plain(factory),{count:3,timing:0,noteWrite:0.5,noteHold:2,lookAuto:0});E.restart();App.beatMode='beat';
assert.equal(E.step({beat:0}).visible,0);assert.equal(E.step({beat:0.49}).visible,0);assert.equal(E.step({beat:0.5}).visible,1);assert.equal(E.step({beat:1.5}).visible,3);
const plan=E.step({beat:3.49}).plan;assert.equal(E.step({beat:3.5}).visible,0);assert.notEqual(E._states.A.plan,plan);
E.P.timing=1;E.restart();assert.equal(E.step({beat:0}).visible,3);const redraw=E._states.A.plan;E.step({beat:2.5});assert.notEqual(E._states.A.plan,redraw);
E.clear();assert.equal(E.step({beat:0}).visible,0);assert.equal(E.step({beat:0.5}).visible,3,'C also clears Redraw until the next write interval');
App.beatMode='drone';BPM.bpm=120;assert.equal(E._time(999,1),6);BPM.bpm=60;assert.equal(E._time(999,1),3);
E.P.timing=0;E.P.noteWrite=1;E.restart();E.step({clock:0});assert.equal(E.step({clock:1/3}).visible,1);
E.restart();assert.equal(Object.keys(E._states).length,0);assert.equal(E.step({clock:1/3}).visible,0);
App.beatMode='beat';E.P.lookAuto=1;E.P.lookEvery=0.5;E.restart();E.step({beat:0});const oldLook=E.P.look;E.step({beat:0.5});assert.notEqual(E.P.look,oldLook);const autoLook=E.P.look;E.step({beat:0.6});assert.equal(E.P.look,autoLook);E.step({beat:1});assert.notEqual(E.P.look,autoLook);
assert.equal(E._dz(0.09),0);assert.equal(E._dz(-0.09),0);assert.ok(E._dz(0.1)>0);
E.P.folder='images/saved';E.P.noteWrite=0.125;E.P.size=78.123;App.saveEngineDefault('imgconstruct');E.P.size=9;App.resetEngineDefault('imgconstruct');assert.equal(E.P.size,78.12);assert.equal(E.P.noteWrite,0.125);assert.equal(E.P.folder,'images/saved');
App._restoreModeStates({imgconstruct:{folder:'images/restored',size:43,noteWrite:0.25}});assert.equal(E.P.folder,'images/restored');assert.equal(E.P.size,43);
assert.deepEqual(App.bgTarget('A').get(),E.P.bg);
assert.ok(App.modeKinds.includes('imgconstruct'));assert.ok(App.modeStateKinds.includes('imgconstruct'));assert.equal(App._engineP('imgconstruct'),E.P);assert.equal(GL.KIND_DEPTH.imgconstruct(),E);assert.ok(GL.MATTE_KINDS.includes('imgconstruct'));assert.equal(BShift.bases.imgconstruct,E);
assert.ok(BShift.templates.imgconstruct);assert.deepEqual(plain(BShift.templates.imgconstruct.PDefaults),factory);
for(const action of ['save','reset','rand'])assert.match(html,new RegExp('class="'+action+'DefBtn" data-kind="imgconstruct"'));
assert.match(app,/kind === 'imgconstruct'\)\{ ImageConstruct.randomLook\(\)/);
assert.match(app,/ImageConstruct.restart\(\)/);assert.match(app,/BShift.instances.imgconstruct.clear\(\)/);
assert.match(app,/imgconstruct:.*ImageConstruct.P/);assert.match(app,/p.kind === 'imgconstruct'/);assert.match(app,/slot.kind === 'imgconstruct'/);
assert.match(app,/p.sid = 'C' \+ String\(mn\)/);assert.doesNotMatch(read('shaders/sids.json'),/Image Construct/);
// UI sliders are ordinary engine controls, so they use the common MIDI and HUD path.
const panel=new Element();panel.id='imgconstructParams';elements.set('#imgconstructParams',panel);
const side=new Element();side.id='side';side.appendChild(panel);elements.set('#side',side);
UI.refreshImageConstructParams();UI._midiAutoTag();
const ranges=panel.querySelectorAll('input[type=range], input[type=checkbox]');const size=ranges.find(el=>el.parentElement.dataset.pkey==='size');
assert.equal(size.dataset.midiKey,'*:dom~imgconstructParams~Size');assert.equal(MIDI._paramLabel('dom~imgconstructParams~Size'),'Size');
elements.set('[data-midi-key="'+size.dataset.midiKey+'"]',size);MIDI._continuousValue=(_,v)=>v;MIDI._applyMapping('*','dom~imgconstructParams~Size','cc:1',64,true);assert.ok(E.P.size>100);assert.equal(size._paramDisplay(),E.P.size);
assert.equal(size.parentElement.children.at(-1).textContent,App.effDisplay(E.P.size,x=>run('ParamValues').number(x).toFixed(2)));
// Folder API / encoded file names / drop URLs / default resolution / stale async loads.
(async()=>{
 const IM=run('ImageMode');IM.loadFolderIndex=async()=>IM.folders;
 let fallbackReads=0;ctx.fetch=async()=>{fallbackReads++;return {ok:true,json:async()=>['fallback.png']};};
 E.gl=gl;E.P.folder='images/photo';E._indexReady=false;IM.folders=[];E._syncFolder();await E.loadFolders();await new Promise(setImmediate);assert.equal(fallbackReads,1);assert.equal(E.textures.length,1,'saved fallback folder resolves after async index');
 ctx.fetch=async()=>({ok:true,json:async()=>[]});
 IM.folders=[{dir:'images/solo.png',single:true},{name:'Test',dir:'images/日本 # % &',images:['a #%.png','b.png']}];
 E.P.folder='';E.gl=gl;await E.loadFolders();await new Promise(setImmediate);
 assert.equal(E.P.folder,IM.folders[1].dir);assert.equal(E._urls[0],'images/%E6%97%A5%E6%9C%AC%20%23%20%25%20%26/a%20%23%25.png');assert.equal(E.textures.length,2);
 IM.folders.unshift({dir:'(drop)1',images:['memory.png'],_urls:['blob:session-image']});E.P.folder='(drop)1';E._syncFolder();await new Promise(setImmediate);assert.equal(E._urls[0],'blob:session-image');assert.equal(E.textures.length,1);
 IM.folders.shift();E._syncFolder();assert.equal(E.textures.length,0);assert.equal(E._urls.length,0);
 E.P.folder='';IM.folders=[];await E.loadFolders();await new Promise(setImmediate);assert.equal(E.P.folder,'images/photo');
 E.P.folder='images/restored';IM.folders=[{dir:'images/restored',images:['saved.png']}];await E.loadFolders();await new Promise(setImmediate);assert.equal(E.P.folder,'images/restored');
 E._urls=Array.from({length:80},(_,i)=>'memory:'+i);pending=[];autoImages=false;const loading=E._loadPool();assert.equal(pending.length,3,'only three decodes in flight');
 const token=E._loadToken;E._urls=['memory:new'];const fresh=E._loadPool();assert.ok(E._loadToken>token);const obsolete=pending.slice(0,3);for(const img of obsolete)img.onload();pending[3].onload();await Promise.all([loading,fresh]);assert.equal(E.textures.length,1);
 autoImages=true;E._urls=Array.from({length:100},(_,i)=>'memory:'+i);calls.length=0;uploadSizes.length=0;await E._loadPool();assert.equal(E.textures.length,48);
 const uploads=calls.filter(c=>c[0]==='texImage2D');assert.equal(uploads.length,48);assert.ok(uploadSizes.reduce((sum,[w,h])=>sum+w*h,0)<=16e6);assert.ok(uploadSizes.every(([w,h])=>Math.max(w,h)<=1024));
 E.P.count=12;E._imageCursor=0;const seen=new Set();for(let i=0;i<4;i++)for(const o of E.makePlan())seen.add(o.tex);assert.equal(seen.size,48,'all resident images are used across cycles');
 // No real images are written: FakeImage and canvas stubs exist only in this process.
 Object.assign(E.P,plain(factory),{folder:'images/restored',lookAuto:0,timing:1,mat:0});E._syncFolder=()=>{};
 E.initialized=false;E.loadFolders=async()=>{};assert.equal(E.init(gl),true);
 E.textures=[{tex:{},aspect:1.5}];let projections=0,keep=false;
 GL.osProj=m=>{projections++;return m;};GL.kindKeepsDepth=()=>keep;
 calls.length=0;E.render({fbo:{},w:800,h:600,slot:'B',beat:0,clock:0,opaque:true});
 assert.deepEqual(calls.find(c=>c[0]==='clearColor').slice(1),[0,0,0,0]);assert.ok(calls.some(c=>c[0]==='blendFuncSeparate'));assert.ok(calls.some(c=>c[0]==='copyTexSubImage2D'));assert.equal(E.depthInfo.linear,true);assert.equal(projections,1);
 assert.ok(calls.some(c=>c[0]==='drawArrays' && c[3]===6));assert.match(E.FS,/ink\.a/);assert.doesNotMatch(E.FS,/chroma|dot\(.*rgb/);
 keep=true;calls.length=0;E.render({fbo:{},w:800,h:600,slot:'A',beat:1,clock:1});assert.equal(calls.find(c=>c[0]==='clearColor').at(-1),1);assert.ok(!calls.some(c=>c[0]==='framebufferRenderbuffer'),'shared depth attachment preserved');
 calls.length=0;E.render({fbo:{},w:800,h:600,slot:'A',beat:2,clock:2,opaque:false});assert.equal(calls.find(c=>c[0]==='clearColor').at(-1),0);
 GL._osCur={bw:1600,bh:900};E.render({fbo:{},w:2400,h:1800,slot:'A',beat:3,clock:3});assert.equal(E._aspect,16/9);GL._osCur=null;
 // Real loadPreset branch, with non-rendering surrounding app services stubbed.
 GL.forceRenderOnce=()=>{};GL.startPresetTrans=()=>{};GL._resizeSlotBuffers=()=>{};run('Overlay.clear=()=>{}');
 const presets=run('PRESETS');const idx=presets.push({name:'Image Construct test',kind:'imgconstruct',src:'',ch:[]})-1;
 App.loadPreset(idx,'A',{skipEngineDefault:true});assert.equal(GL.slots.A.kind,'imgconstruct');assert.equal(GL.slots.A.format,'imgconstruct');assert.equal(GL.slots.A.ready,true);
 assert.deepEqual(plain(E.PDefaults),factory);
 console.log('PASS: 48 constructivist Looks, shared FUDE geometry, defaults, Save/Reset/Random, restoration/loadPreset, beat/drone/Auto/C, folder/drop/races/budgets, MIDI/HUD, WebGL alpha/depth/Overscan dispatch');
})().catch(e=>{console.error(e);process.exitCode=1;});
