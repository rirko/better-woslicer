import { defineConfig, devices } from "@playwright/test";

// Browser-build suite: serves dist/web over loopback http (127.0.0.1 is a
// secure context, so clipboard and WebAssembly work without TLS) and runs the
// same scenarios on Chromium and Firefox.
export default defineConfig({
  testDir: "tests/web",
  timeout: 20_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: {
    command: "node scripts/web-test-server.js",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: true,
    timeout: 10_000,
  },
});
