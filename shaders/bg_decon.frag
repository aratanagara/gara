// =====================================================
// bg_decon
//   Source : Shadertoy "jms_decon_study" https://www.shadertoy.com/view/ssdGRs
//   マトリックス風コードレイン。元はフォントatlas(iChannel0)とノイズ(iChannel1)を
//   使用するが、手続き生成のグリフ/ノイズで代替して単体化。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは dc_ で名前空間化。
// =====================================================
float dc_rand(float a){ return fract(cos(sin(a))); }
float dc_hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float dc_noise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  float a=dc_hash(i), b=dc_hash(i+vec2(1,0)), c=dc_hash(i+vec2(0,1)), d=dc_hash(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}

// 縦に流れるコードの帯(緑のストリーク)
vec3 dc_codeLines(vec2 fc, float reps, vec3 baseCol, float sm){
  fc.x -= mod(fc.x, reps);
  float offset = sin(fc.x*15.0);
  float speed  = cos(fc.x)*0.1 + sm;
  float vrep   = dc_rand(fc.x);
  float y = fract((fc.y/resolution.y)*vrep + offset + time*speed);
  return baseCol / (y*20.0);
}

// 手続き的グリフ(フォントatlas の代替)。セルごとに時間で切り替わる文字状パターン
float dc_chars(vec2 fc, float reps){
  vec2 cell = floor(fc/reps);
  vec2 luv  = fract(fc/reps);
  float gid = floor(dc_noise(cell*0.7 + floor(time*3.0)*0.13) * 48.0);
  vec2 sub  = floor(luv*5.0);                              // 5x5 のドットグリッド
  float on  = step(0.45, dc_hash(sub + gid*9.1));
  float margin = step(0.06,luv.x)*step(luv.x,0.94)*step(0.06,luv.y)*step(luv.y,0.94);
  return on * margin;
}

vec3 bg_decon(vec2 fc){
  vec2 I0 = (fc - resolution*0.5) / max(bgZoom, 0.001);
  I0 *= 1.3333;                                       // 拡大率を75%に(パターンを縮小)
  vec2 I  = I0 + resolution*0.5 + bgCamPx;
  vec2 uv = I / resolution;

  vec3 col  = dc_codeLines(I, 4.0, vec3(.2,.8,.2),  .15) * dc_chars(I, 8.0);
  col      += dc_codeLines(I, 8.0, vec3(.05,.75,.25), .25) * dc_chars(I, 16.0);

  // iChannel1 の色変調の代替(ノイズで明滅)
  vec3 nz = vec3(dc_noise(uv*8.0 + time*0.10),
                 dc_noise(uv*8.0 + 5.0 + time*0.10),
                 dc_noise(uv*8.0 + 9.0));
  col *= nz * 2.0;

  bgAlpha = clamp(dot(col, vec3(0.299, 0.587, 0.114)) * 1.5, 0.0, 1.0);  // 文字=不透明 / 隙間=透明
  col = vec3(dot(col, vec3(0.299, 0.587, 0.114)));                       // グレースケール
  return col;
}
