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

float fm_sdTriPrism(vec3 p, vec2 h){
  vec3 q = abs(p);
  return max(q.z - h.y, max(q.x*0.866025 + p.y*0.5, -p.y) - h.x*0.5);
}

// 紙飛行機 1 機(翼=三角プリズム + 胴体)
float fm_planeDistance(vec3 position){
  vec3 wingP = position.xzy * vec3(2.0, 1.5, 2.0);
  wingP.x = abs(wingP.x);
  wingP.z -= 0.3 * wingP.x;                       // skew で傾き
  float wingDistance = fm_sdTriPrism(wingP, vec2(1.0, 0.02));

  vec3 bodyP = position.yzx * vec3(4.0, 1.5, 1.0);
  float bodyDistance = max(fm_sdTriPrism(bodyP, vec2(1.0, 0.01)),
                           dot(position, vec3(0.0, 1.0, 0.0)));
  return min(wingDistance, bodyDistance);
}

float fm_d(vec3 position){
  vec3 warped = position + sin(position.x*2.0 + time*2.3) * 0.1;
  return fm_planeDistance(fm_rZ(fm_opRepeat(warped, vec3(2.0)), cos(time*1.2)*0.15));
}

vec3 fm_gradient(vec3 p, float v){
  const vec3 eps = vec3(0.001, 0.0, 0.0);
  return normalize((vec3(fm_d(p + eps.xyy), fm_d(p + eps.yxy), fm_d(p + eps.yyx)) - v) / eps.x);
}

vec4 fm_march(vec3 from, vec3 towards, float prec){
  vec3 lastPos = from;
  float lastDist = 0.0;
  for(int i=0; i<90; i++){
    vec3 sp = lastPos + max(lastDist*0.4, prec)*towards;
    float cDist = fm_d(sp);
    lastPos = sp; lastDist = cDist;
    if(cDist < 0.0) return vec4(sp, cDist);
  }
  return vec4(1.0);
}

vec3 fm_lightSurface(vec3 position, vec3 normal, vec3 toEye){
  vec3 toLight = normalize(vec3(0.3, 0.9, 0.9));
  float ndotL = max(0.0, dot(normal, toLight));
  float ndotH = max(0.0, dot(normal, normalize(toEye + toLight)));
  const float diffuse = 0.8;
  vec3 ambience = mix(vec3(0.2,0.25,0.3), vec3(0.2,0.4,0.6),
                      dot(normal, vec3(0.,1.,0.)) * -0.5 + 0.5);
  const float specular = 0.6;
  return vec3((ndotL*diffuse + pow(ndotH, 2.0)*specular) + ambience);
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
