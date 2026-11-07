// =====================================================
// bg_flowcollage  —  流れるコラージュ (クラフト紙のうねる帯)
//   参照: ガタリ経由の参考ポスター (gara_shader_ref_202611041822.jpg)
//   構成 (下から順):
//   1. クラフト紙の地 (uPaperCol) + 紙のグレイン
//   2. 帯レイヤー ×2: 2 段のドメインワーピングで流した等値線を帯に切り、
//      帯ごとに柄を選ぶ (無地 / 平行ストライプ / 市松 / 同心円の渦 / 網点)。
//      上のレイヤーは一部の帯だけ不透明 → 帯が重なり、溶け合って入れ替わる
//   3. 帯の縁の黒線と、流れに沿う細い等高線
//   4. 太陽モチーフ: 放射状の短い線を持つ半円 (流れに乗って漂う)
//   5. 刷りのマチエール: インクのかすれ粒・スクラッチ・版ズレ
//   動き: drone は常にゆっくり流れ、場そのものも漂って新しい構図が入ってくる (uDrift)。
//         beat は拍頭ごとに水をかき混ぜるような渦が入り、帯が一気にねじれて 2〜4 拍かけて収まる (uJump)。
//         一部の帯の柄と色も拍ごとに振り直される (uReroll)。
//         拍頭ではうねりも一瞬強まる。iAudio も同じ (uKick)。bgZoom・bgCamPx でズーム/パン
//   性能: 値ノイズ 4 オクターブの fbm を 7 回 + 定数回の柄計算のみ (ループの
//         レイマーチなし)。重いときは uDetail を下げる (fbm のオクターブ数)
// =====================================================

// @param uSpeed    0..300    = 100.0
// @param uScale    20..300   = 100.0
// @param uWarp     0..300    = 100.0
// @param uBands    20..300   = 100.0
// @param uStripe   20..300   = 100.0
// @param uLayer    0..200    = 100.0
// @param uPaper    0..200    = 100.0
// @param uLines    0..300    = 100.0
// @param uEdge     0..200    = 100.0
// @param uDots     0..200    = 100.0
// @param uSuns     0..300    = 100.0
// @param uGrain    0..300    = 100.0
// @param uWorn     0..300    = 100.0
// @param uKick     0..200    = 100.0
// @param uDetail   2..5      = 4.0
// @param uSeed     0..100    = 0.0
// @param uJump     0..300    = 100.0
// @param uDrift    0..300    = 100.0
// @param uReroll   0..100    = 40.0
// @param uPaperCol color     = #c9ad8e
uniform float uSpeed;    // 流れの速さ (%)
uniform float uScale;    // 柄の大きさ (%)
uniform float uWarp;     // うねり (ドメインワーピングの強さ, %)
uniform float uBands;    // 帯の本数 (%)
uniform float uStripe;   // ストライプ・渦の細かさ (%)
uniform float uLayer;    // 上のレイヤーの重なり量 (%)
uniform float uPaper;    // 紙地が見える量 (%)
uniform float uLines;    // 等高線の量 (%)
uniform float uEdge;     // 帯の縁の黒線 (%)
uniform float uDots;     // 網点の帯の量 (%)
uniform float uSuns;     // 太陽モチーフの量 (%)
uniform float uGrain;    // 紙のグレイン (%)
uniform float uWorn;     // インクのかすれ・スクラッチ (%)
uniform float uKick;     // 拍 / 音の効き (%)
uniform float uDetail;   // fbm のオクターブ数 (下げると軽く、輪郭が丸くなる)
uniform float uSeed;     // 柄と配色の乱数シード
uniform float uJump;     // beat: 拍頭でかき混ぜる渦の強さ (%。0 = 従来どおりその場で揺れる)
uniform float uDrift;    // drone: 場が漂って新しい構図が入ってくる量 (%)
uniform float uReroll;   // beat: 拍ごとに柄と色を振り直す帯の割合 (%)
float FC_ROLL = 0.0;     // 振り直しの拍番号 (beat のみ。drone は 0 = 振り直さない)
uniform vec3  uPaperCol; // 紙の色

