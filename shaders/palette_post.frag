// =====================================================
// global palette mode
// =====================================================
float luma709(vec3 c){
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 applyTwoColor(vec3 c, vec3 c0, vec3 c1, vec2 fc){
  float l = luma709(c);
  float d = bayer4(fc);
  float t = 0.5 + (d - 0.5) * 0.10;
  float k = step(t, l);
  return mix(c0, c1, k);
}

vec3 applyMangaTone(vec3 c, vec2 fc){
  float l = luma709(c);
  const float CONTRAST = 2.6;
  l = clamp((l - 0.5) * CONTRAST + 0.5, 0.0, 1.0);
  l = smoothstep(0.32, 0.78, l);
  const float DOT_SIZE = 3.0;
  vec2 cell = floor(fc / DOT_SIZE);
  vec2 f = fract(fc / DOT_SIZE) - 0.5;
  float d = bayer4(cell * DOT_SIZE) - 0.5;
  float l2 = clamp(l + d * 0.06, 0.0, 1.0);
  float radius = (1.0 - l2) * 0.52;
  float dist = length(f);
  float dot = step(dist, radius);
  float v = mix(1.0, 0.0, dot);
  return vec3(v);
}

vec3 applyPaletteAll(vec3 col, vec2 fc){
  if(paletteMode == 0) return col;
  if(paletteMode == 1){
    vec3 bg = vec3(0.56, 0.61, 0.70);
    vec3 fg = vec3(0.82, 0.00, 0.00);
    if(switchPalette != 0){vec3 temp=bg;bg=fg;fg=temp;}
    return applyTwoColor(col, bg, fg, fc);
  }
  if(paletteMode == 2){
    vec3 bg = vec3(0.00, 0.38, 1.00);
    vec3 fg = vec3(0.10, 0.78, 0.18);
    if(switchPalette != 0){vec3 temp=bg;bg=fg;fg=temp;}
    return applyTwoColor(col, bg, fg, fc);
  }
  if(paletteMode == 3){
    vec3 bg = vec3(0.84, 0.30, 0.86);
    vec3 fg = vec3(0.90, 0.78, 0.02);
    if(switchPalette != 0){vec3 temp=bg;bg=fg;fg=temp;}
    return applyTwoColor(col, bg, fg, fc);
  }
  if(paletteMode == 5){ return vec3(1.0) - col; }
  return applyMangaTone(col, fc);
}

// =====================================================
// glitch
