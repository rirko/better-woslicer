# CI and local commands

## Commands

```
npm run typecheck
npm test
npm run build
npm run package
```

`typecheck` runs the Vue/Tauri application (`vue-tsc`) and the core test
sources (`tsc`). `test` runs the Vue/component Vitest suite and the core Node
test suite (`node --test` over `dist/tests`, compiled from `tests/*.ts`
against `src/core`; original-program oracle tests skip when their external
fixtures are absent). `build` produces the product web output (`dist/app`)
with the root version gate and build identity checks. `package` builds the
Tauri frontend variant (`dist/app-tauri`, whose CSP allows the ipc custom
protocol) and runs `tauri build` for the host platform's bundles (WiX/NSIS on
Windows, deb/AppImage on Linux — bundler tooling downloads at build time
only).

`npm run test:app-ui` exercises the production web output at two native
profiles (1280×720/DPR 1 and 1920×1080/DPR 2) in Chromium over a loopback
server. `npm run test:tauri-ipc` is a Windows-local desktop health check: it
drives the built executable's WebView2 over CDP and asserts that raw command
responses arrive as ArrayBuffer through the fetch-based IPC transport (it
resolves the executable from `CARGO_TARGET_DIR` or `src-tauri/target/release`
and skips cleanly on non-Windows platforms). Native window-level UI testing
for the Tauri shell is still pending (see docs/migration/IMPLEMENTATION.md).

## Workflow

`.github/workflows/build.yml` runs on pushes to `main` and `dev`, on pull
requests, and on manual dispatch. There is no CD and no release publishing
workflow.

The `verify` job runs on real Ubuntu 24.04 (CI never uses WSL) and checks the
whole tree: typecheck, both test suites, `cargo fmt`/`cargo test
--locked`/`cargo clippy -D warnings` for the Tauri shell, the product web
build, and the two web UI profiles (Chromium is installed in the job). The
`windows-x64` and `linux-x64` jobs build the real Tauri bundles (`npm run
package`) after the product build and tests, and upload the bundles (`.msi` +
NSIS `.exe` on Windows, `.deb` + `.AppImage` on Linux) as workflow artifacts.
Linux jobs install the Tauri system dependencies (webkit2gtk-4.1, GTK3,
ayatana appindicator, librsvg, patchelf); Rust comes from the runners' rustup
with the stable toolchain. Other platforms (macOS, ARM variants) are not
built or claimed until they are actually validated.
