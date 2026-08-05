// =====================================================
// DRONE mode seamless camera
// =====================================================
vec2 droneSeamlessCam(float bt, float salt){
  float drift = 0.12;
  float tx = randomMoveTime(bt, TAU * 0.08, salt + 100.0);
  float ty = randomMoveTime(bt, TAU * 0.06, salt + 200.0);
  vec2 offset = vec2(tx, ty) * resolution.y * 0.1 * drift;
  return bgCamPx + offset;
}

float droneSeamlessZoom(float bt, float salt){
  float drift = 0.12;
  float z = vnoise1(bt * uFreeZoomRate, salt + 500.0);
  z = (z - 0.5) * 2.0;
  z = z * (0.85 + 0.15 * vnoise1(bt * (uFreeZoomRate * 2.0), salt + 501.0));
  return 1.0 + z * (uFreeZoomAmp * 0.5) * drift;
}

float droneSeamlessAngle(float bt, float salt){
  float drift = 0.12;
  float a = vnoise1(bt * 0.08, salt + 600.0);
  a = (a - 0.5) * 2.0;
  float angleRange = 10.0 * PI / 180.0;
  return a * angleRange * drift;
}

