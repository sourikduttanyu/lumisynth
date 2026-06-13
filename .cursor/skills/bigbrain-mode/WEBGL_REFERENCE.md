# LumiSynth WebGL Reference

## Contributor Workflow

Use this reference when a developer says `use BigBrain mode` and provides TouchDesigner code for a new shader.

Minimum input required before editing:

- Effect slug and display label.
- Whether it is `COLOR`, `STRUCTURE`, `FX`, or `SOURCE` (feedback effects route to FX automatically; a no-input scene generator routes to SOURCE — the shader library).
- Real TouchDesigner GLSL/code.
- Mapping for each exposed parameter into `uParams.xyzw`.
- Any required nonstandard dependency. Supported: time (`uTime`, auto-uploaded), one feedback input (`u_feedback` in an FX RACK effect), one previous-raw-frame input (`u_prev`, ~4 frames back, glFilters only). Unsupported: multiple non-feedback inputs, external textures.

Do not add partial integrations. A shader is not complete until it is registered in the GL dispatcher, exposed in the UI, backed by schema/default state, and verified with the build.

## Runtime Pipeline

`renderFrame` in `src/main.js` is the orchestrator. Each frame:

1. Draws the active video/image source into the 2D display canvas.
2. Runs blob detection/tracking only when needed.
3. Resolves active stages with `resolveActivePipeline()` — `{ structure, colors, fx }`.
4. If GL stages exist, calls `ensureContext(cw, ch)` and `uploadVideoFrame(srcEl)` once.
5. Runs STRUCTURE, then COLOR, then FX stages (colors and fx are merged into one ordered `chained` list for the ping-pong loop).
6. Composites the shared GL canvas back to the 2D canvas once.
7. Applies legacy PER-BLOB CPU filters and TRACK overlays on top.

The GL contract lives in `src/glContext.js`: one offscreen WebGL2 canvas, one context, one shared video texture, one quad VAO, and two lazily allocated chain FBOs.

## Shared Shader Shape

All normal effects use this vertex pattern:

```glsl
#version 300 es
in vec2 a_pos;
out vec2 vUV;
void main() {
  vUV = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
```

Normal fragment shaders use:

```glsl
#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D u_video;
uniform vec4 uParams;
out vec4 fragColor;
```

STRUCTURE shaders that support output modes also use:

```glsl
uniform float uOutputMode;
```

and map their scalar structure result through the existing `applyStructureOutput(structure, src, mode)` helper pattern. The four modes are `mono` (0, grayscale on black), `source` (1, mask the source RGB), `ink` (2, black/cream poster via uInkLow/uInkHigh), and `invert` (3, negative of mono — `1.0 - structure`). The string→value map lives in `STRUCTURE_OUTPUT_MODE_VALUE` in main.js; `applyStructureOutput` is copy-pasted into every STRUCTURE shader (glFilters.js + ascii.js), so a new mode must be added to ALL copies.

Two OPTIONAL uniforms are auto-wired by the dispatchers (`applyGLFilter` in
glFilters.js and `applyFxEffect` in glFx.js) — declare them and they work,
omit them and they cost nothing (cached location is null, upload skipped):

```glsl
uniform float uTime;        // seconds (performance.now()/1000) — animation
uniform sampler2D u_prev;   // video frame from ~4 frames ago (glFilters only)
uniform float uParam4;      // optional 5th scalar (glFilters only) — see below
```

`uParam4` is the escape hatch from the 4-knob house pattern: BOTH dispatchers
(`applyGLFilter` and `applyFxEffect`) upload `params[4]` when the uniform
exists and a 5th value is passed. Pass a 5-element `order` array — `runEffect`
/ `runFxEffect` map the whole order and only pad to 4, so the 5th flows
through. Keep to 4 `uParams` slots by default; reach for `uParam4` only when a
5th control is clearly warranted. References: `freqmod`'s Density knob
(scan-row count 120–300, glFilters) and `lumadrag`'s Wobble knob (feedback FX,
glFx).

