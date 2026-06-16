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

State lives in plain objects. Persistence is `localStorage` (`STORAGE_KEY = 'lumisynth-state-v8'`). Bump the storage key and explain why if the saved-state schema changes (v6 added timeline segments; v7 added `fxRack`; v8 collapsed the 3-slot `colorRack` into the single COLOR stage — `color` + `colorParams` + `colorHue`/`colorSat`).

## Architecture

Signal flow: **STRUCTURE → COLOR (single stage) → GRADE → FX RACK → PER-BLOB overlays**

```
Video / webcam
  ↓ blobDetector.js   grid local-maxima, 6 modes (motion/luma/dark/sat/edge/sharp)
  ↓ kalman.js          Kalman + nearest-neighbour tracker, keeps blob identities stable
  ↓ STRUCTURE pass     one full-frame WebGL effect (or none)
  ↓ COLOR stage        ONE selected color effect (map / unique / chroma) — v8 retired the rack;
  ↓                    layering happens on the timeline, one look per segment
  ↓ GRADE pass         always-on hue-rotate + saturation (active when knobs off neutral,
  ↓                    even with color = none)
  ↓ FX RACK            0–3 slots chained after GRADE — stateful GL feedback passes (glFx.js)
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
5. GL dispatch — resolveActivePipeline() determines active stages. COLOR,
   GRADE, and FX are normalized into one ordered `chained` list:
   a. totalStages === 0: no GL runs, raw video on display
   b. totalStages === 1: single fast path — effect → compositeToCanvas2D(blend)
   c. totalStages > 1:  multi-stage ping-pong via chain.a ↔ chain.b FBOs
      - STRUCTURE (if any): reads raw video → writes chain.a
        - If STRUCTURE blend = 'screen': applyCompose(structTex, chain.b) to bake screen blend
      - CHAINED (color, grade, then fx): each reads previous tex → writes to
        next FBO; last writes to null (GL canvas)
      - compositeToCanvas2D with the terminal stage's blend mode
6. PER-BLOB CPU pass (inv/thermal): getImageData → applyFilterToSubregion → putImageData
7. TRACK mode overlay: drawTrackOverlay(ctx, blobs, ...) — Canvas 2D on top
```

**`resolveActivePipeline()`** returns `{ structure: string|null, color: {type, params}|null, grade: {hue, sat}|null, fx: [{type, params, key}] }`. `color` is the single selected effect with its params from `colorParams` (fallback to factory, never mutating the look). `grade` is non-null whenever either grade knob is off neutral. `key` is the fx slot id; glFx.js keys per-slot feedback buffers on it. Called once per frame; drives the entire GL dispatch.

**`runEffect(name, opts)`** dispatches STRUCTURE effects: `'ascii'` → `applyASCII`, `'erode'` → `applyGLFilter('erode', ...)`. STRUCTURE shaders share an `applyStructureOutput(structure, src, mode)` helper (copy-pasted into each FRAG) with four output modes — `mono` (0, grayscale on black), `source` (1, mask the source RGB), `ink` (2, black/cream poster via `uInkLow`/`uInkHigh`), `invert` (3, negative of mono). The string→number map is `STRUCTURE_OUTPUT_MODE_VALUE` in `main.js`; a new mode must be added to every copy of the helper.

**`runColorEffect(type, params, opts)`** dispatches COLOR effects through `applyGLFilter(type, cw, ch, orderedParams, opts)` where `orderedParams` is built from `COLOR_PARAM_SCHEMAS[type].order` (padded to 4). For `chroma`, the 4 ramp-stop hex params additionally travel as vec3 uniforms via `opts.stops` (same out-of-band mechanism as the ink colors).

**`runGradeEffect(grade, opts)`** runs the internal `grade` shader with `[hue, sat, 0, 0]`.

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

