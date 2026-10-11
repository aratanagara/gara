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

vec3 bg_crystalnoise(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 R = resolution.xy;
  vec2 uv = (I*2.0 - R) / R.y;

  vec3 ro = vec3(0.0, 0.0, -10.0);
  vec3 rd = normalize(vec3(uv*1.4, 1.0));                    // じゃっかん引き(やや広角)
  float zMax = 30.0, z = 0.1;
  vec3 col = vec3(0.0);
  vec2 m = vec2(time * 0.7);                                 // 速め(スピード感)

  // 形状を徐々に変化させるパラメータ(モーフ)
  float phiK  = 2.0 + 1.0*sin(time*0.11);
  float theK  = 1.5 + 0.6*sin(time*0.07 + 1.0);
  vec3  boxB  = vec3(3.0 + 1.3*sin(time*0.15),
                     3.0 + 1.1*sin(time*0.19 + 1.0),
                     3.0 + 0.9*sin(time*0.13 + 2.0));
  float twk   = -0.2 + 0.3*sin(time*0.05);
  float colK  = 0.4 + 0.2*sin(time*0.09);
  float twAmt = 0.65 + 0.25*sin(time*0.23);                  // ねじれ量(強め・脈動)
  float burst = 0.92 + 0.55*pow(0.5 + 0.5*sin(time*0.55), 4.0); // 周期的な炸裂(鋭く膨張)
  float foldR = (1.2 + 0.5*sin(time*0.17)) * burst;          // 破片フォールド距離(炸裂で膨張)

  for(float i=0.0; i<52.0; i++){               // 軽量化: 100→52 ステップ
    vec3 p = ro + rd * z;
    p.xz *= cn_rotate(m.x);
    p.yz *= cn_rotate(m.y);

    float r = length(p);
    float the = acos(clamp(p.z / max(r, 1e-5), -1.0, 1.0));
    float phi = atan(p.y, p.x);
    phi = phi*phiK + 0.8*sin(phi*1.7 + the*2.3 + time*0.25);  // 角度を非対称に=星形を崩す
    the = the*theK + 0.4*sin(the*1.9 + phi*0.7);
    float st=sin(the), ct=cos(the), sp=sin(phi), cp=cos(phi);
    p = vec3(st*cp*r, st*sp*r, ct*r);
    p.y *= 0.45;                                 // 縦に長く(細長い三角形)

    // ねじれ: z + 半径に沿って xy を回転 → 尖りが螺旋状にねじれる
    p.xy *= cn_rotate(p.z*twAmt + length(p.xz)*0.7 + time*0.4);

    float vacc = 0.0;
    vec3 q = p;
    for(float s=1.0; s<4.0; s++){              // 軽量化: 内側 6→4 オクターブ
      q.xz *= cn_rotate(twk);
      vacc += dot(asin(sin(q*s)), vec3(1.0)) / s;
    }

    p = mix(p, vec3(vacc), 0.30);
    p += 0.28*sin(p.zxy*4.5 + time*0.6);         // 乱流で破片を増やす
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
    p.xy *= cn_rotate(p.z*0.9 + length(p.xy)*1.2 + time*0.2);
    p.yz *= cn_rotate(p.x*0.5 + time*0.15);
    float d = cn_fbox(p, boxB) / scl;
    d = abs(d) + 0.02;

    col += (1.1 + sin(vec3(3.0,2.0,1.0) + cos(p*colK))) / d;

    if(d < 0.001 || z > zMax) break;
    z += d * 0.35;                              // 軽量化: 刻みを大きく(同じ深さを少ない手数で)
  }

  col = tanh(col / 1300.0);                     // ステップ減ぶんの明るさ補正
  // 彩度を落とす
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, 0.35);
  if(abs(uCosGrad) > 0.0001){
    col = mix(col, cosGradColor(lum) * (0.2 + 1.4*lum), abs(uCosGrad));
  }
  // Slot B=透過(輝度をアルファに) / Slot A=不透明(黒背景)
  bgAlpha = clamp(lum * 3.0, 0.0, 1.0);
  return col;
}
