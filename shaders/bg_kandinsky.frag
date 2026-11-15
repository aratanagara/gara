// =====================================================
// bg_kandinsky (Kandinsky — Composition)
//   点・線・面が生まれ、構成に組み上がり、運動しては消えていく。
//   バウハウス期のカンディンスキー (Composition VIII) を、ロシア構成主義の「構成」として組む。
//   ■ 骨格: 画面を斜めに貫く主軸と、それに交わる対軸。交点が焦点。
//       主軸の一端に光輪を重ねた大円、反対側から大円を指す大きな楔、2 本の軸線 (枠 0〜3 が主役)。
//       骨格は種で決まり、周期ごとに回る (uKdTurn = 積み重なる回転 / uKdSpin = ゆらぎ)。要素は骨格に乗ったまま一緒に回る。
//   ■ 配置: 残りの枠は軸の座標で置く (uKdOrder)。軸の上に乗る / 軸に接して座る / 軸に平行・直角に向く。
//       楔は焦点を指し、扇は軸の上の一点から開き、円弧は大円を囲む軌道になる。
//       大きさは少数の中くらいと多数の小さな要素 (階層)。軸から外れた所は余白として残る。
//   ■ 形: 面 = 光輪と輪郭の円 / 同心円 / 鋭い楔 (塗り・輪郭だけ) / 四角 / 傾いた格子・市松 / 半円 / 虹の弧
//         線 = 貫く直線 / 鋭角の折れ線 / 扇 / 平行線の束 / 円弧 / ふくらむ曲線 / 目盛りつきの線
//         点 = 点 / 輪つきの点 / 小さな輪 / 点線 / 点の群れ
//   ■ 色: 形と色の対応 (円=青・楔=黄・四角=赤, uKdAccord)。面は透ける絵具で、重なりは掛け合わせた別の色になる
//         (uKdOverlap)。地は紙の上に水色・黄・桃の淡いにじみ (uKdWash)。線はほぼ墨。
//   ■ 群れ (uKdFlock): 要素は鳥やイワシの群れのように軸を「向き」として共有する。
//       骨格は周期 (uKdLife 拍) ごとにいっせいに向きを変え、焦点から遠い要素ほど遅れてついてくる (列がしなる)。
//       軸に沿ってうねりが走り、要素は流れの向きに首を振る。密度は集まっては散る。構成に従わない要素がはぐれ者。
//   ■ 運動: 要素は群れの流れに沿って滑り込んで組み上がり、同じ向きへ抜けて消える (uKdMotion)。
//         線は一端から描かれ同じ向きに消える。動きは 1・2・4 拍の刻みで進む (uKdRhythm)。円は拍で脈打つ。
//   beat モードは拍頭で生まれ、拍ごとに押し出されて動く。drone は一定の速さ。
//   uKdScale で構成ごと拡大・縮小、uKdZoomMove で焦点へゆっくり寄っては引く。bgZoom・bgCamPx でズーム/パン。ヘルパは kd_ で名前空間化。
// =====================================================

// @param uKdCount   6..80    = 30.0
// @param uKdLife    2..32    = 8.0
// @param uKdPlanes  0..100   = 50.0
// @param uKdLines   0..100   = 60.0
// @param uKdPoints  0..100   = 35.0
// @param uKdRest    0..90    = 15.0
// @param uKdGreat   0..250   = 100.0
// @param uKdAxis    0..300   = 100.0
// @param uKdOrder   0..100   = 85.0
// @param uKdSize    30..300  = 100.0
// @param uKdThick   20..300  = 100.0
// @param uKdAccord  0..100   = 70.0
// @param uKdDraw    0..100   = 40.0
// @param uKdPop     0..100   = 60.0
// @param uKdMotion  0..300   = 100.0
// @param uKdSpin    0..300   = 100.0
// @param uKdTurn    0..180   = 60.0
// @param uKdReverse 0..100   = 30.0
// @param uKdSizeVar 0..100   = 50.0
// @param uKdRhythm  0..100   = 60.0
// @param uKdFlock   0..200   = 100.0
// @param uKdOverlap 0..100   = 75.0
// @param uKdHalo    0..200   = 100.0
// @param uKdWash    0..200   = 100.0
// @param uKdColor   0..100   = 25.0
// @param uKdSpeed   10..300  = 100.0
// @param uKdKick    0..200   = 100.0
// @param uKdScale   20..500  = 100.0
// @param uKdZoomMove 0..100  = 0.0
// @param uKdSeed    0..100   = 0.0
// @param uKdReseed  0..32    = 0.0
// @param uKdGrain   0..100   = 30.0
// @param uKdClear   0..100   = 0.0
// @param uKdPaper   color = #ece2cb
// @param uKdInk     color = #161412
// @param uKdRed     color = #c5362b
// @param uKdBlue    color = #27468f
// @param uKdYellow  color = #ecc132
// @param uKdViolet  color = #64407f
// @param uKdPink    color = #dc93a0
// @param uKdSky     color = #86b5cc
// @param uKdGreen   color = #4d8a66
uniform float uKdCount;   // 要素の数 (枠の数)。枠 0〜3 は主役 (大円・大きな楔・主軸線・対軸線)。負荷はほぼこの数に比例する
uniform float uKdLife;    // 要素の寿命 (拍)。要素ごとに 0.6〜1.4 倍にばらつく。主役は 3 倍
uniform float uKdPlanes;  // 面の割合 (重み)
uniform float uKdLines;   // 線の割合 (重み)
uniform float uKdPoints;  // 点の割合 (重み)
uniform float uKdRest;    // 休む周期の割合 (%)。上げると画面に空きが増える (主役は休まない)
uniform float uKdGreat;   // 大円と大きな楔の大きさ (%)。0 でなし
uniform float uKdAxis;    // 主軸・対軸の線の太さ (%)。0 で軸線なし (配置の骨格は残る)
uniform float uKdOrder;   // 構成に従う要素の割合 (%)。残りは軸と無関係に散る
uniform float uKdSize;    // 要素の大きさ (%)
uniform float uKdThick;   // 線の太さ (%)
uniform float uKdAccord;  // 形と色の対応 (%)。円=青・楔=黄・四角=赤 になる割合
uniform float uKdPop;     // 現れるときのポップ (%)。大きさが行き過ぎて弾んで戻る / 消えるときは逆に少し膨らんでから縮む。0 でなめらかに膨らむだけ
uniform float uKdDraw;    // 寿命のうち 組み上がる / 消える のにかける割合 (%)。0 で一瞬で出て一瞬で消える
uniform float uKdMotion;  // 流れに沿って滑り込む / 抜けていく距離 (%)
uniform float uKdTurn;    // 骨格 (主軸・対軸) が周期ごとに回る角度の平均 (度)。回転は積み重なり、構成ごと向きを変え続ける。0 で向きは種で固定
uniform float uKdReverse; // 回転が逆向きに切り替わる頻度 (%)。0 で一方向に回り続ける / 上げるほど不規則なタイミングで行き来する
uniform float uKdSizeVar; // 要素と大円の大きさが周期ごとに変わる幅 (%)。0 で一定 / 100 で 0.5〜2 倍
uniform float uKdSpin;    // 構成全体が周期ごとに向きを変える量と、円弧・扇の回る速さ (%)
uniform float uKdRhythm;  // 動きの刻み (%)。0 でなめらか、上げると 1・2・4 拍ごとに進んで止まる
uniform float uKdFlock;   // 群れの振る舞い (%)。旋回で外側が遅れてついてくる・流れがうねる・密度が息をする。0 で硬い構成のまま
uniform float uKdOverlap; // 面が重なったところの色の変わり方 (%)。0 で上の面がそのまま覆う
uniform float uKdHalo;    // 円のまわりの光輪 (%)
uniform float uKdWash;    // 地の淡い色のにじみ (%)
uniform float uKdColor;   // 線と点が色を持つ割合 (%)。残りは墨
uniform float uKdSpeed;   // 全体の速さ (%)
uniform float uKdKick;    // 拍の効き (%)。拍頭の押し出しと円の脈動
uniform float uKdScale;   // 構成の拡大率 (%)。画面中央を中心に、線の太さごと拡大・縮小。引くと軸が伸び、要素はやや広い範囲に並ぶ
uniform float uKdZoomMove; // ゆっくり寄っては引くズームの深さ (%)。32 拍で一往復し、焦点へ寄っていく
uniform float uKdSeed;    // 乱数の種。値を変えると別の構成になる
uniform float uKdReseed;  // N 拍ごとに乱数の種をランダムに引き直して別の構成へ切り替える (0 = しない / 4 = 4 拍ごと)。Speed に関係なく実際の拍で数える
uniform float uKdGrain;   // 紙と絵具のムラ (%)
uniform float uKdClear;   // 地を透過する量 (%)。Slot B で下の絵に点・線・面だけを重ねる
uniform vec3 uKdPaper;    // 地の色
uniform vec3 uKdInk;      // 墨
uniform vec3 uKdRed;      // 赤
uniform vec3 uKdBlue;     // 青
uniform vec3 uKdYellow;   // 黄
uniform vec3 uKdViolet;   // 紫
uniform vec3 uKdPink;     // 桃
uniform vec3 uKdSky;      // 水色
uniform vec3 uKdGreen;    // 緑

