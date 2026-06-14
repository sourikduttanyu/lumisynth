/**
 * Audio-reactivity engine — Phase 1 of REACTIVITY_PLAN.md.
 *
 * Web Audio FFT → a small signal bus { bass, mid, high, level, beat }. This
 * phase ONLY produces signals + feeds a meter; no routing to params yet (the
 * mod matrix / step sequencer come in later phases). The bus is the shared
 * backbone a future MediaPipe VJ source would also fill.
 *
 * Three inputs, all robust:
 *   - mic    — getUserMedia, never connected to the speakers (no feedback)
 *   - file   — a dedicated <audio> element, routed to the speakers so you hear it
 *   - source — the app's shared <video> own audio track (uploaded clips only;
 *              webcam is captured audio:false). createMediaElementSource is
 *              once-only per element, so the node is cached; the video is
 *              unmuted while reacting and restored on stop.
 *
 * Signals are smoothed (fast attack / slow release) and auto-gained so they
 * read the same at any input volume. `beat` is an onset trigger (bass energy
 * vs. its rolling average) that decays each frame.
 */

const FFT_SIZE = 2048;

let ctx = null;
let analyser = null;
let freqData = null;

let inputNode = null;    // the source node currently feeding the analyser
let inputLabel = null;   // 'mic' | 'file' | 'source' | null
let micStream = null;
let fileEl = null;       // dedicated <audio> for file playback
let elSourceNode = null; // cached MediaElementSource for the shared <video>
let videoEl = null;      // shared video ref (to restore mute on stop)
let videoWasMuted = true;

const sig = { bass: 0, mid: 0, high: 0, level: 0, beat: 0 };

let bassAvg = 0, beatEnv = 0, lastBeatT = -1e9, gainRef = 0.12;

export function isActive() { return !!inputNode; }
export function currentInput() { return inputLabel; }
export function getSignals() { return sig; }

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.6;
    freqData = new Uint8Array(analyser.frequencyBinCount);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function resetDynamics() { bassAvg = 0; beatEnv = 0; lastBeatT = -1e9; gainRef = 0.12; }

function detachAll() {
  if (inputNode) { try { inputNode.disconnect(); } catch (_) {} }
  inputNode = null;
  if (analyser) { try { analyser.disconnect(); } catch (_) {} }
  if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
  if (fileEl) { try { fileEl.pause(); URL.revokeObjectURL(fileEl.src); } catch (_) {} fileEl = null; }
  if (videoEl) { videoEl.muted = videoWasMuted; videoEl = null; }
}

export async function startMic() {
  if (!ensureCtx()) throw new Error('Web Audio not supported');
  detachAll();
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  inputNode = ctx.createMediaStreamSource(micStream);
  inputNode.connect(analyser);   // NOT to destination — would feed back
  inputLabel = 'mic';
  resetDynamics();
}

export function startFile(file) {
  if (!ensureCtx()) throw new Error('Web Audio not supported');
  detachAll();
  fileEl = document.createElement('audio');
  fileEl.src = URL.createObjectURL(file);
  fileEl.loop = true;
  fileEl.play().catch(() => {});
  inputNode = ctx.createMediaElementSource(fileEl);
  inputNode.connect(analyser);
  analyser.connect(ctx.destination);   // hear the track
  inputLabel = 'file';
  resetDynamics();
}

export function startElement(v) {
  if (!ensureCtx()) throw new Error('Web Audio not supported');
  detachAll();
  videoEl = v;
  videoWasMuted = v.muted;
  v.muted = false;                      // react to (and hear) the source track
  if (!elSourceNode) elSourceNode = ctx.createMediaElementSource(v);  // once-only
  inputNode = elSourceNode;
  inputNode.connect(analyser);
  analyser.connect(ctx.destination);
  inputLabel = 'source';
  resetDynamics();
}

export function stop() {
  detachAll();
  inputLabel = null;
  sig.bass = sig.mid = sig.high = sig.level = sig.beat = 0;
}

/**
 * Pure band extraction — exported for testing. Sums normalized FFT magnitude
 * over three frequency bands. `binHz` = sampleRate / fftSize.
 */
export function computeBands(freq, binHz) {
  const band = (lo, hi) => {
    const a = Math.max(1, Math.floor(lo / binHz));
    const b = Math.min(freq.length - 1, Math.ceil(hi / binHz));
    let s = 0;
    for (let i = a; i <= b; i++) s += freq[i];
    return (s / (b - a + 1)) / 255;
  };
  const bass = band(20, 150);
  const mid = band(150, 2000);
  const high = band(2000, 9000);
  return { bass, mid, high, level: (bass + mid + high) / 3 };
}

function env(prev, target) {
  return target > prev ? prev + (target - prev) * 0.55   // fast attack
                       : prev + (target - prev) * 0.14;  // slow release
}

/** Read the FFT and update the signal bus. Call once per frame while active. */
export function update(now) {
  if (!inputNode) return sig;
  analyser.getByteFrequencyData(freqData);
  const binHz = ctx.sampleRate / analyser.fftSize;
  const b = computeBands(freqData, binHz);

  // auto-gain to the overall level, capped so quiet input still reads
  gainRef = Math.max(gainRef * 0.995, b.level, 0.04);
  const g = Math.min(5, 1 / gainRef);
  const norm = (v) => Math.min(1, v * g);

  sig.bass = env(sig.bass, norm(b.bass));
  sig.mid = env(sig.mid, norm(b.mid));
  sig.high = env(sig.high, norm(b.high));
  sig.level = env(sig.level, norm(b.level));

  // beat: bass onset vs. its rolling average, with a refractory window
  const t = now || performance.now();
  bassAvg = bassAvg * 0.93 + b.bass * 0.07;
  if (b.bass > bassAvg * 1.35 && b.bass > 0.12 && (t - lastBeatT) > 220) {
    beatEnv = 1;
    lastBeatT = t;
  }
  beatEnv *= 0.88;
  sig.beat = beatEnv;
  return sig;
}
