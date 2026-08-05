// =====================================================
// bg_spiky  (H44)
//   Source : Shadertoy "Spiky" https://www.shadertoy.com/view/MssXz4
//            (u2 / Revision 2014)。回転するスパイクボールの SDF レイマーチ。
//   改変: 背景を真っ黒に(床・フォグ・SSS を撤去)、表面をクローム(銀の環境反射)に。
//         カメラ回転は元の iMouse を time 自動回転に置換。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは sp_ で名前空間化。
// =====================================================

const float SP_NBSPIKES = 16.0;

float sp_Psphere(vec3 p, vec3 c, float r){
  return length(p - c) - r;
}

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

// polynomial smooth min
float sp_blendPrim(float a, float b){
  float k = 0.32;
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
  float div = 2.0*PI / SP_NBSPIKES;
  angle /= div;
  angle = floor(angle);
  id = angle.x + angle.y;
  angle = angle*div;
  angle += div*0.5;
  return sp_FromEuler(angle);
}

float sp_Pcapsule1(vec3 p, vec3 dir, float dist, float thickmin, float thickmax){
  return sp_Pcapsule(p, dir*1.0, dir*(dist - 3.0), thickmin, thickmax);
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
float sp_Spiky(vec3 p){
  vec4 q = sp_QuatFromAxisAngle(normalize(vec3(cos(time*0.7), 1.0, 0.0)), time*1.5 - 0.35*length(p));
  p = sp_TransformVecQuat(p, q);

  float id;
  vec3 d = sp_ClassifyDir(p, id);
  vec3 infos = vec3(10.0, 0.3, 0.02);
  float p0 = sp_Pcapsule1(p, d, infos.x, infos.y, infos.z);
  float p1 = sp_Psphere(p, vec3(0.0), 2.5);
  return sp_blendPrim(p0, p1);
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
  vec3 c = mix(vec3(0.06, 0.07, 0.09), vec3(0.93, 0.95, 1.0), smoothstep(0.0, 0.9, up));
  c += vec3(0.6) * pow(max(d.y, 0.0), 5.0);             // 天頂のソフトライト
  float az = atan(d.x, d.z);
  c += vec3(0.3) * pow(max(cos(az*2.0), 0.0), 8.0);     // 横の反射帯
  return c;
}

vec3 bg_spiky(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;

  vec2 camRot = vec2(0.6, time*0.3);                    // 元の iMouse を自動回転に
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
    vec3 env = sp_env(rr);
    float fres = pow(1.0 - max(dot(nor, -vdir), 0.0), 4.0);
    vec3 lig = normalize(vec3(1.0, 0.8, -0.5));
    float spe = pow(max(dot(nor, normalize(lig - vdir)), 0.0), 60.0);
    col = mix(env*0.55, env, fres) + spe*vec3(1.0)*1.6;
  }

  col = col*2.0/(1.0 + col);                // gain
  col = pow(max(col, 0.0), vec3(0.4545));   // gamma
  return col;
}
