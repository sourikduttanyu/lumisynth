/**
 * Stateless single-pass GL filters — all share one WebGL2 canvas.
 * Programs compiled lazily and cached per filter name.
 * applyGLFilter(name, cw, ch, [p0,p1,p2,p3], opts)
 *   opts = { inputTex, outputFBO } — orchestrator chain hooks (P2).
 *   See glContext.js header for the orchestrator contract: this function
 *   does NOT upload video or composite — renderFrame owns both.
 */

import { ensureContext, getGL, getVideoTex, getMotionTex } from './glContext.js';

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 vUV;
void main() {
  vUV = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// ---- Fragment shaders ----

const FRAG_ERODE = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
uniform float uOutputMode;
uniform vec3 uInkLow;
uniform vec3 uInkHigh;
out vec4 fragColor;

vec3 applyStructureOutput(float structure, vec3 src, float mode) {
  structure = clamp(structure, 0.0, 1.0);
  if (mode < 0.5) return vec3(structure);
  if (mode < 1.5) return src * structure;
  if (mode < 2.5) {
    float poster = smoothstep(0.42, 0.58, structure);
    return mix(uInkLow, uInkHigh, poster);
  }
  return vec3(1.0 - structure);   // invert: negative of mono (dark traces on light)
}

void main() {
  vec2 uv = vUV;
  vec2 texel = 1.0 / vec2(textureSize(u_video, 0));
  vec3 src = texture(u_video, uv).rgb;
  float val = src.r;
  int radius = int(mix(1.0, 6.0, uParams.y));
  float strength = mix(0.3, 1.0, uParams.z);
  bool dilate = uParams.x > 0.5;
  float morphVal = dilate ? 0.0 : 1.0;
  for (int dy = -6; dy <= 6; dy++) {
    if (abs(dy) > radius) continue;
    for (int dx = -6; dx <= 6; dx++) {
      if (abs(dx) > radius) continue;
      if (dx*dx + dy*dy > radius*radius) continue;
      float sv = texture(u_video, clamp(uv + vec2(float(dx),float(dy)) * texel, 0.0, 1.0)).r;
      if (dilate) morphVal = max(morphVal, sv);
      else        morphVal = min(morphVal, sv);
    }
  }
  float morphed  = mix(val, morphVal, strength);
  float edgeRing = abs(val - morphVal) * 3.0;
  float out_v    = mix(morphed, clamp(edgeRing, 0.0, 1.0), uParams.w);
  fragColor = vec4(applyStructureOutput(out_v, src, uOutputMode), 1.0);
}`;

// FREQMOD — analog FM oscillography. 240 scan rows (fixed — NTSC 240p line
// count), each a continuous waveform trace whose frequency AND amplitude
// follow the video's luminance: dark regions flatline (or gate out entirely
// below Thresh), bright regions surge into fast full-swing oscillation —
// like an oscilloscope reading the image as a signal. Dir rotates the whole
// scan axis 0–180°. Layer with Drag in the FX rack for phosphor smears.
// uParams: x=Dir (scan angle), y=Mod (frequency response), z=Wave, w=Thresh
const FRAG_FREQMOD = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
uniform float uParam4;   // 5th param: line density (rows), 120–300
uniform float uOutputMode;
uniform vec3 uInkLow;
uniform vec3 uInkHigh;
uniform float uTime;
out vec4 fragColor;

vec3 applyStructureOutput(float structure, vec3 src, float mode) {
  structure = clamp(structure, 0.0, 1.0);
  if (mode < 0.5) return vec3(structure);
  if (mode < 1.5) return src * structure;
  if (mode < 2.5) {
    float poster = smoothstep(0.42, 0.58, structure);
    return mix(uInkLow, uInkHigh, poster);
  }
  return vec3(1.0 - structure);   // invert: negative of mono (dark traces on light)
}

void main() {
  vec2 uv = vUV;
  float rows = uParam4;

  // Dir rotates the scan frame: rows + carrier run along the rotated axes.
  float ang = uParams.x * 3.14159265;
  float ca = cos(ang), sa = sin(ang);
  mat2 R  = mat2(ca, -sa,  sa, ca);
  mat2 Ri = mat2(ca,  sa, -sa, ca);
  vec2 ruv = R * (uv - 0.5) + 0.5;

  float rowIdx = floor(ruv.y * rows);
  float rowCenter = (rowIdx + 0.5) / rows;
  vec3 src = texture(u_video, uv).rgb;
  vec2 samplePos = clamp(Ri * (vec2(ruv.x, rowCenter) - 0.5) + 0.5, 0.0, 1.0);
  float L = dot(texture(u_video, samplePos).rgb, vec3(0.299, 0.587, 0.114));

  // Signal gate: below Thresh the trace dies out entirely; a soft knee just
  // above it lets quiet signals fade in as dim flat lines before they swing.
  float gate = smoothstep(uParams.w, uParams.w + 0.18, L);

  // FM: both carrier frequency and swing follow the signal level.
  float freq = mix(30.0, 260.0, uParams.y * L);
  float phase = ruv.x * freq + rowIdx * 2.39996 + uTime * 1.2;
  float wave = sin(phase);

  float dy = (fract(ruv.y * rows) - 0.5) * 2.0;
  float amp = uParams.z * 0.80 * gate * (0.25 + 0.75 * L);
  float d = abs(dy - wave * amp);

  // Pixel-aware minimum trace width: at high row counts a fixed-ratio core
  // would collapse below one pixel and alias into grain, so widen it relative
  // to the actual row height on this canvas.
  float rowHalfPx = float(textureSize(u_video, 0).y) / (rows * 2.0);
  float coreW = max(0.22, 1.25 / max(rowHalfPx, 0.001));
  float core = 1.0 - smoothstep(0.0, coreW, d);
  float skirt = (1.0 - smoothstep(0.0, min(coreW * 3.5, 1.0), d)) * 0.22;
  float structure = (core + skirt) * gate * (0.45 + 0.55 * L);
  fragColor = vec4(applyStructureOutput(structure, src, uOutputMode), 1.0);
}`;

// MOTIONEDGE — STRUCTURE. Spatial edges + temporal motion (current frame vs
// the frame-history ring, ~4 frames back) combined into one structure mask.
// Still scenes show outlines; anything moving lights up hard.
// uParams: x=Edge gain, y=Motion gain, z=Threshold, w=Boost
const FRAG_MOTIONEDGE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform sampler2D u_prev;
uniform vec4 uParams;
uniform float uOutputMode;
uniform vec3 uInkLow;
uniform vec3 uInkHigh;
out vec4 fragColor;

vec3 applyStructureOutput(float structure, vec3 src, float mode) {
  structure = clamp(structure, 0.0, 1.0);
  if (mode < 0.5) return vec3(structure);
  if (mode < 1.5) return src * structure;
  if (mode < 2.5) {
    float poster = smoothstep(0.42, 0.58, structure);
    return mix(uInkLow, uInkHigh, poster);
  }
  return vec3(1.0 - structure);   // invert: negative of mono (dark traces on light)
}

float lumC(vec2 uv) { return dot(texture(u_video, uv).rgb, vec3(0.299, 0.587, 0.114)); }
float lumP(vec2 uv) { return dot(texture(u_prev,  uv).rgb, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec2 uv = vUV;
  vec2 texel = 1.0 / vec2(textureSize(u_video, 0));
  vec3 src = texture(u_video, uv).rgb;

  // spatial edge: central-difference gradient on current luma
  float gx = lumC(uv + vec2(texel.x, 0.0)) - lumC(uv - vec2(texel.x, 0.0));
  float gy = lumC(uv + vec2(0.0, texel.y)) - lumC(uv - vec2(0.0, texel.y));
  float edge = length(vec2(gx, gy)) * mix(0.0, 9.0, uParams.x);

  // temporal motion: |current - ~4 frames ago|, with a small neighborhood
  // max so thin movements read as solid strokes instead of speckle
  float m = abs(lumC(uv) - lumP(uv));
  m = max(m, abs(lumC(uv + vec2(texel.x, 0.0)) - lumP(uv + vec2(texel.x, 0.0))));
  m = max(m, abs(lumC(uv - vec2(0.0, texel.y)) - lumP(uv - vec2(0.0, texel.y))));
  float motion = m * mix(0.0, 11.0, uParams.y);

  float sig = max(edge, motion);
  float structure = smoothstep(uParams.z, uParams.z + 0.22, sig) * mix(0.55, 1.6, uParams.w);
  fragColor = vec4(applyStructureOutput(structure, src, uOutputMode), 1.0);
}`;

// PREDATOR — COLOR UNIQUE (Motion). Motion-as-heat thermal vision: pixels
// that changed since ~4 frames ago glow hot; still regions settle into a
// cold dim body palette. Instantaneous heat (no accumulation — feedback
// trails belong in the FX rack).
// uParams: x=Sense, y=Spread, z=Palette (predator blue → classic thermal), w=Body
const FRAG_PREDATOR = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform sampler2D u_prev;
uniform vec4 uParams;
out vec4 fragColor;

float dHeat(vec2 uv) {
  vec3 c = texture(u_video, uv).rgb;
  vec3 p = texture(u_prev, uv).rgb;
  return dot(abs(c - p), vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 uv = vUV;
  vec2 texel = 1.0 / vec2(textureSize(u_video, 0));
  float r = mix(1.0, 7.0, uParams.y);
  float heat = dHeat(uv);
  heat = max(heat, dHeat(uv + vec2( r,  r) * texel) * 0.85);
  heat = max(heat, dHeat(uv + vec2(-r,  r) * texel) * 0.85);
  heat = max(heat, dHeat(uv + vec2( r, -r) * texel) * 0.85);
  heat = max(heat, dHeat(uv + vec2(-r, -r) * texel) * 0.85);
  heat = clamp(heat * mix(2.0, 16.0, uParams.x), 0.0, 1.0);

  float L = dot(texture(u_video, uv).rgb, vec3(0.299, 0.587, 0.114));
  vec3 bodyA = mix(vec3(0.015, 0.03, 0.10), vec3(0.10, 0.26, 0.46), L);   // predator blue
  vec3 bodyB = mix(vec3(0.07, 0.0, 0.14), vec3(0.46, 0.10, 0.44), L);     // thermal purple
  vec3 body = mix(bodyA, bodyB, uParams.z) * mix(0.25, 1.0, uParams.w);

  vec3 hot0 = mix(vec3(0.95, 0.55, 0.10), vec3(0.90, 0.20, 0.05), uParams.z);
  vec3 hot1 = vec3(1.0, 0.96, 0.78);
  vec3 heatCol = mix(hot0, hot1, smoothstep(0.55, 1.0, heat));
  vec3 col = mix(body, heatCol, smoothstep(0.06, 0.55, heat));
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_OXIDE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
void main() {
  vec2 uv = vUV;
  vec2 res = vec2(textureSize(u_video, 0));
  vec2 texel = 1.0 / res;
  float val = texture(u_video, uv).r;
  float vL = texture(u_video, uv - vec2(texel.x, 0.0)).r;
  float vR = texture(u_video, uv + vec2(texel.x, 0.0)).r;
  float vD = texture(u_video, uv - vec2(0.0, texel.y)).r;
  float vU = texture(u_video, uv + vec2(0.0, texel.y)).r;
  float edgeMag = length(vec2(vR - vL, vU - vD));
  float corr = mix(val, 1.0 - val, uParams.x * 0.7);
  corr = clamp(corr * uParams.x * 2.0, 0.0, 1.0);
  float metal = uParams.y;
  vec3 fresh, patina;
  if (metal < 0.33) {
    fresh  = mix(vec3(0.72,0.45,0.2), vec3(0.85,0.65,0.4), val);
    patina = mix(vec3(0.2,0.45,0.35), vec3(0.35,0.6,0.45), val);
  } else if (metal < 0.66) {
    fresh  = mix(vec3(0.25,0.25,0.27), vec3(0.5,0.5,0.52), val);
    patina = mix(vec3(0.4,0.18,0.05), vec3(0.7,0.35,0.1), val);
  } else {
    fresh  = mix(vec3(0.6,0.6,0.65), vec3(0.9,0.9,0.92), val);
    patina = mix(vec3(0.15,0.12,0.18), vec3(0.35,0.3,0.38), val);
  }
  vec3 col = mix(fresh, patina, corr);
  float rough = hash(floor(uv * res / mix(1.0, 4.0, uParams.z)));
  col *= 1.0 - rough * uParams.z * 0.2;
  float sheen = edgeMag * 4.0 + pow(val, 3.0) * 0.5;
  col += vec3(sheen * uParams.w * 0.5);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_SYNTH = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;

void main() {
  float val = texture(u_video, vUV).r;
  val = pow(val, mix(0.5, 2.0, 1.0 - uParams.w));
  float bands   = mix(3.0, 12.0, uParams.y);
  float bandVal = val;
  if (uParams.y > 0.1) bandVal = floor(val * bands + 0.5) / bands;
  float resonance = 1.0 + sin(val * bands * 3.14159) * uParams.z * 0.4;
  float t = bandVal, w = uParams.x;
  vec3 col;
  if (t < 0.15)       col = mix(vec3(0.05,0.02,0.08), vec3(0.25+w*0.2,0.05,0.05), t/0.15);
  else if (t < 0.3)   col = mix(vec3(0.25+w*0.2,0.05,0.05), vec3(0.6+w*0.2,0.3,0.05), (t-0.15)/0.15);
  else if (t < 0.5)   col = mix(vec3(0.6+w*0.2,0.3,0.05), vec3(0.1,0.5+w*0.2,0.3), (t-0.3)/0.2);
  else if (t < 0.7)   col = mix(vec3(0.1,0.5+w*0.2,0.3), vec3(0.1,0.4,0.7+(1.0-w)*0.2), (t-0.5)/0.2);
  else if (t < 0.85)  col = mix(vec3(0.1,0.4,0.7+(1.0-w)*0.2), vec3(0.6,0.7,0.9), (t-0.7)/0.15);
  else                col = mix(vec3(0.6,0.7,0.9), vec3(1.0,0.98,0.95), (t-0.85)/0.15);
  col *= resonance;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_BIOLUM = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0,2.0/3.0,1.0/3.0,3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
void main() {
  float val = texture(u_video, vUV).r;
  float depthFade = mix(1.0, pow(val, 0.5), uParams.w);
  float glow = pow(val, mix(2.0, 0.5, uParams.x)) * depthFade;
  float pulse = 1.0 + sin(val * mix(1.0, 30.0, uParams.z) * 3.14159) * uParams.z * 0.3;
  glow *= pulse;
  float hue = mix(0.5, mix(0.35, 0.8, uParams.y), 0.5 + val * 0.5);
  float sat = mix(0.6, 1.0, glow);
  vec3 col = hsv2rgb(vec3(hue, sat, glow * uParams.x * 2.0));
  col = max(col, vec3(0.0, 0.005, 0.02));
  col += hsv2rgb(vec3(hue + 0.1, 0.4, glow * 0.2));
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_THERMO = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;

vec3 thermalRamp(float t) {
  if (t < 0.2) return mix(vec3(0,0,0.05), vec3(0,0,0.8), t*5.0);
  if (t < 0.4) return mix(vec3(0,0,0.8), vec3(0,0.7,0.8), (t-0.2)*5.0);
  if (t < 0.6) return mix(vec3(0,0.7,0.8), vec3(0.95,0.85,0), (t-0.4)*5.0);
  if (t < 0.8) return mix(vec3(0.95,0.85,0), vec3(0.9,0.1,0), (t-0.6)*5.0);
  return mix(vec3(0.9,0.1,0), vec3(1,1,0.95), (t-0.8)*5.0);
}
void main() {
  float val = texture(u_video, vUV).r;
  val = (val - 0.5) * (1.0 + uParams.x * 2.0) + 0.5;
  val = clamp(val + uParams.y * 0.3, 0.0, 1.0);
  vec3 col = thermalRamp(val);
  col = max(col, vec3(0, 0, uParams.z * 0.15));
  col = mix(col, vec3(1), smoothstep(0.85, 1.0, val) * uParams.w);
  fragColor = vec4(col, 1.0);
}`;

const FRAG_FALSECOLOR = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;

vec3 thermalP(float t) {
  if (t<0.25) return mix(vec3(0,0,0.1),vec3(0.2,0,0.8),t*4.0);
  if (t<0.5)  return mix(vec3(0.2,0,0.8),vec3(0.9,0.1,0.1),(t-0.25)*4.0);
  if (t<0.75) return mix(vec3(0.9,0.1,0.1),vec3(1,0.8,0),(t-0.5)*4.0);
  return mix(vec3(1,0.8,0),vec3(1,1,0.9),(t-0.75)*4.0);
}
vec3 neonP(float t) {
  if (t<0.25) return mix(vec3(0),vec3(1,0,0.5),t*4.0);
  if (t<0.5)  return mix(vec3(1,0,0.5),vec3(0,1,0.8),(t-0.25)*4.0);
  if (t<0.75) return mix(vec3(0,1,0.8),vec3(0.5,0,1),(t-0.5)*4.0);
  return mix(vec3(0.5,0,1),vec3(1,1,1),(t-0.75)*4.0);
}
vec3 acidP(float t) {
  if (t<0.25) return mix(vec3(0,0.05,0),vec3(0,0.6,0),t*4.0);
  if (t<0.5)  return mix(vec3(0,0.6,0),vec3(0.8,1,0),(t-0.25)*4.0);
  if (t<0.75) return mix(vec3(0.8,1,0),vec3(1,0.4,0.8),(t-0.5)*4.0);
  return mix(vec3(1,0.4,0.8),vec3(1,1,1),(t-0.75)*4.0);
}
vec3 iceP(float t) {
  if (t<0.25) return mix(vec3(0,0,0.1),vec3(0,0.2,0.5),t*4.0);
  if (t<0.5)  return mix(vec3(0,0.2,0.5),vec3(0.3,0.7,0.9),(t-0.25)*4.0);
  if (t<0.75) return mix(vec3(0.3,0.7,0.9),vec3(0.7,0.9,1),(t-0.5)*4.0);
  return mix(vec3(0.7,0.9,1),vec3(1,1,1),(t-0.75)*4.0);
}
void main() {
  float val = clamp(texture(u_video, vUV).r + (uParams.w - 0.5), 0.0, 1.0);
  if (uParams.y > 0.01) {
    float bands = mix(4.0, 20.0, uParams.z);
    val = clamp(floor(val * bands) / (bands - 1.0), 0.0, 1.0);
  }
  float sel = uParams.x;
  vec3 col;
  if (sel<0.25)      col = mix(thermalP(val), neonP(val),    sel*4.0);
  else if (sel<0.5)  col = mix(neonP(val),    acidP(val),    (sel-0.25)*4.0);
  else if (sel<0.75) col = mix(acidP(val),    iceP(val),     (sel-0.5)*4.0);
  else               col = mix(iceP(val),     thermalP(val), (sel-0.75)*4.0);
  fragColor = vec4(col, 1.0);
}`;

// ---- STRUCTURE additions ----

const FRAG_WATERSHED = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
uniform float uOutputMode;
uniform vec3 uInkLow;
uniform vec3 uInkHigh;
out vec4 fragColor;

vec3 applyStructureOutput(float structure, vec3 src, float mode) {
  structure = clamp(structure, 0.0, 1.0);
  if (mode < 0.5) return vec3(structure);
  if (mode < 1.5) return src * structure;
  if (mode < 2.5) {
    float poster = smoothstep(0.42, 0.58, structure);
    return mix(uInkLow, uInkHigh, poster);
  }
  return vec3(1.0 - structure);   // invert: negative of mono (dark traces on light)
}

void main() {
  vec2 uv = vUV;
  vec2 res = vec2(textureSize(u_video, 0));
  vec2 texel = 1.0 / res;
  vec3 src = texture(u_video, uv).rgb;
  float val = src.r;
  float scale = mix(2.0, 12.0, uParams.x);
  vec2 st = texel * scale;
  vec2 pos = uv;
  float minVal = val;
  for (int i = 0; i < 4; i++) {
    float cN = texture(u_video, pos + vec2(0.0, st.y)).r;
    float cS = texture(u_video, pos - vec2(0.0, st.y)).r;
    float cE = texture(u_video, pos + vec2(st.x, 0.0)).r;
    float cW = texture(u_video, pos - vec2(st.x, 0.0)).r;
    float minN = min(min(cN, cS), min(cE, cW));
    if (minN < minVal) {
      if (cN == minN) pos += vec2(0.0, st.y);
      else if (cS == minN) pos -= vec2(0.0, st.y);
      else if (cE == minN) pos += vec2(st.x, 0.0);
      else pos -= vec2(st.x, 0.0);
      minVal = minN;
    }
  }
  float basinVal = texture(u_video, clamp(pos, 0.0, 1.0)).r;
  float boundary = abs(basinVal - texture(u_video, clamp(pos + vec2(st.x, 0.0), 0.0, 1.0)).r);
  boundary += abs(basinVal - texture(u_video, clamp(pos + vec2(0.0, st.y), 0.0, 1.0)).r);
  boundary = clamp(boundary * mix(5.0, 30.0, uParams.y), 0.0, 1.0);
  float interior = mix(val, basinVal, uParams.z);
  interior *= mix(1.0, 0.5 + basinVal * 0.5, uParams.w);
  float result = interior + boundary * 0.6;
  result = clamp(result, 0.0, 1.0);
  fragColor = vec4(applyStructureOutput(result, src, uOutputMode), 1.0);
}`;

const FRAG_PIXELSORT = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
uniform float uOutputMode;
uniform vec3 uInkLow;
uniform vec3 uInkHigh;
out vec4 fragColor;

vec3 applyStructureOutput(float structure, vec3 src, float mode) {
  structure = clamp(structure, 0.0, 1.0);
  if (mode < 0.5) return vec3(structure);
  if (mode < 1.5) return src * structure;
  if (mode < 2.5) {
    float poster = smoothstep(0.42, 0.58, structure);
    return mix(uInkLow, uInkHigh, poster);
  }
  return vec3(1.0 - structure);   // invert: negative of mono (dark traces on light)
}

void main() {
  vec2 uv = vUV;
  vec2 res = vec2(textureSize(u_video, 0));
  vec2 texel = 1.0 / res;
  vec3 src = texture(u_video, uv).rgb;
  float srcVal = src.r;
  float threshold = mix(0.02, 0.8, uParams.x);
  int maxLen = int(uParams.y * 200.0);
  float opacity = uParams.z;
  float angle = uParams.w * 6.2832;
  vec2 streakDir = vec2(sin(angle), cos(angle));
  vec2 lookStep = -streakDir * texel;
  float bestVal = 0.0;
  float bestDist = -1.0;
  for (int i = 1; i <= 200; i++) {
    if (i > maxLen) break;
    vec2 sUV = uv + lookStep * float(i);
    if (sUV.x < 0.0 || sUV.y < 0.0 || sUV.x > 1.0 || sUV.y > 1.0) break;
    float sv = texture(u_video, sUV).r;
    if (sv >= threshold && sv > bestVal) { bestVal = sv; bestDist = float(i); }
  }
  if (bestDist < 0.0) {
    fragColor = vec4(applyStructureOutput(srcVal, src, uOutputMode), 1.0);
    return;
  }
  float fade = clamp(1.0 - (bestDist / float(max(maxLen, 1))), 0.0, 1.0);
  float streakVal = bestVal * fade;
  float out_v = max(srcVal, streakVal * opacity);
  fragColor = vec4(applyStructureOutput(out_v, src, uOutputMode), 1.0);
}`;

const FRAG_MELT = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
uniform float uOutputMode;
uniform vec3 uInkLow;
uniform vec3 uInkHigh;
out vec4 fragColor;

vec3 applyStructureOutput(float structure, vec3 src, float mode) {
  structure = clamp(structure, 0.0, 1.0);
  if (mode < 0.5) return vec3(structure);
  if (mode < 1.5) return src * structure;
  if (mode < 2.5) {
    float poster = smoothstep(0.42, 0.58, structure);
    return mix(uInkLow, uInkHigh, poster);
  }
  return vec3(1.0 - structure);   // invert: negative of mono (dark traces on light)
}

void main() {
  vec2 uv = vUV;
  vec2 texel = 1.0 / vec2(textureSize(u_video, 0));
  vec3 src = texture(u_video, uv).rgb;
  float val = src.r;
  float angle = uParams.w * 3.14159;
  vec2 dripDir = vec2(sin(angle), -cos(angle));
  int maxDrip = int(mix(5.0, 80.0, uParams.y));
  float meltAmt = uParams.x;
  float bestVal = val;
  for (int i = 1; i <= 80; i++) {
    if (i > maxDrip) break;
    vec2 sUV = uv - dripDir * texel * float(i);
    if (sUV.x < 0.0 || sUV.y < 0.0 || sUV.x > 1.0 || sUV.y > 1.0) break;
    float sv = texture(u_video, sUV).r;
    float dripReach = sv * float(maxDrip) * meltAmt;
    if (float(i) < dripReach && sv > bestVal) {
      float fade = 1.0 - (float(i) / dripReach);
      fade = pow(fade, mix(0.3, 2.0, uParams.z));
      float drippedVal = sv * fade;
      if (drippedVal > bestVal) bestVal = drippedVal;
    }
  }
  fragColor = vec4(applyStructureOutput(bestVal, src, uOutputMode), 1.0);
}`;

// ---- COLOR additions ----

const FRAG_DEPTHSTACK = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
vec3 depthColor(float depth, float range) {
  float t = 1.0 - depth;
  vec3 deep=vec3(0.02,0.02,0.12); vec3 violet=vec3(0.25,0.05,0.55);
  vec3 blue=vec3(0.1,0.3,0.95); vec3 cyan=vec3(0.0,0.75,0.9); vec3 wh=vec3(0.8,0.9,1.0);
  vec3 narrow, wide;
  if (t<0.25){narrow=mix(deep,blue*0.6,t*4.0);wide=mix(deep,violet,t*4.0);}
  else if (t<0.5){narrow=mix(blue*0.6,blue,(t-0.25)*4.0);wide=mix(violet,blue,(t-0.25)*4.0);}
  else if (t<0.75){narrow=mix(blue,blue*1.1,(t-0.5)*4.0);wide=mix(blue,cyan,(t-0.5)*4.0);}
  else{narrow=mix(blue*1.1,cyan*0.8,(t-0.75)*4.0);wide=mix(cyan,wh,(t-0.75)*4.0);}
  return mix(narrow, wide, range);
}
void main() {
  vec2 uv = vUV;
  vec2 texel = 1.0 / vec2(textureSize(u_video, 0));
  int numLayers = int(mix(3.0, 8.0, uParams.x));
  float maxOff = uParams.y * 0.02;
  float glowSz = mix(0.005, 0.06, uParams.z);
  float vL=texture(u_video,uv-vec2(texel.x*4.0,0.0)).r;
  float vR=texture(u_video,uv+vec2(texel.x*4.0,0.0)).r;
  float vD=texture(u_video,uv-vec2(0.0,texel.y*4.0)).r;
  float vU=texture(u_video,uv+vec2(0.0,texel.y*4.0)).r;
  vec2 gradDir = normalize(vec2(vR-vL, vU-vD) + 0.0001);
  vec3 res_c = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= numLayers) break;
    float layerD = float(i) / float(numLayers - 1);
    vec2 offset = gradDir * (layerD - 0.5) * 2.0 * maxOff;
    float sVal = texture(u_video, clamp(uv + offset, 0.0, 1.0)).r;
    float bandCenter = 1.0 - layerD;
    float bandW = 1.0 / float(numLayers);
    float inBand = 1.0 - smoothstep(bandW*0.3, bandW*0.3 + glowSz, abs(sVal - bandCenter));
    res_c += depthColor(layerD, uParams.w) * inBand * (0.6 + sVal * 0.8);
  }
  fragColor = vec4(clamp(res_c, 0.0, 1.0), 1.0);
}`;

const FRAG_PRISMATIC = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
vec3 spectralColor(float t) {
  if (t < 0.25)      return mix(vec3(0.5,0.2,0.8), vec3(1.0,0.4,0.7), t*4.0);
  else if (t < 0.5)  return mix(vec3(1.0,0.4,0.7), vec3(1.0,0.85,0.3), (t-0.25)*4.0);
  else if (t < 0.75) return mix(vec3(1.0,0.85,0.3), vec3(1.0,0.6,0.15), (t-0.5)*4.0);
  else               return mix(vec3(1.0,0.6,0.15), vec3(0.9,0.2,0.1), (t-0.75)*4.0);
}
void main() {
  vec2 uv = vUV;
  float val = texture(u_video, uv).r;
  float angle = uParams.w * 6.2832;
  vec2 dispDir = vec2(cos(angle), sin(angle));
  float spread = uParams.x * 0.04;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float t = float(i) / 4.0;
    float offset = (t - 0.5) * 2.0;
    vec2 sUV = clamp(uv + dispDir * offset * spread * val, 0.0, 1.0);
    float sv = texture(u_video, sUV).r;
    vec3 tint = mix(vec3(1.0), spectralColor(t), uParams.y);
    col += sv * tint;
  }
  col /= 3.0;
  float edge = abs(
    texture(u_video, clamp(uv - dispDir * spread * val, 0.0, 1.0)).r -
    texture(u_video, clamp(uv + dispDir * spread * val, 0.0, 1.0)).r
  );
  col += col * edge * uParams.z * 2.0;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_ABYSS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
vec3 cosPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}
void main() {
  vec2 uv = vUV;
  vec2 texel = 1.0 / vec2(textureSize(u_video, 0));
  float val = texture(u_video, uv).r;
  float vL = texture(u_video, uv - vec2(texel.x, 0.0)).r;
  float vR = texture(u_video, uv + vec2(texel.x, 0.0)).r;
  float vD = texture(u_video, uv - vec2(0.0, texel.y)).r;
  float vU = texture(u_video, uv + vec2(0.0, texel.y)).r;
  vec2 grad = vec2(vR - vL, vU - vD);
  float edgeMag = length(grad);
  float gradAngle = atan(vU - vD, vR - vL);
  float depthPull = mix(1.0, 3.5, uParams.x);
  float depth = pow(val, depthPull);
  float stereo = uParams.y * 0.015;
  vec2 totalDisp = vec2(depth * stereo, 0.0) + grad * stereo * 3.0;
  float rDepth = pow(texture(u_video, clamp(uv - totalDisp, 0.0, 1.0)).r, depthPull);
  float gDepth = depth;
  float bDepth = pow(texture(u_video, clamp(uv + totalDisp, 0.0, 1.0)).r, depthPull);
  float hue = uParams.w;
  // Hue sweep: 0=bright electric blue, 0.5=vivid magenta, 1=warm rose
  float rOut = mix(mix(0.01, 0.06, hue), mix(0.90, 1.0, hue), rDepth);
  float gPeak = smoothstep(0.6, 1.0, gDepth);
  float gOut  = mix(0.01, mix(0.50, 0.70, hue), gPeak) + gDepth * mix(0.02, 0.12, hue);
  // Blue: vivid in void when cold (electric blue), fades as hue warms
  float bOut = mix(mix(0.55, 0.06, hue), mix(1.0, 0.72, hue), bDepth);
  bOut += (1.0 - bDepth) * mix(0.12, 0.03, hue);
  vec3 col = vec3(rOut, gOut, bOut);
  // Surface glow: sweeps from electric-blue bloom to violet-magenta to rose
  float glow = pow(depth, 0.7) * uParams.z;
  vec3 glowCol = hue < 0.5
    ? mix(vec3(0.10, 0.18, 0.90), vec3(0.50, 0.10, 0.65), hue * 2.0)
    : mix(vec3(0.50, 0.10, 0.65), vec3(0.72, 0.30, 0.50), (hue - 0.5) * 2.0);
  col += glowCol * glow * 0.4;
  // Chromatic edge glow using cosine palette
  float edgeGlow = smoothstep(0.01, 0.06, edgeMag);
  vec3 edgeCol = cosPalette(gradAngle / 6.2832 + depth * 2.0,
    vec3(0.5,0.3,0.5), vec3(0.5,0.3,0.5), vec3(1.5,1.0,1.5), vec3(0.8,0.33,0.67));
  col += edgeCol * edgeGlow * uParams.y * 0.4;
  // Peak blowout: blue-white at cold, pink-white at warm
  col = mix(col, mix(vec3(0.80, 0.88, 1.0), vec3(1.0, 0.85, 0.95), hue), smoothstep(0.85, 1.0, depth) * 0.5);
  // Void floor: deep electric blue at cold, deep purple at warm
  col = max(col, mix(vec3(0.01, 0.005, 0.065), vec3(0.015, 0.005, 0.035), hue));
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_ACIDWASH = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0,2.0/3.0,1.0/3.0,3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
void main() {
  vec2 uv = vUV;
  float val = texture(u_video, uv).r;
  float warp = uParams.x * 4.0;
  float bands = mix(1.0, 8.0, uParams.y);
  float hueBase = val * bands + uParams.w;
  float hue = fract(hueBase + sin(val * warp * 6.2832) * 0.3);
  float sat = mix(0.4, 1.0, uParams.z) * (0.7 + 0.3 * sin(val * bands * 3.14159));
  float bri = val * 0.5 + 0.5 * sin(val * 3.14159);
  bri = max(bri, val * 0.3);
  vec3 col = hsv2rgb(vec3(hue, sat, bri));
  fragColor = vec4(col, 1.0);
}`;

