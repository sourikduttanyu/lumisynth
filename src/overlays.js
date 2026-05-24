/**
 * BlobTracking overlay renderer — implements PRODUCT_SPEC_LumiSynth's
 * BlobTracking section: Shape × Lines × Effects on top of detected blobs.
 *
 *   SHAPE (4):    solid rect | hollow rect | dotted rect | corner brackets
 *   LINES (8):    off | distance threshold | velocity trails | pulse trail | constellation | mst | star | hub curves
 *   EFFECTS (3):  echo blobs | radar sweep | heatmap residue   (stack 0–3)
 *
 * All control values come in via the opts bag — this module is stateless
 * EXCEPT for two persistent buffers it owns:
 *
 *   1. Per-blob position history (Map<id, Array<{cx,cy,w,h,t}>>) for
 *      velocity trails + echo blobs. Capped at HISTORY_MAX entries per id.
 *   2. Heatmap residue accumulator (offscreen canvas) that decays each
 *      frame. Re-allocated on canvas resize.
 *
 * Buffers are owned here (not main.js) because they are 1:1 with the
 * overlays they feed and lifetime-coupled to source switches via
 * resetTrackOverlay().
 */

// ---- Shared helpers ----

// Hue knob → CSS rgba string. Per spec: "At 0 white, scrolls through full
// hue range to 1." We implement: t<0.01 → white; t∈[0.01,1] → fully
// saturated HSL color at hue t*360°. The discontinuity at 0 is by design
// — the spec explicitly anchors 0 to white.
function hueToRgba(t, alpha = 1) {
  if (t <= 0.01) return `rgba(255,255,255,${alpha})`;
  const h = t * 360;
  const s = 90;
  const l = 60;
  // hsl→rgb (no chroma helpers, do it inline)
  const sN = s / 100, lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if      (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else             { r = c; b = x; }
  const m = lN - c / 2;
  const R = Math.round((r + m) * 255);
  const G = Math.round((g + m) * 255);
  const B = Math.round((b + m) * 255);
  return `rgba(${R},${G},${B},${alpha})`;
}

// ---- Persistent state (per-source lifetime) ----

// Per-blob trail history. Updated each frame from current blobs; used by
// VELOCITY trails and ECHO blobs effect. Cap is HISTORY_MAX so memory
// doesn't grow unbounded; oldest entry pushed off when full.
const _history = new Map();   // id → [{cx, cy, w, h, t}, ...] (newest last)
const HISTORY_MAX = 60;       // ~1 second at 60 fps; long enough for trails up to that length

// Heatmap residue accumulator. Lazily allocated, re-allocated when the
// frame size changes. Owned here so resetTrackOverlay() can blow it away.
let _heatCanvas = null;
let _heatCtx    = null;
let _hubPoint   = null;

function ensureHeatCanvas(w, h) {
  if (_heatCanvas && _heatCanvas.width === w && _heatCanvas.height === h) return;
  _heatCanvas = document.createElement('canvas');
  _heatCanvas.width = w;
  _heatCanvas.height = h;
  _heatCtx = _heatCanvas.getContext('2d', { willReadFrequently: false });
}

// Frame counter for time-based effects (radar sweep angle, pulse trail
// dot phase). Bumped once per drawTrackOverlay call.
let _frameCounter = 0;

export function resetTrackOverlay() {
  _history.clear();
  if (_heatCtx && _heatCanvas) _heatCtx.clearRect(0, 0, _heatCanvas.width, _heatCanvas.height);
  _frameCounter = 0;
  _hubPoint = null;
}

// ---- Public entry point ----

/**
 * Draw the BlobTracking overlay on `ctx`. Caller is responsible for
 * compositing (overlay vs isolated) — this just paints onto whatever ctx
 * it's given.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array}                   blobs    tracked blobs (with .id .cx .cy .w .h)
 * @param {number}                  cw, ch
 * @param {object}                  opts
 *   {
 *     shape:   { type, hueColor, thickness, padding, styleParam },
 *     lines:   { type, hueColor, thickness, param, taper },
 *     effects: [{ type, params: {...} }, ...]   // 0-3, in render order
 *     labels:  { show, markerStyle, fontSize, hueColor }   // Tracery-style XY coords + center marker
 *   }
 */
export function drawTrackOverlay(ctx, blobs, cw, ch, opts) {
  _frameCounter++;

  // Update per-blob position history with this frame's tracked blobs.
  // We do this BEFORE rendering so velocity trails / echo include the
  // current frame as the newest sample (continuous trails).
  const now = _frameCounter;
  const seen = new Set();
  for (const b of blobs) {
    seen.add(b.id);
    let arr = _history.get(b.id);
    if (!arr) { arr = []; _history.set(b.id, arr); }
    arr.push({ cx: b.cx, cy: b.cy, w: b.w, h: b.h, t: now });
    if (arr.length > HISTORY_MAX) arr.shift();
  }
  // Drop history for blobs that haven't been seen for HISTORY_MAX frames
  // — prevents stale ids from accumulating forever (kalman occasionally
  // recycles ids via cull/respawn; without GC the map only grows).
  for (const [id, arr] of _history) {
    const last = arr[arr.length - 1];
    if (!seen.has(id) && now - last.t > HISTORY_MAX) _history.delete(id);
  }

  // ---- Effects: BACKGROUND pass (radar arc, heatmap field) ----
  // These render UNDER shapes/lines so the tracked blobs sit on top of
  // their own residue. echo blobs is also background-ish (past frames
  // behind the current bbox), but it depends on shape rendering for
  // the bracket/dotted look — handled in the shapes pass below as a
  // pre-shape draw of past positions in the current shape.
  for (const eff of opts.effects) {
    if (eff.type === 'heatmap') drawHeatmapResidue(ctx, blobs, cw, ch, eff.params);
    if (eff.type === 'radar')   drawRadarSweepBg(ctx, cw, ch, eff.params);
  }

  // ---- Lines (under shapes so shapes draw on top of line endpoints) ----
  if (opts.lines.type !== 'off' && blobs.length > 0) {
    drawLines(ctx, blobs, opts.lines, cw, ch);
  }

  // ---- Shapes (with optional echo-blob ghosts behind the live shape) ----
  // Per spec, Echo Blobs renders the same shape style as the live blob,
  // just at past positions with falling opacity. We loop the echo first
  // so each frame's draw stack is: oldest echo → … → newest echo → live.
  const echoEff = opts.effects.find(e => e.type === 'echo');
  if (echoEff) drawEchoBlobs(ctx, blobs, opts.shape, echoEff.params);
  drawShapes(ctx, blobs, opts.shape);

  // ---- Effects: FOREGROUND pass (radar reveal mask) ----
  // Radar's "blobs only visible while sweep crosses them" effect needs to
  // gate the shapes/lines we just drew — but a true mask is expensive on
  // 2D ctx. Instead we draw a darkening fill over the not-yet-swept side
  // (alpha proportional to TRAIL knob), giving the same read.
  for (const eff of opts.effects) {
    if (eff.type === 'radar') drawRadarSweepFg(ctx, cw, ch, eff.params);
  }

  // ---- Labels + center markers (topmost so they read over everything) ----
  if (opts.labels && opts.labels.show) {
    drawLabelsAndMarkers(ctx, blobs, opts.labels);
  }
}

// ============================================================
// SHAPES
// ============================================================

function drawShapes(ctx, blobs, S) {
  const stroke = hueToRgba(S.hueColor, 1);
  ctx.save();
  ctx.lineWidth = S.thickness;
  ctx.strokeStyle = stroke;
  ctx.fillStyle   = stroke;
  for (const b of blobs) {
    drawOneShape(ctx, b, S);
  }
  ctx.restore();
}

// Apply padding around the bbox. Negative shrinks inside. Result clamped
// to a minimum 4×4 box so very-small blobs don't invert.
function paddedBBox(b, padding) {
  const w = Math.max(4, b.w + padding * 2);
  const h = Math.max(4, b.h + padding * 2);
  const x = b.cx - w / 2;
  const y = b.cy - h / 2;
  return { x, y, w, h };
}

function drawOneShape(ctx, b, S) {
  const { x, y, w, h } = paddedBBox(b, S.padding);
  switch (S.type) {
    case 'solid': {
      // styleParam = OPACITY. Filled rect with rgba alpha override; reset
      // after the draw so other shapes / lines keep their own alpha.
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = prevAlpha * Math.max(0.05, S.styleParam);
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = prevAlpha;
      break;
    }
    case 'hollow': {
      // styleParam = OUTER GLOW. We approximate with a faint second
      // stroke at +N px outside, alpha falling with distance.
      ctx.strokeRect(x, y, w, h);
      if (S.styleParam > 0.02) {
        const glowSize = S.styleParam * 6;
        const prevAlpha = ctx.globalAlpha;
        ctx.globalAlpha = prevAlpha * S.styleParam * 0.4;
        ctx.lineWidth = S.thickness + glowSize;
        ctx.strokeRect(x, y, w, h);
        ctx.lineWidth = S.thickness;
        ctx.globalAlpha = prevAlpha;
      }
      break;
    }
    case 'dotted': {
      // styleParam = DOT SIZE (1–6 px). Dots placed at fixed pitch around
      // the perimeter so the rectangle reads as continuous regardless of
      // bbox aspect.
      const dotSize = 1 + S.styleParam * 5;
      const pitch   = Math.max(dotSize * 2, 6);
      drawDottedRect(ctx, x, y, w, h, dotSize, pitch);
      break;
    }
    case 'corners': {
      // styleParam = BRACKET LENGTH (fraction of bbox half-side).
      const len = Math.max(6, Math.min(w, h) * 0.5 * S.styleParam);
      drawCornerBrackets(ctx, x, y, w, h, len);
      break;
    }
  }
}

function drawDottedRect(ctx, x, y, w, h, dotSize, pitch) {
  const r = dotSize / 2;
  // Top + Bottom edges
  for (let cx = x; cx <= x + w + 0.5; cx += pitch) {
    ctx.beginPath(); ctx.arc(cx, y,     r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, y + h, r, 0, Math.PI * 2); ctx.fill();
  }
  // Left + Right edges (skip corners — already drawn above)
  for (let cy = y + pitch; cy <= y + h - 0.5; cy += pitch) {
    if (cy >= y + h) break;
    ctx.beginPath(); ctx.arc(x,     cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + w, cy, r, 0, Math.PI * 2); ctx.fill();
  }
}

function drawCornerBrackets(ctx, x, y, w, h, len) {
  // Four [ ] brackets, one per corner. Length is clamped earlier.
  ctx.beginPath();
  // Top-left
  ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
  // Top-right
  ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
  // Bottom-right
  ctx.moveTo(x + w, y + h - len); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - len, y + h);
  // Bottom-left
  ctx.moveTo(x + len, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - len);
  ctx.stroke();
}

