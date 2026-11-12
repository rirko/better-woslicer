import { MAX_TICKS } from '../core/timebase';
import {
  PROJECT_FILE_MAX_BYTES,
  PROJECT_FORMAT,
  PROJECT_MAX_CLIPS,
  PROJECT_MAX_FRAMES,
  PROJECT_MAX_GAIN_DB,
  PROJECT_MAX_MARKERS,
  PROJECT_MAX_MEDIA,
  PROJECT_MAX_TRACKS,
  PROJECT_MIN_GAIN_DB,
  PROJECT_SCHEMA_VERSION,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ProjectFormatError(`${label} must be an object`);
  return value;
}
function string(value: unknown, label: string, max = 4096, min = 1): string {
  if (typeof value !== 'string' || value.length < min || value.length > max)
    throw new ProjectFormatError(`${label} is invalid`);
  return value;
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new ProjectFormatError(`${label} must be boolean`);
  return value;
}
function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new ProjectFormatError(`${label} is outside its supported range`);
  return value;
}
function integer(value: unknown, label: string, min: number, max: number): number {
  const result = finite(value, label, min, max);
  if (!Number.isSafeInteger(result))
    throw new ProjectFormatError(`${label} must be a safe integer`);
  return result;
}
function optionalInteger(value: unknown, label: string, min: number, max: number): number | null {
  return value === null ? null : integer(value, label, min, max);
}
function choice<const T extends readonly string[]>(
  value: unknown,
  label: string,
  choices: T,
): T[number] {
  if (typeof value !== 'string' || !choices.includes(value))
    throw new ProjectFormatError(`${label} is unsupported`);
  return value;
}
const UNKNOWN_FIELD_LIMIT = 16;
function extraFields(item: Record<string, unknown>, known: readonly string[]): string[] {
  return Object.keys(item).filter((key) => !known.includes(key));
}
const MEDIA_KEYS = [
  'mediaId',
  'format',
  'name',
  'byteLength',
  'sampleRateHz',
  'channels',
  'framesPerChannel',
  'integrity',
  'originHint',
] as const;
const TRACK_KEYS = ['trackId', 'name', 'gainDb', 'muted', 'solo', 'views', 'clips'] as const;
const CLIP_KEYS = [
  'clipId',
  'mediaId',
  'timelineStartSeconds',
  'sourceOffsetFrames',
  'frameCount',
] as const;
function viewOverride(value: unknown, label: string): ProjectFileV1['tracks'][number]['views'] {
  const item = record(value, label);
  const override = (raw: unknown, key: string): boolean | null =>
    raw === null ? null : bool(raw, `${label}.${key}`);
  if (item.spectrum !== 'reserved' && item.spectrum !== null)
    throw new ProjectFormatError(`${label}.spectrum must remain reserved or inherit`);
  return {
    rms: override(item.rms, 'rms'),
    bands: override(item.bands, 'bands'),
    spectrum: 'reserved',
  };
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
  const unknownFields: string[] = [];
  const noteUnknown = (
    item: Record<string, unknown>,
    known: readonly string[],
    prefix: string,
  ): void => {
    for (const key of extraFields(item, known))
      if (unknownFields.length < UNKNOWN_FIELD_LIMIT)
        unknownFields.push(prefix ? `${prefix}.${key}` : key);
  };
  const root = record(input, 'Project');
  noteUnknown(
    root,
    [
      'format',
      'schemaVersion',
      'projectId',
      'name',
      'timing',
      'slicing',
      'output',
      'global',
      'media',
      'tracks',
      'bmhelper',
    ],
    '',
  );
  if (root.format !== PROJECT_FORMAT) throw new ProjectFormatError('Not a wosdx project');
  const version = integer(root.schemaVersion, 'schemaVersion', 1, 1_000_000);
  if (version !== PROJECT_SCHEMA_VERSION)
    return { kind: 'unsupported-version', version, raw: input };
  const timingInput = record(root.timing, 'timing');
  noteUnknown(timingInput, ['bpm', 'shiftTicks'], 'timing');
  const slicingInput = record(root.slicing, 'slicing');
  noteUnknown(
    slicingInput,
    ['fadeoutMs', 'noisegateDb', 'noisegateEnabled', 'markers', 'bandDetection'],
    'slicing',
  );
  const outputInput = record(root.output, 'output');
  noteUnknown(outputInput, ['baseName', 'clipStartNumber', 'useFfNumbering'], 'output');
  const globalInput = record(root.global, 'global');
  noteUnknown(
    globalInput,
    ['masterGainDb', 'masterMuted', 'cueGainDb', 'cueMode', 'playbackRate', 'views'],
    'global',
  );
  const globalViewsInput = record(globalInput.views, 'global.views');
  noteUnknown(globalViewsInput, ['rms', 'bands', 'spectrum'], 'global.views');
  const detectionInput = record(slicingInput.bandDetection, 'slicing.bandDetection');
  noteUnknown(
    detectionInput,
    ['bands', 'thresholdDb', 'minGapUnits', 'snap'],
    'slicing.bandDetection',
  );
  const detectionBandsInput = record(detectionInput.bands, 'slicing.bandDetection.bands');
  noteUnknown(detectionBandsInput, ['low', 'mid', 'high'], 'slicing.bandDetection.bands');
  if (!Array.isArray(root.media) || root.media.length > PROJECT_MAX_MEDIA)
    throw new ProjectFormatError('media collection exceeds its limit');
  if (
    !Array.isArray(root.tracks) ||
    root.tracks.length === 0 ||
    root.tracks.length > PROJECT_MAX_TRACKS
  )
    throw new ProjectFormatError('tracks collection is outside its supported range');

  const ids = new Set<string>();
  const addId = (id: string, label: string) => {
    if (ids.has(id)) throw new ProjectFormatError(`duplicate ${label} id: ${id}`);
    ids.add(id);
  };
  const media: MediaAsset[] = root.media.map((raw, index) => {
    const item = record(raw, `media[${index}]`);
    noteUnknown(item, MEDIA_KEYS, `media[${index}]`);
    const mediaId = string(item.mediaId, `media[${index}].mediaId`, 128);
    addId(mediaId, 'media');
    const format = choice(item.format, `media[${index}].format`, ['wav', 'ogg'] as const);
    const name = string(item.name, `media[${index}].name`, 1024);
    const byteLength = optionalInteger(
      item.byteLength,
      `media[${index}].byteLength`,
      0,
      PROJECT_FILE_MAX_BYTES * 1024,
    );
    const sampleRateHz = optionalInteger(
      item.sampleRateHz,
      `media[${index}].sampleRateHz`,
      1,
      768000,
    );
    const channels = optionalInteger(item.channels, `media[${index}].channels`, 1, 64);
    const framesPerChannel = optionalInteger(
      item.framesPerChannel,
      `media[${index}].framesPerChannel`,
      0,
      PROJECT_MAX_FRAMES,
    );
    let originHint: MediaAsset['originHint'] = null;
    if (item.originHint !== null) {
      const hint = record(item.originHint, `media[${index}].originHint`);
      noteUnknown(
        hint,
        ['kind', 'pathHint', 'name', 'relativePathHint', 'lastModified'],
        `media[${index}].originHint`,
      );
      if (hint.kind === 'desktop')
        originHint = {
          kind: 'desktop',
          pathHint: string(hint.pathHint, `media[${index}].originHint.pathHint`),
        };
      else if (hint.kind === 'browser') {
        const relativePathHint =
          hint.relativePathHint === undefined
            ? undefined
            : string(hint.relativePathHint, `media[${index}].originHint.relativePathHint`);
        const lastModified =
          hint.lastModified === undefined
            ? undefined
            : integer(
                hint.lastModified,
                `media[${index}].originHint.lastModified`,
                0,
                Number.MAX_SAFE_INTEGER,
              );
        originHint = {
          kind: 'browser',
          name: string(hint.name, `media[${index}].originHint.name`, 1024),
          ...(relativePathHint === undefined ? {} : { relativePathHint }),
          ...(lastModified === undefined ? {} : { lastModified }),
        };
      } else throw new ProjectFormatError(`media[${index}].originHint kind is unsupported`);
    }
    let integrity: MediaAsset['integrity'] = null;
    if (item.integrity !== null) {
      const digest = record(item.integrity, `media[${index}].integrity`);
      noteUnknown(digest, ['algorithm', 'digest'], `media[${index}].integrity`);
      if (
        digest.algorithm !== 'sha256' ||
        typeof digest.digest !== 'string' ||
        !/^[0-9a-f]{64}$/i.test(digest.digest)
      )
        throw new ProjectFormatError(`media[${index}].integrity is invalid`);
      integrity = { algorithm: 'sha256', digest: digest.digest.toLowerCase() };
    }
    return {
      mediaId,
      name,
      format,
      byteLength,
      sampleRateHz,
      channels,
      framesPerChannel,
      integrity,
      originHint,
    };
  });
  const mediaById = new Map(media.map((item) => [item.mediaId, item]));
  let totalClips = 0;
  const tracks: ProjectFileV1['tracks'] = root.tracks.map((raw, trackIndex) => {
    const item = record(raw, `tracks[${trackIndex}]`);
    noteUnknown(item, TRACK_KEYS, `tracks[${trackIndex}]`);
    const trackId = string(item.trackId, `tracks[${trackIndex}].trackId`, 128);
    addId(trackId, 'track');
    const trackViewsInput = record(item.views, `tracks[${trackIndex}].views`);
    noteUnknown(trackViewsInput, ['rms', 'bands', 'spectrum'], `tracks[${trackIndex}].views`);
    if (!Array.isArray(item.clips))
      throw new ProjectFormatError(`tracks[${trackIndex}].clips must be an array`);
    totalClips += item.clips.length;
    if (totalClips > PROJECT_MAX_CLIPS)
      throw new ProjectFormatError('clip collection exceeds its limit');
    const clips = item.clips.map((clipRaw, clipIndex) => {
      const clip = record(clipRaw, `tracks[${trackIndex}].clips[${clipIndex}]`);
      noteUnknown(clip, CLIP_KEYS, `tracks[${trackIndex}].clips[${clipIndex}]`);
      const clipId = string(clip.clipId, `tracks[${trackIndex}].clips[${clipIndex}].clipId`, 128);
      addId(clipId, 'clip');
      const mediaId = string(
        clip.mediaId,
        `tracks[${trackIndex}].clips[${clipIndex}].mediaId`,
        128,
      );
      const asset = mediaById.get(mediaId);
      if (!asset) throw new ProjectFormatError(`clip ${clipId} refers to unknown media ${mediaId}`);
      const timelineStartSeconds = finite(
        clip.timelineStartSeconds,
        `clip ${clipId}.timelineStartSeconds`,
        0,
        1e9,
      );
      const sourceOffsetFrames = integer(
        clip.sourceOffsetFrames,
        `clip ${clipId}.sourceOffsetFrames`,
        0,
        PROJECT_MAX_FRAMES,
      );
      const frameCount = integer(
        clip.frameCount,
        `clip ${clipId}.frameCount`,
        0,
        PROJECT_MAX_FRAMES,
      );
      if (
        asset.framesPerChannel !== null &&
        sourceOffsetFrames + frameCount > asset.framesPerChannel
      )
        throw new ProjectFormatError(`clip ${clipId} exceeds its media frame range`);
      return { clipId, mediaId, timelineStartSeconds, sourceOffsetFrames, frameCount };
    });
    return {
      trackId,
      name: string(item.name, `tracks[${trackIndex}].name`, 512),
      gainDb: finite(
        item.gainDb,
        `tracks[${trackIndex}].gainDb`,
        PROJECT_MIN_GAIN_DB,
        PROJECT_MAX_GAIN_DB,
      ),
      muted: bool(item.muted, `tracks[${trackIndex}].muted`),
      solo: bool(item.solo, `tracks[${trackIndex}].solo`),
      views: viewOverride(trackViewsInput, `tracks[${trackIndex}].views`),
      clips,
    };
  });
  const globalViews = {
    rms: bool(globalViewsInput.rms, 'global.views.rms'),
    bands: bool(globalViewsInput.bands, 'global.views.bands'),
    spectrum:
      globalViewsInput.spectrum === 'reserved'
        ? ('reserved' as const)
        : (() => {
            throw new ProjectFormatError('global.views.spectrum is reserved in this version');
          })(),
  };
  const bandDetection = {
    bands: {
      low: bool(detectionBandsInput.low, 'bandDetection.bands.low'),
      mid: bool(detectionBandsInput.mid, 'bandDetection.bands.mid'),
      high: bool(detectionBandsInput.high, 'bandDetection.bands.high'),
    },
    thresholdDb: finite(detectionInput.thresholdDb, 'bandDetection.thresholdDb', 0, 120),
    minGapUnits: finite(detectionInput.minGapUnits, 'bandDetection.minGapUnits', 0, 192),
    snap: bool(detectionInput.snap, 'bandDetection.snap'),
  };
  const bmhelperRaw = root.bmhelper;
  let bmhelper: ProjectFileV1['bmhelper'] = null;
  if (bmhelperRaw !== null) {
    const data = record(bmhelperRaw, 'bmhelper');
    noteUnknown(data, ['format', 'bytesBase64'], 'bmhelper');
    if (
      data.format !== 'bmh' ||
      typeof data.bytesBase64 !== 'string' ||
      data.bytesBase64.length > 32 * 1024 * 1024 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.bytesBase64)
    )
      throw new ProjectFormatError('bmhelper data is invalid');
    bmhelper = { format: 'bmh', bytesBase64: data.bytesBase64 };
  }
  const project: ProjectFileV1 = {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: string(root.projectId, 'projectId', 128),
    name: string(root.name, 'name', 512),
    timing: {
      bpm: finite(timingInput.bpm, 'timing.bpm', Number.MIN_VALUE, 10000),
      shiftTicks: finite(timingInput.shiftTicks, 'timing.shiftTicks', -1e9, 1e9),
    },
    slicing: {
      fadeoutMs: integer(slicingInput.fadeoutMs, 'slicing.fadeoutMs', 0, 60000),
      noisegateDb: finite(slicingInput.noisegateDb, 'slicing.noisegateDb', -200, 0),
      noisegateEnabled: bool(slicingInput.noisegateEnabled, 'slicing.noisegateEnabled'),
      markers: (() => {
        if (
          !Array.isArray(slicingInput.markers) ||
          slicingInput.markers.length > PROJECT_MAX_MARKERS
        )
          throw new ProjectFormatError('slicing.markers exceeds its limit');
        const markers = slicingInput.markers.map((marker, index) =>
          integer(marker, `slicing.markers[${index}]`, 0, MAX_TICKS - 1),
        );
        if (new Set(markers).size !== markers.length)
          throw new ProjectFormatError('slicing.markers contains duplicate ticks');
        return [...markers].sort((a, b) => a - b);
      })(),
      bandDetection,
    },
    output: {
      baseName: string(outputInput.baseName, 'output.baseName', 240, 0),
      clipStartNumber: integer(outputInput.clipStartNumber, 'output.clipStartNumber', 0, 9999),
      useFfNumbering: bool(outputInput.useFfNumbering, 'output.useFfNumbering'),
    },
    global: {
      masterGainDb: finite(
        globalInput.masterGainDb,
        'global.masterGainDb',
        PROJECT_MIN_GAIN_DB,
        PROJECT_MAX_GAIN_DB,
      ),
      masterMuted: bool(globalInput.masterMuted, 'global.masterMuted'),
      cueGainDb: finite(
        globalInput.cueGainDb,
        'global.cueGainDb',
        PROJECT_MIN_GAIN_DB,
        PROJECT_MAX_GAIN_DB,
      ),
      cueMode: choice(globalInput.cueMode, 'global.cueMode', [
        'off',
        'cowbell',
        'triangle',
        'metronome',
      ] as const),
      playbackRate: finite(globalInput.playbackRate, 'global.playbackRate', 0.25, 1.5),
      views: globalViews,
    },
    media,
    tracks,
    bmhelper,
  };
  return { kind: 'supported', project, capability: projectCapability(project), unknownFields };
}

