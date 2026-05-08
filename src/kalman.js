/**
 * Kalman filter blob tracker.
 * Each tracked blob has independent 1D Kalman filters for x and y.
 * State per axis: [position, velocity]. Measurement: position only.
 * Nearest-neighbor data association matches detections to trackers each frame.
 */

// ---- 1D Kalman filter (position + velocity) ----

class Kalman1D {
  constructor(pos, processNoise = 0.5, measurementNoise = 25) {
    this.pos = pos;
    this.vel = 0;
    this.Ppp = 100; // position variance
    this.Ppv = 0;   // position-velocity covariance
    this.Pvv = 10;  // velocity variance
    this.q   = processNoise;
    this.r   = measurementNoise;
  }

  predict() {
    // F = [[1,1],[0,1]]  (constant velocity)
    this.pos += this.vel;
    const { Ppp, Ppv, Pvv, q } = this;
    this.Ppp = Ppp + 2 * Ppv + Pvv + q;
    this.Ppv = Ppv + Pvv;
    this.Pvv = Pvv + q;
  }

  update(measurement) {
    // H = [1, 0]
    const S  = this.Ppp + this.r;
    const Kp = this.Ppp / S;
    const Kv = this.Ppv / S;
    const inn = measurement - this.pos;

    this.pos += Kp * inn;
    this.vel += Kv * inn;

    // P = (I - K*H)*P  with K*H = [[Kp,0],[Kv,0]]
    const pp = this.Ppp, pv = this.Ppv, vv = this.Pvv;
    this.Ppp = (1 - Kp) * pp;
    this.Ppv = (1 - Kp) * pv;
    this.Pvv = -Kv * pv + vv;
  }
}

// ---- Single blob tracker ----

let _nextId = 0;

class BlobTracker {
  constructor(blob) {
    this.kx  = new Kalman1D(blob.cx);
    this.ky  = new Kalman1D(blob.cy);
    this.kw  = new Kalman1D(blob.w,  0.1, 10);
    this.kh  = new Kalman1D(blob.h,  0.1, 10);
    this.lastBlob = blob;
    this.missed   = 0;
    this.age      = 0;
    this.id       = _nextId++;
  }

  predict() {
    this.kx.predict();
    this.ky.predict();
    this.kw.predict();
    this.kh.predict();
    this.missed++;
    this.age++;
  }

  update(blob) {
    this.kx.update(blob.cx);
    this.ky.update(blob.cy);
    this.kw.update(blob.w);
    this.kh.update(blob.h);
    this.lastBlob = blob;
    this.missed = 0;
  }

  toBlob(index) {
    const cx = this.kx.pos;
    const cy = this.ky.pos;
    const w  = Math.max(8, this.kw.pos);
    const h  = Math.max(8, this.kh.pos);
    return {
      x:     cx - w / 2,
      y:     cy - h / 2,
      w,
      h,
      cx,
      cy,
      area:  this.lastBlob.area,
      score: this.lastBlob.score,
      index,
      id:    this.id,
    };
  }
}

// ---- Tracker pool ----

const trackers = [];

export function resetTracker() {
  trackers.length = 0;
}

/**
 * Takes raw detected blobs for the current frame, runs Kalman prediction +
 * nearest-neighbour association + update, returns smoothed blobs.
 *
 * @param {Array} detectedBlobs  raw blobs from blobDetector
 * @param {number} canvasW       used to scale association distance threshold
 * @param {number} maxBlobs
 * @returns {Array} smoothed blobs in same format as blobDetector output
 */
export function trackBlobs(detectedBlobs, canvasW = 500, maxBlobs = 30) {
  const MAX_MISSED = 6;
  const MAX_DIST   = canvasW * 0.25; // 25% of canvas width

  // Predict all existing trackers forward one step
  for (const t of trackers) t.predict();

  // Nearest-neighbour association
  const usedDetections = new Set();

  for (const tracker of trackers) {
    let bestDist = MAX_DIST;
    let bestIdx  = -1;

    for (let i = 0; i < detectedBlobs.length; i++) {
      if (usedDetections.has(i)) continue;
      const b  = detectedBlobs[i];
      const dx = tracker.kx.pos - b.cx;
      const dy = tracker.ky.pos - b.cy;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }

    if (bestIdx !== -1) {
      tracker.update(detectedBlobs[bestIdx]);
      usedDetections.add(bestIdx);
    }
  }

  // Spawn new trackers for unmatched detections
  for (let i = 0; i < detectedBlobs.length; i++) {
    if (!usedDetections.has(i)) {
      trackers.push(new BlobTracker(detectedBlobs[i]));
    }
  }

  // Cull stale trackers
  for (let i = trackers.length - 1; i >= 0; i--) {
    if (trackers[i].missed > MAX_MISSED) trackers.splice(i, 1);
  }

  // Return smoothed blobs from active trackers, sorted by score
  return trackers
    .filter(t => t.age > 0)
    .sort((a, b) => b.lastBlob.score - a.lastBlob.score)
    .slice(0, maxBlobs)
    .map((t, i) => t.toBlob(i));
}
