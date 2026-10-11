// =====================================================
// bg_ribbon  (H40)
//   Source : Shadertoy "Reflective Ribbon" https://www.shadertoy.com/view/33yczz
//            (c) Frostbyte (CC BY-NC-SA 4.0)。反射するリボン状の発光フィールド。
//   改変: 引き(ズームアウト) / 背景をシルバーグレーに / 構図を若干右上へ。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
// =====================================================

vec3 bg_ribbon(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec3 r = vec3(resolution, 1.0), p = vec3(0.0);
  float t = time, i = 0.0, s = 0.0, d = 0.0;
  vec2 uv = (I - 0.5*r.xy) / r.y;
  float rot = time*0.25;                                       // 画面中心(uv=0)を起点に回転
  uv = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * uv;
  uv = uv*2.8 + vec2(-0.7, -0.45);  // 引き(×2.8, 全体が見える) + 右上へ

  vec4 o = vec4(0.0);
  for(o *= i; i++ < 100.0; p = 1.5*vec3(uv*d, d + t)){
    s = 5e-3 + abs(s)*0.07;
    d += s;
    o += (1.0 + sin(i*0.5 + 1.5*vec4(3, 1.5, 1, 0)))/s
       + vec4(1, 1, 3, 1) / length(uv + vec2(0.0, -0.7));
    p.xy *= mat2(cos(d*0.1 - 4.0 - vec4(0, 11, 33, 0)));
    s += cos(p.x + p.y)*2.0 + 1.5 + abs(dot(0.2*sin(vec3(p.xy*1.5, p.z + t*5.0)), vec3(0, 9, 2)));
  }
  o = tanh(o*o/3e7);

  // 彩度を下げ、寒色を足して銀調に → 地は黒 (entrypoint が uBgColor で塗る)
  vec3 col = o.rgb;
  float lum = dot(col, vec3(0.3333));
  col = mix(vec3(lum), col, 0.35);                         // 彩度を落としてシルバー寄りに
  col *= vec3(0.98, 0.99, 1.03);                           // 銀のわずかな寒色
  col *= smoothstep(0.0, 0.22, lum);        // 地を黒に落とす
  bgAlpha = smoothstep(0.0, 0.22, lum);     // 地は透過(リボンのみ残す)
  return clamp(col, 0.0, 1.0);
}
