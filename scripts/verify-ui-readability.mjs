// R0 runner: captures each visual baseline scenario under each browser profile
// as an isolated Playwright invocation with a hard 30-second watchdog and
// process-tree cleanup, mirroring scripts/test-app-ui.mjs. Build dist/app first;
// the watchdog covers only test execution, never the build.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));

const scenarios = [
  'ui readability baseline: main window',
  'ui readability baseline: side panel tabs',
  'ui readability baseline: bmhelper dialogs',
  'ui readability baseline: about dialog',
  'ui readability baseline: calibration dialog',
];
const profiles = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['low', 'high'];

const failures = [];
for (const profile of profiles) {
  for (const scenario of scenarios) {
    const label = `[${profile}] ${scenario}`;
    console.log(`Running scenario: ${label}`);
    const started = Date.now();
    const child = spawn(
      process.execPath,
      [
        cli,
        'test',
        '--config',
        'playwright.app.config.mts',
        '--project',
        profile,
        '--grep',
        scenario,
      ],
      {
        stdio: 'inherit',
        detached: process.platform !== 'win32',
        windowsHide: true,
        env: { ...process.env, WOSLICER_UI_BASELINE: '1' },
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
          reject(new Error(`${label} exceeded the 30-second watchdog`));
        }, 30_000);
        child.once('error', reject);
        child.once('close', resolve);
      });
      if (code !== 0 || process.exitCode) throw new Error(`${label} failed (${code})`);
      console.log(`Scenario passed in ${Date.now() - started}ms: ${label}`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      console.error(`Scenario failed: ${label}`);
    } finally {
      clearTimeout(timer);
      process.removeListener('SIGINT', interrupted);
      process.removeListener('SIGTERM', interrupted);
      if (process.platform !== 'win32') stop();
    }
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} scenario run(s) failed:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('\nAll ui-readability baseline scenarios passed.');
