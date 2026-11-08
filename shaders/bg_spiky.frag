// =====================================================
// bg_spiky  (H44)
//   Source : Shadertoy "Spiky" https://www.shadertoy.com/view/MssXz4
//            (u2 / Revision 2014)。回転するスパイクボールの SDF レイマーチ。
//   改変: 背景を真っ黒に(床・フォグ・SSS を撤去)、表面をクローム(銀の環境反射)に。
//         カメラ回転は元の iMouse を time 自動回転に置換。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは sp_ で名前空間化。
// =====================================================

float sp_Psphere(vec3 p, vec3 c, float r){
  return length(p - c) - r;
}

// @param uCoreRadius 60..130  = 100.0
// @param uTipRadius  25..800  = 100.0
// @param uTaper      55..250  = 100.0
// @param uPolarStep  60..160  = 100.0
// @param uLengthVar  0..100   = 0.0
// @param uTwistAmt   0..200   = 100.0
// @param uStretch    70..125  = 100.0
// @param uFresnel    30..300  = 100.0
// @param uEnvTurn    -180..180 = 0.0
// @param uEnvRamp    40..250  = 100.0
// @param uLightAzim  -180..180 = 0.0
// @param uEnvBand    0..300   = 100.0
uniform float uCoreRadius; // 中心の球の半径 (%)
uniform float uTipRadius;  // トゲの先端の太さ (%)。上げると先が丸く鈍くなる
uniform float uTaper;      // トゲの先細りの指数 (%)。下げると根元から細く、上げると先端だけ急に細くなる
uniform float uPolarStep;  // 緯度方向のトゲの間隔 (%)。上げると緯度のトゲ段が減る
uniform float uLengthVar;  // トゲの長さのばらつき (%)。0 = 全部同じ長さ
uniform float uTwistAmt;   // 中心から離れるほどのねじれ (%)
uniform float uStretch;    // 球の縦横比 (%)。下げると平たく、上げると縦長
uniform float uFresnel;    // 縁の反射の広がり (%)。上げると縁だけが鋭く光る
uniform float uEnvTurn;    // 映り込む環境の向き (度)
uniform float uEnvRamp;    // 環境の明暗グラデの広がり (%)。上げると暗部が広がる
uniform float uLightAzim;  // ハイライトの光の向き (度)
uniform float uEnvBand;    // 環境の横の反射帯の強さ (%)

float sp_Pcapsule(vec3 p, vec3 a, vec3 b, float rmin, float rmax){
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  vec3 norm = normalize(b - a);
  float d = -dot(norm, a);
  float dist = dot(norm, p) + d;
  float rf = dist / length(b - a);
  float r = mix(rmin, rmax, rf*rf*rf);
  return length(pa - ba*h) - r;
}

float sp_PcapsuleC(vec3 p, vec3 a, vec3 b, float rmin, float rmax){
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  vec3 norm = normalize(b - a);
  float d = -dot(norm, a);
  float dist = dot(norm, p) + d;
  float rf = dist / length(b - a);
  float rf3 = rf*rf*rf;
  if(uTaper != 100.0) rf3 = sign(rf) * pow(max(abs(rf), 1e-4), 3.0 * (uTaper / 100.0));
  float r = mix(rmin, rmax, rf3);
  return length(pa - ba*h) - r;
}

// @param uSpikes 6..32   = 16.0
// @param uSoft   10..300 = 100.0
// @param uSize   25..300 = 100.0
// @param uLength 70..150 = 100.0
// @param uAngle  -180..180 = 0.0
// @param uTilt   -60..60 = 0.0
// @param uScale  60..150 = 100.0
// @param uSteps  24..40 = 40.0
uniform float uSpikes;   // トゲの密度 (角度の分割数)
uniform float uSoft;     // トゲの根元の滑らかさ (%)
uniform float uSize;     // トゲひとつの太さ (%)
uniform float uLength;   // トゲの長さ (%)
uniform float uAngle;    // 球全体の向き (度)
uniform float uTilt;     // カメラの仰角のオフセット (度)
uniform float uScale;    // 物体全体の大きさ (%)
uniform float uSteps;    // レイマーチの最大ステップ数 (下げると軽く、遠景や縁が欠ける)

