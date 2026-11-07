'use strict';
/* Rhizome engine — vj/ の追加レンダリングモード (kind:'rhizome')。
   リゾーム的なダイアグラム (黄緑の楕円のノード・緑の細い線・茶色の四角と線・矢印付きの青い弧) の要素が、
   次々とポップアップして現れては消えていく。
   - ノードは nodes 個の枠がそれぞれ自分の周期 (Life のまわりでばらつく) で生まれ直し、周期ごとに種類と位置を引き直す。
     生まれるときは、生きている親の近くに出て親から線が伸び、届いた所でふくらんで (少し弾んで) 現れる。
     親がいなければ画面のどこかに単独で出る。現れたあと、近くにいる他のノードへも線を伸ばす。
     消えるときは先に線が縮み、続いてノードがしぼむ。親が先に消えても子は残る。
     親子の深さは周期ごとの段 (0〜3) で決め、段の浅いノードにだけつながる (再帰が必ず止まる)。
   - 種類: 黄緑の楕円 (大半) / 線の端の点 (巻きひげ) / 茶色の四角 (茶色の線でつながる) / ベージュの水彩の菱形 (灰茶の線でつながる)
   - 青い弧: 別の枠で、弧が伸びて矢印が付き、しばらくして尾が先端へ追いついて消える。
   - 平らと立ち上がり (Rise / Cycle): 網はすべて地面に置いてあり、Cycle ごとに「平らに見下ろす」と「斜めから見る」を
     繰り返す。斜めのときは地面が奥へ倒れ (Tilt)、回り (Yaw)、四角は菱形に、楕円は潰れた楕円に見える。
     横長の面 (どれも平行に奥へ向く) が蝶番のように 90° 立ち上がり (面ごとに少しずつずれる)、面には人の外側の輪郭が下辺から切り抜かれている
     (腕と股から内側の線は無く、下辺は体の幅だけ切れる。頭が上辺から出る人は上辺も首の幅だけ切れる)。流れる青い矢印は宙に浮き、うねる赤線と
     手前の色鉛筆の緑の帯が現れる。立ち上がると楕円の半分が菱形に変わり、そこをつなぐ線も灰茶になる (図 1 → 図 2)。
     Rise 0 で平らのまま (以前と同じ見た目)。
   - Style: 網 (図 1) は平らなときに縦の面・矢印・赤線・帯が出ず、立ち上がるときだけ現れる。
     面と流れ (図 2) / 両方 は菱形が主になり、それらが常に出る (平らなときの面は地面に寝ている)。
   - 別の mode: 扇 (rzfan) / 群れの輪 (rzpacks) は網を使わない別の図 (_fan / _packs)。積層 (rzstack) は楕円だけの網に柱を立てる (_stack)。
     同じエンジンの別の実体 (Rhizome._variant) で、パラメータと GL の資源を実体ごとに持つ。地面の倒れ (Rise / Cycle) と手描きの描き方は共通。
   - 手描き: 線は全体でわずかにたわみ (伸びる途中でも形が変わらないよう、線の全体の両端で測る)、ペン先を置いた両端にインクがたまる。
     楕円は透けるマーカーの塗り (下の線が透ける) で、筆の帯の重なりと片側の影があり、縁のペン線は描き始めと終わりが食い違う。
     四角と菱形は水彩 (縁にたまって濃く、中はむら) で、ペンの縁は角で少し突き抜け、角にインクがたまる。破線は線と隙間の長さがばらつく。
     手前の帯は色鉛筆の斜めの線。手描きのばらつきは要素ごとの種 (地面の位置などから決める) で決まり、地面が倒れても揺れない。
     Boil で一定のコマごとに描き直す (手描きアニメの線の震え)。
   - 時刻だけから決まる (状態を持たない)。逆再生や拍の飛びでもそのまま。C キーでスロットの時計が 0 に戻ると最初から。
     beat モードは拍が時間の単位で、生まれる時刻が半拍にそろい、拍頭でノードがふくらむ (Kick)。drone は秒が単位。
   - 3D は CPU で点を画面へ投影し、1 要素 = 1 インスタンスの四角形を頂点シェーダで置く。形 (線分・楕円・点・四角形) は
     フラグメントで距離から描く。色鉛筆のかすれ (Pencil) と楕円の塗りの筆致もフラグメント。塗りは奥から手前へ重ねる。
   - Slot A は紙 (paper) を敷く。Slot B は背景を透過する (前乗算アルファ)。
   参照したのは Marc Ngui による『千のプラトー』のためのドローイングの雰囲気。配置は乱数から生成していて、トレースではない。
   IF: init(gl) / update() / render({fbo,w,h,slot,beat,clock,opaque}) / P / PDefaults / SPECS
       RhizomeKinds = { kind: エンジン } (rhizome / rzfan / rzpacks / rzstack)
*/

