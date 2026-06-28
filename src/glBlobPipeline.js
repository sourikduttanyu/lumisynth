/**
 * glBlobPipeline.js — independent GL2 pipeline for per-blob LumiSynth.
 *
 * Has its own canvas, context, VAO, video texture, and chain FBOs — entirely
 * separate from glContext.js so blob processing never disturbs the main
 * pipeline's feedback state or canvas size.
 *
 * Imports shader source strings (VERT + FRAGS) from glFilters.js and compiles
 * them in its own context.
 *
 * Usage (from renderFrame in main.js):
 *   runBlobsFrame(srcEl, eligibleBlobs, blobPipe, displayCtx, cw, ch)
 *
 * Architecture:
 *   1. Mask canvas  — blobs drawn white at presence opacity (temporal fade-in/out)
 *   2. GL pipeline  — full source frame through STRUCTURE→COLOR→GRADE→FX
 *   3. Composite    — GL output masked by blob shapes → source-over display
 *
 * blobPipe = {
 *   structure: string|null,          // effect name or null
 *   structureParams: number[],       // [p0..p3] ordered params
 *   structureOutputMode: number,     // 0=mono 1=source 2=ink 3=invert 4=colorisolation
 *   colorIsoParams: number[]|null,   // [hue, overlap, steep, mode] — present when structureOutputMode===4
 *   inkLow: [r,g,b],
 *   inkHigh: [r,g,b],
 *   color: { type: string, params: object } | null,
 *   grade: { hue: number, sat: number } | null,
 *   fx: [ { type: string, params: object } ],  // stateless only
 *   composite: string,               // Canvas 2D globalCompositeOperation
 * }
 */

import { VERT, FRAGS, FRAG_EDGEDET_STRUCT } from './glFilters.js';

// Passthrough shader that applies the structure output mode (mono/source/ink/invert)
// to the raw source video when no structure effect is selected.
// structureOutputMode values: 0=mono  1=source(passthrough)  2=ink  3=invert
const FRAG_BLOB_OUTPUT_MODE_ONLY = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform float uOutputMode;
uniform vec3 uInkLow;
uniform vec3 uInkHigh;
out vec4 fragColor;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec4 src = texture(u_video, vUV);
  float l = luma(src.rgb);
  vec3 col;
  if      (uOutputMode < 0.5) col = vec3(l);
  else if (uOutputMode < 1.5) col = src.rgb;
  else if (uOutputMode < 2.5) col = mix(uInkLow, uInkHigh, smoothstep(0.42, 0.58, l));
  else                        col = 1.0 - src.rgb;
  fragColor = vec4(col, src.a);
}`;

// Blob structure context: some effects share a name with FX RACK shaders that
// lack applyStructureOutput. Override them here so mono/source/ink/invert work.
// kuwahara: blob STRUCTURE uses the luma-output STRUCT variant, not the color one.
// _blobOutputMode: no-structure passthrough that still applies the output mode.
const BLOB_STRUCT_FRAG_OVERRIDES = {
  edgedet:          FRAG_EDGEDET_STRUCT,
  kuwahara:         FRAGS.kuwahara_struct,
  _blobOutputMode:  FRAG_BLOB_OUTPUT_MODE_ONLY,
};
import { FX_FRAGS } from './glFx.js';
import { COLOR_PARAM_SCHEMAS, FX_PARAM_SCHEMAS } from './schemas.js';

// ---- Private module state ----

let _canvas = null;   // offscreen GL canvas
let _gl = null;       // WebGL2 context
let _vao = null;      // fullscreen quad VAO
let _tex = null;      // video texture (blob crop)

// Chain FBOs — sized to current blob bbox
let _chain = null;    // { a: {fb, tex}, b: {fb, tex}, w, h }

// Compiled programs (keyed by effect name, for THIS context)
const _programs = Object.create(null);

// Feedback FX programs and per-slot ping-pong state (own context, separate from glFx.js)
const _fxBlobPrograms = Object.create(null);
const _blobFeedback = new Map();

// 2D canvas for cropping blob regions from srcEl
let _cropCanvas = null;
let _cropCtx = null;

// Mask canvas — blobs drawn white at presence opacity (temporal smoothing via presence)
let _maskCanvas = null;
let _maskCtx    = null;

// Composite canvas — GL output masked by blob shapes before hitting the display
let _compCanvas = null;
let _compCtx    = null;

// Prev-frame state for motionedge motion extraction.
// One texture/FB pair per blob pipeline (shared across blobs — approximate
// but visually adequate for per-blob edge+motion extraction).
let _prevBlobTex = null;
let _prevBlobFB  = null;
let _prevBlobW   = 0;
let _prevBlobH   = 0;
let _motionCounter = 0;
let _copyProg = null; // lazy-compiled passthrough for capturing prev frames

// ---- Helpers ----

function hexToRgb01(hex, fallback = '#000000') {
  const safe = (typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)) ? hex : fallback;
  return [
    parseInt(safe.slice(1, 3), 16) / 255,
    parseInt(safe.slice(3, 5), 16) / 255,
    parseInt(safe.slice(5, 7), 16) / 255,
  ];
}

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

const COPY_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
out vec4 fragColor;
void main(){ fragColor = texture(u_video, vUV); }`;

