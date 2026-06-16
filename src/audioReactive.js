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
let elSourceNode = null; // cached MediaElementSource for the shared <video> (once-only)
let monitorGain = null;  // elSourceNode → monitorGain → destination; gain = the mute control
let monitorEl = null;    // the <video> the monitor is bound to

const sig = { bass: 0, mid: 0, high: 0, level: 0, beat: 0 };

// Per-band auto-normalization: each band tracks its OWN recent peak so bass
// Bands are used RAW (FFT magnitude / 255) with a per-band Gain trim — the raw
// level already bounces nicely. (An earlier per-band auto-normalize pushed every
// band toward its own peak and read as "flat-maxed" — removed.)
const beatState = { prev: 0, avg: 0, last: -1e9, env: 0 };

// User calibration (transient): a Gain trim per band + Beat onset sensitivity.
// Highs/mids default higher because they are naturally quieter than bass.
const cfg = { gainBass: 1, gainMid: 1.4, gainHigh: 2, gainLevel: 1.3, beatSens: 0.5 };
export function getConfig() { return { ...cfg }; }
export function setConfig(key, value) { if (key in cfg) cfg[key] = value; }

export function isActive() { return !!inputNode; }
export function currentInput() { return inputLabel; }
export function getSignals() { return sig; }

/**
 * Flux (spectral-onset) beat detector on the bass level. A kick is a RISE, not
 * an absolute level, so we fire when the positive frame-to-frame rise exceeds a
 * rolling average of recent rises plus a threshold (with a refractory gap). This
 * is robust on sustained basslines where a level/hysteresis test never re-fires.
 * Mutates `s = {prev, avg, last, env}`; returns true on a fresh hit. Pure for
 * testing (no module globals).
 */
export function beatStep(s, bass, t, beatSens) {
  const flux = Math.max(0, bass - s.prev);
  s.prev = bass;
  const trig = 0.16 - beatSens * 0.10;   // 0.16 (hard) → 0.06 (hair-trigger)
  let fired = false;
  if (flux > s.avg + trig && flux > 0.04 && (t - s.last) > 150) {
    s.env = 1; s.last = t; fired = true;
  }
  s.avg = s.avg * 0.9 + flux * 0.1;
  s.env *= 0.86;
  return fired;
}

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.3;
    freqData = new Uint8Array(analyser.frequencyBinCount);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function resetDynamics() {
  beatState.prev = 0; beatState.avg = 0; beatState.last = -1e9; beatState.env = 0;
}

function detachAll() {
  if (inputNode) {
    // For the shared video, drop only the analyser tap so the monitor chain
    // (elSourceNode → monitorGain → destination) survives. Mic/file nodes are
    // throwaway, so disconnect them fully.
    try { inputNode === elSourceNode ? inputNode.disconnect(analyser) : inputNode.disconnect(); } catch (_) {}
  }
  inputNode = null;
  if (analyser) { try { analyser.disconnect(); } catch (_) {} }
  if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
  if (fileEl) { try { fileEl.pause(); URL.revokeObjectURL(fileEl.src); } catch (_) {} fileEl = null; }
  // NOTE: the elSourceNode → monitorGain → destination chain is intentionally
  // preserved here — it is owned by the mute toggle, not the Live lifecycle, so
  // the working video keeps playing audio at its set volume after Live stops.
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

// Lazily create the once-only MediaElementSource for the shared <video> plus a
// persistent monitor chain (elSourceNode → monitorGain → destination). The gain
// is the speaker volume; muting = gain 0. Created on first unmute OR first Live
// "source" use — whichever comes first. Returns false if Web Audio is missing.
function ensureVideoMonitor(v) {
  if (!ensureCtx()) return false;
  if (!elSourceNode) {
    try { elSourceNode = ctx.createMediaElementSource(v); } catch (_) { return false; }
    monitorGain = ctx.createGain();
    monitorGain.gain.value = 0;          // start silent; the mute toggle opens it
    elSourceNode.connect(monitorGain);
    monitorGain.connect(ctx.destination);
    monitorEl = v;
    v.muted = false;                     // audio is routed via WebAudio now; gain controls it
  }
  return true;
}

export function hasElementSource() { return !!elSourceNode; }

/** Mute/unmute the working video's audio (monitor gain). Returns false if it
 *  fell back to the element's own `muted` (no Web Audio). */
export function setVideoMuted(muted, v) {
  if (!ensureVideoMonitor(v)) { v.muted = muted; return false; }
  monitorGain.gain.value = muted ? 0 : 1;
  return true;
}

export function startElement(v) {
  if (!ensureCtx()) throw new Error('Web Audio not supported');
  detachAll();
  ensureVideoMonitor(v);                 // share the cached element source + monitor
  inputNode = elSourceNode;
  inputNode.connect(analyser);           // analysis tap; hearing is via the monitor gain
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
  return target > prev ? prev + (target - prev) * 0.6    // fast attack
                       : prev + (target - prev) * 0.2;   // medium release
}

/** Read the FFT and update the signal bus. Call once per frame while active. */
export function update(now) {
  if (!inputNode) return sig;
  analyser.getByteFrequencyData(freqData);
  const binHz = ctx.sampleRate / analyser.fftSize;
  const b = computeBands(freqData, binHz);

  // Raw band level × user Gain trim, clamped, then enveloped for a clean bounce.
  const shape = (raw, gain) => Math.min(1, raw * gain);
  sig.bass = env(sig.bass, shape(b.bass, cfg.gainBass));
  sig.mid = env(sig.mid, shape(b.mid, cfg.gainMid));
  sig.high = env(sig.high, shape(b.high, cfg.gainHigh));
  sig.level = env(sig.level, shape(b.level, cfg.gainLevel));

  // beat: flux onset on the raw bass level
  const t = now || performance.now();
  beatStep(beatState, b.bass, t, cfg.beatSens);
  sig.beat = beatState.env;
  return sig;
}
