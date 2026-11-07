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
  renderStatus,
  setLanguage,
  tr,
  LANGUAGES,
  LANGUAGE_LABELS,
  DOC_LANG,
  type Language,
} from "./i18n.js";
import type { ChromeKey, FormatParams, StatusKey } from "../core/messages.js";
import type { StatusEntry, StatusSegment } from "./store.js";
import { gridStepTicks } from "../core/gridlines.js";
import { MAX_TICKS, MEASURE_TICKS, resolveBreakpointTick, sampleToTickNearest, tickToSampleExport } from "../core/timebase.js";
import { dbToAmp, dbToSlider, ampToDb, sliderToDb } from "../core/volume.js";
import { DEFAULT_PLAYBACK_RATE, formatRate, stepPlaybackRate } from "../core/rate.js";
import { Store } from "./store.js";
import { TimelineView } from "./waveform.js";
import { Transport } from "./transport.js";
import { Interactions } from "./interactions.js";
import { handleKeyDown, KeyActions } from "./keys.js";
import { BmhController } from "./bmh.js";
import { createPianoRoll } from "./pianoroll.js";
import {
  bmsSequenceClipboard,
  cutPositionsClipboard,
  defaultDivisionSetting,
  wavDefinitionText,
  type DivisionSetting,
} from "../core/bmhelper.js";
import { MAX_TICKS as BMH_MAX_TICKS } from "../core/timebase.js";

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
   the grid" report. The subscription also mirrors the density into the
   command-bar Grid select here. NaN starts "dirty" so the first change
   always repaints. */
let lastDrawnGrid = Number.NaN;

/* Cursor tick the overlay was last drawn with. keys.ts moves the cursor by
   mutating the store directly (no renderer dependency), so this subscription is
   the only place that repaints those moves — without it the arrows moved an
   invisible caret and the readout stayed frozen, i.e. they "did nothing". */
