// =====================================================
// bg_crystalnoise  (H53)
//   Source : Shadertoy "Fork Fork 水晶噪音"  https://www.shadertoy.com/view/Wf3yz4
//   球面座標ワープ + 入れ子 sin SDF を box SDF でレイマーチした結晶状グロー。
//   改変(形状のみ): ねじれ(twist) + 折り返しフォールドで破片・断片化した宝石 /
//        速度感のある回転 / 形状を徐々にモーフ。彩度・Slot B 透過は元のまま。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   cosineGradient(uCosGrad)対応。ヘルパは cn_ で名前空間化。
// =====================================================

mat2  cn_rotate(float a){ float s=sin(a), c=cos(a); return mat2(c,-s,s,c); }
float cn_vmax(vec3 v){ return max(max(v.x, v.y), v.z); }
float cn_fbox(vec3 p, vec3 b){ return cn_vmax(abs(p) - b); }

// @param uDetail  1..3     = 3.0
// @param uTwist   0..250   = 100.0
// @param uFold    0..200   = 100.0
// @param uStretch 20..200  = 100.0
// @param uGlow    25..300  = 100.0
// @param uAngle -180..180 = 0.0
// @param uScale 50..150 = 100.0
// @param uSteps 20..52 = 52.0
// @param uArmCount 80..130 = 100
// @param uRingCount 80..130 = 100
// @param uPhiWobble 0..250 = 100
// @param uTheWobble 0..250 = 100
// @param uThirdTwist 0..300 = 100
// @param uMeltMix 0..250 = 100
// @param uShatterAmp 0..250 = 100
// @param uShatterFreq 60..160 = 100
// @param uFacetColor 40..250 = 100
// @param uTwistRadial 0..300 = 100
// @param uSecondTwist 0..250 = 100
// @param uShellThick 30..300 = 100
// @param uChanMix 0..100 = 0
// @param uSolarize 0..100 = 0
// @param uPosterize 0..8 = 0
// @param uVignette 0..100 = 0
// @param uGrain 0..100 = 0
// @param uCrystalTint color = #ffffff
// @param uHighTint color = #ffffff
// @param uShadowTint color = #ffffff
uniform float uDetail;    // 内側の sin 重ね回数 (下げると軽く、形が単純になる)
uniform float uTwist;     // ねじれ量 (%)
uniform float uFold;      // 破片フォールドの距離 (%)
uniform float uStretch;   // 縦方向の伸び (%)
uniform float uGlow;      // 発光の強さ (%)
uniform float uAngle; // 形全体の向き (度。固定角でずらす)
uniform float uScale; // 結晶全体の大きさ (%。カメラは動かない)
uniform float uSteps; // レイマーチのステップ数 (下げると軽く、光の積算が減って暗くなる)
uniform float uArmCount; // 星形の腕 (経度方向の折り返し) の数 (%)
uniform float uRingCount; // 緯度方向の輪の数 (%)
uniform float uPhiWobble; // 腕の崩れ (非対称なゆがみ) の量 (%)
uniform float uTheWobble; // 輪の崩れ (緯度方向のゆがみ) の量 (%)
uniform float uThirdTwist; // 折り返し後の YZ 面のねじれ (%)
uniform float uMeltMix; // 入れ子 sin による溶け込みの量 (%)
uniform float uShatterAmp; // 破片を増やす乱流の振れ幅 (%)
uniform float uShatterFreq; // 破片の細かさ (%)
uniform float uFacetColor; // 面ごとの色の変わる細かさ (%)
uniform float uTwistRadial; // 半径に沿ったねじれ (%)
uniform float uSecondTwist; // 折り返し後の 2 回目のねじれ (%)
uniform float uShellThick; // 結晶の殻の厚み (%)
uniform float uChanMix; // 色チャンネルの入れ替えを混ぜる量 (%)。色の配置が変わる
uniform float uSolarize; // 明暗を折り返して反転させる量 (%)
uniform float uPosterize; // 色の段数 (0 で連続)
uniform float uVignette; // 周辺減光 (%)
uniform float uGrain; // 画面のざらつき (%)
uniform vec3 uCrystalTint; // 結晶の光に掛ける色
uniform vec3 uHighTint; // 明るい部分に掛ける色
uniform vec3 uShadowTint; // 暗い部分に掛ける色

