// Native window UI profiles against the built Tauri executable. The WebView2
// host is driven over CDP on a dynamic loopback port (same transport as
// tauri-ipc-probe), with one hard 30-second watchdog per profile and full
// process-tree cleanup. Profile semantics follow the web UI profiles where the
// real host allows:
//   low  : ~1280×720 css viewport at devicePixelRatio 1
//   high : 1920×1080 physical window at devicePixelRatio 2 (css viewport ≈ 960×540)
// Outer bounds are tuned per run (title bar and OS scaling shift the client
// area), so assertions check the reached css viewport and the DPR/canvas
// relationships instead of assuming exact outer bounds. Requires the selected
// build (npm run build:app:tauri + cargo build) and Windows WebView2.
// Run: node scripts/test-tauri-ui.mjs
import { createConnection, createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveBuildProfile } from './build-profile.mjs';

// low keeps the host's natural WebView scaling (devicePixelRatio follows the
// OS display scale, e.g. 1.5 on a 150% host) and pins the css viewport to
// 1280×720, mirroring the web low profile's css geometry. high forces
// devicePixelRatio 2 inside a 1920×1080 physical window, mirroring the web
// high profile's physical geometry. A DPR-1 window below 1440×900 physical is
// unreachable on a 150% host because the app's 960×600 logical minimum
// clamps it; that combination belongs to real-platform acceptance.
const PROFILES = [
  { name: 'low', cssWidth: 1280, cssHeight: 720, dpr: null },
  { name: 'high', physicalWidth: 1920, physicalHeight: 1080, dpr: 2 },
];
const HARD_TIMEOUT_MS = 30_000;
const VIEWPORT_TOLERANCE = 3;

// A plain `cargo build` debug exe bakes in the devUrl and shows the WebView2
// error page without a running dev server, so UI profiles default to release.
const argv = process.argv.slice(2);
const explicitProfile =
  argv.some((arg) => ['--debug', '-d', '--release'].includes(arg)) ||
  process.env.WOSLICER_BUILD_PROFILE !== undefined;
const selected = resolveBuildProfile(explicitProfile ? argv : [...argv, '--release']);
if (selected.args.length) throw new Error(`Unknown profile options: ${selected.args.join(' ')}`);
if (platform() !== 'win32') {
  console.log('tauri ui profiles: skipped on this platform (WebView2/CDP is Windows-only)');
  process.exit(0);
}
const targetDir = process.env.CARGO_TARGET_DIR ?? resolve('src-tauri/target');
const exe = resolve(targetDir, selected.profile, 'woslicer-dx.exe');
if (!existsSync(exe)) {
  console.error(
    `built executable not found: ${exe} — run npm run build:app:tauri && cargo build --manifest-path src-tauri/Cargo.toml first`,
  );
  process.exit(1);
}

const artifactsDir = resolve('test-artifacts/tauri-ui');
mkdirSync(artifactsDir, { recursive: true });

for (const profile of PROFILES) {
  console.log(`Running native UI profile: ${profile.name}`);
  const runDir = join(artifactsDir, profile.name);
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(runDir, { recursive: true });
  try {
    await runProfile(profile, exe, runDir);
  } catch (error) {
    console.error(`native UI profile ${profile.name} failed: ${error.message}`);
    process.exitCode = 1;
  }
}
if (process.exitCode) throw new Error('one or more native UI profiles failed');
console.log('native UI profiles: all passed');
// All artifacts are written synchronously; exit explicitly so a lingering
// child stream cannot keep the runner alive.
process.exit(process.exitCode ?? 0);

async function runProfile(profile, exe, runDir) {
  const port = await freePort();
  // App data (WebView2 user data, file grants, window state) is isolated per
  // run through the roaming/local appdata roots the app resolves under.
  const localRoot = join(runDir, 'appdata-local');
  const roamingRoot = join(runDir, 'appdata-roaming');
  mkdirSync(localRoot, { recursive: true });
  mkdirSync(roamingRoot, { recursive: true });
  const browserArgs =
    profile.dpr === null
      ? `--remote-debugging-port=${port}`
      : `--remote-debugging-port=${port} --force-device-scale-factor=${profile.dpr}`;
  const child = spawn(exe, [], {
    env: {
      ...process.env,
      LOCALAPPDATA: localRoot,
      APPDATA: roamingRoot,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: browserArgs,
    },
    stdio: 'ignore',
  });
  let client = null;
  let watchdog;
  try {
    const work = (async () => {
      client = await connectPage(port);
      await verifyProfile(profile, client, runDir);
    })();
    const timeout = new Promise((_, reject) => {
      watchdog = setTimeout(
        () => reject(new Error(`${profile.name} exceeded 30 seconds`)),
        HARD_TIMEOUT_MS,
      );
    });
    await Promise.race([work, timeout]);
  } finally {
    clearTimeout(watchdog);
    if (client) {
      // Close the WebView2 browser gracefully first: a hard kill leaves the
      // shared user data folder locked, and the next profile's environment
      // creation fails with ERROR_INVALID_STATE (0x8007139F).
      await Promise.race([client.send('Browser.close').catch(() => {}), delay(2_000)]);
      client.close();
    }
    // Give the browser process a moment to finish releasing its data folder.
    await delay(1_500);
    stopTree(child);
    dropHeavyProfileData(runDir);
  }
}

