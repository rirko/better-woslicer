# woslicer-electron

**English** · [中文说明](README.zh-CN.md)

An Electron + TypeScript reimplementation of **woslicerIII** (wosderge's BMS wav
slicer), aiming for byte-exact compatibility with the original `.wos` format and
slice rendering DSP.

The DSP, time base, `.wos` layout and BMSE clipboard format were recovered by
disassembling the original `woslicerIII.exe` (.NET IL) and verified against the
original program's own exported sample set (`../woslicerIII/new/KEY.wos` +
`KEY_000.wav` … `KEY_148.wav`): **the automated test suite re-renders all 149
oracle slices byte-identically** (see `tests/oracle.test.ts`).

## Screenshots

Horizontal DAW-style timeline with the L/R waveform, measure grid and
transport:

![timeline](screenshots/timeline.png)

Box selection over multiple cut points (Shift adds, Ctrl toggles, drag moves
the whole group):

![markers selection](screenshots/markers-selection.png)

Output tab: slice naming, FF numbering rule, BMSE clipboard, `.wos`
save/load, edge detection:

![output settings](screenshots/output-settings.png)

## Requirements

- Node.js 22+ (built and tested on Node 24, Windows x64)
- npm (network access on first install)

Electron's binary download falls back to a mirror when GitHub is unreachable:

```sh
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node node_modules/electron/install.js
```

## Commands

```sh
npm install            # dependencies (electron, typescript, ogg-vorbis wasm)
npm run typecheck      # strict TS check of both main and renderer configs
npm test               # build + unit tests (node:test) incl. the oracle test
npm run test:oracle    # only the byte-exact oracle verification
npm start              # build everything and launch the app
node scripts/smoke-gui.js   # end-to-end GUI smoke test (launches Electron)
```

`npm test` automatically picks up the repository's own oracle files when
`../woslicerIII/{KEY.wav,new}` exist; otherwise those specific tests are
skipped. All other tests use small deterministic in-memory fixtures.

## Product scope

- Strict woslicerIII compatibility: single BPM, single source / single track,
  horizontal DAW timeline, 192 ticks per measure, 49152 ticks total.
- Loads WAV (PCM 8/16/24/32-bit + IEEE float) and OGG Vorbis.
- Reads/writes `.wos` (exact 6168-byte layout), exports slice WAVs and the full
  slice set, reads/writes the `BMSE ClipBoard Object Data Format` clipboard.
- Playback / pause / stop / slice preview, Enter "break point" while playing or
  stopped, box selection, multi-select drag, quantize, measure copy/paste,
  undo/redo.
- One exact line set everywhere: ruler ticks, waveform grid lines and snap
  targets are the same positions — true multiples of the current grid, with
  measure lines (multiples of 192) highlighted. Zooming never invents units:
  when a grid cell drops below 2px the subdivisions collapse to the (still
  exact) measure lines, and measure number labels double their interval
  instead of moving off the measure positions.
- Variable-speed monitoring: 0.25x / 0.5x / 0.75x / 1.0x / 1.5x via the
  transport Rate select or the `[` / `]` keys. The rate only affects what you
  hear — marker ticks, slice lengths and exports are always computed at source
  time 1x, and the playhead position never jumps when the rate changes.
- Cue monitor (off / cowbell / triangle / metronome), synthesized with Web
  Audio, monitor-only — never written into exports.
- Band overlay (`Bands`): the L/R lanes can additionally show the low / mid /
  high envelopes on the same track — Low `#B18CFF` solid, Mid `#A8D46A`
  dashed, High `#F08FB4` thick solid, on a fixed 250 Hz / 4 kHz split. Display
  only: it never changes playback, markers or exports.
