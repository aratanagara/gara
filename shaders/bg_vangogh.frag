// =====================================================
// Backgrounds
// =====================================================

// Meguru と共用するコサインパレット (本ファイルに重複定義: 各 bg は単独コンパイルされるため)
vec3 vg_cosineGradient(float tt, vec3 a, vec3 b, vec3 c, vec3 d){
  return a + b * cos(6.28318 * (c * tt + d));
}

// 0) VanGogh
vec3 bg_vangogh(vec2 fc){
  float bt   = getBeat();
  float blk  = floor(bt);
  float seed = 0.0;
  if(isFree()){
    seed = freeSeed(bt, 0.07, 777.1);
  }else{
    seed = hash21(vec2(blk, blk * 7.1));
  }
  float t = randomMoveTime(bt, TAU * (0.18 + 0.10 * seed), 101.0) + seed * 6.0;
  vec2 p = (fc - 0.5 * resolution.xy) / uRingZoom / bgZoom;
  p.x *= resolution.x / resolution.y;
  vec2 panUV = bgCamPx / resolution.y * 5.0;
  p = p + panUV;
  vec2 off = vec2(1.0);
  if(isFree()){
    float ox = freeSeed(bt, 0.05, 33.1);
    float oy = freeSeed(bt, 0.05, 91.7);
    off = vec2(ox, oy) - 0.5;
  }else{
    off = vec2(hash21(vec2(blk, 33.1)), hash21(vec2(blk, 91.7))) - 0.5;
  }
  p += off * 0.35;
  for(int i=0;i<TIMES;i++){
    float d = ceil(-sin(t) + length(p) * 6.0) / 3.0;
    p += vec2(
      sin(p.y + sin(d)) - sin(t / 4.0),
     -sin(p.x - sin(d)) - cos(t / 4.0)
    );
  }
  // Meguru と同じカラーシステム: 異周期 sin で a/b/c/d を連続ドリフト + 量子化
  float pt = bt * 0.05;
  vec3 a  = vec3(0.50, 0.50, 0.50)
          + vec3(0.10 * sin(pt * 0.71 + 0.0),
                 0.10 * sin(pt * 0.83 + 1.7),
                 0.10 * sin(pt * 0.97 + 3.1));
  vec3 b0 = vec3(0.50, 0.50, 0.50)
          + vec3(0.15 * sin(pt * 0.61 + 2.3),
                 0.15 * sin(pt * 0.79 + 4.1),
                 0.15 * sin(pt * 0.89 + 0.7));
  vec3 cP = vec3(1.00, 1.00, 1.00)
          + vec3(0.20 * sin(pt * 0.43 + 1.1),
                 0.20 * sin(pt * 0.57 + 3.5),
                 0.20 * sin(pt * 0.67 + 5.0));
  vec3 d4 = vec3(0.00, 0.33, 0.67)
          + vec3(pt * 0.030, pt * 0.027, pt * 0.024);
  float phase = isFree() ? (t * 0.005) : (bt * 0.05 + seed * 1.5);
  float spatialGrad = dot(p, vec2(0.020, 0.016));
  float colorParam = spatialGrad + length(p) * 0.006 + bt * 0.08 + phase;
  // ソフト量子化: band プラトー + 境界 smoothstep で中間色を温存
  float vStep = 0.16;
  float fv = colorParam / vStep;
  float bv = floor(fv);
  float frv = fract(fv);
  float rampv = smoothstep(0.30, 1.00, frv);
  colorParam = (bv + rampv) * vStep;
  vec3 c = vg_cosineGradient(colorParam, a, b0, cP, d4);
  c = saturateColor(c, 1.15);
  return clamp(c, 0.0, 1.0);
}

