/**
 * Stateless single-pass GL filters — all share one WebGL2 canvas.
 * Programs compiled lazily and cached per filter name.
 * applyGLFilter(name, cw, ch, [p0,p1,p2,p3], opts)
 *   opts = { inputTex, outputFBO } — orchestrator chain hooks (P2).
 *   See glContext.js header for the orchestrator contract: this function
 *   does NOT upload video or composite — renderFrame owns both.
 */

import { ensureContext, getGL, getVideoTex, getMotionTex } from './glContext.js';
import { ASCII_FRAG } from './ascii.js';

export const VERT = `#version 300 es
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
out vec4 fragColor;

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
  fragColor = vec4(vec3(out_v), 1.0);
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
out vec4 fragColor;

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
  fragColor = vec4(vec3(structure), 1.0);
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
out vec4 fragColor;

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
  fragColor = vec4(vec3(result), 1.0);
}`;

const FRAG_PIXELSORT = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;

void main() {
  vec2 uv = vUV;
  vec2 res = vec2(textureSize(u_video, 0));
  vec2 texel = 1.0 / res;
  vec3 src = texture(u_video, uv).rgb;
  float srcVal = src.r;
  float threshold = mix(0.02, 0.8, uParams.x);
  int maxLen = int(uParams.y * 200.0);   // knob 0..5 → up to 1000px streaks
  float opacity = uParams.z;
  float angle = uParams.w * 6.2832;
  vec2 streakDir = vec2(sin(angle), cos(angle));
  vec2 lookStep = -streakDir * texel;
  float bestVal = 0.0;
  float bestDist = -1.0;
  for (int i = 1; i <= 1000; i++) {
    if (i > maxLen) break;
    vec2 sUV = uv + lookStep * float(i);
    if (sUV.x < 0.0 || sUV.y < 0.0 || sUV.x > 1.0 || sUV.y > 1.0) break;
    float sv = texture(u_video, sUV).r;
    if (sv >= threshold && sv > bestVal) { bestVal = sv; bestDist = float(i); }
  }
  if (bestDist < 0.0) {
    fragColor = vec4(vec3(srcVal), 1.0);
    return;
  }
  float fade = clamp(1.0 - (bestDist / float(max(maxLen, 1))), 0.0, 1.0);
  float streakVal = bestVal * fade;
  float out_v = max(srcVal, streakVal * opacity);
  fragColor = vec4(vec3(out_v), 1.0);
}`;

const FRAG_MELT = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;

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
  fragColor = vec4(vec3(bestVal), 1.0);
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
  if (uParams.w > 0.01) {
    float luma = dot(texture(u_video, uv).rgb, vec3(0.299, 0.587, 0.114));
    vec2 starGrid = floor(uv * res / 4.0);
    float sh = hash(starGrid);
    float thresh = 1.0 - uParams.w * 0.18;
    if (sh > thresh && streakVal < 0.35) {
      float starBright = (sh - thresh) / max(1.0 - thresh, 0.001);
      float starDist = length(fract(uv * res / 4.0) - 0.5);
      if (starDist < 0.35) {
        vec3 starCol = mix(vec3(0.8,0.85,1.0), vec3(1.0,0.9,0.7), hash(starGrid * 3.1));
        float fade = (1.0 - starDist / 0.35) * max(0.0, 1.0 - streakVal * 3.0);
        col += starCol * starBright * fade * 0.9;
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
  vec3 paper = vec3(0.94,0.90,0.79);
  vec3 col;
  if (adj < 0.5) col = mix(deepBlue, midBlue, adj * 2.0);
  else col = mix(midBlue, paper, (adj - 0.5) * 2.0);
  col *= smoothstep(0.0, 0.1, val);
  if (uParams.z > 0.01) {
    float fiber = hash(uv * res * 0.7) * 0.5 + hash(uv * res * 2.1) * 0.3;
    float grainMask = smoothstep(0.4, 0.85, val);
    col -= fiber * uParams.z * 0.18 * grainMask * vec3(0.5, 0.65, 1.0);
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
// (shadow ink + midtone ink) over warm paper. Threshold controls where dots
// appear: low = dots even in lights (heavy coverage), high = dots only in
// deep shadows (sparse, open paper). TV Girl album-cover print technique.
// uParams: x=Dot scale, y=Ink A hue, z=Ink B hue, w=Threshold
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
  // threshold: 0 = heavy (all tones get dots), 1 = sparse (only deep darks)
  float thresh = uParams.w;
  float biasA = clamp((1.0 - L) - thresh * 0.8, 0.0, 1.0);
  float biasB = clamp(L * (1.0 - L) * 3.2 * (1.0 - thresh * 0.7), 0.0, 1.0);
  float aA = dotMask(uv, 0.262, scale, biasA);
  float aB = dotMask(uv, 0.785, scale, biasB);
  vec3 colA = hsv2rgb(vec3(uParams.y, 0.80, 0.85));
  vec3 colB = hsv2rgb(vec3(uParams.z, 0.75, 0.95));
  vec3 col = vec3(0.97, 0.95, 0.90);
  col = mix(col, col * colA, aA);
  col = mix(col, col * colB, aB * 0.8);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// OKBAND — luma-to-OKLCH hue mapper with posterized bands and Bayer dithering.
// Each luma band maps to an equidistant OKLCH hue, auto-generating harmonious
// palettes from the scene. Hue rotates all band colors together (equidistant
// spacing stays intact so the whole harmony cycles). Dither adds Bayer 4×4
// threshold noise to the luma quantization, softening hard band edges.
// uParams: x=Bands (2-8), y=Hue (0-1), z=Chroma (0-1), w=Dither
// uParam4: Rate — auto-cycles hue by one band step per tick; quadratic speed
// so mid-knob (~0.5) lands near 120 BPM. Rate=0 is fully static.
const FRAG_OKBAND = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
uniform float uTime;
uniform float uParam4;
out vec4 fragColor;
vec3 linToSrgb(vec3 c){return pow(max(c,vec3(0.0)),vec3(1.0/2.2));}
vec3 labToLin(vec3 c){
  vec3 m=vec3(dot(vec3(1.0,0.3963377774,0.2158037573),c),dot(vec3(1.0,-0.1055613458,-0.0638541728),c),dot(vec3(1.0,-0.0894841775,-1.2914855480),c));
  m=m*m*m;
  return vec3(dot(vec3(4.0767416621,-3.3077115913,0.2309699292),m),dot(vec3(-1.2684380046,2.6097574011,-0.3413193965),m),dot(vec3(-0.0041960863,-0.7034186147,1.7076147010),m));
}
float bayer4(ivec2 p){
  int x=p.x&3,y=p.y&3,xy=x^y;
  return float((xy&1)*8+(y&1)*4+((xy>>1)&1)*2+((y>>1)&1))/16.0-0.5;
}
void main(){
  vec3 src=texture(u_video,vUV).rgb;
  float luma=dot(src,vec3(0.299,0.587,0.114));
  float n=floor(mix(2.0,8.0,uParams.x)+0.5);
  float dith=bayer4(ivec2(gl_FragCoord.xy))*uParams.w/n;
  float bandF=clamp(floor(clamp(luma+dith,0.0,0.9999)*n),0.0,n-1.0);
  float speed=uParam4*uParam4*1.5;
  float ticks=floor(uTime*speed*n);
  float h=fract(uParams.y+ticks/n+bandF/n)*6.28318530718;
  float L=mix(0.30,0.75,(bandF+0.5)/n);
  float C=uParams.z*0.35;
  fragColor=vec4(linToSrgb(clamp(labToLin(vec3(L,C*cos(h),C*sin(h))),0.0,1.0)),1.0);
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
// Hue rotation uses OKLCH (perceptually uniform): sRGB → OKLab → shift H → sRGB.
// Near-grey pixels (C≈0) are unaffected — grey stays grey. Equal knob steps
// produce equal-looking hue shifts across all colours and saturations.
const FRAG_GRADE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
uniform float uTime;
out vec4 fragColor;
void main() {
  vec3 srgb = texture(u_video, vUV).rgb;

  // sRGB → linear (gamma 2.2 approx)
  vec3 lin = pow(max(srgb, vec3(0.0)), vec3(2.2));

  // linear → OKLab
  vec3 lms = vec3(
    dot(vec3(0.4122214708, 0.5363325363, 0.0514459929), lin),
    dot(vec3(0.2119034982, 0.6806995451, 0.1073969566), lin),
    dot(vec3(0.0883024619, 0.2817188376, 0.6299787005), lin)
  );
  lms = pow(max(lms, vec3(0.0)), vec3(1.0/3.0));
  vec3 lab = vec3(
    dot(vec3( 0.2104542553,  0.7936177850, -0.0040720468), lms),
    dot(vec3( 1.9779984951, -2.4285922050,  0.4505937099), lms),
    dot(vec3( 0.0259040371,  0.7827717662, -0.8086757660), lms)
  );

  // Rotate H in OKLCH; C and L unchanged so greys are unaffected
  // uParams.z = Range (max swing from base hue, 0-1 = 0-360°)
  // uParams.w = Rate  (speed: 0=still, low=sliding, high=jumping; rate²×6 Hz)
  float speed = uParams.w * uParams.w * 6.0;
  float swing = sin(uTime * speed * 6.28318) * uParams.z;
  float chroma = length(lab.yz);
  float h = atan(lab.z, lab.y) + (uParams.x + swing) * 6.28318;
  lab.y = chroma * cos(h);
  lab.z = chroma * sin(h);

  // OKLab → linear → sRGB
  vec3 m = vec3(
    dot(vec3(1.0,  0.3963377774,  0.2158037573), lab),
    dot(vec3(1.0, -0.1055613458, -0.0638541728), lab),
    dot(vec3(1.0, -0.0894841775, -1.2914855480), lab)
  );
  m = m * m * m;
  lin = vec3(
    dot(vec3( 4.0767416621, -3.3077115913,  0.2309699292), m),
    dot(vec3(-1.2684380046,  2.6097574011, -0.3413193965), m),
    dot(vec3(-0.0041960863, -0.7034186147,  1.7076147010), m)
  );
  vec3 col = pow(max(lin, vec3(0.0)), vec3(1.0/2.2));

  // Saturation: luma-weighted blend in sRGB (0.5 = neutral, same as before)
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, clamp(uParams.y * 2.0, 0.0, 2.0));

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// SKETCH — hand-drawn pen/pencil crosshatch. Per pixel, marches several rays
// at fixed angles and lays hatch strokes along the luminance gradient, so the
// image is "drawn" with directional shading that thickens in the shadows.
// Colored crosshatch is carried in col2; col.x is the stroke darkness. Ported
// from flockaroo's "Notebook Drawings" (CC BY-NC-SA). The iChannel1 blue-noise
// texture is replaced by procedural hash noise (paper grain + halftone break),
// and iChannel0 maps to u_video. Heavy: ~hundreds of taps/pixel by design.
// uParams: x=Ink (line boldness), y=Color (pencil↔colored), z=Stroke (length), w=Wobble
const FRAG_SKETCH = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
uniform float uTime;
out vec4 fragColor;

#define AngleNum 3
#define SampNum 16
#define PI2 6.28318530717959

vec2 R;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
// procedural stand-in for flockaroo's blue-noise iChannel1
vec4 getRand(vec2 pos) {
  return vec4(hash21(pos), hash21(pos + 11.7), hash21(pos + 23.3), hash21(pos + 47.1));
}
vec4 getCol(vec2 pos) {
  vec2 uv = pos / R;
  vec4 c1 = texture(u_video, uv);
  vec4 e = smoothstep(vec4(-0.05), vec4(0.0), vec4(uv, vec2(1.0) - uv));
  c1 = mix(vec4(1.0, 1.0, 1.0, 0.0), c1, e.x * e.y * e.z * e.w);
  float d = clamp(dot(c1.xyz, vec3(-0.5, 1.0, -0.5)), 0.0, 1.0);
  vec4 c2 = vec4(0.7);
  return min(mix(c1, c2, 1.8 * d), 0.7);
}
vec4 getColHT(vec2 pos) {
  return smoothstep(0.95, 1.05, getCol(pos) * 0.8 + 0.2 + getRand(pos * 0.7));
}
float getVal(vec2 pos) {
  return dot(getCol(pos).xyz, vec3(0.333));
}
vec2 getGrad(vec2 pos, float eps) {
  vec2 d = vec2(eps, 0.0);
  return vec2(
    getVal(pos + d.xy) - getVal(pos - d.xy),
    getVal(pos + d.yx) - getVal(pos - d.yx)
  ) / eps / 2.0;
}

void main() {
  R = vec2(textureSize(u_video, 0));
  float ink    = uParams.x;
  float colorA = uParams.y;
  float scS    = R.y / 400.0 * mix(0.5, 2.0, uParams.z);
  float wobble = uParams.w;

  vec2 fragCoord = vUV * R;
  vec2 pos = fragCoord + wobble * 4.0 * sin(uTime * vec2(1.0, 1.7)) * (R.y / 400.0);
  vec3 col = vec3(0.0), col2 = vec3(0.0);
  float sum = 0.0;
  for (int i = 0; i < AngleNum; i++) {
    float ang = PI2 / float(AngleNum) * (float(i) + 0.8);
    vec2 v = vec2(cos(ang), sin(ang));
    for (int j = 0; j < SampNum; j++) {
      vec2 dpos  = v.yx * vec2(1.0, -1.0) * float(j) * scS;
      vec2 dpos2 = v.xy * float(j * j) / float(SampNum) * 0.5 * scS;
      for (float s = -1.0; s <= 1.0; s += 2.0) {
        vec2 pos2 = pos + s * dpos + dpos2;
        vec2 pos3 = pos + (s * dpos + dpos2).yx * vec2(1.0, -1.0) * 2.0;
        vec2 g = getGrad(pos2, 0.4);
        float fact  = dot(g, v) - 0.5 * abs(dot(g, v.yx * vec2(1.0, -1.0)));
        float fact2 = dot(normalize(g + vec2(0.0001)), v.yx * vec2(1.0, -1.0));
        fact = clamp(fact, 0.0, 0.05);
        fact2 = abs(fact2);
        fact *= 1.0 - float(j) / float(SampNum);
        col += fact;
        col2 += fact2 * getColHT(pos3).xyz;
        sum += fact2;
      }
    }
  }
  col /= float(SampNum * AngleNum) * 0.75 / sqrt(R.y);
  col2 /= max(sum, 1e-3);
  col.x *= (0.6 + 0.8 * getRand(pos * 0.7).x);
  col.x = clamp(1.0 - col.x, 0.0, 1.0);
  col.x = pow(col.x, mix(1.5, 4.0, ink));               // Ink: higher = darker, bolder strokes
  col2 = mix(vec3(dot(col2, vec3(0.333))), col2, colorA); // Color: pencil↔colored

  vec2 sg = sin(pos.xy * 0.1 / sqrt(R.y / 400.0));
  vec3 karo = vec3(1.0) - 0.5 * vec3(0.25, 0.1, 0.1) * dot(exp(-sg * sg * 80.0), vec2(1.0));
  float r = length(pos - R * 0.5) / R.x;
  float vign = 1.0 - r * r * r;
  fragColor = vec4(clamp(col.x * col2 * karo * vign, 0.0, 1.0), 1.0);
}`;

