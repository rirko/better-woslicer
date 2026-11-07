/**
 * IPC channel names and the renderer-facing API contract.
 *
 * The preload script exposes exactly these functions via contextBridge —
 * nothing else reaches the renderer. The allowlist lives in a pure module so
 * tests can assert the surface without launching Electron.
 */

export const CHANNELS = {
  openFileDialog: "dialog:open-audio",
  openWosDialog: "dialog:open-wos",
  saveWosDialog: "dialog:save-wos",
  exportSliceDialog: "dialog:export-slice",
  exportAllDialog: "dialog:export-all",
  openMidiDialog: "dialog:open-midi",
  saveMidiDialog: "dialog:save-midi",
  openBmhDialog: "dialog:open-bmh",
  saveBmhDialog: "dialog:save-bmh",
  readAudioFile: "file:read-audio",
  decodeAudioBuffer: "file:decode-audio-buffer",
  readWosFile: "file:read-wos",
  writeWosFile: "file:write-wos",
  readMidiFile: "file:read-midi",
  writeMidiFile: "file:write-midi",
  readBmhFile: "file:read-bmh",
  writeBmhFile: "file:write-bmh",
  exportSlice: "export:slice",
  exportAll: "export:all",
  writeClipboard: "clipboard:write-bmse",
  readClipboard: "clipboard:read-bmse",
  menuAction: "menu:action",
  stateChanged: "app:state",
  setLanguage: "app:set-language",
  setTheme: "app:set-theme",
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

/** Exact key set exposed on window.woslicer. Tests assert this list. */
export const PRELOADED_API_KEYS = [
  "openAudioDialog",
  "openWosDialog",
  "saveWosDialog",
  "exportSliceDialog",
  "exportAllDialog",
  "openMidiDialog",
  "saveMidiDialog",
  "openBmhDialog",
  "saveBmhDialog",
  "readAudioFile",
  "decodeAudioBuffer",
  "readWosFile",
  "writeWosFile",
  "readMidiFile",
  "writeMidiFile",
  "readBmhFile",
  "writeBmhFile",
  "exportSlice",
  "exportAll",
  "writeBmseClipboard",
  "readBmseClipboard",
  "onMenuAction",
  "onStateChanged",
  "platform",
  "setLanguage",
  "setTheme",
] as const;

export type PreloadedApiKey = (typeof PRELOADED_API_KEYS)[number];

/** File extensions accepted by the open dialog and the file readers. */
export const AUDIO_EXTENSIONS = [".wav", ".ogg"] as const;
export const WOS_EXTENSIONS = [".wos"] as const;
export const MIDI_EXTENSIONS = [".mid", ".midi", ".smf"] as const;
export const BMH_EXTENSIONS = [".bmh"] as const;

/** Validation shared by IPC handlers (pure, unit-tested). */
export function hasAudioExtension(path: string): boolean {
  return AUDIO_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext));
}

export function hasWosExtension(path: string): boolean {
  return WOS_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext));
}

export function hasMidiExtension(path: string): boolean {
  return MIDI_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext));
}

export function hasBmhExtension(path: string): boolean {
  return BMH_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext));
}

/** Payload accepted by export:slice / export:all, with validation rules. */
export interface ExportSliceRequest {
  filePath: string;
  start: number;
  end: number;
  fadeoutMs: number;
  noisegateDb: number;
}

export function validateExportRequest(req: unknown): ExportSliceRequest {
  const r = req as ExportSliceRequest;
  if (typeof r !== "object" || r === null) throw new Error("invalid export request");
  if (typeof r.filePath !== "string" || !hasAudioExtension(r.filePath)) {
    throw new Error(`export target must be a .wav/.ogg source path (got ${String(r.filePath)})`);
  }
  for (const key of ["start", "end", "fadeoutMs"] as const) {
    if (!Number.isSafeInteger(r[key])) {
      throw new Error(`export field ${key} must be an integer (got ${String(r[key])})`);
    }
  }
  // The original Cut() takes a double dB value: accept any finite number.
  if (typeof r.noisegateDb !== "number" || !Number.isFinite(r.noisegateDb)) {
    throw new Error(`export field noisegateDb must be a finite number (got ${String(r.noisegateDb)})`);
  }
  if (r.start < 0 || r.end < r.start) {
    throw new Error(`invalid slice range [${r.start}, ${r.end})`);
  }
  if (r.fadeoutMs < 0) {
    throw new Error(`export fadeoutMs must be >= 0 (got ${r.fadeoutMs})`);
  }
  return r;
}

/* ------------------------------------------------------------------ */
/* Output path validation (pure, unit-tested)                          */
/* ------------------------------------------------------------------ */

function hasForbiddenSegments(p: string): boolean {
  // Split on both separators; reject traversal, device namespaces and
  // control characters. Renderers pass dialog-chosen paths, but they could
  // pass anything, so the shape is validated before any IO.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(p)) return true;
  if (/^\\\\[.?]/.test(p)) return true; // \\? \\. device namespaces
  const segments = p.split(new RegExp("[\\\\/]"));
  return segments.some((s) => s === "..");
}

/** Output path for a rendered slice WAV. */
export function validateWavOutputPath(p: unknown): string {
  if (typeof p !== "string" || p.length === 0) {
    throw new Error(`WAV output path must be a non-empty string (got ${String(p)})`);
  }
  if (hasForbiddenSegments(p)) {
    throw new Error(`WAV output path contains forbidden path segments: ${p}`);
  }
  if (!p.toLowerCase().endsWith(".wav")) {
    throw new Error(`WAV output path must end in .wav (got ${p})`);
  }
  return p;
}

/** Path for reading or writing a .wos project file. */
export function validateWosFilePath(p: unknown): string {
  if (typeof p !== "string" || p.length === 0) {
    throw new Error(`wos path must be a non-empty string (got ${String(p)})`);
  }
  if (hasForbiddenSegments(p)) {
    throw new Error(`wos path contains forbidden path segments: ${p}`);
  }
  if (!p.toLowerCase().endsWith(".wos")) {
    throw new Error(`wos path must end in .wos (got ${p})`);
  }
  return p;
}

function validateExtensionPath(p: unknown, extensions: readonly string[], label: string): string {
  if (typeof p !== "string" || p.length === 0) {
    throw new Error(`${label} path must be a non-empty string (got ${String(p)})`);
  }
  if (hasForbiddenSegments(p)) {
    throw new Error(`${label} path contains forbidden path segments: ${p}`);
  }
  if (!extensions.some((ext) => p.toLowerCase().endsWith(ext))) {
    throw new Error(`${label} path must end in ${extensions.join("/")} (got ${p})`);
  }
  return p;
}

/** Path for reading or writing a MIDI file. */
export function validateMidiFilePath(p: unknown): string {
  return validateExtensionPath(p, MIDI_EXTENSIONS, "MIDI");
}

/** Path for reading or writing a BMHelper project file. */
export function validateBmhFilePath(p: unknown): string {
  return validateExtensionPath(p, BMH_EXTENSIONS, "bmh");
}

/** Directory for total export. */
export function validateDirectoryPath(p: unknown): string {
  if (typeof p !== "string" || p.length === 0) {
    throw new Error(`export directory must be a non-empty string (got ${String(p)})`);
  }
  if (hasForbiddenSegments(p)) {
    throw new Error(`export directory contains forbidden path segments: ${p}`);
  }
  return p;
}
