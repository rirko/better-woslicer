import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useEditorStore, type CueMode } from '../../src/slicing/editor-store';
import { createPlayback, type Playback } from '../../src/playback';
import { renderSlice } from '../../src/core/slicer';

class AudioNodeDouble {
  connect = vi.fn();
  disconnect = vi.fn();
  gain = { value: 1, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
  playbackRate = { value: 1 };
  frequency = { value: 0 };
  Q = { value: 0 };
  type = '';
  buffer: BufferDouble | null = null;
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}
class BufferDouble {
  readonly channels: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(index: number): Float32Array {
    const channel = this.channels[index];
    if (!channel) throw new RangeError('Invalid channel');
    return channel;
  }
}
const contexts: AudioContextDouble[] = [];
class AudioContextDouble {
  currentTime = 0;
  sampleRate = 48000;
  destination = new AudioNodeDouble();
  gains: AudioNodeDouble[] = [];
  sources: AudioNodeDouble[] = [];
  oscillators: AudioNodeDouble[] = [];
  filters: AudioNodeDouble[] = [];
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  constructor() {
    contexts.push(this);
  }
  createGain() {
    const node = new AudioNodeDouble();
    this.gains.push(node);
    return node;
  }
  createBufferSource() {
    const node = new AudioNodeDouble();
    this.sources.push(node);
    return node;
  }
  createOscillator() {
    const node = new AudioNodeDouble();
    this.oscillators.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = new AudioNodeDouble();
    this.filters.push(node);
    return node;
  }
  createBuffer(channels: number, length: number, rate: number) {
    return new BufferDouble(channels, length, rate);
  }
}
let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
const owners: Playback[] = [];
function frame(): void {
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(0);
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test fixture');
  return value;
}
beforeEach(() => {
  setActivePinia(createPinia());
  contexts.length = 0;
  frames.clear();
  vi.stubGlobal('AudioContext', AudioContextDouble);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id);
  });
});
afterEach(() => {
  for (const owner of owners.splice(0)) owner.dispose();
  vi.unstubAllGlobals();
});
function fixture(length = 480000) {
  const editor = useEditorStore();
  const data = Int16Array.from({ length }, (_, index) => Math.round(Math.sin(index / 8) * 16000));
  editor.setSource({
    name: 'local.wav',
    reference: null,
    channels: 1,
    sampleRate: 48000,
    length,
    data: [data],
    floatData: [Float32Array.from(data, (sample) => sample / 32768)],
  });
  const playback = createPlayback(editor);
  owners.push(playback);
  return { editor, playback, context: required(contexts.at(-1)) };
}

