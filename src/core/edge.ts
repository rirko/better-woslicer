/**
 * Edge detection (original エッジ検出 feature).
 *
 * The original walks the timeline in grid steps and places a marker where the
 * RMS over [grid .. grid+step) exceeds 1.5x the RMS over the preceding step
 * (Cwav.GetRMS, integer-scaled by 1000). The same heuristic is ported here on
 * top of sample positions from the export time base.
 */

import { MAX_TICKS, TimeBase, tickToSampleExport } from "./timebase.js";
import { SourceAudio } from "./slicer.js";

/** Original GetRMS: sqrt(sum(v*v/1000) / count) with integer v*v/1000 terms. */
export function getRms(src: SourceAudio, channel: number, from: number, to: number): number {
  const start = Math.max(0, from);
  const end = Math.min(src.length - 1, to);
  const count = end - start;
  let acc = 0;
  for (let f = start; f < end; f++) {
    const v = src.data[channel][f];
    acc += Math.trunc((v * v) / 1000);
  }
  acc = Math.trunc(acc / count);
  return Math.trunc(Math.sqrt(acc));
}

/**
 * Detects cut candidates. `gridTicks` is the search step in ticks.
 * Returns sorted tick positions where a marker should be placed.
 */
export function detectEdges(src: SourceAudio, base: TimeBase, gridTicks: number): number[] {
  if (gridTicks <= 0) throw new RangeError("gridTicks must be positive");
  const step = tickToSampleExport(gridTicks, base) - tickToSampleExport(0, base);
  if (step <= 0) throw new RangeError("grid step resolves to zero samples");

  const result: number[] = [];
  for (let tick = gridTicks; tick < MAX_TICKS; tick += gridTicks) {
    const at = tickToSampleExport(tick, base);
    if (at > src.length) break;
    const before = tickToSampleExport(tick - gridTicks, base);
    // Original compares RMS of [tick .. tick+step) vs [tick-step .. tick),
    // keeping the tick when the following window is 1.5x louder.
    const rmsNext = getRms(src, 0, at, Math.min(src.length, at + step));
    const rmsPrev = getRms(src, 0, Math.max(0, before), at);
    if (rmsNext > rmsPrev * 1.5) {
      result.push(tick);
    }
  }
  return result;
}
