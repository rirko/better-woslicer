import { inject, provide, type InjectionKey } from 'vue';
import { decodeProject, encodeProject, parseProject, projectCapability, projectFromWos, projectToWos } from '../project/codec';
import { PROJECT_FILE_MAX_BYTES } from '../project/schema';
import { activeMedia, identifyAudio, projectFileName, projectWithAudio, verifyAudio } from './project-media';
import { readWos, writeWos } from '../core/wos';
import { buildBmseClipboard, parseBmseClipboard } from '../core/bmse';
import type { Platform, OpenedFile } from '../platform/contracts';
import type { EditorStore } from '../slicing/editor-store';
import { createEditorActions } from '../slicing/editor-actions';
import { createAudioEngine } from '../audio/audio-client';
import type { AudioEngine } from '../audio/audio-jobs';
import { createExporter } from '../export/exporter';
import { createDetection } from '../detection/detection';
import { createSessionPersistence } from './persistence';
import { convertLegacySession, readEditorSession, restoreEditorSession, type SessionReadResult } from './session';

export type RecoveryBlock = { kind: 'invalid' } | { kind: 'read-failed' } | { kind: 'future'; version: number };
export interface RelinkDifference { current: string; selected: string }
export interface LegacySummary { name: string; bpm: number; shift: number; markers: number }
export interface WorkspaceOptions {
  platform: Platform;
  editor: EditorStore;
  createEngine?: () => AudioEngine;
  confirmDiscardRecovery?: (block: RecoveryBlock) => Promise<boolean>;
  confirmRelinkDifference?: (difference: RelinkDifference) => Promise<boolean>;
  confirmLegacyImport?: (summary: LegacySummary) => Promise<boolean>;
}
export function createWorkspace(options: WorkspaceOptions) {
  const { platform, editor, createEngine = createAudioEngine } = options;
  let generation = 0, disposed = false, sessionClosed = false;
  let recoveryBlock: RecoveryBlock | null = null;
  // Read-only owner of a limited project's original bytes; null when nothing is preserved.
  let limitedFile: { name: string; sourceBytes: Uint8Array } | null = null;
  let engine: AudioEngine | null = null;
  let pendingEngine: AudioEngine | null = null;
  let opening = 0;
  let resetPending: Promise<void> | null = null;
  const actions = createEditorActions(editor);
  const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
  const persistence = createSessionPersistence(platform, editor, error => { editor.setStatus('sessionSaveFailed', { message: message(error) }, true); });
  const exporter = createExporter(platform, editor, () => engine, () => generation);
  const detection = createDetection(editor, () => engine, () => generation);
  function beginOpening(): number {
    opening++; pendingEngine?.dispose(); pendingEngine = null;
    if (editor.phase.kind === 'loading') editor.setPhase({ kind: editor.source ? 'ready' : 'empty' });
    return opening;
  }
  function invalidate(): number {
    beginOpening();
    generation++; engine?.dispose(); engine = null;
    editor.setPlaying(false); editor.exportLock = false; editor.bandBusy = false;
    return generation;
  }
  /** The preserved record must not be overwritten before the user explicitly discards it. */
  async function releaseRecoveryBlock(): Promise<boolean> {
    if (!recoveryBlock) return true;
    const block: RecoveryBlock = { ...recoveryBlock };
    if (!options.confirmDiscardRecovery || !(await options.confirmDiscardRecovery(block)) || disposed) return false;
    recoveryBlock = null;
    persistence.resume();
    return true;
  }
  function requireEditable(): boolean {
    if (!editor.limited) return true;
    editor.setStatus('limitedReadOnly', true);
    return false;
  }
  async function loadAudio(file: OpenedFile, preserveBaseName = false): Promise<void> {
    if (!requireEditable()) return;
    if (resetPending) await resetPending;
    if (resetPending) await resetPending;
    if (disposed) return;
    sessionClosed = false; persistence.resume();
    const request = beginOpening(), revision = editor.docRevision;
    const previousPhase = editor.source ? { kind: 'ready' as const } : { kind: 'empty' as const };
    editor.setPhase({ kind: 'loading', name: file.name }); editor.setStatus('parsingSourceFile');
    let worker: AudioEngine | null = null;
    try {
      const identity = await identifyAudio(file);
      if (disposed || request !== opening) return;
      worker = createEngine(); pendingEngine = worker;
      const result = await worker.decode(file.name, file.bytes);
      if (disposed || request !== opening) return;
      if (revision !== editor.docRevision) throw new Error('Project changed during audio loading; select the audio again');
      const expected = preserveBaseName ? activeMedia(editor.document) : null;
      if (expected) {
        try { verifyAudio(expected, identity, result); }
        catch (error) {
          // A mismatch is adoptable only through an explicit, undoable confirmation.
          const confirm = options.confirmRelinkDifference;
          if (!confirm || disposed || request !== opening || revision !== editor.docRevision) throw error;
          if (!await confirm({ current: expected.name, selected: file.name })) throw error;
          if (disposed || request !== opening || revision !== editor.docRevision) throw error;
          editor.transact(draft => {
            const media = draft.media.find(item => item.mediaId === expected.mediaId);
            if (media) {
              media.name = file.name; media.format = identity.format; media.byteLength = identity.byteLength;
              media.sampleRateHz = result.source.sampleRate; media.channels = result.source.channels;
              media.framesPerChannel = result.source.length; media.integrity = identity.integrity;
            }
            const clip = draft.tracks[0]?.clips.find(item => item.mediaId === expected.mediaId);
            if (clip) clip.frameCount = result.source.length;
          });
        }
      }
      const next = expected ? null : projectWithAudio(editor.document, file, identity, result, preserveBaseName);
      // Validate the replacement before releasing the current decoder or source.
      if (next) parseProject(next);
      pendingEngine = null; invalidate(); engine = worker; worker = null;
      if (next) { editor.replaceDocument(next, { saved: preserveBaseName }); actions.reset(); }
      const name = file.name.replace(/\.(wav|ogg)$/i, '');
      editor.setSource({ ...result.source, floatData: result.floatData, name, reference: file.reference }, result.peaks);
      // The binding survives failed reopens; only a real replacement writes or clears it.
      editor.setLastFile(file.reference ? { reference: file.reference, name } : null);
      editor.setPhase({ kind: 'ready' });
      editor.setStatus('readySource', { name, rate: result.source.sampleRate, channels: result.source.channels });
    } catch (error) {
      if (disposed || request !== opening) return;
      editor.setPhase(previousPhase); editor.setStatus('loadFailed', { message: message(error) }, true);
    } finally {
      if (pendingEngine === worker) pendingEngine = null;
      worker?.dispose();
    }
  }
  async function openAudio(): Promise<void> {
    if (!requireEditable()) return;
    if (recoveryBlock && !await releaseRecoveryBlock()) return;
    const version = generation, revision = editor.docRevision, request = beginOpening();
    try { const file = await platform.openFile('audio'); if (file && !disposed && version === generation && revision === editor.docRevision && request === opening) await loadAudio(file); }
    catch (error) { if (!disposed && request === opening) editor.setStatus('loadFailed', { message: message(error) }, true); }
  }
  async function relinkAudio(): Promise<void> {
    if (!requireEditable()) return;
    if (!activeMedia(editor.document)) return;
    const revision = editor.docRevision, request = beginOpening();
    try { const file = await platform.openFile('audio'); if (file && !disposed && revision === editor.docRevision && request === opening) await loadAudio(file, true); }
    catch (error) { if (!disposed && request === opening) editor.setStatus('loadFailed', { message: message(error) }, true); }
  }
  function acceptProject(file: OpenedFile): void {
    const parsed = decodeProject(file.bytes);
    if (parsed.kind === 'unsupported-version') throw new Error(`Unsupported project version: ${parsed.version}`);
    // Complex legal layouts open read-only; the untouched file bytes remain the save source.
    const limited = parsed.capability.kind === 'unsupported-arrangement';
    invalidate(); sessionClosed = false; persistence.resume();
    limitedFile = limited ? { name: file.name, sourceBytes: parsed.sourceBytes } : null;
    editor.setLimited(limited);
    editor.setLastFile(null);
    editor.replaceDocument(parsed.project); actions.reset(); editor.setSource(null); editor.setPhase({ kind: 'empty' });
    const media = activeMedia(editor.document);
    if (limited) editor.setStatus('projectLimitedOpen', { name: file.name });
    else if (parsed.unknownFields.length) editor.setStatus([{ key: media ? 'projectMediaMissing' : 'projectOpened', params: { name: media?.name ?? file.name } }, { key: 'projectUnknownFields', params: { count: parsed.unknownFields.length } }]);
    else editor.setStatus(media ? 'projectMediaMissing' : 'projectOpened', { name: media?.name ?? file.name });
  }
  async function openProject(): Promise<void> {
    if (recoveryBlock && !await releaseRecoveryBlock()) return;
    if (resetPending) await resetPending;
    if (disposed) return;
    const revision = editor.docRevision, request = beginOpening();
    try {
      const file = await platform.openFile('wosdx');
      if (file && !disposed && request === opening && revision === editor.docRevision) acceptProject(file);
    } catch (error) { if (!disposed && request === opening) editor.setStatus('loadFailed', { message: message(error) }, true); }
  }
  async function saveProject(): Promise<void> {
    const version = generation;
    if (editor.limited) {
      // The document cannot change: saving writes the opened file's bytes unchanged.
      if (!limitedFile) { editor.setStatus('limitedSaveUnavailable', true); return; }
      try {
        const name = projectFileName(editor.document.name);
        if (await platform.saveFile('wosdx', name, limitedFile.sourceBytes) && !disposed) editor.setStatus('projectSaved', { name });
      } catch (error) { if (!disposed && version === generation) editor.setStatus('loadFailed', { message: message(error) }, true); }
      return;
    }
    const revision = editor.docRevision, projectId = editor.document.projectId;
    try {
      const name = projectFileName(editor.document.name);
      const bytes = encodeProject(editor.document);
      if (await platform.saveFile('wosdx', name, bytes) && !disposed && version === generation && projectId === editor.document.projectId) {
        const current = editor.markSaved(revision);
        editor.setStatus(current ? 'projectSaved' : 'projectSnapshotSaved', { name });
      }
    } catch (error) { if (!disposed && version === generation) editor.setStatus('loadFailed', { message: message(error) }, true); }
  }
  async function openDroppedFile(file: File): Promise<void> {
    if (recoveryBlock && !await releaseRecoveryBlock()) return;
    const project = /\.wosdx$/i.test(file.name);
    if (!project && !requireEditable()) return;
    const request = beginOpening(), revision = editor.docRevision;
    try {
      if (file.size > (project ? PROJECT_FILE_MAX_BYTES : 2 * 1024 * 1024 * 1024)) throw new Error(project ? 'Project exceeds 16 MiB' : 'Audio exceeds 2 GiB');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!disposed && request === opening && revision === editor.docRevision) {
        const opened = { name: file.name, bytes, reference: null };
        if (project) acceptProject(opened); else await loadAudio(opened);
      }
    } catch (error) { if (!disposed && request === opening) editor.setStatus('dropFailed', { message: message(error) }, true); }
  }
  async function reopen(reference: string, preserveBaseName = false): Promise<void> {
    const request = beginOpening(), revision = editor.docRevision;
    try { const file = await platform.reopenFile(reference); if (!disposed && request === opening && revision === editor.docRevision) await loadAudio(file, preserveBaseName); }
    catch { if (!disposed && request === opening) editor.setStatus('lastFileMissing', { name: activeMedia(editor.document)?.name ?? reference }, true); }
  }
  function assertWosTiming(data: { bpm: number; shift: number; fadeoutMs: number; noisegateDb: number }): void {
    if (!Number.isFinite(data.bpm) || data.bpm <= 0 || !Number.isFinite(data.shift) || data.fadeoutMs < 0 || data.fadeoutMs > 60000 || data.noisegateDb > 0 || data.noisegateDb < -200) {
      throw new Error('Invalid WOS timing or processing parameters');
    }
  }
  /** Imports timing and cuts into the current project in one undo step, keeping its identity and media. */
  async function importWosSettings(): Promise<void> {
    if (!requireEditable()) return;
    const revision = editor.docRevision;
    try {
      const file = await platform.openFile('wos');
      if (!file || disposed || revision !== editor.docRevision) return;
      const data = readWos(file.bytes);
      assertWosTiming(data);
      const wos = projectFromWos(data, file.name);
      editor.transact(draft => {
        draft.timing.bpm = wos.timing.bpm;
        draft.timing.shiftTicks = wos.timing.shiftTicks;
        draft.slicing.fadeoutMs = wos.slicing.fadeoutMs;
        draft.slicing.noisegateDb = wos.slicing.noisegateDb;
        draft.slicing.markers = wos.slicing.markers;
      });
      editor.setStatus('importedWosSettings', { file: file.name, bpm: wos.timing.bpm, shift: wos.timing.shiftTicks });
    } catch (error) { if (!disposed) editor.setStatus('wosLoadFailed', { message: message(error) }, true); }
  }
  /** Explicit migration of a picked legacy recovery file; the stored path stays an unauthorized hint. */
  async function importLegacyRecovery(): Promise<void> {
    if (!requireEditable()) return;
    if (recoveryBlock && !await releaseRecoveryBlock()) return;
    const revision = editor.docRevision, request = beginOpening();
    try {
      const raw = await platform.importLegacySession();
      if (!raw || disposed || request !== opening || revision !== editor.docRevision) return;
      const converted = convertLegacySession(raw);
      if (converted.kind !== 'converted') throw new Error('The selected file is not a legacy recovery session');
      const { session } = converted;
      const summary: LegacySummary = {
        name: session.project.name, bpm: session.project.timing.bpm,
        shift: session.project.timing.shiftTicks, markers: session.project.slicing.markers.length,
      };
      const confirm = options.confirmLegacyImport;
      if (confirm && !await confirm(summary)) return;
      if (disposed || request !== opening || revision !== editor.docRevision) return;
      beginOpening();
      invalidate(); limitedFile = null;
      editor.setLimited(false);
      restoreEditorSession(editor, session); actions.reset();
      editor.setSource(null); editor.setPhase({ kind: 'empty' });
      editor.setStatus('legacyImported', { markers: summary.markers, bpm: summary.bpm });
    } catch (error) { if (!disposed && request === opening) editor.setStatus('loadFailed', { message: message(error) }, true); }
  }
  /** Replaces the whole workspace with a fresh project that only carries the WOS timing. */
  async function newProjectFromWos(): Promise<void> {
    if (!requireEditable()) return;
    if (recoveryBlock && !await releaseRecoveryBlock()) return;
    if (resetPending) await resetPending;
    if (disposed) return;
    const revision = editor.docRevision, request = beginOpening();
    try {
      const file = await platform.openFile('wos');
      if (!file || disposed || request !== opening || revision !== editor.docRevision) return;
      const data = readWos(file.bytes);
      assertWosTiming(data);
      const project = projectFromWos(data, file.name);
      beginOpening();
      invalidate(); limitedFile = null; editor.setLimited(false); editor.setLastFile(null);
      editor.replaceDocument(project); actions.reset(); editor.setSource(null); editor.setPhase({ kind: 'empty' });
      editor.setStatus('loadedWos', { file: file.name, bpm: data.bpm, shift: data.shift });
    } catch (error) { if (!disposed && request === opening) editor.setStatus('wosLoadFailed', { message: message(error) }, true); }
  }
  async function saveWos(): Promise<void> {
    if (!requireEditable()) return;
    const version = generation;
    try {
      const bytes = writeWos(projectToWos(editor.document));
      const name = `${editor.source?.name ?? 'untitled'}.wos`;
      if (await platform.saveFile('wos', name, bytes) && !disposed && version === generation) editor.setStatus('savedWos', { file: name });
    } catch (error) { if (!disposed && version === generation) editor.setStatus('wosSaveFailed', { message: message(error) }, true); }
  }
  async function bmseOut(): Promise<void> {
    if (!editor.ticks.length) { editor.setStatus('noMarkersToCopy', true); return; }
    try { await platform.writeClipboard(buildBmseClipboard(editor.ticks, { startNumber: editor.clipStartNumber, useFfNumbering: editor.useFfNumbering })); editor.setStatus('bmseClipboardOut', { count: editor.ticks.length, start: editor.clipStartNumber }); }
    catch (error) { editor.setStatus('bmseReadFailed', { message: message(error) }, true); }
  }
  async function bmseIn(): Promise<void> {
    if (!requireEditable()) return;
    const version = generation;
    try {
      const parsed = parseBmseClipboard(await platform.readClipboard());
      if (disposed || version !== generation) return;
      const legal = parsed.ticks.filter(editor.legalTick);
      editor.setTicks(legal); editor.setStatus('bmseClipboardImported', { count: legal.length });
    } catch (error) { if (!disposed && version === generation) editor.setStatus('bmseReadFailed', { message: message(error) }, true); }
  }
  async function restoreSession(): Promise<void> {
    const version = generation, revision = editor.docRevision, request = beginOpening();
    persistence.pause();
    try {
      let outcome: SessionReadResult;
      try { outcome = readEditorSession(await platform.readSession()); }
      catch (error) { outcome = { kind: 'read-failed', error }; }
      if (disposed || version !== generation || revision !== editor.docRevision || request !== opening) return;
      if (outcome.kind === 'absent') return;
      if (outcome.kind === 'restored') {
        restoreEditorSession(editor, outcome.session); actions.reset();
        if (projectCapability(editor.document).kind === 'unsupported-arrangement') {
          // Restored complex layouts keep read-only protection; the original bytes are not in the archive.
          editor.setLimited(true);
          editor.setStatus('sessionRestoredLimited', true);
          return;
        }
        if (outcome.session.lastFile) await reopen(outcome.session.lastFile.reference, true);
        return;
      }
      // Damaged, future and unreadable records stay preserved; recovery writes stay paused.
      recoveryBlock = outcome.kind === 'future' ? { kind: 'future', version: outcome.version }
        : outcome.kind === 'invalid' ? { kind: 'invalid' } : { kind: 'read-failed' };
      if (outcome.kind === 'invalid') editor.setStatus('sessionRecoverInvalid', true);
      else if (outcome.kind === 'future') editor.setStatus('sessionRecoverFuture', { version: outcome.version }, true);
      else editor.setStatus('sessionRecoverReadFailed', { message: message(outcome.error) }, true);
    } finally { if (!disposed && !sessionClosed && !recoveryBlock) persistence.resume(); }
  }
  function reset(): Promise<void> {
    if (resetPending) return resetPending;
    sessionClosed = true; recoveryBlock = null; limitedFile = null; persistence.pause(); invalidate(); actions.reset(); editor.reset();
    resetPending = persistence.clear().catch(error => { editor.setStatus('loadFailed', { message: message(error) }, true); }).finally(() => { resetPending = null; if (!disposed) persistence.resume(); });
    // Only subsequent edits become dirty: closing alone must leave no archive.
    return resetPending;
  }
  async function dispose(): Promise<void> { if (disposed) return; disposed = true; invalidate(); await persistence.dispose(); }
  return { editor, platform, actions, openAudio, openProject, saveProject, relinkAudio, openDroppedFile, loadAudio, reopen, importWosSettings, newProjectFromWos, importLegacyRecovery, saveWos, reset, restoreSession, dispose, flushSession: persistence.flush, ...exporter, ...detection, bmseIn, bmseOut };
}
export type Workspace = ReturnType<typeof createWorkspace>;
export const workspaceKey: InjectionKey<Workspace> = Symbol('workspace');
export function provideWorkspace(workspace: Workspace): void { provide(workspaceKey, workspace); }
export function useWorkspace(): Workspace { const workspace = inject(workspaceKey); if (!workspace) throw new Error('Workspace provider is missing'); return workspace; }
