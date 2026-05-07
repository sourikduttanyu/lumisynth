/**
 * Voronoi Diffusion effect — ported from TouchDesigner GLSL.
 * Uses WebGL2 ping-pong framebuffers for the jump-flood feedback loop.
 * Output is composited onto the 2D display canvas via drawImage.
 */

// ---- Shaders ----

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 vUV;
void main() {
  vUV = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Pass 1: update Voronoi seed map (reads video + prev feedback, writes new feedback)
const UPDATE_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform sampler2D u_prev;
uniform vec4 uParams; // x=threshold, y=jumpDist, z=falloff, w=edgeLines
out vec4 fragColor;

void main() {
  vec2 uv = vUV;
  vec2 texel = 1.0 / vec2(textureSize(u_video, 0));
  float ownLuma = dot(texture(u_video, uv).rgb, vec3(0.299, 0.587, 0.114));

  vec4 prev = texture(u_prev, uv);
  bool uninit = prev.a < 0.5;

  float bestVal  = uninit ? 0.0 : prev.r;
  vec2  bestSeed = uninit ? vec2(-1.0) : prev.gb;
  float bestDist = (bestVal > 0.01) ? distance(uv, bestSeed) : 1e6;
  bool  hasSeed  = !uninit && bestVal > 0.01;

  float threshold = mix(0.4, 0.85, uParams.x);

  // Seed: local max above threshold
  if (ownLuma > threshold) {
    float nl = dot(texture(u_video, uv - vec2(texel.x, 0.0)).rgb, vec3(0.299,0.587,0.114));
    float nr = dot(texture(u_video, uv + vec2(texel.x, 0.0)).rgb, vec3(0.299,0.587,0.114));
    float nd = dot(texture(u_video, uv - vec2(0.0, texel.y)).rgb, vec3(0.299,0.587,0.114));
    float nu = dot(texture(u_video, uv + vec2(0.0, texel.y)).rgb, vec3(0.299,0.587,0.114));
    if (ownLuma >= nl && ownLuma >= nr && ownLuma >= nd && ownLuma >= nu) {
      bestVal = ownLuma; bestSeed = uv; bestDist = 0.0; hasSeed = true;
    }
  }

  // Jump flood: 8-directional neighbour sampling
  float jumpSize = mix(2.0, 24.0, uParams.y);
  for (int i = 0; i < 8; i++) {
    float angle = float(i) / 8.0 * 6.2832;
    vec4 np = texture(u_prev, uv + vec2(cos(angle), sin(angle)) * texel * jumpSize);
    if (np.a > 0.5 && np.r > 0.01) {
      float d = distance(uv, np.gb);
      if (d < bestDist) { bestDist = d; bestVal = np.r; bestSeed = np.gb; hasSeed = true; }
    }
  }

  // Seed expiration: re-check source brightness around seed
  if (hasSeed && bestSeed.x >= 0.0) {
    float areaMax = 0.0;
    for (int sy = -1; sy <= 1; sy++) for (int sx = -1; sx <= 1; sx++) {
      float v = dot(texture(u_video, bestSeed + vec2(float(sx), float(sy)) * texel * 3.0).rgb, vec3(0.299,0.587,0.114));
      areaMax = max(areaMax, v);
    }
    if (areaMax < threshold * 0.5) { bestVal = 0.0; hasSeed = false; bestSeed = vec2(-1.0); }
    else { bestVal = mix(bestVal, areaMax, 0.2); }
  }

  fragColor = vec4(clamp(bestVal,0.0,1.0), hasSeed ? bestSeed.x : 0.0, hasSeed ? bestSeed.y : 0.0, hasSeed ? 1.0 : 0.0);
}`;

// Pass 2: colorize Voronoi map for display
const DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_voronoi;
uniform vec4 uParams;
out vec4 fragColor;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec4 d = texture(u_voronoi, vUV);
  if (d.a < 0.5) { fragColor = vec4(0.0); return; }

  float val  = d.r;
  vec2  seed = d.gb;

  // Distance falloff
  float dv = val;
  if (uParams.z > 0.01) dv *= 1.0 - clamp(distance(vUV, seed) * 8.0 * uParams.z, 0.0, 0.85);

  // Colorize by seed position (unique hue per cell)
  vec3 col = hsv2rgb(vec3(fract(seed.x * 7.3 + seed.y * 3.7), 0.85, dv));

  // Edge lines between cells
  if (uParams.w > 0.01) {
    vec2 tx = 1.0 / vec2(textureSize(u_voronoi, 0));
    vec2 rS = texture(u_voronoi, vUV + vec2(tx.x*2.0, 0.0)).gb;
    vec2 dS = texture(u_voronoi, vUV + vec2(0.0, tx.y*2.0)).gb;
    float edge = smoothstep(0.005, 0.03, max(distance(seed,rS), distance(seed,dS)));
    col = mix(col, vec3(0.0), edge * uParams.w);
  }

  fragColor = vec4(col, dv);
}`;

// ---- WebGL helpers ----

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('[Voronoi] shader:', gl.getShaderInfoLog(s));
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
    console.error('[Voronoi] link:', gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

function createFBO(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb };
}

// ---- Module state ----

let S = null; // WebGL state

function init(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: true });
  if (!gl) { console.warn('[Voronoi] WebGL2 not supported'); return null; }

  const updateProg  = createProgram(gl, VERT, UPDATE_FRAG);
  const displayProg = createProgram(gl, VERT, DISPLAY_FRAG);
  if (!updateProg || !displayProg) return null;

  // Fullscreen quad VAO
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Video texture
  const videoTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, videoTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Cache uniform locations
  const uUpdate = {
    video:  gl.getUniformLocation(updateProg,  'u_video'),
    prev:   gl.getUniformLocation(updateProg,  'u_prev'),
    params: gl.getUniformLocation(updateProg,  'uParams'),
  };
  const uDisplay = {
    voronoi: gl.getUniformLocation(displayProg, 'u_voronoi'),
    params:  gl.getUniformLocation(displayProg, 'uParams'),
  };

  return {
    gl, canvas, updateProg, displayProg, vao,
    fb0: createFBO(gl, w, h),
    fb1: createFBO(gl, w, h),
    videoTex, uUpdate, uDisplay,
    pingPong: 0, w, h,
  };
}

