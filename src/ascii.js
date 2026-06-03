/**
 * ASCII Luma — ported from TouchDesigner GLSL.
 * Single-pass stateless effect: no ping-pong needed.
 * Renders video as 5x7 bitmap-font ASCII characters by luminance density.
 */

import { ensureContext, getGL, getVideoTex } from './glContext.js';

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 vUV;
void main() {
  vUV = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// uParams: x=CellSize, y=Contrast, z=BlackThreshold, w=GlyphStrength
const ASCII_FRAG = `#version 300 es
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
  float poster = smoothstep(0.42, 0.58, structure);
  return mix(uInkLow, uInkHigh, poster);
}

float luma(vec3 rgb) {
  return dot(rgb, vec3(0.2126, 0.7152, 0.0722));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

int densityGlyph(float tone, float detail, vec2 cellID) {
  float jitter = (hash12(cellID) - 0.5) * mix(0.08, 0.18, clamp(1.0 - detail * 4.0, 0.0, 1.0));
  float t = clamp(tone + detail * 0.32 + jitter, 0.0, 1.0);
  return clamp(int(floor(t * 25.99)), 0, 25);
}

bool pix(int c, int cx, int cy) {
  if (cx < 0 || cx > 4 || cy < 0 || cy > 6) return false;
  int b = 4 - cx;
  int row = 0;
  if (c == 0)  { if (cy==6) row=0x04; } // .
  else if (c == 1)  { if (cy==2) row=0x04; else if (cy==5) row=0x04; } // :
  else if (c == 2)  { if (cy==3) row=0x0E; } // -
  else if (c == 3)  { if (cy==3) row=0x1F; } // =
  else if (c == 4)  { if (cy==1) row=0x04; else if (cy==2) row=0x04; else if (cy==3) row=0x1F; else if (cy==4) row=0x04; else if (cy==5) row=0x04; } // +
  else if (c == 5)  { if (cy==1) row=0x11; else if (cy==2) row=0x0A; else if (cy==3) row=0x04; else if (cy==4) row=0x0A; else if (cy==5) row=0x11; } // x
  else if (c == 6)  { if (cy==1) row=0x04; else if (cy==2) row=0x15; else if (cy==3) row=0x0E; else if (cy==4) row=0x15; else if (cy==5) row=0x04; } // *
  else if (c == 7)  { if (cy==2) row=0x0E; else if (cy==3) row=0x11; else if (cy==4) row=0x11; else if (cy==5) row=0x0E; } // o
  else if (c == 8)  { if (cy==2) row=0x0F; else if (cy==3) row=0x10; else if (cy==4) row=0x10; else if (cy==5) row=0x0F; } // c
  else if (c == 9)  { if (cy==1) row=0x11; else if (cy==2) row=0x11; else if (cy==3) row=0x0A; else if (cy==4) row=0x0A; else if (cy==5) row=0x04; } // v
  else if (c == 10) { if (cy==1) row=0x11; else if (cy==2) row=0x0A; else if (cy==3) row=0x04; else if (cy==4) row=0x0A; else if (cy==5) row=0x11; } // X
  else if (c == 11) { if (cy==1) row=0x0F; else if (cy==2) row=0x10; else if (cy==3) row=0x0E; else if (cy==4) row=0x01; else if (cy==5) row=0x1E; } // s
  else if (c == 12) { if (cy==1) row=0x1F; else if (cy==2) row=0x02; else if (cy==3) row=0x04; else if (cy==4) row=0x08; else if (cy==5) row=0x1F; } // z
  else if (c == 13) { if (cy==1) row=0x1E; else if (cy==2) row=0x11; else if (cy==3) row=0x11; else if (cy==4) row=0x11; else if (cy==5) row=0x11; } // n
  else if (c == 14) { if (cy==1) row=0x11; else if (cy==2) row=0x11; else if (cy==3) row=0x11; else if (cy==4) row=0x13; else if (cy==5) row=0x0D; } // u
  else if (c == 15) { if (cy==1) row=0x0E; else if (cy==2) row=0x01; else if (cy==3) row=0x0F; else if (cy==4) row=0x11; else if (cy==5) row=0x0F; } // a
  else if (c == 16) { if (cy==1) row=0x0E; else if (cy==2) row=0x11; else if (cy==3) row=0x1F; else if (cy==4) row=0x10; else if (cy==5) row=0x0E; } // e
  else if (c == 17) { if (cy==0) row=0x10; else if (cy==1) row=0x10; else if (cy==2) row=0x1E; else if (cy==3) row=0x11; else if (cy==4) row=0x11; else if (cy==5) row=0x11; else if (cy==6) row=0x11; } // h
  else if (c == 18) { if (cy==1) row=0x1B; else if (cy==2) row=0x15; else if (cy==3) row=0x15; else if (cy==4) row=0x15; else if (cy==5) row=0x15; } // m
  else if (c == 19) { if (cy==0) row=0x11; else if (cy==1) row=0x11; else if (cy==2) row=0x11; else if (cy==3) row=0x15; else if (cy==4) row=0x15; else if (cy==5) row=0x15; else if (cy==6) row=0x0A; } // w
  else if (c == 20) { if (cy==0) row=0x0E; else if (cy==1) row=0x11; else if (cy==2) row=0x11; else if (cy==3) row=0x0E; else if (cy==4) row=0x11; else if (cy==5) row=0x11; else if (cy==6) row=0x0E; } // 8
  else if (c == 21) { if (cy==0) row=0x0E; else if (cy==1) row=0x11; else if (cy==2) row=0x13; else if (cy==3) row=0x15; else if (cy==4) row=0x19; else if (cy==5) row=0x11; else if (cy==6) row=0x0E; } // 0
  else if (c == 22) { if (cy==0) row=0x0E; else if (cy==1) row=0x11; else if (cy==2) row=0x17; else if (cy==3) row=0x15; else if (cy==4) row=0x17; else if (cy==5) row=0x10; else if (cy==6) row=0x0F; } // @
  else if (c == 23) { if (cy==0) row=0x0A; else if (cy==1) row=0x1F; else if (cy==2) row=0x0A; else if (cy==3) row=0x0A; else if (cy==4) row=0x1F; else if (cy==5) row=0x0A; else if (cy==6) row=0x0A; } // #
  else if (c == 24) { if (cy==0) row=0x19; else if (cy==1) row=0x1A; else if (cy==2) row=0x04; else if (cy==3) row=0x04; else if (cy==4) row=0x0B; else if (cy==5) row=0x13; } // %
  else if (c == 25) { row=0x1F; } // dense
  return ((row >> b) & 1) == 1;
}

void main() {
  vec2 res     = vec2(textureSize(u_video, 0));
  float cellPx = mix(10.0, 32.0, uParams.x);

  vec2 pixCoord   = vUV * res;
  vec2 cellID     = floor(pixCoord / cellPx);
  vec2 cellOrigin = cellID * cellPx;
  vec2 cellCenter = (cellID + 0.5) * cellPx / res;
  vec2 inCell     = pixCoord - cellOrigin;

  vec2 cellStep = vec2(cellPx) / res;
  float center = luma(texture(u_video, cellCenter).rgb);
  float left   = luma(texture(u_video, cellCenter + vec2(-0.35,  0.0) * cellStep).rgb);
  float right  = luma(texture(u_video, cellCenter + vec2( 0.35,  0.0) * cellStep).rgb);
  float up     = luma(texture(u_video, cellCenter + vec2( 0.0, -0.35) * cellStep).rgb);
  float down   = luma(texture(u_video, cellCenter + vec2( 0.0,  0.35) * cellStep).rgb);
  float avg    = (center + left + right + up + down) * 0.2;
  float detail = max(max(abs(left - right), abs(up - down)), abs(center - avg));
  float val = avg;
  vec3 src = texture(u_video, vUV).rgb;

  float blackCutoff = uParams.z * 0.4;
  if (val < blackCutoff) {
    fragColor = vec4(applyStructureOutput(0.0, src, uOutputMode), 1.0);
    return;
  }

  float adj = clamp((val - blackCutoff) / max(1.0 - blackCutoff, 0.01), 0.0, 1.0);
  if (uParams.y > 0.01) {
    float c = mix(1.0, 4.0, uParams.y);
    adj = clamp((adj - 0.5) * c + 0.5, 0.0, 1.0);
  }

  int gid = densityGlyph(adj, detail, cellID);

  float padding    = cellPx * 0.08;
  float charAreaH  = cellPx - padding * 2.0;
  float charPxSize = charAreaH / 7.0;
  float charWidth  = charPxSize * 5.0;
  float xOffset    = (cellPx - charWidth) * 0.5;

  int gx = int(floor((inCell.x - xOffset) / charPxSize));
  int gy = int(floor((inCell.y - padding) / charPxSize));

  float glyph      = pix(gid, gx, gy) ? 1.0 : 0.0;
  float glyphBrite = glyph * mix(0.55, 1.0, clamp(val + detail * 1.5, 0.0, 1.0));
  float blockTone  = clamp(val + detail * 0.5, 0.0, 1.0);
  float result     = mix(blockTone, glyphBrite, uParams.w);

  fragColor = vec4(applyStructureOutput(result, src, uOutputMode), 1.0);
}`;

// ---- WebGL helpers ----

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('[ASCII] shader:', gl.getShaderInfoLog(s));
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
    console.error('[ASCII] link:', gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

// ---- Module state ----

// Effect-specific state only. GL context, canvas, video texture, and
// fullscreen-quad VAO live in glContext.js. Note: the shared video texture
// uses LINEAR filtering (the choice for voronoi/cellular/wave). ASCII used
// to use NEAREST on its private texture; the shader samples at sub-texel
// cell centers so this swap turns the per-cell luma sample into a small
// bilinear average instead of a snapped texel. Visually subtle; arguably
// slightly less aliased.
let M = null;

function initProgram() {
  const gl = getGL();
  if (!gl) return null;
  const prog = createProgram(gl, VERT, ASCII_FRAG);
  if (!prog) return null;
  return {
    prog,
    u: {
      video:  gl.getUniformLocation(prog, 'u_video'),
      params: gl.getUniformLocation(prog, 'uParams'),
      outputMode: gl.getUniformLocation(prog, 'uOutputMode'),
      inkLow: gl.getUniformLocation(prog, 'uInkLow'),
      inkHigh: gl.getUniformLocation(prog, 'uInkHigh'),
    },
  };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLVideoElement}         video
 * @param {number} cw, ch
 * @param {object} params  { cellSize, contrast, blackThreshold, glyphStrength } all 0-1
 * @param {object} [opts]  { inputTex, outputFBO } — orchestrator chain hooks
 *                         (P2). inputTex defaults to the shared video tex;
 *                         outputFBO defaults to null (= shared GL canvas).
 *                         Per the orchestrator contract in glContext.js,
 *                         this function does NOT upload video or composite
 *                         to the 2D canvas — renderFrame owns both.
 */
export function applyASCII(cw, ch, params = {}, opts = {}) {
  const cellSize      = params.cellSize      ?? 0.3;
  const contrast      = params.contrast      ?? 0.3;
  const blackThresh   = params.blackThreshold ?? 0.2;
  const glyphStrength = params.glyphStrength  ?? 0.9;
  const outputMode    = params.outputMode     ?? 0;
  const inkLow        = params.inkLow         ?? [0.04, 0.035, 0.03];
  const inkHigh       = params.inkHigh        ?? [0.92, 0.88, 0.78];

  const S = ensureContext(cw, ch);
  if (!S) return;
  if (!M) {
    M = initProgram();
    if (!M) return;
  }

  const { gl, vao } = S;
  const { prog, u } = M;
  const inTex = opts.inputTex  || getVideoTex();
  const outFB = opts.outputFBO ?? null;

  gl.viewport(0, 0, cw, ch);
  gl.bindVertexArray(vao);
  gl.bindFramebuffer(gl.FRAMEBUFFER, outFB);

  gl.useProgram(prog);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, inTex); gl.uniform1i(u.video, 0);
  gl.uniform4f(u.params, cellSize, contrast, blackThresh, glyphStrength);
  gl.uniform1f(u.outputMode, outputMode);
  gl.uniform3f(u.inkLow, inkLow[0], inkLow[1], inkLow[2]);
  gl.uniform3f(u.inkHigh, inkHigh[0], inkHigh[1], inkHigh[2]);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
