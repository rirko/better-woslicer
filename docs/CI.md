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

`.github/workflows/build.yml` runs on pushes to `main` and `dev`, on pull requests, and on manual dispatch. Full-platform builds run only for `main`: every other case (dev pushes, pull requests, manual dispatches) builds Windows x64 alone. The `precompile-payload` job decides the platform matrix through the official dynamic-matrix pattern; the matrix bodies are ordinary JSON files next to the workflow (`matrix-full.json`, `matrix-windows.json`) and are edited there. The job builds the minified payload once per commit (`npm run build && npm run bundle`) and uploads it as the `app-payload-<sha>` artifact together with the `<name>-<version>-maps.tar.xz` source-map archive (`woslicer-maps-<sha>`) and the platform-independent offline web build (`<name>-<version>-web-any.7z`, artifact `woslicer-web-any-<sha>`) — a static site served over http, see the README. A Playwright job (`web`, Chromium + Firefox) exercises the web build on a loopback server and is optional. Every platform job downloads that payload and packages it verbatim (`node scripts/package-app.js --bundle payload`), so all archives share byte-identical application code and one map archive serves every platform. Windows x64 is required and always runs. Linux x64, Windows ARM64, Linux ARM64, macOS Intel, and macOS ARM64 are optional full-build matrix jobs; their failures do not fail the workflow. On `vMAJOR.MINOR.PATCH` tag pushes, the separate Release workflow looks up a successful branch-push or manually dispatched CI run by the tag commit SHA. If that run is still queued or running, it waits; it then downloads artifacts from that exact run and creates a draft GitHub Release without rebuilding. Windows x64 and its checksum are mandatory; the offline web build and the source-map archive are also mandatory; successful optional builds are attached and unavailable platforms are listed in the draft notes. After the draft is created, a second job publishes the offline web build to Cloudflare Pages (`wrangler pages deploy`), provided the repository has configured the `CLOUDFLARE_PROJECT_NAME` variable together with the `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` secrets; without that configuration the job skips itself and nothing is deployed. Windows/Linux jobs run UI tests before and after packaging; macOS jobs run type checks and unit tests before packaging. Missing original oracle fixtures are reported as skipped, not passed.

The native platform determines the package format:

- Windows x64: `release/*.7z` (portable application folder).
- Linux x64: `release/*.tar.xz` (portable executable and runtime libraries).
- macOS Intel/ARM64: `release/*.zip`, containing the application folder and `.app` bundle. Bundles have a local ad-hoc signature only, without Developer ID signing or notarization; these are CI builds, not notarized public releases.

Archives include `.sha256` checksums and are uploaded as Actions artifacts for 14 days. The source-map archive is attached to the release draft as a debugging aid: unpack it next to `resources/app` (its folders mirror the payload) and DevTools symbolicates minified stacks again. UI diagnostics are retained for 7 days even on failure. GitHub may wrap these files in its own artifact download archive. The Release workflow creates a draft GitHub Release with the repository `GITHUB_TOKEN`; maintainers review and publish the draft manually. No deployment or external publishing credentials are configured. Release tags should point to commits already on the default branch after workflow changes are merged. The Release lookup waits up to 90 minutes for CI and briefly allows a newly triggered run to appear. If CI artifacts have expired, manually run the build workflow for the tagged commit before retrying the tag workflow.

Packaging consumes the esbuild-precompiled payload from `npm run bundle` (`dist/pack`: one minified main-process file, one self-contained preload, one renderer ESM bundle, `index.html`, `styles.css`, `build-info.json`). Source maps are generated with embedded sources, split out of the payload and archived as the `.tar.xz` symbol package; the payload itself ships no `.map` files. The packager copies the platform's Electron runtime (installed before testing), prunes `locales/*.pak` down to the `chromiumLocales` declared in `src/i18n/languages.json` (the app's language manifest), then fills `resources/app` with the payload, `LICENSE`, `NOTICE`, and the installed production dependency tree without its documentation, type-declaration and source-map files. The decoder dependency stays unpacked because `@eshaz/web-worker` spawns its worker threads from real files. Windows compression uses the locked `7zip-bin` dependency, so it does not depend on PowerShell Archive modules. Linux uses `tar`/`xz`; macOS uses `ditto`, `plutil` and ad-hoc `codesign`. The symbol package is built with the system `tar` plus 7za for the xz layer.

Build-time downloads and CI uploads are allowed; the shipped app remains offline. See `AGENTS.md` for AI contribution rules.

Versioning follows [VERSIONING.md](VERSIONING.md); the build/package commands verify the lockfile and both changelogs before producing artifacts.

Each UI profile starts Electron with its own native device scale, a fresh temporary user/session data directory, and an OS-assigned DevTools port (`--remote-debugging-port=0`). The harness discovers the endpoint only from that child’s stderr. Native scale is checked before viewport emulation; native window diagnostics are retained in the test artifacts. All Electron processes are terminated and awaited before the next profile, including failures/timeouts. No user preferences or audio fixtures are shared between profiles. Linux Xvfb uses a 4096×2304 display to accommodate the high-resolution window.
