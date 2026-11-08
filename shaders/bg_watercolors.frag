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
// @param uDetail 4..8 = 8.0
// @param uWarp 0..200 = 100.0
// @param uDensity 25..400 = 100.0
// @param uContrast 20..400 = 100.0
// @param uBands 20..300 = 100.0
// @param uFoldScale 50..200 = 100
// @param uFoldLow 20..90 = 50
// @param uFoldHigh 50..100 = 75
// @param uLayerRatio 115..170 = 130
// @param uZoomStep 70..150 = 100
// @param uStartAngle -40..40 = 0
// @param uTurnRate 0..1000 = 100
// @param uAccum 25..160 = 100
// @param uLayerHue 25..300 = 100
// @param uCenterX -100..100 = 0
// @param uCenterY -100..100 = 0
// @param uRotate -180..180 = 0
// @param uStretchX 40..250 = 100
// @param uMirror -100..100 = 0
// @param uTwirl -100..100 = 0
// @param uPaletteShift -50..50 = 0
// @param uPaletteBody 25..250 = 100
// @param uChannelSplit 0..100 = 0
// @param uLayerTilt -80..80 = 0
// @param uPosterize 0..100 = 0
// @param uVignette 0..100 = 0
// @param uFilmGrain 0..100 = 0
// @param uWashColor color = #ffffff
// @param uDeepColor color = #ffffff
uniform float uDetail;   // 折り重ねの回数 (下げると模様が単純になる)
uniform float uWarp;   // 回転のゆらぎ (歪み) の強さ (%)
uniform float uDensity;   // 模様の密度 (%)
uniform float uContrast;   // 色の段の締まり (%)
uniform float uBands;   // パレットの色の巡り (%)
uniform float uFoldScale;   // 折り返しの細かさ (%)
uniform float uFoldLow;   // 折り返しの混ざり方の下限 (%)
uniform float uFoldHigh;   // 折り返しの混ざり方の上限 (%)
uniform float uLayerRatio;   // 層ごとの縮み率 (%)。大きいと奥の層が急に細かくなる
uniform float uZoomStep;   // 層ごとの拡大の刻み (%)
uniform float uStartAngle;   // 回転の初期角 (%)
uniform float uTurnRate;   // 回転のゆらぎの細かさ (%)
uniform float uAccum;   // 層の積み重なりが回転に戻る量 (%)
uniform float uLayerHue;   // 層ごとの色の進み (%)
uniform float uCenterX;   // 模様の中心の横位置 (%)
uniform float uCenterY;   // 模様の中心の縦位置 (%)
uniform float uRotate;   // 模様全体の回転角 (度)
uniform float uStretchX;   // 模様の横の伸び縮み (%)
uniform float uMirror;   // 左右対称の折り返し位置 (%)。+ で左側を、- で右側を折り返す。0 で無効
uniform float uTwirl;   // 中心から外へ向かうねじれ (%)
uniform float uPaletteShift;   // パレットの位相のずれ (%)。色の組み合わせが変わる
uniform float uPaletteBody;   // パレットの振れ幅 (%)。色の濃淡の差
uniform float uChannelSplit;   // RGB ごとの色の巡りのずれ (%)。色が分離して虹がかる
uniform float uLayerTilt;   // 浅い層と深い層の重み配分 (%)。+ で深い層、- で浅い層が強い
uniform float uPosterize;   // 色の段階を粗くする (%)。100 でほぼ数色
uniform float uVignette;   // 周辺の暗がり (%)
uniform float uFilmGrain;   // 紙のようなざらつき (%)
uniform vec3 uWashColor;   // 全体にかける色味 (掛け算)
uniform vec3 uDeepColor;   // 深い層ほど強くかかる色味 (掛け算)

