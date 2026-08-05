// =====================================================
// bg_liquicolor
//   Source : Shadertoy "liquicolor" https://www.shadertoy.com/view/Xc3SDf
//   3Dノイズ場を流れる視線ベクトルの蓄積。元のボリュームテクスチャを手続き3Dノイズで代替。
//   出力はグレースケール、Post FX の Cos Grad (uCosGrad) で彩色(デフォ=グレースケール)。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは lq_ で名前空間化。
// =====================================================
mat2 lq_rotate(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }

float lq_h31(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float lq_n3(vec3 x){
  vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(lq_h31(i+vec3(0,0,0)), lq_h31(i+vec3(1,0,0)), f.x),
                 mix(lq_h31(i+vec3(0,1,0)), lq_h31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(lq_h31(i+vec3(0,0,1)), lq_h31(i+vec3(1,0,1)), f.x),
                 mix(lq_h31(i+vec3(0,1,1)), lq_h31(i+vec3(1,1,1)), f.x), f.y), f.z);
}
vec3 lq_field(vec3 p){ return vec3(lq_n3(p), lq_n3(p+19.7), lq_n3(p+43.3)); }

vec3 lq_slerp(vec3 a, vec3 b, float t){
  float c = clamp(dot(a,b), -1.0, 1.0);
  float theta = acos(c) * t;
  vec3 rel = normalize(b - a*c + 1e-6);
  return a*cos(theta) + rel*sin(theta);
}

vec3 bg_liquicolor(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec3 v = normalize(vec3((2.0*I - resolution.xy)/resolution.y, 0.5));
  vec3 p = vec3(0.5, 0.5, 0.5 + time*0.25) + v*0.25;

  const int N = 16;
  vec3 color = vec3(0.0);
  for(int i=0;i<N;i++){
    vec3 c = normalize(lq_field(p*7.0)*2.0 - 1.0);   // 周波数を上げて空間変化を出す
    color += c;
    v = lq_slerp(v, c, -0.25);
    p += v/16.0;
  }
  color /= float(N);
  color.yz *= lq_rotate(time);
  color = tanh(color*2.0)*0.5 + 0.5;

  // グレースケール基調
  float lum = clamp(dot(color, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  vec3 grey = vec3(lum);

  // Cos Grad: OFF(0) でグレースケール、ON で iq パレットに遷移
  if(abs(uCosGrad) < 0.0001) return grey;
  float cgInv = uCosGrad < 0.0 ? 0.5 : 0.0;
  // パレット入力は画面で大きく変化させる(一色化を防ぐ)。flow の色相 + 明度で。
  float t = fract(atan(color.b - color.r, color.g - color.r) * 0.159 + lum*1.3 + time*0.03);
  vec3 cosCol = cosGradColor(t + cgInv);
  vec3 colored = cosCol * (lum * 2.0);           // グレーの明暗を保って着色
  return mix(grey, colored, abs(uCosGrad));
}
