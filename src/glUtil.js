/**
 * Shared WebGL2 helpers for the effect modules.
 *
 * uploadVideoTexture: per-frame video upload with allocate-once + sub-image
 * fast-path. The first call (or after the video's intrinsic size changes)
 * does texImage2D, which allocates a fresh texture buffer. Every subsequent
 * call does texSubImage2D, which writes into the existing buffer with no
 * realloc cost. Saves ~8 MB GPU allocate+free per frame at 1080p.
 *
 * Caller MUST have already bound the texture (gl.bindTexture(TEXTURE_2D, tex))
 * before calling. The `tex` argument is used only as a WeakMap key for tracking
 * dimensions; replacing the texture (e.g. via init() after a canvas resize)
 * automatically resets the cached dims when the old texture is GC'd.
 *
 * Y-axis convention: the upload sets UNPACK_FLIP_Y_WEBGL=true so that
 * video row 0 (the visual TOP of the source frame) lands at texture
 * coordinate v=1 (the GL-convention TOP of the texture). Every effect's
 * vertex shader uses `vUV = a_pos * 0.5 + 0.5`, which puts vUV=(0,0) at
 * the bottom-left of the rendered quad. Without the flip, sampling
 * u_video at vUV would read video-row-0 (top of source) at the bottom
 * of the screen — i.e. the rendered frame would be upside-down. The
 * effect was masked for voronoi/wave/cellular (their output patterns
 * are orientation-agnostic — you can't tell a Voronoi diagram is
 * flipped) but loud for ascii/shatter/erode (those preserve the
 * video's structure, so the flip is visible).
 *
 * Setting it on EVERY upload (rather than once at boot) is intentional —
 * UNPACK_FLIP_Y_WEBGL is a sticky GL state, but other code paths
 * (third-party libs, future texture uploads of non-video data) might
 * toggle it; redundantly asserting it here keeps the video-upload path
 * self-contained and immune to outside-state regressions.
 *
 * @returns {boolean} true if the upload happened, false if source isn't ready
 *
 * Dimension lookup is polymorphic: HTMLVideoElement reports videoWidth /
 * videoHeight; HTMLImageElement reports naturalWidth / naturalHeight;
 * HTMLCanvasElement and ImageBitmap report width / height. The first
 * non-zero pair wins. This lets the same upload path handle video AND
 * still-image source modes without branching at the call site.
 */
const _texDims = new WeakMap();

export function uploadVideoTexture(gl, tex, source) {
  const w = (source.videoWidth || source.naturalWidth || source.width || 0) | 0;
  const h = (source.videoHeight || source.naturalHeight || source.height || 0) | 0;
  if (w === 0 || h === 0) return false;
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  const last = _texDims.get(tex);
  if (!last || last.w !== w || last.h !== h) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    _texDims.set(tex, { w, h });
  } else {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }
  return true;
}
