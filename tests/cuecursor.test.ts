import { test } from "node:test";
import assert from "node:assert/strict";
import { findCueCrossing } from "../src/core/cuecursor.js";
import { MAX_TICKS } from "../src/core/timebase.js";

const TICKS = [192, 384, 576];

test("cue fires exactly when playback crosses a marker upward", () => {
  assert.equal(findCueCrossing(TICKS, 0, 100, -1), -1);
  assert.equal(findCueCrossing(TICKS, 100, 192, -1), 0);
  assert.equal(findCueCrossing(TICKS, 193, 380, 0), -1);
  assert.equal(findCueCrossing(TICKS, 380, 384, 0), 1);
});

test("cue hit lands exactly ON the marker tick (inclusive upper bound)", () => {
  assert.equal(findCueCrossing(TICKS, 191, 192, -1), 0);
  assert.equal(findCueCrossing(TICKS, 190, 191, -1), -1);
});

test("no cue while paused or when seeking backwards", () => {
  assert.equal(findCueCrossing(TICKS, 400, 400, 1), -1, "paused");
  assert.equal(findCueCrossing(TICKS, 500, 200, 1), -1, "backwards seek");
  assert.equal(findCueCrossing(TICKS, 200, 200, 0), -1);
});

test("several markers crossed in one step collapse into the LAST index", () => {
  // A long frame (or a seek forward) may skip multiple markers at once.
  assert.equal(findCueCrossing(TICKS, 100, 600, -1), 2);
});

test("crossing does not re-fire for the same position on the next frame", () => {
  const first = findCueCrossing(TICKS, 150, 192, -1);
  assert.equal(first, 0);
  // The next rAF step moves past the marker; prevTick is now >= marker.
  const second = findCueCrossing(TICKS, 192, 250, first);
  assert.equal(second, -1);
});

test("restarting playback before the marker lets it fire again", () => {
  // Transport resets lastCueIndex and sets the cursor to the playhead tick.
  assert.equal(findCueCrossing(TICKS, 50, 192, -1), 0);
  // Second pass with a fresh cursor:
  assert.equal(findCueCrossing(TICKS, 50, 192, -1), 0);
});

test("empty marker list and out-of-range ticks never fire", () => {
  assert.equal(findCueCrossing([], 0, 100, -1), -1);
  assert.equal(findCueCrossing([MAX_TICKS + 5], 0, 100, -1), -1);
});

