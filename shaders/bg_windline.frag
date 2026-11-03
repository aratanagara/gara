// =====================================================
// bg_windline  —  線画の風 (アイシールド 21 の風の描線を再現)
//   ・流線: 平行 (uRadial=0) 〜 集中線 (uRadial=100)。1 本ごとに太さ・長さ・位置がばらつき、
//     両端が針のように細る (起筆/収筆)。uLineVar で太さのばらつきと入り抜きの強さ
//   ・風の帯: 見えない筒 (軸 = 風向) にらせん状に巻きついた N 本のリボンを透視投影。
//     手前 (軸の前) は大きく太く、奥は小さく細く (uDepth)。ねじれて筒の側面では薄くなり (uTwist)、
//     手前の帯の本体が奥の帯を隠す。軸はうねり、中心線にもノイズのゆらぎ (uWarp)。
//     縁は ridged noise で雲状にめくれ (uTurb)、両端は鞭のように 1 本線へ収束。
//     輪郭の線幅は筆圧のように揺らぎ (uLineVar)、奥行きで細り、下側 (影側) がやや太い
//   ・既定 = 黒地に白線 (Slot B では線だけ透過して重なる。uFill で本体の黒が奥を隠す)
//     uPaper=100 で白紙に黒線の原稿モード (uInk は無視)
//   ・beat モードは拍頭ごとに突風 (流れが加速→減速)。iAudio で帯が太り縁が荒れる (uGust)
// =====================================================

// @param uAngle    0..360    = 15.0
// @param uSpeed    0..300    = 100.0
// @param uScale    20..400   = 100.0
// @param uRibbons  1..12     = 6.0
// @param uRadius   10..100   = 45.0
// @param uCoil     0..300    = 180.0
// @param uSpin     -200..200 = 100.0
// @param uDepth    0..100    = 70.0
// @param uTwist    0..100    = 80.0
// @param uWidth    0..100    = 45.0
// @param uWarp     0..200    = 100.0
// @param uTurb     0..200    = 100.0
// @param uShade    0..100    = 50.0
// @param uLineW    5..60     = 16.0
// @param uLineVar  0..200    = 100.0
// @param uLines    0..300    = 100.0
// @param uLineLen  10..300   = 100.0
// @param uRadial   0..100    = 0.0
// @param uFill     0..100    = 100.0
// @param uInner    0..100    = 60.0
// @param uGust     0..200    = 100.0
// @param uPaper    0..100    = 0.0
// @param uInk      color     = #ffffff
uniform float uAngle;    // 風向 = 筒の軸の向き (deg。0 = 左→右)
uniform float uSpeed;    // 流速 (%)
uniform float uScale;    // 全体の大きさ (%)
uniform float uRibbons;  // 帯の本数
uniform float uRadius;   // 筒の半径 (% 画面高さ比)
uniform float uCoil;     // 巻き (らせんの密度 %。100 で画面幅 1 周)
uniform float uSpin;     // 筒のまわりの回転速度 (% 負で逆回転)
uniform float uDepth;    // 奥行き (手前と奥の大きさ・線幅の差 %)
uniform float uTwist;    // ねじれ (筒の側面で帯が薄くなる %)
uniform float uWidth;    // 帯の太さ (%)
uniform float uWarp;     // うねり (軸の曲がり + 中心線のゆらぎ %)
uniform float uTurb;     // 縁の乱れ (雲状のめくれ %)
uniform float uShade;    // 奥側 (筒の裏に回った帯) に入るハッチの陰影 (%)
uniform float uLineW;    // 線の太さ (×0.1 px)
uniform float uLineVar;  // 線の抑揚 (筆圧のような太さの揺らぎ・入り抜き・影側の太り %)
uniform float uLines;    // 流線の密度 (%)
uniform float uLineLen;  // 流線の長さ (%)
uniform float uRadial;   // 集中線の割合 (% 0=平行 / 100=放射)
uniform float uFill;     // 帯の本体で奥を隠す不透明度 (%)
uniform float uInner;    // 帯内部の筋線の出現率 (%)
uniform float uGust;     // 拍 / 音での突風 (%)
uniform float uPaper;    // 紙モード (白地に黒線 %)
uniform vec3  uInk;      // 線の色 (黒地モード)

