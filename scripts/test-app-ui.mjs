// Each browser profile gets a fresh Playwright process/server and a hard deadline.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));

for (const profile of ['low', 'high']) {
  console.log(`Running web UI profile: ${profile}`);
  const child = spawn(
    process.execPath,
    [
      cli,
      'test',
      '--config',
      'playwright.app.config.mts',
      '--project',
      profile,
      ...process.argv.slice(2),
    ],
    {
      stdio: 'inherit',
      detached: process.platform !== 'win32',
      windowsHide: true,
    },
  );
  const stop = () => {
    if (!child.pid) return;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 5_000,
      });
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  };
  let timer;
  const interrupted = () => {
    stop();
    process.exitCode = 1;
  };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  try {
    const code = await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        stop();
        reject(new Error(`${profile} UI profile exceeded 30 seconds`));
      }, 30_000);
      child.once('error', reject);
      child.once('close', resolve);
    });
    if (code !== 0 || process.exitCode) {
      throw new Error(`${profile} UI profile failed (${code})`);
    }
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    // Playwright normally closes its server and browsers. Kill any remaining
    // Unix process-group members; Windows timeout cleanup uses taskkill /T.
    if (process.platform !== 'win32') stop();
  }
}
