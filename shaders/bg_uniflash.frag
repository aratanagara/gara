// =====================================================
// bg_uniflash — 漫画の吹き出しがポンポン出ては消える (手描き風)
//   形: 丸 / ふくらみ多角形 / もこもこ雲 / ギザギザ叫び (細かい・粗い) / ゆるい不定形 / 爆発 / ウニフラ。
//   輪郭は 2 次ベジェ曲線の連なりで組み、線は曲線までの正確な距離で描く (張りのある曲線と一定の線幅)。
//   トゲの辺は内側へ反らせ、折り返し (トゲの先・谷) には線の「たまり」を付ける。
//   しっぽ (話者を指す三角) は付けない。各吹き出しはスケールのオーバーシュートで
//   ポップ出現し、少し膨らんでから縮んで消える。
//   手描きらしさ: 土台のいびつさ (完全な楕円にしない)、トゲ・もこもこの間隔と長さの不揃い、
//   線の強弱と入り抜き (ペンの描き始め / 終わりが細く、少し重なる)。
//   拍子頭には画面全体に集中線 (または平行線) がパッと入って消える。時計は拍
//   (beat モード = 入力の拍、drone モード = uBPM から作る拍)。
//   背景は黒 (vec3(0))、bgAlpha は線と吹き出しの実カバレッジ。中の塗りは背景色、線は uInk。
//   uPaper=100 で白地に黒インクの原稿モード (uInk は無視)。
// =====================================================

// @param uPerMin  0..12   = 1.0   @desc 1 拍あたりの個数の最小。拍ごとに最小〜最大の範囲でランダムな数を続けて出す (整数に丸める)
// @param uPerMax  0..12   = 5.0   @desc 1 拍あたりの個数の最大。両方 0 で吹き出しを出さない (整数に丸める)
// @param uRush    0..100  = 20.0  @desc 連打の確率。拍ごとに抽選し、当たった拍は個数を連打の最大まで増やして、間隔を半分に詰めて一気に出す。0 で連打しない
// @param uRushMax 0..16   = 10.0  @desc 連打する拍の個数の最大 (1 拍あたりの最大〜この数でランダム。整数に丸める)
// @param uLag     0..100  = 14.0  @desc タイミングのずらし幅。同じ拍で続けて出すとき、1 個ごとに遅らせる長さ (0〜0.5 拍)。小さいほどスポポポンと立て続けに出る。0 で拍頭に同時に出る
// @param uLagVar  0..100  = 60.0  @desc タイミングのばらつき。ずらし幅を 1 個ごとに乱数で伸び縮みさせ、1 個目も拍頭から少しずらす。0 で等間隔
// @param uHold    0..100  = 30.0  @desc 寿命。1 つの吹き出しが出ている長さ (0.5〜8 拍)
// @param uPopMin  10..300 = 110.0 @desc 出現 / 消失の速さの最小。吹き出しごとに最小〜最大の範囲でランダム。大きいほどポンと速く出て速く消える
// @param uPopMax  10..300 = 220.0 @desc 出現 / 消失の速さの最大
// @param uJumpMin 0..100  = 20.0  @desc ジャンプ率の最小。ポップ出現で大きさが行き過ぎて跳ねる量 (消えるときの膨らみも同じ)。吹き出しごとに最小〜最大の範囲でランダム。0 で跳ねずに滑らかに出る
// @param uJumpMax 0..100  = 80.0  @desc ジャンプ率の最大
// @param uSizeLo  4..60   = 8.0  @desc 大きさの最小 (画面高に対する %)
// @param uSizeHi  6..80   = 19.0  @desc 大きさの最大 (画面高に対する %)
// @param uAspLo   20..500 = 40.0  @desc 縦横比の最小 (横 / 縦 × 100。100 = 正円、小さいほど縦長)
// @param uAspHi   20..500 = 220.0 @desc 縦横比の最大 (横 / 縦 × 100。大きいほど横長)
// @param uTilt    0..45   = 0.0   @desc 傾きのばらつき (度)。0 で傾けない (斜めの印象を出さない)
// @param uWEllipse 0..100 = 50.0  @desc 丸い吹き出しの出やすさ (形ごとの比率。全部 0 なら丸だけ)
// @param uWBox    0..100  = 30.0  @desc 四角い吹き出し (ナレーション枠のような正確な長方形) の出やすさ。傾けない。角にたまりが付く
// @param uWPoly   0..100  = 50.0  @desc ふくらみ多角形の出やすさ。楕円に沿った 3〜8 本の辺 (三角形も出る。全体は傾けない) を、全部すぼませた吹き出しと全部膨らませた吹き出し (半々。角にたまりが付く)
// @param uWCloud  0..100  = 50.0  @desc もこもこ雲形の出やすさ
// @param uWShoutF 0..100  = 50.0  @desc ギザギザ叫び (細かいトゲ) の出やすさ
// @param uWShoutC 0..100  = 40.0  @desc ギザギザ叫び (粗いトゲ) の出やすさ
// @param uWWavy   0..100  = 40.0  @desc ゆるく波打つ不定形の出やすさ
// @param uWBoom   0..100  = 40.0  @desc 太線の爆発形 (外向きの角 5〜7 本) の出やすさ
// @param uWUni    0..100  = 50.0  @desc ウニフラ (芯の楕円の外へ細い放射線が密に生える) の出やすさ
// @param uThick   4..100  = 40.0  @desc 線幅 (1080p で ×0.1 px)。爆発形は 2.2 倍の太線
// @param uSpikes  6..64   = 26.0  @desc トゲ数。細かい叫びの本数の目安。粗い叫びは 0.4 倍、ウニフラの放射線は長い線 1.3 倍 + 中 3.4 倍 + 根元 7.5 倍
// @param uSharp   0..100  = 60.0  @desc トゲの鋭さ。大きいほどトゲが長く、辺が内側へ反って先が鋭くなる (叫び・爆発・ウニフラ)
// @param uBumps   5..24   = 11.0  @desc もこもこ数。雲形のふくらみの数の目安 (整数に丸める)
// @param uPeakMin 30..200 = 70.0  @desc 山谷の数の最小 (トゲ数・もこもこ数の目安に対する %)。吹き出しごとに最小〜最大の範囲で数を変える (雲・叫び・波打ち・爆発・ウニフラ)
// @param uPeakMax 30..200 = 150.0 @desc 山谷の数の最大 (トゲ数・もこもこ数の目安に対する %)
// @param uPosVar  0..100  = 65.0  @desc 山谷の位置のばらつき。間隔を不揃いにし、片側に寄せて偏らせる。0 で等間隔
// @param uDepthVar 0..100 = 60.0  @desc 山谷の深さ・大きさのばらつき。トゲの長さ、もこもこの大きさ、爆発の角の深さを 1 つずつ変える。0 で揃う
// @param uWobble  0..100  = 40.0  @desc いびつさ。輪郭の土台を卵形・片側がつぶれた形に崩す量と、線のわずかな揺らぎ。0 で正確な楕円
// @param uWeight  0..100  = 25.0  @desc 線の強弱。ペン圧の太い / 細いと、描き始め・終わりの入り抜き (細くなって少し重なる)。0 で均一な線
// @param uPool    0..100  = 60.0  @desc たまり。トゲの先・谷・雲の谷など、線の折り返しでインクが溜まって太る量。0 で均一
// @param uUniSolid 0..100 = 0.0   @desc ウニフラの芯を線の色で塗る量。0 = 芯は塗り (背景色) で、外側に放射線が密に生えるジャンプ式、100 = 芯もベタ塗り
// @param uFill    0..100  = 100.0 @desc 吹き出しの中の塗り (背景色)。0 で中が透けて線だけ
// @param uFx      0..100  = 100.0  @desc 拍子頭の集中線の濃さ。0 で出さない
// @param uFxEvery 1..8    = 1.0   @desc 集中線を入れる間隔 (何拍ごと。整数に丸める)
// @param uFxLife  5..100  = 45.0  @desc 集中線の寿命 (間隔に対する %)。パッと入って、この長さで消える
// @param uFxMix   0..100  = 25.0  @desc 平行線 (スピード線) の割合。片側の画面端から中央へ走って抜け、反対側には描かない。拍ごとに集中線か平行線かを抽選する。100 で平行線だけ
// @param uFxVert  0..100  = 15.0  @desc 縦線ドンの割合。画面の上から下まで途切れない縦線がドン！と入る拍の確率 (集中線・平行線より先に抽選)
// @param uFxDensity 10..100 = 55.0 @desc 集中線・平行線の本数
// @param uFxWeight 20..300 = 100.0 @desc 集中線・平行線の太さ (%)
// @param uFxHole  0..100  = 45.0  @desc 中心の空白の大きさ (縁はいびつに崩れる)
// @param uFxCX    -100..100 = 0.0 @desc 集中線の中心の横位置 (画面幅に対する %、0 = 中央)
// @param uFxCY    -100..100 = 0.0 @desc 集中線の中心の縦位置 (画面高に対する %、0 = 中央)
// @param uFxJitter 0..100 = 30.0  @desc 中心位置を拍ごとにずらす量
// @param uFxAngle -90..90 = 0.0   @desc 平行線の向き (度。0 = 水平)
// @param uDropRate 1..16  = 4.0   @desc ステージを左ドラッグしている間、カーソル位置へ吹き出しを連射する細かさ (1 拍あたりの数。C002 MANGA のマシンガンと同じ)
// @param uDropLife 0..100 = 25.0  @desc ドラッグで出した吹き出しの寿命 (1〜16 拍)。0 で消えない (同時に残るのは最大 32 個、古いものから消える)。C で全部消す
// @param uSeed    0..999  = 1.0   @desc 乱数シード
// @param uPaper   0..100  = 0.0   @desc 原稿モード。白地に黒インク (%)
// @param uInk     color   = #ffffff @desc 線とウニフラ・集中線の色 (原稿モードでは黒)
uniform float uPerMin;
uniform float uPerMax;
uniform float uRush;
uniform float uRushMax;
uniform float uLag;
uniform float uLagVar;
uniform float uHold;
uniform float uPopMin;
uniform float uPopMax;
uniform float uJumpMin;
uniform float uJumpMax;
uniform float uSizeLo;
uniform float uSizeHi;
uniform float uAspLo;
uniform float uAspHi;
uniform float uTilt;
uniform float uWEllipse;
uniform float uWPoly;
uniform float uWBox;
uniform float uWCloud;
uniform float uWShoutF;
uniform float uWShoutC;
uniform float uWWavy;
uniform float uWBoom;
uniform float uWUni;
uniform float uThick;
uniform float uSpikes;
uniform float uSharp;
uniform float uBumps;
uniform float uPeakMin;
uniform float uPeakMax;
uniform float uPosVar;
uniform float uDepthVar;
uniform float uWobble;
uniform float uWeight;
uniform float uPool;
uniform float uUniSolid;
uniform float uFill;
uniform float uFx;
uniform float uFxEvery;
uniform float uFxLife;
uniform float uFxMix;
uniform float uFxVert;
uniform float uFxDensity;
uniform float uFxWeight;
uniform float uFxHole;
uniform float uFxCX;
uniform float uFxCY;
uniform float uFxJitter;
uniform float uFxAngle;
uniform float uDropRate;
uniform float uDropLife;
uniform float uSeed;
uniform vec4  uPlaced[32];    // ドラッグで出した吹き出し: 中心 (画面 px), 半径 (画面 px、0 なら大きさの範囲からランダム) (vj が渡す)
uniform vec4  uPlacedB[32];   // 生まれた time, 生まれた beat, 通し番号, 予備
uniform int   uPlacedN;
uniform float uPaper;
uniform vec3  uInk;

