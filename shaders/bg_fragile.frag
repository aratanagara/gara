// =====================================================
// bg_fragile  (H57)
//   Source : Shadertoy "Fragile" / "Glass Field" by Kali  https://www.shadertoy.com/view/XlsGWl
//   改変: 無限タイルのトンネル飛行 → 中心オブジェクトをカメラが周回。
//         形状を「直交2トーラスを smin した絡む曲線(クライン壺風)」に置換し、
//         ねじれ・太さのうねり・流体ノイズで刻一刻と変形。ガラス屈折/反射は踏襲。
//         iTime,iResolution → time,resolution / bgZoom・bgCamPx 対応 / cosGrad / Slot B 透過。
//         ヘルパは fr_ で名前空間化。
// =====================================================

mat3 fr_rotmat(vec3 v, float angle){
  float c = cos(angle), s = sin(angle);
  return mat3(
    c + (1.0-c)*v.x*v.x,        (1.0-c)*v.x*v.y - s*v.z,   (1.0-c)*v.x*v.z + s*v.y,
    (1.0-c)*v.x*v.y + s*v.z,    c + (1.0-c)*v.y*v.y,       (1.0-c)*v.y*v.z - s*v.x,
    (1.0-c)*v.x*v.z - s*v.y,    (1.0-c)*v.y*v.z + s*v.x,   c + (1.0-c)*v.z*v.z);
}

// 距離場: 1本の波打つループ(最低限のパス)。半径・高さが大きく動き、局所的に大きく伸縮する。
//   入り組みを避けつつダイナミックに。単一トーラスなので軽い。
float fr_de(vec3 p){
  p = fr_rotmat(normalize(vec3(0.4, 1.0, 0.2)), time*0.3) * p;    // ゆるい全体回転
  float tw = 0.8*sin(time*0.5);                                   // ねじれ
  float c = cos(p.y*tw), s = sin(p.y*tw);
  p.xz = mat2(c, -s, s, c) * p.xz;
  float a = atan(p.z, p.x);                                       // ループ上の角度
  float radC  = 1.7 + 0.8*sin(a + time*1.7) + 0.45*sin(a*3.0 - time*1.1); // 多ローブの whip
  float yC    = 1.0*sin(a*2.0 + time*1.3) + 0.45*sin(a*3.0 + time*0.8);   // 豊かな波打ち(3Dパス)
  float bulge = pow(max(0.0, sin(a + time*1.2)), 5.0) * max(0.0, 1.2 + 2.0*sin(time*0.9)); // 頻繁に大きく伸びる
  vec2 q = vec2(length(p.xz) - radC, p.y - yC);
  return length(q) - (0.32 + bulge);                             // チューブを太め(ガラスの厚み)
}

vec3 fr_normal(vec3 p){
  vec2 e = vec2(0.0, 0.01);
  return normalize(vec3(
    fr_de(p+e.yxx) - fr_de(p-e.yxx),
    fr_de(p+e.xyx) - fr_de(p-e.xyx),
    fr_de(p+e.xxy) - fr_de(p-e.xxy)));
}

vec3 bg_fragile(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 coord = (I*2.0 - resolution) / resolution.y;

  // カメラ: 原点(中心オブジェクト)を周回
  float ct = time*0.3;
  float camDist = 4.0;
  vec3 from = vec3(cos(ct)*camDist, sin(ct*0.6)*1.6, sin(ct)*camDist);
  vec3 cw = normalize(-from);
  vec3 cu = normalize(cross(vec3(0.0, 1.0, 0.0), cw));
  vec3 cv = cross(cw, cu);
  float fov = 0.9;
  vec3 raydir = normalize(coord.x*fov*cu + coord.y*fov*cv + cw);

  const vec3 lightcol1 = vec3(1.0, 0.95, 0.85);
  const vec3 lightcol2 = vec3(0.85, 0.95, 1.0);
  vec3 light1 = normalize(vec3(cos(time*0.5), 0.6, sin(time*0.5)));
  vec3 light2 = normalize(vec3(cos(time*0.5 + 2.0), 0.4, -sin(time*0.5)));

  float jit = fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453);  // バンディング対策のディザ
  float totdist = jit*0.12, glassfade = 1.0, ref = 0.0, vol = 0.0, maxdist = 11.0;
  vec3 spec = vec3(0.0);
  for(int r = 0; r < 56; r++){                                    // 軽量化: 60→46 ステップ
    vec3 p = from + totdist*raydir;
    float d = fr_de(p);
    float distfade = exp(-1.0*pow(totdist/maxdist, 2.0));
    float intens = min(distfade, glassfade);
    vec3 n = (abs(d) < 0.35) ? fr_normal(p) : vec3(0.0, 0.0, 1.0);  // 表面付近のみ法線
    if(d > 0.0 && ref > 0.5){
      ref = 0.0;
      if(dot(raydir, n) < -0.5) raydir = normalize(refract(raydir, n, 1.0/0.88));
      vec3 refl = reflect(raydir, n);
      spec += lightcol1*pow(max(dot(refl, light1), 0.0), 40.0)*intens*0.75;
      spec += lightcol2*pow(max(dot(refl, light2), 0.0), 40.0)*intens*0.75;
    }
    if(d < 0.0 && ref < 0.05){
      ref = 1.0;
      if(dot(raydir, n) < -0.05) raydir = normalize(refract(raydir, n, 0.88));
      vec3 refl = reflect(raydir, n);
      glassfade *= 0.6;
      spec += lightcol1*pow(max(dot(refl, light1), 0.0), 40.0)*intens;
      spec += lightcol2*pow(max(dot(refl, light2), 0.0), 40.0)*intens;
    }
    totdist += max(0.008, abs(d)*0.5);                            // 細かい刻みでジャギー低減
    vol += intens * smoothstep(0.30, 0.0, abs(d));                // 表面付近のみグロー → 背景は暗い
    if(totdist > maxdist) break;
  }
  vol = pow(vol, 1.3) * 0.009;
  vec3 col = vec3(vol)*vec3(0.82, 0.90, 1.05) + spec*0.6;
  col += vec3(0.92, 0.96, 1.0) * (1.0 - glassfade) * 0.22;       // ガラス通過量=白い厚み

  if(abs(uCosGrad) > 0.0001){
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, cosGradColor(lum) * (0.2 + 1.4*lum), abs(uCosGrad));
  }
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  bgAlpha = clamp(lum*2.5, 0.0, 1.0);                             // 背景は透過(両スロット)
  return col;
}
