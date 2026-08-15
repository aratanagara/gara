// Built-in shader presets (Shadertoy-compatible mainImage form).
// Each preset can declare channels via // @channel0 image|video|webcam|audio|feedback|slotB
// And params via // @param name min..max = default  (or color / bool)
const PRESETS = [
{
  name: "Webcam Mirror",
  ch: ["webcam","","",""],
  src: `// @param mirror 0..1 = 1
// @param posterize 1..16 = 16
// @param edge 0..2 = 0
uniform float mirror; uniform float posterize; uniform float edge;

void mainImage(out vec4 o, in vec2 f){
  vec2 uv = f/iResolution.xy;
  if(mirror>0.5) uv.x = 1.-uv.x;
  vec4 c = texture(iChannel0, uv);
  if(edge>0.001){
    vec2 e = 1./iResolution.xy * edge;
    vec4 a = texture(iChannel0, uv+vec2(e.x,0));
    vec4 b = texture(iChannel0, uv-vec2(e.x,0));
    vec4 u = texture(iChannel0, uv+vec2(0,e.y));
    vec4 d = texture(iChannel0, uv-vec2(0,e.y));
    c.rgb = abs(a.rgb-b.rgb) + abs(u.rgb-d.rgb);
  }
  c.rgb = floor(c.rgb*posterize)/posterize;
  o = c;
}`
}

,
{
  name: "Alien Megacity (tlBcDh)",
  ch: ["","","",""],
  src: `// Shadertoy tlBcDh "Alien megacity" 原作そのまま(単一パス移植)。based on https://www.shadertoy.com/view/4tcGDr
// @param speed 0..3 = 1
uniform float speed;
#define rot(spin) mat2(cos(spin),sin(spin),-sin(spin),cos(spin))
#define multiplier 9.0
#define iterations 2
const int MAX_MARCHING_STEPS = 300;
const float MIN_DIST = 0.0, MAX_DIST = 1000.0, EPSILON = 0.001, size = 1000.0;
const float scale = EPSILON*10.0;
float vines(vec3 p, float size1){ return size - length((sin(p/vec3(length((p/20.0)))))*size1)/1.8; }
float sceneSDF(vec3 p){
  p /= scale*60.0;
  float size1 = 1100.0, result = vines(p, size1), i = multiplier;
  for(int j = 0; j < iterations; j++){
    p = sin(p/i)*i - sin(p*i)/i;
    result = min(result, vines(p, size1)/(i));
    i *= multiplier;
  }
  return result*scale;
}
vec3 surface_color(vec3 p){ return sin(vec3(vines(p,6.0), vines(p,4.0), vines(p,3.0)))/5.0 + vec3(.5); }
float shortestDistanceToSurface(vec3 eye, vec3 dir, float start, float end){
  float depth = start, eps = EPSILON;
  for(int i = 0; i < MAX_MARCHING_STEPS; i++){
    float dist = sceneSDF(eye + depth*dir);
    if(dist < eps*(1.0 + depth*.1)) return depth;
    depth += dist; eps *= 1.001;
    if(depth >= end) return end;
  }
  return end;
}
vec3 rayDirection(float fov, vec2 sz, vec2 fc){ vec2 xy = fc - sz/2.0; float z = sz.y/tan(radians(fov)/2.0); return normalize(vec3(xy, -z)); }
vec3 estimateNormal(vec3 p){
  return normalize(vec3(
    sceneSDF(vec3(p.x+EPSILON,p.y,p.z)) - sceneSDF(vec3(p.x-EPSILON,p.y,p.z)),
    sceneSDF(vec3(p.x,p.y+EPSILON,p.z)) - sceneSDF(vec3(p.x,p.y-EPSILON,p.z)),
    sceneSDF(vec3(p.x,p.y,p.z+EPSILON)) - sceneSDF(vec3(p.x,p.y,p.z-EPSILON))));
}
vec3 phongContribForLight(vec3 k_d, vec3 k_s, float alpha, vec3 p, vec3 eye, vec3 lightPos, vec3 lightIntensity){
  lightPos = eye;
  vec3 N = estimateNormal(p), L = normalize(lightPos-p), V = normalize(eye-p), Rr = normalize(reflect(-L,N));
  float dotLN = dot(L,N), dotRV = dot(Rr,V);
  if(dotLN < 0.0) return vec3(0.0);
  if(dotRV < 0.0) return lightIntensity * (k_d*dotLN);
  return lightIntensity * (k_d*dotLN + k_s*pow(dotRV, alpha));
}
vec3 phongIllumination(vec3 k_a, vec3 k_d, vec3 k_s, float alpha, vec3 p, vec3 eye){
  const vec3 ambientLight = 0.5*vec3(1.0);
  vec3 color = ambientLight*k_a;
  color += phongContribForLight(k_d, k_s, alpha, p, eye, eye, vec3(0.8));
  return color;
}
mat3 viewMatrix(vec3 eye, vec3 center, vec3 up){ vec3 f = normalize(center-eye), s = normalize(cross(f,up)), u = cross(s,f); return mat3(s,u,-f); }
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  float T = iTime * speed;
  vec3 viewDir = rayDirection(45.0, iResolution.xy, fragCoord);
  vec3 eye = vec3(-35.0 + sin(T/2.0)/2.0, 1.0 + cos(T/2.0)/2.0, T);
  mat3 viewToWorld = viewMatrix(eye, vec3(0.0), vec3(0.0,1.0,0.0));
  vec3 worldDir = -viewToWorld * viewDir;
  float dist = shortestDistanceToSurface(eye, worldDir, MIN_DIST, MAX_DIST);
  if(dist > MAX_DIST - EPSILON){ fragColor = vec4(0.0); return; }
  vec3 p = eye + dist*worldDir;
  vec3 K_a = surface_color(p), K_d = K_a, K_s = vec3(1.0);
  vec3 color = phongIllumination(K_a, K_d, K_s, 7.0, p, eye);
  fragColor = vec4(color, 1.0);
}`
}
,
{
  name: "Flight Over Dunes (3syGWc)",
  ch: ["","","",""],
  src: `// Shadertoy 3syGWc "Flight Over Dunes" 改 — 太陽/レンズフレアを除去 + ロール360°で天地が反転する砂丘フライト。
// @param rollSpeed -2..2 = 0.6
// @param speed 0..3 = 1
uniform float rollSpeed; uniform float speed;
#define RAY_MAX_STEPS 96
#define RAY_MAX_DISTANCE 200.0
#define OBJECT_MIN_SURFACE_DISTANCE 0.01
#define RAY_MAX_STEPS_SHADOW 40
#define OBJECT_MIN_SURFACE_DISTANCE_SHADOW 0.04
#define OBJECT_MIN_SURFACE_DISTANCE_SHADOW_OFFSET (OBJECT_MIN_SURFACE_DISTANCE_SHADOW*1.1)
#define PI 3.1415926535897932384626433832795
#define DEBUG_RAY_DITHER
#define DEBUG_GRAIN_VIGNETTE
#define DEBUG_SAND_RIPPLES
#define DEBUG_SAND_SHADING
#define DEBUG_SAND_3POINT_NORMAL
#define DEBUG_CAMERA_FLY
#define DEBUG_SPECULAR
#define DEBUG_FOG_RENDER
#define DEBUG_DUST_RENDER
#define DEBUG_SAND_RENDER
#define DEBUG_CLOUD_RENDER
#define DEBUG_MOUNTAIN_RENDER
#define MAT_SKY 0
#define MAT_GROUND 1
#define LIGHT_SUN 0
#define LIGHT_SKY 1
#define SAND_COLOUR vec3(0.98,0.82,0.68)
struct camera { vec3 origin, forward, right, up; mat3 rotationMatrix; float roll, pitch, yaw; float zoom; };
struct ray { vec3 origin, direction; };
struct rayMarchHit { vec3 origin, surfaceNormal; float distance, dust; int materialId; int iteration; };
struct sphere { vec3 origin; float radius; };
vec3 sunDir = normalize(vec3(5.0, 4.0, 5.0));
mat3 rotateX(float pitch){ float c=cos(pitch),s=sin(pitch); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }
mat3 rotateY(float yaw){ float c=cos(yaw),s=sin(yaw); return mat3(c,0.,s, 0.,1.,0., -s,0.,c); }
mat3 rotateZ(float roll){ float c=cos(roll),s=sin(roll); return mat3(c,-s,0., s,c,0., 0.,0.,1.); }
mat3 eulerToMatrix(float roll, float pitch, float yaw){ return rotateZ(roll)*rotateX(pitch)*rotateY(yaw); }
ray getRay(vec2 uv, camera cam){ ray r; r.origin=cam.origin; vec3 center=r.origin+cam.forward*cam.zoom; vec3 isect=center+uv.x*cam.right+uv.y*cam.up; r.direction=normalize(isect-r.origin); return r; }
#define HE 702.566665305
#define HF 149.311292882
#define HG 446.230257362
#define HH 833.597411735
float hash11(float st){ return fract(sin(st)*HE); }
float hash21(vec2 st){ return fract(sin(dot(sin(st.xy),vec2(HE,HF)))*HG); }
float hash31(vec3 st){ return fract(sin(dot(sin(st),vec3(HE,HF,HG)))*HH); }
vec2 quinticInterpolation(vec2 x){ return x*x*x*(x*(x*6.-15.)+10.); }
float quinticInterpolation(float x){ return x*x*x*(x*(x*6.-15.)+10.); }
float valueNoise2du(vec2 sp){ vec2 pI=floor(sp),pF=fract(sp); float bl=hash21(pI),br=hash21(pI+vec2(1,0)),fl=hash21(pI+vec2(0,1)),fr=hash21(pI+vec2(1,1)); vec2 u=quinticInterpolation(pF); return mix(mix(bl,br,u.x),mix(fl,fr,u.x),u.y); }
float valueNoise1du(float sp){ float pI=floor(sp),pF=fract(sp); return mix(hash11(pI),hash11(pI+1.0),pF); }
float valueNoise1duw(float sp, float wrap){ float pI=floor(sp),pF=fract(sp); return mix(hash11(mod(pI,wrap)),hash11(mod(pI+1.0,wrap)),pF); }
float getCloudNoise(vec2 o, float time){ o.x-=time*0.1; o.y-=time*0.5; float r=valueNoise2du(o*0.3); r+=valueNoise2du(o*1.3)*0.66; r+=valueNoise2du(o*2.3)*0.33; r*=valueNoise2du(o*0.2); r*=0.5; return clamp(r,0.0,1.0); }
float getClouds(vec3 d, float time){ if(d.y<=0.04) return 0.0; vec2 s=d.xz; s*=1000.0/d.y; s*=0.001; return getCloudNoise(s,time)*(clamp(0.0,0.1,(d.y-0.04))*10.0); }
float getTerrainHeight(vec2 point){ int oct=3; float lac=2.0,gain=0.5,amp=1.5,freq=0.2,h=0.0; for(int i=0;i<oct;i++){ h+=amp*(sin(freq*point.x*0.5)*cos(freq*point.y+point.x)*0.5+0.5); freq*=lac; amp*=gain; } return h; }
vec3 getTerrainNormal(vec2 point, float hc){ float hl=getTerrainHeight(point+vec2(-0.01,0.0)); float hf=getTerrainHeight(point+vec2(0.0,-0.01)); return normalize(vec3(hl-hc,0.01,hf-hc)); }
void getTerrainHit(vec3 cp, inout rayMarchHit hit, float minSD){ float hC=getTerrainHeight(cp.xz); float nd=(cp.y-hC); if(nd<hit.distance){ hit.distance=nd; hit.origin=cp; hit.surfaceNormal=getTerrainNormal(cp.xz,hC); hit.materialId=MAT_GROUND; } }
rayMarchHit GetRayMarchHit(vec3 cp, float minSD, float time){ rayMarchHit hit; hit.distance=RAY_MAX_DISTANCE; getTerrainHit(cp,hit,minSD); return hit; }
float map(float value, float min1, float max1, float min2, float max2){ return (value-min1)/(max1-min1)*(max2-min2)+min2; }
rayMarchHit RayMarch(ray r, float maxDistance, float minSD, int maxSteps, float time){
  float cd=0.0; rayMarchHit hit; float accDust=0.0, lastD=0.0; float maxDustD=maxDistance/2.0, dustMaxH=4.0;
  for(int i=0;i<maxSteps;i++){
    vec3 cp = r.origin + r.direction*cd;
    hit = GetRayMarchHit(cp, minSD, time);
    float tH=getTerrainHeight(cp.xz), dH=tH+dustMaxH;
    if(cd<=maxDustD && cp.y<dustMaxH){ float remY=map(cp.y,tH,dH,0.0,2.0*PI); float dust=lastD*(getCloudNoise(cp.xz*3.0,time*(20.0-(remY*0.002)))); dust*=sin(remY)*0.5+0.5; dust*=1.0-cd/maxDustD; accDust+=dust; }
    if(hit.distance>1.0){ if(cp.y+(r.direction.y*hit.distance)<=dH){ hit.distance=min(hit.distance,max((hit.distance*(cd/maxDustD)),1.0)); } }
    hit.iteration=i;
    if(hit.distance>0.0){ hit.distance*=mix(0.9,1.0,hash31(fract(cp+time))); }
    lastD=hit.distance; cd+=hit.distance;
    if(cd>=maxDistance || (cp.y>5.0 && r.direction.y>0.0) || (cp.y<0.0 && r.direction.y<0.0)){ hit.surfaceNormal=r.direction; hit.materialId=MAT_SKY; break; }
    else if(hit.distance>=0.0 && hit.distance<=minSD){ break; }
  }
  hit.distance=cd;
  hit.dust=clamp(0.2*accDust*((cos(time*0.5)+cos(time*0.3))*0.25+0.5),0.0,1.0);
  return hit;
}
float getShadow(vec3 origin, vec3 dest, float soft, float time){ float cd=OBJECT_MIN_SURFACE_DISTANCE_SHADOW; float maxD=distance(dest,origin); vec3 dir=normalize(dest-origin); rayMarchHit h; float light=1.0; for(int i=0;i<RAY_MAX_STEPS_SHADOW;i++){ vec3 cp=origin+dir*cd; h=GetRayMarchHit(cp,99999.0,time); light=min(light,soft*h.distance/cd); cd+=h.distance; if(cd>maxD) break; else if(h.distance<OBJECT_MIN_SURFACE_DISTANCE_SHADOW){ light=0.0; break; } } return light; }
void getLight(vec3 point, vec3 normal, vec3 rd, out vec3 diffuseLight, out vec3 specularLight, float time){
  diffuseLight=vec3(0.0); specularLight=vec3(0.0);
  vec3 direction, colour; float brightness, shadow; vec3 specDir; float dp;
  float dust=(getCloudNoise(point.xz*3.0,time*20.0))*0.25;
  dust=1.0-clamp(1.2*dust*((cos(time*0.5)+cos(time*0.3))*0.25+0.5),0.0,1.0);
  colour=vec3(0.8,0.6,0.4); direction=sunDir; brightness=clamp(dot(direction,normal),0.0,1.0);
  shadow=getShadow(point+normal*OBJECT_MIN_SURFACE_DISTANCE_SHADOW_OFFSET, point+direction*RAY_MAX_DISTANCE*0.5, 10.0, time);
  float cloudCover=(1.0-getCloudNoise(point.xz*0.2,time)); brightness*=cloudCover; brightness*=dust; brightness*=shadow;
  float spec=hash21(floor(point.xz*100.0)/100.0);
  if(spec>0.98){ spec=(spec-0.98)*50.0; specDir=reflect(direction,normal); dp=dot(specDir,rd); specularLight+=colour*5.0*spec*pow(max(dp,0.0),5.0)*shadow; }
  diffuseLight+=colour*5.0*brightness;
  colour=vec3(0.4,0.85,1.0); direction=normalize(vec3(0.0,1.0,0.0)); brightness=clamp(dot(direction,normal),0.0,1.0); brightness*=dust;
  spec=hash21(floor(point.xz*150.0)/150.0);
  if(spec>0.99){ spec=(spec-0.99)*100.0; specDir=normalize(reflect(direction,normal)); dp=dot(specDir,rd); specularLight+=colour*2.0*pow(max(dp,0.0),5.0); }
  diffuseLight+=colour*2.0*brightness;
}
vec3 getCameraPath(float time){ vec3 r; r.y=(sin(time/2.0)*0.5+0.5)+(sin(time/6.0)+1.0)+(sin(time/15.0)+1.0)+3.0; r.x=(sin(time/10.0)*40.0)+sin(time/6.0)*5.0+sin(time/2.0)*3.0; r.z=(cos(time/10.0)*40.0)+sin(time/5.0)*9.0+sin(time/3.0)*2.0; return r; }
camera getCamera(vec3 origin, float roll, float pitch, float yaw, float zoom){ camera c; c.origin=origin; mat3 rm=eulerToMatrix(roll,pitch,yaw); c.forward=vec3(0.,0.,1.)*rm; c.right=vec3(1.,0.,0.)*rm; c.up=vec3(0.,1.,0.)*rm; c.rotationMatrix=rm; c.roll=roll; c.pitch=pitch; c.yaw=yaw; c.zoom=zoom; return c; }
camera getCamera(vec3 origin, vec3 forward, float roll, float zoom){ float yaw=atan(forward.x,forward.z); float pitch=asin(forward.y); return getCamera(origin,roll,pitch,yaw,zoom); }
camera getCameraFly(float time){
  vec3 c1=getCameraPath(time), c2=getCameraPath(time+0.5), c3=getCameraPath(time-0.5);
  vec3 fwd=normalize(c2-c1);
  float roll = time * rollSpeed;   // 連続ロールで 360° 天地反転
  return getCamera(c1, fwd, roll, 0.5);
}
void mainImage(out vec4 fragColour, in vec2 fragCoord){
  float time = iTime * speed;
  vec2 uv = (fragCoord-0.5*iResolution.xy)/iResolution.y;
  camera cam = getCameraFly(time);
  ray r = getRay(uv, cam);
  rayMarchHit hit = RayMarch(r, RAY_MAX_DISTANCE, OBJECT_MIN_SURFACE_DISTANCE, RAY_MAX_STEPS, time);
  vec3 colour;
  float distanceFromSun = 1.0-(dot(sunDir,r.direction)*0.5+0.5);
  vec3 skyColour;
  if(r.direction.y < 0.0){ skyColour = mix(SAND_COLOUR*0.75, SAND_COLOUR*0.5, distanceFromSun); }
  else { skyColour = mix(vec3(0.4,0.85,1.0), vec3(0.1,0.2,0.25), distanceFromSun) - max(r.direction.y,0.0)*0.3; }
  skyColour *= 5.0;
  if(r.direction.y > 0.0 && r.direction.y < 0.1875){
    float rayYaw = atan(r.direction.x, r.direction.z)/PI*0.5+0.5;
    float mountainDepth = 0.0; vec3 mountainColour = vec3(1.0);
    for(float i=0.0;i<6.0;i++){
      float mh = valueNoise1duw(i*1234.543 + rayYaw*30.0, 30.0)*2.0;
      mh += valueNoise1duw(i*7832.856 + rayYaw*60.0, 60.0)*1.0;
      mh += valueNoise1duw(i*5892.473 + rayYaw*120.0, 120.0)*0.5;
      mh += valueNoise1duw(i*2857.673 + rayYaw*180.0, 180.0)*0.25;
      mh *= 0.07-i*0.01;
      if(r.direction.y < mh){ mountainDepth=(i+1.0)/7.0; float maxH=(2.0+1.0+0.5+0.25)*(0.07-i*0.01); float ratio=mh/maxH; mountainDepth*=1.0-pow(1.0-ratio,3.6); mountainColour=mix(vec3(1.0),SAND_COLOUR*2.0,(i+1.0)/5.0); }
    }
    skyColour = mix(skyColour, mountainColour, mountainDepth);
  }
  skyColour = mix(skyColour, mix(SAND_COLOUR*1.5, SAND_COLOUR, distanceFromSun)*3.0, pow(1.0-abs(r.direction.y),20.0));
  if(hit.materialId == MAT_SKY){
    float clouds = getClouds(r.direction, time);
    // 太陽ディスクは描かない(除去)。雲のみ。
    skyColour = mix(skyColour, vec3(3.0), clouds);
    colour = skyColour;
  } else if(hit.materialId == MAT_GROUND){
    vec3 sandColour = SAND_COLOUR;
    float offset = ((sin(35.0*hit.origin.x)*sin(2.0*hit.origin.y+5.0*hit.origin.x)*2.0-1.0)*0.4)*(smoothstep(0.3,2.0,1.7-hit.origin.y));
    hit.surfaceNormal.xy = normalize(hit.surfaceNormal.xy - offset);
    sandColour = mix(sandColour, vec3(1.0), smoothstep(0.0,1.0,dot(vec3(-1.0,0.0,0.0),hit.surfaceNormal)));
    sandColour = mix(sandColour, vec3(0.8,0.6,0.6), smoothstep(0.0,2.0,(sin((hit.origin.x+hit.origin.z)*0.2)*cos((hit.origin.z+hit.origin.y)*0.2)*cos(hit.origin.y*0.1)*0.5+0.5)));
    sandColour = mix(sandColour, vec3(0.6,0.4,0.3), smoothstep(0.0,1.0,1.5-hit.origin.y));
    colour = sandColour;
  } else { colour = vec3(1.0,0.0,1.0); }
  if(hit.materialId != MAT_SKY){
    vec3 diffuseLight, specularLight;
    getLight(hit.origin, hit.surfaceNormal, r.direction, diffuseLight, specularLight, time);
    colour = colour*diffuseLight + specularLight;
    colour = mix(colour, SAND_COLOUR*2.0, hit.dust);
    colour = mix(colour, skyColour, pow((hit.distance/RAY_MAX_DISTANCE),3.0));
  }
  float exposure = 0.35;   // 太陽依存の動的露出は除去
  colour = pow(exposure*colour, vec3(1.0/2.2));
  colour = clamp(colour,0.0,1.0);
  vec2 vg = fragCoord.xy/iResolution.xy; vg *= 1.0-vg;
  float vignette = clamp(pow(vg.x*vg.y*5.0,0.5)+0.4,0.0,1.0);
  colour = vec3(1.0)-((vec3(1.0)-colour)/vignette);
  colour = clamp(colour,0.0,1.0);
  colour = 1.7*colour/(1.0+colour);
  colour = colour*colour*(3.0-2.0*colour);
  fragColour = vec4(colour,1.0);
}`
}
,
{
  name: "Krypto Planes (MdVBRy)",
  ch: ["","","",""],
  src: `// Shadertoy MdVBRy "Krypto Planes" (Aiekick) 改 — カメラ位置・方向をランダム化(look-at で特異点なし)+ spike で尖らせ、法線バンプで針状の宝石に。
//   原作の bump は iChannel0 テクスチャ依存のため手続きバンプに置換。
// @param speed 0..3 = 1
// @param wild 0..2 = 1.0
// @param spike 0..4 = 3.0
// @param bright 0.3..3 = 1.5
uniform float speed; uniform float wild; uniform float spike; uniform float bright;
mat3 getRotXMat(float a){return mat3(1.,0.,0.,0.,cos(a),-sin(a),0.,sin(a),cos(a));}
mat3 getRotYMat(float a){return mat3(cos(a),0.,sin(a),0.,1.,0.,-sin(a),0.,cos(a));}
mat3 getRotZMat(float a){return mat3(cos(a),-sin(a),0.,sin(a),cos(a),0.,0.,0.,1.);}
mat3 m1, m2;
vec2 path(float t){ return vec2(cos(t*0.08 + cos(t*0.1)*2.), sin(t*0.12 + sin(t*0.05)*2.5)) * 4.; }
float pattern(vec3 p){ p = abs(fract(p*.3) - 0.5); return length(max(abs(p.x), abs(p.y)) - p.z); }
vec4 map(vec3 p){
  vec2 pa = path(p.z);
  p.xy -= pa;
  float a = pa.x * pa.y * 0.1;
  p.xy *= mat2(cos(a),-sin(a),sin(a),cos(a));
  float sc = 1.0 + spike*0.4;                        // spike で折り畳みを密に=細かい尖り
  float d0 = min(pattern(p*m1), pattern(p*m2));
  float d1 = min(pattern(p*3.*sc*m1), pattern(p*2.*sc*m2));
  float dist0 = dot(vec3(1)-clamp(d0,0.,1.),vec3(1));
  float dist1 = dot(vec3(1)-clamp(d1,0.,1.),vec3(d0));
  float mixF = clamp(0.35 + spike*0.25, 0.0, 0.99);
  float dist = mix(dist0, dist1, mixF);
  return vec4(1.47 - abs(cos(p.x*0.3)*p.y) - dist, vec3(step(dist,0.1)));
}
vec3 nor(vec3 pos, float k){
  vec3 eps = vec3(k,0.,0.);
  return normalize(vec3(
    map(pos+eps.xyy).x - map(pos-eps.xyy).x,
    map(pos+eps.yxy).x - map(pos-eps.yxy).x,
    map(pos+eps.yyx).x - map(pos-eps.yyx).x));
}
vec3 blackbody(float Temp){
  vec3 col = vec3(255.);
  col.x = 56100000. * pow(Temp,-1.5) + 148.;
  col.y = 100.04 * log(Temp) - 623.6;
  if(Temp > 6500.) col.y = 35200000. * pow(Temp,-1.5) + 184.;
  col.z = 194.18 * log(Temp) - 1448.6;
  col = clamp(col, 0., 255.)/255.;
  if(Temp < 1000.) col *= Temp/1000.;
  return col;
}
float SubDensityDeep(vec3 sp, float prec, float ms){
  float s = 0.;
  const int iter = 1;
  for(int i=0;i<iter;i++){ vec3 n = nor(sp,prec); sp -= n*ms; s += map(sp).x; }
  return 1. - s/(ms*float(iter));
}
float SubDensity1(vec3 p, float s){ vec3 n = nor(p,s); return map(p - n*s).x; }
// 針状バンプ: 法線を高周波で乱し、ジオメトリを変えず(=軽い)に「針で覆われた宝石」の見た目に。
vec3 needleBump(vec3 p, vec3 n){
  float f = 5.0 + spike*7.0;
  vec3 q = cos(p*f) * sin(p.yzx*f*0.7);
  return normalize(n + q * (0.05 + spike*0.06));
}
vec4 shade(vec3 ro, vec3 rd, float d, vec3 lp){
  vec3 p = ro + rd*d;
  float sb = SubDensityDeep(p, 0.01, 0.1);
  vec3 bb = blackbody(100.*sb + 100.);
  vec3 ld = normalize(lp - p);
  vec3 n = nor(p, .01);
  n = needleBump(p, n);                        // 針状バンプ
  vec3 refl = reflect(rd, n);
  float amb = 0.16;                            // 環境光UP(暗さ解消)
  float diff = clamp(dot(n, ld), 0.0, 1.0);
  float fre = pow(clamp(1. + dot(n, rd), 0.0, 1.0), 10.);        // 宝石のエッジ光
  float spe = pow(clamp(dot(refl, ld), 0.0, 1.0), 30.);         // 鋭い鏡面(宝石のきらめき)
  float sss = 1. - SubDensity1(p*0.1, 0.1) * 0.5;
  return vec4(
    (diff + fre + bb.x*sss)*amb + diff*0.6,
    (diff + fre*1.5 + bb*sb + sss*0.3)*amb + spe*1.4 + fre*0.5 - diff*sss*0.05);
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 g = fragCoord.xy, si = iResolution.xy;
  m1 = getRotXMat(-7.) * getRotYMat(-5.) * getRotZMat(-3.);
  m2 = m1*m1;
  float time = iTime*speed*5.;
  float tt = iTime*speed*0.35;
  vec2 uv = (g+g-si)/si.y;
  // カメラ位置: 前進しつつ xy をランダムに漂わせる
  vec3 ro = vec3(0,0,time); ro.xy += path(ro.z);
  ro.xy += wild*3.0*vec2(sin(tt*0.6), sin(tt*0.8 + 1.0));
  // カメラ方向: +z 前方を基準に 3D でランダムに振る(look-at 構成なので特異点なし)
  vec3 rov = normalize(vec3(wild*0.9*sin(tt*0.5), wild*0.9*sin(tt*0.7 + 2.0), 1.0));
  vec3 camUp = normalize(vec3(wild*0.5*sin(tt*0.4 + 1.0), 1.0, wild*0.3*sin(tt*0.9)));
  vec3 lp = vec3(path(ro.z + 3.), ro.z + 3.);
  vec2 fov = vec2(0.75, 0.9);
  vec3 u = normalize(cross(camUp, rov));
  vec3 v = cross(rov, u);
  vec3 rd = normalize(rov + uv.x*u*fov.x + uv.y*v*fov.y);
  float s = 1., d = 0.;
  for(int i=0;i<52;i++){ if(d*d/s > 1e5) break; d += s = map(ro + rd*d).x * .6; }
  vec4 f = shade(ro, rd, d, lp);
  f = f.zyww + f.x*0.2;
  f = mix(f, vec4(0.8), 1.0 - exp(-0.01*d*d));
  fragColor = sqrt(f*f*f*1.5*bright);
}`
}
,
{
  name: "Viscous Drip (ttVcRt/tlKcDd)",
  ch: ["","","",""],
  src: `// Shadertoy ttVcRt "Day 405"(積層する波の粘り/したたり)を、tlKcDd "Day 410" のカラーパレットで彩色して取り込み。
// @param speed 0..3 = 1
// @param colShift -6..6 = 0
// @param colSpeed 0..3 = 1
uniform float speed; uniform float colShift; uniform float colSpeed;
#define pal(a,b,c,d,e) ((a)+(b)*sin((c)*(d)+(e)))
#define slices 180.
const float disp = 0.4;
const float eps = 0.01;
const float width = 0.00035;
float fun(float p, float py){
  float T = iTime*speed;
  float f = sin(p + T + cos(py*0.05 + sin(p))*0.7)*sin(py*0.1 + T*0.2);
  f *= mix(
    smoothstep(0.,1., abs(p + sin(py)*0.1)),
    smoothstep(0.,1., abs(p + sin(py*0.3 + T)*0.1)),
    0.5 + sin(T*0.4)*0.5);
  return f*disp;
}
float graph(float y, float fn0, float fn1, float pixelSize){
  return smoothstep(pixelSize, 0., abs(fn0-y)/length(vec2((fn1-fn0)/eps,1.)) - width);
}
float graphNoAbs(float y, float fn0, float fn1, float pixelSize){
  return smoothstep(pixelSize, 0., -(fn0-y)/length(vec2((fn1-fn0)/eps,1.)) - width);
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  float T = iTime*speed, TC = iTime*colSpeed;
  vec2 uv = (fragCoord - 0.5*iResolution.xy)/iResolution.y;
  vec3 col = vec3(0);
  float pixelSize = dFdx(uv.x)*1.25;
  for(float i = 0.; i < slices; i++){
    vec2 p = uv + vec2(0., i/slices*2. - 0.8);
    float funIdx = p.x;
    float f0 = fun(funIdx, i), f1 = fun(funIdx + eps, i);
    // tlKcDd のパレットで各スライスを彩色(紫〜赤〜青)
    vec3 c = pal(0.5, vec3(0.6,0.05,0.15), vec3(4.9,1.,9.), 1., i/slices*22. + TC + colShift);
    float gFill = graphNoAbs(p.y, f0, f1, pixelSize);
    float gLine = graph(p.y, f0, f1, pixelSize);
    col = mix(col, c*c*0.7, gFill);   // 塗り(粘り)
    col = mix(col, c*2.0,  gLine);    // 縁(したたる線)
    col = max(col, 0.);
  }
  col = pow(col, vec3(0.4545));
  fragColor = vec4(col, 1.0);
}`
}
,
{
  name: "Fractal Junkyard Glitch (dsBGRh)",
  ch: ["","","",""],
  src: `// Shadertoy dsBGRh "Fractal junkyard (3D)" 改 — 形状(ジオメトリ)を過剰グリッチ。
//   折り畳み座標を 3D セルごとにステップ状変位/量子化 → フラクタルの形自体が破断・ズレる。画面(2D)グリッチは無し。
// @param speed 0..4 = 1
// @param glitch 0..2.5 = 1.3
// @param warp 0..2.5 = 1.0
// @param scatter 0..2 = 1.0
// @param density 0..1 = 1.0
uniform float speed; uniform float glitch; uniform float warp; uniform float scatter; uniform float density;
#define r iResolution
#define EPSILON .001
#define MAX_DIST 40.0
#define rot(a) mat2(cos(a),sin(a),-sin(a),cos(a))
vec3 hash33(vec3 p){ p = fract(p*vec3(.1031,.1030,.0973)); p += dot(p, p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
vec3 spaghetti(vec3 uv, float gl, float gt){
  // ★ ワープ/ゆがみ: sin ドメインワープ(時間で流動 + glitch ステップ gt でガクガク)。非厳密化でレイマーチも歪む=グリッチ感。
  float wt = iTime*speed;
  uv += warp * 0.16 * vec3(sin(uv.z*5.0 + wt*2.0 + gt),
                           sin(uv.x*6.0 - wt*1.6 + gt*1.7),
                           cos(uv.y*5.5 + wt*2.4 + gt*1.1));
  uv += warp * 0.08 * sin(uv.zxy*11.0 - wt*3.0);
  // ★ 分布の偏り: 粗いセルごとの恒常オフセットで格子を崩す + 低周波ワープで密度にムラ(時間に依らない安定した偏り)
  uv += scatter * (hash33(floor(uv*1.4) + 9.7) - 0.5) * 0.85;
  uv += scatter * 0.5 * vec3(sin(uv.y*0.9 + 2.1), sin(uv.z*0.8 - 1.3), sin(uv.x*1.1 + 0.5));
  // ★ 形状グリッチ: 折り畳み前の座標を 3D セルごとにステップ状変位 → フラクタルの形が破断・ズレる
  vec3 cell = floor(uv*1.4 + gt);                                  // セルをさらに大きく = 破片を大きく・少なく
  vec3 j = hash33(cell) - 0.5;
  float on = step(0.85, hash33(cell + 4.1).x);                     // 強く飛ばすセルをさらに減らす
  uv += j * gl * (0.22 + on*0.85);
  uv = mix(uv, floor(uv*6.0)/6.0, 0.4*clamp(gl - 0.6, 0.0, 1.0));   // ブロック量子化(gl 大で)
  vec3 col = vec3(0.);
  for(int k = 0; k < 6; k++){
    vec3 offset = vec3(uv.x+.35, uv.y+.35, uv.z-uv.x);
    uv = abs(fract(uv.yzx+offset.zxy)-.5);
    col = vec3(col.yz, uv.x-uv.y);
  }
  return col;
}
void mainImage(out vec4 o, in vec2 U){
  float t = iTime*4.*speed;
  float gt = floor(iTime*7.0);                 // 形状グリッチの時間ステップ(カクカク切り替わる)
  vec2 uv = U/r.xy;
  // ★ カメラ位置固定 + 360° 3D 回転(前進せず、視線を回す)。対称面を避けた非対称位置(中心分割を防ぐ)
  vec3 ro = vec3(1.3, 6.35, 0.7);
  vec3 dir = normalize(vec3(uv-.5, .5));
  float ya = iTime*speed*0.4, pa = iTime*speed*0.25;
  dir.xz *= rot(ya); dir.yz *= rot(pa);
  vec3 flow = vec3(0., 0., t);                  // フラクタルを流して動きを維持
  vec3 p = ro;
  float l1 = 0.; vec3 col = vec3(0.); float hit = 0.0; vec3 hp = p;
  float dens = clamp(density, 0.0, 1.0);
  for(int i=0;i<72;i++){
    col = spaghetti((p + flow)/16., glitch, gt);
    float sd1 = col.z - .14;
    if(-sd1 < EPSILON*(length(l1)+1.0)){ hit = 1.0; hp = p + flow; break; }
    if(l1 > MAX_DIST){ break; }
    p += dir*(-sd1);
    l1 = distance(p, ro);
  }
  o = (vec4(col/2., 0) + l1/100.0) * 3.0;
  // 空間充填フラクタルなので、低周波の滑らかな場でヒット点を間引く。破片の形・色を保ったまま
  // 大きな連続した透明領域(黒)を作る。合成は Slot A の rgb のみ表示するため、off/ミスは
  // rgb を黒にして背景を見せる。dens 小 → off が増え破片が減って Slot B(透過背景)が見える。
  float fld = sin(hp.x*0.9 + hp.z*0.63) + sin(hp.y*0.765 - hp.z*0.45 + 1.7) + sin((hp.x+hp.y)*0.54 + hp.z*0.36 + 3.1);
  float keep = hit * step(1.0 - dens, 0.5 + fld*0.16667);
  o.rgb *= keep;
  o.a = keep;
}`
}

,
{
  name: "Deterioration (3dBSW3)",
  ch: ["","","",""],
  src: `// Shadertoy 3dBSW3 "Deterioration" (@blokatt) — 2D fbm の流動(ほぼそのまま移植)。
// @param speed 0..3 = 1
uniform float speed;
mat2 dtRot(float a){ return mat2(cos(a),-sin(a),sin(a),cos(a)); }
float dtRand(vec2 uv){ return fract(sin(dot(vec2(12.9898,78.233), uv)) * 43758.5453123); }
float dtVN(vec2 uv){ vec2 i=fract(uv); vec2 f=floor(uv); float a=dtRand(f),b=dtRand(f+vec2(1,0)),c=dtRand(f+vec2(0,1)),d=dtRand(f+vec2(1,1)); return mix(mix(a,b,i.x),mix(c,d,i.x),i.y); }
float dtFbm(vec2 uv){ float T=iTime*speed; float v=0.,amp=.75; float z=(20.*sin(T*.2))+30.; for(int i=0;i<10;++i){ v+=dtVN(uv+(z*uv*.05)+(T*.1))*amp; uv*=3.25; amp*=.5; } return v; }
void mainImage(out vec4 o, in vec2 fc){
  float T=iTime*speed;
  vec2 uv=fc/iResolution.xy-.5; vec2 oldUV=uv; uv.x*=iResolution.x/iResolution.y;
  uv *= dtRot(T*.02);
  mat2 ang=dtRot(dtFbm(uv));
  o=vec4(vec3(dtFbm((vec2(5.456,-2.8112)*ang)+uv), dtFbm((vec2(5.476,-2.8122)*ang)+uv), dtFbm((vec2(5.486,-2.8132)*ang)+uv)) - smoothstep(.1,1.,length(oldUV)), 1.);
}`
}
,
{
  name: "Diffraction Grating (Ds2XRd)",
  ch: ["","","",""],
  src: `// Shadertoy Ds2XRd "[phreax] diffraction grating" 改 — キューブマップ反射を手続き環境に置換して取り込み。
// @param speed 0..3 = 1
uniform float speed;
#define PI 3.141592
#define SIN(x) (sin(x)*.5+.5)
#define BUMP_EPS 0.004
float tt;
mat2 dgrot(float a){ return mat2(cos(a),-sin(a),sin(a),cos(a)); }
vec3 bump3y(vec3 x, vec3 yoffset){ vec3 y=1.-x*x; y=clamp((y-yoffset),vec3(0),vec3(1)); return y; }
float dgrand(vec2 c){ return fract(sin(dot(c.xy, vec2(12.9898,78.233)))*43758.5453); }
float dgrect(vec2 p, vec2 b, float r){ vec2 d=abs(p)-(b-r); return length(max(d,0.))+min(max(d.x,d.y),0.)-r; }
void pixarONB(vec3 n, out vec3 b1, out vec3 b2){ float s=sign(n.z); float a=-1.0/(s+n.z); float b=n.x*n.y*a; b1=vec3(1.0+s*n.x*n.x*a, s*b, -s*n.x); b2=vec3(b, s+n.y*n.y*a, -n.y); }
vec3 invGamma(vec3 c){ return pow(c, vec3(2.2)); }
vec3 gamma(vec3 c){ return pow(c, vec3(1./2.2)); }
vec3 waveSpectrum(float w){
  if(w>700.0||w<400.0) return vec3(0);
  float x=fract((w-400.0)/300.0);
  const vec3 c1=vec3(3.54585104,2.93225262,2.41593945), x1=vec3(0.69549072,0.49228336,0.27699880), y1=vec3(0.02312639,0.15225084,0.52607955);
  const vec3 c2=vec3(3.90307140,3.21182957,3.96587128), x2=vec3(0.11748627,0.86755042,0.66077860), y2=vec3(0.84897130,0.88445281,0.73949448);
  vec3 col=bump3y(c1*(x-x1),y1)+bump3y(c2*(x-x2),y2);
  return invGamma(col);
}
vec3 diffraction(vec3 rd, vec3 n, vec3 td, vec3 l, float d){
  float cL=dot(l,td), cV=dot(rd,td); float u=abs(cL-cV);
  if(u==0.) return vec3(0);
  vec3 col=waveSpectrum(u*d);
  return clamp(col, vec3(0), vec3(1));
}
vec3 transform(vec3 p){ p.yz*=dgrot(PI*.25+tt); p.yx*=dgrot(PI*.25+.75*tt); return p; }
vec2 torusUV(vec3 p){ p=transform(p); float a=atan(p.z,p.x); float r=length(p.zx); return vec2(r,a); }
float dgmap(vec3 p){
  float edge=0.02; p=transform(p);
  float r=1.4; vec2 cp=vec2(length(p.xz)-r, p.y);
  float rev=.5; float a=atan(p.z,p.x);
  cp*=dgrot(rev*a);
  cp=abs(cp)-1.*SIN(tt); cp=abs(cp)-SIN(tt);
  return .3*dgrect(cp.xy, vec2(.3), edge);
}
float gridSurf(vec3 p){ p.z+=.3*tt; p=abs(mod(p*2.,1.*0.125)-0.0125); float x=min(p.x,min(p.z,p.y))/0.03125; return clamp(x,0.,1.); }
vec3 doBumpMap(vec3 p, vec3 nor, float bf){ const float eps=BUMP_EPS; float ref=gridSurf(p); vec3 g=vec3(gridSurf(vec3(p.x-eps,p.y,p.z))-ref, gridSurf(vec3(p.x,p.y-eps,p.z))-ref, gridSurf(vec3(p.x,p.y,p.z-eps))-ref)/eps; g-=nor*dot(nor,g); return normalize(nor+bf*g); }
float raymarch(vec3 ro, vec3 rd, float steps){ float t=0.,d=0.; vec3 p=ro; for(float i=.0;i<steps;i++){ d=dgmap(p); if(abs(d)<0.0001) return t; if(t>100.) break; t+=d; p+=rd*d; } return 1000.; }  // 収束=実ヒット / 未収束(素通り)=1000(=背景)
vec3 dgEnv(vec3 rd){ float y=rd.y*0.5+0.5; vec3 sky=mix(vec3(0.06,0.09,0.15), vec3(0.32,0.42,0.60), y); sky+=0.35*pow(max(0.,rd.y),4.0); return sky; }
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv=(fragCoord-.5*iResolution.xy)/iResolution.y;
  tt=.6*iTime*speed;
  vec3 ro=vec3(uv*6.,-4.), rd=vec3(0,0,1.), lp=vec3(3.,0.,-5), lp2=vec3(-3.,0.,-5);
  vec3 col=vec3(0);
  vec2 e=vec2(0.0035,-0.0035);
  vec3 lc1=vec3(0.745,0.761,0.976), lc2=vec3(0.573,0.922,0.969);
  float steps=180.;
  float t=raymarch(ro, rd, steps);
  vec3 p=ro+t*rd;
  vec3 n=normalize(e.xyy*dgmap(p+e.xyy)+e.yyx*dgmap(p+e.yyx)+e.yxy*dgmap(p+e.yxy)+e.xxx*dgmap(p+e.xxx));
  vec2 tuv=torusUV(p);
  n=doBumpMap(vec3(tuv.x,0.,tuv.y*2.*PI), n, .001);
  vec3 colForAlpha = vec3(0.0);   // alpha 判定専用: 高周波の縞・反射・ディザを含めないマクロな陰影
  if(t < 50.){
    vec3 l=normalize(lp-p), l2=normalize(lp2-p);
    float dif=max(dot(n,l),.0), dif2=max(dot(n,l2),.0);
    float sss=smoothstep(0.,1.,dgmap(p+l*.4))/.4;
    vec3 td=vec3(tuv.x,tuv.y,0.).yxz;
    vec3 tangent,bitangent; pixarONB(n,tangent,bitangent); tangent=normalize(tangent); bitangent=normalize(bitangent);
    mat3 tbn=mat3(tangent,bitangent,n);
    vec3 ll=normalize(vec3(0.,1,0));
    vec3 difr=diffraction(-rd, n, normalize(tbn*td), ll, 700.);
    col += .6*(lc1*dif+lc2*dif2)+difr;
    colForAlpha = col;   // 縞パターン・環境反射ミックスより前のマクロ輝度(高周波成分を含まない)
    col = mix(col, col*(smoothstep(0.,1.,sin(tuv.y*150.+10.*tt))), .5);
    // 反射(元はキューブマップ)→ 手続き環境
    vec3 refl = reflect(rd, n); refl.yz*=dgrot(PI*.8);
    vec3 renv = invGamma(dgEnv(refl));
    col = mix(col, .7*renv, .5);
  } else {
    col = invGamma(col);
    colForAlpha = col;
  }
  // 背景(レイ素通り)は rgba=0 で即返す。元コードはここにもディザ(負値あり)を加えてから
  // gamma=pow を通すため NaN が発生し、NaN は合成の mix() に係数 0 でも伝染して
  // 「B に置いても背景が消えない」「A に置くと B までディザ化」の原因になっていた。
  if(t >= 100.){ fragColor = vec4(0.0); return; }
  // alpha は縞模様(150周期の diffraction ライン)・反射・ディザノイズ・ガンマ補正より前の
  // マクロな陰影輝度で決める(高周波成分で alpha がチラつくのを防ぐ)。
  float lumPre = dot(colForAlpha, vec3(0.299, 0.587, 0.114));
  float alpha = smoothstep(0.05, 0.30, lumPre);
  col += mix(-0.5/255.0, 0.5/255.0, dgrand(uv));
  col *= mix(.2, 1., (1.5-pow(dot(uv,uv),.5)));
  col = gamma(max(col, vec3(0.0)));   // 負のディザを pow に入れない(NaN 防止)
  fragColor = vec4(col, alpha);
}`
}
,
{
  name: "Tunnel of Bones (3lByWh)",
  ch: ["","","",""],
  src: `// "Tunnel of Bones" 改 — チューブ網(2場が同時に0=繋がった管) / 固定カメラ+3Dランダム方向。based on 3lByWh
// @param speed 0..3 = 1
// @param seed 0..6.3 = 0
// @param enaDist 0..8 = 2.5
// @param sparse 0..1 = 0.65
uniform float speed; uniform float seed; uniform float enaDist; uniform float sparse;
#define bnrot(a) mat2(cos(a),sin(a),-sin(a),cos(a))
const int MAX_MARCHING_STEPS = 260;
const float MIN_DIST = 0.0, MAX_DIST = 10000.0, EPSILON = 0.01;
const float bscale = EPSILON;
// チューブ網: 2つの場が同時に≈0 になる曲線 = 長く繋がった細い管(破片が出ない)。sparse で細く
float sceneSDF(vec3 p){
  float S = 0.06;                          // 世界→フィールド周波数
  vec3 q = p * S;
  q.xy *= bnrot(seed); q.yz *= bnrot(seed*0.6);   // seed で網の形が変わる
  float t = iTime*speed*0.15;
  q += 0.7*sin(q.yzx*1.5 + t);             // のたうつワープ(骨っぽく)
  q += 0.4*sin(q.zxy*2.9 - t*1.3);
  float g1 = dot(sin(q + t*0.5),      cos(q.zxy - t*0.4));
  float g2 = dot(sin(q*1.3 - t*0.35), cos(q.yzx + t*0.5));
  float rad = 0.36 - sparse*0.24;          // sparse で管を細く(0.36→0.12)
  float tube = length(vec2(g1, g2)) - rad;
  return tube / S * 0.35;                   // 世界単位へ(0.35=リプシッツ安全係数)
}
vec3 surface_color(vec3 p){
  return vec3(0.74, 0.73, 0.70);   // フラットな近白クリーム(SDF高周波サンプリングのモアレを排除)
}
float march(vec3 eye, vec3 rd, float start, float end){
  float depth=start;
  for(int i=0;i<MAX_MARCHING_STEPS;i++){
    float dist = sceneSDF(eye+depth*rd);                      // 空洞クリアランスなし=管を切らずに繋げる
    if(dist < EPSILON*(1.0+depth*bscale/10.0)) return depth;
    depth += dist * 0.58;                                     // 保守的ステップ(tube SDF の安全マージン)
    if(depth >= end) return end;
  }
  return end;
}
vec3 rayDirection(float fov, vec2 sz, vec2 fc){ vec2 xy=fc-sz/2.0; float z=sz.y/tan(radians(fov)/2.0); return normalize(vec3(xy,-z)); }
vec3 estimateNormal(vec3 p, float e){
  vec2 k = vec2(e, 0.0);
  return normalize(vec3(
    sceneSDF(p+k.xyy)-sceneSDF(p-k.xyy),
    sceneSDF(p+k.yxy)-sceneSDF(p-k.yxy),
    sceneSDF(p+k.yyx)-sceneSDF(p-k.yyx)));
}
vec3 phongContrib(vec3 k_d, vec3 k_s, float alpha, vec3 p, vec3 eye, vec3 N){
  vec3 L=normalize(eye-p), V=normalize(eye-p), R=normalize(reflect(-L,N));
  float dotLN=dot(L,N), dotRV=dot(R,V);
  if(dotLN<0.0) return vec3(0.0);
  if(dotRV<0.0) return vec3(0.8)*(k_d*dotLN);
  return vec3(0.8)*(k_d*dotLN + k_s*pow(dotRV,alpha));
}
mat3 viewMatrix(vec3 eye, vec3 center, vec3 up){ vec3 f=normalize(center-eye), s=normalize(cross(f,up)), u=cross(s,f); return mat3(s,u,-f); }
// めり込み時のエナメル質: クリーム基調 + 温かいSSS + 冷たいfresnel + 強い光沢 + 微パール
vec3 enamelShade(vec3 p, vec3 rd, vec3 eye){
  vec3 n = estimateNormal(p, max(EPSILON, length(p-eye)*0.002));
  vec3 L = normalize(eye - p);
  float dif = clamp(dot(n, L), 0.0, 1.0);
  float fres = pow(1.0 - dif, 3.0);
  float spe = pow(clamp(dot(reflect(-L, n), L), 0.0, 1.0), 180.0);
  vec3 cream = vec3(0.95, 0.92, 0.85);
  vec3 warm  = vec3(1.0, 0.94, 0.84);
  vec3 cool  = vec3(0.72, 0.83, 1.0);
  vec3 c = mix(cream, warm, 0.4) * (0.62 + 0.38*dif);
  c += cool * fres * 0.5;
  c += vec3(1.0) * spe * 0.9;
  c += 0.05*vec3(sin(p.x*3.0), sin(p.y*3.0+2.0), sin(p.z*3.0+4.0));
  return c;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec3 viewDir = rayDirection(45.0, iResolution.xy, fragCoord);
  // 固定カメラ + 3D ランダム方向(スクロールせず全天を揺らいで向く。線形項なし=net drift 0)
  float tt = iTime*speed;
  float ya = 3.14*sin(tt*0.081 + seed) + 2.0*sin(tt*0.049 + seed*2.0) + 1.3*sin(tt*0.113 + seed*3.0);
  float pa = 1.4*sin(tt*0.067 + seed*3.0) + 0.8*sin(tt*0.043 + seed) + 0.5*sin(tt*0.101 + seed*1.7);
  viewDir.xz *= bnrot(ya);
  viewDir.yz *= bnrot(pa);
  vec3 worldDir = viewDir;
  vec3 eye = vec3(17.0, 11.0, 5.0) + vec3(seed*40.0, seed*23.0, seed*31.0);   // 固定位置(seedで場所)
  float dist = march(eye, worldDir, MIN_DIST, MAX_DIST);
  if(dist > MAX_DIST - EPSILON){ fragColor = vec4(0.0); return; }
  vec3 p = eye + dist*worldDir;
  vec3 nrm = estimateNormal(p, max(EPSILON, dist*0.002));   // 法線epsは距離スケール(遠方のモアレ防止)
  vec3 K_a = surface_color(p), K_d = K_a, K_s = vec3(1.0);
  vec3 color = 0.5*vec3(1.0)*K_a + phongContrib(K_d, K_s, 100.0, p, eye, nrm);
  // めり込み(表面が極近 = dist が小)→ 全面エナメル質へブレンド
  float emb = 1.0 - smoothstep(0.0, max(enaDist, 1e-3), dist);
  color = mix(color, enamelShade(p, worldDir, eye), emb);
  fragColor = vec4(color, 1.0);
}`
}
,
{
  name: "OSTSEE (mdjXDd)",
  ch: ["","","",""],
  src: `// Shadertoy mdjXDd "OSTSEE" by pashafx (Alien Rose fork) 改 — 背景黒 / Slot B透過。iChannel0(cubemap)→黒背景+手続き反射env
// @param speed 0..3 = 1
uniform float speed;
uniform float uSlotIsA;
// ---- Common ----
mat4 build_transform(vec3 pos, vec3 ang){
  float cosX=cos(ang.x), sinX=sin(ang.x), cosY=cos(ang.y), sinY=sin(ang.y), cosZ=cos(ang.z), sinZ=sin(ang.z);
  mat4 m;
  m[0][0]=cosY*cosZ+sinX*sinY*sinZ; m[0][1]=cosY*sinZ-sinX*sinY*cosZ; m[0][2]=cosX*sinY; m[0][3]=0.0;
  m[1][0]=-cosX*sinZ; m[1][1]=cosX*cosZ; m[1][2]=sinX; m[1][3]=0.0;
  m[2][0]=sinX*cosY*sinZ-sinY*cosZ; m[2][1]=-sinY*sinZ-sinX*cosY*cosZ; m[2][2]=cosX*cosY; m[2][3]=0.0;
  m[3][0]=pos.x; m[3][1]=pos.y; m[3][2]=pos.z; m[3][3]=1.0;
  return m;
}
mat4 rotationMatrix(vec3 axis, float angle){
  axis=normalize(axis); float s=sin(angle), c=cos(angle), oc=1.0-c;
  return mat4(oc*axis.x*axis.x+c, oc*axis.x*axis.y-axis.z*s, oc*axis.z*axis.x+axis.y*s, 0.0,
              oc*axis.x*axis.y+axis.z*s, oc*axis.y*axis.y+c, oc*axis.y*axis.z-axis.x*s, 0.0,
              oc*axis.z*axis.x-axis.y*s, oc*axis.y*axis.z+axis.x*s, oc*axis.z*axis.z+c, 0.0,
              0.0,0.0,0.0,1.0);
}
vec3 rotateabout(vec3 v, vec3 axis, float angle){ return (rotationMatrix(axis, angle)*vec4(v,1.0)).xyz; }
// ---- Image ----
struct rayresult{ vec3 o; vec3 v; float dist; };
#define OEPS 0.0005
#define OPI 3.1415928
const mat4 ocam = mat4(1.,0.,0.,0., 0.,1.,0.,0., 0.,0.,1.,0., 0.,0.,0.,1.);
vec3 matpos(mat4 mat){ return mat[3].xyz; }
const float planedist = 1.00;
float map(vec3 p){
  float t = iTime*speed;
  vec3 b = 1.000*sin(1.*p.zxy + vec3(t,0.,0.));
  b = rotateabout(sin(b), p, length(p));
  b += 0.500*sin(8.0*b.zxy);
  b += 0.225*sin((sin(t*0.975+5.345)+1.25) * 8.2*b.zxy);
  b = rotateabout(-b, p, length(p)+2.);
  b += 0.120*sin((sin(t*0.812+2.891)+0.23) * 16.8*b.zxy);
  return length(b*length(p*p)) * 0.009;
}
vec3 estimateNormalO(vec3 p){
  return normalize(vec3(
    map(vec3(p.x+OEPS,p.y,p.z))-map(vec3(p.x-OEPS,p.y,p.z)),
    map(vec3(p.x,p.y+OEPS,p.z))-map(vec3(p.x,p.y-OEPS,p.z)),
    map(vec3(p.x,p.y,p.z+OEPS))-map(vec3(p.x,p.y,p.z-OEPS))));
}
const int kRaymarchIterations = 200;
const float mapddivisor = 1.100;
const vec3 sundir = normalize(vec3(0,1,1));
const vec3 suncol = vec3(0.8,0.8,0.8);
const vec3 objcol = vec3(0.9,0.9,0.8);
// iChannel0(cubemap)の代替: 手続き環境(反射用)。背景そのものは黒
vec3 oenv(vec3 rd){
  float u = rd.y*0.5+0.5;
  vec3 c = mix(vec3(0.10,0.13,0.20), vec3(0.55,0.68,0.90), u);   // 地平線暗→上明
  c += pow(max(0.,dot(rd,sundir)),6.0)*vec3(0.9,0.7,0.5);        // 太陽グレア
  return c;
}
float g_hit;
vec3 manager(rayresult io){
  g_hit = 0.0;
  vec3 skycol = vec3(0.0);   // 背景=黒
  float t = -1.00;
  for(int i=0;i<kRaymarchIterations;i++){
    vec3 pos = io.o + io.v*t;
    float d = map(pos);
    if(d > 10.) return skycol;
    if(d < 0.01){
      vec3 n = estimateNormalO(pos);
      float sundot = dot(n,sundir);
      vec3 col = suncol*sundot + objcol;
      vec3 sdir = reflect(io.v,n);
      col *= oenv(sdir);        // 手続き環境で反射(オブジェクトが見える)
      g_hit = 1.0;
      return col;
    }
    t += d/mapddivisor;
  }
  return skycol;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  float tick = iTime*speed/5.;
  vec2 mouseuv = (iMouse.xy-iResolution.xy/2.0)/iResolution.xx*2.;
  mat4 ncam = ocam
    * build_transform(vec3(0,0,0), vec3(0, -mouseuv.x*OPI + tick, 0))
    * build_transform(vec3(0,0,0), vec3(-mouseuv.y*OPI, 0, 0));
  ncam = ncam * build_transform(vec3(0,0,-8.), vec3(0,0,0));
  vec3 campos = matpos(ncam);
  vec2 uv = (fragCoord-iResolution.xy/2.0)/iResolution.xx*2.;
  vec3 v = normalize(uv.x*ncam[0].xyz + uv.y*ncam[1].xyz + ncam[2].xyz*planedist);
  rayresult ray;
  ray.o = campos; ray.v = v; ray.dist = 0.10;
  vec3 color = clamp(manager(ray), 0., 1.);
  float a = mix(g_hit, 1.0, uSlotIsA);   // Slot A=不透明(黒背景) / Slot B=オブジェクトのみ透過
  fragColor = vec4(color, a);
}`
}
,
{
  name: "Alien Neurons Glitch (ctsyDj)",
  ch: ["","","",""],
  src: `// Shadertoy ctsyDj "Alien nuerons" by jackjackdev 改 — 鋭いワープ + データモッシュ/ブロックグリッチの合わせ技。warp/glitch で各強度
// @param speed 0..3 = 1
// @param warp 0..1 = 0.5
// @param glitch 0..1 = 0.4
// @param dist 0.03..5 = 1.6
uniform float speed; uniform float warp; uniform float glitch; uniform float dist;
#define MAX_STEPS 64
#define MAX_DIST 100.
#define SURF_DIST .001
#define TAU 6.283185
#define PI 3.141592
mat2 Rot(float a){ float s=sin(a), c=cos(a); return mat2(c,-s,s,c); }
float sdGyroid(vec3 p, float scale, float thickness, float bias){
  p *= scale;
  return abs(dot(sin(p), cos(p.zxy)) - bias)/scale - thickness;
}
// --- 鋭いワープ(三角波/abs のとがった折り) + データモッシュ/ブロックグリッチ の合わせ技 ---
vec3 glitchP(vec3 p){
  float t = iTime*speed*0.4;
  // 鋭いワープ(三角波/abs のとがったクリース)
  vec3 tri = abs(fract(p*0.8 + vec3(t, t*0.8, t*0.5)) - 0.5);   // 0..0.5 三角波
  p += warp * 2.0 * (tri.yzx - 0.25);
  p += warp * 0.6 * (abs(sin(p.zxy*1.7 + t*1.3)) - 0.5);
  // データモッシュ: 横スライスずらし(ブロック量子化は黒化するので撤去)
  float ts  = floor(iTime*speed*4.0)/4.0;             // 時間を1/4秒ステップに(ガクつき)
  float row = floor(p.y*6.0);
  float hh  = fract(sin(row*91.7 + ts*57.3)*6151.7);
  float on  = step(0.6, hh);
  p.x += (hh-0.5)*glitch*2.2*on;
  p.z += (fract(hh*7.0)-0.5)*glitch*1.1*on;
  return p;
}
vec3 Transform(vec3 p){
  p.z -= iTime*speed*.1;
  p.y -= .3;
  p = glitchP(p);
  return p;
}
float GetDist(vec3 p){
  p = Transform(p);
  float g1 = sdGyroid(p, 3.2, .016, 1.4);      // scale=周波数(柱の数) / thickness=柱の太さ
  float g2 = sdGyroid(p, 6.6, .016, .3);
  float g3 = sdGyroid(p, 12.5, .016, .3);
  float g4 = sdGyroid(p, 21.5, .016, .3);
  float g5 = sdGyroid(p, 36.5, .016, .3);
  float g6 = sdGyroid(p, 61.0, .016, .3);
  float g7 = sdGyroid(p, 111.0, .016, .3);
  g1 -= g2*.3; g1 -= g3*.2; g1 += g4*.1; g1 += g5*.1; g1 += g6*.8; g1 += g7*.5;
  return g1*.9;
}
float RayMarch(vec3 ro, vec3 rd){
  float dO=0.;
  for(int i=0;i<MAX_STEPS;i++){
    vec3 p = ro + rd*dO;
    float dS = GetDist(p);
    dO += dS*0.85;                                    // グリッチで勾配が乱れるので少し保守的に
    if(dO>MAX_DIST || abs(dS)<SURF_DIST) break;
  }
  return dO;
}
vec3 GetNormal(vec3 p){
  vec2 e = vec2(.005,0);
  vec3 n = GetDist(p) - vec3(GetDist(p-e.xyy), GetDist(p-e.yxy), GetDist(p-e.yyx));
  return normalize(n);
}
vec3 GetRayDir(vec2 uv, vec3 p, vec3 l, float z){
  vec3 f=normalize(l-p), r=normalize(cross(vec3(0,1,0),f)), u=cross(f,r), c=f*z, i=c+uv.x*r+uv.y*u;
  return normalize(i);
}
vec3 Background(vec3 rd){
  vec3 col = vec3(0);
  float t = iTime*speed;
  float y = rd.y*.5+.5;
  col += (1.-y)*vec3(0.4,0.8,1.)*1.5;
  float a = atan(rd.x, rd.z);
  float beams = (sin(a*10.+t)*sin(a*7.-t)*sin(a*3.+t));
  beams *= smoothstep(.8,.5,y);
  col += beams;
  col = max(col, 0.);
  col += smoothstep(.5,.0,y);
  return col;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord-.5*iResolution.xy)/iResolution.y;
  vec2 m = iMouse.xy/iResolution.xy;
  float t = iTime*speed;
  vec3 ro = vec3(0,0,-dist);
  ro.yz *= Rot(-m.y*PI+1.);
  ro.xz *= Rot(-m.x*TAU);
  vec3 lookat = vec3(0,0,0);
  vec3 rd = GetRayDir(uv, ro, lookat, .3);   // 焦点距離を短く=広角レンズ
  vec3 col = vec3(0);
  float d = RayMarch(ro, rd);
  if(d<MAX_DIST){
    vec3 p = ro + rd*d;
    vec3 n = GetNormal(p);
    p = Transform(p);
    float dif = n.y*.5+.5;
    col += dif*dif;
    float g2 = sdGyroid(p, 10.76, .03, .3);
    col *= smoothstep(-.1, .1, g2);
    float crackWidth = -0.02 + smoothstep(0., -.5, n.y)*.04;
    float cracks = smoothstep(crackWidth, -.03, g2);
    float g3 = sdGyroid(p+t*.1, 5.76, .03, .0);
    float g4 = sdGyroid(p+t*.05, 4.76, .03, .0);
    cracks *= g3*g4*20.+.2*smoothstep(.2, .0, n.y);
    col += cracks*vec3(0.1,0.2,1.)*3.;
  }
  col = mix(col, Background(rd), smoothstep(0., 7., d));
  fragColor = vec4(col, 1.0);
}`
}
,
{
  name: "Bechamel (4djBzz)",
  ch: ["","","",""],
  src: `// Shadertoy 4djBzz "Bechamel" by leon 改 — じゃっかん軽量化(STEPS 30→22 / repeat 8→6)
// Slot B では実 alpha で背景を透過 (クロマキー不使用)
// @param speed 0..3 = 1
uniform float speed;
uniform float uSlotIsA; // 1=Slot A / 0=Slot B (B では暗部を実 alpha で透過)
#define PI 3.14159
#define TAU PI*2.
#define t (iTime*speed*.3)
#define STEPS 22.
#define BIAS 0.01
#define DIST_MIN 0.01
mat2 rot(float a){ float c=cos(a),s=sin(a); return mat2(c,-s,s,c); }
float cyl(vec2 p, float r){ return length(p)-r; }
float torus(vec3 p, vec2 s){ vec2 q=vec2(length(p.xz)-s.x,p.y); return length(q)-s.y; }
float smin(float a, float b, float r){ float h=clamp(.5+.5*(b-a)/r,0.,1.); return mix(b,a,h)-r*h*(1.-h); }
float rand(vec2 co){ return fract(sin(dot(co*0.123,vec2(12.9898,78.233)))*43758.5453); }
vec3 camera(vec3 p){
  p.yz *= rot((PI*(iMouse.y/iResolution.y-.5)*step(0.5,iMouse.z)));
  p.xz *= rot((PI*(iMouse.x/iResolution.x-.5)*step(0.5,iMouse.z)));
  p.yz *= rot(-PI*.5);
  return p;
}
float map(vec3 p){
  vec3 p1 = p;
  float geo = 1.;
  float cy = 0.2;
  float repeat = 6.;
  p1.xy *= rot(length(p)*.5);
  for(float i=0.; i<repeat; ++i){
    p1.yz *= rot(.3+t*0.5);
    p1.xy *= rot(.2+t);
    p1.xz *= rot(.15+t*2.);
    p1.xy *= rot(p.x*.5+t);
    geo = smin(geo, torus(p1,vec2(1.+i*.2,.02)), .5);         // ジャイロスコープ(トーラス)
    geo = smin(geo, cyl(p1.xz,.04), .5);                      // 触手シリンダー
    vec3 p2 = p1; p2.y = mod(p2.y,cy)-cy/2.;
    geo = smin(geo, torus(p2,vec2(.4,.01)), .2);              // シリンダー沿いのトーラス
  }
  return geo;
}
void mainImage(out vec4 color, in vec2 coord){
  vec2 uv = (coord.xy-.5*iResolution.xy)/iResolution.y;
  vec3 eye = camera(vec3(uv,-3));
  vec3 ray = camera(normalize(vec3(uv,.5)));
  vec3 pos = eye;
  float shade = 0.;
  vec2 seed = (coord.xy/iResolution.xy) + fract(iTime);
  for(float i=0.; i<STEPS; ++i){
    float dist = map(pos);
    if(dist < BIAS) shade += 1.;
    dist = abs(dist)*(.8+0.2*rand(seed*vec2(i)));              // ディザ
    dist = max(DIST_MIN, dist);
    pos += ray*dist;
  }
  float v = shade/(STEPS-1.);
  // 旧クロマキー (smoothstep(0.03,0.16,lum)) と同じカーブを実 alpha として出力
  float a = mix(smoothstep(0.03, 0.16, v), 1.0, uSlotIsA);
  color = vec4(vec3(v), a);
}`
}

,
{
  name: "Wildstyle SDF",
  ch: ["", "", "", ""],
  src: `vec4 fold1(vec4 z) {
    vec3 p = z.xyz;
    p = p - 2.0 * clamp(p, -1.0, 1.0);
    return vec4(p, z.w);
}

vec4 fold2(vec4 z) {
    vec3 p = z.xyz;
    p = p - 2.0 * clamp(p, -1.0, 1.0);
    return vec4(p * 2.0, 2.0 * z.w);
}

vec4 invertRadius(vec4 z, float radius2, float limit) {
  float r2 = dot(z.xyz, z.xyz);
  float f = clamp(radius2 / r2, 1., limit);
  return z * f;
}

vec4 affine(vec4 z, float factor, vec3 offset) {
  z.xyz *= factor;
  z.xyz += offset;
  z.w *= abs(factor);
  return z;
}

vec4 mandel(vec4 z, vec3 offset) {
  float x = z.x;
  float y = z.y;

  z.w = 2. * length(z.xy) * z.w + 1.;

  z.x = x*x - y*y + offset.x;
  z.y = 2.*x*y + offset.y;

  return z;
}

vec4 invert(vec4 z, float factor) {
  float r2 = dot(z.xyz, z.xyz);
  float f = factor / r2;
  return z * f;
}

vec4 rotateXY(vec4 z, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  mat2 m = mat2(c, s, -s, c);
  return vec4(m * z.xy, z.zw);
}

vec4 rotateXZ(vec4 z, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  mat2 m = mat2(c, s, -s, c);
  vec2 r = m * z.xz;
  return vec4(r.x, z.y, r.y, z.w);
}

vec4 shiftXY(vec4 z, float angle, float radius) {
  float c = cos(angle);
  float s = sin(angle);
  return vec4(vec2(c, s) * radius + z.xy, z.zw);
}

float surface = 0.0;
float sdf(vec3 p) {
    //vec3 pmod = mod(p + 2.0, 4.0) - 2.0;
    float t = iTime * .2;
    // ワープ/カーブ: 入力座標を流れる正弦場でうねらせる(空間を歪める)
    p += 0.3 * sin(p.zxy * 0.9 + t * 0.7);
    vec4 z = vec4(p, 1.0);

    vec3 vo1 = vec3(sin(t * .1), cos(t * .0961), sin(t * .017)) * 1.1;
    vec3 vo2 = vec3(cos(t * .07), sin(t * .0533), sin(t * .138)) * 1.1;
    vec3 vo3 = vec3(sin(t * .031), sin(t * .0449), cos(t * .201)) * 1.1;
    
    z = invertRadius(z, 10.0, 1.5);
    z = invertRadius(z, 10.0*10.0, 2.0);
    z = rotateXZ(z, t * .783);
    z = invertRadius(z, 4.0*4.0, 2.0);
    z = mix(z, vec4(p, 1.0), .25);
    z = rotateXY(z, t * .881);
    z = fold1(z);    z = invertRadius(z, 4.0*4.0, 2.0);
    z = mix(z, vec4(p, 1.0), .25);
    z = rotateXY(z, t * .781);
    z = fold1(z);    z = rotateXZ(z, t * .783);
    z = fold1(z);
    z = mix(z, vec4(p, 1.0), .25);
    z = invertRadius(z, 10.0*10.0, 3.0);
    z = fold1(z);
    z = fold1(z);
    z = mix(z, vec4(p, 1.0), .25);
    z = invertRadius(z, 10.0*10.0, 2.0);


    vec3 po = vec3(0.0, 0.0, 0.0);

    vec3 box = abs(z.xyz);
    float d1 = (max(box.x - 2.0, max(box.y - 2.0, box.z - 10.0))) / z.w;
    float d2 = (max(box.x - 20.0, max(box.y - .5, box.z - .5))) / z.w;

    float d3 = min(d1, d2);
    if (d2 == d3) {
      surface = 1.0;
    }
    else {
      surface = 0.0;
    }
    return d3*.9;
}

vec3 normal(vec3 p) {
	vec2 e = vec2(.0001, 0.0);
    float f = sdf(p);
    return normalize(vec3(
        sdf(p + e.xyy) - f,
        sdf(p + e.yxy) - f,
        sdf(p + e.yyx) - f
    ));
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
	vec2 uv = fragCoord.xy / iResolution.xy;
    vec2 xy = (uv * 2.0 - 1.0) * vec2(iResolution.x / iResolution.y, 1.0);

    // ワープ/カーブ: 画面座標を「中心からの距離依存の渦巻き」+「うねり」で歪める
    float rr = length(xy);
    float sw = (0.22 + 0.22*sin(iTime*0.2)) * rr;
    xy = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * xy;                     // 渦巻き(カーブ)
    xy += 0.09 * vec2(sin(xy.y*3.0 + iTime*0.6), cos(xy.x*3.0 + iTime*0.5)); // うねりワープ

    vec3 color = vec3(.03, .02, .02) * (1.5 - uv.y);

    vec3 light = vec3(.577);
    float angle = 1.0-iMouse.x * .005;   
    float c = cos(angle);
    float s = sin(angle);
    mat3 camera = mat3(
        c,  0.0, -s,
         0.0,  1.0, 0.0,
        s,  0.0, c//,
	);
    float fov = .5;

    vec3 rd = camera * normalize(vec3(xy * fov,-1.0));
    vec3 ro = vec3(s,0.0,c)*30.0;
    
    float tmax = 100.0;
    float dmin = .001;
    float t = 0.0;
    float d = sdf(ro);
    if (d < 0.0) rd = -rd;
    for (int i = 0; i < 96; ++i) {
        vec3 p = ro + rd * t;
        d = sdf(p);
        t += d;
        if (t > tmax || d < dmin) break;
    }

    vec3 p = ro + rd * t;
    vec3 n = normal(p);
    if (t < tmax && d < dmin) {
      vec3 albedo = mix(vec3(1., .5, .1), vec3(1.0), surface);
  	  float diffuse = clamp(dot(n, light), 0.0, 1.0);
      
      float ao = 0.0;
      float am = 0.0;
      float step = .05;
      vec3 pa = p;
      for (int i = 0; i < 8; ++i) {
          pa += n * step;
          am += step;
          ao += max(0.0, sdf(pa) / am);
          step += .05;
      }
      
      t = .1;
      float shadow = 1.0;
      if (diffuse > 0.0) {
        for (int i = 0; i < 24; ++i) {
          vec3 pb = p + light * t;
          d = sdf(pb);
          t += d;
          if (d < 0.0) break;
        }
        
        shadow = clamp(d, 0.0, 1.0);
        diffuse *= shadow;
      }
        
      ao = (.2 + .8 * ao / 8.0);
      float ambient = 0.08;

      vec3 sun = vec3(1.0, 1.0, .85);
      vec3 sky = vec3(1.0, .5, .5);
      color = 6.0 * vec3(mix(sun * diffuse, sky, ambient) * ao * ao * albedo * 5.0);
      color = color/(1.0+color);
    }
    
	fragColor = vec4(sqrt(color),1.0);
}`
}


,
{
  name: "Cube Surface II (Mty3DV)",
  ch: ["","","",""],
  src: `//By Nestor Vina

// ray marching
const int max_iterations = 100;
const float stop_threshold = 0.02;
const float grad_step = 0.1;
const float clip_far = 1000.0;

// math
const float PI = 3.14159265359;
const float DEG_TO_RAD = PI / 180.0;

const vec3 sunDir = normalize(vec3(1.0,-1.0,1.0));


vec3 rotate( vec3 p, vec3 rot ){
    rot.z = -rot.z;
    mat3 ry = mat3(cos(rot.y), 0.0,-sin(rot.y),
			   0.0, 1.0, 0.0, 
			   sin(rot.y), 0.0, cos(rot.y)  );
    
	mat3 rz = mat3(cos(rot.z),-sin(rot.z), 0.0,
			   sin(rot.z), cos(rot.z), 0.0,
			   0.0, 0.0, 1.0 );
     
	mat3 rx = mat3(1.0, 0.0, 0.0,
			   0.0, cos(rot.x), sin(rot.x), 
			   0.0,-sin(rot.x), cos(rot.x) );
    return p*rz*ry*rx;
}


float cubes( vec3 p, vec3 b,float c )
{
  p += vec3(0.0,22.0,0.0);
  p = rotate(p,vec3(-PI*0.135,0.0,0.0));
  vec3 initialp = p;
  p.xz = mod(p.xz,c) - 0.5 * c;
  vec2 index = floor(initialp.xz/c);
  
  float incidence = length(index)*0.1;
  incidence += sin((index.x + index.y)*0.1 + iTime*0.1)*0.03;

  p = rotate(p,vec3(iTime*incidence,iTime*incidence,0.0));
  
  vec3 d = abs(p) - b;
  return min(max(d.x,max(d.y,d.z)),0.0) + length(max(d,0.0));
}

//Map
vec2 mapCubeSkin(vec3 p){
    float c = 1.0;
    vec2 index = floor(p.xz/c);
    float minDist = cubes(p,vec3(0.5,0.5,.5),c);
   	float color = (1.0+sin(length(index.xy)*0.2+iTime))*0.5;
	return vec2(minDist, color);
}
vec2 map( vec3 p) {
    p.y += sin((p.x+p.z)*0.3+iTime*3.0);
    return mapCubeSkin(p);
}

vec2 rayMarching( vec3 origin, vec3 dir, float start, float end ) {
	
    float depth = start;
	for ( int i = 0; i < max_iterations; i++ ) {
        vec2 distResult = map( origin + dir * depth );
		float dist = distResult.x;
		if ( dist < stop_threshold ) {
			return vec2(depth,distResult.y);
		}
		depth += dist;
		if ( depth >= end) {
			return vec2(end,-1.0);
		}
	}
	return vec2(end,-1.0);
}

vec3 ray_dir( float fov, vec2 size, vec2 pos ) {
	vec2 xy = pos - size * 0.5;

	float cot_half_fov = tan( ( 90.0 - fov * 0.5 ) * DEG_TO_RAD );	
	float z = size.y * 0.5 * cot_half_fov;	
	return normalize( vec3( -xy, -z ) );
}

vec3 normal( vec3 pos ) {
	const vec3 dx = vec3( grad_step, 0.0, 0.0 );
	const vec3 dy = vec3( 0.0, grad_step, 0.0 );
	const vec3 dz = vec3( 0.0, 0.0, grad_step );
	return normalize (
		vec3(
			map( pos + dx ).x - map( pos - dx ).x,
			map( pos + dy ).x - map( pos - dy ).x,
			map( pos + dz ).x - map( pos - dz ).x			
		)
	);
}

mat3 rotationXY( vec2 angle ) {
	vec2 c = cos( angle );
	vec2 s = sin( angle );
	
	return mat3(
		c.y      ,  0.0, -s.y,
		s.y * s.x,  c.x,  c.y * s.x, 
		s.y * c.x, -s.x,  c.y * c.x
	);
}

float fresnel(vec3 n, vec3 d, float exp ){
    return pow(1.0-dot(d,n),exp);
}

vec3 material( vec3 v, vec3 n, vec3 eye,float randomIndex ) {    
    //Texturing 
    vec2 uv = v.xz;    
    
    //vec3 albedo = texture(iChannel0,vec2(randomIndex,0.0)).xyz;//vec3(0.5,0.0,0.0);
    vec3 albedo = mix(vec3(0.5,0.1,0.4),vec3(0.1,0.1,0.6),randomIndex);
    
    vec3 viewDir = normalize(eye-v);    
    vec3 fresnelColor = vec3(0.4,0.3,0.7) * fresnel(n,viewDir,2.0);    
    
    float diffuse = dot(sunDir,n)*0.3;
    vec3 ambient = vec3(0.1,0.05,0.005);
    
    return albedo+diffuse+ambient;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
	// default ray dir
	vec3 dir = ray_dir( 45.0, iResolution.xy, fragCoord.xy );
	
	// default ray origin
	vec3 eye = vec3( 0.0, -6.0, 45.0 );

	// rotate camera
	mat3 rot = rotationXY( vec2(0,2.0*PI));
	dir = rot * dir;
	eye = rot * eye;
	
	// ray marching
    vec2 rayResult = rayMarching( eye, dir, 2.0, clip_far );
	float depth = rayResult.x;
	if ( depth >= clip_far ) {        
		fragColor = vec4(0.3,0.3,0.3,depth);//Background color
        return;
	}
	
	// shading
	vec3 pos = eye + dir * depth;
	vec3 n = normal( pos );
    vec3 fogColor = vec3(0.3,0.3,0.3);
    
   	fragColor = vec4(material( pos, n, eye,rayResult.y ), depth);
    
}`
}
,
{
  name: "Hand Model (msSXDc)",
  ch: ["","","",""],
  src: `#define int2 vec2
#define float2 vec2
#define int3 vec3
#define float3 vec3
#define int4 vec4
#define float4 vec4
#define frac fract
#define float2x2 mat2
#define float3x3 mat3
#define float4x4 mat4
#define saturate(x) clamp(x,0.,1.)
#define lerp mix
#define CurrentTime (iTime)
#define sincos(x,s,c) s = sin(x),c = cos(x)
#define mul(x,y) (x*y)
#define atan2 atan
#define fmod mod
#define static
#define MaxDist 100.f
#define SurfaceDist 0.0001f
#define FloatMax 3.402823466e+38f
#define raymarchDepth 200
#define raymarchDistMax 400.f
#define PI2 6.283185f
#define PI 3.141592f

float sdf3dSphere(float3 _point, float4 sphere)
{
    return length(_point - sphere.xyz) - sphere.w;
}

float sdf3dCapsule(float3 _point, float3 A, float3 B, float radius)
{
    float3 ab = B - A;
    float3 ap = _point - A;
    float t = saturate(dot(ap, ab) / dot(ab, ab));
    
    return length(ap - t * ab) - radius;
}

float sdf3dBox(float3 _point, float3 box, float3 boxSize)
{
    _point = abs(_point - box) - boxSize;
    return length(max(_point, 0.f)) + min(max(_point.x,max( _point.y, _point.z)), 0.f);
}

float segment(float3 _point, float4 A, float4 B)
{
    float3 ab = B.xyz - A.xyz;
    float3 ap = _point - A.xyz;
    float t = saturate(dot(ap, ab) / dot(ab, ab));
    return length(ap - t * ab) - lerp(A.w, B.w, t);
}

mat3 viewMatrix(vec3 look)
{
    vec3 right = normalize(cross(vec3(0.f, 1.f, 0.f), look));
    vec3 up = cross(look, right);
    return transpose(mat3(right, up, look));
}

float smoothMin(float a, float b, float k, float n)
{
    return min(a, b) - pow(max(k - abs(a - b), 0.f) / k, n) * k / (2.f * n);
}

float smoothMax(float a, float b, float k, float n)
{
    return max(a, b) + pow(max(k - abs(a - b), 0.f) / k, n) * k / (2.f * n);
}

float2 hash(float2 p)
{
    float3 p3 = frac(float3(p.xyx) * float3(123.1031, 144.1030, 194.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return frac((p3.xx + p3.yz) * p3.zy);
}

float3 hash(float3 p3)
{
    p3 = frac(p3 * float3(131.1031, 144.1030, 155.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return frac((p3.xxy + p3.yxx) * p3.zyx);
}

float simplexNoise(float3 p)
{
    float k1 = 0.333333f;
    float k2 = 0.166667f;
    
    int3 idx = floor(p + (p.x + p.y + p.z) * k1);
    float3 a = p - (float3(idx) - float(idx.x + idx.y + idx.z) * k2);
    
    int3 tb1Arr[8] = vec3[8]
    ( int3(0, 0, 1), int3(0, 1, 0), int3( 0), int3(0, 1, 0), int3(0, 0, 1), int3( 0), int3(1, 0, 0), int3(1, 0, 0) );
    int3 tb2Arr[8] = vec3[8]
    ( int3(0, 1, 1), int3(0, 1, 1), int3( 0), int3(1, 1, 0), int3(1, 0, 1), int3( 0), int3(1, 0, 1), int3(1, 1, 0) );
    
    uint tbIdx = (uint(a.x > a.y) << 2) | (uint(a.x > a.z) << 1) | uint(a.y > a.z);
    
    int3 tb1 = tb1Arr[tbIdx], tb2 = tb2Arr[tbIdx];
    
    float3 b = a - tb1 + k2;
    float3 c = a - tb2 + k2 * 2.f;
    float3 d = a - 1.f + k2 * 3.f;
    
    float4 kernel = max(0.5f - float4(dot(a, a), dot(b, b), dot(c, c), dot(d, d)), 0.f);
    kernel *= kernel;
    kernel *= kernel;
    float4 noise = kernel * float4(dot(a, hash(idx)*2.-1.), 
                                   dot(b, hash(idx + tb1)*2.-1.), 
                                   dot(c, hash(idx + tb2)*2.-1.), 
                                   dot(d, hash(idx + 1.f)*2.-1.));
    
    return dot(vec4(60.f), noise);
}

float2x2 rot2D(float t)
{
    float s, c;
    sincos(t, s, c);
    return float2x2(c, s, -s, c);
}


float sdHand(float3 p)
{
    p.z += 3.f;
    p.z -= smoothstep(12.f,0.f,abs(p.x))*2.;
    p.z -= smoothstep(20.f,0.f,abs(p.y-3.))*1.5;
    p.z *= 0.8f;
    p.y *= 0.86f;
    float dist = sdf3dBox(p, float3(0.f,1.f,-0.1f), float3(8.5f-smoothstep(3.f,-6.f,p.y),10.,0.5))-2.f;  
    dist = smoothMax(dist, sdf3dSphere(p,float4(0.f,0.5f,0.f,12.f)),5.f,2.f);
    dist = smoothMin(dist, segment(p,float4(-6.5f,-5.f,-1.f,1.4f),float4(-12.f,2.f,-2.f,1.4f)),5.f,2.f);
    dist = smoothMin(dist, segment(p,float4(-8.5f,-3.f,-2.f,1.5f),float4(-11.f,3.5f,-4.f,1.5f)),5.f,2.f);
    
    {
        dist = smoothMin(dist, segment(p,float4(-3.f,-6.f,-2.f,0.3f),float4(-6.f,2.f,-3.f,0.2f)),7.f,2.f);
        dist = smoothMin(dist, segment(p,float4(-3.f,-6.f,-2.f,0.3f),float4(4.f,-6.f,-1.f,0.3f)),5.f,2.f);
        dist = smoothMin(dist, segment(p,float4(4.f,-6.f,-1.f,0.3f),float4(6.f,5.f,-2.f,0.5f)),5.f,2.f);
        dist = smoothMin(dist,  sdf3dSphere(p,float4(-7.f,7.5f,-2.f,0.3)),5.f,2.f);
        
        dist = smoothMin(dist, segment(p,float4(-6.f,-6.f,1.8f,0.35f),float4(-13.f,2.5f,-1.2f,0.35f)),1.f,2.f);
        dist = smoothMin(dist, segment(p,float4(-1.f,-7.f,2.f,0.2f),float4(-7.f,6.8f,2.3f,0.2f)),1.f,2.5f);
        dist = smoothMin(dist, segment(p,float4(1.f,-7.f,1.8f,0.3f),float4(-1.f,8.f,2.f,0.3f)),1.f,2.f);
        dist = smoothMin(dist, segment(p,float4(2.f,-7.f,1.8f,0.3f),float4(2.5f,7.5f,2.f,0.3f)),1.f,2.f);
        dist = smoothMin(dist, segment(p,float4(4.f,-7.f,2.f,0.3f),float4(7.f,5.8f,2.f,0.3f)),1.f,2.5f);
    }
    
    float time = iTime*2.;
    
    float t = sin(time)*0.5+0.5;
    float3 little = p;   
    little -= float3(7.f,5.f,0.f);
    little.yz = mul(little.yz, rot2D(-0.1-t*0.2));  
    float fingerL = segment(little,float4(0.,0.,0.,1.8f),float4(0.f,7.f,0.f,1.55f));
    little.y -= 7.f;
    little.yz = mul(little.yz, rot2D(-0.4-t*0.1));
    fingerL = smoothMin(fingerL,segment(little,float4(0.,0.,0.,1.45f),float4(0.f,3.2f,0.f,1.3f)),0.2f,2.f);
    little.y -= 3.5f; 
    little.yz = mul(little.yz, rot2D(-0.7));
    float tip = segment(little,float4(0.,0.,0.,1.2f),float4(0.f,3.f,1.1f,1.f));
    tip = smoothMax(tip,-(sdf3dBox(little,float3(0.f,2.5f,2.f), float3(2.5f,3.f,0.5f))),0.7f,2.f);
    fingerL = smoothMin(fingerL,tip,0.5f,2.f);
    
    t= sin(time - 3.14*0.5)*0.5+0.5;
    float3 ring = p;   
    ring -= float3(2.8f,7.5f,0.f);
    ring.yz = mul(ring.yz, rot2D(-0.1-t*0.3));  
    float fingerR = segment(ring,float4(0.,-1.,0.,2.2f),float4(0.f,7.f,0.f,1.6f));
    ring.y -= 7.f;
    ring.yz = mul(ring.yz, rot2D(-0.4-t*0.2));
    fingerR = smoothMin(fingerR,segment(ring,float4(0.,0.,0.,1.5f),float4(0.f,4.f,0.f,1.4f)),0.2f,2.f);
    ring.y -= 4.f; 
    ring.yz = mul(ring.yz, rot2D(-0.7-t*0.2));
    tip = segment(ring,float4(0.,0.,0.,1.3f),float4(0.f,3.2f,1.2f,1.2f));
    tip = smoothMax(tip,-(sdf3dBox(ring,float3(0.f,2.5f,2.f), float3(2.5f,3.f,0.5f))),0.6f,2.f);
    fingerR = smoothMin(fingerR,tip,0.5f,2.f);    
    
    t = sin(time - 3.14)*0.5+0.5;
    float3 middle = p;   
    middle -= float3(-2.f,9.f,0.f);
    middle.yz = mul(middle.yz, rot2D(-0.1-t*0.4));  
    float fingerM = segment(middle,float4(-0.2,-1.,0.,2.5f),float4(0.f,7.f,0.f,1.7f));
    middle.y -= 7.f;
    middle.yz = mul(middle.yz, rot2D(-0.3-t*0.2));
    fingerM = smoothMin(fingerM,segment(middle,float4(0.,0.,0.,1.6f),float4(0.f,4.8f,0.f,1.5f)),0.2f,2.f);
    middle.y -= 4.8f; 
    middle.yz = mul(middle.yz, rot2D(-0.7-t*0.4));
    tip = segment(middle,float4(0.,0.,0.,1.5f),float4(0.f,3.5f,1.2f,1.25f));
    tip = smoothMax(tip,-(sdf3dBox(middle,float3(0.f,2.5f,2.2f), float3(2.5f,3.f,0.5f))),0.8f,2.f);
    fingerM = smoothMin(fingerM,tip,0.5f,2.f);
    
    t = sin(time - 3.14*1.5)*0.5+0.5;
    float3 index = p;   
    index -= float3(-7.f,7.5f,0.f);
    index.yz = mul(index.yz, rot2D(-0.1-t*0.3));  
    float fingerI = segment(index,float4(-0.5,-1.,0.,2.5f),float4(0.f,7.f,0.f,1.7f));
    index.y -= 7.f;
    index.yz = mul(index.yz, rot2D(-0.4-t*0.2));
    fingerI = smoothMin(fingerI,segment(index,float4(0.,0.,0.,1.6f),float4(0.f,4.f,0.f,1.4f)),0.2f,2.f);
    index.y -= 4.f; 
    index.yz = mul(index.yz, rot2D(-0.6-t*0.2));
    tip = segment(index,float4(0.,0.,0.,1.3f),float4(0.f,3.5f,1.5f,1.2f));
    tip = smoothMax(tip,-(sdf3dBox(index,float3(0.f,2.5f,2.5f), float3(3.f,2.f,0.2f))),1.f,2.f);
    fingerI = smoothMin(fingerI,tip,0.5f,2.f);
    
    t =sin(time+0.2)*0.5+0.5;
    float3 thumb = p;  
    thumb -= float3(-11.f,3.5f,-4.f);    
    thumb.xy=mul(thumb.xy,rot2D(-0.1-t*0.2));
    thumb.yz = mul(thumb.yz,rot2D(-0.5));
    float fingerT = segment(thumb,float4(0.f,0.f,0.f,1.8f),float4(0.f,6.5f,0.f,1.7f));
    thumb.y -= 6.5f;
    thumb.xy=mul(thumb.xy,rot2D(-0.6-t*0.2));
    tip = segment(thumb,float4(0.,0.,0.,1.6f),float4(-1.8f,4.5f,0.f,1.2f));
    tip = smoothMax(tip,-(sdf3dBox(thumb,float3(-4.f,2.5f,0.f), float3(1.5f,5.f,1.5f))),1.2f,2.f);
    fingerT = smoothMin(fingerT,tip,0.5f,2.f);
    
    float finger = smoothMin(fingerL, fingerR,0.5,2.0);    
    finger = smoothMin(finger, fingerM,0.5,2.0);
    finger = smoothMin(finger, fingerI,0.5,2.0);
    finger = smoothMin(finger, fingerT,0.5,2.0);
    dist = smoothMin(dist, finger,2.f,2.f);
    
    return dist - simplexNoise(p*0.15)*0.3- simplexNoise(p*0.3)*0.1-0.1;
}

float GetSignDistance(float3 p)
{  
    p.y += 11.;
    if(iMouse.z > 0.f)
    {
    p.xz *= rot2D((iMouse.x/iResolution.x+0.5)*PI2*1.1);
    p.yz *= rot2D((iMouse.y/iResolution.y+0.5)*PI2*1.1);
    }
    else
    {
        p.xz *= rot2D(iTime*0.5);
    }
    return sdHand(p);
}

float RayMarching(float3 rayOrigin, float3 rayDir)
{
    float dist = 0.f;
    for (int i = 0; i < raymarchDepth; ++i)
    {
        float3 p = rayOrigin + rayDir * dist;
        float curr = GetSignDistance(p);
        
        dist += curr;
        if (curr < SurfaceDist || dist > raymarchDistMax)
        {
            dist = curr < SurfaceDist ? dist : FloatMax;
            break;
        }
    }
    
    return dist;
}

float3 GetSDFNormal(float3 p)
{
    return normalize(float3(+1.f, -1.f, -1.f) * GetSignDistance(p + float3(+1.f, -1.f, -1.f) * SurfaceDist) +
                     float3(-1.f, -1.f, +1.f) * GetSignDistance(p + float3(-1.f, -1.f, +1.f) * SurfaceDist) +
                     float3(-1.f, +1.f, -1.f) * GetSignDistance(p + float3(-1.f, +1.f, -1.f) * SurfaceDist) +
                     float3(+1.f, +1.f, +1.f) * GetSignDistance(p + float3(+1.f, +1.f, +1.f) * SurfaceDist));
}


void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = (2.0*(fragCoord)-iResolution.xy)/iResolution.y;

    float3 ro = float3(0., 3., -28.);
    float3 rt = float3(0., 0., 0.);
    float3 rd = mul(transpose(viewMatrix(normalize(rt - ro))), normalize(float3(uv, 1.)));
    
    float t = RayMarching(ro, rd);    
    
    float3 col = float3(0.f);
    float handAlpha = 0.0;   // 背景は alpha=0(Slot B で実 alpha 透過。クロマキー不使用)

    if(t < FloatMax)
    {
        float3 p = ro + t * rd;
        float3 n = GetSDFNormal(p);

        col = float3((dot(n,normalize(float3(0.f,1.f,-1.f)))));
        handAlpha = 1.0;
    }

    fragColor = vec4(col, handAlpha);
}`
}
,
{
  name: "HV Splits (MlcGRl)",
  ch: ["","","",""],
  src: `// Created by Benoit Marini - 2016
// License Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.

const int iter = 10;


float parts (int i, int j)
{
    float a=sin(float(i*j)+iTime*float(j)*0.33);
    return 0.25+(a+1.)*0.25;
}


vec3 palette( in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d )
{
    return a + b*cos( 6.28318*(c*t+d) );
}

vec3 colorForZone (vec2 res)
{
    float t = res.x/pow(2., float(iter))+res.y*0.15;
    return palette(t,vec3(0.5),vec3(0.5),vec3(1.0),vec3(0.,0.33,0.66));
}
   


vec2 HVdivide (vec2 p)
{
    int zone = 0;
    int a=1;
    //float cc= cos(iTime*1.);
    float ss= sin(iTime*0.23);
    
    for (int i=0;i<iter;i++)
	{
		float seuil = parts(zone,i);
        //float cc= cos(iTime*1.+float(zone));
    	//float ss= sin(iTime*1.+float(zone));

        float tt=p.x;//cc*p.x+ss*p.y;
        seuil-=ss*p.y;
        float s=sign(tt-seuil);
        s=(s+1.)*0.5;
        zone+=a*int(s);
        p.x =s*(p.x-seuil)/(1.-seuil) + (1.-s) *p.x/seuil;
        a*=2;
        p=vec2(p.y, 1.-p.x);
    }
    
    return vec2(float(zone),1.-p.y);
}



void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
	vec2 uv = fragCoord.xy / iResolution.xy;
    vec3 col = colorForZone(HVdivide(uv));

    fragColor = vec4(col.xyz,1.);
}`
}
,
{
  name: "Metal Meta (4ssGWS)",
  ch: ["","","",""],
  src: `// Kleber Garcia (c) 2017

const float EPSILON = 0.004;   // 原作 0.001。早めに打ち切って軽くする
const vec3 AMBIENT = vec3(0.6, 0.4, 0.3);
vec3 gDirLight1 = normalize(vec3(-0.1, 0.2, -1));
vec3 gLightPos1 = vec3(-1, 1, -8);

#define SATURATE(x) clamp(x, 0.0, 1.0)
#define NORMOBJ(o,p) normalize(vec3(o(p.xyz + dif.xyy)-o(p.xyz - dif.xyy),o(p.xyz + dif.yxy)-o(p.xyz - dif.yxy),o(p.xyz+dif.yyx)-o(p.xyz-dif.yyx)))
#define PI 3.14159265359
#define HALF_PI (PI / 2.0)
vec4 SPHERE1 = vec4(0, 0, 3, 2.5); //xyz pos, w radius
float genericSphere(vec3 pos, vec4 sphere)
{
	return length(sphere.xyz - pos) - sphere.w;
}

float sphere1(vec3 pos)
{
	return genericSphere(pos, SPHERE1);
}

vec2 getSphereUv(const in vec3 pos, const vec3 center, vec3 norm)
{
	vec3 dir = normalize(pos - center);
	vec2 orz = normalize(dir.xz);
	float sigmaU = 1.0 - (acos(orz.x) / PI);//optimize arccos with fast impl!!!
	float thetaV = acos(dir.y) / PI;
	float u = sigmaU * 0.5 + 0.5;
	float v = thetaV * 0.5 + 0.5;
	return vec2(u, v);
}


vec2 scene(vec3 pos, out vec3 intersectP)
{

    intersectP = pos + vec3(sin(pos.y + iTime),0,0);
    intersectP.y += 0.3*sin(pos.x + iTime);
    intersectP.x -= 0.5*cos(4.0*(pos.y + iTime));
    intersectP.y -= 0.5*cos(2.5+2.3*(pos.x + 3.0*iTime));    
    intersectP.y -= 0.5*sin(0.8+pos.x + 2.0*iTime);
    intersectP.z += 0.1*sin(0.9+pos.x + 1.35*iTime);
    intersectP.x -= 0.2*cos(1.9+0.2*pos.y + 1.4*iTime);    
    intersectP.x += 0.5*sin(1.9+4.2*pos.y + 0.3*iTime);
    intersectP.y += 0.2*cos(2.5+0.7*pos.y + 0.32*iTime);
    intersectP.x += 0.2*sin(4.6+6.5*pos.y + 1.45*iTime);
    intersectP.x -= 0.1*cos(1.9+0.6*pos.y + 0.6*iTime);
        

	float s1 = sphere1(intersectP);
	float d = s1;
	float matId = 1.0;
	return vec2(d, matId);
}

vec2 raymarch(const in vec3 camPos, const in vec3 rayDir, out vec3 posOut, out vec3 pp)
{
	vec2 d = vec2(1000.0, 0.0);
	vec3 pos = camPos;
    vec3 intersectP = vec3(0,0,0);
	for (int i = 0; i < 80; ++i)
	{
		if (d.x < EPSILON)
		{
			continue;
		}
        
		d = scene(pos, intersectP);
        pp = 
		pos += d.x*rayDir;
	}
	posOut = intersectP;
	return d;
}



vec3 norm(vec3 pos, float matId)
{
	vec3 n = vec3(0,0,0);
	vec2 dif = vec2(EPSILON, 0.0);
	n = NORMOBJ(sphere1, pos);	
	
	return n;
}

vec3 material(float matId, vec3 normal, vec3 posOut, out vec3 normOut, out vec3 specTint)
{
	vec3 col = vec3(1,1,1);
	specTint = vec3(1,1,1);
	normOut = normal;
	if (matId == 1.0)
	{
		vec2 uv = getSphereUv(posOut, SPHERE1.xyz, normal);
		col = vec3(0.2,0.5,0.3) ;
		specTint = vec3(0.5, 0.6, 0.2);
		normOut.x += 0.2 * sin(uv.y*uv.x * 150.0) - 0.3 * cos(uv.y * 150.0);
		normOut.y += 0.4 * sin(uv.x*uv.y * 250.0) + 0.3 * cos(uv.x * 150.0);

		normOut = normalize(normOut);
		vec2 newUv = uv.xy + 0.001*normOut.xy;
		
		
		vec2 muls = abs(vec2(1, 1) - 900.0*abs(vec2(mod(newUv.x, 0.003) - 0.0002, mod(newUv.y, 0.003) - 0.0002)));// , );
		normOut.xy -= 0.3 * muls;
		normOut = normalize(normOut);
		
	}
	else if (matId == 2.0)
	{
		col = vec3(1,1,1);
	}
	
	return col;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    
	float gAspect = iResolution.x / iResolution.y;    
	vec2 gMouseHomogeneous = 4.0*((iMouse.xy / iResolution.xy) * 2.0 - 1.0);
    
	vec2 uv = fragCoord.xy / iResolution.xy;
	vec3 homogeneousPos = vec3(uv * 2.0 - 1.0, 0.0);
	homogeneousPos.x *= gAspect;
	vec3 camPos = vec3(0, 0, -1);
	vec3 camPivot = vec3(0, 0, 3);
	vec3 seeDir = normalize(camPos - camPivot);
	vec3 screenDir = normalize(homogeneousPos - camPivot);
	float initAngle =  (HALF_PI / 150.0) * (sin(iTime * 2.7));
	float initAngleVet =  (HALF_PI / 150.0) * (cos(iTime * 3.0));
	float angle = HALF_PI + initAngle + (-gMouseHomogeneous.x) * 0.1;//(iTime * 0.9);
	float angleVert = HALF_PI + initAngleVet + (-gMouseHomogeneous.y) * 0.1;//(iTime * 0.9);;
	
	vec2 cosSinAngle = vec2(sin(angle), cos(angle));
	vec2 cosSinAngleVert = vec2(sin(angleVert), cos(angleVert));
	
	seeDir.xz = vec2( dot( seeDir.xz, cosSinAngle.xy ), dot( seeDir.xz, vec2(-cosSinAngle.y, cosSinAngle.x) ) );
	screenDir.xz = vec2( dot( screenDir.xz, cosSinAngle.xy ), dot( screenDir.xz, vec2(-cosSinAngle.y, cosSinAngle.x) ) );
	
	seeDir.yz = vec2( dot( seeDir.yz, cosSinAngleVert.xy ), dot( seeDir.yz, vec2(-cosSinAngleVert.y, cosSinAngleVert.x) ) );
	screenDir.yz = vec2( dot( screenDir.yz, cosSinAngleVert.xy ), dot( screenDir.yz, vec2(-cosSinAngleVert.y, cosSinAngleVert.x) ) );
	
	
	camPos = seeDir * length(camPos - camPivot) + camPivot;
	homogeneousPos = screenDir * length(homogeneousPos - camPivot) + camPivot;
	
	
	
	vec3 rayDir = normalize(homogeneousPos - camPos);
	vec3 finalCol = 2.9*vec3(vec3(1.0 - uv.y) * 0.3) * vec3(0.7,0.7,0.8);
	vec3 posOut; vec3 pp;
	vec2 d = raymarch(camPos, rayDir, posOut, pp);
	if (d.x < EPSILON )
	{
		vec3 lightDir = normalize(gLightPos1 - posOut);
		vec3 n = norm(pp, d.y);
		vec3 normOut = vec3(0,0,0);
		vec3 specTint = vec3(0,0,0);
		vec3 col = material(d.y, n, pp, normOut, specTint);
		vec3 viewVec = normalize(camPos - posOut);
		float diff = max(dot(normOut, lightDir), 0.0);
		vec3 h = normalize(normOut + viewVec);
		vec3 spec = 1.0*pow(max(dot(h, lightDir), 0.0), 64.0)*specTint;
		vec3 fresnel = 0.08*vec3(pow(max(1.0-dot(viewVec, normOut), 0.0),8.0))*specTint;
        
		finalCol =  col*(diff + AMBIENT) + spec + fresnel ;
	}
	else { fragColor = vec4(0.0); return; }   // 背景(レイミス)は実 alpha=0 で純粋に透過(クロマキー不使用)

	fragColor = vec4(pow(finalCol,vec3(2.2)), 1.0);   // ヒット面は白ハイライト含め全て不透明で残す
}`
}
,
{
  name: "Spicy Plasma (DsffWM)",
  ch: ["","","",""],
  src: `const float motionBlur = 0.3;
const float aa = 0.6;
const vec3 col1 = vec3(13., 45., 140.)/100.;
const vec3 col2 = vec3(255., 20., 50.)/255.;
const vec3 col3 = vec3(21., 191., 112.)/600.;
const vec3 col4 = vec3(0.35, 1., 0.7)*0.65;
const float speed = 0.1;

// AA = 0, 1, 2
#define AA 1

float sigmoid(float x)
{
    return 1.*x/(abs(x)+1.);
}
vec3 sigmoid(vec3 x)
{
    return x/(abs(x)+vec3(1.));
}
vec3 saturate(vec3 x)
{
    return clamp(x, 0., 1.);
}
vec3 blend(float x, vec3 c)
{
    c = pow(c, vec3(x+2.));
    return mix(x*c, x*(1.-c), step(x, 0.));
}

float f(vec2 p, float t, vec4 o, vec4 o1, float s, vec4 scale)
{
    vec4 i0 = cos(t+o)*vec4(o.xw, o1.xw);
    vec4 i1 = sin(t+o1)*vec4(o.xw, o1.xw);
    vec4 x0 = i0*s*sin(scale*length(p*o.xy+4.*scale.zw)+o.z+t*o.w);
    vec4 x1 = i1*s*sin(scale*length(p*o1.xy)+o1.z+t*o1.w);
    return sigmoid(dot(x0+x1, vec4(1.)));
}

vec3 scene(float t, float emphasis, vec2 uv)
{
    // "Beautiful" randomness, tuned for aesthetics, not performance
    vec2 p = uv * 3.;
    t += 160.;
    t *= speed;
    vec4 scale = vec4(sin(t*vec3(0.25, .5, .75)), cos(t*.95))*.25+.5;
    float s0 = f(p, t, vec4(6.,9.,2.,1.5), vec4(2.,9.,7.,3.), .25, scale);
    float s1 = f(p, t, vec4(2.,6.5,1.5,4.0), vec4(3.,2.5,3.8,1.6), .5, scale);
    float s2 = sigmoid(s0/s1)*0.5;
    float s3 = f(p, t, vec4(2.,9.,7.,3.), vec4(6.,3.,2.,1.5), .125, scale);
    float s6 = f(p*1.5, t, vec4(6.,4.,8.,2.5), vec4(3.2,1.6,9.7,7.9), .25, scale);
    float s7 = f(p*1.3, t, vec4(2.,6.5,1.5,4.0), vec4(3.,2.5,3.8,1.6), .5, scale);
    float s8 = sigmoid(s6/s7+s0)*0.7;
    
    vec3 c = vec3(sigmoid((blend(s8,col1)+blend(s2,col2)+blend(s1,col3)+s7*1.)*1.1)*.7+.5);
    float grad = sigmoid(pow(length(uv*2.-1.)+s3*.3, 5.))*1.5;
    float accent = 1.-sigmoid((pow(2.5, abs(sigmoid(s8+s0+s1))-1.)-.45-(emphasis*0.1))*1000./(1.+30.*grad+20.*emphasis));
    c = mix(c, c.r*.3+col4*.8, accent);
    return clamp(vec3(c), 0., 1.);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Normalized pixel coordinates (from 0 to 1)
    vec2 uv = fragCoord/iResolution.xx;
    float aaScale = 1./iResolution.x;

    vec2 mouse = uv-iMouse.xy/iResolution.xx;
    float emp = sigmoid(1./pow(length(mouse*1.), 1.8)*.02);

    // Time varying pixel color
    vec3 col = scene(iTime, emp, uv);
    #ifdef AA
    #if AA >= 1
    col     += scene(iTime + motionBlur*0.001, emp, uv + aaScale*aa*vec2(0.,1.))
             + scene(iTime + motionBlur*0.002, emp, uv + aaScale*aa*vec2(1.,0.));
    #endif
    #if AA >= 2
    col     += scene(iTime + motionBlur*0.003, emp, uv + aaScale*aa*vec2(0.,-1.))
             + scene(iTime + motionBlur*0.004, emp, uv + aaScale*aa*vec2(-1.,0.))
             + scene(iTime + motionBlur*0.005, emp, uv + aaScale*aa*vec2(1.,1.))
             + scene(iTime + motionBlur*0.006, emp, uv + aaScale*aa*vec2(1.,-1.))
             + scene(iTime + motionBlur*0.007, emp, uv + aaScale*aa*vec2(-1.,1.));
    col /= 8.;
    #elif AA >= 1
    col /= 3.;
    #endif
    #endif

    // Output to screen
    fragColor = vec4(vec3(col), 1.0);
}`
}
,
{
  name: "Ice Cave Spikes (w3GSR3)",
  ch: ["","","",""],
  src: `// Ice Cave Spikes (w3GSR3) — 原作 "Tunnel Variation #7" に per-cell ランダムネスと
//   尖り(スパイク鋭化)を追加。八面体タイリング + ツイストトンネル。
// @param uSpike 0..2.5 = 1.4
// @param uChaos 0..2 = 1.0
// @param uSpeed 0..3 = 1.0
// @param uEmbed 0..1.5 = 1.0
uniform float uSpike; uniform float uChaos; uniform float uSpeed; uniform float uEmbed;

float sdOctahedron(vec3 p, float s){
    p = abs(p);
    float m = p.x + p.y + p.z - s;
    vec3 q;
         if( 3.0*p.x < m ) q = p.xyz;
    else if( 3.0*p.y < m ) q = p.yzx;
    else if( 3.0*p.z < m ) q = p.zxy;
    else return m*0.57735027;
    float k = clamp(0.5*(q.z-q.y+s),0.0,s);
    return length(vec3(q.x,q.y-s+k,q.z-k));
}

// 安価な 3D ハッシュ (per-cell の乱数)
float hash13(vec3 p){
    p = fract(p*0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
}

void mainImage(out vec4 o, vec2 fragCoord) {
    float z = 0.0;
    o = vec4(0.0);
    vec2 u = (fragCoord - iResolution.xy * 0.5) / iResolution.y;
    float T = iTime * uSpeed;

    for (float i = 1.0; i < 90.0; i++) {
        vec4 p = z * vec4(normalize(vec3(u, 1.)), 0.0);
        p.z += 1.5 * T;                              // 前進
        float angle = 0.15 * p.z + T / 4.;            // ツイスト
        mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
        p.xy = rot * p.yx;
        p.xy -= vec2(-0.7, 0.2) + sin(T) / 5.;

        vec4 originalP = p;
        p = p * 0.25;

        // per-cell 乱数 (スケール後の格子)
        vec3 cellId = round(p.xyz);
        float rnd  = hash13(cellId);
        float rnd2 = hash13(cellId + 3.7);
        float rnd3 = hash13(cellId + 8.1);

        p = abs(p - round(p));   // 鏡映タイリング

        // per-cell 位相をずらした歪み + 鋭化
        vec4 distort = sin(18. * p + -.1 + rnd * 6.2831 * uChaos);
        float ridge = sin(sin(originalP.x) + (distort.x * originalP.y + .3 * distort.z));
        // ridge を鋭くして棘状に (uSpike が高いほど尖る)
        ridge = sign(ridge) * pow(abs(ridge), mix(1.0, 0.4, clamp(uSpike * 0.5, 0.0, 1.0)));

        float spikeAmt = (0.35 + 0.55 * rnd2 * uChaos) * uSpike;
        float octS = mix(0.22, 0.10, clamp(uSpike - 1.0, 0.0, 1.0));   // 尖り強で八面体を細く
        float shape1 = sdOctahedron(p.xyz, octS) + spikeAmt * ridge;
        float d = abs(shape1);

        float iceTone = 0.65 + 0.35 * cos(.3 * originalP.z + 2.0 * p.x);
        vec3 baseColor = vec3(0.4, 0.75, 1.2) * iceTone;
        // per-cell の淡い色ゆらぎ
        baseColor *= 0.75 + 0.5 * vec3(rnd, rnd2, rnd3);

        // めり込み半透明 (WdVXRm 参考): 至近サンプル (z 小) の寄与を抑え、
        //   カメラがめり込んだ手前の壁を透過させて奥の構造を見せる。uEmbed=0 で従来通り。
        float nearFade = mix(1.0, smoothstep(0.0, 0.5, z), clamp(uEmbed / 1.5, 0.0, 1.0));
        o += vec4(baseColor, 1.0) / max(d, 0.0002) * nearFade;
        z += 0.45 * d + 0.0001;
    }
    o = tanh(o / 30000.);
}
`
},
{
  name: "Strange Lab Goop (dt2cD3)",
  ch: ["","","",""],
  src: `// Strange Lab Goop (dt2cD3) — 原作 2-pass。Buffer A はフィードバック無しの手続き fbm
//   高さ場なので単一パスにインライン化。mip 相当は多点ぼかしで近似、cubemap 反射は手続き env で代替。
// @param uEnv 0..1.5 = 1.0
// @param uSpeed 0..3 = 1.0
uniform float uEnv; uniform float uSpeed;

vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2  C = vec2(1.0/6.0, 1.0/3.0);
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 =   v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );
  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1. + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute( permute( permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
  float n_ = 1.0/7.0;
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
}
float fbm3(vec3 x) {
  float v = 0.0, a = 0.5;
  vec3 shift = vec3(100);
  for (int i = 0; i < 3; ++i) { v += a * snoise(x); x = x * 2.0 + shift; a *= 0.5; }
  return v;
}

// 高さ場 (原作 Buffer A の式をそのまま)
float heightAt(vec2 c){
  float tt = 0.1 * iTime * uSpeed;
  float r = fbm3(vec3(c*0.001, fbm3(vec3(c*0.001, fbm3(vec3(0.001*c, tt + fbm3(vec3(c*0.0001, tt))))))));
  float ramp = 0.5 + 0.5 * r;
  ramp = smoothstep(0.0, 1.0, smoothstep(0.0, 1.0, ramp));
  ramp = smoothstep(0.0, 1.0, smoothstep(0.0, 1.0, ramp));
  return ramp;
}
// mip 近似: 2^lod の範囲を多点平均
float heightBlur(vec2 c, float lod){
  float r = pow(2.0, lod);
  float s = heightAt(c);
  s += heightAt(c+vec2(r,0.0));  s += heightAt(c+vec2(-r,0.0));
  s += heightAt(c+vec2(0.0,r));  s += heightAt(c+vec2(0.0,-r));
  s += heightAt(c+vec2(r,r));    s += heightAt(c+vec2(-r,-r));
  return s / 7.0;
}
// cubemap の代替: 手続きスタジオ env
vec3 envAt(vec3 dir){
  float up = dir.y*0.5 + 0.5;
  vec3 sky = mix(vec3(0.12,0.15,0.22), vec3(0.9,0.95,1.05), up);
  float hl = smoothstep(0.55, 1.0, dir.y) + 0.5*smoothstep(0.9, 1.0, dir.x*0.5+0.5);
  return sky + hl * 0.6 * uEnv;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 fc = fragCoord.xy;
  float height = heightAt(fc);
  float occlusion = 0.0;
  for(float i=2.0;i<=5.0;i++){
    float mh = heightBlur(fc, i);
    occlusion += 4.0 * max(mh - height, 0.0) * (1.0 / i);
  }
  vec3 col = mix(vec3(0.8,0.6,0.4), vec3(1.0), height) * (1.0 - occlusion);
  vec3 totalNormal = vec3(0.0);
  for(float i=3.0;i<=5.0;i++){
    float texelStep = pow(2.0, i);
    vec3 n = normalize(vec3(
      5.0 * (heightBlur(fc+vec2(texelStep,0.0), i) - heightBlur(fc-vec2(texelStep,0.0), i)),
      5.0 * (heightBlur(fc+vec2(0.0,texelStep), i) - heightBlur(fc-vec2(0.0,texelStep), i)),
      1.0));
    totalNormal += n;
  }
  vec3 normal = normalize(totalNormal);
  vec3 rayDir = normalize(vec3((fc - iResolution.xy/2.0)/iResolution.y, 1.0));
  vec3 envSampleDir = reflect(rayDir, normal);
  vec3 envSample = envAt(envSampleDir);
  vec3 applied = 0.6*col + 0.4*col*envSample;
  fragColor = vec4(applied, 1.0);
}
`
},
{
  name: "Gyroid Cavern",
  ch: ["","","",""],
  src: `// Gyroid Cavern — 三重周期の gyroid 極小曲面を空間充填した SDF 洞窟。
//   内側を漂う定点カメラを全方位(360°天地左右)に滑らかタンブルさせ、
//   グリッチ(水平スライス横ずれ)+ めり込み半透明(手前を透過して奥を見せる)を付与。
// @param uOrbit 0..3 = 1.0
// @param uWander 0..2 = 1.0
// @param uRadius 0.2..1.5 = 0.55
// @param uGlitch 0..1 = 0.15
// @param uEmbed 0..1.5 = 1.0
uniform float uOrbit; uniform float uWander; uniform float uRadius; uniform float uGlitch; uniform float uEmbed;

#define PI 3.14159265

void pR(inout vec2 p, float a){ p = cos(a)*p + sin(a)*vec2(p.y, -p.x); }

// glitch 用ハッシュ
float hash(vec2 p){
    p = fract(p*vec2(123.34, 456.21));
    p += dot(p, p+45.32);
    return fract(p.x*p.y);
}
vec2 hash22(vec2 p){ return vec2(hash(p), hash(p+19.7)); }
// coloring 用 value noise
float hash13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float noise31(vec3 x){
    vec3 p = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(hash13(p+vec3(0,0,0)),hash13(p+vec3(1,0,0)),f.x),
                   mix(hash13(p+vec3(0,1,0)),hash13(p+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash13(p+vec3(0,0,1)),hash13(p+vec3(1,0,1)),f.x),
                   mix(hash13(p+vec3(0,1,1)),hash13(p+vec3(1,1,1)),f.x),f.y),f.z);
}

float hitEps = 0.0015;

struct Model { float d; };
Model newModel(){ return Model(1e9); }

// gyroid シェル SDF (両面の薄い膜 → その間が洞窟)
float gyr(vec3 p){
    float s = 4.6;
    vec3 q = (p + vec3(1.3, 0.7, 0.5)) * s;   // 原点を膜上に置かないようオフセット
    float g = dot(sin(q), cos(q.zxy));
    float d = (abs(g) - 0.42) / s;            // |g|<0.42 が壁、外が開空間(洞窟)
    // 細かいディテールで壁に凹凸(ヌメっとした有機質感)
    vec3 q2 = p * 12.0;
    d += 0.02 * dot(sin(q2), cos(q2.zxy));
    return d;
}

Model map(vec3 p){
    Model model = newModel();
    // ---- ランダムグリッチ: 時空ブロックで水平スライスを横ずれ ----
    if (uGlitch > 0.001) {
        float tg = floor(iTime * 5.0);   // グリッチ更新をゆっくり(ちらつき低減)
        float slice = floor(p.y * 6.0);
        vec2 cell = vec2(slice, tg);
        vec2 g = hash22(cell + 11.3) - 0.5;
        float burst = step(0.86, hash(cell + 5.0));
        float amt = uGlitch * (1.0 + burst * 4.0);
        p.x += g.x * amt;
        p.z += g.y * amt * 0.7;
    }
    model.d = gyr(p);
    return model;
}

vec3 calcNormal(vec3 pos){
    vec3 n = vec3(0.0);
    for( int i=0; i<4; i++ ){
        vec3 e = 0.5773*(2.0*vec3((((i+3)>>1)&1),((i>>1)&1),(i&1))-1.0);
        n += e*map(pos+0.0005*e).d;
    }
    return normalize(n);
}

mat3 basisMatrix(vec3 forward, vec3 up){
    vec3 ww = normalize(forward);
    vec3 uu = normalize(cross(up,ww));
    vec3 vv = normalize(cross(ww,uu));
    return mat3(-uu, vv, ww);
}

struct Hit { Model model; vec3 pos; float len; bool sky; };

Hit march(vec3 origin, vec3 rayDir, float maxDist){
    vec3 p; float len = 0.0, dist = 0.0; bool sky = false; Model model;
    for (float i = 0.; i < 150.; i++){
        len += dist;
        p = origin + len * rayDir;
        model = map(p);
        dist = model.d;
        if (dist < hitEps) break;
        if (len >= maxDist){ sky = true; break; }
    }
    return Hit(model, p, len, sky);
}

// gyroid 位置ベースの濡れた有機カラー
vec4 shade(Hit hit){
    vec3 p = hit.pos;
    float m = noise31(p*3.5);
    // ティール〜パープルの色相を位置で揺らす
    float h = 0.5 + 0.5*sin(p.x*1.3 + p.z*1.1 + p.y*0.7);
    vec3 base = mix(vec3(0.08,0.34,0.40), vec3(0.34,0.12,0.42), h);
    base = mix(base, vec3(0.85,0.95,0.9), smoothstep(0.55, 0.9, m)*0.45);  // 濡れ斑ハイライト
    base *= 0.75 + 0.5*noise31(p*9.0);                                     // 微細な陰影
    return vec4(base, 1.0);
}

vec3 lightHit(Hit hit, vec3 rayDir, vec3 sunPos, vec3 sunColor, vec3 skyColor, vec3 bgCol){
    if (hit.sky) {
        return mix(bgCol, skyColor * 0.6, clamp(rayDir.y * 0.5 + 0.5, 0.0, 1.0));
    }
    vec4 material = shade(hit);
    vec3 acc = material.rgb;
    vec3 nor = calcNormal(hit.pos);
    vec3 col = acc * (0.12 + 0.55 * max(nor.y + 0.3, 0.0)) * skyColor;   // アンビエント下限で真っ黒防止
    vec3 sunDir = normalize(sunPos - hit.pos);
    col += smoothstep(0.2, 1.0, dot(nor, sunDir)) * sunColor * acc * 0.85;
    // 濡れた光沢: スペキュラ
    vec3 h = normalize(sunDir - rayDir);
    col += pow(max(dot(nor, h), 0.0), 40.0) * sunColor * 0.5;
    vec3 sOrigin = hit.pos + nor * 0.01;
    if (dot(nor, sunDir) > 0.0 && !march(sOrigin, sunDir, 5.0).sky) {
        col *= 0.55;
    }
    float fog = 1.0 - exp((hit.len - 2.4) * -0.5);
    return mix(col, bgCol, clamp(fog, 0.0, 1.0));
}

// ===== 単一パス: 内側タンブルカメラ + 直接ライティング =====
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 p = (-iResolution.xy + 2.* fragCoord) / iResolution.y;

    // ---- 洞窟の内側に置いたカメラを、滑らかに全方位(360°天地左右)タンブルさせる ----
    float t = iTime * 0.09 * uOrbit;   // タンブルをゆっくりに(ちらつき低減)。beat モードは拍ジャンプがそのまま効く
    vec3 center = vec3(0.0, 0.0, 0.0);
    vec3 camPos = center + uRadius * normalize(vec3(sin(t*0.4) + 0.3,
                                                    0.5*sin(t*0.33),
                                                    cos(t*0.4) + 0.2));
    float yaw   = t + 0.6 * sin(t*0.7);
    float pitch = 1.45 * sin(t*0.53) * clamp(uWander, 0.2, 1.0);
    float roll  = 0.5 * t + 0.7 * sin(t*0.31);
    vec3 lookDir = vec3(cos(pitch)*sin(yaw), sin(pitch), cos(pitch)*cos(yaw));
    vec3 upBase = vec3(0.0, 1.0, 0.0);
    vec3 upR = normalize(upBase*cos(roll)
                       + cross(lookDir, upBase)*sin(roll)
                       + lookDir*dot(lookDir, upBase)*(1.0 - cos(roll)));

    mat3 camMat = basisMatrix(lookDir, upR);
    vec3 rayDir = normalize(camMat * vec3(p.xy, 2.2));
    vec3 origin = camPos;

    vec3 sunPos   = vec3(5.0, 5.0, -5.0);
    vec3 sunColor = vec3(8.10, 6.00, 4.20) / 5.0;
    vec3 skyColor = vec3(0.50, 0.70, 1.00);
    vec3 bgCol    = skyColor * 0.22;

    Hit hit = march(origin, rayDir, 16.0);
    vec3 col = lightHit(hit, rayDir, sunPos, sunColor, skyColor, bgCol);

    // ---- めり込み半透明: 最初のヒットが至近なら手前を透過して奥を見せる ----
    float embed = pow(1.0 / (hit.len + 1.0), 6.0) * uEmbed;
    if (!hit.sky && embed > 0.02) {
        Hit hit2 = march(hit.pos + rayDir * 0.04, rayDir, 16.0);
        vec3 col2 = lightHit(hit2, rayDir, sunPos, sunColor, skyColor, bgCol);
        col = mix(col, col2, clamp(embed, 0.0, 0.9));
    }

    col *= 1.25;
    col = pow(max(vec3(0.0), col), vec3(0.4545));
    fragColor = vec4(col, 1.0);
}
`
}
,
{
  name: "Jungle Burrow (Wd23RD)",
  ch: ["","","",""],
  src: `// Jungle (Wd23RD) — 空間充填フラクタルの中をカメラが飛び抜ける。per-cell 乱数で
//   セルごとに折り畳み位相と色を変えてランダムネスを付与。さらに WdVXRm "Ghostly Cavern"
//   を参考に、カメラがシェイプにめり込んでいる(最初のヒットが近い)ときは半透明にして奥を透かす。
// @param uChaos 0..1.5 = 0.6
// @param uEmbed 0..1.5 = 1.0
// @param uSpeed 0..3 = 1.0
uniform float uChaos; uniform float uEmbed; uniform float uSpeed;

mat2 rotate(float a){ return mat2(cos(a), sin(a), -sin(a), cos(a)); }

float pattern(vec2 p){ p *= 15.0; return abs(sin(p.x) + sin(p.y)); }

float boxmap(vec3 p){
    p *= 0.3;
    vec3 m = pow(abs(normalize(p)), vec3(20));
    vec3 a = vec3(pattern(p.yz), pattern(p.zx), pattern(p.xy));
    return dot(a,m)/(m.x+m.y+m.z);
}

vec3 smin(vec3 a, vec3 b){
    float k = 0.08;
    vec3 h = clamp( 0.5 + 0.5*(b-a)/k, 0.0, 1.0 );
    return mix( b, a, h ) - k*h*(1.0-h);
}
vec3 sabs(vec3 p){ return p - 2.0 * smin(vec3(0), p); }

// per-cell 乱数
float hash13(vec3 p){
    p = fract(p*0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
}

float map(in vec3 p){
    // 単位セル ID (乱数用) — mod で折り畳む前に取得
    vec3 cellId = floor(p);
    float rc = hash13(cellId);
    float ph = (rc - 0.5) * uChaos * 2.5;      // セルごとの折り畳み位相ずれ

    float s = 3.7;
    float amp = 1.0/s;
    float c = 0.5;
    p = sabs(mod(p, c * 2.0) - c);
    float de = 100.;
    for(int i=0; i<3; i++){
        float T = iTime * uSpeed;
        p.xy *= rotate(0.4 + sin(T*0.2 + 0.3*sin(T*0.4) + ph)*0.2);
        p.yz *= rotate(0.4 + sin(T*0.3 + 0.5*sin(T*0.5) + ph)*0.2);
        p = sabs(p);
        p *= s;
        p -= vec3(0.2*p.z, 0.6*p.x, 0.4) * (s - 1.0);
        de = abs(length(p*amp) - 0.2);
        amp /= s;
    }
    return de + boxmap(p) * 0.02 - 0.01;
}

vec3 calcNormal(vec3 p){
    vec2 e = vec2(1, -1) * 0.001;
    return normalize(
        e.xyy*map(p+e.xyy)+e.yyx*map(p+e.yyx)+
        e.yxy*map(p+e.yxy)+e.xxx*map(p+e.xxx)
    );
}

vec3 doColor(vec3 p){
    // per-cell の色ゆらぎ (黄緑〜緑〜ティール)
    float rc  = hash13(floor(p) + 2.1);
    float rc2 = hash13(floor(p) + 7.3);
    vec3 tint = mix(vec3(0.2,0.9,0.2), vec3(0.75,0.9,0.15), rc);
    tint = mix(tint, vec3(0.12,0.8,0.7), rc2 * 0.6);
    return tint * boxmap(p);
}

vec3 shadeHit(vec3 ro, vec3 rd, float t, vec3 bg){
    vec3 p = ro + rd * t;
    vec3 nor = calcNormal(p);
    vec3 li = normalize(vec3(1));
    vec3 c = doColor(p);
    c *= clamp(dot(nor, li), 0.3, 1.0);
    c *= max(0.5 + 0.5 * nor.y, 0.0);
    c += pow(clamp(dot(reflect(normalize(p - ro), nor), li), 0.0, 1.0), 20.0);
    c.x += 1.0 - exp(-t*t*0.15);
    c = clamp(c, 0.0, 1.0);
    return mix(bg, c, exp(-t*t*0.6));
}

void mainImage( out vec4 fragColor, in vec2 fragCoord ){
    vec2 p = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
    vec3 ro = vec3(0.2, 0.1, 0.5) + iTime * 0.1 * uSpeed;
    vec3 rd = normalize(vec3(p, 2));
    float T = iTime * uSpeed;
    rd.xz *= rotate(sin(T*0.3)*0.6);
    rd.yz *= rotate(sin(T*0.2)*0.6);
    rd.xy *= rotate(sin(T*0.05));
    vec3 bg = mix(vec3(0.3, 0.7, 0.8), vec3(0.1, 0.1, 0.2), smoothstep(0.3, 2.5, length(p)));

    // --- 1本目のレイマーチ ---
    float t = 0.1, d = 1.0;
    for(int i = 0; i < 300; i++){
        d = map(ro + rd * t);
        t += 0.1 * d;
        if(d < 0.001 || t > 5.0) break;
    }
    vec3 col = bg;
    float firstT = t;
    bool hit1 = d < 0.001;
    if(hit1) col = shadeHit(ro, rd, t, bg);

    // --- めり込み半透明 (WdVXRm 参考) ---
    //   最初のヒットが近い = カメラがシェイプにめり込んでいる → 手前の面を半透明にして奥を透かす。
    float embed = pow(1.0 / (firstT + 1.0), 8.0) * uEmbed;   // firstT 小 → embed 大
    if(hit1 && embed > 0.02){
        float t2 = firstT + 0.06, d2 = 1.0;
        for(int i = 0; i < 220; i++){
            d2 = map(ro + rd * t2);
            t2 += 0.1 * d2;
            if(d2 < 0.001 || t2 > 5.0) break;
        }
        vec3 col2 = bg;
        if(d2 < 0.001) col2 = shadeHit(ro, rd, t2, bg);
        col = mix(col, col2, clamp(embed, 0.0, 0.92));   // めり込むほど奥が見える
    }

    col = pow(col, vec3(0.8));
    col = mix(col, vec3(col.x), clamp(sin(iTime*0.5 + sin(iTime*0.2)*0.5)*2.0 - 1.0, 0.0, 1.0));
    fragColor = vec4(col, 1.0);
}
`
}
,
{
  name: "4D Julia Fractal (tt2fRw)",
  ch: ["","","",""],
  src: `// 4D Julia Fractal Animation (tt2fRw) — 4D クォータニオン Julia 集合のレイマーチ。
//   原作に忠実。VJ 向けに速度パラメータとアスペクト補正(横長での歪み防止)を追加。
// @param uSpeed 0..3 = 1.0
uniform float uSpeed;

vec3 cameraPosition;
mat3 cameraMatrix;
vec4 offset;
void qFold (inout vec4 a) {
    a = vec4(a.x*a.x-a.y*a.y-a.z*a.z-a.w*a.w, 2.0*a.x*a.y, 2.0*a.x*a.z, 2.0*a.x*a.w);
}
float map (vec3 pos) {
    vec4 z = vec4(pos.xyz, 0.0);
    float md2 = 1.0;
    float radius2 = dot(z, z);
    for (int i = 0; i < 25; i ++) {
        qFold(z);
        z += offset;
        md2 *= 4.0 * radius2;
        radius2 = dot(z, z);
        if (radius2 > 4.0) break;
    }
    return 0.25 * sqrt(radius2 / md2) * log(radius2) - 0.001;
}
vec3 xDir = vec3(0.000001, 0, 0);
vec3 yDir = vec3(0, 0.000001, 0);
vec3 zDir = vec3(0, 0, 0.000001);
vec3 surfaceNormal (vec3 pos) {
    vec3 normal = vec3(
        map(pos + xDir) - map(pos - xDir),
        map(pos + yDir) - map(pos - yDir),
        map(pos + zDir) - map(pos - zDir)
    );
    return normalize(normal);
}
vec3 lightDirection;
vec3 tint;
float gHit;   // 1.0=ヒット / 0.0=背景 (Slot B で背景を透過させる alpha 用)
vec3 trace (vec3 origin, vec3 direction) {
    float totalDistance = 0.0;
    gHit = 0.0;
    for (float steps = 0.0; steps < 100.0; steps ++) {
        vec3 pos = origin + direction * totalDistance;
        float distance = map(pos);
        totalDistance += distance;
        if (dot(pos, pos) > 25.0) break;
        if (distance < 0.002) {
            vec3 normal = surfaceNormal(pos);
            float diffuse = max(-dot(normal, lightDirection), 0.0);
            float specular = -dot(reflect(direction, normal), lightDirection);
            specular = max(pow(specular, 5.0), 0.0);
            float shade = diffuse * 0.7 + specular * 0.3;
            gHit = 1.0;
            return shade * tint;
        }
    }
    return vec3(0.1);   // 背景色 (Slot A ではこの色 / Slot B では alpha=0 で透過)
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    float t = iTime * uSpeed;
    cameraPosition = 1.8 * vec3(cos(t), 0, sin(t));
    cameraMatrix = mat3(cos(t+3.14/2.0), 0, -sin(t+3.14/2.0), 0, 1, 0, sin(t+3.14/2.0), 0, cos(t+3.14/2.0));
    offset = vec4(cos(t), sin(t), cos(t * 2.0 + 3.14), sin(t * 1.61 + 3.14)) * 0.6;
    lightDirection = vec3(cos(t + 3.14), 0.0, sin(t + 3.14));
    tint = vec3(cos(t / 20.0 * 3.1415 * 2.0) + 1.0,
                cos(t / 20.0 * 3.1415 * 2.0 + 2.0 * 3.1415 / 3.0) + 1.0,
                cos(t / 20.0 * 3.1415 * 2.0 + 4.0 * 3.1415 / 3.0) + 1.0) / 2.0;

    // アスペクト補正 (y 基準・原作の反転 orientation を維持)。1:1 では原作と同一。
    vec2 uv = -(2.0 * fragCoord - iResolution.xy) / iResolution.y;
    vec3 ray = normalize(vec3(uv, 1.0)) * cameraMatrix;

    vec3 col = trace(cameraPosition, ray);
    fragColor = vec4(col, gHit);   // 背景 alpha=0 → Slot B で透過
}
`
}
,
{
  name: "Glitch Aesthetic (wfjfRm)",
  ch: ["","","",""],
  src: `// 20250921 Glitch Aesthetic (wfjfRm) — モーフィングする SDF ブロブ(八面体/四面体/トーラスの
//   スムーズ結合)を hexatunnel パターンでテクスチャリング。原作に忠実。
//   VJ: 速度パラメータ + 背景 alpha=0 (Slot B に置くと背景が透過して下の Slot A が出る)。
// @param uSpeed 0..3 = 1.0
uniform float uSpeed;

float T;   // = iTime * uSpeed (全体の時間)

float sdOctahedron(vec3 p, float s) {
    p = abs(p);
    return (p.x + p.y + p.z - s) * 0.57735027;
}
float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xy) - t.x, p.z);
    return length(q)-t.y;
}
float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) -b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}
float sdTetrahedron( vec3 p, float g ) {
    float angle = 2.86 + T * 0.75;
    float c = cos(angle);
    float s = sin(angle);
    mat2 rot = mat2(c, -s, s, c);
    p.xz = rot * p.xz;
    const vec3 n1 = normalize(vec3( 1.0, 1.0, 1.0));
    const vec3 n2 = normalize(vec3( 1.0,-1.0,-1.0));
    const vec3 n3 = normalize(vec3(-1.0, 1.0,-1.0));
    const vec3 n4 = normalize(vec3(-1.0,-1.0, 1.0));
    return max(max(dot(p,n1), dot(p,n2)), max(dot(p,n3), dot(p,n4))) - g;
}
float opSmoothUnion(float d1, float d2, float k) {
    float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
    return mix(d2, d1, h) - k * h * (1.0 - h);
}
float map(vec3 p) {
    float res = 1e9;
    for (int i = 0; i < 15; i++) {
        float fi = float(i);
        float time = T * (0.5 + fi * 0.1);
        vec3 center = vec3(
            sin(time + fi * 1.57),
            cos(time * 0.8 + fi * 2.0),
            sin(time * 1.2 - fi * 1.0)
        ) * 1.5;
        vec3 p_local = p - center;
        float rot_angle = T * (1.0 + fi * 0.3);
        p_local.xz *= mat2(cos(rot_angle), -sin(rot_angle), sin(rot_angle), cos(rot_angle));
        p_local.xy *= mat2(cos(rot_angle*0.7), -sin(rot_angle*0.7), sin(rot_angle*0.7), cos(rot_angle*0.7));
        float shape_dist;
        if(i<6){
            shape_dist = max(sdOctahedron(p_local, 0.7), -sdBox(p_local, vec3(0.2, 0.3, 0.5)));
        } else if(i>=7 && i<10) {
            shape_dist = min(sdTetrahedron(p_local, 0.3), sdBox(p_local, vec3(0.5, 0.4, 0.3)));
        } else {
            shape_dist = max(sdTorus(p_local, vec2(0.3,0.2)), -sdBox(p_local, vec3(0.4, 0.5, 0.25)));
        }
        res = opSmoothUnion(res, shape_dist, 0.75);
    }
    return res;
}
vec4 hexatunnel(vec2 r, vec2 f ) {
    vec4 o = vec4(0.0);
    for(float i=0.; i<2.5; i+=.01) {
        float z;
        vec2 p = (f.xy*2.-r)/r.y*i, v;
        p /= .2+sqrt(z=max(1.-dot(p,p),0.))*.63;
        p.y += fract(ceil(p.x=p.x/.85+T)*.5)+T*.2;
        v = abs(fract(p)-.5);
        o += vec4(2,3,5,1)/2e3*z/(abs(max(v.x*1.5+v,v+v).y-1.)+.1-i*.09);
    }
    o = tanh(o*o*o);
    return o;
}
vec3 calcNormal(vec3 p) {
    vec2 e = vec2 (0.001, 0.0);
    return normalize(vec3(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}
float calcShadow(vec3 p, vec3 lightDir) {
    float t = 0.01;
    for (int i = 0; i < 50; i++) {
        float d = map(p + lightDir * t);
        if (d < 0.001) return 0.3;
        t += d;
        if (t > 10.0) break;
    }
    return 1.0;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    T = iTime * uSpeed;
    vec2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;

    float angle = T * 0.15;
    vec3 ro = vec3(sin(angle) * 5.0, 1.5, cos(angle) * 8.0);
    vec3 ta = vec3(0.0, 0.0, 0.0);
    vec3 ww = normalize(ta - ro);
    vec3 uu = normalize(cross(vec3(0.0, 1.0, 0.0), ww));
    vec3 vv = cross(ww, uu);
    vec3 rd = normalize(uv.x * uu + uv.y * vv + 2.0 * ww);

    vec3 col = vec3(0.325);   // 背景色 (Slot A ではこの色 / Slot B では alpha=0 で透過)
    float alpha = 0.0;        // 背景=透過 / ヒット=不透明

    float t = 0.0;
    for (int i = 0; i < 100; i++) {
        vec3 p = ro + rd * t;
        float d = map(p);
        if(d < 0.001) {
            float shininess = 120.0;
            vec3 normal = calcNormal(p);
            vec3 lightPos = vec3(2.0, 3.0, 4.0);
            vec3 lightDir = normalize(lightPos - p);
            float shadow = calcShadow(p, lightDir);
            float diff = max(0.0, dot(normal, lightDir));
            float ambient = 0.2;
            vec2 r = iResolution.xy;
            vec4 c = hexatunnel(r, fragCoord);
            col = c.rgb * (diff * shadow + ambient);
            alpha = 1.0;
            break;
        }
        t += d;
        if (t > 20.0) break;
    }
    fragColor = vec4(col, alpha);
}
`
}
,
{
  name: "EvilSeed (llBGRd)",
  ch: ["","","",""],
  src: `// EvilSeed (llBGRd) — グリッド状に回転する花/種のレイマーチ。
//   改変: 中心の縦シリンダ(棒/茎 s-0.1)を削除。テクスチャ入力は手続きノイズに置換して自己完結化。
// @param uSpeed 0..3 = 1.0
uniform float uSpeed;

const float pi = 3.14159;
float T;   // = iTime * uSpeed

mat3 xrot(float t){ return mat3(1.0,0.0,0.0, 0.0,cos(t),-sin(t), 0.0,sin(t),cos(t)); }
mat3 yrot(float t){ return mat3(cos(t),0.0,-sin(t), 0.0,1.0,0.0, sin(t),0.0,cos(t)); }
mat3 zrot(float t){ return mat3(cos(t),-sin(t),0.0, sin(t),cos(t),0.0, 0.0,0.0,1.0); }

float btime = 1.0;
float bspeed = 10.0;

// 手続きノイズ(元シェーダの iChannel0 テクスチャの代替)
float hashT(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float texN(vec2 p){
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hashT(i), hashT(i+vec2(1,0)), f.x),
               mix(hashT(i+vec2(0,1)), hashT(i+vec2(1,1)), f.x), f.y);
}

float map(vec3 pos){
    float dir = 1.0;
    vec3 id = floor(pos);
    pos.y += sin(T + id.x*10.0 + id.z*10.0);
    pos = fract(pos) * 2.0 - 1.0;
    pos *= yrot(T*btime*4.0*dir);
    float s = length(pos.xz);
    float k = atan(pos.z, pos.x);
    float mr = 0.9;
    float r = mix(0.8, 1.0, 0.5 + 0.5 * sin(s/mr*dir*bspeed + k*10.0));
    float p = mr * r;
    float e = 1.0 - s/p;
    vec3 c = vec3(pos.x, clamp(pos.y, -0.02*e, 0.02*e), pos.z);
    return max(length(c-pos), s-p);   // 棒(中心の縦シリンダ s-0.1)を削除
}

vec3 normal(vec3 p){
    vec3 o = vec3(0.01, 0.0, 0.0);
    return normalize(vec3(map(p+o.xyy) - map(p-o.xyy),
                          map(p+o.yxy) - map(p-o.yxy),
                          map(p+o.yyx) - map(p-o.yyx)));
}

float trace(vec3 o, vec3 r){
    float t = 0.0;
    for (int i = 0; i < 16; ++i){
        vec3 p = o + r * t;
        float d = map(p);
        t += d * 0.5;
    }
    return t;
}

float pshade(vec3 p){
    vec3 id = floor(p);
    p.y += sin(T + id.x*10.0 + id.z*10.0);
    p = fract(p) * 2.0 - 1.0;
    p *= yrot(T*btime*4.0 + length(p.xz)*4.0);
    p += id;
    float ac = texN(vec2(p.y, p.z));
    float bc = texN(vec2(p.x, p.z));
    float cc = texN(vec2(p.x, p.y));
    float s = ((ac + bc + cc) / 3.0) * 2.0 - 1.0;
    return s;
}

vec4 surf(vec3 r, vec3 w, vec3 sn, float t){
    float prod = 0.55 + 0.45 * max(dot(sn,-r), 0.0);   // 刃の輪郭線(シルエットの暗縁)を除去
    float off = 0.5 + 0.5 * sin(pshade(w)*pi*5.0);
    float ao = map(w) * 20.0;
    float fog = prod / (1.0 + t * t + off + ao);
    return vec4(vec3(fog), off);
}

vec3 shade(vec3 r, float time){
    r *= xrot(T) * zrot(time);
    vec3 o = vec3(0.0);
    o.z += time;
    float t = trace(o, r);
    vec3 w = o + r * t;
    vec3 sn = normal(w);
    vec4 ac = surf(r, w, sn, t);
    vec3 from = vec3(0.8, 0.2, 0.1);
    vec3 to = vec3(1.0, 1.0, 1.0);
    float fx = 1.0 - ac.w;
    return ac.xyz * mix(from, to, fx);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord ){
    T = iTime * uSpeed;
    vec2 uv = fragCoord.xy / iResolution.xy;
    uv = uv * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;

    vec3 r = normalize(vec3(uv, 1.0 - dot(uv,uv) * 0.33));

    btime = 2.0; bspeed = 10.0;
    vec3 sa = shade(r, T);
    float of = 0.01;
    btime = 4.0; bspeed = 20.0;
    vec3 sb = shade(r, T + of);
    btime = 6.0; bspeed = 20.0;
    vec3 sc = shade(r, T + of*2.0);

    vec3 f = sa * 0.2 + sb * 0.5 + sc * 0.3;
    fragColor = vec4(f, 1.0);
}
`
}
,
{
  name: "SigInt Bands (4syfDV)",
  ch: ["","","",""],
  src: `// sigint (4syfDV) 改変 — 傍受信号風の横帯オシロスコープ。
//   改変: 各バンドの「高さ・横位置」を常に連続的に変化させ続ける(止まらず動く)。
//   帯内の信号もスクロール。各バンドは固有の位相/速度で伸縮・横移動する。
// @param uMorph 0.1..3 = 1.0    高さ・位置が変化し続ける速さ
// @param uJitter 0..1 = 0.6     横移動の振幅
// @param uSpeed 0..3 = 1.0      信号スクロール速度
uniform float uMorph; uniform float uJitter; uniform float uSpeed;

float hash11(float n){ return fract(sin(n*127.1)*43758.5453); }

void mainImage(out vec4 O, vec2 u){
    vec2 uv = u / iResolution.xy;
    float t  = iTime * 0.02 * uSpeed;   // 信号スクロール
    float mt = iTime * uMorph;          // 高さ/位置の変化用

    // ---- 各バンドの高さを常に連続脈動させながら分割 ----
    float cum = 0.0; float bandSeed = 0.0;
    for(int i = 0; i < 16; i++){
        float fi = float(i);
        float ph   = hash11(fi*3.1 + 0.5) * 6.2831;             // バンド固有の位相
        float rate = 0.35 + 0.85 * hash11(fi*1.7 + 2.0);        // バンド固有の脈動速度
        float h = mix(0.03, 0.17, 0.5 + 0.5*sin(mt*rate + ph)); // 高さが常に伸縮
        if(uv.y < cum + h || i == 15){ bandSeed = fi; break; }
        cum += h;
    }

    // ---- 各バンドの横位置も常に連続移動 ----
    float ph2   = hash11(bandSeed*2.3 + 1.1) * 6.2831;
    float rate2 = 0.3 + 0.7 * hash11(bandSeed*4.7 + 3.0);
    float dir   = (hash11(bandSeed*5.9) < 0.5) ? 1.0 : -1.0;    // 各帯の流れる向き
    float xoff  = sin(mt*rate2 + ph2) * uJitter;                // 横位置が常にドリフト
    float x = uv.x + dir * t + xoff;

    vec4 a = sin(x * vec4(350.13, 2.5, 10.0, 0.3));
    vec4 b = sin(x * vec4(150.3, 0.5, 20.0, 11.3));
    int fa = int(hash11(bandSeed*11.0) * 4.0);                  // バンド固有の周波数
    int fb = int(hash11(bandSeed*13.0) * 4.0);
    float k = a[fa];
    float j = b[fb];
    if(hash11(bandSeed*17.0) < 0.3){                            // 一部の帯は合成波
        k = a.a + a.b - a.g + a.r;
        j = b.a + b.b - b.g * b.r;
    }

    // 縞(高周波)だけ黒白2値化してソリッドに。なだらかなグラデ帯はそのまま残す。
    //   変化の速さは横方向の微分だけで見る。帯内では v は x にしか依存しないので値は同じだが、
    //   fwidth だと帯の境界で縦方向の微分が跳ね上がり、その 1 行だけ 2 値化されて黒い隙間になる。
    float v = abs(k * j);
    float fw = abs(dFdx(v));
    float isStripe = smoothstep(0.03, 0.12, fw);
    O = vec4(mix(v, step(0.3, v), isStripe));
}
`
}
,
{
  name: "Cave at the Edge of the Universe (ttfBDH)",
  ch: ["","","",""],
  src: `// Shadertoy ttfBDH "Cave at the Edge of the Universe" by jarble — 単一パスそのまま移植。
//   iMouse 視点回転は除去(自動フライト固定)。marching 上限 1000→260 に短縮(ANGLE/TDR 対策)。
//   不透明(透過なし)。

#define rot(spin) mat2(cos(spin),sin(spin),-sin(spin),cos(spin))

const int MAX_MARCHING_STEPS = 260;
const float MIN_DIST = 0.0;
const float MAX_DIST = 10000.0;
const float EPSILON = 0.001;
#define ITERATIONS 20

const float scale = EPSILON*10.0;

float sceneSDF(vec3 p) {
    p /= 20.0;
    vec2 uv = p.xy - vec2(.5);
    float time = p.z * 2. + 15.+length(sin(uv/10.0));
    uv = sin(uv/(20.0+sin(uv.yx/20.0+time)))*3.0;
    float len = dot(uv, uv) * .3 - .4;
    vec3 z = sin(time + vec3(.23, .19, .17));
    for (int i = 0; i < ITERATIONS; i++) {
        z += cos(z.zxy + uv.yxy * float(i) * len);
    }
    float val = z.r * .06 + .3;
    val -= smoothstep(.1, -.3, len) * 1.5 + len * .3 - .4;
    return val;
}

vec3 surface_color(vec3 p){
    p /= scale;
    p /= 200.0;
    return sin(vec3(sceneSDF(p/5.0),sceneSDF(p*3.0),sceneSDF(p*2.0)))/3.0+vec3(.3);
}

float shortestDistanceToSurface(vec3 eye, vec3 marchingDirection, float start, float end) {
    float depth = start;
    for (int i = 0; i < MAX_MARCHING_STEPS; i++) {
        float dist = sceneSDF(eye + depth * marchingDirection);
        if (dist < EPSILON) return depth;
        depth += dist;
        if (depth >= end) return end;
    }
    return end;
}

vec3 rayDirection(float fieldOfView, vec2 size, vec2 fragCoord) {
    vec2 xy = fragCoord - size / 2.0;
    float z = size.y / tan(radians(fieldOfView) / 2.0);
    return normalize(vec3(xy, -z));
}

vec3 estimateNormal(vec3 p) {
    return normalize(vec3(
        sceneSDF(vec3(p.x + EPSILON, p.y, p.z)) - sceneSDF(vec3(p.x - EPSILON, p.y, p.z)),
        sceneSDF(vec3(p.x, p.y + EPSILON, p.z)) - sceneSDF(vec3(p.x, p.y - EPSILON, p.z)),
        sceneSDF(vec3(p.x, p.y, p.z  + EPSILON)) - sceneSDF(vec3(p.x, p.y, p.z - EPSILON))
    ));
}

vec3 phongContribForLight(vec3 k_d, vec3 k_s, float alpha, vec3 p, vec3 eye, vec3 lightPos, vec3 lightIntensity) {
    lightPos = eye;
    vec3 N = estimateNormal(p);
    vec3 L = normalize(lightPos - p);
    vec3 V = normalize(eye - p);
    vec3 R = normalize(reflect(-L, N));
    float dotLN = dot(L, N);
    float dotRV = dot(R, V);
    if (dotLN < 0.0) return vec3(0.0);
    if (dotRV < 0.0) return lightIntensity * (k_d * dotLN);
    return lightIntensity * (k_d * dotLN + k_s * pow(dotRV, alpha));
}

vec3 phongIllumination(vec3 k_a, vec3 k_d, vec3 k_s, float alpha, vec3 p, vec3 eye) {
    const vec3 ambientLight = 0.5 * vec3(1.0);
    vec3 color = ambientLight * k_a;
    vec3 light1Pos = vec3(4.0, 2.0, 4.0);
    vec3 light1Intensity = vec3(0.8);
    color += phongContribForLight(k_d, k_s, alpha, p, eye, light1Pos, light1Intensity);
    return color;
}

mat3 viewMatrix(vec3 eye, vec3 center, vec3 up) {
    vec3 f = normalize(center - eye);
    vec3 s = normalize(cross(f, up));
    vec3 u = cross(s, f);
    return mat3(s, u, -f);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord ){
    vec3 viewDir = rayDirection(45.0, iResolution.xy, fragCoord);
    float speed = 1.0;
    float t1 = iTime*speed;
    vec3 eye = vec3(-10.0-200.0,9.0-15.0,9.0*t1);
    mat3 viewToWorld = -viewMatrix(eye, vec3(0.0), vec3(0.0, 1.0, 0.0));
    vec3 worldDir = viewToWorld * viewDir;
    float dist = shortestDistanceToSurface(eye, worldDir, MIN_DIST, MAX_DIST);
    if (dist > MAX_DIST - EPSILON) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    vec3 p = eye + dist * worldDir;
    vec3 K_a = surface_color(p);
    vec3 K_d = K_a;
    vec3 K_s = vec3(1.0);
    float shininess = 100.0;
    vec3 color = phongIllumination(K_a, K_d, K_s, shininess, p, eye);
    fragColor = vec4(color, 1.0);
}`
}
,
{
  name: "Wierd Moving Voronoi (WsX3zS)",
  ch: ["","","",""],
  src: `// Shadertoy WsX3zS "Wierd Moving Voronoi Thing" by ritobanrc — 単一パスそのまま移植。
//   iChannel0 は原作でも未使用。不透明(透過なし)。

float random (in vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

float noise (in vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f*f*(3.0-2.0*f);
    return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord ){
    vec2 uv = fragCoord/iResolution.xy;
    float min_dist = max(iResolution.x, iResolution.y);
    for (float n = 0.0; n < 10.0; n++) {
        vec2 point = vec2(noise(vec2(n, sin(iTime))), noise(vec2(cos(iTime), n)));
        vec2 diff = uv - point;
        min_dist = min(length(diff), min_dist);
    }
    min_dist = 1.0-min_dist;
    min_dist = min_dist * min_dist;
    vec3 col = vec3(min_dist);
    fragColor = vec4(col, 1.0);   // 不透明(透過なし)
}`
}
,
{
  name: "Klaksrotate (MljyDt)",
  ch: ["","","",""],
  src: `// Shadertoy MljyDt "Klaksrotate" by mbixo (Aiekick fork) — 単一パス移植。
//   原作の iChannel0 テクスチャ(法線ハイト用 bump)は手続きノイズに置換。iMouse は除去。
//   ヒット部のみ不透明、背景は alpha=0 → Slot B で透過。
uniform float uSlotIsA;

vec3 mat = vec3(1.0, 1.26, 3.0);

float h31(vec3 p){ p = fract(p*0.1031); p += dot(p, p.yzx+33.33); return fract((p.x+p.y)*p.z); }
float vnoise(vec3 x){
    vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(h31(i+vec3(0,0,0)), h31(i+vec3(1,0,0)), f.x),
                   mix(h31(i+vec3(0,1,0)), h31(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(h31(i+vec3(0,0,1)), h31(i+vec3(1,0,1)), f.x),
                   mix(h31(i+vec3(0,1,1)), h31(i+vec3(1,1,1)), f.x), f.y), f.z);
}

float fractus(vec3 p){
    vec2 z = p.xz;
    vec2 c = vec2(1,-1) * p.y;
    float k = 1., h = 2.0;
    const float iter = 3.0;
    for (float i=0.;i<iter;i++){
        h *= 4.*k;
        k = dot(z,z);
        if(k > 4.) break;
        z = vec2(z.x * z.x - z.y * z.y, 3. * z.x * z.y) + c;
    }
    return sqrt(k/h)*log(k);
}

vec4 df(vec3 p){
    p *= 0.3;
    float fr = fractus(p)*1.5;
    return vec4(fr, vec3(step(fr, 1.54)));
}

vec4 dfH(vec3 p){
    p *= 0.3;
    float fr = fractus(p)*1.5;
    fr -= vnoise(p*5.0)*.2;
    return vec4(fr, vec3(step(fr, 3.54)));
}

vec3 nor( vec3 p , vec3 e){
    return normalize(vec3(
        df(p+e.xyy).x - df(p-e.xyy).x,
        df(p+e.yxy).x - df(p-e.yxy).x,
        df(p+e.yyx).x - df(p-e.yyx).x ));
}

vec3 norH( vec3 p , vec3 e){
    return normalize(vec3(
        dfH(p+e.xyy).x - dfH(p-e.xyy).x,
        dfH(p+e.yxy).x - dfH(p-e.yxy).x,
        dfH(p+e.yyx).x - dfH(p-e.yyx).x ));
}

float SubDensity(vec3 p, float s){
    vec3 n = norH(p,vec3( 0.03, 0, 1));
    return df(p - n * s).x/s;
}

vec2 shade(vec3 ro, vec3 rd, float d, vec3 lp, float li){
    vec3 p = ro + rd * d;
    vec3 ld = normalize(lp-p);
    vec3 n = nor(p, vec3( 0.001, 0, 0));
    vec3 refl = reflect(rd,n);
    float amb = 0.132;
    float diff = clamp( dot( n, ld ), 0.0, 1.0 );
    float fre = pow( clamp( 1. + dot(n,rd),0.0,1.0), 4. );
    float spe = pow(clamp( dot( refl, ld ), 0.0, 1.0 ),16.);
    float sss = 1. - SubDensity(p, 1.);
    return vec2(
        (diff + fre + spe) * amb * li,
        (diff + fre + sss) * amb * li + spe
    );
}

void mainImage( out vec4 fragColor, in vec2 fragCoord ){
    vec2 si = iResolution.xy;
    float time = iTime * 0.5;
    float cam_e = iTime * 0.2;
    float cam_d = 5.128;
    vec3 cu = vec3(0,1,0);
    vec3 cv = vec3(0,0,0);
    vec3 col = vec3(0.);
    vec3 ro = vec3(-sin(time), sin(cam_e), cos(time))*cam_d;
    vec3 lpi = vec3(-sin(time*2.), sin(cam_e), cos(time*2.))*2.;
    vec3 rov = normalize(cv-ro);
    vec3 u = normalize(cross(cu,rov));
    vec3 v = cross(rov,u);
    vec2 uv = (fragCoord*2.-si)/si.y;
    vec3 rd = normalize(rov + uv.x*u + uv.y*v);
    float md = 20.;
    float s = 1.;
    float d = 0.;
    for(int i=0;i<250;i++){
        if (s<0.25*log(d*d/s/1e5)||s>md) break;
        s = df(ro+rd*d).x;
        d += s * 0.5;
    }
    float hit = 0.0;
    if (d<md){
        vec3 p = ro + rd * d;
        col = mix(
            shade(p, rd, 1., lpi, 5.).y * mat,
            shade(ro, rd, d, ro, 1.).x * (mat+0.5),
        0.8);
        hit = 1.0;
    }
    fragColor = vec4(col, mix(hit, 1.0, uSlotIsA));
}`
}
,
{
  name: "Smoked Cherry (4cBcz1)",
  ch: ["","","",""],
  src: `// Shadertoy 4cBcz1 "Smoked cherry" by julienledortz — 単一パス移植。
//   原作の iChannel0 立方体テクスチャ(texCube)は手続き triplanar ノイズに置換。iMouse 除去。
//   march 上限 2048→520 に短縮(ANGLE/TDR 対策)。ヒット部のみ不透明、背景は Slot B で透過。
uniform float uSlotIsA;

float h31(vec3 p){ p = fract(p*0.1031); p += dot(p, p.yzx+33.33); return fract((p.x+p.y)*p.z); }
float vnoise(vec3 x){
    vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(h31(i+vec3(0,0,0)), h31(i+vec3(1,0,0)), f.x),
                   mix(h31(i+vec3(0,1,0)), h31(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(h31(i+vec3(0,0,1)), h31(i+vec3(1,0,1)), f.x),
                   mix(h31(i+vec3(0,1,1)), h31(i+vec3(1,1,1)), f.x), f.y), f.z);
}

// 原作 texCube(サンプラ立方投影)を手続きノイズで代替
vec4 texCubeP( in vec3 p, in vec3 n, in float k ){
    float x = vnoise(vec3(p.yz*3.0, 1.7));
    float y = vnoise(vec3(p.zx*3.0, 5.3));
    float z = vnoise(vec3(p.xy*3.0, 9.1));
    vec3 w = pow( abs(n), vec3(k) );
    float v = (x*w.x + y*w.y + z*w.z) / (w.x+w.y+w.z);
    return vec4(vec3(v), 1.0);
}

vec4 map( vec3 p ){
    p.x += 0.5*sin( 3.0*p.y + iTime*0.1 );
    p.y += 0.5*sin( 3.0*p.z + iTime*0.1 );
    p.z += 0.5*sin( 3.0*p.x + iTime*0.1 );
    p.x += 0.5*sin( 3.0*p.y + iTime*0.3 );
    p.y += 0.5*sin( 3.0*p.z + iTime*0.3 );
    p.z += 0.5*sin( 3.0*p.x + iTime*0.3 );
    p.x += 0.5*sin( 3.0*p.y + iTime*0.2 );
    p.y += 0.5*sin( 3.0*p.z + iTime*0.2 );
    p.z += 0.5*sin( 3.0*p.x + iTime*0.2 );
    p.x += 0.5*sin( 3.0*p.y + iTime*0.1 );
    p.y += 0.5*sin( 3.0*p.z + iTime*0.1 );
    p.z += 0.5*sin( 3.0*p.x + iTime*0.1 );
    float d1 = length(p.xz) - 1.0;
    d1 *= 0.01;
    return vec4( d1, p );
}

vec4 intersect( in vec3 ro, in vec3 rd, in float maxd ){
    vec3 res = vec3(-1.0);
    float precis = 0.0001;
    float t = 1.0;
    for( int i=0; i<520; i++ ){
        vec4 tmp = map( ro+rd*t );
        res = tmp.yzw;
        float h = tmp.x;
        if( h<precis || t>maxd ) break;
        t += h;
    }
    return vec4( t, res );
}

vec3 calcNormal( in vec3 pos ){
    vec2 e = vec2(1.0,-1.0)*0.001;
    return normalize( e.xyy*map( pos + e.xyy ).x +
                      e.yyx*map( pos + e.yyx ).x +
                      e.yxy*map( pos + e.yxy ).x +
                      e.xxx*map( pos + e.xxx ).x );
}

float calcOcc( in vec3 pos, in vec3 nor ){
    const float h = 0.2;
    float ao = 0.0;
    for( int i=0; i<8; i++ ){
        vec3 dir = sin( float(i)*vec3(1.0,5.13,10.71)+vec3(0.0,0.5,0.0) );
        dir *= sign(dot(dir,nor));
        float d = map( pos + h*dir ).x;
        ao += max(0.0,h-d*2.0);
    }
    return clamp( 4.0 - 2.5*ao, 0.0, 1.0 );
}

void mainImage( out vec4 fragColor, in vec2 fragCoord ){
    vec2 q = fragCoord.xy / iResolution.xy;
    vec2 p = -1.0 + 2.0 * q;
    p.x *= iResolution.x / iResolution.y;

    float an = 0.1 * iTime - 25.0;
    vec3 ro = vec3(4.5 * sin(an), 0.0, 4.5 * cos(an));
    vec3 ta = vec3(1.0, 1.0, 0.0);
    vec3 ww = normalize(ta - ro);
    vec3 uu = normalize(cross(ww, vec3(1.0, 2.0, 0.0)));
    vec3 vv = normalize(cross(uu, ww));
    vec3 rd = normalize(p.x * uu + p.y * vv + 3.0 * ww);

    vec3 col = vec3(0.773,0.8,0.871);
    float hit = 0.0;

    const float maxd = 8.0;
    vec4 inn = intersect(ro, rd, maxd);
    float t = inn.x;
    if (t < maxd){
        vec3 tra = inn.yzw;
        vec3 pos = ro + t * rd;
        vec3 nor = calcNormal(pos);
        col = 0.5 + 0.1 * cos(tra.y * 0.4 + vec3(0.6, 0.1, 0.2));
        vec3 pat = texCubeP(0.1 * tra, nor, 10.0).xyz;
        col *= pat;
        float occ = calcOcc(pos, nor);
        float fre = pow(clamp(1.0 + dot(nor, rd), 0.0, 1.0), 5.0);
        float spe = 0.3 * pat.x * max(0.0, pow(clamp(dot(-rd, nor), 0.0, 1.0), 10.0)) * occ;
        vec3 lin = vec3(0.5, 11.5, 11.0);
        lin += vec3(0.5, 0.2, 0.2);
        lin += 1.0 * fre * vec3(0.8, 0.3, 0.5);
        lin *= 1.0 + nor.y;
        col = col * lin + spe;
        hit = 1.0;
    }
    fragColor = vec4(col, mix(hit, 1.0, uSlotIsA));
}`
}
,
{
  name: "Polar Rings (ctsfWM)",
  ch: ["","","",""],
  src: `// Shadertoy ctsfWM "Polar Rings" by BenO — 2パス(Buffer A + Image)を単一パスに統合。
//   Buffer A(極座標リング生成)を関数 ringPat() 化。自己feedback texture(iChannel0,vec2(l,.5)) は
//   1.0 で近似。Image パス(コントラストから法線→複数スペキュラライト)を上に適用。不透明(透過なし)。

float a2f(vec2 uvz){ return ((atan(-uvz.y, -uvz.x) / 3.1415) * .5) + .5; }

float ringPat(vec2 uv){
    uv.x *= iResolution.x / iResolution.y;
    vec2 cuv = vec2(uv.x - iResolution.x / iResolution.y / 2., uv.y - 0.5);
    float r = sqrt(cuv.x * cuv.x + cuv.y * cuv.y);
    float a = a2f(vec2(cuv.x, cuv.y));
    r = fract(r*2.-iTime*0.05);
    a = fract(a*2.+iTime*0.1);
    float c = 0.0;
    float ls = 6.;
    for(int i=0; i<6; i++){
        float l = float(i)/ls;
        a = fract(a+iTime*0.1*sin(l*1.5));
        float w = 0.2+sin(l*0.17);
        float sl = smoothstep(0.,0.01, a) - smoothstep(0.2+w,0.21+w, a);
        float av2 = fract(a+iTime*l*0.01*sin(l*0.3)+0.77);
        float av3 = fract(a+iTime*l*0.03*sin(l*0.3)+0.4);
        float sl2 = smoothstep(0.,0.02, av2) - smoothstep(0.2+w,0.21+w, av2);
        float sl3 = smoothstep(0.,0.02, av3) - smoothstep(0.2+w+0.2,0.21+w+0.2, av3);
        float nl = smoothstep(l+0.01+sl2*0.03, l+0.02+sl2*0.03, r);
        float nln = smoothstep(l+(1./ls)-sl3*0.03, l+(1./ls)+0.02-sl3*0.03, r);
        float av4 = fract(a+iTime*l*0.02*sin(l*0.2)+0.5);
        float sl4 = smoothstep(0.01,0.05, av4) - smoothstep(0.2+w+0.2,0.2+w+0.26, av4);
        float l1 = smoothstep(l+0.07+sl4*0.1, l+0.071+sl4*0.1, r);
        float l2 = smoothstep(l+0.08+sl4*0.1, l+0.082+sl4*0.1, r);
        float ln = max(l1-l2,0.);
        float c1 = (nl - nln) * (1.-ln*0.2);
        c1 = mix(c1*2., c1*2., sl);
        c += c1 * 1.0;
    }
    return c;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord ){
    vec2 uv = fragCoord/iResolution.xy;
    vec3 col = vec3(ringPat(uv));
    vec3 n = vec3(0.,0.,1.);
    n.x = ringPat(uv + vec2(-0.001, 0.)) - ringPat(uv + vec2(0.001, 0.));
    n.y = ringPat(uv + vec2(0., -0.001)) - ringPat(uv + vec2(0., 0.001));
    n = normalize(n);
    for(int i=0; i<5; i++){
        float lpx = min(cos(iTime+cos(float(i)*.8)*5.) *3., 0.);
        float lpy = sin(iTime+cos(float(i)*.8)*5.) * 2.;
        vec3 lp = vec3(lpx + sin(float(i)), lpy, 1.);
        vec3 ld = lp - vec3(uv, 0.);
        float lds = 1.-(1./length(ld));
        float lgh = clamp(dot(ld, n), 0., 1.);
        col = col * clamp(lgh * pow(lds*1.9,1.), 0.8, 1.1);
        vec3 dr = vec3(uv, 0.) - vec3(0.5,0.5,1.);
        vec3 hd = normalize(ld - dr);
        float sp = max(dot(hd, n), 0.);
        sp = pow(sp, 100.) * .4;
        col += min(sp, 0.73) * vec3(0.75 * sin(float(i)),0.7,0.95);
    }
    vec3 lp2 = vec3(1.2, 1.5, .2);
    vec3 ld2 = lp2 - vec3(uv, 0.);
    float lds2 = length(ld2);
    col += vec3(.5,0.1,0.) * pow(lds2 * 0.5, 6.);
    fragColor = vec4(col, 1.0);   // 透過しない(不透明)
}`
}

,
{
  name: "City Maker (lscGz2)",
  ch: ["","","",""],
  src: `// Shadertoy lscGz2 "City Maker" by phi16 — 単一パス移植。
//   依頼により除去: 謎の光の棒(t=2..10 の細長 box とそのグロー)/ 太陽(+x 方向のグレア)/ 背景色(空グラデ)。
//   背景(空・レイミス)は alpha=0 → Slot B で透過(Slot A は黒背景)。
//   iChannel0(ノイズテクスチャ)は手続きハッシュに、iChannel1(窓の反射cubemap)は手続き環境色に置換。
uniform float uSlotIsA;

#define M(x,y) res = mel(res,C(x,y))

struct C{ float d; int t; };

C mel(C c,C d){ if(c.t != -1 && c.d < d.d) return c; else return d; }
C sub(C c,C d){ return C(max(c.d,-d.d),c.t); }

float gSky;   // 1.0 = 背景(空/レイミス)。Slot B 透過 alpha 用

// 原作 iChannel0(256^2 ノイズテクスチャ)の代替: 256 周期でラップするハッシュ
float random(vec2 p){
    p = mod(p, 256.0);
    return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123);
}

float hash( float n ) { return fract(sin(n)*753.5453123); }
float noise1( in vec3 x ){
    vec3 p = floor(x);
    vec3 f = fract(x);
    f = f*f*(3.0-2.0*f);
    float n = p.x + p.y*157.0 + 113.0*p.z;
    return mix(mix(mix( hash(n+  0.0), hash(n+  1.0),f.x),
                   mix( hash(n+157.0), hash(n+158.0),f.x),f.y),
               mix(mix( hash(n+113.0), hash(n+114.0),f.x),
                   mix( hash(n+270.0), hash(n+271.0),f.x),f.y),f.z);
}

const mat3 m = mat3( 0.00,  0.80,  0.60,
                    -0.80,  0.36, -0.48,
                    -0.60, -0.48,  0.64 );
float noise(vec3 p){
    float f = 0.0;
    vec3 q = 8.0*p;
    f  = 0.5000*noise1( q ); q = m*q*2.01;
    f += 0.2500*noise1( q ); q = m*q*2.02;
    f += 0.1250*noise1( q ); q = m*q*2.03;
    f += 0.0625*noise1( q ); q = m*q*2.01;
    return f;
}

float box(vec3 p,vec3 b){
    vec3 d = abs(p)-b;
    return min(max(d.x,max(d.y,d.z)),0.)+length(max(d,0.));
}

C dist(vec3 p){
    vec3 q = p;
    q.xz = mod(q.xz,1.)-0.5;
    C res = C(0.,-1);
    M(p.y,1);
    // (謎の棒 t=5/7/2/3/6 の細長 box をここから除去)
    float hei = random(floor(p.xz))*1.6+0.5;
    hei *= smoothstep(-10.,10.,iTime*5.-floor(p.x)+random(vec2(floor(p.z),0.5))*12.-3.+pow(abs(floor(p.z)),0.8));
    if(hei>0.)M(box(q-vec3(0,hei,0),vec3(0.3,hei,0.3)),0);
    res = sub(res, C(box(q-vec3(0,hei*2.,0),vec3(0.25,0.05*smoothstep(-10.,2.,iTime*5.-floor(p.x)),0.25)),0));
    hei = 2.1 * smoothstep(-10.,10.,iTime*5.-floor(p.x-8.)+random(vec2(floor(p.z),0.5))*12.-3.+pow(abs(floor(p.z)),0.8));
    if(hei>0.)M(box(q-vec3(1,0,0)-vec3(0,hei,0),vec3(0.3,hei,0.3)),0);
    if(hei>0.)M(box(q-vec3(0,0,1)-vec3(0,hei,0),vec3(0.3,hei,0.3)),0);
    if(hei>0.)M(box(q-vec3(-1,0,0)-vec3(0,hei,0),vec3(0.3,hei,0.3)),0);
    if(hei>0.)M(box(q-vec3(0,0,-1)-vec3(0,hei,0),vec3(0.3,hei,0.3)),0);
    return res;
}

vec3 normal(vec3 p){
    vec2 e=vec2(0.001,0);
    return normalize(vec3(
        dist(p+e.xyy).d-dist(p-e.xyy).d,
        dist(p+e.yxy).d-dist(p-e.yxy).d,
        dist(p+e.yyx).d-dist(p-e.yyx).d));
}

float ao(vec3 p,vec3 n){
    float a = 0.;
    float d = 1./6.;
    for(float i=1.;i<6.;i++){
        a += max(0.,dist(p+n*i*d).d) / (i*d) * pow(2.,-i);
    }
    return a * 0.5 + 0.5;
}

vec3 color(vec3 p, vec3 v){
    float d = 0.001;
    C c=C(0.,-1);
    vec3 pos;
    for(int i=0;i<80;i++){
        pos = p+d*v;
        C ci=dist(pos);
        float rd = ci.d;
        if(abs(rd) < 0.001*max(1.,d/10.)){ c=ci; break; }
        d += rd;
    }
    vec3 n = normal(pos);
    if(c.t == 1 || (c.t==-1 && v.y < 0.)) { c = C(-p.y/v.y,1); d = c.d; pos = p+c.d*v; n = vec3(0,1,0); }
    vec3 col = vec3(0);
    gSky = 0.0;
    if(c.t==-1){
        col = vec3(0);   // 背景色(空グラデ v*0.5+0.5)は除去
        gSky = 1.0;
    }else if(c.t == 0){
        vec3 light = normalize(vec3(1,1,1));
        float hei = random(floor(pos.xz))*1.6+0.5;
        hei *= smoothstep(-10.,10.,iTime*5.-floor(pos.x)+random(vec2(floor(pos.z),0.5))*12.-3.+pow(abs(floor(pos.z)),0.8));
        vec3 hdif = vec3(0,-hei*2.,0);
        vec3 col1 = vec3(1,0.95,0.8);
        vec3 grad = vec3(noise(pos+hdif),noise(pos+hdif+1.5),noise(pos+hdif+2.2))*2.-1.;
        grad = normalize(n + grad*2.);
        col1 *= 0.9 + 0.1 * dot(light,grad);
        vec3 bc = vec3(mod(pos.xz,1.)-0.5,pos.y).xzy-vec3(0,hei,0), bs = vec3(0.3,hei,0.3);
        vec3 ap = bs-abs(bc);
        vec3 bp = vec3(0.015);
        if((ap.x<bp.x && ap.y<bp.y) || (ap.z<bp.z && ap.y<bp.y) || (ap.x<bp.x && ap.z<bp.z))col1 *= 0.1;
        vec3 col2 = vec3(0);
        float rColor = random(floor(pos.xz)*2.);
        if(rColor < 0.3)col2 = mix(vec3(0.7,0.3,0.2),vec3(0.8,0.7,0.6),rColor*10./3.);
        else col2 = mix(vec3(0.3,0.3,0.3),vec3(0.8,0.8,0.8),(rColor-0.3)*10./7.);
        col2 += max(0.,dot(light,n))*0.4;
        vec3 col3 = col2;
        vec3 posi = abs(mod(pos+hdif+0.05,vec3(0.1,0.1,0.1))-0.05)*20.;
        vec3 ri = mod(pos+hdif,1.);
        if(pos.y < hei*2.-0.05 && (ri.x > 0.25 && ri.x < 0.75 || ri.z > 0.25 && ri.z < 0.75)){
            float ep = max(posi.x,max(posi.y,posi.z));
            if(ep < 0.65){
                // 原作の iChannel1 反射cubemap → 手続き環境色
                vec3 rfl = reflect(v,n);
                vec3 env = mix(vec3(0.15,0.18,0.28), vec3(0.85,0.9,1.0), clamp(rfl.y*0.5+0.5,0.,1.));
                col3 = env * 0.5 + 0.5;
                col3 *= 2.0 - exp(ep-0.65);
            }else if(ep < 0.7){
                col3 *= max(0.,dot(normalize(posi),light))*0.4;
            }
        }else if(ri.x > 0.25 && ri.x < 0.75 && ri.z > 0.25 && ri.z < 0.75){
            col3 *= 0.3;
        }
        if(posi.y > 0.7)col3 *= 1. + (posi.y-1.)*3. * max(smoothstep(0.35,0.1,abs(ri.x-0.5)),smoothstep(0.35,0.1,abs(ri.z-0.5)));
        float level = smoothstep(-5.,9.,iTime*5.-floor(pos.x)+random(vec2(floor(pos.z),0.5))*6.-3.);
        float level2 = smoothstep(-1.,9.,iTime*5.-floor(pos.x)+random(vec2(floor(pos.z),0.5))*6.-3.);
        col2 = mix(col2,col3,level2);
        col = col2;   // 壁のノイズっぽいテクスチャ(col1 の noise ミックス)を除去。色(col2)と窓(col3)は残す。
        col *= ao(pos,n);
    }else if(c.t == 1){
        col = vec3(0.8,0.8,0.8);
        if(max(abs(mod(pos.x,1.)),abs(mod(pos.z,1.))) > 0.9)col *= 0.8;
        col *= min(1.,ao(pos,n));
    }
    // (棒のグロー cubeNearest と 太陽グレアはここから除去)
    return col;
}

vec4 sampleImage(vec2 coord){
    vec2 R = iResolution.xy, uv = (2.*coord - R)/R.y;
    vec3 p=vec3(iTime*5.-sin(iTime/4.)*1.,4.2,0);
    vec3 rv=vec3(1,0,0);
    vec2 bi = vec2(random(vec2(iTime*256.,0.)),random(vec2(-iTime*256.,1.)));
    uv += bi/60.*800./iResolution.x;
    vec3 v=vec3(1,uv.y-0.1,uv.x);
    v = normalize(v);
    float spd = 2.;
    float rot = (iTime*spd + sin(iTime*spd/2.))/8.+0.1;
    v.xz *= mat2(cos(rot),-sin(rot),sin(rot),cos(rot));
    rv.xz *= mat2(cos(rot),-sin(rot),sin(rot),cos(rot));
    p -= rv;
    vec3 c = color(p,v);
    float objA = gSky > 0.5 ? 0.0 : 1.0;
    return vec4(c, objA);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord ){
    vec4 s = sampleImage(fragCoord + vec2(0.5,0.0));
    fragColor = vec4(s.rgb, mix(s.a, 1.0, uSlotIsA));
}`
}

,
{
  name: "Flickering Crystals (tdSfRd)",
  ch: ["","","",""],
  src: `// Shadertoy tdSfRd "Flickering crystals" by jarble — 単一パスそのまま移植(入力なし・手続き)。
//   iMouse 無し。背景(レイミス)は alpha=0 → Slot B で透過(Slot A は黒背景)。
uniform float uSlotIsA;

const int MAX_MARCHING_STEPS = 255;
const float MIN_DIST = 0.0;
const float MAX_DIST = 100.0;
const float EPSILON = 0.00001;

vec3 hash33(vec3 p3){
    p3 = fract(p3 * vec3(.1031, .1030, .0973));
    p3 += dot(p3, p3.yxz+33.33);
    return fract((p3.xxy + p3.yxx)*p3.zyx);
}

mat3 rotateY(float theta){
    float c = cos(theta);
    float s = sin(theta);
    return mat3(vec3(c, 0, s), vec3(0, 1, 0), vec3(-s, 0, c));
}

float sphereSDF(vec3 p, float r){
    return length(hash33(sin(p)/100000.0))-sin(length(p))/3.0;
}

float sceneSDF(vec3 samplePoint){
    samplePoint = samplePoint+vec3(0.0,0.0,iTime);
    return sphereSDF(samplePoint,1.0);
}

float shortestDistanceToSurface(vec3 eye, vec3 marchingDirection, float start, float end){
    float depth = start;
    for (int i = 0; i < MAX_MARCHING_STEPS; i++) {
        float dist = sceneSDF(eye + depth * marchingDirection);
        if (dist < EPSILON) return depth;
        depth += dist;
        if (depth >= end) return end;
    }
    return end;
}

vec3 rayDirection(float fieldOfView, vec2 size, vec2 fragCoord){
    vec2 xy = fragCoord - size / 2.0;
    float z = size.y / tan(radians(fieldOfView) / 2.0);
    return normalize(vec3(xy, -z));
}

vec3 estimateNormal(vec3 p){
    return normalize(vec3(
        sceneSDF(vec3(p.x + EPSILON, p.y, p.z)) - sceneSDF(vec3(p.x - EPSILON, p.y, p.z)),
        sceneSDF(vec3(p.x, p.y + EPSILON, p.z)) - sceneSDF(vec3(p.x, p.y - EPSILON, p.z)),
        sceneSDF(vec3(p.x, p.y, p.z  + EPSILON)) - sceneSDF(vec3(p.x, p.y, p.z - EPSILON))
    ));
}

vec3 phongContribForLight(vec3 k_d, vec3 k_s, float alpha, vec3 p, vec3 eye, vec3 lightPos, vec3 lightIntensity){
    vec3 N = estimateNormal(p);
    vec3 L = normalize(lightPos - p);
    vec3 V = normalize(eye - p);
    vec3 R = normalize(reflect(-L, N));
    float dotLN = dot(L, N);
    float dotRV = dot(R, V);
    if (dotLN < 0.0) return vec3(0.0);
    if (dotRV < 0.0) return lightIntensity * (k_d * dotLN);
    return lightIntensity * (k_d * dotLN + k_s * pow(dotRV, alpha));
}

vec3 phongIllumination(vec3 k_a, vec3 k_d, vec3 k_s, float alpha, vec3 p, vec3 eye){
    const vec3 ambientLight = 0.5 * vec3(1.0);
    vec3 color = ambientLight * k_a;
    vec3 light1Pos = vec3(4.0, 2.0, 4.0);
    vec3 light1Intensity = vec3(0.4);
    color += phongContribForLight(k_d, k_s, alpha, p, eye, light1Pos, light1Intensity);
    vec3 light2Pos = vec3(2.0 * sin(0.37), 2.0 * cos(0.37), 2.0);
    vec3 light2Intensity = vec3(0.4);
    color += phongContribForLight(k_d, k_s, alpha, p, eye, light2Pos, light2Intensity);
    return color;
}

mat3 viewMatrix(vec3 eye, vec3 center, vec3 up){
    vec3 f = normalize(center - eye);
    vec3 s = normalize(cross(f, up));
    vec3 u = cross(s, f);
    return mat3(s, u, -f);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord ){
    vec3 viewDir = rayDirection(45.0, iResolution.xy, fragCoord);
    vec3 eye = vec3(8.0, 5.0, 7.0);
    mat3 viewToWorld = viewMatrix(eye, vec3(0.0), vec3(0.0, 1.0, 0.0));
    vec3 worldDir = viewToWorld * viewDir;
    float dist = shortestDistanceToSurface(eye, worldDir, MIN_DIST, MAX_DIST);
    if (dist > MAX_DIST - EPSILON) { fragColor = vec4(vec3(0.0), uSlotIsA); return; }
    vec3 p = eye + dist * worldDir;
    vec3 K_a = hash33(p/500.0);
    vec3 K_d = K_a;
    vec3 K_s = vec3(1.0);
    float shininess = 10.0;
    vec3 color = phongIllumination(K_a, K_d, K_s, shininess, p, eye);
    fragColor = vec4(color, 1.0);
}`
}

,
{
  name: "Redmond Wrinkle Petals (7lGyD1)",
  ch: ["","","",""],
  src: `// Shadertoy 7lGyD1 "The Redmond wrinkle" by ruojake (Kristian Sivonen) — 単一パス移植。
//   原作は静止なので、依頼により花びら層を回転/うねりでアニメーション化(iTime 追加)。Slot B は花弁のみ透過合成。
uniform float uSlotIsA;
mat2 rot(float a){ float s = sin(a), c = cos(a); return mat2(c,-s,s,c); }

float scene(vec3 p){
    p.xz *= rot(.2 + iTime*0.10);                       // 全体をゆっくり回転
    float a = atan(p.z, p.x) * 2.5;
    a += length(p.xz) * 1.3 + iTime*0.6;                // 花びらの波が周方向に流れる
    p.xz *= 1. + (sin(a) + sin(a * 2.) * .5 + sin(a * 3.) * .25) * .25;
    float t = abs(abs(abs(abs(abs(length(p.xz) - .5) - .4) - .2) - .1) - .05) - .001;
    return max(t, p.y + 1. - (length(p.xz) * .4 - .1) - .2 * dot(sin(p.xz * 2.5), vec2(p.z * 3. + .5)));
}

vec3 normal(vec3 p, float d){
    const vec2 e = vec2(.00075,0);
    return normalize(d - vec3(scene(p - e.xyy), scene(p - e.yxy), scene(p - e.yyx)));
}

float shadow(vec3 ro, vec3 rd){
    float res = 1.;
    float t = 0.;
    for(int i = 0; i < 96; ++i){                          // 160→96 に短縮
        float d = scene(ro+rd*t);
        res = min(res, 8.*d/t);
        t += d;
    }
    return max(res,0.);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord ){
    vec2 uv = (fragCoord - iResolution.xy * .5) / iResolution.y;
    float dth = fract(dot(fragCoord, vec2(.155013, .61233)));
    vec3 col = vec3(.75 + uv.y * .5),
          ro = vec3(0,.5,-2),
          rd = normalize(vec3(uv, 1)),
          p;
    rd.yz *= rot(.45);
    float i, d = 0., t = dth * .2, hit = 0.;
    for(i = 0.; i < 1. && t < 12.; i += 1./256.){        // 512→256 に短縮
        p = ro + rd * t;
        d = scene(p)*.33;
        if (abs(d) < .0001){ hit = 1.; break; }
        t += d;
    }
    if (hit > .5){
        vec3 n = normal(p,d);
        vec3 ld = normalize(vec3(1,1,-1));
        float frn = pow(1. - max(dot(rd,-n), 0.), 16.);
        float l = dot(ld,n) * .5 + .5;
        l *= l;
        l *= shadow(p + n * .001, ld);
        l = max(l, frn * .5);
        col = mix(vec3(.05, .1, .2), vec3(.1,.3,1.), sqrt(l));
        col = mix(col, vec3(l), l*l*.75);
    }
    col *= 1. - pow(length(fragCoord / iResolution.xy - .5), 3.);
    fragColor = vec4(col + dth / 255., mix(hit, 1.0, uSlotIsA));
}`
}
,
{
  name: "Distant Rings of Light (3ssfD8)",
  ch: ["","","",""],
  src: `// Shadertoy 3ssfD8 "distantringsoflight" by nabr — Image パスのみ移植(Sound パスは音声合成のため除外)。Slot B はリングのみ透過合成。
uniform float uSlotIsA;
void mainImage(out vec4 O, in vec2 U){
    #define t iTime
    vec2 R = iResolution.xy;
    vec3 d = vec3((U - .5 * R) / min(R.x, R.y), .5+(sin(t)*.1+.1));
    vec3 dn = vec3(.314, 1.57, 6.28), dc = vec3(0, 0, 3), c = vec3(sin(t) * .3, .2, .89);
    float ringAlpha = 0.;
    for (int i = 0; i < 6; ++i){
        dn = (cos(.5 * t) * dn - sin(.5 * t) * vec3(dn.y, -dn.x, cos(.5 * t)));
        vec3 D = dot(dn, dc - d) / dot(dn, d) * d - dc;
        float r = 1. - length(3. - dot(D, D));
        if (r > .5){
            vec3 p = r * D + d;
            vec3 l = normalize(20. * vec3(cos(t), sin(t), 1));
            c = .58 - length(r) + vec3(1, .415, .1) * max(0., 1. - dot(l + p, -p));
            ringAlpha = max(ringAlpha, smoothstep(.5, .72, r));
        }
        d += dot(-.0215 * dc, 2. * d) * dc;
    }
    c = 1. - dot(vec3(.2, .5, 1), c) * vec3(.9);
    O = vec4(c, mix(ringAlpha, 1.0, uSlotIsA));
    #undef t
}`
}
,
{
  name: "Cellular Tiling Clouds (NscSWs)",
  ch: ["","","",""],
  src: `// Shadertoy NscSWs "BRM Cellular Tiling Based Clouds" by intrakits — 単一パス移植。
//   ボリューメトリックが極めて重いため march 反復を大幅短縮(666→176 / light を固定4回)。不透明。
#define _StepSize 460.
#define _VolDepth 80000.0
#define _DensityThreshold .1
#define _DensityMultiplier .00005
#define _DarknessThreshold .3
#define _LightAbsorbtion 100.
#define _LightAbsorbtionTowardsSun 100.
#define _PhaseVal 100.

mat3 m = mat3(0.00, 1.60, 1.20, -1.60, 0.72, -0.96, -1.20, -0.96, 1.28);
vec2 cloudHeight = vec2(-2000,2000);
vec3 lightDir = normalize(vec3(0.1,.1,.5));

float drawSphere(in vec3 p){ p = fract(p)-.5; return dot(p, p); }

float cellTile(in vec3 p){
    float c = .25;
    c = min(c, drawSphere(p - vec3(.81, .62, .53)));
    c = min(c, drawSphere(p - vec3(.39, .2, .11)));
    c = min(c, drawSphere(p - vec3(.62, .24, .06)));
    c = min(c, drawSphere(p - vec3(.2, .82, .64)));
    p *= 1.4142;
    c = min(c, drawSphere(p - vec3(.48, .29, .2)));
    c = min(c, drawSphere(p - vec3(.06, .87, .78)));
    c = min(c, drawSphere(p - vec3(.6, .86, .0)));
    c = min(c, drawSphere(p - vec3(.18, .44, .58)));
    return (c*4.);
}

vec3 camera(float time){ return vec3(0,5000.*sin(iTime), time*2000.); }

float getDensity(vec3 pos){
    float n1 = smoothstep(.7,.1,cellTile(pos*.00005));
    float n2 = smoothstep(0.,.5,cellTile(pos*.0001));
    float alpha = smoothstep(0.5, 1.0,n1*n2);
    alpha = max(0.,alpha-_DensityThreshold)*_DensityMultiplier;
    return alpha;
}

float fbm(vec3 p){
    float f = 0.5000 * getDensity(p); p = m * p;
    f += 0.2500 * getDensity(p); p = m * p;
    f += 0.1666 * getDensity(p); p = m * p;
    f += 0.0834 * getDensity(p);
    return f;
}

float lightmarch(vec3 pos){
    float totalDensity = 0.;
    for(int i=0;i<4;i++){                                  // light march を固定4回に
        pos += lightDir * 400.;
        totalDensity += max(0., fbm(pos)*400.);
    }
    float transmittance = exp(-totalDensity * _LightAbsorbtionTowardsSun);
    return _DarknessThreshold + transmittance * (1.-_DarknessThreshold);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord ){
    vec2 uv = 2. * fragCoord.xy / iResolution.xy - 1.0;
    uv.x *= iResolution.x / iResolution.y;
    float time = (iTime + 13.5 + 44.) * 1.0;
    vec3 campos = camera(time);
    vec3 camtar = camera(time + .1);
    vec3 front = normalize(camtar - campos);
    vec3 right = normalize(cross(front, vec3(0.0, 1.0, 0.0)));
    vec3 up = normalize(cross(right, front));
    vec3 fragAt = normalize(uv.x * right + uv.y * up + front);

    vec3 lightE = vec3(0.);
    float transmittance = 1.;
    float suma = 0.;
    for (int i = 0; i < 176; i++){                          // 666→176 に短縮
        float depth = float(i) * _StepSize;
        vec3 ray = campos + fragAt * depth;
        if (cloudHeight.x < ray.y && ray.y < cloudHeight.y){
            float alpha = fbm(ray);
            alpha = (1.0 - suma) * alpha;
            if(alpha > 0.){
                float lightTransmittance = lightmarch(ray);
                lightE += alpha*_StepSize*transmittance*lightTransmittance*_PhaseVal;
                transmittance *= exp(-alpha*_StepSize*_LightAbsorbtion);
                if(transmittance < 0.01) break;
            }
            suma += alpha;
        }
    }
    float sundot = clamp(dot(fragAt, lightDir), 0.0, 1.0);
    vec3 col = 0.8 * (vec3(0,0,1));
    col += 0.47 * vec3(1.6, 1.4, 1.0) * pow(sundot, 350.0);
    col += 0.4 * vec3(0.8, 0.9, 1.0) * pow(sundot, 2.0);
    col = mix(col, lightE, 1.-transmittance);
    fragColor = vec4(col,1.0);
}`
}

,
{
  name: "2D Fern Fractal (3tyyzy)",
  ch: ["","","",""],
  src: `// Shadertoy 3tyyzy "2D fern fractal" by jarble。https://www.shadertoy.com/view/3tyyzy
// 原作コードそのまま (2026-07-25 に Shadertoy から再取得)。変更点は iTime に speed を掛けるだけ。
// @param speed 0..3 = 1
uniform float speed;

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    fragColor = vec4(0.0);
    vec3 col;
    float t;
    
    for(int c=0;c<3;c++){
	    vec2 uv = (-fragCoord*5.0-iResolution.xy)/iResolution.y/10.0;
        uv += vec2((iTime*speed)/2.0,(iTime*speed)/3.0)/8.0;
        t = (iTime*speed)+float(c)/10.;
        float scale = 5.0;
        float scale1 = 1.5;
        float scale2 = 2.0;
        for(int i=0;i<3;i++)
        {
            uv=fract(uv/(scale2+fract((uv.x+uv.y)*2.5))-(uv.yx/(scale2+(fract(uv.x+uv.y))))/scale)*scale/1.5+scale1*scale;
            uv /= scale1;
        	uv=uv.yx+col.xy;
        }
     col[c] = ((uv.x)-(uv.y));
	}
    
    fragColor = vec4(vec3(col),1.0);
    
}`
}
,
{
  name: "Frost Mountains (7sfXW8)",
  ch: ["","","",""],
  src: `// Shadertoy 7sfXW8 "Frost Mountains" by jarble (単一パス移植)。https://www.shadertoy.com/view/7sfXW8
// @param speed 0..3 = 1
uniform float speed;
void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    fragColor = vec4(0.0);
    vec3 col;
    vec3 col_prev;
    float t = iTime*2.0*speed;
    vec2 uv = (fragCoord*10.0-iResolution.xy)/iResolution.y/10.0;
    uv += vec2(t/2.0,t/3.0)/4.0;
    for(int c=0;c<3;c++){
        float scale = 5.5;
        float scale1 = 1.4;
        float s1 = scale1*scale;
        for(int i=0;i<9;i++)
        {
            col_prev = col;
            uv = fract(uv/s1)*s1;
            uv=-fract(uv/(2.0-abs((uv.x-uv.y)/(16.0)))-(uv/(2.5+(fract(uv.x+uv.y))))/scale)*scale/scale1+s1;
            uv /= scale1+col.yx;
        	uv=uv.yx+col.xy;
            //uv.x *= -(1.0+col.x/scale);
            col[c] = (fract((.25*col.x+uv.y-uv.x/2.0)/2.5));
            col = (col + col_prev.yzx)/2.0;
        }
     
	}
    
    fragColor = vec4(vec3(col),1.0);
    
}
`
}
,
{
  name: "Cave Edge of Universe (ttfBDH)",
  ch: ["","","",""],
  src: `// Shadertoy ttfBDH "Cave at the Edge of the Universe" by jarble (単一パス移植)。https://www.shadertoy.com/view/ttfBDH
// マウスで視点回転 (M で iMouse 取得 ON)。based on https://www.shadertoy.com/view/4tcGDr
// VJ: 距離関数の入力に多段ドメインワープ (fbm 的な入れ子ワープ + 捻り) を掛けて、
// 洞窟の壁をぐちゃぐちゃに撹拌する。warpPct=0 で原作。
// @param speed 0..3 = 1
// @param warpPct 0..100 = 70
// @param churnPct 0..100 = 60
// @param twistPct 0..100 = 45
// @param steps 40..400 = 70
// @param iters 6..20 = 20
// @param stride 100..600 = 500
// @param randPct 0..100 = 65
// @param seedRate 1..12 = 3
uniform float speed;
uniform float warpPct;   // ワープの振幅
uniform float churnPct;  // 撹拌の速さ (時間項)
uniform float twistPct;  // 進行方向まわりの捻り
uniform float steps;     // マーチング上限 (原作は1000)
uniform float stride;    // 歩幅倍率。この式は真の距離ではないので大股でも壊れず、歩数を大幅に削れる
uniform float iters;     // 壁の生成反復 (原作=20。下げると軽いが壁が薄くなり空洞が増える)
uniform float randPct;   // ランダムネス: 値ノイズ + 乱数位相の量
uniform float seedRate;  // 1秒あたり何回 乱数位相が切り替わるか
float WT_;               // ワープ用の時刻 (mainImage で設定)
vec3 RP_;                // スナップごとに切り替わる乱数位相
float RN_;               // ランダムネス量 0..1
float h31(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7)))*43758.5453); }

//this is based on https://www.shadertoy.com/view/4tcGDr

#define rot(spin) mat2(cos(spin),sin(spin),-sin(spin),cos(spin))

// 原作は 1000 歩の定数ループ = ANGLE で展開されて重い。uniform 依存の上限に変換。
const float MIN_DIST = 0.0;
const float MAX_DIST = 10000.0;
const float EPSILON = 0.001;
#define ITERATIONS 20

const float size = 1000.0;


const float scale = EPSILON*10.0; //to prevent rendering artifacts

/**
 * Signed distance function describing the scene.
 * 
 * Absolute value of the return value indicates the distance to the surface.
 * Sign indicates whether the point is inside or outside the surface,
 * negative indicating inside.
 */


float sceneSDF(vec3 p) {
    p /= 20.0;
    // ---- 多段ドメインワープ: 壁をぐちゃぐちゃに撹拌する ----
    float w = warpPct*0.01;
    if(w > 0.001){
        float ct = WT_ * (0.3 + 1.7*churnPct*0.01);
        // 1段目: 大きくうねる (乱数位相を混ぜて周期の重なりを崩す)
        vec3 q = p;
        q += w*0.55*vec3(sin(p.y*0.9 + ct*0.7),
                         sin(p.z*0.8 - ct*0.5),
                         sin(p.x*1.1 + ct*0.6));
        // 2段目: 1段目の結果を入力にして細かく折る (入れ子ワープ)
        q += w*0.28*vec3(sin(q.z*2.3 - ct*1.3 + RP_.y),
                         sin(q.x*2.7 + ct*1.1 + RP_.z),
                         sin(q.y*2.1 - ct*1.7 + RP_.x));
        // 3段目: 無理数比の周波数を重ねて非周期にする (値ノイズは hash が重いので使わない)
        if(RN_ > 0.001){
            float e1 = sin(q.y*4.7321 + ct*1.9 + RP_.x) * sin(q.z*2.2361 - ct*0.7 + RP_.y);
            float e2 = sin(q.z*5.3166 - ct*2.3 + RP_.y) * sin(q.x*3.1623 + ct*0.9 + RP_.z);
            float e3 = sin(q.x*6.0828 + ct*1.7 + RP_.z) * sin(q.y*2.6458 - ct*1.1 + RP_.x);
            q += w*RN_*0.26*vec3(e1, e2, e3);
        }
        // 進行方向(z)まわりの捻り
        float tw = twistPct*0.01;
        if(tw > 0.001){
            float a = tw*(0.9*sin(p.z*0.35 + ct*0.4 + RP_.z) + 0.5*sin(p.z*0.8 - ct*0.25));
            q.xy *= mat2(cos(a), sin(a), -sin(a), cos(a));
        }
        p = q;
    }
	vec2 uv = p.xy - vec2(.5);
    float time = p.z * 2. + 15.+length(sin(uv/10.0));
    uv = sin(uv/(20.0+sin(uv.yx/20.0+time)))*3.0;
    
    float len = dot(uv, uv) * .3 - .4;
    
    vec3 z = sin(time + vec3(.23, .19, .17));
    int NIT = int(min(iters, iResolution.y));
    for (int i = 0; i < NIT; i++) {
        z += cos(z.zxy + uv.yxy * float(i) * len);
    }
    
    float val = z.r * .06 + .3;
    val -= smoothstep(.1, -.3, len) * 1.5 + len * .3 - .4;
    return val;
}


vec3 surface_color(vec3 p)
{
    p /= scale;
    p /= 200.0;
    return sin(vec3(sceneSDF(p/5.0),sceneSDF(p*3.0),sceneSDF(p*2.0)))/3.0+vec3(.3);
}


/**
 * Return the shortest distance from the eyepoint to the scene surface along
 * the marching direction. If no part of the surface is found between start and end,
 * return end.
 * 
 * eye: the eye point, acting as the origin of the ray
 * marchingDirection: the normalized direction to march in
 * start: the starting distance away from the eye
 * end: the max distance away from the ey to march before giving up
 */
float shortestDistanceToSurface(vec3 eye, vec3 marchingDirection, float start, float end) {
    float depth = start;
    int MS = int(min(steps, iResolution.x));
    for (int i = 0; i < MS; i++) {
        float dist = sceneSDF(eye + depth * marchingDirection);
        if (dist < EPSILON) {
			return depth;
        }
        depth += dist*(stride*0.01);
        if (depth >= end) {
            return end;
        }
    }
    return end;
}
            

/**
 * Return the normalized direction to march in from the eye point for a single pixel.
 * 
 * fieldOfView: vertical field of view in degrees
 * size: resolution of the output image
 * fragCoord: the x,y coordinate of the pixel in the output image
 */
vec3 rayDirection(float fieldOfView, vec2 size, vec2 fragCoord) {
    vec2 xy = fragCoord - size / 2.0;
    float z = size.y / tan(radians(fieldOfView) / 2.0);
    return normalize(vec3(xy, -z));
}

/**
 * Using the gradient of the SDF, estimate the normal on the surface at point p.
 */
vec3 estimateNormal(vec3 p) {
    return normalize(vec3(
        sceneSDF(vec3(p.x + EPSILON, p.y, p.z)) - sceneSDF(vec3(p.x - EPSILON, p.y, p.z)),
        sceneSDF(vec3(p.x, p.y + EPSILON, p.z)) - sceneSDF(vec3(p.x, p.y - EPSILON, p.z)),
        sceneSDF(vec3(p.x, p.y, p.z  + EPSILON)) - sceneSDF(vec3(p.x, p.y, p.z - EPSILON))
    ));
}

/**
 * Lighting contribution of a single point light source via Phong illumination.
 * 
 * The vec3 returned is the RGB color of the light's contribution.
 *
 * k_a: Ambient color
 * k_d: Diffuse color
 * k_s: Specular color
 * alpha: Shininess coefficient
 * p: position of point being lit
 * eye: the position of the camera
 * lightPos: the position of the light
 * lightIntensity: color/intensity of the light
 *
 * See https://en.wikipedia.org/wiki/Phong_reflection_model#Description
 */
vec3 phongContribForLight(vec3 k_d, vec3 k_s, float alpha, vec3 p, vec3 eye,
                          vec3 lightPos, vec3 lightIntensity) {
    lightPos = eye;
    vec3 N = estimateNormal(p);
    vec3 L = normalize(lightPos - p);
    vec3 V = normalize(eye - p);
    vec3 R = normalize(reflect(-L, N));
    
    float dotLN = dot(L, N);
    float dotRV = dot(R, V);
    
    if (dotLN < 0.0) {
        // Light not visible from this point on the surface
        return vec3(0.0, 0.0, 0.0);
    } 
    
    if (dotRV < 0.0) {
        // Light reflection in opposite direction as viewer, apply only diffuse
        // component
        return lightIntensity * (k_d * dotLN);
    }
    return lightIntensity * (k_d * dotLN + k_s * pow(dotRV, alpha));
}

/**
 * Lighting via Phong illumination.
 * 
 * The vec3 returned is the RGB color of that point after lighting is applied.
 * k_a: Ambient color
 * k_d: Diffuse color
 * k_s: Specular color
 * alpha: Shininess coefficient
 * p: position of point being lit
 * eye: the position of the camera
 *
 * See https://en.wikipedia.org/wiki/Phong_reflection_model#Description
 */
vec3 phongIllumination(vec3 k_a, vec3 k_d, vec3 k_s, float alpha, vec3 p, vec3 eye) {
    const vec3 ambientLight = 0.5 * vec3(1.0, 1.0, 1.0);
    vec3 color = ambientLight * k_a;
    
    vec3 light1Pos = vec3(4.0,
                          2.0,
                          4.0);
    vec3 light1Intensity = vec3(0.8);
    
    color += phongContribForLight(k_d, k_s, alpha, p, eye,
                                  light1Pos,
                                  light1Intensity);   
    return color;
}

/**
 * Return a transform matrix that will transform a ray from view space
 * to world coordinates, given the eye point, the camera target, and an up vector.
 *
 * This assumes that the center of the camera is aligned with the negative z axis in
 * view space when calculating the ray marching direction. See rayDirection.
 */
mat3 viewMatrix(vec3 eye, vec3 center, vec3 up) {
    // Based on gluLookAt man page
    vec3 f = normalize(center - eye);
    vec3 s = normalize(cross(f, up));
    vec3 u = cross(s, f);
    return mat3(s, u, -f);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
	vec3 viewDir = rayDirection(45.0, iResolution.xy, fragCoord);
    if (length(iMouse.xy) > 40.0) {
        viewDir.yz *= rot(3.14*0.5-iMouse.y/iResolution.y*3.14);
        viewDir.xz *= rot(3.14-iMouse.x/iResolution.x*3.14*2.0);
    }
    
    float t1 = iTime*speed;
    WT_ = t1;
    RN_ = randPct*0.01;
    // 乱数位相: seedRate 回/秒 のタイミングで別の乱数へ急峻に切り替わる
    {
        float k = floor(t1*seedRate);
        float e = pow(fract(t1*seedRate), 5.0);
        vec3 r1 = vec3(h31(vec3(k, 1.7, 3.1)), h31(vec3(k, 5.3, 9.7)), h31(vec3(k, 13.1, 4.3)));
        vec3 r2 = vec3(h31(vec3(k+1.0, 1.7, 3.1)), h31(vec3(k+1.0, 5.3, 9.7)), h31(vec3(k+1.0, 13.1, 4.3)));
        RP_ = (mix(r1, r2, e) - 0.5) * 2.4 * RN_;
    }
	vec3 eye = vec3(-10.0-200.0,9.0-15.0,9.0*t1);
    
    mat3 viewToWorld = -viewMatrix(eye, vec3(0.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0));
    
    vec3 worldDir = viewToWorld * viewDir;
    
    float dist = shortestDistanceToSurface(eye, worldDir, MIN_DIST, MAX_DIST);
    
    if (dist > MAX_DIST - EPSILON) {
        // Didn't hit anything
        fragColor = vec4(0.0, 0.0, 0.0, 0.0);
		return;
    }
    
    // The closest point on the surface to the eyepoint along the view ray
    vec3 p = eye + dist * worldDir;
    
    // Use the surface normal as the ambient color of the material
    vec3 K_a = surface_color((p));
    vec3 K_d = K_a;
    vec3 K_s = vec3(1.0, 1.0, 1.0);
    float shininess = 100.0;
    
    vec3 color = phongIllumination(K_a, K_d, K_s, shininess, p, eye);
    
    fragColor = vec4(color, 1.0);
}`
}
,
{
  name: "Fractal Foliage 3 (WtByzw)",
  ch: ["","","",""],
  src: `// Shadertoy WtByzw "Fractal foliage 3" by jarble (common+image を単一パスへ結合)。https://www.shadertoy.com/view/WtByzw
// マウスで視点回転 (M で iMouse 取得 ON)。based on https://www.shadertoy.com/view/4tcGDr
// @param speed 0..3 = 1
uniform float speed;
#define rot(spin) mat2(cos(spin),sin(spin),-sin(spin),cos(spin))

const int MAX_MARCHING_STEPS = 500;
const float MIN_DIST = 0.0;
const float MAX_DIST = 10000.0;
const float EPSILON = 0.001;

const float size = 1000.0;


const float scale = EPSILON*10.0; //to prevent rendering artifacts

//this is based on https://www.shadertoy.com/view/4tcGDr

/**
 * Signed distance function describing the scene.
 * 
 * Absolute value of the return value indicates the distance to the surface.
 * Sign indicates whether the point is inside or outside the surface,
 * negative indicating inside.
 */

vec3 warp(vec3 p){
    vec3 a = p.zxy;
    return (sin(a)+cos(a))*500.0;
}

float planet_surface(vec3 p){
    p = (p + warp(p/1000.0))/size;
    p = (sin(p.yzx*(cos(p)+sin(p.yxz))))*size;
    return length(p) - size;
}



float sceneSDF(vec3 p) {
    p /= scale;


    float result = 0.0;
    p = sin(p/500000.0)*50000.0;

    for(float i = 1.0; i < 9.0; i *= 3.0){
        result += planet_surface(p*i)/(i*i);
    }
    //float result = sceneSDF1(p/1000.0+sceneSDF1(p/1000.0));
    return result*scale;
}

vec3 surface_color(vec3 p)
{
    p /= scale*500.0;
    return sin(vec3(sceneSDF(p)+.5,sceneSDF(p),sceneSDF(p*10.0)))/4.0+vec3(.6,.5,.2)*1.3;
}


/**
 * Return the shortest distance from the eyepoint to the scene surface along
 * the marching direction. If no part of the surface is found between start and end,
 * return end.
 * 
 * eye: the eye point, acting as the origin of the ray
 * marchingDirection: the normalized direction to march in
 * start: the starting distance away from the eye
 * end: the max distance away from the ey to march before giving up
 */
float shortestDistanceToSurface(vec3 eye, vec3 marchingDirection, float start, float end) {
    float depth = start;
    float eps = EPSILON;
    for (int i = 0; i < MAX_MARCHING_STEPS; i++) {
        float dist = sceneSDF(eye + depth * marchingDirection);
        if (dist < eps*(1.0+depth)) {
			return depth;
        }
        depth += dist;
        eps *= 1.001;
        if (depth >= end) {
            return end;
        }
    }
    return end;
}
            

/**
 * Return the normalized direction to march in from the eye point for a single pixel.
 * 
 * fieldOfView: vertical field of view in degrees
 * size: resolution of the output image
 * fragCoord: the x,y coordinate of the pixel in the output image
 */
vec3 rayDirection(float fieldOfView, vec2 size, vec2 fragCoord) {
    vec2 xy = fragCoord - size / 2.0;
    float z = size.y / tan(radians(fieldOfView) / 2.0);
    return normalize(vec3(xy, -z));
}

/**
 * Using the gradient of the SDF, estimate the normal on the surface at point p.
 */
vec3 estimateNormal(vec3 p) {
    return normalize(vec3(
        sceneSDF(vec3(p.x + EPSILON, p.y, p.z)) - sceneSDF(vec3(p.x - EPSILON, p.y, p.z)),
        sceneSDF(vec3(p.x, p.y + EPSILON, p.z)) - sceneSDF(vec3(p.x, p.y - EPSILON, p.z)),
        sceneSDF(vec3(p.x, p.y, p.z  + EPSILON)) - sceneSDF(vec3(p.x, p.y, p.z - EPSILON))
    ));
}

/**
 * Lighting contribution of a single point light source via Phong illumination.
 * 
 * The vec3 returned is the RGB color of the light's contribution.
 *
 * k_a: Ambient color
 * k_d: Diffuse color
 * k_s: Specular color
 * alpha: Shininess coefficient
 * p: position of point being lit
 * eye: the position of the camera
 * lightPos: the position of the light
 * lightIntensity: color/intensity of the light
 *
 * See https://en.wikipedia.org/wiki/Phong_reflection_model#Description
 */
vec3 phongContribForLight(vec3 k_d, vec3 k_s, float alpha, vec3 p, vec3 eye,
                          vec3 lightPos, vec3 lightIntensity) {
    lightPos = eye;
    vec3 N = estimateNormal(p);
    vec3 L = normalize(lightPos - p);
    vec3 V = normalize(eye - p);
    vec3 R = normalize(reflect(-L, N));
    
    float dotLN = dot(L, N);
    float dotRV = dot(R, V);
    
    if (dotLN < 0.0) {
        // Light not visible from this point on the surface
        return vec3(0.0, 0.0, 0.0);
    } 
    
    if (dotRV < 0.0) {
        // Light reflection in opposite direction as viewer, apply only diffuse
        // component
        return lightIntensity * (k_d * dotLN);
    }
    return lightIntensity * (k_d * dotLN + k_s * pow(dotRV, alpha));
}

/**
 * Lighting via Phong illumination.
 * 
 * The vec3 returned is the RGB color of that point after lighting is applied.
 * k_a: Ambient color
 * k_d: Diffuse color
 * k_s: Specular color
 * alpha: Shininess coefficient
 * p: position of point being lit
 * eye: the position of the camera
 *
 * See https://en.wikipedia.org/wiki/Phong_reflection_model#Description
 */
vec3 phongIllumination(vec3 k_a, vec3 k_d, vec3 k_s, float alpha, vec3 p, vec3 eye) {
    const vec3 ambientLight = 0.5 * vec3(1.0, 1.0, 1.0);
    vec3 color = ambientLight * k_a;
    
    vec3 light1Pos = vec3(4.0,
                          2.0,
                          4.0);
    vec3 light1Intensity = vec3(0.8);
    
    color += phongContribForLight(k_d, k_s, alpha, p, eye,
                                  light1Pos,
                                  light1Intensity);   
    return color;
}

/**
 * Return a transform matrix that will transform a ray from view space
 * to world coordinates, given the eye point, the camera target, and an up vector.
 *
 * This assumes that the center of the camera is aligned with the negative z axis in
 * view space when calculating the ray marching direction. See rayDirection.
 */
mat3 viewMatrix(vec3 eye, vec3 center, vec3 up) {
    // Based on gluLookAt man page
    vec3 f = normalize(center - eye);
    vec3 s = normalize(cross(f, up));
    vec3 u = cross(s, f);
    return mat3(s, u, -f);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
	vec3 viewDir = rayDirection(45.0, iResolution.xy, fragCoord);
        if (length(iMouse.xy) > 40.0) {
            viewDir.yz *= rot(-iMouse.y/iResolution.y*3.14+3.14*0.5);
            viewDir.xz *= rot(-iMouse.x/iResolution.x*3.14*2.0+3.14);
        }
    
	vec3 eye = vec3(50.0,30.0,iTime*100.0*speed);
    
    mat3 viewToWorld = -viewMatrix(eye, vec3(0.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0));
    
    vec3 worldDir = viewToWorld * viewDir;
    
    float dist = shortestDistanceToSurface(eye, worldDir, MIN_DIST, MAX_DIST);
    
    if (dist > MAX_DIST - EPSILON) {
        // Didn't hit anything
        fragColor = vec4(0.0, 0.0, 0.0, 0.0);
		return;
    }
    
    // The closest point on the surface to the eyepoint along the view ray
    vec3 p = eye + dist * worldDir;
    
    // Use the surface normal as the ambient color of the material
    vec3 K_a = surface_color((p));
    vec3 K_d = K_a;
    vec3 K_s = vec3(1.0, 1.0, 1.0);
    float shininess = 100.0;
    
    vec3 color = phongIllumination(K_a, K_d, K_s, shininess, p, eye);
    
    fragColor = vec4(color, 1.0);
}`
}


,
{
  name: "Chinese Dragon Head (ldV3DD)",
  ch: ["","","",""],
  src: `// Shadertoy ldV3DD "Chinese dragon head" by sben (buffer+image を単一パス化)。https://www.shadertoy.com/view/ldV3DD
// VJ 版の変更点: 格子(スキャンライン)除去 / 暗転(全黒の時間帯)を除去 /
//   黒い炎が燃え上がるように、模様が下から上へ舐めるように立ち上がって崩れる
// @param speed 0..3 = 1
// @param flame 0..40 = 18
// @param bright 50..300 = 115
uniform float speed;
uniform float flame;   // 炎の勢い (deadParam 対策で >1 単位。実値 = flame*0.01)
uniform float bright;  // 明るさ (%)。原作の上限クランプが 0.35 前後で頭打ちになり全体が暗いため

// 原作 Buffer A の手続き (無改変)
vec3 dragonField(vec2 uv, float T){
    // 黒い炎: 下から上へ舐め上がる不規則な立ち上がり + 上に行くほど乱れる
    float w = flame*0.01;
    float h = 1.0 - uv.y;                                  // 下=0 上=1 の高さ
    float rise = fract(T*0.35);                            // 炎が立ち上がる周期
    // 火柱の縦方向の舌: 高さが上がるほど速く流れ、上端でちぎれる
    uv.y += w*(0.20*h*h) * sin(uv.x*9.0 - T*2.6);
    uv.y -= w*0.55*h*rise;                                 // 舐め上がる流れ
    uv.x += w*(0.16*h) * sin(uv.y*11.0 - T*3.1 + sin(T*0.7)*2.0);
    // 火先の千切れ (上部だけ強く乱す)
    uv += w*0.10*smoothstep(0.35,1.0,h)*vec2(sin(uv.y*17.0-T*4.2), cos(uv.x*15.0+T*3.7));
    vec2 position = uv - vec2(0.5,0.25);
    vec2 p2 = position - vec2(0.,0.2);
    float t = cos(sin(T)+T)*.8;
    // 炎の脈動 (揺らぎながら太く細くなる)
    float m1 = 1.0 + w*0.7*sin(T*1.7) + w*0.4*sin(T*0.53+1.1);
    float m2 = 1.0 + w*1.0*sin(T*1.3+0.8);
    position *= vec2(3.,1.5)*vec2(sign(position.x)*60.*m1, 25.*m2);
    position.x = 1.4-t-(cos(p2.y)+(0.5*position.x));
    position.y += t+cos(position.x)-8.;
    vec3 color = vec3(0.01);
    float a = 0.25-p2.y*0.1;
    float b = 2.3;
    vec2 p = (1.9/(position-1.5));
    for(float i=-1.0; i<5.; i++){
        float j = i*length(position+1.*p.x);
        if(mod(i,2.0)==0.){ j=0.; b-=p.x+.35+a*i*i; }
        color.g += 0.2;
        p.x = 0.1+p.x*(a-b);
        position.x *= (a*b)*cos(1./p.y+(i*j));
        position.x += 0.002*sign(p.x);
        position.y += (a*b)*sin(p.x+i*j);
        position.y += sin(j)*exp2(a*b);
        p.y /= 1.05*p.y-p2.y;
        p.y *= 5.5*p.x;
    }
    color.r /= p.x*position.x;
    color.b += color.r/a;
    color.g += color.b-p2.y;
    color.rgb = color.gbr/a-p2.y;
    color.r -= p.x*.1;
    // VJ: 上限から時間項 t を外し、明度が時間で沈む(暗転する)のを完全に無くす。
    // さらに上限の下限を上げて (0.35→0.62) 頭打ちを緩め、bright でゲインを掛ける。
    return clamp(color, 0., max(1./length(color), 0.62)) * (bright*0.01);
}
// 原作 Image パスの RGB チャンネルオフセット (色収差)
void mainImage( out vec4 fragColor, in vec2 fragCoord ){
    vec2 uv = fragCoord.xy / iResolution.xy;
    vec2 pixel = 2./iResolution.xy;
    float T = iTime*speed;
    vec3 color = vec3(0.);
    color.r = dragonField(uv+pixel.xx, T).r;
    color.g = dragonField(uv+pixel.xy, T).g;
    color.b = dragonField(uv+pixel.yy, T).b;
    fragColor = vec4(color,1.0);
}`
}
,
{
  name: "dzenflow (cdcBDj)",
  ch: ["","","",""],
  src: `// Shadertoy cdcBDj "dzenflow" by Nabuki (原作そのまま単一パス)。https://www.shadertoy.com/view/cdcBDj
// @param speed 0..3 = 1
// @param radiusPct 2..40 = 10
// @param glowPct 5..150 = 50
// @param grain 0..30 = 10
uniform float speed;
uniform float radiusPct;   // 0..1 だと deadParam に潰されるため % 指定
uniform float glowPct;
uniform float grain;
const float sharpness = 30.0;
float density = 1500.0;

float hash(vec2 p)
{
  vec3 p3  = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 19.19);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 random3(vec3 c) {
  float j = 4096.0*sin(dot(c,vec3(17.0, 59.4, 15.0)));
  vec3 r;
  r.z = fract(512.0*j);
  j *= .125;
  r.x = fract(512.0*j);
  j *= .125;
  r.y = fract(512.0*j);
  return r-0.5;
}

/* skew constants for 3d simplex functions */
const float F3 =  0.3333333;
const float G3 =  0.1666667;

/* 3d simplex noise */
float simplex3d(vec3 p) {
  /* 1. find current tetrahedron T and it's four vertices */
  /* s, s+i1, s+i2, s+1.0 - absolute skewed (integer) coordinates of T vertices */
  /* x, x1, x2, x3 - unskewed coordinates of p relative to each of T vertices*/
  
  /* calculate s and x */
  vec3 s = floor(p + dot(p, vec3(F3)));
  vec3 x = p - s + dot(s, vec3(G3));
  
  /* calculate i1 and i2 */
  vec3 e = step(vec3(0.0), x - x.yzx);
  vec3 i1 = e*(1.0 - e.zxy);
  vec3 i2 = 1.0 - e.zxy*(1.0 - e);
    
  /* x1, x2, x3 */
  vec3 x1 = x - i1 + G3;
  vec3 x2 = x - i2 + 2.0*G3;
  vec3 x3 = x - 1.0 + 3.0*G3;
  
  /* 2. find four surflets and store them in d */
  vec4 w, d;
  
  /* calculate surflet weights */
  w.x = dot(x, x);
  w.y = dot(x1, x1);
  w.z = dot(x2, x2);
  w.w = dot(x3, x3);
  
  /* w fades from 0.6 at the center of the surflet to 0.0 at the margin */
  w = max(0.6 - w, 0.0);
  
  /* calculate surflet components */
  d.x = dot(random3(s), x);
  d.y = dot(random3(s + i1), x1);
  d.z = dot(random3(s + i2), x2);
  d.w = dot(random3(s + 1.0), x3);
  
  /* multiply d by w^4 */
  w *= w;
  w *= w;
  d *= w;
  
  /* 3. return the sum of the four surflets */
  return dot(d, vec4(52.0));
}

/* const matrices for 3d rotation */
const mat3 rot1 = mat3(-0.37, 0.36, 0.85,-0.14,-0.93, 0.34,0.92, 0.01,0.4);
const mat3 rot2 = mat3(-0.55,-0.39, 0.74, 0.33,-0.91,-0.24,0.77, 0.12,0.63);
const mat3 rot3 = mat3(-0.71, 0.52,-0.47,-0.08,-0.72,-0.68,-0.7,-0.45,0.56);

/* directional artifacts can be reduced by rotating each octave */
float simplex3d_fractal(vec3 m) {
  return   0.5333333*simplex3d(m*rot1)
    +0.2666667*simplex3d(2.0*m*rot2)
    +0.1333333*simplex3d(4.0*m*rot3)
    +0.0666667*simplex3d(8.0*m);
}

void mainImage(out vec4 fragColor, in vec2 _fragCoord) {
  vec2 fragCoord = _fragCoord.xy;
  float radius = radiusPct*0.01;
  float glow   = glowPct*0.01;
  vec2 p=(fragCoord.xy-.5*iResolution.xy)/min(iResolution.x,iResolution.y);
  vec3 p3 = vec3(p, iTime*0.2*speed);
  float s3d = simplex3d(p3);
  vec3 c=vec3(0,0,0); //background color

  vec2 o;

  // layer 1 green
  // vec3 l1Col = vec3(31./255., 128./255., 76./255.);
  // float l1Inf = 0.;
  // for (float i = 1.;i<sharpness;i++) {
  //     o = vec2(s3d, -s3d)*i;
  //     l1Inf = mix(1., l1Inf, smoothstep(radius, radius+glow, length(o-p)));
  // }
  // c = mix(c, l1Col, l1Inf);

  // layer 2 blue
  vec3 l2Col = vec3(45./255., 65./255., 171./255.);
  float l2Inf = 0.;
  for (float i = 1.;i<sharpness;i++) {
      o = vec2(s3d, -s3d)*i;
      l2Inf = mix(1., l2Inf, smoothstep(radius, radius+glow, length(o-p)));
  }
  c = mix(c, l2Col, l2Inf);

  // hash effect
  float h = hash(floor(density*(fragCoord/iResolution.xy)));
  c *= exp(-grain*h/max(c,1e-3))*(1.0+sin(iTime*100.0*speed*h))/2.0+1.0;

  fragColor = vec4(c, 1);
}`
}
,
{
  name: "Decoders (3X2Szc)",
  ch: ["","","",""],
  src: `// Shadertoy 3X2Szc "decoders" by leroyJS (原作そのまま単一パス)。https://www.shadertoy.com/view/3X2Szc
// VJ: contrast/gain でコントラスト可変。さらにグラデ部分を内蔵の Dither Blur で溶かす
// (Post FX の Dither Blur と同じ構成 = ジッター付き 4-tap Kawase を 2 半径で平均。
//  ただしブロック内の localUV に対して掛けるので、ブロックの境界は鋭いまま残る)。
// @param speed 0..3 = 1
// @param contrast 1..4 = 1.1
// @param gain 1..2.5 = 1.05
// @param blackPct 0..90 = 40
// @param rows 4..24 = 10
// @param ditherPct 0..100 = 55
uniform float speed;
uniform float contrast;
uniform float gain;
uniform float blackPct;   // 黒ブロック率 (%) — 0..1 だと deadParam に潰されるため % 指定
uniform float rows;       // 行数 — 同上 (BLOCK_HEIGHT = 1/rows)
uniform float ditherPct;  // グラデを溶かす量 (0=素のグラデ)
// Псевдорандом на основе координат
float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233)) ) * 43758.5453);
}

float getRandomByTime (vec2 id, float timeCoef) {
    return mix(0., 1., sin(iTime * timeCoef * speed + rand(id) * 200.));
}

// 原作の階調変換 (反転 → -0.1 → 0.8 でクリップ → 二乗) + VJ の contrast/gain。
// 非線形なので、ジッターしたサンプルをここに通してから平均すると階調が溶ける。
float toneOf(float g, float hasGradient, float reverse){
    if(reverse > 0.5) g = 1.0 - g;
    float b = g*hasGradient - 0.1;
    if(b > 0.8) b = 0.8;
    float v = clamp(b*b, 0.0, 1.0);
    v = clamp((v - 0.5)*contrast + 0.5, 0.0, 1.0);
    return clamp(v*gain, 0.0, 1.0);
}

const float MIN_WIDTH = 0.08;
const float MAX_WIDTH = 0.18;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord.xy / iResolution.xy;

    // Базовая высота блока
    

    // Считаем текущую строку по Y
    float BLOCK_HEIGHT = 1.0/max(rows,1.0);
    float rowNumber = floor(uv.y / BLOCK_HEIGHT);

    // Ищем начало ближайшего блока по X
    float blockWidth = 0.0;
    float leftOffsetWidth = 0.0;
    float totalRowWidth = 0.0;
    float blockX = 0.0;

    int blockRowIndex = 0; 
    bool hasBlockInfo = false;
    int i = 0;
    
    while (i < 10) { 
        vec2 blockID = vec2(blockRowIndex, rowNumber);
        
        float w = mix(MIN_WIDTH, MAX_WIDTH, rand(vec2(rowNumber, float(blockRowIndex)))) + getRandomByTime(blockID , .5)/10.;
        
        if(hasBlockInfo == false){
            if (leftOffsetWidth + w > uv.x) {
                blockX = leftOffsetWidth;
                blockWidth = w;

                hasBlockInfo = true;

                break;
            } else {
                leftOffsetWidth += w;

                blockRowIndex++;
            }
        }
        
        totalRowWidth += w;
        
        i++;
    }
    
    // Уникальный ID блока
    vec2 currentBlockID = vec2(blockRowIndex, rowNumber);
    
    float offset = 0.5;
    
    // Локальные UV внутри блока
    vec2 localUV = vec2((uv.x - blockX ) / (blockWidth), fract(uv.y / BLOCK_HEIGHT));

    // Градиент
    float randVal = rand(currentBlockID);
    float hasGradient = step(blackPct*0.01, randVal);
    float reverse = step(0.5, rand(currentBlockID + 12.3));

    float gShift = getRandomByTime(currentBlockID * 8., .2) * getRandomByTime(currentBlockID * 0.2, .6);
    float g0 = localUV.x + gShift;

    // ---- 内蔵 Dither Blur ----
    // Post FX 版と同じ構成 (ジッター付き 4-tap Kawase を 2 半径で平均 / 同じ指数カーブ)。
    // ただし平均するのは階調変換の *後* の値。直線グラデを線形に平均すると
    // 対称タップが打ち消し合って何も起きないため、非線形を通してから平均する。
    // ブロック内の localUV に対して掛けるので、ブロック境界は鋭いまま残る。
    float v;
    float dAmt = ditherPct*0.01;
    if(dAmt > 0.001){
        float d = (exp2(4.0*dAmt) - 1.0)/15.0;
        float r = 0.35*d;
        float acc = 0.0;
        for(int k = 0; k < 2; k++){
            float rr = r*(k == 0 ? 1.0 : 2.0);
            vec2 j = (vec2(rand(uv*713.7 + float(k)), rand(uv*331.1 + float(k) + 0.47)) - 0.5)*2.0*rr;
            acc += toneOf(g0 + j.x + j.y, hasGradient, reverse);
            acc += toneOf(g0 - j.x + j.y, hasGradient, reverse);
            acc += toneOf(g0 - j.x - j.y, hasGradient, reverse);
            acc += toneOf(g0 + j.x - j.y, hasGradient, reverse);
        }
        v = acc/8.0;
    } else {
        v = toneOf(g0, hasGradient, reverse);
    }
    fragColor = vec4(vec3(v), 1.0);
}`
}
,
{
  name: "Pool Caustics (4tV3WD)",
  ch: ["","","",""],
  src: `// Shadertoy 4tV3WD "Pool Like Template" by Imsure1200q_1UWE130 (単一パス)。https://www.shadertoy.com/view/4tV3WD
// VJ: 原作はほぼ静止画のため、水面のドメインワープで揺らぎを追加 (wavePct=0 で原作同等)。
// @param speed 0..3 = 1
// @param wavePct 0..60 = 25
uniform float speed;
uniform float wavePct;
//Random Number
float rand(vec2 co){
    return fract(sin(dot(co ,vec2(12.9898,78.233))) * 43758.5453);
}
//Noise
float noise(float p){
    float fl = floor(p);
  float fc = fract(p);
    return float(mix(rand(vec2(fl)), rand(vec2(fl + 1.0)), fc));
}
//Noise 2
float noise(vec2 n) {
    const vec2 d = vec2(0.0, 1.0);
  vec2 b = floor(n), f = smoothstep(vec2(0.0), vec2(1.0), fract(n));
    return mix(mix(rand(b), rand(b + d.yx), f.x), mix(rand(b + d.xy), rand(b + d.yy), f.x), f.y);
}
//Central Development Of Shader (CDS)        -|• |
//Shader Central Processing Function (SCPF)  -|• v
//Xylem of Mental Target of Shader (XMTS)    -|•
//                                            \-/
// /-------------------------------------------/
// v
float xmts(vec2 u, vec4 gram, float t, vec3 x, float a)
{
    //Increase Activity Level For Better Performance
    a *= 3.0;
    //Increase Limit Of Activity Steps For Bigger And Cleaner Scene
    t += length(a);
    //Make Rhombuses
    //Corner 1
    if(vec4(u, u) == vec4(gram.xz,gram.xz)){
        gram.yw += u;}
    //Corner 2
    else if(vec4(u, u) == vec4(gram.yw,gram.yw)){
        gram.xz += u;}
    //Corner 3
    else if(vec4(u, u) == vec4(gram.xz,gram.xz)){
        gram.yw -= u;}
    //Corner 4
    else if(vec4(u, u) == vec4(gram.yw,gram.yw)){
        gram.xz -= u;}
    //Make Good Noise to make background realistic and rough (glass with rain)
    float q =mix(mix(rand(u + vec2(0.0, 0.0)),
                     rand(u + vec2(0.0, 1.0)), u.y),
                 mix(rand(u + vec2(1.0, 0.0)),
                     rand(u + vec2(1.0, 1.0)), u.y),u.x);
    //Prepare for locating scene
    x += length(q)*a+0.1;
    //if this --------------\ is increased, The Background Will Become Smoother, Depends On How You
    //Increase It.          v
    for(float i = 0.0; i < 0.1; i++)//Recommended: 40.013
    {
        //Prepare to Shape The Grid Using Gram
        vec3 p = x * 0.5 + normalize(vec3(u, 1.0)) + gram.xyz;
        //Use a raytracing technique
        float d = length(p) - 1.0;
        //something
        t += d * 0.5;
    }
    //Add fog
    float fog = 1.0/(1.0+t*t*0.1);
    //Result fog
    return fog;
    
}
//Get Gram Color For Pool Effect
vec4 getGramColor(vec2 u, float i)
{
    return vec4(length(u*2.0-1.0)-i);
}
//Get Frame 
vec3 getFrame(vec2 u, float i, vec3 rd)
{
    vec2 p = floor(u);
    vec2 f = fract(u);
    vec2 q = f*f*(-1.0+2.0*p-rd.xy);
    return length(q) + rd * i;
}
//Get Limit And Activity
vec2 getLimit_Activity(float k, float s, vec2 u)
{
    float x = max(k-min(u.x,u.y),s-min(u.x,u.y));
    float ox = (u.x+u.y)-(u.y+u.x);
    return vec2(x, ox)+vec2(k, s);
}
//Obvious. Just an UltraViolet Ray.
vec2 getUv(vec2 u)
{
    return u+(max(u.x+u.y,u.y+u.x));
}
void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
	vec2 uv = fragCoord.xy / iResolution.xy;
    uv = uv * 2.0-  1.0;
    uv.x *= iResolution.x / iResolution.y;
    // VJ: 水面の揺らぎ (原作はほぼ静止画のため動きを追加)
    float T = iTime*speed;
    float wv = wavePct*0.01;
    uv += wv*0.15*vec2(sin(uv.y*3.0+T*0.7)+0.5*sin(uv.y*7.0-T*1.1),
                       sin(uv.x*3.5-T*0.6)+0.5*sin(uv.x*6.0+T*0.9));
    uv += wv*0.05*vec2(sin(T*0.23), cos(T*0.19));   // ゆっくり漂う
    vec2 u = getUv(uv);
    vec2 lax = getLimit_Activity(noise(u), noise(u + u.x), u);
    // VJ: sqrt(負値)=NaN で画面の対角半分が黒くなるため abs を挟んで全面に模様を出す
    vec3 x = getFrame(u, length(sqrt(abs(u))), normalize(vec3(u, 1.0)));
    vec4 gram = getGramColor(u, max(lax.x,lax.y));
    float col = xmts(u/max(noise(u),1e-3), gram, lax.x, x, lax.y);
	fragColor = vec4(col+noise(lax+T))*length(uv)+vec4(-0.025,0.025,0.6,1.0);
}`
}
,
{
  name: "41/49 Tower (NdVXDD)",
  ch: ["","","",""],
  src: `// Shadertoy NdVXDD "41/49" by tono (単一パス)。https://www.shadertoy.com/view/NdVXDD
// VJ: 時間をスナップ状に進めて動きを鋭利に (sharp=0 で原作のなめらかな動き)。
// stretchX=折りたたみで生まれる束を1本ずつ、横方向へ思いっきり引き伸ばす (急に伸びて戻る)
// @param speed 0..3 = 1
// @param sharp 0..100 = 70
// @param stretchX 1..400 = 220
// @param rate 1..8 = 2
// @param megaPct 0..100 = 35
// @param spin 0..100 = 40
// @param chromePct 0..100 = 100
// @param aa 1..3 = 2
// @param squash 100..400 = 150
// @param tumble 0..100 = 60
// @param tumbleRate 1..8 = 2
uniform float speed;
uniform float sharp;    // 100 に近いほど動きがカクッと切り替わる (Kaiser 的)
uniform float stretchX; // 横伸びの最大倍率
uniform float rate;     // 1秒あたり何回伸びるか
uniform float megaPct;  // 一部の束がさらに3倍まで伸びる確率
uniform float spin;     // 奥方向(3D)への回転速度
uniform float chromePct; // クロム(擬似環境反射)の適用量 (0=原作の色)
uniform float aa;        // スーパーサンプリング (1=off / 2=2x2 / 3=3x3)
uniform float squash;    // 縦の潰し (100=原寸 / 大きいほど平たくなる)
uniform float tumble;     // ランダムな 3D 姿勢の振れ幅 (0=固定の傾きのみ)
uniform float tumbleRate; // 1秒あたり何回 姿勢が切り替わるか
uniform float uSlotIsA; // 1=Slot A / 0=Slot B (B では背景を透過)
float T_;
float SX_;
float ST_;
float MG_;
float RT_;
float EM_;
vec3 TB_;   // ランダム姿勢 (3軸)
float rnd_(vec2 st){ return fract(sin(dot(st, vec2(12.9898,78.233)))*43758.5453123); }
mat2 rot(float a){return mat2(cos(a),sin(a),-sin(a),cos(a));}
float pi = acos(-1.);
vec3 ppp;
// 戻り値: x=距離 / y=マテリアルID / z=束の切れ目までの距離 (ステップ制限用)
vec3 map(vec3 p)
{
    float o = 10.;
    float id = 0.;
    // 3D 回転: 縦軸まわりの公転 (いわゆる「回転」の向き) + 固定の傾き + ランダムな 3D 姿勢
    p.yz *= rot(0.22 + TB_.x);
    p.xz *= rot(RT_ + TB_.y);
    p.xy *= rot(TB_.z);
    // 縦を潰す (y を引き伸ばして評価 = 見た目が平たくなる)。距離は縮尺の最小値で補正。
    float sq = max(squash*0.01, 1.0);
    p.y *= sq;
    vec3 op = p;
    p.xz *= rot(sin(p.y/4.));
    vec2 pre1 = p.xz;
    vec2 sg1 = sign(pre1);
    p.xz = abs(p.xz)-3.1;
    p.xz *= rot(p.y/2.);
    vec2 pre2 = p.xz;
    vec2 sg2 = sign(pre2);
    p.xz = abs(p.xz)-1.;
    // 束ごとの横伸張 (ジャギの根本対策)
    //   × 非等方スケール (p.x /= s): 距離場の勾配が方向で変わり、しかも s が場所で
    //     変化するため距離が過大評価される → レイが面を踏み越えて点状の欠け=ジャギになる。
    //   ○ elongation (clamp 減算): iq の伸張演算子。勾配は 1 のまま = 厳密な距離場を保つ。
    //     伸張長 e は束ごとに一定にして、束の内部では歪みをゼロにする。
    float dBnd;
    {
        float sid = (sg1.x*.5+.5) + 2.*(sg1.y*.5+.5) + 4.*(sg2.x*.5+.5) + 8.*(sg2.y*.5+.5)
                  + 16.*floor(p.y*0.35);
        float k = floor(ST_);
        float ph = fract(ST_);
        float r1 = rnd_(vec2(sid, k));
        float r2 = rnd_(vec2(sid + 91.7, k*1.7 + 3.0));
        // 立ち上がり急峻 → 長めにホールドしてから戻る (伸びきった状態が見える)
        float env = pow(1.0 - ph, 2.0) * step(0.25, r1);
        // 当たりを引いた束だけ さらに3倍まで伸びる
        float mega = 1.0 + 2.0*step(1.0 - MG_, rnd_(vec2(sid + 313.0, k*2.3 + 7.0)));
        float e = SX_*0.045 * mega * env * (0.25 + 0.75*r2);   // 片側の伸張長
        p.x -= clamp(p.x, -e, e);
        // 束の切れ目(折りたたみ面 / y 帯)までの距離。ここを一手で踏み越えないよう
        // 最終距離をこれで制限する = 不連続でも欠けが出ない (フェード不要)。
        float yf = fract(p.y*0.35);
        dBnd = min(min(abs(pre1.x), abs(pre1.y)), min(abs(pre2.x), abs(pre2.y)));
        dBnd = min(dBnd, min(yf, 1.0 - yf)/0.35);
    }
    p.xz *= rot(sin(p.y));
    vec3 pp = p;
    p.xz *= rot(p.y * pi/3. + T_);
    p.y = sin(p.y * pi/3. + T_);
    o = length(vec2(length(p.xy)-1.,p.z))-.3;
 	pp.z += sin(pp.y * pi/3. + T_)*1.;
    ppp = pp;
    //o = min(o,length(pp.xz)-.6);
    float r = sin(T_ + pp.y/3.) * .5 + .5;
    float d = length(pp.xz)-r*.7;
    if(o > d)
    {
        o = d;
    	id = 1.;
        ppp = pp;
    }

    // 原作の球状バウンドも同じ elongation で横に伸ばす (楕円体スケールだと距離場が歪む)
    vec3 ob = op; ob.x -= clamp(ob.x, -EM_, EM_);
    o = mix(max(length(ob)-6.,o),o,.9);
    //o = (length(op)-3.)/o;
    o/=1.7;
    o/=sq;                 // 縦を sq 倍に引き伸ばして評価した分、距離を縮めて安全側に

    return vec3(o, id, dBnd*0.7/1.7);
}

vec2 march(vec3 cp , vec3 rd)
{
    float depth = 0.;
    // ストレッチで歪んだ SDF を踏み越えないよう、ステップを縮めて反復を増やす
    int STEPS = int(min(120.0, iResolution.x));
    for(int i = 0 ; i< STEPS ; i++)
    {
        vec3 rp = cp + rd * depth;
        vec3 d = map(rp);
        if(abs(d.x) < 0.01)
        {
            return vec2(depth, d.y);
        }
        if(depth > 30.)break;
        // 束の切れ目(距離場の不連続面)を一手で踏み越えないようステップを制限する。
        // 判定に使う距離は素のまま = 境界が偽の面として現れない。
        // 面の近くだけ慎重に (遠方は全速) → 不連続を踏み越えず 60fps を維持
        depth += (d.x < 0.6) ? min(d.x*0.75, max(d.z, d.x*0.25)) : d.x*0.85;
    }
    return vec2(-depth , 0.);

}
float random (vec2 st) {
    return fract(sin(dot(st.xy,
                         vec2(12.9898,78.233)))*
        43758.5453123);
}
// 1 サブサンプル分の描画 (スーパーサンプリングのため関数化)
vec4 shadePix(vec2 fragCoord) {
    vec2 p = (fragCoord.xy * 2.0 - iResolution.xy) / min(iResolution.x, iResolution.y);
	vec3 cp = vec3(0.,0.,-28.);
    vec3 target = vec3(0.);


    //cp.xz *= rot(T_ + p.y * 12.);
    //target.x += sin(T_);
    vec3 col = vec3(.0);

    vec3 cd = normalize(vec3(target - cp));
    vec3 cs = normalize(cross(cd , vec3(0.,1.,0.)));
    vec3 cu = normalize(cross(cd,cs));

    float fov = 2.5;

    vec3 rd = normalize(cd * fov + cs * p.x + cu * p.y);

    vec2 d = march(cp,rd);
    if( d.x > 0.)
    {
        vec2 e = vec2(1.0, -1.0) * .01;
        vec3 pos = cp + rd * d.x;
        vec3 N = normalize(
                  e.xyy * map(pos + e.xyy).x +
                  e.yyx * map(pos + e.yyx).x +
                  e.yxy * map(pos + e.yxy).x +
                  e.xxx * map(pos + e.xxx).x);
        vec3 sun = normalize(vec3(2.,4.,8.));
        //sun.xz *= rot(T_);
        float diff = max(0.,dot(-sun,N));
        diff = mix(diff , 1.,.1);
        float sp = max(0.,dot(rd,reflect(N,sun)));
        sp = pow(sp,33.6) * 10.;
        float rim = pow(clamp(1. - dot(N, -rd), 0., 1.), 8.) * 3.;
        vec3 mat = mix(vec3(1.),vec3(1.,0.1,0.1),d.y);
        mat -= exp(sin(ppp*2.)) * d.y;
        float up = max(dot(N,vec3(0.,-1.,0.)),0.);
        float down = max(dot(N,vec3(0.,1.,0.)),0.);

        col = sp * mat + diff * mat;
        col += up * vec3(.1) + down * vec3(0.,0.,1.);

    	col -= d.y * mat ;
        col = floor(col * 3.)/3.;
        // 原作の sin(pos*60) 高周波ストライプ (TV走査線風) は除去
        col *= max(col.r,max(col.g,col.b));
    	col -= rim *10.;
        col *= 10.;
        // クロムシルバー: 反射ベクトルの擬似環境反射 (急峻な明暗の帯 + 青白いハイライト)
        vec3 rr = reflect(rd, N);
        float ev = clamp(rr.y*0.5 + 0.5, 0.0, 1.0);
        // コントラストは弱め (暗部を持ち上げ明部を落とし、境界も緩やかに)
        vec3 chrome = mix(vec3(0.34,0.36,0.39), vec3(0.80,0.82,0.86), smoothstep(0.10, 0.85, ev));
        float band = smoothstep(0.42,0.47,ev) - smoothstep(0.53,0.58,ev);
        chrome = mix(chrome, vec3(0.44,0.46,0.50), band*0.35);
        chrome += vec3(0.9,0.95,1.0) * pow(max(dot(rr, sun), 0.0), 60.0) * 0.45;
        // クロムの明度だけを反転 (色差は保ったままスカラー加算で輝度を 1-lum へ)
        float cl = dot(chrome, vec3(0.299,0.587,0.114));
        chrome += 1.0 - 2.0*cl;
        // 明暗構造は保ったまま色だけクロムに差し替える
        float lum = dot(col, vec3(0.299,0.587,0.114));
        col = mix(col, chrome * clamp(lum, 0.0, 1.6), chromePct*0.01);
    }
    //col.r = atan(col.r,col.g)/pi;
    return vec4(col, step(0.0, d.x));
}

void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
    // 鋭利な時間: 1拍分ごとに急峻に立ち上がってホールド
{
        float t = iTime*speed;
        float snapT = floor(t) + pow(fract(t), 6.0);
        T_ = mix(t, snapT, sharp*0.01);
        SX_ = stretchX;
        ST_ = t*rate;
        MG_ = megaPct*0.01;
        RT_ = t*spin*0.012;
        EM_ = stretchX*0.045*3.0;   // 伸張の最大長 (バウンド用)
        // ランダム 3D 姿勢: tumbleRate 回/秒 で別の姿勢へ急峻に切り替わる (sharp と同じ質感)
        {
            float tk = floor(t*tumbleRate);
            float te = pow(fract(t*tumbleRate), 5.0);
            vec3 r1 = vec3(random(vec2(tk, 1.3)), random(vec2(tk, 5.7)), random(vec2(tk, 9.1)));
            vec3 r2 = vec3(random(vec2(tk+1.0, 1.3)), random(vec2(tk+1.0, 5.7)), random(vec2(tk+1.0, 9.1)));
            TB_ = mix(r1, r2, te) * 6.2832 * (tumble*0.01);
        }
    }

    // スーパーサンプリング: aa=1 で等倍、2 で 2x2(4 タップ)、3 で 3x3(9 タップ)。
    // 伸びて 1px 以下になった束のジャギはサブピクセル平均でしか消えないため、これが根本策。
    int N = int(min(max(aa, 1.0), iResolution.x));
    vec4 acc = vec4(0.0);
    for(int j = 0; j < N; j++)
    for(int i = 0; i < N; i++){
        vec2 off = (vec2(float(i), float(j)) + 0.5)/float(N) - 0.5;
        acc += shadePix(fragCoord + off);
    }
    acc /= float(N*N);
    // Slot A=不透明(黒背景) / Slot B=オブジェクトのみ表示して背景を透過
    fragColor = vec4(acc.rgb, mix(acc.a, 1.0, uSlotIsA));
}`
}
,
{
  name: "Infinite House Plan (3sK3zy)",
  ch: ["","","",""],
  src: `// Shadertoy 3sK3zy "Infinite House Plan" by 104 (単一パス)。https://www.shadertoy.com/view/3sK3zy
// VJ: 影(ガンマ)・ビネット・色面を除去して白背景+黒線に。かわりにディザグラデと灰色の面を追加。
// @param speed 0..3 = 1
// @param greyPct 0..100 = 60
uniform float speed;
uniform float greyPct;  // ディザグラデ/灰色面になるセルの割合
const float lineThickness = 2.5;
const float PARTITIONS = 13.;


vec4 hash42(vec2 p)
{
	vec4 p4 = fract(vec4(p.xyxy) * vec4(.1031, .1030, .0973, .1099));
    p4 += dot(p4, p4.wzxy+33.33);
    return fract((p4.xxyz+p4.yzzw)*p4.zywx);
}

void mainImage( out vec4 o, in vec2 fragCoord )
{
    float t = (iTime*speed+1e2)*.4;
    vec2 uv = fragCoord/iResolution.xy-.5;
    vec2 R = iResolution.xy;
    uv.x *= R.x / R.y;
    uv.x += t*.2;
    uv.y += sin(t)*.3;
    uv.y -= .5;

    float gp = greyPct*0.01;
    float dnoise = hash42(fragCoord.xy).x;  // 画面固定のディザノイズ

    vec2 cellUL = floor(uv);
    vec2 cellBR = cellUL + 1.;
    vec2 seed = cellUL;
    o = vec4(1);
    for(float i = 1.; i <= PARTITIONS; ++ i) {
        vec4 h = hash42(seed+1e2*(vec2(cellBR.x, cellUL.y)+10.));
        vec2 uv2 = uv;
        float dl = abs(uv2.x - cellUL.x);
        dl = min(dl, length(uv2.y - cellUL.y));
        dl = min(dl, length(uv2.x - cellBR.x));
        dl = min(dl, length(uv2.y - cellBR.y));

        o.rgb *= smoothstep(0.,lineThickness/max(R.x,R.y),dl);
        if (h.w < .15*gp) {
            // 灰色の面
            o.rgb *= vec3(0.45 + 0.4*h.z);
        } else if (h.w < .38*gp) {
            // ディザグラデ: セル内の明度勾配をノイズ閾値で2階調に割る
            vec2 cuv = clamp((uv2 - cellUL)/max(cellBR - cellUL, 1e-4), 0., 1.);
            float g = mix(cuv.x, cuv.y, step(.5, h.x));
            if(h.y < .5) g = 1.-g;
            o.rgb *= mix(vec3(0.3+0.25*h.z), vec3(1.0), step(dnoise, g));
        }
        vec2 pt = mix(cellUL, cellBR, h.y);

        vec2 p2 = pt - uv;
        float r = max(fract(p2.x-.5), fract(.5-p2.x));
        r = max(r, fract(.5-p2.y));
        r = max(r, fract(p2.y-.5));
        r = 1.-r;
        vec2 sz = cellBR - cellUL;
        if (pow(sz.x * sz.y, .1) < r * 1.5) {
            break;
        }
        vec2 thresh = sin(t*2.*h.xy)*.5+.5;
        thresh *= h.zw*.3;
        if (sz.x < thresh.x || sz.y < thresh.y)
            break;

        if (uv2.x < pt.x) {// descend into quadrant.
            if (uv2.y < pt.y) {
                cellBR = pt.xy;
            } else {
              	cellUL.y = pt.y;
              	cellBR.x = pt.x;
            }
        } else {
            if (uv2.y > pt.y) {
                cellUL = pt.xy;
            } else {
                cellUL.x = pt.x;
                cellBR.y = pt.y;
            }
	    }
    }

    o = clamp(o,0.,1.);
    o.a = 1.;
}`
}
,
{
  name: "Decal Scaffold (7lt3DN)",
  ch: ["","","",""],
  src: `// Shadertoy 7lt3DN "spqr: decal scaffold 5" by Fahrenheitrequited (単一パス)。https://www.shadertoy.com/view/7lt3DN
// 原作は NuSan の CorrodedBeasts (Bonzomatic) 改変。
// VJ: 黄土色/オレンジをクロムシルバー(法線ベース擬似環境反射)に置換。マーチ上限を 800 步に制限。
// @param speed 0..3 = 1
uniform float speed;
float T9_;

float PI = acos(-1.0);

mat2 rot(float a) {
  float ca=cos(a);
  float sa=sin(a);
  return mat2(ca,sa,-sa,ca);
}

float tick (float t) {
  float i = floor(t);
  float r = fract(t);
  for (int z = 0; z < 2; z++) {
    r = smoothstep(0.,1.,r);
  }

  return i + r;
}

float box( vec2 p, vec2 b )
{
  vec2 q = abs(p) - b;
  return max(q.x,q.y);
}


vec2 replim( in vec2 p, in float c, in vec2 l){
    return p-c*clamp(floor(p/c),-l,l);

}

float m1(vec2 uv) {
  float a = 3.141592/4.;
  float thing = 10000.;

  for( float i = 0.; i <5.; i++){

    uv *= rot(i * a *2.);

    uv = abs(uv);
    uv -= vec2(2,7);
    uv = -abs(uv);


    float x1 =  box(uv, vec2(1,1));
    float x2 =  box(uv + vec2(2,11), vec2(1.,5.));
    float x3 =  box(uv + vec2(14,14), vec2(.1,53.));
    vec2 q = replim(uv, 10., vec2(11,2));
    float x4 =  box(q , vec2(.2,2.));

    float x = min(x4,min(x1,(min(x2,x3))));

    thing = min(thing,x);
  }
  return thing ;

}

float a = 3.141592;
float glow = 0.;
float m2(vec2 uv) {

  vec2 uv2 = uv;
  float q = 1.4  + 1. *  sin(tick(tick(T9_ * sqrt(2.)/2.1 )));

  float z = 10000.;
  vec2 off = vec2(58,20);
  for (float i = 0.; i <5.; i++) {
    off *= rot(i/4.);

    uv.x *= q;

    uv *= rot(a/2.);


    float a1 =m1(uv  + off);
    z = min(z,a1);

  }
  vec2 arm = vec2(24);
  arm *= rot(T9_ * 7.1);
  float u = length(uv2  + arm) -2.;

  glow += .01/(.02 + u);

  return z/1.4;
}

float ink(vec2 uv) {

  return m2(uv);
}

float box( vec3 p, vec3 b )
{
  vec3 q = abs(p) - b;
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0);
}

float sph(vec3 p, float r) {
  return length(p) - r;
}

vec3 rep( vec3 p, vec3 c )
{
    return mod(p,c) - 0.5 * c;
}

float rand(float t) {
  return fract( sin(t * 7361.994) * 4518.442);
}

vec3 lattice (float t ) {

  float m = t;
  float mx = floor((m-2.)/3.);
  float my = floor((m-1.)/3.);
  float mz = floor((m-0.)/3.);

  float n= m+1.;
  float nx = floor((n-2.)/3.);
  float ny = floor((n-1.)/3.);
  float nz = floor((n-0.)/3.);

  vec3 a =
  mix(
      vec3(
          rand(mx)-.5,
          rand(my)-.5,
          rand(mz)-.5
      ),
      vec3(
          rand(nx)-.5,
          rand(ny)-.5,
          rand(nz)-.5
      ) ,
      fract(t)
  );
  return a;
}

int matter = 1;


vec3 delta;

float building(vec3 p) {

  // probe
  vec3 fwd = delta;

  vec3 pp = p - fwd;

  float pr1= sph(pp, 1.);
  float pr2 = box(pp, vec3(1.));
  float probe = mix(pr1, pr2, .7);

  // floors and collumns
  p.xz = abs(p.xz)- 91.;
  p = rep(p, vec3(0.,50.,0.));
  float floors = box(p, vec3(110,5.1,110));
  float collumns = box(p, vec3(10,10,10));


  // merge
  float all = min(min(floors,collumns),probe);

  if ( floors == all) {
    matter = 1;
  }
  if ( collumns == all) {
    matter = 2;
  }
  if ( probe == all) {
    matter = 3;
  }

  return all;

}



float map (vec3 p) {
  float t = building(p);
  return t;
}
vec3 norm(vec3 p) {
  vec2 off=vec2(0.01,0.0);
  return normalize(map(p)-vec3(map(p-off.xyy), map(p-off.yxy), map(p-off.yyx))+0.000001);
}

float rnd(vec2 t) {
  return fract(dot(sin(t*vec2(789.451)+t.yx*vec2(842.544)),vec2(7541.223)));
}



vec3 flit(float t) {

  vec3 x = normalize(vec3(1));
  float t1 = tick(t);
  float t2 = tick(t * .71);
  float t3 = tick(t * .55);
  x.yz *= rot(t1);
  x.xz *= rot(t2);
  x.yx *= rot(t3);

  return x;
}

vec3 bezier( float t ){
  vec3 one = lattice(floor(t));
  vec3 two = lattice(floor(t+1.));
  float per = fract(t);

  return mix(one,two,per);

}
void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
  T9_ = iTime*speed;

  vec2 uv = vec2(fragCoord.x / iResolution.x, fragCoord.y / iResolution.y);
  uv -= 0.5;
  uv /= vec2(iResolution.y / iResolution.x, 1);

  // nav

  float tt = T9_ + 391.;
  vec3 source = bezier(tt) * 350.;
  vec3 target = bezier(tt + 10.) * 350.;

  source += flit(tt * 1.31) * 17.1;
  target += flit(tt * 1.51) * 17.1;


  vec3 arm = vec3(0,0,1);
  arm.xz *= rot(tt * .25);
  arm.yz *= rot(tt * .28);
  arm.xy *= rot(tt * .11);

  target += arm * 100.;

  vec3 down = vec3(0.,  tick(T9_ * .3) * 331., 0.);
  source += down;
  target += down;

  delta = target - source;

  vec3 cz=normalize(target-source);
  vec3 cx=normalize(cross(cz,vec3(0,1,0)));
  vec3 cy=normalize(cross(cz,cx));
  vec3 r=normalize(cx*uv.x+cy*uv.y+cz*0.7);

  r.xy *= rot(sin(T9_/2.1)/4.1);

  vec3 p=source;
  float d = 10000.0;
  float dd = 0.;

  // march (上限は uniform 依存にして 800 步に制限)
  float MAXZ = 800. + min(iResolution.x, 0.);

  int transp = int(mod(T9_ * .7,2.));
  bool hit = false;
  for(float z=0.; z < MAXZ; ++z) {
    d=map(p);
    d = abs(d);
    if(d<0.1) {
      if ( matter == 1) {
        float i = ink(mod(p.xz,150.));

        if ( transp == 0) {

          if (i > .2) {
            d = .15;
          } else {
            hit = true;
            break;
          }
        } else {
          hit = true;
          break;
        }

      }

      else if (matter == 2) {
        hit = true;
        break;
      } else if ( matter ==3) {
       vec3 n = norm(p);
       r = reflect(r,n);
       d = 0.2;
      }
    }
    if ( dd > 50000.) break;
    dd += d;
    p+=r*d;
  }

  // hue

  vec3 col;
  bool chrome = false;

  if ( matter == 1) {
    float i = ink(mod(p.xz + vec2(0,100), 110. ));
    col = vec3(1);
    if ( i < 0.2) {
      col = vec3(0);
    }
    if (i < -0.1) {
      chrome = true;   // 原作の黄土色 vec3(.8,.5,.1) をクロムシルバーに
    }
  }
  if (matter == 2) {
    col = vec3(0);
  }

  if ( matter == 3 ) {
    chrome = true;     // 原作のオレンジ vec3(1,.5,0.) もクロムシルバーに
  }

  vec3 n = norm(p);

  if (chrome) {
    // クロムシルバー: 法線ベースの擬似環境反射 (急峻な明暗の帯 + 青白いハイライト)
    vec3 rr = reflect(r, n);
    float v = clamp(rr.y*0.5+0.5, 0., 1.);
    col = mix(vec3(0.06,0.07,0.09), vec3(1.02,1.05,1.10), smoothstep(0.28,0.62,v));
    float band = smoothstep(0.44,0.46,v) - smoothstep(0.54,0.56,v);
    col = mix(col, vec3(0.30,0.33,0.38), band*0.8);
    vec3 sun = normalize(vec3(4.,12.,2.));
    float spec = pow(max(dot(rr, sun), 0.), 60.);
    col += vec3(0.9,0.95,1.0)*spec*1.2;
  }

  // sky
  if (! hit ) {
    col = mix(vec3(.0,.5,1.), vec3(.0,.5,1.) * .3, abs(r.y));
  }

  fragColor = vec4(col, 1);
}`
}
,
{
  name: "Lappronov Relief (mtdGDM)",
  ch: ["","","",""],
  src: `// Shadertoy mtdGDM "Animated Lappronov Fractal Shade" by goooo (単一パス)。https://www.shadertoy.com/view/mtdGDM
// VJ: 原作の height をそのまま高さ場として立体化する。この式は log2 で発散するため
// 尾根が数学的に無限に鋭い = トゲを後付けせずフラクタル自身の刃が立ち上がる。
// 視線に沿って高さ場を追跡 (parallax occlusion) するので稜線が手前を隠し、
// シルエットも尖る。幾何は低イテレーション / 色は高イテレーションで負荷を分ける。
// @param speed 0..3 = 1
// @param zoomPct 0..100 = 45
// @param driftPct 0..200 = 100
// @param reliefPct 0..100 = 65
// @param steps 4..24 = 14
// @param gIter 2..10 = 4
// @param cIter 4..30 = 14
// @param bumpPct 0..200 = 100
// @param black bool = false
uniform float speed;
uniform float zoomPct;    // 脈動ズームの深さ
uniform float driftPct;   // ドメインが流れる量 (Lissajous)
uniform float reliefPct;  // 高さ (0=平面)
uniform float steps;      // 高さ場を追跡するステップ数
uniform float gIter;      // 幾何用フラクタル反復 (軽い)
uniform float cIter;      // 色用フラクタル反復 (原作は 30)
uniform float bumpPct;    // 法線の強さ
uniform float black;      // Black: 立体を黒インクに (Slot A=白地に黒 / Slot B=透過に黒のみ)
uniform float uSlotIsA;   // 1=Slot A / 0=Slot B (B では黒い部分を透過)
#define FRACTAL_SEQUENCE_LENGTH 9
int fractalSequence[] = int[FRACTAL_SEQUENCE_LENGTH](0, 0, 1, 0, 0, 0, 1, 1, 1);
float TT_;
float W_[20];        // ウェイトは 1 フレーム 1 回だけ作る (高さ場を何度も引くため)
float DEPTH_;
mat2 rot2(float a){ return mat2(cos(a),sin(a),-sin(a),cos(a)); }

// 原作の height。反復数を可変にして幾何用(低)と色用(高)で使い分ける。
float lapHeight(vec2 c, int ITER){
    float x = 0.5;
    float height = 0.0;
    int SEQN = int(min(float(FRACTAL_SEQUENCE_LENGTH), iResolution.y));
    for(int it = 0; it < ITER; it++){
        for(int st = 0; st < SEQN; ++st){
            x = W_[st] * c[fractalSequence[st]] * x * (1.0 - x);
            // log2(0) = -inf → NaN 汚染の元。下限でクランプする
            height += log2(max(abs(W_[st] * c[fractalSequence[st]] * (1.0 - 2.0*x)), 1e-12));
        }
    }
    return height / (float(ITER) * float(FRACTAL_SEQUENCE_LENGTH));
}

// 原作の彩色 (height から色を作る部分はそのまま)
vec3 lapColor(float height){
    vec3 colorShift = vec3(.8, .55, .00330) + TT_ * 0.74;
    vec3 color1 = cos((colorShift + 2.5 * abs(height)) * 3.14159265) * 0.5 + 0.5;
    vec3 color2 = vec3(0.5) + 0.5 * sin(vec3(0.3, 0.33, 0.3) + 2.5 * abs(height) + TT_ * 0.5);
    return (height < 0.0) ? mix(color1, color2, pow(abs(height), .625)) : vec3(0.0);
}

// 高さ 0..1 (height が負の領域ほど高い = 原作で色が出る領域が山になる)
float reliefAt(vec2 c, int ITER){
    return clamp(-lapHeight(c, ITER) * 1.5, 0.0, 1.0);
}

void mainImage(out vec4 finalColor, in vec2 pixelCoordinate) {
    float tt = iTime*speed;
    TT_ = tt*0.25;   // 原作の5倍速で色とウェイトが動く
    int WN = int(min(20.0, iResolution.x));
    for(int i = 0; i < WN; i++) W_[i] = .97 + .028 * sin(float(i) + 4.001 + 0.76 * TT_);

    // 原作どおり uv は ±0.5 (c が [3,4] のカオス域に収まる。アスペクト補正すると域外=黒になる)
    vec2 uv = pixelCoordinate.xy/iResolution.xy - 0.5;
    uv = rot2(0.12*sin(tt*0.21))*uv;

    // 脈動ズーム + ドメインの流れ。窓 (base ± 0.5*sc) が常にカオス域 [3,4] の内側に
    // 収まるよう振幅を決める。外へ出ると height>=0 = 全黒になり、絵が隅に寄る。
    float zm = 1.0 + (zoomPct*0.01)*0.35*sin(tt*0.9);          // 0.65..1.35
    vec2 pan = vec2(0.08*sin(tt*0.37), 0.07*cos(tt*0.29)) * (driftPct*0.01);
    vec2 base = vec2(3.5) + pan;
    vec2 sc = vec2(0.60*zm);                                    // 半幅 最大 ±0.405

    int GI = int(min(gIter, iResolution.x));
    int CI = int(min(cIter, iResolution.x));
    DEPTH_ = reliefPct*0.01*0.55;

    // 視線の傾き (ゆっくり回る = 稜線の見え方が回り込む)
    vec2 vdir = vec2(sin(tt*0.17), cos(tt*0.13));

    // 高さ場を視線に沿って追跡 (手前の稜線が奥を隠す)
    int NS = int(min(steps, iResolution.x));
    float dt = 1.0/float(NS);
    float t = 0.0, pt = 0.0, ph = 1.0;
    vec2 hitUV = uv;
    float hitH = 0.0;
    for(int i = 0; i < NS; i++){
        t += dt;
        vec2 sp = uv + vdir*DEPTH_*t;
        float h = reliefAt(base + sp*sc, GI);
        if(h > 1.0 - t){
            // 交点を線形補間で詰める (稜線をギザギザにしない)
            float a = (1.0 - pt) - ph;
            float b = (1.0 - t) - h;
            float f = clamp(a/(a - b + 1e-6), 0.0, 1.0);
            float tf = mix(pt, t, f);
            hitUV = uv + vdir*DEPTH_*tf;
            hitH = reliefAt(base + hitUV*sc, GI);
            break;
        }
        pt = t; ph = h; hitUV = sp; hitH = h;
    }

    // 法線 (低イテレーションの高さ場から中央差分)
    float e = 1.6/iResolution.y;
    float hx = reliefAt(base + (hitUV + vec2(e,0.0))*sc, GI) - reliefAt(base + (hitUV - vec2(e,0.0))*sc, GI);
    float hy = reliefAt(base + (hitUV + vec2(0.0,e))*sc, GI) - reliefAt(base + (hitUV - vec2(0.0,e))*sc, GI);
    float k = (bumpPct*0.01) * DEPTH_ / (2.0*e);
    vec3 n = normalize(vec3(-hx*k, -hy*k, 1.0));

    // 色はフラクタルそのまま (高イテレーションで質を出す)
    vec3 col = lapColor(lapHeight(base + hitUV*sc, CI));

    // 陰影: 回る光源 + 谷を締める AO + 稜線のハイライト
    // (対角ゲインによる偏り補正は四隅に影が出るので入れない)
    vec3 L = normalize(vec3(cos(tt*0.45), sin(tt*0.45), 0.75));
    float dif = max(dot(n, L), 0.0);
    float spec = pow(max(dot(reflect(-L, n), vec3(0.0,0.0,1.0)), 0.0), 42.0);
    float ao = mix(1.0, 0.55 + 0.45*hitH, 0.5);
    col = col * (0.55 + 0.75*dif) * ao;
    col += vec3(1.0) * spec * 0.45 * hitH;

    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float mask = smoothstep(0.0, 0.05, lum);   // 形のマスク (Slot B の alpha)

    // Black モード: 色を捨てて黒インクの版画にする。
    // Slot A は白地に黒 (黒背景だと黒い立体が見えないため) / Slot B は黒インクのみで背景は透過。
    float bk = step(0.5, black);
    if(bk > 0.001){
        float ink = smoothstep(0.02, 0.45, lum);      // 稜線が明るいほど濃い黒
        vec3 onA = mix(vec3(1.0), vec3(0.0), ink);
        col = mix(col, mix(vec3(0.0), onA, uSlotIsA), bk);
        mask = mix(mask, ink, bk);                     // 黒モードでは濃さ=不透明度
    }

    // Slot A=不透明(黒/白背景) / Slot B=背景を透過
    float a = mix(mask, 1.0, uSlotIsA);
    finalColor = vec4(col, a);
}`
}
,
{
  name: "Nouveau Tiles (3tlfRr)",
  ch: ["images/etc/cd_emblem.png","","",""],
  src: `// Shadertoy 3tlfRr "Shader Nouveau" (mathieu_h) のタイル構成を流用。
// ディスク模様のかわりに C008 (cyber ui) の中央エンブレム画像を敷き詰め、
// タイルごとにランダム回転 (スナップ) + パン + 段階ズーム。
// @param speed 0..3 = 1
// @param tiles 2..12 = 4
// @param randPct 0..100 = 100
// @param snapPct 0..100 = 80
// @param black bool = false
uniform float speed;
uniform float tiles;    // 画面内のタイル数
uniform float randPct;  // ランダム回転の量
uniform float snapPct;  // 100 に近いほど回転がカクッとスナップ
uniform float black;    // Black: 線を白ではなく黒に (Slot A=白地に黒 / Slot B=透過に黒のみ)
uniform float uSlotIsA; // 1=Slot A / 0=Slot B (B では線以外を透過)
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
mat2 rot2(float a){ return mat2(cos(a),sin(a),-sin(a),cos(a)); }
void mainImage(out vec4 fragColor, in vec2 fragCoord){
    vec2 uv = (2.0*fragCoord - iResolution.xy)/iResolution.y;
    float t = iTime*speed;
    // 全体のゆっくり回転 (原作の rotSpeed 相当)
    uv = rot2(0.08*t)*uv;
    // 段階ズーム: round(cos) で数秒ごとに 3 段階を巡回 (原作の dynZoom)
    float dz = floor(cos(t/2.5) + 0.5);
    float zoom = max(0.8 + dz, 0.35);
    // パン (原作の pan_dir/pan_speed)
    vec2 pan = vec2(1.0, 1.0)*0.2*t;
    vec2 w = uv*(tiles*0.5)/zoom + pan;
    vec2 cell = floor(w);
    vec2 f = fract(w) - 0.5;
    float idv = hash21(cell);
    // ランダム回転: タイルごとの連続スピン + 周期ごとにランダム角へ急峻スナップ
    float rspd = mix(0.3, 1.8, hash21(cell+7.0))*sign(hash21(cell+3.0)-0.5);
    float ph = t*1.2 + idv;
    float k = floor(ph);
    float e = pow(fract(ph), 5.0);
    float r1 = hash21(cell + k*0.618);
    float r2 = hash21(cell + (k+1.0)*0.618);
    float snap = 6.2832*mix(r1, r2, e)*(snapPct*0.01);
    float ang = idv*6.2832 + t*rspd*0.4 + (randPct*0.01)*snap;
    vec2 p = rot2(ang)*f;
    // エンブレム画像をタイル充填 (等倍よりわずかに拡大してセルを埋める)
    vec2 tuv = p*0.92 + 0.5;
    vec4 tx = texture(iChannel0, clamp(tuv, 0.0, 1.0));
    float v = tx.a*dot(tx.rgb, vec3(0.299,0.587,0.114));
    // mipmap 縮小で灰色化した細線をゲインで持ち上げる (max 膨張はジャギが出るので不使用)
    v = smoothstep(0.02, 0.28, v);
    // 原作風ビネット
    float vin = 1.0 - dot(uv/5.0, uv/5.0)*8.0;
    float ink = clamp(v*clamp(vin, 0.0, 1.0), 0.0, 1.0);

    vec3 col;
    if(black > 0.5){
        // Black: Slot A は白地に黒線 (黒背景だと黒線が見えないため) / Slot B は黒線のみで背景は透過
        vec3 bg = mix(vec3(0.0), vec3(1.0), uSlotIsA);
        col = mix(bg, vec3(0.0), ink);
    } else {
        col = vec3(ink);
    }
    // Slot A=不透明 / Slot B=線以外を透過 (濃さがそのまま不透明度)
    float a = mix(ink, 1.0, uSlotIsA);
    fragColor = vec4(col, a);
}`
}
,
{
  name: "Chrome Spiral Pieces (XflXzn)",
  ch: ["","","",""],
  src: `// Adapted from Shadertoy XflXzn "Colorful spirals" by IanDotVos.
// https://www.shadertoy.com/view/XflXzn
// VJ: 原作の5色を、互いに接続しない5個の湾曲パーツへ立体化。
//     低彩度クロム + 3軸回転。Slot A=黒背景、Slot B=背景を実alphaで透過。
// @param speed 0..3 = 0.7
// @param spin 0..3 = 1.0
// @param inflatePct 0..140 = 90
// @param reliefPct 0..100 = 65
// @param chromePct 0..100 = 100
// @param satPct 0..60 = 32
uniform float speed;
uniform float spin;
uniform float inflatePct;
uniform float reliefPct;
uniform float chromePct;
uniform float satPct;
uniform float uSlotIsA;

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;
const float SLICE = TAU / 5.0;

mat2 rot2(float a){
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

// 原作で半径方向に使われている三角波。
float saw_function(float x){
    float t = mod(x, 1.0);
    return max(min(1.0, min(2.0*t, -2.0*t + 2.0)), 0.0) * 2.0 - 1.0;
}

vec3 toObject(vec3 p){
    float t = iTime * speed;
    // 正面の配置と個々の隙間を保ちながら、全体を緩やかにタンブルさせる。
    p.yz = rot2(0.48 + 0.15*sin(t*0.37*spin)) * p.yz;
    p.xz = rot2(0.40*sin(t*0.51*spin)) * p.xz;
    p.xy = rot2(-t*0.27*spin + 0.10*sin(t*0.23)) * p.xy;
    return p;
}

float pieceAngle(float id){
    float t = iTime * speed;
    return id*SLICE + 0.11*sin(t*0.34 + id*1.91);
}

float pieceLength(float id){
    return 0.69 + 0.07*sin(id*2.17 + 0.6);
}

float sdTaperedSegment(vec3 p, vec3 a, vec3 b, float ra, float rb){
    vec3 pa = p-a, ba = b-a;
    float h = clamp(dot(pa, ba)/max(dot(ba, ba), 0.0001), 0.0, 1.0);
    return length(pa-ba*h) - mix(ra, rb, h);
}

float smoothUnion(float a, float b, float k){
    float h = max(k-abs(a-b), 0.0)/k;
    return min(a, b) - h*h*k*0.25;
}

float inflatedPieceSDF(vec3 p, float id){
    vec2 xy = rot2(-pieceAngle(id))*p.xy;
    float start = 0.31 + 0.025*sin(id*2.83);
    float len = pieceLength(id);
    float bend = 0.18 + 0.045*sin(id*1.73 + 0.4);
    float zShift = 0.030*sin(id*2.37 + iTime*speed*0.21);
    vec3 q = vec3(xy, p.z-zShift);

    // 2本の丸いテーパー形状を滑らかにつなぎ、独立した曲面パーツにする。
    float puff = mix(0.52, 1.38, clamp(inflatePct/140.0, 0.0, 1.0));
    float variant = 0.94 + 0.08*sin(id*2.31);
    float r0 = 0.058*puff*variant;
    float rm = 0.155*puff*variant;
    float r1 = 0.050*puff*variant;
    vec3 a = vec3(start, 0.0, 0.0);
    vec3 b = vec3(start + len*0.48, bend, 0.025*sin(id*1.4));
    vec3 c = vec3(start + len, 0.015*sin(id*2.0), 0.0);
    float d0 = sdTaperedSegment(q, a, b, r0, rm);
    float d1 = sdTaperedSegment(q, b, c, rm, r1);
    float d = smoothUnion(d0, d1, 0.075*puff);

    // 原作の周期リングを、表面を横切る浅い隆起へ置き換える。
    float u = clamp((xy.x-start)/len, 0.0, 1.0);
    float wave = saw_function(u*2.15 - iTime*speed*0.22 + id*0.17);
    float ridge = pow(max(1.0-abs(wave), 0.0), 5.0);
    d -= 0.021*ridge*reliefPct*0.01;
    return d;
}

float sceneSDF(vec3 worldP, out float pieceId){
    vec3 p = toObject(worldP);
    float d = 10.0;
    pieceId = 0.0;
    for(int i=0; i<5; i++){
        float id = float(i);
        float di = inflatedPieceSDF(p, id);
        if(di < d){
            d = di;
            pieceId = id;
        }
    }
    return d;
}

float mapDistance(vec3 p){
    float unusedId;
    return sceneSDF(p, unusedId);
}

float march(vec3 ro, vec3 rd, out vec3 pos, out float pieceId){
    float travel = 0.0;
    float lastD = 1.0;
    pieceId = 0.0;
    for(int i=0; i<72; i++){
        pos = ro + rd*travel;
        lastD = sceneSDF(pos, pieceId);
        if(abs(lastD) < 0.0017) return travel;
        travel += max(lastD*0.70, 0.0035);
        if(travel > 7.0) break;
    }
    return -1.0;
}

vec3 getNormal(vec3 p){
    const float e = 0.0022;
    vec2 h = vec2(e, -e);
    return normalize(
        h.xyy*mapDistance(p + h.xyy) +
        h.yyx*mapDistance(p + h.yyx) +
        h.yxy*mapDistance(p + h.yxy) +
        h.xxx*mapDistance(p + h.xxx));
}

vec3 originalColor(float id){
    if(id < 0.5) return vec3(0.396, 0.294, 0.737);
    if(id < 1.5) return vec3(0.1411, 0.8156, 0.6823);
    if(id < 2.5) return vec3(0.8, 0.2, 0.4);
    if(id < 3.5) return vec3(0.5, 0.23, 0.8);
    return vec3(0.6, 0.3, 0.6);
}

vec3 chromeEnvironment(vec3 r){
    float horizon = smoothstep(-0.78, 0.88, r.y);
    float bandA = 1.0 - smoothstep(0.08, 0.25, abs(r.y + 0.10));
    float bandB = 1.0 - smoothstep(0.025, 0.10, abs(r.y - 0.56));
    float vertical = pow(max(r.x*0.5 + 0.5, 0.0), 7.0);
    vec3 env = mix(vec3(0.035), vec3(0.70, 0.72, 0.76), horizon);
    env += vec3(0.62, 0.65, 0.70)*bandA;
    env += vec3(0.95, 0.97, 1.00)*bandB;
    env += vec3(0.28)*vertical;
    return env;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
    vec2 uv = (fragCoord*2.0 - iResolution.xy) / iResolution.y;
    vec3 ro = vec3(0.0, 0.0, 3.25);
    vec3 rd = normalize(vec3(uv, -2.15));
    vec3 pos;
    float pieceId;
    float dist = march(ro, rd, pos, pieceId);
    float hit = step(0.0, dist);
    vec3 col = vec3(0.0);

    if(hit > 0.5){
        // ヒット位置でIDを再評価し、形状ごとに原作の1色を固定する。
        sceneSDF(pos, pieceId);
        vec3 n = getNormal(pos);
        vec3 refl = reflect(rd, n);
        vec3 lightDir = normalize(vec3(-0.45, 0.72, 0.52));
        float diff = max(dot(n, lightDir), 0.0);
        float spec = pow(max(dot(refl, lightDir), 0.0), 72.0);
        float fresnel = pow(1.0 - max(dot(-rd, n), 0.0), 4.0);

        vec3 chrome = chromeEnvironment(refl);
        chrome *= 0.66 + 0.34*diff;
        chrome += vec3(1.0)*spec*0.80 + vec3(0.42, 0.46, 0.52)*fresnel*0.42;

        // 5色の区別を残しつつ脱色。色面ではなく、色付き金属として見せる。
        vec3 tint = originalColor(pieceId);
        float tintLum = dot(tint, vec3(0.299, 0.587, 0.114));
        tint = mix(vec3(tintLum), tint, satPct*0.01);
        chrome = chrome*(0.55 + tint*0.72) + tint*(0.10 + 0.09*fresnel);

        vec3 graphite = vec3(0.10 + 0.48*diff + 0.58*spec);
        col = mix(graphite, chrome, chromePct*0.01);
        col = col/(1.0 + col*0.42);
        col = pow(max(col, 0.0), vec3(0.88));
    }

    // A は純黒背景を含む不透明出力、B は5個のパーツ以外を実 alpha で透過。
    fragColor = vec4(col, mix(hit, 1.0, uSlotIsA));
}`
}
,
{
  name: "Drifting Fractal Asteroids (3lBczV)",
  ch: ["","","",""],
  src: `// Adapted from Shadertoy 3lBczV "Fractal asteroid field" by jarble.
// https://www.shadertoy.com/view/3lBczV
// Original concept based on https://www.shadertoy.com/view/4tcGDr
// VJ: カメラを滑らかな疑似ランダム軌道へ変更し、岩塊ごとに異なる流動を追加。
//     Slot A=黒背景、Slot B=背景を実alphaで透過。
// @param speed 0..3 = 0.7
// @param camRandomPct 0..100 = 68
// @param rockMotionPct 0..100 = 48
// @param travelPct 0..150 = 75
// @param colorPct 0..100 = 62
uniform float speed;
uniform float camRandomPct;
uniform float rockMotionPct;
uniform float travelPct;
uniform float colorPct;
uniform float uSlotIsA;

const int DEPTH_LAYERS = 4;

mat2 rot2(float a){
    float c = cos(a), s = sin(a);
    return mat2(c, s, -s, c);
}

float hash11(float p){
    p = fract(p*0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

// 時間方向に連続する値ノイズ。カメラを急に切り替えずランダムに蛇行させる。
float smoothRand(float x){
    float i = floor(x);
    float f = fract(x);
    f = f*f*(3.0-2.0*f);
    return mix(hash11(i), hash11(i+1.0), f)*2.0-1.0;
}

vec3 randomCurve(float x){
    return vec3(smoothRand(x), smoothRand(x+19.17), smoothRand(x+43.71));
}

vec3 hash33(vec3 p){
    p = fract(p*vec3(0.1031,0.1030,0.0973));
    p += dot(p,p.yxz+33.33);
    return fract((p.xxy+p.yxx)*p.zyx);
}

float triWave(float x){
    return abs(fract(x)*2.0-1.0)*2.0-1.0;
}

vec3 surfaceColor(vec3 p, vec3 n, float materialId){
    // 原作の紫・苔色・赤褐色を軽い空間変化で再構成。
    vec3 bands = 0.5 + 0.5*sin(vec3(materialId*2.3,materialId*3.7,materialId*5.1)
                                   + p*vec3(0.21,0.17,0.19));
    vec3 mauve = vec3(0.36,0.22,0.31);
    vec3 moss = vec3(0.32,0.38,0.23);
    vec3 clay = vec3(0.43,0.25,0.20);
    vec3 tint = mix(mauve, moss, bands.y);
    tint = mix(tint, clay, bands.x*bands.z*0.72);
    float luma = dot(tint, vec3(0.299,0.587,0.114));
    tint = mix(vec3(luma), tint, colorPct*0.01);
    float grain = 0.86 + 0.14*sin(dot(p,vec3(0.91,1.17,0.73)) + n.y*4.0);
    return tint*grain;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
    vec2 uv = (fragCoord*2.0-iResolution.xy)/iResolution.y;
    float t = iTime*speed;
    float camAmt = camRandomPct*0.01;
    float travelSpeed = mix(0.045,0.23,clamp(travelPct/150.0,0.0,1.0));

    // 複数周期の値ノイズを混ぜ、同じ旋回を繰り返さないカメラパスにする。
    vec3 slow = randomCurve(t*0.115);
    vec3 detail = randomCurve(t*0.31+71.0);
    float roll = 0.24*camAmt*smoothRand(t*0.17+101.0);
    vec2 cameraShift = (slow.xy*0.62+detail.yx*0.18)*camAmt;

    float bestDepth = 100000.0;
    float bestId = 0.0;
    vec2 bestQ = vec2(0.0);
    vec2 bestDir = vec2(1.0,0.0);
    vec3 bestCenter = vec3(0.0);
    float motion = rockMotionPct*0.01;

    // 4枚の奥行き層だけを評価。各層は画面空間に多数の岩セルを持つ。
    for(int i=0; i<DEPTH_LAYERS; i++){
        float fi = float(i);
        float cycle = t*travelSpeed+fi/float(DEPTH_LAYERS);
        float z = fract(cycle);
        float epoch = floor(cycle);
        float depth = mix(11.5,1.25,z);

        float layerTurn = roll+0.08*camAmt*smoothRand(epoch+fi*13.7);
        vec2 p = rot2(layerTurn)*(uv*depth*0.72);
        p += cameraShift*(0.34+0.66*z);
        p += vec2(epoch*1.71+fi*7.3,epoch*-1.23+fi*3.9);

        vec2 cell = floor(p);
        vec2 local = fract(p)-0.5;
        vec3 rnd = hash33(vec3(cell,epoch+fi*17.0));
        vec2 driftRate = vec2(0.51+0.61*rnd.x,0.48+0.57*rnd.y);
        vec2 center = (rnd.xy-0.5)*0.13;
        center += vec2(triWave(t*driftRate.x*0.18+rnd.z),
                       triWave(t*driftRate.y*0.18+rnd.x))*0.075*motion;

        float radius = mix(0.245,0.405,rnd.z);
        vec2 axis = radius*vec2(mix(0.72,1.18,rnd.x),mix(0.76,1.15,rnd.y));
        vec2 dir = normalize((rnd.xy-0.5)+0.22*motion*vec2(
            triWave(t*0.11+rnd.z),triWave(t*0.13+rnd.x)));
        vec2 perp = vec2(-dir.y,dir.x);
        vec2 delta = local-center;
        vec2 q = vec2(dot(delta,dir),dot(delta,perp))/axis;

        // 大小2ローブを重ね、完全な球ではない欠けた岩の輪郭にする。
        vec2 qLobe = (q-(rnd.zy-0.5)*0.34)/vec2(0.76+0.16*rnd.x,0.78+0.14*rnd.y);
        float shape = dot(q,q);
        float lobeShape = dot(qLobe,qLobe);
        if(lobeShape < shape){
            shape = lobeShape;
            q = qLobe;
        }
        shape += 0.28*(rnd.z-0.5)*q.x*q.y;
        shape += 0.18*((rnd.x-0.5)*q.x*q.x*q.x+(rnd.y-0.5)*q.y*q.y*q.y);
        if(shape < 1.0){
            float frontDepth = depth-radius*0.55*sqrt(max(1.0-shape,0.0));
            if(frontDepth >= bestDepth) continue;
            bestDepth = frontDepth;
            bestId = dot(rnd,vec3(1.0,7.0,13.0))+epoch*0.31+fi;
            bestQ = q;
            bestDir = dir;
            bestCenter = vec3(cell,depth);
        }
    }

    float hit = step(bestDepth,999.0);
    vec3 col = vec3(0.0);

    if(hit > 0.5){
        float nz = sqrt(max(1.0-dot(bestQ,bestQ),0.0));
        vec2 planar = bestDir*bestQ.x+vec2(-bestDir.y,bestDir.x)*bestQ.y;
        vec3 n = normalize(vec3(planar,-nz));
        vec3 crag = sin(vec3(bestQ.x*5.1+bestId,
                             bestQ.y*6.3-bestId*0.7,
                             (bestQ.x-bestQ.y)*4.4+bestId*1.3));
        n = normalize(n+crag*vec3(0.23,0.23,0.11));
        vec3 lightDir = normalize(vec3(-0.42,0.68,-0.62));
        vec3 viewDir = vec3(0.0,0.0,-1.0);
        vec3 halfDir = normalize(lightDir+viewDir);
        float diff = max(dot(n,lightDir),0.0);
        float back = max(dot(n,-lightDir),0.0);
        float spec = pow(max(dot(n,halfDir),0.0),22.0);
        float rim = pow(1.0-max(dot(n,viewDir),0.0),3.0);

        vec3 base = surfaceColor(bestCenter,n,bestId);
        col = base*(0.32+0.74*diff+0.12*back);
        col += vec3(0.72,0.66,0.62)*spec*0.38;
        col += base*rim*0.20;
        float fog = exp(-bestDepth*0.070);
        col *= fog;
        col = pow(max(col,0.0),vec3(0.88));
    }

    fragColor = vec4(col, mix(hit,1.0,uSlotIsA));
}`
}
,
{
  name: "Deep Chrome Twisty (MsyyRc)",
  ch: ["","","",""],
  src: `// Adapted from Shadertoy MsyyRc "Twisty" by felipunkerito.
// https://www.shadertoy.com/view/MsyyRc
// VJ: 原作の「球でくり抜いた箱」の稜を2系統の帯として再構成し、2軸で強くねじる。
//     反射床は外し、Slot A=純黒背景、Slot B=本体以外を実alphaで透過。
// @param speed 0..3 = 0.7
// @param twistPct 0..250 = 175
// @param spin 0..3 = 0.65
// @param ribbonPct 0..100 = 56
// @param contrastPct 0..150 = 105
uniform float speed;
uniform float twistPct;
uniform float spin;
uniform float ribbonPct;
uniform float contrastPct;
uniform float uSlotIsA;

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;

mat2 rot2(float a){
    float c = cos(a), s = sin(a);
    return mat2(c,-s,s,c);
}

vec3 toTwistedObject(vec3 p){
    float t = iTime*speed;

    // 形そのものが読める速度で3軸タンブル。Twistとは独立して止められる。
    p.xy = rot2(t*0.19*spin+0.18*sin(t*0.31))*p.xy;
    p.xz = rot2(-t*0.27*spin+0.22*cos(t*0.23))*p.xz;
    p.yz = rot2(0.31*sin(t*0.37*spin+0.7))*p.yz;

    // 原作の twiX / twiY を強調。位置ごとに角度を変え、帯を深い螺旋へ曲げる。
    float twist = mix(0.30,6.60,clamp(twistPct/250.0,0.0,1.0));
    p.yz = rot2(p.x*twist*0.56+0.62*sin(t*0.43))*p.yz;
    p.xz = rot2(p.y*twist*0.64-0.57*cos(t*0.37+0.8))*p.xz;
    return p;
}

float ribbonField(vec3 p){
    vec3 q = toTwistedObject(p);
    float t = iTime*speed;
    float r = max(length(q),0.0001);
    float a = atan(q.z,q.x);
    float b = atan(q.y,q.z);
    float lat = asin(clamp(q.y/r,-1.0,1.0));

    // 球でくり抜かれた箱の「稜」を、交差する2系統の閉じたクロム帯として再構成。
    // 座標Twistと位相Twistを重ね、元より大きく捻れるが連続した輪郭を保つ。
    float twist = mix(0.30,6.60,clamp(twistPct/250.0,0.0,1.0));
    float d1 = abs(sin(a*1.50+lat*0.72+q.y*twist*0.46+t*0.16));
    float d2 = abs(sin(b*1.50-q.x*twist*0.43-t*0.13+0.65));
    return min(d1,d2);
}

vec2 raySphere(vec3 ro,vec3 rd,float radius){
    float b = dot(ro,rd);
    float c = dot(ro,ro)-radius*radius;
    float h = b*b-c;
    if(h<0.0) return vec2(-1.0);
    h = sqrt(h);
    return vec2(-b-h,-b+h);
}

vec3 ribbonNormal(vec3 p,float radius,float field,float width){
    const float e = 0.0060;
    vec2 h = vec2(e,-e);
    vec3 grad =
        h.xyy*ribbonField(p+h.xyy)+
        h.yyx*ribbonField(p+h.yyx)+
        h.yxy*ribbonField(p+h.yxy)+
        h.xxx*ribbonField(p+h.xxx);
    float bevel = smoothstep(width*0.18,width,field);
    return normalize(p/radius+normalize(grad+vec3(0.0001))*0.42*bevel);
}

vec3 chromeEnvironment(vec3 r){
    float horizon = smoothstep(-0.72,0.86,r.y);
    float whiteBand = 1.0-smoothstep(0.045,0.16,abs(r.y-0.34));
    float lowBand = 1.0-smoothstep(0.07,0.24,abs(r.y+0.34));
    float az = atan(r.z,r.x)/TAU+0.5;
    float panels = pow(0.5+0.5*cos(az*TAU*4.0),10.0);
    float pin = pow(max(dot(r,normalize(vec3(-0.45,0.76,0.47))),0.0),72.0);

    vec3 env = vec3(mix(0.018,0.54,horizon));
    env += vec3(0.92)*whiteBand;
    env += vec3(0.20)*lowBand;
    env += vec3(0.30)*panels*(0.35+0.65*horizon);
    env += vec3(1.0)*pin;
    return env;
}

vec3 shadeRibbon(vec3 p,vec3 rd,float radius,float field,float width){
    vec3 n = ribbonNormal(p,radius,field,width);
    // 穴越しに見える裏側も金属面として読めるよう、視線側へ法線をそろえる。
    if(dot(n,-rd)<0.0) n = -n;
    vec3 reflected = reflect(rd,n);
    vec3 key = normalize(vec3(-0.48,0.74,0.46));
    vec3 halfDir = normalize(key-rd);
    float diff = max(dot(n,key),0.0);
    float spec = pow(max(dot(n,halfDir),0.0),92.0);
    float fresnel = pow(1.0-max(dot(-rd,n),0.0),4.5);
    float facing = 0.5+0.5*n.y;
    float ridge = sqrt(max(1.0-field*field/max(width*width,0.0001),0.0));

    vec3 col = chromeEnvironment(reflected);
    col *= 0.48+0.31*diff+0.15*facing+0.06*ridge;
    col += vec3(1.0)*spec*1.10;
    col += vec3(0.48)*fresnel;
    return col;
}

void mainImage(out vec4 fragColor,in vec2 fragCoord){
    vec2 uv = (fragCoord*2.0-iResolution.xy)/iResolution.y;
    float t = iTime*speed;

    // ごく小さく視点も揺らし、強いTwistの奥行きを見失わないようにする。
    vec3 ro = vec3(0.16*sin(t*0.17),0.12*cos(t*0.13),3.80);
    vec3 target = vec3(0.0,0.02*sin(t*0.21),0.0);
    vec3 ww = normalize(target-ro);
    vec3 uu = normalize(cross(vec3(0.0,1.0,0.0),ww));
    vec3 vv = cross(ww,uu);
    vec3 rd = normalize(uv.x*uu+uv.y*vv+2.20*ww);

    const float radius = 1.36;
    vec2 bound = raySphere(ro,rd,radius);
    float sphereHit = step(0.0,bound.y);
    float width = mix(0.075,0.285,clamp(ribbonPct*0.01,0.0,1.0));
    float aa = 2.7/iResolution.y;
    vec3 col = vec3(0.0);
    float alpha = 0.0;

    if(sphereHit>0.5){
        vec3 nearP = ro+rd*bound.x;
        vec3 farP = ro+rd*bound.y;
        float nearField = ribbonField(nearP);
        float farField = ribbonField(farP);
        float nearMask = 1.0-smoothstep(width,width+aa,nearField);
        float farMask = 1.0-smoothstep(width,width+aa,farField);

        vec3 nearCol = shadeRibbon(nearP,rd,radius,nearField,width);
        vec3 farCol = shadeRibbon(farP,rd,radius,farField,width)*0.78;
        col = nearCol*nearMask+farCol*farMask*(1.0-nearMask);
        alpha = nearMask+farMask*(1.0-nearMask);

        // 無彩色を維持したままクロムの黒締まりと白い映り込みを調整。
        float c = clamp(contrastPct/100.0,0.0,1.5);
        col = (col-0.38)*c+0.38;
        col = max(col,0.0);
        col = col/(1.0+col*0.36);
        col = pow(col,vec3(0.86));
    }

    // Aは純黒を含む不透明出力、Bは物体だけを残す。
    fragColor = vec4(col,mix(alpha,1.0,uSlotIsA));
}`
}
,
{
  name: "Painty (4dSBDc)",
  ch: ["","","",""],
  src: `// Shadertoy 4dSBDc "Painty" by manylegged (単一パス)。https://www.shadertoy.com/view/4dSBDc
// simplex noise: Ian McEwan / Ashima Arts (MIT)。
// VJ: 帯の流れ/歪み量/ブラシ本数を可変化。オクターブとブラシループは ANGLE 対策で uniform 依存上限。
// @param speed 0..3 = 1
// @param warpPct 0..60 = 10
// @param brush 2..16 = 10
// @param octaves 1..8 = 6
uniform float speed;
uniform float warpPct;  // ノイズによる歪み量 (原作は 10)
uniform float brush;    // 重ねるブラシストローク数
uniform float octaves;  // fbm のオクターブ数

vec3 mod289(vec3 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
    return mod289(((x*34.0)+1.0)*x);
}

vec4 taylorInvSqrt(vec4 r)
{
    return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise(vec3 v)
{
    const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy) );
    vec3 x0 =   v - i + dot(i, C.xxx) ;

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute( permute( permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                               + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
                      + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );

    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );

    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                                  dot(p2,x2), dot(p3,x3) ) );
}


float fractal_noise(vec3 v)
{
    float x = 0.0;
    float a = 0.5;
    int oct = int(min(octaves, iResolution.x));
    for (int i=0; i<oct; i++)
    {
        x += a * snoise(v);
        v *= 2.0;
        a *= 0.5;
    }
    return x;
}

vec3 temp2rgb(float temp)
{
    temp /= 100.0;

    float red, green, blue;

    if (temp <= 66.0) {
        red = 255.0;
    } else {
        red = temp - 60.0;
        red = 329.698727446 * pow(red, -0.1332047592);
        red = clamp(red, 0.0, 255.0);
    }

    if (temp <= 66.0) {
        green = 99.4708025861 * log(temp) - 161.1195681661;
    } else {
        green = temp - 60.0;
        green = 288.1221695283 * pow(green, -0.0755148492);
    }
    green = clamp(green, 0.0, 255.0);

    if (temp >= 66.0) {
        blue = 255.0;
    } else if (temp <= 19.0) {
        blue = 0.0;
    } else {
        blue = temp - 10.0;
        blue = 138.5177312231 * log(blue) - 305.0447927307;
        blue = clamp(blue, 0.0, 255.0);
    }

    return vec3(red, green, blue) / 255.0;
}


float cardinal(float y0, float y1, float y2, float y3, float t, float c)
{
    float t2 = t * t;
    float t3 = t2 * t;
    float h1 = 2.0 * t3 - 3.0 * t2 + 1.0;
    float h2 = -2.0 * t3 + 3.0 * t2;
    float h3 = t3 - 2.0 * t2 + t;
    float h4 = t3 - t2;
    float m1 = c * (y2 - y0);
    float m2 = c * (y3 - y1);
    float r  = m1 * h3 + y1 * h1 + y2 * h2 + m2 * h4;
    return r;
}

vec3 cardinal(vec3 y0, vec3 y1, vec3 y2, vec3 y3, float t, float c)
{
    return vec3(cardinal(y0.x, y1.x, y2.x, y3.x, t, c),
                cardinal(y0.y, y1.y, y2.y, y3.y, t, c),
                cardinal(y0.z, y1.z, y2.z, y3.z, t, c));
}

vec3 hsv2rgb(vec3 c)
{
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float scale(float v, float r)
{
    return (v - r) / (1.0 - r);
}

vec3 img(vec2 uv)
{
    vec3 c = vec3(0.0);

    if (uv.y > 0.75)
    {
        if (uv.x < 0.25)
            c = cardinal(vec3(0.0), vec3(0.0), temp2rgb(1000.0), temp2rgb(2000.0), 4.0 * uv.x, 0.0);
        else
        	c = temp2rgb(1000.0 + scale(uv.x, 0.25) * 5500.0);
    }
    else if (uv.y > 0.5)
    {
        c = vec3(uv.x);
    }
    else if (uv.y > 0.25)
    {
        c = hsv2rgb(vec3(280.0/360.0 - 280.0/360.0 * uv.x, 1.0, 0.5 * uv.x + 0.5));
    }
    else
    {
		c = vec3(0.0, 0.98, 1.0) * uv.x;
    }
    return c;
}

vec3 painty(vec2 uv, float t)
{
    vec3 a = vec3(0.0);
    int c = int(min(brush, iResolution.x));
    float w = warpPct*0.01;
    for (int i=0; i<c; i++) {
        vec2 v = uv + w * fractal_noise(vec3(uv * 10.0, t - float(i) * 0.016));
        a += img(v);
    }
    return a / float(c);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
	vec2 uv = fragCoord.xy / iResolution.xy;

    vec3 c = painty(uv, iTime*speed);

	fragColor = vec4(c, 1.0);
}`
}
];
