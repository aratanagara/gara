/* Type Deformer の画像予算。画素数は RGBA の論理サイズで、driver/上流の作業メモリとは別。
 * Canvas・Full・Surface が同じ予算から確保する。予算内の寸法は丸め直さない。
 */
(function(){
'use strict';
const reservations = new Map();
const B = {
  limit: 64e6,
  texturePixels: 0,
  createCanvas(){ const c = document.createElement('canvas'); c.width = c.height = 0; return c; },
  // 所有者から集計するので、プールへの移動や Full の退避を二重計上しない。
  used(exclude = []){
    const skip = new Set(exclude), images = new Set();
    const add = c => { if(c && !skip.has(c)) images.add(c); };
    if(typeof TextDeform !== 'undefined'){
      add(TextDeform.canvas); add(TextDeform._outputCanvas); add(TextDeform._heroCv);
    }
    if(typeof TDCanvas !== 'undefined'){
      for(const i of TDCanvas._inst.values()){ if(i._stamp){ add(i.canvas); add(i.full); } if(i.img && !i.img._tdLoading) add(i.img); }
      for(const c of TDCanvas._pool) add(c);
      for(const g of TDCanvas._ghosts || []) add(g.c);
      add(TDCanvas._bgHold); add(TDCanvas._heroCache);
    }
    if(typeof TDSurf !== 'undefined'){
      for(const l of [...TDSurf.layers, ...(TDSurf._held || []), ...(TDSurf._receiving || [])]) add(l.canvas);
      for(const c of TDSurf._pool) add(c);
    }
    // グリフ判定 (72²)、Vector 輪郭 (128²)、grain/pattern (128²) 等の小画像も余裕を予約。
    let pixels = 65536 + (skip.has(this) ? 0 : this.texturePixels);
    for(const c of images) pixels += (c.naturalWidth || c.width || 0)*(c.naturalHeight || c.height || 0);
    for(const [key, px] of reservations) if(!skip.has(key)) pixels += px;
    return pixels;
  },
  reserve(key, pixels){
    if(pixels === 0){ reservations.delete(key); return true; }
    if(!Number.isFinite(pixels) || pixels < 0 || this.used([key]) + pixels > this.limit) return false;
    if(pixels) reservations.set(key, pixels); else reservations.delete(key);
    return true;
  },
  reserved(key){ return reservations.get(key) || 0; },
  // 既存の焼き付け保存形式は data:image/webp。デコード前に先頭チャンクの寸法を検査する。
  // 未知の形式は描画用 Image に渡さない (大きなデコード画像を後から縮めても間に合わない)。
  webpPixels(src){
    if(typeof src !== 'string' || !src.startsWith('data:image/webp;base64,')) return 0;
    try{
      const h = atob(src.slice(23, 87)), b = i => h.charCodeAt(i), u16 = i => b(i) + b(i + 1)*256;
      if(h.length < 30 || h.slice(0, 4) !== 'RIFF' || h.slice(8, 12) !== 'WEBP') return 0;
      let w, v;
      const type = h.slice(12, 16);
      if(type === 'VP8X'){
        if(b(20) & 2) return 0; // アニメはフレームごとのデコード量をこの予算で保証できない
        w = 1 + u16(24) + b(26)*65536; v = 1 + u16(27) + b(29)*65536;
      }else if(type === 'VP8L' && b(20) === 47){
        w = 1 + b(21) + (b(22) & 63)*256;
        v = 1 + (b(22) >> 6) + b(23)*4 + (b(24) & 15)*1024;
      }else if(type === 'VP8 ' && b(23) === 157 && b(24) === 1 && b(25) === 42){
        w = u16(26) & 16383; v = u16(28) & 16383;
      }
      return w > 0 && v > 0 ? w*v : 0;
    }catch(e){ return 0; }
  },
  free(c){ if(c){ c.width = 0; c.height = 0; } },
  trimPools(){
    for(const owner of [globalThis.TDCanvas, globalThis.TDSurf]){
      if(!owner) continue;
      for(const c of owner._pool) this.free(c);
      owner._pool.length = 0;
    }
  },
  fit(w, h, copies = 1, exclude = []){
    w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
    if(!Number.isFinite(w*h*copies) || copies < 1) return { w: 0, h: 0 };
    let room = Math.max(0, this.limit - this.used(exclude));
    if(w*h*copies > room){ this.trimPools(); room = Math.max(0, this.limit - this.used(exclude)); }
    if(w*h*copies <= room) return { w, h };
    const area = Math.floor(room/copies);
    if(area < 1) return { w: 0, h: 0 };
    const q = Math.sqrt(area/(w*h));
    w = Math.max(1, Math.floor(w*q)); h = Math.max(1, Math.floor(h*q));
    // 極端に細長い画像でも最小 1px の丸めで超過しない。
    if(w*h > area){ if(w >= h) w = Math.floor(area/h); else h = Math.floor(area/w); }
    return { w, h };
  },
  resize(c, w, h){
    const size = this.fit(w, h, 1, [c]);
    if(!size.w || !size.h) return false;
    if(c.width !== size.w || c.height !== size.h){
      // 幅だけ先に変えた瞬間に「新幅×旧高さ」の大きな画像を作らない。
      c.width = 0; c.height = size.h; c.width = size.w;
    }
    return true;
  }
};
globalThis.TDPixels = B;
})();
