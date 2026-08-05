// =====================================================
// bg_juice  (H49)  — 差し替え: "space shield" を浅葱色に寄せた版
//   Source : Shadertoy "space shield"  https://www.shadertoy.com/view/3XtXD2
//   Kali ボリュメトリック・ネビュラ + シールド模様(map)。元は iChannel0 テクスチャの
//   ブラーを使うが、GARA は単一パス・テクスチャ不使用のため手続きの柔らかい雲で代替。
//   全体を浅葱色(asagi)のグラデに寄せて着色。
//   iTime,iResolution → time,resolution / iMouse 固定 / bgZoom・bgCamPx 対応。
//   cosineGradient(uCosGrad)対応 / Slot B は暗部透過。ヘルパは ss_ で名前空間化。
// =====================================================

float ss_fn1(float v){ return v*16.0; }
vec2  ss_hash21(float p){
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 19.19);
  return fract(vec2((p3.x+p3.y)*p3.z, (p3.x+p3.z)*p3.y));
}
mat2 ss_rotate2d(float a){ return mat2(cos(a), -sin(a), sin(a), cos(a)); }
vec3 ss_hue(float t){ float h = t*6.2831; return 0.5 + 0.5*cos(h + vec3(0.0, 0.50, 1.0)); }

// シールド模様: 同心セグメント + sin 波
float ss_map(vec2 uv){
  float circle = length(uv)/0.95;
  float segment = floor(circle/0.6);
  float segFrac = fract(circle);
  float limit = segment + smoothstep(0.15, 0.5, segFrac);
  uv = normalize(uv)*0.4;
  uv += ss_hash21(limit);
  uv *= ss_rotate2d(time*0.1);
  return sin(ss_fn1(uv.x)) * sin(ss_fn1(uv.y));
}

vec3 bg_juice(vec2 fc){
  vec2 I  = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = I/resolution.xy - 0.5;
  uv.y *= resolution.y/resolution.x;
  vec3 dir = normalize(vec3(uv*0.8, 1.03));
  dir.z += time*0.1;

  // シールド模様 + ライティング
  vec2 uv2 = (2.0*I - resolution)/resolution.y; uv2 *= 3.0;
  float d = ss_map(uv2);
  vec2 eps = vec2(0.005*length(uv2), 0.0);
  vec3 normal = -normalize(vec3(d - ss_map(uv2+eps.xy), d - ss_map(uv2+eps.yx), 1.0));
  vec3 lightDir1 = normalize(vec3(1.0, 0.1, 0.0));
  vec3 lightDir2 = normalize(vec3(0.6, -0.5, -3.0));
  vec3 color = vec3(0.0);
  color += pow(dot(normal, lightDir1)*0.5 + 0.5, 5.0);
  color += vec3(0.1) * pow(dot(normal, lightDir2)*0.5 + 0.5, 0.6);
  vec3 mixedColor = mix(color, ss_hue(d), 0.25);
  color /= max(mixedColor, vec3(1e-3));
  color = clamp(color, 0.0, 4.0);

  // テクスチャブラーの代替: 手続きの柔らかい雲
  vec3 col1 = vec3(0.45) + 0.25*ss_hue(0.3*sin(uv.x*7.0 + time*0.1) + 0.3*sin(uv.y*6.0) + 0.1);

  vec3 from = vec3(1.0, 0.5, 0.5) + color*col1;

  // ボリュメトリック・ネビュラ(Kali)
  float s = 0.1, fade = 1.0;
  vec3 v = vec3(0.0);
  for(int r=0; r<14; r++){
    vec3 p = from + s*dir*0.5;
    p = abs(vec3(0.85) - mod(p, vec3(1.7)));     // tiling fold
    float pa, a = pa = 0.0;
    for(int i=0; i<10; i++){
      p = abs(p)/dot(p,p) - 0.53;
      p.xy *= ss_rotate2d(time*0.02);
      a += abs(length(p) - pa);
      pa = length(p);
    }
    float dm = max(0.0, 0.30 - a*a*0.001);
    a *= a*a;
    if(r>2) fade *= 1.3 - dm;
    v += fade;
    v += vec3(s, s*s, s*s*s*s)*a*0.0015*fade;
    fade *= 0.73;
    s += 0.1;
  }
  v = mix(vec3(length(v)), v, 0.85);
  vec3 col = v * 0.03;

  // 浅葱色(asagi)に寄せる: 輝度→濃紺→浅葱→淡水色のグラデ
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 aDark = vec3(0.02, 0.10, 0.15);
  vec3 aMid  = vec3(0.00, 0.46, 0.56);   // 浅葱
  vec3 aLit  = vec3(0.68, 0.93, 0.98);   // 淡い水色
  vec3 grad = (lum < 0.5) ? mix(aDark, aMid, lum*2.0) : mix(aMid, aLit, (lum-0.5)*2.0);
  col = mix(col, grad, 0.80);

  if(abs(uCosGrad) > 0.0001){
    col = mix(col, cosGradColor(lum) * (0.2 + 1.4*lum), abs(uCosGrad));
  }
  bgAlpha = (uSlotIsA > 0.5) ? 1.0 : clamp(lum*2.5, 0.0, 1.0);   // Slot B は暗部透過
  return col;
}
