import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCut, renderSlice, safeGet, SourceAudio } from '../src/core/slicer.js';
import { encodeWav16, parseWav } from '../src/core/wav.js';
import { makeTestSource, wavBytes16, makeRng } from './fixtures.js';
import { tickToSampleExport } from '../src/core/timebase.js';

const BASE_185 = { bpm: 185, shift: -1, sampleRate: 48000 };

function toneSource(length: number, sampleRate = 48000): SourceAudio {
  const data = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    data[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 10000);
  }
  return { sampleRate, channels: 1, length, data: [data] };
}

test('safeGet returns 0 for reads at or beyond the end (contract: safe OOB read)', () => {
  const src = toneSource(10);
  assert.equal(safeGet(src, 0, 9), src.data[0][9]);
  assert.equal(safeGet(src, 0, 10), 0);
  assert.equal(safeGet(src, 0, 100000), 0);
});

test('safeGet returns 0 for negative indices (never undefined)', () => {
  const src = toneSource(10);
  assert.equal(safeGet(src, 0, -1), 0);
  assert.equal(safeGet(src, 0, -100000), 0);
});

test('fadeout 0: length = end - start + 16 with a 16-frame zero pad', () => {
  const src = toneSource(200000);
  const start = tickToSampleExport(384, BASE_185);
  const end = tickToSampleExport(408, BASE_185);
  assert.ok(end > start + 200);
  const rendered = renderSlice(src, { start, end, fadeoutMs: 0, noisegateDb: -48 });
  assert.equal(rendered.length, end - start + 16);
  const ch = rendered.channelsData[0];
  // Pad: last 16 frames zero.
  for (let i = rendered.length - 16; i < rendered.length; i++) {
    assert.equal(ch[i], 0, `frame ${i} of pad must be zero`);
  }
  // The frame just before the pad is an untouched source copy: the tone stays
  // above the -48 dB threshold to the very end, so Cut() leaves it alone.
  assert.equal(ch[rendered.length - 17], src.data[0][end - 1]);
});

test('fade-in region: first (48000/525)=91 frames use the integer-degree sine envelope', () => {
  const src = toneSource(48000);
  const start = 0;
  const end = 4000;
  const rendered = renderSlice(src, { start, end, fadeoutMs: 0, noisegateDb: 0 });
  const ch = rendered.channelsData[0];
  const fadeIn = Math.trunc(48000 / 525);
  assert.equal(fadeIn, 91);
  // Envelope: sin((int)(j*90/91) degrees). j=0 -> sin(0)=0, j=1 -> int(90/91)=0 -> 0.
  assert.equal(ch[0], 0);
  assert.equal(ch[1], 0);
  // j=13 -> int(13*90/91)=12 degrees -> sin(12deg)=0.20791...
  const expected13 = Math.trunc(src.data[0][13] * Math.sin(12 * 0.017453333362936974));
  assert.equal(ch[13], expected13);
  // j=91 onwards: exact copy.
  assert.equal(ch[91], src.data[0][91]);
  assert.equal(ch[200], src.data[0][200]);
});

test('noisegate dB=0 truncates the slice at its last non-zero sample', () => {
  const src = toneSource(2000);
  const rendered = renderSlice(src, { start: 0, end: 2000, fadeoutMs: 0, noisegateDb: 0 });
  // Original: length = min(length, lastLoud + msec) with msec forced to 0.
  // The last non-zero sample of the tone is at 1999 -> length 1999.
  assert.equal(rendered.length, 1999);
});

test('noisegate dB=0 on silence-padded content collapses trailing zeros', () => {
  const data = new Int16Array(100);
  data[50] = 500; // single loud frame mid-buffer
  const src: SourceAudio = { sampleRate: 48000, channels: 1, length: 100, data: [data] };
  const rendered = renderSlice(src, { start: 0, end: 100, fadeoutMs: 0, noisegateDb: 0 });
  // length = min(100, 50 + 0) = 50: frames 0..49 are kept (the original's
  // exclusive truncation at the last loud frame).
  assert.equal(rendered.length, 50);
  assert.equal(rendered.channelsData[0][49], 0);
});

