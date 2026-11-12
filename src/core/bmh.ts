/**
 * .bmh project persistence — a byte-compatible port of the original
 * BMHelper project file (serialize.h / project.cpp): a RIFF-like chunk tree,
 * little-endian, no file-level wrapper. A chunk tag whose first byte is an
 * ASCII capital letter is a container (payload = concatenated children);
 * anything else is a data leaf.
 *
 *   BMHP
 *     Src   (container)           source MIDI sequence
 *       qntz  i32                 ticks per quarter note
 *       note  16 B × n            { i32 position, gate, nn, vel }
 *       ptch   8 B × n            { i32 position, value }            (unused)
 *       cchg  12 B × n            { i32 position, value, cc }        (unused)
 *     Div   (container) × n       one per division
 *       Midi  (container)         the recording sequence, same layout as Src
 *       name  raw bytes           division name (original files use ANSI/Shift-JIS)
 *       s2df  i32 × n             definition index per source note
 *       dfnt  12 B × n            { u32 zz_low, u32 zz_high, i32 div }
 *
 * The div notes themselves are not stored: they are rebuilt from the
 * recording sequence (positions/gates/averaged values) and the
 * s2df→dfnt mapping, exactly like the original reopens a project.
 */

import type { MidiControlEvent, MidiNoteEvent, MidiParamEvent, MidiSequence } from './smf.js';
import type { BmhDefinition, Division, DivNote } from './bmhelper.js';

export interface BmhProject {
  source: MidiSequence;
  divisions: Division[];
}

export class BmhFormatError extends Error {}

interface Chunk {
  tag: string;
  payload: Uint8Array;
}

// --- byte helpers -----------------------------------------------------------

class ByteWriter {
  readonly bytes: number[] = [];

  ascii(text: string): this {
    for (const ch of text) this.bytes.push(ch.charCodeAt(0) & 0xff);
    return this;
  }

  u32(value: number): this {
    this.bytes.push(
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    );
    return this;
  }

  i32(value: number): this {
    return this.u32(value < 0 ? value + 0x100000000 : value);
  }

  raw(bytes: Uint8Array): this {
    this.bytes.push(...bytes);
    return this;
  }
}

class ByteReader {
  private pos = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.pos >= this.bytes.length;
  }

  ascii(length: number): string {
    if (this.pos + length > this.bytes.length) throw new BmhFormatError('truncated chunk tag');
    let text = '';
    for (let i = 0; i < length; i++) text += String.fromCharCode(this.bytes[this.pos + i]);
    this.pos += length;
    return text;
  }

  u32(): number {
    if (this.pos + 4 > this.bytes.length) throw new BmhFormatError('truncated chunk size');
    const value =
      this.bytes[this.pos] * 0x1000000 +
      (this.bytes[this.pos + 1] << 16) +
      (this.bytes[this.pos + 2] << 8) +
      this.bytes[this.pos + 3];
    this.pos += 4;
    return value;
  }

  i32(): number {
    const raw = this.u32();
    return raw >= 0x80000000 ? raw - 0x100000000 : raw;
  }

  i32Array(count: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(this.i32());
    return out;
  }

  raw(length: number): Uint8Array {
    if (this.pos + length > this.bytes.length) throw new BmhFormatError('truncated chunk payload');
    const out = this.bytes.subarray(this.pos, this.pos + length);
    this.pos += length;
    return out;
  }
}

// --- chunk tree -------------------------------------------------------------

function chunk(tag: string, payload: Uint8Array): Uint8Array {
  const writer = new ByteWriter();
  writer.ascii(tag).u32(payload.length).raw(payload);
  return Uint8Array.from(writer.bytes);
}

function containerChunk(tag: string, children: Uint8Array[]): Uint8Array {
  let size = 0;
  for (const child of children) size += child.length;
  const writer = new ByteWriter();
  writer.ascii(tag).u32(size);
  for (const child of children) writer.raw(child);
  return Uint8Array.from(writer.bytes);
}

function childrenOf(chunk: Chunk): Chunk[] {
  const reader = new ByteReader(chunk.payload);
  const children: Chunk[] = [];
  while (!reader.done) {
    const tag = reader.ascii(4);
    const size = reader.u32();
    children.push({ tag, payload: reader.raw(size) });
  }
  return children;
}

function child(children: Chunk[], tag: string): Chunk {
  const found = children.find((c) => c.tag === tag);
  if (!found) throw new BmhFormatError('missing chunk: ' + tag);
  return found;
}

// --- sequence <-> Midi chunk ------------------------------------------------

function i32LePayload(values: number[]): Uint8Array {
  const writer = new ByteWriter();
  for (const value of values) writer.i32(value);
  return Uint8Array.from(writer.bytes);
}

/** The qntz/note/ptch/cchg children shared by the Src and Midi containers. */
function serializeSequenceChildren(sequence: MidiSequence): Uint8Array[] {
  const notes: number[] = [];
  for (const note of sequence.notes) {
    notes.push(note.position, note.gate, note.nn, note.vel);
  }
  const pitches: number[] = [];
  for (const event of sequence.pitches) pitches.push(event.position, event.value);
  const controls: number[] = [];
  for (const event of sequence.controls) controls.push(event.position, event.value, event.cc);
  return [
    chunk('qntz', i32LePayload([sequence.quantize])),
    chunk('note', i32LePayload(notes)),
    chunk('ptch', i32LePayload(pitches)),
    chunk('cchg', i32LePayload(controls)),
  ];
}