const FRAG_XRAY = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  vec2 uv = vUV;
  vec2 texel = 1.0 / vec2(textureSize(u_video, 0));
  float val = texture(u_video, uv).r;
  float vL = texture(u_video, uv - vec2(texel.x, 0.0)).r;
  float vR = texture(u_video, uv + vec2(texel.x, 0.0)).r;
  float vD = texture(u_video, uv - vec2(0.0, texel.y)).r;
  float vU = texture(u_video, uv + vec2(0.0, texel.y)).r;
  float edgeMag = length(vec2(vR - vL, vU - vD));
  float edgeBoost = edgeMag * uParams.y * 8.0;
  float xray = mix(1.0 - val, val, uParams.w);
  xray = pow(clamp(xray, 0.0, 1.0), mix(1.5, 0.5, uParams.x));
  xray = clamp(xray + edgeBoost, 0.0, 1.0);
  vec3 col;
  float tint = uParams.z;
  if (tint < 0.5) {
    vec3 grey = vec3(xray);
    vec3 blue = vec3(xray*0.7, xray*0.8, xray*1.1);
    col = mix(grey, blue, tint * 2.0);
  } else {
    vec3 blue = vec3(xray*0.7, xray*0.8, xray*1.1);
    vec3 amber = vec3(xray*1.1, xray*0.95, xray*0.7);
    col = mix(blue, amber, (tint - 0.5) * 2.0);
  }
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_HEATBLEED = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
vec3 thermalRamp(float t) {
  if (t < 0.15) return mix(vec3(0.0,0.0,0.08), vec3(0.0,0.0,0.5), t/0.15);
  if (t < 0.35) return mix(vec3(0.0,0.0,0.5), vec3(0.0,0.5,0.7), (t-0.15)/0.2);
  if (t < 0.55) return mix(vec3(0.0,0.5,0.7), vec3(0.8,0.8,0.0), (t-0.35)/0.2);
  if (t < 0.75) return mix(vec3(0.8,0.8,0.0), vec3(1.0,0.2,0.0), (t-0.55)/0.2);
  return mix(vec3(1.0,0.2,0.0), vec3(1.0,1.0,0.9), (t-0.75)/0.25);
}
void main() {
  vec2 uv = vUV;
  vec2 texel = 1.0 / vec2(textureSize(u_video, 0));
  float val = texture(u_video, uv).r;
  float radius = mix(2.0, 12.0, uParams.y);
  float maxNearby = val;
  float totalNearby = val;
  float count = 1.0;
  float weights[7] = float[7](1.0, 0.9, 0.75, 0.55, 0.35, 0.2, 0.1);
  for (int i = 1; i <= 6; i++) {
    float r = float(i) * radius / 6.0;
    float w = weights[i];
    float sH1 = texture(u_video, clamp(uv + vec2(r*texel.x, 0.0), 0.0, 1.0)).r;
    float sH2 = texture(u_video, clamp(uv - vec2(r*texel.x, 0.0), 0.0, 1.0)).r;
    float sV1 = texture(u_video, clamp(uv + vec2(0.0, r*texel.y), 0.0, 1.0)).r;
    float sV2 = texture(u_video, clamp(uv - vec2(0.0, r*texel.y), 0.0, 1.0)).r;
    maxNearby = max(maxNearby, max(max(sH1,sH2), max(sV1,sV2)));
    totalNearby += (sH1+sH2+sV1+sV2) * w;
    count += 4.0 * w;
  }
  float avgNearby = totalNearby / count;
  float bleedVal = mix(val, mix(avgNearby, maxNearby, 0.5), uParams.x);
  bleedVal = mix(bleedVal * 0.5 + 0.25, bleedVal, uParams.z);
  bleedVal = clamp(bleedVal, 0.0, 1.0);
  vec3 col = thermalRamp(bleedVal);
  float heatExcess = max(0.0, bleedVal - val);
  col += vec3(1.0,0.6,0.2) * heatExcess * uParams.w * 3.0;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_NEBULA = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
void main() {
  vec2 uv = vUV;
  vec2 res = vec2(textureSize(u_video, 0));
  float val = texture(u_video, uv).r;
  float density = pow(val, mix(2.0, 0.5, uParams.z));
  float t = uParams.x;
  vec3 darkGas, midGas, brightGas;
  if (t < 0.33) { darkGas=vec3(0.15,0.02,0.05); midGas=vec3(0.6,0.1,0.2); brightGas=vec3(1.0,0.6,0.7); }
  else if (t < 0.66) { darkGas=vec3(0.02,0.05,0.18); midGas=vec3(0.1,0.2,0.6); brightGas=vec3(0.5,0.7,1.0); }
  else { darkGas=vec3(0.08,0.02,0.12); midGas=vec3(0.1,0.4,0.45); brightGas=vec3(0.7,0.3,0.8); }
  vec3 col;
  if (density < 0.3) col = mix(vec3(0.005,0.005,0.015), darkGas, density/0.3);
  else if (density < 0.6) col = mix(darkGas, midGas, (density-0.3)/0.3);
  else col = mix(midGas, brightGas, (density-0.6)/0.4);
  float grey = dot(col, vec3(0.299,0.587,0.114));
  col = mix(vec3(grey), col, uParams.w);
  if (uParams.y > 0.01) {
    float starHash = hash(floor(uv * res / 2.0));
    float starThresh = mix(0.999, 0.98, uParams.y);
    if (starHash > starThresh && val > 0.7) {
      float starBright = (starHash - starThresh) / (1.0 - starThresh);
      col += vec3(starBright * 2.0);
    }
  }
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_SOLARIZE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
float solarize(float val, float thresh, float cycles) {
  float t = val * cycles;
  float folded = abs(mod(t, 2.0) - 1.0);
  return val > thresh ? folded : val;
}
void main() {
  vec2 uv = vUV;
  vec4 src = texture(u_video, uv);
  float threshold = clamp(uParams.x, 0.0, 1.0);
  float intensity = clamp(uParams.y, 0.0, 1.0);
  float cycles = max(1.0, uParams.z);
  float colorShift = clamp(uParams.w, 0.0, 1.0);
  float rThresh = threshold + colorShift * 0.08;
  float gThresh = threshold;
  float bThresh = threshold - colorShift * 0.08;
  vec3 solar = vec3(
    solarize(src.r, rThresh, cycles),
    solarize(src.g, gThresh, cycles),
    solarize(src.b, bThresh, cycles)
  );
  vec3 result = mix(src.rgb, solar, intensity);
  fragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
}`;

const FRAG_AURORASTORM = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
void main() {
  vec2 uv = vUV;
  vec2 res = vec2(textureSize(u_video, 0));
  vec2 texel = 1.0 / res;
  float val = texture(u_video, uv).r;
  float streakVal = val;
  if (uParams.y > 0.01) {
    float acc = val; float tw = 1.0;
    int streakLen = int(mix(2.0, 20.0, uParams.y));
    for (int i = 1; i <= 20; i++) {
      if (i > streakLen) break;
      float w = 1.0 / float(i + 1);
      acc += texture(u_video, uv + vec2(0.0, texel.y * float(i) * 2.0)).r * w;
      acc += texture(u_video, uv - vec2(0.0, texel.y * float(i) * 2.0)).r * w;
      tw += w * 2.0;
    }
    streakVal = acc / tw;
  }
  float band = streakVal * mix(3.0, 12.0, uParams.x);
  float bandFrac = fract(band);
  vec3 col; float cs = uParams.z;
  vec3 green1=vec3(0.0,0.6,0.2); vec3 green2=vec3(0.2,1.0,0.4);
  vec3 mag1=vec3(0.5,0.0,0.4);   vec3 mag2=vec3(1.0,0.3,0.7);
  vec3 vio1=vec3(0.2,0.0,0.5);   vec3 vio2=vec3(0.5,0.3,1.0);
  if (cs < 0.33) { col = mix(green1,green2,bandFrac)*streakVal; col += vio1*smoothstep(0.7,1.0,streakVal)*0.5; }
  else if (cs < 0.66) { col = mix(mag1,mag2,bandFrac)*streakVal; col += green1*smoothstep(0.5,0.8,streakVal)*0.4; }
  else { float selector=fract(band*0.5); vec3 c1=mix(green1,mag2,selector); vec3 c2=mix(vio2,green2,selector); col=mix(c1,c2,bandFrac)*streakVal; }
  col *= smoothstep(0.02, 0.15, streakVal);
  col = mix(col, vec3(0.8,1.0,0.7), smoothstep(0.85,1.0,streakVal)*0.6);
  if (uParams.w > 0.01 && val < 0.2) {
    vec2 starGrid = floor(uv * res / 2.0);
    float sh = hash(starGrid);
    if (sh > 1.0 - uParams.w * 0.04) {
      float starBright = (sh - (1.0 - uParams.w * 0.04)) * 25.0;
      float starDist = length(fract(uv * res / 2.0) - 0.5);
      if (starDist < 0.25) {
        vec3 starCol = mix(vec3(0.8,0.85,1.0), vec3(1.0,0.9,0.7), hash(starGrid * 3.1));
        col += starCol * starBright * (1.0 - starDist/0.25) * (1.0 - val * 5.0);
      }
    }
  }
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_CYANOTYPE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
void main() {
  vec2 uv = vUV;
  vec2 res = vec2(textureSize(u_video, 0));
  vec2 texel = 1.0 / res;
  float val = texture(u_video, uv).r;
  float c = mix(1.0, 2.5, uParams.y);
  float adj = clamp(0.5 + (val - 0.5) * c, 0.0, 1.0);
  vec3 deepBlue = mix(vec3(0.10,0.20,0.45), vec3(0.02,0.08,0.25), uParams.x);
  vec3 midBlue = vec3(0.45,0.65,0.85);
  vec3 paper = vec3(0.92,0.93,0.88);
  vec3 col;
  if (adj < 0.5) col = mix(deepBlue, midBlue, adj * 2.0);
  else col = mix(midBlue, paper, (adj - 0.5) * 2.0);
  col *= smoothstep(0.0, 0.1, val);
  if (uParams.z > 0.01) {
    float fiber = hash(uv * res * 0.7) * 0.5 + hash(uv * res * 2.1) * 0.3;
    float grainMask = smoothstep(0.4, 0.85, val);
    col -= fiber * uParams.z * 0.15 * grainMask;
  }
  if (uParams.w > 0.01) {
    float l = texture(u_video, uv - vec2(texel.x, 0.0)).r;
    float r = texture(u_video, uv + vec2(texel.x, 0.0)).r;
    float d = texture(u_video, uv - vec2(0.0, texel.y)).r;
    float u2 = texture(u_video, uv + vec2(0.0, texel.y)).r;
    float edge = length(vec2(r - l, u2 - d));
    col -= edge * uParams.w * vec3(0.3,0.2,0.1) * smoothstep(0.05, 0.2, val);
  }
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_INFRARED = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
void main() {
  vec2 uv = vUV;
  vec2 res = vec2(textureSize(u_video, 0));
  float val = texture(u_video, uv).r;
  float c = mix(1.0, 2.2, uParams.z);
  float adj = clamp(0.5 + (val - 0.5) * c, 0.0, 1.0);
  vec3 col;
  if (adj < 0.25) {
    float t = adj / 0.25;
    vec3 shadow = mix(vec3(0.04,0.02,0.18), vec3(0.15,0.05,0.35), t);
    shadow = mix(vec3(0.08,0.08,0.10), shadow, uParams.y);
    col = shadow;
  } else if (adj < 0.55) {
    float t = (adj - 0.25) / 0.30;
    col = mix(vec3(0.15,0.05,0.35), vec3(0.75,0.15,0.30), t);
  } else if (adj < 0.80) {
    float t = (adj - 0.55) / 0.25;
    vec3 irRed = mix(vec3(0.75,0.15,0.30), vec3(0.95,0.50,0.20), t);
    col = mix(mix(vec3(0.75,0.15,0.30), vec3(0.85,0.40,0.25), t), irRed, uParams.x);
  } else {
    float t = (adj - 0.80) / 0.20;
    col = mix(vec3(0.95,0.50,0.20), vec3(0.98,0.88,0.80), t);
  }
  col *= smoothstep(0.0, 0.06, val);
  if (uParams.w > 0.01) {
    float grainMask = smoothstep(0.1, 0.4, val);
    float grain = (hash(uv * res * 1.3) - 0.5) * uParams.w * 0.25 * grainMask;
    col += grain;
  }
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_NEONTUBE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0,2.0/3.0,1.0/3.0,3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
void main() {
  vec2 uv = vUV;
  vec2 texel = 1.0 / vec2(textureSize(u_video, 0));
  float l = texture(u_video, uv - vec2(texel.x, 0.0)).r;
  float r = texture(u_video, uv + vec2(texel.x, 0.0)).r;
  float d = texture(u_video, uv - vec2(0.0, texel.y)).r;
  float u2 = texture(u_video, uv + vec2(0.0, texel.y)).r;
  float edgeCore = length(vec2(r - l, u2 - d));
  float haloR = mix(3.0, 20.0, uParams.z);
  float haloAccum = 0.0; float haloW = 0.0;
  for (int i = 0; i < 8; i++) {
    float angle = float(i) / 8.0 * 6.2832;
    vec2 dir = vec2(cos(angle), sin(angle));
    for (int j = 1; j <= 4; j++) {
      float dist = float(j) * haloR / 4.0;
      float w = 1.0 / (1.0 + dist * 0.1);
      vec2 sp = uv + dir * texel * dist;
      float sl = texture(u_video, sp - vec2(texel.x, 0.0)).r;
      float sr = texture(u_video, sp + vec2(texel.x, 0.0)).r;
      float sd = texture(u_video, sp - vec2(0.0, texel.y)).r;
      float su = texture(u_video, sp + vec2(0.0, texel.y)).r;
      haloAccum += length(vec2(sr - sl, su - sd)) * w;
      haloW += w;
    }
  }
  float edgeHalo = haloAccum / haloW;
  float thresh = uParams.y * 0.15;
  float core = smoothstep(thresh, thresh * 2.5, edgeCore);
  float halo = smoothstep(0.01, 0.15, edgeHalo);
  vec3 tubeColor = hsv2rgb(vec3(uParams.x, 0.9, 1.0));
  vec3 coreCol = mix(tubeColor, vec3(1.0), core * 0.7) * core * mix(0.8, 2.5, uParams.w);
  vec3 haloCol = tubeColor * halo * 0.4;
  vec3 col = haloCol + coreCol;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_SEQUIN = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
uniform float uTime;
out vec4 fragColor;
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec3 hsv2rgb(vec3 c) { vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0); vec3 q = abs(fract(c.xxx + K.xyz) * 6.0 - K.www); return c.z * mix(K.xxx, clamp(q - K.xxx, 0.0, 1.0), c.y); }
vec3 grad3(float x, vec3 a, vec3 b, vec3 c) { return x < 0.5 ? mix(a, b, x * 2.0) : mix(b, c, (x - 0.5) * 2.0); }
void main() {
  float luma = dot(texture(u_video, vUV).rgb, vec3(0.299, 0.587, 0.114));
  float t = uTime;
  float spd = uParams.w;
  float L = clamp((luma - 0.5) * mix(1.0, 3.0, uParams.y) + 0.5, 0.0, 1.0);
  L = mix(L, sqrt(L), 0.12);
  // Three hue-bounded profiles — no green leak ever
  int prof = int(floor(clamp(uParams.x, 0.0, 1.0) * 2.999));
  float hS, hH, sat; vec3 sparkTint;
  if (prof == 0) {        // Cyan: teal → blue-cyan
    hS = 0.58; hH = 0.51; sat = 0.85; sparkTint = hsv2rgb(vec3(0.52, 0.7, 1.0));
  } else if (prof == 1) { // Cyan-Magenta: blue-cyan → violet → magenta
    hS = 0.52; hH = 0.90; sat = 0.90; sparkTint = hsv2rgb(vec3(0.50, 0.85, 1.0));
  } else {                // Ember: deep red → gold
    hS = 0.00; hH = 0.11; sat = 0.85; sparkTint = hsv2rgb(vec3(0.10, 0.60, 1.0));
  }
  // Bounded oscillation: wobble hue band ±0.035, never free-runs the wheel
  float wob = sin(t * mix(0.0, 3.0, spd)) * 0.035;
  hS += wob; hH += wob;
  vec3 col = grad3(L,
    hsv2rgb(vec3(hS, sat, 0.05)),
    hsv2rgb(vec3(mix(hS, hH, 0.5), sat, 0.6)),
    hsv2rgb(vec3(hH, sat * 0.8, 1.0)));
  // Sparkle: hash-keyed twinkle at luma peaks, rate follows speed
  float sp = hash21(floor(gl_FragCoord.xy * 0.6) + floor(t * mix(2.0, 12.0, spd)));
  col = mix(col, sparkTint, step(1.0 - uParams.z * 0.25, sp) * smoothstep(0.25, 0.6, L) * 0.7);
  float g = dot(col, vec3(0.299, 0.587, 0.114));
  fragColor = vec4(clamp(mix(vec3(g), col, 1.2), 0.0, 1.0), 1.0);
}`;

const FRAG_DEEPFIELD = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  vec2 uv = vUV;
  vec2 texel = 1.0 / vec2(textureSize(u_video, 0));
  float val = texture(u_video, uv).r;
  float v = pow(val, mix(1.6, 0.6, uParams.w));
  vec3 voidCol = vec3(0.005,0.008,0.02);
  vec3 dimGalaxy = vec3(0.1,0.07,0.18);
  vec3 midGalaxy = vec3(0.7,0.45,0.25);
  vec3 brightGalaxy = vec3(1.0,0.85,0.6);
  float rs = uParams.y;
  if (rs > 0.01) {
    midGalaxy = mix(midGalaxy, vec3(0.8,0.25,0.1), rs * 0.6);
    brightGalaxy = mix(brightGalaxy, vec3(1.0,0.6,0.35), rs * 0.5);
    dimGalaxy = mix(dimGalaxy, vec3(0.18,0.05,0.05), rs * 0.5);
  }
  vec3 col;
  if (v < 0.1) col = mix(voidCol, dimGalaxy * 0.3, v / 0.1);
  else if (v < 0.4) col = mix(dimGalaxy * 0.3, dimGalaxy, (v-0.1)/0.3);
  else if (v < 0.7) col = mix(dimGalaxy, midGalaxy, (v-0.4)/0.3);
  else if (v < 0.9) col = mix(midGalaxy, brightGalaxy, (v-0.7)/0.2);
  else col = brightGalaxy * (1.0 + (v - 0.9) * 1.5);
  if (uParams.z > 0.01) {
    float halo = 0.0;
    float halMax = mix(2.0, 5.0, uParams.z);
    for (int i = -3; i <= 3; i++) {
      for (int j = -3; j <= 3; j++) {
        if (i == 0 && j == 0) continue;
        float d = length(vec2(i, j));
        if (d > halMax) continue;
        vec2 sp = uv + vec2(i, j) * texel * 1.5;
        float nv = texture(u_video, sp).r;
        if (nv > 0.7) halo += (nv - 0.7) / 0.3 * (1.0 - d / halMax);
      }
    }
    halo /= 24.0;
    col += brightGalaxy * halo * 0.5 * uParams.z;
  }
  float grey = dot(col, vec3(0.299,0.587,0.114));
  col = mix(vec3(grey), col, uParams.x);
  col *= smoothstep(-0.05, 0.1, val);
  fragColor = vec4(clamp(col, 0.0, 2.0), 1.0);
}`;

const FRAG_BLACKBODY = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  float val = texture(u_video, vUV).r;
  float g = mix(0.5, 1.6, uParams.y);
  float v = pow(clamp(val, 0.0, 1.0), g);
  float t = uParams.x;
  vec3 c0 = vec3(0.0);
  vec3 c1 = vec3(0.30, 0.01, 0.0);
  vec3 c2 = mix(vec3(0.88, 0.22, 0.01), vec3(1.0, 0.75, 0.05), t * 0.7);
  vec3 c3 = mix(vec3(1.0, 0.88, 0.10), vec3(1.0, 0.97, 0.86), t);
  vec3 c4 = mix(vec3(1.0, 0.97, 0.90), mix(vec3(0.88, 0.94, 1.0), vec3(0.72, 0.82, 1.0), t), t);
  float p1 = 0.12, p2 = 0.40, p3 = 0.72;
  vec3 col;
  if (v < p1)      col = mix(c0, c1, v / p1);
  else if (v < p2) col = mix(c1, c2, (v - p1) / (p2 - p1));
  else if (v < p3) col = mix(c2, c3, (v - p2) / (p3 - p2));
  else             col = mix(c3, c4, (v - p3) / (1.0 - p3));
  vec3 coronaCol = mix(vec3(0.55, 0.28, 0.02), vec3(0.06, 0.18, 0.60), t);
  col += coronaCol * uParams.z * smoothstep(0.72, 1.0, v) * 0.85;
  col += vec3(0.35, 0.04, 0.0) * uParams.w * smoothstep(0.30, 0.45, v) * (1.0 - smoothstep(0.45, 0.60, v)) * 0.65;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_HUBBLE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  float val = texture(u_video, vUV).r;
  float g = mix(0.5, 1.5, uParams.y);
  float v = pow(clamp(val, 0.0, 1.0), g);
  float pal = uParams.x;
  float sii  = smoothstep(0.0, 0.30, v) * (1.0 - smoothstep(0.35, 0.65, v));
  float ha   = smoothstep(0.12, 0.48, v) * (1.0 - smoothstep(0.60, 0.90, v));
  float oiii = smoothstep(0.32, 0.72, v);
  vec3 sho = vec3(sii * 0.85 + ha * 0.15, ha * 0.78, oiii * 0.92);
  vec3 hoo = vec3(ha * 0.82, oiii * 0.68, oiii * 0.92);
  vec3 col = mix(sho, hoo, pal);
  col *= smoothstep(0.0, 0.07, v) * (1.0 + v * 0.45);
  float grey = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(grey), col, uParams.z);
  col *= smoothstep(0.0, mix(0.04, 0.25, uParams.w), v);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_RISOGRAPH = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
vec3 hsv2rgb(vec3 c) { vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0); vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y); }
void main() {
  vec2 uv = vUV;
  vec2 offset = vec2(0.012, -0.008) * uParams.z;
  float vA = texture(u_video, uv - offset * 0.5).r;
  float vB = texture(u_video, uv + offset * 0.5).r;
  // Ink A covers shadows, ink B covers midtones
  float inkA = 1.0 - vA;
  float inkB = vB * (1.0 - vB) * 4.0;
  // Halftone dot pattern — offset grids for each layer
  float dotSize = 120.0;
  float dotA = 1.0 - length(fract((uv - offset * 0.5) * dotSize) - 0.5) / 0.7;
  float dotB = 1.0 - length(fract((uv + offset * 0.5) * dotSize + 0.5) - 0.5) / 0.7;
  float ht = uParams.w;
  if (ht > 0.01) {
    inkA *= smoothstep(1.0 - inkA * 2.0 - ht, 1.0 - inkA * 2.0 + 0.1, dotA);
    inkB *= smoothstep(1.0 - inkB * 2.0 - ht, 1.0 - inkB * 2.0 + 0.1, dotB);
  }
  // Slightly dusty saturated riso inks on warm cream paper
  vec3 colA = hsv2rgb(vec3(uParams.x, 0.85, 0.75));
  vec3 colB = hsv2rgb(vec3(uParams.y, 0.85, 0.75));
  vec3 paper = vec3(0.95, 0.92, 0.85);
  vec3 col = paper;
  col = mix(col, col * colA, clamp(inkA, 0.0, 1.0));
  col = mix(col, col * colB, clamp(inkB, 0.0, 1.0) * 0.7);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// ABYSSAL OCTOPUS — dreamcore deep-sea creature. Dark regions billow with
// animated purple-black ink; bright regions become coral/rose skin with
// chromatophore shimmer cells flickering like octopus camouflage.
// uParams: x=Ink, y=Shimmer, z=Skin hue (coral→magenta), w=Pulse speed
const FRAG_OCTOPUS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
uniform float uTime;
out vec4 fragColor;
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  vec2 uv = vUV;
  float L = dot(texture(u_video, uv).rgb, vec3(0.299, 0.587, 0.114));
  float t = uTime * mix(0.1, 0.9, uParams.w);
  float n = vnoise(uv * 6.0 + vec2(t * 0.7, -t * 0.4)) * 0.65
          + vnoise(uv * 13.0 - vec2(t * 0.3, t * 0.6)) * 0.35;
  vec3 inkDeep   = vec3(0.03, 0.01, 0.07);
  vec3 inkViolet = vec3(0.24, 0.08, 0.42);
  vec3 ink = mix(inkDeep, inkViolet, n * uParams.x);
  vec3 skinA = mix(vec3(0.95, 0.45, 0.30), vec3(0.85, 0.25, 0.58), uParams.z);
  vec3 skinB = mix(vec3(1.0, 0.80, 0.64), vec3(1.0, 0.64, 0.88), uParams.z);
  vec3 skin = mix(skinA, skinB, smoothstep(0.30, 0.85, L));
  // chromatophore cells: sparse hue-rotated flicker on lit skin
  float cell = hash21(floor(uv * 42.0) + floor(t * 3.0));
  float shim = uParams.y * smoothstep(0.40, 0.80, L) * step(0.72, cell);
  skin = mix(skin, skin.brg, shim * 0.6);
  vec3 col = mix(ink, skin, smoothstep(0.20, 0.45, L));
  float rim = smoothstep(0.20, 0.32, L) * (1.0 - smoothstep(0.32, 0.48, L));
  col += vec3(0.35, 0.15, 0.55) * rim * uParams.x * 0.8;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// HOLOGRAM — sci-fi light projection. Image becomes translucent self-luminous
// cyan (or pink) light with drifting interference bands, electric edge fringe,
// and occasional projector flicker.
// uParams: x=Hue (cyan→pink), y=Bands, z=Flicker, w=Solidity
const FRAG_HOLOGRAM = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
uniform float uTime;
out vec4 fragColor;
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec3 hsv2rgb(vec3 c) { vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0); vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y); }
float lum(vec2 uv) { return dot(texture(u_video, uv).rgb, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 uv = vUV;
  vec2 texel = 1.0 / vec2(textureSize(u_video, 0));
  float L = lum(uv);
  float gx = lum(uv + vec2(texel.x, 0.0)) - lum(uv - vec2(texel.x, 0.0));
  float gy = lum(uv + vec2(0.0, texel.y)) - lum(uv - vec2(0.0, texel.y));
  float edge = clamp(length(vec2(gx, gy)) * 4.0, 0.0, 1.0);
  float hue = mix(0.52, 0.87, uParams.x);
  vec3 col = hsv2rgb(vec3(hue, 0.75, pow(L, 0.85) * 1.15));
  float bands = sin((uv.y + uTime * 0.05) * mix(120.0, 420.0, uParams.y)) * 0.5 + 0.5;
  col *= mix(0.55, 1.0, bands);
  float roll = smoothstep(0.0, 0.25, abs(fract(uv.y - uTime * 0.07) - 0.5)) * 0.35 + 0.65;
  col *= roll;
  col += hsv2rgb(vec3(hue + 0.06, 0.9, 1.0)) * edge * 0.9;
  float fl = 1.0 - uParams.z * 0.5 * step(0.92, hash21(vec2(floor(uTime * 18.0), 3.7)));
  col *= fl;
  col = vec3(0.01, 0.02, 0.04) + col * mix(0.45, 1.0, uParams.w);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// SURVEIL — drone-footage thermal targeting. Hard-quantized false-color bands
// with one luminance zone lit up in a contrasting "detection" color.
// uParams: x=Palette (drone IR → naval sonar), y=Bands, z=Target zone, w=Target hue
const FRAG_SURVEIL = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
vec3 hsv2rgb(vec3 c) { vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0); vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y); }
void main() {
  float L = dot(texture(u_video, vUV).rgb, vec3(0.299, 0.587, 0.114));
  float n = floor(mix(4.0, 16.0, uParams.y));
  float band = clamp(floor(L * n), 0.0, n - 1.0);
  float q = band / (n - 1.0);
  vec3 pA = vec3(q) * vec3(0.82, 1.0, 0.82);
  vec3 pB = q < 0.5
    ? mix(vec3(0.02, 0.05, 0.15), vec3(0.10, 0.70, 0.80), q * 2.0)
    : mix(vec3(0.10, 0.70, 0.80), vec3(0.95, 1.0, 1.0), (q - 0.5) * 2.0);
  vec3 col = mix(pA, pB, uParams.x);
  float zoneBand = clamp(floor(uParams.z * n), 0.0, n - 1.0);
  if (band == zoneBand) col = mix(col, hsv2rgb(vec3(uParams.w, 0.95, 1.0)), 0.85);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// NEWSPRINT — pop-art CMYK-style halftone duotone. Two rotated dot screens
// (shadow ink + midtone ink) over warm paper with registration drift — the
// TV Girl album-cover print technique, punchier than risograph.
// uParams: x=Dot scale, y=Ink A hue, z=Ink B hue, w=Drift
const FRAG_NEWSPRINT = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
vec3 hsv2rgb(vec3 c) { vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0); vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y); }
float dotMask(vec2 uv, float ang, float scale, float v) {
  mat2 r = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec2 p = r * uv * scale;
  float d = length(fract(p) - 0.5);
  float radius = sqrt(clamp(v, 0.0, 1.0)) * 0.68;
  return smoothstep(radius + 0.07, radius - 0.07, d);
}
void main() {
  vec2 uv = vUV;
  float L = dot(texture(u_video, uv).rgb, vec3(0.299, 0.587, 0.114));
  float scale = mix(220.0, 60.0, uParams.x);
  vec2 off = vec2(0.010, -0.006) * uParams.w;
  float aA = dotMask(uv + off * 0.5, 0.262, scale, 1.0 - L);
  float aB = dotMask(uv - off * 0.5, 0.785, scale, L * (1.0 - L) * 3.2);
  vec3 colA = hsv2rgb(vec3(uParams.y, 0.80, 0.85));
  vec3 colB = hsv2rgb(vec3(uParams.z, 0.75, 0.95));
  vec3 col = vec3(0.97, 0.95, 0.90);
  col = mix(col, col * colA, aA);
  col = mix(col, col * colB, aB * 0.8);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// POLAROID 600 — instant-film chemistry. Cyan-green shadows, warm yellowed
// highlights, milky lifted blacks, corner vignette. The shoebox-photo grade.
// uParams: x=Age, y=Chemistry (cool→warm), z=Milk, w=Vignette
const FRAG_POLAROID = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  vec3 c = texture(u_video, vUV).rgb;
  float L = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(0.82, 0.78, 0.70), uParams.z * 0.38 * (1.0 - smoothstep(0.0, 0.5, L)));
  vec3 shadowTint = mix(vec3(0.78, 0.96, 1.0), vec3(0.76, 1.0, 0.86), uParams.y);
  vec3 highTint   = mix(vec3(0.96, 0.98, 1.0), vec3(1.0, 0.95, 0.78), uParams.y);
  c *= mix(vec3(1.0), shadowTint, (1.0 - smoothstep(0.10, 0.60, L)) * uParams.x * 0.7);
  c *= mix(vec3(1.0), highTint, smoothstep(0.50, 0.95, L) * uParams.x * 0.6);
  float g = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(g), uParams.x * 0.30);
  float d = distance(vUV, vec2(0.5));
  c *= 1.0 - uParams.w * smoothstep(0.40, 0.82, d) * 0.7;
  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// BLACKLIGHT — UV poster room. Deep purple-black base; only the brightest
// regions fluoresce in hot neon paint like blacklight-reactive ink at a rave.
// uParams: x=UV depth, y=Fluorescence, z=Paint hue, w=Glow
const FRAG_BLACKLIGHT = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
vec3 hsv2rgb(vec3 c) { vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0); vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y); }
void main() {
  float L = dot(texture(u_video, vUV).rgb, vec3(0.299, 0.587, 0.114));
  float v = pow(clamp(L, 0.0, 1.0), mix(0.9, 2.2, uParams.x));
  vec3 base = mix(vec3(0.012, 0.0, 0.045), vec3(0.16, 0.05, 0.36), v);
  float hue = fract(mix(0.72, 1.33, uParams.z));
  vec3 paint = hsv2rgb(vec3(hue, 0.95, 1.0));
  float fl = smoothstep(mix(0.78, 0.45, uParams.y), 0.95, L);
  vec3 col = base + paint * fl * (1.0 + uParams.w * 1.6);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// DREAM STATIC — shadows dissolve into slowly crawling pastel noise while
// bright content stays solid. A signal coming through from a dream.
// uParams: x=Threshold, y=Grain size, z=Drift speed, w=Pastel
const FRAG_DREAMSTATIC = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
uniform float uTime;
out vec4 fragColor;
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec3 src = texture(u_video, vUV).rgb;
  float L = dot(src, vec3(0.299, 0.587, 0.114));
  float mask = 1.0 - smoothstep(uParams.x - 0.12, uParams.x + 0.12, L);
  float scale = mix(380.0, 60.0, uParams.y);
  vec2 cell = floor(vUV * scale);
  float tt = floor(uTime * mix(2.0, 14.0, uParams.z));
  vec3 noise = vec3(hash21(cell + tt), hash21(cell + tt + 7.3), hash21(cell + tt + 19.7));
  float pick = hash21(cell * 1.7 + tt);
  vec3 baseHue = pick < 0.33 ? vec3(0.95, 0.65, 0.80)
               : pick < 0.66 ? vec3(0.65, 0.70, 0.95)
                             : vec3(0.80, 0.65, 0.95);
  vec3 stat = mix(noise, baseHue * (0.40 + 0.60 * noise.r), uParams.w);
  fragColor = vec4(clamp(mix(src, stat, mask), 0.0, 1.0), 1.0);
}`;

const FRAG_DECAYFLOW = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  vec2 uv = vUV;
  vec2 texel = 1.0 / vec2(textureSize(u_video, 0));
  vec3 src = texture(u_video, uv).rgb;
  float lum = dot(src, vec3(0.299,0.587,0.114));
  float lR = dot(texture(u_video, uv + vec2(texel.x, 0.0)).rgb, vec3(0.299,0.587,0.114));
  float lL = dot(texture(u_video, uv - vec2(texel.x, 0.0)).rgb, vec3(0.299,0.587,0.114));
  float lU = dot(texture(u_video, uv + vec2(0.0, texel.y)).rgb, vec3(0.299,0.587,0.114));
  float lD = dot(texture(u_video, uv - vec2(0.0, texel.y)).rgb, vec3(0.299,0.587,0.114));
  vec2 grad = vec2(lR - lL, lU - lD);
  float gradMag = length(grad);
  vec2 flowDir = vec2(-grad.y, grad.x);
  vec2 advectUV = clamp(uv - flowDir * uParams.x * 0.02, 0.0, 1.0);
  vec3 trail = texture(u_video, advectUV).rgb * uParams.y;
  trail += src * gradMag * uParams.z * 4.0;
  vec3 result_c = mix(trail, src + trail * 0.5, uParams.w);
  fragColor = vec4(clamp(result_c, 0.0, 1.0), 1.0);
}`;

const FRAG_FEEDBACKWARP = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  vec2 uv = vUV;
  vec2 texel = 1.0 / vec2(textureSize(u_video, 0));
  vec3 src = texture(u_video, uv).rgb;
  float fbLum = dot(src, vec3(0.299,0.587,0.114));
  float lR = dot(texture(u_video, uv + vec2(texel.x, 0.0)).rgb, vec3(0.299,0.587,0.114));
  float lL = dot(texture(u_video, uv - vec2(texel.x, 0.0)).rgb, vec3(0.299,0.587,0.114));
  float lU = dot(texture(u_video, uv + vec2(0.0, texel.y)).rgb, vec3(0.299,0.587,0.114));
  float lD = dot(texture(u_video, uv - vec2(0.0, texel.y)).rgb, vec3(0.299,0.587,0.114));
  vec2 grad = vec2(lR - lL, lU - lD);
  float strength = uParams.x * 0.03;
  vec2 fromCenter = uv - 0.5;
  vec2 rotated = vec2(-grad.y, grad.x);
  vec2 radial = normalize(fromCenter + 0.0001) * fbLum;
  float mode = uParams.w;
  vec2 warpDir;
  if (mode < 0.33) warpDir = mix(grad, rotated, mode * 3.0);
  else if (mode < 0.66) warpDir = mix(rotated, radial, (mode - 0.33) * 3.0);
  else warpDir = mix(radial, grad, (mode - 0.66) * 3.0);
  vec2 warpedUV = clamp(uv + warpDir * strength, 0.0, 1.0);
  vec3 warped = texture(u_video, warpedUV).rgb;
  vec3 result_c = warped * uParams.y;
  result_c = mix(result_c, src, uParams.z);
  fragColor = vec4(clamp(result_c, 0.0, 1.0), 1.0);
}`;

