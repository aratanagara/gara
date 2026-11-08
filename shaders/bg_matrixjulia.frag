// =====================================================
// bg_matrixjulia
//   Source : Shadertoy "Matrix Julia set" https://www.shadertoy.com/view/scf3WS
//   4D 行列ジュリア集合 + オービットトラップ。配色を 赤 / 青 / シルバー に変更し、
//   トラップ芯にシルバーの金属グリントを追加。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは mj_ で名前空間化。
// =====================================================
void mj_CMS(inout mat2 R, inout mat2 I){
  mat2 nextR = (R*R) - (I*I);
  mat2 nextI = (R*I) + (I*R);
  R = nextR; I = nextI;
}
void mj_iterator(inout mat2 ZR, inout mat2 ZI, mat2 CR, mat2 CI){
  mj_CMS(ZR, ZI);
  ZR = ZR + CR; ZI = ZI + CI;
}
mat2 mj_Zdist(mat2 prev, mat2 ZR, mat2 ZI){
  return mat2(
    vec2(min(min(abs(ZR[0][0]), abs(ZI[0][0])), prev[0][0]), min(min(abs(ZR[1][0]), abs(ZI[1][0])), prev[1][0])),
    vec2(min(min(abs(ZR[0][1]), abs(ZI[0][1])), prev[0][1]), min(min(abs(ZR[1][1]), abs(ZI[1][1])), prev[1][1]))
  );
}
// @param uTrapStart 1..5 = 2
// @param uRing2Pos 40..250 = 100
// @param uRing3Pos 40..250 = 100
// @param uRing2Gain 0..200 = 100
// @param uRing3Gain 0..200 = 100
// @param uJuliaReal 94..106 = 100
// @param uJuliaImag 94..106 = 100
// @param uSliceW 60..160 = 100
// @param uTailThin 30..300 = 100
// @param uSilverGain 0..160 = 100
// @param uBlueGain 0..250 = 100
// @param uRedGain 0..250 = 100
// @param uRotate -180..180 = 0
// @param uCenterX -100..100 = 0
// @param uCenterY -100..100 = 0
// @param uMirror -100..100 = 0
// @param uSliceV 60..160 = 100
// @param uShading 0..300 = 100
// @param uRing1Gain 0..200 = 100
// @param uLineProfile 40..300 = 100
// @param uShear -100..100 = 0
// @param uTrailDriftX -100..100 = 0
// @param uTrailDriftY -100..100 = 0
// @param uVignette 0..100 = 0
// @param uFilmGrain 0..100 = 0
// @param uTrailColor color = #ffffff
// @param uRedColor color = #ffffff
// @param uBlueColor color = #ffffff
// @param uSilverColor color = #ffffff
uniform float uTrapStart; // オービットトラップを取り始める反復 (既定 2)
uniform float uRing2Pos;  // 2 本目の輪郭線の位置 (%)
uniform float uRing3Pos;  // 3 本目の輪郭線の位置 (%)
uniform float uRing2Gain; // 2 本目の輪郭線の濃さ (%)
uniform float uRing3Gain; // 3 本目の輪郭線の濃さ (%)
uniform float uJuliaReal; // ジュリア定数の実部側の大きさ (%)
uniform float uJuliaImag; // ジュリア定数の虚部側の大きさ (%)
uniform float uSliceW;    // 4D 断面の奥行き位置 (%)
uniform float uTailThin;  // 古い残像の線の細さ (%)
uniform float uSilverGain; // シルバー線の濃さ (%)
uniform float uBlueGain;  // 青い線の濃さ (%)
uniform float uRedGain;   // 赤い線の濃さ (%)
uniform float uRotate;    // 模様全体の回転角 (度)
uniform float uCenterX;   // 模様の中心の横位置 (%)
uniform float uCenterY;   // 模様の中心の縦位置 (%)
uniform float uMirror;    // 左右対称の折り返し位置 (%)。+ で左側を、- で右側を折り返す。0 で無効
uniform float uSliceV;    // 4D 断面の奥行き位置 その 2 (%)
uniform float uShading;   // 糸の光が当たる側と影側の差 (%)
uniform float uRing1Gain; // 主輪郭線 (一番内側の線) の濃さ (%)
uniform float uLineProfile; // 線の断面の鋭さ (%)。大きいと芯だけが残り、小さいとふわっと太る
uniform float uShear;     // 模様の斜めの流れ (%)
uniform float uTrailDriftX; // 残像が横へずれていく量 (%)
uniform float uTrailDriftY; // 残像が縦へずれていく量 (%)
uniform float uVignette;  // 周辺の暗がり (%)
uniform float uFilmGrain; // ざらつき (%)
uniform vec3 uTrailColor; // 古い残像ほど強くかかる色味 (掛け算)
uniform vec3 uRedColor;   // 赤い線の色味 (掛け算)
uniform vec3 uBlueColor;  // 青い線の色味 (掛け算)
uniform vec3 uSilverColor; // シルバー線の色味 (掛け算)
mat2 mj_RAWTRAP(mat2 ZR, mat2 ZI, mat2 CR, mat2 CI){
  mat2 CZR = ZR, CZI = ZI;
  mat2 big = mat2(vec2(10000.0), vec2(10000.0));
  if(uTrapStart != 2.0){
    int ts = int(uTrapStart + 0.5);
    for(int i=0;i<70;i++){
      if(i > ts){ big = mj_Zdist(big, CZR, CZI); }
      mj_iterator(CZR, CZI, CR, CI);
    }
    return big;
  }
  for(int i=0;i<70;i++){
    if(i>2){ big = mj_Zdist(big, CZR, CZI); }
    mj_iterator(CZR, CZI, CR, CI);
  }
  return big;
}
mat4 mj_RXY(float t){ return mat4(vec4(cos(t),sin(t),0,0), vec4(-sin(t),cos(t),0,0), vec4(0,0,1,0), vec4(0,0,0,1)); }
mat4 mj_RXZ(float t){ return mat4(vec4(cos(t),0,sin(t),0), vec4(0,1,0,0), vec4(-sin(t),0,cos(t),0), vec4(0,0,0,1)); }
mat4 mj_RXW(float t){ return mat4(vec4(cos(t),0,0,sin(t)), vec4(0,1,0,0), vec4(0,0,1,0), vec4(-sin(t),0,0,cos(t))); }
mat4 mj_RYZ(float t){ return mat4(vec4(1,0,0,0), vec4(0,cos(t),sin(t),0), vec4(0,-sin(t),cos(t),0), vec4(0,0,0,1)); }
mat4 mj_RYW(float t){ return mat4(vec4(1,0,0,0), vec4(0,cos(t),0,sin(t)), vec4(0,0,1,0), vec4(0,-sin(t),0,cos(t))); }
mat4 mj_RZW(float t){ return mat4(vec4(1,0,0,0), vec4(0,1,0,0), vec4(0,0,cos(t),sin(t)), vec4(0,0,-sin(t),cos(t))); }

