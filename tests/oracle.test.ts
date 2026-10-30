/**
 * Oracle verification against the original woslicerIII output.
 *
 * Loads the repository's own sample set (woslicerIII/KEY.wav + woslicerIII/new)
 * and verifies the reimplemented DSP reproduces the original exported slices
 * byte-for-byte. Skipped (with a notice) when the sample set is absent.
 *
 * Known parameters recovered from the oracle: BPM 185, shift -1, fadeout 0,
 * noisegate -48 dB, gate checkbox on. Slice 148 was exported when marker
 * 5856 was the LAST marker (end = source length); the saved .wos gained one
 * extra marker (7944) afterwards, so the oracle renderer treats slice 148
 * with end = source length.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { parseWav } from "../src/core/wav.js";
import { readWos, markerTicks } from "../src/core/wos.js";
import { renderSlice } from "../src/core/slicer.js";
import { tickToSampleExport } from "../src/core/timebase.js";
import { encodeWav16 } from "../src/core/wav.js";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const oracleDir = path.join(repoRoot, "woslicerIII");
const oracleNew = path.join(oracleDir, "new");
const sourceWav = path.join(oracleDir, "KEY.wav");
const oracleWos = path.join(oracleNew, "KEY.wos");

const hasOracle = fs.existsSync(sourceWav) && fs.existsSync(oracleWos);

function loadSource() {
  const bytes = fs.readFileSync(sourceWav);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return parseWav(buffer);
}

test("oracle: KEY.wav parses with the expected format", { skip: !hasOracle }, () => {
  const wav = loadSource();
  assert.equal(wav.sampleRate, 48000);
  assert.equal(wav.channels, 2);
  assert.equal(wav.length, 8718429);
});

test("oracle: KEY.wos parameters and marker count", { skip: !hasOracle }, () => {
  const doc = readWos(fs.readFileSync(oracleWos));
  assert.equal(doc.bpm, 185);
  assert.equal(doc.shift, -1);
  assert.equal(doc.fadeoutMs, 0);
  assert.equal(doc.noisegateDb, -48);
  assert.equal(markerTicks(doc.markers).length, 150); // saved after the export
});

test("oracle: every exported slice length matches end-start+16 (with Cut applied)", { skip: !hasOracle }, () => {
  const files = fs
    .readdirSync(oracleNew)
    .filter((f) => /^KEY_\d{3}\.wav$/.test(f))
    .sort();
  assert.equal(files.length, 149);
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(oracleNew, file));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dataSize = view.getUint32(40, true);
    assert.equal(dataSize % 4, 0, `${file}: data not frame-aligned`);
  }
});

test("oracle: slices KEY_000..KEY_148 render byte-identical", { skip: !hasOracle }, () => {
  const wav = loadSource();
  const doc = readWos(fs.readFileSync(oracleWos));
  const ticks = markerTicks(doc.markers);
  const base = { bpm: doc.bpm, shift: doc.shift, sampleRate: wav.sampleRate };

  let verified = 0;
  for (let index = 0; index < 149; index++) {
    const file = `KEY_${String(index).padStart(3, "0")}.wav`;
    const oraclePath = path.join(oracleNew, file);
    if (!fs.existsSync(oraclePath)) continue;
    const oracleBytes = fs.readFileSync(oraclePath);

    // The export happened with marker 5856 (index 148) as the final marker:
    // slice 148 therefore ends at the source length.
    const isLastSliceOfExport = index === 148;
    const start = tickToSampleExport(ticks[index], base);
    const end = isLastSliceOfExport
      ? wav.length
      : tickToSampleExport(ticks[index + 1], base);

    const rendered = renderSlice(
      { sampleRate: wav.sampleRate, channels: wav.channels, length: wav.length, data: wav.data },
      { start, end, fadeoutMs: doc.fadeoutMs, noisegateDb: doc.noisegateDb }
    );
    const bytes = encodeWav16(rendered.channelsData, rendered.sampleRate, rendered.length);
    assert.equal(
      bytes.byteLength,
      oracleBytes.byteLength,
      `${file}: size mismatch (got ${bytes.byteLength}, want ${oracleBytes.byteLength})`
    );
    let firstDiff = -1;
    for (let i = 0; i < bytes.byteLength; i++) {
      if (bytes[i] !== oracleBytes[i]) {
        firstDiff = i;
        break;
      }
    }
    assert.equal(firstDiff, -1, `${file}: first differing byte at ${firstDiff}`);
    verified++;
  }
  assert.ok(verified >= 149, `verified ${verified} slices`);
});
