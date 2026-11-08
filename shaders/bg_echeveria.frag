// =====================================================
// bg_echeveria
//   Source : Shadertoy "Echeveria II" https://www.shadertoy.com/view/WtGXWm
//            (phyllotaxis succulent bloom raymarcher)
//   配色を透明ガラス(屈折)に置換 / 背景は黒 / 花びらは外側ほど大きく。
//   軌跡: 多重 echo march → 前フレーム(backbuffer)フィードバックに変更で大幅軽量化。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパ/グローバルは ec_ で名前空間化。
// =====================================================
uniform sampler2D backbuffer;   // 前フレームのスロット出力(残像フィードバック用)
#define EC_PI 3.14159265359

vec2 ec_hash2(vec2 p){
  return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);
}

void ec_pR(inout vec2 p, float a){ p = cos(a)*p + sin(a)*vec2(p.y, -p.x); }

float ec_smin(float a, float b, float k){
  float f = clamp(0.5 + 0.5*((a-b)/k), 0., 1.);
  return (1.-f)*a + f*b - f*(1.-f)*k;
}
float ec_smax(float a, float b, float k){ return -ec_smin(-a, -b, k); }

float ec_time;
bool  ec_lightingPass;
mat3  ec_modelMat;
mat2  ec_phyllotaxis;

struct ec_Model { float d; vec3 p; vec2 uv; vec2 cell; float wedges; float slice; float len; };

// @param uSize  50..110  = 100.0
// @param uThick  30..250  = 100.0
// @param uFrost  0..200   = 100.0
// @param uTrail  0..96    = 85.0
// @param uAngle -180..180 = 0.0
// @param uTilt -45..90 = 0.0
// @param uScale 50..120 = 100.0
// @param uSteps 40..60 = 60.0
uniform float uSize;     // 花びらの大きさ (%。上げすぎると球の外で欠ける)
uniform float uThick;     // 花びらの厚み (%)
uniform float uFrost;     // 磨りガラスの乳白色の濃さ (%)
uniform float uTrail;     // 残像の残り具合 (%。前フレームを残す割合)
uniform float uAngle; // 花の向き = ロール (度。固定角でずらす)
uniform float uTilt; // 花の傾き (度。固定角)
uniform float uScale; // 花全体の大きさ (%。カメラは動かない)
uniform float uSteps; // レイマーチのステップ数 (下げると軽く、尽きた光線は背景扱いで縁が欠ける)
// @param uPetalCurl 30..200 = 100
// @param uTipThin 30..250 = 100
// @param uPetalRound 30..150 = 100
// @param uSpiralA 3..8 = 5
// @param uSpiralB 5..13 = 8
// @param uCamHeight -100..100 = 0
// @param uCamSide -100..100 = 0
// @param uPerspective 95..200 = 100
// @param uLightYaw -180..180 = 0
// @param uEnvYaw -180..180 = 0
// @param uGlossBroad 5..250 = 100
// @param uGlossSharp 5..250 = 100
// @param uSparkSharp 5..250 = 100
// @param uRefractAmount 0..300 = 100
// @param uReflectAmount 0..800 = 100
// @param uRimPower 10..400 = 100
// @param uRimStrength 0..800 = 100
// @param uEdgeShadow 0..300 = 100
// @param uEdgeShadowWidth 30..250 = 100
// @param uBodyOpacity 30..250 = 100
// @param uTrailSpread 0..400 = 100
// @param uTrailDriftX -100..100 = 0
// @param uTrailDriftY -100..100 = 0
// @param uFrostColor color = #ffffff
// @param uRefractColor color = #ffffff
// @param uReflectColor color = #ffffff
// @param uSparkleColor color = #ffffff
// @param uTrailColor color = #ffffff
uniform float uPetalCurl; // 花びらの反り (%)
uniform float uTipThin; // 花びら先端の薄さ (%)。小さいほど先端が薄い
uniform float uPetalRound; // 花びら先端の丸み (%)。大きいほど丸く太い
uniform float uSpiralA; // 螺旋の一方の本数 (既定 5)。フィボナッチ以外では並びが崩れる
uniform float uSpiralB; // 螺旋のもう一方の本数 (既定 8)
uniform float uCamHeight; // カメラの高さ (%)。見下ろし / 見上げ
uniform float uCamSide; // カメラの左右の振り (%)
uniform float uPerspective; // パースの強さ (%)。上げるほど望遠で平ら
uniform float uLightYaw; // スペキュラ光源の水平回転 (度)
uniform float uEnvYaw; // 環境 (ソフトボックス) の水平回転 (度)
uniform float uGlossBroad; // 広いグロスの絞り (%)。大きいほど小さく鋭い
uniform float uGlossSharp; // 鋭いハイライトの絞り (%)
uniform float uSparkSharp; // ピンのきらめきの絞り (%)
uniform float uRefractAmount; // 屈折で透ける環境の明るさ (%)
uniform float uReflectAmount; // 反射の強さ (%)
uniform float uRimPower; // フレネル (縁の反射) の絞り (%)。大きいほど縁に細く出る
uniform float uRimStrength; // フレネルの強さ (%)
uniform float uEdgeShadow; // 花びらの境界の影の濃さ (%)
uniform float uEdgeShadowWidth; // 花びらの境界の影の幅 (%)
uniform float uBodyOpacity; // 花びらの不透明度の底 (%)
uniform float uTrailSpread; // 残像のにじみの広がり (%)
uniform float uTrailDriftX; // 残像を横へ流す (%)
uniform float uTrailDriftY; // 残像を縦へ流す (%)
uniform vec3 uFrostColor; // 磨りガラスの乳白色のティント
uniform vec3 uRefractColor; // 屈折して透ける色のティント
uniform vec3 uReflectColor; // 反射色のティント
uniform vec3 uSparkleColor; // スペキュラ・きらめきのティント
uniform vec3 uTrailColor; // 残像のティント (毎フレーム掛かる)

