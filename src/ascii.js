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
// uEdgeThreshold: 0=no edges, 1=maximum edge sensitivity
export const ASCII_FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
uniform float uEdgeThreshold;
uniform int uPalette;
out vec4 fragColor;

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
  // Edge characters (c=26..29): selected by Sobel gradient orientation
  else if (c == 26) { if (cy==5) row=0x1F; }   // _ underscore (horizontal edge)
  else if (c == 27) {                            // / forward slash (45° edge)
    if      (cy==0) row=0x01; else if (cy==1) row=0x02; else if (cy==2) row=0x02;
    else if (cy==3) row=0x04; else if (cy==4) row=0x08;
    else if (cy==5) row=0x08; else if (cy==6) row=0x10;
  }
  else if (c == 28) { row=0x04; }               // | vertical bar (vertical edge, all rows)
  else if (c == 29) {                            // \ backslash (135° edge)
    if      (cy==0) row=0x10; else if (cy==1) row=0x08; else if (cy==2) row=0x08;
    else if (cy==3) row=0x04; else if (cy==4) row=0x02;
    else if (cy==5) row=0x02; else if (cy==6) row=0x01;
  }
  // ---- Matrix palette glyphs (30–43) ----
  else if (c == 30) { if (cy==1) row=0x06; else if (cy==2) row=0x04; else if (cy==3) row=0x04; else if (cy==4) row=0x04; else if (cy==5) row=0x04; else if (cy==6) row=0x0E; } // 1
  else if (c == 31) { if (cy==1) row=0x1F; else if (cy==2) row=0x01; else if (cy==3) row=0x02; else if (cy==4) row=0x04; else if (cy==5) row=0x04; else if (cy==6) row=0x04; } // 7
  else if (c == 32) { if (cy==1) row=0x0E; else if (cy==2) row=0x11; else if (cy==3) row=0x01; else if (cy==4) row=0x02;                            else if (cy==6) row=0x04; } // ?
  else if (c == 33) {                            if (cy==1) row=0x02; else if (cy==2) row=0x04; else if (cy==3) row=0x08; else if (cy==4) row=0x04; else if (cy==5) row=0x02; } // <
  else if (c == 34) {                            if (cy==1) row=0x04; else if (cy==2) row=0x02; else if (cy==3) row=0x01; else if (cy==4) row=0x02; else if (cy==5) row=0x04; } // >
  else if (c == 35) { if (cy==0) row=0x0E; else if (cy==1) row=0x08; else if (cy==2) row=0x08; else if (cy==3) row=0x08; else if (cy==4) row=0x08; else if (cy==5) row=0x08; else if (cy==6) row=0x0E; } // [
  else if (c == 36) { if (cy==0) row=0x0E; else if (cy==1) row=0x02; else if (cy==2) row=0x02; else if (cy==3) row=0x02; else if (cy==4) row=0x02; else if (cy==5) row=0x02; else if (cy==6) row=0x0E; } // ]
  else if (c == 37) { if (cy==0) row=0x04; else if (cy==1) row=0x04; else if (cy==2) row=0x04; else if (cy==3) row=0x04; else if (cy==4) row=0x04;                            else if (cy==6) row=0x04; } // !
  else if (c == 38) { if (cy==1) row=0x0E; else if (cy==2) row=0x11; else if (cy==3) row=0x01; else if (cy==4) row=0x02; else if (cy==5) row=0x08; else if (cy==6) row=0x1F; } // 2
  else if (c == 39) { if (cy==1) row=0x0E; else if (cy==2) row=0x11; else if (cy==3) row=0x03; else if (cy==4) row=0x01; else if (cy==5) row=0x11; else if (cy==6) row=0x0E; } // 3
  else if (c == 40) { if (cy==1) row=0x02; else if (cy==2) row=0x06; else if (cy==3) row=0x0A; else if (cy==4) row=0x1F; else if (cy==5) row=0x02; else if (cy==6) row=0x02; } // 4
  else if (c == 41) { if (cy==1) row=0x1F; else if (cy==2) row=0x10; else if (cy==3) row=0x1E; else if (cy==4) row=0x01; else if (cy==5) row=0x11; else if (cy==6) row=0x0E; } // 5
  else if (c == 42) { if (cy==1) row=0x0E; else if (cy==2) row=0x10; else if (cy==3) row=0x1E; else if (cy==4) row=0x11; else if (cy==5) row=0x11; else if (cy==6) row=0x0E; } // 6
  else if (c == 43) { if (cy==1) row=0x0E; else if (cy==2) row=0x11; else if (cy==3) row=0x11; else if (cy==4) row=0x0F; else if (cy==5) row=0x01; else if (cy==6) row=0x0E; } // 9
  return ((row >> b) & 1) == 1;
}

