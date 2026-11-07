/**
 * Renderer application state. Single store, explicit transitions; views
 * subscribe via a simple listener list. No framework.
 */

import { gridStepTicks } from "../core/gridlines.js";
import { MarkerDoc } from "../core/markers.js";
import { DEFAULT_PLAYBACK_RATE } from "../core/rate.js";
import { PeakCache } from "../core/peaks.js";
import { resolveBreakpointTick } from "../core/timebase.js";
import { BandAnalysis, BandName } from "../core/bands.js";
import { dbToAmp, DEFAULT_CUE_DB, DEFAULT_PLAYBACK_DB } from "../core/volume.js";
import type { FormatParams, StatusKey } from "../core/messages.js";

export type Phase = "empty" | "parsing" | "ready";
export type CueMode = "off" | "cowbell" | "triangle" | "metronome";

/**
 * A status-bar message: one or more stable template segments. The language is
 * applied only at render time (each segment is translated and the segments
 * are joined with " · "), so switching the UI language re-renders the current
 * message without re-deriving it from a string.
 */
export interface StatusSegment {
  key: StatusKey;
  params?: FormatParams;
}

export interface StatusEntry {
  segments: StatusSegment[];
}

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
  status: StatusEntry;
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
  /** Monitor volume for playback and previews (amplitude 0..1). */
  volume: number;
  /** RMS band visibility in the waveform (session-only, default off). */
  rmsVisible: boolean;
  /**
   * Monitor playback rate (0.25x .. 1.5x). Persists across pause/stop; never
   * affects marker ticks, slice lengths or exports (those are source-time 1x).
   */
  playbackRate: number;
  followPlayhead: boolean;
  cueMode: CueMode;
  cueVolume: number;
  noisegateEnabled: boolean;
  baseName: string;
  clipStartNumber: number;
  useFfNumbering: boolean;
  measureClipboard: Uint8Array | null;
  exportLock: boolean;
  /** Band overlay display toggle (session-only, never written into .wos). */
  bandsVisible: boolean;
  /** Lazily computed three-band analysis of the loaded source. */
  bandAnalysis: BandAnalysis | null;
  /** Band-detect panel parameters. */
  bandDetectBands: Record<BandName, boolean>;
  bandThresholdDb: number;
  bandMinGapUnits: number;
  /** Band detect: snap hits to the grid (off = exact onset tick). */
  bandSnap: boolean;
  /**
   * Tap-calibration latency in ms (median tap minus beat). Enter break points
   * placed during playback subtract this before resolving the tick.
   */
  tapOffsetMs: number;
  /** Live estimate for the Detect button; null = not computed yet. */
  bandEstimate: number | null;
  bandBusy: boolean;
}

type Listener = () => void;

export class Store {
  private listeners: Listener[] = [];

  state: ViewState = {
    phase: "empty",
    status: { segments: [{ key: "statusEmpty" }] },
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
    volume: dbToAmp(DEFAULT_PLAYBACK_DB),
    playbackRate: DEFAULT_PLAYBACK_RATE,
    followPlayhead: true,
    cueMode: "off",
    cueVolume: dbToAmp(DEFAULT_CUE_DB),
    noisegateEnabled: true,
    baseName: "slice",
    clipStartNumber: 1,
    useFfNumbering: false,
    measureClipboard: null,
    exportLock: false,
    bandsVisible: false,
    rmsVisible: false,
    bandAnalysis: null,
    bandDetectBands: { low: true, mid: true, high: true },
    bandThresholdDb: 6,
    bandMinGapUnits: 1,
    bandSnap: true,
    tapOffsetMs: 0,
    bandEstimate: null,
    bandBusy: false,
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

  /**
   * Records a status message. Accepted shapes: a bare template key, a key
   * with placeholder values (optionally followed by an isError flag), a full
   * segment object, or a segment array for composed lines (joined with
   * " · " at render time).
   */
  setStatus(
    message: StatusKey | StatusSegment | StatusSegment[],
    paramsOrIsError?: FormatParams | boolean,
    isError = false,
  ): void {
    const params = typeof paramsOrIsError === "object" ? paramsOrIsError : undefined;
    const segments: StatusSegment[] = Array.isArray(message)
      ? message
      : typeof message === "string"
        ? [{ key: message, params }]
        : [message];
    this.update({ status: { segments }, isError: typeof paramsOrIsError === "boolean" ? paramsOrIsError : isError });
  }

  /** Visible tick range for the current scroll/zoom. */
  visibleTicks(widthPx: number): { from: number; to: number } {
    const from = this.state.scrollTick;
    const to = from + widthPx / this.state.pxPerTick;
    return { from, to };
  }

  /**
   * Snap-aware tick: nearest grid multiple when Snap is on, never out of range.
   * state.grid is a DENSITY (cells per measure), so it is converted to the
   * cell width in ticks first — snapping to raw state.grid would snap every
   * N ticks and disagree with the drawn grid by a factor of the measure width.
   */
  snapTick(tick: number): number {
    return resolveBreakpointTick(tick, this.state.snap, gridStepTicks(this.state.grid), false);
  }

  zoomAt(anchorTick: number, factor: number): void {
    const { pxPerTick } = this.state;
    // The ceiling scales with the time base: deep zoom exists to inspect
    // individual samples, so the maximum puts ~4 CSS px on every sample
    // (stems take over at 3 px per sample; at 120 BPM / 48 kHz one tick is
    // 500 frames, which tops out at 2000 px/tick). The floor keeps the old
    // ceiling for extreme time bases where 4 px/sample would be less.
    const framesPerTick = this.state.source
      ? (this.state.source.sampleRate * 5) / (this.state.doc.bpm * 4)
      : 500;
    const next = Math.max(0.02, Math.min(Math.max(600, 4 * framesPerTick), pxPerTick * factor));
    if (next === pxPerTick) return;
    // Keep the tick under the anchor visually fixed.
    const anchorPx = (anchorTick - this.state.scrollTick) * pxPerTick;
    const scrollTick = Math.max(0, anchorTick - anchorPx / next);
    this.update({ pxPerTick: next, scrollTick });
  }

}
