# Repository instructions

These rules apply to all work in this repository. Keep this file in English.

## Product security

- This is an offline desktop audio editor. Do not add application features or runtime dependencies that access the public Internet or other external networks, including telemetry, crash uploads, update checks, cloud services, remote assets, or links that launch an external browser.
- Keep user audio, projects, preferences, and other user data local. Preserve Electron isolation and the restrictive Content Security Policy.
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

- The root package.json version is the only editable application version. Derive About text, package metadata, platform version resources, and archive names from it. Keep Electron's runtime version separate.
- To change the version, run npm version <major.minor.patch> --no-git-tag-version --ignore-scripts, update both changelogs, then run npm run check:version. This does not create a commit or tag.
- About displays the application version, full source commit, and fixed UTC build time. Generate and bundle this metadata at build time; do not query Git or the network at runtime. Mark builds made from a modified working tree. See docs/VERSIONING.md.

## Validation and CI

- Use Node.js 24 and npm. Use npm ci for a clean dependency install; do not rely on stale build output.
- UI tests independently launch low (1280×720, DPR 1) and high (1920×1080, DPR 2) profiles. Verify native scale and menu visibility, isolate temporary user data, enforce a separate 30-second hard timeout per profile, and clean up the full Electron process tree before the next profile. Use an OS-assigned loopback DevTools port. Compare fractional DPR values with a numeric tolerance while checking canvas sizes.
- Run checks appropriate to the change. Before reporting a complete application build, run typecheck, unit tests, UI profiles, and archive validation. If a required build or test fails, stop downstream packaging and diagnose it. Never claim an untested platform passed.
- CI covers branch pushes and pull requests. Follow the current workflow and docs/CI.md for platform details and archive formats. Upload build archives and failure diagnostics as workflow artifacts. Do not add CD, deployment, or GitHub Release publishing unless requested.

## Commit messages

- Use Conventional Commits: <type>(optional-scope): <imperative summary>. Keep subjects concise and describe the change.
- Keep messages to the single subject line. Write a body only when it is genuinely necessary to explain the change; the default is one line.
- Choose the most specific type: feat for user functionality, fix for behavior defects, docs for documentation, test for tests, refactor for behavior-preserving restructuring, perf for performance, build for build and packaging, ci for CI, and chore for other maintenance.
- Use ! or a BREAKING CHANGE: footer only for an actual breaking change.
