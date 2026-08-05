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
mat2 mj_RAWTRAP(mat2 ZR, mat2 ZI, mat2 CR, mat2 CI){
  mat2 CZR = ZR, CZI = ZI;
  mat2 big = mat2(vec2(10000.0), vec2(10000.0));
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
  float L = smoothstep(wid*1.5, 0.0, abs(a));
  // 補助輪郭(複数の同心輪)で花弁感を出す
  L = max(L, smoothstep(wid, 0.0, abs(a - 0.045)) * 0.7);
  L = max(L, smoothstep(wid*0.8, 0.0, abs(a - 0.095)) * 0.45);
  return L;
}

vec3 bg_matrixjulia(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 st = 4.0 * I / resolution - 2.0;

  // 赤 / 青 / シルバー
  vec3 RED  = vec3(1.0, 0.08, 0.12);
  vec3 BLUE = vec3(0.20, 0.40, 1.0);
  vec3 SIL  = vec3(0.85, 0.88, 0.93);

  // 軌跡: 過去 N 時刻の輪郭「線」をフェードしながら累積
  const int TRAILS = 7;
  const float DT   = 0.05;       // 軌跡間隔
  const float FADE = 0.78;       // 古いほど暗く

  vec3 col = vec3(0.0);
  float web = 0.0;   // 立体化(エンボス)用の高さ場 = ラインの累積強度
  for(int k=0; k<TRAILS; k++){
    float tt = time - float(k) * DT;
    vec4 CST = vec4(st.x, st.y, 0.0, 0.0);
    float T1 = cos(0.5*tt);
    float T2 = cos(tt*(0.5*23.0/29.0));
    float T3 = cos(tt*(0.5*19.0/29.0));
    float T4 = cos(tt*(0.5*17.0/29.0));
    float T5 = cos(tt*(0.5*13.0/29.0));
    float T6 = cos(tt*(0.5*11.0/29.0));
    CST = mj_RXY(T1)*mj_RXZ(T2)*mj_RXW(T3)*mj_RYZ(T4)*mj_RYW(T5)*mj_RZW(T6)*CST;
    mat2 plane = mat2(vec2(CST.x,CST.z), vec2(CST.y,CST.w));
    mat2 Creal = mat2(vec2(0.1,0.2), vec2(0.3,0.2));
    mat2 Cimag = mat2(vec2(0.2,0.1), vec2(-0.2,0.1));
    mat2 Zreal = mat2(plane[0], vec2(0.3,0.2));
    mat2 Zimag = mat2(plane[1], vec2(0.3,0.15));
    mat2 RAW = mj_RAWTRAP(Zreal, Zimag, Creal, Cimag);
    float a=RAW[0][0], b=RAW[1][0], c=RAW[0][1], d=RAW[1][1];
    // 古い軌跡ほど線を細く(輪郭感を保ったまま薄く残す)
    float wid = mix(0.012, 0.004, float(k)/float(TRAILS-1));
    float La = mj_line(a, wid);
    float Lb = mj_line(b, wid);
    float Lc = mj_line(c, wid);
    float Ld = mj_line(d, wid);
    float w = pow(FADE, float(k));
    // 線そのもの(面ではない)を 4 色で配色
    col += (RED*La + BLUE*Lc + SIL*(Lb+Ld)*0.55) * w;
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
  float diff = 0.40 + 0.35 * max(dot(N, Ldir), 0.0);     // 0.40〜0.75: 糸本体は中間トーンに抑える
  col *= diff;
  // 鋭い(高 power)異方性ハイライト=糸ごとに走る細い光沢線。暗い糸の上で照りが映える。
  float spec = pow(max(dot(reflect(-Ldir, N), vec3(0.0, 0.0, 1.0)), 0.0), 70.0);
  col += vec3(0.85, 0.90, 1.0) * spec * smoothstep(0.12, 0.5, h) * 0.55;
  // 白飛び防止: ハードな純白クリップではなく指数トーンマップで滑らかに圧縮(糸の重なりが白く潰れない)
  col = 1.0 - exp(-max(col, 0.0) * 1.25);
  col = clamp(col, 0.0, 1.0);
  bgAlpha = (uSlotIsA > 0.5) ? 1.0 : clamp(web * 2.0, 0.0, 1.0);   // Slot B: 糸のある所だけ不透明(黒背景透過)
  return col;
}
