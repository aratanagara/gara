// =====================================================
// bg_iridiscious
//   Source : Shadertoy "Iridiscious" https://www.shadertoy.com/view/3X2Bzz
//   Author : Jaenam
//   License: Creative Commons CC BY-NC-SA 4.0
//   vj ツールの bg 形式に適合 (mainImage → bg 関数 / iTime,iResolution → time,resolution
//   / bgZoom・bgCamPx でズーム/パン対応)。
// =====================================================
vec3 bg_iridiscious(vec2 fc){
  // ズーム/パン: 中心基準でスケールしてからパン
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;

  float i = 0.0, s = 14.0;
  vec4 O = vec4(0.0), q = vec4(0.0), l = vec4(0.0);

  for(; i++ < 11.0; ){
    q.xy = sin(time + s * I/resolution.y + q.yx * 2.0);
    l += 0.1 / max(dot(q = sin(q), q*4.0), 0.1);
    s *= 0.8;
    O += sin(l*vec4(3.0,2.0,1.0,1.0) + i*0.7) / s;
    l /= 4.0;
  }

  O = tanh(O*O);

  // 色相だけを差し替え、明度(輝度)は元のまま保持する。
  // tinted = 目標色相 × (元の輝度 / 目標色相の輝度)
  vec3 c = O.rgb;
  const vec3 LW = vec3(0.299, 0.587, 0.114);

  // 黄色〜暖色(低彩度のクリーム/ベージュ)部分 → ガンメタ(クールなブルーグレー)。
  float lum = dot(c, LW);
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float sat = (mx - mn) / max(mx, 1e-3);
  float warm = (c.r + c.g) * 0.5 - c.b;
  float mask = smoothstep(-0.02, 0.08, warm) * (1.0 - smoothstep(0.35, 0.70, sat));
  vec3 gunH = vec3(0.82, 0.88, 1.02);                   // クールなスチール色相
  vec3 gun  = gunH * (lum / dot(gunH, LW));             // 明度保存
  c = mix(c, gun, mask);

  // 残った黄土色/オレンジを青系に(明度保存)
  float ochre = c.r - max(c.g, c.b);
  float wm = smoothstep(0.03, 0.22, ochre);
  float l2 = dot(c, LW);
  vec3 blueH = vec3(0.35, 0.55, 1.10);
  vec3 blued = blueH * (l2 / dot(blueH, LW));
  c = mix(c, blued, wm * 0.9);

  // 水色(シアン) → 浅葱色(青緑寄りのシアン)(明度保存)
  float cyanness = min(c.g, c.b) - c.r;
  float cm = smoothstep(0.06, 0.30, cyanness);
  float l3 = dot(c, LW);
  vec3 asagiH = vec3(0.20, 0.80, 0.95);
  vec3 asagi = asagiH * (l3 / dot(asagiH, LW));
  c = mix(c, asagi, cm * 0.85);

  return clamp(c, 0.0, 1.0);
}
