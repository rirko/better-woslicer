import { invoke } from '@tauri-apps/api/core';
import { PROJECT_FILE_MAX_BYTES } from '../project/schema';
import type { OpenedFile, Platform } from './contracts';

const CHUNK_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

function reference(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('Invalid host reference');
  return value;
}

async function readOpened(value: unknown, project = false): Promise<OpenedFile> {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('name' in value) ||
    typeof value.name !== 'string' ||
    !('reference' in value) ||
    !('size' in value) ||
    typeof value.size !== 'number' ||
    !Number.isSafeInteger(value.size) ||
    value.size < 0 ||
    value.size > MAX_FILE_BYTES
  ) {
    throw new Error('Invalid host file descriptor');
  }
  const id = reference(value.reference);
  if ((project || /\.wosdx$/i.test(value.name)) && value.size > PROJECT_FILE_MAX_BYTES)
    throw new Error('Project exceeds 16 MiB');
  // Every transfer reads through its own host handle; concurrent transfers of
  // the same reference keep independent seek positions and lifetimes.
  const transfer = reference(await invoke('begin_read', { reference: id }));
  try {
    const bytes = new Uint8Array(value.size);
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      const length = Math.min(CHUNK_BYTES, bytes.length - offset);
      const raw: unknown = await invoke('read_file_chunk', { transfer, offset, length });
      if (!(raw instanceof ArrayBuffer) || raw.byteLength !== length)
        throw new Error('Incomplete binary file transfer');
      bytes.set(new Uint8Array(raw), offset);
    }
    return { name: value.name, reference: id, bytes };
  } finally {
    await invoke('close_reader', { transfer }).catch(() => undefined);
  }
}

async function writeBytes(id: string, bytes: Uint8Array): Promise<void> {
  try {
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      await invoke('write_chunk', bytes.subarray(offset, offset + CHUNK_BYTES), {
        headers: { 'x-write-id': id },
      });
    }
    await invoke('finish_write', { id });
  } catch (error) {
    await invoke('cancel_write', { id });
    throw error;
  }
}

export function createTauriPlatform(): Platform {
  return {
    kind: 'tauri',
    async openFile(kind) {
      const value: unknown = await invoke('open_file', { kind });
      return value === null ? null : readOpened(value, kind === 'wosdx');
    },
    async reopenFile(id) {
      return readOpened(await invoke<unknown>('reopen_file', { reference: id }));
    },
    async saveFile(kind, name, bytes) {
      if (kind === 'wosdx' && bytes.byteLength > PROJECT_FILE_MAX_BYTES)
        throw new Error('Project exceeds 16 MiB');
      const id: unknown = await invoke('prepare_save', { kind, name, size: bytes.byteLength });
      if (id === null) return false;
      await writeBytes(reference(id), bytes);
      return true;
    },
    async exportFiles(files) {
      const value: unknown = await invoke('begin_export');
      if (value === null) return null;
      const exportId = reference(value);
      let count = 0;
      try {
        for await (const file of files) {
          const id: unknown = await invoke('begin_export_file', {
            exportId,
            name: file.name,
            size: file.bytes.byteLength,
          });
          await writeBytes(reference(id), file.bytes);
          count++;
        }
        return count;
      } finally {
        await invoke('end_export', { id: exportId });
      }
    },
    async readClipboard() {
      const value: unknown = await invoke('read_clipboard');
      if (typeof value !== 'string') throw new Error('Invalid clipboard response');
      return value;
    },
    async writeClipboard(text) {
      await invoke('write_clipboard', { text });
    },
    async readSession() {
      return invoke<unknown>('read_session');
    },
    async writeSession(snapshot) {
      await invoke('write_session', { snapshot });
    },
    async clearSession() {
      await invoke('clear_session');
    },
    async importLegacySession() {
      return importTauriLegacySession();
    },
    async setTheme(mode) {
      await invoke('set_theme', { mode });
    },
  };
}

export async function getTauriBuildIdentity(): Promise<unknown> {
  return invoke<unknown>('build_identity');
}
export async function importTauriLegacySession(): Promise<unknown> {
  return invoke<unknown>('import_legacy_session');
}
