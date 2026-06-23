import './style.css';
import { detectBlobs, resetFrameHistory, setColorKeyTarget, clearColorKeyTarget } from './blobDetector.js';
import { applyFilterToSubregion } from './filters.js';
import { drawTrackOverlay, resetTrackOverlay } from './overlays.js';
import { trackBlobs, resetTracker } from './kalman.js';
import { applyASCII } from './ascii.js';
import { applyGLFilter, applyStructureMode } from './glFilters.js';
import { applyFxEffect, resetFxFeedback } from './glFx.js';
import { ensureContext, uploadVideoFrame, compositeToCanvas2D, getChainFBOs, captureFrameHistory, resetMotionHistory } from './glContext.js';
import { SHADER_SOURCES, SHADER_RES, setShaderSource, renderShaderSourceFrame, getShaderSourceCanvas, getShaderSourceParams, setShaderSourceParam } from './shaderSource.js';
import { applyCompose } from './glCompose.js';
import { BlobOneEuroFilter } from './oneEuroFilter.js';
import { initObjectDetector, setObjectDetectorDelegate, detectObjects, isObjectDetectorReady } from './mediapipeTracker.js';
import {
  STORAGE_KEY, RACK_SLOTS, DEFAULTS, TIMELINE_DEFAULTS, TIMELINE_MIN_SEGMENT_SECONDS,
  COLOR_PARAM_SCHEMAS, FX_PARAM_SCHEMAS, TRACK_FX_PARAM_SCHEMAS,
  STRUCTURE_SECTIONS, COLOR_MAP_SECTIONS, COLOR_UNIQUE_SECTIONS, COLOR_UNIQUE_FLAT,
  COLOR_PROC_SECTIONS, COLOR_SECTIONS, FX_SECTIONS, BLEND_MODES, GL_RESETS,
  makeSlotId, makeFactoryParams,
  makeFxFactoryParams, makeFxRack,
  makeTrackFxFactoryParams, makeTrackFxRack,
  BLOB_STRUCTURE_PARAM_SCHEMAS, BLOB_STRUCTURE_SECTIONS, BLOB_FX_SECTIONS,
  makeBlobFxRack, sanitizeBlobFxRack, sanitizeBlobStructureParams, makeBlobStructureParams,
} from './schemas.js';
import { runBlobFrame, disposeBlobPipeline, resetBlobFeedback } from './glBlobPipeline.js';

// GL error surface — GL modules call this to fire a user-visible toast on
// shader compile failure (avoids importing showToast into GL modules).
window.__lumiGLError = (msg) => { if (typeof showToast === 'function') showToast(msg, 'error'); };

// ---- Focus trap utility ----
function trapFocus(el) {
  el._trapHandler = (e) => {
    if (e.key !== 'Tab') return;
    const nodes = [...el.querySelectorAll(
      'button:not([disabled]),input:not([disabled]),[tabindex="0"]'
    )].filter(n => !n.closest('.hidden'));
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  el.addEventListener('keydown', el._trapHandler);
}
function releaseTrap(el) {
  if (el._trapHandler) { el.removeEventListener('keydown', el._trapHandler); el._trapHandler = null; }
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
  // TRACK detection backend (global runtime, NOT look-scoped — deliberately
  // kept out of DEFAULTS so it doesn't become per-timeline-segment).
  //   trackBackend: 'blob'   — grid local-maxima (blobDetector.js)
  //               | 'object' — MediaPipe object detection (mediapipeTracker.js)
  //   mpDelegate:   'GPU' | 'CPU' — MediaPipe inference delegate
  trackBackend: 'blob',
  mpDelegate: 'GPU',
  // Per-effect knob memory for the single COLOR stage: { [effect]: params }.
  // Lazily seeded with factory defaults on first pick (getColorParams).
  colorParams: {},
  fxRack: makeFxRack(),
  trackFxRack: makeTrackFxRack(),
  blobColorParams: {},
  blobFxRack: makeBlobFxRack(),
  blobStructureParams: {},
  ...TIMELINE_DEFAULTS,
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
const btnSnapshot      = document.getElementById('btn-snapshot');
const btnRecord        = document.getElementById('btn-record');
const btnRecordLbl     = document.getElementById('btn-record-label');
const exportResSelect  = document.getElementById('export-res-select');
let exportResKey = 'display';
exportResSelect?.addEventListener('change', () => { exportResKey = exportResSelect.value; });
const btnReset     = document.getElementById('btn-reset');
const btnFps       = document.getElementById('btn-fps');
const btnHelp      = document.getElementById('btn-help');
const introOverlay = document.getElementById('intro-overlay');
const introClose   = document.getElementById('intro-close');
const introStart   = document.getElementById('intro-start');
const accountStatus = document.getElementById('account-status');
const accountAuth   = document.getElementById('account-auth');
const authEmail     = document.getElementById('auth-email');
const authSendCode  = document.getElementById('auth-send-code');
const authCodeRow   = document.getElementById('auth-code-row');
const authCode      = document.getElementById('auth-code');
const authVerifyCode= document.getElementById('auth-verify-code');
const authLogout    = document.getElementById('auth-logout');
const presetName    = document.getElementById('preset-name');
const presetSave    = document.getElementById('preset-save');
const presetRefresh = document.getElementById('preset-refresh');
const presetList    = document.getElementById('preset-list');
const helpOverlay  = document.getElementById('help-overlay');
const helpClose    = document.getElementById('help-close');
const dropOverlay  = document.getElementById('drop-overlay');
const btnPlay      = document.getElementById('btn-play');
const btnMute      = document.getElementById('btn-mute');
const videoTime    = document.getElementById('video-time');
const timelinePanel = document.getElementById('timeline-panel');
const timelineTrack = document.getElementById('timeline-track');
const timelinePlayhead = document.getElementById('timeline-playhead');
const timelineAdd = document.getElementById('timeline-add');
const timelineDuplicate = document.getElementById('timeline-duplicate');
const timelineDelete = document.getElementById('timeline-delete');
const timelineCapture = document.getElementById('timeline-capture');
const fpsOverlay   = document.getElementById('fps-overlay');
const colorKeyInput   = document.getElementById('color-key-input');
const inkLowInput     = document.getElementById('ink-low-input');
const inkHighInput    = document.getElementById('ink-high-input');
// (overlay-color swatch grid retired — replaced by per-shape/per-lines hue knob)

// ---- Blob Synth DOM refs ----
const blobColorTabGroup     = document.getElementById('blob-color-tab-group');
const blobColorMapsGrid     = document.getElementById('blob-color-maps-grid');
const blobColorUniqueGrid   = document.getElementById('blob-color-unique-grid');
const blobColorProcGrid     = null; // removed — proc tab auto-selects okdrift, no swatch grid needed
const blobColorMapsPanel    = document.getElementById('blob-color-maps-knob-panel');
const blobColorUniquePanel  = document.getElementById('blob-color-unique-knob-panel');
const blobColorProcPanel    = document.getElementById('blob-color-proc-knob-panel');
const blobChromaDriverGroup = document.getElementById('blob-chroma-driver-group');
const blobChromaStopRow     = document.getElementById('blob-chroma-stop-row');
const blobChromaKnobPanel   = document.getElementById('blob-chroma-knob-panel');
const blobFxRackEl          = document.getElementById('blob-fx-rack');
const blobFxPickerEl        = document.getElementById('blob-fx-picker-popover');
const blobStructureKnobPanel = document.getElementById('blob-structure-knob-panel');

const offscreen = document.createElement('canvas');
const offCtx    = offscreen.getContext('2d', { willReadFrequently: true });
// Blob detection runs on CPU ImageData, so bound its pixel budget instead of
// scaling linearly with 4K/retina canvas sizes.
const DETECT_TARGET_PIXELS = 360000; // ~800x450, enough for stable blob centers.
const DETECT_MAX_SCALE = 0.5;
const DETECT_MIN_SCALE = 0.125;

// Render-loop FPS cap. Capped at 60 regardless of source video frame rate
// or display refresh rate. Reasoning:
//  - Display refresh ≥ 60Hz: the cap throttles the render loop to ~60Hz so
//    we don't burn CPU/GPU drawing identical pixels on a 120Hz/144Hz/240Hz
//    monitor (the source video tops out at 24/30/60 fps anyway — there's
//    no new input data at the higher cadence).
//  - Display refresh < 60Hz: hardware ceiling applies; the cap is a no-op.
//  - Source video at 24/30 fps: the compositor still runs at 60 to keep UI
//    overlays / blob smoothing animations feeling smooth.
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
const STRUCTURE_OUTPUT_MODE_VALUE = { mono: 0, source: 1, ink: 2, invert: 3 };

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
function formatTimePrecise(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0.0';
  return Number(seconds).toFixed(1);
}
function nearlyEqual(a, b) { return Math.abs(a - b) < 1e-6; }
let _renderLook = null;
function currentLook() {
  return _renderLook || state;
}
function structureOutputModeValue(look = currentLook()) {
  return STRUCTURE_OUTPUT_MODE_VALUE[look.structureOutputMode] ?? STRUCTURE_OUTPUT_MODE_VALUE.mono;
}
function normalizeHexColor(hex, fallback) {
  return (typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)) ? hex.toLowerCase() : fallback;
}
function hexToRgb01(hex, fallback) {
  const safe = normalizeHexColor(hex, fallback);
  return [
    parseInt(safe.slice(1, 3), 16) / 255,
    parseInt(safe.slice(3, 5), 16) / 255,
    parseInt(safe.slice(5, 7), 16) / 255,
  ];
}
function inkColorUniforms(look = currentLook()) {
  return {
    inkLow: hexToRgb01(look.inkBlackHex, DEFAULTS.inkBlackHex),
    inkHigh: hexToRgb01(look.inkCreamHex, DEFAULTS.inkCreamHex),
  };
}

const LEGACY_STORAGE_KEYS = ['lumisynth-state-v6', 'lumisynth-state-v5'];
const TIMELINE_STATE_KEYS = new Set(['timelineSegments', 'selectedTimelineSegmentId']);
const LOOK_STATE_KEYS = Object.keys(DEFAULTS).filter((k) => k !== 'speed' && !TIMELINE_STATE_KEYS.has(k));
const cloneData = (value) => JSON.parse(JSON.stringify(value));

// Validate per-effect COLOR knob memory: keep only known effects, and for
// each one keep only schema-known keys with type-valid values (numbers for
// knobs/toggles, hex strings for chroma's ramp stops). Unknown effects and
// junk values fall back to factory.
function sanitizeColorParams(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const type of Object.keys(raw)) {
    if (!COLOR_SECTIONS.includes(type)) continue;
    const src = raw[type];
    if (!src || typeof src !== 'object') continue;
    const factory = makeFactoryParams(type);
    const p = { ...factory };
    for (const k of Object.keys(factory)) {
      const v = src[k];
      if (typeof factory[k] === 'number') {
        if (typeof v === 'number' && Number.isFinite(v)) p[k] = v;
      } else if (typeof factory[k] === 'string') {
        p[k] = normalizeHexColor(v, factory[k]);
      }
    }
    out[type] = p;
  }
  return out;
}

// v8 migration: collapse a legacy 3-slot colorRack into the single COLOR
// stage — first enabled non-empty slot wins, its params seed colorParams.
// Used by sanitizeLook (timeline segments / presets) and loadPersistedState.
function migrateColorRack(raw) {
  if (!Array.isArray(raw.colorRack)) return raw;
  const out = { ...raw };
  if (!out.color || out.color === 'none') {
    const first = out.colorRack.find((s) =>
      s && typeof s === 'object' && s.enabled && s.type && s.type !== 'none' && COLOR_SECTIONS.includes(s.type));
    if (first) {
      out.color = first.type;
      out.colorParams = { ...(out.colorParams || {}), [first.type]: first.params || {} };
    }
  }
  delete out.colorRack;
  return out;
}

function sanitizeFxRack(rack) {
  if (!Array.isArray(rack) || rack.length !== RACK_SLOTS) return makeFxRack();
  return rack.map((slot) => {
    if (!slot || typeof slot !== 'object') {
      return { id: makeSlotId(), type: 'none', enabled: false, params: {} };
    }
    const type = (slot.type === 'none' || FX_SECTIONS.includes(slot.type)) ? slot.type : 'none';
    const factoryP = makeFxFactoryParams(type);
    const params = { ...factoryP };
    if (slot.params && typeof slot.params === 'object') {
      for (const k of Object.keys(factoryP)) {
        const v = slot.params[k];
        if (typeof v === 'number' && Number.isFinite(v)) params[k] = v;
      }
    }
    return {
      id: slot.id || makeSlotId(),
      type,
      enabled: !!slot.enabled && type !== 'none',
      params,
    };
  });
}

function sanitizeTrackFxRack(rack) {
  const types = Object.keys(TRACK_FX_PARAM_SCHEMAS);
  if (!Array.isArray(rack) || rack.length !== RACK_SLOTS) return makeTrackFxRack();
  return rack.map((slot) => {
    if (!slot || typeof slot !== 'object') {
      return { id: makeSlotId(), type: 'none', enabled: false, params: {} };
    }
    const type = (slot.type === 'none' || types.includes(slot.type)) ? slot.type : 'none';
    const factoryP = makeTrackFxFactoryParams(type);
    const params = { ...factoryP };
    if (slot.params && typeof slot.params === 'object') {
      for (const k of Object.keys(factoryP)) {
        const v = slot.params[k];
        if (typeof v === 'number' && Number.isFinite(v)) params[k] = v;
      }
    }
    return {
      id: slot.id || makeSlotId(),
      type,
      enabled: !!slot.enabled && type !== 'none',
      params,
    };
  });
}

function sanitizeLook(raw = {}) {
  raw = migrateColorRack(raw);
  const look = {};
  for (const k of LOOK_STATE_KEYS) {
    const fallback = DEFAULTS[k];
    const v = raw[k];
    look[k] = (typeof v === typeof fallback) ? v : fallback;
  }
  look.inkBlackHex = normalizeHexColor(look.inkBlackHex, DEFAULTS.inkBlackHex);
  look.inkCreamHex = normalizeHexColor(look.inkCreamHex, DEFAULTS.inkCreamHex);
  look.colorKeyHex = normalizeHexColor(look.colorKeyHex, DEFAULTS.colorKeyHex);
  if (look.color !== 'none' && !COLOR_SECTIONS.includes(look.color)) look.color = 'none';
  look.colorParams = sanitizeColorParams(raw.colorParams);
  look.fxRack = sanitizeFxRack(raw.fxRack);
  look.trackFxRack = sanitizeTrackFxRack(raw.trackFxRack);
  look.blobColorParams = sanitizeColorParams(raw.blobColorParams);
  look.blobFxRack = sanitizeBlobFxRack(raw.blobFxRack);
  look.blobStructureParams = sanitizeBlobStructureParams(raw.blobStructureParams);
  look.blobInkBlackHex = normalizeHexColor(look.blobInkBlackHex, DEFAULTS.blobInkBlackHex);
  look.blobInkCreamHex = normalizeHexColor(look.blobInkCreamHex, DEFAULTS.blobInkCreamHex);
  if (look.blobColor !== 'none' && !COLOR_SECTIONS.includes(look.blobColor)) look.blobColor = 'none';
  return look;
}

function makeLookSnapshot(source = state) {
  const raw = {};
  for (const k of LOOK_STATE_KEYS) raw[k] = source[k];
  raw.colorParams = cloneData(source.colorParams || {});
  raw.fxRack = cloneData(source.fxRack || makeFxRack());
  raw.trackFxRack = cloneData(source.trackFxRack || makeTrackFxRack());
  raw.blobColorParams = cloneData(source.blobColorParams || {});
  raw.blobFxRack = cloneData(source.blobFxRack || makeBlobFxRack());
  raw.blobStructureParams = cloneData(source.blobStructureParams || {});
  return sanitizeLook(raw);
}

let _rawTimelineLook = null;
function makeRawTimelineLook() {
  if (!_rawTimelineLook) _rawTimelineLook = sanitizeLook({});
  return _rawTimelineLook;
}

function applyLookToState(look) {
  const safe = sanitizeLook(look);
  for (const k of LOOK_STATE_KEYS) state[k] = safe[k];
  state.colorParams = cloneData(safe.colorParams);
  state.fxRack = cloneData(safe.fxRack);
  state.trackFxRack = cloneData(safe.trackFxRack);
  state.blobColorParams = cloneData(safe.blobColorParams);
  state.blobFxRack = cloneData(safe.blobFxRack);
  state.blobStructureParams = cloneData(safe.blobStructureParams);
  applyStateToUI();
}

function makeTimelineSegment(start, end, look = makeLookSnapshot()) {
  return {
    id: makeSlotId(),
    start,
    end,
    name: `SEG ${state.timelineSegments.length + 1}`,
    look: sanitizeLook(look),
  };
}

function sortedTimelineSegments() {
  return [...(state.timelineSegments || [])].sort((a, b) => a.start - b.start || a.end - b.end);
}

function sanitizeTimelineSegments(rawSegments, duration = Infinity) {
  if (!Array.isArray(rawSegments)) return [];
  const maxEnd = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  const segments = [];
  for (const raw of rawSegments) {
    if (!raw || typeof raw !== 'object') continue;
    const start = Math.max(0, Number(raw.start));
    const end = Math.min(maxEnd, Math.max(0, Number(raw.end)));
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end - start < TIMELINE_MIN_SEGMENT_SECONDS) continue;
    segments.push({
      id: raw.id || makeSlotId(),
      start,
      end,
      name: String(raw.name || `SEG ${segments.length + 1}`).slice(0, 24),
      look: sanitizeLook(raw.look || raw.state || {}),
    });
  }
  segments.sort((a, b) => a.start - b.start || a.end - b.end);
  const clean = [];
  let cursor = 0;
  for (const seg of segments) {
    const start = Math.max(seg.start, cursor);
    const end = Math.max(start + TIMELINE_MIN_SEGMENT_SECONDS, seg.end);
    if (end > maxEnd) continue;
    clean.push({ ...seg, start, end });
    cursor = end;
  }
  return clean;
}

function findTimelineSegmentAt(time) {
  if (state.sourceKind !== 'video' || !Number.isFinite(time)) return null;
  const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
  return sortedTimelineSegments().find((seg) => (
    time >= seg.start && (time < seg.end || (nearlyEqual(seg.end, duration) && time <= seg.end))
  )) || null;
}

function resolveTimelineLook(time) {
  const segment = findTimelineSegmentAt(time);
  if (segment) return { id: segment.id, look: segment.look };
  if (state.sourceKind === 'video') return { id: null, look: state };
  return { id: null, look: state };
}

function timelineRuntimeSignature(look) {
  return JSON.stringify({
    mode: look.mode,
    perBlob: look.perBlob,
    trackComposite: look.trackComposite,
    trackChannel: look.trackChannel,
    threshold: look.threshold,
    trackMinSize: look.trackMinSize,
    trackStability: look.trackStability,
    trackAttack:    look.trackAttack,
    trackRelease:   look.trackRelease,
    trackMaxBlobs:  look.trackMaxBlobs,
    updateInterval: look.updateInterval,
    colorKeyHex: look.colorKeyHex,
    colorKeyHueTol: look.colorKeyHueTol,
    colorKeySatMin: look.colorKeySatMin,
    trackFxRack: look.trackFxRack,
  });
}

// ---- Account / Cloud Presets ----
const INTERNAL_AUTH_KEY = 'lumisynth-internal-auth';
const INTERNAL_PRESETS_KEY = 'lumisynth-internal-presets';
const authState = {
  loading: true,
  user: null,
  presets: [],
  internal: false,
};

let internalLoginChallenge = null;

function setBusy(el, busy) {
  if (!el) return;
  el.disabled = !!busy;
}

function internalAuthAllowed() {
  return ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
}

function readInternalUser() {
  if (!internalAuthAllowed()) return null;
  try { return JSON.parse(localStorage.getItem(INTERNAL_AUTH_KEY) || 'null'); }
  catch { return null; }
}

function writeInternalUser(user) {
  try { localStorage.setItem(INTERNAL_AUTH_KEY, JSON.stringify(user)); } catch { /* ignore */ }
}

function clearInternalUser() {
  try { localStorage.removeItem(INTERNAL_AUTH_KEY); } catch { /* ignore */ }
}

function randomInternalCode() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return (new DataView(bytes.buffer).getUint32(0) % 1_000_000).toString().padStart(6, '0');
}

