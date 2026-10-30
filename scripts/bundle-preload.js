/**
 * Bundles the sandboxed preload script into a single file.
 *
 * Electron sandboxed preloads may only `require("electron")` and node
 * builtins — relative imports fail at runtime. The preload's only relative
 * dependency is channels.js, so we inline it as an IIFE and rewrite the
 * require. Output: dist/src/main/preload.bundle.js
 */
const fs = require("fs");
const path = require("path");

const mainDir = path.join(__dirname, "..", "dist", "src", "main");
const channelsSrc = fs.readFileSync(path.join(mainDir, "channels.js"), "utf8");
let preloadSrc = fs.readFileSync(path.join(mainDir, "preload.js"), "utf8");

const requirePattern = /require\("\.\/channels(\.js)?"\)/g;
if (!requirePattern.test(preloadSrc)) {
  throw new Error('bundle-preload: expected require("./channels") in preload.js');
}
preloadSrc = preloadSrc.replace(requirePattern, "__channels");

const inlined = [
  "var __channels = (function () {",
  "var module = { exports: {} };",
  "var exports = module.exports;",
  channelsSrc,
  "return module.exports;",
  "})();",
].join("\n");

const out = preloadSrc.replace(/"use strict";/, '"use strict";\n' + inlined);
fs.writeFileSync(path.join(mainDir, "preload.bundle.js"), out);
console.log("bundled preload -> dist/src/main/preload.bundle.js");
