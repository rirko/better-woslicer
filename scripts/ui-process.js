// Process/session ownership shared by the UI supervisor and standalone smoke test.
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const rawTmpRoot = os.tmpdir();
fs.mkdirSync(rawTmpRoot, { recursive: true });
const tmpRoot = fs.realpathSync(rawTmpRoot);
const prefix = "woslicer-ui-";
function createSession(profile) {
  return fs.mkdtempSync(path.join(tmpRoot, `${prefix}${profile}-`));
}
function removeSession(directory) {
  const resolved = path.resolve(directory);
  const rawDirectory = path.resolve(directory);
  if (path.dirname(resolved) !== tmpRoot || path.dirname(rawDirectory) !== rawTmpRoot ||
      !path.basename(resolved).startsWith(prefix) ||
      fs.lstatSync(resolved, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error("Refusing to remove unowned UI session: " + resolved);
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
async function killTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    await new Promise(resolve => execFile("taskkill", ["/PID", String(pid), "/T", "/F"],
      { windowsHide: true, timeout: 3000 }, () => resolve()));
  } else {
    try { process.kill(-pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
}
async function stopChild(child) {
  const closed = new Promise(resolve => child.once("close", resolve));
  await killTree(child.pid);
  if (child.exitCode !== null || child.signalCode !== null) return;
  let timeout;
  try {
    await Promise.race([closed, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Child process did not close after termination")), 3000);
    })]);
  } finally { clearTimeout(timeout); }
}
module.exports = { createSession, removeSession, killTree, stopChild };
