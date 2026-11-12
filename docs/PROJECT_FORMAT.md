# `.wosdx` project format

This document describes the v1 fields, compatibility rules and local media bindings.
[codec.ts](../src/project/codec.ts) and [schema.ts](../src/project/schema.ts) define the implementation.

## Format and validation

- `.wos` is the locked, 6,168-byte settings exchange format implemented in `src/core/wos.ts`. Do not add fields or change its encoding.
- Original `.bmh` compatibility is also locked. The [BMH format contract](BMH_FORMAT.md) applies at import and export. DX uses UTF-8 JSON internally.
- `.wosdx` is bounded UTF-8 JSON with `format: "wosdx"` and `schemaVersion: 1`.
- The schema version is independent of the application, session and Rust crate versions.
- Audio is not embedded. Projects store media metadata and origin hints. Projects may embed BMHelper data.

`decodeProject`, `parseProject` and `encodeProject` are the codec entry points.
Parsing checks the format and version before applying v1 validation. Future
versions take a separate path and are never interpreted as v1.

`schema.ts` defines field shapes, ranges and enums with Zod and derives document
types from them. It does not coerce strings, numbers or booleans. String limits
count UTF-16 code units. `codec.ts` validates duplicate IDs, media references,
clip ranges, the total clip count and duplicate marker ticks. Add field rules
to the schema and cross-field business rules to the codec. The parser rejects invalid UTF-8, JSON, format identifiers or v1 data.

## v1 fields

| Path | Meaning |
| --- | --- |
| `projectId`, `name` | Stable project ID and display name. Decoding or recovering media must not replace the ID. |
| `timing.bpm`, `timing.shiftTicks` | BPM and offset in ticks, not seconds or source frames. |
| `slicing.fadeoutMs` | Integer milliseconds. |
| `slicing.noisegateDb`, `slicing.noisegateEnabled` | Threshold in dB and a separate enable flag. |
| `slicing.markers` | Ticks at 192 ticks per measure, from 0 through 49,151. The codec sorts ticks and rejects duplicates. |
| `slicing.bandDetection` | `bands {low,mid,high}`, `thresholdDb`, `minGapUnits`, `snap`. Detection settings are separate from waveform visibility. |
| `output` | `baseName`, `clipStartNumber`, `useFfNumbering`. |
| `global` | `masterGainDb`, `masterMuted`, `cueGainDb`, `cueMode`, `playbackRate`, `views`. |
| `global.views` | Boolean `rms` and `bands` defaults. Spectrum is `"reserved"`. |
| `media[]` | Media metadata and origin hints, referenced by `mediaId`. |
| `tracks[]` | `trackId`, `name`, `gainDb`, `muted`, `solo`, `views`, `clips[]`. |
| `track.views` | `rms` and `bands` accept `null` (inherit), `true` or `false`. Spectrum is `"reserved"`. |
| `clip` | `clipId`, `mediaId`, `timelineStartSeconds`, `sourceOffsetFrames`, `frameCount`. |
| `bmhelper` | `null` or `{format: "bmhelper", source, divisions}` containing structured BMHelper work. |

### BMHelper data

`src/project/bmhelper.ts` validates the DX representation and reconstructs derived note references.
`source` contains `quantize`, `notes`, `pitches` and `controls`.
Each division contains `name`, `quantize`, `recording`, `definitions`, `src2def` and `zzDefinition`.
Event fields retain the signed 32-bit ranges used by BMH. Quantize must be positive.
Definition indices must refer to recording notes. The source mapping must cover every source note and reference valid definitions.

Names remain Unicode in memory and UTF-8 in the project file. Unpaired surrogates are rejected.
DX does not impose a CP932 restriction or a separate name-length limit. The total project byte limit still applies.
DX also preserves ZZ/FF numbering mode. Original `.bmh` files omit that mode and reopen in ZZ mode.
The project stores neither original MIDI bytes nor Base64 BMH data. It does not duplicate derived note references.
Legacy BMH conversion occurs only at file import and export.
BMH export applies the original program's CP932 substitutions and continues with a warning showing the original and converted names.
The editor retains the Unicode project and its unsaved state. Lossy BMH output does not mark Unicode content as saved.
Users can rename the division before another export, or save `.wosdx` to preserve the name.

### Media metadata

