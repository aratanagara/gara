// =====================================================
// bg_bonetunnel  (H34)
//   Source: Shadertoy "Webby blobs" https://www.shadertoy.com/view/WlXfWS
//   (3lByWh と同じフラクタル SDF。Webby blobs では camera 経路で連結したノード網に見える)
//   表面マテリアルだけ骨らしい温白エナメルに変更。構造はオリジナルのまま。
// =====================================================

// ─── 負荷調整パラメータ (既定値は従来と同一の描画) ─────────────────────────
// @param uSteps 12..40 = 32
// @param uRibs  bool   = true
uniform float uSteps;       // レイマーチのステップ上限。下げると軽いが遠景の細部が溶ける
uniform float uRibs;        // 肋骨(尖った湾曲骨)。OFF で SDF 評価が減る (約 -17%)

#define bt_rot(spin) mat2(cos(spin),sin(spin),-sin(spin),cos(spin))

// ★ 構造スケール(大=骨が細かい/引き)。放射ワープの効き方もこの値で変わる。
#define BT_ZOOM 40.0
// ★ 2D ビューズーム(大=画を拡大/寄り)。構造は変えず画面中心を拡大するだけ。
#define BT_VIEWZOOM 0.25

const float BT_MIN_DIST  = 0.0;
const float BT_MAX_DIST  = 9.5;
const float BT_EPSILON   = 0.014;

// 3D ハッシュ(sin を使わない Dave Hoskins 系。sin×3 より大幅に軽い)
vec3 bt_hash3(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
vec3 bt_anchor(vec3 cellId, float cs){
  return (cellId + bt_hash3(cellId)) * cs;
}
float bt_smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0);
  return mix(b, a, h) - k*h*(1.0 - h);
}

// 長骨の骨幹: 端点 a-b を結ぶカプセルだが、中央が細く両端が膨らむ(骨らしい)。
// ts で太さを倍率調整(個体差)。
float bt_boneShaft(vec3 p, vec3 a, vec3 b, float ts){
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  vec3 c = a + ba * h;
  float rad = (0.07 + 0.08 * pow(abs(h - 0.5) * 2.0, 2.2)) * ts;
  return length(p - c) - rad;
}

// テーパーするセグメント(両端で半径が変わるカプセル)
float bt_segTaper(vec3 p, vec3 a, vec3 b, float ra, float rb){
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}

// 肋骨: 関節 a から二次ベジエで湾曲しながら伸び、先端で鋭く尖る。
float bt_rib(vec3 p, vec3 a, vec3 ctrl, vec3 endp){
  float d = 1e6;
  vec3 prev = a; float prevR = 0.14;
  for(int i = 1; i <= 2; i++){
    float t = float(i) / 2.0;
    vec3 c = mix(mix(a, ctrl, t), mix(ctrl, endp, t), t);
    float r = mix(0.14, 0.004, t*t);        // 先端へ向けて鋭く尖る
    d = min(d, bt_segTaper(p, prev, c, prevR, r));
    prev = c; prevR = r;
  }
  return d;
}

// 骨のスキャフォールド: 関節球(節)を骨幹で連結した 3D フレームワーク
float bt_boneScaffold(vec3 p){
  // === ザハ・ハディド風アーチ domain warp(強化) ===
  vec3 w = p;
  // アーチ天井: x 周期で大きく弓なりに持ち上げる(複数ヴォールト)
  float archL = 10.0;
  float arch  = abs(sin(p.x / archL * 3.14159265));
  w.y -= arch * 6.5;                                   // 大きなアーチ
  // z 方向に流れる大きなうねり
  w.y -= sin(p.z*0.10 + 0.5) * 2.2;
  w.x += cos(p.z*0.08) * 2.0 + sin(p.y*0.06)*1.2;
  // 進むほど大きくねじれる(パラメトリックスイープ)
  float tw = p.z*0.05 + sin(p.z*0.022)*0.6;
  float c = cos(tw), s = sin(tw);
  w.xy = mat2(c, -s, s, c) * w.xy;
  // 有機ゆらぎ
  w.z += cos(p.y*0.30) * 0.4;

  float cs = 3.4;                                    // 骨格セルサイズ(疎に = 骨の数を減らす)
  vec3 baseCell = floor(w / cs);
  float d = 1e9;
  // {-1,0} の 8 セルを評価(各セルの関節 + 前方 3 方向の骨幹)
  for(int dz = -1; dz <= 0; dz++)
  for(int dy = -1; dy <= 0; dy++)
  for(int dx = -1; dx <= 0; dx++){
    vec3 cellA   = baseCell + vec3(dx, dy, dz);
    vec3 a       = bt_anchor(cellA, cs);
    // 関節球: ハッシュで大小を強くジャンプ。少し間引いて SDF 評価を軽くする。
    float jh = bt_hash3(cellA + 13.0).x;
    if(jh > 0.22){
      float jr = mix(0.10, 0.85, jh*jh*jh);
      d = bt_smin(d, length(w - a) - jr, 0.10);
    }
    // 前方 2 方向の骨幹(+x/+z のみ)。ゲートを上げて本数を 2/3 に。
    vec2 dirs2[2];
    dirs2[0] = vec2(1.0, 0.0);    // +x
    dirs2[1] = vec2(0.0, 1.0);    // +z
    for(int k = 0; k < 2; k++){
      vec3 dir  = vec3(dirs2[k].x, 0.0, dirs2[k].y);
      vec3 seed = cellA + dir*0.5 + float(k)*7.0;
      float sh = bt_hash3(seed).x;
      if(sh > 0.68){                                  // ~32% だけ描画
        vec3 b  = bt_anchor(cellA + dir, cs);
        float ts = mix(0.5, 2.2, bt_hash3(seed + 3.0).y);  // 太さの個体差
        d = bt_smin(d, bt_boneShaft(w, a, b, ts), 0.10);
      }
    }
    // 肋骨: 一部の関節から鋭く尖って湾曲する骨を生やす(~10%)
    float rh = bt_hash3(cellA + 29.0).x;
    if(uRibs > 0.5 && rh > 0.90){
      vec3 rdir   = normalize(bt_hash3(cellA + 31.0) * 2.0 - 1.0);
      vec3 rcurve = (bt_hash3(cellA + 37.0) * 2.0 - 1.0);
      float rlen  = mix(1.6, 3.6, bt_hash3(cellA + 41.0).z);
      vec3 ctrl = a + rdir * rlen * 0.5 + rcurve * 0.9;
      vec3 endp = a + rdir * rlen       + rcurve * 1.8;   // 湾曲スイープ
      d = bt_smin(d, bt_rib(w, a, ctrl, endp), 0.08);
    }
  }
  return d;
}

