// =====================================================
// bg_marble
//   Source : Shadertoy "4D Voronoi Marble" https://www.shadertoy.com/view/43G3Wy
//   License: CC0-1.0
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン対応。
//   ヘルパ/マクロ/グローバルは vm_ で名前空間化。
// =====================================================
bool  vm_dark = false;
int   vm_Seed = 420;
int   vm_MOD = 2;
vec3  vm_Shape = vec3(.5);
vec3  vm_Move = vec3(0., 1., 0.);
float vm_Layers = 3.;
float vm_Curve = 2.;
float vm_Smooth = 1.;
float vm_Sat = 1.1;
float vm_LineW = 30.;
float vm_LineS = 0.;
float vm_ofs = .0001;

#define vm_hash44(p) fract(18.5453 * sin(p * mat4(127.1,311.7,269.5,183.3, 421.1,547.6,231.3,298.4, 87.6,123.4,356.1,654.3, 765.1,876.4,132.5,234.8)))
#define vm_disp(p) ( -vm_ofs + (1.0 + 2.0*vm_ofs) * vm_hash44(p) )

// @param uCellX      50..200 = 100.0
// @param uCellY      50..200 = 100.0
// @param uCellZ      50..200 = 100.0
// @param uNoiseScale 50..200 = 100.0
// @param uProfile    80..150 = 100.0
// @param uLineStart  0..10 = 0.0
// @param uLayerFade  50..200 = 100.0
// @param uLayerZoom  60..150 = 100.0
// @param uLayerTurn  -180..180 = 0.0
// @param uCellJitter 25..100 = 100.0
uniform float uCellX; // セルの X 方向の伸縮 (%)
uniform float uCellY; // セルの Y 方向の伸縮 (%)
uniform float uCellZ; // セルの Z 方向の伸縮 (%)
uniform float uNoiseScale; // 歪みノイズの波長 (%)。下げると細かくうねる
uniform float uProfile; // 線の断面の指数 (%)。上げると線が鋭く、下げると丸い
uniform float uLineStart; // 線が始まる距離 (%)。上げるとセルの縁だけが残る
uniform float uLayerFade; // 重ねた層の減衰の速さ (%)
uniform float uLayerZoom; // 層ごとの細かさの倍率 (%)
uniform float uLayerTurn; // 層ごとの追加回転 (度)
uniform float uCellJitter; // セルの点のばらつき (%)。下げると規則的な格子状
// @param uSeedShift -200..200 = 0
// @param uTiltX -80..80 = 0
// @param uTiltY -80..80 = 0
// @param uMirror 0..2 = 0
// @param uFlowDir -180..180 = 0
// @param uLayerShift -100..100 = 0
// @param uLineAmount 20..200 = 100
// @param uWarpTwist -180..180 = 0
// @param uWarpRough 60..135 = 100
// @param uWarpLacun 60..140 = 100
// @param uInvert 0..100 = 0
// @param uGrain 0..100 = 0
// @param uVignette 0..100 = 0
// @param uEdgeColor color = #ffffff
// @param uCoreColor color = #ffffff
uniform float uSeedShift; // 模様のシード。値を変えると別のセル配置になる
uniform float uTiltX; // 球面の X 軸まわりの傾き (度)。模様を別の面から見る
uniform float uTiltY; // 球面の Y 軸まわりの傾き (度)
uniform float uMirror; // 鏡像。1 で左右対称、2 で上下左右対称
uniform float uFlowDir; // セルが流れる向き (度)
uniform float uLayerShift; // 層ごとのずらし (%)。層が重なる位置が変わる
uniform float uLineAmount; // 線の濃さ (%)。下げると薄く、上げると太く黒く
uniform float uWarpTwist; // 歪みの向きの回転 (度)。うねりの流れ方が変わる
uniform float uWarpRough; // 歪みの粗さ (%)。上げると細かいうねりが強い
uniform float uWarpLacun; // 歪みノイズの周波数の増え方 (%)
uniform float uInvert; // 白黒の反転。50 以上で黒地に白線
uniform float uGrain; // 粒状のざらつき (%)
uniform float uVignette; // 周辺減光 (%)
uniform vec3  uEdgeColor; // 線の周りの階調に掛けるティント
uniform vec3  uCoreColor; // セルの中心の明るい部分に掛けるティント

float vm_voronoi(vec4 u){
  u.w *= 0.1;
  u.w = 1.0 - 2.0 * abs(fract(u.w + 0.5) - 0.5);
  u.w *= 0.99;
  u.w += float(vm_Seed) + uSeedShift;
  u.xyz += vm_Move * time;
  vec4 iu = floor(u);
  float m = 1e9, m2 = 1e9;
  vec4 P = vec4(0.), P2 = vec4(0.);
  vec4 iu_offset = iu - 0.5;
  vec4 p, o, r;
  float d;
  for(int k = 0; k < 8; k++){
    p = iu_offset + vec4(k % 2, (k / 2) % 2, (k / 4) % 2, k / 8);
    o = vm_disp(p);
    if(uCellJitter != 100.0) o = 0.5 + (o - 0.5) * (uCellJitter / 100.0);
    r = p - u + o;
    d = dot(r, r);
    if(d < m){ m2 = m; P2 = P; m = d; P = r; }
    else if(d < m2 && dot(P - r, P - r) > 1e-5){ m2 = d; P2 = r; }
  }
  if(m2 < 1e9) m2 = 0.5 * dot((P + P2), normalize(P2 - P));
  return m2;
}

