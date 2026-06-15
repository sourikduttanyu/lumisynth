# Reactivity Plan — Live / audio-reactive mode

Status: **Phase 1 built** (signal bus + meter). Phases 2–4 proposed. This doc is the
build spec for turning LumiSynth into a live, audio-reactive instrument.

## One-liner

A `Live` mode where the synth is driven by sound (or, later, a camera). Audio is
analysed into a small **signal bus**, and that bus feeds two parallel systems:

- a **mod matrix** that continuously pushes knobs, and
- a **step sequencer** that swaps effects/looks on the beat from a pool you pick.

Both fold into a transient "effective look" that the existing render pipeline draws.
Nothing about non-live use changes.

## The reactivity chain

```
Live mode  (upload · mic · source audio)
   │
Audio engine  (FFT · envelopes · BPM clock)
   │
Signal bus  { bass, mid, high, level, beat }          ← shared backbone
   ├──────────────► Mod matrix  (continuous, every frame)   signals × knobs · depth
   └──────────────► Step sequencer  (discrete, on the beat)  beat → your effect pool
                         │
              Effective look  (base + mods · active effect)  ← transient, not saved
                         │
              Render pipeline  (source · structure · color · grade · fx · overlays)
```

Key idea: the bus is built **once**; both brains plug into it. A future MediaPipe
VJ mode is "a second thing that fills the bus" — the rest of the chain is unchanged.
The same chain works whether a signal comes from a kick drum or a dancer's hand.

## Components

### 1. Live mode (the gate)

- A `Live` toggle at the top of the app. Off = today's behaviour (static knobs),
  nothing else changes. On = open audio input + reveal the reactivity panel.
- Audio source options (easiest → coolest):
  - **The loaded source's own audio track** — tap the `<video>`'s audio straight into
    the analyser. Zero friction; the loop reacts to itself. Best default.
  - **Mic** (`getUserMedia`) — react to the room / live music. Universal.
  - **File upload** — drop a track to drive the visuals.
  - (Tab/system audio via `getDisplayMedia` is possible but flaky — later/optional.)
- Live values are **transient**: stopping Live restores your exact knob settings.

### 2. Audio engine + signal bus

