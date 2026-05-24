---
name: LumiSynth
description: Browser-only real-time video instrument. Dark warm-grey graphite chassis, deep embedded display surfaces, orange signals.
colors:
  orange-signal:    "#ff5722"
  red-accent:       "#e63946"
  bg-stage:         "#1f1c19"
  bg-room:          "#28241f"
  surface-card:     "#322d27"
  surface-raised:   "#3b3630"
  surface-hover:    "#48433b"
  border-hairline:  "#4c4740"
  display-screen:   "#0a0908"
  display-bezel:    "#100f0d"
  display-hairline: "#393631"
  text-key:         "#f5f2ed"
  text-body:        "#cfcac2"
  text-muted:       "#988f83"
  text-faint:       "#736b5f"
  text-on-display:  "#eae7e1"
  state-ok:         "#75a070"
  state-danger:     "#d65a4d"
  state-info:       "#5d8bb5"
  stage-osc:        "#b89669"
  stage-filter:     "#b66575"
  stage-fx:         "#7a96b1"
  knob-cap-white:   "#f0ede8"
  knob-cap-black:   "#16140f"
typography:
  headline:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.18em"
  title:
    fontFamily: "Inter, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.16em"
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "0.04em"
  label:
    fontFamily: "Inter, sans-serif"
    fontSize: "9px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.14em"
  mono-num:
    fontFamily: "Inter, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0"
    fontFeature: "'tnum'"
rounded:
  xs:  "2px"
  sm:  "3px"
  md:  "4px"
  lg:  "5px"
  xl:  "6px"
  2xl: "8px"
  3xl: "10px"
spacing:
  2xs: "2px"
  xs:  "4px"
  sm:  "6px"
  md:  "8px"
  lg:  "12px"
  xl:  "16px"
  2xl: "22px"
components:
  button-primary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-key}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "30px"
  button-primary-hover:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.text-key}"
  button-icon:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-key}"
    rounded: "{rounded.sm}"
    padding: "5px 10px"
    height: "26px"
  toggle-inactive:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-body}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
    height: "28px"
  toggle-active:
    backgroundColor: "{colors.orange-signal}"
    textColor: "{colors.knob-cap-black}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
    height: "28px"
  card-effect:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text-body}"
    rounded: "{rounded.2xl}"
    padding: "12px"
  empty-card:
    backgroundColor: "{colors.bg-stage}"
    textColor: "{colors.text-faint}"
    rounded: "{rounded.2xl}"
    padding: "18px 14px"
  toast:
    backgroundColor: "{colors.display-bezel}"
    textColor: "{colors.text-on-display}"
    rounded: "{rounded.lg}"
    padding: "10px 14px"
  swatch-btn:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.sm}"
    padding: "0"
---

# Design System: LumiSynth

> New here? See [`OVERVIEW.md`](./OVERVIEW.md) — a friendly, non-technical introduction to LumiSynth aimed at PMs, designers, and other non-engineering contributors.

## 1. Overview

**Creative North Star: "The Studio Workbench"**

LumiSynth is built for a workbench in a dim studio. The chassis is dark, restrained, warm-grey graphite. The work — the canvas — sits inside an even darker display embedded in that chassis, the way a screen sits in an Elektron Octatrack body or an Ableton Push 3. The chassis recedes by being a quiet warm grey; the canvas asserts itself by being the deepest surface on the page, framed by a slightly lighter bezel. Orange appears only when something is changing, active, or being touched. Everywhere else, the surface is a neutral warm graphite that the eye relaxes into without strain — a screen that can be looked at for hours without fatigue.

The aesthetic family is **browser shader playground crossed with industrial sampler hardware**, with named references in PRODUCT.md to Teenage Engineering K.O. II / K.O. Sidekick (TE chrome language: knobs, type, button shapes), Lumen, Cables.gl, and Ableton Push. Where K.O. II is cream and built for daylight, LumiSynth picks the *dark* sibling aesthetic — Octatrack, Push 3 black, Eurorack — for chassis lightness, because a screen-based instrument lives in a different lighting environment than physical hardware. The TE *language* is preserved (single saturated accent, white plastic knob caps, terse uppercase labels, flat surfaces) while the *lightness* matches a dim-studio screen.

LumiSynth explicitly rejects three other families it could be mistaken for: generic SaaS dashboard (no soft greys with identical 12-column card grids, no blue-primary CTA, no "modern" in the boring sense), AI tool cliché (no gradient orb hero, no beige-and-violet "soft AI" palette, no chat affordances), and hobbyist demo (no untreated form controls, no raw `<input type="range">`).

Density is high on purpose. Power users need every knob visible at once, newcomers learn the controls by touching them, and there is no tutorial layer to fall back on. The chrome must be tight enough to fit, terse enough to read at a glance, and consistent enough that muscle memory pays off — exactly the discipline a TE or Elektron device runs on.

**Key Characteristics:**

- One signal color (`orange-signal`), reserved for change, active, or being-touched states. Orange against dark warm-grey graphite is the loudest possible accent the chrome supports.
- One neutral family of warm-dark greys, the chassis. Every step tinted slightly toward warm-yellow (hue 70) so the surface reads as anodized graphite rather than charcoal-grey or cool black.
- The canvas is NOT on the chassis. It sits inside an even deeper embedded display surface, two surface roles down from the chrome.
- Flat surfaces everywhere. No `backdrop-filter: blur`, no ambient `box-shadow` on chrome at rest. (Floating popovers — toast, video controls, help-tooltip — get a low cast shadow only because they need separation from the surface they hover over; chrome at rest stays flat.)
- Knob is the signature component — and like a TE/Elektron knob, it has a white plastic solid cap with a colored indicator line, not a glowing arc.
- The single saturated chroma in the chrome is orange. Red appears only for danger. Everything else is greyscale.

## 2. Colors: The Workbench Palette

Every neutral is tinted slightly toward warm-yellow (hue 70, low chroma 0.005–0.014) so the surfaces read as anodized warm graphite rather than charcoal-cool black. The CSS uses `oklch()` directly; the hex shown is the rendered sRGB approximation for tooling that cannot consume OKLCH.

