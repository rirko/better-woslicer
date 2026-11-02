import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeBands, BandAnalysis } from "../src/core/bands.js";
import { detectBandCuts, detectRiseOnsets } from "../src/core/banddetect.js";
import { TimeBase } from "../src/core/timebase.js";

const SR = 48000;

/**
 * 2 s of quiet 440 Hz (mid band) with 60 ms loud bursts every 0.5 s:
 * rises of ~16 dB at t = 0.5 / 1.0 / 1.5 s (the burst at t=0 is inside the
 * 200 ms baseline window and is deliberately not detected).
 */
function burstSignal(): Int16Array {
  const n = SR * 2;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const inBurst = t % 0.5 < 0.06;
    const amp = inBurst ? 0.8 : 0.12;
    out[i] = Math.round(Math.sin(2 * Math.PI * 440 * t) * amp * 32768);
  }
  return out;
}

const analysis: BandAnalysis = analyzeBands([burstSignal()], SR);
// 120 BPM, shift 0: one tick = 48000 * 5 / (4 * 120) = 500 samples.
const BASE: TimeBase = { bpm: 120, shift: 0, sampleRate: SR };

test("detectRiseOnsets finds the burst edges in the mid band", () => {
  const onsets = detectRiseOnsets(analysis.mid.rms[0], analysis.hopSamples, { thresholdDb: 6 });
  assert.ok(onsets.length >= 3, `onsets=${onsets}`);
  // 0.5 s = sample 24000, 1.0 s = 48000, 1.5 s = 72000 (hop-rounded).
  for (const expected of [24000, 48000, 72000]) {
    assert.ok(
      onsets.some((s) => Math.abs(s - expected) <= analysis.hopSamples),
      `expected an onset near ${expected}, got ${onsets}`
    );
  }
});

test("a threshold above the actual rise finds nothing", () => {
  const onsets = detectRiseOnsets(analysis.mid.rms[0], analysis.hopSamples, { thresholdDb: 40 });
  assert.equal(onsets.length, 0);
});

test("detectBandCuts snaps every hit to the grid", () => {
  const result = detectBandCuts({
    analysis,
    bands: ["mid"],
    thresholdDb: 6,
    grid: 8,
    minGapTicks: 8,
    fromTick: 0,
    toTick: 49151,
    base: BASE,
    existing: new Set<number>(),
  });
  assert.ok(result.ticks.length >= 3, `ticks=${result.ticks}`);
  for (const tick of result.ticks) assert.equal(tick % 8, 0, `tick ${tick} is off-grid`);
  // Bursts at 0.5/1.0/1.5 s land on ticks 48/96/144 (already 8-multiples).
  assert.deepEqual(result.ticks.slice(0, 3), [48, 96, 144]);
});

test("detectBandCuts skips ticks that already hold a marker", () => {
  const first = detectBandCuts({
    analysis,
    bands: ["mid"],
    thresholdDb: 6,
    grid: 8,
    minGapTicks: 8,
    fromTick: 0,
    toTick: 49151,
    base: BASE,
    existing: new Set<number>(),
  });
  const result = detectBandCuts({
    analysis,
    bands: ["mid"],
    thresholdDb: 6,
    grid: 8,
    minGapTicks: 8,
    fromTick: 0,
    toTick: 49151,
    base: BASE,
    existing: new Set([first.ticks[0]]),
  });
  assert.equal(result.ticks.length, first.ticks.length - 1);
  assert.equal(result.existing, 1);
});

test("detectBandCuts honours the selection range", () => {
  const result = detectBandCuts({
    analysis,
    bands: ["mid"],
    thresholdDb: 6,
    grid: 8,
    minGapTicks: 8,
    fromTick: 60,
    toTick: 120,
    base: BASE,
    existing: new Set<number>(),
  });
  assert.deepEqual(result.ticks, [96]);
});

test("min gap suppresses dense hits", () => {
  const loose = detectBandCuts({
    analysis,
    bands: ["mid"],
    thresholdDb: 6,
    grid: 8,
    minGapTicks: 8,
    fromTick: 0,
    toTick: 49151,
    base: BASE,
    existing: new Set<number>(),
  });
  const strict = detectBandCuts({
    analysis,
    bands: ["mid"],
    thresholdDb: 6,
    grid: 8,
    minGapTicks: 1000,
    fromTick: 0,
    toTick: 49151,
    base: BASE,
    existing: new Set<number>(),
  });
  assert.equal(strict.ticks.length, 1);
  assert.ok(strict.skippedGap >= loose.ticks.length - 1);
});