vec3 bg_watercolors(vec2 fc){
  vec2 I = (fc - resolution*0.5)/max(bgZoom,0.001) + resolution*0.5 + bgCamPx;
  vec2 res = resolution;
  vec2 uv = (I*2.-res)/(res.x<res.y?res.x:res.y);

  vec3 c1=vec3(.1), c2=vec3(.15), c3=vec3(2.6)*(uBands/100.0), c4=vec3(.1,.5,.6);
  float t=time*WC_SPEED;
  t += wc_cosine(t*.25, 2.);
  vec2 uvScr = uv;
  uv*=5.*(uDensity/100.0);
  if(uStretchX != 100.0){ uv.x *= uStretchX / 100.0; }
  if(uMirror != 0.0){ float mc = uMirror * 0.006 * 5.0; uv.x = (uMirror > 0.0 ? 1.0 : -1.0) * abs(uv.x - mc) + mc; }
  if(uTwirl != 0.0){ float tw = uTwirl / 100.0 * length(uv) * 0.35; float tc = cos(tw), ts = sin(tw); uv = vec2(tc*uv.x - ts*uv.y, ts*uv.x + tc*uv.y); }
  if(uRotate != 0.0){ float ra = radians(uRotate); float rc = cos(ra), rs = sin(ra); uv = vec2(rc*uv.x - rs*uv.y, rs*uv.x + rc*uv.y); }
  if(uCenterX != 0.0 || uCenterY != 0.0){ uv += vec2(uCenterX, uCenterY) / 100.0 * 5.0; }
  vec2 p=uv;
  vec2 q=1.-uv;
  float a=.5;
  if(uStartAngle != 0.0){ a += uStartAngle / 100.0; }
  if(uPaletteShift != 0.0){ c4 += uPaletteShift / 100.0; }
  if(uPaletteBody != 100.0){ c2 *= uPaletteBody / 100.0; }
  if(uChannelSplit != 0.0){ c3 += vec3(-1.0, 0.0, 1.0) * (uChannelSplit / 100.0); }
  bool tinted = (uDeepColor != vec3(1.0));
  vec3 col=vec3(0);
  for(float i=1.;i<9.;i++){
    if(i > uDetail + 0.5) break;
    float s=pow(uLayerRatio != 130.0 ? uLayerRatio / 100.0 : 1.3,i);
    float an=-a-cos(a*.5*(uTurnRate/100.0)+t)*.125*(uWarp/100.0);
    mat2 m=wc_rot2(an);
    p*=m; q*=m;
    a+=dot(cos(q+t+i-a)/s, vec2(.25)*(uAccum/100.0));
    vec2 k=wc_fold((q-t-a+s)*(uFoldScale/100.0));
    float h=wc_scale(sin(a+t*1.5),-1.,1.,uFoldLow != 50.0 ? uFoldLow/100.0 : .5,uFoldHigh != 75.0 ? uFoldHigh/100.0 : .75);
    q=mix(q,k,h);
    vec2 tmp=q; q=p; p=tmp;
    q*=2.*(uZoomStep/100.0);
    float w=a;
    if(uLayerTilt != 0.0){ w *= 1.0 + (i - 4.5) * (uLayerTilt / 100.0) * 0.5; }
    vec3 lc = wc_gradient(a*.5+t*.3+i*(uLayerHue/100.0), c1,c2,c3,c4);
    if(tinted){ lc *= mix(vec3(1.0), uDeepColor, (i - 1.0) / 7.0); }
    col+=lc*w;
  }
  col=wc_cosine(col,1.5*(uContrast/100.0));
  if(uPosterize != 0.0){ float lv = mix(24.0, 4.0, uPosterize / 100.0); col = floor(col * lv + 0.5) / lv; }
  if(uWashColor != vec3(1.0)){ col *= uWashColor; }
  if(uVignette != 0.0){ col *= 1.0 - (uVignette / 100.0) * 0.85 * smoothstep(0.6, 2.0, length(uvScr)); }
  if(uFilmGrain != 0.0){ col += (fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * (uFilmGrain / 100.0) * 0.35; }
  return col;
}
