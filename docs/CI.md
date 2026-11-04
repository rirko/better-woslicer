# Build and CI

Use Node.js 24 and npm. From a clean checkout:

```sh
npm ci
node node_modules/electron/install.js
npm run typecheck
npm run build
npm test
npm run test:ui
npm run package
npm run test:ui:packaged
```

`npm run test:ui` runs low (1280×720, DPR 1) and high (1920×1080, DPR 2; 3840×2160 backing pixels) profiles sequentially. Each profile has an independent 30-second hard timeout. The later resize checks also exercise fractional DPR comparisons. Logs and failure screenshots go to `test-artifacts/`. The packaged variant runs the same tests against the native portable executable. On Linux, run UI commands under `dbus-run-session -- xvfb-run`; CI installs PulseAudio and creates a null sink. The Ubuntu 24.04 hosted image already provides Xvfb, D-Bus and xz-utils and enables unprivileged user namespaces on its disposable VM so Electron keeps its sandbox enabled.

`.github/workflows/build.yml` handles all branch pushes and all PR target branches, plus manual dispatch. Windows/Linux run type checks, unit tests and both UI profiles before and after packaging. macOS Intel and ARM64 run type checks and unit tests, then package; macOS UI automation is not currently a gate. Missing original oracle fixtures are reported as skipped, not passed.

The native platform determines the package format:

- Windows x64: `release/*.7z` (portable application folder).
- Linux x64: `release/*.tar.xz` (portable executable and runtime libraries).
- macOS Intel/ARM64: `release/*.zip`, containing the application folder and `.app` bundle. Bundles have a local ad-hoc signature only, without Developer ID signing or notarization; these are CI builds, not notarized public releases.

Archives include `.sha256` checksums and are uploaded as Actions artifacts for 14 days. UI diagnostics are retained for 7 days even on failure. GitHub may wrap these files in its own artifact download archive. No GitHub Release, publishing credentials, deployment or CD workflow is configured.

Packaging copies only compiled app files, documentation and the complete installed production dependency tree. It uses the platform's Electron runtime installed before testing. Windows compression uses the locked `7zip-bin` dependency, so it does not depend on PowerShell Archive modules. Linux uses `tar`/`xz`; macOS uses `ditto`, `plutil` and ad-hoc `codesign`.

Build-time downloads and CI uploads are allowed; the shipped app remains offline. See `AGENTS.md` for AI contribution rules.

Versioning follows [VERSIONING.md](VERSIONING.md); the build/package commands verify the lockfile and both changelogs before producing artifacts.

Each UI profile starts Electron with its own native device scale, a fresh temporary user/session data directory, and an OS-assigned DevTools port (`--remote-debugging-port=0`). The harness discovers the endpoint only from that child’s stderr. Native scale is checked before viewport emulation; native window diagnostics are retained in the test artifacts. All Electron processes are terminated and awaited before the next profile, including failures/timeouts. No user preferences or audio fixtures are shared between profiles. Linux Xvfb uses a 4096×2304 display to accommodate the high-resolution window.
