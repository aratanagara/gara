// =====================================================
// bg_romhack  (H54)  — CD スタック(本物の 3D レイマーチ)
//   半径違いの CD(円柱)を「外周が小さいものほど高い段」に積んだ ziggurat を
//   実際に SDF レイマーチ → 段差・厚み・遮蔽が本物の立体として出る(山状)。
//   中心は1つの穴。各段の縁内側に白リング(枚数分)+ シルバー地金 + 異方性回折の虹。
//   カメラは横スピン+縦タンブルで回転。iTime,iResolution → time,resolution。
//   cosGrad 対応 / Slot B はミス(背景)透過。helpers は rh_ で名前空間化。
// =====================================================

vec4 rh_hash4(float n){
  vec4 p = fract(vec4(n)*vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p += dot(p, p.wzxy + 33.33);
  return fract((p.xxyz + p.yzzw)*p.zywx);
}
float rh_hash1(float n){ return fract(sin(n*91.345 + 7.13)*43758.5453); }

vec3 rh_hue(float t){ float h = t * 6.2831; return 0.5 + 0.5*cos(h + vec3(0.0, 0.50, 1.0)); }

// Zucconi spectral palette (Shadertoy csXSzS / alanzucconi)。物理的な虹のグラデ。
vec3 rh_bump3y(vec3 x, vec3 yoffset){ vec3 y = 1.0 - x*x; return clamp(y - yoffset, vec3(0.0), vec3(1.0)); }
vec3 rh_spectral(float x){
  x = fract(x);
  const vec3 c1 = vec3(3.54585104, 2.93225262, 2.41593945);
  const vec3 x1 = vec3(0.69549072, 0.49228336, 0.27699880);
  const vec3 y1 = vec3(0.02312639, 0.15225084, 0.52607955);
  const vec3 c2 = vec3(3.90307140, 3.21182957, 3.96587128);
  const vec3 x2 = vec3(0.11748627, 0.86755042, 0.66077860);
  const vec3 y2 = vec3(0.84897130, 0.88445281, 0.73949448);
  return rh_bump3y(c1*(x - x1), y1) + rh_bump3y(c2*(x - x2), y2);
}

// 異方性回折スペクトル
vec3 rh_diffract(float d){
  vec3 c1 = 0.5 + 0.5*cos(6.2831*(fract(d)         + vec3(0.0, 0.33, 0.67)));
  vec3 c2 = 0.5 + 0.5*cos(6.2831*(fract(d*2.0+0.2) + vec3(0.0, 0.33, 0.67)));
  return c1 + 0.35*c2;
}

const int   RH_RINGS = 8;          // CD の枚数(積む枚数)
const float RH_HUB   = 2.0/3.0;    // 白域スケール
const float RH_HOLE  = 0.087;      // スピンドル穴
const float RH_T     = 0.015;      // 1枚の厚み(段の高さ=CD くらい薄く)
const float RH_RDISC = 0.95;       // 円盤半径(ワールド)
float rh_R[RH_RINGS];              // 各 CD の外周(ワールド半径, フレーム毎に算出)
float rh_H[RH_RINGS];              // 各 CD のスタック上面 z (= rank * RH_T)

// CD k の外周(正規化 0..1)。時間で伸縮 → 段の大きさが動く。
float rh_outer(int k){
  float fk = float(k);
  vec4 h = rh_hash4(fk + 5.0);
  float span    = 1.0 - 0.34*RH_HUB;
  float baseOut = 0.34*RH_HUB + span * (0.20 + 0.80*(fk + 0.5)/float(RH_RINGS));
  float amp     = (0.10 + 0.24*h.x) * span;
  float rate    = 0.15 + 0.75*h.y;
  float phase   = h.z * 6.2831;
  float rOut = baseOut + amp*sin(time*rate + phase) + 0.5*amp*sin(time*rate*0.43 + phase*1.7);
  return clamp(rOut, 0.30, 1.0);
}

// capped cylinder SDF (軸=z, z∈[0,Hc], 半径 R)
float rh_cyl(vec3 p, float R, float Hc){
  vec2 d = vec2(length(p.xy) - R, abs(p.z - Hc*0.5) - Hc*0.5);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
// ziggurat SDF: 半径違いの円柱(CD)を rank 高さで積む + 中心穴をくり抜く
float rh_zig(vec3 p){
  float d = 1e9;
  for(int i = 0; i < RH_RINGS; i++) d = min(d, rh_cyl(p, rh_R[i], rh_H[i]));
  float hole = length(p.xy) - RH_HOLE*RH_HUB*RH_RDISC;   // 無限縦シリンダ
  return max(d, -hole);                                   // 穴をくり抜く
}
vec3 rh_zigN(vec3 p){
  vec2 e = vec2(0.0016, 0.0);
  return normalize(vec3(
    rh_zig(p+e.xyy) - rh_zig(p-e.xyy),
    rh_zig(p+e.yxy) - rh_zig(p-e.yxy),
    rh_zig(p+e.yyx) - rh_zig(p-e.yyx)));
}

// 疑似環境(クローム反射用)
vec3 rh_env(vec3 rd){
  float hgt = rd.y;
  vec3 sky    = vec3(1.05, 1.12, 1.28);                  // 明るい空(鏡像を強烈に)
  vec3 ground = vec3(0.08, 0.07, 0.11);                  // 暗い地面(高コントラスト=鏡らしさ)
  vec3 env = mix(ground, sky, smoothstep(-0.30, 0.30, hgt));
  env += vec3(0.35) * exp(-12.0*hgt*hgt);                // 地平線グロー
  vec3 L1 = normalize(vec3(cos(time*0.13), 0.55, sin(time*0.13)));
  float s1 = max(dot(rd, L1), 0.0);
  env += vec3(2.4, 2.2, 1.9) * pow(s1, 40.0);            // 強い太陽グレア
  env += vec3(0.6) * pow(s1, 6.0);
  env += vec3(3.2) * pow(s1, 280.0);                     // 鋭いホットコア(鏡面のギラり)
  vec3 L2 = normalize(vec3(cos(time*0.21+2.1), -0.30, sin(time*0.21+2.1)));
  float s2 = max(dot(rd, L2), 0.0);
  env += vec3(0.5, 0.7, 1.1) * pow(s2, 18.0);
  env += vec3(2.0) * pow(s2, 220.0);                     // もう一つの鏡面グリント
  return env;
}

vec3 bg_romhack(vec2 fc){
  vec2 I  = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 sc = (2.0*I - resolution.xy) / resolution.y;

  // カメラ回転(横スピン + 縦タンブル)
  // 回転: 2倍速 + イージングで緩急(時間を sin で歪め、角速度を速→遅に変動)
  float baseY = time*0.8;                              // 横回転(2倍速)
  float baseX = time*0.46;                             // 縦回転(2倍速)
  float aY = baseY + 0.9*sin(baseY*0.5);               // 緩急(イージング)
  float aX = baseX + 0.6*sin(baseX*0.6 + 1.3);
  vec3 cro = vec3(0.0, 0.0, 5.0);
  vec3 crd = normalize(vec3(sc, -5.0));
  float rcx = cos(aX), rsx = sin(aX);
  cro = vec3(cro.x, rcx*cro.y - rsx*cro.z, rsx*cro.y + rcx*cro.z);
  crd = vec3(crd.x, rcx*crd.y - rsx*crd.z, rsx*crd.y + rcx*crd.z);
  float rcy = cos(aY), rsy = sin(aY);
  cro = vec3(rcy*cro.x + rsy*cro.z, cro.y, -rsy*cro.x + rcy*cro.z);
  crd = vec3(rcy*crd.x + rsy*crd.z, crd.y, -rsy*crd.x + rcy*crd.z);

  // 各 CD の外周(ワールド)と rank 高さ → ziggurat を組む(外周が小=高い段)
  for(int i = 0; i < RH_RINGS; i++) rh_R[i] = rh_outer(i) * RH_RDISC;
  for(int i = 0; i < RH_RINGS; i++){
    float rank = 1.0;
    for(int j = 0; j < RH_RINGS; j++){ if(rh_R[j] > rh_R[i]) rank += 1.0; }
    rh_H[i] = rank * RH_T;
  }

  // レイマーチ
  float t = 0.0; bool hit = false; vec3 p = cro;
  for(int s = 0; s < 64; s++){
    p = cro + crd*t;
    float d = rh_zig(p);
    if(d < 0.0009){ hit = true; break; }
    t += d;
    if(t > 12.0) break;
  }
  if(!hit){ bgAlpha = 0.0; return vec3(0.0); }

  vec3 nor = rh_zigN(p);
  float r   = length(p.xy);
  float rn  = r / RH_RDISC;
  float ang = atan(p.y, p.x);
  vec2  rdir = (r > 1e-4) ? p.xy/r : vec2(1.0, 0.0);
  float rData = 0.34 * RH_HUB;

  float topFace  = smoothstep(0.25, 0.75, nor.z);          // 上面(段の天面)
  float sideFace = smoothstep(0.5, 0.15, nor.z);           // 側面(段の厚み=縦壁)
  float backSide = step(nor.z, -0.25);                     // 下面=ラベル

  // ── 移動するライト(ハイライト + グラデの掃引に使う) ──
  float lt = time*0.35;
  float lseg = floor(lt);
  float lf = smoothstep(0.0, 1.0, fract(lt));
  vec2 lp = mix(rh_hash4(lseg+1.0).xy, rh_hash4(lseg+2.0).xy, lf)*2.0 - 1.0;  // -1..1 を補間
  vec3 Lw = normalize(vec3(lp*1.3, 0.9));
  float lAng = atan(Lw.y, Lw.x);                            // 光源の角度

  // ── シルバー地金(バックの虹グラデのベース) ──
  vec3 silver = vec3(0.80);                                // 明るい金属シルバー

  // 放射状: シルバー帯3 + 虹帯3 を sin で滑らかに繋ぐ。光源に連動して掃引・回転する。
  vec3 bandCol = silver;
  {
    float a   = ang/6.2831853 + 0.5;                        // 0..1 周回
    float lit = 0.5 + 0.5*dot(rdir, Lw.xy);                 // 光源を向く側で虹が強く出る
    float hue = a*3.0 + lAng*0.6 - time*0.05;               // 光源角で虹を掃引(継ぎ目なし)
    vec3 rainbow = rh_spectral(hue);
    rainbow = mix(rainbow, vec3(1.0), 0.08);
    vec3 gradCol = silver + (rainbow - 0.5) * (0.35 + 0.40*lit);  // シルバーに虹を加減算(明るさ維持・光源側ほど鮮やか)
    float blend = 0.5 + 0.5*sin(a*6.2831853*3.0 + lAng*1.2 - time*0.3);  // 帯も光源で回転
    bandCol = mix(silver, gradCol, blend);                  // シルバー⇄虹 を滑らかに繋ぐ
  }
  // ── フロント(山側)= CD-R のような白 / バック(平らな面)= 高品質の放射状虹グラデ ──
  vec3 frontAlbedo = vec3(0.88) + 0.04*pow(abs(rdir.y), 3.0);  // CD-R の白い天面
  vec3 albedo = mix(frontAlbedo, bandCol, backSide);          // 裏=シルバー/虹の滑らかなグラデ

  // 各段の縁の黒ボンディング線(フロントの段の区切り)
  float bond = 0.0;
  for(int i = 0; i < RH_RINGS; i++){
    float edge = rh_R[i] / RH_RDISC;
    bond = max(bond, smoothstep(0.009, 0.0, abs(rn - (edge - 0.010))));
  }
  albedo = mix(albedo, vec3(0.08), bond * topFace * (1.0 - backSide));

  // ── ライティング(本物の法線) ──
  vec3 V = normalize(cro - p);
  float dif = 0.45 + 0.60*max(dot(nor, Lw), 0.0);             // 明るめ
  vec3 Rfl = reflect(-V, nor);
  vec3 env = rh_env(Rfl);
  float fres = pow(1.0 - max(dot(nor, V), 0.0), 3.0);
  vec3 Hh = normalize(Lw + V);
  float spec = pow(max(dot(nor, Hh), 0.0), 44.0);

  // ── 異方性回折の虹(裏の虹面に重ねる) ──
  float rd = clamp((rn - rData)/max(1.0 - rData, 1e-4), 0.0, 1.0);
  vec2 tang = vec2(-rdir.y, rdir.x);
  vec2 Lxy = normalize(Lw.xy + 1e-4);
  float grooveDensity = 24.0 + 70.0*rd;
  vec3 spectrum = rh_diffract(ang*0.5 + dot(Lxy, tang)*2.5 + rd*grooveDensity*0.16);
  spectrum = mix(spectrum, vec3(1.0), 0.25);
  float aniso = pow(abs(dot(tang, vec2(-Lxy.y, Lxy.x))), 1.5);
  float fan = smoothstep(0.45, 1.0, 0.5 + 0.5*sin(ang*4.0 + rn*8.0));
  float NdotH = max(dot(nor, Hh), 0.0);
  float diffAmt = aniso * fan * smoothstep(0.0, 0.1, rn) * (0.4 + 0.9*pow(NdotH, 4.0)) * backSide;

  vec3 color = albedo * dif;
  vec3 envSilver = env * vec3(0.97, 0.98, 1.0);                // 反射環境を僅かにシルバー寄りに
  // 裏面は CD の鏡面: 環境をほぼ完全反射(やりすぎなくらい)。グラデは反射像に薄く乗せる。
  float reflAmt = mix(0.34 + 0.42*fres, 0.94 + 0.06*fres, backSide);   // 裏=ほぼ完全な鏡
  vec3 reflCol  = envSilver * mix(vec3(1.0), bandCol*1.45, 0.45*backSide);  // 鏡像に虹/シルバーを乗せる
  color = mix(color, reflCol, reflAmt);
  color += spectrum * diffAmt * 0.16;                           // 裏の異方性虹
  color += vec3(0.9, 0.93, 1.0) * spec * mix(1.5, 2.2, backSide); // 裏は強いハイライト(クロームのギラつき)
  // ── CD 的な強烈な反射の筋(円周溝に直交する異方性ハイライト=放射状に走る鏡面筋) ──
  vec3 Tn = normalize(vec3(tang, 0.0001));
  float aniH = dot(Tn, Hh);
  float streak = pow(clamp(1.0 - aniH*aniH, 0.0, 1.0), 70.0);   // 鋭い放射状の筋
  float streakLobe = pow(max(dot(nor, Hh), 0.0), 2.5);          // ライト側に限定
  color += vec3(1.0, 1.0, 1.05) * streak * streakLobe * 5.0 * backSide;  // 強烈に反射する筋
  color *= mix(1.0, 0.6, sideFace);                            // 段の側面(厚み)を暗く=立体
  color = clamp(color * 1.12, 0.0, 1.0);                       // 全体を明るく

  if(abs(uCosGrad) > 0.0001){
    float lum = dot(color, vec3(0.299, 0.587, 0.114));
    vec3 graded = cosGradColor(lum) * (0.2 + 1.2*lum);
    graded += vec3(0.7) * spec * 0.6;
    graded = mix(graded, vec3(1.0), spec*0.4);
    color = mix(color, clamp(graded, 0.0, 1.0), abs(uCosGrad));
  }

  // ── 中央のクリア(半透明)領域: 放射グラデで塗り潰さず、下が透けるようにする ──
  float clearMask = clamp(smoothstep(rData+0.04, rData-0.04, rn), 0.0, 1.0);
  color = mix(color, vec3(0.05, 0.07, 0.11), clearMask*0.7);                          // 中央は暗いガラス質(塗り潰さない)
  bgAlpha = 1.0 - clearMask * 0.78;                                                    // 中央をしっかり透過(下が透ける)
  return color;
}
