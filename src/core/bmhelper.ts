/**
 * BMHelper division algorithm — a faithful port of the original Be-Music
 * Helper (beta 4') core (division.cpp): turns a source MIDI note sequence
 * into a "division" — a recording sequence (notes re-arranged onto a beat
 * grid so a DAW can render every key sound one by one) plus the WAVE
 * definitions that map each rendered file back to the original note places.
 *
 * Everything here is intentional, mirroring the original:
 *  - greedy unification clusters (pitch must match exactly; gate/velocity
 *    tolerance chains transitively),
 *  - gate×velocity band splitting with integer-averaged div notes,
 *  - descending gate/velocity sort chains,
 *  - whole-beat recording layout (note-off → next note-on gap, rounded up),
 *  - base-36 "ZZ" definition ids (00..ZZ) with the 00-FF-shaped restricted
 *    mode, multi-definition round-robin over occurrence gaps,
 *  - the three BMSE-clipboard products ("BMSE ClipBoard Object Data
 *    Format", positions in 48-per-quarter units, decimal fields).
 */

import { BMSE_CLIPBOARD_FORMAT_NAME } from './bmse.js';
import type { MidiNoteEvent, MidiSequence } from './smf.js';

// One source of truth for the BMSE clipboard header: cutPositionsClipboard's
// output is the exact input of the BMSE clipboard reader, so the write side
// re-exports the reader's constant instead of holding its own copy.
export const BMSE_CLIPBOARD_HEADER = BMSE_CLIPBOARD_FORMAT_NAME;
/** Clipboard positions per quarter note: 192 ticks per 4/4 measure = 48/beat. */
const BEAT_UNITS_PER_QUARTER = 48;
const ZZ_RADIX = 36;
const ZZ_MAX = ZZ_RADIX * ZZ_RADIX - 1; // "ZZ"
const ZZ_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export type SortType =
  | 'none'
  | 'nn_gate_vel'
  | 'nn_vel_gate'
  | 'gate_nn_vel'
  | 'gate_vel_nn'
  | 'vel_nn_gate'
  | 'vel_gate_nn';

export interface DivisionSetting {
  name: string;
  /** Keep every source note as its own sound; only shift by the head margin. */
  srcCopy: boolean;
  /** Silent head before the first recording note, in ticks. */
  headMargin: number;
  /** Minimal silence between two recording notes, in ticks. */
  minInterval: number;
  sortType: SortType;
  /** Notes whose gate differs by at most this unify into one sound. */
  gateThreshold: number;
  /** Same for velocity. */
  velocityThreshold: number;
  /** Allow the full base-36 00..ZZ id range (off = 00..FF shaped ids only). */
  zzDefinition: boolean;
  /** Give one sound several definitions so repeats stay audibly separate. */
  mlDefinition: boolean;
  /** First definition id (a base-36 ZZ value, 0..1295). */
  startDefinition: number;
  /** Minimal free gap two uses of the same definition must keep, in ticks. */
  mlThreshold: number;
}

/** One unique sound: the integer average of its unified source notes. */
export interface DivNote {
  nn: number;
  gate: number;
  vel: number;
  /** Recording position in the division sequence, in ticks. */
  recPos: number;
  /** Indices of the source notes this sound stands in for. */
  referrers: number[];
}

export interface BmhDefinition {
  /** Base-36 ZZ value (high*36+low, 0..1295). */
  zz: number;
  /** Div-note index this definition renders. */
  div: number;
}

export interface Division {
  name: string;
  quantize: number;
  /** Div notes in recording (sorted) order. */
  notes: DivNote[];
  /** The recording sequence: one note per div note, on the beat grid. */
  recording: MidiNoteEvent[];
  definitions: BmhDefinition[];
  /** Definition index per source note (source notes in position order). */
  src2def: number[];
  /**
   * Numbering mode used by transpose/start-number actions. DX projects preserve
   * this flag. Original BMH files omit it and reopen in ZZ mode.
   */
  zzDefinition: boolean;
}

