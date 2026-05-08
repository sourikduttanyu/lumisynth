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
import { ensureContext, uploadVideoFrame, compositeToCanvas2D, getChainFBOs } from './glContext.js';
import { applyCompose } from './glCompose.js';

const DEFAULTS = Object.freeze({
  // Pipeline stages.
  // - structure: one of 'none' | voronoi | cellular | ascii | shatter | erode | wave
  // - colorRack: array of slots — see makeColorRack(). Stores up to 3 chained
  //   COLOR effects. Initialized in startup (NOT in DEFAULTS) because each
  //   slot has a fresh per-instance id; performFullReset re-creates it via
  //   makeColorRack() so each session has unique ids.
  // - perBlob:   one of 'none' | inv | thermal  (legacy holding pen, moves to FX rack in P3)
  speed: 1, shape: 'rect', regionStyle: 'basic',
  structure: 'none', perBlob: 'none',
  voronoiThreshold: 0.5, voronoiJumpDist: 0.5, voronoiFalloff: 0.5, voronoiEdgeLines: 0.0,
  caDensity: 0.5, caStability: 0.5, caEvolutionSpeed: 0.5, caSourceInflux: 0.5,
  asciiCellSize: 0.3, asciiContrast: 0.3, asciiBlackThresh: 0.2, asciiGlyphStrength: 0.9,
  shatterCells: 0.3, shatterCrack: 0.2, shatterFill: 0.5, shatterRandom: 0.8,
  erodeMode: 0,      erodeRadius: 0.3,  erodeStrength: 0.7, erodeEdge: 0.0,
  // COLOR effect knob defaults moved to COLOR_PARAM_SCHEMAS — they're
  // per-slot now (state.colorRack[i].params), not global state.
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

const state = { ...DEFAULTS, hasSource: false, colorRack: makeColorRack() };

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
const swatchGrid   = document.getElementById('swatch-grid');

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
// Pipeline categorization. STRUCTURE effects still have right-panel cards
// driven by global `state.X` knobs (single-select stage). COLOR effects
// are per-slot now — their knobs live inline inside the rack slot, and
// runEffect() does NOT dispatch them (use runColorEffect with slot.params).
const STRUCTURE_SECTIONS = ['voronoi','cellular','ascii','shatter','erode','wave'];
const COLOR_SECTIONS     = ['oxide','synth','biolum','thermo','falsecolor'];
const GL_RESETS          = { voronoi: resetVoronoi, cellular: resetCA, wave: resetWave };

// Centralized STRUCTURE effect dispatch: pulls per-effect knob values
// from global `state` and forwards them to the correct module with a
// uniform call shape. COLOR effects are dispatched separately via
// runColorEffect (each color slot owns its own params).
//
// `name` is one of STRUCTURE_SECTIONS. `opts` (optional) flows straight
// through to the effect module's chain hooks.
function runEffect(name, opts) {
  switch (name) {
    case 'voronoi':
      return applyVoronoi(canvas.width, canvas.height, {
        threshold: state.voronoiThreshold, jumpDist: state.voronoiJumpDist,
        falloff: state.voronoiFalloff, edgeLines: state.voronoiEdgeLines,
      }, opts);
    case 'cellular':
      return applyCA(canvas.width, canvas.height, {
        density: state.caDensity, stability: state.caStability,
        evolutionSpeed: state.caEvolutionSpeed, sourceInflux: state.caSourceInflux,
      }, opts);
    case 'ascii':
      return applyASCII(canvas.width, canvas.height, {
        cellSize: state.asciiCellSize, contrast: state.asciiContrast,
        blackThreshold: state.asciiBlackThresh, glyphStrength: state.asciiGlyphStrength,
      }, opts);
    case 'wave':
      return applyWave(canvas.width, canvas.height, {
        sourceStrength: state.waveSource, damping: state.waveDamp,
        speed: state.waveSpeed, contrast: state.waveContr,
      }, opts);
    case 'shatter':
      return applyGLFilter('shatter',    canvas.width, canvas.height, [state.shatterCells, state.shatterCrack, state.shatterFill, state.shatterRandom],          opts);
    case 'erode':
      return applyGLFilter('erode',      canvas.width, canvas.height, [state.erodeMode, state.erodeRadius, state.erodeStrength, state.erodeEdge],                opts);
    // COLOR effects intentionally NOT dispatched here. Colors are
    // per-slot now and need their slot's params; runColorEffect handles
    // them. Calling runEffect('synth') without a params source would be
    // ambiguous (which synth slot?) so it just no-ops with a warn.
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
  voronoi:    'screen',
  cellular:   'screen',
  wave:       'screen',
  ascii:      'source-over',
  shatter:    'source-over',
  erode:      'source-over',
  oxide:      'source-over',
  synth:      'source-over',
  biolum:     'source-over',
  thermo:     'source-over',
  falsecolor: 'source-over',
};

const TOGGLE_CONFIG = [
  ['speed-group',       'speed',       parseFloat, (v) => { video.playbackRate = v; }],
  ['shape-group',       'shape',       String,     null],
  ['style-group',       'regionStyle', String,     null],
  ['structure-group',   'structure',   String,     onStructureChange],
  ['perblob-group',     'perBlob',     String,     onPerBlobChange],
  ['detect-mode-group', 'detectMode',  String,     () => { resetFrameHistory(); }],
  ['blob-size-group',   'blobSize',    parseInt,   null],
  ['erode-mode-group',  'erodeMode',   parseInt,   null],
  // false-band-group retired — falsecolor's banding toggle is now an
  // inline per-slot toggle inside the color rack (see COLOR_PARAM_SCHEMAS).
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
    updateOverlayColor(state.overlayColor);
    video.playbackRate = state.speed;
    // Color rack is a custom widget (not a toggle group), so it has to
    // render itself rather than ride the TOGGLE_CONFIG loop. Runs inside
    // the _applyingState guard so any future side effects on render don't
    // double-fire during state restore.
    renderColorRack();
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
    for (const k of Object.keys(DEFAULTS)) if (k in parsed) state[k] = parsed[k];
    if (parsed.colorRack) state.colorRack = parsed.colorRack;
  } catch { /* ignore */ }
}

// ---- Reset (two-stage confirm) ----
let resetConfirmTimer = 0;
function performFullReset() {
  for (const k of Object.keys(DEFAULTS)) state[k] = DEFAULTS[k];
  // colorRack lives outside DEFAULTS (per-instance ids); reset explicitly.
  state.colorRack = makeColorRack();
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

  if (video.readyState < 2 || video.videoWidth === 0) return;

  const cw = canvas.width;
  const ch = canvas.height;
  ctx.drawImage(video, 0, 0, cw, ch);

  const ow = Math.max(1, Math.round(cw * DETECT_SCALE));
  const oh = Math.max(1, Math.round(ch * DETECT_SCALE));
  if (offscreen.width !== ow || offscreen.height !== oh) {
    offscreen.width = ow; offscreen.height = oh;
  }
  // Detection/tracking only runs while the source is actually playing. When
  // paused, motion-mode would see zero frame-diff and starve every tracker
  // until they cull, making blobs vanish. Luma-mode would re-detect the same
  // bright pixels every tick, churning IDs. Either way: pause should freeze
  // detection. cachedBlobs is preserved from the last playing frame so the
  // overlays + per-blob filter still render against the frozen video frame
  // (and the user can keep tweaking shape / size / color knobs to see the
  // effect on a still image).
  if (!video.paused) {
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
  }
  const blobs = smoothBlobs(cachedBlobs);

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
    uploadVideoFrame(video);

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

  // Per-blob CPU filters (Inv / Thermal): ONE full-frame getImageData, N
  // region passes that share the buffer, ONE putImageData. Replaces the
  // old N-round-trip pattern (was 12-30 GPU↔CPU stalls per frame at
  // maxBlobs default). Skipped entirely when no per-blob filter is active
  // so the display canvas stays GPU-resident.
  // Sourced from state.perBlob (was state.filter pre-P1; per-blob is now
  // an independent stage that always layers on top of whatever the main
  // STRUCTURE/COLOR chain rendered).
  if (state.perBlob !== 'none' && blobs.length > 0 && state.blobSize > 0) {
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
      applyFilterToSubregion(full.data, cw, bx, by, bw, bh, state.perBlob, state.shape);
      touched = true;
    }
    if (touched) ctx.putImageData(full, 0, 0);
  }

  drawOverlays(ctx, blobs, state.regionStyle, state.shape, state.connectionRate, state.strokeWidth, state.blobSize, state.fontSize, state.overlayColor);

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

// ---- Init ----
loadPersistedState();
applyStateToUI();
canvas.width  = canvasArea.clientWidth;
canvas.height = canvasArea.clientHeight;
btnSnapshot.disabled = !state.hasSource;
