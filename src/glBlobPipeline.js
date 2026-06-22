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
 *   runBlobFrame(srcEl, bx, by, bw, bh, blobPipe, displayCtx)
 *
 * blobPipe = {
 *   structure: string|null,          // effect name or null
 *   structureParams: number[],       // [p0..p3] or [p0..p4] for freqmod
 *   structureOutputMode: number,     // 0=mono 1=source 2=ink 3=invert
 *   inkLow: [r,g,b],
 *   inkHigh: [r,g,b],
 *   color: { type: string, params: object } | null,
 *   grade: { hue: number, sat: number } | null,
 *   fx: [ { type: string, params: object } ],  // stateless only
 *   composite: string,               // Canvas 2D globalCompositeOperation
 * }
 */

import { VERT, FRAGS, FRAG_EDGEDET_STRUCT } from './glFilters.js';

// Blob structure context: some effects share a name with FX RACK shaders that
// lack applyStructureOutput. Override them here so mono/source/ink/invert work.
const BLOB_STRUCT_FRAG_OVERRIDES = { edgedet: FRAG_EDGEDET_STRUCT };
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
  if (!FRAGS[name]) return;
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
 */
export function runBlobFrame(srcEl, bx, by, bw, bh, blobPipe, displayCtx, displayW, displayH) {
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
  const { structure, structureParams, structureOutputMode, inkLow, inkHigh,
          color, grade, fx, composite } = blobPipe;

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

  const totalStages = (structure ? 1 : 0) + chained.length;
  if (totalStages === 0) return;

  const gl = _gl;

  if (totalStages === 1) {
    // Single-stage fast path: render directly to GL canvas (outFB = null)
    if (structure) {
      runEffect(structure, bw, bh, structureParams, { ...structOpts });
    } else {
      chained[0].run({});
    }
  } else {
    // Multi-stage ping-pong through chain FBOs
    let currentTex = null;
    let writeIdx = 0;
    const writeFBOs = [chain.a.fb, chain.b.fb];
    const readTexs  = [chain.a.tex, chain.b.tex];

    if (structure) {
      runEffect(structure, bw, bh, structureParams, { ...structOpts, outputFBO: writeFBOs[writeIdx] });
      currentTex = readTexs[writeIdx];
      writeIdx ^= 1;
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

  // Composite blob GL output onto display canvas at blob position
  displayCtx.save();
  displayCtx.globalCompositeOperation = composite || 'source-over';
  displayCtx.drawImage(_canvas, 0, 0, bw, bh, bx, by, bw, bh);
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
  _prevBlobW = 0; _prevBlobH = 0; _motionCounter = 0;
}