Two OPTIONAL uniforms are auto-wired by the dispatchers (`applyGLFilter` AND `applyFxEffect`) — declare them and they work; omit them and they cost nothing (cached location is null, upload skipped):
- `uniform float uTime` — seconds (`performance.now()/1000`), for animated effects (sequin, octopus, hologram, dreamstatic, freqmod, crtrolling, wobbletape)
- `uniform sampler2D u_prev` — the video frame from ~4 frames back, bound on TEXTURE2 (glFilters only). Backed by the frame-history ring in glContext.js; `renderFrame` calls `captureFrameHistory()` only while a motion effect is active, so **new motion effects must be added to that condition in main.js** (currently `motionedge` / `predator`). Ring re-primes on source change via `resetMotionHistory()` in `resetAllState`.
- `uniform float uParam4` — an optional 5th scalar for effects that genuinely need more than the 4 `uParams` slots (escape hatch from the 4-knob house pattern). BOTH dispatchers (`applyGLFilter` and `applyFxEffect`) upload `params[4]` when the uniform exists and a 5th value is passed; pass a 5-element `order` array (runEffect/runFxEffect map the whole order and only pad to 4). Used by `freqmod` (line density, glFilters) and `lumadrag` (wobble, feedback FX in glFx). Prefer keeping to 4 knobs; reach for this only when a 5th control is clearly warranted. (Shader SOURCES are separate — they use a `uParams[8]` array, see below.)

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
| `chroma` | `glFilters.js` | x=driver(0-4), y=bands, z=gamma | CUSTOM tab (ChromaEngine). 4 ramp stops as vec3 uniforms uStop0..3 via opts.stops; driver = luma/inv/sat/edge/radial |
| `grade` | `glFilters.js` | x=hueRotate, y=sat(0.5 neutral) | Internal post pass for the GRADE knobs — Rodrigues hue rotation about the grey axis + sat lerp. Not in any picker |
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
- `captureFrameHistory()` — writes the current videoTex into a 4-slot GPU ring (passthrough draw, no CPU upload); called by renderFrame only when a motion effect is active. First capture (or after reset) seeds all 4 slots so initial diffs are zero, not a flash.
- `getMotionTex()` — oldest ring entry (~4 frames back); falls back to videoTex before first capture
- `resetMotionHistory()` — re-primes the ring on source/segment change (wired into resetAllState)
- `getGL()`, `getCanvas()`, `getVideoTex()`, `getQuadVAO()` — accessors for module use

### BLEND_MODES

`BLEND_MODES` (in `main.js`) maps effect names to their Canvas 2D composite operation used in `compositeToCanvas2D`. STRUCTURE effects that are `'screen'` trigger the compose pass in multi-stage chains. `'source-over'` effects replace the video directly (ascii, erode) — no compose pass needed.

### Key files

| File | Role |
|---|---|
| `src/main.js` | App entry, `state` object, render loop, all UI wiring. Imports all schemas from `schemas.js` |
| `src/schemas.js` | Pure data leaf: `DEFAULTS`, `STORAGE_KEY`, `RACK_SLOTS`, `COLOR_PARAM_SCHEMAS`, `FX_PARAM_SCHEMAS`, `TRACK_FX_PARAM_SCHEMAS`, `STRUCTURE_SECTIONS`, `COLOR_MAP_SECTIONS`, `COLOR_UNIQUE_SECTIONS`, `COLOR_SECTIONS`, `FX_SECTIONS`, `BLEND_MODES`, `GL_RESETS`, factory functions. No DOM, no imports |
| `src/glContext.js` | Shared GL context + chain FBO allocator. Read the contract comment at the top before touching any GL module |
| `src/glCompose.js` | STRUCTURE → COLOR compose pass (screen-blend STRUCTURE output over raw video) |
| `src/glFilters.js` | Stateless full-frame GL effects: all COLOR maps + unique effects, `chroma` (ChromaEngine), the internal `grade` pass, the stateless FX RACK effects, and most STRUCTURE shaders |
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

