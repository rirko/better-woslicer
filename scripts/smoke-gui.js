/**
 * GUI smoke test: launches Electron with remote debugging, drives the real
 * renderer over CDP (Node 24 built-in WebSocket), and verifies:
 *  - the app boots with the empty state,
 *  - loading a WAV buffer via the IPC bridge transitions to "Ready",
 *  - marker editing (Z), undo, BMSE clipboard out and WOS round-trip work,
 *  - break-point snapping: Enter honours Snap/Grid, Alt bypasses it,
 *  - playback follow-scroll repaints the paged view (scrollbar thumb moves),
 *  - viewport widening (CDP device-metrics override) resizes and repaints
 *    every canvas layer across the full new width,
 *  - waveform canvases have non-trivial content.
 *
 * Run: npm run build && node scripts/smoke-gui.js
 */

const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { PRELOADED_API_KEYS } = require("../dist/src/main/channels.js");

const { createSession, removeSession, stopChild } = require("./ui-process.js");
let debugPort;
const profileName = process.env.SMOKE_PROFILE || "low";
const profiles = {
  low: { width: 1280, height: 720, deviceScaleFactor: 1 },
  high: { width: 1920, height: 1080, deviceScaleFactor: 2 },
};
if (!profiles[profileName]) throw new Error("Unknown SMOKE_PROFILE: " + profileName);
const profile = profiles[profileName];
const artifactDir = path.resolve("test-artifacts", (process.env.SMOKE_PACKAGED === "1" ? "packaged-" : "") + profileName);
fs.mkdirSync(artifactDir, { recursive: true });
const ownSession = !process.env.SMOKE_RUN_DIR;
const session = process.env.SMOKE_RUN_DIR || createSession(profileName);
const userData = path.join(session, "user-data");
const fixturePath = path.join(session, "roundtrip.wos");
fs.mkdirSync(userData, { recursive: true });

function httpJson(urlPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port: debugPort, path: urlPath }, res => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
      });
      res.on("error", reject);
    });
    request.setTimeout(1000, () => request.destroy(new Error("DevTools HTTP timeout")));
    request.on("error", reject);
  });
}

