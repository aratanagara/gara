// =====================================================
// Source : https://www.shadertoy.com/view/MlS3Rt
// bg_ngray  (H59)  — 取り込み: "ngRay1" by Cale Bradbury (Shadertoy MlS3Rt)
//   iq の Raymarching Primitives 改変。球 + 10 個の box を smin 合体し、
//   回転/スキュー行列で刻々と変形する有機的なメタボール群をオービットカメラで撮る。
//   テクスチャ不使用 → 単一パスへそのまま移植。helpers は ng_ で名前空間化。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   cosineGradient(uCosGrad)対応 / Slot B はヒットのみ表示(背景透過)。
// =====================================================

float ng_smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0);
  return mix(b, a, h) - k*h*(1.0-h);
}
float ng_sphere(vec3 p, float s){ return length(p) - s; }
float ng_box(vec3 p, float s){ return length(max(abs(p) - vec3(s), 0.0)); }

// @param uDetail   1..10   = 10.0
// @param uSoft     25..200 = 100.0
// @param uSpread   0..200  = 100.0
// @param uContrast 25..300 = 100.0
// @param uAngle    -180..180 = 0.0
// @param uScale    50..200 = 100.0
// @param uSteps  18..30 = 30.0
// @param uCoreSize 40..250 = 100
// @param uBoxSize 40..250 = 100
// @param uBoxRound 0..100 = 0
// @param uSpreadY 0..300 = 100
// @param uSkew 50..200 = 100
// @param uPulse 0..200 = 100
// @param uCamDist 60..140 = 100
// @param uCamHeight 0..250 = 100
// @param uBoxStretch 40..250 = 100
// @param uRim 0..300 = 100
uniform float uDetail;     // 合体させる box の数 (下げると軽く、塊が単純になる)
uniform float uSoft;       // 合体の滑らかさ = smin の半径 (%)
uniform float uSpread;     // box の散らばる範囲 (%) (0 = 中心に固まる)
uniform float uContrast;   // ガンマの強さ (%)
uniform float uAngle;      // box それぞれの向きのオフセット (度)
uniform float uScale;      // 物体全体の大きさ (%)
uniform float uSteps;    // レイマーチの最大ステップ数 (下げると軽く、遠景や縁が欠ける)
uniform float uCoreSize;   // 中心の球の大きさ (%)
uniform float uBoxSize;    // box 1 個の大きさ (%)
uniform float uBoxRound;   // box の角の丸み (%)。0 で角ばったまま
uniform float uSpreadY;    // box の上下の散らばり (%)
uniform float uSkew;       // box のせん断のかかり方 (%)。大きいほど歪んだ形
uniform float uPulse;      // 塊全体の脈動の振れ幅 (%)
uniform float uCamDist;    // カメラの距離 (%)
uniform float uCamHeight;  // カメラの高さ (%)。0 で真横から、大きいと見下ろし
uniform float uBoxStretch; // box の奥行き方向の伸び (%)。小さいと平たい板、大きいと棒
uniform float uRim;        // 輪郭の縁取りの強さ (%)
// @param uTwist -100..100 = 0
// @param uFoldX 0..100 = 0
// @param uSquashY 40..250 = 100
// @param uCamRoll -90..90 = 0
// @param uFocal 60..200 = 100
// @param uLookX -60..60 = 0
// @param uLookY -60..60 = 0
// @param uOrbitStart -180..180 = 0
// @param uLightAz -180..180 = 0
// @param uLightEl -100..100 = 0
// @param uDiffAmt 0..300 = 100
// @param uAmbAmt 0..300 = 100
// @param uVigAmt 0..300 = 100
// @param uBodyTint color = #ffffff
uniform float uTwist;      // 塊の縦軸まわりのねじれ (%)。0 = なし / 負で逆回り
uniform float uFoldX;      // 左右の鏡像 (%)。0 = なし / 100 で完全な左右対称
uniform float uSquashY;    // 塊の縦の伸び縮み (%)。小さいと平たく、大きいと縦長
uniform float uCamRoll;    // カメラのロール (度)。0 = なし
uniform float uFocal;      // 画角 (%)。大きいほど望遠
uniform float uLookX;      // 注視点の横ずれ (%)。塊を画面の横へ寄せる
uniform float uLookY;      // 注視点の縦ずれ (%)。塊を画面の縦へ寄せる
uniform float uOrbitStart; // カメラの周回の開始角 (度)。見る方向を変える
uniform float uLightAz;    // 光源の方位 (度)。0 = 既定
uniform float uLightEl;    // 光源の高さ (%)。0 = 既定
uniform float uDiffAmt;    // 光源から受ける陰影 (拡散光) の強さ (%)。下げると灰色の立体感が出る
uniform float uAmbAmt;     // 環境光 (下面の明るさ) の量 (%)
uniform float uVigAmt;     // 周辺減光の強さ (%)
uniform vec3  uBodyTint;   // 塊全体の色

