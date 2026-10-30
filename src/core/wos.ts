/**
 * .wos project file reader/writer — byte-compatible with woslicerIII.
 *
 * Fixed 6168-byte layout (contract):
 *   offset  0  double LE  BPM
 *   offset  8  double LE  shift
 *   offset 16  int32  LE  fadeout (ms)
 *   offset 20  int32  LE  noisegate (dB)
 *   offset 24  6144 bytes  marker bitmap, 49152 bits, MSB-first per byte
 */

import { BITMAP_BYTES, MAX_TICKS } from "./timebase.js";

export const WOS_FILE_SIZE = 6168;
export const WOS_HEADER_SIZE = 24;

export interface WosDoc {
  bpm: number;
  shift: number;
  /** Fade-out length in milliseconds (int32 in the file). */
  fadeoutMs: number;
  /** Noise gate threshold in dB (stored as int32; input must be integer-valued). */
  noisegateDb: number;
  /** Marker bitmap: one byte per set/unset tick, length MAX_TICKS. */
  markers: Uint8Array;
}

export class WosFormatError extends Error {}

/** Validates that dB is an integer as required by the int32 file field. */
export function assertIntegerNoisegate(db: number): void {
  if (!Number.isFinite(db) || !Number.isInteger(db)) {
    throw new WosFormatError(
      `noisegate must be an integer number of dB to save (got ${db}); ` +
        "round the value explicitly before saving"
    );
  }
}

/**
 * Serializes a document to the fixed 6168-byte .wos representation.
 * Marker values are coerced to boolean; noisegate must be integer-valued
 * (validated, never silently truncated).
 */
export function writeWos(doc: WosDoc): Uint8Array {
  if (!(doc.markers instanceof Uint8Array) || doc.markers.length !== MAX_TICKS) {
    throw new WosFormatError(
      `marker bitmap must be a Uint8Array with exactly ${MAX_TICKS} entries ` +
        `(got ${doc.markers ? doc.markers.length : String(doc.markers)})`
    );
  }
  assertIntegerNoisegate(doc.noisegateDb);
  if (!Number.isFinite(doc.bpm) || doc.bpm <= 0) {
    throw new WosFormatError(`BPM must be a positive finite number (got ${doc.bpm})`);
  }
  if (!Number.isFinite(doc.shift)) {
    throw new WosFormatError(`shift must be finite (got ${doc.shift})`);
  }
  if (!Number.isInteger(doc.fadeoutMs)) {
    throw new WosFormatError(`fadeout must be an integer number of ms (got ${doc.fadeoutMs})`);
  }

  const out = new Uint8Array(WOS_FILE_SIZE);
  const view = new DataView(out.buffer);
  view.setFloat64(0, doc.bpm, true);
  view.setFloat64(8, doc.shift, true);
  view.setInt32(16, doc.fadeoutMs, true);
  view.setInt32(20, doc.noisegateDb, true);

  for (let byteIndex = 0; byteIndex < BITMAP_BYTES; byteIndex++) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) {
      byte <<= 1;
      if (doc.markers[byteIndex * 8 + bit]) byte += 1;
    }
    out[WOS_HEADER_SIZE + byteIndex] = byte;
  }
  return out;
}

/**
 * Parses a .wos buffer. Accepts buffers of at least 6168 bytes (extra trailing
 * bytes are ignored) and rejects truncated ones, listing what is missing.
 */
export function readWos(buffer: Uint8Array): WosDoc {
  if (buffer.byteLength < WOS_FILE_SIZE) {
    throw new WosFormatError(
      `.wos file must be exactly ${WOS_FILE_SIZE} bytes (got ${buffer.byteLength})`
    );
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const markers = new Uint8Array(MAX_TICKS);
  for (let byteIndex = 0; byteIndex < BITMAP_BYTES; byteIndex++) {
    const byte = buffer[WOS_HEADER_SIZE + byteIndex];
    for (let bit = 0; bit < 8; bit++) {
      markers[byteIndex * 8 + bit] = (byte & (0x80 >> bit)) !== 0 ? 1 : 0;
    }
  }
  return {
    bpm: view.getFloat64(0, true),
    shift: view.getFloat64(8, true),
    fadeoutMs: view.getInt32(16, true),
    noisegateDb: view.getInt32(20, true),
    markers,
  };
}

/** Sorted ascending list of ticks that have a marker. */
export function markerTicks(markers: Uint8Array): number[] {
  const ticks: number[] = [];
  for (let t = 0; t < MAX_TICKS; t++) {
    if (markers[t]) ticks.push(t);
  }
  return ticks;
}

/** Sets or clears a marker; returns true when the state changed. */
export function setMarker(markers: Uint8Array, tick: number, value: boolean): boolean {
  if (tick < 0 || tick >= MAX_TICKS) return false;
  const next = value ? 1 : 0;
  if (markers[tick] === next) return false;
  markers[tick] = next;
  return true;
}
