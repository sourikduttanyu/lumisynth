---
name: bigbrain-mode
description: Adds TouchDesigner-derived WebGL effects to LumiSynth. Use when the user says "use BigBrain mode" in any casing, or provides TouchDesigner GLSL/code and asks to add a COLOR, STRUCTURE, or FX (feedback) effect to this repo.
disable-model-invocation: true
---

# BigBrain Mode

## Trigger

When the user says `use BigBrain mode` in any casing, enter this workflow before modifying code.

## Purpose

Help developers convert real TouchDesigner GLSL/code into LumiSynth WebGL2 effects and wire them into the app as one of:

- `COLOR (MAPS)`: a pure per-pixel color map in the COLOR stage's MAPS tab — ramps, grades, palette swaps; the shader looks at one pixel only. Stateless single-frame pass. (v8 retired the color rack; one color is selected at a time and looks are layered via timeline segments.)
- `COLOR (UNIQUE)`: an effect in the COLOR stage's UNIQUE tab — it BUILDS something: samples neighbors, adds elements (stars, halos, streaks), displaces, glows, animates (uTime), or responds to motion (u_prev). Stateless single-frame pass, organized into labeled categories (Atmosphere / Light / Dimension / Deep Sea / Print / Motion / new ones as needed).
- `STRUCTURE`: the single geometry/pattern stage that feeds the COLOR stage. Stateless single-frame pass.
- `FX`: a rack slot effect in the FX RACK, which runs AFTER COLOR + GRADE. Two kinds: stateless signal/texture passes (bloom, CRT, grain — single-frame, shaders in glFilters.js), and feedback passes (`feedback: true` in the schema, shaders in glFx.js) where each slot keeps a persistent feedback texture between frames (`u_feedback`) — the right target for TouchDesigner networks built around a Feedback TOP (trails, decay, recursive warps).
- `SOURCE`: a generative shader in the SHADER LIBRARY (`src/shaderSource.js`) — a self-contained raymarcher / procedural frag (e.g. a Shadertoy-style image) that IS the input, upstream of the whole effect chain. It renders into its own WebGL2 canvas and feeds the pipeline exactly like a video element, so STRUCTURE/COLOR/FX all stack on top. Use this when the supplied code is a complete scene generator (no `u_video` input), not an effect applied TO footage.

The goal is a complete repo integration, not just a shader paste. A finished change should compile, appear in the UI, persist correctly, and respect the existing render pipeline.

Routing rule: if the supplied TouchDesigner code samples a feedback input (e.g. `sTD2DInputs[1]` fed by a Feedback TOP) or otherwise depends on its own previous-frame output, it belongs in `FX`. Do not flatten it into a stateless COLOR approximation unless the user explicitly asks for that (see `decayflow` vs `flowfield` for the difference).

Source vs effect rule: if the supplied shader generates a complete image from scratch with NO input texture (a raymarcher, a procedural scene, a Shadertoy `mainImage` that only reads `iTime`/`iResolution`), it is a `SOURCE` for the SHADER LIBRARY, not an effect. Effects (COLOR/STRUCTURE/FX) all transform an existing `u_video`; sources replace it.

## First Moves

1. Read `CLAUDE.md`.
2. Read `WEBGL_REFERENCE.md` in this skill directory.
3. Inspect the current implementation before editing:
   - `src/schemas.js`
   - `src/glFilters.js`
   - `src/glFx.js` if the effect is FX (feedback/temporal)
   - `src/main.js`
   - `index.html`
   - `src/glContext.js` if the change touches GL orchestration.
4. Work on a branch that is not `main`:
   - Run `git status --short` and `git branch --show-current`.
   - If the current branch is `main`, create a new branch named `bigbrain/<effect-slug>` before edits.
   - Preserve unrelated dirty work. Do not reset, checkout, or overwrite user changes.

## Input Discipline

