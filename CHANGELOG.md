# Changelog

**English** · [中文](CHANGELOG.zh-CN.md)

## 1.0.0 — 2026-11-11

### Added

- Save and reopen `.wosdx` projects with cuts, settings and BMHelper work. Moved audio files can be linked again.
- Open multi-track projects for viewing and save the original file unchanged.
- Import `.wos` timing and cuts into the current project or use them to start a new one.
- Import saved sessions from older versions, with a preview before replacing your work.

### Fixed

- 32-bit WAV files now show their original bit depth and format. Processing and output remain 16-bit.
- The app keeps damaged recovery files until you agree to discard them. Failed recovery saves show a warning and keep your work ready to retry.

## 0.3.0 — 2026-11-08

### Added

- Light, dark and system themes. Interface language can also follow the system.
- Restore the previous session on launch, including audio, cuts and settings.
- Close the current audio and clear unsaved work after confirmation.
- Inspect individual samples when zooming in, and toggle the RMS waveform overlay.

### Fixed

- Dense waveforms stay readable when zooming and on high-resolution screens.

## 0.2.1 — 2026-11-07

### Added

- Adjust playback and slice-preview volume, with levels shown in dB.

### Fixed

- Cuts at the audio's end export correctly. Slice tails no longer produce a reversed echo there.

## 0.2.0 — 2026-11-07

### Added

- Built-in BMHelper turns key-sound MIDI into recording sequences and cuts, with MIDI and BMS export.

## 0.1.3 — 2026-11-06

### Added

- Use the [browser version](https://woslicer-dx.pages.dev/) without installing the app.

### Fixed

- Japanese interface terms match the original woslicerIII.

## 0.1.2 — 2026-11-05

### Added

- Renamed the app to **woslicer-dx**.
- English, Chinese, Japanese and Korean interface options.

### Fixed

- The left arrow moves the cursor left. Scrolling and zooming keep the cursor visible.
- Replaying a slice starts it again without overlapping the previous playback.
- Cuts placed before loading audio appear on the timeline.
- Q/W grid changes update the grid selector.
- Deleted cuts no longer interfere with copying, cutting or quantizing the selection.

## 0.1.1 — 2026-11-04

### Added

- About shows version and build details for reporting problems.
- Portable packages play OGG files without an extra installation.

## 0.1.0 — 2026-11-02

### Added

- Import WAV/OGG, edit cuts on the timeline and export WAV slices.
- Import/export `.wos` settings and copy cuts to BMSE.
- Tap calibration, frequency-band display and automatic cut detection.

### Fixed

- Grid lines, snapping and keyboard movement agree.
