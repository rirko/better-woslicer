# CI and local commands

## Commands

Use Node.js 24:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run test:app-ui
npm run package
```

`package` produces native host bundles.
Typecheck covers Vue and core test sources; tests cover components and core.
Original-program oracle tests skip when their external fixtures are absent.

The UI wrapper starts separate Playwright processes for low (1280×720, DPR 1)
and high (1920×1080, DPR 2) against production dist/app on loopback. Each has
a 30-second outer deadline that kills the process tree. Playwright closes
its browser contexts and server between profiles. Install Chromium using
npm exec --no -- playwright install chromium.

npm run test:tauri-ipc is a Windows-local desktop IPC health check against
the built executable. Browser profiles do not establish native Tauri window
coverage; that remains pending.

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

Web runs typecheck, both test suites, production build, both UI profiles,
and ZIP integrity validation. Desktop jobs run after web succeeds. The
shared desktop action installs system dependencies and Rust stable,
generates frontend build identity before Cargo, runs rustfmt, locked tests
and Clippy, builds Tauri bundles, and checks native package metadata.
Swatinem/rust-cache caches Cargo registry and target dependencies per
OS/target; it does not replace checks. Actions use fixed SHAs.

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
