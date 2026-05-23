# PROJECT_NAME — Product Spec
*Creative direction. UI, behavior, feel. No tech decisions — those are yours.*

---

## What this is

A web-based **luminance synthesizer**. User drops in a video, image, or webcam. The app processes it through three sequential stages — Structure, Color, FX — and outputs a clip, a still, or a live feed.

It is an **instrument**, not a filter app.

It feels like a piece of hardware — Teenage Engineering's industrial design, Game Boy's framing, a synth's signal flow, a video editor's timeline. Touch a knob, the picture changes. Watch the Subject (a small dancing silhouette in the corner) react in real time before you even load your own video.

**Pitch:** *"Real-time visual synthesis in your browser. No AI."*

**Not:** a filter app. Not an AI generator. Not a clone of any existing tool.

**Vibe reference:** if Ableton, OP-1, Photoshop, and an analog synth had a baby and it processed video instead of sound.

---

## How it works (one paragraph)

The user picks a Source (video / image / webcam). The Source flows through three stages in order: Structure (reshape the form), Color (paint it), FX (distort and finish). Each stage has its own picker and four knobs. The Subject — a small live-rendered silhouette in the top-right — shows what every stage is doing in real time, even before a Source is loaded. The user can switch between **Synth mode** (full LumiSynth chain) and **Tracking mode** (BlobTracking analysis composited on top, or shown alone). They export a clip, image, or live feed.

---

## The mental model

```
┌─── SOURCE ──────────────────────────────────────────┐
│  video  |  image  |  webcam                         │
│  knobs: speed · loop · reverse · trim/hold          │
└──────────────────────┬──────────────────────────────┘
                       ↓
              ┌─── STRUCTURE ────┐    Stage 1 — reshape form into luma
              │   one effect     │    Output: grayscale luminance
              │   four knobs     │
              └────────┬─────────┘
                       ↓
              ┌─── COLOR ────────┐    Stage 2 — paint the luma
              │   3 modes:       │    Modes: Ramp | Cosine | Film
              │   Ramp · Cosine  │    Output: full RGB
              │   Film (12)      │
              └────────┬─────────┘
                       ↓
              ┌─── FX ───────────┐    Stage 3 — distort + finish
              │  Mutate (6)      │    Two stacked sub-stages
              │  Decay   (5)     │    Output: final image
              └────────┬─────────┘
                       ↓
                    OUTPUT
       (preview · export · live · BlobTracking layer)
```

This is **strict pipeline**. Each stage reads only the previous stage's output. No layers, no blends, no parallel composites. Order is fixed. Like a synth.

---

## The Subject

A small monochrome silhouette of a dancing figure, looping forever in a 3-second loop. Lives in a Game-Boy-screen-style framed window (~120×120 px) pinned to the top-right corner of the workspace at all times.

**The Subject is being processed by the user's current chain in real time.** Every knob turn updates it. Every effect swap updates it. Even before the user has loaded a Source, the Subject is alive — they can play with the entire synth and see what it does.

**Interactions:**
- Click the Subject to **maximize** it into the center preview window (useful when no Source is loaded — full-screen Subject becomes the canvas).
- The Subject framing has a tiny label below: `THE SUBJECT` in caps, monospace.
- Right-click the Subject to **swap** to a different default loop. Three loops in v1: Dancer, Smoke, Bloom (a dancer silhouette, slow drifting smoke, a flower opening). Picked once, persists per session.

**Why the Subject exists:**
- Empty state is no longer empty. New users see something already alive.
- Live feedback before commitment — try effects without loading anything.
- The Subject becomes the brand. Reels of "the Subject through every effect" go viral.
- It tests motion-aware effects (Motion Edge, Velocity Trails, Echo Trail) without needing real video.

---

## The workspace

One slab. No panels stacking on top of each other. No pop-out windows. **Single-screen instrument** at 1440×900 minimum, scales gracefully to wider.

```
┌──────────────────────────────────────────────────────────────┐
│ [LOGO]  project_name.lumi              [save] [load] [export]│  TOP BAR (40 px)
├──────────────┬─────────────────────────────┬─────────────────┤
│              │                             │                 │
│              │                             │                 │
│              │                             │  ┌───────────┐  │
│   STRUCTURE  │      ┌───────────────┐      │  │           │  │
│              │      │               │      │  │ THE       │  │
│  [picker]    │      │   PREVIEW     │      │  │ SUBJECT   │  │  TOP-RIGHT
│              │      │               │      │  │           │  │  always pinned
│  ◉ ◉ ◉ ◉    │      │               │      │  └───────────┘  │
│   knobs      │      │               │      │                 │
│              │      │               │      │     FX RACK     │
│              │      └───────────────┘      │                 │
│              │                             │  + Add FX       │
│              │   ┌─────────────────────┐   │                 │
│              │   │  COLOR              │   │  ┌───────────┐  │
│              │   │  [Ramp│Cosine│Film] │   │  │ rgbsplit  │  │
│              │   │  ●─●──────●         │   │  │ ◉ ◉ ◉ ◉   │  │
│              │   └─────────────────────┘   │  └───────────┘  │
│              │                             │  ┌───────────┐  │
│              │   ╞══════ TIMELINE ══════╡  │  │ vignette  │  │
│              │                             │  │ ◉ ◉ ◉ ◉   │  │
├──────────────┴─────────────────────────────┴─────────────────┤
│  SOURCE: [video.mp4]  [▶/⏸] [↻ loop] [⇄ rev] [1.0× speed]   │  SOURCE BAR
└──────────────────────────────────────────────────────────────┘
```

### Top bar
- **Logo / wordmark** on the left (small, monospace)
- **Project name** middle, click to rename inline
- **Save / Load / Export** right side, three small buttons
- **Mode toggle** small switch on far right: `SYNTH · TRACK` — flips between LumiSynth and BlobTracking composited modes

### Left rail — STRUCTURE
- Effect picker (dropdown showing effect name + tiny live thumbnail of each option)
- Four knobs in a horizontal row beneath
- Knob labels in caps below each knob
- Tiny `STRUCTURE` label at the top of the rail

### Center column — PREVIEW + COLOR + TIMELINE
- **Preview window** top, ~16:9 or auto-aspect to source. The big screen.
- **Color stage** middle, full-width strip with three-mode tabs and the active mode's UI
- **Timeline** bottom strip when source is video — scrubber + trim handles + duration

### Right rail — SUBJECT + FX RACK
- **The Subject** top, framed window
- **FX RACK** below — vertical stack of cards
  - `+ Add FX` button at top
  - Each card: effect name, four knobs, drag handle, on/off toggle, X to remove
  - Reorder by dragging cards up/down

### Source bar
- Bottom of the screen, full-width strip
- Filename, transport controls, speed knob, loop/reverse toggles
- Replace source by drag/drop anywhere on the workspace

---

## Visual style

### Palette
- **Base:** deep purple-black `#0a0418`, soft radial gradients in violet and pink in the background (consistent with the Patreon guide PDF)
- **Panels:** translucent purple over the base, glassmorphic, soft borders in `purple-300/25`
- **Text:** white headlines, lavender body, mid-purple captions
- **Stage accents (used sparingly, on focus/active states only):**
  - STRUCTURE → electric indigo `#818cf8`
  - COLOR → magenta-pink `#ec4899`
  - FX → amber `#fbbf24`
  - TRACKING → cyan `#22d3ee`

### Typography
- **UI:** Inter (or a system sans). Caps + tracked-out for labels. Sentence case for content.
- **Monospace:** for project names, file paths, effect IDs, timestamps. Use sparingly.

### Knobs
**These are the soul of the product. Get them right.**

- Circular, ~52 px diameter
- **Vertical drag** (up = increase, down = decrease). Standard for music software.
- **Shift+drag** for fine control (10× slower)
- **Double-click** resets to default
- **Hover** shows current value as a tooltip in the knob center
- **Active knob** has a soft glow in the stage's accent color
- **Arc indicator** behind the knob — a faint ring filling from bottom (0) to top (max)
- Knob label below in caps, 9pt, lavender

### Buttons
- Subtle. Rounded corners (4px). No drop shadows. Active state = filled with accent color.
- Hover state = slight brightness shift, no animation longer than 100ms

### Animations
- Knob feedback: instant, no easing (it should feel like hardware, not a webpage)
- Modal open/close: 200ms ease-out
- Mode switches: 150ms cross-fade between sub-UIs
- The Subject loops smoothly, no easing on its own animation

### What we are NOT doing
- No emoji in the UI
- No drop shadows
- No skeuomorphic textures (no fake leather, fake brushed metal, fake wood)
- No light mode in v1
- No icons on knobs (knobs are abstract and name-labeled)
- No "ooh fancy" intro animation when the app loads (it should feel like opening a tool, not booting a game)

---

## Source

The source is the raw material. It feeds the rest of the chain.

### Three input modes
1. **Video file** — drag/drop mp4, mov, webm. Maximum length and quality determined by friend.
2. **Webcam** — getUserMedia. Live preview only in v1. No recording.
3. **Still image** — drag/drop png, jpg, webp. The chain processes a single frame, but the Subject still animates so the workspace feels alive.

### Source controls (Source bar at bottom)
A dedicated strip with these controls, exposed always:

- **Filename / source name** (left)
- **Play / Pause** (transport)
- **Loop toggle** — on by default for videos
- **Reverse toggle** — flips playback direction
- **Speed knob** — 0.25× to 4×, default 1×, scrubs through speeds smoothly
- **Trim handles** on the timeline above (only when video) — drag in/out points to crop the loop
- **Frame Hold button** — freezes on the current frame; useful for treating a single frame as a still

These aren't effects but they completely change what the chain produces. Slow-mo through Pixel Sort Melt looks nothing like real-time. Reversed Echo Trail reads completely different. The Source layer is where users discover that motion itself is a parameter.

### Empty state
When no Source is loaded:
- Preview window shows a simple drag/drop hint
- The Subject is still alive in the corner
- All knobs work, all effects can be picked, the entire chain processes the Subject
- Drag a file anywhere on the workspace to load. No "click to upload" button needed.

---

## Stage 1 — STRUCTURE (9 effects)

Reshapes raw RGB into a single-channel luminance signal. Output is grayscale. This is the "form" stage — what does the picture look like as pure tone, before any color is applied?

### How effects appear in the picker
A dropdown opens to show all 9 options. Each one shows:
- Effect name on the left
- Tiny live thumbnail on the right (32×32, the effect rendered onto a test pattern in real time)
- The thumbnails update as you change parameters — so once you've picked one, the others in the dropdown update to show what they'd look like with similar settings

### The 9 effects

#### 1. Off
Pure luminance passthrough. No reshape.
- *No knobs.*

#### 2. ASCII
A family of glyph-quantization patterns. The image is broken into cells; each cell becomes a glyph based on its luminance. Five sub-modes via knob 4.
- **Knob 1 — CELL SIZE** (8–48 px) — the size of each glyph cell. Smaller = denser, finer detail.
- **Knob 2 — CONTRAST** (0–1) — how aggressively the glyph ramp maps to luma. Low = soft, gradual; high = severe black-and-white feel.
- **Knob 3 — DEPTH** (0–1) — adds a 3D pop where bright cells protrude (larger or offset glyphs) and dark cells recede. At 0 it's flat; at 1 the image looks like a 3D point cloud built from letters.
- **Knob 4 — STYLE** (5 positions, hard quantized to integer)
  - 0: **Letters** — classic `.:-=+*#@` ramp
  - 1: **Blocks** — Unicode blocks `▁▂▃▄▅▆▇█`
  - 2: **Braille** — 8-dot braille, very high apparent resolution
  - 3: **Custom** — uses a user-typed string (defaults to "PROJECT_NAME" until user types their own — a small text input appears beneath the knobs when in Custom mode)
  - 4: **Mixed** — randomized selection from all four per cell

#### 3. Contour Lines
Topographic-map lines drawn at fixed luminance intervals. The image is sliced into N tonal bands and only the boundaries between bands are drawn.
- **Knob 1 — DENSITY** (4–32 lines) — how many luma slices to draw lines between.
- **Knob 2 — THICKNESS** (1–8 px) — line weight.
- **Knob 3 — JITTER** (0–1) — perturbs the contours so they wobble organically instead of being mathematically clean. At 0 they're laser-precise. At 1 they're shaky like hand-drawn.
- **Knob 4 — FALLOFF** (0–1) — softens the line edges. At 0 lines are crisp; at 1 they bloom into the surrounding tone, reading more like ink-bleed than vectors.

