/**
 * schemas.js — Pure data module. No DOM, no state, no side effects.
 *
 * Single source of truth for:
 *   - App defaults and storage key
 *   - COLOR_PARAM_SCHEMAS: knob/toggle definitions for every color effect
 *   - FX_PARAM_SCHEMAS: knob definitions for FX RACK effects
 *   - TRACK_FX_PARAM_SCHEMAS: knob definitions for track FX effects
 *   - Effect name lists (STRUCTURE_SECTIONS, COLOR_MAP_SECTIONS,
 *     COLOR_UNIQUE_SECTIONS, COLOR_SECTIONS, FX_SECTIONS)
 *   - BLEND_MODES: effect → Canvas 2D composite operation
 *   - Factory functions (makeFactoryParams, makeFxRack, makeTrackFxRack, etc.)
 *
 * All consumers import from here. main.js owns `state` and all DOM.
 */

// v7: saved-state schema gained `fxRack` (FX RACK went from placeholder to a
// real 3-slot GL rack).
// v8: the 3-slot COLOR rack collapsed into a single COLOR stage — `colorRack`
// is replaced by `color` (selected effect), `colorParams` (per-effect knob
// memory), and `colorHue`/`colorSat` (always-on grade pass). sanitizeLook
// migrates old colorRack saves (first enabled slot wins), so v6/v7 saves load
// cleanly through the legacy-key migration path.
export const STORAGE_KEY = 'lumisynth-state-v8';
export const TIMELINE_MIN_SEGMENT_SECONDS = 0.1;
export const TIMELINE_DEFAULTS = Object.freeze({
  timelineSegments: [],
  selectedTimelineSegmentId: null,
});

// Rack slot count for the FX RACK and TRACK FX rack: 3 fixed slots, each
// holding one effect (or empty), with per-slot enable/disable +
// drag-to-reorder. Always exactly RACK_SLOTS slots — the user fills, empties,
// and reorders them but never adds/removes the slot itself. Keeping a
// fixed-shape array makes the DOM stable for drag-and-drop and simplifies
// persistence. (The COLOR rack was retired in v8 — COLOR is a single stage.)
export const RACK_SLOTS = 3;

export const DEFAULTS = Object.freeze({
  // Source / playback.
  speed: 1,

  // SYNTH-mode pipeline.
  // - structure: 'none' | 'ascii' | 'erode' | 'watershed' | 'pixelsort' | 'melt'
  // - structureOutputMode: 'mono' | 'source' | 'ink'
  // - color: 'none' | any COLOR_SECTIONS name — the single selected COLOR
  //   stage (the 3-slot rack was retired in v8; layering happens on the
  //   timeline, one look per segment).
  // - colorParams: { [effectName]: {param: value} } — per-effect knob memory,
  //   lazily seeded with factory defaults on first pick. Lives outside
  //   DEFAULTS (object-valued); sanitized by sanitizeLook in main.js.
  // - colorHue / colorSat: always-on GRADE pass applied after the selected
  //   color (and even with color='none'). colorHue 0..1 → 0..360° rotation;
  //   colorSat 0..1 with 0.5 = neutral → 0..2× saturation.
  // - perBlob: 'none' | 'inv' | 'thermal' (legacy holding pen)
  structure: 'none', structureOutputMode: 'mono', perBlob: 'none',
  color: 'none', colorHue: 0, colorSat: 0.5,
  inkBlackHex: '#0a0908', inkCreamHex: '#ebe0c7',
  asciiCellSize: 0.3, asciiContrast: 0.3, asciiBlackThresh: 0.2, asciiGlyphStrength: 0.9,
  erodeMode: 0,       erodeRadius: 0.3,    erodeStrength: 0.7,    erodeEdge: 0.0,
  watershedBasin: 0.4, watershedBoundary: 0.5, watershedFlat: 0.5, watershedDepth: 0.0,
  pixelsortThresh: 0.4, pixelsortLength: 0.3, pixelsortOpacity: 0.8, pixelsortDir: 0.5,
  meltAmount: 0.5,     meltDrip: 0.4,         meltViscosity: 0.5,   meltDir: 0.0,

  // ============ TRACK-mode state ============
  // Top-level mode + composite selector.
  //   mode:           'synth' | 'track'  — controls body[data-mode] attr
  //                                         and which sidebar sections show
  //   trackComposite: 'overlay' | 'isolated'
  mode: 'synth',
  trackComposite: 'overlay',

  // Detection (TRACK mode owns these; SYNTH mode silently uses them too,
  // since the per-blob legacy path needs detected blobs).
  //   trackChannel:    'motion' | 'luma' | 'dark' | 'sat' | 'edge' | 'sharp'
  //   threshold        10..100 — direct detection threshold passed to blobDetector
  //   trackMinSize     4..200 px (in source pixels) — passed to blobDetector
  //   trackStability   0..1   — feeds the one-euro smoother
  //   trackMaxBlobs    5..30  — max blobs returned per frame
  //   updateInterval   1..30  — run detection every N frames (1 = every frame)
  trackChannel: 'motion',
  threshold: 30,
  trackMinSize: 8,
  trackStability: 0,
  trackMaxBlobs: 12,
  updateInterval: 1,
  // Color-key mode: hex string '#rrggbb'. Only active when trackChannel='color'.
  colorKeyHex: '#ff0000',
  colorKeyHueTol: 18,   // degrees
  colorKeySatMin: 0.25, // 0–1

  // Shape (one active style + 4 knobs).
  //   trackShape:           'solid' | 'hollow' | 'dotted' | 'corners'
  //   trackShapeColor       0..1  — hue knob (0=white)
  //   trackShapeThickness   1..8  — line/dot weight
  //   trackShapePadding   -20..20 — bbox padding
  //   trackShapeStyle       0..1  — style-specific knob (varies per shape)
  trackShape: 'solid',
  trackShapeColor: 0, trackShapeThickness: 2, trackShapePadding: 0, trackShapeStyle: 0.5,

  // Lines (8 graph types including off + 4 knobs).
  //   trackLines:           'off' | 'distthresh' | 'velocity' | 'pulse' | 'constellation' | 'mst' | 'star' | 'hubcurve'
  //   trackLinesColor       0..1
  //   trackLinesThickness   1..6
  //   trackLinesParam       0..1  — type-specific
  //   trackLinesTaper       0..1
  trackLines: 'off',
  trackLinesColor: 0, trackLinesThickness: 1, trackLinesParam: 0.5, trackLinesTaper: 0,

  // Labels + center markers (Tracery-style XY readouts).
  //   trackLabels:       true | false
  //   trackLabelMarker:  'dot' | 'plus' | 'cross'
  //   trackLabelFontSize: 8..16
  //   trackLabelColor:   0..1  — hue knob (same scheme as shape/lines)
  trackLabels: false,
  trackLabelMarker: 'dot',
  trackLabelFontSize: 10,
  trackLabelColor: 0,

  // Track FX rack (3 slots, like colorRack) — initialized via makeTrackFxRack()
  // at startup. Stores up to 3 stackable tracking effects: echo / radar / heatmap.
});

