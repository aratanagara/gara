// =====================================================
// bg_spikeball  (H48)
//   Source : Shadertoy "Triplanar Displacement Mapping"
//            https://www.shadertoy.com/view/3dlGWH  (Matthew Arcus, 2018)
//   改変: 元はテクスチャ変位だがチャンネル未接続。変位を手続きノイズの「棘」に置換し、
//         棘の高さを音声(uFFT の低〜中域)で駆動 → 音に反応して棘が伸びる。
//         表面を強烈なクローム化 / cosineGradient(uCosGrad)対応 / 背景透過(bgAlpha)。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは sb_ で名前空間化。
// =====================================================

float sb_amp;   // 棘の振幅(bg_spikeball で音声から設定する可変グローバル)
float sb_core;  // 核(球)の半径(音が大きいほど縮めて棘の塊に埋もれさせる)

vec3 sb_hash3(vec3 p){
  p = vec3(dot(p, vec3(127.1,311.7,74.7)),
           dot(p, vec3(269.5,183.3,246.1)),
           dot(p, vec3(113.5,271.9,124.6)));
  return fract(sin(p)*43758.5453);
}

// 方向 n に対する突起(棘)高さ。各セルに円錐状の鋭い棘を立て、位置/高さ/有無をランダム化(非一様)。
float sb_disp(vec3 n){
  // ゆっくり回転する格子
  float a = time*0.22;
  float ca = cos(a), sa = sin(a);
  n.xz = mat2(ca, -sa, sa, ca) * n.xz;
  vec3 q = n * 7.5;                        // 太く大きめの結晶(少なめ)
  vec3 cell = floor(q + 0.5);              // 最寄りセル
  vec3 rnd  = sb_hash3(cell);              // セルごとの乱数 0..1
  vec3 center = cell + (rnd - 0.5) * 0.25; // 結晶位置をセル内でジッター
  vec3 d = abs(q - center);
  float l1 = d.x + d.y + d.z;              // L1(八面体)距離 = 角張った結晶ファセット
  float spike = pow(clamp(1.0 - l1*0.8, 0.0, 1.0), 1.2);   // 太く鋭利な結晶(根本太く先尖り)
  float hgt = mix(0.12, 1.5, pow(rnd.x*rnd.y, 0.5));       // 長さの不揃い(短いチビ〜長い棘まで大きくばらつく)
  // アタックを拾うたびに各結晶ごとの係数が変わる(iAudioSeed が onset で更新)→ バラバラに伸縮
  float pc = mix(0.4, 1.8, fract(rnd.z + iAudioSeed*1.37));
  float needle = spike * hgt * pc;
  // 谷を一様な地で埋める → 滑らかな核を出さず結晶が密に覆う。
  return (0.4 + 0.7*needle) * sb_amp;
}

float sb_map(vec3 p){
  return length(p) - sb_core - sb_disp(normalize(p));   // 小さい核を放射状に変位 → ウニ
}

vec3 sb_normal(vec3 p){
  vec2 e = vec2(0.005, 0.0);
  return normalize(vec3(
    sb_map(p+e.xyy) - sb_map(p-e.xyy),
    sb_map(p+e.yxy) - sb_map(p-e.yxy),
    sb_map(p+e.yyx) - sb_map(p-e.yyx)));
}

// 変位 SDF は Lipschitz>1 なので表面近くは慎重にステップ。t0..tmax の帯のみ行進。
// 棘の細い先端を取りこぼさないよう near ステップを小さめに。
float sb_trace(vec3 ro, vec3 rd, float t, float tmax){
  float limit = 1.7*sb_amp + 0.12;
  for(int i=0;i<240;i++){
    float d = sb_map(ro + rd*t);
    if(d < 0.0012) return t;
    d = (d > limit) ? (d - limit + 0.10) : (0.2*d);
    t += d;
    if(t > tmax) break;
  }
  return -1.0;
}