float uf_h(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// c1 = 0 で行き過ぎなし (3 次の ease-out)、大きいほど大きく跳ねる
float uf_easeOutBack(float t, float c1){
  float c3 = c1 + 1.0;
  float u = t - 1.0;
  return 1.0 + c3 * u * u * u + c1 * u * u;
}

// 拍の時計。beat モードは入力の拍 (getBeat())、drone モードは uBPM から作る (1 拍 = 60/BPM 秒。
// freeBeat() は 1 拍あたり 3 倍速いので使わない)
float uf_beats(){
  if(isFree()) return time * max(bpm, 1.0) / 60.0;
  return getBeat();
}

// 不揃いなセル分割。x を n 個に割るが、各境界を ±j/2 セルずつ乱数でずらす (j<1 で順序は保たれる)。
// per > 0 なら per 個で一周する (±π の継ぎ目で番号が回り込む)。戻り値 = (セル番号, セル内位置 -0.5..0.5, セル幅)
float uf_bnd(float i, float j, float per, float sd){
  float id = per > 0.0 ? mod(i, per) : i;
  return i + (uf_h(vec2(id * 1.37 + 0.5, sd)) - 0.5) * j;
}
vec3 uf_cell(float x, float j, float per, float sd){
  float i = floor(x);
  float b0 = uf_bnd(i, j, per, sd);
  float b1 = uf_bnd(i + 1.0, j, per, sd);
  if(x < b0){ i -= 1.0; b1 = b0; b0 = uf_bnd(i, j, per, sd); }
  else if(x >= b1){ i += 1.0; b0 = b1; b1 = uf_bnd(i + 1.0, j, per, sd); }
  float id = per > 0.0 ? mod(i, per) : i;
  return vec3(id, (x - b0) / max(b1 - b0, 1e-4) - 0.5, b1 - b0);
}

float uf_cross(vec2 a, vec2 b){ return a.x * b.y - a.y * b.x; }

// 2 次ベジェ A-C-D までの最短距離と、その点のパラメータ t。
// 距離の微分 = 0 の 3 次方程式を解く (カルダノ / 三角関数解)
vec2 uf_bez(vec2 p, vec2 A, vec2 C, vec2 D){
  vec2 a = C - A;
  vec2 b = A - 2.0 * C + D;
  vec2 d = A - p;
  float bb = dot(b, b);
  if(bb < 1e-10 * max(dot(D - A, D - A), 1e-12)){
    // ほぼ直線: 線分 A-D
    vec2 e = D - A;
    float t = clamp(dot(p - A, e) / max(dot(e, e), 1e-12), 0.0, 1.0);
    return vec2(length(A + e * t - p), t);
  }
  float kk = 1.0 / bb;
  float kx = kk * dot(a, b);
  float ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0;
  float kz = kk * dot(d, a);
  float p3 = ky - kx * kx;
  float q3 = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  float h = q3 * q3 + 4.0 * p3 * p3 * p3;
  vec2 c2 = a * 2.0;
  if(h >= 0.0){
    h = sqrt(h);
    vec2 x = (vec2(h, -h) - q3) * 0.5;
    vec2 uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    vec2 q = d + (c2 + b * t) * t;
    return vec2(length(q), t);
  }
  float z = sqrt(-p3);
  float v = acos(clamp(q3 / (p3 * z * 2.0), -1.0, 1.0)) / 3.0;
  float m = cos(v);
  float n = sin(v) * 1.7320508;
  float t1 = clamp((m + m) * z - kx, 0.0, 1.0);
  float t2 = clamp((-n - m) * z - kx, 0.0, 1.0);
  vec2 q1 = d + (c2 + b * t1) * t1;
  vec2 q2 = d + (c2 + b * t2) * t2;
  float d1 = dot(q1, q1), d2 = dot(q2, q2);
  return d1 < d2 ? vec2(sqrt(d1), t1) : vec2(sqrt(d2), t2);
}

// q から方向 r へ伸ばした半直線が、ベジェ (4 本の弦で近似) と交わる回数
float uf_bezCross(vec2 q, vec2 r, vec2 A, vec2 C, vec2 D){
  vec2 a2 = (C - A) * 2.0;
  vec2 b = A - 2.0 * C + D;
  float cnt = 0.0;
  vec2 P0 = A;
  for(int k = 1; k <= 4; k++){
    float t = float(k) * 0.25;
    vec2 P1 = A + (a2 + b * t) * t;
    vec2 e = P1 - P0;
    float den = uf_cross(r, e);
    if(abs(den) > 1e-12){
      vec2 w = P0 - q;
      float s = uf_cross(w, e) / den;
      float u = uf_cross(w, r) / den;
      if(s > 0.0 && u >= 0.0 && u < 1.0) cnt += 1.0;
    }
    P0 = P1;
  }
  return cnt;
}

// 吹き出しの輪郭を作る共通の枠組み (局所座標 = 吹き出しの中心原点、傾きを戻し、ポップの拡縮を割った空間)
//   土台の楕円 E(A) (いびつさ込み) と、その法線 N(A)。A は楕円の離心角
struct UfBase { vec2 rad; float wob; float q1; float q2; float q3; float cw; float pw; float rot; float n; float pj; float sd; float mode; };

vec2 uf_E(UfBase U, float A){
  // 斜めに見えない成分だけで崩す: 卵形は上下か左右のどちらか一方 (両方だと斜めの卵になる)、
  // 横 / 縦のつぶれ (cos 2A)、角張り (cos 4A)。細部の非対称は節の不揃いが受け持つ
  float egg = 0.06 * (U.q1 / PI - 1.0) * (U.q3 < PI ? sin(A) : cos(A));
  float lop = 1.0 + U.wob * (egg + 0.04 * (U.q2 / PI - 1.0) * cos(2.0 * A) + 0.025 * (U.q3 / PI - 1.0) * cos(4.0 * A));
  return vec2(cos(A) * U.rad.x, sin(A) * U.rad.y) * lop;
}
vec2 uf_N(UfBase U, float A){
  return normalize(vec2(cos(A) / U.rad.x, sin(A) / U.rad.y));
}
// i 番目の節 (山谷の境目) の角度。境目を乱数でずらし (位置のばらつき)、1 周期のゆがみで片側へ寄せる
float uf_nodeA(UfBase U, float i){
  float y = uf_bnd(i, U.pj, U.n, U.sd) / U.n * TAU;
  return y + U.cw * sin(y + U.pw) + U.rot;
}
// 点 q が何番目のセル (節 i と i+1 の間, 0..n-1) にいるか。ゆがみの逆写像はニュートン法で
float uf_cellOf(UfBase U, vec2 q){
  float x = atan(q.y / U.rad.y, q.x / U.rad.x) - U.rot;
  float y = x;
  for(int k = 0; k < 4; k++) y = y - (y + U.cw * sin(y + U.pw) - x) / (1.0 + U.cw * cos(y + U.pw));
  return uf_cell(fract(y / TAU) * U.n, U.pj, U.n, U.sd).x;
}

// 滑らかな形 (楕円・不定形・ウニフラの芯) の節。土台の楕円の点を半径方向に揺らす。
// amp = 揺らす量、dent = へこませる確率 (手塚の吹き出しのふくらみの境目)
vec2 uf_smoothNode(UfBase U, float j, float amp, float dent){
  float hj = uf_h(vec2(mod(j, U.n), U.sd + 3.0));
  float hd = uf_h(vec2(mod(j, U.n), U.sd + 4.0));
  float r = 1.0 + (hj - 0.5) * amp - (hd < dent ? amp * 0.45 : 0.0);
  return uf_E(U, uf_nodeA(U, j)) * r;
}

// 輪郭を 2 次ベジェの連なりで組み、点 q からの符号付き距離 (外が正、局所座標の単位) と
// 輪郭上の位置 (0..1、線の強弱用)、折り返し (トゲの先・谷) への近さ 0..1 (線のたまり用) を返す。q のいるセルの前後の曲線だけを調べる。
// shape: 0=丸 1=雲 2=叫び細 3=叫び粗 4=不定形 5=爆発 6=ウニフラの芯 7=ふくらみ多角形 8=四角
vec3 uf_shapeSD(int shape, UfBase U, vec2 q, float L0, float bend0, float amp, float dent, float dv, float pv){
  float id = uf_cellOf(U, q);
  float dmin = 1e9;
  float tb = 0.5;
  float cr = 0.0;
  vec2 rb;
  vec2 rdir = normalize(q + vec2(1e-6, 0.0));
  if(shape == 8){
    // 四角: 正確な長方形 (辺はまっすぐ、傾けない。角は折り返しでたまりが付く)
    for(int k = 0; k < 4; k++){
      float fk = float(k);
      vec2 P0 = vec2(fk == 0.0 || fk == 3.0 ? U.rad.x : -U.rad.x, fk < 1.5 ? U.rad.y : -U.rad.y);
      vec2 P1 = vec2(fk == 2.0 || fk == 3.0 ? U.rad.x : -U.rad.x, fk == 1.0 || fk == 2.0 ? -U.rad.y : U.rad.y);
      vec2 C = 0.5 * (P0 + P1);
      rb = uf_bez(q, P0, C, P1); if(rb.x < dmin){ dmin = rb.x; tb = rb.y; }
      cr += uf_bezCross(q, rdir, P0, C, P1);
    }
  } else if(shape == 7){
    // ふくらみ多角形: 角と角を、少し膨らむ / すぼむ曲線でつなぐ (角は折り返しになり、たまりが付く)
    for(int k = -1; k <= 1; k++){
      float i = id + float(k);
      float A0 = uf_nodeA(U, i);
      float A1 = uf_nodeA(U, i + 1.0);
      vec2 P0 = uf_E(U, A0);
      vec2 P1 = uf_E(U, A1);
      float hi = mod(i, U.n);
      float h1 = uf_h(vec2(hi, U.sd + 8.0));
      float h2 = uf_h(vec2(hi, U.sd + 9.0));
      float arc = length(P1 - P0);
      vec2 tng = (P1 - P0) / max(arc, 1e-6);
      vec2 nrm = vec2(tng.y, -tng.x);
      if(dot(nrm, uf_N(U, 0.5 * (A0 + A1))) < 0.0) nrm = -nrm;
      // 基準 = 両端の楕円の接線の交点 (この区間の楕円の弧をなぞる)。そこから辺ごとに
      // すぼませる (弦の中点側へ) / 膨らませる (外へ) 向きにずらす
      // 楕円の 2 点での接線の交点 = 中間角の方向に 1/cos(半角) 倍 (円で成り立ち、楕円は円の拡大なので同じ)
      float Am = 0.5 * (A0 + A1);
      vec2 mid = 0.5 * (P0 + P1);
      vec2 Ce = uf_E(U, Am) / max(cos(0.5 * (A1 - A0)), 0.3);
      // mode > 0: 全部の辺をすぼませる (弦より内側へ反る) / mode < 0: 全部の辺を膨らませる (楕円より外へ)。量は辺ごとに変える
      float amt = mix(1.0, mix(0.6, 1.4, h1), dv);
      vec2 C = U.mode > 0.0 ? mid - nrm * arc * 0.06 * amt : Ce + nrm * arc * 0.07 * amt;
      rb = uf_bez(q, P0, C, P1); if(rb.x < dmin){ dmin = rb.x; tb = rb.y; }
      cr += uf_bezCross(q, rdir, P0, C, P1);
    }
  } else if(shape == 1){
    // 雲: 節と節のあいだを丸いふくらみ (四分円に近い 2 本の曲線) でつなぎ、節は鋭い谷になる
    for(int k = -1; k <= 1; k++){
      float i = id + float(k);
      float A0 = uf_nodeA(U, i);
      float A1 = uf_nodeA(U, i + 1.0);
      vec2 P0 = uf_E(U, A0);
      vec2 P1 = uf_E(U, A1);
      float hi = mod(i, U.n);
      float h1 = uf_h(vec2(hi, U.sd + 1.0));
      float h2 = uf_h(vec2(hi, U.sd + 2.0));
      float arc = length(P1 - P0);
      float hgt = arc * mix(0.42, 0.55, h1) * mix(1.0, mix(0.6, 1.25, h2), dv);
      vec2 tng = (P1 - P0) / max(arc, 1e-6);
      vec2 nrm = vec2(tng.y, -tng.x);
      if(dot(nrm, uf_N(U, 0.5 * (A0 + A1))) < 0.0) nrm = -nrm;
      vec2 Ap = 0.5 * (P0 + P1) + nrm * hgt + tng * (h1 - 0.5) * pv * 0.3 * arc;
      vec2 C0 = P0 + nrm * hgt;
      vec2 C1 = P1 + nrm * hgt;
      rb = uf_bez(q, P0, C0, Ap); if(rb.x < dmin){ dmin = rb.x; tb = rb.y * 0.5; }
      rb = uf_bez(q, Ap, C1, P1); if(rb.x < dmin){ dmin = rb.x; tb = 0.5 + rb.y * 0.5; }
      cr += uf_bezCross(q, rdir, P0, C0, Ap) + uf_bezCross(q, rdir, Ap, C1, P1);
    }
  } else if(shape == 0 || shape == 4 || shape == 6){
    // 滑らかな閉曲線 (2 次 B スプライン): 節の中点どうしを、節を制御点にした曲線でつなぐ
    for(int k = -1; k <= 2; k++){
      float j = id + float(k);
      vec2 Pm = uf_smoothNode(U, j - 1.0, amp, dent);
      vec2 Pj = uf_smoothNode(U, j, amp, dent);
      vec2 Pp = uf_smoothNode(U, j + 1.0, amp, dent);
      vec2 M0 = 0.5 * (Pm + Pj);
      vec2 M1 = 0.5 * (Pj + Pp);
      rb = uf_bez(q, M0, Pj, M1); if(rb.x < dmin){ dmin = rb.x; tb = 0.5; }
      cr += uf_bezCross(q, rdir, M0, Pj, M1);
    }
  } else {
    // トゲ (叫び・爆発): 谷 → 先端 → 谷。辺は内側へ反らせる (先が鋭く、根元が太い)
    for(int k = -1; k <= 1; k++){
      float i = id + float(k);
      float A0 = uf_nodeA(U, i);
      float A1 = uf_nodeA(U, i + 1.0);
      float hi = mod(i, U.n);
      float h1 = uf_h(vec2(hi, U.sd + 5.0));
      float h2 = uf_h(vec2(hi, U.sd + 6.0));
      float h3 = uf_h(vec2(hi, U.sd + 7.0));
      float At = mix(A0, A1, 0.5 + (h1 - 0.5) * pv * 0.6);
      vec2 V0 = uf_E(U, A0);
      vec2 V1 = uf_E(U, A1);
      vec2 Bt = uf_E(U, At);
      vec2 T = Bt + uf_N(U, At) * L0 * mix(1.0, mix(0.4, 1.15, h2 * h2 * 0.5 + h2 * 0.5), dv);
      float bend = clamp(bend0 * mix(1.0, mix(0.6, 1.4, h3), dv), 0.0, 0.8);
      vec2 Cm = 0.5 * (Bt + T);
      vec2 C0 = mix(0.5 * (V0 + T), Cm, bend);
      vec2 C1 = mix(0.5 * (T + V1), Cm, bend);
      rb = uf_bez(q, V0, C0, T); if(rb.x < dmin){ dmin = rb.x; tb = rb.y; }
      rb = uf_bez(q, T, C1, V1); if(rb.x < dmin){ dmin = rb.x; tb = rb.y; }
      cr += uf_bezCross(q, rdir, V0, C0, T) + uf_bezCross(q, rdir, T, C1, V1);
    }
  }
  float sgn = mod(cr, 2.0) > 0.5 ? -1.0 : 1.0;
  float corner = 1.0 - smoothstep(0.0, 0.2, min(tb, 1.0 - tb));
  return vec3(dmin * sgn, id / U.n, corner);
}

// 拍子頭の集中線 / 平行線。戻り値はインクのカバレッジ 0..1
float uf_speedFx(vec2 p, float B, float aspect, float zoomPx, float seed){
  float strength = clamp(uFx, 0.0, 100.0) * 0.01;
  if(strength <= 0.0) return 0.0;
  float every = clamp(floor(uFxEvery + 0.5), 1.0, 8.0);
  float ph = max(B, 0.0) / every;
  float bi = floor(ph);
  float age = (ph - bi) * every;
  float life = mix(0.05, 1.0, clamp(uFxLife, 0.0, 100.0) * 0.01) * every;
  if(age >= life) return 0.0;
  float fade = 1.0 - smoothstep(life * 0.35, life, age);
  float grow = age / life;

  vec2 kb = vec2(bi * 1.618, seed + 17.0);
  float g1 = uf_h(kb + 0.11);
  float g2 = uf_h(kb + 0.23);
  float g3 = uf_h(kb + 0.37);
  float g4 = uf_h(kb + 0.49);
  float g5 = uf_h(kb + 0.61);
  float dens = clamp(uFxDensity, 10.0, 100.0) * 0.01;
  float wMul = clamp(uFxWeight, 20.0, 300.0) * 0.01 * zoomPx / 1080.0;
  float jitC = clamp(uFxJitter, 0.0, 100.0) * 0.01;
  vec2 c = vec2(clamp(uFxCX, -100.0, 100.0) * 0.01 * aspect * 0.5, clamp(uFxCY, -100.0, 100.0) * 0.01 * 0.5);
  c += (vec2(g1, g2) - 0.5) * vec2(aspect, 1.0) * 0.35 * jitC;

  // 中心の空白: 横長でいびつな卵形。寿命のあいだに少し広がる
  vec2 q = p - c;
  float th = atan(q.y, q.x);
  float pp = g3 * TAU;
  float holeR = mix(0.08, 0.62, clamp(uFxHole, 0.0, 100.0) * 0.01)
              * (1.0 + 0.16 * sin(th * 2.0 + pp) + 0.11 * sin(th * 3.0 + pp * 2.3) + 0.07 * sin(th * 5.0 + pp * 3.7))
              * (1.0 + 0.18 * grow);
  float rr = length(q * vec2(0.8, 1.0));

  float cov = 0.0;
  // 拍ごとに種類を抽選: 縦線ドン / 平行線 / 集中線
  float pV = clamp(uFxVert, 0.0, 100.0) * 0.01;
  float pS = clamp(uFxMix, 0.0, 100.0) * 0.01;
  int kind = g4 < pV ? 2 : (g4 < pV + (1.0 - pV) * pS ? 1 : 0);
  if(kind == 0){
    // 集中線: 外側が太く、中心へ向かって針のように抜ける。束と隙間、始点 (内側の端) は不揃い
    float a = fract(th / TAU + 0.5 + g5);
    for(int L = 0; L < 2; L++){
      float fl = float(L);
      float n = floor(mix(70.0, 300.0, dens) * (fl > 0.5 ? 1.9 : 1.0));
      float sd = seed + bi * 3.1 + fl * 41.0;
      vec3 cl = uf_cell(a * n, 0.85, n, sd);
      float h1 = uf_h(vec2(cl.x, sd + 1.0));
      float h2 = uf_h(vec2(cl.x, sd + 2.0));
      float h3 = uf_h(vec2(cl.x, sd + 3.0));
      float h4 = uf_h(vec2(cl.x, sd + 4.0));
      // 束: 低周波で線を間引き、2〜4 本のまとまりと隙間を作る
      float clump = 0.5 + 0.5 * sin(a * TAU * 9.0 + g5 * 20.0 + fl) * sin(a * TAU * 4.0 + g3 * 11.0);
      if(h4 < (fl > 0.5 ? 0.55 : 0.25) + 0.35 * clump - 0.25 * dens) continue;
      float kc = (h1 - 0.5) * 0.5;
      float wpx = mix(0.7, fl > 0.5 ? 2.0 : 5.0, h2 * h2) * wMul;
      float rs = holeR * mix(0.82, fl > 0.5 ? 2.4 : 1.9, h3) * (1.0 + 0.12 * sin(a * TAU * 13.0 + h1 * 6.0));
      float t = clamp((rr - rs) / 0.5, 0.0, 1.0);
      float hw = wpx * pow(t, 0.75);
      float perp = abs(cl.y - kc) * cl.z * TAU * length(q) / n * zoomPx;
      cov = max(cov, clamp(hw - perp + 0.5, 0.0, 1.0) * step(rs, rr));
    }
  } else if(kind == 1){
    // 平行線: 片側の画面端から中央へ向かって走り、先が細く抜けて消える。反対側には描かない。
    // 長さ (どこで抜けるか)・太さ・間隔はばらばら
    float ang = radians(clamp(uFxAngle, -90.0, 90.0));
    float cs = cos(ang), sn = sin(ang);
    vec2 uv = vec2(cs * p.x + sn * p.y, -sn * p.x + cs * p.y);
    float side = g1 < 0.5 ? -1.0 : 1.0;
    float rows = mix(40.0, 170.0, dens);
    float sd = seed + bi * 5.3;
    vec3 cl = uf_cell(uv.y * rows + 500.0, 0.85, 0.0, sd);
    float h1 = uf_h(vec2(cl.x, sd + 1.0));
    float h2 = uf_h(vec2(cl.x, sd + 2.0));
    float h3 = uf_h(vec2(cl.x, sd + 3.0));
    float h4 = uf_h(vec2(cl.x, sd + 4.0));
    float clump = 0.5 + 0.5 * sin(uv.y * 23.0 + g3 * 9.0) * sin(uv.y * 9.0 + g2 * 7.0);
    if(h4 >= 0.2 + 0.35 * clump - 0.2 * dens){
      float edge = aspect * 0.62;                                   // 画面端 (少し外から)
      float stop = mix(-0.08, 0.45, h1 * h1 * 0.6 + h2 * 0.4) * aspect * 0.5;   // 抜ける位置 (中央付近〜端寄り)
      if(h2 > 0.86) stop = -aspect * 0.62;                           // 一部は反対側の端まで届く
      float x = side * uv.x;                                         // 端の側が +
      float t = (edge - x) / max(edge - stop, 1e-3);                // 0 = 端、1 = 抜ける先
      float wpx = mix(0.6, 3.8, h3 * h3) * wMul * pow(clamp(1.0 - t, 0.0, 1.0), 0.7);
      float perp = abs(cl.y) * cl.z / rows * zoomPx;
      cov = clamp(wpx - perp + 0.5, 0.0, 1.0) * step(0.0, t) * step(t, 1.0);
    }
  } else {
    // 縦線ドン: 画面の上から下まで途切れない縦線。太さと間隔はばらばら、束と隙間がある
    float cols = mix(30.0, 130.0, dens);
    float sd = seed + bi * 7.7;
    vec3 cl = uf_cell(p.x * cols + 500.0, 0.85, 0.0, sd);
    float h1 = uf_h(vec2(cl.x, sd + 1.0));
    float h3 = uf_h(vec2(cl.x, sd + 3.0));
    float h4 = uf_h(vec2(cl.x, sd + 4.0));
    float clump = 0.5 + 0.5 * sin(p.x * 17.0 + g3 * 9.0) * sin(p.x * 6.0 + g2 * 5.0);
    if(h4 >= 0.15 + 0.3 * clump - 0.15 * dens){
      float kc = (h1 - 0.5) * 0.4;
      float wpx = mix(0.7, 6.0, h3 * h3) * wMul;
      float perp = abs(cl.y - kc) * cl.z / cols * zoomPx;
      cov = clamp(wpx - perp + 0.5, 0.0, 1.0);
    }
  }
  return cov * fade * strength;
}

// 吹き出し 1 個を描く (拍のポップとドラッグで置いた吹き出しの共通部)。
// c = 中心、rad = 半径 (局所の縦横)、sz = 大きさの基準、sc = ポップの拡縮、alpha = 消えるときの透明度、key = 乱数の鍵
int uf_pickShape(float h){
  float w0 = max(uWEllipse, 0.0);
  float w1 = max(uWCloud, 0.0);
  float w2 = max(uWShoutF, 0.0);
  float w3 = max(uWShoutC, 0.0);
  float w4 = max(uWWavy, 0.0);
  float w5 = max(uWBoom, 0.0);
  float w6 = max(uWUni, 0.0);
  float w7 = max(uWPoly, 0.0);
  float w8 = max(uWBox, 0.0);
  float wSum = w0 + w1 + w2 + w3 + w4 + w5 + w6 + w7 + w8;
  int shape = 0;
  if(wSum > 0.0){
    float pick = h * wSum;
    float acc = w0;
    if(pick >= acc){ shape = 1; acc += w1; }
    if(pick >= acc){ shape = 2; acc += w2; }
    if(pick >= acc){ shape = 3; acc += w3; }
    if(pick >= acc){ shape = 4; acc += w4; }
    if(pick >= acc){ shape = 5; acc += w5; }
    if(pick >= acc){ shape = 6; acc += w6; }
    if(pick >= acc){ shape = 7; acc += w7; }
    if(pick >= acc){ shape = 8; }
  }
  return shape;
}

void uf_balloon(inout vec3 rgb, inout float a, vec2 p, vec2 c, vec2 rad, float sz, float tilt, int shape,
                float sc, float alpha, vec2 key, float h5, float h6, vec3 inkCol, vec3 fillCol, float zoomPx){
  float sharp = clamp(uSharp, 0.0, 100.0) * 0.01;
  float nSpk = floor(clamp(uSpikes, 6.0, 64.0) + 0.5);
  float nBump = floor(clamp(uBumps, 5.0, 24.0) + 0.5);
  float pv = clamp(uPosVar, 0.0, 100.0) * 0.01;
  float dv = clamp(uDepthVar, 0.0, 100.0) * 0.01;
  float cmLo = clamp(min(uPeakMin, uPeakMax), 30.0, 200.0) * 0.01;
  float cmHi = clamp(max(uPeakMin, uPeakMax), 30.0, 200.0) * 0.01;
  float wobA = clamp(uWobble, 0.0, 100.0) * 0.01;
  float wt = clamp(uWeight, 0.0, 100.0) * 0.01;
  float hw0 = 0.5 * max(uThick, 0.0) * 0.1 * zoomPx / 1080.0;
  float fillAmt = clamp(uFill, 0.0, 100.0) * 0.01;
  float cs = cos(tilt), sn = sin(tilt);
  vec2 d = (p - c) / sc;
  d = vec2(cs * d.x + sn * d.y, -sn * d.x + cs * d.y);

  float s = h5 * 0.917 + h6 * 0.31;
  float cm = mix(cmLo, cmHi, uf_h(key + 1.45));
  float hn = uf_h(key + 1.57);
  // 形ごとの山谷の数・トゲの長さ・反り
  float n = 7.0;
  float L0 = 0.0;
  float bend0 = mix(0.05, 0.5, sharp);
  float amp = 0.05 + 0.06 * wobA;
  float dent = 0.0;
  float ext = 0.25;
  if(shape == 0){ n = 8.0; amp = 0.01 + 0.02 * wobA; }
  else if(shape == 7){ n = clamp(floor(mix(3.0, 8.999, hn)), 3.0, 8.0); ext = 0.35; }
  else if(shape == 8){ n = 4.0; ext = 0.5; rad *= 0.85; }
  else if(shape == 1){ n = max(5.0, floor(nBump * cm + 0.5)); ext = 0.55; }
  else if(shape == 2){ n = max(8.0, floor(nSpk * cm + 0.5)); L0 = sz * mix(0.09, 0.2, sharp); ext = 0.3; }
  else if(shape == 3){ n = max(5.0, floor(nSpk * 0.4 * cm + 0.5)); L0 = sz * mix(0.2, 0.42, sharp); ext = 0.55; rad *= 0.9; }
  else if(shape == 4){ n = clamp(floor(mix(4.0, 7.0, hn) * cm + 0.5), 3.0, 12.0); amp = mix(0.14, 0.34, dv); dent = 0.35; }
  else if(shape == 5){ n = clamp(floor((5.0 + floor(hn * 2.999)) * cm + 0.5), 4.0, 11.0); L0 = sz * mix(0.45, 0.75, sharp); bend0 = min(bend0 * 1.35, 0.7); ext = 0.9; rad *= 0.75; }
  else { n = 9.0; amp = 0.1 + 0.08 * dv; ext = 1.3; }
  if(length(d) > max(rad.x, rad.y) * 1.2 + ext * sz) return;

  // 手描きの癖 (吹き出しごと): いびつさの位相、ペン圧の向き、描き始め / 終わりの位置
  UfBase U;
  U.rad = rad;
  U.wob = wobA;
  U.q1 = uf_h(key + 0.85) * TAU;
  U.q2 = uf_h(key + 0.97) * TAU;
  U.q3 = uf_h(key + 1.09) * TAU;
  U.cw = pv * 0.55;
  U.pw = floor(uf_h(key + 1.69) * 3.999) * 0.5 * PI;   // 山谷を寄せる向きは上下左右のどれか
  U.rot = s * TAU;
  U.n = n;
  U.pj = pv * 0.85;
  U.sd = s * 97.0 + 13.0;
  U.mode = uf_h(key + 2.05) < 0.5 ? 1.0 : -1.0;
  if(shape == 7){
    // ふくらみ多角形は傾いて見えないよう、角を等間隔にして頂点か辺が真上に来る向きに固定
    U.pj = pv * 0.55;
    U.cw = 0.0;
    U.rot = 0.5 * PI + (uf_h(key + 2.17) < 0.5 ? 0.0 : PI / n);
  }
  float thP = uf_h(key + 1.21);
  float thS = uf_h(key + 1.33);

  vec3 sd = uf_shapeSD(shape, U, d, L0, bend0, amp, dent, dv, pv);
  float dpx = sd.x * sc * zoomPx;
  float inside = clamp(0.5 - dpx, 0.0, 1.0);

  if(shape == 6){
    // ウニフラ: 芯の楕円の外へ、細い線を長短ばらばらに密に放射する。根元は線どうしが溶け合って
    // 黒い帯になり、輪郭線そのものは描かない。芯の中は塗り (uUniSolid で線の色に)
    float szPx = sz * sc * zoomPx;
    float Ae = atan(d.y / rad.y, d.x / rad.x);
    float aU = fract(Ae / TAU + 0.5 + s);
    float arcPerRad = length(vec2(rad.x * sin(Ae), rad.y * cos(Ae))) * sc * zoomPx;
    float p0 = s * TAU;
    float env = mix(1.0, 0.45 + 0.55 * smoothstep(-0.6, 0.9, sin(Ae * 2.0 + p0 * 3.0) + 0.7 * sin(Ae * 5.0 + p0 * 7.0)), dv);
    float ray = 0.0;
    for(int Ly = 0; Ly < 3; Ly++){
      float fl = float(Ly);
      float nn = floor(nSpk * (fl < 0.5 ? 1.3 : (fl < 1.5 ? 3.4 : 7.5)) * cm + 0.5);
      float sdL = U.sd + 31.0 + fl * 17.0;
      vec3 cl = uf_cell(aU * nn, 0.8, nn, sdL);
      float g1 = uf_h(vec2(cl.x, sdL + 1.0));
      float g2 = uf_h(vec2(cl.x, sdL + 2.0));
      float g3 = uf_h(vec2(cl.x, sdL + 3.0));
      float lenF = fl < 0.5 ? mix(0.5, 1.0, g1) * env : (fl < 1.5 ? mix(0.18, 0.6, pow(g1, 1.3)) * mix(1.0, env, 0.6) : mix(0.05, 0.22, g1));
      float len = lenF * szPx;
      float spacing = cl.z * TAU / nn * arcPerRad;
      float kc = (g2 - 0.5) * 0.4;
      float t = clamp(dpx / max(len, 1.0), 0.0, 1.0);
      float wb = spacing * mix(0.5, 0.95, g3) * (fl > 1.5 ? 1.1 : 0.8);
      float hwR = 0.5 * wb * pow(1.0 - t, mix(1.1, 2.4, sharp));
      float perp = abs(cl.y - kc) * spacing * (1.0 + max(dpx, 0.0) / max(szPx, 1.0));
      ray = max(ray, clamp(hwR - perp + 0.5, 0.0, 1.0) * step(-1.0, dpx) * step(dpx, len));
    }
    float solid = clamp(uUniSolid, 0.0, 100.0) * 0.01;
    float covC = inside * alpha;
    rgb = mix(rgb, mix(fillCol, inkCol, solid), covC * mix(fillAmt, 1.0, solid));
    a = mix(a, 1.0, covC * mix(fillAmt, 1.0, solid));
    float covR = ray * alpha * (1.0 - inside);
    rgb = mix(rgb, inkCol, covR);
    a = mix(a, 1.0, covR);
  } else {
    // 線の強弱: ペン圧で太く / 細く (ゆるやかに)、描き始め・終わりは細く抜ける
    float u = sd.y;
    float press = 1.0 + 0.35 * sin(TAU * (u + thP)) + 0.1 * sin(TAU * (2.0 * u + thP * 3.0));
    float psi = abs(fract(u - thS + 0.5) - 0.5) * TAU;
    float taper = mix(0.35, 1.0, smoothstep(0.0, 0.5, psi));
    float wMod = mix(1.0, max(press, 0.5) * taper, wt);
    // たまり: 折り返し (トゲの先・谷、雲の谷) でインクが溜まって線が太る
    float pool = 1.0 + clamp(uPool, 0.0, 100.0) * 0.012 * sd.z;
    float hw = hw0 * (shape == 5 ? 2.2 : 1.0) * max(sc, 0.3) * wMod * pool;
    // 線は曲線を中心に描く (内外の判定は弦の近似なので、曲線のすぐそばでは塗りにだけ使う)
    float covLine = clamp(hw - abs(dpx) + 0.5, 0.0, 1.0) * alpha;
    if(shape == 8){
      // 長方形の頂点のにじみ: 角にインクが溜まって縁がぼけた丸い染み
      float dc = length(abs(d) - rad) * sc * zoomPx;
      float rB = hw * (1.0 + clamp(uPool, 0.0, 100.0) * 0.007);
      float feather = max(hw * 1.6, 1.0);
      covLine = max(covLine, (1.0 - smoothstep(rB - feather, rB + feather, dc)) * 0.85 * alpha);
    }
    float inner = clamp(0.5 - (dpx + hw), 0.0, 1.0);
    float covFill = inner * alpha * fillAmt;
    rgb = mix(rgb, fillCol, covFill);
    a = mix(a, 1.0, covFill);
    rgb = mix(rgb, inkCol, covLine);
    a = mix(a, 1.0, covLine);
  }
}

// 出現のポップ (オーバーシュートで出て、少し膨らんで縮んで消える)。x = (拡縮, 透明度)
vec2 uf_pop(float age, float L, vec2 key){
  float jLo = clamp(min(uJumpMin, uJumpMax), 0.0, 100.0) * 0.01;
  float jHi = clamp(max(uJumpMin, uJumpMax), 0.0, 100.0) * 0.01;
  float pLo = clamp(min(uPopMin, uPopMax), 1.0, 300.0) * 0.01;
  float pHi = clamp(max(uPopMin, uPopMax), 1.0, 300.0) * 0.01;
  // ジャンプ率と出現の速さは吹き出しごとに範囲内でランダム
  float c1 = 4.5 * mix(jLo, jHi, uf_h(key + 1.81));
  float spd = mix(pLo, pHi, uf_h(key + 1.93));
  float inD = min(0.4 / spd, L * 0.45);
  float outD = min(0.32 / spd, L * 0.45);
  float sIn = uf_easeOutBack(clamp(age / inD, 0.0, 1.0), c1);
  float xOut = clamp((L - age) / outD, 0.0, 1.0);
  return vec2(sIn * uf_easeOutBack(xOut, c1 * 0.6), smoothstep(0.0, 0.45, xOut));
}

vec3 bg_uniflash(vec2 fc){
  float paper = clamp(uPaper, 0.0, 100.0) * 0.01;
  vec3 fillCol = vec3(paper);
  vec3 inkCol = mix(uInk, vec3(0.0), paper);
  vec3 rgb = fillCol;
  float a = paper;

  vec2 I = (fc - resolution * 0.5) / max(bgZoom, 0.001) + resolution * 0.5 + bgCamPx;
  vec2 p = (I - 0.5 * resolution) / resolution.y;
  float zoomPx = resolution.y * max(bgZoom, 0.001);
  float aspect = resolution.x / max(resolution.y, 1.0);
  float B = uf_beats();
  float seed = floor(uSeed + 0.5);
  float lo = min(uSizeLo, uSizeHi) * 0.01;
  float hi = max(uSizeLo, uSizeHi) * 0.01;
  float aLo = log(max(min(uAspLo, uAspHi), 1.0) * 0.01);
  float aHi = log(max(max(uAspLo, uAspHi), 1.0) * 0.01);

  // 集中線は吹き出しの下 (吹き出しの塗りで隠れる)
  float fx = uf_speedFx(p, B, aspect, zoomPx, seed);
  rgb = mix(rgb, inkCol, fx);
  a = mix(a, 1.0, fx);

  float nMin = clamp(floor(min(uPerMin, uPerMax) + 0.5), 0.0, 12.0);
  float nMax = clamp(floor(max(uPerMin, uPerMax) + 0.5), 0.0, 12.0);
  if(nMax > 0.0){
    float L = mix(0.5, 8.0, pow(clamp(uHold, 0.0, 100.0) * 0.01, 1.5));
    float lag = mix(0.0, 0.5, clamp(uLag, 0.0, 100.0) * 0.01);
    float lagV = clamp(uLagVar, 0.0, 100.0) * 0.01;
    float rushP = clamp(uRush, 0.0, 100.0) * 0.01;
    float rushN = max(nMax, clamp(floor(uRushMax + 0.5), 0.0, 16.0));
    float nTop = rushP > 0.0 ? rushN : nMax;
    float maxOff = nTop * lag * (1.0 + 0.8 * lagV) + 0.5 * lag * lagV;
    int nBack = int(ceil(L + maxOff)) + 1;
    int iMax = int(nTop);
    float b0 = floor(B);

    // 古い拍から順に描く (新しい吹き出しが上に重なる)
    for(int bk = 0; bk < nBack; bk++){
     float bb = b0 - float(nBack - 1 - bk);
     float nb = floor(mix(nMin, nMax + 0.999, uf_h(vec2(bb * 0.731 + 9.0, seed + 2.0))));
     // 連打の拍: 個数を増やし、間隔を半分に詰める
     bool rush = uf_h(vec2(bb * 0.577 + 3.0, seed + 8.0)) < rushP;
     if(rush) nb = floor(mix(nMax, rushN + 0.999, uf_h(vec2(bb * 0.311 + 5.0, seed + 9.0))));
     float lagB = rush ? lag * 0.5 : lag;
     float off = lagV * uf_h(vec2(bb * 0.917 + 1.0, seed + 4.0)) * lagB * 0.5;
     for(int j = 0; j < iMax; j++){
      float fj = float(j);
      if(fj >= nb) break;
      if(j > 0) off += lagB * (1.0 + (uf_h(vec2(bb * 1.3 + fj, seed + 6.0)) - 0.5) * 1.6 * lagV);
      float age = B - (bb + off);
      if(age < 0.0 || age >= L) continue;

      vec2 key = vec2(bb * 1.618 + fj * 11.0, seed);
      vec2 pop = uf_pop(age, L, key);
      if(pop.x < 0.03 || pop.y <= 0.0) continue;
      float h1 = uf_h(key + 0.11);
      float h2 = uf_h(key + 0.23);
      float h3 = uf_h(key + 0.37);
      float h4 = uf_h(key + 0.49);
      float h5 = uf_h(key + 0.61);
      float h6 = uf_h(key + 0.73);
      int shape = uf_pickShape(h6);
      float sz = mix(lo, hi, h3) * (shape == 6 ? 1.2 : 1.0);
      float asp = exp(mix(aLo, aHi, h4));
      vec2 rad = sz * vec2(sqrt(asp), 1.0 / sqrt(asp));
      vec2 c = (vec2(h1, h2) - 0.5) * vec2(aspect * 0.82, 0.78);
      float tilt = (h5 - 0.5) * 2.0 * radians(clamp(uTilt, 0.0, 45.0));
      uf_balloon(rgb, a, p, c, rad, sz, tilt, shape, pop.x, pop.y, key, h5, h6, inkCol, fillCol, zoomPx);
     }
    }
  }

  // ドラッグで連射した吹き出し (vj が uPlaced に渡す)。拍のポップより上に重ねる
  float dropL = uDropLife > 0.0 ? mix(1.0, 16.0, clamp(uDropLife, 0.0, 100.0) * 0.01) : 1e6;
  for(int i = 0; i < 32; i++){
    if(i >= uPlacedN) break;
    vec4 P = uPlaced[i];
    vec4 Q = uPlacedB[i];
    vec2 key = vec2(Q.z * 7.31 + 101.0, seed + 31.0);
    float h3 = uf_h(key + 0.37);
    float h4 = uf_h(key + 0.49);
    float h5 = uf_h(key + 0.61);
    float h6 = uf_h(key + 0.73);
    int shape = uf_pickShape(h6);
    // 中心と半径は画面の px で届く → この画面の座標へ (ズーム / パンも同じ式で)
    vec2 Ic = (P.xy - resolution * 0.5) / max(bgZoom, 0.001) + resolution * 0.5 + bgCamPx;
    vec2 c = (Ic - 0.5 * resolution) / resolution.y;
    vec2 rad = P.zw / (resolution.y * max(bgZoom, 0.001));
    float sz = sqrt(max(rad.x * rad.y, 1e-8));
    if(min(P.z, P.w) < 4.0){
      // 大きさと縦横比は範囲からランダム (拍のポップと同じ)
      sz = mix(lo, hi, h3) * (shape == 6 ? 1.2 : 1.0);
      float asp = exp(mix(aLo, aHi, h4));
      rad = sz * vec2(sqrt(asp), 1.0 / sqrt(asp));
    }
    float birth = isFree() ? Q.x * max(bpm, 1.0) / 60.0 : Q.y;
    vec2 pop = uf_pop(max(B - birth, 0.0), dropL, key);
    if(pop.x < 0.03 || pop.y <= 0.0) continue;
    uf_balloon(rgb, a, p, c, rad, sz, 0.0, shape, pop.x, pop.y, key, h5, h6, inkCol, fillCol, zoomPx);
  }

  bgAlpha = a;
  return rgb;
}
