// =====================================================
// bg_liqmount  (H51)
//   Source : Shadertoy "Liquid mountains"  https://www.shadertoy.com/view/wXdSRB
//   改変: iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//         山の「黒い(暗い)部分」だけをシルバー/クロム(環境反射)に置換。明るい色部分は維持。
//         背景透過(bgAlpha): 背景は黒 + 透過。Slot A では entrypoint が uBgColor を敷く。
//         cosineGradient(uCosGrad)対応。ヘルパは lm_ で名前空間化。
// =====================================================

// @param uRidgeX    60..160 = 100.0
// @param uRidgeZ    50..200 = 100.0
// @param uRidgeMix  0..160 = 100.0
// @param uPersist   50..130 = 100.0
// @param uOctTurn   -90..90 = 0.0
// @param uHorizon   -40..30 = 0.0
// @param uCamHeight 60..160 = 100.0
// @param uSnowLine  -80..80 = 0.0
// @param uCrest     0..70 = 0.0
uniform float uRidgeX;    // 大きなうねりの X 方向の細かさ (%)
uniform float uRidgeZ;    // 大きなうねりの Z 方向の細かさ (%)
uniform float uRidgeMix;  // Z 方向のうねりの混ざり具合 (%)。0 で X 方向だけの畝
uniform float uPersist;   // 細かい波の残り方 (%)。上げるとギザギザ、下げるとなめらか
uniform float uOctTurn;   // 重ねる波ごとの向きのずれ (度)
uniform float uHorizon;   // 地平線の高さ (%)。カメラの俯角
uniform float uCamHeight; // カメラの高さ (%)
uniform float uSnowLine;  // 雪線の高さ (%)。上げると雪が高い所だけに
uniform float uCrest;     // 稜線の鋭さ (%)。波の山を尖らせた折れ線状の尾根にする

// @param uCenterX -100..100 = 0.0
// @param uCenterY -100..100 = 0.0
// @param uMirrorX -100..100 = 0.0
// @param uRoll -45..45 = 0.0
// @param uCamDist 70..120 = 100.0
// @param uCamSway 0..300 = 100.0
// @param uFov 60..160 = 100.0
// @param uLightAz -180..180 = 0.0
// @param uLightLift -100..100 = 0.0
// @param uAmbient 0..300 = 100.0
// @param uRimLight 0..300 = 100.0
// @param uEnvBands 40..300 = 100.0
// @param uEnvTilt 0..300 = 100.0
// @param uFog 0..100 = 0.0
// @param uGrit 0..100 = 0.0
// @param uNormalEps 30..300 = 100.0
// @param uVignette 0..100 = 0.0
// @param uGrain 0..100 = 0.0
// @param uChromeTint color = #ffffff
// @param uGlacierTint color = #ffffff
// @param uIceTint color = #ffffff
// @param uSnowTint color = #ffffff
uniform float uCenterX; // 山の中心を横へずらす (%)
uniform float uCenterY; // 山の中心を縦へずらす (%)
uniform float uMirrorX; // 左右の鏡像 (%)。正負で写す側が入れ替わり、大きさで軸が動く。0 で無効
uniform float uRoll; // カメラのロール (度)。水平線が傾く
uniform float uCamDist; // カメラの距離 (%)
uniform float uCamSway; // カメラの上下の揺れ幅 (%)
uniform float uFov; // 画角 (%)。上げると広角、下げると望遠
uniform float uLightAz; // 太陽光の方位 (度)
uniform float uLightLift; // 太陽光の高さ (%)。負で低く、正で高く
uniform float uAmbient; // 影の浮き (環境光、%)
uniform float uRimLight; // 縁のフレネル反射の強さ (%)
uniform float uEnvBands; // 鏡面の筋の細かさ (%)
uniform float uEnvTilt; // 鏡面の筋の傾き (%)
uniform float uFog; // 遠くの山を暗く沈める霧の濃さ (%)
uniform float uGrit; // 表面のざらつき (%)。法線を荒らす
uniform float uNormalEps; // 法線を取る幅 (%)。上げるほど鏡面がなめらか
uniform float uVignette; // 周辺減光 (%)
uniform float uGrain; // 粒状ノイズの量 (%)
uniform vec3 uChromeTint; // クローム部分の色味 (掛け算のティント)
uniform vec3 uGlacierTint; // 氷河の緑の色味 (掛け算のティント)
uniform vec3 uIceTint; // 氷の青の色味 (掛け算のティント)
uniform vec3 uSnowTint; // 雪の白の色味 (掛け算のティント)

