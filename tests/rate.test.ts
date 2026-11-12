import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PLAYBACK_RATE,
  PLAYBACK_RATES,
  advanceSamples,
  formatRate,
  reanchorSample,
  stepPlaybackRate,
} from '../src/core/rate.js';
import { sampleToTickNearest, tickToSampleExport, type TimeBase } from '../src/core/timebase.js';

test('rate ladder is the frozen ascending set with 1.0x default', () => {
  assert.deepEqual([...PLAYBACK_RATES], [0.25, 0.5, 0.75, 1.0, 1.5]);
  assert.equal(DEFAULT_PLAYBACK_RATE, 1.0);
  assert.deepEqual(
    [...PLAYBACK_RATES].sort((a, b) => a - b),
    [...PLAYBACK_RATES],
  );
});

test('[ steps one notch down per press through the whole ladder', () => {
  let rate = DEFAULT_PLAYBACK_RATE;
  const seen: number[] = [];
  // 3 unclamped presses walk 1.0 -> 0.75 -> 0.5 -> 0.25.
  for (let i = 0; i < 3; i++) {
    const step = stepPlaybackRate(rate, -1);
    assert.equal(step.clamped, false, `step ${i} must not clamp yet`);
    rate = step.rate;
    seen.push(rate);
  }
  assert.deepEqual(seen, [0.75, 0.5, 0.25]);
  // 4th press: clamped at the slow endpoint, no wrap-around.
  const clamped = stepPlaybackRate(rate, -1);
  assert.deepEqual(clamped, { rate: 0.25, clamped: true });
});

test('] steps one notch up and clamps at the fast endpoint without wrapping', () => {
  const step = stepPlaybackRate(DEFAULT_PLAYBACK_RATE, 1);
  assert.deepEqual(step, { rate: 1.5, clamped: false });
  const clamped = stepPlaybackRate(1.5, 1);
  assert.deepEqual(clamped, { rate: 1.5, clamped: true });
});

test('rate endpoints are symmetric in both directions', () => {
  assert.deepEqual(stepPlaybackRate(0.25, -1), { rate: 0.25, clamped: true });
  assert.deepEqual(stepPlaybackRate(0.25, 1), { rate: 0.5, clamped: false });
  assert.deepEqual(stepPlaybackRate(1.5, 1), { rate: 1.5, clamped: true });
  assert.deepEqual(stepPlaybackRate(1.5, -1), { rate: 1.0, clamped: false });
});

test('unknown current rate falls back to the default notch instead of NaN', () => {
  assert.deepEqual(stepPlaybackRate(0.9, -1), { rate: 0.75, clamped: false });
  assert.deepEqual(stepPlaybackRate(0.9, 1), { rate: 1.5, clamped: false });
});

test('formatRate renders the select labels', () => {
  assert.equal(formatRate(0.25), '0.25\u00d7');
  assert.equal(formatRate(0.5), '0.5\u00d7');
  assert.equal(formatRate(0.75), '0.75\u00d7');
  assert.equal(formatRate(1.0), '1.0\u00d7');
  assert.equal(formatRate(1.5), '1.5\u00d7');
});

const SR = 48000;

test('advanceSamples is exactly startOffset + elapsed * rate * sampleRate', () => {
  assert.equal(advanceSamples(1000, 2, 1, SR), 1000 + 2 * SR);
  assert.equal(advanceSamples(1000, 2, 0.5, SR), 1000 + 1 * SR);
  assert.equal(advanceSamples(1000, 0, 1.5, SR), 1000);
  // Monotonic in elapsed for every rate.
  for (const rate of PLAYBACK_RATES) {
    let prev = -Infinity;
    for (let t = 0; t <= 3; t += 0.25) {
      const s = advanceSamples(0, t, rate, SR);
      assert.ok(s > prev, `rate ${rate} must advance with time`);
      prev = s;
    }
  }
});

test('slower rates advance the anchor more slowly (1.5x / 1x / 0.25x ordering)', () => {
  const elapsed = 1;
  const fast = advanceSamples(0, elapsed, 1.5, SR);
  const normal = advanceSamples(0, elapsed, 1, SR);
  const slow = advanceSamples(0, elapsed, 0.25, SR);
  assert.ok(fast > normal && normal > slow);
  assert.equal(normal, SR);
  assert.equal(slow, SR / 4);
});

test('re-anchoring keeps currentSample continuous across a rate switch', () => {
  // Playing at 1.0x from sample 6000; switch to 0.5x after 1.25s.
  const startOffset = 6000;
  const switchElapsed = 1.25;
  const atSwitch = reanchorSample(startOffset, switchElapsed, 1.0, SR);
  assert.equal(atSwitch, startOffset + 1.25 * SR);
  // New anchor: startOffset := atSwitch, startedAt := now (elapsed resets 0).
  // Same instant under the new rate must return the identical position.
  const afterInstant = advanceSamples(atSwitch, 0, 0.5, SR);
  assert.equal(afterInstant, atSwitch);
  // And progress continues from there at the new rate.
  assert.equal(advanceSamples(atSwitch, 0.5, 0.5, SR), atSwitch + 0.25 * SR);
});

test('re-anchoring a second time (0.5x -> 1.5x -> 0.25x) is still gapless', () => {
  const sr = SR;
  let startOffset = 0;
  let rate = 0.5;
  // Leg 1: play 2s at 0.5x, then switch (anchor moves to the current sample).
  const atFirstSwitch = advanceSamples(startOffset, 2, rate, sr);
  startOffset = reanchorSample(startOffset, 2, rate, sr);
  assert.equal(startOffset, atFirstSwitch);
  assert.equal(startOffset, sr); // 2s * 0.5 * 48000
  // Leg 2: play 1s at 1.5x, then switch again.
  rate = 1.5;
  const atSecondSwitch = advanceSamples(startOffset, 1, rate, sr);
  startOffset = reanchorSample(startOffset, 1, rate, sr);
  assert.equal(startOffset, atSecondSwitch);
  assert.equal(startOffset, sr + 1.5 * sr);
  // Leg 3: progress continues from the exact switch position at the new rate.
  rate = 0.25;
  assert.equal(advanceSamples(startOffset, 0, rate, sr), startOffset);
  assert.equal(advanceSamples(startOffset, 0.25, rate, sr), startOffset + 0.25 * 0.25 * sr);
});

test('sampleToTickNearest inverts tickToSampleExport for whole ticks', () => {
  const bases: TimeBase[] = [
    { bpm: 120, shift: 0, sampleRate: SR },
    { bpm: 185, shift: 0, sampleRate: 44100 },
    { bpm: 100, shift: -48, sampleRate: SR },
    { bpm: 200, shift: 96, sampleRate: 44100 },
  ];
  for (const base of bases) {
    for (let tick = 0; tick <= 1000; tick += 7) {
      const sample = tickToSampleExport(tick, base);
      assert.equal(sampleToTickNearest(sample, base), tick, `tick ${tick} @ ${base.bpm}bpm`);
    }
  }
});

test('sampleToTickNearest clamps outside the 49152-tick map', () => {
  const base: TimeBase = { bpm: 120, shift: 0, sampleRate: SR };
  assert.equal(sampleToTickNearest(-99999, base), 0);
  assert.equal(sampleToTickNearest(Number.MAX_SAFE_INTEGER, base), 49152 - 1);
  assert.equal(sampleToTickNearest(0, base), 0);
});
