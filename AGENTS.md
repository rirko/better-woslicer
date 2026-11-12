# Repository instructions

## Locked compatibility rule

- The existing `.wos` binary format is locked. Preserve its layout, field encoding, size and read/write compatibility.
- This is the only fixed project invariant. Other instructions are defaults that may change to support user goals and human maintenance.
- If a user instruction would change `.wos` compatibility, explain the exact change and its compatibility effects. Obtain explicit user confirmation before implementation. The initial conflicting instruction does not count as confirmation. Continue unrelated work while confirmation is pending.

## Product boundaries

- Keep the application offline and user data local. Do not add telemetry, uploads, update checks, remote assets or cloud services. Do not add links that open an external browser.
- Preserve Tauri isolation and the restrictive content security policy (CSP) in both release variants. Do not add shell/open capabilities or broad inter-process communication (IPC) access. Keep the default WebView installation behavior.
- External installers, build tools and dependencies may use the network. Bind test servers and DevTools to loopback addresses.
- Preserve LICENSE and NOTICE. MIT applies only to material that contributors have the right to license.

## Implementation and validation

- Follow existing module boundaries. Keep changes focused. Preserve unrelated work.
- Keep TypeScript strict checks enabled. Validate external input at boundaries. Avoid `any`, unchecked assertions, non-null assertions and compiler suppressions.
- Test observable behavior. Use Node.js 26.x and npm. Use `npm ci` for clean installs. See the [development guide](docs/DEVELOPMENT.md) and [CI guide](docs/CI.md).
- Default to debug for local builds, Rust tests, Clippy and native UI checks. Prioritize local build speed. Select release explicitly when needed. CI uses release only and prioritizes artifact size.
- Before reporting a complete build, run typecheck, unit tests, both browser UI profiles and archive validation. Diagnose failures before packaging. Report missing oracle fixtures as skipped. State the platform and actual test coverage.
- Run each browser UI profile separately with isolated user data and a 30-second hard timeout. Check menu visibility, device scale and canvas size. Use a numeric tolerance for fractional device pixel ratios (DPR). Browser checks do not check the native window.
- CI runs on pushes to `main` and `dev` and on pull requests. Keep changes within existing workflows unless the user requests deployment or publishing. Obtain explicit authorization before pushing, tagging or publishing.

## Commit messages

- Use one concise Conventional Commit line: `genre(module): contents`.
- Include the module. Describe the change in the imperative mood. Do not add a body or footers.

## Documentation and versioning

- Maintain the root README in English, Chinese, Japanese and Korean. Keep user-facing content consistent across all four languages.
- Maintain the changelog in English and Chinese only. Keep release entries consistent across both languages.
- Include only changes that end users can see, interact with or hear. Keep entries brief. Describe the effect on everyday use.
- Omit implementation choices, dependencies, developer tooling, internal refactors, documentation maintenance and minor optimizations. If unsure whether users care about a change, omit it.
- Use Added and Fixed sections when applicable. Translate these headings in Chinese. Omit empty sections. Use blame and commit history to place changes in the appropriate release. Do not present old behavior as new.
- Write `docs/` in English by default. Put architecture, formats, build/release procedures and other developer details there. Do not maintain translated copies of technical documents.
- Keep original-language quotations or UI labels only when needed as reference evidence. Add an English explanation.
- Use [ASD-STE100 guidance](.agents/skills/asd-ste100/SKILL.md) for English descriptions and instructions. Prefer short sentences, explicit actors and consistent terms. Preserve conditions, limits and uncertainty.
- Apply the same clarity principles to Japanese and Korean descriptions. Keep natural grammar and established UI terms in each language. Do not apply English word-count rules to other languages. Use [Chinese technical writing](.agents/skills/zh-tech-writing/SKILL.md) for Chinese.
- The root `package.json` contains the only editable application version. Use `npm version <major.minor.patch> --no-git-tag-version --ignore-scripts`. Update both changelogs. Run `npm run check:version`.
- Bundle the version, full commit, dirty-tree marker and fixed UTC build time for About. See the [version policy](docs/VERSIONING.md).

## Project skills

- Use the relevant skills in [`.agents/skills/`](.agents/skills/README.md). Load only the skills needed for the task.
- Repository constraints and explicit user instructions take precedence over generic skill advice. Prioritize human maintenance when choosing between valid implementations.
- Keep upstream skills at their recorded submodule commits. Do not edit upstream files for project-specific rules.
- Initialize missing submodules with the [setup guide](docs/SKILLS.md). Read the skill catalog for companion-skill references.
