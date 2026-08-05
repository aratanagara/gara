vec2 applyGlitchUV(vec2 uv, vec2 fc){
  if (glitchMode != 1) return uv;
  float k = clamp(glitchAmt, 0.0, 1.0);
  if (k <= 0.00001) return uv;
  float b = glitchBeat;
  float stepB = floor(b * 16.0);
  float seed = fract(sin((stepB + 1.0) * 78.233 + glitchSeed * 11.7) * 12345.678);
  float beatPhase = fract(b);
  float beatActive = step(beatPhase, 0.25);
  float beatCurve = sin(min(beatPhase / 0.25, 1.0) * PI);
  float globalTrigger = step(0.3, seed) * beatActive * k;
  if (globalTrigger < 0.001) return uv;
  float sliceRandom = hash11(seed * 3.7);
  float sliceHeightPx = 2.0 + pow(sliceRandom, 6.0) * 598.0;
  float pixelY = uv.y * resolution.y;
  float sid = floor(pixelY / sliceHeightPx);
  float r1 = hash11(sid * 13.37 + seed * 91.7);
  float intensity = pow(r1, 7.0);
  float shouldGlitch = step(0.8, r1);
  if (shouldGlitch < 0.5) return uv;
  float shiftBase = pow(hash11(sid * 7.31 + seed * 19.1), 5.0);
  float shiftAmt = (shiftBase - 0.5) * 3.0 * intensity * beatCurve;
  float shiftAmt2 = (pow(hash11(sid * 29.3 + seed * 3.7), 3.0) - 0.5) * 0.8 * intensity;
  float beatShift = sin(b * TAU) * 0.3 * intensity * beatCurve;
  float randomShift = (pow(hash11(sid * 17.3 + seed * 5.3), 4.0) - 0.5) * 1.2 * intensity;
  float totalShift = globalTrigger * (shiftAmt + shiftAmt2 + beatShift + randomShift);
  uv.x = fract(uv.x + totalShift);
  return uv;
}

vec2 applyGlitchUV_Multi(vec2 uv, vec2 fc){
  float k = clamp(glitchAmt, 0.0, 1.0);
  if (k <= 0.00001) return uv;
  float b = glitchBeat;
  float stepB = floor(b * 16.0);
  float seed = fract(sin((stepB + 1.0) * 78.233 + glitchSeed * 11.7) * 12345.678);
  if (glitchMode == 3) return uv;
  if (glitchMode == 4) {
    float stepB4 = floor(b * 4.0);
    float seed4 = fract(sin((stepB4 + 1.0) * 78.233 + glitchSeed * 11.7) * 12345.678);
    float beatPhase = fract(b);
    float twistAmount = sin(beatPhase * PI);
    twistAmount = pow(twistAmount, 0.8) * k;
    vec2 center = vec2(hash11(seed4 * 3.1), hash11(seed4 * 7.7));
    vec2 toCenter = uv - center;
    float dist = length(toCenter);
    float radius = 0.3 + hash11(seed4 * 11.3) * 0.4;
    float influence = smoothstep(radius * 1.2, 0.0, dist);
    if(influence > 0.001){
      float rotation = (hash11(seed4 * 13.7) - 0.5) * PI * 10.0 * twistAmount;
      float distFactor = 1.0 - pow(dist / radius, 0.5);
      rotation *= distFactor;
      float scaleBase = hash11(seed4 * 19.1);
      float scale = (scaleBase < 0.5) ? (1.0 - twistAmount * 0.9) : (1.0 + twistAmount * 2.0);
      float angle = atan(toCenter.y, toCenter.x);
      float newAngle = angle + rotation;
      float newDist = dist * scale;
      vec2 displaced = center + vec2(cos(newAngle) * newDist, sin(newAngle) * newDist);
      uv = mix(uv, displaced, influence);
    }
    return uv;
  }
  if (glitchMode == 5) {
    float beatPhase = fract(b);
    float blurAmount = pow(sin(beatPhase * PI), 1.0) * k;
    float stepB2 = floor(b * 0.5);
    float directionSeed = fract(sin(stepB2 * 78.233 + glitchSeed * 11.7) * 12345.678);
    float dirIndex = floor(directionSeed * 8.0);
    float motionAngle = dirIndex * (TAU / 8.0);
    float pixelNoise = hash11(fc.x * 0.01 + fc.y * 0.01 + seed * 7.3);
    motionAngle += (pixelNoise - 0.5) * 0.3;
    vec2 motionDir = vec2(cos(motionAngle), sin(motionAngle));
    float displacement = blurAmount * 0.15;
    float depthVariation = hash11(fc.x * 0.05 + fc.y * 0.05 + seed * 13.7);
    displacement *= (0.5 + depthVariation * 0.5);
    return uv + motionDir * displacement;
  }
  return uv;
}

