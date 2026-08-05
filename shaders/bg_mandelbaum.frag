// Shadertoy NXf3WB "m@ndelbaum" (desisn.com, CC BY-NC 4.0)
// Source : https://www.shadertoy.com/view/NXf3WB
// Mandelbrot ベースの 3D ライティング。音声反応(bass/mids/highs)は除去し 0 固定。
#define MB_MAX_ITER 48

vec4 mb_getMaterial(float id, float tm){
  float t = fract(id*0.6180339 + tm*0.05);
  vec4 c1 = vec4(0.85,0.05,0.10,0.9);
  vec4 c2 = vec4(0.05,0.20,0.70,0.8);
  vec4 c3 = vec4(1.00,0.75,0.05,1.0);
  vec4 c4 = vec4(0.05,0.05,0.08,0.6);
  vec4 c5 = vec4(0.95,0.95,0.92,0.3);
  float p = t*5.0;
  float idx = floor(p);
  float f = smoothstep(0.0,1.0,fract(p));
  if(idx==0.0) return mix(c1,c2,f);
  if(idx==1.0) return mix(c2,c3,f);
  if(idx==2.0) return mix(c3,c4,f);
  if(idx==3.0) return mix(c4,c5,f);
  return mix(c5,c1,f);
}

vec2 mb_mapScene(vec2 p, vec2 targetC, float zoom, float tm){
  vec2 c = targetC + p*zoom;
  vec2 z = vec2(0.0);
  float minDist = 1e10, matID = 0.0, shapeHeight = 0.0, smoothIter = 0.0;
  bool escaped = false;
  for(int i=0;i<MB_MAX_ITER;i++){
    z = mat2(z, -z.y, z.x) * z + c;
    float r = dot(z,z);
    if(r > 256.0){ smoothIter = float(i) - log2(log2(r)) + 4.0; escaped = true; break; }
    if(length(z) > 0.01 && length(z) < 4.0){
      float fi = float(i);
      vec2 localZ = z - vec2(sin(fi*7.3), cos(fi*11.1));
      float ang = fi*2.3;
      localZ *= mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
      float d = 1e10, h = 0.0, m = 0.0;
      float type = fract(sin(fi*37.7)*437.5);
      if(type < 0.6){
        float c1 = localZ.y - 0.18*sin(localZ.x*3.5 + fi*2.1);
        float c2 = localZ.x - 0.18*sin(localZ.y*3.5 + fi*1.3);
        float curve = min(abs(c1), abs(c2));
        float taper = 0.030 * smoothstep(0.30, 0.05, length(localZ));
        d = curve - taper; h = 1.0; m = fi*0.3;
      } else if(type < 0.8){
        float c1 = localZ.y*0.9 + localZ.x*0.3 - 0.16*sin(localZ.x*4.2 + fi*1.9);
        float c2 = localZ.x*0.9 - localZ.y*0.3 - 0.16*sin(localZ.y*4.2 - fi*1.1);
        float curve = min(abs(c1), abs(c2));
        float taper = 0.028 * smoothstep(0.28, 0.05, length(localZ));
        d = curve - taper; h = 0.9; m = fi*0.2;
      } else if(type < 0.92){
        localZ.y = -localZ.y;
        d = max(abs(localZ.x)*0.866 - localZ.y*0.5, localZ.y) - 0.15; h = 0.4; m = fi*0.5;
      } else {
        float c1 = localZ.y - 0.18*sin(localZ.x*3.0 + fi*1.7);
        float curve = abs(c1);
        float taper = 0.030 * smoothstep(0.30, 0.05, length(localZ));
        d = curve - taper; h = 0.8; m = fi*0.4;
      }
      if(d < minDist){ minDist = d; shapeHeight = h; matID = m; }
    }
  }
  float bevel = clamp(0.015*(zoom*30.0), 0.002, 0.05);
  float physicalHeight = shapeHeight * smoothstep(bevel, 0.0, minDist);
  // 発散しなかった点(ミニ・マンデルブロ内部)はトラップを無視して単色で塗り、穴=レンコンを消す
  if(!escaped) return vec2(float(MB_MAX_ITER)*0.015, 0.0);
  float bgHeight = smoothIter * 0.015;
  if(physicalHeight < 0.01){ physicalHeight = bgHeight; matID = 0.0; }
  return vec2(physicalHeight, matID);
}

