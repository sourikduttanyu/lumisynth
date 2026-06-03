---
name: bigbrain-mode
description: Adds TouchDesigner-derived WebGL effects to LumiSynth. Use when the user says "use BigBrain mode" in any casing, or provides TouchDesigner GLSL/code and asks to add a COLOR or STRUCTURE effect to this repo.
disable-model-invocation: true
---

# BigBrain Mode

## Trigger

When the user says `use BigBrain mode` in any casing, enter this workflow before modifying code.

## Purpose

Help developers convert real TouchDesigner GLSL/code into LumiSynth WebGL2 effects and wire them into the app as either:

- `COLOR`: a rack slot effect that can run in any of the three chained color slots.
- `STRUCTURE`: the single geometry/pattern stage that feeds the COLOR rack.

The goal is a complete repo integration, not just a shader paste. A finished change should compile, appear in the UI, persist correctly, and respect the existing render pipeline.

## First Moves

1. Read `CLAUDE.md`.
2. Read `WEBGL_REFERENCE.md` in this skill directory.
3. Inspect the current implementation before editing:
   - `src/schemas.js`
   - `src/glFilters.js`
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
- If the user does not say whether the effect is COLOR or STRUCTURE, ask before editing.
- Require real source material: TouchDesigner GLSL/code, intended effect name, COLOR vs STRUCTURE target, and parameter mapping for each exposed knob/toggle.
- If the TouchDesigner code depends on time, feedback, multiple TOP inputs, external textures, or more than four user parameters, identify that dependency before coding.

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

## Integration Rules

- Keep the app vanilla JS + Vite + raw WebGL2. Do not add TypeScript, frameworks, component libraries, Tailwind, three.js, or transpilation.
- Prefer stateless single-pass WebGL2 effects in `src/glFilters.js`.
- Match the existing shader interface: `in vec2 vUV`, `uniform sampler2D u_video`, `uniform vec4 uParams`, `out vec4 fragColor`.
- Always call `gl.bindAttribLocation(prog, 0, 'a_pos')` before linking if creating a new program.
- Do not upload video or composite inside effect modules. `renderFrame` owns `ensureContext`, `uploadVideoFrame`, GL dispatch, and `compositeToCanvas2D`.
- Never read and write the same FBO texture in one draw.

## COLOR Effect Checklist

Add the effect as a per-slot COLOR stage:

1. `src/glFilters.js`: add a `FRAG_<NAME>` shader and register it in `FRAGS`.
2. `src/schemas.js`: add `COLOR_PARAM_SCHEMAS[slug]` with knobs/toggles and an `order` array matching `uParams.xyzw`.
3. `src/schemas.js`: add the slug to `COLOR_SECTIONS` and `BLEND_MODES`.
4. `src/main.js`: add swatch, label, and chip tooltip entries.
5. `index.html`: add a `data-pick-color="<slug>"` picker button.
6. Verify the effect works in any rack slot, with per-slot params, enable/disable, clear, and reorder.

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
- Whether the effect was added as COLOR or STRUCTURE.
- Verification command results.
