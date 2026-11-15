// =====================================================
// bg_composition (Mondrian — Composition)
//   少数の太い黒線と、白地に赤/青/黄/黒の色面。
//   線は必ず直交する線と重なって始まり / 終わる (宙に浮いた端を作らない):
//     ・全通しの垂直線 (= 錨) は上下に貫く
//     ・水平線は全通し、または錨と錨のあいだだけに引かれる (端は錨の上)
//     ・それ以外の垂直線は、見えている水平線と水平線のあいだを区間ごとに引く (端は水平線の上)
//   面はこの線で 4 辺とも閉じた矩形単位で塗る。
//   動き: uMcChange の周期ごとに、要素ごとにずれて 線のスライド / 出没 / 色の塗り替え。
//         uMcDyn で 線の本数そのものが 数本〜全部のあいだで増減する。
//         uMcRedraw = N 拍ごとに構図を丸ごと描き直す。uMcDrawIn で線 → 面の順に描かれていく。
//   格子構造 (mg_*) は bg_boogie_woogie.frag と同じ実装 (片方を直したらもう片方も直す)。
//   bgZoom・bgCamPx でズーム/パン。
// =====================================================

// @param uMcDensity 2..24    = 4.0
// @param uMcLines   20..100  = 85.0
// @param uMcDyn     0..100   = 60.0
// @param uMcFull    0..100   = 40.0
// @param uMcFullH   0..100   = 55.0
// @param uMcIrreg   0..100   = 80.0
// @param uMcLine    20..300  = 100.0
// @param uMcColor   0..100   = 30.0
// @param uMcBlack   0..50    = 4.0
// @param uMcChange  0..100   = 50.0
// @param uMcMotion  0..100   = 70.0
// @param uMcRedraw  0..16    = 0.0
// @param uMcDrawIn  0..100   = 0.0
// @param uMcSpeed   10..300  = 100.0
// @param uMcKick    0..200   = 100.0
// @param uMcScale   30..300  = 100.0
// @param uMcTilt    -180..180 = 0.0
// @param uMcSeed    0..100   = 0.0
// @param uMcGrain   0..100   = 25.0
// @param uMcClear   0..100   = 0.0
// @param uMcPaper   color = #f2f0e9
// @param uMcInk     color = #141414
// @param uMcRed     color = #cf1f18
// @param uMcBlue    color = #1b2f96
// @param uMcYellow  color = #f6cf16
uniform float uMcDensity; // 線の密度 (画面の高さあたりの本数)
uniform float uMcLines;   // 線が立つ割合 (%)。下げると線が抜けて大きな面が増える
uniform float uMcDyn;     // 線の本数の増減の深さ (%)。変化の周期 × 2 ごとに、数本〜全部のあいだで本数が変わる。0 で一定
uniform float uMcFull;    // 垂直線が上下に貫く割合 (%)。貫く線が水平線の端の受け手になる
uniform float uMcFullH;   // 水平線が左右に貫く割合 (%)。下げると垂直線と垂直線のあいだで止まる線が増える
uniform float uMcIrreg;   // 線の間隔のばらつき (%)。0 で等間隔の格子
uniform float uMcLine;    // 線の太さ (%)
uniform float uMcColor;   // 色面 (赤/青/黄) になる面の割合 (%)
uniform float uMcBlack;   // 黒い面の割合 (%)
uniform float uMcChange;  // 構図の変化の頻度 (%)。線のスライド・出没・塗り替えの周期 (100 = 毎拍)
uniform float uMcMotion;  // 線がスライドする量 (%)。0 で線は動かず出没と塗り替えだけ
uniform float uMcRedraw;  // N 拍ごとに構図を丸ごと描き直す (0 = しない / 1 = 毎拍)
uniform float uMcDrawIn;  // 描き直しのあと線 → 面の順に描かれていく時間 (周期に対する %。0 = 一瞬で出る)
uniform float uMcSpeed;   // 全体の速さ (%)
uniform float uMcKick;    // 拍 / 音の効き (%)。拍頭の押し出しと音での線の太り
uniform float uMcScale;   // 構図の大きさ (%)
uniform float uMcTilt;    // 構図の回転 (度)。45 で菱形のコンポジション
uniform float uMcSeed;    // 乱数の種。値を変えると別の構図になる
uniform float uMcGrain;   // 絵具のムラ (%)
uniform float uMcClear;   // 白地を透過する量 (%)。Slot B で下の絵に線と色面だけを重ねる
uniform vec3 uMcPaper;    // 白地の色
uniform vec3 uMcInk;      // 線と黒い面の色
uniform vec3 uMcRed;      // 赤
uniform vec3 uMcBlue;     // 青
uniform vec3 uMcYellow;   // 黄

