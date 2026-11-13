import { Zip, ZipPassThrough } from 'fflate';
import { PROJECT_FILE_MAX_BYTES, SESSION_FILE_MAX_BYTES } from '../project/schema';
import type { FileKind, OpenedFile, OutputFile, Platform } from './contracts';

const SESSION_KEY = 'woslicer.vue.session.v2';
const CHUNK_BYTES = 1024 * 1024;
const DOWNLOAD_LIMIT = 256 * 1024 * 1024;
const FILE_LIMIT = 2 * 1024 * 1024 * 1024;
const extensions: Record<FileKind, string> = {
  audio: '.wav,.ogg',
  wos: '.wos',
  wosdx: '.wosdx',
  midi: '.mid,.midi',
  bmh: '.bmh',
};

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;
    const finish = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });
    document.body.append(input);
    try {
      input.click();
    } catch (error) {
      input.remove();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

interface Destination {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

function outputName(name: string): string {
  if (
    !name ||
    name.length > 240 ||
    // Control characters are intentionally matched: they must never survive into an output file name.
    // eslint-disable-next-line no-control-regex -- portable output names must exclude control characters
    /[<>:"/\\|?*\u0000-\u001f]/.test(name) ||
    /[. ]$/.test(name) ||
    /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)
  ) {
    throw new Error('Output must have a plain, portable file name');
  }
  return name;
}

/** Structural view of the File System Access API handle; browsers without it never reach this path. */
interface SaveFileHandle {
  createWritable(): Promise<SaveFileStream>;
}

interface SaveFileStream {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

interface SaveFilePickerHost {
  showSaveFilePicker(options: { suggestedName?: string }): Promise<SaveFileHandle>;
}

function isSaveFileHandle(value: unknown): value is SaveFileHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createWritable' in value &&
    typeof value.createWritable === 'function'
  );
}

function isSaveFileStream(value: unknown): value is SaveFileStream {
  return (
    typeof value === 'object' &&
    value !== null &&
    'write' in value &&
    typeof value.write === 'function' &&
    'close' in value &&
    typeof value.close === 'function' &&
    'abort' in value &&
    typeof value.abort === 'function'
  );
}

function hasSaveFilePicker(target: object): target is SaveFilePickerHost {
  return 'showSaveFilePicker' in target && typeof target.showSaveFilePicker === 'function';
}

async function fileDestination(value: unknown): Promise<Destination> {
  if (!isSaveFileHandle(value)) throw new Error('Invalid save-file handle');
  const stream: unknown = await value.createWritable();
  if (!isSaveFileStream(stream)) throw new Error('Invalid writable file stream');
  return {
    async write(bytes) {
      await stream.write(bytes);
    },
    async close() {
      await stream.close();
    },
    async abort() {
      await stream.abort();
    },
  };
}

async function chooseDestination(name: string, mime: string): Promise<Destination | null> {
  outputName(name);
  if (hasSaveFilePicker(window)) {
    try {
      const handle: unknown = await window.showSaveFilePicker({ suggestedName: name });
      return await fileDestination(handle);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      throw error;
    }
  }
  // Browsers without writable file handles can only initiate a download. Ask before
  // consuming the iterator, and bound the Blob fallback rather than growing forever.
  if (!window.confirm(`Download ${name}?`)) return null;
  const parts: BlobPart[] = [];
  let size = 0;
  return {
    write(bytes) {
      size += bytes.byteLength;
      if (size > DOWNLOAD_LIMIT)
        return Promise.reject(
          new Error(
            'This browser limits downloads to 256 MiB; use the desktop app for larger exports',
          ),
        );
      parts.push(new Uint8Array(bytes));
      return Promise.resolve();
    },
    close() {
      const url = URL.createObjectURL(new Blob(parts, { type: mime }));
      parts.length = 0;
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
        // The browser must have time to acquire the Blob before revocation.
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      return Promise.resolve();
    },
    abort() {
      parts.length = 0;
      return Promise.resolve();
    },
  };
}

async function exportZip(
  files: AsyncIterable<OutputFile>,
  destination: Destination,
): Promise<number> {
  let pending: Uint8Array[] = [];
  const zip = new Zip((error, bytes) => {
    if (error) throw error;
    pending.push(bytes);
  });
  const flush = async () => {
    const batch = pending;
    pending = [];
    for (const bytes of batch) await destination.write(bytes);
  };
  const names = new Set<string>();
  let total = 0;
  try {
    for await (const file of files) {
      outputName(file.name);
      const name = file.name.toLowerCase();
      if (names.has(name)) throw new Error('Duplicate export file name');
      if (names.size >= 65_534 || total + file.bytes.length > FILE_LIMIT)
        throw new Error('ZIP export exceeds the supported size');
      names.add(name);
      total += file.bytes.length;
      const entry = new ZipPassThrough(file.name);
      zip.add(entry);
      for (let offset = 0; offset < file.bytes.length; offset += CHUNK_BYTES) {
        entry.push(file.bytes.subarray(offset, offset + CHUNK_BYTES));
        await flush();
      }
      entry.push(new Uint8Array(), true);
      await flush();
    }
    zip.end();
    await flush();
    await destination.close();
    return names.size;
  } catch (error) {
    zip.terminate();
    await destination.abort();
    throw error;
  }
}

export function createBrowserPlatform(): Platform {
  return {
    kind: 'browser',
    async openFile(kind): Promise<OpenedFile | null> {
      const file = await pickFile(extensions[kind]);
      if (!file) return null;
      if (
        !extensions[kind]
          .split(',')
          .some((extension) => file.name.toLowerCase().endsWith(extension))
      )
        throw new Error('Unsupported file extension');
      if (file.size > FILE_LIMIT) throw new Error('File exceeds 2 GiB');
      if (kind === 'wosdx' && file.size > PROJECT_FILE_MAX_BYTES)
        throw new Error('Project exceeds 64 MiB');
      return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), reference: null };
    },
    openProjectMedia() {
      return Promise.resolve(null);
    },
    reopenFile() {
      return Promise.reject(
        new Error('Browser files must be selected again after reopening the app'),
      );
    },
    async saveFile(kind, name, bytes) {
      if (kind === 'wosdx' && bytes.byteLength > PROJECT_FILE_MAX_BYTES)
        throw new Error('Project exceeds 64 MiB');
      const destination = await chooseDestination(name, 'application/octet-stream');
      if (!destination) return false;
      try {
        for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES)
          await destination.write(bytes.subarray(offset, offset + CHUNK_BYTES));
        await destination.close();
        return true;
      } catch (error) {
        await destination.abort();
        throw error;
      }
    },
    async exportFiles(files, archiveName) {
      const name = archiveName.toLowerCase().endsWith('.zip') ? archiveName : `${archiveName}.zip`;
      const destination = await chooseDestination(name, 'application/zip');
      return destination === null ? null : exportZip(files, destination);
    },
    async readClipboard() {
      return navigator.clipboard.readText();
    },
    async writeClipboard(text) {
      await navigator.clipboard.writeText(text);
    },
    readSession(): Promise<unknown> {
      // Sync body work must surface as a rejected promise, so run it inside the executor.
      return new Promise((resolve) => {
        const value = localStorage.getItem(SESSION_KEY);
        const parsed: unknown = value === null ? null : JSON.parse(value);
        resolve(parsed);
      });
    },
    writeSession(snapshot) {
      return new Promise<void>((resolve) => {
        const value = JSON.stringify(snapshot);
        if (value === undefined) throw new Error('Session must be JSON data');
        localStorage.setItem(SESSION_KEY, value);
        resolve();
      });
    },
    clearSession() {
      localStorage.removeItem(SESSION_KEY);
      return Promise.resolve();
    },
    async importLegacySession() {
      return importBrowserLegacySession();
    },
    setTheme(mode) {
      document.documentElement.style.colorScheme = mode;
      return Promise.resolve();
    },
  };
}

export function getBrowserBuildIdentity(): unknown {
  return __BUILD_IDENTITY__;
}

export async function importBrowserLegacySession(): Promise<unknown> {
  const file = await pickFile('.json');
  if (file === null) return null;
  if (file.size > SESSION_FILE_MAX_BYTES) throw new Error('Session exceeds 65 MiB');
  const value: unknown = JSON.parse(await file.text());
  return value;
}