// ============================================================
// LINES
// ============================================================

function drawLines(ctx, blobs, L, cw, ch) {
  const baseColor = hueToRgba(L.hueColor, 1);
  ctx.save();
  ctx.lineWidth = L.thickness;
  ctx.strokeStyle = baseColor;
  switch (L.type) {
    case 'distthresh':    drawDistThresh(ctx, blobs, L);    break;
    case 'velocity':      drawVelocityTrails(ctx, blobs, L); break;
    case 'pulse':         drawPulseTrail(ctx, blobs, L);    break;
    case 'constellation': drawConstellation(ctx, blobs, L); break;
    case 'mst':           drawMST(ctx, blobs, L);           break;
    case 'star':          drawStar(ctx, blobs, L);          break;
    case 'hubcurve':      drawHubCurves(ctx, blobs, L, cw, ch); break;
  }
  ctx.restore();
}

// Helper: optionally taper a single segment as a thin polygon when L.taper > 0.
// Otherwise stroke a normal line. ctx state already has lineWidth + strokeStyle.
function strokeSegment(ctx, x1, y1, x2, y2, L) {
  if (L.taper <= 0.01) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    return;
  }
  // Tapered: build a quad from thick (start) to thin (end). Width at
  // start = thickness; end width = thickness * (1 - taper).
  const wStart = L.thickness;
  const wEnd   = L.thickness * (1 - L.taper);
  const dx = x2 - x1, dy = y2 - y1;
  const dlen = Math.hypot(dx, dy) || 1;
  const nx = -dy / dlen, ny = dx / dlen;
  ctx.beginPath();
  ctx.moveTo(x1 + nx * wStart / 2, y1 + ny * wStart / 2);
  ctx.lineTo(x2 + nx * wEnd   / 2, y2 + ny * wEnd   / 2);
  ctx.lineTo(x2 - nx * wEnd   / 2, y2 - ny * wEnd   / 2);
  ctx.lineTo(x1 - nx * wStart / 2, y1 - ny * wStart / 2);
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
}

