/**
 * Application bootstrap: wires the store, timeline view, transport,
 * interactions, keyboard, IPC bridge and DOM controls together.
 */

import { api } from "./api.js";
import { buildBmseClipboard, parseBmseClipboard } from "../core/bmse.js";
import { markerTicks } from "../core/wos.js";
import { readWos, writeWos, WosFormatError } from "../core/wos.js";
import { buildPeakCache } from "../core/peaks.js";
import { detectEdges } from "../core/edge.js";
import { analyzeBands, BandAnalysis, BandName, BAND_NAMES } from "../core/bands.js";
import { detectBandCuts } from "../core/banddetect.js";
import { latencySamples } from "../core/calibration.js";
import { TapCalibrator } from "./calibration.js";
import {
  applyStaticTranslations,
  bandScopeRange,
  bandScopeWhole,
  getLanguage,
  initLanguage,
  setLanguage,
  translateStatus,
  tr,
  type Language,
} from "./i18n.js";
import { gridStepTicks } from "../core/gridlines.js";
import { MAX_TICKS, resolveBreakpointTick, sampleToTickNearest, tickToSampleExport } from "../core/timebase.js";
import { DEFAULT_PLAYBACK_RATE, formatRate, stepPlaybackRate } from "../core/rate.js";
import { Store } from "./store.js";
import { TimelineView } from "./waveform.js";
import { Transport } from "./transport.js";
import { Interactions } from "./interactions.js";
import { handleKeyDown, KeyActions } from "./keys.js";

const store = new Store();
const transport = new Transport(store);
const calibrator = new TapCalibrator(transport.getAudioContext());

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

const rulerCanvas = el<HTMLCanvasElement>("ruler-canvas");
const waveCanvas = el<HTMLCanvasElement>("wave-canvas");
const overlayCanvas = el<HTMLCanvasElement>("overlay-canvas");
const overviewCanvas = el<HTMLCanvasElement>("overview-canvas");
const waveWrap = el<HTMLDivElement>("wave-wrap");

const view = new TimelineView(store, rulerCanvas, waveCanvas, overlayCanvas, overviewCanvas);
const interactions = new Interactions(
  store,
  view,
  waveWrap,
  rulerCanvas,
  overviewCanvas,
  el<HTMLDivElement>("scrollbar"),
  el<HTMLDivElement>("scrollbar-thumb"),
  () => redraw(),
  (sample) => transport.seekSample(sample)
);

/* Scroll/zoom values the canvas layers were last drawn with. animate() compares
   them on every playing frame: follow-scroll during playback is the only path
   that moves scrollTick/pxPerTick without an explicit redraw(), and the frame
   after they move must repaint every layer, not just the overlay. NaN starts
   "dirty" so the first playing frame always paints. */
let lastDrawnScrollTick = Number.NaN;
let lastDrawnPxPerTick = Number.NaN;

/* Viewport the canvas layers were last drawn with. animate() compares these
   every frame as a cheap safety net: the ResizeObserver alone proved
   unreliable (it misses pure devicePixelRatio changes and was observed to
   leave the ruler/overview stale after viewport resizes), and a missed resize
   paints the old width with black to its right. NaN starts "dirty". */
let lastDrawnWidth = Number.NaN;
let lastDrawnHeight = Number.NaN;
let lastDrawnDpr = Number.NaN;

/* Grid density the canvas layers were last drawn with. The frame loop only
   repaints on viewport/scroll/zoom changes, so a Grid select or Q/W change
   would otherwise leave the ruler and the waveform showing the PREVIOUS cell
   width while snapping already used the new one — the "ruler does not match
   the grid" report. NaN starts "dirty" so the first change always repaints. */
let lastDrawnGrid = Number.NaN;

function viewportChanged(): boolean {
  const dpr = window.devicePixelRatio || 1;
  return (
    waveWrap.clientWidth !== lastDrawnWidth ||
    waveWrap.clientHeight !== lastDrawnHeight ||
    dpr !== lastDrawnDpr
  );
}

/** Canvas layers + scrollbar: everything that depends on scroll/zoom geometry. */
function redrawCanvases(): void {
  view.drawRuler();
  view.drawWave();
  view.drawOverlay(interactions.currentGhost());
  view.drawOverview();
  updateScrollbar();
}

function redraw(): void {
  redrawCanvases();
  lastDrawnScrollTick = store.state.scrollTick;
  lastDrawnPxPerTick = store.state.pxPerTick;
  lastDrawnWidth = waveWrap.clientWidth;
  lastDrawnHeight = waveWrap.clientHeight;
  lastDrawnDpr = window.devicePixelRatio || 1;
  lastDrawnGrid = store.state.grid;
  updateReadout();
  updateCutList();
  updateCommandStates();
  syncRateSelect();
  updateBandPanel();
}

/** Enables/disables commands that require a selection or a source. */
function updateCommandStates(): void {
  const hasSelection = store.state.selectedTicks.length > 0;
  el<HTMLButtonElement>("btn-quantize").disabled = !hasSelection;
  el<HTMLButtonElement>("btn-paste").disabled = !store.state.doc.selectionClipboard;
  el<HTMLButtonElement>("btn-export").disabled = store.state.exportLock;
}

function updateScrollbar(): void {
  const total = MAX_TICKS;
  const viewTicks = waveWrap.clientWidth / store.state.pxPerTick;
  const thumb = el<HTMLDivElement>("scrollbar-thumb");
  const left = (store.state.scrollTick / total) * 100;
  const width = Math.min(100, (viewTicks / total) * 100);
  thumb.style.left = `${left}%`;
  thumb.style.width = `${width}%`;
}

function updateReadout(): void {
  const s = store.state;
  const measure = Math.floor(s.cursorTick / 192) + 1;
  let text = `M${String(measure).padStart(3, "0")}  tick ${s.cursorTick}`;
  if (s.source) {
    const sec = s.playheadSample / s.source.sampleRate;
    const mm = Math.floor(sec / 60);
    const ss = (sec - mm * 60).toFixed(3).padStart(6, "0");
    text = `M${String(measure).padStart(3, "0")}  ${String(mm).padStart(2, "0")}:${ss}`;
  }
  el<HTMLSpanElement>("readout-position").textContent = text;
  el<HTMLSpanElement>("status-right").textContent = s.source
    ? `${s.source.name} · ${s.source.sampleRate}Hz · ${s.source.channels}ch · ${(s.source.length / s.source.sampleRate).toFixed(2)}s`
    : "";
}