// クロームが映す疑似環境(銀)。高コントラストなスタジオ鏡像で強烈クロームに。
vec3 sb_env(vec3 d){
  float up = d.y*0.5 + 0.5;
  // 暗い床 → 中明の空 の高コントラスト基調
  vec3 c = mix(vec3(0.015,0.02,0.03), vec3(0.50,0.55,0.68), smoothstep(0.0, 0.6, up));
  // 水平線の鋭い白帯(鏡面の芯)
  c += vec3(1.0) * pow(max(1.0 - abs(d.y)*3.5, 0.0), 3.0) * 1.0;
  // 天頂のソフトライト
  c += vec3(0.75) * pow(max(d.y, 0.0), 6.0);
  // 横の鋭い反射帯(複数本)
  float az = atan(d.x, d.z);
  c += vec3(0.5) * pow(max(cos(az*3.0), 0.0), 16.0);
  return c;
}

// cosineGradient(uCosGrad)で銀をカラー化(明暗=クローム階調は保つ)
vec3 sb_cosgrad(vec3 grey){
  if(abs(uCosGrad) < 0.0001) return grey;
  float cgInv = uCosGrad < 0.0 ? 0.5 : 0.0;
  float ct = fract(dot(grey, vec3(0.6, 0.8, 1.0)) + time*0.03);
  vec3 cosCol = cosGradColor(ct + cgInv);
  float lum = dot(grey, vec3(0.299,0.587,0.114));
  cosCol *= 0.5 + lum;
  return mix(grey, clamp(cosCol, 0.0, 1.0), abs(uCosGrad));
}

vec3 bg_spikeball(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = (2.0*I - resolution.xy) / resolution.y;

  // 音声で棘の高さを駆動。iAudio は音域(Band)+アタック(Attack)で整形済み。
  // デッドゾーン(0.02)以下=完全に棘ゼロ → ほぼ無音時は滑らかなクローム球で休憩。
  float lvl = max(clamp(iAudio, 0.0, 1.0) - 0.02, 0.0);
  sb_amp = 3.2 * lvl;                          // もっと伸縮(H44超えの長い棘)
  sb_core = 0.45 - 0.30 * clamp(lvl*1.6, 0.0, 1.0);  // 大音量で核が縮む → 滑らかな球が見えず棘の塊に

  // 自動回転カメラ
  float ca = time*0.25, cb = 0.5 + 0.25*sin(time*0.13);
  vec3 ro = vec3(0.0, 0.0, -3.2);
  vec3 rd = normalize(vec3(uv, 1.7));
  mat2 rx = mat2(cos(cb), -sin(cb), sin(cb), cos(cb));
  mat2 ry = mat2(cos(ca), -sin(ca), sin(ca), cos(ca));
  ro.yz = rx*ro.yz; rd.yz = rx*rd.yz;
  ro.xz = ry*ro.xz; rd.xz = ry*rd.xz;

  vec3 col = vec3(0.0);
  bgAlpha = 0.0;           // 背景は透過(重ねられる)

  // バウンディング球(中心原点, 半径 1+最大棘高+余白)で早期棄却 & 行進帯を限定
  float R = sb_core + 1.7*sb_amp + 0.15;
  float bdot = dot(ro, rd);
  float cc = dot(ro, ro) - R*R;
  float h = bdot*bdot - cc;
  if(h > 0.0){
    float sh = sqrt(h);
    float t0 = max(-bdot - sh, 0.0);
    float t1 = -bdot + sh;
    float t = sb_trace(ro, rd, t0, t1);
    if(t > 0.0){
      bgAlpha = 1.0;                                // 被写体は不透明
      vec3 p = ro + rd*t;
      vec3 nor = sb_normal(p);
      vec3 rr = reflect(rd, nor);
      vec3 env = sb_env(rr);                          // 完全鏡面(クローム=環境をそのまま映す)
      float fres = pow(1.0 - max(dot(nor, -rd), 0.0), 5.0);
      vec3 lig = normalize(vec3(1.0, 0.85, -0.6));
      float spe = pow(max(dot(nor, normalize(lig - rd)), 0.0), 120.0);
      col = env * (0.85 + 0.6*fres) + spe*vec3(1.0)*2.2;   // 強烈クローム + 鋭いハイライト
      col = sb_cosgrad(col);
    }
  }

  col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));    // gamma(高輝度はクリップしてクッキリ)
  return col;
}
