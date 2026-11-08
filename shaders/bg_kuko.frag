// =====================================================
// bg_kuko  (H46)
//   Source : Shadertoy "KuKo #279" https://www.shadertoy.com/view/33KcRV
//            二重らせん + 球のヘリックスのレイマーチ(緑〜ティールの照明)。
//   改変: iChannel0 のテクスチャ(トライプラナーのバンプ用)を手続き value noise に置換。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは kk_ で名前空間化。未使用の sdBox/smax/palette/TAU は削除。
// =====================================================

float kk_hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float kk_noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0 - 2.0*f);
  return mix(mix(kk_hash(i+vec2(0,0)), kk_hash(i+vec2(1,0)), u.x),
             mix(kk_hash(i+vec2(0,1)), kk_hash(i+vec2(1,1)), u.x), u.y);
}
// 元 iChannel0 相当の手続きテクスチャ(グレースケール fbm)
vec3 kk_tex2(vec2 uv){
  float n = 0.5*kk_noise(uv*4.0) + 0.3*kk_noise(uv*8.0) + 0.2*kk_noise(uv*16.0);
  return vec3(n);
}
vec3 kk_tex3D(vec3 p, vec3 n){
  n = max(n*n, 0.001);
  n /= (n.x + n.y + n.z);
  return kk_tex2(p.yz)*n.x + kk_tex2(p.zx)*n.y + kk_tex2(p.xy)*n.z;
}

// @param uBeads  1..8 = 3.16
// @param uThick  25..200 = 100.0
// @param uMotion 0..400 = 100.0
// @param uBump   0..400 = 100.0
// @param uGlow   0..300 = 100.0
// @param uSize 40..250 = 100.0
// @param uAngle -180..180 = 0.0
// @param uSteps 50..80 = 80.0
uniform float uBeads; // 球のらせん 1 周あたりの球の数
uniform float uThick; // らせんの管の太さ (%)
uniform float uMotion; // らせんのうねりの振幅 (%)
uniform float uBump; // 表面の凹凸の強さ (%)
uniform float uGlow; // ハイライト・縁の光 (%)
uniform float uSize; // 球ひとつの大きさ (%)
uniform float uAngle; // 向き (度。固定角でずらす)
uniform float uSteps; // レイマーチのステップ数 (下げると軽く、遠景や細部が欠ける)
// @param uTubeRadius 80..120 = 100.0
// @param uBeadOrbit  70..140  = 100.0
// @param uPitch 40..220 = 100.0
// @param uStrands 100..300 = 100.0
// @param uTubeAspect 60..200 = 100.0
// @param uBeadGap    50..200  = 100.0
// @param uBlendTube 25..220 = 100.0
// @param uCellSize 80..130 = 100.0
// @param uCrossOffset 0..300  = 100.0
// @param uShine      25..400  = 100.0
// @param uCamShiftX -80..80 = 0.0
// @param uCamShiftY -30..30 = 0.0
// @param uFocal 50..200 = 100
// @param uCamRoll -180..180 = 0
// @param uCamYaw -30..30 = 0
// @param uCamPitch -30..30 = 0
// @param uFogDensity 0..400 = 100
// @param uVignetteReach 40..300 = 100
// @param uLightHeight 20..300 = 100
// @param uLightSide -100..100 = 0
// @param uLightLead -100..100 = 0
// @param uShadowFill 0..80 = 30
// @param uSurfaceWarmth 0..100 = 0
// @param uRimPower 40..300 = 100
// @param uBumpScale 40..160 = 100
// @param uFilmGrain 0..100 = 0
// @param uFogColor color = #000000
// @param uBeadColor color = #ffffff
// @param uTubeColor color = #ffffff
// @param uSpecColor color = #ffffff
// @param uRimColor color = #ffffff
uniform float uTubeRadius; // らせん管の輪の半径 (%)
uniform float uBeadOrbit; // 球のらせんの輪の半径 (%)
uniform float uPitch; // らせんのねじれの粗さ (%)。0 でまっすぐな輪
uniform float uStrands; // 輪あたりのらせんの本数 (100 = 1 本、200 = 2 本 …)
uniform float uTubeAspect; // 管の断面の縦横比 (%)
uniform float uBeadGap; // 球どうしの間隔 (%)
uniform float uBlendTube; // 管どうしがつながる滑らかさ (%)
uniform float uCellSize; // らせんを並べる升目の大きさ (%)
uniform float uCrossOffset; // 2 本目の管の位置ずれ (%)
uniform float uShine; // 鏡面ハイライトの鋭さ (%)
uniform float uCamShiftX; // カメラの横ずれ (%)
uniform float uCamShiftY; // カメラの縦ずれ (%)
uniform float uFocal; // 画角 (%)。大きいと望遠で遠近感が弱まり、小さいと広角
uniform float uCamRoll; // カメラの傾き (度)
uniform float uCamYaw; // カメラの左右の振り (度)
uniform float uCamPitch; // カメラの上下の振り (度)
uniform float uFogDensity; // 霧の濃さ (%)。大きいと遠景が早く霧に沈む
uniform float uVignetteReach; // 周辺減光の届く範囲 (%)
uniform float uLightHeight; // 光源の高さ (%)
uniform float uLightSide; // 光源の横位置のずれ (%)
uniform float uLightLead; // 光源の前後位置のずれ (%)。+ で進行方向の手前へ
uniform float uShadowFill; // 影側に残る明るさ (%)。小さいと陰影が深い
uniform float uSurfaceWarmth; // 表面の緑に混ぜる赤み (%)
uniform float uRimPower; // 縁の光の広がり (%)。小さいと縁が広く光る
uniform float uBumpScale; // 表面の凹凸の細かさ (%)
uniform float uFilmGrain; // ざらつき (%)
uniform vec3 uFogColor; // 霧の色
uniform vec3 uBeadColor; // 球の色味 (掛け算)
uniform vec3 uTubeColor; // 管の色味 (掛け算)
uniform vec3 uSpecColor; // 鏡面ハイライトの色味 (掛け算)
uniform vec3 uRimColor; // 縁の光の色味 (掛け算)

