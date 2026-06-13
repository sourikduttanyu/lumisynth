/**
 * SHADER SOURCES — generative GLSL sources for the OSC stage.
 *
 * A shader source is a third source kind alongside video/webcam/image: a
 * raymarched / procedural fragment shader rendered into its OWN canvas every
 * frame, which then feeds the existing pipeline exactly like a video element
 * would (ctx.drawImage for display + uploadVideoFrame for the GL chain +
 * the detection offscreen). STRUCTURE / COLOR / FX all stack on top.
 *
 * This module owns a SEPARATE small WebGL2 context (not glContext.js's): the
 * shared context is the EFFECT side of the pipeline and its canvas/FBOs are
 * orchestrated per-frame by renderFrame; a source generator upstream of that
 * chain needs its own surface so the orchestrator can treat it as a plain
 * drawable element. One source shader runs at a time, so this is one extra
 * context total.
 *
 * To add a shader to the library:
 *   1. Write a fragment shader (interface: vUV in, uTime + uRes uniforms,
 *      optional vec4 uParams for knob-driven values).
 *   2. Register it in SHADER_FRAGS and add a SHADER_SOURCES entry
 *      { slug, label, tip, gradient, knobs } — the picker grid AND the knob
 *      panel in main.js build themselves from SHADER_SOURCES; no index.html
 *      edits.
 *
 * Knob convention: each entry's `knobs` array ({ key, label, tip, min, max,
 * step, default }) drives the Source-section knob panel. The knob with key
 * 'speed' is special — it is consumed JS-side as a clock-rate multiplier on
 * an ACCUMULATED phase (uTime), so dragging Speed glides instead of
 * teleporting the camera. All other knobs upload into the float array
 * `uniform float uParams[8]` in declaration order (so a shader can expose up
 * to 8 controls — no 4-knob ceiling). Knob values are runtime state, kept
 * per-slug, not part of saved looks.
 *
 * Resolution presets (SHADER_RES) are 1080p-class: landscape 1920×1080,
 * square 1080×1080, vertical 1080×1920.
 */

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 vUV;
void main() {
  vUV = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// GOLDEN CLOUDS — POV flying through a tunnel of sunlit cumulus toward a
// golden sun. Raymarched FBM density field shaped as a wobbling cloud
// corridor; sun-facing cloud faces go gold, crevices fall to blue-grey,
// half-lit billows pick up the pink band. Modeled on the "sea of golden
// clouds" dreamcore reference.
const FRAG_GOLDCLOUDS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform float uTime;
uniform vec2 uRes;
uniform float uParams[8];   // [0] zoom, [1] sway, [2] clouds (density)
out vec4 fragColor;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i),                hash(i + vec3(1, 0, 0)), f.x),
                 mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                 mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// Octave rotation kills the value-noise lattice alignment that otherwise
// reads as a fake axis-aligned cross in the tunnel.
const mat3 ROT3 = mat3( 0.00,  0.80,  0.60,
                       -0.80,  0.36, -0.48,
                       -0.60, -0.48,  0.64);
float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise3(p); p = ROT3 * p * 2.3; a *= 0.5; }
  return v;
}
float fbm2(vec3 p) {  // cheaper variant for the shadow probe
  return 0.65 * noise3(p) + 0.35 * noise3(ROT3 * p * 2.3);
}
// Sway knob (uParams[1]) scales the weave amplitude. Camera position and the
// corridor carve share axisOff, so any sway value keeps the camera centered
// in the clear bore.
vec2 axisOff(float z) { return vec2(sin(z * 0.13) * 0.45, cos(z * 0.11) * 0.30) * uParams[1]; }
// Cloud corridor: a WIDE clear bore with a gentle sway; the walls are big
// noise-carved billows (density only where wall AND noise agree, so chunky
// lumps with sky gaps between them). Clouds knob (uParams[2]) slides the
// noise threshold — at its 0.5 default this is the tuned 0.45..0.58 window.
float cloudLo() { return 0.45 + (0.5 - uParams[2]) * 0.26; }
float density(vec3 p) {
  float r = length(p.xy - axisOff(p.z));
  float wall = smoothstep(2.0, 3.8, r);
  float n = fbm(p * 0.5);
  float lo = cloudLo();
  float d = wall * smoothstep(lo, lo + 0.13, n) * 1.9;
  d *= 0.8 + 0.45 * noise3(p * 2.6);               // crisp billow detail
  d += max(0.0, n - 0.82) * 0.25 * (1.0 - wall) * (uParams[2] * 2.0);  // rare interior wisps
  return clamp(d, 0.0, 1.0);
}
float densityCheap(vec3 p) {
  float r = length(p.xy - axisOff(p.z));
  float wall = smoothstep(2.0, 3.8, r);
  float n = fbm2(p * 0.5);
  float lo = cloudLo();
  return clamp(wall * smoothstep(lo, lo + 0.13, n) * 1.9, 0.0, 1.0);
}

