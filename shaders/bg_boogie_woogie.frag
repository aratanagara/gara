// =====================================================
// bg_boogie_woogie (Mondrian — Composition ⇄ Broadway Boogie Woogie)
//   uMbStyle 0 = コンポジション (少数の太い黒線・T 字で止まる線・白地に赤/青/黄の色面)
//            100 = ブロードウェイ・ブギウギ (細い黄色の線が街路のように並び、線の上を赤/青/灰の
//                  ブリップが流れる。セルの中に入れ子の色ブロック)。間は線・セルごとに混ざる。
//   構造: 水平線は全幅 / 垂直線は行ごとに途切れる (水平線との T 字で止まる)。
//         線は層状ジッタ配置 (隣と交差しない)。色面は途切れた線を越えて連結した領域単位で塗る。
//   動き: 一定周期 (uMbChange) ごとに 線のスライド / 線の出没 / 色の塗り替え / ブリップの色替え が
//         要素ごとにずれて起きる。beat モードは拍頭で切り替わり、ブリップは拍ごとに一歩進む。
//   参照: https://www.electricboogiewoogie.com/ (Rafaël Rozendaal, 2010)
//   bgZoom・bgCamPx でズーム/パン。ヘルパは mb_ で名前空間化。
// =====================================================

// @param uMbStyle   0..100   = 0.0
// @param uMbDensity 2..24    = 4.0
// @param uMbLines   20..100  = 85.0
// @param uMbFull    0..100   = 45.0
// @param uMbIrreg   0..100   = 80.0
// @param uMbLine    20..300  = 100.0
// @param uMbColor   0..100   = 30.0
// @param uMbBlack   0..50    = 4.0
// @param uMbBlip    0..100   = 40.0
// @param uMbBlipLen 50..300  = 100.0
// @param uMbTraffic 0..300   = 60.0
// @param uMbInner   0..100   = 55.0
// @param uMbChange  0..100   = 50.0
// @param uMbMotion  0..100   = 70.0
// @param uMbSpeed   10..300  = 100.0
// @param uMbKick    0..200   = 100.0
// @param uMbScale   30..300  = 100.0
// @param uMbTilt    -180..180 = 0.0
// @param uMbSeed    0..100   = 0.0
// @param uMbGrain   0..100   = 25.0
// @param uMbClear   0..100   = 0.0
// @param uMbPaper   color = #f2f0e9
// @param uMbInk     color = #141414
// @param uMbRed     color = #cf1f18
// @param uMbBlue    color = #1b2f96
// @param uMbYellow  color = #f6cf16
// @param uMbGray    color = #bdbcb6
uniform float uMbStyle;   // 0 = コンポジション / 100 = ブロードウェイ・ブギウギ (間は線・セルごとに混ざる)
uniform float uMbDensity; // 線の密度 (画面の高さあたりの本数。ブギウギ側で自動的に約 2.2 倍)
uniform float uMbLines;   // 線が立つ割合 (%)。下げると線が抜けて大きな面が増える
uniform float uMbFull;    // 垂直線が途切れずに通る割合 (%)。下げると T 字で止まる短い線が増える
uniform float uMbIrreg;   // 線の間隔のばらつき (%)。0 で等間隔の格子
uniform float uMbLine;    // 線の太さ (%)
uniform float uMbColor;   // コンポジション: 色面 (赤/青/黄) になる面の割合 (%)
uniform float uMbBlack;   // コンポジション: 黒い面の割合 (%)
uniform float uMbBlip;    // ブギウギ: 線の上の赤/青/灰のブリップの量 (%)。0 で黄色一色
uniform float uMbBlipLen; // ブギウギ: ブリップの長さ (%)
uniform float uMbTraffic; // ブギウギ: ブリップが線に沿って流れる速さ (%)。0 で止まって色だけ替わる
uniform float uMbInner;   // ブギウギ: セルの中の色ブロック (入れ子の四角) の量 (%)
uniform float uMbChange;  // 構図の変化の頻度 (%)。線のスライド・出没・塗り替えの周期 (100 = 毎拍)
uniform float uMbMotion;  // 線がスライドする量 (%)。0 で線は動かず色だけ替わる
uniform float uMbSpeed;   // 全体の速さ (%)
uniform float uMbKick;    // 拍 / 音の効き (%)。拍頭の押し出しと音での線の太り
uniform float uMbScale;   // 構図の大きさ (%)
uniform float uMbTilt;    // 構図の回転 (度)。45 でヴィクトリー・ブギウギ風の菱形
uniform float uMbSeed;    // 乱数の種。値を変えると別の構図になる
uniform float uMbGrain;   // 絵具のムラ (%)
uniform float uMbClear;   // 白地を透過する量 (%)。Slot B で下の絵に線と色面だけを重ねる
uniform vec3 uMbPaper;    // 白地の色
uniform vec3 uMbInk;      // コンポジションの線と黒い面の色
uniform vec3 uMbRed;      // 赤
uniform vec3 uMbBlue;     // 青
uniform vec3 uMbYellow;   // 黄
uniform vec3 uMbGray;     // 灰 (ブギウギのブリップ)

