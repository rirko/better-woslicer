// Application version source: root package.json. Other copies are derived/checked.
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const pkg = require("../package.json");
const lock = require("../package-lock.json");
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error("Release version must be major.minor.patch");
if (pkg.version.split(".").some(part => Number(part) > 65535)) throw new Error("Version exceeds Windows resource limits");
for (const version of [lock.version, lock.packages?.[""]?.version]) {
  if (version !== pkg.version) throw new Error("Lockfile version differs from package.json; run npm version <version> --no-git-tag-version --ignore-scripts");
}
for (const file of ["CHANGELOG.md", "CHANGELOG.zh-CN.md"]) {
  const contents = fs.readFileSync(path.join(root, file), "utf8");
  const latest = contents.match(/^## (\d+\.\d+\.\d+) — \d{4}-\d{2}-\d{2}$/m)?.[1];
  if (latest !== pkg.version) throw new Error(file + " must document the current package.json version first");
}
console.log("Application version consistent: " + pkg.version);
