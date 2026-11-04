// Run both display profiles independently; retain stdout/stderr even on timeout.
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
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
  const log = fs.createWriteStream(path.join("test-artifacts", `${packaged ? "packaged-" : ""}${profile}.log`));
  const child = spawn(process.execPath, [path.join(__dirname, "smoke-gui.js")], {
    detached: process.platform !== "win32",
    env: { ...process.env, SMOKE_PROFILE: profile, SMOKE_PACKAGED: packaged ? "1" : "0" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    const message = "UI TIMEOUT: " + profile + " exceeded 30000 ms\n";
    log.write(message); process.stderr.write(message);
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-child.pid, "SIGKILL");
    } catch { child.kill("SIGKILL"); }
  }, 30000);
  for (const stream of [child.stdout, child.stderr]) stream.on("data", data => {
    log.write(data); process.stdout.write(data);
  });
  return new Promise(resolve => {
    child.on("error", error => { clearTimeout(timeout); log.end(String(error)); resolve(false); });
    child.on("close", code => { clearTimeout(timeout); log.end(() => resolve(code === 0 && !timedOut)); });
  });
}
(async () => {
  let ok = true;
  for (const profile of ["low", "high"]) if (!(await run(profile))) ok = false;
  process.exitCode = ok ? 0 : 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
