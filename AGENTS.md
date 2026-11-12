# Repository instructions

These rules apply to all work in this repository. Keep this file in English.

## Ensemble coordination

- For substantial tasks, follow [the ensemble behavior standard](docs/ENSEMBLE.md). The primary agent owns architecture, shared contracts, decomposition, integration, and final verification.
- Delegate bounded, independently verifiable work when useful, using logical responsibility and state ownership as boundaries. Keep trivial fixes and tightly coupled critical-path work local; delegation is not mandatory.
- Define each subagent's scope, writable files, constraints, dependencies, and acceptance criteria. Avoid overlapping writers and conflicting build/test resources; settle shared contracts before parallel implementation.
- Require reports of changed files, key decisions, actual test results, and unresolved issues. Review diffs and verify integration before declaring completion. Escalate unexpected architectural changes and infrastructure failures instead of repeatedly retrying.
- Optimize for maintainable, human-readable design, not agent utilization. Preserve enough task and checkpoint context for another tool or a human to resume.

## Migration continuity

- When continuing the Vue/Tauri migration, read [the recovery checkpoint](docs/migration/RESUME.md) first, then [the implementation plan](docs/migration/IMPLEMENTATION.md). Check the current Git state before relying on a recorded checkpoint.
- Preserve the approved decisions and distinguish requirements, current implementation, and unverified behavior. Update the checkpoint and relevant work-package status after each completed step so another tool or chat can resume without private session logs.
- For cleanup during this migration, move obsolete files or directories into `.pending-delete/<timestamp>/` instead of running filesystem deletion commands. Verify resolved source and destination paths remain inside the repository before a recursive move.
- The user has authorized frequent local checkpoint commits. Keep them focused and validated; this does not authorize pushing, tagging, publishing, or deployment.

## Product security

- This is an offline desktop audio editor. Do not add application-initiated network behavior, including telemetry, crash uploads, update checks, cloud services, remote assets, or links that launch an external browser.
- The offline boundary applies to the app itself. External tools, installers, dependencies, and system runtimes may use the network independently; their behavior is outside this app's responsibility. Keep Tauri's default WebView installation behavior. Do not bundle WebView runtimes, prohibit their downloads, or add support for systems without a WebView engine.
- Keep user audio, projects, preferences, and other user data local. Preserve the Tauri isolation boundary (no shell/open, no broad IPC) and the restrictive Content Security Policy of both release variants.
- Build-time downloads, CI artifact uploads, and test-only loopback connections are allowed; they must not become application runtime behavior. Test DevTools must bind to loopback.
- If a request conflicts with this policy, explain the conflict and suggest an offline alternative.

## Implementation and TypeScript

- Follow existing module boundaries and patterns. Keep changes focused and preserve unrelated work.
- Keep TypeScript strict checks enabled. Treat untrusted input as unknown, validate it at system boundaries, and narrow values before relying on their shape. Prefer an existing runtime schema API when available.
- Avoid any, unchecked type assertions, non-null assertions, and error-suppressing compiler options. Use a type assertion only when validation or a precise type cannot reasonably express the result.
- Test observable behavior. Diagnose whether failures indicate product regressions or stale expectations; do not weaken or skip assertions merely to pass.

## Documentation and licensing

- Keep the English, Chinese, Japanese and Korean READMEs consistent, and the English and Chinese changelogs consistent. READMEs cover product purpose, common usage, and development commands. Changelogs describe user-visible features and fixes; keep implementation details in docs/.
- README and changelog entries are user-facing and written as UX only: describe what users can see and do; never include implementation details or anything only a developer would know (that belongs in docs/). If end users cannot perceive something, do not write it; if you are unsure whether they can perceive it, leave it out.
- Scope each changelog release by blaming the changelog: it covers the commits made since the previous changelog revision. Walk that history and write an entry only for what end users can perceive in those commits.
- Structure every changelog release section with Added and Fixed headings (Keep a Changelog style).
- Keep claims supported by evidence. Report unavailable oracle fixtures as skipped, not passed; do not describe unverified compatibility as verified.
- Preserve LICENSE and NOTICE. MIT applies only to material contributors may license; it does not relicense original-derived code or third-party dependencies.

## Version and About

- The root package.json version is the only editable application version. Derive About text, the Tauri bundle metadata, and installer/archive names from it. Third-party library versions are not application versions.
- To change the version, run npm version <major.minor.patch> --no-git-tag-version --ignore-scripts, update both changelogs, then run npm run check:version. This does not create a commit or tag.
- About displays the application version, full source commit, and fixed UTC build time. Generate and bundle this metadata at build time; do not query Git or the network at runtime. Mark builds made from a modified working tree. See docs/VERSIONING.md.

## Validation and CI

- Use Node.js 24 and npm. Use npm ci for a clean dependency install; do not rely on stale build output.
- UI tests independently launch low (1280×720, DPR 1) and high (1920×1080, DPR 2) profiles against the production web output. Verify native scale and menu visibility, isolate temporary user data, enforce a separate 30-second hard timeout per profile, and clean up spawned processes before the next profile. Use a loopback server. Compare fractional DPR values with a numeric tolerance while checking canvas sizes. Native Tauri window testing additionally requires the real bundles and must not be claimed from browser profiles alone.
- Run checks appropriate to the change. Before reporting a complete application build, run typecheck, unit tests, UI profiles, and archive validation. If a required build or test fails, stop downstream packaging and diagnose it. Never claim an untested platform passed.
- CI covers branch pushes and pull requests. Follow the current workflow and docs/CI.md for platform details and archive formats. Upload build archives and failure diagnostics as workflow artifacts. Do not add CD, deployment, or GitHub Release publishing unless requested.

## Commit messages

- Use Conventional Commits: <type>(optional-scope): <imperative summary>. Keep subjects concise and describe the change.
- Keep messages to the single subject line. Write a body only when it is genuinely necessary to explain the change; the default is one line.
- Choose the most specific type: feat for user functionality, fix for behavior defects, docs for documentation, test for tests, refactor for behavior-preserving restructuring, perf for performance, build for build and packaging, ci for CI, and chore for other maintenance.
- Use ! or a BREAKING CHANGE: footer only for an actual breaking change.
