import { describe, expect, it } from 'vitest';
import { WOS_FILE_SIZE, writeWos } from '../../src/core/wos';
import { createSingleTrackProject, decodeProject, encodeProject, parseProject } from '../../src/project/codec';
import type { ProjectFileV1 } from '../../src/project/schema';

function project(): ProjectFileV1 {
  return createSingleTrackProject({
    projectId: 'project-1', name: 'Song', mediaId: 'media-1',
    media: {
      mediaId: 'media-1', name: 'audio.wav', format: 'wav', byteLength: 192044,
      sampleRateHz: 48000, channels: 2, framesPerChannel: 48000, integrity: null,
      originHint: { kind: 'desktop', pathHint: 'C:\\Audio\\audio.wav' },
    },
  });
}

describe('.wosdx project document', () => {
  it('reports unrecognized fields by path instead of dropping them silently', () => {
    const value = project();
    const parsed = parseProject({ ...value, mystery: 1, timing: { ...value.timing, swing: 0.5 }, output: { ...value.output, gain: 2 } });
    expect(parsed.kind).toBe('supported');
    if (parsed.kind === 'supported') {
      expect(parsed.unknownFields).toEqual(['mystery', 'timing.swing', 'output.gain']);
      const clean = parseProject(value);
      expect(clean.kind === 'supported' && clean.unknownFields).toEqual([]);
    }
  });
  it('creates the current one-source document as one track and one full-source clip', () => {
    const value = project();
    expect(value.format).toBe('wosdx');
    expect(value.tracks).toHaveLength(1);
    expect(value.tracks[0]?.gainDb).toBe(0);
    expect(value.tracks[0]?.muted).toBe(false);
    expect(value.tracks[0]?.solo).toBe(false);
    expect(value.tracks[0]?.clips).toEqual([{ clipId: expect.any(String), mediaId: 'media-1', timelineStartSeconds: 0, sourceOffsetFrames: 0, frameCount: 48000 }]);
  });

  it('round-trips a reserved multi-track arrangement with independent clip positions and leading silence', () => {
    const value = project();
    const first = value.tracks[0];
    if (!first) throw new Error('Expected the initial track');
    first.views.rms = true;
    first.gainDb = -3;
    first.clips = [
      { clipId: 'clip-a', mediaId: 'media-1', timelineStartSeconds: 2, sourceOffsetFrames: 100, frameCount: 1200 },
      { clipId: 'clip-b', mediaId: 'media-1', timelineStartSeconds: 8, sourceOffsetFrames: 4000, frameCount: 2400 },
    ];
    value.tracks.push({
      trackId: 'track-b', name: 'Second', gainDb: 0, muted: false, solo: true,
      views: { rms: null, bands: false, spectrum: 'reserved' },
      clips: [{ clipId: 'clip-c', mediaId: 'media-1', timelineStartSeconds: 0, sourceOffsetFrames: 8000, frameCount: 400 }],
    });
    const decoded = decodeProject(encodeProject(value));
    expect(decoded.kind).toBe('supported');
    if (decoded.kind !== 'supported') throw new Error('Expected supported project');
    expect(decoded.project).toEqual(value);
    expect(decoded.capability).toEqual({ kind: 'unsupported-arrangement', trackCount: 2, clipCount: 3 });
  });

  it('treats desktop and browser references as distinct non-interchangeable variants', () => {
    const value = project();
    const media = value.media[0];
    if (!media) throw new Error('Expected media metadata');
    media.originHint = { kind: 'browser', name: 'audio.wav', relativePathHint: 'folder/audio.wav', lastModified: 1234 };
    const parsed = parseProject(JSON.parse(new TextDecoder().decode(encodeProject(value))));
    expect(parsed.kind).toBe('supported');
    if (parsed.kind !== 'supported') throw new Error('Expected supported project');
    expect(parsed.project.media[0]?.originHint).toEqual(media.originHint);
    expect(() => parseProject({ ...value, media: [{ ...media, originHint: { kind: 'browser', pathHint: 'C:\\Audio\\audio.wav' } }] })).toThrow();
  });

  it('preserves the exact complex file alongside its normalized known fields', () => {
    const value = project();
    const track = value.tracks[0];
    const media = value.media[0];
    if (!track || !media) throw new Error('Expected track and media');
    const input = {
      ...value,
      name: '音楽',
      extension: { largeInteger: '9007199254740993' },
      slicing: { ...value.slicing, markers: [48, 0, 24] },
      media: [{ ...media, integrity: { algorithm: 'sha256', digest: 'AB'.repeat(32) } }],
      tracks: [
        { ...track, views: { ...track.views, spectrum: null }, extension: { color: 'blue' } },
        { ...track, trackId: 'second', clips: [] },
      ],
    };
    // A BOM, CRLF, trailing whitespace and numeric spelling must also survive.
    const text = '\uFEFF' + JSON.stringify(input, null, 2).replaceAll('\n', '\r\n').replace('"bpm": 120', '"bpm": 1.20e2') + '\r\n ';
    const bytes = new TextEncoder().encode(text);
    const decoded = decodeProject(bytes);
    if (decoded.kind !== 'supported') throw new Error('Expected supported schema');
    expect(decoded.capability).toEqual({ kind: 'unsupported-arrangement', trackCount: 2, clipCount: 1 });
    expect(decoded.project.slicing.markers).toEqual([0, 24, 48]);
    expect(decoded.project.media[0]?.integrity?.digest).toBe('ab'.repeat(32));
    expect(decoded.project.tracks[0]?.views.spectrum).toBe('reserved');
    expect(decoded.sourceBytes).toEqual(bytes);
    expect(decoded.sourceBytes).not.toEqual(encodeProject(decoded.project));
    const reopened = decodeProject(decoded.sourceBytes);
    expect(reopened).toEqual(decoded);
  });

  it('owns a copy of the exact input view, including when the input is a Node buffer', () => {
    const bytes = encodeProject(project());
    const buffer = Buffer.concat([Buffer.from([0xff]), Buffer.from(bytes), Buffer.from([0xff])]);
    const input = buffer.subarray(1, buffer.length - 1);
    const decoded = decodeProject(input);
    input.fill(0);
    expect(decoded.sourceBytes).toEqual(bytes);
    decoded.sourceBytes.fill(1);
    expect(input.every(byte => byte === 0)).toBe(true);
  });

  it('preserves future file bytes without interpreting them as a v1 document', () => {
    const bytes = new TextEncoder().encode('{ "format": "wosdx", "schemaVersion": 99, "future": [1, 2] }\n');
    const decoded = decodeProject(bytes);
    expect(decoded).toMatchObject({ kind: 'unsupported-version', version: 99, raw: { future: [1, 2] } });
    expect(decoded).not.toHaveProperty('project');
    expect(decoded.sourceBytes).toEqual(bytes);
    bytes.fill(0);
    expect(decodeProject(decoded.sourceBytes).kind).toBe('unsupported-version');
  });

  it('rejects duplicate IDs, dangling media references and invalid numeric ranges', () => {
    const value = project();
    expect(() => parseProject({ ...value, tracks: [value.tracks[0], value.tracks[0]] })).toThrow(/duplicate/i);
    const track = value.tracks[0];
    if (!track) throw new Error('Expected track');
    expect(() => parseProject({ ...value, tracks: [{ ...track, clips: [{ ...track.clips[0]!, mediaId: 'missing' }] }] })).toThrow(/media/i);
    expect(() => parseProject({ ...value, tracks: [{ ...track, gainDb: Number.NaN }] })).toThrow();
    expect(() => parseProject({ ...value, tracks: [{ ...track, clips: [{ ...track.clips[0]!, sourceOffsetFrames: 48000, frameCount: 1 }] }] })).toThrow();
  });

  it('distinguishes future schemas from invalid data and enforces a bounded input size', () => {
    const value = project();
    const future = parseProject({ ...value, schemaVersion: 99 });
    expect(future).toMatchObject({ kind: 'unsupported-version', version: 99, raw: { schemaVersion: 99 } });
    expect(() => decodeProject(new Uint8Array(20 * 1024 * 1024))).toThrow(/16 MiB limit/i);
    expect(() => decodeProject(new TextEncoder().encode('{bad json'))).toThrow(/json/i);
  });

  it('keeps spectrum explicitly reserved and keeps global view defaults separate from detection settings', () => {
    const value = project();
    expect(value.global.views).toEqual({ rms: false, bands: false, spectrum: 'reserved' });
    expect(value.tracks[0]?.views).toEqual({ rms: null, bands: null, spectrum: 'reserved' });
    expect(value.slicing).toHaveProperty('bandDetection');
  });

  it('does not alter the locked legacy WOS byte layout', () => {
    const value = project();
    expect(writeWos({ bpm: value.timing.bpm, shift: value.timing.shiftTicks, fadeoutMs: value.slicing.fadeoutMs, noisegateDb: value.slicing.noisegateDb, markers: Uint8Array.from({ length: 49152 }, (_, i) => Number(value.slicing.markers.includes(i))) })).toHaveLength(WOS_FILE_SIZE);
  });
});
