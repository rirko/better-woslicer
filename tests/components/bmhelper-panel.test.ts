import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { createPinia, disposePinia } from 'pinia';
import { defineComponent, h } from 'vue';
import { expect, it, vi } from 'vitest';
import BMHelperPanel from '../../src/bmhelper/BMHelperPanel.vue';
import { useBmhelperStore } from '../../src/bmhelper/store';
import { useEditorStore } from '../../src/slicing/editor-store';
import { createWorkspace, workspaceKey } from '../../src/workspace/workspace';
import { setupI18n } from '../../src/i18n/setup';
import type { OpenedFile, Platform } from '../../src/platform/contracts';
import {
  bmsSequenceClipboard,
  cutPositionsClipboard,
  defaultDivisionSetting,
  wavDefinitionText,
} from '../../src/core/bmhelper';
import { writeSmfSequence } from '../../src/core/smf';

/**
 * Dialog double for every panel test: renders the default slot (settings
 * form, definition textarea) and the footer slot (dialog action buttons),
 * which VTU auto-stubs drop. Each dialog instance records its emit function
 * in template order — the settings dialog mounts first, the definitions
 * dialog second.
 */
const dialogEmits: Array<(event: string, ...args: unknown[]) => void> = [];
const dialogStub = defineComponent({
  name: 'ElDialog',
  emits: ['update:modelValue', 'closed'],
  setup(_, { slots, emit }) {
    dialogEmits.push(emit);
    return () => h('div', [slots.default?.(), slots.footer?.()]);
  },
});

// The return type stays inferred: annotating Platform would widen the vi.fn
// mocks into plain method signatures.
function createPlatform() {
  return {
    kind: 'browser' as const,
    openFile: vi.fn<() => Promise<OpenedFile | null>>(() => Promise.resolve(null)),
    reopenFile: vi.fn(() => Promise.reject(new Error('unused'))),
    saveFile: vi.fn(() => Promise.resolve(true)),
    exportFiles: vi.fn(() => Promise.resolve(null)),
    readClipboard: vi.fn(() => Promise.resolve('')),
    writeClipboard: vi.fn(async () => {}),
    readSession: vi.fn(() => Promise.resolve(null)),
    writeSession: vi.fn(async () => {}),
    clearSession: vi.fn(async () => {}),
    importLegacySession: vi.fn(() => Promise.resolve(null)),
    setTheme: vi.fn(async () => {}),
  } satisfies Platform;
}

interface PanelHarness {
  wrapper: VueWrapper;
  platform: Platform;
  store: ReturnType<typeof useBmhelperStore>;
  findButton(text: string): DOMWrapper<Element>;
  dispose(): Promise<void>;
}

function mountPanel(options: {
  platform: Platform;
  /** Store mutations to run before the first render. */
  setup?: (store: ReturnType<typeof useBmhelperStore>) => void;
}): PanelHarness {
  const pinia = createPinia();
  const translation = setupI18n(pinia, { storage: null, locales: ['en'] });
  const editor = useEditorStore(pinia);
  const workspace = createWorkspace({ platform: options.platform, editor });
  const store = useBmhelperStore(pinia);
  options.setup?.(store);
  dialogEmits.length = 0;
  const wrapper = mount(BMHelperPanel, {
    global: {
      plugins: [pinia, translation.i18n],
      provide: { [workspaceKey as symbol]: workspace },
      stubs: { PianoRoll: true, ElDialog: dialogStub },
    },
  });
  return {
    wrapper,
    platform: options.platform,
    store,
    findButton: (text) => {
      const found = wrapper.findAll('button').find((value) => value.text() === text);
      if (!found) throw new Error(`Missing button: ${text}`);
      return found;
    },
    dispose: async () => {
      wrapper.unmount();
      await workspace.dispose();
      translation.stop();
      disposePinia(pinia);
    },
  };
}

function oneNoteMidi(quantize: number): Uint8Array {
  return writeSmfSequence({
    quantize,
    notes: [{ position: 0, gate: 120, nn: 60, vel: 100 }],
    controls: [],
    pitches: [],
  });
}

function importOneNote(store: ReturnType<typeof useBmhelperStore>, midi: Uint8Array): void {
  const track = store.inspectMidi(midi).tracks.find((value) => value.noteCount > 0)?.index ?? 0;
  store.importMidi(midi, 'sample.mid', track, new Set([0]));
}

it('emits 48-per-beat cuts and uses platform clipboard and save actions', async () => {
  const platform = createPlatform();
  const harness = mountPanel({
    platform,
    setup: (store) => {
      importOneNote(store, oneNoteMidi(480));
      store.addDivision(defaultDivisionSetting('recording', 480));
    },
  });
  try {
    await harness.findButton('Apply cuts to the timeline').trigger('click');
    expect(harness.wrapper.emitted('applyCuts')).toEqual([[{ ticks: [0] }]]);
    await harness.findButton('Copy cut positions').trigger('click');
    await flushPromises();
    const division = harness.store.selectedDivision;
    if (!division) throw new Error('expected a selected division');
    expect(platform.writeClipboard).toHaveBeenCalledWith(cutPositionsClipboard(division));
    await harness.findButton('Save project').trigger('click');
    await flushPromises();
    expect(platform.saveFile).toHaveBeenCalledWith('bmh', 'sample.bmh', expect.any(Uint8Array));
    expect(harness.store.dirty).toBe(false);
    await harness.findButton('Export recording MIDI').trigger('click');
    await flushPromises();
    expect(platform.saveFile).toHaveBeenCalledWith('midi', 'recording.mid', expect.any(Uint8Array));
  } finally {
    await harness.dispose();
  }
});

