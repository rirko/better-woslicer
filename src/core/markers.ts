/** Pure marker selection, paste validation and cursor lookup helpers. */

import { MAX_TICKS } from './timebase.js';

/** Normalizes a selection: deduplicated, sorted ascending, in-range ticks. */
export function normalizeSelection(ticks: readonly number[]): number[] {
  return [...new Set(ticks)]
    .filter((t) => Number.isInteger(t) && t >= 0 && t < MAX_TICKS)
    .sort((a, b) => a - b);
}

/** Relative offsets of `ticks` from their minimum (origin becomes 0). */
export function selectionToOffsets(ticks: readonly number[]): number[] {
  const sorted = normalizeSelection(ticks);
  if (!sorted.length) return [];
  const origin = sorted[0];
  return sorted.map((t) => t - origin);
}

/** Target ticks when an offset clipboard is pasted at `targetTick`. */
export function offsetsToTargets(offsets: readonly number[], targetTick: number): number[] {
  return [...offsets].map((o) => o + targetTick).sort((a, b) => a - b);
}

/**
 * Clamps a group delta so that EVERY tick stays inside [0, MAX_TICKS).
 * The whole group shares one delta, so relative spacing can never break.
 */
export function clampGroupDelta(ticks: readonly number[], delta: number): number {
  const sorted = normalizeSelection(ticks);
  if (!sorted.length) return 0;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  return Math.max(-min, Math.min(MAX_TICKS - 1 - max, delta));
}

export type PasteCheck = { ok: true; ticks: number[] } | { ok: false; reason: string };

/**
 * Pure paste resolution: computes target ticks and validates the WHOLE group.
 * Rejects when any target falls outside the timeline or lands on an existing
 * marker that is not part of the pasted group itself (overlap inside the
 * group is impossible because offsets are unique).
 */
export function resolvePaste(
  offsets: readonly number[],
  targetTick: number,
  occupied: ReadonlySet<number>,
  selfTicks: ReadonlySet<number>,
): PasteCheck {
  if (!offsets.length) return { ok: false, reason: 'clipboard is empty' };
  if (!Number.isInteger(targetTick))
    return { ok: false, reason: 'paste position must be an integer tick' };
  const targets = offsetsToTargets(offsets, targetTick);
  for (const t of targets) {
    if (t < 0 || t >= MAX_TICKS) {
      return {
        ok: false,
        reason: `paste rejected: marker would land at tick ${t}, outside the timeline`,
      };
    }
    if (occupied.has(t) && !selfTicks.has(t)) {
      return { ok: false, reason: `paste rejected: tick ${t} already has a marker` };
    }
  }
  return { ok: true, ticks: targets };
}

/** Returns the last marker tick at or before `tick`, or -1. */
export function markerAtOrBefore(ticks: readonly number[], tick: number): number {
  let result = -1;
  for (const t of ticks) {
    if (t <= tick) result = t;
    else break;
  }
  return result;
}

/** Returns the index of the slice that starts at or before `tick`, or -1. */
export function sliceIndexAtOrBefore(ticks: readonly number[], tick: number): number {
  let lo = 0;
  let hi = ticks.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ticks[mid] <= tick) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}