- Do not guess what a TouchDesigner uniform, texture input, channel, or parameter means. If the provided code is incomplete, say: `I don't know based on the provided information.` Then ask for the missing code or parameter mapping.
- Do not invent mock shaders, placeholder palettes, or sample parameter values. Use values from the supplied code or ask the user to choose.
- If the user does not say whether the effect is COLOR, STRUCTURE, FX, or SOURCE, ask before editing — except when the code clearly depends on a feedback input (routes to FX) or clearly has no input texture and generates a whole image (routes to SOURCE) — see the routing rules above.
- Require real source material: TouchDesigner GLSL/code, intended effect name, COLOR vs STRUCTURE vs FX target, and parameter mapping for each exposed knob/toggle.
- Supported dependencies: time (declare `uniform float uTime` — auto-uploaded by both dispatchers), a single feedback input (FX RACK, `u_feedback`), and a single previous-raw-frame input (`uniform sampler2D u_prev`, ~4 frames back, glFilters only — also add the effect to renderFrame's `captureFrameHistory()` condition in main.js). If the code needs multiple non-feedback TOP inputs, external textures, or more than four user parameters, identify that dependency before coding. For 8-param TD shaders (uParams + uLook), the house pattern: keep the four most interactive as knobs, bake the rest with a comment.

## Developer Prompt Shape

Ask developers to provide:

```text
use BigBrain mode

Add this as a COLOR effect named <effect-slug>.
Here is the TouchDesigner GLSL/code:
<real code>

Parameter mapping:
uParams.x = ...
uParams.y = ...
uParams.z = ...
uParams.w = ...
```

For STRUCTURE, the prompt should say `Add this as a STRUCTURE effect` and include the desired output behavior for `mono`, `source`, `ink`, and `invert`.

For FX, the prompt should say `Add this as an FX effect` and identify which TouchDesigner input is the feedback (`sTD2DInputs[1]` etc.).

## Integration Rules

- Keep the app vanilla JS + Vite + raw WebGL2. Do not add TypeScript, frameworks, component libraries, Tailwind, three.js, or transpilation.
- Prefer stateless single-pass WebGL2 effects in `src/glFilters.js`. Feedback/temporal effects go in `src/glFx.js` as FX RACK effects.
- Match the existing shader interface: `in vec2 vUV`, `uniform sampler2D u_video`, `uniform vec4 uParams`, `out vec4 fragColor`. FX shaders add `uniform sampler2D u_feedback` (previous frame's own output).
- Always call `gl.bindAttribLocation(prog, 0, 'a_pos')` before linking if creating a new program.
- Do not upload video or composite inside effect modules. `renderFrame` owns `ensureContext`, `uploadVideoFrame`, GL dispatch, and `compositeToCanvas2D`.
- Never read and write the same FBO texture in one draw. FX effects satisfy this with a per-slot ping-pong feedback pair (read one side, write the other, swap after the copy pass).
- FX feedback state must reset to black on source change, timeline segment change, slot swap/clear/disable, and resize — and must NOT reset on knob tweaks. `glFx.js` exports `resetFxFeedback(key?)`; slot mutations and `resetAllState` in `main.js` already call it.
- Copy FX output to the chain via a passthrough draw, never `gl.blitFramebuffer` (the default framebuffer may be antialiased; single→multisample blits are INVALID_OPERATION in WebGL2).

## COLOR Effect Checklist (MAPS and UNIQUE)

Add the effect to the COLOR stage's library. Do NOT touch the tab/panel
mechanics in `main.js` — the grids and knob panels build themselves from the
data below. The ONLY difference between a MAPS add and a UNIQUE add is step 3.

1. `src/glFilters.js`: add a `FRAG_<NAME>` shader and register it in `FRAGS`.
2. `src/schemas.js`: add `COLOR_PARAM_SCHEMAS[slug]` with knobs/toggles and an `order` array matching `uParams.xyzw`.
3. `src/schemas.js`: route by behavior —
   - Pure per-pixel mapping (no neighbor samples, no added elements): add the slug to `COLOR_MAP_SECTIONS`.
   - Builds something (neighbor sampling, added elements, displacement): add the slug to an existing category's `effects` array in `COLOR_UNIQUE_SECTIONS`, or add a new `{ key, label, effects }` category row if none fits.
   - Never edit `COLOR_SECTIONS` directly — it derives from both lists.
4. `src/schemas.js`: add the slug to `BLEND_MODES` (normally `source-over`).
5. `src/main.js`: add `COLOR_SWATCH_GRADIENTS[slug]`, `COLOR_LABEL[slug]`, and `COLOR_MAP_TIPS[slug]` entries. No index.html edits — both grids are built from these at startup.
6. Verify: the effect appears in its tab (with its category header if UNIQUE), clicking it selects it and renders its knobs, knob tweaks persist per effect (switch away and back — values held), and the GRADE knobs re-tint it.

## FX Effect Checklist

Add the effect as a per-slot FX RACK stage (runs after the COLOR stage + GRADE).
First decide which kind it is:

**Stateless signal/texture effect** (single-frame — bloom/CRT/grain family):

1. `src/glFilters.js`: add a `FRAG_<NAME>` shader and register it in `FRAGS` (NOT glFx.js — that module is feedback-only).
2. `src/schemas.js`: add `FX_PARAM_SCHEMAS[slug]` (no `feedback` flag) with knobs and an `order` array matching `uParams.xyzw`.
3. `src/schemas.js`: add the slug to `FX_SECTIONS` and `BLEND_MODES`.
4. `src/main.js`: add `FX_SWATCH_GRADIENTS`, `FX_LABEL`, and `FX_CHIP_TIP` entries. No index.html edits — the picker popover builds itself from `FX_SECTIONS`.
5. Verify it works in any rack slot, chained before/after other FX, and persists.

**Feedback effect** (TouchDesigner Feedback TOP networks):

1. `src/glFx.js`: add a `FRAG_<NAME>` shader (with `u_video` + `u_feedback`) and register it in `FX_FRAGS`. The shared `applyFxEffect` already handles the feedback ping-pong, the copy pass, and per-slot buffer keying — a new effect normally only needs the fragment shader and registry entry.
2. `src/schemas.js`: add `FX_PARAM_SCHEMAS[slug]` WITH `feedback: true` (this is what routes dispatch to glFx.js) and an `order` array matching `uParams.xyzw`.
3. `src/schemas.js`: add the slug to `FX_SECTIONS` and `BLEND_MODES`.
4. `src/main.js`: add `FX_SWATCH_GRADIENTS`, `FX_LABEL`, and `FX_CHIP_TIP` entries. No index.html edits.
5. Verify the effect works in any rack slot, that trails accumulate over time, that knob tweaks do NOT reset trails, and that slot swap/clear/disable + source change DO reset them.

## STRUCTURE Effect Checklist

Add the effect as the single STRUCTURE stage:

1. `src/schemas.js`: add default state keys for the structure knobs.
2. `src/schemas.js`: add the slug to `STRUCTURE_SECTIONS` and `BLEND_MODES`.
3. `src/glFilters.js`: add a `FRAG_<NAME>` shader and register it in `FRAGS`, unless it needs a dedicated module like `src/ascii.js`.
4. `src/main.js`: add `runEffect` dispatch with the correct state-to-`uParams` order.
5. `index.html`: add the structure picker button and a matching `<section id="<slug>-controls">`.
6. If persisted state shape changes, bump `STORAGE_KEY` and explain why.
7. Verify output modes `mono`, `source`, `ink`, and `invert` if the shader emits a structure mask.

## SOURCE Effect Checklist (shader library)

Add a generative shader to the SHADER LIBRARY in `src/shaderSource.js`. This
module owns its OWN small WebGL2 context (the source side, upstream of the
effect context in glContext.js) and renders the active shader into its own
canvas each frame. The library is registry-driven: the Source-section picker
grid AND the per-shader knob panel build themselves from `SHADER_SOURCES`.
NO `index.html` edits, NO `main.js` plumbing — just the two registrations.

1. `src/shaderSource.js`: write the fragment shader against the source
   interface (`in vec2 vUV`, `uniform float uTime`, `uniform vec2 uRes`,
   optional `uniform float uParams[8]`, `out vec4 fragColor` — NO `u_video`).
   Register it in `SHADER_FRAGS` under its slug.
2. `src/shaderSource.js`: add a `SHADER_SOURCES` entry
   `{ slug, label, tip, gradient, knobs }`. The `gradient` is the picker
   swatch CSS. `knobs` is an array of `{ key, label, tip, min, max, step,
   default }`.
3. Knob convention:
   - A knob keyed `speed` is special — consumed JS-side as a rate multiplier
     on an ACCUMULATED phase clock (uploaded as `uTime`), so dragging it
     glides the animation instead of teleporting it. Use `speed` for any
     "flow/flight/time" control.
   - All other knobs upload into `uniform float uParams[8]` in declaration
     order (read `uParams[0]`, `uParams[1]`, …) — up to 8, no 4-knob ceiling
     for shader sources.
   - Knob values live per-slug in shaderSource.js
     (`getShaderSourceParams` / `setShaderSourceParam`) — runtime state like
     `shaderSlug` / `shaderRes`, NOT part of saved looks. Do not add them to
     `DEFAULTS` or the look schema.
4. Anti-lattice note for FBM/value-noise raymarchers: rotate the domain each
   octave (see `goldclouds`' `ROT3` matrix) or axis-aligned noise reads as a
   fake cross.
5. Verify: the shader appears in the Source > Shader Library grid, clicking
   it makes it the live source (`state.sourceKind === 'shader'`), its knobs
   render in the Source section and drive the render live, Speed glides
   (speed 0 = frozen, consecutive frames pixel-identical), the res presets
   (16:9 / 1:1 / 9:16) reload it at the new size, and STRUCTURE/COLOR/FX
   stack on top of it.

## Verification

Run `npm run build`. If browser behavior changed, also run or manually verify with `npm run dev` because this repo has no required linter and visual correctness matters.

Before finishing, report:

- Branch name used.
- Files changed.
- Whether the effect was added as COLOR, STRUCTURE, or FX.
- Verification command results.
