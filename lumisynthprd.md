# Implementation Status

*Last updated: May 8, 2026. Captures the gap between this PRD (`v0.1 draft`, kept verbatim below) and the project as it actually exists today (`LumiSynth`, `main` at commit `c923fc7`).*

The honest summary: **the project diverged hard from this PRD, but the pipeline split started landing in P1.** The PRD describes a luminance synthesizer whose centerpiece is a ramp editor (luma → RGB lookup) with a 3-pane mixing console and a stack-style FX rack. What got built is a real-time video instrument whose centerpiece is **blob detection + Kalman tracking + per-blob overlays**. As of `c923fc7`, the sidebar now exposes the multi-stage pipeline the synth metaphor demands — **STRUCTURE → COLOR → FX RACK → PER-BLOB** — but render is still single-effect dispatch under the hood (see §5.3 below). Both products are still valid; they are not the same product, but LumiSynth is now structurally closer to becoming the PRD's product than it was at `4c9fa70`.

The taxonomy of changes:

| Bucket | What it means |
|---|---|
| ✅ **Done** | Spec item built more or less as the PRD described |
| ⚠️ **Partial** | Built but in a different shape than the PRD called for |
| ❌ **Not started** | On the table; nothing built yet |
| 🚫 **Deliberately not followed** | Decision logged in `PRD_DECISIONS.md` to do something else (or nothing) |
| ➕ **Added not in PRD** | Built without the PRD asking for it |

---

## ✅ What's Built (matches PRD intent)

| PRD ref | Spec | Status |
|---|---|---|
| §3.1 OSC sources | Video file (drag/drop mp4/mov/webm) | ✅ |
| §3.1 OSC sources | Webcam (`getUserMedia`, no recording) | ✅ |
| §3.1 Structure | Erosion + Dilation | ✅ (one effect with mode toggle) |
| §3.1 Structure | Voronoi cells | ✅ |
| §4.1 | Desktop-first single-window app | ✅ |
| §4.2 | Deep purple-black background, Inter typography, pink-purple-indigo accents on knobs | ✅ (palette landed at OKLCH hue 310; see DESIGN.md) |
| §4.3 | Knob component: vertical drag, Shift fine, double-click reset, hover tooltip with value, faint arc behind knob, label below in lavender uppercase | ✅ (one shared component, reused everywhere) |
| §4.5 | Big preview window matching source aspect ratio, scrub bar (when video), FPS counter (toggleable) | ✅ |
| §4.6 | Logo / project name on top bar (text only) | ✅ ("LumiSynth") |
| §4.7 | PNG export + clip recording | ✅ Snap (PNG) + Rec (MediaRecorder → mp4 / webm); GIF still missing |
| §5.1 | 100% in-browser, WebGL2, no server | ✅ |
| §5.4 storage | localStorage autosave for last project | ✅ |
| §9 | Name locked by Week 3 | ✅ ("LumiSynth") |

---

## ⚠️ Partial (built but in a different shape)

| PRD ref | Spec | Reality |
|---|---|---|
| §3.1 #4 | ASCII Luma as a single-channel luminance effect | ✅ ASCII shader exists, but operates on full RGB (the whole single-channel intermediate is missing, see Divergences) |
| §4.2 | Glassmorphism translucent panels | ⚠️ Built and then explicitly removed by the Flat-By-Default Rule in DESIGN.md. Surfaces are now solid, tonally layered. |
| §4.3 | 56px circular knob | ⚠️ Built at 40px. Same affordances. |
| §4.3 | "Subtle glow on the active knob" | ⚠️ Built and then removed by the Flat-By-Default Rule (no ambient `box-shadow` on chrome at rest) |
| §4.5 | "Play/pause button only visible on hover" | ⚠️ Visible video controls bar instead of hover-only |
| §10 | "No mobile responsive" | ⚠️ Single 640px breakpoint exists; sidebar collapses to top stack on phone widths. Still desktop-first. |

---

## ❌ Not Started (still on the table)

Grouped by PRD section, ordered by impact.

### §3.1 Structure effects (10 of the 12 spec'd)
- Halftone
- 8-bit (posterize)
- Edge detect
- Threshold (hard cutoff)
- Skeleton
- Watershed
- Pixelate
- Dilation as a standalone effect (currently a mode toggle inside Erode)

### §3.2 FILTER (the entire ramp editor)
The PRD calls this "the make-or-break feature" (§3.2, §8 Week 3). None of it is built:
- Interactive horizontal gradient strip
- Click-to-add stops, drag to reposition, click for color picker, right-click to delete, double-click to auto-interpolate
- Preset dropdown above the ramp
- All 12 preset ramps: Nebula, Aurora, Event Horizon, Solar, Bioluminescence, Cyanotype, Tokamak, Mineral, Deep Field, Thermal, Mono, Inverted

### §3.3 FX (the entire stack)
The PRD calls for an Ableton-style FX rack. None of it is built:
- Stack-style FX cards with drag-reorder and per-card toggle
- Per-card live thumbnails
- All 10 FX shaders: RGB Split, Feedback Warp, Echo / Trail, Mirror, Datamosh, Scanline, CRT, Vignette, Grain, Bloom

### §4.1 Layout
- 3-pane mixing console (left rail OSC 280px, center preview + ramp, right rail FX 280px). Currently a single 240px sidebar + canvas, but the sidebar is now stage-segmented (OSC / STRUCTURE / COLOR / FX RACK / PER-BLOB / FX) rather than one flat picker. The 3-pane split is still deferred per `PRD_DECISIONS.md` until the FX rack has real mechanics (P3) to justify its own column.

### §4.4 Live shader thumbnails
- 32×32 live previews on the Structure picker that update as knobs change. Currently filter buttons are static gradient swatches that approximate each effect but do not reflect actual shader output or knob values.
- Per-card live thumbnails on FX cards. N/A until FX cards exist.

### §4.5 Preview framing
- 16:9 / 9:16 / 1:1 framing crop toggle for export presets

### §4.6 Top bar project file controls
- New / Save (download `.json`) / Load (upload `.json`)

