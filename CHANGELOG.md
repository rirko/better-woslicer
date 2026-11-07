# Changelog

**English** · [中文](CHANGELOG.zh-CN.md)

## 0.2.0 — 2026-11-07

### Added

- Built-in BMHelper: import a key-sound MIDI part, divide it into a recording sequence with WAVE definitions, apply its cut positions to the timeline, and export the recording MIDI, cut positions, BMS sequence and WAV definition list. Based on exclusion's BMHelper (https://excln.github.io/bmhelper.html).

## 0.1.3 — 2026-11-06

### Added

- A browser version of the app is available as [woslicer-dx app](https://woslicer-dx.pages.dev/) — no installation needed.

### Fixed

- The Japanese interface now uses the original woslicerIII terminology, such as 切断位置 for cut markers and 出力 for export.

## 0.1.2 — 2026-11-05

### Added

- The product is renamed to **woslicer-dx**; the executable, folders, archives and window title follow.
- Downloads and installs are much smaller.
- The whole interface is translated in English, Chinese, Japanese and Korean, including status messages, file-dialog titles and file-type filters; the language selector shows each language's name in its own script and font.
- Japanese and Korean READMEs.

### Fixed

- Arrow Left now steps the cursor left, and the cursor line stays visible and follows the view while you scroll or zoom.
- Previewing a slice again replays it from the start instead of layering a second copy on top.
- Markers placed before loading audio are now visible on the timeline.
- Cycling the grid with Q/W keeps the Grid selector in step.
- Markers that are deleted no longer stay selected, so copy, cut and quantize keep working on markers that still exist.

## 0.1.1 — 2026-11-04

### Added

- About now shows the version, commit and build date to help identify your copy when reporting an issue.
- Portable packages include the complete OGG decoder, with no separate installation required.
- Download formats: `.7z` for Windows, `.tar.xz` for Linux, and `.zip` for macOS.
- Simplify the English and Chinese guides for installation and everyday use.

## 0.1.0 — 2026-11-02

### Added

- Introduce WAV/OGG import, timeline editing, WAV slice export, `.wos` projects and BMSE clipboard support.

## Fixed

- Fix grid spacing so the displayed lines, snapping and keyboard movement agree. Add Japanese and Korean interface and menu translations.
- Add English/Chinese interface options, tap calibration, frequency-band display and automatic cut detection.