function updateCutList(): void {
  const s = store.state;
  const list = el<HTMLUListElement>("cut-list");
  const ticks = markerTicks(s.doc.markers);
  const focusTick = s.cursorTick;
  list.innerHTML = "";
  const fragment = document.createDocumentFragment();
  ticks.forEach((tick, index) => {
    const li = document.createElement("li");
    if (tick === focusTick || s.selectedTicks.includes(tick)) li.className = "active";
    const name = document.createElement("span");
    name.textContent = `${s.baseName}_${String(index).padStart(3, "0")}`;
    const time = document.createElement("span");
    time.className = "cut-time";
    if (s.source) {
      const sec = tickToSampleExport(tick, { bpm: s.doc.bpm, shift: s.doc.shift, sampleRate: s.source.sampleRate }) / s.source.sampleRate;
      time.textContent = `${sec.toFixed(3)}s`;
    } else {
      time.textContent = `t${tick}`;
    }
    li.appendChild(name);
    li.appendChild(time);
    li.addEventListener("click", () => {
      store.update({ cursorTick: tick });
      redraw();
    });
    li.addEventListener("dblclick", () => {
      store.update({ cursorTick: tick });
      actions.previewAtCursor();
    });
    fragment.appendChild(li);
  });
  list.appendChild(fragment);
}

function setStatus(text: string, isError = false): void {
  store.setStatus(text, isError);
}

/**
 * [ / ] rate stepping: one notch of the frozen ladder per press, clamped at
 * 0.25x / 1.5x with a status-bar hint (no dialog). Re-anchoring happens in
 * transport.setRate so the playhead never jumps.
 */
function applyRateStep(direction: -1 | 1): void {
  const step = stepPlaybackRate(store.state.playbackRate, direction);
  transport.setRate(step.rate);
  store.setStatus(
    step.clamped
      ? direction < 0
        ? `Already slowest ${formatRate(step.rate)}`
        : `Already fastest ${formatRate(step.rate)}`
      : `Playback rate: ${formatRate(step.rate)}`
  );
  syncRateSelect();
}

/** Mirrors store.playbackRate into the transport select + highlight state. */
function syncRateSelect(): void {
  const select = el<HTMLSelectElement>("select-rate");
  select.value = String(store.state.playbackRate);
  const active = store.state.playbackRate !== DEFAULT_PLAYBACK_RATE;
  select.classList.toggle("rate-active", active);
  el<HTMLSpanElement>("rate-wrap").classList.toggle("rate-active", active);
}

/* ------------------------------------------------------------------ */
/* Band overlay + band detect                                          */
/* ------------------------------------------------------------------ */

let bandEstimateTimer: ReturnType<typeof setTimeout> | null = null;
let lastScopeKey = "";

/** Lazily computes the three-band analysis; cached until the next load. */
function ensureBandAnalysis(): Promise<BandAnalysis | null> {
  const s = store.state;
  if (!s.source) return Promise.resolve(null);
  if (s.bandAnalysis) return Promise.resolve(s.bandAnalysis);
  const source = s.source;
  store.setStatus("Analyzing bands…");
  return new Promise((resolve) => {
    // Let the status paint before the synchronous filter pass starts.
    setTimeout(() => {
      const analysis = analyzeBands(source.data, source.sampleRate);
      store.update({ bandAnalysis: analysis, bandEstimate: null });
      resolve(analysis);
    }, 30);
  });
}

/** Detection range: the blue time range if one exists, else the whole track. */
function bandRange(): { fromTick: number; toTick: number; hasRange: boolean } {
  const s = store.state;
  if (s.selectionStartTick !== null && s.selectionEndTick !== null) {
    const a = Math.min(s.selectionStartTick, s.selectionEndTick);
    const b = Math.max(s.selectionStartTick, s.selectionEndTick);
    return { fromTick: a, toTick: b, hasRange: true };
  }
  return { fromTick: 0, toTick: MAX_TICKS - 1, hasRange: false };
}

function selectedBands(): BandName[] {
  const s = store.state;
  return BAND_NAMES.filter((b) => s.bandDetectBands[b]);
}

function runBandDetect(analysis: BandAnalysis) {
  const s = store.state;
  const range = bandRange();
  return detectBandCuts({
    analysis,
    bands: selectedBands(),
    thresholdDb: s.bandThresholdDb,
    // state.grid is a density (cells per measure); detectBandCuts wants ticks.
    grid: gridStepTicks(s.grid),
    minGapTicks: s.bandMinGapUnits * gridStepTicks(s.grid),
    fromTick: range.fromTick,
    toTick: range.toTick,
    base: { bpm: s.doc.bpm, shift: s.doc.shift, sampleRate: s.source!.sampleRate },
    existing: new Set(markerTicks(s.doc.markers)),
    snap: s.bandSnap,
  });
}

/** Syncs the Band detect panel (scope line, estimate, chips, button state). */
function updateBandPanel(): void {
  const s = store.state;
  const scope = el<HTMLDivElement>("band-scope");
  const range = bandRange();
  if (range.hasRange && s.source) {
    const m0 = Math.floor(range.fromTick / 192) + 1;
    const m1 = Math.floor(range.toTick / 192) + 1;
    const seconds =
      ((range.toTick - range.fromTick) * s.source.sampleRate * 5) / (4 * s.doc.bpm) / s.source.sampleRate;
    scope.textContent = bandScopeRange(
      String(m0).padStart(3, "0"),
      String(m1).padStart(3, "0"),
      seconds.toFixed(2)
    );
    scope.classList.add("active");
  } else {
    scope.textContent = bandScopeWhole();
    scope.classList.remove("active");
  }
  const estimate = el<HTMLSpanElement>("band-estimate");
  if (s.bandEstimate === null) estimate.textContent = "";
  else if (s.bandEstimate > 999) estimate.textContent = "+999+";
  else estimate.textContent = `+${s.bandEstimate}`;
  const button = el<HTMLButtonElement>("btn-band-detect");
  button.disabled = !s.source || s.bandBusy || selectedBands().length === 0;
  button.textContent = tr(s.bandBusy ? "Detecting…" : "Detect");
  for (const chip of document.querySelectorAll<HTMLButtonElement>(".band-chip")) {
    chip.classList.toggle("on", s.bandDetectBands[chip.dataset.band as BandName]);
    chip.setAttribute("aria-pressed", String(s.bandDetectBands[chip.dataset.band as BandName]));
  }
}

