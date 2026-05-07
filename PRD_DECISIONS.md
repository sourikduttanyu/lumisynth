# PRD §4 Implementation Decisions

Companion doc to `lumisynthprd.md`. Tracks what we ship, defer, and refuse.

Color legend:
- 🔴 <span style="color:#ff4d4d"><b>REJECTED</b></span> — never going in this codebase
- 🟡 <span style="color:#ffcc33"><b>MODIFYING NOW</b></span> — current sprint
- ⚪ <span style="color:#888888"><b>FOR LATER</b></span> — defer, revisit post-v1

---

## 🔴 <span style="color:#ff4d4d">REJECTED</span>

Hard no. Not in scope, not negotiable for current FluxKit codebase.

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

Current sprint. Ship within FluxKit's vanilla JS + Vite stack.

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
| **3-pane mixing console layout** | §4.1 | Current single-sidebar fits FluxKit's blob-tracking purpose. Forcing left/right rails = empty space. Revisit when FILTER + FX RACK become real stages with real knob counts. |
| **FX rack** (drag-reorder cards, toggle per card) | §3.3 + §4.1 right rail | Needs real chained FX shaders (RGB Split, Feedback Warp, Echo, etc.). Current "filter" is single-select, not stack. Architectural change. |
| **Project save/load as JSON** | §5.2 / §4.6 | Persistence already lives in `localStorage` per current sprint. JSON file export + import = next iteration. |
| **Export modal** (mp4 / png / GIF, resolution presets) | §4.7 + §5.1 | PNG snapshot already wired. mp4 via MediaRecorder = real work. |
| **Watermark + paid tier gating** | §7 / §4.7 | Out of scope until pricing exists. |
| **Webcam recording** | §3.1 / §10 | Live feed only for now. |
| **Source switcher beyond video/webcam** | §3.1 | Image input not added yet. |
| **Top bar with project file controls** | §4.6 | Current sidebar header has Reset / Save (snapshot). Full top bar = layout change. |
| **Preset ramp library** (Nebula, Aurora, etc.) | §3.2 | Coupled to ramp editor. Same sprint. |
| **All 12 Structure shaders / 10 FX shaders from §6.1** | §6.1 | Current FluxKit has its own 13 effects. PRD's effect list is a v1 redesign target, not a port. Audit later. |
| **Naming the product** | §9 | Outside engineering scope. |

---

## Notes

- Inline color spans render in Cursor / VS Code preview. GitHub strips `style` attributes — emoji prefixes carry the signal there.
- Update this doc as decisions change. Don't treat as gospel — same disclaimer as the PRD.
- When a 🟡 item ships, move it to a "✅ SHIPPED" section (add when first row exists).