// polynomial smooth min
float sp_blendPrim(float a, float b){
  float k = 0.32 * (uSoft / 100.0);
  float h = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0);
  return mix(b, a, h) - k*h*(1.0 - h);
}

vec2 sp_ToEuler(vec3 p){
  return vec2(atan(p.z, p.x),
              atan(sqrt(p.x*p.x + p.z*p.z), p.y));
}

vec3 sp_FromEuler(vec2 e){
  float c = sin(e.y);
  return vec3(c * cos(e.x),
              cos(e.y),
              c * sin(e.x));
}

vec3 sp_ClassifyDir(vec3 p, out float id){
  vec2 angle = sp_ToEuler(p);
  float div = 2.0*PI / uSpikes;
  angle /= div;
  angle = floor(angle);
  id = angle.x + angle.y;
  angle = angle*div;
  angle += div*0.5;
  return sp_FromEuler(angle);
}

vec3 sp_ClassifyDirC(vec3 p, out float id){
  vec2 angle = sp_ToEuler(p);
  float div = 2.0*PI / uSpikes;
  vec2 dv = vec2(div, div * (uPolarStep / 100.0));
  angle /= dv;
  angle = floor(angle);
  id = angle.x + angle.y;
  angle = angle*dv;
  angle += dv*0.5;
  return sp_FromEuler(angle);
}

float sp_Pcapsule1(vec3 p, vec3 dir, float dist, float thickmin, float thickmax){
  return sp_Pcapsule(p, dir*1.0, dir*(dist - 3.0), thickmin, thickmax);
}

float sp_Pcapsule1C(vec3 p, vec3 dir, float dist, float thickmin, float thickmax){
  return sp_PcapsuleC(p, dir*1.0, dir*(dist - 3.0), thickmin, thickmax);
}

vec4 sp_QuatFromAxisAngle(vec3 axis, float angle){
  float theta = 0.5*angle;
  float sine = sin(theta);
  return vec4(cos(theta), axis.x*sine, axis.y*sine, axis.z*sine);
}

vec3 sp_TransformVecQuat(vec3 v, vec4 q){
  vec3 t = 2.0*cross(q.xyz, v);
  return v + q.w*t + cross(q.xyz, t);
}

// Spiky ball の SDF
bool sp_custom = false;

float sp_SpikyC(vec3 p){
  float objS = uScale / 100.0;
  p /= objS;
  vec4 q = sp_QuatFromAxisAngle(normalize(vec3(cos(time*0.7), 1.0, 0.0)), time*1.5 - 0.35*(uTwistAmt / 100.0)*length(p) + radians(uAngle));
  p = sp_TransformVecQuat(p, q);
  float stF = 1.0;
  if(uStretch != 100.0){ p.y /= uStretch / 100.0; stF = min(1.0, uStretch / 100.0); }

  float id;
  vec3 d = sp_ClassifyDirC(p, id);
  float lenF = 1.0;
  if(uLengthVar != 0.0) lenF = 1.0 - 0.25 * (uLengthVar / 100.0) * fract(sin(id * 12.9898) * 43758.5453);
  vec3 infos = vec3(10.0 * (uLength / 100.0) * lenF, 0.3 * (uSize / 100.0), 0.02 * (uTipRadius / 100.0));
  float p0 = sp_Pcapsule1C(p, d, infos.x, infos.y, infos.z);
  float p1 = sp_Psphere(p, vec3(0.0), 2.5 * (uCoreRadius / 100.0));
  return sp_blendPrim(p0, p1) * objS * stF;
}

float sp_Spiky(vec3 p){
  if(sp_custom) return sp_SpikyC(p);
  float objS = uScale / 100.0;
  p /= objS;
  vec4 q = sp_QuatFromAxisAngle(normalize(vec3(cos(time*0.7), 1.0, 0.0)), time*1.5 - 0.35*length(p) + radians(uAngle));
  p = sp_TransformVecQuat(p, q);

  float id;
  vec3 d = sp_ClassifyDir(p, id);
  vec3 infos = vec3(10.0 * (uLength / 100.0), 0.3 * (uSize / 100.0), 0.02);
  float p0 = sp_Pcapsule1(p, d, infos.x, infos.y, infos.z);
  float p1 = sp_Psphere(p, vec3(0.0), 2.5);
  return sp_blendPrim(p0, p1) * objS;
}

