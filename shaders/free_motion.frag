// =====================================================
// random move control (per-beat)
// =====================================================
struct MoveRand {
  float dir;
  float dist;
  float speed;
  float hold;
};

MoveRand moveRand(float bt, float salt){
  float blk = floor(bt);
  float r0 = hash21(vec2(blk, 0.3 + salt));
  float r1 = hash21(vec2(blk, 1.1 + salt));
  float r2 = hash21(vec2(blk, 2.7 + salt));
  float r3 = hash21(vec2(blk, 5.9 + salt));
  MoveRand m;
  m.hold  = step(1.0 - uHoldProb, r0);
  m.dir   = step(0.5, r1) * 2.0 - 1.0;
  m.dist  = mix(0.20, 1.20, r2);
  m.speed = mix(0.45, 2.40, r3);
  return m;
}

float freeBlock(float bt){
  float scale = bpm / 120.0;
  return floor(bt * 0.15 * scale);
}

float freeDriftWeight(float bt, float salt){
  float v = vnoise1(bt * 0.06, salt + 77.7);
  return smoothstep(0.90, 1.00, v);
}

vec2 freeDriftDir(float bt, float salt){
  float blk = freeBlock(bt);
  float a = hash21(vec2(blk, salt + 13.7)) * TAU;
  return vec2(cos(a), sin(a));
}

vec2 freeHoverVec(float bt, float salt){
  float t = bt * 0.25;
  float x = fbm1(t, salt + 1.0);
  float y = fbm1(t, salt + 9.1);
  return vec2(x, y);
}

float randomMoveTime(float bt, float baseScale, float salt){
  if(isFree()){
    float w = freeDriftWeight(bt, salt);
    vec2 dir = freeDriftDir(bt, salt);
    float spd = baseScale * uFreeDriftGain * (bpm / 120.0);
    float driftVal = (dir.x + dir.y) * bt * spd;
    vec2 hv = freeHoverVec(bt, salt);
    float slow = fbm1(bt * 0.05, salt + 100.0);
    float mid  = hv.x + hv.y;
    float hoverVal = (slow * 1.4 + mid * 0.6) * baseScale * uFreeHoverGain;
    return mix(hoverVal, driftVal, w);
  }
  MoveRand m = moveRand(bt, salt);
  float blk = floor(bt);
  float ph  = fract(bt);
  float e   = easeOutQuint(ph);
  float adv = mix(e * m.speed, 0.0, m.hold);
  return (blk + adv) * m.dir * m.dist * baseScale;
}
