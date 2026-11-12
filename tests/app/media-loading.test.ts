import { afterEach, expect, it, vi } from 'vitest';
import { audioFile, fixture, processorEngine } from './workspace-fixture';
import { captureEditorSession } from '../../src/workspace/session';
import { encodeProject } from '../../src/project/codec';

const fixtures: ReturnType<typeof fixture>[] = [];
function setup(createEngine = processorEngine) {
  const f = fixture(createEngine);
  fixtures.push(f);
  return f;
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Promise not initialized');
  };
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.dispose();
});

it('shows recovery before storage returns, then media reading and decoding until ready', async () => {
  const original = setup();
  const file = audioFile();
  await original.workspace.loadAudio(file);
  const archive = captureEditorSession(original.editor);
  const storage = deferred<unknown>();
  const reading = deferred<ReturnType<typeof audioFile>>();
  const decoding = deferred<void>();
  const f = setup(() => {
    const engine = processorEngine();
    return {
      ...engine,
      async decode(name, bytes) {
        await decoding.promise;
        return engine.decode(name, bytes);
      },
    };
  });
  f.platform.readSession = () => storage.promise;
  f.platform.reopenFile = () => reading.promise;
  const restore = f.workspace.restoreSession();
  expect(f.workspace.loading.value?.stage).toBe('restoring');
  storage.resolve(archive);
  await vi.waitFor(() =>
    expect(f.workspace.loading.value).toMatchObject({ stage: 'reading', name: 'tone.wav' }),
  );
  reading.resolve(file);
  await vi.waitFor(() =>
    expect(f.workspace.loading.value).toMatchObject({
      stage: 'decoding',
      name: 'tone.wav',
      mediaId: archive.project.media[0]?.mediaId,
    }),
  );
  decoding.resolve();
  await restore;
  expect(f.workspace.loading.value).toBeNull();
  expect(f.editor.source?.length).toBe(48000);
});

it('clears cancelled and failed opens, and does not let an older open hide a newer one', async () => {
  const f = setup();
  const old = deferred<ReturnType<typeof audioFile> | null>();
  const next = deferred<ReturnType<typeof audioFile> | null>();
  f.platform.openFile = () => old.promise;
  const first = f.workspace.openAudio();
  expect(f.workspace.loading.value?.stage).toBe('opening');
  f.platform.openFile = () => next.promise;
  const second = f.workspace.openAudio();
  old.resolve(null);
  await first;
  expect(f.workspace.loading.value?.stage).toBe('opening');
  next.resolve(null);
  await second;
  expect(f.workspace.loading.value).toBeNull();
  f.platform.openFile = () => Promise.reject(new Error('Read failed'));
  await f.workspace.openAudio();
  expect(f.workspace.loading.value).toBeNull();
  expect(f.editor.isError).toBe(true);
});

it('keeps missing project media editable and cancels a pending media read when closing', async () => {
  const f = setup();
  await f.workspace.loadAudio({ ...audioFile(), absolutePath: 'C:/Audio/tone.wav' });
  f.opened = {
    name: 'project.wosdx',
    reference: 'project-grant',
    bytes: encodeProject(f.editor.document),
  };
  f.platform.openProjectMedia = () => Promise.reject(new Error('File moved'));
  await f.workspace.openProject();
  expect(f.editor.source).toBeNull();
  expect(f.editor.limited).toBe(false);
  expect(f.editor.status.segments[0]?.key).toBe('projectMediaMissing');
  expect(f.workspace.loading.value).toBeNull();
  const reading = deferred<ReturnType<typeof audioFile>>();
  f.platform.openProjectMedia = () => reading.promise;
  const opening = f.workspace.openProject();
  await vi.waitFor(() => expect(f.workspace.loading.value?.stage).toBe('reading'));
  await f.workspace.reset();
  expect(f.workspace.loading.value).toBeNull();
  reading.resolve(audioFile());
  await opening;
  expect(f.editor.source).toBeNull();
  expect(f.editor.document.media).toEqual([]);
});
