/**
 * Variable-speed monitor playback (pure logic, no DOM / Web Audio).
 *
 * The rate only affects monitoring: marker ticks, slice lengths and exports
 * are always computed on source time at 1x. The transport re-anchors the
 * playhead when the rate changes so the displayed position never jumps.
 */

/** Frozen rate ladder for the transport select and the [ / ] keys. */
export const PLAYBACK_RATES: readonly number[] = [0.25, 0.5, 0.75, 1.0, 1.5];

export const DEFAULT_PLAYBACK_RATE = 1.0;

export interface RateStep {
  /** The rate after stepping (== input when clamped at an endpoint). */
  rate: number;
  /** True when the step was refused because the ladder endpoint was reached. */
  clamped: boolean;
}

/**
 * Moves through the rate ladder one notch per call, clamping at 0.25 / 1.5
 * without wrapping. Unknown current values fall back to the default notch.
 */
export function stepPlaybackRate(current: number, direction: -1 | 1): RateStep {
  let index = PLAYBACK_RATES.indexOf(current);
  if (index < 0) index = PLAYBACK_RATES.indexOf(DEFAULT_PLAYBACK_RATE);
  const nextIndex = index + direction;
  if (nextIndex < 0) return { rate: PLAYBACK_RATES[0], clamped: true };
  if (nextIndex >= PLAYBACK_RATES.length) {
    return { rate: PLAYBACK_RATES[PLAYBACK_RATES.length - 1], clamped: true };
  }
  return { rate: PLAYBACK_RATES[nextIndex], clamped: false };
}

/** Human-readable rate label, e.g. "0.25x" / "1.0x" / "1.5x" (U+00D7 sign). */
export function formatRate(rate: number): string {
  return `${rate.toFixed(2).replace(/0$/, "")}\u00d7`;
}

/**
 * Anchor math for `currentSample()` while playing:
 *   sample = startOffset + elapsedSeconds * rate * sampleRate
 * Keeping this pure lets the transport's re-anchoring be unit-tested without
 * an AudioContext.
 */
export function advanceSamples(
  startOffset: number,
  elapsedSeconds: number,
  rate: number,
  sampleRate: number
): number {
  return startOffset + elapsedSeconds * rate * sampleRate;
}

/**
 * Playhead sample position at the moment of a rate change. The transport sets
 * startOffset to this value and startedAt to ctx.currentTime before applying
 * the new rate, which makes currentSample() continuous across the switch.
 */
export function reanchorSample(
  startOffset: number,
  elapsedSeconds: number,
  oldRate: number,
  sampleRate: number
): number {
  return advanceSamples(startOffset, elapsedSeconds, oldRate, sampleRate);
}
