// =====================================================
// Source : https://www.shadertoy.com/view/NfBGzd
// bg_metalSlab — Shadertoy NfBGzd 改変
//   ランダム直線で長方形を再分割していくアニメーションを、
//   ポップなテクスチャ/パレットを取り払って金属プレート調に。
// =====================================================
#define MS_C(a,b) ((a).x*(b).y-(a).y*(b).x)
#define MS_S(R, a) smoothstep(2.0/R.y, -2.0/R.y, a)
const int MS_MAXN = 12;

vec2 ms_center(vec2[MS_MAXN] P, int N){
  vec2 bl = vec2(1e5), tr = vec2(-1e5);
  for(int j = 0; j < MS_MAXN; j++){
    if(j >= N) break;
    bl = min(bl, P[j]);
    tr = max(tr, P[j]);
  }
  return (bl + tr) * 0.5;
}

float ms_sdPoly(in vec2[MS_MAXN] v, int N, in vec2 p){
  float d = dot(p-v[0], p-v[0]);
  float s = 1.0;
  for(int i = 0, j = MS_MAXN - 1; i < MS_MAXN; j = i, i++){
    if(i >= N){ break; }
    int jj = (i == 0) ? (N - 1) : (i - 1);
    vec2 e = v[jj] - v[i];
    vec2 w = p - v[i];
    vec2 b = w - e*clamp(dot(w,e)/dot(e,e), 0.0, 1.0);
    d = min(d, dot(b,b));
    bvec3 c = bvec3(p.y >= v[i].y, p.y < v[jj].y, e.x*w.y > e.y*w.x);
    if(all(c) || all(not(c))) s *= -1.0;
  }
  return s*sqrt(d);
}

// @param uDetail 1..5 = 5.0
// @param uThick 25..300 = 100.0
// @param uReflect 0..200 = 100.0
// @param uContrast 0..200 = 100.0
// @param uAngle -180..180 = 0.0
uniform float uDetail;   // 再分割の回数 (下げると大きな面が増え、軽い)
uniform float uThick;   // 破片の縁の線・光彩の太さ (%)
uniform float uReflect;   // 環境反射の強さ (%)
uniform float uContrast;   // 面内の明暗グラデの強さ (%)
uniform float uAngle;   // 向き (度。固定角でずらす)
// @param uBreakProb 0..180 = 100.0
// @param uSplitJitter  0..180   = 0.0
// @param uCutOffset 0..60 = 0.0
// @param uBigThreshold 25..300  = 100.0
// @param uToneSpread   0..200   = 100.0
// @param uWindowFreq   40..250  = 100.0
// @param uWindowWidth 20..200 = 100.0
// @param uShadow       0..100   = 100.0
// @param uShadowReach  20..300  = 100.0
// @param uGlint        0..250   = 100.0
// @param uWindowSecond 0..250   = 100.0
// @param uFresnel      0..200   = 100.0
uniform float uBreakProb; // 分割を途中でやめる確率 (%)。大きいほど大きな板が残る
uniform float uSplitJitter; // 切り線の向きのばらつき (度)
uniform float uCutOffset; // 切り線を中心からずらす量 (%)。板の大きさが不ぞろいになる
uniform float uBigThreshold; // 「大きな面」とみなす面積の基準 (%)
uniform float uToneSpread; // 板ごとの明るさのばらつき (%)
uniform float uWindowFreq; // 映り込む窓の筋の細かさ (%)
uniform float uWindowWidth; // 窓の筋の太さ (%)
uniform float uShadow; // 上の辺が落とす影の濃さ (%)
uniform float uShadowReach; // 影の幅 (%)
uniform float uGlint; // 面内の鋭い鏡面グリントの強さ (%)
uniform float uWindowSecond; // 2 本目の細い窓の筋の濃さ (%)
uniform float uFresnel; // 縁の環境反射の強さ (%)

