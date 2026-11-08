// =====================================================
// bg_formation  (H37)
//   Source : Shadertoy "formation" https://www.shadertoy.com/view/3dKSRD
//   紙飛行機の編隊が空間に反復配置されたレイマーチ。空は青グラデ。
//   改変: カメラを中心(z軸上)に置き、飛行機が画面中心からこちらへ飛んでくる構図に。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは fm_ で名前空間化。
// =====================================================

vec3 fm_opRepeat(vec3 p, vec3 spacing){ return mod(p, spacing) - 0.5*spacing; }

vec3 fm_rZ(vec3 p, float a){
  float c = cos(a), s = sin(a);
  return vec3(c*p.x - s*p.y, s*p.x + c*p.y, p.z);
}

float fm_sdTriPrism(vec3 p, vec2 h, float taper){
  vec3 q = abs(p);
  return max(q.z - h.y, max(q.x*0.866025 + p.y*0.5*taper, -p.y) - h.x*0.5);
}

// @param uWingSpan     70..140  = 100.0
// @param uWingLength   70..150  = 100.0
// @param uWingTaper    50..200  = 100.0
// @param uWingDihedral -100..300 = 100.0
// @param uWingThick    25..300  = 100.0
// @param uBodyWidth    40..200  = 100.0
uniform float uWingSpan; // 翼の横幅 (%)
uniform float uWingLength; // 翼の前後の長さ (%)
uniform float uWingTaper; // 翼の先の細り・後退角 (%)
uniform float uWingDihedral; // 翼の上反角 (%)。負で下反角
uniform float uWingThick; // 翼の厚み (%)
uniform float uBodyWidth; // 胴体の幅 (%)

// 紙飛行機 1 機(翼=三角プリズム + 胴体)
float fm_planeDistance(vec3 position){
  vec3 wingP = position.xzy * vec3(2.0 / (uWingSpan / 100.0), 1.5 / (uWingLength / 100.0), 2.0);
  wingP.x = abs(wingP.x);
  wingP.z -= 0.3 * (uWingDihedral / 100.0) * wingP.x;                       // skew で傾き
  float wingDistance = fm_sdTriPrism(wingP, vec2(1.0, 0.02 * (uWingThick / 100.0)), uWingTaper / 100.0);

  vec3 bodyP = position.yzx * vec3(4.0 / (uBodyWidth / 100.0), 1.5, 1.0);
  float bodyDistance = max(fm_sdTriPrism(bodyP, vec2(1.0, 0.01), 1.0),
                           dot(position, vec3(0.0, 1.0, 0.0)));
  return min(wingDistance, bodyDistance);
}

// @param uSpacing 80..200 = 100.0
// @param uWarp    0..400 = 100.0
// @param uMotion  0..300 = 100.0
// @param uGlow    0..200 = 100.0
// @param uSize 40..130 = 100.0
// @param uAngle -180..180 = 0.0
// @param uSteps 35..90 = 90.0
uniform float uSpacing; // 飛行機の配置間隔 (%)
uniform float uWarp; // 空間のうねり (%)
uniform float uMotion; // 機体の傾きの振幅 (%)
uniform float uGlow; // 機体の照り・明るさ (%)
uniform float uSize; // 要素ひとつの大きさ (%)
uniform float uAngle; // 向き (度。固定角でずらす)
uniform float uSteps; // レイマーチのステップ数 (下げると軽く、遠景や細部が欠ける)
// @param uWaveFreq   25..250 = 100.0
// @param uRowGap     50..200 = 100.0
// @param uDepthGap   60..200 = 100.0
// @param uShine      25..400 = 100.0
// @param uLightSide  -300..300 = 100.0
// @param uAmbientTilt -100..200 = 100.0
uniform float uWaveFreq; // 空間のうねりの細かさ (%)
uniform float uRowGap; // 縦方向の配置間隔 (%)
uniform float uDepthGap; // 奥行き方向の配置間隔 (%)
uniform float uShine; // 機体の鏡面の鋭さ (%)
uniform float uLightSide; // 光の横からの振れ (%)。負で反対側から
uniform float uAmbientTilt; // 上面と下面の環境光の差 (%)