function quadraticPoint(x0, y0, cx, cy, x1, y1, t) {
  const inv = 1 - t;
  return {
    x: inv * inv * x0 + 2 * inv * t * cx + t * t * x1,
    y: inv * inv * y0 + 2 * inv * t * cy + t * t * y1,
  };
}

function strokeQuadraticCurve(ctx, x0, y0, cx, cy, x1, y1, L) {
  if (L.taper <= 0.01) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(cx, cy, x1, y1);
    ctx.stroke();
    return;
  }

  const segments = 18;
  const prevWidth = ctx.lineWidth;
  for (let i = 1; i <= segments; i++) {
    const t0 = (i - 1) / segments;
    const t1 = i / segments;
    const p0 = quadraticPoint(x0, y0, cx, cy, x1, y1, t0);
    const p1 = quadraticPoint(x0, y0, cx, cy, x1, y1, t1);
    ctx.lineWidth = Math.max(0.25, L.thickness * (1 - L.taper * t1));
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
  ctx.lineWidth = prevWidth;
}

function estimateHub(blobs, cw, ch) {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (const b of blobs) {
    const areaWeight = Math.sqrt(Math.max(1, b.area || b.w * b.h || 1));
    const scoreWeight = 0.5 + Math.max(0, b.score || 0);
    const weight = areaWeight * scoreWeight;
    sx += b.cx * weight;
    sy += b.cy * weight;
    sw += weight;
  }
  if (sw <= 0) return null;

  let x = sx / sw;
  let y = sy / sw;

  // Sparse detections make a centroid unstable; pull gently toward frame
  // center until enough blobs define their own reliable hub.
  const pull = blobs.length === 1 ? 0.65 : blobs.length === 2 ? 0.25 : 0;
  if (pull > 0) {
    x = x * (1 - pull) + (cw / 2) * pull;
    y = y * (1 - pull) + (ch / 2) * pull;
  }

  if (!_hubPoint) {
    _hubPoint = { x, y };
  } else {
    const alpha = 0.14;
    _hubPoint.x += (x - _hubPoint.x) * alpha;
    _hubPoint.y += (y - _hubPoint.y) * alpha;
  }
  return _hubPoint;
}

