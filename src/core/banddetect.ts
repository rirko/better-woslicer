/**
 * Band-detect: rising-loudness onset detection over the per-band RMS
 * envelopes produced by core/bands.ts.
 *
 * Contract:
 *  - a hit is a rise of >= thresholdDb that stays up for `sustainFrames`
 *    (2 frames = 20 ms at the default 10 ms hop), measured either
 *      (a) against the previous frame (fast attack: catches short percussive
 *          hits that a longer sustain test used to miss), or
 *      (b) against the QUIETEST level of the previous 200 ms (noise floor,
 *          so a loud hit inside an already loud passage still counts — the
 *          old mean baseline made big hits look small there),
 *  - the marker goes at the ONSET frame, snapped to the current grid,
 *  - results are restricted to [fromTick, toTick] when a range is given,
 *  - existing markers and hits closer than minGapTicks are skipped,
 *  - detection only ever ADDS markers.
 */

import { BandAnalysis, BandName, BAND_NAMES } from "./bands.js";
import { MAX_TICKS, TimeBase, sampleToTickNearest } from "./timebase.js";

export interface RiseParams {
  thresholdDb: number;
  /** Consecutive frames above the threshold before a hit counts (20 ms). */
  sustainFrames?: number;
  /** Frames of history used for the baseline comparison (200 ms). */
  baselineFrames?: number;
  /**
   * Absolute RMS level floor in dBFS. A band that sits below this is treated
   * as silent: its noise wiggle must not be cut. Default -60 dBFS.
   */
  absoluteFloorDb?: number;
}

const SILENCE_DB = -140;
const DEFAULT_ABSOLUTE_FLOOR_DB = -60;

/**
 * 20th-percentile of the previous `baselineFrames` dB values. Using a low
 * percentile (instead of the extreme minimum) keeps the reference stable for
 * noise-like bands: one deep noise dip must not turn every later wiggle into
 * a "rise".
 */
function lowPercentile(values: Float32Array, from: number, to: number, fraction = 0.2): number {
  const count = to - from;
  if (count <= 0) return SILENCE_DB;
  const sorted = Array.from(values.subarray(from, to)).sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * fraction)));
  return sorted[index];
}

/** Upward-loudness onsets as sample positions. */
export function detectRiseOnsets(rms: Float32Array, hopSamples: number, params: RiseParams): number[] {
  const sustain = Math.max(1, Math.floor(params.sustainFrames ?? 2));
  const baselineFrames = Math.max(2, Math.floor(params.baselineFrames ?? 20));
  const absoluteFloorDb = params.absoluteFloorDb ?? DEFAULT_ABSOLUTE_FLOOR_DB;
  const n = rms.length;
  if (n === 0) return [];

  // dB per frame (clamped so log10 never hits -infinity).
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    db[i] = rms[i] > 0 ? Math.max(SILENCE_DB, 20 * Math.log10(rms[i])) : SILENCE_DB;
  }

  const onsets: number[] = [];
  let runStart = -1;
  let emitted = false;
  let runPeakDb = SILENCE_DB;
  for (let i = 1; i < n; i++) {
    // Ignore bands that are essentially silent at this frame: without this
    // the high band of a low-frequency-heavy mix would cut inaudible noise
    // wiggles (the "obviously wrong" markers on a High-only detection).
    if (db[i] < absoluteFloorDb) {
      runStart = -1;
      emitted = false;
      runPeakDb = SILENCE_DB;
      continue;
    }
    const floorDb = lowPercentile(db, Math.max(0, i - baselineFrames), i);
    const riseFromFloor = db[i] - floorDb >= params.thresholdDb;
    const riseFromPrev = db[i] - db[i - 1] >= params.thresholdDb;
    const rise = riseFromFloor || riseFromPrev;
    if (rise) {
      if (runStart < 0) {
        runStart = i;
        emitted = false;
        runPeakDb = db[i];
      } else if (emitted && db[i] - runPeakDb >= params.thresholdDb) {
        // A NEW attack inside a run that the baseline criterion keeps alive
        // (e.g. a louder hit while the old passage is still within the
        // 200 ms window). Without this the run's single emission used to
        // swallow every louder hit that followed a quieter onset.
        onsets.push(i * hopSamples);
        runPeakDb = db[i];
      }
      if (!emitted && i - runStart + 1 >= sustain) {
        onsets.push(runStart * hopSamples);
        emitted = true;
      }
      if (db[i] > runPeakDb) runPeakDb = db[i];
    } else {
      runStart = -1;
      emitted = false;
      runPeakDb = SILENCE_DB;
    }
  }
  return onsets;
}

export interface DetectRequest {
  analysis: BandAnalysis;
  bands: readonly BandName[];
  thresholdDb: number;
  grid: number;
  minGapTicks: number;
  fromTick: number;
  toTick: number;
  base: TimeBase;
  existing: ReadonlySet<number>;
  /**
   * Snap hits to the nearest grid tick (default). When false the marker goes
   * at the exact onset tick — a coarse grid can otherwise move a sharp attack
   * by up to half a cell, which visually lands on the decay of the sound.
   */
  snap?: boolean;
}

export interface DetectResult {
  ticks: number[];
  /** Hits dropped because they were closer than minGapTicks to the last kept one. */
  skippedGap: number;
  /** Hits dropped because that tick already had a marker. */
  existing: number;
  /** Raw onset count before tick snapping/filtering. */
  onsets: number;
}

/**
 * Runs the detection over the selected bands (all channels, union) and maps
 * the onsets onto grid-snapped ticks within the requested range.
 */
export function detectBandCuts(req: DetectRequest): DetectResult {
  const grid = Math.max(1, Math.floor(req.grid));
  const samples = new Set<number>();
  for (const band of req.bands) {
    if (!BAND_NAMES.includes(band)) continue;
    const signal = req.analysis[band];
    for (const rms of signal.rms) {
      for (const sample of detectRiseOnsets(rms, req.analysis.hopSamples, { thresholdDb: req.thresholdDb })) {
        samples.add(sample);
      }
    }
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const ticks: number[] = [];
  let skippedGap = 0;
  let existing = 0;
  let lastKept = Number.NEGATIVE_INFINITY;

  for (const sample of sorted) {
    const rawTick = sampleToTickNearest(sample, req.base);
    const snapped = req.snap === false
      ? Math.max(0, Math.min(MAX_TICKS - 1, rawTick))
      : Math.max(0, Math.min(MAX_TICKS - 1, Math.round(rawTick / grid) * grid));
    if (snapped < req.fromTick || snapped > req.toTick) continue;
    if (req.existing.has(snapped)) {
      existing++;
      continue;
    }
    if (snapped === lastKept) continue;
    if (snapped - lastKept < req.minGapTicks) {
      skippedGap++;
      continue;
    }
    ticks.push(snapped);
    lastKept = snapped;
  }

  return { ticks, skippedGap, existing, onsets: sorted.length };
}
