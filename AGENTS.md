# AI contribution rules

These instructions apply to the whole repository. Keep this file in English and use the canonical name `AGENTS.md`; do not create duplicate `agent.md` or `agents.md` files.

## Offline application

- The app is a local desktop audio editor. AI contributors MUST NOT add features that access the public Internet or other external networks, including telemetry, analytics, crash uploads, update checks, cloud services, remote assets or links that open an external browser.
- Keep audio, projects, preferences and user data local. Do not introduce outbound HTTP(S), WebSocket, DNS or socket activity in application code or runtime dependencies. Preserve the restrictive CSP and Electron isolation.
- Bundle all assets and runtime dependencies locally. Build-time downloads, CI artifact uploads and test-only loopback connections are permitted; they must never become normal application features. Remote debugging must be test-only and bound to loopback.
- If a request conflicts with this policy, explain the conflict and propose an offline alternative.

## User-facing documentation

- Maintain `README.md` and `README.zh-CN.md`, plus `CHANGELOG.md` and `CHANGELOG.zh-CN.md`. Keep the English and Chinese content consistent.
- Write changelogs for users: describe features, visible fixes, download options and practical improvements. Do not present CI internals, test assertions, dependency maintenance, implementation details or commit IDs as release highlights.
- Keep READMEs concise: purpose, features, installation, common controls and development commands. Put detailed technical references in `docs/` and link to them.
- Remove development diaries, abandoned approaches, repeated explanations and unsupported claims. Summarize older changes briefly; the first two large commits do not need exhaustive histories.
- Documentation cleanup does not authorize rewriting Git history. For documentation-only edits, check links, version consistency and formatting; do not claim that existing archives were updated unless they were repackaged.

## Version and About information

- Root `package.json` → `version` is the sole editable application version. Read its current value instead of maintaining another current-version constant here or elsewhere.
- Use `npm version <version> --no-git-tag-version --ignore-scripts` to synchronize the lockfile without creating a commit or tag. Update both changelogs and run `npm run check:version`.
- Derive runtime version displays, package metadata, native version resources and archive names from that source. Changelog versions are historical records, not build inputs. Keep Electron's runtime version separate from the application version.
- About must show the application version, full Git commit and fixed UTC build date/time in every supported language. Generate provenance during the build and bundle it; do not use the launch time or query Git/network at runtime. Clearly mark builds containing uncommitted changes.
- Follow `docs/VERSIONING.md` for the metadata format and build process.

## Testing and clean builds

- Use Node.js 24 and the npm lockfile; use `npm ci` for a clean dependency install. Do not rely on stale generated files when validating a clean build.
- UI tests must cover low resolution (1280×720, DPR 1) and high resolution (1920×1080, DPR 2), with an independent 30-second hard timeout per profile. Verify the actual display configuration and retain logs and failure screenshots when available.
- Compare fractional DPR values with a numeric tolerance while still checking canvas sizes. Check the complete API allowlist, and derive grid fixtures from the current grid semantics.
- When a test fails, inspect relevant commit history to distinguish stale expectations from application regressions. Do not weaken or skip assertions merely to obtain a pass.
- If clean build, test or packaging fails, stop the downstream packaging/publication flow and diagnose the cause. Do not label incomplete artifacts as successful releases.
- Run checks appropriate to the change. Before reporting a complete application build, verify type checking, unit tests, UI profiles and archive integrity. Missing oracle fixtures must be reported as skipped, not passed. Never claim an unexecuted platform was verified.

## CI and packaging

- CI must cover every branch push and pull request. Windows and Linux run tests and package the app, including UI checks on development and packaged applications.
- macOS Intel and ARM64 run type checks, unit tests and packaging; macOS UI testing is not currently a gate. Do not imply macOS cannot run tests.
- Use `.7z` for Windows, `.tar.xz` for Linux and `.zip` containing a `.app` for macOS. Include the complete production dependency tree, documentation, license notices and SHA-256 checksums.
- Upload successful build archives as Actions artifacts; retain diagnostics on failures. Do not add CD, deployment or GitHub Release publishing unless explicitly requested.
- State signing/notarization limitations accurately. Do not claim local validation proves that hosted runners will pass. See `docs/CI.md` for workflow details.

## Licensing and attribution

- Preserve the standard MIT text in `LICENSE` and its contributor attribution. Include `LICENSE` and `NOTICE` in application packages.
- MIT covers only material contributors have the right to license. Preserve the original woslicerIII attribution and third-party licensing scope in `NOTICE`; do not claim MIT relicenses original-derived portions or bundled dependencies.
- Keep necessary licensing information when shortening documentation. Do not invent permissions, remove provenance to suggest independent authorship, or describe compatibility claims as verified without the required evidence.
