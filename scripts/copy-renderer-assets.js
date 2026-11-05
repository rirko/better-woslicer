// Copies static renderer assets (html/css) next to the compiled output.
// The page title placeholder is filled from package.json so the product name
// keeps a single source of truth. Shared by the dev build and the esbuild
// packaging payload (scripts/bundle-app.js).
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const srcDir = path.join(root, "src", "renderer");

/** Copies index.html and styles.css into outDir, filling {{APP_NAME}}. */
function copyRendererAssets(outDir) {
  const pkg = require("../package.json");
  const appName = pkg.productName || pkg.name;
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of ["index.html", "styles.css"]) {
    let content = fs.readFileSync(path.join(srcDir, name), "utf8");
    content = content.split("{{APP_NAME}}").join(appName);
    fs.writeFileSync(path.join(outDir, name), content);
  }
}

module.exports = { copyRendererAssets };

if (require.main === module) {
  copyRendererAssets(path.join(root, "dist", "renderer"));
  console.log("copied index.html, styles.css -> dist/renderer");
}
