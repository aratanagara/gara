'use strict';
/* 3D FX (Post FX 版) — Code エンジンの 3D 描画を「その時点の画面」を素材にして行う。
   Photo = PhotoPlane / Slicer = Slicer / Layers = Layer を Object.create で派生させ、画面 (_finalFBO.tex) を素材に描く。
   プログラム・VAO・バッファなど共有物は元エンジンと共有し、可変状態 (P / cam / 素材 / 時計) だけ own に持つ
   (own にすべきプロパティの一覧は各エンジンのファイル先頭のコメント)。
   GL 側 (_apply3dFx) が FBO・合成・GL 状態の復元を担当する。

   シームレス: 量 e (0..1) から進行度 w = smootherstep(0, 0.7, e) を作り、各エンジンの own プロパティ _fx = {w} に渡す。
   w=0 では「画面にぴったり収まる真正面のカメラ + 元の画面どおりに平らに並んだ断片」(= 元の画面と画素が一致)、w=1 で通常の 3D 配置。
   エンジンは透明背景 (slot 'B') で描き、GL 側が「元の画面 × (1 - bgDim)」の上に重ねる。 */
const Fx3d = {
  // 工場値: スクリプト読込時に確定 (App の state 復元より前)
  // エンジンの読込に失敗していても fx3d.js / app.js を止めない (その 3D FX だけ使えなくなる)
  FACTORY: {
    photo:  (typeof PhotoPlane !== 'undefined') ? JSON.parse(JSON.stringify(PhotoPlane.P)) : null,
    slicer: (typeof Slicer !== 'undefined') ? JSON.parse(JSON.stringify(Slicer.P)) : null,
    layer:  (typeof Layer !== 'undefined') ? JSON.parse(JSON.stringify(Layer.P)) : null,
  },
  inst: {},
  ORDER: ['photo', 'slicer', 'layer', 'diorama', 'points', 'cubes', 'blinds', 'gravity', 'globe'],
  KEY: { photo: 'fx3dPhoto', slicer: 'fx3dSlicer', layer: 'fx3dLayer', diorama: 'fx3dDiorama', points: 'fx3dPoints',
         cubes: 'fx3dCubes', blinds: 'fx3dBlinds', gravity: 'fx3dGravity', globe: 'fx3dGlobe' },
  // 自前レンダラ: name -> { render(gl, o) }。各 fx3d-<name>.js が Fx3d.EXTRA.<name> = {...} で登録する。
  //   o = { srcTex, fbo, w, h, e, k, asp, clock, beat, hit, beatMode, post }  (k = smooth(e) / hit = 0..1 / beatMode = beat モードか)
  //   戻り値: 描けたら true。透明背景・前乗算 (clear(0,0,0,0)、不透明な面は vec4(rgb,1)) で o.fbo へ描く。
  //   k = 0 で「dist 1.35 の正面カメラ + z=0 の平らな紙 + uShade 0」= 元画面と画素一致になること。
  //   未登録の名前は render() が false を返し、その段は飛ばされる。
  EXTRA: {},
  BUILTIN: { photo: 1, slicer: 1, layer: 1 },
  has(name){ return !!(this.BUILTIN[name] || this.EXTRA[name]); },

  // 立ち上がりが十分に平らな smootherstep (デッドゾーン境界 0.10 で絵が跳ねない)
  smooth(e){ const x = Math.max(0, Math.min(1, e / 0.7)); return x * x * x * (x * (x * 6 - 15) + 10); },
  // 元の画面の暗さ (板が抜けた跡が急に黒くならないよう、w と同じ立ち上がり)
  bgDim(e){ return this.smooth(e); },

  base(name){
    if(name === 'photo')  return (typeof PhotoPlane !== 'undefined') ? PhotoPlane : null;
    if(name === 'slicer') return (typeof Slicer !== 'undefined') ? Slicer : null;
    if(name === 'layer')  return (typeof Layer !== 'undefined') ? Layer : null;
    return null;
  },

  ensure(name, gl){
    if(this.inst[name]) return this.inst[name];
    const base = this.base(name);
    if(!base || !this.FACTORY[name]) return null;
    if(!base.initialized) base.init(gl);
    if(!base.initialized || base.ok === false) return null;
    const o = Object.create(base);
    o.P = JSON.parse(JSON.stringify(this.FACTORY[name]));
    o._fx = { w: 0 };
    if(name === 'photo'){
      o.cam = { az:0, el:0.28, dist:14 };
      o.textures = [null];
      o.texAspects = [1];
      o.planes = [];
      o.texFlipY = true;
      o._layoutSig = '';
    } else if(name === 'slicer'){
      o.PDefaults = JSON.parse(JSON.stringify(this.FACTORY[name]));
      o.cam = { az:0, el:0.3, dist:2.5 };
      // buildScene / _ensureSceneTargets は「いまの値を削除してから作り直す」ので、元エンジン (スロット) の資源を指さないよう空にしておく
      o.posBuf = o.uvBuf = o.seedBuf = o.idxBuf = o.ctrBuf = null; o.numIdx = 0;
      o.spkBuf = o.spkVAO = null; o.spkN = 0;
      o.sceneFbo = o.sceneColorTex = o.sceneDepthTex = o.postFbo = o.postColorTex = null; o.fboW = o.fboH = 0;
      o.imgTex = null; o.imgW = 1; o.imgH = 1; o.imgAsp = 1; o.imageReady = true; o.bgFromImage = null;
      o._needsRebuild = true; o._t = 0; o._autoBase = null; o._autoEpoch = -1; o._imgEpoch = null; o._imgLoading = false;
      o.curName = null; o.library = []; o._skipImgParams = true;
      o._meta3d = true;
      o.texFlipY = true;
      o._sig = ''; o._wq = -1;
    } else if(name === 'layer'){
      o.cam = { az:0, el:0.3, dist:15, target:[0, 0, 0] };
      o.textures = [null];
      o.texAspects = [1];
      o.texKeyColors = [];
      o.planes = [];
      o._ar = []; o._tintPl = [];
      o._layoutSig = '';
    }
    this.inst[name] = o;
    return o;
  },

  // ── 折り (Needle / Origami / Kaiser / Roll) を物体へ同じ 3D 空間で掛ける ──
  //   VS で gl_Position = fx3dApply(...) を呼ぶ / FS で fx3dFoldShade(色) を呼ぶと、prog() がフック (GL.fx3dHookGLSL / fx3dShadeGLSL) を差し込む。
  //   GL が最後の段を描く間だけ foldFrame = { g, F } を立てる。レンダラは uniform を送ったあと Fx3d.fold(gl, pr, proj, paperD) を呼ぶ
  //   (paperD = z=0 の紙が画面をちょうど満たすカメラ距離。camera() なら 1.35)
  foldFrame: null,
  canFold(name){ const x = this.EXTRA[name]; return name === 'slicer' || !!(x && x.foldHook); },
  fold(gl, pr, proj, paperD){ GL.fx3dUniforms(pr, proj, paperD, this.foldFrame); },

  // ── 面を覆う針 (Needle を物体の面へ) ──
  //   最後の段が対応エンジン (Slicer / spikes: true) で Needle が ON のとき、GL がその段を描く間だけ spikeFrame を立てる。
  //   エンジンは元の面の代わりに、面を GL.needleCellGLSL の針の面 (三角形・四角形の角錐。突起と凹み) で覆って描く。
  //   VS で fx3dNeedleH (と fx3dNeedleVert) を呼ぶと prog() がその GLSL を差し込む。uniform は spikeUniforms(gl, pr [, frame])
  spikeFrame: null,
  canSpike(name){ const x = this.EXTRA[name]; return name === 'slicer' || !!(x && x.spikes); },
  spikeUniforms(gl, pr, frame){
    const s = frame || this.spikeFrame || { a: 0, beat: 0, bm: 0, hit: 0, t: 0, scat: 0 };
    gl.uniform1f(gl.getUniformLocation(pr, 'uSpA'), s.a);
    gl.uniform1f(gl.getUniformLocation(pr, 'uSpBeat'), s.beat);
    gl.uniform1f(gl.getUniformLocation(pr, 'uSpBM'), s.bm);
    gl.uniform1f(gl.getUniformLocation(pr, 'uSpHit'), s.hit);
    gl.uniform1f(gl.getUniformLocation(pr, 'uSpT'), s.t);
    gl.uniform1f(gl.getUniformLocation(pr, 'uSpScat'), s.scat);
  },
  _withHooks(src, use, glsl){
    if(!src.includes(use)) return src;
    const at = src.indexOf('precision');
    const i = src.indexOf('\n', at >= 0 ? at : src.indexOf('#version'));
    return src.slice(0, i + 1) + glsl + src.slice(i + 1);
  },

  // ── ポップ (要素が現れる / 消えるときの弾み) ──
  //   3D FX の段ごとに状態を持つ: ON (量が 0 から上がった) / OFF (0 へ戻った。戻ったあとも縮み終わるまで直前の量で描き続ける) /
  //   組み直し (Slicer の配置替え・Blinds の区画替え = popEpoch) / 枚数の変化 (popCount)。要素ごとに少しずつ遅れて (stagger) 弾む。
  //   動きの型は App.post.fx3dPop (Back / Elastic / Bounce / Ease Out / Off)。
  //   JS 側は popAt(name, i) = 要素 i の拡大率 (0 = 消えている, 1 = 通常, >1 = 弾みの行き過ぎ)。
  //   GLSL 側は VS で fx3dPop(要素番号) を呼ぶ (prog() が POP_GLSL を差し込む)。uniform は popUniforms(gl, pr, name)
  POP_DUR: { back: 0.45, elastic: 0.8, bounce: 0.6, out: 0.35 },
  POP_MODE: { off: 0, back: 1, elastic: 2, bounce: 3, out: 4 },
  POP_STAG: 0.3,
  effE: {},       // このフレームの段ごとの量 (OFF の縮み中は直前の量)。GL._fx3dBgPrep が popFrame で毎フレーム作る
  _pop: {},
  popMode(){ const m = App.post && App.post.fx3dPop; return this.POP_MODE[m] != null ? m : 'back'; },
  popDur(){ return this.POP_DUR[this.popMode()] || 0; },
  _ps(name){ return this._pop[name] || (this._pop[name] = { on: false, tOn: -1e9, tOff: -1e9, held: 0, ep: -1e9, cnt: null }); },
  _now(){ return performance.now() / 1000; },
  popFrame(p, safe){
    const t = this._now(), live = this.popMode() !== 'off' ? this.popDur() + this.POP_STAG : 0;
    for(const name of this.ORDER){
      const e = safe ? 0 : Math.max(0, Math.min(1, +(p && p[this.KEY[name]]) || 0)), s = this._ps(name);
      if(e > 0.001){ if(!s.on){ s.on = true; s.tOn = t; } s.held = e; this.effE[name] = e; continue; }
      if(s.on){ s.on = false; s.tOff = t; }
      this.effE[name] = (!safe && t - s.tOff < live) ? s.held : 0;
    }
  },
  // 背景を暗くする量に掛ける係数 (ON で 0 → 1、OFF で 1 → 0。要素の遅れも含めた長さでなめらかに)
  popEnv(name){
    if(this.popMode() === 'off') return 1;
    const s = this._ps(name), t = this._now(), L = this.popDur() + this.POP_STAG;
    const sm = (x)=>{ x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
    return s.on ? sm((t - s.tOn) / L) : 1 - sm((t - s.tOff) / L);
  },
  // 組み直しの間隔が弾みの長さ (+ 遅れ) の 2 倍より短いときは弾ませない (出きらないうちに次が来て、ずっと縮んで見えるため)
  popEpoch(name){
    const s = this._ps(name), t = this._now();
    if(t - (s.epLast != null ? s.epLast : -1e9) >= 2 * (this.popDur() + this.POP_STAG)) s.ep = t;
    s.epLast = t;
  },
  // 枚数: req = 求める枚数、stable = 枚数を変えても既存の要素の番号と形が変わらないか。
  //   stable: 増えた分が弾んで出る / 減った分は縮み終わるまで描く (戻り値 = 描く枚数)。
  //   そうでない (区切りが全部変わる): 古い枚数のまま全部が縮み、縮み終わったら新しい枚数で全部が弾んで出る
  popCount(name, req, stable){
    const s = this._ps(name), t = this._now();
    if(!s.cnt){ s.cnt = { from: req, to: req, t: -1e9, stable }; return req; }
    const c = s.cnt;
    if(req !== c.to){ c.from = c.to; c.to = req; c.t = t; c.stable = stable; }
    if(this.popMode() === 'off') return c.to;
    const age = t - c.t, L = this.popDur() + this.POP_STAG;
    if(c.stable) return age < L ? Math.max(c.from, c.to) : c.to;
    return age < L ? c.from : c.to;
  },
  _popEase(m, x){
    if(m === 1){ const c1 = 1.70158, c3 = c1 + 1, y = x - 1; return 1 + c3 * y * y * y + c1 * y * y; }
    if(m === 2){ if(x <= 0) return 0; if(x >= 1) return 1; return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * 2.0943951) + 1; }
    if(m === 3){ const n1 = 7.5625, d1 = 2.75;
      if(x < 1 / d1) return n1 * x * x;
      if(x < 2 / d1){ x -= 1.5 / d1; return n1 * x * x + 0.75; }
      if(x < 2.5 / d1){ x -= 2.25 / d1; return n1 * x * x + 0.9375; }
      x -= 2.625 / d1; return n1 * x * x + 0.984375; }
    const y = 1 - x; return 1 - y * y * y;
  },
  popAt(name, i){
    const m = this.POP_MODE[this.popMode()];
    if(!m) return 1;
    const s = this._ps(name), t = this._now(), D = this.popDur(), S = this.POP_STAG;
    const st = (x=>x - Math.floor(x))(Math.sin(i * 91.3458 + 17.17) * 47453.5453) * S;
    const pin = (a)=>a <= 0 ? 0 : a >= D ? 1 : this._popEase(m, a / D);
    const pout = (a)=>a <= 0 ? 1 : a >= D ? 0 : this._popEase(m, 1 - a / D);
    let v = pin(t - s.tOn - st) * (s.on ? 1 : pout(t - s.tOff - st)) * pin(t - s.ep - st);
    const c = s.cnt;
    if(c && t - c.t < 2 * (D + S)){
      const a = t - c.t;
      if(c.stable){ if(i >= c.from && i < c.to) v *= pin(a - st); else if(i >= c.to && i < c.from) v *= pout(a - st); }
      else v *= a < D + S ? pout(a - st) : pin(a - D - S - st);
    }
    return Math.max(0, v);
  },
  POP_GLSL: `uniform float uPopOn, uPopOff, uPopEp, uPopCa, uPopC0, uPopC1, uPopCK, uPopM, uPopD, uPopS;
float popE(float x){
  if(uPopM < 1.5){ float y = x - 1.0; return 1.0 + 2.70158 * y * y * y + 1.70158 * y * y; }
  if(uPopM < 2.5){ if(x <= 0.0) return 0.0; if(x >= 1.0) return 1.0; return pow(2.0, -10.0 * x) * sin((x * 10.0 - 0.75) * 2.0943951) + 1.0; }
  if(uPopM < 3.5){
    if(x < 1.0 / 2.75) return 7.5625 * x * x;
    if(x < 2.0 / 2.75){ x -= 1.5 / 2.75; return 7.5625 * x * x + 0.75; }
    if(x < 2.5 / 2.75){ x -= 2.25 / 2.75; return 7.5625 * x * x + 0.9375; }
    x -= 2.625 / 2.75; return 7.5625 * x * x + 0.984375;
  }
  float y = 1.0 - x; return 1.0 - y * y * y;
}
float popIn(float a){ return a <= 0.0 ? 0.0 : a >= uPopD ? 1.0 : popE(a / uPopD); }
float popOut(float a){ return a <= 0.0 ? 1.0 : a >= uPopD ? 0.0 : popE(1.0 - a / uPopD); }
// 要素 idx の拡大率 (uPopM = 0 なら常に 1)。要素の中心から拡大縮小して使う
float fx3dPop(float idx){
  if(uPopM < 0.5) return 1.0;
  float st = fract(sin(idx * 91.3458 + 17.17) * 47453.5453) * uPopS;
  float v = popIn(uPopOn - st) * popOut(uPopOff - st) * popIn(uPopEp - st);
  if(uPopCK > 1.5) v *= uPopCa < uPopD + uPopS ? popOut(uPopCa - st) : popIn(uPopCa - uPopD - uPopS - st);
  else if(uPopCK > 0.5){ if(idx >= uPopC0 && idx < uPopC1) v *= popIn(uPopCa - st); else if(idx >= uPopC1 && idx < uPopC0) v *= popOut(uPopCa - st); }
  return max(v, 0.0);
}
`,
  popUniforms(gl, pr, name){
    const U = (n)=>gl.getUniformLocation(pr, n), m = this.POP_MODE[this.popMode()];
    gl.uniform1f(U('uPopM'), m);
    if(!m) return;
    const s = this._ps(name), t = this._now(), D = this.popDur(), S = this.POP_STAG, c = s.cnt;
    gl.uniform1f(U('uPopD'), D);
    gl.uniform1f(U('uPopS'), S);
    gl.uniform1f(U('uPopOn'), Math.min(1e4, t - s.tOn));
    gl.uniform1f(U('uPopOff'), s.on ? -1e4 : Math.min(1e4, t - s.tOff));
    gl.uniform1f(U('uPopEp'), Math.min(1e4, t - s.ep));
    const live = c && t - c.t < 2 * (D + S);
    gl.uniform1f(U('uPopCK'), live ? (c.stable ? 1 : 2) : 0);
    gl.uniform1f(U('uPopCa'), live ? t - c.t : 1e4);
    gl.uniform1f(U('uPopC0'), c ? c.from : 0);
    gl.uniform1f(U('uPopC1'), c ? c.to : 0);
  },

  // ── 自前レンダラ共有ヘルパ ──
  // プログラムをリンクしてキャッシュ。失敗時は null (失敗も覚えて再試行しない)
  prog(gl, id, vs, fs){
    const c = this._progs || (this._progs = {});
    if(id in c) return c[id];
    vs = this._withHooks(vs, 'fx3dNeedleH(', GL.needleCellGLSL());
    vs = this._withHooks(vs, 'fx3dPop(', this.POP_GLSL);
    vs = this._withHooks(vs, 'fx3dApply(', GL.fx3dHookGLSL());
    fs = this._withHooks(fs, 'fx3dFoldShade(', GL.fx3dShadeGLSL());
    const v = GL._compile(gl.VERTEX_SHADER, vs), f = GL._compile(gl.FRAGMENT_SHADER, fs);
    const p = GL._link(v, f);
    if(!p || p.err){ console.error('fx3d program failed:', id, p && p.err); return (c[id] = null); }
    return (c[id] = p);
  },
  // カメラ。az / el はラジアン、原点を見る。dist = 1.35 で z=0 の紙 q=(uv-0.5)*2*(asp,1) が画面をちょうど満たす
  camera(asp, az, el, dist){
    const ce = Math.cos(el);
    const eye = [dist * Math.sin(az) * ce, dist * Math.sin(el), dist * Math.cos(az) * ce];
    const norm = (v)=>{ const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; };
    const zc = norm(eye);
    const xc = norm([zc[2], 0, -zc[0]]);
    const yc = [zc[1]*xc[2]-zc[2]*xc[1], zc[2]*xc[0]-zc[0]*xc[2], zc[0]*xc[1]-zc[1]*xc[0]];
    const d = (a, b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    const view = [xc[0],yc[0],zc[0],0, xc[1],yc[1],zc[1],0, xc[2],yc[2],zc[2],0, -d(xc,eye),-d(yc,eye),-d(zc,eye),1];
    const f = 1.35, zn = 0.03, zf = 30.0;
    const proj = [f/asp,0,0,0, 0,f,0,0, 0,0,(zf+zn)/(zn-zf),-1, 0,0,2*zf*zn/(zn-zf),0];
    return { view, proj, eye };
  },
  // MSAA の色 + 深度 RBO (全レンダラで 1 つを共有)。描画後は resolve() で渡された fbo へ blit
  msaa(gl, w, h){
    let M = this._msaa;
    if(M && M.w === w && M.h === h) return M;
    if(M){ gl.deleteRenderbuffer(M.color); gl.deleteRenderbuffer(M.depth); gl.deleteFramebuffer(M.fbo); }
    const samples = Math.min(8, gl.getParameter(gl.MAX_SAMPLES) || 0);
    const color = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, color);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return (this._msaa = { fbo, color, depth, w, h });
  },
  resolve(gl, dstFbo, w, h){
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._msaa.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFbo);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },
  // 紙のライティング (折り系 FS と同じ。dFdx / dFdy の面法線)。使う側は FS 先頭 (precision の後) へ連結し、
  // fx3dLit(アルベド, ワールド座標, 目の位置, shade) を呼ぶ。shade = Fx3d.shade(k)
  GLSL_LIT: `vec3 fx3dLit(vec3 alb, vec3 wp, vec3 eye, float shade){
  vec3 N = normalize(cross(dFdx(wp), dFdy(wp)));
  vec3 V = normalize(eye - wp);
  if(dot(N, V) < 0.0) N = -N;
  vec3 L = normalize(vec3(2.4, 2.0, 3.0));
  float ndl = max(0.0, dot(N, L));
  vec3 light = vec3(0.50, 0.48, 0.46) * ndl + mix(vec3(0.60, 0.61, 0.64), vec3(0.72), N.y * 0.5 + 0.5);
  float spec = pow(max(0.0, dot(N, normalize(L + V))), 26.0);
  vec3 res = alb * light + vec3(1.0) * spec * 0.10;
  return mix(alb, res, shade);
}
`,
  shade(k){ return Math.min(1, k / 0.22); },

  // e = 0..1 の量。戻り値: 描けたか
  render(name, o){
    const x = this.EXTRA[name];
    if(x){
      const gl = GL.gl;
      return !!x.render(gl, Object.assign({
        k: this.smooth(o.e), asp: o.w / o.h,
        hit: Math.max(0, Math.min(1, (typeof Audio !== 'undefined' && Audio.hit) || 0)),
        beatMode: App.beatMode === 'beat', post: App.post,
        dz: (v)=>App.deadParam(v),   // Twist / Spin など詳細 0..1 のデッドゾーン (量 e は渡す時点で適用済み)
      }, o));
    }
    if(!this.BUILTIN[name]) return false;
    const { srcTex, fbo, w, h, e, clock, beat } = o;
    const o2 = this.ensure(name, GL.gl);
    return this._renderBuiltin(name, o2, { srcTex, fbo, w, h, e, clock, beat });
  },
  _renderBuiltin(name, o, { srcTex, fbo, w, h, e, clock, beat }){
    if(!o) return false;
    const P = o.P, post = App.post || {};
    const F = this.FACTORY[name];
    const k = this.smooth(e);
    const asp = w / h;
    o._fx.w = k;
    if(name === 'photo'){
      const cropMax = Math.max(0.3, Math.min(1, (+post.fx3dPhotoCrop || 70) / 100));
      P.bg = [0, 0, 0]; P.softFocus = 0;
      P.count = this.popCount('photo', Math.max(4, Math.min(80, Math.round(+(post.fx3dPhotoCount) || 24))), true);   // 枚数を変えても既存の板は同じ (増減した分だけ弾む)
      P.cropMax = cropMax; P.cropMin = cropMax * 0.36;
      P.spread = 2 + 7 * e;
      P.bend = F.bend * k;
      P.size = F.size * (0.8 + 0.6 * e);
      o.textures[0] = srcTex;
      o.texAspects[0] = asp;
      const sig = [P.count, P.cropMax.toFixed(3), P.spread.toFixed(3), P.size.toFixed(3), asp.toFixed(3)].join('|');
      if(sig !== o._layoutSig){ o._layoutSig = sig; o.generateLayout(); }
      o.render({ fbo, w, h, slot:'B', beat, clock, keepDepth:true });
      return true;
    }
    if(name === 'slicer'){
      const pieces = this.popCount('slicer', Math.max(20, Math.min(400, Math.round(+(post.fx3dSlicerPieces) || F.pieces))), true);   // 断片は番号ごとに形が決まる (増減した分だけ弾む)
      o.imgTex = srcTex; o.imageReady = true;
      P.pieces = pieces;
      P.postScale = 1;
      P.autoMode = true;
      P.shadowStr = F.shadowStr * k;
      P.drift = F.drift * k;
      P.reshuffle = 100 * k;
      // 組み直し (CPU でジオメトリ生成) は量を 1/512 刻みにして、変化したときだけ
      const wq = Math.round(k * 512);
      const sig = [pieces, asp.toFixed(3)].join('|');
      if(o.imgAsp !== asp){ o.imgAsp = asp; o._needsRebuild = true; }
      if(sig !== o._sig){ o._sig = sig; o._needsRebuild = true; }
      if(wq !== o._wq){
        o._wq = wq;
        const q = wq / 512;
        o._autoBase = { explode: F.explode * q, bend: F.bend * q, curl: F.curl * q };
        o._autoEpoch = -1;   // 次の update で中心を反映して組み直す (同じ拍ならシードも同じ)
      }
      const seed0 = P.seed;
      o.update(beat, 1 / 60, clock);
      if(P.seed !== seed0) this.popEpoch('slicer');   // 拍の組み直し (配置替え) で断片が弾んで出直す
      o.render({ fbo, w, h, slot:'B' });
      return true;
    }
    if(name === 'layer'){
      const count = this.popCount('layer', Math.max(1, Math.min(40, Math.round(+(post.fx3dLayerCount) || 12))), true);
      const pct = Math.max(20, Math.min(300, +(post.fx3dLayerSize) || 100)) / 100;
      P.bgColor = [0, 0, 0]; P.bg = 1;
      P.pngAlpha = false; P.showGround = false; P.shadowOn = false; P.gloss = 0;
      P.count = count;
      P.size = F.size * 3 * pct;   // 画面素材は大きく見せる (Code の Layer の既定は画像の小さな板)
      P.sizeVar = 1.0;
      P.spread = 3 + 9 * e;
      P.curvature = F.curvature * k;
      o.textures[0] = srcTex;
      o.texAspects[0] = asp;
      const sig = [count, P.spread.toFixed(3), asp.toFixed(3)].join('|');
      if(sig !== o._layoutSig){ o._layoutSig = sig; o.generateLayout(); }
      o.render({ fbo, w, h, slot:'B', clock, beatMode: App.beatMode, beat, beatPhase: (beat || 0) % 1 });
      return true;
    }
    return false;
  },
};
