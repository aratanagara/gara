// =====================================================
// bg_liqmount  (H51)
//   Source : Shadertoy "Liquid mountains"  https://www.shadertoy.com/view/wXdSRB
//   改変: iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//         山の「黒い(暗い)部分」だけをシルバー/クロム(環境反射)に置換。明るい色部分は維持。
//         背景透過(bgAlpha): Slot A=シルバー背景(不透明) / それ以外=透過して重ねる。
//         cosineGradient(uCosGrad)対応。ヘルパは lm_ で名前空間化。
// =====================================================

float lm_h(vec3 p){
  return (sin(p.x*0.9 + time) + 0.7*cos(p.z*1.1 + time)) / 2.0;
}

float lm_SDF(vec3 p){
  p /= 1.5;
  vec3 q = p;
  float scale = 0.2;
  float amplitude = 0.5;
  float freq = 2.0;
  p.y += lm_h(q);
  for(int i=0; i<4; i++){    // 高周波を削ってなめらかな面に(液体クローム向き)
    q *= freq;
    q.xz *= mat2(4.0/5.0, -3.0/5.0, 3.0/5.0, 4.0/5.0);
    amplitude *= 0.6;
    scale *= freq;
    p.y += lm_h(q) * amplitude / scale;
  }
  return abs(p.y) * 2.0;
}

// 液体クローム環境: なめらかなシルバーのグラデ(黒を避ける) + 反射バンド + 太陽
vec3 lm_env(vec3 r){
  float v = 0.5 + 0.5*r.y;
  vec3 grd = vec3(0.34, 0.36, 0.42);                             // 暗端も「銀」(黒くしない)
  vec3 sky = vec3(0.95, 0.97, 1.05);
  vec3 sil = mix(grd, sky, smoothstep(-0.1, 1.0, v));            // なめらかシルバー
  float band = smoothstep(0.5, 0.68, fract(r.y*3.0 + r.x*0.6));  // 鏡面の筋
  sil += band * 0.22;
  vec3 sun = normalize(vec3(0.5, 0.8, 0.3));                     // 太陽のホットスポット
  sil += pow(max(dot(r, sun), 0.0), 45.0) * vec3(1.1);
  return sil;
}

vec3 lm_cosgrad(vec3 col, float param){
  if(abs(uCosGrad) < 0.0001) return col;
  float cgInv = uCosGrad < 0.0 ? 0.5 : 0.0;
  vec3 cosCol = cosGradColor(param + cgInv);
  float lum = dot(col, vec3(0.299,0.587,0.114));
  cosCol *= 0.35 + 0.95*lum;
  return mix(col, clamp(cosCol,0.0,1.0), abs(uCosGrad));
}

vec3 lm_shade(vec3 p, vec3 rd){
  const float eps = 0.028;   // やや大きめ=法線をなめらかに(鏡面クローム寄り)
  vec3 normal = normalize(vec3(
    lm_SDF(p+vec3(eps,0,0)) - lm_SDF(p-vec3(eps,0,0)),
    lm_SDF(p+vec3(0,eps,0)) - lm_SDF(p-vec3(0,eps,0)),
    lm_SDF(p+vec3(0,0,eps)) - lm_SDF(p-vec3(0,0,eps))));

  vec3 lightDir = normalize(vec3(1.0,1.0,1.0));
  float diff = max(dot(normal, lightDir), 0.1);
  float ambient = 0.2;

  // 雪が溶けた氷山: 氷河の緑 → 氷のブルー → 雪の白(青緑で連結)
  vec3 color1 = vec3(0.28, 0.56, 0.42);   // 氷河の緑(やや青緑)
  vec3 color2 = vec3(0.62, 0.86, 1.00);   // 氷のブルー
  vec3 color3 = vec3(0.92, 0.96, 1.00);   // 雪の白

  float blendFactor1 = smoothstep(0.20, 0.30, abs(normal.y-0.5));
  float blendFactor2 = smoothstep(0.05, 0.15, abs(normal.y-0.5));
  float posBlendFactor  = smoothstep(-1.0, 1.0, p.y);
  float posBlendFactor2 = smoothstep(-1.0, 1.0, -p.y-0.7);

  vec3 mix1 = mix(color1, color2, blendFactor2);
  vec3 mix2 = mix(mix1, color3, blendFactor1);
  color1 = mix(color1, mix2, posBlendFactor);
  color1 = mix(color1, vec3(0.40, 0.68, 0.74), posBlendFactor2);  // 融雪の青緑(緑と氷を繋ぐ)

  vec3 base = color1 * (diff + ambient);

  // ほぼ全面を液体クローム化(鏡面反射主体)。色はわずかに残す程度。
  float lum = dot(base, vec3(0.299,0.587,0.114));
  vec3 rr = reflect(rd, normal);
  float fres = pow(1.0 - max(dot(normal, -rd), 0.0), 3.0);
  vec3 chrome = lm_env(rr) * (1.0 + 0.7*fres) + fres*0.45;
  float chromeMix = smoothstep(0.30, 0.06, lum);   // 暗部のみクローム → 緑/桃/灰の色面は復活
  vec3 col = mix(base, chrome, chromeMix);

  return lm_cosgrad(col, lum);
}

vec3 bg_liqmount(vec2 fc){
  vec2 I  = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = (I*2.0 - resolution) / min(resolution.x, resolution.y);
  if(resolution.x < resolution.y) uv.xy = uv.yx;

  float tt = time/4.0;
  vec3 ro = normalize(vec3(0, 2.0+sin(tt)*0.5, -3.5)) * 10.0;
  vec3 rd = normalize(vec3(uv - vec2(0, 0.5), 1));

  mat3 rotY = mat3(cos(tt/2.0),0.0,sin(tt/2.0), 0.0,1.0,0.0, -sin(tt/2.0),0.0,cos(tt/2.0));
  ro = rotY * ro;
  rd = rotY * rd;

  float t = 0.0;
  vec3 p;
  bool hit = false;
  for(int i=0; i<100; i++){
    p = ro + rd*t;
    float d = lm_SDF(p)/4.0;
    if(d < 0.0001){ hit = true; break; }
    if(t > 20.0) break;
    t += d;
  }

  vec3 col;
  bgAlpha = (uSlotIsA > 0.5) ? 1.0 : 0.0;   // 背景: A=不透明 / それ以外=透過
  if(hit && t < 20.0){
    bgAlpha = 1.0;                          // 山(被写体)は不透明
    col = lm_shade(p, rd);
  } else {
    // 背景: 蜃気楼風(淡いパステルのグラデ + 地平付近の揺らぎ)
    float g = clamp(uv.y*0.5 + 0.5, 0.0, 1.0);
    col = mix(vec3(0.96, 0.90, 0.84), vec3(0.72, 0.84, 0.97), smoothstep(0.0, 1.0, g)); // 地平=淡暖→上=淡青
    float shimmer = sin(uv.x*9.0 + sin(uv.y*42.0 + time*2.0)*1.6) * 0.5 + 0.5;          // 逃げ水の揺らぎ
    col += (shimmer - 0.5) * 0.06 * (1.0 - g) * vec3(0.4, 0.6, 0.85);                   // 地平近くで揺らぐ
    if(uSlotIsA <= 0.5){ bgAlpha = 0.0; }
  }

  return col;
}
