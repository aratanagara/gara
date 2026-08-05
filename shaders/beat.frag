// =====================================================
// FREE / BEAT unified beat
// =====================================================
bool isFree(){
  bool f = false;
  if(beat < 0.0) f = true;
  return f;
}

float freeBeat(){
  float bpmScale = bpm / 120.0;
  return time * 6.0 * bpmScale;
}

float getBeat(){
  float bt = beat;
  if(isFree()){
    bt = freeBeat();
  }
  return bt;
}
