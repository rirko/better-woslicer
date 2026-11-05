/**
 * Bundles the sandboxed preload script into a single file.
 *
 * Electron sandboxed preloads may only `require("electron")` and node
 * builtins — relative imports fail at runtime. esbuild inlines the preload's
 * only relative dependency (channels.ts) so the output is one self-contained
 * CommonJS file. Dev builds (build:main) write it unminified next to the tsc
 * output; the packaging build reuses buildPreloadBundle() with minification
 * (see scripts/bundle-app.js).
 */
const path = require("path");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");

/** Builds the single-file preload bundle. Returns esbuild's output files. */
function buildPreloadBundle(outfile, { minify = false, sourcemap = false } = {}) {
  return esbuild.buildSync({
    entryPoints: [path.join(root, "src", "main", "preload.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "es2022",
    minify,
    sourcemap,
    external: ["electron"],
    logLevel: "warning",
  });
}

module.exports = { buildPreloadBundle };

if (require.main === module) {
  const outfile = path.join(root, "dist", "src", "main", "preload.bundle.js");
  buildPreloadBundle(outfile);
  console.log("bundled preload -> " + path.relative(root, outfile));
}
