/**
 * Pure cue-trigger cursor logic (unit-tested; the Web Audio layer in the
 * renderer only consumes the result). A cue fires when playback CROSSES a
 * marker upward: prevTick < marker <= currTick. Seeking backwards or replaying
 * resets the cursor index so the same marker can fire again on the next pass.
 */

import { MAX_TICKS } from "./timebase.js";

/**
 * Returns the index of the last marker crossed between `prevTick` and
 * `currTick` (inclusive of currTick, exclusive of prevTick), or -1 when no
 * marker was crossed. `ticks` must be sorted ascending.
 *
 * Crossing multiple markers in one step yields the LAST crossed index (the
 * listener collapses them into a single hit, matching a metronome feel).
 */
export function findCueCrossing(
  ticks: readonly number[],
  prevTick: number,
  currTick: number,
  lastIndex: number
): number {
  if (!ticks.length) return -1;
  if (!(currTick > prevTick)) return -1; // paused or seeking backwards
  let crossed = -1;
  for (let i = 0; i < ticks.length; i++) {
    const t = ticks[i];
    if (t > MAX_TICKS) break;
    if (t > prevTick && t <= currTick) {
      crossed = i;
    }
    if (t > currTick) break;
  }
  void lastIndex;
  return crossed;
}
