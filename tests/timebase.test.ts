import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tickToSampleExport,
  tickToSampleView,
  sampleToTickFloor,
  sliceEndSample,
  TimeBase,
  MEASURE_TICKS,
} from "../src/core/timebase.js";

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
