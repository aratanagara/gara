// =====================================================
// bg_rainbowWater
//   Source : Shadertoy "rainbow water" https://www.shadertoy.com/view/dtySRR
//   Author : flylo
//   元シェーダは Buffer A が本体 (Image パスは素通しコピー) なので Buffer A を移植。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン対応。
//   ヘルパは rw_ で名前空間化。
// =====================================================
vec3 rw_pools(in vec2 uv){
  float dt  = .5+.5*sin(.18*time);
  float dt2 = .5+.5*sin(.038*time);
  float mdt  = .2+.8*dt;
  float mdt2 = .7+.3*dt2;

  float dt3 = .5+.5*sin(.14*time);
  float dt4 = .5+.5*sin(.033*time);
  float mdt3 = .2+.8*dt3;
  float mdt4 = .7+.3*dt4;

  float dt5 = .5+.5*sin(.11*time);
  float dt6 = .5+.5*sin(1.5+.036*time);
  float mdt5 = .2+.8*dt5;
  float mdt6 = .7+.3*dt6;

  vec3 c = vec3(0.0);
  float a = 1.0;
  float f = 1.0;
  float as = 0.0;
  for(int j = 0; j < 25; j++){
    f = 2.0*(1.0+.3*float(j));
    a = 1.0/(pow(1.23, float(j)));
    float r2 = length(uv - vec2(sin(142.31*float(j)), sin(29.321*float(j))));
    c.r += mdt *1.4*a*(.5+.5*sin(7.*time + f*mdt2*7.1*r2));
    c.g += mdt3*1.4*a*(.5+.5*sin(7.*time + f*mdt4*7.1*r2));
    c.b += mdt5*1.4*a*(.5+.5*sin(7.*time + f*mdt6*7.1*r2));
    as += a;
  }
  c /= as;
  return c;
}
vec3 rw_warp(in vec2 uv){
  vec3 c = rw_pools(uv);
  int iter = 5;
  float amp = .55;
  float f = .9;
  float a = 1.0;
  for(int i = 0; i < iter; i++){ a *= amp; }
  for(int i = 0; i < iter; i++){
    a /= amp;
    f *= 1.2;
    c = a*rw_pools(uv + f*vec2(c.r-c.g, c.g-c.b));
  }
  return c;
}
vec3 bg_rainbowWater(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = I / resolution.xy;
  vec3 c0 = rw_warp(uv);

  // === H18 と同じ水(透明・白黒・明るめ)処理 ===
  c0 = clamp(c0, 0.0, 1.5);
  float L = dot(c0, vec3(0.299, 0.587, 0.114));
  float g = smoothstep(0.0, 0.85, L);
  g = 0.40 + 0.60 * g;                                    // 明度を持ち上げて明るく
  g += pow(clamp(L, 0.0, 1.0), 5.0) * 0.5;                // コースティクス(明るい筋)
  g += pow(clamp((L - 0.70)/0.30, 0.0, 1.0), 3.0) * 0.6;  // 鋭いきらめき
  bgAlpha = clamp(g * 0.8, 0.0, 0.78);                     // 半透明の水(暗い谷ほど透ける)
  return vec3(clamp(g, 0.0, 1.0));
}