### COLOR stage (single, v8)

The 3-slot color rack is gone. `state.color` selects ONE effect; layering
color looks over time happens via timeline segments (each segment's look
carries its own color + grade). The picker is three tabs sharing that one
selection:

- **MAPS** — pure per-pixel color mapping (`COLOR_MAP_SECTIONS`): ramps,
  grades, palette swaps with no neighbor sampling. Swatch grid built at
  startup from data in `main.js` (`COLOR_SWATCH_GRADIENTS`, `COLOR_LABEL`,
  `COLOR_MAP_TIPS`) — adding a map needs no index.html edits.
- **UNIQUE** — effects that BUILD something (neighbor sampling, added
  elements, displacement, animation, motion response). Organized by
  `COLOR_UNIQUE_SECTIONS` in `schemas.js` — categories render as in-grid
  headers; add an effect to a category row (or add a new category) and
  the grid builds itself. Current categories: Atmosphere (nebula,
  aurorastorm, deepfield, dreamstatic), Light (neontube, prismatic,
  heatbleed, sequin, hologram), Dimension (depthstack, abyss), Deep Sea
  (octopus), Print (risograph, newsprint), Motion (predator — uses
  u_prev). Still stateless single-frame passes — anything that
  accumulates across frames belongs in the FX RACK.
- **CUSTOM** — the `chroma` effect (ChromaEngine): driver select
  (luma/inv/sat/edge/radial) + 4 user ramp stops (hex strings in params,
  passed as vec3 uniforms via `opts.stops`) + Bands/Gamma knobs.

Key mechanics:

- **Per-effect knob memory**: `state.colorParams[type]` holds each effect's
  params, lazily seeded with factory defaults (`getColorParams`). Switching
  effects and returning keeps your tweaks. Sanitized by `sanitizeColorParams`
  (numbers per schema; hex validation for chroma stops).
- **GRADE knobs** (`colorHue`/`colorSat`): static state knobs, always
  visible, post-applied as their own chained `grade` pass whenever off
  neutral — including with color = 'none'.
- **Activation rule**: clicking a map/preset/driver selects that tab's
  effect via `setColor`/`renderColorPanel` (DOM rebuild); knob drags
  activate via `activateColor` (class toggles only — rebuilding mid-drag
  would kill the gesture, so it never does).
- **Migration**: `migrateColorRack` collapses v5–v7 `colorRack` saves
  (first enabled slot wins) — wired into `sanitizeLook` (covers timeline
  segments + presets) and `loadPersistedState`.

`COLOR_PARAM_SCHEMAS` in `src/schemas.js` stays the source of truth for
knobs/toggles/colors and the `order` array, which must match the shader's
`uParams.xyzw` exactly.

### FX rack (FX_PARAM_SCHEMAS)

3 fixed slots running AFTER the COLOR stage + GRADE (signal flow:
STRUCTURE → COLOR → GRADE → FX RACK). Two kinds of effect live here,
distinguished by the schema's `feedback` flag — `runFxEffect` dispatches on
it:

- **Stateless signal/texture effects** (no flag): bloom, godrays, decayflow,
  feedbackwarp, crt, crtrolling, scanlines, degrade, noise. Single-frame
  passes whose shaders live in `glFilters.js` `FRAGS`; dispatched through
  `applyGLFilter` exactly like COLOR effects, just racked after the color
  stage. Adding one = shader + `FRAGS` entry + `FX_PARAM_SCHEMAS` +
  `FX_SECTIONS` + `FX_LABEL`/`FX_SWATCH_GRADIENTS`/`FX_CHIP_TIP` in
  `main.js` (the picker popover builds itself — no index.html edits).
