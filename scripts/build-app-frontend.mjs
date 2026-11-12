// Builds the shared Vue frontend in its two variants: the strict-CSP
// browser output (dist/app) and the Tauri output whose CSP must allow the
// ipc custom protocol (dist/app-tauri). Run via npm scripts, not directly.
import { build, createServer } from 'vite';
import { execFileSync } from 'node:child_process';
import { resolveBuildProfile } from './build-profile.mjs';

const variant = process.argv[2] ?? 'web';
if (variant === 'tauri') process.env.WOSLICER_TAURI_FRONTEND = '1';
else if (variant !== 'web') throw new Error(`unknown frontend variant: ${variant}`);
const selected = resolveBuildProfile(process.argv.slice(3));
process.env.WOSLICER_BUILD_PROFILE = selected.profile;
if (selected.args.some((arg) => arg !== '--dev')) {
  throw new Error(`Unknown frontend options: ${selected.args.join(' ')}`);
}
const dev = selected.args.includes('--dev');

if (dev) {
  const server = await createServer({ configFile: 'vite.config.mts' });
  await server.listen();
} else {
  console.log(`Frontend ${variant}: ${selected.profile}`);
  const run = (...args) =>
    execFileSync(process.execPath, args, { stdio: 'inherit', windowsHide: true });
  run('scripts/check-version.js');
  run('scripts/gen-i18n.js');
  run('scripts/tauri-build-info.mjs');
  run('node_modules/vue-tsc/bin/vue-tsc.js', '-p', 'tsconfig.app.json', '--noEmit');
  await build({ configFile: 'vite.config.mts' });
  run(
    'scripts/tauri-build-info.mjs',
    '--check',
    '--copy',
    `dist/app${variant === 'tauri' ? '-tauri' : ''}/build-info.json`,
  );
}
