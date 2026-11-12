import { computed, markRaw, shallowRef, triggerRef } from 'vue';
import { defineStore } from 'pinia';
import { normalizeSelection } from '../core/markers';
import { ProjectEditor } from '../project/editor';
import { createEmptyProject, projectCapability } from '../project/codec';
import type { ProjectDocument, ProjectFileV1, OutputRecipe } from '../project/schema';
import { PROJECT_MAX_GAIN_DB, PROJECT_MIN_GAIN_DB } from '../project/schema';
import { gridStepTicks } from '../core/gridlines';
import { MAX_TICKS, resolveBreakpointTick, tickToSampleExport } from '../core/timebase';
import { ampToDb, dbToAmp } from '../core/volume';
import type { PeakCache } from '../core/peaks';
import type { BandAnalysis, BandName } from '../core/bands';
import type { FormatParams, StatusKey } from '../core/messages';

export interface AudioSource {
  name: string;
  reference: string | null;
  sampleRate: number;
  channels: number;
  length: number;
  data: Int16Array[];
  floatData: Float32Array[];
}
export type EditorPhase = { kind: 'empty' } | { kind: 'loading'; name: string } | { kind: 'ready' } | { kind: 'error'; message: string };
export type CueMode = 'off' | 'cowbell' | 'triangle' | 'metronome';
export interface StatusSegment { key: StatusKey; params?: FormatParams }
export interface DocumentOptions { bpm: number; shift: number; fadeoutMs: number; noisegateDb: number }

