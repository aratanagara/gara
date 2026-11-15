// =====================================================
// bg_kandinsky (Kandinsky — Composition)
//   点・線・面がランダムに生まれ、運動しては消えていく。
//   要素の枠 (uKdCount 個) はそれぞれ「生まれる → 描かれる → 漂う/回る → 消える」を繰り返し、
//   周期ごとに位置・形・色を引き直す。重なり順は 面 → 線 → 点 (枠の番号で分ける)。
//     面: 光輪つきの円 / 同心円 / 三角形 / 四角形 / 市松
//     線: 太い直線 / 細い平行線の束 / 円弧 / 波線   (一端から描かれ、同じ向きに消える)
//     点: 点 / 輪つきの点 / 点線                   (膨らんで現れ、縮んで消える)
//   面どうしが重なったところは色が変わる (uKdOverlap)。
//   beat モードは拍頭で生まれ、拍ごとに押し出されて動く。drone は一定の速さ。
//   bgZoom・bgCamPx でズーム/パン。ヘルパは kd_ で名前空間化。
// =====================================================

// @param uKdCount   4..60    = 28.0
// @param uKdLife    2..32    = 8.0
// @param uKdPlanes  0..100   = 45.0
// @param uKdLines   0..100   = 60.0
// @param uKdPoints  0..100   = 35.0
// @param uKdRest    0..90    = 25.0
// @param uKdSize    30..300  = 100.0
// @param uKdThick   20..300  = 100.0
// @param uKdDraw    0..100   = 40.0
// @param uKdMotion  0..300   = 100.0
// @param uKdSpin    0..300   = 100.0
// @param uKdOverlap 0..100   = 60.0
// @param uKdHalo    0..200   = 100.0
// @param uKdColor   0..100   = 40.0
// @param uKdSpeed   10..300  = 100.0
// @param uKdKick    0..200   = 100.0
// @param uKdScale   30..300  = 100.0
// @param uKdSeed    0..100   = 0.0
// @param uKdGrain   0..100   = 30.0
// @param uKdClear   0..100   = 0.0
// @param uKdPaper   color = #ede3cd
// @param uKdInk     color = #171513
// @param uKdRed     color = #c4372c
// @param uKdBlue    color = #2a4996
// @param uKdYellow  color = #e8bf34
// @param uKdViolet  color = #6a3d8c
// @param uKdPink    color = #d98a9e
// @param uKdSky     color = #7fb0cd
uniform float uKdCount;   // 要素の数 (同時に存在する点・線・面の枠の数)
uniform float uKdLife;    // 要素の寿命 (拍)。要素ごとに 0.6〜1.4 倍にばらつく
uniform float uKdPlanes;  // 面の割合 (重み)
uniform float uKdLines;   // 線の割合 (重み)
uniform float uKdPoints;  // 点の割合 (重み)
uniform float uKdRest;    // 休む周期の割合 (%)。上げると画面に空きが増える
uniform float uKdSize;    // 要素の大きさ (%)
uniform float uKdThick;   // 線の太さ (%)
uniform float uKdDraw;    // 寿命のうち 描かれる / 消える のにかける割合 (%)。0 で一瞬で出て一瞬で消える
uniform float uKdMotion;  // 漂う速さ (%)
uniform float uKdSpin;    // 回る速さ (%)
uniform float uKdOverlap; // 面が重なったところの色の変わり方 (%)。0 で上の面がそのまま覆う
uniform float uKdHalo;    // 円のまわりの暗い光輪 (%)
uniform float uKdColor;   // 線と点が色を持つ割合 (%)。残りは墨
uniform float uKdSpeed;   // 全体の速さ (%)
uniform float uKdKick;    // 拍の効き (%)。拍頭の押し出し
uniform float uKdScale;   // 構図の大きさ (%)
uniform float uKdSeed;    // 乱数の種。値を変えると別の構図になる
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

