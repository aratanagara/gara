// =====================================================
// Source : https://www.shadertoy.com/view/tclBzs
// bg_jflow  (H60)  — 取り込み+書き直し: "julibob tunnel" (Shadertoy tclBzs) を改変。
//   原典は Julia 集合の bob を奥行きに並べた "トンネル"。これを書き直し、
//   トンネルをやめて「ランダムな Julia 結晶が横(右→左)に流れていく」フィールドに。
//   複素数演算(jf_cmul/jf_R/jf_Q/jf_C)と HSV カラー(jf_H)、エスケープ反復は原典を踏襲。
//   各結晶は固有の位置/速度/スケール/回転/カーディオイド c を持ち、時間で形が変化。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx 対応。
//   cosineGradient(uCosGrad)対応 / Slot B は結晶部分のみ表示(背景透過)。
// =====================================================

const int   JF_N    = 12;     // 結晶の数
const int   JF_ITER = 30;     // Julia 反復数

vec2 jf_cmul(vec2 a, vec2 b){ return mat2(a.x, a.y, -a.y, a.x) * b; }   // 複素数の積
vec2 jf_R(float a){ return vec2(cos(a), sin(a)); }                      // 単位複素数
vec2 jf_Q(vec2 z){ return pow(length(z), 0.5) * jf_R(0.5*atan(z.y, z.x)); } // 複素平方根
vec2 jf_C(vec2 s){ return (s + s - jf_cmul(s, s)) * 0.25; }             // カーディオイド c
vec2 jf_rot(vec2 p, float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c)*p; }

// HSV風: 色相 h / 彩度 s / 明度 q
vec3 jf_H(float h, float s, float q){
  return q * mix(vec3(1.0), clamp(abs(6.0*fract(h + vec3(3,2,1)/3.0) - 3.0) - 1.0, 0.0, 1.0), s);
}

