# woslicer-dx

**English** · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

An offline audio slicer for BMS, based on wosderge's woslicerIII.

![Main workspace](docs/screenshots/main-ui.png)

## Features

- Import WAV and OGG and export WAV slices. Source details show the original encoding. Audio processing and WAV output currently use 16-bit PCM.
- Save and reopen `.wosdx` projects. Import or export legacy `.wos` settings and exchange markers with BMSE.
- Timeline editing with snapping, selection, quantization and undo/redo.
- Variable-speed monitoring, cue sounds and tap calibration.
- Frequency-band display and automatic cut detection.
- Built-in BMHelper divides key-sound MIDI into a recording sequence with WAVE definitions. Apply its cut positions to the timeline.
- Open and save original BMHelper beta 4′ `.bmh` files. DX projects preserve Unicode division names. BMH export uses the original CP932 character substitutions and warns when names change.
- English, Chinese, Japanese and Korean UI. About shows the version, commit and build date.

## Run

Download the package for your system from Releases (prereleases) or Actions artifacts:

| Platform | Package | Usage |
| --- | --- | --- |
| Windows | .zip | Extract the ZIP. Run the app. WebView2 is required. |
| Linux | .deb / .AppImage | Install the deb or run the AppImage |
| macOS | .dmg | Open the disk image. Drag the app to Applications. |
| Web | .zip | Extract the ZIP. Serve the files as a static website. |

Windows x64 is the primary desktop package. Other Windows architectures, Linux and macOS packages are included when available. The application processes files locally and works offline.

Use the [web version](https://woslicer-dx.pages.dev/) directly in your browser. No installation is needed.

## Controls

Desktop projects store absolute audio paths and reconnect available files when opened. Use **Relink audio** after moving a file. Browsers require manual relinking. A banner shows session recovery and audio loading stages.

| Key | Action |
| --- | --- |
| Space | Play / pause |
| Enter / `,` / `.` | Add a cut at the playhead or cursor |
| Z | Toggle a cut at the cursor |
| Arrow keys | Move by grid / measure. Shift+Left/Right moves one tick. |
| P / O | Preview current / previous slice |
| Q / W | Decrease / increase grid density |
| `[` / `]` | Decrease / increase monitoring speed |
| Ctrl+C / X / V | Copy / cut / paste selected markers |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| M | Export all slices |
| Ctrl+O / Ctrl+Shift+O / Ctrl+S | Open audio / open a `.wosdx` project / save the project |
| T / Y | Import / export `.wos` settings |
| V / B | Write / read BMSE clipboard |

- Drag with the left button to add cuts.
- Drag with the right button to erase cuts.
- Hold Shift or Ctrl while dragging to select cuts.
- Drag a cut to move the selection.
- Use Ctrl+wheel to zoom.
- Drag with the middle button to pan.
- Hold Alt to bypass snapping.

## Project links

[Changelog](CHANGELOG.md) · [Development guide](docs/DEVELOPMENT.md)

## License and credits

Original woslicer II/III: **wosderge**. Contributor-owned material uses [MIT](LICENSE). This grant excludes portions derived from the original and third-party dependencies. See [NOTICE](NOTICE) for scope and attribution.

The built-in BMHelper reimplements Be-Music Helper (beta 4′). This implementation uses source code published by its author, **exclusion**. The original README permits secondary use when no money is involved and the author is credited. [Original BMHelper](https://excln.github.io/bmhelper.html) · [NOTICE](NOTICE)
