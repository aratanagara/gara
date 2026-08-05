// =====================================================
// bg_paperfractal  (H36)
//   Source : Shadertoy "Paper fractal" https://www.shadertoy.com/view/tslyDX
//            (c) Flopine. 折り紙状の入れ子フラクタル + 発光スフィア。
//   改変: iChannel0 ノイズを手続き化 / 単純なグレースケールに。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
//   ヘルパは pf_ で名前空間化。
// =====================================================

float pf_hash21(vec2 x){ return fract(sin(dot(x, vec2(54.4, 62.1)))*457.5); }

mat2 pf_rot(float a){ return mat2(cos(a), sin(a), -sin(a), cos(a)); }

void pf_mo(inout vec2 p, vec2 d){
  p = abs(p) - d;
  if(p.y > p.x) p = p.yx;
}

float pf_plane(vec3 p, vec3 n){ return dot(p, normalize(n)); }

float pf_cut_ps(vec3 p, float s){
  p *= s;
  pf_mo(p.xy, vec2(1.0));
  pf_mo(p.yz, vec2(0.6));
  pf_mo(p.xz, vec2(0.1));
  return pf_plane(p, vec3(1.0, 1.0, 4.0))/s;
}

float pf_prim1(vec3 p, float s){
  p.xz *= pf_rot(time);
  return pf_cut_ps(p, s);
}

float pf_fractal(vec3 p){
  float size = 1.0;
  float d = pf_prim1(p, size);
  for(int i=1; i<5; i++){
    float ratio = float(i)/5.0;
    p.yz *= pf_rot(time*ratio);
    size -= 0.2;
    d = min(d, pf_prim1(p, size));
  }
  return d;
}

// 手続きノイズ(元はテクスチャ参照)
float pf_noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0 - 2.0*f);
  float a = pf_hash21(i), b = pf_hash21(i+vec2(1,0));
  float c = pf_hash21(i+vec2(0,1)), d = pf_hash21(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}

float pf_g1;
float pf_SDF(vec3 p){
  p.xy *= pf_rot(time*0.25);   // フラクタル全体を回転
  float noise = pf_noise((p.xy*0.1) + time);
  float sphe  = length(p) - (0.8 + noise);
  pf_g1 += 0.1/(0.1 + sphe*sphe);
  return max(-length(p + vec3(0.0, 0.0, 4.5)) + 0.8, min(sphe, pf_fractal(p)));
}

vec3 bg_paperfractal(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec2 uv = (2.0*I - resolution.xy)/resolution.y;

  float dither = pf_hash21(uv);
  pf_g1 = 0.0;

  vec3 ro = vec3(0.001, 0.001, -4.5);
  vec3 rd = normalize(vec3(uv * 2.0, 0.8));   // 全体を小さく(広角化=折りが小さく密に見える)
  vec3 p  = ro;
  vec3 col = vec3(0.22);                  // グレー背景

  float shad = 0.0;
  bool hit = false;
  for(float i=0.0; i<64.0; i++){
    float d = pf_SDF(p);
    if(d < 0.001){ hit = true; shad = i/64.0; break; }
    d *= 0.8 + dither*0.1;
    p += d*rd;
  }

  if(hit){
    // 単純なグレースケール陰影(グレインなし)
    float v = mix(0.10, 0.95, 1.0 - shad);
    col = vec3(v);
    col += pf_g1*vec3(0.05);
  }

  bgAlpha = hit ? 1.0 : 0.0;              // 本体=不透明 / 背景=透明
  return col;
}
