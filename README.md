# LumiSynth

LumiSynth is a browser-based real-time video instrument built with vanilla JavaScript, raw WebGL2, Canvas 2D, Vite, Playwright, and Cloudflare Pages Functions.

It takes a local video, image, or webcam feed, detects visual regions in real time, tracks them across frames, runs a GPU shader pipeline, and draws expressive tracking overlays on top. The product is designed like a synth: immediate controls, dense but readable UI, and no framework hiding the rendering pipeline.

This repository is useful to review as a frontend systems project, a creative-coding project, and a small product-engineering slice with auth, persistence, tests, and deployment scaffolding.

## Why It Matters In 2026

Modern frontend work is no longer just forms and dashboards. LumiSynth demonstrates the kind of browser engineering that sits between product UI, graphics, performance, local media APIs, and edge-hosted backend services.

For recruiters and engineering managers, the project shows:

- Real-time browser rendering with WebGL2 and Canvas 2D.
- CPU-side image analysis and blob tracking with stable identities.
- A custom interaction-heavy UI without React, Tailwind, or component libraries.
- Production-shaped concerns: persistence, export gating, smoke tests, linting, and Cloudflare hosting.
- Product judgment: a complex tool kept usable through staged controls, rack slots, tooltips, and onboarding.

## Product Snapshot

Users can:

- Upload a video or image, or open a webcam.
- Choose a STRUCTURE effect for geometry and pattern.
- Chain up to three COLOR effects in a rack.
- Track blobs using motion, luma, dark, saturation, edge, sharp, or color-key detection.
- Draw overlays: shapes, labels, straight graph lines, and curved hub connections.
- Add Track FX: echo blobs, radar sweep, and heatmap residue.
- Save a PNG snapshot or record the canvas as a video clip.
- Login for gated exports and cloud preset flows, with local internal login available before the real D1 database is configured.

The media itself stays in the browser. The Cloudflare backend stores account/session data, presets, and export events, not uploaded video files.

## Architecture

```text
Video / image / webcam
  -> blobDetector.js      CPU detection: motion/luma/dark/sat/edge/sharp/color
  -> kalman.js            nearest-neighbor identity tracking + Kalman smoothing
  -> oneEuroFilter.js     display-level smoothing for tracked blobs
  -> STRUCTURE            WebGL2 full-frame effect
  -> COLOR rack           0-3 chained WebGL2 color passes
  -> PER-BLOB             optional CPU filter inside blob regions
  -> overlays.js          Canvas 2D shapes, labels, graph lines, Track FX
  -> Snap / Rec           PNG or MediaRecorder canvas export
```

The GL modules share one offscreen WebGL2 canvas, one context, one uploaded video texture, one quad VAO, and a pair of chain FBOs. `main.js` orchestrates frame upload, effect dispatch, ping-pong rendering, and final 2D canvas compositing.

## Technical Highlights

| Area | What to look at |
|---|---|
| Real-time rendering | Shared WebGL2 context in `src/glContext.js`, shader dispatch in `src/glFilters.js`, ASCII shader in `src/ascii.js` |
| Pipeline design | STRUCTURE -> COLOR rack FBO chain in `src/main.js`, compose pass in `src/glCompose.js` |
| Tracking | Blob detector in `src/blobDetector.js`, Kalman tracker in `src/kalman.js`, One Euro smoothing in `src/oneEuroFilter.js` |
| Creative overlays | Track shapes, labels, MST/star/constellation/curved hub lines, echo/radar/heatmap in `src/overlays.js` |
| Product UI | Rack controls, knobs, sliders, toggles, first-run intro, custom cursor, tooltip system in `index.html`, `src/main.js`, `src/style.css` |
| Backend slice | Cloudflare Pages Function API in `functions/api/[[path]].js`, D1 schema in `migrations/0001_auth_presets.sql` |
| Quality gates | ESLint, Vite build, Playwright smoke tests |

## Tech Stack

- Vanilla JavaScript modules
- Raw WebGL2 and GLSL
- Canvas 2D
- Vite
- Playwright
- ESLint
- Cloudflare Pages Functions
- Cloudflare D1 schema scaffolding

Intentional constraints: no TypeScript, no React/Svelte/Solid, no Tailwind, no shadcn, no three.js. The point is to expose the browser platform directly.

## Current Feature Status

Implemented:

