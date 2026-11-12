# Original BMH format contract

The compatibility target is the Windows release of Be-Music Helper beta 4′ by exclusion.
The reference checkout is `A:\bmhelper\bmhelper_b4p`.
The `.bmh` contract is locked alongside `.wos`. DX projects and recovery sessions store Unicode data in UTF-8 JSON independently.
The earlier, unreleased application encoding is not supported.

## Binary layout

Each chunk has a four-byte ASCII tag, a little-endian unsigned 32-bit payload length, and that many payload bytes.
There is no padding or terminator. Container payloads contain consecutive child chunks.
All numeric fields below are little-endian 32-bit integers.

| Container | Child | Payload |
| --- | --- | --- |
| `BMHP` | `Src ` | Source MIDI children. The trailing space is part of the tag. |
| `BMHP` | `Div `, repeated | One division per container. |
| `Src ` or `Midi` | `qntz` | Signed ticks per quarter note. |
| `Src ` or `Midi` | `note`, repeated | Signed position, gate, note number and velocity: 16 bytes per chunk. |
| `Src ` or `Midi` | `ptch`, repeated | Signed position and pitch value: 8 bytes per chunk. |
| `Src ` or `Midi` | `ccgh`, repeated | Signed position, value and controller number: 12 bytes per chunk. |
| `Div ` | `Midi` | Recording MIDI children. |
| `Div ` | `name` | Windows-31J (CP932) bytes, without a NUL terminator. |
| `Div ` | `s2df` | One signed definition index per source note. |
| `Div ` | `dfnt`, repeated | Unsigned low ZZ digit, unsigned high ZZ digit, signed recording-note index: 12 bytes per chunk. |

Empty event lists produce no event chunks. A sequence still contains `qntz`.
The controller tag is **`ccgh`**, including the original spelling.
The writer groups controller events by ascending controller number and preserves order within each group.
Each ZZ digit ranges from 0 through 35. The combined value is `high × 36 + low`.
The format does not store the session's ZZ/FF mode.

The Japanese original writes ANSI name bytes. Its saved Japanese fixture confirms CP932.
BMH export follows the original program's CP932 substitution and best-fit rules. DX retains the original Unicode names and shows a conversion warning.
Files from builds that use another ANSI code page are outside this verified target.

### Name limits and conversion

`DivisionSettingDialog` in `src/divview.cpp` uses a single-line `wxTextCtrl` without an explicit length limit or character validator.
`GetSetting` copies its value without trimming or character filtering. The two-character check in `OnOK` applies to the ZZ definition number, not the name.
`Division::write_tree` writes `name.size()` bytes into a variable-length chunk.
The chunk length is unsigned 32-bit. That field width does not establish a usable UI or memory limit.
The source does not specify the native text control's practical input limit.

There is no 255-byte name rule and no filename-character whitelist in this code.
The long-name fixture verifies a 2,058-byte name, including 1,024 Japanese characters and ` <>:"/\|?*`, through original-program open and save.
Division names and filesystem names are separate fields.
An embedded NUL cannot round-trip because the original reader assigns a NUL-terminated string.

The encoder supports CP932 mappings, including half-width kana and Windows extensions.
It uses the original Windows conversion behavior for unrepresentable UTF-16 code units: each unit becomes `?`.
Thus an emoji outside the BMP becomes `??`. Best-fit mappings can also change characters, such as `¥` to `\` and `é` to `e`.
The original program silently converted `A🎵B한C¥D〜E简F` to `A??B?C\D?E?F` when its name dialog was confirmed.
The saved fixture records the same bytes. Windows `WideCharToMultiByte(932, 0, ...)` reproduces them on this system (ACP 932).

`cp932-best-fit.ts` records the 85 non-identical mappings measured from that API over non-surrogate BMP characters.
To reproduce the table, convert each character with flags 0 and collect results where no default character was used but CP932 decoding changes the character.
Exact mappings come from the Web platform decoder's reverse table. The application has no runtime dependency on Windows conversion APIs.
Name conversion stops at NUL, matching the original's NUL-terminated handling.

Invalid byte sequences fail import. Lossy export continues with a localized warning showing the original and exported names.
Neither the DX document nor its unsaved state changes. A lossy BMH export does not mark the Unicode content as saved.
Users can save `.wosdx` to retain the original names, or rename a division before exporting again.

The reader rejects truncated chunks, incorrect known payload lengths and invalid definition references.
Unknown chunks are ignored, as in the original reader. Saving does not retain unknown chunks.

## Source evidence

- `src/serialize.h`: chunk headers, container traversal and native Windows integer storage.
- `src/project.cpp`: `BMHP`, `Src ` and `Div ` hierarchy.
- `src/midi_sr.cpp`: separate event chunks, field order and `ccgh` spelling.
- `src/midi_events.h`: signed event structures.
- `src/division.cpp`: recording, name, source mapping and repeated definitions.
- `src/common.h`: two unsigned ZZ digits and a signed definition index.

The original does not use Base64 and has no 32 MiB guard.
The application's project memory budget and the removed Base64 policy are documented in [PROJECT_FORMAT.md](PROJECT_FORMAT.md#limits-and-defaults).
Those budgets do not change the BMH binary layout.

## Verification

`tests/bmh-compatibility.test.ts` uses files saved by the original executable.
Fixture provenance and reproduction steps are in [the fixture README](../tests/fixtures/bmh/README.md).
Tests check original-file import, byte-identical export, event fields, Japanese names and invalid input.
The original Windows UI also opens and saves this application's exported file.
Self-round-trip tests alone do not establish original-program compatibility.
