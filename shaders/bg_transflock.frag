// =====================================================
// bg_transflock  (Transmute Flock / 錬成痕フロック)
//   大量の矩形フラグメント(錬成痕のような破片)が 3D 空間の軌道上に群れをつくり、
//   鳥の群れのようにゆっくり旋回しながら流れていく。線画(輪郭)主体。
//
//   仕組み — ピクセルあたり O(軌道数 × 9セル) で「無限の破片」を透視投影する:
//     1. 各軌道は 3D 空間に置いた傾いた平面上の楕円。破片もその面に乗っている。
//        面 → スクリーン はホモグラフィ (3x3) なので、M = [U V O] の逆行列で
//        ピクセル → 面座標 を解析的に戻せる。ピンホール: screen = F * P.xy / P.z。
//     2. 面座標で (u = 周回方向, v = 法線方向) のセル格子に刻み、ピクセルの属するセルと
//        その周囲 3×3 だけを調べる。セル ID のハッシュで破片の有無/ジッタ/サイズを決める
//        (= 破片の配列を持たずに済む)。
//     3. セル中心と破片の2軸を 3D のまま投影し、投影された平行四辺形の中で当たり判定する。
//        → 遠い破片は小さく薄く、面が寝ていれば潰れて見える = 奥行きが出る。
//     4. u は周回で mod を取るので継ぎ目が出ない。u を時間で流す = 破片が軌道上を流れる。
//        面の向き(タンブル)と中心をゆっくり動かす = 群れ全体が旋回する。
//   粗(大きい破片) + 細(小さい破片) の 2 レイヤを同じ軌道に重ねてサイズの散らばりを作る。
//
//   Slot A では uPaper を下地に敷いた不透明出力、Slot B では線の被覆を alpha にした透過出力
//   (この装置の透過シェーダ共通の作法)。uPaper を白にすれば「紙の上の錬成痕」、
//   既定の黒なら暗闇に発光する破片群になる。
// =====================================================

// @param uOrbits  1..5   = 4
// @param uFlow    0..300 = 100
// @param uSwirl   0..300 = 100
// @param uDensity 0..1   = 0.62
// @param uClump   0..1   = 0.6
// @param uSpread  0.2..3 = 1.0
// @param uGrain   0.3..3 = 1.0
// @param uLine    0.2..3 = 0.9
// @param uFill    0..1   = 0.0
// @param uTrail   0..1   = 0.12
// @param uWobble  0..2   = 1.0
// @param uTilt    0..1   = 0.3
// @param uPersp   0.3..2 = 1.0
// @param uDepth   0..1   = 0.6
// @param uDetail  bool   = true
// @param uAudio   0..2   = 1.0
// @param uInk     color  = #e9eef2
// @param uPaper   color  = #000000
uniform float uOrbits;    // 軌道(群れ)の本数。減らすと軽い
uniform float uFlow;      // 破片が軌道上を流れる速さ (%)
uniform float uSwirl;     // 群れ全体が旋回/タンブルする速さ (%)
uniform float uDensity;   // 破片の密度
uniform float uClump;     // 塊と隙間のムラ (0=均一に散る / 1=群れが固まる)
uniform float uSpread;    // 群れの幅 (軌道からどれだけ外側まで散るか)
uniform float uGrain;     // 破片の大きさ (セルの粗さ)
uniform float uLine;      // 輪郭線の太さ (px)
uniform float uFill;      // 塗りつぶし量 (0=輪郭だけ)
uniform float uTrail;     // 軌道そのものを薄い線で見せる量
uniform float uWobble;    // 軌道の波打ち (0=きれいな楕円)
uniform float uTilt;      // 破片ごとの面内回転 (0=進行方向に揃う / 1=バラバラ)
uniform float uPersp;     // 遠近の強さ (小=望遠で平面的 / 大=広角で奥行きが強い)
uniform float uDepth;     // 奥行きによる減衰 (遠い破片を薄く)
uniform float uDetail;    // 細かい破片レイヤ (bool)
uniform float uAudio;     // 音の効き (破片が増えて膨らむ)
uniform vec3  uInk;       // 線の色 (Cos Grad を上げるとパレットが優先)
uniform vec3  uPaper;     // Slot A のときの下地 (紙) の色。Slot B では透過して下の A が出る

#define TF_TAU 6.2831853
#define TF_EYE 3.2        // 群れの基準奥行き (カメラは原点、+z を見る)

