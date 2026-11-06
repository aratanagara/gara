'use strict';
/* 41/49 Tower engine — vj/ の追加レンダリングモード (kind:'tower4149')。
   Shadertoy NdVXDD "41/49" のレイマーチ版 (1920x1080 で 1 フレーム約 70ms) を、メッシュで描き直した軽量版。
   形は Nomad Sculpt で球を引きずって作ったような、鏡面のトゲの塊:
   - 正二十面体を 5 回分割した球 (約 1 万頂点) を、頂点シェーダで変形する。ピクセルごとのレイマーチは無し。
   - トゲ = 球面上の楕円の帽子を外へ引き出す。断面を潰して刃にし (Blade)、先を曲げ (Bend)、長い刃にはしわを入れる (Crumple)。
     核は小さくし、全方向の短い破片で覆う (丸い面を見せない)。
     長さは裾の重い分布で、数本だけ画面の外まで伸びる。
   - 面の法線は三角形の 3 点を変形して求める (引き伸ばされた細長い三角形の面がそのまま立つ)。
   - 反射は背景と同じ縦グラデーションの空 (上 = 背景色 / 地平線の下 = 暗いスレートと茶の帯)。
   - MSAA (RGBA16F) に描いてスロット FBO へ解決する。
   Morph で常にゆっくり変形し続ける (向きが漂い、曲がり・しわが流れ、長さが呼吸する)。その上に原作と同じ時間の扱い: Sharp でカクッと切り替わり、Rate 回/秒 (beat では拍) ごとにトゲが伸び縮みし、
   Tumble Rate 回/秒 (beat では拍) ごとに姿勢が切り替わる。Slot B は背景を透過する。
   IF: init(gl) / update() / render({fbo,w,h,slot,beat,clock,opaque}) / P / PDefaults / SPECS
*/

