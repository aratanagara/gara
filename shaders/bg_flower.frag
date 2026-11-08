// =====================================================
// bg_flower (H22)
//   Source : Shadertoy "fLOWER" https://www.shadertoy.com/view/fl3GWB
//   扇状に回転するフラワー(渦)模様。羽を高さ場として実際の厚みに押し出し、
//   ハイトマップ・レイマーチで描く → 真横でも厚みが見え、dFdx 由来のブレも解消。
//   2026-07-26: 保存プリセットに焼き込まれていた旧版 (シェーダ再編成前) を正とし、
//   その本体をそのまま復元 + 調整用パラメータを追加。既定値 = 旧版と同一の描画。
// =====================================================

// ─── 調整用パラメータ (既定値は旧版と完全に同一の描画になる) ─────────────────
// @param uBlade  1..24  = 2.6
// @param uCut    0..100 = 0.0
// @param uEdge   0..100 = 0.0
// @param uGain   20..400 = 100.0
// @param uThick  2..60  = 12.0
// @param uBlades 0..12  = 0.0
// @param uSpin   0..300 = 100.0
// @param uTwist  0..300 = 100.0
// @param uTumble 0..300 = 100.0
// @param uBreathe 0..300 = 100.0
uniform float uBlade;   // 刃の細さ (稜線のべき乗)。既定 2.6 = 従来。上げると細く尖る
uniform float uCut;     // 外周カットの鋭さ。既定 0 = 従来のゆるいフェード / 上げると刃先までシャープ
uniform float uEdge;    // 輪郭のコントラスト。既定 0 = 従来 / 上げると縁が光り内側が締まる
uniform float uGain;    // 明るさ (%)。既定 100 = 従来
uniform float uThick;   // 羽の厚み (%)。既定 12 = 従来 (0.12)。上げると分厚い円盤に
uniform float uBlades;  // 刃の枚数。0 = 従来 (3〜6 を時間で自動変化) / 1 以上で固定枚数
uniform float uSpin;    // スピン速度 (%)。既定 100 = 従来
uniform float uTwist;   // ひねり/スパイラル量 (%)。既定 100 = 従来。0 でまっすぐな放射
uniform float uTumble;  // 3D タンブル速度 (%)。既定 100 = 従来。0 で姿勢固定
uniform float uBreathe; // 刃の脈動 (%)。既定 100 = 従来。0 で呼吸停止
// @param uBladePhase 0..360 = 0
// @param uTwistSwing 0..300 = 100
// @param uRipple 0..300 = 100
// @param uRippleLobes 0..8 = 2
// @param uRootFat 0..180 = 100
// @param uRootSpan 20..300 = 100
// @param uTipReach 45..119 = 100
// @param uCamDist 25..400 = 100
// @param uRoll -180..180 = 0
// @param uOffX -50..50 = 0
// @param uOffY -50..50 = 0
// @param uLightYaw -180..180 = 0
// @param uLightPitch -60..60 = 0
// @param uSpecSharp 20..400 = 100
// @param uSpecGain 0..600 = 100
// @param uRimGain 0..300 = 100
// @param uEnvBands 20..300 = 100
// @param uShade 0..200 = 100
// @param uValleyDark 0..160 = 100
// @param uMetalColor color = #ffffff
// @param uSpecColor color = #ffffff
// @param uRimColor color = #ffffff
uniform float uBladePhase; // 刃の位相 (度)。花全体の回転位置
uniform float uTwistSwing; // ひねり量の時間的な振れ幅 (%)。0 で一定のひねり
uniform float uRipple;     // 刃のうねりの振れ幅 (%)。0 で正確な放射状
uniform float uRippleLobes; // うねりの山数。既定 2
uniform float uRootFat;    // 根元の太さ (%)。下げると中心が細く、刃が離れる
uniform float uRootSpan;   // 根元の太い範囲 (%)。中心から外へどこまで太いか
uniform float uTipReach;   // 刃の届く外周の位置 (%)。下げると小さな花、上げると長い刃先
uniform float uCamDist;    // カメラ距離 (%)。下げると遠近が強く、上げると望遠で平らに
uniform float uRoll;       // 画面ロール (度)
uniform float uOffX;       // 花の中心の横位置 (%)
uniform float uOffY;       // 花の中心の縦位置 (%)
uniform float uLightYaw;   // 光源の方位 (度)
uniform float uLightPitch; // 光源の仰角の傾け (度)
uniform float uSpecSharp;  // ハイライトの鋭さ (%)
uniform float uSpecGain;   // ハイライトの強さ (%)
uniform float uRimGain;    // 縁光りの強さ (%)
uniform float uEnvBands;   // 環境反射の明暗帯の細かさ (%)
uniform float uShade;      // 拡散光による陰影の深さ (%)。下げると陰が浅い
uniform float uValleyDark; // 谷の暗さ (%)。上げると刃の間が深く沈む
uniform vec3  uMetalColor; // 金属の地色のティント
uniform vec3  uSpecColor;  // ハイライトの色のティント
uniform vec3  uRimColor;   // 縁光りの色のティント