test('noisegate -48 dB: threshold 128, cos decay over 11025, truncation to lastLoud+11025', () => {
  // Build: loud region, then quiet noise below 128 lasting longer than 11025.
  const length = 30000;
  const data = new Int16Array(length);
  const rng = makeRng(7);
  for (let i = 0; i < 5000; i++) {
    data[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / 48000) * 20000);
  }
  for (let i = 5000; i < length; i++) {
    data[i] = Math.round(rng() * 100 - 50); // max amplitude 50 < 128
  }
  const src: SourceAudio = { sampleRate: 48000, channels: 1, length, data: [data] };
  const rendered = renderSlice(src, { start: 0, end: length, fadeoutMs: 0, noisegateDb: -48 });
  // lastLoud = 4999 (last sample of the loud region with |v|>128).
  assert.equal(rendered.length, 4999 + 11025);
  // Cosine envelope at j: v * cos(j*90/11025 degrees); j=0 -> v (cos 0 = 1).
  // Recompute j=0 from the pre-gate content:
  assert.equal(rendered.channelsData[0][4999], data[4999]);
  // j=11025/2 -> cos(45deg) ~ 0.7071 applied to the (quiet) source value.
  const j = 5512;
  const expected = Math.trunc(
    data[4999 + j] * Math.cos(((j * 90.0) / 11025) * 0.017453332742055256),
  );
  assert.equal(rendered.channelsData[0][4999 + j], expected);
});

test('fully silent slice with gate collapses to 4 frames (original NULL behaviour)', () => {
  const src: SourceAudio = {
    sampleRate: 48000,
    channels: 1,
    length: 1000,
    data: [new Int16Array(1000)],
  };
  const rendered = renderSlice(src, { start: 0, end: 1000, fadeoutMs: 0, noisegateDb: -48 });
  assert.equal(rendered.length, 4);
});

test('gate is skipped when the tail after the last loud frame is short', () => {
  // Loud till the end minus a few frames: length - lastLoud <= 11025 -> untouched.
  const length = 200;
  const data = new Int16Array(length);
  for (let i = 0; i < length; i++) data[i] = 1000;
  const src: SourceAudio = { sampleRate: 48000, channels: 1, length, data: [data] };
  const rendered = renderSlice(src, { start: 0, end: length, fadeoutMs: 0, noisegateDb: -48 });
  assert.equal(rendered.length, length + 16); // copy + pad, untouched by Cut
  // Frame 100 is past the 91-frame fade-in: exact copy of the source.
  assert.equal(rendered.channelsData[0][100], 1000);
});

test('fadeout > 0 appends a decaying sustain tail read past the cut', () => {
  // Constant source: no zero crossings, so the tail simply reads forward with
  // the decaying sin envelope. Gain at tail frame j is
  //   sin((int)((T - j) * 90 / T) degrees)  (integer division!)
  const value = 1000;
  const data = new Int16Array(40000).fill(value);
  const src: SourceAudio = { sampleRate: 48000, channels: 1, length: 40000, data: [data] };
  const start = 1000;
  const end = 20000;
  const T = Math.trunc((48000 * 230) / 1000); // 11040
  // Gate at -48 dB stays inactive here: the tail keeps frames above 128 until
  // 8 frames from its end, so length - lastLoud <= 11025 and Cut is a no-op.
  const rendered = renderSlice(src, { start, end, fadeoutMs: 230, noisegateDb: -48 });
  const ch = rendered.channelsData[0];
  assert.equal(rendered.length, end + T - start + 16);
  // Tail frame 0: envelope sin(90deg) with the x87 double angle -> just under 1.
  assert.equal(ch[end - start], Math.trunc(value * Math.sin(90 * 0.017453333362936974)));
  // Tail frame 5: (11040-5)*90/11040 = 89 (integer division).
  assert.equal(
    ch[end - start + 5],
    Math.trunc(value * Math.sin(Math.trunc(((T - 5) * 90) / T) * 0.017453333362936974)),
  );
  // The final tail frames quantize to zero via integer division (gain 0);
  // the trailing zeros are exactly what Cut(dB=0) then leaves in place.
  assert.equal(ch[end - start + T - 1], 0);
  assert.equal(ch[end - start + T - 100], 0);
});