/** Encodes known, normalized v1 fields; use sourceBytes to preserve an unchanged file. */
export function encodeProject(value: ProjectDocument): Uint8Array {
  const normalized = parseProject(value);
  if (normalized.kind !== 'supported')
    throw new ProjectFormatError('unsupported project schema cannot be written');
  const bytes = new TextEncoder().encode(JSON.stringify(normalized.project));
  if (bytes.byteLength > PROJECT_FILE_MAX_BYTES)
    throw new ProjectFormatError('project exceeds the 16 MiB limit');
  return bytes;
}
export function decodeProject(bytes: Uint8Array): ProjectDecodeResult {
  if (bytes.byteLength > PROJECT_FILE_MAX_BYTES)
    throw new ProjectFormatError('project exceeds the 16 MiB limit');
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
      masterGainDb: -10,
      masterMuted: false,
      cueGainDb: -6,
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
      bpm: finite(data.bpm, 'WOS BPM', Number.MIN_VALUE, 10000),
      shiftTicks: finite(data.shift, 'WOS shift', -1e9, 1e9),
    },
    slicing: {
      ...project.slicing,
      fadeoutMs: integer(data.fadeoutMs, 'WOS fadeout', 0, 60000),
      noisegateDb: finite(data.noisegateDb, 'WOS noisegate', -200, 0),
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
