# LumiSynth WebGL Reference

## Contributor Workflow

Use this reference when a developer says `use BigBrain mode` and provides TouchDesigner code for a new shader.

Minimum input required before editing:

- Effect slug and display label.
- Whether the effect is `COLOR`, `STRUCTURE`, or `FX` (feedback effects route to FX automatically).
- Real TouchDesigner GLSL/code.
- Mapping for each exposed parameter into `uParams.xyzw`.
- Any required nonstandard dependency, such as time, multiple non-feedback inputs, or external textures. A single feedback input is supported — it becomes `u_feedback` in an FX RACK effect.

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

and map their scalar structure result through the existing `applyStructureOutput(structure, src, mode)` helper pattern.

## COLOR Rack

COLOR is a fixed three-slot rack stored in `state.colorRack`.

Each slot has:

```js
{ id, type, enabled, params }
```

Only enabled, non-empty slots render. Slots run in order; slot 0 feeds slot 1, slot 1 feeds slot 2. Each slot owns its own params, so two slots can use the same effect with different knob values.

Important files:

- `src/schemas.js`: `COLOR_PARAM_SCHEMAS`, `COLOR_SECTIONS`, `BLEND_MODES`, `makeFactoryParams()`, `makeColorRack()`.
- `src/glFilters.js`: all current COLOR fragment shaders and the `FRAGS` registry.
- `src/main.js`: `runColorEffect()`, `renderColorRack()`, `renderSlotPanel()`, picker state, rack labels, swatches, and chip tips.
- `index.html`: static `#color-picker-popover` buttons using `data-pick-color`.

To add COLOR:

1. Choose a lowercase slug already absent from `COLOR_SECTIONS`.
2. Convert the TouchDesigner shader to the shared WebGL2 interface.
3. Add `const FRAG_<SLUG> = ...` in `src/glFilters.js`.
4. Add `<slug>: FRAG_<SLUG>` to `FRAGS`.
5. Add `COLOR_PARAM_SCHEMAS[slug]`.
6. Add slug to `COLOR_SECTIONS`.
7. Add slug to `BLEND_MODES` as `source-over` unless the implementation deliberately needs another existing blend behavior.
8. Add `RACK_SWATCH_GRADIENTS[slug]`, `RACK_LABEL[slug]`, and `RACK_CHIP_TIP[slug]` in `src/main.js`.
9. Add an `index.html` picker button:

```html
<button type="button" class="color-pick" data-pick-color="slug" data-tip="...">Label</button>
```

`runColorEffect(name, params, opts)` builds the uniform tuple from `COLOR_PARAM_SCHEMAS[name].order`, so the schema order must exactly match the shader's `uParams.xyzw` usage.

Common miss: adding the shader and schema but forgetting the picker button or `RACK_LABEL`/`RACK_CHIP_TIP`. That compiles but makes the effect hard or impossible to select cleanly.

## FX RACK

FX is a fixed three-slot rack stored in `state.fxRack`, same slot shape as the
COLOR rack (`{ id, type, enabled, params }`), running AFTER the COLOR rack in
the chain. Effects are STATEFUL feedback passes — the one place in the app
where a shader may sample its own previous-frame output.

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

To add FX:

1. Choose a lowercase slug already absent from `FX_SECTIONS`.
2. Convert the TouchDesigner shader: feedback TOP input → `u_feedback`, primary input → `u_video`, keep the math verbatim.
3. Add `const FRAG_<SLUG> = ...` in `src/glFx.js` and register it in `FX_FRAGS`.
4. Add `FX_PARAM_SCHEMAS[slug]` with an `order` array matching `uParams.xyzw`.
5. Add the slug to `FX_SECTIONS` and `BLEND_MODES` (normally `source-over`).
6. Add `FX_SWATCH_GRADIENTS[slug]`, `FX_LABEL[slug]`, `FX_CHIP_TIP[slug]` in `src/main.js`.
7. Add an `index.html` picker button: `<button type="button" class="color-pick" data-pick-fx="slug" data-tip="...">Label</button>`.

Reference implementation: `flowfield` (luma-gradient advection trails). Note
the contrast with the COLOR effect `decayflow`, which is a stateless
approximation of the same TouchDesigner network — feedback effects flattened
into COLOR never accumulate; that is what the FX RACK exists for.

## STRUCTURE

STRUCTURE is a single selected stage stored in `state.structure`.

Current STRUCTURE effects:

- `ascii`
- `erode`
- `watershed`
- `pixelsort`
- `melt`

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

## Chain Behavior

Single stage:

- Effect writes to the default framebuffer.
- `compositeToCanvas2D` composites once using `BLEND_MODES[effect]`.

Multiple stages:

- STRUCTURE writes to `chain.a`.
- If the STRUCTURE blend mode is `screen`, `applyCompose()` screen-blends it over raw video into `chain.b`.
- COLOR then FX stages ping-pong between `chain.a` and `chain.b` (one merged `chained` list, colors first).
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
- Pack up to four user parameters into `uParams.xyzw`.
- If more than four parameters are required, ask before extending the shader interface.
- If TouchDesigner code depends on time, multiple non-feedback inputs, or external textures, identify the missing requirement before editing.
- STRUCTURE and COLOR effects are stateless single-frame passes. Feedback/temporal behavior belongs in the FX RACK (`src/glFx.js`) — do not silently flatten a feedback network into a stateless approximation.

## Verification Targets

For COLOR:

- Effect appears in the picker.
- Selecting it fills a slot, enables it, and factory params appear when expanded.
- Knobs/toggles update only that slot.
- Reordering slots changes the chain order without crashing.
- Build passes.

For STRUCTURE:

- Effect appears in the STRUCTURE picker.
- Selecting it reveals only its controls card.
- Knobs/toggles update rendering.
- COLOR rack can process the STRUCTURE output.
- `mono`, `source`, and `ink` output modes work if supported.
- Build passes.

For FX:

- Effect appears in the FX picker and fills a slot with factory params.
- Trails/feedback visibly accumulate over time on a moving source.
- Knob tweaks do NOT reset accumulated trails.
- Slot swap / clear / disable and source change DO reset trails to black.
- Works mid-chain (COLOR stage before it) and as the terminal stage.
- Two slots running the same effect accumulate independently.
- Build passes.
