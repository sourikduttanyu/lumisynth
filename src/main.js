import './style.css';
import { detectBlobs, resetFrameHistory } from './blobDetector.js';
import { applyFilterToRegion } from './filters.js';
import { drawOverlays } from './overlays.js';
import { trackBlobs, resetTracker } from './kalman.js';
import { applyVoronoi, resetVoronoi } from './voronoi.js';
import { applyCA, resetCA } from './cellular.js';
import { applyASCII } from './ascii.js';
import { applyGLFilter } from './glFilters.js';
import { applyWave, resetWave } from './wave.js';

// ---- State ----
const state = {
  speed: 1,
  shape: 'rect',
  regionStyle: 'basic',
  filter: 'none',
  voronoiThreshold: 0.5,
  voronoiJumpDist:  0.5,
  voronoiFalloff:   0.5,
  voronoiEdgeLines: 0.0,
  caDensity:        0.5,
  caStability:      0.5,
  caEvolutionSpeed: 0.5,
  caSourceInflux:   0.5,
  asciiCellSize:      0.3,
  asciiContrast:      0.3,
  asciiBlackThresh:   0.2,
  asciiGlyphStrength: 0.9,
  shatterCells: 0.3, shatterCrack: 0.2, shatterFill: 0.5, shatterRandom: 0.8,
  erodeMode: 0,      erodeRadius: 0.3,  erodeStrength: 0.7, erodeEdge: 0.0,
  oxideCorr: 0.5,    oxideMetal: 0.0,   oxideRough: 0.3,    oxideSheen: 0.3,
  synthWarm: 0.5,    synthSep: 0.3,     synthRes: 0.4,      synthDyn: 0.7,
  biolumGlow: 0.7,   biolumColor: 0.0,  biolumPulse: 0.2,   biolumDepth: 0.7,
  thermoCont: 0.4,   thermoHot: 0.0,    thermoCold: 0.1,    thermoWhite: 0.5,
  falsePalette: 0.25,falseBand: 0.0,    falseBandCnt: 0.5,  falseBright: 0.5,
  waveSource: 0.5,   waveDamp: 0.3,     waveSpeed: 0.5,     waveContr: 0.5,
  connectionRate: 0.25,
  threshold: 15,
  maxBlobs: 12,
  detectMode: 'motion',
  updateInterval: 1,
  strokeWidth: 1,
  blobSize: 64,
  fontSize: 11,
  overlayColor: '#ffffff',
  hasSource: false,
};

let frameCount   = 0;
let cachedBlobs  = [];

// ---- DOM refs ----
const video       = document.getElementById('video');
const canvas      = document.getElementById('main-canvas');
const ctx         = canvas.getContext('2d', { willReadFrequently: true });
const placeholder = document.getElementById('placeholder');
const fileInput   = document.getElementById('file-input');
const canvasArea  = document.getElementById('canvas-area');

// ---- Offscreen canvas for half-res blob detection ----
const offscreen = document.createElement('canvas');
const offCtx    = offscreen.getContext('2d', { willReadFrequently: true });
const DETECT_SCALE = 0.5; // run detection at 50% resolution

// ---- Toggle group wiring ----
function wireToggleGroup(groupId, stateKey, onChange) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    group.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state[stateKey] = btn.dataset.value;
    if (onChange) onChange(state[stateKey]);
  });
}

function wireSlider(sliderId, valId, stateKey, transform) {
  const slider = document.getElementById(sliderId);
  const valEl  = document.getElementById(valId);
  if (!slider) return;
  slider.addEventListener('input', () => {
    state[stateKey] = transform ? transform(slider.value) : parseFloat(slider.value);
    valEl.textContent = slider.value;
  });
}

wireToggleGroup('speed-group',  'speed',       (v) => { video.playbackRate = parseFloat(v); });
wireToggleGroup('shape-group',  'shape',        null);
wireToggleGroup('style-group',  'regionStyle',  null);
const GL_SECTIONS    = ['voronoi','cellular','ascii','shatter','erode','wave','oxide','synth','biolum','thermo','falsecolor'];
const FULL_FRAME_SET = new Set(GL_SECTIONS);
const GL_RESETS   = { voronoi: resetVoronoi, cellular: resetCA, wave: resetWave };