async function verifyProfile(profile, client, runDir) {
  const { result } = await client.send('Browser.getWindowForTarget');
  const windowId = result.windowId;
  // Tune the outer window until the client area reaches the profile's target
  // css viewport: start from the physical target, then rescale from the
  // measured viewport until it converges. Host screens smaller than the
  // physical target surface here as a clear failure.
  const targetW =
    profile.physicalWidth !== undefined ? profile.physicalWidth / profile.dpr : profile.cssWidth;
  const targetH =
    profile.physicalHeight !== undefined ? profile.physicalHeight / profile.dpr : profile.cssHeight;
  // First guess: css pixels map 1:1 to DIP under natural scaling, and the
  // physical target for forced-DPR profiles; both converge by rescaling.
  let boundsW = Math.round(profile.physicalWidth ?? targetW);
  let boundsH = Math.round(profile.physicalHeight ?? targetH);
  let metrics = null;
  let exceptions = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    await client.send('Browser.setWindowBounds', {
      windowId,
      bounds: { width: boundsW, height: boundsH },
    });
    await delay(400);
    const reply = await client.send('Runtime.evaluate', {
      expression: metricsExpression(),
      returnByValue: true,
    });
    if (reply.result.exceptionDetails)
      throw new Error(`page evaluate failed: ${reply.result.exceptionDetails.text}`);
    metrics = reply.result.result.value;
    exceptions = client.exceptions.count;
    const error = Math.max(Math.abs(metrics.innerW - targetW), Math.abs(metrics.innerH - targetH));
    if (error <= VIEWPORT_TOLERANCE) break;
    const wRatio = metrics.innerW > 0 ? targetW / metrics.innerW : 1;
    const hRatio = metrics.innerH > 0 ? targetH / metrics.innerH : 1;
    boundsW = Math.round(boundsW * wRatio);
    boundsH = Math.round(boundsH * hRatio);
  }
  // Capture evidence before asserting: a failed profile still leaves its
  // screenshot and raw metrics for diagnosis.
  const shot = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(runDir, 'screenshot.png'), Buffer.from(shot.result.data, 'base64'));
  writeFileSync(
    join(runDir, 'result.json'),
    JSON.stringify({ profile: profile.name, metrics }, null, 2),
  );
  if (!metrics || !metrics.ready) throw new Error('page never reached readyState complete');
  if (Math.abs(metrics.innerW - targetW) > VIEWPORT_TOLERANCE)
    throw new Error(
      `viewport width did not reach ${targetW}: got ${metrics.innerW} (host screen may be too small)`,
    );
  if (Math.abs(metrics.innerH - targetH) > VIEWPORT_TOLERANCE)
    throw new Error(
      `viewport height did not reach ${targetH}: got ${metrics.innerH} (host screen may be too small)`,
    );
  if (profile.dpr !== null && metrics.dpr !== profile.dpr)
    throw new Error(`devicePixelRatio is ${metrics.dpr}, expected ${profile.dpr}`);
  if (profile.dpr === null && (metrics.dpr < 1 || metrics.dpr > 3))
    throw new Error(`natural devicePixelRatio ${metrics.dpr} is implausible`);
  if (!metrics.menubar || !metrics.menubar.visible)
    throw new Error('application menu bar is not visible');
  if (metrics.canvases.length < 4)
    throw new Error(`expected at least 4 canvases, got ${metrics.canvases.length}`);
  const effectiveDpr = profile.dpr ?? metrics.dpr;
  for (const canvas of metrics.canvases)
    if (Math.abs(canvas.w - canvas.css * effectiveDpr) > 2)
      throw new Error(`canvas ${canvas.w} != css ${canvas.css} × ${profile.dpr}`);
  if (exceptions > 0) throw new Error(`${exceptions} uncaught page exception(s)`);

  console.log(
    `native UI profile ${profile.name}: viewport ${metrics.innerW}×${metrics.innerH} @DPR${metrics.dpr}, menu visible, ${metrics.canvases.length} canvases ok`,
  );
}

