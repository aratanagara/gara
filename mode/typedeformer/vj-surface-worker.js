'use strict';
/* vj 用 Surface Worker。上流 type-deformer の surface-worker.js + surface-worker-kernels.js (MIT) をもとに、
 * vj の Type Deformer から使う部分だけに絞ったもの。
 *   - kind:'frame' (効果レイヤーの描画) のみ。composition / bounds は扱わない
 *   - plan の envelope 倍率をフレームから受け取る (Worker のエンジン状態を外から渡すため)
 *   - フォントは frame.fontCss の @font-face (vj の style.css / Adobe Fonts のキット CSS) から、
 *     params.fontFamily のスタックに含まれる書体だけを読み込む */
var V=self.location.search;   // 本体の ?v= を importScripts にも付ける (キャッシュバスト)
importScripts('operator-registry.js'+V,'shared-surface-renderers.js'+V,'surface-state.js'+V,'render-context.js'+V,'render-envelope.js'+V,'parameter-model.js'+V,'parameter-definitions.js'+V,'font-axes.js'+V,'text-layout.js'+V);
self.TypeDeformerWorkerRuntime=true;
var workerMobile=false,workerReducedMotion=false;
importScripts('numerical-kernels.js'+V,'structural-operators.js'+V,'pattern-tension-operators.js'+V,'wave-growth-operators.js'+V,'order-matter-operators.js'+V,'hyperbolic-atlas-operator.js'+V,'loadpath-foundry-operator.js'+V,'nodal-glaze-operator.js'+V,'spinodal-alloy-operator.js'+V,'density-recast-operator.js'+V,'hopf-loom-operator.js'+V,'miura-vault-operator.js'+V,'vortex-bath-operator.js'+V,'stress-glass-operator.js'+V,'excess-body-operators.js'+V,'ramified-body-operators.js'+V,'folded-body-operators.js'+V,'letterform-body-operators.js'+V,'metamorphic-body-operators.js'+V,'gravity-lens-operator.js'+V,'liquid-rope-body.js'+V,'wulff-body-operator.js'+V,'repulsive-curves-body.js'+V,'wasserstein-letters.js'+V,'field-material-operators.js'+V,'conditions-of-type.js'+V);
var workerFontMetrics={},params={},compositionState={},renderedSourceText='',surfaceFxPhase=0,dataMoshFrame=0,blobTrackState={blobs:[]},surfaceFxScratchCanvases={},compositionScene={},compositionQualityOverride=null;
var workerFontRuntime=TypeDeformerAxes.createRuntime({fonts:self.fonts});
var axisFieldEditor={font:function(g,size){return workerFontRuntime.activate(params,g,size);}};
importScripts('editor-model.js'+V,'render-engine.js'+V,'surface-worker-adapter.js'+V);
var workerEngine=TypeDeformerWorkerAdapter.create({
  get params(){return params;},set params(v){params=v;},
  get compositionState(){return compositionState;},set compositionState(v){compositionState=v;},
  get renderedSourceText(){return renderedSourceText;},set renderedSourceText(v){renderedSourceText=v;},
  get surfaceFxPhase(){return surfaceFxPhase;},set surfaceFxPhase(v){surfaceFxPhase=v;},
  get dataMoshFrame(){return dataMoshFrame;},set dataMoshFrame(v){dataMoshFrame=v;},
  get blobTrackState(){return blobTrackState;},set blobTrackState(v){blobTrackState=v;},
  get surfaceFxScratchCanvases(){return surfaceFxScratchCanvases;},set surfaceFxScratchCanvases(v){surfaceFxScratchCanvases=v;},
  get compositionScene(){return compositionScene;},set compositionScene(v){compositionScene=v;},
  get compositionQualityOverride(){return compositionQualityOverride;},set compositionQualityOverride(v){compositionQualityOverride=v;},
  get fontMetrics(){return workerFontMetrics;},
  get compositionInputs(){return {};},
  get sourceGlyphs(){return [];},
  get mobile(){return workerMobile;},
  get reducedMotion(){return workerReducedMotion;},
  font:function(g,size){return axisFieldEditor.font(g,size);}
});