function readInternalPresets() {
  if (!internalAuthAllowed()) return [];
  try {
    const rows = JSON.parse(localStorage.getItem(INTERNAL_PRESETS_KEY) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function writeInternalPresets(presets) {
  try { localStorage.setItem(INTERNAL_PRESETS_KEY, JSON.stringify(presets)); } catch { /* ignore */ }
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error('API unavailable');
  const body = await res.json();
  if (!res.ok) {
    const message = body.error || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return body;
}

function presetStateSnapshot() {
  const {
    hasSource,
    sourceKind,
    timelineSegments,
    selectedTimelineSegmentId,
    ...persistable
  } = state;
  return JSON.parse(JSON.stringify(persistable));
}

function renderAccountUi() {
  const loggedIn = !!authState.user;
  if (accountStatus) {
    accountStatus.textContent = authState.loading
      ? 'Checking session...'
      : loggedIn
        ? `Logged in as ${authState.user.email}${authState.internal ? ' · internal' : ''}`
        : 'Login to unlock export and cloud presets.';
    accountStatus.classList.toggle('is-authed', loggedIn);
  }
  accountAuth?.classList.toggle('hidden', loggedIn);
  authLogout?.classList.toggle('hidden', !loggedIn);
  if (presetSave) presetSave.disabled = !loggedIn;
  if (presetRefresh) presetRefresh.disabled = !loggedIn;
  renderPresetList();
}

function renderPresetList() {
  if (!presetList) return;
  presetList.innerHTML = '';
  if (!authState.user) {
    presetList.textContent = 'Login to use cloud presets.';
    return;
  }
  if (!authState.presets.length) {
    presetList.textContent = 'No cloud presets yet.';
    return;
  }
  for (const preset of authState.presets) {
    const row = document.createElement('div');
    row.className = 'preset-row';

    const load = document.createElement('button');
    load.type = 'button';
    load.className = 'action-btn mini-action preset-load';
    load.textContent = preset.name;
    load.title = `Load ${preset.name}`;
    load.addEventListener('click', () => applyCloudPreset(preset));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'action-btn mini-action preset-delete';
    del.textContent = '×';
    del.title = `Delete ${preset.name}`;
    del.addEventListener('click', () => deleteCloudPreset(preset.id));

    row.append(load, del);
    presetList.append(row);
  }
}

async function initAuth() {
  try {
    const data = await apiFetch('/me', { method: 'GET', headers: {} });
    authState.user = data.user || null;
    authState.internal = false;
  } catch (_) {
    authState.user = readInternalUser();
    authState.internal = !!authState.user;
  } finally {
    authState.loading = false;
    renderAccountUi();
  }
  if (authState.user) loadCloudPresets();
}

async function sendLoginCode() {
  const email = authEmail?.value.trim();
  if (!email) {
    showToast('Enter an email first', 'error');
    authEmail?.focus();
    return;
  }
  setBusy(authSendCode, true);
  try {
    const data = await apiFetch('/auth/start', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    authCodeRow?.classList.remove('hidden');
    authCode?.focus();
    showToast(data.devCode ? `Dev login code: ${data.devCode}` : 'Login code sent', 'ok');
  } catch (err) {
    if (!internalAuthAllowed()) {
      showToast(err.message || 'Could not send login code', 'error');
      return;
    }
    const code = randomInternalCode();
    internalLoginChallenge = { email: email.toLowerCase(), code, expiresAt: Date.now() + 10 * 60 * 1000 };
    authCodeRow?.classList.remove('hidden');
    authCode?.focus();
    showToast(`Internal login code: ${code}`, 'ok', 8000);
  } finally {
    setBusy(authSendCode, false);
  }
}

async function verifyLoginCode() {
  const email = authEmail?.value.trim();
  const code = authCode?.value.trim();
  setBusy(authVerifyCode, true);
  try {
    const data = await apiFetch('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    });
    authState.user = data.user;
    authState.internal = false;
    authState.presets = [];
    authCodeRow?.classList.add('hidden');
    if (authCode) authCode.value = '';
    renderAccountUi();
    showToast('Logged in', 'ok');
    loadCloudPresets();
  } catch (err) {
    const normalizedEmail = String(email || '').toLowerCase();
    const challengeOk = internalAuthAllowed()
      && internalLoginChallenge
      && internalLoginChallenge.email === normalizedEmail
      && internalLoginChallenge.code === code
      && internalLoginChallenge.expiresAt > Date.now();
    if (!challengeOk) {
      showToast(err.message || 'Login failed', 'error');
      return;
    }
    const user = { id: `internal:${normalizedEmail}`, email: normalizedEmail };
    writeInternalUser(user);
    authState.user = user;
    authState.internal = true;
    authState.presets = readInternalPresets();
    internalLoginChallenge = null;
    authCodeRow?.classList.add('hidden');
    if (authCode) authCode.value = '';
    renderAccountUi();
    showToast('Logged in internally', 'ok');
  } finally {
    setBusy(authVerifyCode, false);
  }
}

async function logout() {
  if (authState.internal) clearInternalUser();
  else {
    try { await apiFetch('/auth/logout', { method: 'POST', body: '{}' }); } catch { /* ignore */ }
  }
  authState.user = null;
  authState.internal = false;
  authState.presets = [];
  renderAccountUi();
  showToast('Logged out', 'ok');
}

async function requireExportAccess(type) {
  if (!authState.user) {
    showToast('Login to export from LumiSynth', 'error');
    authEmail?.focus();
    return false;
  }
  if (authState.internal) return true;
  try {
    await apiFetch('/export-events', {
      method: 'POST',
      body: JSON.stringify({ type }),
    });
    return true;
  } catch (err) {
    if (err.status === 401) {
      authState.user = null;
      renderAccountUi();
      showToast('Session expired. Login again to export.', 'error');
      return false;
    }
    showToast(err.message || 'Export check failed', 'error');
    return false;
  }
}

async function loadCloudPresets() {
  if (!authState.user) return;
  if (authState.internal) {
    authState.presets = readInternalPresets();
    renderPresetList();
    return;
  }
  setBusy(presetRefresh, true);
  try {
    const data = await apiFetch('/presets', { method: 'GET', headers: {} });
    authState.presets = data.presets || [];
    renderPresetList();
  } catch (err) {
    showToast(err.message || 'Could not load presets', 'error');
  } finally {
    setBusy(presetRefresh, false);
  }
}

async function saveCloudPreset() {
  if (!authState.user) {
    showToast('Login to save cloud presets', 'error');
    return;
  }
  const name = presetName?.value.trim() || `LumiSynth ${new Date().toLocaleString()}`;
  setBusy(presetSave, true);
  try {
    if (authState.internal) {
      const presets = readInternalPresets();
      presets.unshift({
        id: crypto.randomUUID(),
        name,
        state: presetStateSnapshot(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      writeInternalPresets(presets);
      authState.presets = presets;
      if (presetName) presetName.value = '';
      renderPresetList();
      showToast('Internal preset saved', 'ok');
      return;
    }
    await apiFetch('/presets', {
      method: 'POST',
      body: JSON.stringify({ name, state: presetStateSnapshot() }),
    });
    if (presetName) presetName.value = '';
    showToast('Preset saved', 'ok');
    await loadCloudPresets();
  } catch (err) {
    showToast(err.message || 'Could not save preset', 'error');
  } finally {
    setBusy(presetSave, false);
  }
}

function applyCloudPreset(preset) {
  if (!preset || !preset.state || typeof preset.state !== 'object') {
    showToast('Preset is missing state', 'error');
    return;
  }
  // Legacy presets carry a colorRack; collapse it into the single color
  // stage before the DEFAULTS copy so `color`/`colorParams` come out right.
  const presetState = migrateColorRack(preset.state);
  for (const k of Object.keys(DEFAULTS)) {
    if (k in presetState) state[k] = presetState[k];
  }
  if (state.color !== 'none' && !COLOR_SECTIONS.includes(state.color)) state.color = 'none';
  state.colorParams = sanitizeColorParams(presetState.colorParams);
  if (Array.isArray(presetState.fxRack) && presetState.fxRack.length === RACK_SLOTS) {
    state.fxRack = sanitizeFxRack(presetState.fxRack);
  }
  if (Array.isArray(preset.state.trackFxRack) && preset.state.trackFxRack.length === RACK_SLOTS) {
    state.trackFxRack = preset.state.trackFxRack;
  }
  applyStateToUI();
  schedulePersist();
  showToast(`Loaded ${preset.name}`, 'ok');
}

async function deleteCloudPreset(id) {
  if (!id) return;
  try {
    if (authState.internal) {
      authState.presets = readInternalPresets().filter((p) => p.id !== id);
      writeInternalPresets(authState.presets);
      renderPresetList();
      showToast('Internal preset deleted', 'ok');
      return;
    }
    await apiFetch(`/presets/${encodeURIComponent(id)}`, { method: 'DELETE' });
    authState.presets = authState.presets.filter((p) => p.id !== id);
    renderPresetList();
    showToast('Preset deleted', 'ok');
  } catch (err) {
    showToast(err.message || 'Could not delete preset', 'error');
  }
}

authSendCode?.addEventListener('click', sendLoginCode);
authVerifyCode?.addEventListener('click', verifyLoginCode);
authLogout?.addEventListener('click', logout);
presetSave?.addEventListener('click', saveCloudPreset);
presetRefresh?.addEventListener('click', loadCloudPresets);
authEmail?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendLoginCode();
});
authCode?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') verifyLoginCode();
});

// ---- Knob component ----
const knobRegistry = new Map();   // id -> { setValue, getValue, min, max, step, default, stateKey, el }
let _knobDragActive = false;

// initKnob has two modes:
//   1. Default (no opts): wires the knob to global `state[stateKey]`,
//      registers in knobRegistry, persists on change. This is the
//      original behavior used by every knob in the right-panel cards.
//   2. Slot-bound (opts.writeValue + opts.initialValue): wires the knob
//      to a custom write callback instead of global state, AND skips the
//      registry entry (registry is for global-state knobs only — panel
//      knobs render fresh from their params store on every panel rebuild:
//      colorParams for the COLOR stage, slot.params for the FX/track racks).
//
// The callback approach keeps the 140-line knob implementation single
// and avoids two parallel implementations drifting apart. Slot knobs
// still get full keyboard / wheel / drag / dblclick-reset behavior.
function initSliderControl(el, opts = {}) {
  const id       = el.id;
  const min      = parseFloat(el.dataset.min);
  const max      = parseFloat(el.dataset.max);
  const step     = parseFloat(el.dataset.step);
  const def      = parseFloat(el.dataset.default);
  const stateKey = el.dataset.state || kebabToCamel(id);
  const isInt    = step >= 1 && Number.isInteger(min) && Number.isInteger(max);
  const valEl    = document.getElementById(`${id}-val`) || el.querySelector('.knob-val');
  const isSlotKnob = !!opts.writeValue;
  const seed = (opts.initialValue !== undefined) ? opts.initialValue : def;
  let currentValue = clamp(seed, min, max);

  el.classList.add('param-slider');
  el.removeAttribute('role');
  el.removeAttribute('aria-valuemin');
  el.removeAttribute('aria-valuemax');
  el.removeAttribute('aria-valuenow');
  el.removeAttribute('aria-valuetext');
  el.removeAttribute('tabindex');

  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'param-slider-input';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(currentValue);
  input.dataset.knob = '';
  input.setAttribute('aria-label', el.getAttribute('aria-label') || id);
  input.setAttribute('aria-valuemin', String(min));
  input.setAttribute('aria-valuemax', String(max));

  const labelEl = el.querySelector('.knob-label');
  if (labelEl) labelEl.insertAdjacentElement('afterend', input);
  else el.prepend(input);

  function paint(v) {
    const t = (v - min) / (max - min);
    const display = formatValue(v, step);
    input.value = String(v);
    input.style.setProperty('--slider-t', `${clamp(t, 0, 1) * 100}%`);
    input.setAttribute('aria-valuenow', String(v));
    input.setAttribute('aria-valuetext', display);
    if (valEl) valEl.textContent = display;
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

  input.addEventListener('input', () => setValue(parseFloat(input.value)));
  el.addEventListener('dblclick', (e) => { setValue(def); e.preventDefault(); });

  paint(currentValue);
  if (isSlotKnob) {
    opts.writeValue(currentValue);
  } else {
    state[stateKey] = currentValue;
    knobRegistry.set(id, { setValue, getValue, min, max, step, default: def, stateKey, el });
  }
}

function initKnob(el, opts = {}) {
  if (el.dataset.control === 'slider') {
    initSliderControl(el, opts);
    return;
  }

  const id      = el.id;
  const min     = parseFloat(el.dataset.min);
  const max     = parseFloat(el.dataset.max);
  const step    = parseFloat(el.dataset.step);
  const def     = parseFloat(el.dataset.default);
  const stateKey = el.dataset.state || kebabToCamel(id);
  const isInt   = step >= 1 && Number.isInteger(min) && Number.isInteger(max);
  const valEl   = document.getElementById(`${id}-val`) || el.querySelector('.knob-val');
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
    _knobDragActive = true;
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
    _knobDragActive = false;
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
      case 'Delete':
      case 'Backspace':  setValue(def); e.preventDefault(); return;
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
// Centralized STRUCTURE effect dispatch: pulls per-effect knob values
// from global `state` and forwards them to the correct module with a
// uniform call shape. COLOR effects are dispatched separately via
// runColorEffect (each color slot owns its own params).
function runEffect(name, opts) {
  const look = currentLook();
  switch (name) {
    case 'ascii':
      return applyASCII(canvas.width, canvas.height, {
        cellSize: look.asciiCellSize, contrast: look.asciiContrast,
        blackThreshold: look.asciiBlackThresh, glyphStrength: look.asciiGlyphStrength,
        edgeThreshold: look.asciiEdgeThreshold ?? 0.0,
      }, opts);
    case 'erode':
      return applyGLFilter('erode', canvas.width, canvas.height, [look.erodeMode, look.erodeRadius, look.erodeStrength, look.erodeEdge], opts);
    case 'pixelsort':
      return applyGLFilter('pixelsort', canvas.width, canvas.height, [look.pixelsortThresh, look.pixelsortLength, look.pixelsortOpacity, look.pixelsortDir], opts);
    case 'melt':
      return applyGLFilter('melt', canvas.width, canvas.height, [look.meltAmount, look.meltDrip, look.meltViscosity, look.meltDir], opts);
    case 'motionedge':
      return applyGLFilter('motionedge', canvas.width, canvas.height, [look.motionedgeEdge, look.motionedgeMotion, look.motionedgeThresh, look.motionedgeBoost], opts);
    case 'edgedet':
      return applyGLFilter('edgedet', canvas.width, canvas.height, [look.edgedetThresh, look.edgedetGlow, look.edgedetHue, look.edgedetBlend], opts);
    case 'dither':
      return applyGLFilter('dither', canvas.width, canvas.height, [look.ditherScale, look.ditherLevels, look.ditherContrast, look.ditherBias], opts);
    case 'colorisolation':
      return applyGLFilter('colorisolation', canvas.width, canvas.height, [look.colorisolationHue, look.colorisolationOverlap, look.colorisolationSteep, look.colorisolationMode ?? 0], opts);
    case 'cartoon':
      return applyGLFilter('cartoon', canvas.width, canvas.height, [look.cartoonPower, look.cartoonSlope, 0, 0], opts);
    case 'kuwahara':
      return applyGLFilter('kuwahara_struct', canvas.width, canvas.height, [look.kuwaharaStructRadius, look.kuwaharaStructSharp, 0, 0], opts);
    case 'moddiff':
      return applyGLFilter('moddiff', canvas.width, canvas.height, [look.moddiffFreq, look.moddiffMod, look.moddiffBlack, look.moddiffAxis ?? 0, look.moddiffDrift ?? 0], opts);
    case 'oxide':
    case 'synth':
    case 'biolum':
    case 'thermo':
    case 'falsecolor':
    case 'depthstack':
    case 'prismatic':
    case 'acidwash':
    case 'xray':
    case 'heatbleed':
    case 'nebula':
    case 'solarize':
    case 'aurorastorm':
    case 'cyanotype':
    case 'infrared':
    case 'neontube':
    case 'deepfield':
    case 'decayflow':
    case 'feedbackwarp':
    case 'bloom':
    case 'crtrolling':
    case 'noise':
    case 'scanlines':
    case 'degrade':
    case 'crt':
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
function runColorEffect(name, params, opts = {}) {
  const schema = COLOR_PARAM_SCHEMAS[name];
  if (!schema) return;
  const tuple = schema.order.map((k) => {
    const v = Number(params[k]);
    return Number.isFinite(v) ? v : 0;
  });
  while (tuple.length < 4) tuple.push(0);
  // okdrift packs blackStops, stops count and relationship type into uParam4:
  // blackStops*100 + N*10 + relType. blackStops=0 is identical to old format.
  if (name === 'okdrift') {
    const nStops     = Math.max(4, Math.min(10, Math.round(Number.isFinite(tuple[4]) ? tuple[4] : 6)));
    const relType    = Math.max(0, Math.min(9,  Math.round(params.relType    ?? 0)));
    const blackStops = Math.max(0, Math.min(4,  Math.round(params.blackStops ?? 0)));
    tuple[4] = blackStops * 100 + nStops * 10 + relType;
  }
  // ChromaEngine ramp stops are hex strings in params — they travel as vec3
  // uniforms via opts.stops (same out-of-band channel as the ink colors),
  // not in uParams.
  if (schema.colors) {
    opts = { ...opts, stops: schema.colors.map((c) => hexToRgb01(params[c.key], c.default)) };
  }
  return applyGLFilter(name, canvas.width, canvas.height, tuple, opts);
}

// The COLOR stage's always-on grade pass (Hue Rotate + Sat). Runs as its own
// chained GL stage right after the selected color — see resolveActivePipeline.
function runGradeEffect(grade, opts) {
  return applyGLFilter('grade', canvas.width, canvas.height, [grade.hue, grade.sat, grade.hueRange ?? 0, grade.hueRate ?? 0], opts);
}

// Dispatch a single FX RACK effect. Feedback effects (schema.feedback) route
// through glFx.js with the slot id as opts.fxKey so the module keeps per-slot
// trail state; stateless ones run through applyGLFilter exactly like COLOR
// effects — their shaders live in glFilters.js FRAGS.
function runFxEffect(name, params, opts = {}, key) {
  const schema = FX_PARAM_SCHEMAS[name];
  if (!schema) return;
  const tuple = schema.order.map((k) => {
    const v = Number(params[k]);
    return Number.isFinite(v) ? v : 0;
  });
  while (tuple.length < 4) tuple.push(0);
  if (schema.feedback) {
    return applyFxEffect(name, canvas.width, canvas.height, tuple, { ...opts, fxKey: key });
  }
  return applyGLFilter(name, canvas.width, canvas.height, tuple, opts);
}

const TOGGLE_CONFIG = [
  ['structure-group',       'structure',      String,     onStructureChange],
  ['structure-output-group', 'structureOutputMode', String, null],
  ['perblob-group',         'perBlob',        String,     onPerBlobChange],
  ['erode-mode-group',      'erodeMode',      parseInt,   null],
  // ============ TRACK-mode toggle groups ============
  ['mode-group',            'mode',           String,     onModeChange],
  ['track-backend-group',     'trackBackend',    String,              onTrackBackendChange],
  ['track-composite-group', 'trackComposite', String,     null],
  ['lumi-channel-group',    'trackChannel',   String,     (v) => { resetFrameHistory(); refreshColorKeyControls(v); }],
  ['track-shape-group',     'trackShape',     String,     null],
  ['track-lines-group',     'trackLines',     String,     null],
  ['track-labels-group',    'trackLabels',    String,     null],
  // ============ BLOB SYNTH toggle groups ============
  ['blob-structure-group',        'blobStructure',           String,               onBlobStructureChange],
  ['blob-structure-output-group', 'blobStructureOutputMode', String,               onBlobStructureOutputChange],
];

// Resolve which effects render this frame. STRUCTURE plus 0-3 chained
// colors from the rack (only enabled, non-none slots, in slot order).
// Each color carries its slot's per-slot params so the chain renderer
// doesn't have to look them up by id mid-frame.
//
// Per-blob (Inv / Thermal) remains independent — always layers on top
// of whatever the main chain produced; not part of this resolver.

// Resolve the blob synth pipeline descriptor from a look snapshot.
// Returns a blobPipe object consumed by runBlobFrame() in glBlobPipeline.js.
function resolveBlobPipeline(look) {
  const STRUCTURE_OUTPUT_MODE_VALUE = { mono: 0, source: 1, ink: 2, invert: 3 };
  const structureName = look.blobStructure !== 'none' ? look.blobStructure : null;
  let structureParams = [];
  if (structureName) {
    const p = (look.blobStructureParams && look.blobStructureParams[structureName]) || makeBlobStructureParams(structureName);
    switch (structureName) {
      case 'erode':     structureParams = [p.mode ?? 0, p.radius ?? 0.3, p.strength ?? 0.7, p.edge ?? 0]; break;
      case 'pixelsort': structureParams = [p.thresh ?? 0.4, p.length ?? 0.3, p.opacity ?? 0.8, p.dir ?? 0.5]; break;
      case 'melt':      structureParams = [p.amount ?? 0.5, p.drip ?? 0.4, p.viscosity ?? 0.5, p.dir ?? 0]; break;
      case 'ascii':     structureParams = [p.cellSize ?? 0.3, p.contrast ?? 0.3, p.blackThresh ?? 0.2, p.glyph ?? 0.9, p.edges ?? 0]; break;
      case 'motionedge':structureParams = [p.edge ?? 0.5, p.motion ?? 0.6, p.thresh ?? 0.15, p.boost ?? 0.5, p.rate ?? 0]; break;
      case 'edgedet':   structureParams = [p.thresh ?? 0.3, p.glow ?? 0.5, p.hue ?? 0.15, p.blend ?? 0.1]; break;
      case 'dither':    structureParams = [p.scale ?? 0.4, p.levels ?? 0.3, p.contrast ?? 0.5, p.bias ?? 0.5]; break;
      case 'colorisolation': structureParams = [p.hue ?? 0.0, p.overlap ?? 0.3, p.steep ?? 0.5, p.mode ?? 0]; break;
      case 'cartoon':        structureParams = [p.power ?? 0.3, p.slope ?? 0.4, 0, 0]; break;
      case 'kuwahara':       structureParams = [p.radius ?? 0.4, p.sharp ?? 0.5, 0, 0]; break;
      case 'moddiff':   structureParams = [p.freq ?? 0.25, p.mod ?? 0.45, p.black ?? 0.08, p.axis ?? 0, p.drift ?? 0]; break;
      default:          structureParams = [0, 0, 0, 0]; break;
    }
  }

  const colorActive = look.blobColor && look.blobColor !== 'none' && COLOR_PARAM_SCHEMAS[look.blobColor];
  const hue      = typeof look.blobColorHue      === 'number' ? look.blobColorHue      : 0;
  const sat      = typeof look.blobColorSat      === 'number' ? look.blobColorSat      : 0.5;
  const hueRange = typeof look.blobColorHueRange === 'number' ? look.blobColorHueRange : 0;
  const hueRate  = typeof look.blobColorHueRate  === 'number' ? look.blobColorHueRate  : 0;

  return {
    structure: structureName,
    structureParams,
    structureOutputMode: STRUCTURE_OUTPUT_MODE_VALUE[look.blobStructureOutputMode] ?? 0,
    inkLow:  hexToRgb01(look.blobInkBlackHex, DEFAULTS.blobInkBlackHex),
    inkHigh: hexToRgb01(look.blobInkCreamHex, DEFAULTS.blobInkCreamHex),
    color: colorActive
      ? { type: look.blobColor, params: (look.blobColorParams && look.blobColorParams[look.blobColor]) || makeFactoryParams(look.blobColor) }
      : null,
    grade: (hue > 0.001 || Math.abs(sat - 0.5) > 0.001 || hueRange > 0.001 || hueRate > 0.001)
      ? { hue, sat, hueRange, hueRate } : null,
    fx: (look.blobFxRack || [])
      .filter((s) => s.enabled && s.type !== 'none')
      .map((s) => ({ type: s.type, params: s.params, id: s.id })),
    composite: 'source-over',
  };
}

function resolveActivePipeline(look = currentLook()) {
  // Single COLOR stage (v8): the selected effect + its params from the
  // per-effect memory. Params fall back to factory without mutating the
  // look — timeline looks are read-only during render.
  const colorActive = look.color && look.color !== 'none' && COLOR_PARAM_SCHEMAS[look.color];
  const hue      = typeof look.colorHue      === 'number' ? look.colorHue      : 0;
  const sat      = typeof look.colorSat      === 'number' ? look.colorSat      : 0.5;
  const hueRange = typeof look.colorHueRange === 'number' ? look.colorHueRange : 0;
  const hueRate  = typeof look.colorHueRate  === 'number' ? look.colorHueRate  : 0;
  return {
    structure: look.structure !== 'none' ? look.structure : null,
    color: colorActive
      ? { type: look.color, params: (look.colorParams && look.colorParams[look.color]) || makeFactoryParams(look.color) }
      : null,
    // GRADE: always-on hue/sat post pass, active whenever any knob is off
    // neutral. Runs even with color = 'none' (grades raw video / STRUCTURE).
    grade: (hue > 0.001 || Math.abs(sat - 0.5) > 0.001 || hueRange > 0.001 || hueRate > 0.001)
      ? { hue, sat, hueRange, hueRate } : null,
    // FX RACK stages run after COLOR + grade (STRUCTURE → COLOR → GRADE → FX).
    // `key` is the slot id — glFx.js keys each slot's persistent feedback
    // buffers on it, so two slots with the same effect trail independently.
    fx: (look.fxRack || [])
      .filter((s) => s.enabled && s.type !== 'none')
      .map((s) => ({ type: s.type, params: s.params, key: s.id })),
  };
}

// Reveal/hide an effect-card based on whether its effect is currently
// selected. Only STRUCTURE effects still have right-panel cards — COLOR
// effects render their knobs INLINE inside their rack slot now (no
// right-panel card to show/hide). So this function only iterates the
// STRUCTURE set; COLOR is handled by renderColorPanel instead.
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

function refreshColorKeyControls(channel) {
  const el = document.getElementById('color-key-controls');
  if (el) el.style.display = channel === 'color' ? '' : 'none';
}

// Detection-backend visibility: object detection doesn't use the lumi-channel
// or color-key controls (those are blob-detector knobs), and the GPU/CPU
// delegate toggle only matters for the object backend. Hide accordingly.
function refreshBackendControls(backend) {
  const isObj = backend === 'object';
  const lumi = document.getElementById('lumi-channel-section');
  if (lumi) lumi.style.display = isObj ? 'none' : '';
  if (isObj) { const ck = document.getElementById('color-key-controls'); if (ck) ck.style.display = 'none'; }
  else refreshColorKeyControls(state.trackChannel);
}

// Lazily build the object detector. Idempotent (initObjectDetector no-ops when
// already ready on the same delegate). `notify` shows load toasts only for
// user-initiated switches — suppressed during bulk applyStateToUI.
function ensureObjectBackend(notify) {
  if (isObjectDetectorReady()) return;
  if (notify) showToast('Loading object model…', 'info', 2500);
  initObjectDetector(state.mpDelegate)
    .then(() => { if (notify) showToast('Object model ready', 'ok', 1500); })
    .catch(() => showToast('Object model failed to load', 'error', 3500));
}

function onTrackBackendChange(v) {
  refreshBackendControls(v);
  if (v === 'object') ensureObjectBackend(!_applyingState);
}

function onMpDelegateChange(v) {
  if (state.trackBackend === 'object') {
    setObjectDetectorDelegate(v).catch(() => showToast('Delegate switch failed', 'error', 3000));
  }
}

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
    if (isRadio) {
      b.setAttribute('aria-checked', match ? 'true' : 'false');
      b.tabIndex = match ? 0 : -1;
    } else {
      b.setAttribute('aria-pressed', match ? 'true' : 'false');
    }
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
    buttons.forEach((b, idx) => { if (group.getAttribute('role') === 'radiogroup') b.tabIndex = idx === next ? 0 : -1; });
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
// COLOR — single-stage UI (v8). Three tabs share ONE selection
// (state.color): MAPS (pure per-pixel color mapping, swatch grid),
// UNIQUE (effects that build something — neighbor sampling, added
// elements, displacement — in labeled categories), CUSTOM (the
// ChromaEngine: driver select + 4 ramp-stop pickers + shaping knobs).
// Per-effect knob memory lives in state.colorParams — switching effects
// and coming back keeps your tweaks. The always-on GRADE knobs
// (colorHue / colorSat) are static [data-knob] elements wired by the
// global knob init like any other state knob.
//
// Interaction rule: clicking a map / unique effect / any CUSTOM control
// selects that tab's effect. Activation from knob drags only toggles
// classes (updateColorActiveStates) — never rebuilds DOM mid-drag.
// ============================================================
const colorTabGroup     = document.getElementById('color-tab-group');
const colorTabMaps      = document.getElementById('color-tab-maps');
const colorTabUnique    = document.getElementById('color-tab-unique');
const colorTabCustom    = document.getElementById('color-tab-custom');
const colorTabProc      = document.getElementById('color-tab-proc');
const colorProcPanel    = document.getElementById('color-proc-knob-panel');
const colorMapsGrid     = document.getElementById('color-maps-grid');
const colorMapsPanel    = document.getElementById('color-maps-knob-panel');
const colorUniqueGrid   = document.getElementById('color-unique-grid');
const colorUniquePanel  = document.getElementById('color-unique-knob-panel');
const chromaDriverGroup = document.getElementById('chroma-driver-group');
const chromaStopRow     = document.getElementById('chroma-stop-row');
const chromaKnobPanel   = document.getElementById('chroma-knob-panel');

// Swatch gradient per COLOR effect — backgrounds for the MAPS/UNIQUE grid
// buttons (the .filter-swatch-group scrim keeps the white labels readable).
const COLOR_SWATCH_GRADIENTS = {
  oxide:      'linear-gradient(90deg, #1a0a00, #8b4513, #cd853f, #d4af37)',
  synth:      'linear-gradient(90deg, #f72585, #b5179e, #7209b7, #4361ee, #4cc9f0)',
  biolum:     'linear-gradient(90deg, #001a1a, #00ffcc, #88ddff, #aa88ff)',
  thermo:     'linear-gradient(90deg, #000, #220066, #cc0066, #ff6600, #ffff00, #fff)',
  falsecolor: 'linear-gradient(90deg, #4361ee, #00d4ff, #5be7a6, #ffea00, #f72585)',
  acidwash:   'linear-gradient(90deg, #9bff00, #00ffe0, #b000ff, #ff4ecb, #fffb00)',
  xray:       'linear-gradient(90deg, #07131a, #2c6b7f, #bde7ef, #fff8dd)',
  solarize:   'linear-gradient(90deg, #050505, #f6f1d3, #1d1b2f, #ff7a4d)',
  cyanotype:  'linear-gradient(90deg, #061423, #063f7a, #3fa7c7, #d7f3ee)',
  infrared:   'linear-gradient(90deg, #05081a, #234e7c, #d02775, #ffb1a3)',
  blackbody:  'linear-gradient(90deg, #000, #3d0100, #c84000, #ffdd00, #e8efff)',
  hubble:     'linear-gradient(90deg, #020008, #6d1500, #2a7a00, #00b5bb)',
  // UNIQUE tab
  nebula:     'linear-gradient(90deg, #05000d, #321a5c, #b13c74, #f4a36d)',
  aurorastorm:'linear-gradient(90deg, #00120b, #00d86a, #5ddcff, #d855ff)',
  deepfield:  'linear-gradient(90deg, #02030a, #111a3f, #9d4a2e, #ffd08a)',
  neontube:   'linear-gradient(90deg, #090010, #ff2fa3, #ffd2f0, #00e8ff)',
  prismatic:  'linear-gradient(90deg, #fff2bf, #ff9aa7, #a68cff, #9ffcff)',
  heatbleed:  'linear-gradient(90deg, #110006, #8a001f, #ff5500, #ffea00, #fff)',
  depthstack: 'linear-gradient(90deg, #050814, #23356f, #7354b8, #e8f3ff)',
  abyss:      'linear-gradient(90deg, #010010, #0a0050, #7a006e, #ff00aa, #ff8acd)',
  sequin:     'linear-gradient(90deg, #00aaff, #6600ff, #cc00ff, #ff0088, #ff5500, #ffcc00)',
  risograph:  'linear-gradient(90deg, #f5ead8, #e8b89a, #c86060, #a04080, #f5ead8)',
  octopus:    'linear-gradient(90deg, #05010c, #2a0f4a, #7a2a6e, #ff7a5c, #ffd2c0)',
  hologram:   'linear-gradient(90deg, #01060c, #073a4a, #19c8e8, #9ff4ff)',
  surveil:    'linear-gradient(90deg, #020503, #2c3a2e, #7d9682, #e8f0e8 72%, #ff8400 78%, #e8f0e8 84%)',
  newsprint:  'linear-gradient(90deg, #f7f2e6, #e85d75, #f7f2e6, #5560c8, #f7f2e6)',
  sketch:     'linear-gradient(135deg, #f2ece0, #d8cfc0 38%, #6b6358 70%, #2a2620)',
  polaroid:   'linear-gradient(90deg, #2e3b34, #6a7a6a, #c9bfa3, #f2e6c4)',
  blacklight: 'linear-gradient(90deg, #050008, #2a0a55, #7a1fd0, #ff3df0, #b6ff4d)',
  dreamstatic:'linear-gradient(90deg, #0a0a14, #8898d8, #e8a8c8, #b8a8e8, #f0e8ff)',
  predator:   'linear-gradient(90deg, #020512, #103a66, #2a6088, #ff8a1a, #fff3c4)',
  okband:     'linear-gradient(90deg, #3050d0, #8030b0, #c03050, #889018, #187850)',
  palswap:    'linear-gradient(90deg, #1a0030, #8800cc, #cc4400, #aadd00, #00aaff)',
  csadjust:   'linear-gradient(90deg, #1a1a2a, #2a4470, #7080c8, #d8ddf8)',
  halftone:   'linear-gradient(90deg, #f5f0e8, #c85a5a, #5050b0, #28a040, #f5f0e8)',
  colorfulposter: 'linear-gradient(90deg, #1a0030, #7a1060, #c85a20, #d4c030, #6ab040)',
  okdrift:    'linear-gradient(90deg, #2d0060, #7b00ff, #00aaff, #00ffaa, #ffaa00, #ff0055)',
};
const COLOR_LABEL = {
  oxide: 'Oxide', synth: 'Synth', biolum: 'BioLum', thermo: 'Thermo', falsecolor: 'FalseClr',
  acidwash: 'AcidWash', xray: 'X-Ray', solarize: 'Solarize', cyanotype: 'Cyanotype', infrared: 'Infrared',
  blackbody: 'Blackbody', hubble: 'Hubble',
  nebula: 'Nebula', aurorastorm: 'Aurora', deepfield: 'DeepField', neontube: 'NeonTube',
  prismatic: 'Prismatic', heatbleed: 'HeatBleed', depthstack: 'DepthStack', abyss: 'Abyss',
  sequin: 'Sequin',
  risograph: 'Riso',
  octopus: 'Octopus', hologram: 'Hologram', surveil: 'Surveil', newsprint: 'Newsprint', sketch: 'Sketch',
  polaroid: 'Polaroid', blacklight: 'Blacklight', dreamstatic: 'DreamStatic', predator: 'Predator',
  okband: 'OKBand',
  chroma: 'ChromaEngine',
  palswap: 'PalSwap', csadjust: 'CSAdjust', halftone: 'Halftone', colorfulposter: 'Poster',
  okdrift: 'OKDrift',
};

// Tooltip per COLOR effect — shown on the MAPS/UNIQUE grid buttons.
const COLOR_MAP_TIPS = {
  oxide:      'Oxide / patina material. Re-skins the input as corroded metal.',
  synth:      'Synthwave color grade. Maps luma to a 6-band palette.',
  biolum:     'Bioluminescent glow. Re-tints the input as deep-water bioluminescence.',
  thermo:     'Thermal-camera ramp. Maps luma to deep blue → cyan → yellow → red → white.',
  falsecolor: 'False-color palette swap. Cross-fades between four palettes.',
  acidwash:   'Psychedelic color banding. Sine-folded hue mapping creates repeating color cycles.',
  xray:       'Medical radiograph aesthetic. Inverted exposure, edge enhancement, film tint.',
  solarize:   'Solarization / Sabattier effect. Tone folding at a luminance threshold.',
  cyanotype:  'Blueprint paper aesthetic. Deep cobalt to pale cyan with paper grain.',
  infrared:   'Aerochrome infrared film. Magentas in foliage zones, deep blue shadows.',
  blackbody:  'Planckian temperature ramp. Maps luma to stellar color temperatures — deep ember through orange-yellow to blue-white hot plasma.',
  hubble:     'Hubble SHO emission palette. Maps luma bands to Sulphur (red), Hydrogen (green), Oxygen (blue). Toggle to HOO for a cyan-heavy Orion Nebula variant.',
  nebula:     'Cosmic gas cloud palette. Emission, reflection, or planetary nebula aesthetics.',
  aurorastorm:'Violent solar storm aurora. Vertical curtain streaks with extreme color bands.',
  deepfield:  'Hubble Ultra Deep Field aesthetic. Dark void with warm redshifted galaxy colors.',
  neontube:   'Emissive neon line-art. Edges glow as bright neon cores with atmospheric halo.',
  prismatic:  'Warm spectral dispersion. Prismatic chromatic aberration with yellow-pink spectrum.',
  heatbleed:  'Thermal color that bleeds spatially based on intensity. Hot colors spread outward.',
  depthstack: 'Holographic spectral depth planes. Banded color zones shift with luminance gradients.',
  sequin:     'Three hue-bounded shimmer profiles: Cyan, Cyan-Magenta, or Ember. Sparkle dots twinkle at peaks; Speed oscillates the palette without ever bleeding into green.',
  abyss:      'Stereoscopic void. Real R/B chromatic displacement creates 3D depth. Hue sweeps electric blue → vivid magenta → warm rose.',
  risograph:  'Two-color indie risograph print. Ink A covers shadows, Ink B the midtones — misregistration drifts them apart; halftone adds the dot-screen texture.',
  octopus:    'Deep-sea dreamcore. Dark zones billow with animated violet ink; bright regions become coral skin with flickering camouflage cells.',
  hologram:   'Sci-fi light projection. Translucent self-luminous cyan (or pink) with drifting interference bands, electric edge fringe, projector flicker.',
  surveil:    'Drone thermal targeting. Hard-quantized false-color bands; one luminance zone locks in a detection color. Sweep Target to scan.',
  newsprint:  'Pop-art halftone duotone. Two rotated dot screens — shadow ink + midtone ink — over warm paper. The TV Girl album-cover print.',
  sketch:     'Hand-drawn pen/pencil crosshatch. The image is "drawn" with directional hatch strokes that follow the shading and thicken in the shadows, on faint notebook paper. Ink/Color/Stroke/Wobble knobs — go full graphite B&W or live colored sketch. After flockaroo.',
  polaroid:   'Instant-film chemistry. Cyan-green shadows, yellowed highlights, milky lifted blacks, corner vignette. Found in a shoebox.',
  blacklight: 'UV poster room. Deep purple-black base; only bright regions fluoresce in hot neon paint. Sweep Paint from violet to acid green.',
  dreamstatic:'Shadows dissolve into slowly crawling pastel static while bright content stays solid. A signal coming through from a dream.',
  predator:   'Motion-as-heat thermal vision. Anything that moved since ~4 frames ago glows hot; still regions settle into a cold blue (or purple) body.',
  okband:     'Luma-to-OKLCH hue banding. Posterizes the scene into N luma bands; each band maps to an equidistant OKLCH hue for auto-harmonious palettes. Hue rotates the whole set. Dither softens hard band edges with Bayer grain.',
  palswap:    'OKLCH Palette Swap. Maps scene luma to a hue gradient in perceptual OKLCH space. Hue + Spread sweeps the color arc; Chroma sets intensity; Lift lifts the dark floor.',
  csadjust:   'OKLCH Color Space Adjust. Direct lightness, chroma, hue-rotation, and warmth knobs in perceptual OKLCH space — for creative grading without hue collisions.',
  halftone:   'CMYK halftone dot screens. Four angled dot-screen channels (C/M/Y/K) simulate offset-print reproduction. Scale controls dot size; Blend mixes with source.',
  colorfulposter: 'Luma posterization with CMYK color layer. Logistic curve quantizes the scene into flat tonal zones; a cyan-tinted hard-light blend adds graphic color. Levels/Slope/Continuity shape the posterization curve.',
  okdrift:    'Procedural OKLCH palette. Generates N color stops spaced by the golden angle and drifts each on an independent sinusoidal frequency. Low Rate = slow flow; High Rate = rapid snapping.',
};

// Per-effect knob memory access. Ensures state.colorParams[type] exists and
// backfills any keys added to an effect's schema since the params were saved.
function getColorParams(type) {
  if (!COLOR_SECTIONS.includes(type)) return {};
  const factory = makeFactoryParams(type);
  if (!state.colorParams[type]) {
    state.colorParams[type] = factory;
  } else {
    for (const k of Object.keys(factory)) {
      if (!(k in state.colorParams[type])) state.colorParams[type][k] = factory[k];
    }
  }
  return state.colorParams[type];
}

// Which COLOR tab is showing — UI-only, not persisted. applyStateToUI derives
// it from the loaded selection; browsing tabs never changes the selection.
let _colorTab = 'maps';
// rAF handle for the Proc tab live swatch preview animation.
let _okdriftAnimId = null;
// Timestamp of last auto-randomize fire (for Rate-driven palette switching).
let _okdriftLastRand = 0;
// Blob-side equivalents for the blob proc tab.
let _blobOkdriftAnimId = null;
let _blobOkdriftLastRand = 0;

function colorTabForSelection(color) {
  if (COLOR_UNIQUE_FLAT.includes(color)) return 'unique';
  if (color === 'chroma') return 'custom';
  if (COLOR_PROC_SECTIONS.includes(color)) return 'proc';
  return 'maps';
}

// Guard: initKnob fires writeValue once during panel construction — that
// must not count as a user interaction (it would steal the selection while
// merely RENDERING another tab's panel).
let _buildingColorPanel = false;

function setColor(type) {
  if (type !== 'none' && !COLOR_SECTIONS.includes(type)) return;
  state.color = type;
  if (type !== 'none') getColorParams(type);
  renderColorPanel();
  schedulePersist();
  if (fileStatus) fileStatus.textContent = type === 'none' ? 'Color: none' : `Color: ${COLOR_LABEL[type] || type}`;
}

// Activation from a secondary interaction (knob drag, ramp-stop input,
// driver click) — class toggles ONLY, never a DOM rebuild: rebuilding the
// panel that contains the knob being dragged would kill the gesture.
function activateColor(type) {
  if (_buildingColorPanel || state.color === type) return;
  state.color = type;
  updateColorActiveStates();
  schedulePersist();
}

function updateColorActiveStates() {
  for (const grid of [colorMapsGrid, colorUniqueGrid]) {
    if (!grid) continue;
    for (const btn of grid.querySelectorAll('.toggle-btn')) {
      const active = btn.dataset.value === state.color;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    }
  }
  colorTabUnique?.classList.toggle('color-source-active', COLOR_UNIQUE_FLAT.includes(state.color));
  colorTabCustom?.classList.toggle('color-source-active', state.color === 'chroma');
  colorTabProc?.classList.toggle('color-source-active', COLOR_PROC_SECTIONS.includes(state.color));
}

function setColorTab(tab) {
  if (tab !== 'proc' && _okdriftAnimId) {
    cancelAnimationFrame(_okdriftAnimId);
    _okdriftAnimId = null;
  }
  _colorTab = tab;
  if (colorTabGroup) {
    for (const btn of colorTabGroup.querySelectorAll('.toggle-btn')) {
      const match = btn.dataset.value === tab;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-selected', match ? 'true' : 'false');
    }
  }
  colorTabMaps?.classList.toggle('hidden',   tab !== 'maps');
  colorTabUnique?.classList.toggle('hidden', tab !== 'unique');
  colorTabCustom?.classList.toggle('hidden', tab !== 'custom');
  colorTabProc?.classList.toggle('hidden',   tab !== 'proc');
}

colorTabGroup?.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn) return;
  const tab = btn.dataset.value;
  setColorTab(tab);
  if (tab === 'proc') setColor('okdrift'); // single effect tab — auto-activate
});

// ---- Swatch button factory shared by the MAPS and UNIQUE grids ----
function makeColorSwatchButton(name) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'toggle-btn';
  btn.setAttribute('role', 'radio');
  btn.dataset.value = name;
  if (name === 'none') {
    btn.dataset.tip = 'No color stage. STRUCTURE output (or raw video) passes through to GRADE and the FX rack.';
    btn.setAttribute('aria-label', 'No color');
  } else {
    btn.dataset.tip = COLOR_MAP_TIPS[name] || '';
    btn.style.background = COLOR_SWATCH_GRADIENTS[name] || '';
    btn.setAttribute('aria-label', COLOR_LABEL[name] || name);
  }
  const span = document.createElement('span');
  span.textContent = name === 'none' ? 'None' : (COLOR_LABEL[name] || name);
  btn.appendChild(span);
  return btn;
}

// ---- MAPS tab: swatch grid built from COLOR_MAP_SECTIONS ----
// Adding a map to the library = schema + shader + COLOR_MAP_SECTIONS entry +
// label/gradient/tip rows here; the grid builds itself.
function buildColorMapsGrid() {
  if (!colorMapsGrid) return;
  colorMapsGrid.innerHTML = '';
  colorMapsGrid.appendChild(makeColorSwatchButton('none'));
  for (const name of COLOR_MAP_SECTIONS) {
    colorMapsGrid.appendChild(makeColorSwatchButton(name));
  }
}

// ---- UNIQUE tab: categorized grid built from COLOR_UNIQUE_SECTIONS ----
// Each category renders an in-grid header followed by its effects' swatch
// buttons. Adding a TouchDesigner port = schema + shader + a slug in one
// of the category rows (or a new category) + label/gradient/tip entries.
function buildColorUniqueGrid() {
  if (!colorUniqueGrid) return;
  colorUniqueGrid.innerHTML = '';
  for (const category of COLOR_UNIQUE_SECTIONS) {
    const header = document.createElement('div');
    header.className = 'color-grid-category';
    header.textContent = category.label;
    colorUniqueGrid.appendChild(header);
    const grid = document.createElement('div');
    grid.className = 'toggle-group filter-swatch-group color-maps-grid color-unique-row';
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', `${category.label} effects`);
    for (const name of category.effects) {
      grid.appendChild(makeColorSwatchButton(name));
    }
    colorUniqueGrid.appendChild(grid);
  }
}

colorMapsGrid?.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (btn) setColor(btn.dataset.value);
});
colorUniqueGrid?.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (btn) setColor(btn.dataset.value);
});

// ---- Shared knob-panel builder ----
// Builds an effect's knob set bound to its colorParams entry (same knob DOM
// the FX/TRACK racks use, so the styling rides along). Toggles (e.g.
// falsecolor's banding) render above the knobs. Knob writes activate the
// effect via activateColor — class-only, drag-safe.
function buildColorKnobs(container, type, idPrefix) {
  if (!container) return;
  container.innerHTML = '';
  const schema = COLOR_PARAM_SCHEMAS[type];
  if (!schema) return;
  const params = getColorParams(type);

  if (schema.toggles && schema.toggles.length) {
    for (const t of schema.toggles) {
      if (type === 'chroma' && t.key === 'driver') continue; // driver has its own static group
      if (type === 'okdrift' && t.key === 'relType') continue; // custom dropdown in buildOkdriftPanel
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
      for (const opt of t.options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'color-rack-slot-toggle-btn';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(params[t.key] === opt.value));
        b.dataset.tip = opt.tip;
        b.textContent = opt.label;
        if (params[t.key] === opt.value) b.classList.add('active');
        b.addEventListener('click', () => {
          if (params[t.key] === opt.value) return;
          params[t.key] = opt.value;
          for (const sib of grp.children) {
            const match = sib === b;
            sib.classList.toggle('active', match);
            sib.setAttribute('aria-checked', String(match));
          }
          activateColor(type);
          schedulePersist();
        });
        grp.appendChild(b);
      }
      wrap.appendChild(grp);
      container.appendChild(wrap);
    }
  }

  const controlStack = document.createElement('div');
  controlStack.className = 'control-stack color-stage-controls';
  const sliderStack = document.createElement('div');
  sliderStack.className = 'slider-stack';
  const knobCluster = document.createElement('div');
  knobCluster.className = 'knob-cluster color-rack-slot-knob-grid';
  for (const k of schema.knobs) {
    const knobId = `${idPrefix}-${k.key}`;
    const valId  = `${knobId}-val`;
    const knobEl = document.createElement('div');
    knobEl.className = 'knob slot-knob';
    knobEl.id = knobId;
    knobEl.dataset.knob = '';
    knobEl.dataset.min     = String(k.min);
    knobEl.dataset.max     = String(k.max);
    knobEl.dataset.step    = String(k.step);
    knobEl.dataset.default = String(k.default);
    if (k.control) knobEl.dataset.control = k.control;
    knobEl.dataset.tip     = k.tip;
    knobEl.tabIndex = 0;
    knobEl.setAttribute('aria-label', `${COLOR_LABEL[type] || type} ${k.label}`);
    const labelEl = document.createElement('span');
    labelEl.className = 'knob-label';
    labelEl.textContent = k.label;
    const valSpan = document.createElement('span');
    valSpan.className = 'knob-val';
    valSpan.id = valId;
    valSpan.textContent = String(params[k.key] ?? k.default);
    knobEl.appendChild(labelEl);
    knobEl.appendChild(valSpan);
    if (k.control === 'slider') sliderStack.appendChild(knobEl);
    else                        knobCluster.appendChild(knobEl);

    initKnob(knobEl, {
      writeValue:   (v) => { params[k.key] = v; activateColor(type); },
      initialValue: params[k.key] ?? k.default,
    });
  }
  if (sliderStack.childElementCount) controlStack.appendChild(sliderStack);
  if (knobCluster.childElementCount) controlStack.appendChild(knobCluster);
  if (controlStack.childElementCount) container.appendChild(controlStack);
}

