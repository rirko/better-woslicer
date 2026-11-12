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
import { parseEditorSession, restoreEditorSession } from './session';

export interface WorkspaceOptions { platform: Platform; editor: EditorStore; createEngine?: () => AudioEngine }
export function createWorkspace({ platform, editor, createEngine = createAudioEngine }: WorkspaceOptions) {
  let generation = 0, disposed = false, sessionClosed = false;
  let engine: AudioEngine | null = null;
  let pendingEngine: AudioEngine | null = null;
  let opening = 0;
  let resetPending: Promise<void> | null = null;
  const actions = createEditorActions(editor);
  const persistence = createSessionPersistence(platform, editor);
  const exporter = createExporter(platform, editor, () => engine, () => generation);
  const detection = createDetection(editor, () => engine, () => generation);
  const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
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
  async function loadAudio(file: OpenedFile, preserveBaseName = false): Promise<void> {
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
      if (expected) verifyAudio(expected, identity, result);
      const next = expected ? null : projectWithAudio(editor.document, file, identity, result, preserveBaseName);
      // Validate the replacement before releasing the current decoder or source.
      if (next) parseProject(next);
      pendingEngine = null; invalidate(); engine = worker; worker = null;
      if (next) { editor.replaceDocument(next, { saved: preserveBaseName }); actions.reset(); }
      const name = file.name.replace(/\.(wav|ogg)$/i, '');
      editor.setSource({ ...result.source, floatData: result.floatData, name, reference: file.reference }, result.peaks);
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
    const version = generation, revision = editor.docRevision, request = beginOpening();
    try { const file = await platform.openFile('audio'); if (file && !disposed && version === generation && revision === editor.docRevision && request === opening) await loadAudio(file); }
    catch (error) { if (!disposed && request === opening) editor.setStatus('loadFailed', { message: message(error) }, true); }
  }
  async function relinkAudio(): Promise<void> {
    if (!activeMedia(editor.document)) return;
    const revision = editor.docRevision, request = beginOpening();
    try { const file = await platform.openFile('audio'); if (file && !disposed && revision === editor.docRevision && request === opening) await loadAudio(file, true); }
    catch (error) { if (!disposed && request === opening) editor.setStatus('loadFailed', { message: message(error) }, true); }
  }
  function acceptProject(file: OpenedFile): void {
    const parsed = decodeProject(file.bytes);
    if (parsed.kind === 'unsupported-version') throw new Error(`Unsupported project version: ${parsed.version}`);
    if (parsed.capability.kind === 'unsupported-arrangement') throw new Error('This arrangement cannot be edited in the single-track workspace');
    invalidate(); sessionClosed = false; persistence.resume();
    editor.replaceDocument(parsed.project); actions.reset(); editor.setSource(null); editor.setPhase({ kind: 'empty' });
    const media = activeMedia(editor.document);
    editor.setStatus(media ? 'projectMediaMissing' : 'projectOpened', { name: media?.name ?? file.name });
  }
  async function openProject(): Promise<void> {
    if (resetPending) await resetPending;
    if (disposed) return;
    const revision = editor.docRevision, request = beginOpening();
    try {
      const file = await platform.openFile('wosdx');
      if (file && !disposed && request === opening && revision === editor.docRevision) acceptProject(file);
    } catch (error) { if (!disposed && request === opening) editor.setStatus('loadFailed', { message: message(error) }, true); }
  }
  async function saveProject(): Promise<void> {
    const revision = editor.docRevision, version = generation, projectId = editor.document.projectId;
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
    const request = beginOpening(), revision = editor.docRevision;
    try {
      const project = /\.wosdx$/i.test(file.name);
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
  async function loadWos(): Promise<void> {
    const version = generation, revision = editor.docRevision, request = beginOpening();
    try {
      const file = await platform.openFile('wos');
      if (!file || disposed || version !== generation || request !== opening || revision !== editor.docRevision) return;
      const data = readWos(file.bytes);
      if (!Number.isFinite(data.bpm) || data.bpm <= 0 || !Number.isFinite(data.shift) || data.fadeoutMs < 0 || data.fadeoutMs > 60000 || data.noisegateDb > 0 || data.noisegateDb < -200) throw new Error('Invalid WOS timing or processing parameters');
      const project = projectFromWos(data, file.name);
      project.output = { ...editor.document.output };
      project.slicing.noisegateEnabled = editor.noisegateEnabled;
      if (editor.source) {
        const current = parseProject(editor.document);
        if (current.kind === 'supported') { project.media = current.project.media; project.tracks = current.project.tracks; }
      }
      beginOpening();
      editor.replaceDocument(project); actions.reset();
      editor.setStatus('loadedWos', { file: file.name, bpm: data.bpm, shift: data.shift });
    } catch (error) { if (!disposed && version === generation) editor.setStatus('wosLoadFailed', { message: message(error) }, true); }
  }
  async function saveWos(): Promise<void> {
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
    const version = generation;
    try {
      const parsed = parseBmseClipboard(await platform.readClipboard());
      if (disposed || version !== generation) return;
      const legal = parsed.ticks.filter(editor.legalTick);
      editor.setTicks(legal); editor.setStatus('bmseClipboardImported', { count: legal.length });
    } catch (error) { if (!disposed && version === generation) editor.setStatus('bmseReadFailed', { message: message(error) }, true); }
  }
  async function restoreSession(): Promise<void> {
    const version = generation, revision = editor.docRevision, request = beginOpening(); persistence.pause();
    try {
      const session = parseEditorSession(await platform.readSession());
      if (!session || disposed || version !== generation || revision !== editor.docRevision || request !== opening) return;
      restoreEditorSession(editor, session); actions.reset();
      if (session.lastFile && projectCapability(editor.document).kind !== 'unsupported-arrangement') await reopen(session.lastFile.reference, true);
    } catch { /* Storage failure must not prevent starting an offline workspace. */ }
    finally { if (!disposed && !sessionClosed) persistence.resume(); }
  }
  function reset(): Promise<void> {
    if (resetPending) return resetPending;
    sessionClosed = true; persistence.pause(); invalidate(); actions.reset(); editor.reset();
    resetPending = persistence.clear().catch(error => { editor.setStatus('loadFailed', { message: message(error) }, true); }).finally(() => { resetPending = null; if (!disposed) persistence.resume(); });
    // Only subsequent edits become dirty: closing alone must leave no archive.
    return resetPending;
  }
  async function dispose(): Promise<void> { if (disposed) return; disposed = true; invalidate(); await persistence.dispose(); }
  return { editor, actions, openAudio, openProject, saveProject, relinkAudio, openDroppedFile, loadAudio, reopen, loadWos, saveWos, reset, restoreSession, dispose, flushSession: persistence.flush, ...exporter, ...detection, bmseIn, bmseOut };
}
export type Workspace = ReturnType<typeof createWorkspace>;
export const workspaceKey: InjectionKey<Workspace> = Symbol('workspace');
export function provideWorkspace(workspace: Workspace): void { provide(workspaceKey, workspace); }
export function useWorkspace(): Workspace { const workspace = inject(workspaceKey); if (!workspace) throw new Error('Workspace provider is missing'); return workspace; }
