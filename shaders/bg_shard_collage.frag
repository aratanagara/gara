// =====================================================
// bg_shard_collage — Shard Collage
//   切り抜いた紙やガラスの破片を何十枚も重ねた、密集したコラージュ。
//   破片は直線の縁だけの凸多角形 (細長い刃 / 三角 / 歪んだ四角)。
//   大・中・小の 3 層のジッターグリッドに 1 枚ずつ置き、画素ごとに
//   近傍 3×3 の升だけを見る (最大 27 枚)。重なり順は破片ごとの優先度で、
//   小さい切れ端ほど上に乗りやすい。
//   柄: うねるゼブラ / 等高線 / 放射・パースの縞 / 粒の粗いグラデ /
//       インクのにじみ / 平塗りのビビッド / グリッチのモアレ / 紙
//   uGap を上げると破片の縁に地色の細い縁が出て、紙を切って貼った見え方になる (既定 0 = 枠線なし)。
//   縁はノイズを乗せないソリッドな地色で、100 で 1080p の 2px ほど。
//   動き: 破片ごとにゆっくり漂い、回る。長辺・短辺が呼吸し、角がずれ、剪断が揺れる (uMorph)。
//   頂点が動くだけなので辺は曲がらない。拍 (getBeat) と音 (iAudio) で漂いが少し大きくなる。
//   再生成: uRegen 拍ごと (拍が無ければ uRegen 秒ごと) に配置と柄を作り直す。
//   切り替えは入れ替わり: 古い破片が順に一度ふくらんでから縮んで消え、新しい破片が pop で出る。0 で固定。
//   構図: 三分割の焦点 2 つに主役の大きな破片を主方向で置く (画面の外へ切れる)。
//   傾きは世代ごとの主方向 / 副方向にそろえる (uAlign)。焦点の近くほど密に大きく、離れるほど抜ける (uCluster)。
//   色は世代ごとの主色 55% / 差し色 25% / その他 20%。
//   地色 (uGround = 4): 世代ごとに選んだ色へ、再生成の間隔いっぱいをかけてなめらかに移り、
//   ちょうど切り替えの瞬間に次の色へ着く。再生成が無ければ 16 秒ごとに巡る。急には変わらない。
//   世代ごとの揺らぎ (uVary): 大きさ・密度・隙間の幅・動きの量が世代ごとに変わり、
//   大きさはその間も呼吸し、約 16 秒周期で 0.5 倍〜1.9 倍ほど大きく寄ったり引いたりする。uGround = 4 で地色も世代ごとに選び直す。
//   参照したのは Juan Rodríguez García (@_juanrg92) の 2026-10-21 の
//   p5.js 作品の雰囲気。配置と柄はシードから手続き生成していて、トレースではない。
//   bgZoom / bgCamPx でズームとパン。
// =====================================================

// @param uSpeed   0..300  = 60.0
// @param uDrift   0..200  = 60.0
// @param uTurn    0..200  = 40.0
// @param uMorph   0..200  = 100.0
// @param uRegen   0..32   = 8.0
// @param uVary    0..200  = 100.0
// @param uAlign   0..100  = 85.0
// @param uCluster 0..100  = 70.0
// @param uDensity 20..100 = 78.0
// @param uScale   40..200 = 100.0
// @param uGap     0..200  = 0.0
// @param uGrain   0..200  = 100.0
// @param uGround  0..4    = 0.0
// @param uSeed    0..100  = 0.0
// @param uKick    0..200  = 45.0
uniform float uSpeed;   // 破片が漂う速さ (%)
uniform float uDrift;   // 位置の漂いの量 (%)。0 で位置が止まる
uniform float uTurn;    // 回転の量 (%)。0 で向きが止まる
uniform float uMorph;   // 伸び縮み・角のずれ・剪断の揺れの量 (%)。0 で形が止まる
uniform float uRegen;   // 配置を作り直す間隔 (拍。拍が無ければ秒)。0 で固定
uniform float uVary;    // 世代ごとに大きさ・密度・隙間・動きが変わる量 (%)。0 でスライダーの値のまま
uniform float uAlign;   // 傾きを世代ごとの主方向 (と副方向) にそろえる強さ (%)。0 でばらばら
uniform float uCluster; // 密集の偏り (%)。焦点の近くほど密に大きく、離れるほど抜ける。0 で一様
uniform float uDensity; // 升ごとに破片が置かれる割合 (%)
uniform float uScale;   // 破片と升の大きさ (%)
uniform float uGap;     // 縁に出るソリッドな地色の幅 (%)。既定 0 で枠線なし。100 で 1080p の 2px ほど
uniform float uGrain;   // 紙の目・粒 (%)
uniform float uGround;  // 地色 0=cream / 1=cerulean / 2=crimson / 3=deep green / 4=世代ごとに選び、なめらかに移る
uniform float uSeed;    // 配置と柄のシード
uniform float uKick;    // 拍 / 音で漂いが増える量 (%)