vec4 jf_hash4(float n){
  vec4 p = fract(vec4(n)*vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p += dot(p, p.wzxy + 33.33);
  return fract((p.xxyz + p.yzzw)*p.zywx);
}

// @param uCount     3..12 = 12.0
// @param uDetail    8..30 = 30.0
// @param uWarp      0..300 = 100.0
// @param uGlow      0..250 = 100.0
// @param uHueSpread 0..500 = 100.0
// @param uSize 40..130 = 100.0
// @param uAngle -180..180 = 0.0
uniform float uCount; // 結晶の数 (下げると軽く、まばらになる)
uniform float uDetail; // Julia 反復数 (下げると軽く、結晶が粗くなる)
uniform float uWarp; // 結晶の歪み (%)
uniform float uGlow; // 白いフィラメントの明るさ (%)
uniform float uHueSpread; // 結晶内の色相のばらつき (%)
uniform float uSize; // 結晶ひとつの大きさ (%)
uniform float uAngle; // 向き (度。固定角でずらす)
// @param uLanes      50..130  = 100.0
// @param uSizeSpread 80..200  = 100.0
// @param uStretch    60..140  = 100.0
// @param uJuliaZoom  70..130  = 100.0
// @param uCWobble    0..300   = 100.0
// @param uTwistAmt   0..250   = 100.0
// @param uWarpFreq   40..250  = 100.0
// @param uShardAmt   0..170   = 100.0
// @param uGiantSize  40..115  = 100.0
// @param uRimSoft    20..160  = 100.0
// @param uBoundary   50..140  = 100.0
// @param uFacet      40..250  = 100.0
// @param uFilament   30..300  = 100.0
// @param uFlowTilt -60..60 = 0
// @param uLaneShift -60..60 = 0
// @param uBob 0..600 = 100
// @param uCounterFlow 0..100 = 0
// @param uEdgeFade 0..100 = 0
// @param uBodySat 20..150 = 85
// @param uAmbient 0..300 = 100
// @param uBodyShade 0..250 = 100
// @param uLightSwing 0..300 = 100
// @param uLightHeight 0..200 = 100
// @param uSpecHard 30..300 = 100
// @param uSpecAmt 0..400 = 100
// @param uDomeFlat 0..250 = 100
// @param uRidgeAmt 0..400 = 100
// @param uRidgeCut -30..30 = 0
// @param uBodyColor color = #ffffff
// @param uFilamentColor color = #ffffff
// @param uRidgeColor color = #ffffff
// @param uVoidColor color = #ffffff
uniform float uLanes; // 結晶が散らばる縦の範囲 (%)
uniform float uSizeSpread; // 大きさの偏り (%)。下げると大きな結晶が増え、上げると微小な結晶ばかりになる
uniform float uStretch; // 結晶の流れ方向の伸び (%)。下げると横に引き伸ばされる
uniform float uJuliaZoom; // Julia 集合を覗く倍率 (%)。形の切り取り方が変わる
uniform float uCWobble; // Julia の定数 c の揺れ幅 (%)。0 で形の変化が穏やかに
uniform float uTwistAmt; // 結晶のひねり (%)
uniform float uWarpFreq; // 歪みの波の細かさ (%)
uniform float uShardAmt; // 欠片になる結晶の割合 (%)。0 で全部欠片、上げると完全な結晶が増える
uniform float uGiantSize; // 巨大な結晶の最大サイズ (%)
uniform float uRimSoft; // 結晶の輪郭のにじみ (%)。下げると外周がくっきり切れる
uniform float uBoundary; // 結晶の縁の厚み (%)。上げると外側の脱出域まで残る
uniform float uFacet; // 縁の稜線の本数 (%)
uniform float uFilament; // 内部のフィラメントの太さ (%)
uniform float uFlowTilt; // 流れる向きの傾き (度)。0 で右から左へ水平
uniform float uLaneShift; // 結晶の流れる帯の上下位置 (%)
uniform float uBob; // 結晶の上下のゆらぎの振れ幅 (%)
uniform float uCounterFlow; // 逆向きに流れる結晶の割合 (%)
uniform float uEdgeFade; // 画面の左右端で結晶が消える度合い (%)
uniform float uBodySat; // 結晶本体の青の彩度 (%)
uniform float uAmbient; // 影側の結晶本体の明るさ (%)
uniform float uBodyShade; // 結晶本体の陰影の強さ (%)
uniform float uLightSwing; // 光源の左右の振れ幅 (%)
uniform float uLightHeight; // 光源の高さ (%)。上げると正面から照らす
uniform float uSpecHard; // ハイライトの鋭さ (%)
uniform float uSpecAmt; // ハイライトの強さ (%)
uniform float uDomeFlat; // 結晶のドーム状の膨らみ (%)。下げると平たく見える
uniform float uRidgeAmt; // 縁の稜線の明るさ (%)
uniform float uRidgeCut; // 稜線の出る位置のずらし (%)。正で細く、負で太く
uniform vec3 uBodyColor; // 結晶本体の色 (ティント)
uniform vec3 uFilamentColor; // 白いフィラメントの色 (ティント)
uniform vec3 uRidgeColor; // 縁の稜線の色 (ティント)
uniform vec3 uVoidColor; // 暗い背景の色 (ティント)

vec3 bg_jflow(vec2 fc){
  vec2 I  = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = (2.0*I - resolution.xy) / resolution.y;        // x:[-asp,asp] y:[-1,1]
  if(uFlowTilt != 0.0){ uv = jf_rot(uv, radians(uFlowTilt)); }
  float asp = resolution.x / resolution.y;
  float T = time;
  int nIt = int(uDetail + 0.5);

  vec3 col = vec3(0.015, 0.02, 0.04) * uVoidColor;         // 暗い背景
  float cov = 0.0;                                         // 結晶カバレッジ(透過用)

  for(int i = 0; i < JF_N; i++){
    if(i >= int(uCount + 0.5)) break;
    vec4  rnd  = jf_hash4(float(i)*1.7 + 3.0);
    vec4  rnd2 = jf_hash4(float(i)*2.9 + 11.0);
    float yc    = (rnd.x*2.0 - 1.0) * 0.86 * (uLanes / 100.0);                // 縦レーン
    float scale = (0.04 + 2.3*(uGiantSize / 100.0)*pow(rnd.y, 3.0 * (uSizeSpread / 100.0))) * (uSize / 100.0);            // 大きさ(極端: 微小多数+まれに画面横切る巨大)
    float speed = 0.26 + 0.85*rnd.z;                       // 流れる速さ(スピード感)
    float spin  = (rnd.w - 0.5) * 2.4;                     // 自転(速め)
    float span  = 2.0*asp + 1.8;                           // 画面外まで含む幅
    // 右(+)から左(-)へ流れ、端で巻き戻す
    float xc = (asp + 0.9) - mod(T*speed + rnd.x*span, span);
    if(uCounterFlow != 0.0 && rnd2.w * 100.0 < uCounterFlow){ xc = -xc; }
    float yb = yc + 0.05*(uBob / 100.0)*sin(T*(0.6 + rnd.w) + float(i));  // ゆらぎ
    if(uLaneShift != 0.0){ yb += uLaneShift / 100.0; }
    float shard = step(0.58 * (uShardAmt / 100.0), rnd2.x);                      // 一部は欠片(破断面でカット)

    vec2 d = uv - vec2(xc, yb);
    if(dot(d, d) > (scale*1.85)*(scale*1.85)) continue;    // 遠い結晶は早期スキップ

    vec2 p = jf_rot(d/scale, T*spin + rnd.y*6.2831 + radians(uAngle));
    p.x *= 0.82 * (uStretch / 100.0);                                           // 流れ方向にややストレッチ(スピード感)
    // ワープ + ねじれ: 中心からの距離でひねり、ドメインワープで不規則化(刻々と変形)
    float tw = (0.8 + 1.4*rnd.z) * sin(T*0.9 + rnd.x*6.0);
    vec2  pw = jf_rot(p, tw * (uTwistAmt / 100.0) * length(p));
    pw += 0.22*(uWarp / 100.0)*sin(pw.yx*3.4*(uWarpFreq / 100.0) + T*1.8 + rnd.w*6.2831);
    // Julia: c を速めにカーディオイド上で morph(結晶が刻々と変形)
    vec2 z = pw * 1.18 * (uJuliaZoom / 100.0);
    vec2 c = jf_C(jf_R(T*1.2 + float(i)*0.7)) * (1.0 + 0.10*(uCWobble / 100.0)*sin(T*1.3 + float(i)));
    float k = 0.0;
    float trap = 1e9;                                      // オービットトラップ(内部のフラクタル模様)
    for(int it = 0; it < JF_ITER; it++){
      if(it >= nIt) break;
      if(dot(z, z) > 4.0) break;
      z = jf_cmul(z, z) + c;
      trap = min(trap, min(abs(z.x), abs(z.y)));           // 軌道が軸に最接近=フィラメント
      k += 1.0;
    }
    float esc    = k / float(nIt);
    float inside = step(float(nIt) - 0.5, k);          // 脱出しない=結晶本体
    // 形マスク: 境界付近のみ残す(外側のすぐ脱出域は消す=シャープな結晶輪郭)
    float shape  = inside + (1.0 - inside) * smoothstep(0.10, 0.55 * (uBoundary / 100.0), esc);
    float radial = smoothstep(1.8, 0.5 * (uRimSoft / 100.0), length(p));        // 結晶の輪郭にクランプ
    if(shard > 0.5){                                       // 欠片: 片側を破断面でカット
      vec2 cn = jf_rot(vec2(1.0, 0.0), rnd2.y*6.2831);
      float cut = dot(p, cn) - (rnd2.z - 0.5)*1.4;
      radial *= smoothstep(0.0, 0.22, -cut);
    }
    float amt = shape * radial;
    if(uEdgeFade != 0.0){ amt *= 1.0 - (uEdgeFade / 100.0) * smoothstep(asp * 0.5, asp + 0.6, abs(xc)); }
    if(amt <= 0.001) continue;

    // 中の模様 = オービットトラップの内部フィラメント + エスケープ等高線(デンドライト)
    float pat   = 1.0 - smoothstep(0.0, 0.16 * (uFilament / 100.0), trap);       // 内部のフラクタル模様(明るい筋)
    float facet = abs(fract(k*0.2*(uFacet / 100.0)) * 2.0 - 1.0);           // 5反復ごとの稜線(境界)
    float ridge;
    if(uRidgeCut != 0.0){ ridge = smoothstep(0.35 + uRidgeCut / 100.0, 0.95, facet) * (1.0 - inside); }
    else ridge = smoothstep(0.35, 0.95, facet) * (1.0 - inside);

    // 立体感は控えめ + 鋭く小さいハイライト。発光させずコントラストで見せる(H17 のバランス)。
    float rr   = clamp(length(p)/1.8, 0.0, 1.0);
    float dome = sqrt(1.0 - rr*rr);
    vec3  Nn   = normalize(vec3(p/1.8, dome + 0.30));
    if(uDomeFlat != 100.0){ Nn = normalize(vec3(p/1.8, dome * (uDomeFlat / 100.0) + 0.30)); }
    vec3  Ll   = normalize(vec3(0.5*cos(T*0.6), 0.55, 0.72));
    if(uLightSwing != 100.0 || uLightHeight != 100.0){ Ll = normalize(vec3(0.5*(uLightSwing / 100.0)*cos(T*0.6), 0.55*(uLightHeight / 100.0), 0.72)); }
    float dif  = clamp(dot(Nn, Ll), 0.0, 1.0);
    float spec;
    if(uSpecHard != 100.0){ spec = pow(clamp(dot(reflect(-Ll, Nn), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 48.0 * uSpecHard / 100.0); }
    else spec = pow(clamp(dot(reflect(-Ll, Nn), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 48.0);

    float hue = 0.695 + 0.03*rnd.y - 0.04*(uHueSpread / 100.0)*esc;            // 青(#3f00ff 寄りの藍青)
    vec3  base= jf_H(hue, 0.85, 1.0);
    if(uBodySat != 85.0){ base = jf_H(hue, uBodySat / 100.0, 1.0); }
    base *= uBodyColor;
    vec3  cc  = base * (0.16 + 0.42*dif);
    if(uAmbient != 100.0 || uBodyShade != 100.0){ cc = base * (0.16*(uAmbient / 100.0) + 0.42*(uBodyShade / 100.0)*dif); }                 // 青のボディ(陰影はここだけ)
    cc += vec3(0.90, 0.95, 1.0) * uFilamentColor * pat * 0.95 * (uGlow / 100.0);             // 白い結晶フィラメント(ライティング非依存で加算)
    cc += vec3(0.85, 0.93, 1.0) * uRidgeColor * ridge * (0.30 * (uRidgeAmt / 100.0));          // 境界デンドライト
    cc += spec * vec3(0.90, 0.97, 1.0) * (0.35 * (uSpecAmt / 100.0));           // 鋭く小さいハイライト
    col = max(col, cc * amt);                              // 明るい方を採用
    cov = max(cov, amt);
  }

  col = pow(col, vec3(0.85));                              // 軽いトーン

  if(abs(uCosGrad) > 0.0001){
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, cosGradColor(lum) * (0.3 + 1.3*lum), abs(uCosGrad));
  }

  bgAlpha = clamp(cov, 0.0, 1.0); // Slot B は結晶のみ
  return col;
}
