import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BmhFormatError, readBmh, writeBmh, type BmhNameChange } from '../src/core/bmh.js';
import { createDivision, defaultDivisionSetting } from '../src/core/bmhelper.js';

const original = new Uint8Array(readFileSync('tests/fixtures/bmh/original.bmh'));

test('reads the original BMHelper beta 4 prime fixture and reproduces its bytes', () => {
  const project = readBmh(original);
  assert.deepEqual(project.source, {
    quantize: 480,
    notes: [
      { position: 0, gate: 480, nn: 60, vel: 100 },
      { position: 480, gate: 480, nn: 64, vel: 90 },
      { position: 960, gate: 480, nn: 60, vel: 100 },
    ],
    pitches: [],
    controls: [],
  });
  assert.equal(project.divisions.length, 1);
  const division = project.divisions[0];
  assert.equal(division.name, 'コード分割');
  assert.deepEqual(division.recording, [
    { position: 0, gate: 480, nn: 60, vel: 100 },
    { position: 960, gate: 480, nn: 64, vel: 90 },
  ]);
  assert.deepEqual(division.definitions, [
    { zz: 1, div: 0 },
    { zz: 2, div: 1 },
  ]);
  assert.deepEqual(division.src2def, [0, 1, 0]);
  assert.deepEqual(
    division.notes.map((note) => note.referrers),
    [[0, 2], [1]],
  );
  assert.deepEqual(writeBmh(project), original);
});

test('rejects truncated original BMH files', () => {
  for (let end = 0; end < original.length; end++) {
    assert.throws(() => readBmh(original.subarray(0, end)), BmhFormatError);
  }
});

test('preserves pitch, controller lanes and multiple divisions verified by the original program', () => {
  const fixture = new Uint8Array(readFileSync('tests/fixtures/bmh/original-events.bmh'));
  const project = readBmh(original);
  project.source.pitches = [
    { position: 120, value: 2048 },
    { position: 960, value: -4096 },
  ];
  // Deliberately interleave lanes: original output orders by CC, then lane order.
  project.source.controls = [
    { position: 720, value: 100, cc: 7 },
    { position: 240, value: 64, cc: 1 },
    { position: 960, value: 0, cc: 1 },
  ];
  project.divisions.push(
    createDivision(project.source, {
      ...defaultDivisionSetting('copy', 480),
      srcCopy: true,
      headMargin: 240,
    }),
  );
  assert.deepEqual(writeBmh(project), fixture);
  const restored = readBmh(fixture);
  assert.deepEqual(restored.source.pitches, project.source.pitches);
  assert.deepEqual(restored.source.controls, [
    { position: 240, value: 64, cc: 1 },
    { position: 960, value: 0, cc: 1 },
    { position: 720, value: 100, cc: 7 },
  ]);
  assert.deepEqual(restored.divisions[1], project.divisions[1]);
  assert.deepEqual(writeBmh(restored), fixture);
});

test('reads an empty sequence without event chunks', () => {
  // BMHP(20), Src (12), qntz(4), 480. No note/ptch/ccgh chunks exist.
  const bytes = Uint8Array.from(
    Buffer.from('424d485014000000537263200c000000716e747a04000000e0010000', 'hex'),
  );
  const project = {
    source: { quantize: 480, notes: [], pitches: [], controls: [] },
    divisions: [],
  };
  assert.deepEqual(readBmh(bytes), project);
  assert.deepEqual(writeBmh(project), bytes);
});

test('preserves long names and punctuation accepted by the original program', () => {
  const fixture = new Uint8Array(readFileSync('tests/fixtures/bmh/original-long-name.bmh'));
  const project = readBmh(fixture);
  assert.equal(project.divisions[0].name, '分'.repeat(1024) + ' <>:"/\\|?*');
  assert.deepEqual(writeBmh(project), fixture);
});

test('rejects malformed known chunks and invalid definition references', () => {
  const changed = (offset: number, value: number): Uint8Array => {
    const bytes = original.slice();
    new DataView(bytes.buffer).setInt32(offset, value, true);
    return bytes;
  };
  // Offsets refer to the checked-in original fixture, not the current writer.
  const wrongEvent = original.slice();
  wrongEvent.set(new TextEncoder().encode('ptch'), 28);
  assert.throws(() => readBmh(wrongEvent), /malformed ptch/);
  assert.throws(() => readBmh(changed(24, 0)), /quantize/);
  assert.throws(() => readBmh(changed(198, 4)), BmhFormatError);
  assert.throws(() => readBmh(changed(202, -1)), /missing definition/);
  assert.throws(() => readBmh(changed(222, 36)), /invalid BMH definition/);
  assert.throws(() => readBmh(changed(230, -1)), /invalid BMH definition/);
  assert.throws(() => readBmh(changed(230, 2)), /invalid BMH definition/);
});

test('matches original lossy CP932 conversion and reports changed names without mutating the project', () => {
  const project = readBmh(
    new Uint8Array(readFileSync('tests/fixtures/bmh/original-long-name.bmh')),
  );
  const name = 'A🎵B한C¥D〜E简F';
  project.divisions.push(createDivision(project.source, defaultDivisionSetting(name, 480)));
  const changes: BmhNameChange[] = [];
  assert.deepEqual(
    writeBmh(project, (change) => changes.push(change)),
    new Uint8Array(readFileSync('tests/fixtures/bmh/original-lossy-name.bmh')),
  );
  assert.deepEqual(changes, [{ original: name, exported: 'A??B?C\\D?E?F' }]);
  assert.equal(project.divisions[1].name, name);
});

test('handles best-fit mappings, NUL termination and out-of-range integers', () => {
  const project = readBmh(original);
  for (const [name, exported] of [
    ['🎵', '??'],
    ['bad\0name', 'bad'],
    ['\ud800', '?'],
    ['¥', '\\'],
    ['〜', '?'],
    ['ÀÉßゔ', 'AEsヴ'],
  ]) {
    project.divisions[0].name = name;
    assert.equal(readBmh(writeBmh(project)).divisions[0].name, exported);
  }
  project.divisions[0].name = 'ｺｰﾄﾞ①髙';
  assert.equal(readBmh(writeBmh(project)).divisions[0].name, 'ｺｰﾄﾞ①髙');
  project.source.notes[0].position = 0x80000000;
  assert.throws(() => writeBmh(project), /32-bit integer/);
});
