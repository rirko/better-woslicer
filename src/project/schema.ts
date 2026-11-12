import { z } from 'zod';
import { MAX_TICKS } from '../core/timebase';

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

// Field structure and bounds live here; cross-reference and compatibility policies
// stay in codec.ts. Object schemas strip extensions from editable data.
const text = (max = 4096, min = 1) =>
  // Existing files measure strings in UTF-16 code units, not Unicode code points.
  z.string().refine((value) => value.length >= min && value.length <= max, {
    error: 'text length is outside its supported range',
  });
const integer = (min: number, max: number) => z.int().min(min).max(max);
const gain = z.number().min(PROJECT_MIN_GAIN_DB).max(PROJECT_MAX_GAIN_DB);

// Read only this envelope before deciding whether v1 validation applies.
export const projectHeaderSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  schemaVersion: integer(1, 1_000_000),
});

const originHintSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('desktop'), pathHint: text() }),
  z.object({
    kind: z.literal('browser'),
    name: text(1024),
    relativePathHint: text().optional(),
    lastModified: integer(0, Number.MAX_SAFE_INTEGER).optional(),
  }),
]);
// v1 recognizes either origin variant's keys, even when inactive.
export const originHintKeys = new Set(
  originHintSchema.options.flatMap((option) => Object.keys(option.shape)),
);

const mediaSchema = z.object({
  mediaId: text(128),
  name: text(1024),
  format: z.enum(['wav', 'ogg']),
  byteLength: integer(0, PROJECT_FILE_MAX_BYTES * 1024).nullable(),
  sampleRateHz: integer(1, 768000).nullable(),
  channels: integer(1, 64).nullable(),
  framesPerChannel: integer(0, PROJECT_MAX_FRAMES).nullable(),
  integrity: z
    .object({
      algorithm: z.literal('sha256'),
      digest: z
        .string()
        .regex(/^[0-9a-f]{64}$/i)
        .toLowerCase(),
    })
    .nullable(),
  originHint: originHintSchema.nullable(),
});
const clipSchema = z.object({
  clipId: text(128),
  mediaId: text(128),
  timelineStartSeconds: z.number().min(0).max(1e9),
  sourceOffsetFrames: integer(0, PROJECT_MAX_FRAMES),
  frameCount: integer(0, PROJECT_MAX_FRAMES),
});
const trackSchema = z.object({
  trackId: text(128),
  name: text(512),
  gainDb: gain,
  muted: z.boolean(),
  solo: z.boolean(),
  views: z.object({
    rms: z.boolean().nullable(),
    bands: z.boolean().nullable(),
    spectrum: z
      .literal('reserved')
      .nullable()
      .transform(() => 'reserved' as const),
  }),
  clips: z.array(clipSchema).max(PROJECT_MAX_CLIPS),
});

export const projectV1Schema = z.object({
  format: z.literal(PROJECT_FORMAT),
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  projectId: text(128),
  name: text(512),
  timing: z.object({
    bpm: z.number().min(Number.MIN_VALUE).max(10000),
    shiftTicks: z.number().min(-1e9).max(1e9),
  }),
  slicing: z.object({
    fadeoutMs: integer(0, 60000),
    noisegateDb: z.number().min(-200).max(0),
    noisegateEnabled: z.boolean(),
    markers: z.array(integer(0, MAX_TICKS - 1)).max(PROJECT_MAX_MARKERS),
    bandDetection: z.object({
      bands: z.object({ low: z.boolean(), mid: z.boolean(), high: z.boolean() }),
      thresholdDb: z.number().min(0).max(120),
      minGapUnits: z.number().min(0).max(192),
      snap: z.boolean(),
    }),
  }),
  output: z.object({
    baseName: text(240, 0),
    clipStartNumber: integer(0, 9999),
    useFfNumbering: z.boolean(),
  }),
  global: z.object({
    masterGainDb: gain,
    masterMuted: z.boolean(),
    cueGainDb: gain,
    cueMode: z.enum(['off', 'cowbell', 'triangle', 'metronome']),
    playbackRate: z.number().min(0.25).max(1.5),
    views: z.object({ rms: z.boolean(), bands: z.boolean(), spectrum: z.literal('reserved') }),
  }),
  media: z.array(mediaSchema).max(PROJECT_MAX_MEDIA),
  tracks: z.array(trackSchema).min(1).max(PROJECT_MAX_TRACKS),
  bmhelper: z
    .object({
      format: z.literal('bmh'),
      bytesBase64: z
        .string()
        .max(32 * 1024 * 1024)
        .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
    })
    .nullable(),
});

export type ProjectFileV1 = z.infer<typeof projectV1Schema>;
export type MediaAsset = ProjectFileV1['media'][number];
export type OutputRecipe = ProjectFileV1['output'];

type Immutable<T> = { readonly [K in keyof T]: Immutable<T[K]> };
export type ProjectDocument = Immutable<ProjectFileV1>;

export type ProjectCapability =
  | { kind: 'empty' }
  | { kind: 'single-track'; trackId: string; clipId: string; mediaId: string }
  | { kind: 'unsupported-arrangement'; trackCount: number; clipCount: number };

export type ProjectParseResult =
  | {
      kind: 'supported';
      project: ProjectFileV1;
      capability: ProjectCapability;
      unknownFields: readonly string[];
    }
  | { kind: 'unsupported-version'; version: number; raw: unknown };

/** File bytes are separate from the normalized document and never enter edit history. */
export type ProjectDecodeResult = ProjectParseResult & {
  /** Owned copy of the input view, for unchanged-file preservation only. */
  readonly sourceBytes: Uint8Array;
};

export type ProjectOpenResult =
  | ProjectParseResult
  | {
      kind: 'invalid-media-binding';
      project: ProjectFileV1;
      capability: ProjectCapability;
      mediaIds: string[];
    };