// Schema for COLOR effect parameters. Source of truth for what knobs/toggles
// each color effect exposes, their defaults, and human-readable copy. Lives
// in JS (not in HTML data-attrs as before) because color knobs no longer
// exist in the right-panel cards — they're rendered inline inside the rack
// slot when expanded, and each slot owns its OWN copy of these params. So
// "synth in slot 0" and "synth in slot 2" can have different knob values.
//
// Param keys are SHORT names (corr, metal) not the legacy long stateKeys
// (oxideCorr, oxideMetal). They live under `slot.params[paramKey]` so they
// can't collide across effect types — the slot always knows what type it is.
//
// `order` is the [4]-tuple ordering passed to applyGLFilter (uniform layout
// in the shader). Must match the shader's expected uniform order exactly.
export const COLOR_PARAM_SCHEMAS = {
  oxide: {
    knobs: [
      { key: 'corr',  label: 'Corrosion', min: 0, max: 1, step: 0.01, default: 0.5, tip: 'Corrosion blend. 0 = fresh polished metal. 1 = fully aged patina (dark, mottled).' },
      { key: 'metal', label: 'Metal',     min: 0, max: 1, step: 0.01, default: 0,   tip: 'Metal type. 0 = copper / verdigris. 0.5 = iron / rust. 1 = silver / tarnish.' },
      { key: 'rough', label: 'Rough',     min: 0, max: 1, step: 0.01, default: 0.3, tip: 'Surface roughness noise. 0 = smooth metal. 1 = pitted, granular surface.' },
      { key: 'sheen', label: 'Sheen',     min: 0, max: 1, step: 0.01, default: 0.3, tip: 'Edge specular highlight. 0 = matte. 1 = polished metal with bright edges along luma transitions.' },
    ],
    toggles: [],
    order: ['corr', 'metal', 'rough', 'sheen'],
  },
  synth: {
    knobs: [
      { key: 'warm', label: 'Warmth',    min: 0, max: 1, step: 0.01, default: 0.5, tip: 'Warm-cool color bias inside each band. Low = cool (blue / teal lean). High = warm (red / orange lean).' },
      { key: 'sep',  label: 'Sep',       min: 0, max: 1, step: 0.01, default: 0.3, control: 'slider', tip: 'Number of discrete color bands (3-12). Off below ~0.1 (smooth ramp). Higher = more posterized banding.' },
      { key: 'res',  label: 'Res',       min: 0, max: 1, step: 0.01, default: 0.4, tip: 'Resonance modulation inside each band. 0 = clean steps. 1 = strong sinusoidal brightness ripples per band.' },
      { key: 'dyn',  label: 'Dyn Range', min: 0, max: 1, step: 0.01, default: 0.7, tip: 'Dynamic range / gamma. Low = compressed midtones (flat, washed). High = stretched midtones (punchy, contrasty).' },
    ],
    toggles: [],
    order: ['warm', 'sep', 'res', 'dyn'],
  },
  biolum: {
    knobs: [
      { key: 'glow',  label: 'Glow',  min: 0, max: 1, step: 0.01, default: 0.7, tip: 'Glow intensity. Low = subtle deep-sea darkness. High = strong luminous bloom on bright regions.' },
      { key: 'color', label: 'Color', min: 0, max: 1, step: 0.01, default: 0,   tip: 'Hue of the glow. 0 = green-cyan. 1 = violet. Smooth interpolation in between.' },
      { key: 'pulse', label: 'Pulse', min: 0, max: 1, step: 0.01, default: 0.2, tip: 'Pulse modulation. 0 = steady glow. 1 = strong sinusoidal pulsing tied to local brightness.' },
      { key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, default: 0.7, tip: 'Depth fade. 0 = uniform glow regardless of brightness. 1 = darker regions stay deep / unlit (sense of underwater depth).' },
    ],
    toggles: [],
    order: ['glow', 'color', 'pulse', 'depth'],
  },
  thermo: {
    knobs: [
      { key: 'cont',  label: 'Contrast', min: 0, max: 1, step: 0.01, default: 0.4, tip: 'Thermal map contrast around the midpoint. Higher = sharper hot/cold separation; lower = flatter pseudo-color.' },
      { key: 'hot',   label: 'Hot',      min: 0, max: 1, step: 0.01, default: 0,   control: 'slider', tip: 'Bias the entire ramp toward hot. 0 = baseline. 1 = everything reads as yellow / red / white (overheated).' },
      { key: 'cold',  label: 'Cold',     min: 0, max: 1, step: 0.01, default: 0.1, control: 'slider', tip: 'Cold floor. Lifts the darkest regions toward blue. 0 = pure black floor. 1 = blue-tinted shadows (more visible cold side).' },
      { key: 'white', label: 'White Pt', min: 0, max: 1, step: 0.01, default: 0.5, control: 'slider', tip: 'White-hot clipping. Bright peaks above ~0.85 fade to pure white as this rises (simulates sensor saturation).' },
    ],
    toggles: [],
    order: ['cont', 'hot', 'cold', 'white'],
  },
  falsecolor: {
    knobs: [
      { key: 'palette', label: 'Palette', min: 0, max: 1, step: 0.01, default: 0.25, tip: 'Cross-fade between four palettes: Thermal (0) → Neon (0.25) → Acid (0.5) → Ice (0.75) → back to Thermal (1).' },
      { key: 'bandcnt', label: 'Bands',   min: 0, max: 1, step: 0.01, default: 0.5, control: 'slider', tip: 'Number of discrete color bands when Banding is On (4-20). Smaller = chunkier posterized look. Has no effect when Banding is Off.' },
      { key: 'bright',  label: 'Bright',  min: 0, max: 1, step: 0.01, default: 0.5, control: 'slider', tip: 'Brightness offset added to the input. 0.5 = neutral. Below 0.5 = darker (palette shifts cooler). Above 0.5 = brighter (palette shifts hotter).' },
    ],
    toggles: [
      { key: 'band', label: 'Banding', default: 0, options: [
        { value: 0, label: 'Off', tip: 'Smooth continuous palette ramp (no banding).' },
        { value: 1, label: 'On',  tip: 'Discrete banded ramp. Use the Bands knob to set how many color steps.' },
      ]},
    ],
    order: ['palette', 'band', 'bandcnt', 'bright'],
  },
  depthstack: {
    knobs: [
      { key: 'layers',   label: 'Layers',   min: 0, max: 1, step: 0.01, default: 0.5,  tip: 'Number of depth planes (3–8). More layers = finer spectral banding.' },
      { key: 'parallax', label: 'Parallax', min: 0, max: 1, step: 0.01, default: 0.3,  tip: 'How far each layer shifts along the gradient direction. Creates holographic depth separation.' },
      { key: 'glow',     label: 'Glow',     min: 0, max: 1, step: 0.01, default: 0.3,  tip: 'Width of the glow halo around each depth plane edge.' },
      { key: 'range',    label: 'Range',    min: 0, max: 1, step: 0.01, default: 0.5,  tip: 'Color range. 0 = narrow blue-dominant spectrum. 1 = wide violet-to-white spectrum.' },
    ],
    toggles: [],
    order: ['layers', 'parallax', 'glow', 'range'],
  },
  prismatic: {
    knobs: [
      { key: 'disp',   label: 'Dispersion', min: 0, max: 1, step: 0.01, default: 0.5, tip: 'How wide the prismatic spread is. 0 = tight. 1 = wide chromatic separation.' },
      { key: 'warmth', label: 'Warmth',     min: 0, max: 1, step: 0.01, default: 0.7, tip: '0 = neutral white split. 1 = full warm yellow-pink prismatic spectrum.' },
      { key: 'glow',   label: 'Glow',       min: 0, max: 1, step: 0.01, default: 0.3, tip: 'Bloom boost on dispersed edges. 0 = sharp. 1 = soft atmospheric bleed.' },
      { key: 'angle',  label: 'Angle',      min: 0, max: 1, step: 0.01, default: 0,   tip: 'Direction of the prismatic dispersion (0–1 maps to 0–360°).' },
    ],
    toggles: [],
    order: ['disp', 'warmth', 'glow', 'angle'],
  },
  acidwash: {
    knobs: [
      { key: 'warp',   label: 'Warp',    min: 0, max: 1, step: 0.01, default: 0.5, tip: 'Hue warp intensity. 0 = subtle banding. 1 = extreme psychedelic folding.' },
      { key: 'bands',  label: 'Bands',   min: 0, max: 1, step: 0.01, default: 0.4, tip: 'Band count (1–8 repeating hue cycles). Low = smooth. High = many sharp color bands.' },
      { key: 'sat',    label: 'Sat',     min: 0, max: 1, step: 0.01, default: 0.8, tip: 'Saturation. 0 = pastel. 1 = electric vivid.' },
      { key: 'phase',  label: 'Phase',   min: 0, max: 1, step: 0.01, default: 0,   tip: 'Phase offset shifting the entire color map. Animate for motion.' },
    ],
    toggles: [],
    order: ['warp', 'bands', 'sat', 'phase'],
  },
  xray: {
    knobs: [
      { key: 'exposure', label: 'Exposure', min: 0, max: 1, step: 0.01, default: 0.5, tip: '0 = underexposed (dark). 1 = overexposed (bright). Controls gamma curve.' },
      { key: 'edge',     label: 'Edge',     min: 0, max: 1, step: 0.01, default: 0.5, tip: 'Edge enhancement strength. 0 = smooth. 1 = sharp bone-like edges.' },
      { key: 'tint',     label: 'Tint',     min: 0, max: 1, step: 0.01, default: 0.3, tip: '0 = pure greyscale. 0.5 = blue medical tint. 1 = amber vintage.' },
    ],
    toggles: [
      { key: 'invert', label: 'Invert', default: 0, options: [
        { value: 0, label: 'Off', tip: 'Standard xray: dark structures on a pale film base.' },
        { value: 1, label: 'On',  tip: 'Negative xray: light structures on a dark film base.' },
      ]},
    ],
    order: ['exposure', 'edge', 'tint', 'invert'],
  },
  heatbleed: {
    knobs: [
      { key: 'bleed',   label: 'Bleed',  min: 0, max: 1, step: 0.01, default: 0.5, tip: 'Color bleed amount. 0 = normal thermal. 1 = heavy color bleeding across the frame.' },
      { key: 'radius',  label: 'Radius', min: 0, max: 1, step: 0.01, default: 0.3, tip: 'Bleed spread radius. 0 = tight. 1 = wide spread.' },
      { key: 'range',   label: 'Range',  min: 0, max: 1, step: 0.01, default: 0.7, tip: 'Temperature range. 0 = compressed (more uniform). 1 = full dynamic range.' },
      { key: 'glowamt', label: 'Glow',   min: 0, max: 1, step: 0.01, default: 0.3, tip: 'Glow intensity on hot areas. 0 = flat. 1 = hot areas bloom outward.' },
    ],
    toggles: [],
    order: ['bleed', 'radius', 'range', 'glowamt'],
  },
  nebula: {
    knobs: [
      { key: 'type',    label: 'Type',    min: 0, max: 1, step: 0.01, default: 0.5, tip: '0 = emission nebula (red/pink). 0.5 = reflection nebula (blue). 1 = planetary nebula (teal/magenta).' },
      { key: 'stars',   label: 'Stars',   min: 0, max: 1, step: 0.01, default: 0.3, tip: 'Star density at luminance peaks. 0 = no stars. 1 = dense sparkles.' },
      { key: 'density', label: 'Density', min: 0, max: 1, step: 0.01, default: 0.5, tip: '0 = transparent wisps. 1 = dense opaque gas clouds.' },
      { key: 'sat',     label: 'Sat',     min: 0, max: 1, step: 0.01, default: 0.8, tip: '0 = grey cosmic dust. 1 = vivid colored nebula gas.' },
    ],
    toggles: [],
    order: ['type', 'stars', 'density', 'sat'],
  },
  solarize: {
    knobs: [
      { key: 'thresh',  label: 'Thresh',  min: 0, max: 1, step: 0.01, default: 0.5, control: 'slider', tip: 'Fold threshold. Tones above this level get solarized; below stay normal.' },
      { key: 'intens',  label: 'Intens',  min: 0, max: 1, step: 0.01, default: 0.8, control: 'slider', tip: '0 = subtle solarize. 1 = full Sabattier effect.' },
      { key: 'cycles',  label: 'Cycles',  min: 1, max: 8, step: 0.1,  default: 1,   control: 'slider', tip: 'Number of fold cycles. 1 = single fold. Higher = multiple repeating inversions.' },
      { key: 'shift',   label: 'Shift',   min: 0, max: 1, step: 0.01, default: 0,   tip: 'Per-channel color shift. 0 = uniform solarize. 1 = RGB offset for chromatic solarization.' },
    ],
    toggles: [],
    order: ['thresh', 'intens', 'cycles', 'shift'],
  },
  aurorastorm: {
    knobs: [
      { key: 'storm',   label: 'Storm',   min: 0, max: 1, step: 0.01, default: 0.5, tip: '0 = gentle aurora. 1 = violent banding storm.' },
      { key: 'curtain', label: 'Curtain', min: 0, max: 1, step: 0.01, default: 0.4, tip: '0 = no vertical smear. 1 = heavy curtain streaking.' },
      { key: 'color',   label: 'Color',   min: 0, max: 1, step: 0.01, default: 0,   tip: '0 = green dominant. 0.5 = magenta. 1 = mixed violent multi-color.' },
      { key: 'stars',   label: 'Stars',   min: 0, max: 1, step: 0.01, default: 0.3, tip: 'Star density in dark areas. 0 = no stars. 1 = dense starfield in the voids.' },
    ],
    toggles: [],
    order: ['storm', 'curtain', 'color', 'stars'],
  },
  cyanotype: {
    knobs: [
      { key: 'depth',   label: 'Depth',   min: 0, max: 1, step: 0.01, default: 0.6, tip: '0 = lighter cyan. 1 = deep Prussian navy.' },
      { key: 'contrast',label: 'Contrast',min: 0, max: 1, step: 0.01, default: 0.5, tip: '0 = soft wash. 1 = hard blueprint print.' },
      { key: 'grain',   label: 'Grain',   min: 0, max: 1, step: 0.01, default: 0.3, tip: 'Paper fiber texture in highlights. 0 = clean. 1 = visible grain.' },
      { key: 'edge',    label: 'Edge',    min: 0, max: 1, step: 0.01, default: 0.2, tip: '0 = smooth. 1 = sharp technical outlines etched into the highlights.' },
    ],
    toggles: [],
    order: ['depth', 'contrast', 'grain', 'edge'],
  },
  infrared: {
    knobs: [
      { key: 'intens',   label: 'Intens',  min: 0, max: 1, step: 0.01, default: 0.7, tip: '0 = subtle red shift. 1 = heavy Aerochrome infrared.' },
      { key: 'blueshift',label: 'Blue',    min: 0, max: 1, step: 0.01, default: 0.3, tip: '0 = neutral shadows. 1 = deep blue-black tint in the shadows.' },
      { key: 'contrast', label: 'Contrast',min: 0, max: 1, step: 0.01, default: 0.5, tip: '0 = soft film look. 1 = hard print.' },
      { key: 'grain',    label: 'Grain',   min: 0, max: 1, step: 0.01, default: 0.3, tip: '0 = clean. 1 = heavy film grain on midtones and highlights.' },
    ],
    toggles: [],
    order: ['intens', 'blueshift', 'contrast', 'grain'],
  },
  neontube: {
    knobs: [
      { key: 'hue',    label: 'Hue',    min: 0, max: 1, step: 0.01, default: 0.85, tip: 'Neon color hue. 0.85 = hot pink, 0.55 = cyan, 0.15 = amber.' },
      { key: 'thresh', label: 'Thresh', min: 0, max: 1, step: 0.01, default: 0.3, control: 'slider', tip: 'Edge threshold. Only edges stronger than this light up as neon tubes.' },
      { key: 'halo',   label: 'Halo',   min: 0, max: 1, step: 0.01, default: 0.5,  tip: '0 = crisp tube cores. 1 = wide soft atmospheric halo.' },
      { key: 'bright', label: 'Bright', min: 0, max: 1, step: 0.01, default: 0.6,  tip: '0 = faint tubes. 1 = blinding hot neon cores.' },
    ],
    toggles: [],
    order: ['hue', 'thresh', 'halo', 'bright'],
  },
  deepfield: {
    knobs: [
      { key: 'sat',    label: 'Sat',     min: 0, max: 1, step: 0.01, default: 0.8, tip: '0 = greyscale cosmic dust. 1 = full chroma galaxy colors.' },
      { key: 'red',    label: 'Redshift',min: 0, max: 1, step: 0.01, default: 0.3, tip: '0 = blue/white nearby galaxies. 1 = red-shifted distant galaxies.' },
      { key: 'glow',   label: 'Glow',   min: 0, max: 1, step: 0.01, default: 0.4, tip: '0 = tight galaxy points. 1 = wide halo spread on bright objects.' },
      { key: 'boost',  label: 'Boost',  min: 0, max: 1, step: 0.01, default: 0.3, tip: '0 = hide faint galaxies. 1 = boost faint background objects into visibility.' },
    ],
    toggles: [],
    order: ['sat', 'red', 'glow', 'boost'],
  },
  // CUSTOM tab — the ChromaEngine. User-built 4-stop color ramp + a driver
  // select choosing which scalar feeds the ramp. The 4 stops are hex strings
  // in `colors` (passed to the shader as vec3 uniforms via opts.stops, same
  // mechanism as the ink colors), NOT packed into uParams.
  chroma: {
    knobs: [
      { key: 'bands', label: 'Bands', min: 0, max: 1, step: 0.01, default: 0,   tip: 'Posterize the ramp into discrete bands. 0 = smooth continuous gradient. Higher = fewer, chunkier color steps (3-16 bands).' },
      { key: 'gamma', label: 'Gamma', min: 0, max: 1, step: 0.01, default: 0.5, tip: 'Shapes the driver before it hits the ramp. Low = crushed toward the first stops. High = lifted toward the last stops. 0.5 = linear.' },
    ],
    toggles: [
      { key: 'driver', label: 'Driver', default: 0, options: [
        { value: 0, label: 'Luma',  tip: 'Brightness drives the ramp. Dark pixels → first stop, bright → last.' },
        { value: 1, label: 'Inv',   tip: 'Inverted brightness drives the ramp. Bright pixels → first stop.' },
        { value: 2, label: 'Sat',   tip: 'Saturation drives the ramp. Grey pixels → first stop, vivid → last.' },
        { value: 3, label: 'Edge',  tip: 'Edge magnitude drives the ramp. Flat areas → first stop, edges → last.' },
        { value: 4, label: 'Radial',tip: 'Distance from frame center drives the ramp. Center → first stop, corners → last.' },
      ]},
    ],
    colors: [
      { key: 'stop0', label: 'Stop 1', default: '#050814', tip: 'First ramp stop — the floor (driver = 0).' },
      { key: 'stop1', label: 'Stop 2', default: '#2b1b6b', tip: 'Second ramp stop (driver ≈ 0.33).' },
      { key: 'stop2', label: 'Stop 3', default: '#c93f9b', tip: 'Third ramp stop (driver ≈ 0.66).' },
      { key: 'stop3', label: 'Stop 4', default: '#cfe9ff', tip: 'Last ramp stop — the peak (driver = 1).' },
    ],
    order: ['driver', 'bands', 'gamma'],
  },
};


