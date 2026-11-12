# woslicer-dx

**English** · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

An offline audio slicer for BMS, based on wosderge's woslicerIII.

![Timeline](docs/screenshots/timeline.png)

## Features

- Import WAV and OGG and export WAV slices.
- Save and reopen `.wosdx` projects. Import or export legacy `.wos` settings and exchange markers with BMSE.
- Timeline editing with snapping, selection, quantization and undo/redo.
- Variable-speed monitoring, cue sounds and tap calibration.
- Frequency-band display and automatic cut detection.
- Built-in BMHelper: divide a key-sound MIDI part into a recording sequence with WAVE definitions, then apply its cut positions to the timeline.
- English, Chinese, Japanese and Korean UI; About shows version, commit and build date.

## Run

Download the package for your system from Releases (prereleases) or Actions artifacts:

| Platform | Package | Usage |
| --- | --- | --- |
| Windows | .zip | Extract the ZIP and run the app. Requires WebView2 |
| Linux | .deb / .AppImage | Install the deb or run the AppImage |
| macOS | .dmg | Open the disk image and drag the app to Applications |
| Web | .zip | Unpack and serve as a static website |

Windows x64 is the primary desktop package. Other Windows architectures, Linux and macOS packages are included when available. The application processes files locally and works offline.

The web version runs directly in the browser: [woslicer-dx app](https://woslicer-dx.pages.dev/) — no installation needed.

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
| Ctrl+O / Ctrl+Shift+O / Ctrl+S | Open audio / open a `.wosdx` project / save the project |
| T / Y | Import / export `.wos` settings |
| V / B | Write / read BMSE clipboard |

Left-drag paints cuts, right-drag erases, Shift/Ctrl+drag selects, and dragging a cut moves the selection. Ctrl+wheel zooms; middle-drag pans. Hold Alt to bypass snapping.

## Project links

[Changelog](CHANGELOG.md) · [Development guide](docs/DEVELOPMENT.md)

## License and credits

Original woslicer II/III: **wosderge**. Contributor-owned material uses [MIT](LICENSE); original-derived portions and third-party dependencies are excluded from that grant. See [NOTICE](NOTICE) for scope and attribution.

The built-in BMHelper reimplements the behavior of Be-Music Helper (beta 4′) using source code published by its author, **exclusion**. The original README permits secondary use when no money is involved and the author is credited. [Original BMHelper](https://excln.github.io/bmhelper.html) · [NOTICE](NOTICE)