test('a cut at the end of the source renders an empty (zero-duration) slice', () => {
  // The original fabricated a reversed echo here (a confirmed defect); the
  // fixed semantics produce a clean zero-duration slice, which encodes as a
  // valid 44-byte header-only WAV.
  const data = new Int16Array(9600).fill(1000);
  const src: SourceAudio = { sampleRate: 48000, channels: 1, length: 9600, data: [data] };
  const rendered = renderSlice(src, { start: 9600, end: 9600, fadeoutMs: 250, noisegateDb: 0 });
  assert.equal(rendered.length, 0);
  assert.equal(rendered.channelsData[0].length, 0);
  const bytes = encodeWav16(rendered.channelsData, rendered.sampleRate, rendered.length);
  assert.equal(bytes.byteLength, 44);
  assert.equal(bytes[0], 0x52); // 'R'
});

test('a tail overrunning the source end stops at the material (no fabricated echo)', () => {
  // end == source length with a long fadeout: the tail wants 12000 frames
  // but no material exists past the end. The fixed tail simply stops
  // producing audio there (no foldback, no phase-inverted echo); the
  // trailing silence is Cut(dB=0)-truncated at the last non-zero frame.
  const data = new Int16Array(9600).fill(1000);
  const src: SourceAudio = { sampleRate: 48000, channels: 1, length: 9600, data: [data] };
  const rendered = renderSlice(src, { start: 0, end: 9600, fadeoutMs: 250, noisegateDb: 0 });
  // Cut(dB=0) truncates at lastLoud (exclusive length = lastLoud + 0).
  assert.equal(rendered.length, 9599);
  const ch = rendered.channelsData[0];
  // The inverted echo would show up as negative frames: none may exist.
  assert.ok(!Array.from(ch).some((v) => v < 0), 'no phase-inverted echo frames');
  assert.equal(ch[9598], 1000);
});

test('encodeWav16 reproduces the original 32678 overflow guard and header', () => {
  const ch = new Int16Array([0, 1, -1, 32767, 32677, 32678, -32768]);
  const bytes = encodeWav16([ch], 48000, 7);
  const view = new DataView(bytes.buffer);
  assert.equal(bytes[0], 0x52); // 'R'
  assert.equal(view.getUint32(4, true), 36 + 14); // dataSize + 36
  assert.equal(view.getUint32(40, true), 14);
  const parsed = parseWav(bytes.buffer.slice(0) as ArrayBuffer);
  assert.equal(parsed.length, 7);
  assert.equal(parsed.data[0][0], 0);
  assert.equal(parsed.data[0][3], 32767);
  // The original's `v >= 32678 -> v -= 65536` guard is byte-transparent: the
  // low 16 bits are unchanged, so 32678 round-trips exactly.
  assert.equal(parsed.data[0][5], 32678);
  assert.equal(parsed.data[0][4], 32677);
  assert.equal(parsed.data[0][6], -32768);
});

test('rendered slices convert to deterministic canonical WAV bytes', () => {
  const src = makeTestSource(48000, 120);
  const a = renderSlice(src, { start: 0, end: 19200, fadeoutMs: 0, noisegateDb: -48 });
  const bytesA = encodeWav16(a.channelsData, a.sampleRate, a.length);
  const bytesB = encodeWav16(a.channelsData, a.sampleRate, a.length);
  assert.deepEqual(Array.from(bytesA), Array.from(bytesB));
  assert.equal(bytesA.byteLength, 44 + a.length * 2 * 2);
});

test('stereo render keeps channels independent', () => {
  const src = makeTestSource(48000, 120);
  const rendered = renderSlice(src, {
    start: 0,
    end: tickToSampleExport(96, BASE_185),
    fadeoutMs: 0,
    noisegateDb: 0,
  });
  assert.equal(rendered.channelsData.length, 2);
  // Left is 440Hz, right 330Hz: channels differ somewhere.
  let differ = false;
  for (let i = 95; i < rendered.length - 16; i++) {
    if (rendered.channelsData[0][i] !== rendered.channelsData[1][i]) {
      differ = true;
      break;
    }
  }
  assert.ok(differ);
});

test('applyCut returns 4 for a silent slice and length for a short-tail slice', () => {
  const silent = [new Int16Array(500)];
  assert.equal(applyCut(silent, 500, -48, 11025), 4);
  const loud = [new Int16Array(500).fill(900)];
  assert.equal(applyCut(loud, 500, -48, 11025), 500);
});
