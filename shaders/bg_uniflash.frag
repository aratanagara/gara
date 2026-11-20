// =====================================================
// bg_uniflash — 漫画の吹き出しがポンポン出ては消える
//   形: 楕円 / もこもこ雲 / ギザギザ叫び (細かい・粗い) / ゆるい不定形 / 爆発 / ウニフラ。
//   しっぽ (話者を指す三角) は付けない。各吹き出しはスケールのオーバーシュートで
//   ポップ出現し、少し膨らんでから縮んで消える。時計は拍 (beat モード = 入力の拍、
//   drone モード = uBPM から作る拍) で、拍子頭で画面全体を反転フラッシュする。
//   背景は黒 (vec3(0))、bgAlpha は吹き出しの実カバレッジ。中の塗りは背景色、線は uInk。
//   uPaper=100 で白地に黒インクの原稿モード (uInk は無視)。
// =====================================================

// @param uRate    0..100  = 40.0  @desc 頻度。1 拍あたりに新しく出る吹き出しの数 (画面全体)。0 で何も出さない
// @param uCount   1..16   = 7.0   @desc 密度。同時に出せる吹き出しの最大数 (整数に丸める)
// @param uHold    0..100  = 45.0  @desc 寿命。1 つの吹き出しが出ている長さ (0.5〜8 拍)
// @param uPop     10..300 = 100.0 @desc 出現 / 消失の速さ。大きいほどポンと速く出て速く消える
// @param uSizeLo  4..60   = 12.0  @desc 大きさの最小 (画面高に対する %)
// @param uSizeHi  6..80   = 26.0  @desc 大きさの最大 (画面高に対する %)
// @param uAspLo   30..300 = 55.0  @desc 縦横比の最小 (横 / 縦 × 100。100 = 正円、小さいほど縦長)
// @param uAspHi   30..300 = 210.0 @desc 縦横比の最大 (横 / 縦 × 100。大きいほど横長)
// @param uTilt    0..45   = 10.0  @desc 傾きのばらつき (度)
// @param uWEllipse 0..100 = 50.0  @desc 楕円の出やすさ (形ごとの比率。全部 0 なら楕円だけ)
// @param uWCloud  0..100  = 50.0  @desc もこもこ雲形の出やすさ
// @param uWShoutF 0..100  = 50.0  @desc ギザギザ叫び (細かいトゲ) の出やすさ
// @param uWShoutC 0..100  = 40.0  @desc ギザギザ叫び (粗いトゲ) の出やすさ
// @param uWWavy   0..100  = 40.0  @desc ゆるく波打つ不定形の出やすさ
// @param uWBoom   0..100  = 40.0  @desc 太線の爆発形 (外向きの角 5〜7 本) の出やすさ
// @param uWUni    0..100  = 50.0  @desc ウニフラ (塗りつぶしの中心から細いトゲが放射) の出やすさ
// @param uThick   4..100  = 40.0  @desc 線幅 (1080p で ×0.1 px)。爆発形は 2.2 倍の太線
// @param uSpikes  6..64   = 26.0  @desc トゲ数。細かい叫びの本数。粗い叫びは 0.4 倍、ウニフラは 2.6 倍
// @param uSharp   0..100  = 60.0  @desc トゲの鋭さ。大きいほどトゲが深く細く尖る (叫び・爆発・ウニフラ)
// @param uBumps   5..24   = 11.0  @desc もこもこ数。雲形のふくらみの数 (整数に丸める)
// @param uFlash   0..100  = 55.0  @desc フラッシュ強さ。拍子頭で画面全体を反転して光らせる。0 で無し
// @param uFlashEvery 1..8 = 1.0   @desc フラッシュの間隔 (何拍ごと。整数に丸める)
// @param uFill    0..100  = 100.0 @desc 吹き出しの中の塗り (背景色)。0 で中が透けて線だけ
// @param uSeed    0..999  = 1.0   @desc 乱数シード
// @param uPaper   0..100  = 0.0   @desc 原稿モード。白地に黒インク (%)
// @param uInk     color   = #ffffff @desc 線とウニフラの色 (原稿モードでは黒)
uniform float uRate;
uniform float uCount;
uniform float uHold;
uniform float uPop;
uniform float uSizeLo;
uniform float uSizeHi;
uniform float uAspLo;
uniform float uAspHi;
uniform float uTilt;
uniform float uWEllipse;
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
uniform float uFlash;
uniform float uFlashEvery;
uniform float uFill;
uniform float uSeed;
uniform float uPaper;
uniform vec3  uInk;