// @param uCenterX -100..100 = 0.0
// @param uCenterY -100..100 = 0.0
// @param uMirrorX -100..100 = 0.0
// @param uPixelate 0..100 = 0.0
// @param uLightTurn -90..90 = 0.0
// @param uSheenGain 0..250 = 100.0
// @param uSheenSharp 40..250 = 100.0
// @param uBigGlow 0..250 = 100.0
// @param uRefractTint 0..300 = 100.0
// @param uPlateHue 0..100 = 0.0
// @param uGrooveDark 0..108 = 100.0
// @param uOutlineGlow 0..150 = 100.0
// @param uVignette 0..100 = 0.0
// @param uGrain 0..100 = 0.0
// @param uSilverTint color = #ffffff
// @param uSkyTint color = #ffffff
// @param uWindowTint color = #ffffff
// @param uEdgeTint color = #ffffff
uniform float uCenterX; // 板の配置を横へずらす (%)
uniform float uCenterY; // 板の配置を縦へずらす (%)
uniform float uMirrorX; // 左右の鏡像 (%)。正負で写す側が入れ替わり、大きさで軸が動く。0 で無効
uniform float uPixelate; // 座標のモザイク化 (%)。上げるほど板が階段状になる
uniform float uLightTurn; // 金属の指向光の向きを回す (度)
uniform float uSheenGain; // 明部の帯状ハイライトの強さ (%)
uniform float uSheenSharp; // 帯状ハイライトの鋭さ (%)。上げるほど細い帯
uniform float uBigGlow; // 大きな面だけに乗る強い光の強さ (%)
uniform float uRefractTint; // 窓の映り込みの色ずれ (%)
uniform float uPlateHue; // 板ごとの色づき (%)。板ごとに違う色相が乗る
uniform float uGrooveDark; // 縁の黒い溝線の濃さ (%)
uniform float uOutlineGlow; // 縁の白いぼかしの強さ (%)
uniform float uVignette; // 周辺減光 (%)
uniform float uGrain; // 粒状ノイズの量 (%)
uniform vec3 uSilverTint; // 銀色の色味 (掛け算のティント)
uniform vec3 uSkyTint; // 映り込む空の色味 (掛け算のティント)
uniform vec3 uWindowTint; // 窓の筋の色味 (掛け算のティント)
uniform vec3 uEdgeTint; // 縁の光の色味 (掛け算のティント)

