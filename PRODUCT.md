# Product

> New here? See [`OVERVIEW.md`](./OVERVIEW.md) — a friendly, non-technical introduction to LumiSynth aimed at PMs, designers, and other non-engineering contributors.

## Register

product

## Users

LumiSynth serves three overlapping audiences who share one device, one window, and one canvas:

- **VJs and live visualists** running it in performance. They drop a video or open the camera, dial in a look, and either record the output or stream it live during a set. Performance-grade requirements: stays responsive at 60fps, readable in low ambient light, knob changes felt instantly on the canvas, no modal interruptions, no commit-shaped UI.
- **Generative-art tinkerers and shader-curious creators**. They open LumiSynth to play. They get lost in dialing knobs for 20 minutes, screenshot the frame they like, share it. The joy is in the exploration. They want depth, multiple effects, knob density, and the freedom to break things.
- **Curious non-technical creators**. They have never heard of a Voronoi diagram. They just want their webcam to look weird. They learn the controls by touching them. The control surface itself is the teaching surface, no tutorial allowed.

The interface must serve all three without collapsing to a lowest-common-denominator simplification. Power-user depth must be present but never in the way.

### Interview log

> **Q1. Register confirmation.**
> Working on the tool itself (sidebar + canvas), not a portfolio/landing page. Tool is `product`, marketing surface would be `brand`.
> **Picked**: product.

> **Q2. Users and context.**
> Options offered:
> (a) You, alone. Personal toy / portfolio piece.
> (b) VJs and live visualists.
> (c) Generative-art tinkerers / shader nerds.
> (d) Curious non-technical creators.
> (e) Something else.
> **Picked**: b, c, d.

> **Q3. Success state.**
> Options offered:
> (a) Saved a still frame they want to post.
> (b) Recorded a clip / streamed live for a performance.
> (c) Got lost in dialing knobs for 20 minutes.
> (d) Taught themselves what a control does by manipulating it.
> (e) Combo / something else.
> **Picked**: b, c, d.

## Product Purpose

LumiSynth is a browser-only real-time video instrument. Webcam or video file in, blob detection (six modes — Motion, Luma, Dark, Sat, Edge, Sharp) with Kalman tracking, then a staged WebGL2 pipeline — **STRUCTURE** (geometry / pattern, pick one of 6) → **COLOR** (palette / tone, a 0–3 slot rack picked from 5 colors, chained in series) → **FX RACK** (chain · 0–3 slots, placeholder) — with a separate **PER-BLOB** overlay (Inv / Thermal) layered on top. The result renders live with no server round-trip. Nothing leaves the machine. Success is a person who came in to play, found a look they did not know they wanted, and either saved it or kept dialing.

> Pipeline status: STRUCTURE → COLOR is a real FBO chain (shipped in P2), with an orchestrator-level compose pass that screen-blends STRUCTURE's output back over the source video so glow-over-video effects (voronoi / wave / cellular) keep their identity when COLOR is downstream. COLOR is a 3-slot drag-reorderable rack (each slot empty / disabled / one of 5 colors). **Each color slot owns its own copy of its effect's knobs** — two synth slots can have independent Warmth / Resonance / Sep / Dyn-Range, etc. — and the knobs render *inline* inside the slot when expanded (no remote panel, no "selected slot" mode; knobs physically belong to the module they control, the way every rack-based music tool works). The **FX RACK** stage is still inert placeholder slots — drag-reorder mechanics, real FX shaders, and folding Inv / Thermal in from PER-BLOB land in P3. **Output:** users can save the live canvas as either a single PNG frame (`Snap` / `S`) or a video clip (`Rec` / `R`) — clip recording uses MediaRecorder against `canvas.captureStream(60)` and downloads as `.mp4` (or `.webm` on browsers without mp4 encode). See `lumisynthprd.md` for the implementation-status breakdown.

## Brand Personality

**Playful, weird, curious.** Anchored as an **instrument**.

The product behaves like a synth, not a SaaS app. Knobs are felt instantly, not committed via Save buttons. The interface invites a hand on every control without being precious. "Weird" is the permission slip: LumiSynth is allowed to surprise you, to look strange in a still screenshot, to do things you did not ask for. "Instrument" is the discipline: it must respond, it must be predictable in its physics, it must reward muscle memory.

Tone in microcopy: terse, observational, never marketing-voiced. ("Reset to defaults", not "Start fresh"). No exclamation points. No emoji. No headings that restate themselves.

### Interview log

> **Q4. Brand personality, 3 words.**
> Options offered:
> - instrument, expressive, alive
> - underground, gritty, raw
> - playful, weird, curious
> - precise, technical, serious
> - cinematic, hypnotic, dark
> - warm, approachable, friendly
>
> **Picked**: playful, weird, curious. Kept "instrument" from the first option as an anchor word.

## References