// ---- PROC tab: OKDrift palette generator ----
// JS OKLCH helpers mirror the shader math for the live swatch preview strip.
function _oklchToSrgb(L, C, H) {
  const a = C * Math.cos(H), b = C * Math.sin(H);
  let l = L + 0.3963377774*a + 0.2158037573*b;
  let m = L - 0.1055613458*a - 0.0638541728*b;
  let s = L - 0.0894841775*a - 1.2914855480*b;
  l=l*l*l; m=m*m*m; s=s*s*s;
  const r =  4.0767416621*l - 3.3077115913*m + 0.2309699292*s;
  const g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s;
  const bv= -0.0041960863*l - 0.7034186147*m + 1.7076147010*s;
  return [r, g, bv].map(v => {
    v = Math.max(0, Math.min(1, v));
    return v <= 0.0031308 ? 12.92*v : 1.055*Math.pow(v, 1/2.4) - 0.055;
  });
}
function _okdriftBaseHue(idx, N, relType, hueOffset) {
  const tau = Math.PI * 2, base = hueOffset * tau, span = Math.max(N - 1, 1);
  switch (relType) {
    case 1: return base; // monochromatic: same hue, L grades across stops
    case 2: return base + (idx % 2) * Math.PI + Math.floor(idx / 2) * 0.30;
    case 3: return base + (idx - span * 0.5) * (0.524 / span); // ±15° arc
    case 4: return base + (idx % 3) * (tau / 3) + Math.floor(idx / 3) * 0.20;
    case 5: return base + (idx % 4) * (tau / 4) + Math.floor(idx / 4) * 0.18;
    case 6: { const grp=idx%3, pole=grp===0?0:grp===1?2.618:3.665; return base+pole+Math.floor(idx/3)*0.25; } // split-comp
    case 7: return base + idx * (tau / Math.max(N, 1)); // spectral rainbow
    case 8: { const pole=(idx%2)*Math.PI, gi=Math.floor(idx/2), gs=Math.max(Math.floor(N/2)-1,1); return base+pole+(gi-gs*0.5)*0.30/gs; } // duotone
    case 9: return base + (idx%5)*(tau/5) + Math.floor(idx/5)*0.16; // pentadic
    default: return base + idx * 2.39996; // golden angle (smart)
  }
}
function _okdriftStopColor(idx, N, relType, params) {
  const t = N > 1 ? idx / (N - 1) : 0.5;
  const L = Math.max(0.04, Math.min(0.96, 0.12 + 0.76 * t + ((params.light ?? 0.5) - 0.5) * 0.5));
  const C = (params.chroma ?? 0.65) * 0.34;
  const H = _okdriftBaseHue(idx, N, relType, params.hue ?? 0);
  return _oklchToSrgb(L, C, H);
}
function _srgbToHex(rgb) {
  return '#' + rgb.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
}

