// =====================================================
// bg_inkfilm  —  Ink Film (インク皮膜)
//   古い紙のコラージュの手前に、濡れたインクの皮膜がゆっくり出てくる。
//   構成 (奥 → 手前):
//   1. 黄ばんだ紙。シミ、繊維、上部の細いひび
//   2. 水彩: 左上の黄土、右の青紫のにじみ、下の朱橙の帯
//   3. 貼られた白い紙片、活字の塊、下部のスタンプ状の断片
//   4. 抽象的なインクのシルエット (色の滴り / 輪郭だけの身振り)。顔は描かない
//   5. 焦点: 中央は鋭く、縁は水彩ごと溶ける
//   6. 前景の皮膜: 破れた半透明のインク皮、めくれた帯、垂れる滴。
//      紙より速く漂い、縁がめくれて影を落とすので、コラージュの手前に見える
//   動き: drone は常にゆっくり。beat は拍頭で皮膜のめくれと濡れ光だけがふっと強まる
//         (位置は飛ばない)。iAudio も同じ (uKick)
//   性能: fbm は 3 オクターブを皮膜 3 回 + 紙 1 回。レイマーチなし
// =====================================================

// @param uSpeed    0..300    = 80.0
// @param uScale    20..300   = 100.0
// @param uPaper    0..200    = 100.0
// @param uWash     0..200    = 115.0
// @param uText     0..200    = 85.0
// @param uStamp    0..200    = 100.0
// @param uFigure   0..200    = 90.0
// @param uFocus    0..200    = 115.0
// @param uFilm     0..300    = 145.0
// @param uPeel     0..300    = 125.0
// @param uWet      0..300    = 110.0
// @param uDrip     0..200    = 100.0
// @param uGrain    0..300    = 80.0
// @param uKick     0..200    = 70.0
// @param uSeed     0..100    = 0.0
// @param uPaperCol color     = #f0e2c4
// @param uInkCol   color     = #1a1416
uniform float uSpeed;    // 皮膜と紙の動きの速さ (%)
uniform float uScale;    // 絵の大きさ (%)
uniform float uPaper;    // 紙のシミと貼り紙 (%)
uniform float uWash;     // 水彩のにじみ (%)
uniform float uText;     // 活字の塊 (%)
uniform float uStamp;    // 下部のスタンプ (%)
uniform float uFigure;   // 抽象シルエット (%)
uniform float uFocus;    // 中央を残して縁をぼかす (%)
uniform float uFilm;     // 手前のインク皮膜 (%)
uniform float uPeel;     // 皮膜の端のめくれ (%)
uniform float uWet;      // 濡れの光 (%)
uniform float uDrip;     // 皮膜から垂れる滴 (%)
uniform float uGrain;    // 紙のグレイン (%)
uniform float uKick;     // 拍 / 音の効き (%)
uniform float uSeed;     // 模様の乱数シード
uniform vec3  uPaperCol; // 紙の色
uniform vec3  uInkCol;   // インクの色

// ─── 乱数 / ノイズ ────────────────────────────────────────
float ik_h1(float n){ return fract(sin(n*127.1 + uSeed*17.37)*43758.5453); }
float ik_h2(vec2 p){
  p = fract(p*vec2(443.897, 441.423) + uSeed*0.137);
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y)*p.x);
}
float ik_vn(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0 - 2.0*f);
  return mix(mix(ik_h2(i),               ik_h2(i + vec2(1.0, 0.0)), u.x),
             mix(ik_h2(i + vec2(0.0, 1.0)), ik_h2(i + vec2(1.0, 1.0)), u.x), u.y);
}
float ik_fbm(vec2 p){
  const mat2 R = mat2(0.80, 0.60, -0.60, 0.80);
  float a = 0.5, s = 0.0;
  for(int i = 0; i < 3; i++){
    s += a*ik_vn(p);
    p = R*p*2.03 + 11.7;
    a *= 0.5;
  }
  return s / 0.875;
}
vec2 ik_rot(vec2 p, float a){
  float c = cos(a), s = sin(a);
  return vec2(c*p.x - s*p.y, s*p.x + c*p.y);
}
float ik_rbox(vec2 p, vec2 b){
  vec2 q = abs(p) - b;
  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0);
}
float ik_ell(vec2 p, vec2 c, vec2 r){
  vec2 d = (p - c) / max(r, vec2(1e-3));
  return dot(d, d);
}
float ik_smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0);
  return mix(b, a, h) - k*h*(1.0 - h);
}
float ik_aa(float d, float w){
  return 1.0 - smoothstep(0.0, w, d);
}

