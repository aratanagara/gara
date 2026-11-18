// =====================================================
// bg_boogie_woogie (Mondrian — Broadway Boogie Woogie)
//   細い黄色の線が街路のように並び、線の上を赤/青/灰の車 (ドット) が拍ごとに 1 マスずつ進む。
//   セルの中に入れ子の色ブロック。
//   線は必ず直交する線と重なって始まり / 終わる (宙に浮いた端を作らない):
//     ・全通しの垂直線 (= 錨) は上下に貫く
//     ・水平線は全通し、または錨と錨のあいだだけに引かれる (端は錨の上)
//     ・それ以外の垂直線は、見えている水平線と水平線のあいだを区間ごとに引く (端は水平線の上)
//   車: 各車は「1 拍 1 マス」の予定表どおり走ろうとし、線上の見えない信号で止まる。
//       赤のあいだに着いた車は停止線の手前に詰めて並び (渋滞)、青で先頭から 2 拍おきに発進、
//       通過後は 1 拍 2 マスで遅れを取り戻す。位置は拍ごとに閉形式で求める (状態を持たない)。色は車ごとに固定。
//   動き: uMbChange の周期ごとに 線のスライド / 出没 / 本数の増減 (uMbDyn) / ブロックの塗り替え。
//         uMbMode 1 = 道を固定して車と建物だけ / 2 = 車だけ動かす。
//         uMbRedraw = N 拍ごとに構図を丸ごと描き直す。uMbDrawIn で線 → 面の順に描かれていく。
//   格子構造 (mg_*) は bg_composition.frag と同じ実装 (片方を直したらもう片方も直す)。
//   参照: https://www.electricboogiewoogie.com/ (Rafaël Rozendaal, 2010)
//   3D: uMb3D を上げると盤面が傾いて回り、線 (道 + その上の車) が厚みを持って立ち上がる (Composition と同じ方式。深度 vjDepth も出す)。
//   bgZoom・bgCamPx でズーム/パン。
// =====================================================