// ============================================================
// FX RACK — 3-slot rack of post/texture stages running AFTER the COLOR
// stage + GRADE (signal flow: STRUCTURE → COLOR → GRADE → FX RACK).
// Two kinds of effect live here, distinguished by the `feedback` flag:
//   - feedback: true  — stateful temporal passes in glFx.js; each slot keeps
//     a persistent feedback texture between frames (flowfield).
//   - no flag (stateless) — single-frame signal/texture passes whose shaders
//     live in glFilters.js FRAGS (bloom, CRT, grain, etc). Same dispatch as
//     COLOR effects, just racked after the color stage.
// `order` maps slot params to the shader's uParams.xyzw, exactly like
// COLOR_PARAM_SCHEMAS.
// ============================================================
export const FX_PARAM_SCHEMAS = {
  flowfield: {
    feedback: true,
    knobs: [
      { key: 'speed',   label: 'Flow',    min: 0, max: 1, step: 0.01, default: 0.4, tip: 'Flow speed. How far pixels advect along the luma-gradient flow field each frame. 0 = static. 1 = fast swirling drift.' },
      { key: 'persist', label: 'Persist', min: 0, max: 1, step: 0.01, default: 0.9, tip: 'Trail persistence. How much of the previous frame\'s trails carries forward. Near 1 = long-lived accumulating trails. Low = trails die in a few frames.' },
      { key: 'bright',  label: 'Bright',  min: 0, max: 1, step: 0.01, default: 0.3, tip: 'Trail brightness. How strongly gradient edges inject new energy into the trail buffer each frame.' },
      { key: 'blend',   label: 'Blend',   min: 0, max: 1, step: 0.01, default: 0.5, tip: 'Source blend. 0 = pure trail field. 1 = source image with trails layered over it.' },
    ],
    toggles: [],
    order: ['speed', 'persist', 'bright', 'blend'],
  },
  bloom: {
    knobs: [
      { key: 'thresh',  label: 'Thresh', min: 0, max: 1, step: 0.01, default: 0.5, control: 'slider', tip: '0 = everything glows. 1 = only the brightest areas bloom.' },
      { key: 'intens',  label: 'Intens', min: 0, max: 1, step: 0.01, default: 0.5, control: 'slider', tip: '0 = subtle haze. 1 = blazing glow.' },
      { key: 'blue',    label: 'Blue',   min: 0, max: 1, step: 0.01, default: 0.3, tip: '0 = natural color bloom. 0.5 = blue neon tint. 1 = deep blue energy.' },
      { key: 'radius',  label: 'Radius', min: 0, max: 1, step: 0.01, default: 0.4, control: 'slider', tip: '0 = tight glow close to source. 1 = wide soft bloom.' },
    ],
    toggles: [],
    order: ['thresh', 'intens', 'blue', 'radius'],
  },
  decayflow: {
    knobs: [
      { key: 'speed',  label: 'Speed',  min: 0, max: 1, step: 0.01, default: 0.4, tip: 'Flow advection speed. How fast pixels drift along the gradient field.' },
      { key: 'persist',label: 'Persist',min: 0, max: 1, step: 0.01, default: 0.6, tip: 'Trail persistence. How much of the previous advected state carries forward.' },
      { key: 'bright', label: 'Bright', min: 0, max: 1, step: 0.01, default: 0.3, tip: 'Trail brightness boost on gradient edges.' },
      { key: 'blend',  label: 'Blend',  min: 0, max: 1, step: 0.01, default: 0.5, tip: '0 = pure trail. 1 = source mixed with trail.' },
    ],
    toggles: [],
    order: ['speed', 'persist', 'bright', 'blend'],
  },
  feedbackwarp: {
    knobs: [
      { key: 'warp',    label: 'Warp',    min: 0, max: 1, step: 0.01, default: 0.4, tip: 'Warp strength. How far pixels displace along the gradient direction per frame.' },
      { key: 'persist', label: 'Persist', min: 0, max: 1, step: 0.01, default: 0.7, tip: 'Persistence of the warped state. High = long trails and drips.' },
      { key: 'inject',  label: 'Inject',  min: 0, max: 1, step: 0.01, default: 0.3, tip: 'Source injection. How much of the original frame is re-injected to prevent total blur.' },
      { key: 'mode',    label: 'Mode',    min: 0, max: 1, step: 0.01, default: 0,   tip: '0 = gradient warp. 0.5 = rotational warp. 1 = radial warp outward from center.' },
    ],
    toggles: [],
    order: ['warp', 'persist', 'inject', 'mode'],
  },
  crt: {
    knobs: [
      { key: 'phosphor', label: 'Phosphor', min: 0, max: 1, step: 0.01, default: 0.3, tip: '0 = clean. 1 = visible RGB phosphor subpixel grid.' },
      { key: 'bloom',    label: 'Bloom',    min: 0, max: 1, step: 0.01, default: 0.3, tip: '0 = sharp. 1 = bright areas bleed and glow.' },
      { key: 'barrel',   label: 'Barrel',   min: 0, max: 1, step: 0.01, default: 0.4, tip: '0 = flat. 1 = curved CRT screen barrel distortion.' },
      { key: 'scanline', label: 'Scanline', min: 0, max: 1, step: 0.01, default: 0.3, tip: '0 = no scanlines. 1 = heavy dark horizontal lines.' },
    ],
    toggles: [],
    order: ['phosphor', 'bloom', 'barrel', 'scanline'],
  },
  crtrolling: {
    knobs: [
      { key: 'freq',   label: 'Freq',   min: 0, max: 1, step: 0.01, default: 0.3, tip: '0 = single giant wave. 1 = tight rapid rippling.' },
      { key: 'amp',    label: 'Amp',    min: 0, max: 1, step: 0.01, default: 0.4, tip: 'Horizontal displacement amplitude. 0 = none. 1 = heavy distortion.' },
      { key: 'lumod',  label: 'LuMod',  min: 0, max: 1, step: 0.01, default: 0.5, tip: 'Luma modulation. 0 = uniform wave. 1 = bright areas wobble more.' },
      { key: 'speed',  label: 'Speed',  min: 0, max: 1, step: 0.01, default: 0.3, tip: 'Rolling speed. 0 = static wave. 1 = fast rolling.' },
    ],
    toggles: [],
    order: ['freq', 'amp', 'lumod', 'speed'],
  },
  scanlines: {
    knobs: [
      { key: 'density',  label: 'Density',  min: 0, max: 1, step: 0.01, default: 0.3, tip: 'Line density (100–800 lines). Low = coarse VHS. High = fine CRT.' },
      { key: 'darkness', label: 'Darkness', min: 0, max: 1, step: 0.01, default: 0.5, tip: 'How dark the scanlines are. 0 = invisible. 1 = heavy black lines.' },
      { key: 'jitter',   label: 'Jitter',   min: 0, max: 1, step: 0.01, default: 0.2, tip: 'Per-row horizontal jitter. 0 = stable. 1 = wobbly analog VHS.' },
      { key: 'rgb',      label: 'RGB',      min: 0, max: 1, step: 0.01, default: 0,   tip: 'RGB channel offset per row. 0 = none. 1 = full chroma fringing.' },
    ],
    toggles: [],
    order: ['density', 'darkness', 'jitter', 'rgb'],
  },
  degrade: {
    knobs: [
      { key: 'bitdepth', label: 'Bits',    min: 0, max: 1, step: 0.01, default: 0.3, tip: '0 = clean 24-bit. 1 = extreme 2-bit posterization.' },
      { key: 'dither',   label: 'Dither',  min: 0, max: 1, step: 0.01, default: 0.3, tip: '0 = hard banding. 1 = noise dithering softens quantization edges.' },
      { key: 'bleed',    label: 'Bleed',   min: 0, max: 1, step: 0.01, default: 0.2, tip: '0 = clean channels. 1 = R and B bleed into neighbors.' },
      { key: 'pixelate', label: 'Pixelate',min: 0, max: 1, step: 0.01, default: 0.2, tip: '0 = full resolution. 1 = chunky pixelated macroblocks.' },
    ],
    toggles: [],
    order: ['bitdepth', 'dither', 'bleed', 'pixelate'],
  },
  noise: {
    knobs: [
      { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.4, control: 'slider', tip: 'Grain amount. 0 = clean. 1 = heavy noise.' },
      { key: 'size',   label: 'Size',   min: 0, max: 1, step: 0.01, default: 0.2, control: 'slider', tip: 'Grain size. 0 = fine 35mm. 1 = chunky 8mm.' },
      { key: 'shadow', label: 'Shadow', min: 0, max: 1, step: 0.01, default: 0.5, tip: 'Shadow bias. 0 = uniform grain. 1 = heavier grain in dark areas.' },
      { key: 'color',  label: 'Color',  min: 0, max: 1, step: 0.01, default: 0,   tip: '0 = monochromatic grain. 1 = RGB color noise.' },
    ],
    toggles: [],
    order: ['amount', 'size', 'shadow', 'color'],
  },
};