The single accent is `orange-signal` (TE-style #ff5722). The single rare emphasis color is `red-accent` (the Japanese-text red, ~#e63946), used for danger state and for one or two intentional typographic moments. Everything else in the chrome is greyscale.

### Primary

- **Orange Signal** (`#ff5722`, `oklch(70% 0.21 45)`): The only accent in the chrome at rest. Used on the active toggle button (full background fill), the active filter button border, the value-tooltip border under a knob being touched, the modified-from-default dot on knobs, the focus-visible ring, the scrub thumb, the effect-card top accent edge, and nothing else. Orange in chrome with no associated state change is a violation. See **The Orange-Is-Signal Rule** below.

### Rare emphasis

- **Red Accent** (`#e63946`, `oklch(60% 0.22 25)`): Reserved for two roles: (1) `state-danger` confirmations (the two-stage Reset button when armed, error toast border), and (2) an optional Japanese-style typographic emphasis on stage labels or the LumiSynth wordmark when the design wants a TE-faithful nod. Never used as a fill on an interactive control — that would collide with `orange-signal`'s active-state read.

### Neutral chassis (the workbench ladder, dark to light, OKLCH-canonical at hue 70)

The lightness ladder runs from `Bg Stage` (the darkest chassis surface, edges of the page) up through the chassis surfaces, then there's a hard break DOWN to `Display Bezel` and `Display Screen` — those two even-deeper surfaces are the "embedded screens" where the canvas and other display content live. The contrast between chassis (warm-dark grey) and display (near-black) is the primary depth cue in the system.

- **Bg Stage** (`oklch(14% 0.008 70)`, ≈`#1f1c19`): The page background visible at the edges, behind everything. The deepest chassis surface. Reads as "ambient room" around the device.
- **Bg Room** (`oklch(18% 0.010 70)`, ≈`#28241f`): Sidebar background and top bar background. The main chassis surface. The thing the buttons and knobs are mounted on.
- **Surface Card** (`oklch(22% 0.012 70)`, ≈`#322d27`): Effect-card background and some panel groupings. One step lighter than `Bg Room` — reads as a raised inlay on the chassis. ("Raised reads as lighter" is the dark-theme convention.)
- **Surface Raised** (`oklch(26% 0.012 70)`, ≈`#3b3630`): Default button background, toggle inactive background, swatch container. The interactive layer; one step lighter than `Surface Card`.
- **Surface Hover** (`oklch(32% 0.014 70)`, ≈`#48433b`): Hover state for any `Surface Raised` surface. One tonal step lighter signals "ready to be pressed."
- **Border Hairline** (`oklch(34% 0.010 70)`, ≈`#4c4740`): All 1px borders on chassis surfaces. Tinted just enough lighter than `Surface Hover` to draw a hairline boundary without becoming a divider.

### Display surfaces (the screens embedded in the chassis)

These three colors are reserved for the canvas viewport, the canvas top bar, the help panel modal, the toast, and the FPS overlay. They are intentionally near-black to maintain the "screen embedded in chassis" metaphor — and to keep the canvas reading as the deepest element on the page.

- **Display Bezel** (`oklch(8% 0.005 70)`, ≈`#100f0d`): The "frame" around the canvas viewport. The canvas top bar lives in this color. The toast surface uses this. Reads as a black plastic bezel around the screen.
- **Display Screen** (`oklch(5% 0.005 70)`, ≈`#0a0908`): The actual screen surface where pixel content sits. The canvas backing color. The help-panel modal background. Slightly darker than the bezel so the screen reads as recessed within its frame. This is the deepest surface in the system.
- **Display Hairline** (`oklch(24% 0.005 70)`, ≈`#393631`): Borders/separators that live ON display surfaces (the canvas top bar bottom rule, FPS overlay border, kbd elements inside the help panel). Subtler than the chassis hairline because the contrast is reading against a near-black surface, not a mid-grey one.

### Text (warm-grey ladder for chassis text; one inverse for display text)

Chassis text is light on dark. Display text is also light on dark, but with slightly different lightness for hierarchy distinction.

- **Text Key** (`oklch(95% 0.005 70)`, ≈`#f5f2ed`): Primary text on chassis surfaces. Headlines, knob value tooltip, active button label, logo.
- **Text Body** (`oklch(82% 0.008 70)`, ≈`#cfcac2`): Default body color on chassis. Inactive toggle label, card body copy.
- **Text Muted** (`oklch(62% 0.012 70)`, ≈`#988f83`): Section labels, file status, knob labels, top-bar muted readouts.
- **Text Faint** (`oklch(48% 0.014 70)`, ≈`#736b5f`): Empty-state copy, footer, divider sublabels. The dimmest legible text on chassis. Borderline WCAG AA on `Bg Room` for body copy — only used for non-essential disambiguation.
- **Text On Display** (`oklch(92% 0.005 70)`, ≈`#eae7e1`): Text rendered on `Display Screen` or `Display Bezel`. Used for the canvas top bar buttons (Snap / FPS / ?), the FPS overlay, the toast body, the help panel body, the empty-state placeholder copy on a black canvas. One tonal step dimmer than `Text Key` to keep display text feeling "displayed" rather than "lit by chrome."

### State (semantic, three roles)

Each state color is muted (low chroma) so it never competes with `orange-signal` for attention. Orange owns "active"; state colors own "outcome." All three are slightly higher in lightness than the previous (light-chassis) variant for legibility against the dark chassis.

- **State OK** (`oklch(65% 0.10 145)`, ≈`#75a070`): Muted forest green. Toast success border. Reads as confirm/done without being chartreuse.
- **State Danger** (`oklch(60% 0.18 25)`, ≈`#d65a4d`): Grounded red, distinct from `red-accent`. Used on the `Reset` button when in two-stage confirm mode (full background + border + text), and on toast error border. Distinguishable from `orange-signal` by hue (red vs. orange-red) and chroma (danger is lower-chroma).
- **State Info** (`oklch(60% 0.10 235)`, ≈`#5d8bb5`): Muted slate blue. Used for **informational status** that is neither active nor destructive. Currently: the modified-from-default dot on knobs (a value differs from default; passive observation, not active change). Reserves `orange-signal` for the act of changing.

### Stage Flow (signal-flow color coding, low-chroma to stay quiet)

The three sidebar stage labels (OSC, FILTER, FX) keep their three different hues to communicate signal direction, but at significantly lower chroma so they recede behind `orange-signal`. Eye still reads warm (input) → cool (output) like an audio chain, but no stage color competes with the orange active-state. Lightness is bumped up vs. the light-chassis variant so the labels stay legible against a dark chassis.

- **Stage OSC** (`oklch(68% 0.09 65)`, ≈`#b89669`): Muted amber. The input stage. Source video, blob detection, the energy entering the system.
- **Stage Filter** (`oklch(60% 0.13 5)`, ≈`#b66575`): Muted plum-rose. The transformation chain. Originally one FILTER section; now shared by the **STRUCTURE**, **COLOR**, **FX RACK**, and **PER-BLOB** stage dividers — the pipeline split is communicated through divider labels and the COLOR rack chrome, while the divider colors stay one shared hue so the eye reads "video coming through the transformation engine" as one continuous unit. The token name `--stage-filter` is preserved for CSS continuity. Shifted toward red so it harmonizes with the rare `red-accent` instead of fighting it.
- **Stage FX** (`oklch(64% 0.08 220)`, ≈`#7a96b1`): Muted slate-teal. The output stage. Region style, shape, overlay color, blob size, font, connection rate.

### Knob caps

These are exposed as design tokens because they appear inside the SVG knob and need to match real hardware aesthetics.

- **Knob Cap White** (`#f0ede8`): The "white knob" cap, matching TE's volume knobs and Octatrack/Push white-cap knobs. Used as the default knob cap fill. The white cap on a dark warm-grey chassis is the iconic studio-instrument read.
- **Knob Cap Black** (`#16140f`): The "black knob" cap and the dark pointer line that notches into the white cap. Also doubles as the text color on the orange-signal active toggle background, where a near-black on saturated orange reads more legibly than white.

### Named Rules

**The Orange-Is-Signal Rule.** Orange (`#ff5722`) appears only where a value is being changed, an effect is active, or a control is currently being touched. The logo, card titles, dividers, and any decorative element must be a neutral or stage-coded tone. Test: take a screenshot of the app at rest with no interaction. If orange is visible anywhere except the active toggle button, the active filter card's accent edge, and the active scrub thumb, the rule is violated.

**The Industrial-Neutral Rule.** Every chassis neutral must carry chroma 0.005–0.014 toward hue 70 (warm yellow). Pure greys (`oklch(L 0 0)`) are forbidden. `#000` and `#fff` are forbidden everywhere in the chrome. The workbench palette only works because the eye reads the warm tint as anodized graphite rather than charcoal or hospital-cold-black; without it, the chassis flips to a generic dark dashboard. The display-surface neutrals are also tinted toward hue 70, just at much lower lightness.

**The Display-Is-The-Canvas Rule.** The canvas viewport sits inside `Display Screen` (the deepest surface in the system). Around it, `Display Bezel` (one step lighter dark) frames it like a real screen bezel. The chrome (chassis surfaces) is mid-dark warm grey. The dark-canvas-in-darker-screen-in-mid-grey-chassis cascade is a three-tier depth cue and must not be diluted. Anything lit-and-glowing belongs on display surfaces; anything tactile belongs on chassis surfaces.

**The Two-Color Rule.** Orange and red are the only saturated chromas in the chrome. No greens, blues, purples, teals, pinks, or yellows appear as primary surface or accent colors anywhere. Stage labels and state colors are LOW-chroma — they read as tinted greyscale, not as color in the design sense. If you find yourself reaching for a fourth or fifth saturated hue, you are decorating, and LumiSynth is not decorated.

**The Signal-Flow Rule.** The sidebar uses three stage hues color-coded to signal-flow direction: amber (OSC, source) → plum-rose (transformation: STRUCTURE / COLOR / FX RACK / PER-BLOB, all sharing one hue) → slate-teal (FX, output). The eye should be able to scan the sidebar top-to-bottom and feel the input-to-output journey without reading any words. The transformation chain reads as one continuous unit by holding one hue across its four dividers; the divider *labels* communicate the pipeline split, the *colors* communicate the signal-flow position. Stage colors appear ONLY on stage-divider labels; using them on any other surface dilutes their meaning. The chroma here is intentionally low so stage colors never compete with `orange-signal` for attention.

## 3. Typography

**Display Font:** none. LumiSynth has no hero, no marketing surface, no headline larger than 13px. Just like a TE or Elektron device has no display font — text is small and labels are everywhere.
**Body Font:** Inter (with `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` fallback).
**Label/Mono Font:** Inter with `font-variant-numeric: tabular-nums` for any numeric value (knob value, FPS, timecode).

**Character:** Single-family discipline. Inter only. Weight contrast (500 / 600 / 700) does the hierarchy work. No decorative typeface anywhere. The work feels engineered and labeled, not designed; the typography stays out of the way of the canvas. Letter-spacing is widened on uppercase to feel industrial-stencil — TE labels are spaced loose and uppercase, and that posture suits LumiSynth too.

### Hierarchy

- **Headline** (Inter 700, 13px, line-height 1.2, letter-spacing 0.18em uppercase): Help-panel title (`Keyboard & Mouse`). The largest text in the system. Used once per modal context.
- **Title** (Inter 700, 10px, line-height 1.2, letter-spacing 0.16em uppercase): Effect-card title (`Voronoi`, `Cellular`, `ASCII`, etc.). The card name, never decorated. Tighter letter-spacing than headline so the title role stays one notch back.
- **Body** (Inter 500, 12px, line-height 1.45, letter-spacing 0.04em): Default. Action button label, toast body, help-panel list items. Cap line length at 60ch in any prose surface (toast, help panel).
- **Body-Small** (Inter 500, 11px, line-height 1.4, letter-spacing 0.03em): Action-btn (Upload Video, Open Camera). One step down from Body, used when density matters more than weight.
- **Label** (Inter 600, 9px, line-height 1.2, letter-spacing 0.12–0.24em uppercase): Section labels, stage dividers, icon-button text, logo. Letter-spacing widens with importance: 0.12em for icon-btn, 0.16em for section-label, 0.24em for stage-divider.
- **Mono-Num** (Inter 600, 10px, `font-variant-numeric: tabular-nums`): Knob value tooltip, FPS overlay, video timecode, knob `aria-valuetext`. Tabular numerals so the digits don't jitter as values change.

### Named Rules

**The Single-Family Rule.** Inter only. No serif accents, no monospace family, no display face. The Mono-Num role is achieved with `font-variant-numeric: tabular-nums` on Inter, not by switching family. A second typeface in this product would feel decorative, and decoration is what the canvas is for.

**The Letter-Spacing-As-Weight Rule.** Letter-spacing widens with hierarchy importance for uppercase text (0.12em → 0.16em → 0.24em). Use spacing, not size, to differentiate sibling uppercase labels. The wide spacing is the typographic posture of an industrial label.

## 4. Elevation

**LumiSynth is flat by default.** No `backdrop-filter: blur`, no `box-shadow` on chrome at rest. Depth is conveyed by tonal layering on the chassis ladder (`Bg Stage` → `Bg Room` → `Surface Card` → `Surface Raised` → `Surface Hover`, each one OKLCH lightness step lighter — dark-mode convention) and by the hard chassis-vs-display contrast where the canvas sits.

A TE / Octatrack / Push device is also flat. The buttons are raised from the chassis by a one-tonal-step lighter inlay; the screen is recessed by a much larger lightness drop. LumiSynth honors the same trick: small tonal steps on the chassis ladder, then a hard break DOWN to the display surfaces.

Shadows appear only as state transitions on truly floating surfaces, never as chrome decoration. The single justified ambient shadow is on the help-panel modal and the drop-zone overlay (both transient surfaces that need to clearly float above their context). Toast, video controls, and the help-tooltip carry low cast shadows because they hover over surfaces that aren't theirs (toast over the chassis, video controls over the canvas, tooltip over either) and need a cue of separation; this is a small, justified deviation from "flat at rest" and is sized accordingly.

### Shadow Vocabulary

- **modal-lift** (`box-shadow: 0 12px 48px oklch(0% 0 0 / 0.55)`): Help panel and drop-zone overlay. The single justified ambient shadow. Pure neutral black at 55% alpha; reads as a true cast shadow against the dark chassis without colored bias.
- **float-drop** (`box-shadow: 0 4px 16px oklch(0% 0 0 / 0.4)` for toast and video controls; `0 2px 10px oklch(0% 0 0 / 0.45)` for help-tooltip): Low ambient cast shadow on transient surfaces that float over a different surface family. Smaller offset and lower spread than `modal-lift` because these elements are not modal — they're popovers.
- **focus-ring** (`outline: 2px solid #ff5722; outline-offset: 2px`): The focus ring is not a shadow but functions like one. Always orange, always 2px, always with 2px offset. Never use box-shadow as a focus indicator.

### Named Rules

**The Flat-By-Default Rule.** Surfaces at rest have no `box-shadow` and no `backdrop-filter`. Depth is tonal, not blurred. If a designer reaches for a shadow to make a card feel "elevated", they have failed to use the surface ladder. Re-tint the surface one step lighter instead (in this dark palette, "raised" reads as LIGHTER, the dark-mode convention). The only exception is transient floating surfaces (toast, video controls, help-tooltip, help-panel) that hover over a surface family different from their own; those carry small cast shadows for separation, but the shadow is structural, not decorative.

**The Modal-Only Strong-Shadow Rule.** Only modals (help panel, drop-zone overlay, future confirm dialogs) may carry the strong `modal-lift` ambient shadow. Toast and other floating popovers use the smaller `float-drop`. Cards, sidebar, and top bar must remain fully flat — adding any shadow to a non-floating chrome surface is a violation.

## 5. Spacing

A single spacing scale is the source of truth for every padding, margin, and gap value in the chrome. The scale is exposed as CSS custom properties in `:root` and is used everywhere; raw px values for spacing are forbidden in component rules.

The scale is unchanged across palette pivots — spacing is about rhythm, and the rhythm doesn't change just because the palette did.

### The scale

| Token | Value | Use |
|---|---|---|
| `--space-2xs` | `2px` | Tight chrome only — knob value-tooltip padding-y, file-status padding-top. Not for general layout. |
| `--space-xs`  | `4px` | Smallest gap between sibling controls — toggle group buttons, swatch grid cells, knob modified-dot offset. |
| `--space-sm`  | `6px` | Compact paddings — toggle button padding-y, top bar action gaps, help-panel kbd padding-x, list-item gap. |
| `--space-md`  | `8px` | Default gap and compact padding — control-section padding-y/gap, action-button padding-y, sidebar-header gap, video-controls gap. |
| `--space-lg`  | `12px` | Default surface padding — control-section padding-x, effect-card padding, action-button padding-x, top bar gap, video-controls padding-x. |
| `--space-xl`  | `16px` | Generous surface padding — sidebar-header padding-x, top bar padding-x, stage-divider padding-x, empty-card padding-y, toast bottom offset, sidebar bottom padding. |
| `--space-2xl` | `22px` | The breath token — knob-grid row gap (holds the value-tooltip drop), help-panel padding (modal generosity). |

### Architecture rules for the sidebar

The sidebar is a vertical stack of stage groups. Six stage dividers (OSC, STRUCTURE, COLOR, FX RACK, PER-BLOB, FX), color-coded by signal-flow position into three hues — the four transformation-chain dividers (STRUCTURE / COLOR / FX RACK / PER-BLOB) all share the plum-rose `--stage-filter` hue so the chain reads as one unit (low-chroma per The Two-Color Rule). No per-section dividers.

- **Stage divider** owns staging. `padding: var(--space-xl) var(--space-xl) var(--space-sm)` — generous breath above, hairline rule line below the label, then control sections begin tight under it.
- **Control sections within a stage** are quiet. `padding: var(--space-md) var(--space-lg)` and **no `border-bottom`** — sections inside one stage read as a single tonal group, not as eight equally-weighted rows. The stage-divider is the only horizontal seam.
- **Effect cards** are tonal raises. `margin: var(--space-md) var(--space-lg)`, `padding: var(--space-lg)`, `background: Surface Card`. The card layer is achieved by tonal contrast (Surface Card sits one step LIGHTER than Bg Room — dark-mode convention) plus inset margin, not by elevation.

### Named Rules

**The Spacing-Token Rule.** Every `padding`, `margin`, and `gap` value in component CSS must come from a `--space-*` token. Raw px values for spacing are forbidden in chrome rules. Exceptions: borders (always `1px solid`), focus-ring offsets (locked at `2px`), the universal reset (`margin: 0; padding: 0;`), intra-component micro-spacing where the value is part of the component's geometric definition (knob's intra-stack `gap: 3px`, sidebar-header-text's tight `gap: 1px`).

**The Stage-Owns-Staging Rule.** Within any stage (OSC, STRUCTURE, COLOR, FX RACK, PER-BLOB, FX), control sections do not draw their own bottom borders. The stage-divider is the only horizontal seam in the sidebar. Adding a `border-bottom` to `.control-section` over-segments the sidebar and dilutes the staged architecture; the eye should read six labeled groups (three by signal-flow color), not N equally-weighted rows.

## 6. Components

For each component: short character line, then shape, color, states, and any distinctive behavior.

### Buttons

Three button shapes. Each has a clear job. Hover lightens the surface by one tonal step (dark-mode convention), matching how a TE/Octatrack button reads when held.

#### Action Button (`.action-btn`) — the deliberate one

The "Upload Video" / "Open Camera" surface. Used when the user is committing to a multi-second action.

- **Shape:** rounded 4px (`{rounded.md}`). Tighter corners — TE/Elektron buttons are crisp, not pillowy.
- **Default:** background `Surface Raised` (`#3b3630`), text `Text Key`, padding `8px 12px`, min-height 30px, font Body-Small (Inter 500, 11px, 0.04em).
- **Hover:** background `Surface Hover` (`#48433b`). Text stays `Text Key`. **No border color change** — depth is tonal in this palette.
- **Focus-visible:** 2px Orange Signal outline with 2px offset.
- **Disabled:** opacity 0.4, cursor not-allowed, no hover treatment.

#### Icon Button (`.icon-btn`) — the small one

`Reset` (sidebar header), `Snap` / `?` / `FPS` (canvas top bar). High density, low padding.

- **Shape:** rounded 3px (`{rounded.sm}`). Same crispness logic as Action Button.
- **Default — sidebar (chassis context):** background `Surface Raised`, text `Text Key`, padding `5px 10px`, min-height 26px, font Label (Inter 600, 9px, uppercase, 0.12em).
- **Default — canvas top bar (display context):** background `Display Bezel`, border `Display Hairline`, text `Text On Display`, otherwise identical. The icon button changes its surface family depending on whether it sits on chassis or on a display surface — a chassis button on a display surface would visually break the screen metaphor.
- **Hover (chassis):** background `Surface Hover`. **Hover (display):** background one step deeper than `Display Bezel`.
- **Active-pressed (`.confirming`):** background a deep red wash (`oklch(38% 0.14 25)`), border `State Danger`, text light-on-red. Used by the two-stage `Reset` button between first and second click.

#### Toggle Button (`.toggle-btn`) — the radio-group one

Used for radio groups: speed, detect mode, region style, shape, blob size, erode mode, false-band. Inside a `.toggle-group` flex row.

- **Shape:** rounded 4px (`{rounded.md}`).
- **Inactive:** background `Surface Raised`, text `Text Body`, padding `6px 8px`, min-height 28px, font Body (Inter 500, 10px).
- **Hover:** background `Surface Hover`, text `Text Key`. No border treatment.
- **Active (`aria-checked="true"`):** background `Orange Signal`, text `Knob Cap Black` (a near-black reads more legibly on saturated orange than white would), font weight 700. The active state is the only place orange appears as a fill on a chrome surface at rest, and it is always exactly one button per group.

### Filter Swatch Button (`.filter-swatch-group .toggle-btn`) — the signature picker for single-pick stages

The picker buttons used by **STRUCTURE** and **PER-BLOB** (the two stages that pick exactly one effect, plus None). Each button is a **full-bleed gradient swatch** approximating the effect's output palette (thermal: black → purple → red → yellow → white; biolum: dark → cyan → violet; etc.). The label sits over the swatch with text-shadow for legibility.

> **Selector history:** these buttons used to live in a single `#filter-group` covering all 14 effects. After the FILTER → STRUCTURE / COLOR / FX RACK / PER-BLOB pipeline split, the class `.filter-swatch-group` was introduced and applied to `#structure-group` and `#perblob-group`. COLOR is no longer a swatch grid — it uses the **Color Rack Chip** pattern below. This means the swatch-button population dropped from 14 to 9 (STRUCTURE: None + 6, PER-BLOB: None + 2); the COLOR effects' identity moved to chip swatches inside the rack instead.

- **Shape:** rounded 4px (`{rounded.md}`), 33% width (3-up grid), min-height 42px (taller than other toggles to give the swatch room).
- **Per-button background:** linear gradient unique to each effect. The gradient IS the button's identity. With it, the user can recognize ASCII vs. Voronoi vs. Thermal at a glance after one session of use. The gradients are a deliberate exception to The Two-Color Rule because they're *previewing the canvas output*, which is creative content and exempt by the same logic that exempts the canvas itself.
- **Inactive:** dark scrim overlay (`linear-gradient(180deg, rgba(0,0,0,0.20), rgba(0,0,0,0.65))`) on top of the swatch so the white label stays readable.
- **Active:** 2px `Orange Signal` border, scrim lightened to (`rgba(0,0,0,0.05) → rgba(0,0,0,0.45)`), font weight 700. **No box-shadow glow.** The orange border is the only signal of active state — color, not glow.

### Color Rack Slot (`.color-rack-slot`) — the chained-stage picker

The COLOR stage is a 0–3 slot rack rendered into `#color-rack`, not a swatch grid. Three fixed slots stack vertically; each slot holds one of the 5 colors or is empty / disabled. Slots run in series — slot 0 → slot 1 → slot 2 — and can be dragged to reorder. The rack is the canonical pattern for any future stage that needs ordered, toggleable, drag-reorderable composition (the FX RACK in P3 will follow the same pattern).

A slot is a 2-row flex column. Row 1 is a 5-cell grid: **handle · chip · chevron · toggle · remove**. Row 2 is the *inline knob panel* — only present when the slot is expanded, and only on filled slots. The handle is the only drag affordance; clicking the chip opens the picker popover; the chevron expands/collapses the knob panel; the toggle pauses a slot without losing its pick; the × clears the slot back to empty (rack length is fixed at 3).

- **Slot shape:** rounded 6px (`{rounded.xl}`), `background: Bg Stage`, `border: 1px Border Hairline`, min-height 36px.
- **Empty slot:** dashed border, only handle + "+ add color" placeholder chip (no chevron / toggle / remove since there's nothing to expand, disable, or clear).
- **Disabled slot (filled but ⊘):** chip label and chip swatch dim to opacity 0.45; slot border stays solid (the slot is filled in the rack — just paused).
- **Expanded slot (`data-expanded="true"`):** border lifts to `Border Strong` so the user can see which slot owns the panel beneath it (matters when 2+ slots are expanded simultaneously). The expanded state is per-session — never persisted; reload collapses everything.
- **Drag-in-progress slot:** opacity 0.4, cursor `grabbing`. Drop target slot draws a 2px `Orange Signal` top border via `::before` showing the insertion point — sits inside the slot's own 1px hairline so it doesn't reflow.

#### Color Rack Chevron (`.color-rack-chevron`) — expand the inline knob panel

Small icon-button (`▾` collapsed, `▴` expanded) between the chip and the on/off toggle. Filled slots only. Reuses the transparent-icon-button language of the drag handle so the row reads as one cohesive control strip rather than five independent affordances.

- **Inactive:** `Text Muted`, transparent background.
- **Hover:** `Text Key`, background `Surface Hover`.
- **Expanded (`aria-expanded="true"`):** `Orange Signal` glyph (consistent with the orange-is-being-touched signal — same logic that lights up the on/off toggle when the slot is enabled).

#### Color Rack Slot Panel (`.color-rack-slot-panel`) — inline per-slot knobs

The expanded panel beneath a slot. Hosts that slot's knobs (and any toggles, e.g. FalseClr's Banding) bound to **slot.params**, not global state — every slot has its own copy. Two synth slots can have different Warmth, Resonance, Sep, and Dyn-Range values without leaking into each other.

- **Layout:** flex column. Top hairline divider separates the panel from the row above.
- **Padding:** `{spacing.sm} {spacing.xs} {spacing.xs}`. Tighter than the right-panel effect-cards because the sidebar is 240px wide and these panels stack 1–3 deep.
- **Header (`.color-rack-slot-panel-head`):** 9px uppercase `Text Muted` title (`SYNTH KNOBS`) + a `⟲` reset button on the right that restores **only this slot** to factory defaults.
- **Knob grid (`.color-rack-slot-knob-grid`):** 2-column grid of slot-bound knobs. Same SVG knob component as the right-panel cards (`.knob`), just with the `slot-knob` modifier and writes routed to `slot.params[k]` via `initKnob`'s `writeValue` callback. Identical drag / wheel / keyboard / dblclick-reset behavior.
- **Inline toggle row (`.color-rack-slot-toggle`):** for non-knob params (FalseClr Banding On/Off). Compact label-plus-button-pair on a single row, slot-bound to `slot.params[t.key]`.

> **Pattern note (slot-as-module).** The knobs physically belong to the slot they control. There is no "selected slot" mode, no remote panel — drag a slot to reorder, the knobs come with it; disable a slot, its knobs dim with it. This is the dominant pattern in the music/modular tools tradition (Ableton Drum Rack chains, Reason racks, VCV Rack modules, TouchDesigner nodes). The asymmetry between stackable stages (COLOR with inline modules) and single-select stages (STRUCTURE / PER-BLOB with right-panel cards) is deliberate — it's a visual signal of "this stage is stackable, this one isn't." When FX RACK becomes stackable in P3 it should adopt the same pattern.

#### Color Rack Chip (`.color-rack-chip`) — the body of a slot

The button inside a slot that shows the slot's current color and opens the picker.

- **Shape:** rounded 4px (`{rounded.md}`), `background: Surface Raised`, `border: 1px Border Hairline`, padding `4px 8px`, min-height 26px.
- **Layout:** 18px gradient mini-swatch (matching the filter-swatch gradient for that color, with an inner shadow for inset depth) + label.
- **Hover:** background `Surface Hover`, text `Text Key`.
- **Open picker (`aria-expanded="true"`):** border becomes `Orange Signal` (the chip is currently the source of the open popover — the orange-is-being-touched signal applies).
- **Empty placeholder:** italic `Text Faint`, text "+ add color".

#### Color Rack Toggle (`.color-rack-toggle`) — the on/off pill

24×24 round pill at the right edge of a filled slot.

- **Enabled (`aria-pressed="true"`):** ✓ glyph, background `Orange Signal`, text `Knob Cap Black`. Orange because the slot is actively rendering.
- **Disabled:** ⊘ glyph, transparent background, border `Border Hairline`, text `Text Muted`. Hover lifts border to `Orange Signal` (about to be re-enabled).

#### Color Picker Popover (`.color-picker-popover`)

Shared, body-level popover. Anchored under whichever chip opened it. Click outside or `Esc` to close. 3-column grid of 6 buttons (None + 5 colors).

- **Shape:** rounded 6px (`{rounded.xl}`), `background: Surface Card`, `border: 1px Border Hairline`, padding `{spacing.sm}`, `z-index: 50`.
- **Shadow:** small ambient cast `0 8px 24px oklch(0% 0 0 / 0.55)`. Justified deviation from Flat-By-Default — the popover is a transient floating surface (same logic as toast / video controls / help-tooltip).

### FX Rack Slot (`.fx-rack-slot`) — placeholder pedalboard

Three dashed-border slots in the FX RACK section. Visual-only until P3 wires the rack mechanics. Reads as "deprecated / pending" by virtue of dashed border + faint italic "— empty —" copy + no hover treatment. When P3 lands, this component is expected to converge with `.color-rack-slot` (same handle / chip / toggle / remove pattern).

- **Shape:** rounded 6px (`{rounded.xl}`), `background: Bg Stage`, `border: 1px dashed Border Hairline`.
- **Text:** `Text Faint`, italic, 10px, letter-spacing `0.06em`.
- **No hover state.** The slots are not interactive.

### Knob (`.knob`) — the signature instrument component

Custom 40×40 SVG. The most-touched control in the system. White solid plastic cap with a colored indicator line, quiet by default and orange when touched. The white cap on a dark warm-grey chassis is the iconic Octatrack / Push / Eurorack-knob read.

- **Shape:** circle. Outer track is a 270° arc starting at -135° (south-west) and sweeping to +135° (south-east), 18px radius, 3px stroke. Inner cap is a 14px solid filled circle. Pointer is a 13px line from cap edge to outer arc.
- **Track:** `Border Hairline`. Hairline-quiet; the eye should read the cap and the pointer, not the track.
- **Arc (filled portion):** linear gradient from `Knob Cap White` (start, low end of value) to `Orange Signal` (end, high end of value). One single saturated color sweep. **No drop-shadow filter.** When the value is at minimum, the arc is essentially invisible (white-on-track); when at maximum, the arc reads as a confident orange swoop. Reserved and rewarding close observation.
- **Pointer:** 2px `Knob Cap Black` stroke (for white-cap knobs). **No glow filter.** The pointer is the high-contrast notch on the white cap and signals the current value.
- **Cap:** `Knob Cap White` fill, 1px `Knob Cap Black` stroke at 0.4 alpha. The cap reads as a solid plastic / aluminum knob top.
- **Label** (below): Mono-Num, `Text Muted`, max 2 lines, wrap not truncate.
- **Value tooltip** (on hover/focus/drag): Mono-Num, `Text Key`, background `Surface Card`, 1px `Orange Signal` border, padding `2px 7px`, rounded 3px, positioned 16px below the SVG. Only visible during interaction.
- **Modified-from-default indicator:** 4px `State Info` (slate blue) dot, inline after the label, only when current value differs from `data-default`. Slate blue because "this value differs from default" is informational status, not active change. Orange stays reserved for the act of changing.
- **States:** hover background `oklch(70% 0.21 45 / 0.10)` (faint orange wash on the knob), focus-visible 2px `Orange Signal` ring, dragging same as hover plus tooltip held visible.
- **Interactions:** vertical pointer drag, Shift = 10× fine, double-click = reset to default, keyboard (`↑` `↓` `←` `→` step, `PgUp` `PgDn` 10×, `Home` `End` min/max), mouse wheel.

### Effect Card (`.effect-card`)

The container that holds per-effect knob grids. One visible at a time (matched to active filter).

- **Shape:** rounded 8px (`{rounded.2xl}`).
- **Background:** `Surface Card`. Solid. No backdrop-filter.
- **Border:** 1px `Border Hairline`.
- **Top accent:** 2px solid `Orange Signal` along the top edge (NOT `border-top-width: 3px+ side-stripe`; this is a 2px full-top accent rendered via `::before`, with `border-radius: 8px 8px 0 0` so it follows the card's rounded corner). Indicates "this card is the active effect's controls".
- **Active state (matches active filter button):** border becomes `Orange Signal` at 0.55 alpha. **No box-shadow glow.**
- **Header:** title (Title role) on the left, per-card reset `×` button (Text Faint, hover Orange Signal) on the right.
- **Internal padding:** 12px (`{spacing.lg}`).
- **Knob grid:** 2-column, gap `22px 8px` (row gap accommodates the value-tooltip drop without colliding with the next row).

### Empty Card (`.empty-card`) — *deprecated, retained as token only*

> **Status:** removed from chrome in commit `c923fc7` (the FILTER → STRUCTURE / COLOR / FX RACK / PER-BLOB pipeline split). Each of those stages now uses its own None button as the empty state instead of a single shared empty-card div. The CSS rule no longer exists in `style.css`. The frontmatter component token `empty-card` and the `DESIGN.json` entry are retained for the dashed-border / `Bg Stage` / italic `Text Faint` recipe — that recipe is the basis of the FX Rack Slot and the empty Color Rack Slot, and may return as a standalone component in a future stage. The visual recipe below is preserved for reference.

- **Shape:** rounded 8px (`{rounded.2xl}`).
- **Background:** `Bg Stage` (one step darker than `Bg Room` — the empty state recedes into the chassis rather than raising forward).
- **Border:** 1px **dashed** `Border Hairline`. The dashed border is the signal of "empty by design".
- **Text:** `Text Faint`, italic, 10px, centered.
- **Padding:** `18px 14px`.

### Toast (`.toast`)

Bottom-center, transient. Stacks vertically (newer at bottom). Lives on a `Display Bezel` surface with light text — toasts read as a status display floating above the chassis, not as a chrome popover. This is TE/Octatrack-faithful (status appears on a screen-style surface, not on the chassis).

- **Shape:** rounded 5px (`{rounded.lg}`).
- **Background:** `Display Bezel`. Solid. No backdrop-filter.
- **Text:** `Text On Display`.
- **Border:** 1px `Display Hairline`. **Full border, never a side-stripe.** Tone variants are achieved by tinting the entire border, not by adding a thick `border-left`.
- **Tone variants:** info = neutral border. ok = border `State OK`. error = border `State Danger`.
- **Padding:** `10px 14px`.
- **Position:** bottom 16px, horizontally centered, max-width 420px.
- **Shadow:** `float-drop` — the toast hovers over the chassis and needs separation.
- **Motion:** enters with 200ms `translateY(8px) → 0` + opacity, gated behind `prefers-reduced-motion`.

### Help Panel (`.help-panel`)

Modal overlay. The only chrome element allowed `box-shadow: modal-lift` and a backdrop overlay. Lives on display surfaces — it's a dark "screen" floating above the chassis, matching the toast and the canvas in surface family.

- **Shape:** rounded 10px (`{rounded.3xl}`).
- **Background:** `Display Screen` solid.
- **Text:** `Text On Display`.
- **Border:** 1px `Display Hairline`.
- **Shadow:** `modal-lift` (the only justified strong ambient shadow in the system).
- **Backdrop:** semi-opaque pure black at 0.7 alpha. **No `backdrop-filter: blur`.**
- **Title:** Headline role (Inter 700, 13px, 0.18em uppercase), `Text On Display`. Solid color, no gradient.
- **Section heads:** Title role, `Text On Display` at 0.7 alpha (the muted-on-display equivalent of `Text Muted`).
- **`<kbd>`:** Inter 600, 10px, padding 2px 6px, background `Display Bezel` (one step lighter than the panel itself, so kbd elements read as raised within the dark surface), 1px `Display Hairline`, rounded 2px (`{rounded.xs}`), text `Text On Display`.

### Swatch Button (`.swatch-btn`)

Overlay-color palette. 8 swatches in a row, plus native `<input type="color">` as fallback.

- **Shape:** square, aspect-ratio 1:1, rounded 3px (`{rounded.sm}`).
- **Background:** the swatch color itself (this is one of the few places `#000` and `#fff` are allowed, because they are user-selectable canvas overlay colors, not chrome surfaces).
- **Border:** 1px `Border Hairline` default.
- **Hover:** transform scale(1.1), border `Text Key`.
- **Active (selected):** border `Orange Signal`. **No box-shadow glow.**

### Named Rules

**The One-Active-Per-Group Rule.** Orange may appear on at most one button per radio group at a time. Speed = 4 buttons, exactly one orange. Detect Mode = 6 buttons, exactly one orange. The user always knows which one is selected by scanning for the single orange rectangle.

**The Knob-Is-The-Signature Rule.** All other components recede in the design hierarchy. If a new component competes with the knob for visual attention, the new component is wrong. The knob is the only place where chroma + cap + pointer + tooltip all converge.

**The Display-Vs-Chassis Rule.** Components that present *information* (toast, help panel, FPS overlay, canvas top-bar buttons) live on display surfaces (`Display Bezel` / `Display Screen`) with light text on near-black. Components that present *controls* (knobs, toggles, action buttons in the sidebar) live on chassis surfaces (`Bg Room` / `Surface Card` / `Surface Raised`) with light text on warm-dark grey. The boundary is enforced — a control on a display surface or a status readout on a chassis surface breaks the metaphor. (Both surface families are dark in this palette — what distinguishes them is that display surfaces are *deeper black* and chassis surfaces are *mid warm grey*; the contrast is tonal lightness, not light-vs-dark inversion.)

## 7. Do's and Don'ts

### Do

- **Do** use `Orange Signal` (`#ff5722`) only when something is changing, active, or being touched. Logo, card titles, dividers, and any decorative element must use a neutral.
- **Do** layer chassis surfaces tonally (`Bg Stage` → `Bg Room` → `Surface Card` → `Surface Raised` → `Surface Hover`). Each step is one OKLCH lightness UP — in this dark palette, "raised" reads as LIGHTER (dark-mode convention).
- **Do** keep display surfaces (`Display Bezel`, `Display Screen`) reserved for the canvas, toast, help panel, and other information-presenting moments. Use light text on display surfaces; use light text on chassis surfaces too — the distinction between the two surface families is tonal depth, not text-color inversion.
- **Do** tint every chassis neutral toward warm-yellow (hue 70, chroma 0.005–0.014). The anodized-graphite read only works with the warm tint — without it the chassis flips to charcoal-cool dashboard.
- **Do** keep the canvas the loudest element on screen. Test by squinting; if your eye lands on a sidebar control before the canvas, the chrome is too loud. The dark-canvas-in-darker-screen-in-mid-grey-chassis cascade is your biggest tool here.
- **Do** use full-bleed gradient swatches on the filter buttons. The gradient IS the identity; this is the one place visual variety serves recognition over decoration. The filter swatches are exempt from The Two-Color Rule by the same logic that exempts the canvas itself.
- **Do** wrap long knob labels to 2 lines instead of truncating. The label is a rare moment of legibility in a knob-dense surface.
- **Do** respect `prefers-reduced-motion` on every transition (toast enter, knob arc transition, card hover).
- **Do** keep the active state of each radio group to exactly one button. The single orange rectangle IS the affordance.
- **Do** use `font-variant-numeric: tabular-nums` on every numeric value (knob value, FPS, timecode). Digits must not jitter.
- **Do** color-code the sidebar's stage dividers by signal-flow direction: amber (OSC) → plum-rose (the transformation chain — STRUCTURE / COLOR / FX RACK / PER-BLOB, all four sharing this hue) → slate-teal (FX, output). All low-chroma, none competing with `orange-signal`.
- **Do** use `state-info` (slate blue) for informational status (modified-from-default dot). Reserve `orange-signal` for the act of changing.
- **Do** use `--space-*` tokens for every padding, margin, and gap.
- **Do** let the stage-divider own all horizontal staging in the sidebar.

### Don't

- **Don't** use `#000` or `#fff` in the chrome. Even the deepest display surface is `oklch(5% 0.005 70)`, not pure black. Pure black at scale reads as a hole, not a surface; pure white reads as printer paper. (Swatch palette swatches are user-selectable canvas colors and are exempt; `Knob Cap White` and `Knob Cap Black` are also slightly off-true.)
- **Don't** use `border-left` (or any side-stripe `border-*` greater than 1px) as a colored accent on toasts, cards, list items, or callouts. Side-stripe borders are an absolute ban.
- **Don't** use `background-clip: text` to apply a gradient to type. Use a single solid color and let weight or size carry the emphasis. Gradient text is decorative; LumiSynth is not decorated.
- **Don't** use `backdrop-filter: blur` on chrome at rest. Replace with solid surfaces from the chassis or display ladders.
- **Don't** apply `filter: drop-shadow` or `box-shadow` ambient glow on chrome at rest. Floating popovers (toast, video controls, help-tooltip, help-panel) carry small structural cast shadows; non-floating chrome stays flat.
- **Don't** add a SaaS dashboard look. No soft greys with identical 12-column card grids, no blue-primary CTA, no "modern" in the boring sense. LumiSynth is not a productivity tool.
- **Don't** add an AI tool look. No gradient orb hero, no beige-and-violet "soft AI" palette, no large sans-serif marketing voice, no emoji status indicators, no chat-shaped affordances.
- **Don't** ship raw form controls. No untreated browser `<input type="range">`, no default `<select>` styling, no Bootstrap-grade defaults.
- **Don't** introduce a second typeface family. Inter only.
- **Don't** put orange on more than one button per radio group at a time. Exactly one orange rectangle per group is the rule.
- **Don't** use a modal for anything except help and future confirm-destructive flows.
- **Don't** use stage colors (amber, plum-rose, slate-teal) on any surface other than the three stage-divider labels. Diluting them onto buttons, cards, or borders kills the signal-flow read.
- **Don't** use `orange-signal` for destructive confirms. That's `state-danger`. The two are intentionally different (danger is redder, lower chroma) so the user can tell active-state apart from about-to-destroy at a glance.
- **Don't** use `orange-signal` for informational status. That's `state-info` (slate blue).
- **Don't** introduce a fourth or fifth saturated color into the chrome. Orange and red are the system; everything else is greyscale (the stage colors and state colors are LOW-chroma greyscale, not "color" in the design sense). Adding a green CTA or a purple toggle violates The Two-Color Rule.
- **Don't** put controls on display surfaces or status readouts on chassis surfaces. The display-vs-chassis split is enforced.
- **Don't** use raw px values for `padding`, `margin`, or `gap` in chrome rules. Pull from the `--space-*` scale.
- **Don't** add `border-bottom` to `.control-section`. The stage-divider is the only horizontal seam in the sidebar.
