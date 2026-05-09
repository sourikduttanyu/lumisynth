import './style.css';
import { detectBlobs, resetFrameHistory } from './blobDetector.js';
import { applyFilterToSubregion } from './filters.js';
import { drawTrackOverlay, resetTrackOverlay } from './overlays.js';
import { trackBlobs, resetTracker } from './kalman.js';
import { applyASCII } from './ascii.js';
import { applyGLFilter } from './glFilters.js';
import { ensureContext, uploadVideoFrame, compositeToCanvas2D, getChainFBOs } from './glContext.js';
import { applyCompose } from './glCompose.js';
import { BlobOneEuroFilter } from './oneEuroFilter.js';

const DEFAULTS = Object.freeze({
  // Source / playback.
  speed: 1,

  // SYNTH-mode pipeline.
  // - structure: 'none' | 'ascii' | 'erode'
  // - colorRack: array of 3 slots (see makeColorRack()) — initialized at
  //   startup, not in DEFAULTS, because each slot has a fresh per-instance id.
  // - perBlob: 'none' | 'inv' | 'thermal' (legacy holding pen)
  structure: 'none', perBlob: 'none',
  asciiCellSize: 0.3, asciiContrast: 0.3, asciiBlackThresh: 0.2, asciiGlyphStrength: 0.9,
  erodeMode: 0,       erodeRadius: 0.3,    erodeStrength: 0.7,    erodeEdge: 0.0,

  // ============ TRACK-mode state ============
  // Top-level mode + composite selector.
  //   mode:           'synth' | 'track'  — controls body[data-mode] attr
  //                                         and which sidebar sections show
  //   trackComposite: 'overlay' | 'isolated'
  mode: 'synth',
  trackComposite: 'overlay',

  // Detection (TRACK mode owns these; SYNTH mode silently uses them too,
  // since the per-blob legacy path needs detected blobs).
  //   trackChannel:    'motion' | 'luma' | 'dark' | 'sat' | 'edge' | 'sharp'
  //   threshold        10..100 — direct detection threshold passed to blobDetector
  //   trackMinSize     4..200 px (in source pixels) — passed to blobDetector
  //   trackStability   0..1   — feeds the one-euro smoother
  //   trackMaxBlobs    5..30  — max blobs returned per frame
  //   updateInterval   1..30  — run detection every N frames (1 = every frame)
  trackChannel: 'motion',
  threshold: 30,
  trackMinSize: 8,
  trackStability: 0,
  trackMaxBlobs: 12,
  updateInterval: 1,

  // Shape (one active style + 4 knobs).
  //   trackShape:           'solid' | 'hollow' | 'dotted' | 'corners'
  //   trackShapeColor       0..1  — hue knob (0=white)
  //   trackShapeThickness   1..8  — line/dot weight
  //   trackShapePadding   -20..20 — bbox padding
  //   trackShapeStyle       0..1  — style-specific knob (varies per shape)
  trackShape: 'solid',
  trackShapeColor: 0, trackShapeThickness: 2, trackShapePadding: 0, trackShapeStyle: 0.5,

  // Lines (5 graph types + 4 knobs).
  //   trackLines:           'off' | 'distthresh' | 'velocity' | 'pulse' | 'constellation'
  //   trackLinesColor       0..1
  //   trackLinesThickness   1..6
  //   trackLinesParam       0..1  — type-specific
  //   trackLinesTaper       0..1
  trackLines: 'off',
  trackLinesColor: 0, trackLinesThickness: 1, trackLinesParam: 0.5, trackLinesTaper: 0,

  // Track FX rack (3 slots, like colorRack) — initialized via makeTrackFxRack()
  // at startup. Stores up to 3 stackable tracking effects: echo / radar / heatmap.
});

// Storage key bumped because the state schema changed: STRUCTURE lost
// voronoi/cellular/wave/shatter, detection knobs renamed, BlobTracking
// (TRACK-mode) state added. Old v2 saves are dropped silently.
const STORAGE_KEY = 'fluxkit-state-v3';

// Color rack: 3 fixed slots, each holding one COLOR effect (or empty), with
// per-slot enable/disable + drag-to-reorder. Renders in series — slot 0 reads
// STRUCTURE's output (or raw video), each subsequent slot reads the previous
// slot's output. Disabled slots are skipped in the chain entirely.
//
// Always exactly RACK_SLOTS slots — the user fills, empties, and reorders
// them but never adds/removes the slot itself. Keeping a fixed-shape array
// makes the DOM stable for drag-and-drop and simplifies persistence.
const RACK_SLOTS = 3;

// Schema for COLOR effect parameters. Source of truth for what knobs/toggles
// each color effect exposes, their defaults, and human-readable copy. Lives
// in JS (not in HTML data-attrs as before) because color knobs no longer
// exist in the right-panel cards — they're rendered inline inside the rack
// slot when expanded, and each slot owns its OWN copy of these params. So
// "synth in slot 0" and "synth in slot 2" can have different knob values.
//
// Param keys are SHORT names (corr, metal) not the legacy long stateKeys
// (oxideCorr, oxideMetal). They live under `slot.params[paramKey]` so they
// can't collide across effect types — the slot always knows what type it is.
//
// `order` is the [4]-tuple ordering passed to applyGLFilter (uniform layout
// in the shader). Must match the shader's expected uniform order exactly.
const COLOR_PARAM_SCHEMAS = {
  oxide: {
    knobs: [
      { key: 'corr',  label: 'Corrosion', min: 0, max: 1, step: 0.01, default: 0.5, tip: 'Corrosion blend. 0 = fresh polished metal. 1 = fully aged patina (dark, mottled).' },
      { key: 'metal', label: 'Metal',     min: 0, max: 1, step: 0.01, default: 0,   tip: 'Metal type. 0 = copper / verdigris. 0.5 = iron / rust. 1 = silver / tarnish.' },
      { key: 'rough', label: 'Rough',     min: 0, max: 1, step: 0.01, default: 0.3, tip: 'Surface roughness noise. 0 = smooth metal. 1 = pitted, granular surface.' },
      { key: 'sheen', label: 'Sheen',     min: 0, max: 1, step: 0.01, default: 0.3, tip: 'Edge specular highlight. 0 = matte. 1 = polished metal with bright edges along luma transitions.' },
    ],
    toggles: [],
    order: ['corr', 'metal', 'rough', 'sheen'],
  },
  synth: {
    knobs: [
      { key: 'warm', label: 'Warmth',    min: 0, max: 1, step: 0.01, default: 0.5, tip: 'Warm-cool color bias inside each band. Low = cool (blue / teal lean). High = warm (red / orange lean).' },
      { key: 'sep',  label: 'Sep',       min: 0, max: 1, step: 0.01, default: 0.3, tip: 'Number of discrete color bands (3-12). Off below ~0.1 (smooth ramp). Higher = more posterized banding.' },
      { key: 'res',  label: 'Res',       min: 0, max: 1, step: 0.01, default: 0.4, tip: 'Resonance modulation inside each band. 0 = clean steps. 1 = strong sinusoidal brightness ripples per band.' },
      { key: 'dyn',  label: 'Dyn Range', min: 0, max: 1, step: 0.01, default: 0.7, tip: 'Dynamic range / gamma. Low = compressed midtones (flat, washed). High = stretched midtones (punchy, contrasty).' },
    ],
    toggles: [],
    order: ['warm', 'sep', 'res', 'dyn'],
  },
  biolum: {
    knobs: [
      { key: 'glow',  label: 'Glow',  min: 0, max: 1, step: 0.01, default: 0.7, tip: 'Glow intensity. Low = subtle deep-sea darkness. High = strong luminous bloom on bright regions.' },
      { key: 'color', label: 'Color', min: 0, max: 1, step: 0.01, default: 0,   tip: 'Hue of the glow. 0 = green-cyan. 1 = violet. Smooth interpolation in between.' },
      { key: 'pulse', label: 'Pulse', min: 0, max: 1, step: 0.01, default: 0.2, tip: 'Pulse modulation. 0 = steady glow. 1 = strong sinusoidal pulsing tied to local brightness.' },
      { key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, default: 0.7, tip: 'Depth fade. 0 = uniform glow regardless of brightness. 1 = darker regions stay deep / unlit (sense of underwater depth).' },
    ],
    toggles: [],
    order: ['glow', 'color', 'pulse', 'depth'],
  },
  thermo: {
    knobs: [
      { key: 'cont',  label: 'Contrast', min: 0, max: 1, step: 0.01, default: 0.4, tip: 'Thermal map contrast around the midpoint. Higher = sharper hot/cold separation; lower = flatter pseudo-color.' },
      { key: 'hot',   label: 'Hot',      min: 0, max: 1, step: 0.01, default: 0,   tip: 'Bias the entire ramp toward hot. 0 = baseline. 1 = everything reads as yellow / red / white (overheated).' },
      { key: 'cold',  label: 'Cold',     min: 0, max: 1, step: 0.01, default: 0.1, tip: 'Cold floor. Lifts the darkest regions toward blue. 0 = pure black floor. 1 = blue-tinted shadows (more visible cold side).' },
      { key: 'white', label: 'White Pt', min: 0, max: 1, step: 0.01, default: 0.5, tip: 'White-hot clipping. Bright peaks above ~0.85 fade to pure white as this rises (simulates sensor saturation).' },
    ],
    toggles: [],
    order: ['cont', 'hot', 'cold', 'white'],
  },
  falsecolor: {
    knobs: [
      { key: 'palette', label: 'Palette', min: 0, max: 1, step: 0.01, default: 0.25, tip: 'Cross-fade between four palettes: Thermal (0) → Neon (0.25) → Acid (0.5) → Ice (0.75) → back to Thermal (1).' },
      { key: 'bandcnt', label: 'Bands',   min: 0, max: 1, step: 0.01, default: 0.5,  tip: 'Number of discrete color bands when Banding is On (4-20). Smaller = chunkier posterized look. Has no effect when Banding is Off.' },
      { key: 'bright',  label: 'Bright',  min: 0, max: 1, step: 0.01, default: 0.5,  tip: 'Brightness offset added to the input. 0.5 = neutral. Below 0.5 = darker (palette shifts cooler). Above 0.5 = brighter (palette shifts hotter).' },
    ],
    // 0 = smooth ramp, 1 = banded. Discrete toggle, not a continuous knob.
    toggles: [
      { key: 'band', label: 'Banding', default: 0, options: [
        { value: 0, label: 'Off', tip: 'Smooth continuous palette ramp (no banding).' },
        { value: 1, label: 'On',  tip: 'Discrete banded ramp. Use the Bands knob to set how many color steps.' },
      ]},
    ],
    // Shader uniform order: [palette, band, bandcnt, bright]
    order: ['palette', 'band', 'bandcnt', 'bright'],
  },
};

// Build a fresh factory-defaults params object for an effect type. Every
// new slot pick goes through this — the user's request was "factory" for
// every slot (not "inherit current global tweaks"), so this is the only
// initializer for slot params. There's no "inherit" path.
function makeFactoryParams(type) {
  const schema = COLOR_PARAM_SCHEMAS[type];
  if (!schema) return {};
  const p = {};
  for (const k of schema.knobs)   p[k.key] = k.default;
  for (const t of schema.toggles) p[t.key] = t.default;
  return p;
}

