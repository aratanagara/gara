// =====================================================
void main(){
  float bt = getBeat();

  vec2 bgFC = gl_FragCoord.xy;
  
  if(glitchMode == 1 && glitchAmt > 0.0){
    float b = glitchBeat;
    float stepB = floor(b * 16.0);
    float seed = fract(sin((stepB + 1.0) * 78.233 + glitchSeed * 11.7) * 12345.678);
    float beatPhase = fract(b);
    float beatActive = step(beatPhase, 0.25);
    float beatCurve = sin(min(beatPhase / 0.25, 1.0) * PI);
    float k = clamp(glitchAmt, 0.0, 1.0);
    float globalTrigger = step(0.3, seed) * beatActive * k;
    if(globalTrigger > 0.001){
      float sliceRandom = hash11(seed * 3.7);
      float sliceHeightPx = 2.0 + pow(sliceRandom, 6.0) * 598.0;
      float pixelY = bgFC.y;
      float sid = floor(pixelY / sliceHeightPx);
      float r1 = hash11(sid * 13.37 + seed * 91.7);
      float intensity = pow(r1, 7.0);
      float shouldGlitch = step(0.8, r1);
      if(shouldGlitch > 0.5){
        float shiftBase = pow(hash11(sid * 7.31 + seed * 19.1), 5.0);
        float shiftAmt = (shiftBase - 0.5) * 3.0 * intensity * beatCurve;
        float shiftAmt2 = (pow(hash11(sid * 29.3 + seed * 3.7), 3.0) - 0.5) * 0.8 * intensity;
        float beatShift = sin(b * TAU) * 0.3 * intensity * beatCurve;
        float randomShift = (pow(hash11(sid * 17.3 + seed * 5.3), 4.0) - 0.5) * 1.2 * intensity;
        float totalShift = globalTrigger * (shiftAmt + shiftAmt2 + beatShift + randomShift);
        bgFC.x = mod(bgFC.x + totalShift * resolution.x, resolution.x);
      }
    }
  }
  
  if((glitchMode == 3 || glitchMode == 4 || glitchMode == 5) && glitchAmt > 0.0){
    vec2 screenUV = bgFC / resolution;
    vec2 transformedUV = applyGlitchUV_Multi(screenUV, bgFC);
    bgFC = transformedUV * resolution;
  }

  vec3 bg = getBackground(bgFC);
  float cb = colorBeat(bt);
  bg = mix(bg, palPick(fract(cb * 0.05)), 0.00);

  if(showVisual == 0){
    vec3 finalBg = applyPaletteAll(bg, gl_FragCoord.xy);
    finalBg = applyGlitchAll(finalBg, gl_FragCoord.xy);
    if(invertPalette != 0){ finalBg = vec3(1.0) - finalBg; }
    gl_FragColor = vec4(finalBg, 1.0);
    return;
  }

  vec2 uv = uvCover(vTexCoord, resolution, texSize);
  if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0){
    vec3 finalBg = applyPaletteAll(bg, gl_FragCoord.xy);
    finalBg = applyGlitchAll(finalBg, gl_FragCoord.xy);
    if(invertPalette != 0){ finalBg = vec3(1.0) - finalBg; }
    gl_FragColor = vec4(finalBg, 1.0);
    return;
  }

  uv = applyGlitchUV(uv, gl_FragCoord.xy);
  uv = applyGlitchUV_Multi(uv, gl_FragCoord.xy);

  vec3 src = texture2D(tex0, uv).rgb;

  float rb = min(src.r, src.b);
  float magHard = step(keyRBMin, rb) * (1.0 - step(keyGMax, src.g));
  float magSoft = sstep(keyRBMin - keySoft, keyRBMin + keySoft, rb)
                * (1.0 - sstep(keyGMax - keySoft, keyGMax + keySoft, src.g));
  float mag = max(magHard, magSoft);
  float paperMask = 1.0 - mag;

  vec3 paper = mix(bg, vec3(1.0), paperMask);
  paper = mix(paper, bg, 0.08);

  float luma = dot(src, vec3(0.299, 0.587, 0.114));
  float ink = 1.0 - smoothstep(0.65, 0.95, luma);
  ink = pow(clamp(ink, 0.0, 1.0), baseInkGamma);
  ink = clamp(ink * baseInkGain, 0.0, 1.0);
  float inkVis = ink * paperMask;

  float flash = isFree()
    ? (0.5 + 0.5 * sin(bt * 0.65)) * flashAmt * 0.35
    : pow(1.0 - fract(bt), max(1.0, flashPow)) * flashAmt;

  vec3 baseCol = mix(
    paper,
    baseInkColor,
    clamp(inkVis * inkOpacity * (1.0 + flashInk * flash), 0.0, 1.0)
  );

  vec2 n = gl_FragCoord.xy / resolution.xy;
  vec2 p = n - centerN;
  p.x *= resolution.x / resolution.y;

  float r  = length(p);
  float an = (atan(p.y, p.x) + PI) / TAU;

  float rf = r * ringDensity;
  float d0 = abs(fract(rf) - 0.5);
  float ringId = floor(rf);

  float alive = isFree()
    ? smoothstep(1.0 - appearRate - 0.18, 1.0 - appearRate + 0.18,
                 hash21(vec2(ringId * 1.7, floor(bt) * 2.3)))
    : step(1.0 - appearRate,
           hash21(vec2(ringId * 1.7, floor(bt) * 2.3)));

  float phaseR = fract(bt * mix(0.65, 1.85, hash21(vec2(ringId, 12.34))));
  float arc = smoothstep(arcWidth, 0.0,
              abs(wrapDelta(an,
                fract(hash21(vec2(ringId, 3.7)) + sweepDir * easeOutQuint(phaseR)))));

  float ringLine = smoothstep(lineW * mix(5.0, 20.0, hash21(vec2(ringId))), 0.0, d0);

  // 上下断ち切りコマ内は arc（斜め成分）を封印
  float arcMasked = arc * (1.0 - manga_bleedTB_flag);

  float aLine = clamp(
    sqrt(ringLine * arcMasked * alive * inkVis) * colorLineOpacity * (1.0 + flash),
    0.0, 1.0
  );
  
  if(overlayOn == 0){ aLine = 0.0; }

  vec3 ringCol = saturateColor(
    palPick(fract(hueBase + ringId * hueSpread + cb * 0.15)),
    uRingSat
  ) * uRingBri;

  vec3 outCol = (paletteMode == 0)
    ? mix(baseCol, ringCol, aLine)
    : mix(baseCol, 1.0 - (1.0 - baseCol) * (1.0 - ringCol), aLine);

  vec3 finalCol = applyPaletteAll(outCol, gl_FragCoord.xy);
  finalCol = applyGlitchAll(finalCol, gl_FragCoord.xy);
  if(invertPalette != 0){ finalCol = vec3(1.0) - finalCol; }
  
  gl_FragColor = vec4(finalCol, 1.0);
}
