// Copies static renderer assets (html/css) next to the compiled ESM output.
const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "..", "src", "renderer");
const outDir = path.join(__dirname, "..", "dist", "renderer");

for (const name of ["index.html", "styles.css"]) {
  fs.copyFileSync(path.join(srcDir, name), path.join(outDir, name));
  console.log("copied", name);
}
