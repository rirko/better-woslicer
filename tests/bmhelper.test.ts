import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectSmf,
  readSmfSequence,
  writeSmfSequence,
  SmfFormatError,
  type MidiSequence,
} from '../src/core/smf.js';
import {
  BMSE_CLIPBOARD_HEADER,
  bmsSequenceClipboard,
  createDivision,
  cutPositionsClipboard,
  defaultDivisionSetting,
  nextZz,
  prevZz,
  setStartDefinition,
  transposeDefinitions,
  wavDefinitionText,
  zzToString,
  type Division,
  type DivisionSetting,
} from '../src/core/bmhelper.js';
import { readBmh, writeBmh } from '../src/core/bmh.js';

// --- SMF byte construction helpers ------------------------------------------

function varlen(value: number): number[] {
  const out = [value & 0x7f];
  for (let rest = value >> 7; rest > 0; rest >>= 7) out.unshift((rest & 0x7f) | 0x80);
  return out;
}

function trackChunk(events: { tick: number; bytes: number[] }[]): number[] {
  const out: number[] = [];
  let last = 0;
  for (const event of events) {
    out.push(...varlen(event.tick - last), ...event.bytes);
    last = event.tick;
  }
  out.push(...varlen(0), 0xff, 0x2f, 0x00);
  const length = [0, 0, (out.length >> 8) & 0xff, out.length & 0xff]; // u32 BE, as MTrk requires
  return [0x4d, 0x54, 0x72, 0x6b, ...length, ...out]; // "MTrk"
}

function smfFile(format: number, division: number, tracks: number[][]): Uint8Array {
  const header = [
    0x4d,
    0x54,
    0x68,
    0x64,
    0,
    0,
    0,
    6,
    (format >> 8) & 0xff,
    format & 0xff,
    0,
    tracks.length,
    (division >> 8) & 0xff,
    division & 0xff,
  ];
  return Uint8Array.from([...header, ...tracks.flat()]);
}

const noteOn = (tick: number, channel: number, nn: number, vel: number) => ({
  tick,
  bytes: [0x90 | channel, nn, vel],
});
const noteOff = (tick: number, channel: number, nn: number) => ({
  tick,
  bytes: [0x80 | channel, nn, 0],
});

// --- SMF reading ------------------------------------------------------------

test('parses a minimal format-0 file with one note', () => {
  const bytes = smfFile(0, 480, [trackChunk([noteOn(0, 0, 60, 100), noteOff(480, 0, 60)])]);
  const info = inspectSmf(bytes);
  assert.equal(info.division, 480);
  assert.equal(info.format, 0);
  assert.equal(info.tracks.length, 1);
  assert.equal(info.tracks[0].noteCount, 1);
  const sequence = readSmfSequence(bytes, 0, new Set([0]));
  assert.deepEqual(sequence.notes, [{ position: 0, gate: 480, nn: 60, vel: 100 }]);
});

test('pairs note-offs written with running status', () => {
  // Note-off reuses the 0x90 running status with velocity 0.
  const track = trackChunk([
    { tick: 0, bytes: [0x90, 60, 100] },
    { tick: 240, bytes: [60, 0] },
  ]);
  const bytes = smfFile(0, 480, [track]);
  const sequence = readSmfSequence(bytes, 0, new Set([0]));
  assert.deepEqual(sequence.notes, [{ position: 0, gate: 240, nn: 60, vel: 100 }]);
});

test('drops an overlapping second note-on of the same pitch', () => {
  const track = trackChunk([
    noteOn(0, 0, 60, 100),
    noteOn(10, 0, 60, 50), // overlapping: silently dropped by the nn-keyed pairing
    noteOff(480, 0, 60),
    noteOff(960, 0, 60), // stray off: no second note
  ]);
  const bytes = smfFile(0, 480, [track]);
  const sequence = readSmfSequence(bytes, 0, new Set([0]));
  assert.deepEqual(sequence.notes, [{ position: 0, gate: 480, nn: 60, vel: 100 }]);
});

