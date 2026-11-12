import { watch } from 'vue';
import type { Platform } from '../platform/contracts';
import type { EditorStore } from '../slicing/editor-store';
import { captureEditorSession } from './session';

/** Serialized host writes prevent a delayed pre-reset save resurrecting cleared work. */
export function createSessionPersistence(platform: Platform, editor: EditorStore) {
  let paused = false, disposed = false, dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writes = Promise.resolve();
  function cancelTimer(): void { if (timer !== null) clearTimeout(timer); timer = null; }
  function flush(): Promise<void> {
    cancelTimer();
    if (paused || disposed || !dirty) return writes;
    dirty = false;
    const snapshot = captureEditorSession(editor);
    writes = writes.catch(() => {}).then(() => platform.writeSession(snapshot));
    return writes;
  }
  const stop = watch(() => {
    void editor.docRevision;
    return JSON.stringify(captureEditorSession(editor));
  }, () => {
    if (paused || disposed) return;
    dirty = true;
    cancelTimer(); timer = setTimeout(() => { void flush().catch(() => {}); }, 600);
  }, { flush: 'sync' });
  function pause(): void { paused = true; dirty = false; cancelTimer(); }
  function resume(): void { paused = false; }
  async function clear(): Promise<void> { cancelTimer(); await writes.catch(() => {}); await platform.clearSession(); }
  async function dispose(): Promise<void> { cancelTimer(); stop(); if (!paused) await flush().catch(() => {}); disposed = true; }
  return { flush, pause, resume, clear, dispose };
}