mat3 vm_rot3(float angle){
  float c = cos(angle), s = sin(angle);
  return mat3(c, -s, 0, s, c, 0, 0, 0, 1);
}
#define vm_hash31(p) fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123)
float vm_noise3(vec3 p){
  vec3 i = floor(p);
  vec3 f = fract(p); f = f*f*(3.0 - 2.0*f);
  float v = mix(
      mix(mix(vm_hash31(i+vec3(0,0,0)), vm_hash31(i+vec3(1,0,0)), f.x),
          mix(vm_hash31(i+vec3(0,1,0)), vm_hash31(i+vec3(1,1,0)), f.x), f.y),
      mix(mix(vm_hash31(i+vec3(0,0,1)), vm_hash31(i+vec3(1,0,1)), f.x),
          mix(vm_hash31(i+vec3(0,1,1)), vm_hash31(i+vec3(1,1,1)), f.x), f.y), f.z);
  return vm_MOD == 0 ? v
       : vm_MOD == 1 ? 2.0*v - 1.0
       : vm_MOD == 2 ? abs(2.0*v - 1.0)
                     : 1.0 - abs(2.0*v - 1.0);
}
#define vm_noise33(p) vec3(vm_noise3(p), vm_noise3(p + vec3(17.7)), vm_noise3(p + vec3(34.1)))
// @param uDetail  1..6    = 6.0
// @param uLayers  1..4    = 3.0
// @param uAngle   -180..180 = 0.0
// @param uWarp    0..300  = 100.0
// @param uThick   25..400 = 100.0
// @param uSize    40..400 = 100.0
uniform float uDetail;    // 歪みノイズのオクターブ数 (下げると軽く、うねりが単純になる)
uniform float uAngle;    // セル模様の向き (度)
uniform float uLayers;    // 重ねる層の数 (増やすと重くなる)
uniform float uWarp;      // 模様の歪みの強さ (%)
uniform float uThick;     // 線の太さ (%)
uniform float uSize;      // セルひとつの大きさ (%)

vec3 vm_fbm33(vec3 p){
  vec3 v = vec3(0.0);
  float a = 0.5;
  mat3 R = vm_rot3(0.37);
  for(int i = 0; i < 6; i++, p *= (uWarpLacun / 50.0), a *= (uWarpRough / 200.0)){
    if(i >= int(uDetail + 0.5)) break;
    p = R * p;
    v += a * vm_noise33(p);
  }
  return v;
}
vec3 vm_uv3d(vec2 uv){
  float theta = uv.x * 2.0 * 3.14159265359;
  float phi = uv.y * 3.14159265359;
  return vec3(sin(phi)*cos(theta), sin(phi)*sin(theta), cos(phi));
}

vec3 bg_marble(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = I / resolution.xy;
  vec3 pos = vm_rot3(radians(uAngle)) * vm_uv3d(uv);
  if(uTiltX != 0.0){
    float c = cos(radians(uTiltX)), s = sin(radians(uTiltX));
    pos = vec3(pos.x, c*pos.y - s*pos.z, s*pos.y + c*pos.z);
  }
  if(uTiltY != 0.0){
    float c = cos(radians(uTiltY)), s = sin(radians(uTiltY));
    pos = vec3(c*pos.x + s*pos.z, pos.y, -s*pos.x + c*pos.z);
  }
  if(uMirror >= 0.5) pos.x = abs(pos.x);
  if(uMirror >= 1.5) pos.y = abs(pos.y);
  if(uFlowDir != 0.0) vm_Move = vec3(-sin(radians(uFlowDir)), cos(radians(uFlowDir)), 0.0);

  vec4 col = vec4(0., 0., 0., 1.);
  for(float i = 0.; i < 4.; i++){
    if(i >= floor(uLayers + 0.5)) break;
    vec3 V = pos / (vm_Shape * vec3(uCellX / 100.0, uCellY / 100.0, uCellZ / 100.0)) / (uSize / 100.0);
    vec3 D = vm_Curve * (uWarp / 100.0) * vm_fbm33(pos / (vm_Smooth * (uNoiseScale / 100.0))) * (vm_Smooth * (uNoiseScale / 100.0));
    if(uWarpTwist != 0.0) D = vm_rot3(radians(uWarpTwist)) * D;
    float d = vm_voronoi(vec4(V + D, time));
    d = min(1.0, vm_LineW / (uThick / 100.0) * pow(max(0.0, d - (vm_LineS + uLineStart / 100.0)), vm_Sat * (uProfile / 100.0)));
    col += vec4(1.0 - d) * (uLineAmount / 100.0) / exp2(i * (uLayerFade / 100.0));
    pos *= 1.5 * (uLayerZoom / 100.0) * vm_rot3(.37 + radians(uLayerTurn));
    if(uLayerShift != 0.0) pos += vec3(0.37, 0.21, 0.13) * (uLayerShift / 100.0);
  }
  if(!vm_dark) col.rgb = vec3(1.0) - col.rgb;
  if(uEdgeColor != vec3(1.0) || uCoreColor != vec3(1.0)){
    float lum = clamp(col.r, 0.0, 1.0);
    col.rgb *= mix(uEdgeColor, uCoreColor, lum);
  }
  if(uInvert >= 50.0) col.rgb = vec3(1.0) - col.rgb;
  if(uGrain != 0.0){
    float gn = fract(sin(dot(fc, vec2(12.9898, 78.233)) + time) * 43758.5453);
    col.rgb += (gn - 0.5) * (uGrain / 100.0) * 0.6;
  }
  if(uVignette != 0.0){
    vec2 vq = (fc - resolution*0.5) / resolution.y;
    col.rgb *= 1.0 - (uVignette / 100.0) * smoothstep(0.2, 0.9, length(vq));
  }
  return col.rgb;
}