- **Feedback effects** (`feedback: true`): `flowfield`, `drag`, `lumadrag`,
  `tunnel`, `burnin`, `wobbletape`. Live in `src/glFx.js`; each enabled slot owns a
  persistent ping-pong feedback FBO pair (keyed by slot id) so the shader
  can sample its own previous-frame output (`u_feedback`) — that's what
  makes trails accumulate. Two slots running the same effect trail
  independently. `applyFxEffect` also auto-uploads `uTime` to feedback
  shaders that declare it. Design note from `burnin`: the feedback buffer
  is BOTH the display output and the state, so any "hidden state" (like
  heat) must be recoverable from the visible color — burnin keeps its
  phosphor palette luma-monotonic so heat ≈ luma(feedback).

Rules for feedback FX effects:

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

Note: `decayflow` and `feedbackwarp` are stateless approximations of feedback
behavior — natural candidates to upgrade to real `feedback: true` effects
later.

### Design system

Tokens defined in `DESIGN.md` / `DESIGN.json`. June 2026 pivot: the chassis is now **Teenage Engineering K.O. II cream** — light warm-bone surfaces (hue 85), dark silkscreen text, full-orange active keys (`#ff5722` with dark legends), and near-black display surfaces (canvas / top bar / toast / help) kept dark so they read as LCDs set into the cream body. On the light chassis "raised" = lighter (white plastic keys) and hover darkens one step (pressed key). Typography: Inter, 9–13px, heavy letter-spacing. CSS variables are the source of truth — don't hardcode color values; the dark-graphite values quoted in older docs are superseded by the tokens in `style.css`.

### Two top-level modes

`state.mode` is `'synth'` or `'track'`. `body[data-mode]` attribute controls which sidebar sections are visible via CSS. SYNTH mode shows the STRUCTURE / COLOR / FX RACK pipeline. TRACK mode shows the blob-tracking controls, track FX rack, and the PER-BLOB overlay picker (PER-BLOB rendering still runs in both modes; only its UI is track-scoped). The Speed control was removed entirely — playbackRate is pinned to 1.

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

## Shader sources (generative GLSL library)

`src/shaderSource.js` adds a FOURTH source kind: `state.sourceKind === 'shader'`.
A library shader (Shadertoy-style raymarcher / procedural frag with `uTime` +
`uRes` uniforms) renders into its OWN canvas on its OWN small WebGL2 context
each frame, and that canvas feeds the pipeline exactly like a video element —
`ctx.drawImage`, `uploadVideoFrame`, blob detection, STRUCTURE/COLOR/FX all
stack on top. Key points:

- The module owns a separate GL context deliberately: it is the SOURCE side,
  upstream of the orchestrated effect context in glContext.js.
- `SHADER_SOURCES` (slug/label/tip/gradient/knobs) is the library registry —
  the Source-section picker grid AND the per-shader knob panel
  (`#shader-knob-grid`, built by `renderShaderKnobs()` in main.js) build
  themselves from it. Adding a library shader = write the frag, register in
  `SHADER_FRAGS` + `SHADER_SOURCES`. No index.html edits.
- Knob convention: each registry entry's `knobs` array ({key,label,tip,min,
  max,step,default}) drives the panel. The knob keyed `speed` is special —
  consumed JS-side as a rate multiplier on an ACCUMULATED phase clock
  (uploaded as `uTime`), so dragging Speed glides instead of teleporting the
  camera. All other knobs upload into the float array
  `uniform float uParams[8]` in declaration order (so a shader can expose up
  to 8 controls — no 4-knob ceiling; diveclouds reads uParams[0..3],
  phantomstar uParams[0..6]). Values live per-slug in shaderSource.js
  (`getShaderSourceParams` / `setShaderSourceParam`) — runtime state like
  shaderSlug/shaderRes, NOT part of saved looks.
- `SHADER_RES` presets: landscape 1920×1080 / square 1080×1080 / vertical
  1080×1920, picked via `#shader-res-group` (state.shaderRes, not part of
  looks). Switching res while live reloads the shader at the new size.
