/**
 * FX RACK effects — stateful feedback GL passes, all on the shared WebGL2
 * canvas from glContext.js.
 *
 * Unlike glFilters.js (stateless single-pass), FX effects keep a persistent
 * feedback texture between frames: each frame samples its OWN previous
 * output (u_feedback) alongside the chain input (u_video), then becomes the
 * feedback source for the next frame. That's what makes trails accumulate —
 * the chain FBOs in glContext.js can't do this because they're rewritten by
 * every stage every frame.
 *
 * Feedback buffers are keyed per rack slot (opts.fxKey) so two slots running
 * the same effect each accumulate their own independent trail state. Each
 * key owns a ping-pong FBO pair:
 *
 *   frame N:  shader reads { u_video: chain input, u_feedback: pair.read.tex }
 *             shader writes → pair.write.fb            (never read+write same tex)
 *             copy pass blits pair.write.tex → opts.outputFBO (or GL canvas)
 *             pair swaps — this frame's output is next frame's feedback
 *
 * The copy pass is a real draw (passthrough program), not gl.blitFramebuffer,
 * because the default framebuffer may be antialiased and blitting single-
 * sample → multisample is an INVALID_OPERATION in WebGL2.
 *
 * Orchestrator contract (same as every GL module): no video upload, no
 * 2D-canvas composite in here — renderFrame owns both. Buffers are disposed
 * and restart from black on resize, source change, or timeline segment
 * change (resetFxFeedback, wired into resetAllState in main.js).
 */

import { ensureContext, getGL, getVideoTex } from './glContext.js';

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 vUV;
void main() {
  vUV = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// FLOW FIELD — advect pixels along the luma-gradient flow, accumulate trails.
// Direct conversion of the TouchDesigner source: sTD2DInputs[0] → u_video,
// sTD2DInputs[1] (feedback) → u_feedback, TDOutputSwizzle → identity.
// uParams.x = Flow Speed, y = Trail Persistence, z = Trail Brightness,
// w = Source Blend.
const FRAG_FLOWFIELD = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform sampler2D u_feedback;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  vec2 uv = vUV;
  vec2 texel = 1.0 / vec2(textureSize(u_video, 0));
  vec3 src = texture(u_video, uv).rgb;
  float lR = dot(texture(u_video, uv + vec2(texel.x, 0.0)).rgb, vec3(0.299,0.587,0.114));
  float lL = dot(texture(u_video, uv - vec2(texel.x, 0.0)).rgb, vec3(0.299,0.587,0.114));
  float lU = dot(texture(u_video, uv + vec2(0.0, texel.y)).rgb, vec3(0.299,0.587,0.114));
  float lD = dot(texture(u_video, uv - vec2(0.0, texel.y)).rgb, vec3(0.299,0.587,0.114));
  vec2 grad = vec2(lR - lL, lU - lD);
  float gradMag = length(grad);
  vec2 flowDir = vec2(-grad.y, grad.x);
  vec2 advectUV = clamp(uv - flowDir * uParams.x * 0.02, 0.0, 1.0);
  vec3 trail = texture(u_feedback, advectUV).rgb * uParams.y;
  trail += src * gradMag * uParams.z * 4.0;
  vec3 result_c = mix(trail, src + trail * 0.5, uParams.w);
  fragColor = vec4(clamp(result_c, 0.0, 1.0), 1.0);
}`;

// DRAG — directional feedback smear. Bright areas streak forward along a
// chosen direction, decaying into comet-like light trails.
// uParams: x=Direction(0→1 = 0→360°), y=Distance(drag spread),
//          z=Decay(trail persistence), w=Chroma(0=mono trail, 1=rainbow smear)
// Baked: spread≈0.3 (trail softening), threshold≈0.2, sourceMix≈0.55
const FRAG_DRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform sampler2D u_feedback;
uniform vec4 uParams;
out vec4 fragColor;
void main() {
  vec2 uv = vUV;
  vec2 texel = 1.0 / vec2(textureSize(u_video, 0));
  vec3 cur = texture(u_video, uv).rgb;
  float curL = dot(cur, vec3(0.299, 0.587, 0.114));

  float ang = uParams.x * 6.2831853;
  vec2 dir = vec2(cos(ang), sin(ang));
  float dragPx = mix(0.0, 24.0, uParams.y);
  vec2 off = dir * dragPx * texel;

  // Chroma: R/G/B sample at different distances for rainbow smear
  float c = uParams.w;
  vec3 prev;
  prev.r = texture(u_feedback, clamp(uv - off * (1.0 + 0.4 * c), 0.0, 1.0)).r;
  prev.g = texture(u_feedback, clamp(uv - off,                    0.0, 1.0)).g;
  prev.b = texture(u_feedback, clamp(uv - off * (1.0 - 0.4 * c), 0.0, 1.0)).b;

  // Soften trail (baked spread ~0.3, perpendicular taps)
  vec3 s1 = texture(u_feedback, clamp(uv - off + vec2( off.y, -off.x) * 0.15, 0.0, 1.0)).rgb;
  vec3 s2 = texture(u_feedback, clamp(uv - off - vec2( off.y, -off.x) * 0.15, 0.0, 1.0)).rgb;
  prev = (prev + s1 + s2) / 3.0;

  // Decay
  prev *= clamp(uParams.z, 0.0, 0.999);

  // Inject bright areas of current frame into trail (baked threshold ~0.2)
  float inject = smoothstep(0.2, 0.3, curL);
  vec3 trail = max(prev, cur * inject);

  // Composite source back on (baked source mix ~0.55)
  vec3 outc = mix(trail, max(trail, cur), 0.55);
  fragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
}`;

