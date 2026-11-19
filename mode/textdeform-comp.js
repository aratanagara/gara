/* ================= Type Deformer — Composition (上流 0.3 = Compose v10) =================
 * synomare/type-deformer の Composition を TextDeform の 2D パイプラインへ組み込む。
 * 生成 (8 エンジン: Field / Flux Rows / Cascade / Contour Atlas / Feedback Chamber /
 * Type Matrix / Path Loom / Glyph Vessel) と FX ラック・Signal Router は上流の
 * render-engine.js (mode/typedeformer/、MIT) をメインスレッドで動かす (On にした時点で読み込む)。
 * このファイルは状態 (上流 editor の COMPOSITION_DEFAULTS / normalizeComposition を移植)、
 * 入力バス (VJ: 仮想ポインタ + ビートの脈動)、描画 (帯 + 文字インスタンス) と TDComp API。
 * phase は TextDeform.update() から自動進行。状態は md 単位 (pr.p.comp) — loadPreset が
 * TDComp.applyMd() で適用し、保存の無い md ではデフォルト(Off)へ戻る。永続化は「デフォルト保存」経由。
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
function fontMetrics(){ return TD._fontMetrics(TD.ctx); }
function baselineOffset(g, fm){
  const leading = g.h - (fm.ascent + fm.descent);
  return leading/2 + fm.ascent;
}
// TextDeform の glyph snapshot を元エディタの snapshotGlyphs 形式へ変換。
// ソース座標はステージ左上基準なので、版面をシーン中央へ平行移動して渡す
// (source 位置を直接使うエンジン = contourAtlas / feedbackChamber の構図が中央に来る)。
function snapshotGlyphs(forceAll){
  const src = TD._snapshotGlyphs(TD._readFx());
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
  return src.map(g => TD._upstreamGlyph(g, offX, offY));
}

      var COMPOSITION_DEFS = {
        field: { id: 'field', label: 'Field' },
        fluxRows: { id: 'fluxRows', label: 'Flux Rows' },
        cascade: { id: 'cascade', label: 'Cascade' },
        contourAtlas: { id: 'contourAtlas', label: 'Contour Atlas' },
        feedbackChamber: { id: 'feedbackChamber', label: 'Feedback Chamber' },
        typeMatrix: { id: 'typeMatrix', label: 'Type Matrix' },
        pathLoom: { id: 'pathLoom', label: 'Path Loom' },
        glyphVessel: { id: 'glyphVessel', label: 'Glyph Vessel' }
      };
      var COMPOSITION_ENGINE_GUIDES = {
        field: 'Field — 文字をベクトル場の流れへ配置します。',
        fluxRows: 'Flux Rows — 原文の順序を保ちながら、行・帯・反対流へ展開します。',
        cascade: 'Cascade — 文字信号をセル・回路・干渉・光学場へ変換します。',
        contourAtlas: 'Contour Atlas — 字形を地形として読み、等高線と領域へ展開します。',
        feedbackChamber: 'Feedback Chamber — 文字を再注入し、再帰的な残像と鏡像を作ります。',
        typeMatrix: 'Type Matrix — 順序・頻度・文字種から編集的レイアウトを組みます。',
        pathLoom: 'Path Loom — 複数の編集可能な経路へ文字を組版します。',
        glyphVessel: 'Glyph Vessel — 文字・語・句を字形や画像の器へ充填します。'
      };
      // The registry is populated after the generator functions have been
      // declared. Keeping the public name here lets UI, export and plug-in code
      // discover the v9 engine contract without depending on declaration order.
      var COMPOSITION_ENGINES = {};
      var COMPOSITION_DEFAULTS = {
        schemaVersion: 10,
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
        signalRouter: [
          { enabled: false, source: 'sourceOrder', shape: 'sine', range: 'bipolar', target: 'y', amount: 1, frequency: 1, phase: 0, motion: 0, steps: 6, color: '#c41f1f' },
          { enabled: false, source: 'unicode', shape: 'steps', range: 'bipolar', target: 'scaleX', amount: 1, frequency: 4, phase: 0, motion: 0, steps: 7, color: '#1767a6' },
          { enabled: false, source: 'radius', shape: 'pulse', range: 'unipolar', target: 'color', amount: 1, frequency: 2, phase: 0, motion: 1, steps: 4, color: '#d0a000' }
        ],
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
        },
        typeMatrix: {
          grammar: 'editorial', signal: 'order', reading: 'row',
          columns: 6, rows: 8,
          minScale: 0.28, maxScale: 2.8, span: 0.62,
          emphasis: 0.72, alignment: 'alternate', copies: 1,
          margin: 0.07, gutter: 0.08,
          voidX: 0.55, voidY: 0.46, voidSize: 0.26,
          collision: 0.45, rotation: 8, jitter: 0.12,
          morph: 0.4, colorMode: 'script', guides: 'frame',
          guideOpacity: 0.2, preset: 'editorialSignal'
        },
        pathLoom: {
          grammar: 'ribbon', strands: 3, copies: 1,
          flow: 'alternate', orientation: 'tangent', spacingMode: 'fit',
          spacing: 1, start: 0, length: 0.92,
          travel: 1, loop: true, flip: 'none',
          push: 0, spread: 0.6, amplitude: 0.65, turns: 2.5,
          weave: 0.35, scale: 0.9, scalePulse: 0.22,
          collision: 0.85, smoothing: 0.6,
          guides: 'path', guideOpacity: 0.18, colorMode: 'strand',
          customPath: [], preset: 'editorialBend'
        },
        glyphVessel: {
          source: 'glyph', vesselGlyph: 'あ', holes: 2, holeSize: 0.16,
          imageData: '', imageWidth: 0, imageHeight: 0, imageName: '',
          mode: 'tight', unit: 'glyph', count: 620,
          minScale: 0.05, maxScale: 3.2, gap: -0.1,
          relaxation: 40, rotation: 20, jitter: 0.18,
          threshold: 0.42, invert: false, gamma: 1, edgePull: 0.65,
          sizeSignal: 'order', orientation: 'free',
          motion: 'still', motionAmount: 0.45, motionSpeed: 1,
          colorMode: 'order', colorA: '#17140f', colorB: '#1767a6', colorC: '#d0a000',
          guides: 'outline', guideOpacity: 0.18, preset: 'counterformPress'
        }
      };

      var SIGNAL_SOURCE_LABELS = {
        sourceOrder: 'Source order', instanceOrder: 'Instance order', unicode: 'Unicode hash',
        frequency: 'Character frequency', script: 'Character class', ink: 'Ink width',
        x: 'X position', y: 'Y position', radius: 'Radius', pointer: 'Pointer distance'
      };
      var SIGNAL_TARGET_LABELS = {
        x: 'X position', y: 'Y position', rotation: 'Rotation', scale: 'Scale',
        scaleX: 'Width', scaleY: 'Height', skewX: 'Skew X', skewY: 'Skew Y',
        opacity: 'Opacity gate', color: 'Color mix'
      };

      function cloneCompositionDefaults() {
        return JSON.parse(JSON.stringify(COMPOSITION_DEFAULTS));
      }

      function normalizeComposition(raw) {
        var out = cloneCompositionDefaults();
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
        var numericPaths = new Map();
        function indexNumericPaths(value,path,depth) {
          if (!value || typeof value !== 'object' || depth>4) return;
          numericPaths.set(value,path);
          Object.keys(value).forEach(function(key){ indexNumericPaths(value[key],path?path+'.'+key:key,depth+1); });
        }
        indexNumericPaths(raw,'',0);
        function number(source, key, min, max, fallback, integer) {
          var value = Number(source && source[key]);
          if (!isFinite(value)) value = fallback;
          var prefix=numericPaths.get(source),parameterKey='composition.'+(prefix?prefix+'.':'')+key;
          if (globalThis.TypeDeformerParameters && globalThis.TypeDeformerParameters.definitions[parameterKey]) return globalThis.TypeDeformerParameters.normalize(parameterKey,value,fallback,min,max,integer);
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
        out.schemaVersion = 10;
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
        var rawSignalRouter = Array.isArray(raw.signalRouter) ? raw.signalRouter : [];
        for (var signalIndex = 0; signalIndex < out.signalRouter.length; signalIndex++) {
          var signal = rawSignalRouter[signalIndex];
          var signalDefault = out.signalRouter[signalIndex];
          signalDefault.enabled = bool(signal, 'enabled', signalDefault.enabled);
          signalDefault.source = choice(signal, 'source', ['sourceOrder', 'instanceOrder', 'unicode', 'frequency', 'script', 'ink', 'x', 'y', 'radius', 'pointer'], signalDefault.source);
          signalDefault.shape = choice(signal, 'shape', ['ramp', 'sine', 'triangle', 'steps', 'pulse', 'noise'], signalDefault.shape);
          signalDefault.range = choice(signal, 'range', ['unipolar', 'bipolar', 'inverse'], signalDefault.range);
          signalDefault.target = choice(signal, 'target', ['x', 'y', 'rotation', 'scale', 'scaleX', 'scaleY', 'skewX', 'skewY', 'opacity', 'color'], signalDefault.target);
          signalDefault.amount = number(signal, 'amount', -4, 4, signalDefault.amount, false);
          signalDefault.frequency = number(signal, 'frequency', 0.125, 32, signalDefault.frequency, false);
          signalDefault.phase = number(signal, 'phase', 0, 1, signalDefault.phase, false);
          signalDefault.motion = number(signal, 'motion', -8, 8, signalDefault.motion, true);
          signalDefault.steps = number(signal, 'steps', 2, 32, signalDefault.steps, true);
          signalDefault.color = color(signal, 'color', signalDefault.color);
        }
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

        var matrix = raw.typeMatrix;
        out.typeMatrix.grammar = choice(matrix, 'grammar', ['editorial', 'modular', 'perimeter', 'tension'], out.typeMatrix.grammar);
        out.typeMatrix.signal = choice(matrix, 'signal', ['order', 'frequency', 'script', 'ink'], out.typeMatrix.signal);
        out.typeMatrix.reading = choice(matrix, 'reading', ['row', 'snake', 'vertical', 'reverse'], out.typeMatrix.reading);
        out.typeMatrix.columns = number(matrix, 'columns', 2, 18, out.typeMatrix.columns, true);
        out.typeMatrix.rows = number(matrix, 'rows', 2, 24, out.typeMatrix.rows, true);
        out.typeMatrix.minScale = number(matrix, 'minScale', 0.05, 2, out.typeMatrix.minScale, false);
        out.typeMatrix.maxScale = number(matrix, 'maxScale', 0.5, 8, out.typeMatrix.maxScale, false);
        if (out.typeMatrix.maxScale < out.typeMatrix.minScale) out.typeMatrix.maxScale = out.typeMatrix.minScale;
        out.typeMatrix.span = number(matrix, 'span', 0, 1, out.typeMatrix.span, false);
        out.typeMatrix.emphasis = number(matrix, 'emphasis', 0, 1, out.typeMatrix.emphasis, false);
        out.typeMatrix.alignment = choice(matrix, 'alignment', ['start', 'center', 'end', 'alternate'], out.typeMatrix.alignment);
        out.typeMatrix.copies = number(matrix, 'copies', 1, 8, out.typeMatrix.copies, true);
        out.typeMatrix.margin = number(matrix, 'margin', 0, 0.35, out.typeMatrix.margin, false);
        out.typeMatrix.gutter = number(matrix, 'gutter', 0, 0.5, out.typeMatrix.gutter, false);
        out.typeMatrix.voidX = number(matrix, 'voidX', 0, 1, out.typeMatrix.voidX, false);
        out.typeMatrix.voidY = number(matrix, 'voidY', 0, 1, out.typeMatrix.voidY, false);
        out.typeMatrix.voidSize = number(matrix, 'voidSize', 0, 0.9, out.typeMatrix.voidSize, false);
        out.typeMatrix.collision = number(matrix, 'collision', 0, 1, out.typeMatrix.collision, false);
        out.typeMatrix.rotation = number(matrix, 'rotation', 0, 180, out.typeMatrix.rotation, false);
        out.typeMatrix.jitter = number(matrix, 'jitter', 0, 1.5, out.typeMatrix.jitter, false);
        out.typeMatrix.morph = number(matrix, 'morph', 0, 1, out.typeMatrix.morph, false);
        out.typeMatrix.colorMode = choice(matrix, 'colorMode', ['ink', 'script', 'frequency', 'order'], out.typeMatrix.colorMode);
        out.typeMatrix.guides = choice(matrix, 'guides', ['none', 'frame', 'cells', 'baseline'], out.typeMatrix.guides);
        out.typeMatrix.guideOpacity = number(matrix, 'guideOpacity', 0, 1, out.typeMatrix.guideOpacity, false);
        out.typeMatrix.preset = choice(matrix, 'preset', ['editorialSignal', 'catalogueIndex', 'counterVoid', 'kineticTension'], out.typeMatrix.preset);

        var pathLoom = raw.pathLoom;
        out.pathLoom.grammar = choice(pathLoom, 'grammar', ['ribbon', 'orbit', 'spiral', 'custom'], out.pathLoom.grammar);
        out.pathLoom.strands = number(pathLoom, 'strands', 1, 12, out.pathLoom.strands, true);
        out.pathLoom.copies = number(pathLoom, 'copies', 1, 8, out.pathLoom.copies, true);
        out.pathLoom.flow = choice(pathLoom, 'flow', ['forward', 'alternate', 'mirror', 'interleave'], out.pathLoom.flow);
        out.pathLoom.orientation = choice(pathLoom, 'orientation', ['tangent', 'upright', 'normal'], out.pathLoom.orientation);
        out.pathLoom.spacingMode = choice(pathLoom, 'spacingMode', ['natural', 'fit', 'stretch'], out.pathLoom.spacingMode);
        out.pathLoom.spacing = number(pathLoom, 'spacing', 0.05, 8, out.pathLoom.spacing, false);
        out.pathLoom.start = number(pathLoom, 'start', -2, 2, out.pathLoom.start, false);
        out.pathLoom.length = number(pathLoom, 'length', 0.05, 2, out.pathLoom.length, false);
        out.pathLoom.travel = number(pathLoom, 'travel', -8, 8, out.pathLoom.travel, true);
        out.pathLoom.loop = bool(pathLoom, 'loop', out.pathLoom.loop);
        out.pathLoom.flip = choice(pathLoom, 'flip', ['none', 'alternate', 'inside'], out.pathLoom.flip);
        out.pathLoom.push = number(pathLoom, 'push', -3, 3, out.pathLoom.push, false);
        out.pathLoom.spread = number(pathLoom, 'spread', -2, 2, out.pathLoom.spread, false);
        out.pathLoom.amplitude = number(pathLoom, 'amplitude', 0, 4, out.pathLoom.amplitude, false);
        out.pathLoom.turns = number(pathLoom, 'turns', 0.25, 16, out.pathLoom.turns, false);
        out.pathLoom.weave = number(pathLoom, 'weave', -4, 4, out.pathLoom.weave, false);
        out.pathLoom.scale = number(pathLoom, 'scale', 0.03, 12, out.pathLoom.scale, false);
        out.pathLoom.scalePulse = number(pathLoom, 'scalePulse', 0, 4, out.pathLoom.scalePulse, false);
        out.pathLoom.collision = number(pathLoom, 'collision', 0, 3, out.pathLoom.collision, false);
        out.pathLoom.smoothing = number(pathLoom, 'smoothing', 0, 1, out.pathLoom.smoothing, false);
        out.pathLoom.guides = choice(pathLoom, 'guides', ['none', 'path', 'rails'], out.pathLoom.guides);
        out.pathLoom.guideOpacity = number(pathLoom, 'guideOpacity', 0, 1, out.pathLoom.guideOpacity, false);
        out.pathLoom.colorMode = choice(pathLoom, 'colorMode', ['ink', 'strand', 'order', 'script'], out.pathLoom.colorMode);
        out.pathLoom.preset = choice(pathLoom, 'preset', ['editorialBend', 'counterBraid', 'orbitChorus', 'kineticCoil', 'handPath'], out.pathLoom.preset);
        var customPath = pathLoom && Array.isArray(pathLoom.customPath) ? pathLoom.customPath : [];
        out.pathLoom.customPath = customPath.slice(0, 96).map(function (point) {
          var pointX = Number(point && point.x), pointY = Number(point && point.y);
          if (!isFinite(pointX) || !isFinite(pointY)) return null;
          return { x: Math.max(0, Math.min(1, pointX)), y: Math.max(0, Math.min(1, pointY)) };
        }).filter(Boolean);

        var vessel = raw.glyphVessel;
        out.glyphVessel.source = choice(vessel, 'source', ['glyph', 'capsule', 'diamond', 'image'], out.glyphVessel.source);
        var vesselGlyph = vessel && typeof vessel.vesselGlyph === 'string'
          ? vessel.vesselGlyph.replace(/[\u0000-\u001f\u007f]/g, '') : out.glyphVessel.vesselGlyph;
        out.glyphVessel.vesselGlyph = Array.from(vesselGlyph).slice(0, 4).join('') || out.glyphVessel.vesselGlyph;
        out.glyphVessel.holes = number(vessel, 'holes', 0, 12, out.glyphVessel.holes, true);
        out.glyphVessel.holeSize = number(vessel, 'holeSize', 0, 0.45, out.glyphVessel.holeSize, false);
        var vesselImageData = vessel && typeof vessel.imageData === 'string' ? vessel.imageData : '';
        out.glyphVessel.imageData = vesselImageData.length <= 12000 && /^[A-Za-z0-9+/=]*$/.test(vesselImageData) ? vesselImageData : '';
        out.glyphVessel.imageWidth = out.glyphVessel.imageData ? number(vessel, 'imageWidth', 1, 96, 64, true) : 0;
        out.glyphVessel.imageHeight = out.glyphVessel.imageData ? number(vessel, 'imageHeight', 1, 96, 64, true) : 0;
        out.glyphVessel.imageName = vessel && typeof vessel.imageName === 'string'
          ? vessel.imageName.slice(0, 120).replace(/[\u0000-\u001f\u007f]/g, '') : '';
        out.glyphVessel.mode = choice(vessel, 'mode', ['tight', 'flow', 'edge', 'density'], out.glyphVessel.mode);
        out.glyphVessel.unit = choice(vessel, 'unit', ['glyph', 'word', 'phrase'], out.glyphVessel.unit);
        out.glyphVessel.count = number(vessel, 'count', 8, 1600, out.glyphVessel.count, true);
        out.glyphVessel.minScale = number(vessel, 'minScale', 0.02, 2, out.glyphVessel.minScale, false);
        out.glyphVessel.maxScale = number(vessel, 'maxScale', 0.1, 8, out.glyphVessel.maxScale, false);
        if (out.glyphVessel.maxScale < out.glyphVessel.minScale) out.glyphVessel.maxScale = out.glyphVessel.minScale;
        out.glyphVessel.gap = number(vessel, 'gap', -0.5, 3, out.glyphVessel.gap, false);
        out.glyphVessel.relaxation = number(vessel, 'relaxation', 0, 96, out.glyphVessel.relaxation, true);
        out.glyphVessel.rotation = number(vessel, 'rotation', 0, 180, out.glyphVessel.rotation, false);
        out.glyphVessel.jitter = number(vessel, 'jitter', 0, 2, out.glyphVessel.jitter, false);
        out.glyphVessel.threshold = number(vessel, 'threshold', 0, 1, out.glyphVessel.threshold, false);
        out.glyphVessel.invert = bool(vessel, 'invert', out.glyphVessel.invert);
        out.glyphVessel.gamma = number(vessel, 'gamma', 0.1, 8, out.glyphVessel.gamma, false);
        out.glyphVessel.edgePull = number(vessel, 'edgePull', -4, 4, out.glyphVessel.edgePull, false);
        out.glyphVessel.sizeSignal = choice(vessel, 'sizeSignal', ['order', 'frequency', 'script', 'ink', 'field'], out.glyphVessel.sizeSignal);
        out.glyphVessel.orientation = choice(vessel, 'orientation', ['free', 'axial', 'edge', 'tangent'], out.glyphVessel.orientation);
        out.glyphVessel.motion = choice(vessel, 'motion', ['still', 'breathe', 'circulate', 'rupture'], out.glyphVessel.motion);
        out.glyphVessel.motionAmount = number(vessel, 'motionAmount', -4, 4, out.glyphVessel.motionAmount, false);
        out.glyphVessel.motionSpeed = number(vessel, 'motionSpeed', -8, 8, out.glyphVessel.motionSpeed, true);
        out.glyphVessel.colorMode = choice(vessel, 'colorMode', ['ink', 'order', 'script', 'field'], out.glyphVessel.colorMode);
        out.glyphVessel.colorA = color(vessel, 'colorA', out.glyphVessel.colorA);
        out.glyphVessel.colorB = color(vessel, 'colorB', out.glyphVessel.colorB);
        out.glyphVessel.colorC = color(vessel, 'colorC', out.glyphVessel.colorC);
        out.glyphVessel.guides = choice(vessel, 'guides', ['none', 'outline', 'distance', 'force'], out.glyphVessel.guides);
        out.glyphVessel.guideOpacity = number(vessel, 'guideOpacity', 0, 1, out.glyphVessel.guideOpacity, false);
        out.glyphVessel.preset = choice(vessel, 'preset', ['counterformPress', 'packedManifesto', 'portraitField', 'edgeAssembly', 'ruptureVessel'], out.glyphVessel.preset);
        return out;
      }

      function cloneCompositionState() {
        return JSON.parse(JSON.stringify(compositionState));
      }

      function persistentCompositionState() {
        var snapshot = cloneCompositionState();
        delete snapshot.quality;
        return snapshot;
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

      // VJ: 音 (app.js の Audio) を Composition へ。量は md の compAudio (デッドゾーンあり)。0 なら null = 従来どおり
      function audioDrive(){
        var a = TD._dp(+TD.P.compAudio || 0);
        if(!(a > 0) || typeof Audio === 'undefined' || !Audio.fft) return null;
        var f = Audio.fft, n = f.length;
        var band = function(lo, hi){
          var s = 0, c = 0;
          for(var i = Math.max(1, Math.floor(n*lo)); i < Math.floor(n*hi); i++){ s += f[i]; c++; }
          return c ? s/c/255 : 0;
        };
        return { amount: a, level: Audio.energy || 0, react: Math.min(1, Audio.react || 0), onset: Math.min(1, Audio.onset || 0),
          low: band(0, 0.04), mid: band(0.04, 0.2), high: band(0.2, 0.6) };
      }
      // エンジンへ渡す状態 (音で macros を持ち上げた写し)。保存される compositionState は変えない
      function audioModulatedState(drive){
        if(!drive) return null;
        var m = compositionState.macros, a = drive.amount, k = function(v, add){ return Math.max(0, Math.min(1, v + (1 - v)*Math.min(1, add))); };
        return Object.assign({}, compositionState, { macros: Object.assign({}, m, {
          intensity: k(m.intensity, a*drive.react),
          instability: k(m.instability, a*drive.onset),
          depth: k(m.depth, a*drive.low*1.5)
        }) });
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
        // 音が鳴っている間は、帯域の偏り (低音寄り=左 / 高音寄り=右、中音で上) の位置にポインタを置く
        var drive = envState.audio, audioActive = !!(drive && drive.amount*drive.react > 0.12);
        if(audioActive){
          compositionBusPointer.x = Math.max(0, Math.min(1, 0.5 + (drive.high - drive.low)*0.9));
          compositionBusPointer.y = Math.max(0, Math.min(1, 0.55 - drive.mid*0.6));
        }
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
            pressure: audioActive ? Math.max(TD._compPulse || 0, drive.react) : (TD._compPulse != null ? TD._compPulse : 0.5),
            active: audioActive || !!(TD._t != null && TD._t < (TD._bloomUntil || 0))   // VJ: bloomスイープ中 / 音が鳴っている間だけポインタ有効
          },
          text: {
            length: visible.length,
            lineCount: textInput.value.replace(/\r\n?/g, '\n').split('\n').length,
            scriptDistribution: compositionScriptDistribution(tokens),
            entropy: entropy,
            tokenIndex: 0, codePoint: 0, unicodeHash: 0,
            glyphWidth: params.fontSize, inkCoverage: 0.5
          },
          audio: drive ? { level: drive.level, react: drive.react, onset: drive.onset, low: drive.low, mid: drive.mid, high: drive.high } : null,
          midi: null
        };
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

      /* ---- エンジン: 上流 0.3 の render-engine をメインスレッドで作る (On にした時点で読み込む) ---- */
      var compositionState = cloneCompositionDefaults();
      var compositionScene = { glyphs: [], bands: [], width: 0, height: 0 };
      var engine = null, engineLoading = null, engineError = '';
      var envState = { params: {}, paramsKey: '', compositionInputs: {}, sourceGlyphs: [], fontMetrics: {}, qualityOverride: null, audio: null, modState: null };
      var fontRuntime = null, renderErrorShown = false;
      function ensureEngine(){
        if(engine || engineLoading) return engineLoading;
        var UP = globalThis.TDUpstream;
        engineLoading = UP.load(UP.ENGINE).then(function(){
          fontRuntime = globalThis.TypeDeformerAxes.createRuntime({ fonts: document.fonts });
          engine = globalThis.TypeDeformerWorkerAdapter.create({
            get params(){ return envState.params; }, set params(v){ envState.params = v; },
            get compositionState(){ return envState.modState || compositionState; }, set compositionState(v){ compositionState = v; },
            get renderedSourceText(){ return textInput.value; }, set renderedSourceText(v){},
            surfaceFxPhase: 0, dataMoshFrame: 0, blobTrackState: { blobs: [] }, surfaceFxScratchCanvases: {},
            get compositionScene(){ return compositionScene; }, set compositionScene(v){ compositionScene = v; },
            get compositionQualityOverride(){ return envState.qualityOverride; }, set compositionQualityOverride(v){ envState.qualityOverride = v; },
            get fontMetrics(){ return envState.fontMetrics; },
            get compositionInputs(){ return envState.compositionInputs; },
            get sourceGlyphs(){ return envState.sourceGlyphs; },
            mobile: false, reducedMotion: false,
            font: function(g, size){ return fontRuntime.activate(envState.params, g, size); }
          });
          // パラメータ定義 (監査済みの範囲) が揃ったので正規化し直す
          var phase = compositionState.phase;
          compositionState = normalizeComposition(compositionState);
          compositionState.phase = phase;
        }).catch(function(e){ engineError = e.message || String(e); engineLoading = null; console.warn('[TDComp]', e); });
        return engineLoading;
      }

      // Glyph Vessel は motion = still のとき位相で変わらないが、生成 (充填 + 緩和) が 1 フレーム 50ms 前後かかる。
      // 生成したシーンを使い回し、FX ラックだけ毎フレーム掛ける (FX はシーンを書き換えるので写しを渡す)
      var vesselCache = null;
      function generateScene(w, h, glyphs){
        var st = compositionState;
        if(st.type !== 'glyphVessel' || st.glyphVessel.motion !== 'still'){ vesselCache = null; return engine.evaluateCompositionScene(w, h, 'preview', glyphs); }
        var stKey = Object.assign({}, st, { phase: 0 });
        var key = JSON.stringify([stKey, textInput.value, envState.paramsKey, w, h]);
        if(!vesselCache || vesselCache.key !== key) vesselCache = { key: key, scene: engine.evaluateCompositionScene(w, h, 'preview', glyphs) };
        var c = vesselCache.scene;
        return Object.assign({}, c, {
          glyphs: c.glyphs.map(function(g){ return Object.assign({}, g); }),
          bands: c.bands.map(function(b){ return Object.assign({}, b); }),
          masks: (c.masks || []).slice(), rasterPasses: (c.rasterPasses || []).slice()
        });
      }

      // 1フレーム分のシーンを生成して VJ の 2D canvas に描く (レイアウトは全面 1:1)。
      // 上流 editor の workerCompositionScene と同じ順: tokens → loop clock → 入力バス → evaluate → FX ラック
      function renderCompositionToCtx(ctx, w, h){
        if(!engine){ ensureEngine(); return false; }   // 読み込み中は素の文字を描かせる
        w = Math.max(1, w); h = Math.max(1, h);
        compositionScene.width = w; compositionScene.height = h;
        var layout = { w: w, h: h, s: 1, dx: 0, dy: 0 };
        var key = globalThis.TDUpstream.paramsKey();
        if(envState.paramsKey !== key){ envState.params = globalThis.TDUpstream.params(); envState.paramsKey = key; }
        envState.fontMetrics = fontMetrics();
        var glyphs = snapshotGlyphs(true);
        envState.sourceGlyphs = glyphs;
        var scene;
        envState.audio = audioDrive();
        envState.modState = audioModulatedState(envState.audio);
        try{
          var tokens = engine.compositionSourceTokens(glyphs);
          envState.compositionInputs = createCompositionInputBus(tokens, w, h,
            engine.createLoopClock(compositionState.phase, 240, compositionState.seed, compositionState.direction));
          scene = engine.applyCompositionFxRack(generateScene(w, h, glyphs), w, h, 'preview');
        }catch(e){
          envState.modState = null;
          if(!renderErrorShown){ renderErrorShown = true; console.warn('[TDComp]', e); }
          return false;
        }
        envState.modState = null;
        compositionScene = scene;
        drawSceneBands(ctx, scene.bands, 1, layout);
        drawGlyphs(ctx, scene.glyphs, 1, layout, envState.fontMetrics, true);
        return true;
      }

      /* ---- 永続化: md 単位 (TD_MD_STYLE_KEYS の 'comp' → vj.textdeform.mdStyles)。
       * 旧グローバル保存キーは廃止。v6 以前の保存値は normalizeComposition が v10 へ読み替える。 ---- */
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
        guides: COMPOSITION_ENGINE_GUIDES,
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
          if(compositionState.enabled) ensureEngine();
        },
        // md の読み込み時に呼ぶ: 保存された comp があれば復元、無ければデフォルト(Off)。位相は維持
        applyMd(raw){
          var phase = compositionState.phase;
          compositionState = raw ? normalizeComposition(raw) : cloneCompositionDefaults();
          compositionState.phase = phase;
          if(compositionState.enabled) ensureEngine();
        },
        // md へ保存する用のスナップショット (quality 抜き)
        snapshot(){ return persistentCompositionState(); },
        status(){ return engine ? 'ready' : engineError ? 'error: ' + engineError : engineLoading ? 'loading' : 'idle'; },
        // dt 秒ぶん位相を進める。pulse(ビート脈動)は入力バスの pressure へ
        advance(dt, pulse){
          TD._compPulse = Math.max(0, Math.min(1, (pulse || 1) - 1 + 0.35));
          if(!compositionState.enabled) return;
          var dir = compositionState.direction === -1 ? -1 : 1;
          var drive = audioDrive(), boost = drive ? 1 + drive.amount*drive.react*2 : 1;   // 音で位相の進みを最大 3 倍に
          compositionState.phase = ((compositionState.phase + dt * compositionState.speed * boost * dir) % 1 + 1) % 1;
        },
        // false = エンジン読み込み中 / 生成に失敗 (呼び出し側は素の文字を描く)
        render(ctx, w, h){ return renderCompositionToCtx(ctx, w, h); }
      };
})();
