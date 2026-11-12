export type FileKind = "audio" | "wos" | "wosdx" | "midi" | "bmh";
export type ColorMode = "light" | "dark";

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
  /** A host-owned reference for reopening; browser drops have no durable reference. */
  reference: string | null;
}

export interface OutputFile {
  name: string;
  bytes: Uint8Array;
}

export interface BuildIdentity {
  name: string;
  version: string;
  commit: string;
  dirty: boolean;
  builtAt: string;
}

/** System capabilities only. Audio processing and editing belong to the application. */
export interface Platform {
  readonly kind: "browser" | "tauri";
  openFile(kind: FileKind): Promise<OpenedFile | null>;
  reopenFile(reference: string): Promise<OpenedFile>;
  saveFile(kind: Exclude<FileKind, "audio"> | "wav", name: string, bytes: Uint8Array): Promise<boolean>;
  /** Select a destination before consuming files. Null means the user cancelled. */
  exportFiles(files: AsyncIterable<OutputFile>, archiveName: string): Promise<number | null>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  readSession(): Promise<unknown>;
  writeSession(snapshot: unknown): Promise<void>;
  clearSession(): Promise<void>;
  setTheme(mode: ColorMode): Promise<void>;
}