float mb_h(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float mb_vn(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = mb_h(vec3(i, 7.0)), b = mb_h(vec3(i + vec2(1,0), 7.0));
  float c = mb_h(vec3(i + vec2(0,1), 7.0)), d = mb_h(vec3(i + vec2(1,1), 7.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}

// 共有状態 (bg_boogie_woogie の冒頭で設定)
float mb_B;      // 変化の時計 (beat = 拍 / drone = 時間)
float mb_P;      // 変化の周期 (拍)
float mb_Ease;   // 切替時のスライドの立ち上がり (beat の押し出し)
float mb_pitch;  // 線の格子の間隔
float mb_unit;   // ブギウギの量子化単位 (= 線の太さ)
float mb_seed;
float mb_style;

// 要素ごとにずれた周期の「世代」。k が変わるときに値が切り替わる。f は世代内の位相 (0..1)
float mb_epoch(float salt, out float f){
  float off = floor(mb_h(vec3(salt, mb_seed, 3.7)) * mb_P);
  float x = (mb_B + off) / mb_P;
  f = fract(x);
  return floor(x);
}
// 線 k (軸 ax) の位置。世代の最後の 1 拍でスライドする
float mb_lpos(float k, float ax){
  float salt = k * 1.731 + ax * 91.3;
  float f; float e = mb_epoch(salt, f);
  float s = clamp(f * mb_P - (mb_P - 1.0), 0.0, 1.0);
  s = mix(s, 1.0 - pow(1.0 - s, 3.0), mb_Ease);
  float h0 = mb_h(vec3(salt, e, mb_seed + 5.0));
  float h1 = mb_h(vec3(salt, e + 1.0, mb_seed + 5.0));
  float hb = mb_h(vec3(salt, -9.0, mb_seed + 5.0));
  float j = mix(hb, mix(h0, h1, s), uMbMotion * 0.01) - 0.5;
  float x = (k + 0.5 + j * 0.9 * uMbIrreg * 0.01) * mb_pitch;
  return mix(x, floor(x / mb_unit + 0.5) * mb_unit, mb_style);   // ブギウギ側は単位格子へスナップ
}
// 線 k が立っているか (世代ごとに出没)
bool mb_lexist(float k, float ax){
  float salt = k * 2.917 + ax * 57.1;
  float f; float e = mb_epoch(salt + 0.5, f);
  float hb = mb_h(vec3(salt, -3.0, mb_seed + 9.0));
  float he = mb_h(vec3(salt, e, mb_seed + 9.0));
  float h = mix(hb, he, step(mb_h(vec3(salt, e, mb_seed + 4.0)), 0.35));   // 世代ごとに 35% の線だけ入れ替わる
  return h < uMbLines * 0.01;
}
// 垂直線 k の、行 row (下の水平線の番号) の区間があるか
bool mb_piece(float k, float row){
  if(mb_h(vec3(k * 3.31, 11.0, mb_seed)) < uMbFull * 0.01) return true;
  return mb_h(vec3(k * 3.31, row, mb_seed + 13.0)) < 0.55;
}

vec3 mb_ryb(float h){
  return h < 0.3334 ? uMbRed : (h < 0.6667 ? uMbBlue : uMbYellow);
}
float mb_box(vec2 p, vec4 r, float aa){
  vec2 d = min(p - r.xy, r.zw - p);
  return smoothstep(-aa, aa, min(d.x, d.y));
}

vec3 bg_boogie_woogie(vec2 fc){
  float bt = getBeat();
  float spd = uMbSpeed * 0.01;
  float kick = clamp(uMbKick * 0.01, 0.0, 1.0);
  float Tr;
  if(isFree()){
    mb_B = time * spd * 2.0;
    Tr = mb_B;
    mb_Ease = 0.0;
  } else {
    mb_B = bt * spd;
    float fb = fract(mb_B);
    Tr = floor(mb_B) + mix(fb, 1.0 - pow(1.0 - fb, 4.0), kick);   // 拍頭で押し出して止まる
    mb_Ease = kick;
  }
  mb_P = floor(exp2(mix(4.0, 0.0, uMbChange * 0.01)) + 0.5);       // 16 拍 .. 毎拍
  mb_seed = uMbSeed * 1.37;
  mb_style = uMbStyle * 0.01;
  float audio = clamp(iAudio, 0.0, 1.0) * uMbKick * 0.01;

  // 座標 (高さ = 1)
  float zm = max(bgZoom, 0.001);
  vec2 q = ((fc - 0.5 * resolution) / zm + bgCamPx) / resolution.y;
  float ta = radians(uMbTilt);
  q = mat2(cos(ta), -sin(ta), sin(ta), cos(ta)) * q;
  float sc = 100.0 / uMbScale;
  q *= sc;
  float aa = sc / (resolution.y * zm);

  float w = 0.011 * uMbLine * 0.01 * mix(1.0, 0.85, mb_style) * (1.0 + audio * 0.5);   // 線の半幅
  mb_unit = 2.0 * w;
  mb_pitch = 1.0 / (uMbDensity * mix(1.0, 2.2, mb_style));

  // ── 水平線 (全幅): 下 yB / 上 yT ──
  float r0 = floor(q.y / mb_pitch);
  float jB = -1e4, yB = -1e4, jT = 1e4, yT = 1e4;
  for(int i = 0; i < 6; i++){
    float j = r0 + 1.0 - float(i);
    if(mb_lexist(j, 1.0)){ float y = mb_lpos(j, 1.0); if(y <= q.y){ jB = j; yB = y; break; } }
  }
  for(int i = 0; i < 6; i++){
    float j = r0 + float(i);
    if(mb_lexist(j, 1.0)){ float y = mb_lpos(j, 1.0); if(y > q.y){ jT = j; yT = y; break; } }
  }
  // ── 垂直線 (行 jB の区間があるもの): 左 xL / 右 xR = 連結した面の境界 ──
  float c0 = floor(q.x / mb_pitch);
  float kL = -1e4, xL = -1e4, kR = 1e4, xR = 1e4;
  for(int i = 0; i < 7; i++){
    float k = c0 + 1.0 - float(i);
    if(mb_lexist(k, 0.0) && mb_piece(k, jB)){ float x = mb_lpos(k, 0.0); if(x <= q.x){ kL = k; xL = x; break; } }
  }
  for(int i = 0; i < 7; i++){
    float k = c0 + float(i);
    if(mb_lexist(k, 0.0) && mb_piece(k, jB)){ float x = mb_lpos(k, 0.0); if(x > q.x){ kR = k; xR = x; break; } }
  }

  // ── 面 ──
  float rid = kL * 7.13 + jB * 131.7;
  float fr; float er = mb_epoch(rid + 0.25, fr);
  float regBW = step(mb_h(vec3(rid, 21.0, mb_seed)), mb_style - 1e-4);
  vec3 paper = uMbPaper * (1.0 - 0.07 * mb_h(vec3(rid, 22.0, mb_seed)) * (1.0 - mb_style));
  vec3 col = paper;
  float isPaper = 1.0;
  vec4 inner = vec4(xL + w, yB + w, xR - w, yT - w);
  if(regBW < 0.5){
    // コンポジション: 色面 / 黒い面。一部の面は世代ごとに塗り替わる
    float hc = mb_h(vec3(rid, mix(-1.0, er, step(mb_h(vec3(rid, er, mb_seed + 23.0)), 0.5)), mb_seed + 24.0));
    if(hc < uMbColor * 0.01){ col = mb_ryb(mb_h(vec3(rid, er, mb_seed + 25.0))); isPaper = 0.0; }
    else if(hc > 1.0 - uMbBlack * 0.01){ col = uMbInk; isPaper = 0.0; }
  } else if(inner.z - inner.x < 1e3 && inner.w - inner.y < 1e3){
    // ブギウギ: セルの中の色ブロック (単位格子に揃えた矩形 + 入れ子の四角)
    float hb = mb_h(vec3(rid, er, mb_seed + 31.0));
    if(hb < uMbInner * 0.01){
      vec2 sz = inner.zw - inner.xy;
      vec2 nU = max(floor(sz / mb_unit), vec2(1.0));
      vec2 bU = max(floor(nU * mix(vec2(0.3), vec2(1.0), vec2(mb_h(vec3(rid, er, 32.0)), mb_h(vec3(rid, er, 33.0))))), vec2(1.0));
      vec2 oU = floor((nU - bU + 1.0) * vec2(mb_h(vec3(rid, er, 34.0)), mb_h(vec3(rid, er, 35.0))));
      oU = min(oU, nU - bU);
      vec4 blk = vec4(inner.xy + oU * mb_unit, inner.xy + (oU + bU) * mb_unit);
      blk.zw = min(blk.zw, inner.zw);
      float hA = mb_h(vec3(rid, er, 36.0));
      vec3 cA = mb_ryb(hA);
      float mA = mb_box(q, blk, aa);
      col = mix(col, cA, mA);
      isPaper = 1.0 - mA;
      // 入れ子の四角 (別の色)
      if(mb_h(vec3(rid, er, 37.0)) < 0.65 && min(bU.x, bU.y) >= 3.0){
        float iU = max(1.0, floor(min(bU.x, bU.y) * mix(0.25, 0.5, mb_h(vec3(rid, er, 38.0)))));
        vec2 io = floor((bU - iU) * 0.5);
        vec4 ib = vec4(blk.xy + io * mb_unit, blk.xy + (io + iU) * mb_unit);
        vec3 cB = mb_ryb(fract(hA + 0.3334 + 0.3333 * step(0.5, mb_h(vec3(rid, er, 39.0)))));
        col = mix(col, cB, mb_box(q, ib, aa));
      }
    }
  }

  // ── 線 ──
  float dV = min(q.x - xL, xR - q.x);
  float dH = min(q.y - yB, yT - q.y);
  float kV = q.x - xL < xR - q.x ? kL : kR;
  float jH = q.y - yB < yT - q.y ? jB : jT;
  bool vert = dV < dH;
  if(max(dV, dH) < w + aa) vert = mb_h(vec3(kV, jH, mb_seed + 47.0)) < 0.5;   // 交差点はどちらか一方の線の色で塗る
  float lk = vert ? kV : jH;
  float lid = lk * 1.913 + (vert ? 0.0 : 517.0);
  float lineBW = step(mb_h(vec3(lid, 41.0, mb_seed)), mb_style - 1e-4);
  float wl = w;
  float cov = smoothstep(wl + aa, wl - aa, min(dV, dH));
  vec3 lcol = uMbInk;
  if(lineBW > 0.5){
    // 黄色の線の上を流れるブリップ (同じ色の連なりで長さが揃わない)
    float t = vert ? q.y : q.x;
    float dir = mb_h(vec3(lid, 42.0, mb_seed)) < 0.5 ? -1.0 : 1.0;
    float u = mb_unit * uMbBlipLen * 0.01;
    float n = floor((t + dir * Tr * mb_unit * uMbTraffic * 0.01 * mix(0.6, 1.4, mb_h(vec3(lid, 43.0, mb_seed)))) / u);
    float g = floor(n * mix(0.25, 0.7, mb_h(vec3(lid, 44.0, mb_seed))) + mb_h(vec3(lid, 45.0, mb_seed)) * 10.0);
    float fg; float eg = mb_epoch(lid * 0.37 + g * 1.17, fg);
    float hc = mb_h(vec3(lid, g, eg + mb_seed * 3.0));
    lcol = uMbYellow;
    float bl = uMbBlip * 0.01;
    if(hc < bl){
      float hk = hc / max(bl, 1e-4);
      lcol = hk < 0.42 ? uMbRed : (hk < 0.84 ? uMbBlue : uMbGray);
    }
  }
  col = mix(col, lcol, cov);
  isPaper *= 1.0 - cov;

  // 絵具のムラ (筆の向きは面ごとに縦/横)
  if(uMbGrain > 0.0){
    vec2 gp = q * 60.0;
    gp = mb_h(vec3(rid, 51.0, 0.0)) < 0.5 ? gp * vec2(1.0, 8.0) : gp * vec2(8.0, 1.0);
    float nz = mb_vn(gp) * 0.6 + mb_vn(q * 900.0) * 0.4;
    col *= 1.0 + (nz - 0.5) * 0.12 * uMbGrain * 0.01;
  }

  float a = 1.0 - isPaper * uMbClear * 0.01;
  bgAlpha = a;
  return col * a;
}