// ─── 乱数 / ノイズ ────────────────────────────────────────
float fc_h1(float n){ return fract(sin(n*127.1 + uSeed*17.37)*43758.5453); }
float fc_h2(vec2 p){
  p = fract(p*vec2(443.897, 441.423) + uSeed*0.137);
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y)*p.x);
}
float fc_vn(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0 - 2.0*f);
  return mix(mix(fc_h2(i),               fc_h2(i + vec2(1.0, 0.0)), u.x),
             mix(fc_h2(i + vec2(0.0, 1.0)), fc_h2(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fc_fbm(vec2 p){
  const mat2 R = mat2(0.80, 0.60, -0.60, 0.80);
  int   O = int(clamp(uDetail, 1.0, 5.0));
  float a = 0.5, s = 0.0, n = 0.0;
  for(int i = 0; i < 5; i++){
    if(i >= O) break;
    s += a*fc_vn(p);
    n += a;
    p = R*p*2.03 + 17.1;
    a *= 0.5;
  }
  return s / n;
}

// ─── パレット (くすんだ原色) ──────────────────────────────
vec3 fc_pal(float x){
  int i = int(floor(fract(x)*10.0));
  if(i == 0) return vec3(0.17, 0.29, 0.60);   // コバルトブルー
  if(i == 1) return vec3(0.76, 0.26, 0.17);   // 朱赤
  if(i == 2) return vec3(0.84, 0.47, 0.18);   // オレンジ
  if(i == 3) return vec3(0.83, 0.65, 0.22);   // マスタード
  if(i == 4) return vec3(0.40, 0.29, 0.52);   // 紫
  if(i == 5) return vec3(0.17, 0.33, 0.27);   // 深緑
  if(i == 6) return vec3(0.09, 0.09, 0.11);   // 黒
  if(i == 7) return vec3(0.91, 0.87, 0.78);   // オフホワイト
  if(i == 8) return vec3(0.11, 0.15, 0.27);   // 紺
  return            vec3(0.40, 0.18, 0.20);   // 臙脂
}

// 帯 1 本ぶんの柄。band = 帯座標 (整数部 = 帯 ID)、al = 帯に沿う座標、
// r = ワープ後の座標、px = 画素座標 (網点のピッチ用)。返り値 = (色, 不透明度)
vec4 fc_pattern(float band, float al, vec2 r, vec2 px, float layer, float dens, float paper){
  float id  = floor(band) + layer*97.0;
  // 拍ごとに一部の帯だけ別の柄・色へ (どの帯が変わるかも拍ごとに違う)
  id += step(fc_h1(id + 211.0 + FC_ROLL*3.1), clamp(uReroll*0.01, 0.0, 1.0)) * FC_ROLL * 31.7 * step(0.5, FC_ROLL);
  float tb  = fract(band);
  float hA  = fc_h1(id);
  float hB  = fc_h1(id + 13.7);
  float hC  = fc_h1(id + 29.3);
  vec3  c1  = fc_pal(hB);
  vec3  c2  = fc_pal(hB + 0.3 + 0.4*hC);
  float aa  = fwidth(band) + 1e-4;

  // 上のレイヤーは帯の一部だけを不透明にする (残りは下が透ける)
  float alpha = 1.0;
  if(layer > 0.5){
    alpha = step(hC, 0.36*clamp(uLayer*0.01, 0.0, 2.0));
  } else {
    // 紙地の帯 (下のレイヤーのみ)
    if(hC < 0.30*paper) alpha = 0.0;
  }

  // 帯ごとの太さムラ: 帯の端を少し削って隙間 (紙地) を作る
  float gap = layer > 0.5 ? 0.22 + 0.30*fc_h1(id + 7.7) : 0.06 + 0.10*hC;
  alpha *= smoothstep(0.0, aa*1.5, tb - gap*0.5) * smoothstep(0.0, aa*1.5, 1.0 - gap*0.5 - tb);

  vec3 col;
  float kind = hA;
  float dotP = 0.12*clamp(uDots*0.01, 0.0, 2.0);
  if(kind < dotP){
    // 網点: 帯の中で濃度が流れに沿って変わるハーフトーン
    float pitch = 7.0;
    mat2  rt  = mat2(0.7071, 0.7071, -0.7071, 0.7071);
    vec2  g   = rt*px / pitch;
    vec2  cel = fract(g) - 0.5;
    float tone = 0.25 + 0.6*(0.5 + 0.5*sin(al*1.7 + hB*6.28));
    float rad  = sqrt(tone)*0.5;
    float pw   = fwidth(g.x) + 1e-4;
    float dotm = 1.0 - smoothstep(rad - pw, rad + pw, length(cel));
    col = mix(vec3(0.91, 0.87, 0.78), c1, dotm);
  } else if(kind < dotP + 0.20){
    col = c1;                                                    // 無地
  } else if(kind < dotP + 0.52){
    // 平行ストライプ (帯の縁に平行)
    float k  = floor(2.0 + 5.0*hC) * dens;
    float s  = tb*k;
    float sw = fwidth(s) + 1e-4;
    float m  = smoothstep(0.5 - sw, 0.5 + sw, abs(fract(s) - 0.5)*2.0);
    vec3  c3 = hC > 0.6 ? vec3(0.09, 0.09, 0.11) : vec3(0.91, 0.87, 0.78);
    col = mix(c1, (fract(floor(s)*0.5) > 0.25 && hC > 0.35) ? c2 : c3, m);
  } else if(kind < dotP + 0.68){
    // 市松: 帯の幅方向 × 帯に沿う方向
    vec2  q  = vec2(tb*2.0, al*2.5*dens);
    vec2  qw = fwidth(q) + 1e-4;
    vec2  sq = smoothstep(0.5 - qw, 0.5 + qw, fract(q));
    float m  = abs(sq.x - sq.y);
    col = mix(c1, hB > 0.5 ? vec3(0.09, 0.09, 0.11) : vec3(0.91, 0.87, 0.78), m);
  } else {
    // 同心円の渦: 帯ごとの中心から、角度でねじれたリング
    vec2  cen = vec2(fc_h1(id + 3.1), fc_h1(id + 5.9))*8.0 - 4.0;
    vec2  d   = r - cen;
    float ang = atan(d.y, d.x);
    float s   = (length(d)*3.0 + ang*0.35*(hB - 0.5)*4.0) * dens;
    float sw  = fwidth(s) + 1e-4;
    float m   = smoothstep(0.5 - sw, 0.5 + sw, abs(fract(s) - 0.5)*2.0);
    col = mix(c1, c2, m);
  }

  // 縁の黒線 (一部の帯)
  float edgeOn = step(fc_h1(id + 41.0), 0.55*clamp(uEdge*0.01, 0.0, 2.0));
  float e = min(tb - gap*0.5, 1.0 - gap*0.5 - tb);
  float ew = aa*(0.9 + 0.8*hA);
  col = mix(col, vec3(0.08, 0.08, 0.10), edgeOn*(1.0 - smoothstep(ew*0.6, ew*1.6, e)));
  return vec4(col, alpha);
}

vec3 bg_flowcollage(vec2 fc){
  float bt   = getBeat();
  float kick = uKick * 0.01;
  // 時間: beat モードは拍頭で押し出してから減速 (単調増加)、drone は一定の速さ
  float T, burst;
  if(isFree()){
    T = time;
    burst = 0.0;
  } else {
    float fb = fract(bt);
    T = (floor(bt) + mix(fb, 1.0 - pow(1.0 - fb, 3.0), clamp(kick, 0.0, 1.0))) * 0.5;
    burst = pow(1.0 - fb, 4.0) * kick;
  }
  T *= uSpeed * 0.01;
  float audio = clamp(iAudio, 0.0, 1.0) * kick;

  vec2 I  = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  float sc = 100.0 / max(uScale, 5.0);
  vec2 p  = (I - 0.5*resolution) / resolution.y * 3.0 * sc;
  // drone: 場がゆっくり漂う
  // beat : 水をかき混ぜる。拍頭ごとに場所・大きさ・向きが違う渦を入れ、一気にねじる。
  //        渦はそのあとも少し回り続け、2〜4 拍かけて収まる (直近 4 拍分を重ねる)
  if(isFree()){
    p += vec2(0.06, 0.025) * T * uDrift * 0.01;
  } else {
    float n  = floor(bt);
    float st = uJump * 0.01;
    float asp = resolution.x / resolution.y;
    for(int k = 0; k < 4; k++){
      float m   = n - float(k);
      float age = bt - m;
      vec2  c   = (vec2(fc_h1(m*1.31 + 4.0), fc_h1(m*2.17 + 9.0)) - 0.5) * vec2(3.0*asp, 3.0) * sc;
      float R   = (0.9 + 1.4*fc_h1(m*3.7 + 2.0)) * sc;
      float dirS = fc_h1(m*5.3 + 1.0) < 0.5 ? -1.0 : 1.0;
      float ang = dirS * 3.2 * st * (smoothstep(0.0, 0.1, age) + 0.25*age) * (1.0 - smoothstep(1.5, 4.0, age));
      vec2  d   = p - c;
      float a   = ang * exp(-dot(d, d)/(R*R));
      float ca  = cos(a), sa = sin(a);
      p = c + mat2(ca, sa, -sa, ca) * d;
    }
    FC_ROLL = n + 1.0;
  }
  vec2 px = I;                                                   // 網点・粒は画素基準 (ズームで粗くなる)

  // ─── 2 段ドメインワーピング (液体のような流れ) ───
  float t    = T * 0.10;
  float warp = uWarp * 0.01 * (1.0 + 0.45*burst + 0.5*audio);
  vec2 w1 = vec2(fc_fbm(p*0.55 + vec2(0.0, t)),
                 fc_fbm(p*0.55 + vec2(5.2, 1.3) - vec2(t, 0.0)));
  vec2 q  = p + (w1 - 0.5)*2.4*warp;
  vec2 w2 = vec2(fc_fbm(q*0.75 + vec2(1.7, 9.2) + t*0.7),
                 fc_fbm(q*0.75 + vec2(8.3, 2.8) - t*0.6));
  vec2 r  = q + (w2 - 0.5)*1.8*warp;

  float nb    = 3.2 * uBands * 0.01;
  float dens  = uStripe * 0.01;
  float paper = clamp(uPaper * 0.01, 0.0, 2.0);

  // 帯座標: 等値線 + ゆるい方向性 (帯が塊ではなくリボンになる)
  float f1 = fc_fbm(r*0.45 + vec2(t*0.3, 0.0));
  float b1 = (f1*3.5 + 0.22*r.y + 0.06*r.x) * nb;
  float a1 = dot(r, vec2(0.86, -0.50)) + w2.x*2.0;
  float f2 = fc_fbm(r*0.38 + vec2(11.0, 4.0) - t*0.25);
  float b2 = (f2*3.2 - 0.20*r.x + 0.08*r.y) * nb * 1.1 + 40.0;
  float a2 = dot(r, vec2(0.50, 0.86)) + w2.y*2.0;

  // ─── 合成 ───
  vec3 col = uPaperCol;
  vec4 L1 = fc_pattern(b1, a1, r, px, 0.0, dens, paper);
  col = mix(col, L1.rgb, L1.a);
  vec4 L2 = fc_pattern(b2, a2, r + 3.7, px, 1.0, dens, paper);
  col = mix(col, L2.rgb, L2.a);
  float ink = max(L1.a, L2.a);

  // ─── 等高線: 流れに沿う細い黒線 (領域ごとに出たり消えたり) ───
  float lineAmt = uLines * 0.01;
  if(lineAmt > 0.0){
    float h    = fc_fbm(r*0.6 + vec2(2.0, 7.0) + t*0.2) * 9.0 * nb/3.2 + r.y*0.4;
    float hw   = fwidth(h) + 1e-4;
    float dd   = abs(fract(h + 0.5) - 0.5) / hw;                 // 画素単位の線からの距離
    float gate = smoothstep(0.52, 0.64, fc_vn(r*0.35 + vec2(t*0.2, 3.0)) + 0.12*(lineAmt - 1.0));
    float ln   = (1.0 - smoothstep(0.5, 1.3, dd)) * gate * clamp(lineAmt, 0.0, 1.0);
    // 暗い帯の上では白抜きの線にする
    float lum  = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, lum < 0.28 ? vec3(0.90, 0.86, 0.77) : vec3(0.08, 0.08, 0.10), ln);
  }

  // ─── 太陽モチーフ: 放射線つきの半円 ───
  float sunP = 0.10 * uSuns * 0.01;
  if(sunP > 0.0){
    // ワープの強い r ではなく、ゆるく流した座標で描く (半円が溶けずに漂う)
    float cs   = 1.3;
    vec2  sp   = (p + (w1 - 0.5)*0.5*warp + vec2(t*0.25, t*0.4)) / cs;
    vec2  cell = floor(sp);
    for(int k = 0; k < 4; k++){                                 // 隣接セルもみて端切れを防ぐ
      vec2  cc = cell + vec2(float(k - (k/2)*2), float(k/2)) - 0.5 + step(0.5, fract(sp));
      float hs = fc_h2(cc + 71.3);
      if(hs > sunP) continue;
      vec2  ctr = cc + 0.3 + 0.4*vec2(fc_h2(cc + 2.1), fc_h2(cc + 4.7));
      vec2  d   = (sp - ctr) * cs;
      float an  = fc_h2(cc + 9.9) * 6.2832;
      vec2  dir = vec2(cos(an), sin(an));
      float R   = 0.12 + 0.09*fc_h2(cc + 6.6);
      float dl  = length(d);
      float pw  = fwidth(dl) + 1e-4;
      float half_ = smoothstep(-pw, pw, dot(d, dir));
      float disk = (1.0 - smoothstep(R - pw, R + pw, dl)) * half_;
      // 放射線: 半円の外側、半周に短い線
      float th   = atan(dot(d, vec2(-dir.y, dir.x)), dot(d, dir));     // -π..π, 0 = 半円の向き
      float nr   = 11.0;
      float rs   = (th / 3.1416 * 0.5 + 0.5) * nr * 2.0;
      float rw   = fwidth(rs) + 1e-4;
      float ray  = 1.0 - smoothstep(0.18 - rw, 0.18 + rw, abs(fract(rs) - 0.5));
      ray *= smoothstep(R*1.12 - pw, R*1.12 + pw, dl) * (1.0 - smoothstep(R*1.75 - pw, R*1.75 + pw, dl));
      ray *= step(abs(th), 1.5708);
      vec3 sunC = fc_pal(0.2 + 0.1*floor(fc_h2(cc + 8.8)*2.0) + 0.05);  // オレンジ / マスタード
      col = mix(col, sunC, disk);
      float rim = (1.0 - smoothstep(pw*0.8, pw*2.0, abs(dl - R))) * half_;          // 半円の輪郭
      col = mix(col, vec3(0.08, 0.08, 0.10), clamp(rim + ray, 0.0, 1.0));
      ink = max(ink, disk);
    }
  }

  // ─── マチエール ───
  float worn = uWorn * 0.01;
  // インクのかすれ: 細かいノイズで刷りが抜け、紙が覗く
  float spk  = fc_vn(px*0.35) * 0.6 + fc_vn(px*0.09 + 13.0) * 0.4;
  float drop = smoothstep(0.86 - 0.08*worn, 0.90 - 0.08*worn, spk) * ink * clamp(worn, 0.0, 1.5);
  col = mix(col, uPaperCol * 1.05, clamp(drop, 0.0, 1.0));
  // スクラッチ: 細長い異方性ノイズ
  float scr  = fc_vn(vec2(px.x*0.012 + px.y*0.004, px.y*0.45));
  col = mix(col, vec3(0.93, 0.89, 0.80), smoothstep(0.965, 0.995, scr) * clamp(worn, 0.0, 1.5) * 0.7);
  // 黒い粒
  float spec = fc_h2(floor(px*0.5) + floor(T*2.0)*0.0);
  col *= 1.0 - step(0.9985 - 0.0010*worn, spec) * 0.6 * clamp(worn, 0.0, 1.5);
  // 紙のグレイン (画素ノイズ + 繊維の低周波ムラ)
  float gr  = (fc_h2(px) - 0.5) * 0.10 + (fc_vn(px*0.03) - 0.5) * 0.08;
  col *= 1.0 + gr * uGrain * 0.01;

  return clamp(col, 0.0, 1.0);
}
