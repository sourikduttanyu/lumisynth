/**
 * Stateless single-pass GL filters — all share one WebGL2 canvas.
 * Programs compiled lazily and cached per filter name.
 * applyGLFilter(name, ctx, video, cw, ch, [p0,p1,p2,p3])
 */

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 vUV;
void main() {
  vUV = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// ---- Fragment shaders ----

const FRAG_SHATTER = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1,311.7)), dot(p, vec2(269.5,183.3)));
  return fract(sin(p) * 43758.5453);
}
void main() {
  vec2 uv = vUV;
  vec2 res = vec2(textureSize(u_video, 0));
  float aspect = res.x / res.y;
  vec2 coord = vec2(uv.x * aspect, uv.y);
  float cellCount = mix(4.0, 40.0, uParams.x);
  coord *= cellCount;
  vec2 iCoord = floor(coord);
  vec2 fCoord = fract(coord);
  float minDist = 10.0, secondDist = 10.0;
  vec2 nearestCell = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 nb = vec2(float(x), float(y));
      vec2 pt = hash2(iCoord + nb) * uParams.w + (1.0 - uParams.w) * 0.5;
      float d = length(nb + pt - fCoord);
      if (d < minDist) { secondDist = minDist; minDist = d; nearestCell = iCoord + nb + pt; }
      else if (d < secondDist) { secondDist = d; }
    }
  }
  float edge  = secondDist - minDist;
  float crackW = mix(0.01, 0.15, uParams.y);
  float crack  = 1.0 - smoothstep(crackW * 0.3, crackW, edge);
  vec2 cellUV  = nearestCell / cellCount;
  cellUV.x    /= aspect;
  float cellVal = texture(u_video, clamp(cellUV, 0.0, 1.0)).r;
  float pixVal  = texture(u_video, uv).r;
  float fill    = mix(cellVal, pixVal, uParams.z);
  float out_v   = fill * (1.0 - crack * 0.9);
  fragColor = vec4(out_v, out_v, out_v, 1.0);
}`;

const FRAG_ERODE = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;

void main() {
  vec2 uv = vUV;
  vec2 texel = 1.0 / vec2(textureSize(u_video, 0));
  float val = texture(u_video, uv).r;
  int radius = int(mix(1.0, 6.0, uParams.y));
  float strength = mix(0.3, 1.0, uParams.z);
  bool dilate = uParams.x > 0.5;
  float morphVal = dilate ? 0.0 : 1.0;
  for (int dy = -6; dy <= 6; dy++) {
    if (abs(dy) > radius) continue;
    for (int dx = -6; dx <= 6; dx++) {
      if (abs(dx) > radius) continue;
      if (dx*dx + dy*dy > radius*radius) continue;
      float sv = texture(u_video, clamp(uv + vec2(float(dx),float(dy)) * texel, 0.0, 1.0)).r;
      if (dilate) morphVal = max(morphVal, sv);
      else        morphVal = min(morphVal, sv);
    }
  }
  float morphed  = mix(val, morphVal, strength);
  float edgeRing = abs(val - morphVal) * 3.0;
  float out_v    = mix(morphed, clamp(edgeRing, 0.0, 1.0), uParams.w);
  fragColor = vec4(out_v, out_v, out_v, 1.0);
}`;

