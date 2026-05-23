# LumiSynth

A browser-based video art tool. Load a video or open your camera — it detects motion in real time, tracks blobs with a Kalman filter, and applies GPU-accelerated visual effects. No account, no server, no upload. Everything runs locally in your browser.

---

## What It Does

```
Your video / webcam
        ↓
 Detects blobs (motion / luma / dark / sat / edge / sharp modes — works on any video)
        ↓
 Tracks blobs across frames with a Kalman filter (smooth, persistent)
        ↓
 Pipeline:  STRUCTURE  →  COLOR (0–3, chained)  →  FX RACK  +  PER-BLOB overlay
            geometry      palette / tone             chain       (Inv / Thermal,
            / pattern     stack of up to 3           0–3 slots    inside blob regions)
        ↓
 Draws overlays (shapes, labels, connection lines) on top
        ↓
 You see the result live
```

> Pipeline status: STRUCTURE → COLOR is a real FBO chain (P2 shipped — STRUCTURE writes to an intermediate texture, an orchestrator-level compose pass screen-blends it back over the source video when STRUCTURE wants that read, then COLOR samples the result). COLOR is a 0–3 slot rack — each slot can be empty / disabled / hold one of 5 color effects, slots run in series with the previous slot's output as input, and slots can be dragged to reorder. PER-BLOB (Inv / Thermal) is independent of the main chain and layers on top. The **FX RACK** is still placeholder slots (P3 — drag-to-reorder mechanics, real FX shaders, and Inv / Thermal moving in from PER-BLOB). See `lumisynthprd.md` for the full implementation status.

Nothing leaves your computer.

---

## Effects

Grouped by pipeline stage. STRUCTURE and PER-BLOB are single-pick (or "None"). COLOR is a 0–3 slot rack chained in series. FX RACK is placeholder.

### STRUCTURE — geometry / pattern (pick one)

| Effect | Description |
|--------|-------------|
| **Voronoi** | Jump-flood Voronoi diffusion (WebGL2, stateful) |
| **Cellular** | Conway-style cellular automata seeded from video (WebGL2, stateful) |
| **ASCII** | 5×7 bitmap font density ramp rendered in GLSL |
| **Shatter** | Voronoi cell shatter with cracked edges |
| **Erode** | Morphological erode / dilate |
| **Wave** | 2D wave equation rippling from bright pixels (WebGL2, stateful) |

### COLOR — palette / tone (0–3 slot rack, chained in series)

Three fixed slots stacked vertically. Each slot can be empty, hold one of the 5 colors below, or be filled-but-disabled. Enabled non-empty slots run in series — slot 0's output feeds slot 1, which feeds slot 2 — with the terminal slot's blend mode applied at composite time. Same color may appear in multiple slots (compounding). Drag the slot handle to reorder.

| Effect | Description |
|--------|-------------|
| **Oxide** | Corroded metal patina — copper, iron, silver |
| **Synth** | Luminance mapped to synesthetic frequency colors |
| **BioLum** | Deep-sea bioluminescent glow |
| **Thermo** | Full-frame thermal vision |
| **FalseClr** | Switchable scientific palettes (thermal / neon / acid / ice) |

### FX RACK — chain · 0–3 slots

Three placeholder slots, inert. Real FX shaders + drag-to-reorder land in P3 along with Inv / Thermal moving here from PER-BLOB.

### PER-BLOB — overlay, layered on top (pick one)

Independent of the main chain. Applied after STRUCTURE → COLOR composites, inside detected blob regions only.

| Effect | Description |
|--------|-------------|
| **Inv** | Invert RGB inside blob regions |
| **Thermal** | Heat-map palette inside blob regions |

---

## Code Layout