// DOG — STRUCTURE. Difference of Gaussians edge detection: two Gaussian-
// weighted averages at different sigma values are subtracted to isolate
// edges and contours. Classic anime line-art / pencil-sketch abstraction.
// uParams: x=radius(1–6px), y=thresh(0–0.12), z=sharpness(4–20), w=kRatio(1.2–3.0)
const FRAG_DOG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec2 px = 1.0 / vec2(textureSize(u_video, 0));
  float r = mix(1.0, 6.0, uParams.x);
  float k = mix(1.2, 3.0, uParams.w);

  // Both kernels share the same 5×5 sample grid at radius r.
  // Weights differ: small σ=1, large σ=k — their difference is the edge band.
  float small = 0.0, big = 0.0, wS = 0.0, wB = 0.0;
  for (int dx = -2; dx <= 2; dx++) {
    for (int dy = -2; dy <= 2; dy++) {
      float d2 = float(dx * dx + dy * dy);
      float ws = exp(-d2 * 0.5);
      float wb = exp(-d2 / (2.0 * k * k));
      float l  = luma(texture(u_video, vUV + vec2(float(dx), float(dy)) * px * r).rgb);
      small += l * ws; wS += ws;
      big   += l * wb; wB += wb;
    }
  }
  small /= wS; big /= wB;

  float dog    = small - big;
  float thresh = uParams.y * 0.12;
  float sharp  = mix(4.0, 20.0, uParams.z);
  float edge   = smoothstep(thresh, thresh + 1.0 / sharp, dog);

  fragColor = vec4(vec3(edge), 1.0);
}`;

// DITHER — STRUCTURE. Bayer 4×4 ordered dithering: quantizes luma to N
// gray levels using a classic halftone matrix. Ink / invert output modes
// give crisp 1-bit print and retro-game aesthetics.
// uParams: x=scale(1–8px cell), y=levels(2–8), z=contrast(gamma), w=bias
const FRAG_DITHER = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;

float bayerThreshold(ivec2 coord) {
  int[16] bm = int[16](0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5);
  ivec2 c = coord % 4;
  return float(bm[c.y * 4 + c.x]) / 16.0;
}

void main() {
  ivec2 coord = ivec2(vUV * vec2(textureSize(u_video, 0)));
  vec3  src   = texture(u_video, vUV).rgb;
  float l     = dot(src, vec3(0.299, 0.587, 0.114));

  // Bias + gamma
  l = clamp(l + (uParams.w - 0.5) * 0.4, 0.0, 1.0);
  l = pow(l, mix(0.35, 2.5, uParams.z));

  // Multi-level Bayer dither
  int   scale   = max(1, int(uParams.x * 7.0 + 1.0));
  float thresh  = bayerThreshold(coord / scale);
  float levels  = floor(mix(2.0, 8.0, uParams.y));
  float qLuma   = floor(l * levels) / (levels - 1.0);
  float frac    = l * levels - floor(l * levels);
  float structure = clamp(qLuma + (frac > thresh ? 1.0 / (levels - 1.0) : 0.0), 0.0, 1.0);

  fragColor = vec4(vec3(structure), 1.0);
}`;

