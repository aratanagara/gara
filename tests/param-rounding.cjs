'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const storage = new Map(), listeners = {}, elements = new Map(), blobs = [];
class Element {
  constructor(tag = 'input') { this.tagName = tag.toUpperCase(); this.type = ''; this.dataset = {}; this.style = {}; this.children = []; this.events = {}; this._value = ''; }
  set value(v) {
    if(this.type !== 'range') { this._value = String(v); return; }
    const lo = +this.min || 0, hi = this.max === undefined ? 100 : +this.max, st = +this.step || 1;
    this._value = String(Math.max(lo, Math.min(hi, lo + Math.round((+v - lo) / st) * st)));
  }
  get value() { return this._value; }
  addEventListener(k, fn) { (this.events[k] ||= []).push(fn); }
  dispatchEvent(e) { for(const fn of this.events[e.type] || []) fn(e); }
  appendChild(el) { this.children.push(el); el.parentElement = this; return el; }
  querySelector(s) { return s === 'input' ? this.children.find(c => c.tagName === 'INPUT') : this.children.find(c => c.type === 'range') || null; }
  querySelectorAll() { return []; }
  closest(s) { return s === '.val' && this.className === 'val' ? this : null; }
  focus() {} select() {} click() {} remove() {}
  getAttribute() { return null; }
}
const document = {
  addEventListener(k, fn) { (listeners[k] ||= []).push(fn); },
  querySelector: s => elements.get(s) || null, querySelectorAll: () => [], getElementById: id => elements.get('#' + id) || null,
  createElement: tag => new Element(tag), body: new Element('body'),
};
const ctx = vm.createContext({
  document, window: {addEventListener() {}, matchMedia: () => ({matches:false})}, matchMedia: () => ({matches:false}),
  navigator: {}, performance: {now: () => 0}, requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {}, Event,
  localStorage: {getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,String(v)), key: i => [...storage.keys()][i], get length() { return storage.size; }},
  URL: {createObjectURL(blob) { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {}}, Blob, console,
});
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const files = [...html.matchAll(/<script src="([^"?]+)(?:\?[^\"]*)?"/g)].map(m => m[1]);
for(const file of files) {
  if(file === 'presets.js' || file.startsWith('mode/') || file.startsWith('shaders/') || file === 'overlay.js' || file === 'app.js') {
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'), ctx, {filename:file});
  }
}
const run = src => vm.runInContext(src, ctx);
const {ParamValues: N, App, UI, Shader, MIDI, GL} = run('({ParamValues,App,UI,Shader,MIDI,GL})');
App.uploadDefs = () => {}; UI.refreshAll = () => {}; UI.refreshParams = () => {}; UI.refreshPost = () => {};
App._capturePresetDefaults();
assert.equal(N.number(0.7994), 0.8);
assert.equal(N.number(-0.7994), -0.8);
assert.equal(N.number(1.005), 1.01);
assert.equal(N.number(-1.005), -1.01);
assert.equal(Object.is(N.number(-0.00001), -0), false);
assert.equal(N.number(3.8,{step:1,min:0}),4);
assert.equal(N.number(0.012,{step:0.002,min:0.002}),0.012);
assert.equal(N.number(0.0065,{step:0.0005,min:0.0005}),0.0065);
const color = [63/255,127/255,1]; assert.equal(N.number(color), color);
for(const v of [-1.2,-1,-0.8,-0.1,-0.099,0,0.099,0.1,0.8,1,1.2]) {
  const expected = Math.abs(v)<.1 ? 0 : Math.abs(v)>1 ? v : Math.sign(v)*(Math.abs(v)-.09)/.91;
  assert.equal(App.deadParam(v),expected);
}
assert.equal(App.effDisplay(.08), '0.00');
assert.equal(App.effDisplay(.8), '0.80');
assert.equal(N.shaderSpec({name:'uScrollSpread',type:'float',min:0,max:1,defaultValue:0}).keep,false);
assert.equal(N.shaderSpec({name:'uReroll',type:'float',min:0,max:1,defaultValue:0}).keep,false);
assert.equal(N.shaderSpec({name:'uWarpPhase',type:'float',min:-180,max:180,defaultValue:0,desc:'位相のずれ (度)'}).keep,true);
assert.equal(N.shader({name:'uTiny',type:'float',min:0,max:.05,defaultValue:.0065,value:.0065}),.0065);
// ブラウザを起動せず、range の step 丸めと実際の直接入力ハンドラを検証する。
const p = Shader.preprocess('// @param uScale 0.3..2.5 = 1\nvoid main(){}').params[0];
const range = new Element(); Object.assign(range,{type:'range',min:p.min,max:p.max,step:(p.max-p.min)/1000});
range.value = .8; assert.ok(Math.abs(+range.value-.7994)<1e-12);
range.step = N.shaderSpec(p).step;
const row = new Element('div'), val = new Element('div'); val.className='val'; val.textContent='1.00'; row.appendChild(range); row.appendChild(val);
range.addEventListener('input',()=>{p.value=N.shader(p,N.read(range));val.textContent=App.effDisplay(p.value);});
UI._bindSliderResetOnDblclick();
const edit = text => {
  for(const fn of listeners.dblclick) fn({target:val,preventDefault(){},stopPropagation(){}});
  const input = val.children.at(-1); input.value=text;
  input.dispatchEvent({type:'keydown',key:'Enter',stopPropagation(){}});
  val.children=[];
};
edit('0.8'); assert.equal(p.value,.8); assert.equal(val.textContent,'0.80');
edit('0.8'); assert.equal(p.value,.8);
const coarse = new Element(); Object.assign(coarse,{type:'range',min:.03,max:2,step:.02});
let received; coarse.addEventListener('input',()=>{received=N.read(coarse);});
N.enter(coarse,.8); assert.equal(received,.8); assert.equal(N.read(coarse),.8);
const tenth = new Element(); Object.assign(tenth,{type:'range',min:0,max:2,step:.1});
tenth.addEventListener('input',()=>{received=N.read(tenth);});
N.enter(tenth,.83); assert.equal(received,.8); N.enter(tenth,.83); assert.equal(received,.8);
// 指数ゲインは入力を実ゲインとして受け、位置への往復で値を失わない。
const gain = new Element(); Object.assign(gain,{type:'range',min:0,max:1,step:.005,_paramSpec:{step:.01},_paramToSlider:g=>App.againToSlider(g)});
gain.addEventListener('input',()=>{received=N.number(App.againFromSlider(N.read(gain)));});
N.enter(gain,.8); assert.equal(received,.8);
gain.id='testGain'; gain._paramDisplay=()=>received; gain._paramFromSlider=s=>App.againFromSlider(s);
N.enter(gain,7.53); UI._snapshotCtlDefaults({querySelectorAll:()=>[gain]}); N.enter(gain,.5);
for(const fn of listeners.dblclick) fn({target:gain}); assert.equal(received,7.53);
// 全エンジンの共通保存口を実行。元の P にある数値キーを使う。
let engines=0;
for(const kind of App.modeStateKinds) {
  const P=App._engineP(kind); if(!P)continue;
  const key=Object.keys(P).find(k=>typeof P[k]==='number' && !Object.hasOwn(N.fine[kind]||{},k)); if(!key)continue;
  const prev=P[key]; P[key]=.7994;
  App.saveEngineDefault(kind);
  assert.equal(JSON.parse(storage.get('vj.def.'+kind))[key],.8,kind);
  P[key]=.3;
  // 描画の再構築は差し止め、保存値の再代入を検証。
  const saved=JSON.parse(storage.get('vj.def.'+kind)); Object.assign(P,App.paramValues(kind,saved));
  assert.equal(P[key],.8,kind); P[key]=prev; engines++;
}
// Type Deformer の Save → Reset と全体プリセット。
const TD=run('TextDeform'); TD.applyP=()=>{};
const surf=run('TDSurf'); surf.meta=JSON.parse(fs.readFileSync(path.join(root,'mode/typedeformer/vj-operator-params.json'),'utf8'));
const nested=App.paramValues('textdeform',{surf:{strength:.7994,params:{differentialType:{differentialMemory:.0007}}},comp:{speed:.7994,macros:{intensity:.7994}}});
assert.equal(nested.surf.strength,.8); assert.equal(nested.surf.params.differentialType.differentialMemory,.0007);
assert.equal(nested.comp.speed,.8); assert.equal(nested.comp.macros.intensity,.8);
assert.equal(N.format(.0007,{step:.0001},String),'0.0007');
TD.P.zoom=.7994; TD.P.letterSpacing=.015; TD.P.textEvery=.0625;
App.saveEngineDefault('textdeform'); TD.P.zoom=.2; App.resetEngineDefault('textdeform');
assert.equal(TD.P.zoom,.8); assert.equal(TD.P.letterSpacing,.015); assert.equal(TD.P.textEvery,.0625);
for(const kind of Object.keys(N.fine)) for(const [key,step] of Object.entries(N.fine[kind])) {
  const value=step ? step*3 : .03125;
  assert.ok(Math.abs(App.paramValues(kind,{[key]:value})[key]-value)<1e-12,kind+'.'+key);
}
GL.slots={A:{kind:'shader',_presetName:'Rounding Test',params:[p]},B:{kind:'none',params:[]}};
p.value=.7994; App.saveShaderParamDefaults('A'); assert.equal(p.value,.8);
p.value=.2; App.applyShaderParamDefaults(GL.slots.A); assert.equal(p.value,.8);
App.post.bri=.7994; App.savePostGroupDefault('color'); App.post.bri=.2; App.resetPostGroupDefault('color'); assert.equal(App.post.bri,.8);
const originalCollect=App._collectState;
App._collectState=()=>({slots:GL.slots,post:App.post,textdeform:TD.stateP(),overlay:{size:.015,freq:.03125},image:{A:{transBeats:.0625,zoom:.7994}}});
const preset=App._capturePresetState(); assert.equal(preset.textdeform.zoom,.8); assert.equal(preset.slots.A.params[0].value,.8);
assert.equal(preset.image.A.zoom,.8); assert.equal(preset.image.A.transBeats,.0625); assert.equal(preset.overlay.freq,.03125);
TD.P.zoom=.2; App._restoreModeStates(preset); assert.equal(TD.P.zoom,.8); App._collectState=originalCollect;
MIDI._continuousValue=(_,v)=>v; UI.updateParamUI=()=>{};
MIDI._applyMapping('A','uScale','cc:1',29,true); assert.equal(p.value,N.shader(p,.3+2.2*(29/127)));
assert.equal(App.snapPost('bri',.7994),.8); assert.equal(App.snapPost('hue',.805),.805);
// Defaults Export の実際の Blob を読んで確認。
App.exportDefaults(false);
assert.equal(blobs.length,1);
(async()=>{
  const data=JSON.parse(await blobs[0].text());
  assert.equal(data.defs.textdeform.zoom,.8); assert.equal(data.defs['sparam.Rounding Test'].uScale,.8);
  assert.equal(data.defs['post.color'].bri,.8);
  let floats=0, fine=0;
  const sources=[...fs.readdirSync(path.join(root,'shaders')).filter(f=>f.endsWith('.frag')).map(f=>fs.readFileSync(path.join(root,'shaders',f),'utf8')),...run('PRESETS.map(p=>p.src||"")')];
  for(const src of sources)for(const p of Shader.preprocess(src).params){
    if(p.type!=='float')continue; floats++; if(N.shaderSpec(p).step!==.01)fine++;
    for(const value of [p.min,p.max,p.defaultValue,.7994]){
      const v=N.shader(p,value); assert.equal(N.shader(p,v),v,p.name);
    }
  }
  console.log(`PASS: ${engines} engines, ${floats} shader floats (${fine} precision exceptions), direct input, MIDI, dead zone, Save/Reset, presets, Defaults Export`);
})().catch(e=>{console.error(e);process.exitCode=1;});
