/**
 * Blob detection via grid-based local maxima.
 * Divides the frame into cells, picks the strongest pixel per cell.
 * Works on any video — no connectivity issues, always produces distributed blobs.
 *
 * Modes (each builds the per-pixel `strength` field that feeds the same
 * grid + top-N pipeline; nothing else changes per mode):
 *
 *   motion  peaks in |current - previous| luma frame diff
 *           (anything moving; goes blind on paused / static video)
 *   luma    peaks in absolute brightness above threshold
 *           (bright subjects on dark bg; static-friendly)
 *   dark    peaks in absolute darkness  (255 - lum) above threshold
 *           (silhouettes against bright bg; mirror of luma)
 *   sat     peaks in chroma (max(r,g,b) - min(r,g,b)) above threshold
 *           (vivid color regions; ignores brightness)
 *   edge    peaks in Sobel gradient magnitude (L1: |gx|+|gy|)
 *           (boundaries / corners / text; static-friendly)
 *   sharp   peaks in 3x3 Laplacian magnitude
 *           (high-frequency detail / focused regions)
 *
 * Modes that don't need previous-frame data (everything except motion)
 * keep producing blobs while video is paused.
 */

let prevLum = null;

export function resetFrameHistory() {
  prevLum = null;
}

// Color-key target for 'color' mode. Set via setColorKeyTarget(r,g,b).
// Stored as HSV so the match test is a simple range check on hue + saturation.
let _colorKey = null;  // null = no key set

/**
 * Set the HSV color key target from an RGB triple (0–255 each).
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} hueTol   hue tolerance in degrees (0–180), default 18
 * @param {number} satMin   minimum saturation (0–1) to accept, default 0.25
 * @param {number} valMin   minimum value (0–1) to accept, default 0.10
 */
export function setColorKeyTarget(r, g, b, hueTol = 18, satMin = 0.25, valMin = 0.10) {
  const rN = r / 255, gN = g / 255, bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const delta = max - min;
  let hue = 0;
  if (delta > 1e-6) {
    if (max === rN)      hue = 60 * (((gN - bN) / delta) % 6);
    else if (max === gN) hue = 60 * ((bN - rN) / delta + 2);
    else                 hue = 60 * ((rN - gN) / delta + 4);
    if (hue < 0) hue += 360;
  }
  _colorKey = { hue, sat: max > 1e-6 ? delta / max : 0, val: max, hueTol, satMin, valMin };
}

export function clearColorKeyTarget() {
  _colorKey = null;
}

/**
 * @param {ImageData}                                             imageData
 * @param {number}                                                threshold  per-mode cutoff
 * @param {number}                                                maxBlobs   max blobs to return
 * @param {'motion'|'luma'|'dark'|'sat'|'edge'|'sharp'|'color'}    mode
 * @param {number}                                                minSize    minimum blob bbox side in source pixels. 0 disables.
 * @returns {Array<{x,y,w,h,cx,cy,area,score,index}>}
 */
