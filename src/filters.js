/**
 * Pixel filters applied to blob bounding-box regions WITHIN a full-frame
 * ImageData buffer. Caller does ONE getImageData on the full canvas, calls
 * applyFilterToSubregion() for each blob (sharing the buffer), then ONE
 * putImageData back. Avoids per-blob CPU↔GPU round-trips on the display
 * canvas (was 12-30 round-trips per frame, now 1).
 */

// Flat thermal LUT: 256 × 3 RGB bytes, packed for branch-free indexing.
// Avoids per-pixel array allocation that the old [r,g,b]-tuple LUT triggered.
export const THERMAL_LUT = new Uint8Array(256 * 3);
(() => {
  const stops = [
    [0,   [0,   0,   0]],
    [50,  [0,   102, 0]],
    [100, [0,   0,   255]],
    [150, [204, 0,   204]],
    [200, [255, 0,   102]],
    [255, [255, 255, 255]],
  ];
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  for (let v = 0; v < 256; v++) {
    let lo = stops[0], hi = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (v >= stops[s][0] && v <= stops[s + 1][0]) { lo = stops[s]; hi = stops[s + 1]; break; }
    }
    const t = lo[0] === hi[0] ? 0 : (v - lo[0]) / (hi[0] - lo[0]);
    THERMAL_LUT[v * 3]     = lerp(lo[1][0], hi[1][0], t);
    THERMAL_LUT[v * 3 + 1] = lerp(lo[1][1], hi[1][1], t);
    THERMAL_LUT[v * 3 + 2] = lerp(lo[1][2], hi[1][2], t);
  }
})();

/**
 * Apply filter in-place to a sub-region of a full-frame ImageData buffer,
 * optionally clipped to the inscribed shape (circle / diamond / rounded rect)
 * so the filtered area matches the overlay outline drawn on top.
 *
 * @param {Uint8ClampedArray} data    full canvas pixel buffer (length = fullW × fullH × 4)
 * @param {number}            fullW   full canvas width in pixels (stride = fullW × 4)
 * @param {number}            x, y    top-left of sub-region in pixels (must be ≥ 0)
 * @param {number}            w, h    sub-region size in pixels
 * @param {string}            filter  'inv' | 'thermal' (others are no-ops)
 * @param {string}            [shape] 'rect' | 'circle' | 'rounded' | 'diamond' (default: rect)
 */
export function applyFilterToSubregion(data, fullW, x, y, w, h, filter, shape) {
  if (filter === 'none' || (filter !== 'inv' && filter !== 'thermal')) return;
  if (w <= 0 || h <= 0) return;
  const stride = fullW * 4;

  // Hot path: rectangular region keeps the original tight loop with zero
  // per-row overhead. Vast majority of usage hits this branch.
  if (!shape || shape === 'rect') {
    const xEnd = x + w;
    const yEnd = y + h;
    if (filter === 'inv') {
      for (let yy = y; yy < yEnd; yy++) {
        let off = yy * stride + x * 4;
        const rowEnd = yy * stride + xEnd * 4;
        while (off < rowEnd) {
          data[off]     = 255 - data[off];
          data[off + 1] = 255 - data[off + 1];
          data[off + 2] = 255 - data[off + 2];
          off += 4;
        }
      }
    } else {
      for (let yy = y; yy < yEnd; yy++) {
        let off = yy * stride + x * 4;
        const rowEnd = yy * stride + xEnd * 4;
        while (off < rowEnd) {
          const r = data[off], g = data[off + 1], b = data[off + 2];
          const gray = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
          const lo = gray * 3;
          data[off]     = THERMAL_LUT[lo];
          data[off + 1] = THERMAL_LUT[lo + 1];
          data[off + 2] = THERMAL_LUT[lo + 2];
          off += 4;
        }
      }
    }
    return;
  }

  // Shape-clipped path: precompute per-row [xStart, xEnd] for the inscribed
  // shape once, then the inner pixel loop stays branch-free. Empty rows are
  // marked by xs >= xe so the loop below skips them in O(1).
  const rowXs = new Int32Array(h);
  const rowXe = new Int32Array(h);
  computeRowBounds(rowXs, rowXe, x, y, w, h, shape);

  if (filter === 'inv') {
    for (let i = 0; i < h; i++) {
      const xs = rowXs[i], xe = rowXe[i];
      if (xs >= xe) continue;
      const yy = y + i;
      let off = yy * stride + xs * 4;
      const rowEnd = yy * stride + xe * 4;
      while (off < rowEnd) {
        data[off]     = 255 - data[off];
        data[off + 1] = 255 - data[off + 1];
        data[off + 2] = 255 - data[off + 2];
        off += 4;
      }
    }
  } else {
    for (let i = 0; i < h; i++) {
      const xs = rowXs[i], xe = rowXe[i];
      if (xs >= xe) continue;
      const yy = y + i;
      let off = yy * stride + xs * 4;
      const rowEnd = yy * stride + xe * 4;
      while (off < rowEnd) {
        const r = data[off], g = data[off + 1], b = data[off + 2];
        const gray = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
        const lo = gray * 3;
        data[off]     = THERMAL_LUT[lo];
        data[off + 1] = THERMAL_LUT[lo + 1];
        data[off + 2] = THERMAL_LUT[lo + 2];
        off += 4;
      }
    }
  }
}