// @param uMbDensity 2..24    = 4.0
// @param uMbMode    0..2     = 0.0
// @param uMbLines   20..100  = 85.0
// @param uMbDyn     0..100   = 60.0
// @param uMbFull    0..100   = 55.0
// @param uMbFullH   0..100   = 70.0
// @param uMbIrreg   0..100   = 80.0
// @param uMbJump    0..100   = 0.0
// @param uMbLine    20..300  = 100.0
// @param uMbBlip    0..100   = 35.0
// @param uMbBlipLen 50..300  = 100.0
// @param uMbTraffic 0..300   = 100.0
// @param uMbSignal  0..100   = 50.0
// @param uMbJam     8..48    = 24.0
// @param uMbInner   0..100   = 55.0
// @param uMbChange  0..100   = 50.0
// @param uMbMotion  0..100   = 70.0
// @param uMbRedraw  0..16    = 0.0
// @param uMbDrawIn  0..100   = 0.0
// @param uMbSpeed   10..300  = 100.0
// @param uMbKick    0..200   = 100.0
// @param uMbScale   30..300  = 100.0
// @param uMbTilt    -180..180 = 0.0
// @param uMbSeed    0..100   = 0.0
// @param uMbGrain   0..100   = 25.0
// @param uMbClear   0..100   = 0.0
// @param uMb3D      0..100   = 0.0
// @param uMbHeight  10..400  = 100.0
// @param uMbPitch   0..80    = 45.0
// @param uMbSpin    -100..100 = 20.0
// @param uMbWallShade 0..100 = 55.0
// @param uMbPaper   color = #f2f0e9
// @param uMbRed     color = #cf1f18
// @param uMbBlue    color = #1b2f96
// @param uMbYellow  color = #f6cf16
// @param uMbGray    color = #bdbcb6
uniform float uMbDensity; // 線の密度 (画面の高さあたりの本数 × 2.2)
uniform float uMbMode;    // 動くもの: 0 = 全部 / 1 = 車と建物 (道は固定) / 2 = 車だけ (道も建物も固定)
uniform float uMbLines;   // 線が立つ割合 (%)。下げると線が抜けて大きな面が増える
uniform float uMbDyn;     // 線の本数の増減の深さ (%)。変化の周期 × 2 ごとに、数本〜全部のあいだで本数が変わる。0 で一定 (Mode 1・2 では効かない)
uniform float uMbFull;    // 垂直線が上下に貫く割合 (%)。貫く線が水平線の端の受け手になる
uniform float uMbFullH;   // 水平線が左右に貫く割合 (%)。下げると垂直線と垂直線のあいだで止まる線が増える
uniform float uMbJump;    // 区画の大きさのジャンプ率 (%)。上げると大きな街区と細い路地がはっきり分かれる (道の間隔を場所ごとに伸び縮みさせる)。0 でほぼ均等
uniform float uMbIrreg;   // 線の間隔のばらつき (%)。0 で等間隔の格子
uniform float uMbLine;    // 線の太さ (%)
uniform float uMbBlip;    // 車の量 (%)。上げると信号待ちの列が伸びる
uniform float uMbBlipLen; // 車 (1 マス) の長さ (%)
uniform float uMbTraffic; // 車が進む速さ (%)。100 = 1 拍で 1 マス / 0 で止まる
uniform float uMbSignal;  // 信号の赤の長さ (%)。上げると信号待ちの列が長くなる
uniform float uMbJam;     // 遅れの上限 (マス)。これより長く待つ車は描かれない (大きいほど負荷が上がる)
uniform float uMbInner;   // セルの中の色ブロック (入れ子の四角) の量 (%)
uniform float uMbChange;  // 構図の変化の頻度 (%)。線のスライド・出没・塗り替えの周期 (100 = 毎拍)
uniform float uMbMotion;  // 線がスライドする量 (%)。0 で線は動かず出没と塗り替えだけ
uniform float uMbRedraw;  // N 拍ごとに構図を丸ごと描き直す (0 = しない / 1 = 毎拍)
uniform float uMbDrawIn;  // 描き直しのあと線 → 面の順に描かれていく時間 (周期に対する %。0 = 一瞬で出る)
uniform float uMbSpeed;   // 全体の速さ (%)
uniform float uMbKick;    // 拍 / 音の効き (%)。線のスライドの押し出しと音での線の太り
uniform float uMbScale;   // 構図の大きさ (%)
uniform float uMbTilt;    // 構図の回転 (度)。45 でヴィクトリー・ブギウギ風の菱形
uniform float uMbSeed;    // 乱数の種。値を変えると別の構図になる
uniform float uMbGrain;   // 絵具のムラ (%)
uniform float uMbClear;   // 白地を透過する量 (%)。Slot B で下の絵に線と色面だけを重ねる
uniform float uMb3D;      // 3D の量 (%)。0 = 平面 (従来どおり)。上げると盤面が傾いて回り、線 (道) が厚みを持って立ち上がる
uniform float uMbHeight;  // 線の高さ (%)。100 = 線の太さと同じ = 断面が正方形
uniform float uMbPitch;   // 盤面の傾き (度)
uniform float uMbSpin;    // 盤面の回転の速さ (%)。負で逆回転
uniform float uMbWallShade; // 線の側面の陰の濃さ (%)
uniform vec3 uMbPaper;    // 白地の色
uniform vec3 uMbRed;      // 赤
uniform vec3 uMbBlue;     // 青
uniform vec3 uMbYellow;   // 黄 (線)
uniform vec3 uMbGray;     // 灰 (車)

// ───────── 格子構造 (bg_composition.frag と共通の実装) ─────────
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
bool mg_piece(float k, float row){ return mg_h(vec3(k * 3.31, row, mg_rseed + 13.0)) < 0.72; }
// 構造の向き: 水平線が通りやすく垂直線が区間で切れる仕組みなので、そのままだと横長の面に偏る。
// 道の種ごとに縦横を入れ替え、縦長の構成も同じだけ出す
vec2 mg_orient(vec2 q){ return mg_h(vec3(mg_rseed, 61.0, 3.0)) < 0.5 ? q.yx : q; }

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

