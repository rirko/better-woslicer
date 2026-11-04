import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRELOADED_API_KEYS,
  hasAudioExtension,
  hasWosExtension,
  validateDirectoryPath,
  validateExportRequest,
  validateWavOutputPath,
  validateWosFilePath,
} from "../src/main/channels.js";

test("preload API surface stays exactly on the documented allowlist", () => {
  assert.deepEqual([...PRELOADED_API_KEYS].sort(), [
    "decodeAudioBuffer",
    "exportAll",
    "exportAllDialog",
    "exportSlice",
    "exportSliceDialog",
    "onMenuAction",
    "onStateChanged",
    "openAudioDialog",
    "openWosDialog",
    "platform",
    "readAudioFile",
    "readBmseClipboard",
    "readWosFile",
    "saveWosDialog",
    "setLanguage",
    "writeBmseClipboard",
    "writeWosFile",
  ]);
  // No generic invoke / shell / fs escape hatches on the bridge.
  for (const key of PRELOADED_API_KEYS) {
    assert.ok(!/invoke|require|shell|eval|node/i.test(key), `suspicious bridge key: ${key}`);
  }
});

test("audio/wos path validators gate the file IPC channels", () => {
  assert.equal(hasAudioExtension("C:/music/KEY.wav"), true);
  assert.equal(hasAudioExtension("C:/music/KEY.OGG"), true);
  assert.equal(hasAudioExtension("C:/music/KEY.wos"), false);
  assert.equal(hasAudioExtension("C:/music/KEY.exe"), false);
  assert.equal(hasWosExtension("a/b/x.WOS"), true);
  assert.equal(hasWosExtension("a/b/x.wav"), false);
});

test("validateExportRequest rejects malformed payloads before any IO", () => {
  assert.throws(() => validateExportRequest(null));
  assert.throws(() => validateExportRequest("string"));
  assert.throws(() =>
    validateExportRequest({ filePath: "evil.exe", start: 0, end: 1, fadeoutMs: 0, noisegateDb: 0 })
  );
  assert.throws(() =>
    validateExportRequest({ filePath: "a.wav", start: 0.5, end: 1, fadeoutMs: 0, noisegateDb: 0 })
  );
  assert.throws(() =>
    validateExportRequest({ filePath: "a.wav", start: -1, end: 1, fadeoutMs: 0, noisegateDb: 0 })
  );
  assert.throws(() =>
    validateExportRequest({ filePath: "a.wav", start: 10, end: 5, fadeoutMs: 0, noisegateDb: 0 })
  );
  const ok = validateExportRequest({
    filePath: "a.wav",
    start: 0,
    end: 100,
    fadeoutMs: 0,
    noisegateDb: -48,
  });
  assert.equal(ok.end, 100);
});

test("WAV output paths: extension required, traversal and device paths rejected", () => {
  assert.equal(validateWavOutputPath("C:/out/slice_001.wav"), "C:/out/slice_001.wav");
  assert.throws(() => validateWavOutputPath("C:/out/slice.txt"), /\.wav/);
  assert.throws(() => validateWavOutputPath("C:/a/../evil.wav"), /forbidden/);
  assert.throws(() => validateWavOutputPath("..\\\\evil.wav"), /forbidden/);
  assert.throws(() => validateWavOutputPath("\\\\?\\C:\\x.wav"), /forbidden/);
  assert.throws(() => validateWavOutputPath("bad\u0000.wav"), /forbidden/);
  assert.throws(() => validateWavOutputPath(""), /non-empty/);
  assert.throws(() => validateWavOutputPath(42), /non-empty/);
});

test("WOS file paths: same traversal/extension rules", () => {
  assert.equal(validateWosFilePath("D:/projects/song.wos"), "D:/projects/song.wos");
  assert.throws(() => validateWosFilePath("a/b/../../x.wos"), /forbidden/);
  assert.throws(() => validateWosFilePath("a/b/x.wav"), /\.wos/);
});

test("export directory paths reject traversal and empties", () => {
  assert.equal(validateDirectoryPath("C:/out"), "C:/out");
  assert.throws(() => validateDirectoryPath("out/.."), /forbidden/);
  assert.throws(() => validateDirectoryPath(""), /non-empty/);
});

test("export noisegate stays a double (original Cut(double) semantics)", () => {
  const ok = validateExportRequest({
    filePath: "a.wav",
    start: 0,
    end: 10,
    fadeoutMs: 0,
    noisegateDb: -47.5,
  });
  assert.equal(ok.noisegateDb, -47.5);
  assert.throws(() =>
    validateExportRequest({ filePath: "a.wav", start: 0, end: 10, fadeoutMs: 0, noisegateDb: Number.NaN })
  );
  // fadeoutMs remains an integer field (original stores int32 ms).
  assert.throws(() =>
    validateExportRequest({ filePath: "a.wav", start: 0, end: 10, fadeoutMs: 1.5, noisegateDb: -48 })
  );
});