const FRAG_BLOOM = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  vec2 uv = vUV;
  vec2 texel = 1.0 / vec2(textureSize(u_video, 0));
  vec3 col = texture(u_video, uv).rgb;
  float threshold = uParams.x;
  float intensity = uParams.y * 2.0;
  float blueShift = uParams.z;
  float radius = mix(2.0, 16.0, uParams.w);
  vec3 bloom = vec3(0.0);
  float tw = 0.0;
  float weights[7] = float[7](1.0, 0.85, 0.65, 0.45, 0.28, 0.15, 0.07);
  for (int i = -6; i <= 6; i++) {
    vec2 sUV = uv + vec2(float(i) * texel.x * radius, 0.0);
    vec3 s = texture(u_video, clamp(sUV, 0.0, 1.0)).rgb;
    float lum = dot(s, vec3(0.299,0.587,0.114));
    float bright = smoothstep(threshold, threshold + 0.15, lum);
    s *= bright;
    float w = weights[abs(i)];
    bloom += s * w; tw += w;
  }
  for (int i = -6; i <= 6; i++) {
    if (i == 0) continue;
    vec2 sUV = uv + vec2(0.0, float(i) * texel.y * radius);
    vec3 s = texture(u_video, clamp(sUV, 0.0, 1.0)).rgb;
    float lum = dot(s, vec3(0.299,0.587,0.114));
    float bright = smoothstep(threshold, threshold + 0.15, lum);
    s *= bright;
    float w = weights[abs(i)];
    bloom += s * w; tw += w;
  }
  bloom /= tw;
  if (blueShift > 0.01) {
    float bloomLum = dot(bloom, vec3(0.299,0.587,0.114));
    vec3 blueNeon = vec3(0.15,0.35,1.0) * bloomLum;
    vec3 cyanNeon = vec3(0.2,0.7,1.0) * bloomLum;
    vec3 tinted = mix(bloom, mix(cyanNeon, blueNeon, 0.5), blueShift);
    bloom = mix(bloom, tinted, blueShift * 0.8);
  }
  vec3 result = col + bloom * intensity;
  result = result - result * bloom * intensity * 0.15;
  fragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
}`;

const FRAG_GODRAYS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
vec3 hsv2rgb(vec3 c) { vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0); vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y); }
const int SAMPLES = 48;
void main() {
  vec2 uv = vUV;
  vec3 src = texture(u_video, uv).rgb;
  vec2 center = vec2(uParams.x, uParams.y);
  float density = mix(0.2, 1.0, uParams.w);
  // Decay and threshold baked: 0.96 falloff, 0.3 luma gate
  vec2 delta = (uv - center) * (density / float(SAMPLES));
  vec2 coord = uv;
  float illum = 1.0;
  vec3 accum = vec3(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    coord -= delta;
    vec3 s = texture(u_video, clamp(coord, 0.0, 1.0)).rgb;
    float l = dot(s, vec3(0.299, 0.587, 0.114));
    s *= smoothstep(0.3, 0.5, l);
    accum += s * illum;
    illum *= 0.96;
  }
  accum /= float(SAMPLES);
  // Warm golden tint baked in
  vec3 rayCol = hsv2rgb(vec3(0.08, 0.4, 1.0));
  accum = mix(accum, accum * rayCol * 1.6, 0.2);
  vec3 outc = src + accum * mix(0.0, 6.0, uParams.z);
  fragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
}`;