function metricsExpression() {
  return `(() => {
    const bar = document.querySelector('[role="menubar"]');
    let menubar = null;
    if (bar) {
      const rect = bar.getBoundingClientRect();
      const style = getComputedStyle(bar);
      menubar = {
        visible:
          rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
      };
    }
    return {
      dpr: window.devicePixelRatio,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      ready: document.readyState === 'complete',
      menubar,
      canvases: Array.from(document.querySelectorAll('canvas')).map((canvas) => ({
        w: canvas.width,
        css: canvas.clientWidth,
      })),
    };
  })()`;
}

/** Per-run WebView2 profile data is heavy temp state; dropping it is best-effort. */
function dropHeavyProfileData(runDir) {
  for (const name of ['appdata-local', 'appdata-roaming']) {
    try {
      rmSync(join(runDir, name), { recursive: true, force: true });
    } catch (error) {
      console.warn(`could not drop ${name}: ${error.message}`);
    }
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

function delay(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function connectPage(port) {
  const started = Date.now();
  let targets = null;
  let lastError = null;
  while (Date.now() - started < 20_000) {
    try {
      const reply = await fetch(`http://127.0.0.1:${port}/json/list`);
      targets = await reply.json();
      if (targets.some((target) => target.type === 'page')) break;
    } catch (error) {
      // WebView2 not listening yet; keep the last transport error for diagnosis.
      lastError = error;
    }
    await delay(250);
  }
  const page = targets?.find((target) => target.type === 'page');
  if (!page)
    throw new Error(
      `webview page target not found: ${lastError?.cause?.code ?? lastError?.message ?? 'no targets'}`,
    );
  const socket = await connectCdp(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const exceptions = { count: 0 };
  socket.onMessage((text) => {
    const message = JSON.parse(text);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else if (message.method === 'Runtime.exceptionThrown') exceptions.count += 1;
  });
  const send = (method, params) => {
    const id = nextId++;
    return new Promise((resolveReply, rejectReply) => {
      pending.set(id, (message) => {
        if (message.error) rejectReply(new Error(`${method} failed: ${message.error.message}`));
        else resolveReply(message);
      });
      socket.sendFrame(JSON.stringify({ id, method, params }));
    });
  };
  await send('Runtime.enable');
  await send('Page.enable');
  // Wait for the document to finish loading before measuring anything.
  for (let attempt = 0; attempt < 20; attempt++) {
    const reply = await send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    });
    if (reply.result?.result?.value === 'complete') break;
    await delay(250);
  }
  return {
    exceptions,
    send,
    close: () => socket.close(),
  };
}

function stopTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    // Verify the kill: a graceful Browser.close leaves the app shell alive and
    // taskkill can race a still-exiting process tree, so retry once.
    for (let attempt = 0; attempt < 2; attempt++) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 5_000,
      });
      const listing = spawnSync('tasklist', ['/FI', 'PID eq ' + child.pid], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5_000,
      });
      if (!(listing.stdout ?? '').includes('woslicer-dx')) return;
    }
    console.warn(`process tree for pid ${child.pid} survived two kill attempts`);
  } else {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

async function connectCdp(url) {
  const { hostname, port, pathname } = new URL(url);
  const socket = createConnection(Number(port), hostname);
  const key = randomBytes(16).toString('base64');
  socket.write(
    `GET ${pathname} HTTP/1.1\r\nHost: ${hostname}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    const ondata = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const marker = buffer.indexOf('\r\n\r\n');
        if (marker === -1) return;
        const head = buffer.slice(0, marker).toString();
        if (!head.includes(' 101 ')) {
          socket.destroy();
          return reject(new Error('upgrade failed'));
        }
        buffer = buffer.slice(marker + 4);
        upgraded = true;
        socket.off('data', ondata);
        resolve(attach(socket, buffer));
      }
    };
    socket.on('data', ondata);
    socket.on('error', reject);
  });
}

function attach(socket, initial) {
  let buffer = initial;
  const listeners = [];
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      if (buffer.length < 2) return;
      const opcode = buffer[0] & 0x0f;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (buffer.length < offset + length) return;
      const payload = buffer.slice(offset, offset + length);
      buffer = buffer.slice(offset + length);
      if (opcode === 1 || opcode === 2)
        for (const listener of listeners) listener(payload.toString('utf8'));
      else if (opcode === 8) socket.destroy();
    }
  });
  function sendFrame(text) {
    const payload = Buffer.from(text, 'utf8');
    const mask = randomBytes(4);
    const masked = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    let header;
    if (payload.length < 126) header = Buffer.from([0x81, 0x80 | payload.length]);
    else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    socket.write(Buffer.concat([header, mask, masked]));
  }
  return {
    sendFrame,
    onMessage: (listener) => listeners.push(listener),
    close: () => socket.destroy(),
  };
}