// Per-instance slot ids. Used as DOM keys + drag-and-drop identity. Stable
// across re-renders so dragging a slot doesn't recreate its DOM mid-drag.
function makeSlotId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `slot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function makeColorRack() {
  return Array.from({ length: RACK_SLOTS }, () => ({
    id: makeSlotId(),
    type: 'none',
    enabled: false,
    // Per-slot params — factory defaults via makeFactoryParams when the
    // slot is filled. Empty slots carry an empty {} so the field is always
    // present (avoids undefined checks throughout the render path).
    params: {},
  }));
}

// ============================================================
// TRACK FX RACK — same 3-slot pattern as colorRack but for the spec's
// three TRACK-mode effects (echo blobs / radar sweep / heatmap residue).
// Each slot has the same shape (id, type, enabled, params); the picker,
// schemas, and dispatch are independent.
// ============================================================
const TRACK_FX_PARAM_SCHEMAS = {
  echo: {
    knobs: [
      { key: 'depth',   label: 'Depth',   min: 1, max: 10, step: 1,    default: 4,   tip: 'How many past blob positions show. 1 = single ghost. 10 = long fading trail of bbox echoes.' },
      { key: 'opacity', label: 'Opacity', min: 0, max: 1,  step: 0.01, default: 0.5, tip: 'Visibility of the echo bboxes. 0 = invisible. 1 = full strength echoes.' },
      { key: 'decay',   label: 'Decay',   min: 0, max: 1,  step: 0.01, default: 0.5, tip: 'Falloff curve. 0 = chunky (equal opacity per echo step). 1 = smooth exponential taper.' },
      { key: 'offset',  label: 'Offset',  min: 0, max: 1,  step: 0.01, default: 0,   tip: '0 = echoes sit exactly where the blob was. 1 = scaled-down or scaled-up slightly per step (depth pulse).' },
    ],
    order: ['depth', 'opacity', 'decay', 'offset'],
  },
  radar: {
    knobs: [
      { key: 'speed',      label: 'Speed', min: 0, max: 1, step: 0.01, default: 0.4, tip: 'Rotation speed of the sweep arm.' },
      { key: 'trail',      label: 'Trail', min: 0, max: 1, step: 0.01, default: 0.4, tip: 'How long blobs persist after the sweep crosses them. 0 = brief flash. 1 = lingering glow.' },
      { key: 'sweepWidth', label: 'Width', min: 0, max: 1, step: 0.01, default: 0.3, tip: 'Width of the rotating arc. 0 = laser line. 1 = wide pie-slice.' },
      { key: 'direction',  label: 'Dir',   min: -1, max: 1, step: 0.01, default: 1,   tip: '-1 = sweeps counterclockwise. 0 = oscillates back and forth. +1 = sweeps clockwise.' },
    ],
    order: ['speed', 'trail', 'sweepWidth', 'direction'],
  },
  heatmap: {
    knobs: [
      { key: 'intensity', label: 'Int',    min: 0, max: 1, step: 0.01, default: 0.6, tip: 'Visibility of the heatmap layer.' },
      { key: 'decay',     label: 'Decay',  min: 0, max: 1, step: 0.01, default: 0.3, tip: 'How quickly old positions fade. 0 = forever. 1 = quick.' },
      { key: 'spread',    label: 'Spread', min: 0, max: 1, step: 0.01, default: 0.4, tip: 'Radius of the glow around each blob position. Low = pinpoint. High = wide bloom.' },
      { key: 'palette',   label: 'Pal',    min: 0, max: 1, step: 0.01, default: 0,   tip: '0 = thermal (red-yellow-white). 0.5 = cool (blue-cyan-white). 1 = rainbow.' },
    ],
    order: ['intensity', 'decay', 'spread', 'palette'],
  },
};

function makeTrackFxFactoryParams(type) {
  const schema = TRACK_FX_PARAM_SCHEMAS[type];
  if (!schema) return {};
  const p = {};
  for (const k of schema.knobs) p[k.key] = k.default;
  return p;
}

function makeTrackFxRack() {
  return Array.from({ length: RACK_SLOTS }, () => ({
    id: makeSlotId(),
    type: 'none',
    enabled: false,
    params: {},
  }));
}

// state.sourceKind tracks which input element is currently driving the chain:
//   null    — no source loaded
//   'video' — file-loaded HTMLVideoElement (#video, src= via createObjectURL)
//   'webcam'— same #video element, srcObject = MediaStream
//   'image' — HTMLImageElement (#image), still-frame source
// Not persisted (follows the source, which is not persisted across reloads).
const state = {
  ...DEFAULTS,
  hasSource: false,
  sourceKind: null,
  colorRack: makeColorRack(),
  trackFxRack: makeTrackFxRack(),
};

let frameCount  = 0;
let cachedBlobs = [];
let rafHandle   = 0;

const video        = document.getElementById('video');
const imageEl      = document.getElementById('image');
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
const btnRecord    = document.getElementById('btn-record');
const btnRecordLbl = document.getElementById('btn-record-label');
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
// (overlay-color swatch grid retired — replaced by per-shape/per-lines hue knob)

const offscreen = document.createElement('canvas');
const offCtx    = offscreen.getContext('2d', { willReadFrequently: true });
const DETECT_SCALE = 0.5;

// Render-loop FPS cap. Capped at 60 regardless of source video frame rate
// or display refresh rate. Reasoning:
//  - Display refresh ≥ 60Hz: the cap throttles the render loop to ~60Hz so
//    we don't burn CPU/GPU drawing identical pixels on a 120Hz/144Hz/240Hz
//    monitor (the source video tops out at 24/30/60 fps anyway — there's
//    no new input data at the higher cadence).
//  - Display refresh < 60Hz: hardware ceiling applies; the cap is a no-op.
//  - Source video at 24/30 fps: detect/track still runs every render frame,
//    but with cached video pixels it's mostly a no-op until the video
//    advances. The compositor still runs at 60 to keep UI overlays / blob
//    smoothing animations feeling smooth.
//
// FRAME_BUDGET_MS is the per-frame time budget. Tracked via accumulator
// (not raw "time since last frame") so the cap holds at exactly 60Hz on
// any refresh rate ≥ 60Hz instead of degrading to 48Hz on 144Hz panels.
const FPS_CAP        = 60;
const FRAME_BUDGET_MS = 1000 / FPS_CAP;

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

// initKnob has two modes:
//   1. Default (no opts): wires the knob to global `state[stateKey]`,
//      registers in knobRegistry, persists on change. This is the
//      original behavior used by every knob in the right-panel cards.
//   2. Slot-bound (opts.writeValue + opts.initialValue): wires the knob
//      to a custom write callback instead of global state, AND skips the
//      registry entry (registry is for global-state knobs only — slot
//      knobs render fresh from slot.params on every renderColorRack).
//
// The callback approach keeps the 140-line knob implementation single
// and avoids two parallel implementations drifting apart. Slot knobs
// still get full keyboard / wheel / drag / dblclick-reset behavior.
function initKnob(el, opts = {}) {
  const id      = el.id;
  const min     = parseFloat(el.dataset.min);
  const max     = parseFloat(el.dataset.max);
  const step    = parseFloat(el.dataset.step);
  const def     = parseFloat(el.dataset.default);
  const stateKey = el.dataset.state || kebabToCamel(id);
  const isInt   = step >= 1 && Number.isInteger(min) && Number.isInteger(max);
  const valEl   = document.getElementById(`${id}-val`);
  const isSlotKnob = !!opts.writeValue;

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

  // Slot knobs seed from slot.params (which may be != default if user has
  // tweaked them previously and it's now being re-rendered). Global knobs
  // seed from `def` and applyStateToUI re-seeds from persisted state.
  const seed = (opts.initialValue !== undefined) ? opts.initialValue : def;
  let currentValue = clamp(seed, min, max);

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
    if (isSlotKnob) opts.writeValue(next);
    else            state[stateKey] = next;
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
  if (isSlotKnob) {
    // Slot-bound: do NOT write to global state[stateKey] at init (would
    // pollute global state with per-slot values), and do NOT register in
    // the global knobRegistry (registry is for state-restoration of
    // global knobs; slot knobs re-init from slot.params on every render).
    opts.writeValue(currentValue);
  } else {
    state[stateKey] = currentValue;
    knobRegistry.set(id, { setValue, getValue, min, max, step, default: def, stateKey, el });
  }
}

// Reveal hidden cards while initing so SVGs lay out
const _hiddenCards = [...document.querySelectorAll('.effect-card.hidden')];
_hiddenCards.forEach(c => c.classList.remove('hidden'));
document.querySelectorAll('[data-knob]').forEach(initKnob);
_hiddenCards.forEach(c => c.classList.add('hidden'));

// ---- Toggle groups ----
// Pipeline categorization. STRUCTURE in v3 is the trimmed spec set:
// none / ASCII / Erode (per "remove extras from UI" — voronoi, cellular,
// shatter, wave were dropped because they're not in the spec's 9). COLOR
// effects remain per-slot in the rack.
const STRUCTURE_SECTIONS = ['ascii', 'erode'];
const COLOR_SECTIONS     = ['oxide','synth','biolum','thermo','falsecolor'];
// No GL_RESETS: ascii is stateless and erode is a single-frame
// morphological op, so neither needs a per-source-switch reset.
const GL_RESETS          = {};

// Centralized STRUCTURE effect dispatch: pulls per-effect knob values
// from global `state` and forwards them to the correct module with a
// uniform call shape. COLOR effects are dispatched separately via
// runColorEffect (each color slot owns its own params).
function runEffect(name, opts) {
  switch (name) {
    case 'ascii':
      return applyASCII(canvas.width, canvas.height, {
        cellSize: state.asciiCellSize, contrast: state.asciiContrast,
        blackThreshold: state.asciiBlackThresh, glyphStrength: state.asciiGlyphStrength,
      }, opts);
    case 'erode':
      return applyGLFilter('erode', canvas.width, canvas.height, [state.erodeMode, state.erodeRadius, state.erodeStrength, state.erodeEdge], opts);
    case 'oxide':
    case 'synth':
    case 'biolum':
    case 'thermo':
    case 'falsecolor':
      console.warn(`runEffect: ${name} is a per-slot COLOR effect; use runColorEffect(name, slotParams, opts).`);
      return;
    default:
      return;
  }
}

// Dispatch a single COLOR effect using the given slot's params. Same
// shape as runEffect but takes a params object (one slot's). Schema's
// `order` array drives the uniform tuple ordering — keeps the schema
// authoritative about what each shader expects.
function runColorEffect(name, params, opts) {
  const schema = COLOR_PARAM_SCHEMAS[name];
  if (!schema) return;
  const tuple = schema.order.map((k) => params[k]);
  return applyGLFilter(name, canvas.width, canvas.height, tuple, opts);
}

// Per-effect display blend mode used by compositeToCanvas2D when blitting
// the shared GL canvas onto the 2D display canvas (which already has the
// raw video drawn). Voronoi/wave/cellular use 'screen' to glow over the
// source; everything else opaque-replaces. Surfaced here (was hardcoded
// inside each effect module pre-P2a) so the orchestrator can pick the
// right blend per active effect, and so P2b can apply the terminal-stage
// rule when a chain runs (use the COLOR stage's blend mode at the final
// composite).
const BLEND_MODES = {
  ascii:      'source-over',
  erode:      'source-over',
  oxide:      'source-over',
  synth:      'source-over',
  biolum:     'source-over',
  thermo:     'source-over',
  falsecolor: 'source-over',
};

const TOGGLE_CONFIG = [
  ['speed-group',           'speed',          parseFloat, (v) => { video.playbackRate = v; }],
  ['structure-group',       'structure',      String,     onStructureChange],
  ['perblob-group',         'perBlob',        String,     onPerBlobChange],
  ['erode-mode-group',      'erodeMode',      parseInt,   null],
  // ============ TRACK-mode toggle groups ============
  ['mode-group',            'mode',           String,     onModeChange],
  ['track-composite-group', 'trackComposite', String,     null],
  ['lumi-channel-group',    'trackChannel',   String,     () => { resetFrameHistory(); }],
  ['track-shape-group',     'trackShape',     String,     null],
  ['track-lines-group',     'trackLines',     String,     null],
];

// Resolve which effects render this frame. STRUCTURE plus 0-3 chained
// colors from the rack (only enabled, non-none slots, in slot order).
// Each color carries its slot's per-slot params so the chain renderer
// doesn't have to look them up by id mid-frame.
//
// Per-blob (Inv / Thermal) remains independent — always layers on top
// of whatever the main chain produced; not part of this resolver.
function resolveActivePipeline() {
  return {
    structure: state.structure !== 'none' ? state.structure : null,
    colors:    state.colorRack
      .filter((s) => s.enabled && s.type !== 'none')
      .map((s) => ({ type: s.type, params: s.params })),
  };
}

// Reveal/hide an effect-card based on whether its effect is currently
// selected. Only STRUCTURE effects still have right-panel cards — COLOR
// effects render their knobs INLINE inside their rack slot now (no
// right-panel card to show/hide). So this function only iterates the
// STRUCTURE set; COLOR is handled by renderColorRack instead.
function refreshEffectCardVisibility() {
  const { structure } = resolveActivePipeline();
  for (const name of STRUCTURE_SECTIONS) {
    const el = document.getElementById(`${name}-controls`);
    if (!el) continue;
    const isSelected = state.structure === name;
    el.classList.toggle('hidden',     !isSelected);
    el.classList.toggle('active-card', structure === name);
  }
}

// True only while applyStateToUI is replaying loaded state into the UI.
// Kept for symmetry with the rack render path (renderColorRack also
// dispatches handlers internally and could re-enter); unused by the
// remaining toggle-group handlers but cheap to retain.
let _applyingState = false;

function onStructureChange(v) {
  // Reset stateful GL effects (voronoi/cellular/wave keep persistent buffers
  // between frames; we clear the ones that are no longer active so they
  // don't resume mid-pattern when re-selected later).
  for (const [name, fn] of Object.entries(GL_RESETS)) {
    if (v !== name && STRUCTURE_SECTIONS.includes(name)) fn();
  }
  refreshEffectCardVisibility();
  if (v !== 'none') {
    const card = document.getElementById(`${v}-controls`);
    if (card && !card.classList.contains('hidden')) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}

// Per-blob (Inv / Thermal) has no associated effect-card and doesn't
// participate in the main-chain dispatch — it just toggles the per-blob
// CPU pass in renderFrame. Persistence is handled by the toggle wiring;
// this hook intentionally has no side effects beyond that.
function onPerBlobChange(_v) { /* intentionally empty */ }

// Mode toggle. Drives section visibility via body[data-mode] (the CSS
// rule [data-mode-section="track"] / [data-mode-section="synth"] reacts
// to this attribute). Also resets per-source overlay state when leaving
// TRACK so stale trails / heatmap residue don't bleed into the next
// session.
function onModeChange(v) {
  document.body.setAttribute('data-mode', v);
  if (v !== 'track') resetTrackOverlay();
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

// Overlay color picker (swatches + native picker) was retired — the
// per-shape COLOR knob (trackShapeColor) and per-lines COLOR knob
// (trackLinesColor) replace it. Their hue value drives every shape
// stroke / line stroke / dot in the new BlobTracking renderer.

// ============================================================
// COLOR RACK — custom widget (not a toggle group).
// Renders state.colorRack into #color-rack as 3 fixed slots, wires
// click-to-pick / toggle / remove / drag-to-reorder. See state.colorRack
// docstring for the data shape.
// ============================================================
const colorRackEl  = document.getElementById('color-rack');
const colorPickerEl = document.getElementById('color-picker-popover');

// Same gradient stops as the .filter-swatch-group buttons (style.css) so
// the chip swatch reads as the same identity. Inlined here because the
// per-slot gradient varies and these aren't shareable via a simple class
// (each slot needs its OWN gradient, picked from this lookup).
const RACK_SWATCH_GRADIENTS = {
  oxide:      'linear-gradient(90deg, #1a0a00, #8b4513, #cd853f, #d4af37)',
  synth:      'linear-gradient(90deg, #f72585, #b5179e, #7209b7, #4361ee, #4cc9f0)',
  biolum:     'linear-gradient(90deg, #001a1a, #00ffcc, #88ddff, #aa88ff)',
  thermo:     'linear-gradient(90deg, #000, #220066, #cc0066, #ff6600, #ffff00, #fff)',
  falsecolor: 'linear-gradient(90deg, #4361ee, #00d4ff, #5be7a6, #ffea00, #f72585)',
};
const RACK_LABEL = {
  oxide: 'Oxide', synth: 'Synth', biolum: 'BioLum', thermo: 'Thermo', falsecolor: 'FalseClr',
};

// Per-slot tooltip mirrors the picker's (so hovering the chip explains
// what the current effect does, same wording as picking it would have shown).
const RACK_CHIP_TIP = {
  oxide:      'Oxide / patina material in this slot. Re-skins the input as corroded metal. Click to swap.',
  synth:      'Synthwave color grade in this slot. Maps luma to a 6-band palette. Click to swap.',
  biolum:     'Bioluminescent glow in this slot. Re-tints the input as deep-water bioluminescence. Click to swap.',
  thermo:     'Thermal-camera ramp in this slot. Maps luma to deep blue → cyan → yellow → red → white. Click to swap.',
  falsecolor: 'False-color palette swap in this slot. Cross-fades between four palettes. Click to swap.',
};

// Currently-open picker state. picker is anchored beneath a chip; clicking
// outside closes it. Tracking the slot id (not DOM ref) survives any
// re-render between open and a pick action.
let _openPickerSlotId = null;

// Per-session expanded-state for slots. NOT persisted — refreshing the
// page collapses everything. The user opens the slot they want to tweak;
// next session they'll open it again. Keeping this in localStorage would
// mean stale "expanded" UI on a new session, which is more confusing
// than helpful for a persistent panel.
const _expandedSlots = new Set();

function renderColorRack() {
  if (!colorRackEl) return;
  // Build/replace exactly RACK_SLOTS DOM nodes. We rebuild rather than
  // mutate-in-place because slot order can change on drag-drop and there
  // are only 3 nodes — performance is irrelevant. The picker popover is
  // separate (lives at body level) so it's never touched here.
  //
  // Slot DOM structure:
  //   .color-rack-slot                 (flex column, drag source)
  //     .color-rack-slot-row           (grid row: handle, chip, chevron, toggle, ×)
  //     .color-rack-slot-panel         (only when expanded — inline knobs/toggles)
  colorRackEl.innerHTML = '';
  for (let i = 0; i < state.colorRack.length; i++) {
    const slot     = state.colorRack[i];
    const filled   = slot.type !== 'none';
    const expanded = filled && _expandedSlots.has(slot.id);

    const el = document.createElement('div');
    el.className = 'color-rack-slot';
    el.setAttribute('role', 'listitem');
    el.dataset.slotId  = slot.id;
    el.dataset.slotIdx = String(i);
    el.dataset.empty   = filled ? 'false' : 'true';
    el.dataset.enabled = (slot.enabled && filled) ? 'true' : 'false';
    el.dataset.expanded = expanded ? 'true' : 'false';
    el.draggable = true;

    // Header row — always present.
    const row = document.createElement('div');
    row.className = 'color-rack-slot-row';
    el.appendChild(row);

    // Drag handle
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'color-rack-handle';
    handle.setAttribute('aria-label', 'Drag to reorder slot');
    handle.dataset.tip = 'Drag to reorder this slot in the chain. Order matters: synth → thermo ≠ thermo → synth.';
    handle.textContent = '≡';
    row.appendChild(handle);

    // Chip body
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'color-rack-chip';
    chip.setAttribute('aria-haspopup', 'true');
    chip.setAttribute('aria-expanded', _openPickerSlotId === slot.id ? 'true' : 'false');
    chip.dataset.action = 'open-picker';
    if (filled) {
      chip.dataset.tip = RACK_CHIP_TIP[slot.type] || '';
      const swatch = document.createElement('span');
      swatch.className = 'color-rack-chip-swatch';
      swatch.style.background = RACK_SWATCH_GRADIENTS[slot.type] || '';
      const label = document.createElement('span');
      label.className = 'color-rack-chip-label';
      label.textContent = RACK_LABEL[slot.type] || slot.type;
      chip.appendChild(swatch);
      chip.appendChild(label);
    } else {
      chip.dataset.tip = 'Empty slot. Click to pick a color effect for this slot — it will run in series, reading the previous slot\'s output.';
      const empty = document.createElement('span');
      empty.className = 'color-rack-chip-empty';
      empty.textContent = '+ add color';
      chip.appendChild(empty);
    }
    row.appendChild(chip);

    // Chevron (expand/collapse) — filled slots only. Empty slots have
    // nothing to expand. Keeps the row compact when there's no panel.
    if (filled) {
      const chev = document.createElement('button');
      chev.type = 'button';
      chev.className = 'color-rack-chevron';
      chev.dataset.action = 'expand';
      chev.setAttribute('aria-label', expanded ? 'Collapse slot knobs' : 'Expand slot knobs');
      chev.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      chev.dataset.tip = expanded
        ? 'Hide this slot\'s knobs.'
        : 'Show this slot\'s knobs. Each slot has its own copy — tweaking these only affects THIS slot.';
      chev.textContent = expanded ? '▴' : '▾';
      row.appendChild(chev);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'color-rack-toggle';
      toggle.dataset.action = 'toggle';
      toggle.setAttribute('aria-pressed', slot.enabled ? 'true' : 'false');
      toggle.setAttribute('aria-label', slot.enabled ? 'Disable this slot' : 'Enable this slot');
      toggle.dataset.tip = slot.enabled
        ? 'Disable this slot. Stays in the rack but is skipped in the chain — useful for A/B compare without losing the pick.'
        : 'Enable this slot. Re-includes it in the chain.';
      toggle.textContent = slot.enabled ? '✓' : '⊘';
      row.appendChild(toggle);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'color-rack-remove';
      remove.dataset.action = 'remove';
      remove.setAttribute('aria-label', 'Clear this slot');
      remove.dataset.tip = 'Clear this slot back to empty. Slot stays in the rack so you can pick a new color or drag it elsewhere.';
      remove.textContent = '×';
      row.appendChild(remove);
    }

    // Inline panel — knobs + toggles for the slot's effect, all bound to
    // slot.params (NOT global state). Built only when expanded so collapsed
    // slots stay cheap (no extra DOM, no SVG).
    if (expanded) {
      const panel = renderSlotPanel(slot);
      el.appendChild(panel);
    }

    colorRackEl.appendChild(el);
  }
}

// Build the inline knob/toggle panel for an expanded slot. All knobs are
// slot-bound (writeValue closes over slot.params); the panel's reset
// button restores factory defaults via resetSlotParams.
function renderSlotPanel(slot) {
  const schema = COLOR_PARAM_SCHEMAS[slot.type];
  const panel = document.createElement('div');
  panel.className = 'color-rack-slot-panel';
  if (!schema) return panel;

  // Header row inside the panel: title + reset button.
  const phead = document.createElement('div');
  phead.className = 'color-rack-slot-panel-head';
  const ptitle = document.createElement('span');
  ptitle.className = 'color-rack-slot-panel-title';
  ptitle.textContent = `${RACK_LABEL[slot.type] || slot.type} knobs`;
  phead.appendChild(ptitle);
  const presetBtn = document.createElement('button');
  presetBtn.type = 'button';
  presetBtn.className = 'color-rack-slot-reset';
  presetBtn.dataset.action = 'reset-params';
  presetBtn.setAttribute('aria-label', 'Reset this slot\'s knobs to factory');
  presetBtn.dataset.tip = 'Reset only THIS slot\'s knobs to factory defaults. Other slots untouched.';
  presetBtn.textContent = '⟲';
  phead.appendChild(presetBtn);
  panel.appendChild(phead);

  // Toggles (e.g. falsecolor's banding) — render before knobs since they
  // tend to be the discrete mode-switch and knobs are continuous tuning.
  if (schema.toggles && schema.toggles.length) {
    for (const t of schema.toggles) {
      const wrap = document.createElement('div');
      wrap.className = 'color-rack-slot-toggle';
      const lbl = document.createElement('span');
      lbl.className = 'color-rack-slot-toggle-label';
      lbl.textContent = t.label;
      wrap.appendChild(lbl);
      const grp = document.createElement('div');
      grp.className = 'color-rack-slot-toggle-group';
      grp.setAttribute('role', 'radiogroup');
      grp.setAttribute('aria-label', t.label);
      const currentVal = slot.params[t.key];
      for (const opt of t.options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'color-rack-slot-toggle-btn';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(currentVal === opt.value));
        b.dataset.tip = opt.tip;
        b.textContent = opt.label;
        if (currentVal === opt.value) b.classList.add('active');
        b.addEventListener('click', () => {
          if (slot.params[t.key] === opt.value) return;
          slot.params[t.key] = opt.value;
          schedulePersist();
          renderColorRack();
        });
        grp.appendChild(b);
      }
      wrap.appendChild(grp);
      panel.appendChild(wrap);
    }
  }

  // Knob grid — bind each knob to slot.params[k.key].
  const grid = document.createElement('div');
  grid.className = 'color-rack-slot-knob-grid';
  for (const k of schema.knobs) {
    const knobId = `slot-${slot.id}-${k.key}`;
    const valId  = `${knobId}-val`;
    const knobEl = document.createElement('div');
    knobEl.className = 'knob slot-knob';
    knobEl.id = knobId;
    knobEl.dataset.knob = '';
    knobEl.dataset.min     = String(k.min);
    knobEl.dataset.max     = String(k.max);
    knobEl.dataset.step    = String(k.step);
    knobEl.dataset.default = String(k.default);
    knobEl.dataset.tip     = k.tip;
    knobEl.tabIndex = 0;
    knobEl.setAttribute('aria-label', `${RACK_LABEL[slot.type]} ${k.label}`);
    const labelEl = document.createElement('span');
    labelEl.className = 'knob-label';
    labelEl.textContent = k.label;
    const valSpan = document.createElement('span');
    valSpan.className = 'knob-val';
    valSpan.id = valId;
    valSpan.textContent = String(slot.params[k.key] ?? k.default);
    knobEl.appendChild(labelEl);
    knobEl.appendChild(valSpan);
    grid.appendChild(knobEl);

    // Slot-bound init: writes go to slot.params[k.key], not global state.
    // Closes over `slot` (live ref into state.colorRack) so writes hit the
    // canonical store; renderFrame's resolveActivePipeline picks it up
    // next frame.
    initKnob(knobEl, {
      writeValue:   (v) => { slot.params[k.key] = v; },
      initialValue: slot.params[k.key] ?? k.default,
    });
  }
  panel.appendChild(grid);

  return panel;
}

// ---- Picker popover open/close ----
function openPicker(slotEl) {
  const slotId = slotEl.dataset.slotId;
  _openPickerSlotId = slotId;
  // Position the popover beneath the slot, right-aligned to the slot's
  // right edge so the picker doesn't overflow the sidebar. Falls back to
  // above-the-slot if there isn't room below.
  const r = slotEl.getBoundingClientRect();
  colorPickerEl.classList.remove('hidden');
  const pr = colorPickerEl.getBoundingClientRect();
  let top  = r.bottom + 4;
  let left = r.right - pr.width;
  if (top + pr.height > window.innerHeight - 8) top = r.top - pr.height - 4;
  if (left < 8) left = 8;
  colorPickerEl.style.top  = `${top}px`;
  colorPickerEl.style.left = `${left}px`;
  // Update aria-expanded on the matching chip
  const chip = slotEl.querySelector('.color-rack-chip');
  if (chip) chip.setAttribute('aria-expanded', 'true');
}

function closePicker() {
  if (!_openPickerSlotId) return;
  _openPickerSlotId = null;
  colorPickerEl.classList.add('hidden');
  // Reset all chips' aria-expanded (cheaper than tracking which one was open).
  for (const chip of colorRackEl.querySelectorAll('.color-rack-chip')) {
    chip.setAttribute('aria-expanded', 'false');
  }
}

// ---- Slot mutation helpers ----
function setSlotType(slotId, type) {
  const slot = state.colorRack.find((s) => s.id === slotId);
  if (!slot) return;
  if (type === 'none') {
    slot.type = 'none';
    slot.enabled = false;
    slot.params = {};
  } else {
    // Even if the slot ALREADY held this type and we re-pick the same
    // color, params reset to factory. The picker click is the user
    // explicitly choosing the effect; "I want a fresh synth here" is
    // the most natural reading. If they wanted to preserve params they
    // wouldn't have opened the picker. Cheap to re-pick if surprising.
    slot.type = type;
    slot.enabled = true;
    slot.params = makeFactoryParams(type);
  }
  // Collapse the slot when type changes — old expanded inline knob DOM
  // is no longer valid for the new type.
  _expandedSlots.delete(slotId);
  renderColorRack();
  refreshEffectCardVisibility();
  schedulePersist();
}

function toggleSlot(slotId) {
  const slot = state.colorRack.find((s) => s.id === slotId);
  if (!slot || slot.type === 'none') return;
  slot.enabled = !slot.enabled;
  renderColorRack();
  refreshEffectCardVisibility();
  schedulePersist();
}

function clearSlot(slotId) {
  const slot = state.colorRack.find((s) => s.id === slotId);
  if (!slot) return;
  slot.type = 'none';
  slot.enabled = false;
  slot.params = {};
  _expandedSlots.delete(slotId);
  renderColorRack();
  refreshEffectCardVisibility();
  schedulePersist();
}

// Per-slot reset back to factory defaults for the slot's current effect
// type. Bound to the small ⟲ button inside an expanded slot.
function resetSlotParams(slotId) {
  const slot = state.colorRack.find((s) => s.id === slotId);
  if (!slot || slot.type === 'none') return;
  slot.params = makeFactoryParams(slot.type);
  renderColorRack();
  schedulePersist();
}

function reorderSlot(srcIdx, dstIdx) {
  if (srcIdx === dstIdx) return;
  const arr = state.colorRack.slice();
  const [moved] = arr.splice(srcIdx, 1);
  arr.splice(dstIdx, 0, moved);
  state.colorRack = arr;
  renderColorRack();
  refreshEffectCardVisibility();
  schedulePersist();
}

// ---- Slot event delegation: chip click / toggle / remove / expand / reset ----
colorRackEl?.addEventListener('click', (e) => {
  const slotEl = e.target.closest('.color-rack-slot');
  if (!slotEl) return;
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  const slotId = slotEl.dataset.slotId;
  if (action === 'open-picker') {
    if (_openPickerSlotId === slotId) { closePicker(); return; }
    openPicker(slotEl);
  } else if (action === 'toggle') {
    toggleSlot(slotId);
  } else if (action === 'remove') {
    clearSlot(slotId);
  } else if (action === 'expand') {
    if (_expandedSlots.has(slotId)) _expandedSlots.delete(slotId);
    else                            _expandedSlots.add(slotId);
    renderColorRack();
  } else if (action === 'reset-params') {
    resetSlotParams(slotId);
  }
});

// ---- Picker click → set slot type ----
colorPickerEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-pick-color]');
  if (!btn || !_openPickerSlotId) return;
  setSlotType(_openPickerSlotId, btn.dataset.pickColor);
  closePicker();
});

// ---- Outside click / Esc to close picker ----
document.addEventListener('mousedown', (e) => {
  if (!_openPickerSlotId) return;
  if (colorPickerEl.contains(e.target)) return;
  if (e.target.closest(`.color-rack-slot[data-slot-id="${_openPickerSlotId}"]`)) return;
  closePicker();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _openPickerSlotId) closePicker();
});

// ---- Drag-and-drop reorder ----
// HTML5 native drag. setData payload is the source slot index (the
// data-slotIdx attr written during render). dragover allows drop;
// dragenter/dragleave manage the .drop-target class. Only ONE slot at
// a time can carry .drop-target.
let _dragSrcIdx = null;
colorRackEl?.addEventListener('dragstart', (e) => {
  const slotEl = e.target.closest('.color-rack-slot');
  if (!slotEl) { e.preventDefault(); return; }
  _dragSrcIdx = parseInt(slotEl.dataset.slotIdx, 10);
  slotEl.classList.add('dragging');
  // Required so Firefox emits dragend
  e.dataTransfer.setData('text/plain', String(_dragSrcIdx));
  e.dataTransfer.effectAllowed = 'move';
});
colorRackEl?.addEventListener('dragend', () => {
  _dragSrcIdx = null;
  for (const el of colorRackEl.querySelectorAll('.color-rack-slot')) {
    el.classList.remove('dragging', 'drop-target');
  }
});
colorRackEl?.addEventListener('dragover', (e) => {
  if (_dragSrcIdx === null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const slotEl = e.target.closest('.color-rack-slot');
  // Highlight only the slot being hovered as the drop target.
  for (const el of colorRackEl.querySelectorAll('.color-rack-slot')) {
    el.classList.toggle('drop-target', el === slotEl && el !== e.currentTarget.querySelector('.dragging'));
  }
});
colorRackEl?.addEventListener('drop', (e) => {
  if (_dragSrcIdx === null) return;
  e.preventDefault();
  const slotEl = e.target.closest('.color-rack-slot');
  if (!slotEl) return;
  const dstIdx = parseInt(slotEl.dataset.slotIdx, 10);
  reorderSlot(_dragSrcIdx, dstIdx);
  _dragSrcIdx = null;
});

// ============================================================
// TRACK FX RACK — parallel to colorRack with its own DOM/picker state.
// Reuses the same .color-rack-* classes (no new visuals per "ignore visual
// style"); slots live in #track-fx-rack and the picker in
// #track-fx-picker-popover. Slot mutations operate on state.trackFxRack
// and call schedulePersist + renderTrackFxRack to round-trip through
// the same persistence path the color rack uses.
// ============================================================
const trackFxRackEl       = document.getElementById('track-fx-rack');
const trackFxPickerEl     = document.getElementById('track-fx-picker-popover');

const TRACK_FX_LABEL = { echo: 'Echo', radar: 'Radar', heatmap: 'Heatmap' };
// Cheap solid-color swatches — visual style ignored per scope, so we just
// pick one identifying tint per effect; the rack chip pattern needs *some*
// gradient to fill the swatch area.
const TRACK_FX_SWATCH_GRADIENTS = {
  echo:    'linear-gradient(135deg, #444, #888, #444)',
  radar:   'linear-gradient(135deg, #001a40, #00aacc, #88ddff)',
  heatmap: 'linear-gradient(90deg, #000, #5a0000, #ff5500, #ffea00, #fff)',
};
const TRACK_FX_CHIP_TIP = {
  echo:    'Echo Blobs in this slot. Past N frames\' bboxes appear faintly behind current. Click to swap.',
  radar:   'Radar Sweep in this slot. Rotating arc reveals blobs as it crosses them. Click to swap.',
  heatmap: 'Heatmap Residue in this slot. Wherever blobs have been recently glows. Click to swap.',
};

let _openTrackFxPickerSlotId = null;
const _expandedTrackFxSlots  = new Set();

function renderTrackFxRack() {
  if (!trackFxRackEl) return;
  trackFxRackEl.innerHTML = '';
  for (let i = 0; i < state.trackFxRack.length; i++) {
    const slot     = state.trackFxRack[i];
    const filled   = slot.type !== 'none';
    const expanded = filled && _expandedTrackFxSlots.has(slot.id);

    const el = document.createElement('div');
    el.className = 'color-rack-slot';
    el.setAttribute('role', 'listitem');
    el.dataset.slotId  = slot.id;
    el.dataset.slotIdx = String(i);
    el.dataset.empty   = filled ? 'false' : 'true';
    el.dataset.enabled = (slot.enabled && filled) ? 'true' : 'false';
    el.dataset.expanded = expanded ? 'true' : 'false';
    el.draggable = true;

    const row = document.createElement('div');
    row.className = 'color-rack-slot-row';
    el.appendChild(row);

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'color-rack-handle';
    handle.setAttribute('aria-label', 'Drag to reorder slot');
    handle.dataset.tip = 'Drag to reorder this tracking effect.';
    handle.textContent = '≡';
    row.appendChild(handle);

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'color-rack-chip';
    chip.setAttribute('aria-haspopup', 'true');
    chip.setAttribute('aria-expanded', _openTrackFxPickerSlotId === slot.id ? 'true' : 'false');
    chip.dataset.action = 'open-picker';
    if (filled) {
      chip.dataset.tip = TRACK_FX_CHIP_TIP[slot.type] || '';
      const swatch = document.createElement('span');
      swatch.className = 'color-rack-chip-swatch';
      swatch.style.background = TRACK_FX_SWATCH_GRADIENTS[slot.type] || '';
      const label = document.createElement('span');
      label.className = 'color-rack-chip-label';
      label.textContent = TRACK_FX_LABEL[slot.type] || slot.type;
      chip.appendChild(swatch);
      chip.appendChild(label);
    } else {
      chip.dataset.tip = 'Empty slot. Click to add a tracking effect.';
      const empty = document.createElement('span');
      empty.className = 'color-rack-chip-empty';
      empty.textContent = '+ add effect';
      chip.appendChild(empty);
    }
    row.appendChild(chip);

    if (filled) {
      const chev = document.createElement('button');
      chev.type = 'button';
      chev.className = 'color-rack-chevron';
      chev.dataset.action = 'expand';
      chev.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      chev.dataset.tip = expanded ? 'Hide this slot\'s knobs.' : 'Show this slot\'s knobs.';
      chev.textContent = expanded ? '▴' : '▾';
      row.appendChild(chev);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'color-rack-toggle';
      toggle.dataset.action = 'toggle';
      toggle.setAttribute('aria-pressed', slot.enabled ? 'true' : 'false');
      toggle.dataset.tip = slot.enabled ? 'Disable this slot.' : 'Enable this slot.';
      toggle.textContent = slot.enabled ? '✓' : '⊘';
      row.appendChild(toggle);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'color-rack-remove';
      remove.dataset.action = 'remove';
      remove.dataset.tip = 'Clear this slot.';
      remove.textContent = '×';
      row.appendChild(remove);
    }

    if (expanded) {
      const panel = renderTrackFxSlotPanel(slot);
      el.appendChild(panel);
    }

    trackFxRackEl.appendChild(el);
  }
}

function renderTrackFxSlotPanel(slot) {
  const schema = TRACK_FX_PARAM_SCHEMAS[slot.type];
  const panel = document.createElement('div');
  panel.className = 'color-rack-slot-panel';
  if (!schema) return panel;

  const phead = document.createElement('div');
  phead.className = 'color-rack-slot-panel-head';
  const ptitle = document.createElement('span');
  ptitle.className = 'color-rack-slot-panel-title';
  ptitle.textContent = `${TRACK_FX_LABEL[slot.type] || slot.type} knobs`;
  phead.appendChild(ptitle);
  const presetBtn = document.createElement('button');
  presetBtn.type = 'button';
  presetBtn.className = 'color-rack-slot-reset';
  presetBtn.dataset.action = 'reset-params';
  presetBtn.dataset.tip = 'Reset only THIS slot\'s knobs to factory.';
  presetBtn.textContent = '⟲';
  phead.appendChild(presetBtn);
  panel.appendChild(phead);

  const grid = document.createElement('div');
  grid.className = 'color-rack-slot-knob-grid';
  for (const k of schema.knobs) {
    const knobId = `trackfx-${slot.id}-${k.key}`;
    const valId  = `${knobId}-val`;
    const knobEl = document.createElement('div');
    knobEl.className = 'knob slot-knob';
    knobEl.id = knobId;
    knobEl.dataset.knob = '';
    knobEl.dataset.min     = String(k.min);
    knobEl.dataset.max     = String(k.max);
    knobEl.dataset.step    = String(k.step);
    knobEl.dataset.default = String(k.default);
    knobEl.dataset.tip     = k.tip;
    knobEl.tabIndex = 0;
    knobEl.setAttribute('aria-label', `${TRACK_FX_LABEL[slot.type]} ${k.label}`);
    const labelEl = document.createElement('span');
    labelEl.className = 'knob-label';
    labelEl.textContent = k.label;
    const valSpan = document.createElement('span');
    valSpan.className = 'knob-val';
    valSpan.id = valId;
    valSpan.textContent = String(slot.params[k.key] ?? k.default);
    knobEl.appendChild(labelEl);
    knobEl.appendChild(valSpan);
    grid.appendChild(knobEl);

    initKnob(knobEl, {
      writeValue:   (v) => { slot.params[k.key] = v; },
      initialValue: slot.params[k.key] ?? k.default,
    });
  }
  panel.appendChild(grid);

  return panel;
}

// ---- Slot mutation helpers (parallel to colorRack) ----
function setTrackFxSlotType(slotId, type) {
  const slot = state.trackFxRack.find((s) => s.id === slotId);
  if (!slot) return;
  if (type === 'none') {
    slot.type = 'none';
    slot.enabled = false;
    slot.params = {};
  } else {
    slot.type = type;
    slot.enabled = true;
    slot.params = makeTrackFxFactoryParams(type);
  }
  _expandedTrackFxSlots.delete(slotId);
  renderTrackFxRack();
  schedulePersist();
}
function toggleTrackFxSlot(slotId) {
  const slot = state.trackFxRack.find((s) => s.id === slotId);
  if (!slot || slot.type === 'none') return;
  slot.enabled = !slot.enabled;
  renderTrackFxRack();
  schedulePersist();
}
function clearTrackFxSlot(slotId) {
  const slot = state.trackFxRack.find((s) => s.id === slotId);
  if (!slot) return;
  slot.type = 'none';
  slot.enabled = false;
  slot.params = {};
  _expandedTrackFxSlots.delete(slotId);
  renderTrackFxRack();
  schedulePersist();
}
function resetTrackFxSlotParams(slotId) {
  const slot = state.trackFxRack.find((s) => s.id === slotId);
  if (!slot || slot.type === 'none') return;
  slot.params = makeTrackFxFactoryParams(slot.type);
  renderTrackFxRack();
  schedulePersist();
}
function reorderTrackFxSlot(srcIdx, dstIdx) {
  if (srcIdx === dstIdx) return;
  const arr = state.trackFxRack.slice();
  const [moved] = arr.splice(srcIdx, 1);
  arr.splice(dstIdx, 0, moved);
  state.trackFxRack = arr;
  renderTrackFxRack();
  schedulePersist();
}

function openTrackFxPicker(slotEl) {
  const slotId = slotEl.dataset.slotId;
  _openTrackFxPickerSlotId = slotId;
  const r = slotEl.getBoundingClientRect();
  trackFxPickerEl.classList.remove('hidden');
  const pr = trackFxPickerEl.getBoundingClientRect();
  let top  = r.bottom + 4;
  let left = r.right - pr.width;
  if (top + pr.height > window.innerHeight - 8) top = r.top - pr.height - 4;
  if (left < 8) left = 8;
  trackFxPickerEl.style.top  = `${top}px`;
  trackFxPickerEl.style.left = `${left}px`;
  const chip = slotEl.querySelector('.color-rack-chip');
  if (chip) chip.setAttribute('aria-expanded', 'true');
}
function closeTrackFxPicker() {
  if (!_openTrackFxPickerSlotId) return;
  _openTrackFxPickerSlotId = null;
  trackFxPickerEl.classList.add('hidden');
  for (const chip of trackFxRackEl.querySelectorAll('.color-rack-chip')) {
    chip.setAttribute('aria-expanded', 'false');
  }
}

trackFxRackEl?.addEventListener('click', (e) => {
  const slotEl = e.target.closest('.color-rack-slot');
  if (!slotEl) return;
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  const slotId = slotEl.dataset.slotId;
  if (action === 'open-picker') {
    if (_openTrackFxPickerSlotId === slotId) { closeTrackFxPicker(); return; }
    openTrackFxPicker(slotEl);
  } else if (action === 'toggle') {
    toggleTrackFxSlot(slotId);
  } else if (action === 'remove') {
    clearTrackFxSlot(slotId);
  } else if (action === 'expand') {
    if (_expandedTrackFxSlots.has(slotId)) _expandedTrackFxSlots.delete(slotId);
    else                                   _expandedTrackFxSlots.add(slotId);
    renderTrackFxRack();
  } else if (action === 'reset-params') {
    resetTrackFxSlotParams(slotId);
  }
});

trackFxPickerEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-pick-trackfx]');
  if (!btn || !_openTrackFxPickerSlotId) return;
  setTrackFxSlotType(_openTrackFxPickerSlotId, btn.dataset.pickTrackfx);
  closeTrackFxPicker();
});

document.addEventListener('mousedown', (e) => {
  if (!_openTrackFxPickerSlotId) return;
  if (trackFxPickerEl.contains(e.target)) return;
  if (e.target.closest(`#track-fx-rack .color-rack-slot[data-slot-id="${_openTrackFxPickerSlotId}"]`)) return;
  closeTrackFxPicker();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _openTrackFxPickerSlotId) closeTrackFxPicker();
});