function drawDistThresh(ctx, blobs, L) {
  // param = max connect distance, 50–500 px.
  const maxDist = 50 + L.param * 450;
  for (let i = 0; i < blobs.length; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      const a = blobs[i], b = blobs[j];
      const dx = a.cx - b.cx, dy = a.cy - b.cy;
      const d = Math.hypot(dx, dy);
      if (d <= maxDist) strokeSegment(ctx, a.cx, a.cy, b.cx, b.cy, L);
    }
  }
}

function drawVelocityTrails(ctx, blobs, L) {
  // param = trail length, 0–1 mapped to fraction of HISTORY_MAX.
  // Each blob trails its own past path. No inter-blob connections.
  const trailFrames = Math.max(2, Math.floor(L.param * HISTORY_MAX));
  for (const b of blobs) {
    const arr = _history.get(b.id);
    if (!arr || arr.length < 2) continue;
    const start = Math.max(0, arr.length - trailFrames);
    // Fade older segments by drawing each segment with descending alpha.
    for (let k = start + 1; k < arr.length; k++) {
      const p0 = arr[k - 1], p1 = arr[k];
      const segAge = arr.length - k;            // 0 = newest segment
      const alpha = 1 - (segAge / trailFrames);
      ctx.strokeStyle = hueToRgba(L.hueColor, Math.max(0.05, alpha));
      strokeSegment(ctx, p0.cx, p0.cy, p1.cx, p1.cy, L);
    }
  }
}

