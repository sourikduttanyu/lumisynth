---
name: FluxKit
description: Browser-only real-time video instrument. The canvas is loud, the chrome is dim.
colors:
  pink-signal:      "#f72585"
  purple-deep:      "#7e2bc7"
  indigo-cool:      "#4361ee"
  bg-stage:         "#0a0510"
  bg-room:          "#110620"
  surface-card:     "#220a35"
  surface-raised:   "#2f1148"
  surface-hover:    "#461d63"
  border-hairline:  "#321a4d"
  text-key:         "#f0e8f4"
  text-body:        "#d6cee4"
  text-muted:       "#b39bcc"
  text-faint:       "#84649a"
  state-ok:         "#5be7a6"
  state-danger:     "#f5654b"
  state-info:       "#45a5d6"
  stage-osc:        "#d6a045"
  stage-filter:     "#b06ad8"
  stage-fx:         "#45c0c8"
typography:
  headline:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.16em"
  title:
    fontFamily: "Inter, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.14em"
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
    letterSpacing: "0.12em"
  mono-num:
    fontFamily: "Inter, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0"
    fontFeature: "'tnum'"
rounded:
  xs:  "3px"
  sm:  "4px"
  md:  "5px"
  lg:  "6px"
  xl:  "8px"
  2xl: "10px"
  3xl: "12px"
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
    rounded: "{rounded.lg}"
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
    backgroundColor: "{colors.pink-signal}"
    textColor: "{colors.text-key}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
    height: "28px"
  card-effect:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text-body}"
    rounded: "{rounded.2xl}"
    padding: "12px"
  empty-card:
    backgroundColor: "{colors.bg-room}"
    textColor: "{colors.text-faint}"
    rounded: "{rounded.2xl}"
    padding: "18px 14px"
  toast:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text-key}"
    rounded: "{rounded.lg}"
    padding: "10px 14px"
  swatch-btn:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.sm}"
    padding: "0"
---

# Design System: FluxKit

## 1. Overview

**Creative North Star: "The Late-Night Patch"**

FluxKit is built for a VJ booth at 1am. The room is dim, the operator is in the work, the canvas is the only thing the eye should land on. Every chrome element earns its visual weight by serving the canvas, not competing with it. Knobs are felt by muscle memory, not read. Pink appears only when something is changing, active, or destructive; everywhere else, the surface is a tinted indigo neutral that the eye relaxes into.

The aesthetic family is **browser shader playground crossed with hardware synth UI**, with named references in PRODUCT.md to Lumen, Cables.gl, and Ableton Push. FluxKit explicitly rejects three other families it could be mistaken for: generic SaaS dashboard (no soft greys, no 12-column card grid, no blue-primary CTA), AI tool cliché (no gradient orb, no beige and violet palette, no chat affordances), and hobbyist demo (no untreated form controls, no raw `<input type="range">`).

Density is high on purpose. Power users need every knob visible at once, newcomers learn the controls by touching them, and there is no tutorial layer to fall back on. The chrome must be tight enough to fit, terse enough to read at a glance, and consistent enough that muscle memory pays off.

**Key Characteristics:**
- One signal color (`pink-signal`), reserved for change, active, or destructive states.
- One neutral family, every step tinted toward indigo so the eye relaxes in low light.
- Flat surfaces. No backdrop-filter blur, no ambient box-shadow on chrome at rest.
- Knob is the signature component; everything else is supporting cast.
- Canvas occupies the loudest cell; chrome receeds.

## 2. Colors: The Dim-Studio Palette

Every neutral is tinted toward magenta-violet (hue 310, one warm step from the original hue 290) so the eye relaxes in low ambient light without reading clinical or cold. One accent (`pink-signal`) carries every change-of-state moment; semantic state colors carry meaning; three stage colors carry signal-flow direction across OSC → FILTER → FX. The rest of the surface is silent.

### Primary

