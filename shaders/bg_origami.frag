// =====================================================
// bg_origami  (H38)
//   Source : Shadertoy "Origami Toggles" https://www.shadertoy.com/view/4dXXzS
//            (c) Hazel Quantock 2014 (CC BY-NC-SA 3.0)。折り紙状 IFS フラクタルのレイマーチ。
//   改変: キーボードトグルを全 ON 固定 / テクスチャ(iChannel0-2)を手続きノイズ化 /
//         カメラを中心(原点注視)に固定してゆっくり公転。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは og_ で名前空間化。
// =====================================================

// 全トグル ON 固定(元はキーボード入力)
bool og_Toggle(){ return true; }

// 手続きノイズ(元はテクスチャ参照)
float og_hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float og_vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = og_hash(i), b = og_hash(i+vec2(1,0));
  float c = og_hash(i+vec2(0,1)), d = og_hash(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float og_fbm(vec2 p){ return og_vnoise(p)*0.5 + og_vnoise(p*2.0+7.0)*0.3 + og_vnoise(p*4.0-3.0)*0.2; }

vec3 og_tetOffset = vec3(-0.1);

vec3 og_Transform(vec3 p){
  const float phi = 1.61803398875;
  // 折りをゆっくり「等速」で動かす(線形)。元の (T±sin(T)) は速度が 0〜2倍に脈打ち、
  // 折りが急加速する瞬間に abs 折りが“パチン”と切り替わってがたついていた。等速なら滑らか。
  float T = time * 0.5;
  float a0 = 0.2*phi*T;
  float a1 = 0.05*phi*phi*T;
  float c0 = cos(a0); vec2 s0 = vec2(1,-1)*sin(a0);
  float c1 = cos(a1); vec2 s1 = vec2(1,-1)*sin(a1);
  const int n = 9;
  float o = 1.0;
  for(int i=0; i<n; i++){
    p.x = abs(p.x + o) - o;
    p.xy = p.xy*c0 + p.yx*s0;
    p.xz = p.xz*c1 + p.zx*s1;
    o = o*0.75;
  }
  return p;
}

float og_DistanceField(vec3 pos){
  vec3 p = og_Transform(pos);
  // tetrahedra
  p -= og_tetOffset;
  return max(max(p.x+p.y+p.z, -p.x-p.y+p.z), max(p.x-p.y-p.z, -p.x+p.y-p.z))/sqrt(3.0) - 0.2;
}

vec3 og_Sky(vec3 ray){
  return mix(vec3(0.8), vec3(0.0), exp2(-(1.0/max(ray.y, 0.01))*vec3(0.4, 0.6, 1.0)));
}

vec3 og_Shade(vec3 pos, vec3 ray, vec3 normal, vec3 lightDir, vec3 lightCol, float distance){
  vec3 uv = og_Transform(pos);
  float grain = og_fbm(uv.xy*5.0);

  vec3 ambient = mix(vec3(0.54,0.56,0.59), vec3(0.68), (-normal.y*0.5+0.5));   // さらに明るく中立に(白い紙: 影が暗い青にならない)
  float aoRange = distance/10.0;
  float occlusion = max(0.0, 1.0 - og_DistanceField(pos + normal*aoRange)/aoRange);
  occlusion = exp2(-2.0*pow(occlusion, 2.0));
  occlusion *= mix(0.5, 1.0, pow(grain, 0.2));
  ambient *= occlusion;

  float ndotl = max(0.0, dot(normal, lightDir));
  float lightCut = smoothstep(0.0, 0.1, ndotl);
  vec3 light = lightCol*ndotl + ambient;

  float specularity = grain;
  vec3 h = normalize(lightDir - ray);
  float specPower = exp2(1.0 + 1.0*specularity);
  vec3 specular = lightCol*pow(max(0.0, dot(normal, h))*lightCut, specPower)*specPower/32.0;

  vec3 rray = reflect(ray, normal);
  vec3 reflection = og_Sky(rray);
  reflection *= occlusion;
  occlusion = max(0.0, 1.0 - og_DistanceField(pos + rray*aoRange)/(aoRange*dot(rray, normal)));
  occlusion = exp2(-2.0*pow(occlusion, 2.0));
  reflection *= occlusion;

  float fresnel = pow(1.0 + dot(normal, ray), 5.0);
  fresnel = mix(mix(0.0, 0.05, specularity), 0.8, fresnel);

  uv -= og_tetOffset;
  vec3 uv2 = uv;
  if(uv2.x + uv2.z < 0.0) uv2.xz = -uv2.zx;
  if(uv2.z < uv2.x) uv2.x = uv2.z;
  float side = uv2.x + uv2.y;

  // 無地の白い折り紙(裏表で僅かな濃淡のみ、印刷模様なし)
  vec3 albedo = mix(vec3(0.97), vec3(1.0), step(0.0, side));   // 白い紙(裏表の濃淡を最小に)

  vec3 result = light*albedo;
  result = mix(result, reflection, fresnel);
  result += specular;
  return result;
}

float og_traceStart = 0.1;
float og_traceEnd = 20.0;
float og_Trace(vec3 pos, vec3 ray){
  float t = og_traceStart, h;
  for(int i=0; i<60; i++){
    h = og_DistanceField(pos + t*ray);
    if(h < 0.001 || t > og_traceEnd) break;
    t = t + h;
  }
  if(t > og_traceEnd) return 0.0;
  return t;
}

float og_TraceMin(vec3 pos, vec3 ray){
  float Min = og_traceEnd, t = og_traceStart, h;
  for(int i=0; i<60; i++){
    h = og_DistanceField(pos + t*ray);
    Min = min(h, Min);
    if(t > og_traceEnd) break;
    t = t + max(h, 0.1);
  }
  return Min;
}

vec3 og_Normal(vec3 pos, vec3 ray, float distance){
  vec2 d = vec2(-1,1) * 0.5 * distance / resolution.x;
  vec3 p0 = pos+d.xxx, p1 = pos+d.xyy, p2 = pos+d.yxy, p3 = pos+d.yyx;
  float f0 = og_DistanceField(p0), f1 = og_DistanceField(p1);
  float f2 = og_DistanceField(p2), f3 = og_DistanceField(p3);
  vec3 grad = p0*f0 + p1*f1 + p2*f2 + p3*f3 - pos*(f0+f1+f2+f3);
  float gdr = dot(grad, ray);
  grad -= max(0.0, gdr)*ray;
  return normalize(grad);
}

vec3 og_Ray(float zoom, vec2 fragCoord){
  return vec3(fragCoord.xy - resolution.xy*0.5, resolution.x*zoom);
}

vec3 og_Rotate(inout vec3 v, vec2 a){
  vec4 cs = vec4(cos(a.x), sin(a.x), cos(a.y), sin(a.y));
  v.yz = v.yz*cs.x + v.zy*cs.y*vec2(-1,1);
  v.xz = v.xz*cs.z + v.zx*cs.w*vec2(1,-1);
  vec3 p;
  p.xz = vec2(-cs.w, -cs.z)*cs.x;
  p.y = cs.y;
  return p;
}

void og_BarrelDistortion(inout vec3 ray, float degree){
  ray.z /= degree;
  ray.z = (ray.z*ray.z - dot(ray.xy, ray.xy));
  ray.z = degree*sqrt(ray.z);
}

vec3 og_LensFlare(vec3 ray, vec3 light, float lightVisible, float sky, vec2 fragCoord){
  vec2 dirtuv = fragCoord.xy/resolution.x;
  float dirt = 1.0 - og_fbm(dirtuv*4.0);
  float l = (dot(light, ray)*0.5 + 0.5);
  return (((pow(l,30.0)+0.1)*dirt*0.1 + 1.0*pow(l,200.0))*lightVisible + sky*1.0*pow(l,5000.0))*vec3(1.05,1.0,0.95);
}

vec3 bg_origami(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;

  // カメラ空間レイ(バレル歪み込み)。zoom を上げて折り紙で画面を満たす(中心ズレを目立たなくする)
  vec3 cray = og_Ray(4.5, I);
  og_BarrelDistortion(cray, 0.5);
  cray = normalize(cray);
  vec3 localRay = cray;

  // ランダムな軌道で原点を周回(無理数比のサインを重ねて疑似ランダム化)。距離もゆらがせる。
  float T = time;
  float az = T*0.12 + sin(T*0.047)*1.10 + sin(T*0.0193)*0.70;
  float el = -0.20 + sin(T*0.031)*0.55 + sin(T*0.017)*0.35;
  vec2 ang = vec2(el, az);
  vec3 d = vec3(0.0, 0.0, 1.0);
  vec3 camDir = og_Rotate(d, ang);
  float dist = 7.0 + 2.0*sin(T*0.026);
  vec3 pos = dist * camDir;

  // 注視点は原点固定(塊を無理に追わない=ガタつき防止)。ズームで画面を満たすため中心ズレは目立たない。
  vec3 target = vec3(0.0);

  // lookAt 基底でカメラ空間レイをワールドへ(上方向は y 固定でロールを安定化)
  vec3 fwd = normalize(target - pos);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 upv = cross(fwd, right);
  vec3 ray = normalize(cray.x*right + cray.y*upv + cray.z*fwd);

  vec3 col;
  vec3 lightDir = normalize(vec3(3,2,-1));

  float t = og_Trace(pos, ray);
  if(t > 0.0){
    vec3 p = pos + ray*t;
    float s = og_Trace(p, lightDir);          // shadow
    vec3 n = og_Normal(p, ray, t);
    col = og_Shade(p, ray, n, lightDir, (s>0.0)?vec3(0):vec3(1.1,1.0,0.9), t);
    float f = 1000.0;
    col = mix(vec3(0.8), col, exp2(-t*vec3(0.4,0.6,1.0)/f));
  } else {
    col = vec3(0.0);                          // 背景は黒 (entrypoint が uBgColor で塗る)
  }
  bgAlpha = (t > 0.0) ? 1.0 : 0.0;            // 折り紙=不透明 / 空=透明

  // レンズフレア
  float sun = og_TraceMin(pos, lightDir);
  col += og_LensFlare(ray, lightDir, smoothstep(-0.04, 0.1, sun), step(t, 0.0), I);
  // ビネット
  col *= smoothstep(0.5, 0.0, dot(localRay.xy, localRay.xy));
  // 明部圧縮(ブルーム代替)
  vec3 c = (col - 1.0);
  c = sqrt(c*c + 0.05);
  col = mix(col, 1.0 - c, 0.48);

  return pow(col, vec3(1.0/2.2));
}