int remapGlyph(int g, int p) {
  if (p == 0) return g;
  // Palette 1: Matrix — digits + bracket symbols, light→dense
  if (g ==  0) return  0;  if (g ==  1) return  1;  if (g ==  2) return 30;
  if (g ==  3) return 31;  if (g ==  4) return 32;  if (g ==  5) return 33;
  if (g ==  6) return 34;  if (g ==  7) return 35;  if (g ==  8) return 36;
  if (g ==  9) return 37;  if (g == 10) return 38;  if (g == 11) return 39;
  if (g == 12) return 40;  if (g == 13) return 41;  if (g == 14) return 42;
  if (g == 15) return 43;  if (g == 16) return 21;  if (g == 17) return 20;
  if (g == 18) return 23;  if (g == 19) return 22;  if (g == 20) return 24;
  return 25;
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

  // Sobel gradient at cell-center resolution for edge detection
  float s00 = luma(texture(u_video, cellCenter + vec2(-cellStep.x, -cellStep.y)).rgb);
  float s10 = luma(texture(u_video, cellCenter + vec2(        0.0, -cellStep.y)).rgb);
  float s20 = luma(texture(u_video, cellCenter + vec2( cellStep.x, -cellStep.y)).rgb);
  float s01 = luma(texture(u_video, cellCenter + vec2(-cellStep.x,         0.0)).rgb);
  float s21 = luma(texture(u_video, cellCenter + vec2( cellStep.x,         0.0)).rgb);
  float s02 = luma(texture(u_video, cellCenter + vec2(-cellStep.x,  cellStep.y)).rgb);
  float s12 = luma(texture(u_video, cellCenter + vec2(        0.0,  cellStep.y)).rgb);
  float s22 = luma(texture(u_video, cellCenter + vec2( cellStep.x,  cellStep.y)).rgb);
  float sobelX = -s00 + s20 - 2.0*s01 + 2.0*s21 - s02 + s22;
  float sobelY = -s00 - 2.0*s10 - s20 + s02 + 2.0*s12 + s22;
  float edgeMag = length(vec2(sobelX, sobelY));

  float blackCutoff = uParams.z * 0.8;
  if (val < blackCutoff) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float adj = clamp((val - blackCutoff) / max(1.0 - blackCutoff, 0.01), 0.0, 1.0);
  if (uParams.y > 0.01) {
    float c = mix(1.0, 4.0, uParams.y);
    adj = clamp((adj - 0.5) * c + 0.5, 0.0, 1.0);
  }

  int gid = remapGlyph(densityGlyph(adj, detail, cellID), uPalette);

  // Edge overlay: Sobel angle → pick edge character (_  /  |  \)
  // Gradient is perpendicular to the edge; fold to 0..PI to get orientation.
  // Bins: | vert [0,PI/8)∪(7PI/8,PI]  /  [PI/8,3PI/8)  _ [3PI/8,5PI/8)  \ [5PI/8,7PI/8)
  if (uEdgeThreshold > 0.001) {
    float edgeThresh = (1.0 - uEdgeThreshold) * 3.0 + 0.05;
    if (edgeMag > edgeThresh) {
      float ori = mod(atan(sobelY, sobelX) + 3.14159265, 3.14159265);
      if      (ori < 0.3927 || ori > 2.7489) gid = 28; // | vertical
      else if (ori < 1.1781)                  gid = 27; // / forward slash
      else if (ori < 1.9635)                  gid = 26; // _ horizontal
      else                                    gid = 29; // \ backslash
    }
  }

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

  fragColor = vec4(vec3(result), 1.0);
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
      video:         gl.getUniformLocation(prog, 'u_video'),
      params:        gl.getUniformLocation(prog, 'uParams'),
      edgeThreshold: gl.getUniformLocation(prog, 'uEdgeThreshold'),
      palette:       gl.getUniformLocation(prog, 'uPalette'),
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
  const edgeThreshold = params.edgeThreshold  ?? 0.0;

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
  const palette       = params.palette       ?? 0;

  gl.uniform4f(u.params, cellSize, contrast, blackThresh, glyphStrength);
  gl.uniform1f(u.edgeThreshold, edgeThreshold);
  gl.uniform1i(u.palette, palette);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
