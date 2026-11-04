/** Typed accessor for the preload-exposed API (single allowlisted surface). */

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
  readAudioFile(path: string): Promise<LoadedAudioInfo>;
  decodeAudioBuffer(name: string, buffer: ArrayBuffer): Promise<LoadedAudioInfo>;
  readWosFile(path: string): Promise<Uint8Array>;
  writeWosFile(path: string, bytes: Uint8Array): Promise<void>;
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
  }): Promise<{ written: string[] }>;
  writeBmseClipboard(text: string): Promise<void>;
  readBmseClipboard(): Promise<string>;
  /** Mirrors the UI language into the main process (native menu labels). */
  setLanguage(lang: string): Promise<void>;
  onMenuAction(handler: (action: string) => void): () => void;
  onStateChanged(handler: (state: { hasSource: boolean; sourcePath: string | null }) => void): () => void;
}

export function api(): WoslicerApi {
  const w = window as unknown as { woslicer?: WoslicerApi };
  if (!w.woslicer) {
    throw new Error("preload bridge unavailable: window.woslicer is missing");
  }
  return w.woslicer;
}
