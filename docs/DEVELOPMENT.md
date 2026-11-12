# Development guide

## Repository layout

- `src/` contains the Vue interface, audio processing and project logic.
- `src-tauri/` contains the native desktop host, permissions and bundle configuration.
- `tests/` contains unit, component and browser tests, along with their runner configuration.
- `scripts/` contains build, packaging and verification commands.

### Finding a UI behavior

| UI area | Entry point and behavior owner |
| --- | --- |
| Application menu | `src/app/components/ApplicationMenu.vue` renders `src/app/menu.ts`, which owns the menu entries, command type and availability. `src/app/commands.ts` dispatches actions and keyboard shortcuts. |
| Waveform | `src/timeline/TimelineEditor.vue` owns the canvas lifecycle; `gestures.ts` handles pointer edits and `render.ts` draws the timeline. |
| Cut list | `src/slicing/MarkerList.vue` owns selection controls; `editor-actions.ts` implements marker operations. |
| Project open/save | `src/workspace/workspace.ts` coordinates file operations and recovery; `persistence.ts` serializes recovery writes. `src/project/schema.ts` defines Zod field schemas and derives document types; `codec.ts` owns version compatibility, normalization and business validation. |
| Playback | `src/playback/PlaybackControls.vue` owns controls; `index.ts` manages audio playback and cleanup. |
| Document/output settings | `src/app/components/DocumentOptions.vue` and `src/export/OutputPanel.vue` read reactive editor projections and write undoable transactions through `src/slicing/editor-store.ts`. |
| Language/theme and dialogs | `src/app/components/PreferencesControls.vue` uses `src/ui/preferences.ts`. About lives beside the toolbar; calibration lives in `src/calibration/CalibrationDialog.vue`. |

`src/app/App.vue` assembles these features and owns project-replacement confirmations.
UI consumers read the editor's reactive document projections directly; revision
checks are for detecting stale asynchronous work and gestures. Platform file
access stays in `src/platform/`, and audio worker processing stays in `src/audio/`.

### Input, commands and platform boundaries

Discrete user intents follow input → command → feature action. Keyboard shortcuts
and menu buttons share `src/app/commands.ts`; the feature action owns document
validation, undo and playback behavior. Continuous pointer gestures and local
form edits stay with their feature rather than routing every movement through a
global dispatcher. Platform capabilities are used only when an action needs
files, clipboard, recovery storage or other host services.

Gamepad and dedicated BMS controller adapters are not implemented. When added,
map device events to the same intents and actions; keep device polling, focus
rules and connection lifetime in the input adapter. Choose a native adapter only
when the actual device protocol requires it, rather than introducing a general
hardware framework in advance.

Web and Tauri share the Vue interface, editing rules and audio worker. The Rust
host in `src-tauri/src/` handles native file access and transfers (`files.rs`),
clipboard interoperability (`clipboard.rs`), recovery storage (`session.rs`) and
window setup (`lib.rs`). It does not implement audio processing or editing rules.

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
npm run build:app:tauri
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked --all-features
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features -- -D warnings
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
reporting. Static builds omit source maps to reduce build work; use the Vite
development server for source debugging. Rust dev/test builds use no optimization,
no debug symbols, no LTO, incremental compilation and 256 codegen units to favor
compile/link speed. Debug assertions and overflow checks remain enabled. For native
source debugging, set `CARGO_PROFILE_DEV_DEBUG=2` explicitly.
Release frontend output minifies JS/CSS and omits source maps.
Rust release builds use `opt-level = "z"`, LTO, one codegen unit and symbol
stripping. Panic unwinding remains enabled so tests and bundles can reuse
compatible release dependencies. These settings prioritize size, without
promising a fixed reduction for every platform.

The release settings are independent of audio precision: decoding, DSP and WAV
encoding run in TypeScript, and the OGG decoder is prebuilt WASM. Rust profile
changes optimize the native host, not those algorithms.
`strip = "symbols"` is equivalent to `strip = true`; it removes symbol information
without changing normal error handling. Keep separate symbols when native crash
symbolication is required. `panic = "abort"` is a separate failure-policy choice:
it terminates the process on a Rust panic, skips stack unwinding and prevents
`catch_unwind` recovery. Ordinary `Result` errors still behave normally. Standard
Cargo tests require unwind, so abort application builds may need a second set of
compiled dependencies. Unwind permits cleanup and catch boundaries but does not
guarantee that the application survives every panic.
Fat LTO and one codegen unit favor cross-crate optimization at the expense of
build parallelism and link time. Evaluate `s`, thin LTO and more codegen units as
a combination using identical frontend assets; compare compressed package size
as well as executable size. See [Cargo profiles](https://doc.rust-lang.org/cargo/reference/profiles.html).


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
`test-artifacts/tauri-ui/`. It defaults to the debug executable built with the
following command. Tauri embeds static assets in debug builds too; plain
`cargo build` without `custom-protocol` instead requires the development server.
Use `--release` on both commands to check a release build explicitly.
On non-Windows hosts the profiles report skipped.

```sh
npm run tauri -- build --no-bundle
npm run test:tauri-ui
```

## References

- [CI and release workflows](CI.md)
- [Application versioning](VERSIONING.md)
- [Project format](PROJECT_FORMAT.md)
- [Original woslicerIII behavior](EXTRACTED_SPEC.md)