// Independent drag-state for the trackFx rack so a drag here doesn't
// confuse the colorRack drag-state and vice versa.
let _trackFxDragSrcIdx = null;
trackFxRackEl?.addEventListener('dragstart', (e) => {
  const slotEl = e.target.closest('.color-rack-slot');
  if (!slotEl) { e.preventDefault(); return; }
  _trackFxDragSrcIdx = parseInt(slotEl.dataset.slotIdx, 10);
  slotEl.classList.add('dragging');
  e.dataTransfer.setData('text/plain', String(_trackFxDragSrcIdx));
  e.dataTransfer.effectAllowed = 'move';
});
trackFxRackEl?.addEventListener('dragend', () => {
  _trackFxDragSrcIdx = null;
  for (const el of trackFxRackEl.querySelectorAll('.color-rack-slot')) {
    el.classList.remove('dragging', 'drop-target');
  }
});
trackFxRackEl?.addEventListener('dragover', (e) => {
  if (_trackFxDragSrcIdx === null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const slotEl = e.target.closest('.color-rack-slot');
  for (const el of trackFxRackEl.querySelectorAll('.color-rack-slot')) {
    el.classList.toggle('drop-target', el === slotEl && el !== e.currentTarget.querySelector('.dragging'));
  }
});
trackFxRackEl?.addEventListener('drop', (e) => {
  if (_trackFxDragSrcIdx === null) return;
  e.preventDefault();
  const slotEl = e.target.closest('.color-rack-slot');
  if (!slotEl) return;
  const dstIdx = parseInt(slotEl.dataset.slotIdx, 10);
  reorderTrackFxSlot(_trackFxDragSrcIdx, dstIdx);
  _trackFxDragSrcIdx = null;
});

// ---- Apply persisted state to UI ----
function applyStateToUI() {
  _applyingState = true;
  try {
    for (const [, info] of knobRegistry) {
      const v = state[info.stateKey];
      if (typeof v === 'number' && !Number.isNaN(v)) info.setValue(v, { persist: false });
    }
    for (const [groupId, key, , onChange] of TOGGLE_CONFIG) {
      setToggleGroupValue(groupId, state[key]);
      if (onChange) onChange(state[key]);
    }
    video.playbackRate = state.speed;
    document.body.setAttribute('data-mode', state.mode);
    // Color rack + track FX rack are custom widgets (not toggle groups),
    // so they have to render themselves rather than ride the TOGGLE_CONFIG
    // loop. Both run inside the _applyingState guard so any future side
    // effects on render don't double-fire during state restore.
    renderColorRack();
    renderTrackFxRack();
  } finally {
    _applyingState = false;
  }
  // After loaded values are in place, recompute card visibility once with
  // the final state (the per-handler refreshes during the loop reflect
  // intermediate state).
  refreshEffectCardVisibility();
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
    // P1 migration: pre-P1 saved state has a single `filter` field that
    // mapped to one of structure / color / per-blob. Classify it into the
    // new bucket so the user's previous selection survives the upgrade.
    // After classification the stale `filter` is dropped; subsequent saves
    // use the new fields exclusively.
    if ('filter' in parsed && !('structure' in parsed)) {
      const f = parsed.filter;
      if      (STRUCTURE_SECTIONS.includes(f)) { parsed.structure = f; }
      else if (COLOR_SECTIONS.includes(f))     { parsed.color     = f; }
      else if (f === 'inv' || f === 'thermal') { parsed.perBlob   = f; }
      delete parsed.filter;
    }
    // lastPicked retired — was a vestigial recency hint; rendering never
    // used it after P2b. Drop on load so the field doesn't pile up in
    // saved state forever.
    delete parsed.lastPicked;
    // Color-rack migration (post-P2b): the single `color` field becomes a
    // 3-slot rack. The previously-selected color (if any) lands in slot 0,
    // enabled. Other slots empty. Subsequent saves use colorRack only.
    if ('color' in parsed && !('colorRack' in parsed)) {
      const c = parsed.color;
      const rack = makeColorRack();
      if (c && c !== 'none' && COLOR_SECTIONS.includes(c)) {
        rack[0] = { id: makeSlotId(), type: c, enabled: true, params: makeFactoryParams(c) };
      }
      parsed.colorRack = rack;
      delete parsed.color;
    }
    // Defensive shape check: if a persisted colorRack is malformed (wrong
    // length, missing fields, unknown types) replace with a fresh rack
    // rather than crash on render. Cheap insurance against forward-compat
    // accidents.
    if (parsed.colorRack && (!Array.isArray(parsed.colorRack) || parsed.colorRack.length !== RACK_SLOTS)) {
      parsed.colorRack = makeColorRack();
    }
    if (Array.isArray(parsed.colorRack)) {
      parsed.colorRack = parsed.colorRack.map((slot) => {
        if (!slot || typeof slot !== 'object') {
          return { id: makeSlotId(), type: 'none', enabled: false, params: {} };
        }
        const type = (slot.type === 'none' || COLOR_SECTIONS.includes(slot.type)) ? slot.type : 'none';
        // Per-slot params migration: pre-this-commit slots had no params
        // field. Per user spec the migration is STRICT FACTORY for all
        // slots — even slots that already exist get their params reset
        // (rather than inherit the dead global color knob values from
        // older saves). Honest mental model: every slot starts at
        // factory, no exceptions.
        const factoryP = makeFactoryParams(type);
        let params = factoryP;
        // BUT — once this commit ships, subsequent saves persist the
        // user's tweaks under slot.params. On those subsequent loads we
        // DO want to read them back (otherwise every reload would wipe
        // the user's work). Only the first-time-after-this-commit load
        // takes the strict factory path; after that, validate-and-keep.
        if (slot.params && typeof slot.params === 'object') {
          params = { ...factoryP };
          for (const k of Object.keys(factoryP)) {
            const v = slot.params[k];
            if (typeof v === 'number' && Number.isFinite(v)) params[k] = v;
          }
        }
        return {
          id:      slot.id || makeSlotId(),
          type,
          enabled: !!slot.enabled && type !== 'none',
          params,
        };
      });
    }
    // Strip dead global color knob state from older saves. These keys
    // used to live on `state` (state.synthMode, state.oxideCorr, ...)
    // and were read directly by runEffect. They no longer matter — slot
    // params own these values now. Strip so they don't pile up forever
    // in the saved blob.
    const DEAD_GLOBAL_COLOR_KEYS = [
      'oxideCorr','oxideMetal','oxideRough','oxideSheen',
      'synthWarm','synthSep','synthRes','synthDyn',
      'biolumGlow','biolumColor','biolumPulse','biolumDepth',
      'thermoCont','thermoHot','thermoCold','thermoWhite',
      'falsePalette','falseBand','falseBandCnt','falseBright',
    ];
    for (const k of DEAD_GLOBAL_COLOR_KEYS) delete parsed[k];

    // Track FX rack — same defensive migration as colorRack: validate
    // each slot, fall back to factory params when malformed, drop unknown
    // types. STORAGE_KEY bumped to v3 so first-load-after-this-commit
    // sees no parsed.trackFxRack and uses the fresh rack from state init.
    const TRACK_FX_TYPES = Object.keys(TRACK_FX_PARAM_SCHEMAS);
    if (parsed.trackFxRack && (!Array.isArray(parsed.trackFxRack) || parsed.trackFxRack.length !== RACK_SLOTS)) {
      parsed.trackFxRack = makeTrackFxRack();
    }
    if (Array.isArray(parsed.trackFxRack)) {
      parsed.trackFxRack = parsed.trackFxRack.map((slot) => {
        if (!slot || typeof slot !== 'object') {
          return { id: makeSlotId(), type: 'none', enabled: false, params: {} };
        }
        const type = (slot.type === 'none' || TRACK_FX_TYPES.includes(slot.type)) ? slot.type : 'none';
        const factoryP = makeTrackFxFactoryParams(type);
        let params = factoryP;
        if (slot.params && typeof slot.params === 'object') {
          params = { ...factoryP };
          for (const k of Object.keys(factoryP)) {
            const v = slot.params[k];
            if (typeof v === 'number' && Number.isFinite(v)) params[k] = v;
          }
        }
        return {
          id:      slot.id || makeSlotId(),
          type,
          enabled: !!slot.enabled && type !== 'none',
          params,
        };
      });
    }
    for (const k of Object.keys(DEFAULTS)) if (k in parsed) state[k] = parsed[k];
    if (parsed.colorRack)    state.colorRack    = parsed.colorRack;
    if (parsed.trackFxRack)  state.trackFxRack  = parsed.trackFxRack;
  } catch { /* ignore */ }
}

