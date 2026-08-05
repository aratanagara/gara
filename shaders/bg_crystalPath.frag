// Shadertoy sXBGDV "crystal path" — IFS raymarcher with reflections。
// Source : https://www.shadertoy.com/view/sXBGDV
// 元は Buffer A + 5x5 bloom の 2 パス構成。bloom はポストFX側に任せ、
// Buffer A 相当をそのまま 1 パスで描画する。
vec3 cpIfsColor, cpRo, cpColor;
float cpSides;
float cpTriRot;   // セルごとのチューブ断面 (三角形) のランダム回転
float cpCov;      // Slot B 透過用カバレッジ (ヒット=1 / 背景=0)

mat2 cpRot(float a){ return mat2(cos(a),-sin(a),sin(a),cos(a)); }

#define CP_PHI 1.61803398874989

// メッシュ風: 中空のチューブ/リング構造にして粉状の点ではなく線/網に
//   abs(p)+offset で 8 octant に放射配置、abs(faceDist - r) で壁厚のあるシェルに
float cp_d12(vec3 p){
  vec3 a = vec3(0.0, CP_PHI - 1.0, CP_PHI);
  p = abs(p) - a;
  float y = abs(p.y);
  float rad = 0.13 * (0.45 + 0.55*max(0.0, 1.0 - y*1.1));
  float thick = 0.150;        // 壁厚 (メッシュの線の太さ)
  // 断面を正三角形に: セルごとにランダム回転 (cpTriRot)
  vec2 q = p.xz;
  float ang = atan(q.x, q.y) + cpTriRot;
  float seg = 6.28318530718 / 3.0;
  float faceDist = cos(floor(0.5 + ang/seg)*seg - ang) * length(q);
  return abs(faceDist - rad) - thick;
}

float cp_de(vec3 pos, float iters){
  float shell = length(pos-cpRo) - 0.01;
  vec3 tpos = pos;
  float dd = 8.5;     // セル間隔 (大きいほどオブジェクトが疎に)
  vec3 id = round(tpos/dd);
  tpos.xz -= dd*id.xz;
  float h1 = fract(sin(dot(id, vec3(12.9898,78.233,37.719)))*43758.5453);
  float h2 = fract(sin(dot(id, vec3(39.346,11.135,83.155)))*24634.6345);
  cpSides = 3.0 + floor(h1*4.0);
  cpTriRot = h2 * 6.28318;   // 三角形断面のランダム回転
  tpos.xy *= cpRot(h1*6.28318);
  tpos.yz *= cpRot(h2*6.28318);
  tpos.xz *= cpRot(2.2*tpos.y);   // 強いねじれ
  vec4 p = vec4(tpos, 1.0);
  for(float i=0.0;i<iters;i++){
    p.xz = clamp(p.xz, -0.9, 0.9)*2.0 - p.xz;
    p = p*2.7/clamp(dot(p.xyz,p.xyz), 0.6, 3.0);
  }
  float fr = cp_d12(p.xzy) / p.w;
  cpIfsColor = vec3( log(p.w)*2.0 + 2.0*length(p.xz)*vec3(1.0,2.0,2.4) );
  return max(-shell, fr);
}

vec3 cp_abnormal(vec3 p, float iters){
  vec2 dx = vec2(1,-1);
  vec2 dp = 0.001*dx;
  return normalize(
      dx.xyy*cp_de(p+dp.xyy, iters)
    + dx.yyx*cp_de(p+dp.yyx, iters)
    + dx.yxy*cp_de(p+dp.yxy, iters)
    + dx.xxx*cp_de(p+dp.xxx, iters));
}

// シルバーグレー 70% を基調に、#3f00ff (群青) とマゼンタを差し色として使うパレット
//   ピークは狭く控えめ、見た目の大半がシルバー
vec3 cpPal(float t){
  t = fract(t);
  const vec3 GRAY  = vec3(0.90, 0.92, 0.97);    // メタリックシルバー (高明度)
  const vec3 BLUE  = vec3(0.122, 0.122, 1.0);   // #1f1fff
  const vec3 MAG   = vec3(1.00, 0.15, 0.75);    // 鮮やかなマゼンタ
  vec3 base = GRAY;
  // 群青ピーク: 狭めて純度を上げる (中心 0.55、幅 ±0.10)
  float wB = smoothstep(0.10, 0.0, abs(t - 0.55));
  base = mix(base, BLUE, wB * 1.0);
  // マゼンタアクセント (中心 0.25、幅 ±0.05、純度高め)
  float wM = smoothstep(0.05, 0.0, abs(t - 0.25));
  base = mix(base, MAG, wM * 1.0);
  return base;
}

