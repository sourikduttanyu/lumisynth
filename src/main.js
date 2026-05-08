import './style.css';
import { detectBlobs, resetFrameHistory } from './blobDetector.js';
import { applyFilterToSubregion } from './filters.js';
import { drawOverlays } from './overlays.js';
import { trackBlobs, resetTracker } from './kalman.js';
import { applyVoronoi, resetVoronoi } from './voronoi.js';
import { applyCA, resetCA } from './cellular.js';
import { applyASCII } from './ascii.js';
import { applyGLFilter } from './glFilters.js';
import { applyWave, resetWave } from './wave.js';

const DEFAULTS = Object.freeze({
  speed: 1, shape: 'rect', regionStyle: 'basic', filter: 'none',
  voronoiThreshold: 0.5, voronoiJumpDist: 0.5, voronoiFalloff: 0.5, voronoiEdgeLines: 0.0,
  caDensity: 0.5, caStability: 0.5, caEvolutionSpeed: 0.5, caSourceInflux: 0.5,
  asciiCellSize: 0.3, asciiContrast: 0.3, asciiBlackThresh: 0.2, asciiGlyphStrength: 0.9,
  shatterCells: 0.3, shatterCrack: 0.2, shatterFill: 0.5, shatterRandom: 0.8,
  erodeMode: 0,      erodeRadius: 0.3,  erodeStrength: 0.7, erodeEdge: 0.0,
  oxideCorr: 0.5,    oxideMetal: 0.0,   oxideRough: 0.3,    oxideSheen: 0.3,
  synthWarm: 0.5,    synthSep: 0.3,     synthRes: 0.4,      synthDyn: 0.7,
  biolumGlow: 0.7,   biolumColor: 0.0,  biolumPulse: 0.2,   biolumDepth: 0.7,
  thermoCont: 0.4,   thermoHot: 0.0,    thermoCold: 0.1,    thermoWhite: 0.5,
  falsePalette: 0.25, falseBand: 0,     falseBandCnt: 0.5,  falseBright: 0.5,
  waveSource: 0.5,   waveDamp: 0.3,     waveSpeed: 0.5,     waveContr: 0.5,
  connectionRate: 0.25,
  threshold: 30,
  maxBlobs: 12,
  detectMode: 'motion',
  updateInterval: 1,
  blobSmooth: 0,
  strokeWidth: 1,
  blobSize: 64,
  fontSize: 11,
  overlayColor: '#ffffff',
});

const STORAGE_KEY = 'fluxkit-state-v2';

const state = { ...DEFAULTS, hasSource: false };

let frameCount  = 0;
let cachedBlobs = [];
let rafHandle   = 0;

const video        = document.getElementById('video');
const canvas       = document.getElementById('main-canvas');
// GPU-backed display canvas. We only read from it when a CPU-filter is active
// (inv/thermal), and that path now does ONE batched getImageData per frame
// (see filters.js + renderFrame's batched block). Without this flip every
// drawImage(video) and drawImage(webglCanvas) would round-trip through CPU.
const ctx          = canvas.getContext('2d', { willReadFrequently: false });
const placeholder  = document.getElementById('placeholder');
const fileInput    = document.getElementById('file-input');
const canvasArea   = document.getElementById('canvas-area');
const fileStatus   = document.getElementById('file-status');
const topbarSource = document.getElementById('topbar-source');
const toastRegion  = document.getElementById('toast-region');
const btnSnapshot  = document.getElementById('btn-snapshot');
const btnReset     = document.getElementById('btn-reset');
const btnFps       = document.getElementById('btn-fps');
const btnHelp      = document.getElementById('btn-help');
const helpOverlay  = document.getElementById('help-overlay');
const helpClose    = document.getElementById('help-close');
const dropOverlay  = document.getElementById('drop-overlay');
const videoControls= document.getElementById('video-controls');
const btnPlay      = document.getElementById('btn-play');
const videoScrub   = document.getElementById('video-scrub');
const videoTime    = document.getElementById('video-time');
const fpsOverlay   = document.getElementById('fps-overlay');
const emptyCard    = document.getElementById('empty-card');
const swatchGrid   = document.getElementById('swatch-grid');