float fm_d(vec3 position){
  vec3 warped = position + sin(position.x*2.0*(uWaveFreq / 100.0) + time*2.3) * 0.1 * (uWarp / 100.0);
  float fk = uSize / 100.0;
  return fm_planeDistance(fm_rZ(fm_opRepeat(warped, vec3(2.0 * (uSpacing / 100.0), 2.0 * (uSpacing / 100.0) * (uRowGap / 100.0), 2.0 * (uSpacing / 100.0) * (uDepthGap / 100.0))), cos(time*1.2)*0.15*(uMotion / 100.0) + radians(uAngle)) / fk) * fk;
}

vec3 fm_gradient(vec3 p, float v){
  const vec3 eps = vec3(0.001, 0.0, 0.0);
  return normalize((vec3(fm_d(p + eps.xyy), fm_d(p + eps.yxy), fm_d(p + eps.yyx)) - v) / eps.x);
}

vec4 fm_march(vec3 from, vec3 towards, float prec){
  vec3 lastPos = from;
  float lastDist = 0.0;
  for(int i=0; i<90; i++){
    if(i >= int(uSteps + 0.5)) break;
    vec3 sp = lastPos + max(lastDist*0.4, prec)*towards;
    float cDist = fm_d(sp);
    lastPos = sp; lastDist = cDist;
    if(cDist < 0.0) return vec4(sp, cDist);
  }
  return vec4(1.0);
}

vec3 fm_lightSurface(vec3 position, vec3 normal, vec3 toEye){
  vec3 toLight = normalize(vec3(0.3 * (uLightSide / 100.0), 0.9, 0.9));
  float ndotL = max(0.0, dot(normal, toLight));
  float ndotH = max(0.0, dot(normal, normalize(toEye + toLight)));
  float diffuse = 0.8 * (uGlow / 100.0);
  vec3 ambience = mix(vec3(0.2,0.25,0.3), vec3(0.2,0.4,0.6),
                      dot(normal, vec3(0.,1.,0.)) * -0.5 * (uAmbientTilt / 100.0) + 0.5);
  float specular = 0.6 * (uGlow / 100.0);
  return vec3((ndotL*diffuse + pow(ndotH, 2.0 * (uShine / 100.0))*specular) + ambience);
}

vec3 bg_formation(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = 2.0 * (I / resolution.xy - 0.5);
  uv.x *= resolution.x / resolution.y;

  // 中心(z軸上)から正面を見るカメラ。前進して飛行機が中心からこちらへ来る。
  vec3 cameraLookAt   = vec3(0.0, 0.0, 0.0);
  vec3 cameraPosition = vec3(0.0, 0.0, 6.0);
  vec3 cameraForward = normalize(cameraLookAt - cameraPosition);   // -z 方向
  vec3 cameraRight   = normalize(cross(cameraForward, vec3(0.0, 1.0, 0.0)));
  vec3 cameraUp      = cross(cameraRight, cameraForward);
  // 広角レンズ(焦点距離小=画角広い)。3.0→1.4 で縦画角 約37°→71°。
  vec3 rayDirection  = normalize(uv.x*cameraRight + uv.y*cameraUp + 1.4*cameraForward);

  // 前進(-z)。飛行機が画面中心の消失点からこちらへ飛んでくる。
  cameraPosition += time * vec3(0.0, 0.0, -2.0);

  vec4 marchResult = fm_march(cameraPosition, rayDirection, 0.001);
  vec3 backgroundColor = vec3(0.0);                 // 背景を真っ黒に

  if(marchResult.w > 0.0){
    bgAlpha = 0.0;                                  // 空=透明
    return backgroundColor;
  }
  vec3 position = marchResult.xyz;
  float fogDistance = max(0.0, length(position - cameraPosition) - 4.0);
  vec3 litColor = fm_lightSurface(position, fm_gradient(position, marchResult.w), -rayDirection);
  bgAlpha = exp(-fogDistance*0.1);                  // 機体=不透明 / 遠方フォグは透明へフェード
  return litColor;
}