describe('Pinia playback lifetime and audio clock', () => {
  it('preserves a continuous source clock on rate changes without restarting the node', () => {
    const { editor, playback, context } = fixture();
    playback.play();
    const node = required(context.sources[0]);
    context.currentTime = 1;
    expect(playback.currentSample()).toBe(48000);
    playback.setRate(0.5);
    expect(playback.currentSample()).toBe(48000);
    expect(node.playbackRate.value).toBe(0.5);
    context.currentTime = 3;
    frame();
    expect(editor.playheadSample).toBe(96000);
    expect(context.sources).toHaveLength(1);
    playback.pause();
    expect(editor.playing).toBe(false);
    expect(editor.playheadSample).toBe(96000);
    context.currentTime = 8;
    expect(playback.currentSample()).toBe(96000);
    playback.play();
    expect(required(context.sources[1]).start).toHaveBeenCalledWith(0, 2);
    expect(required(context.sources[1]).playbackRate.value).toBe(0.5);
  });
  it('reacts to restored store preferences while running and routes monitor/cue gain separately', () => {
    const { editor, playback, context } = fixture();
    playback.play();
    context.currentTime = 2;
    editor.setPlaybackRate(1.5);
    expect(playback.currentSample()).toBe(96000);
    context.currentTime = 3;
    expect(playback.currentSample()).toBe(168000);
    editor.setVolume(0.2);
    editor.setCueVolume(0.4);
    expect(required(context.gains[0]).gain.value).toBeCloseTo(0.2, 12);
    expect(required(context.gains[1]).gain.value).toBeCloseTo(0.4, 12);
  });
  it('renders preview samples through export DSP at 1x and retriggers exclusively', () => {
    const { editor, playback, context } = fixture(4800);
    editor.setTicks([0, 4]);
    editor.setDocumentOptions({ fadeoutMs: 5, noisegateDb: -40 });
    editor.setCursorTick(0);
    playback.setRate(0.25);
    playback.play();
    const track = required(context.sources[0]);
    playback.previewSlice();
    expect(track.stop).toHaveBeenCalled();
    expect(editor.playing).toBe(false);
    const preview = required(context.sources[1]);
    expect(preview.playbackRate.value).toBe(1);
    const source = editor.source;
    if (!source) throw new Error('Missing source');
    const expected = renderSlice(source, { start: 0, end: 2000, fadeoutMs: 5, noisegateDb: -40 });
    expect(preview.buffer?.getChannelData(0)).toEqual(
      Float32Array.from(required(expected.channelsData[0]), (sample) => sample / 32768),
    );
    playback.previewSlice();
    expect(preview.stop).toHaveBeenCalled();
    expect(preview.disconnect).toHaveBeenCalled();
    const latest = required(context.sources[2]);
    playback.play();
    expect(latest.stop).toHaveBeenCalled();
  });
  it('seeks while playing, ignores stale onended callbacks, and clamps the source end', () => {
    const { editor, playback, context } = fixture();
    playback.play();
    const old = required(context.sources[0]),
      ended = old.onended;
    playback.seekSample(96000);
    expect(required(context.sources[1]).start).toHaveBeenCalledWith(0, 2);
    ended?.();
    expect(editor.playing).toBe(true);
    playback.seekSample(Infinity);
    expect(editor.playing).toBe(true);
    playback.seekSample(9999999);
    expect(editor.playheadSample).toBe(480000);
    expect(editor.playing).toBe(false);
  });
  it('advances cue cursor while disabled and cleans all synthesized voices on stop', () => {
    const { editor, playback, context } = fixture();
    editor.setTicks([24, 48, 72]);
    playback.play();
    context.currentTime = 0.3;
    frame();
    expect(context.oscillators).toHaveLength(0);
    editor.cueMode = 'cowbell';
    context.currentTime = 0.4;
    frame();
    expect(context.oscillators).toHaveLength(0);
    context.currentTime = 0.6;
    frame();
    expect(context.oscillators).toHaveLength(2);
    context.currentTime = 0.65;
    frame();
    expect(context.oscillators).toHaveLength(2);
    playback.stop();
    for (const node of [...context.oscillators, ...context.filters])
      expect(node.disconnect).toHaveBeenCalled();
  });
  it('routes master gain through project global state with mute winning and an independent cue route', () => {
    const { editor, context } = fixture();
    editor.transact((draft) => {
      draft.media = [
        {
          mediaId: 'm1',
          name: 'a.wav',
          format: 'wav',
          byteLength: 1000,
          sampleRateHz: 48000,
          channels: 1,
          framesPerChannel: 48000,
          integrity: null,
          originHint: null,
        },
      ];
      const track = draft.tracks[0];
      if (!track) throw new Error('Missing track');
      track.clips = [
        {
          clipId: 'c1',
          mediaId: 'm1',
          timelineStartSeconds: 0,
          sourceOffsetFrames: 0,
          frameCount: 48000,
        },
      ];
      draft.global.masterGainDb = -20;
      draft.global.cueGainDb = -12;
    });
    // Non-neutral track playback opens limited, so the live route is the global bus;
    // the track projection stays reserved for the multi-track schema.
    const master = required(context.gains[0]);
    expect(master.gain.value).toBeCloseTo(Math.pow(10, -20 / 20), 12);
    editor.transact((draft) => {
      draft.global.masterMuted = true;
    });
    expect(editor.masterAmp).toBe(0);
    expect(master.gain.value).toBe(0);
    editor.transact((draft) => {
      draft.global.masterMuted = false;
    });
    expect(master.gain.value).toBeCloseTo(Math.pow(10, -20 / 20), 12);
    expect(required(context.gains[1]).gain.value).toBeCloseTo(Math.pow(10, -12 / 20), 12);
  });
  it('keeps cue crossings alive across unrelated document edits during playback', async () => {
    const { editor, playback, context } = fixture();
    editor.setTicks([24, 48]);
    editor.cueMode = 'cowbell';
    await Promise.resolve();
    await Promise.resolve(); // settle the crossing-state watcher before playing
    playback.play();
    context.currentTime = 0.3;
    frame();
    expect(context.oscillators).toHaveLength(2);
    // The clock passes cut 48 before the document edit settles: an unrelated
    // output/gate change must not swallow that crossing.
    editor.setOutputOptions({ baseName: 'renamed' });
    editor.setNoisegateEnabled(false);
    context.currentTime = 0.55;
    await Promise.resolve();
    await Promise.resolve();
    frame();
    expect(context.oscillators).toHaveLength(4);
    // A time base change re-anchors the crossing state exactly once.
    editor.setDocumentOptions({ bpm: 125 });
    context.currentTime = 0.65;
    await Promise.resolve();
    await Promise.resolve();
    frame();
    expect(context.oscillators).toHaveLength(4);
    playback.stop();
  });
  it('stops on source replacement, clears animation, and disposes watchers and context once', () => {
    const { editor, playback, context } = fixture();
    playback.play();
    expect(frames.size).toBe(1);
    const old = required(context.sources[0]);
    editor.setSource(null);
    expect(old.stop).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(editor.playheadSample).toBe(0);
    const gain = required(context.gains[0]);
    playback.dispose();
    playback.dispose();
    const previous = gain.gain.value;
    editor.setVolume(0.9);
    expect(gain.gain.value).toBe(previous);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(gain.disconnect).toHaveBeenCalledTimes(1);
    playback.play();
    expect(context.sources).toHaveLength(1);
  });
  it('does not let a rejected resume from an old node stop a newer seek', async () => {
    const { editor, playback, context } = fixture();
    context.resume.mockRejectedValueOnce(new Error('Old resume cancelled'));
    playback.play();
    playback.seekSample(96000);
    await Promise.resolve();
    await Promise.resolve();
    expect(editor.playing).toBe(true);
    expect(required(context.sources[1]).stop).not.toHaveBeenCalled();
  });
  const modes: CueMode[] = ['cowbell', 'triangle', 'metronome'];
  it.each(modes)('releases all %s voice nodes after their natural audio completion', (mode) => {
    const { editor, playback, context } = fixture();
    editor.addTicks([24]);
    editor.cueMode = mode;
    playback.play();
    context.currentTime = 0.3;
    frame();
    const expected =
      mode === 'cowbell' ? [560, 845] : mode === 'triangle' ? [2637, 3951, 5274] : [1568];
    expect(context.oscillators.map((node) => node.frequency.value)).toEqual(expected);
    const voiceSources = [...context.oscillators, ...context.sources.slice(1)];
    const callbacks = voiceSources.map((node) => node.onended);
    for (const callback of callbacks) callback?.();
    for (const node of [...voiceSources, ...context.filters, ...context.gains.slice(2)])
      expect(node.disconnect).toHaveBeenCalledTimes(1);
    expect(editor.playing).toBe(true);
    playback.stop();
    for (const node of voiceSources) expect(node.disconnect).toHaveBeenCalledTimes(1);
  });
  it('reports no markers and an empty endpoint slice instead of allocating invalid buffers', () => {
    const { editor, playback, context } = fixture(4800);
    playback.previewSlice();
    expect(editor.status.segments[0]?.key).toBe('noMarkersToPreview');
    editor.setDocumentOptions({ bpm: 125 }); // 4800 frames = 10 ticks at 125 BPM.
    editor.addTicks([10]);
    editor.setCursorTick(10);
    playback.previewSlice();
    expect(editor.status.segments[0]?.key).toBe('emptySlice');
    expect(context.sources).toHaveLength(0);
  });
});
