/**
 * ASCII Luma — ported from TouchDesigner GLSL.
 * Single-pass stateless effect: no ping-pong needed.
 * Renders video as 5x7 bitmap-font ASCII characters by luminance density.
 */

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
out vec4 fragColor;

bool pix(int c, int cx, int cy) {
  if (cx < 0 || cx > 4 || cy < 0 || cy > 6) return false;
  int b = 4 - cx;
  int row = 0;
  if (c == 0)  { if (cy==5) row=0x04; else if (cy==6) row=0x04; }
  else if (c == 1)  { if (cy==5) row=0x06; else if (cy==6) row=0x04; }
  else if (c == 2)  { if (cy==3) row=0x0E; }
  else if (c == 3)  { if (cy==2) row=0x0E; else if (cy==4) row=0x0E; }
  else if (c == 4)  { if (cy==2) row=0x04; else if (cy==3) row=0x0E; else if (cy==4) row=0x04; }
  else if (c == 5)  { if (cy==1) row=0x04; else if (cy==2) row=0x04; else if (cy==4) row=0x04; else if (cy==5) row=0x04; }
  else if (c == 6)  { if (cy==1) row=0x04; else if (cy==2) row=0x04; else if (cy==4) row=0x04; else if (cy==5) row=0x06; else if (cy==6) row=0x04; }
  else if (c == 7)  { if (cy==2) row=0x0E; else if (cy==3) row=0x10; else if (cy==4) row=0x10; else if (cy==5) row=0x10; else if (cy==6) row=0x0E; }
  else if (c == 8)  { if (cy==0) row=0x10; else if (cy==1) row=0x10; else if (cy==2) row=0x1C; else if (cy==3) row=0x12; else if (cy==4) row=0x12; else if (cy==5) row=0x12; else if (cy==6) row=0x1C; }
  else if (c == 9)  { if (cy==2) row=0x0E; else if (cy==3) row=0x01; else if (cy==4) row=0x0F; else if (cy==5) row=0x11; else if (cy==6) row=0x0F; }
  else if (c == 10) { if (cy==0) row=0x04; else if (cy==1) row=0x04; else if (cy==2) row=0x04; else if (cy==3) row=0x04; else if (cy==4) row=0x04; else if (cy==6) row=0x04; }
  else if (c == 11) { if (cy==0) row=0x0E; else if (cy==1) row=0x11; else if (cy==2) row=0x01; else if (cy==3) row=0x02; else if (cy==4) row=0x04; else if (cy==6) row=0x04; }
  else if (c == 12) { if (cy==0) row=0x0E; else if (cy==1) row=0x11; else if (cy==2) row=0x13; else if (cy==3) row=0x15; else if (cy==4) row=0x19; else if (cy==5) row=0x11; else if (cy==6) row=0x0E; }
  else if (c == 13) { if (cy==0) row=0x04; else if (cy==1) row=0x0C; else if (cy==2) row=0x04; else if (cy==3) row=0x04; else if (cy==4) row=0x04; else if (cy==5) row=0x04; else if (cy==6) row=0x0E; }
  else if (c == 14) { if (cy==0) row=0x0E; else if (cy==1) row=0x11; else if (cy==2) row=0x01; else if (cy==3) row=0x02; else if (cy==4) row=0x04; else if (cy==5) row=0x08; else if (cy==6) row=0x1F; }
  else if (c == 15) { if (cy==0) row=0x0E; else if (cy==1) row=0x11; else if (cy==2) row=0x01; else if (cy==3) row=0x06; else if (cy==4) row=0x01; else if (cy==5) row=0x11; else if (cy==6) row=0x0E; }
  else if (c == 16) { if (cy==0) row=0x02; else if (cy==1) row=0x06; else if (cy==2) row=0x0A; else if (cy==3) row=0x12; else if (cy==4) row=0x1F; else if (cy==5) row=0x02; else if (cy==6) row=0x02; }
  else if (c == 17) { if (cy==0) row=0x1F; else if (cy==1) row=0x10; else if (cy==2) row=0x1E; else if (cy==3) row=0x01; else if (cy==4) row=0x01; else if (cy==5) row=0x11; else if (cy==6) row=0x0E; }
  else if (c == 18) { if (cy==0) row=0x06; else if (cy==1) row=0x08; else if (cy==2) row=0x10; else if (cy==3) row=0x1E; else if (cy==4) row=0x11; else if (cy==5) row=0x11; else if (cy==6) row=0x0E; }
  else if (c == 19) { if (cy==0) row=0x1F; else if (cy==1) row=0x01; else if (cy==2) row=0x02; else if (cy==3) row=0x04; else if (cy==4) row=0x08; else if (cy==5) row=0x08; else if (cy==6) row=0x08; }
  else if (c == 20) { if (cy==0) row=0x0E; else if (cy==1) row=0x11; else if (cy==2) row=0x11; else if (cy==3) row=0x0E; else if (cy==4) row=0x11; else if (cy==5) row=0x11; else if (cy==6) row=0x0E; }
  else if (c == 21) { if (cy==0) row=0x0E; else if (cy==1) row=0x11; else if (cy==2) row=0x11; else if (cy==3) row=0x0F; else if (cy==4) row=0x01; else if (cy==5) row=0x02; else if (cy==6) row=0x0C; }
  else if (c == 22) { if (cy==0) row=0x04; else if (cy==1) row=0x0F; else if (cy==2) row=0x14; else if (cy==3) row=0x0E; else if (cy==4) row=0x05; else if (cy==5) row=0x1E; else if (cy==6) row=0x04; }
  else if (c == 23) { if (cy==0) row=0x11; else if (cy==1) row=0x11; else if (cy==2) row=0x11; else if (cy==3) row=0x11; else if (cy==4) row=0x15; else if (cy==5) row=0x15; else if (cy==6) row=0x0A; }
  else if (c == 24) { if (cy==0) row=0x0A; else if (cy==1) row=0x0A; else if (cy==2) row=0x1F; else if (cy==3) row=0x0A; else if (cy==4) row=0x1F; else if (cy==5) row=0x0A; else if (cy==6) row=0x0A; }
  else if (c == 25) { if (cy==0) row=0x0E; else if (cy==1) row=0x11; else if (cy==2) row=0x17; else if (cy==3) row=0x15; else if (cy==4) row=0x17; else if (cy==5) row=0x10; else if (cy==6) row=0x0F; }
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

  float val = texture(u_video, cellCenter).r;

  float blackCutoff = uParams.z * 0.4;
  if (val < blackCutoff) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  float adj = clamp((val - blackCutoff) / max(1.0 - blackCutoff, 0.01), 0.0, 1.0);
  if (uParams.y > 0.01) {
    float c = mix(1.0, 4.0, uParams.y);
    adj = clamp((adj - 0.5) * c + 0.5, 0.0, 1.0);
  }

  int gid = clamp(int(floor(adj * 25.99)), 0, 25);

  float padding    = cellPx * 0.08;
  float charAreaH  = cellPx - padding * 2.0;
  float charPxSize = charAreaH / 7.0;
  float charWidth  = charPxSize * 5.0;
  float xOffset    = (cellPx - charWidth) * 0.5;

  int gx = int(floor((inCell.x - xOffset) / charPxSize));
  int gy = int(floor((inCell.y - padding) / charPxSize));

  float glyph      = pix(gid, gx, gy) ? 1.0 : 0.0;
  float glyphBrite = glyph * mix(0.6, 1.0, val);
  float result     = mix(val, glyphBrite, uParams.w);

  fragColor = vec4(result, result, result, 1.0);
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

let S = null;

function init(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: true });
  if (!gl) { console.warn('[ASCII] WebGL2 not supported'); return null; }

  const prog = createProgram(gl, VERT, ASCII_FRAG);
  if (!prog) return null;

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const videoTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, videoTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const u = {
    video:  gl.getUniformLocation(prog, 'u_video'),
    params: gl.getUniformLocation(prog, 'uParams'),
  };

  return { gl, canvas, prog, vao, videoTex, u, w, h };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLVideoElement}         video
 * @param {number} cw, ch
 * @param {object} params  { cellSize, contrast, blackThreshold, glyphStrength } all 0-1
 */
export function applyASCII(ctx, video, cw, ch, params = {}) {
  const cellSize      = params.cellSize      ?? 0.3;
  const contrast      = params.contrast      ?? 0.3;
  const blackThresh   = params.blackThreshold ?? 0.2;
  const glyphStrength = params.glyphStrength  ?? 0.9;

  if (!S || S.w !== cw || S.h !== ch) {
    S = init(cw, ch);
    if (!S) return;
  }

  const { gl, canvas, prog, vao, videoTex, u } = S;

  gl.viewport(0, 0, cw, ch);
  gl.bindVertexArray(vao);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  gl.bindTexture(gl.TEXTURE_2D, videoTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

  gl.useProgram(prog);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, videoTex); gl.uniform1i(u.video, 0);
  gl.uniform4f(u.params, cellSize, contrast, blackThresh, glyphStrength);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Replace video on canvas (not 'screen' — ASCII is the image, not an overlay)
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(canvas, 0, 0, cw, ch);
  ctx.restore();
}