- Band detect (Cuts tab): places cut points where the selected bands' loudness
  rises by at least X dB (default +6.0 dB, range +1.0…+24.0). The rise is
  measured either against the previous 10 ms frame (fast attack — catches short
  percussive hits) or against the 20th-percentile level of the previous 200 ms
  (robust for noise-like bands), and must hold for 20 ms. Bands whose RMS sits
  below -60 dBFS are treated as silent and never cut, so a High-only detection
  on a low-frequency mix does not mark inaudible noise. Hits snap to the
  current Grid by default; untick **Snap to grid** to place them at the exact
  onset tick — with a coarse grid (e.g. 4 = 324 ms per cell at 185 BPM)
  snapping can move a sharp attack onto its decay, and cells merge several
  onsets into one. `Min gap` (1/2/4/8 grid cells) thins dense hits, existing
  markers are skipped, detection only ever ADDS and commits as ONE undo step.
  With a blue time-range selection the detection is limited to that range.
- Mouse model: left click/drag paints cut points, right click/sweep erases
  them, Shift/Ctrl + left drag box-selects (Shift adds, Ctrl toggles), and a
  left press on an existing cut point still drags the selection group.
- Tap calibration (`Calibrate` in the transport bar): plays **continuous**
  quarter-note clicks at the current BPM (no beat limit); tap `Enter`, `,` or
  `.` on every click and the median offset (ms, with mean and standard
  deviation) updates live. **Finish** freezes the result, **Apply** subtracts
  it from break points placed during playback — compensating audio-output
  latency, reaction time and key-input delay. The applied offset is shown next
  to the button and is session-only (never written into `.wos`).

## Keyboard reference

Preserved from the original (semantics from readme/help + decompiled handlers):

| Key | Action |
| --- | --- |
| ← → | move cursor by grid step |
| ↑ ↓ | move cursor by measure |
| Z | place / remove cut line at cursor |
| P | preview slice at cursor |
| O | preview previous slice |
| Q / W | grid size down / up (1/2/4/6/8/12/16/24/32; 1 = whole measure per cell, 2 = half measure) |
| M | export all slices |
| V | BMSE clipboard out |
| B | BMSE clipboard in |
| A / S | output clip start number -1 / +1 |
| N | toggle FF numbering rule |
| T / Y | save / load `.wos` |
| C | clear all cut lines |
| 7 / 8 | shift all cut lines -1 / +1 tick |
| Ctrl+C / Ctrl+X / Ctrl+V | copy / cut / paste the SELECTED markers as a relative group |
| Ctrl+F | legacy alias: paste one measure of markers (original semantics, also in the Edit menu) |

The selection clipboard stores RELATIVE tick offsets (origin = smallest
selected tick). Pasting anchors the group origin at the cursor tick, preserves
relative spacing, rejects the whole group on out-of-range targets or collision
with foreign markers (idempotent re-paste at the clipboard origin is allowed),
and auto-selects the pasted markers. It is fully separate from the BMSE system
clipboard. Quantize acts ONLY on the selection; the Quantize button is
disabled without a selection. Multi-drag uses one shared clamped delta so
relative spacing can never break.

New additions (context-scoped, per spec):

| Key | Action |
| --- | --- |
| Space | play / pause in every state (never places a marker) |
| Enter | place a break point without changing the play state: playing → marker at the tick computed back from the playhead sample · stopped → marker at the cursor and the playhead synced to it |
| Alt+Enter | same, but bypasses snapping for that placement (free drop at the exact position) |
| [ / ] | monitor playback rate down / up (0.25× → 0.5× → 0.75× → 1.0× → 1.5×, clamped at the endpoints with a status-bar hint) |
| Shift+← / → | cursor by single tick |
| Ctrl+V | paste (alias of the original Ctrl+F) |
| Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y | undo / redo |
| Esc | clear selection |
| Ctrl+wheel / ruler wheel | zoom anchored at mouse tick |
| middle drag | pan |

Mouse editing:

| Input | Action |
| --- | --- |
| left click / drag on empty space | paint cut points (one per grid cell crossed; single click adds one) |
| Alt + left paint | same, but bypasses snapping for that gesture |
| left press on a cut point (≤10px) | drag the selection group (unselected point becomes the selection; Alt = 1-tick precision) |
| right click / sweep | erase cut points within an 8px brush |
| Shift / Ctrl + left drag | box selection (Shift adds, Ctrl toggles) |