// トラップ距離 a の等値線を細い「線」として描画
// 複数のリング(a=R1,R2,R3) を重ねて花の輪郭線にする
float mj_line(float a, float wid){
  // 主輪郭(a=0 のリング)
  float L = smoothstep(wid*1.5, 0.0, abs(a)) * (uRing1Gain / 100.0);
  // 補助輪郭(複数の同心輪)で花弁感を出す
  L = max(L, smoothstep(wid, 0.0, abs(a - 0.045 * (uRing2Pos / 100.0))) * 0.7 * (uRing2Gain / 100.0));
  L = max(L, smoothstep(wid*0.8, 0.0, abs(a - 0.095 * (uRing3Pos / 100.0))) * 0.45 * (uRing3Gain / 100.0));
  if(uLineProfile != 100.0){ L = pow(L, uLineProfile / 100.0); }
  return L;
}

// @param uTrails  1..7    = 7.0
// @param uThick   25..300 = 100.0
// @param uFade    10..128 = 100.0
// @param uSpacing 0..300  = 100.0
// @param uGlow    25..300 = 100.0
uniform float uTrails;    // 残像の数 (下げると軽く、尾が短くなる)
uniform float uThick;     // 線の太さ (%)
uniform float uFade;      // 残像の残り方 (%) (大きいほど古い線まで明るい)
uniform float uSpacing;   // 残像どうしの間隔 (%) (0 = 全て重なる)
uniform float uGlow;      // 全体の明るさ・トーンマップの露出 (%)