vec3 ec_yaw(vec3 v, float deg){
  float a = radians(deg);
  float c = cos(a), s = sin(a);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

ec_Model ec_leaf(vec3 p, vec3 cellData){
  vec2 cell = cellData.xy;
  float cellTime = cellData.z;

  float d = 1e12, d2 = 1e12, slice = 1e12;
  float wedge, wedges;

  ec_pR(p.xz, -cell.x);
  ec_pR(p.zy, cell.y);
  vec3 pp = p;

  cellTime = max(cellTime, 0.);
  float len = max(cellTime*3. - .2, 0.);
  len = pow(len, .33);

  // 花びらを外側(=低緯度 cell.y 小)ほど大きく(全体が球内に収まるよう抑える)
  float lat = clamp(cell.y / 1.5708, 0.0, 1.0);   // 0=外側 .. 1=中心
  len *= mix(1.30, 0.75, lat) * (uSize / 100.0);
  float llen = len;

  if(cellTime > 0.){
    float ins = .25;
    p.z += ins;
    vec3 n = normalize(vec3(1,0,.35));
    wedge = -dot(p, n);
    wedge = max(wedge, dot(p, n*vec3(1,1,-1)));
    wedge = ec_smax(wedge, p.z - len*1.12 - ins, len * (uPetalRound / 100.0));
    p.z -= ins;

    ins = .2;
    p.z += ins;
    n = normalize(vec3(1,0,.4));
    float wedge2 = -dot(p, n);
    wedge2 = max(wedge2, dot(p, n*vec3(1,1,-1)));
    wedge2 = ec_smax(wedge2, p.z - len*.95 - ins, len*.6 * (uPetalRound / 100.0));
    p.z -= ins;

    float top = p.y - len*.5;
    float curve = smoothstep(0., .2, cellTime);

    len *= mix(1.5, .65, curve);
    // 先端ほど薄くして尖らせる(穴あき防止のため厚めに)
    float tipf = clamp(p.z / max(len, 0.001), 0.0, 1.0);
    float th = mix(0.055, 0.035 * (uTipThin / 100.0), smoothstep(0.2, 0.95, tipf)) * (uThick / 100.0);
    float rz = -mix(.2, .7, curve) * (uPetalCurl / 100.0);
    ec_pR(p.zy, rz);
    slice = length(p - vec3(0,len,0)) - len;
    d2 = abs(slice) - th;
    d2 = max(d2, top);

    float d3 = ec_smax(d2, wedge, .02);
    float d4 = ec_smax(d2, wedge2, .02);
    wedges = ec_smin(wedge, wedge2, .01);
    d3 = ec_smin(d3, d4, .01);
    d = d3;

    p = pp;
    len = llen;
    vec2 uv = p.xz / len;
    return ec_Model(d, p, uv, cell, wedges, slice, len);
  }
  return ec_Model(d, p, vec2(0), vec2(0), 0., 0., 0.);
}

vec3 ec_calcCellData(vec2 cell, vec2 offset, float maxBloomOffset,
    mat2 transform, mat2 transformI, float stretch, float stretchStart, float stretchEnd, float t){
  float sz = maxBloomOffset + EC_PI/2.;
  cell = transform * cell;
  cell = round(cell);
  cell += offset;
  cell = transformI * cell;
  cell.y *= stretch / sz / stretchStart;
  cell.y = max(cell.y, .5/stretchStart);
  cell.y /= stretch / sz / stretchStart;
  cell = transform * cell;
  cell = round(cell);
  cell = transformI * cell;
  float y = cell.y * (stretch / sz);
  float cellAppearTime = (stretchStart - y) / (stretchStart - stretchEnd);
  float cellTime = t - cellAppearTime;
  cell.y -= maxBloomOffset;
  return vec3(cell, cellTime);
}

ec_Model ec_opU(ec_Model a, ec_Model b){ if(a.d < b.d) return a; return b; }

void ec_calcPhyllotaxis(){
  vec2 cc = vec2(uSpiralA, uSpiralB);
  float aa = atan(cc.x / cc.y);
  float scale = (EC_PI*2.) / sqrt(cc.x*cc.x + cc.y*cc.y);
  mat2 mRot = mat2(cos(aa), -sin(aa), sin(aa), cos(aa));
  mat2 mScale = mat2(1./scale,0,0,1./scale);
  ec_phyllotaxis = mRot * mScale;
}

ec_Model ec_bloom(vec3 p, float t){
  p.y -= .05;
  float stretchStart = .25, stretchEnd = 1.;
  float stretch = mix(stretchStart, stretchEnd, t);
  float maxBloomOffset = EC_PI/2.;

  vec2 cell = vec2(atan(p.x, p.z), atan(p.y, length(p.xz)) + maxBloomOffset);
  mat2 mStretch = mat2(1,0,0,stretch);
  mat2 transform = ec_phyllotaxis * mStretch;
  mat2 transformI = inverse(transform);

  ec_Model res = ec_Model(1e12, p, vec2(0), vec2(0), 0., 0., 0.);
  // 3x3 隣接サンプリング(花弁の欠けを防ぐため元に戻す)
  for(int m=0; m<3; m++)
  for(int n=0; n<3; n++){
    res = ec_opU(res, ec_leaf(p, ec_calcCellData(cell, vec2(m,n)-1., maxBloomOffset, transform, transformI, stretch, stretchStart, stretchEnd, t)));
  }
  return res;
}

ec_Model ec_map0(vec3 p){
  p *= ec_modelMat;
  float t;
  // バウンディング球は花本体ぴったりに絞る (旧エコー march 用の余白 2.8 は backbuffer 残像化で不要に)。
  // 2.8 だとカメラ(2.6)が球内に入り早期打切りが効かず、全ピクセルがフル SDF を行進していた。
  // 2.1 でカメラが球外に出て空振りレイが巨大ステップで抜ける = 約 44% 高速 (1440x900 実測 11.4→6.4ms)。
  // 花の最大半径は全周期で <1.9 (2.0/2.1 のピクセル差分はエッジのスパークル量子化のみ)。
  float bound = length(p) - 2.1;
  if(bound > .01 && !ec_lightingPass){
    return ec_Model(bound, p, vec2(0), vec2(0), 0., 0., 0.);
  }
  ec_pR(p.xy, ec_time * -EC_PI);
  vec3 pp = p;
  float side = sign(p.y);
  p.y = abs(p.y);
  p.z *= side;

  t = ec_time + .5*side;
  t = sin(t*EC_PI - EC_PI/2.)*.5 + .5;
  ec_pR(p.xz, ec_time*EC_PI);
  ec_Model model = ec_bloom(p, t);

  // 反対側のロゼットは赤道付近だけ評価する。外側の花弁を大きくした (1.30 × uSize) ぶん赤道を越えて
  // 伸びるので、元の .34 では越えた部分が切れて花弁に穴が空いていた (4 秒周期の位相 0.93〜0.2 付近)。
  // uSize 110 / uThick 250 でも切れない .6 にする。
  if(abs(p.y) < .6){
    p = pp;
    side *= -1.;
    p.yz *= side;
    t = ec_time + .5*side;
    t = sin(t*EC_PI - EC_PI/2.)*.5 + .5;
    ec_pR(p.xz, ec_time*EC_PI);
    ec_Model model2 = ec_bloom(p, t);
    model = ec_opU(model, model2);
  }
  return model;
}

// 花全体のスケール (距離も補正)
ec_Model ec_map(vec3 p){
  float sc = uScale / 100.0;
  ec_Model m = ec_map0(p / sc);
  m.d *= sc;
  return m;
}

vec3 ec_calcNormal(vec3 pos){
  vec3 n = vec3(0.0);
  for(int i=0; i<4; i++){
    vec3 e = 0.5773*(2.0*vec3((((i+3)>>1)&1),((i>>1)&1),(i&1))-1.0);
    n += e*ec_map(pos+0.0005*e).d;
  }
  return normalize(n);
}

mat3 ec_lookAt(vec3 ro, vec3 ta, float roll){
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(sin(roll),cos(roll),0.0)));
  vec3 vv = normalize(cross(uu, ww));
  return mat3(uu, vv, ww);
}
mat3 ec_rotX(float a){ return mat3(1,0,0, 0,cos(a),-sin(a), 0,sin(a),cos(a)); }
mat3 ec_rotY(float a){ return mat3(cos(a),0,sin(a), 0,1,0, -sin(a),0,cos(a)); }
mat3 ec_rotZ(float a){ return mat3(cos(a),-sin(a),0, sin(a),cos(a),0, 0,0,1); }