| `MediaAsset` field | Meaning |
| --- | --- |
| `mediaId`, `name`, `format` | Stable identity, original filename, and `wav` or `ogg`. |
| `byteLength` | Original file size or `null`, not decoded PCM buffer size. |
| `sampleRateHz`, `channels`, `framesPerChannel` | Known values or `null`. Frames are per channel. Duration is frames divided by sample rate. |
| `integrity` | `null` or `{algorithm: "sha256", digest: <64 hex chars>}`. The parser converts digests to lowercase. |
| `originHint` | `null`, `{kind: "desktop", pathHint}` or `{kind: "browser", name, relativePathHint?, lastModified?}`. |

## Timing, playback and views

`timelineStartSeconds` is independent of BPM. `sourceOffsetFrames` and
`frameCount` use the source media's sample rate. Changing BPM must not move clips
in seconds or change their frame counts. Source offset plus frame count must
fit within the known media length, and all ID references must resolve.
A positive timeline start leaves leading silence. Array order does not imply
position. Overlapping clips can be stored but do not imply mixing or crossfades.

Gains use dB, with 0 dB as unity. Mute is independent of gain and takes precedence
over solo. If any track is soloed, only unmuted solo tracks are audible.
`masterMuted` controls the media bus. Cue audio uses a separate route.
The current editor applies only the supported single-track values. It does not implement multi-track summing, headroom or loudness policies.

Track `rms` and `bands` values override global defaults unless they are `null`.
Spectrum is reserved: there is no enabled control or analysis task.
The following table lists supported editing layouts.

## Limits and defaults

Numbers must be finite. Integer fields must be safe integers. The codec and
schema contain the complete validation rules.

| Resource or field | Limit |
| --- | --- |
| Entire encoded UTF-8 JSON | 64 MiB, including BMHelper data and metadata. |
| Desktop recovery JSON | 65 MiB, including the project and session fields. |
| Media / tracks | 256 each. |
| Clips | 100,000 across all tracks. |
| Markers | At most 49,152 markers. Ticks range from 0 through 49,151. |
| Source frames / offset / count | 0 through 2,000,000,000 per field, subject to clip range validation. |
| `timelineStartSeconds` | 0 through 1,000,000,000 seconds. |
| Track / master / cue gain | −96 through +12 dB. |
| BPM / `shiftTicks` | 0 < BPM ≤ 10,000. Shift from −1e9 through 1e9. |
| Fadeout / noise gate | Fadeout: 0 through 60,000 integer milliseconds. Noise gate: −200 through 0 dB. |
| Sample rate / channels | Known sample rates: 1 through 768,000 Hz. Known channel counts: 1 through 64. |
| Media `byteLength` metadata | `null` or 0 through 16 GiB. This does not guarantee the host can load that size. |
| Actual audio input | Platform limit of 2 GiB. Decoding also depends on memory and format limits. |
| `playbackRate` | 0.25 through 1.5. |

These are application memory budgets, not format requirements. The former 16 MiB project
cap was introduced with the Vue workspace. The 64 MiB cap permits larger note collections and project metadata.
Recovery has an additional 1 MiB for local bindings and UI settings. JSON remains uncompressed.
Structured JSON can be larger than binary BMH. The byte limit applies after UTF-8 serialization, not to the original MIDI file size.

The original BMHelper beta 4′ source (`src/serialize.h`, `src/project.cpp`, `src/midi_sr.cpp`)
has no 32 MiB check and does not use base64. Its Windows build writes 32-bit chunk lengths
and allocates the declared data size. That is not a guarantee that multi-gigabyte projects
are usable. The earlier application's 32 Mi-character Base64 cap represented at most 24 MiB of binary data.
That cap was an application policy, not an original BMHelper restriction.
DX now stores structured data, so the former Base64 cap and its roughly one-third encoding overhead no longer apply.
The browser recovery store also depends on the browser's local-storage quota. Raising the
project file limit does not raise that quota. Failed recovery writes remain visible to users.

The BMH codec reads and writes the original little-endian chunk format.
No fallback reads the unreleased application's earlier big-endian encoding or its Base64 project field.

`createEmptyProject` creates one empty track without media or clips.
`createSingleTrackProject` creates one track with a full-source clip at timeline
position and source offset zero.