const Tower4149 = {
  gl:null, initialized:false, ok:false,
  progMesh:null, progBg:null, vaoMesh:null, vaoBg:null, nVert:0,
  msaa:null, startTime:0,
  MAXK:64,

  // ── パラメータ (UI から操作)。% 表記は原作シェーダの @param と同じ意味 ──
  P:{
    speed:100,      // 全体の時間の速さ (%)
    sharp:70,       // 100 に近いほど動きがカクッと切り替わる (%)
    count:56,       // トゲの本数 (長い刃は数方向の束、残りは核を覆う短い破片)
    length:100,     // トゲの長さ (%)
    stretch:100,    // 伸び縮みの幅 (%)
    rate:2,         // 1 秒 (beat では 2 拍) あたり何回伸び縮みするか
    mega:35,        // 一部のトゲがさらに伸びる確率 (%)
    blade:70,       // 断面の潰れ (0 = 円錐 / 100 = 薄い刃)
    width:100,      // 刃の根元の幅 (%)
    taper:100,      // 先細りの強さ (% 。低い = 直線的な刃 / 高い = 根元が広く先は針)
    bundles:3,      // 長い刃の束の数
    spread:100,     // 束の開き (%)
    shards:43,      // 短い破片の割合 (%。核を覆って丸い面を見せない)
    core:100,       // 核の大きさ (%)
    bend:40,        // 先端の曲がり (%)
    crumple:50,     // 長い刃のしわ (引き伸ばした箔のくしゃっとした凹凸, %)
    morph:100,      // 常に続くゆっくりした変形 (トゲの向きが漂い、曲がり・しわが流れ、長さが呼吸する, %)
    morphSpeed:100, // 変形の速さ (%)
    spin:40,        // 縦軸まわりの回転 (%)
    tumble:60,      // ランダムな 3D 姿勢の振れ幅 (%)
    tumbleRate:2,   // 1 秒 (beat では 2 拍) あたり何回姿勢が切り替わるか
    zoom:100,       // 寄り (%)
    posX:32,        // 塊の横位置 (画面中心からの % 。正 = 右)
    posY:24,        // 塊の縦位置 (% 。正 = 上)
    light:100,      // 鏡面に走るライトの帯の強さ (%)
    warm:40,        // 反射に映る茶の帯 (%)
    seed:0,         // トゲの配置と形の乱数シード
    bgColor:[0.78, 0.83, 0.94],   // 背景 (空) の上側の色。反射にも映る。Slot B は透過
  },

  SPECS:[
    ['Speed',       'speed',      0,   300, 1,   'pct'],
    ['Sharp',       'sharp',      0,   100, 1,   'pct'],
    ['Spikes',      'count',      4,   64,  1,   'int'],
    ['Length',      'length',     0,   300, 1,   'pct'],
    ['Stretch',     'stretch',    0,   300, 1,   'pct'],
    ['Rate',        'rate',       1,   8,   0.5, 'f2'],
    ['Mega',        'mega',       0,   100, 1,   'pct'],
    ['Blade',       'blade',      0,   100, 1,   'pct'],
    ['Width',       'width',      20,  300, 1,   'pct'],
    ['Taper',       'taper',      30,  300, 1,   'pct'],
    ['Bundles',     'bundles',    1,   8,   1,   'int'],
    ['Spread',      'spread',     0,   300, 1,   'pct'],
    ['Shards',      'shards',     0,   100, 1,   'pct'],
    ['Core',        'core',       0,   300, 1,   'pct'],
    ['Bend',        'bend',       0,   100, 1,   'pct'],
    ['Crumple',     'crumple',    0,   100, 1,   'pct'],
    ['Morph',       'morph',      0,   200, 1,   'pct'],
    ['Morph Speed', 'morphSpeed', 0,   400, 1,   'pct'],
    ['Spin',        'spin',       0,   100, 1,   'pct'],
    ['Tumble',      'tumble',     0,   100, 1,   'pct'],
    ['Tumble Rate', 'tumbleRate', 1,   8,   0.5, 'f2'],
    ['Zoom',        'zoom',       50,  200, 1,   'pct'],
    ['Pos X',       'posX',       -100, 100, 1,  'pct'],
    ['Pos Y',       'posY',       -100, 100, 1,  'pct'],
    ['Light',       'light',      0,   300, 1,   'pct'],
    ['Warm',        'warm',       0,   100, 1,   'pct'],
    ['Seed',        'seed',       0,   99,  1,   'int'],
  ],

  _compile(type, src){
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('Tower4149 shader:', gl.getShaderInfoLog(s));
    return s;
  },
  _link(vs, fs){
    const gl = this.gl;
    const p = gl.createProgram();
    gl.attachShader(p, this._compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this._compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)){ console.error('Tower4149 link:', gl.getProgramInfoLog(p)); return null; }
    return p;
  },

  init(gl){
    this.gl = gl;
    this.initialized = true;
    this.startTime = performance.now()/1000;

    const ENV = `
uniform vec3 uTop;
uniform float uWarm;
uniform float uLight;
// 空: 上 = 背景色 / 地平線の少し上が最も明るい / 下 = 暗いスレート (近くに茶の帯)
vec3 groundCol(){ return vec3(0.16,0.19,0.19)*(dot(uTop,vec3(0.3333))/0.85); }
vec3 env(vec3 r){
  float y = r.y;
  vec3 zen = uTop*vec3(0.62,0.68,0.8);
  vec3 sky = mix(vec3(1.0), uTop, smoothstep(-0.12, 0.25, y));
  sky = mix(sky, zen, smoothstep(0.35, 0.95, y));
  vec3 g = groundCol();
  vec3 gnd = mix(g*1.6, g*0.55, smoothstep(0.15, 0.7, -y));
  float band = smoothstep(0.24, 0.3, -y)*(1.0 - smoothstep(0.38, 0.5, -y));
  gnd = mix(gnd, vec3(0.46,0.33,0.20), band*uWarm);
  vec3 c = mix(gnd, sky, smoothstep(-0.17, -0.13, y));
  // スタジオの縦長ライトと暗幕: 方位で明暗の帯 (鏡面の面ごとに光と影が走る)
  float az = atan(r.z, r.x);
  float up = smoothstep(-0.1, 0.2, y)*(1.0 - smoothstep(0.6, 0.9, y));
  c += vec3(0.95,0.97,1.0)*0.6*uLight*smoothstep(0.9, 0.99, cos(az*5.0 + 1.1))*up;
  c *= 1.0 - min(0.9, 0.55*uLight)*smoothstep(0.75, 0.95, cos(az*2.0 - 0.6))*up;
  return c;
}`;

    this.progMesh = this._link(`#version 300 es
precision highp float;
in vec3 aP0;             // 単位球の頂点 (この頂点)
in vec3 aP1;             // 同じ三角形の残り 2 点 (面法線用。巻き順はこの頂点から反時計回り)
in vec3 aP2;
uniform mat4 uVP;
uniform mat3 uRot;       // 物体の姿勢
uniform vec3 uCenter;
uniform int uK;
uniform vec4 uSpkA[64];  // トゲの向き xyz / 長さ
uniform vec4 uSpkB[64];  // 刃の向き (向きに直交。長さ = 断面の潰れ倍率) xyz / 帽子の半径
uniform vec4 uSpkC[64];  // 曲がる向き xyz / 曲がり
uniform float uCrumple;
uniform float uSeed;
uniform float uFlow;      // しわの流れ (Morph の時間)
uniform float uCore;      // 核の半径
uniform float uTaper;     // 先細りの指数
out vec3 vW;
out vec3 vN;
float h31(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y)*p.z); }
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f*f*(3.0 - 2.0*f);
  return mix(mix(mix(h31(i), h31(i+vec3(1,0,0)), f.x), mix(h31(i+vec3(0,1,0)), h31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i+vec3(0,0,1)), h31(i+vec3(1,0,1)), f.x), mix(h31(i+vec3(0,1,1)), h31(i+vec3(1,1,1)), f.x), f.y), f.z);
}
vec3 deform(vec3 n){
  vec3 p = n*uCore*(1.0 + (vnoise(n*2.3 + uSeed) - 0.5)*0.3);
  for(int k = 0; k < uK; k++){
    vec3 d = uSpkA[k].xyz;
    if(dot(n, d) <= 0.0) continue;
    float fl = length(uSpkB[k].xyz);
    vec3 T = uSpkB[k].xyz/fl;
    float u = dot(n, T);
    float v = dot(n, cross(d, T))*fl;
    float t = 1.0 - sqrt(u*u + v*v)/uSpkB[k].w;
    if(t <= 0.0) continue;
    float f = pow(t, uTaper);   // 根元は広い刃、先は尖る
    float L = uSpkA[k].w;
    p += d*(L*f) + uSpkC[k].xyz*(uSpkC[k].w*L*f*f);
    // 刃の面のくしゃっとした凹凸 (引き伸ばした箔のしわ。面ごとに映り込みが変わる)
    vec3 q = n*5.0 + float(k)*3.1 + uSeed + vec3(0.0, uFlow, uFlow*0.6);
    p += (vec3(vnoise(q), vnoise(q + 17.0), vnoise(q + 41.0)) - 0.5)*(max(L - 0.8, 0.0)*f*(1.0 - f)*0.45*uCrumple);
  }
  return p;
}
void main(){
  vec3 p0 = deform(aP0), p1 = deform(aP1), p2 = deform(aP2);
  vN = uRot*cross(p1 - p0, p2 - p0);
  vW = uRot*p0 + uCenter;
  gl_Position = uVP*vec4(vW, 1.0);
}`, `#version 300 es
precision highp float;
in vec3 vW;
in vec3 vN;
out vec4 frag;
uniform vec3 uCam;
${ENV}
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(vW - uCam);
  if(dot(N, V) > 0.0) N = -N;
  vec3 R = reflect(V, N);
  float fr = pow(1.0 - max(dot(-V, N), 0.0), 5.0);
  vec3 col = env(R)*mix(0.74, 1.0, fr)*vec3(0.93,0.96,1.0);
  col += vec3(1.0)*pow(max(dot(R, normalize(vec3(-0.4, 0.8, 0.45))), 0.0), 120.0)*1.2;
  frag = vec4(col, 1.0);
}`);

    this.progBg = this._link(`#version 300 es
precision highp float;
out vec2 vUv;
void main(){
  vec2 p = vec2((gl_VertexID & 1) == 1 ? 3.0 : -1.0, (gl_VertexID & 2) == 2 ? 3.0 : -1.0);
  vUv = p;
  gl_Position = vec4(p, 0.99999, 1.0);
}`, `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
${ENV}
void main(){
  // 背景: 左上が淡く、下へ暗いスレートへ落ちる (Nomad のビューポートの空)
  vec3 top = mix(uTop, vec3(1.0), 0.25*smoothstep(0.6, -0.8, vUv.x - 0.0));
  vec3 c = mix(groundCol(), top, smoothstep(-0.95, 0.55, vUv.y + 0.12*vUv.x));
  frag = vec4(c, 1.0);
}`);
    if(!this.progMesh || !this.progBg){ this.ok = false; return; }

    this._buildSphere(5);
    this.vaoBg = gl.createVertexArray();
    this._spkSeed = null;
    this.ok = true;
  },

  // 正二十面体を lv 回分割した単位球。面法線を頂点シェーダで出すため、各頂点に三角形の 3 点を持たせる
  _buildSphere(lv){
    const gl = this.gl;
    const t = (1 + Math.sqrt(5))/2;
    let V = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]]
      .map(v=>{ const l = Math.hypot(v[0],v[1],v[2]); return [v[0]/l, v[1]/l, v[2]/l]; });
    let F = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
             [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
    for(let s=0;s<lv;s++){
      const cache = new Map(), nf = [];
      const mid = (a, b)=>{
        const key = a < b ? a*100000 + b : b*100000 + a;
        let i = cache.get(key);
        if(i == null){
          const m = [V[a][0]+V[b][0], V[a][1]+V[b][1], V[a][2]+V[b][2]], l = Math.hypot(m[0],m[1],m[2]);
          i = V.length; V.push([m[0]/l, m[1]/l, m[2]/l]); cache.set(key, i);
        }
        return i;
      };
      for(const [a,b,c] of F){ const ab = mid(a,b), bc = mid(b,c), ca = mid(c,a); nf.push([a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]); }
      F = nf;
    }
    const n = F.length*3;
    const a0 = new Float32Array(n*3), a1 = new Float32Array(n*3), a2 = new Float32Array(n*3);
    F.forEach((f, i)=>{
      for(let c=0;c<3;c++){
        const o = (i*3 + c)*3;
        a0.set(V[f[c]], o); a1.set(V[f[(c+1)%3]], o); a2.set(V[f[(c+2)%3]], o);
      }
    });
    this.vaoMesh = gl.createVertexArray();
    gl.bindVertexArray(this.vaoMesh);
    [['aP0',a0],['aP1',a1],['aP2',a2]].forEach(([name, arr])=>{
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(this.progMesh, name);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    });
    gl.bindVertexArray(null);
    this.nVert = n;
  },

  update(){},

  _h(n){ const s = Math.sin(n*127.1 + 311.7)*43758.5453; return s - Math.floor(s); },

  // トゲごとの固定の乱数 (Seed で作り直す)
  _spikes(seed, NC, spread, shardP){
    const key = seed + '/' + NC + '/' + spread + '/' + shardP;
    if(this._spkSeed === key) return this._spk;
    const h = (i, j)=> this._h(seed*1013.0 + i*17.13 + j*3.71);
    const nrm = (v)=>{ const l = Math.hypot(v[0],v[1],v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; };
    const cross = (a, b)=>[a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
    const out = [];
    const sph = (u, v)=>{ const z = u*2 - 1, a = v*6.2832, r = Math.sqrt(1 - z*z); return [r*Math.cos(a), z, r*Math.sin(a)]; };
    const axes = []; for(let c=0;c<NC;c++) axes.push(sph(h(c,10), h(c,11)));
    for(let k=0;k<this.MAXK;k++){
      // Shards の割合で全方向の短い破片 (核を覆って丸い面を見せない) / 残りは束の長い刃
      const shard = h(k,8) < shardP;
      let d;
      if(shard) d = sph(h(k,1), h(k,2));
      else {
        const ax = axes[k % NC], r = sph(h(k,1), h(k,2));
        d = nrm([ax[0] + r[0]*0.62*spread, ax[1] + r[1]*0.62*spread, ax[2] + r[2]*0.62*spread]);
      }
      const tmp = Math.abs(d[1]) < 0.9 ? [0,1,0] : [1,0,0];
      const t0 = nrm(cross(d, tmp)), t1 = cross(d, t0);
      const ta = h(k,3)*6.2832, ba = h(k,4)*6.2832;
      const T = nrm([t0[0]*Math.cos(ta)+t1[0]*Math.sin(ta), t0[1]*Math.cos(ta)+t1[1]*Math.sin(ta), t0[2]*Math.cos(ta)+t1[2]*Math.sin(ta)]);
      const Bd = nrm([t0[0]*Math.cos(ba)+t1[0]*Math.sin(ba), t0[1]*Math.cos(ba)+t1[1]*Math.sin(ba), t0[2]*Math.cos(ba)+t1[2]*Math.sin(ba)]);
      const L0 = shard ? 0.2 + 0.4*h(k,5) : 0.6 + 3.8*Math.pow(h(k,5), 2.2);   // 刃は裾の重い分布: 大半は中くらい、数本だけ巨大
      out.push({ d, T, Bd, L0, shard, cap: shard ? 0.42 + 0.25*h(k,6) : 0.21 + 0.04*L0 + 0.16*h(k,6), bend: h(k,7) });
    }
    this._spkSeed = key; this._spk = out;
    return out;
  },

  _ensureMSAA(w, h){
    const gl = this.gl;
    if(this.msaa && this.msaa.w === w && this.msaa.h === h) return this.msaa;
    if(this.msaa){ gl.deleteFramebuffer(this.msaa.fbo); gl.deleteRenderbuffer(this.msaa.col); gl.deleteRenderbuffer(this.msaa.dep); }
    // スロット FBO は RGBA16F。MSAA の解決 (blit) は同じ形式が要るので 16F で取る
    const sup = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES);
    const samples = sup && sup.length ? Math.min(4, Math.max(...sup)) : 0;
    const fbo = gl.createFramebuffer(), col = gl.createRenderbuffer(), dep = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, col);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA16F, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, dep);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, col);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, dep);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.msaa = { fbo, col, dep, w, h };
    return this.msaa;
  },

  // 3 軸の回転 (Y → X → Z の順に掛けた 3x3、列優先)
  _rot(ax, ay, az){
    const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
    const Rx = [1,0,0, 0,cx,sx, 0,-sx,cx], Ry = [cy,0,-sy, 0,1,0, sy,0,cy], Rz = [cz,sz,0, -sz,cz,0, 0,0,1];
    const mul = (A, B)=>{ const o = new Array(9); for(let c=0;c<3;c++) for(let r=0;r<3;r++) o[c*3+r] = A[r]*B[c*3] + A[3+r]*B[c*3+1] + A[6+r]*B[c*3+2]; return o; };
    return mul(Ry, mul(Rx, Rz));
  },

  render(opts){
    const gl = this.gl;
    if(!this.initialized || !this.ok || !opts.fbo) return;
    const P = this.P;
    const dz = (v)=> (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v;
    const w = opts.w, h = opts.h;
    const clock = (opts.clock != null) ? opts.clock : (performance.now()/1000 - this.startTime);
    const beatMode = (typeof App !== 'undefined' && App.beatMode === 'beat') && opts.beat != null;
    const t = clock*dz(P.speed)*0.01;
    const sharp = Math.max(0, Math.min(1, dz(P.sharp)*0.01));
    // 切り替えの曲線: Sharp 0 = なめらか / 100 = 立ち上がり急峻 (カクッと切り替わってホールド)
    const ease = (ph)=>{ const sm = ph*ph*(3 - 2*ph), sn = 1 - Math.pow(1 - ph, 6); return sm + (sn - sm)*sharp; };

    // ── トゲの長さ: Rate 回/秒 (beat は 2 拍で Rate 回) ごとに引き直す ──
    const seed = Math.round(dz(P.seed) || 0);
    const NC = Math.max(1, Math.min(8, Math.round(dz(P.bundles))));
    const SPK = this._spikes(seed, NC, Math.max(0, dz(P.spread)*0.01), Math.max(0, Math.min(1, dz(P.shards)*0.01)));
    const K = Math.max(1, Math.min(this.MAXK, Math.round(dz(P.count))));
    const bt = beatMode ? opts.beat*0.5*Math.max(0, dz(P.speed)*0.01) : t;   // beat: 2 拍で 1 単位
    const st = bt*Math.max(0.1, P.rate);
    const sk = Math.floor(st), e = ease(st - sk);
    const mega = Math.max(0, Math.min(1, dz(P.mega)*0.01));
    const lenK = dz(P.length)*0.01, strK = dz(P.stretch)*0.01;
    const g = (k, s)=>{
      const r1 = this._h(k*7.3 + s*1.91 + seed*0.37), r2 = this._h(k*3.1 + s*5.17 + 9.0), r3 = this._h(k*11.7 + s*2.33 + 4.0);
      const v = (r1 < 0.22 ? 0.25 : 0.55 + 0.9*r2)*(r3 < mega*0.35 ? 2.4 : 1.0);
      return 1 + (v - 1)*strK;
    };
    const A = new Float32Array(this.MAXK*4), B = new Float32Array(this.MAXK*4), C = new Float32Array(this.MAXK*4);
    const bendK = dz(P.bend)*0.01, bladeK = Math.max(0, dz(P.blade)*0.01), widthK = Math.max(0.05, dz(P.width)*0.01);
    // Morph: 拍の切り替えとは別に、常にゆっくり変形し続ける (向きが漂い、曲がりが揺れ、長さが呼吸する)
    const mo = Math.max(0, dz(P.morph)*0.01), mt = t*0.35*Math.max(0, dz(P.morphSpeed)*0.01);
    const ortho = (v, d)=>{ const k = v[0]*d[0] + v[1]*d[1] + v[2]*d[2]; const o = [v[0]-d[0]*k, v[1]-d[1]*k, v[2]-d[2]*k]; const l = Math.hypot(o[0],o[1],o[2]) || 1; return [o[0]/l, o[1]/l, o[2]/l]; };
    for(let k=0;k<K;k++){
      const s = SPK[k];
      const ph = k*2.39996;
      const w1 = Math.sin(mt*0.9 + ph), w2 = Math.sin(mt*0.7 + ph*1.7), w3 = Math.sin(mt*1.1 + ph*2.3);
      let d = [s.d[0] + (s.T[0]*w1 + s.Bd[0]*w2)*0.45*mo, s.d[1] + (s.T[1]*w1 + s.Bd[1]*w2)*0.45*mo, s.d[2] + (s.T[2]*w1 + s.Bd[2]*w2)*0.45*mo];
      { const l = Math.hypot(d[0],d[1],d[2]); d = [d[0]/l, d[1]/l, d[2]/l]; }
      const T = ortho(s.T, d), Bd = ortho(s.Bd, d);
      const breathe = 1 + 0.35*mo*Math.sin(mt*1.3 + ph*0.7);
      const L = s.L0*lenK*breathe*Math.max(0, g(k, sk - 1) + (g(k, sk) - g(k, sk - 1))*e);
      A.set([d[0], d[1], d[2], L], k*4);
      const fl = s.shard ? 1 : 1 + bladeK*4;   // 破片は潰さない (幅広の角錐で核を覆う)、長い刃だけ薄くする
      B.set([T[0]*fl, T[1]*fl, T[2]*fl, s.cap*widthK], k*4);
      C.set([Bd[0], Bd[1], Bd[2], ((s.bend - 0.3)*0.9 + 0.5*mo*w3)*bendK], k*4);
    }

    // ── 姿勢: 固定の傾き + 縦軸の回転 + Tumble Rate ごとに急峻に切り替わるランダム姿勢 ──
    const tr = bt*Math.max(0.1, P.tumbleRate);
    const tk = Math.floor(tr), te = ease(tr - tk);
    const tum = Math.max(0, dz(P.tumble)*0.01)*6.2832;
    const ang = (i)=>{ const a = this._h(tk*3.7 + i*19.1 + seed), b = this._h((tk + 1)*3.7 + i*19.1 + seed); return (a + (b - a)*te)*tum; };
    const spin = t*dz(P.spin)*0.012;
    const R = this._rot(0.22 + ang(0), spin + ang(1), ang(2));

    // ── カメラ: 塊を右上へ寄せ、トゲが左下へ画面の外まで抜ける構図 ──
    const aspect = w/h, F = 2.4, near = 0.05, far = 60;
    const camZ = 2.7/Math.max(0.3, dz(P.zoom)*0.01);
    const proj = [F/aspect,0,0,0, 0,F,0,0, 0,0,(far+near)/(near-far),-1, 0,0,2*far*near/(near-far),0];
    const VP = new Float32Array(proj);
    VP[14] += proj[10]*(-camZ); VP[15] += proj[11]*(-camZ);   // view = translate(0,0,-camZ)

    const bc = Array.isArray(P.bgColor) ? P.bgColor : this.PDefaults.bgColor;
    const opaque = opts.opaque !== false;
    const M = this._ensureMSAA(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, M.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if(opaque){
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.progBg);
      gl.uniform3f(gl.getUniformLocation(this.progBg, 'uTop'), bc[0], bc[1], bc[2]);
      gl.uniform1f(gl.getUniformLocation(this.progBg, 'uWarm'), 0);
      gl.bindVertexArray(this.vaoBg);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    const pm = this.progMesh, U = (n)=>gl.getUniformLocation(pm, n);
    gl.useProgram(pm);
    gl.uniformMatrix4fv(U('uVP'), false, VP);
    gl.uniformMatrix3fv(U('uRot'), false, new Float32Array(R));
    gl.uniform3f(U('uCenter'), dz(P.posX)*0.01, dz(P.posY)*0.01, 0.0);
    gl.uniform1i(U('uK'), K);
    gl.uniform4fv(U('uSpkA'), A); gl.uniform4fv(U('uSpkB'), B); gl.uniform4fv(U('uSpkC'), C);
    gl.uniform1f(U('uCrumple'), Math.max(0, dz(P.crumple)*0.01));
    gl.uniform1f(U('uSeed'), seed*7.31);
    gl.uniform1f(U('uFlow'), mt*mo*0.6);
    gl.uniform1f(U('uCore'), 0.2*Math.max(0, dz(P.core)*0.01));
    gl.uniform1f(U('uTaper'), 1.7*Math.max(0.3, dz(P.taper)*0.01));
    gl.uniform1f(U('uLight'), Math.max(0, dz(P.light)*0.01));
    gl.uniform3f(U('uCam'), 0, 0, camZ);
    gl.uniform3f(U('uTop'), bc[0], bc[1], bc[2]);
    gl.uniform1f(U('uWarm'), Math.max(0, dz(P.warm)*0.01));
    gl.bindVertexArray(this.vaoMesh);
    gl.drawArrays(gl.TRIANGLES, 0, this.nVert);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);

    // MSAA を解決してスロット FBO へ
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, M.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, opts.fbo);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },
};
Tower4149.PDefaults = JSON.parse(JSON.stringify(Tower4149.P));
