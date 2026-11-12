import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { ElSlider } from 'element-plus';
import { setupI18n } from '../../src/i18n/setup';
import { useEditorStore } from '../../src/slicing/editor-store';
import { useUiPreferencesStore } from '../../src/ui/preferences';
import { paletteFor } from '../../src/ui/palette';
import { providePlayback, type Playback } from '../../src/playback';
import TimelineEditor from '../../src/timeline/TimelineEditor.vue';
import PlaybackControls from '../../src/playback/PlaybackControls.vue';
import { buildPeakCache } from '../../src/core/peaks';
import { MAX_TICKS } from '../../src/core/timebase';
import { drawBandEnvelope, drawWaveLane } from '../../src/timeline/waveform';
import { drawOverview, setupCanvas } from '../../src/timeline/render';

type Fill = { color: string; x: number; y: number; width: number; height: number };
function recording() {
  const fills: Fill[] = [];
  const context = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textBaseline: '',
    fillRect(x: number, y: number, width: number, height: number) { fills.push({ color: context.fillStyle, x, y, width, height }); },
    clearRect: vi.fn(), strokeRect: vi.fn(), setTransform: vi.fn(), save: vi.fn(), restore: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    setLineDash: vi.fn(), fillText: vi.fn(), rect: vi.fn(), clip: vi.fn(),
  };
  return { context, fills };
}
const recordings = new Map<HTMLCanvasElement, ReturnType<typeof recording>>();
const originalContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
const originalCapture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture');
const originalRelease = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'releasePointerCapture');
const originalHasCapture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hasPointerCapture');
const frames = new Map<number, FrameRequestCallback>(); let nextFrame = 0;
const cleanup: (() => void)[] = [];
beforeEach(() => {
  setActivePinia(createPinia()); recordings.clear(); frames.clear();
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value(this: HTMLCanvasElement) {
    let entry = recordings.get(this); if (!entry) { entry = recording(); recordings.set(this, entry); } return entry.context;
  } });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: () => false });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
});
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  if (originalContext) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', originalContext);
  for (const [key, descriptor] of [['setPointerCapture', originalCapture], ['releasePointerCapture', originalRelease], ['hasPointerCapture', originalHasCapture]] satisfies [string, PropertyDescriptor | undefined][]) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor); else Reflect.deleteProperty(HTMLElement.prototype, key);
  }
  vi.unstubAllGlobals();
});
function canvasFixture() {
  const canvas = document.createElement('canvas'); const context = canvas.getContext('2d'); const record = recordings.get(canvas);
  if (!context || !record) throw new Error('Missing canvas recorder'); return { canvas, context, record };
}
const view = { width: 12, dpr: 2, scrollTick: .002, pxPerTick: 2000, timeBase: { bpm: 120, shift: 0, sampleRate: 48000 } };
const colors = { outer: 'outer', rms: 'rms' };
async function flushFrame() { await nextTick(); const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(0); await nextTick(); }

