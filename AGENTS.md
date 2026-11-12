# Repository instructions

## Locked compatibility rule

- The existing `.wos` binary format is locked. Preserve its layout, field encoding, size and read/write compatibility. This is the only fixed project invariant; the remaining instructions are current defaults that may be revised to serve the user's goals and human maintainability.
- If a user instruction would change or override `.wos` compatibility, explain the exact format change and its compatibility impact, then obtain the user's explicit confirmation before implementing it. The initial conflicting instruction alone is not confirmation. Unrelated work may continue while confirmation is pending.

## Product boundaries

- Keep application runtime offline and user data local. Do not add telemetry, uploads, update checks, remote assets, cloud services, or links that launch an external browser.
- Preserve Tauri isolation and restrictive CSP in both release variants. Keep shell/open capabilities and broad IPC out of the app. Keep the default WebView installation behavior. External installers, build tools and dependencies may use the network. Test-only servers and DevTools must bind to loopback.
- Preserve LICENSE and NOTICE. MIT applies only to material contributors may license.

## Implementation and validation

- Follow existing module boundaries. Keep changes focused and preserve unrelated work. In TypeScript, keep strict checks enabled, validate external input at boundaries, and avoid `any`, unchecked assertions, non-null assertions and compiler suppressions.
- Test observable behavior. Use Node.js 26.x and npm. Run `npm ci` for clean installs. See [development commands](docs/DEVELOPMENT.md) and [CI](docs/CI.md).
- Local builds, Rust tests, Clippy and native UI checks default to debug and prioritize build speed; release must be selected explicitly. CI uses only release and prioritizes artifact size. Before reporting a complete build, run typecheck, unit tests, both browser UI profiles and archive validation. Diagnose failures before packaging. Report missing oracle fixtures as skipped and state the actual platform and coverage. Run each browser UI profile separately with isolated user data and a 30-second hard timeout. Check menu visibility, device scale and canvas size, using a numeric tolerance for fractional DPR. Browser checks do not verify the native window.
- CI runs on pushes to `main` and `dev` and on pull requests. Keep changes within the existing workflows unless the user requests deployment or publishing. Pushing, tagging and publishing require explicit authorization.

## Commit messages

- Use Conventional Commit types and write exactly one concise line in the form `genre(module): contents`.
- Include the module and summarize the change in the imperative mood. Omit the commit body and footers.

## Documentation and versioning

- Keep the English, Chinese, Japanese and Korean READMEs consistent. Keep README and changelog entries user-facing and put technical detail in `docs/`.
- Keep both changelogs consistent. Use Added and Fixed headings for each release. Use blame and commit history to scope entries to user-visible changes since the previous changelog revision.
- The root `package.json` is the only editable application version. Use `npm version <major.minor.patch> --no-git-tag-version --ignore-scripts`, update both changelogs and run `npm run check:version`.
- Bundle the app version, full commit, dirty-tree marker and fixed UTC build time at build time for About. See [versioning](docs/VERSIONING.md).
