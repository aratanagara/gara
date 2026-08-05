vec3 bg_inkelly(vec2 fc){
  float bt = getBeat();
  float ph = isFree() ? fract(bt * 0.25) : fract(bt);
  float ease = easeOutQuint(ph);
  vec2 uv = fc / resolution;
  vec2 uvm = uvCover(uv, resolution, texSize);
  float mask = 0.0;
  if(uvm.x>=0.0 && uvm.x<=1.0 && uvm.y>=0.0 && uvm.y<=1.0){
    mask = texture2D(tex1, uvm).r;
    mask = smoothstep(0.2, 0.8, mask);
  }
  float m = texture2D(bgExtra, uv).r * mask;
  float th = isFree() ? (0.50 + 0.06 * sin(bt * 0.80)) : mix(0.42, 0.58, ease);
  vec2 px = vec2(1.0 / resolution.x, 1.0 / resolution.y);
  float mR = texture2D(bgExtra, uv + vec2(px.x, 0.0)).r * mask;
  float mL = texture2D(bgExtra, uv - vec2(px.x, 0.0)).r * mask;
  float mU = texture2D(bgExtra, uv + vec2(0.0, px.y)).r * mask;
  float mD = texture2D(bgExtra, uv - vec2(0.0, px.y)).r * mask;
  m = smoothstep(th - 0.008, th + 0.008, m);
  float edge = abs(mR - mL) + abs(mU - mD);
  edge = pow(edge, 0.65);
  edge *= mix(2.8, 3.0, ease);
  edge = max(edge - 0.5, 0.0);
  float ink = step(0.03, edge);
  vec3 paper = vec3(0.91, 0.94, 0.91);
  vec3 inkCol = vec3(0.02);
  vec3 col = paper;
  col = mix(col, inkCol, ink);
  return col;
}