// 活字の塊。読める文字にはしない (行の切れ端だけ)
float ik_text(vec2 p, vec2 c, vec2 half_, float rot, float seed, float rows){
  vec2 q = ik_rot(p - c, rot) / half_;
  float inside = step(abs(q.x), 1.0)*step(abs(q.y), 1.0);
  float row = floor((q.y + 1.0)*0.5*rows);
  float fy = fract((q.y + 1.0)*0.5*rows);
  float bar = 1.0 - smoothstep(0.045, 0.11, abs(fy - 0.62));
  float h = ik_h1(row*3.1 + seed);
  float len = 0.52 + 0.44*h;
  float x = q.x*0.5 + 0.5;
  float on = step(0.03, x)*step(x, len);
  float cell = fract(x*(16.0 + 8.0*ik_h1(seed + 2.0)));
  float glyph = step(0.10, cell)*step(cell, 0.86);
  float keep = step(ik_h1(row*13.7 + floor(x*20.0) + seed*9.0), 0.78);
  return bar*on*glyph*keep*inside;
}

// 破れたインクの皮。x = 膜, y = 縁だけ。th が動くと縁が開閉する
vec2 ik_skin(vec2 p, float T, vec2 drift, float th){
  vec2 q = p*1.15 + drift;
  q += 0.18*vec2(sin(q.y*2.15 + T*0.27), cos(q.x*1.75 - T*0.19));
  float n = ik_fbm(q);
  float band = smoothstep(th, th + 0.04, n)*(1.0 - smoothstep(th + 0.18, th + 0.28, n));
  float hole = smoothstep(0.74, 0.88, ik_vn(q*3.4 + 4.2));
  band *= 1.0 - hole*0.95;
  float mask = smoothstep(0.28, 0.58, band);
  float edge = smoothstep(0.04, 0.28, band)*(1.0 - smoothstep(0.28, 0.62, band));
  return vec2(clamp(mask, 0.0, 1.0), clamp(edge, 0.0, 1.0));
}

// めくれた帯の中心線
float ik_ribY(float x, float T, float amp, float phase){
  return amp*sin(x*1.55 + phase) + amp*0.48*sin(x*3.15 - phase*0.62) + 0.028*sin(T*0.11 + amp*12.0);
}

// 帯: x=body, y=縁の厚み, z=上側の細いめくれ光
vec3 ik_ribbon(vec2 p, float T, float y0, float amp, float phase, float thick){
  float x = p.x + T*0.025;
  float sd = p.y - (y0 + ik_ribY(x, T, amp, phase));
  float w = thick*(0.70 + 0.40*sin(x*2.6 + phase));
  w += thick*0.28*(ik_vn(vec2(x*1.7, 1.7)) - 0.5);
  w = max(w, thick*0.34);
  float gap = smoothstep(0.38, 0.58, ik_vn(vec2(x*1.25, 5.5) + phase*0.15));
  float notch = smoothstep(0.74, 0.90, ik_vn(vec2(x*3.6, 0.4)));
  float cover = (1.0 - gap*0.96)*(1.0 - notch*0.55);
  float body = (1.0 - smoothstep(w*0.25, w + 0.008, abs(sd)))*cover;
  float edge = (1.0 - smoothstep(0.0, 0.005, abs(abs(sd) - w)))*cover;
  float curl = (1.0 - smoothstep(0.0, 0.006, abs(sd - w)))*step(0.0, sd)*cover;
  return vec3(body, edge, curl);
}