- renderFrame calls `renderShaderSourceFrame()` once per tick when active;
  `activeSource*` helpers in main.js handle the kind (always "playing", so
  motion detection and motion effects work against it).
- Library entries:
  - `diveclouds` — POV dive through a vast sunlit cumulus layer on a banked
    flight path, low sun burning through (volumetric FBM clouds, front-to-back
    march with opacity early-out; ported from Shadertoy 4sXGRM). Knobs: Speed
    (flight clock), Coverage (cloud threshold, uParams[0]), Zoom (FOV,
    uParams[1]), Sun (glare + scatter, uParams[2]), Tint (cool↔warm sky,
    uParams[3]).
  - `phantomstar` — kaleidoscopic IFS-fractal star tunnel (folded box fractal
    → N-fold radial pmod symmetry → volumetric neon accumulation with a
    travelling pulse; after aiekick's Phantom Star). 8 knobs: Speed, Fly
    (forward travel, uParams[0]), Arms (radial symmetry, uParams[1]), Morph
    (fold rate, uParams[2]), Glow (exposure, uParams[3]), Hue (Rodrigues
    rotation, uParams[4]), Pulse (ring accent, uParams[5]), Fade (depth
    falloff, uParams[6]).
  - `starnest` — Pablo Roman Andrioli's volumetric fractal starfield (MIT;
    Shadertoy XlfGRj). The iMouse rotation is replaced by an auto-tumble Spin
    knob. 8 knobs: Speed, Zoom (uParams[0]), Warp (the "magic formula"
    formuparam, uParams[1]), Tile (fold size, uParams[2]), Bright (uParams[3],
    ×0.005), Dark (dark matter, uParams[4]), Sat (uParams[5]), Spin
    (uParams[6]).
  - `hyperkart` — neon tube-racer flythrough: a curving SDF lattice tunnel
    lined with red/blue light strips, glow-accumulated then bounced once for
    wet reflections. Shadertoy port; the camera right-vector `vec3(Z.z,0,-Z)`
    was corrected to `-Z.x` (the 5-component form does not compile) and
    `lights` is explicitly zeroed. 6 knobs: Speed, Glow (exposure, uParams[0]),
    Roll (banking, uParams[1]), Hue (uParams[2]), Reflect (bounce strength,
    uParams[3]), Zoom (FOV, uParams[4]).

## Timeline UI (single transport bar)

The timeline is ONE bar at the bottom of the canvas (`#timeline-panel` →
`.timeline-bar`): play button · scrubbable track · time readout · segment
actions (+ Seg / Dup / Set / ✕). The track itself is the scrubber (pointer
down + drag seeks). Segments are direct-manipulation: drag the body to move
a segment between its neighbors (3px threshold separates click-select from
drag-move), drag either edge to retime, click to select. "+ Seg" drops a
1-second segment at the playhead. There are no start/end numeric inputs, no
mark-start/mark-end flow, and no separate floating video-controls popover —
all of that was removed. Space toggles play/pause globally.

## Output: recording vs. export

Two paths from the display canvas (`main-canvas`):
- **Rec** (topbar) — `canvas.captureStream` + `MediaRecorder` (mp4/webm), real-time,
  browser-controlled VBR. The quick-grab path (unchanged).
