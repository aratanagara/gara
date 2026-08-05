// =====================================================
// DRAW mode random camera
// =====================================================
vec2 drawRandomCam(float bt, float salt){
  float blk = floor(bt);
  float rx = hash21(vec2(blk, salt + 100.0));
  float ry = hash21(vec2(blk, salt + 200.0));
  vec2 range = resolution * 0.0025;
  vec2 offset = vec2((rx - 0.5) * 3.0 * range.x, (ry - 0.5) * 3.0 * range.y);
  return bgCamPx + offset;
}

float drawRandomZoom(float bt, float salt){
  float blk = floor(bt);
  float rz = hash21(vec2(blk, salt + 300.0));
  return mix(1.5, 2.0, rz);
}

float drawRandomAngle(float bt, float salt){
  float blk = floor(bt);
  float ra = hash21(vec2(blk, salt + 400.0));
  float angleRange = 15.0 * PI / 180.0;
  return (ra - 0.5) * 2.0 * angleRange;
}

vec2 applyZoomToFC(vec2 fc, float zoom){
  vec2 c = 0.5 * resolution.xy;
  return (fc - c) / zoom + c;
}