// 球 + 10 個の box を回転/スキューしながら smin 合体(刻々と変形)
vec2 ng_map(vec3 pos){
  float objS = uScale / 100.0;
  pos /= objS;
  if(uTwist != 0.0){ float tw = pos.y * uTwist / 100.0 * 0.15; float ct = cos(tw), st = sin(tw); pos.xz = mat2(ct, -st, st, ct) * pos.xz; }
  if(uFoldX > 0.0) pos.x = mix(pos.x, abs(pos.x), uFoldX / 100.0);
  if(uSquashY != 100.0) pos.y *= uSquashY / 100.0;
  float res = ng_sphere(pos, 0.5 * (uCoreSize / 100.0));
  float t   = time;
  float amp = sin(t*0.5)*0.5*(uPulse / 100.0) + 1.0;
  for(float i = 0.0; i < 10.0; i++){
    if(i >= floor(uDetail + 0.5)) break;
    float a = i + t + radians(uAngle);
    vec3 off = vec3(sin(t*1.2 + i*0.3)*amp*5.0,
                    sin(t + cos(i*0.5 + t))*amp*(uSpreadY / 100.0),
                    cos(t*0.45 - i*2.0)*amp*2.0) * (uSpread / 100.0);
    vec3 ppos = pos + off;
    float d = length(ppos)*0.3*(uSkew / 100.0);
    ppos.xy *= mat2(cos(a), sin(a), -sin(a), cos(a));
    ppos.zy *= mat2(cos(-a), sin(a), -sin(a), cos(a));
    ppos *= mat3(1.0, d, d,  d, 1.0, d,  d, d, 1.0);
    ppos *= mat3(sin(d+t), d, d*d,  d, d, d,  -d, i*sin(d+i), -1.0);
    float bs = 0.2 * (uBoxSize / 100.0);
    vec3 bq = ppos;
    if(uBoxStretch != 100.0){ bq.z /= uBoxStretch / 100.0; }
    float bx = ng_box(bq, bs);
    if(uBoxRound != 0.0){ float br = min(bs, 0.15) * (uBoxRound / 100.0); bx = ng_box(bq, bs - br) - br; }
    res = ng_smin(res, bx, 4.0 * (uSoft / 100.0));
  }
  if(uSquashY > 100.0) res /= uSquashY / 100.0;
  return vec2(res * objS, 5.0);
}

vec2 ng_castRay(vec3 ro, vec3 rd){
  float tmax = 20.0, precis = 0.01, t = 0.0, m = 0.0;
  for(int i = 0; i < 30; i++){
    if(i >= int(uSteps + 0.5)) break;
    vec2 r = ng_map(ro + rd*t);
    if(r.x < precis || t > tmax) break;
    t += r.x; m = r.y;
  }
  if(t > tmax) m = -1.0;
  return vec2(t, m);
}

float ng_softshadow(vec3 ro, vec3 rd, float mint, float tmax){
  float res = 1.0, t = mint;
  for(int i = 0; i < 16; i++){
    float h = ng_map(ro + rd*t).x;
    res = min(res, 8.0*h/t);
    t += clamp(h, 0.02, 0.10);
    if(h < 0.001 || t > tmax) break;
  }
  return clamp(res, 0.0, 1.0);
}

vec3 ng_calcNormal(vec3 pos){
  vec3 e = vec3(0.001, 0.0, 0.0);
  return normalize(vec3(
    ng_map(pos + e.xyy).x - ng_map(pos - e.xyy).x,
    ng_map(pos + e.yxy).x - ng_map(pos - e.yxy).x,
    ng_map(pos + e.yyx).x - ng_map(pos - e.yyx).x));
}