export const FX_SECTIONS = [
  'flowfield', 'bloom', 'decayflow', 'feedbackwarp',
  'crt', 'crtrolling', 'scanlines', 'degrade', 'noise',
];

// ============================================================
// TRACK FX RACK — same 3-slot pattern as colorRack but for the spec's
// three TRACK-mode effects (echo blobs / radar sweep / heatmap residue).
// Each slot has the same shape (id, type, enabled, params); the picker,
// schemas, and dispatch are independent.
// ============================================================
export const TRACK_FX_PARAM_SCHEMAS = {
  echo: {
    knobs: [
      { key: 'depth',   label: 'Depth',   min: 1, max: 10, step: 1,    default: 4,   control: 'slider', tip: 'How many past blob positions show. 1 = single ghost. 10 = long fading trail of bbox echoes.' },
      { key: 'opacity', label: 'Opacity', min: 0, max: 1,  step: 0.01, default: 0.5, control: 'slider', tip: 'Visibility of the echo bboxes. 0 = invisible. 1 = full strength echoes.' },
      { key: 'decay',   label: 'Decay',   min: 0, max: 1,  step: 0.01, default: 0.5, tip: 'Falloff curve. 0 = chunky (equal opacity per echo step). 1 = smooth exponential taper.' },
      { key: 'offset',  label: 'Offset',  min: 0, max: 1,  step: 0.01, default: 0,   tip: '0 = echoes sit exactly where the blob was. 1 = scaled-down or scaled-up slightly per step (depth pulse).' },
    ],
    order: ['depth', 'opacity', 'decay', 'offset'],
  },
  radar: {
    knobs: [
      { key: 'speed',      label: 'Speed', min: 0, max: 1, step: 0.01, default: 0.4, tip: 'Rotation speed of the sweep arm.' },
      { key: 'trail',      label: 'Trail', min: 0, max: 1, step: 0.01, default: 0.4, control: 'slider', tip: 'How long blobs persist after the sweep crosses them. 0 = brief flash. 1 = lingering glow.' },
      { key: 'sweepWidth', label: 'Width', min: 0, max: 1, step: 0.01, default: 0.3, control: 'slider', tip: 'Width of the rotating arc. 0 = laser line. 1 = wide pie-slice.' },
      { key: 'direction',  label: 'Dir',   min: -1, max: 1, step: 0.01, default: 1,   tip: '-1 = sweeps counterclockwise. 0 = oscillates back and forth. +1 = sweeps clockwise.' },
    ],
    order: ['speed', 'trail', 'sweepWidth', 'direction'],
  },
  heatmap: {
    knobs: [
      { key: 'intensity', label: 'Int',    min: 0, max: 1, step: 0.01, default: 0.6, control: 'slider', tip: 'Visibility of the heatmap layer.' },
      { key: 'decay',     label: 'Decay',  min: 0, max: 1, step: 0.01, default: 0.3, control: 'slider', tip: 'How quickly old positions fade. 0 = forever. 1 = quick.' },
      { key: 'spread',    label: 'Spread', min: 0, max: 1, step: 0.01, default: 0.4, control: 'slider', tip: 'Radius of the glow around each blob position. Low = pinpoint. High = wide bloom.' },
      { key: 'palette',   label: 'Pal',    min: 0, max: 1, step: 0.01, default: 0,   tip: '0 = thermal (red-yellow-white). 0.5 = cool (blue-cyan-white). 1 = rainbow.' },
    ],
    order: ['intensity', 'decay', 'spread', 'palette'],
  },
};

