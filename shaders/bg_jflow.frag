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

vec3 bg_jflow(vec2 fc){
  vec2 I  = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = (2.0*I - resolution.xy) / resolution.y;        // x:[-asp,asp] y:[-1,1]
  float asp = resolution.x / resolution.y;
  float T = time;

  vec3 col = vec3(0.015, 0.02, 0.04);                      // 暗い背景
  float cov = 0.0;                                         // 結晶カバレッジ(透過用)

  for(int i = 0; i < JF_N; i++){
    vec4  rnd  = jf_hash4(float(i)*1.7 + 3.0);
    vec4  rnd2 = jf_hash4(float(i)*2.9 + 11.0);
    float yc    = (rnd.x*2.0 - 1.0) * 0.86;                // 縦レーン
    float scale = 0.04 + 2.3*pow(rnd.y, 3.0);            // 大きさ(極端: 微小多数+まれに画面横切る巨大)
    float speed = 0.26 + 0.85*rnd.z;                       // 流れる速さ(スピード感)
    float spin  = (rnd.w - 0.5) * 2.4;                     // 自転(速め)
    float span  = 2.0*asp + 1.8;                           // 画面外まで含む幅
    // 右(+)から左(-)へ流れ、端で巻き戻す
    float xc = (asp + 0.9) - mod(T*speed + rnd.x*span, span);
    float yb = yc + 0.05*sin(T*(0.6 + rnd.w) + float(i));  // ゆらぎ
    float shard = step(0.58, rnd2.x);                      // 一部は欠片(破断面でカット)

    vec2 d = uv - vec2(xc, yb);
    if(dot(d, d) > (scale*1.85)*(scale*1.85)) continue;    // 遠い結晶は早期スキップ

    vec2 p = jf_rot(d/scale, T*spin + rnd.y*6.2831);
    p.x *= 0.82;                                           // 流れ方向にややストレッチ(スピード感)
    // ワープ + ねじれ: 中心からの距離でひねり、ドメインワープで不規則化(刻々と変形)
    float tw = (0.8 + 1.4*rnd.z) * sin(T*0.9 + rnd.x*6.0);
    vec2  pw = jf_rot(p, tw * length(p));
    pw += 0.22*sin(pw.yx*3.4 + T*1.8 + rnd.w*6.2831);
    // Julia: c を速めにカーディオイド上で morph(結晶が刻々と変形)
    vec2 z = pw * 1.18;
    vec2 c = jf_C(jf_R(T*1.2 + float(i)*0.7)) * (1.0 + 0.10*sin(T*1.3 + float(i)));
    float k = 0.0;
    float trap = 1e9;                                      // オービットトラップ(内部のフラクタル模様)
    for(int it = 0; it < JF_ITER; it++){
      if(dot(z, z) > 4.0) break;
      z = jf_cmul(z, z) + c;
      trap = min(trap, min(abs(z.x), abs(z.y)));           // 軌道が軸に最接近=フィラメント
      k += 1.0;
    }
    float esc    = k / float(JF_ITER);
    float inside = step(float(JF_ITER) - 0.5, k);          // 脱出しない=結晶本体
    // 形マスク: 境界付近のみ残す(外側のすぐ脱出域は消す=シャープな結晶輪郭)
    float shape  = inside + (1.0 - inside) * smoothstep(0.10, 0.55, esc);
    float radial = smoothstep(1.8, 0.5, length(p));        // 結晶の輪郭にクランプ
    if(shard > 0.5){                                       // 欠片: 片側を破断面でカット
      vec2 cn = jf_rot(vec2(1.0, 0.0), rnd2.y*6.2831);
      float cut = dot(p, cn) - (rnd2.z - 0.5)*1.4;
      radial *= smoothstep(0.0, 0.22, -cut);
    }
    float amt = shape * radial;
    if(amt <= 0.001) continue;

    // 中の模様 = オービットトラップの内部フィラメント + エスケープ等高線(デンドライト)
    float pat   = 1.0 - smoothstep(0.0, 0.16, trap);       // 内部のフラクタル模様(明るい筋)
    float facet = abs(fract(k*0.2) * 2.0 - 1.0);           // 5反復ごとの稜線(境界)
    float ridge = smoothstep(0.35, 0.95, facet) * (1.0 - inside);

    // 立体感は控えめ + 鋭く小さいハイライト。発光させずコントラストで見せる(H17 のバランス)。
    float rr   = clamp(length(p)/1.8, 0.0, 1.0);
    float dome = sqrt(1.0 - rr*rr);
    vec3  Nn   = normalize(vec3(p/1.8, dome + 0.30));
    vec3  Ll   = normalize(vec3(0.5*cos(T*0.6), 0.55, 0.72));
    float dif  = clamp(dot(Nn, Ll), 0.0, 1.0);
    float spec = pow(clamp(dot(reflect(-Ll, Nn), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 48.0);

    float hue = 0.695 + 0.03*rnd.y - 0.04*esc;            // 青(#3f00ff 寄りの藍青)
    vec3  base= jf_H(hue, 0.85, 1.0);
    vec3  cc  = base * (0.16 + 0.42*dif);                 // 青のボディ(陰影はここだけ)
    cc += vec3(0.90, 0.95, 1.0) * pat * 0.95;             // 白い結晶フィラメント(ライティング非依存で加算)
    cc += vec3(0.85, 0.93, 1.0) * ridge * 0.30;           // 境界デンドライト
    cc += spec * vec3(0.90, 0.97, 1.0) * 0.35;            // 鋭く小さいハイライト
    col = max(col, cc * amt);                              // 明るい方を採用
    cov = max(cov, amt);
  }

  col = pow(col, vec3(0.85));                              // 軽いトーン

  if(abs(uCosGrad) > 0.0001){
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, cosGradColor(lum) * (0.3 + 1.3*lum), abs(uCosGrad));
  }

  bgAlpha = (uSlotIsA > 0.5) ? 1.0 : clamp(cov, 0.0, 1.0); // Slot B は結晶のみ
  return col;
}