function scheduleBandEstimate(): void {
  if (bandEstimateTimer) clearTimeout(bandEstimateTimer);
  const s = store.state;
  if (!s.source) {
    store.update({ bandEstimate: null });
    return;
  }
  bandEstimateTimer = setTimeout(() => {
    bandEstimateTimer = null;
    void ensureBandAnalysis().then((analysis) => {
      if (!analysis) return;
      const result = runBandDetect(analysis);
      store.update({ bandEstimate: result.ticks.length });
      updateBandPanel();
    });
  }, 150);
}

async function bandDetect(): Promise<void> {
  const s = store.state;
  if (!s.source) {
    store.setStatus("Band detect needs a loaded source", true);
    return;
  }
  if (!selectedBands().length) {
    store.setStatus("Band detect: select at least one band", true);
    return;
  }
  store.update({ bandBusy: true });
  updateBandPanel();
  store.setStatus("Detecting band onsets…");
  try {
    const analysis = await ensureBandAnalysis();
    if (!analysis) return;
    const threshold = store.state.bandThresholdDb;
    const result = runBandDetect(analysis);
    const added = store.state.doc.addTicks(result.ticks);
    const range = bandRange();
    const label = selectedBands()
      .map((b) => b[0].toUpperCase() + b.slice(1))
      .join("/");
    if (added === 0) {
      store.setStatus(`Band detect: 0 cuts · no rise ≥ +${threshold.toFixed(1)} dB`);
    } else {
      const parts = [`Band detect: +${added} cuts (${label} ≥ +${threshold.toFixed(1)} dB)`];
      if (range.hasRange) parts.push("in selection");
      parts.push("· 1 undo step");
      const notes: string[] = [];
      if (result.skippedGap) notes.push(`${result.skippedGap} skipped by min gap`);
      if (result.existing) notes.push(`${result.existing} already existed`);
      store.setStatus(parts.join(" ") + (notes.length ? ` · ${notes.join(" · ")}` : ""));
    }
    store.update({ bandEstimate: null });
    redraw();
  } finally {
    store.update({ bandBusy: false });
    updateBandPanel();
  }
}

/* ------------------------------------------------------------------ */
/* Tap calibration                                                     */
/* ------------------------------------------------------------------ */

let calibrationTimer: number | null = null;

function syncTapOffsetDisplay(): void {
  const ms = store.state.tapOffsetMs;
  el<HTMLSpanElement>("tap-offset").textContent =
    ms === 0 ? "" : `Offset ${ms > 0 ? "+" : ""}${ms} ms`;
}

function updateCalibrationUi(): void {
  el<HTMLSpanElement>("calibration-beat").textContent = String(calibrator.elapsedBeats());
  el<HTMLSpanElement>("calibration-taps").textContent = String(calibrator.tapCount());
}

/** Live statistics while the click train keeps running. */
function renderLiveCalibration(): void {
  const result = calibrator.currentResult();
  const box = el<HTMLDivElement>("calibration-result");
  box.dataset.median = String(result.medianMs);
  box.dataset.matched = String(result.matched);
  const apply = el<HTMLButtonElement>("btn-calibration-apply");
  if (result.matched === 0) {
    box.classList.add("hidden");
    apply.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  const sign = result.medianMs >= 0 ? "+" : "";
  box.textContent =
    `Taps ${result.matched}/${result.total} matched · median ${sign}${result.medianMs.toFixed(1)} ms · ` +
    `mean ${result.meanMs.toFixed(1)} ms · ±${result.stdMs.toFixed(1)} ms`;
  apply.classList.remove("hidden");
}

function closeCalibration(): void {
  calibrator.cancel();
  if (calibrationTimer !== null) {
    window.clearInterval(calibrationTimer);
    calibrationTimer = null;
  }
  el<HTMLDivElement>("calibration-modal").classList.add("hidden");
  store.setStatus("Calibration closed");
}

function finishCalibration(): void {
  if (calibrationTimer !== null) {
    window.clearInterval(calibrationTimer);
    calibrationTimer = null;
  }
  if (!calibrator.isActive()) return;
  const result = calibrator.finish();
  const box = el<HTMLDivElement>("calibration-result");
  box.classList.remove("hidden");
  box.dataset.median = String(result.medianMs);
  box.dataset.matched = String(result.matched);
  if (result.matched === 0) {
    box.textContent = `No taps matched (${result.total} tap(s) recorded) — restart and tap on the clicks.`;
    el<HTMLButtonElement>("btn-calibration-apply").classList.add("hidden");
  } else {
    const sign = result.medianMs >= 0 ? "+" : "";
    box.textContent =
      `Final: ${result.matched}/${result.total} taps · median ${sign}${result.medianMs.toFixed(1)} ms · ` +
      `mean ${result.meanMs.toFixed(1)} ms · ±${result.stdMs.toFixed(1)} ms`;
    el<HTMLButtonElement>("btn-calibration-apply").classList.remove("hidden");
  }
  updateCalibrationUi();
  store.setStatus("Tap calibration finished — Apply or Restart");
}

function startCalibration(): void {
  if (!store.state.source) {
    store.setStatus("Load a source first: calibration runs on the audio clock", true);
    return;
  }
  transport.stop();
  el<HTMLDivElement>("calibration-modal").classList.remove("hidden");
  el<HTMLSpanElement>("calibration-bpm").textContent = store.state.doc.bpm.toFixed(2);
  el<HTMLDivElement>("calibration-result").classList.add("hidden");
  el<HTMLButtonElement>("btn-calibration-apply").classList.add("hidden");
  void transport.getAudioContext().resume();
  // Continuous mode: clicks run until Finish/Close; the timer keeps the
  // 2-second look-ahead scheduler fed and refreshes the live statistics.
  calibrator.start(store.state.doc.bpm);
  updateCalibrationUi();
  if (calibrationTimer !== null) window.clearInterval(calibrationTimer);
  calibrationTimer = window.setInterval(() => {
    calibrator.ensureScheduled();
    updateCalibrationUi();
    renderLiveCalibration();
  }, 50);
  store.setStatus("Tap calibration: tap Enter / , / . on the clicks — Finish when stable");
}

// Single render path for the status bar: every store.setStatus (from actions,
// interactions, transport) flows through the subscription into the DOM.
let lastRenderedStatus = "";
let lastRenderedError: boolean | null = null;store.subscribe(() => {
  const s = store.state;
  if (s.statusText !== lastRenderedStatus || s.isError !== lastRenderedError) {
    lastRenderedStatus = s.statusText;
    lastRenderedError = s.isError;
    const bar = el<HTMLElement>("status-bar");
    bar.classList.toggle("error", s.isError);
    el<HTMLSpanElement>("status-main").textContent = translateStatus(s.statusText);
  }
  updateCommandStates();
  // Grid density changes the drawn line set AND the snap targets: repaint the
  // canvas layers so the ruler can never show a grid the clicks no longer use.
  if (s.grid !== lastDrawnGrid) {
    lastDrawnGrid = s.grid;
    redrawCanvases();
  }
  // A change of the blue time range re-scopes the band-detect estimate.
  const scopeKey = `${s.selectionStartTick}:${s.selectionEndTick}`;
  if (scopeKey !== lastScopeKey) {
    lastScopeKey = scopeKey;
    if (s.source) scheduleBandEstimate();
  }
});

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

async function loadFromPath(): Promise<void> {
  try {
    const path = await api().openAudioDialog();
    if (!path) return;
    store.update({ phase: "parsing" });
    setStatus("Parsing source file...");
    const info = await api().readAudioFile(path);
    applyLoadedAudio(info);
  } catch (err) {
    store.update({ phase: store.state.source ? "ready" : "empty" });
    setStatus(`Load failed: ${errorMessage(err)}`, true);
  }
}

async function loadFromDrop(file: File): Promise<void> {
  try {
    store.update({ phase: "parsing" });
    setStatus("Parsing dropped file...");
    const buffer = await file.arrayBuffer();
    const info = await api().decodeAudioBuffer(file.name, buffer);
    applyLoadedAudio(info);
  } catch (err) {
    store.update({ phase: store.state.source ? "ready" : "empty" });
    setStatus(`Drop failed: ${errorMessage(err)}`, true);
  }
}

function applyLoadedAudio(info: {
  path: string;
  name: string;
  sampleRate: number;
  channels: number;
  length: number;
  channelData: ArrayBuffer[];
}): void {
  const data = info.channelData.map((b) => new Int16Array(b));
  const floatData = data.map((ch) => {
    const out = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) out[i] = ch[i] / 32768;
    return out;
  });
  const peaks = buildPeakCache(data);
  // Export prefix follows the source name (the .wos/BMSE/wav writers all take
  // store.baseName); the old default "slice" only applies before any load.
  const baseName = info.name.replace(/[^\w.-]/g, "_") || "slice";
  store.update({
    phase: "ready",
    source: {
      path: info.path,
      name: info.name,
      sampleRate: info.sampleRate,
      channels: info.channels,
      length: info.length,
      data,
      floatData,
    },
    peaks,
    playheadSample: 0,
    baseName,
    bandAnalysis: null,
    bandEstimate: null,
  });
  el<HTMLInputElement>("input-basename").value = baseName;
  el<HTMLDivElement>("empty-hint").classList.add("hidden");
  el<HTMLSpanElement>("src-name").textContent = info.name;
  el<HTMLSpanElement>("src-format").textContent = `PCM 16-bit internal · ${info.channels}ch`;
  el<HTMLSpanElement>("src-length").textContent = `${info.length.toLocaleString()} frames`;
  el<HTMLSpanElement>("src-duration").textContent = `${(info.length / info.sampleRate).toFixed(3)}s`;
  transport.loadSource(floatData, info.sampleRate);
  setStatus(`Ready: ${info.name} (${info.sampleRate}Hz, ${info.channels}ch)`);
  redraw();
}

