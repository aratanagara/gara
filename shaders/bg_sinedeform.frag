// =====================================================
// bg_sinedeform  (H35)
//   多重 sin ドメイン変形チューブのレイマーチ(自前実装)。
//   "うねる虹色チューブ" の質感を、独自の周波数・位相・マーチ戦略・
//   パレットで構成。色は虹色グラデ、背景は白ドーム。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは sd_ で名前空間化。
// =====================================================

// 多重 sin によるドメイン変形(独自の周波数/位相/swizzle)
// @param uWarp     0..150  = 100.0
// @param uThick    40..120 = 100.0
// @param uDensity  0..300  = 100.0
// @param uContrast 40..200 = 100.0
// @param uGlow     25..250 = 100.0
// @param uAngle -180..180 = 0.0
// @param uScale 50..110 = 100.0
// @param uSteps 120..256 = 256.0
// @param uWaveAmp 0..250 = 100.0
// @param uWaveFreq 40..200 = 100.0
// @param uTubeStretch 50..150 = 100.0
// @param uCoarseWarp 40..160 = 100.0
// @param uFineWarp 0..220 = 100.0
// @param uCoilFreq 70..130 = 100.0
// @param uTubeSquare 0..100 = 0.0
// @param uTubeFlat -40..70 = 0.0
// @param uSssGlow 0..250 = 100.0
// @param uAoReach 85..200 = 100.0
uniform float uWarp;      // うねり (ドメイン変形) の強さ (%)
uniform float uThick;     // チューブの太さ (%)
uniform float uDensity;   // 虹色の帯の密度 (%。0 で一色)
uniform float uContrast;  // トーンマップのガンマ (%)
uniform float uGlow;      // 拡散光の強さ (%)
uniform float uAngle; // チューブの向き (度。固定角でずらす)
uniform float uScale; // チューブ全体の大きさ (%。カメラは動かない)
uniform float uSteps; // レイマーチのステップ数 (下げると軽く、尽きた光線は外れ扱いで面が欠ける)
uniform float uWaveAmp; // 全体の大きな蛇行の振れ幅 (%)
uniform float uWaveFreq; // 蛇行の波長の細かさ (%)
uniform float uTubeStretch; // チューブの長手方向の伸縮 (%)
uniform float uCoarseWarp; // いちばん大きいうねりの振れ幅 (%)
uniform float uFineWarp; // 細かいうねり (後ろ 2 段) の振れ幅 (%)
uniform float uCoilFreq; // 大きいうねりの周期の細かさ (%)
uniform float uTubeSquare; // 断面を四角に寄せる量 (%)
uniform float uTubeFlat; // 断面を平たく / 縦長にする (%)。正で平たく、負で細く
uniform float uSssGlow; // 縁の暖色の透け感 (%)
uniform float uAoReach; // 陰影 (AO) の届く距離 (%)

vec3 sd_warp(vec3 p){
  float t = time;
  p.y += 0.45*(uWaveAmp / 100.0)*sin(0.6*(uWaveFreq / 100.0)*p.x - 0.9*t);
  p.x *= 0.62 * (uTubeStretch / 100.0);
  p += 0.90*(uCoarseWarp / 100.0)*(uWarp / 100.0)*sin(1.8*(uCoilFreq / 100.0)*p.yzx + vec3(0.0, 0.0, 1.7*t));
  p += 0.42*(uWarp / 100.0)*sin(3.3*p.zxy + vec3(0.0, 0.0, 0.9*t));
  p += 0.21*(uFineWarp / 100.0)*(uWarp / 100.0)*sin(5.1*p.yzx + vec3(0.0, 0.0, 0.5*t));
  p += 0.10*(uFineWarp / 100.0)*(uWarp / 100.0)*sin(6.7*p.zxy + vec3(0.0, 0.0, 0.2*t));
  return p;
}

// チューブ SDF(歪み場なので保守係数で overshoot を抑制)
float sd_map(vec3 p){
  float sc = uScale / 100.0;
  vec3 q = sd_warp(p / sc);
  vec2 yz = q.yz;
  if(uTubeFlat != 0.0) yz.y *= 1.0 + uTubeFlat / 100.0;
  float L = length(yz);
  if(uTubeSquare != 0.0) L = mix(L, max(abs(yz.x), abs(yz.y)), uTubeSquare / 100.0);
  return (L - 2.3 * (uThick / 100.0)) * 0.025 * sc;
}

