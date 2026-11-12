// Keep the frontend hook and Tauri on the same profile, including direct CLI use.
import { spawnSync } from 'node:child_process';
import { resolveBuildProfile } from './build-profile.mjs';

const [command, ...options] = process.argv.slice(2);
let args = process.argv.slice(2);
if (command === 'build' || command === 'bundle') {
  const selected = resolveBuildProfile(options);
  process.env.WOSLICER_BUILD_PROFILE = selected.profile;
  args = [command, ...(selected.profile === 'debug' ? ['--debug'] : []), ...selected.args];
  console.log(`Tauri ${command}: ${selected.profile}`);
}
const result = spawnSync(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', ...args], {
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
