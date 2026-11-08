// =====================================================
// bg_spell
//   Source : Shadertoy "Spell Demon Souls" https://www.shadertoy.com/view/XljcD1
//   回転する魔法陣状ジオメトリ(tube+disk)のボリューム風レイマーチ。白×黒。
//   改変: 地面バンプのテクスチャを手続きノイズに置換 / マウス→自動回転。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは sp_ で名前空間化。
// =====================================================
#define SP_STEPS 1./50.
#define SP_VOLUME_BIAS 0.01
#define SP_MIN_DIST 0.005
#define SP_STEP_DAMPING .9
#define SP_PI 3.14159
#define SP_TAU (SP_PI*2.)

float sp_rng(vec2 seed){ return fract(sin(dot(seed*.1684, vec2(54.649,321.547)))*450315.); }
mat2 sp_rot(float a){ float c=cos(a),s=sin(a); return mat2(c,-s,s,c); }
float sp_cyl(vec2 p, float r){ return length(p)-r; }

float sp_hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float sp_noise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  float a=sp_hash(i), b=sp_hash(i+vec2(1,0)), c=sp_hash(i+vec2(0,1)), d=sp_hash(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}

float sp_amod(inout vec2 p, float count){
  float an = SP_TAU/count;
  float a = atan(p.y,p.x)+an/2.;
  float c = floor(a/an);
  a = mod(a,an)-an/2.;
  p.xy = vec2(cos(a),sin(a))*length(p);
  return c;
}
float sp_repeat(float v, float c){ return mod(v,c)-c/2.; }
float sp_smin(float a, float b, float r){
  float h = clamp(.5+.5*(b-a)/r, 0., 1.);
  return mix(b,a,h)-r*h*(1.-h);
}

// @param uThick   25..400 = 100.0
// @param uDisk    25..400 = 100.0
// @param uSpacing 50..200 = 100.0
// @param uSpokes  3..16   = 8.0
// @param uHole    0..150  = 100.0
// @param uAngle -180..180 = 0.0
// @param uScale 50..150 = 100.0
// @param uSteps 30..50 = 50.0
uniform float uThick;     // チューブの太さ (%)
uniform float uDisk;      // 円盤の厚み (%)
uniform float uSpacing;   // 円盤の縦の間隔 (%)
uniform float uSpokes;    // チューブの本数 (内側。外側はその 2 倍)
uniform float uHole;      // 円盤の中央の穴の大きさ (%)
uniform float uAngle; // 全体の向き (度。固定角でずらす)
uniform float uScale; // 魔法陣 (チューブと円盤) 全体の大きさ (%。床・天井は動かない)
uniform float uSteps; // ボリュームレイマーチのステップ数 (下げると軽く、全体が暗くなる)
// @param uTubeTwist 0..250 = 100
// @param uTubeRing 60..140 = 100
// @param uDiskRadius 50..150 = 100
// @param uWobble 0..300 = 100
// @param uWaves 1..12 = 6
// @param uLobes 3..16 = 10
// @param uLobeAmp 0..200 = 100
// @param uCoil 0..300 = 100
// @param uRoomHeight 60..150 = 100
uniform float uTubeTwist; // チューブのねじれ (%)
uniform float uTubeRing;  // チューブの輪の半径 (%)
uniform float uDiskRadius; // 円盤の外半径 (%)
uniform float uWobble;    // 円盤のうねりの深さ (%)
uniform float uWaves;     // 円盤のうねりの山の数
uniform float uLobes;     // 外側の波打ちの山の数
uniform float uLobeAmp;   // 外側の波打ちの振れ幅 (%)
uniform float uCoil;      // 全体の巻きつき (%)
uniform float uRoomHeight; // 床と天井の間隔 (%)
// @param uCamHeight -80..80 = 0
// @param uCamPitch -30..30 = 0
// @param uCamRoll -180..180 = 0
// @param uCamDistance 60..140 = 100
// @param uCamFov 50..200 = 100
// @param uShellRadius 70..130 = 100
// @param uInnerShellRadius 70..130 = 100
// @param uInnerLobeAmp 0..200 = 100
// @param uInnerLobes 1..9 = 3
// @param uFloorBump 0..300 = 100
// @param uShellThick 20..300 = 100
// @param uVolumeGrain 0..300 = 100
// @param uDepthFade -50..100 = 0
// @param uLightColor color = #ffffff
// @param uVoidColor color = #000000
uniform float uCamHeight; // カメラの高さ (%)。部屋の中で上下
uniform float uCamPitch; // カメラの俯仰 (度)
uniform float uCamRoll; // 画面の回転 (度)
uniform float uCamDistance; // カメラと魔法陣の距離 (%)
uniform float uCamFov; // 画角 (%)。大きいほど望遠
uniform float uShellRadius; // 手前の魔法陣の球の半径 (%)
uniform float uInnerShellRadius; // 奥の魔法陣の球の半径 (%)
uniform float uInnerLobeAmp; // 奥の魔法陣の波打ちの振れ幅 (%)
uniform float uInnerLobes; // 奥の魔法陣の波打ちの山の数
uniform float uFloorBump; // 床と天井の凹凸 (%)
uniform float uShellThick; // 光の殻の厚み (%)。大きいほど輪郭が太く光る
uniform float uVolumeGrain; // ボリュームのざらつき (%)
uniform float uDepthFade; // 奥ほど弱める量 (%)。負で奥を強める
uniform vec3 uLightColor; // 光のティント
uniform vec3 uVoidColor; // 闇の色 (暗い部分に足す)

