# Original BMHelper fixtures

These fixtures contain synthetic test data, not user music.
They were saved with the original Windows Be-Music Helper beta 4′ executable on 2026-11-13.
The executable and original source are not redistributed here.

Reference executable: `A:\bmhelper\bmhelper_b4p\bmhelper.exe`

SHA-256: `ecda98509e21ab2878937592bdbdd11d654dac0c2aac56df5435245e608f69e1`

## `source.mid` and `original.bmh`

`source.mid` is a generated format-0 MIDI file with 480 ticks per quarter note.
All events use channel 1. Notes are:

| Position | Gate | Note | Velocity |
| -------- | ---- | ---- | -------- |
| 0        | 480  | 60   | 100      |
| 480      | 480  | 64   | 90       |
| 960      | 480  | 60   | 100      |

The MIDI also contains pitch bend at tick 120 and controllers at ticks 240 and 720.
The original program's default MIDI import retains only the three notes.

To reproduce `original.bmh`:

1. Start the original executable and use Ctrl+N to import `source.mid`.
2. Keep track 0000 and all channels selected.
3. Create a division named `コード分割` (Japanese for “chord division”). Keep the default settings.
4. Save as `original.bmh` with Ctrl+Shift+S.

The result has three source notes, two recording notes and two definitions.
Its name bytes are `83 52 81 5b 83 68 95 aa 8a 84` (CP932).

SHA-256: `9b15ab7eb1da1e50c503586af4120dfe7bbddbe8c55afde1c704b043965eb09a`

## `original-events.bmh`

This fixture checks the opposite direction: the original program opened a file exported by this application, then saved it again.
The original UI showed three source notes and both divisions, including the Japanese name.
All 538 bytes of its saved output matched the application export.

Start from the decoded `original.bmh` and add these source events:

- Pitch: `(position: 120, value: 2048)`, `(position: 960, value: -4096)`.
- CC 1: `(position: 240, value: 64)`, `(position: 960, value: 0)`.
- CC 7: `(position: 720, value: 100)`.

Add a second division named `copy` with original-sequence copying enabled and a 240-tick head margin.
Use the remaining defaults from `defaultDivisionSetting('copy', 480)`.
Export BMH, open it in the original program with Ctrl+O, then save as `original-events.bmh` with Ctrl+Shift+S.
The compatibility test reconstructs this input independently of the checked-in output bytes.

SHA-256: `430f469f4abc304b65eff35a336b8798134397ca256d0f815b62ffa6a2f65a2c`

## `original-long-name.bmh`

Start from `original.bmh`. Replace the division name with `分` repeated 1,024 times followed by ` <>:"/\|?*`.
Export with this application, open in the original program and save under this fixture name.
The original saved all 2,302 file bytes unchanged. Its name payload contains 2,058 bytes.
This verifies that file loading and saving impose neither a 255-byte name limit nor Windows filename-character restrictions.
It does not establish the native text control's maximum typed-input length.

SHA-256: `e123763838dd4c424cfbf8d6d641ae5aaec531492ab52ed6ad0b4b322ce53dbc`

## `original-lossy-name.bmh`

Open `original-long-name.bmh` in the original program. Add a division with the default settings and enter `A🎵B한C¥D〜E简F` as its name.
The text control initially displays Unicode. Confirming the dialog silently changes the name to `A??B?C\D?E?F`.
Save as `original-lossy-name.bmh`. The new name payload is `41 3f 3f 42 3f 43 5c 44 3f 45 3f 46`.
Windows `WideCharToMultiByte(932, 0, ...)` produces these same bytes. The host's ANSI code page was 932.
The application reproduces the file while reporting the name change and retaining its Unicode source.

SHA-256: `4925a42fca9459ec5e2959abd0c1c0625d5d129359b7818a2c26d6ba130b36a8`