// MODDIFF — Modulated Diffuse. Sine-wave dithering where pixel luminance
// phase-shifts the threshold: bright areas shift the sine further →
// more crossings per unit distance → denser lines; dark areas → sparse.
// Axis=0 = horizontal lines (Y modulation, Marathon/Bungie look);
// Axis=1 = vertical lines (X modulation). uParam4 (Drift) slowly scrolls
// the line pattern via uTime so still content can animate.
// Source mode: dithering as contrast bands on the source video (not a hard mask).
// uParams: x=freq(2–50 cycles), y=mod(phase depth 0–8), z=black(luma crush), w=axis(0=Y/1=X)
// uParam4: drift speed (0=static)
const FRAG_MODDIFF = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
uniform float uParam4;
uniform float uTime;
out vec4 fragColor;

void main() {
  const float TAU = 6.28318530718;

  vec4  col  = texture(u_video, vUV);
  float luma = dot(col.rgb, vec3(0.299, 0.587, 0.114));

  float freq  = mix(2.0,  50.0, uParams.x);
  float mod   = mix(0.0,   8.0, uParams.y);
  float bl    = uParams.z;
  bool  axisX = uParams.w > 0.5;

  luma = max(0.0, (luma - bl) / max(0.001, 1.0 - bl));

  float axCoord = axisX ? vUV.x : vUV.y;

  // Drift ties scroll speed to freq so visual pace stays consistent across densities
  float phase  = axCoord * freq * TAU + luma * mod * TAU + uTime * uParam4 * freq * 2.0;
  float thresh = 0.5 + 0.45 * sin(phase);

  float structure = luma > thresh ? 1.0 : 0.0;

  fragColor = vec4(vec3(structure), 1.0);
}`;

// ---- AcerolaFX-inspired FX RACK (stateless) ----

// VIGNETTE — radial darkening from center outward.
// uParams: x=size(bright-zone radius), y=soft(falloff width), z=strength, w=shape(0=round/1=rect)
const FRAG_VIGNETTE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  vec3 col = texture(u_video, vUV).rgb;
  vec2 d = vUV - 0.5;
  float rRound = length(d);
  float rRect  = max(abs(d.x), abs(d.y));
  float r = mix(rRound, rRect, uParams.w);
  float inner = 0.1 + uParams.x * 0.6;
  float outer = inner + mix(0.04, 0.6, uParams.y);
  float vign  = smoothstep(outer, inner, r);
  col *= 1.0 - uParams.z * (1.0 - vign);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// TONEMAP — HDR tonemapping (Reinhard/ACES/Hable) with pre-exposure and contrast.
// uParams: x=exposure(EV ±2 mapped 0–1), y=operator(0=Reinhard/0.5=ACES/1=Hable), z=contrast, w=desat
const FRAG_TONEMAP = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
vec3 reinhard(vec3 c) { return c / (c + 1.0); }
vec3 aces(vec3 c) {
  return clamp((c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14), 0.0, 1.0);
}
vec3 hable(vec3 c) {
  float A=0.15,B=0.50,Cv=0.10,D=0.20,Ev=0.02,F=0.30;
  return ((c*(A*c+Cv*B)+D*Ev)/(c*(A*c+B)+D*F)) - Ev/F;
}
void main() {
  vec3 col = texture(u_video, vUV).rgb;
  col *= pow(2.0, (uParams.x - 0.5) * 4.0);
  float op = uParams.y * 2.0;
  float t1 = clamp(op, 0.0, 1.0);
  float t2 = clamp(op - 1.0, 0.0, 1.0);
  vec3 wh = max(hable(vec3(11.2)), vec3(0.001));
  vec3 tm = mix(mix(reinhard(col), aces(col), t1), hable(col) / wh, t2);
  float cont = mix(0.4, 2.5, uParams.z);
  tm = pow(max(tm, 0.0), vec3(1.0 / cont));
  float luma = dot(tm, vec3(0.299, 0.587, 0.114));
  tm = mix(tm, vec3(luma), uParams.w * smoothstep(0.5, 1.0, luma));
  fragColor = vec4(clamp(tm, 0.0, 1.0), 1.0);
}`;