vec3 mb_ryb(float h){ return h < 0.3334 ? uMbRed : (h < 0.6667 ? uMbBlue : uMbYellow); }
float mb_box(vec2 p, vec4 r, float aa){
  vec2 d = min(p - r.xy, r.zw - p);
  return smoothstep(-aa, aa, min(d.x, d.y));
}
// 初期配置: マス x0 に車がいるか (車は 1 拍 1 マスの予定表どおり x0 + n を走ろうとする)
float mb_occ(float lid, float a, float rho){ return step(mg_h(vec3(lid, a, mg_seed + 81.0)), rho); }
// 信号 (番号 li・位置 P) を 車 x0 が通過する拍 T と、赤信号から数えた待ち順 q
//   赤 [r0, r1) に着いた車は停止線の手前に詰めて並び、青で先頭から 2 拍おきに発進する
vec2 mb_cross(float lid, float li, float P, float x0, float C, float R, float rho){
  float tau = P - x0;                                   // 予定どおりなら通過する拍
  float phi = floor(mg_h(vec3(lid, li, mg_seed + 84.0)) * C);
  float r0 = phi + floor((tau - phi) / C) * C;
  float r1 = r0 + R;
  float q = 0.0;
  int nq = int(P - r0 - x0) + 1;                         // 赤になってから自分までに着いた台数
  for(int i = 0; i < nq; i++) q += mb_occ(lid, x0 + float(i), rho);
  return vec2(max(tau, r1 + 2.0 * (q - 1.0)), q);
}
// 車 x0 の 拍 n での位置。信号で待ち、通過後は 1 拍 2 マスで遅れを取り戻す
float mb_pos(float lid, float x0, float n, float S, float o, float C, float R, float rho){
  float f = x0 + n;
  float ia = floor((f - o) / S), Pa = ia * S + o;
  vec2 A = mb_cross(lid, ia, Pa, x0, C, R, rho);
  if(n < A.x) return min(f, Pa - A.y + max(0.0, n - (A.x - A.y)));
  if(Pa + 2.0 * (n - A.x) < f) return Pa + 2.0 * (n - A.x);
  float Pb = Pa + S;
  vec2 B = mb_cross(lid, ia + 1.0, Pb, x0, C, R, rho);
  return min(f, Pb - B.y + max(0.0, n - (B.x - B.y)));
}
// 線 lid のマス c に、拍 n で車がいれば その車の初期マス (= 車の識別子)、いなければ -1e9
float mb_car(float lid, float c, float n, float rho, int D){
  float S = floor(mix(24.0, 40.0, mg_h(vec3(lid, 82.0, mg_seed))));   // 信号の間隔 (マス)
  float o = floor(mg_h(vec3(lid, 83.0, mg_seed)) * S);
  float C = floor(mix(10.0, 16.0, mg_h(vec3(lid, 85.0, mg_seed))));   // 信号の周期 (拍)
  float R = floor(C * uMbSignal * 0.006 + 0.5);                        // 赤の長さ (拍)
  for(int i = 0; i <= D; i++){                                          // 車は予定より遅れるだけ → 予定位置 c..c+D の車を調べる
    float x0 = c - n + float(i);
    if(mb_occ(lid, x0, rho) < 0.5) continue;
    if(abs(mb_pos(lid, x0, n, S, o, C, R, rho) - c) < 0.5) return x0;
  }
  return -1e9;
}