// ---- Reset (two-stage confirm) ----
let resetConfirmTimer = 0;
function performFullReset() {
  for (const k of Object.keys(DEFAULTS)) state[k] = DEFAULTS[k];
  // colorRack + trackFxRack live outside DEFAULTS (per-instance ids);
  // reset explicitly so each session has fresh slot ids and factory params.
  state.colorRack   = makeColorRack();
  state.trackFxRack = makeTrackFxRack();
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
  // Reset any toggle-groups inside the card (e.g. erode-mode-group).
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
    a.download = `lumisynth-${ts}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Frame saved', 'ok', 2000);
  }, 'image/png');
}
btnSnapshot.addEventListener('click', takeSnapshot);

// ---- Clip recording (MediaRecorder against canvas.captureStream) ----
//
// Records the display canvas — same pixels the user sees, including
// raw video, all GL chain output, per-blob CPU pass, and overlays.
// `captureStream(60)` requests up to 60 frames/sec from the canvas;
// the actual rate is whatever our render loop produces (capped at 60
// by the FPS_CAP code), so the recording's cadence matches what's
// on screen — no surprises with stuttery playback or doubled frames.
//
// MIME negotiation: try mp4 → webm/vp9 → webm/vp8. mp4 plays natively
// on every modern OS / device; webm is the fallback for browsers that
// can't encode it (Safari historically). The user gets a single click
// → file in their downloads folder, regardless of which codec we
// landed on.
//
// No audio: the canvas stream is video-only by definition. Audio from
// the source video file is intentionally NOT included — the artistic
// content is the visuals; pulling audio in would also raise privacy
// expectations for the camera path. v2 could opt-in.

// Codec preference order. First isTypeSupported match wins. Each entry
// pairs the MediaRecorder MIME string with the file extension users
// expect — keeps downloads from getting saddled with `.bin` or wrong
// extensions for OS-level video previews.
const RECORDER_FORMATS = [
  { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9',        ext: 'webm' },
  { mime: 'video/webm;codecs=vp8',        ext: 'webm' },
  { mime: 'video/webm',                   ext: 'webm' },
];

// Module state for the active recording. _recorder is non-null only
// while a recording is in progress; everything else gates off that.
let _recorder       = null;
let _recordChunks   = [];
let _recordFormat   = null;
let _recordStartT   = 0;
let _recordTickRaf  = 0;

function pickRecorderFormat() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const f of RECORDER_FORMATS) {
    try { if (MediaRecorder.isTypeSupported(f.mime)) return f; } catch { /* keep going */ }
  }
  return null;
}

// Detect support once at boot — if MediaRecorder isn't available or
// can't encode any of our preferred MIMEs (extremely rare today, but
// possible on locked-down enterprise browsers), hide the button so
// users never see a control they can't use.
const _recorderSupported = !!pickRecorderFormat();
if (!_recorderSupported && btnRecord) {
  btnRecord.style.display = 'none';
}

function formatRecordTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

function tickRecordLabel() {
  if (!_recorder) return;
  btnRecordLbl.textContent = formatRecordTime(performance.now() - _recordStartT);
  // Re-schedule via RAF so the label updates piggyback on the render
  // loop's existing cadence — no separate setInterval timer to manage
  // or leak across recording sessions.
  _recordTickRaf = requestAnimationFrame(tickRecordLabel);
}

function startRecording() {
  if (!state.hasSource) {
    showToast('Load a video or open the camera first', 'error');
    return;
  }
  if (_recorder) return; // guard double-clicks
  _recordFormat = pickRecorderFormat();
  if (!_recordFormat) {
    showToast('Recording not supported in this browser', 'error');
    return;
  }
  // captureStream pulls frames from the canvas at the rate we draw to
  // it (capped at FPS_CAP). The 60 here is a hint to the browser, not
  // a guarantee — actual rate matches our render loop.
  let stream;
  try {
    stream = canvas.captureStream(FPS_CAP);
  } catch (err) {
    showToast(`Couldn't capture canvas: ${err.message || err}`, 'error');
    return;
  }
  try {
    _recorder = new MediaRecorder(stream, { mimeType: _recordFormat.mime });
  } catch (err) {
    showToast(`Recorder init failed: ${err.message || err}`, 'error');
    _recorder = null;
    return;
  }
  _recordChunks = [];
  _recorder.addEventListener('dataavailable', (e) => {
    if (e.data && e.data.size > 0) _recordChunks.push(e.data);
  });
  _recorder.addEventListener('error', (e) => {
    showToast(`Recording error: ${e.error?.message || 'unknown'}`, 'error');
    teardownRecording();
  });
  _recorder.addEventListener('stop', () => {
    finalizeRecording();
  });
  // Request a chunk every second so a long recording isn't held in
  // a single giant blob — also means a browser crash mid-record loses
  // at most one second of data via the dataavailable accumulation.
  _recorder.start(1000);
  _recordStartT = performance.now();
  btnRecord.classList.add('recording');
  btnRecord.setAttribute('aria-pressed', 'true');
  btnRecord.title = 'Stop recording (click to save)';
  btnRecordLbl.textContent = '0:00';
  _recordTickRaf = requestAnimationFrame(tickRecordLabel);
  showToast(`Recording started (${_recordFormat.ext.toUpperCase()})`, 'ok', 1800);
}