// Per-row x bounds for the inscribed shape, in absolute pixel coords.
// Math mirrors the path drawing in src/overlays.js so the filtered area lines
// up with the stroked outline. Pixel-center-sampled (yy + 0.5) for symmetry.
function computeRowBounds(rowXs, rowXe, x, y, w, h, shape) {
  const xEnd = x + w;

  if (shape === 'circle') {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rx = w / 2;
    const ry = h / 2;
    for (let i = 0; i < h; i++) {
      const dy = (y + i + 0.5) - cy;
      const t = 1 - (dy * dy) / (ry * ry);
      if (t <= 0) { rowXs[i] = 0; rowXe[i] = 0; continue; }
      const halfW = rx * Math.sqrt(t);
      rowXs[i] = Math.max(x,    Math.floor(cx - halfW));
      rowXe[i] = Math.min(xEnd, Math.ceil(cx + halfW));
    }
    return;
  }

  if (shape === 'diamond') {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const hw = w / 2;
    const hh = h / 2;
    for (let i = 0; i < h; i++) {
      const dy = Math.abs((y + i + 0.5) - cy);
      if (dy >= hh) { rowXs[i] = 0; rowXe[i] = 0; continue; }
      const halfW = hw * (1 - dy / hh);
      rowXs[i] = Math.max(x,    Math.floor(cx - halfW));
      rowXe[i] = Math.min(xEnd, Math.ceil(cx + halfW));
    }
    return;
  }

  if (shape === 'rounded') {
    // Corner radius matches drawRoundedRect() in overlays.js (hardcoded 6, clamped to half-extent).
    const r = Math.min(6, w / 2, h / 2);
    const yInnerTop = y + r;
    const yInnerBot = y + h - r;
    for (let i = 0; i < h; i++) {
      const yy = y + i;
      if (yy >= yInnerTop && yy < yInnerBot) {
        rowXs[i] = x; rowXe[i] = xEnd;
        continue;
      }
      const cyCorner = yy < yInnerTop ? (y + r) : (y + h - r);
      const dy = (yy + 0.5) - cyCorner;
      const t = r * r - dy * dy;
      if (t <= 0) { rowXs[i] = 0; rowXe[i] = 0; continue; }
      const inset = r - Math.sqrt(t);
      rowXs[i] = Math.max(x,    Math.floor(x + inset));
      rowXe[i] = Math.min(xEnd, Math.ceil(xEnd - inset));
    }
    return;
  }

  // Fallback: full rect (caller hits the hot path above for rect normally).
  for (let i = 0; i < h; i++) {
    rowXs[i] = x;
    rowXe[i] = xEnd;
  }
}
