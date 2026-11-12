/** Deterministic audio/fixture builders shared by the test suites. */

import { DecodedWav } from '../src/core/wav.js';
import { MAX_TICKS } from '../src/core/timebase.js';

/** Deterministic linear congruential generator (reproducible "noise"). */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Encodes int16 channel data as a canonical PCM16 WAV buffer. */
export function wavBytes16(channelsData: Int16Array[], sampleRate: number): Uint8Array {
  const channels = channelsData.length;
  const length = channelsData[0].length;
  const dataSize = length * channels * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const ascii = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, dataSize + 36, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  let p = 44;
  for (let f = 0; f < length; f++) {
    for (let c = 0; c < channels; c++) {
      const v = channelsData[c][f];
      view.setInt16(p, v, true);
      p += 2;
    }
  }
  return new Uint8Array(buf);
}

/** Builds a WAV byte buffer at an arbitrary PCM bit depth. */
export function wavBytesDepth(
  samples: number[],
  sampleRate: number,
  bits: 8 | 16 | 24 | 32,
): Uint8Array {
  const bytesPer = bits >> 3;
  const dataSize = samples.length * bytesPer;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const ascii = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, dataSize + 36, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPer, true);
  view.setUint16(32, bytesPer, true);
  view.setUint16(34, bits, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  let p = 44;
  for (const s of samples) {
    switch (bits) {
      case 8:
        view.setUint8(p, s & 0xff);
        break;
      case 16:
        view.setInt16(p, s, true);
        break;
      case 24:
        view.setUint8(p, s & 0xff);
        view.setUint8(p + 1, (s >> 8) & 0xff);
        view.setUint8(p + 2, (s >> 16) & 0xff);
        break;
      case 32:
        view.setInt32(p, s, true);
        break;
    }
    p += bytesPer;
  }
  return new Uint8Array(buf);
}

/** Wraps arbitrary extra RIFF chunks (as raw bytes) before the data chunk. */
export function wavWithExtraChunks(
  extraChunks: Array<{ id: string; body: Uint8Array }>,
  pcm: Uint8Array,
  bits = 16,
  channels = 1,
  sampleRate = 48000,
): Uint8Array {
  const bytesPer = bits >> 3;
  const dataSize = pcm.length;
  const extraSize = extraChunks.reduce(
    (acc, c) => acc + 8 + c.body.length + (c.body.length & 1),
    0,
  );
  const total = 12 + extraSize + 24 + 8 + dataSize;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const ascii = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, total - 8, true);
  ascii(8, 'WAVE');
  let p = 12;
  for (const chunk of extraChunks) {
    ascii(p, chunk.id);
    view.setUint32(p + 4, chunk.body.length, true);
    new Uint8Array(buf).set(chunk.body, p + 8);
    p += 8 + chunk.body.length + (chunk.body.length & 1);
  }
  ascii(p, 'fmt ');
  view.setUint32(p + 4, 16, true);
  view.setUint16(p + 8, 1, true);
  view.setUint16(p + 10, channels, true);
  view.setUint32(p + 12, sampleRate, true);
  view.setUint32(p + 16, sampleRate * channels * bytesPer, true);
  view.setUint16(p + 20, channels * bytesPer, true);
  view.setUint16(p + 22, bits, true);
  p += 24;
  ascii(p, 'data');
  view.setUint32(p + 4, dataSize, true);
  new Uint8Array(buf).set(pcm, p + 8);
  return new Uint8Array(buf);
}

/**
 * Deterministic stereo test source, 2 measures at the given BPM:
 * - a loud decaying "note" in the first measure,
 * - near-silence (tiny deterministic noise) afterwards.
 */
export function makeTestSource(sampleRate: number, bpm: number, measures = 2): DecodedWav {
  const ticksPerSecond = (sampleRate * 5) / (4 * bpm);
  const length = Math.floor(ticksPerSecond * 192 * measures);
  const left = new Int16Array(length);
  const right = new Int16Array(length);
  const rng = makeRng(42);
  const noteEnd = Math.floor(length / 2);
  for (let i = 0; i < length; i++) {
    if (i < noteEnd) {
      const decay = 1 - i / noteEnd;
      const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 20000 * decay);
      left[i] = v;
      right[i] = Math.round(Math.sin((2 * Math.PI * 330 * i) / sampleRate) * 18000 * decay);
    } else {
      left[i] = Math.round(rng() * 60 - 30);
      right[i] = Math.round(rng() * 60 - 30);
    }
  }
  return { sampleRate, channels: 2, length, data: [left, right], wasFloat: false };
}

/** Empty marker bitmap. */
export function emptyBitmap(): Uint8Array {
  return new Uint8Array(MAX_TICKS);
}
