# CI and release workflows

See the [development guide](DEVELOPMENT.md) for local commands and test profiles.

## Build workflow

`.github/workflows/build.yml` runs on pushes to `main` and `dev` and on pull
requests targeting any branch. Manual runs offer an `all_platforms` checkbox.
Main always builds all platforms. On other branches, select this checkbox to validate additional native targets before merging.
The tag-based release workflow consumes its verified artifacts without rebuilding.

| Target | Runner | Packages | Gate |
| --- | --- | --- | --- |
| Web | ubuntu-24.04 | Static site ZIP | Required |
| Windows x64 | windows-2025 | Portable ZIP | Required |
| Windows ARM64 | windows-11-arm | Portable ZIP | Required when selected |
| Linux x64 | ubuntu-24.04 | deb + AppImage | Required when selected |
| Linux ARM64 | ubuntu-24.04-arm | deb + AppImage | Required when selected |
| macOS Apple Silicon | macos-15 | DMG | Required when selected |
| macOS Intel | macos-15-intel | DMG | Required when selected |

CI builds production frontend assets on every branch. Native jobs use debug outside `main`.
Main builds all release targets and a separate Windows x64 debug job. All Node setup steps use Node 26.x.
The debug job produces the cache that PR and `dev` checks consume. It does not supply release packages.
Static debug Tauri builds keep the application isolation and CSP. They do not use a development server.

Web runs lint, format checks, typecheck, both test suites, release build,
both UI profiles, and ZIP integrity validation. Desktop jobs run after web succeeds. The shared desktop action runs these steps:

1. Install system dependencies and the pinned Rust toolchain.
2. Generate frontend build identity before Cargo.
3. Run rustfmt.
4. Run locked tests and Clippy with `--all-features` and the selected native profile.
5. Build static Tauri bundles with that profile.
6. Check native package metadata.

Swatinem/rust-cache caches Cargo registry and target dependencies per
OS, target and profile. Debug and release dependencies are not interchangeable.
Tests, Clippy and packaging use the same profile within each job. The cache does not replace checks.
Every desktop job can restore a compatible cache. Only successful `main` jobs
save new Rust cache entries. PR and `dev` builds only read Rust caches. Tags do not compile Rust.
Main supplies release caches for all native targets and a debug cache for Windows x64.
Manually selected debug jobs on other platforms can start with cold caches.
GitHub scopes cache entries by ref, including PR merge refs.

### Rust cache scope and invalidation

The root `rust-toolchain.toml` pins Rust for local work and CI. Dependabot can propose compiler updates.
A moving `stable` channel can invalidate caches
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

### macOS compilation reuse

The action exports `MACOSX_DEPLOYMENT_TARGET` before cache restoration and every Cargo command.
Its value comes from `bundle.macOS.minimumSystemVersion` in `src-tauri/tauri.conf.json`.
The explicit value preserves Tauri's previous default, `10.13`. Tauri packaging reads the same configuration.
The cache key includes this variable. Direct Cargo checks and Tauri builds must use the same value.
Otherwise, the Objective-C helper build can invalidate dependent crates despite an exact cache hit.

macOS jobs enable Cargo fingerprint diagnostics. After merging, compare two successful main runs at the same commit.
Check restored keys and Cargo's dirty reasons, especially for `objc2-exception-helper` and its dependents.
A restored cache alone does not prove compilation reuse. Workspace crate compilation is expected.
Hosted CI validates compilation and packages. It does not validate native macOS UI behavior.

### Workflow implementation

Actions use fixed SHAs. The workflows define triggers, runners, permissions
and artifact transfer. The scripts in [`.github/scripts/`](../.github/scripts/)
validate and collect native packages, archive the Web build, and prepare or
publish releases.

For artifact selection, manifests and checksums, start at [`scripts/release-artifacts.mjs`](../scripts/release-artifacts.mjs).
Its `resolve`, `record` and `verify` commands own the transfer contract between build and release.
When adding or removing a platform, update both the build matrix and that script's `targets` list.
Keep the runner matrix in YAML so maintainers can inspect it directly in the workflow.

The Required release checks job requires web, Windows x64 and every selected additional platform to succeed.
Additional platforms run on `main` or when a manual run selects `all_platforms`.
Their failures block the run and publication. PR and `dev` runs normally skip those platforms.
The workflow uploads successful packages and failure diagnostics as artifacts.

Windows CI builds the selected native profile with Tauri's `--no-bundle` option and
ships it with LICENSE and NOTICE in a portable ZIP. It compares each ZIP entry
against its source by SHA-256. The ZIP requires an installed WebView2 runtime.
The app stores settings and recovery data in its usual local app data directory.
Local packaging still follows the Tauri configuration.

macOS builds verify the app version, executable architecture and DMG integrity.
The workflow does not use Developer ID signing or Apple notarization.

## Release workflow

`.github/workflows/release.yml` handles `v*` tags. The tag must match the root package version.
It selects the latest main build at the exact tag commit, from a push or manual run.
That run and every job must succeed. All seven release artifacts must exist and must not be expired.
An incomplete or failed latest run stops publication. The resolver does not fall back to an older successful run.
It never substitutes a PR build, a debug artifact or another commit.

The source job returns a run ID and exact artifact IDs. Publication and Pages consume that same source run.
Each artifact includes a manifest with the commit, version, profile, platform, target, run ID, attempt and package checksums.
The workflow verifies those fields and SHA-256 hashes before publication or deployment.
Packages must come from a clean checkout and the same run attempt. The release includes manifests and checksums.

Artifacts expire after 14 days. If they are missing, expired or from mixed attempts, the release stops without rebuilding.
Rerun all jobs in the original main build at the tag commit, then rerun the release workflow.
A manual main run also works if main still points to that commit.
Do not move a published tag to compensate for missing artifacts.

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

## Dependency updates

`.github/dependabot.yml` schedules weekly version-update PRs against `dev` for npm, Cargo, Rust toolchains and GitHub Actions.
Action scanning covers both workflows and the desktop composite action directory.
Minor and patch updates are grouped per ecosystem. Major updates and compiler updates remain separate PRs.
npm and Cargo updates have a seven-day cooldown. No automatic merge is configured.
Pinned skill submodules remain under manual review.

Dependabot alerts, security-update PRs and scheduled version-update PRs are separate features.
Repository settings control alerts and security updates. This configuration does not enable those settings.
Security-update PRs target the default branch, `main`, regardless of the version-update target.
After a security fix merges into main, merge main into dev. See [Contributing](../CONTRIBUTING.md).
The configuration takes effect after it reaches the default branch. Referenced manifests must also exist on dev.

See [Dependabot options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
and [Rust toolchain updates](https://github.blog/changelog/2025-08-19-dependabot-now-supports-rust-toolchain-updates/).