/* ------------------------------------------------------------------ */
/* WOS load / save                                                     */
/* ------------------------------------------------------------------ */

async function loadWos(): Promise<void> {
  try {
    const path = await api().openWosDialog();
    if (!path) return;
    const bytes = await api().readWosFile(path);
    const docData = readWos(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    store.state.doc.bpm = docData.bpm;
    store.state.doc.shift = docData.shift;
    store.state.doc.fadeoutMs = docData.fadeoutMs;
    store.state.doc.noisegateDb = docData.noisegateDb;
    store.state.doc.replaceBitmap(docData.markers);
    el<HTMLInputElement>("input-bpm").value = String(docData.bpm);
    el<HTMLInputElement>("input-shift").value = String(docData.shift);
    el<HTMLInputElement>("input-fade").value = String(docData.fadeoutMs);
    el<HTMLInputElement>("input-gate").value = String(docData.noisegateDb);
    store.setStatus(`Loaded ${path.split(/[\\/]/).pop()} (BPM ${docData.bpm}, shift ${docData.shift})`);
    redraw();
  } catch (err) {
    setStatus(`.wos load failed: ${errorMessage(err)}`, true);
  }
}

async function saveWos(): Promise<void> {
  const s = store.state;
  try {
    const suggested = `${s.source ? s.source.name : "untitled"}.wos`;
    const path = await api().saveWosDialog(suggested);
    if (!path) return;
    // The .wos field is int32: fractional dB values must be rejected, never
    // silently truncated (writeWos validates and throws WosFormatError).
    const bytes = writeWos({
      bpm: s.doc.bpm,
      shift: s.doc.shift,
      fadeoutMs: s.doc.fadeoutMs,
      noisegateDb: s.doc.noisegateDb,
      markers: s.doc.markers,
    });
    await api().writeWosFile(path, bytes);
    setStatus(`Saved ${path.split(/[\\/]/).pop()}`);
  } catch (err) {
    if (err instanceof WosFormatError) {
      setStatus(`Save blocked: ${err.message}`, true);
    } else {
      setStatus(`.wos save failed: ${errorMessage(err)}`, true);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

/**
 * Effective export gate: the checkbox mirrors the original DoPrev behaviour
 * (checkbox off => noisegate 0.0). The dB value itself stays a double, exactly
 * like the original Cut(double dB, int msec).
 */
function effectiveNoisegate(): number {
  const s = store.state;
  return s.noisegateEnabled ? s.doc.noisegateDb : 0;
}

async function exportAll(): Promise<void> {
  const s = store.state;
  if (!s.source) {
    setStatus("Nothing to export: load a source first", true);
    return;
  }
  const ticks = markerTicks(s.doc.markers);
  if (!ticks.length) {
    setStatus("Nothing to export: no markers placed", true);
    return;
  }
  try {
    const dir = await api().exportAllDialog(s.source.path);
    if (!dir) return;
    store.update({ exportLock: true });
    setStatus(`Exporting ${ticks.length} slices...`);
    const result = await api().exportAll({
      dirPath: dir,
      baseName: s.baseName,
      bpm: s.doc.bpm,
      shift: s.doc.shift,
      fadeoutMs: s.doc.fadeoutMs,
      noisegateDb: effectiveNoisegate(),
      markers: ticks,
    });
    setStatus(`Exported ${result.written.length} slices to ${dir}`);
  } catch (err) {
    const message = errorMessage(err);
    setStatus(
      message.includes("missing on disk") ? `Source file missing: ${message}` : `Export failed: ${message}`,
      true
    );
  } finally {
    store.update({ exportLock: false });
    redraw();
  }
}

async function exportSliceAtCursor(): Promise<void> {
  const s = store.state;
  if (!s.source) {
    setStatus("Nothing to export: load a source first", true);
    return;
  }
  const ticks = markerTicks(s.doc.markers);
  if (!ticks.length) {
    setStatus("Nothing to export: no markers placed", true);
    return;
  }
  const base = { bpm: s.doc.bpm, shift: s.doc.shift, sampleRate: s.source.sampleRate };
  let index = ticks.findIndex((t) => t >= s.cursorTick);
  if (index < 0) index = ticks.length - 1;
  const start = tickToSampleExport(ticks[index], base);
  const end = index + 1 < ticks.length ? tickToSampleExport(ticks[index + 1], base) : s.source.length;
  try {
    const name = `${s.baseName}_${String(index).padStart(3, "0")}.wav`;
    const filePath = await api().exportSliceDialog(name);
    if (!filePath) return;
    store.update({ exportLock: true });
    await api().exportSlice({ filePath, start, end, fadeoutMs: s.doc.fadeoutMs, noisegateDb: effectiveNoisegate() });
    setStatus(`Exported ${name}`);
  } catch (err) {
    setStatus(`Export failed: ${errorMessage(err)}`, true);
  } finally {
    store.update({ exportLock: false });
  }
}

/* ------------------------------------------------------------------ */
/* BMSE clipboard                                                      */
/* ------------------------------------------------------------------ */

async function bmseOut(): Promise<void> {
  const s = store.state;
  const ticks = markerTicks(s.doc.markers);
  if (!ticks.length) {
    setStatus("No markers to copy", true);
    return;
  }
  const text = buildBmseClipboard(ticks, {
    startNumber: s.clipStartNumber,
    useFfNumbering: s.useFfNumbering,
  });
  await api().writeBmseClipboard(text);
  setStatus(`BMSE clipboard: ${ticks.length} markers, start number ${s.clipStartNumber}`);
}

async function bmseIn(): Promise<void> {
  try {
    const text = await api().readBmseClipboard();
    const parsed = parseBmseClipboard(text);
    store.state.doc.setTicks(parsed.ticks);
    store.setStatus(
      parsed.invalidLines.length
        ? `BMSE clipboard: imported ${parsed.ticks.length} markers, skipped ${parsed.invalidLines.length} malformed line(s)`
        : `BMSE clipboard: imported ${parsed.ticks.length} markers`
    );
    redraw();
  } catch (err) {
    setStatus(`BMSE clipboard read failed: ${errorMessage(err)}`, true);
  }
}

/* ------------------------------------------------------------------ */
/* Key actions                                                         */
/* ------------------------------------------------------------------ */

const actions: KeyActions = {
  toggleMarkerAtCursor(): void {
    if (store.state.doc.toggleMarker(store.state.cursorTick)) {
      store.setStatus(`Marker toggled at tick ${store.state.cursorTick}`);
    }
    redraw();
  },
  selectCopy(): void {
    const selected = store.state.selectedTicks;
    if (!selected.length) {
      store.setStatus("Copy: no markers selected (box-select or click a marker first)", true);
      return;
    }
    const offsets = store.state.doc.copySelection(selected);
    store.setStatus(`Copied ${offsets.length} marker(s) as relative group (origin tick ${selected[0]})`);
  },
  selectCut(): void {
    const selected = store.state.selectedTicks;
    if (!selected.length) {
      store.setStatus("Cut: no markers selected (box-select or click a marker first)", true);
      return;
    }
    const offsets = store.state.doc.cutSelection(selected);
    store.update({ selectedTicks: [] });
    store.setStatus(`Cut ${offsets.length} marker(s) into the selection clipboard`);
    redraw();
  },
  selectPaste(): void {
    const doc = store.state.doc;
    if (!doc.selectionClipboard) {
      store.setStatus("Paste: selection clipboard is empty (Ctrl+C / Ctrl+X first)", true);
      return;
    }
    const target = store.state.cursorTick;
    const pasted = doc.pasteSelection(target);
    if (!pasted) {
      store.setStatus(`Paste rejected at tick ${target}: ${doc.pasteRejectReason(target)}`, true);
      return;
    }
    store.update({ selectedTicks: pasted });
    store.setStatus(`Pasted ${pasted.length} marker(s) at tick ${target} (relative spacing kept)`);
    redraw();
  },
  previewAtCursor(): void {
    transport.previewSlice(false);
    redraw();
  },
  previewPrevious(): void {
    transport.previewSlice(true);
    redraw();
  },
  // Space: play/pause in every state. Never places a marker.
  playPause(): void {
    if (calibrator.isActive()) return; // calibration owns playback while open
    transport.togglePlayPause();
    store.setStatus(transport.isPlaying() ? "Playing" : "Paused");
    redraw();
  },
  /**
   * Enter: break point without touching the play state. Playing -> marker at
   * the tick computed back from the playhead sample; stopped -> marker at the
   * cursor and the cursor + playhead sample synced to the final position.
   * Both branches resolve through resolveBreakpointTick: with Snap on the
   * marker aligns to the current grid; holding Alt (bypassSnap) drops it at
   * the exact position instead.
   */
  placeBreakpoint(bypassSnap = false): void {
    // While the calibration modal is open, Enter is a tap, never a marker.
    if (calibrator.isActive()) {
      calibrator.tap();
      updateCalibrationUi();
      return;
    }
    const s = store.state;
    if (!s.source) {
      store.setStatus("Load a source before placing a break point", true);
      return;
    }
    const base = { bpm: s.doc.bpm, shift: s.doc.shift, sampleRate: s.source.sampleRate };
    // Tap calibration: the measured latency is subtracted so a marker lands on
    // the sound the user reacted to, not on where the transport had already
    // advanced to. Only playback placement is affected (stopped = cursor).
    const compensation = transport.isPlaying()
      ? latencySamples(s.tapOffsetMs, s.source.sampleRate)
      : 0;
    const rawTick = transport.isPlaying()
      ? sampleToTickNearest(Math.max(0, transport.currentSample() - compensation), base)
      : s.cursorTick;
    const tick = resolveBreakpointTick(rawTick, s.snap, gridStepTicks(s.grid), bypassSnap);
    if (transport.isPlaying()) store.update({ cursorTick: tick });
    // Stopped: the cursor follows the resolved tick too, so it keeps pointing
    // at the marker when snapping moved it off the raw cursor position.
    else
      store.update({
        cursorTick: tick,
        playheadSample: Math.min(s.source.length, tickToSampleExport(tick, base)),
      });
    // resolveBreakpointTick never returns an out-of-range tick, so a false
    // return from setMarker means this tick already holds the marker.
    if (s.doc.setMarker(tick, true)) store.setStatus(`Break point at tick ${tick}`);
    else store.setStatus(`Break point already at tick ${tick}`);
    redraw();
  },
  rateDown(): void {
    applyRateStep(-1);
  },
  rateUp(): void {
    applyRateStep(1);
  },
  exportAll,
  exportSliceAtCursor,
  bmseOut,
  bmseIn,
  saveWos,
  loadWos,
  clearMarkers(): void {
    if (store.state.doc.clearAll()) {
      store.setStatus("All markers cleared");
      store.update({ selectedTicks: [] });
    }
    redraw();
  },
  undo(): void {
    if (store.state.doc.undo()) store.setStatus("Undo");
    else store.setStatus("Nothing to undo");
    redraw();
  },
  redo(): void {
    if (store.state.doc.redo()) store.setStatus("Redo");
    else store.setStatus("Nothing to redo");
    redraw();
  },
  setClipNumber(n: number): void {
    const clamped = Math.max(0, Math.min(9999, n));
    store.update({ clipStartNumber: clamped });
    el<HTMLInputElement>("input-clipnum").value = String(clamped);
    store.setStatus(`Clip start number: ${clamped}`);
  },
  toggleFf(): void {
    const next = !store.state.useFfNumbering;
    store.update({ useFfNumbering: next });
    el<HTMLInputElement>("check-ff").checked = next;
    store.setStatus(`FF numbering rule: ${next ? "on" : "off"}`);
  },
  shiftAll(delta: number): void {
    if (store.state.doc.shiftAll(delta)) {
      store.setStatus(`Shifted all markers by ${delta} tick(s)`);
    }
    redraw();
  },
  quantizeSelection(): void {
    const s = store.state;
    if (!s.selectedTicks.length) {
      store.setStatus("Quantize disabled: select markers first (box-select or click)", true);
      return;
    }
    // state.grid is a density (cells per measure); the doc works in ticks.
    const cell = gridStepTicks(s.grid);
    if (!s.doc.quantizeSelection(s.selectedTicks, cell)) {
      store.setStatus("Selected markers already on grid");
      return;
    }
    const snapped = [
      ...new Set(
        s.selectedTicks
          .map((t) => Math.max(0, Math.min(MAX_TICKS - 1, Math.round(t / cell) * cell)))
          .filter((t) => s.doc.markers[t] === 1)
      ),
    ];
    store.update({ selectedTicks: snapped });
    store.setStatus(`Quantized selected marker(s) to grid ${s.grid}`);
    redraw();
  },
  clearSelection(): void {
    // Esc closes the calibration modal first, then cancels gestures, then
    // clears the selection.
    if (!el<HTMLDivElement>("calibration-modal").classList.contains("hidden")) {
      closeCalibration();
      return;
    }
    if (interactions.cancelGesture()) {
      store.setStatus("Gesture cancelled");
      redraw();
      return;
    }
    store.update({ selectedTicks: [], selectionStartTick: null, selectionEndTick: null });
    redraw();
  },
  measureCopy(): void {
    const measure = Math.floor(store.state.cursorTick / 192);
    store.update({ measureClipboard: store.state.doc.copyMeasure(measure) });
    store.setStatus(`Copied measure ${measure + 1} markers`);
  },
  measureCut(): void {
    const measure = Math.floor(store.state.cursorTick / 192);
    store.update({ measureClipboard: store.state.doc.cutMeasure(measure) });
    store.setStatus(`Cut measure ${measure + 1} markers`);
    redraw();
  },
  measurePaste(): void {
    const clip = store.state.measureClipboard;
    if (!clip) {
      store.setStatus("Measure clipboard is empty", true);
      return;
    }
    const measure = Math.floor(store.state.cursorTick / 192);
    store.state.doc.pasteMeasure(measure, clip);
    store.setStatus(`Pasted markers at measure ${measure + 1}`);
    redraw();
  },
  zoomIn(): void {
    const wrapCenter = waveWrap.clientWidth / 2;
    const { scrollTick, pxPerTick } = store.state;
    store.zoomAt(scrollTick + wrapCenter / pxPerTick, 1.25);
    redraw();
  },
  zoomOut(): void {
    const wrapCenter = waveWrap.clientWidth / 2;
    const { scrollTick, pxPerTick } = store.state;
    store.zoomAt(scrollTick + wrapCenter / pxPerTick, 1 / 1.25);
    redraw();
  },
  zoomRefresh(): void {
    redraw();
  },
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/* ------------------------------------------------------------------ */
/* DOM wiring                                                          */
/* ------------------------------------------------------------------ */

function readNumericInput(input: HTMLInputElement, fallback: number): number {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function wireDom(): void {
  el<HTMLButtonElement>("btn-open").addEventListener("click", () => void loadFromPath());
  el<HTMLButtonElement>("btn-undo").addEventListener("click", actions.undo);
  el<HTMLButtonElement>("btn-redo").addEventListener("click", actions.redo);
  el<HTMLButtonElement>("btn-zoom-in").addEventListener("click", actions.zoomIn);
  el<HTMLButtonElement>("btn-zoom-out").addEventListener("click", actions.zoomOut);
  el<HTMLButtonElement>("btn-marker").addEventListener("click", actions.toggleMarkerAtCursor);
  el<HTMLButtonElement>("btn-quantize").addEventListener("click", () => actions.quantizeSelection());
  el<HTMLButtonElement>("btn-snap").addEventListener("click", (e) => {
    const next = !store.state.snap;
    store.update({ snap: next });
    (e.currentTarget as HTMLButtonElement).classList.toggle("on", next);
  });
  el<HTMLSelectElement>("select-grid").addEventListener("change", (e) => {
    store.update({ grid: Number((e.target as HTMLSelectElement).value) });
    // Grid affects both the snap target and the min-gap of band detection.
    scheduleBandEstimate();
  });

  // Band overlay: display-only toggle, analysis computed lazily on first use.
  el<HTMLButtonElement>("btn-bands").addEventListener("click", (e) => {
    const next = !store.state.bandsVisible;
    store.update({ bandsVisible: next });
    const button = e.currentTarget as HTMLButtonElement;
    button.classList.toggle("on", next);
    button.setAttribute("aria-pressed", String(next));
    if (next) {
      void ensureBandAnalysis().then((analysis) => {
        store.setStatus(
          analysis ? "Band overlay on (Low/Mid/High)" : "Band overlay needs a loaded source",
          !analysis
        );
        redraw();
      });
    } else {
      store.setStatus("Band overlay off");
      redraw();
    }
  });

  for (const chip of document.querySelectorAll<HTMLButtonElement>(".band-chip")) {
    chip.addEventListener("click", () => {
      const band = chip.dataset.band as BandName;
      const current = store.state.bandDetectBands;
      const next = { ...current, [band]: !current[band] };
      if (!next.low && !next.mid && !next.high) {
        store.setStatus("Band detect: keep at least one band selected", true);
        return;
      }
      store.update({ bandDetectBands: next });
      updateBandPanel();
      scheduleBandEstimate();
    });
  }
  el<HTMLInputElement>("input-band-threshold").addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const raw = readNumericInput(input, store.state.bandThresholdDb);
    const value = Math.max(1, Math.min(24, Math.round(raw * 2) / 2));
    store.update({ bandThresholdDb: value });
    input.value = value.toFixed(1);
    updateBandPanel();
    scheduleBandEstimate();
  });
  el<HTMLSelectElement>("select-band-gap").addEventListener("change", (e) => {
    store.update({ bandMinGapUnits: Number((e.target as HTMLSelectElement).value) });
    updateBandPanel();
    scheduleBandEstimate();
  });
  el<HTMLInputElement>("check-band-snap").addEventListener("change", (e) => {
    store.update({ bandSnap: (e.target as HTMLInputElement).checked });
    updateBandPanel();
    scheduleBandEstimate();
  });
  el<HTMLButtonElement>("btn-band-detect").addEventListener("click", () => void bandDetect());

  // Tap calibration modal.
  el<HTMLButtonElement>("btn-calibrate").addEventListener("click", () => startCalibration());
  el<HTMLButtonElement>("btn-calibration-retry").addEventListener("click", () => startCalibration());
  el<HTMLButtonElement>("btn-calibration-finish").addEventListener("click", () => finishCalibration());
  el<HTMLButtonElement>("btn-calibration-close").addEventListener("click", () => closeCalibration());
  el<HTMLButtonElement>("btn-calibration-apply").addEventListener("click", () => {
    const box = el<HTMLDivElement>("calibration-result");
    const median = Number(box.dataset.median ?? "0");
    const matched = Number(box.dataset.matched ?? "0");
    if (!Number.isFinite(median) || matched === 0) return;
    store.update({ tapOffsetMs: Math.round(median) });
    syncTapOffsetDisplay();
    store.setStatus(
      `Tap offset applied: ${median >= 0 ? "+" : ""}${median.toFixed(1)} ms — Enter break points are compensated`
    );
  });

  // UI language (EN / 中文), persisted in localStorage.
  const languageSelect = el<HTMLSelectElement>("select-language");
  languageSelect.value = getLanguage();
  languageSelect.addEventListener("change", (e) => {
    const lang = (e.target as HTMLSelectElement).value as Language;
    setLanguage(lang);
    // Keep the native menu bar in step with the renderer chrome.
    void api()
      .setLanguage(lang)
      .catch(() => undefined);
    el<HTMLSpanElement>("status-main").textContent = translateStatus(store.state.statusText);
    updateBandPanel();
  });

  // Play button toggles playback ONLY — the break point moved to Enter, so a
  // click during playback must never drop a marker.
  el<HTMLButtonElement>("btn-play").addEventListener("click", () => actions.playPause());
  el<HTMLButtonElement>("btn-stop").addEventListener("click", () => {
    transport.stop();
    store.update({ playheadSample: 0 });
    store.setStatus("Stopped");
    redraw();
  });
  el<HTMLButtonElement>("btn-follow").addEventListener("click", (e) => {
    const next = !store.state.followPlayhead;
    store.update({ followPlayhead: next });
    (e.currentTarget as HTMLButtonElement).classList.toggle("on", next);
  });
  el<HTMLSelectElement>("select-cue").addEventListener("change", (e) => {
    const mode = (e.target as HTMLSelectElement).value as typeof store.state.cueMode;
    store.update({ cueMode: mode });
    store.setStatus(`Cue: ${mode}`);
  });
  el<HTMLInputElement>("input-cue-vol").addEventListener("input", (e) => {
    const v = Number((e.target as HTMLInputElement).value) / 100;
    store.update({ cueVolume: v });
    transport.setCueVolume(v);
  });
  el<HTMLSelectElement>("select-rate").addEventListener("change", (e) => {
    const rate = Number((e.target as HTMLSelectElement).value);
    transport.setRate(rate);
    store.setStatus(`Playback rate: ${formatRate(rate)}`);
    syncRateSelect();
  });

  el<HTMLInputElement>("input-bpm").addEventListener("change", (e) => {
    const bpm = readNumericInput(e.target as HTMLInputElement, store.state.doc.bpm);
    if (bpm > 0) {
      store.state.doc.bpm = bpm;
      store.setStatus(`BPM: ${bpm}`);
      redraw();
    }
  });
  el<HTMLInputElement>("input-shift").addEventListener("change", (e) => {
    store.state.doc.shift = readNumericInput(e.target as HTMLInputElement, store.state.doc.shift);
    redraw();
  });
  el<HTMLInputElement>("input-fade").addEventListener("change", (e) => {
    const v = Math.max(0, Math.trunc(readNumericInput(e.target as HTMLInputElement, 0)));
    store.state.doc.fadeoutMs = v;
    (e.target as HTMLInputElement).value = String(v);
  });
  el<HTMLInputElement>("input-gate").addEventListener("change", (e) => {
    const v = readNumericInput(e.target as HTMLInputElement, store.state.doc.noisegateDb);
    store.state.doc.noisegateDb = v;
    if (!Number.isInteger(v)) {
      setStatus("Note: noisegate will refuse to save until the dB value is an integer", true);
    }
  });
  el<HTMLInputElement>("check-gate").addEventListener("change", (e) => {
    store.update({ noisegateEnabled: (e.target as HTMLInputElement).checked });
  });

  // Command-bar Copy/Paste act on the selection (Ctrl+C / Ctrl+V); the legacy
  // measure clipboard stays available via Ctrl+F and the Edit menu.
  el<HTMLButtonElement>("btn-copy").addEventListener("click", actions.selectCopy);
  el<HTMLButtonElement>("btn-paste").addEventListener("click", actions.selectPaste);
  el<HTMLButtonElement>("btn-export").addEventListener("click", exportAll);
  el<HTMLButtonElement>("btn-export-one").addEventListener("click", exportSliceAtCursor);
  el<HTMLButtonElement>("btn-bmse-out").addEventListener("click", () => void bmseOut());
  el<HTMLButtonElement>("btn-bmse-in").addEventListener("click", () => void bmseIn());
  el<HTMLButtonElement>("btn-save-wos").addEventListener("click", () => void saveWos());
  el<HTMLButtonElement>("btn-load-wos").addEventListener("click", () => void loadWos());
  el<HTMLButtonElement>("btn-clear").addEventListener("click", actions.clearMarkers);
  el<HTMLInputElement>("input-basename").addEventListener("change", (e) => {
    store.update({ baseName: (e.target as HTMLInputElement).value || "slice" });
    updateCutList();
  });
  el<HTMLInputElement>("input-clipnum").addEventListener("change", (e) => {
    actions.setClipNumber(Math.trunc(readNumericInput(e.target as HTMLInputElement, 1)));
  });
  el<HTMLInputElement>("check-ff").addEventListener("change", (e) => {
    store.update({ useFfNumbering: (e.target as HTMLInputElement).checked });
  });

  el<HTMLButtonElement>("btn-edge").addEventListener("click", () => {
    const s = store.state;
    if (!s.source) {
      setStatus("Edge detection needs a loaded source", true);
      return;
    }
    const edges = detectEdges(s.source, { bpm: s.doc.bpm, shift: s.doc.shift, sampleRate: s.source.sampleRate }, 4);
    s.doc.setTicks(edges);
    store.setStatus(`Edge detection: ${edges.length} candidates`);
    redraw();
  });

  // Side panel tabs.
  document.querySelectorAll<HTMLButtonElement>(".side-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll<HTMLButtonElement>(".side-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      for (const name of ["source", "cuts", "output"]) {
        el<HTMLDivElement>(`tab-${name}`).classList.toggle("hidden", tab.dataset.tab !== name);
      }
    });
  });

  // Drag & drop.
  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    waveWrap.classList.add("dragover");
    setStatus("Drop to load source");
  });
  window.addEventListener("dragleave", () => waveWrap.classList.remove("dragover"));
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    waveWrap.classList.remove("dragover");
    const file = e.dataTransfer?.files?.[0];
    if (file) void loadFromDrop(file);
  });

  // Keyboard.
  window.addEventListener("keydown", (e) => handleKeyDown(store, actions, e));

  // Resize.
  const observer = new ResizeObserver(() => redraw());
  observer.observe(waveWrap);
  observer.observe(rulerCanvas);
  observer.observe(overviewCanvas);

  // Menu actions from the main process.
  api().onMenuAction((action) => {
    switch (action) {
      case "open-audio":
        void loadFromPath();
        break;
      case "open-wos":
        void loadWos();
        break;
      case "save-wos":
        void saveWos();
        break;
      case "export-slice":
        void exportSliceAtCursor();
        break;
      case "export-all":
        void exportAll();
        break;
      case "undo":
        actions.undo();
        break;
      case "redo":
        actions.redo();
        break;
      case "copy-selection":
        actions.selectCopy();
        break;
      case "cut-selection":
        actions.selectCut();
        break;
      case "paste-selection":
        actions.selectPaste();
        break;
      case "measure-copy":
        actions.measureCopy();
        break;
      case "measure-cut":
        actions.measureCut();
        break;
      case "measure-paste":
        actions.measurePaste();
        break;
      case "quantize":
        actions.quantizeSelection();
        break;
      case "clear-markers":
        actions.clearMarkers();
        break;
      case "zoom-in":
        actions.zoomIn();
        break;
      case "zoom-out":
        actions.zoomOut();
        break;
      default:
        break;
    }
  });
}