function parseMidiChunk(chunk: Chunk): MidiSequence {
  const children = childrenOf(chunk);
  const qntz = new ByteReader(child(children, 'qntz').payload).i32();
  const notePayload = child(children, 'note').payload;
  if (notePayload.length % 16 !== 0) throw new BmhFormatError('malformed note chunk');
  const reader = new ByteReader(notePayload);
  const notes: MidiNoteEvent[] = [];
  for (let i = 0; i < notePayload.length / 16; i++) {
    notes.push({ position: reader.i32(), gate: reader.i32(), nn: reader.i32(), vel: reader.i32() });
  }
  const pitchPayload = child(children, 'ptch').payload;
  const pitchReader = new ByteReader(pitchPayload);
  const pitches: MidiParamEvent[] = [];
  for (let i = 0; i + 8 <= pitchPayload.length; i += 8) {
    pitches.push({ position: pitchReader.i32(), value: pitchReader.i32() });
  }
  const controlPayload = child(children, 'cchg').payload;
  const controlReader = new ByteReader(controlPayload);
  const controls: MidiControlEvent[] = [];
  for (let i = 0; i + 12 <= controlPayload.length; i += 12) {
    controls.push({
      position: controlReader.i32(),
      value: controlReader.i32(),
      cc: controlReader.i32(),
    });
  }
  return { quantize: qntz, notes, pitches, controls };
}

// --- name encoding ----------------------------------------------------------

function encodeName(name: string): Uint8Array {
  return new TextEncoder().encode(name);
}

function decodeName(bytes: Uint8Array): string {
  // Original projects store ANSI/Shift-JIS names; ours write UTF-8.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('shift_jis').decode(bytes);
    } catch {
      return new TextDecoder('latin1').decode(bytes);
    }
  }
}

// --- division <-> Div chunk -------------------------------------------------

function serializeDivisionChunk(division: Division): Uint8Array {
  const s2df = i32LePayload(division.src2def);
  const dfntWriter = new ByteWriter();
  for (const definition of division.definitions) {
    const zz = ((definition.zz % 1296) + 1296) % 1296;
    const high = Math.floor(zz / 36);
    const low = zz % 36;
    dfntWriter.u32(low).u32(high).i32(definition.div);
  }
  return containerChunk('Div ', [
    containerChunk(
      'Midi',
      serializeSequenceChildren({
        quantize: division.quantize,
        notes: division.recording,
        pitches: [],
        controls: [],
      }),
    ),
    chunk('name', encodeName(division.name)),
    chunk('s2df', s2df),
    chunk('dfnt', Uint8Array.from(dfntWriter.bytes)),
  ]);
}

function parseDivisionChunk(chunk: Chunk, sourceNoteCount: number): Division {
  const children = childrenOf(chunk);
  const recording = parseMidiChunk(child(children, 'Midi'));
  const name = decodeName(child(children, 'name').payload);
  const s2df = new ByteReader(child(children, 's2df').payload).i32Array(sourceNoteCount);
  const dfntPayload = child(children, 'dfnt').payload;
  if (dfntPayload.length % 12 !== 0) throw new BmhFormatError('malformed dfnt chunk');
  const dfntReader = new ByteReader(dfntPayload);
  const definitions: BmhDefinition[] = [];
  for (let i = 0; i < dfntPayload.length / 12; i++) {
    const low = dfntReader.u32();
    const high = dfntReader.u32();
    const div = dfntReader.i32();
    definitions.push({ zz: high * 36 + low, div });
  }

  // Rebuild the div notes: the recording sequence IS the div-note list in
  // sorted order; referrers come from walking s2def→dfnt backwards.
  const divCount = definitions.reduce((max, definition) => Math.max(max, definition.div + 1), 0);
  const notes: DivNote[] = recording.notes.map((note) => ({
    nn: note.nn,
    gate: note.gate,
    vel: note.vel,
    recPos: note.position,
    referrers: [],
  }));
  s2df.forEach((definitionIndex, sourceIndex) => {
    const definition = definitions[definitionIndex];
    if (definition === undefined) throw new BmhFormatError('s2def references a missing definition');
    notes[definition.div]?.referrers.push(sourceIndex);
  });
  if (notes.length < divCount)
    throw new BmhFormatError('division list is inconsistent with the definitions');
  return {
    name,
    quantize: recording.quantize,
    notes,
    recording: recording.notes,
    definitions,
    src2def: s2df,
    zzDefinition: true, // session default after a reload (the mode is not serialized)
  };
}

// --- project ----------------------------------------------------------------

/** Serializes a project into the original .bmh chunk-tree format. */
export function writeBmh(project: BmhProject): Uint8Array {
  // NB: the source sequence's qntz/note/ptch/cchg children sit DIRECTLY in
  // the Src container — the extra Midi wrapper only exists inside Div.
  const children = [containerChunk('Src ', serializeSequenceChildren(project.source))];
  for (const division of project.divisions) children.push(serializeDivisionChunk(division));
  return containerChunk('BMHP', children);
}

/** Parses an original or reimplementation .bmh project file. */
export function readBmh(bytes: Uint8Array): BmhProject {
  const reader = new ByteReader(bytes);
  const tag = reader.ascii(4);
  if (tag !== 'BMHP') throw new BmhFormatError('not a BMHelper project (missing BMHP)');
  const size = reader.u32();
  const root = { tag, payload: reader.raw(size) };
  const children = childrenOf(root);
  const source = parseMidiChunk(child(children, 'Src '));
  const divisions: Division[] = [];
  for (const entry of children) {
    if (entry.tag === 'Div ') divisions.push(parseDivisionChunk(entry, source.notes.length));
  }
  return { source, divisions };
}
