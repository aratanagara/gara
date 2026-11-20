// =====================================================
// bg_uniflash — ウニフラ (manga uni-flash)
//   驚きの瞬間に出るウニ状の放射バースト。棘は画面上のランダム位置へ
//   1 つずつポップし、少し留まって消える。内側は白塗り / 透明を選べる。
//   背景は黒 (vec3(0))、bgAlpha は線と塗りの実カバレッジ。
//   beat モードでは uBeat で出現を拍格子へ寄せ、iAudio でその拍を大きくする。
//   uPaper=100 で白地に黒インクの原稿モード (uInk は無視)。
// =====================================================

// @param uRate    0..100  = 40.0
// @param uCount   1..6    = 2.0
// @param uSizeLo  4..80   = 12.0
// @param uSizeHi  6..100  = 30.0
// @param uSpikes  8..96   = 42.0
// @param uJag     0..100  = 72.0
// @param uSharp   0..100  = 68.0
// @param uThick   4..100  = 36.0
// @param uPop     10..300 = 100.0
// @param uHold    0..100  = 55.0
// @param uFill    0..100  = 100.0
// @param uSeed    0..999  = 1.0
// @param uBeat    0..100  = 100.0
// @param uPaper   0..100  = 0.0
// @param uInk     color   = #ffffff
uniform float uRate;    // 出現レート (drone=回/秒、beat=拍あたり)
uniform float uCount;   // 同時に残す数
uniform float uSizeLo;  // 最小半径 (% 画面高)
uniform float uSizeHi;  // 最大半径 (% 画面高)
uniform float uSpikes;  // 棘の本数
uniform float uJag;     // 長さのばらつき / 角度の乱れ
uniform float uSharp;   // 先端の鋭さ
uniform float uThick;   // 線の太さ (×0.1 px)
uniform float uPop;     // 出現 / 消失の速さ
uniform float uHold;    // 留まっている割合
uniform float uFill;    // 内側の白塗り (0=透明)
uniform float uSeed;    // 乱数シード
uniform float uBeat;    // 拍同期 (beat モードで出現を拍に吸着 + 音で拡大)
uniform float uPaper;   // 原稿モード (白地に黒 %)
uniform vec3  uInk;     // 線の色

float uf_hash(float n){ return fract(sin(n * 127.1 + 311.7) * 43758.5453); }

mat2 uf_rot(float a){
  float c = cos(a), s = sin(a);
  return mat2(c, s, -s, c);
}

// 棘 1 層。q は中心からの y 単位座標。戻り値はインク 0..1。
float uf_rays(vec2 q, float ang0, float n, float len, float inner, float thickPx, float sharp, float jag, float seed, float zoomPx){
  float r = length(q);
  float lenMax = len * mix(1.0, 1.22, jag);
  if(r > lenMax + 3.0 / zoomPx) return 0.0;
  float sp = (atan(q.y, q.x) + ang0) / TAU * n;
  float si = floor(sp);
  float sf = fract(sp) - 0.5;
  float h = uf_hash(si * 17.13 + seed);
  float h2 = uf_hash(si * 9.71 + seed + 3.0);
  sf -= (h2 - 0.5) * jag * 0.55;
  // h*h で短い棘を多めにし、時々だけ長い棘が飛ぶ (ウニのシルエット)
  float lenS = len * mix(1.0, mix(0.22, 1.38, h * h), jag);
  float t = clamp((r - inner) / max(lenS - inner, 1e-4), 0.0, 1.0);
  float expo = mix(0.28, 2.4, sharp);
  float halfW = (thickPx / zoomPx) * 1.65 * pow(max(1.0 - t, 0.0), expo);
  float perp = abs(sf) * TAU * max(r, 1e-4) / n;
  float aa = 1.25 / zoomPx;
  float m = (1.0 - smoothstep(halfW, halfW + aa, perp));
  m *= 1.0 - smoothstep(lenS, lenS + aa, r);
  m *= smoothstep(inner - aa, inner + aa, r);
  return m;
}

float uf_clock(){
  float rate01 = clamp(uRate, 0.0, 100.0) / 100.0;
  float perSec = mix(0.18, 3.4, rate01);
  float clock = time * perSec;
  float sync = clamp(uBeat, 0.0, 100.0) / 100.0;
  float perBeat = mix(0.30, 2.0, rate01);
  float beatClock = getBeat() * perBeat;
  if(!isFree()) clock = mix(clock, beatClock, sync);
  return clock;
}

