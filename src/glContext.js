/**
 * Shared WebGL2 context for all effect modules.
 *
 * Before this, each of voronoi/cellular/wave/ascii/glFilters created its own
 * <canvas>, its own webgl2 context, its own video texture, and its own
 * fullscreen-quad VAO. Five GL contexts sat in VRAM holding redundant copies
 * of the same video frame, each effect uploaded its own texture, and 80% of
 * those resources were dead weight at any given moment because only one
 * filter is active per frame.
 *
 * Now: ONE offscreen GL2 canvas, ONE GL2 context, ONE shared video texture,
 * ONE shared fullscreen-quad VAO. Each effect module still owns its own
 * shader programs, FBOs, and uniform locations (those vary per effect) but
 * shares everything else.
 *
 * --- ORCHESTRATOR CONTRACT (post-P2a) ---
 *
 * Effect modules used to upload the video frame and composite the GL canvas
 * to the display 2D canvas themselves. That made multi-stage chaining
 * impossible — two stages would upload twice and composite twice. So those
 * two responsibilities now live in renderFrame (the orchestrator):
 *
 *   1. const S = ensureContext(cw, ch);     // orchestrator: idempotent, resizes
 *   2. uploadVideoFrame(video);              // orchestrator: ONE upload per frame
 *   3. apply{Effect}(cw, ch, params, opts);  // module: pure GL passes only
 *   4. compositeToCanvas2D(ctx, cw, ch, op); // orchestrator: ONE drawImage to display
 *
 * Where opts = { inputTex, outputFBO }:
 *   - inputTex:  texture sampler for the effect's u_video uniform.
 *                Defaults to the shared videoTex; chain mode passes the
 *                upstream stage's output texture.
 *   - outputFBO: framebuffer to bind for the FINAL draw pass.
 *                Defaults to null (= the shared GL canvas); chain mode passes
 *                a chain FBO so the next stage can sample its color attachment.
 *
 * Stateful effects (voronoi, cellular, wave) ignore inputTex — their
 * "input" is always the raw video (they sample it for seed/source/influx
 * pixels in their own update passes). They do respect outputFBO on the
 * final display pass.
 *
 * VAO contract: every effect's vertex shader uses attribute 0 as the
 * clip-space position. Effect programs MUST call
 *   gl.bindAttribLocation(prog, 0, 'a_pos');
 * before linking, which is how the existing modules already wire it.
 */

import { uploadVideoTexture } from './glUtil.js';

let S = null;

// Lazily-allocated pair of chain FBOs used by P2's STRUCTURE → COLOR
// pipeline. Two are needed because the planned compose pass (which bakes
// STRUCTURE's blend mode against the original video) cannot read and write
// the same texture in one draw. Sequence:
//   STRUCTURE writes → chainFBOs.a
//   compose(chainFBOs.a, video) writes → chainFBOs.b
//   COLOR reads chainFBOs.b, writes → screen
//
// Both FBOs use RGBA8; STRUCTURE/COLOR effects are color flow, not
// high-precision state. Allocated on first call to getChainFBOs(), resized
// by ensureContext when the shared canvas resizes.
let chain = null;

function makeChainFBO(gl, w, h) {
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

function disposeChain(gl) {
  if (!chain) return;
  gl.deleteTexture(chain.a.tex);
  gl.deleteFramebuffer(chain.a.fb);
  gl.deleteTexture(chain.b.tex);
  gl.deleteFramebuffer(chain.b.fb);
  chain = null;
}

export function ensureContext(w, h) {
  if (!S) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: true });
    if (!gl) {
      console.warn('[glContext] WebGL2 not supported');
      return null;
    }

    // Fullscreen quad shared by every effect. Captured into a VAO so effects
    // just bind it and drawArrays — no per-frame buffer rebinding.
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Shared video texture — the single source-of-truth for the current
    // frame in GPU memory across all effects.
    const videoTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    S = { canvas, gl, vao, videoTex, w: 0, h: 0 };
  }
  if (S.w !== w || S.h !== h) {
    S.canvas.width = w;
    S.canvas.height = h;
    S.w = w;
    S.h = h;
    // Chain FBOs are sized to the shared canvas. Drop the old pair so the
    // next getChainFBOs() call reallocates at the new dimensions. Cheap —
    // chain FBOs are RGBA8 and resize is rare (canvas-area resize observer).
    if (chain) disposeChain(S.gl);
  }
  return S;
}

