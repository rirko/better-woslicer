import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeTaps,
  beatIntervalMs,
  beatTimesMs,
  latencySamples,
  DEFAULT_CALIBRATION_BEATS,
} from '../src/core/calibration.js';

test('beat interval follows the BPM (quarter notes)', () => {
  assert.equal(beatIntervalMs(120), 500);
  assert.ok(Math.abs(beatIntervalMs(185) - 324.324324) < 0.001);
  assert.throws(() => beatIntervalMs(0), RangeError);
  assert.throws(() => beatIntervalMs(-10), RangeError);
});

test('16 beat reference times start at 0 and step by the interval', () => {
  const beats = beatTimesMs(120);
  assert.equal(beats.length, DEFAULT_CALIBRATION_BEATS);
  assert.equal(beats[0], 0);
  assert.equal(beats[1], 500);
  assert.equal(beats[15], 7500);
});

test('median offset is measured from taps that land late', () => {
  const beats = beatTimesMs(120);
  const taps = beats.map((b) => b + 25);
  const result = analyzeTaps(taps, beats);
  assert.equal(result.matched, 16);
  assert.equal(result.medianMs, 25);
  assert.ok(Math.abs(result.meanMs - 25) < 1e-9);
  assert.ok(result.stdMs < 1e-9);
});

test('median is robust against individual early and late taps', () => {
  const beats = beatTimesMs(120);
  const taps = [beats[0] + 20, beats[1] - 10, beats[2] + 30, beats[3] + 20];
  const result = analyzeTaps(taps, beats);
  assert.equal(result.matched, 4);
  assert.equal(result.medianMs, 20); // sorted: -10, 20, 20, 30
});

test('taps further than half a beat from every reference are ignored', () => {
  // Custom reference 1000 ms apart -> tolerance 500 ms.
  const beats = [0, 1000];
  const result = analyzeTaps([2500, 1010], beats);
  assert.equal(result.total, 2);
  assert.equal(result.matched, 1); // 2500 is 1500 ms from the nearest beat
  assert.equal(result.medianMs, 10);
});

test('no taps yields a zeroed result instead of NaN', () => {
  const result = analyzeTaps([], beatTimesMs(120));
  assert.equal(result.total, 0);
  assert.equal(result.matched, 0);
  assert.equal(result.medianMs, 0);
  assert.equal(result.meanMs, 0);
  assert.equal(result.stdMs, 0);
});

test('latency converts to samples at the source rate', () => {
  assert.equal(latencySamples(25, 48000), 1200);
  assert.equal(latencySamples(-25, 48000), -1200);
  assert.equal(latencySamples(0, 44100), 0);
});
