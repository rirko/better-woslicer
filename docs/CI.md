# CI and release workflows

See the [development guide](DEVELOPMENT.md) for local commands and test profiles.

## Build workflow

`.github/workflows/build.yml` runs on pushes to `main` and `dev` and on pull
requests targeting any branch. It also supports manual runs.
The tag-based release workflow calls it separately.

| Target | Runner | Packages | Gate |
| --- | --- | --- | --- |
| Web | ubuntu-24.04 | Static site ZIP | Required |
| Windows x64 | windows-2025 | Portable ZIP | Required |
| Windows ARM64 | windows-11-arm | Portable ZIP | Optional |
| Linux x64 | ubuntu-24.04 | deb + AppImage | Optional |
| Linux ARM64 | ubuntu-24.04-arm | deb + AppImage | Optional |
| macOS Apple Silicon | macos-15 | DMG | Optional |
| macOS Intel | macos-15-intel | DMG | Optional |

CI sets `WOSLICER_BUILD_PROFILE=release`. It does not build or test a debug
profile. All Node setup steps use Node 26.x.

Web runs lint, format checks, typecheck, both test suites, release build,
both UI profiles, and ZIP integrity validation. Desktop jobs run after web succeeds. The shared desktop action runs these steps:

1. Install system dependencies and the pinned Rust toolchain.
2. Generate frontend build identity before Cargo.
3. Run rustfmt.
4. Run locked tests and Clippy with `--release --all-features`.
5. Build release Tauri bundles.
6. Check native package metadata.

Swatinem/rust-cache caches Cargo registry and target dependencies per
OS/target. Tests, Clippy and packaging share the release profile to avoid
separate debug and release cache trees. The cache does not replace checks.
Every desktop job can restore a compatible cache. Only successful `main` jobs
save new Rust cache entries. PR, `dev` and tag builds only read Rust caches.
Compatible build and release jobs use the same cache key for each target.
GitHub scopes cache entries by ref, including PR merge refs.

### Rust cache scope and invalidation

The desktop action pins Rust in `CI_RUST_VERSION`. Update this value explicitly
when adopting a new compiler. A moving `stable` channel can invalidate caches
between two runs of the same PR.

The pinned [rust-cache source](https://github.com/Swatinem/rust-cache/blob/d1527c8f67ef9af357290475d4af4b0fab8f12e0/src/config.ts)
constructs the key from these inputs:

- The shared key, runner OS and CPU architecture.
- The Rust compiler version and relevant environment variables.
- Cargo manifests, lockfiles and Rust configuration files.

`shared-key` replaces the job-specific part. It does not remove GitHub's ref scope.
The action can restore an older dependency cache when the manifest hash changes.
A compiler or environment change also changes the restore prefix.
Keep platform and compiler distinctions: their compiled dependencies are not interchangeable.

[GitHub's cache scope rules](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache)
allow runs to restore caches from the current ref and the default branch.
PR runs can also restore caches from their base branch.
A cache written under `refs/pull/<number>/merge` is available only to that PR's later runs.
It is not available to `dev`, `main`, another PR or a release tag.
Default-branch caches can serve all these consumers. Cache keys cannot grant broader access.
This repository uses `main` as its default branch and sole Rust cache writer.
Update the save condition if the default branch changes.

After this configuration reaches `main`, its first successful build creates shared caches for all desktop targets.
That first build may be cold. New compiler versions or evicted entries also require a cold build.
To populate or refresh missing entries, select **Build and test** in Actions.
Select **Run workflow**, choose `main`, and start the run.
Manual runs validate and archive builds. They do not publish a release or deploy Pages.
Existing PR-scoped caches can remain until GitHub expires them. They do not become shared caches.

The action's `cache-hit` output reports an exact match only.
`Restored from cache key` confirms restoration, including a partial match.
`No cache found.` means a cold build, even when the cache step succeeds.
The post-job step can save a cache for later runs.
GitHub caches are immutable and can expire, so a cache hit is never guaranteed.

### Workflow implementation

Actions use fixed SHAs. The workflows define triggers, runners, permissions
and artifact transfer. The scripts in [`.github/scripts/`](../.github/scripts/)
validate and collect native packages, archive the Web build, and prepare or
publish releases.

The Required release checks job requires web and Windows x64 success.
Optional platforms run on pushes to `main` and during tag-based release builds.
Their failures do not block required targets.
The workflow uploads successful packages and failure diagnostics as artifacts.

Windows CI builds the release executable with Tauri's `--no-bundle` option and
ships it with LICENSE and NOTICE in a portable ZIP. It compares each ZIP entry
against its source by SHA-256. The ZIP requires an installed WebView2 runtime.
The app stores settings and recovery data in its usual local app data directory.
Local packaging still follows the Tauri configuration.

macOS builds verify the app version, executable architecture and DMG integrity.
The workflow does not use Developer ID signing or Apple notarization.

## Release workflow

.github/workflows/release.yml handles v* tags and calls the build workflow.
The tag must match the root package version. The workflow collects only artifacts from that run.
The Web ZIP and Windows x64 portable ZIP are mandatory. The release includes checksums. Optional packages ship when their jobs succeed.

`scripts/release-notes.mjs` extracts the current version's entries from both changelogs.
The release description contains those English and Chinese user-facing changes, without build logs
or artifact summaries. Missing, duplicate or empty entries fail release preparation before publication.
Preview the description with `node scripts/release-notes.mjs`.

The workflow creates an immediately public **prerelease**, not a draft.
Reruns update matching assets and convert an existing draft to a public
prerelease. It does not mark the prerelease as the latest stable release.

After publishing the release, the workflow deploys the tested web ZIP to the existing Cloudflare Pages Direct Upload project. Pages is not connected to the Git repository:
GitHub Actions uploads the prebuilt files through Wrangler and the Cloudflare API.
Configure the repository variable `CLOUDFLARE_PROJECT_NAME` and the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
The deployment job fails if any required value is missing. The workflow reads the project's existing
`production_branch` from the API and passes it to Wrangler. This Pages deployment target is independent of the repository branch or release tag.
The workflow does not change Pages settings or require Git integration. After upload, the
job requires a production deployment and compares the deployed `build-info.json`
with the tested archive's copy.
If deployment fails, the prerelease remains published and the failed job can be
rerun without rebuilding or changing the desktop release gate.

Use a workflow run to verify hosted platforms.