function stopRecording() {
  if (!_recorder) return;
  // Recorder.stop() flushes a final dataavailable then fires 'stop',
  // which calls finalizeRecording. teardown happens there to keep the
  // sequencing single-path.
  try { _recorder.stop(); } catch { /* already stopped */ }
}

function finalizeRecording() {
  const chunks = _recordChunks;
  const fmt    = _recordFormat;
  const durMs  = performance.now() - _recordStartT;
  teardownRecording();

  if (!chunks.length) {
    showToast('Recording produced no data', 'error');
    return;
  }
  const blob = new Blob(chunks, { type: fmt.mime.split(';')[0] });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const ts   = new Date().toISOString().replace(/[:.]/g, '-');
  a.href = url;
  a.download = `lumisynth-${ts}.${fmt.ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);

  const sizeMb = (blob.size / (1024 * 1024)).toFixed(1);
  showToast(`Saved ${formatRecordTime(durMs)} clip · ${sizeMb} MB`, 'ok', 3500);
}

function teardownRecording() {
  if (_recordTickRaf) {
    cancelAnimationFrame(_recordTickRaf);
    _recordTickRaf = 0;
  }
  _recorder = null;
  _recordChunks = [];
  btnRecord.classList.remove('recording');
  btnRecord.setAttribute('aria-pressed', 'false');
  btnRecord.title = 'Record canvas as a video clip (click again to stop)';
  btnRecordLbl.textContent = 'Rec';
}

if (btnRecord) {
  btnRecord.addEventListener('click', () => {
    if (_recorder) stopRecording();
    else           startRecording();
  });
}

// Auto-stop if the user yanks the source mid-recording (e.g. switches
// from camera to video file). The captureStream keeps "running" but
// produces black frames once the canvas isn't being redrawn, which
// would be a confusing artifact in the saved clip. Better to finalize
// what they've already captured.
function handleSourceChangeForRecording() {
  if (_recorder) {
    showToast('Source changed — finalizing recording', 'info', 2000);
    stopRecording();
  }
}

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
  if ((e.key === 'r' || e.key === 'R') && !document.activeElement?.classList?.contains('knob')) {
    if (btnRecord && !btnRecord.disabled && btnRecord.style.display !== 'none') {
      btnRecord.click();
      e.preventDefault();
    }
  }
});

// ---- File upload ----
document.getElementById('btn-upload').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  loadFileAsSource(file);
});

// Single dispatch point for any incoming File object (upload button or drop).
// Routes by MIME type. Unsupported types surface a toast rather than silently
// failing — we don't want a dropped audio file to look like the app froze.
function loadFileAsSource(file) {
  const type = file.type || '';
  const url = URL.createObjectURL(file);
  if (type.startsWith('video/')) {
    loadVideoSource(url, file.name);
  } else if (type.startsWith('image/')) {
    loadImageSource(url, file.name);
  } else {
    showToast(`Unsupported file type: ${type || 'unknown'}`, 'error');
  }
}

// ---- Camera ----
document.getElementById('btn-camera').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    video.removeAttribute('src');
    video.srcObject = stream;
    await video.play();
    resetAllState();
    state.sourceKind = 'webcam';
    setHasSource(true, 'Camera');
    videoControls.classList.add('hidden');     // no scrub for camera
    showToast('Camera active', 'ok', 2000);
  } catch (err) {
    showToast(`Camera unavailable: ${err.message || err.name}`, 'error', 6000);
  }
});

// ---- Active source helpers ----
// Polymorphic accessors for the rendering pipeline. The current source can
// be a video (file or webcam) or a still image. Render-loop sites use these
// instead of touching `video` directly so adding new source kinds (e.g. the
// Subject loop) stays a single-call-site change.
function activeSourceEl() {
  return state.sourceKind === 'image' ? imageEl : video;
}
function activeSourceWidth() {
  return state.sourceKind === 'image'
    ? (imageEl.naturalWidth || 0)
    : (video.videoWidth || 0);
}
function activeSourceHeight() {
  return state.sourceKind === 'image'
    ? (imageEl.naturalHeight || 0)
    : (video.videoHeight || 0);
}
function activeSourceReady() {
  if (state.sourceKind === 'image') {
    return imageEl.complete && imageEl.naturalWidth > 0;
  }
  return video.readyState >= 2 && video.videoWidth > 0;
}
// For images we treat the source as "always paused" — there's no temporal
// dimension. The detection block guards on this so motion-mode doesn't
// thrash on a constant frame, and so cachedBlobs stay stable on stills.
function activeSourcePaused() {
  if (state.sourceKind === 'image') return true;
  return video.paused;
}

function loadVideoSource(url, label) {
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  video.src = url;
  video.loop = true;
  video.play().catch(() => {});
  resetAllState();
  state.sourceKind = 'video';
  setHasSource(true, label || 'Video');
  videoControls.classList.remove('hidden');    // scrub available for files
}

function loadImageSource(url, label) {
  // Tear down any active webcam stream — switching to image stops the camera.
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  // Pause and clear the video element so the previous video doesn't keep
  // ticking in the background while we display an image.
  try { video.pause(); } catch (_) {}
  video.removeAttribute('src');
  try { video.load(); } catch (_) {}

  imageEl.onload = () => {
    resetAllState();
    state.sourceKind = 'image';
    setHasSource(true, label || 'Image');
    videoControls.classList.add('hidden');     // no transport for stills
    resizeCanvas();
  };
  imageEl.onerror = () => {
    showToast('Image failed to load', 'error');
  };
  imageEl.src = url;
}

function resetAllState() {
  resetFrameHistory(); resetTracker(); resetTrackOverlay();
  cachedBlobs = []; frameCount = 0;
  // Smoothing state — both backends — gets purged so the next source
  // doesn't inherit a stale dead-filter pool that could mis-match its
  // first frame's blobs to leftover positions from the previous video.
  _activeFilters.clear();
  _deadFilters.clear();
  _displayBlobs.clear();
}

function updateSourceLabel(text) {
  fileStatus.textContent = text;
  topbarSource.textContent = text;
}

function setHasSource(val, label) {
  // If a recording is active and the source changes (or goes away),
  // finalize it. Otherwise the saved clip would tail off into black
  // frames once the canvas stops being updated.
  handleSourceChangeForRecording();
  state.hasSource = val;
  placeholder.style.display = val ? 'none' : 'flex';
  btnSnapshot.disabled = !val;
  if (btnRecord) btnRecord.disabled = !val;
  if (val) {
    const w = activeSourceWidth();
    const h = activeSourceHeight();
    const dims = (w && h) ? ` · ${w}×${h}` : '';
    updateSourceLabel((label || 'Source') + dims);
    if (rafHandle === 0) rafHandle = requestAnimationFrame(renderFrame);
  } else {
    state.sourceKind = null;
    updateSourceLabel('No source loaded');
  }
}

video.addEventListener('loadedmetadata', () => {
  resizeCanvas();
  if (state.hasSource && state.sourceKind !== 'image' && video.videoWidth && video.videoHeight) {
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
  loadFileAsSource(file);
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
  const sw = activeSourceWidth();
  const sh = activeSourceHeight();
  if (!state.hasSource || sw === 0 || sh === 0) {
    canvas.width = aw; canvas.height = ah; return;
  }
  const vRatio = sw / sh;
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

// ---- Per-render-frame blob smoothing ----
// Two backends. One Euro is the active path; EMA is kept as a documented
// dead branch behind the constant below for easy rollback / A/B comparison
// if One Euro misbehaves on some real-world input.
//
//   'oneEuro' (default) — adaptive low-pass per Casiez 2012. Heavy
//      smoothing when blob is near-stationary (kills sub-pixel jitter),
//      cutoff opens with speed (low lag when moving). Combined with the
//      sub-pixel parabolic peak refinement in blobDetector.js, this is
//      the post-jitter pipeline.
//   'ema' — original exponential-moving-average path. Single fixed alpha,
//      so it trades stationary smoothness against responsiveness with no
//      adaptive recovery. Kept for fallback only.
//
// state.trackStability = 0 → bypass either backend entirely (raw Kalman out).

const BLOB_SMOOTH_BACKEND = 'oneEuro';

// One Euro knob mapping. minCutoff is the cutoff at zero speed; lower =
// smoother stationary. Linear remap so the knob's existing 0→1 range still
// covers passthrough → very smooth without a state migration.
//   smooth=0  → 120 Hz  (effectively passthrough; well above any plausible
//                       blob update rate, so filter is a no-op)
//   smooth=1  →   1 Hz  (canonical "very smooth" Casiez value)
// beta is fixed to a sane default for cursor/blob-scale motion. Held
// internally rather than exposed so the UI stays single-knob; if it ever
// needs tuning per use case, lift it to its own knob.
const ONE_EURO_MAX_CUTOFF_HZ = 120;
const ONE_EURO_MIN_CUTOFF_HZ = 1;
const ONE_EURO_BETA          = 0.01;

// Respawn-match window. When a tracker id disappears (Kalman cull or
// association miss → new id spawned at near the same spot), we keep the
// dying filter alive for a short window so a nearby new id can inherit
// its filter state instead of snapping to the raw measurement. Without
// this, smooth>0 produces a visible pop on every brief detection dropout.
//   TTL_FRAMES @ 60fps ≈ 167ms — long enough to span 1-2 missed detection
//   windows at typical updateInterval=1, short enough that a genuinely new
//   blob entering near a recently-dead one still claims its own filter.
//   DIST_FRAC tighter than Kalman's 0.25 because we expect the respawn to
//   sit basically on top of the dead position, not anywhere on screen.
const RESPAWN_TTL_FRAMES = 10;
const RESPAWN_DIST_FRAC  = 0.05;

// One Euro state pools.
const _activeFilters = new Map();  // tracker id → { filter, lastBlob }
const _deadFilters   = new Map();  // tracker id → { filter, lastBlob, ttl }

// Legacy EMA state (only touched when BLOB_SMOOTH_BACKEND === 'ema').
const _displayBlobs = new Map();   // id → smoothed blob

function _smoothBlobsOneEuro(latest, canvasW) {
  const smooth = state.trackStability;
  if (smooth <= 0.001) {
    if (_activeFilters.size) _activeFilters.clear();
    if (_deadFilters.size)   _deadFilters.clear();
    return latest;
  }

  const minCutoff = ONE_EURO_MAX_CUTOFF_HZ - smooth * (ONE_EURO_MAX_CUTOFF_HZ - ONE_EURO_MIN_CUTOFF_HZ);
  const beta      = ONE_EURO_BETA;
  const tNow      = performance.now();
  const maxRespawnDist = canvasW * RESPAWN_DIST_FRAC;

  const out = new Array(latest.length);
  const seenIds = new Set();

  for (let i = 0; i < latest.length; i++) {
    const b = latest[i];
    seenIds.add(b.id);

    let entry = _activeFilters.get(b.id);

    if (!entry) {
      // New id this frame. Try to inherit a recently-dead filter that's
      // spatially close — covers the common case where a tracker briefly
      // missed detection and was respawned with a fresh id by Kalman
      // (or the user paused → resumed with id churn). Without inheritance
      // the new id snaps instantly to b on first measurement and produces
      // a visible pop at smooth>0.
      let bestKey  = null;
      let bestDist = maxRespawnDist;
      for (const [oldId, dead] of _deadFilters) {
        const dx = dead.lastBlob.cx - b.cx;
        const dy = dead.lastBlob.cy - b.cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < bestDist) { bestDist = dist; bestKey = oldId; }
      }

      if (bestKey !== null) {
        const revived = _deadFilters.get(bestKey);
        _deadFilters.delete(bestKey);
        revived.filter.setParams(minCutoff, beta);
        entry = revived;   // shape: { filter, lastBlob } — drop ttl on revival
      } else {
        entry = { filter: new BlobOneEuroFilter(minCutoff, beta), lastBlob: b };
      }
      _activeFilters.set(b.id, entry);
    } else {
      // Live retune so knob changes take effect on the very next sample.
      entry.filter.setParams(minCutoff, beta);
    }

    const smoothed = entry.filter.filterBlob(b, tNow);
    entry.lastBlob = smoothed;
    out[i] = smoothed;
  }

  // Two-pass disposal — collect dying ids first, then mutate. Avoids
  // iterator-while-mutating gotchas across JS engines.
  const dying = [];
  for (const id of _activeFilters.keys()) {
    if (!seenIds.has(id)) dying.push(id);
  }
  for (const id of dying) {
    const entry = _activeFilters.get(id);
    _activeFilters.delete(id);
    _deadFilters.set(id, { filter: entry.filter, lastBlob: entry.lastBlob, ttl: RESPAWN_TTL_FRAMES });
  }

  // Tick down dead pool, cull expired.
  const expired = [];
  for (const [id, dead] of _deadFilters) {
    dead.ttl--;
    if (dead.ttl <= 0) expired.push(id);
  }
  for (const id of expired) _deadFilters.delete(id);

  return out;
}

// Legacy EMA path. Kept verbatim from the pre-One-Euro implementation so
// flipping BLOB_SMOOTH_BACKEND back is a single-character change. Do not
// edit this without also reverting the doc comment above.
function _smoothBlobsEMALegacy(latest) {
  const smooth = state.trackStability;
  if (smooth <= 0.001) {
    if (_displayBlobs.size) _displayBlobs.clear();
    return latest;
  }
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

function smoothBlobs(latest, canvasW) {
  return BLOB_SMOOTH_BACKEND === 'oneEuro'
    ? _smoothBlobsOneEuro(latest, canvasW)
    : _smoothBlobsEMALegacy(latest);
}

// ---- Render loop ----
// FPS-cap state (closure across frames). _accumMs accumulates real time
// between RAF ticks; once it exceeds FRAME_BUDGET_MS, we render a frame
// and subtract one budget. Clamped to one budget on accumulator overflow
// so background-tab-throttled bursts don't cause a render storm on
// resume (RAF goes silent in background tabs, then fires immediately
// when the tab returns; without the clamp _accumMs could be 5+ seconds).
let _fpsLastT  = 0;
let _fpsAccumMs = 0;
function renderFrame(nowDOMHi) {
  if (!state.hasSource) { rafHandle = 0; _fpsLastT = 0; _fpsAccumMs = 0; return; }
  rafHandle = requestAnimationFrame(renderFrame);

  // FPS cap. RAF will keep firing at the display refresh rate; we just
  // skip the render work when the accumulated time hasn't reached one
  // frame budget yet. nowDOMHi is the DOMHighResTimeStamp passed by RAF.
  const now = nowDOMHi || performance.now();
  if (_fpsLastT === 0) {
    _fpsLastT = now;
    _fpsAccumMs = FRAME_BUDGET_MS; // render the very first frame immediately
  } else {
    _fpsAccumMs += (now - _fpsLastT);
    _fpsLastT = now;
    if (_fpsAccumMs > FRAME_BUDGET_MS * 4) _fpsAccumMs = FRAME_BUDGET_MS; // tab-resume clamp
  }
  if (_fpsAccumMs < FRAME_BUDGET_MS) return;
  _fpsAccumMs -= FRAME_BUDGET_MS;

  if (!activeSourceReady()) return;
  const srcEl = activeSourceEl();

  const cw = canvas.width;
  const ch = canvas.height;
  ctx.drawImage(srcEl, 0, 0, cw, ch);

  const ow = Math.max(1, Math.round(cw * DETECT_SCALE));
  const oh = Math.max(1, Math.round(ch * DETECT_SCALE));
  if (offscreen.width !== ow || offscreen.height !== oh) {
    offscreen.width = ow; offscreen.height = oh;
  }
  // Detection/tracking only runs while the source is actually playing. When
  // paused (video) or static (image), motion-mode would see zero frame-diff
  // and starve every tracker until they cull, making blobs vanish. Luma-mode
  // would re-detect the same bright pixels every tick, churning IDs. Either
  // way: a frozen frame should freeze detection. cachedBlobs is preserved
  // from the last playing frame so overlays + per-blob filter still render
  // against the frozen frame (and the user can keep tweaking shape / size /
  // color knobs to see the effect on a still). For image sources detection
  // is skipped entirely — cachedBlobs is wiped at load via resetAllState(),
  // so an image renders without overlays. (One-shot detection on stills is
  // a deliberate v2 follow-up — out of scope for this image-input pass.)
  if (!activeSourcePaused()) {
    offCtx.drawImage(srcEl, 0, 0, ow, oh);
    const offImageData = offCtx.getImageData(0, 0, ow, oh);

    frameCount++;
    if (frameCount % Math.max(1, state.updateInterval) === 0) {
      const minSizeDetect = state.trackMinSize * DETECT_SCALE;
      const cap = Math.min(30, state.trackMaxBlobs);
      const rawBlobs  = detectBlobs(offImageData, state.threshold, cap, state.trackChannel, minSizeDetect);
      const sx = cw / ow, sy = ch / oh;
      const scaledRaw = rawBlobs.map(b => ({
        ...b, x: b.x*sx, y: b.y*sy, w: b.w*sx, h: b.h*sy, cx: b.cx*sx, cy: b.cy*sy,
      }));
      cachedBlobs = trackBlobs(scaledRaw, cw, cap);
    }
  }
  const blobs = smoothBlobs(cachedBlobs, cw);

  // GL dispatch — multi-stage chain pipeline.
  //
  //   video → STRUCTURE → [compose if structure blend = screen]
  //                 ↓                 ↓
  //              COLOR[0] → COLOR[1] → COLOR[2] → screen
  //                                                composite blend =
  //                                                terminal stage's BLEND_MODES
  //
  // Stages are ping-ponged through the two chain FBOs (chain.a ↔ chain.b).
  // Each non-terminal stage writes to whichever FBO is the current write
  // target; the next stage reads the just-written texture and writes to
  // the other FBO. The terminal stage writes to the default framebuffer
  // (the shared GL canvas) and gets composited to the 2D display canvas
  // with the terminal stage's blend mode.
  //
  // Empty rack + no structure: no GL block runs; raw video stays on display.
  // Single stage (any combination collapsing to one effect): no chain FBO
  // touched — that effect renders straight to the screen, identical to
  // pre-rack behavior.
  //
  // Per-blob (Inv / Thermal) layers on top of all of this — see block below.
  const pipe = resolveActivePipeline();
  const totalStages = (pipe.structure ? 1 : 0) + pipe.colors.length;
  if (totalStages > 0) {
    ensureContext(cw, ch);
    uploadVideoFrame(srcEl);

    if (totalStages === 1) {
      // Standalone single-stage fast path. No chain FBO allocation, no
      // ping-pong. Identical pixel output to the pre-rack standalone path.
      if (pipe.structure) {
        runEffect(pipe.structure);
        compositeToCanvas2D(ctx, cw, ch, BLEND_MODES[pipe.structure] || 'source-over');
      } else {
        const c = pipe.colors[0];
        runColorEffect(c.type, c.params);
        compositeToCanvas2D(ctx, cw, ch, BLEND_MODES[c.type] || 'source-over');
      }
    } else {
      // Multi-stage chain. Ping-pong through chain.a ↔ chain.b.
      const chain = getChainFBOs();
      let currentTex = null;       // Texture the next stage reads from. null = read raw video.
      let writeIdx   = 0;          // 0 = next write goes to chain.a, 1 = chain.b.
      const writeFBOs = [chain.a.fb, chain.b.fb];
      const readTexs  = [chain.a.tex, chain.b.tex];

      // STRUCTURE (if present) — always reads raw video; writes to chain.
      if (pipe.structure) {
        runEffect(pipe.structure, { outputFBO: writeFBOs[writeIdx] });
        currentTex = readTexs[writeIdx];
        writeIdx ^= 1;

        // Compose pass: screen-blend STRUCTURE's output back over raw
        // video so the next stage sees the structure-as-it-would-look-
        // standalone. Only needed when STRUCTURE's identity blend is
        // 'screen' (voronoi/wave/cellular). Source-over STRUCTUREs
        // (ascii/shatter/erode) already replace the video — skip the
        // pass entirely.
        if (BLEND_MODES[pipe.structure] === 'screen') {
          applyCompose(cw, ch, currentTex, writeFBOs[writeIdx]);
          currentTex = readTexs[writeIdx];
          writeIdx ^= 1;
        }
      }

      // COLORS — chained. Each reads currentTex (or raw video if STRUCTURE
      // was None and this is the first color), writes to the next slot in
      // the ping-pong, then becomes the source for the next iteration.
      // Last color writes to the default framebuffer instead of a chain FBO
      // so its output ends up on the shared GL canvas for compositing.
      for (let i = 0; i < pipe.colors.length; i++) {
        const isLast = (i === pipe.colors.length - 1);
        const outFB  = isLast ? null : writeFBOs[writeIdx];
        // currentTex is null when no STRUCTURE and this is the first color
        // → effect module's `inputTex || getVideoTex()` defaults to the
        // shared video texture. Don't pass inputTex in that case.
        const opts = currentTex ? { inputTex: currentTex, outputFBO: outFB }
                                : { outputFBO: outFB };
        const c = pipe.colors[i];
        runColorEffect(c.type, c.params, opts);
        if (!isLast) {
          currentTex = readTexs[writeIdx];
          writeIdx ^= 1;
        }
      }

      // Terminal-stage rule: composite blend mode is whatever the LAST
      // stage in the chain naturally wants. Last color when colors exist,
      // otherwise STRUCTURE (which means we got here only when STRUCTURE
      // is the only stage — already handled by the totalStages===1 branch
      // above, so this is just the COLOR case).
      const terminal = pipe.colors[pipe.colors.length - 1].type;
      compositeToCanvas2D(ctx, cw, ch, BLEND_MODES[terminal] || 'source-over');
    }
  }

  // Per-blob CPU filter pass (Inv / Thermal — legacy, SYNTH-mode only).
  // Hidden in TRACK mode to keep the BlobTracking visualization clean
  // (the spec's TRACK mode is "BlobTracking on top of LumiSynth output";
  // per-blob recoloring belongs to the LumiSynth chain, not the tracking
  // overlay). The blob-size + shape knobs that used to drive this pass
  // were retired with the rest of the legacy overlay UI; we hard-code
  // 1× scale + rect clipping so the legacy behavior survives untouched
  // under whatever blob extents Kalman tracks naturally.
  if (state.perBlob !== 'none' && blobs.length > 0) {
    const full = ctx.getImageData(0, 0, cw, ch);
    let touched = false;
    for (const blob of blobs) {
      const bx = Math.max(0, Math.floor(blob.cx - blob.w / 2));
      const by = Math.max(0, Math.floor(blob.cy - blob.h / 2));
      const bw = Math.min(cw - bx, Math.ceil(blob.w));
      const bh = Math.min(ch - by, Math.ceil(blob.h));
      if (bw <= 0 || bh <= 0) continue;
      applyFilterToSubregion(full.data, cw, bx, by, bw, bh, state.perBlob, 'rect');
      touched = true;
    }
    if (touched) ctx.putImageData(full, 0, 0);
  }

  // ============ BlobTracking overlay (TRACK mode only) ============
  // ISOLATED composite: clear the canvas to black, then paint overlays —
  // every LumiSynth pixel from above is wiped, leaving the tracking
  // visualization on a clean black backdrop (spec: "clean export for
  // VJs and analysts"). OVERLAY composite leaves the LumiSynth output
  // alone and paints overlays on top.
  if (state.mode === 'track') {
    if (state.trackComposite === 'isolated') {
      ctx.save();
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }
    // Build the opts bag for the overlay renderer. trackFxRack contributes
    // 0–3 effects, in slot order, only enabled non-empty slots.
    const effects = state.trackFxRack
      .filter((s) => s.enabled && s.type !== 'none')
      .map((s) => ({ type: s.type, params: s.params }));
    drawTrackOverlay(ctx, blobs, cw, ch, {
      shape: {
        type:       state.trackShape,
        hueColor:   state.trackShapeColor,
        thickness:  state.trackShapeThickness,
        padding:    state.trackShapePadding,
        styleParam: state.trackShapeStyle,
      },
      lines: {
        type:      state.trackLines,
        hueColor:  state.trackLinesColor,
        thickness: state.trackLinesThickness,
        param:     state.trackLinesParam,
        taper:     state.trackLinesTaper,
      },
      effects,
    });
  }

  if (fpsEnabled) updateFps(blobs.length);
}

// ---- Help tooltip ----
// Single body-level tooltip element that follows the cursor and shows the
// `data-tip` text of whatever interactive control the cursor is over. Distinct
// from the per-knob `.knob-val` (anchored below the knob, shows current value):
//   - knob-val:    immediate, anchored, numeric
//   - help-tooltip: 350ms-delayed, follows cursor, descriptive
// Suppressed while a knob is being dragged so the value tooltip isn't competed
// with. Position-flipped if it would overflow the viewport edges.
const helpTip = document.createElement('div');
helpTip.className = 'help-tooltip';
helpTip.setAttribute('aria-hidden', 'true');
document.body.appendChild(helpTip);

let _helpTipShowTimer = 0;
let _helpTipCurrentEl = null;
const HELP_TIP_DELAY = 350;
const HELP_TIP_OFFSET_X = 14;
const HELP_TIP_OFFSET_Y = 18;

function findTipAncestor(el) {
  while (el && el !== document.body) {
    if (el.dataset && el.dataset.tip) return el;
    el = el.parentElement;
  }
  return null;
}

function positionHelpTip(cursorX, cursorY) {
  const rect = helpTip.getBoundingClientRect();
  let x = cursorX + HELP_TIP_OFFSET_X;
  let y = cursorY + HELP_TIP_OFFSET_Y;
  if (x + rect.width > window.innerWidth - 8) x = cursorX - rect.width - HELP_TIP_OFFSET_X;
  if (y + rect.height > window.innerHeight - 8) y = cursorY - rect.height - HELP_TIP_OFFSET_Y;
  if (x < 8) x = 8;
  if (y < 8) y = 8;
  helpTip.style.transform = `translate(${x}px, ${y}px)`;
}

function hideHelpTip() {
  clearTimeout(_helpTipShowTimer);
  _helpTipShowTimer = 0;
  _helpTipCurrentEl = null;
  helpTip.classList.remove('visible');
}

document.addEventListener('mousemove', (e) => {
  // Don't fight the knob-val tooltip during a drag.
  if (document.querySelector('.knob.dragging')) {
    if (_helpTipCurrentEl) hideHelpTip();
    return;
  }
  const el = findTipAncestor(e.target);
  if (!el) {
    if (_helpTipCurrentEl) hideHelpTip();
    return;
  }
  positionHelpTip(e.clientX, e.clientY);
  if (el !== _helpTipCurrentEl) {
    _helpTipCurrentEl = el;
    helpTip.textContent = el.dataset.tip;
    if (helpTip.classList.contains('visible')) {
      // Already visible — just swap content, no re-delay.
    } else {
      clearTimeout(_helpTipShowTimer);
      _helpTipShowTimer = setTimeout(() => {
        if (_helpTipCurrentEl === el) helpTip.classList.add('visible');
      }, HELP_TIP_DELAY);
    }
  }
}, { passive: true });

document.addEventListener('mouseleave', hideHelpTip);
document.addEventListener('mousedown', hideHelpTip);
window.addEventListener('blur', hideHelpTip);

// Convention guard: future filter buttons (in any of the structure / color /
// per-blob groups) and future effect-card controls (knobs + toggles inside
// .effect-card) must ship with a data-tip describing them. The hover-tip
// system is the only inline help users get, so a missing tip is a real
// regression. Scope intentionally
// excludes top-bar controls and other sidebar groups (Speed, Source) that
// the help-tip system was not asked to cover.
// Coverage is granted if the element OR any ancestor up to its scope root
// carries data-tip (lets a parent describe a group of children at once).
if (import.meta.env.DEV) {
  queueMicrotask(() => {
    const scopes = [
      { root: document.getElementById('structure-group'), sel: '.toggle-btn' },
      { root: document.getElementById('perblob-group'),   sel: '.toggle-btn' },
      ...Array.from(document.querySelectorAll('.effect-card')).map((c) => ({
        root: c,
        sel: '.toggle-btn, .knob',
      })),
    ];
    const missing = [];
    for (const { root, sel } of scopes) {
      if (!root) continue;
      for (const el of root.querySelectorAll(sel)) {
        let n = el;
        let covered = false;
        while (n && n !== root.parentElement) {
          if (n.dataset && n.dataset.tip) { covered = true; break; }
          n = n.parentElement;
        }
        if (!covered) {
          const tag = el.tagName.toLowerCase();
          const id  = el.id ? `#${el.id}` : '';
          const txt = (el.textContent || el.dataset.value || '').trim().slice(0, 24);
          missing.push(`${tag}${id} "${txt}" (in #${root.id || root.dataset.cardEffect || '?'})`);
        }
      }
    }
    if (missing.length) {
      console.warn(
        '[help-tooltip] filter / effect-card controls missing data-tip:',
        missing
      );
    }
  });
}

