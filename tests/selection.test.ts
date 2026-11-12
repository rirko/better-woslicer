import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MarkerDoc,
  clampGroupDelta,
  normalizeSelection,
  offsetsToTargets,
  resolvePaste,
  selectionToOffsets,
} from '../src/core/markers.js';
import { MAX_TICKS } from '../src/core/timebase.js';

function docWith(ticks: number[]): MarkerDoc {
  const doc = new MarkerDoc();
  for (const t of ticks) doc.markers[t] = 1;
  return doc;
}

/* ---------------- pure helpers ---------------- */

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
  assert.deepEqual((check as { ticks: number[] }).ticks, [100, 124]);
});

test('resolvePaste rejects collisions with foreign markers', () => {
  // 124 is a TARGET (100+24) occupied by a foreign marker.
  const check = resolvePaste([0, 24], 100, new Set([124]), new Set());
  assert.ok(!check.ok);
  assert.match((check as { reason: string }).reason, /already has a marker/);
});

test('resolvePaste rejects out-of-range targets for the WHOLE group', () => {
  const occupied = new Set<number>();
  const self = new Set<number>();
  const check = resolvePaste([0, 50000], MAX_TICKS - 10, occupied, self);
  assert.ok(!check.ok);
  assert.match((check as { reason: string }).reason, /outside the timeline/);
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
  assert.match((check2 as { reason: string }).reason, /already has a marker/);
});

test('resolvePaste rejects an empty clipboard and non-integer targets', () => {
  assert.ok(!resolvePaste([], 10, new Set(), new Set()).ok);
  assert.ok(!resolvePaste([0], 10.5, new Set(), new Set()).ok);
});

/* ---------------- document integration ---------------- */

test('copySelection stores relative offsets without touching the document', () => {
  const doc = docWith([100, 124, 220]);
  const offsets = doc.copySelection([100, 220, 124]);
  assert.deepEqual(offsets, [0, 24, 120]);
  assert.deepEqual(doc.ticks(), [100, 124, 220]);
  assert.deepEqual(doc.selectionClipboard, [0, 24, 120]);
});

test('cutSelection removes the cut markers and fills the clipboard', () => {
  const doc = docWith([10, 20, 300]);
  const offsets = doc.cutSelection([10, 20]);
  assert.deepEqual(offsets, [0, 10]);
  assert.deepEqual(doc.ticks(), [300]);
  assert.ok(doc.canUndo());
});

test('pasteSelection anchors at the cursor, keeps spacing, auto-select targets', () => {
  const doc = docWith([100, 124]);
  doc.copySelection([100, 124]);
  const pasted = doc.pasteSelection(1000);
  assert.deepEqual(pasted, [1000, 1024]);
  assert.deepEqual(doc.ticks(), [100, 124, 1000, 1024]);
  // The returned list is exactly what the UI should auto-select.
  assert.deepEqual(
    doc.ticks().filter((t) => pasted.includes(t)),
    pasted,
  );
});

test('pasteSelection rejects the WHOLE group on collision and writes nothing', () => {
  const doc = docWith([100, 124]);
  doc.copySelection([100, 124]);
  const doc2 = docWith([1024]); // collides with the second pasted marker (1000+24)
  doc2.selectionClipboard = doc.selectionClipboard;
  const before = doc2.ticks();
  assert.equal(doc2.pasteSelection(1000), null);
  assert.deepEqual(doc2.ticks(), before, 'nothing written on rejection');
  assert.ok(!doc2.canUndo(), 'rejected paste must not push undo');
});

test('pasteSelection at the clipboard origin overwrites its own group (idempotent)', () => {
  const doc = docWith([100, 124]);
  doc.copySelection([100, 124]);
  const pasted = doc.pasteSelection(100); // same origin: own ticks, allowed
  assert.deepEqual(pasted, [100, 124]);
  assert.deepEqual(doc.ticks(), [100, 124]);
});

test('pasteSelection rejects when the group would leave the timeline', () => {
  const doc = docWith([100, 124]);
  doc.copySelection([100, 124]);
  const doc2 = new MarkerDoc();
  doc2.selectionClipboard = doc.selectionClipboard;
  assert.equal(doc2.pasteSelection(MAX_TICKS - 10), null);
});

test('pasting with an empty clipboard returns null', () => {
  const doc = new MarkerDoc();
  assert.equal(doc.pasteSelection(0), null);
  assert.equal(doc.canPasteAt(0), false);
});

test('selection clipboard stays independent from the BMSE clipboard data', () => {
  const doc = docWith([5, 40]);
  doc.copySelection([5, 40]);
  const internal = doc.selectionClipboard;
  // The BMSE text format is a separate representation entirely.
  assert.notEqual(internal, null);
  assert.deepEqual(internal, [0, 35]);
  // Modifying the internal clipboard must not appear in any BMSE artefact and
  // vice versa: they share no storage (BMSE builds strings on demand).
  doc.selectionClipboard = [7];
  assert.deepEqual(internal, [0, 35]);
});

test('canPasteAt mirrors resolvePaste', () => {
  const doc = docWith([100]);
  doc.copySelection([100]);
  assert.ok(doc.canPasteAt(500)); // free target
  const doc2 = docWith([500]);
  doc2.selectionClipboard = doc.selectionClipboard;
  doc2.clipboardOrigin = 100;
  assert.ok(!doc2.canPasteAt(500), 'occupied by a foreign marker');
  // Pasting back at the clipboard's own origin over its own marker is legal.
  const doc3 = docWith([100]);
  doc3.selectionClipboard = doc.selectionClipboard;
  doc3.clipboardOrigin = 100;
  assert.ok(doc3.canPasteAt(100));
});
