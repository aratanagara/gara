// =====================================================
// bg_futurist (Futurism — 同心円の干渉 + 鋭角の刃)
//   構成 (下から順):
//   1. 干渉セル: ランダム位置を中心とした複数の「運動する同心円」システム。
//      各画素で全システムのリング番号 (floor(位相)) を取り、その組み合わせの
//      ハッシュでセル色を決める → セル境界はすべて円弧になり、円環格子の
//      干渉でレンズ状の湾曲セルが生まれる。リング間隔は境界ジッタでムラに。
//      円は幾何学的な真円 (Balla)。歪みは uFtJitter の全体ワープで一括に掛ける。
//   2. 墨線: 円弧をなぞる手描き線 (墨/白/顔料)。版ズレとゴースト付き。
//   3. 力場: 円弧どうしの交点に溜まる顔料の結節。
//   4. 水彩マチエール: 粒状化/滲みムラ/紙目/かすれ。塗りは全て共通の
//      ディザ (uFtDith) で二値点描に落とせる。
//   参照: https://x.com/_juanrg92/status/2081391041597329569 (元ルール)
//         https://x.com/_juanrg92/status/2082499919101702598 (未来派版)
// =====================================================

// ─── 調整用パラメータ ─────────────────────────────────────
// @param uFtShards  4..64   = 22.0
// @param uFtRings   2..40   = 11.0
// @param uFtCenters 1..5    = 4.0
// @param uFtLines   0..24   = 0.0
// @param uFtArcs    0..100  = 100.0
// @param uFtJitter  0..200  = 0.0
// @param uFtSpin    0..300  = 150.0
// @param uFtDepth   0..200  = 0.0
// @param uFtGrain   0..200  = 100.0
// @param uFtGrad    0..200  = 200.0
// @param uFtRough   0..200  = 0.0
// @param uFtMisreg  0..200  = 200.0
// @param uFtDry     0..200  = 15.0
// @param uFtIrreg   0..200  = 100.0
// @param uFtDith    0..100  = 35.0
// @param uFtPal     0..5    = 0.0
uniform float uFtShards;   // 全体ワープの周波数 (小=大きくたわむ / 大=細かく歪む)
uniform float uFtRings;    // リング密度 (単位半径あたりの本数)
uniform float uFtCenters;  // 同心円システムの数
uniform float uFtLines;    // 墨線 (円弧の手描き線) の量
uniform float uFtArcs;     // 力場: 円弧の交点に溜まる顔料 (結節) の強さ
uniform float uFtJitter;   // 全体ワープの強さ (0=幾何学的な真円 / 図形自体は歪ませず画面ごと歪む)
uniform float uFtSpin;     // 運動速度 (リング膨張/収縮・中心のドリフト・刃の首振り・ノイズ運動)
uniform float uFtDepth;    // 黒の割合 (セルが黒に落ちる率)
uniform float uFtGrain;    // 水彩マチエール (%) 0=フラット
uniform float uFtGrad;     // 円のフチから内側へ向かう色のグラデ (顔料がフチに溜まり内側で薄れる)
uniform float uFtRough;    // 縁の荒れ: 円弧の境界を高周波ノイズで乱し、手切り/にじみの縁にする
uniform float uFtMisreg;   // 版ズレ: 墨線が色面の境界から刷りズレのようにずれる (ゴースト線つき)
uniform float uFtDry;      // かすれ: ディザ状の抜け (グランジ)。刷毛ストリークが密度を決める
uniform float uFtIrreg;    // リング間隔のムラ: 0=等間隔 / 大きいほど太い輪と細い輪が混ざる
uniform float uFtDith;     // ディザ強度: 0=滑らかな合成 / 100=完全な二値点描
uniform float uFtPal;      // 配色 0=Balla / 1=Boccioni / 2=Severini / 3=Depero / 4=Mono / 5=Aurora

