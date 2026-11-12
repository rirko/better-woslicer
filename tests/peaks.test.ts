import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPeakCache, peakRange } from '../src/core/peaks.js';

test('a constant signal yields RMS equal to its value at every level', () => {
  const value = 8000;
  const cache = buildPeakCache([Int16Array.from({ length: 4096 }, () => value)]);
  for (const level of cache.levels) {
    for (let b = 0; b < level.buckets; b++) {
      assert.equal(level.rms[b], value, `level ${level.framesPerBucket} bucket ${b}`);
      assert.equal(level.minMax[b * 2], value);
      assert.equal(level.minMax[b * 2 + 1], value);
    }
  }
});

test('a full-scale sine yields RMS close to peak / sqrt(2)', () => {
  const peak = 32000;
  const frames = 48000;
  const data = Int16Array.from({ length: frames }, (_, i) =>
    Math.round(Math.sin((2 * Math.PI * i) / 100) * peak),
  );
  const cache = buildPeakCache([data]);
  const range = peakRange(cache, frames, 0, frames);
  const expected = (peak * Math.SQRT1_2) | 0;
  assert.ok(
    Math.abs(range.rms - expected) < expected * 0.02,
    `rms ${range.rms} vs expected ~${expected}`,
  );
  assert.equal(range.max, peak);
  assert.equal(range.min, -peak);
});

test('two-channel buckets merge both channels into one min/max/RMS set', () => {
  // Channel 0 constant +8000, channel 1 constant -6000: bucket RMS is the
  // quadratic mean of both channels.
  const cache = buildPeakCache([
    Int16Array.from({ length: 512 }, () => 8000),
    Int16Array.from({ length: 512 }, () => -6000),
  ]);
  const range = peakRange(cache, 512, 0, 512);
  assert.equal(range.min, -6000);
  assert.equal(range.max, 8000);
  const expectedRms = Math.sqrt((8000 * 8000 + 6000 * 6000) / 2);
  assert.ok(Math.abs(range.rms - expectedRms) < 1, `rms ${range.rms} vs ${expectedRms}`);
});

test('hierarchical levels agree with a base-bucket scan over the same range', () => {
  const frames = 65536;
  const data = Int16Array.from({ length: frames }, (_, i) => Math.round(Math.sin(i / 7) * 20000));
  const cache = buildPeakCache([data], 256);
  // A range aligned to a 4096-frame coarse bucket: the coarse-level answer
  // must match a manual scan over the base buckets exactly (min/max) and for
  // RMS (equal-width buckets combine as the quadratic mean).
  const start = 4096;
  const end = 4096 * 5;
  let min = 32767;
  let max = -32768;
  let sumSquares = 0;
  for (let b = start / 256; b < end / 256; b++) {
    min = Math.min(min, cache.levels[0].minMax[b * 2]);
    max = Math.max(max, cache.levels[0].minMax[b * 2 + 1]);
    sumSquares += cache.levels[0].rms[b] ** 2;
  }
  const manual = { min, max, rms: Math.sqrt(sumSquares / ((end - start) / 256)) };
  const viaCoarse = peakRange(cache, frames, start, end);
  assert.deepEqual(
    { min: viaCoarse.min, max: viaCoarse.max },
    { min: manual.min, max: manual.max },
  );
  assert.ok(Math.abs(viaCoarse.rms - manual.rms) < 0.5, `rms ${viaCoarse.rms} vs ${manual.rms}`);
});