float uf_h(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float uf_easeOutBack(float t){
  float c1 = 2.4;
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

// 1 セル = トゲ 1 本。谷 (セルの端) は 0、頂点 k0 で 1 の三角形。k は -0.5..0.5
float uf_tri(float k, float k0){
  return k < k0 ? (k + 0.5) / (k0 + 0.5) : (0.5 - k) / (0.5 - k0);
}

// 輪郭の半径 R(θ) (楕円で正規化した空間、外側の最大がおよそ 1)。
// shape: 0=楕円 1=雲 2=叫び細 3=叫び粗 4=不定形 5=爆発 6=ウニフラ
float uf_R(int shape, float th, float s, float sharp, float nSpk, float nBump, float wob){
  if(shape == 0) return 1.0;
  float a = th / TAU + 0.5;   // 0..1 (±π の継ぎ目でセル番号が回り込む)
  if(shape == 1){
    float n = nBump;
    float sp = fract(a + s) * n;
    float ci = floor(sp);
    float k = sp - ci - 0.5;
    float amp = clamp(1.7 / n, 0.08, 0.26) * mix(0.75, 1.15, uf_h(vec2(ci, s * 91.0)));
    return 1.0 - amp + amp * sqrt(max(1.0 - 4.0 * k * k, 0.0));
  }
  if(shape == 2 || shape == 3){
    bool coarse = shape == 3;
    float n = coarse ? max(5.0, floor(nSpk * 0.4 + 0.5)) : nSpk;
    float sp = fract(a + s) * n;
    float ci = floor(sp);
    float k = sp - ci - 0.5;
    float h1 = uf_h(vec2(ci, s * 57.0));
    float h2 = uf_h(vec2(ci + 31.0, s * 57.0));
    float k0 = (h1 - 0.5) * (coarse ? 0.6 : 0.3);
    float lj = coarse ? mix(0.45, 1.0, h2) : mix(0.75, 1.0, h2);
    float depth = coarse ? mix(0.2, 0.45, sharp) : mix(0.08, 0.24, sharp);
    float prof = pow(uf_tri(k, k0), mix(1.0, 2.0, sharp));
    return 1.0 - depth + depth * lj * prof;
  }
  if(shape == 4){
    float p = s * TAU;
    return 0.9 + 0.055 * sin(th * 2.0 + p * 3.0 + wob)
               + 0.045 * sin(th * 3.0 + p * 5.0 - wob * 0.7)
               + 0.025 * sin(th * 5.0 + p * 7.0 + wob * 1.3);
  }
  if(shape == 5){
    float n = 5.0 + floor(uf_h(vec2(s * 13.0, 7.0)) * 2.999);
    float sp = fract(a + s) * n;
    float ci = floor(sp);
    float k = sp - ci - 0.5;
    float h1 = uf_h(vec2(ci, s * 33.0));
    float h2 = uf_h(vec2(ci + 17.0, s * 33.0));
    float k0 = (h1 - 0.5) * 0.4;
    float depth = mix(0.38, 0.56, sharp);
    float prof = pow(uf_tri(k, k0), mix(1.8, 3.0, sharp));
    return 1.0 - depth + depth * mix(0.78, 1.0, h2) * prof;
  }
  // ウニフラ: 長短ランダムの細いトゲ (層 A) の谷を短いトゲ (層 B) で埋め、
  // 輪郭を全周トゲだけにする (丸い弧を出さない)
  float core = 0.36;
  float nA = floor(nSpk * 2.6 + 0.5);
  float spA = fract(a + s) * nA;
  float ciA = floor(spA);
  float kA = spA - ciA - 0.5;
  float hA = uf_h(vec2(ciA, s * 71.0));
  float hA2 = uf_h(vec2(ciA + 41.0, s * 71.0));
  float lenA = mix(0.18, 1.0, pow(hA, 1.4)) * (1.0 - core);
  float rA = core + lenA * pow(uf_tri(kA, (hA2 - 0.5) * 0.3), mix(1.0, 2.6, sharp));
  float nB = floor(nA * 1.7 + 0.5);
  float spB = fract(a + s + 0.37 / nA) * nB;
  float ciB = floor(spB);
  float kB = spB - ciB - 0.5;
  float hB = uf_h(vec2(ciB + 13.0, s * 29.0));
  float rB = core + mix(0.08, 0.26, hB) * (1.0 - core) * uf_tri(kB, 0.0);
  return max(rA, rB);
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

  if(uRate > 0.0){
    float seed = floor(uSeed + 0.5);
    float count = clamp(floor(uCount + 0.5), 1.0, 16.0);
    int iCount = int(count);
    float perBeat = mix(0.25, 4.0, clamp(uRate, 0.0, 100.0) * 0.01);
    float L = mix(0.5, 8.0, pow(clamp(uHold, 0.0, 100.0) * 0.01, 1.5));
    float P = max(L * 1.05, count / perBeat);
    float spd = clamp(uPop, 1.0, 300.0) * 0.01;
    float inD = min(0.4 / spd, L * 0.45);
    float outD = min(0.32 / spd, L * 0.45);
    float lo = min(uSizeLo, uSizeHi) * 0.01;
    float hi = max(uSizeLo, uSizeHi) * 0.01;
    float aLo = log(max(min(uAspLo, uAspHi), 1.0) * 0.01);
    float aHi = log(max(max(uAspLo, uAspHi), 1.0) * 0.01);
    float sharp = clamp(uSharp, 0.0, 100.0) * 0.01;
    float nSpk = floor(clamp(uSpikes, 6.0, 64.0) + 0.5);
    float nBump = floor(clamp(uBumps, 5.0, 24.0) + 0.5);
    float hw0 = 0.5 * max(uThick, 0.0) * 0.1 * zoomPx / 1080.0;
    float fillAmt = clamp(uFill, 0.0, 100.0) * 0.01;
    float w0 = max(uWEllipse, 0.0);
    float w1 = max(uWCloud, 0.0);
    float w2 = max(uWShoutF, 0.0);
    float w3 = max(uWShoutC, 0.0);
    float w4 = max(uWWavy, 0.0);
    float w5 = max(uWBoom, 0.0);
    float w6 = max(uWUni, 0.0);
    float wSum = w0 + w1 + w2 + w3 + w4 + w5 + w6;

    for(int i = 0; i < iCount; i++){
      float fi = float(i);
      float T = B + uf_h(vec2(fi * 7.31 + 3.0, seed + 0.5)) * P;
      float cyc = floor(T / P);
      float age = T - cyc * P - uf_h(vec2(cyc, fi * 3.7 + seed * 1.3)) * (P - L);
      if(age < 0.0 || age >= L) continue;

      float sIn = uf_easeOutBack(clamp(age / inD, 0.0, 1.0));
      float xOut = clamp((L - age) / outD, 0.0, 1.0);
      float sc = sIn * uf_easeOutBack(xOut);
      float alpha = smoothstep(0.0, 0.45, xOut);
      if(sc < 0.03 || alpha <= 0.0) continue;

      vec2 key = vec2(cyc * 1.618 + fi * 11.0, seed);
      float h1 = uf_h(key + 0.11);
      float h2 = uf_h(key + 0.23);
      float h3 = uf_h(key + 0.37);
      float h4 = uf_h(key + 0.49);
      float h5 = uf_h(key + 0.61);
      float h6 = uf_h(key + 0.73);

      int shape = 0;
      if(wSum > 0.0){
        float pick = h6 * wSum;
        float acc = w0;
        if(pick >= acc){ shape = 1; acc += w1; }
        if(pick >= acc){ shape = 2; acc += w2; }
        if(pick >= acc){ shape = 3; acc += w3; }
        if(pick >= acc){ shape = 4; acc += w4; }
        if(pick >= acc){ shape = 5; acc += w5; }
        if(pick >= acc){ shape = 6; }
      }

      float sz = mix(lo, hi, h3) * (shape == 6 ? 1.35 : 1.0);
      float asp = exp(mix(aLo, aHi, h4));
      vec2 rad = sz * vec2(sqrt(asp), 1.0 / sqrt(asp));
      vec2 c = (vec2(h1, h2) - 0.5) * vec2(aspect * 0.82, 0.78);
      float tilt = (h5 - 0.5) * 2.0 * radians(clamp(uTilt, 0.0, 45.0));
      float cs = cos(tilt), sn = sin(tilt);
      vec2 d = (p - c) / sc;
      d = vec2(cs * d.x + sn * d.y, -sn * d.x + cs * d.y);
      vec2 e = d / rad;
      float r = length(e);
      if(r > 1.12) continue;

      float th = atan(e.y, e.x);
      float s = h5 * 0.917 + h6 * 0.31;
      float wob = age * 1.4;
      float R = uf_R(shape, th, s, sharp, nSpk, nBump, wob);
      // R'(θ) は左右の片側差分の小さい方 (谷・角をまたぐ差分が跳ねて、内側に放射状の線が出るのを防ぐ)
      float dt = 0.0015;
      float Rp = min(abs(uf_R(shape, th + dt, s, sharp, nSpk, nBump, wob) - R),
                     abs(R - uf_R(shape, th - dt, s, sharp, nSpk, nBump, wob))) / dt;
      // 楕円空間の半径差 → 画面の法線距離 (px)。傾きの補正は輪郭上 (r≈R) の値で取り、中心で発散させない
      vec2 dir = vec2(cos(th), sin(th));
      float g = length(dir / rad) * sqrt(1.0 + (Rp * Rp) / max(R * R, 1e-6));
      float dpx = (r - R) / g * sc * zoomPx;

      float inside = clamp(0.5 - dpx, 0.0, 1.0);
      if(shape == 6){
        float cov = inside * alpha;
        rgb = mix(rgb, inkCol, cov);
        a = mix(a, 1.0, cov);
      } else {
        float hw = hw0 * (shape == 5 ? 2.2 : 1.0) * max(sc, 0.3);
        float inner = clamp(0.5 - (dpx + 2.0 * hw), 0.0, 1.0);
        float covFill = inner * alpha * fillAmt;
        float covLine = (inside - inner) * alpha;
        rgb = mix(rgb, fillCol, covFill);
        a = mix(a, 1.0, covFill);
        rgb = mix(rgb, inkCol, covLine);
        a = mix(a, 1.0, covLine);
      }
    }
  }

  // 拍子頭のフラッシュ: 画面全体を反転 (黒地なら白地に黒線の原稿、原稿なら黒地に白線)
  float every = clamp(floor(uFlashEvery + 0.5), 1.0, 8.0);
  float flash = clamp(uFlash, 0.0, 100.0) * 0.01 * pow(1.0 - fract(max(B, 0.0) / every), 6.0);
  rgb = mix(rgb, vec3(1.0) - rgb, flash);
  a = mix(a, 1.0, flash);

  bgAlpha = a;
  return rgb;
}