float wl_hash(float n){ return fract(sin(n*127.1 + 311.7) * 43758.5453); }
float wl_hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
mat2  wl_rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// value noise (-0.7..0.7。帯ごとに 6 回×本数を評価するので gradient noise より軽い値ノイズ)
float wl_noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0 - 2.0*f);
  float v = mix(mix(wl_hash2(i),               wl_hash2(i + vec2(1, 0)), u.x),
                mix(wl_hash2(i + vec2(0, 1)),  wl_hash2(i + vec2(1, 1)), u.x), u.y);
  return (v - 0.5) * 1.4;
}
// 2 octave fbm (おおよそ -1..1。大きなうねり用: 細かい波打ちを入れない)
float wl_fbm2(vec2 p){
  return (wl_noise(p) + 0.5 * wl_noise(wl_rot(0.6) * p * 2.03 + 1.7)) * 1.2;
}

// 流線 1 層。a = 横座標 (1 = 1 本分のピッチ), u = 流れ方向 (スクロール済み), pxA = 1px あたりの a
float wl_speedlines(float a, float u, float pxA, float lenScale, float seed, float lwPx, float lvar){
  float row = floor(a);
  float fa  = fract(a) - 0.5;
  float h1 = wl_hash(row*1.73 + seed);
  float h2 = wl_hash(row*4.21 + seed + 1.0);
  float h3 = wl_hash(row*9.13 + seed + 2.0);
  fa += (h1 - 0.5) * 0.5;                                // 位置のばらつき
  float L  = lenScale * (0.6 + 1.6*h2);
  float su = (u + h3*61.0) / L;
  float sf = fract(su), si = floor(su);
  float h4 = wl_hash(si*13.7 + row*3.3 + seed + 3.0);
  float h5 = wl_hash(si*5.1  + row*7.7 + seed + 4.0);
  float on    = step(0.6, h4);                           // 間引き
  float prof  = pow(max(sin(PI*sf), 0.0), mix(0.3, 0.7, lvar*0.5));   // 両端が針状に細る (抑揚が強いほど長く細る)
  float amp   = 0.8 * lvar;                              // 太さのばらつき幅
  float thick = max(lwPx * (0.9 - 0.5*amp + amp*h5), 0.3) * prof;     // px
  float hw    = 0.5 * thick * pxA;
  return on * (1.0 - smoothstep(hw, hw + pxA, abs(fa)));
}