Empty projects default to master −10 dB, cue −6 dB, playback rate 1, cue off,
and RMS/bands off. Tracks default to 0 dB, unmuted, not soloed, and inherited
views. These are constructor defaults, not user-configurable defaults.

## Opening and saving

| Input | Behavior |
| --- | --- |
| Empty project | Settings can be edited and saved. |
| Full-source single-track layout | Editable and saveable. Missing media can be relinked manually. |
| Multiple tracks or clips, trimmed clips, leading silence, or non-neutral track playback properties | Opens read-only. Files opened from disk can be saved with their original bytes. |
| Future version or invalid file | The app rejects the file and preserves the current workspace and source file. |

An editable single-track layout has one track and one full-source clip. Its
length equals the known source length. Timeline position and source offset are
zero. Track gain is 0 dB, with mute and solo off.

### Normalization and unknown fields

Preserving a complex project means retaining all valid known media, tracks,
clips, positions, properties and BMH content, without flattening or trimming.
Normalized JSON does not preserve whitespace or field order. The locked `.wos`
byte format is a separate compatibility requirement.

The parser constructs new objects containing known fields. It sorts markers,
rejects duplicate ticks, lowercases digests and converts track spectrum `null`
to `"reserved"`. `parseProject` collects up to 16 unknown field paths in
`unknownFields`. Editable projects show `projectUnknownFields` to warn that
saving retains only recognized data. For read-only files, the app saves the original bytes without normalization.
The workspace rejects future versions and does not write them to disk.

### Original file bytes

`decodeProject` returns a `ProjectDecodeResult` with `sourceBytes` for supported
and unsupported-version results. The byte copy owns its storage, including when
the input is a Node Buffer subview. It preserves unknown fields, original values,
BOM, whitespace and number spelling. The caller owns this mutable copy. It is
only for preserving an unedited file and cannot replace encoding after edits.

`parseProject` does not attach source bytes. `encodeProject` writes normalized
v1 JSON. Original bytes are not part of `ProjectDocument` or undo history.

Complex layouts display `projectLimitedOpen`. The editor blocks document
mutations centrally, and saving writes `sourceBytes` unchanged, covered by
byte-for-byte tests. Complex projects restored from recovery remain read-only.
The app cannot save these projects because recovery lacks the original bytes.
`limitedSaveUnavailable` explains this restriction.

## Local bindings, recovery and relinking

Portable projects must not contain Tauri UUIDs, picker tokens, Blob URLs,
`FileSystemHandle` objects, PCM buffers or machine-specific window state.
The recovery session stores the active media's host reference separately as `lastFile`.
Decode failures must not delete bindings. Desktop paths must not become browser references.

Desktop media stores its absolute native path in `originHint.pathHint`.
Opening a selected `.wosdx` file resolves its active media through `open_project_media`.
This command accepts the selected project's host reference and a media ID, not a path.
The host reads the bounded project file and grants access only to that entry's absolute WAV or OGG path.
The workspace verifies the media metadata and hash before adoption.
Recovery reuses the persisted host grant. Browser file inputs and drops cannot provide absolute paths and require manual relinking.
Old projects without paths also require one manual relink before saving the path.

Relinking stages and decodes the candidate, then compares size, format,
sample rate, channels, frames and hash. Matching names do not prove matching
content. Unknown metadata stays unknown. Users can confirm replacement when
media differs. Replacement updates media metadata and clip length as one
undoable transaction. A matching file at a new native path updates the path as an undoable edit.
Cancellation or failure leaves the document, bindings
and history unchanged. Clip range changes must be disclosed, never silently
truncated.

`.wos` import maps only the fields it can represent. Importing settings into
loaded audio preserves the actual media. Starting a project from WOS creates
an empty project. `.wos` export is a partial projection and does not mark the
whole project as saved. It rejects unrepresentable values such as fractional
noise-gate thresholds and does not flatten multiple tracks.

## Validation coverage

Behavior tests live in:

- `tests/project/project.test.ts`: codec and project data.
- `tests/project/editor.test.ts`: document editing.
- `tests/app/project-files.test.ts`: project file operations.
- `tests/app/project-workflow.spec.ts`: browser workflows.

Cover preservation across capability/version boundaries, host isolation,
recovery identity and media mismatch confirmation through observable behavior.
Keep `.wos` format regressions covered separately. Missing original-program
oracle fixtures must be reported as skipped, not as verified compatibility.