it('converts dialog beat settings to ticks at the project quantize and truncates fractions', async () => {
  const platform = createPlatform();
  const midi = writeSmfSequence({
    quantize: 100,
    notes: [
      { position: 0, gate: 120, nn: 60, vel: 100 },
      { position: 400, gate: 200, nn: 62, vel: 80 },
    ],
    controls: [],
    pitches: [],
  });
  const harness = mountPanel({
    platform,
    setup: (store) => {
      importOneNote(store, midi);
    },
  });
  try {
    await harness.findButton('New division').trigger('click');
    await flushPromises();
    // Dialog fields are beat-level: the tick defaults of the original dialog
    // are divided by the 480-tick reference before display.
    const inputs = harness.wrapper.findAll<HTMLInputElement>(
      '.settings-grid .el-input-number input',
    );
    expect(inputs.map((input) => input.element.value)).toEqual(['0', '1', '0.125', '5', '0.5']);
    // 0.125 beat × 100 ticks = 12.5 ticks; the stored value must truncate.
    await inputs[0].setValue('0.125');
    await harness.wrapper.find('form').trigger('submit');
    await flushPromises();
    const division = harness.store.selectedDivision;
    if (!division) throw new Error('expected the new division');
    expect(division.quantize).toBe(100);
    // First note sits at the truncated head margin (12, not 12.5); the second
    // note follows one full min-interval beat plus the gate, rounded up to the
    // next 100-tick beat boundary (12 + 100 + 120 → 300).
    expect(division.recording.map((note) => [note.nn, note.position])).toEqual([
      [60, 12],
      [62, 300],
    ]);
  } finally {
    await harness.dispose();
  }
});

it('shows definition numbers and copies cuts, BMS sequence and definition text', async () => {
  const platform = createPlatform();
  const harness = mountPanel({
    platform,
    setup: (store) => {
      importOneNote(store, oneNoteMidi(480));
      store.addDivision(defaultDivisionSetting('recording', 480));
    },
  });
  try {
    const division = harness.store.selectedDivision;
    const source = harness.store.project?.source;
    if (!division || !source) throw new Error('expected a selected division');
    expect(harness.wrapper.find('span.definitions').text()).toBe('01');
    await harness.findButton('Copy cut positions').trigger('click');
    await flushPromises();
    expect(platform.writeClipboard).toHaveBeenLastCalledWith(cutPositionsClipboard(division));
    await harness.findButton('Copy BMS sequence').trigger('click');
    await flushPromises();
    expect(platform.writeClipboard).toHaveBeenLastCalledWith(
      bmsSequenceClipboard(division, source),
    );
    // The definitions dialog drafts the project name and previews the text.
    await harness.findButton('Definition info').trigger('click');
    const textarea = harness.wrapper.find('textarea');
    expect(textarea.element.value).toBe(wavDefinitionText(division, 'sample'));
    await harness.findButton('Copy').trigger('click');
    await flushPromises();
    expect(platform.writeClipboard).toHaveBeenLastCalledWith(wavDefinitionText(division, 'sample'));
  } finally {
    await harness.dispose();
  }
});

it('keeps the pending MIDI until the settings dialog finishes closing', async () => {
  const platform = createPlatform();
  const openedMidi: OpenedFile = { name: 'sample.mid', bytes: oneNoteMidi(480), reference: null };
  platform.openFile.mockResolvedValue(openedMidi);
  const harness = mountPanel({ platform });
  try {
    await harness.findButton('Import MIDI').trigger('click');
    await flushPromises();
    const channels = () => harness.wrapper.find('[aria-label="MIDI channels"]');
    expect(channels().exists()).toBe(true);
    const emitSettingsDialog = (event: string, ...args: unknown[]) => {
      const emit = dialogEmits[0];
      if (!emit) throw new Error('Missing settings dialog emit');
      emit(event, ...args);
    };
    // Cancel closes the dialog first; the pending file clears only on 'closed'.
    emitSettingsDialog('update:modelValue', false);
    await flushPromises();
    expect(channels().exists()).toBe(true);
    emitSettingsDialog('closed');
    await flushPromises();
    expect(channels().exists()).toBe(false);
    // Reopening the dialog for a plain new division stays without the picker.
    await harness.findButton('New division').trigger('click');
    await flushPromises();
    expect(channels().exists()).toBe(false);
  } finally {
    await harness.dispose();
  }
});