### §4.7 Multi-format export modal
- ~~mp4 export (MediaRecorder)~~ ✅ Shipped — `Rec` button records the canvas as `.mp4` (or `.webm` fallback) via MediaRecorder
- GIF export — still missing
- Resolution presets (1080×1920 Reels, 1920×1080 landscape, 1080×1080 square, match source) — still missing
- The whole modal UI — still missing (Rec is a single-click toggle, not a modal)

### §5.2 Project save/load as JSON
- Currently `localStorage` only. Cannot share a patch with another machine or back up a session as a portable file.

### §6 Effect totals
- PRD plans 34 shader files (12 Structure + 12 Filter presets + 10 FX). Reality is around 14 effect modules covering mostly different effects than the spec list.

### §7 Pricing, §8 Launch, §12 Success metrics
- No pricing, no Stripe, no watermark, no landing page, no launch sequence, no metrics. LumiSynth is currently positioned as a personal/portfolio tool per `PRODUCT.md`, not a business.

---

## 🚫 Deliberately Not Followed (logged divergences)

These are spec items where the team picked a different path. Each is documented in `PRD_DECISIONS.md` as REJECTED or MODIFIED.

### Stack (§5.4)
| PRD locked-in | Reality | Why |
|---|---|---|
| Next.js 14 App Router | Vanilla Vite | Single-page in-browser instrument. SSR, routing, server components are zero-value here. |
| TypeScript | Plain JS | One-person project. Type cost not justified at this scale. |
| Tailwind CSS | Custom CSS with `--space-*` + `--bg-*` token system | Per DESIGN.md, fewer-but-named tokens beat utility-class soup for an instrument-style chrome. |
| shadcn/ui | Hand-built component library (knobs, toggles, cards, toast, swatches) | shadcn's default look is the SaaS-dashboard cliché PRODUCT.md explicitly anti-references. |
| Framer Motion | CSS transitions only | All motion is `cubic-bezier(0.25, 1, 0.5, 1)` opacity/transform. JS animation library is overkill. |
| ogl (or three.js) | Raw WebGL2 | Total of ~1,500 lines of GL code. Library overhead would dwarf the savings. |

### Pipeline (§5.3) — the biggest architectural divergence (P1 partially closed it)
The PRD specifies a single linear pipeline with **single-channel luminance** flowing between OSC and FILTER:

```
INPUT → STRUCTURE shader → 1-channel luma → FILTER (ramp lookup) → RGB → FX chain → OUTPUT
```

Reality, pre-`c923fc7`: each effect was a **monolithic shader operating directly on the full RGB video frame**. There was no luma-only intermediate, no ramp lookup stage, no FX chain post-filter. The "FILTER" stage in LumiSynth's UI was just a one-of-N effect picker spanning all 14 effects; nothing about it was a color-mapping ramp.

Reality, post-`c923fc7` (commit "feat(pipeline): split FILTER into STRUCTURE / COLOR / FX RACK / PER-BLOB"): the sidebar now models the multi-stage pipeline the synth metaphor demands —

```
video → STRUCTURE (1) → COLOR (1) → FX RACK (0–3 chained) → out
                                                          + PER-BLOB overlay
```

— and `state.filter` has been split into `state.structure`, `state.color`, `state.perBlob`, plus `state.lastPicked` as a tiebreaker. PER-BLOB (Inv / Thermal) is now independent of the main chain. Pre-P1 saved sessions are migrated once on load. **But the render path is still single-effect dispatch:** `getActiveFilter()` resolves which of STRUCTURE / COLOR renders (favoring `lastPicked` when both are set). The FX rack is three dashed-border placeholder slots, inert. Effects are still RGB-in / RGB-out monolithic shaders; there is still no single-channel luma intermediate, no ramp lookup, and no real chained FX pass.

Phasing from the commit message:
- **P1 (done, `c923fc7`):** UI / state restructure only. Sidebar shows the stages; state model splits; PER-BLOB decoupled.
- **P2 (not started):** Real STRUCTURE → COLOR FBO chain. COLOR consumes STRUCTURE's output instead of raw video.
- **P3 (not started):** FX rack mechanics (drag-to-reorder, per-slot toggle), real FX shaders, and Inv / Thermal folded into the rack so PER-BLOB can be retired.

Consequence: the project still will not become the PRD's product without finishing P2 + P3 and adding the ramp editor. The infrastructure half (a single shared WebGL2 context + canvas + video texture across all effect modules) is done — see `src/glContext.js` under "Performance work" below. The semantic half (single-channel luma intermediate + ramp lookup) is still not started; that's tracked as the **ramp editor** (§3.2) in the closing priority list.

### Effect taxonomy (§3.1, §6.2)
- PRD CUT Crystal, Cellular, Wave, Voronoi Diff as "feedback shaders, bad UX in a drag-and-see-instantly app" (§6.2). LumiSynth **built Cellular, Wave, Voronoi anyway**. They look great. The PRD was wrong about the UX cost.
- PRD said BlobTracking is "a separate product, don't ship in v1" (§6.2). LumiSynth **made blob detection + Kalman tracking the core of the product**. The signal-flow now reads "video → blob field → per-blob colorize" rather than the PRD's "luminance → ramp → FX." This is the identity shift.

### Visual chrome (§4.2)
- PRD: glassmorphism, translucent purple panels (`bg-purple-500/8`, `border-purple-300/25`).
- Reality: explicitly rejected. The Flat-By-Default Rule in DESIGN.md bans `backdrop-filter: blur` on chrome at rest. Surfaces are tonally layered using the dim-studio ladder (`bg-stage` → `bg-room` → `surface-card` → `surface-raised` → `surface-hover`).
- Decorative gradient text (`background-clip: text`) removed everywhere. Logo, card titles, headlines all solid color.
- Ambient `box-shadow` glow removed from knob arcs, toggles, swatches, filter buttons. The single justified shadow is `--modal-lift` on the help panel.