function drawPulseTrail(ctx, blobs, L) {
  // Same connections as DistThresh, plus a bright dot traveling A→B
  // periodically. param = pulse speed (0 = slow, 1 = fast).
  const maxDist = 50 + L.param * 450;
  // Dot phase tied to frame counter; speed scales the per-frame increment.
  const phase = (_frameCounter * (0.005 + L.param * 0.05)) % 1;
  ctx.strokeStyle = hueToRgba(L.hueColor, 0.55);
  for (let i = 0; i < blobs.length; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      const a = blobs[i], b = blobs[j];
      const dx = a.cx - b.cx, dy = a.cy - b.cy;
      const d = Math.hypot(dx, dy);
      if (d > maxDist) continue;
      strokeSegment(ctx, a.cx, a.cy, b.cx, b.cy, L);
      // Pulse dot — bright cap at the line's current phase. Slight glow via
      // a second translucent ring around the bright core.
      const px = a.cx + (b.cx - a.cx) * phase;
      const py = a.cy + (b.cy - a.cy) * phase;
      const r = Math.max(2, L.thickness * 1.8);
      ctx.fillStyle = hueToRgba(L.hueColor, 1);
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = hueToRgba(L.hueColor, 0.25);
      ctx.beginPath(); ctx.arc(px, py, r * 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawConstellation(ctx, blobs, L) {
  // Connect every blob to every other; line opacity falls off with distance.
  // param = falloff curve (0 = linear, 1 = sharp). We use exponent =
  // 1 + param*4 so 0 ≈ linear, 1 ≈ steep cubic-ish drop.
  const exponent = 1 + L.param * 4;
  // Compute a reference distance (max pair distance) once so opacity is
  // normalized per-frame instead of guessing absolute pixels.
  let maxD = 1;
  for (let i = 0; i < blobs.length; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      const dx = blobs[i].cx - blobs[j].cx, dy = blobs[i].cy - blobs[j].cy;
      const d = Math.hypot(dx, dy);
      if (d > maxD) maxD = d;
    }
  }
  for (let i = 0; i < blobs.length; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      const a = blobs[i], b = blobs[j];
      const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      const t = d / maxD;
      const alpha = Math.pow(1 - t, exponent);
      if (alpha < 0.02) continue;
      ctx.strokeStyle = hueToRgba(L.hueColor, alpha);
      strokeSegment(ctx, a.cx, a.cy, b.cx, b.cy, L);
    }
  }
}

// Hub Curves — general center-to-blob topology. The hub is a smoothed,
// weighted centroid of the current tracked blobs, not an object-specific
// detector. param = curve amount; taper narrows the spokes toward endpoints.
function drawHubCurves(ctx, blobs, L, cw, ch) {
  if (blobs.length < 1) return;
  const hub = estimateHub(blobs, cw, ch);
  if (!hub) return;

  const curveAmount = 0.08 + L.param * 0.36;
  const alpha = 0.82;
  ctx.strokeStyle = hueToRgba(L.hueColor, alpha);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 0; i < blobs.length; i++) {
    const b = blobs[i];
    const dx = b.cx - hub.x;
    const dy = b.cy - hub.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) continue;

    const mx = hub.x + dx * 0.52;
    const my = hub.y + dy * 0.52;
    const nx = -dy / d;
    const ny = dx / d;
    const bend = d * curveAmount;
    const controlX = mx + nx * bend;
    const controlY = my + ny * bend;

    strokeQuadraticCurve(ctx, hub.x, hub.y, controlX, controlY, b.cx, b.cy, L);
  }

  const r = Math.max(3, L.thickness * 2.5);
  ctx.fillStyle = hueToRgba(L.hueColor, Math.min(1, alpha + 0.2));
  ctx.beginPath();
  ctx.arc(hub.x, hub.y, r, 0, Math.PI * 2);
  ctx.fill();
}

// ============================================================
// LABELS + CENTER MARKERS (Tracery-style XY readouts)
// ============================================================