// ─── 乱数 / ノイズ ────────────────────────────────────────
float sc_h1(float n){
  n = fract(n * 0.1031);
  n *= n + 33.33;
  n *= n + n;
  return fract(n);
}
float sc_h2(vec2 p){
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float sc_vn(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = sc_h2(i);
  float b = sc_h2(i + vec2(1.0, 0.0));
  float c = sc_h2(i + vec2(0.0, 1.0));
  float d = sc_h2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float sc_fbm(vec2 p){
  const mat2 R = mat2(0.80, 0.60, -0.60, 0.80);
  float a = 0.5, s = 0.0, n = 0.0;
  for(int i = 0; i < 3; i++){
    s += a * sc_vn(p);
    n += a;
    p = R * p * 2.05 + 4.2;
    a *= 0.5;
  }
  return s / max(n, 1e-4);
}
vec2 sc_rot(vec2 p, float a){
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}
// 辺 a→b の左側が正の符号付き距離。頂点を反時計回りに並べると内側が正になる
float sc_edge(vec2 p, vec2 a, vec2 b){
  vec2 e = b - a;
  return (e.x * (p.y - a.y) - e.y * (p.x - a.x)) / max(length(e), 1e-4);
}

// ─── 色 ───────────────────────────────────────────────────
// 世代ごとの主色と差し色 (sc_accent の h)。bg_shard_collage の先頭で世代ごとに決める
float sc_palMain = 0.0;
float sc_palAcc = 0.5;
vec3 sc_ground(int g){
  if(g == 1) return vec3(0.090, 0.455, 0.620); // cerulean
  if(g == 2) return vec3(0.700, 0.075, 0.300); // crimson
  if(g == 3) return vec3(0.075, 0.245, 0.170); // deep green
  return vec3(0.975, 0.945, 0.880);            // cream
}
vec3 sc_accent(float h){
  int i = int(floor(fract(h) * 10.0));
  if(i == 0) return vec3(0.05, 0.74, 0.95);  // cyan
  if(i == 1) return vec3(0.98, 0.10, 0.50);  // hot pink
  if(i == 2) return vec3(0.62, 0.95, 0.16);  // lime
  if(i == 3) return vec3(0.99, 0.84, 0.08);  // yellow
  if(i == 4) return vec3(0.12, 0.22, 0.86);  // deep blue
  if(i == 5) return vec3(0.97, 0.42, 0.06);  // orange
  if(i == 6) return vec3(0.82, 0.08, 0.14);  // red
  if(i == 7) return vec3(0.46, 0.16, 0.68);  // purple
  if(i == 8) return vec3(0.93, 0.93, 0.88);  // white
  return vec3(0.06, 0.05, 0.06);             // black
}
// 色の比率: 主色 55% / 差し色 25% / その他 20%
vec3 sc_pal(float r, float h){
  if(r < 0.55) return sc_accent(sc_palMain);
  if(r < 0.80) return sc_accent(sc_palAcc);
  return sc_accent(h);
}
vec3 sc_earth(float h){
  int i = int(floor(fract(h) * 6.0));
  if(i == 0) return vec3(0.55, 0.40, 0.26);  // tan
  if(i == 1) return vec3(0.40, 0.24, 0.14);  // brown
  if(i == 2) return vec3(0.68, 0.62, 0.54);  // warm gray
  if(i == 3) return vec3(0.33, 0.36, 0.20);  // olive
  if(i == 4) return vec3(0.74, 0.58, 0.40);  // sand
  return vec3(0.22, 0.16, 0.14);             // dark earth
}

// 帯の座標 s を 2 色または 3 色の硬い縞にする
vec3 sc_bands(float s, vec3 c0, vec3 c1, vec3 c2, float triple){
  float w = max(fwidth(s) * 1.25, 0.002);
  float f = fract(s);
  if(triple < 0.5){
    float m = smoothstep(0.5 - w, 0.5 + w, f);
    return mix(c0, c1, m);
  }
  float a = 1.0 - smoothstep(0.333 - w, 0.333 + w, f);
  float b = smoothstep(0.333 - w, 0.333 + w, f) * (1.0 - smoothstep(0.666 - w, 0.666 + w, f));
  float c = smoothstep(0.666 - w, 0.666 + w, f);
  float ns = max(a + b + c, 1e-3);
  return (c0 * a + c1 * b + c2 * c) / ns;
}

// 柄。lp は破片の中心を原点にした画面単位の座標、idf は破片ごとのシード、px は画素座標
vec3 sc_tex(int typ, vec2 lp, float idf, vec2 px, float grain){
  float h0 = sc_h1(idf * 1.17 + 2.0);
  float h1 = sc_h1(idf * 2.31 + 4.0);
  float h2 = sc_h1(idf * 3.71 + 6.0);
  float h3 = sc_h1(idf * 5.13 + 8.0);
  float h4 = sc_h1(idf * 7.19 + 1.0);
  vec3 black = vec3(0.045, 0.040, 0.042);
  vec3 white = vec3(0.94, 0.93, 0.89);
  float grit = (sc_h2(px + idf) - 0.5) * grain;

  if(typ == 0){
    // うねるゼブラ。半分は黒 / 色 / 白の 3 色。間隔も波打つ
    vec2 axis = h0 < 0.34 ? vec2(1.0, 0.12) : (h0 < 0.67 ? vec2(0.10, 1.0) : vec2(0.78, 0.62));
    vec2 nax = normalize(axis);
    vec2 alx = vec2(-nax.y, nax.x);
    float coord = dot(lp, nax);
    float along = dot(lp, alx);
    float freq = mix(22.0, 56.0, h1);
    float warp = sin(along * mix(1.5, 4.8, h2) + h3 * TAU) * mix(0.10, 0.34, h4);
    warp += sin(along * mix(5.5, 12.0, h0) + coord * 0.7) * mix(0.03, 0.09, h1);
    float s = (coord + warp) * freq;
    s += sin(along * 1.15 + h2 * 5.0) * mix(0.5, 1.8, h3);
    s += (sc_vn(vec2(s * 0.15, idf * 0.3)) - 0.5) * 0.55;
    vec3 acc = sc_pal(sc_h1(idf * 9.1 + h2 * 0.17), fract(idf * 0.618034 + h2 * 0.17));
    float triple = step(0.40, h3);
    vec3 c = sc_bands(s, black, triple > 0.5 ? white : acc, acc, triple);
    return c * (1.0 + grit * 0.06);
  }

  if(typ == 1){
    // 等高線 / 指紋。細い波線を密に、うねりを大きく
    float freq = mix(40.0, 90.0, h1);
    vec2 axis = normalize(h0 < 0.5 ? vec2(0.18, 1.0) : vec2(1.0, 0.16));
    float along = dot(lp, vec2(-axis.y, axis.x));
    float across = dot(lp, axis);
    float warp = sin(along * mix(1.6, 4.2, h2) + h3 * TAU) * mix(0.55, 1.45, h4);
    warp += sin(along * mix(4.5, 9.0, h0) - across * 0.35) * 0.28;
    float s = across * freq + warp * mix(10.0, 22.0, h1);
    float dist = abs(fract(s + 0.5) - 0.5);
    float lw = mix(0.022, 0.055, h2);
    float line = 1.0 - smoothstep(lw, lw + max(fwidth(s), 0.0025), dist);
    float s2 = s * mix(1.8, 2.6, h0) + along * 3.0;
    float dist2 = abs(fract(s2 + 0.5) - 0.5);
    float line2 = 1.0 - smoothstep(0.018, 0.045, dist2);
    vec3 field, ink;
    int pal = int(floor(fract(idf * 0.41 + h4 * 0.23) * 6.0));
    if(pal == 0){ field = vec3(0.80, 0.64, 0.34); ink = vec3(0.20, 0.09, 0.04); }
    else if(pal == 1){ field = vec3(0.34, 0.07, 0.50); ink = vec3(0.82, 0.60, 0.24); }
    else if(pal == 2){ field = vec3(0.05, 0.045, 0.06); ink = vec3(0.93, 0.91, 0.86); }
    else if(pal == 3){ field = vec3(0.07, 0.15, 0.40); ink = vec3(0.40, 0.86, 0.95); }
    else if(pal == 4){ field = vec3(0.10, 0.30, 0.28); ink = black; }
    else { field = vec3(0.91, 0.87, 0.76); ink = vec3(0.09, 0.07, 0.06); }
    vec3 c = mix(field, ink, clamp(line + line2 * 0.45, 0.0, 1.0));
    c *= 0.93 + 0.12 * sc_vn(lp * vec2(48.0, 18.0) + idf);
    return c * (1.0 + grit * 0.05);
  }

  if(typ == 2){
    // 放射、または一点へ収束するパース縞
    vec2 foc = (vec2(h0, h1) - 0.5) * 0.85;
    vec3 acc = sc_pal(sc_h1(idf * 9.1 + 0.31 + h2 * 0.1), fract(idf * 0.618034 + 0.31 + h2 * 0.1));
    float triple = step(0.38, h3);
    float s;
    if(h4 > 0.45){
      vec2 d = lp - foc;
      float ang = atan(d.y, d.x);
      float r = length(d);
      s = ang * mix(9.0, 24.0, h1) / PI;
      s += sin(r * mix(8.0, 24.0, h0) + h2 * TAU) * 0.22;
    } else {
      float denom = 0.10 + abs(lp.y - foc.y);
      s = (lp.x - foc.x) / denom * mix(2.4, 7.5, h1);
      s += sin(lp.y * mix(6.0, 16.0, h0)) * 0.18;
    }
    s += (sc_vn(vec2(floor(s) * 0.17, idf)) - 0.5) * 0.35;
    return sc_bands(s, black, triple > 0.5 ? white : acc, acc, triple) * (1.0 + grit * 0.05);
  }

  if(typ == 3){
    // インク / 水彩。2〜3 色がにじみ、ところどころ紙が残る
    vec3 A, B, C, W;
    int pal = int(floor(fract(idf * 0.37 + h0 * 0.2) * 5.0));
    if(pal == 0){ A = vec3(0.93, 0.40, 0.52); B = vec3(0.98, 0.78, 0.22); C = vec3(0.55, 0.18, 0.62); W = white; }
    else if(pal == 1){ A = vec3(0.15, 0.78, 0.86); B = vec3(0.30, 0.88, 0.38); C = vec3(0.10, 0.28, 0.70); W = vec3(0.92, 0.96, 0.94); }
    else if(pal == 2){ A = vec3(0.95, 0.42, 0.10); B = vec3(0.75, 0.10, 0.14); C = vec3(0.95, 0.82, 0.55); W = vec3(0.96, 0.90, 0.82); }
    else if(pal == 3){ A = vec3(0.20, 0.32, 0.82); B = vec3(0.62, 0.22, 0.70); C = vec3(0.95, 0.45, 0.55); W = white; }
    else { A = vec3(0.45, 0.48, 0.22); B = vec3(0.78, 0.58, 0.30); C = vec3(0.25, 0.18, 0.12); W = vec3(0.93, 0.88, 0.76); }
    vec2 q = lp * mix(1.5, 3.1, h1);
    float n1 = sc_fbm(q + idf);
    float n2 = sc_fbm(q * 1.45 + 5.0 + n1 * 1.1);
    float n3 = sc_vn(q * 3.1 + 11.0);
    vec3 c = mix(A, B, smoothstep(0.36, 0.64, n1));
    c = mix(c, C, smoothstep(0.52, 0.78, n2));
    c = mix(c, W, smoothstep(0.58, 0.88, n3) * 0.85);
    float dripX = (h2 - 0.5) * 0.55;
    float drip = smoothstep(0.07 + 0.04 * h3, 0.0, abs(lp.x - dripX));
    drip *= smoothstep(0.25, -0.65, lp.y);
    c = mix(c, C * vec3(0.85, 0.80, 0.78), drip * h4 * 0.85);
    c *= 0.92 + 0.16 * sc_vn(lp * vec2(55.0, 28.0) + idf);
    return c * (1.0 + grit * 0.08);
  }

  if(typ == 4){
    // 紙、または砂。目が読める粒と、片側へ色がにじむ
    vec3 base;
    int pk = int(floor(h0 * 4.0));
    if(pk == 0) base = vec3(0.78, 0.73, 0.64);
    else if(pk == 1) base = vec3(0.70, 0.60, 0.46);
    else if(pk == 2) base = vec3(0.60, 0.58, 0.56);
    else base = vec3(0.82, 0.74, 0.56);
    vec3 wash = sc_pal(sc_h1(idf * 9.1 + 0.47), fract(idf * 0.618034 + 0.47));
    if(h2 > 0.58){
      float dune = sc_vn(lp * vec2(mix(7.0, 16.0, h3), mix(20.0, 46.0, h4)));
      float spec = sc_vn(lp * vec2(55.0, 90.0) + idf);
      base = mix(base * 0.72, base * 1.18, dune);
      base *= 0.84 + 0.32 * spec;
    } else {
      float blot = sc_fbm(lp * 3.4 + idf * 0.2);
      float fiber = sc_vn(lp * vec2(110.0, 26.0));
      float fiber2 = sc_vn(lp * vec2(220.0, 9.0));
      base *= 0.92 + 0.14 * blot;
      base += (fiber - 0.5) * 0.14 + (fiber2 - 0.5) * 0.07;
    }
    vec2 dir = vec2(cos(h3 * TAU), sin(h3 * TAU));
    float washAmt = smoothstep(-0.02, 0.48, dot(lp, dir));
    base = mix(base, mix(base, wash, 0.55), washAmt * mix(0.18, 0.5, h4));
    return base * (1.0 + grit * 0.14);
  }

  if(typ == 6){
    // 縦のモアレと、たまにずれる走査線
    float rows = mix(16.0, 48.0, h0);
    float row = floor(lp.y * rows + h1 * 3.0);
    float gate = step(0.74, sc_h1(row * 1.31 + idf));
    float shift = (sc_h1(row + idf * 2.0) - 0.5) * gate;
    float x = lp.x + shift * mix(0.10, 0.32, h2);
    float f1 = mix(36.0, 90.0, h3);
    float s1 = sin(x * f1);
    float s2 = sin(x * f1 * mix(1.05, 1.22, h4) + lp.y * 3.0);
    float m = s1 * s2;
    vec3 acc = sc_pal(sc_h1(idf * 9.1 + 0.55), fract(idf * 0.618034 + 0.55));
    vec3 acc2 = sc_pal(sc_h1(idf * 9.1 + 0.82), fract(idf * 0.618034 + 0.82));
    vec3 c = mix(black, acc, smoothstep(-0.2, 0.45, m));
    float colId = floor(x * mix(18.0, 40.0, h2));
    float streak = step(0.955, sc_h1(colId + idf * 1.7));
    c = mix(c, white, streak);
    float rowHit = step(0.92, sc_h1(row * 2.7 + idf));
    c = mix(c, acc2, rowHit * 0.75);
    return c * (1.0 + grit * 0.04);
  }

  if(typ == 7){
    // 粒の粗いグラデ。2〜3 色が斜めに移り、ところどころ下へ垂れる
    vec3 A = sc_pal(sc_h1(idf * 9.1 + 0.11), fract(idf * 0.618034 + 0.11));
    vec3 B = h3 > 0.30 ? sc_pal(sc_h1(idf * 9.1 + 0.43), fract(idf * 0.618034 + 0.43)) : sc_earth(fract(idf * 0.29 + h1));
    vec3 C = h2 > 0.5 ? sc_pal(sc_h1(idf * 9.1 + 0.77), fract(idf * 0.618034 + 0.77)) : white;
    vec2 dir = vec2(cos(h0 * TAU), sin(h0 * TAU));
    float t = dot(lp, dir) * mix(1.4, 3.2, h1) + 0.5;
    t += (sc_fbm(lp * 3.6 + idf) - 0.5) * 0.6;
    vec3 c = mix(A, B, smoothstep(-0.1, 0.9, t));
    c = mix(c, C, smoothstep(0.65, 1.45, t + (h4 - 0.5) * 0.5));
    // 画素 2 つ分の粗い粒
    float g = sc_h2(floor(px * 0.5) + idf * 3.0);
    c *= 0.74 + 0.52 * g;
    float colf = lp.x * mix(16.0, 34.0, h4) + idf;
    float colId = floor(colf);
    float dripOn = step(0.86, sc_h1(colId * 1.7 + idf));
    float top = (sc_h1(colId * 2.3 + idf) - 0.5) * 0.5;
    float len = mix(0.05, 0.30, sc_h1(colId * 3.9 + idf));
    float dx = abs(fract(colf) - 0.5);
    float drip = dripOn * step(dx, 0.08) * step(lp.y, top) * step(top - len, lp.y);
    c = mix(c, c * 0.55, drip * 0.9);
    return c * (1.0 + grit * 0.06);
  }

  // 平塗り。一部は端が裂けて下の黒や別色が見える
  vec3 col = h0 < 0.86 ? sc_pal(sc_h1(idf * 9.1 + 0.07), fract(idf * 0.618034 + 0.07)) : sc_earth(fract(idf * 0.37 + h2));
  float tearN = sc_vn(lp * mix(2.2, 4.5, h3) + idf);
  float hole = smoothstep(0.58, 0.78, tearN) * smoothstep(0.15, 0.75, h0 < 0.5 ? lp.x : lp.y);
  vec3 holeC = h4 > 0.5 ? black : sc_accent(h3 + 0.5);
  col = mix(col, holeC, hole * step(0.55, h2));
  col *= 0.96 + 0.08 * sc_vn(lp * 18.0 + idf) + grit * 0.05;
  return col;
}

// 柄の選び方。大きい面は広い柄 (グラデ・等高線・にじみ) を多めに、小さい切れ端は平塗りと縞を多めに
int sc_pick(float r, float lay){
  if(lay < 0.5){
    if(r < 0.14) return 5;
    if(r < 0.32) return 0;
    if(r < 0.44) return 2;
    if(r < 0.64) return 7;
    if(r < 0.78) return 1;
    if(r < 0.90) return 3;
    if(r < 0.96) return 6;
    return 4;
  }
  if(r < 0.34) return 5;
  if(r < 0.52) return 0;
  if(r < 0.63) return 2;
  if(r < 0.76) return 7;
  if(r < 0.85) return 1;
  if(r < 0.90) return 3;
  if(r < 0.96) return 6;
  return 4;
}

// ─── 出入り ────────────────────────────────────────────────
// 0→1 で少し行き過ぎてから収まる (easeOutBack)
float sc_pop(float s){
  float x = clamp(s, 0.0, 1.0) - 1.0;
  return 1.0 + 2.70158 * x * x * x + 1.70158 * x * x;
}
// 世代の切り替え。old は一度ふくらんでから縮んで消え、新は pop で出る。
// phase は切り替えの進み、delay は破片ごとの遅れ。戻り値は大きさの倍率
float sc_swap(float phase, float delay, bool old){
  float s = smoothstep(0.0, 1.0, phase - delay);
  if(old){
    float r = 1.0 - s * s;
    return r * (1.0 + 0.18 * sin(min(s * 3.0, 1.0) * PI));
  }
  return sc_pop(s);
}

// 破片の多角形を組み、符号付き距離を返す (内側が正)
float sc_poly(vec2 p, vec2 ctr, float ang, float hl2, float hw2, float tri,
              float hx, float hy, float ha, float hp, float hl, float hj, float hw,
              float w0, float w1, float w2, float shearW){
  vec2 v0, v1, v2, v3;
  if(tri > 0.5){
    float k0 = mix(0.6, 1.2, hj);
    float k1 = mix(0.6, 1.2, hx);
    float apexX = (mix(-0.7, 0.7, hy) + w0 * 2.0) * hl2;
    float apexY = min(hw2 * mix(1.2, 2.4, hl), hl2 * 0.9);
    v0 = vec2(-hl2, -hw2 * k0);
    v1 = vec2( hl2, -hw2 * k1);
    v2 = vec2(apexX, apexY);
    v3 = v2;
  } else {
    float shear = (hj - 0.5) * mix(0.3, 1.4, hw) + shearW;
    v0 = vec2(-hl2 * (mix(0.75, 1.0, hx) + w0), -hw2 * (mix(0.6, 1.0, hy) + w1));
    v1 = vec2( hl2 * (mix(0.75, 1.0, hy) + w2), -hw2 * (mix(0.6, 1.0, ha) + w0));
    v2 = vec2( hl2 * (mix(0.75, 1.0, hp) + w1), hw2 * (mix(0.6, 1.0, hx) + w2));
    v3 = vec2(-hl2 * (mix(0.75, 1.0, hl) + w2), hw2 * (mix(0.6, 1.0, hp) + w1));
    v0.x += shear * v0.y; v1.x += shear * v1.y; v2.x += shear * v2.y; v3.x += shear * v3.y;
  }
  v0 = sc_rot(v0, ang) + ctr;
  v1 = sc_rot(v1, ang) + ctr;
  v2 = sc_rot(v2, ang) + ctr;
  v3 = sc_rot(v3, ang) + ctr;
  if(tri > 0.5){
    return min(sc_edge(p, v0, v1), min(sc_edge(p, v1, v2), sc_edge(p, v2, v0)));
  }
  return min(min(sc_edge(p, v0, v1), sc_edge(p, v1, v2)), min(sc_edge(p, v2, v3), sc_edge(p, v3, v0)));
}

// 構図: 傾きは世代ごとの主方向 thA (7 割) か副方向 thB (3 割) に、小さなずれを足してそろえる
float sc_tilt(float ha, float hs, float thA, float thB, float align){
  float free = ha * TAU;
  float on = (ha < 0.72 ? thA : thB) + (hs - 0.5) * 0.25;
  return mix(free, on, align);
}

// 層 lay の升 cell に置かれた破片。sd は内側が正の符号付き距離 (置かれていなければ -1)
// 構図: focus の近くほど密に大きく、離れるほど間引かれて小さい (cluster)
void sc_shard(float lay, vec2 cell, float cs, vec2 p, float T, float seed, float dens, float drift, float turn,
              float morph, float phase, bool old, float thA, float thB, float align, vec2 focus, float cluster,
              out float sd, out vec2 ctr, out float ang, out float idf, out int typ, out float prio){
  sd = -1.0; ctr = vec2(0.0); ang = 0.0; idf = 0.0; typ = 5; prio = -1.0;
  vec2 key = cell * 1.0 + vec2(lay * 37.0 + 5.0, seed * 0.731 + lay * 11.0);
  vec2 ctr0 = (cell + 0.5) * cs;
  float near = smoothstep(1.35, 0.25, length(ctr0 - focus));
  float w = mix(1.0, near, cluster);
  float he = sc_h2(key + 8.0);
  if(he > dens * mix(0.30, 1.0, w)) return;
  idf = sc_h2(key + 11.0) * 97.0 + lay * 3.0 + seed * 0.01;
  float hx = sc_h2(key + 1.0);
  float hy = sc_h2(key + 2.0);
  float ha = sc_h2(key + 3.0);
  float hl = sc_h2(key + 4.0);
  float hw = sc_h2(key + 5.0);
  float hs = sc_h2(key + 6.0);
  float hp = sc_h2(key + 7.0);
  float hj = sc_h2(key + 9.0);
  typ = sc_pick(sc_h2(key + 10.0), lay);
  prio = hp * 0.70 + lay * 0.45;

  // 出入り。小さすぎる破片は置かない (辺が潰れて升ごと塗られるのを防ぐ)
  float sw = sc_swap(phase, hp * 0.8, old);
  if(sw < 0.04) return;

  ctr = ctr0 + (vec2(hx, hy) - 0.5) * 0.30 * cs;
  float ph = idf * 0.37;
  ctr += drift * cs * 0.10 * vec2(sin(T * 0.21 + ph), cos(T * 0.17 + ph * 1.7));
  ang = sc_tilt(ha, hs, thA, thB, align) + turn * 0.10 * sin(T * 0.07 + ph);

  float hl2 = cs * (lay < 0.5 ? mix(0.62, 0.95, hl) : mix(0.50, 0.92, hl)) * mix(0.72, 1.0, w);
  float mph = idf * 2.3;
  hl2 *= 1.0 + morph * 0.22 * sin(T * 0.90 + mph);
  float hw2 = hl2 * (lay < 0.5 ? mix(0.15, 0.75, hw) : mix(0.12, 0.75, hw * hw));
  hw2 *= 1.0 + morph * 0.30 * sin(T * 0.70 + mph * 1.7 + 1.3);
  hl2 *= sw;
  hw2 *= sw;
  float reach = length(vec2(hl2, hw2));
  if(reach > cs * 1.18){
    float k = cs * 1.18 / reach;
    hl2 *= k;
    hw2 *= k;
  }
  float wob = morph * 0.12;
  float w0 = sin(T * 0.63 + mph) * wob;
  float w1 = sin(T * 0.57 + mph * 1.3 + 2.0) * wob;
  float w2 = sin(T * 0.51 + mph * 0.7 + 4.0) * wob;
  float shearW = morph * 0.25 * sin(T * 0.45 + mph * 0.9);
  float tri = step(hs, 0.38);
  sd = sc_poly(p, ctr, ang, hl2, hw2, tri, hx, hy, ha, hp, hl, hj, hw, w0, w1, w2, shearW);
}

// 主役の大きな破片。三分割の焦点 (世代ごとに 2 つ選ぶ) に主方向で置き、画面の外へ切れるほど長い
void sc_hero(int k, vec2 p, float T, float seed, float scl, float drift, float morph,
             float phase, bool old, float thA, float focusBias,
             out float sd, out vec2 ctr, out float ang, out float idf, out int typ, out float prio){
  sd = -1.0; ctr = vec2(0.0); ang = 0.0; idf = 0.0; typ = 7; prio = -1.0;
  float fk = float(k);
  float sel0 = floor(sc_h1(seed * 3.1 + 21.0) * 3.999);
  float sel1 = mod(sel0 + 1.0 + floor(sc_h1(seed * 3.1 + 22.0) * 2.999), 4.0);
  float sel = k == 0 ? sel0 : sel1;
  float aspect = resolution.x / max(resolution.y, 1.0);
  vec2 pt = vec2(sel < 2.0 ? -aspect / 6.0 : aspect / 6.0, mod(sel, 2.0) < 1.0 ? -1.0 / 6.0 : 1.0 / 6.0);
  float hx = sc_h1(seed * 3.1 + 23.0 + fk * 7.0);
  float hy = sc_h1(seed * 3.1 + 24.0 + fk * 7.0);
  float hl = sc_h1(seed * 3.1 + 25.0 + fk * 7.0);
  float hw = sc_h1(seed * 3.1 + 26.0 + fk * 7.0);
  float hp = sc_h1(seed * 3.1 + 27.0 + fk * 7.0);
  float hj = sc_h1(seed * 3.1 + 28.0 + fk * 7.0);
  float hs = sc_h1(seed * 3.1 + 29.0 + fk * 7.0);
  idf = 200.0 + fk * 17.0 + seed * 0.01;
  typ = sc_pick(sc_h1(seed * 3.1 + 30.0 + fk * 7.0), 0.0);
  prio = 0.35 + hp * 0.45;
  float sw = sc_swap(phase, 0.15 * fk, old);
  if(sw < 0.04) return;
  ctr = pt + (vec2(hx, hy) - 0.5) * 0.16 * focusBias;
  float ph = idf * 0.37;
  ctr += drift * 0.06 * vec2(sin(T * 0.19 + ph), cos(T * 0.15 + ph * 1.7));
  ang = thA + (fk == 0.0 ? 0.0 : (hs - 0.5) * 0.5) + morph * 0.05 * sin(T * 0.11 + ph);
  float hl2 = mix(0.62, 0.95, hl) * scl;
  float hw2 = hl2 * mix(0.16, 0.42, hw);
  float mph = idf * 2.3;
  hl2 *= (1.0 + morph * 0.15 * sin(T * 0.50 + mph)) * sw;
  hw2 *= (1.0 + morph * 0.20 * sin(T * 0.40 + mph * 1.7 + 1.3)) * sw;
  float wob = morph * 0.08;
  float w0 = sin(T * 0.43 + mph) * wob;
  float w1 = sin(T * 0.37 + mph * 1.3 + 2.0) * wob;
  float w2 = sin(T * 0.31 + mph * 0.7 + 4.0) * wob;
  sd = sc_poly(p, ctr, ang, hl2, hw2, 0.0, hx, hy, hs, hp, hl, hj, hw, w0, w1, w2, morph * 0.15 * sin(T * 0.3 + mph));
}

// 世代ごとに決まる値 (大きさ・密度・地色・主方向・焦点・色)
void sc_gen(float seedG, float T, float vary, float scl0, float dens0,
            out float scl, out float dens, out float thA, out float thB, out vec2 focus,
            out float palMain, out float palAcc, out float gapK, out float moveK){
  float g0 = sc_h1(seedG * 7.7 + 1.0);
  float g1 = sc_h1(seedG * 7.7 + 2.0);
  float g2 = sc_h1(seedG * 7.7 + 3.0);
  float g3 = sc_h1(seedG * 7.7 + 4.0);
  float g5 = sc_h1(seedG * 7.7 + 6.0);
  float g6 = sc_h1(seedG * 7.7 + 7.0);
  float g7 = sc_h1(seedG * 7.7 + 8.0);
  float g8 = sc_h1(seedG * 7.7 + 9.0);
  scl = scl0 * mix(1.0, mix(0.65, 1.55, g0), vary);
  // 呼吸: 大きく寄って引く。uSpeed 60 で約 16 秒周期の波に約 7 秒周期の波を重ね、
  // 指数で掛けて寄りと引きを対称にする (約 0.5 倍〜1.9 倍)
  scl *= exp(vary * (0.50 * sin(T * 0.65 + g0 * TAU) + 0.15 * sin(T * 1.57 + g1 * TAU)));
  dens = mix(dens0, mix(0.55, 1.0, g1), vary);
  gapK = mix(1.0, mix(0.4, 2.2, g2), vary);
  moveK = mix(1.0, mix(0.5, 1.6, g3), vary);
  // 主方向は 25°〜65° か、その鏡 (右上がり / 左上がり)。副方向はそこから 55°〜95° 振る
  thA = mix(0.44, 1.13, g5) * (g6 < 0.5 ? 1.0 : -1.0);
  thB = thA + mix(0.96, 1.66, g7) * (g8 < 0.5 ? 1.0 : -1.0);
  // 密集の中心は、画面中央から三分割の焦点のあたりへ寄せる
  float aspect = resolution.x / max(resolution.y, 1.0);
  focus = vec2((g7 - 0.5) * aspect * 0.5, (g8 - 0.5) * 0.5);
  // 主色は白黒以外の 8 色から (sc_accent の h)。差し色はその 3〜5 つ隣 (index で返す)
  float mi = floor(g6 * 7.999);
  palMain = mi * 0.1 + 0.05;
  palAcc = mod(mi + 3.0 + floor(g5 * 2.999), 8.0);
}

// 世代 seedG の地色 (uGround = 4 のとき)
int sc_groundIdx(float seedG){
  return int(floor(sc_h1(seedG * 7.7 + 5.0) * 3.999));
}

vec3 bg_shard_collage(vec2 fc){
  float seed = floor(max(uSeed, 0.0) + 0.5);
  float bt = getBeat();
  float T = time * max(uSpeed, 0.0) * 0.01;
  float pulse = 0.0;
  if(!isFree()) pulse = pow(1.0 - fract(bt), 2.0);
  pulse = max(pulse, clamp(iAudio, 0.0, 1.0));
  float kick = pulse * max(uKick, 0.0) * 0.01;
  float drift0 = max(uDrift, 0.0) * 0.01 * (1.0 + 0.8 * kick);
  float turn0 = max(uTurn, 0.0) * 0.01;
  float morph = max(uMorph, 0.0) * 0.01;
  float dens0 = clamp(uDensity, 0.0, 100.0) * 0.01;
  float scl0 = max(uScale, 1.0) * 0.01;
  float gap0 = 0.0020 * max(uGap, 0.0) * 0.01;
  float grain = max(uGrain, 0.0) * 0.01;
  float vary = max(uVary, 0.0) * 0.01;
  float align = clamp(uAlign, 0.0, 100.0) * 0.01;
  float cluster = clamp(uCluster, 0.0, 100.0) * 0.01;

  // 再生成。拍があれば uRegen 拍ごと、無ければ uRegen 秒ごとに世代が進む。
  // 切り替えの間 (phase < 2) は前の世代も評価し、古い破片が縮んで消え、新しい破片が pop で出る
  float phase = 10.0;
  float clockv = isFree() ? time : bt;
  if(uRegen > 0.5){
    float gen = floor(clockv / uRegen);
    float swapLen = max(min(uRegen, 4.0) * 0.24, 0.02);
    phase = (clockv - gen * uRegen) / swapLen;
    seed += gen;
  }
  bool swapping = phase < 2.0;

  float zoom = max(bgZoom, 0.001);
  vec2 p = (fc - 0.5 * resolution) / max(resolution.y, 1.0);
  p = p / zoom + bgCamPx / max(resolution.y, 1.0);
  float px = 1.35 / (max(resolution.y, 1.0) * zoom);

  float tooth = sc_h2(fc + vec2(0.37, 0.11));
  float fiber = sc_vn(p * vec2(210.0, 70.0));
  float toothMul = 1.0 + ((tooth - 0.5) * 0.030 + (fiber - 0.5) * 0.025) * grain;

  float topSd = -1.0, underSd = -1.0;
  float topPrio = -1.0, underPrio = -1.0;
  vec2 topCtr = vec2(0.0), underCtr = vec2(0.0);
  float topAng = 0.0, underAng = 0.0;
  float topId = 0.0, underId = 0.0;
  int topTyp = 5, underTyp = 5;
  float topPal = 0.0, underPal = 0.0;   // 柄の主色 (小数) と差し色の index (整数) を 1 つに詰める

  // 地色。固定 (0〜3) か、世代ごとの色から次の世代の色へ間隔いっぱいをかけて移る (4)
  int gFixed = int(clamp(floor(uGround + 0.5), 0.0, 4.0));
  vec3 rim;
  if(gFixed < 4){
    rim = sc_ground(gFixed);
  } else {
    float gs = uRegen > 0.5 ? clockv / uRegen : time / 16.0;
    float seedA = uRegen > 0.5 ? seed : seed + floor(gs);
    rim = mix(sc_ground(sc_groundIdx(seedA)), sc_ground(sc_groundIdx(seedA + 1.0)), smoothstep(0.0, 1.0, fract(gs)));
  }
  float gap = gap0;
  for(int pass = 0; pass < 2; pass++){
    if(pass == 1 && !swapping) break;
    bool old = pass == 1;
    float seedG = seed - float(pass);
    float scl, dens, thA, thB, palMain, palAcc, gapK, moveK;
    vec2 focus;
    sc_gen(seedG, T, vary, scl0, dens0, scl, dens, thA, thB, focus, palMain, palAcc, gapK, moveK);
    float drift = drift0 * moveK;
    float turn = turn0 * moveK;
    if(pass == 0) gap = gap0 * gapK;
    float packed = palMain + palAcc;

    float sd, ang, idf, prio;
    vec2 ctr;
    int typ;
    // 主役 2 枚
    for(int k = 0; k < 2; k++){
      sc_hero(k, p, T, seedG, scl, drift, morph, phase, old, thA, 1.0, sd, ctr, ang, idf, typ, prio);
      if(sd > -px){
        if(prio > topPrio){
          underSd = topSd; underPrio = topPrio; underCtr = topCtr; underAng = topAng; underId = topId; underTyp = topTyp; underPal = topPal;
          topSd = sd; topPrio = prio; topCtr = ctr; topAng = ang; topId = idf; topTyp = typ; topPal = packed;
        } else if(prio > underPrio){
          underSd = sd; underPrio = prio; underCtr = ctr; underAng = ang; underId = idf; underTyp = typ; underPal = packed;
        }
      }
    }
    // 大・中・小の 3 層
    for(int l = 0; l < 3; l++){
      float lay = float(l);
      float cs = (l == 0 ? 1.00 : (l == 1 ? 0.46 : 0.21)) * scl;
      float dl = l == 0 ? 0.6 : dens;
      vec2 cell0 = floor(p / cs);
      for(int j = -1; j <= 1; j++){
        for(int i = -1; i <= 1; i++){
          sc_shard(lay, cell0 + vec2(float(i), float(j)), cs, p, T, seedG, dl, drift, turn, morph,
                   phase, old, thA, thB, align, focus, cluster,
                   sd, ctr, ang, idf, typ, prio);
          if(sd > -px){
            if(prio > topPrio){
              underSd = topSd; underPrio = topPrio; underCtr = topCtr; underAng = topAng; underId = topId; underTyp = topTyp; underPal = topPal;
              topSd = sd; topPrio = prio; topCtr = ctr; topAng = ang; topId = idf; topTyp = typ; topPal = packed;
            } else if(prio > underPrio){
              underSd = sd; underPrio = prio; underCtr = ctr; underAng = ang; underId = idf; underTyp = typ; underPal = packed;
            }
          }
        }
      }
    }
  }

  vec3 ground = rim * (0.955 + 0.07 * sc_vn(p * vec2(130.0, 48.0))) * toothMul;
  vec3 col = ground;
  if(topPrio >= 0.0){
    vec3 base = ground;
    if(underPrio >= 0.0 && topSd < gap + px * 2.0){
      sc_palMain = fract(underPal);
      sc_palAcc = floor(underPal) * 0.1 + 0.05;
      float uCover = smoothstep(-px, px, underSd);
      float uFill = smoothstep(gap - px, gap + px, underSd);
      vec2 ulp = sc_rot(p - underCtr, -underAng);
      vec3 utex = sc_tex(underTyp, ulp, underId, fc, grain) * toothMul;
      base = mix(ground, mix(rim, utex, uFill), uCover);
    }
    float cover = smoothstep(-px, px, topSd);
    float fill = smoothstep(gap - px, gap + px, topSd);
    vec3 face = rim;
    if(fill > 0.004){
      sc_palMain = fract(topPal);
      sc_palAcc = floor(topPal) * 0.1 + 0.05;
      vec2 lp = sc_rot(p - topCtr, -topAng);
      face = mix(rim, sc_tex(topTyp, lp, topId, fc, grain) * toothMul, fill);
    }
    col = mix(base, face, cover);
  }
  return clamp(col, 0.0, 1.0);
}