function buildOkdriftPanel(container) {
  if (!container) return;
  if (_okdriftAnimId) { cancelAnimationFrame(_okdriftAnimId); _okdriftAnimId = null; }
  container.innerHTML = '';
  const params = getColorParams('okdrift');

  // Palette preview strip
  const previewWrap = document.createElement('div');
  previewWrap.className = 'okdrift-preview-wrap';
  const swatchRow = document.createElement('div');
  swatchRow.className = 'okdrift-swatch-row';
  previewWrap.appendChild(swatchRow);
  container.appendChild(previewWrap);

  // Controls row: harmony dropdown + randomize button
  const ctrlRow = document.createElement('div');
  ctrlRow.className = 'okdrift-controls-row';

  const relLabel = document.createElement('span');
  relLabel.className = 'okdrift-rel-label';
  relLabel.textContent = 'Harmony';

  const relSelect = document.createElement('select');
  relSelect.className = 'okdrift-rel-select';
  for (const [v, lbl] of [[0,'Smart'],[1,'Monochromatic'],[2,'Complementary'],[3,'Analogous'],[4,'Triadic'],[5,'Tetradic'],[6,'Split-Comp'],[7,'Spectral'],[8,'Duotone'],[9,'Pentadic']]) {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = lbl;
    if (v === (params.relType ?? 0)) opt.selected = true;
    relSelect.appendChild(opt);
  }
  relSelect.addEventListener('change', () => {
    params.relType = parseInt(relSelect.value, 10);
    activateColor('okdrift');
    schedulePersist();
  });

  const randBtn = document.createElement('button');
  randBtn.type = 'button';
  randBtn.className = 'okdrift-rand-btn';
  randBtn.textContent = 'Randomize';
  randBtn.addEventListener('click', () => {
    params.hue = Math.random();
    activateColor('okdrift');
    schedulePersist();
    buildOkdriftPanel(container);
  });

  ctrlRow.appendChild(relLabel);
  ctrlRow.appendChild(relSelect);
  ctrlRow.appendChild(randBtn);
  container.appendChild(ctrlRow);

  // Standard knobs — use a child div so buildColorKnobs' innerHTML='' doesn't wipe our widgets
  const knobsDiv = document.createElement('div');
  container.appendChild(knobsDiv);
  buildColorKnobs(knobsDiv, 'okdrift', 'proc-okdrift');

  // Swatch preview + Rate-driven auto-randomize tick
  function tick() {
    const N          = Math.max(4, Math.min(10, Math.round(params.stops      ?? 6)));
    const relType    = Math.max(0, Math.min(9,  Math.round(params.relType    ?? 0)));
    const blackStops = Math.max(0, Math.min(4,  Math.round(params.blackStops ?? 0)));
    const rate = params.rate ?? 0;

    // Auto-randomize: Rate > 0 fires a new random hue at a log-scaled interval.
    // Rate=0 → off. Rate=0.5 → ~316ms. Rate=1 → 100ms (strobe).
    if (rate > 0) {
      const intervalMs = Math.pow(10, 4 - rate * 3);
      const now = performance.now();
      if (now - _okdriftLastRand >= intervalMs) {
        _okdriftLastRand = now;
        params.hue = Math.random();
        schedulePersist();
        const hueValEl = document.getElementById('proc-okdrift-hue-val');
        if (hueValEl) hueValEl.textContent = params.hue.toFixed(2);
      }
    }

    while (swatchRow.children.length < N) {
      const sw = document.createElement('div');
      sw.className = 'okdrift-swatch';
      const hexEl = document.createElement('span');
      hexEl.className = 'okdrift-hex';
      sw.appendChild(hexEl);
      swatchRow.appendChild(sw);
    }
    while (swatchRow.children.length > N) swatchRow.removeChild(swatchRow.lastChild);

    for (let i = 0; i < N; i++) {
      const hex = (i < blackStops) ? '#000000' : _srgbToHex(_okdriftStopColor(i, N, relType, params));
      swatchRow.children[i].style.background = hex;
      swatchRow.children[i].querySelector('.okdrift-hex').textContent = hex;
    }
    _okdriftAnimId = requestAnimationFrame(tick);
  }
  tick();
}

function buildBlobOkdriftPanel(container) {
  if (!container) return;
  if (_blobOkdriftAnimId) { cancelAnimationFrame(_blobOkdriftAnimId); _blobOkdriftAnimId = null; }
  container.innerHTML = '';
  const params = getBlobColorParams('okdrift');

  const previewWrap = document.createElement('div');
  previewWrap.className = 'okdrift-preview-wrap';
  const swatchRow = document.createElement('div');
  swatchRow.className = 'okdrift-swatch-row';
  previewWrap.appendChild(swatchRow);
  container.appendChild(previewWrap);

  const ctrlRow = document.createElement('div');
  ctrlRow.className = 'okdrift-controls-row';

  const relLabel = document.createElement('span');
  relLabel.className = 'okdrift-rel-label';
  relLabel.textContent = 'Harmony';

  const relSelect = document.createElement('select');
  relSelect.className = 'okdrift-rel-select';
  for (const [v, lbl] of [[0,'Smart'],[1,'Monochromatic'],[2,'Complementary'],[3,'Analogous'],[4,'Triadic'],[5,'Tetradic'],[6,'Split-Comp'],[7,'Spectral'],[8,'Duotone'],[9,'Pentadic']]) {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = lbl;
    if (v === (params.relType ?? 0)) opt.selected = true;
    relSelect.appendChild(opt);
  }
  relSelect.addEventListener('change', () => {
    params.relType = parseInt(relSelect.value, 10);
    activateBlobColor('okdrift');
    schedulePersist();
  });

  const randBtn = document.createElement('button');
  randBtn.type = 'button';
  randBtn.className = 'okdrift-rand-btn';
  randBtn.textContent = 'Randomize';
  randBtn.addEventListener('click', () => {
    params.hue = Math.random();
    activateBlobColor('okdrift');
    schedulePersist();
    buildBlobOkdriftPanel(container);
  });

  ctrlRow.appendChild(relLabel);
  ctrlRow.appendChild(relSelect);
  ctrlRow.appendChild(randBtn);
  container.appendChild(ctrlRow);

  const knobsDiv = document.createElement('div');
  container.appendChild(knobsDiv);
  buildBlobColorKnobs(knobsDiv, 'okdrift', 'blob-proc-okdrift');

  function tick() {
    const N          = Math.max(4, Math.min(10, Math.round(params.stops      ?? 6)));
    const relType    = Math.max(0, Math.min(9,  Math.round(params.relType    ?? 0)));
    const blackStops = Math.max(0, Math.min(4,  Math.round(params.blackStops ?? 0)));
    const rate = params.rate ?? 0;

    if (rate > 0) {
      const intervalMs = Math.pow(10, 4 - rate * 3);
      const now = performance.now();
      if (now - _blobOkdriftLastRand >= intervalMs) {
        _blobOkdriftLastRand = now;
        params.hue = Math.random();
        schedulePersist();
        const hueValEl = document.getElementById('blob-proc-okdrift-hue-val');
        if (hueValEl) hueValEl.textContent = params.hue.toFixed(2);
      }
    }

    while (swatchRow.children.length < N) {
      const sw = document.createElement('div');
      sw.className = 'okdrift-swatch';
      const hexEl = document.createElement('span');
      hexEl.className = 'okdrift-hex';
      sw.appendChild(hexEl);
      swatchRow.appendChild(sw);
    }
    while (swatchRow.children.length > N) swatchRow.removeChild(swatchRow.lastChild);

    for (let i = 0; i < N; i++) {
      const hex = (i < blackStops) ? '#000000' : _srgbToHex(_okdriftStopColor(i, N, relType, params));
      swatchRow.children[i].style.background = hex;
      swatchRow.children[i].querySelector('.okdrift-hex').textContent = hex;
    }
    _blobOkdriftAnimId = requestAnimationFrame(tick);
  }
  tick();
}

// ---- CUSTOM tab: ChromaEngine controls ----
// Driver toggle group + 4 ramp-stop color inputs + shaping knobs, all bound
// to colorParams.chroma. Any interaction activates 'chroma'.
function buildChromaControls() {
  const schema = COLOR_PARAM_SCHEMAS.chroma;
  if (!schema) return;
  const params = getColorParams('chroma');

  if (chromaDriverGroup) {
    chromaDriverGroup.innerHTML = '';
    const driver = schema.toggles.find((t) => t.key === 'driver');
    for (const opt of driver.options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toggle-btn';
      btn.setAttribute('role', 'radio');
      btn.dataset.driverValue = String(opt.value);
      btn.dataset.tip = opt.tip;
      const active = params.driver === opt.value;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', String(active));
      const span = document.createElement('span');
      span.textContent = opt.label;
      btn.appendChild(span);
      chromaDriverGroup.appendChild(btn);
    }
  }

  if (chromaStopRow) {
    chromaStopRow.innerHTML = '';
    for (const c of schema.colors) {
      const label = document.createElement('label');
      label.className = 'color-picker-control';
      const input = document.createElement('input');
      input.type = 'color';
      input.className = 'color-picker-input';
      input.value = normalizeHexColor(params[c.key], c.default);
      input.dataset.tip = c.tip;
      input.dataset.stopKey = c.key;
      const span = document.createElement('span');
      span.className = 'color-picker-label';
      span.textContent = c.label.toUpperCase();
      label.appendChild(input);
      label.appendChild(span);
      chromaStopRow.appendChild(label);
    }
  }

  buildColorKnobs(chromaKnobPanel, 'chroma', 'chroma-knob');
}

chromaDriverGroup?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-driver-value]');
  if (!btn) return;
  const params = getColorParams('chroma');
  params.driver = parseInt(btn.dataset.driverValue, 10);
  for (const b of chromaDriverGroup.querySelectorAll('[data-driver-value]')) {
    const match = b === btn;
    b.classList.toggle('active', match);
    b.setAttribute('aria-checked', String(match));
  }
  activateColor('chroma');
  schedulePersist();
});

chromaStopRow?.addEventListener('input', (e) => {
  const input = e.target.closest('[data-stop-key]');
  if (!input) return;
  const params = getColorParams('chroma');
  params[input.dataset.stopKey] = normalizeHexColor(input.value, '#000000');
  activateColor('chroma');
  schedulePersist();
});

// ---- Full COLOR panel render ----
// Rebuilds every tab's contents from state. Called on selection clicks, tab
// data changes, and applyStateToUI — never from knob drags.
function renderColorPanel() {
  _buildingColorPanel = true;
  try {
    if (colorMapsPanel) {
      colorMapsPanel.innerHTML = '';
      if (COLOR_MAP_SECTIONS.includes(state.color)) {
        buildColorKnobs(colorMapsPanel, state.color, `map-${state.color}`);
      }
    }
    if (colorUniquePanel) {
      colorUniquePanel.innerHTML = '';
      if (COLOR_UNIQUE_FLAT.includes(state.color)) {
        buildColorKnobs(colorUniquePanel, state.color, `unique-${state.color}`);
      }
    }
    if (colorProcPanel) {
      if (COLOR_PROC_SECTIONS.includes(state.color)) {
        buildOkdriftPanel(colorProcPanel);
      } else {
        if (_okdriftAnimId) { cancelAnimationFrame(_okdriftAnimId); _okdriftAnimId = null; }
        colorProcPanel.innerHTML = '';
      }
    }
    buildChromaControls();
    updateColorActiveStates();
  } finally {
    _buildingColorPanel = false;
  }
}

buildColorMapsGrid();
buildColorUniqueGrid();

// ============================================================
// BLOB COLOR — mirrors the main color panel but bound to
// state.blobColorParams, state.blobColor, state.blobColorHue/Sat.
// ============================================================

function getBlobColorParams(type) {
  if (!COLOR_SECTIONS.includes(type)) return {};
  const factory = makeFactoryParams(type);
  if (!state.blobColorParams) state.blobColorParams = {};
  if (!state.blobColorParams[type]) {
    state.blobColorParams[type] = factory;
  } else {
    for (const k of Object.keys(factory)) {
      if (!(k in state.blobColorParams[type])) state.blobColorParams[type][k] = factory[k];
    }
  }
  return state.blobColorParams[type];
}

let _blobColorTab = 'maps';
let _buildingBlobColorPanel = false;

function setBlobColor(type) {
  if (type !== 'none' && !COLOR_SECTIONS.includes(type)) return;
  state.blobColor = type;
  if (type !== 'none') getBlobColorParams(type);
  renderBlobColorPanel();
  schedulePersist();
}

function activateBlobColor(type) {
  if (_buildingBlobColorPanel || state.blobColor === type) return;
  state.blobColor = type;
  updateBlobColorActiveStates();
  schedulePersist();
}

function updateBlobColorActiveStates() {
  for (const grid of [blobColorMapsGrid, blobColorUniqueGrid, blobColorProcGrid]) {
    if (!grid) continue;
    for (const btn of grid.querySelectorAll('.toggle-btn')) {
      const active = btn.dataset.value === state.blobColor;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    }
  }
}

function setBlobColorTab(tab) {
  if (tab !== 'proc' && _blobOkdriftAnimId) {
    cancelAnimationFrame(_blobOkdriftAnimId);
    _blobOkdriftAnimId = null;
  }
  _blobColorTab = tab;
  if (blobColorTabGroup) {
    for (const btn of blobColorTabGroup.querySelectorAll('.toggle-btn')) {
      const match = btn.dataset.value === tab;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-selected', match ? 'true' : 'false');
    }
  }
  document.getElementById('blob-color-tab-maps')?.classList.toggle('hidden', tab !== 'maps');
  document.getElementById('blob-color-tab-unique')?.classList.toggle('hidden', tab !== 'unique');
  document.getElementById('blob-color-tab-custom')?.classList.toggle('hidden', tab !== 'custom');
  document.getElementById('blob-color-tab-proc')?.classList.toggle('hidden', tab !== 'proc');
  if (tab === 'proc') setBlobColor('okdrift');
}

function makeBlobColorSwatchButton(name) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'toggle-btn';
  btn.setAttribute('role', 'radio');
  btn.dataset.value = name;
  if (name === 'none') {
    btn.dataset.tip = 'No blob color stage.';
    btn.setAttribute('aria-label', 'No color');
  } else {
    btn.dataset.tip = COLOR_MAP_TIPS[name] || '';
    btn.style.background = COLOR_SWATCH_GRADIENTS[name] || '';
    btn.setAttribute('aria-label', COLOR_LABEL[name] || name);
  }
  const span = document.createElement('span');
  span.textContent = name === 'none' ? 'None' : (COLOR_LABEL[name] || name);
  btn.appendChild(span);
  return btn;
}

function buildBlobColorMapsGrid() {
  if (!blobColorMapsGrid) return;
  blobColorMapsGrid.innerHTML = '';
  blobColorMapsGrid.appendChild(makeBlobColorSwatchButton('none'));
  for (const name of COLOR_MAP_SECTIONS) blobColorMapsGrid.appendChild(makeBlobColorSwatchButton(name));
}

function buildBlobColorUniqueGrid() {
  if (!blobColorUniqueGrid) return;
  blobColorUniqueGrid.innerHTML = '';
  for (const category of COLOR_UNIQUE_SECTIONS) {
    const header = document.createElement('div');
    header.className = 'color-grid-category';
    header.textContent = category.label;
    blobColorUniqueGrid.appendChild(header);
    const grid = document.createElement('div');
    grid.className = 'toggle-group filter-swatch-group color-maps-grid color-unique-row';
    grid.setAttribute('role', 'radiogroup');
    for (const name of category.effects) grid.appendChild(makeBlobColorSwatchButton(name));
    blobColorUniqueGrid.appendChild(grid);
  }
}


function buildBlobColorKnobs(container, type, idPrefix) {
  if (!container) return;
  container.innerHTML = '';
  const schema = COLOR_PARAM_SCHEMAS[type];
  if (!schema) return;
  const params = getBlobColorParams(type);

  if (schema.toggles && schema.toggles.length) {
    for (const t of schema.toggles) {
      if (type === 'chroma' && t.key === 'driver') continue;
      const wrap = document.createElement('div');
      wrap.className = 'color-rack-slot-toggle';
      const lbl = document.createElement('span');
      lbl.className = 'color-rack-slot-toggle-label';
      lbl.textContent = t.label;
      wrap.appendChild(lbl);
      const grp = document.createElement('div');
      grp.className = 'color-rack-slot-toggle-group';
      for (const opt of t.options) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'color-rack-slot-toggle-btn';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(params[t.key] === opt.value));
        b.dataset.tip = opt.tip; b.textContent = opt.label;
        if (params[t.key] === opt.value) b.classList.add('active');
        b.addEventListener('click', () => {
          if (params[t.key] === opt.value) return;
          params[t.key] = opt.value;
          for (const sib of grp.children) {
            const match = sib === b;
            sib.classList.toggle('active', match);
            sib.setAttribute('aria-checked', String(match));
          }
          activateBlobColor(type);
          schedulePersist();
        });
        grp.appendChild(b);
      }
      wrap.appendChild(grp);
      container.appendChild(wrap);
    }
  }

  const controlStack = document.createElement('div');
  controlStack.className = 'control-stack color-stage-controls';
  const sliderStack = document.createElement('div');
  sliderStack.className = 'slider-stack';
  const knobCluster = document.createElement('div');
  knobCluster.className = 'knob-cluster color-rack-slot-knob-grid';
  for (const k of schema.knobs) {
    const knobId = `${idPrefix}-${k.key}`;
    const knobEl = document.createElement('div');
    knobEl.className = 'knob slot-knob'; knobEl.id = knobId;
    knobEl.dataset.knob = '';
    knobEl.dataset.min = String(k.min); knobEl.dataset.max = String(k.max);
    knobEl.dataset.step = String(k.step); knobEl.dataset.default = String(k.default);
    if (k.control) knobEl.dataset.control = k.control;
    knobEl.dataset.tip = k.tip; knobEl.tabIndex = 0;
    knobEl.setAttribute('aria-label', `Blob ${COLOR_LABEL[type] || type} ${k.label}`);
    const labelEl = document.createElement('span'); labelEl.className = 'knob-label'; labelEl.textContent = k.label;
    const valSpan = document.createElement('span'); valSpan.className = 'knob-val'; valSpan.id = `${knobId}-val`;
    valSpan.textContent = String(params[k.key] ?? k.default);
    knobEl.appendChild(labelEl); knobEl.appendChild(valSpan);
    if (k.control === 'slider') sliderStack.appendChild(knobEl);
    else knobCluster.appendChild(knobEl);
    initKnob(knobEl, {
      writeValue:   (v) => { params[k.key] = v; activateBlobColor(type); },
      initialValue: params[k.key] ?? k.default,
    });
  }
  if (sliderStack.childElementCount) controlStack.appendChild(sliderStack);
  if (knobCluster.childElementCount) controlStack.appendChild(knobCluster);
  if (controlStack.childElementCount) container.appendChild(controlStack);
}

function buildBlobChromaControls() {
  const schema = COLOR_PARAM_SCHEMAS.chroma;
  if (!schema) return;
  const params = getBlobColorParams('chroma');

  if (blobChromaDriverGroup) {
    blobChromaDriverGroup.innerHTML = '';
    const driver = schema.toggles.find((t) => t.key === 'driver');
    if (driver) {
      for (const opt of driver.options) {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'toggle-btn'; btn.setAttribute('role', 'radio');
        btn.dataset.driverValue = String(opt.value); btn.dataset.tip = opt.tip;
        const active = params.driver === opt.value;
        btn.classList.toggle('active', active); btn.setAttribute('aria-checked', String(active));
        const span = document.createElement('span'); span.textContent = opt.label; btn.appendChild(span);
        blobChromaDriverGroup.appendChild(btn);
      }
    }
  }

  if (blobChromaStopRow) {
    blobChromaStopRow.innerHTML = '';
    for (const c of schema.colors || []) {
      const label = document.createElement('label'); label.className = 'color-picker-control';
      const input = document.createElement('input'); input.type = 'color';
      input.className = 'color-picker-input';
      input.value = normalizeHexColor(params[c.key], c.default);
      input.dataset.tip = c.tip; input.dataset.stopKey = c.key;
      const span = document.createElement('span'); span.className = 'color-picker-label';
      span.textContent = c.label.toUpperCase();
      label.appendChild(input); label.appendChild(span); blobChromaStopRow.appendChild(label);
    }
  }

  buildBlobColorKnobs(blobChromaKnobPanel, 'chroma', 'blob-chroma-knob');
}

function renderBlobColorPanel() {
  _buildingBlobColorPanel = true;
  try {
    if (blobColorMapsPanel) {
      blobColorMapsPanel.innerHTML = '';
      if (COLOR_MAP_SECTIONS.includes(state.blobColor)) {
        buildBlobColorKnobs(blobColorMapsPanel, state.blobColor, `blob-map-${state.blobColor}`);
      }
    }
    if (blobColorUniquePanel) {
      blobColorUniquePanel.innerHTML = '';
      if (COLOR_UNIQUE_FLAT.includes(state.blobColor)) {
        buildBlobColorKnobs(blobColorUniquePanel, state.blobColor, `blob-unique-${state.blobColor}`);
      }
    }
    if (blobColorProcPanel) {
      if (_blobOkdriftAnimId) { cancelAnimationFrame(_blobOkdriftAnimId); _blobOkdriftAnimId = null; }
      if (state.blobColor === 'okdrift') {
        buildBlobOkdriftPanel(blobColorProcPanel);
      } else {
        blobColorProcPanel.innerHTML = '';
      }
    }
    buildBlobChromaControls();
    updateBlobColorActiveStates();
  } finally {
    _buildingBlobColorPanel = false;
  }
}