// Center-marker styles:
//   'dot'   — filled circle
//   'plus'  — +  crosshair (no diagonal)
//   'cross' — × crosshair (diagonal)
function drawLabelsAndMarkers(ctx, blobs, L) {
  if (!blobs.length) return;
  const color   = hueToRgba(L.hueColor, 0.9);
  const fsize   = Math.max(8, Math.min(16, L.fontSize || 10));
  const mStyle  = L.markerStyle || 'dot';
  const armLen  = fsize * 0.7;
  const pad     = 4;

  ctx.save();
  ctx.font      = `${fsize}px "Inter", monospace`;
  ctx.textAlign = 'left';

  for (const b of blobs) {
    const cx = b.cx, cy = b.cy;

    // Center marker
    ctx.strokeStyle = color;
    ctx.fillStyle   = color;
    ctx.lineWidth   = 1.5;
    if (mStyle === 'dot') {
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (mStyle === 'plus') {
      ctx.beginPath();
      ctx.moveTo(cx - armLen, cy); ctx.lineTo(cx + armLen, cy);
      ctx.moveTo(cx, cy - armLen); ctx.lineTo(cx, cy + armLen);
      ctx.stroke();
    } else if (mStyle === 'cross') {
      ctx.beginPath();
      ctx.moveTo(cx - armLen, cy - armLen); ctx.lineTo(cx + armLen, cy + armLen);
      ctx.moveTo(cx + armLen, cy - armLen); ctx.lineTo(cx - armLen, cy + armLen);
      ctx.stroke();
    }

    // XY text label — drawn slightly above-right of the centroid, inside
    // the canvas bounds. Nudge inward on edges.
    const xStr = `X:${Math.round(cx)}`;
    const yStr = `Y:${Math.round(cy)}`;
    const lx = cx + pad + 2;
    const lyTop = cy - pad;
    const lyBot = cy + fsize + pad - 2;

    // Dark shadow for legibility on any background
    ctx.fillStyle   = 'rgba(0,0,0,0.55)';
    ctx.fillText(xStr, lx + 1, lyTop + 1);
    ctx.fillText(yStr, lx + 1, lyBot + 1);
    ctx.fillStyle = color;
    ctx.fillText(xStr, lx, lyTop);
    ctx.fillText(yStr, lx, lyBot);
  }
  ctx.restore();
}

// Minimum Spanning Tree — Kruskal's algorithm on Euclidean distances.
// param = not used for topology (MST is unique); we reuse param as
// OPACITY so you can still fade the MST lines. taper still applies.
function drawMST(ctx, blobs, L) {
  if (blobs.length < 2) return;
  const n = blobs.length;

  // Build all edges sorted ascending by distance.
  const edges = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = blobs[i].cx - blobs[j].cx;
      const dy = blobs[i].cy - blobs[j].cy;
      edges.push({ i, j, d: Math.hypot(dx, dy) });
    }
  }
  edges.sort((a, b) => a.d - b.d);

  // Union-Find (path compression + union by rank).
  const parent = Array.from({ length: n }, (_, i) => i);
  const rank   = new Uint8Array(n);
  function find(x) {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(x, y) {
    const px = find(x), py = find(y);
    if (px === py) return false;
    if (rank[px] < rank[py]) { parent[px] = py; }
    else if (rank[px] > rank[py]) { parent[py] = px; }
    else { parent[py] = px; rank[px]++; }
    return true;
  }

  const alpha = 0.3 + L.param * 0.7;
  ctx.strokeStyle = hueToRgba(L.hueColor, alpha);
  let edgesAdded = 0;
  for (const e of edges) {
    if (edgesAdded === n - 1) break;
    if (union(e.i, e.j)) {
      strokeSegment(ctx, blobs[e.i].cx, blobs[e.i].cy, blobs[e.j].cx, blobs[e.j].cy, L);
      edgesAdded++;
    }
  }
}

// Star topology — connect every blob to blob[0] (the strongest / oldest
// tracked blob, whatever comes first in the array). param = opacity.
function drawStar(ctx, blobs, L) {
  if (blobs.length < 2) return;
  const hub = blobs[0];
  const alpha = 0.3 + L.param * 0.7;
  ctx.strokeStyle = hueToRgba(L.hueColor, alpha);
  for (let i = 1; i < blobs.length; i++) {
    strokeSegment(ctx, hub.cx, hub.cy, blobs[i].cx, blobs[i].cy, L);
  }
  // Draw a distinct hub marker (filled circle) at blob[0] centroid.
  const r = Math.max(3, L.thickness * 2.5);
  ctx.fillStyle = hueToRgba(L.hueColor, alpha);
  ctx.beginPath();
  ctx.arc(hub.cx, hub.cy, r, 0, Math.PI * 2);
  ctx.fill();
}

// ============================================================
// EFFECTS — Echo / Radar / Heatmap
// ============================================================

