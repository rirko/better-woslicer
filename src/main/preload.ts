/**
 * Preload: the only bridge between the sandboxed renderer and Node.
 * Exposes a minimal, fixed allowlist via contextBridge; no fs/path/shell
 * primitives, no arbitrary IPC invoke passthrough.
 */

import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, PRELOADED_API_KEYS } from "./channels.js";

const api = {
  platform: process.platform,

  openAudioDialog: (): Promise<string | null> => ipcRenderer.invoke(CHANNELS.openFileDialog),
  openWosDialog: (): Promise<string | null> => ipcRenderer.invoke(CHANNELS.openWosDialog),
  saveWosDialog: (suggestedName: string): Promise<string | null> =>
    ipcRenderer.invoke(CHANNELS.saveWosDialog, String(suggestedName)),
  exportSliceDialog: (suggestedName: string): Promise<string | null> =>
    ipcRenderer.invoke(CHANNELS.exportSliceDialog, String(suggestedName)),
  exportAllDialog: (suggestedDir: string): Promise<string | null> =>
    ipcRenderer.invoke(CHANNELS.exportAllDialog, String(suggestedDir)),

  readAudioFile: (path: string): Promise<ArrayBuffer> =>
    ipcRenderer.invoke(CHANNELS.readAudioFile, path),
  decodeAudioBuffer: (name: string, buffer: ArrayBuffer): Promise<unknown> =>
    ipcRenderer.invoke(CHANNELS.decodeAudioBuffer, String(name), buffer),
  readWosFile: (path: string): Promise<Uint8Array> =>
    ipcRenderer.invoke(CHANNELS.readWosFile, path),
  writeWosFile: (path: string, bytes: Uint8Array): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.writeWosFile, path, bytes),

  exportSlice: (request: unknown): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.exportSlice, request),
  exportAll: (request: unknown): Promise<{ written: string[] }> =>
    ipcRenderer.invoke(CHANNELS.exportAll, request),

  writeBmseClipboard: (text: string): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.writeClipboard, text),
  readBmseClipboard: (): Promise<string> => ipcRenderer.invoke(CHANNELS.readClipboard),

  setLanguage: (lang: string): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.setLanguage, String(lang)),

  onMenuAction: (handler: (action: string) => void): (() => void) => {
    const wrapped = (_event: unknown, action: string): void => handler(String(action));
    ipcRenderer.on(CHANNELS.menuAction, wrapped);
    return () => ipcRenderer.removeListener(CHANNELS.menuAction, wrapped);
  },

  onStateChanged: (handler: (state: { hasSource: boolean; sourcePath: string | null }) => void): (() => void) => {
    const wrapped = (_event: unknown, state: { hasSource: boolean; sourcePath: string | null }): void =>
      handler(state);
    ipcRenderer.on(CHANNELS.stateChanged, wrapped);
    return () => ipcRenderer.removeListener(CHANNELS.stateChanged, wrapped);
  },
} as const;

// Guard against accidental surface growth: the key set must stay exactly the
// documented allowlist.
const actualKeys = Object.keys(api).sort();
const expectedKeys = [...PRELOADED_API_KEYS].sort();
if (actualKeys.join(",") !== expectedKeys.join(",")) {
  throw new Error(
    `preload API surface mismatch: [${actualKeys}] != [${expectedKeys}]`
  );
}

contextBridge.exposeInMainWorld("woslicer", api);