const offscreen = document.createElement('canvas');
const offCtx    = offscreen.getContext('2d', { willReadFrequently: true });
const DETECT_SCALE = 0.5;

// ---- Toast ----
function showToast(message, kind = 'info', timeoutMs = 4000) {
  const node = document.createElement('div');
  node.className = `toast toast-${kind}`;
  node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  node.textContent = message;
  toastRegion.appendChild(node);
  setTimeout(() => node.remove(), timeoutMs);
}

// ---- Helpers ----
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const SVG_NS = 'http://www.w3.org/2000/svg';
const KNOB_ARC_LEN = 75;
const KNOB_DRAG_PX = 150;
// Wheel: one logical "tick" = ~40 px of accumulated deltaY (≈ one mouse-wheel
// notch / one trackpad line). Threshold-based accumulation prevents trackpad
// runaway; deltaMode normalization handles devices that report lines or pages.
const WHEEL_TICK_PX = 40;

function kebabToCamel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
function snapToStep(v, min, step) {
  if (step <= 0) return v;
  const n = Math.round((v - min) / step);
  return min + n * step;
}
function formatValue(v, step) {
  if (step >= 1) return String(Math.round(v));
  const decimals = step >= 0.1 ? 1 : 2;
  return parseFloat(Number(v).toFixed(decimals)).toString();
}
function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
function nearlyEqual(a, b) { return Math.abs(a - b) < 1e-6; }

// ---- Knob component ----
const knobRegistry = new Map();   // id -> { setValue, getValue, min, max, step, default, stateKey, el }

