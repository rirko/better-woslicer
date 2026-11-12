# woslicer-dx

**English** · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

An offline audio slicer for BMS, based on wosderge's woslicerIII.

![Timeline](screenshots/timeline.png)

## Features

- WAV/OGG import, WAV slice export, `.wos` projects and BMSE clipboard support.
- Timeline editing with snapping, selection, quantization and undo/redo.
- Variable-speed monitoring, cue sounds and tap calibration.
- Frequency-band display and automatic cut detection.
- Built-in BMHelper: divide a key-sound MIDI part into a recording sequence with WAVE definitions, then apply its cut positions to the timeline.
- English, Chinese, Japanese and Korean UI; About shows version, commit and build date.

## Run

Download the package for your system from Releases (prereleases) or Actions artifacts:

| Platform | Package | Usage |
| --- | --- | --- |
| Windows | .msi / -setup.exe | Run the installer |
| Linux | .deb / .AppImage | Install the deb or run the AppImage |
| Web | .zip | Unpack and serve as a static website |

Windows x64 is the primary desktop package. Other architectures and Linux packages are included when available. The application processes files locally and works offline.

The web version runs directly in the browser: [woslicer-dx app](https://woslicer-dx.pages.dev/) — no installation needed.

For source builds, use Node.js 26.x, npm, Git and the Rust stable toolchain; the Tauri bundler also needs its per-platform tooling (WebKit/GTK packages on Linux, WebView2 on Windows):

```sh
npm ci
npm run dev
```

## Controls

| Key | Action |
| --- | --- |
| Space | Play / pause |
| Enter / `,` / `.` | Add a cut at the playhead or cursor |
| Z | Toggle a cut at the cursor |
| Arrow keys | Move by grid / measure; Shift+Left/Right moves one tick |
| P / O | Preview current / previous slice |
| Q / W | Decrease / increase grid density |
| `[` / `]` | Decrease / increase monitoring speed |
| Ctrl+C / X / V | Copy / cut / paste selected markers |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| M | Export all slices |
| T / Y | Save / load `.wos` |
| V / B | Write / read BMSE clipboard |

Left-drag paints cuts, right-drag erases, Shift/Ctrl+drag selects, and dragging a cut moves the selection. Ctrl+wheel zooms; middle-drag pans. Hold Alt to bypass snapping.

## Development

```sh
npm run lint
npm run fmt:check
npm run typecheck
npm test
npm run build
npm run test:app-ui
npm run package
```

Local builds and tests default to debug. For a release build, run `npm run build -- --release` or `npm run package -- --release`. CI uses release only.

Commits run lint and format checks on staged files through a pre-commit hook.

Audio is converted to 16-bit internally and exports use 16-bit PCM. Original-program comparison tests require external fixtures and are skipped when those are absent.

See [CI](docs/CI.md), [versioning](docs/VERSIONING.md) and [changelog](CHANGELOG.md).

## License and credits

Original woslicer II/III: **wosderge**. Contributor-owned material uses [MIT](LICENSE); original-derived portions and third-party dependencies are excluded from that grant. See [NOTICE](NOTICE) for scope and attribution.
