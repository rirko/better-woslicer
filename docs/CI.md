# CI and local commands

## Commands

Use Node.js 26.x and npm. Older Node majors are not supported:

```sh
npm ci
npm run lint
npm run fmt:check
npm run typecheck
npm test
npm run build
npm run test:app-ui
npm run package
```

`build`, `build:app` and `build:app:tauri` default to debug locally.
`package` produces debug native host bundles, and `npm run tauri -- build`
also defaults to debug. Select release explicitly when needed:

```sh
npm run build -- --release
npm run build:app:tauri -- --release
npm run package -- --release
npm run tauri -- build --release
```

The build scripts also accept `WOSLICER_BUILD_PROFILE=debug` or `release`.
Local Rust checks and tests use Cargo's default dev/test profiles; add
`--release` explicitly to run release checks or tests. JavaScript unit tests
do not have a Cargo compilation profile. UI tests exercise the static output
from the preceding build, which is debug locally unless release was selected.

Debug frontend output still comes from `vite build`, with the same offline
CSP and application behavior; it skips JS/CSS minification and compressed-size
reporting. Release frontend output minifies JS/CSS and omits source maps.
Rust release builds use `opt-level = "z"`, LTO, one codegen unit and symbol
stripping. Panic unwinding remains enabled so tests and bundles can reuse
compatible release dependencies. These settings prioritize size, without
promising a fixed reduction for every platform.

Lint and format checks run on the whole managed scope and must pass with zero
findings; CI runs them right after `npm ci` and before any build. Local commits
run staged-file lint/format checks through the pre-commit hook, so a clean
working tree is expected before committing.
Typecheck covers Vue and core test sources; tests cover components and core.
Original-program oracle tests skip when their external fixtures are absent.

The UI wrapper starts separate Playwright processes for low (1280×720, DPR 1)
and high (1920×1080, DPR 2) against the built static dist/app on loopback. Each has
a 30-second outer deadline that kills the process tree. Playwright closes
its browser contexts and server between profiles. Install Chromium using
npm exec --no -- playwright install chromium.

`npm run test:tauri-ipc` is a Windows-local desktop IPC health check against
the debug executable by default. Use `npm run test:tauri-ipc -- --release`
to check an explicitly built release executable.

`npm run test:tauri-ui` drives the real Tauri window through the WebView2 CDP
transport on a dynamic loopback port, one low profile (1280×720 css viewport
at the host's natural device scale) and one high profile (1920×1080 physical
window at device scale 2), each with an isolated per-run app-data root, a
30-second hard deadline and full process-tree cleanup. It verifies the
application menu bar visibility, devicePixelRatio, canvas-to-DPR size
relationships and captures per-profile screenshots under
`test-artifacts/tauri-ui/`. It requires the release executable
(`npm run build:app:tauri && cargo build --release --manifest-path
src-tauri/Cargo.toml`); a plain debug build bakes in the dev server URL and
cannot render standalone. On non-Windows hosts the profiles report skipped.

## Build workflow

.github/workflows/build.yml handles all branch pushes, pull requests,
manual dispatch, and reusable calls from the release workflow.

| Target | Runner | Packages | Gate |
| --- | --- | --- | --- |
| Web | ubuntu-24.04 | Static site ZIP | Required |
| Windows x64 | windows-2025 | MSI + NSIS setup EXE | Required |
| Windows ARM64 | windows-11-arm | MSI + NSIS setup EXE | Optional |
| Linux x64 | ubuntu-24.04 | deb + AppImage | Optional |
| Linux ARM64 | ubuntu-24.04-arm | deb + AppImage | Optional |

CI sets `WOSLICER_BUILD_PROFILE=release`; it does not build or test a debug
profile. All Node setup steps use Node 26.x.

Web runs lint, format checks, typecheck, both test suites, release build,
both UI profiles, and ZIP integrity validation. Desktop jobs run after web succeeds. The
shared desktop action installs system dependencies and Rust stable,
generates frontend build identity before Cargo, runs rustfmt, locked tests
and Clippy with `--release --all-features`, builds release Tauri bundles,
and checks native package metadata.
Swatinem/rust-cache caches Cargo registry and target dependencies per
OS/target. Tests, Clippy and packaging share the release profile to avoid
separate debug and release cache trees; the cache does not replace checks.
Actions use fixed SHAs.

The Required release checks job requires web and Windows x64 success.
Optional platforms run on main, release calls, or manual dispatch with
optional_platforms enabled. Their failures do not block required targets.
Successful packages and failure diagnostics are uploaded as artifacts.

Windows uses Tauri's native MSI/NSIS formats. Tauri does not provide a native
Windows portable ZIP bundle, so this workflow does not invent one. WebView
installation uses Tauri defaults: no bundled runtime and no download ban.
The app's offline policy does not restrict installers or external dependencies.

## Release workflow

.github/workflows/release.yml handles v* tags and calls the build workflow.
The tag must match the root package version. Only artifacts from that run
are collected; web ZIP and Windows x64 MSI/NSIS are mandatory. Checksums
are included. Optional packages ship when their jobs succeed.

The workflow creates an immediately public **prerelease**, not a draft.
Reruns update matching assets and convert an existing draft to a public
prerelease. It does not mark the prerelease as the latest stable release.

When repository variable CLOUDFLARE_PROJECT_NAME is set, the same tested web
ZIP is deployed to Cloudflare Pages after release publication. This requires
CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID secrets. Without the project
variable, Pages deployment is skipped; the web ZIP still ships in the release.

Restoring workflows does not trigger a push, tag, release, or deployment.
Hosted platform success must be established by an actual workflow run.