- STRUCTURE effects: ASCII, Erode, Watershed, Pixel Sort, Melt.
- STRUCTURE output modes: Mono, Source, Ink.
- COLOR rack with three independent chained slots.
- Many COLOR shader effects, including oxide, synth, biolum, thermo, falsecolor, bloom, noise, scanlines, degrade, CRT, and others.
- TRACK mode with detection controls, shapes, labels, graph lines, curved hub lines, and Track FX.
- Snapshot and recording exports.
- Cloudflare auth/preset/export API scaffold.
- Localhost-only internal login fallback for testing gated flows before D1 setup.
- Playwright smoke tests and ESLint.

Not yet implemented:

- Real GL FX RACK shaders for the main SYNTH pipeline.
- Final Cloudflare D1 production database binding.
- Production email provider configuration.

## Run Locally

### For a non-technical Windows user

Double-click `LumiSynth.cmd`.

It will:

1. Check that Node.js is installed.
2. Install dependencies on first launch.
3. Open the browser to LumiSynth.
4. Start the local dev server.

Keep the command window open while using LumiSynth. Close it when finished.

If it says Node.js is missing, install the LTS version from [nodejs.org](https://nodejs.org/), then double-click `LumiSynth.cmd` again.

### Developer commands

```bash
npm install
npm run dev
```

Open the Vite URL, usually `http://localhost:5173`.

Useful commands:

```bash
npm run lint       # ESLint
npm run build      # production build
npm run test:e2e   # Playwright smoke tests
npm run preview    # preview built dist/
```

## Internal Login Before Cloudflare D1

The frontend includes a localhost-only fallback so gated export and cloud preset UI can be tested before the real Cloudflare D1 database exists.

On `localhost` or `127.0.0.1`:

1. Enter an email in the Account panel.
2. Click `Send Code`.
3. Use the internal code shown in the toast.
4. Test Snap/Rec export gating and preset save/load/delete locally.

Internal auth and presets are stored in `localStorage`. This is not the production auth path.

## Cloudflare Hosting Plan

Frontend:

- Cloudflare Pages serves the built Vite app from `dist/`.

Backend:

- `functions/api/[[path]].js` runs as a Cloudflare Pages Function.
- D1 binding must be named `DB`.
- `migrations/0001_auth_presets.sql` defines users, auth challenges, sessions, presets, and export events.

Production env vars expected:

```text
RESEND_API_KEY
AUTH_FROM_EMAIL
APP_ORIGIN
```

The real D1 `database_id` is intentionally not committed because it is only known after creating the Cloudflare D1 database.

## Code Layout

```text
.
├── index.html
├── src/
│   ├── main.js              # state, render loop, UI wiring
│   ├── schemas.js           # defaults, effect schemas, rack factories
│   ├── blobDetector.js      # CPU blob detection modes
│   ├── kalman.js            # tracker and stable IDs
│   ├── oneEuroFilter.js     # adaptive display smoothing
│   ├── overlays.js          # Canvas 2D tracking overlay and Track FX
│   ├── glContext.js         # shared WebGL2 context and FBO chain
│   ├── glCompose.js         # STRUCTURE -> COLOR compose pass
│   ├── glFilters.js         # full-frame GL effects
│   ├── ascii.js             # WebGL2 ASCII renderer
│   ├── filters.js           # CPU per-blob filters
│   └── style.css
├── functions/api/[[path]].js
├── migrations/0001_auth_presets.sql
├── tests/e2e/smoke.spec.js
├── eslint.config.js
├── playwright.config.js
├── wrangler.toml
└── package.json
```

## Suggested Review Path

For a quick engineering review:

1. Start with `src/main.js` around the render loop and pipeline dispatch.
2. Read `src/glContext.js` to see the shared WebGL contract.
3. Read `src/blobDetector.js` and `src/kalman.js` for tracking.
4. Read `src/overlays.js` for the TRACK visual layer.
5. Read `functions/api/[[path]].js` for the edge backend shape.

## Troubleshooting

**Camera will not open**: allow camera access in the browser permissions.

**No blobs appear**: lower threshold, increase max blobs, or switch detection mode. For low-motion footage, try luma, saturation, edge, sharp, or color-key detection.

**WebGL effects do not render**: use a browser with WebGL2 support and check the console for shader compile errors.

**Cloudflare API unavailable locally**: use normal `npm run dev` with the internal login fallback, or configure Pages Functions/D1 and run the Cloudflare dev path.
