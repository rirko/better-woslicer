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
import { MAX_TICKS, tickToSampleExport } from "../core/timebase.js";
import { Store } from "./store.js";
import { TimelineView } from "./waveform.js";
import { Transport } from "./transport.js";
import { Interactions } from "./interactions.js";
import { handleKeyDown, KeyActions } from "./keys.js";

const store = new Store();
const transport = new Transport(store);

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

function redraw(): void {
  view.drawRuler();
  view.drawWave();
  view.drawOverlay(interactions.currentGhost());
  view.drawOverview();
  updateScrollbar();
  updateReadout();
  updateCutList();
  updateCommandStates();
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

// Single render path for the status bar: every store.setStatus (from actions,
// interactions, transport) flows through the subscription into the DOM.
let lastRenderedStatus = "";
let lastRenderedError: boolean | null = null;
store.subscribe(() => {
  const s = store.state;
  if (s.statusText !== lastRenderedStatus || s.isError !== lastRenderedError) {
    lastRenderedStatus = s.statusText;
    lastRenderedError = s.isError;
    const bar = el<HTMLElement>("status-bar");
    bar.classList.toggle("error", s.isError);
    el<HTMLSpanElement>("status-main").textContent = s.statusText;
  }
  updateCommandStates();
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
  });
  el<HTMLInputElement>("input-basename").value = info.name.replace(/[^\w.-]/g, "_");
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
  playPauseOrBreakPoint(): void {
    if (transport.isPlaying()) {
      // Break point: drop a marker at the current playhead position.
      const s = store.state;
      const tick = Math.max(
        0,
        Math.min(
          MAX_TICKS - 1,
          Math.round((s.playheadSample * 4 * s.doc.bpm) / (s.source!.sampleRate * 5) - s.doc.shift)
        )
      );
      store.update({ cursorTick: tick });
      store.state.doc.setMarker(tick, true);
      store.setStatus(`Break point at tick ${tick}`);
    } else {
      transport.togglePlayPause();
      store.setStatus(transport.isPlaying() ? "Playing" : "Paused");
    }
    redraw();
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
    if (!s.doc.quantizeSelection(s.selectedTicks, s.grid)) {
      store.setStatus("Selected markers already on grid");
      return;
    }
    const snapped = [
      ...new Set(
        s.selectedTicks
          .map((t) => Math.max(0, Math.min(MAX_TICKS - 1, Math.round(t / s.grid) * s.grid)))
          .filter((t) => s.doc.markers[t] === 1)
      ),
    ];
    store.update({ selectedTicks: snapped });
    store.setStatus(`Quantized selected marker(s) to grid ${s.grid}`);
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
  });

  el<HTMLButtonElement>("btn-play").addEventListener("click", () => actions.playPauseOrBreakPoint());
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

/* Playhead animation + status sync loop. */
function animate(): void {
  const s = store.state;
  if (s.playing) {
    view.drawOverlay(interactions.currentGhost());
    updateReadout();
  }
  requestAnimationFrame(animate);
}

window.addEventListener("DOMContentLoaded", () => {
  try {
    wireDom();
    interactions.attach();
    transport.setCueVolume(store.state.cueVolume);
    redraw();
    animate();
  } catch (err) {
    (window as unknown as { __bootError: string }).__bootError =
      err instanceof Error ? `${err.message}
${err.stack ?? ""}` : String(err);
    throw err;
  }
});

