import type { z } from 'zod';
import { DEFAULT_CUE_DB, DEFAULT_PLAYBACK_DB } from '../core/volume';
import { MAX_TICKS } from '../core/timebase';
import {
  PROJECT_FILE_MAX_BYTES,
  PROJECT_FORMAT,
  PROJECT_MAX_CLIPS,
  PROJECT_SCHEMA_VERSION,
  originHintKeys,
  projectHeaderSchema,
  projectV1Schema,
  type MediaAsset,
  type ProjectCapability,
  type ProjectDecodeResult,
  type ProjectDocument,
  type ProjectFileV1,
  type ProjectParseResult,
} from './schema';

export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFormatError';
  }
}

function parseStructure<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const path = issue?.path.reduce<string>(
    (label, key) => (typeof key === 'number' ? label + '[' + key + ']' : label + '.' + String(key)),
    'Project',
  );
  throw new ProjectFormatError(
    (path ?? 'Project') + ': ' + (issue?.message ?? 'invalid structure'),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Compare with the stripped schema output, without maintaining a second field list. */
function unknownFields(input: unknown, project: ProjectFileV1): string[] {
  const fields: string[] = [];
  function visit(raw: unknown, known: unknown, path: string): void {
    if (fields.length >= 16) return;
    if (Array.isArray(raw) && Array.isArray(known)) {
      known.forEach((value: unknown, index: number) =>
        visit(raw[index], value, path + '[' + index + ']'),
      );
      return;
    }
    if (!isRecord(raw) || !isRecord(known)) return;
    for (const key of Object.keys(raw)) {
      if (fields.length >= 16) return;
      // Both origin variants' fields were recognized by the original v1 reader.
      if (path.endsWith('.originHint') && originHintKeys.has(key)) continue;
      if (!Object.hasOwn(known, key)) fields.push(path ? path + '.' + key : key);
    }
    for (const [key, value] of Object.entries(known)) {
      visit(raw[key], value, path ? path + '.' + key : key);
    }
  }
  visit(input, project, '');
  return fields;
}

export function projectCapability(project: ProjectDocument): ProjectCapability {
  const clipCount = project.tracks.reduce((sum, track) => sum + track.clips.length, 0);
  if (project.tracks.length === 1 && clipCount === 0 && project.media.length === 0)
    return { kind: 'empty' };
  if (project.tracks.length !== 1 || clipCount !== 1)
    return { kind: 'unsupported-arrangement', trackCount: project.tracks.length, clipCount };
  const track = project.tracks[0];
  const clip = track?.clips[0];
  const media = project.media.find((item) => item.mediaId === clip?.mediaId);
  if (
    !track ||
    !clip ||
    !media ||
    track.gainDb !== 0 ||
    track.muted ||
    track.solo ||
    clip.timelineStartSeconds !== 0 ||
    clip.sourceOffsetFrames !== 0 ||
    media.framesPerChannel === null ||
    clip.frameCount !== media.framesPerChannel
  ) {
    return { kind: 'unsupported-arrangement', trackCount: project.tracks.length, clipCount };
  }
  return {
    kind: 'single-track',
    trackId: track.trackId,
    clipId: clip.clipId,
    mediaId: media.mediaId,
  };
}

export function parseProject(input: unknown): ProjectParseResult {
  const { schemaVersion: version } = parseStructure(projectHeaderSchema, input);
  if (version !== PROJECT_SCHEMA_VERSION)
    return { kind: 'unsupported-version', version, raw: input };
  const project = parseStructure(projectV1Schema, input);
  const extensions = unknownFields(input, project);

  const ids = new Set<string>();
  const addId = (id: string, label: string) => {
    if (ids.has(id)) throw new ProjectFormatError('duplicate ' + label + ' id: ' + id);
    ids.add(id);
  };
  for (const media of project.media) {
    addId(media.mediaId, 'media');
    // In-memory drafts may explicitly carry undefined; v1 omits absent hints.
    const hint = media.originHint;
    if (hint?.kind === 'browser') {
      if (hint.relativePathHint === undefined) delete hint.relativePathHint;
      if (hint.lastModified === undefined) delete hint.lastModified;
    }
  }
  const mediaById = new Map(project.media.map((item) => [item.mediaId, item]));
  let totalClips = 0;
  for (const track of project.tracks) {
    addId(track.trackId, 'track');
    totalClips += track.clips.length;
    if (totalClips > PROJECT_MAX_CLIPS)
      throw new ProjectFormatError('clip collection exceeds its limit');
    for (const clip of track.clips) {
      addId(clip.clipId, 'clip');
      const asset = mediaById.get(clip.mediaId);
      if (!asset)
        throw new ProjectFormatError(
          'clip ' + clip.clipId + ' refers to unknown media ' + clip.mediaId,
        );
      if (
        asset.framesPerChannel !== null &&
        clip.sourceOffsetFrames + clip.frameCount > asset.framesPerChannel
      )
        throw new ProjectFormatError('clip ' + clip.clipId + ' exceeds its media frame range');
    }
  }
  const markers = project.slicing.markers;
  if (new Set(markers).size !== markers.length)
    throw new ProjectFormatError('slicing.markers contains duplicate ticks');
  markers.sort((a, b) => a - b);
  return {
    kind: 'supported',
    project,
    capability: projectCapability(project),
    unknownFields: extensions,
  };
}

/** Encodes known, normalized v1 fields; use sourceBytes to preserve an unchanged file. */
export function encodeProject(value: ProjectDocument): Uint8Array {
  const normalized = parseProject(value);
  if (normalized.kind !== 'supported')
    throw new ProjectFormatError('unsupported project schema cannot be written');
  const bytes = new TextEncoder().encode(JSON.stringify(normalized.project));
  if (bytes.byteLength > PROJECT_FILE_MAX_BYTES)
    throw new ProjectFormatError('project exceeds the 64 MiB limit');
  return bytes;
}
export function decodeProject(bytes: Uint8Array): ProjectDecodeResult {
  if (bytes.byteLength > PROJECT_FILE_MAX_BYTES)
    throw new ProjectFormatError('project exceeds the 64 MiB limit');
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw new ProjectFormatError(
      `project JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const parsed = parseProject(value);
  // Construct a Uint8Array explicitly: Buffer.slice() would alias the caller's input.
  return { ...parsed, sourceBytes: new Uint8Array(bytes) };
}

export interface SingleTrackProjectInput {
  projectId: string;
  name: string;
  mediaId: string;
  media: MediaAsset;
  timing?: ProjectFileV1['timing'];
  slicing?: Partial<ProjectFileV1['slicing']>;
  output?: Partial<ProjectFileV1['output']>;
  global?: Partial<Omit<ProjectFileV1['global'], 'views'>> & {
    views?: Partial<ProjectFileV1['global']['views']>;
  };
}
export function createSingleTrackProject(input: SingleTrackProjectInput): ProjectFileV1 {
  if (input.media.mediaId !== input.mediaId || input.media.framesPerChannel === null)
    throw new ProjectFormatError(
      'single-track projects require matching media with a known frame count',
    );
  const project = createEmptyProject(input.projectId, input.name);
  return {
    ...project,
    timing: input.timing ?? project.timing,
    slicing: { ...project.slicing, ...input.slicing },
    output: {
      ...project.output,
      baseName: input.name.replace(/[^\w.-]/g, '_') || 'slice',
      ...input.output,
    },
    global: {
      ...project.global,
      ...input.global,
      views: { ...project.global.views, ...input.global?.views },
    },
    media: [input.media],
    tracks: [
      {
        trackId: `${input.projectId}:track:1`,
        name: input.name,
        gainDb: 0,
        muted: false,
        solo: false,
        views: { rms: null, bands: null, spectrum: 'reserved' },
        clips: [
          {
            clipId: `${input.projectId}:track:1:clip:1`,
            mediaId: input.mediaId,
            timelineStartSeconds: 0,
            sourceOffsetFrames: 0,
            frameCount: input.media.framesPerChannel,
          },
        ],
      },
    ],
    bmhelper: null,
  };
}

/** An empty single-track document carries no invented media or clip. */
export function createEmptyProject(
  projectId: string = crypto.randomUUID(),
  name = 'Untitled',
): ProjectFileV1 {
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId,
    name,
    timing: { bpm: 120, shiftTicks: 0 },
    slicing: {
      fadeoutMs: 0,
      noisegateDb: -48,
      noisegateEnabled: true,
      markers: [],
      bandDetection: {
        bands: { low: true, mid: true, high: true },
        thresholdDb: 6,
        minGapUnits: 1,
        snap: true,
      },
    },
    output: { baseName: 'slice', clipStartNumber: 1, useFfNumbering: false },
    global: {
      masterGainDb: DEFAULT_PLAYBACK_DB,
      masterMuted: false,
      cueGainDb: DEFAULT_CUE_DB,
      cueMode: 'off',
      playbackRate: 1,
      views: { rms: false, bands: false, spectrum: 'reserved' },
    },
    media: [],
    tracks: [
      {
        trackId: `${projectId}:track:1`,
        name,
        gainDb: 0,
        muted: false,
        solo: false,
        views: { rms: null, bands: null, spectrum: 'reserved' },
        clips: [],
      },
    ],
    bmhelper: null,
  };
}
export function projectFromWos(
  data: { bpm: number; shift: number; fadeoutMs: number; noisegateDb: number; markers: Uint8Array },
  name: string,
  projectId: string = crypto.randomUUID(),
): ProjectFileV1 {
  if (data.markers.length !== MAX_TICKS)
    throw new ProjectFormatError('WOS marker map has an invalid length');
  const project = createEmptyProject(projectId, name);
  return {
    ...project,
    timing: {
      bpm: parseStructure(projectV1Schema.shape.timing.shape.bpm, data.bpm),
      shiftTicks: parseStructure(projectV1Schema.shape.timing.shape.shiftTicks, data.shift),
    },
    slicing: {
      ...project.slicing,
      fadeoutMs: parseStructure(projectV1Schema.shape.slicing.shape.fadeoutMs, data.fadeoutMs),
      noisegateDb: parseStructure(
        projectV1Schema.shape.slicing.shape.noisegateDb,
        data.noisegateDb,
      ),
      markers: Array.from(data.markers, (marker, tick) => (marker === 1 ? tick : -1)).filter(
        (tick) => tick >= 0,
      ),
    },
  };
}

export function projectToWos(project: ProjectDocument) {
  const markers = new Uint8Array(MAX_TICKS);
  for (const tick of project.slicing.markers) markers[tick] = 1;
  return {
    bpm: project.timing.bpm,
    shift: project.timing.shiftTicks,
    fadeoutMs: project.slicing.fadeoutMs,
    noisegateDb: project.slicing.noisegateDb,
    markers,
  };
}
