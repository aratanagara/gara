// =====================================================
// bg_tronclouds
//   雲    : "Horizon Clouds" https://www.shadertoy.com/view/XtBXDw (volumetric raymarch)
//           テクスチャ noise をハッシュ手続き noise に置換。
//   空    : Windows ブルースクリーン色に置換。
//   地平線: 音声波形(心電図)で稜線が上下する原色→濃いマゼンタの山。
//   地面  : "TRON RIDER" のネオングリッド + マゼンタ床。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン / uFFT 音声。
// =====================================================
mat3 hc_RX(float t){ return mat3(1.,0.,0., 0.,cos(t),-sin(t), 0.,sin(t),cos(t)); }
mat3 hc_RY(float t){ return mat3(cos(t),0.,sin(t), 0.,1.,0., -sin(t),0.,cos(t)); }
vec3 hc_rotate(vec3 v, vec2 r){ return hc_RY(r.y)*hc_RX(r.x)*v; }

// ---- 手続き value noise (XtBXDw noise_iq のテクスチャ無し版) ----
float hc_hash(float n){ return fract(sin(n)*753.5453123); }
float hc_noise(vec3 x){
  vec3 p=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  float n=p.x + p.y*157.0 + 113.0*p.z;
  return mix(mix(mix(hc_hash(n+0.0),  hc_hash(n+1.0),  f.x),
                 mix(hc_hash(n+157.0),hc_hash(n+158.0),f.x), f.y),
             mix(mix(hc_hash(n+113.0),hc_hash(n+114.0),f.x),
                 mix(hc_hash(n+270.0),hc_hash(n+271.0),f.x), f.y), f.z);
}
float hc_fbm(vec3 p, float lac){
  float t  = 0.51749673*hc_noise(p); p*=lac;
  t += 0.25584929*hc_noise(p); p*=lac;
  t += 0.12527603*hc_noise(p); p*=lac;
  t += 0.06255931*hc_noise(p);
  return t;
}

#define HC_COVERAGE   0.50
#define HC_THICKNESS  15.0
#define HC_ABSORPTION 1.030725
#define HC_FBM_FREQ   2.76434
#define HC_STEPS      22

float hc_density(vec3 pos, vec3 offset){
  vec3 p = pos*0.0212242 + offset;
  float dens = hc_fbm(p, HC_FBM_FREQ);
  // カバレッジをゆっくり時間変動させ、雲が湧いて流れて消えるタイミングを作る
  float covAmt = HC_COVERAGE + 0.32 * sin(time*0.07) + 0.12 * sin(time*0.17 + 1.3);
  covAmt = clamp(covAmt, 0.12, 0.85);
  float cov = 1.0 - covAmt;
  dens *= smoothstep(cov, cov+0.05, dens);
  return clamp(dens, 0.0, 1.0);
}

// 上向き光線にボリュメトリック雲。ro=雲視点, rd=視線方向(rd.y>0)
vec4 hc_clouds(vec3 ro, vec3 rd){
  // 大気球(origin (0,-450,0), r 500) との交点
  vec3 so = vec3(0.0, -450.0, 0.0); float sr = 500.0;
  vec3 rc = so - ro; float tca = dot(rc, rd);
  float d2 = dot(rc, rc) - tca*tca; float r2 = sr*sr;
  if(d2 > r2) return vec4(0.0);
  float thc = sqrt(r2 - d2); float t0 = tca - thc; float t1 = tca + thc;
  if(t0 < 0.0) t0 = t1;
  vec3 pos = ro + rd*t0;

  vec3 wind = vec3(0.0, 0.0, -time*0.2);
  float march = HC_THICKNESS / float(HC_STEPS);
  vec3 dir_step = rd / rd.y * march;
  float T = 1.0; vec3 C = vec3(0.0); float alpha = 0.0;
  for(int i=0;i<HC_STEPS;i++){
    float h = float(i) / float(HC_STEPS);
    float dens = hc_density(pos, wind);
    float Ti = exp(-HC_ABSORPTION * dens * march);
    T *= Ti; if(T < 0.01) break;
    C += T * (exp(h)/1.75) * dens * march;     // FAKE_LIGHT
    alpha += (1.0 - Ti) * (1.0 - alpha);
    pos += dir_step;
    if(length(pos) > 1e3) break;
  }
  return vec4(C, alpha);
}

// ---- TRON ネオングリッド床 ----
vec3 sc_grid(vec2 xz){
  float speed = time*5.0;
  vec2 coord = xz + vec2(0.0, speed);
  vec2 g = abs(fract(coord*0.5)-0.5) / fwidth(coord*0.5);
  float line = min(g.x, g.y);
  float mask = 1.0 - min(line, 1.0);
  float fade = exp(-length(xz)*0.04);
  float center = 1.0 - smoothstep(0.0, 0.1, abs(xz.x));
  return vec3(1.0, 1.0, 1.0) * (mask + center*0.5) * fade * 1.6;   // 白いグリッド線
}

