#ifdef GL_ES
precision mediump float;
#endif

uniform sampler2D tex0;
uniform sampler2D tex1;
uniform sampler2D bgExtra;
uniform sampler2D bgPhoto;
uniform vec2 bgPhotoSize;
uniform vec2 bgCamPx;
uniform float bgZoom;
uniform float manualZoomOffset; // 手動ズームオフセット（freeZoomに乗算）
uniform vec2  resolution;
uniform vec2  texSize;
uniform float time;
uniform float bpm;
uniform float beat;
uniform int   bgMode;
uniform int   paletteMode;
uniform int   invertPalette; // INVERT専用フラグ
uniform int   switchPalette; // SWITCH: 2色入れ替え

// glitch関連(重複削除)
uniform int   glitchMode;
uniform float glitchAmt;
uniform float glitchSeed;
uniform float glitchBeat;
uniform int   overlayOn;    // リングの表示制御
uniform int   showVisual;   // キービジュアルの表示制御

uniform vec2  centerN;
uniform float ringDensity;
uniform float lineW;

uniform float arcWidth;
uniform float sweepDir;
uniform float appearRate;
uniform float jitter;

uniform float baseInkGain;
uniform float baseInkGamma;
uniform vec3  baseInkColor;
uniform float inkOpacity;

uniform float colorLineOpacity;

uniform float keyRBMin;
uniform float keyGMax;
uniform float keySoft;

uniform float hueBase;
uniform float hueSpread;

uniform float flashAmt;
uniform float flashPow;
uniform float flashInk;

// ---------------------------------------------------------
// Generic tunable params (JS-side で値を渡す。元は const)
// ---------------------------------------------------------
uniform float uRingZoom;       // was const ZOOM (58.0)
uniform float uRingSat;        // was RING_SAT (1.60)
uniform float uRingBri;        // was RING_BRI (1.12)
uniform float uHoldProb;       // was HOLD_PROB (0.18)
uniform float uFreeHoverGain;  // was FREE_HOVER_GAIN (12.0)
uniform float uFreeDriftGain;  // was FREE_DRIFT_GAIN (0.10)
uniform float uFreeZoomAmp;    // was FREE_ZOOM_AMP (0.50)
uniform float uFreeZoomRate;   // was FREE_ZOOM_RATE (0.10)

varying vec2 vTexCoord;
