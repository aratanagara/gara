// =====================================================
// bg_smear_tear  —  液状化して裂けていく灰の紙 (扇状の流れ + 行クランプ縞)
//   ・座標: 中心点を持たない流れの場。流れ関数の等値線が川のようにうねり (uCurl)、
//     全体がゆっくり回る。レンズが流れを曲げながら画面をさまよう (uSwirl)
//   ・流れ: 中身は川筋に沿って流れ続け、色の帯は川筋を横切って移り続ける (uSpeed)
//   ・塗り: 2 本の滑らかな場 A/B を量子化した 2 次元 LUT = ポスタライズされた面と輪郭線。
//     色は川筋の帯で決まる。流れ方向に櫛歯状に裂ける (uComb)
//   ・線: 紙の上の等高線。アンチエイリアスしない (圧縮された所で点線に崩れる)
//   ・縞: テクスチャのクランプのような 1 行ベタ塗りの塊が画面を漂って現れては消え、星が流れる (uRows / uStars)
//   ・配色: uPalTime 秒ごとに 6 種のパレットを順にクロスフェードで巡る (uPalFade / uPalette)。紙の灰は変えない
//   ・既定は灰の紙 (uBgColor が黒のとき Slot A の紙 = #c8c8c8)。Slot B では紙が透過
//   ・beat モードは拍頭で流れが加速してうねりが跳ね、行が総入れ替え + 裂けが増え、4 拍ごとに帯の並びと縞の塊が飛ぶ (uKick)。
//     iAudio で櫛が伸びる
// =====================================================

// @param uSpeed   0..300    = 100.0
// @param uScale   30..300   = 100.0
// @param uRotate  0..360    = 0.0
// @param uCurl    0..200    = 100.0
// @param uSwirl   0..300    = 100.0
// @param uLines   0..300    = 100.0
// @param uFill    0..200    = 100.0
// @param uComb    0..300    = 100.0
// @param uRows    0..200    = 100.0
// @param uStars   0..200    = 100.0
// @param uChrome  0..200    = 100.0
// @param uPixel   1..8      = 2.0
// @param uKick    0..200    = 100.0
// @param uPalette 0..100    = 100.0
// @param uPalTime 1..60     = 10.0
// @param uPalFade 0..100    = 40.0
uniform float uSpeed;   // 流れの速さ (%)
uniform float uScale;   // 全体の大きさ (%)
uniform float uRotate;  // 帯の並びをずらす (deg)
uniform float uCurl;    // 流れのうねり (%)
uniform float uSwirl;   // 流れを曲げるレンズの強さ (%)
uniform float uLines;   // 等高線の密度 (%)
uniform float uFill;    // 塗り面の広さ (%)
uniform float uComb;    // 櫛歯の裂け (%)
uniform float uRows;    // 行クランプ縞の広さ (%)
uniform float uStars;   // 星の量 (%)
uniform float uChrome;  // 青いクロームの広さ (%)
uniform float uPixel;   // 画素の粗さ (px)
uniform float uKick;    // 拍 / 音での変化 (%)
uniform float uPalette; // パレット変化の強さ (% 0 で元の配色のまま)
uniform float uPalTime; // パレットを替える間隔 (秒)
uniform float uPalFade; // 間隔のうちフェードに使う割合 (% 0 で瞬時に切替)

float st_hash(float n){ return fract(sin(n*91.3458)*47453.5453); }
float st_hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
float st_noise1(float x){
  float i = floor(x), f = fract(x);
  return mix(st_hash(i), st_hash(i + 1.0), f*f*(3.0 - 2.0*f));
}
float st_noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0 - 2.0*f);
  return mix(mix(st_hash2(i), st_hash2(i + vec2(1.0, 0.0)), u.x),
             mix(st_hash2(i + vec2(0.0, 1.0)), st_hash2(i + vec2(1.0, 1.0)), u.x), u.y);
}
float st_fbm(vec2 p){
  float v = 0.5*st_noise(p);
  p = mat2(1.6, 1.2, -1.2, 1.6)*p + 3.1;
  v += 0.3*st_noise(p);
  p = mat2(1.6, 1.2, -1.2, 1.6)*p + 1.7;
  v += 0.2*st_noise(p);
  return v;
}
float st_band(float t, float a, float b){ return step(a, t)*step(t, b); }

