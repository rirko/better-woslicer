import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRID_DENSITIES,
  GRID_LINE_MIN_PX,
  MEASURE_LABEL_MIN_PX,
  gridLineTicks,
  gridStepTicks,
  measureLabelStep,
} from "../src/core/gridlines.js";
import { MAX_TICKS, MEASURE_TICKS } from "../src/core/timebase.js";

test("grid lines sit only on exact grid multiples of the view range", () => {
  const lines = gridLineTicks(0, MEASURE_TICKS * 2, 8, 6);
  assert.deepEqual(
    lines.map((l) => l.tick),
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120, 128, 136, 144, 152, 160, 168, 176, 184, 192, 200, 208, 216, 224, 232, 240, 248, 256, 264, 272, 280, 288, 296, 304, 312, 320, 328, 336, 344, 352, 360, 368, 376, 384]
  );
  for (const line of lines) assert.equal(line.tick % 8, 0, `tick ${line.tick} off grid`);
});

test("measure multiples are flagged isMeasure and no others", () => {
  const lines = gridLineTicks(0, MEASURE_TICKS * 2, 8, 6);
  const measures = lines.filter((l) => l.isMeasure).map((l) => l.tick);
  assert.deepEqual(measures, [0, 192, 384]);
});

test("a partial view starts on the first grid multiple at or before it", () => {
  const lines = gridLineTicks(50, 300, 8, 6);
  assert.equal(lines[0].tick, 48);
  assert.ok(lines[lines.length - 1].tick <= 300 + 8);
});

test("every grid value of GRID_CYCLE divides the measure, so measures ride the grid series", () => {
  for (const grid of [1, 2, 4, 6, 8, 12, 16, 24, 32]) {
    const lines = gridLineTicks(0, MEASURE_TICKS, grid, 10);
    assert.ok(
      lines.some((l) => l.isMeasure && l.tick === MEASURE_TICKS),
      `grid ${grid} lost the measure line`
    );
  }
});

test("below the 2px threshold the subdivisions collapse to measure lines only", () => {
  // grid 32 at 0.05 px/tick = 1.6px per cell < GRID_LINE_MIN_PX.
  const lines = gridLineTicks(0, MEASURE_TICKS * 3, 32, 0.05);
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.equal(line.tick % MEASURE_TICKS, 0, `invented line at tick ${line.tick}`);
    assert.equal(line.isMeasure, true);
  }
  assert.deepEqual(lines.map((l) => l.tick), [0, 192, 384, 576]);
});

test("exactly GRID_LINE_MIN_PX per cell still draws subdivisions", () => {
  const lines = gridLineTicks(0, MEASURE_TICKS, 32, GRID_LINE_MIN_PX);
  const subdivisions = lines.filter((l) => !l.isMeasure);
  assert.equal(subdivisions.length, MEASURE_TICKS / 32 - 1);
});

test("a grid that does not divide the measure still keeps exact measure lines", () => {
  // resolveBreakpointTick accepts any positive integer grid; the line set
  // must never lose the 192-multiples even then.
  const lines = gridLineTicks(0, MEASURE_TICKS, 50, 4);
  const ticks = new Set(lines.map((l) => l.tick));
  assert.ok(ticks.has(50) && ticks.has(100) && ticks.has(150));
  assert.ok(ticks.has(0) && ticks.has(192));
  assert.ok(lines.find((l) => l.tick === 192)?.isMeasure);
});

test("lines never exceed the 49152-tick map", () => {
  const lines = gridLineTicks(MAX_TICKS - 500, MAX_TICKS + 5000, 8, 6);
  for (const line of lines) assert.ok(line.tick <= MAX_TICKS, `tick ${line.tick} out of range`);
});

test("measure label interval doubles until the label fits, starting at 1", () => {
  assert.equal(measureLabelStep(1000), 1);
  assert.equal(measureLabelStep(MEASURE_LABEL_MIN_PX), 1);
  assert.equal(measureLabelStep(MEASURE_LABEL_MIN_PX - 1), 2);
  assert.equal(measureLabelStep(24), 2);
  assert.equal(measureLabelStep(23), 4);
  // Minimum zoom (0.02 px/tick): 3.84 px per measure -> 16-measure interval.
  assert.equal(measureLabelStep(3.84), 16);
  // Degenerate input must not loop forever.
  assert.equal(measureLabelStep(0), 1);
});
test("gridStepTicks maps the UI DENSITY (cells per measure) to ticks", () => {
  assert.deepEqual([...GRID_DENSITIES], [1, 2, 4, 6, 8, 12, 16, 24, 32]);
  assert.equal(gridStepTicks(1), MEASURE_TICKS); // whole measure per cell
  assert.equal(gridStepTicks(2), 96); // half measure
  assert.equal(gridStepTicks(4), 48);
  assert.equal(gridStepTicks(6), 32);
  assert.equal(gridStepTicks(8), 24);
  assert.equal(gridStepTicks(12), 16);
  assert.equal(gridStepTicks(16), 12);
  assert.equal(gridStepTicks(24), 8);
  assert.equal(gridStepTicks(32), 6);
  // Every ladder value divides the measure, so measures ride the grid series.
  for (const density of GRID_DENSITIES) {
    assert.equal(MEASURE_TICKS % gridStepTicks(density), 0, 'density ' + density + ' skews the measure');
  }
  // Unusable densities collapse to 0 so callers fall back to the raw tick.
  assert.equal(gridStepTicks(0), 0);
  assert.equal(gridStepTicks(-4), 0);
  assert.equal(gridStepTicks(Number.NaN), 0);
  assert.equal(gridStepTicks(Number.POSITIVE_INFINITY), 0);
});

test("each density draws exactly that many cells per measure", () => {
  // The ruler and the grid share this line set: at density N there must be
  // exactly N cells in one measure. Reading the density as ticks drew 96
  // lines per measure at density 2 instead of 2.
  for (const density of GRID_DENSITIES) {
    const step = gridStepTicks(density);
    const lines = gridLineTicks(0, MEASURE_TICKS, step, 10);
    // [0, MEASURE_TICKS) is one measure -> exactly `density` cells.
    const inside = lines.filter((l) => l.tick < MEASURE_TICKS);
    assert.equal(inside.length, density, 'density ' + density + ' drew ' + inside.length + ' lines');
  }
});

test("density 2 puts a line on the half measure, not every 2 ticks", () => {
  const step = gridStepTicks(2);
  const lines = gridLineTicks(0, MEASURE_TICKS * 2, step, 4);
  assert.deepEqual(
    lines.map((l) => l.tick),
    [0, 96, 192, 288, 384]
  );
  assert.deepEqual(
    lines.filter((l) => l.isMeasure).map((l) => l.tick),
    [0, 192, 384]
  );
});