const FRAG_CRTROLLING = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
uniform float uTime;
out vec4 fragColor;
void main() {
  vec2 uv = vUV;
  float freq = mix(3.0, 40.0, uParams.x);
  // uTime drives real scrolling; speed=0 freezes it
  float roll = uParams.w * uTime * 2.0;
  vec3 selfColor = texture(u_video, uv).rgb;
  float luma = dot(selfColor, vec3(0.299,0.587,0.114));
  float lumaFactor = mix(1.0, luma, 0.5);
  float phase = uv.y * freq + roll;
  float wave = sin(phase * 6.2832);
  float amp = uParams.y * 0.05 * lumaFactor;
  float disp = wave * amp;
  float chromaAmt = uParams.z * 0.02;
  float rOffset = disp + chromaAmt * wave;
  float gOffset = disp;
  float bOffset = disp - chromaAmt * wave;
  vec3 result;
  result.r = texture(u_video, clamp(vec2(uv.x + rOffset, uv.y), 0.0, 1.0)).r;
  result.g = texture(u_video, clamp(vec2(uv.x + gOffset, uv.y), 0.0, 1.0)).g;
  result.b = texture(u_video, clamp(vec2(uv.x + bOffset, uv.y), 0.0, 1.0)).b;
  fragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
}`;

const FRAG_NOISE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
void main() {
  vec2 uv = vUV;
  vec2 res = vec2(textureSize(u_video, 0));
  vec4 col = texture(u_video, uv);
  float lum = dot(col.rgb, vec3(0.299,0.587,0.114));
  float grainScale = mix(1.0, 8.0, uParams.y);
  vec2 grainCoord = floor(uv * res / grainScale);
  float n = hash(grainCoord + fract(col.rg * 100.0)) * 2.0 - 1.0;
  float bias = max(mix(1.0, 2.5 - lum * 2.0, uParams.z), 0.3);
  float strength = uParams.x * 0.3 * bias;
  vec3 grain;
  if (uParams.w > 0.01) {
    float nr = hash(grainCoord + vec2(1.0, 0.0)) * 2.0 - 1.0;
    float nb = hash(grainCoord + vec2(0.0, 1.0)) * 2.0 - 1.0;
    grain = mix(vec3(n * strength), vec3(nr, n, nb) * strength, uParams.w);
  } else {
    grain = vec3(n * strength);
  }
  fragColor = vec4(clamp(col.rgb + grain, 0.0, 1.0), 1.0);
}`;

