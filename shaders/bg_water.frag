// =====================================================
// bg_water
//   Source : Shadertoy https://www.shadertoy.com/view/NdVXDd  by Alex Kluchikov
//   フロー模様をベースに「透明な水」風へ加工 (深い青緑→淡いシアンのグラデ +
//   コースティクスのきらめき + グリント)。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン対応。
//   ヘルパは wk_ で名前空間化。
// =====================================================
#define WK_PI 3.141592654
vec2 wk_rot(vec2 p, float a){
  float c = cos(a*15.83);
  float s = sin(a*15.83);
  return p * mat2(s, c, c, -s);
}
vec3 bg_water(vec2 fc){
  // ズーム/パン
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = I / resolution.xx;
  uv = vec2(.125, .75) + (uv - vec2(.125, .75)) * .03;
  float T = time * .65;

  vec3 c = clamp(1. - .7*vec3(
      length(uv - vec2(.1, 0)),
      length(uv - vec2(.9, 0)),
      length(uv - vec2(.5, 1))
      ), 0., 1.) * 2. - 1.;

  vec3 c0 = vec3(0);
  float w0 = 0.;
  const float N = 30.;
  for(float i = 0.; i < N; i++){
    float wt = (i*i/N/N - .2) * .3;
    float wp = 0.5 + (i + 1.)*(i + 1.5)*0.001;
    float wb = .05 + i/N*0.1;
    c.zx = wk_rot(c.zx, 0.1 + T*0.1*wt + (uv.x + .7)*23.*wp);
    c.xy = wk_rot(c.xy, c.z*c.x*wb + 1.7 + T*wt + (uv.y + 1.1)*15.*wp);
    c.yz = wk_rot(c.yz, c.x*c.y*wb + 2.4 - T*0.79*wt + (uv.x + uv.y*(fract(i/2.) - 0.25)*4.)*17.*wp);
    c.zx = wk_rot(c.zx, c.y*c.z*wb + 1.6 - T*0.65*wt + (uv.x + .7)*23.*wp);
    float w = (100.5 - i/N);
    c0 += c*w;
    w0 += w;
  }
  c0 = c0/w0*2. + .5;
  c0 *= .5 + dot(c0, vec3(1,1,1))/sqrt(3.)*.5;
  c0 += pow(length(sin(c0*WK_PI*4.))/sqrt(3.)*1.0, 20.) * (.3 + .7*c0);

  // === 白黒の水(明るめ) ===
  c0 = clamp(c0, 0.0, 1.5);
  float L = dot(c0, vec3(0.299, 0.587, 0.114));
  float g = smoothstep(0.0, 0.85, L);
  g = 0.40 + 0.60 * g;                                    // 明度を持ち上げて明るく
  g += pow(clamp(L, 0.0, 1.0), 5.0) * 0.5;                // コースティクス(明るい筋)
  g += pow(clamp((L - 0.70)/0.30, 0.0, 1.0), 3.0) * 0.6;  // 鋭いきらめき
  bgAlpha = clamp(g * 0.8, 0.0, 0.78);                     // 半透明の水(暗い谷ほど透ける)
  return vec3(clamp(g, 0.0, 1.0));
}