var cssTexts=new Map(),faceLoads=new Map();
function fontProperty(body,name){var m=body.match(new RegExp('(?:^|;)\\s*'+name+'\\s*:\\s*([^;]+)'));return m?m[1].trim():'';}
function inFontRange(text,range){
  if(!range)return true;
  var intervals=range.split(',').map(function(r){r=r.trim().replace(/^U\+/i,'');if(r.includes('?'))return [parseInt(r.replace(/\?/g,'0'),16),parseInt(r.replace(/\?/g,'F'),16)];var a=r.split('-');return [parseInt(a[0],16),parseInt(a[1]||a[0],16)];});
  return Array.from(text).some(function(ch){var cp=ch.codePointAt(0);return intervals.some(function(r){return cp>=r[0]&&cp<=r[1];});});
}
function stackFamilies(stack){return String(stack||'').split(',').map(function(s){return s.trim().replace(/^['"]|['"]$/g,'');}).filter(Boolean);}
function absoluteSrc(src,base){return src.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g,function(all,q,u){try{return 'url("'+new URL(u,base).href+'")';}catch(e){return all;}});}
async function loadFonts(frame){
  var families=stackFamilies(params.fontFamily),characters=frame.text+frame.glyphs.map(function(g){return g.ch||'';}).join('');
  var tasks=[];
  // entry = {text, base} (メインスレッドで読めた @font-face 規則) または {href} (読めない外部シート)
  for(var entry of frame.fontCss||[]){
    var url=entry.base||entry.href,css;
    if(entry.text!=null)css=entry.text;
    else{
      if(!cssTexts.has(url))cssTexts.set(url,fetch(url).then(function(r){if(!r.ok)throw new Error('font css '+r.status);return r.text();}).catch(function(error){cssTexts.delete(url);throw error;}));
      try{css=await cssTexts.get(url);}catch(e){continue;}
    }
    for(var block of css.matchAll(/@font-face\s*\{([^}]+)\}/g)){
      var body=block[1],family=fontProperty(body,'font-family').replace(/['"]/g,''),range=fontProperty(body,'unicode-range');
      if(!families.includes(family)||!inFontRange(characters,range))continue;
      var src=absoluteSrc(fontProperty(body,'src'),url),weight=fontProperty(body,'font-weight')||'normal',style=fontProperty(body,'font-style')||'normal',id=family+'|'+src+'|'+weight+'|'+style;
      if(!faceLoads.has(id)){
        var face=new FontFace(family,src,{weight:weight,style:style,unicodeRange:range||'U+0-10FFFF'});
        faceLoads.set(id,face.load().then(function(f){self.fonts.add(f);TypeDeformerFieldMaterials.invalidateSources();return f;}).catch(function(){return null;}));
      }
      tasks.push(faceLoads.get(id));
    }
  }
  await Promise.all(tasks);
}

async function renderFrame(frame){
  var jobStarted=performance.now(),budget=TypeDeformerRenderContext.limits(frame.purpose,frame.mobile);
  params=frame.params;compositionState=frame.composition||{enabled:false,phase:0};renderedSourceText=frame.text||'';surfaceFxPhase=frame.surfacePhase||0;dataMoshFrame=frame.dataMoshFrame||0;blobTrackState=frame.blobTrack||{blobs:[]};
  workerMobile=!!frame.mobile;workerReducedMotion=false;
  TypeDeformerSurfaceState.unpack(frame.glyphs,frame.surfaces,params);
  await loadFonts(frame);workerFontMetrics=frame.fm;
  workerEngine.differentialPrepare(frame.glyphs);workerEngine.conformalPrepare(frame.glyphs);workerEngine.auxeticPrepare(frame.glyphs);workerEngine.marblingPrepare(frame.glyphs);
  var solverStarted=performance.now();
  while(true){
    try{workerEngine.differentialAssertReady(frame.glyphs);workerEngine.conformalAssertReady(frame.glyphs);workerEngine.auxeticAssertReady(frame.glyphs);workerEngine.marblingAssertReady(frame.glyphs);break;}
    catch(error){
      if(!/_PENDING$/.test(error.code||''))throw error;
      if(performance.now()-solverStarted>20000)throw Object.assign(new Error('glyph preparation timeout'),{code:'RENDER_TIMEOUT'});
      var growth=workerEngine.differentialController.state;
      if(growth.memoryPaused||growth.error)throw new Error(growth.error||'growth memory budget exceeded');
      await new Promise(function(resolve){setTimeout(resolve,0);});
    }
    workerEngine.differentialController.advance(50);workerEngine.conformalPool.advance();workerEngine.auxeticPool.advance();workerEngine.marblingPool.advance({maxWork:65536,maxMs:30});
  }
  workerEngine.surfaceEnvelopeScale=frame.envelopeScale||1;
  var started=performance.now(),R=TypeDeformerRenderContext,plan=workerEngine.surfaceCanonicalRasterPlan(frame.glyphs),L=frame.layout,scale=frame.scale,width=plan.width,height=plan.height;
  var factor=scale*L.s/plan.density,projectedX=scale*(L.dx+plan.bounds.x*L.s),projectedY=scale*(L.dy+plan.bounds.y*L.s);
  var viewX=Math.max(0,Math.floor(-projectedX)),viewY=Math.max(0,Math.floor(-projectedY));
  var viewW=Math.max(0,Math.min(Math.ceil(width*factor),Math.ceil(frame.width-projectedX))-viewX),viewH=Math.max(0,Math.min(Math.ceil(height*factor),Math.ceil(frame.height-projectedY))-viewY);
  var tiles=R.tiles(viewW,viewH,1024).map(function(t){t.x+=viewX;t.y+=viewY;return t;}),layers={},timings={};
  try{
    for(var id of frame.operators){
      if(!workerEngine.renderers[id])throw new Error('Worker renderer missing: '+id);
      var start=performance.now(),canvas=new OffscreenCanvas(frame.width,frame.height),target=canvas.getContext('2d');
      for(var tile of tiles){
        var context=R.make({purpose:frame.purpose,mobile:frame.mobile,software:false,presentation:'standard',nativeLocalDensity:false,width:frame.width,height:frame.height,viewScale:scale*L.s,factor:factor,tile:tile,referenceWidth:width,referenceHeight:height,overscan:Math.ceil(64*factor)});
        var envelope=null;
        R.withContext(context,function(){return R.withScope(function(){
          var layer=workerEngine.surfaceScratch('worker-layer',width,height,true);
          workerEngine.renderers[id](layer.ctx,frame.glyphs,width,height,plan.density,plan.layout,frame.fm,false,false,context);
          var contact=frame.noEnvelope?null:TypeDeformerRenderEnvelope.scanCanvas(layer.canvas,{gutter:3,threshold:1});
          if(!frame.noEnvelope&&TypeDeformerRenderEnvelope.touches(contact)&&(plan.envelopeScale||1)<8){envelope={kind:'envelope',requiredScale:TypeDeformerRenderEnvelope.nextScale(plan.envelopeScale||1,contact)};return;}
          target.save();target.setTransform(factor,0,0,factor,projectedX,projectedY);
          var tx=tile.x/factor,ty=tile.y/factor,tw=tile.width/factor,th=tile.height/factor;
          R.drawImage(target,layer.canvas,tx,ty,tw,th,tx,ty,tw,th);target.restore();
        });});
        if(envelope){Object.values(layers).forEach(function(b){b.close();});canvas.width=canvas.height=1;return Object.assign(envelope,{layers:{}});}
      }
      layers[id]=canvas.transferToImageBitmap();canvas.width=canvas.height=1;timings[id]=performance.now()-start;
    }
    return {kind:'frame',layers:layers,timings:timings,duration:performance.now()-jobStarted,paintDuration:performance.now()-started};
  }catch(error){Object.values(layers).forEach(function(b){b.close();});throw error;}
}
self.onmessage=async function(event){
  var message=event.data;if(message.type==='layerAck')return;
  try{var result=await renderFrame(message.payload);self.postMessage({type:'result',id:message.id,result:result},Object.values(result.layers));}
  catch(error){self.postMessage({type:'error',id:message.id,message:error.message,code:error.code||'',stack:error.stack});}
};
