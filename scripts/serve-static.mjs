#!/usr/bin/env node
/**
 * Tiny stdlib-only static server for local previews and UI tests.
 *
 * Serves one directory over loopback http (127.0.0.1 is a secure context, so
 * clipboard and WebAssembly work without TLS) and opens the default browser.
 *
 * Usage: node scripts/serve-static.mjs [rootDir] [--port N] [--no-open]
 *   rootDir    defaults to the directory containing this script
 *   --port N   first port to try (default 8347; the next nine are fallbacks)
 *   --no-open  do not launch the browser (CI / tests)
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const selfDir = dirname(fileURLToPath(import.meta.url));
let root = selfDir;
let basePort = 8347;
let openBrowser = true;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port") basePort = Number(args[++i]);
  else if (args[i] === "--no-open") openBrowser = false;
  else root = resolve(args[i]);
}
if (!existsSync(join(root, "index.html"))) {
  console.error(`serve-static.mjs: no index.html in ${root}`);
  console.error("pass a directory that contains index.html");
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const file = resolve(root, rel);
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});

/** Opens the default browser at the URL; best effort only. */
function openBrowserAt(url) {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const openArgs = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(command, openArgs, { detached: true, stdio: "ignore" }).unref();
  } catch {
    // the URL is printed regardless
  }
}

/** Binds the port or rejects; listeners are paired so retries stay clean. */
function listenOn(port) {
  return new Promise((done, failed) => {
    const onListening = () => {
      server.removeListener("error", onError);
      done();
    };
    const onError = (error) => {
      server.removeListener("listening", onListening);
      failed(error);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

let bound = false;
for (let port = basePort; port < basePort + 10 && !bound; port++) {
  try {
    await listenOn(port);
    bound = true;
    const url = `http://127.0.0.1:${port}/`;
    console.log(`woslicer-dx web: ${url}`);
    console.log("Ctrl+C stops the local server.");
    if (openBrowser) openBrowserAt(url);
  } catch {
    // port busy: try the next one
  }
}
if (!bound) {
  console.error(`server.mjs: every port from ${basePort} to ${basePort + 9} is busy`);
  process.exit(1);
}
