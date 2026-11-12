/**
 * Standard MIDI File (SMF) format 0/1 reader and writer for the BMHelper
 * sub-feature.
 *
 * Scope mirrors the original BMHelper: notes are identified by pitch, gate
 * length and velocity only — control change, pitch bend and program change
 * are parsed (and kept on read) but never drive behaviour, and the recording
 * export writes no tempo or time-signature meta. SMPTE time-coded divisions
 * are rejected with an explicit error. Note pairing is keyed by pitch only,
 * so an overlapping second note-on of the same pitch is silently dropped —
 * both faithful to the original.
 */

export interface MidiNoteEvent {
  position: number;
  gate: number;
  nn: number;
  vel: number;
}

export interface MidiParamEvent {
  position: number;
  value: number;
}

export interface MidiControlEvent {
  position: number;
  value: number;
  cc: number;
}

export interface MidiSequence {
  /** Ticks per quarter note; the unit every position in this file uses. */
  quantize: number;
  notes: MidiNoteEvent[];
  pitches: MidiParamEvent[];
  controls: MidiControlEvent[];
}

export interface SmfTrackInfo {
  index: number;
  name: string;
  noteCount: number;
}

export class SmfFormatError extends Error {}

interface ChannelEvent {
  tick: number;
  status: number;
  d0: number;
  d1: number;
}

interface ParsedTrack {
  name: string;
  events: ChannelEvent[];
}

interface ParsedFile {
  division: number;
  format: number;
  tracks: ParsedTrack[];
}

class ByteReader {
  private pos = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get position(): number {
    return this.pos;
  }

  get remaining(): number {
    return this.bytes.length - this.pos;
  }

  u8(): number {
    if (this.pos >= this.bytes.length) throw new SmfFormatError('unexpected end of MIDI data');
    return this.bytes[this.pos++];
  }

  u16(): number {
    if (this.pos + 2 > this.bytes.length) throw new SmfFormatError('unexpected end of MIDI data');
    const value = (this.bytes[this.pos] << 8) | this.bytes[this.pos + 1];
    this.pos += 2;
    return value;
  }

  u32(): number {
    if (this.pos + 4 > this.bytes.length) throw new SmfFormatError('unexpected end of MIDI data');
    const value =
      this.bytes[this.pos] * 0x1000000 +
      (this.bytes[this.pos + 1] << 16) +
      (this.bytes[this.pos + 2] << 8) +
      this.bytes[this.pos + 3];
    this.pos += 4;
    return value;
  }

