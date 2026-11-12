import { watch } from 'vue';
import type { Platform } from '../platform/contracts';
import type { EditorStore } from '../slicing/editor-store';
import { captureEditorSession } from './session';

/**
 * Serialized recovery-archive writes. A snapshot counts as persisted only after
 * its host write resolves: a failed write is reported through `onWriteError`,
 * keeps the session pending, and the next flush retries the newest content.
 */
export function createSessionPersistence(platform: Platform, editor: EditorStore, onWriteError: (error: unknown) => void) {
  let paused = false, disposed = false, pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writes: Promise<void> = Promise.resolve();
  function cancelTimer(): void { if (timer !== null) clearTimeout(timer); timer = null; }
  function flush(): Promise<void> {
    cancelTimer();
    if (paused || disposed || !pending) return writes;
    pending = false;
    const snapshot = captureEditorSession(editor);
    let succeed!: () => void, fail!: (error: unknown) => void;
    const attempt = new Promise<void>((resolve, reject) => { succeed = resolve; fail = reject; });
    writes = writes.then(() => platform.writeSession(snapshot)).then(() => succeed(), error => {
      if (!paused && !disposed) pending = true;
      fail(error);
      onWriteError(error);
    });
    return attempt;
  }
  const stop = watch(() => {
    void editor.docRevision;
    return JSON.stringify(captureEditorSession(editor));
  }, () => {
    if (paused || disposed) return;
    pending = true;
    cancelTimer(); timer = setTimeout(() => { void flush().catch(() => { /* already reported through onWriteError */ }); }, 600);
  }, { flush: 'sync' });
  function pause(): void { paused = true; pending = false; cancelTimer(); }
  function resume(): void { paused = false; }
  async function clear(): Promise<void> { cancelTimer(); await writes; await platform.clearSession(); }
  async function dispose(): Promise<void> {
    cancelTimer(); stop();
    try { if (!paused) await flush(); } finally { disposed = true; }
  }
  return { flush, pause, resume, clear, dispose };
}