blobChromaDriverGroup?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-driver-value]');
  if (!btn) return;
  const params = getBlobColorParams('chroma');
  params.driver = parseInt(btn.dataset.driverValue, 10);
  for (const b of blobChromaDriverGroup.querySelectorAll('[data-driver-value]')) {
    const match = b === btn;
    b.classList.toggle('active', match); b.setAttribute('aria-checked', String(match));
  }
  activateBlobColor('chroma'); schedulePersist();
});

blobChromaStopRow?.addEventListener('input', (e) => {
  const input = e.target.closest('[data-stop-key]');
  if (!input) return;
  const params = getBlobColorParams('chroma');
  params[input.dataset.stopKey] = normalizeHexColor(input.value, '#000000');
  activateBlobColor('chroma'); schedulePersist();
});

blobColorTabGroup?.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (btn) setBlobColorTab(btn.dataset.value);
});

blobColorMapsGrid?.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (btn) setBlobColor(btn.dataset.value);
});

blobColorUniqueGrid?.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (btn) setBlobColor(btn.dataset.value);
});

blobColorProcGrid?.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (btn) setBlobColor(btn.dataset.value);
});

buildBlobColorMapsGrid();
buildBlobColorUniqueGrid();

// ---- Blob structure knob panel ----

function getBlobStructureParams(effectName) {
  if (!state.blobStructureParams) state.blobStructureParams = {};
  if (!state.blobStructureParams[effectName]) {
    state.blobStructureParams[effectName] = makeBlobStructureParams(effectName);
  }
  return state.blobStructureParams[effectName];
}

function onBlobStructureChange(v) {
  refreshBlobStructureCardVisibility(v);
}

function onBlobStructureOutputChange(v) {
  const inkSec = document.getElementById('blob-ink-controls');
  if (inkSec) inkSec.style.display = v === 'ink' ? '' : 'none';
}

function refreshBlobStructureCardVisibility(effectName) {
  if (!blobStructureKnobPanel) return;
  blobStructureKnobPanel.innerHTML = '';
  if (!effectName || effectName === 'none') return;
  const schema = BLOB_STRUCTURE_PARAM_SCHEMAS[effectName];
  if (!schema) return;
  const params = getBlobStructureParams(effectName);

  const section = document.createElement('section');
  section.className = 'control-section';
  section.setAttribute('data-mode-section', 'track');

  if (schema.toggles?.length) {
    for (const t of schema.toggles) {
      const lbl = document.createElement('div');
      lbl.className = 'section-label'; lbl.textContent = t.label;
      section.appendChild(lbl);
      const grp = document.createElement('div');
      grp.className = 'toggle-group';
      for (const opt of t.options) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'toggle-btn'; b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(params[t.key] === opt.value));
        b.dataset.tip = opt.tip; b.textContent = opt.label;
        if (params[t.key] === opt.value) b.classList.add('active');
        b.addEventListener('click', () => {
          if (params[t.key] === opt.value) return;
          params[t.key] = opt.value;
          for (const sib of grp.children) {
            const match = sib === b;
            sib.classList.toggle('active', match);
            sib.setAttribute('aria-checked', String(match));
          }
          schedulePersist();
        });
        grp.appendChild(b);
      }
      section.appendChild(grp);
    }
  }

  if (schema.knobs?.length) {
    const sliderStack = document.createElement('div');
    sliderStack.className = 'slider-stack';
    const knobCluster = document.createElement('div');
    knobCluster.className = 'knob-cluster';
    for (const k of schema.knobs) {
      const knobId = `blob-struct-${effectName}-${k.key}`;
      const knobEl = document.createElement('div');
      knobEl.className = 'knob'; knobEl.id = knobId;
      knobEl.dataset.knob = '';
      knobEl.dataset.min = String(k.min); knobEl.dataset.max = String(k.max);
      knobEl.dataset.step = String(k.step); knobEl.dataset.default = String(k.default);
      if (k.control) knobEl.dataset.control = k.control;
      knobEl.dataset.tip = k.tip; knobEl.tabIndex = 0;
      knobEl.setAttribute('aria-label', `Blob ${effectName} ${k.label}`);
      const labelEl = document.createElement('span'); labelEl.className = 'knob-label'; labelEl.textContent = k.label;
      const valSpan = document.createElement('span'); valSpan.className = 'knob-val'; valSpan.id = `${knobId}-val`;
      valSpan.textContent = String(params[k.key] ?? k.default);
      knobEl.appendChild(labelEl); knobEl.appendChild(valSpan);
      if (k.control === 'slider') sliderStack.appendChild(knobEl);
      else knobCluster.appendChild(knobEl);
      initKnob(knobEl, {
        writeValue:   (v) => { params[k.key] = v; },
        initialValue: params[k.key] ?? k.default,
      });
    }
    const controlStack = document.createElement('div');
    controlStack.className = 'control-stack';
    if (sliderStack.childElementCount) controlStack.appendChild(sliderStack);
    if (knobCluster.childElementCount) controlStack.appendChild(knobCluster);
    if (controlStack.childElementCount) section.appendChild(controlStack);
  }

  blobStructureKnobPanel.appendChild(section);
}

// Blob ink color inputs
const blobInkBlackInput = document.getElementById('blob-ink-black-input');
const blobInkCreamInput = document.getElementById('blob-ink-cream-input');
blobInkBlackInput?.addEventListener('input', () => {
  state.blobInkBlackHex = normalizeHexColor(blobInkBlackInput.value, DEFAULTS.blobInkBlackHex);
  schedulePersist();
});
blobInkCreamInput?.addEventListener('input', () => {
  state.blobInkCreamHex = normalizeHexColor(blobInkCreamInput.value, DEFAULTS.blobInkCreamHex);
  schedulePersist();
});

// Blob grade knobs (blob-color-hue, blob-color-sat) are picked up by the
// batch document.querySelectorAll('[data-knob]').forEach(initKnob) call
// at startup; kebabToCamel maps their ids to state.blobColorHue/blobColorSat.
// No explicit initKnob call needed here.

// ============================================================
// FX RACK — 3-slot rack with its own DOM/picker state. Reuses
// the same .color-rack-* classes; slots live in #fx-rack and the picker in
// #fx-picker-popover. Effects are stateful GL feedback passes (glFx.js)
// that run after the COLOR rack — see resolveActivePipeline / renderFrame.
// Slot mutations that change WHAT an enabled slot renders (swap / clear)
// also reset that slot's feedback buffers so stale trails from the old
// effect never bleed into the new one.
// ============================================================
const fxRackEl   = document.getElementById('fx-rack');
const fxPickerEl = document.getElementById('fx-picker-popover');

const FX_LABEL = {
  rgbdelay: 'RGBDelay',
  drag: 'Drag', lumadrag: 'LumaDrag', tunnel: 'Tunnel', burnin: 'BurnIn', wobbletape: 'WobbleTape',
  flowfield: 'FlowField', bloom: 'Bloom', godrays: 'GodRays', decayflow: 'DecayFlow', feedbackwarp: 'FbWarp',
  crt: 'CRT', crtrolling: 'CRT Roll', scanlines: 'Scanlines', degrade: 'Degrade', noise: 'Noise',
  okband: 'OKBand',
  vignette: 'Vignette', tonemap: 'Tonemap', chromab: 'ChromAb', sharpen: 'Sharpen',
  bokeh: 'Bokeh', filmgrain: 'FilmGrain', ign: 'IGN', autoexp: 'AutoExp',
  fakehdr: 'FakeHDR',
};
const FX_SWATCH_GRADIENTS = {
  rgbdelay:   'linear-gradient(90deg, #080010, #cc0033 28%, #00cc55 52%, #0033cc 76%, #080010)',
  drag:       'linear-gradient(90deg, #080006, #2a0060, #8000ff, #ff44cc, #ffaaff)',
  lumadrag:   'linear-gradient(90deg, #050608 0 30%, #0a2a3a, #28c8e8 78%, #eafcff)',
  tunnel:     'repeating-radial-gradient(circle at 50% 50%, #0a0414 0 6px, #3a1a6e 6px 9px, #b04ad8 9px 10px)',
  burnin:     'linear-gradient(90deg, #020803, #0a3a12, #2fae3e, #b8ff7a, #fffbe8)',
  wobbletape: 'linear-gradient(100deg, #0a0a0c, #3a3a44 30%, #ff4444 44%, #44ddff 48%, #3a3a44 60%, #0a0a0c)',
  flowfield:  'linear-gradient(90deg, #020c14, #0f4a6b, #2fa3c7, #c7f0ff)',
  bloom:      'linear-gradient(90deg, #020310, #142b7f, #5ea9ff, #f8fbff)',
  godrays:    'linear-gradient(90deg, #120800, #6b3200, #d47a00, #ffe066, #fff8cc)',
  decayflow:  'linear-gradient(90deg, #05140e, #1d6b54, #7ad0a0, #f0d67a)',
  feedbackwarp:'linear-gradient(90deg, #090014, #36106b, #0f8ea0, #ff6d3a)',
  crt:        'linear-gradient(90deg, #050505, #21433f, #b24a61, #eee8b8)',
  crtrolling: 'linear-gradient(90deg, #070707, #17423d, #d13f6b, #f1e36b)',
  scanlines:  'repeating-linear-gradient(180deg, #0a0908 0 3px, #7a7a7a 3px 4px)',
  degrade:    'linear-gradient(90deg, #0b0b0b 0 20%, #4a4a4a 20% 40%, #a45d2a 40% 60%, #d8c66f 60% 80%, #f4f0d6 80%)',
  noise:      'linear-gradient(90deg, #111, #777, #222, #bbb, #333)',
  okband:     'linear-gradient(90deg, #3050d0, #8030b0, #c03050, #889018, #187850)',
  vignette:   'radial-gradient(ellipse at 50% 50%, #aabbcc 0%, #557088 25%, #1a2f3a 55%, #000 100%)',
  tonemap:    'linear-gradient(90deg, #030303, #442a10, #c86a18, #f8e870, #fffff8)',
  chromab:    'linear-gradient(90deg, #080010, #cc0030 33%, #1188aa 56%, #0022cc 79%, #080010)',
  sharpen:    'linear-gradient(90deg, #0a0a10, #2a3860, #9ab4d8, #e8f4ff)',
  bokeh:      'radial-gradient(ellipse at 50% 50%, #fff8e0 0%, #ddb040 18%, #cc4400 38%, #080010 65%)',
  filmgrain:  'linear-gradient(90deg, #111, #554433, #887766, #aaa, #777, #333)',
  ign:        'linear-gradient(90deg, #070709 0 12%, #13141a 12% 24%, #070709 24% 36%, #1a1b22 36% 48%, #0b0c10 48% 60%, #141520 60% 72%, #070709 72% 84%, #111219 84%)',
  autoexp:    'linear-gradient(90deg, #020202, #1a2a10, #446038, #aad870, #fdfff8)',
  fakehdr:    'linear-gradient(90deg, #030308, #1a2a5a, #4080c0, #c8e8ff, #fffff0)',
};
const FX_CHIP_TIP = {
  rgbdelay:   'RGB Delay — each colour channel trails at a different rate. Spread diverges R (short) from B (long). Drift orbits the channel samples spatially so moving content splits into separate chromatic ghost halos. Click to swap.',
  drag:       'Directional drag smear. Bright areas streak like comets in a chosen direction, leaving decaying feedback trails. Wobble knob FM-modulates the smear direction with a per-scanline analog wave — turn it up for a wavering, snaking, tape-unstable smear instead of a dead-straight one. Click to swap.',
  lumadrag:   'Luminance drag — a CLEAN directional pull. Only bright content (e.g. FreqMod lines) streaks; dark gaps stay planted, so it drags the lines instead of smearing the whole frame. Gate sets how bright a pixel must be to drag; Wobble FM-modulates the pull direction for a snaking analog feel. Pairs with FreqMod. Click to swap.',
  tunnel:     'Analog video feedback tunnel — camera pointed at its own TV. Echoes recede with zoom, twist, and per-generation hue drift. Click to swap.',
  burnin:     'CRT phosphor burn-in. Bright pixels sear into the screen and cool slowly through amber / green / cyan phosphor as they fade. Click to swap.',
  wobbletape: 'Tape transport gone bad. Horizontal wow/flutter accumulates frame over frame, stretching the image sideways until a tracking pulse snaps it clean. Click to swap.',
  flowfield:  'Flow Field in this slot. Pixels advect along the luma-gradient flow, accumulating feedback trails frame over frame. Click to swap.',
  bloom:      'Neon bloom glow. Bright areas spread with a blue energy halo. Click to swap.',
  godrays:    'Volumetric light shafts. 48-sample radial march from bright regions toward a configurable light center. Click to swap.',
  decayflow:  'Flow field advection trails (single-frame). Pixels drift along gradient directions leaving color residue. Click to swap.',
  feedbackwarp: 'Gradient-driven warp. Image displaced by its own luminance field. Click to swap.',
  crt:        'Full CRT simulation. Phosphor subpixels, bloom, barrel distortion, scanlines. Click to swap.',
  crtrolling: 'CRT rolling distortion. Vertical sine waves with luma modulation and chroma offset. Click to swap.',
  scanlines:  'CRT/VHS scanline artifacts with per-row jitter and RGB fringing. Click to swap.',
  degrade:    'Bit depth reduction and color banding. Macroblocks, dithering, pixelation. Click to swap.',
  noise:      'Adaptive film grain / sensor noise with shadow bias and optional color noise. Click to swap.',
  okband:     'OKLCH luma banding over any COLOR stage output. Re-posterizes into perceptually equidistant hue bands with Bayer dither. Rate knob auto-cycles the palette — ~0.5 syncs to 120 BPM. Click to swap.',
  vignette:   'Lens vignette. Radial darkening from frame center outward. Shape blends circle to rectangle. Strength controls how dark the corners get. Click to swap.',
  tonemap:    'HDR tonemapping. Pre-expose then apply Reinhard / ACES / Hable operator. Contrast and highlight desat finish the grade. Click to swap.',
  chromab:    'Chromatic aberration. R and B channels split outward from center like a real lens. Radial amplifies corners; Spread adds a full R/G/B prismatic tri-split. Click to swap.',
  sharpen:    'Unsharp mask sharpening. Detail = center minus blurred neighbor average, added back at Strength. Clamp prevents ringing halos. Luma-only mode preserves hue. Click to swap.',
  bokeh:      'Ring-sample defocus blur. Bright spots bloom as circular (or hexagonal) bokeh highlights. Chroma adds lens fringe. Click to swap.',
  filmgrain:  'Analogue film grain. Animated per-frame, shadow-biased, spatially clumped. Halation adds a soft glow on bright areas like real film halation. Click to swap.',
  ign:        'Interleaved Gradient Noise — temporally animated with golden-ratio offset for blue-noise-quality grain. Scale controls block size (1–8px). Posterize quantises to N colour levels using IGN as the dither matrix — minimal clumping, no banding. Chroma splits R/G/B channels for colour-fringe grain. Click to swap.',
  autoexp:    'Auto exposure. Samples current frame brightness, exponentially adapts toward Target over time, applies EV correction. Corner-pixel feedback state storage. Click to swap.',
  fakehdr:    'Fake HDR. Two concentric bloom rings at different radii — their difference creates local contrast expansion that mimics HDR look. Power controls the exponent. Click to swap.',
};

// Build the FX picker popover from FX_SECTIONS — adding an FX effect needs
// no index.html edits, same as the COLOR grids.
function buildFxPicker() {
  if (!fxPickerEl) return;
  fxPickerEl.innerHTML = '';
  const none = document.createElement('button');
  none.type = 'button';
  none.className = 'color-pick';
  none.dataset.pickFx = 'none';
  none.dataset.tip = 'Clear this slot. Slot becomes empty and is skipped in the chain.';
  none.textContent = 'None';
  fxPickerEl.appendChild(none);
  for (const name of FX_SECTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-pick';
    btn.dataset.pickFx = name;
    btn.dataset.tip = FX_CHIP_TIP[name] || '';
    btn.textContent = FX_LABEL[name] || name;
    fxPickerEl.appendChild(btn);
  }
}
buildFxPicker();

let _openFxPickerSlotId = null;
const _expandedFxSlots  = new Set();

function swapFxSlots(a, b) {
  if (a < 0 || b < 0 || a >= state.fxRack.length || b >= state.fxRack.length) return;
  [state.fxRack[a], state.fxRack[b]] = [state.fxRack[b], state.fxRack[a]];
  renderFxRack();
  schedulePersist();
}

function renderFxRack() {
  if (!fxRackEl) return;
  fxRackEl.innerHTML = '';
  for (let i = 0; i < state.fxRack.length; i++) {
    const slot     = state.fxRack[i];
    const filled   = slot.type !== 'none';
    const expanded = filled && _expandedFxSlots.has(slot.id);

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
    handle.setAttribute('aria-label', `Reorder FX slot ${i + 1}. Use arrow keys to move.`);
    handle.dataset.tip = 'Drag to reorder this FX stage in the chain. Arrow keys also work when focused.';
    handle.textContent = '≡';
    handle.addEventListener('keydown', (ev) => {
      const idx = parseInt(handle.closest('.color-rack-slot').dataset.slotIdx, 10);
      if (ev.key === 'ArrowUp' && idx > 0) { swapFxSlots(idx, idx - 1); ev.preventDefault(); }
      else if (ev.key === 'ArrowDown' && idx < state.fxRack.length - 1) { swapFxSlots(idx, idx + 1); ev.preventDefault(); }
    });
    row.appendChild(handle);

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'color-rack-chip';
    chip.setAttribute('aria-haspopup', 'true');
    chip.setAttribute('aria-expanded', _openFxPickerSlotId === slot.id ? 'true' : 'false');
    chip.dataset.action = 'open-picker';
    if (filled) {
      chip.dataset.tip = FX_CHIP_TIP[slot.type] || '';
      const swatch = document.createElement('span');
      swatch.className = 'color-rack-chip-swatch';
      swatch.style.background = FX_SWATCH_GRADIENTS[slot.type] || '';
      const label = document.createElement('span');
      label.className = 'color-rack-chip-label';
      label.textContent = FX_LABEL[slot.type] || slot.type;
      chip.appendChild(swatch);
      chip.appendChild(label);
    } else {
      chip.dataset.tip = 'Empty slot. Click to pick an FX effect — it runs after the COLOR rack, reading the previous stage\'s output.';
      const empty = document.createElement('span');
      empty.className = 'color-rack-chip-empty';
      empty.textContent = '+ add fx';
      chip.appendChild(empty);
    }
    row.appendChild(chip);

    if (filled) {
      const chev = document.createElement('button');
      chev.type = 'button';
      chev.className = 'color-rack-chevron';
      chev.dataset.action = 'expand';
      chev.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      chev.dataset.tip = expanded ? 'Hide this slot\'s controls.' : 'Show this slot\'s controls.';
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
      const panel = renderFxSlotPanel(slot);
      el.appendChild(panel);
    }

    fxRackEl.appendChild(el);
  }
}

function renderFxSlotPanel(slot) {
  const schema = FX_PARAM_SCHEMAS[slot.type];
  const panel = document.createElement('div');
  panel.className = 'color-rack-slot-panel';
  if (!schema) return panel;

  const phead = document.createElement('div');
  phead.className = 'color-rack-slot-panel-head';
  const ptitle = document.createElement('span');
  ptitle.className = 'color-rack-slot-panel-title';
  ptitle.textContent = `${FX_LABEL[slot.type] || slot.type} controls`;
  phead.appendChild(ptitle);
  const presetBtn = document.createElement('button');
  presetBtn.type = 'button';
  presetBtn.className = 'color-rack-slot-reset';
  presetBtn.dataset.action = 'reset-params';
  presetBtn.dataset.tip = 'Reset only THIS slot\'s controls to factory.';
  presetBtn.textContent = '⟲';
  phead.appendChild(presetBtn);
  panel.appendChild(phead);

  const controlStack = document.createElement('div');
  controlStack.className = 'control-stack color-rack-slot-controls';
  const sliderStack = document.createElement('div');
  sliderStack.className = 'slider-stack';
  const knobCluster = document.createElement('div');
  knobCluster.className = 'knob-cluster color-rack-slot-knob-grid';
  for (const k of schema.knobs) {
    const knobId = `fx-${slot.id}-${k.key}`;
    const valId  = `${knobId}-val`;
    const knobEl = document.createElement('div');
    knobEl.className = 'knob slot-knob';
    knobEl.id = knobId;
    knobEl.dataset.knob = '';
    knobEl.dataset.min     = String(k.min);
    knobEl.dataset.max     = String(k.max);
    knobEl.dataset.step    = String(k.step);
    knobEl.dataset.default = String(k.default);
    if (k.control) knobEl.dataset.control = k.control;
    knobEl.dataset.tip     = k.tip;
    knobEl.tabIndex = 0;
    knobEl.setAttribute('aria-label', `${FX_LABEL[slot.type]} ${k.label}`);
    const labelEl = document.createElement('span');
    labelEl.className = 'knob-label';
    labelEl.textContent = k.label;
    const valSpan = document.createElement('span');
    valSpan.className = 'knob-val';
    valSpan.id = valId;
    valSpan.textContent = String(slot.params[k.key] ?? k.default);
    knobEl.appendChild(labelEl);
    knobEl.appendChild(valSpan);
    if (k.control === 'slider') sliderStack.appendChild(knobEl);
    else                        knobCluster.appendChild(knobEl);

    initKnob(knobEl, {
      writeValue:   (v) => { slot.params[k.key] = v; },
      initialValue: slot.params[k.key] ?? k.default,
    });
  }
  if (sliderStack.childElementCount) controlStack.appendChild(sliderStack);
  if (knobCluster.childElementCount) controlStack.appendChild(knobCluster);
  if (controlStack.childElementCount) panel.appendChild(controlStack);

  return panel;
}

// ---- Slot mutation helpers (parallel to colorRack) ----
function setFxSlotType(slotId, type) {
  const slot = state.fxRack.find((s) => s.id === slotId);
  if (!slot) return;
  if (type === 'none') {
    slot.type = 'none';
    slot.enabled = false;
    slot.params = {};
  } else {
    slot.type = type;
    slot.enabled = true;
    slot.params = makeFxFactoryParams(type);
  }
  // The slot's accumulated trails belong to the old effect — restart from
  // black so the new pick doesn't inherit them.
  resetFxFeedback(slotId);
  if (type !== 'none') _expandedFxSlots.add(slotId);
  else _expandedFxSlots.delete(slotId);
  renderFxRack();
  schedulePersist();
}
function toggleFxSlot(slotId) {
  const slot = state.fxRack.find((s) => s.id === slotId);
  if (!slot || slot.type === 'none') return;
  slot.enabled = !slot.enabled;
  // Disable freezes rendering but the buffers hold the last trails; reset
  // so re-enabling starts clean instead of ghosting frames from minutes ago.
  if (!slot.enabled) resetFxFeedback(slotId);
  renderFxRack();
  schedulePersist();
}
function clearFxSlot(slotId) {
  const slot = state.fxRack.find((s) => s.id === slotId);
  if (!slot) return;
  slot.type = 'none';
  slot.enabled = false;
  slot.params = {};
  resetFxFeedback(slotId);
  _expandedFxSlots.delete(slotId);
  renderFxRack();
  schedulePersist();
}
function resetFxSlotParams(slotId) {
  const slot = state.fxRack.find((s) => s.id === slotId);
  if (!slot || slot.type === 'none') return;
  slot.params = makeFxFactoryParams(slot.type);
  renderFxRack();
  schedulePersist();
}
function reorderFxSlot(srcIdx, dstIdx) {
  if (srcIdx === dstIdx) return;
  const arr = state.fxRack.slice();
  const [moved] = arr.splice(srcIdx, 1);
  arr.splice(dstIdx, 0, moved);
  state.fxRack = arr;
  renderFxRack();
  schedulePersist();
}