- Web Audio: `AudioContext` → `AnalyserNode`; `getByteFrequencyData()` per frame.
- Extract a SMALL musical signal set (don't expose raw bins):
  - **bass** (~20–150 Hz), **mid**, **high** — each a 0–1 band level.
  - **level** — overall RMS energy.
  - **beat** — a *trigger*, via onset detection: bass energy vs. its rolling average,
    fire when it spikes past a threshold + a refractory window has passed.
- Make it musical, not twitchy:
  - **Attack/decay envelopes** (fast up, slow down — the VU bounce). Reuse the One
    Euro filter (`src/oneEuroFilter.js`) on the control signals.
  - **Auto-gain / normalize** to a running max so it reacts the same at any volume.
  - **Per-signal sensitivity + noise floor** so silence = still.
- **BPM clock / tap-tempo**: onset detection alone is jittery. Provide a tap-tempo (or
  estimated BPM) clock so the sequencer runs off a clean grid, optionally re-synced by
  the kick. This is the difference between "snaps on the bar" and "twitches."
- Module: new `src/audioReactive.js` owns the context, extraction, envelopes, and the
  BPM clock; exposes `getSignals() → { bass, mid, high, level, beat }` + `getBeatClock()`.

### 3. Mod matrix (continuous)

- A list of **routes**: `{ signal, targetKnob, depth, mode }`.
- Target = any existing knob / state key (shader knobs, FX params, COLOR params,
  GRADE, structure knobs). The knobs you already have ARE the matrix rows.
- Apply each frame: `effective = clamp(base + signal * depth, min, max)`. Two rules:
  - **Modulate AROUND the user's knob, never overwrite it.** The knob sets the centre;
    audio pushes it within range. The user still drives the vibe.
  - **Don't persist live values.** Render from a transient effective look only.
- UI — **drag-to-assign, on the knob** (NOT a grid/matrix table):
  - A **signal dock** (Bass/Mid/High/Level/Beat chips, each with a live meter).
  - **Drag a chip onto any knob** to create a route. (Drag is reserved EXCLUSIVELY for
    the mod matrix — see UI decisions below.)
  - The assigned knob grows a **colored mod-ring** showing the depth range it sweeps,
    with the live value riding inside it. Drag the ring to set depth.
  - Reuse `knobRegistry` (has `setValue`/min/max) for clamping + visually nudging the
    on-screen knob so it dances with the music.
- Tiers: **casual** = a few one-tap reactive presets + a master Reactivity knob;
  **player** = the drag-to-assign model; **power** = a flat "modulations" list view.

### 4. Step sequencer (discrete, on the beat)

- Engine = a **clip row + pointer**. The beat clock (÷ rate) advances the pointer
  through a list; on advance, apply `pool[index]` (swap the active effect/look).
- A slot/pool entry can be: a single param value, a COLOR/STRUCTURE effect, an FX, a
  shader source, or a whole **look/preset** (you already have looks via timeline
  segments + presets — reuse them as slot content).
- **The pool is curated — it never auto-cycles the whole library.** You pick exactly
  which effects are in the rotation (see UI decisions). Two flavours:
  - **Playlist** — ordered slots, walked forward / ping-pong.
  - **Bag** — a set, picked **random / shuffle (no immediate repeat)** each advance.
- **Rate division**: ÷1 ÷2 ÷4 ÷8 / bar. Default to a bar or phrase — every beat is
  usually too fast. Cycling on the downbeat of each bar is the money setting.
- **Switch flavour**: **hard cut** (snap on the beat — punchy, cheap, default) vs.
  **crossfade** (beat starts a fast blend; renders both states for the window — heavier,
  optional).
- **Feedback gotcha**: swapping a feedback FX (drag/lumadrag/burnin/tunnel) resets its
  trail per the existing reset rules — reads as a satisfying re-burst on-beat, but flag
  it if trail-persistence-through-cycle is wanted.
- **Lanes (future)**: multiple independent lanes, each its own pool + rate (one cycles
  COLOR every 4 bars, another swaps the shader every 8, another flashes an FX on the
  kick). v1 = a single lane.

### 5. Effective look (the fold / apply layer)

- One hook in `renderFrame`, before `resolveActivePipeline()`:
  `const sig = audio.getSignals(); const live = applyModulation(baseLook, routes, sig);`
  with the sequencer having set which effect/look is active → run the pipeline on `live`.
- Effects/shaders read modulated params unchanged — **no shader/effect code changes**.

## UI decisions (resolved)

- **Drag is reserved for the mod matrix only** (signal chip → knob). One drag metaphor
  in the whole app avoids the bidirectional-drag confusion of also dragging effects.
- **The sequencer pool is built by multi-select toggles on the existing picker grids**,
  not by dragging and not by a dropdown. In sequencer mode each effect / color / shader
  swatch gets an "in rotation" toggle (star/check). You build the pool from the same
  grid you already browse effects in — see everything at once, reuse existing UI.
- Casual entry point first: one-tap reactive presets + a master Reactivity knob, so a
  newcomer is never confronted with the matrix or the sequencer.

## What's saved vs. transient

- **Saved (part of the patch / look):** mod-matrix routes, sequencer pool + order +
  rate, audio sensitivity settings.
- **Transient (never persisted):** the per-frame modulated knob values and the
  sequencer's current index. Stop Live → knobs return to their saved positions.

## Integration points in the codebase

- `src/audioReactive.js` (new) — audio engine, signal bus, BPM clock.
- Routing store (the matrix) + sequencer state — new, persisted with the patch.
- `src/main.js` `renderFrame` — one hook to build the effective look before dispatch.
- `src/oneEuroFilter.js` — reuse for control-signal smoothing.
- `knobRegistry` (main.js) — clamp + visual knob nudge for the mod-ring.
- Existing COLOR / FX / shader pickers — add the "in rotation" toggle for the pool.
- Timeline segments + presets — reuse as sequencer slot content (whole-look cycling).

## Build phases (each independently shippable)

1. **Foundation** — `Live` button + audio engine + signal bus + a live band meter.
   Nothing reactive yet; just prove the signals. **[BUILT]** — `src/audioReactive.js`
   (mic / file / source inputs, FFT → {bass,mid,high,level,beat}); topbar `Live`
   toggle reveals the sidebar meter panel driven by its own RAF loop. Bands are
   raw FFT level × a per-band Gain trim (bass/mid/high/level) — the raw level
   already bounces; an auto-normalize attempt read as flat-maxed and was removed.
   Beat uses a FLUX onset detector (`beatStep()`) — fires on the positive rise
   vs. a rolling average, robust where level/hysteresis tests never re-fire on
   sustained bass. analyser smoothing 0.3 for crisp attacks. Signals +
   calibration transient.
2. **Mod matrix** — **[BUILT, list UI]** `state.modRoutes` (transient) — each route
   `{ signal, target(knobId), depth }`. `applyModulation()` folds the signals onto a
   transient clone of the render look in `renderFrame` (eff = base + signal·depth·range,
   clamped); base state is never mutated, so stop-Live restores instantly. UI is a
   "Modulations" list in the Reactivity panel (Add row → signal select · target select ·
   depth · remove). Targets = `knobRegistry` entries (GRADE + STRUCTURE knobs, ~47);
   COLOR/FX/shader slot knobs aren't registered → not modulatable yet. Still TODO: the
   drag-signal-onto-knob + mod-ring UX (nicer front-end to the same engine), modulating
   slot knobs, and persisting routes.
3. **Step sequencer** — pool (multi-select toggles) + rate + order + tap-tempo.
4. **Polish / power** — casual reactive presets, multi-lane, crossfade transitions.

## Future (out of scope for v1)

- **MediaPipe VJ mode** — body/hand/face landmarks as a SECOND bus source feeding the
  exact same matrix + sequencer. (See the VJ discussion; this is why the bus is the
  backbone.)
- **OSC / MIDI out** of the signals to drive Resolume / lights / a DAW.
- **Spout / NDI out** of the rendered canvas to a projector / VJ mixer.
- **Proper export** of a performance (see the deterministic-export discussion).