// 暖色面: 黄緑 → 橙 → 錆 → テラコッタ
vec3 st_warm(float t){
  if(t < 0.16) return vec3(0.78, 0.77, 0.26);
  if(t < 0.30) return vec3(0.87, 0.84, 0.42);
  if(t < 0.44) return vec3(0.85, 0.40, 0.05);
  if(t < 0.60) return vec3(0.69, 0.30, 0.10);
  if(t < 0.80) return vec3(0.68, 0.43, 0.30);
  return vec3(0.45, 0.28, 0.12);
}
// 線の色: 藍 / 青紫 / 灰 / 墨 / 青緑 / 群青
vec3 st_ink(float h){
  if(h < 0.30) return vec3(0.42, 0.42, 0.80);
  if(h < 0.48) return vec3(0.23, 0.33, 0.75);
  if(h < 0.68) return vec3(0.46, 0.46, 0.48);
  if(h < 0.84) return vec3(0.12, 0.12, 0.14);
  if(h < 0.91) return vec3(0.30, 0.78, 0.82);
  return vec3(0.04, 0.17, 0.42);
}
// 淡色の縞 (下の帯): 位相 t で黄緑 → 黄土 → 灰桃 → 桃 → 赤 → 砂色
vec3 st_rowSoft(float t){
  t = fract(t)*6.0;
  if(t < 1.0) return vec3(0.42, 0.88, 0.16);
  if(t < 2.0) return vec3(0.78, 0.76, 0.34);
  if(t < 3.0) return vec3(0.80, 0.68, 0.64);
  if(t < 4.0) return vec3(0.90, 0.46, 0.60);
  if(t < 5.0) return vec3(0.86, 0.14, 0.26);
  return vec3(0.93, 0.82, 0.62);
}
// 蛍光の縞 (右の帯): 紫 / 水 / 緑 / 桃 / 青 / 若草
vec3 st_rowNeon(float t){
  t = fract(t)*6.0;
  if(t < 1.0) return vec3(0.40, 0.06, 0.90);
  if(t < 2.0) return vec3(0.02, 0.86, 1.00);
  if(t < 3.0) return vec3(0.14, 0.95, 0.56);
  if(t < 4.0) return vec3(0.96, 0.06, 0.76);
  if(t < 5.0) return vec3(0.04, 0.10, 0.96);
  return vec3(0.54, 1.00, 0.26);
}
// 五芒星の SDF (外接半径 1)
float st_star(vec2 p){
  const vec2 k1 = vec2(0.809017, -0.587785);
  const vec2 k2 = vec2(-0.809017, -0.587785);
  p.x = abs(p.x);
  p -= 2.0*max(dot(k1, p), 0.0)*k1;
  p -= 2.0*max(dot(k2, p), 0.0)*k2;
  p.x = abs(p.x);
  p.y -= 1.0;
  vec2  ba = 0.42*vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h  = clamp(dot(p, ba)/dot(ba, ba), 0.0, 1.0);
  return length(p - ba*h)*sign(p.y*ba.x - p.x*ba.y);
}

// 流れ関数: 等値線が川筋になる。中心点を作らないよう q.y の勾配を土台に sin のうねりだけを足す
float st_psi(vec2 q, float T, float k){
  return q.y + k*(0.30*sin(q.x*2.1 + T*0.37)
                + 0.16*sin(q.x*3.7 - q.y*1.9 - T*0.53)
                + 0.08*sin(q.x*7.3 + q.y*3.1 + T*0.71));
}
// パレット番号 i の配色: 無彩色の軸まわりの色相回転 + 彩度。0 番が元の配色
vec3 st_palette(vec3 c, float i){
  float n = mod(i, 6.0);
  float a = fract(n*0.618)*TAU*uPalette*0.01;
  float sat = 1.0 + 0.25*sin(n*2.1)*step(0.5, n)*uPalette*0.01;
  vec3  k = vec3(0.57735);
  vec3  r = c*cos(a) + cross(k, c)*sin(a) + k*dot(k, c)*(1.0 - cos(a));
  return clamp(mix(vec3(dot(r, vec3(0.299, 0.587, 0.114))), r, sat), 0.0, 1.0);
}
float stPalPhase;
// uBgColor が黒のとき、Slot A の紙は灰。Slot B の紙は透過
vec3 st_out(vec3 col, float cov){
  float pi = floor(stPalPhase);
  float pf = smoothstep(1.0 - max(uPalFade*0.01, 0.001), 1.0, fract(stPalPhase));
  col = mix(st_palette(col, pi), st_palette(col, pi + 1.0), pf);
  float paperOn = step(max(uBgColor.r, max(uBgColor.g, uBgColor.b)), 0.004);
  bgAlpha = cov;
  return col*cov + vec3(0.784)*paperOn*uSlotIsA*(1.0 - cov);
}