// CHROMAB — Chromatic aberration: R/B (and optionally G) channels split outward.
// uParams: x=amount, y=radial(0=uniform/1=corner-amp), z=angle(drift dir 0–1), w=spread(0=R/B/1=R/G/B)
const FRAG_CHROMAB = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  vec2 d = vUV - 0.5;
  float dist = length(d);
  vec2 dir = (dist > 0.001) ? d / dist : vec2(1.0, 0.0);
  float amt = uParams.x * 0.04;
  float radAmp = mix(1.0, dist * 2.5, uParams.y);
  float ang = uParams.z * 6.2832;
  vec2 drift = vec2(cos(ang), sin(ang)) * 0.4;
  float step = amt * radAmp;
  vec2 rUV = clamp(vUV + (dir + drift) * step, 0.0, 1.0);
  vec2 bUV = clamp(vUV - (dir + drift) * step, 0.0, 1.0);
  float gAng = ang + 2.0944;
  vec2 gDrift = vec2(cos(gAng), sin(gAng)) * 0.4;
  vec2 gUV = clamp(vUV + gDrift * step * uParams.w, 0.0, 1.0);
  float r = texture(u_video, rUV).r;
  float g = texture(u_video, gUV).g;
  float b = texture(u_video, bUV).b;
  fragColor = vec4(r, g, b, 1.0);
}`;

// SHARPEN — Unsharp mask: detail = center minus blurred neighbors, added back.
// uParams: x=strength, y=radius(kernel scale), z=clamp(anti-halo), w=luma(0=all/1=luma-only)
const FRAG_SHARPEN = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_video, 0));
  float r = mix(0.5, 3.0, uParams.y);
  vec3 center = texture(u_video, vUV).rgb;
  vec3 blur = vec3(0.0);
  float wSum = 0.0;
  for (int dx = -2; dx <= 2; dx++) {
    for (int dy = -2; dy <= 2; dy++) {
      float d2 = float(dx*dx + dy*dy);
      float w = exp(-d2 / (2.0 * r * r));
      blur += texture(u_video, vUV + vec2(float(dx), float(dy)) * px).rgb * w;
      wSum += w;
    }
  }
  blur /= wSum;
  vec3 detail = center - blur;
  float maxD = mix(0.5, 0.05, uParams.z);
  detail = clamp(detail, -maxD, maxD);
  vec3 sharp = center + uParams.x * 2.5 * detail;
  float L0 = dot(center, vec3(0.299, 0.587, 0.114));
  float L1 = dot(sharp,  vec3(0.299, 0.587, 0.114));
  vec3 chromaDir = (L0 > 0.001) ? center / L0 : vec3(1.0);
  vec3 lumaOnly  = chromaDir * clamp(L1, 0.0, 2.0);
  sharp = mix(sharp, lumaOnly, uParams.w);
  fragColor = vec4(clamp(sharp, 0.0, 1.0), 1.0);
}`;

// EDGEDET_STRUCT — Sobel edge detection for the blob STRUCTURE pipeline.
// Same Sobel kernel as FRAG_EDGEDET but outputs through applyStructureOutput
// so mono/source/ink/invert modes all work. hue/blend params are ignored;
// thresh (uParams.x) and glow/hardness (uParams.y) remain relevant.
export const FRAG_EDGEDET_STRUCT = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_video, 0));
  float tl = luma(texture(u_video, vUV + vec2(-px.x,  px.y)).rgb);
  float tc = luma(texture(u_video, vUV + vec2(  0.0,  px.y)).rgb);
  float tr = luma(texture(u_video, vUV + vec2( px.x,  px.y)).rgb);
  float ml = luma(texture(u_video, vUV + vec2(-px.x,  0.0)).rgb);
  float mr = luma(texture(u_video, vUV + vec2( px.x,  0.0)).rgb);
  float bl = luma(texture(u_video, vUV + vec2(-px.x, -px.y)).rgb);
  float bc = luma(texture(u_video, vUV + vec2(  0.0, -px.y)).rgb);
  float br = luma(texture(u_video, vUV + vec2( px.x, -px.y)).rgb);
  float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
  float gy =  tl + 2.0*tc + tr - bl - 2.0*bc - br;
  float mag = length(vec2(gx, gy));
  float hard = mix(8.0, 40.0, uParams.y);
  float edge = smoothstep(uParams.x * 0.5, uParams.x * 0.5 + 1.0 / hard, mag);
  fragColor = vec4(vec3(edge), 1.0);
}`;

// EDGEDET — Sobel edge detection overlaid as colored glow on the source.
// uParams: x=thresh, y=glow(1=hard/0=soft), z=hue(edge color 0–1), w=blend(0=over-src/1=edges-on-black)
const FRAG_EDGEDET = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 hue2rgb(float h) {
  h = fract(h);
  float r = clamp(abs(h * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  float g = clamp(2.0 - abs(h * 6.0 - 2.0), 0.0, 1.0);
  float b = clamp(2.0 - abs(h * 6.0 - 4.0), 0.0, 1.0);
  return vec3(r, g, b);
}
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_video, 0));
  float tl = luma(texture(u_video, vUV + vec2(-px.x,  px.y)).rgb);
  float tc = luma(texture(u_video, vUV + vec2(  0.0,  px.y)).rgb);
  float tr = luma(texture(u_video, vUV + vec2( px.x,  px.y)).rgb);
  float ml = luma(texture(u_video, vUV + vec2(-px.x,  0.0)).rgb);
  float mr = luma(texture(u_video, vUV + vec2( px.x,  0.0)).rgb);
  float bl = luma(texture(u_video, vUV + vec2(-px.x, -px.y)).rgb);
  float bc = luma(texture(u_video, vUV + vec2(  0.0, -px.y)).rgb);
  float br = luma(texture(u_video, vUV + vec2( px.x, -px.y)).rgb);
  float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
  float gy =  tl + 2.0*tc + tr - bl - 2.0*bc - br;
  float mag = length(vec2(gx, gy));
  float hard = mix(8.0, 40.0, uParams.y);
  float edge = smoothstep(uParams.x * 0.5, uParams.x * 0.5 + 1.0 / hard, mag);
  vec3 edgeCol = hue2rgb(uParams.z) * edge;
  vec3 src = texture(u_video, vUV).rgb;
  vec3 onSrc   = src * (1.0 - edge * 0.6) + edgeCol;
  vec3 onBlack = edgeCol;
  fragColor = vec4(clamp(mix(onSrc, onBlack, uParams.w), 0.0, 1.0), 1.0);
}`;