let _fxPickerFocusPrior = null;
function openFxPicker(slotEl) {
  const slotId = slotEl.dataset.slotId;
  _openFxPickerSlotId = slotId;
  _fxPickerFocusPrior = document.activeElement;
  const r = slotEl.getBoundingClientRect();
  fxPickerEl.classList.remove('hidden');
  const pr = fxPickerEl.getBoundingClientRect();
  let top  = r.bottom + 4;
  let left = r.right - pr.width;
  if (top + pr.height > window.innerHeight - 8) top = r.top - pr.height - 4;
  if (left < 8) left = 8;
  fxPickerEl.style.top  = `${top}px`;
  fxPickerEl.style.left = `${left}px`;
  const chip = slotEl.querySelector('.color-rack-chip');
  if (chip) chip.setAttribute('aria-expanded', 'true');
  fxPickerEl.querySelector('button')?.focus();
}
function closeFxPicker() {
  if (!_openFxPickerSlotId) return;
  _openFxPickerSlotId = null;
  fxPickerEl.classList.add('hidden');
  for (const chip of fxRackEl.querySelectorAll('.color-rack-chip')) {
    chip.setAttribute('aria-expanded', 'false');
  }
  _fxPickerFocusPrior?.focus();
  _fxPickerFocusPrior = null;
}

fxRackEl?.addEventListener('click', (e) => {
  const slotEl = e.target.closest('.color-rack-slot');
  if (!slotEl) return;
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  const slotId = slotEl.dataset.slotId;
  if (action === 'open-picker') {
    if (_openFxPickerSlotId === slotId) { closeFxPicker(); return; }
    openFxPicker(slotEl);
  } else if (action === 'toggle') {
    toggleFxSlot(slotId);
  } else if (action === 'remove') {
    clearFxSlot(slotId);
  } else if (action === 'expand') {
    if (_expandedFxSlots.has(slotId)) _expandedFxSlots.delete(slotId);
    else                              _expandedFxSlots.add(slotId);
    renderFxRack();
  } else if (action === 'reset-params') {
    resetFxSlotParams(slotId);
  }
});

fxPickerEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-pick-fx]');
  if (!btn || !_openFxPickerSlotId) return;
  setFxSlotType(_openFxPickerSlotId, btn.dataset.pickFx);
  closeFxPicker();
});

document.addEventListener('mousedown', (e) => {
  if (!_openFxPickerSlotId) return;
  if (fxPickerEl.contains(e.target)) return;
  if (e.target.closest(`#fx-rack .color-rack-slot[data-slot-id="${_openFxPickerSlotId}"]`)) return;
  closeFxPicker();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _openFxPickerSlotId) closeFxPicker();
});

// Independent drag-state for the fx rack so a drag here doesn't confuse
// the colorRack / trackFx drag-state and vice versa.
let _fxDragSrcIdx = null;
fxRackEl?.addEventListener('dragstart', (e) => {
  const slotEl = e.target.closest('.color-rack-slot');
  if (!slotEl) { e.preventDefault(); return; }
  _fxDragSrcIdx = parseInt(slotEl.dataset.slotIdx, 10);
  slotEl.classList.add('dragging');
  e.dataTransfer.setData('text/plain', String(_fxDragSrcIdx));
  e.dataTransfer.effectAllowed = 'move';
});
fxRackEl?.addEventListener('dragend', () => {
  _fxDragSrcIdx = null;
  for (const el of fxRackEl.querySelectorAll('.color-rack-slot')) {
    el.classList.remove('dragging', 'drop-target');
  }
});
fxRackEl?.addEventListener('dragover', (e) => {
  if (_fxDragSrcIdx === null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const slotEl = e.target.closest('.color-rack-slot');
  for (const el of fxRackEl.querySelectorAll('.color-rack-slot')) {
    el.classList.toggle('drop-target', el === slotEl && el !== e.currentTarget.querySelector('.dragging'));
  }
});
fxRackEl?.addEventListener('drop', (e) => {
  if (_fxDragSrcIdx === null) return;
  e.preventDefault();
  const slotEl = e.target.closest('.color-rack-slot');
  if (!slotEl) return;
  const dstIdx = parseInt(slotEl.dataset.slotIdx, 10);
  reorderFxSlot(_fxDragSrcIdx, dstIdx);
  _fxDragSrcIdx = null;
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
      chev.dataset.tip = expanded ? 'Hide this slot\'s controls.' : 'Show this slot\'s controls.';
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
  ptitle.textContent = `${TRACK_FX_LABEL[slot.type] || slot.type} controls`;
  phead.appendChild(ptitle);
  const presetBtn = document.createElement('button');
  presetBtn.type = 'button';
  presetBtn.className = 'color-rack-slot-reset';
  presetBtn.dataset.action = 'reset-params';
  presetBtn.dataset.tip = 'Reset only THIS slot\'s controls to factory.';
  presetBtn.textContent = '⟲';
  phead.appendChild(presetBtn);
  panel.appendChild(phead);

  const controlStack = document.createElement('div');
  controlStack.className = 'control-stack color-rack-slot-controls';
  const sliderStack = document.createElement('div');
  sliderStack.className = 'slider-stack';
  const knobCluster = document.createElement('div');
  knobCluster.className = 'knob-cluster color-rack-slot-knob-grid';
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
    if (k.control) knobEl.dataset.control = k.control;
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
    if (k.control === 'slider') sliderStack.appendChild(knobEl);
    else                        knobCluster.appendChild(knobEl);

    initKnob(knobEl, {
      writeValue:   (v) => { slot.params[k.key] = v; },
      initialValue: slot.params[k.key] ?? k.default,
    });
  }
  if (sliderStack.childElementCount) controlStack.appendChild(sliderStack);
  if (knobCluster.childElementCount) controlStack.appendChild(knobCluster);
  if (controlStack.childElementCount) panel.appendChild(controlStack);

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

let _trackFxPickerFocusPrior = null;
function openTrackFxPicker(slotEl) {
  const slotId = slotEl.dataset.slotId;
  _openTrackFxPickerSlotId = slotId;
  _trackFxPickerFocusPrior = document.activeElement;
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
  trackFxPickerEl.querySelector('button')?.focus();
}
function closeTrackFxPicker() {
  if (!_openTrackFxPickerSlotId) return;
  _openTrackFxPickerSlotId = null;
  trackFxPickerEl.classList.add('hidden');
  for (const chip of trackFxRackEl.querySelectorAll('.color-rack-chip')) {
    chip.setAttribute('aria-expanded', 'false');
  }
  _trackFxPickerFocusPrior?.focus();
  _trackFxPickerFocusPrior = null;
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

// ============================================================
// BLOB FX RACK — parallel to FX rack but stateless effects only.
// Operates on state.blobFxRack; uses BLOB_FX_SECTIONS for the picker.
// ============================================================

function buildBlobFxPicker() {
  if (!blobFxPickerEl) return;
  blobFxPickerEl.innerHTML = '';
  const none = document.createElement('button');
  none.type = 'button';
  none.className = 'color-pick';
  none.dataset.pickBlobFx = 'none';
  none.dataset.tip = 'Clear this slot. Slot becomes empty and is skipped in the blob chain.';
  none.textContent = 'None';
  blobFxPickerEl.appendChild(none);
  for (const name of BLOB_FX_SECTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-pick';
    btn.dataset.pickBlobFx = name;
    btn.dataset.tip = FX_CHIP_TIP[name] || '';
    btn.textContent = FX_LABEL[name] || name;
    blobFxPickerEl.appendChild(btn);
  }
}
buildBlobFxPicker();

let _openBlobFxPickerSlotId = null;
const _expandedBlobFxSlots  = new Set();

function renderBlobFxRack() {
  if (!blobFxRackEl) return;
  blobFxRackEl.innerHTML = '';
  for (let i = 0; i < state.blobFxRack.length; i++) {
    const slot     = state.blobFxRack[i];
    const filled   = slot.type !== 'none';
    const expanded = filled && _expandedBlobFxSlots.has(slot.id);

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
    handle.setAttribute('aria-label', `Reorder blob FX slot ${i + 1}.`);
    handle.dataset.tip = 'Drag to reorder this blob FX stage.';
    handle.textContent = '≡';
    row.appendChild(handle);

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'color-rack-chip';
    chip.setAttribute('aria-haspopup', 'true');
    chip.setAttribute('aria-expanded', _openBlobFxPickerSlotId === slot.id ? 'true' : 'false');
    chip.dataset.action = 'open-picker';
    if (filled) {
      chip.dataset.tip = FX_CHIP_TIP[slot.type] || '';
      const swatch = document.createElement('span');
      swatch.className = 'color-rack-chip-swatch';
      swatch.style.background = FX_SWATCH_GRADIENTS[slot.type] || '';
      const label = document.createElement('span');
      label.className = 'color-rack-chip-label';
      label.textContent = FX_LABEL[slot.type] || slot.type;
      chip.appendChild(swatch);
      chip.appendChild(label);
    } else {
      chip.dataset.tip = 'Empty slot. Click to add a blob FX effect.';
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
      chev.dataset.tip = expanded ? 'Hide controls.' : 'Show controls.';
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
      const panel = renderBlobFxSlotPanel(slot);
      el.appendChild(panel);
    }

    blobFxRackEl.appendChild(el);
  }
}

function renderBlobFxSlotPanel(slot) {
  const schema = FX_PARAM_SCHEMAS[slot.type];
  const panel = document.createElement('div');
  panel.className = 'color-rack-slot-panel';
  if (!schema) return panel;

  const phead = document.createElement('div');
  phead.className = 'color-rack-slot-panel-head';
  const ptitle = document.createElement('span');
  ptitle.className = 'color-rack-slot-panel-title';
  ptitle.textContent = `${FX_LABEL[slot.type] || slot.type} controls`;
  phead.appendChild(ptitle);
  const presetBtn = document.createElement('button');
  presetBtn.type = 'button';
  presetBtn.className = 'color-rack-slot-reset';
  presetBtn.dataset.action = 'reset-params';
  presetBtn.dataset.tip = 'Reset only THIS slot\'s controls to factory.';
  presetBtn.textContent = '⟲';
  phead.appendChild(presetBtn);
  panel.appendChild(phead);

  const controlStack = document.createElement('div');
  controlStack.className = 'control-stack color-rack-slot-controls';
  const sliderStack = document.createElement('div');
  sliderStack.className = 'slider-stack';
  const knobCluster = document.createElement('div');
  knobCluster.className = 'knob-cluster color-rack-slot-knob-grid';
  for (const k of schema.knobs) {
    const knobId = `blobfx-${slot.id}-${k.key}`;
    const valId  = `${knobId}-val`;
    const knobEl = document.createElement('div');
    knobEl.className = 'knob slot-knob';
    knobEl.id = knobId;
    knobEl.dataset.knob = '';
    knobEl.dataset.min     = String(k.min);
    knobEl.dataset.max     = String(k.max);
    knobEl.dataset.step    = String(k.step);
    knobEl.dataset.default = String(k.default);
    if (k.control) knobEl.dataset.control = k.control;
    knobEl.dataset.tip     = k.tip;
    knobEl.tabIndex = 0;
    knobEl.setAttribute('aria-label', `Blob ${FX_LABEL[slot.type]} ${k.label}`);
    const labelEl = document.createElement('span');
    labelEl.className = 'knob-label';
    labelEl.textContent = k.label;
    const valSpan = document.createElement('span');
    valSpan.className = 'knob-val';
    valSpan.id = valId;
    valSpan.textContent = String(slot.params[k.key] ?? k.default);
    knobEl.appendChild(labelEl);
    knobEl.appendChild(valSpan);
    if (k.control === 'slider') sliderStack.appendChild(knobEl);
    else                        knobCluster.appendChild(knobEl);
    initKnob(knobEl, {
      writeValue:   (v) => { slot.params[k.key] = v; },
      initialValue: slot.params[k.key] ?? k.default,
    });
  }
  if (sliderStack.childElementCount) controlStack.appendChild(sliderStack);
  if (knobCluster.childElementCount) controlStack.appendChild(knobCluster);
  if (controlStack.childElementCount) panel.appendChild(controlStack);

  return panel;
}

function setBlobFxSlotType(slotId, type) {
  const slot = state.blobFxRack.find((s) => s.id === slotId);
  if (!slot) return;
  resetBlobFeedback(slotId);
  if (type === 'none') {
    slot.type = 'none';
    slot.enabled = false;
    slot.params = {};
  } else {
    slot.type = type;
    slot.enabled = true;
    slot.params = makeFxFactoryParams(type);
  }
  _expandedBlobFxSlots.delete(slotId);
  renderBlobFxRack();
  schedulePersist();
}

function toggleBlobFxSlot(slotId) {
  const slot = state.blobFxRack.find((s) => s.id === slotId);
  if (!slot || slot.type === 'none') return;
  slot.enabled = !slot.enabled;
  renderBlobFxRack();
  schedulePersist();
}

function clearBlobFxSlot(slotId) {
  const slot = state.blobFxRack.find((s) => s.id === slotId);
  if (!slot) return;
  resetBlobFeedback(slotId);
  slot.type = 'none';
  slot.enabled = false;
  slot.params = {};
  _expandedBlobFxSlots.delete(slotId);
  renderBlobFxRack();
  schedulePersist();
}

function resetBlobFxSlotParams(slotId) {
  const slot = state.blobFxRack.find((s) => s.id === slotId);
  if (!slot || slot.type === 'none') return;
  slot.params = makeFxFactoryParams(slot.type);
  renderBlobFxRack();
  schedulePersist();
}

function reorderBlobFxSlot(srcIdx, dstIdx) {
  if (srcIdx === dstIdx) return;
  const arr = state.blobFxRack.slice();
  const [moved] = arr.splice(srcIdx, 1);
  arr.splice(dstIdx, 0, moved);
  state.blobFxRack = arr;
  renderBlobFxRack();
  schedulePersist();
}

let _blobFxPickerFocusPrior = null;
function openBlobFxPicker(slotEl) {
  const slotId = slotEl.dataset.slotId;
  _openBlobFxPickerSlotId = slotId;
  _blobFxPickerFocusPrior = document.activeElement;
  const r = slotEl.getBoundingClientRect();
  blobFxPickerEl.classList.remove('hidden');
  const pr = blobFxPickerEl.getBoundingClientRect();
  let top  = r.bottom + 4;
  let left = r.right - pr.width;
  if (top + pr.height > window.innerHeight - 8) top = r.top - pr.height - 4;
  if (left < 8) left = 8;
  blobFxPickerEl.style.top  = `${top}px`;
  blobFxPickerEl.style.left = `${left}px`;
  const chip = slotEl.querySelector('.color-rack-chip');
  if (chip) chip.setAttribute('aria-expanded', 'true');
  blobFxPickerEl.querySelector('button')?.focus();
}

function closeBlobFxPicker() {
  if (!_openBlobFxPickerSlotId) return;
  _openBlobFxPickerSlotId = null;
  blobFxPickerEl.classList.add('hidden');
  if (blobFxRackEl) {
    for (const chip of blobFxRackEl.querySelectorAll('.color-rack-chip')) {
      chip.setAttribute('aria-expanded', 'false');
    }
  }
  _blobFxPickerFocusPrior?.focus();
  _blobFxPickerFocusPrior = null;
}

blobFxRackEl?.addEventListener('click', (e) => {
  const slotEl = e.target.closest('.color-rack-slot');
  if (!slotEl) return;
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  const slotId = slotEl.dataset.slotId;
  if (action === 'open-picker') {
    if (_openBlobFxPickerSlotId === slotId) { closeBlobFxPicker(); return; }
    openBlobFxPicker(slotEl);
  } else if (action === 'toggle') {
    toggleBlobFxSlot(slotId);
  } else if (action === 'remove') {
    clearBlobFxSlot(slotId);
  } else if (action === 'expand') {
    if (_expandedBlobFxSlots.has(slotId)) _expandedBlobFxSlots.delete(slotId);
    else                                  _expandedBlobFxSlots.add(slotId);
    renderBlobFxRack();
  } else if (action === 'reset-params') {
    resetBlobFxSlotParams(slotId);
  }
});

blobFxPickerEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-pick-blob-fx]');
  if (!btn || !_openBlobFxPickerSlotId) return;
  setBlobFxSlotType(_openBlobFxPickerSlotId, btn.dataset.pickBlobFx);
  closeBlobFxPicker();
});

document.addEventListener('mousedown', (e) => {
  if (!_openBlobFxPickerSlotId) return;
  if (blobFxPickerEl && blobFxPickerEl.contains(e.target)) return;
  if (e.target.closest(`#blob-fx-rack .color-rack-slot[data-slot-id="${_openBlobFxPickerSlotId}"]`)) return;
  closeBlobFxPicker();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _openBlobFxPickerSlotId) closeBlobFxPicker();
});

let _blobFxDragSrcIdx = null;
blobFxRackEl?.addEventListener('dragstart', (e) => {
  const slotEl = e.target.closest('.color-rack-slot');
  if (!slotEl) { e.preventDefault(); return; }
  _blobFxDragSrcIdx = parseInt(slotEl.dataset.slotIdx, 10);
  slotEl.classList.add('dragging');
  e.dataTransfer.setData('text/plain', String(_blobFxDragSrcIdx));
  e.dataTransfer.effectAllowed = 'move';
});
blobFxRackEl?.addEventListener('dragend', () => {
  _blobFxDragSrcIdx = null;
  for (const el of blobFxRackEl.querySelectorAll('.color-rack-slot')) {
    el.classList.remove('dragging', 'drop-target');
  }
});
blobFxRackEl?.addEventListener('dragover', (e) => {
  if (_blobFxDragSrcIdx === null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const slotEl = e.target.closest('.color-rack-slot');
  for (const el of blobFxRackEl.querySelectorAll('.color-rack-slot')) {
    el.classList.toggle('drop-target', el === slotEl && el !== e.currentTarget.querySelector('.dragging'));
  }
});
blobFxRackEl?.addEventListener('drop', (e) => {
  if (_blobFxDragSrcIdx === null) return;
  e.preventDefault();
  const slotEl = e.target.closest('.color-rack-slot');
  if (!slotEl) return;
  const dstIdx = parseInt(slotEl.dataset.slotIdx, 10);
  reorderBlobFxSlot(_blobFxDragSrcIdx, dstIdx);
  _blobFxDragSrcIdx = null;
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
    video.playbackRate = 1;
    document.body.setAttribute('data-mode', state.mode);
    // COLOR stage + FX/track racks are custom widgets (not toggle groups),
    // so they have to render themselves rather than ride the TOGGLE_CONFIG
    // loop. All run inside the _applyingState guard so any future side
    // effects on render don't double-fire during state restore. The COLOR
    // tab is derived from the loaded selection so the active effect's tab
    // is the one showing.
    setColorTab(colorTabForSelection(state.color));
    renderColorPanel();
    renderFxRack();
    renderTrackFxRack();
    // Blob synth state
    setBlobColor(state.blobColor || 'none');
    refreshBlobStructureCardVisibility(state.blobStructure || 'none');
    onBlobStructureOutputChange(state.blobStructureOutputMode || 'mono');
    renderBlobFxRack();
    renderBlobColorPanel();
  } finally {
    _applyingState = false;
  }
  // After loaded values are in place, recompute card visibility once with
  // the final state (the per-handler refreshes during the loop reflect
  // intermediate state).
  refreshEffectCardVisibility();
  refreshColorKeyControls(state.trackChannel);
  if (colorKeyInput) colorKeyInput.value = state.colorKeyHex;
  if (inkLowInput) inkLowInput.value = normalizeHexColor(state.inkBlackHex, DEFAULTS.inkBlackHex);
  if (inkHighInput) inkHighInput.value = normalizeHexColor(state.inkCreamHex, DEFAULTS.inkCreamHex);
  if (blobInkBlackInput) blobInkBlackInput.value = normalizeHexColor(state.blobInkBlackHex, DEFAULTS.blobInkBlackHex);
  if (blobInkCreamInput) blobInkCreamInput.value = normalizeHexColor(state.blobInkCreamHex, DEFAULTS.blobInkCreamHex);
  renderTimelinePanel();
}

// ---- Persistence ----
let persistTimer = 0;
function schedulePersist() {
  syncSelectedSegmentFromState();
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
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      for (const key of LEGACY_STORAGE_KEYS) {
        raw = localStorage.getItem(key);
        if (raw) break;
      }
    }
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
    // v8 migration: collapse a legacy colorRack (v5-v7) into the single
    // color stage. First enabled slot wins; its params seed colorParams.
    // Pre-P2b saves whose `color` came from the `filter` migration above
    // pass straight through — `color` is the real field again.
    Object.assign(parsed, migrateColorRack(parsed));
    delete parsed.colorRack;
    if (parsed.color !== undefined && parsed.color !== 'none' && !COLOR_SECTIONS.includes(parsed.color)) {
      delete parsed.color;
    }
    parsed.colorParams = sanitizeColorParams(parsed.colorParams);
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
    if (parsed.trackFxRack) parsed.trackFxRack = sanitizeTrackFxRack(parsed.trackFxRack);
    // FX rack — same defensive migration. v6-and-earlier saves have no
    // fxRack at all; state init's fresh makeFxRack() stands in that case.
    if (parsed.fxRack) parsed.fxRack = sanitizeFxRack(parsed.fxRack);
    if (parsed.timelineSegments) parsed.timelineSegments = sanitizeTimelineSegments(parsed.timelineSegments);
    for (const k of Object.keys(DEFAULTS)) if (k in parsed) state[k] = parsed[k];
    // Detection backend lives outside DEFAULTS (global runtime, not look-scoped),
    // so restore it explicitly with validation.
    if (parsed.trackBackend === 'blob' || parsed.trackBackend === 'object') state.trackBackend = parsed.trackBackend;
    if (parsed.mpDelegate === 'GPU' || parsed.mpDelegate === 'CPU') state.mpDelegate = parsed.mpDelegate;
    if (parsed.colorParams)  state.colorParams  = parsed.colorParams;
    if (parsed.fxRack)       state.fxRack       = parsed.fxRack;
    if (parsed.trackFxRack)  state.trackFxRack  = parsed.trackFxRack;
    if (Array.isArray(parsed.timelineSegments)) state.timelineSegments = parsed.timelineSegments;
    state.selectedTimelineSegmentId = parsed.selectedTimelineSegmentId || null;
    if (!state.timelineSegments.some((s) => s.id === state.selectedTimelineSegmentId)) {
      state.selectedTimelineSegmentId = null;
    }
  } catch { /* ignore */ }
}