float sp_tubes(vec3 pos){
  float cylinderRadius = .02 * (uThick / 100.0);
  vec3 p = pos;
  p.xz *= sp_rot(p.y*(.5 * (uTubeTwist / 100.0)));
  sp_amod(p.xz, floor(uSpokes + 0.5));
  p.x -= 2. * (uTubeRing / 100.0);
  float tube = sp_cyl(p.xz, cylinderRadius);
  p = pos;
  p.xz *= sp_rot(-p.y*(.5 * (uTubeTwist / 100.0)));
  sp_amod(p.xz, floor(uSpokes + 0.5) * 2.0);
  p.x -= 2. * (uTubeRing / 100.0);
  tube = sp_smin(tube, sp_cyl(p.xz, cylinderRadius), .15);
  return tube;
}
float sp_disks(vec3 pos){
  float radius = 1.5 * (uDiskRadius / 100.0);
  float radiusInner = .57 * (uHole / 100.0);
  float thin = .01 * (uDisk / 100.0);
  float repeatY = 2. * (uSpacing / 100.0);
  float cellY = floor(pos.y/repeatY);
  float a = atan(pos.z,pos.x)-time*.3+cellY*.1;
  vec3 p = pos;
  p.y += sin(a*float(int(uWaves + 0.5)))*(.1 * (uWobble / 100.0));
  p.y = sp_repeat(p.y, repeatY);
  float disk = max(-sp_cyl(p.xz, radiusInner), sp_cyl(p.xz, radius));
  disk = max(abs(p.y)-thin, disk);
  return disk;
}
vec3 sp_anim1(vec3 p){ float t=time*.5; p.xz*=sp_rot(t); p.xy*=sp_rot(t*.7); p.yz*=sp_rot(t*.5); return p; }
vec3 sp_anim2(vec3 p){ float t=-time*.4; p.xz*=sp_rot(t*.9); p.xy*=sp_rot(t*.6); p.yz*=sp_rot(t*.3); return p; }

float sp_map(vec3 pos){
  float scene = 1000.;
  float sSc = uScale / 100.0;
  float bump = sp_noise(pos.xz*0.6);          // テクスチャ→手続きノイズ
  float ground = 2. * (uRoomHeight / 100.0) - bump*.1*(uFloorBump / 100.0);
  scene = min(scene, pos.y+ground);
  scene = min(scene, -(pos.y-ground));

  vec3 p = pos / sSc;
  p.y += sin(atan(p.z,p.x)*float(int(uLobes + 0.5)))*(3. * (uLobeAmp / 100.0));
  p.xz *= sp_rot(p.y*(.2 * (uCoil / 100.0))-time);
  p = sp_anim1(p);
  p.x = length(p.xyz)-3. * (uShellRadius / 100.0);
  scene = sp_smin(scene, sp_tubes(p) * sSc, .5);
  scene = sp_smin(scene, sp_disks(p) * sSc, .5);

  p = pos / sSc;
  p.y += sin(atan(p.z,p.x)*float(int(uInnerLobes + 0.5)))*(2. * (uInnerLobeAmp / 100.0));
  p = sp_anim2(p);
  p.xz *= sp_rot(p.y+time);
  p.x = length(p.xyz)-3. * (uInnerShellRadius / 100.0);
  scene = sp_smin(scene, sp_tubes(p) * sSc, .3);
  scene = sp_smin(scene, sp_disks(p) * sSc, .3);

  return scene;
}

vec3 bg_spell(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = (I - 0.5*resolution) / resolution.y;

  vec3 eye = vec3(0., 0., -7.0 * (uCamDistance / 100.0));
  vec3 ray = normalize(vec3(uv, .7 * (uCamFov / 100.0)));
  if(uCamPitch != 0.0) ray.yz *= sp_rot(radians(uCamPitch));
  if(uCamRoll != 0.0) ray.xy *= sp_rot(radians(uCamRoll));
  // マウスの代わりに自動回転
  float a = time*0.12 + radians(uAngle);
  eye.xz *= sp_rot(a);
  ray.xz *= sp_rot(a);
  if(uCamHeight != 0.0) eye.y = uCamHeight * 0.01;

  vec3 pos = eye;
  float shade = 0.;
  for(float i=0.; i<=1.; i += SP_STEPS){
    if(i > uSteps / 50.) break;
    float dist = sp_map(pos);
    if(dist < SP_VOLUME_BIAS * (uShellThick / 100.0)) shade += SP_STEPS * (1.0 - (uDepthFade / 100.0) * i);
    if(shade >= 1.) break;
    dist *= SP_STEP_DAMPING + .1*(uVolumeGrain / 100.0)*sp_rng(uv+fract(time));
    dist = max(SP_MIN_DIST, dist);
    pos += dist * ray;
  }
  return vec3(shade) * uLightColor + uVoidColor * (1.0 - shade);
}
