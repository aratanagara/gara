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
      o.posBuf = o.uvBuf = o.seedBuf = o.idxBuf = null; o.numIdx = 0;
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

  // ── 面ごとの針 (Needle を物体の面の上へ) ──
  //   最後の段が対応エンジン (Slicer / spikes: true) で Needle が ON のとき、GL がその段を描く間だけ spikeFrame を立てる。
  //   エンジンは面の上に格子で種を置き、1 本 = 3〜5 角錐 (側面 5 枚 = 15 頂点) をインスタンス描画する。
  //   VS で fx3dSpike(gl_VertexID, 種) を呼ぶと、底面内の位置 (底面の半径 = 1) と高さ (同じ単位) が返る。
  //   面の法線方向へ高さを足し、根元の絵を貼る。種の無い針・高さ 0 は全頂点が中心に縮退して描かれない
  spikeFrame: null,
  canSpike(name){ const x = this.EXTRA[name]; return name === 'slicer' || !!(x && x.spikes); },
  SPIKE_VERTS: 15,
  SPIKE_GLSL: `uniform float uSpA, uSpBeat, uSpBM, uSpHit, uSpT;
float spH(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec3 fx3dSpike(int vid, vec2 cell){
  int tri = vid / 3, cn = vid - tri * 3;
  float ns = 3.0 + floor(spH(cell + 23.9) * 2.999);
  if(float(tri) >= ns || spH(cell + 7.7) > 0.62) return vec3(0.0);
  // 高さは単体 Needle と同じ二極化 (低い針と高い針が隣り合う) + 拍ごとの目標へ Ease Out / drone は連続サイン
  float jr = spH(cell + 9.9);
  float amp = (jr < 0.45) ? mix(0.05, 0.35, jr / 0.45) : mix(1.05, 1.9, pow(spH(cell + 1.1), 3.0));
  float osc = sin(uSpT * (0.22 + 0.26 * spH(cell + 0.13)) + spH(cell + 5.5) * 6.2831);
  float bid = floor(uSpBeat);
  float ease = 1.0 - pow(1.0 - clamp(fract(uSpBeat) / 0.24, 0.0, 1.0), 3.0);
  float bosc = mix(spH(cell + bid * 7.7 + 11.3), spH(cell + (bid + 1.0) * 7.7 + 11.3), ease) * 2.0 - 1.0;
  osc = mix(osc, bosc, uSpBM);
  float h = 6.0 * amp * sqrt(abs(osc)) * uSpA * (1.0 + mix(0.10, 0.46, uSpBM) * pow(clamp(uSpHit, 0.0, 1.0), 0.65));
  if(h < 0.02) return vec3(0.0);
  if(cn == 2) return vec3(0.0, 0.0, h);
  float a = spH(cell + 41.3) * 6.2831 + float(tri + cn) * 6.2831 / ns;
  return vec3(cos(a), sin(a), 0.0);
}
`,
  spikeUniforms(gl, pr){
    const s = this.spikeFrame || { a: 0, beat: 0, bm: 0, hit: 0, t: 0 };
    gl.uniform1f(gl.getUniformLocation(pr, 'uSpA'), s.a);
    gl.uniform1f(gl.getUniformLocation(pr, 'uSpBeat'), s.beat);
    gl.uniform1f(gl.getUniformLocation(pr, 'uSpBM'), s.bm);
    gl.uniform1f(gl.getUniformLocation(pr, 'uSpHit'), s.hit);
    gl.uniform1f(gl.getUniformLocation(pr, 'uSpT'), s.t);
  },
  _withHooks(src, use, glsl){
    if(!src.includes(use)) return src;
    const at = src.indexOf('precision');
    const i = src.indexOf('\n', at >= 0 ? at : src.indexOf('#version'));
    return src.slice(0, i + 1) + glsl + src.slice(i + 1);
  },

  // ── 自前レンダラ共有ヘルパ ──
  // プログラムをリンクしてキャッシュ。失敗時は null (失敗も覚えて再試行しない)
  prog(gl, id, vs, fs){
    const c = this._progs || (this._progs = {});
    if(id in c) return c[id];
    vs = this._withHooks(vs, 'fx3dSpike(', this.SPIKE_GLSL);
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
      P.count = Math.max(4, Math.min(80, Math.round(+(post.fx3dPhotoCount) || 24)));
      P.cropMax = cropMax; P.cropMin = cropMax * 0.36;
      P.spread = 2 + 7 * e;
      P.bend = F.bend * k; P.warpAmp = F.warpAmp * k;
      P.size = F.size * (0.8 + 0.6 * e);
      o.textures[0] = srcTex;
      o.texAspects[0] = asp;
      const sig = [P.count, P.cropMax.toFixed(3), P.spread.toFixed(3), P.size.toFixed(3), asp.toFixed(3)].join('|');
      if(sig !== o._layoutSig){ o._layoutSig = sig; o.generateLayout(); }
      o.render({ fbo, w, h, slot:'B', beat, clock, keepDepth:true });
      return true;
    }
    if(name === 'slicer'){
      const pieces = Math.max(20, Math.min(400, Math.round(+(post.fx3dSlicerPieces) || F.pieces)));
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
      o.update(beat, 1 / 60, clock);
      o.render({ fbo, w, h, slot:'B' });
      return true;
    }
    if(name === 'layer'){
      const count = Math.max(1, Math.min(40, Math.round(+(post.fx3dLayerCount) || 12)));
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