`u_prev` is backed by the frame-history ring in `glContext.js` (4 GPU-side
copies written by passthrough draws — no extra CPU uploads). `renderFrame`
calls `captureFrameHistory()` ONLY while a motion effect is active, so a new
motion effect must be added to that condition in `main.js`:

```js
if (pipe.structure === 'motionedge' || pipe.color?.type === 'predator') {
  captureFrameHistory();
}
```

The ring re-primes on source/segment change (`resetMotionHistory()` inside
`resetAllState`). Reference implementations: `motionedge` (STRUCTURE),
`predator` (COLOR UNIQUE / Motion).

## COLOR Stage (single, v8)

COLOR is ONE selected effect stored in `state.color` ('none' | any
`COLOR_SECTIONS` name). The 3-slot rack is gone — layering color looks
happens via timeline segments, not chained slots. Per-effect knob values
live in `state.colorParams[type]` (lazily factory-seeded; switching effects
and returning keeps tweaks).

The picker is three tabs sharing the one selection:

- **MAPS**: pure per-pixel color mapping (`COLOR_MAP_SECTIONS`) as a swatch
  grid, built at startup from data in `main.js`. The membership rule: the
  shader looks at ONE pixel and recolors it — no neighbor sampling, no
  added elements.
- **UNIQUE**: effects that BUILD something — neighbor sampling, added
  elements (stars, halos, streaks), displacement, glow, animation (uTime),
  motion response (u_prev). Organized by `COLOR_UNIQUE_SECTIONS` in
  `schemas.js`: an array of `{ key, label, effects }` categories
  (Atmosphere / Light / Dimension / Deep Sea / Print / Motion — add new
  rows as needed) rendered as in-grid headers. Still stateless single-frame
  passes — anything that accumulates across frames is an FX RACK feedback
  effect instead.
- **CUSTOM**: the `chroma` effect (ChromaEngine) — driver select
  (luma/inv/sat/edge/radial), 4 user ramp stops (hex strings in params →
  vec3 uniforms `uStop0..3` via `opts.stops`), Bands/Gamma knobs.

GRADE (always-on `colorHue`/`colorSat` knobs) post-processes whatever is
selected as its own internal `grade` chained pass — active even when
color = 'none'.

Important files:

- `src/schemas.js`: `COLOR_PARAM_SCHEMAS`, `COLOR_MAP_SECTIONS`, `COLOR_UNIQUE_SECTIONS`, `COLOR_SECTIONS`, `BLEND_MODES`, `makeFactoryParams()`.
- `src/glFilters.js`: all COLOR fragment shaders (incl. `chroma` and the internal `grade`) and the `FRAGS` registry.
- `src/main.js`: `runColorEffect()`, `runGradeEffect()`, `getColorParams()`, `setColor()`, `renderColorPanel()`, `buildColorMapsGrid()`, `buildColorUniqueGrid()`, `COLOR_SWATCH_GRADIENTS` / `COLOR_LABEL` / `COLOR_MAP_TIPS`.
- `index.html`: the static tab containers only — the grids, driver group, and knob panels are all built from data.

To add a COLOR effect (map or unique — only step 5 differs):

1. Choose a lowercase slug already absent from `COLOR_SECTIONS`.
2. Convert the TouchDesigner shader to the shared WebGL2 interface.
3. Add `const FRAG_<SLUG> = ...` in `src/glFilters.js` and register it in `FRAGS`.
4. Add `COLOR_PARAM_SCHEMAS[slug]`.
5. Route by behavior: per-pixel-only → add the slug to `COLOR_MAP_SECTIONS`; builds something → add it to a category's `effects` array in `COLOR_UNIQUE_SECTIONS` (or add a new category row). Never edit `COLOR_SECTIONS` directly — it derives from both.
6. Add the slug to `BLEND_MODES` as `source-over` unless the implementation deliberately needs another existing blend behavior.
7. Add `COLOR_SWATCH_GRADIENTS[slug]`, `COLOR_LABEL[slug]`, and `COLOR_MAP_TIPS[slug]` in `src/main.js`. No index.html edits — both grids build themselves.