#### 4. Cross-Hatch
Pen-and-ink-style shading. Diagonal lines whose density tracks luminance. Editorial illustration look.
- **Knob 1 — SPACING** (2–24 px) — distance between hatch lines.
- **Knob 2 — ANGLE** (0–180°) — direction of the hatching.
- **Knob 3 — LAYERS** (1–4) — how many overlapping hatch directions. 1 = single direction; 2 = cross-hatch; 3 = triple; 4 = mesh.
- **Knob 4 — INK WEIGHT** (0–1) — line thickness and darkness combined. Low = sketchy; high = dense engraving.

#### 5. Stippling
Dot density mirrors luminance. Like pointillism or engraving. Cleaner than halftone, more organic.
- **Knob 1 — DOT SIZE** (1–12 px) — diameter of each dot.
- **Knob 2 — DENSITY** (0–1) — how much of the image gets dots vs. negative space.
- **Knob 3 — JITTER** (0–1) — randomness in dot placement. Low = grid-locked; high = scattered organically.
- **Knob 4 — INVERT** (0–1) — at 0 dots represent dark areas (engraved); at 1 dots represent light areas (luminous). Smooth crossfade in the middle.

#### 6. Erosion
Morphological shrink. Bright areas are eaten by surrounding dark. Like ink slowly drying and pulling back.
- **Knob 1 — RADIUS** (1–10 px) — how far the erosion reaches per step.
- **Knob 2 — STRENGTH** (0–1) — how aggressive each erosion pass is.
- **Knob 3 — DIRECTION** (-1 to 1) — at -1 it's pure erosion (shrink); at 0 it's neutral; at 1 it's dilation (grow). One knob handles both directions of the morphological operation.
- **Knob 4 — TEXTURE** (0–1) — adds noise to the erosion pattern so it eats the image unevenly. At 0 it's smooth; at 1 it looks like rust or decay.

#### 7. Pixel Sort Melt
Melt + pixel sort. Bright pixels stretch downward in vertical streaks, but the streak isn't a smooth slump — it's a sharp glitch trail of sorted pixels. Reads like data corruption melting downward.
- **Knob 1 — THRESHOLD** (0–1) — luminance cutoff. Pixels above the threshold sort/melt; pixels below stay still.
- **Knob 2 — LENGTH** (0–1) — how far down the streaks extend.
- **Knob 3 — DIRECTION** (4 positions) — Down / Up / Left / Right. The direction streaks travel.
- **Knob 4 — CHAOS** (0–1) — at 0 streaks are perfectly aligned; at 1 they fragment and break, more glitched.

#### 8. Edge Detect
Spatial edges only. Sobel-style outline of where bright meets dark in any single frame.
- **Knob 1 — SENSITIVITY** (0–1) — how subtle a transition counts as an edge.
- **Knob 2 — THICKNESS** (1–6 px) — line weight on detected edges.
- **Knob 3 — INVERT** (0–1) — at 0 edges are bright on dark; at 1 edges are dark on bright.
- **Knob 4 — SMOOTHING** (0–1) — softens edges, removes high-frequency noise. Low = razor lines; high = brush strokes.

#### 9. Motion Edge
Temporal edges. Only pixels that *changed* between this frame and the last get drawn. Static backgrounds disappear entirely. Wave a hand and only the hand has lines. The signature "motion as subject" effect.
- **Knob 1 — SENSITIVITY** (0–1) — how much motion is needed to register as an edge.
- **Knob 2 — TRAIL** (0–1) — how long detected motion edges persist after the actual movement stops. At 0 they vanish instantly; at 1 they linger like phosphor decay.
- **Knob 3 — THICKNESS** (1–6 px) — edge weight.
- **Knob 4 — NOISE GATE** (0–1) — filters out tiny flickering changes (camera grain, compression artifacts). High = only big motion registers.

---

## Stage 2 — COLOR (3 modes, 12 Film palettes)

Reads the grayscale luminance from Stage 1 and paints it as RGB. **This stage has three modes.** User picks which mode is active via tabs at the top of the Color strip.

```
┌─── COLOR ────────────────────────────────────────┐
│  [ RAMP ]   [ COSINE ]   [ FILM ✓ ]              │
│  ─────────────────────────────────               │
│  ●─────●──────●─────────●                        │
│  (the active mode's UI fills this strip)         │
└──────────────────────────────────────────────────┘
```

Default mode on first open: **FILM** with **Cyanotype** loaded.

### Mode 1 — RAMP
A horizontal gradient strip that the user shapes directly.

- The strip's X-axis is luminance (0 left, 1 right). Y-axis is implicit (the color at that luma).
- **Click anywhere on the strip** to add a stop.
- **Drag a stop left/right** to reposition.
- **Click a stop** to open a color picker.
- **Right-click a stop** to delete.
- **Double-click empty space** to add a stop with auto-interpolated color.
- A **preset dropdown** above the strip lets the user load any Film palette as starting stops — picking a preset doesn't lock anything, the user can keep editing freely.
- Knobs (4) for global ramp adjustments:
  - **Knob 1 — POSITION** (-1 to 1) — slides the entire ramp left/right; reframes which luma values get which colors.
  - **Knob 2 — COMPRESS** (0–1) — squishes or stretches the ramp around its center.
  - **Knob 3 — INVERT** (0–1) — smoothly inverts the ramp.
  - **Knob 4 — DESATURATE** (0–1) — pulls all stops toward grayscale. Useful for muting a too-loud preset.

### Mode 2 — COSINE
The Iñigo Quílez parametric palette formula. Four RGB phase vectors (12 sliders total) produce infinite mathematically-harmonious palettes.

- The UI shows a generated gradient strip at the top (live preview of the current palette).
- Below it, **four knobs** corresponding to the most expressive parameters:
  - **Knob 1 — HUE OFFSET** (0–1) — shifts the entire palette around the color wheel.
  - **Knob 2 — RANGE** (0–1) — how much hue variation across the luma range. Low = monochromatic; high = full spectrum.
  - **Knob 3 — BRIGHTNESS** (0–1) — overall lightness of the palette.
  - **Knob 4 — SATURATION** (0–1) — color intensity.
- An "Advanced" expand button reveals the full 12 sliders for power users. Most users will never touch this, but it's there.
- A **Random** button (small dice icon) generates new params. Roll the dice until you find a palette you love.

### Mode 3 — FILM
12 curated palettes. User picks one from a dropdown showing the name and a tiny gradient swatch.