const Rhizome = {
  gl:null, initialized:false, ok:false,
  prog:null, vao:null, cornerVBO:null, instVBO:null, instCap:0, U:null,
  _memo:null, _sig:'', _cfg:null, _salt:0,
  draw:null,      // 別の図の描き方 (_fan / _packs / _stack)。null は網 (Style で図 1 / 図 2 / 両方)
  useNet:true,    // 網 (ノードと線) を描く

  // ── パラメータ (UI から操作)。数値は使う直前に App.deadParam を通す ──
  P:{
    style:0,        // 0 = 網 (図 1) / 1 = 面と流れ (図 2) / 2 = 両方
    speed:100,      // 時間の速さ (%)
    life:6,         // ノードの寿命の目安 (秒。beat では拍)
    nodes:180,      // ノードの枠の数 (同時に見えるのはおよそ 6〜7 割)
    links:100,      // 近くのノードへ伸ばす線の量 (%)
    size:100,       // 楕円・四角・菱形の大きさ (%)
    tendrils:100,   // 端に点のある線 (巻きひげ) の量 (%)
    squares:40,     // 茶色の四角の量 (%)
    arcs:100,       // 青い弧 (図 1) と流れる矢印 (図 2) の量 (%)
    planes:100,     // 縦に立つ面の量 (%)
    figures:100,    // 面に人の輪郭が切り抜かれている割合 (%)
    meander:100,    // うねる赤い線の量 (%)
    band:100,       // 手前の緑の波の帯の濃さ (%)
    diamonds:8,     // 菱形の割合 (%。図 2 では菱形が主になる)
    spread:100,     // 子が親から離れて生まれる距離 (%)
    line:100,       // 線の太さ (%)
    pencil:100,     // 色鉛筆のかすれと塗りむら (%)
    hand:100,       // 手描きの揺れ (%)。線がたわみ、縁が揺れ、線の太さにむらが出て、ペン先にインクがたまる
    boil:0,         // 描き直しの速さ (%)。100 で毎秒 8 コマ (beat では 1 拍 2 コマ) ごとに手描きのばらつきを引き直す。0 で止まったまま
    pop:100,       // ポップの弾み (%)
    kick:60,        // 拍でノードがふくらむ量 (%)
    drift:40,       // 画面がゆっくり流れる量 (%)
    rise:100,       // 立ち上がる量 (%)。0 で平らのまま
    cycle:16,       // 平ら → 立ち上がり → 平ら の周期 (秒。beat では拍)
    tilt:60,        // 立ち上がったときの地面の倒れ (deg)
    yaw:45,         // 立ち上がったときの地面の回り (deg)
    seed:0,         // 乱数のシード
    paper:[0.965, 0.958, 0.935],   // 紙の色 (Slot A)。Slot B は透過
  },

  SPECS:[
    {sel:true, label:'Style', key:'style', opts:['網 (図 1)', '面と流れ (図 2)', '両方']},
    ['Speed',    'speed',    0,   300, 1,   'pct'],
    ['Life',     'life',     1,   32,  0.5, 'f2'],
    ['Nodes',    'nodes',    10,  400, 1,   'int'],
    ['Links',    'links',    0,   300, 1,   'pct'],
    ['Size',     'size',     10,  300, 1,   'pct'],
    ['Tendrils', 'tendrils', 0,   300, 1,   'pct'],
    ['Squares',  'squares',  0,   300, 1,   'pct'],
    ['Arcs',     'arcs',     0,   300, 1,   'pct'],
    ['Planes',   'planes',   0,   300, 1,   'pct'],
    ['Figures',  'figures',  0,   100, 1,   'pct'],
    ['Meander',  'meander',  0,   300, 1,   'pct'],
    ['Band',     'band',     0,   200, 1,   'pct'],
    ['Diamonds', 'diamonds', 0,   100, 1,   'pct'],
    ['Spread',   'spread',   10,  300, 1,   'pct'],
    ['Line',     'line',     20,  400, 1,   'pct'],
    ['Pencil',   'pencil',   0,   200, 1,   'pct'],
    ['Hand',     'hand',     0,   300, 1,   'pct'],
    ['Boil',     'boil',     0,   300, 1,   'pct'],
    ['Pop',      'pop',      0,   300, 1,   'pct'],
    ['Kick',     'kick',     0,   200, 1,   'pct'],
    ['Drift',    'drift',    0,   300, 1,   'pct'],
    ['Rise',     'rise',     0,   100, 1,   'pct'],
    ['Cycle',    'cycle',    4,   64,  1,   'int'],
    ['Tilt',     'tilt',     20,  70,  1,   'deg'],
    ['Yaw',      'yaw',      -90, 90,  1,   'deg'],
    ['Seed',     'seed',     0,   99,  1,   'int'],
  ],

  // lime は透けるマーカーの色 (塗りの不透明度 0.74 で紙に重ねたとき、およそ [0.73, 0.94, 0.17] に見える)
  COL:{
    lime:[0.65, 0.93, 0.02], limeRim:[0.33, 0.58, 0.18], green:[0.40, 0.73, 0.38], dot:[0.30, 0.58, 0.28],
    taupe:[0.55, 0.47, 0.44], brown:[0.50, 0.28, 0.23], sqLine:[0.58, 0.38, 0.34], sqFill:[0.93, 0.85, 0.80],
    blue:[0.24, 0.54, 0.88], ink:[0.20, 0.19, 0.19], red:[0.85, 0.22, 0.18], band:[0.30, 0.62, 0.27],
    hub:[0.18, 0.50, 0.16],
  },

  // 立っている人の外側の輪郭 (足元の中央が原点、背の高さ 1)。右の足元 → 頭 → 左の足元。
  // 股から内側の線は持たず、下は閉じない (面の下辺を体の幅だけ切って、切り抜きにする)
  FIG:null,
  FIG_FOOT:0.10,   // 足元の半幅 (下辺を切る幅)
  FIG_HALF:0.11,   // 輪郭のいちばん外 (肩) の半幅
  _figure(){
    if(this.FIG) return this.FIG;
    // 腕は無く、肩から足元までほぼまっすぐ下りる
    const R = [[this.FIG_FOOT,0],[0.10,0.20],[0.105,0.45],[0.11,0.62],[0.105,0.71],[0.085,0.765],[0.05,0.79],[0.03,0.82]];
    const pts = R.slice();
    const hc = 0.895, hr = 0.068;
    for(let k = 0; k <= 12; k++){
      const a = -0.95 + (Math.PI + 1.9) * k / 12;   // 首の右から頭の上をまわって首の左へ
      pts.push([hr * Math.cos(a), hc + hr * Math.sin(a)]);
    }
    for(let k = R.length - 1; k >= 0; k--) pts.push([-R[k][0], R[k][1]]);
    this.FIG = pts;
    return pts;
  },
  // 輪郭の高さ y (背の高さ 1) での半幅 (いちばん外側の交点。上辺を切る幅に使う)
  _figHalfAt(y){
    const F = this._figure();
    let hx = 0;
    for(let m = 0; m + 1 < F.length; m++){
      const a = F[m], b = F[m + 1];
      if((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
      const k = (y - a[1]) / (b[1] - a[1]);
      hx = Math.max(hx, Math.abs(a[0] + (b[0] - a[0]) * k));
    }
    return hx;
  },

  VS:`#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iA;   // 線・色鉛筆の帯: 両端 / 楕円・点: 中心 xy と半径 zw / 四角形: 1・2 番目の角
layout(location=2) in vec4 iB;   // 種類, 回転 (線: 全体の両端あり / 四角形: 塗りの濃さ / 帯: 帯に沿った位置), 線の半幅, 不透明度
layout(location=3) in vec4 iC;   // 色, 手描きのばらつきの種 (0..1。帯は区間の地面での長さ px)
layout(location=4) in vec4 iD;   // 線: 全体の両端 / 楕円: 縁の色と地面の x 軸の画面での向き / 四角形: 3・4 番目の角 / 帯: 両端の継ぎ目の向き
uniform vec2 uCam;               // 画面の中心
uniform vec2 uHalf;              // 画面の半幅・半高
uniform float uPx;               // 1px の長さ
uniform float uHand;             // 手描きの揺れ (線のたわみは最大で約 5px × uHand)
out vec2 vW;
flat out vec4 vA;
flat out vec4 vB;
flat out vec4 vC;
flat out vec4 vD;
void main(){
  vA = iA; vB = iB; vC = iC; vD = iD;
  float type = iB.x;
  float pad = type > 4.5 ? iB.z * 1.3 + 3.0 * uPx : iB.z * 2.0 + (3.0 + 7.0 * uHand) * uPx;
  vec2 w;
  if(type < 0.5 || type > 4.5){                     // 線分・色鉛筆の帯
    vec2 a = iA.xy, b = iA.zw;
    vec2 d = b - a;
    float L = length(d);
    vec2 t = L > 1e-7 ? d / L : vec2(1.0, 0.0);
    vec2 n = vec2(-t.y, t.x);
    w = a + t * (aCorner.x * (L + 2.0 * pad) - pad) + n * ((aCorner.y * 2.0 - 1.0) * pad);
  } else if(type > 2.5 && type < 3.5){              // 四角形
    vec2 mn = min(min(iA.xy, iA.zw), min(iD.xy, iD.zw)) - pad;
    vec2 mx = max(max(iA.xy, iA.zw), max(iD.xy, iD.zw)) + pad;
    w = mix(mn, mx, aCorner);
  } else if(type > 3.5){                            // 紙
    w = uCam + (aCorner * 2.0 - 1.0) * uHalf;
  } else {                                          // 楕円・点
    float R = max(iA.z, iA.w) + pad;
    w = iA.xy + (aCorner * 2.0 - 1.0) * R;
  }
  vW = w;
  gl_Position = vec4((w - uCam) / uHalf, 0.0, 1.0);
}`,

  FS:`#version 300 es
precision highp float;
in vec2 vW;
flat in vec4 vA;
flat in vec4 vB;
flat in vec4 vC;
flat in vec4 vD;
uniform float uPx;
uniform float uPencil;
uniform float uHand;
uniform float uBoil;             // 描き直しのコマごとの種のずれ (0..1。0 = 描き直さない)
uniform vec3 uSqFill;
out vec4 o;
float h2(vec2 p){
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float vn(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
}
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float seg(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0);
  return length(pa - ba * h);
}
float cr(vec2 a, vec2 b){ return a.x * b.y - a.y * b.x; }
// 手で引いた線 a→b までの距離 (x) と、線に沿った位置 (y, px)。S→E はその線の全体 (伸びる途中でも形が変わらないよう全体で測る)。
// bowK = 1 で全体がわずかにたわみ、細かくうねる。0 でまっすぐ (折れ線で描く曲線は区間ごとに測ると継ぎ目で折れるので 0)
vec2 stroke(vec2 w, vec2 a, vec2 b, vec2 S, vec2 E, float sd, float bowK){
  vec2 dE = E - S;
  float Lf = max(length(dE), 1e-7);
  vec2 tf = dE / Lf, nf = vec2(-tf.y, tf.x);
  float hf = clamp(dot(w - S, tf) / Lf, 0.0, 1.0);
  float sp = hf * Lf / uPx;
  float bow = (sd - 0.5) * 2.0 * min(0.012 * Lf, 5.0 * uPx) * 4.0 * hf * (1.0 - hf);
  float wig = (vn(vec2(sp / 34.0 + sd * 91.0, sd * 7.0)) - 0.5) * 1.5 * uPx;
  return vec2(seg(w - nf * (bow + wig) * uHand * bowK, a, b), sp);
}
void main(){
  float type = vB.x;
  float px = uPx;
  vec2 w = vW;
  float sd = fract((type > 4.5 ? 0.37 : vC.w) + uBoil);
  float hk = min(uHand, 1.0);
  // 紙の目 (紙に付くので画面の画素で測る) と色鉛筆のかすれ
  float tooth = vn(gl_FragCoord.xy * 0.83) * 0.65 + vn(gl_FragCoord.xy * 0.21 + 7.0) * 0.35;
  float grain = 1.0 - uPencil * 0.42 * smoothstep(0.30, 0.90, tooth);
  vec3 col = vC.rgb;
  float a = 0.0;
  if(type < 0.5){                                   // 線分
    bool full = vB.y > 0.5;
    vec2 st = stroke(w, vA.xy, vA.zw, full ? vD.xy : vA.xy, full ? vD.zw : vA.zw, sd, full ? 1.0 : 0.0);
    // 筆圧のむらとインクの出のむら (まっすぐな線は線に沿って、折れ線の曲線は場所で測る)
    vec2 sq = full ? vec2(st.y, sd * 37.0) : w / px;
    float press = 1.0 + 0.45 * uHand * (vn(vec2(sq.x / 70.0, sq.y / 70.0 + 3.0)) - 0.5);
    float ink = 1.0 - 0.26 * uPencil * vn(vec2(sq.x / 16.0, sq.y / 16.0 + 9.0));
    float hw = vB.z * clamp(press, 0.6, 1.4);
    a = (1.0 - smoothstep(hw - 0.5 * px, hw + px, st.x)) * grain * ink;
    // 折れ線の曲線は区間の両端を丸めず平らに切る (継ぎ目で両隣が重なって濃い粒にならない)
    vec2 sab = vA.zw - vA.xy;
    float hs = dot(w - vA.xy, sab) / max(dot(sab, sab), 1e-12);
    if(!full && (hs < 0.0 || hs >= 1.0)) a = 0.0;
    if(full){   // ペン先を置いた所と離した所のインクだまり
      float rb = max(hw * 1.45, 1.0 * px) * (0.85 + 0.3 * h2(vec2(sd, 3.0)));
      float db = min(length(w - vA.xy), length(w - vA.zw)) - rb;
      a = max(a, (1.0 - smoothstep(-0.5 * px, px, db)) * 0.95 * hk);
    }
  } else if(type < 1.5){                            // 楕円 (透けるマーカーの塗り + ペンの縁)
    // 形は主軸の向き (vB.y, ab) で測る。手描きのばらつきは楕円自身の地面の x 軸の向き (vD.w) で測る
    // (主軸は真円をまたぐと 90° 入れ替わるので、ばらつきをそれで測ると地面が倒れる途中で跳ねる)
    vec2 ab = vA.zw;
    vec2 dw = w - vA.xy;
    vec2 q = rot(-vB.y) * dw;
    vec2 g = rot(-vD.w) * dw;
    mat2 g2q = rot(vD.w - vB.y);
    float rq = length(q / ab);
    float de = (rq - 1.0) * rq / max(length(q / (ab * ab)), 1e-6);   // 縁までの距離 (細長くても縁の太さがそろう)
    // 塗りは縁から少しずれ、はみ出したり足りなかったりする (uHand。0 で縁と同じ形)
    // (ずれは大きさに比例させず、大きい楕円でも数 px まで)
    vec2 fo = (vec2(h2(vec2(sd, 1.3)), h2(vec2(sd, 7.9))) - 0.5) * min(0.24 * min(ab.x, ab.y), 5.0 * px) * uHand;
    vec2 fab = ab + min(0.07 * min(ab.x, ab.y), 3.0 * px) * uHand * (h2(vec2(sd, 4.1)) - 0.6);
    vec2 qf = q - g2q * fo, gf = g - fo;
    float rf = length(qf / fab);
    float dfl = (rf - 1.0) * rf / max(length(qf / (fab * fab)), 1e-6);
    float fil = 1.0 - smoothstep(-px, px, dfl);
    // マーカーの筆致: 太いペン先で一方向に塗った帯。帯の重なりが濃く、帯の中もむらになる。縁にインクがたまる
    float sa = -0.6 + 1.0 * h2(vec2(sd, 9.2));
    vec2 sdir = vec2(cos(sa), sin(sa));
    float v = dot(gf, vec2(-sdir.y, sdir.x)) / (9.0 * px) + sd * 5.0 + 0.7 * vn(vec2(dot(gf, sdir) / (55.0 * px), sd * 3.0));
    float fv = fract(v);
    float lap = smoothstep(0.80, 0.95, fv) * (1.0 - smoothstep(0.95, 1.0, fv)) * (0.4 + 0.6 * h2(vec2(floor(v), sd * 13.0)));
    float streak = vn(vec2(dot(gf, sdir) / (40.0 * px), floor(v) * 3.7 + sd * 11.0));
    float pool = smoothstep(-3.0 * px, -0.5 * px, dfl);
    // 片側の影 (縁に近く、楕円ごとに決まった側が濃い)
    float la = 6.2831853 * h2(vec2(sd, 3.3));
    float shade = smoothstep(0.45, 1.0, rf) * smoothstep(-0.3, 0.9, dot(qf / fab / max(rf, 1e-4), g2q * vec2(cos(la), sin(la))));
    float dark = uPencil * (0.08 * lap + 0.06 * streak + 0.06 * pool) + hk * 0.13 * shade;
    vec3 fc = vC.rgb * (1.0 - dark);
    float fa = fil * 0.74;
    // ペンの縁: 一周でわずかに内外へずれて描き始めと終わりが食い違い、描き終わりは少し重なる
    float u = fract((atan(g.y, g.x) - 6.2831853 * h2(vec2(sd, 5.5))) / 6.2831853);
    float drift = (h2(vec2(sd, 6.6)) - 0.5) * 2.6 * px * uHand;
    float wobR = (vn(vec2(u * 6.0 + sd * 17.0, 2.0)) - 0.5) * 1.3 * px * uHand;
    float d1 = abs(de - drift * (u - 0.5) - wobR);
    float d2 = u < 0.10 ? abs(de - drift * (u + 0.5) - wobR) : 1e9;
    float rhw = vB.z * (1.0 + 0.35 * uHand * (vn(vec2(u * 9.0, sd * 23.0)) - 0.5));
    float rim = (1.0 - smoothstep(rhw - 0.5 * px, rhw + px, min(d1, d2))) * grain;
    float A = rim + fa * (1.0 - rim);
    o = vec4((vD.rgb * rim + fc * fa * (1.0 - rim)) * vB.w, A * vB.w);
    return;
  } else if(type < 2.5){                            // 点
    float d = length(w - vA.xy) - vA.z * (0.85 + 0.3 * h2(vec2(sd, 2.0)));
    a = 1.0 - smoothstep(-0.5 * px, px, d);
  } else if(type < 3.5){                            // 四角形 (水彩の塗り vB.y + ペンの縁)
    vec2 P0 = vA.xy, P1 = vA.zw, P2 = vD.xy, P3 = vD.zw;
    // ペンの縁: 辺ごとに少したわみ、角で少し突き抜ける
    float ov = 2.4 * px * uHand;
    float d = 1e9;
    for(int k = 0; k < 4; k++){
      vec2 pa = k == 0 ? P0 : (k == 1 ? P1 : (k == 2 ? P2 : P3));
      vec2 pb = k == 0 ? P1 : (k == 1 ? P2 : (k == 2 ? P3 : P0));
      float sk = h2(vec2(sd * 7.0, float(k)));
      vec2 td = normalize(pb - pa + 1e-9);
      vec2 a2 = pa - td * ov * (0.2 + 0.8 * sk), b2 = pb + td * ov * (1.0 - 0.8 * sk);
      d = min(d, stroke(w, a2, b2, a2, b2, fract(sd + 0.37 * float(k)), 0.6).x);
    }
    // 水彩: 縁から少しずれ、縁にたまって濃く、中はむら
    vec2 ww = w - (vec2(h2(vec2(sd, 2.1)), h2(vec2(sd, 8.4))) - 0.5) * 3.0 * px * uHand;
    float di = min(min(seg(ww, P0, P1), seg(ww, P1, P2)), min(seg(ww, P2, P3), seg(ww, P3, P0)));
    float c0 = cr(P1 - P0, ww - P0), c1 = cr(P2 - P1, ww - P1), c2 = cr(P3 - P2, ww - P2), c3 = cr(P0 - P3, ww - P3);
    bool inside = (c0 >= 0.0 && c1 >= 0.0 && c2 >= 0.0 && c3 >= 0.0) || (c0 <= 0.0 && c1 <= 0.0 && c2 <= 0.0 && c3 <= 0.0);
    float sdist = inside ? -di : di;
    vec2 e1 = P1 - P0, e3 = P3 - P0;
    float det = cr(e1, e3);
    vec2 st2 = abs(det) > 1e-12 ? vec2(cr(ww - P0, e3), cr(e1, ww - P0)) / det : vec2(0.0);   // 四角の中の位置 (0..1)
    float blot = vn(st2 * 3.0 + sd * 20.0);
    float edge = smoothstep(-2.6 * px, -0.3 * px, sdist);
    float fa = (1.0 - smoothstep(-px, px, sdist)) * vB.y * (0.80 + uPencil * (0.32 * (blot - 0.5) + 0.40 * edge)) * (1.0 - uPencil * 0.18 * tooth);
    float hw = vB.z * 1.2;
    float oa = (1.0 - smoothstep(hw - 0.5 * px, hw + px, d)) * 0.92 * grain;
    // 角のインクだまり
    float dc = min(min(length(w - P0), length(w - P1)), min(length(w - P2), length(w - P3))) - max(hw * 1.5, 1.0 * px);
    oa = max(oa, (1.0 - smoothstep(-0.5 * px, px, dc)) * 0.9 * hk);
    fa = clamp(fa, 0.0, 1.0);
    float A = (oa + fa * (1.0 - oa)) * vB.w;
    o = vec4((vC.rgb * oa + uSqFill * fa * (1.0 - oa)) * vB.w, A);
    return;
  } else if(type < 4.5){                            // 紙
    col = vC.rgb * (0.99 + 0.016 * vn(gl_FragCoord.xy * 0.35) + 0.01 * vn(gl_FragCoord.xy * 0.04));
    a = 1.0;
  } else {                                          // 色鉛筆の帯 (折れ線の 1 区間。継ぎ目は両隣と同じ向きで切って重ならない)
    vec2 pa = vA.xy, pb = vA.zw;
    vec2 tt = normalize(pb - pa + 1e-9), nn = vec2(-tt.y, tt.x);
    if(dot(w - pa, vD.xy) < 0.0 || dot(w - pb, vD.zw) >= 0.0){ o = vec4(0.0); return; }
    float hw = vB.z;
    float x = dot(w - pa, nn) / hw;                 // 帯の幅の向き (-1..1。正が上側)
    float s = vB.y + vC.w * dot(w - pa, tt) / max(length(pb - pa), 1e-7);   // 帯に沿った位置 (地面で測った px。倒れても筆致が滑らない)
    vec2 p = vec2(s, x * 92.0) / (1080.0 * px);     // 帯に付いた座標 (いまの解像度の px)
    // 縁はくっきり (少しぎざぎざ)。縁そのものを色鉛筆でなぞってあり、ぼかしで薄れない
    float ax = abs(x) + 0.030 * (vn(vec2(p.x / 16.0, sign(x) * 5.0 + sd * 9.0)) - 0.5) + 0.018 * (vn(vec2(p.x / 3.5, sign(x) * 2.0)) - 0.5);
    float pw = px / max(hw, 1e-7);                  // 1px を帯の幅の単位で
    float inside = 1.0 - smoothstep(1.0 - pw, 1.0 + pw, ax);
    if(inside <= 0.0){ o = vec4(0.0); return; }
    // 濃さ: 下側の縁寄りがいちばん濃く、上側の縁沿いも濃い。中ほどは淡い。帯に沿ってゆっくりむらになる
    float dens = 0.30 + 0.50 * smoothstep(0.15, 1.0, -x) + 0.30 * smoothstep(0.55, 1.0, x) + 0.16 * (vn(vec2(p.x / 170.0, sd * 5.0 + x * 1.5)) - 0.5);
    // 縁のなぞり線 (ところどころかすれて途切れる)
    float rim = smoothstep(1.0 - 3.5 * pw, 1.0 - 1.0 * pw, ax) * smoothstep(0.25, 0.6, vn(vec2(p.x / 9.0, sign(x) * 7.0 + sd * 3.0)));
    dens = max(dens, 0.95 * rim);
    // 筆致: 帯に対して 25° と -10° の 2 方向に伸びた粒の流れを重ねる (線の並びは不揃い)
    float s1 = vn(vec2(dot(p, vec2(0.906, 0.423)) / 8.0, dot(p, vec2(-0.423, 0.906)) / 1.3 + sd * 21.0));
    float s2 = vn(vec2(dot(p, vec2(0.985, -0.174)) / 11.0, dot(p, vec2(0.174, 0.985)) / 1.5 + 9.0));
    float strokes = smoothstep(0.35, 0.85, max(s1, 0.9 * s2));
    float D = clamp(dens * (0.70 + 0.55 * strokes), 0.0, 1.0);
    // 粉っぽさ: 顔料の粒が紙の目の山に引っかかる。粒は柔らかく、濃い所でも白く抜ける
    float nP = vn(p * 0.75 + sd * 13.0) * 0.55 + vn(p * 1.6 + 41.0) * 0.30 + tooth * 0.15;
    float c = smoothstep(1.0 - 1.1 * D - 0.12, 1.0 - 1.1 * D + 0.12, nP);
    c *= 1.0 - 0.45 * smoothstep(0.62, 0.86, vn(p * 1.9 + 77.0));   // 濃い所にも残る紙の白い点
    // 粒ごとに色が違う (明るい黄緑〜濃い緑)。重なって濃い所ほど暗い粒が増える
    float tone = clamp(0.15 + 0.70 * D + 0.80 * (vn(p * 0.8 + 57.0) - 0.5), 0.0, 1.0);
    col = mix(min(vC.rgb * vec3(1.75, 1.45, 1.6) + vec3(0.05, 0.03, 0.0), vec3(1.0)), vC.rgb * 0.72, tone);
    a = c * (0.68 + 0.24 * D) * inside;
  }
  a *= vB.w;
  o = vec4(col * a, a);
}`,


  _compile(type, src){
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('Rhizome shader:', gl.getShaderInfoLog(s));
    return s;
  },
  _link(vs, fs){
    const gl = this.gl;
    const p = gl.createProgram();
    gl.attachShader(p, this._compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this._compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)){ console.error('Rhizome link:', gl.getProgramInfoLog(p)); return null; }
    return p;
  },

  init(gl){
    this.gl = gl;
    this.prog = this._link(this.VS, this.FS);
    this.ok = !!this.prog;
    if(this.ok){
      const U = (n)=>gl.getUniformLocation(this.prog, n);
      this.U = { cam:U('uCam'), half:U('uHalf'), px:U('uPx'), pencil:U('uPencil'), hand:U('uHand'), boil:U('uBoil'), sqFill:U('uSqFill') };
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      this.cornerVBO = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerVBO);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 1,1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.instVBO = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instVBO);
      for(let k = 0; k < 4; k++){
        gl.enableVertexAttribArray(1 + k);
        gl.vertexAttribPointer(1 + k, 4, gl.FLOAT, false, 64, k * 16);
        gl.vertexAttribDivisor(1 + k, 1);
      }
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    this._memo = new Map();
    this.initialized = true;
  },
  update(){},

  // ── 乱数 (整数 3 つ + シードから 0..1) ──
  _hash(a, b, c){
    let x = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x2f6b2f8b) ^ this._salt;
    x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
    x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
    x ^= x >>> 15;
    return (x >>> 0) / 4294967296;
  },

  // 画面のゆっくりした流れ (時間の単位ごと)
  _camX(t){ return this._cfg.drift * (0.05 * t + 0.15 * Math.sin(t * 0.07)); },
  _camY(t){ return this._cfg.drift * 0.10 * Math.sin(t * 0.05 + 1.0); },

  // 立ち上がりきったときの向き (yaw) の座標 (qx = 画面の横, qy = 奥) から地面へ
  _fromYaw(qx, qy, tx, ty){
    const c = this._cfg;
    return [tx + qx * c.cpsM + qy * c.spsM, ty - qx * c.spsM + qy * c.cpsM];
  },
  // 地面の点 (中心からのずれ) が、立ち上がりきったときの画面に入るか
  _inRisen(dx, dy){
    const c = this._cfg;
    const qx = dx * c.cpsM - dy * c.spsM, qy = dx * c.spsM + dy * c.cpsM;
    const depth = qy * c.sphM + c.D;
    if(depth < 0.3) return false;
    const k = c.D / depth;
    return Math.abs(qx * k) < c.aspect * 0.55 && Math.abs(qy * c.cphM * k) < 0.55;
  },

  // 枠 id の要素の、時刻 t を含む周期 (寿命 = Life × lifeMul のまわりでばらつく)。x は周期内の位置 0..1
  _pool(id, t, lifeMul){
    const c = this._cfg;
    let T = c.life * lifeMul * (0.7 + 0.6 * this._hash(id, 0, 1));
    if(c.beat) T = Math.max(1, Math.round(T * 2) / 2);
    let o = this._hash(id, 0, 2) * T;
    if(c.beat) o = Math.floor(o * 2) / 2;
    const n = Math.floor((t + o) / T), s = n * T - o;
    return { n, s, T, x:(t - s) / T };
  },
  // ノード i の周期と位相のずれ。beat では半拍にそろえる
  _period(i){
    const c = this._cfg;
    let T = c.life * (0.6 + 0.9 * this._hash(i, 0, 1));
    if(c.beat) T = Math.max(1, Math.round(T * 2) / 2);
    return T;
  },
  _cycAt(i, t){
    const T = this._period(i);
    let o = this._hash(i, 0, 2) * T;
    if(this._cfg.beat) o = Math.floor(o * 2) / 2;
    return this._cyc(i, Math.floor((t + o) / T), T, o);
  },
  // ノード i の n 回目の周期 (種類・段・寿命)。位置は _place で決める
  _cyc(i, n, T, o){
    const key = i + ':' + n;
    let r = this._memo.get(key);
    if(r) return r;
    const c = this._cfg;
    const s = n * T - o;
    const hk = this._hash(i, n, 4);
    let kind = 'e';                                       // e = 楕円 / d = 端点 / s = 四角 / m = 菱形
    if(hk < c.pSquare) kind = 's';
    else if(hk < c.pSquare + c.pDiamond) kind = 'm';
    else if(hk < c.pSquare + c.pDiamond + c.pTendril) kind = 'd';
    const pin = Math.min(0.5, Math.max(0.12, 0.1 * T));
    r = {
      i, n, s, T, pin, kind,
      present: this._hash(i, n, 3) < 0.86,
      tier: Math.floor(this._hash(i, n, 5) * 3.999),
      h: this._hash(i, n, 9),
      x:0, y:0, parent:null, placed:false, links:null,
      tPop:s, tDie:s + 0.8 * T,
    };
    this._memo.set(key, r);
    return r;
  },
  // 位置: 段が浅く、生まれる時点で生きている親がいればその近く。いなければ画面のどこか
  // (立ち上がりがあるときは、平らな画面と立ち上がった画面のどちらかに入る所)
  _place(r){
    if(r.placed) return r;
    r.placed = true;
    const c = this._cfg;
    // 親の候補を 4 つまで当たる
    for(let tr = 0; tr < 4 && r.tier > 0 && c.N > 1 && !r.parent; tr++){
      let j = Math.floor(this._hash(r.i, r.n, 20 + tr) * c.N);
      if(j === r.i) j = (j + 1) % c.N;
      const p = this._cycAt(j, r.s);
      if(!p.present || p.tier >= r.tier || p.kind === 'd') continue;
      this._place(p);
      if(r.s < p.tPop + p.pin || r.s >= p.tDie - p.pin) continue;
      const a = this._hash(r.i, r.n, 7) * Math.PI * 2;
      const dist = c.spread * (0.07 + 0.16 * this._hash(r.i, r.n, 8)) * (r.kind === 'd' ? 2.2 : 1.0);
      r.x = p.x + Math.cos(a) * dist;
      r.y = p.y + Math.sin(a) * dist * 0.8;
      r.parent = p;
    }
    if(!r.parent){
      const tx = this._camX(r.s), ty = this._camY(r.s);
      r.x = tx + (this._hash(r.i, r.n, 10) - 0.5) * c.aspect * 1.04;
      r.y = ty + (this._hash(r.i, r.n, 11) - 0.5) * 1.0;
      for(let k = 0; k < 6 && c.riseK > 0; k++){
        const dx = (this._hash(r.i, r.n, 30 + 2 * k) - 0.5) * 3.2, dy = (this._hash(r.i, r.n, 31 + 2 * k) - 0.5) * 3.2;
        if((Math.abs(dx) < c.aspect * 0.52 && Math.abs(dy) < 0.5) || this._inRisen(dx, dy)){ r.x = tx + dx; r.y = ty + dy; break; }
      }
    }
    // 親がいれば線が伸びて届いた所でポップ
    if(r.parent){
      const d = Math.hypot(r.x - r.parent.x, r.y - r.parent.y);
      r.tPop = r.s + Math.min(1.2, Math.max(0.15, d / 0.35));
    }
    if(r.tPop + r.pin > r.tDie) r.tPop = Math.max(r.s, r.tDie - r.pin);
    return r;
  },
  // 現れたとき近くで生きているノード (親を除く) へ伸ばす線の相手
  _linksOf(r){
    if(r.links) return r.links;
    r.links = [];
    const c = this._cfg;
    if(r.kind === 'd' || c.links <= 0) return r.links;
    const want = Math.round(c.links * (1.5 + 3.0 * this._hash(r.i, r.n, 12)));
    if(want <= 0) return r.links;
    // 近くのノード (R 以内) / 網をまたぐ遠くのノード (R〜2.6R、長い線) / 四角どうしはさらに遠くまで (茶色の長い線)
    const R = 0.40 * c.spread, RL = 2.6 * R, RS = 0.9 * c.spread, t0 = r.tPop;
    const cand = [], far = [], sq = [];
    for(let j = 0; j < c.N; j++){
      if(j === r.i) continue;
      const q = this._cycAt(j, t0);
      if(!q.present || q.kind === 'd' || q === r.parent) continue;
      this._place(q);
      if(t0 < q.tPop + q.pin || t0 > q.tDie - 0.5 * q.pin) continue;
      const dx = q.x - r.x, dy = q.y - r.y, d2 = dx * dx + dy * dy;
      if(d2 < R * R) cand.push([d2, q]);
      else if(d2 < RL * RL) far.push([this._hash(r.i * 977 + j, r.n, 13), q]);   // 遠くは距離でなく乱数で選ぶ
      if(r.kind === 's' && q.kind === 's' && d2 >= R * R && d2 < RS * RS) sq.push([d2, q]);
    }
    cand.sort((a, b)=>a[0] - b[0]);
    for(let k = 0; k < Math.min(want, cand.length); k++) r.links.push(cand[k][1]);
    far.sort((a, b)=>a[0] - b[0]);
    const nFar = Math.floor(c.links * 1.2 * this._hash(r.i, r.n, 14) + 0.5);
    for(let k = 0; k < Math.min(nFar, far.length); k++) r.links.push(far[k][1]);
    sq.sort((a, b)=>a[0] - b[0]);
    for(let k = 0; k < Math.min(2, sq.length); k++) if(!r.links.includes(sq[k][1])) r.links.push(sq[k][1]);
    return r.links;
  },

  _ease(x, k){ const c1 = 1.7 * k, c3 = c1 + 1, y = x - 1; return 1 + c3 * y * y * y + c1 * y * y; },
  // ノードの大きさ: tPop でふくらんで (弾んで) 現れ、tDie からしぼむ
  _scale(r, t){
    const c = this._cfg;
    if(t < r.tPop) return 0;
    const pout = 0.8 * r.pin;
    if(t > r.tDie + pout) return 0;
    const g = this._ease(Math.min(1, (t - r.tPop) / r.pin), c.pop);
    const y = Math.max(0, Math.min(1, (t - r.tDie) / pout));
    const k = (1 - y * y * (3 - 2 * y)) * (1 + 0.25 * c.pop * Math.sin(y * Math.PI));
    return Math.max(0, g * k);
  },

  // 周期の中の位置 x で、xPop にふくらんで (弾んで) 現れ、xDie からしぼむ大きさ。pin = ふくらむ・しぼむ長さ
  _popAt(x, xPop, xDie, pin, pop){
    if(x < xPop || x > xDie + pin) return 0;
    const g = this._ease(Math.min(1, (x - xPop) / pin), pop);
    const y = Math.max(0, Math.min(1, (x - xDie) / pin));
    return Math.max(0, g * (1 - y * y * (3 - 2 * y)));
  },
  _clamp01(v){ return v < 0 ? 0 : (v > 1 ? 1 : v); },

  // 扇 (逃走線): 小さなバネから青い線が同じ向きに巻きながら扇形に伸び、届いた先で黄緑の円盤がふくらむ。
  // 円盤は流れに向き合い、遠いほど大きい。いくつかは黒い種。緑の線が円盤を抜けて先へ伸びる (Links)。
  // 最後は尾が先へ追いついて消える (intro-08 / 08b / 08c の雰囲気)
  _fan(K){
    const {t, H, C} = K;
    const nC = Math.round(14 * K.pct('curves')), nF = K.num('fans', 1, 10), openK = K.pct('open'), swK = K.pct('swirl'), seedK = K.pct('seeds');
    if(nC <= 0) return;
    const c01 = this._clamp01;
    for(let g = 0; g < nF; g++){
      const id = 600000 + g, cy2 = this._pool(id, t, 2.6), n = cy2.n, s = cy2.s, x = cy2.x;
      if(H(id, n, 3) > 0.85 || x > 0.95) continue;
      const tx = this._camX(s), ty = this._camY(s);
      const sx = tx + (H(id, n, 4) - 0.5) * K.aspect * 0.8, sy = ty + (H(id, n, 5) - 0.5) * 0.7;
      const dir = Math.atan2(ty - sy, tx - sx + 1e-6) + (H(id, n, 6) - 0.5) * 1.2;   // おおむね画面の中ほどへ向く
      const open = (0.8 + 0.9 * H(id, n, 7)) * openK;
      const len = (0.55 + 0.4 * H(id, n, 8)) * K.spread;
      const sw = (H(id, n, 9) < 0.5 ? -1 : 1) * (0.5 + 0.6 * H(id, n, 10)) * swK;
      const al = 0.9 * c01(x / 0.03) * (1 - c01((x - 0.88) / 0.07));
      // 源のバネ: 線の根元の後ろに小さく巻く
      const ca = Math.cos(dir), sa = Math.sin(dir), cL = 0.07 * K.sizeK, cr = 0.012 * K.sizeK;
      const coil = (v)=>{
        const k = v * 10 * Math.PI, along = -cL * (1 - v) + cr * 0.6 * Math.cos(k), side = cr * Math.sin(k);
        return [sx + ca * along - sa * side, sy + sa * along + ca * side, 0];
      };
      K.pushPoly(K.arcs, coil, 90, 0, c01(x / 0.06), K.hwB, C.ink, al, false, H(id, n, 11));
      for(let j = 0; j < nC; j++){
        const hj = (c)=>H(id * 64 + j, n, c);
        const th = dir + open * ((nC > 1 ? j / (nC - 1) : 0.5) - 0.5) + (hj(1) - 0.5) * 0.08;
        const Lj = len * (0.75 + 0.45 * hj(2));
        const ex = sx + Math.cos(th) * Lj, ey = sy + Math.sin(th) * Lj;
        // 3 次の曲線: 出だしは巻く向きへ振れ、先は流れに沿って入る
        const a1 = th + sw * 0.9, a2 = th - sw * 0.4;
        const c1x = sx + Math.cos(a1) * Lj * 0.5, c1y = sy + Math.sin(a1) * Lj * 0.5;
        const c2x = ex - Math.cos(a2) * Lj * 0.35, c2y = ey - Math.sin(a2) * Lj * 0.35;
        const f = (v)=>{
          const w0 = (1 - v) * (1 - v) * (1 - v), w1 = 3 * (1 - v) * (1 - v) * v, w2 = 3 * (1 - v) * v * v, w3 = v * v * v;
          return [w0 * sx + w1 * c1x + w2 * c2x + w3 * ex, w0 * sy + w1 * c1y + w2 * c2y + w3 * ey, 0];
        };
        const st = 0.04 + 0.22 * hj(3), xe = 0.80 - st * 0.4;
        const lf = K.life2(x - st, 0.20, 0.62 - st * 0.5, xe - st);
        if(!lf) continue;
        const colL = hj(4) < 0.22 ? C.green : C.blue, dashed = hj(5) < 0.18;
        K.pushPoly(K.arcs, f, dashed ? 34 : 26, lf[0], lf[1], K.hwL, colL, al, dashed, hj(6));
        if(lf[1] >= 1 && lf[0] <= 0 && !dashed) K.pushArrow(K.arcs, f(1), f(0.97), K.hwL, colL, al, hj(7));
        // 先の円盤 (4 分の 1 は黒い種): 線が 0.86 まで届いたらふくらむ
        const xp = st + 0.20 * 0.86;
        const sc = this._popAt(x, xp, xe - 0.06, 0.05, K.pop) * (1 + 0.15 * K.kick);
        if(sc <= 0.001) continue;
        const pc = f(0.86), pn = f(0.88), tang = Math.atan2(pn[1] - pc[1], pn[0] - pc[0]);
        if(hj(8) < seedK){
          K.pushEllipse(pc[0], pc[1], 0.008 * K.sizeK * sc, 0.005 * K.sizeK * sc, tang + Math.PI / 2, C.ink, C.ink, hj(9));
        } else {
          const r = 0.115 * (0.10 + 0.18 * hj(10)) * K.sizeK * (0.6 + 0.6 * Lj / len) * sc;
          K.pushEllipse(pc[0], pc[1], r, r * (0.38 + 0.15 * hj(11)), tang + Math.PI / 2, C.lime, C.limeRim, hj(9));
        }
        if(hj(12) < 0.5 * K.links){
          const q0 = f(0.8), q1 = [pc[0] + Math.cos(tang) * 0.12 * K.spread, pc[1] + Math.sin(tang) * 0.12 * K.spread, 0];
          const g2 = Math.min(c01((x - xp) / 0.08), 1 - c01((x - xe + 0.06) / 0.05));
          K.line3(K.lines, q0, q1, K.hwG, al * 0.9, C.green, hj(13), g2);
          if(g2 >= 1) K.pushArrow(K.lines, q1, [q0[0] + (q1[0] - q0[0]) * 0.9, q0[1] + (q1[1] - q0[1]) * 0.9, 0], K.hwG, C.green, al * 0.9, hj(14));
        }
      }
    }
  },

  // 群れの輪: 黄緑の楕円が輪をまわって順にふくらみ、輪の上の宙の一点 (濃い緑) から全員へ線が伸びる。
  // 輪はゆっくり回り、隣どうしが短い線でつながり、ときどき一つが輪を離れて外へ逃げる (Links)。別の輪とも線でつながる。
  // 平らなときは真上から見るので一点から放射状に、地面が倒れると円錐に見える (1914-08 / 11 / 12a の雰囲気)
  _packs(K){
    const {t, H, C} = K;
    const c01 = this._clamp01, al = 0.88, rings = [];
    const nR = K.num('rings', 1, 12), memK = Math.max(0.05, K.pct('members')), hubK = K.pct('hub'), floatK = K.pct('float');
    for(let g = 0; g < nR; g++){
      const id = 700000 + g, cy2 = this._pool(id, t, 3.2), n = cy2.n, s = cy2.s, x = cy2.x;
      if(H(id, n, 3) > 0.85 || x > 0.97) continue;
      const tx = this._camX(s), ty = this._camY(s);
      const ox = tx + (H(id, n, 4) - 0.5) * K.aspect * 0.8, oy = ty + (H(id, n, 5) - 0.5) * 0.7;
      const R = (0.09 + 0.12 * H(id, n, 6)) * K.spread;
      const m = Math.max(5, Math.min(40, Math.round((9 + 12 * H(id, n, 7)) * memK)));
      const z = H(id, n, 8) < floatK ? 0.10 + 0.20 * H(id, n, 9) : 0;          // 宙に浮く輪
      const hub = [ox + (H(id, n, 10) - 0.5) * R * 0.4, oy + (H(id, n, 11) - 0.5) * R * 0.4, z + (0.22 + 0.25 * H(id, n, 12)) * hubK];
      const a0 = H(id, n, 13) * Math.PI * 2 + (H(id, n, 14) - 0.5) * 0.5 * (t - s);
      const sh = this._popAt(x, 0.02, 0.86, 0.04, K.pop);
      if(sh > 0.001) K.pushEllipse(hub[0], hub[1], 0.016 * K.sizeK * sh, 0.010 * K.sizeK * sh, H(id, n, 15) * 3, C.hub, C.limeRim, H(id, n, 16), hub[2]);
      const pos = [];
      for(let j = 0; j < m; j++){
        const hj = (c)=>H(id * 64 + j, n, c);
        const aj = a0 + Math.PI * 2 * (j + (hj(1) - 0.5) * 0.35) / m;
        const esc = hj(3) < 0.12 * K.links ? c01((x - 0.5 - 0.15 * hj(4)) / 0.3) : 0;   // 輪を離れて逃げる
        const rr = R * (0.92 + 0.16 * hj(2)) * (1 + 1.6 * esc * esc);
        const p = [ox + Math.cos(aj) * rr, oy + Math.sin(aj) * rr, z];
        pos.push(p);
        const xp = 0.06 + 0.28 * j / m, xd = 0.78 + 0.10 * j / m;
        const sc = this._popAt(x, xp, xd, 0.05, K.pop) * (1 + 0.15 * K.kick);
        const rx = Math.min(R * Math.PI / m * 0.8, 0.05) * (0.8 + 0.4 * hj(5)) * K.sizeK * sc;
        if(sc > 0.001) K.pushEllipse(p[0], p[1], rx, rx * (0.5 + 0.15 * hj(6)), aj + Math.PI / 2, C.lime, C.limeRim, hj(7), z);
        // 宙の一点から伸びる線 (現れたあと点の側から伸び、消える前に点へ縮む)
        const gl = Math.min(c01((x - xp - 0.04) / 0.10), 1 - c01((x - xd + 0.06) / 0.06));
        if(gl > 0) K.line3(K.lines, hub, p, K.hwG * 0.85, al, C.green, hj(8), gl);
        if(esc > 0.05 && sc > 0.001){
          const ux = Math.cos(aj), uy = Math.sin(aj), L0 = rx * 1.2, L1 = rx * 1.2 + 0.05 * K.spread * esc;
          const q0 = [p[0] + ux * L0, p[1] + uy * L0, z], q1 = [p[0] + ux * L1, p[1] + uy * L1, z];
          K.line3(K.lines, q0, q1, K.hwG, al, C.green, hj(9));
          K.pushArrow(K.lines, q1, q0, K.hwG, C.green, al, hj(10));
        }
      }
      // 隣どうしを短い線で (鎖)
      for(let j = 0; j < m; j++){
        if(H(id * 64 + j, n, 11) > 0.8) continue;
        const k = (j + 1) % m, st = 0.06 + 0.28 * Math.max(j, k) / m + 0.04;
        const gc = Math.min(c01((x - st) / 0.05), 1 - c01((x - 0.76 - 0.10 * Math.min(j, k) / m) / 0.05));
        if(gc > 0) K.line3(K.lines, pos[j], pos[k], K.hwG, al, C.green, H(id * 64 + j, n, 12), gc);
      }
      rings.push({id, n, x, pos});
    }
    // 別の輪どうしも長い線でつながる (どちらも輪がそろっている間)
    for(let a = 0; a < rings.length; a++){
      for(let b = a + 1; b < rings.length; b++){
        const A = rings[a], B = rings[b];
        for(let e = 0; e < 2; e++){
          if(H(A.id * 31 + B.id, A.n * 7 + B.n, 40 + e) > 0.6 * K.links) continue;
          const pa = A.pos[Math.floor(H(A.id, A.n, 50 + e) * A.pos.length)], pb = B.pos[Math.floor(H(B.id, B.n, 50 + e) * B.pos.length)];
          const st = 0.4 + 0.1 * H(A.id + B.id, A.n + B.n, 60 + e);
          const gx = Math.min(c01((Math.min(A.x, B.x) - st) / 0.12), 1 - c01((Math.max(A.x, B.x) - 0.74) / 0.05));
          if(gx > 0) K.line3(K.lines, pa, pb, K.hwG, al * 0.8, C.green, H(A.id + B.id, A.n + B.n, 70 + e), gx);
        }
      }
    }
  },

  // 積層: 網 (黄緑の楕円と緑の線。楕円から矢印の付いた線が伸び、いくつかの楕円を青い縦の両矢印が貫く) の上に、楕円が縦に積み重なる柱が立つ。
  // 柱は 1 つの楕円 (矢印が放射) → 青い軸が伸びる → 上・中・下に楕円が現れて赤い筒に囲まれる → 楕円が詰まって積み重なる
  // → 筒が消え、柱が傾いてうねりながらほどけ、線を伸ばして散る (intro-23 の雰囲気)。
  // 柱と青い縦の軸は、平らなときは地面に寝ていて画面の上へ向かい (つぶれた楕円が縦に重なる、絵と同じ見え方)、
  // 地面が倒れるにつれて根元を蝶番に 90° 立ち上がる (楕円は地面と平行な円になる)。Rise 0 で寝たまま
  _stack(K){
    const {t, H, C} = K;
    const c01 = this._clamp01, al = 0.88;
    const sm = (v)=>{ v = c01(v); return v * v * (3 - 2 * v); };
    const lerp3 = (a, b, k)=>[a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    // 画面で見える長さがあるときだけ矢印を付ける (真上から見た縦の線は点になる)
    const arrow = (arr, tip, from, hw, col, a, sd)=>{
      const p0 = K.P3(tip[0], tip[1], tip[2]), p1 = K.P3(from[0], from[1], from[2]);
      if(p0 && p1 && Math.hypot(p0[0] - p1[0], p0[1] - p1[1]) > 0.004) K.pushArrow(arr, tip, from, hw, col, a, sd);
    };
    const nCol = K.num('columns', 0, 8), nLay = K.num('layers', 3, 40), hK = K.pct('height'), axK = K.pct('axes'), arK = K.pct('arrows');
    // 立ち上がりの角度 (要素ごとに少しずれ、少し弾んで立つ) と、そのときの「上」の向き (寝ていると地面の +y = 画面の上)
    const thOf = (lag)=> (Math.PI / 2) * K.riseK * this._ease(c01((K.rn - 0.3 * lag) / 0.7), 0.5 * K.pop);
    const upOf = (th)=> [0, Math.cos(th), Math.sin(th)];
    // ── 網の楕円: 矢印の付いた線と、青い縦の両矢印 ──
    for(const nd of K.netNodes){
      const r = nd.r, hh = (c)=>H(r.i, r.n, c);
      const g = Math.min(c01((t - r.tPop - 0.3 * r.pin) / 0.6), c01((r.tDie - t) / Math.max(0.5 * r.pin, 1e-3)));
      if(g <= 0) continue;
      const nA = Math.min(3, Math.floor(arK * (0.2 + 1.4 * hh(60))));
      for(let k = 0; k < nA; k++){
        const a = hh(61 + k) * Math.PI * 2, L = (0.07 + 0.12 * hh(64 + k)) * K.spread;
        const p0 = [r.x, r.y, 0], p1 = [r.x + Math.cos(a) * L, r.y + Math.sin(a) * L, 0];
        K.line3(K.lines, p0, p1, K.hwG, al, C.green, hh(67 + k), g);
        if(g >= 1) arrow(K.lines, p1, lerp3(p0, p1, 0.9), K.hwG, C.green, al, hh(70 + k));
      }
      if(hh(73) < axK){
        const hA = (0.05 + 0.05 * hh(74)) * hK * Math.min(1, nd.sc), u = upOf(thOf(hh(78)));
        const along = (h)=>[r.x + u[0] * h, r.y + u[1] * h, u[2] * h];
        const top = along(hA), bot = along(-hA);
        K.line3(K.arcs, bot, top, K.hwL, al, C.blue, hh(75));
        arrow(K.arcs, top, along(hA * 0.8), K.hwL, C.blue, al, hh(76));
        arrow(K.arcs, bot, along(-hA * 0.8), K.hwL, C.blue, al, hh(77));
      }
    }
    // ── 柱 ──
    const sx = K.sx;   // 画面の横に見える地面の向き (筒の左右の縁の位置)
    for(let g = 0; g < nCol; g++){
      const id = 900000 + g, cy2 = this._pool(id, t, 3.0), n = cy2.n, s = cy2.s, x = cy2.x;
      if(H(id, n, 3) > 0.9 || x > 0.96) continue;
      const tx = this._camX(s), ty = this._camY(s);
      const R = (0.035 + 0.02 * H(id, n, 6)) * K.sizeK, Hc = (0.30 + 0.20 * H(id, n, 7)) * hK, M = nLay;
      // 根元は、寝ているとき柱の中ほどが画面の高さの中ほどに来る所 (上が画面からはみ出さない)
      const ox = tx + ((g + 0.5) / nCol - 0.5) * 0.85 * K.aspect + (H(id, n, 4) - 0.5) * 0.2, oy = ty - Hc * 0.5 + (H(id, n, 5) - 0.5) * 0.2;
      // 段階 (周期の中の位置 x): 0.02 一つの楕円 / 0.10 青い軸 / 0.22 上・中・下の楕円と赤い筒 / 0.30〜0.55 楕円が詰まる / 0.60〜 ほどけて散る / 0.86〜 消える
      const fade = 1 - sm((x - 0.86) / 0.08);
      const un = sm((x - 0.60) / 0.24);
      const lean = (H(id, n, 8) - 0.5) * 2.0 * R * 4;           // ほどけると傾く (上ほど横へずれる)
      const ph = H(id, n, 9) * 6.28;
      const th = thOf(H(id, n, 11)), u = upOf(th);
      // 柱の根元から、横 (画面の横に見える地面の向き) に w、上 (柱の向き) に h の点
      const pt = (w, h)=>[ox + sx[0] * w + u[0] * h, oy + sx[1] * w + u[1] * h, u[2] * h];
      // 段 k の楕円の位置 (ほどけると傾き、うねり、いくつかは外へ離れて降りる)
      const at = (k)=>{
        const zk = Hc * k / (M - 1), hk2 = H(id * 64 + k, n, 1);
        const wav = un * (lean * zk / Hc + R * 1.3 * Math.sin(k * 0.9 + ph) + R * 0.9 * (hk2 - 0.5));
        const away = hk2 < 0.22 ? un * un * (0.10 + 0.10 * H(id * 64 + k, n, 2)) * K.spread : 0;
        const aa = H(id * 64 + k, n, 3) * 6.28;
        const q = pt(wav, zk * (1 - 0.5 * (away > 0 ? un : 0)));
        return [q[0] + Math.cos(aa) * away, q[1] + Math.sin(aa) * away, q[2]];
      };
      // 現れる順: 下 → 上と中 → 残りを下から
      const mid = Math.floor((M - 1) / 2);
      const popAt = (k)=> k === 0 ? 0.02 : ((k === M - 1 || k === mid) ? 0.22 : 0.30 + 0.25 * k / (M - 1));
      const pos = [];
      for(let k = 0; k < M; k++){
        const p = at(k);
        pos.push(p);
        const sc = this._popAt(x, popAt(k), 0.86, 0.04, K.pop) * (1 + 0.15 * K.kick);
        // 寝ているときは柱の向きにつぶれた楕円 (横から見た円)、立つと地面と平行な円
        const flat = 0.42 + 0.58 * Math.sin(th);
        if(sc > 0.001) K.pushEllipse(p[0], p[1], R * sc, R * sc * flat * (0.92 + 0.16 * H(id * 64 + k, n, 4)), (H(id * 64 + k, n, 5) - 0.5) * 0.25 * (1 - Math.sin(th)), C.lime, C.limeRim, H(id * 64 + k, n, 6), p[2]);
      }
      const p0 = [ox, oy, 0];
      // 1 つ目の楕円から地面に放射する矢印 (軸が伸びると縮む)
      const gr = Math.min(sm((x - 0.03) / 0.05), 1 - sm((x - 0.14) / 0.05));
      for(let k = 0; k < 4 && gr > 0; k++){
        const a = (k + 0.3 * H(id, n, 10 + k)) * Math.PI / 2 + H(id, n, 14) * 6.28, L = (0.07 + 0.05 * H(id, n, 15 + k)) * K.spread;
        const q1 = [ox + Math.cos(a) * L, oy + Math.sin(a) * L, 0];
        K.line3(K.lines, p0, q1, K.hwG, al, C.green, H(id, n, 20 + k), gr);
        if(gr >= 1) arrow(K.lines, q1, lerp3(p0, q1, 0.9), K.hwG, C.green, al, H(id, n, 24 + k));
      }
      // 青い軸 (下から上へ伸び、両端に矢印。ほどけると傾いた柱に沿い、やがて消える)
      const ax = sm((x - 0.10) / 0.10), axA = al * (1 - sm((x - 0.66) / 0.10)) * fade;
      if(ax > 0 && axA > 0.002){
        const lt = lean * un * 1.12;
        const b0 = pt(0, -0.08 * Hc), b1 = pt(lt, Hc * 1.14);
        K.line3(K.arcs, b0, b1, K.hwL, axA, C.blue, H(id, n, 30), ax);
        if(ax >= 1){
          arrow(K.arcs, b1, lerp3(b0, b1, 0.94), K.hwL, C.blue, axA, H(id, n, 31));
          arrow(K.arcs, b0, lerp3(b0, b1, 0.05), K.hwL, C.blue, axA, H(id, n, 32));
        }
      }
      // 赤い筒 (柱の左右の縁。下から上へ伸び、端は外へ小さく折れる。ほどけ始めると消える)
      const tg = sm((x - 0.22) / 0.08), tA = al * (1 - sm((x - 0.58) / 0.06)) * fade;
      if(tg > 0 && tA > 0.002){
        for(const sg of [-1, 1]){
          const o = R * 1.18 * sg;
          const e0 = pt(o, -0.05 * Hc), e1 = pt(o, Hc * 1.06);
          K.line3(K.arcs, e0, e1, K.hwL, tA, C.red, H(id, n, 40 + sg), tg);
          if(tg >= 1){
            const hk3 = R * 0.30 * sg;
            K.line3(K.arcs, e0, [e0[0] + sx[0] * hk3, e0[1] + sx[1] * hk3, e0[2]], K.hwL, tA, C.red, H(id, n, 43 + sg));
            K.line3(K.arcs, e1, [e1[0] + sx[0] * hk3, e1[1] + sx[1] * hk3, e1[2]], K.hwL, tA, C.red, H(id, n, 46 + sg));
          }
        }
      }
      // ほどけると: 隣の段を細い緑の線でつなぎ、傾いた筒の縁を細い緑の線で、上と下の楕円から矢印の付いた線が外へ
      if(un > 0.02){
        const ga = al * Math.min(1, un * 2) * fade;
        for(let k = 0; k + 1 < M; k++) if(H(id * 64 + k, n, 7) < 0.5) K.line3(K.lines, pos[k], pos[k + 1], K.hwG * 0.8, ga, C.green, H(id * 64 + k, n, 8), Math.min(1, un * 1.5));
        for(const sg of [-1, 1]){
          const o = R * 1.4 * sg, lt = lean * un;
          K.line3(K.lines, pt(o, 0), pt(o + lt, Hc), K.hwG * 0.8, ga * 0.8, C.green, H(id, n, 50 + sg), Math.min(1, un * 1.5));
        }
        for(const [k, c] of [[0, 60], [M - 1, 61], [1, 62], [M - 2, 63]]){
          const a = H(id, n, c) * 6.28, L = (0.10 + 0.10 * H(id, n, c + 10)) * K.spread * un;
          const q0 = pos[k], q1 = [q0[0] + Math.cos(a) * L, q0[1] + Math.sin(a) * L, q0[2] * (k < 2 ? 0.5 : 1.15)];   // 立っていれば下の線は下へ、上の線は上へ
          K.line3(K.lines, q0, q1, K.hwG, ga, C.green, H(id, n, c + 20));
          if(un > 0.6) arrow(K.lines, q1, lerp3(q0, q1, 0.9), K.hwG, C.green, ga, H(id, n, c + 30));
        }
      }
    }
  },

  render(opts){
    const gl = this.gl;
    if(!this.initialized || !this.ok || !opts.fbo) return;
    const P = this.P;
    const dz = (v)=> (typeof App !== 'undefined' && App.deadParam) ? App.deadParam(v) : v;
    const w = opts.w, h = opts.h, aspect = w / Math.max(1, h);
    const clock = (opts.clock != null) ? opts.clock : performance.now() / 1000;
    const beatMode = (typeof App !== 'undefined' && App.beatMode === 'beat') && opts.beat != null;
    const spd = Math.max(0, dz(P.speed)) * 0.01;
    const t = (beatMode ? opts.beat : clock) * spd;

    // 設定と記憶 (設定が変わったら引き直す)
    const seed = Math.round(dz(P.seed) || 0);
    const net = this.useNet;                             // 網 (ノードと線) を描く
    const style = this.draw ? -1 : Math.max(0, Math.min(2, Math.round(P.style) || 0));   // 0 = 図 1 / 1 = 図 2 / 2 = 両方 / -1 = 別の図
    const pk = (k)=> P[k] != null ? Math.max(0, dz(P[k]) * 0.01) : 0;   // その図が持たないパラメータは 0 (%)
    const sqK = pk('squares'), diaK = pk('diamonds'), tenK = pk('tendrils');
    const riseK = Math.max(0, Math.min(1, dz(P.rise) * 0.01));
    const deg = Math.PI / 180;
    const tiltM = riseK * Math.max(0, Math.min(70, dz(P.tilt))) * deg, yawM = riseK * Math.max(-90, Math.min(90, dz(P.yaw))) * deg;
    const cfg = {
      // 立ち上がりがあると見える地面が広がるので、枠を増やして平らなときの密度をそろえる
      N: net ? Math.max(1, Math.min(900, Math.round(dz(P.nodes) * (riseK > 0 ? 2.2 : 1)))) : 0,
      life: Math.max(0.5, dz(P.life)),
      beat: beatMode,
      spread: Math.max(0.05, dz(P.spread) * 0.01),
      links: Math.max(0, dz(P.links) * 0.01),
      // 種類の割合: 図 1 は楕円が主、図 2 は菱形が主 (四角なし)、両方はその間
      pSquare: Math.min(0.4, sqK * (style === 0 ? 0.12 : (style === 2 ? 0.06 : 0))),
      pDiamond: Math.min(0.8, style === 1 ? 0.5 + 0.5 * diaK : (style === 2 ? 0.25 + 0.5 * diaK : diaK)),
      pTendril: Math.min(0.6, tenK * (style === 1 ? 0.20 : 0.30)),
      drift: Math.max(0, dz(P.drift) * 0.01) * 0.4,
      pop: Math.max(0, dz(P.pop) * 0.01),
      aspect, riseK, D:2.2,
      cphM: Math.cos(tiltM), sphM: Math.sin(tiltM), cpsM: Math.cos(yawM), spsM: Math.sin(yawM),
    };
    const sig = [cfg.N, cfg.life, cfg.beat, cfg.spread, cfg.links, cfg.pSquare, cfg.pDiamond, cfg.pTendril, cfg.drift, aspect.toFixed(3), seed, tiltM.toFixed(4), yawM.toFixed(4)].join('|');
    if(sig !== this._sig || this._memo.size > 60000){ this._memo.clear(); this._sig = sig; }
    this._cfg = cfg;
    this._salt = Math.imul(seed + 1, 0x6a09e667) | 0;

    // 平ら ↔ 立ち上がり: 周期の 0〜30% 平ら / 30〜50% 立ち上がる / 50〜80% 立った / 80〜100% 倒れる
    const sm = (x)=> x * x * (3 - 2 * x);
    const cyc = Math.max(2, dz(P.cycle));
    let ph = (t / cyc) % 1;
    if(ph < 0) ph += 1;
    const rn = riseK <= 0 ? 0 : (ph < 0.3 ? 0 : ph < 0.5 ? sm((ph - 0.3) / 0.2) : ph < 0.8 ? 1 : 1 - sm((ph - 0.8) / 0.2));
    const v2 = style === 0 ? rn : (style > 0 ? 1 : 0);   // 図 2 の要素 (面・流れ・赤線・帯) の出方
    const v1 = (style === 0 || style === 2) ? 1 : 0;     // 図 1 の要素 (青い弧)
    const phi = rn * tiltM, psi = rn * yawM;
    const cph = Math.cos(phi), sph = Math.sin(phi), cps = Math.cos(psi), sps = Math.sin(psi), D = cfg.D;
    const cx = this._camX(t), cy = this._camY(t);
    // 地面 (x, y) と高さ z を画面へ。[x, y, 奥行き]。平らなとき (phi = psi = 0) は x, y そのまま
    const P3 = (x, y, z)=>{
      const qx0 = x - cx, qy0 = y - cy;
      const qx = qx0 * cps - qy0 * sps, qy = qx0 * sps + qy0 * cps;
      const depth = qy * sph - z * cph + D;
      if(depth < 0.25) return null;
      const k = D / depth;
      return [cx + qx * k, cy + (qy * cph + z * sph) * k, depth];
    };

    const C = this.COL;
    const sizeK = Math.max(0, dz(P.size) * 0.01);
    const lineK = Math.max(0.05, dz(P.line) * 0.01);
    const kick = Math.max(0, dz(P.kick) * 0.01) * (beatMode ? Math.pow(1 - (opts.beat - Math.floor(opts.beat)), 2) : 0);
    const u = 1 / 1080;                        // 1080p の 1px (線幅の単位)
    const hwG = 0.60 * u * lineK, hwB = 0.72 * u * lineK, hwL = 0.90 * u * lineK, rDot = 1.8 * u * lineK, hwE = 0.62 * u * lineK;
    const mx = aspect * 0.5 + 0.1, my = 0.6;
    const onScreen = (p)=> p && Math.abs(p[0] - cx) < mx + 0.2 && Math.abs(p[1] - cy) < my + 0.2;
    // 手描きのばらつきの種 (0..1)。地面の位置や要素の番号から決めるので、地面が倒れて画面での位置が変わっても同じ
    const sd2 = (x, y)=>{ const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
    const fr = (v)=> v - Math.floor(v);

    const inst = (arr, a0, a1, a2, a3, b0, b1, b2, b3, col, d0, d1, d2, d3, sd)=>{
      arr.push(a0, a1, a2, a3, b0, b1, b2, b3, col[0], col[1], col[2], sd || 0, d0, d1, d2, d3);
    };
    const lines = [], arcs = [], figs = [], back = [], fills = [];   // fills: [奥行き, 層, インスタンス 16 個] (奥から重ねる。同じ奥行きは四角 → 楕円・菱形)
    const fill = (depth, a0, a1, a2, a3, b0, b1, b2, b3, col, d0, d1, d2, d3, sd)=>{
      fills.push([depth, (b0 === 3 && b1 > 0) ? 0 : 1, [a0, a1, a2, a3, b0, b1, b2, b3, col[0], col[1], col[2], sd || 0, d0, d1, d2, d3]]);
    };
    // 地面/空中の線分 (3D の両端) を画面へ。full = その線の全体の両端 (3D の 6 数)。あれば手描きのたわみとインクだまりを全体で測る
    const seg3 = (arr, ax, ay, az, bx, by, bz, hw, al, col, sd, full)=>{
      const pa = P3(ax, ay, az), pb = P3(bx, by, bz);
      if(!pa || !pb || al <= 0.002) return;
      if(!onScreen(pa) && !onScreen(pb) && Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) < 0.3) return;
      const fa = full ? P3(full[0], full[1], full[2]) : null, fb = full ? P3(full[3], full[4], full[5]) : null;
      if(fa && fb) inst(arr, pa[0], pa[1], pb[0], pb[1], 0, 1, hw, al, col, fa[0], fa[1], fb[0], fb[1], sd);
      else inst(arr, pa[0], pa[1], pb[0], pb[1], 0, 0, hw, al, col, 0, 0, 0, 0, sd);
    };
    // 3D の点 a→b の 1 本の手描きの線のうち [0, g] (伸びる途中も、たわみは全体で測る)
    const line3 = (arr, a, b, hw, al, col, sd, g)=>{
      g = g == null ? 1 : g;
      if(g <= 1e-4) return;
      seg3(arr, a[0], a[1], a[2], a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g, a[2] + (b[2] - a[2]) * g, hw, al, col, sd, [a[0], a[1], a[2], b[0], b[1], b[2]]);
    };
    // 地面の線分 S→E のうち [u0, u1]
    const pushLine = (sx, sy, ex, ey, u0, u1, hw, col)=>{
      if(u1 <= u0 + 1e-4) return;
      seg3(lines, sx + (ex - sx) * u0, sy + (ey - sy) * u0, 0, sx + (ex - sx) * u1, sy + (ey - sy) * u1, 0, hw, 0.88, col,
        sd2(sx + 1.7 * ex, sy + 2.3 * ey), [sx, sy, 0, ex, ey, 0]);
    };
    // 曲線 f(u) = [x, y, z] (u = 0..1) のうち [u0, u1] を M 分割の折れ線で描く。
    // dashed は手で引いた破線: 線と隙間の長さがばらつき、線 1 本ずつがペンの 1 画 (両端にインクがたまる)
    const pushPoly = (arr, f, M, u0, u1, hw, col, al, dashed, sd)=>{
      if(u1 <= u0 || al <= 0.002) return;
      sd = sd || 0;
      if(!dashed){
        for(let k = Math.floor(u0 * M); k < Math.ceil(u1 * M); k++){
          const a = Math.max(u0, k / M), b = Math.min(u1, (k + 1) / M);
          if(b <= a) continue;
          const pa = f(a), pb = f(b);
          seg3(arr, pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], hw, al, col, sd, null);
        }
        return;
      }
      const hs = Math.floor(sd * 1e6), base = 1.6 / M;
      for(let v = 0, k = 0; v < u1 && k < 4 * M; k++){
        const dash = base * (0.5 + 1.1 * this._hash(hs, k, 50)), gap = base * (0.45 + 0.5 * this._hash(hs, k, 51));
        const a = Math.max(u0, v), b = Math.min(u1, v + dash);
        if(b > a){
          const pa = f(a), pb = f(b), fa = f(v), fb = f(Math.min(1, v + dash));
          seg3(arr, pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], hw, al, col, fr(sd + k * 0.137), [fa[0], fa[1], fa[2], fb[0], fb[1], fb[2]]);
        }
        v += dash + gap;
      }
    };
    // 矢印の頭: 画面上の最後の向きで描く。左右の羽の長さと開きは少しずつ違う
    const pushArrow = (arr, tip3, prev3, hw, col, al, sd)=>{
      const pt = P3(tip3[0], tip3[1], tip3[2]), pp = P3(prev3[0], prev3[1], prev3[2]);
      if(!pt || !pp || al <= 0.002) return;
      const dx = pt[0] - pp[0], dy = pt[1] - pp[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, nx = -uy, ny = ux, L = 0.015 * lineK;
      const hs = Math.floor((sd || 0) * 1e6);
      for(const sg of [1, -1]){
        const Lk = L * (0.8 + 0.4 * this._hash(hs, sg, 52)), ok = 0.55 * (0.75 + 0.5 * this._hash(hs, sg, 53));
        const bx = pt[0] - ux * Lk + sg * nx * Lk * ok, by = pt[1] - uy * Lk + sg * ny * Lk * ok;
        inst(arr, pt[0], pt[1], bx, by, 0, 1, hw, al, col, pt[0], pt[1], bx, by, fr((sd || 0) + 0.3 * sg));
      }
    };
    // 地面 (高さ z) の楕円 (中心・半径・向き) を画面の楕円へ (共役半径から主軸を求める)
    const pushEllipse = (x, y, rx, ry, ang, col, col2, sd, z)=>{
      z = z || 0;
      const c0 = P3(x, y, z);
      if(!c0 || !onScreen(c0)) return;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const pa = P3(x + rx * ca, y + rx * sa, z), pb = P3(x - ry * sa, y + ry * ca, z);
      if(!pa || !pb) return;
      const ax = pa[0] - c0[0], ay = pa[1] - c0[1], bx = pb[0] - c0[0], by = pb[1] - c0[1];
      const p = ax * ax + bx * bx, q = ay * ay + by * by, rr = ax * ay + bx * by;
      const df = Math.sqrt((p - q) * (p - q) + 4 * rr * rr);
      const l1 = (p + q + df) / 2, l2 = Math.max(1e-12, (p + q - df) / 2);
      fill(c0[2], c0[0], c0[1], Math.sqrt(l1), Math.sqrt(l2), 1, 0.5 * Math.atan2(2 * rr, p - q), hwE, 1, col, col2[0], col2[1], col2[2], Math.atan2(ay, ax), sd);
    };
    // 地面の四角形 (4 隅) を画面の四角形へ。fa = 塗りの濃さ
    const pushQuad = (cs4, fa, hw, col, sd)=>{
      const pp = cs4.map(([x, y])=>P3(x, y, 0));
      if(pp.some(p=>!p) || !pp.some(onScreen)) return;
      const dep = (pp[0][2] + pp[1][2] + pp[2][2] + pp[3][2]) / 4;
      fill(dep, pp[0][0], pp[0][1], pp[1][0], pp[1][1], 3, fa, hw, 1, col, pp[2][0], pp[2][1], pp[3][0], pp[3][1], sd);
    };
    const dots = [];
    const pushDot = (x, y, r0, col, sc, sd)=>{
      const p = P3(x, y, 0);
      if(!p || !onScreen(p)) return;
      inst(dots, p[0], p[1], r0 * Math.min(sc, 1.3), 0, 2, 0, 0, 1, col, 0, 0, 0, 0, sd);
    };
    // 線の出方: start から dur で伸び、end の rd 前から縮む。縮む向きは先に消える側へ
    const span = (start, dur, end, rd, shrinkToStart)=>{
      if(t < start || t > end) return null;
      const g = Math.min(1, (t - start) / Math.max(dur, 1e-3));
      const k = Math.max(0, Math.min(1, (t - (end - rd)) / Math.max(rd, 1e-3)));
      return shrinkToStart ? [0, Math.min(g, 1 - k)] : [k, g];
    };
    // 立ち上がると楕円の半分が菱形に変わる (図 1 → 図 2。ノードごとに少しずつずれる)。0 = 楕円 / 1 = 菱形
    const morphOf = (r)=>{
      if(r.kind === 'm') return 1;
      if(r.kind !== 'e' || (style !== 0 && style !== 2) || this._hash(r.i, r.n, 40) >= 0.5) return 0;
      return sm(Math.max(0, Math.min(1, (rn - 0.4 * this._hash(r.i, r.n, 41)) / 0.6)));
    };
    const mixC = (a, b, k)=>[a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    // 線の色: 四角がらみは茶色、菱形どうしは灰茶 (変わる途中は混ぜる)、ほかは緑
    const lineCol = (a, b)=> (a.kind === 's' || b.kind === 's') ? [C.brown, hwB] : [mixC(C.green, C.taupe, Math.min(morphOf(a), morphOf(b))), hwG];

    // ── ノードと線 (すべて地面) ──
    const reach = 1.9;   // 立ち上がると見える地面が広がるので、中心からこの範囲までは描く
    const netNodes = [];
    for(let i = 0; net && i < cfg.N; i++){
      const r = this._cycAt(i, t);
      if(!r.present) continue;
      this._place(r);
      if(r.kind === 'd' && !r.parent) continue;   // 端点は親から伸びる線の先にだけ出す
      if(t > r.tDie + 0.8 * r.pin) continue;
      if(Math.abs(r.x - cx) > reach || Math.abs(r.y - cy) > reach) continue;
      // 親からの線 (伸びて届いた所でポップ)
      if(r.parent){
        const p = r.parent;
        const end = Math.min(r.tDie, p.tDie);
        const sp = span(r.s, r.tPop - r.s, end, 0.7 * r.pin, r.tDie <= p.tDie);
        if(sp){ const [lc, hw] = lineCol(r, p); pushLine(p.x, p.y, r.x, r.y, sp[0], sp[1], hw, lc); }
      }
      // 現れたあと近くのノードへ伸ばす線
      if(t >= r.tPop){
        for(const q of this._linksOf(r)){
          const d = Math.hypot(q.x - r.x, q.y - r.y);
          const end = Math.min(r.tDie, q.tDie);
          const sp = span(r.tPop + 0.5 * r.pin, Math.min(1.4, Math.max(0.2, d / 0.4)), end, 0.7 * r.pin, r.tDie <= q.tDie);
          if(sp){ const [lc, hw] = lineCol(r, q); pushLine(r.x, r.y, q.x, q.y, sp[0], sp[1], hw, lc); }
        }
      }
      // ノード
      const sc = this._scale(r, t) * (1 + 0.15 * kick);
      if(sc <= 0.001) continue;
      if(this.draw && r.kind === 'e') netNodes.push({r, sc});   // 別の図が網の楕円に描き足す
      const hh = r.h;
      if(r.kind === 'd'){
        pushDot(r.x, r.y, rDot, C.dot, sc, sd2(r.x, r.y));
      } else if(r.kind === 's'){
        // 茶色の四角 (地面に置いた正方形。斜めから見ると菱形)
        const hs = 0.115 * (0.30 + 0.12 * hh) * sizeK * sc, a = ((hh * 7.7) % 1 - 0.5) * 0.16, ca = Math.cos(a), sa = Math.sin(a);
        const cs4 = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([ux, uy])=>[r.x + (ux * ca - uy * sa) * hs, r.y + (ux * sa + uy * ca) * hs]);
        pushQuad(cs4, 0.5, hwB, C.sqLine, sd2(r.x, r.y));
      } else {
        const mo = morphOf(r);
        if(mo > 0.001){
          // ベージュの水彩の菱形 (灰茶の縁)
          const rx = 0.115 * (0.12 + 0.20 * hh) * sizeK * sc * mo, ry = rx * 0.62, a = ((hh * 5.7) % 1 - 0.5) * 0.5, ca = Math.cos(a), sa = Math.sin(a);
          const cs4 = [[rx, 0], [0, ry], [-rx, 0], [0, -ry]].map(([ux, uy])=>[r.x + ux * ca - uy * sa, r.y + ux * sa + uy * ca]);
          pushQuad(cs4, 0.42, hwG, C.taupe, sd2(r.x + 0.5, r.y));
        }
        if(mo < 0.999){
          const rx = 0.115 * (0.10 + 0.30 * Math.pow(hh, 1.5)) * sizeK * sc * (1 - mo);
          const ry = rx * (0.58 + 0.24 * ((hh * 7.3) % 1));
          pushEllipse(r.x, r.y, rx, ry, ((hh * 13.1) % 1 - 0.5) * 0.7, C.lime, C.limeRim, sd2(r.x, r.y));
        }
      }
    }

    const life2 = (x, grow, out, end)=>{
      if(x > end) return null;
      const g = Math.min(1, x / grow), k = Math.max(0, Math.min(1, (x - out) / (end - out)));
      return g > k ? [k, g] : null;
    };
    const H = (id, n, c)=>this._hash(id, n, c);
    const arcsK = pk('arcs');

    // ── 扇 / 群れの輪 / 積層 (描く道具と、その図のパラメータを渡す) ──
    if(this.draw){
      const K = {
        t, aspect, sizeK, kick, C, H, P3, line3, pushPoly, pushArrow, pushEllipse, life2, mixC, lines, arcs, netNodes, rn, riseK,
        sx:[cps, -sps],
        hwG, hwB, hwL, pop:cfg.pop, spread:cfg.spread, links:cfg.links,
        pct:(k)=>Math.max(0, dz(P[k]) * 0.01), num:(k, lo, hi)=>Math.max(lo, Math.min(hi, Math.round(dz(P[k])))),
        paper:Array.isArray(P.paper) ? P.paper : this.PDefaults.paper,
      };
      this[this.draw](K);
    }

    // ── 図 1: 青い弧と矢印 (地面の円弧) ──
    const nArc = v1 > 0 ? Math.round(8 * arcsK) : 0;
    for(let k = 0; k < nArc; k++){
      const id = 100000 + k, cy2 = this._pool(id, t, 1.4), n = cy2.n, s = cy2.s;
      if(H(id, n, 3) > 0.75) continue;
      const lf = life2(cy2.x, 0.25, 0.70, 0.82);
      if(!lf) continue;
      const ccx = this._camX(s) + (H(id, n, 4) - 0.5) * aspect * 0.95;
      const ccy = this._camY(s) + (H(id, n, 5) - 0.5) * 0.9;
      const rr = (0.06 + 0.10 * H(id, n, 6)) * cfg.spread;
      const a0 = H(id, n, 7) * Math.PI * 2;
      const sw = (0.9 + 1.1 * H(id, n, 8)) * (H(id, n, 9) < 0.5 ? -1 : 1);
      const f = (v)=>[ccx + rr * Math.cos(a0 + sw * v), ccy + rr * Math.sin(a0 + sw * v), 0];
      pushPoly(arcs, f, 24, lf[0], lf[1], hwL, C.blue, 0.9 * v1, false, H(id, n, 20));
      if(lf[1] >= 1 && lf[0] <= 0) pushArrow(arcs, f(1), f(0.97), hwL, C.blue, 0.9 * v1, H(id, n, 21));
    }

    // ── 図 2: 流れる矢印・縦の面と切り抜かれた人・うねる赤線・波の帯 ──
    if(v2 > 0.002){
      // 流れる青い矢印 (右上へ向かう二次曲線。立ち上がると宙に浮く。3 割は破線)
      const nFlow = Math.round(18 * arcsK);
      for(let k = 0; k < nFlow; k++){
        const id = 400000 + k, cy2 = this._pool(id, t, 1.2), n = cy2.n, s = cy2.s;
        if(H(id, n, 3) > 0.8) continue;
        const lf = life2(cy2.x, 0.30, 0.65, 0.80);
        if(!lf) continue;
        const tx = this._camX(s), ty = this._camY(s);
        const [x0, y0] = this._fromYaw((H(id, n, 4) - 0.62) * aspect * 1.2, (H(id, n, 5) - 0.45) * 1.4, tx, ty);
        const th = 0.12 + (H(id, n, 6) - 0.5) * 0.9, L = (0.35 + 0.55 * H(id, n, 7)) * cfg.spread;
        const [dxw, dyw] = this._fromYaw(Math.cos(th) * L, Math.sin(th) * L, 0, 0);
        const x1 = x0 + dxw, y1 = y0 + dyw;
        const bend = (H(id, n, 8) - 0.5) * 0.45, xc = (x0 + x1) / 2 - dyw * bend, yc = (y0 + y1) / 2 + dxw * bend;
        const z0 = rn * (0.05 + 0.30 * H(id, n, 10)), z1 = rn * (0.05 + 0.30 * H(id, n, 11));
        const f = (v)=>{ const a = (1 - v) * (1 - v), b = 2 * (1 - v) * v, c2 = v * v; return [a * x0 + b * xc + c2 * x1, a * y0 + b * yc + c2 * y1, z0 + (z1 - z0) * v]; };
        const dashed = H(id, n, 9) < 0.3;
        pushPoly(arcs, f, dashed ? 30 : 20, lf[0], lf[1], hwL, C.blue, 0.85 * v2, dashed, H(id, n, 20));
        if(lf[1] >= 1 && lf[0] <= 0 && !dashed) pushArrow(arcs, f(1), f(0.96), hwL, C.blue, 0.85 * v2, H(id, n, 21));
      }
      // 縦の面 (下辺を蝶番に、寝た状態から 90° 立ち上がる。面ごとに少しずつずれる) と切り抜かれた人
      const nPlane = Math.round(5 * Math.max(0, dz(P.planes) * 0.01));
      const figK = Math.max(0, Math.min(1, dz(P.figures) * 0.01));
      const FIG = this._figure();
      for(let k = 0; k < nPlane; k++){
        const id = 200000 + k, cy2 = this._pool(id, t, 2.2), n = cy2.n, s = cy2.s;
        if(H(id, n, 3) > 0.8) continue;
        const x = cy2.x;
        if(x > 0.88) continue;
        const g = this._ease(Math.min(1, x / 0.08), cfg.pop);
        const yo = Math.max(0, Math.min(1, (x - 0.82) / 0.06));
        const sc = Math.max(0, g * (1 - yo * yo * (3 - 2 * yo)));
        if(sc <= 0.001) continue;
        const tx = this._camX(s), ty = this._camY(s);
        // 人の面は横長 (幅は高さの 1.3〜1.7 倍)。どれも平行に奥へ約 60° 向けて置くので、斜めから細く見える (図 2)。
        // 面ごとに横の持ち場を決め、画面での横の広がり (幅 × cos) がその中に収まる位置にする (隣の面と重ならない)
        const slot = aspect * 1.15 / nPlane;
        const ja = 1.05 + (H(id, n, 8) - 0.5) * 0.16;          // 下辺の向き (画面の横から奥へ)
        const Hb = (0.42 + 0.22 * H(id, n, 6)) * sizeK;
        const W = Math.min(Hb * (1.3 + 0.4 * H(id, n, 7)), slot * 0.9 / Math.cos(ja)), Hh = Hb * sc;
        const [bx, by] = this._fromYaw(-aspect * 0.575 + k * slot + Math.max(0, slot - W * Math.cos(ja)) * H(id, n, 4), (H(id, n, 5) - 0.75) * 0.7, tx, ty);
        const [ex, ey] = this._fromYaw(Math.cos(ja), Math.sin(ja), 0, 0);   // 下辺の向き (地面)
        const nx0 = -ey, ny0 = ex;                             // 地面で下辺に直交
        // 立ち上がりは面ごとにずれ、少し弾んで (90° を少し越えてから) 立つ
        const th = (Math.PI / 2) * riseK * this._ease(Math.max(0, Math.min(1, (rn - 0.3 * H(id, n, 12)) / 0.7)), 0.5 * cfg.pop);
        const ux = nx0 * Math.cos(th), uy = ny0 * Math.cos(th), uz = Math.sin(th);   // 面の上向き
        const al = 0.85 * v2;
        const at = (sa, ua)=>[bx + ex * sa * W + ux * ua, by + ey * sa * W + uy * ua, uz * ua];
        // 人の輪郭 (面の下辺に立つ切り抜き。下辺は体の幅だけ切れる。4 分の 1 は頭が上辺から出て、上辺も首の幅だけ切れる)
        let gapTop = null, gapBot = null;
        if(H(id, n, 13) < figK){
          // 人の半幅 (肩まで FIG_HALF × 背の高さ) と両端の余白が面に収まるようにする。収まらなければ人を小さくする
          const pad = 0.015 * sizeK;
          const hf = Math.min(Hh * (H(id, n, 14) < 0.25 ? 1.10 + 0.05 * H(id, n, 15) : 0.50 + 0.20 * H(id, n, 15)), Math.max(0, W * 0.5 - pad) / this.FIG_HALF);
          const tall = hf * 0.96 > Hh;                         // 頭が上辺から出る
          const m = (this.FIG_HALF * hf + pad) / Math.max(W, 1e-6);   // 立てる位置の端からの余白 (0..1)
          const s0 = m + Math.max(0, 1 - 2 * m) * H(id, n, 16), iw = hf / Math.max(W, 1e-6);
          const fp = (q)=>at(s0 + q[0] * iw, q[1] * hf);
          for(let m = 0; m + 1 < FIG.length; m++){
            const a3 = fp(FIG[m]), b3 = fp(FIG[m + 1]);
            seg3(figs, a3[0], a3[1], a3[2], b3[0], b3[1], b3[2], hwB, al, C.ink, H(id, n, 17), null);
          }
          gapBot = [s0 - this.FIG_FOOT * iw, s0 + this.FIG_FOOT * iw];
          if(tall){ const hx = this._figHalfAt(Hh / Math.max(hf, 1e-6)) * iw; gapTop = [s0 - hx, s0 + hx]; }
        }
        // 辺 (a→b) を、切れ目 gap (0..1 の区間) を除いて描く (たわみは辺の全体で測る)
        const edge = (ya, sa0, sa1, gp)=>{
          const e0 = at(sa0, ya), e1 = at(sa1, ya), full = [e0[0], e0[1], e0[2], e1[0], e1[1], e1[2]];
          const parts = gp ? [[sa0, Math.max(sa0, gp[0])], [Math.min(sa1, gp[1]), sa1]] : [[sa0, sa1]];
          for(const [u0, u1] of parts){
            if(u1 - u0 < 1e-4) continue;
            const a3 = at(u0, ya), b3 = at(u1, ya);
            seg3(figs, a3[0], a3[1], a3[2], b3[0], b3[1], b3[2], hwB, al, C.ink, H(id, n, ya > 0 ? 23 : 18), full);
          }
        };
        const p0 = at(0, 0), p1 = at(1, 0), p2 = at(1, Hh), p3 = at(0, Hh);
        edge(0, 0, 1, gapBot);
        edge(Hh, 0, 1, gapTop);
        line3(figs, p1, p2, hwB, al, C.ink, H(id, n, 19));
        line3(figs, p3, p0, hwB, al, C.ink, H(id, n, 22));
      }
      // うねる赤い線 (奥から手前の右へ。途中で輪をつくる)
      const nM = Math.round(1.5 * Math.max(0, dz(P.meander) * 0.01));
      for(let k = 0; k < nM; k++){
        const id = 500000 + k, cy2 = this._pool(id, t, 3.0), n = cy2.n, s = cy2.s;
        if(H(id, n, 3) > 0.85) continue;
        const lf = life2(cy2.x, 0.40, 0.78, 0.92);
        if(!lf) continue;
        const tx = this._camX(s), ty = this._camY(s);
        const qx0 = (H(id, n, 4) - 0.6) * aspect * 0.6, qx1 = qx0 + 0.35 + 0.35 * H(id, n, 5);
        const ph2 = H(id, n, 6) * 6.28, lp = 0.45 + 0.25 * H(id, n, 7), lr = 0.025 + 0.02 * H(id, n, 8);
        const dqx = qx1 - qx0, dqy = -1.12, dl = Math.hypot(dqx, dqy), nqx = -dqy / dl, nqy = dqx / dl;
        const f = (v)=>{
          const wv = 0.035 * Math.sin(v * 14 + ph2) + 0.02 * Math.sin(v * 31 + ph2 * 1.7);
          const lv = Math.max(0, Math.min(1, (v - lp) / 0.08));
          const la = lv * Math.PI * 2, lx = lv > 0 && lv < 1 ? lr * Math.sin(la) : 0, ly = lv > 0 && lv < 1 ? lr * (1 - Math.cos(la)) : 0;
          const [wx, wy] = this._fromYaw(qx0 + dqx * v + nqx * wv + lx, 0.56 + dqy * v + nqy * wv + ly, tx, ty);
          return [wx, wy, 0];
        };
        pushPoly(arcs, f, 90, lf[0], lf[1], hwL, C.red, 0.85 * v2, false, H(id, n, 20));
      }
      // 手前の色鉛筆の緑の帯 (地面。いまの向きで画面の下端に横いっぱい。太さが波打つ。中に青い線が 2 本)
      const bandK = Math.max(0, dz(P.band) * 0.01);
      if(bandK > 0){
        const toW = (qx, qy)=>[cx + qx * cps + qy * sps, cy - qx * sps + qy * cps];
        const M = 56, ctr = [], bhw = [];
        for(let j = 0; j <= M; j++){
          const qx = (j / M - 0.5) * (aspect + 1.2);
          const qy = -0.42 - 0.25 * rn + 0.079 + 0.03 * Math.sin(qx * 5 + 2.6 + t * 0.15) + 0.012 * Math.sin(qx * 13 + 7.5);
          const hwq = 0.085 * (1 + 0.22 * Math.sin(qx * 3.1 + 1.3 + t * 0.1));
          const c0 = toW(qx, qy), c1 = toW(qx, qy + hwq);
          const p0 = P3(c0[0], c0[1], 0), p1 = P3(c1[0], c1[1], 0);
          ctr.push(p0); bhw.push(p0 && p1 ? Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) : 0);
        }
        // 区間ごとの帯。継ぎ目は両隣の向きの中間で切る (隣と重ならず、隙間も出ない)
        const dirOf = (a, b)=>{ const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
        const bis = (d0, d1)=>{ const x = d0[0] + d1[0], y = d0[1] + d1[1], l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
        const alB = Math.min(1, 0.95 * bandK) * v2, dS = (aspect + 1.2) / M * 1080;   // 区間の地面での長さ (1080p の px)
        for(let j = 0; j < M && alB > 0.002; j++){
          const a = ctr[j], b = ctr[j + 1];
          if(!a || !b) continue;
          const d = dirOf(a, b);
          const mA = (j > 0 && ctr[j - 1]) ? bis(dirOf(ctr[j - 1], a), d) : d;
          const mB = (j + 2 <= M && ctr[j + 2]) ? bis(d, dirOf(b, ctr[j + 2])) : d;
          inst(back, a[0], a[1], b[0], b[1], 5, j * dS, 0.5 * (bhw[j] + bhw[j + 1]), alB, C.band, mA[0], mA[1], mB[0], mB[1], dS);
        }
        for(const k of [4, 11]){
          const f = (v)=>{
            const qx = (v - 0.5) * (aspect + 1.2);
            const qy = -0.42 - 0.25 * rn + k * 0.0105 + 0.03 * Math.sin(qx * 5 + k * 0.35 + t * 0.15) + 0.012 * Math.sin(qx * 13 + k);
            const wv = toW(qx, qy);
            return [wv[0], wv[1], 0];
          };
          pushPoly(back, f, 64, 0, 1, hwL, C.blue, Math.min(1, 0.7 * bandK) * v2, false, k * 0.05);
        }
      }
    }

    // ── 描く: 紙 → 色鉛筆の帯 → 線 → 弧・流れ・赤線 → 面と人 → 点 → 四角と楕円と菱形 (奥から手前) ──
    const opaque = opts.opaque !== false;
    const paper = Array.isArray(P.paper) ? P.paper : this.PDefaults.paper;
    const bg = [];
    if(opaque) inst(bg, cx, cy, 0, 0, 4, 0, 0, 1, paper, 0, 0, 0, 0);
    fills.sort((a, b)=>(b[0] - a[0]) || (a[1] - b[1]));
    const fl = [];
    for(const f of fills) for(const v of f[2]) fl.push(v);
    const all = bg.concat(back, lines, arcs, figs, dots, fl);
    const count = all.length / 16;
    const data = new Float32Array(all);

    gl.bindFramebuffer(gl.FRAMEBUFFER, opts.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if(count > 0){
      gl.useProgram(this.prog);
      gl.uniform2f(this.U.cam, cx, cy);
      gl.uniform2f(this.U.half, aspect * 0.5, 0.5);
      gl.uniform1f(this.U.px, 1 / Math.max(1, h));
      gl.uniform1f(this.U.pencil, Math.max(0, dz(P.pencil) * 0.01));
      gl.uniform1f(this.U.hand, Math.max(0, dz(P.hand) * 0.01));
      // 描き直しのコマ: 100% で毎秒 8 コマ (beat では 1 拍 2 コマ)
      const boilK = Math.max(0, dz(P.boil) * 0.01);
      const boilN = boilK > 0 ? Math.floor(t * boilK * (beatMode ? 2 : 8 / Math.max(spd, 1e-3))) : 0;
      gl.uniform1f(this.U.boil, boilN * 0.6180339 - Math.floor(boilN * 0.6180339));   // 小数部だけ渡す (長く回しても桁落ちしない)
      gl.uniform3f(this.U.sqFill, C.sqFill[0], C.sqFill[1], C.sqFill[2]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instVBO);
      if(data.byteLength > this.instCap){
        this.instCap = Math.max(data.byteLength, this.instCap * 2, 65536);
        gl.bufferData(gl.ARRAY_BUFFER, this.instCap, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },
};
Rhizome.PDefaults = JSON.parse(JSON.stringify(Rhizome.P));

// 別の図 (扇 / 群れの輪 / 積層) は同じエンジンの別の実体にして、それぞれ独立した mode (kind) にする。
// 描き方は Rhizome と共通で、パラメータ・GL の資源・記憶は実体ごとに持つ (Slot A と B で別の図を同時に出せる)。
// own = その図だけのパラメータ (既定値)、ownSpecs = その UI。共通のパラメータは Rhizome の既定値から写す
Rhizome._variant = function(draw, own, ownSpecs, useNet){
  const base = this;
  const head = ['speed', 'life'].concat(useNet ? ['nodes'] : []), tail = ['size', 'spread', 'links', 'line', 'pencil', 'hand', 'boil', 'pop', 'kick', 'drift', 'rise', 'cycle', 'tilt', 'yaw', 'seed'];
  const P = {};
  for(const k of head.concat(tail, ['paper'])) P[k] = JSON.parse(JSON.stringify(base.PDefaults[k]));
  Object.assign(P, own);
  const spec = (k)=> base.SPECS.find(sp => Array.isArray(sp) && sp[1] === k);
  const v = Object.create(base);
  Object.assign(v, {
    gl:null, initialized:false, ok:false, prog:null, vao:null, cornerVBO:null, instVBO:null, instCap:0, U:null,
    _memo:null, _sig:'', _cfg:null, _salt:0, FIG:null,
    draw, useNet:!!useNet, P, SPECS:head.map(spec).concat(ownSpecs, tail.map(spec)),
  });
  v.PDefaults = JSON.parse(JSON.stringify(P));
  return v;
};
const RhizomeFan = Rhizome._variant('_fan', {curves:100, fans:5, open:100, swirl:100, seeds:25}, [
  ['Curves', 'curves', 0,  300, 1, 'pct'],   // 扇 1 つの線の数 (%)
  ['Fans',   'fans',   1,  10,  1, 'int'],   // 同時に出る扇の枠の数
  ['Open',   'open',   10, 300, 1, 'pct'],   // 扇の開き (%)
  ['Swirl',  'swirl',  0,  300, 1, 'pct'],   // 線の巻き (%)
  ['Seeds',  'seeds',  0,  100, 1, 'pct'],   // 先が黒い種になる割合 (%)
]);
const RhizomePacks = Rhizome._variant('_packs', {rings:6, members:100, hub:100, float:35}, [
  ['Rings',   'rings',   1,  12,  1, 'int'],   // 同時に出る輪の枠の数
  ['Members', 'members', 10, 300, 1, 'pct'],   // 輪 1 つの楕円の数 (%)
  ['Hub',     'hub',     0,  300, 1, 'pct'],   // 宙の一点の高さ (%)
  ['Float',   'float',   0,  100, 1, 'pct'],   // 宙に浮く輪の割合 (%)
]);
const RhizomeStack = Rhizome._variant('_stack', {nodes:90, columns:3, layers:18, height:100, axes:15, arrows:100}, [
  ['Columns', 'columns', 0,  8,   1, 'int'],   // 同時に立つ柱の枠の数
  ['Layers',  'layers',  3,  40,  1, 'int'],   // 柱 1 本に積み重なる楕円の数
  ['Height',  'height',  20, 300, 1, 'pct'],   // 柱と青い軸の高さ (%)
  ['Axes',    'axes',    0,  100, 1, 'pct'],   // 網の楕円を青い縦の両矢印が貫く割合 (%)
  ['Arrows',  'arrows',  0,  300, 1, 'pct'],   // 網の楕円から伸びる矢印の付いた線の量 (%)
], true);
const RhizomeKinds = { rhizome:Rhizome, rzfan:RhizomeFan, rzpacks:RhizomePacks, rzstack:RhizomeStack };