float gSat(float x){ return clamp(x, 0.0, 1.0); }

vec3 applyGlitchAll(vec3 col, vec2 fc){
  if (glitchMode <= 0) return col;
  float k = clamp(glitchAmt, 0.0, 1.0);
  if (k <= 0.00001) return col;
  float b = glitchBeat;
  float stepB = floor(b * 4.0);
  vec2 uv = fc / max(resolution, vec2(1.0));
  float seed = fract(sin((stepB + 1.0) * 78.233 + glitchSeed * 11.7) * 12345.678);
  if (glitchMode == 1){ return col; }
  if (glitchMode == 2){
    float beatPhase = fract(b);
    float sizeAnim = smoothstep(0.0, 1.0, beatPhase);
    float mosaicSize = mix(4.0, 32.0, sizeAnim * hash11(seed * 7.3));
    vec2 mosaicCell = floor(fc / mosaicSize);
    float slitType = hash11(seed * 3.7);
    float slitFreq = mix(30.0, 8.0, sizeAnim * hash11(seed * 9.1));
    float slit = 0.0;
    if(slitType < 0.5){ slit = step(0.5, fract(uv.x * slitFreq + seed)); }
    else { slit = step(0.5, fract(uv.y * slitFreq + seed)); }
    float effectType = hash11(seed * 11.3);
    vec3 result = col;
    if(effectType < 0.5){
      float blockHash = hash21(mosaicCell + seed * 7.7);
      if(blockHash > 0.7){ result = vec3(col.g, col.b, col.r); }
      else if(blockHash > 0.4){ result = vec3(col.b, col.r, col.g); }
    } else {
      result = mix(col, vec3(1.0) - col, slit * 0.7);
    }
    result = mix(col, result, k);
    float noiseAmt = mix(0.15, 0.05, sizeAnim);
    float noise = (hash11(fc.x + fc.y * 173.1 + stepB * 5.0) - 0.5) * noiseAmt * k;
    result += noise;
    return clamp(result, 0.0, 1.0);
  }
  if (glitchMode == 3){
    float nr = hash11(fc.x + fc.y * 113.1 + stepB * 17.0 + seed * 101.7);
    float ng = hash11(fc.x + fc.y * 113.1 + stepB * 19.0 + seed * 107.3);
    float nb = hash11(fc.x + fc.y * 113.1 + stepB * 23.0 + seed * 109.1);
    return clamp(mix(col, vec3(nr, ng, nb), 0.3 * k), 0.0, 1.0);
  }
  if (glitchMode == 4){
    vec2 center = resolution * 0.5;
    vec2 toCenter = fc - center;
    float dist = length(toCenter);
    float maxDist = length(resolution * 0.5);
    float distNorm = clamp(dist / max(maxDist, 1.0), 0.0, 1.0);
    float blurStrength = pow(distNorm, 2.5) * k;
    float beatPulse = 0.5 + 0.5 * sin(b * TAU);
    blurStrength *= (0.6 + 0.4 * beatPulse);
    vec3 aberration = col;
    aberration.r = col.r * (1.0 - blurStrength * 0.1);
    aberration.b = col.b * (1.0 + blurStrength * 0.1);
    float vignette = 1.0 - pow(distNorm, 3.0) * blurStrength * 0.6;
    aberration *= vignette;
    return clamp(mix(col, aberration, clamp(blurStrength * 2.0, 0.0, 1.0)), 0.0, 1.0);
  }
  return col;
}

// =====================================================