The four knobs adjust the palette globally:
- **Knob 1 — INTENSITY** (0–1) — blend between grayscale (0) and full palette (1). At 0.5 it's a desaturated wash; at 1 it's the full palette.
- **Knob 2 — SHIFT** (-1 to 1) — slides the palette mapping along the luma axis (the palette itself doesn't change; what changes is which luma values get which colors).
- **Knob 3 — CONTRAST** (0–1) — compresses or expands the dynamic range before the palette is applied.
- **Knob 4 — VARIANT** (0–1) — each palette has a built-in variation axis (e.g., "Cyanotype" might shift from cool to warm cyan; "Aurora Storm" might shift from green-dominant to indigo-dominant). Lets each palette have a sub-aesthetic.

The 12 Film palettes:

| # | Name | Vibe |
|---|---|---|
| 1 | Off | Grayscale passthrough |
| 2 | Cyanotype | Blueprint — black through deep cobalt to pale cyan |
| 3 | Infrared Film | Aerochrome — magentas in foliage zones, cyan skies |
| 4 | Thermal | Heat camera — black, red, orange, yellow, white |
| 5 | False Color | Scientific data viz — switchable across viridis, magma, inferno, turbo via VARIANT knob |
| 6 | Nebula | Space gas — deep blue, magenta, pink, white |
| 7 | Aurora Storm | Animated indigo, green, cyan with subtle drift |
| 8 | Acid Wash | Bleached oversaturated — high-contrast greens, yellows, pinks |
| 9 | Holographic | Iridescent — color shifts based on luma gradient direction (not just luma value) |
| 10 | Depth Stack | Hard-banded zones — distinct color blocks at luma thresholds |
| 11 | Two-Tone Gradient | Two user-pickable colors with a smooth ramp between (color pickers replace knob 4) |
| 12 | Vapor | Pastel pinks, cyans, lavenders — vaporwave |



### Behavior across modes
- Switching modes preserves what makes sense. If user is in Film with Cyanotype and switches to Ramp, the Ramp loads Cyanotype's stops automatically as starting material.
- The Color preview is always live — every drag, every knob turn, the Subject and the main preview update instantly.

---

## Stage 3 — FX (Mutate + Decay, stacked rack)

Stage 3 is one rack with two sub-categories of effects: **Mutate** (spatial distortion) and **Decay** (surface texture). The user can stack any number of FX in any order — though we'll cap at **3 stacked at once** to keep performance and the visual sane.

### The rack UI
Right rail beneath the Subject. A vertical column of cards.

```
┌─ FX RACK ────────────────┐
│  + Add FX                │
│                          │
│  ┌───────────────────┐   │
│  │ [≡] RGB SPLIT  [×]│   │  ← drag handle, name, remove
│  │ ◉ ◉ ◉ ◉           │   │  ← four knobs
│  └───────────────────┘   │
│                          │
│  ┌───────────────────┐   │
│  │ [≡] VIGNETTE   [×]│   │
│  │ ◉ ◉ ◉ ◉           │   │
│  └───────────────────┘   │
│                          │
│  ┌───────────────────┐   │
│  │ [≡] FILM GRAIN [×]│   │
│  │ ◉ ◉ ◉ ◉           │   │
│  └───────────────────┘   │
└──────────────────────────┘
```

- **`+ Add FX` button** opens a flyout list of all 11 effects (6 Mutate + 5 Decay), categorized but in one list, each with a tiny live thumbnail.
- **Drag handle (`≡`)** on each card to reorder. Order matters — RGB Split before Vignette looks completely different from Vignette before RGB Split.
- **`×` button** removes the card.
- **Click the card title** to toggle on/off (without removing).
- Cards collapse to just title+toggle when 3 are stacked, expand on hover or click.

### Mutate effects (6)

#### Mutate 1 — Off
*Used implicitly when no FX cards are stacked. Not a card you add.*

#### Mutate 2 — CRT Rolling
A vertical sync drift. A subtle band of distortion rolls down the image continuously, like a TV with a broken horizontal hold.
- **Knob 1 — SPEED** (0–1) — how fast the band rolls.
- **Knob 2 — INTENSITY** (0–1) — how distorted the band is.
- **Knob 3 — WIDTH** (0–1) — how thick the affected band.
- **Knob 4 — TEAR** (0–1) — adds horizontal tearing across the band edges. Low = smooth roll; high = ripped video signal.

#### Mutate 3 — Flow Field
Pixels are displaced along an underlying vector field. The field can be perlin noise (organic flow) or aligned to image gradients (pixels flow along edges).
- **Knob 1 — STRENGTH** (0–1) — how far pixels move.
- **Knob 2 — SCALE** (0–1) — size of the flow patterns. Low = tight swirls; high = broad sweeping currents.
- **Knob 3 — SPEED** (0–1) — how fast the flow field evolves over time.
- **Knob 4 — MODE** (3 positions) — 0: Noise (organic), 1: Edge-aligned (flows along contours), 2: Radial (flows outward from center).

#### Mutate 4 — Feedback Warp
Recursive distortion. The previous frame is sampled and offset/warped, then composited with the current frame. Creates trails, drips, persistent ghosts.
- **Knob 1 — FEEDBACK** (0–1) — how much of the previous frame persists. High = long trails.
- **Knob 2 — WARP** (0–1) — how much the fed-back frame is distorted before re-mixing.
- **Knob 3 — DRIFT** (0–1) — slow translation of the fed-back frame. At 0 it's static; at 1 it spirals outward or drifts in a direction.
- **Knob 4 — DECAY** (0–1) — how quickly the trails fade. Low = forever; high = quick fade.

#### Mutate 5 — RGB Split
Channel offset glitch. Red, green, and blue are pulled apart spatially.
- **Knob 1 — AMOUNT** (0–1) — how far the channels separate.
- **Knob 2 — ANGLE** (0–360°) — direction of the split.
- **Knob 3 — JITTER** (0–1) — randomizes the split per frame for an unstable feel. At 0 it's static; at 1 it strobes.
- **Knob 4 — CHANNEL** (3 positions) — which channels split: 0: all three independently, 1: red vs cyan, 2: blue vs yellow.

#### Mutate 6 — Echo Trail
Motion smear. Each frame is composited with N previous frames at decreasing opacity. Things in motion leave streaks.
- **Knob 1 — LENGTH** (0–1) — how many frames back are sampled.
- **Knob 2 — OPACITY** (0–1) — how visible the trail is.
- **Knob 3 — DECAY CURVE** (0–1) — at 0 each step in the trail has equal opacity (chunky); at 1 the falloff is exponential (smooth taper).
- **Knob 4 — TINT** (0–1) — at 0 trails are the same color as the source; at 1 trails shift toward a complementary color, separating motion from stillness chromatically.

### Decay effects (5)

#### Decay 1 — Off
*Implicit. Not a card.*

#### Decay 2 — CRT
Full TV-tube treatment. Curvature, scanlines, slight bloom, vignette around the corners, color fringing at edges.
- **Knob 1 — CURVATURE** (0–1) — how much the image bows outward like a real CRT screen.
- **Knob 2 — SCANLINE INTENSITY** (0–1) — visibility of horizontal scanlines.
- **Knob 3 — BLOOM** (0–1) — how much bright areas glow into surrounding pixels.
- **Knob 4 — FRINGE** (0–1) — chromatic aberration at the edges of the screen, increasing toward corners.

#### Decay 3 — Degrade
Lossy compression artifacts. Macroblocks, color banding, JPEG-style block boundaries.
- **Knob 1 — BLOCK SIZE** (4–32 px) — size of macroblocks.
- **Knob 2 — QUALITY** (0–1) — at 0 fully degraded; at 1 nearly clean.
- **Knob 3 — BANDING** (0–1) — color quantization severity. High = visible posterization in gradients.
- **Knob 4 — RATTLE** (0–1) — temporal flicker between adjacent compression states. At 0 it's stable; at 1 the artifacts shimmer per frame.

#### Decay 4 — Vignette
Darkened edge falloff. Cinematic finish.
- **Knob 1 — STRENGTH** (0–1) — how dark the edges get.
- **Knob 2 — RADIUS** (0–1) — how far from center the vignette starts.
- **Knob 3 — SOFTNESS** (0–1) — falloff curve. Low = hard ring; high = gentle fade.
- **Knob 4 — TINT** (0–1) — at 0 the vignette darkens neutrally; at 1 it shifts toward warm or cool depending on direction (this knob is bipolar around the center: -1 cool, 0 neutral, 1 warm).

#### Decay 5 — Film Grain
Noise overlay. Texture / finish.
- **Knob 1 — INTENSITY** (0–1) — how visible the grain is.
- **Knob 2 — SIZE** (0–1) — how coarse the grain. Low = fine 35mm; high = chunky 8mm.
- **Knob 3 — SHADOWS** (0–1) — how much grain appears in dark areas vs everywhere uniformly. High = more grain in shadows (like real film stock).
- **Knob 4 — COLOR** (0–1) — at 0 the grain is monochromatic; at 1 it's RGB-shifted (color noise like high-ISO digital).

---

## BlobTracking — Tracking mode

Same Source as LumiSynth. Different processing chain. BlobTracking detects up to 25 blobs per frame and visualizes them with three independent dimensions: **Shape × Lines × Effects.**

### Where BlobTracking lives
- A toggle in the top bar: `SYNTH · TRACK`
- **SYNTH** mode: full LumiSynth chain, no blob overlay
- **TRACK** mode: BlobTracking overlay on top of the LumiSynth output (or on the raw source if all LumiSynth stages are Off)
- A second toggle inside Track mode: `OVERLAY · ISOLATED` — overlay shows blobs over LumiSynth output; isolated shows blobs only on a black background (clean export for VJs and analysts)

### The Tracking workspace
Same layout as Synth mode, but the Stage rails on left and right are replaced with BlobTracking controls:

- **Left rail — DETECTION**
  - Lumi channel picker (which signal to detect blobs from — velocity, gradient, memory, etc.)
  - Detection sensitivity knob
  - Min blob size knob
  - Max blob count (capped at 25)

- **Right rail — VISUAL** (replaces FX rack in this mode)
  - Shape picker
  - Lines picker
  - Effects rack (stack 0–3 of the trippy ones)

The Subject still lives in the corner — but in Track mode it's running through BlobTracking (and you can see your single dancer being tracked as one blob, with shape/lines/effects rendering on it).

### Detection (left rail in Track mode)

#### Lumi channel
Which luminance derivative does the blob detector analyze? This is the most important parameter — it defines what counts as a "blob" in the source.
- **Source** — raw luminance. Detects bright objects.
- **Velocity** — temporal derivative. Detects moving things. (default)
- **Gradient** — spatial derivative. Detects edges/textures.
- **Memory** — long-term accumulation. Detects things that have been bright for a while.
- 8 more options carried from current TD.

#### Four detection knobs
- **Knob 1 — SENSITIVITY** (0–1) — how dim a value still counts as a blob.
- **Knob 2 — MIN SIZE** (4–200 px) — smallest blob that gets tracked.
- **Knob 3 — STABILITY** (0–1) — how much temporal smoothing on blob detection. Low = jittery, picks up flickers; high = stable, ignores transients.
- **Knob 4 — MAX BLOBS** (1–25) — cap on simultaneous tracked blobs.

### Shape (4 styles)
Each blob's bounding box is rendered as one of these. Pick from a dropdown.

| # | Style | What it looks like |
|---|---|---|
| 1 | Solid rectangle | Filled bbox — opaque overlay |
| 2 | Hollow rectangle | Outline only |
| 3 | Dotted rectangle | Outline made of dots, not solid line |
| 4 | Corner brackets | Just the four corners — `[ ]` shape, surveillance HUD |

Four shape knobs adjust the rendering globally:
- **Knob 1 — COLOR** (0–1) — hue rotation. At 0 white, scrolls through full hue range to 1.
- **Knob 2 — THICKNESS** (1–8 px) — line/dot weight.
- **Knob 3 — PADDING** (-20 to 20 px) — at 0 the shape sits tight to the bbox; negative shrinks inside; positive gives breathing room around the blob.
- **Knob 4 — STYLE-SPECIFIC** — varies per shape. For Solid: opacity. For Hollow: outer glow. For Dotted: dot size. For Corner brackets: bracket length.

### Lines (5 graph types)
How blobs connect to each other (or to themselves). Pick from a dropdown.

| # | Type | Description |
|---|---|---|
| 1 | Off | No lines |
| 2 | Distance Threshold | Connect any two blobs within N px of each other. Cluster behavior. |
| 3 | Velocity Trails | Each blob trails a line behind its own past path. No inter-blob connections. |
| 4 | Pulse Trail | Same connections as Distance Threshold, but a bright dot travels along each connection from blob A to blob B repeatedly. Continuous data-flow feel. |
| 5 | Constellation | Connect every blob to every other, but line opacity falls off with distance. Naturally sparse-feeling, dreamy. |

Four line knobs:
- **Knob 1 — COLOR** (0–1) — hue, same scheme as shape.
- **Knob 2 — THICKNESS** (1–6 px) — line weight.
- **Knob 3 — PARAM** — type-specific:
  - Distance Threshold → max connect distance (50–500 px)
  - Velocity Trails → trail length (0–1)
  - Pulse Trail → pulse speed (0–1)
  - Constellation → falloff curve (0–1)
- **Knob 4 — TAPER** (0–1) — at 0 lines have constant width; at 1 they taper from thick at one end to thin at the other.

### Effects (3 trippy stackable cards)
On TOP of the Shape and Lines, the user can stack 0–3 of these. Compose like LumiSynth FX rack.

#### Effect 1 — Echo Blobs
The blob's bounding box from N frames ago is faintly visible behind the current one. Motion ghosting at the blob level.
- **Knob 1 — DEPTH** (1–10 frames) — how many past blob positions show.
- **Knob 2 — OPACITY** (0–1) — visibility of the echoes.
- **Knob 3 — DECAY** (0–1) — falloff curve across echoes. Low = chunky; high = smooth taper.
- **Knob 4 — OFFSET** (0–1) — at 0 echoes sit exactly where the blob was; at 1 they're scaled-down or scaled-up slightly, giving a "depth pulse" feel.

#### Effect 2 — Radar Sweep
A rotating line emits from frame center. Blobs only become visible when the sweep crosses them, then fade out.
- **Knob 1 — SPEED** (0–1) — rotation speed.
- **Knob 2 — TRAIL** (0–1) — how long blobs persist after being swept. Low = brief flash; high = lingering glow.
- **Knob 3 — SWEEP WIDTH** (0–1) — how thick the rotating arc is. Low = laser line; high = wide pie-slice.
- **Knob 4 — DIRECTION** (-1 to 1) — at -1 sweeps counterclockwise; at 0 oscillates back and forth; at 1 sweeps clockwise.

#### Effect 3 — Heatmap Residue
Wherever a blob has been recently, that location glows. Creates a motion smear of the entire scene's blob history.
- **Knob 1 — INTENSITY** (0–1) — visibility of the heatmap layer.
- **Knob 2 — DECAY** (0–1) — how quickly old positions fade. Low = forever; high = quick.
- **Knob 3 — SPREAD** (0–1) — radius of the glow around each blob position. Low = pinpoint; high = wide bloom.
- **Knob 4 — PALETTE** (3 positions) — 0: thermal (red-yellow-white), 1: cool (blue-cyan-white), 2: rainbow.

---

## Save and load

Projects save as JSON files. No accounts in v1.

- **Save** — downloads a `.lumi` file (just JSON with a custom extension). Filename defaults to project name.
- **Load** — drag/drop a `.lumi` file anywhere on the workspace, or click the Load button.
- Auto-save to local browser storage every 30 seconds. Reload-safe within the same browser.

The project file captures everything: Source reference (or embedded if small enough), every stage's pick, every knob value, every FX in the rack, BlobTracking mode and settings. Reload it later and everything is exactly as you left it.

---

## Export

Click Export. A modal opens.

```
┌────────────────────────────────────────┐
│  Export                          [×]   │
├────────────────────────────────────────┤
│                                        │
│  FORMAT                                │
│  ◉ Video (mp4)                         │
│  ○ Image (png)                         │
│  ○ GIF                                 │
│                                        │
│  RESOLUTION                            │
│  [ 1080×1920 ▾ ]                       │
│   · 1080×1920 (Reels / TikTok)         │
│   · 1920×1080 (YouTube / Landscape)    │
│   · 1080×1080 (Square)                 │
│   · Match source                       │
│                                        │
│  DURATION                              │
│  ▣ Use source length                   │
│  □ Custom: [   :    seconds]           │
│                                        │
│  WET / DRY MIX            ◉────  100%  │
│  (blend the processed output with raw) │
│                                        │
│  ┌────────────────────────────────┐    │
│  │  [free tier: watermark added]  │    │
│  └────────────────────────────────┘    │
│                                        │
│           [ Cancel ]   [ Export ]      │
└────────────────────────────────────────┘
```

### The wet/dry mix
A single global slider in the export modal that blends the processed output with the original source. At 100% it's full processed; at 0% it's the raw source; at 50% they're equally mixed. This gives users a "subtle" option without exposing layer compositing complexity in the rest of the UI.

### Watermark behavior
- **Free tier:** small watermark in the bottom-right of exports. The watermark is the project wordmark in gradient text. Clickable in the exported video (links back to the site, helps with viral spread).
- **Paid tier:** watermark removed.

---

## Pricing and gating

Two coexisting payment options:
- **One-time:** $39 unlocks watermark removal forever.
- **Monthly:** $5/month unlocks watermark removal and (when v1.5 ships) cloud render minutes for 4K/long video.
- **Annual:** $39/yr (positioned as "save vs monthly").

**What's free:**
- The entire app
- All 9 Structure effects, all 12 Color palettes (+ Ramp + Cosine), all 11 FX
- All BlobTracking shapes, lines, effects
- Save/load projects
- Export at up to 1080p
- The Subject and all interactions

**What's gated:**
- Watermark on free exports (only thing gated in v1)
- 4K export (post-launch)
- Cloud render for long videos (post-launch)

The product itself is fully usable in the free tier. The watermark IS the marketing mechanism — every free user's exported clip has a clickable watermark that links back to the site. Free users become the funnel.

---

## Recipe gallery

Eight hero outputs for the landing page. Each is achievable with v1 effects only, knob settings included for reproducibility.

1. **Hubble**
   Structure: Stippling (size 4, density 0.7, jitter 0.3)
   Color: Film → Nebula (intensity 1, shift 0.2, contrast 0.7)
   FX: Bloom-equivalent via [VAPOR-style finishing] + Vignette (strength 0.6)

2. **X-Ray Specimen**
   Structure: Edge Detect (sensitivity 0.4, thickness 2)
   Color: Film → Cyanotype (intensity 1, shift -0.2)
   FX: Film Grain (intensity 0.4, size 0.3)

3. **Heatmap**
   Structure: Erosion (radius 3, strength 0.5)
   Color: Film → Thermal (intensity 1, contrast 0.8)
   FX: CRT (curvature 0.3, scanlines 0.2)

4. **Found Tape**
   Structure: ASCII (cell 16, contrast 0.6, depth 0.3, style: Letters)
   Color: Film → Cyanotype (intensity 0.7, shift 0.4)
   FX: RGB Split (amount 0.3) → CRT Rolling (speed 0.4, intensity 0.5)

5. **Acid Trip**
   Structure: Cross-Hatch (spacing 6, angle 45°, layers 2)
   Color: Film → Acid Wash (intensity 1, contrast 0.6)
   FX: Echo Trail (length 0.5, decay curve 0.3)

6. **Iridescence**
   Structure: Edge Detect (sensitivity 0.6, smoothing 0.4)
   Color: Film → Holographic (intensity 1, variant 0.5)
   FX: Film Grain (intensity 0.2)

7. **Topographic**
   Structure: Contour Lines (density 16, thickness 2, jitter 0.2)
   Color: Film → Depth Stack (intensity 1, variant 0.4)
   FX: Vignette (strength 0.4)

8. **Datadream**
   Structure: Off
   Color: Cosine mode (hue offset 0.3, range 0.7, brightness 0.6, saturation 0.9)
   FX: Film Grain (intensity 0.3, color 0.7) → CRT Rolling (intensity 0.3)

---

## Out of scope for v1

This list exists to prevent scope creep. Every "wouldn't it be cool if" goes here.

- ❌ User accounts / login
- ❌ Cloud project sync
- ❌ Mobile / tablet layout
- ❌ Multiplayer / real-time collaboration
- ❌ MIDI input
- ❌ Audio reactivity / FFT
- ❌ Custom shader upload
- ❌ Plugin / extension system
- ❌ Light mode
- ❌ Multilingual
- ❌ AI integrations of any kind
- ❌ Webcam recording (live preview only)
- ❌ Animated parameter automation / keyframes
- ❌ Multi-track timeline / video editor features
- ❌ Mask painting / region exclusion
- ❌ Custom resolution beyond presets
- ❌ External display / Chromecast
- ❌ Tutorial / interactive onboarding (a 90-second YouTube video link suffices)
- ❌ Custom mascot upload (one of three preset Subjects only)

If something on this list comes up — answer is "v2."

---

## What "v1 done" looks like

Reasonable measures of "we shipped":

- Open the app fresh. The Subject is dancing in the top-right. Cyanotype is loaded. The preview is dark and waiting.
- Drag a video onto the workspace. It loads. The chain processes it instantly.
- Pick a Structure. The picture changes. Pick a Color mode and palette. The picture changes again. Add an FX card. The picture changes again.
- Switch to Track mode. Blobs appear over the processed output. Pick a Shape, a Line type, stack an Effect.
- Export. The mp4 downloads. It has a watermark.
- Pay $39 in checkout. Reload the project. Re-export. No watermark.

If all of that works smoothly with no visible bugs and no UI confusion, v1 is shipped.

---

## Naming brief (lock by week 3)

The product cannot ship without a name. Criteria:

- 2 syllables ideal, 3 max. No long names.
- Not a real English word. Inventable, ownable, googleable.
- The .com or .app should be available (or a clean variant).
- Sounds like an instrument — Korg, Moog, Arturia, Teenage Engineering. Not "VideoTransformAI."
- No "AI," "Studio," "FX," "Lab," "Tool" anywhere in the name.
- Pronounceable on first read.
- Works as a verb if possible. *"I [name]ed this clip"* should sound natural.
- Visually clean as a wordmark — mostly lowercase letters, few descenders.

Direction options: synth-flavored (Lumi-, -wave, -tron, -osc), light/optical-flavored (-lux, -ray, -prism, -opt), pure invention (Oklch, Ableton, Linear).

Anti-patterns: anything starting with "Visual," anything ending in "Lab" or "FX," anything that sounds like a SaaS company, anything that's a real English word.

---

## Final note on feel

The product should feel like **opening a box of hardware**, not opening a webpage. Everything should be immediate, tactile, slightly weird. The Subject should feel like a small alive thing in the corner of your workspace. The knobs should feel weighted. The Color stage should feel like three different instruments stacked into one panel. The Source bar should feel like the bottom of a tape deck.

If a user opens the app and isn't sure if it's a website or a piece of software, we did it right.


--

Code

Structural

Watershed

// WATERSHED - luminance basins with sharp boundaries
// Each basin settles to a local average, boundaries between basins are bright
// uParams.x = Basin Size (0=tiny pools, 1=large catchments)
// uParams.y = Boundary Brightness (0=subtle, 1=bright dividing lines)
// uParams.z = Basin Flatness (0=basins keep internal detail, 1=flat averaged basins)
// uParams.w = Depth Tint (0=uniform basins, 1=basins tinted by their depth)
uniform vec4 uParams;
out vec4 fragColor;

void main() {
    vec2 uv = vUV.st;
    vec2 res = vec2(textureSize(sTD2DInputs[0], 0));
    vec2 texel = 1.0 / res;
    float val = texture(sTD2DInputs[0], uv).r;
    
    // Approximate watershed via iterative downhill flow
    // Walk toward the local minimum
    float scale = mix(2.0, 12.0, uParams.x);
    vec2 st = texel * scale;
    
    vec2 pos = uv;
    float minVal = val;
    
    // 4 iterations of gradient descent toward local minimum
    for (int i = 0; i < 4; i++) {
        float cN = texture(sTD2DInputs[0], pos + vec2(0, st.y)).r;
        float cS = texture(sTD2DInputs[0], pos - vec2(0, st.y)).r;
        float cE = texture(sTD2DInputs[0], pos + vec2(st.x, 0)).r;
        float cW = texture(sTD2DInputs[0], pos - vec2(st.x, 0)).r;
        
        float minN = min(min(cN, cS), min(cE, cW));
        if (minN < minVal) {
            if (cN == minN) pos += vec2(0, st.y);
            else if (cS == minN) pos -= vec2(0, st.y);
            else if (cE == minN) pos += vec2(st.x, 0);
            else pos -= vec2(st.x, 0);
            minVal = minN;
        }
    }
    
    // Basin value: sample at the converged position
    float basinVal = texture(sTD2DInputs[0], clamp(pos, 0.0, 1.0)).r;
    
    // Boundary detection: where neighbors converge to different basins
    vec2 posR = uv + vec2(texel.x * 2.0, 0);
    vec2 posU = uv + vec2(0, texel.y * 2.0);
    float valR = texture(sTD2DInputs[0], posR).r;
    float valU = texture(sTD2DInputs[0], posU).r;
    float boundary = abs(basinVal - texture(sTD2DInputs[0], clamp(pos + vec2(st.x, 0), 0.0, 1.0)).r);
    boundary += abs(basinVal - texture(sTD2DInputs[0], clamp(pos + vec2(0, st.y), 0.0, 1.0)).r);
    boundary = clamp(boundary * mix(5.0, 30.0, uParams.y), 0.0, 1.0);
    
    // Mix basin flatness
    float interior = mix(val, basinVal, uParams.z);
    
    // Depth tint: modulate by basin depth
    interior *= mix(1.0, 0.5 + basinVal * 0.5, uParams.w);
    
    float result = interior + boundary * 0.6;
    
    fragColor = TDOutputSwizzle(vec4(clamp(result, 0.0, 1.0), clamp(result, 0.0, 1.0), clamp(result, 0.0, 1.0), 1.0));
}


Pixel Sort

// PIXELSTREAK - bright values cast trails that extend behind the image
// Streaks grow from bright source pixels in a chosen direction
// The original image sits on top, untouched — streaks are underneath
//
// uParams.x = Threshold (0=everything casts streaks, 1=only peaks)
// uParams.y = Streak Length (0-1 maps to 0-200px)
// uParams.z = Streak Opacity (0=faint ghost, 1=solid trail)
// uParams.w = Direction (0=up, 0.25=right, 0.5=down, 0.75=left, continuous)
uniform vec4 uParams;
out vec4 fragColor;

void main() {
    vec2 uv = vUV.st;
    vec2 res = vec2(textureSize(sTD2DInputs[0], 0));
    vec2 texel = 1.0 / res;
    
    float srcVal = texture(sTD2DInputs[0], uv).r;
    float threshold = mix(0.02, 0.8, uParams.x);
    int maxLen = int(uParams.y * 2000.0);
    float opacity = uParams.z;
    
    // Streak direction
    float angle = uParams.w * 6.2832;
    vec2 streakDir = vec2(sin(angle), cos(angle));
    
    // Look OPPOSITE to streak direction to find source
    vec2 lookStep = -streakDir * texel;
    
    float bestVal = 0.0;
    float bestDist = -1.0;
    
    // Scan backward to find bright pixels that streak through here
    for (int i = 1; i <= 200; i++) {
        if (i > maxLen) break;
        vec2 sUV = uv + lookStep * float(i);
        if (sUV.x < 0.0 || sUV.y < 0.0 || sUV.x > 1.0 || sUV.y > 1.0) break;
        
        float sv = texture(sTD2DInputs[0], sUV).r;
        if (sv >= threshold && sv > bestVal) {
            bestVal = sv;
            bestDist = float(i);
        }
    }
    
    // No bright source found — just output original
    if (bestDist < 0.0) {
        fragColor = TDOutputSwizzle(vec4(srcVal, srcVal, srcVal, 1.0));
        return;
    }
    
    // Streak fades linearly over its length
    float fade = 1.0 - (bestDist / float(max(maxLen, 1)));
    fade = clamp(fade, 0.0, 1.0);
    
    // The streak value: source brightness carried forward, fading
    float streakVal = bestVal * fade;
    
    // BEHIND THE IMAGE: streak is layered UNDER the original
    // Original pixel always wins. Streak only shows where original is darker.
    float behindVal = streakVal * opacity;
    float out_v = max(srcVal, behindVal);
    
    fragColor = TDOutputSwizzle(vec4(out_v, out_v, out_v, 1.0));
}

Melt (v similar to pixel sort)

// MELT - luminance drips downward like heated wax
// Bright areas are heavy, dark areas are light
// uParams.x = Melt Amount (0=solid, 1=fully liquid)
// uParams.y = Drip Length (0=short, 1=long drips)
// uParams.z = Viscosity (0=water/fast, 1=honey/slow thick drips)
// uParams.w = Direction (0=down, 0.5=sideways, 1=up)
uniform vec4 uParams;
out vec4 fragColor;

void main() {
    vec2 uv = vUV.st;
    vec2 res = vec2(textureSize(sTD2DInputs[0], 0));
    vec2 texel = 1.0 / res;
    float val = texture(sTD2DInputs[0], uv).r;
    
    // Drip direction
    float angle = uParams.w * 3.14159;
    vec2 dripDir = vec2(sin(angle), -cos(angle)); // default = down
    
    int maxDrip = int(mix(5.0, 80.0, uParams.y));
    float meltAmt = uParams.x;
    
    // Walk upward (opposite to drip) looking for bright pixels above
    // that would drip down into this position
    float bestVal = val;
    float bestDist = 0.0;
    
    for (int i = 1; i <= 80; i++) {
        if (i > maxDrip) break;
        vec2 sUV = uv - dripDir * texel * float(i);
        if (sUV.x < 0.0 || sUV.y < 0.0 || sUV.x > 1.0 || sUV.y > 1.0) break;
        
        float sv = texture(sTD2DInputs[0], sUV).r;
        
        // Bright pixels drip further (they're heavier)
        float dripReach = sv * float(maxDrip) * meltAmt;
        
        if (float(i) < dripReach && sv > bestVal) {
            // This bright pixel above can reach us
            // Viscosity: thicker = less fade over distance
            float fade = 1.0 - (float(i) / dripReach);
            fade = pow(fade, mix(0.3, 2.0, uParams.z));
            
            float drippedVal = sv * fade;
            if (drippedVal > bestVal) {
                bestVal = drippedVal;
                bestDist = float(i);
            }
        }
    }
    
    fragColor = TDOutputSwizzle(vec4(bestVal, bestVal, bestVal, 1.0));
}

Color

Depth Stack

// DEPTHSTACK - holographic spectral depth planes
// uParams.x=LayerCount, y=Parallax, z=GlowWidth, w=ColorRange
uniform vec4 uParams;
out vec4 fragColor;

vec3 depthColor(float depth, float range) {
    float t = 1.0 - depth;
    vec3 deep=vec3(0.02,0.02,0.12); vec3 violet=vec3(0.25,0.05,0.55);
    vec3 blue=vec3(0.1,0.3,0.95); vec3 cyan=vec3(0,0.75,0.9); vec3 wh=vec3(0.8,0.9,1);
    vec3 narrow, wide;
    if (t<0.25){narrow=mix(deep,blue*0.6,t*4.0);wide=mix(deep,violet,t*4.0);}
    else if (t<0.5){narrow=mix(blue*0.6,blue,(t-0.25)*4.0);wide=mix(violet,blue,(t-0.25)*4.0);}
    else if (t<0.75){narrow=mix(blue,blue*1.1,(t-0.5)*4.0);wide=mix(blue,cyan,(t-0.5)*4.0);}
    else{narrow=mix(blue*1.1,cyan*0.8,(t-0.75)*4.0);wide=mix(cyan,wh,(t-0.75)*4.0);}
    return mix(narrow, wide, range);
}

void main() {
    vec2 uv = vUV.st;
    vec2 res = vec2(textureSize(sTD2DInputs[0], 0));
    vec2 texel = 1.0 / res;
    int numLayers = int(mix(3.0, 8.0, uParams.x));
    float maxOff = uParams.y * 0.02;
    float glowSz = mix(0.005, 0.06, uParams.z);
    float vL=texture(sTD2DInputs[0],uv-vec2(texel.x*4.0,0)).r;
    float vR=texture(sTD2DInputs[0],uv+vec2(texel.x*4.0,0)).r;
    float vD=texture(sTD2DInputs[0],uv-vec2(0,texel.y*4.0)).r;
    float vU=texture(sTD2DInputs[0],uv+vec2(0,texel.y*4.0)).r;
    vec2 gradDir = normalize(vec2(vR-vL, vU-vD) + 0.0001);
    vec3 res_c = vec3(0);
    for (int i = 0; i < 8; i++) {
        if (i >= numLayers) break;
        float layerD = float(i) / float(numLayers - 1);
        vec2 offset = gradDir * (layerD - 0.5) * 2.0 * maxOff;
        float sVal = texture(sTD2DInputs[0], clamp(uv + offset, 0.0, 1.0)).r;
        float bandCenter = 1.0 - layerD;
        float bandW = 1.0 / float(numLayers);
        float inBand = 1.0 - smoothstep(bandW*0.3, bandW*0.3 + glowSz, abs(sVal - bandCenter));
        res_c += depthColor(layerD, uParams.w) * inBand * (0.6 + sVal * 0.8);
    }
    fragColor = TDOutputSwizzle(vec4(clamp(res_c, 0.0, 1.0), 1.0));
}


Prismatic

// PRISMATIC - warm spectral dispersion with chromatic aberration
// That yellowish-pink prismatic look + chromatic offset
// uParams.x = Dispersion (0=tight, 1=wide spread)
// uParams.y = Warmth (0=neutral split, 1=full warm yellow-pink spectrum)
// uParams.z = Glow (0=sharp, 1=soft bloom)
// uParams.w = Angle (0-1 = dispersion direction)
uniform vec4 uParams;
out vec4 fragColor;

vec3 spectralColor(float t) {
    // Warm prismatic spectrum: violet -> pink -> yellow -> orange -> red
    vec3 c;
    if (t < 0.25)      c = mix(vec3(0.5, 0.2, 0.8), vec3(1.0, 0.4, 0.7), t * 4.0);
    else if (t < 0.5)  c = mix(vec3(1.0, 0.4, 0.7), vec3(1.0, 0.85, 0.3), (t - 0.25) * 4.0);
    else if (t < 0.75) c = mix(vec3(1.0, 0.85, 0.3), vec3(1.0, 0.6, 0.15), (t - 0.5) * 4.0);
    else                c = mix(vec3(1.0, 0.6, 0.15), vec3(0.9, 0.2, 0.1), (t - 0.75) * 4.0);
    return c;
}

void main() {
    vec2 uv = vUV.st;
    float val = texture(sTD2DInputs[0], uv).r;
    
    float angle = uParams.w * 6.2832;
    vec2 dispDir = vec2(cos(angle), sin(angle));
    float spread = uParams.x * 0.04;
    
    // 5 spectral samples along dispersion axis
    vec3 col = vec3(0.0);
    for (int i = 0; i < 5; i++) {
        float t = float(i) / 4.0;
        float offset = (t - 0.5) * 2.0;
        vec2 sUV = clamp(uv + dispDir * offset * spread * val, 0.0, 1.0);
        float sv = texture(sTD2DInputs[0], sUV).r;
        
        // Blend between neutral white and warm spectral color
        vec3 tint = mix(vec3(1.0), spectralColor(t), uParams.y);
        col += sv * tint;
    }
    col /= 3.0;
    
    // Glow boost on dispersed areas
    float edge = abs(
        texture(sTD2DInputs[0], clamp(uv - dispDir * spread * val, 0.0, 1.0)).r -
        texture(sTD2DInputs[0], clamp(uv + dispDir * spread * val, 0.0, 1.0)).r
    );
    col += col * edge * uParams.z * 2.0;
    
    fragColor = TDOutputSwizzle(vec4(clamp(col, 0.0, 1.0), 1.0));
}


Acid Wash

// ACIDWASH - psychedelic color banding and hue warping
// uParams.x = Warp Intensity (0=subtle, 1=extreme color folding)
// uParams.y = Band Count (0=smooth, 1=many sharp bands)
// uParams.z = Saturation (0=pastel, 1=electric vivid)
// uParams.w = Phase (0-1 shifts the entire color map, animate for motion)
uniform vec4 uParams;
out vec4 fragColor;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = vUV.st;
    float val = texture(sTD2DInputs[0], uv).r;
    
    // Non-linear hue mapping: sine folding creates repeating color bands
    float warp = uParams.x * 4.0;
    float bands = mix(1.0, 8.0, uParams.y);
    
    float hueBase = val * bands + uParams.w;
    float hue = fract(hueBase + sin(val * warp * 6.2832) * 0.3);
    
    // Second sine for saturation variation
    float sat = mix(0.4, 1.0, uParams.z) * (0.7 + 0.3 * sin(val * bands * 3.14159));
    
    // Brightness: follows value but with boosted midtones
    float bri = val * 0.5 + 0.5 * sin(val * 3.14159); // peak at midtones
    bri = max(bri, val * 0.3); // don't lose darks completely
    
    vec3 col = hsv2rgb(vec3(hue, sat, bri));
    
    fragColor = TDOutputSwizzle(vec4(col, 1.0));
}