float kk_sdHelix(vec3 p){
  float len = length(p.xy);
  float a = sin(atan(p.y, p.x) * float(int(uStrands / 100.0 + 0.5)) - p.z*0.5*(uPitch / 100.0) + radians(uAngle));
  return length(vec2(len - 2.5 * (uTubeRadius / 100.0), a * (uTubeAspect / 100.0))) - 0.4 * (uThick / 100.0);
}

float kk_smin(float d1, float d2, float k){
  k *= 4.0;
  float h = max(k - abs(d1 - d2), 0.0);
  return min(d1, d2) - h*h*0.25/k;
}

float kk_sdSphere(vec3 p, float r){ return length(p) - r; }

float kk_sdHelixOfSpheres(vec3 p){
  p += vec3(-2.5, -2.5, 1.6);
  float len   = length(p.xy);
  float angle = atan(p.y, p.x) + radians(uAngle);
  float n = uBeads;            // spheres per rotation
  float helixRadius = 2.5 * (uBeadOrbit / 100.0);
  vec3 spherePos = vec3(
    len - helixRadius,        // radial offset to helix
    0.154,                    // perpendicular to helix path
    (fract(n * angle) - 0.5) * (uBeadGap / 100.0)    // periodic spacing along helix
  );
  return kk_sdSphere(spherePos, 0.15 * (uSize / 100.0));
}

float kk_map(vec3 p){
  float cs = 7.0 * (uCellSize / 100.0);
  vec3 p0 = vec3(mod(p.x, cs) - cs*0.5,
                 mod(p.y, cs) - cs*0.5,
                 p.z);
  p0.y += sin(p.x*2. + time*2.0) * 0.1 * (uMotion / 100.0);
  p0.z += sin(p.x*2. + time*2.5) * 0.1 * (uMotion / 100.0);
  float d = kk_sdHelix(p0);

  vec3 p1 = p + vec3(1, 1, 0) * (uCrossOffset / 100.0);
  p1 = vec3(mod(p1.x, cs) - cs*0.5,
            mod(p1.y, cs) - cs*0.5,
            p.z);
  p1.z += sin(p1.y*3. + time*1.5) * 0.1 * (uMotion / 100.0);
  p1.z += sin(p1.x*1. + time*2.5) * 0.2 * (uMotion / 100.0);
  float d1 = kk_sdHelix(p1);

  float d3 = kk_sdHelixOfSpheres(p);
  float d4 = kk_sdHelixOfSpheres(p + vec3(-1.6, -1, 0));

  return kk_smin(d3, kk_smin(d4, kk_smin(d, d1, 0.2 * (uBlendTube / 100.0)), 0.09), 0.09);
}

vec3 kk_calcNorm(vec3 p){
  float e = 0.001;
  return normalize(vec3(
    kk_map(p + vec3(e,0,0)) - kk_map(p - vec3(e,0,0)),
    kk_map(p + vec3(0,e,0)) - kk_map(p - vec3(0,e,0)),
    kk_map(p + vec3(0,0,e)) - kk_map(p - vec3(0,0,e))
  ));
}

