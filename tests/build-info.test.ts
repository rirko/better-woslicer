import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBuildInfo, formatBuildDetails, readBuildInfo, type BuildInfo } from "../src/main/build-info.js";
import { LANGUAGES } from "../src/core/language.js";

const sample: BuildInfo = {
  version: "2.3.4", commit: "a".repeat(40), dirty: false, builtAt: "2026-11-04T12:34:56.000Z",
};

test("About retains the full commit and fixed UTC build date in every language", () => {
  for (const language of LANGUAGES) {
    const clean = formatBuildDetails(sample, language);
    assert.ok(clean.includes(sample.commit));
    assert.ok(clean.includes(sample.builtAt));
    assert.notEqual(formatBuildDetails({ ...sample, dirty: true }, language), clean);
  }
});

test("build metadata rejects missing and malformed fields instead of displaying invented values", () => {
  assert.deepEqual(parseBuildInfo(sample), sample);
  for (const invalid of [null, {}, { ...sample, commit: "unknown" },
    { ...sample, builtAt: "not-a-date" }, { ...sample, dirty: "false" }]) {
    assert.throws(() => parseBuildInfo(invalid));
  }
});

test("compiled application includes usable build metadata", () => {
  const info = readBuildInfo();
  assert.match(info.commit, /^[a-f0-9]{40,64}$/);
  assert.equal(new Date(info.builtAt).toISOString(), info.builtAt);
});