Paint and erase commit as **one undo step per gesture**; Esc cancels an
in-progress gesture and restores the bitmap it started from. Hover cursors:
`copy` = paint, `ew-resize` = grab a cut point, `crosshair` = box select,
`no-drop` = erase. Band detect parameters live in the collapsible
**Band detect** block at the top of the Cuts tab (band chips, Rise threshold,
Min gap, live `+N` estimate, scope line, Detect button).

Break points (Enter, in either play state) respect the **Snap** toggle and the
**Grid** density: with Snap on the marker lands on the nearest grid tick, and
holding **Alt** while pressing Enter bypasses snapping to drop at the exact
position. The cursor and playhead follow the final (snapped) position;
re-placing on a tick that already holds a break point is a no-op with a
status-bar hint.

**Intentional change vs the original:** the original previewed a slice on
Enter. Enter now places a break point instead (the old Space behaviour), and
Space is reserved for play/pause in every state. Slice preview is still
available on **P** (and O for the previous slice). Preview always plays at 1×;
the monitor rate applies only to whole-track playback, survives pause/stop,
and marker ticks / slice lengths / exports are always source-time 1×.

Focus rules: inputs, selects and dialogs never trigger single-key actions;
Space and Enter on a focused button activate that button.

## Architecture

```
src/core/     pure modules (no Electron, fully unit-tested)
  wav.ts        RIFF chunk walker, PCM 8/16/24/32 + float decode, canonical writer
  ogg.ts        OGG Vorbis via @wasm-audio-decoders/ogg-vorbis (WASM)
  wos.ts        .wos read/write (6168 bytes, MSB-first bitmap, validation)
  timebase.ts   tick<->sample conversions (float64 export path, float32 view path)
  slicer.ts     woswrite/Cut/safe_data ports: fade-in, copy, sustain, gate, pad
  markers.ts    marker document: edit ops, quantize, measure clipboard, undo
  bmse.ts       BMSE clipboard format build/parse
  peaks.ts      hierarchical peak cache (drawing never rescans the file)
  edge.ts       RMS edge detection (original heuristic)
src/main/     Electron main process, IPC handlers, preload (contextBridge)
src/renderer  UI (no frameworks): canvas timeline, transport, cue synth, keys
tests/        node:test suites (see Test coverage)
docs/EXTRACTED_SPEC.md   the decompiled reference semantics
```

Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
strict CSP, navigation/new-window blocked, preload exposes exactly 16
allowlisted functions (`tests/ipc-security.test.ts` asserts the surface).

## Verified behaviour (what the tests prove)

- `.wos`: fixed 6168 bytes, little-endian doubles/int32 header, MSB-first
  bitmap, full round-trip, truncated/corrupt input rejected, noisegate saved
  only as an integer (never silently truncated).
- Time base: BPM 120/185, positive/negative shift, EOF fallback, float32 view
  conversion vs float64 export conversion.