// BOKEH — 12-sample ring blur weighted by brightness for bokeh highlights.
// uParams: x=radius(0–12px), y=bright(highlight boost), z=blades(0=circle/1=hex), w=chroma(fringe)
const FRAG_BOKEH = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
const float PI = 3.14159265;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_video, 0));
  float radius = uParams.x * 12.0;
  vec3 acc = vec3(0.0);
  float wSum = 0.0;
  for (int i = 0; i < 12; i++) {
    float ang = float(i) * 2.0 * PI / 12.0;
    float hexAng = floor(ang / (PI / 3.0) + 0.5) * (PI / 3.0);
    ang = mix(ang, hexAng, uParams.z);
    vec2 off = vec2(cos(ang), sin(ang)) * radius * px;
    vec3 s = texture(u_video, clamp(vUV + off, 0.0, 1.0)).rgb;
    float L = dot(s, vec3(0.299, 0.587, 0.114));
    float w = 1.0 + L * uParams.y * 5.0;
    acc += s * w;
    wSum += w;
  }
  vec3 center = texture(u_video, vUV).rgb;
  float cL = dot(center, vec3(0.299, 0.587, 0.114));
  acc += center * (1.0 + cL * uParams.y * 5.0);
  wSum += 1.0 + cL * uParams.y * 5.0;
  acc /= wSum;
  vec2 rDir = (length(vUV - 0.5) > 0.001) ? normalize(vUV - 0.5) : vec2(1.0, 0.0);
  float cf = uParams.w * radius * 0.4;
  float rF = texture(u_video, clamp(vUV + rDir * cf * px, 0.0, 1.0)).r;
  float bF = texture(u_video, clamp(vUV - rDir * cf * px * 0.5, 0.0, 1.0)).b;
  acc = mix(acc, vec3(rF, acc.g, bF), uParams.w * 0.6);
  fragColor = vec4(clamp(acc, 0.0, 1.0), 1.0);
}`;

// FILMGRAIN — Animated Gaussian film grain: shadow-biased, spatially clumped, with halation.
// uParams: x=amount, y=size(clump 1–4px), z=shadow(bias), w=halation
const FRAG_FILMGRAIN = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
uniform float uTime;
out vec4 fragColor;
float hash21a(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash21b(vec2 p) { return fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453); }
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_video, 0));
  vec3 col = texture(u_video, vUV).rgb;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float scale = mix(1.0, 4.0, uParams.y);
  float frame = floor(uTime * 24.0);
  vec2 cellUV = floor(vUV / (px * scale)) * (px * scale);
  float g1 = hash21a(cellUV + vec2(frame * 0.1, 0.0));
  float g2 = hash21b(cellUV + vec2(0.0, frame * 0.07 + 0.5));
  float grain = sqrt(-2.0 * log(max(g1, 0.001))) * cos(6.2832 * g2) * 0.25;
  float shadowBias = mix(1.0, max(0.0, 1.2 - lum * 1.5), uParams.z);
  col += vec3(grain * uParams.x * shadowBias);
  if (uParams.w > 0.01) {
    float halo = smoothstep(0.65, 1.0, lum);
    col = mix(col, col * (1.0 + uParams.w * 0.5), halo);
  }
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// IGN — Interleaved Gradient Noise (Jorge Jimenez). Temporally animated with
// golden-ratio offset for blue-noise temporal distribution. Posterize mode
// uses IGN as the ordered dither matrix to break banding with minimal clumping.
// uParams: x=amount, y=scale(1–8px blocks), z=posterize(0–1), w=chromatic(0–1)
const FRAG_IGN = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
uniform float uTime;
out vec4 fragColor;
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
void main() {
  vec3  col    = texture(u_video, vUV).rgb;
  float amount = uParams.x;
  float scale  = max(1.0, round(mix(1.0, 8.0, uParams.y)));
  float post   = uParams.z;
  float chroma = uParams.w;
  vec2  res    = vec2(textureSize(u_video, 0));
  vec2  px     = floor(vUV * res / scale);
  // Golden-ratio temporal offset — each frame shifts by phi, giving good
  // temporal distribution without repeating for hundreds of seconds.
  float t = fract(uTime * 1.61803398875);
  float n0 = fract(ign(px)                    + t);
  float n1 = fract(ign(px + vec2(31.0, 17.0)) + t);
  float n2 = fract(ign(px + vec2(67.0, 53.0)) + t);
  if (post > 0.01) {
    // IGN ordered dithering: add noise before quantisation — unbiased, minimal clumping
    float levels = max(2.0, round(mix(16.0, 2.0, post)));
    vec3  d      = mix(vec3(n0), vec3(n0, n1, n2), chroma) * amount;
    col = floor(col * levels + d) / levels;
  } else {
    // Plain grain overlay — noise centered at 0
    vec3 grain = mix(vec3(n0 - 0.5), vec3(n0, n1, n2) - 0.5, chroma);
    col += grain * (amount * 0.25);
  }
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// ---- AcerolaFX-inspired COLOR effects (MAP and UNIQUE) ----

// PALSWAP — OKLCH Palette Swap: maps scene luma to a hue gradient in perceptual color space.
// uParams: x=hue(0–1=0–360°), y=chroma(0–0.36), z=spread(luma→hue rotation), w=lift(dark floor)
const FRAG_PALSWAP = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
vec3 oklab_to_linear(float L, float a, float b) {
  float l = L + 0.3963377774*a + 0.2158037573*b;
  float m = L - 0.1055613458*a - 0.0638541728*b;
  float s = L - 0.0894841775*a - 1.2914855480*b;
  l=l*l*l; m=m*m*m; s=s*s*s;
  return vec3(
     4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
    -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
    -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
  );
}
vec3 linear_to_srgb(vec3 c) {
  c = max(c, 0.0);
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), c));
}
void main() {
  vec3 src = texture(u_video, vUV).rgb;
  float luma = dot(src, vec3(0.299, 0.587, 0.114));
  luma = mix(uParams.w * 0.15, 1.0, luma);
  float L = luma * 0.82 + 0.08;
  float C = uParams.y * 0.36;
  float H = (uParams.x + luma * uParams.z * 2.0) * 6.2832;
  vec3 lin = oklab_to_linear(L, C * cos(H), C * sin(H));
  fragColor = vec4(clamp(linear_to_srgb(lin), 0.0, 1.0), 1.0);
}`;