X-Ray

// XRAY - medical radiograph / bone scan aesthetic
// uParams.x = Exposure (0=dark/underexposed, 1=bright/overexposed)
// uParams.y = Edge Enhancement (0=smooth, 1=sharp bone-like edges)
// uParams.z = Film Tint (0=pure greyscale, 0.5=blue medical, 1=amber vintage)
// uParams.w = Invert (0=standard xray dark-on-light, 1=negative/light-on-dark)
uniform vec4 uParams;
out vec4 fragColor;

void main() {
    vec2 uv = vUV.st;
    vec2 res = vec2(textureSize(sTD2DInputs[0], 0));
    vec2 texel = 1.0 / res;
    
    float val = texture(sTD2DInputs[0], uv).r;
    
    // Edge enhancement via local contrast
    float vL = texture(sTD2DInputs[0], uv - vec2(texel.x, 0)).r;
    float vR = texture(sTD2DInputs[0], uv + vec2(texel.x, 0)).r;
    float vD = texture(sTD2DInputs[0], uv - vec2(0, texel.y)).r;
    float vU = texture(sTD2DInputs[0], uv + vec2(0, texel.y)).r;
    float edgeMag = length(vec2(vR - vL, vU - vD));
    float edgeBoost = edgeMag * uParams.y * 8.0;
    
    // Invert for classic xray look
    float xray = mix(1.0 - val, val, uParams.w);
    
    // Exposure control
    xray = pow(clamp(xray, 0.0, 1.0), mix(1.5, 0.5, uParams.x));
    
    // Add edge detail
    xray = clamp(xray + edgeBoost, 0.0, 1.0);
    
    // Film tint
    vec3 col;
    float tint = uParams.z;
    if (tint < 0.5) {
        // Grey to blue medical
        vec3 grey = vec3(xray);
        vec3 blue = vec3(xray * 0.7, xray * 0.8, xray * 1.1);
        col = mix(grey, blue, tint * 2.0);
    } else {
        // Blue to amber vintage
        vec3 blue = vec3(xray * 0.7, xray * 0.8, xray * 1.1);
        vec3 amber = vec3(xray * 1.1, xray * 0.95, xray * 0.7);
        col = mix(blue, amber, (tint - 0.5) * 2.0);
    }
    
    fragColor = TDOutputSwizzle(vec4(clamp(col, 0.0, 1.0), 1.0));
}