float kd_h(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
vec4 kd_h4(vec3 p){
  vec4 v = fract(p.xyzx * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  v += dot(v, v.wzxy + 33.33);
  return fract((v.xxyz + v.yzzw) * v.zywx);
}
float kd_vn(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = kd_h(vec3(i, 7.0)), b = kd_h(vec3(i + vec2(1,0), 7.0));
  float c = kd_h(vec3(i + vec2(0,1), 7.0)), d = kd_h(vec3(i + vec2(1,1), 7.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
vec3 kd_pal(float h){
  if(h < 0.19) return uKdRed;
  if(h < 0.38) return uKdBlue;
  if(h < 0.58) return uKdYellow;
  if(h < 0.70) return uKdViolet;
  if(h < 0.80) return uKdPink;
  if(h < 0.91) return uKdSky;
  return uKdGreen;
}
// 形と色の対応: h が uKdAccord 未満なら形の色、そうでなければパレットから
vec3 kd_form(float h, vec3 base){
  float a = uKdAccord * 0.01;
  return h < a ? base : kd_pal(fract(h * 9.71 + 0.13));
}
float kd_box(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float kd_seg(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0));
}
float kd_tri(vec2 p, vec2 p0, vec2 p1, vec2 p2){   // 三角形の符号付き距離 (iq)
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
// 種類の表: [面 16][線 16][点 16]。値は種類の番号、個数が出やすさ
//   面 0 円 / 1 同心円 / 2 楔 / 3 四角 / 4 格子 / 5 半円 / 6 虹の弧
//   線 0 直線 / 1 折れ線 / 2 扇 / 3 束 / 4 円弧 / 5 曲線 / 6 目盛り
//   点 0 点 / 1 輪つき / 2 点線 / 3 小さな輪 / 4 群れ
const float KD_TY[48] = float[48](
  0.,0.,0.,0., 1.,1., 2.,2.,2.,2., 3.,3., 4.,4., 5., 6.,
  0.,0.,0., 1.,1.,1., 2.,2., 3.,3., 4.,4., 5.,5., 6.,6.,
  0.,0.,0.,0.,0., 1.,1.,1., 3.,3., 2.,2.,2., 4.,4.,4.);
// 種類ごとの (大きさの下限, 幅, 1 なら小さいものに偏らせる, 軸に乗る割合 [負は軸に接して座る割合])
const vec4 KD_TA[21] = vec4[21](
  vec4(0.026, 0.13, 1., 0.6), vec4(0.03, 0.07, 0., 0.6), vec4(0.10, 0.34, 1., 0.5), vec4(0.04, 0.10, 0., -0.75),
  vec4(0.06, 0.09, 0., -0.5), vec4(0.04, 0.09, 0., -1.0), vec4(0.05, 0.10, 0., -1.0),
  vec4(0.35, 0.90, 0., 0.0), vec4(0.12, 0.30, 0., 0.4), vec4(0.12, 0.26, 0., 1.0), vec4(0.15, 0.45, 0., 0.0),
  vec4(0.07, 0.22, 0., 0.5), vec4(0.20, 0.45, 0., 0.0), vec4(0.15, 0.35, 0., 0.0),
  vec4(0.005, 0.018, 1., 0.75), vec4(0.006, 0.016, 1., 0.75), vec4(0.12, 0.30, 0., 0.3), vec4(0.010, 0.022, 0., 0.6),
  vec4(0.025, 0.03, 0., 0.0), vec4(0.), vec4(0.));
// 種類ごとの届く範囲 (大きさに比例する xy, uKdSize に比例する xy)
const vec4 KD_TB[21] = vec4[21](
  vec4(2.4, 2.4, 0., 0.), vec4(1.2, 1.2, 0., 0.), vec4(0.55, 0.34, 0., 0.), vec4(1.3, 0.75, 0., 0.),
  vec4(1.05, 1.35, 0., 0.), vec4(1.45, 1.1, 0., 0.), vec4(1.05, 1.05, 0., 0.),
  vec4(0.5, 0., 0., 0.), vec4(0.52, 0.36, 0., 0.), vec4(1.02, 1.02, 0., 0.), vec4(0.5, 0., 0.08, 0.05),
  vec4(1.05, 1.05, 0., 0.), vec4(0.52, 0.17, 0., 0.), vec4(0.52, 0., 0., 0.03),
  vec4(1.2, 1.2, 0., 0.), vec4(2.4, 2.4, 0., 0.), vec4(0.55, 0., 0., 0.012), vec4(1.3, 1.3, 0., 0.),
  vec4(1.7, 1.7, 0., 0.), vec4(0.), vec4(0.));
// 種類ごとの 軸を横切る向きになる割合
const float KD_PERP[21] = float[21](0., 0., 0., 0., 0., 0., 0.,  0.28, 0.3, 0.3, 0.35, 0., 0., 0.35,  0., 0., 0.3, 0., 0., 0., 0.);
// 群れの旋回: 周期 per 拍ごとに、終わりの 4 割でいっせいに向きを変えて止まる (-1..1)
// 骨格の回転: 周期の終わり 4 割でいっせいに回り、角度は積み重なる (1 周期あたり平均 rad、大小のむらつき)
// 逆回転: 整数の段 k ごとに +1 / -1 (半周期 h で反転する矩形波) を積んだ量 = 三角波。段の途中は f (0..1) で進む
float kd_tri(float k, float f, float h){
  float m = floor(k / h), r = k - m * h;
  bool up = mod(m, 2.0) < 0.5;
  return (up ? r : h - r) + (up ? f : -f);
}
float kd_rot(float t, float per, float ph, float rad, float h1, float h2){
  float x = t / per;
  float k = floor(x), f = smoothstep(0.6, 1.0, fract(x));
  float st = k + f;
  // 半周期の違う 2 つの反転を重ねる → 逆回転のタイミングと速さが不規則になる (h が大きいと一方向)
  return rad * (0.65 * kd_tri(k, f, h1) + 0.35 * kd_tri(k, f, h2) + 0.45 * sin(st * 2.399 + ph));
}
// ease-out-back: 行き過ぎて戻る (k = 行き過ぎの強さ)
float kd_back(float x, float k){ float y = x - 1.0; return 1.0 + (k + 1.0) * y * y * y + k * y * y; }
float kd_turn(float t, float per, float ph){
  float x = t / per;
  float st = floor(x) + smoothstep(0.6, 1.0, fract(x));
  return 0.6 * sin(st * 2.399 + ph) + 0.4 * sin(st * 0.917 + ph * 1.7);
}
// 透ける絵具を塗る: 既に面が塗られた上 (pl) では下の色と掛け合わせた色になる
void kd_paint(inout vec3 col, inout float pl, vec3 c, float a){
  vec3 m = pow(clamp(col * c / max(uKdPaper, vec3(0.05)), 0.0, 1.0), vec3(0.62));
  m = mix(m, c, 0.35 * (1.0 - smoothstep(0.1, 0.45, dot(col, vec3(0.333)))));   // 暗い下地の上では絵具が勝つ
  col = mix(col, mix(c, m, uKdOverlap * 0.01 * pl), a);
  pl = max(pl, a);
}

vec3 bg_kandinsky(vec2 fc){
  float bt = getBeat();
  float spd = uKdSpeed * 0.01;
  float kk = uKdKick * 0.01;
  float kick = clamp(kk, 0.0, 1.0);
  bool fre = isFree();
  float B, bq;
  if(fre){
    B = time * spd * 2.0;
    bq = B;
  } else {
    bq = bt * spd;
    float fb = fract(bq);
    B = floor(bq) + mix(fb, 1.0 - pow(1.0 - fb, 3.0), kick);   // 拍頭で押し出して止まる
  }
  float seed = uKdSeed * 1.37;
  float nRs = floor(uKdReseed + 0.5);
  if(nRs > 0.5) seed += floor((fre ? time * 2.0 : bt) / nRs) * 17.31;   // N 拍ごとに別の種へ

  float zm = max(bgZoom, 0.001);
  vec2 q0 = ((fc - 0.5 * resolution) / zm + bgCamPx) / resolution.y;  // 画面の高さ = 1
  float asp = resolution.x / resolution.y;
  float sc = 100.0 / max(uKdScale, 1.0);
  float zs = 1.0 + 0.6 * max(sc - 1.0, 0.0);                           // 引いたときに構成が広がる倍率

  // ── 骨格: 主軸 e1 と対軸 e2 が焦点 F で交わる。大円 C0 は主軸の一端 ──
  vec4 sa = kd_h4(vec3(seed, 3.0, 7.0));
  vec4 sb = kd_h4(vec3(seed, 5.0, 9.0));
  float turn = uKdSpin * 0.01;
  float per = max(uKdLife, 2.0);
  float flk = uKdFlock * 0.01;
  float kA0 = (sa.x < 0.5 ? -1.0 : 1.0) * (0.36 + 0.42 * sa.y);
  float kB0 = 1.5708 + (sa.w - 0.5) * 0.9;
  float phA = sa.z * 6.2832, phB = sb.x * 6.2832;
  float rad = radians(uKdTurn) * (sb.x < 0.5 ? -1.0 : 1.0);           // 回る向きは種で決める
  float rv = uKdReverse * 0.01;
  float h1 = rv > 0.0 ? max(1.0, floor(mix(12.0, 1.0, rv) * (0.6 + 0.8 * sb.y) + 0.5)) : 1e5;   // 反転までの段数
  float h2 = rv > 0.0 ? max(1.0, floor(mix(9.0, 1.0, rv) * (0.6 + 0.8 * sb.z) + 0.5)) : 1e5;
  float rotA = kd_rot(B, per, phA, rad, h1, h2);
  float kA = kA0 + rotA + 0.20 * turn * kd_turn(B, per, phA);
  float kB = kA + kB0 + 0.12 * turn * kd_turn(B + per * 0.5, per, phB);
  // 群れの遅れ: 少し前の向きも求めておき、焦点から遠い要素ほど前の向きに寄せる (旋回の間だけ列がしなる)
  float tlg = B - flk * 2.8;
  float lgA = clamp(kA0 + kd_rot(tlg, per, phA, rad, h1, h2) + 0.20 * turn * kd_turn(tlg, per, phA) - kA, -0.35, 0.35);   // 大きく回る間も遅れは小角度に収める
  float lgB = lgA + 0.12 * turn * (kd_turn(tlg + per * 0.5, per, phB) - kd_turn(B + per * 0.5, per, phB));
  // 群れの密度: 集まっては散る
  float brA = 1.0 + 0.16 * flk * sin(B * 0.131), brB = 1.0 + 0.16 * flk * sin(B * 0.131 + 2.1);
  vec2 e1 = vec2(cos(kA), sin(kA)), n1 = vec2(-e1.y, e1.x);
  vec2 e2 = vec2(cos(kB), sin(kB)), n2 = vec2(-e2.y, e2.x);
  vec2 F = vec2((sb.y - 0.5) * 0.22 * asp, (sb.z - 0.5) * 0.14) + 0.02 * vec2(sin(B * 0.07), cos(B * 0.06));
  float cs = sb.w < 0.5 ? -1.0 : 1.0;
  float great = uKdGreat * 0.01;
  float dC = min(0.25 * asp, 0.27 / max(abs(e1.y), 0.2));
  vec2 C0 = F + e1 * cs * dC;
  // 大きさ: 周期ごとに全体の倍率を引き直し、骨格の旋回と同じ終わり 4 割で移り変わる
  float sv = uKdSizeVar * 0.01;
  float xs = B / per, ks = floor(xs), fs = smoothstep(0.6, 1.0, fract(xs));
  float gS = exp2(sv * mix(kd_h4(vec3(seed, ks, 41.0)).x * 2.0 - 1.0, kd_h4(vec3(seed, ks + 1.0, 41.0)).x * 2.0 - 1.0, fs));
  float gG = exp2(sv * 0.7 * mix(kd_h4(vec3(seed, ks, 43.0)).y * 2.0 - 1.0, kd_h4(vec3(seed, ks + 1.0, 43.0)).y * 2.0 - 1.0, fs));
  float rG = 0.165 * great * gG;

  // ズーム: uKdScale は画面中央が中心。uKdZoomMove は焦点へゆっくり寄っては戻る
  float zf = 1.0 + 1.5 * uKdZoomMove * 0.01 * (0.5 - 0.5 * cos(B * 0.19635));
  vec2 q = q0 * sc / zf + F * (1.0 - 1.0 / zf);
  float aa = sc / (zf * resolution.y * zm);

  // ── 地: 紙の上の淡いにじみ。大円の側は冷たく、反対側は暖かい ──
  vec3 col = uKdPaper;
  float wsh = uKdWash * 0.01;
  if(wsh > 0.0){
    vec2 w1 = q - C0, w2 = q - (F - e1 * cs * 0.42), w3 = q - (F + e2 * 0.36);
    float m1 = exp(-dot(w1, w1) / 0.20) + 0.55 * kd_vn(q * 1.9 + seed * 3.1) - 0.35;
    float m2 = exp(-dot(w2, w2) / 0.16) + 0.55 * kd_vn(q * 2.3 + 41.0 + seed) - 0.35;
    float m3 = exp(-dot(w3, w3) / 0.10) + 0.55 * kd_vn(q * 2.9 + 83.0 - seed) - 0.40;
    col = mix(col, mix(uKdPaper, uKdSky, 0.55), clamp(m1, 0.0, 1.0) * 0.55 * wsh);
    col = mix(col, mix(uKdPaper, uKdYellow, 0.50), clamp(m2, 0.0, 1.0) * 0.50 * wsh);
    col = mix(col, mix(uKdPaper, uKdPink, 0.55), clamp(m3, 0.0, 1.0) * 0.45 * wsh);
  }
  col *= 1.0 - 0.13 * dot(q0, q0);       // 縁へ少し沈む
  float pl = 0.0;        // 面が塗られた量 (重なりの判定)
  float pt = 0.0;        // 線・点・光輪が塗られた量 (透過に使う)

  float wP = uKdPlanes, wL = uKdLines, wD = uKdPoints;
  float wT = max(wP + wL + wD, 1e-3);
  int N = int(uKdCount + 0.5);
  float fN = max(float(N) - 4.0, 1.0);
  float sz = uKdSize * 0.01 * gS;
  float th0 = uKdThick * 0.01;
  float dr = uKdDraw * 0.01 * 0.45;
  float pop = uKdPop * 0.01;
  float popK = 1.2 + 1.8 * pop;                        // 行き過ぎの強さ (100% で約 2 割)
  float mo = uKdMotion * 0.01;
  float rh = uKdRhythm * 0.01;
  float ord = uKdOrder * 0.01;
  float zsq = sqrt(zs);

  float restp = uKdRest * 0.01;
  float idr = dr > 0.0 ? 1.0 / dr : 1e6;
  float ifN = 1.0 / fN, cP = wP / wT, cL = (wP + wL) / wT;
  float izs = 1.0 / zs;
  float beamK = mix(1.0, sz, 0.5) / sz;                // 貫く直線は大きさの影響を半分に
  float flwB = (sb.w < 0.5 ? 1.0 : -1.0) * (sa.w < 0.5 ? 1.0 : -1.0);   // 対軸の群れが流れる向き
  float axw = max(uKdAxis * 0.01, 1.0);
  vec2 qF = q - F;
  vec2 ab1 = vec2(dot(qF, e1), dot(qF, n1)), ab2 = vec2(dot(qF, e2), dot(qF, n2));   // 画素の軸座標 (主軸 / 対軸)

  // ※ 届かない要素を飛ばすまでの計算は、分岐を避けて選択 (三項) で書く。この GPU では分岐のほうが高くつく。
  for(int i = 0; i < N; i++){
    float fi = float(i);
    bool lead = i < 4;                                   // 主役の枠
    vec4 hA = fract(vec4(0.6180340, 0.7548777, 0.5698403, 0.8566749) * (fi + 1.0) + seed * vec4(0.731, 0.377, 0.913, 0.559));   // 枠ごとの定数 (安い乱数)
    // 寿命と世代
    float lm = lead ? 3.0 : 1.0;
    float Lb = max(2.0, floor(uKdLife * lm * (0.6 + 0.8 * hA.x) + 0.5));
    float iLb = 1.0 / Lb;
    float x = (B + floor(hA.y * Lb)) * iLb;
    float g = floor(x), f = fract(x);
    vec4 hB = kd_h4(vec3(fi, g, seed + 3.0));
    // この周期は休む / 使わない主役
    if(lead ? (i < 2 ? great <= 0.0 : uKdAxis <= 0.0) : hB.x < restp) continue;
    // 刻み: 1・2・4 拍ごとに進んで止まる
    float tm = f * Lb;
    float nst = hA.z < 0.4 ? 1.0 : (hA.z < 0.75 ? 2.0 : 4.0);
    float xs = tm * (hA.z < 0.4 ? 1.0 : (hA.z < 0.75 ? 0.5 : 0.25)), fs = fract(xs);
    float fs1 = (1.0 - fs) * (1.0 - fs);
    float tq = mix(tm, nst * (floor(xs) + 1.0 - fs1 * fs1), rh);
    float fq = tq * iLb;
    // 組み上がり ein / 消え eout (0..1)。割り算を避けるため、傾き idr をループの外で求めてある
    float idrr = lead ? (i == 0 ? idr * 6.0 : idr * 3.0) : idr;
    float einL = clamp(fq * idrr, 0.0, 1.0), eoutL = clamp((1.0 - fq) * idrr, 0.0, 1.0);
    float ein = einL * einL * (3.0 - 2.0 * einL);
    float eout = eoutL * eoutL * (3.0 - 2.0 * eoutL);
    // ポップ: 大きさだけ ease-out-back で行き過ぎて戻る。消えるときは同じ曲線の逆再生 (少し膨らんでから縮む)
    float pin = mix(ein, kd_back(einL, popK), pop), pout = mix(eout, kd_back(eoutL, popK), pop);
    float ie = 1.0 - ein, oe = 1.0 - eout;

    // 種類・位置・向き・届く範囲を求め、届かない要素はここで飛ばす
    vec4 hC = fract(hB.zwxy * 91.3458 + hB.yxwz * 47.853 + 0.37);   // 以降の乱数は hB から安く作る
    float u = (fi - 3.5) * ifN;
    float cat = u < cP ? 1.0 : (u < cL ? 2.0 : 3.0);   // 0 大円 / 1 面 / 2 線 / 3 点
    float ty = 0.0, r0, sl = 0.0, crp = 0.0;
    float hs = hB.z;
    vec2 ext, P, dv, flw;                              // flw = 群れの流れの向き
    if(lead){
      float sgn = hC.x < 0.5 ? -1.0 : 1.0;
      if(i == 0){
        cat = 0.0; r0 = rG; ext = vec2(r0 * 2.6);
        P = C0 + 0.012 * mo * vec2(sin(B * 0.21 + hA.w * 6.0), cos(B * 0.17)); dv = e1 * cs;
      } else if(i == 1){
        cat = 1.0; ty = 2.0; r0 = 0.50 * great * gG * (0.8 + 0.4 * hs); ext = vec2(r0 * 0.55, r0 * 0.2);
        dv = e1 * cs;                                  // 大円を指す
        P = F - dv * (0.07 + r0 * 0.5); sl = 0.35;
      } else {
        cat = 2.0; r0 = (i == 2 ? 2.2 : 1.25) * zs; ext = vec2(r0 * 0.5, 0.012 * th0 * axw);
        P = i == 2 ? F : F + e1 * (hC.y - 0.5) * 0.1; dv = (i == 2 ? e1 : e2) * sgn;
      }
      flw = dv;
    } else {
      // 種類は 16 分割の表で引く (確率は表の個数)。大きさ・届く範囲・軸への乗り方も表から
      int ci = int(cat - 1.0);
      ty = KD_TY[ci * 16 + int(min(hB.w * 16.0, 15.0))];
      int m = ci * 7 + int(ty);
      vec4 ta = KD_TA[m], tb = KD_TB[m];
      r0 = sz * (ta.x + ta.y * (ta.z > 0.5 ? hs * hs : hs)) * (m == 7 ? beamK : 1.0);
      ext = tb.xy * r0 + tb.zw * sz + (ci == 1 ? 0.012 * th0 : 0.0);
      // 軸の座標で置く: 主軸 / 対軸、uu = 軸に沿った位置、vv = 軸からの離れ
      bool mainAx = hC.z < 0.62;
      float uu = (hC.x - 0.5) * (mainAx ? 1.75 : 0.95) * zs;
      // 群れ: 焦点から遠い要素ほど旋回に遅れてついてくる (小さな角度なので正規化は省く)
      float lg = (mainAx ? lgA : lgB) * min(abs(uu) * izs * 1.143, 1.0);
      uu *= mainAx ? brA : brB;                                        // 密度が息をする
      bool orb = m == 11 && hC.w < 0.5 && great > 0.0;                 // 円弧の半分は大円を囲む軌道
      uu = orb ? cs * dC : uu;
      r0 = orb ? max(r0, rG * (1.25 + 1.3 * hs)) : r0;
      ext = orb ? vec2(r0 * 1.05 + 0.012 * th0) : ext;
      bool fr = hB.y >= ord;                                           // 構成に従わない要素 (はぐれ者)
      vec2 pf = vec2((hC.x - 0.5) * asp, hC.y - 0.5) * 0.98 * zs;
      sl = ci == 2 ? 0.18 : 0.26;
      crp = 0.0015 * (fq - 0.5) * Lb;
      // 粗い足切り: 軸の座標で見て明らかに届かない画素は、残りの計算をせずに飛ばす (負荷の大半はここで落ちる)
      float R = (ext.x + ext.y) * (1.0 + 0.3 * pop) + 1.3 * mo * (sl * abs(oe * oe - ie * ie) + abs(crp)) + 0.01;
      float lgm = abs(lg);
      vec2 dd = fr ? abs(q - pf) : abs((mainAx ? ab1 : ab2) - vec2(uu, 0.0));
      vec2 mg = fr ? vec2(R) : R + vec2(lgm * 0.4 * zsq, lgm * abs(uu) + 0.34 * zsq + 0.05 * flk);
      if(dd.x > mg.x || dd.y > mg.y) continue;
      vec2 e = mainAx ? e1 : e2;
      e += vec2(-e.y, e.x) * lg;
      vec2 n = vec2(-e.y, e.x);
      float v0 = (hC.y - 0.5) * 2.0;
      float hw4 = fract(hC.w * 7.13);
      bool onAx = hw4 < ta.w;                                          // 軸の上に乗る
      bool isSit = hw4 < -ta.w;                                        // 軸に接して座る (四角・格子・半円・虹の弧は軸線を底辺にする)
      float perp = hC.w < KD_PERP[m] ? 1.0 : 0.0;                      // 軸を横切る向き
      float vv = (m == 7 && perp < 0.5) ? v0 * 0.34 * zsq             // 軸に平行に走る線は離れて並ぶ
                                        : v0 * abs(v0) * (mainAx ? 0.26 : 0.20) * zsq;
      // 流れのうねり: 軸に沿って波が走り、要素は流れの向きに首を振る
      float wA = (onAx || isSit) ? 0.0 : 0.045 * flk * min(abs(uu) * 3.3, 1.0);
      float wk = 7.0 * uu * izs - B * 0.42 + phA + (mainAx ? 0.0 : 1.9);
      vv = onAx ? 0.0 : vv + wA * sin(wk);
      vec2 et = e + n * (wA * 7.0 * izs * cos(wk));
      vv = orb ? 0.0 : vv;
      float su = uu < 0.0 ? -1.0 : 1.0;
      float sg = hC.w < 0.5 ? 1.0 : -1.0;
      sg = m == 2 ? (fract(hC.w * 3.7) < 0.75 ? -su : su) : sg;       // 楔は焦点を指す
      sg = (m == 9 && perp < 0.5) ? su : sg;                           // 扇は外へ開く
      float sd = v0 < 0.0 ? -1.0 : 1.0;
      dv = isSit ? e * sd : (perp > 0.5 ? vec2(-et.y, et.x) : et) * sg;
      vv = isSit ? sd * r0 * (ty > 4.5 ? 0.0 : (ty > 3.5 ? 0.5 : 0.22) + 0.4 * hC.w) : vv;
      // はぐれ者は画面に散り、向きも自由
      vec2 fd = vec2(hC.z, hC.w) - 0.5 + 1e-4;
      P = fr ? pf : F + e * uu + n * vv;
      dv = fr ? fd * inversesqrt(dot(fd, fd)) : dv;
      flw = fr ? dv : et * (mainAx ? cs : flwB);
    }
    // 運動: 群れの流れに沿って滑り込み、同じ向きへ抜ける。組み上がっている間はわずかに進む
    P += flw * mo * (sl * (oe * oe - ie * ie) + crp);
    vec2 d0 = q - P;
    vec2 lp = vec2(dot(d0, dv), d0.y * dv.x - d0.x * dv.y);
    float far = max(abs(lp.x) - ext.x, abs(lp.y) - ext.y);
    bool isLn = cat > 1.5 && cat < 2.5;
    far = (isLn && ty > 3.5 && ty < 4.5) ? max(far, abs(length(lp) - r0) - 0.008 * th0) : far;              // 円弧は輪の近くだけ
    far = (isLn && ty > 1.5 && ty < 2.5) ? max(far, max(-lp.x, abs(lp.y) - lp.x * 1.35) - 0.01) : far;      // 扇は開く側だけ
    if(far > aa * 2.0) continue;

    vec4 hD = fract(hB.wzyx * 173.317 + hB.xwzy * 59.771 + 0.61);
    vec4 hE = fract(hB.yxwz * 137.031 + hB.zyxw * 71.93 + 0.19);
    // 円の脈動: beat は 1・2・4 拍ごとの頭で膨らむ。drone はゆっくり息をする
    float pul = 0.0;
    if(cat < 0.5 || cat > 2.5 || ty < 1.5)
      pul = fre ? 0.25 + 0.25 * sin(B * 0.785 + hA.w * 6.2832)
                : exp(-3.0 * fract((bq + floor(hA.w * 4.0)) / nst) * nst) * kk;

    if(cat < 0.5){
      // ── 大円: 外へにじむ光輪 → 色の輪 → 暗い円盤 → ずれた内円 ──
      float r = r0 * (0.35 + 0.65 * pin) * pout * (1.0 + 0.035 * pul);
      float rr = length(d0);
      float d = rr - r;
      float hl = uKdHalo * 0.01;
      vec3 cH = hD.x < 0.45 ? uKdPink : (hD.x < 0.75 ? uKdRed : uKdYellow);
      float gl = clamp(hl * 0.8 * exp(-max(d, 0.0) / (r * 0.42)), 0.0, 1.0) * ein * eout;
      col = mix(col, cH, gl * step(0.0, d));
      pt = max(pt, gl);
      float aR = smoothstep(aa, -aa, d - r * 0.13 * min(hl, 1.5));
      col = mix(col, mix(cH, uKdRed, 0.5), aR * 0.9 * min(hl, 1.0));
      vec3 cD = hD.y < 0.55 ? uKdInk : (hD.y < 0.8 ? mix(uKdInk, uKdViolet, 0.7) : mix(uKdInk, uKdBlue, 0.75));
      float a = smoothstep(aa, -aa, d);
      col = mix(col, cD, a);
      pl = max(pl, max(a, aR * min(hl, 1.0)));
      vec2 oc = d0 - r * 0.16 * vec2(cos(hD.z * 6.2832), sin(hD.z * 6.2832));
      vec3 cI = hD.w < 0.5 ? uKdViolet : (hD.w < 0.8 ? uKdBlue : uKdRed);
      float aI = smoothstep(aa, -aa, length(oc) - r * (0.50 + 0.03 * pul));
      col = mix(col, cI, aI * a);
    } else if(cat < 1.5){
      // ── 面 ──
      float s = (0.3 + 0.7 * pin) * pout;                                // 滑り込みながら膨らむ (ポップで弾む)
      float op = ein * eout > 0.0 ? smoothstep(0.0, 0.25, ein) * smoothstep(0.0, 0.25, eout) : 0.0;
      float r = r0 * s;
      float ow = 0.0016 * th0;
      if(ty < 0.5){
        // 光輪と輪郭の円 (青)
        r *= 1.0 + 0.07 * pul;
        float d = length(d0) - r;
        vec3 c = kd_form(hD.x, uKdBlue);
        if(hD.y < 0.6){
          vec3 cH = hD.y < 0.2 ? uKdInk : (hD.y < 0.4 ? uKdPink : uKdYellow);
          float gl = clamp(uKdHalo * 0.01 * 0.6 * exp(-max(d, 0.0) / (r * 0.4)), 0.0, 1.0) * step(0.0, d) * op;
          col = mix(col, cH, gl);
          pt = max(pt, gl);
        }
        kd_paint(col, pl, c, smoothstep(aa, -aa, d) * op);
        if(hD.z < 0.7){
          float ro = hD.z < 0.3 ? r * 1.22 : r;                          // 少し外を回る細い輪 / 縁取り
          float ao = smoothstep(ow + aa, ow - aa, abs(length(d0) - ro)) * op;
          col = mix(col, uKdInk, ao);
          pt = max(pt, ao);
        }
      } else if(ty < 1.5){
        // 同心円
        r *= 1.0 + 0.07 * pul;
        float rr = length(d0);
        float d = rr - r;
        float nr = 2.0 + floor(hD.y * 3.0);
        float band = floor(rr / r * nr);
        vec3 c = band < 0.5 ? kd_form(hD.x, uKdBlue) : kd_pal(fract(hD.x + band * 0.37));
        kd_paint(col, pl, c, smoothstep(aa, -aa, d) * op);
        float ao = smoothstep(ow + aa, ow - aa, abs(d)) * op;
        col = mix(col, uKdInk, ao);
      } else if(ty < 2.5){
        // 鋭い楔 (黄)。底辺から先端へ伸びる
        float hw = r0 * (lead ? 0.10 + 0.05 * hD.y : 0.05 + 0.13 * hD.y);
        float sk = lead ? 0.0 : (hD.z - 0.5) * hw * 1.6;
        float sc = max(eout, 1e-3);
        vec2 lq = lp / sc;
        float tipx = r0 * (ein - 0.5);
        float d = kd_tri(lq, vec2(tipx, 0.0), vec2(-0.5 * r0, sk + hw), vec2(-0.5 * r0, sk - hw)) * sc;
        if(lead || hD.w < 0.6){
          vec3 c = lead ? (hD.x < 0.45 ? uKdRed : (hD.x < 0.75 ? uKdInk : uKdYellow)) : kd_form(hD.x, uKdYellow);
          float gr = hE.x < 0.5 ? 1.0 : 0.3 + 0.7 * smoothstep(-0.5 * r0, 0.35 * r0, lq.x);   // 底辺へ向かって薄くなる塗り
          kd_paint(col, pl, c, smoothstep(aa, -aa, d) * gr * step(1e-3, ein * eout));
          if(hE.y < 0.4){ float ao = smoothstep(ow + aa, ow - aa, abs(d)); col = mix(col, uKdInk, ao); }
        } else {
          float ao = smoothstep(ow * 1.3 + aa, ow * 1.3 - aa, abs(d)) * step(1e-3, ein * eout);   // 輪郭だけの楔
          col = mix(col, uKdInk, ao);
          pt = max(pt, ao);
        }
      } else if(ty < 3.5){
        // 四角 (赤)
        float d = kd_box(lp, r * vec2(0.5 + 0.75 * hD.y, 0.22 + 0.4 * hC.w));
        vec3 c = kd_form(hD.x, uKdRed);
        float gr = hE.x < 0.6 ? 1.0 : 0.35 + 0.65 * smoothstep(-r, r, lp.x);
        kd_paint(col, pl, c, smoothstep(aa, -aa, d) * gr * op);
        if(hE.y < 0.35){ float ao = smoothstep(ow + aa, ow - aa, abs(d)) * op; col = mix(col, uKdInk, ao); }
      } else if(ty < 4.5){
        // 傾いた格子 / 市松 (片側へすぼまる)
        vec2 hb = vec2(r, r * (0.5 + 0.4 * hC.w));
        float tp = (hD.y - 0.5) * 0.7;
        float yy = lp.y / (1.0 + tp * lp.x / hb.x);
        float d = max(abs(lp.x) - hb.x, (abs(yy) - hb.y) * (1.0 - abs(tp)));
        vec2 nn = vec2(3.0 + floor(hD.z * 4.0), 2.0 + floor(hD.w * 3.0));
        vec2 cu = (vec2(lp.x / hb.x, yy / hb.y) * 0.5 + 0.5) * nn;
        vec2 cc = floor(cu);
        float a = smoothstep(aa, -aa, d) * op;
        if(hE.x < 0.45){
          float chk = mod(cc.x + cc.y, 2.0);
          vec3 ck = mix(uKdPaper, uKdInk, smoothstep(0.15, 0.35, dot(col, vec3(0.333))));   // 暗い下地の上では白黒が入れ替わる
          col = mix(col, ck, a * chk);
          pt = max(pt, a * chk);
        } else {
          float hc = kd_h(vec3(cc, fi + g * 7.0 + seed));
          if(hc > 0.35) kd_paint(col, pl, kd_pal(fract(hc * 5.3 + hD.x)), a);
          vec2 fu = abs(fract(cu) - 0.5);
          vec2 gw = (0.5 - fu) * 2.0 * hb / nn;                           // 升目の線までの距離
          float ao = smoothstep(ow + aa, ow - aa, min(min(gw.x, gw.y), abs(d))) * smoothstep(aa, -aa, d - ow) * op;
          col = mix(col, uKdInk, ao);
          pt = max(pt, ao);
        }
      } else if(ty < 5.5){
        // 半円。直径の線は外まで伸びる
        float d = max(length(lp) - r, -lp.y);
        kd_paint(col, pl, kd_form(hD.x, uKdBlue), smoothstep(aa, -aa, d) * op);
        float ao = smoothstep(ow + aa, ow - aa, max(abs(lp.y), abs(lp.x) - r * 1.4)) * op;
        col = mix(col, uKdInk, ao);
        pt = max(pt, ao);
      } else {
        // 虹の弧 (半分の輪を色の帯に分ける)
        float rr = length(lp), ri = r * 0.42;
        float d = max(max(rr - r, ri - rr), -lp.y);
        float band = floor(clamp((rr - ri) / (r - ri), 0.0, 0.999) * 3.0);
        kd_paint(col, pl, kd_pal(fract(hD.x + band * 0.37)), smoothstep(aa, -aa, d) * op);
      }
    } else if(cat < 2.5){
      // ── 線 ── 一端から描かれ (t1)、同じ向きに消える (t0)
      float L = r0;
      float t1 = ein, t0 = 1.0 - eout;
      float th = (0.0013 + 0.0045 * hD.x * hD.x) * th0;
      vec3 c = hD.y < uKdColor * 0.01 ? kd_pal(fract(hD.y * 7.31)) : uKdInk;
      float d;
      if(ty < 0.5){
        // 貫く直線。主役の 2 本は軸そのもの
        th = lead ? (i == 2 ? 0.0034 : 0.0016) * uKdAxis * 0.01 : (hD.x < 0.72 ? 0.0012 : 0.0036) * th0;
        if(lead) c = uKdInk;
        float s = lp.x + L * 0.5;
        d = max(abs(lp.y) - th, max(t0 * L - s, s - t1 * L));
      } else if(ty < 1.5){
        // 鋭角の折れ線 (一筆で折り返す)
        float w = L * (0.08 + 0.26 * hD.z);
        vec2 E1 = vec2(-0.5 * L, w), Ap = vec2(0.5 * L, 0.0), E2 = mix(Ap, vec2(-0.5 * L, -w * 0.6), 0.35 + 0.65 * hD.w);
        float a1 = clamp(t0 * 2.0, 0.0, 1.0), b1 = clamp(t1 * 2.0, 0.0, 1.0);
        float a2 = clamp(t0 * 2.0 - 1.0, 0.0, 1.0), b2 = clamp(t1 * 2.0 - 1.0, 0.0, 1.0);
        d = 1e3;
        if(b1 > a1) d = kd_seg(lp, mix(E1, Ap, a1), mix(E1, Ap, b1));
        if(b2 > a2) d = min(d, kd_seg(lp, mix(Ap, E2, a2), mix(Ap, E2, b2)));
        d -= th * 1.3;
      } else if(ty < 2.5){
        // 扇: 一点から開く線。振り子のように揺れる
        float sw = 0.22 * turn * sin(tq * 0.785 + hE.x * 6.2832);
        float cw = cos(sw), sn = sin(sw);
        vec2 lr = vec2(cw * lp.x + sn * lp.y, -sn * lp.x + cw * lp.y);
        float nr = 3.0 + floor(hD.z * 5.0);
        float sect = 0.2 + 0.45 * hD.w;
        float stp = 2.0 * sect / (nr - 1.0);
        float an = atan(lr.y, lr.x);
        float k = clamp(floor((an + sect) / stp + 0.5), 0.0, nr - 1.0);
        float da = an - (k * stp - sect);
        float rr = length(lr);
        float Lk = L * (0.55 + 0.45 * kd_h(vec3(k, fi, g + seed)));
        float sx = rr * cos(da);
        d = max(abs(rr * sin(da)) - 0.0012 * th0, max(t0 * Lk - sx, sx - t1 * Lk));
      } else if(ty < 3.5){
        // 細い平行線の束 (端は斜めにずれる)
        float m = 2.0 + floor(hD.z * 4.0);
        float sp = sz * (0.006 + 0.012 * hD.w);
        float k = clamp(floor(lp.y / sp + 0.5), -floor(m * 0.5), floor(m * 0.5));
        float s = lp.x + L * 0.5 + k * sp * 1.5;
        d = abs(lp.y - k * sp) - 0.0011 * th0;
        d = max(d, max(t0 * L - s, s - t1 * L));
      } else if(ty < 4.5){
        // 円弧。回りながら描かれる
        float ro = 0.3 * turn * (hE.x - 0.5) * tq;
        float ext2 = 1.2 + 3.2 * hD.z;
        float an = mod(atan(lp.y, lp.x) - ro + 3.14159, 6.2832);
        d = abs(length(lp) - L) - th;
        d = max(d, max((ext2 * t0 - an) * L, (an - ext2 * t1) * L));
      } else if(ty < 5.5){
        // ふくらむ曲線 (中ほどが太く、両端が細い)
        float s = lp.x + L * 0.5, uu2 = clamp(s / L, 0.0, 1.0);
        float A = L * (0.05 + 0.09 * hD.z);
        float fr = 6.2832 * (0.5 + 0.5 * floor(hD.w * 3.0)) / L;
        float ph = hE.x * 6.2832 + 0.25 * mo * tq;
        float yy = lp.y - A * sin(s * fr + ph);
        float sl2 = A * fr * cos(s * fr + ph);
        d = abs(yy) / sqrt(1.0 + sl2 * sl2) - th * (0.3 + 2.2 * sin(3.14159 * uu2));
        d = max(d, max(t0 * L - s, s - t1 * L));
      } else {
        // 目盛りつきの線
        float s = lp.x + L * 0.5;
        float sp = L / (6.0 + floor(hD.z * 8.0));
        float hl = sz * (0.007 + 0.016 * hD.w);
        float tk = max(abs(mod(s, sp) - sp * 0.5) - 0.0011 * th0, abs(lp.y) - hl);
        d = min(abs(lp.y) - 0.0012 * th0, tk);
        d = max(d, max(t0 * L - s, s - t1 * L));
      }
      float a = smoothstep(aa, -aa, d) * step(1e-3, t1 - t0);
      col = mix(col, c, a);
      pt = max(pt, a);
    } else {
      // ── 点 ── (弾んで現れ、膨らんでから縮んで消える)
      float s = pin * pout;
      vec3 c = hD.y < uKdColor * 0.01 + 0.25 ? kd_pal(fract(hD.y * 5.17)) : uKdInk;
      if(ty < 1.5){
        // 点 / 輪つきの点
        float r = r0 * s * (1.0 + 0.25 * pul);
        float a = smoothstep(aa, -aa, length(d0) - r);
        col = mix(col, c, a);
        pt = max(pt, a);
        if(ty > 0.5){
          float ow = max(r * 0.14, aa);
          float ao = smoothstep(ow + aa, ow - aa, abs(length(d0) - r * 1.9));
          col = mix(col, uKdInk, ao);
          pt = max(pt, ao);
        }
      } else if(ty < 2.5){
        // 点線 (一端から点が並んでいき、同じ向きに消える)
        float L = r0;
        float rd = sz * (0.003 + 0.005 * hD.z);
        float sp = rd * 3.6;
        float sx = lp.x + L * 0.5;
        float k = clamp(floor(sx / sp + 0.5), 0.0, floor(L / sp));
        float vis = step(k * sp, ein * L) * step((1.0 - eout) * L, k * sp);
        float a = smoothstep(aa, -aa, length(vec2(sx - k * sp, lp.y)) - rd) * vis;
        col = mix(col, c, a);
        pt = max(pt, a);
      } else if(ty < 3.5){
        // 小さな輪 (中に色が透ける)
        float r = r0 * s * (1.0 + 0.12 * pul);
        float d = length(d0) - r;
        if(hD.z < 0.5) kd_paint(col, pl, kd_pal(hD.w), smoothstep(aa, -aa, d) * 0.85);
        float ow = 0.0014 * th0;
        float ao = smoothstep(ow + aa, ow - aa, abs(d)) * step(1e-3, s);
        col = mix(col, uKdInk, ao);
        pt = max(pt, ao);
      } else {
        // 点の群れ
        for(int j = 0; j < 5; j++){
          vec4 hj = kd_h4(vec3(fi + float(j) * 13.7, g, seed + 31.0));
          vec2 pj = (hj.xy - 0.5) * 2.4 * r0;
          float rj = r0 * (0.10 + 0.22 * hj.z) * s;
          float a = smoothstep(aa, -aa, length(d0 - pj) - rj);
          col = mix(col, hj.w < 0.6 ? uKdInk : c, a);
          pt = max(pt, a);
        }
      }
    }
  }

  // 紙と絵具のムラ
  if(uKdGrain > 0.0){
    float nz = kd_vn(q0 * 70.0) * 0.5 + kd_vn(q0 * 600.0) * 0.3 + kd_vn(q0 * 6.0) * 0.2;
    col *= 1.0 + (nz - 0.5) * 0.14 * uKdGrain * 0.01;
  }

  float painted = max(pl, pt);
  float al = 1.0 - (1.0 - painted) * uKdClear * 0.01;
  bgAlpha = al;
  return col * al;
}
