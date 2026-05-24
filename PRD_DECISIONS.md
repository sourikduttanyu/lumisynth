# PRD §4 Implementation Decisions

> New here? See [`OVERVIEW.md`](./OVERVIEW.md) — a friendly, non-technical introduction to LumiSynth aimed at PMs, designers, and other non-engineering contributors.

Companion doc to `lumisynthprd.md`. Tracks what we ship, defer, and refuse.

Color legend:
- 🔴 <span style="color:#ff4d4d"><b>REJECTED</b></span> — never going in this codebase
- 🟡 <span style="color:#ffcc33"><b>MODIFYING NOW</b></span> — current sprint
- ⚪ <span style="color:#888888"><b>FOR LATER</b></span> — defer, revisit post-v1

---

## 🔴 <span style="color:#ff4d4d">REJECTED</span>

Hard no. Not in scope, not negotiable for current LumiSynth codebase.

| Item | PRD ref | Reason |
|---|---|---|
| **Next.js 14 / App Router migration** | §5.4 | Current stack = vanilla JS + Vite. Migration = full rewrite, no product gain. |
| **shadcn/ui** | §5.4 | Component lib for React. Stack mismatch. |
| **Tailwind CSS** | §5.4 | Utility framework on top of vanilla CSS = bloat. Current `style.css` is ~330 lines, fine. |
| **TypeScript** | §5.4 | Vanilla JS pipeline works. Adding TS now = transpile chain + type churn for marginal gain. |
| **Framer Motion** | §5.4 | React-only. Animations stay CSS. |
| **ogl / three.js** | §5.4 | Already running raw WebGL2. Wrapper adds no value here. |
| **React / Svelte / Solid** | §5.4 / §11 | No framework. |
| **Vercel-specific deploy targets** | §5.4 | Static build. Hosts anywhere. |
| **Clerk / Supabase auth** | §5.4 | No accounts (per §10). |
| **Stripe / Lemon Squeezy / Paddle** | §5.4 / §7 | No commerce in this codebase. |
| **Cloud render server (`/api/render`)** | §5.1 / §5.5 | Client-only by design. |
| **All §10 "no" list items** | §10 | Mobile responsive beyond minimal breakpoint, multiplayer, MIDI, audio reactivity, custom shader upload, plugin API, layers/multi-track, mask painting, light mode, multilingual, animated keyframes, AI image-to-image. |

---

## 🟡 <span style="color:#ffcc33">MODIFYING NOW</span>

Current sprint. Ship within LumiSynth's vanilla JS + Vite stack.