// CSADJUST — OKLCH Color Space Adjust: direct L/C/H/warmth knobs in perceptual space.
// uParams: x=lightness(0.5=neutral), y=chroma(0.33=neutral), z=hue(0–1=0–360°), w=warmth(0.5=neutral)
const FRAG_CSADJUST = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
vec3 srgb_to_linear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 linear_to_srgb(vec3 c) {
  c = max(c, 0.0);
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), c));
}
vec3 linear_to_oklab(vec3 c) {
  float l = pow(max(0.4122214708*c.r + 0.5363325363*c.g + 0.0514459929*c.b, 0.0), 1.0/3.0);
  float m = pow(max(0.2119034982*c.r + 0.6806995451*c.g + 0.1073969566*c.b, 0.0), 1.0/3.0);
  float s = pow(max(0.0883024619*c.r + 0.2817188376*c.g + 0.6299787005*c.b, 0.0), 1.0/3.0);
  return vec3(
    0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
    1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
    0.0259040371*l + 0.7827717662*m - 0.8086757660*s
  );
}
vec3 oklab_to_linear(vec3 lab) {
  float l = lab.x + 0.3963377774*lab.y + 0.2158037573*lab.z;
  float m = lab.x - 0.1055613458*lab.y - 0.0638541728*lab.z;
  float s = lab.x - 0.0894841775*lab.y - 1.2914855480*lab.z;
  l=l*l*l; m=m*m*m; s=s*s*s;
  return vec3(
     4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
    -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
    -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
  );
}
void main() {
  vec3 lab = linear_to_oklab(srgb_to_linear(texture(u_video, vUV).rgb));
  float L = clamp(lab.x + (uParams.x - 0.5) * 0.6, 0.0, 1.0);
  float C = length(lab.yz) * mix(0.0, 3.0, uParams.y);
  float H = atan(lab.z, lab.y) + uParams.z * 6.2832 + (uParams.w - 0.5) * 0.8;
  fragColor = vec4(clamp(linear_to_srgb(oklab_to_linear(vec3(L, C*cos(H), C*sin(H)))), 0.0, 1.0), 1.0);
}`;

// HALFTONE — CMYK 4-angle dot screens simulating offset-print reproduction.
// uParams: x=scale(dot size), y=ink(hardness), z=angle(screen variation), w=blend(cmyk/src)
const FRAG_HALFTONE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
float dot_screen(vec2 uv, float value, float angle, float freq) {
  float s = sin(angle), c = cos(angle);
  vec2 rot = vec2(c*uv.x - s*uv.y, s*uv.x + c*uv.y) * freq;
  float r = length(fract(rot) - 0.5);
  float dotR = sqrt(clamp(value, 0.0, 1.0)) * 0.7;
  float hard = mix(0.08, 0.01, uParams.y);
  return smoothstep(dotR - hard, dotR + hard, r);
}
void main() {
  vec3 src = texture(u_video, vUV).rgb;
  float freq = mix(60.0, 10.0, uParams.x);
  float ang  = uParams.z * 1.5708;
  float Kv = 1.0 - max(max(src.r, src.g), src.b);
  float dK = max(1.0 - Kv, 0.001);
  float Cv = (1.0 - src.r - Kv) / dK;
  float Mv = (1.0 - src.g - Kv) / dK;
  float Yv = (1.0 - src.b - Kv) / dK;
  float cDot = dot_screen(vUV, Cv, 1.0472 + ang, freq);
  float mDot = dot_screen(vUV, Mv, 2.2166 + ang, freq);
  float yDot = dot_screen(vUV, Yv, 0.0    + ang, freq);
  float kDot = dot_screen(vUV, Kv, 0.7854 + ang, freq);
  vec3 cmyk = vec3(
    cDot * (1.0 - kDot),
    mDot * (1.0 - kDot),
    yDot * (1.0 - kDot)
  );
  fragColor = vec4(clamp(mix(cmyk, src, uParams.w), 0.0, 1.0), 1.0);
}`;

// KUWAHARA — Painterly filter: pick lowest-variance quadrant mean via soft weighting.
// uParams: x=radius(1–5px step), y=sharpness(quadrant hardness), z=saturation, w=blend(0=paint/1=src)
const FRAG_KUWAHARA = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_video, 0));
  float stepScale = 1.0 + uParams.x * 4.0;
  vec3 m0=vec3(0.0), m1=vec3(0.0), m2=vec3(0.0), m3=vec3(0.0);
  float s0=0.0, s1=0.0, s2=0.0, s3=0.0;
  float n0=0.0, n1=0.0, n2=0.0, n3=0.0;
  for (int dx = -3; dx <= 3; dx++) {
    for (int dy = -3; dy <= 3; dy++) {
      vec2 off = vec2(float(dx), float(dy)) * px * stepScale / 3.0;
      vec3 cv = texture(u_video, clamp(vUV + off, 0.0, 1.0)).rgb;
      float L = dot(cv, vec3(0.299, 0.587, 0.114));
      if (dx <= 0 && dy <= 0) { m0 += cv; s0 += L*L; n0 += 1.0; }
      if (dx >= 0 && dy <= 0) { m1 += cv; s1 += L*L; n1 += 1.0; }
      if (dx <= 0 && dy >= 0) { m2 += cv; s2 += L*L; n2 += 1.0; }
      if (dx >= 0 && dy >= 0) { m3 += cv; s3 += L*L; n3 += 1.0; }
    }
  }
  m0/=n0; m1/=n1; m2/=n2; m3/=n3;
  vec3 lv = vec3(0.299, 0.587, 0.114);
  float v0 = s0/n0 - dot(m0,lv)*dot(m0,lv);
  float v1 = s1/n1 - dot(m1,lv)*dot(m1,lv);
  float v2 = s2/n2 - dot(m2,lv)*dot(m2,lv);
  float v3 = s3/n3 - dot(m3,lv)*dot(m3,lv);
  float sharp = exp(mix(0.0, 7.0, uParams.y));
  float w0=exp(-v0*sharp), w1=exp(-v1*sharp), w2=exp(-v2*sharp), w3=exp(-v3*sharp);
  float wt = w0+w1+w2+w3;
  vec3 result = (m0*w0 + m1*w1 + m2*w2 + m3*w3) / wt;
  float lum = dot(result, lv);
  result = mix(vec3(lum), result, 1.0 + uParams.z * 0.8);
  vec3 src = texture(u_video, vUV).rgb;
  fragColor = vec4(clamp(mix(result, src, uParams.w), 0.0, 1.0), 1.0);
}`;

// OKDRIFT — Seed-based OKLCH palette with harmony modes.
// Palette is fully deterministic from the seed (hue offset) + relationship type.
// Rate controls auto-randomize speed on the JS side — shader is stateless.
// L grades dark→bright across stops so even Mono mode has visible contrast.
// uParams: x=light(midpoint shift), y=chroma, z=hue_seed(0-1), w=unused
// uParam4: N*10+relType  (N=4-10, relType=0-5)
const FRAG_OKDRIFT = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
uniform float uParam4;
out vec4 fragColor;
vec3 oklab_to_linear(float L, float a, float b) {
  float l = L + 0.3963377774*a + 0.2158037573*b;
  float m = L - 0.1055613458*a - 0.0638541728*b;
  float s = L - 0.0894841775*a - 1.2914855480*b;
  l=l*l*l; m=m*m*m; s=s*s*s;
  return vec3(
     4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
    -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
    -0.0041960863*l - 0.7034186147*m + 1.7076147010*s);
}
vec3 lin_to_srgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(12.92*c, 1.055*pow(c, vec3(1.0/2.4))-0.055, step(vec3(0.0031308),c));
}
float base_hue(int idx, int N, int relType, float seed) {
  float tau  = 6.2832;
  float fi   = float(idx);
  float base = seed * tau;
  float span = max(float(N - 1), 1.0);
  if (relType == 1) return base; // monochromatic: same hue, L varies across stops
  if (relType == 2) { float pole=float(idx%2)*3.14159; return base+pole+float(idx/2)*0.30; }
  if (relType == 3) return base + (fi - span*0.5) * (0.524 / span); // ±15° arc
  if (relType == 4) { float pole=float(idx%3)*(tau/3.0); return base+pole+float(idx/3)*0.20; }
  if (relType == 5) { float pole=float(idx%4)*(tau/4.0); return base+pole+float(idx/4)*0.18; }
  if (relType == 6) { // split-comp: base + two flanks of complement (150° / 210°)
    int grp=idx%3; float pole;
    if (grp==0) pole=0.0; else if (grp==1) pole=2.618; else pole=3.665;
    return base+pole+float(idx/3)*0.25;
  }
  if (relType == 7) { return base+fi*(tau/float(max(N,1))); } // spectral: full rainbow
  if (relType == 8) { // duotone: two tight clusters at base & complement
    float pole=float(idx%2)*3.14159; float gi=float(idx/2);
    float gs=max(float(N/2-1),1.0);
    return base+pole+(gi-gs*0.5)*0.30/gs;
  }
  if (relType == 9) { float pole=float(idx%5)*(tau/5.0); return base+pole+float(idx/5)*0.16; } // pentadic
  return base + fi * 2.39996; // golden angle (smart)
}
vec3 stop_color(int idx, int N, int relType) {
  float t = (N > 1) ? float(idx) / float(N - 1) : 0.5;
  float L = clamp(mix(0.12, 0.88, t) + (uParams.x - 0.5) * 0.5, 0.04, 0.96);
  float C = uParams.y * 0.34;
  float H = base_hue(idx, N, relType, uParams.z);
  return lin_to_srgb(oklab_to_linear(L, C*cos(H), C*sin(H)));
}
void main() {
  float luma  = dot(texture(u_video, vUV).rgb, vec3(0.299, 0.587, 0.114));
  // Packing: blackStops*100 + N*10 + relType. blackStops=0 is identical to
  // the old N*10+relType format so old saves decode correctly.
  int packed     = int(uParam4);
  int blackStops = packed / 100;
  int rem        = packed - blackStops * 100;
  int N          = max(rem / 10, 4);
  int relType    = clamp(rem - N * 10, 0, 9);
  float pos = luma * float(N - 1);
  int i0 = clamp(int(floor(pos)), 0, N - 1);
  int i1 = min(i0 + 1, N - 1);
  vec3 c0 = (i0 < blackStops) ? vec3(0.0) : stop_color(i0, N, relType);
  vec3 c1 = (i1 < blackStops) ? vec3(0.0) : stop_color(i1, N, relType);
  fragColor = vec4(mix(c0, c1, fract(pos)), 1.0);
}`;

