export const PROJECT_FORMAT = 'wosdx' as const;
export const PROJECT_SCHEMA_VERSION = 1 as const;
export const PROJECT_FILE_MAX_BYTES = 16 * 1024 * 1024;
export const PROJECT_MAX_MEDIA = 256;
export const PROJECT_MAX_TRACKS = 256;
export const PROJECT_MAX_CLIPS = 100_000;
export const PROJECT_MAX_MARKERS = 49_152;
export const PROJECT_MAX_FRAMES = 2_000_000_000;
export const PROJECT_MAX_GAIN_DB = 12;
export const PROJECT_MIN_GAIN_DB = -96;

export interface ProjectTiming {
  bpm: number;
  shiftTicks: number;
}

export type SpectrumView = 'reserved';
export interface ViewOverride {
  rms: boolean | null;
  bands: boolean | null;
  spectrum: SpectrumView;
}
export interface GlobalViewDefaults {
  rms: boolean;
  bands: boolean;
  spectrum: SpectrumView;
}

export type MediaOriginHint =
  | { kind: 'desktop'; pathHint: string }
  | { kind: 'browser'; name: string; relativePathHint?: string; lastModified?: number }
  | null;

export interface MediaAsset {
  mediaId: string;
  name: string;
  format: 'wav' | 'ogg';
  byteLength: number | null;
  sampleRateHz: number | null;
  channels: number | null;
  framesPerChannel: number | null;
  integrity: { algorithm: 'sha256'; digest: string } | null;
  originHint: MediaOriginHint;
}

export interface ProjectClip {
  clipId: string;
  mediaId: string;
  timelineStartSeconds: number;
  sourceOffsetFrames: number;
  frameCount: number;
}

export interface ProjectTrack {
  trackId: string;
  name: string;
  gainDb: number;
  muted: boolean;
  solo: boolean;
  views: ViewOverride;
  clips: ProjectClip[];
}

export interface ProjectGlobalState {
  masterGainDb: number;
  masterMuted: boolean;
  cueGainDb: number;
  cueMode: 'off' | 'cowbell' | 'triangle' | 'metronome';
  playbackRate: number;
  views: GlobalViewDefaults;
}

export interface BandDetectionSettings {
  bands: { low: boolean; mid: boolean; high: boolean };
  thresholdDb: number;
  minGapUnits: number;
  snap: boolean;
}

export interface ProjectSlicingSettings {
  fadeoutMs: number;
  noisegateDb: number;
  noisegateEnabled: boolean;
  markers: number[];
  bandDetection: BandDetectionSettings;
}

export interface OutputRecipe {
  baseName: string;
  clipStartNumber: number;
  useFfNumbering: boolean;
}

export interface ProjectFileV1 {
  format: typeof PROJECT_FORMAT;
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  projectId: string;
  name: string;
  timing: ProjectTiming;
  slicing: ProjectSlicingSettings;
  output: OutputRecipe;
  global: ProjectGlobalState;
  media: MediaAsset[];
  tracks: ProjectTrack[];
  bmhelper: { format: 'bmh'; bytesBase64: string } | null;
}

type Immutable<T> = { readonly [K in keyof T]: Immutable<T[K]> };
export type ProjectDocument = Immutable<ProjectFileV1>;

export type ProjectCapability =
  | { kind: 'empty' }
  | { kind: 'single-track'; trackId: string; clipId: string; mediaId: string }
  | { kind: 'unsupported-arrangement'; trackCount: number; clipCount: number };

export type ProjectParseResult =
  | { kind: 'supported'; project: ProjectFileV1; capability: ProjectCapability; unknownFields: readonly string[] }
  | { kind: 'unsupported-version'; version: number; raw: unknown };

/** File bytes are separate from the normalized document and never enter edit history. */
export type ProjectDecodeResult = ProjectParseResult & {
  /** Owned copy of the input view, for unchanged-file preservation only. */
  readonly sourceBytes: Uint8Array;
};

export type ProjectOpenResult = ProjectParseResult | { kind: 'invalid-media-binding'; project: ProjectFileV1; capability: ProjectCapability; mediaIds: string[] };
