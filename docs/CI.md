# CI and release workflows

See the [development guide](DEVELOPMENT.md) for local commands and test profiles.

## Build workflow

`.github/workflows/build.yml` runs on pushes to `main` and `dev` and on pull
requests targeting any branch. The tag-based release workflow calls it separately.

| Target | Runner | Packages | Gate |
| --- | --- | --- | --- |
| Web | ubuntu-24.04 | Static site ZIP | Required |
| Windows x64 | windows-2025 | Portable ZIP | Required |
| Windows ARM64 | windows-11-arm | Portable ZIP | Optional |
| Linux x64 | ubuntu-24.04 | deb + AppImage | Optional |
| Linux ARM64 | ubuntu-24.04-arm | deb + AppImage | Optional |
| macOS Apple Silicon | macos-15 | DMG | Optional |
| macOS Intel | macos-15-intel | DMG | Optional |

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
Every desktop job can restore a compatible cache and save a new entry on
success. Compatible build and release jobs use the same cache key for each
target. GitHub scopes cache entries by ref, including PR merge refs.
Actions use fixed SHAs. The workflows define triggers, runners, permissions
and artifact transfer. The scripts in [`.github/scripts/`](../.github/scripts/)
validate and collect native packages, archive the Web build, and prepare or
publish releases.

The Required release checks job requires web and Windows x64 success.
Optional platforms run on pushes to `main` and during tag-based release builds.
Their failures do not block required targets.
Successful packages and failure diagnostics are uploaded as artifacts.

Windows CI builds the release executable with Tauri's `--no-bundle` option and
ships it with LICENSE and NOTICE in a portable ZIP. It compares each ZIP entry
against its source by SHA-256. The ZIP requires an installed WebView2 runtime.
The app stores settings and recovery data in its usual local app data directory.
Local packaging still follows the Tauri configuration.

macOS builds verify the app version, executable architecture and DMG integrity.
The workflow does not use Developer ID signing or Apple notarization.

## Release workflow

.github/workflows/release.yml handles v* tags and calls the build workflow.
The tag must match the root package version. Only artifacts from that run
are collected. The Web ZIP and Windows x64 portable ZIP are mandatory. Checksums
are included. Optional packages ship when their jobs succeed.

The workflow creates an immediately public **prerelease**, not a draft.
Reruns update matching assets and convert an existing draft to a public
prerelease. It does not mark the prerelease as the latest stable release.

When repository variable CLOUDFLARE_PROJECT_NAME is set, the same tested web
ZIP is deployed to Cloudflare Pages after release publication. This requires
CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID secrets. Without the project
variable, Pages deployment is skipped; the web ZIP still ships in the release.

Use a workflow run to verify hosted platforms.