| Item | PRD ref | What we do |
|---|---|---|
| **Visual style** | §4.2 | Deep purple-black bg, glassmorphism translucent panels, pink→purple→indigo accent gradients on focus/active, Inter font (system fallback if offline), lavender body text. CSS-only via tokens. |
| **Signal-flow sectioning** | §3 + §4.1 | Sidebar grouped under three labelled dividers: **OSC** (source + detection), **FILTER** (effect picker + per-effect knobs + overlay color), **FX** (overlay shape, region style, stroke, blob size, font, connection). |
| **Stacked card panels** | §3.3 + §4.1 right rail | Each per-effect panel rendered as a card (translucent bg, border, soft shadow). |
| **Knobs replacing sliders** | §4.3 | Custom SVG knob component. Vertical drag, Shift = 10× fine, double-click = reset to default, keyboard nav (arrows/PgUp/PgDn/Home/End), ARIA `role=slider` with `aria-valuenow/min/max/text`, hover tooltip, faint arc indicator showing position, glow on active, label below. Knob diameter ≈ 48 px (sized for 220 px sidebar, not PRD's 56 px). |
| **Filter swatches** | §4.4 (lite) | Static gradient strips on each filter button approximating each effect's palette. Cheap proxy for live shader thumbnails. |

---

## ⚪ <span style="color:#888888">FOR LATER</span>

Real ideas. Real value. Out of this sprint's scope. Track them so they don't get forgotten.

| Item | PRD ref | Why deferred |
|---|---|---|
| **Ramp editor** (interactive gradient w/ stops) | §3.2 + §4 | "The make-or-break feature" per PRD. Standalone component, days of work. Separate sprint. |
| **Live shader thumbnails on pickers** | §4.4 | Requires running each shader on a test pattern per render. Real engineering, not CSS. |
| **3-pane mixing console layout** | §4.1 | Current single-sidebar fits LumiSynth's blob-tracking purpose. Forcing left/right rails = empty space. Revisit when FILTER + FX RACK become real stages with real knob counts. |
| **FX rack** (drag-reorder cards, toggle per card) | §3.3 + §4.1 right rail | Needs real chained FX shaders (RGB Split, Feedback Warp, Echo, etc.). Current "filter" is single-select, not stack. Architectural change. |
| **Project save/load as JSON** | §5.2 / §4.6 | Persistence already lives in `localStorage` per current sprint. JSON file export + import = next iteration. |
| **Export modal** (mp4 / png / GIF, resolution presets) | §4.7 + §5.1 | PNG snapshot already wired. mp4 via MediaRecorder = real work. |
| **Watermark + paid tier gating** | §7 / §4.7 | Out of scope until pricing exists. |
| **Webcam recording** | §3.1 / §10 | Live feed only for now. |
| **Source switcher beyond video/webcam** | §3.1 | Image input not added yet. |
| **Top bar with project file controls** | §4.6 | Current sidebar header has Reset / Save (snapshot). Full top bar = layout change. |
| **Preset ramp library** (Nebula, Aurora, etc.) | §3.2 | Coupled to ramp editor. Same sprint. |
| **All 12 Structure shaders / 10 FX shaders from §6.1** | §6.1 | Current LumiSynth has its own 13 effects. PRD's effect list is a v1 redesign target, not a port. Audit later. |
| **Naming the product** | §9 | Outside engineering scope. |

---

---

## 🎨 <span style="color:#a896d6">DESIGN SYSTEM Q&A — Round 1</span>

Captured during `/impeccable document` (May 2026). These answers seed `DESIGN.md` and bind future `polish` / `colorize` / `typeset` runs.

### Q1. Creative North Star

> A single named metaphor for the whole visual system.

| # | Name | Vibe |
|---|---|---|
| A | **The Modular Rack** | Synth-instrument discipline. Signal flow visible. Ambient color encodes state. Ableton Push crossed with VCV Rack. |
| **B** ✅ | **The Late-Night Patch** | VJ booth at 1am. Dim purple glow, the canvas is the only loud thing, knobs felt by muscle memory. The room is dark, the work is alive. |
| C | **The Lab Bench** | Research-grade instrument. Terse labels, every control deliberate, unapologetic about complexity. Cables.gl crossed with an oscilloscope. |

**Picked**: B, "The Late-Night Patch".

### Q2. Color palette name

| # | Name | Reasoning |
|---|---|---|
| A | The Patchbay Palette | Purples are the chassis, pink is the signal LED. |
| **B** ✅ | **The Dim-Studio Palette** | Every neutral is tinted toward indigo so the eye relaxes in low light. |
| C | The Aurora Palette | Pink-magenta-indigo as a tight gradient family, lavender as the rest state. |

**Picked**: B, "The Dim-Studio Palette".

### Q3. Elevation philosophy

| # | Approach | Notes |
|---|---|---|
| a | Glass everywhere | Honest to current code, but violates skill bans. |
| b | Glass only on transient surfaces (help, drop-zone) | Compromise. |
| **c** ✅ | **Flat-by-default, no glass** | Replace all `backdrop-filter: blur` with solid tinted surfaces. Most aligned with skill + "canvas is the product". |

**Picked**: c, flat-by-default. Current code uses `backdrop-filter: blur` on sidebar / topbar / video-controls / help-panel / toast and is in violation. Cleanup is a follow-up `polish` job.

### Q4. Knob character (signature component)

| # | Phrase | Treatment |
|---|---|---|
| a | Felt, not pressed | Tactile, instant, tooltip is the only feedback. |
| b | Quietly luminous | Knob arc glows pink, everything else recedes. |
| **c** ✅ | **Instrument-grade precision** | Crisp arc, hairline track, no ambient glow, drop-shadow on pointer for depth. |

**Picked**: c. Current implementation has an ambient `filter: drop-shadow` on the arc and pointer; that gets stripped in `polish`.

### Q5. Three named rules

All three confirmed for inclusion in `DESIGN.md`:

1. **The Canvas-Is-Loudest Rule.** No chrome element on screen may visually outweigh the canvas output. Test: squint at the screen; if your eye lands on a sidebar control before the canvas, the chrome is too loud.
2. **The Pink-Is-Signal Rule.** Pink (`#f72585`) appears only where a value is being changed, an effect is active, or an action is destructive. Pink in chrome at rest is forbidden. (Forces fix of gradient-text logo, card titles, help h2, placeholder icon.)
3. **The No-Save Rule.** Knobs commit on touch. There is no Save button. The only commit-shaped affordance is `Reset`, which is two-stage on purpose.

### Code-vs-doc deltas captured

`DESIGN.md` documents the **target**, not the current state. The following live-code violations need a follow-up `polish` pass:

| Violation | Where | Rule broken |
|---|---|---|
| Side-stripe `border-left: 3px solid pink` | `.toast` | Skill absolute ban |
| `background-clip: text` gradient | `.logo`, `.effect-card-title`, `#help-panel h2`, `.placeholder-icon` | Skill absolute ban + Pink-Is-Signal |
| `backdrop-filter: blur` as default chrome | `#sidebar`, `.sidebar-header`, `#canvas-topbar`, `#video-controls`, `#help-panel`, `.toast` | Skill absolute ban (glass = rare/purposeful only) + Q3 |
| `filter: drop-shadow` ambient glow on knob arc + pointer | `.knob-arc`, `.knob-pointer` | Q4 ("no ambient glow") |
| `box-shadow` on toast + help-panel ambient glow | `.toast`, `#help-panel` | Q3 (flat-by-default) |

---

## 🎨 <span style="color:#a896d6">DESIGN SYSTEM Q&A — Round 2 (colorize)</span>

Captured during `/impeccable colorize` (May 2026), after the polish pass that pushed the chrome to maximum restraint. The colorize lanes were five pre-vetted options that all respect the locked DESIGN.md (no walking back the polish).

### Lanes offered

| # | Lane | What it adds |
|---|---|---|
| **A** ✅ | **Disambiguate the two pinks + add `state-info` cyan** | `pink-signal` (#f72585 magenta) and `state-danger` (#ff6b8b red-pink) currently look identical at a glance. Slide danger to true coral (`oklch(70% 0.21 25)`); add `state-info` (`oklch(72% 0.15 220)`, cyan) for informational status. Reassign the modified-from-default dot from pink to cyan (modified is informational, not signal). |
| B | Per-effect category colors on cards | Group 14 effects into 4 categories; each `effect-card::before` 2px top strip becomes its category color. |
| **C** ✅ | **Signal-flow color on stage dividers** | OSC = amber, FILTER = violet, FX = teal. Eye reads warm → cool top-to-bottom as input → output. Hairline rule line stays neutral. |
| **D** ✅ | **Warm the dim-studio one degree** | Shift neutral hue from 290 (indigo-violet, cool) to 310 (warm magenta-violet). Imperceptible per surface, cumulative across the chrome. The dim studio reads less clinical, more lounge. CSS adopts OKLCH-canonical for neutrals. |
| E | Walk back the polish | Re-introduce some glow/gradient (would have meant amending DESIGN.md to relax the bans). |

**Picked**: A + C + D.

### Ripple to DESIGN.md / DESIGN.json

- All ten neutral tokens recomputed at hue 310. CSS uses `oklch()` directly; frontmatter hex updated to rendered approximations.
- `--state-danger` switched to true coral `oklch(70% 0.21 25)`; new `--state-info` `oklch(72% 0.15 220)`.
- Three new `--stage-osc / --stage-filter / --stage-fx` tokens added; only ever used on `.stage-divider[data-stage="..."]` labels.
- New rules added: **The Signal-Flow Rule** and **The Three-Pinks Rule**. Pink-Is-Signal Rule narrowed: pink is now reserved for change/active only; destructive confirms moved to state-danger; informational status moved to state-info.
- Three new Don'ts: don't use stage colors anywhere but dividers; don't use pink-signal for destructive confirms; don't use pink-signal for informational status.

### Files touched

- `src/style.css` (token block + stage rules + modified dot + scrim tints + help backdrop)
- `index.html` (3 `data-stage` attributes on dividers)
- `DESIGN.md` (frontmatter + Colors section + Components knob description + Do/Don't list)
- `DESIGN.json` (full sidecar regen with hue 310 ramps, new colorMeta entries, new narrative rules)

---

## Notes

- Inline color spans render in Cursor / VS Code preview. GitHub strips `style` attributes — emoji prefixes carry the signal there.
- Update this doc as decisions change. Don't treat as gospel — same disclaimer as the PRD.
- When a 🟡 item ships, move it to a "✅ SHIPPED" section (add when first row exists).