// ---- Project name (inline rename in canvas-topbar) ----
// Click the project-name pill to rename. Enter / blur commits, Esc cancels.
// Persisted in localStorage under its own key (independent of the main state
// blob to keep concerns separate). Default: untitled.lumi.
const PROJECT_NAME_KEY = 'lumisynth-project-name';
const DEFAULT_PROJECT_NAME = 'untitled.lumi';
const projectNameEl = document.getElementById('topbar-projectname');

function loadProjectName() {
  if (!projectNameEl) return;
  let name = DEFAULT_PROJECT_NAME;
  try {
    const stored = localStorage.getItem(PROJECT_NAME_KEY);
    if (typeof stored === 'string' && stored.trim().length > 0) name = stored;
  } catch (_) { /* localStorage unavailable — fall through to default */ }
  projectNameEl.textContent = name;
  document.title = `${name} — LumiSynth`;
}

function saveProjectName(name) {
  try { localStorage.setItem(PROJECT_NAME_KEY, name); } catch (_) {}
}

function commitProjectName(rawText) {
  if (!projectNameEl) return;
  const trimmed = (rawText || '').trim();
  const name = trimmed.length > 0 ? trimmed : DEFAULT_PROJECT_NAME;
  projectNameEl.textContent = name;
  document.title = `${name} — LumiSynth`;
  saveProjectName(name);
  projectNameEl.classList.remove('editing');
  projectNameEl.setAttribute('contenteditable', 'false');
}

