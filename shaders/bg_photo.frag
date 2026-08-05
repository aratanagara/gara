// =====================================================
// bgMode=9 : panel collage
// =====================================================
vec3 bg_photo(vec2 fc){
  float z = max(0.001, bgZoom);
  vec2 view = (fc - 0.5 * resolution) / z;
  vec2 p = 0.5 * bgPhotoSize + bgCamPx + view;
  vec2 uv = clamp(p / max(bgPhotoSize, vec2(1.0)), vec2(0.0), vec2(1.0));
  return texture2D(bgPhoto, uv).rgb;
}

