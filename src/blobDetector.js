/**
 * Blob detection via grid-based local maxima.
 * Divides the frame into cells, picks the strongest pixel per cell.
 * Works on any video — no connectivity issues, always produces distributed blobs.
 *
 * Luma mode:  peaks in absolute brightness  (bright subjects on dark bg)
 * Motion mode: peaks in frame-to-frame diff (moving regions on any bg)
 */

let prevLum = null;

export function resetFrameHistory() {
  prevLum = null;
}

/**
 * @param {ImageData}          imageData
 * @param {number}             threshold  luma mode: brightness cutoff (0-255); motion: change delta
 * @param {number}             maxBlobs   max blobs to return
 * @param {'motion'|'luma'}    mode
 * @returns {Array<{x,y,w,h,cx,cy,area,score,index}>}
 */
export function detectBlobs(imageData, threshold, maxBlobs, mode = 'motion') {
  const { width, height, data } = imageData;
  const total = width * height;

  // Compute current luminance
  const curLum = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    curLum[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }

  // Build strength map
  const strength = new Float32Array(total);
  if (mode === 'luma') {
    for (let i = 0; i < total; i++) {
      strength[i] = curLum[i] > threshold ? curLum[i] : 0;
    }
  } else {
    // motion: frame difference
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

      if (maxVal > 0) candidates.push({ cx: maxX, cy: maxY, val: maxVal, cw, ch });
    }
  }

  // Sort by strength, take top maxBlobs
  candidates.sort((a, b) => b.val - a.val);
  const peaks = candidates.slice(0, maxBlobs);
  if (peaks.length === 0) return [];

  const maxVal = peaks[0].val;
  const hs = cellSize / 2;

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