float ik_drip(vec2 p, float x, float y0, float hang, float w){
  float y1 = y0 - hang;
  float v = clamp((y0 - p.y)/max(hang, 1e-3), 0.0, 1.0);
  float ww = w*(1.0 - 0.6*v);
  float inY = step(y1, p.y)*step(p.y, y0 + 0.004);
  float line = (1.0 - smoothstep(ww, ww + 0.004, abs(p.x - x)))*inY;
  vec2 b = p - vec2(x, y1);
  float bulb = exp(-dot(b, b)/max(ww*ww*7.0, 1e-5))*step(p.y, y0);
  return max(line, bulb);
}

vec3 bg_inkfilm(vec2 fc){
  float bt = getBeat();
  float kick = uKick*0.01;
  float T, burst;
  if(isFree()){
    T = time;
    burst = 0.0;
  } else {
    float fb = fract(bt);
    T = (floor(bt) + mix(fb, 1.0 - pow(1.0 - fb, 3.0), clamp(kick, 0.0, 1.0)))*0.45;
    burst = pow(1.0 - fb, 5.0)*kick;
  }
  T = T*uSpeed*0.01 + uSeed*0.13;
  float audio = clamp(iAudio, 0.0, 1.0)*kick;
  float pulse = clamp(burst + audio*0.8, 0.0, 1.4);

  vec2 I = (fc - resolution*0.5)/max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  float sc = 100.0/max(uScale, 20.0);
  vec2 p = (I - 0.5*resolution)/resolution.y*sc;

  float paper = clamp(uPaper*0.01, 0.0, 2.0);
  float wash = clamp(uWash*0.01, 0.0, 2.0);
  float textA = clamp(uText*0.01, 0.0, 2.0);
  float stampA = clamp(uStamp*0.01, 0.0, 2.0);
  float fig = clamp(uFigure*0.01, 0.0, 2.0);
  float film = clamp(uFilm*0.01, 0.0, 2.6);
  float peel = clamp(uPeel*0.01, 0.0, 2.6);
  float wet = clamp(uWet*0.01, 0.0, 2.6);
  float dripA = clamp(uDrip*0.01, 0.0, 2.0);
  float grain = uGrain*0.01;

  // ─── 紙 ───
  float nP = ik_fbm(p*1.35 + vec2(2.2, 0.4) + T*0.01);
  vec3 col = uPaperCol;
  col *= 0.90 + 0.14*nP;
  float fox = smoothstep(0.58, 0.86, nP);
  col = mix(col, col*vec3(0.62, 0.46, 0.30), fox*0.55*paper);
  float blot = smoothstep(0.15, 0.0, length(p - vec2(-0.08, 0.40)));
  col = mix(col, col*vec3(0.42, 0.30, 0.20), blot*0.65*paper);
  float ochreN = smoothstep(0.55, 0.0, length((p - vec2(-0.32, 0.30))*vec2(1.1, 1.3)));
  // 上部のひび (印刷物の折れ)
  float crack = abs(p.y - (0.37 + 0.035*sin(p.x*5.5) + 0.02*sin(p.x*2.1 + 1.7)));
  float crackL = (1.0 - smoothstep(0.0, 0.0035, crack))*step(abs(p.x + 0.05), 0.72);
  col = mix(col, vec3(0.28, 0.18, 0.12), crackL*0.45*paper);

  vec3 soft = col;

  // ─── 水彩 (低周波。ぼかした側に残る) ───
  float gran = 0.88 + 0.24*(ik_vn(p*5.5 + nP) - 0.5);
  float blue = exp(-dot(p - vec2(0.58, 0.04), p - vec2(0.58, 0.04))*1.55);
  float blue2 = exp(-dot(p - vec2(0.78, 0.20), p - vec2(0.78, 0.20))*2.4);
  float purp = exp(-dot(p - vec2(0.40, -0.06), p - vec2(0.40, -0.06))*2.1);
  float yelt = exp(-dot(p - vec2(0.66, 0.34), p - vec2(0.66, 0.34))*3.2);
  vec3 blueCol = vec3(0.29, 0.46, 0.74);
  vec3 purpCol = vec3(0.40, 0.34, 0.62);
  vec3 yelCol = vec3(0.62, 0.56, 0.26);
  vec3 ochreCol = vec3(0.72, 0.52, 0.24);
  float wBlue = blue*0.95*gran*wash;
  float wBlue2 = blue2*0.7*wash;
  float wPurp = purp*0.62*wash;
  float wYel = yelt*0.40*wash;
  float wOch = ochreN*0.50*wash;
  col = mix(col, ochreCol, wOch);
  col = mix(col, blueCol, wBlue);
  col = mix(col, vec3(0.36, 0.50, 0.78), wBlue2);
  col = mix(col, purpCol, wPurp);
  col = mix(col, yelCol, wYel);
  soft = col;

  // 朱橙の帯 (下三分の一)。縁は水彩のようににじむ
  float yb = p.y + 0.145 - (nP - 0.5)*0.07;
  float band = (1.0 - smoothstep(0.035, 0.11, abs(yb)));
  band *= smoothstep(-0.85, -0.25, p.x);
  vec3 bandCol = mix(vec3(0.78, 0.28, 0.18), vec3(0.86, 0.50, 0.22), smoothstep(-0.2, 0.55, p.x));
  bandCol *= 0.92 + 0.16*ik_vn(p*vec2(1.2, 8.0));
  float bandS = (1.0 - smoothstep(0.04, 0.20, abs(yb)))*smoothstep(-0.9, -0.2, p.x);

  // ─── 貼られた白い紙片 (デッケルエッジ) ───
  vec2 q = ik_rot(p - vec2(0.14, 0.045), -0.045);
  float deckle = (ik_vn(vec2(atan(q.y, q.x)*3.0, length(q)*8.0)) - 0.5)*0.028;
  float dSheet = ik_rbox(q, vec2(0.30, 0.185)) - deckle;
  float bite = 1.0 - smoothstep(0.02, 0.07, length(q - vec2(0.22, 0.12)));
  float sheet = (1.0 - smoothstep(0.0, 0.008, dSheet))*(1.0 - bite);
  float sheetSoft = (1.0 - smoothstep(0.0, 0.09, dSheet))*(1.0 - bite*0.5);
  vec3 sheetCol = vec3(0.86, 0.80, 0.66);
  sheetCol *= 0.92 + 0.10*ik_vn(q*6.0);
  sheetCol = mix(sheetCol, sheetCol*vec3(0.72, 0.58, 0.40), smoothstep(0.55, 0.88, ik_vn(q*2.6 + 4.0))*0.7);
  float sheetSh = 1.0 - smoothstep(0.0, 0.045, ik_rbox(q - vec2(0.014, -0.012), vec2(0.30, 0.185)));
  col *= 1.0 - 0.20*sheetSh*(1.0 - sheet)*paper;
  col = mix(col, sheetCol, sheet*0.58*paper);
  soft = mix(soft, sheetCol, sheetSoft*0.62*paper);

  col = mix(col, bandCol, band*0.78*wash);
  soft = mix(soft, bandCol, bandS*0.62*wash);

  // ─── 活字 ───
  vec3 typeCol = vec3(0.22, 0.16, 0.12);
  float t1 = ik_text(p, vec2(-0.60, 0.04), vec2(0.155, 0.30), -0.012, 1.0, 34.0);
  float t2 = ik_text(p, vec2(-0.56, -0.30), vec2(0.15, 0.075), 0.02, 8.0, 8.0);
  float t3 = ik_text(p, vec2(0.10, -0.34), vec2(0.20, 0.045), 0.0, 15.0, 5.0);
  float typeM = clamp((t1*0.85 + t2*0.7 + t3*0.45)*textA, 0.0, 1.0);
  col = mix(col, typeCol, typeM*0.55);

  // 活字の脇の短い色線 (まっすぐ画面を横切らない)
  for(int i = 0; i < 3; i++){
    float fi = float(i);
    float yy = 0.16 - fi*0.11 + 0.012*sin(p.x*9.0 + fi*2.0);
    float ln = ik_aa(abs(p.y - yy), 0.003)*step(p.x, -0.48)*step(-0.78, p.x);
    vec3 lc = (i == 0) ? vec3(0.62, 0.16, 0.16) : (i == 1) ? vec3(0.16, 0.38, 0.48) : vec3(0.22, 0.40, 0.26);
    col = mix(col, lc, ln*0.55*fig);
  }

  // ─── 左の色だまり (人の形にはしない。にじんで垂れる絵の具) ───
  vec2 pw = p + vec2(ik_vn(p*2.2 + 2.0) - 0.5, ik_vn(p*1.6 + 8.0) - 0.5)*vec2(0.07, 0.05);
  float e1 = ik_ell(pw, vec2(-0.30, 0.18), vec2(0.12, 0.09));
  float e2 = ik_ell(pw, vec2(-0.26, 0.02), vec2(0.065, 0.15));
  float e3 = ik_ell(pw, vec2(-0.22, -0.15), vec2(0.11, 0.085));
  float field = ik_smin(ik_smin(e1, e2, 0.55), e3, 0.55);
  // 下へ不規則に垂れる
  float tongue = 0.0;
  for(int i = 0; i < 3; i++){
    float fi = float(i);
    float xs = -0.32 + fi*0.07;
    float hang = 0.10 + 0.10*ik_h1(fi + 4.0);
    tongue = max(tongue, ik_drip(pw, xs, -0.08, hang, 0.012 + 0.006*fi));
  }
  float pour = max(1.0 - smoothstep(0.55, 1.25, field), tongue*0.9);
  float bands = ik_vn(vec2(pw.x*3.2 + sin(pw.y*2.4)*0.35, pw.y*0.55));
  vec3 pourCol = mix(vec3(0.55, 0.10, 0.14), vec3(0.78, 0.48, 0.10), smoothstep(0.28, 0.52, bands));
  pourCol = mix(pourCol, vec3(0.10, 0.36, 0.42), smoothstep(0.48, 0.70, bands));
  pourCol = mix(pourCol, vec3(0.32, 0.14, 0.40), smoothstep(0.66, 0.88, bands));
  pourCol = mix(pourCol, vec3(0.08, 0.09, 0.16), smoothstep(0.05, 0.28, pw.y)*0.85);
  pourCol = mix(pourCol, vec3(0.82, 0.40, 0.12), smoothstep(0.0, -0.22, pw.y));
  pourCol = mix(pourCol, pourCol*0.75, ik_vn(pw*vec2(2.0, 10.0))*0.35);
  col = mix(col, pourCol, pour*0.78*fig);

  // ─── 右の素描 (閉じた輪郭・顔・体は塗らない。途切れた身振りの線だけ) ───
  float xS = p.x;
  float y1 = 0.00 + 0.055*sin((xS - 0.02)*3.4);
  float y2 = 0.075 + 0.03*sin((xS - 0.12)*5.2 + 0.8);
  float g1 = ik_aa(abs(p.y - y1), 0.005)*step(0.02, xS)*step(xS, 0.34);
  float g2 = ik_aa(abs(p.y - y2), 0.0045)*step(0.12, xS)*step(xS, 0.38);
  float brk = step(0.28, ik_vn(vec2(xS*14.0, 3.0)));
  float sketch = max(g1, g2)*brk;
  col = mix(col, vec3(0.16, 0.13, 0.12), sketch*0.8*fig);
  float smudge = exp(-pow((p.y - (y1 - 0.02))/0.04, 2.0))*step(0.06, xS)*step(xS, 0.28);
  col = mix(col, col*vec3(0.80, 0.76, 0.72), smudge*0.22*fig);

  // ─── 下部のスタンプ (文字も肖像も入れない) ───
  float stamps = 0.0;
  // 円形の消印
  {
    vec2 c = vec2(-0.02, -0.40);
    float d = length(p - c);
    float brk = smoothstep(0.25, 0.7, ik_vn((p - c)*26.0));
    float ring = ik_aa(abs(d - 0.055), 0.007)*brk;
    float ring2 = ik_aa(abs(d - 0.032), 0.006)*(1.0 - brk*0.35);
    stamps = max(stamps, max(ring*0.85, ring2*0.55));
  }
  // 小さな額縁 (中は粒状のシミだけ)
  {
    vec2 c = vec2(-0.58, -0.395);
    vec2 lp = p - c;
    float inn = 1.0 - smoothstep(0.0, 0.02, ik_rbox(lp, vec2(0.05, 0.065)));
    float blotch = smoothstep(0.25, 0.8, ik_vn(lp*10.0 + 3.0));
    col = mix(col, vec3(0.32, 0.26, 0.20), inn*(0.25 + 0.45*blotch)*stampA);
  }
  // 網点の正方形 (QR のファインダパターンは作らない)
  {
    vec2 c = vec2(0.30, -0.405);
    vec2 g = (p - c)/vec2(0.07, 0.06);
    float inb = step(abs(g.x), 1.0)*step(abs(g.y), 1.0);
    vec2 cell = floor((g*0.5 + 0.5)*5.0);
    vec2 f = fract((g*0.5 + 0.5)*5.0) - 0.5;
    float bit = step(0.55, ik_h2(cell + vec2(4.0, 9.0)));
    float dotm = ik_aa(length(f), 0.22)*bit*inb;
    stamps = max(stamps, dotm*0.5);
  }
  // 有機的な印影 (二つの塊)
  {
    float b1 = 1.0 - smoothstep(0.65, 1.05, ik_ell(p, vec2(0.55, -0.39), vec2(0.055, 0.028)));
    float b2 = 1.0 - smoothstep(0.6, 1.0, ik_ell(p, vec2(0.62, -0.42), vec2(0.04, 0.02)));
    stamps = max(stamps, max(b1, b2)*0.9);
  }
  // 下端の細い罫
  float rule = (1.0 - smoothstep(0.0, 0.0025, abs(p.y + 0.455)))*step(abs(p.x), 0.7);
  stamps = max(stamps, rule*0.6);
  col = mix(col, vec3(0.10, 0.08, 0.08), stamps*0.8*stampA);

  // ─── 焦点。中央の紙片は残し、右の青と下のスタンプを溶かす ───
  float focAmt = clamp(uFocus*0.01, 0.0, 1.8);
  // 右と下を強くぼかす。左の絵の具と中央の紙片は残す (参考写真のピント)
  float dx = (p.x - 0.02)*(p.x > 0.12 ? 1.45 : 0.55);
  float rad = length(vec2(dx, (p.y + 0.02)*1.15));
  float radial = 1.0 - smoothstep(0.16, 0.92, rad);
  radial *= 1.0 - 0.45*smoothstep(0.25, 0.85, p.x);
  float focus = mix(1.0, clamp(radial, 0.0, 1.0), focAmt);
  col = mix(soft, col, mix(0.18, 1.0, focus));

  // 背景のボケ玉 (皮膜より奥)
  vec3 bokeh = vec3(0.0);
  for(int i = 0; i < 4; i++){
    float fi = float(i);
    vec2 c = vec2(0.55, 0.06) + vec2(cos(fi*1.7), sin(fi*1.3))*0.22 + vec2(sin(T*0.05 + fi), cos(T*0.04 + fi*1.3))*0.02;
    float r = 0.05 + 0.03*ik_h1(fi + 2.2);
    float m = exp(-dot(p - c, p - c)/max(r*r, 1e-4));
    vec3 bc = mix(vec3(0.62, 0.74, 0.95), vec3(0.78, 0.70, 0.90), ik_h1(fi + 6.0));
    bokeh += bc*m;
  }
  col += bokeh*(1.0 - focus)*0.16*wash;

  // 右上の撮影光と、四隅の落ち
  float glare = exp(-length((p - vec2(0.74, 0.22))*vec2(1.05, 1.35))*1.25);
  col = mix(col, vec3(0.94, 0.96, 0.98), glare*0.20*(0.45 + 0.55*(1.0 - focus)));
  float vig = smoothstep(0.95, 0.25, length(p*vec2(0.72, 1.05)));
  col *= mix(0.78, 1.0, vig);

  // 紙のグレインは焦点の合ったところだけ (ボケた縁は粒が溶ける)
  float g = (ik_h2(I) - 0.5)*0.07 + (ik_vn(vec2(p.x*3.0, p.y*40.0)) - 0.5)*0.05;
  col *= 1.0 + g*grain*focus;

  // ─── 前景の皮膜 ───
  // コラージュはほぼ静止。皮膜だけが速く、わずかに迫って影を落とす
  float loom = 0.5 + 0.5*sin(T*0.21);
  vec2 shOff = vec2(0.013, -0.016)*(0.7 + 0.75*loom)*(1.0 + 0.2*pulse);
  float th = 0.42 + 0.05*sin(T*0.17);
  vec2 drift = vec2(T*0.048, T*0.014);
  vec2 sk = ik_skin(p, T, drift, th);
  vec2 skS = ik_skin(p - shOff, T, drift, th);
  float skin = sk.x;
  float skinE = sk.y;
  // 左と、紙片の上を横切る一枚。縁のボケたコラージュより皮の方が鋭い
  float gate = 0.35 + 0.65*smoothstep(0.35, -0.75, p.x);
  float lobe = 1.0 - smoothstep(0.02, 0.40, length(p - vec2(0.02, 0.08)));
  gate = max(gate, lobe*0.95);
  skin *= gate;
  skinE *= gate;
  float skinSh = skS.x*(0.35 + 0.65*smoothstep(0.35, -0.75, (p - shOff).x));

  vec2 p2 = (p - vec2(0.20, 0.02))/mix(1.02, 1.10, loom) + vec2(0.20, 0.02);
  vec2 sk2 = ik_skin(p2, T*1.15 + 6.0, vec2(-T*0.062, T*0.018) + vec2(2.4, -1.2), 0.48 + 0.04*sin(T*0.13 + 2.0));
  float gate2 = smoothstep(-0.15, 0.55, p.x)*smoothstep(-0.35, 0.25, p.y);
  float skin2 = sk2.x*gate2;
  float skin2E = sk2.y*gate2;

  vec3 ink = mix(uInkCol, vec3(0.05, 0.06, 0.10), 0.35);
  // 接触影を先に敷く (皮の右下、皮の外)
  float sh = clamp(skinSh*(1.0 - smoothstep(0.02, 0.45, skin)), 0.0, 1.0);
  col *= 1.0 - sh*0.45*film;

  // 暗い半透明の皮。下のコラージュは残るが、はっきり墨が乗る
  float a1 = clamp(skin*0.62*film*(1.0 + 0.04*pulse), 0.0, 0.78);
  vec3 stain = col*mix(vec3(1.0), ink*1.7 + vec3(0.04), 0.88);
  stain = mix(stain, ink, 0.42);
  // 皮の中の薄いムラ (塗りムラ。ガラスの筋ではない)
  stain *= 0.86 + 0.14*ik_vn(p*vec2(1.4, 7.0) + drift);
  col = mix(col, stain, a1);
  float a2 = clamp(skin2*0.50*film, 0.0, 0.70);
  vec3 stain2 = col*mix(vec3(1.0), ink*1.5 + vec3(0.05, 0.06, 0.09), 0.85);
  stain2 = mix(stain2, ink, 0.32);
  col = mix(col, stain2, a2);

  // めくれた帯。ノイズ皮より縁が細く、手前の膜として読む
  float phase = T*0.22;
  vec3 rib = ik_ribbon(p, T, -0.02, 0.06, phase, 0.026);
  vec3 rib2 = ik_ribbon(p + vec2(0.04, 0.0), T*1.3 + 2.2, 0.14, 0.035, phase*1.35 + 1.4, 0.016);
  vec3 ribSh = ik_ribbon(p - shOff, T, -0.02, 0.06, phase, 0.026);
  col *= 1.0 - ribSh.x*(1.0 - smoothstep(0.0, 0.5, rib.x))*0.40*film;
  float ar = clamp(rib.x*0.70*film, 0.0, 0.82);
  vec3 ribInk = mix(col*mix(vec3(1.0), ink*1.8, 0.9), ink, 0.5);
  ribInk *= 0.84 + 0.16*ik_vn(vec2(p.x*2.0 + phase, p.y*12.0));
  col = mix(col, ribInk, ar);
  col = mix(col, mix(ink, col*0.35, 0.25), clamp(rib2.x*0.55*film, 0.0, 0.68));

  // めくれは細い。広いクリームの帯にはしない
  float curl = clamp(rib.z*peel*(1.0 + 0.35*pulse), 0.0, 1.0);
  float edge = clamp(rib.y*peel, 0.0, 1.0);
  col = mix(col, ink*0.15, edge*0.9);
  col = mix(col, vec3(0.78, 0.68, 0.52), curl*0.55);
  col = mix(col, ink*0.2, clamp(rib2.y*peel, 0.0, 1.0)*0.8);
  col = mix(col, vec3(0.72, 0.66, 0.56), clamp(rib2.z*peel, 0.0, 1.0)*0.4);
  // ノイズ皮の縁も同じ厚み
  float lip = clamp((skinE + skin2E)*peel, 0.0, 1.0);
  col = mix(col, ink*0.12, lip*0.75*film);
  col = mix(col, vec3(0.75, 0.66, 0.52), lip*0.28*peel);

  // 帯から垂れる黒い滴
  float drops = 0.0;
  if(dripA > 0.001 && film > 0.001){
    for(int i = 0; i < 5; i++){
      float fi = float(i);
      float xs = -0.58 + fi*0.28 + 0.04*sin(T*0.17 + fi*1.8);
      float xx = xs + T*0.025;
      float y0 = -0.02 + ik_ribY(xx, T, 0.06, phase);
      float present = 1.0 - smoothstep(0.38, 0.58, ik_vn(vec2(xx*1.25, 5.5) + phase*0.15));
      float hang = (0.05 + 0.12*ik_h1(fi + 3.3))*(0.6 + 0.4*sin(T*0.29 + fi*1.3));
      hang *= dripA*(1.0 + 0.1*pulse);
      float w = 0.0035 + 0.0016*ik_h1(fi + 8.0);
      drops = max(drops, ik_drip(p, xs, y0, hang, w)*present);
    }
  }
  float ad = clamp(drops*0.82*film, 0.0, 0.9);
  col = mix(col, ink, ad);
  // 滴の頭だけ、ごく小さい濡れ光
  col += vec3(0.55, 0.60, 0.68)*pow(clamp(drops, 0.0, 1.0), 8.0)*wet*0.2*film;

  // 皮の上の細い濡れ光 (膜の内側だけ。画面全体のガラス光沢にはしない)
  float cover = clamp(a1 + a2 + ar + ad, 0.0, 1.0);
  float glint = pow(clamp(0.5 + 0.5*sin(p.x*5.5 + phase*1.4), 0.0, 1.0), 22.0);
  col += vec3(0.70, 0.78, 0.88)*glint*cover*wet*(0.06 + 0.1*pulse);

  col *= 1.0 - (ik_h2(I + 19.0) - 0.5)*0.03*grain*cover;

  return clamp(col, 0.0, 1.0);
}