Heat Bleed

// HEATBLEED - thermal color that bleeds spatially based on intensity
// uParams.x = Bleed Amount (0=normal thermal, 1=heavy color bleed)
// uParams.y = Bleed Radius (0=tight, 1=wide spread)
// uParams.z = Temperature Range (0=compressed, 1=full range)
// uParams.w = Glow (0=flat, 1=hot areas bloom outward)
uniform vec4 uParams;
out vec4 fragColor;

vec3 thermalRamp(float t) {
    if (t < 0.15) return mix(vec3(0.0, 0.0, 0.08), vec3(0.0, 0.0, 0.5), t / 0.15);
    if (t < 0.35) return mix(vec3(0.0, 0.0, 0.5), vec3(0.0, 0.5, 0.7), (t - 0.15) / 0.2);
    if (t < 0.55) return mix(vec3(0.0, 0.5, 0.7), vec3(0.8, 0.8, 0.0), (t - 0.35) / 0.2);
    if (t < 0.75) return mix(vec3(0.8, 0.8, 0.0), vec3(1.0, 0.2, 0.0), (t - 0.55) / 0.2);
    return mix(vec3(1.0, 0.2, 0.0), vec3(1.0, 1.0, 0.9), (t - 0.75) / 0.25);
}

void main() {
    vec2 uv = vUV.st;
    vec2 res = vec2(textureSize(sTD2DInputs[0], 0));
    vec2 texel = 1.0 / res;
    float val = texture(sTD2DInputs[0], uv).r;
    
    // Efficient bleed: dual-axis sample (13 horiz + 12 vert = 25 total)
    float radius = mix(2.0, 12.0, uParams.y);
    float maxNearby = val;
    float totalNearby = val;
    float count = 1.0;
    float weights[7] = float[7](1.0, 0.9, 0.75, 0.55, 0.35, 0.2, 0.1);
    
    for (int i = 1; i <= 6; i++) {
        float r = float(i) * radius / 6.0;
        float w = weights[i];
        
        float sH1 = texture(sTD2DInputs[0], clamp(uv + vec2(r * texel.x, 0), 0.0, 1.0)).r;
        float sH2 = texture(sTD2DInputs[0], clamp(uv - vec2(r * texel.x, 0), 0.0, 1.0)).r;
        float sV1 = texture(sTD2DInputs[0], clamp(uv + vec2(0, r * texel.y), 0.0, 1.0)).r;
        float sV2 = texture(sTD2DInputs[0], clamp(uv - vec2(0, r * texel.y), 0.0, 1.0)).r;
        
        maxNearby = max(maxNearby, max(max(sH1, sH2), max(sV1, sV2)));
        totalNearby += (sH1 + sH2 + sV1 + sV2) * w;
        count += 4.0 * w;
    }
    float avgNearby = totalNearby / count;
    
    float bleedVal = mix(val, mix(avgNearby, maxNearby, 0.5), uParams.x);
    bleedVal = mix(bleedVal * 0.5 + 0.25, bleedVal, uParams.z);
    bleedVal = clamp(bleedVal, 0.0, 1.0);
    
    vec3 col = thermalRamp(bleedVal);
    
    float heatExcess = max(0.0, bleedVal - val);
    col += vec3(1.0, 0.6, 0.2) * heatExcess * uParams.w * 3.0;
    
    fragColor = TDOutputSwizzle(vec4(clamp(col, 0.0, 1.0), 1.0));
}

Nebula

