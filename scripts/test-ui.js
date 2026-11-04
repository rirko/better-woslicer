// Each profile owns its Electron process tree, browser data and temporary files.
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { createSession, removeSession, killTree, stopChild } = require("./ui-process.js");
const packaged = process.argv.includes("--packaged");
if (packaged) {
  const pkg = require("../package.json");
  const folder = path.resolve("release", pkg.name + "-" + process.platform + "-" + process.arch);
  process.env.SMOKE_APP = process.platform === "darwin"
    ? path.join(folder, pkg.productName + ".app", "Contents", "MacOS", "Electron")
    : path.join(folder, pkg.name + (process.platform === "win32" ? ".exe" : ""));
  if (!fs.existsSync(process.env.SMOKE_APP)) throw new Error("Packaged app not found: " + process.env.SMOKE_APP);
}
async function run(profile) {
  fs.mkdirSync("test-artifacts", { recursive: true });
  const session = createSession(profile);
  const log = fs.createWriteStream(path.join("test-artifacts", `${packaged ? "packaged-" : ""}${profile}.log`));
  const child = spawn(process.execPath, [path.join(__dirname, "smoke-gui.js")], {
    detached: process.platform !== "win32",
    env: { ...process.env, SMOKE_RUN_DIR: session, SMOKE_PROFILE: profile, SMOKE_PACKAGED: packaged ? "1" : "0" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let electronPid;
  let timedOut = false;
  let termination;
  child.on("message", message => {
    if (message?.type === "electron-started" && Number.isInteger(message.pid)) electronPid = message.pid;
    if (message?.type === "electron-stopped") electronPid = undefined;
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    const message = "UI TIMEOUT: " + profile + " exceeded 30000 ms\n";
    log.write(message); process.stderr.write(message);
    termination = Promise.all([killTree(electronPid), stopChild(child)]);
    termination.catch(error => console.error("UI CLEANUP ERROR:", error.message));
  }, 30000);
  for (const stream of [child.stdout, child.stderr]) stream.on("data", data => {
    log.write(data); process.stdout.write(data);
  });
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    return code === 0 && !timedOut;
  } finally {
    clearTimeout(timeout);
    if (termination) await termination;
    // A crashed harness can leave its detached Electron group behind.
    await killTree(electronPid);
    await new Promise(resolve => log.end(resolve));
    removeSession(session);
  }
}
(async () => {
  let ok = true;
  for (const profile of ["low", "high"]) if (!(await run(profile))) ok = false;
  process.exitCode = ok ? 0 : 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