function cancelProjectNameEdit(originalName) {
  if (!projectNameEl) return;
  projectNameEl.textContent = originalName;
  projectNameEl.classList.remove('editing');
  projectNameEl.setAttribute('contenteditable', 'false');
}

if (projectNameEl) {
  let beforeEdit = projectNameEl.textContent;

  const beginEdit = () => {
    if (projectNameEl.classList.contains('editing')) return;
    beforeEdit = projectNameEl.textContent;
    projectNameEl.classList.add('editing');
    projectNameEl.setAttribute('contenteditable', 'plaintext-only');
    projectNameEl.focus();
    // Select all text inside the contenteditable for fast overwrite.
    const range = document.createRange();
    range.selectNodeContents(projectNameEl);
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  };

  projectNameEl.addEventListener('click', beginEdit);
  projectNameEl.addEventListener('keydown', (e) => {
    // Enter from the static (non-editing) state also begins edit, since the
    // element has tabindex=0 and role=button.
    if (!projectNameEl.classList.contains('editing')) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); beginEdit(); }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commitProjectName(projectNameEl.textContent);
      projectNameEl.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelProjectNameEdit(beforeEdit);
      projectNameEl.blur();
    }
  });
  projectNameEl.addEventListener('blur', () => {
    if (projectNameEl.classList.contains('editing')) {
      commitProjectName(projectNameEl.textContent);
    }
  });
}

// ---- Init ----
loadProjectName();
loadPersistedState();
applyStateToUI();
canvas.width  = canvasArea.clientWidth;
canvas.height = canvasArea.clientHeight;
btnSnapshot.disabled = !state.hasSource;
if (btnRecord) btnRecord.disabled = !state.hasSource;
