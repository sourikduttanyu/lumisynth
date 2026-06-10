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

- `COLOR`: a rack slot effect that can run in any of the three chained color slots. Stateless single-frame pass.
- `STRUCTURE`: the single geometry/pattern stage that feeds the COLOR rack. Stateless single-frame pass.
- `FX`: a rack slot effect in the FX RACK, which runs AFTER the COLOR rack. Stateful — each slot keeps a persistent feedback texture between frames (`u_feedback`), so this is the right target for TouchDesigner networks built around a Feedback TOP (trails, decay, recursive warps).

The goal is a complete repo integration, not just a shader paste. A finished change should compile, appear in the UI, persist correctly, and respect the existing render pipeline.

Routing rule: if the supplied TouchDesigner code samples a feedback input (e.g. `sTD2DInputs[1]` fed by a Feedback TOP) or otherwise depends on its own previous-frame output, it belongs in `FX`. Do not flatten it into a stateless COLOR approximation unless the user explicitly asks for that (see `decayflow` vs `flowfield` for the difference).

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
- If the user does not say whether the effect is COLOR, STRUCTURE, or FX, ask before editing — except when the code clearly depends on a feedback input, which routes to FX (see routing rule above).
- Require real source material: TouchDesigner GLSL/code, intended effect name, COLOR vs STRUCTURE vs FX target, and parameter mapping for each exposed knob/toggle.
- If the TouchDesigner code depends on time, multiple non-feedback TOP inputs, external textures, or more than four user parameters, identify that dependency before coding. Single-feedback-input dependency is supported via the FX RACK.

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

For STRUCTURE, the prompt should say `Add this as a STRUCTURE effect` and include the desired output behavior for `mono`, `source`, and `ink`.

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

## COLOR Effect Checklist

Add the effect as a per-slot COLOR stage:

1. `src/glFilters.js`: add a `FRAG_<NAME>` shader and register it in `FRAGS`.
2. `src/schemas.js`: add `COLOR_PARAM_SCHEMAS[slug]` with knobs/toggles and an `order` array matching `uParams.xyzw`.
3. `src/schemas.js`: add the slug to `COLOR_SECTIONS` and `BLEND_MODES`.
4. `src/main.js`: add swatch, label, and chip tooltip entries.
5. `index.html`: add a `data-pick-color="<slug>"` picker button.
6. Verify the effect works in any rack slot, with per-slot params, enable/disable, clear, and reorder.

## FX Effect Checklist

Add the effect as a per-slot FX RACK stage (runs after the COLOR rack):

1. `src/glFx.js`: add a `FRAG_<NAME>` shader (with `u_video` + `u_feedback`) and register it in `FX_FRAGS`. The shared `applyFxEffect` already handles the feedback ping-pong, the copy pass, and per-slot buffer keying — a new effect normally only needs the fragment shader and registry entry.
2. `src/schemas.js`: add `FX_PARAM_SCHEMAS[slug]` with knobs/toggles and an `order` array matching `uParams.xyzw`.
3. `src/schemas.js`: add the slug to `FX_SECTIONS` and `BLEND_MODES`.
4. `src/main.js`: add `FX_SWATCH_GRADIENTS`, `FX_LABEL`, and `FX_CHIP_TIP` entries.
5. `index.html`: add a `data-pick-fx="<slug>"` button to `#fx-picker-popover`.
6. Verify the effect works in any rack slot, that trails accumulate over time, that knob tweaks do NOT reset trails, and that slot swap/clear/disable + source change DO reset them.

## STRUCTURE Effect Checklist

Add the effect as the single STRUCTURE stage:

1. `src/schemas.js`: add default state keys for the structure knobs.
2. `src/schemas.js`: add the slug to `STRUCTURE_SECTIONS` and `BLEND_MODES`.
3. `src/glFilters.js`: add a `FRAG_<NAME>` shader and register it in `FRAGS`, unless it needs a dedicated module like `src/ascii.js`.
4. `src/main.js`: add `runEffect` dispatch with the correct state-to-`uParams` order.
5. `index.html`: add the structure picker button and a matching `<section id="<slug>-controls">`.
6. If persisted state shape changes, bump `STORAGE_KEY` and explain why.
7. Verify output modes `mono`, `source`, and `ink` if the shader emits a structure mask.

## Verification

Run `npm run build`. If browser behavior changed, also run or manually verify with `npm run dev` because this repo has no required linter and visual correctness matters.

Before finishing, report:

- Branch name used.
- Files changed.
- Whether the effect was added as COLOR, STRUCTURE, or FX.
- Verification command results.