const FRAG_SCANLINES = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  vec2 uv = vUV;
  vec2 res = vec2(textureSize(u_video, 0));
  float lineCount = mix(100.0, 800.0, uParams.x);
  float row = floor(uv.y * lineCount);
  float rowFrac = fract(uv.y * lineCount);
  float jit = (hash(row * 7.13) - 0.5) * uParams.z * 0.008;
  vec2 jitUV = vec2(clamp(uv.x + jit, 0.0, 1.0), uv.y);
  float rgbOff = uParams.w * 0.002;
  float r = texture(u_video, vec2(jitUV.x + rgbOff, jitUV.y)).r;
  float g = texture(u_video, jitUV).g;
  float b = texture(u_video, vec2(jitUV.x - rgbOff, jitUV.y)).b;
  vec3 col = vec3(r, g, b);
  float scanline = smoothstep(0.0, 0.4, rowFrac) * smoothstep(1.0, 0.6, rowFrac);
  col *= mix(1.0, scanline, uParams.y) * (1.0 + (hash(row * 3.7) - 0.5) * 0.05);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_DEGRADE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
void main() {
  vec2 uv = vUV;
  vec2 res = vec2(textureSize(u_video, 0));
  float pixSize = mix(1.0, 32.0, uParams.w * uParams.w);
  vec2 pixUV = floor(uv * res / pixSize) * pixSize / res + (pixSize * 0.5) / res;
  vec3 col = texture(u_video, pixUV).rgb;
  if (uParams.z > 0.01) {
    float bleed = uParams.z * 0.005;
    col.r = texture(u_video, pixUV + vec2(bleed, 0.0)).r;
    col.b = texture(u_video, pixUV - vec2(bleed, 0.0)).b;
  }
  float levels = mix(256.0, 4.0, uParams.x);
  if (uParams.y > 0.01) {
    float dither = (hash(pixUV * res) - 0.5) / levels;
    col += vec3(dither * uParams.y);
  }
  col = floor(col * levels + 0.5) / levels;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_CRT = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  vec2 uv = vUV;
  vec2 res = vec2(textureSize(u_video, 0));
  vec2 centered = uv * 2.0 - 1.0;
  float barrel = uParams.z * 0.15;
  float r2 = dot(centered, centered);
  vec2 warped = centered * (1.0 + barrel * r2);
  vec2 warpedUV = warped * 0.5 + 0.5;
  if (warpedUV.x < 0.0 || warpedUV.x > 1.0 || warpedUV.y < 0.0 || warpedUV.y > 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0); return;
  }
  vec3 col = texture(u_video, warpedUV).rgb;
  if (uParams.y > 0.01) {
    vec2 texel = 1.0 / res;
    vec3 bloom = vec3(0.0);
    float bw = uParams.y * 3.0;
    for (int dy = -2; dy <= 2; dy++) {
      for (int dx = -2; dx <= 2; dx++) {
        vec3 s = texture(u_video, warpedUV + vec2(float(dx), float(dy)) * texel * bw).rgb;
        float sl = dot(s, vec3(0.299,0.587,0.114));
        bloom += s * smoothstep(0.5, 1.0, sl);
      }
    }
    bloom /= 25.0;
    col += bloom * uParams.y * 2.0;
  }
  if (uParams.x > 0.01) {
    float px = gl_FragCoord.x;
    int subpx = int(mod(px, 3.0));
    vec3 mask = vec3(0.7);
    if (subpx == 0) mask = vec3(1.0,0.7,0.7);
    else if (subpx == 1) mask = vec3(0.7,1.0,0.7);
    else mask = vec3(0.7,0.7,1.0);
    col *= mix(vec3(1.0), mask, uParams.x);
  }
  if (uParams.w > 0.01) {
    float scanline = sin(warpedUV.y * res.y * 3.14159);
    scanline = scanline * 0.5 + 0.5;
    col *= mix(1.0, scanline, uParams.w * 0.5);
  }
  float vig = 1.0 - r2 * 0.3 * uParams.z;
  col *= vig;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// CHROMA — the ChromaEngine: user-built 4-stop ramp + driver select.
