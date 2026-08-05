/* ================= Type Deformer — Composition Engine v6 =================
 * synomare/type-deformer の Composition Engine v6 移植 (Field / Flux Rows /
 * Cascade / Contour Atlas / Feedback Chamber + FXラック echo/feedback/
 * signalMask/chromaticSplit/rasterMaterial、WebGL2パス + Canvas2D解析フォールバック)。
 * VJ 版: TextDeform の 2D パイプラインへ組み込み。phase は TextDeform.update()
 * から自動進行。状態は md 単位 (pr.p.comp) — loadPreset が TDComp.applyMd() で
 * 適用し、保存の無い md ではデフォルト(Off)へ戻る。永続化は「デフォルト保存」経由。
 * ======================================================================== */
(function(){
'use strict';
if(typeof TextDeform === 'undefined') return;
const TD = TextDeform;

/* ---- 元エディタのグローバルへのシム ---- */
const params = new Proxy({}, {
  get: (_, k) => TD.P ? TD.P[k] : undefined,
  set: (_, k, v) => { if(TD.P) TD.P[k] = v; return true; },
  has: (_, k) => !!TD.P && (k in TD.P)
});
const textInput = { get value(){ return String((TD.P && TD.P.text) || ''); } };
function hash(j, cp, k){ return TD._hash(j, cp, k); }
function charInfo(ch, cp){ return TD._charInfo(ch); }
const digitRe = (function(){ try{ return new RegExp('\\p{Nd}', 'u'); }catch(e){ return /[0-9０-９]/; } })();
function batchKeyFor(ch, cp, info){
  info = info || charInfo(ch, cp);
  if(info.punct) return 'punct';
  if(digitRe.test(ch)) return 'digit';
  if(info.cls === 'kanji' || info.cls === 'hira' || info.cls === 'kata' || info.cls === 'latin') return info.cls;
  return '';
}
function tokenizeLine(line){
  const chars = TD._toGraphemes(line);
  const tokens = [];
  for(let i=0; i<chars.length; i++){
    const ch = chars[i], cp = ch.codePointAt(0);
    if(cp === 32 || cp === 9 || cp === 160 || cp === 0x3000) tokens.push({ space: true, text: ' ' });
    else tokens.push({ text: ch });
  }
  return tokens;
}
function fontMetrics(){ return TD._fontMetrics(TD.ctx); }
function baselineOffset(g, fm){
  const leading = g.h - (fm.ascent + fm.descent);
  return leading/2 + fm.ascent;
}
function scheduleCompositionDraw(){}
function updateCompositionStatus(){}
// TextDeform の glyph snapshot を元エディタの snapshotGlyphs 形式へ変換。
// ソース座標はステージ左上基準なので、版面をシーン中央へ平行移動して渡す
// (source 位置を直接使うエンジン = contourAtlas / feedbackChamber の構図が中央に来る)。
function snapshotGlyphs(forceAll){
  const src = TD._snapshotGlyphs();
  const fs = params.fontSize;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for(const g of src){
    if(g.x < minX) minX = g.x;
    if(g.y < minY) minY = g.y;
    if(g.x + g.w > maxX) maxX = g.x + g.w;
    if(g.y + g.h > maxY) maxY = g.y + g.h;
  }
  const sw = compositionScene.width || 1080, sh = compositionScene.height || 1080;
  const offX = isFinite(minX) ? (sw - (maxX - minX))/2 - minX : 0;
  const offY = isFinite(minY) ? (sh - (maxY - minY))/2 - minY : 0;
  const out = [];
  for(let i=0; i<src.length; i++){
    const g = src[i];
    const x = g.x + offX, y = g.y + offY;
    out.push({
      ch: g.ch, upright: g.upright, accent: g.accent, opacity: 1,
      x: x, y: y, w: g.w, h: g.h,
      bx: x, by: y, bw: g.w, bh: g.h,
      grid: !!params.gridEnabled,
      ox: g.ox + offX, oy: g.oy + offY,
      tx: g.tx + (params.vertical ? (g.bl || 0)*fs : 0),
      ty: g.ty + (params.vertical ? 0 : -(g.bl || 0)*fs),
      rot: (g.rot || 0) + (g.opRot || 0),
      skewX: g.skx || 0, skewY: g.sky || 0,
      scaleX: (g.scaleX || 1)*(g.mirX == null ? 1 : g.mirX),
      scaleY: (g.scaleY || 1)*(g.mirY == null ? 1 : g.mirY),
      misregX: g.misX || 0, misregY: g.misY || 0
    });
  }
  return out;
}

      // codepoint/glyph/box operators from that source glyph.
      var COMPOSITION_DEFS = {
        field: { id: 'field', label: 'Field' },
        fluxRows: { id: 'fluxRows', label: 'Flux Rows' },
        cascade: { id: 'cascade', label: 'Cascade' },
        contourAtlas: { id: 'contourAtlas', label: 'Contour Atlas' },
        feedbackChamber: { id: 'feedbackChamber', label: 'Feedback Chamber' }
      };
      // The registry is populated after the generator functions have been
      // declared. Keeping the public name here lets UI, export and plug-in code
      // discover the v6 engine contract without depending on declaration order.
      var COMPOSITION_ENGINES = {};
      var COMPOSITION_DEFAULTS = {
        schemaVersion: 6,
        enabled: false,
        type: 'field',
        phase: 0,
        speed: 0.18,
        direction: 1,
        axis: 'inherit',
        seed: 1,
        loopLock: true,
        quality: 'auto',
        logicalViewport: { width: 1080, height: 1080, legacyResponsive: false },
        macros: {
          intensity: 0.65, density: 0.6, instability: 0.35,
          depth: 0.45, legibility: 0.85
        },
        fxRack: {
          echo: { enabled: false, amount: 0.45, count: 3, phase: 0.08, decay: 0.62, scale: 0.025, rotation: 3 },
          feedback: { enabled: false, amount: 0.35, zoom: 0.025, rotation: 2, warp: 0.15 },
          signalMask: { enabled: false, amount: 0.5, mode: 'text', feather: 0.08 },
          chromaticSplit: { enabled: false, amount: 0.45, distance: 6, angle: 0, blend: 'screen' },
          rasterMaterial: { enabled: false, amount: 0.35, pixelate: 0, posterize: 0, scanline: 0.25, noise: 0.15 }
        },
        color2: '#1767a6',
        color3: '#d0a000',
        field: {
          cols: 21, rows: 21, waveX: 3.1, waveY: 3.1,
          ampX: 0, ampY: 0.7, scaleX: 0.35, scaleY: 0.8,
          rotation: 0, depth: 0.18,
          topology: 'cartesian', fieldType: 'wave', sources: 1,
          pointerMode: 'none', pointerForce: 0.8, orientation: 'fixed',
          domainWarp: 0, perspective: 0, depthFalloff: 0.35,
          variation: 0.2, variationMode: 'unicode',
          network: 0, echoOrbit: 0, colorMode: 'ink'
        },
        fluxRows: {
          rows: 11, curve: 1.25, tracking: 0.22, lineGap: 0.12,
          scroll: 2, amount: 0.18, mirror: true, flip: false,
          baseline: 'straight', laneSpeed: 'uniform', phaseOffset: 0.12,
          amplitude: 0.45, density: 1, integerTravel: true, counterflow: 0,
          compression: 0, slit: 0, accordion: 0, tangent: 0,
          perspective: 0, colorMode: 'ink',
          weave: 0, trail: 0, scanEcho: 0, pointerBranch: 0
        },
        cascade: {
          rows: 14, tracking: 0.18, lineSpace: 0.2,
          waveLength: 0.13, amplitude: 1.25, slope: 1,
          mirror: false, bands: true,
          system: 'automaton', shape: 'rounded', colorMode: 'state',
          rule: 110, customRule: 110, seed: 'unicode', cells: 42,
          circuitDensity: 0.7, pulse: 0.55,
          signalMode: 'slices', signalLayers: 4, signalFeedback: 0.58, quantize: 12,
          sdfMode: 'interference', frequency: 9, warp: 0.65, threshold: 0.5,
          contours: 4, sdfFeedback: 0.68,
          automatonMode: '1d', lifeRule: 'B3/S23', generationCount: 24,
          generationBlend: 0.5, pingPong: true,
          circuitBranches: 3, circuitRouters: 8, circuitPackets: 16,
          packetTrail: 0.4, circuitHeatmap: 0, addressNodes: 0.65, pointerInject: true,
          signalSources: 2, signalSync: 0.5, glyphWarp: 0,
          diffraction: 0, chromatic: 0,
          backgroundAmount: 1, textAmount: 1,
          gap: 0.08, round: 0.18, opacity: 1, stroke: 0, scanline: 0.12,
          blend: 'source-over', glyphMode: 'contrast',
          backdropEnabled: true, backdropOpacity: 1,
          backdrop: '#f4f3ef', fieldA: '#17140f', fieldB: '#c41f1f',
          fieldC: '#1767a6', edge: '#d0a000', glyph: '#f4f3ef'
        },
        contourAtlas: {
          source: 'glyphDistance', rendering: 'hybrid',
          levels: 12, resolution: 72, spacing: 0.1, lineWidth: 1.2,
          dash: 0, density: 0.62, charge: 0.6, interference: 0.4,
          pointerRelief: 0.55, glyphs: true, filled: false,
          tangent: 1, threshold: 0.5, fillOpacity: 0.12, textHeight: 0.65,
          colorMode: 'ink', preset: 'topographic'
        },
        feedbackChamber: {
          transform: 'zoom', warp: 'wave', mirror: 'none',
          zoom: 0.035, rotation: 2.5, driftX: 0, driftY: 0,
          shear: 0, warpAmount: 0.35, decay: 0.72,
          injection: 0.78, threshold: 0.15, persistence: 0.7,
          echoes: 9, kaleidoscope: 6, pointerCenter: true,
          loopLock: true, preset: 'recursiveType'
        }
      };

      function cloneCompositionDefaults() {
        return JSON.parse(JSON.stringify(COMPOSITION_DEFAULTS));
      }

      var compositionState = cloneCompositionDefaults();
      var compositionInspector = 'field';
      var compositionScene = { glyphs: [], bands: [], width: 0, height: 0, limited: false };
      var compositionDrawRaf = null;
      var compositionPlayRaf = null;
      var compositionLastTime = 0;
      var compositionPreviewLayout = { dx: 0, dy: 0, s: 1, w: 1, h: 1 };
      // Auto quality starts at the full/default topology. It may step down
      // immediately after a genuinely slow frame, but only promotes to High
      // after a sustained run of fast frames.
      var compositionFrameAverage = 0;
      var compositionAutoTier = 'normal';
      var compositionAutoFastFrames = 0;
      var compositionQualityOverride = null;
      var compositionSourceRevision = 1;

      function invalidateCompositionSource() {
        compositionSourceRevision++;
        snapshotGlyphs.cache = null;
      }


      function cloneCompositionState() {
        return JSON.parse(JSON.stringify(compositionState));
      }

      function persistentCompositionState() {
        var snapshot = cloneCompositionState();
        delete snapshot.quality;
        return snapshot;
      }

      function normalizeComposition(raw) {
        var out = cloneCompositionDefaults();
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
        function number(source, key, min, max, fallback, integer) {
          var value = Number(source && source[key]);
          if (!isFinite(value)) value = fallback;
          value = Math.max(min, Math.min(max, value));
          return integer ? Math.round(value) : value;
        }
        function bool(source, key, fallback) {
          if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return fallback;
          return source[key] === true || source[key] === 1;
        }
        function choice(source, key, values, fallback) {
          return source && values.indexOf(source[key]) !== -1 ? source[key] : fallback;
        }
        function color(source, key, fallback) {
          return source && typeof source[key] === 'string' && /^#[0-9a-f]{6}$/i.test(source[key]) ? source[key] : fallback;
        }
        out.schemaVersion = 6;
        out.enabled = bool(raw, 'enabled', false);
        out.type = COMPOSITION_DEFS[raw.type] ? raw.type : out.type;
        out.phase = number(raw, 'phase', 0, 1, out.phase, false);
        out.speed = number(raw, 'speed', 0.01, 1, out.speed, false);
        out.direction = Number(raw.direction) === -1 ? -1 : 1;
        out.axis = ['inherit', 'horizontal', 'vertical'].indexOf(raw.axis) !== -1 ? raw.axis : out.axis;
        out.seed = number(raw, 'seed', 0, 2147483647, out.seed, true);
        out.loopLock = bool(raw, 'loopLock', out.loopLock);
        out.quality = choice(raw, 'quality', ['auto', 'high', 'performance'],
          choice(raw, 'previewQuality', ['auto', 'high', 'performance'], out.quality));
        out.logicalViewport.width = number(raw.logicalViewport, 'width', 64, 8192, out.logicalViewport.width, true);
        out.logicalViewport.height = number(raw.logicalViewport, 'height', 64, 8192, out.logicalViewport.height, true);
        out.logicalViewport.legacyResponsive = bool(raw.logicalViewport, 'legacyResponsive', Number(raw.schemaVersion || 5) < 6);
        ['intensity', 'density', 'instability', 'depth', 'legibility'].forEach(function (key) {
          out.macros[key] = number(raw.macros, key, 0, 1, out.macros[key], false);
        });
        var rawFx = raw.fxRack || raw.fx || {};
        if (rawFx.echoTrail && !rawFx.echo) rawFx.echo = rawFx.echoTrail;
        out.fxRack.echo.enabled = bool(rawFx.echo, 'enabled', out.fxRack.echo.enabled);
        out.fxRack.echo.amount = number(rawFx.echo, 'amount', 0, 1, out.fxRack.echo.amount, false);
        out.fxRack.echo.count = number(rawFx.echo, 'count', 1, 12, out.fxRack.echo.count, true);
        out.fxRack.echo.phase = number(rawFx.echo, 'phase', 0, 0.5, out.fxRack.echo.phase, false);
        out.fxRack.echo.decay = number(rawFx.echo, 'decay', 0, 1, out.fxRack.echo.decay, false);
        out.fxRack.echo.scale = number(rawFx.echo, 'scale', -0.25, 0.25, out.fxRack.echo.scale, false);
        out.fxRack.echo.rotation = number(rawFx.echo, 'rotation', -45, 45, out.fxRack.echo.rotation, false);
        out.fxRack.feedback.enabled = bool(rawFx.feedback, 'enabled', out.fxRack.feedback.enabled);
        out.fxRack.feedback.amount = number(rawFx.feedback, 'amount', 0, 1, out.fxRack.feedback.amount, false);
        out.fxRack.feedback.zoom = number(rawFx.feedback, 'zoom', -0.2, 0.2, out.fxRack.feedback.zoom, false);
        out.fxRack.feedback.rotation = number(rawFx.feedback, 'rotation', -30, 30, out.fxRack.feedback.rotation, false);
        out.fxRack.feedback.warp = number(rawFx.feedback, 'warp', 0, 1, out.fxRack.feedback.warp, false);
        out.fxRack.signalMask.enabled = bool(rawFx.signalMask, 'enabled', out.fxRack.signalMask.enabled);
        out.fxRack.signalMask.amount = number(rawFx.signalMask, 'amount', 0, 1, out.fxRack.signalMask.amount, false);
        out.fxRack.signalMask.mode = choice(rawFx.signalMask, 'mode', ['text', 'inverseText', 'field', 'luma'], out.fxRack.signalMask.mode);
        out.fxRack.signalMask.feather = number(rawFx.signalMask, 'feather', 0, 1, out.fxRack.signalMask.feather, false);
        out.fxRack.chromaticSplit.enabled = bool(rawFx.chromaticSplit, 'enabled', out.fxRack.chromaticSplit.enabled);
        out.fxRack.chromaticSplit.amount = number(rawFx.chromaticSplit, 'amount', 0, 1, out.fxRack.chromaticSplit.amount, false);
        out.fxRack.chromaticSplit.distance = number(rawFx.chromaticSplit, 'distance', 0, 80, out.fxRack.chromaticSplit.distance, false);
        out.fxRack.chromaticSplit.angle = number(rawFx.chromaticSplit, 'angle', -180, 180, out.fxRack.chromaticSplit.angle, false);
        out.fxRack.chromaticSplit.blend = choice(rawFx.chromaticSplit, 'blend', ['screen', 'multiply', 'difference', 'lighter'], out.fxRack.chromaticSplit.blend);
        out.fxRack.rasterMaterial.enabled = bool(rawFx.rasterMaterial, 'enabled', out.fxRack.rasterMaterial.enabled);
        out.fxRack.rasterMaterial.amount = number(rawFx.rasterMaterial, 'amount', 0, 1, out.fxRack.rasterMaterial.amount, false);
        ['pixelate', 'posterize', 'scanline', 'noise'].forEach(function (key) {
          out.fxRack.rasterMaterial[key] = number(rawFx.rasterMaterial, key, 0, 1, out.fxRack.rasterMaterial[key], false);
        });
        if (typeof raw.color2 === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color2)) out.color2 = raw.color2;
        if (typeof raw.color3 === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color3)) out.color3 = raw.color3;

        var field = raw.field;
        out.field.cols = number(field, 'cols', 2, 80, out.field.cols, true);
        out.field.rows = number(field, 'rows', 2, 80, out.field.rows, true);
        out.field.waveX = number(field, 'waveX', 0.1, 12, out.field.waveX, false);
        out.field.waveY = number(field, 'waveY', 0.1, 12, out.field.waveY, false);
        out.field.ampX = number(field, 'ampX', 0, 3, out.field.ampX, false);
        out.field.ampY = number(field, 'ampY', 0, 3, out.field.ampY, false);
        out.field.scaleX = number(field, 'scaleX', 0, 3, out.field.scaleX, false);
        out.field.scaleY = number(field, 'scaleY', 0, 3, out.field.scaleY, false);
        out.field.rotation = number(field, 'rotation', 0, 90, out.field.rotation, false);
        out.field.depth = number(field, 'depth', 0, 1, out.field.depth, false);
        out.field.topology = choice(field, 'topology', ['cartesian', 'polar', 'spiral'], out.field.topology);
        out.field.fieldType = choice(field, 'fieldType', ['wave', 'curl', 'vortex', 'attractor', 'textDistance'], out.field.fieldType);
        out.field.sources = number(field, 'sources', 1, 4, out.field.sources, true);
        out.field.pointerMode = choice(field, 'pointerMode', ['none', 'repel', 'attract', 'vortex', 'lens'], out.field.pointerMode);
        out.field.pointerForce = number(field, 'pointerForce', 0, 2, out.field.pointerForce, false);
        out.field.orientation = choice(field, 'orientation', ['fixed', 'tangent', 'normal', 'lookAtCenter'], out.field.orientation);
        out.field.domainWarp = number(field, 'domainWarp', 0, 2, out.field.domainWarp, false);
        out.field.perspective = number(field, 'perspective', 0, 1, out.field.perspective, false);
        out.field.depthFalloff = number(field, 'depthFalloff', 0, 1, out.field.depthFalloff, false);
        out.field.variation = number(field, 'variation', 0, 1, out.field.variation, false);
        out.field.variationMode = choice(field, 'variationMode', ['unicode', 'script', 'ink', 'none'], out.field.variationMode);
        out.field.network = number(field, 'network', 0, 1, out.field.network, false);
        out.field.echoOrbit = number(field, 'echoOrbit', 0, 8, out.field.echoOrbit, true);
        out.field.colorMode = choice(field, 'colorMode', ['ink', 'depth', 'unicode', 'field'], out.field.colorMode);

        var flux = raw.fluxRows;
        out.fluxRows.rows = number(flux, 'rows', 2, 60, out.fluxRows.rows, true);
        out.fluxRows.curve = number(flux, 'curve', 0.2, 4, out.fluxRows.curve, false);
        out.fluxRows.tracking = number(flux, 'tracking', 0, 2, out.fluxRows.tracking, false);
        out.fluxRows.lineGap = number(flux, 'lineGap', 0, 1, out.fluxRows.lineGap, false);
        out.fluxRows.scroll = number(flux, 'scroll', 0, 8, out.fluxRows.scroll, false);
        out.fluxRows.amount = number(flux, 'amount', 0, 1, out.fluxRows.amount, false);
        out.fluxRows.mirror = bool(flux, 'mirror', out.fluxRows.mirror);
        out.fluxRows.flip = bool(flux, 'flip', out.fluxRows.flip);
        out.fluxRows.baseline = choice(flux, 'baseline', ['straight', 'wave', 'braid', 'fold'], out.fluxRows.baseline);
        out.fluxRows.laneSpeed = choice(flux, 'laneSpeed', ['uniform', 'alternate', 'mirror', 'unicode'], out.fluxRows.laneSpeed);
        out.fluxRows.phaseOffset = number(flux, 'phaseOffset', 0, 1, out.fluxRows.phaseOffset, false);
        out.fluxRows.amplitude = number(flux, 'amplitude', 0, 2, out.fluxRows.amplitude, false);
        out.fluxRows.density = number(flux, 'density', 0.1, 2, out.fluxRows.density, false);
        out.fluxRows.integerTravel = bool(flux, 'integerTravel', out.fluxRows.integerTravel);
        ['counterflow', 'compression', 'slit', 'accordion', 'tangent', 'weave', 'trail', 'pointerBranch'].forEach(function (key) {
          out.fluxRows[key] = number(flux, key, 0, 1, out.fluxRows[key], false);
        });
        out.fluxRows.scanEcho = number(flux, 'scanEcho', 0, 8, out.fluxRows.scanEcho, true);
        out.fluxRows.perspective = number(flux, 'perspective', 0, 1, out.fluxRows.perspective, false);
        out.fluxRows.colorMode = choice(flux, 'colorMode', ['ink', 'phrase', 'glyph', 'lane'], out.fluxRows.colorMode);

        var cascade = raw.cascade;
        out.cascade.rows = number(cascade, 'rows', 2, 80, out.cascade.rows, true);
        out.cascade.tracking = number(cascade, 'tracking', 0, 1.5, out.cascade.tracking, false);
        out.cascade.lineSpace = number(cascade, 'lineSpace', 0, 0.9, out.cascade.lineSpace, false);
        out.cascade.waveLength = number(cascade, 'waveLength', 0, 1, out.cascade.waveLength, false);
        out.cascade.amplitude = number(cascade, 'amplitude', 0, 3, out.cascade.amplitude, false);
        out.cascade.slope = number(cascade, 'slope', 0.2, 4, out.cascade.slope, false);
        out.cascade.mirror = bool(cascade, 'mirror', out.cascade.mirror);
        out.cascade.bands = bool(cascade, 'bands', out.cascade.bands);
        out.cascade.system = ['bands', 'automaton', 'circuit', 'sdf'].indexOf(cascade && cascade.system) !== -1
          ? cascade.system : (cascade && cascade.system == null ? 'bands' : out.cascade.system);
        out.cascade.shape = ['rect', 'rounded', 'circle', 'diamond', 'cross', 'line', 'ring'].indexOf(cascade && cascade.shape) !== -1
          ? cascade.shape : out.cascade.shape;
        var cascadeColorMode = cascade && cascade.colorMode === 'stripe' ? 'row' : cascade && cascade.colorMode;
        out.cascade.colorMode = ['state', 'row', 'column', 'unicode', 'gradient', 'ink'].indexOf(cascadeColorMode) !== -1
          ? cascadeColorMode : out.cascade.colorMode;
        out.cascade.rule = cascade && cascade.rule === 'custom'
          ? 'custom'
          : ([30, 54, 90, 110, 150].indexOf(Number(cascade && cascade.rule)) !== -1
            ? Number(cascade.rule) : out.cascade.rule);
        out.cascade.customRule = number(cascade, 'customRule', 0, 255, out.cascade.customRule, true);
        out.cascade.seed = ['unicode', 'class', 'glyphMask', 'alternating', 'sparse'].indexOf(cascade && cascade.seed) !== -1
          ? cascade.seed : out.cascade.seed;
        out.cascade.cells = number(cascade, 'cells', 8, 96, out.cascade.cells, true);
        out.cascade.circuitDensity = number(cascade, 'circuitDensity', 0.1, 1, out.cascade.circuitDensity, false);
        out.cascade.pulse = number(cascade, 'pulse', 0, 1, out.cascade.pulse, false);
        out.cascade.signalMode = ['slices', 'moire', 'radar'].indexOf(cascade && cascade.signalMode) !== -1
          ? cascade.signalMode : out.cascade.signalMode;
        out.cascade.signalLayers = number(cascade, 'signalLayers', 1, 8, out.cascade.signalLayers, true);
        out.cascade.signalFeedback = number(cascade, 'signalFeedback', 0, 1, out.cascade.signalFeedback, false);
        out.cascade.quantize = number(cascade, 'quantize', 2, 32, out.cascade.quantize, true);
        out.cascade.sdfMode = ['interference', 'singularity', 'tunnel', 'metaball'].indexOf(cascade && cascade.sdfMode) !== -1
          ? cascade.sdfMode : out.cascade.sdfMode;
        out.cascade.frequency = number(cascade, 'frequency', 1, 24, out.cascade.frequency, true);
        out.cascade.warp = number(cascade, 'warp', 0, 2, out.cascade.warp, false);
        out.cascade.threshold = number(cascade, 'threshold', 0.05, 0.95, out.cascade.threshold, false);
        out.cascade.contours = number(cascade, 'contours', 1, 8, out.cascade.contours, true);
        out.cascade.sdfFeedback = number(cascade, 'sdfFeedback', 0, 1, out.cascade.sdfFeedback, false);
        out.cascade.automatonMode = choice(cascade, 'automatonMode', ['1d', 'life2d'], out.cascade.automatonMode);
        out.cascade.lifeRule = choice(cascade, 'lifeRule', ['B3/S23', 'B36/S23', 'B2/S', 'B3678/S34678'], out.cascade.lifeRule);
        out.cascade.generationCount = number(cascade, 'generationCount', 2, 96, out.cascade.generationCount, true);
        out.cascade.generationBlend = number(cascade, 'generationBlend', 0, 1, out.cascade.generationBlend, false);
        out.cascade.pingPong = bool(cascade, 'pingPong', out.cascade.pingPong);
        out.cascade.circuitBranches = number(cascade, 'circuitBranches', 1, 8, out.cascade.circuitBranches, true);
        out.cascade.circuitRouters = number(cascade, 'circuitRouters', 1, 24, out.cascade.circuitRouters, true);
        out.cascade.circuitPackets = number(cascade, 'circuitPackets', 1, 64, out.cascade.circuitPackets, true);
        out.cascade.packetTrail = number(cascade, 'packetTrail', 0, 1, out.cascade.packetTrail, false);
        out.cascade.circuitHeatmap = number(cascade, 'circuitHeatmap', 0, 1, out.cascade.circuitHeatmap, false);
        out.cascade.addressNodes = number(cascade, 'addressNodes', 0, 1, out.cascade.addressNodes, false);
        out.cascade.pointerInject = bool(cascade, 'pointerInject', out.cascade.pointerInject);
        out.cascade.signalSources = number(cascade, 'signalSources', 1, 6, out.cascade.signalSources, true);
        out.cascade.signalSync = number(cascade, 'signalSync', 0, 1, out.cascade.signalSync, false);
        out.cascade.glyphWarp = number(cascade, 'glyphWarp', 0, 1, out.cascade.glyphWarp, false);
        out.cascade.diffraction = number(cascade, 'diffraction', 0, 1, out.cascade.diffraction, false);
        out.cascade.chromatic = number(cascade, 'chromatic', 0, 1, out.cascade.chromatic, false);
        out.cascade.backgroundAmount = number(cascade, 'backgroundAmount', 0, 1, out.cascade.backgroundAmount, false);
        out.cascade.textAmount = number(cascade, 'textAmount', 0, 1, out.cascade.textAmount, false);
        out.cascade.gap = number(cascade, 'gap', 0, 0.8, out.cascade.gap, false);
        out.cascade.round = number(cascade, 'round', 0, 1, out.cascade.round, false);
        out.cascade.opacity = number(cascade, 'opacity', 0.04, 1, out.cascade.opacity, false);
        out.cascade.stroke = number(cascade, 'stroke', 0, 6, out.cascade.stroke, false);
        out.cascade.scanline = number(cascade, 'scanline', 0, 1, out.cascade.scanline, false);
        out.cascade.blend = ['source-over', 'multiply', 'screen', 'difference', 'exclusion', 'lighter'].indexOf(cascade && cascade.blend) !== -1
          ? cascade.blend : out.cascade.blend;
        out.cascade.glyphMode = ['contrast', 'fixed', 'state'].indexOf(cascade && cascade.glyphMode) !== -1
          ? cascade.glyphMode : out.cascade.glyphMode;
        out.cascade.backdropEnabled = bool(cascade, 'backdropEnabled', out.cascade.backdropEnabled);
        out.cascade.backdropOpacity = number(cascade, 'backdropOpacity', 0, 1, out.cascade.backdropOpacity, false);
        ['backdrop', 'fieldA', 'fieldB', 'fieldC', 'edge', 'glyph'].forEach(function (key) {
          if (cascade && typeof cascade[key] === 'string' && /^#[0-9a-f]{6}$/i.test(cascade[key])) out.cascade[key] = cascade[key];
        });

        var contour = raw.contourAtlas;
        out.contourAtlas.source = choice(contour, 'source', ['glyphDistance', 'unicodeCharge', 'interference', 'voronoi'], out.contourAtlas.source);
        var contourRendering = contour && contour.rendering === 'regions' ? 'filled' : contour && contour.rendering;
        out.contourAtlas.rendering = ['lines', 'glyphs', 'filled', 'hybrid'].indexOf(contourRendering) !== -1 ? contourRendering : out.contourAtlas.rendering;
        out.contourAtlas.levels = number(contour, 'levels', 2, 32, out.contourAtlas.levels, true);
        out.contourAtlas.resolution = number(contour, 'resolution', 16, 160, out.contourAtlas.resolution, true);
        out.contourAtlas.spacing = number(contour, 'spacing', 0.02, 0.5, out.contourAtlas.spacing, false);
        out.contourAtlas.lineWidth = number(contour, 'lineWidth', 0.25, 8, out.contourAtlas.lineWidth, false);
        out.contourAtlas.dash = number(contour, 'dash', 0, 1, out.contourAtlas.dash, false);
        out.contourAtlas.density = number(contour, 'density', 0.1, 2, out.contourAtlas.density, false);
        out.contourAtlas.charge = number(contour, 'charge', -1, 1, out.contourAtlas.charge, false);
        out.contourAtlas.interference = number(contour, 'interference', 0, 2, out.contourAtlas.interference, false);
        out.contourAtlas.pointerRelief = number(contour, 'pointerRelief', -1, 1, out.contourAtlas.pointerRelief, false);
        out.contourAtlas.glyphs = bool(contour, 'glyphs', out.contourAtlas.glyphs);
        out.contourAtlas.filled = bool(contour, 'filled', out.contourAtlas.filled);
        out.contourAtlas.tangent = number(contour, 'tangent', 0, 1, out.contourAtlas.tangent, false);
        out.contourAtlas.threshold = number(contour, 'threshold', 0, 1, out.contourAtlas.threshold, false);
        out.contourAtlas.fillOpacity = number(contour, 'fillOpacity', 0, 1, out.contourAtlas.fillOpacity, false);
        out.contourAtlas.textHeight = number(contour, 'textHeight', 0, 1, out.contourAtlas.textHeight, false);
        out.contourAtlas.colorMode = choice(contour, 'colorMode', ['ink', 'height', 'script', 'spectral'], out.contourAtlas.colorMode);
        out.contourAtlas.preset = choice(contour, 'preset', ['topographic', 'seismic', 'isoScript'], out.contourAtlas.preset);

        var feedback = raw.feedbackChamber;
        out.feedbackChamber.transform = choice(feedback, 'transform', ['zoom', 'rotate', 'drift', 'shear'], out.feedbackChamber.transform);
        out.feedbackChamber.warp = choice(feedback, 'warp', ['none', 'wave', 'twist', 'tunnel', 'glyphSdf'], out.feedbackChamber.warp);
        out.feedbackChamber.mirror = choice(feedback, 'mirror', ['none', 'bilateral', 'quad', 'kaleidoscope'], out.feedbackChamber.mirror);
        out.feedbackChamber.zoom = number(feedback, 'zoom', -0.2, 0.2, out.feedbackChamber.zoom, false);
        out.feedbackChamber.rotation = number(feedback, 'rotation', -45, 45, out.feedbackChamber.rotation, false);
        out.feedbackChamber.driftX = number(feedback, 'driftX', -1, 1, out.feedbackChamber.driftX, false);
        out.feedbackChamber.driftY = number(feedback, 'driftY', -1, 1, out.feedbackChamber.driftY, false);
        out.feedbackChamber.shear = number(feedback, 'shear', -1, 1, out.feedbackChamber.shear, false);
        out.feedbackChamber.warpAmount = number(feedback, 'warpAmount', 0, 2, out.feedbackChamber.warpAmount, false);
        out.feedbackChamber.decay = number(feedback, 'decay', 0, 1, out.feedbackChamber.decay, false);
        out.feedbackChamber.injection = number(feedback, 'injection', 0, 1, out.feedbackChamber.injection, false);
        out.feedbackChamber.threshold = number(feedback, 'threshold', 0, 1, out.feedbackChamber.threshold, false);
        out.feedbackChamber.persistence = number(feedback, 'persistence', 0, 1, out.feedbackChamber.persistence, false);
        out.feedbackChamber.echoes = number(feedback, 'echoes', 1, 24, out.feedbackChamber.echoes, true);
        out.feedbackChamber.kaleidoscope = number(feedback, 'kaleidoscope', 2, 16, out.feedbackChamber.kaleidoscope, true);
        out.feedbackChamber.pointerCenter = bool(feedback, 'pointerCenter', out.feedbackChamber.pointerCenter);
        out.feedbackChamber.loopLock = bool(feedback, 'loopLock', out.feedbackChamber.loopLock);
        out.feedbackChamber.preset = choice(feedback, 'preset', ['recursiveType', 'spectralBurn', 'mirrorHall'], out.feedbackChamber.preset);
        return out;
      }


      function compositionAxisIsVertical() {
        return compositionState.axis === 'vertical' || (compositionState.axis === 'inherit' && params.vertical);
      }

      function compositionSourceTokens(sourceGlyphs) {
        var tokens = [];
        var glyphIndex = 0;
        var lines = textInput.value.replace(/\r\n?/g, '\n').split('\n');
        for (var li = 0; li < lines.length; li++) {
          var line = tokenizeLine(lines[li]);
          for (var ti = 0; ti < line.length; ti++) {
            if (line[ti].space) {
              if (!tokens.length || !tokens[tokens.length - 1].space) tokens.push({ space: true, units: 0.55 });
            } else if (glyphIndex < sourceGlyphs.length) {
              tokens.push({ space: false, units: 1, sourceIndex: glyphIndex, glyph: sourceGlyphs[glyphIndex] });
              glyphIndex++;
            }
          }
          if (li < lines.length - 1 && tokens.length && !tokens[tokens.length - 1].space) tokens.push({ space: true, units: 0.8 });
        }
        if (!tokens.length) {
          for (var gi = 0; gi < sourceGlyphs.length; gi++) tokens.push({ space: false, units: 1, sourceIndex: gi, glyph: sourceGlyphs[gi] });
        }
        while (tokens.length && tokens[0].space) tokens.shift();
        while (tokens.length && tokens[tokens.length - 1].space) tokens.pop();
        return tokens;
      }

      /* ---------------- composition v6 clock + modulation bus ---------------- */
      function createLoopClock(phase, frameCount, seed, direction) {
        var turn = ((Number(phase) || 0) % 1 + 1) % 1;
        var count = Math.max(1, Math.round(frameCount || 240));
        return {
          turn: turn,
          angle: Math.PI * 2 * turn,
          frame: Math.round(turn * count) % count,
          frameCount: count,
          seed: Math.max(0, Math.round(Number(seed) || 0)),
          direction: direction === -1 ? -1 : 1
        };
      }

      // Periodic noise: using a point on a circle guarantees n(0) === n(1).
      function compositionLoopNoise(clock, x, y, salt) {
        var a = clock.angle;
        return hash(
          Math.round((Math.cos(a) + 1) * 4096 + x * 131),
          Math.round((Math.sin(a) + 1) * 4096 + y * 137),
          (clock.seed + (salt || 0)) | 0
        ) * 2 - 1;
      }

      function compositionScriptDistribution(tokens) {
        var result = { hiragana: 0, katakana: 0, kanji: 0, latin: 0, digit: 0, punct: 0, other: 0 };
        var total = 0;
        for (var i = 0; i < tokens.length; i++) {
          var ch = tokens[i] && tokens[i].glyph ? tokens[i].glyph.ch : '';
          if (!ch) continue;
          var cp = ch.codePointAt(0);
          var key = batchKeyFor(ch, cp, charInfo(ch, cp));
          if (!Object.prototype.hasOwnProperty.call(result, key)) key = 'other';
          result[key]++;
          total++;
        }
        Object.keys(result).forEach(function (key) { result[key] = result[key] / Math.max(1, total); });
        return result;
      }

      var compositionBusPointer = { x: 0.5, y: 0.5, previousX: 0.5, previousY: 0.5, time: 0 };
      function createCompositionInputBus(tokens, width, height, clock) {
        // VJ: 仮想ポインタ(ステージ座標)を正規化して渡す
        var st = TD._stage;
        var sw = (st && st.offsetWidth) || params.stageW || 1;
        var sh = (st && st.offsetHeight) || sw;
        var px = Math.max(0, Math.min(1, (TD._pointer ? TD._pointer.x : 0) / Math.max(1, sw)));
        var py = Math.max(0, Math.min(1, (TD._pointer ? TD._pointer.y : 0) / Math.max(1, sh)));
        var now = performance.now();
        var dt = Math.max(1, now - compositionBusPointer.time);
        var speed = Math.sqrt(
          Math.pow(px - compositionBusPointer.previousX, 2) +
          Math.pow(py - compositionBusPointer.previousY, 2)
        ) * 1000 / dt;
        compositionBusPointer.previousX = px;
        compositionBusPointer.previousY = py;
        compositionBusPointer.time = now;
        compositionBusPointer.x = px;
        compositionBusPointer.y = py;
        var visible = tokens.filter(function (token) { return token && !token.space && token.glyph; });
        var frequencies = {}, entropy = 0;
        for (var i = 0; i < visible.length; i++) {
          var ch = visible[i].glyph.ch || '';
          frequencies[ch] = (frequencies[ch] || 0) + 1;
        }
        Object.keys(frequencies).forEach(function (ch) {
          var p = frequencies[ch] / Math.max(1, visible.length);
          entropy -= p * Math.log(p) / Math.log(2);
        });
        return {
          time: clock,
          pointer: {
            x: compositionBusPointer.x, y: compositionBusPointer.y,
            px: compositionBusPointer.x * width, py: compositionBusPointer.y * height,
            speed: isFinite(speed) ? Math.min(10, speed) : 0,
            pressure: TD._compPulse != null ? TD._compPulse : 0.5,
            active: !!(TD._t != null && TD._t < (TD._bloomUntil || 0))   // VJ: bloomスイープ中だけポインタ有効
          },
          text: {
            length: visible.length,
            lineCount: textInput.value.replace(/\r\n?/g, '\n').split('\n').length,
            scriptDistribution: compositionScriptDistribution(tokens),
            entropy: entropy,
            tokenIndex: 0, codePoint: 0, unicodeHash: 0,
            glyphWidth: params.fontSize, inkCoverage: 0.5
          },
          audio: null,
          midi: null
        };
      }

      function compileCompositionSource(sourceGlyphs, width, height, state) {
        var tokens = compositionSourceTokens(sourceGlyphs);
        var clock = createLoopClock(state.phase, 240, state.seed, state.direction);
        return {
          sourceGlyphs: sourceGlyphs,
          tokens: tokens,
          viewport: { width: width, height: height },
          clock: clock,
          inputs: createCompositionInputBus(tokens, width, height, clock),
          state: state
        };
      }

      function compositionMacro(name, fallback) {
        var value = compositionState.macros && Number(compositionState.macros[name]);
        return isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
      }

      function compositionPalette() {
        return [params.ink, params.paper, params.accent, compositionState.color2, compositionState.color3];
      }

      function lerpHex(a, b, t) {
        function channel(hex, at) { return parseInt(hex.slice(at, at + 2), 16); }
        t = Math.max(0, Math.min(1, t));
        var r = Math.round(channel(a, 1) + (channel(b, 1) - channel(a, 1)) * t);
        var g = Math.round(channel(a, 3) + (channel(b, 3) - channel(a, 3)) * t);
        var bl = Math.round(channel(a, 5) + (channel(b, 5) - channel(a, 5)) * t);
        return '#' + [r, g, bl].map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
      }

      function orientedCompositionPoint(x, y, width, height) {
        if (!compositionAxisIsVertical()) return { x: x, y: y, rotation: 0 };
        return { x: width - (y / Math.max(1, height)) * width, y: (x / Math.max(1, width)) * height, rotation: 90 };
      }

      function compositionGlyph(token, cx, cy, scaleX, scaleY, rotation, fill, opacity, instanceIndex) {
        if (!token || token.space || !token.glyph) return null;
        var source = token.glyph;
        var w = Math.max(1, source.w || params.fontSize);
        var h = Math.max(1, source.h || params.fontSize * params.lineHeight);
        var point = orientedCompositionPoint(cx, cy, compositionScene.width, compositionScene.height);
        var x = point.x - w / 2;
        var y = point.y - h / 2;
        return {
          ch: source.ch,
          sourceIndex: token.sourceIndex,
          instanceIndex: instanceIndex,
          composition: true,
          upright: source.upright,
          accent: source.accent,
          opacity: Math.max(0, Math.min(1, opacity == null ? 1 : opacity)),
          fill: fill || (source.accent ? params.accent : params.ink),
          x: x, y: y, w: w, h: h, bx: x, by: y, bw: w, bh: h, grid: false,
          ox: x + w / 2, oy: y + h * 0.75,
          tx: source.tx || 0, ty: source.ty || 0,
          rot: (source.rot || 0) + rotation + point.rotation,
          skewX: source.skewX || 0, skewY: source.skewY || 0,
          scaleX: (source.scaleX || 1) * Math.max(0.02, scaleX),
          scaleY: (source.scaleY || 1) * Math.max(0.02, scaleY),
          misregX: source.misregX || 0, misregY: source.misregY || 0
        };
      }

      function compositionEffectiveQuality() {
        if (compositionQualityOverride) return compositionQualityOverride;
        if (compositionState.quality !== 'auto') return compositionState.quality;
        return compositionAutoTier;
      }

      function updateCompositionAutoQuality(elapsed) {
        if (!isFinite(elapsed) || elapsed <= 0 || elapsed > 500) return;
        compositionFrameAverage = compositionFrameAverage > 0
          ? compositionFrameAverage * 0.9 + elapsed * 0.1
          : elapsed;
        if (compositionState.quality !== 'auto') return;
        var mobile = window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
        var previous = compositionAutoTier;
        var slowThreshold = mobile ? 36 : 22;
        var recoverThreshold = mobile ? 30 : 19;
        var fastThreshold = mobile ? 25 : 16.5;
        if (compositionFrameAverage > slowThreshold) {
          compositionAutoTier = 'performance';
          compositionAutoFastFrames = 0;
        } else if (compositionFrameAverage < fastThreshold) {
          compositionAutoFastFrames++;
          if (compositionAutoFastFrames >= 45) compositionAutoTier = 'high';
        } else {
          compositionAutoFastFrames = 0;
          if (compositionAutoTier === 'performance' && compositionFrameAverage < recoverThreshold) {
            compositionAutoTier = 'normal';
          } else if (compositionAutoTier === 'high') {
            compositionAutoTier = 'normal';
          }
        }
        if (previous !== compositionAutoTier) scheduleCompositionDraw();
      }

      function compositionLogicalDimensions(fallbackWidth, fallbackHeight) {
        var viewport = compositionState.logicalViewport || COMPOSITION_DEFAULTS.logicalViewport;
        if (viewport.legacyResponsive) {
          return {
            width: Math.max(1, Math.round(fallbackWidth || 1080)),
            height: Math.max(1, Math.round(fallbackHeight || 1080))
          };
        }
        return {
          width: Math.max(64, Math.round(viewport.width || 1080)),
          height: Math.max(64, Math.round(viewport.height || 1080))
        };
      }

      function fitCompositionViewport(sourceWidth, sourceHeight, targetWidth, targetHeight) {
        var scale = Math.min(targetWidth / Math.max(1, sourceWidth), targetHeight / Math.max(1, sourceHeight));
        return {
          w: targetWidth,
          h: targetHeight,
          s: scale,
          dx: (targetWidth - sourceWidth * scale) * 0.5,
          dy: (targetHeight - sourceHeight * scale) * 0.5
        };
      }

      function previewPointToComposition(px, py) {
        var layout = compositionPreviewLayout;
        return {
          x: (px - layout.dx) / Math.max(0.0001, layout.s),
          y: (py - layout.dy) / Math.max(0.0001, layout.s)
        };
      }

      function compositionLimit() {
        var mobile = window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
        var base = mobile ? 2000 : 5000;
        var quality = compositionEffectiveQuality();
        if (quality === 'performance') return Math.round(base * 0.55);
        if (quality === 'high') return Math.round(base * 1.6);
        return base;
      }

      function generateFieldScene(tokens, width, height, runtime) {
        var field = compositionState.field;
        var cols = field.cols, rows = field.rows;
        var pad = Math.min(28, Math.max(8, Math.min(width, height) * 0.025));
        var cellW = Math.max(1, (width - pad * 2) / cols);
        var cellH = Math.max(1, (height - pad * 2) / rows);
        var baseScale = Math.max(0.04, Math.min(cellW / Math.max(1, params.fontSize * 0.75), cellH / Math.max(1, params.fontSize * params.lineHeight)) * 0.92);
        var clock = runtime && runtime.clock ? runtime.clock : createLoopClock(compositionState.phase, 240, compositionState.seed, compositionState.direction);
        var inputs = runtime && runtime.inputs ? runtime.inputs : createCompositionInputBus(tokens, width, height, clock);
        var phase = clock.angle;
        var limit = compositionLimit();
        var glyphs = [], bands = [], instanceIndex = 0;
        var intensity = compositionMacro('intensity', 0.65);
        var instability = compositionMacro('instability', 0.35);
        var depthMacro = compositionMacro('depth', 0.45);
        var networkPoints = [];
        for (var row = 0; row < rows; row++) {
          networkPoints[row] = [];
          for (var col = 0; col < cols; col++) {
            if (instanceIndex >= limit) return { glyphs: glyphs, bands: bands, limited: true };
            var token = tokens[(row * cols + col) % tokens.length];
            var nx = (col + 0.5) / cols, ny = (row + 0.5) / rows;
            var cx = pad + nx * (width - pad * 2);
            var cy = pad + ny * (height - pad * 2);
            if (field.topology === 'polar' || field.topology === 'spiral') {
              var theta = nx * Math.PI * 2 + phase * field.echoOrbit * 0.2;
              var radius = Math.min(width, height) * (0.06 + ny * 0.46);
              if (field.topology === 'spiral') radius *= 0.38 + nx * 0.82;
              cx = width * 0.5 + Math.cos(theta) * radius;
              cy = height * 0.5 + Math.sin(theta) * radius;
            }
            var cp = cascadeTokenCode(token);
            var variationSignal = 0;
            if (field.variationMode === 'unicode') variationSignal = hash(cp || col, row, compositionState.seed) * 2 - 1;
            else if (field.variationMode === 'script') {
              var variationChar = token && token.glyph ? token.glyph.ch : '';
              variationSignal = hash(String(batchKeyFor(variationChar, cp, charInfo(variationChar, cp))).length, row, col) * 2 - 1;
            } else if (field.variationMode === 'ink') {
              variationSignal = token && token.glyph ? Math.max(-1, Math.min(1, ((token.glyph.w || params.fontSize) / Math.max(1, params.fontSize) - 0.7) * 2)) : 0;
            }
            var tokenVariation = variationSignal * field.variation;
            var warpedX = nx + Math.sin(ny * Math.PI * 2 + phase) * field.domainWarp * 0.08;
            var warpedY = ny + Math.cos(nx * Math.PI * 2 - phase) * field.domainWarp * 0.08;
            var waveA = Math.sin(phase + col / field.waveX + row / field.waveY + tokenVariation);
            var waveB = Math.cos(phase + col / field.waveX - row / field.waveY - tokenVariation);
            if (field.fieldType === 'curl' || field.fieldType === 'vortex') {
              var dxCenter = warpedX - 0.5, dyCenter = warpedY - 0.5;
              var angle = Math.atan2(dyCenter, dxCenter) + phase;
              waveA = Math.cos(angle + (field.fieldType === 'curl' ? Math.hypot(dxCenter, dyCenter) * 16 : 0));
              waveB = Math.sin(angle + (field.fieldType === 'curl' ? Math.hypot(dxCenter, dyCenter) * 16 : 0));
            } else if (field.fieldType === 'attractor') {
              waveA = (0.5 - warpedX) * 2;
              waveB = (0.5 - warpedY) * 2;
            } else if (field.fieldType === 'textDistance') {
              var textSignal = ((cp % 97) / 96) * Math.PI * 2;
              waveA = Math.sin(textSignal + phase);
              waveB = Math.cos(textSignal - phase);
            }
            for (var sourceIndex = 1; sourceIndex < field.sources; sourceIndex++) {
              var sourceAngle = phase + sourceIndex / field.sources * Math.PI * 2;
              waveA += Math.sin((warpedX - 0.5 - Math.cos(sourceAngle) * 0.25) * (6 + sourceIndex) + phase) / field.sources;
              waveB += Math.cos((warpedY - 0.5 - Math.sin(sourceAngle) * 0.25) * (6 + sourceIndex) - phase) / field.sources;
            }
            if (inputs.pointer.active && field.pointerMode !== 'none') {
              var pdx = cx - inputs.pointer.px, pdy = cy - inputs.pointer.py;
              var pd = Math.max(12, Math.sqrt(pdx * pdx + pdy * pdy));
              var pointerGain = Math.max(0, 1 - pd / (Math.min(width, height) * 0.45)) * inputs.pointer.pressure;
              if (field.pointerMode === 'vortex') {
                waveA += -pdy / pd * pointerGain * 2 * field.pointerForce;
                waveB += pdx / pd * pointerGain * 2 * field.pointerForce;
              } else {
                var sign = field.pointerMode === 'attract' ? -1 : 1;
                waveA += pdx / pd * pointerGain * sign * 2 * field.pointerForce;
                waveB += pdy / pd * pointerGain * sign * 2 * field.pointerForce;
              }
            }
            waveA += compositionLoopNoise(clock, col, row, 31) * instability * 0.3;
            waveB += compositionLoopNoise(clock, row, col, 47) * instability * 0.3;
            var depth = Math.max(0.05, 1 + waveA * field.depth * (0.4 + depthMacro));
            var sx = baseScale * depth * Math.max(0.05, 1 + waveB * field.scaleX);
            var sy = baseScale * depth * Math.max(0.05, 1 + waveA * field.scaleY);
            cx += waveA * field.ampX * cellW * intensity;
            cy += waveB * field.ampY * cellH * intensity;
            var perspective = 1 - field.perspective * Math.max(0, ny - 0.5) * (0.25 + field.depthFalloff * 0.75);
            sx *= perspective; sy *= perspective;
            var rotation = waveA * field.rotation;
            if (field.orientation === 'tangent') rotation += Math.atan2(waveB, waveA) * 180 / Math.PI;
            else if (field.orientation === 'normal') rotation += Math.atan2(waveB, waveA) * 180 / Math.PI + 90;
            else if (field.orientation === 'lookAtCenter') rotation += Math.atan2(height * 0.5 - cy, width * 0.5 - cx) * 180 / Math.PI;
            var fill = null;
            if (field.colorMode === 'depth') fill = lerpHex(compositionState.color2, compositionState.color3, Math.max(0, Math.min(1, (depth - 0.5) / 1.2)));
            else if (field.colorMode === 'unicode') fill = compositionPalette()[Math.abs(cp) % compositionPalette().length];
            else if (field.colorMode === 'field') fill = lerpHex(params.ink, params.accent, (waveA + 1) * 0.5);
            var glyph = compositionGlyph(token, cx, cy, sx, sy, rotation, fill, 0.72 + depth * 0.24, instanceIndex++);
            if (glyph) glyphs.push(glyph);
            if (glyph && field.echoOrbit > 0) {
              for (var orbit = 1; orbit <= field.echoOrbit && instanceIndex < limit; orbit++) {
                var orbitAngle = phase + orbit / field.echoOrbit * Math.PI * 2;
                var orbitRadius = Math.min(cellW, cellH) * orbit * 0.22;
                var orbitGlyph = compositionGlyph(
                  token,
                  cx + Math.cos(orbitAngle) * orbitRadius,
                  cy + Math.sin(orbitAngle) * orbitRadius,
                  sx * (1 - orbit / (field.echoOrbit + 1) * 0.25),
                  sy * (1 - orbit / (field.echoOrbit + 1) * 0.25),
                  rotation + orbit * 6,
                  fill,
                  (0.45 / orbit) * compositionMacro('depth', 0.45),
                  instanceIndex++
                );
                if (orbitGlyph) glyphs.push(orbitGlyph);
              }
            }
            networkPoints[row][col] = { x: cx, y: cy };
            if (field.network > 0 && col > 0 && ((row + col) % Math.max(1, Math.round(4 - field.network * 3)) === 0)) {
              bands.push({
                kind: 'path', points: [networkPoints[row][col - 1], networkPoints[row][col]],
                stroke: fill || params.ink, strokeWidth: 0.5 + field.network * 1.5,
                opacity: field.network * (0.12 + (1 - compositionMacro('legibility', 0.85)) * 0.5)
              });
            }
          }
        }
        return { glyphs: glyphs, bands: bands, limited: false };
      }

      function generateFluxScene(tokens, width, height, runtime) {
        var flux = compositionState.fluxRows;
        var palette = compositionPalette();
        var units = tokens.reduce(function (sum, token) { return sum + token.units; }, 0) || 1;
        var rowH = height / flux.rows;
        var limit = compositionLimit();
        var glyphs = [], bands = [], instanceIndex = 0;
        var clock = runtime && runtime.clock ? runtime.clock : createLoopClock(compositionState.phase, 240, compositionState.seed, compositionState.direction);
        var inputs = runtime && runtime.inputs ? runtime.inputs : createCompositionInputBus(tokens, width, height, clock);
        var densityMacro = compositionMacro('density', 0.6);
        var instability = compositionMacro('instability', 0.35);
        var midpoint = (flux.rows - 1) / 2;
        for (var row = 0; row < flux.rows; row++) {
          var edge = flux.mirror && midpoint > 0 ? Math.abs(row - midpoint) / midpoint : 1 - row / Math.max(1, flux.rows - 1);
          var density = Math.pow(Math.max(0, 1 - edge), flux.curve);
          var repeats = 1 + Math.round(density * Math.max(1, Math.floor(flux.rows / 2)) * (0.45 + densityMacro * 0.55 + flux.density * 0.5));
          var unitW = width / Math.max(1, units * repeats);
          var phraseW = units * unitW + Math.max(0, tokens.length - 1) * unitW * flux.tracking;
          var rowDirection = flux.flip && row % 2 ? -1 : 1;
          if (flux.mirror && row > midpoint) rowDirection *= -1;
          if (flux.laneSpeed === 'alternate' && row % 2) rowDirection *= -1;
          if (flux.laneSpeed === 'mirror' && row > midpoint) rowDirection *= -1;
          if (flux.counterflow > 0 && row % 2) rowDirection *= -1;
          var requestedCycles = Math.max(0, flux.scroll + (flux.laneSpeed === 'unicode' ? cascadeTokenCode(tokens[row % tokens.length]) % 3 : 0));
          var laneCycles = (flux.integerTravel || compositionState.loopLock) ? Math.max(0, Math.round(requestedCycles)) : requestedCycles;
          var offset = ((clock.turn * phraseW * laneCycles * rowDirection) % phraseW + phraseW) % phraseW;
          var rowPhase = clock.angle + row * flux.phaseOffset * Math.PI * 2;
          var fluxWave = 1 - flux.amount * 0.5 + Math.sin(rowPhase) * flux.amount * 0.5;
          fluxWave *= 1 + Math.sin(rowPhase * 2) * flux.accordion * 0.35;
          var perspectiveScale = 1 - flux.perspective * Math.abs(row - midpoint) / Math.max(1, midpoint) * 0.55;
          var scaleX = unitW / Math.max(1, params.fontSize * 0.72) * perspectiveScale;
          var scaleY = Math.max(0.04, rowH * (1 - flux.lineGap) / Math.max(1, params.fontSize * params.lineHeight) * fluxWave);
          var baseY = (row + 0.5) * rowH;
          var cursor = -offset - phraseW;
          for (var copy = 0; copy < repeats + 3; copy++) {
            for (var ti = 0; ti < tokens.length; ti++) {
              var token = tokens[ti];
              var tokenW = token.units * unitW;
              var progress = (cursor + tokenW * 0.5) / Math.max(1, width);
              var baselineSignal = 0;
              if (flux.baseline === 'wave') baselineSignal = Math.sin(progress * Math.PI * 2 + rowPhase);
              else if (flux.baseline === 'braid') baselineSignal = Math.sin(progress * Math.PI * 4 + rowPhase + (row % 2) * Math.PI);
              else if (flux.baseline === 'fold') baselineSignal = Math.asin(Math.sin(progress * Math.PI * 2 + rowPhase)) * 2 / Math.PI;
              baselineSignal += compositionLoopNoise(clock, row, ti, copy) * instability * 0.14;
              var y = baseY + baselineSignal * rowH * flux.amplitude;
              if (flux.weave > 0) y += Math.sin(progress * Math.PI * 2 + row * Math.PI) * rowH * flux.weave * 0.35;
              if (inputs.pointer.active && flux.pointerBranch > 0) {
                var pointerDistance = Math.abs(cursor + tokenW * 0.5 - inputs.pointer.px);
                y += (y < inputs.pointer.py ? -1 : 1) * Math.max(0, 1 - pointerDistance / Math.max(1, width * 0.25)) * rowH * flux.pointerBranch;
              }
              if (!token.space && cursor + tokenW >= -unitW && cursor <= width + unitW) {
                if (instanceIndex >= limit) return { glyphs: glyphs, bands: bands, limited: true };
                var color = token.glyph && token.glyph.accent ? params.accent : params.ink;
                if (flux.colorMode === 'lane') color = palette[row % palette.length];
                else if (flux.colorMode === 'phrase') color = palette[copy % palette.length];
                else if (flux.colorMode === 'glyph') color = palette[Math.abs(cascadeTokenCode(token)) % palette.length];
                var localScaleX = scaleX * (1 - flux.compression * Math.max(0, Math.sin(progress * Math.PI * 2 + rowPhase)) * 0.7);
                var slitOpacity = flux.slit > 0 && Math.abs(progress - 0.5) < flux.slit * 0.14 ? 0.08 : 1;
                var tangentRotation = flux.tangent * Math.atan2(baselineSignal * flux.amplitude, 1) * 180 / Math.PI;
                var glyph = compositionGlyph(token, cursor + tokenW / 2, y, localScaleX, scaleY, tangentRotation, color, slitOpacity, instanceIndex++);
                if (glyph) glyphs.push(glyph);
                if (flux.trail > 0) {
                  var trailLength = unitW * (0.5 + flux.trail * 3);
                  bands.push({
                    kind: 'path',
                    points: [{ x: cursor + tokenW / 2 - trailLength * rowDirection, y: y }, { x: cursor + tokenW / 2, y: y }],
                    stroke: color, strokeWidth: Math.max(0.5, rowH * 0.025),
                    opacity: flux.trail * 0.3
                  });
                }
              }
              cursor += tokenW + unitW * flux.tracking;
            }
          }
          if (flux.scanEcho > 0) {
            for (var scan = 0; scan < flux.scanEcho; scan++) {
              var scanX = ((clock.turn * (row % 3 + 1) + row / flux.rows + scan / flux.scanEcho) % 1) * width;
              bands.push({
                kind: 'path', points: [{ x: scanX, y: row * rowH }, { x: scanX, y: (row + 1) * rowH }],
                stroke: palette[(row + scan + 2) % palette.length], strokeWidth: 0.5 + scan / Math.max(1, flux.scanEcho) * 2,
                opacity: 0.12 + scan / Math.max(1, flux.scanEcho) * 0.18, blend: 'difference'
              });
            }
          }
        }
        return { glyphs: glyphs, bands: bands, limited: false };
      }

      function cascadePalette() {
        var c = compositionState.cascade;
        return [c.fieldA, c.fieldB, c.fieldC, c.edge];
      }

      function cascadeSystemLabel() {
        var c = compositionState.cascade;
        if (c.system === 'bands') {
          return 'Signal Field / ' + ({ slices: 'Raster Slices', moire: 'Moiré Rails', radar: 'Radial Scan' }[c.signalMode] || 'Raster Slices');
        }
        if (c.system === 'sdf') {
          return 'Optical Shader / ' + ({
            interference: 'Interference',
            singularity: 'Singularity',
            tunnel: 'Depth Tunnel',
            metaball: 'Metaball Field'
          }[c.sdfMode] || 'Interference');
        }
        return c.system === 'circuit' ? 'Data Circuit' : 'Cellular Automaton';
      }

      function cascadeTokenCode(token) {
        var ch = token && token.glyph && token.glyph.ch ? token.glyph.ch : '';
        return ch ? ch.codePointAt(0) : 0;
      }

      function cascadeColorFor(row, col, state, token, totalRows, totalCols) {
        var c = compositionState.cascade;
        var palette = cascadePalette();
        if (c.colorMode === 'ink') return c.fieldA;
        if (c.colorMode === 'row') return palette[row % 3];
        if (c.colorMode === 'column') return palette[col % 3];
        if (c.colorMode === 'unicode') return palette[cascadeTokenCode(token) % 3];
        if (c.colorMode === 'gradient') {
          var t = (row / Math.max(1, totalRows - 1) + col / Math.max(1, totalCols - 1)) * 0.5;
          return t < 0.5 ? lerpHex(c.fieldA, c.fieldB, t * 2) : lerpHex(c.fieldB, c.fieldC, (t - 0.5) * 2);
        }
        return state ? palette[1 + ((row + col + state) % 3)] : palette[0];
      }

      function cascadeGlyphColor(fill, state) {
        var c = compositionState.cascade;
        if (c.glyphMode === 'fixed') return c.glyph;
        if (c.glyphMode === 'state') return state ? c.glyph : c.edge;
        var r = parseInt(fill.slice(1, 3), 16);
        var g = parseInt(fill.slice(3, 5), 16);
        var b = parseInt(fill.slice(5, 7), 16);
        var luminance = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
        return luminance > 0.57 ? c.fieldA : c.glyph;
      }

      function cascadeShapeItem(x, y, w, h, fill, opacity, rotation, state) {
        var c = compositionState.cascade;
        return {
          kind: 'shape', shape: c.shape, x: x, y: y, w: Math.max(0.1, w), h: Math.max(0.1, h),
          fill: fill, opacity: opacity == null ? c.opacity : opacity,
          stroke: c.stroke > 0 ? c.edge : null, strokeWidth: c.stroke,
          radius: c.round, rotation: rotation || 0, blend: c.blend,
          state: state || 0
        };
      }

      function cascadeBackdrop(width, height, bands) {
        var c = compositionState.cascade;
        if (c.backdropEnabled && c.backdropOpacity > 0) {
          bands.push({
            kind: 'shape', shape: 'rect', x: 0, y: 0, w: width, h: height,
            fill: c.backdrop, opacity: c.backdropOpacity, blend: 'source-over', backdrop: true
          });
        }
      }

      function cascadePostProcess(width, height, bands) {
        var c = compositionState.cascade;
        if (c.scanline <= 0) return;
        var spacing = Math.max(3, Math.round(11 - c.scanline * 7));
        var lineH = Math.max(0.5, c.scanline * 1.6);
        for (var y = 0; y < height; y += spacing) {
          bands.push({
            kind: 'shape', shape: 'rect', x: 0, y: y, w: width, h: lineH,
            fill: c.edge, opacity: 0.025 + c.scanline * 0.13,
            blend: c.blend, post: true
          });
        }
      }

      function cascadeSeed(tokens, cells) {
        var c = compositionState.cascade;
        var visible = tokens.filter(function (token) { return !token.space && token.glyph; });
        if (!visible.length) visible = tokens;
        var seed = [];
        for (var col = 0; col < cells; col++) {
          var token = visible[col % visible.length];
          var cp = cascadeTokenCode(token);
          if (c.seed === 'alternating') seed[col] = col % 2;
          else if (c.seed === 'sparse') seed[col] = hash(col, cp || col, 19) > 0.82 ? 1 : 0;
          else if (c.seed === 'glyphMask') {
            var glyphWidth = token && token.glyph ? token.glyph.w || params.fontSize : params.fontSize;
            seed[col] = hash(Math.round(glyphWidth), cp || col, col + compositionState.seed) > 0.48 ? 1 : 0;
          }
          else if (c.seed === 'class') {
            var ch = token && token.glyph ? token.glyph.ch : '';
            var info = charInfo(ch, cp);
            var key = batchKeyFor(ch, cp, info);
            seed[col] = key === 'kanji' || key === 'digit' || key === 'punct' ? 1 : 0;
          } else seed[col] = (cp >> (col % 16)) & 1;
        }
        if (seed.indexOf(1) === -1) seed[Math.floor(cells / 2)] = 1;
        return seed;
      }

      function cascadeAutomatonStep(cells, rule) {
        var next = new Array(cells.length);
        for (var i = 0; i < cells.length; i++) {
          var left = cells[(i - 1 + cells.length) % cells.length] ? 1 : 0;
          var center = cells[i] ? 1 : 0;
          var right = cells[(i + 1) % cells.length] ? 1 : 0;
          var pattern = (left << 2) | (center << 1) | right;
          next[i] = (rule >> pattern) & 1;
        }
        return next;
      }

      function cascadeLifeStep(board, rows, cols, ruleName) {
        var parts = String(ruleName || 'B3/S23').split('/');
        var births = (parts[0] || 'B3').replace('B', '');
        var survives = (parts[1] || 'S23').replace('S', '');
        var next = new Array(board.length);
        for (var row = 0; row < rows; row++) {
          for (var col = 0; col < cols; col++) {
            var neighbors = 0;
            for (var oy = -1; oy <= 1; oy++) {
              for (var ox = -1; ox <= 1; ox++) {
                if (!ox && !oy) continue;
                var ni = ((row + oy + rows) % rows) * cols + ((col + ox + cols) % cols);
                neighbors += board[ni] ? 1 : 0;
              }
            }
            var alive = board[row * cols + col] ? 1 : 0;
            next[row * cols + col] = alive
              ? (survives.indexOf(String(neighbors)) !== -1 ? 1 : 0)
              : (births.indexOf(String(neighbors)) !== -1 ? 1 : 0);
          }
        }
        return next;
      }

      function cascadeGridColumns(requested, rows, layers) {
        var mobile = window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
        var backgroundLimit = mobile ? 2400 : 8000;
        return Math.max(8, Math.min(requested, Math.floor(backgroundLimit / Math.max(1, rows * (layers || 1)))));
      }

      function generateCascadeAutomaton(tokens, width, height, runtime) {
        var c = compositionState.cascade;
        var rows = c.rows, cols = cascadeGridColumns(c.cells, rows);
        var backgroundLimited = cols < c.cells;
        var cellW = width / cols, cellH = height / rows;
        var gap = Math.min(cellW, cellH) * c.gap * 0.5;
        var rule = c.rule === 'custom' ? c.customRule : Number(c.rule);
        var clock = runtime && runtime.clock ? runtime.clock : createLoopClock(compositionState.phase, 240, compositionState.seed, compositionState.direction);
        // A deterministic forward/back generation timeline removes the
        // discontinuity of resetting a non-reversible automaton at turn 1.
        var generationSpan = Math.max(2, c.generationCount);
        var pingTurn = clock.turn * 2;
        var timelineTurn = c.pingPong ? (pingTurn <= 1 ? pingTurn : 2 - pingTurn) : clock.turn;
        var generationPosition = timelineTurn * (generationSpan - 1);
        var generationIndex = Math.floor(generationPosition);
        var generationMix = (generationPosition - generationIndex) * c.generationBlend;
        var cells = cascadeSeed(tokens, cols);
        var nextCells;
        if (c.automatonMode === 'life2d') {
          var board = new Array(rows * cols);
          for (var bi = 0; bi < board.length; bi++) {
            var seedToken = tokens[bi % tokens.length];
            board[bi] = cascadeSeed([seedToken], 1)[0] ^ (hash(bi, compositionState.seed, 71) > 0.72 ? 1 : 0);
          }
          for (var lifePre = 0; lifePre < generationIndex; lifePre++) board = cascadeLifeStep(board, rows, cols, c.lifeRule);
          var nextBoard = cascadeLifeStep(board, rows, cols, c.lifeRule);
          cells = board;
          nextCells = nextBoard;
        } else {
          for (var pre = 0; pre < generationIndex; pre++) cells = cascadeAutomatonStep(cells, rule);
          nextCells = cascadeAutomatonStep(cells, rule);
        }
        var glyphs = [], bands = [], instanceIndex = 0, limit = compositionLimit();
        cascadeBackdrop(width, height, bands);
        for (var row = 0; row < rows; row++) {
          var renderCells = cells;
          var renderNextCells = nextCells;
          if (c.automatonMode !== 'life2d') {
            for (var rowAdvance = 0; rowAdvance < row; rowAdvance++) {
              renderCells = cascadeAutomatonStep(renderCells, rule);
              renderNextCells = cascadeAutomatonStep(renderNextCells, rule);
            }
          }
          for (var col = 0; col < cols; col++) {
            var sourceCol = c.mirror && row > (rows - 1) / 2 ? cols - 1 - col : col;
            var cellIndex = c.automatonMode === 'life2d' ? row * cols + sourceCol : sourceCol;
            var currentState = renderCells[cellIndex] ? 1 : 0;
            var nextState = renderNextCells[cellIndex] ? 1 : 0;
            var stateAmount = currentState + (nextState - currentState) * generationMix;
            var state = stateAmount >= 0.5 ? 1 : 0;
            var token = tokens[(row * cols + col) % tokens.length];
            var fill = cascadeColorFor(row, col, state, token, rows, cols);
            var cellOpacity = c.opacity * (0.2 + stateAmount * 0.8);
            if (c.bands) bands.push(cascadeShapeItem(col * cellW + gap, row * cellH + gap, cellW - gap * 2, cellH - gap * 2, fill, cellOpacity, state ? 0 : c.round * 45, state));
            if (!token.space) {
              if (instanceIndex >= limit) {
                cascadePostProcess(width, height, bands);
                return { glyphs: glyphs, bands: bands, limited: true };
              }
              var glyph = compositionGlyph(
                token, (col + 0.5) * cellW, (row + 0.5) * cellH,
                Math.max(0.02, cellW / Math.max(1, params.fontSize * 0.72)),
                Math.max(0.02, cellH * (1 - c.lineSpace) / Math.max(1, params.fontSize * params.lineHeight)),
                0, cascadeGlyphColor(fill, state), 0.3 + stateAmount * 0.7, instanceIndex++
              );
              if (glyph) glyphs.push(glyph);
            }
          }
        }
        cascadePostProcess(width, height, bands);
        return { glyphs: glyphs, bands: bands, limited: backgroundLimited };
      }

      function generateCascadeCircuit(tokens, width, height, runtime) {
        var c = compositionState.cascade;
        var cols = Math.max(8, Math.round(c.cells * c.circuitDensity));
        var rows = c.rows, cellW = width / cols, rowH = height / rows;
        var glyphs = [], bands = [], instanceIndex = 0, limit = compositionLimit();
        var clock = runtime && runtime.clock ? runtime.clock : createLoopClock(compositionState.phase, 240, compositionState.seed, compositionState.direction);
        var inputs = runtime && runtime.inputs ? runtime.inputs : createCompositionInputBus(tokens, width, height, clock);
        var phase = clock.angle;
        cascadeBackdrop(width, height, bands);
        for (var row = 0; row < rows; row++) {
          var baseY = (row + 0.5) * rowH;
          var points = [{ x: 0, y: baseY }];
          for (var col = 0; col < cols; col++) {
            var token = tokens[(row * cols + col) % tokens.length];
            var cp = cascadeTokenCode(token);
            var x = (col + 0.5) * cellW;
            var signal = Math.sin(phase + row * 0.83 + col * 0.51 + (cp % 17));
            if (inputs.pointer.active && c.pointerInject) {
              var pointerFalloff = Math.max(0, 1 - Math.abs(x - inputs.pointer.px) / Math.max(1, width * 0.3));
              signal += (inputs.pointer.py / Math.max(1, height) - 0.5) * pointerFalloff * 2;
            }
            var routeY = baseY + signal * rowH * c.amplitude * 0.28;
            points.push({ x: x, y: points[points.length - 1].y });
            points.push({ x: x, y: routeY });
            var active = hash(row, cp || col, col + 23) < c.circuitDensity;
            if (active && c.bands) {
              var pulse = (Math.sin(phase * 2 + col * 0.72 - row * 0.4) + 1) * 0.5;
              var fill = cascadeColorFor(row, col, pulse > 1 - c.pulse ? 1 : 0, token, rows, cols);
              var routerBoost = col % Math.max(1, Math.round(cols / Math.max(1, c.circuitRouters))) === 0 ? 1.45 : 1;
              var nodeSize = Math.min(cellW, rowH) * (0.22 + pulse * c.pulse * 0.48) * routerBoost;
              bands.push(cascadeShapeItem(x - nodeSize / 2, routeY - nodeSize / 2, nodeSize, nodeSize, fill, c.opacity, signal * 20, active ? 1 : 0));
              if (c.packetTrail > 0) {
                var trail = cellW * (0.5 + c.packetTrail * 2.5);
                bands.push({
                  kind: 'path', points: [{ x: x - trail, y: routeY }, { x: x, y: routeY }],
                  stroke: fill, strokeWidth: Math.max(0.5, rowH * 0.025),
                  opacity: c.packetTrail * (0.12 + pulse * 0.45) * Math.min(1.5, c.circuitPackets / 16), blend: c.blend
                });
              }
              if (c.addressNodes > 0 && hash(cp, row, col) < c.addressNodes * 0.4) {
                var addressRing = cascadeShapeItem(x - nodeSize, routeY - nodeSize, nodeSize * 2, nodeSize * 2, fill, c.addressNodes * 0.5, 0, 1);
                addressRing.shape = 'ring';
                addressRing.stroke = fill;
                addressRing.strokeWidth = Math.max(0.75, c.stroke || 1);
                bands.push(addressRing);
              }
            }
            if (!token.space && col % Math.max(1, Math.round(1 / Math.max(0.12, c.circuitDensity))) === 0) {
              if (instanceIndex >= limit) {
                cascadePostProcess(width, height, bands);
                return { glyphs: glyphs, bands: bands, limited: true };
              }
              var glyphFill = c.glyphMode === 'fixed' ? c.glyph : cascadeColorFor(row, col, 1, token, rows, cols);
              var glyph = compositionGlyph(token, x, routeY, Math.max(0.02, cellW / Math.max(1, params.fontSize)), Math.max(0.02, rowH * 0.72 / Math.max(1, params.fontSize * params.lineHeight)), 0, glyphFill, 0.8, instanceIndex++);
              if (glyph) glyphs.push(glyph);
            }
          }
          points.push({ x: width, y: points[points.length - 1].y });
          if (c.bands) {
            bands.push({
              kind: 'path', points: points, stroke: cascadePalette()[row % 3],
              strokeWidth: Math.max(0.75, c.stroke || rowH * 0.035),
              opacity: 0.32 + c.opacity * 0.55, blend: c.blend
            });
            if (row < rows - 1 && hash(row, compositionState.seed, 109) < c.circuitBranches / 8) {
              var branchX = ((hash(row, compositionState.seed, 113) * 0.7 + 0.15) * width);
              bands.push({
                kind: 'path',
                points: [{ x: branchX, y: baseY }, { x: branchX, y: baseY + rowH }, { x: branchX + cellW, y: baseY + rowH }],
                stroke: cascadePalette()[(row + 1) % 3],
                strokeWidth: Math.max(0.75, c.stroke || rowH * 0.035),
                opacity: 0.2 + c.circuitBranches / 8 * 0.55, blend: c.blend
              });
            }
            if (c.circuitHeatmap > 0) {
              bands.push({
                kind: 'shape', shape: 'rect', x: 0, y: row * rowH, w: width, h: rowH,
                fill: lerpHex(c.fieldA, c.fieldB, (Math.sin(phase + row) + 1) * 0.5),
                opacity: c.circuitHeatmap * 0.08, blend: c.blend
              });
            }
          }
        }
        cascadePostProcess(width, height, bands);
        return { glyphs: glyphs, bands: bands, limited: false };
      }

      function cascadeOpticalField(nx, ny, phase, c) {
        if (c.sdfMode === 'singularity') {
          var singularX = 0.5 + Math.cos(phase) * 0.22;
          var singularY = 0.5 + Math.sin(phase * 2) * 0.22;
          var sdx = nx - singularX, sdy = ny - singularY;
          var sr = Math.sqrt(sdx * sdx + sdy * sdy);
          var sa = Math.atan2(sdy, sdx);
          return Math.sin(sr * c.frequency * 34 - phase * 3 + Math.sin(sa * 6 + phase) * c.warp * 2.5);
        }
        if (c.sdfMode === 'tunnel') {
          var tdx = nx - 0.5, tdy = ny - 0.5;
          var tr = Math.sqrt(tdx * tdx + tdy * tdy);
          var ta = Math.atan2(tdy, tdx);
          return Math.sin(Math.log(tr + 0.035) * c.frequency * 3.4 - phase * 3 + ta * c.warp * 3.2);
        }
        if (c.sdfMode === 'metaball') {
          var centers = [
            [0.5 + Math.cos(phase) * 0.25, 0.5 + Math.sin(phase * 2) * 0.22],
            [0.5 + Math.cos(phase * 2 + 2.1) * 0.31, 0.5 + Math.sin(phase * 3 + 1.4) * 0.27],
            [0.5 + Math.cos(phase * 3 + 4.2) * 0.19, 0.5 + Math.sin(phase + 3.5) * 0.34]
          ];
          var energy = 0;
          for (var ci = 0; ci < centers.length; ci++) {
            var mdx = nx - centers[ci][0], mdy = ny - centers[ci][1];
            energy += 0.018 / Math.max(0.002, mdx * mdx + mdy * mdy);
          }
          return Math.sin(energy * c.frequency * 0.42 + phase * 2);
        }
        var warpX = Math.sin(ny * c.frequency * Math.PI * 2 + phase) * c.warp;
        var warpY = Math.cos(nx * c.frequency * Math.PI * 2 - phase) * c.warp;
        var interference = (
          Math.sin((nx * c.frequency + warpX) * Math.PI * 2 + phase)
          + Math.cos((ny * c.frequency * 0.73 + warpY) * Math.PI * 2 - phase)
        ) * 0.5;
        for (var source = 1; source < c.signalSources; source++) {
          var sourcePhase = phase * (1 + Math.round(c.signalSync * 2)) + source / c.signalSources * Math.PI * 2;
          interference += Math.sin(
            (nx * (c.frequency + source) + ny * source * 0.35) * Math.PI * 2 + sourcePhase
          ) / (2 + source);
        }
        return Math.max(-1.4, Math.min(1.4, interference));
      }

      function generateCascadeSdf(tokens, width, height, runtime) {
        var c = compositionState.cascade;
        var opticalLayers = Math.max(1, c.contours);
        var rows = c.rows, cols = cascadeGridColumns(c.cells, rows, 1 + Math.round(opticalLayers * c.sdfFeedback));
        var backgroundLimited = cols < c.cells;
        var cellW = width / cols, cellH = height / rows;
        var clock = runtime && runtime.clock ? runtime.clock : createLoopClock(compositionState.phase, 240, compositionState.seed, compositionState.direction);
        var phase = clock.angle;
        var glyphs = [], bands = [], instanceIndex = 0, limit = compositionLimit();
        var palette = cascadePalette();
        cascadeBackdrop(width, height, bands);
        for (var row = 0; row < rows; row++) {
          var contourPoints = [];
          for (var col = 0; col < cols; col++) {
            var nx = (col + 0.5) / cols;
            var ny = (row + 0.5) / rows;
            var field = cascadeOpticalField(nx, ny, phase, c);
            var state = field > c.threshold * 2 - 1 ? 1 : 0;
            var token = tokens[(row * cols + col) % tokens.length];
            var magnitude = Math.min(1.4, Math.abs(field));
            var fill = cascadeColorFor(row, col, state, token, rows, cols);
            if (c.chromatic > 0) fill = lerpHex(fill, palette[(row + col + 2) % palette.length], Math.min(1, magnitude * c.chromatic));
            var scale = Math.max(0.1, Math.min(1.55, 0.18 + magnitude * (0.9 + c.amplitude * 0.2)));
            var centerX = (col + 0.5) * cellW + Math.sin(field * Math.PI + phase) * cellW * c.warp * 0.35;
            var centerY = (row + 0.5) * cellH + Math.cos(field * Math.PI - phase) * cellH * c.warp * 0.35;
            if (c.glyphWarp > 0) {
              var glyphSignal = (cascadeTokenCode(token) % 29) / 28 * Math.PI * 2;
              centerX += Math.cos(glyphSignal + phase) * cellW * c.glyphWarp;
              centerY += Math.sin(glyphSignal - phase) * cellH * c.glyphWarp;
            }
            var shapeW = cellW * scale * (1 - c.gap);
            var shapeH = cellH * scale * (1 - c.gap);
            contourPoints.push({ x: centerX, y: centerY + field * cellH * c.warp * 0.55 });
            if (c.bands && (state || magnitude > 0.5)) {
              for (var layer = opticalLayers - 1; layer >= 0; layer--) {
                var layerT = opticalLayers <= 1 ? 0 : layer / (opticalLayers - 1);
                var feedbackScale = 1 + layerT * c.sdfFeedback * 2.4 + Math.sin(field * Math.PI * c.frequency) * c.diffraction * 0.22;
                var offsetPhase = phase + layer * 1.618 + field * Math.PI;
                var echoX = Math.sin(offsetPhase) * cellW * layerT * c.sdfFeedback;
                var echoY = Math.cos(offsetPhase * 0.87) * cellH * layerT * c.sdfFeedback;
                var echoFill = layer === 0 ? fill : palette[(row + col + layer) % palette.length];
                var item = cascadeShapeItem(
                  centerX + echoX - shapeW * feedbackScale / 2,
                  centerY + echoY - shapeH * feedbackScale / 2,
                  shapeW * feedbackScale, shapeH * feedbackScale,
                  echoFill,
                  c.opacity * (layer === 0 ? 0.72 + magnitude * 0.28 : (0.06 + c.sdfFeedback * 0.11) * (1 - layerT * 0.35)),
                  field * 70 + clock.turn * 360 + layer * 17,
                  state
                );
                if (layer > 0) {
                  item.shape = 'ring';
                  item.stroke = echoFill;
                  item.strokeWidth = Math.max(0.6, c.stroke || Math.min(cellW, cellH) * (0.035 + layerT * 0.025));
                  item.blend = c.blend === 'source-over' ? 'difference' : c.blend;
                }
                bands.push(item);
              }
            }
            if (!token.space && (state || (row + col) % 3 === 0)) {
              if (instanceIndex >= limit) {
                cascadePostProcess(width, height, bands);
                return { glyphs: glyphs, bands: bands, limited: true };
              }
              var glyph = compositionGlyph(
                token, centerX, centerY,
                Math.max(0.02, cellW * (0.75 + magnitude * 0.45) / Math.max(1, params.fontSize)),
                Math.max(0.02, cellH * (0.72 + magnitude * 0.52) / Math.max(1, params.fontSize * params.lineHeight)),
                field * 28 + (c.sdfMode === 'tunnel' ? Math.atan2(ny - 0.5, nx - 0.5) * 180 / Math.PI : 0),
                cascadeGlyphColor(fill, state), state ? 0.96 : 0.28, instanceIndex++
              );
              if (glyph) glyphs.push(glyph);
            }
          }
          if (c.bands && contourPoints.length > 1) {
            bands.push({
              kind: 'path', points: contourPoints,
              stroke: palette[row % palette.length],
              strokeWidth: Math.max(0.45, c.stroke || 0.75),
              opacity: 0.1 + c.sdfFeedback * 0.2,
              blend: c.blend === 'source-over' ? 'difference' : c.blend
            });
          }
        }
        cascadePostProcess(width, height, bands);
        return { glyphs: glyphs, bands: bands, limited: backgroundLimited };
      }

      function generateCascadeMoire(tokens, width, height) {
        var c = compositionState.cascade;
        var rows = c.rows, rowH = height / rows;
        var samples = Math.min(192, Math.max(48, c.quantize * 6));
        var phaseTurn = ((compositionState.phase % 1) + 1) % 1;
        var phase = phaseTurn * Math.PI * 2;
        var palette = cascadePalette();
        var glyphs = [], bands = [], instanceIndex = 0, limit = compositionLimit();
        var units = tokens.reduce(function (sum, token) { return sum + token.units; }, 0) || 1;
        var unitW = width / Math.max(1, units + Math.max(0, tokens.length - 1) * c.tracking);
        cascadeBackdrop(width, height, bands);
        for (var row = 0; row < rows; row++) {
          var logicalRow = c.mirror && row > (rows - 1) / 2 ? rows - 1 - row : row;
          for (var layer = 0; layer < c.signalLayers; layer++) {
            var points = [];
            for (var sample = 0; sample <= samples; sample++) {
              var nx = sample / samples;
              var carrier = Math.sin(nx * Math.PI * 2 * (2 + c.waveLength * 18) + phase * (1 + layer) + logicalRow * 0.54);
              var interference = Math.sin(nx * Math.PI * 2 * (3 + layer * 0.37) - phase * 2 + row * 0.29);
              var signal = carrier * 0.64 + interference * 0.36;
              var y = (row + 0.5) * rowH + signal * rowH * c.amplitude * (0.18 + c.signalFeedback * 0.32);
              var qStep = Math.max(0.5, rowH / Math.max(2, c.quantize));
              y = Math.round(y / qStep) * qStep;
              points.push({ x: nx * width, y: y + (layer - (c.signalLayers - 1) / 2) * c.signalFeedback * 1.5 });
            }
            if (c.bands) {
              bands.push({
                kind: 'path', points: points,
                stroke: palette[(row + layer) % palette.length],
                strokeWidth: Math.max(0.8, (c.stroke || 0.8) + (c.signalLayers - layer) * 0.32),
                opacity: c.opacity * (0.22 + (1 - layer / Math.max(1, c.signalLayers)) * (0.28 + c.signalFeedback * 0.35)),
                blend: c.blend === 'source-over' && layer > 0 ? 'difference' : c.blend
              });
            }
          }
          if (c.bands) {
            var nodeCount = Math.min(28, Math.max(6, Math.round(c.quantize * 1.35)));
            for (var node = 0; node < nodeCount; node++) {
              var nodeX = (node + 0.5) / nodeCount * width;
              var nodeNX = nodeX / Math.max(1, width);
              var nodeCarrier = Math.sin(nodeNX * Math.PI * 2 * (2 + c.waveLength * 18) + phase + logicalRow * 0.54);
              var nodeInterference = Math.sin(nodeNX * Math.PI * 2 * 3 - phase * 2 + row * 0.29);
              var nodeSignal = nodeCarrier * 0.64 + nodeInterference * 0.36;
              if (Math.abs(nodeSignal) < 0.34 && (node + row) % 3) continue;
              var nodeY = (row + 0.5) * rowH + nodeSignal * rowH * c.amplitude * (0.2 + c.signalFeedback * 0.36);
              var nodeSize = Math.max(2, rowH * (0.1 + Math.abs(nodeSignal) * (0.16 + c.signalFeedback * 0.24)));
              var nodeItem = cascadeShapeItem(
                nodeX - nodeSize / 2, nodeY - nodeSize / 2,
                nodeSize * (1.2 + Math.abs(nodeSignal) * 1.8), nodeSize,
                palette[(row + node) % palette.length],
                c.opacity * (0.38 + Math.abs(nodeSignal) * 0.48),
                nodeSignal * 38, nodeSignal > 0 ? 1 : 0
              );
              nodeItem.shape = (node + row) % 5 === 0 ? 'cross' : ((node + row) % 3 === 0 ? 'ring' : c.shape);
              nodeItem.blend = c.blend === 'source-over' ? 'difference' : c.blend;
              bands.push(nodeItem);
            }
          }
          var cursor = 0;
          for (var ti = 0; ti < tokens.length; ti++) {
            var token = tokens[ti], tokenW = token.units * unitW;
            var nxToken = (cursor + tokenW / 2) / Math.max(1, width);
            var wave = Math.sin(nxToken * Math.PI * 2 * (2 + c.waveLength * 18) + phase + logicalRow * 0.54);
            var glyphY = (row + 0.5) * rowH + wave * rowH * c.amplitude * (0.2 + c.signalFeedback * 0.32);
            if (!token.space) {
              if (instanceIndex >= limit) return { glyphs: glyphs, bands: bands, limited: true };
              var glyphFill = cascadeColorFor(row, ti, wave > 0 ? 1 : 0, token, rows, tokens.length);
              var glyph = compositionGlyph(
                token, cursor + tokenW / 2, glyphY,
                Math.max(0.02, unitW / Math.max(1, params.fontSize * 0.78)),
                Math.max(0.02, rowH * (0.65 + Math.abs(wave) * c.signalFeedback) / Math.max(1, params.fontSize * params.lineHeight)),
                wave * c.signalFeedback * 34,
                c.glyphMode === 'contrast' ? cascadeGlyphColor(glyphFill, wave > 0 ? 1 : 0) : c.glyph,
                0.45 + Math.abs(wave) * 0.55,
                instanceIndex++
              );
              if (glyph) glyphs.push(glyph);
            }
            cursor += tokenW + unitW * c.tracking;
          }
        }
        var railCount = Math.min(24, Math.max(4, Math.round(c.quantize * 0.7)));
        if (c.bands) {
          for (var rail = 0; rail <= railCount; rail++) {
            var railX = rail / railCount * width;
            bands.push({
              kind: 'path',
              points: [{ x: railX, y: 0 }, { x: railX + Math.sin(phase + rail) * c.signalFeedback * rowH, y: height }],
              stroke: palette[rail % palette.length],
              strokeWidth: Math.max(0.55, c.stroke || 0.75),
              opacity: 0.07 + c.signalFeedback * 0.14,
              blend: c.blend === 'source-over' ? 'difference' : c.blend
            });
          }
        }
        cascadePostProcess(width, height, bands);
        return { glyphs: glyphs, bands: bands, limited: false };
      }

      function generateCascadeRadar(tokens, width, height) {
        var c = compositionState.cascade;
        var phaseTurn = ((compositionState.phase % 1) + 1) % 1;
        var phase = phaseTurn * Math.PI * 2;
        var palette = cascadePalette();
        var glyphs = [], bands = [], instanceIndex = 0, limit = compositionLimit();
        var ringCount = Math.min(22, Math.max(4, c.rows));
        var minSide = Math.min(width, height);
        var centerX = width * (0.5 + Math.sin(phase) * c.signalFeedback * 0.12);
        var centerY = height * (0.5 + Math.cos(phase) * c.signalFeedback * 0.12);
        cascadeBackdrop(width, height, bands);
        for (var ring = 0; ring < ringCount; ring++) {
          var radius = minSide * (0.06 + ring / Math.max(1, ringCount - 1) * 0.78);
          var ellipseY = radius * (0.55 + 0.35 * Math.sin(ring * 0.47 + phase));
          for (var layer = 0; layer < c.signalLayers; layer++) {
            var pulse = Math.sin(phase * 2 - ring * 0.63 + layer * 0.91);
            var layerRadius = radius + pulse * c.signalFeedback * (4 + layer * 2.5);
            if (c.bands) {
              var ringItem = cascadeShapeItem(
                centerX - layerRadius, centerY - ellipseY - layer * c.signalFeedback,
                layerRadius * 2, ellipseY * 2,
                palette[(ring + layer) % palette.length],
                c.opacity * (0.18 + (1 - layer / Math.max(1, c.signalLayers)) * 0.34),
                phaseTurn * 360 + ring * 3.7, pulse > 0 ? 1 : 0
              );
              ringItem.shape = 'ring';
              ringItem.stroke = palette[(ring + layer) % palette.length];
              ringItem.strokeWidth = Math.max(1.05, (c.stroke || 0.8) + layer * 0.35);
              ringItem.blend = c.blend === 'source-over' && layer > 0 ? 'difference' : c.blend;
              bands.push(ringItem);
            }
          }
          if (c.bands) {
            var pulseNodeCount = Math.min(24, Math.max(8, c.quantize));
            for (var pulseNode = ring % 3; pulseNode < pulseNodeCount; pulseNode += 3) {
              var pulseAngle = pulseNode / pulseNodeCount * Math.PI * 2 + phase + ring * 0.07;
              var pulseX = centerX + Math.cos(pulseAngle) * radius;
              var pulseY = centerY + Math.sin(pulseAngle) * ellipseY;
              var pulseSize = Math.max(2.5, minSide / ringCount * (0.12 + c.signalFeedback * 0.2));
              var pulseItem = cascadeShapeItem(
                pulseX - pulseSize / 2, pulseY - pulseSize / 2,
                pulseSize * (1 + (ring % 4) * 0.45), pulseSize,
                palette[(ring + pulseNode) % palette.length],
                c.opacity * (0.48 + c.signalFeedback * 0.42),
                pulseAngle * 180 / Math.PI, pulseNode % 2
              );
              pulseItem.shape = pulseNode % 4 === 0 ? 'cross' : (pulseNode % 2 ? 'ring' : c.shape);
              pulseItem.blend = c.blend === 'source-over' ? 'difference' : c.blend;
              bands.push(pulseItem);
            }
          }
          var tokenStep = Math.max(1, Math.floor(tokens.length / Math.max(18, c.quantize * 1.5)));
          for (var ti = ring % tokenStep; ti < tokens.length; ti += tokenStep) {
            var token = tokens[ti];
            if (token.space) continue;
            if (instanceIndex >= limit) return { glyphs: glyphs, bands: bands, limited: true };
            var angle = ti / Math.max(1, tokens.length) * Math.PI * 2 + phase + ring * 0.17;
            var gx = centerX + Math.cos(angle) * radius;
            var gy = centerY + Math.sin(angle) * ellipseY;
            var fill = cascadeColorFor(ring, ti, Math.sin(angle + phase) > 0 ? 1 : 0, token, ringCount, tokens.length);
            var glyph = compositionGlyph(
              token, gx, gy,
              Math.max(0.02, minSide / ringCount * 0.74 / Math.max(1, params.fontSize)),
              Math.max(0.02, minSide / ringCount * (0.7 + c.signalFeedback * 0.8) / Math.max(1, params.fontSize * params.lineHeight)),
              angle * 180 / Math.PI + 90,
              cascadeGlyphColor(fill, 1), 0.55 + c.signalFeedback * 0.4, instanceIndex++
            );
            if (glyph) glyphs.push(glyph);
          }
        }
        var spokeCount = Math.min(48, Math.max(6, c.quantize));
        if (c.bands) {
          for (var spoke = 0; spoke < spokeCount; spoke++) {
            var spokeAngle = spoke / spokeCount * Math.PI * 2 + phase;
            var spokeRadius = minSide * 0.82;
            bands.push({
              kind: 'path',
              points: [
                { x: centerX, y: centerY },
                { x: centerX + Math.cos(spokeAngle) * spokeRadius, y: centerY + Math.sin(spokeAngle) * spokeRadius * 0.65 }
              ],
              stroke: palette[spoke % palette.length],
              strokeWidth: Math.max(0.7, c.stroke || 0.9),
              opacity: 0.07 + c.signalFeedback * 0.16,
              blend: c.blend === 'source-over' ? 'difference' : c.blend
            });
          }
          for (var scan = 0; scan < 3; scan++) {
            var scanAngle = phase * (scan + 1) + scan * Math.PI * 0.08;
            var scanRadius = minSide * (0.56 + scan * 0.12);
            bands.push({
              kind: 'path',
              points: [
                { x: centerX, y: centerY },
                { x: centerX + Math.cos(scanAngle) * scanRadius, y: centerY + Math.sin(scanAngle) * scanRadius * 0.65 }
              ],
              stroke: palette[(scan + 1) % palette.length],
              strokeWidth: Math.max(1.8, (c.stroke || 0.8) * (3.6 - scan * 0.8)),
              opacity: c.opacity * (0.42 - scan * 0.09),
              blend: c.blend === 'source-over' ? 'difference' : c.blend
            });
          }
        }
        cascadePostProcess(width, height, bands);
        return { glyphs: glyphs, bands: bands, limited: false };
      }

      function generateCascadeBands(tokens, width, height) {
        var c = compositionState.cascade;
        if (c.signalMode === 'moire') return generateCascadeMoire(tokens, width, height);
        if (c.signalMode === 'radar') return generateCascadeRadar(tokens, width, height);
        var units = tokens.reduce(function (sum, token) { return sum + token.units; }, 0) || 1;
        var unitW = width / Math.max(1, units + Math.max(0, tokens.length - 1) * c.tracking);
        var rowH = height / c.rows;
        var limit = compositionLimit();
        var phaseTurn = ((compositionState.phase % 1) + 1) % 1;
        var phase = phaseTurn * Math.PI * 2;
        var palette = cascadePalette();
        var glyphs = [], bands = [], instanceIndex = 0;
        cascadeBackdrop(width, height, bands);
        for (var row = 0; row < c.rows; row++) {
          var cursor = 0;
          var logicalRow = c.mirror && row > (c.rows - 1) / 2 ? c.rows - 1 - row : row;
          for (var ti = 0; ti < tokens.length; ti++) {
            var token = tokens[ti];
            var tokenW = token.units * unitW;
            var raw = Math.sin(-phase + logicalRow * (Math.PI * 2 / c.rows) + ti * c.waveLength * Math.PI * 2);
            var shaped = Math.sign(raw) * (1 - Math.pow(1 - Math.abs(raw), c.slope));
            var bandH = rowH * (1 - c.lineSpace) * Math.max(0.08, 1 + shaped * c.amplitude);
            var cy = (row + 0.5) * rowH + shaped * c.amplitude * rowH * 0.28;
            var quantStep = Math.max(0.5, rowH / Math.max(2, c.quantize));
            cy = Math.round(cy / quantStep) * quantStep;
            var fill = cascadeColorFor(row, ti, raw > 0 ? 1 : 0, token, c.rows, tokens.length);
            var gap = Math.min(tokenW, bandH) * c.gap * 0.5;
            if (c.bands) {
              for (var layer = c.signalLayers - 1; layer > 0; layer--) {
                var layerT = layer / Math.max(1, c.signalLayers - 1);
                var echoScale = 1 + layerT * c.signalFeedback * 0.65;
                var echoW = (tokenW + unitW * c.tracking - gap * 2 + 0.5) * echoScale;
                var echoH = (bandH - gap * 2) * echoScale;
                var echo = cascadeShapeItem(
                  cursor + tokenW / 2 - echoW / 2 + Math.sin(phase + row + ti + layer) * unitW * c.signalFeedback * layerT,
                  cy - echoH / 2 + Math.cos(phase + ti - layer) * rowH * c.signalFeedback * layerT,
                  echoW, echoH,
                  palette[(row + ti + layer) % palette.length],
                  c.opacity * (0.04 + c.signalFeedback * 0.12) * (1 - layerT * 0.35),
                  shaped * c.round * 28 + layer * 9,
                  raw > 0 ? 1 : 0
                );
                echo.blend = c.blend === 'source-over' ? 'difference' : c.blend;
                if (layer % 2) {
                  echo.shape = 'ring';
                  echo.stroke = echo.fill;
                  echo.strokeWidth = Math.max(0.55, c.stroke || 0.8);
                }
                bands.push(echo);
              }
              bands.push(cascadeShapeItem(cursor + gap, cy - bandH / 2 + gap, tokenW + unitW * c.tracking - gap * 2 + 0.5, bandH - gap * 2, fill, c.opacity, shaped * c.round * 28, raw > 0 ? 1 : 0));
            }
            if (!token.space) {
              if (instanceIndex >= limit) {
                cascadePostProcess(width, height, bands);
                return { glyphs: glyphs, bands: bands, limited: true };
              }
              var glyph = compositionGlyph(token, cursor + tokenW / 2, cy, unitW / Math.max(1, params.fontSize * 0.72), Math.max(0.02, bandH / Math.max(1, params.fontSize * params.lineHeight)), shaped * c.signalFeedback * 28, cascadeGlyphColor(fill, raw > 0 ? 1 : 0), 1, instanceIndex++);
              if (glyph) glyphs.push(glyph);
            }
            cursor += tokenW + unitW * c.tracking;
          }
        }
        cascadePostProcess(width, height, bands);
        return { glyphs: glyphs, bands: bands, limited: false };
      }

      /* ---------------- Contour Atlas: scalar field → marching squares ---------------- */
      function contourScalar(nx, ny, tokens, clock, inputs, contour) {
        var value = 0;
        if (contour.source === 'interference') {
          value = (
            Math.sin((nx * 4 + Math.cos(clock.angle) * 0.35) * Math.PI * 2) +
            Math.cos((ny * 5 + Math.sin(clock.angle) * 0.35) * Math.PI * 2) +
            Math.sin((nx + ny) * 7 * Math.PI + clock.angle * 2)
          ) / 3;
        } else {
          var visible = Math.max(1, tokens.length);
          var nearest = Infinity, charge = 0;
          var sources = Math.min(24, visible);
          for (var si = 0; si < sources; si++) {
            var token = tokens[Math.floor(si / sources * visible) % visible];
            var cp = cascadeTokenCode(token);
            var sx = 0.08 + hash(cp, si, compositionState.seed) * 0.84;
            var sy = 0.08 + hash(si, cp, compositionState.seed + 17) * 0.84;
            var dx = nx - sx, dy = ny - sy;
            var distance = Math.sqrt(dx * dx + dy * dy);
            nearest = Math.min(nearest, distance);
            charge += (((cp % 7) - 3) / 3) / Math.max(0.035, distance) * 0.025;
          }
          if (contour.source === 'voronoi') value = 1 - Math.min(1, nearest * 5);
          else if (contour.source === 'unicodeCharge') value = Math.tanh(charge * contour.charge);
          else value = Math.cos(Math.min(1, nearest) * Math.PI * (4 + contour.spacing * 8) - clock.angle)
            * (0.35 + contour.textHeight * 0.65);
        }
        value += Math.sin((nx - ny) * Math.PI * 6 + clock.angle) * contour.interference * 0.18;
        if (inputs.pointer.active && contour.pointerRelief > 0) {
          var pd = Math.hypot(nx - inputs.pointer.x, ny - inputs.pointer.y);
          value += Math.max(0, 1 - pd * 4) * contour.pointerRelief * inputs.pointer.pressure;
        }
        return Math.max(-1, Math.min(1, value));
      }

      function contourEdgePoint(edge, x, y, cellW, cellH, a, b, c, d, level) {
        function mix(v0, v1) {
          var denom = v1 - v0;
          return Math.max(0, Math.min(1, Math.abs(denom) < 0.000001 ? 0.5 : (level - v0) / denom));
        }
        if (edge === 0) return { x: x + mix(a, b) * cellW, y: y };
        if (edge === 1) return { x: x + cellW, y: y + mix(b, c) * cellH };
        if (edge === 2) return { x: x + (1 - mix(d, c)) * cellW, y: y + cellH };
        return { x: x, y: y + (1 - mix(a, d)) * cellH };
      }

      function contourSegmentsForCell(x, y, cellW, cellH, a, b, c, d, level) {
        var state = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (d >= level ? 1 : 0);
        var table = {
          1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[0, 1]],
          5: [[0, 3], [2, 1]], 6: [[0, 2]], 7: [[0, 3]],
          8: [[3, 0]], 9: [[0, 2]], 10: [[3, 2], [0, 1]],
          11: [[0, 1]], 12: [[3, 1]], 13: [[2, 1]], 14: [[3, 2]]
        };
        var edges = table[state] || [];
        return edges.map(function (pair) {
          return [
            contourEdgePoint(pair[0], x, y, cellW, cellH, a, b, c, d, level),
            contourEdgePoint(pair[1], x, y, cellW, cellH, a, b, c, d, level)
          ];
        });
      }

      function generateContourAtlasScene(tokens, width, height, runtime) {
        var contour = compositionState.contourAtlas;
        var clock = runtime && runtime.clock ? runtime.clock : createLoopClock(compositionState.phase, 240, compositionState.seed, compositionState.direction);
        var inputs = runtime && runtime.inputs ? runtime.inputs : createCompositionInputBus(tokens, width, height, clock);
        var effectiveQuality = compositionEffectiveQuality();
        var qualityScale = effectiveQuality === 'performance' ? 0.62 : (effectiveQuality === 'high' ? 1.25 : 1);
        var cols = Math.max(12, Math.min(144, Math.round(contour.resolution * qualityScale)));
        var rows = Math.max(12, Math.round(cols * height / Math.max(1, width)));
        var values = new Float32Array((cols + 1) * (rows + 1));
        for (var gy = 0; gy <= rows; gy++) {
          for (var gx = 0; gx <= cols; gx++) {
            values[gy * (cols + 1) + gx] = contourScalar(gx / cols, gy / rows, tokens, clock, inputs, contour);
          }
        }
        var cellW = width / cols, cellH = height / rows;
        var palette = compositionPalette();
        var glyphs = [], bands = [], segments = [], instanceIndex = 0, limit = compositionLimit();
        // Marching Squares can otherwise allocate levels × rows × columns
        // objects before the shared FX budget has a chance to trim the scene.
        var segmentLimit = Math.max(256, limit);
        var bandLimit = Math.max(128, Math.floor(limit * 0.65));
        var contourCapped = false;
        var needsStoredSegments = contour.glyphs || contour.rendering === 'glyphs' || contour.rendering === 'hybrid';
        var needsBands = contour.rendering !== 'glyphs' || contour.filled;
        var levelCount = Math.max(2, contour.levels);
        contourLevels:
        for (var levelIndex = 0; levelIndex < levelCount; levelIndex++) {
          var thresholdShift = (contour.threshold - 0.5) * 0.9;
          var level = -0.82 + levelIndex / Math.max(1, levelCount - 1) * 1.64 + thresholdShift;
          for (var row = 0; row < rows; row++) {
            for (var col = 0; col < cols; col++) {
              var a = values[row * (cols + 1) + col];
              var b = values[row * (cols + 1) + col + 1];
              var c = values[(row + 1) * (cols + 1) + col + 1];
              var d = values[(row + 1) * (cols + 1) + col];
              var cellSegments = contourSegmentsForCell(col * cellW, row * cellH, cellW, cellH, a, b, c, d, level);
              for (var segmentIndex = 0; segmentIndex < cellSegments.length; segmentIndex++) {
                var segment = cellSegments[segmentIndex];
                if (needsStoredSegments) {
                  if (segments.length < segmentLimit) segments.push(segment);
                  else contourCapped = true;
                }
                if (contour.rendering !== 'glyphs' && bands.length < bandLimit) {
                  bands.push({
                    kind: 'path', points: segment,
                    stroke: contour.colorMode === 'ink' ? params.ink : palette[levelIndex % palette.length],
                    strokeWidth: contour.lineWidth,
                    opacity: 0.2 + contour.density * 0.7,
                    dash: contour.dash > 0 ? [2 + contour.dash * 12, 2 + contour.dash * 8] : null,
                    blend: levelIndex % 3 === 2 ? 'difference' : 'source-over'
                  });
                } else if (contour.rendering !== 'glyphs') contourCapped = true;
              }
              // A filled cell is a cell primitive, not one fill per contour
              // segment (ambiguous marching states may have two segments).
              if ((contour.filled || contour.rendering === 'filled') && a >= level && levelIndex % 2 === 0) {
                if (bands.length < bandLimit) {
                  bands.push({
                    kind: 'shape', shape: 'rect', x: col * cellW, y: row * cellH,
                    w: cellW + 0.5, h: cellH + 0.5,
                    fill: contour.colorMode === 'ink' ? params.ink : palette[levelIndex % palette.length],
                    opacity: contour.fillOpacity * (0.15 + contour.density * 0.35)
                  });
                } else contourCapped = true;
              }
              if ((!needsStoredSegments || segments.length >= segmentLimit) &&
                  (!needsBands || bands.length >= bandLimit)) {
                contourCapped = true;
                break contourLevels;
              }
            }
          }
        }
        if (contour.glyphs || contour.rendering === 'glyphs' || contour.rendering === 'hybrid') {
          var step = Math.max(1, Math.round(4 - contour.density * 3));
          for (var si = 0; si < segments.length && instanceIndex < limit; si += step) {
            var points = segments[si];
            var token = tokens[instanceIndex % tokens.length];
            if (token.space) continue;
            var dx = points[1].x - points[0].x, dy = points[1].y - points[0].y;
            var scale = Math.max(0.025, Math.min(cellW, cellH) * 1.5 / Math.max(1, params.fontSize));
            var glyph = compositionGlyph(
              token,
              (points[0].x + points[1].x) * 0.5,
              (points[0].y + points[1].y) * 0.5,
              scale, scale,
              Math.atan2(dy, dx) * 180 / Math.PI * contour.tangent,
              palette[instanceIndex % palette.length],
              0.45 + compositionMacro('legibility', 0.85) * 0.55,
              instanceIndex++
            );
            if (glyph) glyphs.push(glyph);
          }
        }
        return { glyphs: glyphs, bands: bands, limited: contourCapped || instanceIndex >= limit };
      }

      /* ---------------- Feedback Chamber: deterministic analytical feedback ---------------- */
      function generateFeedbackChamberScene(tokens, width, height, runtime) {
        var feedback = compositionState.feedbackChamber;
        var clock = runtime && runtime.clock ? runtime.clock : createLoopClock(compositionState.phase, 240, compositionState.seed, compositionState.direction);
        var inputs = runtime && runtime.inputs ? runtime.inputs : createCompositionInputBus(tokens, width, height, clock);
        var glyphs = [], bands = [], instanceIndex = 0, limit = compositionLimit();
        var visible = tokens.filter(function (token) { return token && !token.space && token.glyph; });
        var phrase = visible.length ? visible : tokens;
        var echoCount = Math.min(feedback.echoes, Math.max(1, Math.floor(limit / Math.max(1, phrase.length))));
        var usePointerCenter = feedback.pointerCenter && inputs.pointer.active;
        var centerX = usePointerCenter ? inputs.pointer.px : width * 0.5;
        var centerY = usePointerCenter ? inputs.pointer.py : height * 0.5;
        var baseAdvance = Math.min(width / Math.max(1, phrase.length), params.fontSize * 1.1);
        var baseWidth = phrase.length * baseAdvance;
        var palette = compositionPalette();
        for (var echo = echoCount - 1; echo >= 0; echo--) {
          var t = echo / Math.max(1, echoCount - 1);
          var echoPhase = clock.angle + t * Math.PI * 2;
          var scale = Math.pow(1 + feedback.zoom, echo);
          var rotation = feedback.rotation * echo + Math.sin(echoPhase) * feedback.warpAmount * 12;
          var driftX = feedback.driftX * width * t + Math.cos(echoPhase) * feedback.warpAmount * width * 0.035;
          var driftY = feedback.driftY * height * t + Math.sin(echoPhase) * feedback.warpAmount * height * 0.035;
          var copies = feedback.mirror === 'quad' ? 4 : (feedback.mirror === 'bilateral' ? 2 : (feedback.mirror === 'kaleidoscope' ? feedback.kaleidoscope : 1));
          for (var copy = 0; copy < copies; copy++) {
            var copyAngle = copy / copies * Math.PI * 2;
            for (var ti = 0; ti < phrase.length; ti++) {
              if (instanceIndex >= limit) return { glyphs: glyphs, bands: bands, limited: true, rasterPasses: [{ kind: 'rasterPass', shader: 'feedback', fallback: true }] };
              var token = phrase[ti];
              var localX = -baseWidth * 0.5 + (ti + 0.5) * baseAdvance;
              var localY = 0;
              var glyphRotation = rotation;
              if (feedback.warp === 'wave') localY += Math.sin(ti / Math.max(1, phrase.length) * Math.PI * 2 + echoPhase) * params.fontSize * feedback.warpAmount;
              else if (feedback.warp === 'twist') glyphRotation += Math.sin(ti / Math.max(1, phrase.length) * Math.PI * 2 + echoPhase) * feedback.warpAmount * 16;
              else if (feedback.warp === 'tunnel') localY += Math.sin(echoPhase + ti * 0.7) * t * height * 0.08;
              else if (feedback.warp === 'glyphSdf') localY += compositionLoopNoise(clock, ti, echo, cascadeTokenCode(token)) * feedback.warpAmount * params.fontSize;
              var ca = copyAngle + glyphRotation * Math.PI / 180;
              var gx = centerX + Math.cos(ca) * localX * scale - Math.sin(ca) * localY * scale + driftX;
              var gy = centerY + Math.sin(ca) * localX * scale + Math.cos(ca) * localY * scale + driftY;
              var opacity = feedback.injection * Math.pow(feedback.decay, echo) * (0.4 + feedback.persistence * 0.6);
              if (opacity < feedback.threshold * 0.08) continue;
              var glyph = compositionGlyph(
                token, gx, gy,
                scale * (1 + feedback.shear * t * 0.2), scale,
                glyphRotation + copyAngle * 180 / Math.PI,
                palette[(echo + copy) % palette.length],
                Math.min(1, opacity), instanceIndex++
              );
              if (glyph) {
                glyph.skewX += feedback.shear * echo * 8;
                glyphs.push(glyph);
              }
            }
          }
          bands.push({
            kind: 'shape', shape: 'ring',
            x: centerX - baseWidth * scale * 0.52, y: centerY - params.fontSize * scale,
            w: baseWidth * scale * 1.04, h: params.fontSize * scale * 2,
            fill: palette[echo % palette.length], stroke: palette[echo % palette.length],
            strokeWidth: Math.max(0.5, 1.5 * (1 - t)),
            opacity: Math.pow(feedback.decay, echo) * feedback.persistence * 0.18,
            rotation: rotation, blend: echo % 2 ? 'screen' : 'difference'
          });
        }
        return {
          glyphs: glyphs, bands: bands, limited: false,
          rasterPasses: [{ kind: 'rasterPass', shader: 'feedback', fallback: true, loopLocked: compositionState.loopLock && feedback.loopLock }]
        };
      }

      function generateCascadeScene(tokens, width, height, runtime) {
        var system = compositionState.cascade.system;
        var generated;
        if (system === 'automaton') generated = generateCascadeAutomaton(tokens, width, height, runtime);
        else if (system === 'circuit') generated = generateCascadeCircuit(tokens, width, height, runtime);
        else if (system === 'sdf') generated = generateCascadeSdf(tokens, width, height, runtime);
        else generated = generateCascadeBands(tokens, width, height);
        var c = compositionState.cascade;
        generated.glyphs.forEach(function (glyph) { glyph.opacity *= c.textAmount; });
        generated.bands.forEach(function (band) {
          band.opacity = (band.opacity == null ? 1 : band.opacity) * c.backgroundAmount;
        });
        return generated;
      }

      function cloneSceneGlyphForFx(glyph) {
        return Object.assign({}, glyph);
      }

      function cloneSceneBandForFx(band) {
        var clone = Object.assign({}, band);
        if (band.points) clone.points = band.points.map(function (point) { return { x: point.x, y: point.y }; });
        return clone;
      }

      function transformSceneItem(item, width, height, scale, rotation, dx, dy) {
        var cx = width * 0.5, cy = height * 0.5;
        var radians = rotation * Math.PI / 180;
        function point(x, y) {
          var px = (x - cx) * scale, py = (y - cy) * scale;
          return {
            x: cx + px * Math.cos(radians) - py * Math.sin(radians) + dx,
            y: cy + px * Math.sin(radians) + py * Math.cos(radians) + dy
          };
        }
        if (item.composition) {
          var gp = point(item.ox, item.oy);
          item.x += gp.x - item.ox; item.y += gp.y - item.oy;
          item.bx += gp.x - item.ox; item.by += gp.y - item.oy;
          item.ox = gp.x; item.oy = gp.y;
          item.scaleX *= scale; item.scaleY *= scale; item.rot += rotation;
        } else if (item.kind === 'path' && item.points) {
          item.points = item.points.map(function (p) { return point(p.x, p.y); });
        } else {
          var bp = point(item.x + item.w * 0.5, item.y + item.h * 0.5);
          item.w *= scale; item.h *= scale;
          item.x = bp.x - item.w * 0.5; item.y = bp.y - item.h * 0.5;
          item.rotation = (item.rotation || 0) + rotation;
        }
      }

      // Kept as a compact analytical fallback for embedding contexts; the
      // canonical preview/export pipeline is applyCompositionFxRack below.
      function applyCompositionFxRackAnalyticalFallback(scene, width, height, runtime) {
        var rack = compositionState.fxRack || COMPOSITION_DEFAULTS.fxRack;
        var limit = compositionLimit();
        var clock = runtime.clock;
        // Engine → Echo / Trail
        if (rack.echo.enabled && rack.echo.amount > 0) {
          var sourceGlyphs = scene.glyphs.slice();
          var sourceBands = scene.bands.slice();
          for (var echoIndex = 1; echoIndex <= rack.echo.count; echoIndex++) {
            if (scene.glyphs.length >= limit) { scene.limited = true; break; }
            var echoTurn = clock.turn + rack.echo.phase * echoIndex;
            var echoScale = 1 + rack.echo.scale * echoIndex;
            var echoRotation = rack.echo.rotation * echoIndex;
            var echoOpacity = rack.echo.amount * Math.pow(rack.echo.decay, echoIndex);
            var echoDx = Math.cos(echoTurn * Math.PI * 2) * rack.echo.amount * echoIndex * 3;
            var echoDy = Math.sin(echoTurn * Math.PI * 2) * rack.echo.amount * echoIndex * 3;
            for (var eg = 0; eg < sourceGlyphs.length && scene.glyphs.length < limit; eg++) {
              var echoGlyph = cloneSceneGlyphForFx(sourceGlyphs[eg]);
              echoGlyph.opacity *= echoOpacity;
              transformSceneItem(echoGlyph, width, height, echoScale, echoRotation, echoDx, echoDy);
              scene.glyphs.unshift(echoGlyph);
            }
            for (var eb = 0; eb < sourceBands.length; eb++) {
              var echoBand = cloneSceneBandForFx(sourceBands[eb]);
              echoBand.opacity = (echoBand.opacity == null ? 1 : echoBand.opacity) * echoOpacity;
              transformSceneItem(echoBand, width, height, echoScale, echoRotation, echoDx, echoDy);
              scene.bands.unshift(echoBand);
            }
          }
        }
        // Echo → Feedback
        if (rack.feedback.enabled && rack.feedback.amount > 0) {
          var feedbackCopies = Math.max(1, Math.round(1 + rack.feedback.amount * 4));
          var feedbackSource = scene.bands.slice();
          for (var feedbackIndex = 1; feedbackIndex <= feedbackCopies; feedbackIndex++) {
            var feedbackScale = 1 + rack.feedback.zoom * feedbackIndex;
            var feedbackRotation = rack.feedback.rotation * feedbackIndex;
            for (var fb = 0; fb < feedbackSource.length; fb++) {
              var feedbackBand = cloneSceneBandForFx(feedbackSource[fb]);
              feedbackBand.opacity = (feedbackBand.opacity == null ? 1 : feedbackBand.opacity) * rack.feedback.amount * Math.pow(0.58, feedbackIndex);
              var warpX = Math.sin(clock.angle + feedbackIndex) * rack.feedback.warp * 12;
              var warpY = Math.cos(clock.angle + feedbackIndex) * rack.feedback.warp * 12;
              transformSceneItem(feedbackBand, width, height, feedbackScale, feedbackRotation, warpX, warpY);
              scene.bands.unshift(feedbackBand);
            }
          }
        }
        // Feedback → Signal Mask
        if (rack.signalMask.enabled && rack.signalMask.amount > 0) {
          scene.glyphs.forEach(function (glyph, index) {
            var signal = (Math.sin(index * 1.618 + clock.angle) + 1) * 0.5;
            if (rack.signalMask.mode === 'inverseText') signal = 1 - signal;
            else if (rack.signalMask.mode === 'field') signal = (Math.cos((glyph.ox / Math.max(1, width) - glyph.oy / Math.max(1, height)) * Math.PI * 8 + clock.angle) + 1) * 0.5;
            glyph.opacity *= 1 - rack.signalMask.amount + signal * rack.signalMask.amount;
          });
        }
        // Signal Mask → Chromatic Split
        if (rack.chromaticSplit.enabled && rack.chromaticSplit.amount > 0) {
          var chromaticSource = scene.glyphs.slice();
          var angle = rack.chromaticSplit.angle * Math.PI / 180;
          var splitX = Math.cos(angle) * rack.chromaticSplit.distance * rack.chromaticSplit.amount;
          var splitY = Math.sin(angle) * rack.chromaticSplit.distance * rack.chromaticSplit.amount;
          for (var cg = 0; cg < chromaticSource.length && scene.glyphs.length + 2 <= limit; cg++) {
            var cyan = cloneSceneGlyphForFx(chromaticSource[cg]);
            var red = cloneSceneGlyphForFx(chromaticSource[cg]);
            cyan.x -= splitX; cyan.bx -= splitX; cyan.ox -= splitX; cyan.y -= splitY; cyan.by -= splitY; cyan.oy -= splitY;
            red.x += splitX; red.bx += splitX; red.ox += splitX; red.y += splitY; red.by += splitY; red.oy += splitY;
            cyan.fill = compositionState.color2; red.fill = params.accent;
            cyan.opacity *= rack.chromaticSplit.amount * 0.55;
            red.opacity *= rack.chromaticSplit.amount * 0.55;
            scene.glyphs.unshift(cyan, red);
          }
        }
        // Chromatic Split → Raster Material (vector preview approximation).
        if (rack.rasterMaterial.enabled && rack.rasterMaterial.amount > 0 && rack.rasterMaterial.scanline > 0) {
          var spacing = Math.max(3, Math.round(15 - rack.rasterMaterial.scanline * 11));
          for (var scanY = 0; scanY < height; scanY += spacing) {
            scene.bands.push({
              kind: 'shape', shape: 'rect', x: 0, y: scanY, w: width,
              h: Math.max(0.5, rack.rasterMaterial.scanline * 1.8),
              fill: params.ink,
              opacity: rack.rasterMaterial.amount * rack.rasterMaterial.scanline * 0.12,
              blend: 'multiply', post: true
            });
          }
          scene.rasterPasses = scene.rasterPasses || [];
          scene.rasterPasses.push({
            kind: 'rasterPass', shader: 'rasterMaterial',
            pixelate: rack.rasterMaterial.pixelate,
            posterize: rack.rasterMaterial.posterize,
            noise: rack.rasterMaterial.noise,
            fallback: true
          });
        }
        return scene;
      }

      function applyCompositionLegibility(scene) {
        var legibility = compositionMacro('legibility', 0.85);
        for (var i = 0; i < scene.glyphs.length; i++) {
          scene.glyphs[i].opacity *= legibility;
        }
        for (var j = 0; j < scene.bands.length; j++) {
          if (scene.bands[j].backdrop) continue;
          scene.bands[j].opacity = (scene.bands[j].opacity == null ? 1 : scene.bands[j].opacity) * (0.3 + (1 - legibility) * 0.7);
        }
        return scene;
      }

      function normalizeCompositionEngineState(id, raw) {
        var payload = { type: id };
        payload[id] = raw;
        return normalizeComposition(payload)[id];
      }

      function compositionEngineContract(id, label, generator, controls, modules, presets, capabilities) {
        return {
          id: id,
          label: label,
          defaults: COMPOSITION_DEFAULTS[id],
          normalize: function (raw) { return normalizeCompositionEngineState(id, raw); },
          controls: controls || [],
          modules: modules || [],
          presets: presets || [],
          compile: function (source, viewport, state) {
            return compileCompositionSource(source, viewport.width, viewport.height, state || compositionState);
          },
          evaluate: function (compiled, clock, inputs, quality) {
            if (clock) compiled.clock = clock;
            if (inputs) compiled.inputs = inputs;
            compiled.quality = quality || compositionState.quality;
            return generator(compiled.tokens, compiled.viewport.width, compiled.viewport.height, compiled);
          },
          render: function (frame, renderers) {
            if (renderers && typeof renderers.scene === 'function') return renderers.scene(frame);
            return frame;
          },
          capabilities: capabilities || { canvas2d: true, svg: true, webgl2: false }
        };
      }

      COMPOSITION_ENGINES = {
        field: compositionEngineContract(
          'field', 'Field', generateFieldScene,
          ['core', 'motion', 'topology', 'material', 'advanced'],
          ['vectorField', 'network', 'pointer'],
          ['waveGrid', 'vortexType', 'textAttractor']
        ),
        fluxRows: compositionEngineContract(
          'fluxRows', 'Flux Rows', generateFluxScene,
          ['core', 'motion', 'topology', 'material'],
          ['baseline', 'weave', 'trail'],
          ['counterflow', 'braid', 'scanRows']
        ),
        cascade: compositionEngineContract(
          'cascade', 'Cascade', generateCascadeScene,
          ['core', 'motion', 'topology', 'material', 'advanced'],
          ['automaton', 'circuit', 'signalField', 'opticalShader'],
          ['cellular', 'dataCircuit', 'signalInterference', 'opticalTunnel'],
          { canvas2d: true, svg: true, webgl2: true, webglFallback: true }
        ),
        contourAtlas: compositionEngineContract(
          'contourAtlas', 'Contour Atlas', generateContourAtlasScene,
          ['core', 'topology', 'material', 'advanced'],
          ['scalarField', 'marchingSquares', 'contourGlyphs'],
          ['topographic', 'seismic', 'isoScript']
        ),
        feedbackChamber: compositionEngineContract(
          'feedbackChamber', 'Feedback Chamber', generateFeedbackChamberScene,
          ['core', 'motion', 'topology', 'material', 'advanced'],
          ['recursiveTransform', 'mirror', 'textInjection'],
          ['recursiveType', 'spectralBurn', 'mirrorHall'],
          { canvas2d: true, svg: 'raster-best-effort', webgl2: true, webglFallback: true }
        )
      };

      function generateCompositionScene(width, height, qualityMode) {
        width = Math.max(1, width);
        height = Math.max(1, height);
        compositionScene.width = width;
        compositionScene.height = height;
        var previousOverride = compositionQualityOverride;
        if (qualityMode === 'export') compositionQualityOverride = 'high';
        try {
          var sourceGlyphs = snapshotGlyphs(true);
          var engine = COMPOSITION_ENGINES[compositionState.type] || COMPOSITION_ENGINES.field;
          var compiled = engine.compile(sourceGlyphs, { width: width, height: height }, compositionState);
          if (!compiled.tokens.length) return { glyphs: [], bands: [], width: width, height: height, limited: false, masks: [], rasterPasses: [] };
          var generated = engine.evaluate(compiled, compiled.clock, compiled.inputs, compositionEffectiveQuality());
          generated.glyphs = generated.glyphs || [];
          generated.bands = generated.bands || [];
          generated.masks = generated.masks || [];
          generated.rasterPasses = generated.rasterPasses || [];
          generated = applyCompositionLegibility(generated);
          generated.width = width;
          generated.height = height;
          generated.engine = compositionState.type;
          generated.clock = compiled.clock;
          return generated;
        } finally {
          compositionQualityOverride = previousOverride;
        }
      }

      function traceSceneShape(ctx, band) {
        var x = band.x, y = band.y, w = band.w, h = band.h;
        var cx = x + w / 2, cy = y + h / 2;
        ctx.translate(cx, cy);
        if (band.rotation) ctx.rotate(band.rotation * Math.PI / 180);
        x = -w / 2; y = -h / 2;
        ctx.beginPath();
        if (band.shape === 'circle') {
          ctx.ellipse(0, 0, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
        } else if (band.shape === 'diamond') {
          ctx.moveTo(0, y); ctx.lineTo(x + w, 0); ctx.lineTo(0, y + h); ctx.lineTo(x, 0); ctx.closePath();
        } else if (band.shape === 'cross') {
          var arm = Math.min(Math.abs(w), Math.abs(h)) * (0.15 + (band.radius || 0) * 0.2);
          ctx.rect(-arm, y, arm * 2, h);
          ctx.rect(x, -arm, w, arm * 2);
        } else if (band.shape === 'line') {
          ctx.moveTo(x, y + h); ctx.lineTo(x + w, y);
        } else if (band.shape === 'ring') {
          ctx.ellipse(0, 0, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
        } else if (band.shape === 'rounded') {
          var radius = Math.min(Math.abs(w), Math.abs(h)) * Math.min(0.5, Math.max(0, band.radius || 0));
          ctx.moveTo(x + radius, y);
          ctx.lineTo(x + w - radius, y); ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
          ctx.lineTo(x + w, y + h - radius); ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
          ctx.lineTo(x + radius, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
          ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y); ctx.closePath();
        } else ctx.rect(x, y, w, h);
      }

      function drawSceneBands(ctx, bands, scale, L) {
        if (!bands || !bands.length) return;
        ctx.save();
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.translate(L.dx, L.dy);
        ctx.scale(L.s, L.s);
        for (var i = 0; i < bands.length; i++) {
          var band = bands[i];
          if ((band.opacity == null ? 1 : band.opacity) <= 0.001) continue;   // 完全透明は描かない (上流 81545ec)
          ctx.save();
          ctx.globalAlpha = band.opacity == null ? 1 : band.opacity;
          ctx.globalCompositeOperation = band.blend || 'source-over';
          if (band.kind === 'raster' && band.source) {
            ctx.drawImage(band.source, band.x || 0, band.y || 0, band.w || band.source.width, band.h || band.source.height);
          } else if (band.kind === 'path' && band.points && band.points.length) {
            ctx.beginPath();
            ctx.moveTo(band.points[0].x, band.points[0].y);
            for (var pointIndex = 1; pointIndex < band.points.length; pointIndex++) ctx.lineTo(band.points[pointIndex].x, band.points[pointIndex].y);
            ctx.strokeStyle = band.stroke || band.fill || params.ink;
            ctx.lineWidth = band.strokeWidth || 1;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            if (band.dash && ctx.setLineDash) ctx.setLineDash(band.dash);
            ctx.stroke();
          } else {
            traceSceneShape(ctx, band);
            if (band.shape === 'line' || band.shape === 'ring') {
              ctx.strokeStyle = band.stroke || band.fill;
              ctx.lineWidth = Math.max(0.75, band.strokeWidth || Math.min(band.w, band.h) * 0.12);
              ctx.stroke();
            } else {
              ctx.fillStyle = band.fill;
              ctx.fill();
              if (band.stroke && band.strokeWidth > 0) {
                ctx.strokeStyle = band.stroke;
                ctx.lineWidth = band.strokeWidth;
                ctx.stroke();
              }
            }
          }
          ctx.restore();
        }
        ctx.restore();
      }

      /* ---------------- composition v6: fixed-order FX scene pipeline ----------------
         Effects are compiled into the scene instead of being painted as a
         preview-only overlay. The same glyph/path/shape IR therefore reaches
         preview, screenshot, PNG, video and SVG. compositionState.fxRack is
         intentionally read defensively so older projects and partially
         migrated v6 projects remain renderable while the new UI is developed. */
      function compositionFxModule(primary, aliases) {
        var rack = compositionState && (compositionState.fxRack || compositionState.fx);
        if (!rack || typeof rack !== 'object') return null;
        if (rack[primary] && typeof rack[primary] === 'object') return rack[primary];
        aliases = aliases || [];
        for (var i = 0; i < aliases.length; i++) {
          if (rack[aliases[i]] && typeof rack[aliases[i]] === 'object') return rack[aliases[i]];
        }
        return null;
      }

      function fxNumber(module, keys, fallback, min, max) {
        if (!module) return fallback;
        keys = Array.isArray(keys) ? keys : [keys];
        var value;
        for (var i = 0; i < keys.length; i++) {
          if (module[keys[i]] != null) {
            value = Number(module[keys[i]]);
            if (isFinite(value)) break;
          }
        }
        if (!isFinite(value)) value = fallback;
        if (min != null) value = Math.max(min, value);
        if (max != null) value = Math.min(max, value);
        return value;
      }

      function fxEnabled(module) {
        if (!module) return false;
        if (module.enabled != null) return module.enabled === true || module.enabled === 1;
        if (module.on != null) return module.on === true || module.on === 1;
        return fxNumber(module, ['amount', 'intensity', 'mix'], 0, 0, 1) > 0.0005;
      }

      function compositionFxBudget(qualityMode) {
        var compact = window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
        if (qualityMode === 'export') return compact ? 24000 : 48000;
        var quality = compositionEffectiveQuality();
        if (quality === 'performance') return compact ? 4200 : 9000;
        if (quality === 'high') return compact ? 9000 : 22000;
        return compact ? 6500 : 16000;
      }

      function copySceneGlyph(glyph) {
        var copy = {};
        for (var key in glyph) if (Object.prototype.hasOwnProperty.call(glyph, key)) copy[key] = glyph[key];
        return copy;
      }

      function copySceneBand(band) {
        var copy = {};
        for (var key in band) if (Object.prototype.hasOwnProperty.call(band, key)) copy[key] = band[key];
        if (band.points) {
          copy.points = band.points.map(function (point) { return { x: point.x, y: point.y }; });
        }
        return copy;
      }

      function transformScenePoint(x, y, cx, cy, scale, rotation, dx, dy) {
        var rad = rotation * Math.PI / 180;
        var cos = Math.cos(rad), sin = Math.sin(rad);
        var px = (x - cx) * scale, py = (y - cy) * scale;
        return {
          x: cx + px * cos - py * sin + dx,
          y: cy + px * sin + py * cos + dy
        };
      }

      function transformSceneGlyph(glyph, width, height, transform, alpha, marker) {
        var copy = copySceneGlyph(glyph);
        var cx = width / 2, cy = height / 2;
        var point = transformScenePoint(
          glyph.ox + (glyph.tx || 0), glyph.oy + (glyph.ty || 0),
          cx, cy, transform.scale, transform.rotation, transform.dx, transform.dy
        );
        copy.tx = point.x - glyph.ox;
        copy.ty = point.y - glyph.oy;
        copy.rot = (glyph.rot || 0) + transform.rotation;
        copy.scaleX = glyph.scaleX * transform.scale;
        copy.scaleY = glyph.scaleY * transform.scale;
        copy.opacity = Math.max(0, Math.min(1, (glyph.opacity == null ? 1 : glyph.opacity) * alpha));
        copy.fxPass = marker;
        return copy;
      }

      function transformSceneBand(band, width, height, transform, alpha, marker) {
        var copy = copySceneBand(band);
        var cx = width / 2, cy = height / 2;
        if (copy.kind === 'path' && copy.points) {
          copy.points = copy.points.map(function (point) {
            return transformScenePoint(point.x, point.y, cx, cy, transform.scale, transform.rotation, transform.dx, transform.dy);
          });
          copy.strokeWidth = Math.max(0.1, (copy.strokeWidth || 1) * Math.abs(transform.scale));
        } else {
          var center = transformScenePoint(
            copy.x + copy.w / 2, copy.y + copy.h / 2,
            cx, cy, transform.scale, transform.rotation, transform.dx, transform.dy
          );
          copy.w *= Math.abs(transform.scale);
          copy.h *= Math.abs(transform.scale);
          copy.x = center.x - copy.w / 2;
          copy.y = center.y - copy.h / 2;
          copy.rotation = (copy.rotation || 0) + transform.rotation;
          if (copy.strokeWidth) copy.strokeWidth *= Math.abs(transform.scale);
        }
        copy.opacity = Math.max(0, Math.min(1, (band.opacity == null ? 1 : band.opacity) * alpha));
        copy.fxPass = marker;
        return copy;
      }

      function appendTransformedScenePass(scene, sourceGlyphs, sourceBands, transform, alpha, marker, budget) {
        var room = Math.max(0, budget - (scene._basePrimitiveCount || 0) - scene.glyphs.length - scene.bands.length);
        if (!room || alpha <= 0.001) return;
        for (var bi = 0; bi < sourceBands.length && room > 0; bi++, room--) {
          scene.bands.push(transformSceneBand(sourceBands[bi], scene.width, scene.height, transform, alpha, marker));
        }
        for (var gi = 0; gi < sourceGlyphs.length && room > 0; gi++, room--) {
          scene.glyphs.push(transformSceneGlyph(sourceGlyphs[gi], scene.width, scene.height, transform, alpha, marker));
        }
        if (room <= 0) scene.limited = true;
      }

      function applyEchoTrailFx(scene, module, budget) {
        if (!fxEnabled(module)) return scene;
        var amount = fxNumber(module, ['amount', 'intensity', 'mix'], 0.5, 0, 1);
        var requested = fxNumber(module, ['count', 'echoes', 'passes'], 4, 1, 16);
        var count = Math.max(1, Math.round(requested));
        var decay = fxNumber(module, 'decay', 0.68, 0.05, 0.98);
        var distance = fxNumber(module, ['distance', 'offset', 'spacing'], 12, -240, 240);
        var angle = fxNumber(module, 'angle', 0, -360, 360) * Math.PI / 180;
        var scaleStep = fxNumber(module, ['scale', 'zoom'], 0.018, -0.2, 0.2);
        var rotationStep = fxNumber(module, ['rotation', 'rotate'], 2, -45, 45);
        var phaseSpacing = fxNumber(module, ['phaseSpacing', 'phase'], 0.08, -1, 1);
        var phase = (((compositionState.phase || 0) % 1) + 1) % 1;
        var sourceGlyphs = scene.glyphs.slice();
        var sourceBands = scene.bands.slice();
        var effectGlyphs = [], effectBands = [];
        var target = {
          glyphs: effectGlyphs, bands: effectBands,
          width: scene.width, height: scene.height, limited: scene.limited,
          _basePrimitiveCount: scene.glyphs.length + scene.bands.length
        };
        for (var pass = count; pass >= 1; pass--) {
          var phaseAngle = Math.PI * 2 * (phase + pass * phaseSpacing);
          var passDistance = distance * pass * amount;
          appendTransformedScenePass(target, sourceGlyphs, sourceBands, {
            dx: Math.cos(angle + phaseAngle) * passDistance,
            dy: Math.sin(angle + phaseAngle) * passDistance,
            scale: Math.max(0.05, 1 + scaleStep * pass * amount),
            rotation: rotationStep * pass * amount
          }, amount * Math.pow(decay, pass), 'echoTrail', budget);
        }
        scene.glyphs = effectGlyphs.concat(scene.glyphs);
        scene.bands = effectBands.concat(scene.bands);
        scene.limited = scene.limited || target.limited;
        return scene;
      }

      function applyFeedbackFx(scene, module, budget) {
        if (!fxEnabled(module)) return scene;
        var amount = fxNumber(module, ['amount', 'intensity', 'mix'], 0.42, 0, 1);
        var persistence = fxNumber(module, ['persistence', 'decay'], 0.72, 0.05, 0.98);
        var requested = fxNumber(module, ['passes', 'count', 'echoes'], 5, 1, 14);
        var count = Math.max(1, Math.round(requested));
        var zoom = fxNumber(module, ['zoom', 'scale'], 0.04, -0.2, 0.2);
        var rotation = fxNumber(module, ['rotation', 'rotate'], 3, -45, 45);
        var warp = fxNumber(module, 'warp', 0, 0, 1);
        var phase = (((compositionState.phase || 0) % 1) + 1) % 1;
        var phaseAngle = phase * Math.PI * 2;
        var sourceGlyphs = scene.glyphs.slice();
        var sourceBands = scene.bands.slice();
        var effectGlyphs = [], effectBands = [];
        var target = {
          glyphs: effectGlyphs, bands: effectBands,
          width: scene.width, height: scene.height, limited: scene.limited,
          _basePrimitiveCount: scene.glyphs.length + scene.bands.length
        };
        for (var pass = count; pass >= 1; pass--) {
          var loopWarp = Math.sin(phaseAngle + pass * 1.618) * warp;
          appendTransformedScenePass(target, sourceGlyphs, sourceBands, {
            dx: Math.cos(phaseAngle + pass * 0.73) * loopWarp * scene.width * 0.025 * pass,
            dy: Math.sin(phaseAngle - pass * 0.61) * loopWarp * scene.height * 0.025 * pass,
            scale: Math.max(0.05, 1 + zoom * pass * amount),
            rotation: rotation * pass * amount + loopWarp * 8
          }, amount * Math.pow(persistence, pass), 'feedback', budget);
        }
        scene.glyphs = effectGlyphs.concat(scene.glyphs);
        scene.bands = effectBands.concat(scene.bands);
        scene.limited = scene.limited || target.limited;
        return scene;
      }

      function hexLuminance(color) {
        if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return 0.5;
        var r = parseInt(color.slice(1, 3), 16) / 255;
        var g = parseInt(color.slice(3, 5), 16) / 255;
        var b = parseInt(color.slice(5, 7), 16) / 255;
        return r * 0.2126 + g * 0.7152 + b * 0.0722;
      }

      function applySignalMaskFx(scene, module) {
        if (!fxEnabled(module)) return scene;
        var amount = fxNumber(module, ['amount', 'intensity', 'mix'], 0.5, 0, 1);
        var threshold = fxNumber(module, 'threshold', 0.5, 0, 1);
        var softness = Math.max(0.02, fxNumber(module, ['softness', 'feather'], 0.2, 0, 1));
        var mode = module.mode || module.mask || 'text';
        var phase = (((compositionState.phase || 0) % 1) + 1) % 1 * Math.PI * 2;
        function fieldAt(x, y) {
          var wave = 0.5 + 0.25 * Math.sin(phase + x / Math.max(1, scene.width) * Math.PI * 4)
            + 0.25 * Math.cos(phase - y / Math.max(1, scene.height) * Math.PI * 4);
          return Math.max(0, Math.min(1, (wave - threshold + softness) / (softness * 2)));
        }
        for (var gi = 0; gi < scene.glyphs.length; gi++) {
          var glyph = scene.glyphs[gi];
          var glyphAlpha = 1;
          if (mode === 'inverseText' || mode === 'inverse-text' || mode === 'inverse') glyphAlpha = 1 - amount;
          else if (mode === 'field') glyphAlpha = 1 - amount + amount * fieldAt(glyph.ox + (glyph.tx || 0), glyph.oy + (glyph.ty || 0));
          else if (mode === 'luma') glyphAlpha = 1 - amount + amount * (hexLuminance(glyph.fill || params.ink) >= threshold ? 1 : softness);
          glyph.opacity = Math.max(0, Math.min(1, (glyph.opacity == null ? 1 : glyph.opacity) * glyphAlpha));
        }
        for (var bi = 0; bi < scene.bands.length; bi++) {
          var band = scene.bands[bi];
          var bandAlpha = mode === 'text' ? 1 - amount : 1;
          var bx = band.kind === 'path' && band.points && band.points.length ? band.points[0].x : band.x + band.w / 2;
          var by = band.kind === 'path' && band.points && band.points.length ? band.points[0].y : band.y + band.h / 2;
          if (mode === 'field') bandAlpha = 1 - amount + amount * fieldAt(bx, by);
          else if (mode === 'luma') bandAlpha = 1 - amount + amount * (hexLuminance(band.fill || band.stroke || params.ink) >= threshold ? 1 : softness);
          band.opacity = Math.max(0, Math.min(1, (band.opacity == null ? 1 : band.opacity) * bandAlpha));
        }
        return scene;
      }

      function applyChromaticSplitFx(scene, module, budget) {
        if (!fxEnabled(module)) return scene;
        var amount = fxNumber(module, ['amount', 'intensity', 'mix'], 0.55, 0, 1);
        var distance = fxNumber(module, ['distance', 'offset'], 7, 0, 120) * amount;
        if (distance < 0.01) return scene;
        var angle = fxNumber(module, 'angle', 0, -360, 360) * Math.PI / 180;
        var alpha = fxNumber(module, ['opacity', 'alpha'], 0.72, 0, 1) * amount;
        var blend = module.blend || 'multiply';
        var colorA = /^#[0-9a-f]{6}$/i.test(module.colorA || '') ? module.colorA : (compositionState.color2 || params.accent);
        var colorB = /^#[0-9a-f]{6}$/i.test(module.colorB || '') ? module.colorB : (compositionState.color3 || params.ink);
        var originals = scene.glyphs.slice();
        var passes = [];
        var room = Math.max(0, budget - scene.glyphs.length - scene.bands.length);
        for (var pass = 0; pass < 2 && room > 0; pass++) {
          var sign = pass ? -1 : 1;
          for (var gi = 0; gi < originals.length && room > 0; gi++, room--) {
            var copy = copySceneGlyph(originals[gi]);
            copy.tx = (copy.tx || 0) + Math.cos(angle) * distance * sign;
            copy.ty = (copy.ty || 0) + Math.sin(angle) * distance * sign;
            copy.fill = pass ? colorB : colorA;
            copy.opacity = Math.max(0, Math.min(1, (copy.opacity == null ? 1 : copy.opacity) * alpha));
            copy.fxBlend = blend;
            copy.fxPass = 'chromaticSplit';
            passes.push(copy);
          }
        }
        if (room <= 0) scene.limited = true;
        scene.glyphs = passes.concat(scene.glyphs);
        return scene;
      }

      function quantizeHex(color, steps) {
        if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return color;
        var divisor = Math.max(1, steps - 1);
        var values = [1, 3, 5].map(function (at) {
          var value = parseInt(color.slice(at, at + 2), 16);
          return Math.round(Math.round(value / 255 * divisor) / divisor * 255);
        });
        return '#' + values.map(function (value) { return value.toString(16).padStart(2, '0'); }).join('');
      }

      function applyRasterMaterialFx(scene, module, budget) {
        if (!fxEnabled(module)) return scene;
        var mix = fxNumber(module, ['amount', 'intensity', 'mix'], 1, 0, 1);
        var pixelate = fxNumber(module, ['pixelate', 'pixelation'], 0, 0, 1) * mix;
        var posterize = fxNumber(module, 'posterize', 0, 0, 1) * mix;
        var scanline = fxNumber(module, ['scanline', 'scanlines'], 0, 0, 1) * mix;
        var noise = fxNumber(module, 'noise', 0, 0, 1) * mix;
        var snap = pixelate > 0.001 ? 1 + pixelate * 31 : 0;
        var steps = Math.max(2, Math.round(16 - posterize * 13));
        for (var gi = 0; gi < scene.glyphs.length; gi++) {
          var glyph = scene.glyphs[gi];
          if (snap) {
            var gx = glyph.ox + (glyph.tx || 0), gy = glyph.oy + (glyph.ty || 0);
            glyph.tx = Math.round(gx / snap) * snap - glyph.ox;
            glyph.ty = Math.round(gy / snap) * snap - glyph.oy;
          }
          if (posterize > 0.001) glyph.fill = quantizeHex(glyph.fill || params.ink, steps);
        }
        for (var bi = 0; bi < scene.bands.length; bi++) {
          var band = scene.bands[bi];
          if (snap && band.kind === 'path' && band.points) {
            band.points.forEach(function (point) {
              point.x = Math.round(point.x / snap) * snap;
              point.y = Math.round(point.y / snap) * snap;
            });
          } else if (snap && band.x != null) {
            band.x = Math.round(band.x / snap) * snap;
            band.y = Math.round(band.y / snap) * snap;
            band.w = Math.max(snap, Math.round(band.w / snap) * snap);
            band.h = Math.max(snap, Math.round(band.h / snap) * snap);
          }
          if (posterize > 0.001) {
            if (band.fill) band.fill = quantizeHex(band.fill, steps);
            if (band.stroke) band.stroke = quantizeHex(band.stroke, steps);
          }
        }
        var room = Math.max(0, budget - scene.glyphs.length - scene.bands.length);
        if (scanline > 0.001 && room > 0) {
          var lineGap = Math.max(3, Math.round(18 - scanline * 14));
          var lineCount = Math.min(room, 240, Math.ceil(scene.height / lineGap));
          for (var line = 0; line < lineCount; line++) {
            var y = line * lineGap + (((compositionState.phase || 0) * lineGap) % lineGap);
            scene.bands.push({
              kind: 'path',
              points: [{ x: 0, y: y }, { x: scene.width, y: y }],
              stroke: module.scanlineColor || params.ink,
              strokeWidth: Math.max(0.5, scanline * 1.8),
              opacity: scanline * 0.16,
              blend: module.blend || 'multiply',
              fxPass: 'rasterMaterial'
            });
          }
          room -= lineCount;
        }
        if (noise > 0.001 && room > 0) {
          var noiseCount = Math.min(room, Math.round(24 + noise * 176));
          var phase = (((compositionState.phase || 0) % 1) + 1) % 1 * Math.PI * 2;
          for (var ni = 0; ni < noiseCount; ni++) {
            var seed = (ni + 1) * 12.9898;
            var nx = ((Math.sin(seed * 1.17) * 43758.5453) % 1 + 1) % 1;
            var ny = ((Math.sin(seed * 2.31) * 24634.6345) % 1 + 1) % 1;
            nx = (nx + Math.sin(phase + seed) * noise * 0.025 + 1) % 1;
            ny = (ny + Math.cos(phase - seed) * noise * 0.025 + 1) % 1;
            var size = 0.6 + (((Math.sin(seed * 0.73) * 9758.13) % 1 + 1) % 1) * (1 + noise * 4);
            scene.bands.push({
              kind: 'shape', shape: 'rect',
              x: nx * scene.width, y: ny * scene.height, w: size, h: size,
              fill: ni % 3 ? params.ink : (compositionState.color2 || params.accent),
              opacity: noise * (0.06 + (ni % 7) * 0.008),
              blend: module.blend || 'difference',
              fxPass: 'rasterMaterial'
            });
          }
          room -= noiseCount;
        }
        if (room <= 0) scene.limited = true;
        scene.rasterMaterial = {
          pixelate: pixelate,
          posterize: posterize,
          scanline: scanline,
          noise: noise,
          vectorApproximation: true
        };
        return scene;
      }

      function enforceCompositionPrimitiveBudget(scene, budget) {
        function bandCost(band) {
          if (band && band.kind === 'path' && band.points) return Math.max(1, Math.ceil(band.points.length / 8));
          return 1;
        }
        var rasterCost = (scene.rasterPasses || []).length * 32;
        var total = scene.glyphs.length + rasterCost;
        for (var totalIndex = 0; totalIndex < scene.bands.length; totalIndex++) {
          total += bandCost(scene.bands[totalIndex]);
        }
        if (total <= budget) return scene;
        var available = Math.max(0, budget - rasterCost);
        var keepGlyphs = Math.min(
          scene.glyphs.length,
          scene.bands.length ? Math.floor(available * 0.58) : available
        );
        var room = available - keepGlyphs;
        var keptBands = [];
        for (var bandIndex = scene.bands.length - 1; bandIndex >= 0; bandIndex--) {
          var cost = bandCost(scene.bands[bandIndex]);
          if (cost > room) continue;
          keptBands.unshift(scene.bands[bandIndex]);
          room -= cost;
        }
        if (room > 0) keepGlyphs = Math.min(scene.glyphs.length, keepGlyphs + room);
        scene.bands = keptBands;
        scene.glyphs = scene.glyphs.slice(scene.glyphs.length - keepGlyphs);
        scene.limited = true;
        return scene;
      }

      /* ---------------- optional WebGL2 raster pass ----------------
         Optical Shader and Feedback Chamber keep a deterministic Canvas2D
         scene as their fallback. On WebGL2-capable browsers this transparent
         raster pass is composited behind live glyphs and is also available to
         PNG/video/SVG through the shared Scene IR. */
      var compositionWebGLState = {
        checked: false, available: false, canvas: null, gl: null, program: null,
        position: null, uniforms: null, texture: null, maskCanvas: null,
        maskKey: '', lost: false
      };

      function webglCompositionAvailable() {
        if (compositionWebGLState.checked) return compositionWebGLState.available && !compositionWebGLState.lost;
        compositionWebGLState.checked = true;
        try {
          var probe = document.createElement('canvas');
          compositionWebGLState.available = !!probe.getContext('webgl2', { alpha: true });
        } catch (error) {
          compositionWebGLState.available = false;
        }
        return compositionWebGLState.available;
      }

      function compileCompositionShader(gl, type, source) {
        var shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          var message = gl.getShaderInfoLog(shader) || 'WebGL shader compile failed';
          gl.deleteShader(shader);
          throw new Error(message);
        }
        return shader;
      }

      function ensureCompositionWebGL(width, height) {
        if (!webglCompositionAvailable()) return null;
        var state = compositionWebGLState;
        if (!state.canvas) {
          var canvas = document.createElement('canvas');
          var gl = canvas.getContext('webgl2', {
            alpha: true, premultipliedAlpha: true, antialias: false,
            preserveDrawingBuffer: true
          });
          if (!gl) return null;
          canvas.addEventListener('webglcontextlost', function (event) {
            event.preventDefault();
            state.lost = true;
          });
          canvas.addEventListener('webglcontextrestored', function () {
            state.lost = false; state.program = null; state.texture = null;
          });
          state.canvas = canvas;
          state.gl = gl;
        }
        var targetW = Math.max(32, Math.min(2048, Math.round(width)));
        var targetH = Math.max(32, Math.min(2048, Math.round(height)));
        if (state.canvas.width !== targetW) state.canvas.width = targetW;
        if (state.canvas.height !== targetH) state.canvas.height = targetH;
        var gl = state.gl;
        if (!state.program) {
          var vertexSource = '#version 300 es\n'
            + 'in vec2 a_position; out vec2 v_uv;\n'
            + 'void main(){v_uv=a_position*.5+.5;gl_Position=vec4(a_position,0.,1.);}';
          var fragmentSource = '#version 300 es\n'
            + 'precision highp float; in vec2 v_uv; out vec4 outColor;\n'
            + 'uniform sampler2D u_text; uniform vec2 u_resolution;\n'
            + 'uniform float u_phase,u_mode,u_intensity,u_depth,u_instability;\n'
            + 'uniform float u_zoom,u_rotation,u_decay,u_echoes,u_warp,u_frequency;\n'
            + 'uniform vec3 u_colorA,u_colorB,u_colorC;\n'
            + 'mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}\n'
            + 'void main(){vec2 uv=v_uv;vec2 p=uv-.5;float ink=texture(u_text,uv).a;'
            + 'vec3 col=u_colorA;float alpha=0.;\n'
            + 'if(u_mode>.5){float acc=0.;vec3 spectral=vec3(0.);'
            + 'for(int i=0;i<16;i++){float fi=float(i);if(fi>=u_echoes)break;'
            + 'float sc=pow(max(.82,1.+u_zoom),fi);'
            + 'vec2 q=rot(-(u_rotation*fi+sin(u_phase+fi*.37)*u_warp*.08))*(p/sc);'
            + 'q+=vec2(sin(u_phase+fi*.53),cos(u_phase-fi*.41))*u_warp*.012*fi;'
            + 'float a=texture(u_text,q+.5).a*pow(u_decay,fi);'
            + 'acc+=a;spectral+=mix(u_colorB,u_colorC,fract(fi*.37))*a;}'
            + 'col=mix(u_colorA,spectral/max(.001,acc),clamp(acc,0.,1.));'
            + 'alpha=clamp(acc*(.18+.45*u_intensity),0.,.82);'
            + '}else{float r=length(p);float a=atan(p.y,p.x);'
            + 'float warp=sin(a*6.+u_phase)*u_warp*.18;'
            + 'float f=sin((r+warp)*u_frequency*28.-u_phase*2.);'
            + 'f+=cos((p.x-p.y)*u_frequency*8.+u_phase);'
            + 'f+=sin((p.x+p.y)*u_frequency*11.-u_phase);f/=3.;'
            + 'float contour=smoothstep(.18,.02,abs(fract(f*4.)-.5));'
            + 'float glow=smoothstep(.65,.05,abs(f));'
            + 'col=mix(u_colorA,u_colorB,.5+.5*f);col=mix(col,u_colorC,contour*.55);'
            + 'alpha=(.05+contour*.28+glow*.1+ink*.22)*(.35+.65*u_intensity);}'
            + 'alpha*=smoothstep(.86,.38,length(p));outColor=vec4(col*alpha,alpha);}';
          var vertex = compileCompositionShader(gl, gl.VERTEX_SHADER, vertexSource);
          var fragment = compileCompositionShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
          var program = gl.createProgram();
          gl.attachShader(program, vertex); gl.attachShader(program, fragment);
          gl.linkProgram(program);
          gl.deleteShader(vertex); gl.deleteShader(fragment);
          if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'WebGL link failed');
          state.program = program;
          state.position = gl.getAttribLocation(program, 'a_position');
          state.uniforms = {};
          ['u_text', 'u_resolution', 'u_phase', 'u_mode', 'u_intensity', 'u_depth',
            'u_instability', 'u_zoom', 'u_rotation', 'u_decay', 'u_echoes',
            'u_warp', 'u_frequency', 'u_colorA', 'u_colorB', 'u_colorC'
          ].forEach(function (name) { state.uniforms[name] = gl.getUniformLocation(program, name); });
          var buffer = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
          gl.enableVertexAttribArray(state.position);
          gl.vertexAttribPointer(state.position, 2, gl.FLOAT, false, 0, 0);
          state.texture = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, state.texture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        }
        return state;
      }

      function webglHexColor(hex) {
        if (!/^#[0-9a-f]{6}$/i.test(hex || '')) hex = '#17140f';
        return [
          parseInt(hex.slice(1, 3), 16) / 255,
          parseInt(hex.slice(3, 5), 16) / 255,
          parseInt(hex.slice(5, 7), 16) / 255
        ];
      }

      function updateCompositionWebGLTextTexture(state) {
        var gl = state.gl;
        var maskSize = 1024;
        var key = textInput.value + '|' + params.fontFamily + '|' + params.fontWeight + '|' + params.vertical;
        if (state.maskKey === key && state.maskCanvas) return;
        state.maskKey = key;
        if (!state.maskCanvas) state.maskCanvas = document.createElement('canvas');
        var canvas = state.maskCanvas;
        canvas.width = maskSize; canvas.height = maskSize;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, maskSize, maskSize);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var clean = textInput.value.replace(/\s+/g, ' ').trim() || 'TYPE';
        var size = Math.max(20, Math.min(180, maskSize / Math.max(5, Math.sqrt(clean.length) * 1.7)));
        ctx.font = params.fontWeight + ' ' + size + 'px ' + params.fontFamily;
        var lines = [];
        var cursor = '';
        for (var i = 0; i < clean.length; i++) {
          var next = cursor + clean[i];
          if (ctx.measureText(next).width > maskSize * 0.82 && cursor) { lines.push(cursor); cursor = clean[i]; }
          else cursor = next;
        }
        if (cursor) lines.push(cursor);
        lines = lines.slice(0, Math.max(1, Math.floor(maskSize / (size * 1.2))));
        var startY = maskSize * 0.5 - (lines.length - 1) * size * 0.58;
        lines.forEach(function (line, index) { ctx.fillText(line, maskSize * 0.5, startY + index * size * 1.16); });
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, state.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      }

      function renderCompositionWebGLPass(scene) {
        var useFeedback = compositionState.type === 'feedbackChamber';
        var useOptical = compositionState.type === 'cascade' && compositionState.cascade.system === 'sdf';
        if ((!useFeedback && !useOptical) || !webglCompositionAvailable()) return null;
        try {
          var state = ensureCompositionWebGL(scene.width, scene.height);
          if (!state) return null;
          var gl = state.gl, uniforms = state.uniforms;
          gl.viewport(0, 0, state.canvas.width, state.canvas.height);
          gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
          gl.useProgram(state.program);
          updateCompositionWebGLTextTexture(state);
          gl.uniform1i(uniforms.u_text, 0);
          gl.uniform2f(uniforms.u_resolution, state.canvas.width, state.canvas.height);
          var shaderTurn = (((compositionState.phase || 0) % 1) + 1) % 1;
          gl.uniform1f(uniforms.u_phase, shaderTurn * Math.PI * 2);
          gl.uniform1f(uniforms.u_mode, useFeedback ? 1 : 0);
          gl.uniform1f(uniforms.u_intensity, compositionState.macros.intensity);
          gl.uniform1f(uniforms.u_depth, compositionState.macros.depth);
          gl.uniform1f(uniforms.u_instability, compositionState.macros.instability);
          var feedback = compositionState.feedbackChamber;
          var optical = compositionState.cascade;
          gl.uniform1f(uniforms.u_zoom, useFeedback ? feedback.zoom : 0);
          gl.uniform1f(uniforms.u_rotation, (useFeedback ? feedback.rotation : optical.chromatic * 8) * Math.PI / 180);
          gl.uniform1f(uniforms.u_decay, useFeedback ? feedback.decay : 0.72);
          gl.uniform1f(uniforms.u_echoes, useFeedback ? Math.min(16, feedback.echoes) : Math.min(16, optical.contours));
          gl.uniform1f(uniforms.u_warp, useFeedback ? feedback.warpAmount : optical.warp);
          gl.uniform1f(uniforms.u_frequency, useFeedback ? 7 : optical.frequency);
          var colorA = webglHexColor(params.ink), colorB = webglHexColor(params.accent), colorC = webglHexColor(compositionState.color2);
          gl.uniform3fv(uniforms.u_colorA, colorA); gl.uniform3fv(uniforms.u_colorB, colorB); gl.uniform3fv(uniforms.u_colorC, colorC);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          return {
            kind: 'raster', source: state.canvas, x: 0, y: 0,
            w: scene.width, h: scene.height,
            opacity: useFeedback ? 0.82 : 0.72,
            blend: useFeedback ? 'screen' : 'difference',
            webgl: true
          };
        } catch (error) {
          compositionWebGLState.available = false;
          return null;
        }
      }

      function applyCompositionFxRack(scene, width, height, qualityMode) {
        if (!scene || !compositionState || !compositionState.enabled) return scene;
        if (scene._v6FxApplied) return scene;
        scene.glyphs = scene.glyphs || [];
        scene.bands = scene.bands || [];
        scene.width = Math.max(1, width || scene.width || 1);
        scene.height = Math.max(1, height || scene.height || 1);
        var budget = compositionFxBudget(qualityMode);
        // Contractually fixed order:
        // Engine → Echo/Trail → Feedback → Signal Mask →
        // Chromatic Split → Raster Material → Output.
        applyEchoTrailFx(scene, compositionFxModule('echoTrail', ['echo', 'trail']), budget);
        applyFeedbackFx(scene, compositionFxModule('feedback'), budget);
        applySignalMaskFx(scene, compositionFxModule('signalMask', ['mask']));
        applyChromaticSplitFx(scene, compositionFxModule('chromaticSplit', ['chromatic']), budget);
        applyRasterMaterialFx(scene, compositionFxModule('rasterMaterial', ['raster']), budget);
        enforceCompositionPrimitiveBudget(scene, budget);
        var webglBand = renderCompositionWebGLPass(scene);
        if (webglBand) scene.bands.unshift(webglBand);
        scene.fxOrder = ['echoTrail', 'feedback', 'signalMask', 'chromaticSplit', 'rasterMaterial'];
        scene._v6FxApplied = true;
        return scene;
      }


      /* ---- VJ 描画 + API ---- */
      // 元エディタでは misregColorA/B は params 直下 — VJ P にも同名キーがあるのでそのまま解決される
      function drawGlyphs(ctx, glyphs, scale, L, fm, useVisualOpacity) {
        var font = params.fontWeight + ' ' + params.fontSize + 'px ' + TD._fontStack(params.fontFamily);
        for (var i = 0; i < glyphs.length; i++) {
          var g = glyphs[i];
          var drawPass = function (offsetX, offsetY, color, alpha, blend) {
            ctx.setTransform(scale, 0, 0, scale, 0, 0);
            ctx.translate(L.dx, L.dy);
            ctx.scale(L.s, L.s);
            ctx.translate(offsetX || 0, offsetY || 0);
            ctx.translate(g.ox + g.tx, g.oy + g.ty);
            ctx.rotate((g.rot || 0) * Math.PI / 180);
            ctx.transform(1, Math.tan((g.skewY || 0) * Math.PI / 180), Math.tan((g.skewX || 0) * Math.PI / 180), 1, 0, 0);
            ctx.scale(g.scaleX, g.scaleY);
            ctx.translate(-g.ox, -g.oy);
            ctx.globalAlpha = ((useVisualOpacity || g.composition) ? g.opacity : 1) * alpha;
            ctx.globalCompositeOperation = typeof blend === 'string' ? blend : (blend ? 'multiply' : 'source-over');
            ctx.font = font;
            ctx.fillStyle = color;
            if (params.vertical) {
              var cx = g.x + g.w / 2, cy = g.y + g.h / 2;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              if (!g.upright) { ctx.translate(cx, cy); ctx.rotate(Math.PI / 2); ctx.fillText(g.ch, 0, 0); }
              else ctx.fillText(g.ch, cx, cy);
            } else {
              ctx.textAlign = g.grid ? 'center' : 'left';
              ctx.textBaseline = 'alphabetic';
              ctx.fillText(g.ch, g.grid ? g.x + g.w / 2 : g.x, g.y + baselineOffset(g, fm));
            }
          };
          var hasMisreg = Math.abs(g.misregX) > 0.001 || Math.abs(g.misregY) > 0.001;
          if (hasMisreg) drawPass(g.misregX, g.misregY, params.misregColorA, 0.72, true);
          drawPass(0, 0, g.fill || (g.accent ? params.accent : params.ink), 1, g.fxBlend || false);
          if (hasMisreg) drawPass(-g.misregX * 0.65, -g.misregY * 0.65, params.misregColorB, 0.72, true);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }

      // 1フレーム分のシーンを生成して VJ の 2D canvas に描く (レイアウトは全面 1:1)
      function renderCompositionToCtx(ctx, w, h){
        var started = performance.now();
        compositionPreviewLayout = { w: w, h: h, s: 1, dx: 0, dy: 0 };
        compositionScene = applyCompositionFxRack(
          generateCompositionScene(Math.max(1, w), Math.max(1, h), 'preview'),
          Math.max(1, w), Math.max(1, h), 'preview');
        drawSceneBands(ctx, compositionScene.bands, 1, compositionPreviewLayout);
        drawGlyphs(ctx, compositionScene.glyphs, 1, compositionPreviewLayout, fontMetrics(), true);
        updateCompositionAutoQuality(performance.now() - started);
      }

      /* ---- 永続化: md 単位 (TD_MD_STYLE_KEYS の 'comp' → vj.textdeform.mdStyles)。
       * 旧グローバル保存キーは廃止。 ---- */
      try{ localStorage.removeItem('vj.textdeform.comp'); }catch(e){}

      // comp を持たない md プリセットへデフォルト値を書き込む (全 md が明示的に comp を持つ)。
      // TextDeform.init の _captureMdBaseStyles より先に走るので、これがリセット時の基準になる。
      (function seedCompDefaults(){
        var presets = TD.presets || [];
        for(var i = 0; i < presets.length; i++){
          var pr = presets[i];
          pr.p = pr.p || {};
          if(!pr.p.comp){
            var d = cloneCompositionDefaults();
            delete d.quality;
            pr.p.comp = d;
          }
        }
      })();

      window.TDComp = {
        defs: COMPOSITION_DEFS,
        get(){ return compositionState; },
        enabled(){ return !!compositionState.enabled; },
        // 部分更新 (macros/fxRack は1段深くマージ)。位相は維持。
        set(over){
          var merged = cloneCompositionState();
          over = over || {};
          for(var k in over){
            if(k === 'macros') merged.macros = Object.assign({}, merged.macros, over.macros);
            else if(k === 'fxRack'){
              for(var f in over.fxRack) merged.fxRack[f] = Object.assign({}, merged.fxRack[f], over.fxRack[f]);
            }
            else merged[k] = over[k];
          }
          var phase = compositionState.phase;
          compositionState = normalizeComposition(merged);
          compositionState.phase = phase;
        },
        // md の読み込み時に呼ぶ: 保存された comp があれば復元、無ければデフォルト(Off)。位相は維持
        applyMd(raw){
          var phase = compositionState.phase;
          compositionState = raw ? normalizeComposition(raw) : cloneCompositionDefaults();
          compositionState.phase = phase;
        },
        // md へ保存する用のスナップショット (quality 抜き)
        snapshot(){ return persistentCompositionState(); },
        // dt 秒ぶん位相を進める。pulse(ビート脈動)は入力バスの pressure へ
        advance(dt, pulse){
          TD._compPulse = Math.max(0, Math.min(1, (pulse || 1) - 1 + 0.35));
          if(!compositionState.enabled) return;
          var dir = compositionState.direction === -1 ? -1 : 1;
          compositionState.phase = ((compositionState.phase + dt * compositionState.speed * dir) % 1 + 1) % 1;
        },
        render(ctx, w, h){ renderCompositionToCtx(ctx, w, h); }
      };
})();