// Passthrough copy: feedback write-buffer → chain output. Needed because the
// new feedback state must land in a persistent texture AND in the chain, and
// one draw can only target one framebuffer.
const FRAG_COPY = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
out vec4 fragColor;
void main() {
  fragColor = texture(u_video, vUV);
}`;

const FX_FRAGS = {
  flowfield: FRAG_FLOWFIELD,
  drag:      FRAG_DRAG,
};

// ---- WebGL helpers (same pattern as glFilters.js) ----

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('[glFx] shader:', gl.getShaderInfoLog(s));
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
    console.error('[glFx] link:', gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

// ---- Module state ----

const _programs = Object.create(null);

function getProgram(name, fragSrc) {
  if (_programs[name]) return _programs[name];
  const gl = getGL();
  if (!gl) return null;
  const prog = createProgram(gl, VERT, fragSrc);
  if (!prog) return null;
  _programs[name] = {
    prog,
    video:    gl.getUniformLocation(prog, 'u_video'),
    feedback: gl.getUniformLocation(prog, 'u_feedback'),
    params:   gl.getUniformLocation(prog, 'uParams'),
  };
  return _programs[name];
}

// Per-slot feedback state: fxKey → { read: {fb,tex}, write: {fb,tex}, w, h }.
// New textures are zero-filled (texImage2D with null), so trails always
// start from black.
const _feedback = new Map();

function makeTarget(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, tex };
}

function disposeEntry(gl, entry) {
  gl.deleteTexture(entry.read.tex);
  gl.deleteFramebuffer(entry.read.fb);
  gl.deleteTexture(entry.write.tex);
  gl.deleteFramebuffer(entry.write.fb);
}

function getFeedback(gl, key, w, h) {
  let entry = _feedback.get(key);
  if (entry && (entry.w !== w || entry.h !== h)) {
    disposeEntry(gl, entry);
    entry = null;
  }
  if (!entry) {
    entry = { read: makeTarget(gl, w, h), write: makeTarget(gl, w, h), w, h };
    _feedback.set(key, entry);
  }
  return entry;
}

/**
 * Drop feedback state so trails restart from black. With a key, resets only
 * that slot (slot cleared / effect swapped); without, resets everything
 * (source change, timeline segment change — wired into resetAllState).
 */
export function resetFxFeedback(key) {
  const gl = getGL();
  if (key !== undefined) {
    const entry = _feedback.get(key);
    if (entry && gl) disposeEntry(gl, entry);
    _feedback.delete(key);
    return;
  }
  if (gl) for (const entry of _feedback.values()) disposeEntry(gl, entry);
  _feedback.clear();
}

/**
 * Run one FX RACK effect.
 *
 * @param {string}   name    fx effect name ('flowfield')
 * @param {number}   cw, ch  canvas size
 * @param {number[]} params  [p0,p1,p2,p3] → uParams.xyzw
 * @param {object}  [opts]   { inputTex, outputFBO, fxKey }
 *   fxKey identifies the rack slot so each slot owns its own trail state.
 */
export function applyFxEffect(name, cw, ch, params = [0.5, 0.5, 0.5, 0.5], opts = {}) {
  const fragSrc = FX_FRAGS[name];
  if (!fragSrc) return;
  const S = ensureContext(cw, ch);
  if (!S) return;

  const entry = getProgram(name, fragSrc);
  const copy  = getProgram('_copy', FRAG_COPY);
  if (!entry || !copy) return;

  const { gl, vao } = S;
  const inTex = opts.inputTex || getVideoTex();
  const outFB = opts.outputFBO ?? null;
  const pair  = getFeedback(gl, opts.fxKey ?? `fx-${name}`, cw, ch);

  gl.viewport(0, 0, cw, ch);
  gl.bindVertexArray(vao);

  // Pass 1 — effect: read chain input + previous feedback, write the new
  // feedback state. Reads pair.read, writes pair.write: no read/write hazard.
  gl.bindFramebuffer(gl.FRAMEBUFFER, pair.write.fb);
  gl.useProgram(entry.prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, inTex);
  gl.uniform1i(entry.video, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, pair.read.tex);
  gl.uniform1i(entry.feedback, 1);
  gl.uniform4f(entry.params, params[0], params[1], params[2], params[3]);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Pass 2 — copy the new state to wherever the chain wants this stage's
  // output (a chain FBO mid-chain, the GL canvas when terminal).
  gl.bindFramebuffer(gl.FRAMEBUFFER, outFB);
  gl.useProgram(copy.prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, pair.write.tex);
  gl.uniform1i(copy.video, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Swap: this frame's output is next frame's u_feedback.
  const t = pair.read;
  pair.read = pair.write;
  pair.write = t;
}
