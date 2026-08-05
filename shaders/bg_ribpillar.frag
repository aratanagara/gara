// =====================================================
// bg_ribpillar  (H33)
//   Source : Shadertoy "Noise Racer" https://www.shadertoy.com/view/WcVyDw
//            (motion blur trick by @FabriceNeyret2)
//   トンネル/路面のノイズ地形を飛ぶ light orb を追うレイマーチ。
//   改変: レイマーチを 64→36 段に削減して軽量化(グリッチ許容)。
//          画素ごとの時間ジッタでレトロなモーションブラー風グリッチ。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパ/グローバルは rp_ で名前空間化。
// =====================================================
#define RP_P(z) (vec3(cos((z)*.003)*128.+cos((z)*.005)*256., \
                      cos((z)*.006)*256., (z)))
#define RP_N normalize

float rp_T;
float rp_lights;

mat2 rp_r2(float a){ float s=sin(a), c=cos(a); return mat2(c,s,-s,c); }

float rp_map(vec3 p){
  vec3 q = RP_P(p.z);
  // entity (flying light orb): z を時間で前進する球
  float e = length(p - vec3(q.x + sin(rp_T*.05),
                            q.y,
                            48. + rp_T + sin(.005*rp_T)*32.)) - .001;
  rp_lights += 1e1/e;            // orb の光を蓄積

  p.xy -= q.xy;                  // パスに沿って空間を移動
  // コースをねじる + 潰す + うねらせる(カオス。穴あきOK)
  p.xy *= rp_r2(sin(p.z*0.02)*1.8 + p.z*0.013);     // ねじり(コルク栓状)
  p.x  *= 1.0 + 0.55*sin(p.z*0.03 + 1.0);           // 横方向に潰れる/伸びる
  p.y  *= 1.0 + 0.55*sin(p.z*0.04);                 // 縦方向に潰れる/伸びる
  p.x  += sin(p.z*0.06)*6.0;                         // 横うねり

  float r = 4e1 - p.y;           // 路面
  p = abs(p);                    // 角トンネルのミラー
  float t = min(4e1 - p.x, 32. - p.y);
  float s = -p.y - 26.;          // ノイズ地形
  s -= abs(dot(round(sin(.1*p + .1*p.yzx)), vec3(4.)));
  s -= abs(dot(round(sin(.1*p*0.5 + .1*p.yzx*0.5)*16.)*0.125, vec3(6.)));
  s -= abs(dot(round(sin(.07*p - .05*p.zxy)*8.)*0.22, vec3(5.)));  // 追加ノイズ(穴)
  return min(e, max(t + s*0.1, r + s));
}

vec3 bg_ribpillar(vec2 fc){
  vec2 I = (fc - resolution*0.5)/max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 u = (I - resolution*0.5)/resolution.y;

  // グリッチ: 画素ごとの時間ジッタ(モーションブラー風のレトロノイズ)
  rp_T = time*1e2 + fract(1e4*sin(dot(fc, vec2(137.0, -13.0))))*1.6;

  float i = 0.0, s, d = .4 + .5*dot(fract(sin(u)), sin(u));
  vec4 o = vec4(0.0);
  vec3 p = RP_P(rp_T), ro = p,
       Z = RP_N(RP_P(rp_T + 2.0) - p),
       X = RP_N(vec3(Z.z, 0.0, -Z.x)),
       D = vec3(u, 1.0) * mat3(-X, cross(X, Z), Z);

  rp_lights = 0.0;
  // 64 → 36 段に削減(軽量化)
  for(; i++ < 36.0 && d < 2e3;){
    p = ro + D * d;
    d += s = max(rp_map(p) * .65, .001);
    o += 6.0*vec4(1,2,5,0)*rp_lights + 1.6/s;   // 白いエッジ光を増やす
  }

  // ライン光源を赤→群青(ウルトラマリン)に
  o = tanh(o*o / 8e9 * exp(d/9e1)
     + abs(vec4(1,2,7,0) / dot(cos(p*.03), vec3(4e1))));

  vec3 col = o.rgb;

  // 白い部分にシルバー感(明部をわずかに脱色・寒色化)
  float lum = dot(col, vec3(0.3333));
  col = mix(col, vec3(lum)*vec3(0.95, 0.97, 1.02), 0.4*smoothstep(0.4, 1.0, lum));

  // 背景をメタリック(クローム)グラデに(暗部へ流す)
  float gy = clamp(u.y*0.5 + 0.5, 0.0, 1.0);
  vec3 metal = mix(vec3(0.12, 0.13, 0.17), vec3(0.52, 0.55, 0.64), smoothstep(0.0, 0.7, gy));
  metal += smoothstep(0.40, 0.50, gy) * (1.0 - smoothstep(0.50, 0.62, gy)) * vec3(0.40, 0.42, 0.48);
  col = mix(metal, col, smoothstep(0.02, 0.30, lum));

  // 奥に行くほど濃い群青(ウルトラマリン)
  float far = clamp(d / 1.1e3, 0.0, 1.0);
  col = mix(col, vec3(0.05, 0.08, 0.34), far*0.5);
  // 任意: uCosGrad で色付け
  if(abs(uCosGrad) > 0.0001){
    float tt = d*0.01;
    vec3 cg = cosGradColor(tt);
    col = mix(col, col*cg*1.6, abs(uCosGrad));
  }
  return clamp(col, 0.0, 1.0);
}