// 4-tap tetrahedron normal
vec3 sd_nor(vec3 p){
  vec2 e = vec2(1.0, -1.0) * 0.0015;
  return normalize( e.xyy*sd_map(p + e.xyy) +
                    e.yyx*sd_map(p + e.yyx) +
                    e.yxy*sd_map(p + e.yxy) +
                    e.xxx*sd_map(p + e.xxx) );
}

// distance march(understep で歪み場の飛び越しを抑制)
float sd_trace(vec3 ro, vec3 rd){
  float t = 2.0;
  for(int i = 0; i < 256; i++){
    if(i >= int(uSteps + 0.5)) break;
    float d = sd_map(ro + rd*t);
    if(d < 0.0006) return t;
    t += d * 0.5;
    if(t > 8.0) break;
  }
  return -1.0;
}

// 簡易 AO(複数方向に距離場をサンプル。下限を持たせ完全遮蔽=黒を防止)
float sd_ao(vec3 p, vec3 n){
  float h = 0.22 * (uAoReach / 100.0);
  float ao = 0.0;
  for(int i = 0; i < 6; i++){
    vec3 dir = sin( float(i)*vec3(2.1, 5.7, 11.3) + vec3(1.0, 2.0, 4.0) );
    dir *= sign(dot(dir, n));
    ao += max(0.0, h - sd_map(p + h*dir)*2.0);
  }
  return clamp(2.7 - 2.0*ao, 0.15, 1.0);
}

// パレットのグレー(背景と共有)
const vec3 SD_GRAY = vec3(0.52, 0.52, 0.56);

// 浅葱 → 青 → グレー → マゼンタ の循環グラデ
vec3 sd_pal(float x){
  vec3 c0 = vec3(0.12, 0.70, 0.78); // 浅葱
  vec3 c1 = vec3(0.12, 0.24, 0.95); // 青
  vec3 c2 = SD_GRAY;                 // グレー
  vec3 c3 = vec3(0.92, 0.14, 0.62); // マゼンタ
  float f = fract(x) * 4.0;
  float k = fract(f); k = k*k*(3.0 - 2.0*k);
  int i = int(floor(f));
  vec3 a = i==0 ? c0 : (i==1 ? c1 : (i==2 ? c2 : c3));
  vec3 b = i==0 ? c1 : (i==1 ? c2 : (i==2 ? c3 : c0));
  return mix(a, b, k);
}

vec3 bg_sinedeform(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 p = (2.0*I - resolution.xy) / resolution.y;
  float aS = radians(uAngle);
  p = mat2(cos(aS), -sin(aS), sin(aS), cos(aS)) * p;

  vec3 ro = vec3(0.0, 0.0, 4.5);
  vec3 rd = normalize( vec3(p.xy, -2.0) );

  vec3 col = vec3(0.0);                   // 背景は黒 (entrypoint が uBgColor で塗る)
  bgAlpha = 0.0;                          // 背景は透明

  float t = sd_trace(ro, rd);
  if(t > 0.0){
    bgAlpha = 1.0;                        // チューブ本体は不透明
    vec3 pos = ro + t*rd;
    vec3 nor = sd_nor(pos);
    vec3 uvw = sd_warp(pos / (uScale / 100.0));

    vec3 mate = sd_pal(uvw.y*0.12*(uDensity / 100.0));
    mate = pow(mate, vec3(2.2));

    float occ = sd_ao(pos, nor);
    float fre = clamp(1.0 + dot(nor, rd), 0.0, 1.0);
    vec3  ref = reflect(rd, nor);

    col = vec3(0.0);
    float dif = max(0.0, 0.2 + 0.8*nor.y) * occ;
    float spe = pow(max(0.0, ref.y), 14.0) * occ * (0.04 + 0.96*pow(fre, 5.0));
    col += 3.6*(uGlow / 100.0)*mate*dif;                                 // diffuse(dome)
    col += spe*1.6;                                      // 鏡面ハイライト
    col += mate*occ*(0.5 + 0.5*nor.y);                  // ambient(常に≥0)
    col += mate*(1.1*(uSssGlow / 100.0))*fre*fre*vec3(1.0, 0.82, 0.66)*occ;  // sss(暖色)

    col = pow(col, vec3(0.30, 0.42, 0.5) * (uContrast / 100.0));              // トーンマップ
  }

  vec2 q = I / resolution.xy;
  col *= 0.5 + 0.5*pow( 16.0*q.x*q.y*(1.0-q.x)*(1.0-q.y), 0.2 );

  return col;
}