vec3 fl_hash3(float n){
  return fract(sin(n*vec3(12.9898, 78.233, 37.719)) * 43758.5453);
}
// X→Y→Z の順に回転
vec3 fl_rot3(vec3 p, vec3 a){
  float cx=cos(a.x), sx=sin(a.x); p = vec3(p.x, cx*p.y - sx*p.z, sx*p.y + cx*p.z);
  float cy=cos(a.y), sy=sin(a.y); p = vec3(cy*p.x + sy*p.z, p.y, -sy*p.x + cy*p.z);
  float cz=cos(a.z), sz=sin(a.z); p = vec3(cz*p.x - sz*p.y, sz*p.x + cz*p.y, p.z);
  return p;
}

// ─── 花の角度場(スパイラル/うねり) ─────────────────────────────────────────
float fl_theta(vec2 uv, float mag){
  float thetaRaw = atan(uv.y, uv.x);
  float theta = thetaRaw + time*2.2*(uSpin*0.01);          // スピン
  theta += mag * (4.5 + 2.5*(uTwistSwing/100.0)*sin(time*0.25)) * (uTwist*0.01); // ひねり/スパイラル(残す)
  theta += 0.30*(uRipple/100.0)*sin(mag*1.6 + time*0.9 + thetaRaw*floor(uRippleLobes + 0.5));    // うねり
  theta += uBladePhase*0.0174532925;
  return theta;
}
// ─── 花の高さ場 (局所 uv → 羽の高さ 0..1) ─────────────────────────────────────
//   羽=稜線。中央が実体、外周はフェード。これを ±THICK*h に押し出して厚みにする。
float fl_height(vec2 uv){
  // 刃数: uBlades=0 で従来の 3〜6 自動変化、1 以上で固定枚数
  float nb = (uBlades >= 0.5) ? uBlades : (3.0 + 3.0 * (0.5 + 0.5*sin(time*0.22)));
  float n1 = floor(nb), fr = nb - n1, n2 = n1 + 1.0;
  float mag = length(uv);
  float theta = fl_theta(uv, mag);
  float blade = mix(sin(theta*n1), sin(theta*n2), fr);      // -1..1 刃パターン(整数刃で連続)
  float rootFat = 0.55*(uRootFat/100.0) + 0.45*smoothstep(0.04, 0.28*(uRootSpan/100.0), mag);  // 根元は太め
  float breathe = 1.0 + 0.18*(uBreathe*0.01)*sin(time*0.8);
  float ridge = 0.5 + 0.5*blade*rootFat*breathe;            // 0..1 稜線
  float radial = smoothstep(0.42*(uTipReach/100.0), 0.05, mag);               // 外周フェード/中央実体
  return pow(clamp(ridge, 0.0, 1.0), max(uBlade, 1.0)) * radial;   // 羽の高さ(2.6 で従来の手裏剣の刃)
}

