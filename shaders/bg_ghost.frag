// =====================================================
// bg_ghost  (H27)
//   Source : Shadertoy "Blue Red Shiny 2" https://www.shadertoy.com/view/7cjGRR
//            (Shadertoy default license / CC BY-NC-SA 3.0)
//   メタリック改変: クロム/シルバーの筋肉質トンネル(滑らかな筋繊維束の起伏、壁/床境界は
//   smin で連続化) + 流線脊椎 + ティラノ肋骨。発光なし・ほぼ鏡面のクローム反射。
//   繊維は env のスタジオライト帯/ストライプを鏡面に映して浮かせる。カメラは連続ロール。
//   レンダリングは発光蓄積スタイルの連続マーチ(切れない)。色は法線→鏡面環境反射。
//   iTime,iResolution → time,resolution / bgZoom・bgCamPx でズーム/パン。
// =====================================================

#define GC_T (sin(time*.6)*16.+time*1e2)
#define GC_P(z) (vec3(cos((z)*.011)*16.+cos((z) * .012)  *24., \
                   cos((z)*.01)*4., (z)))
#define GC_R(a) mat2(cos(a+vec4(0,33,11,0)))
#define GC_N normalize

float gc_hash(float n){ return fract(sin(n*43.758 + 31.7)*4137.13); }

// 多項式 smin: 二平面の交差(角)を半径 k で丸めて連続化。
float gc_smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0);
  return mix(b, a, h) - k*h*(1.0 - h);
}

// 壁=クロム/シルバーの筋肉質トンネル: 壁/床/天井の角を smin で大きく丸めて連続化し、
// 低～中周波の筋繊維束を形状の起伏として持たせる(法線が滑らか=鏡面でも粉らない)。
float gc_wall(vec3 p){
  vec2 ap = abs(p.xy);
  float base = gc_smin(28.0 - ap.x, 18.0 - ap.y, 9.0);   // 角を半径9で丸める
  float ang = atan(p.y, p.x);
  // 太い筋束(周方向8本、z方向にうねり・強弱)
  float bundle = sin(ang*8.0 + sin(p.z*0.06)*2.0) * (0.6 + 0.4*sin(p.z*0.09 + ang*2.0));
  // 中位の繊維(周方向16本、z方向へ流れる)
  float fiber  = sin(ang*16.0 - p.z*0.04) * 0.5;
  return base - (bundle*1.4 + fiber*0.7);                // 起伏を強めに(繊維を見せる)
}

// 脊椎(スピード感): 流線の背骨 + 前後に尖る紡錘椎骨 + 後方スウェプトの鋭いフィン。
float gc_spine(vec3 p, vec2 ctr, float spacing, float spikeSpacing){
  vec2 rc = p.xy - ctr;
  float rad = length(rc);
  float id = floor(p.z/spacing + 0.5);
  float zc = p.z - id*spacing;
  float h1 = gc_hash(id*1.7);

  float rod = rad - 0.30;

  float zb = zc - 0.18;
  float spind = length(vec2(rad*1.25, zb)) - 0.46;
  spind = max(spind, zb*0.85 - 0.16);

  float sid = floor(p.z/spikeSpacing + 0.5);
  float szc = p.z - sid*spikeSpacing;
  float wYp = max(rc.y, 0.0);
  float wZ = szc + wYp*0.85;
  float spike = abs(wZ) - 0.08;
  spike = max(spike, abs(rc.x) - 0.11);
  spike = max(spike, -rc.y);
  spike = max(spike, rc.y - (2.3 + 0.5*h1));
  spike = max(spike, wZ - 1.4);

  return min(min(rod, spind), spike);
}

// 恐竜/ティラノ型の肋骨: 深い樽型胸郭、後方へ反り先細る。
// 近傍3区画(id-1,id,id+1)を評価して min → floor 境界での切れ目を解消(連続化)。
float gc_ribs(vec3 p, vec2 ctr, float spacing){
  vec2 rc = p.xy - ctr;
  float rad = length(rc);
  float phi = atan(abs(rc.x), rc.y);
  float baseId = floor(p.z/spacing + 0.5);
  float best = 1e9;
  for(float di=-1.0; di<=1.0; di+=1.0){
    float id = baseId + di;
    float zc = p.z - id*spacing;
    float h1 = gc_hash(id*1.7);
    float ringR = (2.8 + h1*0.7) * (1.0 + 0.55*smoothstep(0.4, 2.6, phi));
    float sweep = phi*phi*(0.50 + 0.18*h1);
    float thick = (0.40 + h1*0.10) * (1.0 - 0.72*smoothstep(0.6, 2.9, phi));
    float arch = length(vec2(rad - ringR, zc + sweep)) - thick;
    arch = max(arch, (0.55 - phi) * ringR);
    arch = max(arch, (phi - 3.0) * ringR);
    best = min(best, arch);
  }
  return best;
}