```
LumiSynth/
├── index.html          ← sidebar + canvas layout
├── src/
│   ├── main.js         ← render loop, state, control wiring
│   ├── blobDetector.js ← grid-based local-maxima detection (motion / luma / dark / sat / edge / sharp modes)
│   ├── kalman.js       ← 1D Kalman filter, blob tracker, nearest-neighbour association
│   ├── filters.js      ← CPU per-blob filters (inv, thermal)
│   ├── overlays.js     ← shapes, labels, connection lines
│   ├── voronoi.js      ← WebGL2 Voronoi diffusion (ping-pong FBOs)
│   ├── cellular.js     ← WebGL2 cellular automata (ping-pong FBOs)
│   ├── ascii.js        ← WebGL2 ASCII luma (single-pass)
│   ├── glFilters.js    ← WebGL2 stateless filters (shatter, erode, oxide, synth, biolum, thermo, falsecolor)
│   ├── wave.js         ← WebGL2 wave propagation (ping-pong FBOs, RGBA16F)
│   ├── glContext.js    ← shared WebGL2 context, canvas, video texture, and quad VAO across all effect modules; lazy chain FBO pair for STRUCTURE → COLOR
│   ├── glCompose.js    ← STRUCTURE → COLOR compose pass: screen-blends STRUCTURE's output back over the source video so glow-over-video identity survives chaining
│   ├── glUtil.js       ← allocate-once video texture upload helper
│   └── style.css       ← all styling
└── package.json
```

---

## Controls

| Control | What it does |
|---------|-------------|
| Upload Video | Load a local video file |
| Open Camera | Use webcam as live input |
| Video Speed | 1×–4× playback |
| Shape | rect / circle / rounded / diamond bounding boxes |
| Region Style | Basic (score) / Label (Object N) / Frame (handles) |
| STRUCTURE | Pick one geometry / pattern effect, or None (see table above) |
| COLOR rack | 3 slots stacked vertically. Click a slot's chip to open the picker (None + 5 colors). Toggle pill (✓ / ⊘) enables / disables a slot without losing the pick. × clears a slot back to empty. Drag the handle (≡) to reorder. Slots run in series. **Each slot has its own copy of its effect's knobs** — click the chevron (▾) on a filled slot to expand an inline knob panel underneath, with `⟲` to reset only that slot to factory. Two synth slots can have independent settings. |
| PER-BLOB | Pick one per-blob overlay (Inv / Thermal), or None |
| Connection Rate | Fraction of inter-blob lines to draw |
| Detect Mode | Motion (frame diff) · Luma (bright) · Dark (silhouettes) · Sat (vivid color) · Edge (Sobel boundaries) · Sharp (Laplacian detail). When the video is paused, detection pauses too — but the last-known blobs stay on screen instead of disappearing. |
| Sensitivity | Change threshold for motion / brightness cutoff |
| Max Blobs | Cap on tracked blobs |
| Update Interval | Detect every N frames |
| Smooth | Lerps tracked blob positions toward detections each render frame (0 = snap, 1 = max smoothing) |
| Stroke Width | Line/border width 0–4 px |
| Blob Size | Bounding box scale: 0 / 32 / 64 / 128 / 256 |
| Font Size | Label text size |
| Overlay Color | Color of shapes and lines |

Effect-specific sliders appear in a card below STRUCTURE / PER-BLOB when an effect is selected. COLOR knobs render *inline inside their rack slot* (per-slot params) — expand a slot to see them.

Hover any filter button or effect-card knob for ~350 ms — a description tooltip appears beside the cursor explaining what it does. Press `?` for the keyboard-shortcut help panel.

### Output

| Action | Shortcut | Format |
|--------|----------|--------|
| `Snap` — save current frame | `S` | PNG |
| `Rec` — toggle clip recording | `R` | MP4 (or WebM/VP9 fallback) |

`Rec` records exactly the pixels you see on the canvas (raw video + STRUCTURE → COLOR chain output + per-blob CPU pass + overlays). The button shows live elapsed time while recording with a pulsing red dot. Audio is not included — clips are video-only by design. Files download as `lumisynth-<timestamp>.<ext>` to your default downloads folder. Switching the source mid-recording auto-finalizes the clip.

---

## How to Run

### 1 — Install Node.js

Download the **LTS** version from [nodejs.org](https://nodejs.org) and run the installer. Verify:
```
node --version
```

### 2 — Get the project

```
git clone https://github.com/sourikduttanyu/lumisynth.git
cd lumisynth
```

Or unzip the folder and `cd` into it.

### 3 — Install and start

```
npm install
npm run dev
```

Open the URL shown in the terminal — usually **http://localhost:5173**

---

## Troubleshooting

**Camera won't open** — Click Allow when the browser asks. If already denied: browser Settings → Site permissions → Camera → Allow.

**Nothing detected** — Lower the Sensitivity slider. For videos without movement, try Luma (bright subjects), Dark (silhouettes), Sat (colored objects), Edge (any structure), or Sharp (focused detail) — they all work on static frames.

**WebGL effect not showing** — Check browser console for shader errors. WebGL2 is required (all modern browsers support it).