export const STRUCTURE_SECTIONS = ['ascii', 'erode', 'watershed', 'pixelsort', 'melt'];
// The MAPS tab of the COLOR picker — pure per-pixel color mapping (ramps,
// grades, palette swaps; no neighbor sampling, no added elements). Adding a
// map here (plus its schema/shader/label entries) is all the picker needs;
// the grid is built from this list at startup.
export const COLOR_MAP_SECTIONS = [
  'oxide','synth','biolum','thermo','falsecolor',
  'acidwash','xray','solarize','cyanotype','infrared',
];
// The UNIQUE tab — effects that BUILD something: they sample neighbors, add
// elements (stars, halos, streaks), displace, or glow. Grouped into labeled
// categories rendered as in-grid headers; categories are seeded buckets for
// future TouchDesigner ports — add an effect to a category (or add a new
// category row) and the grid builds itself. Still stateless single-frame
// passes: anything that needs to ACCUMULATE across frames belongs in the
// FX RACK instead.
export const COLOR_UNIQUE_SECTIONS = [
  { key: 'atmosphere', label: 'Atmosphere', effects: ['nebula', 'aurorastorm', 'deepfield'] },
  { key: 'light',      label: 'Light',      effects: ['neontube', 'prismatic', 'heatbleed'] },
  { key: 'dimension',  label: 'Dimension',  effects: ['depthstack'] },
];
export const COLOR_UNIQUE_FLAT = COLOR_UNIQUE_SECTIONS.flatMap((c) => c.effects);
// Every valid value of state.color (except 'none'): maps + unique effects +
// the CUSTOM tab's ChromaEngine. Validation/migration checks against this.
export const COLOR_SECTIONS = [...COLOR_MAP_SECTIONS, ...COLOR_UNIQUE_FLAT, 'chroma'];

