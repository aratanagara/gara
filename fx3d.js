'use strict';
/* 3D FX (Post FX 版) — Code エンジンの 3D 描画を「その時点の画面」を素材にして行う。
   Photo = PhotoPlane (mode/photoplane.js) を Object.create で派生させ、textures=[画面] で描く。
   プログラム・VAO は PhotoPlane と共有し、可変状態 (P / cam / textures / planes / 時計) だけ own に持つ。
   GL 側 (_apply3dFx) が FBO・合成・GL 状態の復元を担当する。 */
const Fx3d = {
  // 工場値: スクリプト読込時に確定 (App の state 復元より前)
  FACTORY: { photo: JSON.parse(JSON.stringify(PhotoPlane.P)) },
  inst: {},
  ORDER: ['photo'],
  KEY: { photo: 'fx3dPhoto' },

  ensure(name, gl){
    if(this.inst[name]) return this.inst[name];
    const base = name === 'photo' ? PhotoPlane : null;
    if(!base) return null;
    if(!base.initialized) base.init(gl);
    if(!base.ok) return null;
    const o = Object.create(base);
    o.P = JSON.parse(JSON.stringify(this.FACTORY[name]));
    o.cam = { az:0, el:0.28, dist:14 };
    o.textures = [null];
    o.texAspects = [1];
    o.planes = [];
    o.texFlipY = true;
    o._layoutSig = '';
    this.inst[name] = o;
    return o;
  },

  // e = 0..1 の量。戻り値: 描けたか
  render(name, { srcTex, fbo, w, h, e, clock, beat }){
    const o = this.ensure(name, GL.gl);
    if(!o) return false;
    const P = o.P, post = App.post || {};
    const F = this.FACTORY[name];
    if(name === 'photo'){
      const cropMax = Math.max(0.3, Math.min(1, (+App.post.fx3dPhotoCrop || 70) / 100));
      const spread = 2 + 7 * e;
      P.bg = [0, 0, 0]; P.softFocus = 0;
      P.count = Math.max(4, Math.min(80, Math.round(+(post.fx3dPhotoCount) || 24)));
      P.cropMax = cropMax; P.cropMin = cropMax * 0.36;
      P.spread = spread;
      P.bend = F.bend * e; P.warpAmp = F.warpAmp * e;
      P.size = F.size * (0.8 + 0.6 * e);
    }
    o.textures[0] = srcTex;
    o.texAspects[0] = w / h;
    const sig = [P.count, P.cropMax.toFixed(3), P.spread.toFixed(3), P.size.toFixed(3), (w / h).toFixed(3)].join('|');
    if(sig !== o._layoutSig){ o._layoutSig = sig; o.generateLayout(); }
    o.render({ fbo, w, h, slot:'A', beat, clock, keepDepth:true });
    return true;
  },
};