float lm_h(vec3 p){
  float hh = (sin(p.x*0.9*(uRidgeX / 100.0) + time) + 0.7*(uRidgeMix / 100.0)*cos(p.z*1.1*(uRidgeZ / 100.0) + time)) / 2.0;
  if(uCrest != 0.0) hh = mix(hh, -abs(hh) * 1.2, uCrest / 100.0);
  return hh;
}

// @param uDetail 1..4 = 4.0
// @param uRelief 20..200 = 100.0
// @param uDensity 60..300 = 100.0
// @param uChrome 10..300 = 100.0
// @param uGlow 0..400 = 100.0
// @param uAngle -180..180 = 0.0
// @param uSteps 40..100 = 100.0
uniform float uDetail;   // 波の重ね回数 (下げると面がなめらかで軽い)
uniform float uRelief;   // 山の起伏の高さ (%)
uniform float uDensity;   // 波の細かさ (%)
uniform float uChrome;   // クローム化する暗部の範囲 (%)
uniform float uGlow;   // 鏡面の筋・太陽のハイライトの強さ (%)
uniform float uAngle;   // 向き (度。固定角でずらす)
uniform float uSteps;   // レイマーチの反復回数 (下げると軽いが、遠景や細部が欠ける)

float lm_SDF(vec3 p){
  p /= 1.5;
  vec3 q = p;
  float scale = 0.2;
  float amplitude = 0.5;
  float freq = 2.0 * (uDensity / 100.0);
  p.y += lm_h(q) * (uRelief / 100.0);
  mat2 octR = mat2(4.0/5.0, -3.0/5.0, 3.0/5.0, 4.0/5.0);
  if(uOctTurn != 0.0){ float oa = radians(uOctTurn); octR = octR * mat2(cos(oa), -sin(oa), sin(oa), cos(oa)); }
  for(int i=0; i<4; i++){    // 高周波を削ってなめらかな面に(液体クローム向き)
    if(i >= int(uDetail + 0.5)) break;
    q *= freq;
    q.xz *= octR;
    amplitude *= 0.6 * (uPersist / 100.0);
    scale *= freq;
    p.y += lm_h(q) * amplitude / scale * (uRelief / 100.0);
  }
  return abs(p.y) * 2.0;
}