vec3 bg_crystalnoise(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 R = resolution.xy;
  vec2 uv = (I*2.0 - R) / R.y;

  vec3 ro = vec3(0.0, 0.0, -10.0);
  vec3 rd = normalize(vec3(uv*1.4, 1.0));                    // じゃっかん引き(やや広角)
  float zMax = 30.0, z = 0.1;
  vec3 col = vec3(0.0);
  vec2 m = vec2(time * 0.7 + radians(uAngle), time * 0.7);                                 // 速め(スピード感)

  // 形状を徐々に変化させるパラメータ(モーフ)
  float phiK  = 2.0 + 1.0*sin(time*0.11);
  float theK  = 1.5 + 0.6*sin(time*0.07 + 1.0);
  vec3  boxB  = vec3(3.0 + 1.3*sin(time*0.15),
                     3.0 + 1.1*sin(time*0.19 + 1.0),
                     3.0 + 0.9*sin(time*0.13 + 2.0));
  float twk   = -0.2 + 0.3*sin(time*0.05);
  float colK  = 0.4 + 0.2*sin(time*0.09);
  float twAmt = (0.65 + 0.25*sin(time*0.23)) * (uTwist / 100.0);                  // ねじれ量(強め・脈動)
  float burst = 0.92 + 0.55*pow(0.5 + 0.5*sin(time*0.55), 4.0); // 周期的な炸裂(鋭く膨張)
  float foldR = (1.2 + 0.5*sin(time*0.17)) * burst * (uFold / 100.0);          // 破片フォールド距離(炸裂で膨張)

  for(float i=0.0; i<52.0; i++){               // 軽量化: 100→52 ステップ
    if(i >= floor(uSteps + 0.5)) break;
    vec3 p = (ro + rd * z) / (uScale / 100.0);
    p.xz *= cn_rotate(m.x);
    p.yz *= cn_rotate(m.y);

    float r = length(p);
    float the = acos(clamp(p.z / max(r, 1e-5), -1.0, 1.0));
    float phi = atan(p.y, p.x);
    phi = phi*(phiK * (uArmCount / 100.0)) + 0.8*(uPhiWobble / 100.0)*sin(phi*1.7 + the*2.3 + time*0.25);  // 角度を非対称に=星形を崩す
    the = the*(theK * (uRingCount / 100.0)) + 0.4*(uTheWobble / 100.0)*sin(the*1.9 + phi*0.7);
    float st=sin(the), ct=cos(the), sp=sin(phi), cp=cos(phi);
    p = vec3(st*cp*r, st*sp*r, ct*r);
    p.y *= 0.45 * (uStretch / 100.0);                                 // 縦に長く(細長い三角形)

    // ねじれ: z + 半径に沿って xy を回転 → 尖りが螺旋状にねじれる
    p.xy *= cn_rotate(p.z*twAmt + length(p.xz)*0.7*(uTwistRadial / 100.0) + time*0.4);

    float vacc = 0.0;
    vec3 q = p;
    for(float s=1.0; s<4.0; s++){              // 軽量化: 内側 6→4 オクターブ
      if(s > uDetail + 0.5) break;
      q.xz *= cn_rotate(twk);
      vacc += dot(asin(sin(q*s)), vec3(1.0)) / s;
    }

    p = mix(p, vec3(vacc), 0.30 * (uMeltMix / 100.0));
    p += 0.28*(uShatterAmp / 100.0)*sin(p.zxy*4.5*(uShatterFreq / 100.0) + time*0.6);         // 乱流で破片を増やす
    // 破片化(星型を減らすため 1 回)。abs フォールド + 非対称回転で無秩序に。
    float scl = 1.0;
    for(int f = 0; f < 1; f++){
      p.yz *= cn_rotate(0.7);                              // 軸をずらし鏡面を非対称に(星形抑制)
      p = abs(p) - foldR*vec3(1.0, 0.6, 0.3);
      p.xy *= cn_rotate(0.9 + float(f)*1.7 + time*0.13);   // 角度をバラバラに=無秩序
      p.xz *= cn_rotate(0.5 - float(f)*1.1 - time*0.07);
      p *= 1.32;
      scl *= 1.32;
    }
    // 折り返し後に強くねじる(2軸) → 尖りが螺旋に
    p.xy *= cn_rotate(p.z*0.9*(uSecondTwist / 100.0) + length(p.xy)*1.2 + time*0.2);
    p.yz *= cn_rotate(p.x*0.5*(uThirdTwist / 100.0) + time*0.15);
    float d = cn_fbox(p, boxB) / scl;
    d = abs(d) + 0.02 * (uShellThick / 100.0);
    float dm = d * (uScale / 100.0);

    col += (1.1 + sin(vec3(3.0,2.0,1.0) + cos(p*(colK * (uFacetColor / 100.0))))) / d;

    if(dm < 0.001 || z > zMax) break;
    z += dm * 0.35;                              // 軽量化: 刻みを大きく(同じ深さを少ない手数で)
  }

  if(uCrystalTint != vec3(1.0)) col *= uCrystalTint;
  col = tanh(col * (uGlow / 100.0) / 1300.0);                     // ステップ減ぶんの明るさ補正
  // 彩度を落とす
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, 0.35);
  if(uChanMix != 0.0) col = mix(col, col.brg, uChanMix / 100.0);
  if(uSolarize != 0.0) col = mix(col, abs(col * 2.0 - 1.0), uSolarize / 100.0);
  if(uPosterize != 0.0){
    float pl = max(uPosterize, 2.0);
    col = floor(col * pl + 0.5) / pl;
  }
  if(uHighTint != vec3(1.0) || uShadowTint != vec3(1.0)) col *= mix(uShadowTint, uHighTint, smoothstep(0.1, 0.6, lum));
  if(uVignette != 0.0){
    vec2 vq = fc / resolution.xy - 0.5;
    col *= 1.0 - (uVignette / 100.0) * smoothstep(0.25, 0.8, length(vq));
  }
  if(uGrain != 0.0){
    float gh = fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453);
    col = max(col + (gh - 0.5) * (uGrain / 100.0) * 0.5 * (0.15 + lum), 0.0);
  }
  if(abs(uCosGrad) > 0.0001){
    col = mix(col, cosGradColor(lum) * (0.2 + 1.4*lum), abs(uCosGrad));
  }
  // Slot B=透過(輝度をアルファに) / Slot A=不透明(黒背景)
  bgAlpha = clamp(lum * 3.0, 0.0, 1.0);
  return col;
}
