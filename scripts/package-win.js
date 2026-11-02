/**
 * Builds a portable Windows release without electron-builder:
 *   1. copy the Electron runtime from node_modules/electron/dist
 *   2. rename electron.exe -> woslicer-electron.exe
 *   3. drop the compiled app + production node_modules into resources/app
 *   4. zip the folder
 *
 * Run after `npm run build`: `node scripts/package-win.js`
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const releaseRoot = path.join(root, "release");
const appDir = path.join(releaseRoot, "woslicer-electron-win32-x64");
const resourcesApp = path.join(appDir, "resources", "app");
const electronDist = path.join(root, "node_modules", "electron", "dist");

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function main() {
  if (!fs.existsSync(electronDist)) {
    throw new Error(`Electron runtime not found: ${electronDist} — run npm install first`);
  }
  fs.rmSync(releaseRoot, { recursive: true, force: true });
  copyDir(electronDist, appDir);

  const exeOld = path.join(appDir, "electron.exe");
  const exeNew = path.join(appDir, "woslicer-electron.exe");
  if (fs.existsSync(exeOld)) fs.renameSync(exeOld, exeNew);

  // App payload.
  fs.mkdirSync(resourcesApp, { recursive: true });
  copyDir(path.join(root, "dist", "src"), path.join(resourcesApp, "dist", "src"));
  copyDir(path.join(root, "dist", "renderer"), path.join(resourcesApp, "dist", "renderer"));
  fs.copyFileSync(path.join(root, "README.md"), path.join(resourcesApp, "README.md"));

  // Production runtime dependencies (WASM Vorbis decoder and its transitive deps).
  const runtimeDeps = [
    "@wasm-audio-decoders/ogg-vorbis",
    "@wasm-audio-decoders/common",
    "codec-parser",
    "simple-yenc",
  ];
  for (const dep of runtimeDeps) {
    const src = path.join(root, "node_modules", ...dep.split("/"));
    if (fs.existsSync(src)) copyDir(src, path.join(resourcesApp, "node_modules", ...dep.split("/")));
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const runtimePkg = {
    name: pkg.name,
    productName: pkg.productName,
    version: pkg.version,
    description: pkg.description,
    main: "dist/src/main/main.js",
    dependencies: pkg.dependencies,
  };
  fs.writeFileSync(path.join(resourcesApp, "package.json"), JSON.stringify(runtimePkg, null, 2));

  const zipPath = path.join(releaseRoot, `woslicer-electron-${pkg.version}-win32-x64.zip`);
  if (process.platform === "win32") {
    execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `Compress-Archive -Path '${appDir}' -DestinationPath '${zipPath}' -Force`],
      { stdio: "inherit" }
    );
  }
  console.log(`release folder: ${appDir}`);
  if (fs.existsSync(zipPath)) console.log(`release zip:    ${zipPath}`);
}

main();