function initKnob(el) {
  const id      = el.id;
  const min     = parseFloat(el.dataset.min);
  const max     = parseFloat(el.dataset.max);
  const step    = parseFloat(el.dataset.step);
  const def     = parseFloat(el.dataset.default);
  const stateKey = el.dataset.state || kebabToCamel(id);
  const isInt   = step >= 1 && Number.isInteger(min) && Number.isInteger(max);
  const valEl   = document.getElementById(`${id}-val`);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'knob-svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('width', '40');
  svg.setAttribute('height', '40');
  svg.setAttribute('aria-hidden', 'true');

  const mkCircle = (cls, r, attrs = {}) => {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('class', cls);
    c.setAttribute('cx', '24'); c.setAttribute('cy', '24');
    c.setAttribute('r', String(r));
    for (const [k, v] of Object.entries(attrs)) c.setAttribute(k, v);
    return c;
  };
  const track = mkCircle('knob-track', 18, {
    pathLength: '100', 'stroke-dasharray': '75 25',
    'stroke-dashoffset': '0', transform: 'rotate(135 24 24)',
  });
  const arc = mkCircle('knob-arc', 18, {
    pathLength: '100', 'stroke-dasharray': '75 25',
    'stroke-dashoffset': '75', transform: 'rotate(135 24 24)',
  });
  const cap = mkCircle('knob-cap', 11);
  const pointer = document.createElementNS(SVG_NS, 'line');
  pointer.setAttribute('class', 'knob-pointer');
  pointer.setAttribute('x1', '24'); pointer.setAttribute('y1', '24');
  pointer.setAttribute('x2', '24'); pointer.setAttribute('y2', '11');
  pointer.setAttribute('transform', 'rotate(-135 24 24)');

  svg.appendChild(track);
  svg.appendChild(arc);
  svg.appendChild(cap);
  svg.appendChild(pointer);
  el.prepend(svg);

  el.setAttribute('role', 'slider');
  el.setAttribute('aria-valuemin', String(min));
  el.setAttribute('aria-valuemax', String(max));

  let currentValue = clamp(def, min, max);

  function paint(v) {
    const t = (v - min) / (max - min);
    arc.setAttribute('stroke-dashoffset', String(KNOB_ARC_LEN * (1 - t)));
    pointer.setAttribute('transform', `rotate(${-135 + 270 * t} 24 24)`);
    const display = formatValue(v, step);
    if (valEl) valEl.textContent = display;
    el.setAttribute('aria-valuenow', String(v));
    el.setAttribute('aria-valuetext', display);
    el.classList.toggle('modified', !nearlyEqual(v, def));
  }

  function setValue(v, { persist = true } = {}) {
    let next = snapToStep(clamp(v, min, max), min, step);
    if (isInt) next = Math.round(next);
    if (next === currentValue) return;
    currentValue = next;
    state[stateKey] = next;
    paint(next);
    if (persist) schedulePersist();
  }
  function getValue() { return currentValue; }

  // Drag (vertical)
  let dragging = false;
  let lastY = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    lastY = e.clientY;
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    el.focus();
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = lastY - e.clientY;
    if (dy === 0) return;
    lastY = e.clientY;
    const range = max - min;
    const fineMult = e.shiftKey ? 0.1 : 1;
    setValue(currentValue + (dy / KNOB_DRAG_PX) * range * fineMult);
  });
  const stopDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    el.releasePointerCapture(e.pointerId);
    el.classList.remove('dragging');
  };
  el.addEventListener('pointerup', stopDrag);
  el.addEventListener('pointercancel', stopDrag);

  el.addEventListener('dblclick', (e) => { setValue(def); e.preventDefault(); });

  el.addEventListener('keydown', (e) => {
    let next = currentValue;
    const big = step * 10;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight': next = currentValue + step; break;
      case 'ArrowDown':
      case 'ArrowLeft':  next = currentValue - step; break;
      case 'PageUp':     next = currentValue + big;  break;
      case 'PageDown':   next = currentValue - big;  break;
      case 'Home':       next = min; break;
      case 'End':        next = max; break;
      default: return;
    }
    e.preventDefault();
    setValue(next);
  });

  let wheelAccum = 0;
  el.addEventListener('wheel', (e) => {
    if (document.activeElement !== el && !el.matches(':hover')) return;
    e.preventDefault();
    let dyPx = e.deltaY;
    if (e.deltaMode === 1) dyPx *= WHEEL_TICK_PX;
    else if (e.deltaMode === 2) dyPx *= window.innerHeight;
    wheelAccum += dyPx;
    let ticks = 0;
    while (wheelAccum <= -WHEEL_TICK_PX) { wheelAccum += WHEEL_TICK_PX; ticks++; }
    while (wheelAccum >=  WHEEL_TICK_PX) { wheelAccum -= WHEEL_TICK_PX; ticks--; }
    if (!ticks) return;
    const mult = e.shiftKey ? 10 : 1;
    setValue(currentValue + ticks * step * mult);
  }, { passive: false });

  paint(currentValue);
  state[stateKey] = currentValue;
  knobRegistry.set(id, { setValue, getValue, min, max, step, default: def, stateKey, el });
}

// Reveal hidden cards while initing so SVGs lay out
const _hiddenCards = [...document.querySelectorAll('.effect-card.hidden')];
_hiddenCards.forEach(c => c.classList.remove('hidden'));
document.querySelectorAll('[data-knob]').forEach(initKnob);
_hiddenCards.forEach(c => c.classList.add('hidden'));

// ---- Toggle groups ----
const GL_SECTIONS    = ['voronoi','cellular','ascii','shatter','erode','wave','oxide','synth','biolum','thermo','falsecolor'];
const FULL_FRAME_SET = new Set(GL_SECTIONS);
const GL_RESETS      = { voronoi: resetVoronoi, cellular: resetCA, wave: resetWave };