// Echo Blobs — past N frames of each blob's bbox rendered behind the
// current shape, with falling opacity. Per spec: knobs 1=DEPTH (1–10 frames),
// 2=OPACITY, 3=DECAY (curve), 4=OFFSET (size pulse).
function drawEchoBlobs(ctx, blobs, S, P) {
  const depth = Math.max(1, Math.min(10, Math.round(P.depth)));
  const baseOpacity = P.opacity;
  if (baseOpacity < 0.02) return;
  // Decay curve. 0 = chunky (equal opacity steps); 1 = exponential taper.
  // We blend between linear-stepping and exp-stepping per the curve.
  const expK = 1 + P.decay * 3;
  // Offset = 0 → echoes sit exactly at recorded position.
  // Offset = 1 → echoes scaled (past) bigger or smaller pulsing in/out.
  // We grow older echoes by up to ±15% per step at offset=1.
  const offsetK = P.offset * 0.15;

  ctx.save();
  ctx.lineWidth = S.thickness;
  for (const b of blobs) {
    const arr = _history.get(b.id);
    if (!arr || arr.length < 2) continue;
    // Sample `depth` past positions, evenly spaced through history.
    // Skip the newest entry (current frame, drawn by drawShapes).
    const lastIdx = arr.length - 2;
    if (lastIdx < 0) continue;
    for (let k = 1; k <= depth; k++) {
      const fraction = k / depth;
      // linear vs exponential opacity falloff blend
      const aLin = 1 - fraction;
      const aExp = Math.pow(1 - fraction, expK);
      const alpha = baseOpacity * (aLin * (1 - P.decay) + aExp * P.decay);
      if (alpha < 0.02) continue;
      // Pick a sample from history at this fraction back.
      const idx = Math.max(0, lastIdx - Math.floor(fraction * Math.min(arr.length - 1, depth)));
      const past = arr[idx];
      // Apply offset — sinusoidal pulse keyed on age so successive echoes
      // alternate slightly (dramatic "depth pulse" feel at offset=1).
      const pulse = 1 + offsetK * Math.sin(k * 0.8);
      const fakeBlob = {
        cx: past.cx,
        cy: past.cy,
        w:  past.w * pulse,
        h:  past.h * pulse,
      };
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = hueToRgba(S.hueColor, 1);
      ctx.fillStyle   = hueToRgba(S.hueColor, 1);
      drawOneShape(ctx, fakeBlob, S);
    }
  }
  ctx.restore();
}

// Radar Sweep — background dim wash + foreground "side not yet swept"
// dim mask. The visible band is a wedge swept around frame center.
// Knobs: 1=SPEED, 2=TRAIL (how long blobs persist after sweep), 3=SWEEP WIDTH,
// 4=DIRECTION (-1 ccw / 0 oscillate / +1 cw).
//
// Implementation note: a true "show only blobs while sweep crosses" mask
// would require a per-blob alpha gate — but the cheap-and-cheerful way that
// reads correctly to the eye is:
//   - background pass paints a faint sweep wedge (so the rotating arm is
//     visible regardless of blob positions)
//   - foreground pass paints a translucent black mask on the not-yet-swept
//     side (so blobs there read as dimmer, fading back in over TRAIL)

function radarAngle(P) {
  // Convert frame counter to angle in radians, with direction.
  // SPEED scales rotation rate. DIRECTION knob:
  //   -1 → ccw constant
  //    0 → oscillate (sin wave through ±π)
  //   +1 → cw constant
  const speed = 0.005 + P.speed * 0.08;
  const dir   = P.direction;       // already mapped to -1…1 by the knob
  if (dir > 0.66)        return  _frameCounter * speed;
  if (dir < -0.66)       return -_frameCounter * speed;
  // Oscillation domain: ±π. Lerp between speed scaled by |dir|.
  return Math.sin(_frameCounter * speed) * Math.PI;
}