vec3 bg_flower(vec2 fc){
  vec2 sc = (fc - 0.5*resolution) / resolution.y;
  sc = sc / max(bgZoom, 0.001) + bgCamPx / resolution.y;    // ズーム/パン
  if(uOffX != 0.0 || uOffY != 0.0){ sc -= vec2(uOffX, uOffY) * 0.01; }
  if(uRoll != 0.0){
    float rc = cos(uRoll*0.0174532925), rs = sin(uRoll*0.0174532925);
    sc = vec2(rc*sc.x - rs*sc.y, rs*sc.x + rc*sc.y);
  }

  // 全軸フルレンジ・タンブル(セグメント乱数を補間して連続回転)
  float rt = time * 0.34 * (uTumble*0.01);
  vec3 rr = mix(fl_hash3(floor(rt)), fl_hash3(floor(rt) + 1.0), smoothstep(0.0, 1.0, fract(rt)));
  vec3 a3 = (rr - 0.5) * 6.2831853;
  vec3 rgt = fl_rot3(vec3(1.0, 0.0, 0.0), a3);
  vec3 upv = fl_rot3(vec3(0.0, 1.0, 0.0), a3);
  vec3 pN  = fl_rot3(vec3(0.0, 0.0, 1.0), a3);

  float camD = 7.0*(uCamDist/100.0);
  vec3 ro = vec3(0.0, 0.0, camD);
  vec3 rd = normalize(vec3(sc, -camD));

  // 局所空間 (x=rgt, y=upv, z=pN=平面法線)。花は z=0 平面に高さ場、±THICK*h に押し出す。
  vec3 lo = vec3(dot(ro, rgt), dot(ro, upv), dot(ro, pN));
  vec3 ld = vec3(dot(rd, rgt), dot(rd, upv), dot(rd, pN));

  float THICK = clamp(uThick, 1.0, 80.0)*0.01;   // 羽の厚み(片側)。既定 0.12 — 手裏剣のように薄く
  const float RAD   = 0.5;         // 花の外接半径

  // マーチ区間を「xy円柱(半径RAD) ∩ zスラブ(|z|<THICK)」に絞る → ステップを無駄なく使い
  // 点々/縞(粗い固定マーチのアーティファクト=謎の線)を解消。
  float A = dot(ld.xy, ld.xy);
  float B = 2.0*dot(lo.xy, ld.xy);
  float C = dot(lo.xy, lo.xy) - RAD*RAD;
  float disc = B*B - 4.0*A*C;
  if(disc <= 0.0 || A < 1e-8){ bgAlpha = 0.0; return vec3(0.0); }
  float sq = sqrt(disc);
  float tcA = (-B - sq) / (2.0*A);
  float tcB = (-B + sq) / (2.0*A);
  float tzA, tzB;
  if(abs(ld.z) > 1e-5){
    float z0 = (-THICK - lo.z)/ld.z, z1 = (THICK - lo.z)/ld.z;
    tzA = min(z0, z1); tzB = max(z0, z1);
  } else {
    if(abs(lo.z) > THICK){ bgAlpha = 0.0; return vec3(0.0); }
    tzA = tcA; tzB = tcB;
  }
  float t0 = max(max(tcA, tzA), 0.0);
  float t1 = min(tcB, tzB);
  if(t1 <= t0){ bgAlpha = 0.0; return vec3(0.0); }

  const int STEPS = 80;
  float dt = (t1 - t0) / float(STEPS);
  float t  = t0;
  float hit = 0.0; vec3 hp = vec3(0.0);
  for(int i=0; i<STEPS; i++){
    vec3 p = lo + ld*t;
    float surf = THICK * fl_height(p.xy);
    if(abs(p.z) <= surf){ hit = 1.0; hp = p; break; }
    t += dt;
  }

  if(hit < 0.5){ bgAlpha = 0.0; return vec3(0.0); }

  // 法線: F(p)=abs(p.z)-THICK*h(p.xy) の勾配(実ジオメトリ → ノイズなし)
  vec2 e = vec2(0.004, 0.0);
  float hx = (fl_height(hp.xy + e.xy) - fl_height(hp.xy - e.xy)) / (2.0*e.x);
  float hy = (fl_height(hp.xy + e.yx) - fl_height(hp.xy - e.yx)) / (2.0*e.x);
  vec3 ln  = normalize(vec3(-THICK*hx, -THICK*hy, sign(hp.z + 1e-6)));
  vec3 nrm = normalize(ln.x*rgt + ln.y*upv + ln.z*pN);     // ワールド法線

  // ── クローム/銀シェーディング ──
  float mag = length(hp.xy);
  vec3 V = -rd;
  float ndv = clamp(dot(nrm, V), 0.0, 1.0);
  vec3 Ldir = normalize(vec3(0.5, 0.6, 0.85));
  if(uLightYaw != 0.0 || uLightPitch != 0.0){
    float lc = cos(uLightYaw*0.0174532925), ls = sin(uLightYaw*0.0174532925);
    Ldir = vec3(lc*Ldir.x - ls*Ldir.y, ls*Ldir.x + lc*Ldir.y, Ldir.z);
    float pc = cos(uLightPitch*0.0174532925), ps = sin(uLightPitch*0.0174532925);
    Ldir = normalize(vec3(Ldir.x, pc*Ldir.y - ps*Ldir.z, ps*Ldir.y + pc*Ldir.z));
  }
  float diff = clamp(dot(nrm, Ldir), 0.0, 1.0);
  vec3 refl = reflect(-V, nrm);
  // 疑似環境反射(回転で動く明暗帯 → 磨いた銀)
  float env = 0.5 + 0.5*sin(refl.x*(4.0*(uEnvBands/100.0)) - refl.y*(4.0*(uEnvBands/100.0)) + time*0.5 + mag*2.0);
  vec3 base = mix(vec3(0.04, 0.05, 0.07), vec3(0.90, 0.92, 0.97), pow(env, 1.6)) * uMetalColor;
  vec3 col = base * (0.42*(uShade/100.0) + 0.58*diff);
  float spec = pow(clamp(dot(refl, Ldir), 0.0, 1.0), 42.0*(uSpecSharp/100.0));
  col += spec * uSpecColor * (0.7*(uSpecGain/100.0));                            // ハイライト
  float fres = pow(1.0 - ndv, 3.0);
  col += fres * vec3(0.85, 0.90, 1.0) * uRimColor * (0.45*(uRimGain/100.0));               // 縁光り(厚みの輪郭)
  // uEdge: 極細のフレネルで縁だけを光らせ、その内側を締めて輪郭線として立てる (0 で無効=従来)
  float ew = clamp(uEdge*0.01, 0.0, 1.0);
  if(ew > 0.0){
    float rimLine = pow(1.0 - ndv, 10.0);
    float inner   = smoothstep(0.35, 0.80, 1.0 - ndv) * (1.0 - rimLine);
    col = mix(col, col*0.22, inner*ew*0.85);
    col += rimLine * vec3(1.0) * 1.1 * ew;
  }
  // 谷(高さの低い所)を締めて厚みのコントラスト
  float ao = smoothstep(0.0, 0.6, fl_height(hp.xy));
  col *= (1.0 - 0.5*(uValleyDark/100.0)) + 0.5*(uValleyDark/100.0)*ao;
  col *= max(uGain, 1.0) * 0.01;                            // 明るさ (100 = 従来)
  col = clamp(col, 0.0, 1.0);

  // 中央のみ実体、外周は背景へ (uCut=0 で従来の 0.12。上げるとフェード幅が狭まり刃先まで残る)
  float cutIn = mix(0.12, 0.375, clamp(uCut*0.01, 0.0, 1.0));
  float cutEnd = 0.42*(uTipReach/100.0);
  cutIn = min(cutIn, cutEnd*0.9);
  float mask = 1.0 - smoothstep(cutIn, cutEnd, mag);
  bgAlpha = mask;
  return mix(vec3(0.0), col, mask);
}
