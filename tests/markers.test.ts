import { test } from "node:test";
import assert from "node:assert/strict";
import { MarkerDoc, sliceIndexAtOrBefore, markerAtOrBefore } from "../src/core/markers.js";
import { MAX_TICKS } from "../src/core/timebase.js";

function docWith(ticks: number[]): MarkerDoc {
  const doc = new MarkerDoc();
  for (const t of ticks) doc.markers[t] = 1;
  return doc;
}

test("setting a marker twice is idempotent (Enter break-point de-duplication)", () => {
  const doc = new MarkerDoc();
  assert.ok(doc.setMarker(384, true));
  assert.ok(!doc.setMarker(384, true)); // second Enter at the same position: no change
  assert.deepEqual(doc.ticks(), [384]);
});

test("toggleMarker places and removes a cut line (Z semantics)", () => {
  const doc = new MarkerDoc();
  doc.toggleMarker(100);
  assert.deepEqual(doc.ticks(), [100]);
  doc.toggleMarker(100);
  assert.deepEqual(doc.ticks(), []);
});

test("box selection: markers inside the range are selected", () => {
  const doc = docWith([100, 200, 300, 400]);
  const selected = doc.ticks().filter((t) => t >= 150 && t <= 350);
  assert.deepEqual(selected, [200, 300]);
});

test("moveSelection moves the selected group; unselected markers stay put", () => {
  const doc = docWith([100, 200, 300, 400]);
  doc.moveSelection([200, 300], 50);
  assert.deepEqual(doc.ticks(), [100, 250, 350, 400]);
});

test("quantizeSelection snaps ONLY the selected markers to the grid", () => {
  const doc = docWith([10, 12, 26, 100]);
  assert.ok(doc.quantizeSelection([10, 12, 26], 8));
  // Math.round ties round up: 10->8, 12->16, 26->24. Tick 100 is NOT
  // selected and must remain untouched.
  assert.deepEqual(doc.ticks(), [8, 16, 24, 100]);
});

test("quantizeSelection merges into non-selected markers (selected wins the tick)", () => {
  const doc = docWith([6, 9, 200]);
  assert.ok(doc.quantizeSelection([6, 9], 8));
  assert.deepEqual(doc.ticks(), [8, 200]); // both selected markers snap to 8
});

test("quantizeSelection with no selection is a no-op", () => {
  const doc = docWith([7, 13]);
  assert.ok(!doc.quantizeSelection([], 8));
  assert.deepEqual(doc.ticks(), [7, 13]);
  assert.ok(!doc.canUndo(), "no-op must not push an undo entry");
});

test("quantizeSelection already-on-grid selection reports no change", () => {
  const doc = docWith([0, 8, 16]);
  assert.ok(!doc.quantizeSelection([0, 8, 16], 8));
});

test("moveSelection clamps the WHOLE group preserving relative spacing", () => {
  const doc = docWith([10, 20, 30]);
  // 1000 fits without hitting the boundary: applied as-is.
  assert.equal(doc.moveSelection([10, 20, 30], 1000), 1000);
  assert.deepEqual(doc.ticks(), [1010, 1020, 1030]);

  // A huge delta clamps to the boundary for the WHOLE group at once; relative
  // spacing (10 ticks) can never break.
  const doc2 = docWith([10, 20, 30]);
  const applied = doc2.moveSelection([10, 20, 30], 999999);
  assert.equal(applied, MAX_TICKS - 1 - 30);
  const ticks = doc2.ticks();
  assert.equal(ticks[1] - ticks[0], 10, "spacing preserved");
  assert.equal(ticks[2] - ticks[1], 10, "spacing preserved");
});

test("moveSelection negative delta clamps at the timeline start", () => {
  const doc = docWith([100, 150]);
  const applied = doc.moveSelection([100, 150], -1000);
  assert.equal(applied, -100);
  assert.deepEqual(doc.ticks(), [0, 50]);
});

test("moveSelection with zero delta or empty selection is a no-op", () => {
  const doc = docWith([5]);
  assert.equal(doc.moveSelection([], 10), 0);
  assert.equal(doc.moveSelection([5], 0), 0);
  assert.deepEqual(doc.ticks(), [5]);
});

test("measure copy/paste round-trips 192 ticks (Ctrl+C / Ctrl+F)", () => {
  const doc = docWith([0, 100, 191, 192, 300]);
  const clip = doc.copyMeasure(0);
  assert.equal(clip.length, 192);
  assert.equal(clip[0], 1);
  assert.equal(clip[100], 1);
  assert.equal(clip[191], 1);
  assert.equal(clip[192 - 192], 1);

  const doc2 = new MarkerDoc();
  doc2.pasteMeasure(1, clip);
  assert.deepEqual(doc2.ticks(), [192, 292, 383]);
});