async function waitMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // Requiring electron from Node yields the path to the electron binary.
  const electronBinary = process.env.SMOKE_APP || require("electron");
  if (typeof electronBinary !== "string") {
    throw new Error("electron did not resolve to a binary path");
  }
  const child = spawn(electronBinary, [
    ...(process.env.SMOKE_APP ? [] : ["."]),
    `--force-device-scale-factor=${profile.deviceScaleFactor}`,
    `--user-data-dir=${userData}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    // The smoke window can open behind other windows; without these flags
    // Chromium throttles/parks requestAnimationFrame for occluded windows and
    // the animation-dependent checks (follow-scroll, viewport self-check)
    // fail nondeterministically even though the app is fine.
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ], {
    cwd: path.join(__dirname, ".."),
    detached: process.platform !== "win32",
    env: { ...process.env, WOSLICER_SMOKE_USER_DATA: userData, WOSLICER_SMOKE_PROFILE: profileName },
    stdio: ["ignore", "ignore", "pipe"],
  });
  process.send?.({ type: "electron-started", pid: child.pid });
  let launchError;
  child.on("error", error => { launchError = error; });
  let cleanupPromise;
  const cleanup = () => cleanupPromise ||= (async () => {
    clearTimeout(watchdog);
    ws?.close();
    await stopChild(child);
    process.send?.({ type: "electron-stopped" });
    fs.writeFileSync(path.join(artifactDir, "electron-stderr.log"), stderr);
    if (ownSession) removeSession(session);
  })();
  // The parent also enforces this budget and owns cleanup if this harness hangs.
  const watchdog = setTimeout(() => {
    console.error("SMOKE TIMEOUT: " + profileName + " exceeded 30000 ms");
    cleanup().finally(() => process.exit(1));
  }, 30000);
  let stderr = "";
  let send;
  let ws;
  const saveScreenshot = async () => {
    if (!send) return;
    const shot = await Promise.race([
      send("Page.captureScreenshot", { format: "png" }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Screenshot timeout")), 1000)),
    ]);
    fs.writeFileSync(path.join(artifactDir, "failure.png"), Buffer.from(shot.data, "base64"));
  };
  child.stderr.on("data", chunk => {
    stderr += chunk;
    // Port 0 is allocated atomically by Chromium; only trust this child's stderr.
    const match = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
    if (match) debugPort = Number(match[1]);
  });

  try {
    let targets = null;
    for (let i = 0; i < 40; i++) {
      await waitMs(500);
      if (launchError) throw launchError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error("Electron exited before exposing DevTools");
      if (!debugPort) continue;
      try {
        targets = await httpJson("/json/list");
        if (targets.some((t) => t.type === "page" && t.url.includes("index.html"))) break;
      } catch {
        // not up yet
      }
    }
    const page = targets?.find(t => t.type === "page" && t.url.includes("index.html"));
    if (!page) throw new Error("app did not expose a debugging target");
    console.log("SESSION:", JSON.stringify({ profile: profileName, pid: child.pid, userData, debugPort }));
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });

    let seq = 0;
    const pending = new Map();
    const pageExceptions = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === "Runtime.exceptionThrown") {
        const details = msg.params && msg.params.exceptionDetails;
        const text =
          (details && details.exception && details.exception.description) ||
          (details && details.text) ||
          "unknown exception";
        pageExceptions.push(text.split("\n").slice(0, 3).join(" | "));
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });

    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error("page exception: " + JSON.stringify(result.exceptionDetails));
      }
      return result.result.value;
    };

    await send("Runtime.enable");
    const nativeDisplay = await evaluate(`({width: innerWidth, height: innerHeight, dpr: devicePixelRatio})`);
    const nativeWindow = JSON.parse(fs.readFileSync(path.join(userData, "native-window.json"), "utf8"));
    fs.writeFileSync(path.join(artifactDir, "native-window.json"), JSON.stringify({ ...nativeWindow, renderer: nativeDisplay, debugPort }, null, 2));
    // Viewport emulation is separate from the launch-time native UI scale.
    await send("Emulation.setDeviceMetricsOverride", { ...profile, mobile: false });
    console.log("DISPLAY PROFILE:", profileName, JSON.stringify(profile));
    await waitMs(1500);

    const checks = [];
    const check = (name, ok, extra = "") => {
      checks.push({ name, ok });
      console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
    };

    check("native window uses the requested scale before viewport emulation",
      Math.abs(nativeDisplay.dpr - profile.deviceScaleFactor) <= 1e-6 &&
      Math.abs(nativeWindow.scaleFactor - profile.deviceScaleFactor) <= 1e-6 && nativeWindow.menuVisible,
      JSON.stringify({ rendererDpr: nativeDisplay.dpr, ...nativeWindow }));
    check("browser profile is isolated and starts without saved preferences",
      nativeWindow.userData === userData && await evaluate("localStorage.length === 0"));
    const actualDisplay = await evaluate(`({width: innerWidth, height: innerHeight, dpr: devicePixelRatio})`);
    check("requested display profile is active",
      actualDisplay.width === profile.width && actualDisplay.height === profile.height &&
        Math.abs(actualDisplay.dpr - profile.deviceScaleFactor) <= 1e-6,
      JSON.stringify(actualDisplay));
    check("empty state status", await evaluate(`document.getElementById('status-main').textContent.includes('Empty')`));
    check("preload bridge present", await evaluate(`typeof window.woslicer === 'object' && window.woslicer !== null`));
    const bridgeKeys = await evaluate(`Object.keys(window.woslicer).sort()`);
    check(
      "bridge keys match the documented allowlist",
      JSON.stringify(bridgeKeys) === JSON.stringify([...PRELOADED_API_KEYS].sort()),
      bridgeKeys.join(',')
    );

    // Build a small deterministic WAV (3s, 440Hz) in the page and load it via
    // a real drag-and-drop event (the same path a user file drop takes).
    // 3s so the follow-scroll page check later has room to page at the
    // default zoom (~1.9s of clip reaches the page point).
    await evaluate(`(async () => {
      const sr = 48000, n = 144000;
      const buf = new ArrayBuffer(44 + n * 4);
      const v = new DataView(buf);
      const ascii = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      ascii(0,'RIFF'); v.setUint32(4, 36 + n*4, true); ascii(8,'WAVE'); ascii(12,'fmt ');
      v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,2,true);
      v.setUint32(24,sr,true); v.setUint32(28,sr*4,true); v.setUint16(32,4,true); v.setUint16(34,16,true);
      ascii(36,'data'); v.setUint32(40, n*4, true);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        // 60 ms loud bursts every 0.5 s: gives the band detector real
        // loudness rises (~17 dB) to find, while keeping the waveform solid.
        const burst = t % 0.5 < 0.06;
        const amp = burst ? 0.85 : 0.12;
        const s = Math.round(Math.sin(2*Math.PI*440*t) * amp * 32767);
        v.setInt16(44+i*4, s, true); v.setInt16(46+i*4, Math.round(s*0.8), true);
      }
      const file = new File([buf], 'smoke.wav', { type: 'audio/wav' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const event = new DragEvent('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: dt });
      window.dispatchEvent(event);
      return true;
    })()`);
    // Drop loading is async; poll for the Ready status.
    let readySeen = false;
    for (let i = 0; i < 20; i++) {
      await waitMs(250);
      if (await evaluate(`document.getElementById('status-main').textContent.includes('Ready')`)) {
        readySeen = true;
        break;
      }
    }
    check("audio load (drag & drop) transitions to Ready", readySeen);
    check("source info filled", await evaluate(`document.getElementById('src-name').textContent === 'smoke'`));
    // Export prefix follows the source name (used by every export path via
    // store.baseName); it must no longer be the old "slice" default.
    check(
      "export prefix defaults to the source name, not 'slice'",
      await evaluate(`document.getElementById('input-basename').value === 'smoke'`)
    );

    // Place markers via the editing model (same path the Z key uses).
    await evaluate(`(function(){
      const canvas = document.getElementById('wave-canvas');
      canvas.parentElement.focus();
      return true;
    })()`);
    // Place cuts one measure apart using the UI density (cells per measure).
    // This also catches treating density as a raw tick step again.
    await evaluate(`(function(){
      function key(k){ document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); }
      const cellsPerMeasure = Number(document.getElementById('select-grid').value);
      if (!Number.isInteger(cellsPerMeasure) || cellsPerMeasure <= 0) throw new Error('Invalid grid density');
      key('z');
      for (let i = 0; i < cellsPerMeasure; i++) { key('ArrowRight'); }
      key('z');
      for (let i = 0; i < cellsPerMeasure; i++) { key('ArrowRight'); }
      key('z');
      return true;
    })()`);
    const cutCount = await evaluate(`document.querySelectorAll('#cut-list li').length`);
    const cutTimes = await evaluate(`Array.from(document.querySelectorAll('#cut-list .cut-time'), el => el.textContent)`);
    check("Z key places markers one measure apart at 120 BPM",
      cutCount === 3 && JSON.stringify(cutTimes) === JSON.stringify(["0.000s", "2.000s", "4.000s"]),
      JSON.stringify(cutTimes));

    // Undo the third marker with real Ctrl+Z (plain z would toggle it back).
    await evaluate(`(function(){ window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); return true; })()`);
    check("undo via Ctrl+Z", await evaluate(`document.querySelectorAll('#cut-list li').length === 2`));

    // --- Selection copy/paste (Ctrl+C -> cursor move -> Ctrl+V) -----------
    // Placing the markers above paged the view (the cursor follows the keys);
    // clamp the cursor back to tick 0 so the drag below starts from a known
    // scroll position instead of depending on how far the view had paged.
    await evaluate(`(function(){
      const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      key('ArrowUp');
      key('ArrowUp');
      return true;
    })()`);
    // Zoom out so all three markers fit on screen, then box-select them with
    // synthetic mouse events, copy, move the cursor and paste.
    await evaluate(`(function(){
      const kd = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      kd('-'); kd('-'); kd('-'); kd('-'); // zoom out x2.44
      return true;
    })()`);
    // Scroll right first so the tick-0 marker is out of the drag hit zone.
    await evaluate(`(function(){
      const wrap = document.getElementById('wave-wrap');
      wrap.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 }));
      const rect = wrap.getBoundingClientRect();
      const y = rect.top + rect.height / 2;
      const opts = (x) => ({ bubbles: true, clientX: Math.round(rect.left + x), clientY: y, button: 0, shiftKey: true });
      wrap.dispatchEvent(new MouseEvent('mousedown', opts(100)));
      window.dispatchEvent(new MouseEvent('mousemove', opts(900)));
      window.dispatchEvent(new MouseEvent('mouseup', opts(900)));
      return true;
    })()`);
    const selected = await evaluate(`document.getElementById('status-main').textContent`);
    // After undo, markers 0 and 192 remain. The scrolled box encloses 192.
    check("box select finds the marker in range", /1 marker\(s\) selected/.test(selected), selected);
    await evaluate(`(function(){
      const kd = (key, ctrl) => window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: !!ctrl, bubbles: true }));
      // The drag above started from the tick-0 clamp, so step the cursor back to
      // the post-undo position (384) the paste below expects.
      kd('ArrowDown');
      kd('ArrowDown');
      kd('c', true);        // Ctrl+C: copy selection as relative group
      kd('ArrowDown');      // cursor 384 -> 576
      kd('v', true);        // Ctrl+V: paste the selected marker at tick 576
      return true;
    })()`);
    const afterPaste = await evaluate(`document.querySelectorAll('#cut-list li').length`);
    check("selection paste adds the copied marker (2+1=3)", afterPaste === 3, `count=${afterPaste}`);

    const bmseOut = await evaluate(`(async () => {
      const text = 'BMSE ClipBoard Object Data Format\\r\\n1010000000011\\r\\n\\0';
      // write then read back through the real system clipboard bridge
      await window.woslicer.writeBmseClipboard(text);
      return (await window.woslicer.readBmseClipboard()).startsWith('BMSE ClipBoard Object Data Format');
    })()`);
    check("BMSE clipboard bridge round-trip", bmseOut === true);

    // WOS save + read-back through the file bridge.
    const wosRoundTrip = await evaluate(`(async () => {
      const bytes = new Uint8Array(6168);
      const v = new DataView(bytes.buffer);
      v.setFloat64(0, 185, true); v.setFloat64(8, -1, true);
      v.setInt32(16, 0, true); v.setInt32(20, -48, true);
      bytes[24] = 0x80;
      await window.woslicer.writeWosFile('${fixturePath.replace(/\\/g, "\\\\")}', bytes);
      const back = await window.woslicer.readWosFile('${fixturePath.replace(/\\/g, "\\\\")}');
      return back.byteLength === 6168 && back[24] === 0x80;
    })()`);
    check("WOS file bridge round-trip", wosRoundTrip === true);

    // Waveform canvas actually painted (not a blank rect).
    const painted = await evaluate(`(function(){
      const c = document.getElementById('wave-canvas');
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, Math.min(c.height, 400)).data;
      let non = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) non++;
      return non;
    })()`);
    check("waveform canvas painted", painted > 1000, `opaque pixels=${painted}`);

    // The overview must use the same tick axis as the main timeline: this 3 s
    // file spans <1% of the 256-measure timeline at 120 BPM, so its far right
    // must be background (the old audio-percentage overview stretched the file
    // across the whole strip and desynced from the viewport rectangle).
    const overviewTailWavePixels = await evaluate(`(function(){
      const c = document.getElementById('overview-canvas');
      const ctx = c.getContext('2d');
      const x0 = Math.floor(c.width * 0.85);
      const d = ctx.getImageData(x0, 0, c.width - x0, c.height).data;
      let wave = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        if (g > 80 && g > r + 20 && g > b - 20) wave++;
      }
      return wave;
    })()`);
    check(
      "overview uses the tick axis (no stretched file on the right)",
      overviewTailWavePixels === 0,
      `wave pixels=${overviewTailWavePixels}`
    );

    // --- Transport keys: Space play/pause, Enter break point, [ ] rate -----
    // (Enter is NO LONGER preview: the earlier steps never pressed Space or
    // Enter, so the rebinding does not affect anything above this point.)
    const kd = (key, ctrl = false, shift = false, alt = false) =>
      evaluate(
        `(function(){ window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, ctrlKey: ${!!ctrl}, shiftKey: ${!!shift}, altKey: ${!!alt}, bubbles: true })); return true; })()`
      );
    const cutCountNow = () => evaluate(`document.querySelectorAll('#cut-list li').length`);
    const statusNow = () => evaluate(`document.getElementById('status-main').textContent`);

    const beforeTransport = await cutCountNow();
    await kd(" ");
    check("Space starts playback", (await statusNow()) === "Playing");
    // Let the playhead advance into fresh territory (tick 0 already has a
    // marker; ~300ms at 120bpm lands around tick 29, away from 0/192/384).
    await waitMs(300);
    await kd("Enter");
    check(
      "Enter during playback drops a break point at the playhead (+1 cut)",
      (await cutCountNow()) === beforeTransport + 1,
      `count=${await cutCountNow()}`
    );
    check(
      "Enter left the transport playing (status = break point, not Paused)",
      /Break point at tick/.test(await statusNow())
    );
    await kd(" ");
    check(
      "Space during playback pauses and adds NO marker",
      (await statusNow()) === "Paused" && (await cutCountNow()) === beforeTransport + 1
    );
    await kd("ArrowDown"); // cursor to the next measure, away from all markers
    await kd("Enter");
    check(
      "Enter while stopped places the marker at the cursor (+1 cut)",
      (await cutCountNow()) === beforeTransport + 2 && /Break point at tick/.test(await statusNow()),
      `count=${await cutCountNow()}`
    );

    // --- Break-point snapping (frozen spec): Snap defaults on, grid = 8 -----
    // Move to a fresh grid line, nudge the cursor 3 ticks OFF the grid with
    // Shift+ArrowRight, then Enter: the marker must land on the grid. Alt
    // must bypass the snap and drop at the exact tick.
    const beforeSnapChecks = await cutCountNow();
    const statusTick = async () => {
      const match = (await statusNow()).match(/tick (\d+)/);
      return match ? Number(match[1]) : NaN;
    };
    await kd("ArrowDown"); // to a fresh measure (still on the grid)
    await kd("ArrowRight", false, true);
    await kd("ArrowRight", false, true);
    await kd("ArrowRight", false, true); // cursor now 3 ticks off-grid
    await kd("Enter");
    const snappedTick = await statusTick();
    check(
      "Enter with Snap on lands on the nearest grid tick",
      (await cutCountNow()) === beforeSnapChecks + 1 && snappedTick % 8 === 0,
      `tick=${snappedTick} status=${await statusNow()}`
    );
    // The snapped Enter synced the cursor to the grid tick, so 3 nudges
    // reach the same off-grid tick again.
    await kd("ArrowRight", false, true);
    await kd("ArrowRight", false, true);
    await kd("ArrowRight", false, true);
    await kd("Enter", false, true, true); // Alt held: bypass snapping
    const bypassTick = await statusTick();
    check(
      "Alt+Enter bypasses Snap and drops at the exact (unsnapped) tick",
      (await cutCountNow()) === beforeSnapChecks + 2 && bypassTick === snappedTick + 3 && bypassTick % 8 === 3,
      `tick=${bypassTick} (snapped was ${snappedTick}) status=${await statusNow()}`
    );
    await kd("Enter", false, true, true); // same spot again: idempotent
    check(
      "Enter on an existing break point adds no cut and says so",
      (await cutCountNow()) === beforeSnapChecks + 2 && (await statusNow()).includes(`already at tick ${bypassTick}`),
      `count=${await cutCountNow()} status=${await statusNow()}`
    );

    await kd("[");
    check("[ slows to 0.75x", (await evaluate(`document.getElementById('select-rate').value`)) === "0.75");
    await kd("[");
    const rateHalf = await evaluate(`document.getElementById('select-rate').value`);
    const rateDot = await evaluate(`document.getElementById('rate-wrap').classList.contains('rate-active')`);
    check("[ slows to 0.5x and the control highlights off-speed", rateHalf === "0.5" && rateDot === true);
    for (let i = 0; i < 4; i++) await kd("]");
    const rateMax = await evaluate(`document.getElementById('select-rate').value`);
    check(
      "] clamps at 1.5x with the endpoint hint",
      rateMax === "1.5" && (await statusNow()).includes("Already fastest"),
      `rate=${rateMax} status=${await statusNow()}`
    );
    await kd(" ");
    await kd(" ");
    check(
      "rate survives a play/pause round-trip (still 1.5x)",
      (await evaluate(`document.getElementById('select-rate').value`)) === "1.5"
    );

    // --- Q / W grid cycling: the Grid select must follow the store ----------
    // Regression: cycleGrid (keys.ts) wrote store.grid only; the command-bar
    // Grid select had no store -> DOM path, so after a keyboard change it kept
    // showing the previous density while snapping already used the new one.
    await kd("q");
    const gridDown = await evaluate(`document.getElementById('select-grid').value`);
    await kd("w");
    const gridRestored = await evaluate(`document.getElementById('select-grid').value`);
    check(
      "Q/W cycle the grid and the Grid select follows the store",
      gridDown === "6" && gridRestored === "8" && (await statusNow()).includes("Grid: 8 per measure"),
      `select ${gridDown} -> ${gridRestored}, status=${await statusNow()}`
    );
    // Clamping at both ladder ends must not desync the select either, and the
    // density must end back at 8: later checks (marker spacing, snap ticks)
    // assume the default density.
    for (let i = 0; i < 6; i++) await kd("q"); // 8 -> 1; extra presses clamp low
    const gridFloor = await evaluate(`document.getElementById('select-grid').value`);
    for (let i = 0; i < 12; i++) await kd("w"); // 1 -> 32; extra presses clamp high
    const gridCeil = await evaluate(`document.getElementById('select-grid').value`);
    for (let i = 0; i < 4; i++) await kd("w"); // clamped at 32
    const gridCeilClamped = await evaluate(`document.getElementById('select-grid').value`);
    for (let i = 0; i < 4; i++) await kd("q"); // 32 -> 8 (back to the default)
    const gridBack = await evaluate(`document.getElementById('select-grid').value`);
    check(
      "grid cycling clamps at 1 and 32 without desyncing the Grid select",
      gridFloor === "1" && gridCeil === "32" && gridCeilClamped === "32" && gridBack === "8",
      `floor=${gridFloor} ceil=${gridCeil}/${gridCeilClamped} restored=${gridBack}`
    );

    // --- Slice preview (P): a retrigger replaces the previous preview ---------
    // Preview nodes are independent of the whole-track node, so the only way to
    // observe them from the renderer is to track every source that starts and
    // stops. Pressing P twice must leave exactly one sounding source: a second
    // P press that layered a new node on top of the still-playing one would
    // show two (the original bug: no replay, just stacking).
    await evaluate(`(function(){
      if (window.__soundingSources) return true;
      window.__soundingSources = new Set();
      const proto = AudioBufferSourceNode.prototype;
      const start = proto.start;
      const stop = proto.stop;
      proto.start = function (...args) {
        window.__soundingSources.add(this);
        this.addEventListener('ended', () => window.__soundingSources.delete(this));
        return start.apply(this, args);
      };
      proto.stop = function (...args) {
        window.__soundingSources.delete(this);
        return stop.apply(this, args);
      };
      return true;
    })()`);
    const soundingNow = () => evaluate(`window.__soundingSources.size`);
    const cutsBeforePreview = await cutCountNow();
    // The transport tests above left the cursor past the 3 s source; step back
    // two measures so the slice at the cursor is real audio again.
    await kd("ArrowUp");
    await kd("ArrowUp");
    await kd("p");
    await waitMs(150);
    const afterFirstPreview = await soundingNow();
    await kd("p");
    await waitMs(150);
    const afterSecondPreview = await soundingNow();
    check(
      "P retriggers the slice preview instead of layering it",
      afterFirstPreview === 1 && afterSecondPreview === 1 && (await cutCountNow()) === cutsBeforePreview &&
        /Preview slice/.test(await statusNow()),
      `first P=${afterFirstPreview}, second P=${afterSecondPreview} soundings, status=${await statusNow()}`
    );
    // Stop the leftover preview so the audio clock stays clean for calibration.
    await evaluate(`(function(){
      for (const node of [...window.__soundingSources]) { try { node.stop(); } catch {} }
      window.__soundingSources.clear();
      return true;
    })()`);

    // --- Tap calibration: continuous clicks, Enter / , / . taps -------------
    const cutsBeforeCalibration = await cutCountNow();
    await evaluate(`(function(){ document.getElementById('btn-calibrate').click(); return true; })()`);
    const calibrationOpen = await evaluate(
      `!document.getElementById('calibration-modal').classList.contains('hidden')`
    );
    for (const tapKey of ["Enter", ",", ".", "Enter"]) {
      await kd(tapKey);
      await waitMs(220);
    }
    const calibrationTaps = await evaluate(`document.getElementById('calibration-taps').textContent`);
    check(
      "calibration runs continuously and Enter / , / . are counted as taps without markers",
      calibrationOpen && Number(calibrationTaps) >= 4 && (await cutCountNow()) === cutsBeforeCalibration,
      `taps=${calibrationTaps}`
    );
    const liveResult = await evaluate(`document.getElementById('calibration-result').textContent`);
    check(
      "calibration shows live statistics before finishing",
      /median/.test(liveResult),
      liveResult
    );
    await evaluate(`(function(){ document.getElementById('btn-calibration-finish').click(); return true; })()`);
    const calibrationResult = await evaluate(`document.getElementById('calibration-result').textContent`);
    check(
      "calibration finish reports a matched/median result",
      /Matched|No taps matched|Final:/.test(calibrationResult),
      calibrationResult
    );
    await evaluate(`(function(){ document.getElementById('btn-calibration-close').click(); return true; })()`);
    check(
      "calibration modal closes and leaves no calibration state behind",
      await evaluate(`document.getElementById('calibration-modal').classList.contains('hidden')`)
    );
    // ',' and '.' outside calibration place break points. Clear first so both
    // land on empty measures (an existing marker would make the placement
    // idempotent and hide one of the two keys).
    await kd("c");
    const cutsBeforeKeys = await cutCountNow();
    await kd(",");
    await kd("ArrowRight");
    await kd(".");
    check(
      "',' and '.' place break points outside calibration",
      (await cutCountNow()) === cutsBeforeKeys + 2,
      `count ${cutsBeforeKeys} -> ${await cutCountNow()}`
    );

    // --- UI language switch: EN <-> 中文 ------------------------------------
    await evaluate(`(function(){
      const s = document.getElementById('select-language');
      s.value = 'zh';
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    const zhOpen = await evaluate(`document.getElementById('btn-open').textContent`);
    check("language switch renders the Chinese UI", zhOpen === "打开", `btn-open=${zhOpen}`);
    await evaluate(`(function(){
      const s = document.getElementById('select-language');
      s.value = 'en';
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    const enOpen = await evaluate(`document.getElementById('btn-open').textContent`);
    check("language switch restores the English UI", enOpen === "Open", `btn-open=${enOpen}`);

    // --- Playback follow-scroll repaint (paging) ---------------------------
    // Regression: Transport.tick advanced store.scrollTick while playing, but
    // the frame loop only repainted the overlay, so ruler/wave/overview and
    // the scrollbar thumb stayed on the old page. The thumb's style.left is
    // the DOM witness for the repaint path: stop re-anchors the playhead at
    // sample 0, the selection tests' zoom-out is undone and the view scrolled
    // back to tick 0, so while playing the ONLY way the thumb can move is a
    // follow-scroll page (scrollTick change) flowing into updateScrollbar.
    await evaluate(`(function(){ document.getElementById('btn-stop').click(); return true; })()`);
    for (let i = 0; i < 4; i++) await kd("+"); // back to the default zoom
    await evaluate(`(function(){
      const wrap = document.getElementById('wave-wrap');
      for (let i = 0; i < 10; i++) {
        wrap.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 }));
      }
      return true;
    })()`); // scroll left, clamped at tick 0 -> no play-start resnap noise
    const thumbLeftBefore = await evaluate(`document.getElementById('scrollbar-thumb').style.left`);
    await kd(" "); // Space: play from sample 0 (follow playhead is on)
    let thumbLeftAfter = thumbLeftBefore;
    for (let i = 0; i < 60; i++) { // 50ms polls, 3s budget
      await waitMs(50);
      thumbLeftAfter = await evaluate(`document.getElementById('scrollbar-thumb').style.left`);
      if (thumbLeftAfter !== thumbLeftBefore) break;
    }
    check(
      "playback follow-scroll pages the view (scrollbar thumb moves)",
      thumbLeftAfter !== thumbLeftBefore,
      `left ${thumbLeftBefore} -> ${thumbLeftAfter}`
    );
    await kd(" "); // Space: pause playback again

    // --- Mouse remap: left paints, right erases ----------------------------
    await evaluate(`(function(){ document.getElementById('btn-stop').click(); return true; })()`);
    await kd("c"); // clear all markers so the paint check starts from empty
    const cuts = () => evaluate(`document.querySelectorAll('#cut-list li').length`);
    const beforePaint = await cuts();
    await evaluate(`(function(){
      const wrap = document.getElementById('wave-wrap');
      const rect = wrap.getBoundingClientRect();
      const y = rect.top + rect.height * 0.3;
      const ev = (type, x) => new MouseEvent(type, { bubbles: true, cancelable: true, clientX: Math.round(rect.left + x), clientY: y, button: 0 });
      wrap.dispatchEvent(ev('mousedown', 300));
      for (let x = 340; x <= 660; x += 40) window.dispatchEvent(ev('mousemove', x));
      window.dispatchEvent(ev('mouseup', 660));
      return true;
    })()`);
    const afterPaint = await cuts();
    check("left drag paints markers", afterPaint >= beforePaint + 2, `count ${beforePaint} -> ${afterPaint}`);

    await evaluate(`(function(){
      const wrap = document.getElementById('wave-wrap');
      const rect = wrap.getBoundingClientRect();
      const y = rect.top + rect.height * 0.3;
      const ev = (type, x) => new MouseEvent(type, { bubbles: true, cancelable: true, clientX: Math.round(rect.left + x), clientY: y, button: 2, buttons: 2 });
      wrap.dispatchEvent(ev('mousedown', 300));
      for (let x = 340; x <= 660; x += 40) window.dispatchEvent(ev('mousemove', x));
      window.dispatchEvent(ev('mouseup', 660));
      return true;
    })()`);
    const afterErase = await cuts();
    check("right drag erases markers", afterErase < afterPaint, `count ${afterPaint} -> ${afterErase}`);

    // --- Bands overlay ------------------------------------------------------
    await evaluate(`(function(){ document.getElementById('btn-bands').click(); return true; })()`);
    let bandPixels = { low: 0, mid: 0, high: 0 };
    for (let i = 0; i < 60; i++) {
      await waitMs(50);
      bandPixels = await evaluate(`(function(){
        const c = document.getElementById('wave-canvas');
        const ctx = c.getContext('2d');
        const d = ctx.getImageData(0, 0, c.width, Math.min(c.height, 400)).data;
        let low = 0, mid = 0, high = 0;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
          if (a < 40) continue;
          if (b > 170 && r > 110 && r < 235 && g < 185) low++;
          if (g > 150 && r < 215 && b < 155) mid++;
          if (r > 195 && b > 135 && g < 195) high++;
        }
        return { low, mid, high };
      })()`);
      if (bandPixels.low > 200 && bandPixels.mid > 200) break;
    }
    check(
      "Bands overlay paints the Low/Mid/High envelopes",
      bandPixels.low > 200 && bandPixels.mid > 200,
      JSON.stringify(bandPixels)
    );

    // --- Band detect: adds cuts as ONE undo step ----------------------------
    await evaluate(`(function(){ document.querySelector('.side-tab[data-tab="cuts"]').click(); return true; })()`);
    await kd("Escape"); // whole-track scope (no blue range selection)
    await kd("c"); // clear markers again for a clean detection baseline
    await waitMs(150);
    const beforeDetect = await cuts();
    await evaluate(`(function(){ document.getElementById('btn-band-detect').click(); return true; })()`);
    let detectStatus = "";
    let afterDetect = beforeDetect;
    for (let i = 0; i < 80; i++) {
      await waitMs(100);
      detectStatus = await statusNow();
      afterDetect = await cuts();
      if (/Band detect:/.test(detectStatus)) break;
    }
    check(
      "Band detect adds markers from the loudness rises",
      afterDetect > beforeDetect && /Band detect: \+\d+ cuts/.test(detectStatus),
      `count ${beforeDetect} -> ${afterDetect} · ${detectStatus}`
    );
    await kd("z", true); // Ctrl+Z: the whole detection is one undo step
    check(
      "one undo reverts the whole band detection",
      (await cuts()) === beforeDetect,
      `count=${await cuts()}`
    );

    // --- Resize regression: a widened viewport must repaint every layer ----
    // Regression: after the window grew, the canvases kept their previous
    // painted width (right side black). Root cause: canvases sized themselves
    // from their own clientWidth, which their inline style had pinned. The
    // draw path must measure the live wave-wrap width each call, and the rAF
    // loop must self-check the viewport every frame even if ResizeObserver
    // misses the change (pure devicePixelRatio changes do not fire it).
    const canvasSizes = `({
      dpr: window.devicePixelRatio,
      wrap: document.getElementById('wave-wrap').clientWidth,
      ruler: { css: document.getElementById('ruler-canvas').clientWidth, buf: document.getElementById('ruler-canvas').width },
      wave: { css: document.getElementById('wave-canvas').clientWidth, buf: document.getElementById('wave-canvas').width },
      overview: { css: document.getElementById('overview-canvas').clientWidth, buf: document.getElementById('overview-canvas').width }
    })`;
    await send("Emulation.setDeviceMetricsOverride", {
      width: 2300,
      height: 900,
      deviceScaleFactor: 0,
      mobile: false,
    });
    const followDpr = (dpr) => (c) => Math.abs(c.css - dpr.wrap) <= 1 && Math.abs(c.buf - c.css * dpr.dpr) <= 2;
    let wide = null;
    for (let i = 0; i < 40; i++) {
      // 50ms polls, 2s budget: enough frames for the rAF self-check path.
      await waitMs(50);
      wide = await evaluate(canvasSizes);
      const follow = followDpr(wide);
      if (wide.wrap > 1500 && follow(wide.ruler) && follow(wide.wave) && follow(wide.overview)) break;
    }
    const follow = followDpr(wide);
    check(
      "viewport widens to 2300: wave-wrap, ruler, wave and overview canvases all follow",
      !!wide && wide.wrap > 1500 && follow(wide.ruler) && follow(wide.wave) && follow(wide.overview),
      JSON.stringify(wide)
    );
    // Waveform fills the new width: sample the rightmost 10% of the buffer
    // and require painted (non-transparent) pixels. A stale width either
    // keeps the buffer small (getImageData out of range reads transparent
    // black) or leaves the tail unpainted.
    const tailPainted = await evaluate(`(function(){
      const c = document.getElementById('wave-canvas');
      const ctx = c.getContext('2d');
      const x0 = c.width - Math.floor(c.width * 0.1);
      const d = ctx.getImageData(x0, 0, c.width - x0, Math.min(c.height, 200)).data;
      let non = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) non++;
      return non;
    })()`);
    check("waveform repaints across the full widened width (tail 10% painted)", tailPainted > 1000, `opaque=${tailPainted}`);
    // A pure devicePixelRatio change fires no element resize: the rAF
    // self-check must catch it and resize the backing buffers.
    await send("Emulation.setDeviceMetricsOverride", {
      width: 2300,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false,
    });
    // CDP/Chromium may report 2 as 2.0000000596 on fractional desktop scaling.
    const matchesTargetDpr = (value) => Math.abs(value - 2) <= 1e-6;
    let dprWide = null;
    for (let i = 0; i < 40; i++) {
      await waitMs(50);
      dprWide = await evaluate(canvasSizes);
      const follow2 = followDpr(dprWide);
      if (matchesTargetDpr(dprWide.dpr) && follow2(dprWide.ruler) && follow2(dprWide.wave) && follow2(dprWide.overview)) break;
    }
    check(
      "devicePixelRatio change resizes the canvas buffers (rAF self-check path)",
      !!dprWide && matchesTargetDpr(dprWide.dpr) &&
        [dprWide.ruler, dprWide.wave, dprWide.overview].every(followDpr(dprWide)),
      JSON.stringify(dprWide)
    );
    await send("Emulation.clearDeviceMetricsOverride");
    await waitMs(400);

    // --- Cursor keys must repaint the view, not just mutate the store --------
    // Regression: keys.ts moved store.cursorTick directly and nothing repainted,
    // so the readout froze on the old position and the cut list kept its old
    // highlight — the arrow keys looked dead. (The cursor line itself is drawn
    // by the overlay; canvas readback is unreliable under the display-profile
    // emulation above, so this check watches the two DOM witnesses instead.)
    await kd("c"); // clear markers so only OUR marker can be the active row
    await kd("ArrowUp");
    await kd("ArrowUp");
    await kd("ArrowUp"); // clamp the cursor back to tick 0
    await kd("z"); // park one marker exactly on the cursor -> its row is active
    await waitMs(100);
    const activeBefore = await evaluate(`document.querySelectorAll('#cut-list li.active').length`);
    await kd("ArrowRight");
    await waitMs(150);
    const activeAfter = await evaluate(`document.querySelectorAll('#cut-list li.active').length`);
    // The measure readout must follow a one-measure cursor move as well.
    const measureText = () => evaluate(`document.getElementById('readout-position').textContent.trim().slice(0, 4)`);
    const measureBefore = await measureText();
    await kd("ArrowDown");
    await waitMs(150);
    const measureAfter = await measureText();
    check(
      "arrow keys repaint the cursor (cut-list highlight and readout follow it)",
      activeBefore === 1 && activeAfter === 0 && measureBefore !== measureAfter,
      `active ${activeBefore} -> ${activeAfter}, measure ${measureBefore} -> ${measureAfter}`
    );

    // --- All four cursor keys, their Shift variants and clamping ------------
    // Enter reports the exact tick it used ("Break point at tick N"), so it
    // doubles as a cursor readout: place a marker, read the tick, undo it. Snap
    // is off so the reported tick is the raw cursor, not the nearest grid line.
    await evaluate(`(function(){ document.getElementById('btn-snap').click(); return true; })()`);
    await kd("c"); // one marker at a time keeps the Enter probe unambiguous
    const tickAtCursor = async () => {
      await kd("Enter");
      const status = await statusNow();
      if (!/already at tick/.test(status)) await kd("z", true); // undo the probe marker
      const match = status.match(/tick (\d+)/);
      return match ? Number(match[1]) : NaN;
    };
    const startTick = await tickAtCursor(); // 216 from the moves above
    await kd("ArrowDown");
    const downTick = await tickAtCursor();
    await kd("ArrowUp");
    const upTick = await tickAtCursor();
    await kd("ArrowRight", false, true); // Shift: exactly one tick
    const oneTickRight = await tickAtCursor();
    await kd("ArrowLeft", false, true);
    const oneTickBack = await tickAtCursor();
    await kd("ArrowLeft"); // grid step (8 cells per measure -> 24 ticks)
    const leftTick = await tickAtCursor();
    check(
      "ArrowUp/Down step one measure, Shift+ArrowLeft/Right step one tick",
      downTick === startTick + 192 && upTick === startTick && oneTickRight === startTick + 1 &&
        oneTickBack === startTick && leftTick === startTick - 24,
      `start=${startTick} down=${downTick} up=${upTick} shiftRight=${oneTickRight} ` +
        `shiftBack=${oneTickBack} left=${leftTick}`
    );

    check("renderer has no uncaught exceptions", pageExceptions.length === 0, pageExceptions.join(" | "));
    const failed = checks.filter((c) => !c.ok);
    if (pageExceptions.length) {
      console.log("PAGE EXCEPTIONS:");
      for (const ex of pageExceptions.slice(0, 10)) console.log("  " + ex);
    }
    console.log(failed.length ? `SMOKE FAILED: ${failed.length}/${checks.length}` : `SMOKE OK: ${checks.length}/${checks.length}`);
    if (failed.length) await saveScreenshot().catch((error) => console.error(error.message));
    await cleanup();
    process.exit(failed.length ? 1 : 0);
  } catch (err) {
    console.error("SMOKE ERROR:", err.message || err);
    await saveScreenshot().catch(() => {});
    if (stderr) console.error("electron stderr:", stderr.slice(0, 2000));
    await cleanup();
    process.exit(1);
  }
}

main().catch(error => { console.error("SMOKE FATAL:", error); process.exitCode = 1; });