vec3 bg_metalSlab(vec2 fc){
  vec2 R = resolution;
  vec2 u = (fc + fc - R) / R.y;

  // VJ ツール用 zoom / pan
  u = u / max(bgZoom, 0.001);
  u += bgCamPx / R.y * 2.0;
  if(uMirrorX != 0.0){ float ax = uMirrorX / 100.0 * 0.5; u.x = ax - sign(uMirrorX) * abs(u.x - ax); }
  if(uCenterX != 0.0 || uCenterY != 0.0){ vec2 pw = vec2(R.x / R.y, 1.0) * 1.05; u = mod(u + vec2(uCenterX, uCenterY) / 100.0 * 0.4 + pw, 2.0 * pw) - pw; }
  if(uPixelate != 0.0){ float pz = uPixelate / 100.0 * 0.12; u = (floor(u / pz) + 0.5) * pz; }

  float t = time * (bpm / 120.0) / 6.0;

  vec2 e = vec2(0.0);
  // 初期長方形は常にビューポート以上をカバー (外周の黒枠を完全に消す)
  // tanh アニメーションは t 経由の分割タイミングで保持
  vec2 p = vec2(R.x/R.y, 1.0) * 1.05;
  vec2[MS_MAXN] P = vec2[](
    vec2(-p.x,  p.y), vec2( p.x,  p.y),
    vec2( p.x, -p.y), vec2(-p.x, -p.y),
    e, e, e, e, e, e, e, e
  );
  int N = 4;
  float id = 0.0;

  for(float i = 1.0; i < 6.0; i++){   // 再分割回数を抑えて軽量化(8→5)
    if(i > uDetail + 0.5) break;
    vec2 c = ms_center(P, N);
    vec2 p0 = c;

    float a = 1.5*t*(hash11(id) > 0.5 ? 1.0 : -1.0) + radians(uAngle);
    if(uSplitJitter != 0.0) a += (hash11(id + 3.1) - 0.5) * radians(uSplitJitter);
    vec2 dir = vec2(cos(a), sin(a));
    if(uCutOffset != 0.0) p0 += vec2(-dir.y, dir.x) * (hash11(id + 7.7) - 0.5) * 0.5 * (uCutOffset / 100.0);

    int i0 = 0; vec2 q0 = vec2(0.0);
    for(int j = 0; j < MS_MAXN; j++){
      if(j >= N) break;
      vec2 aa = P[j], bb = P[(j+1) % MS_MAXN];
      float s = MS_C(dir, p0-aa) / MS_C(dir, bb-aa);
      if(s >= 0.0 && s < 1.0){ i0 = j; q0 = mix(aa, bb, s); break; }
    }

    int i1 = i0; vec2 q1 = q0;
    for(int j = 0; j < MS_MAXN; j++){
      if(j <= i0) continue;
      if(j >= N) break;
      // 原典どおり辺終点は N で巡回 (最終辺は P[0] に戻る)
      vec2 aa = P[j], bb = P[(j+1) % N];
      float s = MS_C(dir, p0-aa) / MS_C(dir, bb-aa);
      if(s >= 0.0 && s < 1.0){ i1 = j; q1 = mix(aa, bb, s); break; }
    }

    vec2[MS_MAXN] Q;
    if(MS_C(u-q0, q1-q0) < 0.0){
      int M = i1 - i0 + 2;
      Q[0] = q0;
      for(int j = 1; j < MS_MAXN; j++){
        if(j >= M - 1) break;
        Q[j] = P[i0 + j];
      }
      if(M - 1 >= 0 && M - 1 < MS_MAXN) Q[M - 1] = q1;
      N = M;
    } else {
      int M = N - (i1 - i0) + 2;
      Q[0] = q1;
      for(int j = 1; j < MS_MAXN; j++){
        if(j >= M - 1) break;
        Q[j] = P[(i1 + j) % N];
      }
      if(M - 1 >= 0 && M - 1 < MS_MAXN) Q[M - 1] = q0;
      N = M;
    }
    P = Q;

    id += MS_C(u-p0, dir) > 0.0 ? 1.0/i : -1.0/i;
    t += 1e2 * (hash11(id) - 0.5);

    // 元はパーリンノイズでブレイク確率を変調していたが、ハッシュのみに置換
    if(hash11(id + floor(t/1.5)) < 0.10 * (uBreakProb / 100.0)) break;
  }

  // === ガラス破片シェーディング (リアル寄り) ===
  float d1 = ms_sdPoly(P, N, u);

  float h  = hash11(id);
  float h3 = hash11(id + 91.7);

  // ベース: クールなシルバー。明度をプレート毎にバラつかせる
  float base = mix(0.40, 0.74, h);
  if(uToneSpread != 100.0) base = mix(0.57 - 0.17 * (uToneSpread / 100.0), 0.57 + 0.17 * (uToneSpread / 100.0), h);
  vec3 silver = vec3(0.92, 0.95, 1.04) * uSilverTint;   // 青み寄りのシルバー色
  vec3 plate = vec3(base) * silver;

  // メタリックグラデ: 光は図形の特定の辺に平行に差し込む。
  //   1 辺 (P[0]→P[1]) を選び、その法線方向に明暗ランプを作る
  //   = 等輝度の線がその辺と平行になり、回転しない静的な指向光になる。
  int   e1   = int(mod(floor(h3 * float(N)), float(N)));
  vec2  ea   = P[e1];
  vec2  eb   = P[(e1 + 1) % N];
  vec2  edge = normalize(eb - ea + vec2(1e-5));
  vec2  gDir = vec2(-edge.y, edge.x);          // 辺の法線 (明暗の変化方向)
  if(uLightTurn != 0.0){ float lt = radians(uLightTurn); gDir = mat2(cos(lt), -sin(lt), sin(lt), cos(lt)) * gDir; }
  vec2  pc   = ms_center(P, N);
  float gT   = clamp(0.5 + 0.5*dot(u - pc, gDir), 0.0, 1.0);
  // 暗→明のランプ (金属は暗部が締まり明部が伸びる)
  plate *= mix(mix(1.0, 0.55, uContrast / 100.0), mix(1.0, 1.15, uContrast / 100.0), smoothstep(0.0, 1.0, gT));
  // 明部側に鋭い鏡面ハイライト (辺に平行な帯)
  float pw6, pw3;
  if(uSheenSharp == 100.0){ pw6 = pow(gT, 6.0); pw3 = pow(gT, 3.0); }
  else { pw6 = pow(gT, 6.0 * (uSheenSharp / 100.0)); pw3 = pow(gT, 3.0 * (uSheenSharp / 100.0)); }
  plate += pw6 * silver * 0.55 * (uSheenGain / 100.0);
  // 一定以上の大きな面にだけ強い光を加える。
  //   面積 (shoelace) を測り、大きいほど強くハイライトする。
  float area = 0.0;
  for(int i = 0; i < MS_MAXN; i++){
    if(i >= N) break;
    vec2 va = P[i], vb = P[(i + 1) % N];
    area += va.x*vb.y - vb.x*va.y;
  }
  area = abs(area) * 0.5;
  float big = smoothstep(0.20 * (uBigThreshold / 100.0), 0.8 * (uBigThreshold / 100.0), area);   // 大きい面ほど 1
  // 明部側に大面積限定の強い指向ハイライト (辺に平行な帯)
  plate += big * pw3 * silver * 1.0 * (uBigGlow / 100.0);

  // === ガラス鏡面マテリアル: 面ごとの擬似環境反射 ===
  //   各破片を傾いたガラス/鏡面とみなし、面の向き(h,h3)で
  //   スタジオ環境(空〜床のグラデ + 窓のストリーク)を反射する。
  float refA   = h * 6.28318 + h3 * 3.14159;
  vec2  refDir = vec2(cos(refA), sin(refA));
  vec2  refT   = vec2(-refDir.y, refDir.x);
  vec2  rc     = u - pc;
  float vert   = clamp(0.5 + 0.7*dot(rc, refDir), 0.0, 1.0);   // 空(上)〜床(下)
  vec3  sky    = vec3(0.55, 0.62, 0.80) * uSkyTint;
  vec3  flr    = vec3(0.03, 0.04, 0.07);
  vec3  envCol = mix(flr, sky, vert);
  float s      = dot(rc, refT) * 7.0 * (uWindowFreq / 100.0) + h*12.0;                 // 窓ストリークの座標
  float win    = smoothstep(0.80 - 0.2 * ((uWindowWidth / 100.0) - 1.0), 1.0, sin(s))
               + 0.45*(uWindowSecond / 100.0)*smoothstep(0.5, 1.0, sin(s*0.33 + 1.7));
  envCol += win * vec3(1.05, 1.08, 1.16) * uWindowTint;
  // 反射率: 大面積ほど鏡面的、明部ほど反射が見える
  float refl   = (0.30 + 0.45*big) * (0.5 + 0.5*pow(gT, 1.5)) * (uReflect / 100.0);
  plate = mix(plate, envCol, clamp(refl, 0.0, 0.85));
  // 鋭い鏡面グリント (面内に数点)
  float glint  = smoothstep(0.93, 1.0, sin(s*1.3 + 0.5)) * smoothstep(0.55, 1.0, gT);
  plate += glint * (uGlint / 100.0) * vec3(1.10, 1.12, 1.22);
  // 屈折/色収差の薄いティント (青緑寄り)
  plate += win * vec3(-0.03, 0.012, 0.06) * (uRefractTint / 100.0);
  if(uPlateHue != 0.0) plate *= mix(vec3(1.0), 0.6 + 0.5 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67))), uPlateHue / 100.0);

  // 破片しか描画しない (背景は隣接する別プレートが必ず存在するので bg は不要)
  vec3 o = plate;

  // Fresnel: 縁ほど環境反射が強い (ガラスらしいエッジの照り)
  float fres = 1.0 - smoothstep(0.0, 0.06, -d1);   // 縁=1, 内側=0
  o = mix(o, envCol, clamp(fres * 0.40 * (uFresnel / 100.0), 0.0, 1.0));

  // === ガラスの輪郭(白) + 溝(黒い影) ===
  float ad = abs(d1);

  // 境界の外向き法線 (SDF 勾配)。上を向く辺 = その下に影が落ちる
  vec2 gN = vec2(dFdx(d1), dFdy(d1));
  gN = (length(gN) > 1e-6) ? normalize(gN) : vec2(0.0, 1.0);

  // (0) ドロップシャドウ: 上側の辺が下の破片に落とす影 (黒寄り)
  float shadeBand = smoothstep(0.055 * (uShadowReach / 100.0), 0.0, -d1);
  float downFace  = clamp(gN.y, 0.0, 1.0);
  o *= mix(1.0, 0.18, min(shadeBand * downFace * (uShadow / 100.0), 1.0));

  // (1) 境界まわりに白いぼかし (広めソフトな光彩)
  float lw = 100.0 / max(uThick, 1.0);
  float whiteBlur = exp(-ad * 320.0 * lw);
  o = mix(o, vec3(1.0) * uEdgeTint, min(whiteBlur * 0.85 * (uOutlineGlow / 100.0), 1.0));
  // (1b) その中心に細い黒線を乗せる (白ぼかし + 黒ライン)
  float blackLine = exp(-ad * 420.0 * lw);
  o *= 1.0 - blackLine * 0.92 * (uGrooveDark / 100.0);

  // (2) ガラスの白い輪郭: 溝の内側 (破片側) からにじむ光彩。
  //     鋭いバンドではなく内側へ滑らかに減衰させて発光ぎみに見せる
  float glow = exp(-max(-d1 - 0.004, 0.0) * 120.0) * smoothstep(0.0, -0.0025, -d1);
  o += glow * vec3(0.95, 0.98, 1.05) * 0.85;

  // (3) 輪郭の内側に広い白ぼかし (面光源のように内へ柔らかく拡散)
  float softGlow = exp(-max(-d1 - 0.004, 0.0) * 20.0) * smoothstep(0.0, -0.0025, -d1);
  o += softGlow * vec3(0.96, 0.98, 1.04) * 0.85;

  // ガラスとして半透明に: 本体 ~0.4、明るい輪郭/ハイライトほど濃く
  bgAlpha = clamp(0.42 + dot(clamp(o, 0.0, 1.0), vec3(0.299, 0.587, 0.114)) * 0.45, 0.0, 0.82);
  if(uVignette != 0.0){ vec2 vq = (fc * 2.0 - resolution) / resolution.y; o *= 1.0 - clamp(dot(vq, vq) * 0.35, 0.0, 1.0) * uVignette / 100.0; }
  if(uGrain != 0.0) o += (fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * uGrain / 100.0 * 0.6;
  return clamp(o, 0.0, 1.2);
}