// セル ID → 乱数4つ。sin ベースのハッシュは ID が大きくなると float32 で精度が崩れ、
// ちょうど 0.0 を返して「確率ゼロのセル」まで描いてしまう (軌道から遠い迷子の破片になる)。
// 乗算+fract 系 (Hoskins hash42) は ID が大きくても安定。
vec4 tf_h4(vec2 p){
  vec4 q = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  q += dot(q, q.wzxy + 33.33);
  return fract((q.xxyz + q.yzzw) * q.zywx);
}
vec3 tf_h3(float n){ return fract(sin(vec3(n*12.9898, n*78.233, n*37.719)) * 43758.5453); }

// X→Y→Z の順に回転
vec3 tf_rot3(vec3 p, vec3 a){
  float cx = cos(a.x), sx = sin(a.x); p = vec3(p.x, cx*p.y - sx*p.z, sx*p.y + cx*p.z);
  float cy = cos(a.y), sy = sin(a.y); p = vec3(cy*p.x + sy*p.z, p.y, -sy*p.x + cy*p.z);
  float cz = cos(a.z), sz = sin(a.z); p = vec3(cz*p.x - sz*p.y, sz*p.x + cz*p.y, p.z);
  return p;
}

float tfTint;    // 最後に採用した破片の色パラメータ (0..1)

// 軌道の波打ち。角度だけの関数にしてあるので (角度 ↔ 半径) の逆写像が崩れない。
float tf_wob(float ang, vec3 w){
  return 1.0 + w.x * (sin(3.0*ang + w.y) * 0.6 + sin(5.0*ang - w.z) * 0.4);
}
// 楕円パラメータ角 ang における 面上スケール。x=半径方向 / y=周回(接線)方向
vec2 tf_scale(float ang, vec2 rad){
  float ca = cos(ang), sa = sin(ang);
  return vec2(length(vec2(rad.x*ca, rad.y*sa)), length(vec2(-rad.x*sa, rad.y*ca)));
}