- DSP: fade-in envelope (integer-degree sine), 16-frame zero pad, Cut gate
  (threshold `32768/2^(dB/-6)`, Math.cos decay over 11025, `NULL` 4-frame
  collapse, dB=0 truncation), sustain tail with foldback + phase inversion,
  out-of-bounds reads return 0, canonical deterministic WAV header (including
  the original's `v >= 32678` guard, which is byte-transparent).
- **Oracle: all 149 original exported slices re-render byte-identical.**
- Markers: idempotent placement (Enter break-point de-dup), box select,
  multi-drag with merge/clamp, quantize with collision collapse, measure
  copy/cut/paste, undo/redo, whole-map shift.
- BMSE: exact format name, `101` + 8-digit tick + number lines, FF skip rule,
  internal clipboard isolation.
- WAV/OGG: chunk walking with JUNK/smpl/LIST, all bit depths, error paths.
- IPC: allowlist surface, path/request validation before IO.
- Keys/rate: focus gating (Space/Enter native on buttons, dead in fields),
  rate ladder stepping with endpoint clamping, rate re-anchor sample math
  (position continuity across rate switches), playhead↔tick inversion.
- GUI smoke (`scripts/smoke-gui.js`): boots, loads a WAV via drag & drop,
  edits markers with the keyboard, plays with Space, drops an Enter break
  point mid-playback, steps the rate with `[` / `]`, round-trips BMSE/WOS,
  paints the waveform, and widens the viewport via a CDP device-metrics
  override to prove every canvas layer (plus a pure devicePixelRatio change)
  resizes and repaints across the full new width.

## Known limitations / deviations

- **Key deviations (intentional)**: the original previewed on Enter and dropped
  a Space break point while playing. This build binds Space to play/pause in
  every state and Enter to place break points (preview stays on P/O), and adds
  the 0.25×–1.5× monitor rate (the original had no variable-speed playback).

- **UI languages**: English, 中文, 日本語 and 한국어 cover the chrome, the status
  messages and the native File/Edit/View/Help menu. The choice persists across
  restarts (localStorage + IPC to the main process). Technical field labels
  (BPM, Grid, Shift, Fade ms, Gate dB) stay untranslated on purpose so they
  read identically in every language.

- **24-bit output**: the original always exports 16-bit PCM and stores audio
  internally as int16; so does this project. 24-bit sources are converted
  lossily at load (top 16 bits), exactly like the original.
- **IEEE float WAV** decode is an extension; the original would have
  misinterpreted float files. 8/16/24-bit and 32-bit int PCM follow the
  original exactly.
- The original scanned for `fmt `/`data` bytes inside a 128-byte rolling
  buffer (crashing on large leading chunks). This implementation walks the
  RIFF chunk list instead — more robust, identical results for well-formed
  files. It also stops at the first `data` chunk, like the original.
- The original's auto "edge detection" ran on a low-resolution progress bar
  thread and is only approximately documented; `core/edge.ts` ports the RMS
  heuristic (window RMS ratio 1.5) but this is the one feature without an
  oracle to verify against.
- Preview playback uses the exact export DSP (like the original, which wrote
  `prev` and played it), but plays from memory via Web Audio instead of a
  temp file. The cue sounds are synthesized; the original had no cue feature.
- BMSE clipboard is written under the exact custom format name
  `BMSE ClipBoard Object Data Format` (Electron `ClipboardItem`, raw UTF-8
  bytes incl. trailing NUL) AND mirrored as `text/plain`, because the original
  BMSE reads the text format. Reading prefers the custom format and falls
  back to text.
- Export/save paths arrive from native dialogs; the renderer could send
  arbitrary strings, so IPC handlers shape-validate them (extension required,
  no `..` segments, no device namespaces, no control characters) and `.wos`
  saves are atomic (temp file + rename). Paths are not confined by opaque
  file IDs — a compromised renderer could still write a `.wav`/`.wos` to any
  user-writable path it can name; the dialog flow remains the trusted entry
  point.
- Export keeps the original's double-precision noisegate (`Cut(double dB,
  int msec)`); fractional dB is only rejected where the file format requires
  an integer (`.wos` save).
- OGG decoding uses a WASM Vorbis decoder instead of the original's
  `OggVorbis.dll`; the original's case-sensitive `.ogg` check is kept.
- `Math.sin`/`Math.cos` in the original resolved to the CRT (x87-era)
  implementations; the oracle test confirms V8's implementations agree on all
  149 slices, but a pathological future input within an ULP of a truncation
  boundary could theoretically differ by one quantization step.
- High-DPI: canvas drawing is device-pixel-ratio aware; the window geometry
  follows the frozen spec (1440x900 default, 960x600 minimum). The window
  keeps its native frame and forces the dark native theme
  (`nativeTheme.themeSource = "dark"`), so the title strip, the
  File/Edit/View/Help menu bar and the window controls all render dark
  instead of white. (`titleBarStyle: "hidden"` + `titleBarOverlay` was
  evaluated and rejected: on Windows it hides the native menu bar, and no
  menu-visibility API brings it back.)

## Credits

woslicer II/III is by **wosderge** (ahiruworks, http://ahiruworks.com/). This
project is an independent reimplementation built from format/algorithm
analysis — no original binaries, source code or audio assets are included or
redistributed. The original's license permits non-commercial secondary use
with attribution and forbids distributing modified versions of the original;
please keep use of this tool non-commercial and keep this attribution.