export function uploadVideoFrame(video) {
  if (!S) return false;
  S.gl.bindTexture(S.gl.TEXTURE_2D, S.videoTex);
  return uploadVideoTexture(S.gl, S.videoTex, video);
}

export function compositeToCanvas2D(ctx, cw, ch, op = 'source-over') {
  if (!S) return;
  ctx.save();
  ctx.globalCompositeOperation = op;
  ctx.drawImage(S.canvas, 0, 0, cw, ch);
  ctx.restore();
}

// Returns the chain FBO pair { a, b }. Each side is { fb, tex }. Lazy:
// nothing allocates until P2's chain pipeline calls this. Consumers must
// not cache fb/tex handles across resize — ensureContext disposes the pair
// when the canvas dimensions change. Call this fresh each frame instead.
export function getChainFBOs() {
  if (!S) return null;
  if (!chain) {
    chain = {
      a: makeChainFBO(S.gl, S.w, S.h),
      b: makeChainFBO(S.gl, S.w, S.h),
    };
  }
  return chain;
}

// ---- Frame-history ring (motion effects: motionedge / predator) ----
// Four GPU-side copies of recent video frames, written by a passthrough draw
// (no extra CPU upload). getMotionTex() returns the oldest entry — the frame
// from ~4 captures ago — so stateless shaders can do "current minus 4".
// The orchestrator calls captureFrameHistory() once per frame, AFTER
// uploadVideoFrame, and only when the active pipeline contains a motion
// effect — idle cost is zero.
let hist = null; // { ring: [{fb,tex}×4], idx, prog, video, w, h, primed }

const HIST_VERT = `#version 300 es
in vec2 a_pos;
out vec2 vUV;
void main() { vUV = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;
const HIST_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
out vec4 fragColor;
void main() { fragColor = texture(u_video, vUV); }`;

function makeHistProgram(gl) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[glContext] hist shader:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, HIST_VERT);
  const fs = compile(gl.FRAGMENT_SHADER, HIST_FRAG);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, 'a_pos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error('[glContext] hist link:', gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

export function captureFrameHistory() {
  if (!S) return;
  const { gl, vao } = S;
  if (hist && (hist.w !== S.w || hist.h !== S.h)) {
    for (const t of hist.ring) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    hist = null;
  }
  if (!hist) {
    const prog = makeHistProgram(gl);
    if (!prog) return;
    hist = {
      ring: [0, 1, 2, 3].map(() => makeChainFBO(gl, S.w, S.h)),
      idx: 0, prog,
      video: gl.getUniformLocation(prog, 'u_video'),
      w: S.w, h: S.h, primed: false,
    };
  }
  gl.viewport(0, 0, S.w, S.h);
  gl.bindVertexArray(vao);
  gl.useProgram(hist.prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, S.videoTex);
  gl.uniform1i(hist.video, 0);
  const writeTo = (slot) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, hist.ring[slot].fb);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  if (!hist.primed) {
    // first capture (or after reset): seed all 4 slots with the current frame
    // so the first few diffs are zero instead of a flash against black
    for (let i = 0; i < 4; i++) writeTo(i);
    hist.primed = true;
  } else {
    writeTo(hist.idx);
  }
  hist.idx = (hist.idx + 1) % 4;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// Oldest ring entry (the slot about to be overwritten next). Falls back to
// the live video texture before the first capture so shaders never sample
// an unbound unit.
export function getMotionTex() {
  if (hist && hist.primed) return hist.ring[hist.idx].tex;
  return S ? S.videoTex : null;
}

// Re-prime on source / segment change so the new source doesn't diff
// against frames of the old one.
export function resetMotionHistory() {
  if (hist) hist.primed = false;
}

export function getGL()       { return S ? S.gl : null; }
export function getCanvas()   { return S ? S.canvas : null; }
export function getVideoTex() { return S ? S.videoTex : null; }
export function getQuadVAO()  { return S ? S.vao : null; }
