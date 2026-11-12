import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampGroupDelta,
  normalizeSelection,
  offsetsToTargets,
  resolvePaste,
  selectionToOffsets,
} from '../src/core/markers.js';
import { MAX_TICKS } from '../src/core/timebase.js';

test('selectionToOffsets uses the smallest tick as origin', () => {
  assert.deepEqual(selectionToOffsets([300, 100, 250]), [0, 150, 200]);
  assert.deepEqual(selectionToOffsets([]), []);
});

test('normalizeSelection dedupes, sorts and drops out-of-range ticks', () => {
  assert.deepEqual(normalizeSelection([50, 10, 50, -5, MAX_TICKS, 20.5]), [10, 50]);
});

test('offsetsToTargets anchors offsets at the paste position', () => {
  assert.deepEqual(offsetsToTargets([0, 24, 96], 1000), [1000, 1024, 1096]);
});

test('clampGroupDelta keeps the whole group inside the timeline', () => {
  assert.equal(clampGroupDelta([100, 200], 500), 500);
  assert.equal(clampGroupDelta([100, 200], 100000), MAX_TICKS - 1 - 200);
  assert.equal(clampGroupDelta([100, 200], -500), -100);
  assert.equal(clampGroupDelta([], 5), 0);
});

test('resolvePaste accepts a clean group and computes targets', () => {
  const check = resolvePaste([0, 24], 100, new Set([5000]), new Set());
  assert.ok(check.ok);
  assert.deepEqual(check.ticks, [100, 124]);
});

test('resolvePaste rejects collisions with foreign markers', () => {
  // 124 is a TARGET (100+24) occupied by a foreign marker.
  const check = resolvePaste([0, 24], 100, new Set([124]), new Set());
  assert.ok(!check.ok);
  assert.match(check.reason, /already has a marker/);
});

test('resolvePaste rejects out-of-range targets for the WHOLE group', () => {
  const occupied = new Set<number>();
  const self = new Set<number>();
  const check = resolvePaste([0, 50000], MAX_TICKS - 10, occupied, self);
  assert.ok(!check.ok);
  assert.match(check.reason, /outside the timeline/);
});

test('resolvePaste rejects collisions with foreign markers, allows own ticks', () => {
  // Self: the group being pasted currently sits at 100 and 124; repasting at
  // 100 (same place) must be allowed because both targets are its own ticks.
  const self = new Set([100, 124]);
  const check = resolvePaste([0, 24], 100, new Set([100, 124, 300]), self);
  assert.ok(check.ok);

  // A foreign marker at one target rejects the whole group.
  const check2 = resolvePaste([0, 24], 100, new Set([124]), new Set());
  assert.ok(!check2.ok);
  assert.match(check2.reason, /already has a marker/);
});

test('resolvePaste rejects an empty clipboard and non-integer targets', () => {
  assert.ok(!resolvePaste([], 10, new Set(), new Set()).ok);
  assert.ok(!resolvePaste([0], 10.5, new Set(), new Set()).ok);
});
