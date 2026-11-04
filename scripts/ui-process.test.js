const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const { createSession, removeSession, stopChild } = require("./ui-process.js");

function request(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port }, res => { res.resume(); resolve(res.statusCode); });
    req.setTimeout(500, () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
  });
}

test("display profiles own distinct temporary directories", () => {
  const first = createSession("low"), second = createSession("high");
  try { assert.notEqual(first, second); assert.ok(fs.existsSync(first)); assert.ok(fs.existsSync(second)); }
  finally { removeSession(first); removeSession(second); }
  assert.equal(fs.existsSync(first), false);
  assert.equal(fs.existsSync(second), false);
});

test("cleanup refuses an unowned directory", () => {
  assert.throws(() => removeSession(__dirname), /unowned/);
});

test("stopping the process tree closes a grandchild's listening socket", { timeout: 10000 }, async t => {
  const server = `const http=require('http');const server=http.createServer((req,res)=>res.end('ok'));
    server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));`;
  const launcher = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(server)}],
    {stdio:['ignore','inherit','inherit']});setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ["-e", launcher], {
    detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => stopChild(child));
  const port = await new Promise((resolve, reject) => {
    let data = "";
    child.stdout.on("data", chunk => {
      data += chunk;
      if (data.includes("\n")) { try { resolve(JSON.parse(data.split("\n")[0]).port); } catch (error) { reject(error); } }
    });
    child.once("error", reject);
    child.once("exit", () => reject(new Error("Fixture exited before listening")));
  });
  assert.equal(await request(port), 200);
  await stopChild(child);
  // Termination is asynchronous at the OS socket layer; require eventual refusal.
  for (let attempt = 0; attempt < 20; attempt++) {
    try { await request(port); } catch { return; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail("A descendant is still listening after process-tree cleanup");
});
