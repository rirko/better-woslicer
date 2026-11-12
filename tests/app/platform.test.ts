import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { unzipSync } from 'fflate';
import { createBrowserPlatform, importBrowserLegacySession } from '../../src/platform/browser';
import { createTauriPlatform } from '../../src/platform/tauri';
import { getBuildIdentity, getPlatform, platform } from '../../src/platform/index';
import type { OutputFile } from '../../src/platform/contracts';

beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
});
afterEach(() => {
  clearMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'showSaveFilePicker');
  vi.restoreAllMocks();
});

function savePicker(value: unknown) {
  Object.defineProperty(window, 'showSaveFilePicker', {
    configurable: true,
    value: vi.fn().mockResolvedValue(value),
  });
}
function outputStream() {
  const chunks: Uint8Array[] = [];
  const close = vi.fn();
  const abort = vi.fn();
  const write = vi.fn((bytes: Uint8Array) => {
    chunks.push(new Uint8Array(bytes));
  });
  savePicker({ createWritable: () => ({ write, close, abort }) });
  return { chunks, write, close, abort };
}
function pickerInput(): HTMLInputElement {
  const input = document.querySelector('input[type=file]');
  if (!(input instanceof HTMLInputElement)) throw new Error('Missing real file input');
  return input;
}
/**
 * Adapts a lazily created sync iterable into the AsyncIterable that exportFiles expects.
 * The factory runs when iteration starts, so sources stay unconsumed on cancellation.
 */
function asyncIterable<T>(items: () => Iterable<T>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]: () => {
      const iterator = items()[Symbol.iterator]();
      return { next: () => Promise.resolve(iterator.next()) };
    },
  };
}
function files(): AsyncIterable<OutputFile> {
  return asyncIterable(() => [
    { name: 'first.wav', bytes: new Uint8Array([0, 255, 128]) },
    { name: '音声.wav', bytes: new Uint8Array([7, 8, 9]) },
  ]);
}

describe('browser host capabilities', () => {
  it('selects project files and rejects oversized projects before reading bytes', async () => {
    const opened = createBrowserPlatform().openFile('wosdx');
    const file = new File(['{}'], 'project.WOSDX');
    Object.defineProperty(file, 'size', { value: 64 * 1024 * 1024 + 1 });
    const read = vi.spyOn(file, 'arrayBuffer');
    expect(pickerInput().accept).toBe('.wosdx');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    pickerInput().files = transfer.files;
    pickerInput().dispatchEvent(new Event('change'));
    await expect(opened).rejects.toThrow('64 MiB');
    expect(read).not.toHaveBeenCalled();
  });
  it('exposes one platform and validates local build identity', async () => {
    expect(getPlatform()).toBe(platform);
    const identity = {
      name: 'woslicer-dx',
      version: '0.3.0',
      commit: 'a'.repeat(40),
      dirty: true,
      builtAt: '2026-01-01T00:00:00.000Z',
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(identity)));
    vi.stubGlobal('fetch', fetcher);
    expect(await getBuildIdentity()).toEqual(identity);
    const url: unknown = fetcher.mock.calls[0]?.[0];
    expect(url instanceof URL && url.pathname.endsWith('/build-info.json')).toBe(true);
    fetcher.mockResolvedValue(new Response(JSON.stringify({ ...identity, commit: 'abbreviated' })));
    await expect(getBuildIdentity()).rejects.toThrow('Invalid local build identity');
  });
  it('returns null on native input cancellation and removes the input', async () => {
    const opened = createBrowserPlatform().openFile('audio');
    pickerInput().dispatchEvent(new Event('cancel'));
    expect(await opened).toBeNull();
    expect(document.querySelector('input')).toBeNull();
  });
  it('reads actual File bytes without creating a filesystem reference', async () => {
    const opened = createBrowserPlatform().openFile('audio');
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([0, 255, 128])], 'source.wav'));
    pickerInput().files = transfer.files;
    pickerInput().dispatchEvent(new Event('change'));
    expect(await opened).toEqual({
      name: 'source.wav',
      bytes: new Uint8Array([0, 255, 128]),
      reference: null,
    });
  });
  it('imports legacy JSON only through explicit file selection', async () => {
    const imported = importBrowserLegacySession();
    const envelope = {
      version: 1,
      session: { path: 'C:/untrusted.wav' },
      preferences: { theme: null, language: 'ja' },
    };
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(envelope)], 'legacy-session-v1.json'));
    pickerInput().files = transfer.files;
    pickerInput().dispatchEvent(new Event('change'));
    expect(await imported).toEqual(envelope);
    await expect(createBrowserPlatform().reopenFile('C:/untrusted.wav')).rejects.toThrow(
      'selected again',
    );
  });
  it('does not consume export files when a save picker is cancelled', async () => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: () => Promise.reject(new DOMException('Cancelled', 'AbortError')),
    });
    const consumed = vi.fn();
    function source(): AsyncIterable<OutputFile> {
      return asyncIterable(function* () {
        consumed();
        yield { name: 'a.wav', bytes: new Uint8Array() };
      });
    }
    expect(await createBrowserPlatform().exportFiles(source(), 'slices.zip')).toBeNull();
    expect(consumed).not.toHaveBeenCalled();
    expect(await createBrowserPlatform().saveFile('wav', 'a.wav', new Uint8Array())).toBe(false);
  });
  it('streams a real ZIP whose filenames and binary payloads round-trip', async () => {
    const stream = outputStream();
    expect(await createBrowserPlatform().exportFiles(files(), 'slices.zip')).toBe(2);
    const length = stream.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const archive = new Uint8Array(length);
    let offset = 0;
    for (const chunk of stream.chunks) {
      archive.set(chunk, offset);
      offset += chunk.length;
    }
    const contents = unzipSync(archive);
    expect(contents['first.wav']).toEqual(new Uint8Array([0, 255, 128]));
    expect(contents['音声.wav']).toEqual(new Uint8Array([7, 8, 9]));
    expect(stream.close).toHaveBeenCalledOnce();
    expect(stream.abort).not.toHaveBeenCalled();
  });
  it('rejects traversal and aborts incomplete exports', async () => {
    const stream = outputStream();
    function source(): AsyncIterable<OutputFile> {
      return asyncIterable(() => [{ name: '../escape.wav', bytes: new Uint8Array([1]) }]);
    }
    await expect(createBrowserPlatform().exportFiles(source(), 'slices.zip')).rejects.toThrow(
      'plain, portable',
    );
    expect(stream.abort).toHaveBeenCalledOnce();
    expect(stream.close).not.toHaveBeenCalled();
  });
  it('round-trips local session JSON and clears only its own key', async () => {
    const browser = createBrowserPlatform();
    localStorage.setItem('unrelated', 'keep');
    await browser.writeSession({ version: 2, project: [1, 'local'] });
    expect(await browser.readSession()).toEqual({ version: 2, project: [1, 'local'] });
    await browser.clearSession();
    expect(await browser.readSession()).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });
  it('downloads exact fallback bytes and releases the Blob URL', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    let received: unknown;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      received = blob;
      return 'blob:local-download';
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download);
    });
    const bytes = new Uint8Array([0, 255, 128, 1]);
    expect(await createBrowserPlatform().saveFile('wav', 'slice.wav', bytes)).toBe(true);
    if (!(received instanceof Blob)) throw new Error('Expected the actual download Blob');
    expect(new Uint8Array(await received.arrayBuffer())).toEqual(bytes);
    expect(clicks).toEqual(['slice.wav']);
    expect(document.querySelector('a')).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:local-download');
  });
  it('cancels fallback downloads before consuming the iterator', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
    const consumed = vi.fn();
    function source(): AsyncIterable<OutputFile> {
      return asyncIterable(function* () {
        consumed();
        yield { name: 'a.wav', bytes: new Uint8Array() };
      });
    }
    expect(await createBrowserPlatform().exportFiles(source(), 'slices.zip')).toBeNull();
    expect(consumed).not.toHaveBeenCalled();
  });
});