- **Export** (topbar → sidebar Export panel) — `src/exporter.js`: a WebCodecs
  `VideoEncoder` (H.264) + `mp4-muxer`, real-time capture at an explicit HIGH
  bitrate → clean native MP4. Far better quality than MediaRecorder. Each tick
  draws the display canvas into a FIXED-size offscreen canvas (so display resizes
  can't corrupt the stream; also enables Source/1080p/720p presets), timestamps by
  real elapsed time, and backpressure-drops if the encoder queue grows. Config
  (res / fps 30·60 / quality high·max) is transient `state.export*`, gated by
  `requireExportAccess('export')`. Codec level is chosen per resolution with an
  `isConfigSupported` fallback chain. Future enhancement: offline-deterministic
  render for clock-driven sources (frame-perfect, faster than real time) — needs a
  virtual-clock injection; not built.

## Active work context

See `lumisynthprd.md` for implementation status vs the original PRD. P2 (STRUCTURE → COLOR FBO chain) shipped. Track FX rack (echo/radar/heatmap) is implemented in TRACK mode. Curved hub lines are implemented as a general TRACK Lines style (`hubcurve`). Cloudflare Pages Functions + D1 auth/presets/export-gating scaffolding exists, with localhost-only internal login for testing before real D1 setup. P3 is WELL UNDERWAY: the FX RACK is a real GL rack (3 slots, drag-reorder, per-slot params, timeline-look + preset + persistence integration) with six true feedback effects (`flowfield`, `drag`, `lumadrag`, `tunnel`, `burnin`, `wobbletape`) plus the stateless signal/texture set (bloom, godrays, decayflow, feedbackwarp, crt, crtrolling, scanlines, degrade, noise) — see `src/glFx.js`. v8 replaced the COLOR rack with the single tabbed COLOR stage (MAPS / UNIQUE / CUSTOM + GRADE). June 2026 additions: the dreamcore COLOR pack (octopus, hologram, surveil, newsprint, sketch, polaroid, blacklight, dreamstatic, predator + earlier blackbody/hubble/abyss/sequin/risograph), two new STRUCTURE effects (`freqmod` FM oscillography — Dir/Mod/Wave/Thresh + Density knob for 120–300 scan rows via the optional `uParam4` 5th-param uniform; `motionedge`), the motion infrastructure (frame-history ring + `u_prev`), the `uTime` auto-upload convention in both dispatchers, the single-bar timeline, the TE-cream chrome redesign, and the generative SHADER LIBRARY source kind (`src/shaderSource.js` — `diveclouds`, `phantomstar`, `starnest`, `hyperkart`; raymarched/Shadertoy-style generators with registry-driven per-shader knobs: Speed glides via an accumulated phase clock, others upload via a `uParams[8]` float array, up to 8 controls each). Remaining P3: upgrading decayflow/feedbackwarp to real feedback, and Inv/Thermal moving from PER-BLOB into the FX RACK. `PRD_DECISIONS.md` logs what is deliberately out of scope. `REACTIVITY_PLAN.md` is the spec for a `Live` audio-reactive mode — a signal bus feeding a continuous mod matrix + an on-beat step sequencer, designed so a future MediaPipe VJ mode plugs into the same bus. **Phase 1 is built**: `src/audioReactive.js` (Web Audio FFT → `{bass,mid,high,level,beat}` — raw bands × per-band Gain trims + attack/release envelope; FLUX onset beat detector (`beatStep`, rise vs. rolling average — robust on sustained bass where a level test never re-fires); mic / file / source-track inputs) + a topbar `Live` toggle revealing a RIGHT-SIDE `#reactivity-panel` (a third app column, mirror of the left sidebar; will also host the mod matrix + step sequencer) with the meters + per-band calibration (bass/mid/high/level gain + beat sensitivity) on its own RAF loop. `state.live` and calibration are transient (not persisted). Phases 2–4 (mod matrix, step sequencer, polish) are not built. Native MP4 export also shipped — `src/exporter.js` (WebCodecs `VideoEncoder` H.264 + `mp4-muxer`, high bitrate) alongside the MediaRecorder `Rec` button; see the Output section above. A topbar **mute/unmute** toggle (`btn-mute`, video sources only) hears the working clip: audioReactive routes the shared `<video>` through a persistent monitor gain (`elSourceNode → monitorGain → destination`) created on first unmute (or first Live "Source" use). `createMediaElementSource` is once-only, so this gain — not `video.muted` — is the speaker control, and it's preserved across Live start/stop. Picking Live "Source" auto-unmutes.