vec3 bg_smear_tear(vec2 fc){
  float bt   = getBeat();
  float kick = uKick*0.01;
  // 流れ時間: drone は一定 / beat は拍頭で加速→減速。行は T で這い、beat では拍ごとに総入れ替え
  float flowT, burst, rowSeed, jump = 0.0;
  if(isFree()){
    flowT   = time;
    burst   = 0.0;
    rowSeed = 0.0;
  } else {
    float fb = fract(bt);
    flowT   = (floor(bt) + 1.0 - pow(1.0 - fb, 3.0))*0.5;
    burst   = pow(1.0 - fb, 4.0)*kick;
    rowSeed = floor(bt)*37.0;
    jump    = floor(bt*0.25)*47.0*step(0.5, kick);
  }
  float T     = flowT*uSpeed*0.01;
  // パレットは uSpeed に関係なく実時間で進む (beat モードは拍から秒へ換算)
  stPalPhase = (isFree() ? time : bt*60.0/max(bpm, 1.0))/max(uPalTime, 0.1);
  float audio = clamp(iAudio, 0.0, 1.0)*kick;
  float amt   = uRows*0.01;

  float px = max(uPixel, 1.0);
  vec2  I  = (fc - resolution*0.5)/max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  I = (floor(I/px) + 0.5)*px;
  float rw  = floor(I.y/px) + floor(T*14.0) + rowSeed;
  float rh  = st_hash(rw);
  float rh3 = st_hash(floor(rw/3.0));

  // 行ずれの裂け: 帯が縦に走り、その中だけ行が横に飛ぶ
  float tear = step(0.70 - 0.25*burst, st_noise1(I.y/resolution.y*15.0 + T*0.75));
  I.x += tear*(rh - 0.5)*0.06*resolution.x*(1.0 + burst*2.0);

  vec2  uv = I/resolution;
  vec2  p  = (uv - 0.5)*vec2(1.1, 1.0)/max(uScale*0.01, 0.01);

  // 淡色の縞: 行の塊が画面を漂い、現れては消える
  float rz = st_noise(vec2(uv.x*2.3 + T*0.13, uv.y*4.2 - T*0.21 + jump*0.07)) + 0.22*(rh3 - 0.5) + 0.08*(rh - 0.5);
  if(amt > 0.01 && rz > 1.0 - 0.24*amt){
    float t = uv.y*3.0 + T*0.04 + 0.20*(rh3 - 0.5) + 0.34*(rh - 0.5);
    vec3  c = st_rowSoft(t);
    c = mix(c, vec3(0.78), step(0.74, rh));
    c = mix(c, vec3(0.05), step(0.96, rh));
    return st_out(c, 1.0);
  }

  // レンズ: 芯が渦にならない強さで流れを曲げる
  vec2  P2 = vec2(0.42*sin(T*0.31 + 1.0), 0.34*sin(T*0.43));
  vec2  d  = p - P2;
  float tw = uSwirl*0.01*(0.7 + burst*0.5 + 0.3*sin(T*0.31))*exp(-dot(d, d)/0.05);
  float cs = cos(tw), sn = sin(tw);
  d = mat2(cs, sn, -sn, cs)*d;
  p = P2 + d;

  // 流れの場: 全体が回り、うねりの強さが息をする。拍頭でうねりが跳ねる
  float ra = T*0.13 + 0.5*sin(T*0.29);
  vec2  q  = mat2(cos(ra), sin(ra), -sin(ra), cos(ra))*p;
  float k  = uCurl*0.01*(1.0 + 0.5*sin(T*0.33)) + burst*0.4;
  float psi = st_psi(q, T, k);
  vec2  grad = (vec2(st_psi(q + vec2(0.002, 0.0), T, k), st_psi(q + vec2(0.0, 0.002), T, k)) - psi)/0.002;
  float ang = psi*1.6;
  float rho = 0.15 + 1.15*st_noise(q*1.4 + vec2(-T*0.12, T*0.09));

  // 流れの座標 (x = 川筋に沿う / y = 川筋を横切る)。x を時間で引いて中身を流す (ときどき押し戻す)
  float chi = q.x + 0.35*k*sin(q.y*2.3 - T*0.31);
  vec2 s = vec2(chi*1.3 - T*0.16 - 0.3*sin(T*0.41), ang*2.6);
  vec2 w = vec2(st_noise(p*2.1 + vec2(T*0.09, -T*0.07)), st_noise(p*2.7 + 7.3 - T*0.06)) - 0.5;
  s += 0.75*w;

  // 櫛歯: 川筋を横切る高周波で流れ方向にずらす。歯も横へ滑る
  float tooth = st_noise1(ang*240.0 + T*1.3)*0.65 + st_noise1(ang*730.0 - T*2.1)*0.35;
  float zone  = smoothstep(0.40, 0.66, st_noise(s*0.9 + 3.1));
  float comb  = uComb*0.01*(1.0 + audio*1.5 + burst)*(0.06 + 1.3*zone)*tooth*tooth;
  vec2  sc    = s + vec2(comb, 0.0);
  float rc    = rho + comb*0.7;

  float A = st_fbm(sc*vec2(1.4, 1.1) + vec2(1.3, -T*0.05));
  float B = st_fbm(sc*vec2(0.8, 2.2) + vec2(T*0.04, 5.1));

  // 帯の位相 (deg): 場で揺らし、川筋を横切って移し続ける
  float th = degrees(ang)*1.8 + 16.0*(A - 0.5) + T*5.0 + uRotate + jump;
  th = mod(th + 20.0, 180.0) - 20.0;
  float fan = uFill*0.01;

  vec3  col = vec3(0.0);
  float cov = 0.0;

  // ---- 紙の上の線 ----
  float lk  = max(uLines*0.01, 0.01);
  float on  = step(0.02, uLines);
  float F   = s.y*1.4 + 0.3*w.x + 0.2*(A - 0.5)*zone;
  // 流れが詰まる所は線の間隔が画素を割るので、2 倍ずつ間引いて 3px 以上あける
  float fp  = px/resolution.y*101.0*lk*length(grad)/max(uScale*0.01, 0.01);
  float Fn  = F*26.0*lk/pow(2.0, max(ceil(log2(fp*3.0)), 0.0));
  float id  = floor(Fn);
  float h   = st_hash(id);
  float wd  = max(0.05 + 0.26*pow(h, 9.0), 0.4*fp*Fn/max(F*26.0*lk, 0.001));
  float bun = step(0.50 + 0.10*smoothstep(0.6, 1.1, rho), st_noise(vec2(F*4.0, s.x*0.55 + 2.0)));
  float dsh = step(0.20, st_noise(vec2(s.x*18.0, id)));
  float ln  = step(abs(fract(Fn) - 0.5), wd)*bun*dsh*on;
  col = st_ink(st_hash(id + 3.0));
  cov = ln;
  // 地形図のような細い線
  float Tn = (w.x*1.4 + w.y + 0.25*(B - 0.5))*16.0*lk;
  float tp = step(abs(fract(Tn) - 0.5), 0.05)*step(0.46, st_noise(w*5.0))*step(0.5, rho)*on*(1.0 - ln);
  if(tp > 0.5){ col = vec3(0.62, 0.65, 0.84); cov = 1.0; }

  // ---- 塗り: A/B の 2 次元 LUT ----
  float na = 7.0, nb = 5.0;
  vec2  cell = floor(vec2(A*na, B*nb));
  float ch   = st_hash2(cell + 11.0);
  float edge = step(fract(A*na), 0.035) + step(fract(B*nb), 0.035);

  // 暖色の楔
  float wedge = st_band(th, 48.0, 76.0)*step(0.10, rc)*step(rc, 0.85*fan + 0.6*(B - 0.5))*step(0.12, ch + 0.2*fan);
  if(wedge > 0.5){
    col = st_warm(fract(ch*0.9 + (th - 48.0)/28.0*0.75 + 0.6*(B - 0.5)));
    col = mix(col, vec3(0.09, 0.06, 0.03), step(0.5, edge));
    col = mix(col, col*0.55, ln);
    cov = 1.0;
  }
  // 錆の細い筋
  float rust = st_band(th, 43.5, 43.5 + (1.6 + 1.3*fan)/max(rc, 0.4))*step(0.3, rc)*step(0.34, B + 0.3*tooth);
  if(rust > 0.5){
    col = mix(vec3(0.69, 0.30, 0.10), vec3(0.03), step(0.60, st_noise(sc*vec2(9.0, 44.0))));
    cov = 1.0;
  }
  // 紫とテラコッタの面
  float lav = st_band(th, 84.0, 106.0)*step(0.42/max(fan, 0.01), rc)*step(0.45, B);
  if(lav > 0.5){
    col = (A > 0.50) ? vec3(0.33, 0.24, 0.47) : vec3(0.72, 0.42, 0.30);
    col = mix(col, vec3(0.06), step(0.5, edge));
    cov = 1.0;
  }
  // 淡い青の面
  float peri = st_band(th, 116.0, 134.0)*step(0.46, B)*step(0.22, rc);
  if(peri > 0.5){ col = (ch > 0.5) ? vec3(0.56, 0.64, 0.86) : vec3(0.38, 0.50, 0.82); cov = 1.0; }

  // 青いクローム: 光の縞が走る
  float chr  = uChrome*0.01;
  float chrm = st_band(th, 34.0 - 12.0*chr, 34.0)*step(0.46, rc)*step(0.42, B);
  if(chrm > 0.5){
    float g  = sin(F*22.0 + A*18.0 - T*1.6)*0.5 + 0.5;
    float dt = step(0.45, fract(s.x*150.0 + s.y*90.0));
    col = mix(vec3(0.03, 0.15, 0.50), vec3(0.12, 0.42, 0.90), step(0.35, g));
    col = mix(col, vec3(0.55, 0.85, 1.00), step(0.78, g));
    col = mix(col, vec3(1.0), step(0.93, g)*dt);
    cov = 1.0;
  }
  // 黒の筆致
  float strk = st_band(th, 17.0, 26.0)*step(0.50 - 0.2*(fan - 1.0), B)*step(0.25, rc)*step(0.30, abs(sin(A*30.0 + B*9.0)));
  if(strk > 0.5){ col = vec3(0.17)*(0.7 + 0.6*step(0.5, ch)); cov = 1.0; }
  // 珊瑚の迷路
  float coral = st_band(th, 12.0, 17.0)*step(0.30, rc)*step(0.40, B + 0.25*tooth);
  if(coral > 0.5){
    float mz = sin(sc.x*90.0 + 9.0*st_noise(sc*vec2(8.0, 30.0)))*sin(sc.y*120.0 + 7.0*st_noise(sc*vec2(14.0, 9.0)));
    col = mz > 0.1 ? vec3(0.96, 0.44, 0.36) : (mz > -0.25 ? vec3(0.95, 0.74, 0.70) : vec3(0.78));
    cov = 1.0;
  }
  // オリーブの帯
  float oliv = st_band(th, 6.0, 11.0)*step(0.34, rc)*step(0.42, A + 0.3*tooth);
  if(oliv > 0.5){ col = (A > 0.50) ? vec3(0.28, 0.28, 0.03) : vec3(0.20, 0.20, 0.07); cov = 1.0; }

  // 蛍光の縞 + 星
  float neonM = st_band(th, 27.0, 42.5)*step(0.50, rc + 0.04*rh)*step(0.44, B)*step(0.01, amt);
  if(neonM > 0.5){
    col = st_rowNeon(uv.y*4.0 + T*0.09 + 0.45*(rh3 - 0.5) + 0.25*(rh - 0.5));
    col = mix(col, vec3(0.78), step(0.88, rh));
    col = mix(col, vec3(0.03), step(0.95, rh));
    cov = 1.0;
    // 星: 横へ流れながら回り、行ごとにずれて縞に解ける
    float gs = 0.062*resolution.y;
    vec2  sp = vec2(I.x + (rh3 - 0.5)*3.0*px, I.y)/gs + vec2(T*0.5, 0.0);
    vec2  ci = floor(sp);
    float sh = st_hash2(ci + 3.0);
    if(sh < 0.42*uStars*0.01){
      vec2  o = 0.3 + 0.4*vec2(st_hash2(ci), st_hash2(ci + 5.0));
      float r = 0.14 + 0.34*pow(st_hash2(ci + 7.0), 2.0);
      float a = sh*40.0 + T*(sh*6.0 - 1.0);
      vec2  q = (sp - ci - o)/r;
      q = mat2(cos(a), sin(a), -sin(a), cos(a))*q;
      if(st_star(q) < 0.0){
        col = st_hash2(ci + 9.0) > 0.45 ? vec3(0.66, 0.92, 0.16) : vec3(0.30, 0.68, 0.60);
      }
    }
  }
  // クリームのリボン
  float crm = step(abs(fract(F*2.3 + 0.2 - T*0.07) - 0.5), 0.010 + 0.030*tooth)*st_band(th, 24.0, 42.0)*step(0.72, rc)*step(rc, 1.05 + 0.4*(B - 0.5));
  if(crm > 0.5){ col = vec3(0.96, 0.94, 0.78); cov = 1.0; }

  // 墨の裂け: 行ごとに長さが暴れる横長の筋が、上へ抜けていく
  float by = floor(uv.y*26.0 - T*0.7 + rowSeed*0.5);
  float bc = st_hash(by*3.1 + 0.7);
  float bo = step(0.84, st_hash(by + 2.0))*st_band(uv.x - (0.05 + 0.8*bc), 0.0, (0.02 + 0.22*st_hash(by + 5.0))*rh*rh);
  if(bo > 0.5){ col = vec3(0.02); cov = 1.0; }

  return st_out(col, cov);
}
