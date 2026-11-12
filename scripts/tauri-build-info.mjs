import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'src-tauri/generated/build-info.json');
const args = process.argv.slice(2);
const check = args.includes('--check');
let copy;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--check') continue;
  if (args[i] === '--copy' && args[i + 1]) copy = resolve(root, args[++i]);
  else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
}
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i.test(pkg.version)) {
  throw new Error('Root package.json must contain a valid application version');
}
const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
if (!/^[\da-f]{40,64}$/.test(commit)) throw new Error('Expected full source commit');
const dirty = git('status', '--porcelain', '--untracked-files=normal').length > 0;
if (check) {
  const info = JSON.parse(readFileSync(target, 'utf8'));
  if (info.version !== pkg.version || info.name !== pkg.name || info.commit !== commit || info.dirty !== dirty ||
      typeof info.builtAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(info.builtAt) || !Number.isFinite(Date.parse(info.builtAt))) {
    throw new Error('Stale or invalid Tauri build identity; regenerate before building');
  }
} else {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch !== undefined && !/^\d+$/.test(epoch)) throw new Error('SOURCE_DATE_EPOCH must be nonnegative Unix seconds');
  const builtAt = new Date(epoch === undefined ? Date.now() : Number(epoch) * 1000).toISOString();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify({ name: pkg.name, version: pkg.version, commit, dirty, builtAt }, null, 2)}\n`);
}
if (copy) {
  mkdirSync(dirname(copy), { recursive: true });
  copyFileSync(target, copy);
}
console.log(`${check ? 'Validated' : 'Generated'} Tauri build identity${copy ? `; copied to ${copy}` : ''}`);
