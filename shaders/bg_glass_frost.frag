// =====================================================
// bg_glass_frost — Glass Frost
//   すりガラスの面が、霜が結晶するようにまだらな島から広がってつながり、徐々に現れる (島の縁もガラスの縁)。
//   しばらく残ると、まだらに溶けて消え、別の形で現れ直す (uLife 拍ごと。拍が無ければ uLife 秒ごと。面ごとにずれる)。
//   2 枚構成:
//     分割のレイヤー — 細胞のように平面を隙間なく埋めるセル (ワープで境界を曲げたボロノイ分割、uWarp)。
//       セルごとに現れては消える (uCells = 現れるセルの割合、uCellSize = セルの大きさ)。境界は細い稜線になる。
//     重ねるレイヤー — その上に重なる、波打つ輪郭の横長の面。大きさを小・中・大の 3 段にしてジャンプ率を高くし、
//       小さい面は粗密の場の濃い所に群れ、中くらいの面は薄い所に余白をつくり (uDensity)、画面ほどの大きな面が
//       まばらに重なる (uBig)。小さいほど周期が短い。大きな面の下には薄い影 (uShadow)。
//   面とセルは全部足し合わせて描くので、上の面越しに下の面やセルの縁が透けて見え、重なるほどすりガラスのぼけと
//   乳白が濃くなる (uFrost)。面には砂を吹いたような細かい粒の凹凸と、まだらな曇りがある (uGrain)。
//   Slot B に置くと、ガラスの外は透過し、ガラスの中は Slot A の絵が屈折し (uRefract)、色が分かれ、粒のあるぼけで見える。
//   iChannel0 = Slot A (manifest の ch で束縛)。
//   Slot A に置いたときは、uBgColor が黒なら淡いラベンダーと桃色の地 (uWarm)、黒以外ならその色を透かす。
//   縁は細く白く光り、薄い虹色 (uIris)。中は刷毛の跡のようなストロークの筋 (uStroke) の帯と、盛り上がった小さな玉が
//   蜂の巣状に並ぶ粒々 (uDots) の帯が、面の向きに沿って交互に並ぶ。
//   拍 (getBeat) と音 (iAudio) で屈折が強まる (uKick)。法線は高さ場の画面微分 (dFdx / dFdy) から取る。
//   参照したのは Studio Brasch の作品のガラスの質感。形と配置は乱数から手続き生成していて、トレースではない。
//   bgZoom / bgCamPx でズームとパン (Slot A の絵は画面の位置のまま読む)。
// =====================================================

// @param uSpeed    0..300  = 100.0
// @param uCells    0..100  = 100.0
// @param uCellSize 30..300 = 100.0
// @param uWarp     0..200  = 100.0
// @param uDensity  0..100  = 70.0
// @param uBig      0..100  = 45.0
// @param uLife     1..32   = 12.0
// @param uSize     30..300 = 100.0
// @param uStroke   0..200  = 100.0
// @param uDots     0..200  = 100.0
// @param uRefract  0..300  = 100.0
// @param uFrost    0..200  = 70.0
// @param uGrain    0..200  = 100.0
// @param uIris     0..200  = 100.0
// @param uShadow   0..200  = 100.0
// @param uWarm     0..200  = 100.0
// @param uKick     0..200  = 60.0
// @param uSeed     0..100  = 0.0
uniform float uSpeed;    // 輪郭のゆらぎ・セルの漂いの速さ (%)
uniform float uCells;    // 分割のレイヤー: 現れるセルの割合 (%)。0 でレイヤーごと消える
uniform float uCellSize; // 分割のレイヤー: セルの大きさ (%)
uniform float uWarp;     // 分割のレイヤー: セルの境界の曲がり (%。ボロノイ分割にかけるワープ)
uniform float uDensity;  // 重ねるレイヤー: 小と中の面が置かれる割合 (%)
uniform float uBig;      // 重ねるレイヤー: 極端に大きな面が置かれる割合 (%。粗い格子)
uniform float uLife;     // 面とセルが現れ直す間隔 (拍。拍が無ければ秒)
uniform float uSize;     // 重ねるレイヤーの面の大きさ (%)
uniform float uStroke;   // ストロークの筋 (刷毛の跡) の強さ (%)
uniform float uDots;     // 粒々 (盛り上がった小さな玉) の強さ (%)
uniform float uRefract;  // 屈折の強さ (%)
uniform float uFrost;    // すりガラスのぼけ・乳白 (%)
uniform float uGrain;    // すりガラスの粒 (%。砂を吹いた面の細かい凹凸と、まだらな曇り)
uniform float uIris;     // 縁の虹色 (%)
uniform float uShadow;   // 重ねるレイヤーの面の下の影 (%)
uniform float uWarm;     // Slot A のときの地の桃色の光 (%)
uniform float uKick;     // 拍 / 音で屈折が強まる量 (%)
uniform float uSeed;     // 配置のシード

