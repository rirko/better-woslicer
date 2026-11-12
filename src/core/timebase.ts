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

import { f32, toInt32 } from './float32.js';

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
  return toInt32(((((tick + base.shift) * base.sampleRate) / base.bpm) * 5.0) / 4.0);
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

/**
 * Nearest tick to a playhead sample position (Math.round of the inverse
 * conversion, clamped to the 49152-tick map). This is the break-point
 * mapping: playing -> marker under the playhead. Extracted from the renderer
 * so the round-back math is unit-testable without a DOM.
 */
export function sampleToTickNearest(sample: number, base: TimeBase): number {
  const approx = (sample * base.bpm * 4) / (base.sampleRate * 5) - base.shift;
  return Math.max(0, Math.min(MAX_TICKS - 1, Math.round(approx)));
}

/**
 * Break-point placement policy (frozen spec): with Snap on, a placed marker
 * aligns to the nearest multiple of `grid`; holding Alt (`bypass`) drops it
 * at the exact position regardless of Snap. Every result is a whole tick
 * clamped into [0, MAX_TICKS).
 *
 * Single source of truth for snapping: Store.snapTick delegates here (ruler
 * clicks, bypass=false) and the Enter break-point action resolves both its
 * playing and stopped branches through it.
 *
 * A non-integer or non-positive grid falls back to the unsnapped tick so a
 * bad grid value can never produce NaN.
 */
export function resolveBreakpointTick(
  tick: number,
  snap: boolean,
  grid: number,
  bypass: boolean,
): number {
  const snapUsable = snap && !bypass && Number.isInteger(grid) && grid > 0;
  if (!snapUsable) return Math.max(0, Math.min(MAX_TICKS - 1, Math.round(tick)));
  return Math.max(0, Math.min(MAX_TICKS - 1, Math.round(tick / grid) * grid));
}
