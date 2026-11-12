// Builds the shared Vue frontend in its two release variants: the strict-CSP
// browser output (dist/app) and the Tauri output whose CSP must allow the
// ipc custom protocol (dist/app-tauri). Run via npm scripts, not directly.
import { build, createServer } from 'vite';

const variant = process.argv[2] ?? 'web';
if (variant === 'tauri') process.env.WOSLICER_TAURI_FRONTEND = '1';
else if (variant !== 'web') throw new Error(`unknown frontend variant: ${variant}`);
const dev = process.argv.includes('--dev');

if (dev) {
  const server = await createServer({ configFile: 'vite.config.mts' });
  await server.listen();
} else {
  await build({ configFile: 'vite.config.mts' });
}
