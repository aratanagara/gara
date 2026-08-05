// =====================================================
// smooth random helpers
// =====================================================
float smooth01(float x){
  return x*x*(3.0-2.0*x);
}

float vnoise1(float t, float salt){
  float i = floor(t);
  float f = fract(t);
  float e = smooth01(f);
  float a = hash21(vec2(i, salt));
  float b = hash21(vec2(i + 1.0, salt));
  return mix(a, b, e);
}

float fbm1(float t, float salt){
  float n = 0.0;
  float amp = 0.55;
  float frq = 0.22;
  for(int k=0;k<4;k++){
    n += (vnoise1(t*frq, salt + float(k)*19.7) - 0.5) * 2.0 * amp;
    amp *= 0.55;
    frq *= 2.05;
  }
  return n;
}

float freeSeed(float bt, float rate, float salt){
  float t = bt * rate;
  return vnoise1(t, salt);
}