### Mobile (§10)
- PRD: NO mobile / tablet / responsive layout for v1.
- Reality: built one 640px breakpoint anyway (sidebar collapses to top stack, filter grid goes 4-col, knob grid goes 4-col). Still desktop-first; tablet sizes (768-1024) inherit desktop with the fixed sidebar eating real estate.

### Pricing & launch (§7, §8)
- PRD: 6-week build-in-public sprint with weekly reels, Stripe checkout, free-vs-paid tiers, watermark on free exports.
- Reality: zero of this. LumiSynth per `PRODUCT.md` is positioned as a tool for VJs / generative-art tinkerers / curious creators, not a paid product. No revenue model attached.

---

## ➕ Built but Not in PRD

Things that exist in LumiSynth that the PRD didn't call for:

### Detection + tracking (the actual core)
- **Grid-based blob detector** with **6 detection modes** (`blobDetector.js`):
  - **Motion** — temporal frame-diff (default, the OG)
  - **Luma** — bright-spot detection on grayscale
  - **Dark** — silhouette detection (inverse luma)
  - **Sat** — vivid-color detection (chroma = max(R,G,B) − min(R,G,B))
  - **Edge** — Sobel 3×3 gradient magnitude
  - **Sharp** — Laplacian magnitude (focus / detail)
- **Pause-safe detection**: when the video is paused, motion mode would normally see zero frame-diff and cull every tracker. The render loop now skips detection + tracking entirely on `video.paused`, so cached blobs persist on the frozen frame. The five non-motion modes also keep working on paused frames (their strength field is single-frame).
- **Kalman tracker** per blob: 1D filters on position + velocity + size, nearest-neighbor association, ID + age + missed-frame culling (`kalman.js`)
- **OSC tuning knobs**: Sensitivity (threshold), Max Blobs, Update Interval, **Smooth** (per-render-frame EMA on tracked positions)

### Per-blob overlays
- **Region Style** picker: Basic / Label / Frame
- **Shape** picker: Rectangle / Circle / Rounded rect / Diamond
- **Connection lines** between tracked blobs (`Connect` knob controls density)
- **Stroke / Font** size knobs
- **Blob Size** preset picker (0 / 32 / 64 / 128 / 256)
- **Overlay color** swatch palette (8 swatches + custom picker), gated to "boxes & lines only"

### Per-blob CPU filter
- Inv and Thermal effects applied to blob bounding boxes only (vs full-frame). After the perf branch, this is one batched `getImageData` per frame instead of N round-trips.

### Interaction patterns
- **Two-stage Reset** (click once to arm, click again to confirm) — the canonical "destructive action without a modal" pattern in DESIGN.md
- **Per-card reset buttons** (`×` in each effect-card header) to reset just that card's knobs
- **Per-slot reset** (`⟲` in each expanded color rack slot's panel header) to reset only that slot's knobs to factory
- **Drag-and-drop video** loading with pink halo overlay
- **Keyboard shortcuts**: `?` (help), `S` (snap), `R` (toggle clip recording), `F` (FPS), `Esc` (close), arrow keys + PgUp/Dn + Home/End on knobs

### Color rack architecture (slot-as-module)
- COLOR is a **0–3 slot rack** chained in series (`9b775d7`). Slots can be empty / disabled / hold one of 5 colors; same color may appear in multiple slots (compounding).
- **Per-slot params**: each slot owns its own copy of its effect's knobs, so two synth slots can have independent Warmth / Resonance / Sep / Dyn-Range. `state.colorRack[i].params` is a flat key→value object keyed by short param names; `COLOR_PARAM_SCHEMAS` in `src/main.js` is the source of truth for what knobs/toggles each color exposes.
- **Inline knobs**: knobs render *inside* the slot when expanded (chevron toggle), bound to `slot.params` via `initKnob`'s new `writeValue` callback. No remote panel, no "selected slot" mode — the knobs physically belong to the slot they control. Right-panel COLOR cards were deleted; STRUCTURE / PER-BLOB cards stay (they're single-select stages, no per-slot semantics needed). The asymmetry between stackable stages (inline modules) and single-select stages (right-panel cards) is a deliberate visual signal.
- **Drag-to-reorder, on/off toggle, ×-clear, picker popover** with HTML5 native drag-and-drop. The slot-as-module pattern is the canonical pattern for any future stackable stage (FX RACK in P3 should reuse it).
- **Strict-factory migration**: pre-rack saves migrated `state.color` (single string) → slot 0 of new rack; pre-per-slot-params saves migrated to factory defaults for all slots once on first load. Subsequent saves persist per-slot tweaks normally.

### Output & recording
- **Snap** — single PNG export of the canvas (existing).
- **Rec** — clip recording via `MediaRecorder` against `canvas.captureStream(60)`. MIME negotiation tries mp4 → webm/vp9 → vp8 → generic webm. Live elapsed-time label with pulsing red dot in the topbar; `R` toggles. 1-second `dataavailable` chunks. Auto-finalizes on source change. Video-only (no audio — privacy + the artistic content is the visuals). Files download as `lumisynth-<timestamp>.<ext>`.

### Design system (the meta-product)
- **PRODUCT.md** — strategic register, users, brand personality, anti-references, design principles
- **DESIGN.md** — visual system: dim-studio palette at OKLCH hue 310, Inter-only typography, flat-by-default elevation, named components, named rules (Pink-Is-Signal, Tinted-Neutral, Signal-Flow, Three-Pinks, Single-Family, Letter-Spacing-As-Weight, Flat-By-Default, Modal-Only Shadow, Canvas-Is-Loudest, One-Active-Per-Group, Knob-Is-The-Signature, No-Save, Spacing-Token, Stage-Owns-Staging)
- **DESIGN.json** — machine-readable sidecar with OKLCH tonal ramps, component HTML/CSS snippets, narrative rules
- **PRD_DECISIONS.md** — the audit log tracking divergences from this very PRD
- **Stage-flow color coding** — OSC dividers in amber, FILTER in violet, FX in teal. Communicates signal-flow direction without words.
- **State-info cyan** for informational status (modified-from-default knob dot), separate from `pink-signal` (active state) and `state-danger` (destructive confirm). Three pinks intentionally distinguishable.

