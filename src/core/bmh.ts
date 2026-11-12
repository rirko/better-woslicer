/**
 * Original Windows BMHelper beta 4′ persistence: a RIFF-like chunk tree,
 * little-endian integers, no file-level wrapper. A chunk tag whose first byte is
 * an ASCII capital letter is a container (payload = concatenated children);
 * anything else is a data leaf.
 *
 *   BMHP
 *     Src   (container)           source MIDI sequence
 *       qntz  i32                 ticks per quarter note
 *       note  16 B, repeated      { i32 position, gate, nn, vel }
 *       ptch   8 B, repeated      { i32 position, value }
 *       ccgh  12 B, repeated      { i32 position, value, cc }
 *     Div   (container) × n       one per division
 *       Midi  (container)         the recording sequence, same layout as Src
 *       name  raw bytes           division name (original files use ANSI/Shift-JIS)
 *       s2df  i32 × n             definition index per source note
 *       dfnt  12 B, repeated      { u32 zz_low, u32 zz_high, i32 div }
 *
 * This layout is locked. See docs/BMH_FORMAT.md for source evidence and fixtures.
 *
 * The div notes themselves are not stored: they are rebuilt from the
 * recording sequence (positions/gates/averaged values) and the
 * s2df→dfnt mapping.
 */

import type { MidiControlEvent, MidiNoteEvent, MidiParamEvent, MidiSequence } from './smf.js';
import type { BmhDefinition, Division, DivNote } from './bmhelper.js';
import { CP932_BEST_FIT } from './cp932-best-fit.js';

export interface BmhProject {
  source: MidiSequence;
  divisions: Division[];
}

export class BmhFormatError extends Error {}

export interface BmhNameChange {
  original: string;
  exported: string;
}

interface Chunk {
  tag: string;
  payload: Uint8Array;
}

// --- byte helpers -----------------------------------------------------------

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
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 4).getUint32(
      0,
      true,
    );
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
  return containerChunk(tag, [payload]);
}

function containerChunk(tag: string, children: Uint8Array[]): Uint8Array {
  let size = 0;
  for (const child of children) size += child.length;
  const bytes = new Uint8Array(8 + size);
  for (let i = 0; i < 4; i++) bytes[i] = tag.charCodeAt(i);
  new DataView(bytes.buffer).setUint32(4, size, true);
  let offset = 8;
  for (const child of children) {
    bytes.set(child, offset);
    offset += child.length;
  }
  return bytes;
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

function i32Payload(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => {
    if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff)
      throw new BmhFormatError('value does not fit a BMH signed 32-bit integer');
    view.setInt32(index * 4, value, true);
  });
  return bytes;
}

/** The qntz/note/ptch/ccgh children shared by the Src and Midi containers. */
function serializeSequenceChildren(sequence: MidiSequence): Uint8Array[] {
  const children = [chunk('qntz', i32Payload([sequence.quantize]))];
  for (const note of sequence.notes) {
    children.push(chunk('note', i32Payload([note.position, note.gate, note.nn, note.vel])));
  }
  for (const event of sequence.pitches)
    children.push(chunk('ptch', i32Payload([event.position, event.value])));
  // The original uses a map keyed by controller number. Preserve order within each lane.
  for (const event of [...sequence.controls].sort((a, b) => a.cc - b.cc))
    children.push(chunk('ccgh', i32Payload([event.position, event.value, event.cc])));
  return children;
}

function leafReader(entry: Chunk, size: number): ByteReader {
  if (entry.payload.length !== size) throw new BmhFormatError('malformed ' + entry.tag + ' chunk');
  return new ByteReader(entry.payload);
}

function parseMidiChunk(entry: Chunk): MidiSequence {
  const children = childrenOf(entry);
  const qntz = leafReader(child(children, 'qntz'), 4).i32();
  if (qntz <= 0) throw new BmhFormatError('invalid BMH quantize');
  const notes: MidiNoteEvent[] = [];
  const pitches: MidiParamEvent[] = [];
  const controls: MidiControlEvent[] = [];
  for (const event of children) {
    if (event.tag === 'note') {
      const reader = leafReader(event, 16);
      notes.push({
        position: reader.i32(),
        gate: reader.i32(),
        nn: reader.i32(),
        vel: reader.i32(),
      });
    } else if (event.tag === 'ptch') {
      const reader = leafReader(event, 8);
      pitches.push({ position: reader.i32(), value: reader.i32() });
    } else if (event.tag === 'ccgh') {
      const reader = leafReader(event, 12);
      controls.push({ position: reader.i32(), value: reader.i32(), cc: reader.i32() });
    }
  }
  return { quantize: qntz, notes, pitches, controls };
}

// --- name encoding ----------------------------------------------------------

// Web platforms provide a CP932-compatible decoder, but no encoder. Build its
// reverse table once, on the first non-ASCII name. Prefer the first byte mapping.
const nameDecoder = new TextDecoder('shift_jis', { fatal: true });
let nameEncoding: Map<string, number> | undefined;