`runColorEffect(name, params, opts)` builds the uniform tuple from `COLOR_PARAM_SCHEMAS[name].order` (padded to 4), so the schema order must exactly match the shader's `uParams.xyzw` usage. If a schema declares `colors` (like chroma), those params are hex strings delivered as vec3 uniforms via `opts.stops`.

Common miss: adding the shader and schema but forgetting `COLOR_LABEL`/`COLOR_SWATCH_GRADIENTS`/`COLOR_MAP_TIPS`. That compiles but the grid button renders unlabeled/unswatched.

## FX RACK

FX is a fixed three-slot rack stored in `state.fxRack`, slots shaped
`{ id, type, enabled, params }`, running AFTER the COLOR stage + GRADE pass
in the chain. Two kinds of effect live here, split by the schema's
`feedback` flag (which `runFxEffect` dispatches on):

- **Stateless signal/texture effects** (no flag): bloom, godrays, decayflow,
  feedbackwarp, crt, crtrolling, scanlines, degrade, noise. Shaders live in
  `glFilters.js` `FRAGS` and dispatch through `applyGLFilter` — identical
  mechanics to COLOR effects, just racked after the color stage. Follow the
  stateless FX checklist in SKILL.md; nothing below about feedback applies.
- **Feedback effects** (`feedback: true`): STATEFUL passes in `glFx.js` —
  flowfield, drag, lumadrag, tunnel, burnin, wobbletape. The one place in the app
  where a shader may sample its own previous-frame output. `applyFxEffect`
  also auto-uploads `uTime` to feedback shaders that declare it
  (wobbletape's flutter waves use this). The rest of this section
  describes these.

Important files:

- `src/glFx.js`: FX fragment shaders, the `FX_FRAGS` registry, `applyFxEffect()`, per-slot feedback FBO management, `resetFxFeedback(key?)`.
- `src/schemas.js`: `FX_PARAM_SCHEMAS`, `FX_SECTIONS`, `BLEND_MODES`, `makeFxFactoryParams()`, `makeFxRack()`.
- `src/main.js`: `runFxEffect()`, `renderFxRack()`, `FX_LABEL` / `FX_SWATCH_GRADIENTS` / `FX_CHIP_TIP`, slot mutations (which reset feedback), pipeline merge in `renderFrame`.
- `index.html`: `#fx-rack` (reuses `.color-rack-*` classes) and `#fx-picker-popover` buttons using `data-pick-fx`.

How feedback works (`applyFxEffect` handles all of this — a new effect normally
only adds a fragment shader and an `FX_FRAGS` entry):

1. Each slot id gets a ping-pong FBO pair, lazily allocated at canvas size, zero-filled (trails start black).
2. Pass 1: the effect shader reads `u_video` (chain input) + `u_feedback` (`pair.read.tex`) and writes `pair.write.fb`. Reading one side and writing the other satisfies the no-read-write-hazard rule.
3. Pass 2: a passthrough copy program draws `pair.write.tex` into the chain's requested `outputFBO` (or the GL canvas when terminal). This is a draw, NOT `gl.blitFramebuffer` — the default framebuffer may be antialiased and single→multisample blits throw INVALID_OPERATION.
4. The pair swaps: this frame's output is next frame's `u_feedback`.

FX shader interface (the only addition to the shared shape):

```glsl
uniform sampler2D u_video;     // chain input (raw video or upstream stage)
uniform sampler2D u_feedback;  // this slot's own output from last frame
uniform vec4 uParams;
```

Reset discipline — trails restart from black on: source change and timeline
segment change (`resetAllState` → `resetFxFeedback()`), slot swap / clear /
disable (`resetFxFeedback(slotId)` in the slot mutation helpers), and canvas
resize (size check inside `glFx.js`). Knob tweaks must NOT reset trails.

To add a feedback FX effect:

1. Choose a lowercase slug already absent from `FX_SECTIONS`.
2. Convert the TouchDesigner shader: feedback TOP input → `u_feedback`, primary input → `u_video`, keep the math verbatim.
3. Add `const FRAG_<SLUG> = ...` in `src/glFx.js` and register it in `FX_FRAGS`.
4. Add `FX_PARAM_SCHEMAS[slug]` with `feedback: true` (this routes dispatch to glFx.js) and an `order` array matching `uParams.xyzw`.
5. Add the slug to `FX_SECTIONS` and `BLEND_MODES` (normally `source-over`).
6. Add `FX_SWATCH_GRADIENTS[slug]`, `FX_LABEL[slug]`, `FX_CHIP_TIP[slug]` in `src/main.js`. No index.html edits — the picker popover is built from `FX_SECTIONS` at startup.

To add a stateless FX effect: same steps, but the shader goes in
`src/glFilters.js` `FRAGS` and the schema has NO `feedback` flag.

Reference implementations: `flowfield` (luma-gradient advection trails),
`drag` (directional smear whose vector is FM-wobbled per scanline by a
time-traveling sine — `uTime` declared, Wobble knob; wobble 0 = clean linear
drag), `lumadrag` (CLEAN luminance-gated drag — only content above the Gate
threshold seeds a trail and gets fed back, so dark areas never smear;
collinear multi-tap advection keeps streaks continuous and tight; Wobble knob
FM-bends the pull direction per scanline via the optional `uParam4` 5th-param;
built to pull bright line structure like FreqMod traces), `tunnel` (zoom/rotate
re-sampling of own output),
`burnin` (heat stored AS the visible phosphor color, recovered from feedback
luma — the palette must stay luma-monotonic for that trick to work), and
`wobbletape` (displacement that accumulates because each frame re-displaces
the already-displaced feedback). Note the contrast with the COLOR effect
`decayflow`, which is a stateless approximation of the same TouchDesigner
network — feedback effects flattened into COLOR never accumulate; that is
what the FX RACK exists for.

## STRUCTURE

STRUCTURE is a single selected stage stored in `state.structure`.

Current STRUCTURE effects:

- `ascii`
- `erode`
- `watershed`
- `pixelsort`
- `melt`
- `freqmod` — FM oscillography: luminance-driven waveform traces, Dir knob
  rotates the scan axis, Density knob sets the scan-row count 120–300 (via
  the optional `uParam4` 5th-param uniform — see Shared Shader Shape),
  animated via uTime
- `motionedge` — spatial edges + temporal motion via u_prev (requires the
  frame-history capture condition in renderFrame — see Shared Shader Shape)

Important files:

- `src/schemas.js`: default state keys, `STRUCTURE_SECTIONS`, `BLEND_MODES`.
- `src/glFilters.js`: most STRUCTURE fragment shaders.
- `src/ascii.js`: dedicated ASCII module.
- `src/main.js`: `runEffect()`, `TOGGLE_CONFIG`, `onStructureChange()`, card visibility.
- `index.html`: `#structure-group` buttons and one `<section id="<slug>-controls">` per STRUCTURE effect.

To add STRUCTURE:

1. Choose a lowercase slug already absent from `STRUCTURE_SECTIONS`.
2. Add default knob state to `DEFAULTS`, normally four values matching `uParams.xyzw`.
3. Add the slug to `STRUCTURE_SECTIONS`.
4. Add `BLEND_MODES[slug]`.
5. Add a fragment shader to `src/glFilters.js` and register it in `FRAGS`, unless a dedicated module is justified.
6. Add a `runEffect()` case that maps state keys to `[p0, p1, p2, p3]` and passes `{ ...opts, outputMode }`.
7. Add a `#structure-group` button in `index.html`.
8. Add a matching controls section:

```html
<section class="effect-card hidden" id="slug-controls" data-card-effect="slug" data-mode-section="synth" aria-label="Label parameters">
  ...
</section>
```

9. Ensure any toggle group in the new section has a `TOGGLE_CONFIG` entry in `src/main.js`.
10. If persisted state shape changes, bump `STORAGE_KEY`.

Common miss: adding `STRUCTURE_SECTIONS` and the shader but forgetting the controls section. `refreshEffectCardVisibility()` expects a matching `id="<slug>-controls"` card for visible controls.

## Shader Sources (generative library)

A FOURTH source kind alongside video/webcam/image: `state.sourceKind ===
'shader'`. A library shader is a self-contained generator (raymarcher /
procedural scene) that IS the input — it has no `u_video`. It lives in
`src/shaderSource.js`, which owns its OWN small WebGL2 context (the SOURCE
side, deliberately separate from the orchestrated effect context in
glContext.js). Each frame `renderShaderSourceFrame()` draws the active
shader into that module's canvas, and `renderFrame` then treats the canvas
exactly like a video element — `ctx.drawImage`, `uploadVideoFrame`, blob
detection — so STRUCTURE/COLOR/FX all stack on top. A shader source is
always "playing", so motion detection and `u_prev` motion effects work
against it.

Source shader interface (note: NO `u_video`):

```glsl
#version 300 es
precision highp float;
in vec2 vUV;
uniform float uTime;       // accumulated phase (see Speed below), seconds-scaled
uniform vec2  uRes;        // output resolution in px (for aspect correction)
uniform float uParams[8];  // knob values, indexed in declaration order
out vec4 fragColor;
```

The library is registry-driven — both the Source-section picker grid and the
per-shader knob panel (`#shader-knob-grid`, built by `renderShaderKnobs()` in
main.js) build themselves from `SHADER_SOURCES`. Adding a library shader is
just two registrations in `src/shaderSource.js`, no `index.html` or `main.js`
edits:

- `SHADER_FRAGS[slug]` = the fragment shader source.
- `SHADER_SOURCES` entry `{ slug, label, tip, gradient, knobs }`. `gradient`
  is the picker swatch CSS; `knobs` is `{ key, label, tip, min, max, step,
  default }[]`.

Knob convention:

- A knob keyed `speed` is consumed JS-side as a rate multiplier on an
  ACCUMULATED phase clock (`M.phase += dt * speed`, uploaded as `uTime`), so
  dragging Speed glides the animation rather than teleporting it (a plain
  `uTime * speed` would jump position on every change). Use `speed` for any
  flow/flight/time control.
- Every other knob uploads into the float array `uniform float uParams[8]`
  in registry declaration order (read `uParams[0]`, `uParams[1]`, …). Up to 8
  non-speed knobs — there is no 4-knob ceiling for shader sources. The JS
  uploads via `gl.uniform1fv` from a reused buffer; the GLSL array size (8)
  is fixed across all source shaders.
- Values live per-slug in shaderSource.js (`getShaderSourceParams` /
  `setShaderSourceParam`) — session runtime state like `shaderSlug` /
  `shaderRes`, NOT part of saved looks. Do not add them to `DEFAULTS`.

`SHADER_RES` presets (landscape 1920×1080 / square 1080×1080 / vertical
1080×1920) are picked via `#shader-res-group`; switching res while a shader
is live reloads it at the new size.

Reference implementations:
- `goldclouds` — raymarched volumetric cloud-tunnel flight. FBM density uses
  an octave-rotation matrix (`ROT3`) to kill the axis-aligned lattice cross
  that value noise otherwise produces; knobs Speed (phase clock), Zoom (FOV →
  uParams[0]), Sway (path-weave → uParams[1], scaling the shared `axisOff`),
  Clouds (density threshold → uParams[2]).
- `phantomstar` — kaleidoscopic IFS-fractal star tunnel ported from a
  Shadertoy (aiekick): `iTime`→`uTime`, `iResolution`→`uRes`,
  `mainImage(out,in)` → `main()` reading `vUV * uRes` as fragCoord. Eight
  knobs (Speed, Fly, Arms, Morph, Glow, Hue, Pulse, Fade) — a good model for
  porting any Shadertoy `mainImage` shader and exposing its constants.
- `starnest` — Pablo Roman Andrioli's volumetric fractal starfield (MIT).
  Same port pattern, plus the standard `iMouse` substitution: there is no
  pointer input in the library, so the mouse-driven rotation became an
  auto-tumble Spin knob driven by `uTime`. Use this approach for any
  iMouse-dependent Shadertoy shader.

If a generator needs external textures or multiple inputs (beyond time,
resolution, and up to 8 knobs), flag that before coding — the source
interface is otherwise deliberately minimal.

## Chain Behavior

Single stage:

- Effect writes to the default framebuffer.
- `compositeToCanvas2D` composites once using `BLEND_MODES[effect]`.

Multiple stages:

- STRUCTURE writes to `chain.a`.
- If the STRUCTURE blend mode is `screen`, `applyCompose()` screen-blends it over raw video into `chain.b`.
- COLOR, then GRADE (when the grade knobs are off neutral), then FX stages ping-pong between `chain.a` and `chain.b` (one merged `chained` list).
- The last chained stage writes to the default framebuffer.
- `compositeToCanvas2D` uses the terminal stage blend mode.
- FX stages additionally write their own persistent feedback FBOs internally (glFx.js) — invisible to the chain, which just sees inputTex → outputFBO.

Do not cache FBO or texture handles across frames; `ensureContext()` disposes and reallocates chain FBOs on resize.

## TouchDesigner Conversion Notes

Translate only what is present in the supplied code.

- Map the primary input texture (`sTD2DInputs[0]`) to `u_video`.
- Map a feedback input (`sTD2DInputs[1]` fed by a Feedback TOP) to `u_feedback` — this makes the effect an FX RACK effect in `src/glFx.js`.
- Map UVs (`vUV.st`) to `vUV`.
- Map output color to `fragColor`; `TDOutputSwizzle(...)` is identity — drop the wrapper.
- `textureSize(sTD2DInputs[0], 0)` → `textureSize(u_video, 0)`; `uTDOutputInfo.res` equivalents derive from `textureSize` too.
- Pack up to four user parameters into `uParams.xyzw`. The house pattern for
  TD shaders with 8 params (uParams + uLook): keep the most interactive four
  as knobs and bake the rest as constants with a comment noting the baked
  values.
- If more than four parameters are required, ask before extending the shader interface.
- Time IS supported: declare `uniform float uTime` and both dispatchers
  upload seconds automatically. A single previous-raw-frame input (~4 frames
  back) is supported in glFilters via `uniform sampler2D u_prev` plus the
  renderFrame capture condition. Multiple non-feedback inputs or external
  textures remain unsupported — identify that requirement before editing.
- STRUCTURE and COLOR effects are stateless single-frame passes. Feedback/temporal behavior belongs in the FX RACK (`src/glFx.js`) — do not silently flatten a feedback network into a stateless approximation.

## Verification Targets

For COLOR:

- Map appears in the MAPS grid with its swatch and label.
- Clicking it selects it (orange active border) and its knobs render below the grid.
- Knob tweaks render live and persist per effect — switch to another map and back, values held.
- The GRADE Hue/Sat knobs re-tint the map's output.
- Build passes.

For STRUCTURE:

- Effect appears in the STRUCTURE picker.
- Selecting it reveals only its controls card.
- Knobs/toggles update rendering.
- The COLOR stage can process the STRUCTURE output.
- `mono`, `source`, `ink`, and `invert` output modes work if supported.
- Build passes.

For FX (stateless):

- Effect appears in the FX picker and fills a slot with factory params.
- Works in any slot, chained before/after other FX, and as the terminal stage.
- Build passes.

For FX (feedback):

- Effect appears in the FX picker and fills a slot with factory params.
- Trails/feedback visibly accumulate over time on a moving source.
- Knob tweaks do NOT reset accumulated trails.
- Slot swap / clear / disable and source change DO reset trails to black.
- Works mid-chain (COLOR stage before it) and as the terminal stage.
- Two slots running the same effect accumulate independently.
- Build passes.

For SOURCE (shader library):

- Shader appears in the Source > Shader Library grid with its swatch and label.
- Clicking it makes it the live source (`state.sourceKind === 'shader'`).
- Its knobs render in the Source section and drive the render live.
- A `speed` knob glides the animation — speed 0 freezes it (consecutive frames pixel-identical), higher values move faster.
- The res presets (16:9 / 1:1 / 9:16) reload it at the new dimensions.
- STRUCTURE / COLOR / FX stack on top of the shader output.
- Build passes.