// No GL_RESETS: all current structure effects are stateless single-frame ops.
export const GL_RESETS = {};

// Per-effect display blend mode used by compositeToCanvas2D when blitting
// the shared GL canvas onto the 2D display canvas (which already has the
// raw video drawn). Everything is 'source-over' — effects opaque-replace the
// video. Surfaced here so the orchestrator can pick the right blend per active
// effect, and so the chain applies the terminal-stage rule correctly.
export const BLEND_MODES = {
  ascii:        'source-over',
  erode:        'source-over',
  watershed:    'source-over',
  pixelsort:    'source-over',
  melt:         'source-over',
  oxide:        'source-over',
  synth:        'source-over',
  biolum:       'source-over',
  thermo:       'source-over',
  falsecolor:   'source-over',
  depthstack:   'source-over',
  prismatic:    'source-over',
  acidwash:     'source-over',
  xray:         'source-over',
  heatbleed:    'source-over',
  nebula:       'source-over',
  solarize:     'source-over',
  aurorastorm:  'source-over',
  cyanotype:    'source-over',
  infrared:     'source-over',
  neontube:     'source-over',
  deepfield:    'source-over',
  decayflow:    'source-over',
  feedbackwarp: 'source-over',
  bloom:        'source-over',
  crtrolling:   'source-over',
  noise:        'source-over',
  scanlines:    'source-over',
  degrade:      'source-over',
  crt:          'source-over',
  chroma:       'source-over',
  // Internal GRADE pass (hue rotate + saturation) — auto-appended after the
  // COLOR stage by resolveActivePipeline; never appears in any picker.
  grade:        'source-over',
  flowfield:    'source-over',
};