function nameEncodingTable(): Map<string, number> {
  if (nameEncoding) return nameEncoding;
  const table = new Map<string, number>();
  for (let code = 0; code <= 0xffff; code++) {
    const lead = code >>> 8;
    if (code > 0xff && !((lead >= 0x81 && lead <= 0x9f) || (lead >= 0xe0 && lead <= 0xfc)))
      continue;
    const bytes = code <= 0xff ? Uint8Array.of(code) : Uint8Array.of(lead, code & 0xff);
    try {
      const character = nameDecoder.decode(bytes);
      if ([...character].length === 1 && !table.has(character)) table.set(character, code);
    } catch {
      // Unassigned byte sequences have no reverse mapping.
    }
  }
  nameEncoding = table;
  return table;
}

function encodeName(name: string): Uint8Array {
  const bytes: number[] = [];
  // Windows converts each UTF-16 code unit: a non-BMP character becomes '??'.
  for (let index = 0; index < name.length; index++) {
    const character = name[index];
    const ascii = character.charCodeAt(0);
    // Match the original's NUL-terminated name handling; report the truncated result.
    if (ascii === 0) break;
    const code =
      ascii < 0x80
        ? ascii
        : (nameEncodingTable().get(character) ?? CP932_BEST_FIT.get(character) ?? 0x3f);
    if (code > 0xff) bytes.push(code >>> 8);
    bytes.push(code & 0xff);
  }
  return Uint8Array.from(bytes);
}

function decodeName(bytes: Uint8Array): string {
  try {
    if (bytes.includes(0)) throw new BmhFormatError('NUL in BMH division name');
    return nameDecoder.decode(bytes);
  } catch {
    throw new BmhFormatError('invalid Windows-31J (CP932) division name');
  }
}

// --- division <-> Div chunk -------------------------------------------------

function serializeDivisionChunk(
  division: Division,
  onNameChange?: (change: BmhNameChange) => void,
): Uint8Array {
  const name = encodeName(division.name);
  const exported = decodeName(name);
  if (exported !== division.name) onNameChange?.({ original: division.name, exported });
  const children = [
    containerChunk(
      'Midi',
      serializeSequenceChildren({
        quantize: division.quantize,
        notes: division.recording,
        pitches: [],
        controls: [],
      }),
    ),
    chunk('name', name),
    chunk('s2df', i32Payload(division.src2def)),
  ];
  for (const definition of division.definitions) {
    const zz = ((definition.zz % 1296) + 1296) % 1296;
    children.push(chunk('dfnt', i32Payload([zz % 36, Math.floor(zz / 36), definition.div])));
  }
  return containerChunk('Div ', children);
}

function parseDivisionChunk(chunk: Chunk, sourceNoteCount: number): Division {
  const children = childrenOf(chunk);
  const recording = parseMidiChunk(child(children, 'Midi'));
  const name = decodeName(child(children, 'name').payload);
  const s2df = leafReader(child(children, 's2df'), sourceNoteCount * 4).i32Array(sourceNoteCount);
  const definitions: BmhDefinition[] = [];
  for (const entry of children) {
    if (entry.tag !== 'dfnt') continue;
    const dfntReader = leafReader(entry, 12);
    const low = dfntReader.u32();
    const high = dfntReader.u32();
    const div = dfntReader.i32();
    if (low >= 36 || high >= 36 || div < 0 || div >= recording.notes.length)
      throw new BmhFormatError('invalid BMH definition');
    definitions.push({ zz: high * 36 + low, div });
  }

  // Rebuild the div notes: the recording sequence IS the div-note list in
  // sorted order; referrers come from walking s2def→dfnt backwards.
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

/** Writes the original Windows BMHelper beta 4′ format. */
export function writeBmh(
  project: BmhProject,
  onNameChange?: (change: BmhNameChange) => void,
): Uint8Array {
  // NB: the source sequence's qntz/note/ptch/ccgh children sit DIRECTLY in
  // the Src container — the extra Midi wrapper only exists inside Div.
  const children = [containerChunk('Src ', serializeSequenceChildren(project.source))];
  for (const division of project.divisions)
    children.push(serializeDivisionChunk(division, onNameChange));
  return containerChunk('BMHP', children);
}

/** Reads the original Windows BMHelper beta 4′ format. */
export function readBmh(bytes: Uint8Array): BmhProject {
  const reader = new ByteReader(bytes);
  const tag = reader.ascii(4);
  if (tag !== 'BMHP') throw new BmhFormatError('not a BMHelper project (missing BMHP)');
  const size = reader.u32();
  const root = { tag, payload: reader.raw(size) };
  if (!reader.done) throw new BmhFormatError('unexpected data after BMHP');
  const children = childrenOf(root);
  const source = parseMidiChunk(child(children, 'Src '));
  const divisions: Division[] = [];
  for (const entry of children) {
    if (entry.tag === 'Div ') divisions.push(parseDivisionChunk(entry, source.notes.length));
  }
  return { source, divisions };
}