// スタジオ風環境マップ(磨き銀の反射先)。上が明るく下が暗い + 強いハイライトバンド。
vec3 ec_env(vec3 r){
  r = normalize(r);
  if(uEnvYaw != 0.0) r = ec_yaw(r, uEnvYaw);
  vec3 base = mix(vec3(0.05,0.05,0.07), vec3(0.78,0.82,0.92), smoothstep(-0.35,0.95, r.y));
  // 床の照り返し
  base += smoothstep(0.0,-0.7, r.y) * vec3(0.10,0.10,0.12);
  // 大きめのソフトボックス(2灯)
  base += smoothstep(0.55,0.97, dot(r, normalize(vec3( 0.4, 0.75,-0.35)))) * vec3(1.30,1.30,1.32);
  base += smoothstep(0.62,0.98, dot(r, normalize(vec3(-0.55,0.35, 0.55)))) * vec3(0.85,0.90,1.05);
  // 横方向のリムバンド(金属の帯反射)
  base += pow(0.5+0.5*sin(atan(r.x,r.z)*3.0), 6.0) * vec3(0.10);
  return base;
}

// 指定時刻オフセットで 1 回レンダリング。full=1 で完全クローム、0 で安価なシルバー影(残像用)。
// 戻り値 rgb=色, a=ヒット(1)/背景(0)
// full=1 でギラギラのクローム本体、full=0 で実3Dエッジ(フレネル)の輪郭線=残像。
// rimLo: 大きいほど輪郭線が細い(古いエコーで上げる)。
vec4 ec_render(vec3 ro, vec3 rd, float tOff, float full, float owidth){
  ec_time = mod((time - tOff)/4., 1.) + .35;
  float rayLength = 0., dist = 0., minD = 1e9;
  bool bg = false;
  ec_lightingPass = false;
  // メイン 60 段 / 輪郭 20 段。輪郭は粗ステップで打ち切り。
  int maxIter = (full > 0.5) ? int(uSteps + 0.5) : 20;
  float stepK = (full > 0.5) ? 0.85 : 1.20;
  for(int i=0; i<60; i++){
    if(i >= maxIter) break;
    vec3 rp = ro + rd*rayLength;
    ec_Model m = ec_map(rp);
    dist = m.d;
    if(length(rp) < 2.8) minD = min(minD, abs(dist));
    if(full > 0.5 && abs(dist) < .002) break;
    if(rayLength > 5.){ bg = true; break; }
    rayLength += dist * stepK;
  }
  ec_lightingPass = true;
  float scl = uScale / 100.0;
  // 反復を使い切って終わった (バウンディング球の縁をかすめた) レイは背景扱い
  if(!bg && length(ro + rd*rayLength) > 2.0*scl) bg = true;
  if(full < 0.5){
    // 残像 = シルエット輪郭線(near-miss)。古いほど owidth 小=細い→だんだん消える
    float outline = bg ? smoothstep(owidth, 0.0, minD) : 0.0;
    return vec4(vec3(0.88, 0.90, 0.97), outline);
  }
  if(bg) return vec4(0.0);
  vec3 pos = ro + rd*rayLength;
  vec3 n = ec_calcNormal(pos);
  vec3 rr = reflect(rd, n);

  // 透明感重視 + 強い光沢: milky base 薄め、屈折主、ハードなスペキュラ + 多層 glint。
  vec3 refrR = refract(rd, n, 1.0/1.42);
  vec3 refrG = refract(rd, n, 1.0/1.48);
  vec3 refrB = refract(rd, n, 1.0/1.56);
  if(length(refrR) < 0.5) refrR = rr;
  if(length(refrG) < 0.5) refrG = rr;
  if(length(refrB) < 0.5) refrB = rr;
  vec3 envR = ec_env(refrR) * 0.22;
  vec3 envG = ec_env(refrG) * 0.24;
  vec3 envB = ec_env(refrB) * 0.28;
  vec3 refrCol = vec3(envR.r, envG.g, envB.b) * (uRefractAmount / 100.0) * uRefractColor;
  // 磨りガラスに固定: milky 強め(乳白色を上げてフロスト感を強化)
  vec3 frostBase = vec3(0.40, 0.44, 0.52) * 0.95 * (uFrost / 100.0) * uFrostColor;
  // 反射光: ガラス光沢を強めるため env を持ち上げて明るく
  vec3 reflCol = pow(ec_env(rr), vec3(0.50)) * 0.55 * (uReflectAmount / 100.0) * uReflectColor;
  float fres = min(0.04 + 0.42 * (uRimStrength / 100.0) * pow(1.0 - abs(dot(rd, n)), 5.0 * (uRimPower / 100.0)), 1.0);
  vec3 glass = frostBase + refrCol;
  glass = mix(glass, reflCol + frostBase * 0.25, fres);
  // 多層スペキュラ(ハードな光沢)+ 極鋭スパークル(キラッ)
  vec3 l1 = normalize(vec3( 0.4, 0.75,-0.35));
  vec3 l2 = normalize(vec3(-0.55,0.35, 0.55));
  vec3 l3 = normalize(vec3( 0.15,-0.55, 0.82));
  vec3 l4 = normalize(vec3( 0.65, 0.10, 0.55));
  vec3 l5 = normalize(vec3(-0.20, 0.10,-0.97));
  if(uLightYaw != 0.0){ l1 = ec_yaw(l1, uLightYaw); l2 = ec_yaw(l2, uLightYaw); l3 = ec_yaw(l3, uLightYaw); l4 = ec_yaw(l4, uLightYaw); l5 = ec_yaw(l5, uLightYaw); }
  // 中広 + 中鋭 + 極鋭 の 3 段でガラス光沢
  float b1 = max(dot(rr,l1),0.0), b2 = max(dot(rr,l2),0.0);
  float b3 = max(dot(rr,l3),0.0), b4 = max(dot(rr,l4),0.0);
  float b5 = max(dot(rr,l5),0.0);
  float gb = uGlossBroad / 100.0, gs = uGlossSharp / 100.0, gp = uSparkSharp / 100.0;
  vec3 specBlob = vec3(pow(b1, 80.0*gb)*1.6 + pow(b2, 60.0*gb)*1.3 + pow(b3, 100.0*gb)*1.8);     // 広めグロス
  vec3 specSharp = vec3(pow(b1, 280.0*gs)*3.5 + pow(b3, 320.0*gs)*3.8 + pow(b4, 240.0*gs)*3.0);  // 鋭ハイライト
  vec3 specPin = vec3(pow(b1, 900.0*gp)*8.0 + pow(b3, 1100.0*gp)*9.0 + pow(b5, 700.0*gp)*6.0);   // 極鋭ピン
  glass += (specBlob + specSharp + specPin) * uSparkleColor;
  // 屈折側のキラリ(ガラス内部から透ける小さな光点)
  float is1 = pow(max(dot(refrG, l1), 0.0), 200.0);
  float is2 = pow(max(dot(refrG, l3), 0.0), 200.0);
  glass += (is1 + is2) * vec3(0.85, 0.95, 1.05) * 1.4;
  // 境界線シャドウ(幅広め): より遠くまで距離をサンプルして、影帯を太くする。
  float esw = uEdgeShadowWidth / 100.0;
  float dNearby = ec_map(pos + n*(0.10*scl*esw)).d;
  float boundary = clamp((0.07*scl*esw - dNearby) * (16.0/scl), 0.0, 1.0);
  glass *= max(1.0 - boundary * 0.55 * (uEdgeShadow / 100.0), 0.0);
  // 不透明度を大幅に下げて背景が透けるように。スパークル位置は局所的に不透明。
  float spInt = pow(max(dot(rr,vec3( 0.4, 0.75,-0.35)),0.0), 240.0);
  float opacity = clamp(0.32 * (uBodyOpacity / 100.0) + fres * 0.55 + spInt * 3.0, 0.32 * (uBodyOpacity / 100.0), 1.0);
  return vec4(glass, opacity);
}