export function detectBlobs(imageData, threshold, maxBlobs, mode = 'motion', minSize = 0) {
  const { width, height, data } = imageData;
  const total = width * height;

  // Always compute luma — every mode either uses it directly or as the basis
  // for a derived field (Sobel / Laplacian / motion diff).
  const curLum = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    curLum[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }

  const strength = new Float32Array(total);

  if (mode === 'luma') {
    for (let i = 0; i < total; i++) {
      strength[i] = curLum[i] > threshold ? curLum[i] : 0;
    }
  } else if (mode === 'dark') {
    // Inverse of luma: tracks silhouettes against bright backgrounds.
    for (let i = 0; i < total; i++) {
      const inv = 255 - curLum[i];
      strength[i] = inv > threshold ? inv : 0;
    }
  } else if (mode === 'sat') {
    // Absolute chroma (HSV-ish saturation in 0-255 absolute units).
    // Avoids the dark-pixel noise problem of relative saturation
    // ((max-min)/max blows up for tiny max). Inline min/max instead of
    // Math.max(...) to skip the function-call overhead in the hot loop.
    for (let i = 0; i < total; i++) {
      const p = i * 4;
      const r = data[p], g = data[p + 1], b = data[p + 2];
      const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const chroma = max - min;
      strength[i] = chroma > threshold ? chroma : 0;
    }
  } else if (mode === 'edge') {
    // Sobel 3x3 gradient on luma. L1 norm (|gx|+|gy|) instead of sqrt — the
    // grid local-maxima step only needs a ranking, not exact magnitudes,
    // and L1 is ~3x cheaper. Skip the 1-pixel border to avoid bounds checks.
    for (let y = 1; y < height - 1; y++) {
      const rowOff = y * width;
      for (let x = 1; x < width - 1; x++) {
        const i = rowOff + x;
        const tl = curLum[i - width - 1], t = curLum[i - width], tr = curLum[i - width + 1];
        const l  = curLum[i - 1],                                r  = curLum[i + 1];
        const bl = curLum[i + width - 1], b = curLum[i + width], br = curLum[i + width + 1];
        const gx = -tl - 2 * l - bl + tr + 2 * r + br;
        const gy = -tl - 2 * t - tr + bl + 2 * b + br;
        const mag = (gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy);
        strength[i] = mag > threshold ? mag : 0;
      }
    }
  } else if (mode === 'sharp') {
    // Discrete 3x3 Laplacian (4-neighbor): |4·c - n - s - e - w|. Highlights
    // high-frequency content; tends to favor focused regions over blurred
    // ones because focus = sharper second-derivative response. Visually
    // distinct from Sobel on real footage even though they overlap on hard
    // edges (Sharp picks up texture detail Sobel mutes).
    for (let y = 1; y < height - 1; y++) {
      const rowOff = y * width;
      for (let x = 1; x < width - 1; x++) {
        const i = rowOff + x;
        const lap = 4 * curLum[i] - curLum[i - width] - curLum[i + width] - curLum[i - 1] - curLum[i + 1];
        const mag = lap < 0 ? -lap : lap;
        strength[i] = mag > threshold ? mag : 0;
      }
    }
  } else if (mode === 'color' && _colorKey) {
    // HSV color-keying: match pixels within hue+sat+val tolerance of the
    // target color. strength = saturation*value of matched pixels (so
    // brighter, more vivid matches score higher in the grid).
    const { hue: tH, hueTol, satMin, valMin } = _colorKey;
    for (let i = 0; i < total; i++) {
      const p = i * 4;
      const rN = data[p] / 255, gN = data[p + 1] / 255, bN = data[p + 2] / 255;
      const max = rN > gN ? (rN > bN ? rN : bN) : (gN > bN ? gN : bN);
      const min = rN < gN ? (rN < bN ? rN : bN) : (gN < bN ? gN : bN);
      const delta = max - min;
      const sat = max > 1e-6 ? delta / max : 0;
      if (sat < satMin || max < valMin) continue;
      let hue = 0;
      if (delta > 1e-6) {
        if (max === rN)      hue = 60 * (((gN - bN) / delta) % 6);
        else if (max === gN) hue = 60 * ((bN - rN) / delta + 2);
        else                 hue = 60 * ((rN - gN) / delta + 4);
        if (hue < 0) hue += 360;
      }
      let hueDiff = Math.abs(hue - tH);
      if (hueDiff > 180) hueDiff = 360 - hueDiff;
      if (hueDiff <= hueTol) {
        strength[i] = sat * max * 255;
      }
    }
  } else {
    // motion (default): |current - previous| frame diff. Requires a
    // previous-frame buffer; first frame after a mode change or source
    // switch produces zero blobs until prevLum primes on the next frame.
    if (prevLum && prevLum.length === total) {
      for (let i = 0; i < total; i++) {
        const diff = Math.abs(curLum[i] - prevLum[i]);
        strength[i] = diff > threshold ? diff : 0;
      }
    }
  }

  prevLum = curLum;

  // Grid: cell size derived from desired blob count
  // Use finer grid (×2 cells) then take top N by strength
  const cellSize = Math.max(8, Math.floor(Math.min(width, height) / Math.sqrt(maxBlobs * 3)));
  const candidates = [];

  for (let cy = 0; cy < height; cy += cellSize) {
    for (let cx = 0; cx < width; cx += cellSize) {
      const cw = Math.min(cellSize, width  - cx);
      const ch = Math.min(cellSize, height - cy);

      let maxVal = 0, maxX = cx + cw / 2, maxY = cy + ch / 2;

      for (let y = cy; y < cy + ch; y++) {
        for (let x = cx; x < cx + cw; x++) {
          const v = strength[y * width + x];
          if (v > maxVal) { maxVal = v; maxX = x; maxY = y; }
        }
      }

      if (maxVal > 0) {
        // Sub-pixel parabolic peak refinement. Fit a 1D parabola through
        // strength[maxX-1, maxX, maxX+1] (and same for Y), use the analytic
        // vertex offset to get a fractional center inside the cell.
        //   offset = 0.5 * (s[-1] - s[+1]) / (s[-1] - 2*s[0] + s[+1])
        // Kills integer-pixel quantization that makes detected centers hop
        // ±1 cell between frames even when the real blob barely moved.
        // Skip when peak is on frame border or denominator is ~0 (flat region).
        let subX = maxX, subY = maxY;
        if (maxX > 0 && maxX < width - 1) {
          const sL = strength[maxY * width + (maxX - 1)];
          const sR = strength[maxY * width + (maxX + 1)];
          const denom = sL - 2 * maxVal + sR;
          if (denom < -1e-6) {
            let off = 0.5 * (sL - sR) / denom;
            if (off >  0.5) off =  0.5;
            if (off < -0.5) off = -0.5;
            subX = maxX + off;
          }
        }
        if (maxY > 0 && maxY < height - 1) {
          const sU = strength[(maxY - 1) * width + maxX];
          const sD = strength[(maxY + 1) * width + maxX];
          const denom = sU - 2 * maxVal + sD;
          if (denom < -1e-6) {
            let off = 0.5 * (sU - sD) / denom;
            if (off >  0.5) off =  0.5;
            if (off < -0.5) off = -0.5;
            subY = maxY + off;
          }
        }
        candidates.push({ cx: subX, cy: subY, val: maxVal, cw, ch });
      }
    }
  }

  // Sort by strength, take top maxBlobs
  candidates.sort((a, b) => b.val - a.val);
  const peaks = candidates.slice(0, maxBlobs);
  if (peaks.length === 0) return [];

  const maxVal = peaks[0].val;
  const hs = cellSize / 2;

  // Min-size filter: drop blobs whose cell side is smaller than minSize px.
  // minSize=0 disables.
  const passSize = (minSize <= 0) || (cellSize >= minSize);
  if (!passSize) return [];

  return peaks.map((p, i) => ({
    x:     p.cx - hs,
    y:     p.cy - hs,
    w:     cellSize,
    h:     cellSize,
    cx:    p.cx,
    cy:    p.cy,
    area:  cellSize * cellSize,
    score: maxVal > 0 ? p.val / maxVal : 0,
    index: i,
  }));
}
