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

vec3 bg_metalSlab(vec2 fc){
  vec2 R = resolution;
  vec2 u = (fc + fc - R) / R.y;

  // VJ ツール用 zoom / pan
  u = u / max(bgZoom, 0.001);
  u += bgCamPx / R.y * 2.0;

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
    vec2 c = ms_center(P, N);
    vec2 p0 = c;

    float a = 1.5*t*(hash11(id) > 0.5 ? 1.0 : -1.0);
    vec2 dir = vec2(cos(a), sin(a));

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
    if(hash11(id + floor(t/1.5)) < 0.10) break;
  }

  // === ガラス破片シェーディング (リアル寄り) ===
  float d1 = ms_sdPoly(P, N, u);

  float h  = hash11(id);
  float h3 = hash11(id + 91.7);

  // ベース: クールなシルバー。明度をプレート毎にバラつかせる
  float base = mix(0.40, 0.74, h);
  vec3 silver = vec3(0.92, 0.95, 1.04);   // 青み寄りのシルバー色
  vec3 plate = vec3(base) * silver;

  // メタリックグラデ: 光は図形の特定の辺に平行に差し込む。
  //   1 辺 (P[0]→P[1]) を選び、その法線方向に明暗ランプを作る
  //   = 等輝度の線がその辺と平行になり、回転しない静的な指向光になる。
  int   e1   = int(mod(floor(h3 * float(N)), float(N)));
  vec2  ea   = P[e1];
  vec2  eb   = P[(e1 + 1) % N];
  vec2  edge = normalize(eb - ea + vec2(1e-5));
  vec2  gDir = vec2(-edge.y, edge.x);          // 辺の法線 (明暗の変化方向)
  vec2  pc   = ms_center(P, N);
  float gT   = clamp(0.5 + 0.5*dot(u - pc, gDir), 0.0, 1.0);
  // 暗→明のランプ (金属は暗部が締まり明部が伸びる)
  plate *= mix(0.55, 1.15, smoothstep(0.0, 1.0, gT));
  // 明部側に鋭い鏡面ハイライト (辺に平行な帯)
  plate += pow(gT, 6.0) * silver * 0.55;
  // 一定以上の大きな面にだけ強い光を加える。
  //   面積 (shoelace) を測り、大きいほど強くハイライトする。
  float area = 0.0;
  for(int i = 0; i < MS_MAXN; i++){
    if(i >= N) break;
    vec2 va = P[i], vb = P[(i + 1) % N];
    area += va.x*vb.y - vb.x*va.y;
  }
  area = abs(area) * 0.5;
  float big = smoothstep(0.20, 0.8, area);   // 大きい面ほど 1
  // 明部側に大面積限定の強い指向ハイライト (辺に平行な帯)
  plate += big * pow(gT, 3.0) * silver * 1.0;

  // === ガラス鏡面マテリアル: 面ごとの擬似環境反射 ===
  //   各破片を傾いたガラス/鏡面とみなし、面の向き(h,h3)で
  //   スタジオ環境(空〜床のグラデ + 窓のストリーク)を反射する。
  float refA   = h * 6.28318 + h3 * 3.14159;
  vec2  refDir = vec2(cos(refA), sin(refA));
  vec2  refT   = vec2(-refDir.y, refDir.x);
  vec2  rc     = u - pc;
  float vert   = clamp(0.5 + 0.7*dot(rc, refDir), 0.0, 1.0);   // 空(上)〜床(下)
  vec3  sky    = vec3(0.55, 0.62, 0.80);
  vec3  flr    = vec3(0.03, 0.04, 0.07);
  vec3  envCol = mix(flr, sky, vert);
  float s      = dot(rc, refT) * 7.0 + h*12.0;                 // 窓ストリークの座標
  float win    = smoothstep(0.80, 1.0, sin(s))
               + 0.45*smoothstep(0.5, 1.0, sin(s*0.33 + 1.7));
  envCol += win * vec3(1.05, 1.08, 1.16);
  // 反射率: 大面積ほど鏡面的、明部ほど反射が見える
  float refl   = (0.30 + 0.45*big) * (0.5 + 0.5*pow(gT, 1.5));
  plate = mix(plate, envCol, clamp(refl, 0.0, 0.85));
  // 鋭い鏡面グリント (面内に数点)
  float glint  = smoothstep(0.93, 1.0, sin(s*1.3 + 0.5)) * smoothstep(0.55, 1.0, gT);
  plate += glint * vec3(1.10, 1.12, 1.22);
  // 屈折/色収差の薄いティント (青緑寄り)
  plate += win * vec3(-0.03, 0.012, 0.06);

  // 破片しか描画しない (背景は隣接する別プレートが必ず存在するので bg は不要)
  vec3 o = plate;

  // Fresnel: 縁ほど環境反射が強い (ガラスらしいエッジの照り)
  float fres = 1.0 - smoothstep(0.0, 0.06, -d1);   // 縁=1, 内側=0
  o = mix(o, envCol, fres * 0.40);

  // === ガラスの輪郭(白) + 溝(黒い影) ===
  float ad = abs(d1);

  // 境界の外向き法線 (SDF 勾配)。上を向く辺 = その下に影が落ちる
  vec2 gN = vec2(dFdx(d1), dFdy(d1));
  gN = (length(gN) > 1e-6) ? normalize(gN) : vec2(0.0, 1.0);

  // (0) ドロップシャドウ: 上側の辺が下の破片に落とす影 (黒寄り)
  float shadeBand = smoothstep(0.055, 0.0, -d1);
  float downFace  = clamp(gN.y, 0.0, 1.0);
  o *= mix(1.0, 0.18, shadeBand * downFace);

  // (1) 境界まわりに白いぼかし (広めソフトな光彩)
  float whiteBlur = exp(-ad * 320.0);
  o = mix(o, vec3(1.0), whiteBlur * 0.85);
  // (1b) その中心に細い黒線を乗せる (白ぼかし + 黒ライン)
  float blackLine = exp(-ad * 420.0);
  o *= 1.0 - blackLine * 0.92;

  // (2) ガラスの白い輪郭: 溝の内側 (破片側) からにじむ光彩。
  //     鋭いバンドではなく内側へ滑らかに減衰させて発光ぎみに見せる
  float glow = exp(-max(-d1 - 0.004, 0.0) * 120.0) * smoothstep(0.0, -0.0025, -d1);
  o += glow * vec3(0.95, 0.98, 1.05) * 0.85;

  // (3) 輪郭の内側に広い白ぼかし (面光源のように内へ柔らかく拡散)
  float softGlow = exp(-max(-d1 - 0.004, 0.0) * 20.0) * smoothstep(0.0, -0.0025, -d1);
  o += softGlow * vec3(0.96, 0.98, 1.04) * 0.85;

  // ガラスとして半透明に: 本体 ~0.4、明るい輪郭/ハイライトほど濃く
  bgAlpha = clamp(0.42 + dot(clamp(o, 0.0, 1.0), vec3(0.299, 0.587, 0.114)) * 0.45, 0.0, 0.82);
  return clamp(o, 0.0, 1.2);
}