// uParams.x = driver (0 luma / 1 inverted / 2 saturation / 3 edge / 4 radial),
// y = bands (0 = smooth, else 3-16 posterize steps), z = gamma shaping.
// The 4 ramp stops arrive as vec3 uniforms (uStop0..3) via opts.stops — same
// out-of-band mechanism as the ink colors, since they don't fit in uParams.
const FRAG_CHROMA = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
uniform vec3 uStop0;
uniform vec3 uStop1;
uniform vec3 uStop2;
uniform vec3 uStop3;
out vec4 fragColor;
float lumaAt(vec2 uv) { return dot(texture(u_video, uv).rgb, vec3(0.299,0.587,0.114)); }
void main() {
  vec2 uv = vUV;
  vec3 src = texture(u_video, uv).rgb;
  float lum = dot(src, vec3(0.299,0.587,0.114));
  float t;
  float driver = uParams.x;
  if (driver < 0.5) {
    t = lum;
  } else if (driver < 1.5) {
    t = 1.0 - lum;
  } else if (driver < 2.5) {
    float mx = max(src.r, max(src.g, src.b));
    float mn = min(src.r, min(src.g, src.b));
    t = mx > 0.001 ? (mx - mn) / mx : 0.0;
  } else if (driver < 3.5) {
    vec2 texel = 1.0 / vec2(textureSize(u_video, 0));
    float gx = lumaAt(uv + vec2(texel.x, 0.0)) - lumaAt(uv - vec2(texel.x, 0.0));
    float gy = lumaAt(uv + vec2(0.0, texel.y)) - lumaAt(uv - vec2(0.0, texel.y));
    t = clamp(length(vec2(gx, gy)) * 4.0, 0.0, 1.0);
  } else {
    t = clamp(length(uv - 0.5) / 0.7071, 0.0, 1.0);
  }
  // Gamma shaping: 0.5 = linear, low crushes toward stop0, high lifts.
  t = pow(clamp(t, 0.0, 1.0), mix(2.2, 0.45, uParams.z));
  // Optional banding: knob maps to 3-16 discrete steps.
  if (uParams.y > 0.03) {
    float n = mix(3.0, 16.0, uParams.y);
    t = floor(t * n) / max(n - 1.0, 1.0);
    t = clamp(t, 0.0, 1.0);
  }
  // 4-stop piecewise ramp.
  vec3 col;
  float seg = t * 3.0;
  if      (seg < 1.0) col = mix(uStop0, uStop1, seg);
  else if (seg < 2.0) col = mix(uStop1, uStop2, seg - 1.0);
  else                col = mix(uStop2, uStop3, clamp(seg - 2.0, 0.0, 1.0));
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// GRADE — internal post pass for the COLOR stage's always-on Hue/Sat knobs.
// Auto-appended after the selected color (or alone, grading raw video) by
// resolveActivePipeline; never appears in a picker.
// uParams.x = hue rotation (0..1 → 0..360°), y = saturation (0.5 neutral → 0..2×).
const FRAG_GRADE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  vec3 col = texture(u_video, vUV).rgb;
  float angle = uParams.x * 6.2831853;
  // Hue rotation about the luma axis (Rodrigues on the grey diagonal).
  float c = cos(angle), s = sin(angle);
  vec3 k = vec3(0.57735);
  col = col * c + cross(k, col) * s + k * dot(k, col) * (1.0 - c);
  float lum = dot(col, vec3(0.299,0.587,0.114));
  col = mix(vec3(lum), col, clamp(uParams.y * 2.0, 0.0, 2.0));
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAGS = {
  erode:        FRAG_ERODE,
  oxide:        FRAG_OXIDE,
  synth:        FRAG_SYNTH,
  biolum:       FRAG_BIOLUM,
  thermo:       FRAG_THERMO,
  falsecolor:   FRAG_FALSECOLOR,
  // STRUCTURE additions
  watershed:    FRAG_WATERSHED,
  pixelsort:    FRAG_PIXELSORT,
  melt:         FRAG_MELT,
  freqmod:      FRAG_FREQMOD,
  motionedge:   FRAG_MOTIONEDGE,
  predator:     FRAG_PREDATOR,
  // COLOR additions
  depthstack:   FRAG_DEPTHSTACK,
  abyss:        FRAG_ABYSS,
  prismatic:    FRAG_PRISMATIC,
  acidwash:     FRAG_ACIDWASH,
  xray:         FRAG_XRAY,
  heatbleed:    FRAG_HEATBLEED,
  nebula:       FRAG_NEBULA,
  solarize:     FRAG_SOLARIZE,
  aurorastorm:  FRAG_AURORASTORM,
  cyanotype:    FRAG_CYANOTYPE,
  infrared:     FRAG_INFRARED,
  neontube:     FRAG_NEONTUBE,
  sequin:       FRAG_SEQUIN,
  deepfield:    FRAG_DEEPFIELD,
  blackbody:    FRAG_BLACKBODY,
  hubble:       FRAG_HUBBLE,
  risograph:    FRAG_RISOGRAPH,
  octopus:      FRAG_OCTOPUS,
  hologram:     FRAG_HOLOGRAM,
  surveil:      FRAG_SURVEIL,
  newsprint:    FRAG_NEWSPRINT,
  polaroid:     FRAG_POLAROID,
  blacklight:   FRAG_BLACKLIGHT,
  dreamstatic:  FRAG_DREAMSTATIC,
  decayflow:    FRAG_DECAYFLOW,
  feedbackwarp: FRAG_FEEDBACKWARP,
  bloom:        FRAG_BLOOM,
  godrays:      FRAG_GODRAYS,
  crtrolling:   FRAG_CRTROLLING,
  noise:        FRAG_NOISE,
  scanlines:    FRAG_SCANLINES,
  degrade:      FRAG_DEGRADE,
  crt:          FRAG_CRT,
  // Single-COLOR stage additions (v8). Note: the stateless FX RACK effects
  // (bloom, decayflow, feedbackwarp, crt, crtrolling, scanlines, degrade,
  // noise) also live in this registry — runFxEffect dispatches them through
  // applyGLFilter; only feedback effects route to glFx.js.
  chroma:       FRAG_CHROMA,
  grade:        FRAG_GRADE,
};

// ---- WebGL helpers ----

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('[glFilters] shader:', gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}

function createProgram(gl, vSrc, fSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fSrc);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, 'a_pos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error('[glFilters] link:', gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

// ---- Module state ----

// Effect-specific state only — a lazy-compiled program cache per filter name.
// GL context, canvas, video texture, and fullscreen-quad VAO live in
// glContext.js.
const _programs = Object.create(null);

function getProgram(name) {
  if (_programs[name]) return _programs[name];
  const gl = getGL();
  if (!gl) return null;
  const prog = createProgram(gl, VERT, FRAGS[name]);
  if (!prog) return null;
  const entry = {
    prog,
    video:  gl.getUniformLocation(prog, 'u_video'),
    // u_prev: the frame from ~4 captures ago (glContext frame-history ring).
    // Null for shaders that don't declare it — binding is skipped entirely.
    prev:   gl.getUniformLocation(prog, 'u_prev'),
    params: gl.getUniformLocation(prog, 'uParams'),
    // Optional 5th scalar param (uParams holds 4) — null for shaders that
    // don't declare it, so the upload is skipped. freqmod uses it for rows.
    param4: gl.getUniformLocation(prog, 'uParam4'),
    uTime:  gl.getUniformLocation(prog, 'uTime'),
    outputMode: gl.getUniformLocation(prog, 'uOutputMode'),
    inkLow: gl.getUniformLocation(prog, 'uInkLow'),
    inkHigh: gl.getUniformLocation(prog, 'uInkHigh'),
    // ChromaEngine ramp stops (null for every other effect).
    stops: [0, 1, 2, 3].map((i) => gl.getUniformLocation(prog, `uStop${i}`)),
  };
  _programs[name] = entry;
  return entry;
}

/**
 * @param {string}                   name    filter name (erode|oxide|synth|biolum|thermo|falsecolor)
 * @param {CanvasRenderingContext2D}  ctx
 * @param {number}                    cw, ch
 * @param {number[]}                  params  [p0,p1,p2,p3] → uParams.xyzw
 * @param {object}                   [opts]   { inputTex, outputFBO }
 */
export function applyGLFilter(name, cw, ch, params = [0.5, 0.5, 0.5, 0.5], opts = {}) {
  if (!FRAGS[name]) return;
  const S = ensureContext(cw, ch);
  if (!S) return;

  const entry = getProgram(name);
  if (!entry) return;

  const { gl, vao } = S;
  const inTex = opts.inputTex  || getVideoTex();
  const outFB = opts.outputFBO ?? null;

  gl.viewport(0, 0, cw, ch);
  gl.bindVertexArray(vao);
  gl.bindFramebuffer(gl.FRAMEBUFFER, outFB);

  gl.useProgram(entry.prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, inTex);
  gl.uniform1i(entry.video, 0);
  if (entry.prev != null) {
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, getMotionTex() || inTex);
    gl.uniform1i(entry.prev, 2);
    gl.activeTexture(gl.TEXTURE0);
  }
  gl.uniform4f(entry.params, params[0], params[1], params[2], params[3]);
  if (entry.param4 != null && params[4] !== undefined) gl.uniform1f(entry.param4, params[4]);
  if (entry.uTime != null) gl.uniform1f(entry.uTime, performance.now() / 1000);
  if (entry.outputMode) gl.uniform1f(entry.outputMode, opts.outputMode ?? 0);
  if (entry.inkLow && entry.inkHigh) {
    const inkLow = opts.inkLow ?? [0.04, 0.035, 0.03];
    const inkHigh = opts.inkHigh ?? [0.92, 0.88, 0.78];
    gl.uniform3f(entry.inkLow, inkLow[0], inkLow[1], inkLow[2]);
    gl.uniform3f(entry.inkHigh, inkHigh[0], inkHigh[1], inkHigh[2]);
  }
  if (opts.stops) {
    for (let i = 0; i < 4; i++) {
      if (entry.stops[i] && opts.stops[i]) {
        gl.uniform3f(entry.stops[i], opts.stops[i][0], opts.stops[i][1], opts.stops[i][2]);
      }
    }
  }
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
