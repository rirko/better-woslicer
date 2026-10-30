/**
 * Slice renderer — a faithful port of the original woslicerIII DSP
 * (Class1.woswrite / Class1.Cut / Class1.safe_data / Class1.WriteFile),
 * recovered by disassembling the original .NET binary.
 *
 * Everything here is intentional, including:
 *  - integer divisions inside the envelope angle computations,
 *  - float32 rounding of envelope angles before Math.sin / Math.cos,
 *  - truncation toward zero after every sample multiply,
 *  - the ping-pong "sustain" tail that reads the source past the cut point
 *    and reverses (with phase inversion) on zero crossings,
 *  - the Cut() trailing-silence gate with the Math.cos decay,
 *  - the WriteFile overflow guard `v >= 32678` (sic) in wav.ts.
 * Do not "fix" any of this without re-verifying against the oracle slices.
 */

import { DEG_TO_RAD_F32, DEG_TO_RAD_F64, intDiv, toInt32 } from "./float32.js";
import { encodeWav16 } from "./wav.js";

export interface SourceAudio {
  sampleRate: number;
  channels: number;
  length: number;
  /** Per-channel int16 samples. */
  data: Int16Array[];
}

/** Original safe_data: out-of-range reads return 0 (negative or past end). */
export function safeGet(src: SourceAudio, channel: number, index: number): number {
  return index < 0 || index >= src.length ? 0 : src.data[channel][index];
}

export interface SliceParams {
  /** Start sample (inclusive), from the marker tick via tickToSampleExport. */
  start: number;
  /** End sample (exclusive); clamped to source length like the original. */
  end: number;
  /** Fade-out sustain length in milliseconds (int, as in the original). */
  fadeoutMs: number;
  /**
   * Noise gate threshold in dB. The original Cut() takes a double here
   * (`Cut(double dB, int msec)`); 0 disables the gate entirely.
   */
  noisegateDb: number;
}

export interface RenderedSlice {
  channelsData: Int16Array[];
  sampleRate: number;
  length: number;
}

/**
 * Port of woswrite: renders one slice into a fresh buffer.
 *
 * Layout of the output, per channel:
 *   [0, fadeIn)               fade-in: source * sin(j * 90 / fadeIn degrees)
 *                             with (j*90/fadeIn) an INTEGER division.
 *   [fadeIn, end - start)     plain copy of the source.
 *   [end - start, end - start + tailLen)
 *                             sustain: reads the source forward from `end`,
 *                             ping-pongs with phase inversion on zero
 *                             crossings, enveloped by a decaying sin.
 *   + 16 trailing zero frames (pad), included in the length formula.
 */
export function renderSlice(src: SourceAudio, params: SliceParams): RenderedSlice {
  const fadeIn = intDiv(src.sampleRate, 525);
  const tailLen = intDiv(src.sampleRate * params.fadeoutMs, 1000);
  const end = Math.min(src.length, params.end);
  const start = params.start;
  const length = end + tailLen - start + 16;

  if (start < 0) throw new RangeError(`slice start ${start} is negative`);
  if (length < 0) {
    throw new RangeError(`slice length ${length} is negative (start ${start}, end ${end})`);
  }

  const channelsData: Int16Array[] = [];
  for (let c = 0; c < src.channels; c++) {
    const out = new Int16Array(length);

    // Fade-in region: j in [0, fadeIn)
    for (let j = 0; j < fadeIn; j++) {
      // Plain double multiply: the original ran under the x87 extended
      // precision model, so the f32 angle product is NOT rounded to float32
      // before Math.Sin (verified against the oracle slices).
      const angle = intDiv(j * 90, fadeIn) * DEG_TO_RAD_F32;
      const gain = Math.sin(angle);
      out[j] = toInt32(gain * safeGet(src, c, start + j));
    }

    // Copy region: [start + fadeIn, end)
    for (let pos = start + fadeIn; pos < end; pos++) {
      out[pos - start] = safeGet(src, c, pos);
    }

    // Sustain tail: while (out < end + tailLen)
    if (tailLen > 0) {
      let prev = 0;
      let dir = 1;
      let readPos = end;
      let outPos = end;
      while (outPos < end + tailLen) {
        const prevPrev = prev;
        prev = safeGet(src, c, Math.max(0, readPos));
        if (dir === 1 && (prevPrev * prev < 0 || readPos === src.length)) {
          // Fold back at a zero crossing, or unconditionally at the end of
          // the source. The original decrements the read position and then
          // still applies `readPos += dir`, so the net move is -2, and the
          // output frame is skipped (left as zero).
          dir = -1;
          readPos -= 1;
          readPos += dir;
          outPos += 1;
          continue;
        }
        // Same x87 double-precision behaviour as the fade-in angle.
        const angle = intDiv((end + tailLen - outPos) * 90, tailLen) * DEG_TO_RAD_F32;
        out[outPos - start] = toInt32(prev * Math.sin(angle) * dir);
        readPos += dir;
        outPos += 1;
      }
    }

    channelsData.push(out);
  }

  // The original always applies Cut(dB, 11025) to the rendered slice before
  // writing. With dB == 0 the gate truncates the slice at its last non-zero
  // sample (threshold 0, zero-length cosine ramp); that behaviour is kept.
  return {
    channelsData,
    sampleRate: src.sampleRate,
    length: applyCut(channelsData, length, params.noisegateDb, 11025),
  };
}

/**
 * Port of Cut(dB, msec): the trailing-silence gate.
 *
 * Scans backwards for the last frame with any channel sample whose absolute
 * value exceeds the threshold, applies a Math.cos decay over the following
 * `msec` frames, then truncates the slice to lastLoud + msec frames.
 * A slice with no sample above the threshold collapses to 4 frames.
 */
export function applyCut(
  channelsData: Int16Array[],
  length: number,
  noisegateDb: number,
  msec: number
): number {
  // Original: dB == 0 forces threshold = 0 and msec = 0 before scanning.
  const threshold = noisegateDb === 0 ? 0 : toInt32(32768.0 / Math.pow(2.0, noisegateDb / -6.0));
  const msecLocal = noisegateDb === 0 ? 0 : msec;

  let lastLoud = -1;
  for (let frame = length - 1; frame >= 0; frame--) {
    for (let c = 0; c < channelsData.length; c++) {
      if (Math.abs(channelsData[c][frame]) > threshold) {
        lastLoud = frame;
        break;
      }
    }
    if (lastLoud >= 0) break;
  }

  if (lastLoud < 0) return 4; // nothing above threshold: "(NULL)" 4-frame slice

  if (length - lastLoud <= msecLocal) return length; // tail too short: untouched

  for (let c = 0; c < channelsData.length; c++) {
    for (let j = 0; j < msecLocal; j++) {
      const idx = lastLoud + j;
      const angle = ((j * 90.0) / msecLocal) * DEG_TO_RAD_F64;
      channelsData[c][idx] = toInt32(channelsData[c][idx] * Math.cos(angle));
    }
  }
  return Math.min(length, lastLoud + msecLocal);
}

/**
 * Renders a slice and encodes it as a canonical 16-bit PCM WAV byte buffer,
 * matching the original SoundPlay -> prev.wav / total export pipeline.
 */
export function renderSliceToWav(src: SourceAudio, params: SliceParams): Uint8Array {
  const rendered = renderSlice(src, params);
  return encodeWav16(rendered.channelsData, rendered.sampleRate, rendered.length);
}