// 値ノイズ + fbm(汚れ/シミ用)
float bt_vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f*f*(3.0 - 2.0*f);
  float n000 = bt_hash3(i + vec3(0,0,0)).x, n100 = bt_hash3(i + vec3(1,0,0)).x;
  float n010 = bt_hash3(i + vec3(0,1,0)).x, n110 = bt_hash3(i + vec3(1,1,0)).x;
  float n001 = bt_hash3(i + vec3(0,0,1)).x, n101 = bt_hash3(i + vec3(1,0,1)).x;
  float n011 = bt_hash3(i + vec3(0,1,1)).x, n111 = bt_hash3(i + vec3(1,1,1)).x;
  return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
             mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
}
float bt_fbm(vec3 p){
  return bt_vnoise(p)*0.64 + bt_vnoise(p*2.15+5.0)*0.36;
}

float bt_sceneSDF(vec3 p){
  // === 放射状ワープ(画面中心=z軸 から骨が放射状に広がる) ===
  float rad = length(p.xy) + 1e-4;
  vec2 rdir = p.xy / rad;
  vec3 pr = p;
  pr.xy += rdir * sin(rad*2.0 - p.z*0.10) * 0.55;   // 放射リブ
  pr.xy += rdir * rad * 0.14;                         // フレア(トランペット状に外へ開く)

  return bt_boneScaffold(pr * BT_ZOOM) / BT_ZOOM * 0.30;
}

// 石膏/骨のマット表面 — オフホワイトのベース + fbm による汚れ・シミ
vec3 bt_surface_color(vec3 p){
  // ベース: 石膏のオフホワイト(ごく僅かに暖色)
  vec3 base = vec3(0.84, 0.82, 0.78);

  // 大きな汚れムラ(経年の黄ばみ/グレーのシミ)
  float stain = bt_fbm(p * 0.45);
  vec3 stainCol = vec3(0.58, 0.54, 0.47);          // くすんだ土色
  base = mix(base, stainCol, smoothstep(0.45, 0.85, stain) * 0.45);

  // 細かな粒状の汚れ/孔(石膏の質感)
  float grain = bt_vnoise(p * 4.0);
  base *= mix(0.90, 1.04, grain);

  // ごく細かいスペックル
  base += (bt_vnoise(p * 9.0) - 0.5) * 0.03;

  return clamp(base, 0.0, 1.0);
}

float bt_shortestDistance(vec3 eye, vec3 dir, float start, float end){
  float depth = start;
  // 上限は uniform 依存にする (定数だと ANGLE がループを完全展開して重くなる)
  int steps = int(min(uSteps, resolution.x));
  for(int i = 0; i < steps; i++){
    float d = bt_sceneSDF(eye + depth * dir);
    if(d < 0.003 * (1.0 + depth * 0.12)){
      return depth;
    }
    depth += d * 0.72;         // 少し大きめに進めてステップ数を削る
    if(depth >= end) return end;
  }
  return end;
}

vec3 bt_rayDirection(float fovDeg, vec2 sz, vec2 fragCoord){
  vec2 xy = fragCoord - sz/2.0;
  float z = sz.y / tan(radians(fovDeg) / 2.0);
  return normalize(vec3(xy, -z));
}