vec3 ng_render(vec3 ro, vec3 rd, out float hitOut){
  vec2 res = ng_castRay(ro, rd);
  float t = res.x, m = res.y;
  hitOut = step(-0.5, m);
  vec3 col = vec3(0.0);   // 背景は黒 (entrypoint が uBgColor で塗る)
  if(m > -0.5){
    vec3 pos = ro + t*rd;
    vec3 nor = ng_calcNormal(pos);
    vec3 ref = reflect(rd, nor);
    float occ = 0.5;
    vec3  lig = normalize(vec3(-0.6, 0.7, -0.5));
    if(uLightAz != 0.0){ float la = radians(uLightAz); float cl = cos(la), sl = sin(la); lig.xz = mat2(cl, -sl, sl, cl) * lig.xz; }
    if(uLightEl != 0.0) lig = normalize(lig + vec3(0.0, uLightEl / 100.0, 0.0));
    float amb = clamp(0.5 + 0.5*nor.y, 0.5, 1.0);
    float dif = clamp(dot(nor, lig), 0.5, 1.0);
    float bac = clamp(dot(nor, normalize(vec3(-lig.x, 0.0, -lig.z))), 0.0, 1.0) * clamp(1.0 - pos.y, 0.0, 1.0);
    float dom = smoothstep(-0.1, 0.1, ref.y);
    float fre = pow(clamp(1.0 + dot(nor, rd), 0.5, 1.0), 2.0);
    float spe = pow(clamp(dot(ref, lig), 0.5, 1.0), 16.0);
    dom *= ng_softshadow(pos, ref, 0.02, 2.5);
    vec3 brdf = vec3(0.0);
    brdf += 1.20*dif*(uDiffAmt / 100.0);
    brdf += 1.20*spe*dif;
    brdf += 0.30*amb*occ*(uAmbAmt / 100.0);
    brdf += 0.40*dom*occ;
    brdf += 0.30*bac*occ;
    brdf += 0.40*fre*occ*(uRim / 100.0);
    col = brdf;
  }
  col = clamp(col, 0.0, 1.0);
  if(uBodyTint != vec3(1.0)) col *= uBodyTint;
  return col;
}

mat3 ng_setCamera(vec3 ro, vec3 ta, float cr){
  vec3 cw = normalize(ta - ro);
  vec3 cp = vec3(sin(cr), cos(cr), 0.0);
  vec3 cu = normalize(cross(cw, cp));
  vec3 cv = normalize(cross(cu, cw));
  return mat3(cu, cv, cw);
}

vec3 bg_ngray(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 q = I / resolution.xy;
  vec2 p = -1.0 + 2.0*q;
  p.x *= resolution.x / resolution.y;

  float ctime   = 15.0 + time*5.0 + (uOrbitStart != 0.0 ? radians(uOrbitStart) * 10.0 : 0.0);                 // カメラ・オービット
  float camDist = 13.0 * (uCamDist / 100.0);
  vec3 ro = vec3(-0.5 + camDist*cos(0.1*ctime), 5.0 * (uCamHeight / 100.0), 0.5 + camDist*sin(0.1*ctime));
  vec3 ta = vec3(-0.001, 0.0, 0.0);
  mat3 ca = ng_setCamera(ro, ta, radians(uCamRoll));
  vec3 rd = ca * normalize(vec3(p.xy, 2.5 * (uFocal / 100.0)));
  if(uLookX != 0.0 || uLookY != 0.0) rd = ca * normalize(vec3(p.xy - vec2(uLookX, uLookY) / 100.0, 2.5 * (uFocal / 100.0)));

  float hit;
  vec3 col = ng_render(ro, rd, hit);
  col = pow(col, vec3(0.4545) * (uContrast / 100.0));                    // ガンマ
  col *= 1.0 - length(q*2.0 - 1.0)*0.3*(uVigAmt / 100.0);            // ビネット

  if(abs(uCosGrad) > 0.0001){
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, cosGradColor(lum) * (0.3 + 1.2*lum), abs(uCosGrad));
  }

  bgAlpha = hit;          // Slot B はヒットのみ(背景透過)
  return col;
}
