# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # first time only
npm run dev        # dev server at http://localhost:5173
npm run build      # production build → dist/
npm run preview    # serve dist/ locally
npm run test:e2e   # Playwright smoke tests
npm run cf:dev     # build + Cloudflare Pages local dev for Functions
npm run cf:deploy  # build + deploy dist/ to Cloudflare Pages
```

No linter. The app is vanilla JS + Vite with Playwright smoke tests — verify visual/interaction correctness in the browser.

## Tech stack constraints

**Hard no** (see `PRD_DECISIONS.md`): TypeScript, React/Svelte/Solid, Tailwind, shadcn, three.js, any framework. This is intentionally vanilla JS + raw WebGL2 + Vite. Don't introduce build-time transpilation or component libraries.

State lives in plain objects. Persistence is `localStorage` (`STORAGE_KEY = 'lumisynth-state-v7'`). Bump the storage key and explain why if the saved-state schema changes (v6 added timeline segments; v7 added `fxRack`).

## Architecture

Signal flow: **STRUCTURE → COLOR rack → FX RACK → PER-BLOB overlays**

```
Video / webcam
  ↓ blobDetector.js   grid local-maxima, 6 modes (motion/luma/dark/sat/edge/sharp)
  ↓ kalman.js          Kalman + nearest-neighbour tracker, keeps blob identities stable
  ↓ STRUCTURE pass     one full-frame WebGL effect (or none)
  ↓ COLOR rack         0–3 slots chained in series, each an independent WebGL pass
  ↓ FX RACK            0–3 slots chained after COLOR — stateful GL feedback passes (glFx.js)
  ↓ PER-BLOB pass      CPU-side filter (inv / thermal) inside blob bounding boxes
  ↓ overlays.js        Canvas 2D shapes, labels, connection lines drawn on top
```

### GL pipeline (critical to understand before touching any GL file)

All WebGL2 effect modules share **one offscreen GL canvas, one context, one video texture, one quad VAO** — `glContext.js`. The orchestrator (`renderFrame` in `main.js`) owns the per-frame sequence:

1. `ensureContext(cw, ch)` — idempotent resize
2. `uploadVideoFrame(video)` — one texture upload per frame
3. `apply{Effect}(cw, ch, params, opts)` — pure GL passes, no upload/composite inside
4. `compositeToCanvas2D(ctx, cw, ch, op)` — one `drawImage` to the display canvas

Chain FBOs (in `glContext.js`): STRUCTURE writes → `chainFBOs.a`, compose pass reads a + video writes → `chainFBOs.b`, COLOR reads `chainFBOs.b`. Never read and write the same FBO texture in one draw call.

Effect modules receive `opts = { inputTex, outputFBO }`. Stateful effects (Voronoi, Cellular, Wave) ignore `inputTex` — they always seed from raw video internally.

Every effect vertex shader **must** call `gl.bindAttribLocation(prog, 0, 'a_pos')` before linking.

### renderFrame wiring (detailed, in `main.js`)

`renderFrame` is the RAF loop that ties everything together. Per-frame sequence:

```
1. FPS cap gate (60Hz accumulator)
2. ctx.drawImage(srcEl) — video/image to 2D display canvas (always happens first)
3. Detection: offscreen.drawImage(srcEl @ 0.5×scale) → detectBlobs → trackBlobs → cachedBlobs
   - Only runs when source is playing (not paused/still)
   - Runs every `updateInterval` frames
4. smoothBlobs(cachedBlobs) — One Euro Filter sub-pixel smoothing
5. GL dispatch — resolveActivePipeline() determines active stages. COLOR + FX
   slots are normalized into one ordered `chained` list (colors first, then fx):
   a. totalStages === 0: no GL runs, raw video on display
   b. totalStages === 1: single fast path — effect → compositeToCanvas2D(blend)
   c. totalStages > 1:  multi-stage ping-pong via chain.a ↔ chain.b FBOs
      - STRUCTURE (if any): reads raw video → writes chain.a
        - If STRUCTURE blend = 'screen': applyCompose(structTex, chain.b) to bake screen blend
      - CHAINED (colors then fx): each reads previous tex → writes to next FBO;
        last writes to null (GL canvas)
      - compositeToCanvas2D with the terminal stage's blend mode