// 法線(tetrahedron 技法 = 4 回評価。中心差分の 6 回より軽い。
//   3 タップ前方差分も試したが ANGLE では分岐が入って逆に遅く、見た目も変わるため採用せず)
vec3 bt_estimateNormal(vec3 p){
  const vec2 k = vec2(1.0, -1.0);
  const float h = BT_EPSILON;
  return normalize(
    k.xyy * bt_sceneSDF(p + k.xyy*h) +
    k.yyx * bt_sceneSDF(p + k.yyx*h) +
    k.yxy * bt_sceneSDF(p + k.yxy*h) +
    k.xxx * bt_sceneSDF(p + k.xxx*h));
}

// === エナメル質骨ライティング(eye 位置光源 + 多灯スペキュラ + 微 SSS) ===
vec3 bt_phongIllumination(vec3 ka, vec3 p, vec3 eye, vec3 rd){
  vec3 n = bt_estimateNormal(p);
  vec3 V = -rd;

  // 主光源 1: カメラ位置(基本)
  vec3 L1 = normalize(eye - p);
  // 主光源 2: 上方(エナメル質ハイライト)
  vec3 L2 = normalize(vec3(0.4, 1.0, 0.3));
  // フィル光源: 下方(柔らかい裏側)
  vec3 Lf = normalize(vec3(-0.3, -0.5, 0.2));

  float ndl1 = max(dot(n, L1), 0.0);
  float ndl2 = max(dot(n, L2), 0.0);
  float ndlf = max(dot(n, Lf), 0.0) * 0.45;

  // マットなスペキュラ(極めて控えめ。骨/象牙はほぼ無艶に近い)
  vec3 h1 = normalize(L1 + V);
  vec3 h2 = normalize(L2 + V);
  float spec1 = pow(max(dot(n, h1), 0.0), 20.0);     // 広く弱いハイライト
  float spec2 = pow(max(dot(n, h2), 0.0), 30.0);

  // 微 SSS(モノクロ寄り、ごく薄く)
  float sss = pow(1.0 - max(dot(n, L1), 0.0), 2.5)
            * pow(max(dot(rd, L1), 0.0), 1.2);
  vec3 sssCol = vec3(0.85) * sss * 0.20;

  // 縁の微フレネル
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);

  // 光量を正規化して白飛びを防ぐ(diffuse 寄与の合計を ~1 に収める)
  vec3 ambient = ka * 0.20;
  vec3 diff = ka * (ndl1 * 0.52
                  + ndl2 * 0.26
                  + ndlf * 0.14);
  vec3 col = ambient + diff
           + spec1 * vec3(1.0) * 0.05
           + spec2 * vec3(1.0) * 0.06
           + fres  * vec3(0.90) * 0.06
           + sssCol * 0.6;
  return col;
}

mat3 bt_viewMatrix(vec3 eye, vec3 center, vec3 up){
  vec3 f = normalize(center - eye);
  vec3 s = normalize(cross(f, up));
  vec3 u = cross(s, f);
  return mat3(s, u, -f);
}

vec3 bg_bonetunnel(vec2 fc){
  // BT_VIEWZOOM で 2D 拡大(画面中心を拡大)。bgZoom はアプリのズームツール。
  vec2 I = (fc - resolution*0.5) / max(bgZoom * BT_VIEWZOOM, 0.001) + resolution*0.5 + bgCamPx;

  // 引きの広い構図(FOV 広め)で、骨アーチ群が奥へ連なるのを見る
  vec3 viewDir = bt_rayDirection(64.0, resolution.xy, I);

  // カメラは BT_ZOOM から自動導出(速度・振幅は 1/BT_ZOOM 比例)
  float zs = 1.0 / BT_ZOOM;
  float t1 = time * 1.7 * zs;
  vec3 eye = vec3(sin(t1*0.10)*3.2*zs, (1.6 + sin(t1*0.07)*2.4)*zs, t1);

  // 進行方向(+z)を見る + 微小ドリフト
  vec3 target = eye + vec3(sin(t1*0.06)*2.1*zs, 0.0, 1.0);
  mat3 viewToWorld = bt_viewMatrix(eye, target, vec3(0.0, 1.0, 0.0));
  vec3 worldDir = viewToWorld * viewDir;

  float dist = bt_shortestDistance(eye, worldDir, BT_MIN_DIST, BT_MAX_DIST);

  // 背景(非ヒット=空洞の奥)= グレーの霞。真っ黒の空洞を避け奥行きを出す。
  if(dist > BT_MAX_DIST - BT_EPSILON){
    return vec3(0.22);
  }
  vec3 p = eye + dist * worldDir;
  vec3 ka = bt_surface_color(p * 1.48 * BT_ZOOM);   // テクスチャ周波数も BT_ZOOM 連動
  vec3 col = bt_phongIllumination(ka, p, eye, worldDir);
  // 大気遠近(短視程): 近距離から霞ませ中景を明るいグレーへ。フェードは短視程に合わせる。
  col = mix(col, vec3(0.62), smoothstep(1.0, 8.0, dist));
  return clamp(col, 0.0, 1.0);
}