void main() {
  vec2 q = (vUV - 0.5) * 2.0;
  q.x *= uRes.x / uRes.y;
  float t = uTime * 0.85;

  vec3 ro = vec3(axisOff(t), t);
  vec3 fwd = normalize(vec3(axisOff(t + 3.0) - ro.xy, 3.0));
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  float spread = 0.72 / max(uParams[0], 0.001);   // zoom knob: telephoto when high
  vec3 rd = normalize(fwd + (q.x * right + q.y * up) * spread);
  vec3 sunDir = normalize(vec3(axisOff(t + 14.0) - ro.xy, 14.0));

  // sky + sun seen down the tunnel
  float sunDot = max(dot(rd, sunDir), 0.0);
  vec3 sky = mix(vec3(0.55, 0.68, 0.92), vec3(1.0, 0.84, 0.66), pow(sunDot, 2.5));
  sky = mix(sky, vec3(0.80, 0.72, 0.92), clamp(rd.y * 0.8 + 0.2, 0.0, 1.0) * 0.35);
  vec3 sun = vec3(1.0, 0.94, 0.76) * pow(sunDot, 300.0) * 4.0
           + vec3(1.0, 0.82, 0.48) * pow(sunDot, 8.0) * 1.40
           + vec3(1.0, 0.66, 0.34) * pow(sunDot, 2.2) * 0.45;

  // volumetric march down the corridor
  float T = 1.0;
  vec3 acc = vec3(0.0);
  float s = 0.4;
  for (int i = 0; i < 56; i++) {
    vec3 p = ro + rd * s;
    float d = density(p);
    if (d > 0.012) {
      float sh = densityCheap(p + sunDir * 0.7);
      float light = exp(-sh * 3.0);
      vec3 lit = mix(vec3(0.42, 0.45, 0.62),        // crevice blue-lavender
                     vec3(1.20, 0.90, 0.60),        // golden faces
                     light);
      lit += vec3(1.0, 0.55, 0.65) * 0.55 * light * (1.0 - light);  // pink half-lit band
      lit += sky * 0.22;                            // pastel ambient from the sky
      float a = d * 0.32;
      acc += lit * a * T;
      T *= 1.0 - a;
      if (T < 0.03) break;
    }
    s += 0.20 + s * 0.07;
  }

  vec3 col = acc + (sky + sun) * T;
  col += vec3(1.0, 0.85, 0.60) * pow(sunDot, 6.0) * (1.0 - T) * 0.20;  // glow bleeding through

  // soft filmic grade + gentle corner falloff
  col = col / (1.0 + col * 0.50);
  col = pow(col, vec3(0.90, 0.95, 1.03)) * 1.12;
  col *= 1.0 - 0.12 * dot(q * 0.55, q * 0.55);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// PHANTOM STAR — kaleidoscopic IFS-fractal flythrough. A folded box fractal
// (abs-fold + rotations) is domain-repeated and mirrored into N-fold radial
// symmetry, then volumetrically accumulated as a glowing neon star tunnel
// with a travelling brightness pulse. Ported from aiekick's "Phantom Star"
// (Shadertoy XtyXzW, building on Phantom Mode MtScWW). iTime → uTime
// (accumulated phase clock), iResolution → uRes, knobs in uParams[].
const FRAG_PHANTOMSTAR = `#version 300 es
precision highp float;
in vec2 vUV;
uniform float uTime;
uniform vec2 uRes;
uniform float uParams[8];
out vec4 fragColor;
// [0] Fly  [1] Symmetry  [2] Morph  [3] Glow  [4] Hue  [5] Pulse  [6] Fade

const float pi  = acos(-1.0);
const float pi2 = pi * 2.0;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

vec2 pmod(vec2 p, float r) {
  float a = atan(p.x, p.y) + pi / r;
  float n = pi2 / r;
  a = floor(a / n) * n;
  return p * rot(-a);
}
float box(vec3 p, vec3 b) {
  vec3 d = abs(p) - b;
  return min(max(d.x, max(d.y, d.z)), 0.0) + length(max(d, 0.0));
}
float ifsBox(vec3 p, float morph) {
  for (int i = 0; i < 5; i++) {
    p = abs(p) - 1.0;
    p.xy *= rot(uTime * 0.3 * morph);
    p.xz *= rot(uTime * 0.1 * morph);
  }
  p.xz *= rot(uTime * morph);
  return box(p, vec3(0.4, 0.8, 0.3));
}
float map(vec3 p, float sym, float morph) {
  vec3 p1 = p;
  p1.x = mod(p1.x - 5.0, 10.0) - 5.0;
  p1.y = mod(p1.y - 5.0, 10.0) - 5.0;
  p1.z = mod(p1.z, 16.0) - 8.0;
  p1.xy = pmod(p1.xy, sym);
  return ifsBox(p1, morph);
}
// Hue rotation about the grey axis (Rodrigues) — 0 keeps the original blue.
vec3 hueShift(vec3 c, float h) {
  const vec3 k = vec3(0.57735);
  float a = h * pi2, ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

void main() {
  float fly   = uParams[0];
  float sym   = max(uParams[1], 2.0);
  float morph = uParams[2];
  float glow  = uParams[3];
  float hue   = uParams[4];
  float pulse = uParams[5];
  float fade  = uParams[6];

  vec2 fragCoord = vUV * uRes;
  vec2 p = (fragCoord * 2.0 - uRes) / min(uRes.x, uRes.y);

  vec3 cPos  = vec3(0.0, 0.0, -fly * uTime);
  vec3 cDir  = normalize(vec3(0.0, 0.0, -1.0));
  vec3 cUp   = vec3(sin(uTime), 1.0, 0.0);
  vec3 cSide = cross(cDir, cUp);
  vec3 ray   = normalize(cSide * p.x + cUp * p.y + cDir);

  float acc = 0.0, acc2 = 0.0, t = 0.0;
  for (int i = 0; i < 99; i++) {
    vec3 pos = cPos + ray * t;
    float dist = map(pos, sym, morph);
    dist = max(abs(dist), 0.02);
    float a = exp(-dist * 3.0);
    if (mod(length(pos) + 24.0 * uTime, 30.0) < 3.0) { a *= 2.0; acc2 += a; }
    acc += a;
    t += dist * 0.5;
  }

  vec3 col = vec3(acc * 0.01,
                  acc * 0.011 + acc2 * 0.002 * pulse,
                  acc * 0.012 + acc2 * 0.005 * pulse);
  col *= glow;
  col = hueShift(col, hue);
  // distance fade to deepen the tunnel mouth (knob: 0 = flat, high = inky far end)
  col *= 1.0 - clamp(t * 0.03 * fade, 0.0, 1.0);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const SHADER_FRAGS = {
  goldclouds:  FRAG_GOLDCLOUDS,
  phantomstar: FRAG_PHANTOMSTAR,
};

// Library metadata — the source picker grid builds itself from this.
export const SHADER_SOURCES = [
  {
    slug: 'goldclouds',
    label: 'Gold Clouds',
    tip: 'POV flight through a tunnel of golden sunlit cumulus. Raymarched volumetric clouds — gold faces, blue-grey crevices, pink half-light.',
    gradient: 'linear-gradient(135deg, #5a6a96, #c498b8 30%, #ffd9a0 55%, #fff3d8 70%, #e8a86a)',
    knobs: [
      { key: 'speed',  label: 'Speed',  min: 0,   max: 2.5, step: 0.01, default: 1,
        tip: 'Flight speed. How fast the camera travels down the corridor. 0 = hover in place while the clouds hold still.' },
      { key: 'zoom',   label: 'Zoom',   min: 0.5, max: 2.5, step: 0.01, default: 1,
        tip: 'Field of view. Low = wide-angle drift with billows wrapping past you. High = telephoto dive straight at the sun.' },
      { key: 'sway',   label: 'Sway',   min: 0,   max: 2,   step: 0.01, default: 1,
        tip: 'Path weave. How hard the corridor (and the camera riding it) snakes side to side. 0 = dead-straight run.' },
      { key: 'clouds', label: 'Clouds', min: 0,   max: 1,   step: 0.01, default: 0.5,
        tip: 'Cloud density. Low = sparse wisps and open lavender sky. High = thick canyon walls closing in.' },
    ],
  },
  {
    slug: 'phantomstar',
    label: 'Phantom Star',
    tip: 'Kaleidoscopic IFS-fractal flythrough — a folded box fractal mirrored into radial symmetry, accumulated as a glowing neon star tunnel with a travelling pulse. After aiekick.',
    gradient: 'radial-gradient(circle at 50% 45%, #dff0ff, #4aa6ff 22%, #2247c8 45%, #0d1640 70%, #03040c)',
    knobs: [
      { key: 'speed', label: 'Speed', min: 0,   max: 2.5, step: 0.01, default: 1,
        tip: 'Master animation rate. Scales the whole clock — flight, fractal morph and pulse together. 0 = frozen frame.' },
      { key: 'fly',   label: 'Fly',   min: 0,   max: 8,   step: 0.05, default: 3,
        tip: 'Forward travel speed down the tunnel, independent of morph. 0 = hover in place while the fractal keeps folding around you.' },
      { key: 'sym',   label: 'Arms',  min: 2,   max: 16,  step: 1,    default: 5,
        tip: 'Kaleidoscope symmetry — number of radial arms the fractal is mirrored into. 5 = the classic star; high = dense mandala.' },
      { key: 'morph', label: 'Morph', min: 0,   max: 3,   step: 0.01, default: 1,
        tip: 'Fractal fold rate. How fast the box fractal rotates and reshapes as you fly. 0 = rigid frozen geometry, just flight.' },
      { key: 'glow',  label: 'Glow',  min: 0.2, max: 4,   step: 0.01, default: 1,
        tip: 'Exposure / neon intensity. Low = dim embers in the dark. High = blown-out blazing light tunnel.' },
      { key: 'hue',   label: 'Hue',   min: 0,   max: 1,   step: 0.01, default: 0,
        tip: 'Color rotation. 0 = the original electric blue/cyan. Sweep for violet, magenta, teal, gold star tunnels.' },
      { key: 'pulse', label: 'Pulse', min: 0,   max: 3,   step: 0.01, default: 1,
        tip: 'Travelling brightness ring accent that washes outward through the structure. 0 = steady glow, high = strong pulsing bands.' },
      { key: 'fade',  label: 'Fade',  min: 0,   max: 2,   step: 0.01, default: 1,
        tip: 'Depth fade. How quickly the far end of the tunnel sinks to black. 0 = flat/even, high = deep inky vanishing point.' },
    ],
  },
];

export const SHADER_RES = {
  landscape: { w: 1920, h: 1080, label: '16:9' },
  square:    { w: 1080, h: 1080, label: '1:1'  },
  vertical:  { w: 1080, h: 1920, label: '9:16' },
};

let M = null; // { canvas, gl, vao, progs: {slug: {prog,time,res,params}}, slug, w, h, phase, lastNow }

// Per-slug knob values, seeded from the registry defaults on first access.
// Runtime state (like shaderSlug itself) — switching shaders and back keeps
// each one's settings for the session, but they are not part of saved looks.
const paramsBySlug = Object.create(null);

// Reused upload buffer for the `uniform float uParams[8]` array (non-speed
// knob values in declaration order). Matches the array size in every source
// shader; cleared and refilled each frame.
const PARAM_SLOTS = 8;
const _paramBuf = new Float32Array(PARAM_SLOTS);

/** Knob value store for a shader (registry defaults filled in). */
export function getShaderSourceParams(slug) {
  if (!paramsBySlug[slug]) {
    const store = Object.create(null);
    const def = SHADER_SOURCES.find((s) => s.slug === slug);
    for (const k of def?.knobs || []) store[k.key] = k.default;
    paramsBySlug[slug] = store;
  }
  return paramsBySlug[slug];
}

/** Write one knob value for the ACTIVE shader. */
export function setShaderSourceParam(key, value) {
  if (!M || !M.slug) return;
  getShaderSourceParams(M.slug)[key] = value;
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('[shaderSource] shader:', gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}

function ensureModule() {
  if (M) return M;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: false });
  if (!gl) {
    console.warn('[shaderSource] WebGL2 not supported');
    return null;
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  M = { canvas, gl, vao, progs: Object.create(null), slug: null, w: 0, h: 0, phase: 0, lastNow: null };
  return M;
}

function getProgram(slug) {
  const m = ensureModule();
  if (!m || !SHADER_FRAGS[slug]) return null;
  if (m.progs[slug]) return m.progs[slug];
  const { gl } = m;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, SHADER_FRAGS[slug]);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, 'a_pos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('[shaderSource] link:', gl.getProgramInfoLog(prog));
    return null;
  }
  m.progs[slug] = {
    prog,
    time:   gl.getUniformLocation(prog, 'uTime'),
    res:    gl.getUniformLocation(prog, 'uRes'),
    // Float-array uniform — queried at element [0]; uniform1fv uploads it all.
    params: gl.getUniformLocation(prog, 'uParams[0]'),
  };
  return m.progs[slug];
}

/** Select the active source shader and output resolution. */
export function setShaderSource(slug, w, h) {
  const m = ensureModule();
  if (!m) return false;
  if (!getProgram(slug)) return false;
  m.slug = slug;
  if (m.w !== w || m.h !== h) {
    m.canvas.width = w;
    m.canvas.height = h;
    m.w = w;
    m.h = h;
  }
  return true;
}

/** Render one frame of the active shader. Call once per renderFrame tick. */
export function renderShaderSourceFrame() {
  if (!M || !M.slug) return;
  const entry = M.progs[M.slug];
  if (!entry) return;
  const { gl, vao, w, h } = M;
  const store = getShaderSourceParams(M.slug);

  // Accumulated clock: Speed scales dt, so knob drags glide the flight
  // rather than teleporting (uTime * speed would jump position on change).
  const now = performance.now() / 1000;
  const dt = M.lastNow == null ? 0 : Math.min(now - M.lastNow, 0.1);
  M.lastNow = now;
  M.phase += dt * (store.speed ?? 1);

  gl.viewport(0, 0, w, h);
  gl.bindVertexArray(vao);
  gl.useProgram(entry.prog);
  if (entry.time != null) gl.uniform1f(entry.time, M.phase);
  if (entry.res != null) gl.uniform2f(entry.res, w, h);
  if (entry.params != null) {
    // Non-speed knobs upload into uParams[] in registry declaration order.
    const def = SHADER_SOURCES.find((s) => s.slug === M.slug);
    _paramBuf.fill(0);
    let i = 0;
    for (const k of def?.knobs || []) {
      if (k.key === 'speed') continue;
      if (i < PARAM_SLOTS) _paramBuf[i++] = store[k.key] ?? k.default;
    }
    gl.uniform1fv(entry.params, _paramBuf);
  }
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

export function getShaderSourceCanvas() {
  return M ? M.canvas : null;
}
