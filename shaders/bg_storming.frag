// =====================================================
// bg_storming  (H50)
//   Source : Shadertoy "Storming Pixels"  https://www.shadertoy.com/view/Wl2SWG
//            Leon Denise (ponk) 2019 / IQ・McGuire のコード使用
//   改変: iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//         カメラに緩い自動回転を追加。空(sky)合成をやめ、構造のヒット量を被覆率に使って
//         背景透過(bgAlpha)。Slot A=黒背景(不透明) / それ以外=透過して重ねる。
//         cosineGradient(uCosGrad)対応。ヘルパは st_ で名前空間化。
// =====================================================

const float ST_RANGE   = 1.0;
const float ST_RADIUS  = 0.35;
const float ST_BLEND   = 0.7;
const float ST_BALANCE = 1.9;
const float ST_FALLOFF = 1.8;

float st_random(vec2 p){ return fract(1e4 * sin(17.0*p.x + p.y*0.1) * (0.1 + abs(sin(p.y*13.0 + p.x)))); }
mat2  st_rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
float st_smin(float a, float b, float r){ float h = clamp(0.5+0.5*(b-a)/r, 0.0, 1.0); return mix(b,a,h)-r*h*(1.0-h); }
vec3  st_look(vec3 eye, vec3 target, vec2 anchor, float fov){
  vec3 fwd = normalize(target-eye);
  vec3 right = normalize(cross(fwd, vec3(0,1,0)));
  vec3 up = normalize(cross(right, fwd));
  return normalize(fwd*fov + right*anchor.x + up*anchor.y);
}

float st_geometry(vec3 pos, float tm){
  // 流れるドメインワープ: 折り畳み前に pos を正弦場でうねらせる(有機的な歪み)
  pos += 0.16 * sin(pos.zxy * 1.7 + tm * 0.6);
  float a = 1.0;
  float scene = 1.0;
  float t = tm + pos.x/4.0;
  t = floor(t) + pow(fract(t), 0.5);
  for(int i=6; i>0; --i){
    pos.xy *= st_rot(cos(t)*ST_BALANCE/a + a*2.0);
    pos.zy *= st_rot(sin(t)*ST_BALANCE/a + a*2.0);
    pos.xz = abs(pos.xz) - ST_RANGE*a;
    scene = st_smin(scene, length(pos)-ST_RADIUS*a, ST_BLEND*a);
    a /= ST_FALLOFF;
  }
  return scene;
}

float st_raymarch(vec3 eye, vec3 ray, float tm, out float total){
  float dither = st_random(ray.xy + fract(time));
  total = 0.0;
  const int count = 30;
  for(int index=count; index>0; --index){
    float dist = st_geometry(eye + ray*total, tm);
    dist *= 0.9 + 0.1*dither;                 // 原典どおり(微細な粒揺らぎ)
    total += dist;
    if(dist < 0.001*total) return float(index)/float(count);
  }
  return 0.0;
}

vec3 st_cosgrad(vec3 col, float param){
  if(abs(uCosGrad) < 0.0001) return col;
  float cgInv = uCosGrad < 0.0 ? 0.5 : 0.0;
  vec3 cosCol = cosGradColor(param + cgInv);
  float lum = dot(col, vec3(0.299,0.587,0.114));
  cosCol *= 0.35 + 0.95*lum;
  return mix(col, clamp(cosCol,0.0,1.0), abs(uCosGrad));
}

vec3 bg_storming(vec2 fc){
  // 原作 Wl2SWG そのまま(改変なし)。粉状=フラクタルの微細な当たり/外れ+dither による per-pixel スペックル。
  //   ハーネス対応: fc→bgZoom/bgCamPx、iTime→time。カメラは原作どおり固定 eye=(1,3.5,1)。
  vec2 I  = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = 2.0*(I - 0.5*resolution) / resolution.y;

  // ワープ/カーブ: 画面 uv を「中心からの距離に応じた渦巻き」+「うねり」で歪める
  float rr = length(uv);
  uv *= st_rot((0.35 + 0.35*sin(time*0.25)) * rr);                       // 距離依存の渦巻き(カーブ)
  uv += 0.14 * vec2(sin(uv.y*3.0 + time*0.7), cos(uv.x*3.0 + time*0.6));  // うねりワープ
  uv *= 1.0 + 0.10 * sin(rr*3.5 - time*0.8);                             // 放射状のうねり(脈動)

  vec3 eye = vec3(1.0, 3.5, 1.0);
  vec3 ray = st_look(eye, vec3(0.0), uv, 2.0);

  float total = 0.0;
  vec3 o = vec3(0.0);
  // 原作の motion_frames ループ(1回)
  float dither = st_random(ray.xy + fract(time + 1.0));
  float tm = time + (dither + 1.0)/10.0;
  o = vec3(st_raymarch(eye, ray, tm, total));

  // 原作の色処理そのまま(最後のガンマ pow(.4545) は原作に無い)
  float gray = o.r;
  o *= vec3(0.8, 0.8, 0.9);
  float d = smoothstep(0.0, 2.0, length(uv));
  vec3 sky = mix(vec3(0.35, 0.37, 0.4), vec3(0.0), d);
  d = smoothstep(5.0, 0.0, total);
  o += vec3(0.8, 0.7, 0.6) * d;
  o = mix(sky, o, pow(clamp(o.r, 0.0, 1.0), 0.3));

  o = st_cosgrad(o, gray);
  bgAlpha = (uSlotIsA > 0.5) ? 1.0 : clamp(pow(clamp(gray, 0.0, 1.0), 0.3), 0.0, 1.0);
  return clamp(o, 0.0, 1.0);
}
