// =====================================================
// FREE zoom
// =====================================================
float freeZoom(float bt, float salt){
  float z = vnoise1(bt * uFreeZoomRate, salt + 900.1);
  z = (z - 0.5) * 2.0;
  z = z * (0.85 + 0.15 * vnoise1(bt * (uFreeZoomRate * 2.0), salt + 901.7));
  return 1.0 + z * uFreeZoomAmp;
}
