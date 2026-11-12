/**
 * WAV reader/writer compatible with the original woslicerIII Cwav class.
 *
 * Reader requirements (contract):
 *  - Walks RIFF chunks, tolerating JUNK / smpl / LIST / bext and other extra
 *    chunks before `data`.
 *  - Supports PCM 8/16/24/32-bit (format tag 1). 32-bit follows the original's
 *    behaviour of taking the top 16 bits (sample >> 16). IEEE float WAVs
 *    (format tag 3) are decoded properly as an extension; the original would
 *    have produced garbage for them.
 *  - Internally all audio is stored as int16 in [-32768, 32767], matching the
 *    original which force-sets bit = 16 after load.
 *
 * The original scanned for the literal bytes "fmt " / "data" one byte at a
 * time inside a fixed 128-byte rolling buffer (and crashed on larger leading
 * chunks); this implementation walks the chunk list instead, which is
 * strictly more robust and reads identical results for all well-formed files.
 */

/** Original encoding, independent of the internal Int16 sample representation. */
export type SourceFormat =
  | { kind: 'pcm'; bits: number }
  | { kind: 'float'; bits: 32 }
  | { kind: 'vorbis' };

export interface DecodedWav {
  sourceFormat: SourceFormat;
  /** Sample rate in Hz. */
  sampleRate: number;
  /** Channel count (the original only reads its low byte; 1 or 2 expected). */
  channels: number;
  /** Frames per channel. */
  length: number;
  /** Per-channel samples in int16 range. */
  data: Int16Array[];
}

export class WavParseError extends Error {}

/**
 * The internal int16 scale: round(x * 32768) clamped to [-32768, 32767].
 * Single conversion contract shared by OGG decode, float WAV parsing and the
 * band analyzer — a change here must move all three together.
 */
export function floatToInternal(x: number): number {
  const v = Math.round(x * 32768);
  return v < -32768 ? -32768 : v > 32767 ? 32767 : v;
}

function fourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/**
 * Converts one sample read from arbitrary bit depth to the internal int16
 * representation used by the original:
 *   8 bit -> (byte - 128) << 8
 *   16 bit -> value as-is
 *   24 bit -> value >> 8 (top 16 bits)
 *   32 bit (int PCM) -> value >> 16 (top 16 bits, original behaviour)
 */
function sampleToInternal(raw: number, bits: number): number {
  let v: number;
  switch (bits) {
    case 8:
      v = (raw - 128) << 8;
      break;
    case 16:
      v = raw;
      break;
    case 24:
      v = raw >> 8;
      break;
    case 32:
      v = raw >> 16;
      break;
    default:
      throw new WavParseError(`unsupported bit depth: ${bits}`);
  }
  return v < -32768 ? -32768 : v > 32767 ? 32767 : v;
}

/** Reads 24-bit little-endian signed. */
function readS24(view: DataView, offset: number, le: boolean): number {
  const b0 = view.getUint8(offset);
  const b1 = view.getUint8(offset + 1);
  const b2 = view.getUint8(offset + 2);
  const raw = le ? b0 | (b1 << 8) | (b2 << 16) : (b0 << 16) | (b1 << 8) | b2;
  return raw & 0x800000 ? raw - 0x1000000 : raw;
}

/** Format facts and data-chunk location recovered from the RIFF chunk walk. */
interface WavLayout {
  formatTag: number;
  channels: number;
  sampleRate: number;
  bits: number;
  dataOffset: number;
  dataSize: number;
}

/**
 * RIFF header check and chunk walk: the first data chunk wins, and fmt must
 * have been seen before it (the original reads audio from the first data
 * chunk and validates the format afterwards).
 */
function scanWavChunks(buffer: ArrayBuffer, view: DataView): WavLayout {
  if (buffer.byteLength < 12) throw new WavParseError('file too small for RIFF');
  if (fourCC(view, 0) !== 'RIFF') throw new WavParseError('missing RIFF header');
  if (fourCC(view, 8) !== 'WAVE') throw new WavParseError('missing WAVE form type');

  const layout: WavLayout = {
    formatTag: 0,
    channels: 0,
    sampleRate: 0,
    bits: 0,
    dataOffset: -1,
    dataSize: 0,
  };
  let pos = 12;
  let fmtFound = false;

  while (pos + 8 <= buffer.byteLength) {
    const id = fourCC(view, pos);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ') {
      if (body + 16 > buffer.byteLength) throw new WavParseError('fmt chunk truncated');
      layout.formatTag = view.getUint16(body, true);
      layout.channels = view.getUint16(body + 2, true);
      layout.sampleRate = view.getUint32(body + 4, true);
      layout.bits = view.getUint16(body + 14, true);
      fmtFound = true;
    } else if (id === 'data') {
      layout.dataOffset = body;
      // Clamp to the actual buffer: some writers emit an oversized size field.
      layout.dataSize = Math.min(size, buffer.byteLength - body);
      break; // original reads audio from the first data chunk
    }
    // RIFF chunks are word-aligned.
    pos = body + size + (size & 1);
    if (size === 0 && id === 'data') break;
  }

  if (!fmtFound) throw new WavParseError('missing fmt chunk');
  if (layout.dataOffset < 0) throw new WavParseError('missing data chunk');
  return layout;
}