  varlen(): number {
    let value = 0;
    for (;;) {
      const byte = this.u8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
  }

  raw(length: number): Uint8Array {
    if (this.pos + length > this.bytes.length)
      throw new SmfFormatError('unexpected end of MIDI data');
    const out = this.bytes.subarray(this.pos, this.pos + length);
    this.pos += length;
    return out;
  }

  skip(length: number): void {
    if (this.pos + length > this.bytes.length)
      throw new SmfFormatError('unexpected end of MIDI data');
    this.pos += length;
  }
}

function parseTrack(reader: ByteReader, end: number): ParsedTrack {
  let tick = 0;
  let running = 0;
  let name = '';
  const events: ChannelEvent[] = [];
  while (reader.position < end) {
    tick += reader.varlen();
    let status = reader.u8();
    if (status < 0x80) {
      if (running === 0) throw new SmfFormatError('running status without a status byte');
      // Re-use the running status: the byte just read is the first data byte,
      // so step back and re-read it through the normal path.
      reader.skip(-1);
      status = running;
    } else if (status < 0xf0) {
      running = status;
    }
    if (status === 0xff) {
      const type = reader.u8();
      const length = reader.varlen();
      const data = reader.raw(length);
      if (type === 0x03 && name === '') {
        name = new TextDecoder('utf-8').decode(data).replace(/\0+$/, '');
      } else if (type === 0x2f) {
        break; // end of track
      }
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      reader.skip(reader.varlen()); // sysex: parsed away
      continue;
    }
    const kind = status & 0xf0;
    let d0: number;
    let d1 = 0;
    if (kind === 0xc0 || kind === 0xd0) {
      d0 = reader.u8();
    } else {
      d0 = reader.u8();
      d1 = reader.u8();
    }
    events.push({ tick, status, d0, d1 });
  }
  return { name, events };
}

/** Pairs note-ons with the next note-off of the same pitch (original rule). */
interface PairedNote extends MidiNoteEvent {
  channel: number;
}

function pairTrack(events: ChannelEvent[]): {
  notes: PairedNote[];
  pitches: MidiParamEvent[];
  controls: MidiControlEvent[];
} {
  const open = new Map<number, { tick: number; vel: number; channel: number }>();
  const notes: PairedNote[] = [];
  const pitches: MidiParamEvent[] = [];
  const controls: MidiControlEvent[] = [];
  for (const ev of events) {
    const kind = ev.status & 0xf0;
    const channel = ev.status & 0x0f;
    if (kind === 0x90 && ev.d1 > 0) {
      // std::map::insert semantics: an already-open same-pitch note is kept.
      if (!open.has(ev.d0)) open.set(ev.d0, { tick: ev.tick, vel: ev.d1, channel });
    } else if (kind === 0x80 || (kind === 0x90 && ev.d1 === 0)) {
      const on = open.get(ev.d0);
      if (on !== undefined) {
        notes.push({
          position: on.tick,
          gate: ev.tick - on.tick,
          nn: ev.d0,
          vel: on.vel,
          channel: on.channel,
        });
        open.delete(ev.d0);
      }
    } else if (kind === 0xe0) {
      pitches.push({ position: ev.tick, value: ev.d0 | (ev.d1 << 7) });
    } else if (kind === 0xb0) {
      controls.push({ position: ev.tick, value: ev.d1, cc: ev.d0 });
    }
  }
  notes.sort((a, b) => a.position - b.position);
  return { notes, pitches, controls };
}

function parseSmf(bytes: Uint8Array): ParsedFile {
  const reader = new ByteReader(bytes);
  if (reader.u32() !== 0x4d546864)
    throw new SmfFormatError('not a Standard MIDI File (missing MThd)');
  const headerSize = reader.u32();
  if (headerSize < 6) throw new SmfFormatError('malformed MIDI header');
  const format = reader.u16();
  if (format !== 0 && format !== 1) {
    throw new SmfFormatError(`unsupported MIDI format ${format} (only 0 and 1)`);
  }
  const trackCount = reader.u16();
  const division = reader.u16();
  if ((division & 0x8000) !== 0) {
    throw new SmfFormatError('SMPTE-time-coded MIDI files are not supported');
  }
  reader.skip(headerSize - 6);
  const tracks: ParsedTrack[] = [];
  for (let index = 0; index < trackCount && reader.remaining >= 8; index++) {
    if (reader.u32() !== 0x4d54726b) throw new SmfFormatError('missing MTrk chunk');
    const size = reader.u32();
    const end = reader.position + size;
    tracks.push(parseTrack(reader, end));
    reader.skip(end - reader.position);
  }
  return { division, format, tracks };
}

/** Lists the tracks of an SMF file for the import dialog. */
export function inspectSmf(bytes: Uint8Array): {
  division: number;
  format: number;
  tracks: SmfTrackInfo[];
} {
  const parsed = parseSmf(bytes);
  return {
    division: parsed.division,
    format: parsed.format,
    tracks: parsed.tracks.map((track, index) => ({
      index,
      name: track.name,
      noteCount: pairTrack(track.events).notes.length,
    })),
  };
}

/** Extracts one track's notes (filtered by channel) as a sequence. */
export function readSmfSequence(
  bytes: Uint8Array,
  trackIndex: number,
  channels: ReadonlySet<number>,
): MidiSequence {
  const parsed = parseSmf(bytes);
  if (trackIndex < 0 || trackIndex >= parsed.tracks.length) {
    throw new SmfFormatError(`no such MIDI track: ${trackIndex}`);
  }
  const paired = pairTrack(parsed.tracks[trackIndex].events);
  const notes = paired.notes
    .filter((note) => channels.has(note.channel))
    .map(({ channel: _channel, ...note }) => note);
  return { quantize: parsed.division, notes, pitches: paired.pitches, controls: paired.controls };
}

function pushVarlen(target: number[], value: number): void {
  if (value < 0) throw new RangeError('negative MIDI delta time');
  const buffer = [value & 0x7f];
  for (let rest = value >> 7; rest > 0; rest >>= 7) {
    buffer.unshift((rest & 0x7f) | 0x80);
  }
  target.push(...buffer);
}

/**
 * Writes the recording sequence as a format-1 SMF, mirroring the original
 * export: track 0 holds only the end-of-track meta, track 1 holds the notes
 * on channel 0, and no tempo or time-signature meta is written.
 */
export function writeSmfSequence(sequence: MidiSequence): Uint8Array {
  interface TimedEvent {
    tick: number;
    order: number;
    bytes: number[];
  }
  const events: TimedEvent[] = [];
  for (const note of sequence.notes) {
    const vel = Math.max(1, Math.min(127, Math.trunc(note.vel)));
    const nn = Math.max(0, Math.min(127, Math.trunc(note.nn)));
    const gate = Math.max(0, Math.trunc(note.gate));
    events.push({
      tick: Math.max(0, Math.trunc(note.position)),
      order: events.length,
      bytes: [0x90, nn, vel],
    });
    events.push({
      tick: Math.max(0, Math.trunc(note.position)) + gate,
      order: events.length,
      bytes: [0x80, nn, 0],
    });
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const track: number[] = [];
  let last = 0;
  for (const event of events) {
    pushVarlen(track, event.tick - last);
    track.push(...event.bytes);
    last = event.tick;
  }
  track.push(0x00, 0xff, 0x2f, 0x00);

  const out: number[] = [];
  const ascii = (text: string) => {
    for (const ch of text) out.push(ch.charCodeAt(0));
  };
  const u32 = (value: number) =>
    out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  const u16 = (value: number) => out.push((value >> 8) & 0xff, value & 0xff);
  ascii('MThd');
  u32(6);
  u16(1); // format 1
  u16(2); // track 0 = EOT only, track 1 = notes
  u16(sequence.quantize & 0x7fff);
  ascii('MTrk');
  u32(4);
  out.push(0x00, 0xff, 0x2f, 0x00);
  ascii('MTrk');
  u32(track.length);
  out.push(...track);
  return Uint8Array.from(out);
}
