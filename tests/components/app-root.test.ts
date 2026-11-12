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

const effects = vi.hoisted(() => ({
  stopAudio: vi.fn(),
  disposeAudio: vi.fn(),
  restore: vi.fn(async () => {}),
  reset: vi.fn(async () => {}),
  openProject: vi.fn(async () => {}),
  disposeWorkspace: vi.fn(async () => {}),
  keydown: vi.fn(),
  execute: vi.fn(),
}));
vi.mock('../../src/platform', () => ({
  getPlatform: () => ({ kind: 'browser', setTheme: async () => {} }),
  // Intentionally unresolved: mounting and interaction must not wait for build metadata.
  getBuildIdentity: () => new Promise(() => {}),
}));
vi.mock('../../src/workspace/workspace', () => ({
  createWorkspace: () => ({
    restoreSession: effects.restore,
    reset: effects.reset,
    openProject: effects.openProject,
    dispose: effects.disposeWorkspace,
  }),
  provideWorkspace: () => {},
}));
vi.mock('../../src/playback', () => ({
  createPlayback: () => ({
    stop: effects.stopAudio,
    dispose: effects.disposeAudio,
    getAudioContext: () => null,
  }),
  providePlayback: () => {},
}));
vi.mock('../../src/app/commands', () => ({
  createCommands: (options: {
    onClose: () => Promise<void>;
    onOpenProject: () => Promise<void>;
    onAbout: () => void;
  }) => ({
    execute: async (command: string) => {
      effects.execute(command);
      if (command === 'close-project') await options.onClose();
      if (command === 'open-project') await options.onOpenProject();
      if (command === 'about') options.onAbout();
    },
    onKeyDown: effects.keydown,
  }),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  useEditorStore(pinia).reset();
  useBmhelperStore(pinia).reset();
});
function render() {
  return mount(App, {
    global: {
      plugins: [pinia, localization.i18n],
      stubs: {
        EditorToolbar: true,
        WorkspacePanels: true,
        StatusBar: true,
        TimelineEditor: true,
        PlaybackControls: true,
        CalibrationDialog: true,
        AboutDialog: true,
      },
    },
  });
}

it('mounts without Suspense or build metadata and releases owned subscriptions on unmount', async () => {
  const wrapper = render();
  expect(wrapper.find('main').exists()).toBe(true);
  await flushPromises();
  expect(effects.restore).toHaveBeenCalledOnce();
  expect(wrapper.find('[role="menubar"]').exists()).toBe(true);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
  expect(effects.keydown).toHaveBeenCalledOnce();
  wrapper.unmount();
  await flushPromises();
  expect(effects.disposeAudio).toHaveBeenCalledOnce();
  expect(effects.disposeWorkspace).toHaveBeenCalledOnce();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
  expect(effects.keydown).toHaveBeenCalledOnce();
});
it('opens calibration from toolbar, isolates keyboard dispatch, and applies its offset', async () => {
  const editor = useEditorStore(pinia);
  editor.setSource({
    name: 'sample',
    reference: null,
    sampleRate: 48000,
    channels: 1,
    length: 1,
    data: [new Int16Array(1)],
    sourceFormat: { kind: 'pcm' as const, bits: 16 },
    floatData: [new Float32Array(1)],
  });
  const wrapper = render();
  try {
    wrapper.findComponent(EditorToolbar).vm.$emit('calibrate');
    await nextTick();
    expect(effects.stopAudio).toHaveBeenCalledOnce();
    expect(wrapper.findComponent(CalibrationDialog).props('modelValue')).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(effects.keydown).not.toHaveBeenCalled();
    wrapper.findComponent(CalibrationDialog).vm.$emit('apply', 32);
    await nextTick();
    expect(editor.tapOffsetMs).toBe(32);
  } finally {
    wrapper.unmount();
  }
});
it('coordinates confirmed workspace and BMHelper reset through the command dispatcher', async () => {
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm');
  const bmh = useBmhelperStore(pinia);
  bmh.name = 'discarded';
  bmh.dirty = true;
  const wrapper = render();
  try {
    wrapper.findComponent(EditorToolbar).vm.$emit('command', 'close-project');
    await flushPromises();
    expect(effects.execute).toHaveBeenCalledWith('close-project');
    expect(effects.reset).toHaveBeenCalledOnce();
    expect(bmh.name).toBe('');
    expect(bmh.dirty).toBe(false);
  } finally {
    wrapper.unmount();
  }
});

// Confirmation protocol behavior: every case pins CURRENT behavior of the
// four boolean confirmations and the independent close lock so the R4
// protocol extraction can be compared against it.
function makeDirty(): void {
  const editor = useEditorStore(pinia);
  // The default document already has the gate enabled; a same-value write is a
  // no-op transaction, so flip the current value to make the edit count.
  editor.setNoisegateEnabled(!editor.document.slicing.noisegateEnabled);
}

function deferredConfirm(): {
  resolve: (value: 'confirm') => void;
  reject: (reason: unknown) => void;
} {
  // The executor assigns later, so return a mutable container instead of the
  // (still undefined) closure bindings captured at return time.
  const deferred: {
    resolve: (value: 'confirm') => void;
    reject: (reason: unknown) => void;
  } = {
    resolve: () => {},
    reject: () => {},
  };
  vi.spyOn(ElMessageBox, 'confirm').mockImplementation(
    () =>
      new Promise<'confirm'>((innerResolve, innerReject) => {
        deferred.resolve = innerResolve;
        deferred.reject = innerReject;
      }),
  );
  return deferred;
}

it('opens the project without a dialog while the document is clean', async () => {
  const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm');
  const wrapper = render();
  try {
    await flushPromises();
    expect(useEditorStore(pinia).isDirty).toBe(false);
    wrapper.findComponent(EditorToolbar).vm.$emit('command', 'open-project');
    await flushPromises();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(effects.openProject).toHaveBeenCalledOnce();
  } finally {
    wrapper.unmount();
  }
});

it('runs the confirmed project replacement and releases the lock afterwards', async () => {
  const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm');
  const wrapper = render();
  try {
    await flushPromises();
    makeDirty();
    wrapper.findComponent(EditorToolbar).vm.$emit('command', 'open-project');
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(effects.openProject).toHaveBeenCalledOnce();
    wrapper.findComponent(EditorToolbar).vm.$emit('command', 'open-project');
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(effects.openProject).toHaveBeenCalledTimes(2);
  } finally {
    wrapper.unmount();
  }
});

it('keeps the workspace and reports nothing when the replacement is cancelled', async () => {
  const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel');
  const editor = useEditorStore(pinia);
  const wrapper = render();
  try {
    await flushPromises();
    makeDirty();
    wrapper.findComponent(EditorToolbar).vm.$emit('command', 'open-project');
    await flushPromises();
    expect(effects.openProject).not.toHaveBeenCalled();
    expect(editor.isError).toBe(false);
    // The lock is released: a later confirmation still runs.
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm');
    wrapper.findComponent(EditorToolbar).vm.$emit('command', 'open-project');
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(effects.openProject).toHaveBeenCalledOnce();
  } finally {
    wrapper.unmount();
  }
});

it('treats closing the replacement dialog like cancellation', async () => {
  vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('close');
  const editor = useEditorStore(pinia);
  const wrapper = render();
  try {
    await flushPromises();
    makeDirty();
    wrapper.findComponent(EditorToolbar).vm.$emit('command', 'open-project');
    await flushPromises();
    expect(effects.openProject).not.toHaveBeenCalled();
    expect(editor.isError).toBe(false);
  } finally {
    wrapper.unmount();
  }
});

it('surfaces confirmation errors through the status bar', async () => {
  vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('confirm boom'));
  const editor = useEditorStore(pinia);
  const wrapper = render();
  try {
    await flushPromises();
    makeDirty();
    wrapper.findComponent(EditorToolbar).vm.$emit('command', 'open-project');
    await flushPromises();
    expect(effects.openProject).not.toHaveBeenCalled();
    expect(editor.isError).toBe(true);
    expect(editor.status.segments[0]?.key).toBe('loadFailed');
    expect(editor.status.segments[0]?.params).toEqual({ message: 'confirm boom' });
  } finally {
    wrapper.unmount();
  }
});