// 盤面上の 1 点 q (傾き・大きさを掛けたあと) の道の覆い (0..1) だけを返す (3D の視線しらべ用。面・車の色は求めない)。
//   格子の状態 (mg_*) と、伸び縮み後の座標 mb_q・各線までの距離は mb_eval が色に使う
vec2 mb_q;
vec4 mb_dV;   // 左 / 右の垂直線・下 / 上の水平線までの距離 (出ていない線は BIG)
vec2 mb_sVH;  // 垂直 / 水平の線までの距離 (伸び縮み前に戻したもの)
float mb_w;   // 線の半幅
float mb_d;   // 道の縁までの距離 (盤面の座標。道の中は負)。3D の視線しらべが空いた所を読み飛ばす歩幅に使う
float mb_cov(vec2 q, float aa, float audio){
  float w = 0.011 * uMbLine * 0.01 * 0.85 * (1.0 + audio * 0.5);   // 線の半幅
  mb_w = w;
  mg_unit = 2.0 * w; mg_snap = 1.0;                                    // 単位格子 (= 線の太さ) に揃える
  mg_pitch = 1.0 / (uMbDensity * 2.2);
  q = mg_orient(q);
  // ジャンプ率: 各軸を単調に伸び縮みさせた空間で格子を組む (Composition と同じ)。線幅は傾き dq で割って一定に戻す
  float jp = uMbJump * 0.01 * 0.97;
  vec2 wf1 = 6.2832 / (mg_pitch * vec2(5.6, 4.9)), wf2 = 6.2832 / (mg_pitch * vec2(2.6, 2.9));
  vec2 wp1 = vec2(mg_h(vec3(mg_rseed, 71.0, 1.0)), mg_h(vec3(mg_rseed, 72.0, 1.0))) * 6.2832 + (mg_roadFix > 0.5 ? 0.0 : mg_B * 0.021 * mg_motion);
  vec2 wp2 = vec2(mg_h(vec3(mg_rseed, 73.0, 1.0)), mg_h(vec3(mg_rseed, 74.0, 1.0))) * 6.2832 - (mg_roadFix > 0.5 ? 0.0 : mg_B * 0.017 * mg_motion);
  vec2 dq = 1.0 + jp * (0.62 * cos(q * wf1 + wp1) + 0.38 * cos(q * wf2 + wp2));
  q += jp * (0.62 * sin(q * wf1 + wp1) / wf1 + 0.38 * sin(q * wf2 + wp2) / wf2);
  mg_build(q);
  mb_q = q;
  // ── 線 (区間は端から端まで。端は直交する線に重なる) ──
  float BIG = 1e9;
  float dVL = (mg_kL > -9e3 && mg_shownV(mg_kL, mg_aL)) ? q.x - mg_xL : BIG;
  float dVR = (mg_kR <  9e3 && mg_shownV(mg_kR, mg_aR)) ? mg_xR - q.x : BIG;
  float dHB = (mg_jB > -9e3 && mg_shownH(mg_jB)) ? q.y - mg_yB : BIG;
  float dHT = (mg_jT <  9e3 && mg_shownH(mg_jT)) ? mg_yT - q.y : BIG;
  mb_dV = vec4(dVL, dVR, dHB, dHT);
  float sV = min(dVL, dVR) / dq.x, sH = min(dHB, dHT) / dq.y;   // 伸び縮み前の距離に戻す
  mb_sVH = vec2(sV, sH);
  mb_d = min(sV, sH) - w;
  return smoothstep(w + aa, w - aa, min(sV, sH));
}
// 盤面上の 1 点 q の色を返す。戻り値 = 道の覆い (0..1)。isPaper = 白地か
float mb_eval(vec2 q, float aa, float audio, out vec3 col, out float isPaper){
  float cov = mb_cov(q, aa, audio);
  q = mb_q;
  float w = mb_w;
  bool bldFix = floor(uMbMode + 0.5) > 1.5;                          // 建物 (色ブロック) も固定

  // ── 面: 入れ子の色ブロック ──
  float rid = mg_kL * 7.13 + mg_jB * 131.7;
  float fr; float er = bldFix ? -1.0 : mg_epoch(rid + 0.25, fr);
  bool cellOn = bldFix || mg_shownCell(rid);
  col = uMbPaper;
  isPaper = 1.0;
  vec4 inner = vec4(mg_xL + w, mg_yB + w, mg_xR - w, mg_yT - w);
  if(cellOn && inner.z - inner.x < 1e3 && inner.w - inner.y < 1e3
     && mg_h(vec3(rid, er, (bldFix ? mg_rseed : mg_seed) + 31.0)) < uMbInner * 0.01){
    vec2 sz = inner.zw - inner.xy;
    vec2 nU = max(floor(sz / mg_unit), vec2(1.0));
    vec2 bU = max(floor(nU * mix(vec2(0.3), vec2(1.0), vec2(mg_h(vec3(rid, er, 32.0)), mg_h(vec3(rid, er, 33.0))))), vec2(1.0));
    vec2 oU = floor((nU - bU + 1.0) * vec2(mg_h(vec3(rid, er, 34.0)), mg_h(vec3(rid, er, 35.0))));
    oU = min(oU, nU - bU);
    vec4 blk = vec4(inner.xy + oU * mg_unit, inner.xy + (oU + bU) * mg_unit);
    blk.zw = min(blk.zw, inner.zw);
    float hA = mg_h(vec3(rid, er, 36.0));
    float mA = mb_box(q, blk, aa);
    col = mix(col, mb_ryb(hA), mA);
    isPaper = 1.0 - mA;
    if(mg_h(vec3(rid, er, 37.0)) < 0.65 && min(bU.x, bU.y) >= 3.0){
      float iU = max(1.0, floor(min(bU.x, bU.y) * mix(0.25, 0.5, mg_h(vec3(rid, er, 38.0)))));
      vec2 io = floor((bU - iU) * 0.5);
      vec4 ib = vec4(blk.xy + io * mg_unit, blk.xy + (io + iU) * mg_unit);
      vec3 cB = mb_ryb(fract(hA + 0.3334 + 0.3333 * step(0.5, mg_h(vec3(rid, er, 39.0)))));
      col = mix(col, cB, mb_box(q, ib, aa));
    }
  }

  // ── 線 (区間は端から端まで。端は直交する線に重なる。車は線の上に乗る) ──
  float dVL = mb_dV.x, dVR = mb_dV.y, dHB = mb_dV.z, dHT = mb_dV.w;
  float sV = mb_sVH.x, sH = mb_sVH.y;
  if(cov > 0.0){
    float an = dVL < dVR ? mg_aL : mg_aR;
    bool vert = sV < sH;
    if(max(sV, sH) < w + aa) vert = an > 0.5;   // 交差点: 貫く垂直線の上は垂直線、それ以外は水平線の色
    float lk = vert ? (dVL < dVR ? mg_kL : mg_kR) : (dHB < dHT ? mg_jB : mg_jT);
    float lid = lk * 1.913 + (vert ? 0.0 : 517.0);
    // 車: 線ごとに進む向きを決め、マス目 c / 時刻 n (拍) で占有を解く
    float t = vert ? q.y : q.x;
    float dir = mg_h(vec3(lid, 42.0, mg_seed)) < 0.5 ? -1.0 : 1.0;
    float u = mg_unit * uMbBlipLen * 0.01;
    float c = floor(dir * t / u);
    float n = floor(mg_B * uMbTraffic * 0.01);
    vec3 lcol = uMbYellow;
    float rho = uMbBlip * 0.01 * 0.5;
    if(rho > 0.0){
      float car = mb_car(lid, c, n, rho, int(uMbJam + 0.5));
      if(car > -1e8){
        float hk = mg_h(vec3(lid, car, mg_seed + 43.0));
        lcol = hk < 0.42 ? uMbRed : (hk < 0.84 ? uMbBlue : uMbGray);
      }
    }
    col = mix(col, lcol, cov);
    isPaper *= 1.0 - cov;
  }

  if(uMbGrain > 0.0){
    vec2 gp = q * 60.0;
    gp = (cellOn && mg_h(vec3(rid, 51.0, 0.0)) < 0.5) ? gp * vec2(1.0, 8.0) : gp * vec2(8.0, 1.0);
    float nz = mg_vn(gp) * 0.6 + mg_vn(q * 900.0) * 0.4;
    col *= 1.0 + (nz - 0.5) * 0.12 * uMbGrain * 0.01;
  }
  return cov;
}

