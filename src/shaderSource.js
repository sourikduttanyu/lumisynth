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
 * Resolution presets (SHADER_RES) default to 720p-class for integrated GPU
 * compatibility. Users can switch to 1080p in the UI.
 */

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 vUV;
void main() {
  vUV = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
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
  for (int i = 0; i < 72; i++) {
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

// STAR NEST — the canonical volumetric fractal starfield. A Kaleidoscopic-IFS
// "magic formula" (abs(p)/dot(p,p) - formuparam) iterated inside a tiling fold
// and accumulated over a volumetric march, drifting forever through nebula
// clouds and star clusters. Ported from Pablo Roman Andrioli's "Star Nest"
// (Shadertoy XlfGRj, MIT). iTime → uTime; the iMouse rotation is replaced by
// an auto-tumble Spin knob (the library has no pointer input).
const FRAG_STARNEST = `#version 300 es
precision highp float;
in vec2 vUV;
uniform float uTime;
uniform vec2 uRes;
uniform float uParams[8];
out vec4 fragColor;
// [0] Zoom [1] Warp [2] Tile [3] Bright [4] DarkMatter [5] Saturation [6] Spin

#define iterations 14
#define volsteps 16
#define stepsize 0.1
#define distfading 0.730

void main() {
  float zoom       = uParams[0];
  float formuparam = uParams[1];
  float tile       = uParams[2];
  float brightness = uParams[3] * 0.005;   // knob 0..1 → original 0.0015 at 0.3
  float darkmatter = uParams[4];
  float saturation = uParams[5];
  float spin       = uParams[6];

  vec2 fragCoord = vUV * uRes;
  vec2 uv = fragCoord.xy / uRes.xy - 0.5;
  uv.y *= uRes.y / uRes.x;
  vec3 dir = vec3(uv * zoom, 1.0);
  float time = uTime * 0.03 + 0.25;

  // Auto-tumble in place of the original mouse rotation.
  float a1 = 0.5 + uTime * spin * 0.25;
  float a2 = 0.8 + uTime * spin * 0.17;
  mat2 rot1 = mat2(cos(a1), sin(a1), -sin(a1), cos(a1));
  mat2 rot2 = mat2(cos(a2), sin(a2), -sin(a2), cos(a2));
  dir.xz *= rot1; dir.xy *= rot2;
  vec3 from = vec3(1.0, 0.5, 0.5);
  from += vec3(time * 2.0, time, -2.0);
  from.xz *= rot1; from.xy *= rot2;

  float s = 0.1, fade = 1.0;
  vec3 v = vec3(0.0);
  for (int r = 0; r < volsteps; r++) {
    vec3 p = from + s * dir * 0.5;
    p = abs(vec3(tile) - mod(p, vec3(tile * 2.0)));   // tiling fold
    float pa, a = pa = 0.0;
    for (int i = 0; i < iterations; i++) {
      p = abs(p) / dot(p, p) - formuparam;            // the magic formula
      a += abs(length(p) - pa);
      pa = length(p);
    }
    float dm = max(0.0, darkmatter - a * a * 0.001);  // dark matter
    a *= a * a;                                        // contrast
    if (r > 6) fade *= 1.0 - dm;
    v += fade;
    v += vec3(s, s * s, s * s * s * s) * a * brightness * fade;
    fade *= distfading;
    s += stepsize;
  }
  v = mix(vec3(length(v)), v, saturation);
  fragColor = vec4(v * 0.01, 1.0);
}`;

// HYPERKART — neon tube-racer flythrough. Flies a curving SDF tunnel lined
// with red/blue squiggling light strips and a boxy lattice, glow-accumulated
// then bounced once for wet reflections — a synthwave kart-racer feel.
// Shadertoy port: iTime → uTime, iResolution → uRes; the camera right-vector
// `vec3(Z.z,0,-Z)` is corrected to `vec3(Z.z,0,-Z.x)` (the 5-component form
// does not compile). lights is explicitly zeroed (drivers don't guarantee it).
const FRAG_HYPERKART = `#version 300 es
precision highp float;
in vec2 vUV;
uniform float uTime;
uniform vec2 uRes;
uniform float uParams[8];
out vec4 fragColor;
// [0] Glow [1] Roll [2] Hue [3] Reflect [4] Zoom

#define T (sin(uTime*.6)*64.+uTime*2e2)
#define P(z) (vec3(cos((z)*.015)*16.+cos((z)*.006)*64., \\
                   cos((z)*.011)*24.+cos((z)*.009)*32., (z)))
#define R(a) mat2(cos(a+vec4(0,33,11,0)))
#define N normalize

vec4 lights;

float boxen(vec3 p) {
  p = abs(fract(p / 4e1) * 4e1 - 2e1) - 2.;
  return min(p.x, min(p.y, p.z));
}
float map(vec3 p) {
  vec3 q = P(p.z);
  float m, g = q.y - p.y + 6.;
  m = boxen(p);
  p.xy -= q.xy;
  float red, blue;
  float e = min(red  = length(p.xy - sin(p.y / 12. + vec2(5., 1.)) * 12.) - 1.,
                blue = length(p.xy - sin(p.y / 12. + vec2(0, 1.)) * 12.) - 1.);
  lights += vec4(2, 1e1, 1e1, 0) / (.1 + abs(red) / 1e1);
  lights += vec4(1e1, 2, 1e1, 0) / (.1 + abs(blue) / 1e1);
  p = abs(p);
  float tex = abs(length(sin(p * cos(p.yzx / 3e1) * 4.) / (p * 4.)));
  float tun = min(64. - p.x - p.y + m, 32. - p.y - m);
  float d = max(min(m, g), tun) - tex;
  return min(e, d);
}
vec3 hueShift(vec3 c, float h) {
  const vec3 k = vec3(0.57735);
  float a = h * 6.28318530718, ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

void main() {
  float glow = uParams[0], roll = uParams[1], hue = uParams[2], refl = uParams[3];
  float zoom = max(uParams[4], 0.05);

  vec2 u = (vUV - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  u.y -= .2;
  u /= zoom;

  vec4 o = vec4(0);
  lights = vec4(0);
  vec3 p = P(T), ro = p,
       Z = N(P(T + 1e1) - p),
       X = N(vec3(Z.z, 0, -Z.x)),
       D = N(vec3(R(sin(T * .005) * roll * .4) * u, 1) * mat3(-X, cross(X, Z), Z));

  float i = 0., s = 0., d = 0.;
  for (; i++ < 96.;)
    p = ro + D * d,
    d += s = map(p) * .8,
    o += lights + 1. / max(s, .01);

  const float h = 0.005;
  const vec2 k = vec2(1, -1);
  vec3 n = N(k.xyy * map(p + k.xyy * h) +
             k.yyx * map(p + k.yyx * h) +
             k.yxy * map(p + k.yxy * h) +
             k.xxx * map(p + k.xxx * h));

  o *= (.1 + max(dot(n, -D), 0.));

  vec4 ref = vec4(0);
  lights = vec4(0);
  for (p += n * .05, D = reflect(D, n), s = i = 0.; i++ < 3e1;)
    p += D * s,
    s = map(p) * .8,
    ref += lights + 1. / max(s, .01);

  o += o * ref * refl;
  o.rgb = hueShift(o.rgb, hue);
  o = tanh(o * glow / 6e6 / d);
  fragColor = vec4(max(o.rgb, 0.0), 1.0);
}`;

const SHADER_FRAGS = {
  phantomstar: FRAG_PHANTOMSTAR,
  starnest:    FRAG_STARNEST,
  hyperkart:   FRAG_HYPERKART,
};

// Library metadata — the source picker grid builds itself from this.
export const SHADER_SOURCES = [
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
  {
    slug: 'starnest',
    label: 'Star Nest',
    tip: 'The classic volumetric fractal starfield — drifting forever through nebula clouds and star clusters. Pablo Roman Andrioli (MIT).',
    gradient: 'radial-gradient(circle at 50% 50%, #fff0d0, #ff8c3a 16%, #c83a8c 40%, #5a3aff 64%, #0a0420)',
    knobs: [
      { key: 'speed', label: 'Speed', min: 0,    max: 2.5,  step: 0.01,  default: 1,
        tip: 'Master clock. Scales the drift through the starfield and the auto-tumble. 0 = frozen frame.' },
      { key: 'zoom',  label: 'Zoom',  min: 0,    max: 50,   step: 0.1,   default: 10,
        tip: 'Field of view. Low = wide cosmic vista. High = extreme fisheye plunge that wraps the whole starfield around you.' },
      { key: 'warp',  label: 'Warp',  min: 0.40, max: 0.62, step: 0.005, default: 0.53,
        tip: 'The fractal "magic formula" constant — the heart of the look. Tiny moves completely restructure the nebula. Sensitive; sweep slowly.' },
      { key: 'tile',  label: 'Tile',  min: 0.4,  max: 1.5,  step: 0.01,  default: 0.85,
        tip: 'Tiling fold size. Sets how densely the fractal repeats through space. Low = tight busy clusters, high = sparse open fields.' },
      { key: 'bright',label: 'Bright',min: 0,    max: 1,    step: 0.01,  default: 0.3,
        tip: 'Star/nebula brightness. Low = dim distant glow, high = a blaze of close-packed stars.' },
      { key: 'dark',  label: 'Dark',  min: 0,    max: 0.6,  step: 0.01,  default: 0.3,
        tip: 'Dark matter. Carves shadowed voids into the cloud so bright clusters read against black. 0 = even haze, high = deep negative space.' },
      { key: 'sat',   label: 'Sat',   min: 0,    max: 1,    step: 0.01,  default: 0.85,
        tip: 'Color saturation. 0 = silvery monochrome starfield, 1 = full nebula color.' },
      { key: 'spin',  label: 'Spin',  min: 0,    max: 1,    step: 0.01,  default: 0.3,
        tip: 'Auto-tumble rate (replaces the original mouse look). 0 = fixed orientation, just drifting forward. High = slow rolling tumble through space.' },
    ],
  },
  {
    slug: 'hyperkart',
    label: 'Hyperkart',
    tip: 'Neon tube-racer flythrough — a curving lattice tunnel lined with red/blue light strips, glow-accumulated and bounced for wet synthwave reflections. After a Shadertoy original.',
    gradient: 'linear-gradient(120deg, #04030a, #1828d8 28%, #20e6ff 52%, #ff2a96 78%, #04030a)',
    knobs: [
      { key: 'speed',   label: 'Speed',   min: 0,   max: 2.5, step: 0.01, default: 1,
        tip: 'Race speed. How fast you fly the tunnel — scales the whole clock. 0 = parked, lights frozen.' },
      { key: 'glow',    label: 'Glow',    min: 0.2, max: 4,   step: 0.01, default: 1,
        tip: 'Neon exposure. Low = moody dim strips. High = blown-out blazing light tubes.' },
      { key: 'roll',    label: 'Roll',    min: 0,   max: 2,   step: 0.01, default: 1,
        tip: 'Banking. How hard the camera leans into the curves. 0 = locked level, high = aggressive kart roll.' },
      { key: 'hue',     label: 'Hue',     min: 0,   max: 1,   step: 0.01, default: 0,
        tip: 'Color rotation. 0 = the original red/blue neon. Sweep for cyan, gold, magenta tube palettes.' },
      { key: 'reflect', label: 'Reflect', min: 0,   max: 2,   step: 0.01, default: 1,
        tip: 'Wet-floor reflection strength. 0 = matte tunnel, high = mirror-slick chrome bounce.' },
      { key: 'zoom',    label: 'Zoom',    min: 0.3, max: 3,   step: 0.01, default: 1,
        tip: 'Field of view. Low = wide fisheye speed-rush. High = telephoto tight on the track.' },
    ],
  },
];

export const SHADER_RES = {
  landscape: { w: 1280, h:  720, label: '16:9' },
  square:    { w:  720, h:  720, label: '1:1'  },
  vertical:  { w:  720, h: 1280, label: '9:16' },
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
  // preserveDrawingBuffer: false — the fast double-buffer swap path. Safe here
  // because all reads (ctx.drawImage, offCtx.drawImage, gl.texSubImage2D in
  // glContext) happen within the same RAF tick before the browser composites,
  // so the framebuffer contents are always available when we need them.
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: false, alpha: false });
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
  M = { canvas, gl, vao, progs: Object.create(null), slug: null, def: null, w: 0, h: 0, phase: 0, lastNow: null };
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
  m.def  = SHADER_SOURCES.find((s) => s.slug === slug) || null;
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
    // M.def is cached on slug change — no linear search per frame.
    _paramBuf.fill(0);
    let i = 0;
    for (const k of M.def?.knobs || []) {
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