vec3 mb_calcNormal(vec2 p, vec2 targetC, float zoom, float tm, float hC){
  vec2 e = vec2(0.002*zoom, 0.0);
  float hX = mb_mapScene(p+e.xy, targetC, zoom, tm).x;
  float hY = mb_mapScene(p+e.yx, targetC, zoom, tm).x;
  return normalize(vec3(hC-hX, hC-hY, e.x*20.0));
}

vec2 mb_target(float idx){
  if(idx < 1.0) return vec2(-0.74364388,  0.13182590);
  if(idx < 2.0) return vec2(-0.745428,    0.113009);
  if(idx < 3.0) return vec2(-0.16070135,  1.0375665);
  if(idx < 4.0) return vec2( 0.00164372, -0.82246763);
  if(idx < 5.0) return vec2(-0.235125,    0.827215);
  return vec2(-1.25066, 0.02012);
}

vec3 bg_mandelbaum(vec2 fc){
  float T = getBeat();
  vec2 uv = (fc - 0.5*resolution.xy)/resolution.y;

  vec2 target;
  float zoom, angle;
  if(isFree()){
    // free: 4拍周期でターゲットを切替えつつ滑らかに潜る
    float period = 4.0;
    float cyc = floor(T / period);
    float sel = floor(fract(sin(cyc*91.345)*4731.7) * 6.0);
    target = mb_target(sel);
    float tz = mod(T, period);
    zoom = 1.5 / exp(tz*1.4);
    angle = T*0.1;
  } else {
    // beat: 拍ごとにターゲット/ズーム/角度をジャンプ
    float blk = floor(T);
    float sel = floor(hash21(vec2(blk, 13.1)) * 6.0);
    target = mb_target(sel);
    float rz = hash21(vec2(blk, 27.7));
    float frac = fract(T);
    zoom = (1.2 / exp(rz * 4.5)) / exp(frac * 1.4);
    angle = (hash21(vec2(blk, 41.3)) - 0.5) * 2.0 * 3.14159265 + frac * 0.3;
  }
  target += bgCamPx/resolution.y * 0.05;
  zoom /= bgZoom;
  mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 p = uv * rot;

  vec2 sceneData = mb_mapScene(p, target, zoom, T);
  float height = sceneData.x;
  float matID = sceneData.y;

  vec3 normal = mb_calcNormal(p, target, zoom, T, height);
  vec4 mtl = mb_getMaterial(matID, T);
  vec3 albedo = mtl.rgb;
  float gloss = mtl.a;

  vec3 lightDir1 = normalize(vec3(0.8,0.8,1.0));
  vec3 lightCol1 = vec3(1.0,0.9,0.7)*1.2;
  vec3 lightDir2 = normalize(vec3(-0.8,-0.6,0.5));
  vec3 lightCol2 = vec3(0.2,0.4,0.8)*0.6;
  vec3 viewDir = vec3(0.0,0.0,1.0);

  float dif1 = max(dot(normal,lightDir1),0.0);
  float dif2 = max(dot(normal,lightDir2),0.0);
  vec3 half1 = normalize(lightDir1+viewDir);
  float spec1 = pow(max(dot(normal,half1),0.0), 64.0*gloss)*gloss*2.0;
  vec3 half2 = normalize(lightDir2+viewDir);
  float spec2 = pow(max(dot(normal,half2),0.0), 32.0*gloss)*gloss*0.5;
  float fresnel = pow(1.0-max(dot(normal,viewDir),0.0), 4.0);
  vec3 rimLight = vec3(1.0,0.9,0.8)*fresnel*gloss*0.8;
  float ao = clamp(height*2.5, 0.1, 1.0);
  vec3 ambient = albedo*0.15;

  vec3 finalCol = ambient*ao;
  finalCol += albedo*(dif1*lightCol1 + dif2*lightCol2)*ao;
  finalCol += spec1*lightCol1 + spec2*lightCol2;
  finalCol += rimLight*ao;

  finalCol += finalCol*finalCol*0.3;

  finalCol.r += dif1*0.05*albedo.r;
  finalCol.b -= dif1*0.05*albedo.b;

  finalCol = (finalCol*(2.51*finalCol+0.03))/(finalCol*(2.43*finalCol+0.59)+0.14);

  float grain = fract(sin(dot(fc, vec2(12.9898,78.233)))*43758.5453);
  finalCol -= grain*0.03;

  vec2 vUv = fc/resolution.xy;
  finalCol *= pow(16.0*vUv.x*vUv.y*(1.0-vUv.x)*(1.0-vUv.y), 0.15);

  return clamp(finalCol, 0.0, 1.0);
}
