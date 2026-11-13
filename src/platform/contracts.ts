export type FileKind = 'audio' | 'wos' | 'wosdx' | 'midi' | 'bmh';
export type ColorMode = 'light' | 'dark';

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
  /** A host-owned reference for reopening; browser drops have no durable reference. */
  reference: string | null;
  /** Absolute native path. Browser file inputs cannot provide this value. */
  absolutePath?: string;
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
  repositoryUrl: string | null;
}

/** System capabilities only. Audio processing and editing belong to the application. */
export interface Platform {
  readonly kind: 'browser' | 'tauri';
  openFile(kind: FileKind): Promise<OpenedFile | null>;
  reopenFile(reference: string): Promise<OpenedFile>;
  /** Resolve media from a host-authorized project, never from a renderer-supplied path. */
  openProjectMedia(projectReference: string, mediaId: string): Promise<OpenedFile | null>;
  saveFile(
    kind: Exclude<FileKind, 'audio'> | 'wav',
    name: string,
    bytes: Uint8Array,
  ): Promise<boolean>;
  /** Select a destination before consuming files. Null means the user cancelled. */
  exportFiles(files: AsyncIterable<OutputFile>, archiveName: string): Promise<number | null>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  readSession(): Promise<unknown>;
  writeSession(snapshot: unknown): Promise<void>;
  clearSession(): Promise<void>;
  /** Explicitly selected legacy recovery JSON stays untrusted until the workspace validates it. */
  importLegacySession(): Promise<unknown>;
  setTheme(mode: ColorMode): Promise<void>;
}