function drawRadarSweepBg(ctx, cw, ch, P) {
  const angle = radarAngle(P);
  const cx = cw / 2, cy = ch / 2;
  const radius = Math.hypot(cw, ch);
  const wedgeWidth = 0.05 + P.sweepWidth * 0.6;   // half-angle, radians
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  // Bright leading edge of the wedge — radial gradient from center fading
  // outward. Drawn as a triangle wedge from origin out to radius.
  const grad = ctx.createLinearGradient(0, 0, radius, 0);
  grad.addColorStop(0,   'rgba(255,255,255,0)');
  grad.addColorStop(0.7, `rgba(255,255,255,${0.04 + P.trail * 0.10})`);
  grad.addColorStop(1,   `rgba(255,255,255,${0.16 + P.trail * 0.20})`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, radius, -wedgeWidth, wedgeWidth);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawRadarSweepFg(ctx, cw, ch, P) {
  // Mask the not-yet-swept side with a translucent darken. The mask
  // intensity scales with (1 - TRAIL); high TRAIL = blobs persist
  // (no/light mask), low TRAIL = brief flash (heavy mask).
  const angle = radarAngle(P);
  const cx = cw / 2, cy = ch / 2;
  const radius = Math.hypot(cw, ch);
  const wedgeWidth = 0.05 + P.sweepWidth * 0.6;
  const maskAlpha = (1 - P.trail) * 0.65;
  if (maskAlpha < 0.02) return;
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${maskAlpha})`;
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  // Mask covers the "back side" — angle from +wedgeWidth around to
  // -wedgeWidth via 2π.
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, radius, wedgeWidth, Math.PI * 2 - wedgeWidth);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Heatmap Residue — long-lived accumulator buffer that gets dab-painted
// for each current blob and decays toward black each frame. Composite
// onto ctx with the chosen palette.
//
// Knobs: 1=INTENSITY, 2=DECAY (high = quick fade), 3=SPREAD (radius),
// 4=PALETTE (3 positions: 0=thermal, 1=cool, 2=rainbow).
const HEATMAP_PALETTES = [
  // thermal: red-yellow-white
  [[0,'#000'], [0.3,'#5a0000'], [0.6,'#ff5500'], [0.85,'#ffea00'], [1,'#fff']],
  // cool: blue-cyan-white
  [[0,'#000'], [0.3,'#001a40'], [0.6,'#0066cc'], [0.85,'#88ddff'], [1,'#fff']],
  // rainbow
  [[0,'#000'], [0.2,'#440044'], [0.4,'#0044ff'], [0.6,'#00cc44'], [0.8,'#ffcc00'], [1,'#ff3030']],
];

function drawHeatmapResidue(ctx, blobs, cw, ch, P) {
  ensureHeatCanvas(cw, ch);
  // Decay the accumulator: composite a translucent black over it. Higher
  // DECAY knob = larger black alpha = faster fade.
  const decayAlpha = 0.02 + P.decay * 0.20;
  _heatCtx.save();
  _heatCtx.globalCompositeOperation = 'destination-out';
  _heatCtx.fillStyle = `rgba(0,0,0,${decayAlpha})`;
  _heatCtx.fillRect(0, 0, cw, ch);
  _heatCtx.restore();

  // Dab each current blob into the accumulator as a soft white circle.
  // SPREAD scales the dab radius relative to bbox.
  _heatCtx.save();
  _heatCtx.globalCompositeOperation = 'lighter';
  const spreadK = 0.5 + P.spread * 2.5;   // 0.5×–3× of the bbox radius
  for (const b of blobs) {
    const r = Math.max(8, Math.max(b.w, b.h) * 0.5 * spreadK);
    const grad = _heatCtx.createRadialGradient(b.cx, b.cy, 0, b.cx, b.cy, r);
    grad.addColorStop(0,    'rgba(255,255,255,0.75)');
    grad.addColorStop(0.5,  'rgba(255,255,255,0.30)');
    grad.addColorStop(1,    'rgba(255,255,255,0.00)');
    _heatCtx.fillStyle = grad;
    _heatCtx.beginPath();
    _heatCtx.arc(b.cx, b.cy, r, 0, Math.PI * 2);
    _heatCtx.fill();
  }
  _heatCtx.restore();

  // Composite the accumulator onto the output ctx via the chosen palette.
  // We do it by reading the accumulator's grayscale and looking up the
  // palette stop colors; cheap pass since we read once per frame.
  const intensity = P.intensity;
  if (intensity < 0.02) return;

  // For perf, just composite the white accumulator using a per-frame
  // tint via globalCompositeOperation. We pre-build a small palette
  // gradient bar offscreen and stretch-blit isn't trivial in 2d; instead
  // we approximate by re-drawing the radial dabs in palette colors using
  // the bbox + spread as the gradient — visually equivalent for the
  // common case where blobs don't overlap heavily, and avoids a costly
  // getImageData pass.
  const palIdx = Math.max(0, Math.min(HEATMAP_PALETTES.length - 1, Math.round(P.palette * (HEATMAP_PALETTES.length - 1))));
  const stops = HEATMAP_PALETTES[palIdx];

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = intensity;
  // Draw the heatmap accumulator with palette via colorize: source-in
  // composite of the palette gradient onto a tinted copy of the accumulator.
  // Simpler: stamp palette-tinted radial gradients at the same blob positions
  // (the accumulator's job was to handle DECAY persistence — we use the
  // same shape for the final paint, just colored).
  for (const b of blobs) {
    const r = Math.max(8, Math.max(b.w, b.h) * 0.5 * spreadK);
    const grad = ctx.createRadialGradient(b.cx, b.cy, 0, b.cx, b.cy, r);
    for (const [pos, color] of stops) grad.addColorStop(pos, color);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Also blit the accumulator (the persistent residue trail) on top using
  // the brightest palette stop, so trails fade through palette colors as
  // they decay.
  ctx.globalAlpha = intensity * 0.6;
  ctx.drawImage(_heatCanvas, 0, 0);
  ctx.restore();
}
