import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWav, encodeWav16, WavParseError } from "../src/core/wav.js";
import { wavBytes16, wavBytesDepth, wavWithExtraChunks } from "./fixtures.js";

test("parses canonical 16-bit stereo WAV", () => {
  const left = new Int16Array([0, 1000, -1000, 32767]);
  const right = new Int16Array([0, -500, 500, -32768]);
  const wav = parseWav(wavBytes16([left, right], 48000).buffer.slice(0) as ArrayBuffer);
  assert.equal(wav.sampleRate, 48000);
  assert.equal(wav.channels, 2);
  assert.equal(wav.length, 4);
  assert.equal(wav.data[0][3], 32767);
  assert.equal(wav.data[1][3], -32768);
});

test("walks RIFF chunks: JUNK / smpl / LIST before fmt+data are tolerated", () => {
  const pcm = new Int16Array([100, -100]);
  const pcmBytes = new Uint8Array(pcm.buffer.slice(0));
  const junk = new Uint8Array(28);
  const smpl = new Uint8Array(60).fill(0x7f);
  const list = new Uint8Array(10);
  const bytes = wavWithExtraChunks(
    [
      { id: "JUNK", body: junk },
      { id: "smpl", body: smpl },
      { id: "LIST", body: list },
    ],
    pcmBytes
  );
  const wav = parseWav(bytes.buffer.slice(0) as ArrayBuffer);
  assert.equal(wav.channels, 1);
  assert.equal(wav.length, 2);
  assert.equal(wav.data[0][0], 100);
});

test("8-bit WAV decodes as (byte - 128) << 8 like the original", () => {
  // byte 128 -> 0, byte 255 -> 32512, byte 0 -> -32768
  const wav = parseWav(wavBytesDepth([128, 255, 0, 200], 44100, 8).buffer.slice(0) as ArrayBuffer);
  assert.equal(wav.data[0][0], 0);
  assert.equal(wav.data[0][1], 32512);
  assert.equal(wav.data[0][2], -32768);
  assert.equal(wav.data[0][3], (200 - 128) << 8);
});

test("24-bit WAV decodes as the top 16 bits (>> 8)", () => {
  // 0x010203 -> 0x0102 = 258
  const wav = parseWav(wavBytesDepth([0x010203, 0xfe5678], 48000, 24).buffer.slice(0) as ArrayBuffer);
  assert.equal(wav.data[0][0], 0x0102);
  assert.equal(wav.data[0][1], 0xfe56 - 0x10000); // sign-extended
});

test("32-bit int WAV decodes as the top 16 bits (>> 16, original behaviour)", () => {
  const wav = parseWav(wavBytesDepth([0x01020304, -65536], 48000, 32).buffer.slice(0) as ArrayBuffer);
  assert.equal(wav.data[0][0], 0x0102);
  assert.equal(wav.data[0][1], -1); // -65536 >> 16 = -1
});

test("32-bit IEEE float WAV decodes exactly (documented extension)", () => {
  const samples = [0.5, -0.25, 0.999, -1.0];
  const dataSize = samples.length * 4;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const ascii = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, dataSize + 36, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); // IEEE float
  view.setUint16(22, 1, true);
  view.setUint32(24, 48000, true);
  view.setUint32(28, 48000 * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 32, true);
  ascii(36, "data");
  view.setUint32(40, dataSize, true);
  samples.forEach((s, i) => view.setFloat32(44 + i * 4, s, true));

  const wav = parseWav(buf);
  assert.equal(wav.wasFloat, true);
  assert.equal(wav.data[0][0], Math.round(0.5 * 32768));
  assert.equal(wav.data[0][1], Math.round(-0.25 * 32768));
  assert.equal(wav.data[0][3], -32768);
});

test("malformed inputs raise WavParseError with actionable messages", () => {
  assert.throws(() => parseWav(new ArrayBuffer(4)), WavParseError);
  const notWave = new ArrayBuffer(16);
  new DataView(notWave).setUint32(0, 0x52534946, false); // "RSIF" reversed
  assert.throws(() => parseWav(notWave), /RIFF/);
  assert.throws(() => parseWav(wavBytesDepth([1, 2], 48000, 16).slice(0, 30).buffer as ArrayBuffer), WavParseError);
});

test("truncated data chunk clamps to the bytes actually present", () => {
  const full = wavBytes16([new Int16Array([1, 2, 3, 4, 5, 6])], 48000);
  const truncated = full.slice(0, 44 + 8); // claims 12 bytes of data, only 8 present
  const view = new DataView(
    truncated.buffer.slice(truncated.byteOffset, truncated.byteOffset + truncated.byteLength) as ArrayBuffer
  );
  view.setUint32(4, 44 + 8 - 8, true); // fix RIFF size
  const wav = parseWav(view.buffer);
  assert.equal(wav.length, 4); // 8 bytes / 2 channels? no: mono -> 4 frames
});

test("encodeWav16 header is fully deterministic", () => {
  const a = encodeWav16([new Int16Array([5, 6])], 44100, 2);
  const b = encodeWav16([new Int16Array([5, 6])], 44100, 2);
  assert.deepEqual(Array.from(a), Array.from(b));
  const ascii = Array.from(a.slice(0, 44))
    .map((v) => String.fromCharCode(v))
    .join("");
  assert.ok(ascii.startsWith("RIFF"));
  assert.ok(ascii.includes("WAVE"));
  assert.ok(ascii.includes("data"));
});