// After any structure stage: blend the raw structure mask (u_struct) with the
// source video (u_video = _tex), then apply the output mode.
// Mirrors FRAG_STRUCT_MODE in glFilters.js so blob and synth look identical.
const FRAG_BLOB_STRUCT_BLEND = `#version 300 es
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
  float s      = clamp(texture(u_struct, vUV).r, 0.0, 1.0);
  vec3  src    = texture(u_video, vUV).rgb;
  float srcLum = max(luma(src), 0.001);
  float tgt    = mix(srcLum, s, 0.55);
  vec3  blended = clamp(src * (tgt / srcLum), 0.0, 1.0);
  float bLum   = luma(blended);
  vec3  col;
  if      (uOutputMode < 0.5) col = vec3(bLum);
  else if (uOutputMode < 1.5) col = blended;
  else if (uOutputMode < 2.5) col = mix(uInkLow, uInkHigh, smoothstep(0.42, 0.58, bLum));
  else                        col = 1.0 - blended;
  fragColor = vec4(col, 1.0);
}`;

let _structBlendProg = null;
let _structBlendU    = null;

function runBlobStructBlend(w, h, structTex, outputMode, inkLow, inkHigh, outputFBO) {
  const gl = _gl;
  if (!_structBlendProg) {
    _structBlendProg = createProgram(gl, VERT, FRAG_BLOB_STRUCT_BLEND);
    _structBlendU = {
      video:  gl.getUniformLocation(_structBlendProg, 'u_video'),
      struct: gl.getUniformLocation(_structBlendProg, 'u_struct'),
      mode:   gl.getUniformLocation(_structBlendProg, 'uOutputMode'),
      inkLo:  gl.getUniformLocation(_structBlendProg, 'uInkLow'),
      inkHi:  gl.getUniformLocation(_structBlendProg, 'uInkHigh'),
    };
  }
  const u = _structBlendU;
  gl.viewport(0, 0, w, h);
  gl.bindVertexArray(_vao);
  gl.bindFramebuffer(gl.FRAMEBUFFER, outputFBO ?? null);
  gl.useProgram(_structBlendProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, _tex);
  gl.uniform1i(u.video, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, structTex);
  gl.uniform1i(u.struct, 1);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1f(u.mode, outputMode ?? 1);
  if (inkLow)  gl.uniform3f(u.inkLo, inkLow[0],  inkLow[1],  inkLow[2]);
  if (inkHigh) gl.uniform3f(u.inkHi, inkHigh[0], inkHigh[1], inkHigh[2]);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('[glBlobPipeline] shader error:', gl.getShaderInfoLog(s));
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
    console.error('[glBlobPipeline] link error:', gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

function ensureBlobContext() {
  if (_gl) return true;
  _canvas = document.createElement('canvas');
  _canvas.width = 256; _canvas.height = 256;
  _gl = _canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: true });
  if (!_gl) { console.warn('[glBlobPipeline] WebGL2 not available'); return false; }

  const gl = _gl;
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  // Fullscreen quad VAO — same pattern as glContext.js
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  _vao = gl.createVertexArray();
  gl.bindVertexArray(_vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // Video texture
  _tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, _tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return true;
}

function getProgram(name) {
  if (_programs[name]) return _programs[name];
  const gl = _gl;
  const fSrc = BLOB_STRUCT_FRAG_OVERRIDES[name] || FRAGS[name];
  if (!fSrc) return null;
  const prog = createProgram(gl, VERT, fSrc);
  if (!prog) return null;
  const entry = {
    prog,
    video:      gl.getUniformLocation(prog, 'u_video'),
    prev:       gl.getUniformLocation(prog, 'u_prev'),
    params:     gl.getUniformLocation(prog, 'uParams'),
    param4:     gl.getUniformLocation(prog, 'uParam4'),
    edgeThresh: gl.getUniformLocation(prog, 'uEdgeThreshold'),
    uPalette:   gl.getUniformLocation(prog, 'uPalette'),
    uTime:      gl.getUniformLocation(prog, 'uTime'),
    outputMode: gl.getUniformLocation(prog, 'uOutputMode'),
    inkLow:     gl.getUniformLocation(prog, 'uInkLow'),
    inkHigh:    gl.getUniformLocation(prog, 'uInkHigh'),
    stops:      [0,1,2,3].map((i) => gl.getUniformLocation(prog, `uStop${i}`)),
  };
  _programs[name] = entry;
  return entry;
}

function ensurePrevBlobTex(w, h) {
  if (_prevBlobTex && _prevBlobW === w && _prevBlobH === h) return;
  const gl = _gl;
  if (_prevBlobFB)  gl.deleteFramebuffer(_prevBlobFB);
  if (_prevBlobTex) gl.deleteTexture(_prevBlobTex);
  const fbo = makeChainFBO(gl, w, h);
  _prevBlobFB = fbo.fb;
  _prevBlobTex = fbo.tex;
  _prevBlobW = w;
  _prevBlobH = h;
}

function ensureCopyProg() {
  if (_copyProg) return;
  const gl = _gl;
  const prog = createProgram(gl, VERT, COPY_FRAG);
  _copyProg = { prog, video: gl.getUniformLocation(prog, 'u_video') };
}

function capturePrevBlobTex(w, h) {
  ensurePrevBlobTex(w, h);
  ensureCopyProg();
  const gl = _gl;
  gl.viewport(0, 0, w, h);
  gl.bindVertexArray(_vao);
  gl.bindFramebuffer(gl.FRAMEBUFFER, _prevBlobFB);
  gl.useProgram(_copyProg.prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, _tex);
  gl.uniform1i(_copyProg.video, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function uploadBlobTexture(canvas2d) {
  const gl = _gl;
  gl.bindTexture(gl.TEXTURE_2D, _tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas2d);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

function ensureChain(w, h) {
  const gl = _gl;
  if (_chain && _chain.w === w && _chain.h === h) return _chain;
  if (_chain) {
    gl.deleteTexture(_chain.a.tex); gl.deleteFramebuffer(_chain.a.fb);
    gl.deleteTexture(_chain.b.tex); gl.deleteFramebuffer(_chain.b.fb);
  }
  _chain = { a: makeChainFBO(gl, w, h), b: makeChainFBO(gl, w, h), w, h };
  return _chain;
}

function runEffect(name, w, h, params, opts = {}) {
  if (!FRAGS[name] && !BLOB_STRUCT_FRAG_OVERRIDES[name]) return;
  const gl = _gl;
  const entry = getProgram(name);
  if (!entry) return;

  const inTex = opts.inputTex || _tex;
  const outFB = opts.outputFBO ?? null;

  gl.viewport(0, 0, w, h);
  gl.bindVertexArray(_vao);
  gl.bindFramebuffer(gl.FRAMEBUFFER, outFB);
  gl.useProgram(entry.prog);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, inTex);
  gl.uniform1i(entry.video, 0);

  // u_prev: use opts.prevTex if supplied (motionedge rate knob), else current.
  if (entry.prev != null) {
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, opts.prevTex ?? _tex);
    gl.uniform1i(entry.prev, 2);
    gl.activeTexture(gl.TEXTURE0);
  }

  gl.uniform4f(entry.params, params[0] ?? 0, params[1] ?? 0, params[2] ?? 0, params[3] ?? 0);
  if (entry.param4 != null && params[4] !== undefined) gl.uniform1f(entry.param4, params[4]);
  if (entry.edgeThresh != null) gl.uniform1f(entry.edgeThresh, params[4] ?? 0);
  if (entry.uPalette != null && params[5] !== undefined) gl.uniform1i(entry.uPalette, Math.round(params[5]));
  if (entry.uTime != null) gl.uniform1f(entry.uTime, performance.now() / 1000);
  if (entry.outputMode != null) gl.uniform1f(entry.outputMode, opts.outputMode ?? 0);
  if (entry.inkLow != null && entry.inkHigh != null) {
    const lo = opts.inkLow  ?? [0.04, 0.035, 0.03];
    const hi = opts.inkHigh ?? [0.92, 0.88, 0.78];
    gl.uniform3f(entry.inkLow,  lo[0], lo[1], lo[2]);
    gl.uniform3f(entry.inkHigh, hi[0], hi[1], hi[2]);
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

// ---- Feedback FX helpers ----

function getFxBlobProgram(name) {
  if (_fxBlobPrograms[name]) return _fxBlobPrograms[name];
  const gl = _gl;
  const fSrc = FX_FRAGS[name];
  if (!fSrc) return null;
  const prog = createProgram(gl, VERT, fSrc);
  if (!prog) return null;
  const entry = {
    prog,
    video:    gl.getUniformLocation(prog, 'u_video'),
    feedback: gl.getUniformLocation(prog, 'u_feedback'),
    params:   gl.getUniformLocation(prog, 'uParams'),
    param4:   gl.getUniformLocation(prog, 'uParam4'),
    time:     gl.getUniformLocation(prog, 'uTime'),
  };
  _fxBlobPrograms[name] = entry;
  return entry;
}

function getBlobFeedbackPair(key, w, h) {
  const gl = _gl;
  let entry = _blobFeedback.get(key);
  if (entry && (entry.w !== w || entry.h !== h)) {
    gl.deleteTexture(entry.read.tex);  gl.deleteFramebuffer(entry.read.fb);
    gl.deleteTexture(entry.write.tex); gl.deleteFramebuffer(entry.write.fb);
    entry = null;
  }
  if (!entry) {
    entry = { read: makeChainFBO(gl, w, h), write: makeChainFBO(gl, w, h), w, h };
    _blobFeedback.set(key, entry);
  }
  return entry;
}

function runFeedbackEffect(name, slotKey, w, h, params, opts = {}) {
  ensureCopyProg();
  const gl = _gl;
  const entry = getFxBlobProgram(name);
  if (!entry) return;

  const inTex = opts.inputTex || _tex;
  const outFB = opts.outputFBO ?? null;
  const pair  = getBlobFeedbackPair(slotKey, w, h);

  gl.viewport(0, 0, w, h);
  gl.bindVertexArray(_vao);

  // Pass 1 — effect: reads chain input + previous feedback, writes new state
  gl.bindFramebuffer(gl.FRAMEBUFFER, pair.write.fb);
  gl.useProgram(entry.prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, inTex);
  gl.uniform1i(entry.video, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, pair.read.tex);
  gl.uniform1i(entry.feedback, 1);
  gl.uniform4f(entry.params, params[0] ?? 0, params[1] ?? 0, params[2] ?? 0, params[3] ?? 0);
  if (entry.param4 != null && params[4] !== undefined) gl.uniform1f(entry.param4, params[4]);
  if (entry.time != null) gl.uniform1f(entry.time, performance.now() / 1000);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Pass 2 — copy new state to chain output
  gl.bindFramebuffer(gl.FRAMEBUFFER, outFB);
  gl.useProgram(_copyProg.prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, pair.write.tex);
  gl.uniform1i(_copyProg.video, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Swap ping-pong: this frame's output becomes next frame's u_feedback
  const t = pair.read;
  pair.read = pair.write;
  pair.write = t;
}

// ---- Public API ----

/**
 * Process one blob region through the blob synth pipeline and composite
 * onto displayCtx at (bx, by, bw, bh).
 * presence (0–1) is applied as globalAlpha so lingering/decaying blobs
 * fade out their synth output naturally.
 */
export function runBlobFrame(srcEl, bx, by, bw, bh, blobPipe, displayCtx, displayW, displayH, presence = 1, skipComposite = false) {
  if (!ensureBlobContext()) return;

  // Crop blob region from srcEl into the crop canvas.
  // bx/by/bw/bh are in display canvas space; srcEl may have different natural
  // dimensions (e.g. video at 1920×1080 displayed at 800×450), so we scale the
  // source crop rectangle to srcEl's coordinate space before calling drawImage.
  if (!_cropCanvas) {
    _cropCanvas = document.createElement('canvas');
    _cropCtx = _cropCanvas.getContext('2d');
  }
  if (_cropCanvas.width !== bw) _cropCanvas.width = bw;
  if (_cropCanvas.height !== bh) _cropCanvas.height = bh;
  const srcW = srcEl.videoWidth  || srcEl.naturalWidth  || srcEl.width  || displayW;
  const srcH = srcEl.videoHeight || srcEl.naturalHeight || srcEl.height || displayH;
  const sx   = srcW / displayW;
  const sy   = srcH / displayH;
  _cropCtx.drawImage(srcEl, bx * sx, by * sy, bw * sx, bh * sy, 0, 0, bw, bh);

  // Resize GL canvas to match blob bbox (tiny, cheap)
  if (_canvas.width !== bw) _canvas.width = bw;
  if (_canvas.height !== bh) _canvas.height = bh;

  uploadBlobTexture(_cropCanvas);
  const chain = ensureChain(bw, bh);

  // Resolve pipeline into chained stages
  const { structure, structureParams, structureOutputMode, colorIsoParams,
          inkLow, inkHigh, color, grade, fx, composite } = blobPipe;

  // Compute prev texture for motionedge rate knob (structureParams[4] = frame gap).
  // On first use or size change, seed prev with current frame (diff=0). After each
  // draw, increment counter; when counter reaches frameGap, capture current into
  // prev and reset — giving diffs of 1..frameGap frames that cycle over time.
  let motionPrevTex = null;
  if (structure === 'motionedge') {
    const frameGap = Math.round(structureParams[4] ?? 0);
    if (frameGap > 0) {
      if (!_prevBlobTex || _prevBlobW !== bw || _prevBlobH !== bh) {
        capturePrevBlobTex(bw, bh);
        _motionCounter = 0;
      }
      motionPrevTex = _prevBlobTex;
    }
  }

  const structOpts = {
    outputMode: structureOutputMode,
    inkLow, inkHigh,
    ...(motionPrevTex ? { prevTex: motionPrevTex } : {}),
  };

  // Build the chained post-structure stages
  const chained = [];
  if (color) {
    chained.push({
      type: color.type,
      run: (opts) => {
        const schema = COLOR_PARAM_SCHEMAS[color.type];
        if (!schema) return;
        const tuple = schema.order.map((k) => {
          const v = Number(color.params[k]);
          return Number.isFinite(v) ? v : 0;
        });
        while (tuple.length < 4) tuple.push(0);
        // Mirror main.js runColorEffect packing for okdrift: blackStops*100 + N*10 + relType.
        if (color.type === 'okdrift') {
          const nStops     = Math.max(4, Math.min(10, Math.round(tuple[4] || 6)));
          const relType    = Math.max(0, Math.min(9,  Math.round(Number(color.params.relType)    || 0)));
          const blackStops = Math.max(0, Math.min(4,  Math.round(Number(color.params.blackStops) || 0)));
          tuple[4] = blackStops * 100 + nStops * 10 + relType;
        }
        const runOpts = { ...opts };
        if (schema.colors) {
          runOpts.stops = schema.colors.map((c) => hexToRgb01(color.params[c.key], c.default));
        }
        runEffect(color.type, bw, bh, tuple, runOpts);
      },
    });
  }
  if (grade) {
    chained.push({
      type: 'grade',
      run: (opts) => runEffect('grade', bw, bh, [grade.hue, grade.sat, grade.hueRange ?? 0, grade.hueRate ?? 0], opts),
    });
  }
  for (const f of (fx || [])) {
    chained.push({
      type: f.type,
      run: (opts) => {
        const schema = FX_PARAM_SCHEMAS[f.type];
        if (!schema) return;
        const tuple = schema.order.map((k) => {
          const v = Number(f.params[k]);
          return Number.isFinite(v) ? v : 0;
        });
        while (tuple.length < 4) tuple.push(0);
        if (schema.feedback) {
          runFeedbackEffect(f.type, f.id ?? f.type, bw, bh, tuple, opts);
        } else {
          runEffect(f.type, bw, bh, tuple, opts);
        }
      },
    });
  }

  // When structure is set: output mode is applied POST-structure via runBlobStructBlend
  // (which mirrors the synth's applyStructureMode). When structure is absent: output mode
  // runs as a pre-pass on the raw source.
  // Mode 4 (colorisolation): coloriso filter runs first, then structure reads its output as inputTex.
  const isColorIso = (structureOutputMode ?? 0) === 4;
  const hasOutputMode = isColorIso || ((structureOutputMode ?? 0) !== 1);
  // coloriso never uses the single-stage path — it always needs at least 2 FBO ops.
  const hasOutputModeNoStruct = !isColorIso && hasOutputMode && !structure;
  // coloriso with structure: +1 for the pre-pass.  coloriso without structure: +2 (pre-pass + blend).
  const colorIsoExtra = isColorIso ? (structure ? 1 : 2) : 0;
  const totalStages = (hasOutputModeNoStruct ? 1 : 0) + (structure ? 2 : 0) + colorIsoExtra + chained.length;
  if (totalStages === 0) return;

  const gl = _gl;

  if (totalStages === 1) {
    // Only possible case: no structure, hasOutputMode alone, no chained
    if (hasOutputModeNoStruct) {
      runEffect('_blobOutputMode', bw, bh, [0, 0, 0, 0, 0], { ...structOpts });
    } else {
      chained[0].run({});
    }
  } else {
    let currentTex = null;
    let writeIdx = 0;
    const writeFBOs = [chain.a.fb, chain.b.fb];
    const readTexs  = [chain.a.tex, chain.b.tex];

    // Pre-pass output mode — only when no structure (otherwise output mode is
    // embedded in the post-structure runBlobStructBlend call below).
    if (hasOutputModeNoStruct) {
      runEffect('_blobOutputMode', bw, bh, [0, 0, 0, 0, 0], { ...structOpts, outputFBO: writeFBOs[writeIdx] });
      currentTex = readTexs[writeIdx];
      writeIdx ^= 1;
    }

    // ColorIso pre-pass: filter source by hue before structure runs.
    let colorIsoTex = null;
    if (isColorIso) {
      const params = colorIsoParams || [0.5, 0.5, 0.9, 0];
      runEffect('colorisolation', bw, bh, params, { outputFBO: writeFBOs[writeIdx] });
      colorIsoTex = readTexs[writeIdx];
      writeIdx ^= 1;
    }

    if (structure) {
      // Stage 1: run structure effect. If coloriso, feed coloriso output as inputTex.
      const structRunOpts = colorIsoTex
        ? { ...structOpts, inputTex: colorIsoTex, outputFBO: writeFBOs[writeIdx] }
        : { ...structOpts, outputFBO: writeFBOs[writeIdx] };
      runEffect(structure, bw, bh, structureParams, structRunOpts);
      const structTex = readTexs[writeIdx];
      writeIdx ^= 1;

      // Stage 2: source-blend + output mode (mirrors synth's applyStructureMode).
      // ColorIso forces source (1) — blends structure result with original video, preserving color.
      const blendMode = isColorIso ? 1 : structureOutputMode;
      const isStructLast = chained.length === 0;
      runBlobStructBlend(bw, bh, structTex, blendMode, inkLow, inkHigh,
        isStructLast ? null : writeFBOs[writeIdx]);
      if (!isStructLast) {
        currentTex = readTexs[writeIdx];
        writeIdx ^= 1;
      }
    } else if (isColorIso && colorIsoTex) {
      // ColorIso with no structure: blend the coloriso mask as source (1) to preserve video color.
      const isLast = chained.length === 0;
      runBlobStructBlend(bw, bh, colorIsoTex, 1, inkLow, inkHigh,
        isLast ? null : writeFBOs[writeIdx]);
      if (!isLast) {
        currentTex = readTexs[writeIdx];
        writeIdx ^= 1;
      }
    }

    for (let i = 0; i < chained.length; i++) {
      const isLast = (i === chained.length - 1);
      const outFB  = isLast ? null : writeFBOs[writeIdx];
      const opts   = currentTex ? { inputTex: currentTex, outputFBO: outFB }
                                : { outputFBO: outFB };
      chained[i].run(opts);
      if (!isLast) {
        currentTex = readTexs[writeIdx];
        writeIdx ^= 1;
      }
    }
  }

  // Advance motionedge frame-gap counter; capture prev when interval elapsed.
  if (structure === 'motionedge' && motionPrevTex) {
    _motionCounter++;
    if (_motionCounter >= Math.round(structureParams[4] ?? 0)) {
      capturePrevBlobTex(bw, bh);
      _motionCounter = 0;
    }
  }

  // Composite blob GL output onto display canvas at blob position.
  // globalAlpha = presence so decaying blobs fade out their synth output.
  if (!skipComposite) {
    displayCtx.save();
    displayCtx.globalCompositeOperation = composite || 'source-over';
    displayCtx.globalAlpha = Math.max(0, Math.min(1, presence));
    displayCtx.drawImage(_canvas, 0, 0, bw, bh, bx, by, bw, bh);
    displayCtx.restore();
  }
}

/**
 * Collect all eligible blob crops onto a single full-size canvas, then run
 * the blob LumiSynth pipeline ONCE and composite the result onto displayCtx.
 *
 * blobs must already be filtered to eligible entries (presence >= 0.02,
 * valid size). Each blob's presence is baked in as opacity when stamping
 * the crop so the pipeline receives naturally weighted content.
 */
export function runBlobsFrame(srcEl, blobs, blobPipe, displayCtx, cw, ch) {
  if (!blobs.length) return;

  // ── Layer 1: mask canvas ──────────────────────────────────────────────────
  // Each blob drawn as a filled white rectangle, opacity = blob.presence.
  // presence is already the temporally-smoothed attack/release envelope, so
  // blobs fade in on detection and fade out when lost — no spatial blur needed.
  if (!_maskCanvas) {
    _maskCanvas = document.createElement('canvas');
    _maskCtx    = _maskCanvas.getContext('2d', { alpha: true });
  }
  if (_maskCanvas.width !== cw || _maskCanvas.height !== ch) {
    _maskCanvas.width  = cw;
    _maskCanvas.height = ch;
  } else {
    _maskCtx.clearRect(0, 0, cw, ch);
  }
  _maskCtx.fillStyle = '#fff';
  for (const blob of blobs) {
    const bx = Math.max(0, Math.floor(blob.cx - blob.w / 2));
    const by = Math.max(0, Math.floor(blob.cy - blob.h / 2));
    const bw = Math.min(cw - bx, Math.ceil(blob.w));
    const bh = Math.min(ch - by, Math.ceil(blob.h));
    if (bw < 8 || bh < 8) continue;
    _maskCtx.globalAlpha = Math.max(0, Math.min(1, blob.presence ?? 1));
    _maskCtx.fillRect(bx, by, bw, bh);
  }
  _maskCtx.globalAlpha = 1;

  // ── Layer 2: GL pipeline on the full source frame ─────────────────────────
  // Shaders receive real video content — no transparent gaps, no garbage output.
  runBlobFrame(srcEl, 0, 0, cw, ch, blobPipe, null, cw, ch, 1, true);

  // ── Layer 3: mask the GL output and composite onto display ────────────────
  // Draw GL output onto comp canvas, punch out non-blob areas with destination-in
  // (keeps only pixels where the mask is non-transparent), then source-over display.
  if (!_compCanvas) {
    _compCanvas = document.createElement('canvas');
    _compCtx    = _compCanvas.getContext('2d', { alpha: true });
  }
  if (_compCanvas.width !== cw || _compCanvas.height !== ch) {
    _compCanvas.width  = cw;
    _compCanvas.height = ch;
  } else {
    _compCtx.clearRect(0, 0, cw, ch);
  }
  _compCtx.drawImage(_canvas, 0, 0);
  _compCtx.globalCompositeOperation = 'destination-in';
  _compCtx.drawImage(_maskCanvas, 0, 0);
  _compCtx.globalCompositeOperation = 'source-over';

  displayCtx.save();
  displayCtx.globalCompositeOperation = blobPipe.composite || 'source-over';
  displayCtx.drawImage(_compCanvas, 0, 0);
  displayCtx.restore();
}

/**
 * Drop blob feedback state so trails restart from black.
 * Pass a slot id to reset only that slot (type swap / clear).
 * Call without args on source change or timeline segment change.
 */
export function resetBlobFeedback(key) {
  if (!_gl) return;
  const gl = _gl;
  if (key !== undefined) {
    const entry = _blobFeedback.get(key);
    if (entry) {
      gl.deleteTexture(entry.read.tex);  gl.deleteFramebuffer(entry.read.fb);
      gl.deleteTexture(entry.write.tex); gl.deleteFramebuffer(entry.write.fb);
    }
    _blobFeedback.delete(key);
    return;
  }
  for (const entry of _blobFeedback.values()) {
    gl.deleteTexture(entry.read.tex);  gl.deleteFramebuffer(entry.read.fb);
    gl.deleteTexture(entry.write.tex); gl.deleteFramebuffer(entry.write.fb);
  }
  _blobFeedback.clear();
}

export function disposeBlobPipeline() {
  if (!_gl) return;
  if (_chain) {
    _gl.deleteTexture(_chain.a.tex); _gl.deleteFramebuffer(_chain.a.fb);
    _gl.deleteTexture(_chain.b.tex); _gl.deleteFramebuffer(_chain.b.fb);
    _chain = null;
  }
  resetBlobFeedback();
  // Programs, VAO, and video texture stay alive for reuse until page unload.
  if (_prevBlobFB)  { _gl.deleteFramebuffer(_prevBlobFB);  _prevBlobFB = null; }
  if (_prevBlobTex) { _gl.deleteTexture(_prevBlobTex);     _prevBlobTex = null; }
  _maskCanvas = null; _maskCtx = null;
  _compCanvas = null; _compCtx = null;
  _prevBlobW = 0; _prevBlobH = 0; _motionCounter = 0;
}