// 1 軌道 × 1 レイヤぶんの破片を描く。戻り値 = 線の被覆 0..1
//   O/U/V = 軌道面 (原点と直交2軸、3D)、rad = 面内の楕円半径、flow = 周回方向の流れ(セル単位)
float tf_cells(vec2 p, vec3 O, vec3 U, vec3 V, vec2 rad, float flow, vec3 wob,
               float cell, float dens, float spread, float sizeMul,
               float seed, float px, float au, float fcl){
  // ピクセル → 面座標 (ホモグラフィの逆): M=[U V O] として M*(x,y,1) ∝ 視線ベクトル
  vec3 dir = vec3(p / fcl, 1.0);
  vec3 r0 = cross(V, O), r1 = cross(O, U), r2 = cross(U, V);
  float det = dot(U, r0);
  if(abs(det) < 1e-5) return 0.0;                        // 面を真横から見ている
  vec3 q = vec3(dot(r0, dir), dot(r1, dir), dot(r2, dir));
  if(q.z * det <= 0.0) return 0.0;                       // カメラの後ろ側
  vec2 pl = q.xy / q.z;                                  // 面座標

  float meanRad = 0.5 * (rad.x + rad.y);
  float NU = max(8.0, floor(TF_TAU * meanRad / cell));   // 周回方向のセル数 (整数 → 継ぎ目なし)
  // 楕円を単位円へ正規化してから極座標に。角度と半径を同じ空間で取らないと
  // 逆写像とズレて破片が軌道から外れて散らばる (扁平なほどズレる)。
  vec2  e2d  = pl / rad;
  float ang0 = atan(e2d.y, e2d.x);
  float rr   = length(e2d) / tf_wob(ang0, wob);          // 1.0 = 軌道上 (波打ちを戻す)
  float u    = ang0 * NU / TF_TAU + flow;
  // 帯の幅は面上で一定にしたい。楕円は角度で半径方向のスケールが変わるのでその場の値で正規化。
  float v    = (rr - 1.0) * tf_scale(ang0, rad).x / cell;

  float lw = max(uLine, 0.05) * px * 0.5;                // 線の太さ(半幅)。画面 px 固定 = 製図の線
  float aa = 0.7 * px;
  float cov = 0.0;
  for(int du = -1; du <= 1; du++){
    for(int dv = -1; dv <= 1; dv++){
      float iu = floor(u) + float(du);
      float iv = floor(v) + float(dv);
      vec4  h  = tf_h4(vec2(mod(iu, NU), iv) + seed);    // mod で周回の継ぎ目をなくす
      // 群れの濃淡: 軌道ぞいの 2 セルは密、そこから急に疎 (離れるほど "はぐれ破片" になる)
      float band  = exp(-2.6 * max(abs(iv + 0.5) - 0.5, 0.0) / max(spread, 0.2));
      float clump = mix(1.0, 0.5 + 0.5*sin(iu*0.21 + seed*3.3 + flow*0.08), uClump);
      float pr = dens * band * clump * (1.0 + 0.7*au);
      if(pr < 0.002 || h.x > pr) continue;               // このセルには破片なし
      // セル中心 → 面座標 → 3D → スクリーン
      float ang = (iu + 0.5 + (h.z - 0.5)*0.5 - flow) * TF_TAU / NU;
      vec2  sc  = tf_scale(ang, rad);
      float rc  = (1.0 + (iv + 0.5 + (h.w - 0.5)*0.5) * cell / sc.x) * tf_wob(ang, wob);
      vec2  c2  = rc * rad * vec2(cos(ang), sin(ang));   // 面内の破片位置
      vec3  P0  = O + c2.x*U + c2.y*V;
      if(P0.z < 0.25) continue;                          // カメラの手前/後ろ
      vec2  s0  = fcl * P0.xy / P0.z;
      // 破片の2軸: 基本は軌道の接線に沿わせ、uTilt でばらす。セル以内に収めて 3×3 探索を保つ
      vec2  tg  = normalize(vec2(-rad.x*sin(ang), rad.y*cos(ang)));
      float phi = (h.y - 0.5) * TF_TAU * uTilt;
      float cp  = cos(phi), sp = sin(phi);
      vec2  d1  = vec2(cp*tg.x - sp*tg.y,  sp*tg.x + cp*tg.y);
      vec2  d2  = vec2(-d1.y, d1.x);
      float w1  = cell * 0.46 * sizeMul * mix(0.15, 1.0,  fract(h.y*5.17)) * (1.0 + 0.4*au*fract(h.w*13.7));
      float w2  = cell * 0.46 * sizeMul * mix(0.12, 0.95, fract(h.z*7.31)) * (1.0 + 0.4*au*fract(h.w*13.7));
      vec3  a1  = w1 * (d1.x*U + d1.y*V);
      vec3  a2  = w2 * (d2.x*U + d2.y*V);
      // 2軸も投影 → 画面上の平行四辺形。その内部座標で輪郭を描く (= 奥行きで潰れる)
      vec3  Pa = P0 + a1, Pb = P0 + a2;
      if(Pa.z < 0.2 || Pb.z < 0.2) continue;
      vec2  f1 = fcl * Pa.xy / Pa.z - s0;
      vec2  f2 = fcl * Pb.xy / Pb.z - s0;
      float dt = f1.x*f2.y - f1.y*f2.x;
      if(abs(dt) < 1e-9) continue;
      vec2  rel = p - s0;
      vec2  loc = vec2(rel.x*f2.y - rel.y*f2.x, f1.x*rel.y - f1.y*rel.x) / dt;   // 1.0 = 破片の端
      vec2  dd  = abs(loc) - 1.0;
      float sdL = min(max(dd.x, dd.y), 0.0) + length(max(dd, vec2(0.0)));
      float ss  = min(length(f1), length(f2));           // 局所座標 → スクリーン距離の目安
      float sd  = sdL * ss;
      float lwp = lw * clamp(ss / (3.0*px), 0.4, 1.0);   // 小さい(遠い)破片は線も細く = 潰れて黒く固まらない
      float fade = mix(1.0, clamp(1.75 - 0.85*(P0.z/TF_EYE), 0.22, 1.0), uDepth);   // 遠いほど薄く
      float line = (1.0 - smoothstep(lwp, lwp + aa, abs(sd))) * fade;
      float fil  = (1.0 - smoothstep(-aa, aa, sd)) * uFill * fade;
      float a    = max(line, fil);
      if(a > cov){ cov = a; tfTint = fract(iu / NU + seed * 0.37); }
    }
  }
  return cov;
}

