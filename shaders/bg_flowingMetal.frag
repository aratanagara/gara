// =====================================================
// bg_flowingMetal
//   Source : Shadertoy "Flowing metal" https://www.shadertoy.com/view/wdcfzr
//   Author : jarble
//   3D レイマーチ。元は MAX_MARCHING_STEPS=500 で非常に重いので、フリーズ回避のため
//   ステップ数と最大距離を大幅に削減 (90 / 40)。マウス操作は省略し固定カメラ。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン対応。
//   ヘルパは fm_ で名前空間化。
// =====================================================
const int   FM_STEPS = 56;     // 元 500 → 軽量化(さらに削減)
const float FM_MAXD  = 36.0;   // 元 10000 → 近景中心に短縮
const float FM_EPS   = 0.1;

// 元の length 系 SDF (描画保証)。簡略化はフラクタル層の削減で行う。
float fm_sdf1(vec3 p){ return (length(abs(sin(p.yzx)) - abs(cos(p)))) - 1.0; }
float fm_sdf(vec3 p){
  float result = 0.0;
  p.x += 40.0;
  p /= 8.0;
  // フラクタル層を 4→3 に削減 (高周波のギザギザを減らして大きめの形に)。
  float i = 1.0;
  for(int k = 0; k < 3; k++){
    float i1 = i*i;
    float i2 = i1*5.0;
    float tt = time * 0.45;   // うねうね(時間アニメ)を遅く
    p += (sin((p.yzx + tt/i2)/i1) + cos((p.yzx + tt/i2)/i1)) * i1;
    result += fm_sdf1(p*i1)/i1;
    i *= -2.0;
  }
  return -(result - .1) * 2.0;
}
vec3 fm_surfaceColor(vec3 p3){
  p3 = vec3(fm_sdf(p3/7.0), fm_sdf(p3/11.0), fm_sdf(p3/13.0));
  return sin((p3 + .2)/p3.zyx) / 2.0;
}
float fm_march(vec3 eye, vec3 rd, float start, float end){
  float depth = start;
  for(int i = 0; i < FM_STEPS; i++){
    float dist = fm_sdf(eye + depth*rd);
    if(dist < FM_EPS) return depth;
    depth += dist;
    if(depth >= end) return end;
  }
  return end;
}
vec3 fm_normal(vec3 p){
  // SDF 本来の法線をそのまま使用(軸並び sin 擾乱=縞模様の原因は廃止)。
  return normalize(vec3(
    fm_sdf(vec3(p.x+FM_EPS, p.y, p.z)) - fm_sdf(vec3(p.x-FM_EPS, p.y, p.z)),
    fm_sdf(vec3(p.x, p.y+FM_EPS, p.z)) - fm_sdf(vec3(p.x, p.y-FM_EPS, p.z)),
    fm_sdf(vec3(p.x, p.y, p.z+FM_EPS)) - fm_sdf(vec3(p.x, p.y, p.z-FM_EPS))));
}
vec3 fm_phongLight(vec3 kd, vec3 ks, float alpha, vec3 p, vec3 eye, vec3 lp, vec3 li){
  vec3 N = fm_normal(p);
  vec3 L = normalize(lp - p);
  vec3 V = normalize(eye - p);
  vec3 R = normalize(reflect(-L, N));
  float dotLN = dot(L, N), dotRV = dot(R, V);
  if(dotLN < 0.0) return vec3(0.0);
  if(dotRV < 0.0) return li * (kd*dotLN);
  return li * (kd*dotLN + ks*pow(dotRV, alpha));
}
vec3 fm_phong(vec3 ka, vec3 kd, vec3 ks, float alpha, vec3 p, vec3 eye){
  vec3 color = 0.5*vec3(1.0)*ka;
  color += fm_phongLight(kd, ks, alpha, p, eye, vec3(4.0, 2.0, 4.0), vec3(0.4));
  color += fm_phongLight(kd, ks, alpha, p, eye, vec3(2.0*sin(0.37), 2.0*cos(0.37), 2.0), vec3(0.4));
  return color;
}
mat3 fm_view(vec3 eye, vec3 center, vec3 up){
  vec3 f = normalize(center - eye);
  vec3 s = normalize(cross(f, up));
  vec3 u = cross(s, f);
  return mat3(s, u, -f);
}
// 有機的な値ノイズ(グリッドにならない)。苔のまだら用。
float fm_h(vec3 p){ return fract(sin(dot(p, vec3(12.9, 78.2, 37.7))) * 43758.5); }
float fm_noise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
  return mix(mix(mix(fm_h(i+vec3(0,0,0)), fm_h(i+vec3(1,0,0)), f.x),
                 mix(fm_h(i+vec3(0,1,0)), fm_h(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(fm_h(i+vec3(0,0,1)), fm_h(i+vec3(1,0,1)), f.x),
                 mix(fm_h(i+vec3(0,1,1)), fm_h(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fm_fbm(vec3 p){ return 0.5*fm_noise(p) + 0.25*fm_noise(p*2.03) + 0.125*fm_noise(p*4.07); }
// SDF をサンプルした「表面と一緒に流れる」低周波スカラ。苔/土のパッチ駆動に使う。
float fm_flow(vec3 q){ return sin(fm_sdf(q * 0.85) * 1.2 + 1.3) * 0.5 + 0.5; }
vec3 bg_flowingMetal(vec2 fc){
  vec2 I  = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 xy = I - resolution/2.0;
  float z = resolution.y / tan(radians(45.0)/2.0);
  vec3 viewDir = normalize(vec3(xy, -z));
  // カメラの公転 (原点を中心に周回 + ゆるい上下動)。半径は十分大きく取り内部に入らない。
  float ct = time * 0.12;
  vec3 eye = vec3(cos(ct)*3.2, sin(ct*0.5)*1.4, sin(ct)*3.2);
  mat3 v2w = fm_view(eye, vec3(0.0), vec3(0.0, 1.0, 0.0));
  vec3 wd = v2w * viewDir;
  float dist = fm_march(eye, wd, 0.0, FM_MAXD);
  if(dist > FM_MAXD - FM_EPS){
    bgAlpha = (uSlotIsA > 0.5) ? 1.0 : 0.0;   // 背景(ミス)は Slot B で透過(黒キーではなく元から透明)
    return vec3(0.0);
  }
  vec3 p  = eye + dist*wd;

  // === 固有色のある金属(色付きクローム) ===
  vec3 n = fm_normal(p);
  vec3 refl = reflect(wd, n);
  // クローム反射: なめらかなフルレンジのグラデで階調を増やす(2値潰しを回避)。
  float t = clamp(0.5 + 0.5*refl.y, 0.0, 1.0);
  vec3 silver = mix(vec3(0.05, 0.055, 0.07), vec3(0.62, 0.65, 0.72), pow(t, 0.8));
  silver += smoothstep(0.5, 0.9, t) * vec3(0.12);   // ソフトな明るい帯
  silver += pow(t, 6.0) * vec3(0.14);               // 天頂のグロー
  // 苔のうごめき: SDF同期(p)に加え、時間で蠢く有機的ワープを足した苔用座標 pm。
  vec3 wig = vec3(fm_fbm(p*1.3 + vec3(time*0.30, 0.0, 0.0)),
                  fm_fbm(p*1.3 + vec3(0.0, time*0.24, 11.0)),
                  fm_fbm(p*1.3 + vec3(23.0, 0.0, -time*0.27))) - 0.5;
  vec3 pm = p + wig * 0.8;

  // 苔色(茶 → 緑 → ライム)を表面構造にマップ。
  vec3 sc = fm_surfaceColor(pm);
  float m = clamp(dot(sc, vec3(0.5)) + 0.5, 0.0, 1.0);
  vec3 brown = vec3(0.20, 0.13, 0.05);
  vec3 green = vec3(0.13, 0.28, 0.08);
  vec3 lime  = vec3(0.42, 0.60, 0.16);
  vec3 moss  = (m < 0.5) ? mix(brown, green, m*2.0) : mix(green, lime, (m - 0.5)*2.0);
  vec3 dirt  = vec3(0.32, 0.22, 0.11);
  // ボコボコ・隆起: 大きな隆起(lump) + 細かいザラつき(gr)、ノイズ勾配で強いバンプ陰影。
  float lump = fm_fbm(pm*4.0);
  float gr   = fm_fbm(pm*10.0)*0.55 + fm_fbm(pm*26.0)*0.45;
  float bE = 0.025, b0 = fm_fbm(pm*10.0);
  vec3 grad3 = (vec3(fm_fbm(pm*10.0+vec3(bE,0,0)), fm_fbm(pm*10.0+vec3(0,bE,0)), fm_fbm(pm*10.0+vec3(0,0,bE))) - b0) / bE;
  vec3 bn = normalize(n + grad3 * 1.6);                  // 強いバンプ=ボコボコ
  float bdiff = clamp(dot(bn, normalize(vec3(0.4, 0.7, 0.5))), 0.0, 1.0);
  float bsh = 0.16 + 1.10 * bdiff;                       // 強コントラストの凹凸陰影
  float ao  = 0.50 + 0.60 * smoothstep(0.25, 0.78, lump); // 谷を暗く=隆起感(AO)
  // 反射は使わずマット拡散(=表面に貼り付いた質感)。金属の反射模様を拾わない。
  moss = moss * (0.6 + 1.3*gr) * bsh * ao;
  dirt = dirt * (0.55 + 1.4*gr) * bsh * ao;

  // パッチマスクは SDF同期 + うごめき座標 pm で駆動 → 苔/土が表面と動きつつ蠢く。
  float mossMask = smoothstep(0.74, 0.86, fm_flow(pm));
  float dirtMask = smoothstep(0.74, 0.86, fm_flow(pm + 40.0)) * (1.0 - mossMask*0.8);

  // 金属(クローム)ベースに、苔・土をマットで「置換」合成(乗算しない=反射しない)。
  vec3 col = silver;
  col = mix(col, moss, mossMask);
  col = mix(col, dirt, dirtMask);
  float matte = max(mossMask, dirtMask);

  // 隆起感: パッチの光源側にドロップシャドウ + 縁のリム光彩。
  vec3 sOff = normalize(vec3(0.4, 0.7, 0.5)) * 0.25;     // 光源方向へオフセット
  float mossL = smoothstep(0.74, 0.86, fm_flow(pm + sOff));
  float dirtL = smoothstep(0.74, 0.86, fm_flow(pm + sOff + 40.0)) * (1.0 - mossL*0.8);
  float matteL = max(mossL, dirtL);
  float drop = clamp(matteL - matte, 0.0, 1.0);          // 隣(光源側)がパッチで自分は金属=影
  col *= 1.0 - drop * 0.55;                              // ドロップシャドウ
  float rim = matte * (1.0 - matte) * 4.0;               // パッチ境界
  col += rim * vec3(0.7, 0.8, 0.55) * 0.22;              // 縁のリム光彩(隆起の照り)

  float spec = pow(clamp(dot(refl, normalize(vec3(0.5, 0.7, 0.4))), 0.0, 1.0), 60.0)
             + pow(clamp(dot(refl, normalize(vec3(-0.4, 0.6, 0.5))), 0.0, 1.0), 40.0);
  col += spec * (1.0 - 0.85*matte) * vec3(1.0) * 0.55;
  float fres = pow(1.0 - clamp(abs(dot(n, wd)), 0.0, 1.0), 4.0);
  col += fres * (1.0 - 0.6*matte) * vec3(0.8, 0.85, 0.95) * 0.22;
  bgAlpha = 1.0;                              // 金属表面はヒット=不透明
  return clamp(col, 0.0, 1.0);
}
