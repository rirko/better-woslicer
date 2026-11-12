import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliceIndexAtOrBefore, markerAtOrBefore } from '../src/core/markers.js';

test('sliceIndexAtOrBefore finds the slice under the cursor (P preview)', () => {
  const ticks = [384, 408, 7944];
  assert.equal(sliceIndexAtOrBefore(ticks, 500), 1);
  assert.equal(sliceIndexAtOrBefore(ticks, 384), 0);
  assert.equal(sliceIndexAtOrBefore(ticks, 383), -1);
  assert.equal(sliceIndexAtOrBefore(ticks, 49151), 2);
  assert.equal(markerAtOrBefore(ticks, 500), 408);
});