vec3 bg_boogie_woogie(vec2 fc){
  float kick = clamp(uMbKick * 0.01, 0.0, 1.0);
  mg_setTime(getBeat(), uMbSpeed * 0.01, kick, uMbChange, uMbRedraw, uMbDrawIn, uMbSeed);
  mg_lines = uMbLines * 0.01; mg_full = uMbFull * 0.01; mg_fullH = uMbFullH * 0.01;
  mg_irreg = uMbIrreg * 0.01; mg_motion = uMbMotion * 0.01; mg_dyn = uMbDyn * 0.01;
  float mode = floor(uMbMode + 0.5);
  if(mode > 0.5){ mg_roadFix = 1.0; mg_rseed = uMbSeed * 1.37; }   // 道を固定 (描き直しでも変えない)
  float audio = clamp(iAudio, 0.0, 1.0) * uMbKick * 0.01;

  float zm = max(bgZoom, 0.001);
  float ta = radians(uMbTilt);
  mat2 tilt = mat2(cos(ta), -sin(ta), sin(ta), cos(ta));
  float sc = 100.0 / uMbScale;
  vec3 col; float isPaper;

  if(uMb3D <= 0.0){
    // 平面 (従来どおり)
    vec2 q = ((fc - 0.5 * resolution) / zm + bgCamPx) / resolution.y;
    q = tilt * q;
    q *= sc;
    float aa = sc / (resolution.y * zm);
    mb_eval(q, aa, audio, col, isPaper);
    float a = 1.0 - isPaper * uMbClear * 0.01;
    bgAlpha = a;
    return col * a;
  }

  // ── 3D: 盤面 (z = 0) を傾けて回し、線 (道) を高さ H の壁として押し出す。Composition と同じ視線しらべ。
  //    天面 = 道の色 (車も天面に乗る) / 側面 = 陰。色ブロックは盤面 (z = 0) のまま。深度 vjDepth も出す
  float k3 = uMb3D * 0.01;
  float lw = 2.0 * 0.011 * uMbLine * 0.01 * 0.85 * (1.0 + audio * 0.5);   // 線の太さ (盤面の座標)
  float H = lw * zm / sc * uMbHeight * 0.01 * k3;            // 線の高さ = 線の太さ × Height (盤面の座標を世界の長さに直す。100 で断面が正方形)
  float pitch = radians(uMbPitch) * k3;
  float yaw = time * 0.25 * uMbSpin * 0.01 * k3;
  vec2 uv = (fc - 0.5 * resolution) / resolution.y;
  vec3 ro = vec3(0.0, 0.0, 1.0);
  vec3 rd = normalize(vec3(uv, -1.0));
  // カメラを原点まわりに回す (傾き = x 軸、回転 = z 軸)
  float cp = cos(pitch), sp = sin(pitch);
  ro.yz = mat2(cp, -sp, sp, cp) * ro.yz; rd.yz = mat2(cp, -sp, sp, cp) * rd.yz;
  float cy = cos(yaw), sy = sin(yaw);
  ro.xy = mat2(cy, -sy, sy, cy) * ro.xy; rd.xy = mat2(cy, -sy, sy, cy) * rd.xy;
  if(rd.z >= -1e-4){ bgAlpha = 1.0 - uMbClear * 0.01; return uMbPaper * bgAlpha; }
  float tTop = (H - ro.z) / rd.z, tBot = -ro.z / rd.z;
  // 道の縁までの距離ぶん視線を進める (空いた面の上は 1〜2 歩で抜ける)。道の柱の中 (縁より内側 かつ 高さ H 以下) に入ったら当たり。
  //   上限は uniform 依存 = 定数ループの展開を避ける
  int N = int(clamp(12.0 + 0.0 * time, 2.0, 12.0));
  float tHit = tBot; float side = 0.0; float hitI = -1.0;
  float kxy = length(rd.xy) * sc / zm;                        // 視線 1 進むあいだの盤面の座標の進み
  float t = tTop;
  for(int i = 0; i < 12; i++){
    if(i >= N || t > tBot) break;
    vec3 p = ro + rd * t;
    vec2 q = tilt * ((p.xy / zm + bgCamPx / resolution.y)) * sc;
    mb_cov(q, 0.0, audio);
    if(mb_d <= 0.0){
      hitI = float(i);
      tHit = t;
      side = p.z < H * 0.96 ? 1.0 : 0.0;   // 道の天面より下で当たった = 側面
      mb_eval(q, sc * t / (resolution.y * zm), audio, col, isPaper);
      break;
    }
    t += max(mb_d / max(kxy, 1e-4), 0.002);
  }
  if(hitI < 0.0){   // 道に当たらなければ盤面 (z = 0)
    vec3 p = ro + rd * tBot;
    vec2 q = tilt * ((p.xy / zm + bgCamPx / resolution.y)) * sc;
    mb_eval(q, sc * tBot / (resolution.y * zm), audio, col, isPaper);
  } else if(side > 0.5){
    // 側面: 道の色を陰で暗く (盤面の回転に合わせて面の向きで濃淡を変える)
    float lit = 0.5 + 0.5 * sin(yaw + 0.7);
    col = mix(col, col * (0.35 + 0.4 * lit), uMbWallShade * 0.01);
  }
  vjDepth = clamp(1.0 - (tHit - (length(ro) - 0.9)) / 1.8, 0.0, 1.0);   // 深度 (盤面の手前ほど 1)。折り系・3D FX が紙をこれで持ち上げる
  float a = 1.0 - isPaper * uMbClear * 0.01;
  bgAlpha = a;
  return col * a;
}
