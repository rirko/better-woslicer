# woslicer-dx

**English** · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

An offline Electron/TypeScript audio slicer for BMS, based on wosderge's woslicerIII.

![Timeline](screenshots/timeline.png)

## Features

- WAV/OGG import, WAV slice export, `.wos` projects and BMSE clipboard support.
- Timeline editing with snapping, selection, quantization and undo/redo.
- Variable-speed monitoring, cue sounds and tap calibration.
- Frequency-band display and automatic cut detection.
- English, Chinese, Japanese and Korean UI; About shows version, commit and build date.

## Run

Download a build from the repository's Actions artifacts and extract it:

| Platform | Archive | Application |
| --- | --- | --- |
| Windows | `.7z` | `woslicer-dx.exe` |
| Linux | `.tar.xz` | `woslicer-dx` |
| macOS | `.zip` | `woslicer-dx.app` |

macOS CI builds are not notarized. The application processes files locally and does not require a network connection.

For source builds, use Node.js 24, npm and Git:

```sh
npm ci
node node_modules/electron/install.js
npm start
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
npm run typecheck
npm test
npm run build
npm run test:ui
npm run package
npm run test:ui:packaged
```

Audio is converted to 16-bit internally and exports use 16-bit PCM. Original-program comparison tests require external fixtures and are skipped when those are absent.

See [CI](docs/CI.md), [versioning](docs/VERSIONING.md) and [changelog](CHANGELOG.md).

## License and credits

Original woslicer II/III: **wosderge**. Contributor-owned material uses [MIT](LICENSE); original-derived portions and third-party dependencies are excluded from that grant. See [NOTICE](NOTICE) for scope and attribution.
