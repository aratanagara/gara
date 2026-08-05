// =====================================================
// beat helpers
// =====================================================
float colorBeat(float bt){
  return floor(bt) + easeOutQuint(fract(bt));
}
