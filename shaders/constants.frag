// =====================================================
// constants
// =====================================================
const float PI  = 3.14159265359;
const float TAU = 6.28318530718;

// TIMES は for ループ境界に使われるため const のまま (GLSL ES 1.00 制約)
const int   TIMES = 4;

// 旧 const は uniform 化 (header.frag を参照):
//   ZOOM -> uRingZoom, RING_SAT -> uRingSat, RING_BRI -> uRingBri,
//   HOLD_PROB -> uHoldProb,
//   FREE_HOVER_GAIN -> uFreeHoverGain, FREE_DRIFT_GAIN -> uFreeDriftGain,
//   FREE_ZOOM_AMP   -> uFreeZoomAmp,   FREE_ZOOM_RATE  -> uFreeZoomRate