// NEBULA - cosmic gas cloud palette
// uParams.x = Nebula Type (0=emission/red-pink, 0.5=reflection/blue, 1=planetary/mixed)
// uParams.y = Star Density (0=no stars, 1=sparkles at peaks)
// uParams.z = Gas Density (0=transparent wisps, 1=dense opaque clouds)
// uParams.w = Color Saturation (0=grey dust, 1=vivid gas)
uniform vec4 uParams;
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = vUV.st;
    vec2 res = vec2(textureSize(sTD2DInputs[0], 0));
    float val = texture(sTD2DInputs[0], uv).r;
    
    // Gas density curve
    float density = pow(val, mix(2.0, 0.5, uParams.z));
    
    // Nebula type palettes
    float t = uParams.x;
    vec3 darkGas, midGas, brightGas;
    if (t < 0.33) {
        // Emission nebula: deep crimson to pink to white
        darkGas = vec3(0.15, 0.02, 0.05);
        midGas = vec3(0.6, 0.1, 0.2);
        brightGas = vec3(1.0, 0.6, 0.7);
    } else if (t < 0.66) {
        // Reflection nebula: deep blue to cyan to white
        darkGas = vec3(0.02, 0.05, 0.18);
        midGas = vec3(0.1, 0.2, 0.6);
        brightGas = vec3(0.5, 0.7, 1.0);
    } else {
        // Planetary nebula: teal core, magenta shell
        darkGas = vec3(0.08, 0.02, 0.12);
        midGas = vec3(0.1, 0.4, 0.45);
        brightGas = vec3(0.7, 0.3, 0.8);
    }
    
    vec3 col;
    if (density < 0.3) col = mix(vec3(0.005, 0.005, 0.015), darkGas, density / 0.3);
    else if (density < 0.6) col = mix(darkGas, midGas, (density - 0.3) / 0.3);
    else col = mix(midGas, brightGas, (density - 0.6) / 0.4);
    
    // Desaturation control
    float grey = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(grey), col, uParams.w);
    
    // Stars: bright sparkles at peak luminance
    if (uParams.y > 0.01) {
        float starHash = hash(floor(uv * res / 2.0));
        float starThresh = mix(0.999, 0.98, uParams.y);
        if (starHash > starThresh && val > 0.7) {
            float starBright = (starHash - starThresh) / (1.0 - starThresh);
            col += vec3(starBright * 2.0);
        }
    }
    
    fragColor = TDOutputSwizzle(vec4(clamp(col, 0.0, 1.0), 1.0));
}

Solarize

// Solarization / Sabattier Effect â€” tone folding at threshold
// uParams.x = Threshold (0-1, fold point)
// uParams.y = Intensity (0=subtle, 1=full solarize)
// uParams.z = Fold Cycles (1=single fold, higher=multiple folds)
// uParams.w = Per-Channel Color Shift (0=uniform, 1=RGB offset)

uniform vec4 uParams;
out vec4 fragColor;

float solarize(float val, float thresh, float cycles) {
    float t = val * cycles;
    float folded = abs(mod(t, 2.0) - 1.0);
    return val > thresh ? folded : val;
}

void main()
{
    vec2 uv = vUV.st;
    vec4 src = texture(sTD2DInputs[0], uv);

    float threshold = clamp(uParams.x, 0.0, 1.0);
    float intensity = clamp(uParams.y, 0.0, 1.0);
    float cycles = max(1.0, uParams.z);
    float colorShift = clamp(uParams.w, 0.0, 1.0);

    // Per-channel threshold offset for chromatic solarization
    float rThresh = threshold + colorShift * 0.08;
    float gThresh = threshold;
    float bThresh = threshold - colorShift * 0.08;

    vec3 solar = vec3(
        solarize(src.r, rThresh, cycles),
        solarize(src.g, gThresh, cycles),
        solarize(src.b, bThresh, cycles)
    );

    vec3 result = mix(src.rgb, solar, intensity);

    fragColor = TDOutputSwizzle(vec4(clamp(result, 0.0, 1.0), 1.0));
}


Aurora Storm

// AURORA STORM - violent solar storm aurora with vertical curtain streaks
// Extreme color bands that intensify with luminance, vertical smear, stars in void
// uParams.x = Storm Intensity (0=gentle, 1=violent bands)
// uParams.y = Curtain Streak (0=no vertical smear, 1=heavy streaking)
// uParams.z = Color Shift (0=green dominant, 0.5=magenta, 1=mixed violent)
// uParams.w = Star Density (0=no stars in dark areas, 1=dense starfield)
uniform vec4 uParams;
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = vUV.st;
    vec2 res = vec2(textureSize(sTD2DInputs[0], 0));
    vec2 texel = 1.0 / res;
    float val = texture(sTD2DInputs[0], uv).r;
    
    // Vertical streak: sample above and below, blend
    float streakVal = val;
    if (uParams.y > 0.01) {
        float acc = val;
        float tw = 1.0;
        int streakLen = int(mix(2.0, 20.0, uParams.y));
        for (int i = 1; i <= 20; i++) {
            if (i > streakLen) break;
            float w = 1.0 / float(i + 1);
            acc += texture(sTD2DInputs[0], uv + vec2(0, texel.y * float(i) * 2.0)).r * w;
            acc += texture(sTD2DInputs[0], uv - vec2(0, texel.y * float(i) * 2.0)).r * w;
            tw += w * 2.0;
        }
        streakVal = acc / tw;
    }
    
    // Aurora color bands with storm intensity
    float band = streakVal * mix(3.0, 12.0, uParams.x);
    float bandFrac = fract(band);
    
    // Color palette: shifts with storm parameter
    vec3 col;
    float cs = uParams.z;
    
    // Green aurora
    vec3 green1 = vec3(0.0, 0.6, 0.2);
    vec3 green2 = vec3(0.2, 1.0, 0.4);
    // Magenta aurora
    vec3 mag1 = vec3(0.5, 0.0, 0.4);
    vec3 mag2 = vec3(1.0, 0.3, 0.7);
    // Violet
    vec3 vio1 = vec3(0.2, 0.0, 0.5);
    vec3 vio2 = vec3(0.5, 0.3, 1.0);
    
    if (cs < 0.33) {
        col = mix(green1, green2, bandFrac) * streakVal;
        col += vio1 * smoothstep(0.7, 1.0, streakVal) * 0.5;
    } else if (cs < 0.66) {
        col = mix(mag1, mag2, bandFrac) * streakVal;
        col += green1 * smoothstep(0.5, 0.8, streakVal) * 0.4;
    } else {
        // Mixed violent storm
        float selector = fract(band * 0.5);
        vec3 c1 = mix(green1, mag2, selector);
        vec3 c2 = mix(vio2, green2, selector);
        col = mix(c1, c2, bandFrac) * streakVal;
    }
    
    // Darks: ground/sky void
    col *= smoothstep(0.02, 0.15, streakVal);
    
    // Peak whiteout
    col = mix(col, vec3(0.8, 1.0, 0.7), smoothstep(0.85, 1.0, streakVal) * 0.6);
    
    // Stars in dark areas
    if (uParams.w > 0.01 && val < 0.2) {
        vec2 starGrid = floor(uv * res / 2.0);
        float sh = hash(starGrid);
        if (sh > 1.0 - uParams.w * 0.04) {
            float starBright = (sh - (1.0 - uParams.w * 0.04)) * 25.0;
            float starDist = length(fract(uv * res / 2.0) - 0.5);
            if (starDist < 0.25) {
                vec3 starCol = mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.9, 0.7), hash(starGrid * 3.1));
                col += starCol * starBright * (1.0 - starDist / 0.25) * (1.0 - val * 5.0);
            }
        }
    }
    
    fragColor = TDOutputSwizzle(vec4(clamp(col, 0.0, 1.0), 1.0));
}


Cyanotype

// CYANOTYPE - blueprint paper aesthetic, luminance-respecting
// Dark source: near-black with deep blue tint. Highlight: paper-white with grain.
// uParams.x = Blue Depth (0=lighter cyan, 1=deep Prussian navy)
// uParams.y = Contrast (0=soft wash, 1=hard print)
// uParams.z = Paper Grain (0=clean, 1=visible fiber texture in highlights)
// uParams.w = Edge Enhance (0=smooth, 1=sharp technical outlines)
uniform vec4 uParams;
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = vUV.st;
    vec2 res = vec2(textureSize(sTD2DInputs[0], 0));
    vec2 texel = 1.0 / res;
    float val = texture(sTD2DInputs[0], uv).r;
    
    float c = mix(1.0, 2.5, uParams.y);
    float adj = clamp(0.5 + (val - 0.5) * c, 0.0, 1.0);
    
    vec3 deepBlue = mix(vec3(0.10, 0.20, 0.45), vec3(0.02, 0.08, 0.25), uParams.x);
    vec3 midBlue = vec3(0.45, 0.65, 0.85);
    vec3 paper = vec3(0.92, 0.93, 0.88);
    
    vec3 col;
    if (adj < 0.5) {
        col = mix(deepBlue, midBlue, adj * 2.0);
    } else {
        col = mix(midBlue, paper, (adj - 0.5) * 2.0);
    }
    
    // Gate by source val: pure black source stays near-black with faint blue tint
    col *= smoothstep(0.0, 0.1, val);
    
    // Paper grain only in highlight regions (where val is high and we have actual paper)
    if (uParams.z > 0.01) {
        float fiber = hash(uv * res * 0.7) * 0.5 + hash(uv * res * 2.1) * 0.3;
        float grainMask = smoothstep(0.4, 0.85, val);
        col -= fiber * uParams.z * 0.15 * grainMask;
    }
    
    if (uParams.w > 0.01) {
        float l = texture(sTD2DInputs[0], uv - vec2(texel.x, 0)).r;
        float r = texture(sTD2DInputs[0], uv + vec2(texel.x, 0)).r;
        float d = texture(sTD2DInputs[0], uv - vec2(0, texel.y)).r;
        float u = texture(sTD2DInputs[0], uv + vec2(0, texel.y)).r;
        float edge = length(vec2(r - l, u - d));
        col -= edge * uParams.w * vec3(0.3, 0.2, 0.1) * smoothstep(0.05, 0.2, val);
    }
    
    fragColor = TDOutputSwizzle(vec4(clamp(col, 0.0, 1.0), 1.0));
}

Infrared

// INFRARED FILM - Aerochrome-style false color, luminance-gated
// True black source = true black output, grain only on actual film exposure.
// uParams.x = IR Intensity (0=subtle red shift, 1=heavy Aerochrome)
// uParams.y = Blue Shift (0=neutral shadows, 1=deep blue-black tint)
// uParams.z = Contrast (0=soft film, 1=hard print)
// uParams.w = Grain (0=clean, 1=heavy film grain on midtones+highlights)
uniform vec4 uParams;
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = vUV.st;
    vec2 res = vec2(textureSize(sTD2DInputs[0], 0));
    float val = texture(sTD2DInputs[0], uv).r;
    
    float c = mix(1.0, 2.2, uParams.z);
    float adj = clamp(0.5 + (val - 0.5) * c, 0.0, 1.0);
    
    vec3 col;
    if (adj < 0.25) {
        float t = adj / 0.25;
        vec3 shadow = mix(vec3(0.04, 0.02, 0.18), vec3(0.15, 0.05, 0.35), t);
        shadow = mix(vec3(0.08, 0.08, 0.10), shadow, uParams.y);
        col = shadow;
    } else if (adj < 0.55) {
        float t = (adj - 0.25) / 0.30;
        col = mix(vec3(0.15, 0.05, 0.35), vec3(0.75, 0.15, 0.30), t);
    } else if (adj < 0.80) {
        float t = (adj - 0.55) / 0.25;
        vec3 irRed = mix(vec3(0.75, 0.15, 0.30), vec3(0.95, 0.50, 0.20), t);
        col = mix(mix(vec3(0.75, 0.15, 0.30), vec3(0.85, 0.40, 0.25), t), irRed, uParams.x);
    } else {
        float t = (adj - 0.80) / 0.20;
        col = mix(vec3(0.95, 0.50, 0.20), vec3(0.98, 0.88, 0.80), t);
    }
    
    // Gate by source val so pure-black source stays near black instead of painted shadow color
    col *= smoothstep(0.0, 0.06, val);
    
    // Grain only on midtones+highlights (where film would actually expose)
    if (uParams.w > 0.01) {
        float grainMask = smoothstep(0.1, 0.4, val);
        float grain = (hash(uv * res * 1.3) - 0.5) * uParams.w * 0.25 * grainMask;
        col += grain;
    }
    
    fragColor = TDOutputSwizzle(vec4(clamp(col, 0.0, 1.0), 1.0));
}

Neon Tube