test('the channel mask filters the extracted notes', () => {
  const track = trackChunk([
    noteOn(0, 0, 60, 100),
    noteOff(480, 0, 60),
    noteOn(0, 3, 62, 90),
    noteOff(240, 3, 62),
  ]);
  const bytes = smfFile(0, 480, [track]);
  assert.equal(readSmfSequence(bytes, 0, new Set([0])).notes.length, 1);
  assert.equal(readSmfSequence(bytes, 0, new Set([3])).notes.length, 1);
  assert.equal(readSmfSequence(bytes, 0, new Set([0, 3])).notes.length, 2);
  assert.equal(readSmfSequence(bytes, 0, new Set([7])).notes.length, 0);
});

test('SMPTE-time-coded divisions are rejected', () => {
  const bytes = smfFile(0, 0xe250, [trackChunk([noteOn(0, 0, 60, 100), noteOff(480, 0, 60)])]);
  assert.throws(() => inspectSmf(bytes), SmfFormatError);
});

test('writeSmfSequence round-trips through the reader', () => {
  const sequence: MidiSequence = {
    quantize: 480,
    notes: [
      { position: 480, gate: 240, nn: 60, vel: 100 },
      { position: 960, gate: 480, nn: 62, vel: 80 },
    ],
    pitches: [],
    controls: [],
  };
  const bytes = writeSmfSequence(sequence);
  assert.equal(inspectSmf(bytes).division, 480);
  const back = readSmfSequence(bytes, 1, new Set([0]));
  assert.deepEqual(back.notes, sequence.notes);
});

// --- division algorithm -----------------------------------------------------

function makeSource(
  notes: { position: number; gate: number; nn: number; vel: number }[],
): MidiSequence {
  return { quantize: 480, notes, pitches: [], controls: [] };
}

function makeSetting(overrides: Partial<DivisionSetting> = {}): DivisionSetting {
  return { ...defaultDivisionSetting('division 1', 480), ...overrides };
}

test('unifies notes with equal pitch within the gate/velocity tolerance', () => {
  const division = createDivision(
    makeSource([
      { position: 0, gate: 480, nn: 60, vel: 100 },
      { position: 960, gate: 484, nn: 60, vel: 103 }, // within tolerance (48/5) → same sound
      { position: 1920, gate: 480, nn: 60, vel: 120 }, // velocity too different → own sound
    ]),
    makeSetting(),
  );
  assert.equal(division.notes.length, 2);
  assert.deepEqual(division.notes[0].referrers, [0, 1]);
  assert.deepEqual(division.notes[1].referrers, [2]);
  assert.equal(division.notes[0].vel, 101); // integer average of 100 and 103
});

test('sorts div notes by the nn/gate/vel chain (gate and velocity descending)', () => {
  const division = createDivision(
    makeSource([
      { position: 0, gate: 480, nn: 62, vel: 100 },
      { position: 480, gate: 480, nn: 60, vel: 100 },
      { position: 960, gate: 960, nn: 60, vel: 100 },
      { position: 1440, gate: 480, nn: 60, vel: 110 },
    ]),
    makeSetting(),
  );
  // nn 60 group first: gate 960 before gate 480; within gate 480, vel 110 before 100.
  assert.deepEqual(
    division.notes.map((note) => [note.nn, note.gate, note.vel]),
    [
      [60, 960, 100],
      [60, 480, 110],
      [60, 480, 100],
      [62, 480, 100],
    ],
  );
});

test('lays recording notes on whole beats with the minimal gap', () => {
  const division = createDivision(
    makeSource([
      { position: 0, gate: 240, nn: 60, vel: 100 },
      { position: 960, gate: 700, nn: 62, vel: 100 },
    ]),
    makeSetting({ headMargin: 480, minInterval: 480 }),
  );
  // First note at the head margin; next = ceil((480+480+240)/480)*480 = 1440.
  assert.deepEqual(
    division.recording.map((note) => [note.position, note.gate, note.nn]),
    [
      [480, 240, 60],
      [1440, 700, 62],
    ],
  );
});