// 液体クローム環境: なめらかなシルバーのグラデ(黒を避ける) + 反射バンド + 太陽
vec3 lm_env(vec3 r){
  float v = 0.5 + 0.5*r.y;
  vec3 grd = vec3(0.34, 0.36, 0.42);                             // 暗端も「銀」(黒くしない)
  vec3 sky = vec3(0.95, 0.97, 1.05);
  vec3 sil = mix(grd, sky, smoothstep(-0.1, 1.0, v));            // なめらかシルバー
  float bph = r.y*3.0 + r.x*0.6;
  if(uEnvBands != 100.0 || uEnvTilt != 100.0) bph = r.y*3.0*(uEnvBands / 100.0) + r.x*0.6*(uEnvTilt / 100.0);
  float band = smoothstep(0.5, 0.68, fract(bph));  // 鏡面の筋
  sil += band * 0.22 * (uGlow / 100.0);
  vec3 sun = normalize(vec3(0.5, 0.8, 0.3));                     // 太陽のホットスポット
  sil += pow(max(dot(r, sun), 0.0), 45.0) * vec3(1.1) * (uGlow / 100.0);
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
  float eps = 0.028;
  if(uNormalEps != 100.0) eps = 0.028 * (uNormalEps / 100.0);   // やや大きめ=法線をなめらかに(鏡面クローム寄り)
  vec3 normal = normalize(vec3(
    lm_SDF(p+vec3(eps,0,0)) - lm_SDF(p-vec3(eps,0,0)),
    lm_SDF(p+vec3(0,eps,0)) - lm_SDF(p-vec3(0,eps,0)),
    lm_SDF(p+vec3(0,0,eps)) - lm_SDF(p-vec3(0,0,eps))));

  if(uGrit != 0.0){ vec3 gh = fract(sin(vec3(dot(p, vec3(12.9898, 78.233, 37.719)), dot(p, vec3(39.346, 11.135, 83.155)), dot(p, vec3(73.156, 52.235, 9.151)))) * 43758.5453); normal = normalize(normal + (gh - 0.5) * (uGrit / 100.0) * 0.6); }
  float diff;
  if(uLightAz != 0.0 || uLightLift != 0.0){
    vec3 lightDir = normalize(vec3(1.0,1.0,1.0));
    if(uLightAz != 0.0){ float la = radians(uLightAz); lightDir = vec3(cos(la) * lightDir.x + sin(la) * lightDir.z, lightDir.y, -sin(la) * lightDir.x + cos(la) * lightDir.z); }
    if(uLightLift != 0.0) lightDir = normalize(vec3(lightDir.x, lightDir.y + uLightLift / 100.0 * 1.2, lightDir.z));
    diff = max(dot(normal, lightDir), 0.1);
  } else {
    vec3 lightDir = normalize(vec3(1.0,1.0,1.0));
    diff = max(dot(normal, lightDir), 0.1);
  }
  float ambient = 0.2;
  if(uAmbient != 100.0) ambient = 0.2 * (uAmbient / 100.0);

  // 雪が溶けた氷山: 氷河の緑 → 氷のブルー → 雪の白(青緑で連結)
  vec3 color1 = vec3(0.28, 0.56, 0.42);
  if(any(notEqual(uGlacierTint, vec3(1.0)))) color1 *= uGlacierTint;   // 氷河の緑(やや青緑)
  vec3 color2 = vec3(0.62, 0.86, 1.00);
  if(any(notEqual(uIceTint, vec3(1.0)))) color2 *= uIceTint;   // 氷のブルー
  vec3 color3 = vec3(0.92, 0.96, 1.00);
  if(any(notEqual(uSnowTint, vec3(1.0)))) color3 *= uSnowTint;   // 雪の白

  float blendFactor1 = smoothstep(0.20, 0.30, abs(normal.y-0.5));
  float blendFactor2 = smoothstep(0.05, 0.15, abs(normal.y-0.5));
  float posBlendFactor  = smoothstep(-1.0, 1.0, p.y - uSnowLine / 100.0);
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
  if(uRimLight != 100.0) fres *= uRimLight / 100.0;
  vec3 chrome = lm_env(rr) * (1.0 + 0.7*fres) + fres*0.45*(uGlow / 100.0);
  if(any(notEqual(uChromeTint, vec3(1.0)))) chrome *= uChromeTint;
  float chromeMix = smoothstep(0.30 * (uChrome / 100.0), 0.06 * (uChrome / 100.0), lum);   // 暗部のみクローム → 緑/桃/灰の色面は復活
  vec3 col = mix(base, chrome, chromeMix);

  return lm_cosgrad(col, lum);
}

