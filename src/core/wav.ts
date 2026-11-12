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

export interface DecodedWav {
  /** Sample rate in Hz. */
  sampleRate: number;
  /** Channel count (the original only reads its low byte; 1 or 2 expected). */
  channels: number;
  /** Frames per channel. */
  length: number;
  /** Per-channel samples in int16 range. */
  data: Int16Array[];
  /** True when the input was IEEE float (decoded exactly, not truncated). */
  wasFloat: boolean;
}

export class WavParseError extends Error {}

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

/** Parses a RIFF/WAVE byte buffer. Throws WavParseError on malformed input. */
export function parseWav(buffer: ArrayBuffer): DecodedWav {
  if (buffer.byteLength < 12) throw new WavParseError('file too small for RIFF');
  const view = new DataView(buffer);
  if (fourCC(view, 0) !== 'RIFF') throw new WavParseError('missing RIFF header');
  if (fourCC(view, 8) !== 'WAVE') throw new WavParseError('missing WAVE form type');

  let pos = 12;
  let fmtFound = false;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let formatTag = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (pos + 8 <= buffer.byteLength) {
    const id = fourCC(view, pos);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ') {
      if (body + 16 > buffer.byteLength) throw new WavParseError('fmt chunk truncated');
      formatTag = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      fmtFound = true;
    } else if (id === 'data') {
      dataOffset = body;
      // Clamp to the actual buffer: some writers emit an oversized size field.
      dataSize = Math.min(size, buffer.byteLength - body);
      break; // original reads audio from the first data chunk
    }
    // RIFF chunks are word-aligned.
    pos = body + size + (size & 1);
    if (size === 0 && id === 'data') break;
  }

  if (!fmtFound) throw new WavParseError('missing fmt chunk');
  if (dataOffset < 0) throw new WavParseError('missing data chunk');
  if (channels < 1 || channels > 2) {
    throw new WavParseError(`unsupported channel count ${channels} (1 or 2 expected)`);
  }
  if (formatTag !== 1 && formatTag !== 3) {
    throw new WavParseError(
      `unsupported wave format tag ${formatTag} (PCM or IEEE float expected)`,
    );
  }
  if (formatTag === 1 && bits !== 8 && bits !== 16 && bits !== 24 && bits !== 32) {
    throw new WavParseError(`unsupported PCM bit depth ${bits}`);
  }
  if (formatTag === 3 && bits !== 32) {
    throw new WavParseError(`unsupported float bit depth ${bits}`);
  }
  if (sampleRate <= 0) throw new WavParseError('invalid sample rate');

  const wasFloat = formatTag === 3;
  const bytesPerSample = bits >> 3;
  // Original: length = dataSize / channel * 8 / bit (integer ops, same result).
  const length = Math.floor((Math.floor(dataSize / channels) * 8) / bits);

  const data: Int16Array[] = [];
  for (let c = 0; c < channels; c++) data.push(new Int16Array(length));

  const dv = view;
  for (let f = 0; f < length; f++) {
    for (let c = 0; c < channels; c++) {
      const off = dataOffset + (f * channels + c) * bytesPerSample;
      if (wasFloat) {
        const x = dv.getFloat32(off, true);
        let v = Math.round(x * 32768);
        v = v < -32768 ? -32768 : v > 32767 ? 32767 : v;
        data[c][f] = v;
      } else {
        let raw = 0;
        switch (bits) {
          case 8:
            raw = dv.getUint8(off);
            data[c][f] = sampleToInternal(raw, 8);
            continue;
          case 16:
            raw = dv.getInt16(off, true);
            break;
          case 24:
            raw = readS24(dv, off, true);
            break;
          case 32:
            raw = dv.getInt32(off, true);
            break;
        }
        data[c][f] = sampleToInternal(raw, bits);
      }
    }
  }

  return { sampleRate, channels, length, data, wasFloat };
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
