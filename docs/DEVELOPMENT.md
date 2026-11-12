# Development guide

## Repository layout

- `src/` contains the Vue interface, audio processing and project logic.
- `src-tauri/` contains the native desktop host, permissions and bundle configuration.
- `tests/` contains unit, component and browser tests, along with their runner configuration.
- `scripts/` contains build, packaging and verification commands.

## Commands

Install Node.js 26.x, npm and Git. For desktop work, also install stable Rust and the Tauri system dependencies for your platform. Windows uses WebView2 and Linux needs WebKitGTK and the corresponding system development packages. The [desktop build action](../.github/actions/build-desktop/action.yml) lists the Linux packages used by CI.

Start the browser development server with:

```sh
npm ci
npm run dev
```

Run the local checks and build with:

```sh
npm run lint
npm run fmt:check
npm run typecheck
npm test
npm run build
npm run test:app-ui
npm run package
```

`build`, `build:app` and `build:app:tauri` default to debug locally.
`package` produces debug native host bundles, and `npm run tauri -- build`
also defaults to debug. Select release explicitly when needed:

```sh
npm run build -- --release
npm run build:app:tauri -- --release
npm run package -- --release
npm run tauri -- build --release
```

The build scripts also accept `WOSLICER_BUILD_PROFILE=debug` or `release`.
Local Rust checks and tests use Cargo's default dev/test profiles; add
`--release` explicitly to run release checks or tests. JavaScript unit tests
do not have a Cargo compilation profile. UI tests exercise the static output
from the preceding build, which is debug locally unless release was selected.

Debug frontend output still comes from `vite build`, with the same offline
CSP and application behavior; it skips JS/CSS minification and compressed-size
reporting. Release frontend output minifies JS/CSS and omits source maps.
Rust release builds use `opt-level = "z"`, LTO, one codegen unit and symbol
stripping. Panic unwinding remains enabled so tests and bundles can reuse
compatible release dependencies. These settings prioritize size, without
promising a fixed reduction for every platform.

Lint and format checks run on the whole managed scope and must pass with zero
findings; CI runs them right after `npm ci` and before any build. Local commits
run staged-file lint/format checks through the pre-commit hook, so a clean
working tree is expected before committing.
Typecheck covers Vue and core test sources; tests cover components and core.
The original-program oracle tests look for external fixtures in the root `woslicerIII/` directory. Missing fixtures are reported as skipped.

The UI wrapper starts separate Playwright processes for low (1280×720, DPR 1)
and high (1920×1080, DPR 2) against the built static dist/app on loopback. Each has
a 30-second outer deadline that kills the process tree. Playwright closes
its browser contexts and server between profiles. Install Chromium using
npm exec --no -- playwright install chromium.

`npm run test:tauri-ipc` is a Windows-local desktop IPC health check against
the debug executable by default. Use `npm run test:tauri-ipc -- --release`
to check an explicitly built release executable.

`npm run test:tauri-ui` drives the real Tauri window through the WebView2 CDP
transport on a dynamic loopback port, one low profile (1280×720 css viewport
at the host's natural device scale) and one high profile (1920×1080 physical
window at device scale 2), each with an isolated per-run app-data root, a
30-second hard deadline and full process-tree cleanup. It verifies the
application menu bar visibility, devicePixelRatio, canvas-to-DPR size
relationships and captures per-profile screenshots under
`test-artifacts/tauri-ui/`. It requires the release executable
built with the following commands. On non-Windows hosts the profiles report skipped.

```sh
npm run build:app:tauri -- --release
cargo build --release --manifest-path src-tauri/Cargo.toml
npm run test:tauri-ui
```

## References

- [CI and release workflows](CI.md)
- [Application versioning](VERSIONING.md)
- [Project format](PROJECT_FORMAT.md)
- [Original woslicerIII behavior](EXTRACTED_SPEC.md)