vec3 sp_calcNormal(vec3 p){
  vec3 e = vec3(0.001, 0.0, 0.0);
  vec3 n = vec3(sp_Spiky(p + e.xyy) - sp_Spiky(p - e.xyy),
                sp_Spiky(p + e.yxy) - sp_Spiky(p - e.yxy),
                sp_Spiky(p + e.yyx) - sp_Spiky(p - e.yyx));
  return normalize(n);
}

float sp_TraceSpiky(vec3 vpos, vec3 vdir){
  float tmax = 80.0;
  float dist = 1.0;
  float t = 0.0;
  for(int i=0; i<40; i++){
    if(i >= int(uSteps + 0.5)) break;
    if(dist < 0.01 || dist > tmax) break;
    vec3 p = vpos + t*vdir;
    dist = sp_Spiky(p);
    t += dist;
  }
  return t;
}

void sp_CamPolar(out vec3 pos, out vec3 ray, in vec3 origin, in vec2 rotation, in float camDist, in float zoom, vec2 fragCoord){
  vec2 c = vec2(cos(rotation.x), cos(rotation.y));
  vec4 s;
  s.xy = vec2(sin(rotation.x), sin(rotation.y));
  s.zw = -s.xy;
  ray.xy = fragCoord.xy - resolution.xy*0.5;
  ray.z = resolution.y*zoom;
  ray = normalize(ray);
  ray.yz = ray.yz*c.xx + ray.zy*s.zx;
  ray.xz = ray.xz*c.yy + ray.zx*s.yw;
  pos = origin - camDist*vec3(c.x*s.y, s.z, c.x*c.y);
}

// クロームが映す疑似環境(銀)
vec3 sp_env(vec3 d){
  float up = d.y*0.5 + 0.5;
  vec3 c = mix(vec3(0.06, 0.07, 0.09), vec3(0.93, 0.95, 1.0), smoothstep(0.0, 0.9 * (uEnvRamp / 100.0), up));
  c += vec3(0.6) * pow(max(d.y, 0.0), 5.0);             // 天頂のソフトライト
  float az = atan(d.x, d.z);
  c += vec3(0.3 * (uEnvBand / 100.0)) * pow(max(cos(az*2.0), 0.0), 8.0);     // 横の反射帯
  return c;
}

vec3 bg_spiky(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;

  sp_custom = (uCoreRadius != 100.0 || uTipRadius != 100.0 || uTaper != 100.0 || uPolarStep != 100.0 || uLengthVar != 0.0 || uTwistAmt != 100.0 || uStretch != 100.0);
  vec2 camRot = vec2(0.6 + radians(uTilt), time*0.3);                    // 元の iMouse を自動回転に
  vec3 vpos, vdir;
  sp_CamPolar(vpos, vdir, vec3(0.0), camRot, 25.0 + 5.0*cos(time*0.1), 1.5, I);

  float ts = sp_TraceSpiky(vpos, vdir);
  vec3 pos = vpos + vdir*ts;

  vec3 col = vec3(0.0);
  bgAlpha = 0.0;                                         // 背景は透明
  if(sp_Spiky(pos) < 0.05 && ts < 79.0){
    bgAlpha = 1.0;                                       // 被写体は不透明
    vec3 nor = sp_calcNormal(pos);
    // クローム: 環境反射 + フレネル + 鋭いハイライト
    vec3 rr = reflect(vdir, nor);
    if(uEnvTurn != 0.0){ float ea = radians(uEnvTurn); float ce = cos(ea), se = sin(ea); rr.xz = mat2(ce, -se, se, ce) * rr.xz; }
    vec3 env = sp_env(rr);
    float fres = pow(1.0 - max(dot(nor, -vdir), 0.0), 4.0 * (uFresnel / 100.0));
    vec3 lig = normalize(vec3(1.0, 0.8, -0.5));
    if(uLightAzim != 0.0){ float la = radians(uLightAzim); float cl = cos(la), sl = sin(la); lig.xz = mat2(cl, -sl, sl, cl) * lig.xz; }
    float spe = pow(max(dot(nor, normalize(lig - vdir)), 0.0), 60.0);
    col = mix(env*0.55, env, fres) + spe*vec3(1.0)*1.6;
  }

  col = col*2.0/(1.0 + col);                // gain
  col = pow(max(col, 0.0), vec3(0.4545));   // gamma
  return col;
}
