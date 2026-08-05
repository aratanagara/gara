// =====================================================
// bg_kuko  (H46)
//   Source : Shadertoy "KuKo #279" https://www.shadertoy.com/view/33KcRV
//            二重らせん + 球のヘリックスのレイマーチ(緑〜ティールの照明)。
//   改変: iChannel0 のテクスチャ(トライプラナーのバンプ用)を手続き value noise に置換。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは kk_ で名前空間化。未使用の sdBox/smax/palette/TAU は削除。
// =====================================================

float kk_hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float kk_noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0 - 2.0*f);
  return mix(mix(kk_hash(i+vec2(0,0)), kk_hash(i+vec2(1,0)), u.x),
             mix(kk_hash(i+vec2(0,1)), kk_hash(i+vec2(1,1)), u.x), u.y);
}
// 元 iChannel0 相当の手続きテクスチャ(グレースケール fbm)
vec3 kk_tex2(vec2 uv){
  float n = 0.5*kk_noise(uv*4.0) + 0.3*kk_noise(uv*8.0) + 0.2*kk_noise(uv*16.0);
  return vec3(n);
}
vec3 kk_tex3D(vec3 p, vec3 n){
  n = max(n*n, 0.001);
  n /= (n.x + n.y + n.z);
  return kk_tex2(p.yz)*n.x + kk_tex2(p.zx)*n.y + kk_tex2(p.xy)*n.z;
}

float kk_sdHelix(vec3 p){
  float len = length(p.xy);
  float a = sin(atan(p.y, p.x) - p.z*0.5);
  return length(vec2(len - 2.5, a)) - 0.4;
}

float kk_smin(float d1, float d2, float k){
  k *= 4.0;
  float h = max(k - abs(d1 - d2), 0.0);
  return min(d1, d2) - h*h*0.25/k;
}

float kk_sdSphere(vec3 p, float r){ return length(p) - r; }

float kk_sdHelixOfSpheres(vec3 p){
  p += vec3(-2.5, -2.5, 1.6);
  float len   = length(p.xy);
  float angle = atan(p.y, p.x);
  float n = 3.16;            // spheres per rotation
  float helixRadius = 2.5;
  vec3 spherePos = vec3(
    len - helixRadius,        // radial offset to helix
    0.154,                    // perpendicular to helix path
    fract(n * angle) - 0.5    // periodic spacing along helix
  );
  return kk_sdSphere(spherePos, 0.15);
}

float kk_map(vec3 p){
  vec3 p0 = vec3(mod(p.x, 7.) - 7.*0.5,
                 mod(p.y, 7.) - 7.*0.5,
                 p.z);
  p0.y += sin(p.x*2. + time*2.0) * 0.1;
  p0.z += sin(p.x*2. + time*2.5) * 0.1;
  float d = kk_sdHelix(p0);

  vec3 p1 = p + vec3(1, 1, 0);
  p1 = vec3(mod(p1.x, 7.) - 7.*0.5,
            mod(p1.y, 7.) - 7.*0.5,
            p.z);
  p1.z += sin(p1.y*3. + time*1.5) * 0.1;
  p1.z += sin(p1.x*1. + time*2.5) * 0.2;
  float d1 = kk_sdHelix(p1);

  float d3 = kk_sdHelixOfSpheres(p);
  float d4 = kk_sdHelixOfSpheres(p + vec3(-1.6, -1, 0));

  return kk_smin(d3, kk_smin(d4, kk_smin(d, d1, 0.2), 0.09), 0.09);
}

vec3 kk_calcNorm(vec3 p){
  float e = 0.001;
  return normalize(vec3(
    kk_map(p + vec3(e,0,0)) - kk_map(p - vec3(e,0,0)),
    kk_map(p + vec3(0,e,0)) - kk_map(p - vec3(0,e,0)),
    kk_map(p + vec3(0,0,e)) - kk_map(p - vec3(0,0,e))
  ));
}

float kk_rayMarch(vec3 ro, vec3 rd){
  float dt = 0.0;
  for(int i=0; i<80; i++){
    vec3 p = ro + rd*dt;
    float d = kk_map(p);
    dt += d;
    if(abs(d) < 0.001 || dt > 20.0) break;
  }
  return dt;
}

vec3 bg_kuko(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = (2.0*I - resolution.xy) / resolution.y;
  vec3 col = vec3(0.0);

  vec3 ro = vec3(4.0, 3.0, -time*0.5);
  vec3 rd = normalize(vec3(uv, -1.0));
  float dt = kk_rayMarch(ro, rd);

  if(dt > 0.0){
    vec3 p = ro + rd*dt;
    vec3 norm = kk_calcNorm(p);

    float scale = 2.0;
    float texOffset = 0.01;

    vec3 tex  = kk_tex3D(p*scale, norm);
    vec3 texX = kk_tex3D((p + vec3(texOffset, 0, 0))*scale, norm);
    vec3 texY = kk_tex3D((p + vec3(0, texOffset, 0))*scale, norm);
    vec2 texGrad = vec2(texX.r - tex.r, texY.r - tex.r) / texOffset;

    vec3 bump = normalize(norm + vec3(texGrad*0.3, 0));

    vec3 lightPos = vec3(sin(time)*1.0, 5.0, -time*0.5 + 2.0);
    vec3 L = normalize(lightPos - p);

    float diff = max(dot(bump, L), 0.0);
    float fre  = pow(1.0 - abs(dot(bump, rd)), 3.0);
    vec3  hal  = normalize(L - rd);
    float spec = pow(max(dot(bump, hal), 0.0), 32.0);

    vec3 baseCol = (3. + cos(4. + vec3(0,4,4))) / dt * vec3(0, 0.5, 0.2);

    col  = baseCol * (diff*0.7 + 0.3);          // diffuse + ambient
    col += vec3(0.4, 0.6, 1.0) * spec * 1.5;    // specular
    col += vec3(0.2, 0.4, 0.6) * fre  * 1.4;    // fresnel rim
  }

  col = mix(col, vec3(0), 1.0 - exp(-0.0019 * dt*dt*dt));                 // fog
  col = mix(vec3(0), col, smoothstep(3.9, 0.1, length(uv*vec2(1.4, 1)))); // vignette
  return col;
}
