// Loopback static server for the Playwright suite: serves the built web
// payload from dist/web on 127.0.0.1 only (a secure context without TLS).
// Test-only infrastructure, never shipped.
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "dist", "web");
const port = Number(process.env.WEB_TEST_PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
  ".woff2": "font/woff2",
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) && file !== root) {
    res.writeHead(403).end("forbidden");
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

server.listen(port, "127.0.0.1", () => console.log(`serving dist/web on http://127.0.0.1:${port}`));
