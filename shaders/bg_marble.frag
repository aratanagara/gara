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

float vm_voronoi(vec4 u){
  u.w *= 0.1;
  u.w = 1.0 - 2.0 * abs(fract(u.w + 0.5) - 0.5);
  u.w *= 0.99;
  u.w += float(vm_Seed);
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
vec3 vm_fbm33(vec3 p){
  vec3 v = vec3(0.0);
  float a = 0.5;
  mat3 R = vm_rot3(0.37);
  for(int i = 0; i < 6; i++, p *= 2.0, a /= 2.0){
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
  vec3 pos = vm_uv3d(uv);

  vec4 col = vec4(0., 0., 0., 1.);
  for(float i = 0.; i < vm_Layers; i++){
    vec3 V = pos / vm_Shape;
    vec3 D = vm_Curve * vm_fbm33(pos / vm_Smooth) * vm_Smooth;
    float d = vm_voronoi(vec4(V + D, time));
    d = min(1.0, vm_LineW * pow(max(0.0, d - vm_LineS), vm_Sat));
    col += vec4(1.0 - d) / exp2(i);
    pos *= 1.5 * vm_rot3(.37);
  }
  if(!vm_dark) col.rgb = vec3(1.0) - col.rgb;
  return col.rgb;
}