float kk_rayMarch(vec3 ro, vec3 rd){
  float dt = 0.0;
  for(int i=0; i<80; i++){
    if(i >= int(uSteps + 0.5)) break;
    vec3 p = ro + rd*dt;
    float d = kk_map(p);
    dt += d;
    if(abs(d) < 0.001 || dt > 20.0) break;
  }
  return dt;
}

vec3 bg_kuko(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = (2.0*I - resolution.xy) / resolution.y;
  vec2 uvScr = uv;
  if(uCamRoll != 0.0){ float ra = radians(uCamRoll); float rc = cos(ra), rs = sin(ra); uv = vec2(rc*uv.x - rs*uv.y, rs*uv.x + rc*uv.y); }
  vec3 col = vec3(0.0);

  vec3 ro = vec3(4.0, 3.0, -time*0.5);
  if(uCamShiftX != 0.0 || uCamShiftY != 0.0) ro.xy += vec2(uCamShiftX, uCamShiftY) * 0.035;
  vec3 rd = normalize(vec3(uv, -1.0 * (uFocal / 100.0)));
  if(uCamYaw != 0.0){ float ya = radians(uCamYaw); float yc = cos(ya), ys = sin(ya); rd = vec3(yc*rd.x + ys*rd.z, rd.y, -ys*rd.x + yc*rd.z); }
  if(uCamPitch != 0.0){ float pa = radians(uCamPitch); float pc = cos(pa), ps = sin(pa); rd = vec3(rd.x, pc*rd.y - ps*rd.z, ps*rd.y + pc*rd.z); }
  float dt = kk_rayMarch(ro, rd);

  if(dt > 0.0){
    vec3 p = ro + rd*dt;
    vec3 norm = kk_calcNorm(p);

    float scale = 2.0 * (uBumpScale / 100.0);
    float texOffset = 0.01;

    vec3 tex  = kk_tex3D(p*scale, norm);
    vec3 texX = kk_tex3D((p + vec3(texOffset, 0, 0))*scale, norm);
    vec3 texY = kk_tex3D((p + vec3(0, texOffset, 0))*scale, norm);
    vec2 texGrad = vec2(texX.r - tex.r, texY.r - tex.r) / texOffset;

    vec3 bump = normalize(norm + vec3(texGrad*0.3*(uBump / 100.0), 0));

    vec3 lightPos = vec3(sin(time)*1.0 + uLightSide * 0.06, 5.0 * (uLightHeight / 100.0), -time*0.5 + 2.0 + uLightLead * 0.06);
    vec3 L = normalize(lightPos - p);

    float diff = max(dot(bump, L), 0.0);
    float fre  = pow(1.0 - abs(dot(bump, rd)), 3.0 * (uRimPower / 100.0));
    vec3  hal  = normalize(L - rd);
    float spec = pow(max(dot(bump, hal), 0.0), 32.0 * (uShine / 100.0));

    vec3 baseCol = (3. + cos(4. + vec3(0,4,4))) / dt * vec3(0, 0.5, 0.2);

    if(uSurfaceWarmth != 0.0){ baseCol.r = baseCol.g * (uSurfaceWarmth / 100.0); }
    if(uBeadColor != vec3(1.0) || uTubeColor != vec3(1.0)){
      float dsp = min(kk_sdHelixOfSpheres(p), kk_sdHelixOfSpheres(p + vec3(-1.6, -1, 0)));
      baseCol *= mix(uTubeColor, uBeadColor, smoothstep(0.06, 0.0, dsp));
    }

    col  = baseCol * (diff*0.7 + uShadowFill / 100.0);          // diffuse + ambient
    col += vec3(0.4, 0.6, 1.0) * spec * 1.5 * (uGlow / 100.0) * uSpecColor;    // specular
    col += vec3(0.2, 0.4, 0.6) * fre  * 1.4 * (uGlow / 100.0) * uRimColor;    // fresnel rim
  }

  col = mix(col, uFogColor, 1.0 - exp(-0.0019 * (uFogDensity / 100.0) * dt*dt*dt));                 // fog
  col = mix(vec3(0), col, smoothstep(3.9, 0.1, length(uvScr*vec2(1.4, 1) * (100.0 / uVignetteReach)))); // vignette
  if(uFilmGrain != 0.0){ col += (fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * (uFilmGrain / 100.0) * 0.2; }
  return col;
}