6. PER-BLOB CPU pass (inv/thermal): getImageData → applyFilterToSubregion → putImageData
7. TRACK mode overlay: drawTrackOverlay(ctx, blobs, ...) — Canvas 2D on top
```

**`resolveActivePipeline()`** returns `{ structure: string|null, colors: [{type, params}], fx: [{type, params, key}] }` — only enabled, non-empty slots make it in. `key` is the fx slot id; glFx.js keys per-slot feedback buffers on it. This is called once per frame and drives the entire GL dispatch.

**`runEffect(name, opts)`** dispatches STRUCTURE effects: `'ascii'` → `applyASCII`, `'erode'` → `applyGLFilter('erode', ...)`.

**`runColorEffect(type, params, opts)`** dispatches COLOR effects: all go through `applyGLFilter(type, cw, ch, orderedParams, opts)` where `orderedParams` is built from `COLOR_PARAM_SCHEMAS[type].order`.

**`runFxEffect(type, params, opts, key)`** dispatches FX RACK effects through `applyFxEffect(type, cw, ch, orderedParams, { ...opts, fxKey: key })` in `glFx.js`, with `orderedParams` built from `FX_PARAM_SCHEMAS[type].order`.

### Shader anatomy

All effect shaders share a **single vertex shader pattern**:
```glsl
#version 300 es
in vec2 a_pos;        // clip-space position, attr 0
out vec2 vUV;
void main() {
  vUV = a_pos * 0.5 + 0.5;   // [-1,1] → [0,1] UV
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
```
The quad covers the full clip-space (±1), and `UNPACK_FLIP_Y_WEBGL=true` in `glUtil.js` ensures video row 0 (visual top) lands at `vUV.y=1` (GL top), keeping rendered video right-side up.

All fragment shaders have the same interface:
- `uniform sampler2D u_video` — the input texture (may be raw video tex or upstream FBO tex via `opts.inputTex`)
- `uniform vec4 uParams` — four packed floats; the `order` array in `COLOR_PARAM_SCHEMAS` maps slot params to xyzw positions
- `out vec4 fragColor`

**Shaders by effect:**

| Effect | File | uParams mapping | Notes |
|---|---|---|---|
| `erode` | `glFilters.js` | x=dilate(0/1), y=radius, z=strength, w=edgeRing | Morphological erode/dilate + edge ring overlay |
| `oxide` | `glFilters.js` | x=corrosion, y=metal(0=copper/0.5=iron/1=silver), z=roughness, w=sheen | Hash-noise roughness; 3 metal palettes |
| `synth` | `glFilters.js` | x=warmth, y=sep(bands 3–12), z=resonance, w=dynRange(gamma) | Luma-based color ramp with sin resonance modulation |
| `biolum` | `glFilters.js` | x=glow, y=color(hue 0=cyan/1=violet), z=pulse, w=depth | HSV→RGB; glow pow + sin pulse |
| `thermo` | `glFilters.js` | x=contrast, y=hot(bias), z=cold(floor), w=whitePt | 5-stop thermal ramp black→blue→cyan→yellow→red→white |
| `falsecolor` | `glFilters.js` | x=palette(0–1 cross-fades thermal/neon/acid/ice), y=band(0/1), z=bandcnt, w=bright | 4 built-in palettes cross-faded by x |
| `ascii` | `ascii.js` | x=cellSize, y=contrast, z=blackThreshold, w=glyphStrength | 5×7 bitmap font; 26 glyphs encoded as hex bitmasks in GLSL |
| `flowfield` | `glFx.js` | x=flowSpeed, y=trailPersistence, z=trailBrightness, w=sourceBlend | FX RACK. Stateful: 2 samplers (u_video + u_feedback), per-slot ping-pong feedback FBOs |
| compose pass | `glCompose.js` | no uParams — 2 samplers: u_video + u_struct | Screen blend formula: `1-(1-a)*(1-b)` |

**Shader compile pattern** (identical in all modules):
1. `compileShader(gl, type, src)` — creates, sources, compiles; logs error on failure
2. `createProgram(gl, vSrc, fSrc)` — attaches, calls `bindAttribLocation(prog, 0, 'a_pos')` before link
3. Uniform locations cached in module-level `M` (or `_programs[name]` in glFilters) on first call

### glContext.js internals

`S` (module-level singleton) holds: `{ canvas, gl, vao, videoTex, w, h }`.

`chain` (module-level) holds: `{ a: {fb, tex}, b: {fb, tex} }` — lazily allocated by `getChainFBOs()`, disposed and reallocated on resize. **Do not cache `fb`/`tex` handles across frames** — they become stale after resize.

Exported API:
- `ensureContext(w, h)` → `S` — creates context + VAO + videoTex on first call; resizes canvas + disposes chain on dimension change
- `uploadVideoFrame(video)` → delegates to `glUtil.uploadVideoTexture` (allocate-once + `texSubImage2D` fast-path)
- `compositeToCanvas2D(ctx, cw, ch, op)` — `drawImage(S.canvas)` with given composite op
- `getChainFBOs()` → `{ a, b }` — lazy alloc
- `getGL()`, `getCanvas()`, `getVideoTex()`, `getQuadVAO()` — accessors for module use

### BLEND_MODES

`BLEND_MODES` (in `main.js`) maps effect names to their Canvas 2D composite operation used in `compositeToCanvas2D`. STRUCTURE effects that are `'screen'` trigger the compose pass in multi-stage chains. `'source-over'` effects replace the video directly (ascii, erode) — no compose pass needed.

### Key files

| File | Role |
|---|---|
| `src/main.js` | App entry, `state` object, render loop, all UI wiring. Imports all schemas from `schemas.js` |
| `src/schemas.js` | Pure data leaf: `DEFAULTS`, `STORAGE_KEY`, `RACK_SLOTS`, `COLOR_PARAM_SCHEMAS`, `TRACK_FX_PARAM_SCHEMAS`, `STRUCTURE_SECTIONS`, `COLOR_SECTIONS`, `BLEND_MODES`, `GL_RESETS`, rack factory functions. No DOM, no imports |
| `src/glContext.js` | Shared GL context + chain FBO allocator. Read the contract comment at the top before touching any GL module |
| `src/glCompose.js` | STRUCTURE → COLOR compose pass (screen-blend STRUCTURE output over raw video) |
| `src/glFilters.js` | Stateless full-frame GL effects: shatter, erode, oxide, synth, biolum, thermo, falsecolor |
| `src/glFx.js` | FX RACK effects — stateful GL feedback passes (flowfield). Per-slot ping-pong feedback FBOs keyed by slot id; `resetFxFeedback()` wired into resetAllState + slot mutations |
| `src/blobDetector.js` | CPU blob detection, all 6 modes |
| `src/kalman.js` | 1D Kalman filter + nearest-neighbour tracker |
| `src/overlays.js` | Canvas 2D track overlay: shapes, labels, connection lines, Track FX |
| `src/oneEuroFilter.js` | One Euro Filter for sub-pixel blob position smoothing |
| `src/filters.js` | CPU per-blob effects (inv, thermal) applied to ImageData subregions |
| `src/ascii.js` | WebGL2 ASCII luma (single-pass, stateless) |
| `src/glUtil.js` | `uploadVideoTexture` — allocate-once + `texSubImage2D` fast-path (saves ~8 MB GPU alloc/free per frame at 1080p); also handles UNPACK_FLIP_Y_WEBGL |
| `functions/api/[[path]].js` | Cloudflare Pages Functions API for auth, presets, and export events |
| `migrations/0001_auth_presets.sql` | D1 schema for users, auth challenges, sessions, presets, export events |
| `wrangler.toml` | Cloudflare Pages config; D1 binding intentionally requires real database id later |

Voronoi / cellular / wave were removed; they are not in the current `src/`.

### Color rack (COLOR_PARAM_SCHEMAS)

3 fixed slots. Each slot holds one color effect (oxide / synth / biolum / thermo / falsecolor) or is empty. Each slot has its own independent copy of that effect's knob params. Slots run in series — slot 0 output feeds slot 1, etc. Disabled slots are skipped entirely. Schemas live in `COLOR_PARAM_SCHEMAS` in `src/schemas.js`; `order` array must match shader uniform order exactly.

### FX rack (FX_PARAM_SCHEMAS)

3 fixed slots mirroring the COLOR rack, running AFTER it in the chain (signal
flow: STRUCTURE → COLOR → FX RACK). Effects live in `src/glFx.js` and are
**stateful**: each enabled slot owns a persistent ping-pong feedback FBO pair
(keyed by slot id) so the shader can sample its own previous-frame output
(`u_feedback`) — that's what makes trails accumulate. Two slots running the
same effect trail independently.

Rules for FX effects:

- Shader interface adds `uniform sampler2D u_feedback` on top of the standard
  `u_video` + `uParams` shape. Param order lives in `FX_PARAM_SCHEMAS[type].order`.
- Each frame: shader reads `pair.read.tex`, writes `pair.write.fb`, a
  passthrough copy pass blits the new state to the chain output, then the pair
  swaps. Never read and write the same texture in one draw.
- The copy to the chain output is a draw (passthrough program), NOT
  `gl.blitFramebuffer` — the default framebuffer may be antialiased and
  single→multisample blits are INVALID_OPERATION in WebGL2.
- Feedback must reset to black (dispose buffers) on: source change / timeline
  segment change (`resetAllState` → `resetFxFeedback()`), slot swap / clear /
  disable (`resetFxFeedback(slotId)`), and resize (size-mismatch check in
  `glFx.js`). Knob tweaks must NOT reset trails.

Current FX effects: `flowfield` (luma-gradient advection trails — the real
feedback version of what the COLOR effect `decayflow` fakes statelessly).

### Design system

Tokens defined in `DESIGN.md` / `DESIGN.json`. Key palette: warm-grey graphite chassis (`--bg-stage: #1f1c19`), orange signal (`#ff5722`). Typography: Inter, 9–13px, heavy letter-spacing. Stage accent colors: OSC = amber (`#b89669`), FILTER = rose (`#b66575`), FX = slate-blue (`#7a96b1`). CSS variables are the source of truth — don't hardcode color values.

### Two top-level modes

`state.mode` is `'synth'` or `'track'`. `body[data-mode]` attribute controls which sidebar sections are visible via CSS. SYNTH mode shows STRUCTURE / COLOR rack pipeline. TRACK mode shows the blob-tracking controls and track FX rack.

### Track FX rack (TRACK_FX_PARAM_SCHEMAS)

3 fixed slots mirroring the COLOR rack, but for TRACK mode only. Effects: `echo` (ghost bboxes of past blob positions), `radar` (sweep-ring per blob), `heatmap` (canvas residue layer). Schemas live in `TRACK_FX_PARAM_SCHEMAS`; rack initialized via `makeTrackFxRack()` in `main.js`. CPU-side Canvas 2D — no GL passes.

### Track lines and smoothing

Blob tracking is general-purpose, not object-specific. Detection happens in `blobDetector.js`, identity stabilization in `kalman.js`, and display smoothing in `main.js` via `BlobOneEuroFilter` when `state.trackStability > 0`.

TRACK Lines currently include: `off`, `distthresh`, `velocity`, `pulse`, `constellation`, `mst`, `star`, `hubcurve`.

`hubcurve` is the newest line style. It does **not** add a flower/petal detector. It computes a smoothed weighted hub from whatever blobs are already detected, then draws curved quadratic spokes from that hub to each blob in `overlays.js`. `trackLinesParam` controls curve amount; `trackLinesTaper` narrows the spokes toward endpoints. Existing `star`, `mst`, and `constellation` behavior should remain unchanged.

### Auth, presets, and hosting

Frontend hosting target: Cloudflare Pages. Backend target: Cloudflare Pages Functions + D1.

`functions/api/[[path]].js` provides:
- `POST /api/auth/start` — create a 6-digit login challenge and send it by email
- `POST /api/auth/verify` — verify code, create user/session, set `lumisynth_session` HttpOnly cookie
- `POST /api/auth/logout`
- `GET /api/me`
- `GET/POST /api/presets`
- `PUT/DELETE /api/presets/:id`
- `POST /api/export-events`

Production email login expects these Cloudflare env vars:
- `RESEND_API_KEY`
- `AUTH_FROM_EMAIL`
- `APP_ORIGIN`

D1 must be bound as `DB`. The real `database_id` is **not** in `wrangler.toml` because it is only known after creating the real Cloudflare D1 database. Do not invent it. After D1 exists, add the binding in Cloudflare Pages settings or update `wrangler.toml` with the real `database_id` and `preview_database_id`.

Local/internal testing before D1 exists: the frontend has a localhost-only fallback. On `localhost`, `127.0.0.1`, or file-host style empty hostname, if `/api` is unavailable, login code is shown in a toast and internal user/presets are stored in `localStorage` under `lumisynth-internal-auth` and `lumisynth-internal-presets`. This is only for internal testing of export gating and cloud preset UI.

Exports are gated in `main.js`: Snap/Rec require an authenticated user. Real Cloudflare sessions record an `export_events` row; internal login bypasses the API and allows local testing.

## Active work context

See `lumisynthprd.md` for implementation status vs the original PRD. P2 (STRUCTURE → COLOR FBO chain) shipped. Track FX rack (echo/radar/heatmap) is implemented in TRACK mode. Curved hub lines are implemented as a general TRACK Lines style (`hubcurve`). Cloudflare Pages Functions + D1 auth/presets/export-gating scaffolding exists, with localhost-only internal login for testing before real D1 setup. P3 has STARTED: the FX RACK is a real GL rack (3 slots, drag-reorder, per-slot params, timeline-look + preset + persistence integration) with `flowfield` as its first effect — see `src/glFx.js`. Remaining P3: more FX effects, and Inv/Thermal moving from PER-BLOB into the FX RACK. `PRD_DECISIONS.md` logs what is deliberately out of scope.