const TOGGLE_CONFIG = [
  ['speed-group',       'speed',       parseFloat, (v) => { video.playbackRate = v; }],
  ['shape-group',       'shape',       String,     null],
  ['style-group',       'regionStyle', String,     null],
  ['filter-group',      'filter',      String,     onFilterChange],
  ['detect-mode-group', 'detectMode',  String,     () => { resetFrameHistory(); }],
  ['blob-size-group',   'blobSize',    parseInt,   null],
  ['erode-mode-group',  'erodeMode',   parseInt,   null],
  ['false-band-group',  'falseBand',   parseInt,   null],
];

function onFilterChange(v) {
  for (const name of GL_SECTIONS) {
    const el = document.getElementById(`${name}-controls`);
    if (el) {
      const visible = v === name;
      el.classList.toggle('hidden', !visible);
      el.classList.toggle('active-card', visible);
    }
  }
  for (const [name, fn] of Object.entries(GL_RESETS)) {
    if (v !== name) fn();
  }
  // Empty-card shows when no GL effect is active OR for non-GL filters too
  emptyCard.classList.toggle('hidden', GL_SECTIONS.includes(v));
  if (v === 'none') {
    emptyCard.textContent = 'Pick an effect to shape the signal.';
  } else if (!GL_SECTIONS.includes(v)) {
    emptyCard.textContent = `${v.toUpperCase()} runs per-blob — no parameters.`;
  }
  const active = document.getElementById(`${v}-controls`);
  if (active && !active.classList.contains('hidden')) {
    active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function setToggleGroupValue(groupId, value) {
  const group = document.getElementById(groupId);
  if (!group) return;
  const isRadio = group.getAttribute('role') === 'radiogroup';
  group.querySelectorAll('.toggle-btn').forEach(b => {
    const match = b.dataset.value === String(value);
    b.classList.toggle('active', match);
    if (isRadio) b.setAttribute('aria-checked', match ? 'true' : 'false');
    else         b.setAttribute('aria-pressed', match ? 'true' : 'false');
  });
}

function wireToggleGroup(groupId, stateKey, parser, onChange) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    setToggleGroupValue(groupId, btn.dataset.value);
    state[stateKey] = parser(btn.dataset.value);
    if (onChange) onChange(state[stateKey]);
    schedulePersist();
  });
  group.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const buttons = [...group.querySelectorAll('.toggle-btn')];
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    const next = e.key === 'ArrowRight'
      ? (i + 1) % buttons.length
      : (i - 1 + buttons.length) % buttons.length;
    buttons[next].focus();
    buttons[next].click();
    e.preventDefault();
  });
}
TOGGLE_CONFIG.forEach(([id, key, parser, onChange]) => wireToggleGroup(id, key, parser, onChange));

// ---- Color (swatches + native picker) ----
const colorPicker = document.getElementById('overlay-color');
const colorLabel  = document.getElementById('overlay-color-val');

function updateOverlayColor(value) {
  state.overlayColor = value;
  colorPicker.value = value;
  colorLabel.textContent = value;
  swatchGrid.querySelectorAll('.swatch-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.swatch.toLowerCase() === value.toLowerCase());
  });
  schedulePersist();
}

colorPicker.addEventListener('input', () => updateOverlayColor(colorPicker.value));
swatchGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('.swatch-btn');
  if (!btn) return;
  updateOverlayColor(btn.dataset.swatch);
});

// ---- Apply persisted state to UI ----
function applyStateToUI() {
  for (const [, info] of knobRegistry) {
    const v = state[info.stateKey];
    if (typeof v === 'number' && !Number.isNaN(v)) info.setValue(v, { persist: false });
  }
  for (const [groupId, key, , onChange] of TOGGLE_CONFIG) {
    setToggleGroupValue(groupId, state[key]);
    if (onChange) onChange(state[key]);
  }
  updateOverlayColor(state.overlayColor);
  video.playbackRate = state.speed;
}