vec3 lm_custom(vec2 fc){
  vec2 I  = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = (I*2.0 - resolution) / min(resolution.x, resolution.y);
  if(resolution.x < resolution.y) uv.xy = uv.yx;

  float tt = time/4.0;
  vec3 ro = normalize(vec3(0, 2.0*(uCamHeight / 100.0)+sin(tt)*0.5, -3.5)) * 10.0;
  if(uCamSway != 100.0) ro = normalize(vec3(0, 2.0*(uCamHeight / 100.0)+sin(tt)*0.5*(uCamSway / 100.0), -3.5)) * 10.0;
  if(uCamDist != 100.0) ro *= uCamDist / 100.0;
  if(uMirrorX != 0.0){ float ax = uMirrorX / 100.0 * 0.5; uv.x = ax + sign(uMirrorX) * abs(uv.x - ax); }
  if(uRoll != 0.0){ float rl = radians(uRoll); uv = mat2(cos(rl), -sin(rl), sin(rl), cos(rl)) * uv; }
  if(uCenterX != 0.0 || uCenterY != 0.0) uv -= vec2(uCenterX, uCenterY) / 100.0 * 0.5;
  vec3 rd = normalize(vec3(uv - vec2(0, 0.5 + uHorizon / 100.0), 1));
  if(uFov != 100.0) rd = normalize(vec3(uv - vec2(0, 0.5 + uHorizon / 100.0), 100.0 / uFov));

  float tr = tt/2.0 + radians(uAngle);
  mat3 rotY = mat3(cos(tr),0.0,sin(tr), 0.0,1.0,0.0, -sin(tr),0.0,cos(tr));
  ro = rotY * ro;
  rd = rotY * rd;

  float t = 0.0;
  vec3 p;
  bool hit = false;
  for(int i=0; i<100; i++){
    if(i >= int(uSteps + 0.5)) break;
    p = ro + rd*t;
    float d = lm_SDF(p)/4.0;
    if(d < 0.0001){ hit = true; break; }
    if(t > 20.0) break;
    t += d;
  }

  vec3 col;
  bgAlpha = 0.0;   // 背景は透過
  if(hit && t < 20.0){
    bgAlpha = 1.0;                          // 山(被写体)は不透明
    col = lm_shade(p, rd);
    if(uFog != 0.0) col *= exp(-t * uFog / 100.0 * 0.12);
    if(uGrain != 0.0) col += (fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * uGrain / 100.0 * 0.6;
  } else {
    col = vec3(0.0);   // 背景は黒 (entrypoint が uBgColor で塗る)
  }

  if(uVignette != 0.0){ vec2 vq = (fc * 2.0 - resolution) / resolution.y; col *= 1.0 - clamp(dot(vq, vq) * 0.35, 0.0, 1.0) * uVignette / 100.0; }
  return col;
}

vec3 bg_liqmount(vec2 fc){
  if(uCamSway != 100.0 || uCamDist != 100.0 || uFov != 100.0 || uMirrorX != 0.0 || uRoll != 0.0 || uCenterX != 0.0 || uCenterY != 0.0 || uFog != 0.0 || uGrain != 0.0 || uVignette != 0.0) return lm_custom(fc);
  vec2 I  = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = (I*2.0 - resolution) / min(resolution.x, resolution.y);
  if(resolution.x < resolution.y) uv.xy = uv.yx;

  float tt = time/4.0;
  vec3 ro = normalize(vec3(0, 2.0*(uCamHeight / 100.0)+sin(tt)*0.5, -3.5)) * 10.0;
  vec3 rd = normalize(vec3(uv - vec2(0, 0.5 + uHorizon / 100.0), 1));

  float tr = tt/2.0 + radians(uAngle);
  mat3 rotY = mat3(cos(tr),0.0,sin(tr), 0.0,1.0,0.0, -sin(tr),0.0,cos(tr));
  ro = rotY * ro;
  rd = rotY * rd;

  float t = 0.0;
  vec3 p;
  bool hit = false;
  for(int i=0; i<100; i++){
    if(i >= int(uSteps + 0.5)) break;
    p = ro + rd*t;
    float d = lm_SDF(p)/4.0;
    if(d < 0.0001){ hit = true; break; }
    if(t > 20.0) break;
    t += d;
  }

  vec3 col;
  bgAlpha = 0.0;   // 背景は透過
  if(hit && t < 20.0){
    bgAlpha = 1.0;                          // 山(被写体)は不透明
    col = lm_shade(p, rd);
  } else {
    col = vec3(0.0);   // 背景は黒 (entrypoint が uBgColor で塗る)
  }

  return col;
}
