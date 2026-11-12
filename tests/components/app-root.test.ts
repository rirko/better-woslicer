import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { ElMessageBox } from 'element-plus';
import App from '../../src/app/App.vue';
import EditorToolbar from '../../src/app/components/EditorToolbar.vue';
import CalibrationDialog from '../../src/calibration/CalibrationDialog.vue';
import { pinia, localization } from '../../src/app/runtime';
import { useEditorStore } from '../../src/slicing/editor-store';
import { useBmhelperStore } from '../../src/bmhelper/store';

const effects = vi.hoisted(() => ({ stopAudio: vi.fn(), disposeAudio: vi.fn(), restore: vi.fn(async () => {}), reset: vi.fn(async () => {}), disposeWorkspace: vi.fn(async () => {}), keydown: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/platform', () => ({
  getPlatform: () => ({ kind: 'browser', setTheme: async () => {} }),
  // Intentionally unresolved: mounting and interaction must not wait for build metadata.
  getBuildIdentity: () => new Promise(() => {}),
}));
vi.mock('../../src/workspace/workspace', () => ({ createWorkspace: () => ({ restoreSession: effects.restore, reset: effects.reset, dispose: effects.disposeWorkspace }), provideWorkspace: () => {} }));
vi.mock('../../src/playback', () => ({ createPlayback: () => ({ stop: effects.stopAudio, dispose: effects.disposeAudio, getAudioContext: () => null }), providePlayback: () => {} }));
vi.mock('../../src/app/commands', () => ({ createCommands: (options: { onClose: () => Promise<void>; onAbout: () => void }) => ({
  execute: async (command: string) => { effects.execute(command); if (command === 'close-project') await options.onClose(); if (command === 'about') options.onAbout(); },
  onKeyDown: effects.keydown,
}) }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); useEditorStore(pinia).reset(); useBmhelperStore(pinia).reset(); });
function render() {
  return mount(App, { global: { plugins: [pinia, localization.i18n], stubs: { EditorToolbar: true, WorkspacePanels: true, StatusBar: true, TimelineEditor: true, PlaybackControls: true, CalibrationDialog: true, AboutDialog: true } } });
}

it('mounts without Suspense or build metadata and releases owned subscriptions on unmount', async () => {
  const wrapper = render();
  expect(wrapper.find('main').exists()).toBe(true);
  await flushPromises();
  expect(effects.restore).toHaveBeenCalledOnce();
  expect(wrapper.find('[role="menubar"]').exists()).toBe(true);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
  expect(effects.keydown).toHaveBeenCalledOnce();
  wrapper.unmount(); await flushPromises();
  expect(effects.disposeAudio).toHaveBeenCalledOnce();
  expect(effects.disposeWorkspace).toHaveBeenCalledOnce();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
  expect(effects.keydown).toHaveBeenCalledOnce();
});
it('opens calibration from toolbar, isolates keyboard dispatch, and applies its offset', async () => {
  const editor = useEditorStore(pinia);
  editor.setSource({ name: 'sample', reference: null, sampleRate: 48000, channels: 1, length: 1, data: [new Int16Array(1)], floatData: [new Float32Array(1)] });
  const wrapper = render();
  try {
    wrapper.findComponent(EditorToolbar).vm.$emit('calibrate'); await nextTick();
    expect(effects.stopAudio).toHaveBeenCalledOnce();
    expect(wrapper.findComponent(CalibrationDialog).props('modelValue')).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(effects.keydown).not.toHaveBeenCalled();
    wrapper.findComponent(CalibrationDialog).vm.$emit('apply', 32); await nextTick();
    expect(editor.tapOffsetMs).toBe(32);
  } finally { wrapper.unmount(); }
});
it('coordinates confirmed workspace and BMHelper reset through the command dispatcher', async () => {
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm');
  const bmh = useBmhelperStore(pinia); bmh.name = 'discarded'; bmh.dirty = true;
  const wrapper = render();
  try {
    wrapper.findComponent(EditorToolbar).vm.$emit('command', 'close-project'); await flushPromises();
    expect(effects.execute).toHaveBeenCalledWith('close-project');
    expect(effects.reset).toHaveBeenCalledOnce();
    expect(bmh.name).toBe(''); expect(bmh.dirty).toBe(false);
  } finally { wrapper.unmount(); }
});
