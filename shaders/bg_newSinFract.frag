// 6) sin/fract
// @param uDetail   2..12   = 12.0
// @param uFolds    2..12   = 12.0
// @param uWarp     0..250  = 100.0
// @param uContrast 25..200 = 100.0
uniform float uDetail;     // 外側の反復回数 (下げると軽く、色の混ざりが減る)
uniform float uFolds;      // 内側の折り返し回数 (下げると軽く、模様が単純になる)
uniform float uWarp;       // 反復ごとの歪みのフィードバック量 (%)
uniform float uContrast;   // 明暗の強さ (%)
// @param uCrossFold 85..125 = 100
// @param uWarpFreq  25..300 = 100
// @param uRibbon    50..300 = 100
// @param uRibbonX   50..300 = 100
// @param uMirror    0..100 = 0
// @param uTwirl     -300..300 = 0
// @param uLens      -100..100 = 0
// @param uSkyShift  50..150 = 100
// @param uSway      0..300 = 100
uniform float uCrossFold; // 交差軸方向の折り込み量 (%)
uniform float uWarpFreq;  // 歪みフィードバックの縞の細かさ (%)
uniform float uRibbon;    // 縦リボンの密度 (%)
uniform float uRibbonX;   // 横リボンの密度 (%)
uniform float uMirror;    // 左右の鏡像対称 (%)。0 = なし / 100 で完全な左右対称
uniform float uTwirl;     // 中心からの距離に比例したねじれ (%)。0 = なし / 負で逆回り
uniform float uLens;      // 中心の膨らみ・絞り (%)。0 = なし / 負で外側が広がる
uniform float uSkyShift;  // 開始位置の縦のずれ (%)
uniform float uSway;      // 開始位置の横揺れの振れ幅 (%)
// @param uCenterX   -100..100 = 0
// @param uCenterY   -100..100 = 0
// @param uRotate    -180..180 = 0
// @param uMirrorY   0..100 = 0
// @param uSwayY     0..300 = 100
// @param uSeed      0..100 = 0
// @param uPosterize 0..8 = 0
// @param uVignette  0..100 = 0
// @param uTintLow   color = #ffffff
// @param uTintHigh  color = #ffffff
uniform float uCenterX;   // 開始位置の横ずれ (%)。0 = なし
uniform float uCenterY;   // 開始位置の縦ずれ (%)。0 = なし
uniform float uRotate;    // 開始位置の回転 (度)。0 = なし
uniform float uMirrorY;   // 上下の鏡像対称 (%)。0 = なし / 100 で完全な上下対称
uniform float uSwayY;     // 開始位置の縦揺れの振れ幅 (%)
uniform float uSeed;      // 模様の別バージョン (%)。0 = 既定
uniform float uPosterize; // 階調の段数。0 = なし / 小さいほど段が粗い
uniform float uVignette;  // 周辺の暗さ (%)。0 = なし
uniform vec3  uTintLow;   // 暗い部分の色
uniform vec3  uTintHigh;  // 明るい部分の色

vec3 bg_newSinFract(vec2 fc){
  float bt = getBeat();
  const int ITERS = 12;
  float t = randomMoveTime(bt, TAU / 16.0, 601.0);
  if(uSeed != 0.0) t += uSeed * 0.37;
  vec3 col = vec3(0.0), col_prev = vec3(0.0);
  vec2 uv = (fc * 10.0 - resolution.xy) / resolution.y / 10.0 / bgZoom;
  vec2 panUV = bgCamPx / resolution.y * 5.0;
  uv = uv + panUV;
  if(uRotate != 0.0){ float ra = radians(uRotate); float cr = cos(ra), sr = sin(ra); uv = mat2(cr, -sr, sr, cr) * uv; }
  if(uCenterX != 0.0) uv.x += uCenterX / 100.0 * 2.0;
  uv.x += 0.8*sin(t*0.13) * (uSway / 100.0);
  if(uMirror > 0.0) uv.x = mix(uv.x, abs(uv.x), uMirror / 100.0);
  if(uMirrorY > 0.0) uv.y = mix(uv.y, abs(uv.y), uMirrorY / 100.0);
  uv.y += 3.0 * (uSkyShift / 100.0) + 0.8*sin(t*0.2) * (uSwayY / 100.0);
  if(uCenterY != 0.0) uv.y += uCenterY / 100.0 * 2.0;
  if(uTwirl != 0.0){ float ta = length(uv) * uTwirl / 100.0 * 0.12; float ca = cos(ta), sa = sin(ta); uv = mat2(ca, -sa, sa, ca) * uv; }
  if(uLens != 0.0) uv *= 1.0 + uLens / 100.0 * dot(uv, uv) * 0.05;
  for(int c=0;c<ITERS;c++){
    if(c >= int(uDetail + 0.5)) break;
    float scale  = 2.25;
    float scale1 = 1.9;
    col_prev = col;
    for(int i=0;i<ITERS;i++){
      if(i >= int(uFolds + 0.5)) break;
      uv = sin(uv.yx / (scale1*scale)) * (scale1*scale);
      uv = -fract(uv + vec2(uv.x/scale - uv.y/scale1*(uCrossFold / 100.0), uv.y/scale - uv.x/scale1*(uCrossFold / 100.0)) / scale) * scale / scale1;
      uv.y /= -scale1;
      scale1 += (uv.x * (0.005 * (uWarp / 100.0) * fract(uv.x * (uWarpFreq / 100.0) + t * (scale1*scale))));
    }
    col.b = abs(fract(uv.y * (uRibbon / 100.0)) - fract(uv.x * (uRibbonX / 100.0)));
    col = (col + col_prev.yzx) / 2.0;
  }
  vec3 grey = clamp(col * 3.0 * (uContrast / 100.0), 0.0, 1.0);
  if(uPosterize >= 1.0){ float pq = floor(uPosterize + 0.5) + 1.0; grey = floor(grey * pq) / pq; }
  if(uVignette != 0.0){ vec2 vq = (fc - 0.5 * resolution.xy) / resolution.y; grey *= 1.0 - clamp(dot(vq, vq) * 1.2, 0.0, 1.0) * uVignette / 100.0; }
  if(uTintLow != vec3(1.0) || uTintHigh != vec3(1.0)){ float gl = dot(grey, vec3(0.3333)); grey *= uTintLow + (uTintHigh - uTintLow) * gl; }
  if(abs(uCosGrad) < 0.0001) return grey;
  float cgInv = uCosGrad < 0.0 ? 0.5 : 0.0;
  // ON 時のみ: 色相を cosine gradient で遷移（Hinotori 方式）
  float ct = fract(dot(grey, vec3(0.6, 0.8, 1.0)));
  float qStep = 0.34;
  float qf = ct / qStep;
  float qb = floor(qf);
  float qramp = smoothstep(0.45, 1.0, fract(qf));
  ct = (qb + qramp) * qStep;
  vec3 cosCol = cosGradColor(ct + cgInv);
  return mix(grey, cosCol, abs(uCosGrad));
}
