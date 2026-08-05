vec3 getBackground(vec2 fc){
  if(bgMode==1) return bg_meguru(fc);
  if(bgMode==2) return bg_7sKSDd(fc);
  if(bgMode==3) return bg_sdjGWR(fc);
  if(bgMode==4) return bg_sinFBM(fc);
  if(bgMode==5) return bg_NdsSzl(fc);
  if(bgMode==6) return bg_newSinFract(fc);
  if(bgMode==7) return bg_cos20(fc);
  if(bgMode==8) return bg_manga(fc);
  if(bgMode==9){
    vec2 uv = fc / resolution;
    float z = max(0.001, bgZoom);

    // camera offset in texture UV space
    vec2 cam = bgCamPx / max(bgPhotoSize, vec2(1.0));

    // base sampling uv
    vec2 suv = (uv - 0.5) / z + 0.5 + cam;

    // keep sampling inside 0..1 (no wrap) so page margins/frames don't disappear in one direction
    // (clamp + half-texel clamp avoids edge interpolation artifacts)
    vec2 texel = 1.0 / max(bgPhotoSize, vec2(1.0));
    suv = clamp(suv, texel * 0.5, vec2(1.0) - texel * 0.5);

    // p5 texture is vertically flipped
    suv.y = 1.0 - suv.y;

    return texture2D(bgPhoto, suv).rgb;
  }
  return bg_vangogh(fc);
}
