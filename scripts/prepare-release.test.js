const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { prepareRelease } = require("./prepare-release.js");

function fixture(t, { missing = [], tamper = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "woslicer-release-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const pkg = require("../package.json");
  const version = pkg.version;
  const prefix = pkg.name + "-" + version;
  const assets = [
    [prefix + "-windows-x64.7z", "Windows x64"],
    [prefix + "-linux-x64.tar.xz", "Linux x64"],
    [prefix + "-maps.tar.xz", "Debug source maps"],
  ];
  for (const [name] of assets) {
    if (missing.includes(name)) continue;
    const bytes = Buffer.from("fixture:" + name);
    fs.writeFileSync(path.join(directory, name), bytes);
    const hash = crypto.createHash("sha256").update(tamper && name === assets[0][0] ? "wrong" : bytes).digest("hex");
    fs.writeFileSync(path.join(directory, name + ".sha256"), hash + "  " + name + String.fromCharCode(10));
  }
  return { directory, notes: path.join(directory, "notes.md"), version, assets };
}

test("prepares versioned notes and verifies available optional assets", t => {
  const data = fixture(t);
  const result = prepareRelease({ tag: "v" + data.version, artifactDir: data.directory, notesPath: data.notes });
  assert.equal(result.available.length, 3);
  assert.deepEqual(result.unavailable, ["Windows ARM64", "Linux ARM64", "macOS Intel", "macOS ARM64"]);
  const notes = fs.readFileSync(data.notes, "utf8");
  assert.match(notes, /## Downloads/);
  assert.match(notes, /Linux x64/);
  assert.match(notes, /Optional platform builds not included/);
});

test("rejects a tag that differs from the package version", t => {
  const data = fixture(t);
  assert.throws(() => prepareRelease({ tag: "v99.0.0", artifactDir: data.directory, notesPath: data.notes }), /does not match/);
});

test("requires the Windows x64 archive and checksum", t => {
  const { name, version } = require("../package.json");
  const data = fixture(t, { missing: [name + "-" + version + "-windows-x64.7z"] });
  assert.throws(() => prepareRelease({ tag: "v" + data.version, artifactDir: data.directory, notesPath: data.notes }), /Required release asset/);
});

test("requires the debug source map archive", t => {
  const { name, version } = require("../package.json");
  const data = fixture(t, { missing: [name + "-" + version + "-maps.tar.xz"] });
  assert.throws(() => prepareRelease({ tag: "v" + data.version, artifactDir: data.directory, notesPath: data.notes }), /Required release asset/);
});

test("rejects a mismatched archive checksum", t => {
  const data = fixture(t, { tamper: true });
  assert.throws(() => prepareRelease({ tag: "v" + data.version, artifactDir: data.directory, notesPath: data.notes }), /SHA-256 mismatch/);
});
