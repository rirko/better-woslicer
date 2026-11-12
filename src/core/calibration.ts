/**
 * Tap calibration: the user taps Enter along with 16 quarter-note clicks at
 * the project BPM. The median tap-to-beat offset (ms) is the latency to
 * subtract from Enter break-point placements during playback (audio output
 * latency + human reaction + key input all show up as a consistent late bias).
 *
 * Pure math only — the renderer owns the AudioContext and timing.
 */

export const DEFAULT_CALIBRATION_BEATS = 16;

/**
 * Reference tempo for the single-beat fallback match: a tap counts when it
 * lands within half a 120 BPM quarter note (250 ms) of the reference beat.
 * Deliberately loose — with one anchor beat there is no interval to trust.
 */
export const REFERENCE_TAP_BPM = 120;

/** Quarter-note interval in milliseconds for the given BPM. */
export function beatIntervalMs(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) throw new RangeError(`bpm must be positive (got ${bpm})`);
  return 60000 / bpm;
}

/** Reference beat times relative to the first beat (0, interval, 2*interval, ...). */
export function beatTimesMs(bpm: number, beats = DEFAULT_CALIBRATION_BEATS): number[] {
  const interval = beatIntervalMs(bpm);
  return Array.from({ length: beats }, (_, i) => i * interval);
}

export interface CalibrationResult {
  /** Number of taps recorded. */
  total: number;
  /** Taps matched to a beat within half a beat interval. */
  matched: number;
  medianMs: number;
  meanMs: number;
  stdMs: number;
  /** Signed offsets (tap - beat) of the matched taps. */
  offsetsMs: number[];
}

/**
 * Matches each tap to its nearest reference beat and summarises the signed
 * offsets. Taps further than half a beat from every beat are ignored (they
 * cannot be attributed to a specific click). Median is the value the UI
 * applies because it is robust against one or two missed/double taps.
 */
export function analyzeTaps(
  tapTimesMs: readonly number[],
  beatsMs: readonly number[],
): CalibrationResult {
  const offsets: number[] = [];
  if (beatsMs.length > 1) {
    const interval = beatsMs[1] - beatsMs[0];
    const tolerance = interval / 2;
    for (const tap of tapTimesMs) {
      let best = Number.POSITIVE_INFINITY;
      for (const beat of beatsMs) {
        const delta = tap - beat;
        if (Math.abs(delta) < Math.abs(best)) best = delta;
      }
      if (Number.isFinite(best) && Math.abs(best) <= tolerance) offsets.push(best);
    }
  } else if (beatsMs.length === 1) {
    for (const tap of tapTimesMs) {
      const delta = tap - beatsMs[0];
      if (Math.abs(delta) <= beatIntervalMs(REFERENCE_TAP_BPM) / 2) offsets.push(delta);
    }
  }

  const sorted = [...offsets].sort((a, b) => a - b);
  const median = sorted.length
    ? sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : 0;
  const mean = offsets.length ? offsets.reduce((s, v) => s + v, 0) / offsets.length : 0;
  const variance = offsets.length
    ? offsets.reduce((s, v) => s + (v - mean) * (v - mean), 0) / offsets.length
    : 0;
  return {
    total: tapTimesMs.length,
    matched: offsets.length,
    medianMs: median,
    meanMs: mean,
    stdMs: Math.sqrt(variance),
    offsetsMs: offsets,
  };
}

/** Converts a latency in milliseconds into source samples (rounded). */
export function latencySamples(offsetMs: number, sampleRate: number): number {
  return Math.round((offsetMs / 1000) * sampleRate);
}