/* Playhead animation + status sync loop. The viewport self-check runs on EVERY
   frame (cheap: three reads already-laid-out properties): when the canvas
   viewport moved on since the last paint the whole view repaints, so a resize
   the ResizeObserver missed can never leave the old width on screen. While
   scroll/zoom are otherwise unchanged this stays on the cheap overlay+readout
   path; the frame after follow-scroll (or a zoom) moves scrollTick/pxPerTick
   repaints ruler, waveform, overview and the scrollbar so the paged view is
   visible with no stall. updateCutList is deliberately NOT called from the
   playing branch: it rebuilds the DOM list on every call and markers cannot
   change from scrolling. */
function animate(): void {
  const s = store.state;
  if (viewportChanged()) {
    redraw();
  } else if (s.playing) {
    if (s.scrollTick !== lastDrawnScrollTick || s.pxPerTick !== lastDrawnPxPerTick) {
      redrawCanvases();
      lastDrawnScrollTick = s.scrollTick;
      lastDrawnPxPerTick = s.pxPerTick;
    } else {
      view.drawOverlay(interactions.currentGhost());
    }
    updateReadout();
  }
  requestAnimationFrame(animate);
}

window.addEventListener("DOMContentLoaded", () => {
  try {
    initLanguage();
    applyStaticTranslations();
    // The main process starts the menu in the OS locale; this makes the
    // persisted choice authoritative on every launch.
    void api()
      .setLanguage(getLanguage())
      .catch(() => undefined);
    wireDom();
    interactions.attach();
    transport.setCueVolume(store.state.cueVolume);
    syncTapOffsetDisplay();
    redraw();
    animate();
  } catch (err) {
    (window as unknown as { __bootError: string }).__bootError =
      err instanceof Error ? `${err.message}
${err.stack ?? ""}` : String(err);
    throw err;
  }
});

