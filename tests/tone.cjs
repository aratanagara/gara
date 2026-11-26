'use strict';
// No browser/GPU: exercise the real Post state, MIDI and GL-call paths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const storage = new Map();
const ctx = vm.createContext({
  console, Event, performance:{now:()=>1000}, navigator:{},
  matchMedia:()=>({matches:false}), window:{addEventListener(){}},
  document:{documentElement:{},dispatchEvent(){},addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},getElementById(){return null;}},
  CustomEvent:class {constructor(type){this.type=type;}},
  localStorage:{getItem:k=>storage.get(k) ?? null,setItem:(k,v)=>storage.set(k,v)},
  setTimeout(){},clearTimeout(){},requestAnimationFrame(){}, I18n:{t:s=>s},
});
vm.runInContext(source, ctx, {filename:'app.js'});
const {App,GL,MIDI,UI} = vm.runInContext('({App,GL,MIDI,UI})', ctx);
const factory = App.postFactoryDefaults();
App._presetDefaults = {post:{...factory}};
App.uploadDefs = ()=>{}; UI.refreshPost = ()=>{}; UI.refreshAll = ()=>{};
App.resetUserPanZoom = ()=>{}; MIDI.armPickup = ()=>{}; MIDI.syncLeds = ()=>{};

// Factory/UI/range contracts, including type/level integer values before UI binding.
assert.equal(factory.tone, 0);
assert.ok(App.POST_AMOUNT_KEYS.has('tone'));
for(const key of App.POST_GROUPS.tone){
  assert.equal(App.post[key], factory[key], key);
  const id = 'px' + key[0].toUpperCase() + key.slice(1);
  const tag = html.match(new RegExp('<(?:input|select)\\b[^>]*id="'+id+'"[^>]*>'))?.[0];
  assert.ok(tag, id);
  if(typeof factory[key] === 'number'){
    assert.ok(MIDI.postRange[key], key);
    if(key !== 'toneType'){
      assert.equal(+tag.match(/min="([^"]+)"/)[1], MIDI.postRange[key][0], key);
      assert.equal(+tag.match(/max="([^"]+)"/)[1], MIDI.postRange[key][1], key);
      assert.equal(+tag.match(/value="([^"]+)"/)[1], factory[key], key);
    }
  }
}
assert.equal(App.snapPost('toneType', 3.7), 4);
assert.equal(App.snapPost('toneLevels', 5.6), 6);

// The shared section Random picks the main amount plus its range/select children.
const controls = [];
for(const key of App.POST_GROUPS.tone.filter(k=>typeof factory[k] === 'number')){
  const id = 'px' + key[0].toUpperCase() + key.slice(1), select = key === 'toneType';
  const [min,max] = MIDI.postRange[key];
  const el = {
    id,tagName:select?'SELECT':'INPUT',type:select?'select-one':'range',min,max,
    step:['toneCell','toneAngle','toneLevels'].includes(key)?1:0.01,
    value:String(factory[key]),dataset:key==='tone'?{}:{subOf:'pxTone'},
    options:select?Array.from({length:9},(_,value)=>({value})):[],selectedIndex:0,
    closest(){return {querySelector:()=>null};},getAttribute:()=>String(factory[key]),
    dispatchEvent(){App.post[key]=select?this.selectedIndex:+this.value;},
  };
  controls.push(el);
}
const section = {
  querySelector:()=>null,
  querySelectorAll:selector=>selector.includes('[data-sub-of]')?controls.filter(el=>el.dataset.subOf):controls,
};
Object.assign(App.post, factory);
const seen = new Set();
for(let i=0;i<64;i++){
  assert.equal(UI._randomizePostSection(section),8);
  assert.ok(App.post.tone >= 0.25 && App.post.tone <= 0.8);
  seen.add(App.post.toneType);
  for(const el of controls){
    const key = 'tone' + el.id.slice('pxTone'.length);
    assert.ok(App.post[key] >= +el.min && App.post[key] <= +el.max, key);
  }
}
assert.ok(seen.size > 1, 'Random includes Tone Type');
assert.equal(App.post.toneInk, factory.toneInk);
assert.equal(App.post.tonePaper, factory.tonePaper);

// Every new tooltip/help has English text; labels and option values stay independent.
vm.runInContext(fs.readFileSync(path.join(root,'i18n.js'),'utf8'),ctx);
const i18n = ctx.window.I18n; i18n.setLanguage('en');
const toneSection = html.slice(html.indexOf('<h3>Tone '), html.indexOf('<!-- IMAGON (legacy'));
for(const [,title] of toneSection.matchAll(/title="([^"]+)"/g)) assert.notEqual(i18n.t(title),title,title);
assert.match(i18n.t('tone.help'),/^Tone follows Audio/);

// Save includes amount; section Reset restores it, while R/Esc resets only amount to off.
Object.assign(App.post, {tone:0.8,toneType:7,toneCell:12,toneLevels:5,toneInk:'#123456',tonePaper:'#abcdee',toneMix:0.4});
App.savePostGroupDefault('tone');
const saved = JSON.parse(storage.get('vj.def.post.tone'));
for(const key of App.POST_GROUPS.tone) assert.deepEqual(saved[key], App.post[key], key);
Object.assign(App.post, factory); App.resetPostGroupDefault('tone');
for(const key of App.POST_GROUPS.tone) assert.equal(App.post[key], saved[key], key);
for(const faded of [false,true]){
  Object.assign(App.post, saved); App._fadeBeats = ()=>0;
  App._resetParamsCore({faded});
  assert.equal(App.post.tone, 0);
  assert.equal(App.post.toneInk, '#123456');
  assert.equal(App.post.toneLevels, 5);
}

