/**
 * Tick/sample time base, compatible with woslicerIII.
 *
 * - One measure is 192 ticks; the marker timeline is 49152 ticks (256 measures).
 * - Sample position of a tick: sample = (tick + shift) * sampleRate * 5 / (4 * bpm).
 *
 * The original uses two different conversions:
 *  - DoPrev (preview / file export): pure float64 arithmetic.
 *  - ToSample2 (view/cursor mapping): explicit float32 roundings.
 * Both are provided here; do not interchange them.
 */

import { f32, toInt32 } from "./float32.js";

export const MEASURE_TICKS = 192;
export const MAX_TICKS = 49152;
/** Total bytes of the marker bitmap embedded in a .wos file (49152 bits). */
export const BITMAP_BYTES = MAX_TICKS / 8;

export interface TimeBase {
  bpm: number;
  shift: number;
  sampleRate: number;
}

/**
 * DoPrev conversion (export / preview positions), float64 all the way:
 *   (int)((tick + shift) * ratio / bpm * 5.0 / 4.0)
 * Operation order matches the original IL exactly.
 */
export function tickToSampleExport(tick: number, base: TimeBase): number {
  return toInt32(((tick + base.shift) * base.sampleRate) / base.bpm * 5.0 / 4.0);
}

/**
 * ToSample2 conversion (cursor/measure mapping), with the original's float32
 * roundings:
 *   (int)((double)(f32(f32(f32(tick + shift) * (float)ratio) * 5f) / 4f) / bpm)
 */
export function tickToSampleView(tick: number, base: TimeBase): number {
  const scaled = f32(f32(f32(tick + base.shift) * f32(base.sampleRate)) * 5.0) / 4.0;
  return toInt32(scaled / base.bpm);
}

/** Samples contained in one measure under the export conversion. */
export function measureSamples(base: TimeBase): number {
  return tickToSampleExport(MEASURE_TICKS, base) - tickToSampleExport(0, base);
}

/** Inverse of tickToSampleExport: nearest tick whose sample position is >= sample. */
export function sampleToTickFloor(sample: number, base: TimeBase): number {
  // tick = sample * bpm * 4 / (sampleRate * 5) - shift, evaluated in double.
  const approx = (sample * base.bpm * 4) / (base.sampleRate * 5) - base.shift;
  const tick = Math.floor(approx);
  // Guard against double rounding at boundaries by nudging one tick.
  if (tick > 0 && tickToSampleExport(tick, base) > sample) return tick - 1;
  if (tick + 1 < MAX_TICKS && tickToSampleExport(tick + 1, base) <= sample) return tick + 1;
  return tick;
}

/**
 * End sample of the slice starting at `tick`: the next marker's start sample,
 * or the source length when `tick` has no successor (DoPrev prevTick == 0).
 */
export function sliceEndSample(
  markers: readonly number[],
  index: number,
  sourceLength: number,
  base: TimeBase
): number {
  const next = index + 1 < markers.length ? markers[index + 1] : -1;
  if (next < 0) return sourceLength;
  return tickToSampleExport(next, base);
}
