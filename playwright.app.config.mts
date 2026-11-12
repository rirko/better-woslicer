import { defineConfig } from '@playwright/test';

/** Browser verification of the Vue lane; native Tauri UI profiles remain separate. */
export default defineConfig({
  testDir: './tests/app',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  workers: 1,
  fullyParallel: false,
  outputDir: `test-artifacts/app-ui/${Date.now()}`,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    locale: 'en-US',
    baseURL: 'http://127.0.0.1:4184',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'low', use: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } },
    { name: 'high', use: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: 'node scripts/serve-static.mjs dist/app --port 4184 --no-open',
    url: 'http://127.0.0.1:4184',
    reuseExistingServer: false,
    timeout: 10_000,
  },
});
