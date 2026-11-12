import { createEmptyProject, parseProject } from '../project/codec';
import type { ProjectDocument, ProjectFileV1 } from '../project/schema';
import { PROJECT_MAX_GAIN_DB, PROJECT_MIN_GAIN_DB } from '../project/schema';
import { MAX_TICKS } from '../core/timebase';
import { ampToDb } from '../core/volume';
import type { EditorStore } from '../slicing/editor-store';

export type SessionOptions = Partial<
  Pick<
    EditorStore,
    | 'followPlayhead'
    | 'grid'
    | 'snap'
    | 'bandDetectBands'
    | 'bandThresholdDb'
    | 'bandMinGapUnits'
    | 'bandSnap'
    | 'tapOffsetMs'
    | 'cursorTick'
    | 'selectedTicks'
    | 'scrollTick'
    | 'pxPerTick'
  >
>;
export interface EditorSession {
  version: 2;
  dirty: boolean;
  options: SessionOptions;
  project: ProjectDocument;
  lastFile: { reference: string; name: string } | null;
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function number(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
function optionsFrom(state: EditorStore): SessionOptions {
  return {
    followPlayhead: state.followPlayhead,
    grid: state.grid,
    snap: state.snap,
    bandDetectBands: { ...state.bandDetectBands },
    bandThresholdDb: state.bandThresholdDb,
    bandMinGapUnits: state.bandMinGapUnits,
    bandSnap: state.bandSnap,
    tapOffsetMs: state.tapOffsetMs,
    cursorTick: state.cursorTick,
    selectedTicks: [...state.selectedTicks],
    scrollTick: state.scrollTick,
    pxPerTick: state.pxPerTick,
  };
}
function legacyProject(input: Record<string, unknown>): ProjectFileV1 | null {
  if (!object(input.doc)) return null;
  const d = input.doc;
  if (
    !number(d.bpm, Number.MIN_VALUE, 10000) ||
    !number(d.shift, -1e9, 1e9) ||
    !number(d.fadeoutMs, 0, 60000) ||
    !Number.isInteger(d.fadeoutMs) ||
    !number(d.noisegateDb, -200, 0) ||
    !Array.isArray(d.markers)
  )
    return null;
  const markers = d.markers.filter(
    (t): t is number => number(t, 0, MAX_TICKS - 1) && Number.isInteger(t),
  );
  const project = createEmptyProject();
  project.timing = { bpm: d.bpm, shiftTicks: d.shift };
  Object.assign(project.slicing, {
    fadeoutMs: d.fadeoutMs,
    noisegateDb: d.noisegateDb,
    markers: [...new Set(markers)].sort((a, b) => a - b),
  });
  const o = object(input.options) ? input.options : {};
  if (number(o.clipStartNumber, 0, 9999) && Number.isInteger(o.clipStartNumber))
    project.output.clipStartNumber = o.clipStartNumber;
  if (typeof o.baseName === 'string' && o.baseName.length <= 120)
    project.output.baseName = o.baseName;
  if (typeof o.noisegateEnabled === 'boolean')
    project.slicing.noisegateEnabled = o.noisegateEnabled;
  if (typeof o.useFfNumbering === 'boolean') project.output.useFfNumbering = o.useFfNumbering;
  return project;
}
/** Migrates v1/unversioned recovery data; future versions are never reinterpreted. */
export function parseEditorSession(input: unknown): EditorSession | null {
  if (!object(input) || (input.version !== undefined && input.version !== 1 && input.version !== 2))
    return null;
  let project: ProjectFileV1;
  try {
    const parsed = parseProject(input.version === 2 ? input.project : legacyProject(input));
    if (parsed.kind !== 'supported') return null;
    project = parsed.project;
  } catch {
    return null;
  }
  const options: SessionOptions = {};
  const o = object(input.options) ? input.options : {};
  // Older archives carried playback state as session options; migrate it into
  // the project document, which is the single truth for these properties now.
  const clampGainDb = (value: number): number =>
    Math.max(PROJECT_MIN_GAIN_DB, Math.min(PROJECT_MAX_GAIN_DB, value));
  if (number(o.volume, 0, 1)) project.global.masterGainDb = clampGainDb(ampToDb(o.volume));
  if (number(o.cueVolume, 0, 1)) project.global.cueGainDb = clampGainDb(ampToDb(o.cueVolume));
  if (number(o.playbackRate, 0.25, 1.5)) project.global.playbackRate = o.playbackRate;
  if (
    o.cueMode === 'off' ||
    o.cueMode === 'cowbell' ||
    o.cueMode === 'triangle' ||
    o.cueMode === 'metronome'
  )
    project.global.cueMode = o.cueMode;
  if (typeof o.rmsVisible === 'boolean') project.global.views.rms = o.rmsVisible;
  if (typeof o.bandsVisible === 'boolean') project.global.views.bands = o.bandsVisible;
  if (number(o.grid, 1, 192) && Number.isInteger(o.grid) && 192 % o.grid === 0)
    options.grid = o.grid;
  if (number(o.bandThresholdDb, 0, 120)) options.bandThresholdDb = o.bandThresholdDb;
  if (number(o.bandMinGapUnits, 0, 192)) options.bandMinGapUnits = o.bandMinGapUnits;
  if (number(o.tapOffsetMs, -2000, 2000)) options.tapOffsetMs = o.tapOffsetMs;
  for (const key of ['followPlayhead', 'snap', 'bandSnap'] as const)
    if (typeof o[key] === 'boolean') options[key] = o[key];
  if (number(o.cursorTick, 0, MAX_TICKS - 1) && Number.isInteger(o.cursorTick))
    options.cursorTick = o.cursorTick;
  if (number(o.scrollTick, 0, MAX_TICKS)) options.scrollTick = o.scrollTick;
  if (number(o.pxPerTick, 0.02, 1e9)) options.pxPerTick = o.pxPerTick;
  if (Array.isArray(o.selectedTicks))
    options.selectedTicks = o.selectedTicks.filter(
      (tick): tick is number =>
        number(tick, 0, MAX_TICKS - 1) &&
        Number.isInteger(tick) &&
        project.slicing.markers.includes(tick),
    );
  if (
    object(o.bandDetectBands) &&
    typeof o.bandDetectBands.low === 'boolean' &&
    typeof o.bandDetectBands.mid === 'boolean' &&
    typeof o.bandDetectBands.high === 'boolean'
  )
    options.bandDetectBands = {
      low: o.bandDetectBands.low,
      mid: o.bandDetectBands.mid,
      high: o.bandDetectBands.high,
    };
  const f = input.lastFile;
  const lastFile =
    object(f) &&
    typeof f.reference === 'string' &&
    f.reference.length > 0 &&
    f.reference.length < 4096 &&
    typeof f.name === 'string'
      ? { reference: f.reference, name: f.name }
      : null;
  return {
    version: 2,
    dirty: typeof input.dirty === 'boolean' ? input.dirty : true,
    options,
    project,
    lastFile,
  };
}
export type SessionReadResult =
  | { kind: 'absent' }
  | { kind: 'restored'; session: EditorSession }
  | { kind: 'invalid'; raw: unknown }
  | { kind: 'future'; raw: unknown; version: number }
  | { kind: 'read-failed'; error: unknown };
export type LegacyConversion =
  | { kind: 'converted'; session: EditorSession }
  | { kind: 'not-legacy' };
/** Pure legacy-recovery conversion. A stored path stays a hint: it never grants file access. */
export function convertLegacySession(input: unknown): LegacyConversion {
  const envelope = object(input) && object(input.session) ? input.session : input;
  const session = parseEditorSession(envelope);
  return session ? { kind: 'converted', session } : { kind: 'not-legacy' };
}
/** Classifies raw recovery storage contents; damaged and future input is preserved, never reinterpreted. */
export function readEditorSession(input: unknown): SessionReadResult {
  if (input === null || input === undefined) return { kind: 'absent' };
  const version =
    object(input) && typeof input.version === 'number' && Number.isInteger(input.version)
      ? input.version
      : 0;
  if (version > 2) return { kind: 'future', raw: input, version };
  const session = parseEditorSession(input);
  return session ? { kind: 'restored', session } : { kind: 'invalid', raw: input };
}
export function captureEditorSession(editor: EditorStore): EditorSession {
  const s = editor;
  return {
    version: 2,
    dirty: s.isDirty,
    options: optionsFrom(s),
    project: s.document,
    lastFile: s.lastFile,
  };
}
export function restoreEditorSession(editor: EditorStore, session: EditorSession): void {
  editor.replaceDocument(session.project, { saved: !session.dirty });
  Object.assign(editor, session.options);
  editor.setLastFile(session.lastFile);
  editor.setSelectedTicks(editor.selectedTicks);
}
