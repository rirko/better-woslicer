import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tickToSampleExport,
  tickToSampleView,
  sampleToTickFloor,
  resolveBreakpointTick,
  sliceEndSample,
  TimeBase,
  MAX_TICKS,
  MEASURE_TICKS,
} from "../src/core/timebase.js";
import { Store } from "../src/renderer/store.js";
import { gridStepTicks } from "../src/core/gridlines.js";

const BASE_120: TimeBase = { bpm: 120, shift: 0, sampleRate: 48000 };
const BASE_185: TimeBase = { bpm: 185, shift: -1, sampleRate: 48000 };

test("BPM 120, shift 0: one measure is exactly 96000 samples", () => {
  // sample = tick * 48000 * 5 / 4 / 120 = tick * 500
  assert.equal(tickToSampleExport(0, BASE_120), 0);
  assert.equal(tickToSampleExport(MEASURE_TICKS, BASE_120), 96000);
  assert.equal(tickToSampleExport(1, BASE_120), 500);
});

test("BPM 185, shift -1: matches the oracle time base", () => {
  // sample = (tick - 1) * 48000 / 185 * 5 / 4
  assert.equal(tickToSampleExport(384, BASE_185), 124216); // 124216.216 -> floor
  assert.equal(tickToSampleExport(408, BASE_185), 132000); // exact
  assert.equal(tickToSampleExport(5856, BASE_185), 1898918);
  assert.equal(tickToSampleExport(7944, BASE_185), 2576108);
});

test("negative shift moves slice starts earlier; positive shift later", () => {
  const neg: TimeBase = { bpm: 120, shift: -4, sampleRate: 48000 };
  const pos: TimeBase = { bpm: 120, shift: 4, sampleRate: 48000 };
  // Shift is applied inside the multiplication: (tick + shift) * 500.
  assert.equal(tickToSampleExport(10, neg), (10 - 4) * 500);
  assert.equal(tickToSampleExport(10, pos), (10 + 4) * 500);
  // Deep negative shift can reach negative sample positions (original computes
  // it; renderSlice rejects it, matching "reference out of range").
  const deep: TimeBase = { bpm: 120, shift: -100000, sampleRate: 48000 };
  assert.ok(tickToSampleExport(0, deep) < 0);
});

test("tickToSampleView uses float32 roundings distinct from the export conversion", () => {
  // Both agree on small ticks but must be exercised as separate code paths.
  const view = tickToSampleView(384, BASE_185);
  const exp = tickToSampleExport(384, BASE_185);
  assert.equal(view, exp); // coincide here
  // Large ticks: float32 mantissa loss can shift the result by one sample.
  const big: TimeBase = { bpm: 77.7, shift: -3, sampleRate: 44100 };
  const tick = 40000;
  const viewBig = tickToSampleView(tick, big);
  const expBig = tickToSampleExport(tick, big);
  assert.ok(Math.abs(viewBig - expBig) <= 2);
});

test("sampleToTickFloor inverts tickToSampleExport", () => {
  for (let tick = 0; tick < 2000; tick += 7) {
    const sample = tickToSampleExport(tick, BASE_185);
    assert.equal(sampleToTickFloor(sample, BASE_185), tick);
  }
});

test("slice end falls back to source length for the last marker", () => {
  const markers = [384, 408, 7944];
  assert.equal(sliceEndSample(markers, 0, 8718429, BASE_185), tickToSampleExport(408, BASE_185));
  assert.equal(sliceEndSample(markers, 2, 8718429, BASE_185), 8718429); // no successor -> EOF
});

test("EOF boundary: last slice keeps the 16-frame pad inside the source", () => {
  const sourceLength = 8718429;
  const start = tickToSampleExport(7944, BASE_185);
  const end = sliceEndSample([7944], 0, sourceLength, BASE_185);
  assert.equal(end + 0 - start + 16, sourceLength - start + 16);
});

/* ---- resolveBreakpointTick: snap x bypass x position matrix ------------- */

test("resolveBreakpointTick: snap on aligns to the nearest grid multiple", () => {
  // Already on the grid: unchanged.
  assert.equal(resolveBreakpointTick(16, true, 8, false), 16);
  assert.equal(resolveBreakpointTick(0, true, 8, false), 0);
  // Off grid: nearest multiple wins.
  assert.equal(resolveBreakpointTick(13, true, 8, false), 16);
  assert.equal(resolveBreakpointTick(11, true, 8, false), 8);
  // Exact halfway rounds up (JS Math.round), matching the old snapTick.
  assert.equal(resolveBreakpointTick(12, true, 8, false), 16);
});

test("resolveBreakpointTick: snap off keeps the exact tick", () => {
  assert.equal(resolveBreakpointTick(13, false, 8, false), 13);
  assert.equal(resolveBreakpointTick(11, false, 8, false), 11);
  assert.equal(resolveBreakpointTick(16, false, 8, false), 16);
  // Fractional input still becomes a legal integer tick.
  assert.equal(resolveBreakpointTick(12.6, false, 8, false), 13);
});

test("resolveBreakpointTick: Alt bypass wins over snap on AND snap off", () => {
  assert.equal(resolveBreakpointTick(13, true, 8, true), 13);
  assert.equal(resolveBreakpointTick(13, false, 8, true), 13);
  assert.equal(resolveBreakpointTick(11, true, 8, true), 11);
  // On-grid + bypass is also a no-op.
  assert.equal(resolveBreakpointTick(16, true, 8, true), 16);
});

test("resolveBreakpointTick clamps into [0, 49152) in every mode", () => {
  assert.equal(resolveBreakpointTick(-5, true, 8, false), 0);
  assert.equal(resolveBreakpointTick(-5, true, 8, true), 0);
  assert.equal(resolveBreakpointTick(-5, false, 8, false), 0);
  assert.equal(resolveBreakpointTick(60000, false, 8, false), MAX_TICKS - 1);
  assert.equal(resolveBreakpointTick(60000, true, 8, true), MAX_TICKS - 1);
  // Snapping at the right edge clamps back inside the map (49152 -> 49151).
  assert.equal(resolveBreakpointTick(MAX_TICKS - 1, true, 32, false), MAX_TICKS - 1);
});

test("resolveBreakpointTick ignores a degenerate grid instead of producing NaN", () => {
  assert.equal(resolveBreakpointTick(13, true, 0, false), 13);
  assert.equal(resolveBreakpointTick(13, true, -8, false), 13);
});

test("Store.snapTick stays consistent with resolveBreakpointTick(bypass=false)", () => {
  const store = new Store();
  for (const tick of [0, 3, 8, 13, 100, MAX_TICKS - 1]) {
    for (const snap of [true, false]) {
      store.update({ snap });
      // The store resolves its DENSITY to a tick step before delegating.
      assert.equal(
        store.snapTick(tick),
        resolveBreakpointTick(tick, snap, gridStepTicks(store.state.grid), false),
        `tick=${tick} snap=${snap}`
      );
    }
  }
});

test("Store.snapTick snaps to the drawn cell, not to a density number of ticks", () => {
  const store = new Store();
  // Grid 2 = half measure = 96 ticks. Snapping to 2 ticks put markers 48x
  // finer than the ruler showed.
  store.update({ snap: true, grid: 2 });
  assert.equal(store.snapTick(100), 96);
  assert.equal(store.snapTick(40), 0);
  assert.equal(store.snapTick(96), 96);
  // Grid 8 = 24 ticks per cell (the default).
  store.update({ grid: 8 });
  assert.equal(store.snapTick(30), 24);
  assert.equal(store.snapTick(12), 24);
});