vec3 bg_matrixjulia(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 st = 4.0 * I / resolution - 2.0;
  vec2 stScr = st;
  if(uShear != 0.0){ st.x += st.y * (uShear / 100.0) * 0.8; }
  if(uMirror != 0.0){ st.x = (uMirror > 0.0 ? 1.0 : -1.0) * abs(st.x - uMirror * 0.005) + uMirror * 0.005; }
  if(uRotate != 0.0){ float ra = radians(uRotate); float rc = cos(ra), rs = sin(ra); st = vec2(rc*st.x - rs*st.y, rs*st.x + rc*st.y); }
  if(uCenterX != 0.0 || uCenterY != 0.0){ st += vec2(uCenterX, uCenterY) * 0.01; }

  // 赤 / 青 / シルバー
  vec3 RED  = vec3(1.0, 0.08, 0.12);
  vec3 BLUE = vec3(0.20, 0.40, 1.0);
  vec3 SIL  = vec3(0.85, 0.88, 0.93);
  if(uRedColor != vec3(1.0)) RED *= uRedColor;
  if(uBlueColor != vec3(1.0)) BLUE *= uBlueColor;
  if(uSilverColor != vec3(1.0)) SIL *= uSilverColor;
  bool trailTint = (uTrailColor != vec3(1.0));

  // 軌跡: 過去 N 時刻の輪郭「線」をフェードしながら累積
  const int TRAILS = 7;
  const float DT   = 0.05;       // 軌跡間隔
  const float FADE = 0.78;       // 古いほど暗く

  vec3 col = vec3(0.0);
  float web = 0.0;   // 立体化(エンボス)用の高さ場 = ラインの累積強度
  for(int k=0; k<TRAILS; k++){
    if(k >= int(uTrails + 0.5)) break;
    float tt = time - float(k) * DT * (uSpacing / 100.0);
    vec4 CST = vec4(st.x, st.y, 0.0, 0.0);
    if(uTrailDriftX != 0.0 || uTrailDriftY != 0.0){ CST.xy += vec2(uTrailDriftX, uTrailDriftY) * (0.0015 * float(k)); }
    float T1 = cos(0.5*tt);
    float T2 = cos(tt*(0.5*23.0/29.0));
    float T3 = cos(tt*(0.5*19.0/29.0));
    float T4 = cos(tt*(0.5*17.0/29.0));
    float T5 = cos(tt*(0.5*13.0/29.0));
    float T6 = cos(tt*(0.5*11.0/29.0));
    CST = mj_RXY(T1)*mj_RXZ(T2)*mj_RXW(T3)*mj_RYZ(T4)*mj_RYW(T5)*mj_RZW(T6)*CST;
    mat2 plane = mat2(vec2(CST.x,CST.z), vec2(CST.y,CST.w));
    mat2 Creal = mat2(vec2(0.1,0.2), vec2(0.3,0.2)) * (uJuliaReal / 100.0);
    mat2 Cimag = mat2(vec2(0.2,0.1), vec2(-0.2,0.1)) * (uJuliaImag / 100.0);
    mat2 Zreal = mat2(plane[0], vec2(0.3,0.2) * (uSliceW / 100.0));
    mat2 Zimag = mat2(plane[1], vec2(0.3,0.15) * (uSliceV / 100.0));
    mat2 RAW = mj_RAWTRAP(Zreal, Zimag, Creal, Cimag);
    float a=RAW[0][0], b=RAW[1][0], c=RAW[0][1], d=RAW[1][1];
    // 古い軌跡ほど線を細く(輪郭感を保ったまま薄く残す)
    float wid = mix(0.012, 0.004 * (uTailThin / 100.0), float(k)/float(TRAILS-1)) * (uThick / 100.0);
    float La = mj_line(a, wid);
    float Lb = mj_line(b, wid);
    float Lc = mj_line(c, wid);
    float Ld = mj_line(d, wid);
    float w = pow(FADE * (uFade / 100.0), float(k));
    // 線そのもの(面ではない)を 4 色で配色
    vec3 trailMul = vec3(1.0);
    if(trailTint){ trailMul = mix(vec3(1.0), uTrailColor, float(k) / float(TRAILS-1)); }
    col += trailMul * (RED*La*(uRedGain / 100.0) + BLUE*Lc*(uBlueGain / 100.0) + SIL*(Lb+Ld)*0.55*(uSilverGain / 100.0)) * w;
    web += (La + Lb + Lc + Ld) * w;
  }

  // === 立体化 + 蜘蛛の糸の光沢 ===
  // 高さ場 web をエンボスして丸い糸の断面法線を作り、糸の稜線に沿って細い異方性ハイライト
  // (シルクの照り)を1本ずつ乗せる。dFdx/dFdy 1 回だけなので軽い。
  float h = clamp(web, 0.0, 1.0);
  vec2 grad = vec2(dFdx(h), dFdy(h));
  vec3 N = normalize(vec3(-grad * 6.0, 1.0));            // 糸の丸み(断面法線)
  vec3 Ldir = normalize(vec3(-0.6, 0.5, 0.8));           // 光源(やや手前)

  // ベースの糸は暗めに(白飛び防止)。明るさは下の細い光沢線で出す=蜘蛛の糸らしい照り。
  float diff = 0.40 + 0.35 * (uShading / 100.0) * max(dot(N, Ldir), 0.0);     // 0.40〜0.75: 糸本体は中間トーンに抑える
  col *= diff;
  // 鋭い(高 power)異方性ハイライト=糸ごとに走る細い光沢線。暗い糸の上で照りが映える。
  float spec = pow(max(dot(reflect(-Ldir, N), vec3(0.0, 0.0, 1.0)), 0.0), 70.0);
  col += vec3(0.85, 0.90, 1.0) * spec * smoothstep(0.12, 0.5, h) * 0.55;
  // 白飛び防止: ハードな純白クリップではなく指数トーンマップで滑らかに圧縮(糸の重なりが白く潰れない)
  col = 1.0 - exp(-max(col, 0.0) * 1.25 * (uGlow / 100.0));
  col = clamp(col, 0.0, 1.0);
  if(uVignette != 0.0){ col *= 1.0 - (uVignette / 100.0) * smoothstep(0.7, 2.6, length(stScr)); }
  if(uFilmGrain != 0.0){ col = clamp(col + (fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * (uFilmGrain / 100.0) * 0.25, 0.0, 1.0); }
  bgAlpha = clamp(web * 2.0, 0.0, 1.0);   // Slot B: 糸のある所だけ不透明(黒背景透過)
  return col;
}
