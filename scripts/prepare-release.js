const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/** Expected release assets; archive names derive from the package name. */
function expectedAssets(version, name) {
  const prefix = name + "-" + version;
  return [
    { platform: "Windows x64", required: true, name: prefix + "-win32-x64.7z" },
    { platform: "Linux x64", required: false, name: prefix + "-linux-x64.tar.xz" },
    { platform: "Windows ARM64", required: false, name: prefix + "-win32-arm64.7z" },
    { platform: "Linux ARM64", required: false, name: prefix + "-linux-arm64.tar.xz" },
    { platform: "macOS Intel", required: false, name: prefix + "-darwin-x64.zip" },
    { platform: "macOS ARM64", required: false, name: prefix + "-darwin-arm64.zip" },
    // Debug source maps for the minified payload; produced once per commit by
    // the bundle job and attached alongside the platform archives.
    { platform: "Debug source maps", required: true, name: prefix + "-maps.tar.xz" },
  ];
}

function extractChangelog(changelog, version) {
  const escapedVersion = version.split(".").join("\\.");
  const heading = new RegExp("^## " + escapedVersion + " — \\d{4}-\\d{2}-\\d{2}\\s*$", "m");
  const match = heading.exec(changelog);
  if (!match) throw new Error("CHANGELOG.md has no dated section for " + version);
  const start = match.index + match[0].length;
  const rest = changelog.slice(start);
  const next = /^## /m.exec(rest);
  const body = (next ? rest.slice(0, next.index) : rest).trim();
  if (!body) throw new Error("CHANGELOG section is empty for " + version);
  return body;
}

function prepareRelease({ tag, artifactDir, notesPath, packagePath, changelogPath }) {
  if (typeof tag !== "string" || !/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error("Release tag must use vMAJOR.MINOR.PATCH");
  }
  const root = path.resolve(__dirname, "..");
  const pkg = JSON.parse(fs.readFileSync(packagePath || path.join(root, "package.json"), "utf8"));
  if (tag !== "v" + pkg.version) throw new Error("Release tag " + tag + " does not match package.json version " + pkg.version);
  const changelog = fs.readFileSync(changelogPath || path.join(root, "CHANGELOG.md"), "utf8");
  const releaseNotes = extractChangelog(changelog, pkg.version);
  const directory = path.resolve(artifactDir);
  if (!fs.statSync(directory).isDirectory()) throw new Error("Artifact path is not a directory");
  const expected = expectedAssets(pkg.version, pkg.name);
  const allowed = new Set(expected.flatMap(asset => [asset.name, asset.name + ".sha256"]));
  const entries = fs.readdirSync(directory);
  const unexpected = entries.filter(name => !allowed.has(name));
  if (unexpected.length) throw new Error("Unexpected release artifact(s): " + unexpected.join(", "));
  const available = [];
  const unavailable = [];
  for (const asset of expected) {
    const archive = path.join(directory, asset.name);
    const checksum = archive + ".sha256";
    const hasArchive = fs.existsSync(archive);
    const hasChecksum = fs.existsSync(checksum);
    if (!hasArchive && !hasChecksum) {
      if (asset.required) throw new Error("Required release asset is missing: " + asset.name);
      unavailable.push(asset.platform);
      continue;
    }
    if (!hasArchive || !hasChecksum) throw new Error("Release asset or checksum is missing: " + asset.name);
    if (!fs.statSync(archive).isFile() || !fs.statSync(checksum).isFile()) throw new Error("Release assets must be regular files: " + asset.name);
    const checksumMatch = fs.readFileSync(checksum, "utf8").trimEnd().match(/^([a-f0-9]{64})  (.+)$/);
    if (!checksumMatch || checksumMatch[2] !== asset.name) throw new Error("Malformed checksum file: " + path.basename(checksum));
    const actual = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
    if (actual !== checksumMatch[1]) throw new Error("SHA-256 mismatch: " + asset.name);
    available.push(asset);
  }
  const tick = String.fromCharCode(96);
  const notes = ["# " + pkg.name + " " + pkg.version, releaseNotes, "## Downloads"];
  for (const asset of available) notes.push("- " + asset.platform + ": " + tick + asset.name + tick);
  if (unavailable.length) {
    notes.push("## Optional platform builds not included");
    for (const platform of unavailable) notes.push("- " + platform + " was unavailable in this run.");
  } else {
    notes.push("All optional platform builds are included.");
  }
  fs.writeFileSync(notesPath, notes.join(String.fromCharCode(10, 10)) + String.fromCharCode(10));
  return { version: pkg.version, available: available.map(asset => asset.name), unavailable };
}

if (require.main === module) {
  const [tag, artifactDir, notesPath] = process.argv.slice(2);
  if (!tag || !artifactDir || !notesPath) {
    console.error("Usage: node scripts/prepare-release.js <tag> <artifact-dir> <notes-path>");
    process.exitCode = 2;
  } else {
    try {
      const result = prepareRelease({ tag, artifactDir, notesPath });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error("Release preparation failed: " + error.message);
      process.exitCode = 1;
    }
  }
}

module.exports = { expectedAssets, extractChangelog, prepareRelease };