it('rejects reentry while a confirmation is pending and keeps one dialog', async () => {
  const deferred = deferredConfirm();
  const wrapper = render();
  try {
    await flushPromises();
    makeDirty();
    wrapper.findComponent(EditorToolbar).vm.$emit('command', 'open-project');
    wrapper.findComponent(EditorToolbar).vm.$emit('command', 'open-project');
    await flushPromises();
    expect(ElMessageBox.confirm).toHaveBeenCalledOnce();
    expect(effects.openProject).not.toHaveBeenCalled();
    deferred.resolve('confirm');
    await flushPromises();
    expect(effects.openProject).toHaveBeenCalledOnce();
  } finally {
    wrapper.unmount();
  }
});

it('ignores a confirmation that resolves after unmount', async () => {
  const deferred = deferredConfirm();
  const wrapper = render();
  await flushPromises();
  makeDirty();
  wrapper.findComponent(EditorToolbar).vm.$emit('command', 'open-project');
  wrapper.unmount();
  deferred.resolve('confirm');
  await flushPromises();
  expect(effects.openProject).not.toHaveBeenCalled();
});

it('blocks repeated close commands and keyboard dispatch while a reset is pending', async () => {
  const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm');
  let resolveReset!: () => void;
  effects.reset.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        resolveReset = resolve;
      }),
  );
  const bmh = useBmhelperStore(pinia);
  bmh.name = 'discarded';
  bmh.dirty = true;
  const wrapper = render();
  try {
    await flushPromises();
    wrapper.findComponent(EditorToolbar).vm.$emit('command', 'close-project');
    wrapper.findComponent(EditorToolbar).vm.$emit('command', 'close-project');
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(effects.reset).toHaveBeenCalledOnce();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    expect(effects.keydown).not.toHaveBeenCalled();
    resolveReset();
    await flushPromises();
    expect(effects.reset).toHaveBeenCalledOnce();
    expect(bmh.name).toBe('');
  } finally {
    wrapper.unmount();
  }
});