// ─── 乱数 / ノイズ ────────────────────────────────────────
float gf_h1(float n){
  n = fract(n * 0.1031);
  n *= n + 33.33;
  n *= n + n;
  return fract(n);
}
float gf_h2(vec2 p){
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float gf_vn(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gf_h2(i), gf_h2(i + vec2(1.0, 0.0)), f.x), mix(gf_h2(i + vec2(0.0, 1.0)), gf_h2(i + vec2(1.0, 1.0)), f.x), f.y);
}
mat2 gf_rot(float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

vec2  gfUV;      // この画素の Slot A の uv
float gfAsp;     // 画面の横 / 縦
float gfZoom;    // bgZoom (p 単位 → 画面の単位)
float gfPaperOn; // Slot A で uBgColor が黒 = 地を描く

// Slot A のときの地 (淡いラベンダー → 右下の桃色の光)。uBgColor が黒以外ならその色
vec3 gf_paper(vec2 p){
  if(gfPaperOn < 0.5) return uBgColor;
  vec3 col = mix(vec3(0.86, 0.79, 0.86), vec3(0.84, 0.82, 0.86), smoothstep(-0.6, 0.6, p.y));
  float gx = gfAsp * 0.30;
  float glow = exp(-pow((p.x - gx) / 0.30, 2.0)) * smoothstep(0.7, -0.5, p.y);
  col = mix(col, vec3(0.97, 0.67, 0.58), clamp(glow * 0.85 * max(uWarm, 0.0) * 0.01, 0.0, 1.0));
  return mix(col, vec3(0.58, 0.48, 0.64), smoothstep(gx + 0.20, gx + 0.55, p.x) * 0.45);
}
// ガラス越しの奥の色: off だけずらし、半径 r のすりガラスでぼかす (Slot B は Slot A の絵、Slot A は地)。
// 8 点を画素ごとに回して読む (細かい粒のあるぼけ)。点ごとにずれの倍率と色の重みを変え、色の分かれも同じ 8 点で出す
vec3 gf_behind(vec2 p, vec2 off, float r, float rot){
  if(uSlotIsA > 0.5) return gf_paper(p + off * 1.1);
  vec3 c = vec3(0.0);
  int nT = int(min(8.0, 8.0 + uFrost * 0.0));   // 上限は uniform 依存 (ANGLE の強制展開よけ)
  for(int k = 0; k < nT; k++){
    float t = float(k) / 7.0;
    vec3 w = vec3(max(1.0 - 2.0 * t, 0.0), 1.0 - abs(2.0 * t - 1.0), max(2.0 * t - 1.0, 0.0));
    float a = float(k) * 2.39996 + rot;
    float rr = r * sqrt((mod(float(k) * 3.0, 8.0) + 0.5) / 8.0);
    vec2 o = off * (1.0 + 0.26 * t) + vec2(cos(a), sin(a)) * rr;
    c += textureLod(iChannel0, gfUV + vec2(o.x / gfAsp, o.y) * gfZoom, 0.0).rgb * w;
  }
  return c / vec3(16.0 / 7.0, 24.0 / 7.0, 16.0 / 7.0);
}

// 重ねた面の和 (上の面越しに下の面の縁や筋が透けて見えるように、全部の面を足し合わせる)
float gfH;     // 高さ (縁の盛り上がり + 厚み + 筋 + 粒) の和
vec2  gfTG;    // いちばん上の面の筋と粒の傾き (重ねると格子が干渉して縞が出るので、表面は 1 枚分だけ)
float gfTP;    // その面の優先度
float gfCov;   // ガラスに覆われている割合 (1 - Π(1 - inside))
float gfCovP;  // そのうち重ねるレイヤーの面だけ (影を落とす先から外す)
float gfLay;   // 重なっている枚数
float gfRim;   // 縁の光の和
float gfInner; // 縁から中への深さの和
vec2  gfLens;  // 面ごとの弱いレンズのずれの和
float gfSh;    // 影までの距離 (最小)

// 共通の周期: 0〜40% でまだらに結晶して広がり、40〜80% はそのまま、80〜100% でまだらに溶けて消える。
// lifeK = 周期の長さの倍率。戻り値 = (結晶の進み mat, 周期の番号 n)
vec2 gf_cycle(vec2 cid, float salt, float lifeK, float clk, bool isFr, float seed){
  float L = max(uLife, 1.0) * lifeK * (0.8 + 0.45 * gf_h2(cid * 1.7 + seed * 1.3 + salt + 0.5));
  if(!isFr) L = max(1.0, floor(L * 2.0 + 0.5) * 0.5);
  float o = gf_h2(cid * 2.3 + seed * 0.7 + salt + 2.0) * L;
  float n = floor((clk + o) / L);
  float x = (clk + o) / L - n;
  return vec2(smoothstep(0.0, 0.40, x) * (1.0 - smoothstep(0.80, 1.0, x)), n);
}
// まだらな島 (この値より低い所からガラスになる)。島の縁もガラスの縁になる
float gf_island(vec2 q, float sd, float mat, float sizeK){
  float rv = gf_vn(q * 9.0 / sizeK + sd) * 0.7 + gf_vn(q * 23.0 / sizeK - sd) * 0.3;
  return (rv - (mat * 1.25 - 0.10)) * 0.05;
}
// 1 枚分を足す。d = 縁までの距離 (< 0 が中。縁の光と厚みの形)、dc = 覆う範囲の距離 (< 0 が中)。
// q = その面の中の座標 (筋と粒の向き)。pane = 重ねるレイヤーの面 (縁の光は少し内側)。セルは境界の上に光る。
// pri = 表面の筋と粒を描く優先度 (重ねるレイヤーの面はセルより上)
void gf_add(float d, float dc, vec2 q, float sd, float sizeK, float px, float T, bool pane, float pri){
  float ins = smoothstep(0.0, 1.5 * px, -dc);
  float w0 = 0.0018 * sizeK;
  float rim = exp(-pow((-d - (pane ? w0 : 0.0)) / w0, 2.0));
  float inner = smoothstep(0.0, 0.05 * sizeK, -d);
  gfH += ins * (0.14 * inner + 0.40 * rim);
  // 表面の筋と粒は、いちばん上の面の分だけ計算する
  if(pri > gfTP && ins > 0.5){
    // 筋と粒は傾きを式で出す (画面微分は 2×2 画素単位で粗く、細かい玉が市松のちらつきになる)。高さ ridge = tri³、玉 = bk^1.5
    // 傾きは面の中の向きのまま (面の回転は ±0.2 rad と小さいので光の向きのずれは無視する)
    vec2 uq = q / sizeK;
    float sc = 1.0 / sizeK;
    // ストロークの筋 (uStroke): 面の向きに走る刷毛の跡。少し扇形に曲がり、筋ごとに強さが違い、途中で途切れる
    float bend = (gf_h1(sd + 8.0) - 0.5) * 3.0;
    float v = uq.y + bend * 0.12 * sin(uq.x * 3.0) + (gf_vn(vec2(uq.x * 6.0, uq.y * 40.0) + sd) - 0.5) * 0.012;   // 傾きは最大 ±28°
    float lane = v * 170.0;                                                   // 筋の間隔 (約 6 画素)
    float fl = fract(lane) - 0.5;
    float tri = 1.0 - abs(fl) * 2.0;
    vec2 gRidge = 3.0 * tri * tri * (-2.0 * sign(fl)) * 170.0 * sc * vec2(bend * 0.36 * cos(uq.x * 3.0), 1.0);
    float bristle = smoothstep(0.25, 0.80, gf_vn(vec2(floor(lane) * 0.37 + sd, uq.x * 2.5)));
    // 粒々 (uDots): 盛り上がった小さな玉が蜂の巣状に並ぶ (約 8 画素)
    vec2 hq = uq * vec2(130.0, 130.0 / 0.866);
    float row = floor(hq.y);
    vec2 hc = floor(hq + vec2(0.5 * mod(row, 2.0), 0.0));
    vec2 hf = (fract(hq + vec2(0.5 * mod(row, 2.0), 0.0)) - 0.5) * vec2(1.0, 0.866);
    float br = 0.36 * (0.8 + 0.35 * gf_h2(hc + sd));
    float bk = max(1.0 - dot(hf, hf) / (br * br), 0.0);
    vec2 gBead = 1.5 * sqrt(bk) * (-2.0 * hf / (br * br)) * 130.0 * sc;
    // 筋の帯と粒の帯が、面の向きに沿って交互に並ぶ
    float band = smoothstep(0.42, 0.58, gf_vn(uq * vec2(2.2, 10.0) + sd * 1.3));
    float sK = max(uStroke, 0.0) * 0.01 * 0.22 * band, dK = max(uDots, 0.0) * 0.01 * 0.26 * (1.0 - band);
    vec2 texG = (sK * bristle * gRidge + dK * gBead) * inner * px;           // 画素あたりの傾き
    gfTP = pri;
    gfTG = texG;
  }
  gfCov = 1.0 - (1.0 - gfCov) * (1.0 - ins);
  if(pane) gfCovP = 1.0 - (1.0 - gfCovP) * (1.0 - ins);
  gfLay += ins;
  gfRim += ins * rim;
  gfInner += ins * inner;
  gfLens += ins * inner * q * vec2(0.0, -0.10);
}

// 輪郭が波打つ面の縁までの距離 (角度ではなく円周上の点でノイズを読むので、一周して継ぎ目が出ない)
float gf_outline(vec2 q, float rx, float ry, float sd, float T){
  vec2 e = q / vec2(rx, ry);
  vec2 dir = e / max(length(e), 1e-5);
  float wob = (gf_vn(dir * 1.6 + vec2(sd, T * 0.08)) - 0.5) * 0.46;
  return (length(e) - 1.0 - wob) * ry;
}
// 重ねるレイヤー: 格子のマス cid の面を足す (cell = マスの大きさ、dens = 置かれる割合、salt = 格子ごとの乱数のずらし、
// lifeK = 周期の長さの倍率、clus = 粗密の場への従い方: +1 = 場の濃い所に群れる / -1 = 場の薄い所に置く / 0 = 場に従わない、
// shadow = 影を落とすか)
void gf_pane(vec2 p, vec2 cid, vec2 cell, float dens, float salt, float lifeK, float clus, bool shadow, float T, float clk, bool isFr, float seed, float sizeK, float px){
  vec2 cy = gf_cycle(cid, salt, lifeK, clk, isFr, seed);
  if(cy.x <= 0.0) return;
  float sd = gf_h2(cid * 3.1 + seed * 1.9 + salt + 7.0) * 97.0 + cy.y * 7.31;
  float h0 = gf_h1(sd + 0.5);
  if(h0 >= dens) return;
  vec2 c0 = (cid + 0.25 + 0.5 * vec2(gf_h1(sd + 1.0), gf_h1(sd + 2.0))) * cell;
  vec2 c = c0 + vec2(0.006 * sin(T * 0.3 + sd), 0.004 * sin(T * 0.23 + sd * 1.7));
  // 大きさのばらつきを広く (ジャンプ率)。横と縦は同じ乱数で揃えて、細長くなりすぎないようにする。
  // 半径はマスの 0.57 倍まで (輪郭のゆらぎ込みで中心から 0.72 マス。近くの 2×2 マスだけ見れば足りる)
  float sz = gf_h1(sd + 3.0);
  float rx = cell.x * (0.18 + 0.39 * sz), ry = cell.y * (0.20 + 0.37 * mix(sz, gf_h1(sd + 4.0), 0.35));
  float ang = (gf_h1(sd + 5.0) - 0.5) * 0.4;
  vec2 q = gf_rot(-ang) * (p - c);
  vec2 q2 = gf_rot(-ang) * (p - vec2(0.010, -0.014) - c);
  // 輪郭のゆらぎは ±0.25 まで。面からも影からも遠い画素はノイズを読まずに抜ける (影は 0.03 先まで効く)
  bool nearP = length(q / vec2(rx, ry)) < 1.26;
  bool nearS = shadow && length(q2 / vec2(rx, ry)) < 1.26 + 0.031 / ry;
  if(!nearP && !nearS) return;
  // 粗密の場 (画面に 2〜3 か所のゆるい濃淡)。小さい面は濃い所に群れ、中くらいの面は薄い所の静かな余白に置く
  if(abs(clus) > 0.5){
    float fz = smoothstep(0.30, 0.70, gf_vn(c0 * 1.2 / sizeK + vec2(seed * 1.7 + 3.3, 5.1)));
    if(h0 >= dens * (clus > 0.5 ? fz : 1.0 - fz)) return;
  }
  if(nearP){
    float d = max(gf_outline(q, rx, ry, sd, T), gf_island(q, sd, cy.x, sizeK));
    if(d < 0.0) gf_add(d, d, q, sd, sizeK, px, T, true, 1.0 + gf_h1(sd + 6.0));
  }
  // 影 (右下へずらした位置)。形は輪郭だけで取り、結晶が進むにつれて濃くなる (島のノイズは読まない)
  if(nearS){
    gfSh = min(gfSh, gf_outline(q2, rx, ry, sd, T) + (1.0 - cy.x) * 0.034);
  }
}

// 分割のレイヤー: セルの点 (マスの中をゆっくり漂う)
vec2 gf_cpt(vec2 id, float T, float seed){
  vec2 h = vec2(gf_h2(id + seed * 3.7), gf_h2(id + seed * 3.7 + 17.0));
  return 0.5 + 0.36 * sin(T * 0.12 + 6.2831 * h);
}
// 分割のレイヤー: 細胞のように平面を埋めるセル (ボロノイ。角は丸める)。セルごとの周期で現れては消える
void gf_cells(vec2 p, float T, float clk, bool isFr, float seed, float px, int R){
  float amt = clamp(uCells, 0.0, 100.0) * 0.01;
  if(amt <= 0.0) return;
  float ck = max(uCellSize, 1.0) * 0.01;
  vec2 cs = vec2(0.19, 0.13) * ck;
  // 境界を曲げる: ボロノイを引く前に座標をノイズでずらす
  vec2 pc = p / cs;
  vec2 wv = (vec2(gf_vn(pc * 0.9 + vec2(T * 0.05, seed)), gf_vn(pc * 0.9 + vec2(7.3, seed - T * 0.05))) - 0.5) * 1.5;
  vec2 x = pc + wv * 1.2 * max(uWarp, 0.0) * 0.01;
  vec2 n0 = floor(x), f = fract(x);
  // 1 回目: いちばん近い点
  vec2 mg = vec2(0.0), mr = vec2(0.0);
  float md = 8.0;
  for(int j = -R; j <= R; j++){
    for(int i = -R; i <= R; i++){
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + gf_cpt(n0 + g, T, seed) - f;
      float dd = dot(r, r);
      if(dd < md){ md = dd; mr = r; mg = g; }
    }
  }
  // 2 回目: 境界までの距離 (隙間なく接するように、いちばん近い境界)
  float eMin = 8.0;
  for(int j = -R; j <= R; j++){
    for(int i = -R; i <= R; i++){
      vec2 g = mg + vec2(float(i), float(j));
      vec2 r = g + gf_cpt(n0 + g, T, seed) - f;
      vec2 dr = r - mr;
      if(dot(dr, dr) > 1e-5) eMin = min(eMin, dot(0.5 * (mr + r), normalize(dr)));
    }
  }
  float edge = eMin * cs.y;   // p 単位の境界までの距離 (ワープ前の目安)
  vec2 cid = n0 + mg;
  vec2 cy = gf_cycle(cid, 53.1, 1.0, clk, isFr, seed);
  if(cy.x <= 0.0) return;
  float sd = gf_h2(cid * 3.1 + seed * 1.9 + 61.0) * 97.0 + cy.y * 7.31;
  if(gf_h1(sd + 0.5) >= amt) return;
  vec2 q = gf_rot(-(gf_h1(sd + 5.0) - 0.5) * 0.4) * (-mr * cs);   // セルの中心からの座標
  // 覆う範囲は島だけで決める (境界では隣のセルとそのまま接する)。縁の光と厚みは境界までの距離から
  float di = gf_island(q, sd, cy.x, ck);
  if(di < 0.0) gf_add(max(-edge, di), di, q, sd, ck, px, T, false, gf_h1(sd + 6.0));
}

vec3 bg_glass_frost(vec2 fc){
  float bt = getBeat();
  bool isFr = isFree();
  float spd = max(uSpeed, 0.0) * 0.01;
  float T = time * spd;
  float clk = isFr ? time : bt;
  float pulse = isFr ? 0.0 : pow(1.0 - fract(bt), 2.0);
  pulse = max(pulse, clamp(iAudio, 0.0, 1.0));
  float kick = pulse * max(uKick, 0.0) * 0.01;
  float seed = floor(max(uSeed, 0.0) + 0.5);

  gfZoom = max(bgZoom, 0.001);
  gfAsp = resolution.x / max(resolution.y, 1.0);
  gfUV = fc / max(resolution, vec2(1.0));
  gfPaperOn = step(max(uBgColor.r, max(uBgColor.g, uBgColor.b)), 0.004);
  vec2 p = (fc - 0.5 * resolution) / max(resolution.y, 1.0);
  p = p / gfZoom + bgCamPx / max(resolution.y, 1.0);
  float px = 1.0 / (max(resolution.y, 1.0) * gfZoom);
  float sizeK = max(uSize, 1.0) * 0.01;
  int R = int(min(1.0, 1.0 + uSeed * 0.0));   // 近傍の幅 (セルは -R..R の 3×3、面は 0..R の 2×2)。上限は uniform 依存 (ANGLE の強制展開よけ)

  gfH = 0.0; gfTG = vec2(0.0); gfTP = -1.0; gfCov = 0.0; gfCovP = 0.0; gfLay = 0.0; gfRim = 0.0; gfInner = 0.0; gfLens = vec2(0.0); gfSh = 1e5;
  // ── 分割のレイヤー (下) ──
  gf_cells(p, T, clk, isFr, seed, px, R);
  // ── 重ねるレイヤー (上): 大きさを 3 段にしてジャンプ率を高くする (マスの幅でおよそ 1 : 3 : 11)。
  //    小 = 粗密の場の濃い所に群れ、周期が短い / 中 = 場の薄い所に置き、余白をつくる / 大 = 画面ほどの面がまばらに重なり、周期が長い。
  //    画素ごとに、中心が近い 2×2 マスだけを見る (面を増やしても負荷は一定)。影は大きな面だけが落とす
  float dens = clamp(uDensity, 0.0, 100.0) * 0.01, big = clamp(uBig, 0.0, 100.0) * 0.01;
  vec2 cellS = vec2(0.22, 0.095) * sizeK, cellM = vec2(0.70, 0.30) * sizeK, cellB = vec2(2.40, 1.15) * sizeK;
  vec2 gS = floor(p / cellS - 0.5), gM = floor(p / cellM - 0.5), gB = floor(p / cellB - 0.5);
  for(int j = 0; j <= R; j++){
    for(int i = 0; i <= R; i++){
      vec2 o = vec2(float(i), float(j));
      if(dens > 0.0){
        gf_pane(p, gS + o, cellS, dens, 0.0, 0.6, 1.0, false, T, clk, isFr, seed, sizeK, px);
        gf_pane(p, gM + o, cellM, dens * 0.8, 17.3, 1.0, -1.0, false, T, clk, isFr, seed, sizeK, px);
      }
      if(big > 0.0) gf_pane(p, gB + o, cellB, big, 31.7, 1.6, 0.0, true, T, clk, isFr, seed, sizeK, px);
    }
  }

  // ── 法線: 足し合わせた高さの画面微分 (下の面の縁も上の面越しに光と屈折に出る) ──
  vec2 dh = vec2(dFdx(gfH), dFdy(gfH));
  vec2 dt = gfTG;                                         // 筋と粒の傾き (画素あたり)
  vec3 nrm = normalize(vec3(-(dh + dt) * 1.6, 1.0));
  float inside = gfCov;
  float rim = min(gfRim, 1.5);
  float inner = min(gfInner, 1.0);
  float frK = max(uFrost, 0.0) * 0.01;

  // ── 色: 影 → ガラス (奥の屈折・色の分かれ・すりガラス・光・虹色) ──
  //    影は重ねるレイヤーの面の外 (セルの上と、何も無い所) に落ちる
  float sh = smoothstep(0.03, -0.004, gfSh) * 0.10 * max(uShadow, 0.0) * 0.01 * (1.0 - gfCovP);
  vec3 col = vec3(0.0);
  float cov = sh * (1.0 - inside);                        // ガラスの外の影は黒を薄く重ねる
  if(inside > 0.002){
    float rk = max(uRefract, 0.0) * 0.01 * (1.0 + 0.6 * kick);
    vec2 off = -nrm.xy * 0.045 * rk + gfLens * rk;
    // すりガラス: 重なるほどぼけが広がる。縁の近くは少し澄む
    float fr = frK * 0.020 * (0.4 + 0.6 * inner) * (0.6 + 0.4 * min(gfLay, 3.0));
    // すりガラスの粒 (uGrain): 粒ごとに奥をばらばらの向きへずらし (きらめく細かい粒)、少し粗いむら (まだらな曇り) で
    // ぼけと乳白の濃さを変える。粒はガラスの座標に付く (ズーム / パンで一緒に動く)
    float grK = max(uGrain, 0.0) * 0.01;
    vec2 gp = p / px;                                                              // 画素単位の座標
    vec2 gc = floor(gp * 0.8);
    vec2 gj = vec2(gf_h2(gc), gf_h2(gc + 7.7)) - 0.5;                              // 細かい粒 (約 1 画素)
    vec2 gm = vec2(gf_vn(gp * 0.28), gf_vn(gp * 0.28 + 13.1)) - 0.5;               // 少し粗い粒 (約 4 画素)
    float mot = gf_vn(p * 22.0 / sizeK + 4.2) * 0.65 + gf_vn(p * 61.0 / sizeK - 1.3) * 0.35;   // まだらな曇り
    off += (gj * 0.7 + gm) * 0.010 * grK * (0.5 + 0.5 * inner);
    fr *= 1.0 + grK * (mot - 0.4) * 0.9;
    vec3 g = gf_behind(p, off, fr, gf_h2(fc) * 6.2831);
    vec3 Ld = normalize(vec3(-0.5, 0.7, 0.6));
    float diff = dot(nrm, Ld);
    float spec = pow(max(dot(reflect(-Ld, nrm), vec3(0.0, 0.0, 1.0)), 0.0), 36.0);
    g *= 1.0 + 0.05 * diff;
    // 乳白: 重なるほど濃く、曇りのむらで濃淡がつく。粒の明るさのばらつきも乗せる
    g = mix(g, vec3(0.95, 0.94, 0.97), clamp(gfLay * 0.16 * frK * (0.5 + 0.5 * inner) * (1.0 + grK * (mot - 0.4) * 0.8), 0.0, 0.55));
    g += ((gf_h2(gc + 3.1) - 0.5) * 0.06 + gm.x * 0.05) * grK;
    // 縁: 細く白く光り、薄い虹色 (暗く沈めない)
    vec3 film = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + gfH * 1.6 + dot(nrm.xy, vec2(2.0, 1.3)) + T * 0.05));
    g += (vec3(0.10) + (film - 0.3) * 0.22 * max(uIris, 0.0) * 0.01) * rim * clamp(0.55 + 0.6 * diff, 0.2, 1.0);
    g += vec3(1.0) * spec * 0.12;
    // 筋と粒の表面の光と陰 (すりガラスのぼけの後に乗せるので、ぼけずにくっきり見える)。左上から光が当たる
    float tl = -dot(dt, vec2(-0.6, 0.8)) * 5.0;
    g *= 1.0 + clamp(tl, -0.30, 0.0);
    g += vec3(0.98, 0.97, 1.0) * pow(clamp(tl, 0.0, 1.0), 1.5) * 0.45;
    g *= 1.0 - sh;                                        // 面の影はセルの上にも落ちる
    col = clamp(g, 0.0, 1.0) * inside;
    cov = inside + sh * (1.0 - inside);
  }
  bgAlpha = cov;
  // Slot A のときは、ガラスの外に地 (影で少し暗く) を敷く
  return col + gf_paper(p) * gfPaperOn * uSlotIsA * (1.0 - cov);
}