// The production preset restore block: old presets with or without post, and new presets.
// Isolate Post from unrelated media/engine restoration; execute the source block unchanged.
const stateFn = App._applyState.toString();
const begin = stateFn.indexOf("      if(s.post && typeof s.post === 'object')");
const end = stateFn.indexOf('      // gradMix', begin);
assert.ok(begin >= 0 && end > begin);
ctx.s = {}; ctx.presetDefaults = App._presetDefaults; ctx._fadeB = 0;
for(const post of [undefined, {bri:0.2}, {tone:0.7,toneType:4,toneLevels:8}]){
  Object.assign(App.post, saved); ctx.s = post ? {post} : {};
  vm.runInContext('(function(){'+stateFn.slice(begin,end)+'}).call(App)', ctx);
  assert.equal(App.post.tone, post?.tone ?? 0);
  assert.equal(App.post.toneType, post?.toneType ?? saved.toneType);
}

// Drive never activates a disabled Tone and never changes its pattern parameters.
App._audioEnv = ()=>1;
for(const tone of [0,0.09,0.1,0.5,1]){
  const p = {...saved,tone,audioFx:1};
  const off = App.effectivePost({...p,audioFx:0}), on = App.effectivePost(p);
  if(tone < 0.1) assert.equal(on.tone, 0);
  else assert.ok(on.tone >= off.tone);
  for(const key of App.POST_GROUPS.tone.filter(k=>k!=='tone')) assert.equal(on[key],off[key],key);
}

// MIDI follows the new ranges and snaps categorical values; colors remain state strings.
MIDI._continuousValue = (_,v)=>v; App._fadeBeatsLive = ()=>0;
for(const [key,cc,expected] of [['tone',127,1],['toneType',64,4],['toneLevels',0,2],['toneLevels',127,16],['toneCell',127,64],['toneAngle',0,-180]]){
  MIDI._applyMapping('*','__post__'+key,'cc:1',cc,true);
  assert.equal(App.post[key], expected, key);
}
App._fadeBeatsLive = ()=>4;
App._paramFades.length = 0;
for(const [key,expected] of [['toneType',8],['toneLevels',16]]){
  App.post[key] = 2;
  MIDI._applyMapping('*','__post__'+key,'cc:1',127,true);
  assert.equal(App.post[key],expected);
}
assert.equal(App._paramFades.length,0,'MIDI type/levels do not pass through intermediate values');

// OFF means no shader queue, GL operation or temporary FBO, including the dead-zone edge.
GL._finalFBO = {w:320,h:240,tex:{},fbo:{}};
GL.gl = new Proxy({}, {get(){ throw Error('OFF touched GL'); }});
GL._linkDeferred = ()=>{ throw Error('OFF queued shader'); };
for(const tone of [undefined,0,0.01,0.09,0.099]) GL._applyTonePost(App.effectivePost({tone}), false);
GL._applyTonePost({tone:1}, true);
assert.equal(GL._toneQueued, undefined);
assert.equal(GL._toneTmp, undefined);

// ON queues lazily, waits for the program, and uses one final pass with bounded uniforms.
let queued = 0, draws = 0;
GL._linkDeferred = (key,src)=>{ queued++; assert.equal(key,'toneProg'); ctx.toneShader = src; };
GL._applyTonePost(App.effectivePost({...factory,tone:0.1}), false);
assert.equal(queued, 1); assert.equal(GL._toneTmp, undefined);
const uniforms = {};
GL.gl = {
  getUniformLocation:(_,name)=>name,
  uniform1f:(k,v)=>{uniforms[k]=v;}, uniform1i:(k,v)=>{uniforms[k]=v;}, uniform3fv:(k,v)=>{uniforms[k]=Array.from(v);},
};
GL.toneProg = {};
GL._runFinalPost = (P,key,setup)=>{assert.equal(key,'_toneTmp'); draws++; setup(P);};
for(let type=0;type<9;type++){
  GL._applyTonePost(App.effectivePost({...factory,tone:0.1,toneType:type}),false);
  assert.equal(uniforms.uType,type);
  assert.equal(uniforms.uAmount,App.deadParam(0.1),'dead zone applied exactly once');
  assert.equal(uniforms.uLevels,2);
  assert.deepEqual(uniforms.uInk,[0,0,0]); assert.deepEqual(uniforms.uPaper,[1,1,1]);
}
assert.equal(queued,1); assert.equal(draws,9);
GL._applyTonePost(App.effectivePost({...factory,tone:0.09}),false);
assert.equal(draws,9,'OFF bypasses an already compiled program too');
assert.ok(source.indexOf('this._applyTonePost(p, _safe);') < source.indexOf('this._applyFinalColorGrade();'));
assert.ok(source.indexOf('this._applyTonePost(p, _safe);') > source.indexOf('PixelSortFX.apply(gl, this._finalFBO'));
console.log('PASS: Tone defaults, UI/ranges, Random/type, EN text, Save/Reset, R/Esc, old/new presets, Audio Drive, MIDI, OFF bypass and lazy single-pass uniforms');