wireToggleGroup('filter-group', 'filter', (v) => {
  for (const name of GL_SECTIONS) {
    const el = document.getElementById(`${name}-controls`);
    if (el) el.style.display = v === name ? '' : 'none';
  }
  for (const [name, fn] of Object.entries(GL_RESETS)) {
    if (v !== name) fn();
  }
});

wireToggleGroup('detect-mode-group', 'detectMode', (v) => { resetFrameHistory(); });
wireSlider('voronoi-threshold',  'voronoi-threshold-val',  'voronoiThreshold',  parseFloat);
wireSlider('voronoi-jump-dist',  'voronoi-jump-dist-val',  'voronoiJumpDist',   parseFloat);
wireSlider('voronoi-falloff',    'voronoi-falloff-val',    'voronoiFalloff',    parseFloat);
wireSlider('voronoi-edge-lines', 'voronoi-edge-lines-val', 'voronoiEdgeLines',  parseFloat);
wireSlider('ca-density',         'ca-density-val',         'caDensity',         parseFloat);
wireSlider('ca-stability',       'ca-stability-val',       'caStability',       parseFloat);
wireSlider('ca-evolution-speed', 'ca-evolution-speed-val', 'caEvolutionSpeed',  parseFloat);
wireSlider('ca-source-influx',      'ca-source-influx-val',      'caSourceInflux',    parseFloat);
wireSlider('ascii-cell-size',       'ascii-cell-size-val',       'asciiCellSize',     parseFloat);
wireSlider('ascii-contrast',        'ascii-contrast-val',        'asciiContrast',     parseFloat);
wireSlider('ascii-black-thresh',    'ascii-black-thresh-val',    'asciiBlackThresh',  parseFloat);
wireSlider('ascii-glyph-strength',  'ascii-glyph-strength-val',  'asciiGlyphStrength',parseFloat);
wireSlider('shatter-cells',   'shatter-cells-val',   'shatterCells',  parseFloat);
wireSlider('shatter-crack',   'shatter-crack-val',   'shatterCrack',  parseFloat);
wireSlider('shatter-fill',    'shatter-fill-val',    'shatterFill',   parseFloat);
wireSlider('shatter-random',  'shatter-random-val',  'shatterRandom', parseFloat);
wireSlider('erode-mode',      'erode-mode-val',      'erodeMode',     parseFloat);
wireSlider('erode-radius',    'erode-radius-val',    'erodeRadius',   parseFloat);
wireSlider('erode-strength',  'erode-strength-val',  'erodeStrength', parseFloat);
wireSlider('erode-edge',      'erode-edge-val',      'erodeEdge',     parseFloat);
wireSlider('oxide-corr',      'oxide-corr-val',      'oxideCorr',     parseFloat);
wireSlider('oxide-metal',     'oxide-metal-val',     'oxideMetal',    parseFloat);
wireSlider('oxide-rough',     'oxide-rough-val',     'oxideRough',    parseFloat);
wireSlider('oxide-sheen',     'oxide-sheen-val',     'oxideSheen',    parseFloat);
wireSlider('synth-warm',      'synth-warm-val',      'synthWarm',     parseFloat);
wireSlider('synth-sep',       'synth-sep-val',       'synthSep',      parseFloat);
wireSlider('synth-res',       'synth-res-val',       'synthRes',      parseFloat);
wireSlider('synth-dyn',       'synth-dyn-val',       'synthDyn',      parseFloat);
wireSlider('biolum-glow',     'biolum-glow-val',     'biolumGlow',    parseFloat);
wireSlider('biolum-color',    'biolum-color-val',    'biolumColor',   parseFloat);
wireSlider('biolum-pulse',    'biolum-pulse-val',    'biolumPulse',   parseFloat);
wireSlider('biolum-depth',    'biolum-depth-val',    'biolumDepth',   parseFloat);
wireSlider('thermo-cont',     'thermo-cont-val',     'thermoCont',    parseFloat);
wireSlider('thermo-hot',      'thermo-hot-val',      'thermoHot',     parseFloat);
wireSlider('thermo-cold',     'thermo-cold-val',     'thermoCold',    parseFloat);
wireSlider('thermo-white',    'thermo-white-val',    'thermoWhite',   parseFloat);
wireSlider('false-palette',   'false-palette-val',   'falsePalette',  parseFloat);
wireSlider('false-band',      'false-band-val',      'falseBand',     parseFloat);
wireSlider('false-bandcnt',   'false-bandcnt-val',   'falseBandCnt',  parseFloat);
wireSlider('false-bright',    'false-bright-val',    'falseBright',   parseFloat);
wireSlider('wave-source',     'wave-source-val',     'waveSource',    parseFloat);
wireSlider('wave-damp',       'wave-damp-val',       'waveDamp',      parseFloat);
wireSlider('wave-speed',      'wave-speed-val',      'waveSpeed',     parseFloat);
wireSlider('wave-contr',      'wave-contr-val',      'waveContr',     parseFloat);
wireSlider('connection-rate',  'connection-rate-val',  'connectionRate',  parseFloat);
wireSlider('sensitivity',      'sensitivity-val',      'threshold',       parseFloat);
wireSlider('max-blobs',        'max-blobs-val',        'maxBlobs',        parseInt);
wireSlider('update-interval',  'update-interval-val',  'updateInterval',  parseInt);
wireSlider('stroke-width',     'stroke-width-val',     'strokeWidth',     parseFloat);
wireToggleGroup('blob-size-group', 'blobSize', (v) => { state.blobSize = parseInt(v); });
wireSlider('font-size', 'font-size-val', 'fontSize', parseInt);