float ft_h11(float n){ return fract(sin(n*127.1)*43758.5453); }
float ft_h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
vec2  ft_h22(vec2 p){ return fract(sin(vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))))*43758.5453); }
float ft_vn(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = ft_h21(i), b = ft_h21(i+vec2(1,0)), c = ft_h21(i+vec2(0,1)), d = ft_h21(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}

// 顔料 7 色 + 紙色
vec3 FT_P[7];
vec3 ft_setPalette(int id){
  vec3 paper;
  if(id == 1){        // Boccioni: 青灰と鉄錆
    paper = vec3(0.86,0.83,0.76);
    FT_P[0]=vec3(0.12,0.12,0.13); FT_P[1]=vec3(0.90,0.88,0.83); FT_P[2]=vec3(0.60,0.23,0.13);
    FT_P[3]=vec3(0.15,0.22,0.38); FT_P[4]=vec3(0.78,0.64,0.32); FT_P[5]=vec3(0.26,0.33,0.30);
    FT_P[6]=vec3(0.40,0.18,0.12);
  } else if(id == 2){ // Severini: 桃と青緑
    paper = vec3(0.90,0.87,0.81);
    FT_P[0]=vec3(0.16,0.15,0.17); FT_P[1]=vec3(0.94,0.92,0.87); FT_P[2]=vec3(0.79,0.34,0.37);
    FT_P[3]=vec3(0.17,0.42,0.46); FT_P[4]=vec3(0.88,0.74,0.42); FT_P[5]=vec3(0.36,0.29,0.43);
    FT_P[6]=vec3(0.62,0.46,0.28);
  } else if(id == 3){ // Depero: 原色の機械
    paper = vec3(0.93,0.90,0.83);
    FT_P[0]=vec3(0.09,0.09,0.10); FT_P[1]=vec3(0.96,0.95,0.91); FT_P[2]=vec3(0.83,0.16,0.14);
    FT_P[3]=vec3(0.11,0.32,0.64); FT_P[4]=vec3(0.95,0.75,0.11); FT_P[5]=vec3(0.13,0.42,0.30);
    FT_P[6]=vec3(0.55,0.25,0.35);
  } else if(id == 4){ // Mono: 木炭素描
    paper = vec3(0.88,0.86,0.82);
    FT_P[0]=vec3(0.10,0.10,0.11); FT_P[1]=vec3(0.94,0.93,0.91); FT_P[2]=vec3(0.30,0.30,0.32);
    FT_P[3]=vec3(0.52,0.51,0.50); FT_P[4]=vec3(0.70,0.69,0.67); FT_P[5]=vec3(0.20,0.21,0.24);
    FT_P[6]=vec3(0.42,0.40,0.38);
  } else if(id == 5){ // Aurora: 冷たい発光 (暗地)
    paper = vec3(0.07,0.08,0.11);
    FT_P[0]=vec3(0.02,0.02,0.04); FT_P[1]=vec3(0.92,0.96,1.00); FT_P[2]=vec3(0.85,0.30,0.55);
    FT_P[3]=vec3(0.20,0.68,0.85); FT_P[4]=vec3(0.95,0.85,0.45); FT_P[5]=vec3(0.35,0.30,0.75);
    FT_P[6]=vec3(0.15,0.40,0.45);
  } else {            // Balla (既定): 黒・白・朱・コバルト・黄土・オリーブ・煉瓦
    paper = vec3(0.90,0.87,0.79);
    FT_P[0]=vec3(0.11,0.10,0.10); FT_P[1]=vec3(0.94,0.92,0.86); FT_P[2]=vec3(0.72,0.20,0.12);
    FT_P[3]=vec3(0.16,0.28,0.55); FT_P[4]=vec3(0.86,0.64,0.19); FT_P[5]=vec3(0.42,0.42,0.23);
    FT_P[6]=vec3(0.47,0.22,0.15);
  }
  return paper;
}
vec3 ft_pig(float h){ return FT_P[int(clamp(floor(h*7.0), 0.0, 6.0))]; }

// 全塗り共通のディザ閾値。main で画素ごとに確定し、salt で用途ごとに位相を
// ずらす (同じ画素が常に同じ側へ落ちて模様が固着するのを避ける)
float FT_DITH;
float FT_DAMT;   // ディザ強度 0..1 (uFtDith)
float ft_dith(float a, float salt){
  a = clamp(a, 0.0, 1.0);
  float b = step(fract(FT_DITH + salt*0.6180339), a);
  return mix(a, b, FT_DAMT);   // 0=滑らかなアルファ / 1=二値の点描
}

// ── システム i のリング位相 ─────────────────────────────────
//   phase = 半径 × 密度 + 時間 (膨張/収縮)。縁の荒れとリング間隔ムラ
//   (境界ジッタ) を含めて、リング番号とリング内位置 0..1 を返す。
//   墨線の版ズレは「平行移動した座標」でこれを呼び直すことで実現する
void ft_phase(int i, vec2 pos, vec2 ctr, float t, float spd, float irr, float rough,
              out float oIdx, out float oFrf){
  float seed = float(i) * 19.7 + 5.3;
  vec2 p = pos - ctr;
  float r = length(p);
  // サイズの層別: 系ごとに帯域を分け、帯内でシード揺らぎ。
  //   系 0 が最も粗い (大きなリング) 〜 最後の系が最も細かい。被らない
  float ncF = clamp(uFtCenters, 1.0, 5.0);
  float band = (float(i) + 0.25 + 0.5 * ft_h11(seed*1.7)) / max(ncF, 1.0);
  float dens = uFtRings * mix(0.40, 2.3, band);
  float travel = t * spd * mix(0.10, 0.55, ft_h11(seed*3.3)) * ((mod(float(i),2.0)<1.0)?1.0:-1.0);
  float phase0 = r * dens + travel + ft_h11(seed*7.7)*8.0;

  // 円周ごとの個別移動: 仮のリング番号を求め、そのリング専用の中心ズレを
  //   引いて位相を計算し直す (非同心。ズレはリングごとにゆっくり漂う)
  float kProv = floor(phase0);
  float oa = ft_h11(kProv*3.1 + seed) * 6.2831853
           + t * spd * 0.10 * (ft_h11(kProv + seed*1.3) - 0.5) * 2.0;
  float oAmp = 0.05 * min(irr, 2.0) * ft_h11(kProv*1.7 + seed*2.9);
  p -= oAmp * vec2(cos(oa), sin(oa));
  r = length(p);
  float phase = r * dens + travel + ft_h11(seed*7.7)*8.0;

  // 半径のまばら化: 低周波ノイズで密な帯と疎な帯を作る (単調性は保たれる振幅)
  phase += min(irr, 1.5) * 1.2 * (ft_vn(vec2(r * dens * 0.30, seed*3.7)) - 0.5);

  phase += rough * (0.14*(ft_vn(p*11.0 + seed) - 0.5) + 0.06*(ft_vn(p*29.0 - seed) - 0.5)) * 1.3;
  // リング間隔のムラ: 境界 (整数位置) をリング番号の乱数で ±0.4 ずらす
  float k0 = floor(phase), f0 = fract(phase);
  float jk  = (ft_h21(vec2(k0,       seed + 61.0)) - 0.5) * irr * 0.8;
  float jk1 = (ft_h21(vec2(k0 + 1.0, seed + 61.0)) - 0.5) * irr * 0.8;
  float jkm = (ft_h21(vec2(k0 - 1.0, seed + 61.0)) - 0.5) * irr * 0.8;
  if(f0 < jk){
    oIdx = k0 - 1.0;
    oFrf = (phase - (k0 - 1.0 + jkm)) / max((k0 + jk) - (k0 - 1.0 + jkm), 1e-3);
  } else {
    oIdx = k0;
    oFrf = (phase - (k0 + jk)) / max((k0 + 1.0 + jk1) - (k0 + jk), 1e-3);
  }
  oFrf = clamp(oFrf, 0.0, 1.0);
}

vec3 bg_futurist(vec2 fc){
  vec2 sc = (fc - 0.5*resolution) / resolution.y;
  sc = sc / max(bgZoom, 0.001) + bgCamPx / resolution.y;

  float t     = time;
  float spd   = uFtSpin * 0.01;
  float jit   = uFtJitter * 0.01;
  float force = uFtArcs * 0.01;
  float blackRate = clamp(uFtDepth * 0.01, 0.0, 2.0) * 0.22;   // 黒セルの割合 (既定 ~22%)
  float g     = uFtGrain * 0.01;
  float grad  = uFtGrad * 0.01;
  float rough = uFtRough * 0.01;
  float mis   = uFtMisreg * 0.01;
  float dry   = uFtDry * 0.01;
  float irr   = uFtIrreg * 0.01;
  float wfreq = 0.4 + uFtShards * 0.05;                        // 全体ワープの周波数
  float inkP  = clamp(uFtLines / 24.0, 0.0, 1.0);              // 墨線を引く円の割合

  // ディザ閾値 (画素ハッシュ 2 スケール + Spin 連動のフィルムグレイン再抽選)
  {
    float fl0 = floor(t * spd * 5.0);
    FT_DITH = ft_h21(floor(fc * 0.7) + fl0*vec2(2.7, 9.1)) * 0.92
            + ft_h21(floor(fc * 0.23) + fl0*0.37) * 0.08;
    FT_DAMT = clamp(uFtDith * 0.01, 0.0, 1.0);
  }

  // 全体ワープ: 図形そのものはうねらせず、完成した構図ごと低周波で歪ませる
  //   (Balla の図形は幾何学的。歪みは画面全体に一括で掛ける)
  vec2 scRaw = sc;
  if(jit > 0.001){
    sc += jit * 0.11 * (vec2(ft_vn(sc*wfreq + t*spd*0.030),
                             ft_vn(sc*wfreq + 7.7 - t*spd*0.024)) - 0.5) * 2.0;
  }

  vec3 paper = ft_setPalette(int(clamp(uFtPal, 0.0, 5.0)));
  vec3 ink = FT_P[0] * 0.5;
  vec3 col = paper;

  int nc = int(clamp(uFtCenters, 1.0, 5.0));

  // ── 中心のランダムウォーク ─────────────────────────────
  //   一定間隔でランダムな目標点を引き、滑らかに移動し続ける (速度は Spin 連動)
  vec2 ctrs[5];
  for(int i = 0; i < 5; i++) ctrs[i] = vec2(0.0);
  for(int i = 0; i < nc; i++){
    float seed = float(i) * 19.7 + 5.3;
    float wsp = t * spd * (0.045 + 0.05*ft_h11(seed*9.1)) + ft_h11(seed*4.7)*10.0;
    vec2 wa = ft_h22(vec2(seed, floor(wsp)));
    vec2 wb = ft_h22(vec2(seed, floor(wsp) + 1.0));
    // 分布の広がりも系ごとに変える (中央に留まる系 / 広く漂う系)
    float wamp = mix(0.55, 1.25, ft_h11(seed*6.3));
    ctrs[i] = (mix(wa, wb, smoothstep(0.0, 1.0, fract(wsp))) - 0.5) * vec2(1.6, 1.0) * wamp;
  }

  // ── 各同心円システムの位相 ─────────────────────────────
  //   phase = 半径 × 密度 + うねり + 時間 (リングが膨張/収縮する「運動」)
  float idx[5];   // リング番号
  float frf[5];   // リング内位置 0..1
  float g0[5];    // 境界 (円弧) への近さ 0..1
  for(int i = 0; i < 5; i++){ idx[i] = 0.0; frf[i] = 0.5; g0[i] = 0.0; }
  for(int i = 0; i < nc; i++){
    ft_phase(i, sc, ctrs[i], t, spd, irr, rough, idx[i], frf[i]);
    g0[i]  = 1.0 - smoothstep(0.0, 0.30, min(frf[i], 1.0 - frf[i]));   // 円弧境界への近さ
  }

  // ── セル = 全システムのリング番号の組み合わせ ───────────────
  //   境界はすべて円弧。重なった円環格子の干渉でレンズ状セルが生まれる
  vec2 key = vec2(idx[0]*7.3 + idx[1]*13.1 + idx[2]*3.7,
                  idx[3]*5.9 + idx[4]*2.3 + idx[1]*1.7 + idx[2]*11.3);
  float ch = ft_h21(key);
  vec3 pig = ft_pig(ft_h21(key + 31.0));
  // 黒セル: uFtDepth で割合を制御 (未来派版の黒い破片)
  if(ch < blackRate) pig = FT_P[0];
  // セルごとの濃淡 (厚塗り/薄塗り)
  pig *= mix(0.78, 1.18, ft_h21(key + 57.0));

  // 円のフチから内側へ向かうグラデ: 顔料がフチに溜まり、内側へ薄れていく
  if(grad > 0.001){
    // 支配的な 1 系統だけを使う (全系統を合算するとキルト状に沈む)
    float gsh = 0.0; float gDom = 0.0;
    for(int i = 0; i < nc; i++){
      float dirn = step(0.5, ft_h21(vec2(idx[i], float(i)*3.7 + 8.1)));
      float f = mix(frf[i], 1.0 - frf[i], dirn);        // 0 = フチ側
      float e = 1.0 - smoothstep(0.0, 0.75, f);
      if(e > gsh){ gsh = e; gDom = idx[i] + float(i)*37.0; }
    }
    // フチから落ちる色: 墨だけでなく白や顔料も (Balla の白い稜/色の縁)
    float ah = ft_h21(vec2(gDom, 29.0));
    vec3 edgeCol = (ah < 0.5) ? FT_P[0]*0.85 : (ah < 0.78) ? FT_P[1] : ft_pig(fract(ah*9.7));
    pig = mix(pig, edgeCol, ft_dith(gsh * grad * 0.5, 1.0));
  }

  // 水彩の縁: 境界に顔料が溜まる。溜まる色は墨/白/顔料をセルごとに振る
  float edge = 0.0;
  for(int i = 0; i < nc; i++) edge = max(edge, g0[i]);
  float ph2 = ft_h21(key + 83.0);
  vec3 poolCol = (ph2 < 0.55) ? FT_P[0]*0.75 : (ph2 < 0.8) ? FT_P[1] : ft_pig(fract(ph2*7.3));
  pig = mix(pig, poolCol, ft_dith(smoothstep(0.55, 1.0, edge) * g * 0.5, 2.0));

  // かすれ: ディザ (二値の斑点) で顔料が抜けて紙が透ける。
  //   刷毛ストリーク (中周波) が抜けの密度を決め、実際の抜けは画素ハッシュで
  //   二値に落とす → 平滑なぼかしではなく、油彩/グランジのざらついた抜けになる
  float coverage = 1.0;
  if(dry > 0.001){
    vec2 ndrift = t * spd * vec2(0.10, 0.03);                    // ノイズ場のドリフト
    float flick = floor(t * spd * 5.0);                          // 斑点の再抽選 (フィルムグレイン)
    float streak = ft_vn(sc*vec2(26.0, 7.0) + key*0.13 + ndrift*8.0)*0.7
                 + ft_vn(sc*vec2(61.0, 13.0) - key*0.07 - ndrift*5.0)*0.3;
    float density = dry * smoothstep(0.55, 0.95, streak);   // 山にだけ集中させ、全面の均一な塩にならないように
    float dth = ft_h21(floor(fc * 0.7) + flick*vec2(1.3, 7.7));   // 細かい斑点
    float chunk = ft_h21(floor(fc * 0.21) + 3.7 + flick*0.31);    // 大きめの塊
    float speck = step(1.0 - clamp(density, 0.0, 0.95), dth*0.65 + chunk*0.35);
    coverage = 1.0 - speck * 0.85;
  }
  col = mix(col, pig, coverage);

  // ── 墨線: 円弧をなぞる。版ズレ (uFtMisreg) はインク版全体の平行移動 ──
  //   (以前は半径方向のオフセットで、同心円のまま = 別の輪/影にしか見えなかった。
  //    本物の刷りズレは版の並進: 円の中心ごとズレて片側が重なり反対側が空く)
  for(int i = 0; i < nc; i++){
    // インク版の並進ベクトル (系ごとに向きが違う)
    float ma = ft_h11(float(i)*13.3 + 1.9) * 6.2831853;
    vec2 misVec = vec2(cos(ma), sin(ma)) * mis * 0.035;
    float idxI, frfI;
    ft_phase(i, sc + misVec, ctrs[i], t, spd, irr, rough, idxI, frfI);
    float lo = step(1.0 - inkP, ft_h21(vec2(idxI, float(i)*9.1 + 2.7)));
    float line = (1.0 - smoothstep(0.0, 0.10, min(frfI, 1.0 - frfI))) * lo;
    // 線の色: 墨だけでなく白や顔料の線も引く (Balla の白い円弧)
    float ih = ft_h21(vec2(idxI, float(i)*11.7 + 41.0));
    vec3 lineCol = (ih < 0.55) ? ink : (ih < 0.8) ? FT_P[1] : ft_pig(fract(ih*5.9)) * 0.9;
    col = mix(col, lineCol, ft_dith(line * 0.5, 3.0 + float(i)));
    // さらにずれた薄いゴースト線 (二度刷り)
    float idxG, frfG;
    ft_phase(i, sc + misVec * 2.1, ctrs[i], t, spd, irr, rough, idxG, frfG);
    float lg = step(1.0 - inkP, ft_h21(vec2(idxG, float(i)*9.1 + 2.7)));
    float ghost = (1.0 - smoothstep(0.0, 0.07, min(frfG, 1.0 - frfG))) * lg;
    col = mix(col, lineCol, ft_dith(ghost * 0.18 * mis, 9.0 + float(i)));
  }

  // ── 力場: 円弧どうしの交点に顔料が溜まる (結節) ──────────────
  if(force > 0.001){
    float cross = 0.0;
    for(int i = 0; i < nc; i++){
      for(int j = i + 1; j < nc; j++){
        cross += g0[i] * g0[j];
      }
    }
    cross = clamp(cross, 0.0, 1.6);
    // 結節の色も 墨/白/顔料 を場所ごとに振る
    float nh = ft_h21(vec2(idx[0] + idx[1]*3.0, idx[2] + idx[3]*3.0) + 91.0);
    vec3 nodeCol = (nh < 0.6) ? FT_P[0]*0.75 : (nh < 0.85) ? FT_P[1] : ft_pig(fract(nh*6.3));
    col = mix(col, nodeCol, ft_dith(smoothstep(0.55, 1.5, cross) * force * 0.85, 4.0));
  }

  // ── 水彩マチエール ────────────────────────────────────
  if(g > 0.001){
    vec2 mdrift = t * spd * vec2(0.06, -0.02);                  // マチエールのドリフト
    float mflick = floor(t * spd * 5.0);                        // 点描の再抽選
    // 粒状化: ディザの点描 (暗点/明点の二値スペック)。油彩のグランジ感
    float vn = ft_vn(sc*26.0 + mdrift*6.0)*0.6 + ft_vn(sc*57.0 - mdrift*4.0)*0.4;   // 密度場
    float dark = step(1.0 - clamp(g * 0.45 * vn, 0.0, 0.9), ft_h21(floor(fc*0.9) + 11.0 + mflick*vec2(3.1, 1.7)));
    float lite = step(1.0 - clamp(g * 0.30 * (1.0 - vn), 0.0, 0.9), ft_h21(floor(fc*0.9) + 23.0 + mflick*vec2(1.9, 5.3)));
    col *= 1.0 - dark * 0.22;
    col = mix(col, paper, lite * 0.14);
    // 大きな滲みムラ (wash): 濃度場をディザの点描で落とす
    float w1 = ft_vn(sc*2.3 + 7.0 + mdrift)*0.65 + ft_vn(sc*4.9 + 13.0 - mdrift*0.7)*0.35;
    col *= 1.0 - ft_dith((0.5 - w1) * g * 0.5, 6.0) * 0.12;
    col = mix(col, paper, ft_dith((w1 - 0.62) * g * 0.6, 7.0) * 0.10);
    // 紙目 (繊維 + 微細粒): 紙自体もわずかに揺れる
    float n1 = ft_h21(floor(fc * 0.9) + mflick*vec2(0.7, 2.3));
    float fib = sin(fc.y * 0.7 + n1 * 6.28) * 0.012;
    col *= 1.0 + ((n1 - 0.5) * 0.09 + fib) * g;
  }

  // 周辺減光
  float vig = smoothstep(1.45, 0.3, length(scRaw));
  col *= mix(0.84, 1.0, vig);

  return clamp(col, 0.0, 1.0);
}