void cp_march(vec3 ro, vec3 rd){
  // 背景は黒
  cpColor = vec3(0.0);
  cpCov = 0.0;
  float t = 0.0, numRF = 0.0;
  // tint はほぼニュートラル (シルバー基調を維持)。反射のたびに僅かに青寄り
  vec3 tint = vec3(0.95, 0.96, 1.02);
  for(float i=0.0;i<40.0;i++){
    vec3 p = ro + rd*t;
    float d = cp_de(p, 1.0);
    cpIfsColor = cos(cpIfsColor/3.0);
    cpIfsColor *= cpIfsColor;
    if(d < 1e-5){
      if(numRF > 1.0) break;
      // パレットから色を取得 (cpIfsColor の輝度を位相に使う)
      float ph = 0.20 + 0.60 * dot(cpIfsColor, vec3(0.299, 0.587, 0.114));
      vec3 surf = cpPal(ph);
      vec3 nn = cp_abnormal(p, 1.0);
      vec3 ld = normalize(vec3(0.4, 0.7, -0.5));
      float dif = 0.6 + 0.4*max(dot(nn, ld), 0.0);
      // メタリック: 金属らしい鋭い鏡面ハイライト (Blinn-Phong)。
      // 鋭いコア + 広いグレアの二段重ねでギラつきを強調。
      vec3 hlf = normalize(ld - rd);
      float ndh = max(dot(nn, hlf), 0.0);
      float spec  = pow(ndh, 120.0);   // 鋭いコア (ハイライトの芯)
      float glare = pow(ndh, 20.0);    // 広いグレア (周囲の滲み)
      surf += spec  * vec3(1.05, 1.08, 1.15) * 1.6;
      surf += glare * vec3(0.85, 0.90, 1.02) * 0.7;
      // Fresnel: エッジを金属的に強く持ち上げ + マゼンタの差し色
      float fres = pow(1.0 - max(dot(nn, -rd), 0.0), 3.0);
      surf = surf * (1.0 + fres * 0.6) + vec3(0.06, 0.07, 0.10) * fres;
      surf = mix(surf, vec3(1.00, 0.20, 0.78), fres * 0.22);
      // 加算ではなく mix で合成 (チャンネル飽和→白線を防ぐ)
      // 距離フォグで遠方のサブピクセル粉をフェード
      float fog = smoothstep(8.0, 2.0, t);
      vec3 contrib = surf * tint * dif * fog;
      cpColor = mix(cpColor, contrib, 0.75 * fog);
      cpCov = mix(cpCov, 1.0, 0.75 * fog);   // カバレッジも同係数で蓄積(Slot B 透過用)
      tint *= vec3(0.85, 0.88, 1.02);
      rd = reflect(rd, nn);
      t -= 0.001;
      numRF++;
    }
    t += d * 0.45;   // 強ねじれで歪む距離推定に対応 (波打ち防止)
  }
}

vec3 bg_crystalPath(vec2 fc){
  float T = randomMoveTime(getBeat(), 0.12, 521.0);
  vec2 p = (2.0*fc - resolution.xy)/resolution.y;
  p /= bgZoom;
  p += bgCamPx/resolution.y * 2.0;

  // 空間の内側を円を描いて公転するカメラ。公転面の軸を時間でゆっくり回す。
  float bA = getBeat();
  float orbit = bA * 0.22;                       // 円運動の角度 (連続回転)
  float rad = 0.75 + 0.2*sin(bA*0.05);           // 公転半径 (内側を保つ)
  vec3 fly = vec3(cos(orbit), 0.0, sin(orbit)) * rad;
  // 公転面の傾き (軸回転): スムーズ乱数でゆっくり揺らす
  float ax = 0.9*sin(randomMoveTime(bA, 0.03, 17.0));
  float ay = 0.9*sin(randomMoveTime(bA, 0.03, 53.0));
  fly.yz *= cpRot(ax);
  fly.xy *= cpRot(ay);
  cpRo = vec3(0.061, -0.18, 0.0) + fly;
  cpColor = vec3(0.0);
  cpIfsColor = vec3(0.0);

  // ズーム率もランダムに変動 (zoom 用に別シードの randomMoveTime を使う)
  //   focal が大きいほどズームイン (狭画角)、小さいほどズームアウト (広角)。
  //   0.30 (大きく引き) 〜 4.00 (大きく寄り) のレンジで周期的に揺れる。
  float Tz = randomMoveTime(getBeat(), 0.08, 137.0);
  float focal = mix(0.30, 4.00, 0.5 + 0.5*sin(Tz));
  vec3 rd = normalize(vec3(p, focal));
  rd.xy *= cpRot(0.6*sin(T*0.9) + 0.4*T);
  rd.yz *= cpRot(0.2 + 0.7*sin(T*1.3));
  rd.xz *= cpRot(-0.5 + 1.1*sin(T*0.95));

  cp_march(cpRo, rd);
  // 彩度を保ったまま 1.0 上限へ正規化 (どこか 1.0 を超えるときに全チャンネルを按分縮小)
  vec3 col = max(cpColor, vec3(0.0));
  float mx = max(max(col.r, col.g), col.b);
  if(mx > 1.0) col /= mx;
  bgAlpha = (uSlotIsA > 0.5) ? 1.0 : clamp(cpCov, 0.0, 1.0);   // Slot B は結晶のみ(背景透過)
  return col;
}
