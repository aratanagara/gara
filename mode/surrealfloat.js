'use strict';
/* Surreal Float engine — vj/ の追加レンダリングモード (kind:'surrealfloat')。
   シェーダ版 (shaders/bg_surrealfloat.frag) をジオメトリで描き直した軽量版。
   白い砂漠の上空を、マグリット風の構造物とイヴ・タンギー風の不定形が行き交う。
   - 空: 全画面 1 枚 (グラデーション + 雲の fbm)。
   - 砂漠: カメラを中心にした同心円グリッドのメッシュ。高さ (尾根のある砂丘) は頂点シェーダで計算し、
     陰影・風紋・砂粒・稜線の影 (5 歩)・構造物の影はフラグメントで描く。ピクセルごとのレイマーチは無し。
   - 構造物 / 小物: 部品 (板 = 平行四辺形・三角柱 / 管 / 球 / 輪 / 窓 / 布 / 不定形) をインスタンスで描く。
     部品の配置は CPU で毎フレーム組み立てる (組み替え・行き交いはここ)。布は頂点シェーダで揺らす。
     不定形は起動時に球メッシュを距離関数の表面へ押し出して作る。
   - 深度テストで前後を解決。Drone/Beat はシェーダ版と同じ時間基準。
   IF: init(gl) / update() / render({fbo,w,h,slot,beat,clock}) / P(params)
*/