const colorPicker = document.getElementById('overlay-color');
const colorLabel  = document.getElementById('overlay-color-val');
colorPicker.addEventListener('input', () => {
  state.overlayColor = colorPicker.value;
  colorLabel.textContent = colorPicker.value;
});

// ---- File upload ----
document.getElementById('btn-upload').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  loadVideoSource(URL.createObjectURL(file));
});

// ---- Camera ----
document.getElementById('btn-camera').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = stream;
    video.play();
    resetFrameHistory();
    resetVoronoi();
    resetCA();
    resetWave();
    cachedBlobs = [];
    frameCount  = 0;
    setHasSource(true);
  } catch (err) {
    alert('Could not access camera: ' + err.message);
  }
});

// ---- Load video ----
function loadVideoSource(url) {
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  video.src = url;
  video.loop = true;
  video.play().catch(() => {});
  resetFrameHistory();
  resetTracker();
  resetVoronoi();
  resetCA();
  resetWave();
  cachedBlobs = [];
  frameCount  = 0;
  setHasSource(true);
}

function setHasSource(val) {
  state.hasSource = val;
  placeholder.style.display = val ? 'none' : 'flex';
}

// ---- Canvas sizing ----
function resizeCanvas() {
  const aw = canvasArea.clientWidth;
  const ah = canvasArea.clientHeight;

  if (!state.hasSource || video.videoWidth === 0) {
    canvas.width = aw;
    canvas.height = ah;
    return;
  }

  const vRatio = video.videoWidth / video.videoHeight;
  const aRatio = aw / ah;
  let cw, ch;
  if (aRatio > vRatio) {
    ch = ah; cw = Math.round(ah * vRatio);
  } else {
    cw = aw; ch = Math.round(aw / vRatio);
  }

  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width  = cw;
    canvas.height = ch;
  }
}

window.addEventListener('resize', resizeCanvas);
video.addEventListener('loadedmetadata', resizeCanvas);