/** The default values of the original 新規分割 dialog. */
export function defaultDivisionSetting(name: string, quantize: number): DivisionSetting {
  return {
    name,
    srcCopy: false,
    headMargin: 0,
    minInterval: quantize,
    sortType: 'nn_gate_vel',
    gateThreshold: Math.trunc(quantize / 8),
    velocityThreshold: 5,
    zzDefinition: true,
    mlDefinition: true,
    startDefinition: 1,
    mlThreshold: Math.trunc(quantize / 2),
  };
}

function zzDigits(zz: number): { high: number; low: number } {
  return { high: Math.floor(zz / ZZ_RADIX), low: zz % ZZ_RADIX };
}

/** Renders a ZZ value as its two base-36 digits, e.g. 1 → "01", 35 → "0Z". */
export function zzToString(zz: number): string {
  const { high, low } = zzDigits(zz);
  return ZZ_DIGITS[high] + ZZ_DIGITS[low];
}

function stepZz(zz: number, ffMode: boolean, delta: 1 | -1): number {
  const limit = ffMode ? 16 : ZZ_RADIX;
  let { high, low } = zzDigits(zz);
  low += delta;
  if (low < 0) {
    low = limit - 1;
    high += delta;
  } else if (low >= limit) {
    low = 0;
    high += delta;
  }
  if (high < 0) high = limit - 1;
  if (high >= limit) high = 0;
  return high * ZZ_RADIX + low;
}

export function nextZz(zz: number, ffMode: boolean): number {
  return stepZz(zz, ffMode, 1);
}

export function prevZz(zz: number, ffMode: boolean): number {
  return stepZz(zz, ffMode, -1);
}

interface WorkNote {
  nn: number;
  gate: number;
  vel: number;
  recPos: number;
  referrers: number[];
}