export const useEditorStore = defineStore('editor', () => {
  const project = shallowRef(markRaw(new ProjectEditor(createEmptyProject())));
  const document = computed(() => project.value.document);
  const docRevision = computed(() => project.value.revision);
  const isDirty = computed(() => project.value.isDirty);
  // Read-only projections for consumers of the existing slicing time base.
  const doc = computed(() => Object.freeze({ bpm: document.value.timing.bpm, shift: document.value.timing.shiftTicks, fadeoutMs: document.value.slicing.fadeoutMs, noisegateDb: document.value.slicing.noisegateDb }));
  const previewTicks = shallowRef<readonly number[] | null>(null);
  let cancelActiveDraft: (() => void) | null = null;
  const source = shallowRef<AudioSource | null>(null);
  const peaks = shallowRef<PeakCache | null>(null);
  const phase = shallowRef<EditorPhase>({ kind: 'empty' });
  const status = shallowRef<{ segments: StatusSegment[] }>({ segments: [{ key: 'statusEmpty' }] });
  const isError = shallowRef(false);
  // Limited (read-only) projects: every document mutation funnels through transact/undo/redo.
  const limited = shallowRef(false);
  // Host binding of the last opened audio, independent of the decoded source's lifetime.
  const lastFile = shallowRef<{ reference: string; name: string } | null>(null);
  const grid = shallowRef(8), snap = shallowRef(true), cursorTick = shallowRef(0);
  const selectedTicks = shallowRef<number[]>([]);
  const selectionStartTick = shallowRef<number | null>(null), selectionEndTick = shallowRef<number | null>(null);
  const pxPerTick = shallowRef(6), scrollTick = shallowRef(0);
  const playing = shallowRef(false), playheadSample = shallowRef(0);
  // Project global/track playback state is the single truth; these writable
  // projections keep the UI and command entry points stable. One user intent is
  // one transaction, so playback properties participate in undo and dirty.
  function clampGainDb(value: number): number { return Math.max(PROJECT_MIN_GAIN_DB, Math.min(PROJECT_MAX_GAIN_DB, value)); }
  function applyGlobal(edit: (draft: ProjectFileV1) => void): void {
    if (limited.value) return; // read-only projects expose playback controls as view state only
    transact(edit);
  }
  const trackPlayback = computed(() => {
    const capability = projectCapability(document.value);
    const track = capability.kind === 'single-track' ? document.value.tracks[0] : null;
    return { gainDb: track?.gainDb ?? 0, muted: track?.muted ?? false, solo: track?.solo ?? false };
  });
  // Master route: master mute or track mute wins over solo; gains sum in dB.
  const masterAmp = computed(() => {
    const global = document.value.global;
    if (global.masterMuted || trackPlayback.value.muted) return 0;
    return dbToAmp(clampGainDb(global.masterGainDb + trackPlayback.value.gainDb));
  });
  const volume = computed({
    get: () => dbToAmp(document.value.global.masterGainDb),
    set: value => { if (!Number.isFinite(value)) return; applyGlobal(draft => { draft.global.masterGainDb = clampGainDb(ampToDb(Math.max(0, Math.min(1, value)))); }); },
  });
  const cueVolume = computed({
    get: () => dbToAmp(document.value.global.cueGainDb),
    set: value => { if (!Number.isFinite(value)) return; applyGlobal(draft => { draft.global.cueGainDb = clampGainDb(ampToDb(Math.max(0, Math.min(1, value)))); }); },
  });
  const playbackRate = computed({
    get: () => document.value.global.playbackRate,
    set: value => { if (!Number.isFinite(value) || value < .25 || value > 1.5) return; applyGlobal(draft => { draft.global.playbackRate = value; }); },
  });
  const cueMode = computed<CueMode>({
    get: () => document.value.global.cueMode,
    set: value => applyGlobal(draft => { draft.global.cueMode = value; }),
  });
  const followPlayhead = shallowRef(true);
  const effectiveViews = computed(() => {
    const capability = projectCapability(document.value);
    const track = capability.kind === 'single-track' ? document.value.tracks[0] : null;
    return { rms: track?.views.rms ?? document.value.global.views.rms, bands: track?.views.bands ?? document.value.global.views.bands };
  });
  const rmsVisible = computed({
    get: () => effectiveViews.value.rms,
    set: value => applyGlobal(draft => { draft.global.views.rms = value; }),
  });
  const bandsVisible = computed({
    get: () => effectiveViews.value.bands,
    set: value => applyGlobal(draft => { draft.global.views.bands = value; }),
  });
  const noisegateEnabled = computed(() => document.value.slicing.noisegateEnabled);
  const baseName = computed(() => document.value.output.baseName);
  const clipStartNumber = computed(() => document.value.output.clipStartNumber);
  const useFfNumbering = computed(() => document.value.output.useFfNumbering);
  const exportLock = shallowRef(false);
  const bandAnalysis = shallowRef<BandAnalysis | null>(null);
  const bandDetectBands = shallowRef<Record<BandName, boolean>>({ low: true, mid: true, high: true });
  const bandThresholdDb = shallowRef(6), bandMinGapUnits = shallowRef(1), bandSnap = shallowRef(true), tapOffsetMs = shallowRef(0);
  const bandEstimate = shallowRef<number | null>(null), bandBusy = shallowRef(false);
  const ticks = computed(() => document.value.slicing.markers);
  const canUndo = computed(() => project.value.canUndo);
  const canRedo = computed(() => project.value.canRedo);
  function publish(): void {
    triggerRef(project);
    selectedTicks.value = selectedTicks.value.filter(t => ticks.value.includes(t));
  }
  function cancelDraft(): void { cancelActiveDraft?.(); previewTicks.value = null; }
  function registerDraftCancellation(cancel: () => void): () => void {
    cancelDraft(); cancelActiveDraft = cancel;
    return () => { if (cancelActiveDraft === cancel) { cancelDraft(); cancelActiveDraft = null; } };
  }
  function setPreviewTicks(value: readonly number[] | null): void { previewTicks.value = value === null ? null : Object.freeze([...value]); }
  function transact<T>(edit: (draft: ProjectFileV1) => T) {
    if (limited.value) throw new Error('This project is read-only: a multi-track layout opened with limited support cannot be edited');
    cancelDraft();
    const result = project.value.transact(edit);
    if (result.changed) publish();
    return result;
  }
  function replaceDocument(value: ProjectDocument, options: { saved?: boolean } = {}): void {
    cancelDraft(); project.value.replace(value, options); selectedTicks.value = []; setSelection(null, null); publish();
  }
  function markSaved(revision: number): boolean { const saved = project.value.markSaved(revision); if (saved) triggerRef(project); return saved; }
  function undo(): boolean { cancelDraft(); if (limited.value) return false; const changed = project.value.undo(); if (changed) publish(); return changed; }
  function redo(): boolean { if (limited.value) return false; const changed = project.value.redo(); if (changed) publish(); return changed; }
  function setLimited(value: boolean): void { limited.value = value; }
  function setLastFile(value: { reference: string; name: string } | null): void { lastFile.value = value; }
  function setTicks(value: readonly number[]): boolean { return transact(draft => { draft.slicing.markers = normalizeSelection(value); }).changed; }
  function addTicks(value: readonly number[]): number {
    return transact(draft => {
      const additions = normalizeSelection(value).filter(t => !draft.slicing.markers.includes(t));
      draft.slicing.markers = normalizeSelection([...draft.slicing.markers, ...additions]);
      return additions.length;
    }).value;
  }
  function setOutputOptions(value: Partial<OutputRecipe>): void { transact(draft => { Object.assign(draft.output, value); }); }
  function setNoisegateEnabled(value: boolean): void { transact(draft => { draft.slicing.noisegateEnabled = value; }); }
  function setStatus(message: StatusKey | StatusSegment | StatusSegment[], paramsOrError?: FormatParams | boolean, error = false): void {
    const params = typeof paramsOrError === 'object' ? paramsOrError : undefined;
    status.value = { segments: Array.isArray(message) ? message : typeof message === 'string' ? [{ key: message, params }] : [message] };
    isError.value = typeof paramsOrError === 'boolean' ? paramsOrError : error;
  }
  function tickBeyondEnd(tick: number): boolean { return source.value !== null && tickToSampleExport(tick, { bpm: doc.value.bpm, shift: doc.value.shift, sampleRate: source.value.sampleRate }) > source.value.length; }
  function legalTick(tick: number): boolean { return Number.isInteger(tick) && tick >= 0 && tick < MAX_TICKS && !tickBeyondEnd(tick); }
  function setCursorTick(tick: number): void { if (Number.isFinite(tick)) cursorTick.value = Math.max(0, Math.min(MAX_TICKS - 1, Math.round(tick))); }
  function setSelectedTicks(value: readonly number[]): void { selectedTicks.value = normalizeSelection(value).filter(t => ticks.value.includes(t)); }
  function setSelection(start: number | null, end: number | null): void { selectionStartTick.value = start; selectionEndTick.value = end; }
  function setScrollTick(value: number): void { if (Number.isFinite(value)) scrollTick.value = Math.max(0, value); }
  function snapTick(tick: number): number { return resolveBreakpointTick(tick, snap.value, gridStepTicks(grid.value), false); }
  function zoomAt(anchor: number, factor: number): void {
    const frames = source.value ? source.value.sampleRate * 5 / (doc.value.bpm * 4) : 500;
    const next = Math.max(.02, Math.min(Math.max(600, 4 * frames), pxPerTick.value * factor));
    const pixels = (anchor - scrollTick.value) * pxPerTick.value;
    pxPerTick.value = next; setScrollTick(anchor - pixels / next);
  }
  function setPlaybackRate(value: number): void { if (Number.isFinite(value) && value >= .25 && value <= 1.5) playbackRate.value = value; }
  function setVolume(value: number): void { volume.value = value; }
  function setCueVolume(value: number): void { cueVolume.value = value; }
  function setPlaying(value: boolean): void { playing.value = value; }
  function setPlayheadSample(value: number): void { if (Number.isFinite(value)) playheadSample.value = Math.max(0, Math.min(source.value?.length ?? 0, value)); }
  function setSource(value: AudioSource | null, cache: PeakCache | null = null): void { cancelDraft(); source.value = value ? markRaw(value) : null; peaks.value = cache ? markRaw(cache) : null; bandAnalysis.value = null; bandEstimate.value = null; playing.value = false; playheadSample.value = 0; }
  function setPhase(value: EditorPhase): void { phase.value = value; }
  function setBandAnalysis(value: BandAnalysis | null): void { bandAnalysis.value = value ? markRaw(value) : null; }
  function setDocumentOptions(values: Partial<DocumentOptions>): void {
    transact(draft => {
      if (values.bpm !== undefined && Number.isFinite(values.bpm) && values.bpm > 0 && values.bpm <= 10000) draft.timing.bpm = values.bpm;
      if (values.shift !== undefined && Number.isFinite(values.shift) && Math.abs(values.shift) <= 1e9) draft.timing.shiftTicks = values.shift;
      if (values.fadeoutMs !== undefined && Number.isInteger(values.fadeoutMs) && values.fadeoutMs >= 0 && values.fadeoutMs <= 60000) draft.slicing.fadeoutMs = values.fadeoutMs;
      if (values.noisegateDb !== undefined && Number.isFinite(values.noisegateDb) && values.noisegateDb >= -200 && values.noisegateDb <= 0) draft.slicing.noisegateDb = values.noisegateDb;
    });
  }
  function reset(): void {
    limited.value = false; lastFile.value = null;
    replaceDocument(createEmptyProject()); setSource(null); phase.value = { kind: 'empty' }; setStatus('statusEmpty');
    grid.value = 8; snap.value = true; cursorTick.value = 0; setSelection(null, null); pxPerTick.value = 6; scrollTick.value = 0;
    followPlayhead.value = true;
    exportLock.value = false;
    bandDetectBands.value = { low: true, mid: true, high: true }; bandThresholdDb.value = 6; bandMinGapUnits.value = 1; bandSnap.value = true; tapOffsetMs.value = 0; bandBusy.value = false;
  }
  return { document, doc, docRevision, isDirty, limited, lastFile, markSaved, previewTicks, source, peaks, phase, status, isError, grid, snap, cursorTick, selectedTicks, selectionStartTick, selectionEndTick, pxPerTick, scrollTick, playing, playheadSample, masterAmp, volume, cueVolume, playbackRate, followPlayhead, cueMode, noisegateEnabled, baseName, clipStartNumber, useFfNumbering, exportLock, bandsVisible, rmsVisible, bandAnalysis, bandDetectBands, bandThresholdDb, bandMinGapUnits, bandSnap, tapOffsetMs, bandEstimate, bandBusy, ticks, canUndo, canRedo, transact, replaceDocument, undo, redo, setLimited, setLastFile, setTicks, addTicks, setOutputOptions, setNoisegateEnabled, cancelDraft, registerDraftCancellation, setPreviewTicks, setStatus, tickBeyondEnd, legalTick, setCursorTick, setSelectedTicks, setSelection, setScrollTick, snapTick, zoomAt, setPlaybackRate, setVolume, setCueVolume, setPlaying, setPlayheadSample, setSource, setPhase, setBandAnalysis, setDocumentOptions, reset };
});
export type EditorStore = ReturnType<typeof useEditorStore>;