// ---- Persistence ----
let persistTimer = 0;
function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      const { hasSource, ...persistable } = state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
    } catch { /* ignore */ }
  }, 200);
}
function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    for (const k of Object.keys(DEFAULTS)) if (k in parsed) state[k] = parsed[k];
  } catch { /* ignore */ }
}

// ---- Reset (two-stage confirm) ----
let resetConfirmTimer = 0;
function performFullReset() {
  for (const k of Object.keys(DEFAULTS)) state[k] = DEFAULTS[k];
  applyStateToUI();
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  showToast('Reset to defaults', 'ok', 2500);
}
btnReset.addEventListener('click', () => {
  if (btnReset.classList.contains('confirming')) {
    clearTimeout(resetConfirmTimer);
    btnReset.classList.remove('confirming');
    btnReset.textContent = 'Reset';
    performFullReset();
    return;
  }
  btnReset.classList.add('confirming');
  btnReset.textContent = 'Confirm?';
  clearTimeout(resetConfirmTimer);
  resetConfirmTimer = setTimeout(() => {
    btnReset.classList.remove('confirming');
    btnReset.textContent = 'Reset';
  }, 3000);
});

// ---- Per-card reset (× button) ----
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-reset-card]');
  if (!btn) return;
  const card = btn.closest('.effect-card');
  if (!card) return;
  // Reset all knobs in the card
  card.querySelectorAll('[data-knob]').forEach(k => {
    const info = knobRegistry.get(k.id);
    if (info) info.setValue(info.default);
  });
  // Reset toggles in the card (erode-mode-group, false-band-group)
  card.querySelectorAll('.toggle-group').forEach(group => {
    const cfg = TOGGLE_CONFIG.find(([gid]) => gid === group.id);
    if (!cfg) return;
    const [, key, parser, onChange] = cfg;
    const defValue = DEFAULTS[key];
    setToggleGroupValue(group.id, defValue);
    state[key] = parser(String(defValue));
    if (onChange) onChange(state[key]);
  });
  schedulePersist();
  showToast(`${card.dataset.cardEffect.toUpperCase()} reset`, 'ok', 1500);
});

