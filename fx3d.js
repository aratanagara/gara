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
  ORDER: ['photo', 'slicer', 'layer'],
  KEY: { photo: 'fx3dPhoto', slicer: 'fx3dSlicer', layer: 'fx3dLayer' },

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

  // e = 0..1 の量。戻り値: 描けたか
  render(name, { srcTex, fbo, w, h, e, clock, beat }){
    const o = this.ensure(name, GL.gl);
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
