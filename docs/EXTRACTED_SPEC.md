# Extracted reference semantics (woslicerIII)

Everything below was recovered by disassembling `woslicerIII.exe` (.NET IL,
via dnfile/dncil) and by differential analysis against the original's own
exports (`new/KEY.wos`, `KEY_000.wav`…`KEY_148.wav`). This document records the
original program's behavior, including its quirks. It records reference evidence. The current app also fixes bugs and accepts additional input formats. Japanese strings below quote the
original UI or error messages.

## Data model

- Internal audio is always int16 in [-32768, 32767], stereo or mono.
  The loader forces `bit = 16` after reading (`Cwav..ctor`).
- Marker timeline: 49152 ticks (256 measures x 192 ticks), one bit each.

## WAV loading (`Cwav..ctor`)

1. If extension equals `".ogg"` (case-sensitive): decode via OggVorbis.dll into
   the temp file `prev`, then continue loading `prev` as WAV.
2. Scan bytes for the literal `fmt ` chunk ID. Read these fields in order:
   - Size and format: 6 bytes.
   - Channels: 2 bytes, using only the low byte.
   - Rate: 4 bytes, using only the low 2 bytes.
   - Byte rate and alignment: 6 bytes.
   - Bits: 2 bytes, using only the low byte.
3. Byte-scan for `data`, read 4-byte size.
   `length = size / channel * 8 / bit` (integer ops).
4. Per frame per channel: read `bit/8` bytes.
   - `bit == 8`: `(b0 - 128) << 8`
   - otherwise: `v = b[bit/8 - 2] | b[bit/8 - 1] << 8`, `if (v >= 32768) v -= 65536`
     For 16-bit input, the value stays unchanged. For 24-bit input, the loader takes the top 16 bits.
     For 32-bit input, the loader takes bits 16 through 31.
5. Consequence: 24-bit sources lose the low 8 bits at load time.

## Time base

```
sample(tick) = (tick + shift) * ratio * 5 / (4 * bpm)
```

Two implementations coexist in the original:

- `DoPrev` / file export (float64 end to end):
  `(int)(((tick + shift) * ratio / bpm) * 5.0 / 4.0)`
- `ToSample2` / view mapping (explicit float32 steps):
  `(int)((double)(f32(f32(f32(tick+shift) * (float)ratio) * 5f) / 4f) / bpm)`

`Cwav.safe_data` uses `Math.Max`/`Math.Min` and returns 0 for out-of-range reads.
Callers clamp negative indices with `Math.Max(0, index)`.

## Slice rendering (`Class1.woswrite`)

```
woswrite(this, src, start, end, msec, dB, file):
  fadeIn  = src.ratio / 525                       (integer division)
  tailLen = src.ratio * msec / 1000               (integer division)
  end     = Math.Min(src.length, end)
  this.length = end + tailLen - start + 16
  this.data = new int[channel][length]
  for c in channels:
    // fade-in
    for pos in [start, start + fadeIn):
      j = pos - start
      angle = (int)(j * 90 / fadeIn) * 0.017453333362936974   // int div, then
                                                              // f32 constant in
                                                              // x87 double math
      data[c][j] = (int)(Math.Sin(angle) * src.safe_data(c, pos))
    // copy
    for pos in [start + fadeIn, end):
      data[c][pos - start] = src.safe_data(c, pos)
    // sustain tail (while loop, runs only when tailLen > 0)
    prev = 0; dir = 1; rp = end; out = end
    while (out < end + tailLen):
      prevPrev = prev
      prev = src.safe_data(c, Math.Max(0, rp))
      if dir == 1 && (prevPrev * prev < 0 || rp == src.length):
        dir = -1; rp--; rp += dir (net -2); out++   // skip-write one zero frame
        continue
      angle = (int)((end + tailLen - out) * 90 / tailLen) * 0.017453333362936974
      data[c][out - start] = (int)(prev * Math.Sin(angle) * dir)
      rp += dir; out++
  Cut(this, dB, 11025)
  WriteFile(this, file)
```

Notes verified against the oracle:

- The `f32` angle constants are the float32 literal `0.017453333362936974`
  stored in the IL. The original ran with x87 extended precision.
  The `angle` multiplication behaves as a plain double multiplication.
  `fround` breaks byte-exactness. Slice 45, frame 74 distinguishes these calculations.
- Integer divisions inside the envelope angles are load-bearing.
- The fade-in never reaches gain 1.0. Its last angle is 89 degrees for 48 kHz sources.
  The copy region starts at frame `fadeIn`, which is 91 at 48 kHz.
- The tail reads the source forward past the cut point to sustain the sound.
  At zero crossings, it reverses direction and phase through `* dir`.
  It always reverses at the end of the source. Each reversal leaves one output frame at zero.