test('srcCopy keeps original positions shifted by the head margin', () => {
  const division = createDivision(
    makeSource([
      { position: 240, gate: 480, nn: 60, vel: 100 },
      { position: 960, gate: 100, nn: 64, vel: 100 },
    ]),
    makeSetting({ srcCopy: true, headMargin: 480 }),
  );
  assert.deepEqual(
    division.recording.map((note) => note.position),
    [720, 1440],
  );
  assert.equal(division.definitions.length, 2); // one per note, no clustering
});

test('assigns sequential base-36 ZZ definitions', () => {
  const division = createDivision(
    makeSource([
      { position: 0, gate: 480, nn: 60, vel: 100 },
      { position: 960, gate: 480, nn: 62, vel: 100 },
      { position: 1920, gate: 480, nn: 64, vel: 100 },
    ]),
    makeSetting(),
  );
  assert.deepEqual(
    division.definitions.map((definition) => zzToString(definition.zz)),
    ['01', '02', '03'],
  );
  assert.deepEqual(division.src2def, [0, 1, 2]);
});

test('ZZ ids wrap at ZZ and the FF mode wraps inside 00-FF', () => {
  assert.equal(zzToString(0), '00');
  assert.equal(zzToString(1295), 'ZZ');
  assert.equal(nextZz(1295, false), 0);
  assert.equal(prevZz(0, false), 1295);
  // FF shape: 0F → 10, FF → 00 (each digit stays within 0-9A-F).
  // NB: the "FF" SHAPE is the base-36 value 15*36+15 = 555, not decimal 255.
  assert.equal(zzToString(nextZz(15, true)), '10');
  assert.equal(zzToString(nextZz(555, true)), '00');
  assert.equal(nextZz(1295, true), 0);
});

test('multi-definition spreads close repeats over several ids', () => {
  // The same sound twice, 480 ticks apart with a 480-tick gate: the free gap
  // between repeats is 0, below the threshold → mln=1 fails, mln=2 passes.
  const division = createDivision(
    makeSource([
      { position: 0, gate: 480, nn: 60, vel: 100 },
      { position: 480, gate: 480, nn: 60, vel: 100 },
      { position: 4800, gate: 480, nn: 62, vel: 100 }, // far away: single instance
    ]),
    makeSetting({ mlThreshold: 480 }),
  );
  // The unified sound needs 2 definitions; the distant sound needs 1.
  assert.equal(division.notes.length, 2);
  assert.equal(division.notes[0].referrers.length, 2);
  assert.deepEqual(division.src2def, [0, 1, 2]);
  assert.deepEqual(
    division.definitions.map((definition) => [zzToString(definition.zz), definition.div]),
    [
      ['01', 0],
      ['02', 0],
      ['03', 1],
    ],
  );
});

test('setStartDefinition shifts ZZ ids with wraparound and renumbers in FF mode', () => {
  const source = makeSource([
    { position: 0, gate: 480, nn: 60, vel: 100 },
    { position: 960, gate: 480, nn: 62, vel: 100 },
  ]);
  const zzMode = createDivision(source, makeSetting());
  setStartDefinition(zzMode, 5, false);
  assert.deepEqual(
    zzMode.definitions.map((d) => zzToString(d.zz)),
    ['05', '06'],
  );
  const ffMode = createDivision(source, makeSetting({ zzDefinition: false }));
  setStartDefinition(ffMode, 15 * 36 + 14, true); // the "FE" shape as a base-36 value
  // FF mode renumbers sequentially and stays inside 00-FF: FE, then FF.
  assert.deepEqual(
    ffMode.definitions.map((d) => zzToString(d.zz)),
    ['FE', 'FF'],
  );
  const transposed = createDivision(source, makeSetting());
  transposeDefinitions(transposed, 1, false);
  assert.deepEqual(
    transposed.definitions.map((d) => zzToString(d.zz)),
    ['02', '03'],
  );
});

// --- clipboard products -----------------------------------------------------