vec3 bg_uniflash(vec2 fc){
  float paper = clamp(uPaper, 0.0, 100.0) * 0.01;
  if(uRate <= 0.0){
    bgAlpha = paper;
    return vec3(paper);
  }

  vec2 I = (fc - resolution * 0.5) / max(bgZoom, 0.001) + resolution * 0.5 + bgCamPx;
  vec2 p = (I - 0.5 * resolution) / resolution.y;
  float zoomPx = resolution.y * max(bgZoom, 0.001);
  float aspect = resolution.x / max(resolution.y, 1.0);

  float seed = floor(uSeed + 0.5) + 1.0;
  float n = floor(clamp(uSpikes, 6.0, 96.0) + 0.5);
  float jag = clamp(uJag, 0.0, 100.0) / 100.0;
  float sharp = clamp(uSharp, 0.0, 100.0) / 100.0;
  float thickPx = max(uThick, 0.0) * 0.1;
  float fillAmt = clamp(uFill, 0.0, 100.0) / 100.0;
  float spd = clamp(uPop, 1.0, 300.0) / 100.0;
  float life = mix(0.82, 2.15, clamp(uHold, 0.0, 100.0) / 100.0);
  float inW = clamp(0.30 / spd, 0.045, 0.46);
  float outW = clamp(0.34 / spd, 0.05, 0.50);
  float span = inW + outW;
  if(span > 0.92){
    float k = 0.92 / span;
    inW *= k;
    outW *= k;
  }
  float holdEnd = 1.0 - outW;
  float lo = min(uSizeLo, uSizeHi);
  float hi = max(uSizeLo, uSizeHi);
  float sync = clamp(uBeat, 0.0, 100.0) / 100.0;
  float audio = clamp(iAudio, 0.0, 1.0) * sync;
  float count = clamp(floor(uCount + 0.5), 1.0, 6.0);
  float T = uf_clock();

  float ink = 0.0;
  float fill = 0.0;
  for(int i = 0; i < 6; i++){
    if(float(i) >= count) break;
    float id = floor(T) - float(i);
    if(id < 0.0) continue;
    float age = T - id;
    if(age >= life) continue;
    float u = age / life;
    float kk = clamp(u / inW, 0.0, 1.0);
    float ease = 1.0 - pow(1.0 - kk, 3.0);
    float fadeOut = smoothstep(holdEnd, 1.0, u);
    float alpha = min(smoothstep(0.0, inW, u), 1.0 - fadeOut);
    // 出現直後 / 消え際の細い輪だけが残って点に見えるのを避ける
    if(alpha < 0.18) continue;
    float sc = mix(0.22, 1.0, ease);
    sc *= 1.0 + 0.16 * sin(kk * PI) * (1.0 - kk);
    sc = mix(sc, sc * 1.08, fadeOut);
    sc *= 1.0 + audio * 0.45 * (0.35 + 0.65 * pow(1.0 - fract(getBeat()), 3.0));

    float h1 = uf_hash(id * 1.17 + seed);
    float h2 = uf_hash(id * 2.71 + seed + 4.2);
    float h3 = uf_hash(id * 4.91 + seed + 8.0);
    float h4 = uf_hash(id * 6.13 + seed + 2.5);
    float h5 = uf_hash(id * 8.41 + seed + 6.5);
    vec2 c = (vec2(h1, h2) - 0.5) * vec2(aspect * 0.76, 0.76);
    float sz = mix(lo, hi, h3) * 0.01;
    float ex = mix(0.80, 1.18, h4);
    float ey = mix(0.80, 1.18, h5);
    vec2 q = uf_rot(h3 * TAU) * ((p - c) / max(sc, 0.04));
    q = vec2(q.x / ex, q.y / ey);

    float coreR = sz * mix(0.20, 0.40, fillAmt);
    float inner = mix(sz * 0.015, coreR * 0.86, smoothstep(0.0, 0.25, fillAmt));
    float ray = uf_rays(q, 0.0, n, sz, inner, thickPx, sharp, jag, seed + id * 13.0, zoomPx);
    float n2 = max(6.0, floor(n * 0.5 + 0.5));
    float ray2 = uf_rays(q, PI / n2, n2, sz * mix(0.46, 0.68, h4), inner, thickPx * 1.25, sharp, jag, seed + id * 13.0 + 20.0, zoomPx);
    float disk = 1.0 - smoothstep(coreR, coreR + 1.35 / zoomPx, length(q));
    float ring = 1.0 - smoothstep(thickPx * 0.65, thickPx * 0.65 + 1.25, abs(length(q) - coreR) * zoomPx);
    ring *= fillAmt;

    ink = max(ink, max(max(ray, ray2), ring) * alpha);
    fill = max(fill, disk * alpha * fillAmt);
  }

  ink = clamp(ink, 0.0, 1.0);
  fill = clamp(fill, 0.0, 1.0);
  vec3 rgb = mix(vec3(fill), uInk, ink);
  float a = max(ink, fill);
  rgb = mix(rgb, mix(vec3(1.0), vec3(0.0), ink), paper);
  a = mix(a, 1.0, paper);
  bgAlpha = a;
  return rgb;
}