- **Pink Signal** (`#f72585`, `oklch(63% 0.27 5)`): The only accent in the chrome at rest. Used on the active toggle button, the active filter button border, the value-tooltip border under a knob being touched, the modified-from-default dot, the focus ring, the destructive-action confirm state, the scrub thumb, and nothing else. Pink in chrome with no associated state change is a violation. See **The Pink-Is-Signal Rule** below.

### Secondary

- **Purple Deep** (`#7e2bc7`, `oklch(46% 0.22 305)`): Used inside the knob arc gradient and as the accent ramp midpoint. Never used as a flat surface on its own. Background to nothing, foreground to nothing.
- **Indigo Cool** (`#4361ee`, `oklch(54% 0.24 270)`): The cold end of the knob arc gradient. Same restriction as Purple Deep: not a surface, not a foreground, only inside the SVG knob arc.

### Neutral (the dim-studio ladder, dark to light, OKLCH-canonical at hue 310)

The CSS uses `oklch()` directly for these values; the hex shown is the rendered sRGB approximation for tooling that cannot consume OKLCH (e.g. Stitch's hex-only frontmatter validator).

- **Bg Stage** (`oklch(5% 0.03 310)`, ≈`#0a0510`): Canvas-area background. The deepest surface in the system. The video output sits IN this surface; everything else floats above it.
- **Bg Room** (`oklch(8% 0.04 310)`, ≈`#110620`): Sidebar and top bar background. One step lighter than `Bg Stage` so the chrome reads as a layer above the canvas without box-shadow.
- **Surface Card** (`oklch(15% 0.07 310)`, ≈`#220a35`): Effect-card and toast background. One step lighter than `Bg Room`. The card is felt as raised by tonal contrast alone, not by shadow.
- **Surface Raised** (`oklch(20% 0.10 310)`, ≈`#2f1148`): Default button background, toggle inactive background, swatch container. The interactive layer.
- **Surface Hover** (`oklch(28% 0.12 310)`, ≈`#461d63`): Hover state for any `Surface Raised` surface. One tonal step lighter signals "ready to be pressed".
- **Border Hairline** (`oklch(22% 0.08 310)`, ≈`#321a4d`): All 1px borders in the chrome. Tinted exactly between `Surface Card` and `Surface Raised` so it disappears at the surface boundary and only shows where surfaces meet.

### Text (lavender ladder, all tinted toward hue 310)

- **Text Key** (`oklch(94% 0.02 310)`, ≈`#f0e8f4`): Primary text on dark surfaces. Headlines, knob value tooltip, active button label.
- **Text Body** (`oklch(85% 0.03 310)`, ≈`#d6cee4`): Default body color. Inactive toggle label, card body copy.
- **Text Muted** (`oklch(72% 0.06 310)`, ≈`#b39bcc`): Section labels, file status, knob labels.
- **Text Faint** (`oklch(55% 0.09 310)`, ≈`#84649a`): Empty-state copy, footer, divider sublabels, FPS overlay. The dimmest legible text.

### State (semantic, three roles)

- **State OK** (`#5be7a6`, `oklch(85% 0.18 155)`): Toast success border tint. Mint green; reads as confirm/done.
- **State Danger** (`oklch(70% 0.21 25)`, ≈`#f5654b`): True coral red. Used on the `Reset` button when in two-stage confirm mode (full background + border + text), and on toast error border. Disambiguated from `pink-signal` on purpose: pink is **active state**, danger is **destructive action**. They look different at a glance.
- **State Info** (`oklch(72% 0.15 220)`, ≈`#45a5d6`): Cyan-blue. Used for **informational status** that is neither active nor destructive. Currently: the modified-from-default dot on knobs (a value differs from default; passive observation, not active change). Reserves `pink-signal` for the act of changing.

### Stage Flow (signal-flow color coding, warm → cool)

The three sidebar dividers (OSC, FILTER, FX) carry their own colors to communicate signal direction. Eye reads warm (input) → cool (output) like an audio chain. The hairline rule line beside each label stays neutral; only the uppercase label takes the stage color.

- **Stage OSC** (`oklch(75% 0.15 70)`, ≈`#d6a045`): Warm amber. The input stage. Source video, blob detection, the energy entering the system.
- **Stage Filter** (`oklch(68% 0.20 290)`, ≈`#b06ad8`): Bright violet. The transformation stage. Effect picker plus per-effect knob grids. Distinct from `pink-signal` (different hue, lower chroma) so it never collides with the active-state pink.
- **Stage FX** (`oklch(72% 0.13 195)`, ≈`#45c0c8`): Cool teal. The output stage. Region style, shape, overlay color, blob size, font, connection rate.

### Named Rules

**The Pink-Is-Signal Rule.** Pink (`#f72585`) appears only where a value is being changed, an effect is active, or an action is destructive (NOTE: the destructive case has been moved to `state-danger`; pink now reserved for change/active only). The logo, card titles, dividers, and any decorative element must be a neutral or stage-coded tone. Test: take a screenshot of the app at rest with no interaction. If pink is visible anywhere except the visible effect-card top accent and the active toggle button, the rule is violated.

**The Tinted-Neutral Rule.** Every neutral must carry chroma 0.02–0.12 toward hue 310 (warm magenta-violet). Pure greys (`oklch(L 0 0)`) are forbidden. `#000` and `#fff` are forbidden everywhere in the chrome. The dim-studio palette only works because the eye reads the warm tint as inviting-by-comparison-to-pure-grey, even at low ambient brightness.

**The Signal-Flow Rule.** The three stage dividers are color-coded to signal flow direction: amber (OSC, source) → violet (FILTER, transformation) → teal (FX, output). The eye should be able to scan the sidebar top-to-bottom and feel the input-to-output journey without reading any words. Stage colors appear ONLY on stage-divider labels; using them on any other surface dilutes their meaning.

**The Three-Pinks Rule.** FluxKit has three colors that read as "pink-ish" at a glance, and they must stay distinguishable: `pink-signal` (#f72585, magenta, signals change/active), `state-danger` (true coral, signals destructive action), and `stage-filter` (bright violet, signals the FILTER section). Each lives in its own role. If two of them appear adjacent, audit which roles you have collided.

### Named Rules

**The Pink-Is-Signal Rule.** Pink (`#f72585`) appears only where a value is being changed, an effect is active, or an action is destructive. Pink in chrome at rest is forbidden. The logo, card titles, dividers, and any decorative element must be a neutral or muted tone. Test: take a screenshot of the app at rest with no interaction. If pink is visible anywhere, the rule is violated.

**The Tinted-Neutral Rule.** Every neutral must carry chroma 0.02–0.10 toward hue 290 (indigo-violet). Pure greys (`oklch(L 0 0)`) are forbidden. `#000` and `#fff` are forbidden everywhere in the chrome. The dim-studio palette only works because the eye reads the indigo tint as warm-by-comparison-to-pure-grey, even though it's technically cool.

## 3. Typography

**Display Font:** none. FluxKit has no hero, no marketing surface, no headline larger than 13px.
**Body Font:** Inter (with `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` fallback).
**Label/Mono Font:** Inter with `font-variant-numeric: tabular-nums` for any numeric value (knob value, FPS, timecode).

**Character:** Single-family discipline. Inter only, weight contrast (500 / 600 / 700) does the hierarchy work, no decorative typeface anywhere. The work feels engineered, not designed; the typography stays out of the way of the canvas.

### Hierarchy

- **Headline** (Inter 700, 13px, line-height 1.2, letter-spacing 0.16em uppercase): Help-panel title (`Keyboard & Mouse`). The largest text in the system. Used once per modal context.
- **Title** (Inter 700, 10px, line-height 1.2, letter-spacing 0.14em uppercase): Effect-card title (`Voronoi`, `Cellular`, `ASCII`, etc.). The card name, never decorated.
- **Body** (Inter 500, 12px, line-height 1.45, letter-spacing 0.04em): Default. Action button label, toast body, help-panel list items. Cap line length at 60ch in any prose surface (toast, help panel).
- **Body-Small** (Inter 500, 11px, line-height 1.4, letter-spacing 0.03em): Action-btn (Upload Video, Open Camera). One step down from Body, used when density matters more than weight.
- **Label** (Inter 600, 9px, line-height 1.2, letter-spacing 0.10–0.22em uppercase): Section labels, stage dividers, icon-button text, logo. Letter-spacing widens with importance: 0.10em for icon-btn, 0.14em for section-label, 0.22em for stage-divider.
- **Mono-Num** (Inter 600, 10px, `font-variant-numeric: tabular-nums`): Knob value tooltip, FPS overlay, video timecode, knob `aria-valuetext`. Tabular numerals so the digits don't jitter as values change.

### Named Rules

**The Single-Family Rule.** Inter only. No serif accents, no monospace family, no display face. The Mono-Num role is achieved with `font-variant-numeric: tabular-nums` on Inter, not by switching family. A second typeface in this product would feel decorative, and decoration is what the canvas is for.

**The Letter-Spacing-As-Weight Rule.** Letter-spacing widens with hierarchy importance for uppercase text (0.10em → 0.14em → 0.22em). Use spacing, not size, to differentiate sibling uppercase labels.

## 4. Elevation

**FluxKit is flat by default.** No `backdrop-filter: blur`, no `box-shadow` on chrome at rest. Depth is conveyed by tonal layering: each surface is one OKLCH lightness step lighter than the one below it (`Bg Stage` → `Bg Room` → `Surface Card` → `Surface Raised` → `Surface Hover`). The eye reads the lightness ladder as depth without any glow or blur cost.

Shadows appear only as state transitions, never as chrome decoration. The single justified ambient shadow is on the help-panel modal and the drop-zone overlay (both transient surfaces that need to clearly float above their context). Sidebar, top bar, video-controls, toast, and effect cards are all flat.

### Shadow Vocabulary

- **modal-lift** (`box-shadow: 0 12px 48px rgba(5, 2, 16, 0.6)`): Help panel and drop-zone overlay only. The modal is the only chrome element allowed an ambient shadow, because it must read as floating above a darkened context.
- **focus-ring** (`outline: 2px solid #f72585; outline-offset: 2px`): The focus ring is not a shadow but functions like one. Always pink, always 2px, always with 2px offset. Never use box-shadow as a focus indicator.

### Named Rules

**The Flat-By-Default Rule.** Surfaces at rest have no `box-shadow` and no `backdrop-filter`. Depth is tonal, not blurred. If a designer reaches for a shadow to make a card feel "elevated", they have failed to use the surface ladder. Re-tint the surface one step lighter instead.

**The Modal-Only Shadow Rule.** Only modals (help panel, drop-zone overlay, future confirm dialogs) may carry ambient `box-shadow`. Toast, cards, sidebar, and top bar must remain flat. A shadow on a non-modal surface is a violation.

## 5. Spacing

A single spacing scale is the source of truth for every padding, margin, and gap value in the chrome. The scale is exposed as CSS custom properties in `:root` and is used everywhere; raw px values for spacing are forbidden in component rules.

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

The sidebar is a vertical stack of stage groups. Three stages, color-coded dividers, no per-section dividers.

- **Stage divider** owns staging. `padding: var(--space-xl) var(--space-xl) var(--space-sm)` — generous breath above, hairline rule line below the label, then control sections begin tight under it.
- **Control sections within a stage** are quiet. `padding: var(--space-md) var(--space-lg)` and **no `border-bottom`** — sections inside one stage read as a single tonal group, not as eight equally-weighted rows. The stage-divider is the only horizontal seam.
- **Effect cards** are tonal stand-outs. `margin: var(--space-md) var(--space-lg)`, `padding: var(--space-lg)`, `background: Surface Card`. The card layer above sidebar is achieved by tonal contrast (Surface Card sits one step lighter than Bg Room) plus inset margin, not by elevation.

### Named Rules

**The Spacing-Token Rule.** Every `padding`, `margin`, and `gap` value in component CSS must come from a `--space-*` token. Raw px values for spacing are forbidden in chrome rules. Exceptions: borders (always `1px solid`), focus-ring offsets (locked at `2px`), the universal reset (`margin: 0; padding: 0;`), intra-component micro-spacing where the value is part of the component's geometric definition (knob's intra-stack `gap: 3px`, sidebar-header-text's tight `gap: 1px`).

**The Stage-Owns-Staging Rule.** Within a stage (OSC, FILTER, FX), control sections do not draw their own bottom borders. The stage-divider is the only horizontal seam in the sidebar. Adding a `border-bottom` to `.control-section` over-segments the sidebar and dilutes the three-stage architecture; the eye should read three groups, not eight rows.

## 6. Components

For each component: short character line, then shape, color, states, and any distinctive behavior.

### Buttons

Three button shapes. Each has a clear job.

#### Action Button (`.action-btn`) — the deliberate one

The "Upload Video" / "Open Camera" surface. Used when the user is committing to a multi-second action.

- **Shape:** rounded 6px (`{rounded.lg}`).
- **Default:** background `Surface Raised` (`#241245`), text `Text Key`, padding `8px 12px`, min-height 30px, font Body-Small (Inter 500, 11px, 0.04em).
- **Hover:** background `Surface Hover` (`#341c5c`). 1px `Border Hairline` becomes `Pink Signal` (border tint, not a glow).
- **Focus-visible:** 2px Pink Signal outline with 2px offset.
- **Disabled:** opacity 0.4, cursor not-allowed, no hover treatment.

#### Icon Button (`.icon-btn`) — the small one

`Reset` (sidebar header), `Snap` / `?` / `FPS` (canvas top bar). High density, low padding.

- **Shape:** rounded 4px (`{rounded.sm}`).
- **Default:** background `Surface Raised`, text `Text Key`, padding `5px 10px`, min-height 26px, font Label (Inter 600, 9px, uppercase, 0.10em).
- **Hover:** background `Surface Hover`, border `Pink Signal`.
- **Active-pressed (`.confirming`):** background `oklch(28% 0.18 15)` (danger-tinted surface), border `State Danger`, text `State Danger`. Used by the two-stage `Reset` button between first and second click.

#### Toggle Button (`.toggle-btn`) — the radio-group one

Used for radio groups: speed, detect mode, region style, shape, blob size, erode mode, false-band. Inside a `.toggle-group` flex row.

- **Shape:** rounded 5px (`{rounded.md}`).
- **Inactive:** background `Surface Raised`, text `Text Body`, padding `6px 8px`, min-height 28px, font Body (Inter 500, 10px).
- **Hover:** background `Surface Hover`, text `Text Key`, border `Pink Signal`.
- **Active (`aria-checked="true"`):** background `Pink Signal`, text `Text Key`, font weight 700. The active state is the only place pink appears on a chrome surface at rest, and it is always exactly one button per group.

### Filter Button (`#filter-group .toggle-btn`) — the signature

The 14 effect choices in the FILTER section. Each button is a **full-bleed gradient swatch** approximating the effect's output palette (thermal: black → purple → red → yellow → white; biolum: dark → cyan → violet; etc.). The label sits over the swatch with text-shadow for legibility.

- **Shape:** rounded 5px (`{rounded.md}`), 33% width (3-up grid), min-height 42px (taller than other toggles to give the swatch room).
- **Per-button background:** linear gradient unique to each filter. The gradient IS the button's identity; without it, the picker would be 14 identical labelled rectangles. With it, the user can recognize ASCII vs. Voronoi vs. Thermo at a glance after one session of use.
- **Inactive:** dark scrim overlay (`linear-gradient(180deg, rgba(0,0,0,0.15), rgba(0,0,0,0.6))`) on top of the swatch so the white label stays readable.
- **Active:** 2px `Pink Signal` border, scrim lightened to (`rgba(0,0,0,0.05) → rgba(0,0,0,0.45)`), font weight 700. **No box-shadow glow** (current code has one; remove in next polish pass).

### Knob (`.knob`) — the signature instrument component

Custom 40×40 SVG. The most-touched control in the system.

- **Shape:** circle. Outer track is a 270° arc starting at -135° (south-west) and sweeping to +135° (south-east), 18px radius, 3px stroke. Inner cap is an 11px solid circle. Pointer is a 13px line from cap edge to outer arc.
- **Track:** `Border Hairline` at 0.7 alpha. Hairline-quiet; the eye should read the arc fill, not the track.
- **Arc (filled portion):** linear gradient pink → purple → indigo (`Pink Signal` → `Purple Deep` → `Indigo Cool`). The gradient is the only place all three signal colors appear together. Stroke 3px, no drop-shadow filter (current code applies one; remove).
- **Pointer:** 2px white stroke (`Text Key`), no glow filter (current code applies one; remove). The pointer is the only "white" element in the chrome and signals the current value.
- **Cap:** `Bg Room` fill (`#0a0418`), 1px `Border Hairline` stroke. The cap reads as a punched hole in the surface.
- **Label** (below): Mono-Num, `Text Muted`, max 2 lines, wrap not truncate.
- **Value tooltip** (on hover/focus/drag): Mono-Num, `Text Key`, background `Surface Card`, 1px `Pink Signal` border, padding `2px 7px`, rounded 4px, positioned 16px below the SVG. Only visible during interaction.
- **Modified-from-default indicator:** 4px `State Info` (cyan) dot, inline after the label, only when current value differs from `data-default`. Cyan because "this value differs from default" is informational status, not active change. Pink stays reserved for the act of changing.
- **States:** hover background `oklch(15% 0.10 5 / 0.05)` (faint pink wash), focus-visible 2px `Pink Signal` ring, dragging same as hover plus tooltip held visible.
- **Interactions:** vertical pointer drag, Shift = 10× fine, double-click = reset to default, keyboard (`↑` `↓` `←` `→` step, `PgUp` `PgDn` 10×, `Home` `End` min/max), mouse wheel.

### Effect Card (`.effect-card`)

The container that holds per-effect knob grids. One visible at a time (matched to active filter).

- **Shape:** rounded 10px (`{rounded.2xl}`).
- **Background:** `Surface Card`. Solid. No backdrop-filter.
- **Border:** 1px `Border Hairline`.
- **Top accent:** 2px solid `Pink Signal` along the top edge (NOT `border-top-width: 3px+ side-stripe`; this is a 2px full-top accent rendered via `::before`, with `border-radius: 10px 10px 0 0` so it follows the card's rounded corner). Indicates "this card is the active effect's controls".
- **Active state (matches active filter button):** border becomes `Pink Signal` at 0.45 alpha. **No box-shadow glow.**
- **Header:** title (Title role) on the left, per-card reset `×` button (Text Faint, hover Pink Signal) on the right.
- **Internal padding:** 12px (`{spacing.lg}`).
- **Knob grid:** 2-column, gap `22px 6px` (row gap accommodates the value-tooltip drop without colliding with the next row).

### Empty Card (`.empty-card`)

Placeholder shown in the FILTER stack when no effect is selected. Italic, centered, dashed border. Communicates "this slot is intentionally empty" not "something failed to load".

- **Shape:** rounded 10px (`{rounded.2xl}`).
- **Background:** `Bg Room`.
- **Border:** 1px **dashed** `Border Hairline`. The dashed border is the signal of "empty by design".
- **Text:** `Text Faint`, italic, 10px, centered.
- **Padding:** `18px 14px`.

### Toast (`.toast`)

Bottom-center, transient. Stacks vertically (newer at bottom).

- **Shape:** rounded 6px (`{rounded.lg}`).
- **Background:** `Surface Card`. Solid. No backdrop-filter.
- **Border:** 1px `Border Hairline`. **Full border, never a side-stripe.** Tone variants are achieved by tinting the entire border, not by adding a thick `border-left`.
- **Tone variants:** info = neutral border. ok = border `State OK`. error = border `State Danger`.
- **Padding:** `10px 14px`.
- **Position:** bottom 18px, horizontally centered, max-width 420px.
- **Motion:** enters with 200ms `translateY(8px) → 0` + opacity, gated behind `prefers-reduced-motion`.

### Help Panel (`.help-panel`)

Modal overlay. The only chrome element allowed `box-shadow: modal-lift` and a backdrop overlay.

- **Shape:** rounded 12px (`{rounded.3xl}`).
- **Background:** `Surface Card` solid.
- **Border:** 1px `Border Hairline`.
- **Shadow:** `modal-lift` (the only justified ambient shadow in the system).
- **Backdrop:** semi-opaque `Bg Stage` at 0.75 alpha. **No `backdrop-filter: blur`.**
- **Title:** Headline role (Inter 700, 13px, 0.16em uppercase), `Text Key`. Solid color, no gradient.
- **Section heads:** Title role, `Text Muted`.
- **`<kbd>`:** Inter 600, 10px, padding 2px 6px, background `Surface Raised`, 1px `Border Hairline`, rounded 3px (`{rounded.xs}`).

### Swatch Button (`.swatch-btn`)

Overlay-color palette. 8 swatches in a row, plus native `<input type="color">` as fallback.

- **Shape:** square, aspect-ratio 1:1, rounded 4px (`{rounded.sm}`).
- **Background:** the swatch color itself (this is one of the few places #000 and #fff are allowed, because they are user-selectable canvas overlay colors, not chrome surfaces).
- **Border:** 1px `Border Hairline` default.
- **Hover:** transform scale(1.1), border `Text Key`.
- **Active (selected):** border `Pink Signal`. **No box-shadow glow.**

### Named Rules

**The One-Active-Per-Group Rule.** Pink may appear on at most one button per radio group at a time. Speed = 4 buttons, exactly one pink. Detect Mode = 2 buttons, exactly one pink. The user always knows which one is selected by scanning for the single pink rectangle.

**The Knob-Is-The-Signature Rule.** All other components recede in the design hierarchy. If a new component competes with the knob for visual attention, the new component is wrong. The knob is the only place where chroma + arc + pointer + tooltip all converge.

## 7. Do's and Don'ts

### Do

- **Do** use `Pink Signal` (`#f72585`) only when something is changing, active, or destructive. Logo, card titles, dividers, and any decorative element must use a neutral.
- **Do** layer surfaces tonally (`Bg Stage` → `Bg Room` → `Surface Card` → `Surface Raised` → `Surface Hover`). The lightness ladder IS the depth system.
- **Do** tint every neutral toward indigo (hue 290, chroma 0.02–0.10). The dim-studio relaxation only works with the tint.
- **Do** keep the canvas the loudest element on screen. Test by squinting; if your eye lands on a sidebar control before the canvas, the chrome is too loud.
- **Do** use full-bleed gradient swatches on the filter buttons. The gradient IS the identity; this is the one place visual variety serves recognition over decoration.
- **Do** wrap long knob labels to 2 lines instead of truncating. The label is a rare moment of legibility in a knob-dense surface.
- **Do** respect `prefers-reduced-motion` on every transition (toast enter, knob arc transition, card hover). Already partially implemented; audit any new motion against this.
- **Do** keep the active state of each radio group to exactly one button. The single pink rectangle IS the affordance.
- **Do** use `font-variant-numeric: tabular-nums` on every numeric value (knob value, FPS, timecode). Digits must not jitter.
- **Do** color-code the three stage dividers by signal-flow direction: amber (OSC) → violet (FILTER) → teal (FX). One color per stage label, hairline rule line stays neutral.
- **Do** use `state-info` (cyan) for informational status (modified-from-default dot, future "live recording" indicator). Reserve `pink-signal` for the act of changing.
- **Do** use `--space-*` tokens for every padding, margin, and gap. The scale is the source of truth; raw px values for spacing belong in border widths, focus-ring offsets, or intra-component micro-geometry only.
- **Do** let the stage-divider own all horizontal staging in the sidebar. Sections within a stage stay quiet (no bottom border) so the three-stage architecture reads cleanly.

### Don't

- **Don't** use `#000` or `#fff` in the chrome. Even the deepest background is `oklch(5% 0.03 285)`, not pure black. Pure black at scale reads as a hole, not a surface. (Swatch palette swatches are user-selectable canvas colors and are exempt.)
- **Don't** use `border-left` (or any side-stripe `border-*` greater than 1px) as a colored accent on toasts, cards, list items, or callouts. **Current `.toast` violates with `border-left: 3px solid pink`; replace with full-border tonal variant.** Side-stripe borders are an absolute ban.
- **Don't** use `background-clip: text` to apply a gradient to type. **Current `.logo`, `.effect-card-title`, `#help-panel h2`, and `.placeholder-icon` all violate.** Use a single solid color and let weight or size carry the emphasis. Gradient text is decorative; FluxKit is not decorated.
- **Don't** use `backdrop-filter: blur` on chrome at rest. **Current `#sidebar`, `.sidebar-header`, `#canvas-topbar`, `#video-controls`, `#help-panel`, and `.toast` all violate.** Replace with solid tinted surfaces from the dim-studio ladder. Glassmorphism as default is an absolute ban; help panel may use a darkened backdrop *without* blur.
- **Don't** apply `filter: drop-shadow` or `box-shadow` ambient glow on chrome at rest. **Current `.knob-arc`, `.knob-pointer`, `.toast`, `#help-panel`, active filter button, active card, and active swatch button all carry decorative glow.** The arc gradient and the pointer are crisp on their own; depth is conveyed tonally. Modal-lift is the single justified shadow.
- **Don't** add a SaaS dashboard look. No soft greys, no identical 12-column card grids, no blue-primary CTA, no "modern" in the boring sense. FluxKit is not a productivity tool.
- **Don't** add an AI tool look. No gradient orb hero, no beige-and-violet "soft AI" palette, no large sans-serif marketing voice, no emoji status indicators, no chat-shaped affordances.
- **Don't** ship raw form controls. No untreated browser `<input type="range">`, no default `<select>` styling, no Bootstrap-grade defaults. The instrument has to feel built.
- **Don't** introduce a second typeface family. Inter only. Tabular-nums on Inter is the mono role; do not reach for IBM Plex Mono or JetBrains Mono.
- **Don't** put pink on more than one button per radio group at a time. Exactly one pink rectangle per group is the rule.
- **Don't** use a modal for anything except help (current) and future confirm-destructive flows. Modals are usually laziness; exhaust inline alternatives first. The two-stage `Reset` button is the canonical example of a confirm without a modal.
- **Don't** use stage colors (amber, violet, teal) on any surface other than the three stage-divider labels. Diluting them onto buttons, cards, or borders kills the signal-flow read.
- **Don't** use `pink-signal` for destructive confirms. That's `state-danger` (true coral). The two pinks are intentionally different so the user can tell active-state apart from about-to-destroy at a glance.
- **Don't** use `pink-signal` for informational status. That's `state-info` (cyan). The modified-from-default dot is information, not signal.
- **Don't** use raw px values for `padding`, `margin`, or `gap` in chrome rules. Pull from the `--space-*` scale. If the scale doesn't have what you need, the answer is almost always "round to the nearest token", not "introduce a new literal".
- **Don't** add `border-bottom` to `.control-section` (or any per-section divider inside a stage). The stage-divider is the only horizontal seam in the sidebar; per-section borders over-segment and break the three-stage read.