describe('Tauri adapter boundary', () => {
  it('resolves project media by host reference and media ID, without submitting a path', async () => {
    mockIPC((command, payload) => {
      if (command === 'open_project_media') {
        expect(payload).toEqual({ projectReference: 'project-grant', mediaId: 'media-1' });
        return {
          name: 'tone.wav',
          reference: 'media-grant',
          absolutePath: 'D:/Audio/tone.wav',
          size: 3,
        };
      }
      if (command === 'begin_read') return 'transfer-1';
      if (command === 'read_file_chunk') return new Uint8Array([0, 1, 2]).buffer;
    });
    expect(await createTauriPlatform().openProjectMedia('project-grant', 'media-1')).toEqual({
      name: 'tone.wav',
      reference: 'media-grant',
      absolutePath: 'D:/Audio/tone.wav',
      bytes: new Uint8Array([0, 1, 2]),
    });
  });
  it('rejects oversized projects before opening any transfer reader', async () => {
    const calls: string[] = [];
    mockIPC((command) => {
      calls.push(command);
      if (command === 'open_file')
        return {
          name: 'project.wosdx',
          reference: 'project-grant',
          absolutePath: 'C:/project.wosdx',
          size: 64 * 1024 * 1024 + 1,
        };
    });
    await expect(createTauriPlatform().openFile('wosdx')).rejects.toThrow('64 MiB');
    expect(calls).toEqual(['open_file']);
  });
  it('saves and reads exact portable project bytes', async () => {
    const bytes = new TextEncoder().encode('{"format":"wosdx"}');
    mockIPC((command, payload) => {
      if (command === 'open_file') {
        expect(payload).toEqual({ kind: 'wosdx' });
        return {
          name: 'project.wosdx',
          reference: 'grant',
          absolutePath: 'C:/Audio/source.wav',
          size: bytes.length,
        };
      }
      if (command === 'begin_read') return 'transfer-1';
      if (command === 'read_file_chunk') {
        expect(payload).toEqual({ transfer: 'transfer-1', offset: 0, length: bytes.length });
        return bytes.buffer;
      }
      if (command === 'prepare_save') {
        expect(payload).toEqual({ kind: 'wosdx', name: 'project.wosdx', size: bytes.length });
        return 'write-id';
      }
      if (command === 'write_chunk') expect(payload).toEqual(bytes);
    });
    const host = createTauriPlatform();
    expect((await host.openFile('wosdx'))?.bytes).toEqual(bytes);
    expect(await host.saveFile('wosdx', 'project.wosdx', bytes)).toBe(true);
  });
  it('transfers raw binary chunks with backpressure before finishing', async () => {
    const bytes = new Uint8Array(1024 * 1024 + 3).fill(255);
    const calls: string[] = [];
    const chunks: Uint8Array[] = [];
    mockIPC((command, payload) => {
      calls.push(command);
      if (command === 'prepare_save') return 'write-id';
      if (command === 'write_chunk') {
        if (!(payload instanceof Uint8Array)) throw new Error('Expected raw binary');
        expect(payload.length).toBeLessThanOrEqual(1024 * 1024);
        chunks.push(new Uint8Array(payload));
      }
    });
    expect(await createTauriPlatform().saveFile('wav', 'slice.wav', bytes)).toBe(true);
    expect(calls).toEqual(['prepare_save', 'write_chunk', 'write_chunk', 'finish_write']);
    expect(chunks.map((chunk) => chunk.length)).toEqual([1024 * 1024, 3]);
    expect(chunks[1]).toEqual(new Uint8Array([255, 255, 255]));
  });
  it('does not consume cancelled exports', async () => {
    mockIPC(() => null);
    const consumed = vi.fn();
    function source(): AsyncIterable<OutputFile> {
      return asyncIterable(function* () {
        consumed();
        yield { name: 'a.wav', bytes: new Uint8Array() };
      });
    }
    expect(await createTauriPlatform().exportFiles(source(), 'ignored.zip')).toBeNull();
    expect(consumed).not.toHaveBeenCalled();
  });
  it('cleans up a failed write and its export grant', async () => {
    const calls: string[] = [];
    mockIPC((command) => {
      calls.push(command);
      if (command === 'begin_export') return 'export-id';
      if (command === 'begin_export_file') return 'write-id';
      if (command === 'write_chunk') throw new Error('Disk full');
    });
    await expect(createTauriPlatform().exportFiles(files(), 'ignored.zip')).rejects.toThrow(
      'Disk full',
    );
    expect(calls).toEqual([
      'begin_export',
      'begin_export_file',
      'write_chunk',
      'cancel_write',
      'end_export',
    ]);
  });
  it('validates host file metadata and exact binary response size', async () => {
    mockIPC((command) => {
      if (command === 'open_file')
        return {
          name: 'source.wav',
          reference: 'grant',
          absolutePath: 'C:/Audio/source.wav',
          size: 3,
        };
      if (command === 'begin_read') return 'transfer-1';
      return new Uint8Array([0, 255, 7]).buffer;
    });
    expect(await createTauriPlatform().openFile('audio')).toEqual({
      name: 'source.wav',
      reference: 'grant',
      absolutePath: 'C:/Audio/source.wav',
      bytes: new Uint8Array([0, 255, 7]),
    });
    mockIPC((command) => {
      if (command === 'open_file')
        return {
          name: 'source.wav',
          reference: 'grant',
          absolutePath: 'C:/Audio/source.wav',
          size: 3,
        };
      if (command === 'begin_read') return 'transfer-1';
      return new Uint8Array([0]).buffer;
    });
    await expect(createTauriPlatform().openFile('audio')).rejects.toThrow('Incomplete binary');
    mockIPC(() => ({
      name: 'source.wav',
      reference: 'grant',
      absolutePath: 'C:/Audio/source.wav',
      size: -1,
    }));
    await expect(createTauriPlatform().openFile('audio')).rejects.toThrow('Invalid host file');
  });
  it('releases each transfer reader after successful and failed chunk reads', async () => {
    const closed: string[] = [];
    mockIPC((command) => {
      if (command === 'open_file')
        return {
          name: 'source.wav',
          reference: 'grant',
          absolutePath: 'C:/Audio/source.wav',
          size: 3,
        };
      if (command === 'begin_read') return 'transfer-1';
      if (command === 'close_reader') {
        closed.push('transfer-1');
        return undefined;
      }
      return new Uint8Array([0, 255, 7]).buffer;
    });
    await createTauriPlatform().openFile('audio');
    expect(closed).toEqual(['transfer-1']);
    mockIPC((command) => {
      if (command === 'open_file')
        return {
          name: 'source.wav',
          reference: 'grant',
          absolutePath: 'C:/Audio/source.wav',
          size: 3,
        };
      if (command === 'begin_read') return 'transfer-2';
      if (command === 'close_reader') {
        closed.push('transfer-2');
        return undefined;
      }
      if (command === 'read_file_chunk') throw new Error('Transport lost');
      return undefined;
    });
    await expect(createTauriPlatform().openFile('audio')).rejects.toThrow('Transport lost');
    expect(closed).toEqual(['transfer-1', 'transfer-2']);
  });
});