- With `fadeout = 0` the tail loop never runs and the output ends in 16 zero
  frames (the "pad"), included in the length formula.

## Trailing-silence gate (`Class1.Cut`)

```
Cut(this, dB: double, msec: int):
  threshold = (int)(32768.0 / Math.Pow(2.0, dB / -6.0))
  if dB == 0.0: threshold = 0; msec = 0
  scan frames backward from length-1:
    if any channel |value| > threshold: lastLoud = frame; stop
  if none found: this.length = 4; return          // "(NULL)" empty slice
  if length - lastLoud <= msec: return            // short tail: untouched
  for j in [0, msec), all channels:
    data[c][lastLoud + j] =
      (int)(data[c][lastLoud + j] * Math.Cos((j * 90.0 / msec) * 0.017453332742055256))
  this.length = Math.Min(this.length, lastLoud + msec)
```

- Caller: `woswrite` always applies `Cut(noisegateDb, 11025)` at the end.
- The UI's noise-gate checkbox ("ノイズゲート") off => `noisegate = 0.0` => the dB=0 branch
  truncates the slice at its last non-zero sample (dropping the pad).
- The oracle export used dB = -48 (threshold 128) with the checkbox on.

## WAV writing (`Class1.WriteFile`)

Canonical 44-byte header: `RIFF` / size = data+36 / `WAVEfmt ` / 16 / PCM(1) /
channels / rate / rate*channels*16/8 / align = channels*2 / 16 / `data` / size.
Sample bytes: `v = data[c][f]; if (v >= 32678) v -= 65536` (sic — a harmless
quirk: the low 16 bits are unchanged), then `v & 0xFF`, `(v >> 8) & 0xFF`.

## .wos file

Exactly 6168 bytes:

| offset | type      | field    |
| ------ | --------- | -------- |
| 0      | double LE | bpm      |
| 8      | double LE | shift    |
| 16     | int32 LE  | fadeout  |
| 20     | int32 LE  | noisegate (loaded with `conv.r8` into a double field) |
| 24     | 6144 B    | marker bitmap, 49152 bits, MSB-first |

Save: `bpm = Double.Parse`, `shift = Double.Parse`, `fadeout = Int32.Parse`,
`noisegate = Int32.Parse`. The original crashes on non-integer input. This port validates the value and reports an error. Bitmap byte assembly: `byte <<= 1; if (bit)
byte += 1`, MSB-first, byte per 8 ticks.

## Preview and export flow (`DoPrev` / total output)

```
DoPrev(index, path):
  startTick = the (index+1)-th set bit in the bitmap
  endTick   = the next set bit after startTick (0 if none)
  start = (int)((startTick + shift) * ratio / bpm * 5.0 / 4.0)
  end   = (int)((endTick   + shift) * ratio / bpm * 5.0 / 4.0)
  if endTick == 0: end = src.length            // last marker: EOF
  if start > src.length: error "元waveファイルの参照外です。" // outside the source WAV
  if gate checkbox unchecked: noisegate = 0.0
  out = new Class1(src, fadeout)               // pre-size: len + msec*ratio/1000 + 441
  out.woswrite(src, start, end, fadeout, noisegate, path)
```

Total export writes `name_000.wav` … `name_(N-1).wav` for N list entries.

## Measure copy/cut/paste (`Form1_KeyDown`)

- Ctrl+C (0x20043): `clp[i] = wos[base + i]` for i in [0, 192)
- Ctrl+X (0x20048): copy then `wos[base + i] = 0`
- Ctrl+F (0x20046): `wos[base + i] = clp[i]`
- `base` is a measure-aligned tick (192 * measure index in the original's
  display math). `clp` is a 192-entry bool buffer.

## BMSE clipboard

Header line exactly `BMSE ClipBoard Object Data Format`, then per marker:

```
"101" + tick.ToString("D8") + clipNumber + CRLF
```

- The initial number is `n0` from the dialog.
  Apply `if (n % 36 == 16 && useFF) n += 20` before the loop and after each increment.
- Terminated by a NUL character.
- Import requires an exact header match. Normalize CRLF, then split lines on `\n`.
  Parse `tick = int(line[3..11])`. Parse and discard the WAV-number column (`line[0..3]`) and clip number (`line[11..]`).
  Iterate lines while `i < lines.Length - 1`.

## Edge detection (approximate)

The original UI labels this feature "エッジ検出" (edge detection).

Walks ticks in grid steps, comparing `GetRMS` of the window after the
candidate against the window before it. It keeps the candidate when
`rmsAfter > rmsBefore * 1.5`. `GetRMS = sqrt(sum(v*v/1000)/count)` on int16
values (integer-scaled).
