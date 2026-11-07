/**
 * Host access for the renderer. The application logic never talks to Electron
 * directly: it resolves a WoslicerApi implementation injected by the platform
 * entry point (the Electron preload bridge, or the browser host).
 */

export interface LoadedAudioInfo {
  path: string;
  name: string;
  sampleRate: number;
  channels: number;
  length: number;
  channelData: ArrayBuffer[];
}

export interface WoslicerApi {
  platform: string;
  openAudioDialog(): Promise<string | null>;
  openWosDialog(): Promise<string | null>;
  saveWosDialog(suggestedName: string): Promise<string | null>;
  exportSliceDialog(suggestedName: string): Promise<string | null>;
  exportAllDialog(suggestedDir: string): Promise<string | null>;
  openMidiDialog(): Promise<string | null>;
  saveMidiDialog(suggestedName: string): Promise<string | null>;
  openBmhDialog(): Promise<string | null>;
  saveBmhDialog(suggestedName: string): Promise<string | null>;
  readAudioFile(path: string): Promise<LoadedAudioInfo>;
  decodeAudioBuffer(name: string, buffer: ArrayBuffer): Promise<LoadedAudioInfo>;
  readWosFile(path: string): Promise<Uint8Array>;
  writeWosFile(path: string, bytes: Uint8Array): Promise<void>;
  readMidiFile(path: string): Promise<Uint8Array>;
  writeMidiFile(path: string, bytes: Uint8Array): Promise<void>;
  readBmhFile(path: string): Promise<Uint8Array>;
  writeBmhFile(path: string, bytes: Uint8Array): Promise<void>;
  exportSlice(request: {
    filePath: string;
    start: number;
    end: number;
    fadeoutMs: number;
    noisegateDb: number;
  }): Promise<void>;
  exportAll(request: {
    dirPath: string;
    baseName: string;
    bpm: number;
    shift: number;
    fadeoutMs: number;
    noisegateDb: number;
    markers: number[];
  }): Promise<{ written: string[]; skipped: number }>;
  writeBmseClipboard(text: string): Promise<void>;
  readBmseClipboard(): Promise<string>;
  /** Mirrors the UI language into the main process (native menu labels). */
  setLanguage(lang: string): Promise<void>;
  onMenuAction(handler: (action: string) => void): () => void;
  onStateChanged(handler: (state: { hasSource: boolean; sourcePath: string | null }) => void): () => void;
}

let currentHost: WoslicerApi | null = null;

/** Registers the platform host. The entry point calls this before any use. */
export function provideHost(host: WoslicerApi): void {
  currentHost = host;
}

export function api(): WoslicerApi {
  if (currentHost) return currentHost;
  const w = window as unknown as { woslicer?: WoslicerApi };
  if (!w.woslicer) {
    throw new Error("preload bridge unavailable: window.woslicer is missing");
  }
  currentHost = w.woslicer;
  return currentHost;
}