export function resetVoronoi() {
  if (!S) return;
  const { gl, fb0, fb1 } = S;
  for (const { fb } of [fb0, fb1]) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  S.pingPong = 0;
}

/**
 * @param {CanvasRenderingContext2D} ctx    display canvas 2D context
 * @param {HTMLVideoElement}         video
 * @param {number} cw, ch                  display canvas dimensions
 * @param {object} params                  { threshold, jumpDist, falloff, edgeLines } all 0-1
 */
export function applyVoronoi(ctx, video, cw, ch, params = {}) {
  const threshold = params.threshold ?? 0.5;
  const jumpDist  = params.jumpDist  ?? 0.5;
  const falloff   = params.falloff   ?? 0.5;
  const edgeLines = params.edgeLines ?? 0.0;

  if (!S || S.w !== cw || S.h !== ch) {
    S = init(cw, ch);
    if (!S) return;
  }

  const { gl, canvas, updateProg, displayProg, vao, fb0, fb1, videoTex, uUpdate, uDisplay } = S;

  const fbRead  = S.pingPong === 0 ? fb0 : fb1;
  const fbWrite = S.pingPong === 0 ? fb1 : fb0;
  S.pingPong ^= 1;

  gl.viewport(0, 0, cw, ch);
  gl.bindVertexArray(vao);

  // Upload current video frame
  gl.bindTexture(gl.TEXTURE_2D, videoTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

  // --- Pass 1: update Voronoi map ---
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbWrite.fb);
  gl.useProgram(updateProg);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, videoTex);    gl.uniform1i(uUpdate.video, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fbRead.tex);  gl.uniform1i(uUpdate.prev,  1);
  gl.uniform4f(uUpdate.params, threshold, jumpDist, falloff, edgeLines);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // --- Pass 2: display ---
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.useProgram(displayProg);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbWrite.tex); gl.uniform1i(uDisplay.voronoi, 0);
  gl.uniform4f(uDisplay.params, threshold, jumpDist, falloff, edgeLines);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Composite WebGL canvas onto 2D canvas
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(canvas, 0, 0, cw, ch);
  ctx.restore();
}
