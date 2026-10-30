/**
 * Renderer application state. Single store, explicit transitions; views
 * subscribe via a simple listener list. No framework.
 */

import { MarkerDoc } from "../core/markers.js";
import { PeakCache } from "../core/peaks.js";
import { MAX_TICKS } from "../core/timebase.js";

export type Phase = "empty" | "parsing" | "ready";
export type CueMode = "off" | "cowbell" | "triangle" | "metronome";

export interface SourceInfo {
  path: string;
  name: string;
  sampleRate: number;
  channels: number;
  length: number;
  /** Internal int16 representation (reconstructed from IPC buffers). */
  data: Int16Array[];
  /** Float copies for Web Audio playback. */
  floatData: Float32Array[];
}

export interface ViewState {
  phase: Phase;
  statusText: string;
  isError: boolean;
  source: SourceInfo | null;
  peaks: PeakCache | null;
  doc: MarkerDoc;
  grid: number;
  snap: boolean;
  pxPerTick: number;
  scrollTick: number;
  cursorTick: number;
  selectionStartTick: number | null;
  selectionEndTick: number | null;
  selectedTicks: number[];
  playing: boolean;
  playheadSample: number;
  followPlayhead: boolean;
  cueMode: CueMode;
  cueVolume: number;
  noisegateEnabled: boolean;
  baseName: string;
  clipStartNumber: number;
  useFfNumbering: boolean;
  measureClipboard: Uint8Array | null;
  exportLock: boolean;
}

type Listener = () => void;

export class Store {
  private listeners: Listener[] = [];

  state: ViewState = {
    phase: "empty",
    statusText: "Empty: drop a WAV/OGG file to begin",
    isError: false,
    source: null,
    peaks: null,
    doc: new MarkerDoc(120, 0, 0, -48),
    grid: 8,
    snap: true,
    pxPerTick: 6,
    scrollTick: 0,
    cursorTick: 0,
    selectionStartTick: null,
    selectionEndTick: null,
    selectedTicks: [],
    playing: false,
    playheadSample: 0,
    followPlayhead: true,
    cueMode: "off",
    cueVolume: 0.6,
    noisegateEnabled: true,
    baseName: "slice",
    clipStartNumber: 1,
    useFfNumbering: false,
    measureClipboard: null,
    exportLock: false,
  };

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  update(patch: Partial<ViewState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  setStatus(text: string, isError = false): void {
    this.update({ statusText: text, isError });
  }

  /** Visible tick range for the current scroll/zoom. */
  visibleTicks(widthPx: number): { from: number; to: number } {
    const from = this.state.scrollTick;
    const to = from + widthPx / this.state.pxPerTick;
    return { from, to };
  }

  snapTick(tick: number): number {
    if (!this.state.snap) return Math.max(0, Math.min(MAX_TICKS - 1, Math.round(tick)));
    const g = this.state.grid;
    return Math.max(0, Math.min(MAX_TICKS - 1, Math.round(tick / g) * g));
  }

  zoomAt(anchorTick: number, factor: number): void {
    const { pxPerTick } = this.state;
    const next = Math.max(0.02, Math.min(120, pxPerTick * factor));
    if (next === pxPerTick) return;
    // Keep the tick under the anchor visually fixed.
    const anchorPx = (anchorTick - this.state.scrollTick) * pxPerTick;
    const scrollTick = Math.max(0, anchorTick - anchorPx / next);
    this.update({ pxPerTick: next, scrollTick });
  }

}