/**
 * Regression for "small sounds get cut, big ones do not": a short percussive
 * hit (20 ms) inside an already loud passage used to be missed twice over —
 * the 30 ms sustain test outlasted the hit, and the mean baseline was already
 * high because of the surrounding material.
 */
function shortHitSignal(): Int16Array {
  const n = Math.round(SR * 1.2);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let amp = t < 0.6 ? 0.05 : 0.5;
    if (t >= 0.8 && t < 0.82) amp = 1.0; // 20 ms hit, +6 dB over the passage
    out[i] = Math.round(Math.sin(2 * Math.PI * 440 * t) * amp * 32768);
  }
  return out;
}

test("a short loud hit inside an already loud passage is detected", () => {
  const hitAnalysis = analyzeBands([shortHitSignal()], SR);
  const onsets = detectRiseOnsets(hitAnalysis.mid.rms[0], hitAnalysis.hopSamples, { thresholdDb: 5 });
  // The hit starts at t = 0.8 s = sample 38400.
  assert.ok(
    onsets.some((s) => Math.abs(s - 38400) <= hitAnalysis.hopSamples * 2),
    `expected an onset near 38400, got ${onsets}`
  );
});

test("snap:false keeps the exact onset tick instead of the coarse grid", () => {  // Grid 4 = 48 ticks per cell (324 ms at 120 BPM): a hit at 0.5 s would be
  // snapped to tick 96 (0.65 s), which visually sits on the decay. With
  // snap:false the marker must stay at the real onset tick (~48).
  const request = {
    analysis,
    bands: ["mid"] as const,
    thresholdDb: 6,
    grid: 4,
    minGapTicks: 4,
    fromTick: 0,
    toTick: 49151,
    base: BASE,
    existing: new Set<number>(),
  };
  const snapped = detectBandCuts({ ...request, bands: ["mid"], snap: true });
  const exact = detectBandCuts({ ...request, bands: ["mid"], snap: false });
  assert.ok(snapped.ticks.length >= 1 && exact.ticks.length >= 1);
  for (const tick of snapped.ticks) assert.equal(tick % 4, 0, `snapped tick ${tick}`);
  assert.ok(
    exact.ticks.some((t) => t % 4 !== 0 || Math.abs(t - 48) <= 2),
    `exact ticks should follow the onset, got ${exact.ticks}`
  );
  // The first burst (0.5 s = tick 48) is exactly on a cell boundary; the
  // second (1.0 s = tick 96) too — use a shifted-grid case to prove the
  // difference: grid 5 puts 48 between cells 45 and 50.
  const snapped5 = detectBandCuts({ ...request, bands: ["mid"], grid: 5, minGapTicks: 5, snap: true });
  const exact5 = detectBandCuts({ ...request, bands: ["mid"], grid: 5, minGapTicks: 5, snap: false });
  assert.ok(snapped5.ticks.length >= 1 && exact5.ticks.length >= 1);
  for (const tick of snapped5.ticks) assert.equal(tick % 5, 0, `snapped tick ${tick}`);
  assert.ok(exact5.ticks.some((t) => t % 5 !== 0), `exact ticks ${exact5.ticks} should not all be grid multiples`);
});

/**
 * Regression for the High-band-only case: the high band of a low-frequency
 * mix is mostly noise. A minimum-based baseline plus no absolute floor used
 * to cut inaudible noise wiggles ("obviously wrong" markers).
 */
function noiseSignal(amp: number, seconds = 1): Int16Array {
  let seed = 12345;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const n = Math.round(SR * seconds);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round((rnd() * 2 - 1) * amp * 32768);
  return out;
}

test("a near-silent band produces no onsets from noise wiggles", () => {
  const quiet = analyzeBands([noiseSignal(0.0005)], SR); // about -66 dBFS
  for (const band of ["low", "mid", "high"] as const) {
    const onsets = detectRiseOnsets(quiet[band].rms[0], quiet.hopSamples, { thresholdDb: 12.5 });
    assert.equal(onsets.length, 0, `${band} produced ${onsets.length} onsets`);
  }
});

test("moderate noise does not trigger the 12.5 dB High-band setting", () => {
  const noise = analyzeBands([noiseSignal(0.01)], SR); // about -40 dBFS
  const onsets = detectRiseOnsets(noise.high.rms[0], noise.hopSamples, { thresholdDb: 12.5 });
  assert.equal(onsets.length, 0, `high produced ${onsets.length} onsets`);
});