// NEON TUBE - emissive line-art with soft halo on black void
// Edges glow as bright neon cores with wide atmospheric halo
// uParams.x = Tube Hue (0-1, neon color - try 0.85 hot pink, 0.55 cyan, 0.15 amber)
// uParams.y = Edge Threshold (only edges stronger than this light up)
// uParams.z = Halo Radius (0=crisp, 1=soft wide atmospheric glow)
// uParams.w = Core Brightness (0=faint tubes, 1=blinding hot cores)
uniform vec4 uParams;
out vec4 fragColor;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = vUV.st;
    vec2 res = vec2(textureSize(sTD2DInputs[0], 0));
    vec2 texel = 1.0 / res;
    
    // Edge detection at multiple scales for the halo
    float edgeCore = 0.0;
    float edgeHalo = 0.0;
    
    // Tight edge for tube core
    float l = texture(sTD2DInputs[0], uv - vec2(texel.x, 0)).r;
    float r = texture(sTD2DInputs[0], uv + vec2(texel.x, 0)).r;
    float d = texture(sTD2DInputs[0], uv - vec2(0, texel.y)).r;
    float u = texture(sTD2DInputs[0], uv + vec2(0, texel.y)).r;
    edgeCore = length(vec2(r - l, u - d));
    
    // Wide-radius blur-sample for halo
    float haloR = mix(3.0, 20.0, uParams.z);
    float haloAccum = 0.0;
    float haloW = 0.0;
    for (int i = 0; i < 8; i++) {
        float angle = float(i) / 8.0 * 6.2832;
        vec2 dir = vec2(cos(angle), sin(angle));
        for (int j = 1; j <= 4; j++) {
            float dist = float(j) * haloR / 4.0;
            float w = 1.0 / (1.0 + dist * 0.1);
            vec2 sp = uv + dir * texel * dist;
            float sl = texture(sTD2DInputs[0], sp - vec2(texel.x, 0)).r;
            float sr = texture(sTD2DInputs[0], sp + vec2(texel.x, 0)).r;
            float sd = texture(sTD2DInputs[0], sp - vec2(0, texel.y)).r;
            float su = texture(sTD2DInputs[0], sp + vec2(0, texel.y)).r;
            haloAccum += length(vec2(sr - sl, su - sd)) * w;
            haloW += w;
        }
    }
    edgeHalo = haloAccum / haloW;
    
    // Threshold
    float thresh = uParams.y * 0.15;
    float core = smoothstep(thresh, thresh * 2.5, edgeCore);
    float halo = smoothstep(0.01, 0.15, edgeHalo);
    
    // Neon tube color
    vec3 tubeColor = hsv2rgb(vec3(uParams.x, 0.9, 1.0));
    
    // Core: white-hot center fading to full saturation at edges
    vec3 coreCol = mix(tubeColor, vec3(1.0), core * 0.7) * core * mix(0.8, 2.5, uParams.w);
    
    // Halo: saturated color, low brightness
    vec3 haloCol = tubeColor * halo * 0.4;
    
    // Composite on black
    vec3 col = haloCol + coreCol;
    
    fragColor = TDOutputSwizzle(vec4(clamp(col, 0.0, 1.0), 1.0));
}


Deepfield

// DEEP FIELD - Hubble Ultra Deep Field aesthetic
// Dark = empty deep space (true black), bright = distant galaxies (warm)
// Far galaxies appear redshifted (warm), nearer ones bluer
// uParams.x = Cosmic Saturation (0=greyscale dust, 1=full chroma)
// uParams.y = Redshift (0=blue/white nearby galaxies, 1=red shifted distant)
// uParams.z = Glow Spread (0=tight points, 1=halo spread on bright galaxies)
// uParams.w = Faint Galaxy Boost (0=hide faint ones, 1=show faint background)
uniform vec4 uParams;
out vec4 fragColor;

void main() {
    vec2 uv = vUV.st;
    vec2 res = vec2(textureSize(sTD2DInputs[0], 0));
    vec2 texel = 1.0 / res;
    float val = texture(sTD2DInputs[0], uv).r;
    
    // Faint galaxy boost - bring out the dim ones
    float v = pow(val, mix(1.6, 0.6, uParams.w));
    
    // Hubble palette: deep blue void -> dim infrared -> warm yellow -> bright orange-white
    vec3 voidCol = vec3(0.005, 0.008, 0.02);            // very deep blue-black
    vec3 dimGalaxy = vec3(0.1, 0.07, 0.18);             // dim purple-blue
    vec3 midGalaxy = vec3(0.7, 0.45, 0.25);             // warm orange
    vec3 brightGalaxy = vec3(1.0, 0.85, 0.6);           // hot yellow-white
    
    // Redshift control: shift palette toward red for distant
    float rs = uParams.y;
    if (rs > 0.01) {
        midGalaxy = mix(midGalaxy, vec3(0.8, 0.25, 0.1), rs * 0.6);
        brightGalaxy = mix(brightGalaxy, vec3(1.0, 0.6, 0.35), rs * 0.5);
        dimGalaxy = mix(dimGalaxy, vec3(0.18, 0.05, 0.05), rs * 0.5);
    } else {
        // Blueshift the brightest (nearby galaxies appear bluer)
        brightGalaxy = mix(brightGalaxy, vec3(0.7, 0.85, 1.1), -rs * 0.4 + 0.0);
    }
    
    vec3 col;
    if (v < 0.1) {
        col = mix(voidCol, dimGalaxy * 0.3, v / 0.1);
    } else if (v < 0.4) {
        col = mix(dimGalaxy * 0.3, dimGalaxy, (v - 0.1) / 0.3);
    } else if (v < 0.7) {
        col = mix(dimGalaxy, midGalaxy, (v - 0.4) / 0.3);
    } else if (v < 0.9) {
        col = mix(midGalaxy, brightGalaxy, (v - 0.7) / 0.2);
    } else {
        col = brightGalaxy * (1.0 + (v - 0.9) * 1.5);
    }
    
    // Soft glow halo around bright galaxy cores (no random noise!)
    if (uParams.z > 0.01) {
        float halo = 0.0;
        float halMax = mix(2.0, 5.0, uParams.z);
        for (int i = -3; i <= 3; i++) {
            for (int j = -3; j <= 3; j++) {
                if (i == 0 && j == 0) continue;
                float d = length(vec2(i, j));
                if (d > halMax) continue;
                vec2 sp = uv + vec2(i, j) * texel * 1.5;
                float nv = texture(sTD2DInputs[0], sp).r;
                if (nv > 0.7) halo += (nv - 0.7) / 0.3 * (1.0 - d / halMax);
            }
        }
        halo /= 24.0;
        col += brightGalaxy * halo * 0.5 * uParams.z;
    }
    
    // Saturation
    float grey = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(grey), col, uParams.x);
    
    // Final luminance gating - empty space stays empty
    col *= smoothstep(-0.05, 0.1, val);
    
    fragColor = TDOutputSwizzle(vec4(clamp(col, 0.0, 2.0), 1.0));
}

Decay

FlowField (FEEDBACK BASED)

// FLOW FIELD - advect pixels along gradient, accumulate trails
// Input 0: color image, Input 1: feedback (trails)
// uParams.x=Flow Speed, y=Trail Persistence, z=Trail Brightness, w=Source Blend
uniform vec4 uParams;
out vec4 fragColor;

void main() {
    vec2 uv = vUV.st;
    vec2 res = vec2(textureSize(sTD2DInputs[0], 0));
    vec2 texel = 1.0 / res;
    
    vec3 src = texture(sTD2DInputs[0], uv).rgb;
    float lum = dot(src, vec3(0.299, 0.587, 0.114));
    
    float lR = dot(texture(sTD2DInputs[0], uv + vec2(texel.x, 0)).rgb, vec3(0.299,0.587,0.114));
    float lL = dot(texture(sTD2DInputs[0], uv - vec2(texel.x, 0)).rgb, vec3(0.299,0.587,0.114));
    float lU = dot(texture(sTD2DInputs[0], uv + vec2(0, texel.y)).rgb, vec3(0.299,0.587,0.114));
    float lD = dot(texture(sTD2DInputs[0], uv - vec2(0, texel.y)).rgb, vec3(0.299,0.587,0.114));
    
    vec2 grad = vec2(lR - lL, lU - lD);
    float gradMag = length(grad);
    vec2 flowDir = vec2(-grad.y, grad.x);
    
    vec2 advectUV = clamp(uv - flowDir * uParams.x * 0.02, 0.0, 1.0);
    vec3 trail = texture(sTD2DInputs[1], advectUV).rgb * uParams.y;
    
    trail += src * gradMag * uParams.z * 4.0;
    vec3 result_c = mix(trail, src + trail * 0.5, uParams.w);
    
    fragColor = TDOutputSwizzle(vec4(clamp(result_c, 0.0, 1.0), 1.0));
}


Feedback Warp (Feedback Based)

// FEEDBACK WARP - image warped by its own gradient, compounding each frame
// Input 0: current source, Input 1: feedback (previous warped state)
// uParams.x=Warp Strength, y=Persistence, z=Source Injection, w=Warp Mode(0=grad,0.5=rotate,1=radial)
uniform vec4 uParams;
out vec4 fragColor;

void main() {
    vec2 uv = vUV.st;
    vec2 res = vec2(textureSize(sTD2DInputs[0], 0));
    vec2 texel = 1.0 / res;
    
    vec3 src = texture(sTD2DInputs[0], uv).rgb;
    vec3 fbSample = texture(sTD2DInputs[1], uv).rgb;
    float fbLum = dot(fbSample, vec3(0.299, 0.587, 0.114));
    
    float lR = dot(texture(sTD2DInputs[1], uv + vec2(texel.x, 0)).rgb, vec3(0.299,0.587,0.114));
    float lL = dot(texture(sTD2DInputs[1], uv - vec2(texel.x, 0)).rgb, vec3(0.299,0.587,0.114));
    float lU = dot(texture(sTD2DInputs[1], uv + vec2(0, texel.y)).rgb, vec3(0.299,0.587,0.114));
    float lD = dot(texture(sTD2DInputs[1], uv - vec2(0, texel.y)).rgb, vec3(0.299,0.587,0.114));
    vec2 grad = vec2(lR - lL, lU - lD);
    
    float strength = uParams.x * 0.03;
    vec2 fromCenter = uv - 0.5;
    vec2 rotated = vec2(-grad.y, grad.x);
    vec2 radial = normalize(fromCenter + 0.0001) * fbLum;
    
    float mode = uParams.w;
    vec2 warpDir;
    if (mode < 0.33) warpDir = mix(grad, rotated, mode * 3.0);
    else if (mode < 0.66) warpDir = mix(rotated, radial, (mode - 0.33) * 3.0);
    else warpDir = mix(radial, grad, (mode - 0.66) * 3.0);
    
    vec2 warpedUV = clamp(uv + warpDir * strength, 0.0, 1.0);
    vec3 warped = texture(sTD2DInputs[1], warpedUV).rgb;
    
    vec3 result_c = warped * uParams.y;
    result_c = mix(result_c, src, uParams.z);
    
    fragColor = TDOutputSwizzle(vec4(clamp(result_c, 0.0, 1.0), 1.0));
}


Bloom (Simple Bloom)

// NEON BLOOM - bright area glow with blue energy tint
// Efficient dual-axis blur (not full box blur)
// uParams.x = Threshold (0=everything glows, 1=only brightest)
// uParams.y = Intensity (0=subtle haze, 1=blazing glow)
// uParams.z = Blue Energy (0=natural color bloom, 0.5=blue neon, 1=deep blue)
// uParams.w = Radius (0=tight glow, 1=wide soft bloom)
uniform vec4 uParams;
out vec4 fragColor;

