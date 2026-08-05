'use strict';
/* Progressive Pollock Post FX
   Pass 1 accumulates a monochrome stroke map on Canvas2D.
   Pass 2 paints over the current composited frame, so video/shaders keep moving.
   The Post slider is bipolar: 0=off, +1=gloss, -1=matt. */
const PollockFX = {
  gl:null, initialized:false,
  prog:null, blurProg:null, quad:null, tex:null,
  srcCanvas:null, srcCtx:null, paintCanvas:null, paintCtx:null,
  liveCanvas:null, liveCtx:null, deadCanvas:null, deadCtx:null, noiseCanvas:null, noiseCtx:null, fullCanvas:null, fullCtx:null,
  srcData:null, sw:0, sh:0, fw:0, fh:0, _texW:0, _texH:0,
  _noiseData:null, _noiseW:0, _noiseH:0,
  seeded:false, frame:0, progress:0, _style:null, _rng:1, _renderTick:0, _dirty:false,
  _active:false, _fade:null, _tail:null, _lastAmount:0, _burstLeft:0,
  _paintAcc:0, _lastUpdateTime:0, _lastValue:null, _drawCtx:null, _liveAge:0,
  MAXW: 900,
  PRESET:{ minBrushSize:2, maxBrushSize:20, distortion:1.75, opacity:1.0, density:17500, strokeLen:225, curveAmount:1.75 },

  VS:`#version 300 es
layout(location=0) in vec2 a_xy;
out vec2 v_uv;
void main(){ v_uv = a_xy*0.5+0.5; gl_Position=vec4(a_xy,0.0,1.0); }`,

  FS:`#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform sampler2D uMap;
uniform vec2 uTexel;
uniform vec2 uSrcTexel;
uniform float uAmount;
uniform float uStyle;
uniform float uFlat;   // 1 = フラット(単色+エンボスのみ)
in vec2 v_uv;
out vec4 frag;
float sat(float x){ return clamp(x, 0.0, 1.0); }
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0 - 2.0*f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  return 0.52*vnoise(p) + 0.30*vnoise(p*2.03 + 5.71) + 0.18*vnoise(p*4.11 + 13.17);
}
vec2 mirrorUV(vec2 p){ return abs(fract(p * 0.5) * 2.0 - 1.0); }
float mapAt(vec2 p){ return texture(uMap, mirrorUV(p)).b; }
vec3 srcBlur5(vec2 p, vec2 s){
  p = clamp(p, vec2(0.001), vec2(0.999));
  vec3 c = texture(uSrc, p).rgb * 0.42;
  c += texture(uSrc, clamp(p + vec2( s.x, 0.0), vec2(0.001), vec2(0.999))).rgb * 0.145;
  c += texture(uSrc, clamp(p + vec2(-s.x, 0.0), vec2(0.001), vec2(0.999))).rgb * 0.145;
  c += texture(uSrc, clamp(p + vec2(0.0,  s.y), vec2(0.001), vec2(0.999))).rgb * 0.145;
  c += texture(uSrc, clamp(p + vec2(0.0, -s.y), vec2(0.001), vec2(0.999))).rgb * 0.145;
  return c;
}
vec3 srcAverage9(vec2 p, float radiusPx){
  vec2 s = uSrcTexel * radiusPx;
  p = clamp(p, vec2(0.001), vec2(0.999));
  vec3 c = texture(uSrc, p).rgb * 0.36;
  c += texture(uSrc, clamp(p + vec2( s.x, 0.0), vec2(0.001), vec2(0.999))).rgb * 0.16;
  c += texture(uSrc, clamp(p + vec2(-s.x, 0.0), vec2(0.001), vec2(0.999))).rgb * 0.16;
  c += texture(uSrc, clamp(p + vec2(0.0,  s.y), vec2(0.001), vec2(0.999))).rgb * 0.16;
  c += texture(uSrc, clamp(p + vec2(0.0, -s.y), vec2(0.001), vec2(0.999))).rgb * 0.16;
  return c;
}
// 広域平均(17タップ / 2リング): srcAverage9 の 5タップだと狭くタイル構造が透けるため、
// 内リング8方向(半径 r)+ 外リング8方向(半径 1.9r・角度オフセット)で広く均し、面をベタに潰す。
vec3 srcFlatAvg(vec2 p, float radiusPx){
  vec2 s  = uSrcTexel * radiusPx;
  vec2 s2 = s * 1.9;
  p = clamp(p, vec2(0.001), vec2(0.999));
  vec3 c = texture(uSrc, p).rgb * 0.18;
  const float wIn  = 0.06;    // 内リング 8方向
  const float wOut = 0.0425;  // 外リング 8方向
  // 内リング(0/90/45度・半径 r)
  c += texture(uSrc, clamp(p + s*vec2( 1.0,  0.0),   vec2(0.001), vec2(0.999))).rgb * wIn;
  c += texture(uSrc, clamp(p + s*vec2(-1.0,  0.0),   vec2(0.001), vec2(0.999))).rgb * wIn;
  c += texture(uSrc, clamp(p + s*vec2( 0.0,  1.0),   vec2(0.001), vec2(0.999))).rgb * wIn;
  c += texture(uSrc, clamp(p + s*vec2( 0.0, -1.0),   vec2(0.001), vec2(0.999))).rgb * wIn;
  c += texture(uSrc, clamp(p + s*vec2( 0.707,  0.707), vec2(0.001), vec2(0.999))).rgb * wIn;
  c += texture(uSrc, clamp(p + s*vec2(-0.707,  0.707), vec2(0.001), vec2(0.999))).rgb * wIn;
  c += texture(uSrc, clamp(p + s*vec2( 0.707, -0.707), vec2(0.001), vec2(0.999))).rgb * wIn;
  c += texture(uSrc, clamp(p + s*vec2(-0.707, -0.707), vec2(0.001), vec2(0.999))).rgb * wIn;
  // 外リング(22.5度オフセット・半径 1.9r)
  c += texture(uSrc, clamp(p + s2*vec2( 0.924,  0.383), vec2(0.001), vec2(0.999))).rgb * wOut;
  c += texture(uSrc, clamp(p + s2*vec2(-0.924,  0.383), vec2(0.001), vec2(0.999))).rgb * wOut;
  c += texture(uSrc, clamp(p + s2*vec2( 0.924, -0.383), vec2(0.001), vec2(0.999))).rgb * wOut;
  c += texture(uSrc, clamp(p + s2*vec2(-0.924, -0.383), vec2(0.001), vec2(0.999))).rgb * wOut;
  c += texture(uSrc, clamp(p + s2*vec2( 0.383,  0.924), vec2(0.001), vec2(0.999))).rgb * wOut;
  c += texture(uSrc, clamp(p + s2*vec2(-0.383,  0.924), vec2(0.001), vec2(0.999))).rgb * wOut;
  c += texture(uSrc, clamp(p + s2*vec2( 0.383, -0.924), vec2(0.001), vec2(0.999))).rgb * wOut;
  c += texture(uSrc, clamp(p + s2*vec2(-0.383, -0.924), vec2(0.001), vec2(0.999))).rgb * wOut;
  return c;   // 重み合計 = 0.18 + 8*0.06 + 8*0.0425 = 1.0
}
void main(){
  vec2 uv = v_uv;
  vec2 muv0 = vec2(uv.x, 1.0 - uv.y);
  vec2 muv = muv0;
  vec4 coord = texture(uMap, muv);
  vec4 mapL  = texture(uMap, clamp(muv - vec2(uTexel.x, 0.0), vec2(0.0), vec2(1.0)));
  vec4 mapR  = texture(uMap, clamp(muv + vec2(uTexel.x, 0.0), vec2(0.0), vec2(1.0)));
  vec4 mapD  = texture(uMap, clamp(muv + vec2(0.0, uTexel.y), vec2(0.0), vec2(1.0)));
  vec4 mapU  = texture(uMap, clamp(muv - vec2(0.0, uTexel.y), vec2(0.0), vec2(1.0)));
  vec4 mapLL = texture(uMap, clamp(muv - vec2(uTexel.x*2.0, 0.0), vec2(0.0), vec2(1.0)));
  vec4 mapRR = texture(uMap, clamp(muv + vec2(uTexel.x*2.0, 0.0), vec2(0.0), vec2(1.0)));
  vec4 mapDD = texture(uMap, clamp(muv + vec2(0.0, uTexel.y*2.0), vec2(0.0), vec2(1.0)));
  vec4 mapUU = texture(uMap, clamp(muv - vec2(0.0, uTexel.y*2.0), vec2(0.0), vec2(1.0)));
  vec4 mapLU = texture(uMap, clamp(muv + vec2(-uTexel.x, -uTexel.y), vec2(0.0), vec2(1.0)));
  vec4 mapRU = texture(uMap, clamp(muv + vec2( uTexel.x, -uTexel.y), vec2(0.0), vec2(1.0)));
  vec4 mapLD = texture(uMap, clamp(muv + vec2(-uTexel.x,  uTexel.y), vec2(0.0), vec2(1.0)));
  vec4 mapRD = texture(uMap, clamp(muv + vec2( uTexel.x,  uTexel.y), vec2(0.0), vec2(1.0)));
  float m  = coord.b;
  float ml = mapL.b;
  float mr = mapR.b;
  float md = mapD.b;
  float mu = mapU.b;
  float mll = mapLL.b;
  float mrr = mapRR.b;
  float mdd = mapDD.b;
  float muu = mapUU.b;
  float mlu = mapLU.b;
  float mru = mapRU.b;
  float mld = mapLD.b;
  float mrd = mapRD.b;
  float ma = mapAt(muv * 1.37 + vec2(0.17, 0.29));
  float mb = mapAt(muv * 1.37 + vec2(0.53, 0.11));
  float mc = mapAt(muv * 2.13 + vec2(0.07, 0.61));
  float mf = mapAt(muv * 2.13 + vec2(0.41, 0.23));
  float mSoft = (m * 4.0 + ml + mr + md + mu + 0.5 * (mlu + mru + mld + mrd)) / 10.0;
  float mBlur = (mSoft * 4.0 + (mll + mrr + mdd + muu) * 0.95) / 7.8;
  vec4 coordSoft = (coord * 4.0 + mapL + mapR + mapD + mapU + 0.5 * (mapLU + mapRU + mapLD + mapRD)) / 10.0;
  vec4 coordBlur = (coordSoft * 4.0 + (mapLL + mapRR + mapDD + mapUU) * 0.95) / 7.8;
  vec2 gSobel = vec2((mru + 2.0*mr + mrd) - (mlu + 2.0*ml + mld),
                     (mlu + 2.0*mu + mru) - (mld + 2.0*md + mrd)) * 0.25;
  vec2 gFar = vec2(mrr - mll, muu - mdd) * 0.32;
  vec2 g = mix(gSobel, gFar, 0.58);
  vec2 gWide = mix(g, gFar, 0.55);
  vec2 tangent = normalize(vec2(-g.y, g.x) + vec2(0.0001));
  float ink = smoothstep(0.035, 0.82, m);
  float edge = smoothstep(0.055, 0.92, length(g));
  float amtRaw = sat(abs(uAmount));
  float amt = smoothstep(0.0, 0.35, amtRaw);
  float gloss = step(0.0, uStyle);
  float matt = 1.0 - gloss;
  float edgeFeather = smoothstep(0.020, 0.30, mBlur) * (1.0 - smoothstep(0.48, 0.92, mBlur)) * amt;
  float softCoverage = smoothstep(0.018, 0.18, mBlur) * amt;
  float innerCoverage = smoothstep(0.16, 0.60, mBlur) * amt;
  float reliefCoverage = softCoverage * (0.42 + innerCoverage * 0.58);
  float reliefRim = smoothstep(0.035, 0.22, length(gWide)) * (1.0 - smoothstep(0.72, 0.98, mBlur)) * amt;
  float shA = texture(uMap, clamp(muv - vec2(0.0, uTexel.y * 1.0), vec2(0.0), vec2(1.0))).b;
  float shB = texture(uMap, clamp(muv - vec2(0.0, uTexel.y * 2.0), vec2(0.0), vec2(1.0))).b;
  float matteDropShadow = smoothstep(0.045, 0.32, shA * 0.70 + shB * 0.26)
                        * (1.0 - smoothstep(0.020, 0.14, mBlur)) * amt * matt;

  float shimmer = sin(dot(uv, vec2(113.7, 67.3))) * 0.5 + 0.5;
  float pigmentNoise = hash12(floor(muv * vec2(420.0, 270.0)) + m * 31.0);
  float dryGrain = mix(0.5, hash12(floor(muv * vec2(620.0, 410.0)) + 17.0), 0.22);
  float medium = fbm(muv * vec2(42.0, 31.0) + vec2(0.13, 0.71));
  float mediumFine = fbm(muv * vec2(92.0, 67.0) + medium * 2.0);
  float mediumTooth = mix(medium, mediumFine, 0.24);
  vec2 field = vec2(ma - mb, mc - mf);
  float fieldInk = sat(ma + mb + mc + mf);
  vec2 staticSwirl = vec2(
    sin((ma - mc) * 11.0 + uv.y * 19.0 + m * 7.0),
    cos((mb - mf) * 10.0 + uv.x * 17.0 - m * 6.0)
  ) * fieldInk;
  vec2 flow = g * 2.05 + gWide * 0.95 + normalize(field + tangent * 0.55 + vec2(0.0001)) * fieldInk * 0.82;

  float paint = smoothstep(0.014, 0.46, mBlur) * amt;
  float body = smoothstep(0.018, 0.34, mBlur) * amt;
  float core = smoothstep(0.20, 0.72, mBlur) * amt;
  vec2 rakeDir = normalize(tangent + field * 0.18 + vec2(0.0001));
  float rakeCoord = dot(muv * vec2(1.0, 1.35), rakeDir);
  float rake = 1.0 - abs(fract(rakeCoord * (34.0 + 46.0 * amt) + medium * 0.72 + m * 0.19) * 2.0 - 1.0);
  rake = pow(rake, 3.0);
  float impastoBroad = fbm(muv * vec2(18.0, 13.5) + field * 2.15 + vec2(0.21, 0.37));
  float impastoFine = fbm(muv * vec2(58.0, 43.0) + vec2(medium, rake) * 2.35);
  float impastoBody = body * (0.38 + innerCoverage * 0.62);
  float impastoRelief = ((impastoBroad - 0.5) * 0.72 + (impastoFine - 0.5) * 0.28 + (rake - 0.36) * 0.42) * impastoBody;
  float matteInterior = smoothstep(0.38, 0.78, mBlur) * (1.0 - smoothstep(0.035, 0.18, length(gWide)));
  float matteDetail = mix(1.0, 0.42, matteInterior);
  float matteTooth = ((mediumFine - 0.5) * 0.70 + (dryGrain - 0.5) * 0.36 + (impastoBroad - 0.5) * 0.24) * (0.50 + matteDetail * 0.50);
  vec2 baseUv = clamp(uv, vec2(0.001), vec2(0.999));
  vec2 pickupUv = coordBlur.rg / max(coordBlur.b, 0.001);
  pickupUv = clamp(mix(baseUv, pickupUv, smoothstep(0.002, 0.018, coordBlur.b)), vec2(0.001), vec2(0.999));

  vec2 colorBlurStep = uTexel * (0.45 + 0.90 * amt);
  vec3 src0Raw = texture(uSrc, baseUv).rgb;
  vec3 srcPickupRaw = srcAverage9(pickupUv, 5.0);
  float srcSoft = mix(0.0, 0.08 + 0.08 * amt, gloss);
  vec3 src0 = mix(src0Raw, srcBlur5(baseUv, colorBlurStep * 0.72), srcSoft);
  vec3 srcPickup = srcPickupRaw;
  vec3 col = src0;
  vec3 pickupColor = clamp(mix(vec3(lum(srcPickup)), srcPickup, 1.24) * (1.05 + 0.04 * amt), 0.0, 1.0);
  // Matt はチョーキー(粉っぽい)方向: 彩度を落として白くリフト。Gloss との差を明確に。
  vec3 matteColor = clamp(mix(vec3(lum(pickupColor)), pickupColor, 0.78) * 0.94 + vec3(0.045), 0.0, 1.0);
  vec2 mattePx = floor(gl_FragCoord.xy);
  float matteDitherA = hash12(mattePx + vec2(0.0, 0.0) + m * 11.0);
  float matteDitherB = hash12(mattePx + vec2(31.7, 11.2));
  float matteDitherC = hash12(mattePx + vec2(7.3, 53.9));
  if(gloss < 0.5){
    float hardMask = smoothstep(0.025, 0.22, mBlur);   // Gloss(solidA)と同等の効き・立ち上がり
    float mattBody = hardMask * amt;
    float impastoMass = clamp(0.52 + impastoRelief * 2.15 * matteDetail + (impastoBroad - 0.5) * 0.36 * matteDetail + rake * 0.34 * matteDetail, 0.0, 1.0);
    float coverD = hardMask;
    float ridgeD = hardMask * smoothstep(0.50, 0.86, impastoMass) * mattBody * 0.006 * matteDetail;
    float scrapeD = hardMask * (1.0 - rake) * mattBody * 0.022 * matteDetail;
    vec3 pigment = matteColor;
    float band = mix(0.58, impastoMass * 0.72 + rake * 0.28, matteDetail);
    vec3 bodyColor = pigment * (0.86 + band * 0.12);
    vec3 ridgeColor = pigment * (0.72 + band * 0.035);
    vec3 scrapeColor = pigment * (0.82 + impastoBroad * 0.050);
    vec3 matteOut = bodyColor;
    matteOut = mix(matteOut, ridgeColor, ridgeD);
    matteOut = mix(matteOut, scrapeColor, scrapeD);
    col = mix(src0Raw, matteOut, coverD);
  } else {
    // Gloss は濡れたエナメル方向: 彩度を強く上げ、やや深い色に。Matt/Flat との差を明確に。
    vec3 glossColor = clamp(mix(vec3(lum(pickupColor)), pickupColor, 1.48) * 1.00, 0.0, 1.0);
    float solidA = smoothstep(0.025, 0.22, mBlur);
    col = mix(col, glossColor, solidA);
    float sheen = pow(innerCoverage, 1.24) * body * solidA * (0.060 + 0.042 * shimmer);
    col += vec3(sheen);
  }

  if(gloss > 0.5){
    col = mix(col, col * 1.015, body * 0.10);
  } else {
    col = col;
  }
  vec2 glossMicro = vec2(mediumTooth - 0.5, dryGrain - 0.5) * body * 0.20;
  vec2 matteMicro = vec2(impastoBroad - 0.5 + (ma - mb) * 0.22, impastoFine - 0.5 + (mc - mf) * 0.22) * impastoBody * 1.20 * matteDetail
                   + vec2(mediumFine - 0.5, dryGrain - 0.5) * impastoBody * (0.30 + matteDetail * 0.32);
  vec2 reliefMicro = mix(matteMicro, glossMicro, gloss);
  vec3 reliefN = normalize(vec3(-gWide * mix(8.0 + 12.0 * amt, 4.5 + 8.0 * amt, gloss) + reliefMicro, 1.0));
  vec3 reliefL = normalize(vec3(-0.48, 0.62, 0.78));
  float reliefLit = dot(reliefN, reliefL);
  float reliefBase = (reliefLit - 0.62) * reliefCoverage;
  float reliefEdge = reliefRim * (0.34 + innerCoverage * 0.66);
  if(gloss > 0.5){
    vec3 roundN = normalize(vec3(-g * (7.5 + 15.0 * amt) + glossMicro * 0.42, 1.0));
    vec3 roundL = normalize(vec3(-0.36, 0.48, 0.80));
    float roundLit = dot(roundN, roundL);
    float roundBody = smoothstep(0.055, 0.56, mBlur) * amt;
    float roundCore = smoothstep(0.24, 0.82, mBlur) * amt;
    float roundBevel = smoothstep(0.018, 0.32, mBlur) * (1.0 - smoothstep(0.66, 0.96, mBlur)) * amt;
    float wetSpec = pow(max(reliefLit, 0.0), 18.0) * reliefEdge * (0.14 + 0.22 * amt);
    float roundedSpec = pow(max(roundLit, 0.0), 30.0) * roundBody * (0.18 + 0.30 * amt);
    float softGlint = pow(max(dot(roundN, normalize(vec3(0.28, -0.24, 0.93))), 0.0), 52.0) * roundCore * (0.14 + 0.24 * amt);
    float bevelGlow = roundBevel * (0.040 + 0.080 * amt) * (0.75 + 0.25 * shimmer);
    float bevelShade = max(0.52 - roundLit, 0.0) * roundBevel * (0.075 + 0.050 * amt);
    col += vec3(wetSpec);
    col += vec3(roundedSpec + softGlint + bevelGlow);
    col += pickupColor * max(roundLit - 0.55, 0.0) * roundBody * 0.110;
    col += vec3(max(reliefBase, 0.0)) * 0.085;
    col -= pickupColor * (max(-reliefBase, 0.0) * 0.060 + bevelShade);
  } else {
    float toothMask = reliefCoverage * (0.44 + matteDetail * 0.56);
    float impastoSkin = smoothstep(0.04, 0.66, abs(impastoRelief) * 3.15 + rake * 0.72 + impastoBroad * 0.46) * toothMask;
    float impastoRidge = smoothstep(0.20, 0.78, impastoRelief * 2.80 + rake * 0.78 + impastoBroad * 0.42) * toothMask * 0.22;
    float impastoValley = smoothstep(0.18, 0.72, -impastoRelief * 2.55 + (1.0 - rake) * 0.34 + impastoFine * 0.28) * toothMask;
    float impastoSkinBand = mix(0.58, impastoBroad * 0.48 + rake * 0.52, matteDetail);
    vec3 skinColor = matteColor * (0.760 + impastoSkinBand * 0.210 + rake * 0.025);
    vec3 ridgeColor = matteColor * (0.680 + impastoSkinBand * 0.080 + rake * 0.012);
    vec3 valleyColor = matteColor * (0.610 + impastoSkinBand * 0.150);
    float grain = (matteDitherA + matteDitherB + matteDitherC) / 3.0;
    float skinD = clamp(impastoSkin * (0.22 + grain * 0.08), 0.0, 0.34);
    float impastoD = clamp(impastoRidge * (0.07 + grain * 0.025), 0.0, 0.055);
    float valleyD = clamp(impastoValley * (0.12 + grain * 0.06), 0.0, 0.22);
    float bodyD = clamp(reliefCoverage * (0.08 + grain * 0.04), 0.0, 0.16);
    col = mix(col, skinColor, skinD);
    col = mix(col, valleyColor, valleyD);
    col = mix(col, ridgeColor, impastoD);
    col = mix(col, matteColor * (0.740 + impastoSkinBand * 0.230 + rake * 0.018), bodyD);
    float toothShade = clamp(matteTooth * 0.20 + (medium - 0.5) * 0.05, -0.08, 0.09) * toothMask;
    float impastoShade = clamp((reliefLit - 0.54) * 0.62, -0.26, 0.26) * toothMask;
    float powderField = fbm(muv * vec2(126.0, 97.0) + vec2(medium, impastoFine) * 1.7 + vec2(3.1, 5.3));
    float powderDust = smoothstep(0.20, 0.74, powderField) * toothMask * (0.190 + 0.200 * amt);   // ザラつき増強
    vec3 powderColor = mix(matteColor, vec3(lum(matteColor)), 0.14) * (0.82 + powderField * 0.18);
    float noiseMask = smoothstep(0.10, 0.62, mBlur) * (0.62 + matteInterior * 0.38) * amt;
    // 高周波の粒状ノイズを追加 (ピクセル単位のグレイン)。ざらざら感を強める。
    float fineGrain = (hash12(mattePx * 1.7 + 3.3) - 0.5) + (hash12(mattePx * 0.53 + 17.1) - 0.5) * 0.6;
    float pixelNoise = (matteDitherA - 0.5) * 0.190 + (matteDitherB - 0.5) * 0.095
                     + (matteDitherC - 0.5) * 0.070 + fineGrain * 0.095;
    float surfaceNoise = (pixelNoise + (powderField - 0.5) * 0.040
                       + (mediumFine - 0.5) * 0.028 + (dryGrain - 0.5) * 0.020) * noiseMask;
    float neutralDust = (0.018 + (grain - 0.5) * 0.050) * noiseMask * (0.46 + toothMask * 0.54);
    // エンボスは硬い稜線でなく「角丸のグラデ状の落ち影」に。フチから内側へなだらかに暗→標準。
    // mBlur(フチからの距離の代理)で丸い立ち上がりを作り、影のみで陰影を付ける(反射・明部なし)。
    float roundProfile = smoothstep(0.020, 0.44, mBlur);          // 0=フチ / 1=内側
    float roundShadow = (1.0 - roundProfile) * reliefCoverage;    // フチ側ほど丸く暗い落ち影
    col -= matteColor * roundShadow * (0.20 + 0.14 * amt);
    col -= matteColor * max(-impastoShade, 0.0) * 0.30;           // 硬いエンボスは弱めに残す
    col -= matteColor * max(-reliefBase, 0.0) * 0.24;
    col -= matteColor * max(-toothShade, 0.0) * 0.30;
    col = mix(col, powderColor, powderDust);
    col += vec3(neutralDust);
    col += vec3((grain - 0.5) * toothMask * 0.100 + (powderField - 0.5) * toothMask * 0.032);
    col += vec3(surfaceNoise);
    col = mix(col, matteColor, noiseMask * (0.040 + toothMask * 0.030));
    col = mix(col, matteColor * 0.94, clamp(reliefRim * 0.30, 0.0, 0.30));   // フチのテカリ抑制(角丸影に置換したため弱め)
    vec3 shadowTint = vec3(0.035, 0.040, 0.052) + matteColor * 0.08;
    col = mix(col, col * 0.78 + shadowTint * 0.22, clamp(matteDropShadow * 0.42, 0.0, 0.36));
  }
  if(uFlat > 0.5){
    // フラット: 線が覆うソース画素の平均を粗くポスタライズしたベタ単色(マーカーのイメージ)。
    // フチ系の処理はせず、インクの厚みを表すエンボス(相対レリーフの陰影)だけを乗せる。反射なし。
    float cover = smoothstep(0.012, 0.090, mBlur);                 // 広めのAA帯で滑らかな輪郭
    // 生の座標を使用(近傍max方式は境界でディザ=モザイク模様を生むため廃止)。
    // 被覆が薄い所(coord.b 小)は割り算が不安定なので真下(baseUv)へフォールバック。
    vec2 flatPickup = clamp(coord.rg / max(coord.b, 0.001), vec2(0.001), vec2(0.999));
    flatPickup = mix(baseUv, flatPickup, smoothstep(0.06, 0.22, coord.b));
    // 大きめ半径の平均 → 座標の微小ジッタ/低解像度に強く、線ごとに安定した単色(モザイクを出さない)。
    vec3 flatCol = clamp(srcFlatAvg(flatPickup, 40.0), 0.0, 1.0);
    flatCol = floor(flatCol * 5.0 + 0.5) / 5.0;                    // 軽いポスタライズ(5階調)でベタ感・バンド抑制
    // インクの厚みエンボス: 塗りの「内側」フチ帯で基調色そのものを暗くする(外側AA帯=元ソース混ざりを避けグレー化しない)。
    float emb = smoothstep(0.03, 0.10, mBlur) * (1.0 - smoothstep(0.10, 0.42, mBlur));
    vec3 inked = flatCol * (1.0 - emb * 0.30);                     // 基調色を暗く=厚みのエンボス(明部・反射なし)
    col = mix(src0Raw, clamp(inked, 0.0, 1.0), cover);
  }
  frag = vec4(clamp(col, 0.0, 1.0), 1.0);
}`,

  BLUR_FS:`#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform sampler2D uMap;
uniform vec2 uTexel;
uniform vec2 uMapTexel;
uniform float uAmount;
uniform float uStyle;
uniform float uFlat;
in vec2 v_uv;
out vec4 frag;
float sat(float x){ return clamp(x, 0.0, 1.0); }
void main(){
  float amt = smoothstep(0.0, 0.35, clamp(abs(uAmount), 0.0, 1.0));
  float gloss = step(0.0, uStyle) * (1.0 - clamp(uFlat, 0.0, 1.0));   // フラット時はエッジぼかし(グロス用)を無効化
  vec2 muv = vec2(v_uv.x, 1.0 - v_uv.y);
  float m = texture(uMap, muv).b;
  float ml = texture(uMap, clamp(muv - vec2(uMapTexel.x, 0.0), vec2(0.0), vec2(1.0))).b;
  float mr = texture(uMap, clamp(muv + vec2(uMapTexel.x, 0.0), vec2(0.0), vec2(1.0))).b;
  float md = texture(uMap, clamp(muv + vec2(0.0, uMapTexel.y), vec2(0.0), vec2(1.0))).b;
  float mu = texture(uMap, clamp(muv - vec2(0.0, uMapTexel.y), vec2(0.0), vec2(1.0))).b;
  float mBlur = (m * 4.0 + ml + mr + md + mu) / 8.0;
  float edgeGrad = length(vec2(mr - ml, mu - md));
  float paint = smoothstep(0.018, 0.40, mBlur) * amt;
  float edgeMask = smoothstep(0.020, 0.22, mBlur) * (1.0 - smoothstep(0.42, 0.84, mBlur));
  edgeMask = max(edgeMask, smoothstep(0.030, 0.28, edgeGrad) * paint);
  float blurMix = clamp(edgeMask * (0.100 + 0.160 * amt) + paint * (0.004 + 0.014 * amt), 0.0, 0.27) * gloss;
  vec2 s = uTexel * (0.54 + 0.82 * amt) * mix(0.0, 1.0, gloss);
  vec3 raw = texture(uSrc, v_uv).rgb;
  vec3 c = raw * 0.36;
  c += texture(uSrc, clamp(v_uv + vec2( s.x, 0.0), vec2(0.001), vec2(0.999))).rgb * 0.16;
  c += texture(uSrc, clamp(v_uv + vec2(-s.x, 0.0), vec2(0.001), vec2(0.999))).rgb * 0.16;
  c += texture(uSrc, clamp(v_uv + vec2(0.0,  s.y), vec2(0.001), vec2(0.999))).rgb * 0.16;
  c += texture(uSrc, clamp(v_uv + vec2(0.0, -s.y), vec2(0.001), vec2(0.999))).rgb * 0.16;
  vec3 col = mix(raw, c, blurMix);
  frag = vec4(clamp(col, 0.0, 1.0), 1.0);
}`,

  init(gl){
    if(this.initialized) return true;
    this.gl = gl;
    const vs = this._compile(gl.VERTEX_SHADER, this.VS);
    const fs = this._compile(gl.FRAGMENT_SHADER, this.FS);
    this.prog = gl.createProgram();
    gl.attachShader(this.prog, vs);
    gl.attachShader(this.prog, fs);
    gl.bindAttribLocation(this.prog, 0, 'a_xy');
    gl.linkProgram(this.prog);
    if(!__glReady(gl, this.prog, true)){
      console.warn('PollockFX link:', gl.getProgramInfoLog(this.prog));
      this.initialized = true;
      return false;
    }
    const bfs = this._compile(gl.FRAGMENT_SHADER, this.BLUR_FS);
    this.blurProg = gl.createProgram();
    gl.attachShader(this.blurProg, vs);
    gl.attachShader(this.blurProg, bfs);
    gl.bindAttribLocation(this.blurProg, 0, 'a_xy');
    gl.linkProgram(this.blurProg);
    if(!__glReady(gl, this.blurProg, true)){
      console.warn('PollockFX blur link:', gl.getProgramInfoLog(this.blurProg));
      this.blurProg = null;
    }
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.srcCanvas = document.createElement('canvas');
    this.paintCanvas = document.createElement('canvas');
    this.liveCanvas = document.createElement('canvas');
    this.deadCanvas = document.createElement('canvas');
    this.noiseCanvas = document.createElement('canvas');
    this.fullCanvas = document.createElement('canvas');
    this.srcCtx = this.srcCanvas.getContext('2d', { willReadFrequently:true });
    this.paintCtx = this.paintCanvas.getContext('2d', { alpha:false });
    this.liveCtx = this.liveCanvas.getContext('2d', { alpha:true });
    this.deadCtx = this.deadCanvas.getContext('2d', { alpha:true });
    this.noiseCtx = this.noiseCanvas.getContext('2d', { alpha:true });
    this.fullCtx = this.fullCanvas.getContext('2d', { willReadFrequently:true });
    this.initialized = true;
    return true;
  },

  _compile(type, src){
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if(!__glReady(gl, sh, false)) console.warn('PollockFX shader:', gl.getShaderInfoLog(sh));
    return sh;
  },

  _rand(){
    this._rng = (1664525 * this._rng + 1013904223) >>> 0;
    return this._rng / 4294967296;
  },

  _resize(w, h){
    const sw = Math.max(2, Math.min(this.MAXW, w|0));
    const sh = Math.max(2, Math.round(sw * h / Math.max(1, w)));
    if(sw === this.sw && sh === this.sh && w === this.fw && h === this.fh) return;
    this.sw = sw; this.sh = sh; this.fw = w; this.fh = h;
    this.srcCanvas.width = this.paintCanvas.width = this.liveCanvas.width = this.deadCanvas.width = this.noiseCanvas.width = sw;
    this.srcCanvas.height = this.paintCanvas.height = this.liveCanvas.height = this.deadCanvas.height = this.noiseCanvas.height = sh;
    this.fullCanvas.width = w;
    this.fullCanvas.height = h;
    this._texW = 0;
    this._texH = 0;
    this._noiseData = null;
    this._noiseW = 0;
    this._noiseH = 0;
    this.seeded = false;
  },

  captureFromFBO(gl, fb){
    if(!this.initialized) this.init(gl);
    if(!fb || !fb.fbo) return false;
    this.reset(gl, fb.w, fb.h, this._style || 'gloss');
    return true;
  },

  reset(gl, w, h, style='gloss'){
    if(!this.initialized) this.init(gl || this.gl);
    this._resize(w, h);
    this.srcData = null;
    this._rng = ((performance.now() * 1000) | 0) ^ ((this.sw << 16) + this.sh);
    this.progress = 0;
    this.frame = 0;
    this._renderTick = 0;
    this._style = null;
    this._dirty = true;
    this._active = true;
    this._fade = null;
    this._tail = null;
    this._lastAmount = 0;
    this._burstLeft = 7;
    this._paintAcc = 0;
    this._lastUpdateTime = 0;
    this._lastValue = null;
    this.seeded = true;
    this.resetPaint(style);
    return true;
  },

  resetPaint(style){
    if(!this.seeded) return;
    this._clearLayer(this.paintCtx, false);
    this._clearLayer(this.liveCtx, true);
    this._clearLayer(this.deadCtx, true);
    this._clearLayer(this.noiseCtx, true);
    if(this._noiseData) this._noiseData.data.fill(0);
    this._drawCtx = null;
    this._liveAge = 0;
    this.progress = 0;
    this.frame = 0;
    this._renderTick = 0;
    this._paintAcc = 0;
    this._lastUpdateTime = 0;
    this._lastValue = null;
    this._tail = null;
    this._style = style;
    this._dirty = true;
  },

  _clearLayer(ctx, transparent){
    if(!ctx) return;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.shadowBlur = 0;
    if(transparent){
      ctx.clearRect(0, 0, this.sw, this.sh);
    } else {
      ctx.fillStyle = 'rgb(0,0,0)';
      ctx.fillRect(0, 0, this.sw, this.sh);
    }
  },

  _promoteLiveToDead(){
    if(!this.liveCanvas || !this.deadCtx) return;
    this.deadCtx.save();
    this.deadCtx.setTransform(1,0,0,1,0,0);
    this.deadCtx.globalCompositeOperation = 'source-over';
    this.deadCtx.globalAlpha = 1;
    this.deadCtx.filter = 'none';
    this.deadCtx.drawImage(this.liveCanvas, 0, 0);
    this.deadCtx.restore();
    this._clearLayer(this.liveCtx, true);
    this._liveAge = 0;
  },

  _decayDead(style, amount, veil){
    const ctx = this.deadCtx || this.paintCtx;
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    if(style === 'gloss'){
      ctx.fillStyle = `rgba(0,0,0,${Math.max(0, Math.min(0.92, veil))})`;
      ctx.fillRect(0, 0, this.sw, this.sh);
    } else {
      this._powderErase(ctx, amount, veil);
    }
    ctx.restore();
  },

  _composePaint(){
    if(!this.paintCtx) return;
    const ctx = this.paintCtx;
    this._clearLayer(ctx, false);
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    if(this.deadCanvas) ctx.drawImage(this.deadCanvas, 0, 0);
    if(this.liveCanvas) ctx.drawImage(this.liveCanvas, 0, 0);
    ctx.restore();
    this._dirty = true;
  },

  isAlive(){
    return !!(this.seeded && (this._active || (this._tail && this._tail.on) || (this._fade && this._fade.on)));
  },

  _startTail(opts={}){
    if(!this.seeded || (this._tail && this._tail.on)) return;
    const style = this._style || 'gloss';
    const from = Math.max(0.08, Math.min(1, this._lastAmount || 0.35));
    this._promoteLiveToDead();
    this._active = false;
    this._fade = null;
    this._tail = {
      on:true,
      from,
      amount:from,
      beatStart:+opts.beat || 0,
      beats:(style === 'matt' || this._flat) ? 6 : 1,   // Matt/Flat はゆっくり減耗
      frames:0,
      maxFrames:600,
    };
    this._lastUpdateTime = 0;
    this._lastValue = null;
  },

  _decayTail(style, opts={}){
    const t = this._tail;
    if(!t || !t.on) return 0;
    const beat = +opts.beat || 0;
    const ph = Math.max(0, Math.min(1, (beat - (+t.beatStart || 0)) / Math.max(0.0625, +t.beats || 1)));
    const ease = ph * ph * (3 - 2 * ph);
    const visible = Math.max(0, (t.from || t.amount || 0.35) * (1 - ease));
    const amount = Math.max(0.04, Math.min(1, visible));
    const gentle = style === 'matt' || this._flat;   // Matt/Flat は穏やかなベールでゆっくり消える
    const veil = gentle ? (0.006 + ease * 0.080 + amount * 0.010) : (0.060 + ease * 0.300 + amount * 0.070);
    this._decayDead(style, amount, Math.min(0.92, veil));
    this._composePaint();
    t.frames++;
    t.amount = visible;
    if(ph >= 1 || t.frames >= t.maxFrames || visible <= 0.0005){
      this._finishTail(style);
      return 0;
    }
    return visible;
  },

  _finishTail(style){
    this._active = false;
    this._tail = null;
    this._fade = null;
    this._lastAmount = 0;
    if(this.seeded) this.resetPaint(style || this._style || 'gloss');
  },

  _fadeDuration(beats, bpm){
    const b = Math.max(0, +beats || 0);
    if(b <= 0) return 0;
    return Math.max(0.05, b * 60 / Math.max(20, +bpm || 120));
  },

  _startFadeOut(opts={}){
    if(!this.seeded || this._fade) return;
    const beats = Math.max(0, +opts.transBeats || 0);
    let rdur = this._fadeDuration(beats, opts.bpm);
    if(rdur <= 0) rdur = 0.45;                 // transBeats 未設定でも急に消えずシームレスに溶かす
    this._active = false;
    this._fade = {
      on:true,
      t0:+opts.beat || 0,
      beats,
      rt0:performance.now()/1000,
      rdur,
      style:+opts.transStyle || 0,
      from:Math.max(0.001, this._lastAmount || 1),
    };
  },

  _fadePhase(opts={}){
    const f = this._fade;
    if(!f || !f.on) return 0;
    if(f.beats <= 0 && f.rdur <= 0) return 1;
    let ph = (f.rdur > 0) ? (((performance.now()/1000) - f.rt0) / f.rdur) : 0;
    if(f.beats > 0) ph = Math.max(ph, ((+opts.beat || 0) - f.t0) / Math.max(0.0625, f.beats));
    ph = Math.max(0, Math.min(1, ph));
    if(f.style === 2) return Math.min(1, ph * 1.16);
    if(f.style === 3 || f.style === 4) return ph;
    if(f.style === 1) return ph < 0.5 ? ph * ph * 2 : 1 - Math.pow(1 - ph, 2) * 2;
    return 1 - Math.pow(1 - ph, 5);
  },

  _finishFade(){
    this._active = false;
    this._fade = null;
    this._lastAmount = 0;
    if(this.seeded) this.resetPaint(this._style || 'gloss');
  },

  _sample(x, y){
    const u = Math.max(0, Math.min(1, x / Math.max(1, this.sw - 1)));
    const v = 1 - Math.max(0, Math.min(1, y / Math.max(1, this.sh - 1)));
    return [Math.round(u * 255), Math.round(v * 255), 255, 255];
  },

  _pickPoint(){
    const x = (this._rand() * this.sw) | 0;
    const y = (this._rand() * this.sh) | 0;
    const flow = Math.sin(x * 0.013 + this.frame * 0.071)
               + Math.sin(y * 0.017 - this.frame * 0.043)
               + Math.sin((x + y) * 0.006);
    return { x, y, c:this._sample(x, y), edge:48, angle:flow * Math.PI };
  },

  _color(c, style, alpha, lift=0){
    let r = c[0], g = c[1], b = c[2];
    if(style === 'matt') alpha = 1;
    alpha = Math.max(0, Math.min(1, alpha));
    return `rgba(${r|0},${g|0},${b|0},${alpha})`;
  },

  _smoothstep(a, b, x){
    if(b <= a) return x >= b ? 1 : 0;
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  },

  _powderErase(ctx, amount, veil){
    const sw = this.sw, sh = this.sh;
    // 2値消去(完全消去 or 未消去)だと濃い飛沫核だけが残り、ダイヤ/アスタリスク状の形が浮く。
    // 全画素を毎フレーム少量ずつ塗り量(bチャンネル)を落とす部分alpha方式にして均等にフェード。
    // 粉状のムラは alpha を乱数変調して残す。
    const baseA = Math.min(0.5, Math.max(0.006, veil * (1.40 + amount * 1.60)));
    if(!this.noiseCtx || !this.noiseCanvas){
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
      ctx.globalAlpha = 1;
      ctx.fillStyle = `rgba(0,0,0,${baseA})`;
      ctx.fillRect(0, 0, sw, sh);
      return;
    }
    if(!this._noiseData || this._noiseW !== sw || this._noiseH !== sh){
      this._noiseData = this.noiseCtx.createImageData(sw, sh);
      this._noiseW = sw;
      this._noiseH = sh;
    }
    const data = this._noiseData.data;
    for(let i=0; i<data.length; i+=4){
      data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
      data[i + 3] = Math.min(255, baseA * 255 * (0.35 + this._rand() * 1.40));   // 粉状ムラ付きの部分消去
    }
    this.noiseCtx.putImageData(this._noiseData, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.noiseCanvas, 0, 0);
  },

  _bezier(p0, p1, p2, p3, t){
    const u = 1 - t;
    const uu = u * u, tt = t * t;
    const a = uu * u, b = 3 * uu * t, c = 3 * u * tt, d = tt * t;
    return {
      x: p0.x*a + p1.x*b + p2.x*c + p3.x*d,
      y: p0.y*a + p1.y*b + p2.y*c + p3.y*d,
    };
  },

  _pressure(t, profile){
    // 入り抜き: 端は細く、中央より少し後ろで筆圧が最大になる。
    const phase = typeof profile === 'number' ? profile : profile.phase;
    const enter = this._smoothstep(0.00, 0.16, t);
    const exit = 1 - this._smoothstep(0.78, 1.00, t);
    const body = Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.42);
    const asym = 0.72 + 0.28 * Math.sin(t * Math.PI * 2 + phase);
    if(typeof profile === 'number') return Math.max(0.025, enter * exit * body * asym);
    const lump1 = Math.exp(-Math.pow((t - profile.peak1) / profile.peakWidth, 2));
    const lump2 = Math.exp(-Math.pow((t - profile.peak2) / (profile.peakWidth * 0.72), 2));
    const waist = Math.exp(-Math.pow((t - profile.waist) / 0.10, 2));
    const pooled = 0.62 + profile.lump * (0.72*lump1 + 0.42*lump2) - profile.waistDepth * waist;
    return Math.max(0.012, enter * exit * body * asym * pooled);
  },

  _widthNoise(i, t, profile){
    const n = Math.sin(i * profile.freqA + profile.phase) * 0.5
            + Math.sin(i * profile.freqB + profile.phase * 1.73) * 0.32
            + Math.sin(t * Math.PI * 8 + profile.phase * 0.41) * 0.18;
    return Math.max(0.24, Math.min(1.95, 1 + n * profile.ragged));
  },

  _curvePath(ctx, p0, p1, p2, p3, steps, ox=0, oy=0){
    ctx.beginPath();
    ctx.moveTo(p0.x + ox, p0.y + oy);
    for(let i=1; i<=steps; i++){
      const q = this._bezier(p0, p1, p2, p3, i / steps);
      ctx.lineTo(q.x + ox, q.y + oy);
    }
  },

  _curveSegmentPath(ctx, p0, p1, p2, p3, t0, t1, steps, ox=0, oy=0){
    ctx.beginPath();
    const a = this._bezier(p0, p1, p2, p3, t0);
    ctx.moveTo(a.x + ox, a.y + oy);
    for(let i=1; i<=steps; i++){
      const t = t0 + (t1 - t0) * (i / steps);
      const q = this._bezier(p0, p1, p2, p3, t);
      ctx.lineTo(q.x + ox, q.y + oy);
    }
  },

  _roundDrop(x, y, c, radius, style, angle){
    const ctx = this._drawCtx || this.paintCtx;
    const r = Math.max(0.25, radius);
    ctx.save();
    if(style === 'gloss'){
      ctx.globalCompositeOperation = 'screen';
      ctx.filter = `blur(${Math.max(0.12, r * 0.16)}px)`;
      ctx.fillStyle = this._color(c, style, 0.26);
      ctx.beginPath();
      ctx.ellipse(x, y, r * (1.55 + this._rand()*0.55), r * (1.10 + this._rand()*0.35), angle, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = this._color(c, style, style === 'gloss' ? 0.96 : 0.90);
    ctx.beginPath();
    ctx.ellipse(x, y, r * (0.85 + this._rand()*0.32), r * (0.72 + this._rand()*0.24), angle, 0, Math.PI*2);
    ctx.fill();
    if(style === 'gloss' && this._rand() < 0.55){
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = this._color(c, style, 0.28);
      ctx.beginPath();
      ctx.ellipse(x - r*0.18, y - r*0.22, r * 0.34, r * 0.16, angle - 0.35, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  },

  _splatterCluster(x, y, c, width, style, amount, angle){
    const ctx = this._drawCtx || this.paintCtx;
    const base = Math.max(0.45, width);
    const ax = Math.cos(angle), ay = Math.sin(angle);
    const nx = -ay, ny = ax;
    const bleed = base * (0.24 + this._rand() * 0.55) * (0.52 + amount * 0.28);
    ctx.save();
    if(style === 'gloss'){
      ctx.globalCompositeOperation = 'screen';
      ctx.filter = `blur(${Math.max(0.12, base * 0.24)}px)`;
      ctx.fillStyle = this._color(c, style, 0.16);
      ctx.beginPath();
      ctx.ellipse(x, y, bleed * (1.35 + this._rand()*1.25), bleed * (0.16 + this._rand()*0.24), angle, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.filter = 'none';

    const count = Math.round(4 + amount * 9 + this._rand() * 5);
    for(let i=0; i<count; i++){
      const along = (this._rand() - 0.5) * base * (style === 'matt' ? 16 : 13) * (0.75 + amount);
      const spread = Math.pow(this._rand(), 0.55) * base * (style === 'matt' ? 9.5 : 7.4) * (0.65 + amount);
      const side = (this._rand() < 0.5 ? -1 : 1) * spread;
      const dx = x + ax * along + nx * side;
      const dy = y + ay * along + ny * side;
      const rr = base * (0.018 + Math.pow(this._rand(), 2.4) * (this._rand() < 0.08 ? 0.20 : 0.11));
      const cc = c;
      ctx.globalCompositeOperation = style === 'matt' ? 'source-over' : 'screen';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(0.16, rr * (0.24 + this._rand()*0.34));
      ctx.strokeStyle = this._color(cc, style, style === 'gloss' ? 0.58 : 0.40);
      const sl = rr * (2.6 + this._rand()*8.0);
      const ja = angle + (this._rand() - 0.5) * 0.95;
      const sx = Math.cos(ja), sy = Math.sin(ja);
      ctx.beginPath();
      ctx.moveTo(dx - sx*sl*0.35, dy - sy*sl*0.35);
      ctx.lineTo(dx + sx*sl*0.65, dy + sy*sl*0.65);
      ctx.stroke();
      if(style === 'gloss' && this._rand() < 0.34){
        ctx.globalCompositeOperation = 'screen';
        ctx.strokeStyle = this._color(cc, style, 0.08 + this._rand()*0.12);
        ctx.lineWidth = Math.max(0.12, rr * 0.14);
        ctx.beginPath();
        ctx.moveTo(dx, dy);
        ctx.lineTo(dx + sx*sl*0.55, dy + sy*sl*0.55);
        ctx.stroke();
      }
    }
    ctx.restore();
  },

  _stroke(amount, style, pulse){
    const p = this.PRESET;
    const scale = Math.max(this.sw, this.sh) / 1000;
    const rough = 0.55 + amount * 1.75;
    const brush = ((p.minBrushSize + p.maxBrushSize) * 0.5) * scale;
    const point = this._pickPoint();
    const x = point.x, y = point.y;
    const maxDim = Math.max(this.sw, this.sh);
    const isLong = this._rand() < 0.84;
    const isFilament = isLong && this._rand() < 0.82;
    const baseLen = p.strokeLen * scale * (0.20 + amount*0.48);
    const lenMode = isFilament ? 1.35 + this._rand()*2.25*rough : isLong ? 0.92 + this._rand()*1.55*rough : 0.16 + this._rand()*0.54*rough;
    const lengthSpread = Math.exp((this._rand() - 0.5) * 0.70 * rough);
    const len = Math.max(brush * 2.6, Math.min(maxDim * (isFilament ? 0.86 : isLong ? 0.60 : 0.24), baseLen * lenMode * lengthSpread));
    // Flat / Matt は太さのばらつき(Size Var)を大きく: スプレッドを広げ、上限も緩める
    const wideVar = this._flat || style === 'matt';
    const widthSpread = Math.exp((this._rand() - 0.5) * (wideVar ? 3.60 : 2.15) * rough);
    const filamentWidth = isFilament ? 0.18 + this._rand()*0.24 : 1.0;
    let width = Math.max(0.20, Math.min(brush * (isFilament ? 1.35 : 2.15) * (wideVar ? 1.8 : 1.0), brush * (style === 'gloss' ? 0.30 : 0.24) * widthSpread * (0.52 + amount * 0.62) * filamentWidth));
    width = Math.min(width, Math.max(0.18, len * (isFilament ? 0.055 : (wideVar ? 0.14 : 0.075))));
    const followsEdge = point.edge > 16 && this._rand() < (isLong ? 0.82 : 0.60);
    const a = (followsEdge ? point.angle : this._rand() * Math.PI * 2) + (this._rand() - 0.5) * (isLong ? 0.80 : 1.55);
    const dirX = Math.cos(a), dirY = Math.sin(a);
    const nX = -dirY, nY = dirX;
    const bend = len * (0.10 + p.curveAmount*0.035) * rough * (this._rand() < 0.5 ? -1 : 1);
    const p0 = { x: x - dirX * len * 0.5, y: y - dirY * len * 0.5 };
    const p3 = { x: x + dirX * len * 0.5, y: y + dirY * len * 0.5 };
    const p1 = { x: p0.x + dirX*len*0.33 + nX*bend, y: p0.y + dirY*len*0.33 + nY*bend };
    const p2 = { x: p0.x + dirX*len*0.67 - nX*bend*0.35, y: p0.y + dirY*len*0.67 - nY*bend*0.35 };
    const c = this._sample(p0.x, p0.y);
    const steps = Math.max(7, Math.min(22, Math.floor(len / Math.max(5, width * 1.70))));
    const profile = {
      phase: this._rand() * Math.PI * 2,
      peak1: 0.34 + this._rand() * 0.36,
      peak2: 0.24 + this._rand() * 0.62,
      peakWidth: 0.12 + this._rand() * 0.14,
      lump: style === 'gloss' ? 0.88 + this._rand()*0.60*rough : 0.96 + this._rand()*0.72*rough,
      waist: 0.32 + this._rand() * 0.48,
      waistDepth: 0.10 + this._rand() * (style === 'matt' ? 0.18 : 0.20) * rough,
      ragged: (style === 'matt' ? 0.34 + this._rand()*0.24 : 0.28 + this._rand()*0.30) * rough,
      freqA: 1.3 + this._rand()*2.7,
      freqB: 3.8 + this._rand()*6.2,
    };
    const ctx = this._drawCtx || this.paintCtx;

    if(style === 'gloss'){
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.filter = `blur(${Math.max(0.08, width * 0.24)}px)`;
      ctx.lineWidth = width * (isFilament ? 0.82 : 1.08);
      ctx.strokeStyle = this._color(c, style, isFilament ? 0.34 : 0.28);
      this._curvePath(ctx, p0, p1, p2, p3, Math.max(5, Math.floor(steps * 0.55)));
      ctx.stroke();
      ctx.restore();
    }

    // Main body: layered continuous curves. This avoids strip segments and the visible diamond shape of ribbon polygons.
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.filter = 'none';
    ctx.shadowBlur = 0;
    const midPressure = this._pressure(0.54, profile);
    const bodyW = width * (isFilament ? (style === 'gloss' ? 0.98 : 0.82) : (style === 'gloss' ? 1.18 : 0.98)) * (0.82 + midPressure * 0.34);
    const curveSteps = style === 'gloss' ? Math.max(10, Math.round(steps * 1.4)) : Math.max(14, steps * 2);   // gloss はパス頂点を削減
    ctx.lineWidth = Math.max(0.10, bodyW * 0.42);
    ctx.strokeStyle = this._color(c, style, style === 'gloss' ? 0.44 : 0.40);
    this._curvePath(ctx, p0, p1, p2, p3, curveSteps);
    ctx.stroke();
    ctx.lineWidth = Math.max(0.12, bodyW);
    ctx.strokeStyle = this._color(c, style, style === 'gloss' ? 0.94 : 0.90);
    this._curveSegmentPath(ctx, p0, p1, p2, p3, 0.08, 0.92, curveSteps);
    ctx.stroke();
    if(!isFilament){
      ctx.lineWidth = Math.max(0.10, bodyW * 0.58);
      ctx.strokeStyle = this._color(c, style, style === 'gloss' ? 0.46 : 0.40);
      this._curveSegmentPath(ctx, p0, p1, p2, p3, 0.22, 0.78, curveSteps, -nX*width*0.08, -nY*width*0.08);
      ctx.stroke();
    }
    for(let i=0; i<steps; i++){
      const t0 = i / steps, t1 = (i + 1) / steps, tm = (t0 + t1) * 0.5;
      if(this._rand() < 0.90) continue;
      const q0 = this._bezier(p0, p1, p2, p3, t0);
      const q1 = this._bezier(p0, p1, p2, p3, t1);
      const qM = this._bezier(p0, p1, p2, p3, tm);
      const pr = this._pressure(tm, profile);
      const wn = this._widthNoise(i, tm, profile);
      const dry = style === 'matt' ? Math.max(0.20, 0.72 + 0.32 * Math.sin(i * 2.71 + profile.phase * 3.1)) : 1.0;
      const cc = c;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(0.04, width * wn * (0.006 + pr * (style === 'gloss' ? 0.08 : 0.06)) * dry);
      ctx.strokeStyle = this._color(cc, style, (0.04 + pr * (style === 'gloss' ? 0.10 : 0.07) + pulse*0.014) * dry);
      ctx.beginPath();
      ctx.moveTo(q0.x, q0.y);
      ctx.lineTo(q1.x, q1.y);
      ctx.stroke();
    }

    if(style === 'gloss'){
      ctx.globalCompositeOperation = 'screen';
      for(let i=1; i<steps-1; i+=isFilament ? 3 : 4){
        const t0 = i / steps, t1 = (i + 1) / steps, tm = (t0 + t1) * 0.5;
        const pr = this._pressure(tm, profile);
        if(pr < 0.12 || this._rand() < 0.45) continue;
        const q0 = this._bezier(p0, p1, p2, p3, t0);
        const q1 = this._bezier(p0, p1, p2, p3, t1);
        const qM = this._bezier(p0, p1, p2, p3, tm);
        const wn = this._widthNoise(i, tm, profile);
        ctx.lineWidth = Math.max(0.08, width * wn * (isFilament ? (0.012 + pr * 0.12) : (0.014 + pr * 0.12)));
        ctx.strokeStyle = this._color(c, 'gloss', 0.10 + pr*0.30 + pulse*0.04, 82);
        ctx.beginPath();
        ctx.moveTo(q0.x + nX*width*0.16, q0.y + nY*width*0.16);
        ctx.lineTo(q1.x + nX*width*0.16, q1.y + nY*width*0.16);
        ctx.stroke();
      }
    } else {
      ctx.globalCompositeOperation = 'source-over';
      for(let i=2; i<steps-2; i+=2){
        const tm = (i + 0.5) / steps;
        const q0 = this._bezier(p0, p1, p2, p3, i / steps);
        const q1 = this._bezier(p0, p1, p2, p3, (i + 1) / steps);
        const pr = this._pressure(tm, profile);
        if(this._rand() > 0.58 || pr < 0.10) continue;
        ctx.lineWidth = Math.max(0.12, width * (0.015 + pr * 0.18));
        ctx.strokeStyle = this._color(c, style, 0.030 + this._rand()*0.080);
        ctx.beginPath();
        ctx.moveTo(q0.x - nX*width*0.08, q0.y - nY*width*0.08);
        ctx.lineTo(q1.x - nX*width*0.08, q1.y - nY*width*0.08);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Pools / satellite drops: blurred outside, sharp center.
    if(!isFilament && this._rand() < 0.045 + amount*0.105){
      const dt = this._rand();
      const qp = this._bezier(p0, p1, p2, p3, dt);
      const dx = qp.x + (this._rand()-0.5) * width * 4.5;
      const dy = qp.y + (this._rand()-0.5) * width * 4.5;
      const rr = Math.max(0.22, width * (0.075 + this._rand()*0.24));
      ctx.save();
      if(style === 'gloss'){
        ctx.globalCompositeOperation = 'screen';
        ctx.filter = `blur(${Math.max(0.12, rr * 0.38)}px)`;
        ctx.fillStyle = this._color(c, style, 0.34);
        ctx.beginPath();
        ctx.ellipse(dx, dy, rr * (1.10 + this._rand()*1.25), rr * (0.62 + this._rand()*0.72), a, 0, Math.PI*2);
        ctx.fill();
      }
      ctx.filter = 'none';
      ctx.fillStyle = this._color(c, style, style === 'gloss' ? 0.96 : 0.88);
      ctx.beginPath();
      ctx.ellipse(dx, dy, rr * (0.82 + this._rand()*0.78), rr * (0.54 + this._rand()*0.46), a, 0, Math.PI*2);
      ctx.fill();
      if(style === 'gloss'){
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = this._color(c, style, 0.16 + this._rand()*0.18);
        ctx.beginPath();
        ctx.ellipse(dx - rr*0.18, dy - rr*0.22, rr * (0.32 + this._rand()*0.26), rr * (0.04 + this._rand()*0.06), a - 0.4, 0, Math.PI*2);
        ctx.fill();
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = this._color(c, style, 0.035 + this._rand()*0.055);
        ctx.beginPath();
        ctx.ellipse(dx, dy, rr * (0.68 + this._rand()*0.62), rr * (0.42 + this._rand()*0.36), a, 0, Math.PI*2);
        ctx.fill();
      }
      ctx.restore();
    }
    if(this._rand() < (isFilament ? 0.085 + amount*0.18 : 0.24 + amount*0.56)){
      const dt = 0.10 + this._rand() * 0.80;
      const qp = this._bezier(p0, p1, p2, p3, dt);
      const side = (this._rand() - 0.5) * brush * (0.9 + amount * 2.8);
      const along = (this._rand() - 0.5) * brush * (0.4 + amount * 1.8);
      const rr = brush * (0.24 + Math.pow(this._rand(), 0.45) * (this._rand() < 0.22 ? 1.25 : 0.58)) * (0.55 + amount * 0.55);
      this._roundDrop(qp.x + nX*side + dirX*along, qp.y + nY*side + dirY*along, c, rr, style, a + (this._rand()-0.5)*0.6);
    }
    const extraDrops = Math.floor(amount * amount * (isFilament ? 2.5 : 5.5) + this._rand() * amount * 2.0);
    for(let j=0; j<extraDrops; j++){
      if(this._rand() > 0.42 + amount * 0.48) continue;
      const dt = this._rand();
      const qp = this._bezier(p0, p1, p2, p3, dt);
      const side = (this._rand() - 0.5) * brush * (1.6 + amount * 5.5);
      const along = (this._rand() - 0.5) * brush * (0.8 + amount * 3.4);
      const big = this._rand() < 0.26 + amount * 0.22;
      const rr = brush * (big ? 0.64 + this._rand()*1.45 : 0.20 + this._rand()*0.62) * (0.60 + amount * 0.75);
      this._roundDrop(qp.x + nX*side + dirX*along, qp.y + nY*side + dirY*along, c, rr, style, a + (this._rand()-0.5)*1.2);
    }
    if(this._rand() < (isFilament ? 0.26 + amount*0.34 : 0.42 + amount*0.48)){
      const dt = 0.15 + this._rand() * 0.70;
      const q = this._bezier(p0, p1, p2, p3, dt);
      this._splatterCluster(q.x, q.y, c, Math.max(width, brush * (0.50 + amount * 0.72)), style, amount, a);
    }
    if(isLong && !isFilament && this._rand() < 0.045 + amount*0.16){
      const q = this._rand() < 0.5 ? p0 : p3;
      this._splatterCluster(q.x, q.y, c, Math.max(width * 0.72, brush * (0.36 + amount * 0.50)), style, amount, a);
    }
  },

  update(value, pulse){
    if(!this.seeded) return;
    const amount = Math.min(1, Math.abs(value || 0));
    if(amount <= 0.001){
      this._lastUpdateTime = 0;
      this._lastValue = null;
      return;
    }
    const style = this._flat ? 'matt' : (value >= 0 ? 'gloss' : 'matt');   // Flat は matt 描画で線ごと単色
    if(style !== this._style){
      this.resetPaint(style);
      this._burstLeft = Math.max(this._burstLeft, 5);
    }
    this._active = true;
    this._fade = null;
    this._tail = null;
    this._lastAmount = amount;
    const now = performance.now() * 0.001;
    let dt = this._lastUpdateTime ? now - this._lastUpdateTime : 1 / 60;
    this._lastUpdateTime = now;
    dt = Math.max(1 / 120, Math.min(1 / 20, dt || 1 / 60));
    const delta = this._lastValue == null ? 0 : Math.min(1, Math.abs(value - this._lastValue) * 2.75);
    this._lastValue = value;
    const speed = 0.55 + amount * 2.65;
    const turnover = amount * amount;
    const lowDecay = 1 - this._smoothstep(0.035, 0.18, amount);
    const eraseRate = (style === 'matt' ? 1.65 : 0.58)
                    + turnover * (style === 'matt' ? 3.30 : 1.05)
                    + lowDecay * lowDecay * (style === 'matt' ? 3.60 : 1.80);
    const veil = 1 - Math.exp(-eraseRate * dt);
    const liveLag = Math.max(0.10, (style === 'matt' ? 0.98 : 0.24) - amount * (style === 'matt' ? 0.20 : 0.12));
    this._liveAge += dt;
    if(this._liveAge >= liveLag) this._promoteLiveToDead();
    this._decayDead(style, amount, veil);

    const burst = this._burstLeft > 0;
    const baseRate = (style === 'matt' ? 38 : 29) + amount * (style === 'matt' ? 235 : 175);   // gloss は軽量化 (~25%減)
    const motionBoost = 1 + delta * 0.85;
    this._paintAcc += baseRate * motionBoost * dt;
    let strokes = Math.floor(this._paintAcc);
    this._paintAcc -= strokes;
    if(this._rand() < this._paintAcc){
      strokes++;
      this._paintAcc = 0;
    }
    if(burst) strokes += Math.round((style === 'matt' ? 12 : 6) + amount * (style === 'matt' ? 22 : 12) + this._rand() * (style === 'matt' ? 10 : 5));
    strokes = Math.max(0, Math.min(style === 'matt' ? 64 : 36, strokes));
    const livePulse = 0.025 + amount * 0.055;
    const prevDrawCtx = this._drawCtx;
    this._drawCtx = this.liveCtx || this.paintCtx;
    for(let i=0; i<strokes; i++) this._stroke(amount, style, livePulse);
    this._drawCtx = prevDrawCtx;
    if(burst) this._burstLeft--;
    this.progress = Math.min(1, this.progress + strokes / 360);
    this.frame += speed * dt * 60;
    this._composePaint();
  },

  _upload(){
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if(this._texW !== this.sw || this._texH !== this.sh){
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.sw, this.sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      this._texW = this.sw;
      this._texH = this.sh;
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.paintCanvas);
    this._dirty = false;
  },

  render({srcTex, fbo, w, h, value, pulse, beat=0, bpm=120, transBeats=0, transStyle=0, time=0, flat=false}){
    if(!this.initialized) this.init(this.gl);
    const gl = this.gl;
    const amount = Math.min(1, Math.abs(value || 0));
    this._flat = !!flat;   // update() より前に確定させ、Flat は matt 相当(不透明)で座標マップを描く=線ごと単色
    // Flat は matt スタイルで描画(座標を不透明に上書き→重なりで座標が混ざらず、線ごとに単色になる)。
    const style = flat ? 'matt' : (amount > 0.001 ? (value >= 0 ? 'gloss' : 'matt') : (this._style || 'gloss'));
    if(!srcTex || !fbo) return 0;

    let drawAmount = amount;
    if(amount > 0.001){
      if(!this.seeded || this.fw !== w || this.fh !== h) this.reset(gl, w, h, style);
      this._active = true;
      this._fade = null;
      this._tail = null;
      this._lastAmount = amount;
    } else {
      if(this._active) this._startTail({beat});
      if(!this._tail || !this._tail.on) return 0;
      drawAmount = this._decayTail(style, {beat});
      if(drawAmount <= 0.001) return 0;
    }

    this._renderTick = (this._renderTick + 1) & 0x7fffffff;
    const shouldGrow = amount > 0.001;
    if(shouldGrow){
      this.update(value, pulse || 0);
      this._upload();
    } else if(this._dirty){
      this._upload();
    }
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uSrc'), 0);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uMap'), 1);
    gl.uniform2f(gl.getUniformLocation(this.prog, 'uTexel'), 1 / Math.max(1, this.sw), 1 / Math.max(1, this.sh));
    gl.uniform2f(gl.getUniformLocation(this.prog, 'uSrcTexel'), 1 / Math.max(1, w), 1 / Math.max(1, h));
    gl.uniform1f(gl.getUniformLocation(this.prog, 'uAmount'), drawAmount);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'uStyle'), style === 'gloss' ? 1 : -1);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'uFlat'), flat ? 1 : 0);
    this._flat = !!flat;
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return drawAmount;
  },

  blur({srcTex, fbo, w, h, amount=1, style=null}){
    if(!this.initialized) this.init(this.gl);
    if(!this.blurProg || !srcTex || !fbo) return false;
    const gl = this.gl;
    const amt = Math.min(1, Math.abs(amount || 0));
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.blurProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(gl.getUniformLocation(this.blurProg, 'uSrc'), 0);
    gl.uniform1i(gl.getUniformLocation(this.blurProg, 'uMap'), 1);
    gl.uniform2f(gl.getUniformLocation(this.blurProg, 'uTexel'), 1 / Math.max(1, w), 1 / Math.max(1, h));
    gl.uniform2f(gl.getUniformLocation(this.blurProg, 'uMapTexel'), 1 / Math.max(1, this.sw), 1 / Math.max(1, this.sh));
    gl.uniform1f(gl.getUniformLocation(this.blurProg, 'uAmount'), amt);
    gl.uniform1f(gl.getUniformLocation(this.blurProg, 'uStyle'), style == null ? (this._style === 'matt' ? -1 : 1) : style);
    gl.uniform1f(gl.getUniformLocation(this.blurProg, 'uFlat'), this._flat ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  },
};