// ---- Snapshot ----
function takeSnapshot() {
  if (!state.hasSource) {
    showToast('Load a video or open the camera first', 'error');
    return;
  }
  canvas.toBlob((blob) => {
    if (!blob) { showToast('Snapshot failed', 'error'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `fluxkit-${ts}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Frame saved', 'ok', 2000);
  }, 'image/png');
}
btnSnapshot.addEventListener('click', takeSnapshot);

// ---- Help panel ----
function openHelp()  { helpOverlay.classList.remove('hidden'); helpClose.focus(); }
function closeHelp() { helpOverlay.classList.add('hidden'); }
btnHelp.addEventListener('click', openHelp);
helpClose.addEventListener('click', closeHelp);
helpOverlay.addEventListener('click', (e) => { if (e.target === helpOverlay) closeHelp(); });

// ---- FPS overlay ----
let fpsEnabled = false;
let fpsLastT = performance.now();
let fpsAccum = 0;
let fpsFrames = 0;
function updateFps(blobCount) {
  const now = performance.now();
  fpsAccum += now - fpsLastT;
  fpsLastT = now;
  fpsFrames++;
  if (fpsAccum >= 500) {
    const fps = Math.round((fpsFrames * 1000) / fpsAccum);
    fpsOverlay.textContent = `${fps} fps · ${blobCount} blobs`;
    fpsAccum = 0;
    fpsFrames = 0;
  }
}
btnFps.addEventListener('click', () => {
  fpsEnabled = !fpsEnabled;
  fpsOverlay.classList.toggle('hidden', !fpsEnabled);
  btnFps.classList.toggle('confirming', fpsEnabled);
});

// ---- Keyboard shortcuts (global) ----
document.addEventListener('keydown', (e) => {
  // Ignore when typing in input/textarea or interacting with knob/toggle
  const tag = (document.activeElement?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === 'Escape' && !helpOverlay.classList.contains('hidden')) {
    closeHelp(); e.preventDefault(); return;
  }
  if (e.key === '?' || (e.key === '/' && e.shiftKey)) { openHelp(); e.preventDefault(); return; }
  if ((e.key === 's' || e.key === 'S') && document.activeElement?.dataset?.knob === undefined) {
    if (!document.activeElement?.classList?.contains('knob')) { takeSnapshot(); e.preventDefault(); }
    return;
  }
  if ((e.key === 'f' || e.key === 'F') && !document.activeElement?.classList?.contains('knob')) {
    btnFps.click(); e.preventDefault();
  }
});

// ---- File upload ----
document.getElementById('btn-upload').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  loadVideoSource(URL.createObjectURL(file), file.name);
});

// ---- Camera ----
document.getElementById('btn-camera').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    video.removeAttribute('src');
    video.srcObject = stream;
    await video.play();
    resetAllState();
    setHasSource(true, 'Camera');
    videoControls.classList.add('hidden');     // no scrub for camera
    showToast('Camera active', 'ok', 2000);
  } catch (err) {
    showToast(`Camera unavailable: ${err.message || err.name}`, 'error', 6000);
  }
});

function loadVideoSource(url, label) {
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  video.src = url;
  video.loop = true;
  video.play().catch(() => {});
  resetAllState();
  setHasSource(true, label || 'Video');
  videoControls.classList.remove('hidden');    // scrub available for files
}

function resetAllState() {
  resetFrameHistory(); resetTracker(); resetVoronoi(); resetCA(); resetWave();
  cachedBlobs = []; frameCount = 0;
}

function updateSourceLabel(text) {
  fileStatus.textContent = text;
  topbarSource.textContent = text;
}

function setHasSource(val, label) {
  state.hasSource = val;
  placeholder.style.display = val ? 'none' : 'flex';
  btnSnapshot.disabled = !val;
  if (val) {
    const dims = (video.videoWidth && video.videoHeight)
      ? ` · ${video.videoWidth}×${video.videoHeight}` : '';
    updateSourceLabel((label || 'Source') + dims);
    if (rafHandle === 0) rafHandle = requestAnimationFrame(renderFrame);
  } else {
    updateSourceLabel('No source loaded');
  }
}

video.addEventListener('loadedmetadata', () => {
  resizeCanvas();
  if (state.hasSource && video.videoWidth && video.videoHeight) {
    const current = fileStatus.textContent.split(' · ')[0];
    updateSourceLabel(`${current} · ${video.videoWidth}×${video.videoHeight}`);
  }
});

// ---- Drag & drop ----
let dragDepth = 0;
function isFileDrag(e) {
  return e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
}
canvasArea.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth++;
  dropOverlay.classList.add('visible');
});
canvasArea.addEventListener('dragover', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
canvasArea.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.classList.remove('visible');
});
canvasArea.addEventListener('drop', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.remove('visible');
  const file = [...(e.dataTransfer.files || [])][0];
  if (!file) return;
  if (!file.type.startsWith('video/')) {
    showToast(`Not a video file: ${file.type || 'unknown type'}`, 'error');
    return;
  }
  loadVideoSource(URL.createObjectURL(file), file.name);
});

// ---- Video playback controls (hover-only, idle-hide) ----
let controlsIdleTimer = 0;
function showControls() {
  if (videoControls.classList.contains('hidden')) return;     // camera mode
  videoControls.classList.add('visible');
  clearTimeout(controlsIdleTimer);
  controlsIdleTimer = setTimeout(() => videoControls.classList.remove('visible'), 2000);
}
canvasArea.addEventListener('pointermove', showControls);
canvasArea.addEventListener('pointerleave', () => {
  clearTimeout(controlsIdleTimer);
  videoControls.classList.remove('visible');
});
videoControls.addEventListener('pointerenter', () => clearTimeout(controlsIdleTimer));

btnPlay.addEventListener('click', () => {
  if (video.paused) { video.play().catch(() => {}); }
  else { video.pause(); }
});
video.addEventListener('play',  () => { btnPlay.textContent = '❚❚'; btnPlay.setAttribute('aria-label', 'Pause'); });
video.addEventListener('pause', () => { btnPlay.textContent = '▶';  btnPlay.setAttribute('aria-label', 'Play'); });

let scrubbing = false;
videoScrub.addEventListener('input', () => {
  scrubbing = true;
  if (!isFinite(video.duration)) return;
  const t = (parseFloat(videoScrub.value) / 1000) * video.duration;
  video.currentTime = t;
  videoTime.textContent = `${formatTime(t)} / ${formatTime(video.duration)}`;
});
videoScrub.addEventListener('change', () => { scrubbing = false; });

video.addEventListener('timeupdate', () => {
  if (scrubbing || !isFinite(video.duration) || video.duration === 0) return;
  const pct = video.currentTime / video.duration;
  videoScrub.value = String(Math.round(pct * 1000));
  videoTime.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
});

// ---- Canvas sizing ----
function resizeCanvas() {
  const aw = canvasArea.clientWidth;
  const ah = canvasArea.clientHeight;
  if (!state.hasSource || video.videoWidth === 0) {
    canvas.width = aw; canvas.height = ah; return;
  }
  const vRatio = video.videoWidth / video.videoHeight;
  const aRatio = aw / ah;
  let cw, ch;
  if (aRatio > vRatio) { ch = ah; cw = Math.round(ah * vRatio); }
  else                 { cw = aw; ch = Math.round(aw / vRatio); }
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw; canvas.height = ch;
  }
}
// Resize is event-driven (ResizeObserver on the canvas area + window-resize
// fallback + video metadata load). Reading clientWidth/clientHeight every
// frame forces layout; this moves that cost off the hot render loop.
const _ro = new ResizeObserver(resizeCanvas);
_ro.observe(canvasArea);
window.addEventListener('resize', resizeCanvas);

// ---- Per-render-frame blob smoothing (EMA on tracker-id-keyed positions) ----
// state.blobSmooth = 0 → bypass (instant response, current behaviour).
// state.blobSmooth → 1 → strong EMA, blobs lag for visual smoothness.
// Solves both: per-frame jitter at updateInterval=1, and the freeze+snap
// at updateInterval>1 (between detections, displayed positions interpolate
// toward the cached target instead of sitting still).
const _displayBlobs = new Map(); // id → smoothed blob

function smoothBlobs(latest) {
  const smooth = state.blobSmooth;
  if (smooth <= 0.001) {
    if (_displayBlobs.size) _displayBlobs.clear();
    return latest;
  }
  // alpha is the per-frame pull toward the target.
  // smooth=0   → alpha=1.0   (instant, but bypassed above)
  // smooth=0.5 → alpha=0.525 (responsive)
  // smooth=1   → alpha=0.05  (very smooth, ~14-frame half-life @ 60fps)
  const alpha = 1 - smooth * 0.95;
  const next = new Map();
  const out = new Array(latest.length);
  for (let i = 0; i < latest.length; i++) {
    const b = latest[i];
    const prev = _displayBlobs.get(b.id);
    let d;
    if (!prev) {
      d = { ...b };
    } else {
      const x  = prev.x  + (b.x  - prev.x ) * alpha;
      const y  = prev.y  + (b.y  - prev.y ) * alpha;
      const w  = prev.w  + (b.w  - prev.w ) * alpha;
      const h  = prev.h  + (b.h  - prev.h ) * alpha;
      const cx = prev.cx + (b.cx - prev.cx) * alpha;
      const cy = prev.cy + (b.cy - prev.cy) * alpha;
      d = { ...b, x, y, w, h, cx, cy };
    }
    next.set(b.id, d);
    out[i] = d;
  }
  _displayBlobs.clear();
  for (const [k, v] of next) _displayBlobs.set(k, v);
  return out;
}

// ---- Render loop ----
function renderFrame() {
  if (!state.hasSource) { rafHandle = 0; return; }
  rafHandle = requestAnimationFrame(renderFrame);
  if (video.readyState < 2 || video.videoWidth === 0) return;

  const cw = canvas.width;
  const ch = canvas.height;
  ctx.drawImage(video, 0, 0, cw, ch);

  const ow = Math.max(1, Math.round(cw * DETECT_SCALE));
  const oh = Math.max(1, Math.round(ch * DETECT_SCALE));
  if (offscreen.width !== ow || offscreen.height !== oh) {
    offscreen.width = ow; offscreen.height = oh;
  }
  offCtx.drawImage(video, 0, 0, ow, oh);
  const offImageData = offCtx.getImageData(0, 0, ow, oh);

  frameCount++;
  if (frameCount % state.updateInterval === 0) {
    const rawBlobs  = detectBlobs(offImageData, state.threshold, state.maxBlobs, state.detectMode);
    const sx = cw / ow, sy = ch / oh;
    const scaledRaw = rawBlobs.map(b => ({
      ...b, x: b.x*sx, y: b.y*sy, w: b.w*sx, h: b.h*sy, cx: b.cx*sx, cy: b.cy*sy,
    }));
    cachedBlobs = trackBlobs(scaledRaw, cw, state.maxBlobs);
  }
  const blobs = smoothBlobs(cachedBlobs);

  const f = state.filter;
  if (f === 'voronoi') {
    applyVoronoi(ctx, video, cw, ch, {
      threshold: state.voronoiThreshold, jumpDist: state.voronoiJumpDist,
      falloff: state.voronoiFalloff, edgeLines: state.voronoiEdgeLines,
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

  // Per-blob CPU filters: ONE full-frame getImageData, N region passes that
  // share the buffer, ONE putImageData. Replaces the old N-round-trip pattern
  // (was 12-30 GPU↔CPU stalls per frame at maxBlobs default). Skipped entirely
  // when no CPU filter is active so the display canvas stays GPU-resident.
  if (state.filter !== 'none' && !FULL_FRAME_SET.has(state.filter) && blobs.length > 0 && state.blobSize > 0) {
    const full = ctx.getImageData(0, 0, cw, ch);
    const blobScale = state.blobSize / 64;
    let touched = false;
    for (const blob of blobs) {
      const cx = blob.x + blob.w / 2;
      const cy = blob.y + blob.h / 2;
      const sw = blob.w * blobScale;
      const sh = blob.h * blobScale;
      const bx = Math.max(0, Math.floor(cx - sw / 2));
      const by = Math.max(0, Math.floor(cy - sh / 2));
      const bw = Math.min(cw - bx, Math.ceil(sw));
      const bh = Math.min(ch - by, Math.ceil(sh));
      if (bw <= 0 || bh <= 0) continue;
      applyFilterToSubregion(full.data, cw, bx, by, bw, bh, state.filter, state.shape);
      touched = true;
    }
    if (touched) ctx.putImageData(full, 0, 0);
  }

  drawOverlays(ctx, blobs, state.regionStyle, state.shape, state.connectionRate, state.strokeWidth, state.blobSize, state.fontSize, state.overlayColor);

  if (fpsEnabled) updateFps(blobs.length);
}

// ---- Init ----
loadPersistedState();
applyStateToUI();
canvas.width  = canvasArea.clientWidth;
canvas.height = canvasArea.clientHeight;
btnSnapshot.disabled = !state.hasSource;