vec3 bg_windline(vec2 fc){
  float bt   = getBeat();
  float gust = uGust * 0.01;
  // 流れ時間: beat モードは拍頭で加速→減速 (単調増加)、drone は一定
  float flowT, burst;
  if(isFree()){
    flowT = time;
    burst = 0.0;
  } else {
    float fb   = fract(bt);
    float ease = 1.0 - pow(1.0 - fb, 3.0);
    flowT = (floor(bt) + mix(fb, ease, clamp(gust, 0.0, 1.0))) * 0.5;
    burst = pow(1.0 - fb, 4.0) * gust;
  }
  float T     = flowT * uSpeed * 0.01;
  float audio = clamp(iAudio, 0.0, 1.0) * gust;

  vec2  I      = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2  p      = (I - 0.5*resolution) / resolution.y;    // 中心 0、縦 ±0.5
  float zoomPx = resolution.y * max(bgZoom, 0.001);      // p 1 単位 = zoomPx px
  float sc     = 100.0 / max(uScale, 5.0);
  vec2  q      = wl_rot(-radians(uAngle)) * p * sc;      // x = 軸 (流れ) 方向, y = 横
  float u2px   = zoomPx / sc;                            // q 1 単位 = u2px px
  float lwBase = uLineW * 0.1;
  float lvar   = uLineVar * 0.01;

  // ---- 流線 ----
  float dens = 80.0 * uLines * 0.01;
  float lenS = uLineLen * 0.01;
  float aP   = q.y * dens;
  float pxP  = dens / u2px;
  float uP   = q.x - T*2.5;
  float slP  = max(wl_speedlines(aP, uP, pxP, lenS*1.1, 1.0, lwBase, lvar),
                   wl_speedlines(aP*0.37 + 0.5, uP + 11.0, pxP*0.37, lenS*2.5, 7.0, lwBase*1.6, lvar));
  float r    = length(p);
  float NR   = floor(dens*2.0 + 0.5);
  float aR   = atan(p.y, p.x) / TAU * NR;
  float pxR  = NR / (TAU * max(r*zoomPx, 1.0));
  float uR   = log(max(r, 1e-3))*2.0 - T*1.5;
  float slR  = max(wl_speedlines(aR, uR, pxR, lenS*0.9, 3.0, lwBase, lvar),
                   wl_speedlines(aR*0.37 + 0.5, uR + 5.0, pxR*0.37, lenS*1.4, 9.0, lwBase*1.6, lvar))
             * smoothstep(0.04, 0.2, r);
  float sl   = mix(slP, slR, uRadial*0.01) * step(0.001, uLines);

  // ---- 3D リボン: 筒にらせん状に巻きついた N 本 ----
  float R     = uRadius * 0.01 * 0.5;                    // 筒の半径 (q 単位)
  float D     = uDepth * 0.01 * 0.45;                    // 透視の強さ (手前 1/(1-D) 倍、奥 1/(1+D) 倍)
  float k     = uCoil * 0.01 * 3.5;                      // 軸 1 単位あたりの位相 (rad)
  float spin  = uSpin * 0.01 * 1.5;
  float warp  = uWarp * 0.01;
  float tw    = uTwist * 0.01;
  float turb  = uTurb * 0.01 * (1.0 + 1.2*audio + 0.8*burst);
  float wmax  = uWidth * 0.01 * (1.0 + 0.5*audio + 0.3*burst);
  float inner = uInner * 0.01;
  float ua    = q.x - T;                                 // 軸に沿う座標 (流れと一緒に移動)
  float axisY = warp * 0.12 * wl_fbm2(vec2(q.x*0.45 - flowT*0.15, 1.3));   // 軸のうねり (画面に固定、ゆっくり)
  int   N     = int(clamp(uRibbons, 1.0, 12.0) + 0.5);
  int   NN    = int(min(12.0, 12.0 + uRibbons*0.0));     // 定数ループ展開 (ANGLE) 抑止
  float th0   = mix(0.6, -0.2, inner);                   // 筋線の出現しきい値

  float zA[12], solA[12], linA[12], holA[12];
  for(int i = 0; i < NN; i++){
    if(i >= N){ zA[i] = -9.0; solA[i] = 0.0; linA[i] = 0.0; holA[i] = 0.0; continue; }
    float fi = float(i);
    float h1 = wl_hash(fi*1.37 + 0.5);
    float h2 = wl_hash(fi*7.91 + 2.0);
    float h3 = wl_hash(fi*3.17 + 5.0);
    float h4 = wl_hash(fi*9.31 + 8.0);
    float h5 = wl_hash(fi*2.71 + 4.0);
    float phi = fi * TAU / float(N) + h1*0.8;            // 位相 (等間隔 + ばらつき)
    float Ri  = R * (0.45 + 0.8*h2) * (0.8 + 0.3*sin(ua*0.6 + h1*6.0));   // 帯ごとの半径 + 軸方向のふくらみ
    float th  = k*ua*(0.7 + 0.6*h3) + phi + spin*flowT;  // らせんの位相 (流れで進み、spin で回る。巻きの密度もばらつく)
    float cz  = cos(th);                                 // 1 = 手前 / -1 = 奥
    float persp = 1.0 / (1.0 - D*cz);
    float dev = warp * 0.13 * wl_fbm2(vec2(ua*0.7 + fi*11.0, flowT*0.1 + fi));   // 中心線のゆらぎ
    float yc  = axisY + (h5 - 0.5)*0.3*R + (Ri*sin(th) + dev) * persp;
    float f   = q.y - yc;
    float g   = max(length(vec2(dFdx(f), dFdy(f))), 1e-6);   // 1px あたりの f 変化 (傾き込み)
    float dpx = abs(f) / g;                                   // 中心線までの垂直距離 (px)
    // 流れ方向のセグメント: 両端が細る紡錘形
    float L  = 1.5 + 3.0*h2;
    float su = (ua + h3*23.0) / L;
    float sf = fract(su), si = floor(su);
    float on = step(0.35, wl_hash(si*11.3 + fi*5.7 + 9.0));
    float env = pow(max(sin(PI*sf), 0.0), 0.65);
    // 幅: ねじれ (筒の側面で薄く) × 透視 × 縁の雲状のめくれ
    float twist = mix(1.0, max(abs(cz), 0.12), tw);
    vec2  ep    = vec2(ua*5.0 + flowT*0.3, fi*3.0 + 7.0);
    float n1    = wl_noise(ep);
    float ridge = sqrt(n1*n1 + 0.002)*1.4 + 0.5*abs(wl_noise(ep*2.3 + 7.0));
    float wdPx  = clamp(wmax * 0.09 * (0.6 + 0.6*h4) * env * twist * persp * (1.0 + turb*(0.7*ridge - 0.25)), 0.0, 0.12) * u2px;
    // 線幅: 奥行きで細り、筆圧のように揺らぎ、尾の先で入り抜き、下側 (影側) がやや太い
    float swl  = wl_noise(vec2(ua*2.2 + fi*17.0, 3.7));
    float lwPx = lwBase * pow(persp, 0.8) * max(1.0 + lvar*swl, 0.15)
               * (0.45 + 0.55*smoothstep(0.0, 0.25, env)) * (1.0 + 0.3*lvar*step(f, 0.0));
    float hl = 0.5 * lwPx;
    // 外縁 − 内縁 = 輪郭線。幅が線幅を下回ると内縁が消えて 1 本の実線 (鞭) に収束する
    float wo = wdPx + hl;
    float wi = max(wdPx - hl, 0.0);
    float vis = on * smoothstep(0.0, 0.05, env);         // 尾の先で線も消す
    float s = 1.0 - smoothstep(wo, wo + 1.0, dpx);
    float h = 1.0 - smoothstep(wi, wi + 1.0, dpx);
    // 内側の筋線: 幅の 38% / 68% の位置に、流れ方向にとぎれとぎれ (細い鞭には入れない)
    float nm  = wl_noise(vec2(ua*1.3 + 3.0, fi*4.1));
    float m1  = smoothstep(th0, th0 + 0.07, nm);
    float m2  = smoothstep(th0, th0 + 0.07, -nm);
    float st1 = 1.0 - smoothstep(hl*0.9, hl*0.9 + 1.0, abs(dpx - wdPx*0.38));
    float st2 = 1.0 - smoothstep(hl*0.9, hl*0.9 + 1.0, abs(dpx - wdPx*0.68));
    float stripes = max(st1*m1, st2*m2) * smoothstep(4.0, 10.0, wdPx) * h;
    // 奥側 (筒の裏) に回った部分の本体に斜めハッチ: 裏表の区別 = 立体の手がかり
    float back  = smoothstep(-0.25, -0.7, cz) * uShade * 0.01;
    float hp    = (q.x*0.7 + q.y) * u2px / 6.0;                          // 6px ピッチ
    float hatch = (1.0 - smoothstep(0.1, 0.1 + 1.0/6.0, abs(fract(hp) - 0.5))) * back * h
                * smoothstep(3.0, 8.0, wdPx) * (1.0 - smoothstep(wi - 2.0, wi, dpx));   // 縁の内側だけ
    zA[i]   = Ri * cz;
    solA[i] = vis * s;
    linA[i] = vis * max(s * (1.0 - h), max(stripes, hatch));
    holA[i] = vis * h;
  }
  // 手前から順に合成: 自分より手前にある帯の本体に隠される
  float ink = 0.0, body = 0.0;
  for(int i = 0; i < NN; i++){
    if(i >= N) break;
    float occ = 1.0;
    for(int j = 0; j < NN; j++){
      if(j >= N) break;
      if(j != i && zA[j] > zA[i]) occ *= (1.0 - solA[j]);
    }
    ink  += linA[i] * occ;
    body += holA[i] * occ;
  }
  body = clamp(body, 0.0, 1.0);
  ink  = max(ink, sl * 0.85 * (1.0 - body));             // 流線は帯の本体に隠れ、輪郭より少し淡く
  ink  = clamp(ink, 0.0, 1.0);

  float paper = uPaper * 0.01;
  vec3  col   = mix(uInk * ink, vec3(1.0 - ink), paper);
  bgAlpha = mix(max(ink, body * uFill * 0.01), 1.0, paper);
  return col;
}
