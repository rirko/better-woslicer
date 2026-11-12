import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioFile, fixture, processorEngine } from './workspace-fixture';
import { createEmptyProject, decodeProject, encodeProject } from '../../src/project/codec';
import type { DecodedAudio } from '../../src/audio/audio-jobs';
import { captureEditorSession } from '../../src/workspace/session';
import { projectToWos } from '../../src/project/codec';
import { writeWos } from '../../src/core/wos';

const fixtures: ReturnType<typeof fixture>[] = [];
function setup(createEngine = processorEngine) { const f = fixture(createEngine); fixtures.push(f); return f; }
afterEach(async () => { for (const f of fixtures.splice(0)) await f.dispose(); });

describe('portable project workflow', () => {
  it('records audio identity, round-trips the project, and relinks without changing its document or history', async () => {
    const f = setup(); const file = audioFile();
    await f.workspace.loadAudio(file); f.editor.setTicks([0, 24]);
    expect(f.editor.document.media[0]).toMatchObject({ name: 'tone.wav', sampleRateHz: 48000, framesPerChannel: 48000, byteLength: file.bytes.length, integrity: { algorithm: 'sha256' } });
    expect(f.editor.isDirty).toBe(true);
    await f.workspace.saveProject(); expect(f.editor.isDirty).toBe(false);
    f.editor.setTicks([0, 48]); f.workspace.actions.undo(); expect(f.editor.isDirty).toBe(false);
    const saved = f.saved[0]; if (!saved) throw new Error('Missing project output');
    const parsed = decodeProject(saved.bytes); expect(parsed.kind).toBe('supported');
    const restored = setup(); restored.opened = { ...saved, reference: 'project-file-grant' };
    const reopen = vi.spyOn(restored.platform, 'reopenFile');
    await restored.workspace.openProject();
    expect(restored.editor.document).toEqual(f.editor.document);
    expect(restored.editor.source).toBeNull(); expect(reopen).not.toHaveBeenCalled();
    expect(restored.editor.canUndo).toBe(false);
    const original = restored.editor.document;
    restored.opened = file; await restored.workspace.relinkAudio();
    expect(restored.editor.source?.length).toBe(48000);
    expect(restored.editor.document).toBe(original); expect(restored.editor.isDirty).toBe(false);
    expect(restored.editor.canUndo).toBe(false);
  });
  it('rejects mismatched audio, including same-size content, and preserves the current source on a failed replacement', async () => {
    const f = setup(); await f.workspace.loadAudio(audioFile());
    const source = f.editor.source, original = f.editor.document;
    const wrong = audioFile(); wrong.bytes[44] ^= 127;
    f.opened = wrong; await f.workspace.relinkAudio();
    expect(f.editor.isError).toBe(true); expect(f.editor.source).toBe(source); expect(f.editor.document).toBe(original);
    await f.workspace.loadAudio({ name: 'broken.wav', reference: null, bytes: new Uint8Array([1]) });
    expect(f.editor.source).toBe(source); expect(f.editor.document).toBe(original);
    await f.workspace.exportAll();
    f.opened = null; await f.workspace.relinkAudio();
    expect(f.editor.source).toBe(source);
  });
  it('opens an empty project, but rejects future versions and unsupported arrangements without altering current work', async () => {
    const f = setup(); const project = createEmptyProject('portable', 'Empty');
    f.opened = { name: 'empty.wosdx', reference: null, bytes: encodeProject(project) };
    await f.workspace.openProject(); expect(f.editor.document.projectId).toBe('portable');
    f.editor.setTicks([12]); const original = f.editor.document;
    f.opened = { name: 'future.wosdx', reference: null, bytes: new TextEncoder().encode(JSON.stringify({ ...project, schemaVersion: 99 })) };
    await f.workspace.openProject(); expect(f.editor.document).toBe(original); expect(f.editor.isError).toBe(true);
    const track = project.tracks[0]; if (!track) throw new Error('Missing track');
    project.tracks.push({ ...track, trackId: 'second' });
    f.opened = { name: 'multi.wosdx', reference: null, bytes: encodeProject(project) };
    await f.workspace.openProject(); expect(f.editor.document).toBe(original); expect(f.editor.canUndo).toBe(true);
  });
  it('never marks newer edits or a replacement project saved after an asynchronous save', async () => {
    const f = setup(); f.editor.setTicks([12]);
    let finish: ((saved: boolean) => void) | undefined;
    f.platform.saveFile = () => new Promise(resolve => { finish = resolve; });
    const saving = f.workspace.saveProject(); f.editor.setTicks([24]);
    if (!finish) throw new Error('Expected pending save'); finish(true); await saving;
    expect(f.editor.isDirty).toBe(true);
    f.platform.saveFile = async () => false;
    await f.workspace.saveProject(); expect(f.editor.isDirty).toBe(true);
    f.platform.saveFile = () => new Promise(resolve => { finish = resolve; });
    const stale = f.workspace.saveProject();
    f.editor.replaceDocument(createEmptyProject('replacement')); f.editor.setTicks([36]);
    finish(true); await stale; expect(f.editor.isDirty).toBe(true);
    f.platform.saveFile = async () => { throw new Error('Disk full'); };
    await f.workspace.saveProject(); expect(f.editor.isDirty).toBe(true); expect(f.editor.isError).toBe(true);
  });
  it('does not replace edits made while a project picker is pending', async () => {
    const f = setup(); let finish: ((file: { name: string; reference: null; bytes: Uint8Array }) => void) | undefined;
    f.platform.openFile = () => new Promise(resolve => { finish = resolve; });
    const opening = f.workspace.openProject(); f.editor.setTicks([12]);
    if (!finish) throw new Error('Expected picker'); finish({ name: 'empty.wosdx', reference: null, bytes: encodeProject(createEmptyProject()) });
    await opening; expect(f.editor.ticks).toEqual([12]); expect(f.editor.canUndo).toBe(true);
  });
  it('discards a late relink when a different project is opened', async () => {
    const f = setup(); await f.workspace.loadAudio(audioFile()); await f.workspace.saveProject();
    let complete: ((audio: DecodedAudio) => void) | undefined;
    const restored = setup(() => ({ ...processorEngine(), decode: () => new Promise(resolve => { complete = resolve; }) }));
    const saved = f.saved[0]; if (!saved) throw new Error('Missing output');
    restored.opened = { ...saved, reference: null }; await restored.workspace.openProject();
    restored.opened = audioFile(); const relinking = restored.workspace.relinkAudio();
    // Wait for hashing and the asynchronous picker to reach the decoder.
    await vi.waitFor(() => expect(complete).toBeDefined());
    restored.opened = { name: 'other.wosdx', reference: null, bytes: encodeProject(createEmptyProject('other')) };
    await restored.workspace.openProject();
    if (!complete) throw new Error('Expected pending decode'); complete(await processorEngine().decode('tone.wav', audioFile().bytes));
    await relinking;
    expect(restored.editor.document.projectId).toBe('other'); expect(restored.editor.source).toBeNull();
  });
  it('retains the dirty state in recovery while successful relinking adds no edits', async () => {
    const f = setup(); const file = audioFile(); await f.workspace.loadAudio(file);
    const restored = setup(); restored.session = captureEditorSession(f.editor); restored.opened = file;
    await restored.workspace.restoreSession();
    expect(restored.editor.isDirty).toBe(true); expect(restored.editor.canUndo).toBe(false);
    await f.workspace.saveProject();
    const clean = setup(); clean.session = captureEditorSession(f.editor); clean.opened = file;
    await clean.workspace.restoreSession(); expect(clean.editor.isDirty).toBe(false);
  });
  it('preserves the active audio identity when importing WOS settings', async () => {
    const f = setup(); await f.workspace.loadAudio(audioFile());
    const media = f.editor.document.media, source = f.editor.source;
    const wos = projectToWos(createEmptyProject()); wos.bpm = 150;
    f.opened = { name: 'cuts.wos', reference: null, bytes: writeWos(wos) };
    await f.workspace.loadWos();
    expect(f.editor.doc.bpm).toBe(150); expect(f.editor.source).toBe(source);
    expect(f.editor.document.media).toEqual(media); expect(f.editor.canUndo).toBe(false);
    await f.workspace.saveProject();
    const saved = f.saved[0]; if (!saved) throw new Error('Missing output');
    const parsed = decodeProject(saved.bytes);
    expect(parsed.kind === 'supported' && parsed.capability.kind).toBe('single-track');
  });
  it('bounds dropped projects before reading them and never follows portable origin hints', async () => {
    const f = setup(); const file = new File(['{}'], 'large.wosdx');
    Object.defineProperty(file, 'size', { value: 16 * 1024 * 1024 + 1 });
    const read = vi.spyOn(file, 'arrayBuffer'); const original = f.editor.document;
    await f.workspace.openDroppedFile(file); expect(read).not.toHaveBeenCalled(); expect(f.editor.document).toBe(original);
    await f.workspace.loadAudio(audioFile());
    f.editor.transact(draft => { const media = draft.media[0]; if (media) media.originHint = { kind: 'desktop', pathHint: 'C:/untrusted/secret.wav' }; });
    f.opened = { name: 'hinted.wosdx', reference: 'project-grant', bytes: encodeProject(f.editor.document) };
    const reopen = vi.spyOn(f.platform, 'reopenFile');
    await f.workspace.openProject(); expect(reopen).not.toHaveBeenCalled(); expect(f.editor.source).toBeNull();
    expect(f.editor.document.media[0]?.originHint).toEqual({ kind: 'desktop', pathHint: 'C:/untrusted/secret.wav' });
  });
  it('leaves no loading state when a new picker cancels an in-flight decoder', async () => {
    let complete: ((audio: DecodedAudio) => void) | undefined;
    const f = setup(() => ({ ...processorEngine(), decode: () => new Promise(resolve => { complete = resolve; }) }));
    const loading = f.workspace.loadAudio(audioFile());
    await vi.waitFor(() => expect(complete).toBeDefined());
    f.opened = null; await f.workspace.openProject();
    expect(f.editor.phase.kind).toBe('empty');
    if (!complete) throw new Error('Expected pending decoder'); complete(await processorEngine().decode('tone.wav', audioFile().bytes));
    await loading; expect(f.editor.source).toBeNull();
  });
});
