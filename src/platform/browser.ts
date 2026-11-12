import { Zip, ZipPassThrough } from "fflate";
import { PROJECT_FILE_MAX_BYTES } from '../project/schema';
import type { FileKind, OpenedFile, OutputFile, Platform } from "./contracts";

const SESSION_KEY = "woslicer.vue.session.v2";
const CHUNK_BYTES = 1024 * 1024;
const DOWNLOAD_LIMIT = 256 * 1024 * 1024;
const FILE_LIMIT = 2 * 1024 * 1024 * 1024;
const extensions: Record<FileKind, string> = { audio: ".wav,.ogg", wos: ".wos", wosdx: ".wosdx", midi: ".mid,.midi", bmh: ".bmh" };

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.hidden = true;
    const finish = (file: File | null) => { input.remove(); resolve(file); };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => finish(null), { once: true });
    document.body.append(input);
    try { input.click(); } catch (error) { input.remove(); reject(error); }
  });
}

interface Destination {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

function outputName(name: string): string {
  if (!name || name.length > 240 || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) ||
      /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) {
    throw new Error("Output must have a plain, portable file name");
  }
  return name;
}

async function fileDestination(value: unknown): Promise<Destination> {
  if (typeof value !== "object" || value === null || !("createWritable" in value) || typeof value.createWritable !== "function") {
    throw new Error("Invalid save-file handle");
  }
  const stream: unknown = await value.createWritable();
  if (typeof stream !== "object" || stream === null || !("write" in stream) || typeof stream.write !== "function" ||
      !("close" in stream) || typeof stream.close !== "function" || !("abort" in stream) || typeof stream.abort !== "function") {
    throw new Error("Invalid writable file stream");
  }
  const { write, close, abort } = stream;
  return {
    async write(bytes) { await write.call(stream, bytes); },
    async close() { await close.call(stream); },
    async abort() { await abort.call(stream); },
  };
}

async function chooseDestination(name: string, mime: string): Promise<Destination | null> {
  outputName(name);
  if ("showSaveFilePicker" in window && typeof window.showSaveFilePicker === "function") {
    try {
      const handle: unknown = await window.showSaveFilePicker({ suggestedName: name });
      return await fileDestination(handle);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      throw error;
    }
  }
  // Browsers without writable file handles can only initiate a download. Ask before
  // consuming the iterator, and bound the Blob fallback rather than growing forever.
  if (!window.confirm(`Download ${name}?`)) return null;
  const parts: BlobPart[] = [];
  let size = 0;
  return {
    async write(bytes) {
      size += bytes.byteLength;
      if (size > DOWNLOAD_LIMIT) throw new Error("This browser limits downloads to 256 MiB; use the desktop app for larger exports");
      parts.push(new Uint8Array(bytes));
    },
    async close() {
      const url = URL.createObjectURL(new Blob(parts, { type: mime }));
      parts.length = 0;
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.append(link);
      try { link.click(); } finally {
        link.remove();
        // The browser must have time to acquire the Blob before revocation.
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    },
    async abort() { parts.length = 0; },
  };
}

async function exportZip(files: AsyncIterable<OutputFile>, destination: Destination): Promise<number> {
  let pending: Uint8Array[] = [];
  const zip = new Zip((error, bytes) => { if (error) throw error; pending.push(bytes); });
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
      if (names.has(name)) throw new Error("Duplicate export file name");
      if (names.size >= 65_534 || total + file.bytes.length > FILE_LIMIT) throw new Error("ZIP export exceeds the supported size");
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
    kind: "browser",
    async openFile(kind): Promise<OpenedFile | null> {
      const file = await pickFile(extensions[kind]);
      if (!file) return null;
      if (!extensions[kind].split(",").some((extension) => file.name.toLowerCase().endsWith(extension))) throw new Error("Unsupported file extension");
      if (file.size > FILE_LIMIT) throw new Error("File exceeds 2 GiB");
      if (kind === 'wosdx' && file.size > PROJECT_FILE_MAX_BYTES) throw new Error('Project exceeds 16 MiB');
      return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), reference: null };
    },
    async reopenFile() { throw new Error("Browser files must be selected again after reopening the app"); },
    async saveFile(kind, name, bytes) {
      if (kind === 'wosdx' && bytes.byteLength > PROJECT_FILE_MAX_BYTES) throw new Error('Project exceeds 16 MiB');
      const destination = await chooseDestination(name, "application/octet-stream");
      if (!destination) return false;
      try {
        for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) await destination.write(bytes.subarray(offset, offset + CHUNK_BYTES));
        await destination.close();
        return true;
      } catch (error) { await destination.abort(); throw error; }
    },
    async exportFiles(files, archiveName) {
      const name = archiveName.toLowerCase().endsWith(".zip") ? archiveName : `${archiveName}.zip`;
      const destination = await chooseDestination(name, "application/zip");
      return destination === null ? null : exportZip(files, destination);
    },
    async readClipboard() { return navigator.clipboard.readText(); },
    async writeClipboard(text) { await navigator.clipboard.writeText(text); },
    async readSession(): Promise<unknown> {
      const value = localStorage.getItem(SESSION_KEY);
      return value === null ? null : JSON.parse(value);
    },
    async writeSession(snapshot) {
      const value = JSON.stringify(snapshot);
      if (value === undefined) throw new Error("Session must be JSON data");
      localStorage.setItem(SESSION_KEY, value);
    },
    async clearSession() { localStorage.removeItem(SESSION_KEY); },
    async importLegacySession() { return importBrowserLegacySession(); },
    async setTheme(mode) { document.documentElement.style.colorScheme = mode; },
  };
}

export async function getBrowserBuildIdentity(): Promise<unknown> {
  const response = await fetch(new URL("./build-info.json", window.location.href), { cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error("Local build identity is unavailable");
  return response.json();
}

export async function importBrowserLegacySession(): Promise<unknown | null> {
  const file = await pickFile(".json");
  if (file === null) return null;
  if (file.size > 16 * 1024 * 1024) throw new Error("Session exceeds 16 MiB");
  const value: unknown = JSON.parse(await file.text());
  return value;
}
