import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, disposePinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';
import BMHelperPanel from '../../src/bmhelper/BMHelperPanel.vue';
import { useBmhelperStore } from '../../src/bmhelper/store';
import { useEditorStore } from '../../src/slicing/editor-store';
import { createWorkspace, workspaceKey } from '../../src/workspace/workspace';
import { setupI18n } from '../../src/i18n/setup';
import type { Platform } from '../../src/platform/contracts';
import { cutPositionsClipboard, defaultDivisionSetting } from '../../src/core/bmhelper';
import { writeSmfSequence } from '../../src/core/smf';

it('emits current BPM with 48-per-beat cuts and uses platform clipboard and save actions', async () => {
  const pinia = createPinia();
  const translation = setupI18n(pinia, { storage: null, locales: ['en'] });
  const platform: Platform = {
    kind: 'browser', openFile: vi.fn(async () => null), reopenFile: vi.fn(async () => { throw new Error('unused'); }),
    saveFile: vi.fn(async () => true), exportFiles: vi.fn(async () => null), readClipboard: vi.fn(async () => ''), writeClipboard: vi.fn(async () => {}),
    readSession: vi.fn(async () => null), writeSession: vi.fn(async () => {}), clearSession: vi.fn(async () => {}),
    importLegacySession: vi.fn(async () => null),
    setTheme: vi.fn(async () => {}),
  };
  const editor = useEditorStore(pinia);
  const workspace = createWorkspace({ platform, editor });
  const store = useBmhelperStore(pinia);
  const midi = writeSmfSequence({ quantize: 480, notes: [{ position: 0, gate: 120, nn: 60, vel: 100 }], controls: [], pitches: [] });
  const track = store.inspectMidi(midi).tracks.find(value => value.noteCount > 0)?.index ?? 0;
  store.importMidi(midi, 'sample.mid', track, new Set([0]));
  store.addDivision(defaultDivisionSetting('recording', 480));
  const wrapper = mount(BMHelperPanel, { props: { bpm: 175 }, global: { plugins: [pinia, translation.i18n], provide: { [workspaceKey as symbol]: workspace }, stubs: { PianoRoll: true, ElDialog: true } } });
  try {
    const button = (text: string) => {
      const found = wrapper.findAll('button').find(value => value.text() === text);
      if (!found) throw new Error(`Missing button: ${text}`);
      return found;
    };
    await button('Apply cuts to the timeline').trigger('click');
    expect(wrapper.emitted('applyCuts')).toEqual([[{ bpm: 175, ticks: [0] }]]);
    await button('Copy cut positions').trigger('click'); await flushPromises();
    expect(platform.writeClipboard).toHaveBeenCalledWith(store.selectedDivision ? cutPositionsClipboard(store.selectedDivision) : '');
    await button('Save project').trigger('click'); await flushPromises();
    expect(platform.saveFile).toHaveBeenCalledWith('bmh', 'sample.bmh', expect.any(Uint8Array));
    expect(store.dirty).toBe(false);
    await button('Export recording MIDI').trigger('click'); await flushPromises();
    expect(platform.saveFile).toHaveBeenCalledWith('midi', 'recording.mid', expect.any(Uint8Array));
  } finally { wrapper.unmount(); await workspace.dispose(); translation.stop(); disposePinia(pinia); }
});
