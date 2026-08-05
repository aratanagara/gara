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

float sp_tubes(vec3 pos){
  float cylinderRadius = .02;
  vec3 p = pos;
  p.xz *= sp_rot(p.y*.5);
  sp_amod(p.xz, 8.);
  p.x -= 2.;
  float tube = sp_cyl(p.xz, cylinderRadius);
  p = pos;
  p.xz *= sp_rot(-p.y*.5);
  sp_amod(p.xz, 16.);
  p.x -= 2.;
  tube = sp_smin(tube, sp_cyl(p.xz, cylinderRadius), .15);
  return tube;
}
float sp_disks(vec3 pos){
  float radius = 1.5;
  float radiusInner = .57;
  float thin = .01;
  float repeatY = 2.;
  float cellY = floor(pos.y/repeatY);
  float a = atan(pos.z,pos.x)-time*.3+cellY*.1;
  vec3 p = pos;
  p.y += sin(a*6.)*.1;
  p.y = sp_repeat(p.y, repeatY);
  float disk = max(-sp_cyl(p.xz, radiusInner), sp_cyl(p.xz, radius));
  disk = max(abs(p.y)-thin, disk);
  return disk;
}
vec3 sp_anim1(vec3 p){ float t=time*.5; p.xz*=sp_rot(t); p.xy*=sp_rot(t*.7); p.yz*=sp_rot(t*.5); return p; }
vec3 sp_anim2(vec3 p){ float t=-time*.4; p.xz*=sp_rot(t*.9); p.xy*=sp_rot(t*.6); p.yz*=sp_rot(t*.3); return p; }

float sp_map(vec3 pos){
  float scene = 1000.;
  float bump = sp_noise(pos.xz*0.6);          // テクスチャ→手続きノイズ
  float ground = 2. - bump*.1;
  scene = min(scene, pos.y+ground);
  scene = min(scene, -(pos.y-ground));

  vec3 p = pos;
  p.y += sin(atan(p.z,p.x)*10.)*3.;
  p.xz *= sp_rot(p.y*.2-time);
  p = sp_anim1(p);
  p.x = length(p.xyz)-3.;
  scene = sp_smin(scene, sp_tubes(p), .5);
  scene = sp_smin(scene, sp_disks(p), .5);

  p = pos;
  p.y += sin(atan(p.z,p.x)*3.)*2.;
  p = sp_anim2(p);
  p.xz *= sp_rot(p.y+time);
  p.x = length(p.xyz)-3.;
  scene = sp_smin(scene, sp_tubes(p), .3);
  scene = sp_smin(scene, sp_disks(p), .3);

  return scene;
}

vec3 bg_spell(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = (I - 0.5*resolution) / resolution.y;

  vec3 eye = vec3(0., 0., -7.0);
  vec3 ray = normalize(vec3(uv, .7));
  // マウスの代わりに自動回転
  float a = time*0.12;
  eye.xz *= sp_rot(a);
  ray.xz *= sp_rot(a);

  vec3 pos = eye;
  float shade = 0.;
  for(float i=0.; i<=1.; i += SP_STEPS){
    float dist = sp_map(pos);
    if(dist < SP_VOLUME_BIAS) shade += SP_STEPS;
    if(shade >= 1.) break;
    dist *= SP_STEP_DAMPING + .1*sp_rng(uv+fract(time));
    dist = max(SP_MIN_DIST, dist);
    pos += dist * ray;
  }
  return vec3(shade);
}