// ---- Main render loop ----
function renderFrame() {
  requestAnimationFrame(renderFrame);
  resizeCanvas();

  if (!state.hasSource) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  if (video.readyState < 2 || video.videoWidth === 0) return;

  const cw = canvas.width;
  const ch = canvas.height;

  // Draw video to display canvas (full res)
  ctx.drawImage(video, 0, 0, cw, ch);

  // --- Blob detection on half-res offscreen ---
  const ow = Math.max(1, Math.round(cw * DETECT_SCALE));
  const oh = Math.max(1, Math.round(ch * DETECT_SCALE));
  if (offscreen.width !== ow || offscreen.height !== oh) {
    offscreen.width  = ow;
    offscreen.height = oh;
  }
  offCtx.drawImage(video, 0, 0, ow, oh);
  const offImageData = offCtx.getImageData(0, 0, ow, oh);

  frameCount++;
  if (frameCount % state.updateInterval === 0) {
    const rawBlobs  = detectBlobs(offImageData, state.threshold, state.maxBlobs, state.detectMode);
    const sx = cw / ow;
    const sy = ch / oh;
    const scaledRaw = rawBlobs.map(b => ({
      ...b,
      x:  b.x  * sx,
      y:  b.y  * sy,
      w:  b.w  * sx,
      h:  b.h  * sy,
      cx: b.cx * sx,
      cy: b.cy * sy,
    }));
    cachedBlobs = trackBlobs(scaledRaw, cw, state.maxBlobs);
  }
  const blobs = cachedBlobs;

  // --- Full-frame WebGL effects (run before blob overlays) ---
  const f = state.filter;
  if (f === 'voronoi') {
    applyVoronoi(ctx, video, cw, ch, {
      threshold: state.voronoiThreshold, jumpDist: state.voronoiJumpDist,
      falloff:   state.voronoiFalloff,   edgeLines: state.voronoiEdgeLines,
    });
  } else if (f === 'cellular') {
    applyCA(ctx, video, cw, ch, {
      density: state.caDensity, stability: state.caStability,
      evolutionSpeed: state.caEvolutionSpeed, sourceInflux: state.caSourceInflux,
    });
  } else if (f === 'ascii') {
    applyASCII(ctx, video, cw, ch, {
      cellSize: state.asciiCellSize, contrast: state.asciiContrast,
      blackThreshold: state.asciiBlackThresh, glyphStrength: state.asciiGlyphStrength,
    });
  } else if (f === 'wave') {
    applyWave(ctx, video, cw, ch, {
      sourceStrength: state.waveSource, damping: state.waveDamp,
      speed: state.waveSpeed, contrast: state.waveContr,
    });
  } else if (f === 'shatter') {
    applyGLFilter('shatter', ctx, video, cw, ch, [state.shatterCells, state.shatterCrack, state.shatterFill, state.shatterRandom]);
  } else if (f === 'erode') {
    applyGLFilter('erode',   ctx, video, cw, ch, [state.erodeMode, state.erodeRadius, state.erodeStrength, state.erodeEdge]);
  } else if (f === 'oxide') {
    applyGLFilter('oxide',   ctx, video, cw, ch, [state.oxideCorr, state.oxideMetal, state.oxideRough, state.oxideSheen]);
  } else if (f === 'synth') {
    applyGLFilter('synth',   ctx, video, cw, ch, [state.synthWarm, state.synthSep, state.synthRes, state.synthDyn]);
  } else if (f === 'biolum') {
    applyGLFilter('biolum',  ctx, video, cw, ch, [state.biolumGlow, state.biolumColor, state.biolumPulse, state.biolumDepth]);
  } else if (f === 'thermo') {
    applyGLFilter('thermo',  ctx, video, cw, ch, [state.thermoCont, state.thermoHot, state.thermoCold, state.thermoWhite]);
  } else if (f === 'falsecolor') {
    applyGLFilter('falsecolor', ctx, video, cw, ch, [state.falsePalette, state.falseBand, state.falseBandCnt, state.falseBright]);
  }

  // --- Per-blob sub-region filter (reads only blob pixels, not full frame) ---
  if (state.filter !== 'none' && !FULL_FRAME_SET.has(state.filter)) {
    for (const blob of blobs) {
      const bx = Math.max(0, Math.floor(blob.x));
      const by = Math.max(0, Math.floor(blob.y));
      const bw = Math.min(cw - bx, Math.ceil(blob.w));
      const bh = Math.min(ch - by, Math.ceil(blob.h));
      if (bw <= 0 || bh <= 0) continue;

      const region = ctx.getImageData(bx, by, bw, bh);
      applyFilterToRegion(region.data, state.filter);
      ctx.putImageData(region, bx, by);
    }
  }

  // Draw overlays on top of everything
  drawOverlays(ctx, blobs, state.regionStyle, state.shape, state.connectionRate, state.strokeWidth, state.blobSize, state.fontSize, state.overlayColor);
}

canvas.width  = canvasArea.clientWidth;
canvas.height = canvasArea.clientHeight;

requestAnimationFrame(renderFrame);
