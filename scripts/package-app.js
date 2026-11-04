// Native-platform portable packaging. Run after npm run build.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createHash } = require("crypto");
const root = path.resolve(__dirname, "..");
const releaseRoot = path.join(root, "release");
require("./check-version.js");
const pkg = require("../package.json");
const platform = process.platform;
if (!["win32", "linux", "darwin"].includes(platform)) throw new Error("Unsupported platform");
const name = `${pkg.name}-${platform}-${process.arch}`;
const output = path.join(releaseRoot, name);
function clean(target) {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(releaseRoot + path.sep) || fs.lstatSync(resolved, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error("Unsafe packaging cleanup: " + resolved);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}
const runtime = path.join(root, "node_modules", "electron", "dist");
if (!fs.existsSync(path.join(runtime, platform === "win32" ? "electron.exe" : platform === "darwin" ? "Electron.app" : "electron"))) {
  throw new Error("Install the native Electron runtime first: node node_modules/electron/install.js");
}
for (const required of [pkg.main, "dist/src/main/preload.bundle.js", "dist/renderer/index.html"]) {
  if (!fs.existsSync(path.join(root, required))) throw new Error("Missing build output: " + required);
}
const { readBuildInfo } = require("../dist/src/main/build-info.js");
if (readBuildInfo().version !== pkg.version) throw new Error("Build metadata version is stale; rebuild first");
clean(output);
fs.mkdirSync(output, { recursive: true });
fs.cpSync(runtime, output, { recursive: true, verbatimSymlinks: true });
if (fs.existsSync(path.join(output, "version"))) {
  fs.renameSync(path.join(output, "version"), path.join(output, "electron-version.txt"));
}
fs.writeFileSync(path.join(output, "app-version.txt"), pkg.version + "\n");
let resources;
if (platform === "darwin") {
  const bundle = path.join(output, `${pkg.productName}.app`);
  fs.renameSync(path.join(output, "Electron.app"), bundle);
  const plist = path.join(bundle, "Contents", "Info.plist");
  for (const [key, value] of Object.entries({ CFBundleDisplayName: pkg.productName, CFBundleName: pkg.productName,
    CFBundleIdentifier: "org.woslicer.desktop", CFBundleShortVersionString: pkg.version, CFBundleVersion: pkg.version })) {
    execFileSync("plutil", ["-replace", key, "-string", value, plist]);
  }
  resources = path.join(bundle, "Contents", "Resources");
} else {
  const extension = platform === "win32" ? ".exe" : "";
  fs.renameSync(path.join(output, "electron" + extension), path.join(output, pkg.name + extension));
  if (platform === "win32") {
    const ResEdit = require("resedit");
    const executablePath = path.join(output, pkg.name + extension);
    // This is the copied application executable, never the original runtime.
    // Editing resources removes the upstream signature; CI builds are unsigned.
    const executable = ResEdit.NtExecutable.from(fs.readFileSync(executablePath), { ignoreCert: true });
    const resources = ResEdit.NtExecutableResource.from(executable);
    const versions = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
    if (!versions.length) throw new Error("Electron executable has no version resource");
    for (const info of versions) {
      info.setFileVersion(pkg.version);
      info.setProductVersion(pkg.version);
      for (const language of info.getAllLanguagesForStringValues()) {
        info.setStringValues(language, {
          FileVersion: pkg.version, ProductVersion: pkg.version,
          FileDescription: pkg.description, ProductName: pkg.productName,
          OriginalFilename: pkg.name + extension, InternalName: pkg.name,
        });
      }
      info.outputToResourceEntries(resources.entries);
    }
    resources.outputResource(executable);
    fs.writeFileSync(executablePath, Buffer.from(executable.generate()));
  }
  resources = path.join(output, "resources");
}
fs.rmSync(path.join(resources, "default_app.asar"), { force: true });
const app = path.join(resources, "app");
fs.mkdirSync(app, { recursive: true });
for (const item of [
  "dist/src", "dist/renderer", "LICENSE", "NOTICE",
  "README.md", "README.zh-CN.md", "README.ja.md", "README.ko.md",
  "CHANGELOG.md", "CHANGELOG.zh-CN.md",
]) {
  fs.cpSync(path.join(root, item), path.join(app, item), { recursive: true });
}
// Resolve the installed production dependency closure, including nested dependencies.
const copied = new Set();
function copyDependency(name, from) {
  let parent = from, source;
  while (parent.startsWith(root)) {
    const candidate = path.join(parent, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) { source = candidate; break; }
    const next = path.dirname(parent); if (next === parent) break; parent = next;
  }
  if (!source) throw new Error("Missing production dependency: " + name);
  if (copied.has(source)) return;
  copied.add(source);
  fs.cpSync(source, path.join(app, path.relative(root, source)), { recursive: true });
  const metadata = JSON.parse(fs.readFileSync(path.join(source, "package.json")));
  for (const dependency of Object.keys(metadata.dependencies || {})) copyDependency(dependency, source);
}
for (const dependency of Object.keys(pkg.dependencies || {})) copyDependency(dependency, root);
fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: pkg.name, productName: pkg.productName,
  version: pkg.version, license: pkg.license, main: pkg.main, dependencies: pkg.dependencies }, null, 2));
if (platform === "darwin") {
  // Local ad-hoc signing only: no Developer ID, notarization, credentials or release publishing.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", path.join(output, `${pkg.productName}.app`)], { stdio: "inherit" });
}
const extension = platform === "win32" ? "7z" : platform === "linux" ? "tar.xz" : "zip";
const archive = path.join(releaseRoot, `${pkg.name}-${pkg.version}-${platform}-${process.arch}.${extension}`);
fs.rmSync(archive, { force: true });
if (platform === "win32") {
  const { path7za } = require("7zip-bin");
  execFileSync(path7za, ["a", "-t7z", "-mx=5", archive, name], { cwd: releaseRoot, stdio: "inherit" });
  execFileSync(path7za, ["t", archive], { stdio: "inherit" });
} else if (platform === "linux") {
  execFileSync("tar", ["-cJf", archive, "-C", releaseRoot, name], { stdio: "inherit" });
  execFileSync("tar", ["-tJf", archive], { stdio: "ignore" });
} else {
  execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", output, archive], { stdio: "inherit" });
  execFileSync("unzip", ["-t", archive], { stdio: "ignore" });
}
const digest = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
fs.writeFileSync(archive + ".sha256", `${digest}  ${path.basename(archive)}\n`);
console.log(`Packaged: ${archive}`);