// ---- BSOD: 実テキストのテクスチャ(uBsodText)を参照。タイプライターで1行ずつ表示 ----
float hc_bsod(vec2 fc){
  vec2 sp = fc / resolution;          // x:0..1, y:0(下)..1(上)
  if(sp.x < 0.015 || sp.x > 0.985) return 0.0;
  // テクスチャは FLIP_Y 済み: v=1 が1行目(画面上=テキスト上)
  float tex = texture(uBsodText, vec2(sp.x, sp.y)).r;
  // タイプライター: 上→下に行が出て、各行は左→右に出る
  float ROWS = 61.0;
  float row  = floor((1.0 - sp.y) * ROWS);   // 0=上の行
  float order = row + sp.x;                   // 行 + 行内の進み(左→右)
  float speed = 7.0;                          // 行/秒
  float cursor = mod(time*speed, ROWS + 12.0);// 打ち切り後ホールド→ループ
  float reveal = step(order, cursor);
  float txt = tex * reveal;
  // 点滅カーソル(今打っている行の先端)
  float atRow = step(cursor - 1.0, row) * step(row, cursor);
  float curX  = fract(cursor);                // 行内の打点
  float curBlk = step(abs(sp.x - curX), 0.006) * step(0.0, sp.y);
  txt = max(txt, atRow * curBlk * step(0.5, fract(time*3.0)));
  return txt;
}

vec3 bg_tronclouds(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = (I/resolution)*2.0 - 1.0;
  uv.x *= resolution.x/resolution.y;

  // カメラ(ゆるい公転)
  float t = time/2.0;
  vec2 rot = vec2(0.5, t);
  vec3 uvVec = normalize(vec3(uv, 1.0));
  uvVec = hc_rotate(uvVec, rot);

  float el = uvVec.y;
  float horizon = max(0.0, el);
  // 空 = Windows ブルースクリーンの原色青(#0000AA 系)。地平線が明るくなりすぎないよう調整。
  vec3 bsodBlue = mix(vec3(0.0, 0.04, 0.66), vec3(0.0, 0.0, 0.58), horizon);
  // 空にBSODテキストを表示(晴天時に見える。雲が出ると隠れる)
  float txt = hc_bsod(I) * smoothstep(0.0, 0.05, el);   // 地平線付近はフェード
  vec3 skyCol = mix(bsodBlue, vec3(0.86, 0.90, 1.0), txt);
  vec3 col = skyCol;

  // ボリュメトリック雲(上向き光線)。雲が BSOD を覆う=晴天のときだけ文字が見える。
  if(el > 0.02){
    vec4 cld = hc_clouds(vec3(0.0, 1.0, 0.0), uvVec);
    col = mix(skyCol, cld.rgb/(0.0001 + cld.a), cld.a);
  }

  // 地平線の奥(山の下)を濃いマゼンタで塗る(青帯を消して床と連続させる)。地平線の下まで覆う。
  {
    float haze = smoothstep(0.18, 0.06, el);    // el<=0.06 は完全に濃いマゼンタ、0.18で消える
    col = mix(col, vec3(0.16, 0.0, 0.22), haze);
  }

  // 地平線の山 = 三角波で角張った山並み + 音声で隆起。グラデは上(稜線)が濃いマゼンタ。
  if(el > 0.0){
    float az = atan(uvVec.x, uvVec.z);
    float u  = fract(az / 6.2831853 + 0.5);
    // 波形座標を折り返して始点(u=0)と終点(u=1)を一致させる(シーム回避)
    float uw = 1.0 - abs(2.0*u - 1.0);
    float w  = texture(uFFT, vec2(uw, 0.75)).r;       // 波形 0..1, 中心0.5
    // 滑らかなカーブの山並み(2π整数倍で始点/終点が接続)
    float TAU = 6.2831853;
    float trav = sin(u*TAU*6.0 - time*4.0)*0.5 + sin(u*TAU*3.0 + time*2.3)*0.5;
    float ridge = 0.18 + trav*0.10 + (w - 0.5)*(1.2 + iEnergy*10.0);
    ridge = max(ridge, 0.03);
    if(el < ridge){
      float gg = clamp(el / ridge, 0.0, 1.0);                // 0=ふもと, 1=稜線
      vec3 mtn = mix(vec3(0.20, 0.0, 0.26), vec3(0.95, 0.0, 0.95), gg);  // 反転: ふもと濃い → 稜線 原色
      float edge = smoothstep(ridge, ridge - 0.004, el);     // 稜線をくっきり(角張り)
      col = mix(col, mtn, edge);
    }
  }

  // 地面 = TRON サイバーグリッド。手前=明るいマゼンタ→奥=濃いマゼンタ
  if(el < -0.001){
    float floorY = -2.5;
    float tt = (floorY - 1.0) / el;     // 視点高さ1.0 から床へ
    if(tt > 0.0){
      vec3 hit = vec3(0.0,1.0,0.0) + uvVec*tt;
      // 原色マゼンタの範囲を広く、奥(地平線付近)だけ濃いマゼンタに(pow で遠方寄せ)
      float depth = pow(clamp(tt * 0.045, 0.0, 1.0), 3.0);
      vec3 floorGrad = mix(vec3(0.95, 0.0, 0.95), vec3(0.16, 0.0, 0.22), depth);
      vec3 floorCol = floorGrad + sc_grid(hit.xz);
      float blend = smoothstep(0.0, -0.06, el);
      col = mix(col, floorCol, blend);
    }
  }
  return col;
}