### Performance work
- GPU-resident display canvas (was forcing software rendering)
- `texSubImage2D` fast-path on all 5 WebGL effect modules (was reallocating texture every frame)
- Batched per-blob CPU filter (was 12-30 GPU↔CPU round-trips per frame, now 1)
- `<link rel=preconnect>` + `<link rel=stylesheet>` for fonts (was render-blocking `@import`)
- `contain: layout style paint` on cards / toast / help-panel
- `will-change: transform` on `.knob.dragging` (drag-only)
- `ResizeObserver` instead of per-frame `clientWidth` reads
- **Shared WebGL2 context** (`src/glContext.js`) — was 5 separate WebGL2 contexts (one per effect module: Voronoi, Cellular, ASCII, Wave, glFilters), each with its own canvas + video texture + fullscreen-quad VAO. Now a single shared context, canvas, video texture, and VAO. Per-effect modules still own their own programs and FBOs. Effect APIs unchanged. One known visual side-effect: ASCII switched from `NEAREST` to `LINEAR` texture filtering (the shared sampler is `LINEAR`); accepted as an improvement (less aliasing inside glyphs).

### Wheel-handler hardening
- Knob wheel input now: 1 step per logical tick (matches `ArrowUp`), Shift+wheel = 10 steps (matches `PageUp`). Per-knob `deltaY` accumulator with `deltaMode` normalization stops trackpad runaway (was 30 events per swipe = knob slammed to min/max).

### Inline help / discoverability
- **Cursor-following description tooltips** on every filter button (14) and every effect-card knob/toggle (~46). Hover for 350ms, the tip appears beside the cursor and follows it; suppressed during knob drags so the value tooltip wins. Stored as `data-tip` attributes in `index.html`; resolved at runtime by walking up the DOM so a parent can describe a group of children at once (e.g. one tip on the swatch grid covers all 8 swatches).
- **Convention guard**: a dev-mode startup audit (`import.meta.env.DEV`) walks `#filter-group .toggle-btn` and every `.effect-card .toggle-btn / .knob`, and warns in the console for any element missing a `data-tip` (or a `[data-tip]` ancestor). Stops future filter cards from shipping with no inline help.

### Bug fixes worth noting in a PRD diff
- **Blob Size + Shape now couple to the per-blob CPU filter region.** Previously the visual outline scaled with `state.blobSize` and clipped to the chosen shape (circle / diamond / rounded), but the `Inv` / `Thermal` filter painted a raw bounding rectangle at the unscaled detection size. `applyFilterToSubregion` now takes a `shape` parameter and clips per row, so what you see is what gets filtered.
- **`src/lumisynth.js` deleted.** It was a ~140-line standalone effect that was never wired into the pipeline. Removed instead of integrated to keep the surface area honest.

---

## What this means for the PRD below

The original PRD (v0.1, kept verbatim) is now best read as **the product LumiSynth might pivot back toward in a future major version**, not the project as built. The path to closing the gap, in priority order:

1. ~~**Pipeline rewrite — P2 (FBO chain)** (§5.3):~~ **DONE.** Shipped in `47007a2` (P2b chain wire-up). STRUCTURE writes to an intermediate FBO; an orchestrator-level compose pass screen-blends it back over the source video for screen-blend STRUCTUREs (voronoi / wave / cellular); COLOR samples the result. Multi-color stacking via the rack uses the same chain ping-pong (`9b775d7`).
2. **Pipeline rewrite — semantic half** (§5.3): single-channel luma intermediate flowing between STRUCTURE and COLOR. The infrastructure half (one shared GL context, P2's FBO chain) is the prerequisite — done; the meaning-of-the-signal half (luma-only mid-stage) is the actual ramp-editor enabler. **Still not started.**
3. **Ramp editor** (§3.2). The single biggest missing feature; the PRD calls it "the make-or-break." Blocked on item 2.
4. ~~**MediaRecorder clip export** (§4.7)~~ **DONE.** Shipped — `Rec` button in the canvas top bar (keyboard `R`). `canvas.captureStream(60)` → MediaRecorder with MIME negotiation (mp4 → webm vp9 → vp8); chunked 1-second `dataavailable`; live elapsed-time label with pulsing red dot; auto-finalize on source change; downloads as `lumisynth-<timestamp>.<ext>`. Audio is intentionally not included (privacy + the artistic content is the visuals).
5. **FX rack — P3 (mechanics + real effects)** (§3.3): rack slots are placeholders today. Need drag-to-reorder, per-slot toggle, real FX shaders, and Inv / Thermal folded in so PER-BLOB can be retired. Should adopt the *slot-as-module* pattern from the COLOR rack (per-slot params, inline knob panel under each slot when expanded). Blocked on item 1 (now done).
6. **Live shader thumbnails** (§4.4) — once the pipeline can run a shader on a test pattern off-screen. Now possible since the orchestrator can render any effect to an arbitrary FBO (P2a refactor).
7. **Project JSON save/load** (§5.2) — small lift, makes the tool shareable.
8. **Missing structure effects** (§3.1) — Halftone, Edge, Threshold, Pixelate are easy wins.
9. **Color-blind safe overlay defaults** — audit the 8-swatch overlay palette against deuteranopia / protanopia simulations (commitment in `PRODUCT.md`, not yet verified).

The team should also decide whether the PRD itself gets rewritten to match what LumiSynth actually became (a video instrument with blob tracking as the core), or whether the spec stays as a future-state vision and LumiSynth is acknowledged as a different product that grew alongside it.

---

# PROJECT_NAME — Product Requirements Document
*v0.1 · draft · for [friend's name] and [your name]*

---

## 1. Vision

A web-based **luminance synthesizer**. You drop in a video, image, or webcam feed. You play with knobs, ramps, and effects like you're playing a synth. You export a clip, a still, or a live VJ feed.

It's the tool we wished existed for making things that don't look like everyone else's. Not a filter app. Not an AI generator. An instrument.

> "If Ableton and an analog synth had a baby and it processed video instead of sound."

---

## 2. Positioning

| | |
|---|---|
| **Who it's for** | Visual artists, VJs, content creators, designers who scroll TouchDesigner reels and wish they could do that without learning a node editor. |
| **What it replaces** | Photoshop filters (too static), AI video tools (too generic, too slow), TouchDesigner (too hard for most). |
| **What it's not** | Not an AI tool. Not a filter pack. Not a clone of any existing app. |
| **The pitch** | "Real-time visual synthesis in your browser. No AI. No setup." |
| **Tagline candidates** | *"Play your video like an instrument."* / *"Light, shaped."* / *"Synthesize the visual."* |

---

## 3. The Synth Model — How It Works

The product mirrors the signal flow of an analog synth. Three sections, in order:

```
INPUT → [ OSC ] → [ FILTER ] → [ FX ] → OUTPUT
       Structure    Color       Mutate
                                + Decay
```

### 3.1 OSC (Source + Structure)
**Job:** Take incoming pixels, output a 0–1 luminance signal.

The "oscillator" of the synth — it produces the raw waveform. Structure effects reshape that waveform: erode it, quantize it, dither it, ASCII it.

**Input adapters (3 of them, switchable):**
- **Video file** — drag/drop mp4, mov, webm
- **Webcam** — getUserMedia, no recording in v1
- **Still image** — drag/drop png, jpg

**Structure effects (12 in v1):**
1. Off (passthrough luminance)
2. Erosion
3. Dilation
4. ASCII Luma
5. Halftone
6. 8-bit (posterize)
7. Edge detect
8. Threshold (hard cutoff)
9. Skeleton
10. Watershed
11. Voronoi cells
12. Pixelate

Each effect has **2-4 knobs**. No more. We are deliberately cutting from the 21 in TD.

**The signal between OSC and FILTER is single-channel luminance** (0.0 to 1.0). This is the most important architectural commitment in the whole spec — it means Color is a pure function of luminance and the engineer can reason about each stage independently.

### 3.2 FILTER (Color)
**Job:** Take the 0–1 luminance signal, paint it as RGB.

**This stage is a ramp editor.** Not a preset list. Not a dropdown of 49 palettes. A literal interactive gradient that the user shapes.

**The interface:**

A horizontal gradient strip. The X-axis is luminance (0 on the left, 1 on the right). The Y-axis is implicit — it's the RGB color at that luminance. Users:
- Click anywhere on the strip to add a color stop
- Drag stops left/right to reposition
- Click a stop to open a color picker
- Right-click a stop to delete
- Double-click empty space to add a stop with auto-interpolated color

Above the strip: a **preset dropdown** with curated ramps. Picking a preset loads stops into the editor — it does NOT lock them. Users always have full control after loading.

**Preset ramps in v1 (12 of them, ported from TD's best):**
- Nebula
- Aurora
- Event Horizon
- Solar
- Bioluminescence
- Cyanotype
- Tokamak
- Mineral
- Deep Field
- Thermal
- Mono
- Inverted

**Why this matters more than anything:** The ramp editor is what makes this product feel like an instrument and not a filter app. If only one thing in this PRD ships polished, it's this.

### 3.3 FX (Mutate + Decay)
**Job:** Post-process the colored RGB signal.

**Stack-style interface.** Like Ableton's effect rack. User adds 0-3 effects from a library. Each is a card. Drag to reorder. Toggle on/off per card. Each card has 2-3 knobs.

**FX library (10 in v1):**
1. RGB Split
2. Feedback Warp
3. Echo / Trail
4. Mirror
5. Datamosh
6. Scanline
7. CRT
8. Vignette
9. Grain
10. Bloom

Mutate effects (warps, splits, drift) and Decay effects (surface texture, vignette, scanlines) live in the same library. Users don't need to know the distinction.

---

## 4. UI — The Mixing Console

Desktop-only in v1. Single-window app, no scrolling. 1440×900 minimum, scales up. A desktop browser tab.

### 4.1 Layout

```
┌─────────────────────────────────────────────────────────────┐
│  PROJECT_NAME                                    [export]  │ ← top bar (40px)
├──────────────┬──────────────────────────────┬──────────────┤
│              │                              │              │
│   OSC        │                              │   FX RACK    │
│              │      PREVIEW WINDOW          │              │
│  [source ▾]  │      (16:9 or 9:16)          │  [+ add fx]  │
│              │                              │              │
│  [effect ▾]  │                              │  ┌────────┐ │
│              │                              │  │ rgbsplit│ │
│  ◉ ◉ ◉ ◉    │                              │  │ ◉ ◉    │ │
│   knobs      │                              │  └────────┘ │
│              │                              │             │
│              │   ┌─────────────────────┐    │             │
│              │   │   FILTER (ramp)     │    │             │
│              │   │  ▮▮▮▮▮▮▮▮▮▮▮▮▮▮  │    │             │
│              │   │  ●     ●      ●    │    │             │
│              │   └─────────────────────┘    │             │
│              │                              │             │
└──────────────┴──────────────────────────────┴─────────────┘
   left rail (280px)    center (flex)              right rail (280px)
```

**Left rail (OSC):**
- Source picker dropdown at top
- Structure effect picker with **animated waveform thumbnails** (see 4.4 below)
- 4 knob slots beneath, labeled with the effect's parameter names

**Center (Preview + Filter):**
- Big preview window, top 65% of center column
- Ramp editor, bottom 35% of center column, full width
- Preset dropdown above the ramp

**Right rail (FX Rack):**
- "+ Add FX" button at top
- Stack of effect cards beneath
- Each card collapsible to just its name (when 3 stacked + low screen height)

### 4.2 Visual style — pin this down

- **Background:** Deep purple-black (`#0a0418`), radial gradients in violets and pinks (steal from the Patreon guide PDF — same palette).
- **Panels:** Translucent purple over the gradient (`bg-purple-500/8`, `border-purple-300/25`). Glassmorphism.
- **Text:** Inter, white headers, lavender body (`#d8d0f0`).
- **Accent gradients:** Pink-to-purple-to-indigo on focus states, hover states, active knobs.
- **No emoji. No icons unless functional.**

shadcn/ui's dark mode + a custom theme.json with the purple values. Don't fight the framework.

### 4.3 Knobs

**These are the soul of the product. Get them right.**

- Circular SVG, 56px diameter
- Drag up to increase, drag down to decrease (vertical drag, NOT rotational — vertical is the standard for music software)
- Shift+drag = fine control (10x slower)
- Double-click = reset to default
- Hover shows the current value as a tooltip
- A faint arc behind the knob shows current position (0 = bottom, max = top)
- Subtle glow on the active knob (pink-purple gradient)
- Label below the knob in 10pt lavender uppercase

Build these as one shared `<Knob>` component. Reuse across OSC and FX. Do not let your friend hand-roll knobs per stage.

### 4.4 Waveform thumbnails (the visual cue you asked for)

Every Structure effect in the OSC picker dropdown has a **live 32×32 thumbnail** showing what that effect does to a test pattern. The thumbnails are generated by running the actual shader on a hardcoded gradient ramp + checkerboard test image.

This means:
- Erosion shows a square wave being eaten
- ASCII Luma shows the test pattern quantizing into character chunks
- Halftone shows it dotting
- Edge detect shows the outline

Users see the thumbnails update live with their current knob values. **This is the killer UX detail.** It's how the product feels alive instead of menu-driven. It's also content gold for the build-in-public reels.

Same trick for FX cards — each one has a tiny live preview of itself running on a test pattern, so users know what each effect does before they add it.

### 4.5 Preview window

- Aspect ratio matches the source
- Big "play/pause" button only visible on hover
- Scrub bar at the bottom (when source is video)
- Toggle in the corner: 16:9 vs 9:16 vs 1:1 framing crop (for Reels/TikTok export presets)
- A tiny FPS counter in the bottom corner — visible only in a hidden "dev mode" toggle

### 4.6 Top bar

- Logo / project name on the left (text only for now, no logo)
- Project file controls in the middle: New, Save (download .json), Load (upload .json)
- Export button on the right

### 4.7 Export modal

When you click Export:

```
┌───────────────────────────────────────┐
│  Export                          [×]  │
├───────────────────────────────────────┤
│                                       │
│  Format:    ◉ Video (mp4)            │
│             ○ Image (png)            │
│             ○ GIF                    │
│                                       │
│  Resolution: [1080×1920 ▾]           │
│              · 1080×1920 (Reels)     │
│              · 1920×1080 (Landscape) │
│              · 1080×1080 (Square)    │
│              · Match source          │
│                                       │
│  Duration:  [as source]               │
│             [progress bar]            │
│                                       │
│              [ Cancel ]   [ Export ]  │
└───────────────────────────────────────┘
```

---

## 5. System Architecture

### 5.1 Where rendering happens

**v1: 100% in-browser.** WebGL2 (or WebGPU if your friend wants to bet on it). All shaders run client-side. Export uses MediaRecorder API for mp4, canvas-to-blob for png.

Reasoning: no server costs at launch, instant feedback, no upload wait. The price is that long videos and 4K are gated by the user's GPU. That's fine for v1 because the killer use case is short Reels.

**v1.5+: Hybrid.** Add a server render path for users who want to export 4K or 60s+ at high quality. This is a Patreon-tier feature. Users pay for cloud render minutes.

### 5.2 Data model

A "project" is a JSON object:

```json
{
  "version": 1,
  "source": {
    "type": "video" | "image" | "webcam",
    "ref": "blob-uuid-or-url"
  },
  "osc": {
    "structure": "ascii_luma",
    "params": [0.5, 0.3, 0.0, 0.0]
  },
  "filter": {
    "stops": [
      { "luma": 0.0, "color": "#000000" },
      { "luma": 0.4, "color": "#3a0ca3" },
      { "luma": 1.0, "color": "#f72585" }
    ]
  },
  "fx": [
    { "type": "rgb_split", "params": [0.3, 0.0, 0.0], "enabled": true },
    { "type": "vignette", "params": [0.6, 0.4, 0.0], "enabled": true }
  ]
}
```

Save = download this as `.json`. Load = upload it back. No accounts in v1, no cloud sync. This is enough.

### 5.3 Shader pipeline

The render loop, per frame:

```
1. Sample source frame → texture A
2. Pass A through Structure shader → texture B (single-channel luma)
3. Pass B through Filter shader (ramp lookup) → texture C (RGB)
4. For each enabled FX card: pass C through that shader → C
5. Draw C to canvas
```

The ramp gets uploaded to the GPU as a 256-pixel 1D texture every time stops change. Fast lookup in the filter shader.

### 5.4 Stack recommendation

**Locked-in:**
- **Next.js 14 (App Router)** — Vercel hosts free, your friend already knows Node
- **TypeScript** — non-negotiable for a 6-week sprint, catches bugs your friend doesn't have time to find
- **Tailwind CSS** — fast styling, friend can paste from docs
- **shadcn/ui** — Radix primitives wrapped, beautiful by default, copy-paste components. This is what carries the UI for a non-UI engineer.
- **Framer Motion** — only for knob feel, ramp drag, modal transitions. No globally-applied animations.

**Pick one, don't argue:**
- **ogl** for WebGL — small, modern, fewer footguns than three.js. ([https://github.com/oframe/ogl](https://github.com/oframe/ogl)) If your friend prefers three.js because they've used it, that's fine too. Don't introduce both.

**Storage:**
- v1: localStorage for "last open project" auto-save
- v1.5: Vercel Blob or Cloudflare R2 for cloud projects (when accounts exist)

**Auth:**
- v1: none
- v1.5: Clerk (cheapest, fastest) or Supabase auth

**Payments:**
- Stripe Checkout for one-time
- Stripe Subscriptions for monthly
- Pricing logic: see section 8

### 5.5 What lives where (file structure suggestion)

```
/app
  /page.tsx              ← the whole app, single page
  /api/render/route.ts   ← v1.5 server render
/components
  /Knob.tsx
  /RampEditor.tsx
  /OscPanel.tsx
  /FxRack.tsx
  /Preview.tsx
  /ExportModal.tsx
/lib
  /shaders/
    /structure/
      erosion.glsl
      ascii_luma.glsl
      ...
    /fx/
      rgb_split.glsl
      ...
    /filter.glsl
  /pipeline.ts           ← the render loop
  /project.ts            ← save/load logic
/public
  /presets/              ← preset ramps as JSON
```

---

## 6. Effect Taxonomy — What Ships, What's Cut

This section is the most-likely-to-cause-fights section. Holding the line on small numbers.

### 6.1 What ships in v1

| Stage | Count | List |
|---|---|---|
| OSC sources | 3 | Video, Image, Webcam |
| Structure | 12 | Off, Erosion, Dilation, ASCII Luma, Halftone, 8-bit, Edge, Threshold, Skeleton, Watershed, Voronoi, Pixelate |
| Filter presets | 12 | Nebula, Aurora, Event Horizon, Solar, Bioluminescence, Cyanotype, Tokamak, Mineral, Deep Field, Thermal, Mono, Inverted |
| FX | 10 | RGB Split, Feedback Warp, Echo, Mirror, Datamosh, Scanline, CRT, Vignette, Grain, Bloom |

**Total: 34 shader files.** Manageable in 6 weeks.

### 6.2 What's cut from the TD version (and why)

- **Most of Stage 2 in TD** — 49 → 12 because the ramp editor replaces the rest. Users build their own.
- **Crystal, Cellular, Wave, Voronoi Diff, Rivers** — feedback shaders that take 30+ frames to develop. Bad UX in a "drag and see instantly" app. Defer to v2 as a separate "generative" mode.
- **Slit-Scan** — has the cacheselect TD-specific bug, isn't worth porting.
- **Caustic Lensing, Anisotropic Smear, Contour Wrap, Flow Erosion, Waveform FM, Melt, Grain Extract, Emboss, Skeleton variants** — overlap with simpler effects, cut to reduce decision fatigue.
- **All motion-extraction channels (BlobTracking)** — separate product. Don't ship in v1.

### 6.3 What's added that TD doesn't have

- **Live shader thumbnails** in pickers
- **Ramp editor** for color (vs. preset-only)
- **FX rack stacking** with reorder + toggle (vs. one-effect-per-slot in TD)
- **Project save/load as JSON**

---

## 7. Pricing

### 7.1 The plan

- **Free tier:** Full app. All effects unlocked. 720p export max. Watermark on exported videos.
- **Paid tier:** Watermark removed. 4K export. Cloud render (when v1.5 ships).

### 7.2 Pricing structure

- **One-time purchase:** $39 (matches your Patreon Gumroad pricing for TD version)
- **Monthly subscription:** $5/mo
- **Annual subscription:** $39/yr (same as one-time, hides as a discount)

The one-time and monthly coexist in checkout. Customers pick. Drop the one-time option if monthly revenue exceeds 3x one-time revenue per month for 2 months running.

### 7.3 Why both

- One-time captures hesitant buyers ("I'll buy it once, never again")
- Monthly captures recurring users ("It's $5, sure")
- Annual is the best deal and what most fans will pick if presented well

### 7.4 What's NOT gated

- The product itself, all features, all effects, the ramp editor, save/load, all sources. Everything. The only thing the watermark gates is **clean exports**. This is critical for build-in-public — viewers should be able to use the free tier and post results, just with the watermark visible. The watermark itself becomes marketing.

### 7.5 Watermark design

Bottom-right corner, small (~80px wide), the word "PROJECT_NAME" in the gradient text style from the Patreon guide cover. Clickable in the export → links back to the site. Don't make it ugly or aggressive — make it a logo people recognize.

---

## 8. Roadmap — 6-Week Build-in-Public Plan

Each week ships **a posted thing** + **a thing the friend coded**. The posted thing drives marketing. The coded thing drives product.

### Week 0 — Setup & Spec
- Friend reads this PRD, asks questions, agrees on stack
- Repo set up, Next.js + shadcn scaffold, Vercel deploy
- One Hello World shader running in-browser
- **Posted:** Reel #1 — face-to-camera "I'm building a thing in 6 weeks, here's the idea"

### Week 1 — Skeleton
- Three-panel layout, knobs render (don't all work yet), preview window plays a video
- One Structure shader (Erosion) wired end-to-end
- One Filter ramp (hardcoded preset, not editable yet)
- **Posted:** Reel #2 — "first frame rendered, here's what it looks like" + screen recording

### Week 2 — OSC complete
- All 12 Structure shaders working
- Live waveform thumbnails in the picker
- Source switcher (video/image/webcam)
- Knob component fully functional
- **Posted:** Reel #3 — "12 ways to break a video. tap each one." Quick-cuts of all 12 effects on the same source

### Week 3 — FILTER (the ramp editor)
- Full ramp editor: add/move/delete stops, color picker, live preview
- 12 preset ramps loadable
- **This is the make-or-break week.** If the ramp editor isn't great by end of week 3, push timeline by a week. Don't ship a half-broken ramp editor.
- **Posted:** Reel #4 — "watch me paint with light" — record yourself dragging stops around the ramp, video updates live. This is the "wow" reel.

### Week 4 — FX Rack
- All 10 FX shaders
- Stack/reorder/toggle UI
- Per-card live thumbnails
- **Posted:** Reel #5 — "stacking effects. RGB split → CRT → vignette." The compositional power reel.

### Week 5 — Export + Save/Load + Polish
- mp4 export (MediaRecorder)
- png export
- Project save/load as JSON
- All 4 export resolutions (Reels, landscape, square, source)
- Watermark on free exports
- **Posted:** Reel #6 — "ship date in 7 days, here's how it sounds when it's done" — full demo video, no voiceover, just the tool

### Week 6 — Stripe + Public Launch
- Stripe Checkout integrated (one-time + monthly)
- Watermark gating wired
- Landing page (single scroll, hero video, pricing, footer)
- Domain pointed
- **Posted:** Reel #7 (LAUNCH) — "it's live. link in bio." 30s of best moments + URL on screen at the end

### v1.5 (post-launch, weeks 7-10)
- Accounts (Clerk)
- Cloud sync for projects
- Server render for 4K + long videos (paid feature)
- Webcam recording (live VJ killer feature)
- Mobile responsive

### v2 (3+ months out)
- Generative mode (the cut feedback shaders, Crystal/Wave/Cellular as a separate "synth oscillator")
- BlobTracking integration
- MIDI controller mapping (the OP-1/Push moment)
- Audio-reactive (FFT input drives params)

---

## 9. Naming Brief

**Lock the name by end of Week 3.** Cannot ship without one.

### 9.1 Criteria the name must hit

- ☐ **2 syllables ideal, 3 max.** No long names.
- ☐ **Not a real English word.** Inventable, ownable, googleable.
- ☐ **The .com or .app should be available** (or a clean variant)
- ☐ **Sounds like an instrument, not software.** Korg, Moog, Arturia, Teenage Engineering — that energy. Not "VideoTransformAI."
- ☐ **No "AI," "Studio," "FX," "Lab," "Tool" anywhere in the name.** Generic killers.
- ☐ **Pronounceable on first read.** No ambiguous spellings.
- ☐ **Works as a verb if possible.** "I [name]ed this clip" should sound natural.
- ☐ **Visually clean as a wordmark.** Mostly lowercase letters with no descenders is best for logo design.

### 9.2 Direction options to brainstorm against

- **Synth-flavored:** Lumi-, -wave, -tron, -oid, -osc
- **Optical/light-flavored:** -lux, -ray, -prism, -opt
- **Made-up:** Pure invention, like Oklch, Ableton, Linear

### 9.3 Anti-patterns

- Anything starting with "Visual"
- Anything ending in "Lab" or "FX"
- Anything that sounds like a SaaS company
- Anything that's a real word (lawsuits, SEO hell)

---

## 10. Out of Scope for v1 — The "No" List

This list exists to prevent scope creep. Every "wouldn't it be cool if" goes here, and the answer is "yes, in v2."

- ❌ User accounts / login
- ❌ Cloud project sync
- ❌ Mobile responsive layout
- ❌ Tablet / iPad
- ❌ Multiplayer / real-time collab
- ❌ MIDI input
- ❌ Audio reactivity
- ❌ Custom shader upload
- ❌ Plugin system / API
- ❌ Tutorials / interactive onboarding (v1 ships with a 2-min YouTube link, that's it)
- ❌ Light mode
- ❌ Multilingual
- ❌ Image-to-image AI integrations
- ❌ Webcam recording (preview only in v1)
- ❌ Animated parameter automation / keyframes
- ❌ Layer / multi-track compositing
- ❌ Mask painting / region exclusion
- ❌ Custom resolution beyond the 4 presets
- ❌ Chromecast / external display

If a feature is on this list and your friend says "but it's easy" — tell them "v2."

---

## 11. Open Questions

Things [you] and [friend] need to decide together:

1. **Final stack confirmation** — Next.js + ogl + shadcn? Or does friend want SvelteKit / Solid / something else?
2. **Hosting** — Vercel default? Or Cloudflare Pages for cheaper free tier?
3. **Stripe vs. Lemon Squeezy vs. Paddle** for payments — Stripe = most flexible, LS/Paddle = handle EU VAT for you. Pick by Week 4.
4. **Domain budget** — willing to spend $20-100 on a one-word `.com`? Or fine with `.app` / `.fm` / `.cc`?
5. **Analytics** — PostHog (free tier great)? Plausible? Vercel built-in?
6. **Error tracking** — Sentry free tier?
7. **Build-in-public posting cadence** — 1 reel/week minimum, but could you do 2? More content = more compounding.
8. **Beta tester list** — who are the 10 people who get early access in Week 5? Start collecting now.

---

## 12. Success Metrics

What does "v1 worked" mean?

**Week 6 (launch day):**
- 1,000 unique visitors to landing page
- 50 free signups (or just "tried the tool" if no auth)
- 5 paying customers

**Month 1:**
- 50 paying customers (mix of one-time + monthly)
- $1,500 revenue
- 1 reel >100K views

**Month 3:**
- 200 paying customers
- $3,000 MRR-equivalent (mix of one-time + monthly)
- One feature shipped from v1.5 list
- One creator with >100K followers using/posting it organically

If we miss Month 1, we don't panic — we look at the funnel and fix the biggest leak (probably hook reel or onboarding).

If we miss Month 3, we revisit positioning. Either the audience isn't there or the product isn't them.

---

## Appendix A — Build-in-public content engine

Every week, your friend's Git commits + your face = content. The format that works:

**60-second face-to-camera reel structure:**
- [0-3s] Face hook: "week N of building [PROJECT_NAME]. here's what's new."
- [3-10s] Screen recording of the new feature, voiceover continues
- [10-25s] Demo of the feature being used to make something cool
- [25-35s] Best output result, full screen
- [35-50s] What's next week / why this matters
- [50-60s] "Link in bio if you want to follow." End frame with handle.

Post Wednesdays or Saturdays (highest reach windows for creative content).

**Don't break the streak.** 6 weeks of weekly posts = the algorithm learns you = the launch reel hits much harder. Missing a week is worse than posting something mediocre.

---

## Appendix B — Things to figure out as we go (not blocking v1)

- Logo / brand mark
- Onboarding (probably a 90-second skippable demo on first load)
- Email capture for "notify me when 4K export ships"
- Affiliate / referral program
- Documentation site (or just a really good landing page FAQ)

---

*End of v0.1. Iterate this doc. Track changes in git. Don't treat it as gospel — treat it as the current best guess. If something here is wrong by Week 3, edit it. The PRD's job is to keep you and your friend aligned, not to be a museum piece.*
