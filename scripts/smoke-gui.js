/**
 * GUI smoke test: launches Electron with remote debugging, drives the real
 * renderer over CDP (Node 24 built-in WebSocket), and verifies:
 *  - the app boots with the empty state,
 *  - loading a WAV buffer via the IPC bridge transitions to "Ready",
 *  - marker editing (Z), undo, BMSE clipboard out and WOS round-trip work,
 *  - waveform canvases have non-trivial content.
 *
 * Run: npm run build && node scripts/smoke-gui.js
 */

const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 9223;

function httpJson(urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: PORT, path: urlPath }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(JSON.parse(data)));
      })
      .on("error", reject);
  });
}

async function waitMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // Requiring electron from Node yields the path to the electron binary.
  const electronBinary = require("electron");
  if (typeof electronBinary !== "string") {
    throw new Error("electron did not resolve to a binary path");
  }
  const child = spawn(electronBinary, [".", `--remote-debugging-port=${PORT}`], {
    cwd: path.join(__dirname, ".."),
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => (stderr += c));

  try {
    let targets = null;
    for (let i = 0; i < 40; i++) {
      await waitMs(500);
      try {
        targets = await httpJson("/json/list");
        if (targets.some((t) => t.type === "page" && t.url.includes("index.html"))) break;
      } catch {
        // not up yet
      }
    }
    if (!targets) throw new Error("app did not expose a debugging target");
    const page = targets.find((t) => t.type === "page");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });

    let seq = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    const send = (method, params = {}) =>
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
    await waitMs(1500);

    const checks = [];
    const check = (name, ok, extra = "") => {
      checks.push({ name, ok });
      console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
    };

    check("empty state status", await evaluate(`document.getElementById('status-main').textContent.includes('Empty')`));
    check("preload bridge present", await evaluate(`typeof window.woslicer === 'object' && window.woslicer !== null`));
    check(
      "bridge key count matches allowlist",
      await evaluate(`Object.keys(window.woslicer).length === 16`),
      await evaluate(`Object.keys(window.woslicer).join(',')`)
    );

    // Build a small deterministic WAV (1s, 440Hz) in the page and load it via
    // a real drag-and-drop event (the same path a user file drop takes).
    await evaluate(`(async () => {
      const sr = 48000, n = 48000;
      const buf = new ArrayBuffer(44 + n * 4);
      const v = new DataView(buf);
      const ascii = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      ascii(0,'RIFF'); v.setUint32(4, 36 + n*4, true); ascii(8,'WAVE'); ascii(12,'fmt ');
      v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,2,true);
      v.setUint32(24,sr,true); v.setUint32(28,sr*4,true); v.setUint16(32,4,true); v.setUint16(34,16,true);
      ascii(36,'data'); v.setUint32(40, n*4, true);
      for (let i = 0; i < n; i++) {
        const s = Math.round(Math.sin(2*Math.PI*440*i/sr) * 20000);
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

    // Place markers via the editing model (same path the Z key uses).
    await evaluate(`(function(){
      const canvas = document.getElementById('wave-canvas');
      canvas.parentElement.focus();
      return true;
    })()`);
    // Simulate keydown Z at cursor 0, then move cursor and press Z again.
    await evaluate(`(function(){
      function key(k, opts){ document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); }
      key('z');
      for (let i = 0; i < 24; i++) { key('ArrowRight'); }
      key('z');
      for (let i = 0; i < 24; i++) { key('ArrowRight'); }
      key('z');
      return true;
    })()`);
    const cutCount = await evaluate(`document.querySelectorAll('#cut-list li').length`);
    check("Z key places markers (cut list populated)", cutCount === 3, `count=${cutCount}`);

    // Undo the third marker with real Ctrl+Z (plain z would toggle it back).
    await evaluate(`(function(){ window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); return true; })()`);
    check("undo via Ctrl+Z", await evaluate(`document.querySelectorAll('#cut-list li').length === 2`));

    // --- Selection copy/paste (Ctrl+C -> cursor move -> Ctrl+V) -----------
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
      const opts = (x) => ({ bubbles: true, clientX: Math.round(rect.left + x), clientY: y, button: 0 });
      wrap.dispatchEvent(new MouseEvent('mousedown', opts(100)));
      window.dispatchEvent(new MouseEvent('mousemove', opts(900)));
      window.dispatchEvent(new MouseEvent('mouseup', opts(900)));
      return true;
    })()`);
    const selected = await evaluate(`document.getElementById('status-main').textContent`);
    // After the undo only markers 0 and 192 remain; the box [90..386] holds one.
    check("box select finds the marker in range", /1 marker\(s\) selected/.test(selected), selected);
    await evaluate(`(function(){
      const kd = (key, ctrl) => window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: !!ctrl, bubbles: true }));
      kd('c', true);        // Ctrl+C: copy selection as relative group
      kd('ArrowDown');      // cursor down one measure (192 -> 384)
      kd('v', true);        // Ctrl+V: paste at cursor (384, 576)
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
      await window.woslicer.writeWosFile('${path.join(__dirname, "..", "tmp-smoke.wos").replace(/\\/g, "\\\\")}', bytes);
      const back = await window.woslicer.readWosFile('${path.join(__dirname, "..", "tmp-smoke.wos").replace(/\\/g, "\\\\")}');
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

    const failed = checks.filter((c) => !c.ok);
    console.log(failed.length ? `SMOKE FAILED: ${failed.length}/${checks.length}` : `SMOKE OK: ${checks.length}/${checks.length}`);
    ws.close();
    child.kill();
    fs.existsSync(path.join(__dirname, "..", "tmp-smoke.wos")) &&
      fs.unlinkSync(path.join(__dirname, "..", "tmp-smoke.wos"));
    process.exit(failed.length ? 1 : 0);
  } catch (err) {
    console.error("SMOKE ERROR:", err.message || err);
    if (stderr) console.error("electron stderr:", stderr.slice(0, 2000));
    child.kill();
    process.exit(1);
  }
}

main();