// ---- Reset (two-stage confirm) ----
let resetConfirmTimer = 0;
function performFullReset() {
  for (const k of Object.keys(DEFAULTS)) state[k] = DEFAULTS[k];
  // colorParams + fxRack + trackFxRack live outside DEFAULTS (object-valued
  // / per-instance ids); reset explicitly so each session starts factory.
  state.colorParams = {};
  state.fxRack      = makeFxRack();
  state.trackFxRack = makeTrackFxRack();
  resetFxFeedback();
  state.timelineSegments = [];
  state.selectedTimelineSegmentId = null;
  applyStateToUI();
  renderTimelinePanel();
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
async function takeSnapshot() {
  if (!state.hasSource) {
    showToast('Load a video or open the camera first', 'error');
    return;
  }
  if (!(await requireExportAccess('snapshot'))) return;
  const exportDims = getExportDimensions();
  if (exportDims) {
    canvas.width  = exportDims.w;
    canvas.height = exportDims.h;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  canvas.toBlob((blob) => {
    if (exportDims) resizeCanvas();
    if (!blob) { showToast('Snapshot failed', 'error'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const qual = exportResKey === 'display' ? 'disp' : exportResKey;
    a.href = url;
    a.download = `lumisynth-${qual}-${ts}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Frame saved', 'ok', 2000);
  }, 'image/png');
}
btnSnapshot.addEventListener('click', () => { takeSnapshot(); });

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
  { mime: 'video/mp4;codecs=avc1.640034', ext: 'mp4' },  // H.264 High Profile 5.2 (best quality)
  { mime: 'video/mp4;codecs=avc1.640032', ext: 'mp4' },  // H.264 High Profile 5.0
  { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },  // H.264 Baseline fallback
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

let _recordTickLast = 0;
function tickRecordLabel(now) {
  if (!_recorder) return;
  if (now - _recordTickLast >= 500) {
    btnRecordLbl.textContent = formatRecordTime(now - _recordStartT);
    _recordTickLast = now;
  }
  _recordTickRaf = requestAnimationFrame(tickRecordLabel);
}

async function startRecording() {
  if (!state.hasSource) {
    showToast('Load a video or open the camera first', 'error');
    return;
  }
  if (!(await requireExportAccess('recording'))) return;
  if (_recorder) return; // guard double-clicks
  _recordFormat = pickRecorderFormat();
  if (!_recordFormat) {
    showToast('Recording not supported in this browser', 'error');
    return;
  }
  const exportDims = getExportDimensions();
  if (exportDims) {
    canvas.width  = exportDims.w;
    canvas.height = exportDims.h;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  // captureStream pulls frames from the canvas at the rate we draw to
  // it (capped at FPS_CAP). The 60 here is a hint to the browser, not
  // a guarantee — actual rate matches our render loop.
  let stream;
  try {
    stream = canvas.captureStream(FPS_CAP);
  } catch (err) {
    if (exportDims) resizeCanvas();
    showToast(`Couldn't capture canvas: ${err.message || err}`, 'error');
    return;
  }
  const bitsPerSecond = { '720p': 25_000_000, '1080p': 80_000_000, '4k': 200_000_000 }[exportResKey] ?? 25_000_000;
  try {
    _recorder = new MediaRecorder(stream, { mimeType: _recordFormat.mime, videoBitsPerSecond: bitsPerSecond });
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
  renderTimelinePanel();
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
  resizeCanvas();

  if (!chunks.length) {
    showToast('Recording produced no data', 'error');
    return;
  }
  const blob = new Blob(chunks, { type: fmt.mime.split(';')[0] });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const ts   = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const qual = exportResKey === 'display' ? 'disp' : exportResKey;
  a.href = url;
  a.download = `lumisynth-${qual}-${ts}.${fmt.ext}`;
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
  renderTimelinePanel();
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
const INTRO_DISMISSED_KEY = 'lumisynth-intro-dismissed';

function introDismissed() {
  try { return localStorage.getItem(INTRO_DISMISSED_KEY) === 'true'; }
  catch (_) { return false; }
}

let _introFocusPrior = null;
function dismissIntro() {
  if (!introOverlay) return;
  introOverlay.classList.add('hidden');
  releaseTrap(introOverlay);
  _introFocusPrior?.focus();
  _introFocusPrior = null;
  try { localStorage.setItem(INTRO_DISMISSED_KEY, 'true'); } catch (_) {}
}

function showIntroIfNeeded() {
  if (!introOverlay || introDismissed()) return;
  _introFocusPrior = document.activeElement;
  introOverlay.classList.remove('hidden');
  if (introStart) introStart.focus();
  trapFocus(introOverlay);
}

introClose?.addEventListener('click', dismissIntro);
introStart?.addEventListener('click', dismissIntro);
introOverlay?.addEventListener('click', (e) => { if (e.target === introOverlay) dismissIntro(); });

let _helpFocusPrior = null;
function openHelp() {
  _helpFocusPrior = document.activeElement;
  helpOverlay.classList.remove('hidden');
  helpClose.focus();
  trapFocus(helpOverlay);
}
function closeHelp() {
  helpOverlay.classList.add('hidden');
  releaseTrap(helpOverlay);
  _helpFocusPrior?.focus();
  _helpFocusPrior = null;
}
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
  // Ignore when typing in input/textarea
  const tag = (document.activeElement?.tagName || '').toLowerCase();
  const activeParamControl = document.activeElement?.dataset?.knob !== undefined
    || document.activeElement?.classList?.contains('knob');
  if ((tag === 'input' && !activeParamControl) || tag === 'textarea') return;

  // Space: play/pause (unmodified, no AT collision)
  if (e.key === ' ' && tag !== 'button' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (video.paused) { video.play().catch(() => {}); } else { video.pause(); }
    return;
  }
  // Escape: close overlays (unmodified)
  if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (introOverlay && !introOverlay.classList.contains('hidden')) { dismissIntro(); e.preventDefault(); return; }
    if (!helpOverlay.classList.contains('hidden')) { closeHelp(); e.preventDefault(); return; }
  }

  // Ctrl/Cmd modifier shortcuts — safe from AT browse-mode key conflicts
  if (e.ctrlKey || e.metaKey) {
    switch (e.key.toLowerCase()) {
      case '/':
        openHelp(); e.preventDefault(); return;
      case 's':
        if (!activeParamControl) { takeSnapshot(); e.preventDefault(); }
        return;
      case 'f':
        btnFps.click(); e.preventDefault(); return;
      case 'r':
        if (btnRecord && !btnRecord.disabled && btnRecord.style.display !== 'none') {
          btnRecord.click(); e.preventDefault();
        }
        return;
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
    renderTimelinePanel();
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
  if (state.sourceKind === 'shader') return getShaderSourceCanvas();
  return state.sourceKind === 'image' ? imageEl : video;
}
function activeSourceWidth() {
  if (state.sourceKind === 'shader') return getShaderSourceCanvas()?.width || 0;
  return state.sourceKind === 'image'
    ? (imageEl.naturalWidth || 0)
    : (video.videoWidth || 0);
}
function activeSourceHeight() {
  if (state.sourceKind === 'shader') return getShaderSourceCanvas()?.height || 0;
  return state.sourceKind === 'image'
    ? (imageEl.naturalHeight || 0)
    : (video.videoHeight || 0);
}
function activeSourceReady() {
  if (state.sourceKind === 'shader') return !!getShaderSourceCanvas()?.width;
  if (state.sourceKind === 'image') {
    return imageEl.complete && imageEl.naturalWidth > 0;
  }
  return video.readyState >= 2 && video.videoWidth > 0;
}
// For images we treat the source as "always paused" — there's no temporal
// dimension. The detection block guards on this so motion-mode doesn't
// thrash on a constant frame, and so cachedBlobs stay stable on stills.
// Shader sources are the opposite: always animating, never paused.
function activeSourcePaused() {
  if (state.sourceKind === 'shader') return false;
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
  state.timelineSegments = [];
  state.selectedTimelineSegmentId = null;
  state.sourceKind = 'video';
  setHasSource(true, label || 'Video');
  renderTimelinePanel();
  video.addEventListener('loadedmetadata', () => {
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    const seg = makeTimelineSegment(0, video.duration / 2);
    state.timelineSegments.push(seg);
    selectTimelineSegment(seg.id, { applyLook: false });
    renderTimelinePanel();
    schedulePersist();
    if (fileStatus) fileStatus.textContent = `Segment 1 created: ${formatTime(0)}–${formatTime(seg.end)}`;
  }, { once: true });
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
    renderTimelinePanel();
    resizeCanvas();
  };
  imageEl.onerror = () => {
    showToast('Image failed to load', 'error');
  };
  imageEl.src = url;
}

// ---- Shader sources (generative GLSL library) ----
state.shaderSlug = null;
state.shaderRes = 'landscape';

function loadShaderSource(slug) {
  const def = SHADER_SOURCES.find((s) => s.slug === slug);
  if (!def) return;
  const res = SHADER_RES[state.shaderRes] || SHADER_RES.landscape;
  if (!setShaderSource(slug, res.w, res.h)) {
    showToast('Shader source failed to compile', 'error');
    return;
  }
  // tear down any active webcam / video
  if (video.srcObject) {
    video.srcObject.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
  try { video.pause(); } catch (_) {}
  video.removeAttribute('src');
  try { video.load(); } catch (_) {}
  resetAllState();
  state.sourceKind = 'shader';
  state.shaderSlug = slug;
  state.shaderAutoplay = true;
  setHasSource(true, def.label);
  renderTimelinePanel();
  resizeCanvas();
  renderShaderSourcePicker();
}

function renderShaderSourcePicker() {
  const group = document.getElementById('shader-source-group');
  if (!group) return;
  group.innerHTML = '';
  for (const def of SHADER_SOURCES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toggle-btn';
    btn.setAttribute('role', 'radio');
    const active = state.sourceKind === 'shader' && state.shaderSlug === def.slug;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', active ? 'true' : 'false');
    btn.dataset.value = def.slug;
    btn.dataset.tip = def.tip;
    btn.style.background = def.gradient;
    const span = document.createElement('span');
    span.textContent = def.label;
    btn.appendChild(span);
    btn.addEventListener('click', () => {
      if (state.sourceKind === 'shader' && state.shaderSlug === def.slug) {
        state.shaderSlug = null;
        state.shaderAutoplay = false;
        setHasSource(false);
        schedulePersist();
      } else {
        loadShaderSource(def.slug);
      }
    });
    group.appendChild(btn);
  }
  renderShaderKnobs();
}

// Per-shader knob panel in the Source section. Slot-knob pattern (writeValue
// → shaderSource param store, NOT global look state): knob values live
// per-slug in shaderSource.js for the session and are not part of saved
// looks, same as shaderSlug/shaderRes themselves.
function renderShaderKnobs() {
  const grid = document.getElementById('shader-knob-grid');
  const lbl = document.getElementById('lbl-shader-knobs');
  if (!grid) return;
  const def = state.sourceKind === 'shader' && state.shaderSlug
    ? SHADER_SOURCES.find((s) => s.slug === state.shaderSlug)
    : null;
  const knobs = def?.knobs || [];
  grid.innerHTML = '';
  const show = knobs.length > 0;
  grid.classList.toggle('hidden', !show);
  if (lbl) lbl.classList.toggle('hidden', !show);
  if (!show) return;
  const params = getShaderSourceParams(def.slug);
  for (const k of knobs) {
    const knobId = `shader-knob-${k.key}`;
    const el = document.createElement('div');
    el.className = 'knob slot-knob';
    el.id = knobId;
    el.dataset.knob = '';
    el.dataset.min     = String(k.min);
    el.dataset.max     = String(k.max);
    el.dataset.step    = String(k.step);
    el.dataset.default = String(k.default);
    el.dataset.tip     = k.tip;
    el.tabIndex = 0;
    el.setAttribute('aria-label', `${def.label} ${k.label}`);
    const labelEl = document.createElement('span');
    labelEl.className = 'knob-label';
    labelEl.textContent = k.label;
    const valSpan = document.createElement('span');
    valSpan.className = 'knob-val';
    valSpan.id = `${knobId}-val`;
    valSpan.textContent = String(params[k.key] ?? k.default);
    el.appendChild(labelEl);
    el.appendChild(valSpan);
    grid.appendChild(el);
    initKnob(el, {
      writeValue:   (v) => setShaderSourceParam(k.key, v),
      initialValue: params[k.key] ?? k.default,
    });
  }
}
renderShaderSourcePicker();

wireToggleGroup('shader-res-group', 'shaderRes', String, () => {
  // re-render at the new resolution if a shader source is live
  if (state.sourceKind === 'shader' && state.shaderSlug) loadShaderSource(state.shaderSlug);
});

function resetAllState() {
  resetFrameHistory(); resetTracker(); resetTrackOverlay();
  // FX feedback trails belong to the old source / timeline segment — a new
  // one starts from black, same as every other temporal cache here.
  resetFxFeedback();
  resetBlobFeedback();
  resetMotionHistory();
  cachedBlobs = []; frameCount = 0;
  _lastResolvedTimelineSegmentId = null;
  _lastResolvedTimelineRuntimeSig = '';
  // Smoothing state — both backends — gets purged so the next source
  // doesn't inherit a stale dead-filter pool that could mis-match its
  // first frame's blobs to leftover positions from the previous video.
  _activeFilters.clear();
  _deadFilters.clear();
  _presenceMap.clear();
  _displayBlobs.clear();
  disposeBlobPipeline(); // release blob FBO allocations on source change
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
    renderTimelinePanel();
  }
  // keep the shader-library picker's active state in sync across all
  // source kinds (clears when a video/camera/image takes over)
  renderShaderSourcePicker();
}

// ---- Timeline segments (video-only hard cuts) ----
let _lastResolvedTimelineSegmentId = null;
let _lastResolvedTimelineRuntimeSig = '';
let _lastPlayheadActiveId = undefined;
let _timelineApplyingLook = false;

function timelineAvailable() {
  return state.sourceKind === 'video' && Number.isFinite(video.duration) && video.duration > 0;
}

function syncSelectedSegmentFromState() {
  if (_timelineApplyingLook || !state.selectedTimelineSegmentId) return;
  const seg = state.timelineSegments.find((s) => s.id === state.selectedTimelineSegmentId);
  if (!seg) return;
  seg.look = makeLookSnapshot(state);
}

function selectedTimelineSegment() {
  return state.timelineSegments.find((s) => s.id === state.selectedTimelineSegmentId) || null;
}

function sortTimelineInPlace() {
  state.timelineSegments = sortedTimelineSegments();
}

function segmentOverlaps(start, end, ignoreId = null) {
  return state.timelineSegments.some((seg) => {
    if (seg.id === ignoreId) return false;
    return start < seg.end && end > seg.start;
  });
}

function findTimelineGap(preferredStart = 0, desiredLength = 2) {
  if (!timelineAvailable()) return null;
  const duration = video.duration;
  const len = clamp(desiredLength, TIMELINE_MIN_SEGMENT_SECONDS, duration);
  const sorted = sortedTimelineSegments();
  const candidates = [];
  let cursor = 0;
  for (const seg of sorted) {
    if (seg.start - cursor >= TIMELINE_MIN_SEGMENT_SECONDS) {
      candidates.push({ start: cursor, end: seg.start });
    }
    cursor = Math.max(cursor, seg.end);
  }
  if (duration - cursor >= TIMELINE_MIN_SEGMENT_SECONDS) {
    candidates.push({ start: cursor, end: duration });
  }
  for (const gap of candidates) {
    const start = clamp(preferredStart, gap.start, Math.max(gap.start, gap.end - TIMELINE_MIN_SEGMENT_SECONDS));
    const end = Math.min(gap.end, start + Math.min(len, gap.end - start));
    if (end - start >= TIMELINE_MIN_SEGMENT_SECONDS) return { start, end };
  }
  return null;
}

function setTimelineDisabled(disabled) {
  for (const el of [timelineAdd, timelineDuplicate, timelineDelete, timelineCapture]) {
    if (el) el.disabled = !!disabled;
  }
}

function timelineTimeFromEvent(e) {
  if (!timelineAvailable() || !timelineTrack) return 0;
  const rect = timelineTrack.getBoundingClientRect();
  const pct = rect.width > 0 ? clamp((e.clientX - rect.left) / rect.width, 0, 1) : 0;
  return pct * video.duration;
}

function updateTimelinePlayhead(time = video.currentTime, activeId = _lastResolvedTimelineSegmentId) {
  if (!timelinePanel || !timelineTrack || !timelinePlayhead) return;
  if (!timelineAvailable()) {
    timelinePlayhead.style.left = '0%';
    return;
  }
  const pct = clamp(time / video.duration, 0, 1) * 100;
  timelinePlayhead.style.left = `${pct}%`;
  // Update slider ARIA for keyboard/AT users
  const dur = video.duration || 0;
  timelineTrack.setAttribute('aria-valuemax', String(Math.round(dur)));
  timelineTrack.setAttribute('aria-valuenow', String(Math.round(time)));
  timelineTrack.setAttribute('aria-valuetext', `${formatTime(time)} / ${formatTime(dur)}`);
  if (activeId !== _lastPlayheadActiveId) {
    _lastPlayheadActiveId = activeId;
    for (const el of timelineTrack.querySelectorAll('.timeline-segment')) {
      el.classList.toggle('is-active', el.dataset.segmentId === activeId);
    }
  }
}

function renderTimelinePanel() {
  if (!timelinePanel || !timelineTrack) return;
  const available = timelineAvailable();
  timelinePanel.classList.toggle('hidden', state.sourceKind !== 'video');
  timelinePanel.classList.toggle('is-disabled', !available);
  timelineTrack.innerHTML = '';
  _lastPlayheadActiveId = undefined;

  if (!available) {
    setTimelineDisabled(true);
    return;
  }

  const recording = !!_recorder;
  setTimelineDisabled(recording);
  const selected = selectedTimelineSegment();
  const duration = video.duration;
  for (const seg of sortedTimelineSegments()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'timeline-segment';
    btn.dataset.segmentId = seg.id;
    btn.classList.toggle('is-selected', seg.id === state.selectedTimelineSegmentId);
    btn.style.left = `${(seg.start / duration) * 100}%`;
    btn.style.width = `${Math.max(0.5, ((seg.end - seg.start) / duration) * 100)}%`;
    btn.dataset.tip = `${seg.name} · ${formatTimePrecise(seg.start)}–${formatTimePrecise(seg.end)}s. Drag to move; drag edges to retime.`;

    const segLabel = document.createElement('span');
    segLabel.className = 'timeline-segment-label';
    segLabel.textContent = `${formatTime(seg.start)}-${formatTime(seg.end)}`;
    btn.appendChild(segLabel);

    // Click = select; drag the body = move the whole segment between its
    // neighbors. A 3px movement threshold separates the two gestures.
    let dragged = false;
    btn.addEventListener('click', () => { if (!dragged) selectTimelineSegment(seg.id); });
    btn.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.timeline-resize-handle')) return;
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      dragged = false;
      const sorted = sortedTimelineSegments();
      const idx = sorted.findIndex((s) => s.id === seg.id);
      const prevSeg = sorted[idx - 1] ?? null;
      const nextSeg = sorted[idx + 1] ?? null;
      const trackRect = timelineTrack.getBoundingClientRect();
      const len = seg.end - seg.start;
      const startX = e.clientX;
      const startT = seg.start;
      const onMove = (me) => {
        if (!dragged && Math.abs(me.clientX - startX) < 3) return;
        dragged = true;
        btn.classList.add('is-dragging');
        const dt = ((me.clientX - startX) / trackRect.width) * duration;
        const minStart = prevSeg ? prevSeg.end : 0;
        const maxStart = (nextSeg ? nextSeg.start : duration) - len;
        seg.start = clamp(startT + dt, minStart, Math.max(minStart, maxStart));
        seg.end = seg.start + len;
        btn.style.left = `${(seg.start / duration) * 100}%`;
        segLabel.textContent = `${formatTime(seg.start)}-${formatTime(seg.end)}`;
      };
      const onUp = () => {
        btn.removeEventListener('pointermove', onMove);
        btn.removeEventListener('pointerup', onUp);
        btn.classList.remove('is-dragging');
        if (dragged) {
          renderTimelinePanel();
          saveState();
        }
      };
      btn.addEventListener('pointermove', onMove);
      btn.addEventListener('pointerup', onUp);
    });

    const makeResizeHandle = (side) => {
      const handle = document.createElement('span');
      handle.className = `timeline-resize-handle${side === 'left' ? ' timeline-resize-handle--left' : ''}`;
      handle.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        const sorted = sortedTimelineSegments();
        const idx = sorted.findIndex((s) => s.id === seg.id);
        const prevSeg = sorted[idx - 1] ?? null;
        const nextSeg = sorted[idx + 1] ?? null;
        const trackRect = timelineTrack.getBoundingClientRect();
        const onMove = (me) => {
          const t = ((me.clientX - trackRect.left) / trackRect.width) * duration;
          if (side === 'left') {
            const minStart = prevSeg ? prevSeg.end : 0;
            seg.start = Math.max(minStart, Math.min(seg.end - 0.05, t));
            btn.style.left = `${(seg.start / duration) * 100}%`;
            btn.style.width = `${Math.max(0.5, ((seg.end - seg.start) / duration) * 100)}%`;
          } else {
            const maxEnd = nextSeg ? nextSeg.start : duration;
            seg.end = Math.max(seg.start + 0.05, Math.min(maxEnd, t));
            btn.style.width = `${Math.max(0.5, ((seg.end - seg.start) / duration) * 100)}%`;
          }
          segLabel.textContent = `${formatTime(seg.start)}-${formatTime(seg.end)}`;
        };
        const onUp = () => {
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onUp);
          renderTimelinePanel();
          saveState();
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
      });
      return handle;
    };
    btn.appendChild(makeResizeHandle('left'));
    btn.appendChild(makeResizeHandle('right'));
    timelineTrack.appendChild(btn);
  }
  timelineTrack.appendChild(timelinePlayhead);

  if (timelineDuplicate) timelineDuplicate.disabled = recording || !selected;
  if (timelineDelete) timelineDelete.disabled = recording || !selected;
  if (timelineCapture) timelineCapture.disabled = recording || !selected;
  updateTimelinePlayhead();
}

function sanitizeTimelineForCurrentDuration() {
  state.timelineSegments = sanitizeTimelineSegments(state.timelineSegments, timelineAvailable() ? video.duration : Infinity);
  if (!state.timelineSegments.some((s) => s.id === state.selectedTimelineSegmentId)) {
    state.selectedTimelineSegmentId = null;
  }
}

function selectTimelineSegment(id, { applyLook = true } = {}) {
  const seg = state.timelineSegments.find((s) => s.id === id);
  if (!seg) return;
  state.selectedTimelineSegmentId = id;
  if (applyLook) {
    _timelineApplyingLook = true;
    try { applyLookToState(seg.look); }
    finally { _timelineApplyingLook = false; }
  }
  renderTimelinePanel();
  schedulePersist();
}

function addTimelineSegment() {
  if (!timelineAvailable()) {
    showToast('Load an uploaded video before adding timeline segments', 'error');
    return;
  }
  if (_recorder) {
    showToast('Stop recording before editing the timeline', 'error');
    return;
  }
  const t = clamp(video.currentTime ?? 0, 0, video.duration);
  const start = t;
  const end = Math.min(t + 1, video.duration);
  if (end - start < TIMELINE_MIN_SEGMENT_SECONDS) {
    showToast('Not enough room — scrub earlier in the video', 'error');
    return;
  }
  if (segmentOverlaps(start, end)) {
    showToast('Overlaps an existing segment — scrub to an empty area', 'error');
    return;
  }
  const seg = makeTimelineSegment(start, end);
  state.timelineSegments.push(seg);
  sortTimelineInPlace();
  selectTimelineSegment(seg.id, { applyLook: false });
  if (fileStatus) fileStatus.textContent = `Segment added: ${formatTime(seg.start)}–${formatTime(seg.end)}`;
}

function duplicateTimelineSegment() {
  const selected = selectedTimelineSegment();
  if (!selected || !timelineAvailable()) return;
  if (_recorder) {
    showToast('Stop recording before editing the timeline', 'error');
    return;
  }
  const len = selected.end - selected.start;
  const gap = findTimelineGap(selected.end, len);
  if (!gap) {
    showToast('No empty timeline range available for duplicate', 'error');
    return;
  }
  const seg = makeTimelineSegment(gap.start, gap.end, selected.look);
  seg.name = `SEG ${state.timelineSegments.length + 1}`;
  state.timelineSegments.push(seg);
  sortTimelineInPlace();
  selectTimelineSegment(seg.id);
}

function deleteTimelineSegment() {
  const selected = selectedTimelineSegment();
  if (!selected) return;
  if (_recorder) {
    showToast('Stop recording before editing the timeline', 'error');
    return;
  }
  state.timelineSegments = state.timelineSegments.filter((s) => s.id !== selected.id);
  state.selectedTimelineSegmentId = null;
  renderTimelinePanel();
  schedulePersist();
}

function captureSelectedTimelineLook() {
  const selected = selectedTimelineSegment();
  if (!selected) return;
  selected.look = makeLookSnapshot(state);
  renderTimelinePanel();
  schedulePersist();
  showToast('Timeline segment updated from current look', 'ok', 1800);
}

timelineAdd?.addEventListener('click', addTimelineSegment);
timelineDuplicate?.addEventListener('click', duplicateTimelineSegment);
timelineDelete?.addEventListener('click', deleteTimelineSegment);
timelineCapture?.addEventListener('click', captureSelectedTimelineLook);

// Keyboard scrubbing for timeline track (accessibility)
if (timelineTrack) {
  timelineTrack.setAttribute('role', 'slider');
  timelineTrack.setAttribute('aria-label', 'Playback position');
  timelineTrack.setAttribute('aria-valuemin', '0');
  timelineTrack.setAttribute('aria-valuenow', '0');
  timelineTrack.setAttribute('aria-valuemax', '0');
  timelineTrack.setAttribute('tabindex', '0');
  timelineTrack.addEventListener('keydown', (e) => {
    if (!timelineAvailable()) return;
    const step = 5;
    if      (e.key === 'ArrowLeft')  video.currentTime = Math.max(0, video.currentTime - step);
    else if (e.key === 'ArrowRight') video.currentTime = Math.min(video.duration, video.currentTime + step);
    else if (e.key === 'Home')       video.currentTime = 0;
    else if (e.key === 'End')        video.currentTime = video.duration;
    else return;
    e.preventDefault();
  });
}

// The track doubles as the scrubber: pointer down on empty track seeks, and
// keeping the pointer down keeps scrubbing. Segments swallow their own
// pointerdown so drag-to-move and drag-to-resize win over scrubbing.
timelineTrack?.addEventListener('pointerdown', (e) => {
  if (!timelineAvailable() || _recorder) return;
  if (e.target.closest('.timeline-segment')) return;
  e.preventDefault();
  timelineTrack.setPointerCapture(e.pointerId);
  const seek = (ev) => {
    const t = timelineTimeFromEvent(ev);
    video.currentTime = t;
    if (videoTime) videoTime.textContent = `${formatTime(t)} / ${formatTime(video.duration)}`;
    updateTimelinePlayhead(t, findTimelineSegmentAt(t)?.id || null);
  };
  seek(e);
  const onMove = (ev) => seek(ev);
  const onUp = () => {
    timelineTrack.removeEventListener('pointermove', onMove);
    timelineTrack.removeEventListener('pointerup', onUp);
  };
  timelineTrack.addEventListener('pointermove', onMove);
  timelineTrack.addEventListener('pointerup', onUp);
});

video.addEventListener('loadedmetadata', () => {
  resizeCanvas();
  if (state.hasSource && state.sourceKind !== 'image' && video.videoWidth && video.videoHeight) {
    const current = fileStatus.textContent.split(' · ')[0];
    updateSourceLabel(`${current} · ${video.videoWidth}×${video.videoHeight}`);
  }
  sanitizeTimelineForCurrentDuration();
  renderTimelinePanel();
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

// ---- Video playback controls (live in the timeline bar) ----
btnPlay.addEventListener('click', () => {
  if (video.paused) { video.play().catch(() => {}); }
  else { video.pause(); }
});
video.addEventListener('play',  () => { btnPlay.textContent = '❚❚'; btnPlay.setAttribute('aria-label', 'Pause'); });
video.addEventListener('pause', () => { btnPlay.textContent = '▶';  btnPlay.setAttribute('aria-label', 'Play'); });
btnMute.addEventListener('click', () => { video.muted = !video.muted; });
video.addEventListener('volumechange', () => {
  btnMute.classList.toggle('muted', video.muted);
  btnMute.setAttribute('aria-label', video.muted ? 'Unmute video audio' : 'Mute video audio');
});

video.addEventListener('timeupdate', () => {
  if (!isFinite(video.duration) || video.duration === 0) return;
  videoTime.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
  updateTimelinePlayhead(video.currentTime, findTimelineSegmentAt(video.currentTime)?.id || null);
});

// Color key mode — native <input type="color"> wired to state.colorKeyHex.
if (colorKeyInput) {
  colorKeyInput.value = state.colorKeyHex;
  colorKeyInput.addEventListener('input', () => {
    state.colorKeyHex = colorKeyInput.value;
    schedulePersist();
  });
}
if (inkLowInput) {
  inkLowInput.value = normalizeHexColor(state.inkBlackHex, DEFAULTS.inkBlackHex);
  inkLowInput.addEventListener('input', () => {
    state.inkBlackHex = normalizeHexColor(inkLowInput.value, DEFAULTS.inkBlackHex);
    schedulePersist();
  });
}
if (inkHighInput) {
  inkHighInput.value = normalizeHexColor(state.inkCreamHex, DEFAULTS.inkCreamHex);
  inkHighInput.addEventListener('input', () => {
    state.inkCreamHex = normalizeHexColor(inkHighInput.value, DEFAULTS.inkCreamHex);
    schedulePersist();
  });
}

// ---- Canvas sizing ----
function getExportDimensions() {
  const heights = { '720p': 720, '1080p': 1080, '4k': 2160 };
  const targetH = heights[exportResKey];
  if (!targetH) return null;
  const sw = activeSourceWidth();
  const sh = activeSourceHeight();
  const ratio = sw && sh ? sw / sh : 16 / 9;
  return { w: Math.round(targetH * ratio), h: targetH };
}

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
  const smooth = currentLook().trackStability;
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
  const smooth = currentLook().trackStability;
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

// ---- Asymmetric presence smoother (attack / release) ----
// Mirrors the TouchDesigner blobmask smooth pattern: blobs rise toward
// full presence at the attack rate and decay toward zero at the release
// rate when no longer detected. Ghost blobs linger at their last known
// position until presence falls below the cull threshold, giving natural
// fade-out instead of a hard pop.
//
// attack  0..1 → per-frame rise  rate 0.05..1.0
// release 0..1 → per-frame decay rate 0.005..0.5

const _presenceMap = new Map(); // id → { presence, lastBlob }

function applyPresenceSmoother(blobs) {
  const look    = currentLook();
  const rawA    = look.trackAttack  ?? 0.5;
  const rawR    = look.trackRelease ?? 0.1;
  const attack  = 0.05 + rawA * 0.95;   // 0.05..1.0
  const release = 0.005 + rawR * 0.495; // 0.005..0.5

  const seenIds = new Set();
  for (const b of blobs) seenIds.add(b.id);

  // Rise — detected blobs
  for (const b of blobs) {
    const prev = _presenceMap.get(b.id);
    const p    = prev ? prev.presence : 0;
    _presenceMap.set(b.id, { presence: Math.min(1, p + attack * (1 - p)), lastBlob: b });
  }

  // Decay — lost blobs
  for (const [id, entry] of _presenceMap) {
    if (!seenIds.has(id)) {
      entry.presence *= (1 - release);
      if (entry.presence < 0.008) _presenceMap.delete(id);
    }
  }

  const out = [];
  for (const entry of _presenceMap.values()) {
    out.push({ ...entry.lastBlob, presence: entry.presence });
  }
  return out;
}

function needsBlobPipeline() {
  const look = currentLook();
  return look.mode === 'track' || look.perBlob !== 'none';
}

function resolveDetectScale(cw, ch) {
  const pixels = Math.max(1, cw * ch);
  const budgetScale = Math.sqrt(DETECT_TARGET_PIXELS / pixels);
  return clamp(budgetScale, DETECT_MIN_SCALE, DETECT_MAX_SCALE);
}

function clearBlobPipelineCaches() {
  if (!cachedBlobs.length && frameCount === 0 && !_activeFilters.size && !_deadFilters.size && !_displayBlobs.size) return;
  cachedBlobs = [];
  frameCount = 0;
  resetFrameHistory();
  resetTracker();
  _activeFilters.clear();
  _deadFilters.clear();
  _displayBlobs.clear();
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
  const timelineResolved = resolveTimelineLook(video.currentTime || 0);
  const runtimeSig = timelineRuntimeSignature(timelineResolved.look);
  if (
    timelineResolved.id !== _lastResolvedTimelineSegmentId ||
    runtimeSig !== _lastResolvedTimelineRuntimeSig
  ) {
    resetAllState();
    _lastResolvedTimelineSegmentId = timelineResolved.id;
    _lastResolvedTimelineRuntimeSig = runtimeSig;
  }
  _renderLook = timelineResolved.look;
  const look = currentLook();
  updateTimelinePlayhead(video.currentTime || 0, timelineResolved.id);

  const cw = canvas.width;
  const ch = canvas.height;
  if (state.sourceKind === 'shader') renderShaderSourceFrame();
  ctx.drawImage(srcEl, 0, 0, cw, ch);

  const blobPipelineActive = needsBlobPipeline();
  let blobs = [];
  if (blobPipelineActive) {
    const detectScale = resolveDetectScale(cw, ch);
    const ow = Math.max(1, Math.round(cw * detectScale));
    const oh = Math.max(1, Math.round(ch * detectScale));
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

      frameCount++;
      if (frameCount % Math.max(1, look.updateInterval) === 0) {
        const cap = Math.min(30, look.trackMaxBlobs);
        const sx = cw / ow, sy = ch / oh;
        let rawBlobs;
        if (state.trackBackend === 'object') {
          // MediaPipe object detection on the same downscaled frame. Maps to
          // the blob shape; reuses look.threshold (→ scoreThreshold) and
          // trackMaxBlobs (→ maxResults) so no new knobs are needed.
          if (!isObjectDetectorReady()) { rawBlobs = []; }
          else {
            const scoreThreshold = Math.min(0.9, Math.max(0.05, look.threshold / 100));
            rawBlobs = detectObjects(offscreen, performance.now(), { scoreThreshold, maxResults: cap });
          }
        } else {
          const minSizeDetect = look.trackMinSize * detectScale;
          const offImageData = offCtx.getImageData(0, 0, ow, oh);
          if (look.trackChannel === 'color') {
            const hex = look.colorKeyHex.replace('#', '');
            const cr = parseInt(hex.slice(0, 2), 16);
            const cg = parseInt(hex.slice(2, 4), 16);
            const cb = parseInt(hex.slice(4, 6), 16);
            setColorKeyTarget(cr, cg, cb, look.colorKeyHueTol, look.colorKeySatMin, 0.10);
          } else {
            clearColorKeyTarget();
          }
          rawBlobs = detectBlobs(offImageData, look.threshold, cap, look.trackChannel, minSizeDetect);
        }
        const scaledRaw = rawBlobs.map(b => ({
          ...b, x: b.x*sx, y: b.y*sy, w: b.w*sx, h: b.h*sy, cx: b.cx*sx, cy: b.cy*sy,
        }));
        cachedBlobs = trackBlobs(scaledRaw, cw, cap);
      }
    }
    blobs = applyPresenceSmoother(smoothBlobs(cachedBlobs, cw));
  } else {
    clearBlobPipelineCaches();
  }

  // GL dispatch — multi-stage chain pipeline.
  //
  //   video → STRUCTURE → [compose if structure blend = screen]
  //                 ↓                 ↓
  //              COLOR[0..2] → FX[0..2] → screen
  //                                        composite blend =
  //                                        terminal stage's BLEND_MODES
  //
  // COLOR and FX stages share the same ping-pong mechanics, so they're
  // merged into one `chained` list below. FX stages (glFx.js) additionally
  // keep per-slot feedback textures between frames — internal to the
  // module; the chain just sees a stage that reads inputTex and writes
  // outputFBO like any other.
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
  const pipe = resolveActivePipeline(look);
  // COLOR, GRADE, and FX stages have identical chain mechanics (read
  // inputTex, write outputFBO) — only the dispatcher differs. Normalize
  // them into one ordered list: color, then grade, then fx
  // (STRUCTURE → COLOR → GRADE → FX).
  const chained = [];
  if (pipe.color) chained.push({ type: pipe.color.type, run: (opts) => runColorEffect(pipe.color.type, pipe.color.params, opts) });
  if (pipe.grade) chained.push({ type: 'grade',         run: (opts) => runGradeEffect(pipe.grade, opts) });
  chained.push(...pipe.fx.map((f) => ({ type: f.type, run: (opts) => runFxEffect(f.type, f.params, opts, f.key) })));
  const totalStages = (pipe.structure ? 1 : 0) + chained.length;
  if (totalStages > 0) {
    ensureContext(cw, ch);
    uploadVideoFrame(srcEl);
    // Motion effects diff the current frame against the frame-history ring
    // (~4 frames back). Capture only when one is active — idle cost is zero.
    if (pipe.structure === 'motionedge' || pipe.color?.type === 'predator') {
      captureFrameHistory();
    }

    if (totalStages === 1) {
      // Standalone single-stage fast path. No chain FBO allocation, no
      // ping-pong. Identical pixel output to the pre-rack standalone path.
      if (pipe.structure) {
        const chain = getChainFBOs();
        // Run structure shader to chain.a (raw mono output)
        runEffect(pipe.structure, { outputFBO: chain.a.fb });
        // Structure output-mode conversion: raw mono → Source/Mono/Ink/Invert
        const structModeVal = structureOutputModeValue(look);
        const inkColors = inkColorUniforms(look);
        applyStructureMode(cw, ch, chain.a.tex, structModeVal, inkColors.inkLow, inkColors.inkHigh, null);
        compositeToCanvas2D(ctx, cw, ch, BLEND_MODES[pipe.structure] || 'source-over');
      } else {
        const stage = chained[0];
        stage.run({});
        compositeToCanvas2D(ctx, cw, ch, BLEND_MODES[stage.type] || 'source-over');
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

        // Structure output-mode conversion: raw mono → Source/Mono/Ink/Invert
        const structModeVal = structureOutputModeValue(look);
        const inkColors = inkColorUniforms(look);
        applyStructureMode(cw, ch, currentTex, structModeVal, inkColors.inkLow, inkColors.inkHigh, writeFBOs[writeIdx]);
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

      // COLOR + FX — chained. Each reads currentTex (or raw video if
      // STRUCTURE was None and this is the first stage), writes to the next
      // slot in the ping-pong, then becomes the source for the next
      // iteration. The last stage writes to the default framebuffer instead
      // of a chain FBO so its output ends up on the shared GL canvas for
      // compositing.
      for (let i = 0; i < chained.length; i++) {
        const isLast = (i === chained.length - 1);
        const outFB  = isLast ? null : writeFBOs[writeIdx];
        // currentTex is null when no STRUCTURE and this is the first stage
        // → effect module's `inputTex || getVideoTex()` defaults to the
        // shared video texture. Don't pass inputTex in that case.
        const opts = currentTex ? { inputTex: currentTex, outputFBO: outFB }
                                : { outputFBO: outFB };
        chained[i].run(opts);
        if (!isLast) {
          currentTex = readTexs[writeIdx];
          writeIdx ^= 1;
        }
      }

      // Terminal-stage rule: composite blend mode is whatever the LAST
      // stage in the chain naturally wants. Last chained stage (color or
      // fx) when any exist, otherwise STRUCTURE (which means we got here
      // only when STRUCTURE is the only stage — already handled by the
      // totalStages===1 branch above, so this is just the chained case).
      const terminal = chained[chained.length - 1].type;
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
  if (look.perBlob !== 'none' && blobs.length > 0) {
    const full = ctx.getImageData(0, 0, cw, ch);
    let touched = false;
    for (const blob of blobs) {
      const bx = Math.max(0, Math.floor(blob.cx - blob.w / 2));
      const by = Math.max(0, Math.floor(blob.cy - blob.h / 2));
      const bw = Math.min(cw - bx, Math.ceil(blob.w));
      const bh = Math.min(ch - by, Math.ceil(blob.h));
      if (bw <= 0 || bh <= 0) continue;
      applyFilterToSubregion(full.data, cw, bx, by, bw, bh, look.perBlob, 'rect');
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
  if (look.mode === 'track') {
    if (look.trackComposite === 'isolated') {
      ctx.save();
      ctx.fillStyle = '#0a0908'; // Match display-screen instead of pure black.
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }
    // Build the opts bag for the overlay renderer. trackFxRack contributes
    // 0–3 effects, in slot order, only enabled non-empty slots.
    const effects = look.trackFxRack
      .filter((s) => s.enabled && s.type !== 'none')
      .map((s) => ({ type: s.type, params: s.params }));
    drawTrackOverlay(ctx, blobs, cw, ch, {
      shape: {
        type:       look.trackShape,
        hueColor:   look.trackShapeColor,
        thickness:  look.trackShapeThickness,
        padding:    look.trackShapePadding,
        styleParam: look.trackShapeStyle,
      },
      lines: {
        type:      look.trackLines,
        hueColor:  look.trackLinesColor,
        thickness: look.trackLinesThickness,
        param:     look.trackLinesParam,
        taper:     look.trackLinesTaper,
      },
      effects,
      labels: { show: false },
    });
  }

  // Blob LumiSynth — composited AFTER the track overlay so it sits on top.
  // Crops each blob's region from the original video (srcEl), runs it through
  // an independent STRUCTURE → COLOR → GRADE → FX chain, then blends the result
  // onto the display canvas using the chosen composite mode.
  if (blobs.length > 0) {
    const blobPipe = resolveBlobPipeline(look);
    const blobHasWork = blobPipe.structure || blobPipe.color || blobPipe.grade || blobPipe.fx.length > 0;
    if (blobHasWork) {
      const MAX_BLOBS = 6;
      for (let i = 0; i < Math.min(blobs.length, MAX_BLOBS); i++) {
        const blob = blobs[i];
        if ((blob.presence ?? 1) < 0.02) continue;
        const bx = Math.max(0, Math.floor(blob.cx - blob.w / 2));
        const by = Math.max(0, Math.floor(blob.cy - blob.h / 2));
        const bw = Math.min(cw - bx, Math.ceil(blob.w));
        const bh = Math.min(ch - by, Math.ceil(blob.h));
        if (bw < 8 || bh < 8) continue;
        runBlobFrame(srcEl, bx, by, bw, bh, blobPipe, ctx, cw, ch, blob.presence ?? 1);
      }
    }
  }

  // Unified label overlay — drawn last so tags sit above everything.
  if (look.mode === 'track' && look.trackLabels !== 'off' && blobs.length > 0) {
    const fSize = 10;
    const padX = 5, padY = 3;
    const tagH = fSize + padY * 2;
    ctx.save();
    ctx.font = `bold ${fSize}px monospace`;
    for (const blob of blobs) {
      const bx = Math.max(0, Math.floor(blob.cx - blob.w / 2));
      const by = Math.max(0, Math.floor(blob.cy - blob.h / 2));
      const bw = Math.min(cw - bx, Math.ceil(blob.w));

      let text = null;
      let alignRight = false;
      if (look.trackLabels === 'confidence' && blob.category) {
        text = `${blob.category}  ${Math.round(blob.score * 100)}%`;
        alignRight = false;
      } else if (look.trackLabels === 'position') {
        text = `X:${Math.round(blob.cx)} Y:${Math.round(blob.cy)}`;
        alignRight = true;
      }
      if (!text) continue;

      const tagW = ctx.measureText(text).width + padX * 2;
      const tagX = alignRight
        ? Math.min(cw - tagW, bx + bw - tagW)
        : Math.max(0, bx);
      const tagY = Math.max(0, by - tagH - 1);

      ctx.fillStyle = 'rgba(0,0,0,0.70)';
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(tagX, tagY, tagW, tagH, 3); ctx.fill(); }
      else ctx.fillRect(tagX, tagY, tagW, tagH);
      ctx.fillStyle = '#e8e8e8';
      ctx.fillText(text, tagX + padX, tagY + padY + fSize - 1);
    }
    ctx.restore();
  }

  if (fpsEnabled) updateFps(blobs.length);
  _renderLook = null;
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
let _helpTipRect = null;
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
  if (!_helpTipRect) _helpTipRect = helpTip.getBoundingClientRect();
  const rect = _helpTipRect;
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
  if (_knobDragActive) {
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
    _helpTipRect = null;
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

// ---- Lag cursor ----
// Pearl Fisher-inspired custom cursor: one solid delayed pointer, no trail.
// Desktop/fine-pointer only, disabled when reduced motion is requested.
const lagCursorMedia = window.matchMedia('(pointer: fine) and (prefers-reduced-motion: no-preference)');
const lagCursor = document.createElement('div');
lagCursor.className = 'lag-cursor';
lagCursor.setAttribute('aria-hidden', 'true');
document.body.appendChild(lagCursor);

const lagCursorState = {
  enabled: false,
  initialized: false,
  raf: 0,
  x: 0,
  y: 0,
  tx: 0,
  ty: 0,
};

function isTextCursorTarget(el) {
  return !!(el && el.closest && el.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]'));
}

function renderLagCursor() {
  if (!lagCursorState.enabled) return;
  lagCursorState.x += (lagCursorState.tx - lagCursorState.x) * 0.12;
  lagCursorState.y += (lagCursorState.ty - lagCursorState.y) * 0.12;
  lagCursor.style.transform = `translate3d(${lagCursorState.x}px, ${lagCursorState.y}px, 0) translate(-50%, -50%)`;
  lagCursorState.raf = requestAnimationFrame(renderLagCursor);
}

function setLagCursorEnabled(enabled) {
  lagCursorState.enabled = enabled;
  document.body.classList.toggle('lag-cursor-enabled', enabled);
  if (!enabled) {
    document.body.classList.remove('lag-cursor-text-mode');
    lagCursor.classList.remove('visible', 'is-text');
    if (lagCursorState.raf) cancelAnimationFrame(lagCursorState.raf);
    lagCursorState.raf = 0;
    return;
  }
  if (!lagCursorState.raf) lagCursorState.raf = requestAnimationFrame(renderLagCursor);
}

function updateLagCursor(e) {
  if (!lagCursorState.enabled) return;
  lagCursorState.tx = e.clientX;
  lagCursorState.ty = e.clientY;
  if (!lagCursorState.initialized) {
    lagCursorState.x = e.clientX;
    lagCursorState.y = e.clientY;
    lagCursorState.initialized = true;
  }

  const textMode = isTextCursorTarget(e.target);
  document.body.classList.toggle('lag-cursor-text-mode', textMode);
  lagCursor.classList.toggle('is-text', textMode);
  lagCursor.classList.add('visible');
}

document.addEventListener('pointermove', updateLagCursor, { passive: true });
document.addEventListener('pointerleave', () => lagCursor.classList.remove('visible'));
window.addEventListener('blur', () => lagCursor.classList.remove('visible'));
setLagCursorEnabled(false);

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
showIntroIfNeeded();
renderAccountUi();
initAuth();
canvas.width  = canvasArea.clientWidth;
canvas.height = canvasArea.clientHeight;
btnSnapshot.disabled = !state.hasSource;
if (btnRecord) btnRecord.disabled = !state.hasSource;

// No autoplay on cold start — user must explicitly pick a shader from the library.
