# Changelog

**English** · [中文](CHANGELOG.zh-CN.md)

## 1.0.0 — 2026-11-11

### Added

- The installer shrinks to about 5 MB while the workspace inside stays the same. The browser version continues to work as before.
- Projects can now be saved as a file and reopened: your cuts, timing, processing settings, output names, playback settings and BMHelper divisions all live in one .wosdx file. If the audio has moved, the project still opens and asks you to pick the audio again.
- Project files that contain several tracks open for viewing, with a note about what is not available; saving keeps the file exactly as it was opened.
- Importing a .wos file is now two separate menu actions: start a new project from it, or bring only its timing and cuts into the project you have. Exporting a .wos file makes clear that it contains timing and cuts only.
- Playback settings — monitor and cue volume, playback speed, cue sound, the RMS and band overlays — are saved with the project and come back with it; undo covers them too.
- If a project file contains parts this version cannot read, the app says so when opening; saving keeps the parts it understands.
- A menu entry can import a saved session from an older version, showing what it contains before anything is replaced.

### Fixed

- Source details now show the original WAV bit depth and distinguish integer PCM from floating point; the separate processing/output row shows the current 16-bit limit.

- If the session archive is damaged, the app now keeps the original file and explains the problem instead of silently starting over; it is only discarded after you agree.
- If the session archive cannot be written, the app says so in the status bar and keeps your latest work ready to retry instead of quietly losing it.

## 0.3.0 — 2026-11-08

### Added

- Color themes: Light, Dark and System, next to the language selector. The System choice follows the operating system live.
- The interface language can follow the system language automatically — the language selector gains an Auto choice.
- The session is restored on launch: window size and position, your options, the selected tab, the markers you were cutting with and the last opened file. A file that has gone missing is reported in the status bar.
- A Close button next to Open: after a confirmation it clears the opened file and all unsaved work, including the session archive.
- The waveform is drawn in two tones — a light peak envelope with a darker RMS band inside — and stays detailed at every zoom, down to the individual samples: a connected curve at mid zooms and one stem per sample at the deepest zoom.
- An RMS layer toggle (left of the Bands button, off by default); turning Bands on turns the RMS layer off and locks its toggle while the band overlay is shown.
- Band overlay lines are smoother.
- Monitor playback defaults to −10 dB and the cue to −6 dB.

### Fixed

- Dense audio no longer renders as a solid block: the waveform is drawn per device pixel on high-DPI screens and stays sharp at mid-range zooms instead of blurring.

## 0.2.1 — 2026-11-07

### Added

- A monitor volume slider (left of the Bands toggle) for playback and slice previews; every volume slider now shows its level in dB in the status bar while dragging.

### Fixed

- Cuts at the edge of the audio: cuts beyond the end are rejected, a cut exactly at the end exports a valid zero-duration WAV instead of a garbage stub, slice tails no longer fabricate a reversed echo at the end of the file, and the region beyond the audio is hatched with a marked boundary line.
- The "cut already exists" message now names the measure and states that nothing was changed.

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