test("measure cut clears the source range", () => {
  const doc = docWith([10, 200]);
  doc.cutMeasure(0);
  assert.deepEqual(doc.ticks(), [200]);
});

test("undo/redo restores the bitmap step by step", () => {
  const doc = new MarkerDoc();
  doc.setMarker(10, true);
  doc.setMarker(20, true);
  assert.deepEqual(doc.ticks(), [10, 20]);
  assert.ok(doc.undo());
  assert.deepEqual(doc.ticks(), [10]);
  assert.ok(doc.undo());
  assert.deepEqual(doc.ticks(), []);
  assert.ok(!doc.undo()); // stack exhausted
  assert.ok(doc.redo());
  assert.deepEqual(doc.ticks(), [10]);
  assert.ok(doc.redo());
  assert.deepEqual(doc.ticks(), [10, 20]);
  assert.ok(!doc.redo());
});

test("a new edit clears the redo stack", () => {
  const doc = new MarkerDoc();
  doc.setMarker(1, true);
  doc.undo();
  doc.setMarker(2, true);
  assert.ok(!doc.canRedo());
  assert.deepEqual(doc.ticks(), [2]);
});

test("addTicks batches into ONE undo step (paint / band detect)", () => {
  const doc = new MarkerDoc();
  assert.equal(doc.addTicks([10, 20, 30]), 3);
  assert.deepEqual(doc.ticks(), [10, 20, 30]);
  assert.ok(doc.undo());
  assert.deepEqual(doc.ticks(), [], "one undo removes the whole batch");
  assert.ok(doc.redo());
  assert.deepEqual(doc.ticks(), [10, 20, 30]);
});

test("addTicks only counts newly set ticks and never pushes an empty undo", () => {
  const doc = docWith([10]);
  assert.equal(doc.addTicks([10, 20]), 1);
  assert.equal(doc.addTicks([20]), 0);
  assert.deepEqual(doc.ticks(), [10, 20]);
  doc.undo();
  assert.deepEqual(doc.ticks(), [10]);
});

test("removeTicks batches into ONE undo step (right-button erase)", () => {
  const doc = docWith([5, 15, 25, 40]);
  assert.equal(doc.removeTicks([5, 15, 25]), 3);
  assert.deepEqual(doc.ticks(), [40]);
  assert.ok(doc.undo());
  assert.deepEqual(doc.ticks(), [5, 15, 25, 40]);
});

test("commitSnapshot pushes only when the bitmap actually changed", () => {
  const doc = new MarkerDoc();
  const before = doc.snapshot();
  assert.equal(doc.commitSnapshot(before), false, "no change -> no undo entry");
  assert.ok(!doc.canUndo());

  doc.markers[7] = 1;
  assert.equal(doc.commitSnapshot(before), true);
  assert.deepEqual(doc.ticks(), [7]);
  assert.ok(doc.undo());
  assert.deepEqual(doc.ticks(), []);
});

test("restoreSnapshot reverts a cancelled gesture without touching undo", () => {
  const doc = docWith([100]);
  const before = doc.snapshot();
  doc.markers[200] = 1;
  doc.markers[100] = 0;
  doc.restoreSnapshot(before);
  assert.deepEqual(doc.ticks(), [100]);
  assert.ok(!doc.canUndo(), "cancelling a gesture must not add an undo step");
});

test("shiftAll moves the whole map (7/8 semantics) and drops out-of-range markers", () => {
  const doc = docWith([0, 100, MAX_TICKS - 1]);
  doc.shiftAll(1);
  // Markers pushed past the last tick fall off (bitmap semantics).
  assert.deepEqual(doc.ticks(), [1, 101]);
  doc.shiftAll(-2);
  assert.deepEqual(doc.ticks(), [99]);
});

test("sliceIndexAtOrBefore finds the slice under the cursor (P preview)", () => {
  const ticks = [384, 408, 7944];
  assert.equal(sliceIndexAtOrBefore(ticks, 500), 1);
  assert.equal(sliceIndexAtOrBefore(ticks, 384), 0);
  assert.equal(sliceIndexAtOrBefore(ticks, 383), -1);
  assert.equal(sliceIndexAtOrBefore(ticks, 49151), 2);
  assert.equal(markerAtOrBefore(ticks, 500), 408);
});
