import { test } from "node:test";
import assert from "node:assert/strict";
import { readWos, writeWos, WosFormatError, markerTicks, WOS_FILE_SIZE } from "../src/core/wos.js";
import { MAX_TICKS } from "../src/core/timebase.js";
import { emptyBitmap } from "./fixtures.js";

function doc(overrides: Partial<Parameters<typeof writeWos>[0]> = {}): Parameters<typeof writeWos>[0] {
  return {
    bpm: 185,
    shift: -1,
    fadeoutMs: 0,
    noisegateDb: -48,
    markers: emptyBitmap(),
    ...overrides,
  };
}

test("wos buffer is exactly 6168 bytes regardless of content", () => {
  assert.equal(writeWos(doc()).byteLength, WOS_FILE_SIZE);
  assert.equal(WOS_FILE_SIZE, 6168);
});

test("wos header layout: bpm double LE, shift double LE, fadeout int32, noisegate int32", () => {
  const bytes = writeWos(doc({ bpm: 185, shift: -1, fadeoutMs: 0, noisegateDb: -48 }));
  const view = new DataView(bytes.buffer);
  assert.equal(view.getFloat64(0, true), 185);
  assert.equal(view.getFloat64(8, true), -1);
  assert.equal(view.getInt32(16, true), 0);
  assert.equal(view.getInt32(20, true), -48);
});

test("wos bitmap is MSB-first: tick 0 lives in bit 7 of byte 24", () => {
  const markers = emptyBitmap();
  markers[0] = 1;
  markers[8] = 1;
  markers[49151] = 1;
  const bytes = writeWos(doc({ markers }));
  assert.equal(bytes[24], 0x80); // tick 0 -> MSB of first bitmap byte
  assert.equal(bytes[25], 0x80); // tick 8 -> MSB of second byte
  const last = bytes[24 + 6143];
  assert.equal(last, 0x01); // tick 49151 -> LSB of last byte
});

test("wos read/write round-trips markers and parameters exactly", () => {
  const markers = emptyBitmap();
  for (const t of [384, 408, 432, 456, 552, 600, 7944, 49151]) markers[t] = 1;
  const original = doc({ bpm: 123.456, shift: -0.2, fadeoutMs: 250, noisegateDb: -30, markers });
  const parsed = readWos(writeWos(original));
  assert.equal(parsed.bpm, 123.456);
  assert.equal(parsed.shift, -0.2);
  assert.equal(parsed.fadeoutMs, 250);
  assert.equal(parsed.noisegateDb, -30);
  assert.deepEqual(Array.from(parsed.markers), Array.from(original.markers));
  assert.deepEqual(markerTicks(parsed.markers), [384, 408, 432, 456, 552, 600, 7944, 49151]);
});

test("wos read rejects truncated files with a clear error", () => {
  assert.throws(() => readWos(new Uint8Array(6167)), WosFormatError);
  assert.throws(() => readWos(new Uint8Array(0)), WosFormatError);
});

test("wos save validates noisegate as integer instead of silently truncating", () => {
  assert.throws(() => writeWos(doc({ noisegateDb: -47.5 })), WosFormatError);
  assert.throws(() => writeWos(doc({ noisegateDb: Number.NaN })), WosFormatError);
  // Integer-valued floats are fine.
  assert.doesNotThrow(() => writeWos(doc({ noisegateDb: -48.0 })));
});

test("wos save validates bpm and fadeout", () => {
  assert.throws(() => writeWos(doc({ bpm: 0 })), WosFormatError);
  assert.throws(() => writeWos(doc({ bpm: Number.POSITIVE_INFINITY })), WosFormatError);
  assert.throws(() => writeWos(doc({ fadeoutMs: 1.5 })), WosFormatError);
});

test("wos reader accepts full-size buffers with extra trailing bytes", () => {
  const bytes = writeWos(doc());
  const padded = new Uint8Array(bytes.byteLength + 16);
  padded.set(bytes);
  assert.doesNotThrow(() => readWos(padded));
});

test("marker count never exceeds the 49152-tick timeline", () => {
  const markers = emptyBitmap();
  markers.fill(1);
  assert.equal(markerTicks(markers).length, MAX_TICKS);
});

test("wos save rejects marker arrays that are not exactly 49152 entries", () => {
  assert.throws(() => writeWos(doc({ markers: new Uint8Array(100) })), WosFormatError);
  assert.throws(() => writeWos(doc({ markers: new Uint8Array(MAX_TICKS + 1) })), WosFormatError);
  assert.throws(() => writeWos(doc({ markers: [] as unknown as Uint8Array })), WosFormatError);
});