// ───────── 格子構造 (bg_boogie_woogie.frag と共通の実装) ─────────
float mg_h(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float mg_vn(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = mg_h(vec3(i, 7.0)), b = mg_h(vec3(i + vec2(1,0), 7.0));
  float c = mg_h(vec3(i + vec2(0,1), 7.0)), d = mg_h(vec3(i + vec2(1,1), 7.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
// 入力 (エントリで設定)
float mg_B, mg_P, mg_Ease, mg_pitch, mg_unit, mg_snap, mg_seed, mg_gen, mg_dp;
float mg_lines, mg_full, mg_fullH, mg_irreg, mg_motion;
float mg_dyn;       // 線の本数の増減の深さ (0..1)
float mg_rseed;     // 道 (線の構造) の乱数の種。道を固定するときは描き直しでも変えない
float mg_roadFix;   // 1 = 道を固定 (スライド・出没・本数の増減・描き込みなし)
// 出力 (mg_build)
float mg_kL, mg_xL, mg_kR, mg_xR, mg_jB, mg_yB, mg_jT, mg_yT;
float mg_aL, mg_aR;   // 左右の線が錨 (上下に貫く線) か

void mg_setTime(float bt, float spd, float kick, float change, float redraw, float drawIn, float seed){
  if(isFree()){ mg_B = time * spd * 2.0; mg_Ease = 0.0; }
  else { mg_B = bt * spd; mg_Ease = kick; }
  mg_P = floor(exp2(mix(4.0, 0.0, change * 0.01)) + 0.5);          // 16 拍 .. 毎拍
  float nR = floor(redraw + 0.5);
  mg_gen = nR > 0.5 ? floor(mg_B / nR) : 0.0;
  mg_seed = seed * 1.37 + mg_gen * 17.31;
  mg_rseed = mg_seed; mg_roadFix = 0.0;
  mg_dp = 1.0;
  if(drawIn > 0.0){
    float per = nR > 0.5 ? nR : mg_P;
    mg_dp = clamp(fract(mg_B / per) / (drawIn * 0.01), 0.0, 1.0);
  }
}
// 要素ごとにずれた周期の「世代」と、世代内の位相 f
float mg_epoch(float salt, out float f){
  float off = floor(mg_h(vec3(salt, mg_seed, 3.7)) * mg_P);
  float x = (mg_B + off) / mg_P;
  f = fract(x);
  return floor(x);
}
// 線 k (軸 ax: 0 = 垂直 / 1 = 水平) の位置。世代の最後の 1 拍でスライドする
float mg_lpos(float k, float ax){
  float salt = k * 1.731 + ax * 91.3;
  float j = mg_h(vec3(salt, -9.0, mg_rseed + 5.0));
  if(mg_roadFix < 0.5){
    float f; float e = mg_epoch(salt, f);
    float s = clamp(f * mg_P - (mg_P - 1.0), 0.0, 1.0);
    s = mix(s, 1.0 - pow(1.0 - s, 3.0), mg_Ease);
    float h0 = mg_h(vec3(salt, e, mg_rseed + 5.0));
    float h1 = mg_h(vec3(salt, e + 1.0, mg_rseed + 5.0));
    j = mix(j, mix(h0, h1, s), mg_motion);
  }
  float x = (k + 0.5 + (j - 0.5) * 0.9 * mg_irreg) * mg_pitch;
  return mix(x, floor(x / mg_unit + 0.5) * mg_unit, mg_snap);
}
// 線の本数の増減: 周期 (変化の周期 × 2) ごとに、立てる線の割合を数本〜全部のあいだで振る。軸ごとに半周期ずらす
float mg_level(float ax){
  if(mg_dyn <= 0.0) return 1.0;
  float per = mg_P * 2.0;
  float ge = floor((mg_B + per * 0.5 * ax) / per);
  float lv = mg_h(vec3(ge, ax + 31.0, mg_rseed + 91.0));
  return mix(1.0, 0.1 + 0.9 * pow(lv, 1.5), mg_dyn);
}
// 線 k が立っているか (世代ごとに 35% の線だけ入れ替わる + 本数の増減)。線ごとの値が小さい線から順に残る
bool mg_lexist(float k, float ax){
  float salt = k * 2.917 + ax * 57.1;
  float hb = mg_h(vec3(salt, -3.0, mg_rseed + 9.0));
  if(mg_roadFix > 0.5) return hb < mg_lines;
  float f; float e = mg_epoch(salt + 0.5, f);
  float he = mg_h(vec3(salt, e, mg_rseed + 9.0));
  float h = mix(hb, he, step(mg_h(vec3(salt, e, mg_rseed + 4.0)), 0.35));
  return h < mg_lines * mg_level(ax);
}
bool mg_anchor(float k){ return mg_h(vec3(k * 3.31, 11.0, mg_rseed)) < mg_full; }   // 上下に貫く垂直線
bool mg_hfull(float j){ return mg_h(vec3(j * 5.17, 12.0, mg_rseed)) < mg_fullH; }   // 左右に貫く水平線
// 水平線 j が、錨 a から始まる錨区間に引かれているか
bool mg_hvis(float j, float a){
  if(!mg_lexist(j, 1.0)) return false;
  if(mg_hfull(j)) return true;
  return mg_h(vec3(j * 5.17, a, mg_rseed + 14.0)) < 0.5;
}
// 垂直線 k (錨でない) の、水平線 row から上の区間があるか
bool mg_piece(float k, float row){ return mg_h(vec3(k * 3.31, row, mg_rseed + 13.0)) < 0.5; }

void mg_build(vec2 q){
  float c0 = floor(q.x / mg_pitch);
  float r0 = floor(q.y / mg_pitch);
  // 錨 (左): 水平線の区間を決める
  float kA = -1e4;
  for(int i = 0; i < 12; i++){
    float k = c0 + 1.0 - float(i);
    if(mg_lexist(k, 0.0) && mg_anchor(k) && mg_lpos(k, 0.0) <= q.x){ kA = k; break; }
  }
  // 見えている水平線 (下 / 上)
  mg_jB = -1e4; mg_yB = -1e4; mg_jT = 1e4; mg_yT = 1e4;
  for(int i = 0; i < 9; i++){
    float j = r0 + 1.0 - float(i);
    if(mg_hvis(j, kA)){ float y = mg_lpos(j, 1.0); if(y <= q.y){ mg_jB = j; mg_yB = y; break; } }
  }
  for(int i = 0; i < 9; i++){
    float j = r0 + float(i);
    if(mg_hvis(j, kA)){ float y = mg_lpos(j, 1.0); if(y > q.y){ mg_jT = j; mg_yT = y; break; } }
  }
  // 垂直線 (左 / 右): 錨か、行 jB の区間があるもの。錨より先へは探さない (錨で必ず止まる)
  mg_kL = -1e4; mg_xL = -1e4; mg_kR = 1e4; mg_xR = 1e4; mg_aL = 0.0; mg_aR = 0.0;
  for(int i = 0; i < 12; i++){
    float k = c0 + 1.0 - float(i);
    if(!mg_lexist(k, 0.0)) continue;
    float x = mg_lpos(k, 0.0);
    if(x > q.x) continue;
    bool an = mg_anchor(k);
    if(an || mg_piece(k, mg_jB)){ mg_kL = k; mg_xL = x; mg_aL = an ? 1.0 : 0.0; break; }
  }
  for(int i = 0; i < 12; i++){
    float k = c0 + float(i);
    if(!mg_lexist(k, 0.0)) continue;
    float x = mg_lpos(k, 0.0);
    if(x <= q.x) continue;
    bool an = mg_anchor(k);
    if(an || mg_piece(k, mg_jB)){ mg_kR = k; mg_xR = x; mg_aR = an ? 1.0 : 0.0; break; }
  }
}
// 描き直し中に線が出る順番: 貫く線 → 区間の水平線 → 区間の垂直線 (端の受け手が先に出る)
bool mg_shownV(float k, float an){
  if(mg_roadFix > 0.5) return true;
  float h = mg_h(vec3(k, mg_gen, mg_seed + 71.0));
  return mg_dp >= (an > 0.5 ? 0.02 + 0.3 * h : 0.62 + 0.25 * h);
}
bool mg_shownH(float j){
  if(mg_roadFix > 0.5) return true;
  float h = mg_h(vec3(j, mg_gen, mg_seed + 73.0));
  return mg_dp >= (mg_hfull(j) ? 0.02 + 0.3 * h : 0.3 + 0.28 * h);
}
bool mg_shownCell(float rid){ return mg_dp >= 0.6 + 0.4 * mg_h(vec3(rid, mg_gen, mg_seed + 72.0)); }
// ───────── ここまで共通 ─────────

vec3 mc_ryb(float h){ return h < 0.3334 ? uMcRed : (h < 0.6667 ? uMcBlue : uMcYellow); }

vec3 bg_composition(vec2 fc){
  float kick = clamp(uMcKick * 0.01, 0.0, 1.0);
  mg_setTime(getBeat(), uMcSpeed * 0.01, kick, uMcChange, uMcRedraw, uMcDrawIn, uMcSeed);
  mg_lines = uMcLines * 0.01; mg_full = uMcFull * 0.01; mg_fullH = uMcFullH * 0.01;
  mg_irreg = uMcIrreg * 0.01; mg_motion = uMcMotion * 0.01; mg_dyn = uMcDyn * 0.01;
  float audio = clamp(iAudio, 0.0, 1.0) * uMcKick * 0.01;

  float zm = max(bgZoom, 0.001);
  vec2 q = ((fc - 0.5 * resolution) / zm + bgCamPx) / resolution.y;
  float ta = radians(uMcTilt);
  q = mat2(cos(ta), -sin(ta), sin(ta), cos(ta)) * q;
  float sc = 100.0 / uMcScale;
  q *= sc;
  float aa = sc / (resolution.y * zm);

  float w = 0.011 * uMcLine * 0.01 * (1.0 + audio * 0.5);   // 線の半幅
  mg_unit = 2.0 * w; mg_snap = 0.0;
  mg_pitch = 1.0 / uMcDensity;
  mg_build(q);

  // ── 面 (4 辺とも閉じた矩形) ──
  float rid = mg_kL * 7.13 + mg_jB * 131.7;
  float fr; float er = mg_epoch(rid + 0.25, fr);
  vec3 col = uMcPaper;
  float isPaper = 1.0;
  if(mg_shownCell(rid)){
    col *= 1.0 - 0.07 * mg_h(vec3(rid, 22.0, mg_seed));   // 白の面ごとのわずかな色むら (面が出てから)
    float hc = mg_h(vec3(rid, mix(-1.0, er, step(mg_h(vec3(rid, er, mg_seed + 23.0)), 0.5)), mg_seed + 24.0));
    if(hc < uMcColor * 0.01){ col = mc_ryb(mg_h(vec3(rid, er, mg_seed + 25.0))); isPaper = 0.0; }
    else if(hc > 1.0 - uMcBlack * 0.01){ col = uMcInk; isPaper = 0.0; }
  }

  // ── 線 (区間は端から端まで。端は直交する線に重なる) ──
  float BIG = 1e9;
  float sV = BIG, sH = BIG;
  if(mg_kL > -9e3 && mg_shownV(mg_kL, mg_aL)) sV = min(sV, q.x - mg_xL);
  if(mg_kR <  9e3 && mg_shownV(mg_kR, mg_aR)) sV = min(sV, mg_xR - q.x);
  if(mg_jB > -9e3 && mg_shownH(mg_jB)) sH = min(sH, q.y - mg_yB);
  if(mg_jT <  9e3 && mg_shownH(mg_jT)) sH = min(sH, mg_yT - q.y);
  float cov = smoothstep(w + aa, w - aa, min(sV, sH));
  col = mix(col, uMcInk, cov);
  isPaper *= 1.0 - cov;

  if(uMcGrain > 0.0){
    vec2 gp = q * 60.0;
    gp = (mg_shownCell(rid) && mg_h(vec3(rid, 51.0, 0.0)) < 0.5) ? gp * vec2(1.0, 8.0) : gp * vec2(8.0, 1.0);
    float nz = mg_vn(gp) * 0.6 + mg_vn(q * 900.0) * 0.4;
    col *= 1.0 + (nz - 0.5) * 0.12 * uMcGrain * 0.01;
  }

  float a = 1.0 - isPaper * uMcClear * 0.01;
  bgAlpha = a;
  return col * a;
}