float gc_bones(vec3 p){
  vec2 redCtr  = sin(p.z/12. + vec2(0, 1.3))*12.;
  vec2 blueCtr = sin(p.z/16. + vec2(0, .7))*16.;
  return min(min(gc_spine(p, redCtr,  1.10, 5.0), gc_ribs(p, redCtr,  5.0)),
             min(gc_spine(p, blueCtr, 1.25, 5.5), gc_ribs(p, blueCtr, 5.5)));
}

float gc_map(vec3 p){
  vec3 q = GC_P(p.z);
  p.xy -= q.xy;
  return min(gc_bones(p), gc_wall(p));
}

vec3 gc_nrm(vec3 p){
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.02;
  return GC_N(k.xyy*gc_map(p+k.xyy*h) + k.yyx*gc_map(p+k.yyx*h) +
              k.yxy*gc_map(p+k.yxy*h) + k.xxx*gc_map(p+k.xxx*h));
}

// クロームが映す疑似環境(銀のスタジオ): グラデ + ソフトボックス + 方位ストライプ。
// 鏡面に映り込んで壁の繊維の起伏を浮かせるため、明暗のコントラストを持たせる。
vec3 gc_env(vec3 dir){
  float up = dir.y*0.5 + 0.5;
  vec3 c = mix(vec3(0.03, 0.04, 0.06), vec3(0.95, 0.97, 1.0), smoothstep(0.0, 0.9, up));
  c += vec3(0.9, 0.93, 1.0) * smoothstep(0.6, 0.98, abs(dir.y));     // 上下のソフトボックス
  float az = atan(dir.x, dir.z);
  c += vec3(0.5, 0.55, 0.7) * pow(max(cos(az*3.0), 0.0), 10.0);      // 明るい縦の光帯
  c += vec3(0.35) * pow(max(cos(az*5.0 + 2.0), 0.0), 16.0);          // 細い光帯
  return c;
}

// ほぼ鏡面の環境反射(クローム)。rough を小さく → 鏡。粉抑制に極小サンプルだけ平均。
vec3 gc_roughEnv(vec3 R, float rough){
  vec3 up = abs(R.y) < 0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
  vec3 t = GC_N(cross(up, R));
  vec3 b = cross(R, t);
  vec3 s = vec3(0.0);
  for(float i=0.0; i<6.0; i++){
    float a = i*1.0471976;                            // 60度刻み
    vec2 o = vec2(cos(a), sin(a))*rough;
    s += gc_env(GC_N(R + t*o.x + b*o.y));
  }
  return s/6.0;
}

vec3 bg_ghost(vec2 fc){
  vec2 I = (fc - resolution*0.5) / max(bgZoom, 0.001) + resolution*0.5 + bgCamPx;
  vec3 r = vec3(resolution, 1.0);
  vec2 u = (I - r.xy/2.0)/r.y;
  u.y -= 0.2;

  vec3 ro = GC_P(GC_T),
       Z = GC_N(GC_P(GC_T + 2.) - ro),
       X = GC_N(vec3(Z.z, 0, -Z.x)),
       D = GC_N(vec3(GC_R(time*0.3) * u, 1)            // カメラを連続ロール回転
            * mat3(-X, cross(X, Z), Z));

  // 発光蓄積スタイルの連続マーチ(表面に漸近収束 → 画面が切れない)。
  float d = 0.0, s = 1.0, i = 0.0, acc = 0.0;
  vec3 p = ro;
  for(; i++ < 140.0;){
    p = ro + D*d;
    s = gc_map(p);
    acc += 1.0/max(s, 0.05);
    if(s < 0.003) break;
    d += s*0.5;
    if(d > 320.0) break;
  }

  vec3 n = gc_nrm(p);
  vec3 Rr = reflect(D, n);
  float fres = pow(1.0 - max(dot(n, -D), 0.0), 5.0);

  vec3 col = gc_roughEnv(Rr, 0.02);                  // ほぼ鏡面のクローム/シルバー反射
  col = mix(col, vec3(0.97, 0.98, 1.0), fres*0.5);   // フレネルの白縁
  float dens = tanh(acc * 0.012);                    // 表面にしっかり当たった所ほど明るく
  col *= mix(0.25, 1.0, dens);                       // すり抜け/奥は暗く(自然な減衰)
  col *= exp(-d*0.003);
  return clamp(col, 0.0, 1.0);
}