/** Decodes the data chunk into per-channel internal int16 buffers. */
function decodeWavSamples(view: DataView, layout: WavLayout, length: number): Int16Array[] {
  const wasFloat = layout.formatTag === 3;
  const bytesPerSample = layout.bits >> 3;

  const data: Int16Array[] = [];
  for (let c = 0; c < layout.channels; c++) data.push(new Int16Array(length));

  for (let f = 0; f < length; f++) {
    for (let c = 0; c < layout.channels; c++) {
      const off = layout.dataOffset + (f * layout.channels + c) * bytesPerSample;
      if (wasFloat) {
        data[c][f] = floatToInternal(view.getFloat32(off, true));
      } else {
        let raw = 0;
        switch (layout.bits) {
          case 8:
            raw = view.getUint8(off);
            data[c][f] = sampleToInternal(raw, 8);
            continue;
          case 16:
            raw = view.getInt16(off, true);
            break;
          case 24:
            raw = readS24(view, off, true);
            break;
          case 32:
            raw = view.getInt32(off, true);
            break;
        }
        data[c][f] = sampleToInternal(raw, layout.bits);
      }
    }
  }
  return data;
}

/** Parses a RIFF/WAVE byte buffer. Throws WavParseError on malformed input. */
export function parseWav(buffer: ArrayBuffer): DecodedWav {
  const view = new DataView(buffer);
  const layout = scanWavChunks(buffer, view);

  if (layout.channels < 1 || layout.channels > 2) {
    throw new WavParseError(`unsupported channel count ${layout.channels} (1 or 2 expected)`);
  }
  if (layout.formatTag !== 1 && layout.formatTag !== 3) {
    throw new WavParseError(
      `unsupported wave format tag ${layout.formatTag} (PCM or IEEE float expected)`,
    );
  }
  if (
    layout.formatTag === 1 &&
    layout.bits !== 8 &&
    layout.bits !== 16 &&
    layout.bits !== 24 &&
    layout.bits !== 32
  ) {
    throw new WavParseError(`unsupported PCM bit depth ${layout.bits}`);
  }
  if (layout.formatTag === 3 && layout.bits !== 32) {
    throw new WavParseError(`unsupported float bit depth ${layout.bits}`);
  }
  if (layout.sampleRate <= 0) throw new WavParseError('invalid sample rate');

  const length = Math.floor((Math.floor(layout.dataSize / layout.channels) * 8) / layout.bits);

  return {
    sampleRate: layout.sampleRate,
    channels: layout.channels,
    length,
    data: decodeWavSamples(view, layout, length),
    sourceFormat:
      layout.formatTag === 3 ? { kind: 'float', bits: 32 } : { kind: 'pcm', bits: layout.bits },
  };
}

/**
 * Encodes int16 channel data into a canonical 44-byte-header PCM WAV buffer.
 *
 * Reproduces the original WriteFile(), including its quirky overflow guard
 * `if (v >= 32678) v -= 65536` (sic, 32678 not 32768), for byte-exact output.
 */
export function encodeWav16(
  channelsData: Int16Array[],
  sampleRate: number,
  length: number,
): Uint8Array {
  const channels = channelsData.length;
  const dataSize = length * channels * 2;
  const out = new Uint8Array(44 + dataSize);
  const view = new DataView(out.buffer);

  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, dataSize + 36, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  let p = 44;
  for (let f = 0; f < length; f++) {
    for (let c = 0; c < channels; c++) {
      let v = channelsData[c][f];
      if (v >= 32678) v -= 65536; // original guard (sic)
      out[p++] = v & 0xff;
      out[p++] = (v >> 8) & 0xff;
    }
  }
  return out;
}
