# FluxKit

A browser-based video art tool. Load a video or open your camera — it detects motion in real time, tracks blobs with a Kalman filter, and applies GPU-accelerated visual effects. No account, no server, no upload. Everything runs locally in your browser.

---

## What It Does

```
Your video / webcam
        ↓
 Detects motion or luminance blobs (grid-based, works on any video)
        ↓
 Tracks blobs across frames with a Kalman filter (smooth, persistent)
        ↓
 Draws overlays (shapes, labels, connection lines)
        ↓
 Applies WebGL2 effects to the full frame
        ↓
 You see the result live
```

Nothing leaves your computer.

---

## Effects

| Effect | Description |
|--------|-------------|
| **Inv** | Invert RGB inside blob regions |
| **Thermal** | Heat-map palette inside blob regions |
| **Voronoi** | Jump-flood Voronoi diffusion (WebGL2, stateful) |
| **Cellular** | Conway-style cellular automata seeded from video (WebGL2, stateful) |
| **ASCII** | 5×7 bitmap font density ramp rendered in GLSL |
| **Shatter** | Voronoi cell shatter with cracked edges |
| **Erode** | Morphological erode / dilate |
| **Wave** | 2D wave equation rippling from bright pixels (WebGL2, stateful) |
| **Oxide** | Corroded metal patina — copper, iron, silver |
| **Synth** | Luminance mapped to synesthetic frequency colors |
| **BioLum** | Deep-sea bioluminescent glow |
| **Thermo** | Full-frame thermal vision |
| **FalseClr** | Switchable scientific palettes (thermal / neon / acid / ice) |

---

## Code Layout

```
FluxKit/
├── index.html          ← sidebar + canvas layout
├── src/
│   ├── main.js         ← render loop, state, control wiring
│   ├── blobDetector.js ← grid-based local-maxima detection (luma + motion modes)
│   ├── kalman.js       ← 1D Kalman filter, blob tracker, nearest-neighbour association
│   ├── filters.js      ← CPU per-blob filters (inv, thermal)
│   ├── overlays.js     ← shapes, labels, connection lines
│   ├── voronoi.js      ← WebGL2 Voronoi diffusion (ping-pong FBOs)
│   ├── cellular.js     ← WebGL2 cellular automata (ping-pong FBOs)
│   ├── ascii.js        ← WebGL2 ASCII luma (single-pass)
│   ├── glFilters.js    ← WebGL2 stateless filters (shatter, erode, oxide, synth, biolum, thermo, falsecolor)
│   ├── wave.js         ← WebGL2 wave propagation (ping-pong FBOs, RGBA16F)
│   ├── glUtil.js       ← shared WebGL2 helpers (allocate-once video texture upload)
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
| Filter | Effect to apply (see table above) |
| Connection Rate | Fraction of inter-blob lines to draw |
| Detect Mode | Motion (frame diff) or Luma (absolute brightness) |
| Sensitivity | Change threshold for motion / brightness cutoff |
| Max Blobs | Cap on tracked blobs |
| Update Interval | Detect every N frames |
| Smooth | Lerps tracked blob positions toward detections each render frame (0 = snap, 1 = max smoothing) |
| Stroke Width | Line/border width 0–4 px |
| Blob Size | Bounding box scale: 0 / 32 / 64 / 128 / 256 |
| Font Size | Label text size |
| Overlay Color | Color of shapes and lines |

Effect-specific sliders appear below Filter when an effect is selected.

---

## How to Run

### 1 — Install Node.js

Download the **LTS** version from [nodejs.org](https://nodejs.org) and run the installer. Verify:
```
node --version
```

### 2 — Get the project

```
git clone https://github.com/sourikduttanyu/fluxkit.git
cd fluxkit
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

**Nothing detected** — Lower the Sensitivity slider. Try switching Detect Mode to Luma for videos without movement.

**WebGL effect not showing** — Check browser console for shader errors. WebGL2 is required (all modern browsers support it).