// ---- Factory functions ----

// Build a fresh factory-defaults params object for a COLOR effect type.
// Seeds colorParams[type] the first time an effect is picked. Includes
// knob/toggle numeric defaults AND `colors` hex-string defaults (chroma's
// ramp stops).
export function makeFactoryParams(type) {
  const schema = COLOR_PARAM_SCHEMAS[type];
  if (!schema) return {};
  const p = {};
  for (const k of schema.knobs)        p[k.key] = k.default;
  for (const t of schema.toggles)      p[t.key] = t.default;
  for (const c of schema.colors || []) p[c.key] = c.default;
  return p;
}

// Per-instance slot ids. Used as DOM keys + drag-and-drop identity. Stable
// across re-renders so dragging a slot doesn't recreate its DOM mid-drag.
// (Also used as timeline segment ids.)
export function makeSlotId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `slot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function makeFxFactoryParams(type) {
  const schema = FX_PARAM_SCHEMAS[type];
  if (!schema) return {};
  const p = {};
  for (const k of schema.knobs)   p[k.key] = k.default;
  for (const t of schema.toggles) p[t.key] = t.default;
  return p;
}

export function makeFxRack() {
  return Array.from({ length: RACK_SLOTS }, () => ({
    id: makeSlotId(),
    type: 'none',
    enabled: false,
    params: {},
  }));
}

export function makeTrackFxFactoryParams(type) {
  const schema = TRACK_FX_PARAM_SCHEMAS[type];
  if (!schema) return {};
  const p = {};
  for (const k of schema.knobs) p[k.key] = k.default;
  return p;
}

export function makeTrackFxRack() {
  return Array.from({ length: RACK_SLOTS }, () => ({
    id: makeSlotId(),
    type: 'none',
    enabled: false,
    params: {},
  }));
}