let lastDrawnCursorTick = Number.NaN;

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
  const measure = String(Math.floor(s.cursorTick / 192) + 1).padStart(3, "0");
  let text: string;
  if (s.source) {
    const sec = s.playheadSample / s.source.sampleRate;
    const mm = Math.floor(sec / 60);
    const ss = (sec - mm * 60).toFixed(3).padStart(6, "0");
    text = tr("readoutTime", { measure, time: `${String(mm).padStart(2, "0")}:${ss}` });
  } else {
    text = tr("readoutTick", { measure, tick: s.cursorTick });
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

function setStatus(key: StatusKey, params?: FormatParams, isError = false): void {
  store.setStatus(key, params, isError);
}

/**
 * [ / ] rate stepping: one notch of the frozen ladder per press, clamped at
 * 0.25x / 1.5x with a status-bar hint (no dialog). Re-anchoring happens in
 * transport.setRate so the playhead never jumps.
 */
function applyRateStep(direction: -1 | 1): void {
  const step = stepPlaybackRate(store.state.playbackRate, direction);
  transport.setRate(step.rate);
  const rate = formatRate(step.rate);
  store.setStatus(
    step.clamped
      ? direction < 0
        ? "alreadySlowest"
        : "alreadyFastest"
      : "playbackRate",
    { rate }
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

/** Mirrors store.grid into the command-bar Grid select: Q/W (keys.ts) write
 *  the store directly and cannot touch the DOM, so without this the select
 *  kept the previous density after a keyboard change. */
function syncGridSelect(): void {
  el<HTMLSelectElement>("select-grid").value = String(store.state.grid);
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
  store.setStatus("analyzingBands");
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
  button.textContent = tr(s.bandBusy ? "detecting" : "detect");
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
    store.setStatus("bandDetectNeedsSource", true);
    return;
  }
  if (!selectedBands().length) {
    store.setStatus("bandDetectSelectBand", true);
    return;
  }
  store.update({ bandBusy: true });
  updateBandPanel();
  store.setStatus("detectingBandOnsets");
  try {
    const analysis = await ensureBandAnalysis();
    if (!analysis) return;
    const threshold = store.state.bandThresholdDb.toFixed(1);
    const result = runBandDetect(analysis);
    const added = store.state.doc.addTicks(result.ticks);
    const range = bandRange();
    const bands = selectedBands()
      .map((b) => b[0].toUpperCase() + b.slice(1))
      .join("/");
    if (added === 0) {
      store.setStatus({ key: "bandDetectZero", params: { threshold } });
    } else {
      // The result line is a sequence of translatable segments; the store
      // keeps them keyed so a language switch re-renders every segment.
      const segments: StatusSegment[] = [{ key: "bandDetectCuts", params: { count: added, bands, threshold } }];
      if (range.hasRange) segments.push({ key: "bandDetectInSelection" });
      segments.push({ key: "bandDetectUndoStep" });
      if (result.skippedGap) segments.push({ key: "bandDetectSkipped", params: { count: result.skippedGap } });
      if (result.existing) segments.push({ key: "bandDetectExisting", params: { count: result.existing } });
      store.setStatus(segments);
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
    ms === 0 ? "" : tr("offsetDisplay", { ms: `${ms > 0 ? "+" : ""}${ms}` });
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
  box.textContent = tr("tapsLive", {
    matched: result.matched,
    total: result.total,
    median: `${sign}${result.medianMs.toFixed(1)}`,
    mean: result.meanMs.toFixed(1),
    spread: result.stdMs.toFixed(1),
  });
  apply.classList.remove("hidden");
}

function closeCalibration(): void {
  calibrator.cancel();
  if (calibrationTimer !== null) {
    window.clearInterval(calibrationTimer);
    calibrationTimer = null;
  }
  el<HTMLDivElement>("calibration-modal").classList.add("hidden");
  store.setStatus("calibrationClosed");
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
    box.textContent = tr("noTapsMatched", { total: result.total });
    el<HTMLButtonElement>("btn-calibration-apply").classList.add("hidden");
  } else {
    const sign = result.medianMs >= 0 ? "+" : "";
    box.textContent = tr("tapsFinal", {
      matched: result.matched,
      total: result.total,
      median: `${sign}${result.medianMs.toFixed(1)}`,
      mean: result.meanMs.toFixed(1),
      spread: result.stdMs.toFixed(1),
    });
    el<HTMLButtonElement>("btn-calibration-apply").classList.remove("hidden");
  }
  updateCalibrationUi();
  store.setStatus("tapCalibrationFinished");
}

function startCalibration(): void {
  if (!store.state.source) {
    store.setStatus("calibrationNeedsSource", undefined, true);
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
  store.setStatus("calibrationStart");
}

// Single render path for the status bar: every store.setStatus (from actions,
// interactions, transport) flows through the subscription into the DOM. The
// status entry is rendered in the current language; a language switch re-runs
// renderStatus through the explicit refresh in the language-change handler.
let lastRenderedStatus: StatusEntry | null = null;
let lastRenderedError: boolean | null = null;
function renderStatusBar(): void {
  const s = store.state;
  lastRenderedStatus = s.status;
  lastRenderedError = s.isError;
  const bar = el<HTMLElement>("status-bar");
  bar.classList.toggle("error", s.isError);
  el<HTMLSpanElement>("status-main").textContent = renderStatus(s.status);
}
store.subscribe(() => {
  const s = store.state;
  if (s.status !== lastRenderedStatus || s.isError !== lastRenderedError) {
    renderStatusBar();
  }
  updateCommandStates();
  // Grid density changes the drawn line set AND the snap targets: repaint the
  // canvas layers so the ruler can never show a grid the clicks no longer use,
  // and mirror the new density into the command-bar Grid select (the select's
  // own change listener only ever wrote select -> store, so a Q/W change left
  // it showing the previous density).
  if (s.grid !== lastDrawnGrid) {
    lastDrawnGrid = s.grid;
    redrawCanvases();
    syncGridSelect();
  }
  // Cursor moves (arrow keys, Shift+arrows, cut-list clicks) repaint the
  // overlay cursor line, the readout and the active cut-list row. Paging keeps
  // the keyboard cursor reachable: repeated arrow presses used to walk it off
  // screen, which read as a dead key even after the repaint was fixed.
  if (s.cursorTick !== lastDrawnCursorTick) {
    lastDrawnCursorTick = s.cursorTick;
    const viewTicks = s.pxPerTick > 0 ? waveWrap.clientWidth / s.pxPerTick : 0;
    // Never fight the playhead follow-scroll while playing.
    if (!s.playing && viewTicks > 0 && (s.cursorTick < s.scrollTick || s.cursorTick > s.scrollTick + viewTicks)) {
      store.update({
        scrollTick: Math.max(0, Math.min(MAX_TICKS - viewTicks, s.cursorTick - viewTicks * 0.1)),
      });
    }
    redraw();
  }
  // A selection must never outlive its markers: Z, the erase drag and undo can
  // delete a selected marker without touching selectedTicks, which kept the
  // Quantize button enabled and let copy/cut address a marker that was gone.
  if (s.selectedTicks.some((t) => s.doc.markers[t] !== 1)) {
    store.update({ selectedTicks: s.selectedTicks.filter((t) => s.doc.markers[t] === 1) });
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
    setStatus("parsingSourceFile");
    const info = await api().readAudioFile(path);
    applyLoadedAudio(info);
  } catch (err) {
    store.update({ phase: store.state.source ? "ready" : "empty" });
    setStatus("loadFailed", { message: errorMessage(err) }, true);
  }
}

async function loadFromDrop(file: File): Promise<void> {
  try {
    store.update({ phase: "parsing" });
    setStatus("parsingDroppedFile");
    const buffer = await file.arrayBuffer();
    const info = await api().decodeAudioBuffer(file.name, buffer);
    applyLoadedAudio(info);
  } catch (err) {
    store.update({ phase: store.state.source ? "ready" : "empty" });
    setStatus("dropFailed", { message: errorMessage(err) }, true);
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
  el<HTMLSpanElement>("src-format").textContent = tr("srcFormat", { channels: info.channels });
  el<HTMLSpanElement>("src-length").textContent = tr("framesCount", { count: info.length.toLocaleString() });
  el<HTMLSpanElement>("src-duration").textContent = `${(info.length / info.sampleRate).toFixed(3)}s`;
  transport.loadSource(floatData, info.sampleRate);
  setStatus("readySource", { name: info.name, rate: info.sampleRate, channels: info.channels });
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
    store.setStatus("loadedWos", { file: path.split(/[\\/]/).pop() ?? path, bpm: docData.bpm, shift: docData.shift });
    redraw();
  } catch (err) {
    setStatus("wosLoadFailed", { message: errorMessage(err) }, true);
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
    setStatus("savedWos", { file: path.split(/[\\/]/).pop() ?? path });
  } catch (err) {
    if (err instanceof WosFormatError) {
      setStatus("saveBlocked", { message: err.message }, true);
    } else {
      setStatus("wosSaveFailed", { message: errorMessage(err) }, true);
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
    setStatus("nothingToExportNoSource", undefined, true);
    return;
  }
  const ticks = markerTicks(s.doc.markers);
  if (!ticks.length) {
    setStatus("nothingToExportNoMarkers", undefined, true);
    return;
  }
  try {
    const dir = await api().exportAllDialog(s.source.path);
    if (!dir) return;
    store.update({ exportLock: true });
    setStatus("exportingSlices", { count: ticks.length });
    const result = await api().exportAll({
      dirPath: dir,
      baseName: s.baseName,
      bpm: s.doc.bpm,
      shift: s.doc.shift,
      fadeoutMs: s.doc.fadeoutMs,
      noisegateDb: effectiveNoisegate(),
      markers: ticks,
    });
    if (result.skipped > 0) {
      store.setStatus([
        { key: "exportedSlicesTo", params: { count: result.written.length, directory: dir } },
        { key: "exportSkippedBeyond", params: { count: result.skipped } },
      ]);
    } else {
      setStatus("exportedSlicesTo", { count: result.written.length, directory: dir });
    }
  } catch (err) {
    const message = errorMessage(err);
    setStatus(
      message.includes("missing on disk") ? "sourceFileMissing" : "exportFailed",
      { message },
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
    setStatus("nothingToExportNoSource", undefined, true);
    return;
  }
  const ticks = markerTicks(s.doc.markers);
  if (!ticks.length) {
    setStatus("nothingToExportNoMarkers", undefined, true);
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
    setStatus("exportedSingle", { file: name });
  } catch (err) {
    setStatus("exportFailed", { message: errorMessage(err) }, true);
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
    setStatus("noMarkersToCopy", undefined, true);
    return;
  }
  const text = buildBmseClipboard(ticks, {
    startNumber: s.clipStartNumber,
    useFfNumbering: s.useFfNumbering,
  });
  await api().writeBmseClipboard(text);
  setStatus("bmseClipboardOut", { count: ticks.length, start: s.clipStartNumber });
}

async function bmseIn(): Promise<void> {
  try {
    const text = await api().readBmseClipboard();
    const parsed = parseBmseClipboard(text);
    // Cuts beyond the end of the audio are illegal: skipped on import.
    const legal = parsed.ticks.filter((t) => !tickBeyondEnd(t));
    store.state.doc.setTicks(legal);
    const segments: StatusSegment[] = [
      parsed.invalidLines.length
        ? { key: "bmseClipboardImportedSkipped", params: { count: legal.length, skipped: parsed.invalidLines.length } }
        : { key: "bmseClipboardImported", params: { count: legal.length } },
    ];
    const droppedBeyond = parsed.ticks.length - legal.length;
    if (droppedBeyond > 0) segments.push({ key: "exportSkippedBeyond", params: { count: droppedBeyond } });
    store.setStatus(segments);
    redraw();
  } catch (err) {
    setStatus("bmseReadFailed", { message: errorMessage(err) }, true);
  }
}

/* ------------------------------------------------------------------ */
/* Key actions                                                         */
/* ------------------------------------------------------------------ */

const actions: KeyActions = {
  openAudio(): void {
    void loadFromPath();
  },
  openWos(): void {
    void loadWos();
  },
  toggleMarkerAtCursor(): void {
    if (tickBeyondEnd(store.state.cursorTick)) {
      store.setStatus("cutBeyondEnd", undefined, true);
      return;
    }
    if (store.state.doc.toggleMarker(store.state.cursorTick)) {
      store.setStatus("markerToggledAtTick", { tick: store.state.cursorTick });
    }
    redraw();
  },
  selectCopy(): void {
    const selected = store.state.selectedTicks;
    if (!selected.length) {
      store.setStatus("copyNoSelection", undefined, true);
      return;
    }
    const offsets = store.state.doc.copySelection(selected);
    store.setStatus("copiedRelativeGroup", { count: offsets.length, origin: selected[0] });
  },
  selectCut(): void {
    const selected = store.state.selectedTicks;
    if (!selected.length) {
      store.setStatus("cutNoSelection", undefined, true);
      return;
    }
    const offsets = store.state.doc.cutSelection(selected);
    store.update({ selectedTicks: [] });
    store.setStatus("cutToClipboard", { count: offsets.length });
    redraw();
  },
  selectPaste(): void {
    const doc = store.state.doc;
    if (!doc.selectionClipboard) {
      store.setStatus("pasteClipboardEmpty", undefined, true);
      return;
    }
    const target = store.state.cursorTick;
    // Cuts beyond the end of the audio are illegal: reject the whole paste.
    if (doc.selectionClipboard.some((offset) => tickBeyondEnd(target + offset))) {
      store.setStatus("cutBeyondEnd", undefined, true);
      return;
    }
    const pasted = doc.pasteSelection(target);
    if (!pasted) {
      store.setStatus("pasteRejected", { tick: target, reason: doc.pasteRejectReason(target) }, true);
      return;
    }
    store.update({ selectedTicks: pasted });
    store.setStatus("pastedRelativeGroup", { count: pasted.length, tick: target });
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
    store.setStatus(transport.isPlaying() ? "playing" : "paused");
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
      store.setStatus("loadBeforeBreakPoint", undefined, true);
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
    if (tickBeyondEnd(tick)) {
      store.setStatus("cutBeyondEnd", undefined, true);
      return;
    }
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
    if (s.doc.setMarker(tick, true)) store.setStatus("breakPointAtTick", { tick });
    else store.setStatus("breakPointAlreadyAtTick", { measure: Math.floor(tick / MEASURE_TICKS) + 1, tick });
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
      store.setStatus("allMarkersCleared");
      store.update({ selectedTicks: [] });
    }
    redraw();
  },
  undo(): void {
    if (store.state.doc.undo()) store.setStatus("undo");
    else store.setStatus("nothingToUndo");
    redraw();
  },
  redo(): void {
    if (store.state.doc.redo()) store.setStatus("redo");
    else store.setStatus("nothingToRedo");
    redraw();
  },
  setClipNumber(n: number): void {
    const clamped = Math.max(0, Math.min(9999, n));
    store.update({ clipStartNumber: clamped });
    el<HTMLInputElement>("input-clipnum").value = String(clamped);
    store.setStatus("clipStartNumber", { number: clamped });
  },
  toggleFf(): void {
    const next = !store.state.useFfNumbering;
    store.update({ useFfNumbering: next });
    el<HTMLInputElement>("check-ff").checked = next;
    store.setStatus("ffNumberingRule", { state: next ? "on" : "off" });
  },
  shiftAll(delta: number): void {
    // A rightward shift that would push a cut beyond the audio end is illegal.
    if (delta > 0 && store.state.source) {
      const ticks = markerTicks(store.state.doc.markers);
      const maxTick = ticks.length ? ticks[ticks.length - 1] : -1;
      if (maxTick >= 0 && tickBeyondEnd(maxTick + delta)) {
        store.setStatus("cutBeyondEnd", undefined, true);
        return;
      }
    }
    if (store.state.doc.shiftAll(delta)) {
      store.setStatus("shiftedAllMarkers", { count: delta });
    }
    redraw();
  },
  quantizeSelection(): void {
    const s = store.state;
    if (!s.selectedTicks.length) {
      store.setStatus("quantizeDisabled", undefined, true);
      return;
    }
    // state.grid is a density (cells per measure); the doc works in ticks.
    const cell = gridStepTicks(s.grid);
    if (!s.doc.quantizeSelection(s.selectedTicks, cell)) {
      store.setStatus("alreadyOnGrid");
      return;
    }
    const snapped = [
      ...new Set(
        s.selectedTicks
          .map((t) => Math.max(0, Math.min(MAX_TICKS - 1, Math.round(t / cell) * cell)))
          .filter((t) => s.doc.markers[t] === 1 && !tickBeyondEnd(t))
      ),
    ];
    store.update({ selectedTicks: snapped });
    store.setStatus("quantizedToGrid", { grid: s.grid });
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
      store.setStatus("gestureCancelled");
      redraw();
      return;
    }
    store.update({ selectedTicks: [], selectionStartTick: null, selectionEndTick: null });
    redraw();
  },
  measureCopy(): void {
    const measure = Math.floor(store.state.cursorTick / 192);
    store.update({ measureClipboard: store.state.doc.copyMeasure(measure) });
    store.setStatus("copiedMeasure", { measure: measure + 1 });
  },
  measureCut(): void {
    const measure = Math.floor(store.state.cursorTick / 192);
    store.update({ measureClipboard: store.state.doc.cutMeasure(measure) });
    store.setStatus("cutMeasure", { measure: measure + 1 });
    redraw();
  },
  measurePaste(): void {
    const clip = store.state.measureClipboard;
    if (!clip) {
      store.setStatus("measureClipboardEmpty", undefined, true);
      return;
    }
    const measure = Math.floor(store.state.cursorTick / 192);
    store.state.doc.pasteMeasure(measure, clip);
    store.setStatus("pastedMeasure", { measure: measure + 1 });
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

/** Amplitude 0..1 as a dB attenuation label ("0.0" at full, "-∞" muted). */
function formatDb(v: number): string {
  if (v <= 0) return "-∞";
  return (20 * Math.log10(v)).toFixed(1);
}

/** Parses a two-character base-36 definition id ("01".."ZZ") into its value. */
function parseBmhStart(text: string): number {
  const trimmed = text.trim();
  if (!/^[0-9A-Za-z]{2}$/.test(trimmed)) throw new RangeError(`invalid definition id: ${text}`);
  const digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const value = digits.indexOf(trimmed[0].toUpperCase()) * 36 + digits.indexOf(trimmed[1].toUpperCase());
  if (value < 0 || value > 1295) throw new RangeError(`invalid definition id: ${text}`);
  return value;
}

/** Cuts beyond the end of the audio are illegal (a confirmed defect of the original). */
function tickBeyondEnd(tick: number): boolean {
  const s = store.state;
  if (!s.source) return false;
  return (
    tickToSampleExport(tick, { bpm: s.doc.bpm, shift: s.doc.shift, sampleRate: s.source.sampleRate }) >
    s.source.length
  );
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
          analysis ? "bandOverlayOn" : "bandOverlayNeedsSource",
          undefined,
          !analysis
        );
        redraw();
      });
    } else {
      store.setStatus("bandOverlayOff");
      redraw();
    }
  });

  for (const chip of document.querySelectorAll<HTMLButtonElement>(".band-chip")) {
    chip.addEventListener("click", () => {
      const band = chip.dataset.band as BandName;
      const current = store.state.bandDetectBands;
      const next = { ...current, [band]: !current[band] };
      if (!next.low && !next.mid && !next.high) {
        store.setStatus("bandDetectKeepBand", undefined, true);
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
    store.setStatus("tapOffsetApplied", { offset: `${median >= 0 ? "+" : ""}${median.toFixed(1)}` });
  });

  // UI language, persisted in localStorage. The options come from the i18n
  // language manifest so the selector can never drift from the shipped set.
  // Each option carries its own lang attribute (its manifest docLang) so the
  // browser renders every native name with that language's font fallback.
  const languageSelect = el<HTMLSelectElement>("select-language");
  for (const lang of LANGUAGES) {
    const option = document.createElement("option");
    option.value = lang;
    option.lang = DOC_LANG[lang];
    option.textContent = LANGUAGE_LABELS[lang];
    languageSelect.append(option);
  }
  languageSelect.value = getLanguage();
  languageSelect.addEventListener("change", (e) => {
    const lang = (e.target as HTMLSelectElement).value as Language;
    setLanguage(lang);
    // Keep the native menu bar in step with the renderer chrome.
    void api()
      .setLanguage(lang)
      .catch(() => undefined);
    renderStatusBar();
    updateBandPanel();
  });

  // Play button toggles playback ONLY — the break point moved to Enter, so a
  // click during playback must never drop a marker.
  el<HTMLButtonElement>("btn-play").addEventListener("click", () => actions.playPause());
  el<HTMLButtonElement>("btn-stop").addEventListener("click", () => {
    transport.stop();
    store.update({ playheadSample: 0 });
    store.setStatus("stopped");
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
    // Reuse the cue-select chrome keys so the mode name is localized too.
    const modeKeys: Record<typeof store.state.cueMode, ChromeKey> = {
      off: "cueOff",
      cowbell: "cueCowbell",
      triangle: "cueTriangle",
      metronome: "cueMetronome",
    };
    store.setStatus("cueMode", { mode: tr(modeKeys[mode]) });
  });
  el<HTMLInputElement>("input-cue-vol").addEventListener("input", (e) => {
    // Slider positions map onto a -60..0 dB fader; the transport takes amps.
    const db = sliderToDb(Number((e.target as HTMLInputElement).value));
    const amp = dbToAmp(db);
    store.update({ cueVolume: amp });
    transport.setCueVolume(amp);
    store.setStatus("cueVolumeDb", { db: formatDb(amp) });
  });
  // Monitor volume for playback and previews, left of the RMS/Bands toggles.
  el<HTMLInputElement>("input-volume").addEventListener("input", (e) => {
    const db = sliderToDb(Number((e.target as HTMLInputElement).value));
    const amp = dbToAmp(db);
    store.update({ volume: amp });
    transport.setVolume(amp);
    store.setStatus("playbackVolumeDb", { db: formatDb(amp) });
  });
  // Slider positions start at the product defaults (-10 dB / -6 dB).
  el<HTMLInputElement>("input-volume").value = String(dbToSlider(ampToDb(store.state.volume)));
  el<HTMLInputElement>("input-cue-vol").value = String(dbToSlider(ampToDb(store.state.cueVolume)));
  // RMS band toggle (default off; the envelope alone shows the peaks).
  el<HTMLButtonElement>("btn-rms").addEventListener("click", (e) => {
    const next = !store.state.rmsVisible;
    store.update({ rmsVisible: next });
    const button = e.currentTarget as HTMLButtonElement;
    button.classList.toggle("on", next);
    button.setAttribute("aria-pressed", String(next));
    redraw();
  });
  el<HTMLSelectElement>("select-rate").addEventListener("change", (e) => {
    const rate = Number((e.target as HTMLSelectElement).value);
    transport.setRate(rate);
    store.setStatus("playbackRate", { rate: formatRate(rate) });
    syncRateSelect();
  });

  el<HTMLInputElement>("input-bpm").addEventListener("change", (e) => {
    const bpm = readNumericInput(e.target as HTMLInputElement, store.state.doc.bpm);
    if (bpm > 0) {
      store.state.doc.bpm = bpm;
      store.setStatus("bpmValue", { bpm });
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
      setStatus("noisegateNote", undefined, true);
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
      setStatus("edgeDetectionNeedsSource", undefined, true);
      return;
    }
    const edges = detectEdges(s.source, { bpm: s.doc.bpm, shift: s.doc.shift, sampleRate: s.source.sampleRate }, 4);
    s.doc.setTicks(edges);
    store.setStatus("edgeDetectionCandidates", { count: edges.length });
    redraw();
  });

  // Side panel tabs.
  document.querySelectorAll<HTMLButtonElement>(".side-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll<HTMLButtonElement>(".side-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      for (const name of ["source", "cuts", "output", "bmhelper"]) {
        el<HTMLDivElement>(`tab-${name}`).classList.toggle("hidden", tab.dataset.tab !== name);
      }
      if (tab.dataset.tab === "bmhelper") bmhSync();
    });
  });

  // Drag & drop: audio to the slicer, MIDI/.bmh to the BMHelper panel.
  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    waveWrap.classList.add("dragover");
    setStatus("dropToLoad");
  });
  window.addEventListener("dragleave", () => waveWrap.classList.remove("dragover"));
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    waveWrap.classList.remove("dragover");
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (/\.(mid|midi|smf)$/i.test(file.name)) {
      void importMidiFile(file);
    } else if (/\.bmh$/i.test(file.name)) {
      void openBmhFile(file);
    } else {
      void loadFromDrop(file);
    }
  });

  // ------------------------------------------------------------------
  // BMHelper panel.
  // ------------------------------------------------------------------
  const bmh = new BmhController();
  const pianoroll = createPianoRoll(el<HTMLCanvasElement>("bmh-pianoroll"), () => {
    const division = bmh.selectedDivision;
    return division ? { quantize: division.quantize, notes: division.recording } : null;
  });
  pianoroll.attach(el<HTMLCanvasElement>("bmh-pianoroll"));
  bmh.subscribe(() => bmhSync());

  function bmhSync(): void {
    const project = bmh.state;
    el<HTMLDivElement>("bmh-project").classList.toggle("hidden", !project);
    if (!project) return;
    el<HTMLElement>("bmh-source-info").textContent = `${bmh.name} · ${project.source.notes.length}n`;
    const list = el<HTMLUListElement>("bmh-division-list");
    list.innerHTML = "";
    const fragment = document.createDocumentFragment();
    project.divisions.forEach((division, index) => {
      const li = document.createElement("li");
      if (index === bmh.selectedIndex) li.className = "active";
      li.textContent = `${division.name} (${division.recording.length}n/${division.definitions.length}d)`;
      li.addEventListener("click", () => bmh.selectDivision(index));
      fragment.appendChild(li);
    });
    list.appendChild(fragment);
    const division = bmh.selectedDivision;
    el<HTMLDivElement>("bmh-editor").classList.toggle("hidden", !division);
    el<HTMLButtonElement>("btn-bmh-delete").classList.toggle("hidden", !division);
    if (division) {
      drawDefinitionStrip();
      pianoroll.draw();
    }
  }

  function drawDefinitionStrip(): void {
    const canvas = el<HTMLCanvasElement>("bmh-defs");
    const context = canvas.getContext("2d");
    if (!context) return;
    const division = bmh.selectedDivision;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.max(1, width * (window.devicePixelRatio || 1));
    canvas.height = Math.max(1, height * (window.devicePixelRatio || 1));
    context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    context.fillStyle = "#14171b";
    context.fillRect(0, 0, width, height);
    if (!division) return;
    const cell = 30;
    division.definitions.forEach((definition, index) => {
      const x = (index % Math.max(1, Math.floor(width / cell))) * cell;
      const y = Math.floor(index / Math.max(1, Math.floor(width / cell))) * (height / 2);
      if (y >= height) return;
      context.fillStyle = index % 2 === 0 ? "#1a1e23" : "#22272d";
      context.fillRect(x, y, cell - 1, height / 2 - 1);
      context.fillStyle = "#edeff2";
      context.font = "9px monospace";
      context.fillText(zzStringOf(definition.zz), x + 3, y + 10);
      context.fillText(String(definition.div), x + 3, y + 22);
    });
  }

  function zzStringOf(zz: number): string {
    const digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    return digits[Math.floor(zz / 36)] + digits[zz % 36];
  }

  function bmhGuard(ready: () => void, noDivision: boolean): boolean {
    if (!bmh.state) {
      store.setStatus("bmhNeedsProject", undefined, true);
      return false;
    }
    if (noDivision && !bmh.selectedDivision) {
      store.setStatus("bmhNoDivision", undefined, true);
      return false;
    }
    ready();
    return true;
  }

  async function importMidiFile(file: { name: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<void> {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const inspection = bmh.inspectMidi(bytes);
      openBmhSettingModal(file.name, bytes, inspection.tracks);
    } catch (err) {
      store.setStatus("bmhOpenFailed", { message: errorMessage(err) }, true);
    }
  }

  async function openBmhFile(file: { name: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<void> {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      bmh.openProject(bytes, file.name);
      store.setStatus("bmhProjectOpened", { file: file.name });
      bmhSync();
    } catch (err) {
      store.setStatus("bmhOpenFailed", { message: errorMessage(err) }, true);
    }
  }

  function openBmhSettingModal(name: string, bytes: Uint8Array, tracks: { index: number; name: string; noteCount: number }[]): void {
    pendingBmhImport = { name, bytes };
    const select = el<HTMLSelectElement>("bmh-in-track");
    select.innerHTML = "";
    for (const track of tracks) {
      const option = document.createElement("option");
      option.value = String(track.index);
      option.textContent = `${String(track.index).padStart(2, "0")}: ${track.name || "(no name)"} — ${track.noteCount}n`;
      select.append(option);
    }
    const channelHost = el<HTMLSpanElement>("bmh-in-channels");
    channelHost.innerHTML = "";
    for (let c = 0; c < 16; c++) {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = true;
      box.id = `bmh-in-ch-${c}`;
      const label = document.createElement("label");
      label.style.marginRight = "4px";
      label.append(box, document.createTextNode(String(c).padStart(2, "0")));
      channelHost.append(label);
    }
    el<HTMLInputElement>("bmh-in-name").value = `division ${bmh.state?.divisions.length ? bmh.state.divisions.length + 1 : 1}`;
    el<HTMLDivElement>("bmh-setting-modal").classList.remove("hidden");
  }

  let pendingBmhImport: { name: string; bytes: Uint8Array } | null = null;

  el<HTMLButtonElement>("btn-bmh-open").addEventListener("click", () => {
    void api()
      .openMidiDialog()
      .then(async (path) => {
        if (path) await importMidiFile({ name: path.split(/[\\/]/).pop() ?? path, arrayBuffer: async () => {
          const bytes = await api().readMidiFile(path);
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        } });
      })
      .catch(() => undefined);
  });
  el<HTMLButtonElement>("btn-bmh-open-project").addEventListener("click", () => {
    void api()
      .openBmhDialog()
      .then(async (path) => {
        if (!path) return;
        const bytes = await api().readBmhFile(path);
        bmh.openProject(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), path.split(/[\\/]/).pop() ?? path);
        store.setStatus("bmhProjectOpened", { file: path.split(/[\\/]/).pop() ?? path });
        bmhSync();
      })
      .catch((err) => store.setStatus("bmhOpenFailed", { message: errorMessage(err) }, true));
  });
  el<HTMLButtonElement>("btn-bmh-save-project").addEventListener("click", () => {
    if (!bmhGuard(() => undefined, false)) return;
    void api()
      .saveBmhDialog(`${bmh.name || "project"}.bmh`)
      .then(async (path) => {
        if (!path) return;
        await api().writeBmhFile(path, bmh.saveProjectBytes());
        store.setStatus("bmhProjectSaved", { file: path.split(/[\\/]/).pop() ?? path });
      })
      .catch((err) => store.setStatus("bmhOpenFailed", { message: errorMessage(err) }, true));
  });
  el<HTMLButtonElement>("btn-bmh-setting-ok").addEventListener("click", () => {
    if (!pendingBmhImport) return;
    try {
      const trackIndex = Number(el<HTMLSelectElement>("bmh-in-track").value);
      const channels = new Set<number>();
      for (let c = 0; c < 16; c++) {
        if (el<HTMLInputElement>(`bmh-in-ch-${c}`).checked) channels.add(c);
      }
      // The project is created HERE, after the track/channel selection.
      bmh.importMidi(pendingBmhImport.bytes, pendingBmhImport.name, trackIndex, channels);
      const project = bmh.state;
      if (!project) return;
      const tpq = project.source.quantize;
      const name = el<HTMLInputElement>("bmh-in-name").value.trim() || `division ${project.divisions.length + 1}`;
      const setting: DivisionSetting = {
        name,
        srcCopy: el<HTMLInputElement>("bmh-in-src-copy").checked,
        headMargin: Math.max(0, Math.trunc(Number(el<HTMLInputElement>("bmh-in-head").value) * tpq)),
        minInterval: Math.max(0, Math.trunc(Number(el<HTMLInputElement>("bmh-in-interval").value) * tpq)),
        sortType: el<HTMLSelectElement>("bmh-in-sort").value as DivisionSetting["sortType"],
        gateThreshold: Math.max(0, Math.trunc(Number(el<HTMLInputElement>("bmh-in-gate").value) * tpq)),
        velocityThreshold: Math.max(0, Math.trunc(Number(el<HTMLInputElement>("bmh-in-vel").value))),
        zzDefinition: el<HTMLInputElement>("bmh-in-zz").checked,
        mlDefinition: el<HTMLInputElement>("bmh-in-ml").checked,
        startDefinition: parseBmhStart(el<HTMLInputElement>("bmh-in-start").value),
        mlThreshold: Math.max(0, Math.trunc(Number(el<HTMLInputElement>("bmh-in-ml").value) * tpq)),
      };
      bmh.addDivision(project.source, setting);
      store.setStatus("bmhDivisionCreated", { notes: bmh.selectedDivision?.recording.length ?? 0, defs: bmh.selectedDivision?.definitions.length ?? 0 });
      el<HTMLDivElement>("bmh-setting-modal").classList.add("hidden");
      pendingBmhImport = null;
      bmhSync();
    } catch (err) {
      store.setStatus("bmhOpenFailed", { message: errorMessage(err) }, true);
    }
  });
  el<HTMLButtonElement>("btn-bmh-setting-cancel").addEventListener("click", () => {
    el<HTMLDivElement>("bmh-setting-modal").classList.add("hidden");
    pendingBmhImport = null;
  });
  el<HTMLButtonElement>("btn-bmh-new").addEventListener("click", () => {
    if (!bmhGuard(() => undefined, false)) return;
    const tpq = bmh.state?.source.quantize ?? 480;
    const defaults = defaultDivisionSetting(`division ${(bmh.state?.divisions.length ?? 0) + 1}`, tpq);
    el<HTMLInputElement>("bmh-in-name").value = defaults.name;
    el<HTMLInputElement>("bmh-in-head").value = String(defaults.headMargin / tpq);
    el<HTMLInputElement>("bmh-in-interval").value = String(defaults.minInterval / tpq);
    el<HTMLInputElement>("bmh-in-gate").value = String(defaults.gateThreshold / tpq);
    el<HTMLInputElement>("bmh-in-vel").value = String(defaults.velocityThreshold);
    el<HTMLInputElement>("bmh-in-start").value = zzStringOf(defaults.startDefinition);
    el<HTMLInputElement>("bmh-in-ml").value = String(defaults.mlThreshold / tpq);
    el<HTMLDivElement>("bmh-setting-modal").classList.remove("hidden");
  });
  el<HTMLButtonElement>("btn-bmh-delete").addEventListener("click", () => {
    if (!bmhGuard(() => undefined, true)) return;
    bmh.deleteDivision(bmh.selectedIndex);
    store.setStatus("bmhDivisionDeleted");
    bmhSync();
  });
  el<HTMLButtonElement>("btn-bmh-export-midi").addEventListener("click", () => {
    if (!bmhGuard(() => undefined, true)) return;
    void api()
      .saveMidiDialog(`${bmh.selectedDivision?.name ?? "recording"}.mid`)
      .then(async (path) => {
        if (!path) return;
        await api().writeMidiFile(path, bmh.exportMidiBytes());
        store.setStatus("bmhMidiExported", { file: path.split(/[\\/]/).pop() ?? path });
      })
      .catch((err) => store.setStatus("bmhOpenFailed", { message: errorMessage(err) }, true));
  });
  el<HTMLButtonElement>("btn-bmh-apply").addEventListener("click", () => {
    if (!bmhGuard(() => undefined, true)) return;
    const division = bmh.selectedDivision;
    if (!division) return;
    const bitmap = new Uint8Array(BMH_MAX_TICKS);
    let applied = 0;
    let dropped = 0;
    for (const note of division.recording) {
      const tick = Math.trunc((note.position * 48) / division.quantize);
      if (tick >= 0 && tick < BMH_MAX_TICKS && !tickBeyondEnd(tick)) {
        bitmap[tick] = 1;
        applied += 1;
      } else {
        dropped += 1;
      }
    }
    if (applied === 0) {
      store.setStatus("bmhNoDivision", undefined, true);
      return;
    }
    store.state.doc.replaceBitmap(bitmap);
    store.update({ selectedTicks: [], selectionStartTick: null, selectionEndTick: null });
    if (dropped > 0) store.setStatus("bmhAppliedDropped", { count: applied, dropped });
    else store.setStatus("bmhApplied", { count: applied });
    redraw();
  });
  el<HTMLButtonElement>("btn-bmh-copy-cuts").addEventListener("click", () => {
    const division = bmh.selectedDivision;
    if (!bmhGuard(() => undefined, true) || !division) return;
    void api()
      .writeBmseClipboard(cutPositionsClipboard(division))
      .then(() => store.setStatus("bmhCutsCopied", { count: division.recording.length }))
      .catch((err) => store.setStatus("bmhOpenFailed", { message: errorMessage(err) }, true));
  });
  el<HTMLButtonElement>("btn-bmh-copy-bms").addEventListener("click", () => {
    if (!bmhGuard(() => undefined, true)) return;
    const source = bmh.state?.source;
    if (!source || !bmh.selectedDivision) return;
    void api()
      .writeBmseClipboard(bmsSequenceClipboard(bmh.selectedDivision, source))
      .then(() => store.setStatus("bmhBmsCopied", { count: source.notes.length }))
      .catch((err) => store.setStatus("bmhOpenFailed", { message: errorMessage(err) }, true));
  });
  el<HTMLButtonElement>("btn-bmh-copy-defs").addEventListener("click", () => {
    const division = bmh.selectedDivision;
    if (!bmhGuard(() => undefined, true) || !division) return;
    el<HTMLInputElement>("bmh-in-filename").value = bmh.name;
    el<HTMLTextAreaElement>("bmh-defs-text").value = wavDefinitionText(division, bmh.name);
    el<HTMLDivElement>("bmh-defs-modal").classList.remove("hidden");
  });
  el<HTMLInputElement>("bmh-in-filename").addEventListener("input", (e) => {
    const division = bmh.selectedDivision;
    if (!division) return;
    el<HTMLTextAreaElement>("bmh-defs-text").value = wavDefinitionText(division, (e.target as HTMLInputElement).value);
  });
  el<HTMLButtonElement>("btn-bmh-defs-copy").addEventListener("click", () => {
    void api()
      .writeBmseClipboard(el<HTMLTextAreaElement>("bmh-defs-text").value)
      .then(() => store.setStatus("bmhDefsCopied", { count: bmh.selectedDivision?.definitions.length ?? 0 }))
      .catch(() => undefined);
  });
  el<HTMLButtonElement>("btn-bmh-defs-close").addEventListener("click", () => {
    el<HTMLDivElement>("bmh-defs-modal").classList.add("hidden");
  });
  el<HTMLButtonElement>("btn-bmh-shift-left").addEventListener("click", () => {
    if (bmhGuard(() => undefined, true)) { bmh.transpose(-1); bmhSync(); }
  });
  el<HTMLButtonElement>("btn-bmh-shift-right").addEventListener("click", () => {
    if (bmhGuard(() => undefined, true)) { bmh.transpose(1); bmhSync(); }
  });
  el<HTMLButtonElement>("btn-bmh-start-number").addEventListener("click", () => {
    if (!bmhGuard(() => undefined, true)) return;
    const current = bmh.selectedDivision?.definitions[0]?.zz ?? 1;
    const entered = window.prompt(tr("bmhStartNumber"), zzStringOf(current));
    if (entered === null) return;
    const parsed = parseBmhStart(entered);
    bmh.setStart(parsed);
    bmhSync();
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
    transport.setVolume(store.state.volume);
    syncTapOffsetDisplay();
    renderStatusBar();
    updateReadout();
    redraw();
    animate();
  } catch (err) {
    (window as unknown as { __bootError: string }).__bootError =
      err instanceof Error ? `${err.message}
${err.stack ?? ""}` : String(err);
    throw err;
  }
});

