// =====================================================
// bg_watercolors
//   Source : Shadertoy "Watercolors" https://www.shadertoy.com/view/msyfz1
//   Author : Felipe Tovar-Henao [www.felipe-tovar-henao.com]
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン対応。
//   ヘルパは wc_ で名前空間化。
// =====================================================
#define WC_PI 3.14159265359
#define WC_TWO_PI 6.28318530718
#define WC_SPEED .25
mat2 wc_rot2(in float a){ float c=cos(a); float s=sin(a); return mat2(c,-s,s,c); }
float wc_fold(in float x){ return abs(mod(x+1.,2.)-1.); }
vec2  wc_fold(in vec2 p){ return vec2(wc_fold(p.x), wc_fold(p.y)); }
float wc_cosine(in float x,in float s){
  float y=cos(fract(x)*WC_PI);
  return floor(x)+.5-(.5*pow(abs(y),1./s)*sign(y));
}
vec2 wc_cosine(in vec2 p,in float s){ return vec2(wc_cosine(p.x,s), wc_cosine(p.y,s)); }
vec3 wc_cosine(in vec3 p,in float s){ return vec3(wc_cosine(p.xy,s), wc_cosine(p.z,s)); }
float wc_scale(in float x,in float a,in float b,in float c,in float d){ return (x-a)/(b-a)*(d-c)+c; }
vec3 wc_gradient(in float t,in vec3 a,in vec3 b,in vec3 c,in vec3 d){ return a+b*cos(WC_TWO_PI*(c*t+d)); }
vec3 bg_watercolors(vec2 fc){
  vec2 I = (fc - resolution*0.5)/max(bgZoom,0.001) + resolution*0.5 + bgCamPx;
  vec2 res = resolution;
  vec2 uv = (I*2.-res)/(res.x<res.y?res.x:res.y);

  vec3 c1=vec3(.1), c2=vec3(.15), c3=vec3(2.6), c4=vec3(.1,.5,.6);
  float t=time*WC_SPEED;
  t += wc_cosine(t*.25, 2.);
  uv*=5.;
  vec2 p=uv;
  vec2 q=1.-uv;
  float a=.5;
  vec3 col=vec3(0);
  for(float i=1.;i<9.;i++){
    float s=pow(1.3,i);
    float an=-a-cos(a*.5+t)*.125;
    mat2 m=wc_rot2(an);
    p*=m; q*=m;
    a+=dot(cos(q+t+i-a)/s, vec2(.25));
    vec2 k=wc_fold(q-t-a+s);
    float h=wc_scale(sin(a+t*1.5),-1.,1.,.5,.75);
    q=mix(q,k,h);
    vec2 tmp=q; q=p; p=tmp;
    q*=2.;
    float w=a;
    col+=wc_gradient(a*.5+t*.3+i, c1,c2,c3,c4)*w;
  }
  col=wc_cosine(col,1.5);
  return col;
}