test('cutPositionsClipboard emits the exact woslicer B-key payload', () => {
  const division = createDivision(
    makeSource([
      { position: 0, gate: 480, nn: 60, vel: 100 },
      { position: 960, gate: 480, nn: 62, vel: 100 },
    ]),
    makeSetting({ headMargin: 0, minInterval: 960 }),
  );
  // Recording positions: 0 and ceil((0+960+480)/480)*480 = 1440 → 48/quarter → 0, 144.
  const text = cutPositionsClipboard(division);
  const lines = text.split('\r\n');
  assert.equal(lines[0], BMSE_CLIPBOARD_HEADER);
  assert.deepEqual(lines.slice(1, 4), ['011000000001', '011000001441', '']);
});

test('bmsSequenceClipboard spreads chords across BGM lanes with decimal zz', () => {
  const division = createDivision(
    makeSource([
      { position: 0, gate: 480, nn: 60, vel: 100 },
      { position: 0, gate: 480, nn: 64, vel: 100 }, // chord: same position
      { position: 1920, gate: 480, nn: 62, vel: 100 },
    ]),
    makeSetting(),
  );
  const text = bmsSequenceClipboard(
    division,
    makeSource([
      { position: 0, gate: 480, nn: 60, vel: 100 },
      { position: 0, gate: 480, nn: 64, vel: 100 },
      { position: 1920, gate: 480, nn: 62, vel: 100 },
    ]),
  );
  const lines = text.split('\r\n');
  assert.equal(lines[0], BMSE_CLIPBOARD_HEADER);
  // pos 0 → lane 01 and 02; pos 1920*48/480 = 192 → lane 01. NB: the nn/gate/vel
  // sort reorders the div notes, so the nn62 sound (source note 3) gets zz 02
  // and the chord's nn64 gets zz 03.
  assert.deepEqual(lines.slice(1, 5), ['101000000001', '102000000003', '101000001922', '']);
});

test('wavDefinitionText writes the #WAV lines with our export numbering', () => {
  const division = createDivision(
    makeSource([
      { position: 0, gate: 480, nn: 60, vel: 100 },
      { position: 960, gate: 480, nn: 62, vel: 100 },
    ]),
    makeSetting(),
  );
  const text = wavDefinitionText(division, 'tekc0');
  assert.equal(text, '#WAV01 tekc0_000.wav\r\n#WAV02 tekc0_001.wav\r\n');
});

// --- .bmh project persistence ----------------------------------------------

function sampleProject() {
  const source = makeSource([
    { position: 0, gate: 480, nn: 60, vel: 100 },
    { position: 960, gate: 480, nn: 60, vel: 100 },
    { position: 1920, gate: 480, nn: 62, vel: 100 },
  ]);
  const first = createDivision(source, makeSetting({ name: 'division 1', mlThreshold: 480 }));
  const second = createDivision(
    source,
    makeSetting({ name: 'コード分割', srcCopy: true, headMargin: 240 }),
  );
  return { source, divisions: [first, second] };
}

test('.bmh projects round-trip through the chunk tree', () => {
  const project = sampleProject();
  const bytes = writeBmh(project);
  const back = readBmh(bytes);
  assert.deepEqual(back.source, project.source);
  assert.equal(back.divisions.length, 2);
  for (const [original, loaded] of [
    [project.divisions[0], back.divisions[0]],
    [project.divisions[1], back.divisions[1]],
  ] as [Division, Division][]) {
    assert.equal(loaded.name, original.name);
    assert.deepEqual(loaded.recording, original.recording);
    assert.deepEqual(loaded.definitions, original.definitions);
    assert.deepEqual(loaded.src2def, original.src2def);
    assert.deepEqual(
      loaded.notes.map((note) => [note.nn, note.gate, note.vel, note.recPos]),
      original.notes.map((note) => [note.nn, note.gate, note.vel, note.recPos]),
    );
    assert.deepEqual(
      loaded.notes.map((note) => note.referrers),
      original.notes.map((note) => note.referrers),
    );
  }
});

test('readBmh rejects foreign data with a clear error', () => {
  assert.throws(() => readBmh(Uint8Array.from([0, 1, 2, 3])), /BMHP/);
});

// Division type is imported for the assertion casts above.
void (undefined as unknown as DivisionSetting | undefined);