/** Greedy unification: the first cluster with a compatible member wins. */
function unify(src: MidiNoteEvent[], setting: DivisionSetting): number[][] {
  const clusters: number[][] = [];
  for (let i = 0; i < src.length; i++) {
    const note = src[i];
    let placed = false;
    for (const cluster of clusters) {
      if (
        cluster.some(
          (j) =>
            src[j].nn === note.nn &&
            Math.abs(src[j].gate - note.gate) <= setting.gateThreshold &&
            Math.abs(src[j].vel - note.vel) <= setting.velocityThreshold,
        )
      ) {
        cluster.push(i);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([i]);
  }
  return clusters;
}

/** Band index for a value: edges at min + (k+1)*range/bands (integer math). */
function bandOf(value: number, min: number, range: number, bands: number): number {
  for (let band = 0; band < bands - 1; band++) {
    if (value < min + Math.trunc(((band + 1) * range) / bands)) return band;
  }
  return bands - 1;
}

/** Splits one cluster into a gate×velocity grid of averaged div notes. */
function splitCluster(
  members: number[],
  src: MidiNoteEvent[],
  setting: DivisionSetting,
): WorkNote[] {
  const minGate = Math.min(...members.map((i) => src[i].gate));
  const maxGate = Math.max(...members.map((i) => src[i].gate));
  const minVel = Math.min(...members.map((i) => src[i].vel));
  const maxVel = Math.max(...members.map((i) => src[i].vel));
  const gateBands = Math.max(1, Math.ceil((maxGate - minGate) / (setting.gateThreshold + 1)));
  const velBands = Math.max(1, Math.ceil((maxVel - minVel) / (setting.velocityThreshold + 1)));
  const cells: number[][] = Array.from({ length: gateBands * velBands }, () => []);
  for (const i of members) {
    const bg = bandOf(src[i].gate, minGate, maxGate - minGate, gateBands);
    const bv = bandOf(src[i].vel, minVel, maxVel - minVel, velBands);
    cells[bg * velBands + bv].push(i);
  }
  const out: WorkNote[] = [];
  for (const cell of cells) {
    if (cell.length === 0) continue;
    const avg = (pick: (i: number) => number) =>
      Math.trunc(cell.reduce((sum, i) => sum + pick(i), 0) / cell.length);
    out.push({
      nn: avg((i) => src[i].nn),
      gate: avg((i) => src[i].gate),
      vel: avg((i) => src[i].vel),
      recPos: 0,
      referrers: [...cell],
    });
  }
  return out;
}

const SORT_CHAINS: Record<Exclude<SortType, 'none'>, (a: WorkNote, b: WorkNote) => number> = {
  nn_gate_vel: (a, b) => a.nn - b.nn || b.gate - a.gate || b.vel - a.vel,
  nn_vel_gate: (a, b) => a.nn - b.nn || b.vel - a.vel || b.gate - a.gate,
  gate_nn_vel: (a, b) => b.gate - a.gate || a.nn - b.nn || b.vel - a.vel,
  gate_vel_nn: (a, b) => b.gate - a.gate || b.vel - a.vel || a.nn - b.nn,
  vel_nn_gate: (a, b) => b.vel - a.vel || a.nn - b.nn || b.gate - a.gate,
  vel_gate_nn: (a, b) => b.vel - a.vel || b.gate - a.gate || a.nn - b.nn,
};

/**
 * Minimal free gap between two uses of the same definition instance when one
 * sound's occurrences are spread over `mln` instances round-robin.
 */
function minInstanceGap(referrers: number[], mln: number, src: MidiNoteEvent[]): number {
  let min = Infinity;
  for (let first = 0; first < mln; first++) {
    for (let ir = first; ir + mln < referrers.length; ir += mln) {
      const cur = src[referrers[ir]];
      const next = src[referrers[ir + mln]];
      min = Math.min(min, next.position - cur.position - cur.gate);
    }
  }
  return min;
}

function roundUpToBeat(value: number, quantize: number): number {
  return Math.ceil(value / quantize) * quantize;
}

/**
 * Creates a division from a source sequence (notes must be in position
 * order; the src2def mapping and the clipboard products use that order).
 */
export function createDivision(source: MidiSequence, setting: DivisionSetting): Division {
  const src = [...source.notes].sort((a, b) => a.position - b.position);
  let work: WorkNote[];
  if (setting.srcCopy) {
    // Identity mapping: no rearrangement, only the head margin shift.
    work = src.map((note, i) => ({
      nn: note.nn,
      gate: note.gate,
      vel: note.vel,
      recPos: 0,
      referrers: [i],
    }));
  } else {
    work = unify(src, setting).flatMap((cluster) => splitCluster(cluster, src, setting));
    if (setting.sortType !== 'none') work.sort(SORT_CHAINS[setting.sortType]);
  }

  // Recording layout: first note at the head margin, then note-off → next
  // note-on gap rounded up to a whole beat.
  let position = setting.headMargin;
  for (const note of work) {
    if (setting.srcCopy) {
      note.recPos = src[note.referrers[0]].position + setting.headMargin;
    } else {
      note.recPos = position;
      position = roundUpToBeat(position + setting.minInterval + note.gate, source.quantize);
    }
  }

  // Definition assignment with optional multi-definition round-robin.
  const definitions: BmhDefinition[] = [];
  const src2def = new Array<number>(src.length).fill(0);
  let zz = ((setting.startDefinition % (ZZ_MAX + 1)) + ZZ_MAX + 1) % (ZZ_MAX + 1);
  work.forEach((note, divIndex) => {
    // Scan instance counts upward for the first spread that satisfies the
    // gap threshold; if even the maximum spread does not, every occurrence
    // gets its own definition (the original's fall-through behaviour).
    let mln = note.referrers.length;
    if (setting.mlDefinition) {
      for (let m = 1; m <= note.referrers.length; m++) {
        if (minInstanceGap(note.referrers, m, src) >= setting.mlThreshold) {
          mln = m;
          break;
        }
      }
    }
    const base = definitions.length;
    for (let k = 0; k < mln; k++) {
      definitions.push({ zz, div: divIndex });
      zz = nextZz(zz, !setting.zzDefinition);
    }
    note.referrers.forEach((r, k) => {
      src2def[r] = base + (k % mln);
    });
  });

  return {
    name: setting.name,
    quantize: source.quantize,
    notes: work,
    recording: work.map((note) => ({
      position: note.recPos,
      gate: note.gate,
      nn: note.nn,
      vel: note.vel,
    })),
    definitions,
    src2def,
    zzDefinition: setting.zzDefinition,
  };
}

/** Shifts every definition id one step (`<` / `>` buttons). */
export function transposeDefinitions(division: Division, delta: 1 | -1, ffMode: boolean): void {
  for (const definition of division.definitions) {
    definition.zz = delta === 1 ? nextZz(definition.zz, ffMode) : prevZz(definition.zz, ffMode);
  }
}

/** Renumbers the ids so div 0's first definition gets the entered value. */
export function setStartDefinition(division: Division, start: number, ffMode: boolean): void {
  if (division.definitions.length === 0) return;
  if (ffMode) {
    let zz = start;
    for (const definition of division.definitions) {
      definition.zz = zz;
      zz = nextZz(zz, true);
    }
    return;
  }
  const offset = start - division.definitions[0].zz;
  for (const definition of division.definitions) {
    definition.zz = (((definition.zz + offset) % (ZZ_MAX + 1)) + ZZ_MAX + 1) % (ZZ_MAX + 1);
  }
}

/**
 * 切断位置をコピー: one `011` line per recording-sequence note — the payload
 * woslicerII reads with its B key, and the exact input of this app's own
 * "read BMSE clipboard" action.
 */
export function cutPositionsClipboard(division: Division): string {
  const lines = division.recording.map((note) => {
    const position = Math.trunc((note.position * BEAT_UNITS_PER_QUARTER) / division.quantize);
    return '011' + String(position).padStart(8, '0') + '1';
  });
  return BMSE_CLIPBOARD_HEADER + '\r\n' + lines.join('\r\n') + '\r\n';
}

/**
 * BMSシーケンスをコピー: one `1nn` line per SOURCE note at its original
 * position, carrying the zz definition value; simultaneous notes spread
 * across BGM lanes 01, 02, 03… (per converted position).
 */
export function bmsSequenceClipboard(division: Division, source: MidiSequence): string {
  const lines: string[] = [];
  let lastPosition = -1;
  let lane = 0;
  const src = [...source.notes].sort((a, b) => a.position - b.position);
  src.forEach((note, i) => {
    const position = Math.trunc((note.position * BEAT_UNITS_PER_QUARTER) / division.quantize);
    lane = position === lastPosition ? lane + 1 : 1;
    lastPosition = position;
    const zz = division.definitions[division.src2def[i]].zz;
    lines.push(
      '1' + String(lane).padStart(2, '0') + String(position).padStart(8, '0') + String(zz),
    );
  });
  return BMSE_CLIPBOARD_HEADER + '\r\n' + lines.join('\r\n') + '\r\n';
}

/**
 * 定義情報: the `#WAV` lines for the .bms text. File numbers follow THIS
 * app's export numbering (marker ordinal, no head-margin offset — the
 * original needed one because woslicerII emits a leading file for the head
 * silence; both ends are ours, so the mapping is exact).
 */
export function wavDefinitionText(division: Division, fileName: string): string {
  const lines = division.definitions.map(
    (definition) =>
      '#WAV' +
      zzToString(definition.zz) +
      ' ' +
      fileName +
      '_' +
      String(definition.div).padStart(3, '0') +
      '.wav',
  );
  return lines.join('\r\n') + '\r\n';
}