describe('waveform drawing algorithms', () => {
  it('sizes backing canvases using fractional DPR and CSS viewport size', () => {
    const { canvas, record } = canvasFixture();
    setupCanvas(canvas, { width: 801, height: 201, dpr: 1.25 });
    expect(canvas.width).toBe(1001); expect(canvas.height).toBe(251); expect(canvas.style.width).toBe('801px');
    expect(record.context.setTransform).toHaveBeenLastCalledWith(1.25, 0, 0, 1.25, 0, 0);
  });
  it('places individual source samples at device-pixel stems without whole-tick rounding', () => {
    const { context, record } = canvasFixture(); const data = Int16Array.of(1000, 8192, -16384, 4096, 0);
    drawWaveLane(context, view, data, buildPeakCache([data]), 20, 16, colors, true);
    expect(record.fills).toEqual([
      { color: 'outer', x: 0, y: 32, width: 1, height: 8 },
      { color: 'outer', x: 8, y: 40, width: 1, height: 16 },
      { color: 'outer', x: 16, y: 36, width: 1, height: 4 },
    ]);
  });
  it('renders the intermediate connected curve instead of RMS envelope columns', () => {
    const { context, record } = canvasFixture(); const data = Int16Array.of(0, 8192, -8192, 16384);
    drawWaveLane(context, { ...view, scrollTick: 0, pxPerTick: 500 }, data, buildPeakCache([data]), 20, 16, colors, true);
    expect(record.fills).toEqual([]); expect(record.context.moveTo).toHaveBeenCalledWith(0, 40);
    expect(record.context.lineTo).toHaveBeenCalledWith(2, 32); expect(record.context.lineTo).toHaveBeenCalledWith(4, 48);
  });
  it('draws cached envelope/RMS separately, and leaves the area after source end untouched', () => {
    const { context, record } = canvasFixture(); const data = new Int16Array(1000).fill(8192); const cache = buildPeakCache([data], 4);
    drawWaveLane(context, { ...view, scrollTick: 0, pxPerTick: 1 }, data, cache, 20, 16, colors, true);
    expect(record.fills.filter(fill => fill.color === 'outer')).toHaveLength(4);
    expect(record.fills.filter(fill => fill.color === 'rms')).toHaveLength(4);
    expect(Math.max(...record.fills.map(fill => fill.x))).toBe(3);
    record.fills.length = 0;
    drawWaveLane(context, { ...view, scrollTick: 0, pxPerTick: 1 }, data, cache, 20, 16, colors, false);
    expect(record.fills.some(fill => fill.color === 'rms')).toBe(false);
  });
  it('uses each channel raw samples at finer-than-cache envelope zoom', () => {
    const { context, record } = canvasFixture(); const data = new Int16Array(1000).fill(-8192);
    const mixed = buildPeakCache([data, new Int16Array(1000).fill(16384)]);
    drawWaveLane(context, { ...view, dpr: 1, scrollTick: 0, pxPerTick: 10 }, data, mixed, 20, 16, colors, false);
    expect(record.fills[0]).toEqual({ color: 'outer', x: 0, y: 24, width: 1, height: 1 });
  });
  it('leaves band-silence gaps and interpolates non-silent envelopes', () => {
    const { context, record } = canvasFixture();
    drawBandEnvelope(context, { ...view, scrollTick: 0, pxPerTick: 500 }, buildPeakCache([new Int16Array(20)], 1), 20, 20, 16, 'band', [4, 2], 1);
    expect(record.context.moveTo).not.toHaveBeenCalled();
    drawBandEnvelope(context, { ...view, scrollTick: 0, pxPerTick: 500 }, buildPeakCache([new Int16Array(20).fill(8192)], 1), 20, 20, 16, 'band', [4, 2], 1);
    expect(record.context.moveTo).toHaveBeenCalledWith(0, 16); expect(record.context.lineTo).toHaveBeenCalled();
    expect(record.context.setLineDash).toHaveBeenLastCalledWith([]);
  });
  it('maps overview viewport to the full tick timeline, not file percentages', () => {
    const { context, record } = canvasFixture(); const editor = useEditorStore(); editor.setScrollTick(192); editor.pxPerTick = 2;
    drawOverview(context, editor, 1000, paletteFor('dark'));
    expect(record.context.strokeRect).toHaveBeenCalledWith(192 / MAX_TICKS * 1000 + .5, .5, 500 / MAX_TICKS * 1000, 35);
  });
});

it.each(['Escape', 'pointercancel', 'lostpointercapture', 'unmount'])('discards an uncommitted canvas stroke on %s', async event => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
  const { wrapper, editor } = componentFixture(); await flushFrame();
  const viewport = wrapper.get('.timeline-viewport');
  const revision = editor.docRevision;
  await viewport.trigger('pointerdown', { pointerId: 1, button: 0, clientX: 144, clientY: 30 });
  await viewport.trigger('pointermove', { pointerId: 1, clientX: 432, clientY: 30 });
  await flushFrame();
  expect(editor.previewTicks).toEqual([24, 48, 72]); expect(editor.ticks).toEqual([]);
  if (event === 'unmount') wrapper.unmount();
  else if (event === 'Escape') await viewport.trigger('keydown', { key: 'Escape' });
  else await viewport.trigger(event, { pointerId: 1 });
  expect(editor.previewTicks).toBeNull(); expect(editor.docRevision).toBe(revision);
  expect(editor.ticks).toEqual([]); expect(editor.canUndo).toBe(false);
});