vec3 bg_transflock(vec2 fc){
  vec2  p  = (fc - 0.5*resolution) / resolution.y;
  p = p / max(bgZoom, 0.001) + bgCamPx / resolution.y;         // ズーム/パン
  float px = 1.0 / (resolution.y * max(bgZoom, 0.001));        // 1px の長さ (線幅/AA 用)
  float fcl = 1.6 / clamp(uPersp, 0.3, 2.0);                   // 焦点距離 (小=広角=奥行き強い)

  float bt = getBeat();
  float tf = bt * 1.8  * (uFlow  * 0.01);    // 流れ (セル/拍)
  float ts = bt * 0.07 * (uSwirl * 0.01);    // 旋回 (rad/拍)
  float au = clamp(iAudio, 0.0, 1.0) * uAudio;
  float cellBase = 0.072 * uGrain;           // 粗レイヤのセル長 (基準奥行きで ≒0.03 画面高)

  float cov = 0.0, trail = 0.0;
  tfTint = 0.0;

  for(int k = 0; k < 5; k++){
    if(float(k) >= uOrbits) break;
    float fk = float(k);
    vec3  r  = tf_h3(fk*3.77 + 1.3);
    float ph = ts * (0.6 + 0.8*r.x) + fk*2.4;
    // 軌道面: 3D でタンブルしながら奥行き方向にも漂う = 群れが立体的に旋回する。
    // X/Y の傾きは ±45° までに抑える (真横を向くと輪が線に潰れて破片が見えなくなるため)。
    // Z は面内の回転なので自由に回してよい。
    vec3  axis = vec3(0.78*sin(ph*0.47 + r.x*TF_TAU), 0.78*sin(ph*0.63 + r.y*TF_TAU),
                      fk*1.17 + ts*1.1);
    vec3  U = tf_rot3(vec3(1.0, 0.0, 0.0), axis);
    vec3  V = tf_rot3(vec3(0.0, 1.0, 0.0), axis);
    vec3  O = vec3(1.05*sin(ph*1.11 + r.y*TF_TAU), 0.75*cos(ph*0.87 + r.z*TF_TAU),
                   TF_EYE + 1.0*sin(ph*0.6 + fk*1.9));
    float rm  = 0.62 + 0.72*r.x;
    float an  = 1.0 + 0.85*r.y;                                // 扁平率 (≤1.85: セルの歪みを抑える)
    vec2  rad = rm * vec2(an, 1.0/an) * (1.0 + 0.10*sin(ph*1.7 + fk));
    float dir = (r.y > 0.5) ? 1.0 : -1.0;                      // 流れる向きは軌道ごとに逆も
    float flow = tf * (0.7 + 0.9*r.z) * dir;
    vec3  wob  = vec3(uWobble*0.13, r.y*TF_TAU + ts*0.7, r.z*TF_TAU - ts*0.5);

    // 粗(大きい破片) → 細(小さい破片) の順に重ねる
    cov = max(cov, tf_cells(p, O, U, V, rad, flow, wob, cellBase,
                            uDensity, uSpread, 1.0, fk*4.1, px, au, fcl));
    if(uDetail > 0.5){
      cov = max(cov, tf_cells(p, O, U, V, rad, flow*1.35, wob, cellBase*0.45,
                              uDensity*1.2, uSpread*0.8, 0.95, fk*4.1 + 31.7, px, au, fcl));
    }
    // 軌道そのものを薄い線で (群れの飛行経路が見える)。面座標で距離を測ってから投影倍率で画面へ
    if(uTrail > 0.001){
      vec3 dir3 = vec3(p / fcl, 1.0);
      vec3 r0 = cross(V, O), r1 = cross(O, U), r2 = cross(U, V);
      float det = dot(U, r0);
      vec3 q = vec3(dot(r0, dir3), dot(r1, dir3), dot(r2, dir3));
      if(abs(det) > 1e-5 && q.z * det > 0.0){
        vec2  pl = q.xy / q.z;
        vec2  e2d = pl / rad;
        float a0 = atan(e2d.y, e2d.x);
        float d  = abs(length(e2d) / tf_wob(a0, wob) - 1.0) * tf_scale(a0, rad).x;
        float z  = (O + pl.x*U + pl.y*V).z;                    // その点の奥行き
        float ds = d * fcl / max(z, 0.25);                     // 面上距離 → 画面距離
        trail = max(trail, (1.0 - smoothstep(0.35*px, 1.1*px, ds)) * uTrail);
      }
    }
  }

  cov = max(cov, trail);
  float a = clamp(cov, 0.0, 1.0);
  vec3 ink = mix(uInk, cosGradColor(tfTint), clamp(uCosGrad, 0.0, 1.0));
  // Slot A (ベース) は uPaper を下地に敷いた不透明出力 / それ以外は線の被覆で透過させて下の絵に重ねる
  bgAlpha = (uSlotIsA > 0.5) ? 1.0 : a;
  return (uSlotIsA > 0.5) ? mix(uPaper, ink, a) : ink;
}