float kd_h(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float kd_vn(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = kd_h(vec3(i, 7.0)), b = kd_h(vec3(i + vec2(1,0), 7.0));
  float c = kd_h(vec3(i + vec2(0,1), 7.0)), d = kd_h(vec3(i + vec2(1,1), 7.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
mat2 kd_rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec3 kd_pal(float h){
  float k = floor(h * 7.0);
  if(k < 1.0) return uKdRed;
  if(k < 2.0) return uKdBlue;
  if(k < 3.0) return uKdYellow;
  if(k < 4.0) return uKdViolet;
  if(k < 5.0) return uKdPink;
  if(k < 6.0) return uKdSky;
  return uKdInk;
}
float kd_box(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
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

vec3 bg_kandinsky(vec2 fc){
  float bt = getBeat();
  float spd = uKdSpeed * 0.01;
  float kick = clamp(uKdKick * 0.01, 0.0, 1.0);
  float B;
  if(isFree()){
    B = time * spd * 2.0;
  } else {
    float b = bt * spd, fb = fract(b);
    B = floor(b) + mix(fb, 1.0 - pow(1.0 - fb, 3.0), kick);   // 拍頭で押し出して止まる
  }
  float seed = uKdSeed * 1.37;

  float zm = max(bgZoom, 0.001);
  vec2 q = ((fc - 0.5 * resolution) / zm + bgCamPx) / resolution.y;
  float sc = 100.0 / uKdScale;
  q *= sc;
  float aa = sc / (resolution.y * zm);
  float asp = resolution.x / resolution.y;

  // 地: 中央が明るく、縁へ少し沈む
  vec2 uv0 = q / sc;
  vec3 col = uKdPaper * (1.0 - 0.16 * dot(uv0, uv0));
  float painted = 0.0;   // 何かが塗られた量 (透過と、面の重なりの判定に使う)

  float wP = uKdPlanes, wL = uKdLines, wD = uKdPoints;
  float wT = max(wP + wL + wD, 1e-3);
  int N = int(uKdCount + 0.5);
  float fN = float(N);
  float sz = uKdSize * 0.01 * sc;
  float th0 = uKdThick * 0.01;
  float dr = uKdDraw * 0.01 * 0.45;

  for(int i = 0; i < N; i++){
    float fi = float(i);
    float u = (fi + 0.5) / fN;
    float cat = u < wP / wT ? 0.0 : (u < (wP + wL) / wT ? 1.0 : 2.0);   // 0 面 / 1 線 / 2 点
    // 寿命と世代
    float Lb = max(2.0, floor(uKdLife * (0.6 + 0.8 * kd_h(vec3(fi, 1.0, seed))) + 0.5));
    float x = (B + floor(kd_h(vec3(fi, 2.0, seed)) * Lb)) / Lb;
    float g = floor(x), f = fract(x);
    if(kd_h(vec3(fi, g, seed + 3.0)) < uKdRest * 0.01) continue;     // この周期は休む
    // 位置と大きさだけ先に求め、届かない要素はここで飛ばす
    float h1 = kd_h(vec3(fi, g, seed + 11.0)), h2 = kd_h(vec3(fi, g, seed + 12.0));
    float h3 = kd_h(vec3(fi, g, seed + 13.0)), h4 = kd_h(vec3(fi, g, seed + 14.0));
    float h7 = kd_h(vec3(fi, g, seed + 17.0));
    float tm = f * Lb;                                                  // 生まれてからの拍
    vec2 p = vec2((h1 - 0.5) * asp * 1.05, (h2 - 0.5) * 1.05) * sc;
    p += (vec2(h3, h4) - 0.5) * 0.05 * uKdMotion * 0.01 * tm * sc;
    vec2 d0 = q - p;
    float reach = cat < 0.5 ? sz * (0.07 + 0.2 * h7 * h7) * 3.2 : (cat < 1.5 ? sz * (0.25 + 0.75 * h7) * 0.75 + 0.05 * sc : sz * 0.5);
    if(dot(d0, d0) > reach * reach) continue;
    float h5 = kd_h(vec3(fi, g, seed + 15.0)), h6 = kd_h(vec3(fi, g, seed + 16.0));
    float h8 = kd_h(vec3(fi, g, seed + 18.0)), h9 = kd_h(vec3(fi, g, seed + 19.0));
    float ang = h5 * 6.2832 + (h6 - 0.5) * 0.35 * uKdSpin * 0.01 * tm;
    float ein = dr > 0.0 ? smoothstep(0.0, dr, f) : 1.0;
    float eout = dr > 0.0 ? 1.0 - smoothstep(1.0 - dr, 1.0, f) : 1.0;
    vec2 lp = kd_rot(-ang) * d0;

    if(cat < 0.5){
      // ── 面 ──
      float r = sz * (0.07 + 0.2 * h7 * h7) * ein * eout;
      if(r <= 0.0 || length(d0) > r * 3.2 + aa) continue;
      float type = floor(h8 * 5.0);
      vec3 c = kd_pal(h9 * 0.857);                                     // 面は墨以外
      float d;
      vec3 cIn = c;
      if(type < 1.0){
        // 光輪つきの円
        d = length(d0) - r;
        float halo = uKdHalo * 0.01 * 0.55 * exp(-max(d, 0.0) / (r * 0.35)) * step(0.0, d);
        col = mix(col, uKdInk, halo * step(0.5, h6));
        painted = max(painted, halo * step(0.5, h6));
      } else if(type < 2.0){
        // 同心円
        d = length(d0) - r;
        float nr = 2.0 + floor(h6 * 3.0);
        float band = floor(length(d0) / r * nr);
        cIn = kd_pal(fract(h9 + band * 0.37) * 0.857);
      } else if(type < 3.0){
        // 三角形
        float a0 = 0.0, a1 = 2.094 + (h6 - 0.5) * 0.9, a2 = 4.189 + (h3 - 0.5) * 0.9;
        d = kd_tri(lp, r * vec2(cos(a0), sin(a0)), r * vec2(cos(a1), sin(a1)), r * vec2(cos(a2), sin(a2)));
      } else if(type < 4.0){
        // 四角形
        d = kd_box(lp, r * vec2(0.35 + 0.9 * h6, 0.2 + 0.5 * h3));
      } else {
        // 市松
        d = kd_box(lp, vec2(r * 0.8));
        float n = 3.0 + floor(h6 * 4.0);
        vec2 cc = floor((lp / (r * 1.6) + 0.5) * n);
        float chk = mod(cc.x + cc.y, 2.0);
        cIn = chk > 0.5 ? c : (h3 < 0.5 ? uKdInk : uKdPaper);
      }
      float a = smoothstep(aa, -aa, d);
      // 重なり: 既に塗られた上では色が変わる (乗算寄りの混色)
      vec3 oc = clamp(cIn * col * 1.55 + 0.04, 0.0, 1.0);
      cIn = mix(cIn, oc, uKdOverlap * 0.01 * painted);
      col = mix(col, cIn, a);
      painted = max(painted, a);
      // 円の縁取り (墨)
      if(type < 2.0 && h4 < 0.45){
        float ow = 0.0025 * th0 * sc;
        float ao = smoothstep(ow + aa, ow - aa, abs(d));
        col = mix(col, uKdInk, ao);
      }
    } else if(cat < 1.5){
      // ── 線 ── 一端から描かれ (t1)、同じ向きに消える (t0)
      float L = sz * (0.25 + 0.75 * h7);
      if(length(d0) > L + 0.05 * sc) continue;
      float type = floor(h8 * 4.0);
      float th = (0.0018 + 0.006 * h6 * h6) * th0 * sc;
      float t1 = ein, t0 = 1.0 - eout;
      vec3 c = h9 < uKdColor * 0.01 ? kd_pal(fract(h9 * 7.31) * 0.857) : uKdInk;
      float d;
      if(type < 1.0){
        // 太い直線
        th *= 1.8;
        float s = lp.x + L * 0.5;
        d = abs(lp.y) - th;
        d = max(d, max(t0 * L - s, s - t1 * L));
      } else if(type < 2.0){
        // 細い平行線の束
        float m = 2.0 + floor(h3 * 4.0);
        float sp = th * (4.0 + 6.0 * h4);
        float k = clamp(floor(lp.y / sp + 0.5), -m * 0.5, m * 0.5);
        float s = lp.x + L * 0.5 + k * sp * 1.5;                      // 束の端は斜めにずれる
        d = abs(lp.y - k * sp) - th * 0.6;
        d = max(d, max(t0 * L - s, s - t1 * L));
      } else if(type < 3.0){
        // 円弧
        float R = L * 0.5;
        float ext = 1.5 + 3.5 * h3;
        float an = atan(lp.y, lp.x) + 3.14159;                          // 0..2π
        d = abs(length(lp) - R) - th;
        d = max(d, max((ext * t0 - an) * R, (an - ext * t1) * R));
      } else {
        // 波線
        float A = L * (0.04 + 0.08 * h3);
        float fr = 6.2832 * (2.0 + 3.0 * h4) / L;
        float s = lp.x + L * 0.5;
        float yy = lp.y - A * sin(lp.x * fr);
        d = abs(yy) / sqrt(1.0 + pow(A * fr * cos(lp.x * fr), 2.0)) - th;
        d = max(d, max(t0 * L - s, s - t1 * L));
      }
      float a = smoothstep(aa, -aa, d);
      col = mix(col, c, a);
      painted = max(painted, a);
    } else {
      // ── 点 ──
      float type = floor(h8 * 3.0);
      float r = sz * (0.006 + 0.022 * h7 * h7) * ein * eout;
      vec3 c = h9 < uKdColor * 0.01 + 0.2 ? kd_pal(fract(h9 * 5.17) * 0.857) : uKdInk;
      float d;
      if(type < 2.0){
        if(length(d0) > r * 2.5 + aa) continue;
        d = length(d0) - r;
        float a = smoothstep(aa, -aa, d);
        col = mix(col, c, a);
        painted = max(painted, a);
        if(type > 0.5){
          // 輪つきの点
          float rr = r * 1.8, ow = max(r * 0.18, aa);
          float ao = smoothstep(ow + aa, ow - aa, abs(length(d0) - rr));
          col = mix(col, uKdInk, ao);
          painted = max(painted, ao);
        }
      } else {
        // 点線 (一端から点が並んでいき、同じ向きに消える)
        float L = sz * (0.15 + 0.35 * h3);
        if(length(d0) > L) continue;
        float rd = sz * (0.004 + 0.006 * h4);
        float sp = rd * 3.5;
        float s = lp.x + L * 0.5;
        float k = clamp(floor(s / sp + 0.5), 0.0, floor(L / sp));
        float vis = step(k * sp, ein * L) * step((1.0 - eout) * L, k * sp);
        d = length(vec2(s - k * sp, lp.y)) - rd;
        float a = smoothstep(aa, -aa, d) * vis;
        col = mix(col, c, a);
        painted = max(painted, a);
      }
    }
  }

  // 紙と絵具のムラ
  if(uKdGrain > 0.0){
    float nz = kd_vn(q * 70.0) * 0.5 + kd_vn(q * 600.0) * 0.3 + kd_vn(q * 6.0) * 0.2;
    col *= 1.0 + (nz - 0.5) * 0.14 * uKdGrain * 0.01;
  }

  float al = 1.0 - (1.0 - painted) * uKdClear * 0.01;
  bgAlpha = al;
  return col * al;
}