function componentFixture() {
  const pinia = createPinia(); const editor = useEditorStore(pinia); const setup = setupI18n(pinia, { storage: null, locales: ['en'], prefersDark: () => false });
  const playback: Playback = {
    play: vi.fn(), pause: vi.fn(), stop: vi.fn(), togglePlayPause: vi.fn(), seekSample: vi.fn(), currentSample: () => 0,
    setRate: vi.fn(), previewSlice: vi.fn(), getAudioContext: () => { throw new Error('Audio context not used by these views'); }, dispose: vi.fn(),
  };
  const Host = defineComponent({ setup() { providePlayback(playback); return () => h('main', [h(TimelineEditor), h(PlaybackControls)]); } });
  const wrapper = mount(Host, { global: { plugins: [pinia, setup.i18n] } });
  cleanup.push(() => { wrapper.unmount(); setup.stop(); disposePinia(pinia); });
  return { wrapper, editor, playback, preferences: useUiPreferencesStore(pinia) };
}
describe('Vue timeline ownership', () => {
  it.each([1, 2])('draws at DPR %s, responds to Pinia/theme, follows playback and cancels on unmount', async dpr => {
    vi.stubGlobal('devicePixelRatio', dpr);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
    const { wrapper, editor, preferences } = componentFixture(); await flushFrame();
    const canvas = wrapper.get('canvas.timeline-canvas').element; if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing canvas');
    const record = recordings.get(canvas); if (!record) throw new Error('Missing recording');
    expect(canvas.width).toBe(800 * dpr); expect(canvas.height).toBe(200 * dpr);
    expect(record.fills.some(fill => fill.color === paletteFor('light').surface1)).toBe(true);
    record.fills.length = 0; preferences.theme = 'dark'; await flushFrame();
    expect(record.fills.some(fill => fill.color === paletteFor('dark').surface1)).toBe(true);
    const viewport = wrapper.get('.timeline-viewport');
    await viewport.trigger('pointerdown', { pointerId: 1, button: 0, clientX: 144, clientY: 30 });
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 432, clientY: 30 });
    await viewport.trigger('pointerup', { pointerId: 1, button: 0, clientX: 432, clientY: 30 });
    expect(editor.ticks).toEqual([24, 48, 72]);
    editor.setSource({ name: 'test', reference: null, channels: 1, sampleRate: 48000, length: 480000, data: [new Int16Array(480000)], floatData: [new Float32Array(480000)] });
    editor.setPlaying(true); editor.setPlayheadSample(240000); await flushFrame(); expect(editor.scrollTick).toBeGreaterThan(0);
    const scroll = editor.scrollTick; editor.followPlayhead = false; editor.setPlayheadSample(480000); await flushFrame(); expect(editor.scrollTick).toBe(scroll);
    await viewport.trigger('pointerdown', { pointerId: 2, button: 2, clientX: 144, clientY: 30 });
    wrapper.unmount(); expect(frames.size).toBe(0);
  });
  it('uses shared playback for ruler seeks, play/stop, and typed volume controls', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
    const { wrapper, editor, playback } = componentFixture();
    const controls = wrapper.getComponent(PlaybackControls); expect(controls.findAll('button')[0]?.attributes('disabled')).toBeDefined();
    editor.setSource({ name: 'test', reference: null, channels: 1, sampleRate: 48000, length: 48000, data: [new Int16Array(48000)], floatData: [new Float32Array(48000)] });
    editor.setPhase({ kind: 'ready' }); await nextTick();
    const first = controls.findAll('button')[0], second = controls.findAll('button')[1]; if (!first || !second) throw new Error('Missing playback buttons');
    await first.trigger('click'); await second.trigger('click'); expect(playback.togglePlayPause).toHaveBeenCalledOnce(); expect(playback.stop).toHaveBeenCalledOnce();
    await wrapper.get('.timeline-ruler').trigger('pointerdown', { button: 0, clientX: 144 }); expect(editor.cursorTick).toBe(24); expect(playback.seekSample).toHaveBeenCalledWith(12000);
    controls.findAllComponents(ElSlider)[0]?.vm.$emit('update:modelValue', 50); expect(editor.volume).toBeCloseTo(Math.pow(10, -30 / 20));
  });
});
