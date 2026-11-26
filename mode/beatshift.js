'use strict';
/* B Beat Shift: capture pristine engines before App.init, then lazily create a B instance.
   GPU buffers, canvases, accumulated clocks and async callbacks belong to that instance.
   UI / defaults / saved parameters still belong to the original engine. */
const BSHIFT_SEED_OFFSET = 17;   // B の分身の seed に足す量 (A と別の模様にする)
const BShift = {
  bases: {
    layer: typeof Layer !== 'undefined' ? Layer : undefined,
    manga: typeof Manga !== 'undefined' ? Manga : undefined,
    textdeform: typeof TextDeform !== 'undefined' ? TextDeform : undefined,
    ugomeki: typeof Ugomeki !== 'undefined' ? Ugomeki : undefined,
    spacetype: typeof SpaceType !== 'undefined' ? SpaceType : undefined,
    video: typeof Movie !== 'undefined' ? Movie : undefined,
    image: typeof ImageMode !== 'undefined' ? ImageMode : undefined,
    aratanagara: typeof Aratanagara !== 'undefined' ? Aratanagara : undefined,
    slicer: typeof Slicer !== 'undefined' ? Slicer : undefined,
    cyberui: typeof CyberUI !== 'undefined' ? CyberUI : undefined,
    novel: typeof NovelTerminal !== 'undefined' ? NovelTerminal : undefined,
    grayscott: typeof GrayScott !== 'undefined' ? GrayScott : undefined,
    inkelly: typeof Inkelly !== 'undefined' ? Inkelly : undefined,
    pen: typeof Pen !== 'undefined' ? Pen : undefined,
    boltzmann: typeof Boltzmann !== 'undefined' ? Boltzmann : undefined,
    caverns: typeof Caverns !== 'undefined' ? Caverns : undefined,
    photoplane: typeof PhotoPlane !== 'undefined' ? PhotoPlane : undefined,
    shredder: typeof Shredder !== 'undefined' ? Shredder : undefined,
    transflock: typeof TransFlock !== 'undefined' ? TransFlock : undefined,
    windflock: typeof WindFlock !== 'undefined' ? WindFlock : undefined,
    tower4149: typeof Tower4149 !== 'undefined' ? Tower4149 : undefined,
    chrometype: typeof ChromeType !== 'undefined' ? ChromeType : undefined,
    imgconstruct: typeof ImageConstruct !== 'undefined' ? ImageConstruct : undefined,
    glitchtype: typeof GlitchType !== 'undefined' ? GlitchType : undefined,
    surrealfloat: typeof SurrealFloat !== 'undefined' ? SurrealFloat : undefined,
    fude: typeof Fude !== 'undefined' ? Fude : undefined,
    liquidpeel: typeof LiquidPeel !== 'undefined' ? LiquidPeel : undefined,
    shelf: typeof Shelf !== 'undefined' ? Shelf : undefined,
    ribbon: typeof Ribbon !== 'undefined' ? Ribbon : undefined,
    ...(typeof RhizomeKinds !== 'undefined' ? RhizomeKinds : {}),
  },
  templates: {}, instances: {},
  // Only uninitialized definitions are copied. Non-plain immutable helpers (Intl, RegExp)
  // can be shared; live WebGL / DOM objects never enter a template.
  copy(v){
    if(!v || typeof v !== 'object') return v;
    if(Array.isArray(v)) return v.map(x => this.copy(x));
    if(ArrayBuffer.isView(v)) return v.slice();
    if(v instanceof Map) return new Map(Array.from(v, ([k,x]) => [k,this.copy(x)]));
    if(v instanceof Set) return new Set(v);
    if(Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return v;
    const out = {};
    for(const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(v))){
      if('value' in d) d.value = this.copy(d.value);
      Object.defineProperty(out, k, d);
    }
    return out;
  },
  capture(){
    for(const [kind, base] of Object.entries(this.bases)){
      if(!base || kind === 'video' || kind === 'image') continue;
      const t = {};
      // Rhizome variants inherit methods/state from the base definition.
      for(const k in base){
        let owner = base;
        while(!Object.hasOwn(owner, k)) owner = Object.getPrototypeOf(owner);
        const d = Object.getOwnPropertyDescriptor(owner, k);
        if('value' in d) d.value = k === 'P' ? JSON.parse(JSON.stringify(d.value)) : this.copy(d.value);
        Object.defineProperty(t, k, d);
      }
      this.templates[kind] = t;
    }
  },
  engine(kind, slotKey){
    const base = this.bases[kind];
    if(!base || slotKey !== 'B' || !(App.slotBOffsetBeats > 0) || !BSHIFT_STATEFUL.has(kind)) return base;
    let e = this.instances[kind];
    if(!e){
      e = this.instances[kind] = this.copy(this.templates[kind]);
      e._bShift = true;
      // The base owns source image loading; the B instance only owns its geometry.
      if(kind === 'photoplane') e.autoLoadFromFolder = async () => 0;
      if(kind === 'textdeform'){
        const m = e._modules = {};
        m.TDUpstream = createTDUpstream(e);
        // Script loading is shared; renderer / worker state and parameter access are not.
        m.TDUpstream.load = globalThis.TDUpstream.load.bind(globalThis.TDUpstream);
        m.TDComp = createTDComp(e, m);
        m.TDSurf = createTDSurf(e, m);
        m.TDLooks = createTDLooks(e, m);
        m.TDVec = createTDVec(e, m);
        m.TDCanvas = createTDCanvas(e, m);
      }
    }
    if(e._modules){
      // Look catalogs are source data, not simulation state. Include catalogs that
      // finish loading after the B instance was created (Canvas resolves saved Look IDs).
      e._modules.TDLooks.saved = globalThis.TDLooks.saved;
      e._modules.TDSurf.presets = globalThis.TDSurf.presets;
    }
    const sig = JSON.stringify(base.P);
    if(e._bShiftParams !== sig){
      const p = JSON.parse(sig);
      // A seed is a render input, not a changed UI/default. B gets its own initial pattern.
      // 足す量は小さく保つ。シェーダの乱数は float で seed を掛けるので、10 万を超える値では精度が落ちて模様が潰れる (C013 WIND FLOCK が線 1 本に)
      if(typeof p.seed === 'number') p.seed += BSHIFT_SEED_OFFSET;
      if(kind === 'textdeform' && p.comp) p.comp.seed = (+p.comp.seed || 0) + BSHIFT_SEED_OFFSET;
      Object.assign(e.P, p);
      e._bShiftParams = sig;
      if(e.initialized){
        if(e.applyP) e.applyP();
        if(e.markDirty) e.markDirty();
        if(e.rebuild) e.rebuild();
        if(e.generateLayout) e.generateLayout();
        e._dirty = true; e._layoutDirty = true;
        if(kind === 'ugomeki') e._layout = null;
      }
    }
    if(!e.initialized){
      const p = JSON.parse(JSON.stringify(e.P));
      e.init(GL.gl);
      if(!e.initialized) return e;
      // Some initializers choose a random text/preset; preserve the selected Visual's P.
      Object.assign(e.P, p);
      if(e.applyP) e.applyP();
    }
    if(e._bShiftBeats !== App.slotBOffsetBeats){
      const beats = App.slotBOffsetBeats - (e._bShiftBeats || 0);
      const sec = beats * 60 / Math.max(20, BPM.bpm);
      for(const k of ['_t', '_typeT', 'clock']) if(typeof e[k] === 'number') e[k] += sec;
      if(e._modules){
        const m = e._modules, wrap = x => ((x % 1) + 1) % 1;
        m.TDSurf.phase = wrap(m.TDSurf.phase + sec * (+m.TDSurf.cfg.speed || 0));
        m.TDComp.get().phase = wrap(m.TDComp.get().phase + beats / 4);
        m.TDVec._ang += sec;
      }
      e._bShiftBeats = App.slotBOffsetBeats;
    }
    // Read-only source media can be shared; generated page/scene textures stay private.
    if(kind === 'manga') e.images = base.images;
    if(kind === 'layer' || kind === 'photoplane'){
      if(e.textures !== base.textures){
        e.textures = base.textures; e.texAspects = base.texAspects;
        if(kind === 'layer') e.texKeyColors = base.texKeyColors;
        e.generateLayout();
      }
    }
    if(kind === 'slicer'){
      e.library = base.library;
      if(base.imageReady && e._bShiftSourceTex !== base.imgTex){
        if(e.imgTex && e.imgTex !== e._bShiftSourceTex) GL.gl.deleteTexture(e.imgTex);
        e._bShiftSourceTex = base.imgTex;
        for(const k of ['imgTex', 'imgW', 'imgH', 'imgAsp', 'imageReady', 'bgFromImage', 'curName']) e[k] = base[k];
        e.markDirty();
      }
    }
    return e;
  },
};
BShift.capture();
