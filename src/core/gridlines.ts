/**
 * Exact vertical-line positions for the timeline, shared by the ruler, the
 * waveform lanes and (indirectly) the snap grid.
 *
 * Contract: every line ever drawn sits on a TRUE grid multiple, and measure
 * lines are always the multiples of MEASURE_TICKS. No adaptive "nice" units
 * are invented while zooming — when a grid cell gets thinner than
 * GRID_LINE_MIN_PX the subdivisions stop being drawn and only the exact
 * measure lines remain. Measure NUMBER labels may thin out (doubling
 * intervals via measureLabelStep), but only on real measure positions.
 */

import { MAX_TICKS, MEASURE_TICKS } from "./timebase.js";

/** Minimum pixel width at which grid subdivision lines are still drawn. */
export const GRID_LINE_MIN_PX = 2;
/** Minimum pixel spacing before measure labels double their interval. */
export const MEASURE_LABEL_MIN_PX = 48;

export interface GridLineTick {
  tick: number;
  /** True on multiples of MEASURE_TICKS (highlighted / labelled in the ruler). */
  isMeasure: boolean;
}

/**
 * Enumerate the line positions in the tick range [fromTick, toTick].
 *
 * When `grid` is a usable positive integer and a cell is at least
 * GRID_LINE_MIN_PX wide, every multiple of `grid` is returned (measure
 * multiples flagged `isMeasure`). Below that width — or when `grid` does not
 * divide the measure, so the grid series would skip the measure lines — the
 * measure lines are enumerated separately so they are never lost.
 */
export function gridLineTicks(
  fromTick: number,
  toTick: number,
  grid: number,
  pxPerTick: number
): GridLineTick[] {
  const lines: GridLineTick[] = [];
  const gridUsable = Number.isInteger(grid) && grid > 0 && pxPerTick > 0;
  const gridPx = gridUsable ? grid * pxPerTick : 0;
  if (gridUsable && gridPx >= GRID_LINE_MIN_PX) {
    const first = Math.floor(fromTick / grid) * grid;
    for (let tick = first; tick <= toTick; tick += grid) {
      if (tick < 0) continue;
      if (tick > MAX_TICKS) break;
      lines.push({ tick, isMeasure: tick % MEASURE_TICKS === 0 });
    }
  }
  if (!gridUsable || gridPx < GRID_LINE_MIN_PX || MEASURE_TICKS % grid !== 0) {
    const first = Math.floor(fromTick / MEASURE_TICKS) * MEASURE_TICKS;
    for (let tick = first; tick <= toTick; tick += MEASURE_TICKS) {
      if (tick < 0) continue;
      if (tick > MAX_TICKS) break;
      lines.push({ tick, isMeasure: true });
    }
  }
  return lines;
}

/**
 * How many measures to skip between number labels: every measure while the
 * spacing allows, otherwise the interval doubles until the label fits. The
 * returned step only thins LABELS — line positions come from gridLineTicks
 * and never move.
 */
export function measureLabelStep(pxPerMeasure: number): number {
  let step = 1;
  if (pxPerMeasure > 0) {
    while (pxPerMeasure * step < MEASURE_LABEL_MIN_PX) step *= 2;
  }
  return step;
}