vec3 bg_echeveria(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 p = (-resolution + 2.0*I) / resolution.y;

  ec_calcPhyllotaxis();
  ec_modelMat = ec_rotZ(-.9 + radians(uAngle)) * ec_rotX(.05 + radians(uTilt)) * ec_rotY(-1.1);

  vec3 camPos = vec3(0,0,-2.6);
  float focal = 1.8;
  if(uCamHeight != 0.0 || uCamSide != 0.0) camPos += vec3(uCamSide, uCamHeight, 0.0) * 0.02;
  if(uPerspective != 100.0){ camPos *= uPerspective / 100.0; focal *= uPerspective / 100.0; }
  mat3 camMat = ec_lookAt(camPos, vec3(0,-.05,0), 0.);
  vec3 rd = normalize(camMat * vec3(p.xy, focal));
  vec3 ro = camPos;

  // 単独の最新姿勢を 1 回 march
  vec4 r = ec_render(ro, rd, 0.0, 1.0, 0.0);
  // 先に最新姿勢へガンマを掛ける(backbuffer は既にガンマ済みなので再適用しない)
  vec3 cur = pow(clamp(r.rgb, 0.0, 1.0), vec3(0.85));
  cur = clamp(cur * 1.12, 0.0, 1.0);
  cur = pow(cur, vec3(0.4545));

  // 軌跡 = backbuffer フィードバック(隣接ブラー + フェード)。アルファも一緒に伝播させ、
  // 背景=透明 / 花弁=半透明 / 残像=だんだん透明、として B-Overlay で下のレイヤが透ける。
  vec2 uv = fc / resolution;
  vec2 px = 1.0 / resolution * (uTrailSpread / 100.0);
  if(uTrailDriftX != 0.0 || uTrailDriftY != 0.0) uv += vec2(uTrailDriftX, uTrailDriftY) * 0.00005;
  vec4 prev = texture2D(backbuffer, uv);
  vec4 prevBlur = prev * 0.50
               + texture2D(backbuffer, uv + vec2( px.x,  0.0)) * 0.125
               + texture2D(backbuffer, uv + vec2(-px.x,  0.0)) * 0.125
               + texture2D(backbuffer, uv + vec2( 0.0,   px.y)) * 0.125
               + texture2D(backbuffer, uv + vec2( 0.0,  -px.y)) * 0.125;
  prevBlur.rgb *= uTrailColor;
  prevBlur *= uTrail / 100.0;                                             // 15% フェード(中庸の残像長)
  float curA = clamp(r.a * 2.0, 0.0, 0.85);                     // 花弁=不透明度~80%(本体を増幅) / 背景(r.a=0)=透明
  bgAlpha = max(prevBlur.a, curA);                              // 残像もアルファに乗せて尾を引く
  return mix(prevBlur.rgb, cur, r.a);
}
