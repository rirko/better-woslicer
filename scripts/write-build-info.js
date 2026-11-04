// Record the source checkout and build time once; runtime never needs Git/network.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const pkg = require("../package.json");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const commit = git("rev-parse", "HEAD");
if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("Cannot identify build commit");
const epoch = process.env.SOURCE_DATE_EPOCH;
if (epoch !== undefined && !/^\d+$/.test(epoch)) throw new Error("SOURCE_DATE_EPOCH must be Unix seconds");
const date = epoch === undefined ? new Date() : new Date(Number(epoch) * 1000);
const info = {
  version: pkg.version,
  commit,
  dirty: git("status", "--porcelain", "--untracked-files=normal") !== "",
  builtAt: date.toISOString(),
};
const target = path.join(root, "dist", "src", "main", "build-info.json");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(info, null, 2) + "\n");
console.log(`Build: ${info.version} ${commit.slice(0, 12)}${info.dirty ? " (modified working tree)" : ""} ${info.builtAt}`);
