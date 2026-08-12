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
  len *= mix(1.30, 0.75, lat);
  float llen = len;

  if(cellTime > 0.){
    float ins = .25;
    p.z += ins;
    vec3 n = normalize(vec3(1,0,.35));
    wedge = -dot(p, n);
    wedge = max(wedge, dot(p, n*vec3(1,1,-1)));
    wedge = ec_smax(wedge, p.z - len*1.12 - ins, len);
    p.z -= ins;

    ins = .2;
    p.z += ins;
    n = normalize(vec3(1,0,.4));
    float wedge2 = -dot(p, n);
    wedge2 = max(wedge2, dot(p, n*vec3(1,1,-1)));
    wedge2 = ec_smax(wedge2, p.z - len*.95 - ins, len*.6);
    p.z -= ins;

    float top = p.y - len*.5;
    float curve = smoothstep(0., .2, cellTime);

    len *= mix(1.5, .65, curve);
    // 先端ほど薄くして尖らせる(穴あき防止のため厚めに)
    float tipf = clamp(p.z / max(len, 0.001), 0.0, 1.0);
    float th = mix(0.055, 0.035, smoothstep(0.2, 0.95, tipf));
    float rz = -mix(.2, .7, curve);
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
  vec2 cc = vec2(5., 8.);
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

ec_Model ec_map(vec3 p){
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

  if(abs(p.y) < .34){
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
  int maxIter = (full > 0.5) ? 60 : 20;
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
  vec3 refrCol = vec3(envR.r, envG.g, envB.b);
  // 磨りガラスに固定: milky 強め(乳白色を上げてフロスト感を強化)
  vec3 frostBase = vec3(0.40, 0.44, 0.52) * 0.95;
  // 反射光: ガラス光沢を強めるため env を持ち上げて明るく
  vec3 reflCol = pow(ec_env(rr), vec3(0.50)) * 0.55;
  float fres = 0.04 + 0.42 * pow(1.0 - abs(dot(rd, n)), 5.0);
  vec3 glass = frostBase + refrCol;
  glass = mix(glass, reflCol + frostBase * 0.25, fres);
  // 多層スペキュラ(ハードな光沢)+ 極鋭スパークル(キラッ)
  vec3 l1 = normalize(vec3( 0.4, 0.75,-0.35));
  vec3 l2 = normalize(vec3(-0.55,0.35, 0.55));
  vec3 l3 = normalize(vec3( 0.15,-0.55, 0.82));
  vec3 l4 = normalize(vec3( 0.65, 0.10, 0.55));
  vec3 l5 = normalize(vec3(-0.20, 0.10,-0.97));
  // 中広 + 中鋭 + 極鋭 の 3 段でガラス光沢
  float b1 = max(dot(rr,l1),0.0), b2 = max(dot(rr,l2),0.0);
  float b3 = max(dot(rr,l3),0.0), b4 = max(dot(rr,l4),0.0);
  float b5 = max(dot(rr,l5),0.0);
  vec3 specBlob = vec3(pow(b1, 80.0)*1.6 + pow(b2, 60.0)*1.3 + pow(b3, 100.0)*1.8);     // 広めグロス
  vec3 specSharp = vec3(pow(b1, 280.0)*3.5 + pow(b3, 320.0)*3.8 + pow(b4, 240.0)*3.0);  // 鋭ハイライト
  vec3 specPin = vec3(pow(b1, 900.0)*8.0 + pow(b3, 1100.0)*9.0 + pow(b5, 700.0)*6.0);   // 極鋭ピン
  glass += specBlob + specSharp + specPin;
  // 屈折側のキラリ(ガラス内部から透ける小さな光点)
  float is1 = pow(max(dot(refrG, l1), 0.0), 200.0);
  float is2 = pow(max(dot(refrG, l3), 0.0), 200.0);
  glass += (is1 + is2) * vec3(0.85, 0.95, 1.05) * 1.4;
  // 境界線シャドウ(幅広め): より遠くまで距離をサンプルして、影帯を太くする。
  float dNearby = ec_map(pos + n*0.10).d;
  float boundary = clamp((0.07 - dNearby) * 16.0, 0.0, 1.0);
  glass *= 1.0 - boundary * 0.55;
  // 不透明度を大幅に下げて背景が透けるように。スパークル位置は局所的に不透明。
  float spInt = pow(max(dot(rr,vec3( 0.4, 0.75,-0.35)),0.0), 240.0);
  float opacity = clamp(0.32 + fres * 0.55 + spInt * 3.0, 0.32, 1.0);
  return vec4(glass, opacity);
}

vec3 bg_echeveria(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 p = (-resolution + 2.0*I) / resolution.y;

  ec_calcPhyllotaxis();
  ec_modelMat = ec_rotZ(-.9) * ec_rotX(.05) * ec_rotY(-1.1);

  vec3 camPos = vec3(0,0,-2.6);
  mat3 camMat = ec_lookAt(camPos, vec3(0,-.05,0), 0.);
  vec3 rd = normalize(camMat * vec3(p.xy, 1.8));
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
  vec2 px = 1.0 / resolution;
  vec4 prev = texture2D(backbuffer, uv);
  vec4 prevBlur = prev * 0.50
               + texture2D(backbuffer, uv + vec2( px.x,  0.0)) * 0.125
               + texture2D(backbuffer, uv + vec2(-px.x,  0.0)) * 0.125
               + texture2D(backbuffer, uv + vec2( 0.0,   px.y)) * 0.125
               + texture2D(backbuffer, uv + vec2( 0.0,  -px.y)) * 0.125;
  prevBlur *= 0.85;                                             // 15% フェード(中庸の残像長)
  float curA = clamp(r.a * 2.0, 0.0, 0.85);                     // 花弁=不透明度~80%(本体を増幅) / 背景(r.a=0)=透明
  bgAlpha = max(prevBlur.a, curA);                              // 残像もアルファに乗せて尾を引く
  return mix(prevBlur.rgb, cur, r.a);
}
