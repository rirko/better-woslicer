# CI and release workflows

See the [development guide](DEVELOPMENT.md) for local commands and test profiles.

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

Use a workflow run to verify hosted platforms.