it('releases the close lock and surfaces the error when the reset fails', async () => {
  const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm');
  effects.reset.mockRejectedValueOnce(new Error('disk full'));
  const editor = useEditorStore(pinia);
  const wrapper = render();
  try {
    await flushPromises();
    wrapper.findComponent(EditorToolbar).vm.$emit('command', 'close-project');
    await flushPromises();
    expect(effects.reset).toHaveBeenCalledOnce();
    expect(editor.isError).toBe(true);
    expect(editor.status.segments[0]?.key).toBe('loadFailed');
    expect(editor.status.segments[0]?.params).toEqual({ message: 'disk full' });
    // The lock is released: a second close re-confirms and retries the reset.
    // (Workspace clearing after a successful reset is pinned by the dedicated
    // close test above; this file shares one pinia across tests.)
    wrapper.findComponent(EditorToolbar).vm.$emit('command', 'close-project');
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(effects.reset).toHaveBeenCalledTimes(2);
    expect(effects.stopAudio).toHaveBeenCalledTimes(2);
  } finally {
    wrapper.unmount();
  }
});

it('keeps the workspace and releases the lock when the close dialog is cancelled', async () => {
  const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel');
  const bmh = useBmhelperStore(pinia);
  bmh.name = 'discarded';
  bmh.dirty = true;
  const wrapper = render();
  try {
    await flushPromises();
    wrapper.findComponent(EditorToolbar).vm.$emit('command', 'close-project');
    await flushPromises();
    expect(effects.reset).not.toHaveBeenCalled();
    expect(bmh.name).toBe('discarded');
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm');
    wrapper.findComponent(EditorToolbar).vm.$emit('command', 'close-project');
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(effects.reset).toHaveBeenCalledOnce();
  } finally {
    wrapper.unmount();
  }
});