const FRAG_OXIDE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
void main() {
  vec2 uv = vUV;
  vec2 res = vec2(textureSize(u_video, 0));
  vec2 texel = 1.0 / res;
  float val = texture(u_video, uv).r;
  float vL = texture(u_video, uv - vec2(texel.x, 0.0)).r;
  float vR = texture(u_video, uv + vec2(texel.x, 0.0)).r;
  float vD = texture(u_video, uv - vec2(0.0, texel.y)).r;
  float vU = texture(u_video, uv + vec2(0.0, texel.y)).r;
  float edgeMag = length(vec2(vR - vL, vU - vD));
  float corr = mix(val, 1.0 - val, uParams.x * 0.7);
  corr = clamp(corr * uParams.x * 2.0, 0.0, 1.0);
  float metal = uParams.y;
  vec3 fresh, patina;
  if (metal < 0.33) {
    fresh  = mix(vec3(0.72,0.45,0.2), vec3(0.85,0.65,0.4), val);
    patina = mix(vec3(0.2,0.45,0.35), vec3(0.35,0.6,0.45), val);
  } else if (metal < 0.66) {
    fresh  = mix(vec3(0.25,0.25,0.27), vec3(0.5,0.5,0.52), val);
    patina = mix(vec3(0.4,0.18,0.05), vec3(0.7,0.35,0.1), val);
  } else {
    fresh  = mix(vec3(0.6,0.6,0.65), vec3(0.9,0.9,0.92), val);
    patina = mix(vec3(0.15,0.12,0.18), vec3(0.35,0.3,0.38), val);
  }
  vec3 col = mix(fresh, patina, corr);
  float rough = hash(floor(uv * res / mix(1.0, 4.0, uParams.z)));
  col *= 1.0 - rough * uParams.z * 0.2;
  float sheen = edgeMag * 4.0 + pow(val, 3.0) * 0.5;
  col += vec3(sheen * uParams.w * 0.5);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_SYNTH = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;

void main() {
  float val = texture(u_video, vUV).r;
  val = pow(val, mix(0.5, 2.0, 1.0 - uParams.w));
  float bands   = mix(3.0, 12.0, uParams.y);
  float bandVal = val;
  if (uParams.y > 0.1) bandVal = floor(val * bands + 0.5) / bands;
  float resonance = 1.0 + sin(val * bands * 3.14159) * uParams.z * 0.4;
  float t = bandVal, w = uParams.x;
  vec3 col;
  if (t < 0.15)       col = mix(vec3(0.05,0.02,0.08), vec3(0.25+w*0.2,0.05,0.05), t/0.15);
  else if (t < 0.3)   col = mix(vec3(0.25+w*0.2,0.05,0.05), vec3(0.6+w*0.2,0.3,0.05), (t-0.15)/0.15);
  else if (t < 0.5)   col = mix(vec3(0.6+w*0.2,0.3,0.05), vec3(0.1,0.5+w*0.2,0.3), (t-0.3)/0.2);
  else if (t < 0.7)   col = mix(vec3(0.1,0.5+w*0.2,0.3), vec3(0.1,0.4,0.7+(1.0-w)*0.2), (t-0.5)/0.2);
  else if (t < 0.85)  col = mix(vec3(0.1,0.4,0.7+(1.0-w)*0.2), vec3(0.6,0.7,0.9), (t-0.7)/0.15);
  else                col = mix(vec3(0.6,0.7,0.9), vec3(1.0,0.98,0.95), (t-0.85)/0.15);
  col *= resonance;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_BIOLUM = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0,2.0/3.0,1.0/3.0,3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
void main() {
  float val = texture(u_video, vUV).r;
  float depthFade = mix(1.0, pow(val, 0.5), uParams.w);
  float glow = pow(val, mix(2.0, 0.5, uParams.x)) * depthFade;
  float pulse = 1.0 + sin(val * mix(1.0, 30.0, uParams.z) * 3.14159) * uParams.z * 0.3;
  glow *= pulse;
  float hue = mix(0.5, mix(0.35, 0.8, uParams.y), 0.5 + val * 0.5);
  float sat = mix(0.6, 1.0, glow);
  vec3 col = hsv2rgb(vec3(hue, sat, glow * uParams.x * 2.0));
  col = max(col, vec3(0.0, 0.005, 0.02));
  col += hsv2rgb(vec3(hue + 0.1, 0.4, glow * 0.2));
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_THERMO = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;

vec3 thermalRamp(float t) {
  if (t < 0.2) return mix(vec3(0,0,0.05), vec3(0,0,0.8), t*5.0);
  if (t < 0.4) return mix(vec3(0,0,0.8), vec3(0,0.7,0.8), (t-0.2)*5.0);
  if (t < 0.6) return mix(vec3(0,0.7,0.8), vec3(0.95,0.85,0), (t-0.4)*5.0);
  if (t < 0.8) return mix(vec3(0.95,0.85,0), vec3(0.9,0.1,0), (t-0.6)*5.0);
  return mix(vec3(0.9,0.1,0), vec3(1,1,0.95), (t-0.8)*5.0);
}
void main() {
  float val = texture(u_video, vUV).r;
  val = (val - 0.5) * (1.0 + uParams.x * 2.0) + 0.5;
  val = clamp(val + uParams.y * 0.3, 0.0, 1.0);
  vec3 col = thermalRamp(val);
  col = max(col, vec3(0, 0, uParams.z * 0.15));
  col = mix(col, vec3(1), smoothstep(0.85, 1.0, val) * uParams.w);
  fragColor = vec4(col, 1.0);
}`;

const FRAG_FALSECOLOR = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;

vec3 thermalP(float t) {
  if (t<0.25) return mix(vec3(0,0,0.1),vec3(0.2,0,0.8),t*4.0);
  if (t<0.5)  return mix(vec3(0.2,0,0.8),vec3(0.9,0.1,0.1),(t-0.25)*4.0);
  if (t<0.75) return mix(vec3(0.9,0.1,0.1),vec3(1,0.8,0),(t-0.5)*4.0);
  return mix(vec3(1,0.8,0),vec3(1,1,0.9),(t-0.75)*4.0);
}
vec3 neonP(float t) {
  if (t<0.25) return mix(vec3(0),vec3(1,0,0.5),t*4.0);
  if (t<0.5)  return mix(vec3(1,0,0.5),vec3(0,1,0.8),(t-0.25)*4.0);
  if (t<0.75) return mix(vec3(0,1,0.8),vec3(0.5,0,1),(t-0.5)*4.0);
  return mix(vec3(0.5,0,1),vec3(1,1,1),(t-0.75)*4.0);
}
vec3 acidP(float t) {
  if (t<0.25) return mix(vec3(0,0.05,0),vec3(0,0.6,0),t*4.0);
  if (t<0.5)  return mix(vec3(0,0.6,0),vec3(0.8,1,0),(t-0.25)*4.0);
  if (t<0.75) return mix(vec3(0.8,1,0),vec3(1,0.4,0.8),(t-0.5)*4.0);
  return mix(vec3(1,0.4,0.8),vec3(1,1,1),(t-0.75)*4.0);
}
vec3 iceP(float t) {
  if (t<0.25) return mix(vec3(0,0,0.1),vec3(0,0.2,0.5),t*4.0);
  if (t<0.5)  return mix(vec3(0,0.2,0.5),vec3(0.3,0.7,0.9),(t-0.25)*4.0);
  if (t<0.75) return mix(vec3(0.3,0.7,0.9),vec3(0.7,0.9,1),(t-0.5)*4.0);
  return mix(vec3(0.7,0.9,1),vec3(1,1,1),(t-0.75)*4.0);
}
void main() {
  float val = clamp(texture(u_video, vUV).r + (uParams.w - 0.5), 0.0, 1.0);
  if (uParams.y > 0.01) {
    float bands = mix(4.0, 20.0, uParams.z);
    val = clamp(floor(val * bands) / (bands - 1.0), 0.0, 1.0);
  }
  float sel = uParams.x;
  vec3 col;
  if (sel<0.25)      col = mix(thermalP(val), neonP(val),    sel*4.0);
  else if (sel<0.5)  col = mix(neonP(val),    acidP(val),    (sel-0.25)*4.0);
  else if (sel<0.75) col = mix(acidP(val),    iceP(val),     (sel-0.5)*4.0);
  else               col = mix(iceP(val),     thermalP(val), (sel-0.75)*4.0);
  fragColor = vec4(col, 1.0);
}`;

const FRAGS = {
  shatter:    FRAG_SHATTER,
  erode:      FRAG_ERODE,
  oxide:      FRAG_OXIDE,
  synth:      FRAG_SYNTH,
  biolum:     FRAG_BIOLUM,
  thermo:     FRAG_THERMO,
  falsecolor: FRAG_FALSECOLOR,
};

// ---- WebGL helpers ----

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('[glFilters] shader:', gl.getShaderInfoLog(s));
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
    console.error('[glFilters] link:', gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

// ---- Module state ----

let S = null; // { gl, canvas, vao, videoTex, programs: {}, w, h }

function init(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: true });
  if (!gl) { console.warn('[glFilters] WebGL2 not supported'); return null; }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const videoTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, videoTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return { gl, canvas, vao, videoTex, programs: {}, w, h };
}

function getProgram(name) {
  if (S.programs[name]) return S.programs[name];
  const prog = createProgram(S.gl, VERT, FRAGS[name]);
  if (!prog) return null;
  const entry = {
    prog,
    video:  S.gl.getUniformLocation(prog, 'u_video'),
    params: S.gl.getUniformLocation(prog, 'uParams'),
  };
  S.programs[name] = entry;
  return entry;
}

/**
 * @param {string}                   name    filter name (shatter|erode|oxide|synth|biolum|thermo|falsecolor)
 * @param {CanvasRenderingContext2D}  ctx
 * @param {HTMLVideoElement}          video
 * @param {number}                    cw, ch
 * @param {number[]}                  params  [p0,p1,p2,p3] → uParams.xyzw
 */
export function applyGLFilter(name, ctx, video, cw, ch, params = [0.5, 0.5, 0.5, 0.5]) {
  if (!FRAGS[name]) return;
  if (!S || S.w !== cw || S.h !== ch) {
    S = init(cw, ch);
    if (!S) return;
  }

  const entry = getProgram(name);
  if (!entry) return;

  const { gl, canvas, vao, videoTex } = S;
  gl.viewport(0, 0, cw, ch);
  gl.bindVertexArray(vao);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  gl.bindTexture(gl.TEXTURE_2D, videoTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

  gl.useProgram(entry.prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, videoTex);
  gl.uniform1i(entry.video, 0);
  gl.uniform4f(entry.params, params[0], params[1], params[2], params[3]);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(canvas, 0, 0, cw, ch);
  ctx.restore();
}