void main() {
    vec2 uv = vUV.st;
    vec2 res = vec2(textureSize(sTD2DInputs[0], 0));
    vec2 texel = 1.0 / res;
    vec3 col = texture(sTD2DInputs[0], uv).rgb;
    
    float threshold = uParams.x;
    float intensity = uParams.y * 2.0;
    float blueShift = uParams.z;
    float radius = mix(2.0, 16.0, uParams.w);
    
    // Dual-axis bloom: sample along horizontal then vertical
    // Much cheaper than full box blur, still looks great
    // 13 samples per axis = 26 total (vs 169 for a 13x13 box)
    
    vec3 bloom = vec3(0.0);
    float tw = 0.0;
    
    // Gaussian-ish weights for 7 taps per side
    float weights[7] = float[7](1.0, 0.85, 0.65, 0.45, 0.28, 0.15, 0.07);
    
    // Horizontal pass
    for (int i = -6; i <= 6; i++) {
        vec2 sUV = uv + vec2(float(i) * texel.x * radius, 0.0);
        vec3 s = texture(sTD2DInputs[0], clamp(sUV, 0.0, 1.0)).rgb;
        
        // Extract bright areas above threshold
        float lum = dot(s, vec3(0.299, 0.587, 0.114));
        float bright = smoothstep(threshold, threshold + 0.15, lum);
        s *= bright;
        
        float w = weights[abs(i)];
        bloom += s * w;
        tw += w;
    }
    
    // Vertical pass
    for (int i = -6; i <= 6; i++) {
        if (i == 0) continue; // already sampled center
        vec2 sUV = uv + vec2(0.0, float(i) * texel.y * radius);
        vec3 s = texture(sTD2DInputs[0], clamp(sUV, 0.0, 1.0)).rgb;
        
        float lum = dot(s, vec3(0.299, 0.587, 0.114));
        float bright = smoothstep(threshold, threshold + 0.15, lum);
        s *= bright;
        
        float w = weights[abs(i)];
        bloom += s * w;
        tw += w;
    }
    
    bloom /= tw;
    
    // Blue energy tint: shift the bloom toward neon blue
    if (blueShift > 0.01) {
        float bloomLum = dot(bloom, vec3(0.299, 0.587, 0.114));
        vec3 blueNeon = vec3(0.15, 0.35, 1.0) * bloomLum;
        vec3 cyanNeon = vec3(0.2, 0.7, 1.0) * bloomLum;
        // Mix between original bloom color and blue neon
        vec3 tinted = mix(bloom, mix(cyanNeon, blueNeon, 0.5), blueShift);
        // Keep some of the original color so it's not ALL blue
        bloom = mix(bloom, tinted, blueShift * 0.8);
    }
    
    // Add bloom on top of original (screen blend)
    vec3 result = col + bloom * intensity;
    // Slight screen blend to prevent harsh clipping
    result = result - result * bloom * intensity * 0.15;
    
    fragColor = TDOutputSwizzle(vec4(clamp(result, 0.0, 1.0), 1.0));
}


CRT Rolling

// CRT ROLLING - vertical sine waves distort the image horizontally
// Wave displacement modulated by luminance - bright areas wobble more
// Creates broken-CRT / analog TV distortion look
// Operates on color (Stage 3)
// uParams.x = Wave Frequency (0=single giant wave, 1=tight rippling)
// uParams.y = Amplitude (0=none, 1=heavy distortion)
// uParams.z = Luma Modulation (0=uniform, 1=bright only)
// uParams.w = Roll Speed (0=static, 1=fast rolling up, negative = down)
// uParams2.x = Chroma Offset (0=clean, 1=full RGB separation on wave)
// uParams2.y = Scanline Intensity (0=none, 1=heavy black horizontal lines)
uniform vec4 uParams;
uniform vec4 uParams2;
uniform float uTime;
out vec4 fragColor;

void main() {
    vec2 uv = vUV.st;
    vec2 res = vec2(textureSize(sTD2DInputs[0], 0));
    
    // Vertical wave frequency
    float freq = mix(3.0, 40.0, uParams.x);
    
    // Time-based roll
    float roll = uParams.w * uTime * 2.0;
    
    // Sample luma at the current pixel for modulation
    vec3 selfColor = texture(sTD2DInputs[0], uv).rgb;
    float luma = dot(selfColor, vec3(0.299, 0.587, 0.114));
    
    // Luma modulation: bright areas wobble more
    float lumaFactor = mix(1.0, luma, uParams.z);
    
    // Wave phase based on vertical position + rolling
    float phase = uv.y * freq + roll;
    float wave = sin(phase * 6.2832);
    
    // Horizontal displacement
    float amp = uParams.y * 0.05 * lumaFactor;
    float disp = wave * amp;
    
    // Chroma offset: R, G, B displaced by slightly different amounts
    float chromaAmt = uParams2.x * 0.015;
    float rOffset = disp + chromaAmt * wave;
    float gOffset = disp;
    float bOffset = disp - chromaAmt * wave;
    
    vec3 result;
    result.r = texture(sTD2DInputs[0], vec2(uv.x + rOffset, uv.y)).r;
    result.g = texture(sTD2DInputs[0], vec2(uv.x + gOffset, uv.y)).g;
    result.b = texture(sTD2DInputs[0], vec2(uv.x + bOffset, uv.y)).b;
    
    // Scanlines: darken every other row
    if (uParams2.y > 0.01) {
        float scanFreq = 400.0;
        float scan = sin(uv.y * scanFreq * 3.14159);
        scan = smoothstep(-0.3, 0.7, scan);
        result *= mix(1.0, scan, uParams2.y * 0.6);
    }
    
    fragColor = TDOutputSwizzle(vec4(clamp(result, 0.0, 1.0), 1.0));
}


Noise

// NOISE - adaptive film grain / sensor noise
// uParams.x=Amount, y=Size, z=Shadow Bias, w=Color Noise
uniform vec4 uParams;
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = vUV.st;
    vec2 res = vec2(textureSize(sTD2DInputs[0], 0));
    vec4 col = texture(sTD2DInputs[0], uv);
    float lum = dot(col.rgb, vec3(0.299, 0.587, 0.114));
    
    float grainScale = mix(1.0, 8.0, uParams.y);
    vec2 grainCoord = floor(uv * res / grainScale);
    float n = hash(grainCoord + fract(col.rg * 100.0)) * 2.0 - 1.0;
    
    float bias = max(mix(1.0, 2.5 - lum * 2.0, uParams.z), 0.3);
    float strength = uParams.x * 0.3 * bias;
    
    vec3 grain;
    if (uParams.w > 0.01) {
        float nr = hash(grainCoord + vec2(1.0, 0.0)) * 2.0 - 1.0;
        float nb = hash(grainCoord + vec2(0.0, 1.0)) * 2.0 - 1.0;
        grain = mix(vec3(n * strength), vec3(nr, n, nb) * strength, uParams.w);
    } else {
        grain = vec3(n * strength);
    }
    
    fragColor = TDOutputSwizzle(vec4(clamp(col.rgb + grain, 0.0, 1.0), 1.0));
}

Scanlines

// SCANLINE - CRT/VHS analog line artifacts
// uParams.x=Line Density, y=Line Darkness, z=Jitter, w=RGB Offset
uniform vec4 uParams;
out vec4 fragColor;

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
    vec2 uv = vUV.st;
    vec2 res = vec2(textureSize(sTD2DInputs[0], 0));
    float lineCount = mix(100.0, 800.0, uParams.x);
    float row = floor(uv.y * lineCount);
    float rowFrac = fract(uv.y * lineCount);
    
    float jit = (hash(row * 7.13) - 0.5) * uParams.z * 0.008;
    vec2 jitUV = vec2(clamp(uv.x + jit, 0.0, 1.0), uv.y);
    
    float rgbOff = uParams.w * 0.002;
    float r = texture(sTD2DInputs[0], vec2(jitUV.x + rgbOff, jitUV.y)).r;
    float g = texture(sTD2DInputs[0], jitUV).g;
    float b = texture(sTD2DInputs[0], vec2(jitUV.x - rgbOff, jitUV.y)).b;
    vec3 col = vec3(r, g, b);
    
    float scanline = smoothstep(0.0, 0.4, rowFrac) * smoothstep(1.0, 0.6, rowFrac);
    col *= mix(1.0, scanline, uParams.y) * (1.0 + (hash(row * 3.7) - 0.5) * 0.05);
    
    fragColor = TDOutputSwizzle(vec4(clamp(col, 0.0, 1.0), 1.0));
}


Degrade

// DEGRADE - bit depth reduction and color banding
// Like data being slowly corrupted or compressed to nothing
// uParams.x = Bit Depth (0=24bit/clean, 1=2bit/extreme posterization)
// uParams.y = Dither (0=hard bands, 1=noise dithering softens bands)
// uParams.z = Color Bleed (0=clean, 1=channel values bleed into neighbors)
// uParams.w = Resolution Loss (0=full res, 1=pixelated chunky)
uniform vec4 uParams;
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = vUV.st;
    vec2 res = vec2(textureSize(sTD2DInputs[0], 0));
    
    // Resolution loss: pixelate
    float pixSize = mix(1.0, 32.0, uParams.w * uParams.w);
    vec2 pixUV = floor(uv * res / pixSize) * pixSize / res + (pixSize * 0.5) / res;
    
    vec3 col = texture(sTD2DInputs[0], pixUV).rgb;
    
    // Color bleed: shift channels
    if (uParams.z > 0.01) {
        float bleed = uParams.z * 0.005;
        col.r = texture(sTD2DInputs[0], pixUV + vec2(bleed, 0)).r;
        col.b = texture(sTD2DInputs[0], pixUV - vec2(bleed, 0)).b;
    }
    
    // Bit depth reduction
    float levels = mix(256.0, 4.0, uParams.x);
    
    // Dither before quantization
    if (uParams.y > 0.01) {
        float dither = (hash(pixUV * res) - 0.5) / levels;
        col += vec3(dither * uParams.y);
    }
    
    col = floor(col * levels + 0.5) / levels;
    
    fragColor = TDOutputSwizzle(vec4(clamp(col, 0.0, 1.0), 1.0));
}


CRT

// CRT - cathode ray tube display simulation
// Phosphor subpixels, bloom, barrel distortion, scanline darkening
// uParams.x = Phosphor Visibility (0=clean, 1=visible RGB subpixel grid)
// uParams.y = Bloom (0=sharp, 1=bright areas bleed/glow)
// uParams.z = Barrel Distortion (0=flat, 1=curved CRT screen bulge)
// uParams.w = Scanline Intensity (0=no scanlines, 1=heavy dark lines)
uniform vec4 uParams;
out vec4 fragColor;

void main() {
    vec2 uv = vUV.st;
    vec2 res = vec2(textureSize(sTD2DInputs[0], 0));
    
    // Barrel distortion: CRT screen curvature
    vec2 centered = uv * 2.0 - 1.0;
    float barrel = uParams.z * 0.15;
    float r2 = dot(centered, centered);
    vec2 warped = centered * (1.0 + barrel * r2);
    vec2 warpedUV = warped * 0.5 + 0.5;
    
    // Black outside the warped area
    if (warpedUV.x < 0.0 || warpedUV.x > 1.0 || warpedUV.y < 0.0 || warpedUV.y > 1.0) {
        fragColor = TDOutputSwizzle(vec4(0.0, 0.0, 0.0, 1.0));
        return;
    }
    
    vec3 col = texture(sTD2DInputs[0], warpedUV).rgb;
    
    // Bloom: bright areas bleed (cheap box blur on bright pixels)
    if (uParams.y > 0.01) {
        vec2 texel = 1.0 / res;
        vec3 bloom = vec3(0.0);
        float bw = uParams.y * 3.0;
        for (int dy = -2; dy <= 2; dy++) {
            for (int dx = -2; dx <= 2; dx++) {
                vec3 s = texture(sTD2DInputs[0], warpedUV + vec2(float(dx), float(dy)) * texel * bw).rgb;
                float sl = dot(s, vec3(0.299, 0.587, 0.114));
                bloom += s * smoothstep(0.5, 1.0, sl);
            }
        }
        bloom /= 25.0;
        col += bloom * uParams.y * 2.0;
    }
    
    // Phosphor RGB subpixel mask
    if (uParams.x > 0.01) {
        float px = gl_FragCoord.x;
        int subpx = int(mod(px, 3.0));
        vec3 mask = vec3(0.7);
        if (subpx == 0) mask = vec3(1.0, 0.7, 0.7);
        else if (subpx == 1) mask = vec3(0.7, 1.0, 0.7);
        else mask = vec3(0.7, 0.7, 1.0);
        col *= mix(vec3(1.0), mask, uParams.x);
    }
    
    // Scanlines
    if (uParams.w > 0.01) {
        float scanline = sin(warpedUV.y * res.y * 3.14159);
        scanline = scanline * 0.5 + 0.5;
        col *= mix(1.0, scanline, uParams.w * 0.5);
    }
    
    // Slight vignette from CRT curvature
    float vig = 1.0 - r2 * 0.3 * uParams.z;
    col *= vig;
    
    fragColor = TDOutputSwizzle(vec4(clamp(col, 0.0, 1.0), 1.0));
}


---

*End of v0.1. This is the creative direction. Tech architecture is yours to design — pipeline behavior, shader implementation, hosting, framework, all your call. If something here is impossible or too expensive, push back and we'll redesign that section.*