The aesthetic family LumiSynth lives in: **browser shader playground crossed with industrial-instrument hardware UI**. Touchable knob density, signal-flow visible, the canvas dominates by tonal contrast (a dark display surface embedded in a lighter chassis, the way a Teenage Engineering K.O. II has dark screens set into a grey body), color used to encode state and never as decoration.

### Positive references

- **Teenage Engineering K.O. II / K.O. Sidekick.** Industrial product design distilled. Light grey chassis, restrained palette (orange as the only saturated color, red used sparingly for emphasis), dark display surfaces where the work happens, every control labeled in tight uppercase. The chassis is quiet so the work is loud.
- **Lumen.** Atmospheric, signal-flow visible, controls feel alive without being noisy.
- **Cables.gl.** Browser-native, technical, comfortable with complexity, does not apologize for being a tool.
- **Ableton Push UI.** Physical-instrument discipline: every control has a place, knob density is high but legible, ambient color used to encode state.

### Interview log

> **Q5a. Positive references.**
> Apps or sites whose feel LumiSynth could land near. Options offered:
> Vital / Serum, Ableton Push UI, VCV Rack, TouchDesigner, Lumen, Cables.gl, Hydra video synth, Resolume.
>
> **Picked**: Lumen, Cables.gl, "maybe some Ableton Push UI".

> **Q5a (later, on `design/te-workbench-palette` branch).**
> Added Teenage Engineering K.O. II / K.O. Sidekick as a fourth positive reference, alongside the original three. The palette pivot in this branch (light industrial chassis + orange signal, replacing the dim purple + pink signal of the `main` branch) is grounded in the K.O. II's restrained color use. If this branch merges, the Creative North Star in `DESIGN.md` shifts from "The Late-Night Patch" to "The Studio Workbench" — see `PRD_DECISIONS.md` Q1 for the original North Star choice that this would supersede.

## Anti-references

LumiSynth must not look like:

- **Generic SaaS dashboard.** No Linear/Notion clone aesthetic, no soft greys with identical cards in a 12-column grid, no blue-primary CTA, no "modern" in the boring sense. LumiSynth is not a productivity tool.
- **AI tool cliché.** No gradient orb hero, no beige-and-violet "soft AI" palette, no large sans-serif marketing voice, no emoji status indicators, no chat-shaped affordances. LumiSynth is not a chatbot or an LLM wrapper.
- **Hobbyist demo.** No untreated Bootstrap form controls, no default browser color picker as the visible control, no raw `<input type="range">`. The instrument has to feel built, not assembled.

### Interview log

> **Q5b. Anti-references.**
> Things LumiSynth must NOT look like. Options offered:
> Generic SaaS dashboard, Adobe-ish creative app, crypto neon, AI tool cliché, hobbyist demo.
>
> **Picked**: generic SaaS dashboard, AI tool cliché, hobbyist demo.

## Design Principles

1. **Instrument over interface.** Every control is felt instantly. No commit step, no save button, no "are you sure". The only commit-shaped affordance is `Reset`, and it is two-stage by necessity.
2. **The canvas is the product.** The sidebar exists to disappear. Visual chrome (gradients, shadows, glow) is reserved for state communication, not decoration. The video output is the loudest thing on screen.
3. **Density without noise.** Power users need every knob visible. Newcomers need to find their way without a tutorial. Tighten spacing aggressively, label tersely, let muscle memory do the rest.
4. **Weird is allowed, slop is not.** The output can be visually unhinged. The control surface cannot. Discipline in the chrome buys permission for chaos in the canvas.
5. **Stay local, stay fast.** Nothing leaves the machine. Frame budget is sacred. Every UI affordance must justify its frame cost. If it cannot keep up at 60fps on a 1080p source, it does not ship.

## Accessibility & Inclusion

Target: **WCAG 2.1 AA on the control chrome.** The canvas output is creative content and is exempt by intent. Specific commitments:

- **(a) Contrast, focus, keyboard control on every knob.** Already largely shipped: 4.5:1 minimum on text, visible `:focus-visible` rings, every knob and toggle reachable and operable by keyboard (arrows, PageUp/Down, Home/End, mouse wheel, double-click to reset).
- **(b) `prefers-reduced-motion` respected.** Already partial: toast animation, knob arc transition, card transitions are all gated. Audit any new motion against the same gate.
- **(c) Color-blind-safe overlay defaults.** The 8-swatch overlay palette should be checked against deuteranopia and protanopia simulations. At least four swatches must stay distinguishable on common video backgrounds. The active overlay color choice must not encode meaning beyond contrast.

### Interview log

> **Q6. Accessibility commitments.**
> Options offered:
> (a) WCAG AA contrast, focus rings, keyboard control on every knob.
> (b) `prefers-reduced-motion` respected for any new animations.
> (c) Color-blind safe overlay defaults.
> (d) None, personal tool, ship it.
> (e) Something else.
>
> **Picked**: (a), (b), (c). All three are committed.
