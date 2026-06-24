// MediaPipe Object Detection — a TRACK detection backend (NOT a source kind).
//
// Runs EfficientDet-Lite on the existing video/webcam frame and emits bounding
// boxes mapped onto the same blob shape blobDetector.js produces, so the rest of
// the pipeline (kalman trackBlobs → smoothBlobs → drawTrackOverlay → track FX →
// per-blob filters) is untouched. main.js branches on state.trackBackend in the
// renderFrame detection block and feeds the result through trackBlobs for stable IDs.
//
// WASM + model are self-hosted under public/mediapipe/ so this works offline.
import { FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision';

// BASE_URL respects vite's `base` ('/' in dev, '/lumisynth/' on GitHub Pages),
// so these resolve under the deploy subpath instead of the domain root.
const BASE = import.meta.env.BASE_URL;
const WASM_PATH = `${BASE}mediapipe/wasm`;
const MODEL_PATH = `${BASE}mediapipe/efficientdet_lite0.tflite`;

// Module singletons. The detector's delegate (GPU/CPU) is fixed at create time,
// so changing it means closing and rebuilding.
let _detector = null;
let _fileset = null;       // cached FilesetResolver (WASM only loads once)
let _ready = false;
let _delegate = null;      // delegate the current _detector was built with
let _building = null;      // in-flight build promise (dedupe concurrent inits)

export function isObjectDetectorReady() {
  return _ready;
}

// Build (or rebuild) the detector for a given delegate. Idempotent: a no-op if
// already ready on the same delegate; rebuilds if the delegate changed.
export async function initObjectDetector(delegate = 'GPU') {
  if (_ready && _delegate === delegate) return _detector;
  if (_building) {
    await _building;
    if (_ready && _delegate === delegate) return _detector;
  }
  _building = (async () => {
    if (!_fileset) _fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    if (_detector) { _detector.close(); _detector = null; _ready = false; }
    _detector = await ObjectDetector.createFromOptions(_fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode: 'VIDEO',
      scoreThreshold: 0.3,
      maxResults: 30,
    });
    _delegate = delegate;
    _ready = true;
  })();
  try {
    await _building;
  } finally {
    _building = null;
  }
  return _detector;
}

// Swap delegate (GPU ↔ CPU) — rebuilds the detector.
export function setObjectDetectorDelegate(delegate) {
  return initObjectDetector(delegate);
}

// Run detection on a frame source (the downscaled offscreen canvas).
// timestampMs must be monotonically increasing (use performance.now()).
// Returns raw blobs in the source element's pixel space; caller rescales to
// canvas space and feeds through trackBlobs for IDs — same as the blob path.
export function detectObjects(srcEl, timestampMs, { scoreThreshold = 0.3, maxResults = 12 } = {}) {
  if (!_ready || !_detector) return [];
  let result;
  try {
    result = _detector.detectForVideo(srcEl, timestampMs);
  } catch {
    return [];
  }
  const dets = result?.detections || [];
  const blobs = [];
  for (let i = 0; i < dets.length && blobs.length < maxResults; i++) {
    const d = dets[i];
    const cat = d.categories && d.categories[0];
    const score = cat ? cat.score : 0;
    if (score < scoreThreshold) continue;
    const bb = d.boundingBox;
    if (!bb) continue;
    const w = bb.width, h = bb.height;
    blobs.push({
      x: bb.originX,
      y: bb.originY,
      w, h,
      cx: bb.originX + w / 2,
      cy: bb.originY + h / 2,
      area: w * h,
      score,
      category: cat ? cat.categoryName : '',
      index: blobs.length,
    });
  }
  return blobs;
}

export function disposeObjectDetector() {
  if (_detector) { _detector.close(); _detector = null; }
  _ready = false;
  _delegate = null;
}

// Force-rebuild the detector, resetting MediaPipe's internal timestamp
// watermark. Must be awaited before starting any new detection pass
// (e.g. export) that will use synthetic timestamps starting from 0,
// because MediaPipe enforces strict monotonicity and will reject frames
// whose timestamp is behind the last live-preview performance.now() value.
export async function resetObjectDetector(delegate = 'GPU') {
  if (_detector) { _detector.close(); _detector = null; }
  _ready = false;
  _delegate = null;
  _building = null;
  return initObjectDetector(delegate);
}
