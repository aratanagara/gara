// =====================================================
// bg_kakeami — 四隅カケアミ (corner cross-hatching)
//   四隅に短い平行線を角度を変えて重ねる。隅が最も密で、中心へ向かって
//   線が間引きされながら消える。線はゆっくり流れ、層の角度がずれ、
//   数秒〜十数秒で描き直される。uWobble で筆のうねりと太さのばらつき。
//   背景は黒、bgAlpha は線の実カバレッジ。uPaper=100 で白地に黒線。
//   getBeat() を使うので beat モードでも拍境界で絵が飛ばない。
// =====================================================

// @param uCover   0..100  = 48.0
// @param uDensity 0..100  = 55.0
// @param uLayers  1..4    = 3.0
// @param uLen     10..300 = 110.0
// @param uThick   4..60   = 18.0
// @param uSpeed   0..200  = 40.0
// @param uWobble  0..100  = 36.0
// @param uSeed    0..999  = 3.0
// @param uPaper   0..100  = 0.0
// @param uInk     color   = #ffffff
uniform float uCover;    // 中心への広がり
uniform float uDensity;  // 密度 (画面高あたりの線数)
uniform float uLayers;   // 重ねる角度の層
uniform float uLen;      // 線の長さ
uniform float uThick;    // 線の太さ (×0.1 px)
uniform float uSpeed;    // 流れ / 角度変化 / 描き直しの速さ
uniform float uWobble;   // 手描きのうねり
uniform float uSeed;     // 乱数シード
uniform float uPaper;    // 原稿モード (白地に黒 %)
uniform vec3  uInk;      // インク色

float ka_hash(float n){ return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
float ka_hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

mat2 ka_rot(float a){
  float c = cos(a), s = sin(a);
  return mat2(c, s, -s, c);
}

vec3 bg_kakeami(vec2 fc){
  float bt = getBeat();
  float T = isFree() ? time : bt * (60.0 / max(bpm, 1.0));

  vec2 I = (fc - resolution * 0.5) / max(bgZoom, 0.001) + resolution * 0.5 + bgCamPx;
  vec2 p = (I - 0.5 * resolution) / resolution.y;
  float zoomPx = resolution.y * max(bgZoom, 0.001);
  float aspect = resolution.x / max(resolution.y, 1.0);

  float reach = mix(0.15, 1.22, clamp(uCover, 0.0, 100.0) / 100.0);
  float perH = mix(8.0, 78.0, clamp(uDensity, 0.0, 100.0) / 100.0);
  float pitch = 1.0 / perH;
  float lenU = max(uLen, 1.0) / 100.0 * 4.4;
  float thickPx = max(uThick, 0.0) * 0.1;
  float spd = clamp(uSpeed, 0.0, 200.0) / 100.0;
  float wob = clamp(uWobble, 0.0, 100.0) / 100.0;
  float seed = floor(uSeed + 0.5) + 2.0;
  float layers = clamp(floor(uLayers + 0.5), 1.0, 4.0);
  float cycle = T * spd * 0.16;
  float gen = floor(cycle);
  float gf = fract(cycle);
  float reform = smoothstep(0.68, 1.0, gf);

  float ink = 0.0;
  for(int c = 0; c < 4; c++){
    float cf = float(c);
    float sxS = (c == 0 || c == 3) ? -1.0 : 1.0;
    float syS = (c < 2) ? -1.0 : 1.0;
    vec2 corner = vec2(sxS * aspect * 0.5, syS * 0.5);
    vec2 from = p - corner;
    float dist = length(from);
    float fade = clamp(1.0 - dist / reach, 0.0, 1.0);
    if(fade <= 0.001) continue;
    fade = fade * fade * (3.0 - 2.0 * fade);
    vec2 inward = -normalize(corner);
    float baseAng = atan(inward.y, inward.x) + 1.5707963;

    for(int L = 0; L < 4; L++){
      if(float(L) >= layers) continue;
      float li = float(L);
      float ang = baseAng + (li - 1.0) * 0.82;
      ang += sin(T * 0.23 + li * 1.7 + cf) * wob * 0.40;
      ang += T * spd * 0.12 * (li - 1.5);
      vec2 r = ka_rot(ang) * from;
      float rowPitch = pitch * mix(1.0, 1.30, li / 3.0);
      float sy = r.y / rowPitch + li * 0.41;
      float sx = r.x / rowPitch;
      sy += sin(sx * 0.45 + cf * 1.3) * wob * 0.07;
      float row = floor(sy);
      float rowH = ka_hash(row * 3.17 + li * 9.2 + cf * 4.4 + seed);
      float slide = T * spd * (0.42 + 0.16 * li);
      if(L == 1 || L == 3) slide = -slide;
      float lenL = lenU * mix(1.0, 0.70, li / 3.0) * mix(0.38, 1.0, fade) * mix(0.82, 1.12, rowH);
      float gapL = lenL * mix(0.10, 0.36, rowH);
      float period = max(lenL + gapL, 0.35);
      float along = sx + slide + (rowH - 0.5) * wob * 0.35;
      float phase = along / period;
      float dashId = floor(phase);
      float f = fract(phase);
      vec2 hid = vec2(row * 1.37 + li * 5.1 + cf * 2.0, dashId + seed);
      float hA = ka_hash2(hid + vec2(0.0, gen * 17.0));
      float hB = ka_hash2(hid + vec2(0.0, (gen + 1.0) * 17.0));
      float th = mix(0.62, 0.0, fade);
      th = clamp(th + li * 0.10, 0.0, 0.82);
      float exist = mix(step(th, hA), step(th, hB), reform);
      float frac = lenL / period;
      float dPhase = 1.45 / max(period * rowPitch * zoomPx, 1e-3);
      float dash = 1.0 - smoothstep(frac, frac + dPhase, f);
      float t = clamp(f / max(frac, 1e-3), 0.0, 1.0);
      float taper = pow(max(sin(min(t, 1.0) * PI), 0.0), 0.40);
      float bow = (sin(along * 1.15 + row * 0.37) + 0.35 * sin(along * 3.1 + rowH * 5.0)) * wob * 3.2;
      float distPx = abs((fract(sy) - 0.5) * rowPitch * zoomPx - bow);
      float hw = thickPx * 0.5 * taper * mix(1.0, mix(0.75, 1.30, hA), wob * 0.65);
      float line = (1.0 - smoothstep(hw, hw + 1.15, distPx)) * dash * exist;
      float soft = smoothstep(0.0, 0.22, fade);
      ink = max(ink, line * soft);
    }
  }

  ink = clamp(ink, 0.0, 1.0);
  float paper = clamp(uPaper, 0.0, 100.0) * 0.01;
  vec3 rgb = uInk * ink;
  rgb = mix(rgb, vec3(1.0 - ink), paper);
  bgAlpha = mix(ink, 1.0, paper);
  return rgb;
}