// ---- Structure output-mode conversion pass ----
// Runs after the structure shader outputs raw mono, converts to the
// selected output mode: 0=mono, 1=source, 2=ink, 3=invert.
const FRAG_STRUCT_MODE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform sampler2D u_struct;
uniform float uOutputMode;
uniform vec3 uInkLow;
uniform vec3 uInkHigh;
out vec4 fragColor;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  float s   = clamp(texture(u_struct, vUV).r, 0.0, 1.0);
  vec3  src = texture(u_video,  vUV).rgb;
  vec3  col;
  if (uOutputMode < 0.5) {
    col = vec3(s);
  } else if (uOutputMode < 1.5) {
    float srcLum = max(luma(src), 0.001);
    float tgt    = mix(srcLum, s, 0.55);
    col = clamp(src * (tgt / srcLum), 0.0, 1.0);
  } else if (uOutputMode < 2.5) {
    float poster = smoothstep(0.42, 0.58, s);
    col = mix(uInkLow, uInkHigh, poster);
  } else {
    col = vec3(1.0 - s);
  }
  fragColor = vec4(col, 1.0);
}`;

let _structModeProgram = null;

// COLORISOLATION — STRUCTURE. Hue isolation mask: outputs weight of how well
// each pixel matches a target hue. Isolate mode = matching hue bright; Reject = inverted.
// uParams: x=hue(0-1), y=overlap(0-1), z=steepness(0-1), w=mode(0=isolate,1=reject)
const FRAG_COLORISOLATION = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  vec3 col = texture(u_video, vUV).rgb;
  float maxC = max(col.r, max(col.g, col.b));
  float minC = min(col.r, min(col.g, col.b));
  float delta = maxC - minC;
  float hue = 0.0;
  if (delta > 0.001) {
    if (maxC == col.r)      hue = mod((col.g - col.b) / delta, 6.0) / 6.0;
    else if (maxC == col.g) hue = ((col.b - col.r) / delta + 2.0) / 6.0;
    else                    hue = ((col.r - col.g) / delta + 4.0) / 6.0;
  }
  hue = fract(hue);
  float sat = (maxC > 0.001) ? delta / maxC : 0.0;
  float diff = hue - uParams.x;
  diff = abs(diff - round(diff));
  float overlap = max(0.001, uParams.y * 0.2 + 0.02);
  float height  = mix(1.0, 10.0, uParams.z);
  float weight  = clamp(height * exp(-(diff * diff) / (2.0 * overlap * overlap)), 0.0, 1.0);
  weight *= sat;
  float structure = uParams.w > 0.5 ? 1.0 - weight : weight;
  fragColor = vec4(vec3(structure), 1.0);
}`;

// CARTOON_STRUCT — STRUCTURE. Diagonal 4-sample Sobel edge detection outputting
// edge strength as raw structure float. Invert mode gives dark outlines on white.
// uParams: x=power(0-1), y=slope(0-1)
const FRAG_CARTOON_STRUCT = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_video, 0));
  const vec3 luma = vec3(0.2126, 0.7152, 0.0722);
  float power = mix(0.5, 8.0, uParams.x);
  float slope = mix(0.5, 4.0, uParams.y);
  float diff1 = dot(luma, texture(u_video, vUV + px).rgb)
              - dot(luma, texture(u_video, vUV - px).rgb);
  float diff2 = dot(luma, texture(u_video, vUV + px * vec2(1.0, -1.0)).rgb)
              - dot(luma, texture(u_video, vUV + px * vec2(-1.0,  1.0)).rgb);
  float edge = diff1 * diff1 + diff2 * diff2;
  float structure = clamp(pow(edge, slope) * power, 0.0, 1.0);
  fragColor = vec4(vec3(structure), 1.0);
}`;

// KUWAHARA_STRUCT — STRUCTURE variant of the Kuwahara painterly filter.
// Same 7x7 quadrant sampling, but outputs luma of the painted result (no sat boost/blend).
// uParams: x=radius(1-5px), y=sharpness(quadrant hardness)
const FRAG_KUWAHARA_STRUCT = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_video, 0));
  float stepScale = 1.0 + uParams.x * 4.0;
  vec3 m0=vec3(0.0), m1=vec3(0.0), m2=vec3(0.0), m3=vec3(0.0);
  float s0=0.0, s1=0.0, s2=0.0, s3=0.0;
  float n0=0.0, n1=0.0, n2=0.0, n3=0.0;
  for (int dx = -3; dx <= 3; dx++) {
    for (int dy = -3; dy <= 3; dy++) {
      vec2 off = vec2(float(dx), float(dy)) * px * stepScale / 3.0;
      vec3 cv = texture(u_video, clamp(vUV + off, 0.0, 1.0)).rgb;
      float L = dot(cv, vec3(0.299, 0.587, 0.114));
      if (dx <= 0 && dy <= 0) { m0 += cv; s0 += L*L; n0 += 1.0; }
      if (dx >= 0 && dy <= 0) { m1 += cv; s1 += L*L; n1 += 1.0; }
      if (dx <= 0 && dy >= 0) { m2 += cv; s2 += L*L; n2 += 1.0; }
      if (dx >= 0 && dy >= 0) { m3 += cv; s3 += L*L; n3 += 1.0; }
    }
  }
  m0/=n0; m1/=n1; m2/=n2; m3/=n3;
  vec3 lv = vec3(0.299, 0.587, 0.114);
  float v0 = s0/n0 - dot(m0,lv)*dot(m0,lv);
  float v1 = s1/n1 - dot(m1,lv)*dot(m1,lv);
  float v2 = s2/n2 - dot(m2,lv)*dot(m2,lv);
  float v3 = s3/n3 - dot(m3,lv)*dot(m3,lv);
  float sharp = exp(mix(0.0, 7.0, uParams.y));
  float w0=exp(-v0*sharp), w1=exp(-v1*sharp), w2=exp(-v2*sharp), w3=exp(-v3*sharp);
  float wt = w0+w1+w2+w3;
  vec3 result = (m0*w0 + m1*w1 + m2*w2 + m3*w3) / wt;
  float structure = dot(result, lv);
  fragColor = vec4(vec3(structure), 1.0);
}`;

