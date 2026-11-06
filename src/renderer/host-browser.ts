/**
 * Pure-browser implementation of the platform host: no backend, every capability
 * runs inside the page.
 *
 *  - Input: dynamic <input type="file"> pickers (the picked File is cached until
 *    its follow-up read) and the renderer's existing drag-and-drop path.
 *  - Single-file output: the File System Access save dialog where available
 *    (Chromium), falling back to a download everywhere else (Firefox).
 *  - Multi-file output: all slices are packed into one ZIP download, which
 *    behaves identically in Chromium and Firefox.
 *  - Clipboard: text/plain is always written (the original BMSE reads it);
 *    the custom BMSE format is written best-effort where the engine allows it.
 */

import { zipSync } from "fflate";
import { BMSE_CLIPBOARD_FORMAT_NAME, bmseBufferToText, bmseTextToBuffer } from "../core/bmse.js";
import { decodeAudio } from "../core/decode.js";
import { renderSlice } from "../core/slicer.js";
import { renderSliceFiles, type SliceFileRequest } from "../core/slices.js";
import { encodeWav16 } from "../core/wav.js";
import type { SourceAudio } from "../core/slicer.js";
import type { LoadedAudioInfo, WoslicerApi } from "./api.js";

/** Cached picked files, keyed by the synthetic path returned by the dialogs. */
const pickedAudio = new Map<string, File>();
const pickedWos = new Map<string, File>();
/** Save targets created by the *Dialog calls, keyed by the returned path. */
const saveTargets = new Map<string, { handle: FileSystemFileHandle } | { downloadName: string }>();
/** The decoded source, mirroring the Electron main process's currentSource. */
let loadedSource: SourceAudio | null = null;
let loadedSourceName = "";

function requireSource(): SourceAudio {
  if (!loadedSource) throw new Error("no audio source loaded");
  return loadedSource;
}

/**
 * Opens a transient file input and resolves with the picked file (null when
 * the user cancels; headless drivers intercept the chooser itself).
 */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.position = "absolute";
    input.style.width = "1px";
    input.style.height = "1px";
    input.style.opacity = "0";
    let settled = false;
    const finish = (value: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => finish(null));
    document.body.append(input);
    input.click();
  });
}

function stripAudioExtension(name: string): string {
  return name.replace(/\.(wav|ogg)$/i, "");
}

function toLoadedAudioInfo(path: string, displayName: string, decoded: Awaited<ReturnType<typeof decodeAudio>>): LoadedAudioInfo {
  return {
    path,
    name: stripAudioExtension(displayName),
    sampleRate: decoded.sampleRate,
    channels: decoded.channels,
    length: decoded.length,
    channelData: decoded.data.map((ch) => ch.buffer.slice(ch.byteOffset, ch.byteOffset + ch.byteLength) as ArrayBuffer),
  };
}

function cacheLoadedSource(path: string, displayName: string, decoded: Awaited<ReturnType<typeof decodeAudio>>): LoadedAudioInfo {
  loadedSource = {
    sampleRate: decoded.sampleRate,
    channels: decoded.channels,
    length: decoded.length,
    data: decoded.data,
  };
  loadedSourceName = displayName;
  return toLoadedAudioInfo(path, displayName, decoded);
}

/**
 * Creates a save target for the suggested name: the File System Access save
 * dialog where available, a plain download token otherwise. Resolves null
 * when the user cancels the dialog.
 */