const SurrealFloat = {
  gl:null, initialized:false, ok:false,
  progSky:null, progGround:null, progObj:null,
  vaoSky:null, ground:null, meshes:{}, instVBO:null, instCap:0,
  depthRBO:null, depthW:0, depthH:0,
  startTime:0,

  // ── パラメータ (UI から操作)。% 表記はシェーダ版の @param と同じ意味 ──
  P:{
    speed:100,     // 全体の時間の速さ (%)
    depth:100,     // 近づいたり遠ざかったりする速さ (%。物ごとに速さと向きが違う)
    drift:100,     // 漂い (%)
    spin:100,      // 揺れ (%)
    morph:100,     // 部品の組み替えの速さ (%)
    count:24,      // 構造物の数 (変なものを足したぶん増やし、全体に占める割合を保つ)
    size:100,      // 構造物の大きさ (%)
    sizeVar:100,   // 物ごとの大きさのばらつき (%)。0 = 全部ほぼ同じ大きさ / 100 = 既定の指数分布 / 上げるほど巨大な物と小さな物が混ざる
    weird:100,     // 変さ (%)。変さと大きさは指数分布: 大半は少し変で控えめ、ごく一部が極端に変で巨大
    debris:100,    // 単体で浮かぶ球・板の量 (%)
    oddity:100,    // マグリット的な変なもの (巨大な岩・山高帽・林檎) の量 (%)
    tanguy:100,    // 単体で漂うイヴ・タンギー風の不定形の量 (%)
    pan:100,       // カメラの横回転 (%)
    cloud:100,     // 雲の量 (%)
    cloudSpd:100,  // 雲の流れる速さ (%)
    dunes:100,     // 砂丘の起伏と風紋 (%)
    haze:100,      // 大気の霞 (%)
    shadow:100,    // 影 (稜線の影 + 構造物が砂に落とす影, %)
    brush:100,     // 油彩の筆ムラ・キャンバス目 (%)
    kick:100,      // 拍 / 音の効き (%)
    seed:0,        // 配置と形の乱数シード
    pitch:0,       // カメラの上下の向き (度。基準の仰角に足す。+ = 見上げて地平線が下がる)
    roll:0,        // カメラの傾き (度。水平線ごと傾く)
    eyeH:0,        // カメラの高さ (10 = 世界の 1 単位。砂漠から離れる / 近づく)
    lane:100,      // 物が通る進路の左右の広がり (%)
    floatH:100,    // 物が浮かぶ高さ (%)
    sunAz:0,       // 光の向き (度。雰囲気の向きに足す。物の光と砂丘の影が同じく回る)
    sunEl:0,       // 光の高さ (度)
    keyGain:100,   // 主光の強さ (%)
    ambient:100,   // 環境光 (空からの回り込み, %)
    duneScale:100, // 砂丘の大きさ (波長, %。高さは Dunes)
    speckle:100,   // 砂のざらつきと白黒の粒 (%)
    shadeFloor:30, // 砂の影側の明るさ (%。高い = 影が浅い)
    cloudScale:100,// 雲の大きさ (%。大きいほど細かい)
    cloudBase:10,  // 雲が出始める高さ (地平線から, %)
    cloudSoft:100, // 雲の縁のやわらかさ (%)
    brushScale:100,// 筆ムラの大きさ (%。大きいほど細かい)
    weave:100,     // キャンバス目の濃さ (%)
    mood:0,        // 雰囲気 (MOODS の番号。選ぶと空・砂の色もその雰囲気の色に入れ替わる)
    skyTop:[0x75/255, 0x70/255, 0x7a/255],
    skyLow:[0xdc/255, 0xc3/255, 0xc6/255],
    sand:[0xe4/255, 0xe4/255, 0xe4/255],
  },

  // ===== 雰囲気 (Mood) =====
  //   sky/low/sand = パネルの色 (選ぶとここへ入れ替わる)、cA/cB = 雲の陰/明、glow = 地平線の光、key = 主光の色と強さ、
  //   amb = 環境光 (空の色と半々で混ぜる)、gt = 砂の色味、L/Ld = 物/砂丘の光の向き、haze = 霞の倍率、
  //   gr = [彩度, コントラスト, 明るさ, 星]
  MOODS:[
    { name:'薄暮 (既定)',       sky:[0x75,0x70,0x7a], low:[0xdc,0xc3,0xc6], sand:[0xe4,0xe4,0xe4], cA:[0.47,0.42,0.62], cB:[0.58,0.53,0.68], glow:[0.93,0.88,0.88],
      key:[1.00,0.96,0.92], amb:[0.60,0.57,0.66], gt:[1,1,1], L:[-0.45,0.62,0.64], Ld:[-0.80,0.34,0.25], haze:1.0, gr:[1,1,1,0] },
    { name:'真昼 (マグリットの青空)', sky:[0x4a,0x7c,0xc4], low:[0xc8,0xdc,0xec], sand:[0xec,0xea,0xe4], cA:[0.80,0.84,0.90], cB:[0.99,0.99,1.00], glow:[0.96,0.97,1.00],
      key:[1.08,1.04,0.98], amb:[0.60,0.70,0.88], gt:[1.00,0.99,0.96], L:[-0.35,0.85,0.40], Ld:[-0.70,0.55,0.20], haze:0.8, gr:[1.05,1.02,1.02,0] },
    { name:'夜 (月明かり)',      sky:[0x0a,0x10,0x24], low:[0x2c,0x32,0x52], sand:[0x9a,0x9e,0xaa], cA:[0.09,0.10,0.17], cB:[0.22,0.24,0.35], glow:[0.35,0.38,0.55],
      key:[0.55,0.62,0.86], amb:[0.16,0.19,0.32], gt:[0.62,0.68,0.86], L:[0.40,0.70,0.55], Ld:[0.75,0.40,0.30], haze:0.7, gr:[0.85,1.05,0.92,1] },
    { name:'光の帝国 (昼の空と夜の地上)', sky:[0x58,0x8c,0xd0], low:[0xd8,0xe4,0xf0], sand:[0x60,0x60,0x66], cA:[0.82,0.86,0.92], cB:[1.00,1.00,1.00], glow:[0.98,0.98,1.00],
      key:[0.42,0.40,0.38], amb:[0.20,0.22,0.30], gt:[0.55,0.57,0.66], L:[-0.30,0.80,0.50], Ld:[-0.60,0.50,0.30], haze:0.6, gr:[1,1.04,1,0] },
    { name:'夕焼け',            sky:[0x46,0x38,0x66], low:[0xf8,0x9c,0x66], sand:[0xe6,0xcc,0xb4], cA:[0.52,0.30,0.40], cB:[0.98,0.66,0.50], glow:[1.00,0.74,0.48],
      key:[1.18,0.78,0.52], amb:[0.48,0.36,0.52], gt:[1.00,0.88,0.78], L:[-0.88,0.30,0.38], Ld:[-0.94,0.17,0.25], haze:1.1, gr:[1.08,1.05,1.0,0] },
    { name:'霧',               sky:[0xc8,0xc8,0xca], low:[0xea,0xea,0xe8], sand:[0xe6,0xe6,0xe4], cA:[0.84,0.84,0.85], cB:[0.95,0.95,0.95], glow:[0.96,0.96,0.95],
      key:[0.88,0.88,0.88], amb:[0.86,0.86,0.88], gt:[1,1,1], L:[-0.30,0.90,0.30], Ld:[-0.60,0.60,0.30], haze:3.2, gr:[0.80,0.86,1.03,0] },
    { name:'タンギー (海の底の砂)', sky:[0x6a,0x7a,0x78], low:[0xcc,0xcc,0xb8], sand:[0xc8,0xc6,0xb4], cA:[0.50,0.56,0.54], cB:[0.70,0.73,0.67], glow:[0.90,0.88,0.78],
      key:[1.00,0.97,0.88], amb:[0.52,0.62,0.60], gt:[0.98,0.98,0.90], L:[-0.55,0.55,0.62], Ld:[-0.85,0.28,0.30], haze:1.7, gr:[0.9,0.97,1.0,0] },
    { name:'白昼夢 (群青と黄土)',  sky:[0x1a,0x3c,0x8c], low:[0xe6,0xd2,0xa0], sand:[0xd8,0xb8,0x86], cA:[0.74,0.72,0.72], cB:[0.98,0.95,0.90], glow:[1.00,0.92,0.75],
      key:[1.18,1.06,0.88], amb:[0.40,0.48,0.72], gt:[1.00,0.86,0.66], L:[-0.78,0.42,0.45], Ld:[-0.90,0.22,0.36], haze:0.9, gr:[1.12,1.10,1.0,0] },
  ],
  // 雰囲気を選ぶ: パネルの空・砂の色もその雰囲気の色に入れ替える (切り替えは render 側で約 1 秒かけてなめらかに)
  setMood(i){
    const n = this.MOODS.length; i = Math.max(0, Math.min(n - 1, Math.round(+i || 0)));
    const m = this.MOODS[i]; const c = (a)=>a.map(v=>v/255);
    this.P.mood = i; this.P.skyTop = c(m.sky); this.P.skyLow = c(m.low); this.P.sand = c(m.sand);
  },
  _moodState(P, dt){
    const m = this.MOODS[Math.max(0, Math.min(this.MOODS.length - 1, Math.round(+P.mood || 0)))];
    const tgt = { cA:m.cA, cB:m.cB, glow:m.glow, key:m.key, amb:m.amb, gt:m.gt, L:m.L, Ld:m.Ld, haze:[m.haze], gr:m.gr,
                  sky:P.skyTop, low:P.skyLow, sand:P.sand };
    const st = this._mst;
    if(!st || dt > 1e8){ this._mst = JSON.parse(JSON.stringify(tgt)); return this._mst; }
    const k = 1 - Math.exp(-dt/0.35);
    for(const key in tgt){ const a = st[key], b = tgt[key]; for(let q=0;q<b.length;q++) a[q] += (b[q] - a[q])*k; }
    return st;
  },

  // シェーダ版と共通の定数
  F:2.2, PIT:0.27, GY:-4.2, FAR:56.0, BACK:-56.0,   // 進路はカメラの前後どちらへも遠くまで続き、両端 (遠方) で空に溶けて巻き戻る
  MAXS:36, MAXD:72, NBLOB:10,

  // ===== 小さな数学 =====
  _fract(x){ return x - Math.floor(x); },
  _h1(n){ return this._fract(Math.sin(n*127.1 + this._seed*17.37)*43758.5453); },
  _rot(a, b, c){          // yaw (Y) → pitch (X) → roll (Z) の 3x3 (列優先)。シェーダ版 sf_rot と同じ
    const cy=Math.cos(a), sy=Math.sin(a), cx=Math.cos(b), sx=Math.sin(b), cz=Math.cos(c), sz=Math.sin(c);
    const Ry=[cy,0,-sy, 0,1,0, sy,0,cy], Rx=[1,0,0, 0,cx,sx, 0,-sx,cx], Rz=[cz,sz,0, -sz,cz,0, 0,0,1];
    return this._m3mul(this._m3mul(Ry, Rx), Rz);
  },
  _m3mul(a,b){ const o=new Array(9); for(let c=0;c<3;c++) for(let r=0;r<3;r++){ let s=0; for(let k=0;k<3;k++) s+=a[k*3+r]*b[c*3+k]; o[c*3+r]=s; } return o; },
  _m3v(m,v){ return [m[0]*v[0]+m[3]*v[1]+m[6]*v[2], m[1]*v[0]+m[4]*v[1]+m[7]*v[2], m[2]*v[0]+m[5]*v[1]+m[8]*v[2]]; },
  // 3x4 アフィン (列優先 mat3 + 平行移動) → mat4 (Float32 16)
  _aff(m, t){ return [m[0],m[1],m[2],0, m[3],m[4],m[5],0, m[6],m[7],m[8],0, t[0],t[1],t[2],1]; },
  _affMul(A, B){   // mat4 (アフィン) 同士
    const o=new Array(16);
    for(let c=0;c<4;c++) for(let r=0;r<4;r++){ let s=0; for(let k=0;k<4;k++) s+=A[k*4+r]*B[c*4+k]; o[c*4+r]=s; }
    return o;
  },
  _sub(a,b){ return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; },
  _add(a,b){ return [a[0]+b[0],a[1]+b[1],a[2]+b[2]]; },
  _mul(a,s){ return [a[0]*s,a[1]*s,a[2]*s]; },
  _len(a){ return Math.hypot(a[0],a[1],a[2]); },
  _nrm(a){ const l=this._len(a)||1; return [a[0]/l,a[1]/l,a[2]/l]; },
  _cross(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; },
  _dot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; },
  _mix(a,b,t){ return a + (b - a)*t; },
  _sstep(e0,e1,x){ const t=Math.max(0,Math.min(1,(x-e0)/(e1-e0))); return t*t*(3-2*t); },

  // ===== GLSL 共通 (乱数・ノイズ・空・油彩) =====
  _glslCommon(){ return `
uniform float uSeed;
float sf_h2(vec2 p){
  p = fract(p*vec2(443.897, 441.423) + uSeed*0.137);
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y)*p.x);
}
float sf_vn(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0 - 2.0*f);
  return mix(mix(sf_h2(i), sf_h2(i + vec2(1.0, 0.0)), u.x), mix(sf_h2(i + vec2(0.0, 1.0)), sf_h2(i + vec2(1.0, 1.0)), u.x), u.y);
}
float sf_fbm(vec2 p){
  const mat2 R = mat2(0.80, 0.60, -0.60, 0.80);
  float a = 0.5, s = 0.0;
  for(int i = 0; i < 4; i++){ s += a*sf_vn(p); p = R*p*2.03 + 17.1; a *= 0.5; }
  return s/0.9375;
}`; },
  _glslSky(){ return `
// 雰囲気 (Mood): 雲・地平の光・光の色と向き・環境光・砂の色味・色調
uniform vec3 uCloudA, uCloudB, uGlow, uKeyCol, uAmbCol, uGroundTint, uL, uLd;
uniform vec4 uGrade;   // 彩度, コントラスト, 明るさ, 星
vec3 sf_grade(vec3 c){
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uGrade.x);
  c = (c - 0.5)*uGrade.y + 0.5;
  return c*uGrade.z;
}
float sf_hc(vec2 i){
  uvec2 q = uvec2(ivec2(i) + 65536) + uvec2(uint(uSeed)*7919u, 0u);
  uint h = q.x*1597334677u ^ q.y*3812015801u;
  h = (h ^ (h >> 16))*2246822519u; h ^= h >> 13; h *= 3266489917u; h ^= h >> 16;
  return float(h)*(1.0/4294967296.0);
}
float sf_vnc(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0 - 2.0*f);
  return mix(mix(sf_hc(i), sf_hc(i + vec2(1.0, 0.0)), u.x), mix(sf_hc(i + vec2(0.0, 1.0)), sf_hc(i + vec2(1.0, 1.0)), u.x), u.y);
}
float sf_fbmc(vec2 p){
  const mat2 R = mat2(0.80, 0.60, -0.60, 0.80);
  float a = 0.5, s = 0.0;
  for(int i = 0; i < 4; i++){ s += a*sf_vnc(p); p = R*p*2.03 + 17.1; a *= 0.5; }
  return s/0.9375;
}
uniform vec3 uSkyTop, uSkyLow;
uniform float uCloud, uCloudSpd, uYaw, uHz, uT, uBrush, uF;
uniform float uCloudScale, uCloudSoft, uBrushScale, uWeave;
uniform vec2 uCloudBand, uRollCS;
uniform vec2 uRes;
vec3 sf_skyGrad(float hy){ return mix(uSkyLow, uSkyTop, pow(smoothstep(0.0, 1.75, hy), 0.7)); }
vec3 sf_sky(vec2 uv){
  float hy = uv.y - uHz;
  vec3 col = sf_skyGrad(hy);
  float cover = 0.0;
  if(uCloud > 0.0){
    // 雲は上空の水平な面に貼る: 画面の点 → カメラの光線 → 雲の面。カメラが回ると面がそのまま回る
    //   (以前は 横座標に yaw を足していたため、Pan を上げると座標が巨大になってノイズが横縞に崩れ、
    //    地平線ほど速くずれて形がせん断されていた)
    float ct = uT*0.016*uCloudSpd;
    float tp = -uHz/uF, cpi = inversesqrt(1.0 + tp*tp), spi = tp*cpi;   // カメラの仰角 (uHz = -F·tan)
    vec3 d0 = vec3(uv.x, cpi*uv.y + spi*uF, spi*uv.y - cpi*uF);          // カメラの光線 (yaw 前)
    float cy = cos(uYaw), sy = sin(uYaw);
    vec2 dxz = vec2(cy*d0.x + sy*d0.z, -sy*d0.x + cy*d0.z);              // yaw で水平に回す (物・砂漠と同じ向き)
    float pers = 1.0/(max(d0.y/cpi, -0.3) + 0.35);                       // 地平線からの高さ (yaw に依らない)
    vec2 cp = dxz*pers*vec2(0.72, 1.0)*uCloudScale + vec2(ct*1.2, 0.0);
    float n  = sf_fbmc(cp);
    float band = smoothstep(uCloudBand.x, uCloudBand.y, hy);
    float th = 0.71 - 0.10*clamp(uCloud, 0.0, 2.0);
    float dens = smoothstep(th, th + uCloudSoft, n)*band*clamp(uCloud, 0.0, 1.0);
    float n2 = sf_fbmc(cp + vec2(0.0, 0.035));
    vec3 cc = mix(uCloudA, uCloudB, clamp((n - n2)*6.0 + 0.4, 0.0, 1.0));
    col = mix(col, cc, dens*0.8);
    cover = dens;
  }
  if(uGrade.w > 0.0){   // 星 (夜): 方角に貼るので、カメラが回れば空ごと回る
    float tp = -uHz/uF, cpi = inversesqrt(1.0 + tp*tp), spi = tp*cpi;
    vec3 d0 = vec3(uv.x, cpi*uv.y + spi*uF, spi*uv.y - cpi*uF);
    float cy = cos(uYaw), sy = sin(uYaw);
    vec3 d = normalize(vec3(cy*d0.x + sy*d0.z, d0.y, -sy*d0.x + cy*d0.z));
    vec2 g = vec2(atan(d.x, d.z)*90.0, asin(clamp(d.y, -1.0, 1.0))*90.0);
    vec2 gi = floor(g), gf = fract(g) - 0.5;
    float hs = sf_hc(gi + 51.0), hb = sf_hc(gi + 97.0);
    vec2 jo = vec2(sf_hc(gi + 13.0), sf_hc(gi + 29.0)) - 0.5;
    float st = step(0.985, hs)*smoothstep(0.30, 0.0, length(gf - jo*0.5))*(0.35 + 0.65*hb);
    st *= (0.75 + 0.25*sin(uT*3.0 + hb*40.0));   // ゆるい瞬き
    col += vec3(0.85, 0.88, 1.0)*st*uGrade.w*smoothstep(0.05, 0.35, hy)*(1.0 - cover);
  }
  return col;
}
vec2 sf_uv(){
  vec2 u = (gl_FragCoord.xy - 0.5*uRes)/uRes.y*2.0;
  if(uRollCS.y != 0.0) u = vec2(uRollCS.x*u.x - uRollCS.y*u.y, uRollCS.y*u.x + uRollCS.x*u.y);   // カメラの傾きを戻した座標
  return u;
}
vec3 sf_brush(vec3 col){
  if(uBrush <= 0.0) return col;
  vec2 px = gl_FragCoord.xy;
  float a = 0.6 + (sf_vn(px*0.0015) - 0.5)*2.2;
  vec2 dr = vec2(cos(a), sin(a));
  vec2 q = vec2(dot(px, dr), dot(px, vec2(-dr.y, dr.x)));
  float st = sf_vn(q*vec2(0.035, 0.30)*uBrushScale)*0.6 + sf_vn(q*vec2(0.08, 0.7)*uBrushScale + 7.0)*0.4;
  col *= 1.0 + (st - 0.5)*0.045*uBrush;
  col *= 1.0 + sin(px.x*1.9)*sin(px.y*1.9)*0.012*uBrush*uWeave;
  col += (sf_h2(px) - 0.5)*0.018*uBrush;
  return col;
}`; },
  // 砂丘の高さ (シェーダ版と同じ式)
  _glslDune(){ return `
uniform float uDunes;
uniform float uDuneScale;
const float SF_GY = -4.2;
vec2 sf_dwarp(vec2 x){
  vec2 q = x + 30.0*(vec2(sf_vn(x*0.008), sf_vn(x*0.008 + 5.3)) - 0.5);
  q += 9.0*(vec2(sf_vn(q*0.03 + 1.7), sf_vn(q*0.03 + 8.4)) - 0.5);
  q += 2.0*(vec2(sf_vn(q*0.12 + 3.3), sf_vn(q*0.12 + 6.1)) - 0.5);
  return q;
}
float sf_ridge(vec2 x, vec2 dir, float fq, float lee){
  float f  = fract(dot(x, dir)*fq);
  float tr = f < lee ? f/lee : (1.0 - f)/(1.0 - lee);
  float r = mix(tr*tr*(3.0 - 2.0*tr), pow(tr, 1.3), smoothstep(0.35, 0.85, tr));
  return r - 0.06*smoothstep(0.9, 1.0, tr);
}
float sf_dprof(float ph){
  float f = fract(ph);
  const float LEE = 0.24;
  if(f < 1.0 - LEE){ float u = f/(1.0 - LEE); return 0.55*pow(u, 1.35) + 0.45*(0.5 - 0.5*cos(3.14159*u)); }
  float v = (1.0 - f)/LEE;
  return mix(v, v*v, 0.25);
}
float sf_smax(float a, float b, float k){ float h = clamp(0.5 + 0.5*(a - b)/k, 0.0, 1.0); return mix(b, a, h) + k*h*(1.0 - h); }
float sf_dune(vec2 x){
  x *= uDuneScale;
  float du = clamp(uDunes, 0.0, 2.0);
  vec2  q  = sf_dwarp(x);
  float a  = sf_ridge(q, vec2(0.94, 0.34), 0.045, 0.72)*(0.30 + 0.70*sf_fbm(x*0.015 + 3.0));
  float b  = sf_ridge(q + 11.0, vec2(-0.30, 0.95), 0.07, 0.68)*(0.25 + 0.75*sf_fbm(x*0.022 + 8.0));
  float rg = 2.8*sf_smax(a, b*0.75, 0.10);
  vec2  q2 = x + 16.0*(vec2(sf_vn(x*0.010 + 2.0), sf_vn(x*0.010 + 7.3)) - 0.5);
  float sw = sf_dprof(dot(q2, vec2(0.93, 0.36))/26.0)*(0.45 + 0.55*sf_vn(x*0.02 + 13.0))*2.2;
  vec2  q3 = x + 5.0*(vec2(sf_vn(x*0.05 + 2.2), sf_vn(x*0.05 + 6.6)) - 0.5);
  float c  = sf_dprof(dot(q3, vec2(0.90, 0.44))/9.0 + 0.6*sf_vn(x*0.07))*smoothstep(0.20, 0.70, sf_vn(x*0.04 + 4.0))*0.75;
  return du*(sf_smax(sf_smax(rg, sw, 0.45), c, 0.25) + 0.35*sf_fbm(x*0.06 + 9.0));
}`; },

  // ===== init =====
  init(gl){
    if(this.initialized) return;
    this.gl = gl;
    this.startTime = performance.now()/1000;
    this._seed = 0;
    const VH = '#version 300 es\nprecision highp float;\n';

    // ── 空 (全画面) ──
    this.progSky = this._link(VH + `
out vec2 vP;
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vP = p; gl_Position = vec4(p*2.0 - 1.0, 0.0, 1.0); }`,
    VH + this._glslCommon() + this._glslSky() + `
out vec4 o;
void main(){
  vec2 uv = sf_uv();
  vec3 col = sf_sky(uv);
  col = mix(col, mix(uSkyLow, uGlow, 0.4), exp(-abs(uv.y - uHz)*90.0)*0.5);
  o = vec4(clamp(sf_brush(sf_grade(col)), 0.0, 1.0), 1.0);
}`);

    // ── 砂漠 (同心円グリッド。高さは頂点で) ──
    this.progGround = this._link(VH + this._glslCommon() + this._glslDune() + `
in vec2 aXZ;
uniform mat4 uVP;
out vec3 vW; out vec3 vN;
void main(){
  vec2 x = aXZ;
  float e = 0.06 + length(x)*0.004;
  float h  = sf_dune(x);
  float hx = sf_dune(x + vec2(e, 0.0)), hz = sf_dune(x + vec2(0.0, e));
  vN = normalize(vec3(h - hx, e, h - hz));
  vW = vec3(x.x, SF_GY + h, x.y);
  gl_Position = uVP*vec4(vW, 1.0);
}`,
    VH + this._glslCommon() + this._glslSky() + this._glslDune() + `
in vec3 vW; in vec3 vN;
uniform vec3 uSand;
uniform float uHaze, uShadow;
uniform float uSpeckle, uShadeLo;
uniform int uNS;
uniform vec4 uSP[24];          // 構造物: 位置 xyz + 大きさ
out vec4 o;
void main(){
  vec3 p = vW; vec2 x = p.xz;
  float t = length(p);
  // 法線はフラグメントで高さ場から取り直す (稜線のエッジをメッシュの解像度に左右されずに立てる)
  float e = 0.05 + t*0.004;
  float h0 = sf_dune(x);
  vec3 n = normalize(vec3(h0 - sf_dune(x + vec2(e, 0.0)), e, h0 - sf_dune(x + vec2(0.0, e))));
  // 風紋: 主に尾根の風下側の斜面
  vec2 qw = sf_dwarp(x*uDuneScale);
  float lee = step(0.72, fract(dot(qw, vec2(0.94, 0.34))*0.045));
  float rip = sin(dot(x, vec2(2.6, 6.0)) + sf_vn(x*0.8)*6.0);
  float rf  = exp(-t*0.08)*clamp(uDunes, 0.0, 2.0);
  n = normalize(n + vec3(0.0, 0.0, 0.30*rip*rf*(0.35 + 0.65*lee)));
  vec3 L  = normalize(uL);
  vec3 Ld = normalize(uLd);
  float lum = dot(uSand, vec3(0.299, 0.587, 0.114));
  float dif = smoothstep(-0.10, 0.75, dot(n, Ld));
  // 稜線の影 (短く 5 歩)
  float dsh = 1.0;
  if(uShadow > 0.0 && uDunes > 0.0){
    float st = 0.8;
    for(int k = 0; k < 5; k++){
      vec3 sp = p + Ld*st;
      dsh = min(dsh, clamp(5.0*(sp.y - (SF_GY + sf_dune(sp.xz)))/st, 0.0, 1.0));
      st *= 2.2;
    }
    dsh = mix(1.0, dsh, clamp(uShadow, 0.0, 1.0));
  }
  float v = lum*mix(uShadeLo, 1.06, dif*mix(0.15, 1.0, dsh));
  float near = exp(-t*0.12);
  v *= 0.94 + 0.08*sf_vn(x*7.0)*near + 0.04*sf_vn(x*1.3);
  v *= 1.0 + (sf_vn(x*38.0) - 0.5)*0.16*near;
  v += (sf_h2(gl_FragCoord.xy) - 0.5)*0.10*uSpeckle;
  v -= step(0.985, sf_h2(gl_FragCoord.xy + 31.7))*0.14*uSpeckle;
  v += step(0.992, sf_h2(gl_FragCoord.xy + 77.1))*0.10*uSpeckle;
  // 構造物が落とす柔らかい影
  if(uShadow > 0.0){
    float sh = 0.0;
    for(int i = 0; i < 24; i++){
      if(i >= uNS) break;
      vec4 s4 = uSP[i];
      float hgt = s4.y - p.y;
      if(hgt <= 0.0) continue;
      vec3 c = s4.xyz - L*(hgt/L.y);
      vec2 d = (x - c.xz)/(s4.w*vec2(1.25, 0.9));
      sh = max(sh, (1.0 - smoothstep(0.2, 1.1, length(d)))*exp(-hgt*0.06));
    }
    v *= 1.0 - 0.32*clamp(uShadow, 0.0, 2.0)*sh;
  }
  float fog = 1.0 - exp(-t*0.010*(0.4 + 0.6*uHaze));
  v = mix(v, lum*0.97, clamp(fog, 0.0, 0.9));
  o = vec4(clamp(sf_brush(sf_grade(vec3(v)*uGroundTint)), 0.0, 1.0), 1.0);
}`);

    // ── 部品 (インスタンス) ──
    //   aI0..3 = モデル行列 (アフィン。せん断を含む)、aIA = (材質, 色の番号, 消え, 形)、aIB = 形ごとの値
    this.progObj = this._link(VH + this._glslCommon() + `
in vec3 aPos; in vec3 aNrm;
in vec4 aI0, aI1, aI2, aI3; in vec4 aIA, aIB;
invariant gl_Position;   // 深度だけのパスと色のパスで深度が必ず一致する (タイル GPU で半透明の面が消えないように)
uniform mat4 uVP;
uniform float uT;
out vec3 vW; out vec3 vN; out vec3 vL; out vec3 vLN; out vec4 vA; out vec4 vB;
// 布: 上端は固定、裾ほど大きく風に揺れる (ゆっくりした揺れ + 突風 + 裾へ下りるはためき)
vec3 sf_clothPos(float x, float s, vec4 b){
  float w = b.x, len = b.y, ph = b.z;
  if(b.w > 0.5){
    // 単体で舞う布: 長さ方向に丸まり、ねじれ、カップ状にたわみ、ときどき自分の上へひっくり返る
    float u = x, v = s*2.0 - 1.0;                              // -1..1
    float a  = v*len*0.5;                                      // 長さ方向の弧長
    float cu = 2.8*sin(uT*0.33 + ph) + 1.1*sin(uT*0.87 + ph*1.7);        // 丸まり (弧全体の曲がり角, ±3.9 rad → 裏返る)
    float k  = cu/max(len, 0.05);
    float ka = k*a;
    float yy, zz;
    if(abs(k) < 1e-3){ yy = -a; zz = 0.0; } else { yy = -sin(ka)/k; zz = (1.0 - cos(ka))/k; }
    vec3 N = vec3(0.0, sin(ka), cos(ka));                      // 弧の法線
    float X  = u*w;
    float tw = (1.6*sin(uT*0.41 + ph*2.0) + 0.6*sin(uT*1.13 + ph))*v;   // ねじれ
    vec3 P = vec3(X*cos(tw), yy, zz) + N*(X*sin(tw));
    float kc = 1.4*sin(uT*0.52 + ph*3.0)/max(w, 0.05);        // 幅方向のたわみ (カップ状)
    P += N*((abs(kc) < 1e-3) ? 0.0 : (1.0 - cos(kc*X))/kc);
    // 細かなはためきとヒダ
    P += N*len*(0.06*sin(u*4.2 + ph + uT*1.3)*(0.3 + 0.7*abs(v)) + 0.05*sin(v*5.0 - uT*2.6 + ph));
    return P;
  }
  // 吊られた布: 上端は固定。裾ほど大きくはためき、ねじれ、裾の角は風でめくれ上がる
  float wnd  = 0.55*sin(uT*0.62 + ph) + 0.9*(sf_vn(vec2(uT*0.45, ph*3.7)) - 0.5);
  float trav = sin(s*4.2 - uT*1.7 + ph)*s;
  float X  = x*w*(1.0 + 0.25*s) + 0.12*wnd*s*s*len;
  float pf = x*(1.0 + 0.25*s)*4.6 + ph + s*(0.9*sin(uT*0.55 + ph + s*2.2) + 0.5*wnd);
  float amp = 0.07*(0.45 + 0.85*s)*(1.0 + 0.35*wnd);
  float Z  = amp*(sin(pf) + 0.25*sin(pf*2.1 + 1.0)) + 0.50*wnd*s*s*len + 0.09*trav*len;
  float hem = 0.035*sin(x*6.0 + ph + uT*0.8) + 0.03*wnd;
  float Y  = -s*(len - hem*s);
  Y += 0.55*len*s*s*s*(0.4 + max(0.0, wnd))*(0.5 + 0.5*x*sin(uT*0.7 + ph));     // 裾の角がめくれ上がる
  // 裾が風で巻き上がる (下ほど前へ丸まる)
  float rl = 1.6*s*s*s*(0.5 + 0.5*sin(uT*0.5 + ph*1.3));
  Z += len*0.25*(1.0 - cos(rl)); Y += len*0.25*sin(rl)*0.6;
  float tw = 1.6*s*s*(wnd + 0.4*sin(uT*0.9 + ph));                     // 縦軸まわりのねじれ
  return vec3(X*cos(tw) - Z*sin(tw), Y, X*sin(tw) + Z*cos(tw));
}
// 柔らかいもの (不定形・石膏球) の変形: 全体がゆっくり曲がり、表面のこぶが流れ続ける
vec3 sf_soft(vec3 p, vec3 n, float ph, float amt){
  vec3 q = p + amt*0.16*vec3(sin(p.y*2.1 + uT*0.55 + ph), sin(p.z*1.9 + uT*0.47 + ph*1.3), sin(p.x*2.3 + uT*0.62 + ph*0.7));
  float b = sf_vn(p.xy*2.4 + vec2(uT*0.28, ph)) + sf_vn(p.yz*2.6 - vec2(uT*0.23, ph*1.7)) + 0.5*sf_vn(p.zx*5.0 + uT*0.4) - 1.25;
  return q + n*amt*0.16*b;
}
void main(){
  mat4 M = mat4(aI0, aI1, aI2, aI3);
  vec3 lp = aPos, ln = aNrm;
  float prim = aIA.w;
  if(prim > 2.5 && prim < 3.5){                     // 管: 根元→先で太さを変える (しっぽの先細り)
    float r = mix(aIB.x, aIB.y, aPos.y);
    lp = vec3(aPos.x*r, aPos.y, aPos.z*r);
  } else if(prim > 5.5 && prim < 6.5){              // 布
    float x = aPos.x, s = -aPos.y;
    lp = sf_clothPos(x, s, aIB);
    float e = 0.02;
    vec3 dx = sf_clothPos(x + e, s, aIB) - lp;
    vec3 ds = sf_clothPos(x, s + e, aIB) - lp;
    ln = normalize(cross(dx, ds));
  }
  if(prim > 6.5 && prim < 7.5){                     // 不定形: ゆっくり息をし、下へ溶けて垂れる。変なものほど指数的にうねる
    float ph = aIB.x, wd = aIB.z;
    float wx = (exp(1.2*wd) - 1.0)*0.6;
    float tw = aPos.y*wx*1.2*sin(uT*0.23 + ph);                       // ねじれ
    lp.xz = mat2(cos(tw), sin(tw), -sin(tw), cos(tw))*lp.xz;
    lp += ln*(0.035*(1.0 + 2.0*wx)*sin(uT*0.7 + dot(aPos, vec3(4.1, 6.3, 2.7)) + ph) + 0.02*sin(uT*1.9 + aPos.y*9.0 + ph));
    lp += ln*0.10*wx*(sf_vn(aPos.xy*3.0 + vec2(uT*0.15, ph)) - 0.5);   // こぶがわき上がる
    lp.y -= aIB.y*max(0.0, -aPos.y)*max(0.0, -aPos.y)*(0.6 + 0.4*sin(uT*0.31 + ph));
  }
  // 固い部品 (板・管・輪・窓) 以外は変形し続ける
  float soft = (prim > 6.5 && prim < 7.5) ? (0.8 + 0.8*(exp(1.2*aIB.z) - 1.0))*(aIB.w > 0.5 ? 0.25 : 1.0) : ((prim > 3.5 && prim < 4.5 && aIA.x > 3.5 && aIA.x < 4.5) ? 0.55 : 0.0);
  if(soft > 0.0){
    float ph = ((prim > 6.5 && prim < 7.5) ? aIB.x : 0.0) + aIA.y*17.0;
    vec3 t1 = normalize(cross(ln, abs(ln.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(ln, t1);
    float e = 0.03;
    vec3 p0 = sf_soft(lp, ln, ph, soft);
    vec3 p1 = sf_soft(lp + t1*e, ln, ph, soft);
    vec3 p2 = sf_soft(lp + t2*e, ln, ph, soft);
    vec3 nn = cross(p1 - p0, p2 - p0);
    if(dot(nn, ln) < 0.0) nn = -nn;
    lp = p0; ln = normalize(nn);
  }
  vec4 wp = M*vec4(lp, 1.0);
  vW = wp.xyz;
  mat3 m3 = mat3(M);
  vN = normalize(transpose(inverse(m3))*ln);
  vL = aPos; vLN = aNrm; vA = aIA; vB = aIB;
  gl_Position = uVP*wp;
}`,
    VH + this._glslCommon() + this._glslSky() + `
in vec3 vW; in vec3 vN; in vec3 vL; in vec3 vLN; in vec4 vA; in vec4 vB;
uniform vec3 uSand;
uniform float uHaze;
out vec4 o;
// ── 質感用の 3D ノイズ (整数ハッシュ) ──
float sf_h3(vec3 p){
  uvec3 q = uvec3(ivec3(floor(p)) + 32768);
  uint h = q.x*1597334677u ^ q.y*3812015801u ^ q.z*2798796415u;
  h = (h ^ (h >> 16))*2246822519u; h ^= h >> 13; h *= 3266489917u; h ^= h >> 16;
  return float(h)*(1.0/4294967296.0);
}
float sf_n3(vec3 p){
  vec3 i = floor(p), f = fract(p); vec3 u = f*f*(3.0 - 2.0*f);
  return mix(mix(mix(sf_h3(i), sf_h3(i + vec3(1,0,0)), u.x), mix(sf_h3(i + vec3(0,1,0)), sf_h3(i + vec3(1,1,0)), u.x), u.y),
             mix(mix(sf_h3(i + vec3(0,0,1)), sf_h3(i + vec3(1,0,1)), u.x), mix(sf_h3(i + vec3(0,1,1)), sf_h3(i + vec3(1,1,1)), u.x), u.y), u.z);
}
// fbm: 細かい層ほど、1 ピクセルの大きさ (fp) に対して細かすぎれば弱める (遠くでちらつかない)
float sf_f3(vec3 p, float fp, int oct){
  float a = 0.5, s = 0.0, w = 0.0, fq = 1.0;
  for(int i = 0; i < 5; i++){ if(i >= oct) break;
    float k = 1.0 - smoothstep(0.25, 0.7, fq*fp);
    s += a*mix(0.5, sf_n3(p), k); w += a; p = p*2.07 + vec3(11.3, 5.1, 7.7); fq *= 2.07; a *= 0.5; }
  return s/w;
}
float sf_det(float fq, float fp){ return 1.0 - smoothstep(0.25, 0.7, fq*fp); }
// 画面上の微分による凹凸 (h = 世界の長さでの高さ)
vec3 sf_bump(vec3 n, vec3 p, float h){
  vec3 dpdx = dFdx(p), dpdy = dFdy(p);
  float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  if(abs(det) < 1e-12) return n;
  vec3 g = sign(det)*(dhx*r1 + dhy*r2);
  return normalize(abs(det)*n - g);
}
vec3 sf_curtainWindow(vec2 u){   // u = 窓ローカル (-1..1)
  vec2 a = abs(u);
  float frame = step(0.86, a.x) + step(0.92, a.y);
  vec3 col = vec3(0.90, 0.89, 0.90);
  if(frame < 0.5){
    float tie  = 0.55 - 0.5*exp(-pow((u.y + 0.15)*3.0, 2.0));
    float gap  = 1.0 - smoothstep(tie*0.12, tie*0.12 + 0.05, a.x);
    float fold = 0.80 + 0.20*sin(u.x*26.0 + u.y*2.0);
    col = vec3(0.95, 0.94, 0.92)*fold;
    col = mix(col, vec3(0.62, 0.60, 0.66), gap*0.8);
  }
  return col;
}
void main(){
  float mat = vA.x;
  vec3 nw = normalize(vN);
  vec3 V  = normalize(-vW);
  if(dot(nw, V) < 0.0) nw = -nw;                    // 薄い板・布は両面
  vec3 L  = normalize(uL);
  // 1 ピクセルあたりの局所座標の大きさ (細部の弱め方) と、局所 → 世界の倍率 (凹凸の強さを物の大きさに合わせる)
  vec3 fwL = fwidth(vL), fwW = fwidth(vW);
  float fp = max(length(fwL), 1e-5);
  float sc = length(fwW)/fp;
  float tid = vA.y*37.0;                             // 物ごとの模様のずらし
  vec3 alb; float spec = 0.0, shin = 8.0, hL = 0.0, wrap = 0.0, sheen = 0.0;
  if(mat < 1.5){
    // 板: 面は刷毛目の残る暗い紫褐色の塗装 (ところどころ剥げて下地が覗く)、小口は白い木口
    float br  = sf_vn(vL.xy*vec2(3.0, 70.0) + tid)*0.6 + sf_vn(vL.xy*vec2(9.0, 160.0) + tid*1.3)*0.4*sf_det(160.0, fp);
    float blo = sf_f3(vL*vec3(2.5, 6.0, 2.5) + tid, fp, 3);
    vec3 face = mix(vec3(0.31, 0.24, 0.29), vec3(0.41, 0.32, 0.37), blo)*(0.90 + 0.16*br);
    face = mix(face, vec3(0.30, 0.25, 0.32), smoothstep(-0.4, 0.4, vL.y)*0.35);
    float chip = smoothstep(0.78, 0.84, sf_f3(vL*vec3(9.0, 22.0, 9.0) + tid + 3.0, fp, 3));
    face = mix(face, vec3(0.74, 0.70, 0.68), chip*0.85);
    vec3 endg = vec3(0.88, 0.86, 0.85)*(0.90 + 0.12*sf_vn(vL.yz*vec2(50.0, 4.0) + tid)*sf_det(50.0, fp));
    float isFace = smoothstep(0.35, 0.75, abs(vLN.z));
    alb = mix(endg, face, isFace);
    hL = (0.0025*br - 0.004*chip)*isFace;
    spec = 0.10*(1.0 - chip)*isFace; shin = 18.0;
  } else if(mat < 3.5){
    // 白い金属管: 管の向きの細かな擦り目、わずかなくすみ
    float ang = atan(vL.z, vL.x);
    float bru = sf_vn(vec2(ang*40.0, vL.y*1.5) + tid)*sf_det(40.0, fp);
    float tar = sf_f3(vL*3.0 + tid, fp, 3);
    alb = vec3(0.80, 0.80, 0.83)*(0.93 + 0.10*bru)*(0.92 + 0.10*tar);
    spec = 0.35 + 0.30*bru; shin = 30.0;
    hL = 0.0008*bru;
  } else if(mat < 4.5){
    // 石膏: 温かい白。細かな気泡の穴と、手でならした面のゆるいムラ
    float m1 = sf_f3(vL*2.0 + tid, fp, 3);
    float pit = smoothstep(0.80, 0.90, sf_n3(vL*38.0 + tid))*sf_det(38.0, fp);
    float gr  = sf_n3(vL*90.0 + tid)*sf_det(90.0, fp);
    alb = vec3(0.92, 0.91, 0.89)*(0.93 + 0.08*m1 + 0.04*gr)*(1.0 - 0.35*pit);
    hL = 0.012*m1 - 0.006*pit + 0.0015*gr;
    spec = 0.04; shin = 10.0; wrap = 0.15;
  } else if(mat < 5.5){
    alb = abs(vLN.z) > 0.5 ? sf_curtainWindow(vL.xy) : vec3(0.88, 0.87, 0.88);
  } else if(mat < 6.5){
    // 白い布: 織り目と、わずかな色むら。縁に布らしい艶
    float wv = (sin(vL.x*420.0)*sin(vL.y*420.0)*0.5 + 0.5)*sf_det(130.0, fp);
    float mu = sf_f3(vL*4.0 + tid, fp, 3);
    alb = vec3(0.95, 0.94, 0.93)*(0.95 + 0.05*mu)*(0.97 + 0.04*wv);
    hL = 0.0006*wv; sheen = 0.10;
  } else if(mat < 7.5){
    // 不定形: 白寄りの、柔らかく光が回り込む肌 (下側だけほんのり藤色)
    float mu = sf_f3(vL*3.0 + tid, fp, 4);
    alb = mix(vec3(0.80, 0.79, 0.84), vec3(0.96, 0.95, 0.95), smoothstep(-0.7, 0.4, vL.y));
    alb *= 0.95 + 0.06*mu;
    if(vB.w > 0.5){ hL = 0.003*mu; spec = 0.45; shin = 46.0; wrap = 0.12; }   // キキ: 硬い陶器のような白
    else          { hL = 0.004*mu; spec = 0.20; shin = 22.0; wrap = 0.40; }   // ブーバ: 柔らかな白 (なめらか)
  } else if(mat < 8.5){
    // 岩: 風化した石。大きな色むら → 地層のかすかな縞 → 窪みの陰り → まばらな細いひび → 粒と長石の白い斑
    vec3 q  = vL*1.8 + tid;
    float f  = sf_f3(q, fp*1.8, 5);                                   // 大きな塊の起伏と色むら
    float cv = sf_f3(q*0.6 + 4.7, fp*1.1, 3);                          // 窪み
    float st = sin(dot(vL, vec3(0.18, 1.0, 0.12))*13.0 + f*4.0 + tid)*0.5 + 0.5;   // 地層
    float rn = sf_f3(q*2.2 + 7.0, fp*4.0, 3);
    float ck = 1.0 - smoothstep(0.012, 0.012 + 0.03 + 8.0*fp, abs(rn - 0.5));      // ひび (等値線を細く)
    ck *= smoothstep(0.55, 0.70, sf_n3(q*0.9 + 2.0))*sf_det(4.0, fp);              // まばらに
    float gn = sf_n3(vL*70.0 + tid)*sf_det(70.0, fp);                  // 粒
    float g2 = sf_n3(vL*25.0 + tid + 3.0)*sf_det(25.0, fp);
    float fs = smoothstep(0.80, 0.90, sf_n3(vL*30.0 + tid + 9.0))*sf_det(30.0, fp);   // 白い長石の斑
    vec3 dark = vec3(0.44, 0.41, 0.38), lite = vec3(0.72, 0.68, 0.62);
    alb = mix(dark, lite, smoothstep(0.25, 0.75, f));
    alb = mix(alb, alb*vec3(1.05, 0.98, 0.92), st*0.30);
    alb *= 0.88 + 0.14*gn + 0.08*g2;
    alb = mix(alb, vec3(0.84, 0.82, 0.78), fs*0.5);
    alb *= mix(0.70, 1.0, smoothstep(0.30, 0.62, cv));                 // 窪みは暗く
    alb = mix(alb, alb*0.45, ck*0.8);
    hL = 0.08*f + 0.05*cv + 0.008*st + 0.004*gn + 0.003*g2 - 0.012*ck;
    spec = 0.05 + 0.06*fs; shin = 9.0;
  } else if(mat < 9.5){
    // 山高帽: フェルト (細かい毛羽と、縁の柔らかい光)
    float fz = sf_n3(vL*140.0 + tid)*sf_det(140.0, fp);
    alb = vec3(0.10, 0.10, 0.11)*(0.90 + 0.20*fz); spec = 0.06; shin = 8.0; sheen = 0.18;
    hL = 0.0008*fz;
    if(abs(vL.y - 0.16) < 0.035){ alb = vec3(0.05, 0.05, 0.06); spec = 0.25; shin = 30.0; sheen = 0.05; }   // 絹のリボン
  } else if(mat < 10.5){
    float gr = sf_vn(vec2(atan(vL.z, vL.x)*12.0, vL.y*40.0));
    alb = vec3(0.40, 0.33, 0.23)*(0.85 + 0.25*gr); spec = 0.10; shin = 12.0;   // 林檎の柄
  } else {
    // 林檎: くすんだ緑に、縦の黄色い筋とうっすら赤み、細かい果点、蝋の艶
    float ang = atan(vL.z, vL.x);
    float sk = sf_vn(vec2(ang*7.0, vL.y*1.5) + tid)*0.6 + sf_vn(vec2(ang*19.0, vL.y*3.0) + tid)*0.4;
    float bl = sf_f3(vL*1.6 + tid, fp, 3);
    alb = mix(vec3(0.40, 0.53, 0.27), vec3(0.62, 0.68, 0.34), sk);
    alb = mix(alb, vec3(0.62, 0.40, 0.26), smoothstep(0.55, 0.80, bl)*0.35);
    float lt = smoothstep(0.86, 0.94, sf_n3(vL*48.0 + tid))*sf_det(48.0, fp);
    alb = mix(alb, vec3(0.80, 0.80, 0.62), lt*0.6);
    hL = 0.0015*lt + 0.002*bl;
    spec = 0.45; shin = 40.0;
  }
  nw = sf_bump(nw, vW, hL*sc);
  float dif = clamp(dot(nw, L)*0.55 + 0.45, 0.0, 1.0); dif *= dif;
  dif = mix(dif, clamp((dot(nw, L) + 0.6)/1.6, 0.0, 1.0), wrap);   // 柔らかい物は光が回り込む
  if(mat > 5.5 && mat < 6.5) dif = mix(0.50, 1.0, dif);
  vec3 key    = uKeyCol*dif;
  vec3 skyF   = uAmbCol*(0.5 + 0.5*nw.y)*0.55;
  vec3 bounce = uSand*vec3(0.85, 0.80, 0.84)*(0.5 - 0.5*nw.y)*0.45;
  vec3 col = alb*(key*0.85 + skyF + bounce);
  col += spec*pow(max(dot(nw, normalize(L + V)), 0.0), shin)*uKeyCol*vec3(1.0, 1.01, 1.03);
  if(mat > 5.5 && mat < 6.5) col += vec3(0.95, 0.90, 0.88)*0.22*max(dot(-nw, L), 0.0);   // 布の透け
  col += sheen*pow(1.0 - max(dot(nw, V), 0.0), 3.0)*mix(uSkyTop, vec3(1.0), 0.6);   // 布・フェルトの縁の艶
  vec2 uv = sf_uv();
  vec3 skyH = sf_skyGrad(uv.y - uHz);
  float haze = 1.0 - exp(-length(vW)*0.022*uHaze);
  col = mix(col, skyH, clamp(haze, 0.0, 0.85));
  o = vec4(clamp(sf_brush(sf_grade(col)), 0.0, 1.0), clamp(vA.z, 0.0, 1.0));   // 地平線へ遠ざかるものは本当に透けて消える
}`);
    if(!this.progSky || !this.progGround || !this.progObj){ this.initialized = true; this.ok = false; return; }

    this.vaoSky = gl.createVertexArray();
    this._buildGround();
    this._buildMeshes();
    this.instVBO = gl.createBuffer();
    this.initialized = true; this.ok = true;
  },

  _link(vs, fs){
    const gl = this.gl;
    const mk = (type, src)=>{
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){ console.error('[surrealfloat] shader', gl.getShaderInfoLog(s)); return null; }
      return s;
    };
    const v = mk(gl.VERTEX_SHADER, vs), f = mk(gl.FRAGMENT_SHADER, fs);
    if(!v || !f) return null;
    const p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f);
    gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 0, 'aXZ');
    gl.bindAttribLocation(p, 1, 'aNrm');
    ['aI0','aI1','aI2','aI3','aIA','aIB'].forEach((n,i)=>gl.bindAttribLocation(p, 2 + i, n));
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)){ console.error('[surrealfloat] link', gl.getProgramInfoLog(p)); return null; }
    p._u = {};
    p.U = (n)=>{ if(!(n in p._u)) p._u[n] = gl.getUniformLocation(p, n); return p._u[n]; };
    return p;
  },

  // 砂漠: カメラ中心の同心円グリッド (近くは細かく、遠くは粗い)
  _buildGround(){
    const gl = this.gl;
    const NR = 150, NA = 300, R0 = 0.6, R1 = 340.0;
    const xz = [];
    for(let r=0;r<=NR;r++){
      const rad = R0*Math.pow(R1/R0, r/NR);
      for(let a=0;a<=NA;a++){ const t = a/NA*Math.PI*2; xz.push(Math.cos(t)*rad, Math.sin(t)*rad); }
    }
    const idx = [];
    for(let r=0;r<NR;r++) for(let a=0;a<NA;a++){
      const i0 = r*(NA+1) + a, i1 = i0 + 1, i2 = i0 + NA + 1, i3 = i2 + 1;
      idx.push(i0, i2, i1, i1, i2, i3);
    }
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(xz), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.ground = { vao, count: idx.length };
  },

  // ===== 部品メッシュ =====
  _buildMeshes(){
    const M = this.meshes;
    // 1 箱 (-1..1)
    M.box = this._meshFrom(this._geoBox());
    // 2 三角柱: (-1,-1),(1,-1),(0,1) を z -1..1 に押し出す
    M.tri = this._meshFrom(this._geoTri());
    // 3 管: 半径 1、y 0..1
    M.cyl = this._meshFrom(this._geoCyl(12));
    // 4 球
    M.sph = this._meshFrom(this._geoSphere(28, 18));
    // 5 輪: xz 平面、大半径 1・管 0.2
    M.tor = this._meshFrom(this._geoTorus(32, 8, 0.2));
    // 6 布: x -1..1, y 0..-1
    M.clo = this._meshFrom(this._geoGrid(24, 36));
    // 7 不定形: 毎回ちがう形を NBLOB 種、距離関数から surface nets でメッシュ化 (穴・触手・垂れ・ねじれ)
    this.blobTypes = [];
    for(let k=0;k<this.NBLOB;k++){ M['b'+k] = this._meshFrom(this._geoBlob(k)); this.blobTypes.push('b'+k); }
    // 8 岩 (マグリット「ピレネーの城」のような、ごつごつした卵形の大岩) 4 種
    for(let k=0;k<4;k++) M['rk'+k] = this._meshFrom(this._geoRock(k));
    // 9 回転体: 山高帽 / 林檎
    M.hat  = this._meshFrom(this._geoLathe([[0,0.62],[0.22,0.61],[0.34,0.56],[0.40,0.45],[0.42,0.30],[0.43,0.16],[0.44,0.10],[0.70,0.07],[0.80,0.05],[0.82,0.02],[0.78,0.00],[0.45,0.02],[0.41,0.0],[0,0.0]], 40));
    M.apple = this._meshFrom(this._geoLathe([[0,-0.42],[0.20,-0.48],[0.40,-0.40],[0.50,-0.18],[0.52,0.05],[0.48,0.26],[0.36,0.40],[0.18,0.42],[0.06,0.34],[0,0.30]], 36));

  },
  _meshFrom(g){
    const gl = this.gl;
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.v), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(g.i), gl.STATIC_DRAW);
    // インスタンス属性はここで instVBO に結び直す (render で)
    gl.bindVertexArray(null);
    return { vao, count: g.i.length };
  },
  _geoBox(){
    const v=[], i=[];
    const faces = [[0,1],[0,-1],[1,1],[1,-1],[2,1],[2,-1]];
    for(const [ax, sg] of faces){
      const u = (ax+1)%3, w = (ax+2)%3, b = v.length/6;
      for(const [a,c] of [[-1,-1],[1,-1],[1,1],[-1,1]]){
        const p=[0,0,0], n=[0,0,0]; p[ax]=sg; p[u]=a; p[w]=c*sg; n[ax]=sg;
        v.push(...p, ...n);
      }
      i.push(b,b+1,b+2, b,b+2,b+3);
    }
    return {v,i};
  },
  _geoTri(){
    const v=[], i=[];
    const P2 = [[-1,-1],[1,-1],[0,1]];
    for(const z of [1,-1]){ const b=v.length/6; for(const p of P2) v.push(p[0],p[1],z, 0,0,z); i.push(b,b+1,b+2); }
    for(let k=0;k<3;k++){
      const a=P2[k], c=P2[(k+1)%3];
      const n = this._nrm([c[1]-a[1], -(c[0]-a[0]), 0]);
      const b=v.length/6;
      v.push(a[0],a[1],1, ...n, c[0],c[1],1, ...n, c[0],c[1],-1, ...n, a[0],a[1],-1, ...n);
      i.push(b,b+1,b+2, b,b+2,b+3);
    }
    return {v,i};
  },
  _geoCyl(S){
    const v=[], i=[];
    for(let y=0;y<=1;y++) for(let s=0;s<=S;s++){ const t=s/S*Math.PI*2; v.push(Math.cos(t),y,Math.sin(t), Math.cos(t),0,Math.sin(t)); }
    for(let s=0;s<S;s++){ const a=s, b=s+1, c=s+S+1, d=s+S+2; i.push(a,c,b, b,c,d); }
    return {v,i};
  },
  _geoSphere(NU, NV){
    const v=[], i=[];
    for(let y=0;y<=NV;y++){ const ph=y/NV*Math.PI; for(let x=0;x<=NU;x++){ const th=x/NU*Math.PI*2;
      const p=[Math.sin(ph)*Math.cos(th), Math.cos(ph), Math.sin(ph)*Math.sin(th)]; v.push(...p, ...p); } }
    for(let y=0;y<NV;y++) for(let x=0;x<NU;x++){ const a=y*(NU+1)+x, b=a+1, c=a+NU+1, d=c+1; i.push(a,c,b, b,c,d); }
    return {v,i};
  },
  _geoTorus(NU, NV, r){
    const v=[], i=[];
    for(let a=0;a<=NU;a++){ const t=a/NU*Math.PI*2; const ct=Math.cos(t), st=Math.sin(t);
      for(let b=0;b<=NV;b++){ const p=b/NV*Math.PI*2; const cp=Math.cos(p), sp=Math.sin(p);
        v.push((1+r*cp)*ct, r*sp, (1+r*cp)*st, cp*ct, sp, cp*st); } }
    for(let a=0;a<NU;a++) for(let b=0;b<NV;b++){ const q=a*(NV+1)+b, w=q+1, e=q+NV+1, f=e+1; i.push(q,e,w, w,e,f); }
    return {v,i};
  },
  // 回転体: prof = [[半径, 高さ], ...] を y 軸まわりに回す (法線は輪郭の傾きから)
  _geoLathe(prof, S){
    const v=[], i=[], n = prof.length;
    for(let k=0;k<n;k++){
      const a = prof[Math.max(0,k-1)], b = prof[Math.min(n-1,k+1)];
      let dr = b[0]-a[0], dy = b[1]-a[1]; const l = Math.hypot(dr,dy)||1; dr/=l; dy/=l;
      for(let s=0;s<=S;s++){ const t=s/S*Math.PI*2, c=Math.cos(t), si=Math.sin(t);
        v.push(prof[k][0]*c, prof[k][1], prof[k][0]*si, dy*c, -dr, dy*si); }
    }
    for(let k=0;k<n-1;k++) for(let s=0;s<S;s++){ const a=k*(S+1)+s, b=a+1, c=a+S+1, d=c+1; i.push(a,c,b, b,c,d); }
    return {v,i};
  },
  // 3D の値ノイズ (岩の凹凸用)
  _vn3(x,y,z){
    const fl=Math.floor, X=fl(x), Y=fl(y), Z=fl(z), fx=x-X, fy=y-Y, fz=z-Z;
    const H=(a,b,c)=>{ const n=Math.sin(a*127.1+b*311.7+c*74.7)*43758.5453; return n-Math.floor(n); };
    const u=fx*fx*(3-2*fx), w=fy*fy*(3-2*fy), q=fz*fz*(3-2*fz), L=(a,b,t)=>a+(b-a)*t;
    return L(L(L(H(X,Y,Z),H(X+1,Y,Z),u), L(H(X,Y+1,Z),H(X+1,Y+1,Z),u), w), L(L(H(X,Y,Z+1),H(X+1,Y,Z+1),u), L(H(X,Y+1,Z+1),H(X+1,Y+1,Z+1),u), w), q);
  },
  _geoRock(k){
    const r = this._rngFrom(4441 + k*1237);
    const R = (a,b)=> a + (b - a)*r();
    const ax = [R(0.8,1.15), R(0.75,1.05), R(0.75,1.1)];
    const planes = []; for(let i=0;i<5;i++){ const d = this._nrm([R(-1,1), R(-1,1), R(-1,1)]); planes.push([d, R(0.55, 0.85)]); }   // 割れて平らになった面
    const off = [R(0,50), R(0,50), R(0,50)];
    const sdf = (p)=>{
      let d = Math.hypot(p[0]/ax[0], (p[1] + 0.12*p[1]*p[1])/ax[1], p[2]/ax[2]) - 0.82;   // 下が少し尖った卵形
      let n = 0, a = 0.5, f = 2.2;
      for(let o=0;o<4;o++){ n += a*(this._vn3(p[0]*f+off[0], p[1]*f+off[1], p[2]*f+off[2]) - 0.5); a *= 0.5; f *= 2.1; }
      d += 0.30*n;
      for(const [nv, h] of planes) d = Math.max(d, this._dot(p, nv) - h);
      return d;
    };
    return this._geoSDF(sdf, 46, 1.35);
  },
  // 距離関数 → surface nets (不定形と同じ手順の汎用版)
  _geoSDF(sdf, N, B){
    const h = 2*B/N;
    const val = new Float32Array((N+1)*(N+1)*(N+1));
    const I = (x,y,z)=> (z*(N+1) + y)*(N+1) + x;
    for(let z=0;z<=N;z++) for(let y=0;y<=N;y++) for(let x=0;x<=N;x++) val[I(x,y,z)] = sdf([-B + x*h, -B + y*h, -B + z*h]);
    const vid = new Int32Array(N*N*N).fill(-1);
    const C = (x,y,z)=> (z*N + y)*N + x;
    const pos = [];
    const E = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
    for(let z=0;z<N;z++) for(let y=0;y<N;y++) for(let x=0;x<N;x++){
      const c = []; let mask = 0;
      for(let n=0;n<8;n++){ const vv = val[I(x+(n&1), y+((n>>1)&1), z+((n>>2)&1))]; c.push(vv); if(vv < 0) mask |= 1<<n; }
      if(mask === 0 || mask === 255) continue;
      let sx=0, sy=0, sz=0, cnt=0;
      for(const [a,b] of E){
        if((c[a] < 0) === (c[b] < 0)) continue;
        const t = c[a]/(c[a] - c[b]);
        sx += (a&1) + (((b&1)-(a&1)))*t; sy += ((a>>1)&1) + ((((b>>1)&1)-((a>>1)&1)))*t; sz += ((a>>2)&1) + ((((b>>2)&1)-((a>>2)&1)))*t; cnt++;
      }
      vid[C(x,y,z)] = pos.length; pos.push([-B + (x + sx/cnt)*h, -B + (y + sy/cnt)*h, -B + (z + sz/cnt)*h]);
    }
    const idx = [];
    const quad = (a,b,c,d,flip)=>{ if(a<0||b<0||c<0||d<0) return; if(flip) idx.push(a,c,b, a,d,c); else idx.push(a,b,c, a,c,d); };
    for(let z=1;z<N;z++) for(let y=1;y<N;y++) for(let x=0;x<N;x++){ const s0 = val[I(x,y,z)] < 0, s1 = val[I(x+1,y,z)] < 0; if(s0 === s1) continue;
      quad(vid[C(x,y-1,z-1)], vid[C(x,y,z-1)], vid[C(x,y,z)], vid[C(x,y-1,z)], s1); }
    for(let z=1;z<N;z++) for(let y=0;y<N;y++) for(let x=1;x<N;x++){ const s0 = val[I(x,y,z)] < 0, s1 = val[I(x,y+1,z)] < 0; if(s0 === s1) continue;
      quad(vid[C(x-1,y,z-1)], vid[C(x-1,y,z)], vid[C(x,y,z)], vid[C(x,y,z-1)], s1); }
    for(let z=0;z<N;z++) for(let y=1;y<N;y++) for(let x=1;x<N;x++){ const s0 = val[I(x,y,z)] < 0, s1 = val[I(x,y,z+1)] < 0; if(s0 === s1) continue;
      quad(vid[C(x-1,y-1,z)], vid[C(x,y-1,z)], vid[C(x,y,z)], vid[C(x-1,y,z)], s1); }
    const v = [];
    for(const p of pos){
      const e = 0.01;
      const g = [ sdf([p[0]+e,p[1],p[2]]) - sdf([p[0]-e,p[1],p[2]]), sdf([p[0],p[1]+e,p[2]]) - sdf([p[0],p[1]-e,p[2]]), sdf([p[0],p[1],p[2]+e]) - sdf([p[0],p[1],p[2]-e]) ];
      v.push(...p, ...this._nrm(g));
    }
    return { v, i: idx };
  },
  _geoGrid(NX, NY){
    const v=[], i=[];
    for(let y=0;y<=NY;y++) for(let x=0;x<=NX;x++) v.push(-1 + 2*x/NX, -y/NY, 0, 0,0,1);
    for(let y=0;y<NY;y++) for(let x=0;x<NX;x++){ const a=y*(NX+1)+x, b=a+1, c=a+NX+1, d=c+1; i.push(a,c,b, b,c,d); }
    return {v,i};
  },
  // ===== 不定形 (イヴ・タンギー風) =====
  // 種ごとに乱数で距離関数を組む: 楕円体の塊 + 曲がって先細る触手 + 垂れ + くり抜いた穴 + ねじれ + こぶ
  _rngFrom(seed){ let x = (seed*2654435761 + 1013904223) >>> 0; return ()=>{ x ^= x<<13; x ^= x>>>17; x ^= x<<5; x >>>= 0; return x/4294967296; }; },
  // 不定形の種 k ほど指数的に変になる (0 = 小石のよう … NBLOB-1 = 触手・穴・ねじれだらけ)
  // 不定形は ブーバ / キキ (ブーバ・キキ効果): 偶数の種 = 丸くふくらむ「ブーバ」、奇数の種 = 尖った角が放射する「キキ」
  //   種の番号が大きいほど指数的に変になる (ブーバ = ふくらみが増えて歪む / キキ = 角が増え、長く、曲がる)
  _blobSpec(k){
    const r = this._rngFrom(9173 + k*7919);
    const R = (a,b)=> a + (b - a)*r();
    const W = (Math.exp(3.0*k/(this.NBLOB - 1)) - 1)/(Math.exp(3.0) - 1);   // 0..1 (指数)
    const kiki = (k % 2) === 1;
    const flat = kiki ? R(0.42, 0.62) : R(0.55, 0.80);          // 図形のように やや平たい
    if(!kiki){
      // ブーバ: 丸い芯に、大きく柔らかなふくらみを周りへ溶かし込む (雲・豆・アメーバのような輪郭)
      const sp = { kind:'bouba', flat, core:R(0.50, 0.58), lobes:[], k:R(0.30, 0.40), holes:[], tw:(r() < 0.3*W ? R(-1, 1)*1.0*W : 0) };
      const nL = 4 + Math.floor(r()*(2 + 5*W));
      const a0 = R(0, 6.283);
      for(let i=0;i<nL;i++){
        const a = a0 + i*6.283/nL + R(-0.25, 0.25)*(1 + W), el = R(-0.20, 0.20)*(1 + W);
        const d = R(0.42, 0.52) + 0.25*W*r();
        sp.lobes.push({ c:[Math.cos(a)*Math.cos(el)*d, Math.sin(a)*Math.cos(el)*d, Math.sin(el)*d], r:R(0.30, 0.42)*(1 + 0.3*W*(r() - 0.3)) });
      }
      if(r() < 0.6*W) sp.holes.push({ c:[R(-0.2,0.2), R(-0.2,0.2), 0], r:R(0.10, 0.18) });   // 変なものほど穴が開く
      return sp;
    }
    // キキ: 小さく角ばった芯から、鋭く尖った角が放射状に伸びる (先はほぼ点)
    const sp = { kind:'kiki', flat, core:R(0.30, 0.38), spikes:[] };
    const nS = 5 + Math.floor(r()*(3 + 6*W));
    const a0 = R(0, 6.283);
    for(let i=0;i<nS;i++){
      const a = a0 + i*6.283/nS + R(-0.25, 0.25);
      const el = R(-0.25, 0.25)*(0.6 + 1.0*W);
      const dir = this._nrm([Math.cos(a)*Math.cos(el), Math.sin(a)*Math.cos(el), Math.sin(el)]);
      const len = R(0.85, 1.15)*(1 + 0.5*W*r())*(r() < 0.3 ? 0.7 : 1.0);    // 長短が混ざるとギザギザらしい
      const bend = this._nrm(this._cross(dir, [R(-1,1), R(-1,1), R(-1,1)]));
      sp.spikes.push({ dir, len, r0:R(0.20, 0.30), bend, bk: (r() < 0.2 + 0.6*W ? R(0.05, 0.30)*(0.4 + W) : 0) });
    }
    return sp;
  },
  _blobSDF(p, sp){
    const smin = (a,b,k)=>{ const h=Math.max(0,Math.min(1,0.5+0.5*(b-a)/k)); return this._mix(b,a,h) - k*h*(1-h); };
    const smaxS = (a,b,k)=>{ const h=Math.max(0,Math.min(1,0.5-0.5*(b+a)/k)); return this._mix(a,-b,h) + k*h*(1-h); };
    const q = [p[0], p[1], p[2]/sp.flat];
    if(sp.kind === 'bouba'){
      let x = q;
      if(sp.tw){ const a = x[1]*sp.tw, c = Math.cos(a), s2 = Math.sin(a); x = [c*x[0] - s2*x[2], x[1], s2*x[0] + c*x[2]]; }
      let d = this._len(x) - sp.core;
      for(const L of sp.lobes) d = smin(d, this._len(this._sub(x, L.c)) - L.r, sp.k);
      for(const H of sp.holes) d = smaxS(d, Math.hypot(x[0]-H.c[0], x[1]-H.c[1]) - H.r, 0.08);   // 貫通する丸い穴
      return d*sp.flat;
    }
    // キキ: 角 = 根元から先へ一直線に細る円錐 (先はほぼ点)。曲がる角は途中で折れる
    let d = this._len(q) - sp.core;
    for(const S of sp.spikes){
      const tip = this._mul(this._add(S.dir, this._mul(S.bend, S.bk)), S.len);
      const mid = this._mul(this._add(S.dir, this._mul(S.bend, S.bk*0.3)), S.len*0.5);
      const seg = (a, b, ra, rb)=>{ const pa = this._sub(q, a), ba = this._sub(b, a); const h = Math.max(0, Math.min(1, this._dot(pa, ba)/this._dot(ba, ba)));
        return this._len(this._sub(pa, this._mul(ba, h))) - this._mix(ra, rb, h); };
      const rm = S.r0*0.5;
      const e = Math.min(seg([0,0,0], mid, S.r0, rm), seg(mid, tip, rm, 0.004));
      d = smin(d, e, 0.035);                                      // 根元だけわずかになじませ、角は鋭いまま
    }
    return d*sp.flat;
  },
  // surface nets: 格子で距離関数を取り、符号が変わるセルに頂点を置いて四角形でつなぐ (穴があっても張れる)
  _geoBlob(k){
    const sp = this._blobSpec(k);
    const N = sp.kind === 'kiki' ? 68 : 54, B = 1.7, h = 2*B/N;
    const val = new Float32Array((N+1)*(N+1)*(N+1));
    const I = (x,y,z)=> (z*(N+1) + y)*(N+1) + x;
    for(let z=0;z<=N;z++) for(let y=0;y<=N;y++) for(let x=0;x<=N;x++) val[I(x,y,z)] = this._blobSDF([-B + x*h, -B + y*h, -B + z*h], sp);
    const vid = new Int32Array(N*N*N).fill(-1);
    const C = (x,y,z)=> (z*N + y)*N + x;
    const v = [], pos = [];
    const E = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
    for(let z=0;z<N;z++) for(let y=0;y<N;y++) for(let x=0;x<N;x++){
      const c = []; let mask = 0;
      for(let n=0;n<8;n++){ const vv = val[I(x+(n&1), y+((n>>1)&1), z+((n>>2)&1))]; c.push(vv); if(vv < 0) mask |= 1<<n; }
      if(mask === 0 || mask === 255) continue;
      let sx=0, sy=0, sz=0, cnt=0;
      for(const [a,b] of E){
        if((c[a] < 0) === (c[b] < 0)) continue;
        const t = c[a]/(c[a] - c[b]);
        const ax=a&1, ay=(a>>1)&1, az=(a>>2)&1, bx=b&1, by=(b>>1)&1, bz=(b>>2)&1;
        sx += ax + (bx-ax)*t; sy += ay + (by-ay)*t; sz += az + (bz-az)*t; cnt++;
      }
      const p = [-B + (x + sx/cnt)*h, -B + (y + sy/cnt)*h, -B + (z + sz/cnt)*h];
      vid[C(x,y,z)] = pos.length; pos.push(p);
    }
    const idx = [];
    const quad = (a,b,c,d,flip)=>{ if(a<0||b<0||c<0||d<0) return; if(flip) idx.push(a,c,b, a,d,c); else idx.push(a,b,c, a,c,d); };
    for(let z=1;z<N;z++) for(let y=1;y<N;y++) for(let x=0;x<N;x++){   // x 方向の辺
      const s0 = val[I(x,y,z)] < 0, s1 = val[I(x+1,y,z)] < 0; if(s0 === s1) continue;
      quad(vid[C(x,y-1,z-1)], vid[C(x,y,z-1)], vid[C(x,y,z)], vid[C(x,y-1,z)], s1);
    }
    for(let z=1;z<N;z++) for(let y=0;y<N;y++) for(let x=1;x<N;x++){   // y 方向
      const s0 = val[I(x,y,z)] < 0, s1 = val[I(x,y+1,z)] < 0; if(s0 === s1) continue;
      quad(vid[C(x-1,y,z-1)], vid[C(x-1,y,z)], vid[C(x,y,z)], vid[C(x,y,z-1)], s1);
    }
    for(let z=0;z<N;z++) for(let y=1;y<N;y++) for(let x=1;x<N;x++){   // z 方向
      const s0 = val[I(x,y,z)] < 0, s1 = val[I(x,y,z+1)] < 0; if(s0 === s1) continue;
      quad(vid[C(x-1,y-1,z)], vid[C(x,y-1,z)], vid[C(x,y,z)], vid[C(x-1,y,z)], s1);
    }
    // 大きさを揃える (中心を原点、いちばん遠い点を半径 1 に)
    let cx=0, cy=0, cz=0; for(const p of pos){ cx+=p[0]; cy+=p[1]; cz+=p[2]; } const np = Math.max(1, pos.length); cx/=np; cy/=np; cz/=np;
    let rmax = 1e-3; for(const p of pos) rmax = Math.max(rmax, Math.hypot(p[0]-cx, p[1]-cy, p[2]-cz));
    for(const p of pos){
      const e = 0.01;
      const g = [ this._blobSDF([p[0]+e,p[1],p[2]],sp) - this._blobSDF([p[0]-e,p[1],p[2]],sp),
                  this._blobSDF([p[0],p[1]+e,p[2]],sp) - this._blobSDF([p[0],p[1]-e,p[2]],sp),
                  this._blobSDF([p[0],p[1],p[2]+e],sp) - this._blobSDF([p[0],p[1],p[2]-e],sp) ];
      v.push((p[0]-cx)/rmax, (p[1]-cy)/rmax, (p[2]-cz)/rmax, ...this._nrm(g));
    }
    if(pos.length > 65535) console.warn('[surrealfloat] blob mesh too large', pos.length);
    return { v, i: idx };
  },

  // 参考画像 (マグリット) に沿った最初の 6 種の構造物。部品の位置・大きさ・傾きは cfg → cfg+1 へ滑らかに組み替わる
  _buildClassic(kind, id, cfg, w){
    const J = (k)=> this._mix(this._h1(id + cfg*31.73 + k*1.913), this._h1(id + (cfg+1)*31.73 + k*1.913), w) - 0.5;
    const g = { boards:[], rp:null, rq:null, sp:[], rg:[], win:null, cl:[], blob:0, tails:null };
    const B = (o, s, k, sh, rz, ry)=> g.boards.push({o, s, k, sh, rz:rz||0, ry:ry||0});
    if(kind === 0){
      B([-0.15+0.3*J(1), 0.62, -0.05], [0.78+0.2*J(2), 0.11, 0.025], 0, 1.05+0.4*J(3));
      B([-0.05+0.3*J(4), 0.22, -0.02], [0.70+0.2*J(5), 0.10, 0.025], 0, 1.05+0.4*J(6));
      B([0.55+0.2*J(7), 0.42, -0.09], [0.32, 0.12, 0.022], 0, 0.5);
      B([0.38+0.2*J(8), -0.72, 0.02], [0.24, -0.08, 0.02], 1, -0.8);
      B([0.50+0.2*J(9), -0.98, 0.02], [0.22, -0.06, 0.02], 1, -0.8);
      const x0 = -0.08 + 0.2*J(10);
      g.rp = [[x0,0.92,0.04],[x0,0.05,0.04],[x0+0.25,-0.30,0.05],[x0+0.40,-0.80,0.03],[x0+0.55,-1.0,0.03]];
      g.rq = [[0.42,0.55,0.02],[0.42,0.10,0.02],[0.42,0.10,0.02]];
      const tt = 0.55 + 0.3*J(11);
      g.sp.push([...this._add(g.rp[1], this._mul(this._sub(g.rp[2], g.rp[1]), tt)), 0.27+0.06*J(12)]);
      g.cl.push({c:[0.62+0.15*J(13), 0.30, -0.05], w:0.17, len:0.62+0.15*J(14), ph:1.0});
    } else if(kind === 1){
      const lean = 0.55 + 0.4*J(1);
      B([-0.70+0.15*J(2), 0.02, 0.0], [0.075, 0.46+0.1*J(3), 0.025], 0, lean);
      B([-0.35+0.15*J(4), 0.02, 0.03], [0.075, 0.44+0.1*J(5), 0.025], 0, lean);
      B([1.00+0.15*J(6), 0.10, 0.0], [0.07, 0.40, 0.025], 0, lean+0.3);
      B([-1.08, 0.05, 0.0], [0.10, 0.20, 0.02], 1, 1.0);
      B([1.28, 0.04, 0.0], [0.09, 0.13, 0.02], 1, -1.0);
      const hx = -0.52 + 0.4*J(7);
      B([hx, -0.42, -0.06], [0.18, 0.04, 0.018], 0, 1.0);
      g.rp = [[-1.38,0,0.03],[-0.4,0,0.03],[0.4,0,0.03],[1.0,0,0.03],[1.42,0,0.03]];
      g.rq = [[hx,0,0],[hx,-0.42,-0.04],[hx,-0.42,-0.04]];
      g.sp.push([0.42+0.25*J(8), 0, 0.03, 0.32+0.05*J(9)]);
      g.sp.push([-1.40, 0, 0.03, 0.06]);
      g.cl.push({c:[-0.02+0.12*J(10), -0.01, 0.05], w:0.13, len:0.55+0.15*J(11), ph:2.3});
    } else if(kind === 2){
      B([-0.12+0.3*J(1), 0.20, -0.07], [0.62+0.15*J(2), 0.075, 0.025], 0, 1.0);
      B([0.42+0.2*J(3), -0.02+0.2*J(4), -0.09], [0.36, 0.06, 0.025], 0, 1.0);
      B([0.10+0.2*J(5), -0.66, 0.0], [0.50+0.1*J(6), -0.11, 0.025], 1, -0.55);
      B([-0.62, -0.18+0.2*J(7), 0.02], [0.22, 0.045, 0.02], 0, 1.1);
      g.win = [0.06+0.1*J(8), -0.08, 0.03];
      const x0 = -0.42 + 0.15*J(9);
      g.rp = [[x0,0.80,0.07],[x0,0.08,0.07],[x0+0.55,-0.56,0.07],[x0+0.62,-0.62,0.06],[x0+0.62,-0.62,0.06]];
      g.rq = [[0.62,0.20,-0.05],[0.62,-0.30,-0.05],[0.80,-0.45,-0.05]];
      g.sp.push([x0, 0.86, 0.07, 0.07]);
      g.sp.push([0.80, -0.48, -0.05, 0.05+0.05*(J(10)+0.5)]);
      g.rg.push({c:[x0,0.84,0.07], R:0.085, a:[0,0,0]});
      g.cl.push({c:[0.46+0.1*J(11), -0.08, -0.05], w:0.14, len:0.58+0.12*J(12), ph:3.7});
    } else if(kind === 3){
      const wy = 0.55 + 0.1*J(1);
      B([-0.30, -0.05, -0.08], [0.50, wy, 0.022], 1, 0.92);
      B([-0.17+0.05*J(2), -0.10, -0.02], [0.48, wy*0.85, 0.022], 1, 0.92);
      B([-0.04+0.08*J(3), -0.15, 0.04], [0.46, wy*0.70, 0.022], 1, 0.92);
      const cx = 0.62 + 0.2*J(4);
      B([cx, 0.32, 0.02], [0.22, 0.035, 0.018], 0, 1.1);
      B([cx+0.05, 0.12, 0.02], [0.20, 0.035, 0.018], 0, 1.1);
      const hp = 0.28 + 0.12*J(5);
      g.rp = [[-0.92,-0.62,0.08],[0.95,-0.44,0.08],[1.25,-0.44+hp*0.4,0.08],[1.12,-0.44+hp,0.08],[0.62,-0.30,0.08]];
      g.rq = [[cx,0.50,0.04],[cx,0.02,0.04],[cx-0.10,-0.32,0.06]];
      g.rg.push({c:[-1.02,-0.62,0.08], R:0.085, a:[0,1.5708,0]});
      g.rg.push({c:[cx,0.58,0.04], R:0.06, a:[0,1.5708,0]});
      g.cl.push({c:[0.30+0.25*J(6), -0.47, 0.10], w:0.20, len:0.45+0.15*J(7), ph:4.9});
    } else if(kind === 4){
      for(let i=0;i<4;i++) B([0.05*i+0.1*J(i+1), 0.30-i*0.17, 0.0], [0.42, 0.028, 0.02], 0, 0.35);
      B([-1.05, 0.20, 0.0], [0.18, 0.03, 0.02], 0, 0.6);
      g.rp = [[0.10,0.62,0.03],[0.10,-0.32,0.03],[0.10,-0.32,0.03],[-0.90,-0.32,0.03],[-1.00,0.18,0.03]];
      g.sp.push([0.10, 0.70, 0.03, 0.10]);
    } else if(kind === 5){
      B([0.30+0.2*J(1), -0.05, 0.0], [0.24, 0.24, 0.012], 0, 0.0, 0.6+0.6*J(2), 0.3);
      B([-0.92, -0.05, 0.0], [0.20, -0.30, 0.018], 1, 0.0);
      B([0.10, 0.62, -0.05], [0.50, 0.05, 0.02], 0, 1.0);
      g.rp = [[-0.92,0.52,0],[0.92,0.52,0],[0.92,-0.20,0],[0.92,-0.20,0],[0.92,-0.20,0]];
      const hx = -0.45 + 0.2*J(3);
      g.rq = [[hx,0.52,0],[hx,-0.40,0],[hx+0.55,-0.62,0]];
      g.sp.push([hx, -0.40, 0, 0.20+0.05*J(4)]);
      g.sp.push([0.92, -0.32, 0, 0.14+0.04*J(5)]);
      g.sp.push([0.25, 0.52, 0, 0.09]);
      g.rg.push({c:[-0.92,0.52,0], R:0.07, a:[0,1.5708,0]});
      g.cl.push({c:[0.58+0.12*J(6), 0.50, 0.14], w:0.18, len:0.75+0.15*J(7), ph:6.1});
      g.cl.push({c:[-0.20, 0.50, -0.10], w:0.11, len:0.40, ph:7.4});
    }
    // 新しい描画形式へ (管は折れ線、窓は大きさ付き、布は向き付き)
    const tubes = [];
    if(g.rp) tubes.push({ pts:g.rp, r:0.020 });
    if(g.rq) tubes.push({ pts:g.rq, r:0.018 });
    return { boards:g.boards, tubes, sp:g.sp, rg:g.rg, win: g.win ? { c:g.win, s:1 } : null,
             cl:g.cl.map(c=>({ c:c.c, w:c.w, len:c.len, ph:c.ph, up:false })), blobs:[] };
  },

  // ===== 構造物の組み立て: 部品の組み合わせを 1 体ずつ乱数で決める =====
  //   ep = 組み合わせの世代 (uMorph の周期で進む)。世代が変わると部品が 1 つずつしぼんで消え、
  //   新しい組み合わせの部品が 1 つずつ育つ (組み立て / 解体)
  _build(id, ep, f, T, wd){
    wd = wd || 0;
    const r = this._rngFrom(Math.floor(id*1000) + ep*7717 + this._seed*131);
    const R = (a,b)=> a + (b - a)*r();
    const pick = (arr)=> arr[Math.floor(r()*arr.length)];
    const g = { boards:[], tubes:[], sp:[], rg:[], win:null, cl:[], blobs:[] };
    let nPart = 0;
    const grow = ()=>{                     // 部品ごとにずらした出現・消滅 (0..1)
      const o = (nPart++ % 11)*0.02 + r()*0.03;                     // 部品ごとにずらして、ゆっくり育ち・ゆっくりしぼむ
      return this._sstep(o, o + 0.28, f)*(1 - this._sstep(0.62 + o*0.5, 0.92 + o*0.25, f));
    };
    const wob = (k, a)=> a*Math.sin(T*(0.21 + 0.13*k) + id*3.1 + k*1.7);    // 部品ごとのゆるい揺れ
    // 1 体ごとの種類: 半分 = 最初の謎の構造物 (参考画像の 6 種) / 半分 = 部品 (板・管・球・輪・窓・布) のランダムな組み合わせ。
    //   不定形・岩・林檎・帽子は構造物には含めない (それぞれ単体で飛ぶ)
    //   種類は物ごとに固定 (世代が変わっても入れ替わらない = 急に消えたり現れたりしない)
    const rk = this._rngFrom(Math.floor(id*1000) + 99991 + this._seed*131);
    const mode = rk();
    if(mode < 0.50){
      const kind = Math.floor(rk()*6);
      return this._buildClassic(kind, id, ep, this._sstep(0.62, 1.0, f));
    }
    const style = 0.5;
    const ex = ()=> Math.exp((r() - 0.5)*2*(0.25 + 1.1*wd));   // 部品ごとの大きさのばらつき (変さとともに指数的に広がる)
    // 板 (長板・フィン・三角・大きな面)
    const nB = style < 0.25 ? Math.floor(R(0, 3)) : Math.floor(R(1, 7));
    for(let i=0;i<nB;i++){
      const t = r(); let sx, sy, k = r() < 0.35 ? 1 : 0;
      const e1 = ex();
      if(t < 0.4){ sx = R(0.35, 0.9)*e1; sy = R(0.03, 0.12); }          // 長い板
      else if(t < 0.7){ sx = R(0.05, 0.12); sy = R(0.25, 0.6)*e1; }     // 縦のフィン
      else { sx = R(0.15, 0.5)*e1; sy = R(0.15, 0.5)*e1*(r() < 0.5 ? -1 : 1); }   // 面・三角
      const gr = grow();
      g.boards.push({ o:[R(-0.8,0.8) + wob(i, 0.03), R(-0.8,0.8) + wob(i+3, 0.03), R(-0.25,0.25)], s:[sx*gr, sy*gr, 0.022*Math.max(gr, 0.01)], k,
                      sh:R(-1.3, 1.3), rz:(r() < 0.6 ? 0 : R(-0.8, 0.8)) + wob(i+7, 0.04), ry:(r() < 0.7 ? R(-0.25, 0.25) : R(-1.4, 1.4)) });
    }
    // 管: 軸に沿って折れ曲がる (ときどきヘアピン)、端に輪や小球
    const nT = Math.floor(R(style < 0.25 ? 1 : 0, 3.2));
    const axes = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    for(let i=0;i<nT;i++){
      const gr = grow();
      const pts = [[R(-0.6,0.6), R(-0.6,0.6), R(-0.2,0.2)]];
      let prev = pick(axes);
      const nS = 2 + Math.floor(r()*4);
      for(let j=0;j<nS;j++){
        let d = r() < 0.15 ? this._mul(prev, -1) : pick(axes);     // ヘアピンで折り返すこともある
        if(this._dot(d, prev) > 0.9) d = pick(axes);
        const jit = [R(-0.35,0.35), R(-0.35,0.35), R(-0.2,0.2)];
        const step = this._mul(this._nrm(this._add(d, jit)), R(0.2, 0.75)*gr);
        pts.push(this._add(pts[pts.length-1], step)); prev = d;
      }
      const rad = R(0.014, 0.03);
      g.tubes.push({ pts, r:rad*Math.max(gr, 0.0), gr });
      const end = pts[pts.length-1];
      const e = r();
      if(e < 0.4) g.rg.push({ c:end, R:R(0.05, 0.12)*gr, a:[R(0,6.28), r() < 0.5 ? 1.5708 : 0, 0] });
      else if(e < 0.65) g.sp.push([...end, R(0.04, 0.09)*gr]);
      // 管に刺さった石膏球
      if(r() < 0.55){ const a = pts[Math.floor(r()*(pts.length-1))]; const b = pts[pts.indexOf(a)+1]; const u = R(0.2, 0.8);
        g.sp.push([...this._add(a, this._mul(this._sub(b, a), u)), R(0.12, 0.38)*ex()*grow()]); }
    }
    // 宙に浮く球
    if(r() < 0.35) g.sp.push([R(-0.7,0.7), R(-0.7,0.7), R(-0.3,0.3), R(0.08, 0.3)*grow()]);
    // 小窓
    if(r() < 0.18){ const gr = grow(); g.win = { c:[R(-0.5,0.5), R(-0.4,0.4), R(-0.1,0.1)], s:gr }; }
    // 布: 板の下辺か管の途中から垂れる。ときどき上へ垂れる (重力が逆さ)
    const nC = r() < 0.9 ? 1 + Math.floor(r()*3.2) : 0;   // 布は多めに (1〜4 枚)
    for(let i=0;i<nC;i++){
      let c;
      if(g.boards.length && r() < 0.6){ const b = pick(g.boards); c = [b.o[0] + R(-0.4,0.4)*Math.abs(b.s[0]), b.o[1] - Math.abs(b.s[1]), b.o[2] + 0.05]; }
      else if(g.tubes.length){ const t = pick(g.tubes); c = pick(t.pts).slice(); }
      else c = [R(-0.5,0.5), R(0,0.6), 0.05];
      const gr = grow();
      g.cl.push({ c, w:R(0.08, 0.30)*ex()*gr, len:R(0.3, 1.2)*ex()*gr, ph:R(0, 9), up: r() < 0.15 });
    }
    // 不定形 (主役なら大きく 1〜2 つ、そうでなければ ときどき部品として混ざる)
    const nBl = 0;   // 不定形は構造物に混ぜない
    for(let i=0;i<nBl;i++){
      const gr = grow();
      const sc = (style < 0.25 ? R(0.55, 1.0) : R(0.25, 0.5))*ex()*gr;
      // 変なものほど、指数的に変な種を選ぶ
      const ty = Math.max(0, Math.min(this.NBLOB - 1, Math.floor((Math.min(1, wd*0.8) + R(-0.25, 0.25))*this.NBLOB)));
      g.blobs.push({ c:[R(-0.4,0.4), R(-0.4,0.4), R(-0.15,0.15)], s:[sc*ex(), sc*ex(), sc*ex()],
                     a:[R(0,6.28), R(-0.6,0.6), R(-0.6,0.6)], type:ty, ph:R(0,9), sag:R(0.0, 0.25) + 0.3*Math.min(1.5, wd), wd });
    }
    return g;
  },

  // 構造物の置き方: それぞれの進路を、それぞれの速さ・向きで行き交う
  _place(i, T, burst, audio){
    const P = this.P, dz = this._dz;
    const id = i*13.17 + 1.0, h1 = (k)=>this._h1(id + k);
    const az  = h1(0.6)*Math.PI*2;
    // 特性はすべて指数分布 (大半は控えめ、ごく一部が極端): 高さ・横ずれ・速さ
    let   hy  = this._expd(h1(0.7), 0.6, 8.0, 1.5)*this._fh;
    let   off = (h1(0.8) < 0.5 ? -1 : 1)*(2.6 + this._expd(h1(0.9), 0.5, 9.0, 1.2))*this._ln;
    const dir = h1(0.4) < 0.5 ? -1 : 1;
    const spd = this._expd(h1(0.3), 0.12, 7.0, 1.8)*dz(P.depth)*0.01;
    const span = this.FAR - this.BACK;
    const md = (a, m)=> a - m*Math.floor(a/m);
    const dep = this.BACK + md(h1(0.1)*span + dir*spd*this._trv(0.6, T) + 0.4*burst*dir, span);
    const dr = dz(P.drift)*0.01;
    const drA = this._expd(h1(2.2), 0.1, 2.5, 1.6), drF = this._expd(h1(2.3), 0.02, 0.4, 1.4);   // 漂いの幅と速さ
    hy  += 0.35*dr*drA*Math.sin(T*drF*1.4 + id*1.7);
    off += 0.40*dr*drA*Math.sin(T*drF + id*2.3);
    const Ra = this._rot(az, 0, 0);
    const pos0 = this._add(this._add(this._m3v(Ra, [0,0,-dep]), this._m3v(Ra, [off,0,0])), [0, hy, 0]);
    // 大きさはまちまち (ときどき巨大)。押しつぶし / 引き伸ばし、傾き、ゆっくり転がるものもある
    // 変さ wd: 指数分布 (大半は 0 付近、ごく一部が 1 を大きく超える)。Weird で全体を強める
    const wk = dz(P.weird)*0.01;
    const wd = wk*(Math.exp(4.0*Math.pow(h1(2.1), 1.4)) - 1)/(Math.exp(4.0) - 1)*0.9;   // 控えめに (最大 0.9)
    // 大きさも指数分布: 大半は控えめ、まれに巨大 (0.45 倍 … 約 9 倍)
    let s = this._szd(h1(0.2), 0.45, 0.45*Math.exp(3.0), 2.2)*dz(P.size)*0.01;
    // 巨大なものほど進路をカメラから離す (カメラが中に入って画面が埋まらないように)
    const pos = this._add(pos0, this._m3v(Ra, [Math.sign(off)*1.6*s, 0.5*s, 0]));
    // 押しつぶし / 引き伸ばしは変さとともに指数的に強まる
    const sx = Math.exp((h1(1.3) - 0.5)*2*1.2*wd), sy = Math.exp((h1(1.4) - 0.5)*2*1.4*wd), sz = Math.exp((h1(1.2) - 0.5)*2*0.8*wd);
    const sq = [sx, sy, sz];
    const fade = 1 - this._sstep(this.FAR - 30, this.FAR - 2, Math.abs(dep));
    const sp = dz(P.spin)*0.01;
    const tumble = h1(1.5) < 0.1 + 0.5*Math.min(1, wd) ? T*this._expd(h1(1.6), 0.02, 0.6 + 0.6*wd, 1.5)*(h1(2.5) < 0.5 ? -1 : 1)*sp : 0;   // 変なものほど転がる
    const R = this._m3mul(Ra, this._rot(0.10*sp*Math.sin(T*0.043 + id) + 0.08*Math.sin(burst + id) + (h1(0.8) - 0.5)*0.9,
                                        0.05*sp*Math.sin(T*0.037 + id*2.1) + (h1(1.7) < 0.2 ? (h1(1.8) - 0.5)*1.2 : 0),
                                        0.05*sp*Math.sin(T*0.029 + id*1.9) + 0.04*Math.sin(burst*1.3 + id) + tumble + (h1(1.9) < 0.12 ? Math.PI : 0)));
    const ph = T*0.03*dz(P.morph)*0.01*this._expd(h1(2.4), 0.3, 4.0, 1.3) + h1(0.5)*7.0;   // 組み替えの速さも物ごとに
    return { pos, s, sq, R, fade, id, wd, ep: Math.floor(ph), f: ph - Math.floor(ph) };
  },

  // ===== インスタンスの積み上げ =====
  _inst:null, _gid:null, _g:0,
  // ── 進んだ距離の積算 ──
  //   以前は 位置 = 速さ × 経過時間 で、速さに音の強さ (Audio react) が掛かっていた。
  //   経過時間が大きいほど、音量のわずかな変化で位置が何十単位も飛び、物が瞬間移動して「急に消える / 現れる」原因になっていた。
  //   今は フレームごとの Δt × (1 + 音) を足し込む (音で速くなるだけで、位置は飛ばない)。
  //   拍のリセット・拍の倍率変更などで時間そのものが飛んだときも、その 1 フレームの差分は捨てる
  _tr:{},
  _trStep(key, T, burst, audio){
    let st = this._tr[key];
    if(!st){ st = this._tr[key] = { T, B:burst, c:T, a6:T, a10:T, b:burst }; }
    let dT = T - st.T, dB = burst - st.B;
    if(!isFinite(dT) || Math.abs(dT) > 0.5) dT = 0;          // 時間の飛び (拍リセット等) は無視
    if(!isFinite(dB) || Math.abs(dB) > 2.0) dB = 0;
    st.T = T; st.B = burst;
    st.c += dT; st.a6 += dT*(1 + 0.6*audio); st.a10 += dT*(1 + audio); st.b += dB;
    return st;
  },
  _cur:null, _fh:1, _ln:1,
  _trv(k, T){ const st = this._cur; if(!st) return T; return k < 0.8 ? st.a6 : st.a10; },
  _push(type, M, mat, tint, fade, b){
    this._gid[type].push(this._g); const L = this._inst[type]; L.push(...M, mat, tint, fade, this.PRIM[type] || 7, ...(b || [0,0,0,0]));
  },
  PRIM:{ box:1, tri:2, cyl:3, sph:4, tor:5, clo:6, rk0:8, rk1:8, rk2:8, rk3:8, hat:9, apple:9 },

  _emitStructure(pl, T){
    const g = this._build(pl.id, pl.ep, pl.f, T, pl.wd);
    const S = this._aff(this._m3mul(pl.R, [pl.s*pl.sq[0],0,0, 0,pl.s*pl.sq[1],0, 0,0,pl.s*pl.sq[2]]), pl.pos);
    const fade = pl.fade, tint = pl.id % 1;
    for(const b of g.boards){
      if(Math.max(Math.abs(b.s[0]), Math.abs(b.s[1])) < 1e-4) continue;   // 消えきるまで描く (途中で切らない)
      const Rb = this._rot(b.ry, 0, b.rz);
      if(b.k === 0){
        const A = this._aff(this._m3mul(Rb, [b.s[0],0,0, b.sh*b.s[1],b.s[1],0, 0,0,b.s[2]]), b.o);
        this._push('box', this._affMul(S, A), 1, tint, fade);
      } else {
        const L = [b.s[0],0,0, 0.5*b.sh*b.s[0],b.s[1],0, 0,0,b.s[2]];
        const t = this._add(b.o, this._m3v(Rb, [0.5*b.sh*b.s[0], 0, 0]));
        this._push('tri', this._affMul(S, this._aff(this._m3mul(Rb, L), t)), 1, tint, fade);
      }
    }
    const tube = (a, c, r0, r1, mat)=>{
      const ax = this._sub(c, a); const l = this._len(ax); if(l < 1e-4) return;
      const y = this._mul(ax, 1/l);
      const ref = Math.abs(y[1]) < 0.9 ? [0,1,0] : [1,0,0];
      const x = this._nrm(this._cross(ref, y)), z = this._cross(x, y);
      this._push('cyl', this._affMul(S, [...x,0, ...this._mul(y, l),0, ...z,0, ...a,1]), mat, tint, fade, [r0, r1, 0, 0]);
    };
    for(const t of g.tubes){
      for(let k=0;k<t.pts.length-1;k++) tube(t.pts[k], t.pts[k+1], t.r, t.r, 3);
      if(t.r < 1e-4) continue;
      for(let k=1;k<t.pts.length-1;k++){ const p = t.pts[k], r = t.r;   // 折れ目を球でふさぐ
        this._push('sph', this._affMul(S, [r,0,0,0, 0,r,0,0, 0,0,r,0, p[0],p[1],p[2],1]), 3, tint, fade); }
    }
    for(const s4 of g.sp){ if(s4[3] < 1e-4) continue;
      this._push('sph', this._affMul(S, [s4[3],0,0,0, 0,s4[3],0,0, 0,0,s4[3],0, s4[0],s4[1],s4[2],1]), 4, tint, fade); }
    for(const r of g.rg){ if(r.R < 1e-4) continue;
      const Rr = this._m3mul(this._rot(r.a[0], r.a[1], r.a[2]), [r.R,0,0, 0,r.R,0, 0,0,r.R]);
      this._push('tor', this._affMul(S, this._aff(Rr, r.c)), 3, tint, fade); }
    if(g.win && g.win.s > 1e-4){ const w = g.win;
      this._push('box', this._affMul(S, [0.14*w.s,0,0,0, 0,0.30*w.s,0,0, 0,0,0.018,0, w.c[0],w.c[1],w.c[2],1]), 5, tint, fade); }
    for(const c of g.cl){ if(Math.max(c.w, c.len) < 1e-4) continue;
      const fy = c.up ? -1 : 1;
      this._push('clo', this._affMul(S, [1,0,0,0, 0,fy,0,0, 0,0,1,0, c.c[0],c.c[1],c.c[2],1]), 6, tint, fade, [c.w, c.len, c.ph, 0]); }
    for(const b of g.blobs){ if(b.s[0] < 1e-3) continue;
      const Rb = this._m3mul(this._rot(b.a[0], b.a[1], b.a[2]), [b.s[0],0,0, 0,b.s[1],0, 0,0,b.s[2]]);
      this._push(this.blobTypes[b.type], this._affMul(S, this._aff(Rb, b.c)), 7, tint, fade, [b.ph, b.sag, b.wd || 0, b.type % 2]); }
  },

  // ===== マグリット的な変なもの: 巨大な岩・山高帽・林檎 =====
  //   特性 (大きさ・速さ・高さ・横ずれ・回り方) はすべて指数分布: 大半は控えめ、ごく一部が極端
  _expd(u, lo, hi, g){ return lo*Math.pow(hi/lo, Math.pow(u, g || 1.0)); },
  // 大きさ用の指数分布: Size Var でばらつきの幅を変える。
  //   中央値 (u = 0.5) の大きさを保ったまま、対数で幅を sizeVar 倍にする (0 = 全部中央値 / 1 = _expd と同じ / 2 = 幅 2 倍)
  //   値を連続に変えるだけなので、スライダーを動かしても物は飛ばずに なめらかに伸び縮みする
  _szd(u, lo, hi, g){
    const dz = this._dz || (v=>v);
    const sv = (this._svS != null) ? this._svS : Math.max(0, dz(this.P.sizeVar != null ? this.P.sizeVar : 100)*0.01);
    const m = Math.pow(0.5, g || 1.0);
    return lo*Math.exp(Math.log(hi/lo)*(m + sv*(Math.pow(u, g || 1.0) - m)));
  },
  _emitOddity(j, T, audio){
    const P = this.P, dz = this._dz;
    const id = j*5.77 + 301.0, h = (k)=>this._h1(id + k);
    const az  = h(1)*Math.PI*2;
    const hy  = (this._expd(h(2), 0.6, 9.0, 1.6) - 0.2)*this._fh;
    const dir = h(14) < 0.5 ? -1 : 1;
    const spd = this._expd(h(11), 0.15, 7.0, 1.8)*dz(P.depth)*0.01;
    const span = this.FAR - this.BACK;
    const md = (a, m)=> a - m*Math.floor(a/m);
    const dep = this.BACK + md(h(0)*span + dir*spd*this._trv(1.0, T), span);
    const fade = 1 - this._sstep(this.FAR - 30, this.FAR - 2, Math.abs(dep));
    if(fade <= 0) return;
    const kd = h(4);
    const isRock = j < 2;                                          // 岩はごく少なく (2 つだけ)
    // 岩は巨大に (指数分布: 大きな岩が多く、まれに途方もなく巨大)。帽子と林檎は小さめから
    const size = (isRock ? this._szd(h(3), 2.5, 22.0, 1.3) : this._szd(h(3), 0.18, 3.0, 2.0))*dz(P.size)*0.01;
    const off = (h(12) < 0.5 ? -1 : 1)*(1.5 + this._expd(h(13), 1.0, 10.0, 1.0) + 1.8*size)*this._ln;
    const Ra = this._rot(az, 0, 0);
    const c = this._add(this._m3v(Ra, [off, 0, -dep]), [0, hy + (isRock ? 0.6*size : 0) + 0.25*dz(P.drift)*0.01*Math.sin(T*this._expd(h(15), 0.03, 0.6) + id), 0]);
    const isHat = !isRock && kd < 0.6;
    // 回り方も指数分布。岩はほとんど回らず、帽子はくるくる回る (傾きながら)
    const rs = (isHat ? this._expd(h(5), 0.5, 3.0, 1.3) : this._expd(h(5), 0.01, 0.9, 1.6))*dz(P.spin)*0.01*(h(6) < 0.5 ? -1 : 1)*(isRock ? 0.15 : 1.0);
    const tilt = isHat ? 0.35 + 0.5*h(7) : 0.4*(h(7) - 0.3);
    const R = this._m3mul(this._rot(az + id, tilt*Math.sin(T*rs*0.37 + id), 0.3*Math.sin(T*rs*0.29 + id*2.0)*(isHat ? 1.0 : h(8) - 0.3)), this._rot(T*rs, 0, 0));
    const tint = h(9);
    const M = (sc, t)=> this._aff(this._m3mul(R, [sc[0],0,0, 0,sc[1],0, 0,0,sc[2]]), this._add(c, this._m3v(R, t || [0,0,0])));
    if(isRock){                                                     // 巨大な岩
      const rk = 'rk' + Math.floor(h(16)*4);
      this._push(rk, M([size*this._mix(0.8, 1.3, h(17)), size*this._mix(0.75, 1.1, h(18)), size*this._mix(0.8, 1.2, h(19))]), 8, tint, fade);
    } else if(isHat){                                               // 山高帽 (くるくる回る)
      this._push('hat', M([size, size, size]), 9, tint, fade);
    } else {                                                        // 林檎 + 柄
      this._push('apple', M([size, size, size]), 11, tint, fade);
      this._push('cyl', this._affMul(M([1,1,1], [0, size*0.34, 0]), [1,0,0,0, 0,size*0.22,0,0, 0,0,1,0, 0,0,0,1]), 10, tint, fade, [size*0.025, size*0.018, 0, 0]);
    }
  },

  // ===== 単体で漂うタンギー風の不定形 =====
  _emitTanguy(j, T, audio){
    const P = this.P, dz = this._dz;
    const id = j*3.91 + 501.0, h = (k)=>this._h1(id + k);
    const az  = h(1)*Math.PI*2;
    const hy  = this._expd(h(2), 0.4, 7.0, 1.4)*this._fh;
    const dir = h(14) < 0.5 ? -1 : 1;
    const spd = this._expd(h(11), 0.12, 5.0, 1.8)*dz(P.depth)*0.01;
    const span = this.FAR - this.BACK;
    const md = (a, m)=> a - m*Math.floor(a/m);
    const dep = this.BACK + md(h(0)*span + dir*spd*this._trv(1.0, T), span);
    const fade = 1 - this._sstep(this.FAR - 30, this.FAR - 2, Math.abs(dep));
    if(fade <= 0) return;
    const size = this._szd(h(3), 0.25, 1.6, 2.0)*dz(P.size)*0.01;   // 控えめに (大半は小ぶり、まれに 1.6 倍)
    const off = (h(12) < 0.5 ? -1 : 1)*(1.5 + this._expd(h(13), 0.8, 9.0, 1.0) + 1.6*size)*this._ln;
    const Ra = this._rot(az, 0, 0);
    const c = this._add(this._m3v(Ra, [off, 0, -dep]), [0, hy + 0.3*size + 0.3*dz(P.drift)*0.01*Math.sin(T*this._expd(h(15), 0.03, 0.4) + id), 0]);
    const wd = dz(P.weird)*0.01*(Math.exp(4.0*Math.pow(h(16), 1.4)) - 1)/(Math.exp(4.0) - 1)*0.9;
    const ty = Math.max(0, Math.min(this.NBLOB - 1, Math.floor((Math.min(1, wd*0.9) + (h(17) - 0.5)*0.5)*this.NBLOB)));
    const rs = this._expd(h(5), 0.01, 0.5, 1.6)*dz(P.spin)*0.01*(h(6) < 0.5 ? -1 : 1);
    const R = this._rot(az + T*rs + id, 0.3*Math.sin(T*rs*0.6 + id)*(h(7) - 0.3), 0.25*Math.sin(T*rs*0.4 + id*2.0)*(h(8) - 0.3));
    const sq = [size*this._mix(0.75, 1.3, h(18)), size*this._mix(0.75, 1.4, h(19)), size*this._mix(0.75, 1.2, h(20))];
    this._push(this.blobTypes[ty], this._aff(this._m3mul(R, [sq[0],0,0, 0,sq[1],0, 0,0,sq[2]]), c), 7, h(9), fade, [id, this._mix(0.05, 0.35, h(21)), wd, ty % 2]);
  },

  _emitDebris(j, T, audio, clothOnly){
    const P = this.P, dz = this._dz;
    const id = j*7.31 + 101.0, h = (k)=>this._h1(id + k);
    const az  = h(1)*Math.PI*2;
    let   hy  = this._expd(h(2), 0.6, 8.0, 1.4)*this._fh;
    const off = (h(12) < 0.5 ? -1 : 1)*(1.2 + this._expd(h(13), 0.3, 8.0, 1.2))*this._ln;
    const dir = h(14) < 0.5 ? -1 : 1;
    const spd = this._expd(h(11), 0.15, 8.0, 1.8)*dz(P.depth)*0.01;
    const span = this.FAR - this.BACK;
    const md = (a, m)=> a - m*Math.floor(a/m);
    const dep = this.BACK + md(h(0)*span + dir*spd*this._trv(1.0, T), span);
    hy += 0.3*dz(P.drift)*0.01*Math.sin(T*0.06 + id*1.3);
    const Ra = this._rot(az, 0, 0);
    const r = this._szd(h(3), 0.10, 0.10*Math.exp(3.2), 2.0)*dz(P.size)*0.01;   // 指数分布: 大半は小さく、まれに大きい
    // 大きいものほど進路をカメラから離す (布は広がるので大きめに見積もる)
    const reach = Math.max(r, 0.12)*(clothOnly ? 3.0*1.7 : 2.6);
    const c = this._add(this._m3v(Ra, [off + Math.sign(off)*reach, 0, -dep]), [0, hy, 0]);
    const fade = 1 - this._sstep(this.FAR - 30, this.FAR - 2, Math.abs(dep));
    if(fade <= 0) return;
    const Rp = this._rot(T*0.05*dz(P.spin)*0.01*(h(5) - 0.5)*2 + id, 0.5*(h(6) - 0.5) + T*0.03*(h(15) - 0.5), id*0.7);
    const kd = clothOnly ? 0.45 : h(4);
    if(kd < 0.22){
      this._push('sph', [r,0,0,0, 0,r,0,0, 0,0,r,0, c[0],c[1],c[2],1], 4, h(9), fade);
    } else if(kd < 0.50){                                   // 単体で舞う布 (留め具なし。ゆっくり宙返りしながら流れる)
      const Rc = this._rot(T*0.11*(h(17) - 0.5)*2 + id, 0.6*Math.sin(T*0.07 + id) + (h(18) - 0.5), 0.5*Math.sin(T*0.09 + id*1.7));
      const sz = Math.max(r, 0.12)*(clothOnly ? 3.0 : 2.2);
      this._push('clo', this._aff(Rc, c), 6, h(9), fade, [sz*(0.5 + 0.6*h(19)), sz*(0.8 + 0.9*h(20)), id, 1]);
    } else if(kd < 0.78){                                   // 不定形 (多めに)
      const L = this._m3mul(Rp, [r*1.2,0,0, 0,r*1.2,0, 0,0,r*1.2]);
      const wdd = dz(P.weird)*0.01*(Math.exp(4.0*h(16)) - 1)/(Math.exp(4.0) - 1)*0.9;
      { const bt = Math.min(this.NBLOB - 1, Math.floor(Math.min(1, wdd*0.8)*this.NBLOB)); this._push(this.blobTypes[bt], this._aff(L, c), 7, h(9), fade, [id, 0.2, wdd, bt % 2]); }
    } else if(kd < 0.83){                                   // 輪
      this._push('tor', this._aff(this._m3mul(Rp, [r*0.55,0,0, 0,r*0.55,0, 0,0,r*0.55]), c), 3, h(9), fade);
    } else {
      const sh = (h(7) - 0.5)*2;
      if(h(8) < 0.6){
        const L = this._m3mul(Rp, [1.6*r,0,0, sh*(0.35+0.6*h(9))*r,(0.35+0.6*h(9))*r,0, 0,0,0.01]);
        this._push('box', this._aff(L, c), 1, h(9), fade);
      } else {
        const L = this._m3mul(Rp, [1.2*r,0,0, 0.5*sh*1.2*r,0.75*r,0, 0,0,0.01]);
        this._push('tri', this._aff(L, c), 1, h(9), fade);
      }
    }
  },

  _ensureDepth(w,h){
    const gl = this.gl;
    if(this.depthRBO && this.depthW===w && this.depthH===h) return;
    if(this.depthRBO) gl.deleteRenderbuffer(this.depthRBO);
    this.depthRBO = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRBO);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    this.depthW = w; this.depthH = h;
  },

  update(){},

  render(opts){
    const gl = this.gl;
    if(!this.initialized || !this.ok) return;
    const P = this.P;
    this._dz = (v)=> (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v;
    const dz = this._dz;
    this._seed = Math.round(+P.seed || 0);
    const w = opts.w, h = opts.h;
    const clock = (opts.clock != null) ? opts.clock : (performance.now()/1000 - this.startTime);
    // 時間基準 (シェーダ版と同じ): drone = 秒、beat = 拍頭で押されて減速
    const kick = dz(P.kick)*0.01;
    const beatMode = (typeof App !== 'undefined' && App.beatMode === 'beat') && opts.beat != null;
    let T, burst = 0;
    if(beatMode){
      const bt = opts.beat, fb = bt - Math.floor(bt);
      T = (Math.floor(bt) + this._mix(fb, 1 - Math.pow(1 - fb, 3), Math.min(1, Math.max(0, kick))))*0.5;
      burst = (Math.floor(bt) + (1 - Math.pow(1 - fb, 3)))*0.9*kick;
    } else T = clock;
    T *= dz(P.speed)*0.01;
    const audio = ((typeof Audio !== 'undefined' && Audio.react) ? Math.max(0, Math.min(1, Audio.react)) : 0)*kick;
    let MS;
    {   // 雰囲気: 色・光・色調を なめらかに追従 (Mood の切り替え・色の変更が約 1 秒でつながる)
      const now = performance.now()/1000, dt = this._msT != null ? Math.min(0.25, Math.max(0, now - this._msT)) : 1e9;
      this._msT = now; MS = this._moodState(P, dt);
    }
    {   // Size Var は実際に効く値を 約 1 秒かけて追従させる (Random / Reset / 読込で一気に変わっても巨大な物が飛ばない)
      const tgt = Math.max(0, dz(P.sizeVar != null ? P.sizeVar : 100)*0.01);
      const now = performance.now()/1000, dt = this._svT != null ? Math.min(0.25, Math.max(0, now - this._svT)) : 1e9;
      this._svT = now;
      if(this._svS == null || dt > 1e8){ this._svS = this._svS1 = tgt; }
      else {   // 2 段の追従 (動き出しも止まり際もなめらか)
        const k = 1 - Math.exp(-dt/0.35);
        this._svS1 += (tgt - this._svS1)*k; this._svS += (this._svS1 - this._svS)*k;
      }
    }
    {   // 時間・拍の押しを連続にする (飛びがあっても物は瞬間移動しない)
      const st = this._trStep(opts.slot || '_', T, burst, audio);
      this._cur = st; T = st.c; burst = st.b;
    }
    const yaw = T*(6.2832/60.0)*dz(P.pan)*0.01;   // Pan 100% でおよそ 1 分に 1 周
    const D2R = Math.PI/180;
    const PIT = this.PIT + dz(P.pitch)*D2R;
    const hz = -this.F*Math.tan(PIT);
    const rollA = dz(P.roll)*D2R;
    this._fh = Math.max(0, dz(P.floatH)*0.01); this._ln = Math.max(0, dz(P.lane)*0.01);

    // ── カメラ ──
    const aspect = w/h, F = this.F, near = 0.05, far = 700;
    const proj = [F/aspect,0,0,0, 0,F,0,0, 0,0,(far+near)/(near-far),-1, 0,0,2*far*near/(near-far),0];
    // ビュー: 世界 → カメラ。カメラ基底 = Ry(yaw)·{right, up(pitch), back}
    const cp = Math.cos(PIT), sp = Math.sin(PIT);
    const Ry = this._rot(yaw, 0, 0);
    let right = this._m3v(Ry, [1,0,0]), up = this._m3v(Ry, [0,cp,sp]);
    const back = this._m3v(Ry, [0,-sp,cp]);
    if(rollA !== 0){   // 視線まわりに傾ける
      const rc = Math.cos(rollA), rs = Math.sin(rollA);
      const r0 = right, u0 = up;
      right = [rc*r0[0] + rs*u0[0], rc*r0[1] + rs*u0[1], rc*r0[2] + rs*u0[2]];
      up = [-rs*r0[0] + rc*u0[0], -rs*r0[1] + rc*u0[1], -rs*r0[2] + rc*u0[2]];
    }
    const eyeH = dz(P.eyeH)*0.1;
    const view = [right[0],up[0],back[0],0, right[1],up[1],back[1],0, right[2],up[2],back[2],0, 0,0,0,1];
    if(eyeH !== 0){ view[12] = -eyeH*right[1]; view[13] = -eyeH*up[1]; view[14] = -eyeH*back[1]; }   // カメラを持ち上げる (世界を下げる)
    const VP = new Float32Array(this._affMul(proj, view));

    // ── インスタンスを組み立てる ──
    this._inst = { box:[], tri:[], cyl:[], sph:[], tor:[], clo:[] };
    for(const k of this.blobTypes) this._inst[k] = [];
    for(const k of ['rk0','rk1','rk2','rk3','hat','apple']) this._inst[k] = [];
    this._gid = {}; for(const k in this._inst) this._gid[k] = []; this._g = 0;
    const N = Math.max(1, Math.min(this.MAXS, Math.round(dz(P.count))));
    const SP = new Float32Array(24*4);
    let ns = 0;
    for(let i=0;i<N;i++){
      const pl = this._place(i, T, burst, audio);
      if(ns < 24){ SP.set([pl.pos[0], pl.pos[1], pl.pos[2], pl.s], ns*4); ns++; }
      if(pl.fade <= 0) continue;
      this._g++; this._emitStructure(pl, T);
    }
    const ND = Math.round(Math.max(0, Math.min(2, dz(P.debris)*0.01))*36);
    for(let j=0;j<ND;j++){ this._g++; this._emitDebris(j, T, audio); }
    // 単体で舞う布をさらに足す (小物とは別の進路。Debris で量が変わる)
    const NCL = Math.round(Math.max(0, Math.min(2, dz(P.debris)*0.01))*18);
    for(let j=0;j<NCL;j++){ this._g++; this._emitDebris(200 + j, T, audio, true); }
    const NTG = Math.round(Math.max(0, Math.min(2.5, dz(P.tanguy)*0.01))*16);
    for(let j=0;j<NTG;j++){ this._g++; this._emitTanguy(j, T, audio); }
    const NOD = Math.round(Math.max(0, Math.min(2.5, dz(P.oddity)*0.01))*22);
    for(let j=0;j<NOD;j++){ this._g++; this._emitOddity(j, T, audio); }

    // ── 描画 ──
    const useRBO = !!opts.fbo;
    gl.bindFramebuffer(gl.FRAMEBUFFER, useRBO ? opts.fbo : null);
    if(useRBO){ this._ensureDepth(w, h); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRBO); }
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 1); gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // 光: 雰囲気の値に向き・強さを足した配列を別に作る (MS は追従の状態なので書き換えない)
    let Lv = MS.L, Ldv = MS.Ld, keyV = MS.key;
    {
      const sa = dz(P.sunAz), se = dz(P.sunEl);
      if(sa !== 0 || se !== 0){
        const turn = (v)=>{
          const l = Math.hypot(v[0], v[1], v[2]) || 1;
          const az0 = Math.atan2(v[2], v[0]) + sa*D2R;
          const el0 = Math.max(-1.45, Math.min(1.45, Math.asin(v[1]/l) + se*D2R));
          return [Math.cos(el0)*Math.cos(az0), Math.sin(el0), Math.cos(el0)*Math.sin(az0)];
        };
        Lv = turn(MS.L); Ldv = turn(MS.Ld);
      }
      const kg = Math.max(0, dz(P.keyGain)*0.01);
      if(kg !== 1) keyV = MS.key.map(v=>v*kg);
    }
    const ambK = Math.max(0, dz(P.ambient)*0.01);
    const common = (p)=>{
      gl.uniform1f(p.U('uSeed'), this._seed);
      gl.uniform2f(p.U('uRes'), w, h);
      gl.uniform1f(p.U('uT'), T);
      gl.uniform1f(p.U('uYaw'), yaw);
      gl.uniform1f(p.U('uHz'), hz);
      gl.uniform1f(p.U('uF'), F);
      gl.uniform1f(p.U('uBrush'), dz(P.brush)*0.01);
      gl.uniform1f(p.U('uCloud'), dz(P.cloud)*0.01);
      gl.uniform1f(p.U('uCloudSpd'), dz(P.cloudSpd)*0.01);
      gl.uniform1f(p.U('uHaze'), dz(P.haze)*0.01*MS.haze[0]);
      gl.uniform1f(p.U('uDunes'), dz(P.dunes)*0.01);
      gl.uniform1f(p.U('uShadow'), dz(P.shadow)*0.01);
      gl.uniform1f(p.U('uDuneScale'), Math.max(0.1, dz(P.duneScale)*0.01));
      gl.uniform1f(p.U('uSpeckle'), Math.max(0, dz(P.speckle)*0.01));
      gl.uniform1f(p.U('uShadeLo'), dz(P.shadeFloor)*0.01);
      gl.uniform1f(p.U('uCloudScale'), Math.max(0.1, dz(P.cloudScale)*0.01));
      gl.uniform2f(p.U('uCloudBand'), dz(P.cloudBase)*0.01, dz(P.cloudBase)*0.01 + 0.35);
      gl.uniform1f(p.U('uCloudSoft'), 0.10*Math.max(0.1, dz(P.cloudSoft)*0.01));
      gl.uniform1f(p.U('uBrushScale'), Math.max(0.1, dz(P.brushScale)*0.01));
      gl.uniform1f(p.U('uWeave'), Math.max(0, dz(P.weave)*0.01));
      gl.uniform2f(p.U('uRollCS'), Math.cos(rollA), Math.sin(rollA));
      gl.uniform3fv(p.U('uSkyTop'), MS.sky); gl.uniform3fv(p.U('uSkyLow'), MS.low); gl.uniform3fv(p.U('uSand'), MS.sand);
      gl.uniform3fv(p.U('uCloudA'), MS.cA); gl.uniform3fv(p.U('uCloudB'), MS.cB); gl.uniform3fv(p.U('uGlow'), MS.glow);
      gl.uniform3fv(p.U('uKeyCol'), keyV); gl.uniform3fv(p.U('uGroundTint'), MS.gt);
      gl.uniform3fv(p.U('uAmbCol'), [0,1,2].map(q=>(0.5*MS.sky[q] + 0.5*MS.amb[q])*ambK));
      gl.uniform3fv(p.U('uL'), Lv); gl.uniform3fv(p.U('uLd'), Ldv); gl.uniform4fv(p.U('uGrade'), MS.gr);
      gl.uniformMatrix4fv(p.U('uVP'), false, VP);
    };
    // 1) 空
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    gl.useProgram(this.progSky); common(this.progSky);
    gl.bindVertexArray(this.vaoSky);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // 2) 砂漠
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    if(dz(P.dunes) >= 0){
      gl.useProgram(this.progGround); common(this.progGround);
      gl.uniform1i(this.progGround.U('uNS'), ns);
      gl.uniform4fv(this.progGround.U('uSP'), SP);
      gl.bindVertexArray(this.ground.vao);
      gl.drawElements(gl.TRIANGLES, this.ground.count, gl.UNSIGNED_INT, 0);
    }
    // 3) 部品 (形ごとに 1 回のインスタンス描画)
    gl.useProgram(this.progObj); common(this.progObj);
    // 不透明なものを先に描き、地平線へ消えかけているもの (消え < 1) は奥から順に半透明で重ねる
    const drawSet = (type, data)=>{
      const n = data.length/24; if(!n) return;
      const mesh = this.meshes[type];
      gl.bindVertexArray(mesh.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instVBO);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      for(let k=0;k<6;k++){
        gl.enableVertexAttribArray(2 + k);
        gl.vertexAttribPointer(2 + k, 4, gl.FLOAT, false, 96, k*16);
        gl.vertexAttribDivisor(2 + k, 1);
      }
      gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0, n);
    };
    // 半透明 (地平線へ消えかけ) のものは 物ごと にまとめる。
    //   以前は「半透明のもの全部の深度 → 全部の色」の順だったため、手前に薄い物 (遠くの布・岩など) があると、
    //   その後ろの構造物が半透明側へ移った瞬間に深度で隠され、急に消えていた。
    //   今は 物ごとに奥から順に「深度だけ → 色」を描く: 後ろの物は先に描かれているので消えず、自分の裏面は透けない
    const groups = new Map();
    for(const type of Object.keys(this._inst)){
      const arr = this._inst[type], gid = this._gid[type]; const n = arr.length/24; if(!n) continue;
      const op = [];
      for(let q=0;q<n;q++){
        const b = q*24, fd = arr[b + 18];
        if(fd >= 0.999){ for(let k=0;k<24;k++) op.push(arr[b + k]); continue; }
        let G = groups.get(gid[q]);
        if(!G){ G = { d:0, n:0, parts:{} }; groups.set(gid[q], G); }
        const dx = arr[b+12], dy = arr[b+13], dz2 = arr[b+14];
        G.d += Math.sqrt(dx*dx + dy*dy + dz2*dz2); G.n++;
        (G.parts[type] || (G.parts[type] = [])).push(arr.slice(b, b + 24));
      }
      drawSet(type, new Float32Array(op));
    }
    if(groups.size){
      const list = [...groups.values()].sort((a, b)=> b.d/b.n - a.d/a.n);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);   // 出力の alpha は 1 のまま
      gl.depthFunc(gl.LEQUAL);
      for(const G of list){
        const runs = [];
        for(const ty in G.parts){ const L = G.parts[ty]; const data = new Float32Array(L.length*24); L.forEach((v, q)=>data.set(v, q*24)); runs.push([ty, data]); }
        gl.colorMask(false, false, false, false); gl.depthMask(true);
        for(const [ty, data] of runs) drawSet(ty, data);
        gl.colorMask(true, true, true, true); gl.depthMask(false);
        for(const [ty, data] of runs) drawSet(ty, data);
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    if(useRBO) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },
};

// PDefaults はスクリプト読込時に確定させる (init より先に state 復元が走るため)
SurrealFloat.PDefaults = JSON.parse(JSON.stringify(SurrealFloat.P));
