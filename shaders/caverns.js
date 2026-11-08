/* =====================================================================
   Caverns — Shadertoy "Triquadratic SDF Caverns" (l3XSD2) の忠実移植 (kind:'caverns')
   3パス構成をそのまま再現:
     - Common : SDF / flightPath / カメラ 等(両パスに前置き)
     - Buffer A : SDF を 8 層に packSnorm して RGBA32F FBO にキャッシュ(自己フィードバック、512フレーム毎に再計算)
     - Image  : Buffer A を triquadratic 補間でレイマーチして描画
   iChannel3(原作の stock ノイズ/blue noise テクスチャ)は手続き生成した RGBA ノイズで代替。
   Shadertoy 原作: https://www.shadertoy.com/view/l3XSD2
===================================================================== */
'use strict';

const Caverns = {
  initialized:false, ok:false, gl:null,
  bufProg:null, imgProg:null, uBuf:null, uImg:null,
  bufFBO:[null,null], bufIdx:0, bufW:0, bufH:0,
  BUFRES:256,   // Buffer A は固定 256x256(飛行エリア world [75,235]x[35,195] を 1unit/px でカバー)。描画解像度から分離
  SCALE:0.5,    // Image パスは縮小解像度で描画 → 線形アップスケール(滑らかな洞窟なので劣化は目立たない。重ければ下げる)
  noiseTex:null, vao:null, _imgFBO:null,
  frame:0, startTime:0, _bakeKey:'',

  // ── パラメータ (UI から操作。使う直前に App.deadParam を通す)。既定値 = 原作と同一の絵 ──
  //   bake: true は地形 SDF (Buffer A) に効くもの。変えたら次のフレームで SDF を焼き直す
  P:{
    caveScale:100,   // 洞窟全体の起伏の大きさ (柱・丘の間隔と高さ, %)
    floorHills:100,  // 床の丘の高さ (%)
    stalactites:100, // 天井から垂れる鍾乳石の長さ (%)
    ceilFreq:100,    // 鍾乳石の細かさ (%)
    ceiling:100,     // 天井の高さ (%)
    tunnel:100,      // 飛行経路にくり抜くトンネルの太さ (%)
    rough:100,       // 岩肌のざらつき (%)
    grain:100,       // ざらつきの細かさ (%)
    lookAhead:100,   // カメラが進行方向のどれだけ先を見るか (%)。上げるとカーブの内側を向く
    beam:100,        // ヘッドライトの絞り (%)。上げると細いスポットに
    falloff:100,     // ヘッドライトの減衰 (%)。下げると奥まで届く
    gloss:100,       // 岩の艶 (鏡面ハイライトの鋭さ, %)
    fog:100,         // 霧の濃さ (%)
    fov:100,         // 画角 (%)。上げると広角
    camRoll:0,       // カメラの傾き (°)
    lookYaw:0,       // 進行方向からの視線の左右の振り (°)。ヘッドライトも一緒に向く
    lookPitch:0,     // 進行方向からの視線の上下の振り (°)
    lightX:0,        // 鏡面ハイライトの光の向き 横 (%)
    lightY:40,       // 鏡面ハイライトの光の向き 上下 (%)
    specular:100,    // 鏡面ハイライトの強さ (%)
    ambient:0,       // ヘッドライトの外の岩肌を照らす環境光 (%)
    ao:0,            // 岩の凹みの影 (%)
    lightHue:0,      // ヘッドライトの色相 (°)
    lightTint:0,     // ヘッドライトの色づき (%)
    hazeGlow:100,    // 霧の色の明るさ (%)
    hazeHue:0,       // 霧の色相のずれ (°)
    fogStart:0,      // 霧が始まる距離
    strata:0,        // 岩の地層の縞の濃さ (%)
    strataFreq:100,  // 地層の縞の細かさ (%)
    filmNoise:0,     // フィルムのざらつき (%)
    renderRes:100,   // 描画の細かさ (%)。下げると粗く柔らかい
    caveStretch:100, // 洞窟の模様の縦横比 (%)。柱の並びが縦長・横長に
    caveRot:0,       // 洞窟の模様の回転 (°)
    shiftX:0,        // 洞窟の模様の横ずらし (%)
    shiftZ:0,        // 洞窟の模様の奥行きずらし (%)
  },
  PDefaults:null,
  SPECS:[
    ['Cave Scale',  'caveScale',   60,  160, 1, 'pct'],
    ['Floor Hills', 'floorHills',  0,   250, 1, 'pct'],
    ['Stalactites', 'stalactites', 0,   300, 1, 'pct'],
    ['Ceiling Freq','ceilFreq',    40,  300, 1, 'pct'],
    ['Ceiling',     'ceiling',     40,  250, 1, 'pct'],
    ['Tunnel',      'tunnel',      40,  300, 1, 'pct'],
    ['Rough',       'rough',       0,   400, 1, 'pct'],
    ['Grain',       'grain',       25,  400, 1, 'pct'],
    ['Look Ahead',  'lookAhead',   20,  600, 1, 'pct'],
    ['Beam',        'beam',        20,  400, 1, 'pct'],
    ['Falloff',     'falloff',     10,  400, 1, 'pct'],
    ['Gloss',       'gloss',       20,  400, 1, 'pct'],
    ['Fog',         'fog',         0,   400, 1, 'pct'],
    ['FOV',         'fov',         50,  220, 1, 'pct'],
    ['Cam Roll',    'camRoll',     -180, 180, 1, 'deg'],
    ['Look Yaw',    'lookYaw',     -45, 45,  1, 'deg'],
    ['Look Pitch',  'lookPitch',   -30, 30,  1, 'deg'],
    ['Light X',     'lightX',      -150, 150, 1, 'pct'],
    ['Light Y',     'lightY',      -150, 150, 1, 'pct'],
    ['Specular',    'specular',    0,   1000, 1, 'pct'],
    ['Ambient',     'ambient',     0,   250, 1, 'pct'],
    ['AO',          'ao',          0,   200, 1, 'pct'],
    ['Light Hue',   'lightHue',    0,   360, 1, 'deg'],
    ['Light Tint',  'lightTint',   0,   100, 1, 'pct'],
    ['Haze Glow',   'hazeGlow',    0,   400, 1, 'pct'],
    ['Haze Hue',    'hazeHue',     -180, 180, 1, 'deg'],
    ['Fog Start',   'fogStart',    0,   100, 1, 'int'],
    ['Strata',      'strata',      0,   100, 1, 'pct'],
    ['Strata Freq', 'strataFreq',  20,  400, 1, 'pct'],
    ['Film Noise',  'filmNoise',   0,   300, 1, 'pct'],
    ['Render Res',  'renderRes',   40,  110, 1, 'pct'],
    ['Cave Stretch','caveStretch', 50,  200, 1, 'pct'],
    ['Cave Rotate', 'caveRot',     -90, 90,  1, 'deg'],
    ['Shift X',     'shiftX',      -100, 100, 1, 'pct'],
    ['Shift Z',     'shiftZ',      -100, 100, 1, 'pct'],
  ],
  _BAKE:['caveScale','floorHills','stalactites','ceilFreq','ceiling','tunnel','rough','grain','caveStretch','caveRot','shiftX','shiftZ'],
  _DEG:['camRoll','lookYaw','lookPitch','lightHue','hazeHue','caveRot'],   // ° → rad
  _RAW:['fogStart'],                                                         // 倍率にせずそのまま

  VS:`#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`,

  HEADER:`#version 300 es
precision highp float;
precision highp int;
uniform vec3  iResolution;
uniform float iTime;
uniform int   iFrame;
uniform vec4  iMouse;
uniform sampler2D iChannel0;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
uniform vec3  iChannelResolution[4];
uniform float uSlotB;   // 1=Slot B(白線+透過)
uniform float uCaveScale;
uniform float uFloorHills;
uniform float uStalactites;
uniform float uCeilFreq;
uniform float uCeiling;
uniform float uTunnel;
uniform float uRough;
uniform float uGrain;
uniform float uLookAhead;
uniform float uBeam;
uniform float uFalloff;
uniform float uGloss;
uniform float uFog;
uniform float uFov;
uniform float uCamRoll;
uniform float uLookYaw;
uniform float uLookPitch;
uniform float uLightX;
uniform float uLightY;
uniform float uSpecular;
uniform float uAmbient;
uniform float uAo;
uniform float uLightHue;
uniform float uLightTint;
uniform float uHazeGlow;
uniform float uHazeHue;
uniform float uFogStart;
uniform float uStrata;
uniform float uStrataFreq;
uniform float uFilmNoise;
uniform float uCaveStretch;
uniform float uCaveRot;
uniform float uShiftX;
uniform float uShiftZ;
out vec4 _o;
`,

  // ===== Common (原作 Common をそのまま) =====
  COMMON:`
#define R iResolution.xy
#define IZERO min(0, iFrame)
const float pi = acos(-1.);
const int   NLAYERS = 8;
const float yscale = .325 * float(NLAYERS) / 4.;
const float NORMRANGE = 4.;
vec2 StoQ(vec2 s, vec2 r){ return (s + s - r) / r.y; }
mat3 cameraMatrix(vec3 camFwd){
  vec3 w = normalize(camFwd), u = normalize(cross(vec3(0,1,0), w)), v = normalize(cross(w, u));
  return mat3(u, v, w);
}
const vec3 fpmid = vec3(155, 4.75, 115);
const float fprad = 80., fpwid = 2.25;
float dFlightPath(vec3 p){ p -= fpmid; p /= fprad; return length(abs(vec2(length(p.xz) - 1., p.y))) * fprad - fpwid * uTunnel; }
vec3 flightPath(float time){ float t = .02 * time; t = mod(t, pi + pi); return fprad * vec3(sin(t), 0, cos(t)) + fpmid; }
float SDF(vec3 p){
  float dt = dFlightPath(p);
  float scale = 32. * uCaveScale;
  if(uCaveRot != 0.){ float cr = cos(uCaveRot), sr = sin(uCaveRot); p.xz = fpmid.xz + mat2(cr, -sr, sr, cr) * (p.xz - fpmid.xz); }
  p.xz += vec2(uShiftX, uShiftZ) * scale;
  p.xz /= scale * .5 / pi;
  p.x *= uCaveStretch; p.z /= uCaveStretch;
  float df = p.y + 0.5 - .55*uFloorHills*(sin(p.x)*sin(p.z)*.5+.5)*scale*yscale,
        dc = (sin(1.7*uCeilFreq*p.x)*sin(1.8*uCeilFreq*p.z)*.5+.5)*scale*yscale*.5*uStalactites - p.y + 5.5*uCeiling;
  df *= .75; dc *= .75;
  return max(min(df, dc), -dt);
}
`,

  // ===== Buffer A (SDF を 8 層に pack。iChannel0=自身のフィードバック / iChannel3=ノイズ) =====
  BUF_MAIN:`
#define BufferA iChannel0
float SDFLevel(vec2 p, float y){
  y += .5;
  vec3 q = vec3(p.x, y / yscale, p.y);
  vec2 nuv = 0.7 * uGrain * vec2(q.x + q.y*3.7, q.z + q.y*2.3) / vec2(textureSize(iChannel3, 0));
  return max(SDF(q) + (texture(iChannel3, nuv).x - 0.5) * uRough, -dFlightPath(q));
}
void mainImage(out vec4 c, vec2 p){
  if ((iFrame & 511) >= 2) { c = texelFetch(BufferA, ivec2(p), 0); return; }  // 大半はキャッシュを保持
  vec4 d;
  for (int i = 0; i < NLAYERS / 2; ++i)
    d[i] = uintBitsToFloat(packSnorm2x16(
      1. / NORMRANGE * vec2(SDFLevel(p, float(i*2)), SDFLevel(p, float(i*2 + 1)))));
  c = d;
}
`,

  // ===== Image (Buffer A を triquadratic でレイマーチ) =====
  IMG_MAIN:`
#define BufferA iChannel0
#define BufASize iChannelResolution[0].xy
#define DitherNoise iChannel3
vec3 hue2rgb(float h){ return clamp(abs(mod(h * 6. / (2. * pi) + vec3(0., 4., 2.), 6.) - 3.) - 1., 0., 1.); }
vec3 skyColor(vec3 d){
  vec3 b = vec3(.9,.6,.3);
  if(uHazeHue != 0.) b = ((hue2rgb(pi / 6. + uHazeHue) - 1.) * (2. / 3.) + 1.) * .9;
  return b * .1 * uHazeGlow;
}
float VT(ivec3 q){
  return NORMRANGE * unpackSnorm2x16(floatBitsToUint(texelFetch(BufferA, q.xz, 0)[q.y>>1]))[q.y&1];
}
float vtriquadraticLooped(vec3 q){
  vec3 p = floor(q), f = q - p;
  ivec3 j = ivec3(p);
  float d = 0.;
  for (int c = 0; c < 27; ++c) {
    ivec3 k = ivec3(c % 3, (c / 3) % 3, c / 9) - 1;
    float m = .125;
    switch (k.x) { case -1: m *= (1.-f.x)*(1.-f.x); break; case 0: m *= 2.*(1.-f.x)*(f.x)+1.; break; case 1: m *= (f.x)*(f.x); break; }
    switch (k.y) { case -1: m *= (1.-f.y)*(1.-f.y); break; case 0: m *= 2.*(1.-f.y)*(f.y)+1.; break; case 1: m *= (f.y)*(f.y); break; }
    switch (k.z) { case -1: m *= (1.-f.z)*(1.-f.z); break; case 0: m *= 2.*(1.-f.z)*(f.z)+1.; break; case 1: m *= (f.z)*(f.z); break; }
    d += m * VT(j + k);
  }
  return d;
}
float SDFbuf(vec3 p){
  p.y *= yscale;
  vec3 q = clamp(p, vec3(0), vec3(BufASize - 1.0001, float(NLAYERS) - 1.01).xzy);
  return vtriquadraticLooped(q);
}
vec3 Gradient(vec3 q, float h){
  vec3 n = vec3(0), e;
  for (float i = min(0., iTime) + 4.; i-- > 0.; ) {
    e = mod(floor(.5 * (i + vec3(3, 0, i))), 2.) * 2. - 1.;
    n += SDFbuf(h * e + q) * e;
  }
  return n;
}
const float tmax = 128.;
float RayMarch(vec3 ro, vec3 rd, int niter){
  float l = 0.;
  for (int j = niter; j-- > 0; ) {
    float d = SDFbuf(l * rd + ro);
    l += d;
    if (l >= tmax) { l = tmax; break; }
    if (d < .001 * l) break;
  }
  return l;
}
vec3 RenderScene(vec3 ro, vec3 rd, vec3 cf, out float d, out vec3 outN){
  vec3 L = normalize(vec3(uLightX, uLightY, 1.));
  d = RayMarch(ro, rd, 200 + IZERO);
  outN = -L;
  if (d <= 0.) return vec3(1,0,0);
  vec3 n = normalize(Gradient(d * rd + ro, .0004 * d));
  if (d >= tmax) n = -L;
  outN = n;
  float spot = pow(max(0., dot(rd, cf)), 16. * uBeam) / (1. + .04 * uFalloff * d * d);
  vec3 csky = skyColor(rd);
  vec3 c = vec3(0);
  c += 1.1 * pow(max(0., -dot(n, rd)), 1.) * spot;
  vec3 h = normalize(-rd + L);
  float sp = 32. * uGloss;
  c += .4 * 8. / pi * (sp + 2.) * pow(max(0., dot(n, h)), sp) * spot * spot * uSpecular;
  vec3 hp = d * rd + ro;
  if(uAmbient != 0.) c += uAmbient * .02 * max(0., -dot(n, rd)) * exp2(-.03 * d);
  if(uAo != 0.){
    float occ = 0., w = 1.;
    for(int i = IZERO; i < 2; ++i){
      float hh = .12 * float(i + 1) * d + .05;
      occ += w * max(0., hh - SDFbuf(hp + n * hh)) / hh;
      w *= .5;
    }
    c *= 1. - clamp(uAo * occ, 0., 1.);
  }
  if(uStrata != 0.) c *= 1. - clamp(uStrata, 0., 1.) * .7 * (.5 - .5 * sin(hp.y * 10. * uStrataFreq));
  if(uLightTint != 0.) c *= mix(vec3(1.), hue2rgb(uLightHue), clamp(uLightTint, 0., 1.));
  c = mix(csky, c, exp2(-.01 * uFog * (uFogStart != 0. ? max(d - uFogStart, 0.) : d)));
  return c;
}
void ViewRay(vec2 p, vec2 r, out vec3 ro, out vec3 rd, out vec3 cf){
  vec2 q = StoQ(p, r);
  vec3 eye_pos = flightPath(iTime), eye_future = flightPath(iTime+1.*uLookAhead), look_dir = normalize(eye_future - eye_pos);
  mat3 M = cameraMatrix(look_dir);
  cf = look_dir;
  float hfovy = pi / 7. * uFov;
  ro = eye_pos;
  vec3 rl = vec3(q, 1. / tan(hfovy));
  if(uCamRoll != 0.){ float cr = cos(uCamRoll), sr = sin(uCamRoll); rl.xy = mat2(cr, -sr, sr, cr) * rl.xy; }
  if(uLookYaw != 0. || uLookPitch != 0.){
    float cp = cos(uLookPitch), sp = sin(uLookPitch), cy = cos(uLookYaw), sy = sin(uLookYaw);
    mat2 rp = mat2(cp, -sp, sp, cp), ry = mat2(cy, -sy, sy, cy);
    rl.yz = rp * rl.yz; rl.xz = ry * rl.xz;
    vec3 fw = vec3(0., 0., 1.);
    fw.yz = rp * fw.yz; fw.xz = ry * fw.xz;
    cf = normalize(M * fw);
  }
  rd = normalize(M * normalize(rl));
}
void mainImage(out vec4 o, vec2 p){
  vec3 ro, rd, cf; float d; vec3 n;
  ViewRay(p, R, ro, rd, cf);
  vec3 c = RenderScene(ro, rd, cf, d, n);
  if(uSlotB > 0.5){
    // Slot B: 白線(エッジ)+ 透過。深度の急変(シルエット)+ 法線の急変(クリース)+ グレージング
    float hit = (d < tmax - 0.5) ? 1.0 : 0.0;
    float de = fwidth(d);
    float ne = length(fwidth(n));
    float rim = pow(1.0 - abs(dot(n, rd)), 4.0);
    float line = clamp(de*0.08 + ne*2.6 + rim*0.5, 0.0, 1.0) * hit;
    line = smoothstep(0.18, 0.6, line);
    o = vec4(vec3(1.0), line);   // 白線、alpha=line(それ以外は透過)
    return;
  }
  c = 1.0 * c / (c + .1);
  o = vec4(pow(c, vec3(.4545)), 1);
  o.rgb += exp2(-8.) * (texelFetch(DitherNoise, ivec2(p) % textureSize(DitherNoise, 0), 0).r - .5);
  if(uFilmNoise != 0.) o.rgb += uFilmNoise * .08 * (texelFetch(DitherNoise, (ivec2(p) + ivec2(iFrame * 37, iFrame * 91)) % textureSize(DitherNoise, 0), 0).g - .5);
}
`,

  WRAP:`
void main(){ vec4 c; mainImage(c, gl_FragCoord.xy); _o = c; }
`,

  _compile(gl, type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if(!__glReady(gl, s, false)){ console.error('Caverns '+(type===gl.VERTEX_SHADER?'VS':'FS')+':', gl.getShaderInfoLog(s)); return null; }
    return s;
  },
  _link(gl, vsSrc, fsSrc){
    const vs = this._compile(gl, gl.VERTEX_SHADER, vsSrc), fs = this._compile(gl, gl.FRAGMENT_SHADER, fsSrc);
    if(!vs || !fs) return null;
    const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if(!__glReady(gl, p, true)){ console.error('Caverns link:', gl.getProgramInfoLog(p)); return null; }
    return p;
  },
  _locs(gl, p){
    return {
      iResolution: gl.getUniformLocation(p,'iResolution'),
      iTime:       gl.getUniformLocation(p,'iTime'),
      iFrame:      gl.getUniformLocation(p,'iFrame'),
      iMouse:      gl.getUniformLocation(p,'iMouse'),
      iChannel0:   gl.getUniformLocation(p,'iChannel0'),
      iChannel3:   gl.getUniformLocation(p,'iChannel3'),
      iChannelResolution: gl.getUniformLocation(p,'iChannelResolution[0]'),
      uSlotB:      gl.getUniformLocation(p,'uSlotB'),
      P: Object.fromEntries(Object.keys(this.P).map(k => [k, gl.getUniformLocation(p, 'u' + k[0].toUpperCase() + k.slice(1))])),
    };
  },

  init(gl){
    if(this.initialized) return this.ok;
    this.gl = gl;
    gl.getExtension('EXT_color_buffer_float');
    this.bufProg = this._link(gl, this.VS, this.HEADER + this.COMMON + this.BUF_MAIN + this.WRAP);
    this.imgProg = this._link(gl, this.VS, this.HEADER + this.COMMON + this.IMG_MAIN + this.WRAP);
    if(!this.bufProg || !this.imgProg){ this.initialized = true; this.ok = false; return false; }
    this.uBuf = this._locs(gl, this.bufProg);
    this.uImg = this._locs(gl, this.imgProg);
    this.vao = gl.createVertexArray();
    this.noiseTex = this._makeNoiseTex();
    const B = this.BUFRES;
    this.bufFBO = [ this._mkFloatFBO(B, B), this._mkFloatFBO(B, B) ];
    this.bufIdx = 0; this.bufW = B; this.bufH = B;
    this.startTime = performance.now()/1000;
    this.frame = 0;
    this.initialized = true; this.ok = true;
    return true;
  },

  _makeNoiseTex(){
    const gl = this.gl, S = 256, data = new Uint8Array(S*S*4);
    for(let i=0;i<data.length;i++) data[i] = (Math.random()*256)|0;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return tex;
  },

  _mkFloatFBO(w, h){
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  },
  _mkColorFBO(w, h){
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  },

  update(){ /* 時刻/フレームは render 内で進める */ },

  render(opts){
    if(!this.ok) return;
    const gl = this.gl, { fbo, w, h, slot } = opts, B = this.BUFRES;
    const time = (typeof opts.clock === 'number') ? opts.clock : (performance.now()/1000 - this.startTime);
    const rr = Math.max(0.05, ((typeof App !== 'undefined' && App.deadParam) ? App.deadParam(this.P.renderRes) : this.P.renderRes) / 100);
    const iw = Math.max(2, Math.round(w * this.SCALE * rr)), ih = Math.max(2, Math.round(h * this.SCALE * rr));
    if(!this._imgFBO || this._imgFBO.w !== iw || this._imgFBO.h !== ih){
      if(this._imgFBO){ gl.deleteTexture(this._imgFBO.tex); gl.deleteFramebuffer(this._imgFBO.fbo); }
      this._imgFBO = this._mkColorFBO(iw, ih);
    }

    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);

    // パラメータ (%) → 倍率。地形に効くものが変わったら SDF を焼き直す (Buffer A は frame&511 < 2 で再計算)
    const P = this.P;
    const dz = (v)=> (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v;
    const pv = {};
    for(const k of Object.keys(P)) pv[k] = dz(P[k]) / 100;
    for(const k of this._DEG) pv[k] = dz(P[k]) * Math.PI / 180;
    for(const k of this._RAW) pv[k] = dz(P[k]);
    for(const k of ['caveScale','ceilFreq','ceiling','tunnel','grain','lookAhead','beam','falloff','gloss','fov','strataFreq','caveStretch']) pv[k] = Math.max(0.05, pv[k]);
    const bakeKey = this._BAKE.map(k => pv[k]).join(',');
    if(bakeKey !== this._bakeKey){ this._bakeKey = bakeKey; this.frame = 0; }
    const setP = (U)=>{ for(const k in U.P) if(U.P[k]) gl.uniform1f(U.P[k], pv[k]); };

    // ---- Pass 1: Buffer A (自身のフィードバックを読みつつ SDF キャッシュを書く。固定 BUFRES) ----
    const cur = this.bufFBO[this.bufIdx], nxt = this.bufFBO[this.bufIdx ^ 1];
    gl.bindFramebuffer(gl.FRAMEBUFFER, nxt.fbo); gl.viewport(0,0,B,B);
    gl.useProgram(this.bufProg);
    gl.uniform3f(this.uBuf.iResolution, B, B, 1);
    gl.uniform1f(this.uBuf.iTime, time);
    gl.uniform1i(this.uBuf.iFrame, this.frame);
    setP(this.uBuf);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cur.tex); gl.uniform1i(this.uBuf.iChannel0, 0);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.noiseTex); gl.uniform1i(this.uBuf.iChannel3, 3);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.bufIdx ^= 1;

    // ---- Pass 2: Image (キャッシュを triquadratic でレイマーチ。縮小解像度) ----
    const bufNow = this.bufFBO[this.bufIdx];
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._imgFBO.fbo); gl.viewport(0,0,iw,ih);
    gl.useProgram(this.imgProg);
    gl.uniform3f(this.uImg.iResolution, iw, ih, 1);
    gl.uniform1f(this.uImg.iTime, time);
    gl.uniform1i(this.uImg.iFrame, this.frame);
    setP(this.uImg);
    gl.uniform4f(this.uImg.iMouse, 0, 0, 0, 0);
    if(this.uImg.iChannelResolution) gl.uniform3fv(this.uImg.iChannelResolution, new Float32Array([B, B, 1, 0,0,0, 0,0,0, 0,0,0]));
    if(this.uImg.uSlotB) gl.uniform1f(this.uImg.uSlotB, slot === 'B' ? 1.0 : 0.0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bufNow.tex); gl.uniform1i(this.uImg.iChannel0, 0);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.noiseTex); gl.uniform1i(this.uImg.iChannel3, 3);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- 縮小結果をスロット FBO へ線形アップスケール ----
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._imgFBO.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
    gl.blitFramebuffer(0,0,iw,ih, 0,0,w,h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.frame++;
  }
};
Caverns.PDefaults = JSON.parse(JSON.stringify(Caverns.P));   // 既定値はスクリプト読込時に確定 (state 復元より先)
