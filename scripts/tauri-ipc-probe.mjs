// Desktop IPC transport health check against the built Tauri executable.
// Verifies the fetch-based ipc custom protocol is actually in use: a healthy
// transport delivers raw command responses as ArrayBuffer and never emits the
// "custom protocol failed" fallback warning. Requires the release build
// (npm run package or cargo build) and, for the raw-chunk stage, at least one
// persisted file grant (open a file once in the app). Run: node scripts/tauri-ipc-probe.mjs
import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Resolve the built executable without any machine-specific absolute path:
// CARGO_TARGET_DIR (as used by the local cargo config) or the repo default.
const targetDir = process.env.CARGO_TARGET_DIR ?? resolve('src-tauri/target');
const exeName = platform() === 'win32' ? 'woslicer-dx.exe' : 'woslicer-dx';
const exe = resolve(targetDir, 'release', exeName);
if (!existsSync(exe)) {
  console.error(
    `built executable not found: ${exe} — run npm run package (or cargo build --release) first`,
  );
  process.exit(1);
}
// The probe drives WebView2 over CDP, which is Windows-specific; on other
// platforms it exits cleanly instead of guessing at file locations.
const grantsPath =
  platform() === 'win32'
    ? resolve(
        process.env.APPDATA ?? resolve(homedir(), 'AppData/Roaming'),
        'io.github.rirko.woslicer-dx/file-grants.json',
      )
    : null;
const port = 9322;
const child = spawn(exe, [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  stdio: 'ignore',
});
try {
  await new Promise((resolve) => setTimeout(resolve, 6000));
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('webview page target not found');

  const client = await connectCdp(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const warnings = [];
  client.onMessage((text) => {
    const message = JSON.parse(text);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'warning') {
      warnings.push(message.params.args.map((arg) => arg.value ?? '').join(' '));
    }
  });
  function send(method, params) {
    const id = nextId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      client.sendFrame(JSON.stringify({ id, method, params }));
    });
  }
  await send('Runtime.enable');
  if (!grantsPath) {
    console.log('tauri ipc probe: skipped on this platform (WebView2/CDP is Windows-only)');
    process.exit(0);
  }
  const grants = JSON.parse(readFileSync(grantsPath, 'utf8'));
  const reference = Object.keys(grants)[0];
  if (!reference) throw new Error('no persisted file grant; open a file once in the app first');
  const expression = `(async () => {
    const T = window.__TAURI_INTERNALS__;
    const transfer = await T.invoke("begin_read", { reference: ${JSON.stringify(reference)} });
    const raw = await T.invoke("read_file_chunk", { transfer, offset: 0, length: 65536 });
    await T.invoke("close_reader", { transfer });
    return { isInstance: raw instanceof ArrayBuffer, byteLength: raw.byteLength };
  })()`;
  const reply = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (reply.result?.exceptionDetails)
    throw new Error(`probe failed: ${reply.result.exceptionDetails.text}`);
  const result = reply.result.result.value;
  await new Promise((resolve) => setTimeout(resolve, 400));
  const fallback = warnings.filter((text) => text.includes('custom protocol'));
  if (fallback.length) throw new Error(`ipc fell back to postMessage: ${fallback[0]}`);
  if (!result.isInstance)
    throw new Error(`raw chunk arrived as ${Object.prototype.toString.call(result)}`);
  console.log(
    `tauri ipc transport ok: raw chunk arrived as ArrayBuffer (${result.byteLength} bytes), no fallback`,
  );
  client.close();
} finally {
  child.kill();
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