// COLORFULPOSTER — COLOR. Luma posterization via logistic curve + CMYK-tinted
// hard-light color layer. Levels/Slope/Continuity control the quantization curve;
// Tint blends the colored hard-light layer. After Daodan317081/reshade-shaders.
// uParams: x=levels(0-1->2-20), y=slope(0-1->0-20), z=continuity(0-1), w=tint(0-1)
const FRAG_COLORFULPOSTER = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
float posterize(float x, float numLevels, float continuity, float slope) {
  float sh = 1.0 / numLevels;
  float sn = floor(x * numLevels);
  float fr = fract(x * numLevels);
  float step1 = floor(fr) * sh;
  float step2 = (1.0 / (1.0 + exp(-slope * (fr - 0.5)))) * sh;
  return mix(step1, step2, continuity) + sh * sn;
}
void main() {
  const vec3 lumaW = vec3(0.2126, 0.7151, 0.0721);
  float numLevels = mix(2.0, 20.0, uParams.x);
  float slope     = mix(0.0, 20.0, uParams.y);
  float cont      = uParams.z;
  float tint      = uParams.w;
  vec3 col   = texture(u_video, vUV).rgb;
  float luma = dot(col, lumaW);
  vec3 chroma = col - luma;
  float lumaP = posterize(luma, numLevels, cont, slope);
  float K = 1.0 - max(col.r, max(col.g, col.b));
  float denom = max(1.0 - K, 0.001);
  vec3 cmy = clamp((1.0 - col - K) / denom + vec3(0.2, -0.1, -0.2), 0.0, 1.0);
  vec3 mask = (1.0 - cmy) * (1.0 - K);
  vec3 image = chroma + lumaP;
  vec3 colorLayer = mix(
    2.0 * image * mask,
    1.0 - 2.0 * (1.0 - image) * (1.0 - mask),
    step(0.5, vec3(luma))
  );
  colorLayer = mix(image, colorLayer, tint);
  fragColor = vec4(clamp(colorLayer, 0.0, 1.0), 1.0);
}`;

// FAKEHDR — FX. Two 8-sample blooms at different radii, difference drives a
// local-contrast enhancement trick. Not real HDR but gives punchy expanded-range look.
// After CeeJay.dk FakeHDR for ReShade.
// uParams: x=power(0-1->0.1-8), y=near(0-1->0.5-3), z=far(0-1->0.6-4), w=mix(0-1)
const FRAG_FAKEHDR = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_video, 0));
  vec3 color = texture(u_video, vUV).rgb;
  float hdrPow = mix(0.1, 8.0, uParams.x);
  float r1 = mix(0.5, 3.0, uParams.y);
  float r2 = mix(0.6, 4.0, uParams.z);
  vec3 bloom1 = vec3(0.0), bloom2 = vec3(0.0);
  const vec2 offsets[8] = vec2[8](
    vec2( 1.5,-1.5), vec2(-1.5,-1.5), vec2( 1.5, 1.5), vec2(-1.5, 1.5),
    vec2( 0.0,-2.5), vec2( 0.0, 2.5), vec2(-2.5, 0.0), vec2( 2.5, 0.0)
  );
  for (int i = 0; i < 8; i++) {
    bloom1 += texture(u_video, vUV + offsets[i] * r1 * px).rgb;
    bloom2 += texture(u_video, vUV + offsets[i] * r2 * px).rgb;
  }
  bloom1 *= 0.005;
  bloom2 *= 0.010;
  float dist = max(r2 - r1, 0.001);
  vec3 hdr  = (color + (bloom2 - bloom1)) * dist;
  vec3 blnd = hdr + color;
  vec3 result = pow(max(blnd, 0.0), vec3(max(hdrPow, 0.1))) + hdr;
  fragColor = vec4(clamp(mix(color, result, uParams.w), 0.0, 1.0), 1.0);
}`;

export const FRAGS = {
  erode:        FRAG_ERODE,
  oxide:        FRAG_OXIDE,
  synth:        FRAG_SYNTH,
  biolum:       FRAG_BIOLUM,
  thermo:       FRAG_THERMO,
  falsecolor:   FRAG_FALSECOLOR,
  // STRUCTURE additions
  ascii:        ASCII_FRAG,
  watershed:    FRAG_WATERSHED,
  pixelsort:    FRAG_PIXELSORT,
  melt:         FRAG_MELT,
  moddiff:      FRAG_MODDIFF,
  motionedge:   FRAG_MOTIONEDGE,
  dog:          FRAG_DOG,
  dither:       FRAG_DITHER,
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
  sketch:       FRAG_SKETCH,
  okband:       FRAG_OKBAND,
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
  // AcerolaFX-inspired FX RACK (stateless)
  vignette:     FRAG_VIGNETTE,
  tonemap:      FRAG_TONEMAP,
  chromab:      FRAG_CHROMAB,
  sharpen:      FRAG_SHARPEN,
  edgedet:      FRAG_EDGEDET,
  bokeh:        FRAG_BOKEH,
  filmgrain:    FRAG_FILMGRAIN,
    ign:          FRAG_IGN,
  // AcerolaFX-inspired COLOR
  palswap:      FRAG_PALSWAP,
  csadjust:     FRAG_CSADJUST,
  halftone:     FRAG_HALFTONE,
  kuwahara:     FRAG_KUWAHARA,
  kuwahara_struct: FRAG_KUWAHARA_STRUCT,
  colorisolation:  FRAG_COLORISOLATION,
  cartoon:         FRAG_CARTOON_STRUCT,
  colorfulposter:  FRAG_COLORFULPOSTER,
  fakehdr:         FRAG_FAKEHDR,
  okdrift:      FRAG_OKDRIFT,
};

// ---- WebGL helpers ----

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('[glFilters] shader:', gl.getShaderInfoLog(s));
    if (window.__lumiGLError) window.__lumiGLError('Effect failed to load');
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
    // don't declare it, so the upload is skipped.
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

export function applyStructureMode(cw, ch, structTex, outputMode, inkLow, inkHigh, outputFBO) {
  const { gl, vao } = ensureContext(cw, ch);
  const videoTex = getVideoTex();
  if (!_structModeProgram) {
    _structModeProgram = createProgram(gl, VERT, FRAG_STRUCT_MODE);
  }
  const prog = _structModeProgram;
  gl.useProgram(prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, videoTex);
  gl.uniform1i(gl.getUniformLocation(prog, 'u_video'), 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, structTex);
  gl.uniform1i(gl.getUniformLocation(prog, 'u_struct'), 1);
  gl.uniform1f(gl.getUniformLocation(prog, 'uOutputMode'), outputMode);
  if (inkLow)  gl.uniform3fv(gl.getUniformLocation(prog, 'uInkLow'),  inkLow);
  if (inkHigh) gl.uniform3fv(gl.getUniformLocation(prog, 'uInkHigh'), inkHigh);
  gl.bindFramebuffer(gl.FRAMEBUFFER, outputFBO);
  gl.viewport(0, 0, cw, ch);
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
