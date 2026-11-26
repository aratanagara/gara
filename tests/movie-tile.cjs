'use strict';
// Real parameter/UI/state/render paths, without a browser or video decoder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const elements = new Map(), storage = new Map();
const document = {
  documentElement:{}, addEventListener(){}, dispatchEvent(){}, querySelectorAll:()=>[],
  querySelector:s=>elements.get(s) || null, getElementById:id=>elements.get('#'+id) || null,
};
const ctx = vm.createContext({
  console, document, window:{addEventListener(){}, matchMedia:()=>({matches:false})},
  navigator:{language:'en'}, matchMedia:()=>({matches:false}), performance:{now:()=>1000}, Event,
  localStorage:{getItem:k=>storage.get(k) ?? null, setItem:(k,v)=>storage.set(k,v), removeItem:k=>storage.delete(k)},
  setTimeout(){}, clearTimeout(){}, requestAnimationFrame(){}, CustomEvent:class {},
});
for(const m of html.matchAll(/<script src="([^"?]+)(?:\?[^\"]*)?"/g)){
  const file = m[1];
  if(file === 'i18n.js' || file === 'presets.js' || file.startsWith('mode/') || file.startsWith('shaders/') || file === 'app.js'){
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'), ctx, {filename:file});
    if(file === 'i18n.js') ctx.I18n = ctx.window.I18n;
  }
}
const {App, UI, Movie, GL, MIDI, TextDeform} = vm.runInContext('({App,UI,Movie,GL,MIDI,TextDeform})',ctx);
const plain = v => JSON.parse(JSON.stringify(v));
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-10, `${a} != ${b}`);
const defaults = {
  columns:1, rows:1, gapX:0, gapY:0, offsetX:0, offsetY:0, cellSize:100,
  rowShift:0, colShift:0, cellRotate:0, flipAlt:0, scrollX:0, scrollY:0, timeOffset:0,
};
assert.deepEqual(plain(Movie.LAYOUT_DEFAULTS),defaults);
const layout = (P={}, beat=0, clock=0, mode='drone') => Movie._layoutUniforms(P,beat,clock,mode);
assert.equal(layout().enabled,0,'old parameters omit all layout keys');
assert.equal(layout(Movie.P).enabled,0);
for(const [k,v] of Object.entries(defaults)) assert.equal(Movie.P[k],v,k);
for(const key of Object.keys(defaults).filter(k=>defaults[k]===0)){
  assert.equal(layout({[key]:0.09}).enabled,0,key+' dead zone');
  assert.equal(layout({[key]:-0.09}).enabled,0,key+' negative dead zone');
}
near(layout({scrollX:0.1},0,1).cell[0],App.deadParam(0.1));
near(layout({offsetX:-0.1}).cell[0],App.deadParam(-0.1)/100);
near(layout({gapX:0.1}).grid[2],App.deadParam(0.1)/100);
assert.deepEqual(plain(layout({columns:99,rows:0}).grid.slice(0,2)),[16,1]);
assert.deepEqual(plain(layout({columns:3.4,rows:3.6}).grid.slice(0,2)),[3,4]);
assert.equal(layout({flipAlt:1}).stagger[2],1);
assert.equal(layout({cellSize:0}).cell[2],0.1);
assert.equal(layout({cellSize:999}).cell[2],2);
near(layout({cellRotate:-180}).cell[3],-Math.PI);
near(layout({timeOffset:0.8}).stagger[3],App.deadParam(0.8));
// Tile remains independent, and gaps/offsets are specified in screen units.
assert.equal(layout({tile:400}).enabled,0);
near(layout({tile:200,gapX:5,gapY:8}).grid[2],0.1);
near(layout({tile:200,offsetX:10}).cell[0],0.2);
// Beat holds its position within a beat; Drone moves continuously and can reverse.
const moving = {scrollX:0.5,scrollY:-0.5};
assert.deepEqual(plain(layout(moving,2.1,5,'beat').cell),plain(layout(moving,2.9,6,'beat').cell));
assert.notDeepEqual(plain(layout(moving,2.9,5,'beat').cell),plain(layout(moving,3,5,'beat').cell));
near(layout(moving,0,0.2).cell[0]-layout(moving,0,0.1).cell[0],App.deadParam(0.5)*0.1);
assert.ok(layout(moving,0,0.1).cell[1]<0);
assert.ok(layout(moving,0,-0.1).cell[0]<0);
for(const count of [1,2,3,16]){
  const period = count%2 ? 2 : 1;
  const p = {columns:count,rows:count,scrollX:1,scrollY:1,timeOffset:1,flipAlt:1};
  assert.deepEqual(plain(layout(p,0,0.25).cell),plain(layout(p,0,period*10000+0.25).cell));
}
// Bind the actual HTML rows, then exercise the shared Save / Reset / Random paths.
const inputs = [];
for(const [key,def] of Object.entries(defaults)){
  const id = 'vid'+key[0].toUpperCase()+key.slice(1);
  const m = html.match(new RegExp('<div class="row" data-pkey="'+key+'"><label for="'+id+'">([^<]+)</label><input ([^>]+)>'));
  assert.ok(m,key+' row / label');
  const attrs = Object.fromEntries([...m[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(x=>[x[1],x[2]]));
  const label = m[1], events = {};
  const input = Object.assign(attrs,{
    dataset:{}, parentElement:{querySelector:()=>({textContent:label})},
    addEventListener(type,fn){ events[type]=fn; },
    dispatchEvent(e){ events[e.type]?.(e); },
  });
  inputs.push(input); elements.set('#'+id,input); elements.set('#'+id+'Val',{});
  assert.equal(+attrs.value,def,key+' HTML default');
  assert.equal(attrs.title,Movie.PARAM_HELP[key],key+' help matches title');
  assert.notEqual(ctx.I18n.t(attrs.title),attrs.title,key+' English help');
  assert.equal(ctx.I18n.t(label),label,key+' English label');
  assert.ok(UI._vidFx().some(([i,k])=>i===id && k===key),key+' input registration');
}
App.uploadDefs=()=>{}; App._undoSchedule=()=>{}; MIDI.refreshLeds=()=>{};
UI.refreshAll=()=>{}; TextDeform.applyP=()=>{};
App._capturePresetDefaults(); UI.bindVideo();
for(const input of inputs){ input.value=input.max; input.dispatchEvent(new Event('input')); }
for(const [key] of Object.entries(defaults)){
  const input=elements.get('#vid'+key[0].toUpperCase()+key.slice(1));
  assert.equal(Movie.P[key],+input.max,key+' input');
}
App.saveEngineDefault('video');
const saved=JSON.parse(storage.get('vj.def.video'));
Object.assign(Movie.P,defaults); App.resetEngineDefault('video');
for(const key of Object.keys(defaults)) assert.equal(Movie.P[key],saved[key],key+' Save / Reset');
Object.assign(Movie.P,defaults);
vm.runInContext('Math.random=()=>0.37',ctx);
UI.randomizeSection({querySelector:()=>null,querySelectorAll:s=>s==='input[type=range]'?inputs:[]},'video');
for(const key of Object.keys(defaults)){
  const input=elements.get('#vid'+key[0].toUpperCase()+key.slice(1));
  near(Movie.P[key],+input.value);
  assert.ok(Movie.P[key]>=+input.min && Movie.P[key]<=+input.max,key+' Random range');
}
// A previously saved non-default grid must not leak into a legacy preset.
App._restoreModeStates({video:{tile:200,rate:1.5}},{resetMissingDefaults:true});
for(const key of Object.keys(defaults)) assert.equal(Movie.P[key],defaults[key],key+' legacy preset');
assert.equal(Movie.P.tile,200); assert.equal(Movie.P.rate,1.5);
App._restoreModeStates({video:{columns:4,gapX:3,scrollX:0.4}},{resetMissingDefaults:true});
assert.equal(Movie.P.columns,4); assert.equal(Movie.P.gapX,3); assert.equal(Movie.P.scrollX,0.4);
App._restoreModeStates({},{resetMissingDefaults:true});
for(const key of Object.keys(defaults)) assert.equal(Movie.P[key],defaults[key],key+' absent Movie preset');
// Actual rendering sets/disables layout on each slot, without adding texture uploads.
const calls=[];
Movie.gl=new Proxy({}, {get:(_,k)=>k===k.toUpperCase()?k:(...args)=>{ calls.push([k,...args]); return {}; }});
Movie.initialized=true;
Movie.locs=Object.fromEntries(['pos','tex','texPrev','mixT','viewSize','vidSize','fit','pan','zoom','fx','fx1','fx2','time','layout','grid','cell','stagger'].map(k=>[k,k]));
GL.slots={A:{_clock:0},B:{_clock:0}};
for(const key of ['A','B']){
  const s=Movie._slot(key); s.tex={}; s.texPrev={}; s.P=Movie._newSlotState().P;
}
Movie._slot('A').P.columns=4; Movie._slot('A').P.scrollX=0.5;
Movie.update(2.9,'beat','A');
calls.length=0; Movie.render({fbo:null,w:1920,h:1080,slotKey:'A',clock:0.25});
assert.ok(calls.some(c=>c[0]==='uniform1f' && c[1]==='layout' && c[2]===1));
assert.ok(!calls.some(c=>c[0]==='texImage2D'),'layout reuses the video textures');
near(calls.find(c=>c[0]==='uniform4f' && c[1]==='cell')[2],layout(Movie._slot('A').P,2.9,0.25,'beat').cell[0]);
calls.length=0; Movie.render({fbo:null,w:1920,h:1080,slotKey:'B'});
assert.ok(calls.some(c=>c[0]==='uniform1f' && c[1]==='layout' && c[2]===0));
assert.ok(calls.some(c=>c[0]==='uniform1f' && c[1]==='fx' && c[2]===0));
assert.ok(!calls.some(c=>c[0]==='uniform4f' && c[1]==='grid'));
console.log('PASS: Movie layout defaults, dead zone, limits, Tile, Beat/Drone, periodic scrolling, UI, i18n, Save/Reset/Random, legacy presets and slot render uniforms');