async function saveTarget(suggestedName: string): Promise<string | null> {
  const picker = (window as unknown as {
    showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;
  }).showSaveFilePicker;
  if (typeof picker === "function") {
    try {
      const handle = await picker({ suggestedName });
      const token = `save:${suggestedName}`;
      saveTargets.set(token, { handle });
      return token;
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return null;
      // Anything else (unsupported options, headless) falls through to a download.
    }
  }
  const token = `download:${suggestedName}`;
  saveTargets.set(token, { downloadName: suggestedName });
  return token;
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Plain-ArrayBuffer copy: typed-array generics keep ArrayBufferLike, while
 * the platform write APIs (FileSystemWritableFileStream, Blob parts) want a
 * buffer backed by a plain ArrayBuffer. */
function toPlainCopy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

async function writeFileBytes(path: string, bytes: Uint8Array): Promise<void> {
  const target = saveTargets.get(path);
  if (!target) throw new Error(`no save target for ${path}`);
  if ("handle" in target) {
    const writable = await target.handle.createWritable();
    await writable.write(toPlainCopy(bytes));
    await writable.close();
    return;
  }
  downloadBlob(new Blob([toPlainCopy(bytes)]), target.downloadName);
}

export const browserHost: WoslicerApi = {
  platform: "web",

  async openAudioDialog() {
    const file = await pickFile(".wav,.ogg");
    if (!file) return null;
    pickedAudio.set(`picked:${file.name}`, file);
    return `picked:${file.name}`;
  },

  async openWosDialog() {
    const file = await pickFile(".wos");
    if (!file) return null;
    pickedWos.set(`picked:${file.name}`, file);
    return `picked:${file.name}`;
  },

  async saveWosDialog(suggestedName: string) {
    return saveTarget(suggestedName);
  },

  async exportSliceDialog(suggestedName: string) {
    return saveTarget(suggestedName);
  },

  async exportAllDialog() {
    // The suggested "directory" doubles as the ZIP file name the download gets.
    const base = loadedSourceName ? stripAudioExtension(loadedSourceName) : "slices";
    return `${base}.zip`;
  },

  async readAudioFile(path: string) {
    const file = pickedAudio.get(path);
    if (!file) throw new Error(`no picked audio file for ${path}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    return cacheLoadedSource(path, file.name, await decodeAudio(file.name, bytes));
  },

  async decodeAudioBuffer(name: string, buffer: ArrayBuffer) {
    return cacheLoadedSource(`dropped:${name}`, name, await decodeAudio(name, new Uint8Array(buffer)));
  },

  async readWosFile(path: string) {
    const file = pickedWos.get(path);
    if (!file) throw new Error(`no picked .wos file for ${path}`);
    return new Uint8Array(await file.arrayBuffer());
  },

  async writeWosFile(path: string, bytes: Uint8Array) {
    await writeFileBytes(path, bytes);
  },

  async exportSlice(request) {
    const rendered = renderSlice(requireSource(), {
      start: request.start,
      end: request.end,
      fadeoutMs: request.fadeoutMs,
      noisegateDb: request.noisegateDb,
    });
    await writeFileBytes(request.filePath, encodeWav16(rendered.channelsData, rendered.sampleRate, rendered.length));
  },

  async exportAll(request) {
    const files = renderSliceFiles(requireSource(), request as SliceFileRequest);
    const zip = zipSync(Object.fromEntries(files.map((f) => [f.name, toPlainCopy(f.data)])));
    downloadBlob(new Blob([toPlainCopy(zip)]), request.dirPath);
    return { written: files.map((f) => f.name) };
  },

  async writeBmseClipboard(text: string) {
    try {
      // Custom MIME formats are Chromium-only; the write throws elsewhere.
      await navigator.clipboard.write([
        new ClipboardItem({
          [BMSE_CLIPBOARD_FORMAT_NAME]: new Blob([toPlainCopy(bmseTextToBuffer(text))]),
          "text/plain": text,
        }),
      ]);
      return;
    } catch {
      // Fall through to plain text, which the original BMSE also reads.
    }
    await navigator.clipboard.writeText(text);
  },

  async readBmseClipboard() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes(BMSE_CLIPBOARD_FORMAT_NAME)) {
          const blob = await item.getType(BMSE_CLIPBOARD_FORMAT_NAME);
          return bmseBufferToText(new Uint8Array(await blob.arrayBuffer()));
        }
      }
    } catch {
      // Custom formats unsupported or permission denied: plain text below.
    }
    return navigator.clipboard.readText();
  },

  async setLanguage() {
    // No native menu to mirror in a browser.
  },

  onMenuAction() {
    // No native menu in a browser; keyboard shortcuts cover the actions.
    return () => undefined;
  },

  onStateChanged() {
    // Main-process state push; the browser host has no separate state.
    return () => undefined;
  },
};
