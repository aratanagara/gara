// =====================================================
// bg_twistors  (H45)
//   Source : Shadertoy "Twistors" https://www.shadertoy.com/view/MdS3R3
//            (sin 波で捻れる立方体トンネルを飛行するレイマーチ)。
//   改変: 背景を真っ黒に、表面の sin/cos 彩色を撤去してクローム(銀の環境反射)に。
//         1 バウンスの反射レイで立方体同士の映り込みを追加。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは tw_ で名前空間化。
// =====================================================

#define TW_R(p,a) p=cos(a)*p+sin(a)*vec2(-p.y,p.x);
const float TW_PI       = 3.141592653589793;
const float TW_THRESH   = 0.001;
const float TW_MAXITERS = 50.0;
const float TW_MAXD     = 100.0;
const vec3  TW_LIGHTPOS = vec3(10.0);

int tw_m; // material index

float tw_cube(vec4 c, vec3 pos){
  c.xyz -= pos;
  return max(max(abs(c.x)-c.w, abs(c.y)-c.w), abs(c.z)-c.w);
}

float tw_df(vec3 p){
  p += vec3(
    sin(p.z*1.55 + time) + sin(p.z*1.34 + time),
    0.0,
    sin(p.x*1.34 + time) + sin(p.x*1.55 + time)
  ) * 0.5;
  vec3 mp = mod(p, 1.0);
  mp.y = p.y;

  float s1 = tw_cube(vec4(0.5, 0.5, 0.5, 0.15),
                     vec3(mp.x, mp.y + (sin(p.z*TW_PI)*sin(p.x*TW_PI))*0.25, 0.5));
  float s2 = tw_cube(vec4(0.5, 0.5, 0.5, 0.15),
                     vec3(0.5, mp.y + (sin(p.x*TW_PI)*-sin(p.z*TW_PI))*0.25, mp.z));
  tw_m = s1 < s2 ? 0 : 1;
  return min(s1, s2);
}

vec2 tw_rm(vec3 pos, vec3 dir, float threshold, float td){
  vec3 startPos = pos;
  float l = 0.0;
  for(float i=0.0; i<=1.0; i += 1.0/TW_MAXITERS){
    l = tw_df(pos);
    if(abs(l) < threshold) break;
    pos += (l * dir * 0.7);
  }
  l = length(startPos - pos);
  return vec2(l < td ? 1.0 : -1.0, min(l, td));
}

float tw_softShadow(vec3 pos, vec3 l, float r, float f, float td){
  float d;
  vec3 p;
  float o = 1.0, maxI = 10.0, or_ = r;
  float len;
  for(float i=10.0; i>1.0; i--){
    len = (i - 1.0) / maxI;
    p = pos + ((l - pos) * len);
    r = or_ * len;
    d = clamp(tw_df(p), 0.0, 1.0);
    o -= d < r ? (r - d)/(r * f) : 0.0;
    if(o < 0.0) break;
  }
  return o;
}

// クロームが映す疑似環境(銀)
vec3 tw_env(vec3 d){
  float up = d.y*0.5 + 0.5;
  vec3 c = mix(vec3(0.06, 0.07, 0.09), vec3(0.93, 0.95, 1.0), smoothstep(0.0, 0.9, up));
  c += vec3(0.6) * pow(max(d.y, 0.0), 5.0);
  float az = atan(d.x, d.z);
  c += vec3(0.3) * pow(max(cos(az*2.0), 0.0), 8.0);
  return c;
}

vec3 tw_normal(vec3 point, vec2 e){
  return normalize((vec3(tw_df(point+e.xyy), tw_df(point+e.yxy), tw_df(point+e.yyx)) - tw_df(point)) / e.x);
}

vec3 bg_twistors(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;

  vec3 camPos = vec3(0.0, sin(time*0.3) + 3.0, time);
  vec3 uv = vec3(I / resolution.xy, 1.0);
  vec3 rayDir = normalize(uv);
  TW_R(rayDir.yz, sin(time*0.25)*0.25 + 1.25);
  TW_R(rayDir.xz, sin(time*0.2));

  float gd = TW_MAXD;
  vec2 march = tw_rm(camPos, rayDir, TW_THRESH, gd);
  vec3 point = camPos + rayDir*march.y;
  vec2 e = vec2(0.01, 0.0);

  vec3 col = vec3(0.0);
  bgAlpha = 0.0;                                     // 背景は透明
  if(march.x == 1.0){
    bgAlpha = 1.0;                                   // 被写体は不透明
    vec3 n = tw_normal(point, e);
    // クローム: 環境反射 + フレネル + 鋭いハイライト + AO
    vec3 rr = reflect(rayDir, n);
    vec3 env = tw_env(rr);
    float fres = pow(1.0 - max(dot(n, -rayDir), 0.0), 4.0);
    vec3 lig = normalize(TW_LIGHTPOS - point);
    float spe = pow(max(dot(n, normalize(lig - rayDir)), 0.0), 60.0);
    float ao = clamp(tw_softShadow(point, point + n, 2.0, 8.0, gd), 0.0, 1.0);
    col = (mix(env*0.55, env, fres) + spe*vec3(1.6)) * (0.35 + 0.65*ao);
    col *= exp2(-march.y*0.06);
  }

  col = col*2.0/(1.0 + col);                // gain
  col = pow(max(col, 0.0), vec3(0.4545));   // gamma
  return col;
}
