import { wavBytesDepth, writeWavHeader } from '../fixtures';
import { flushPromises, mount } from '@vue/test-utils';
import { expect, it, vi } from 'vitest';
import { setupI18n } from '../../src/i18n/setup';
import { fixture, audioFile } from '../app/workspace-fixture';
import { workspaceKey } from '../../src/workspace/workspace';
import { encodeProject } from '../../src/project/codec';
import SourceInfo from '../../src/app/components/SourceInfo.vue';
import EditorToolbar from '../../src/app/components/EditorToolbar.vue';

it('shows missing media, relinks through the actual button, and displays the saved state', async () => {
  const f = fixture();
  const localization = setupI18n(f.pinia, { storage: null, locales: ['en'] });
  const global = {
    plugins: [f.pinia, localization.i18n],
    provide: { [workspaceKey]: f.workspace },
  };
  const source = mount(SourceInfo, { global });
  const toolbar = mount(EditorToolbar, { props: { calibrating: false }, global });
  try {
    await f.workspace.loadAudio(audioFile());
    await flushPromises();
    expect(toolbar.find('[aria-label="Unsaved changes"]').exists()).toBe(true);
    await f.workspace.saveProject();
    await flushPromises();
    expect(toolbar.find('[aria-label="Unsaved changes"]').exists()).toBe(false);
    f.opened = { name: 'saved.wosdx', reference: null, bytes: encodeProject(f.editor.document) };
    await f.workspace.openProject();
    await flushPromises();
    expect(source.text()).toContain('Audio unavailable: tone.wav');
    f.opened = audioFile();
    await source.get('button').trigger('click');
    await vi.waitFor(() => expect(f.editor.source).not.toBeNull());
    await flushPromises();
    expect(source.text()).toContain('48000 Hz');
    expect(source.text()).not.toContain('Audio unavailable');
    const save = toolbar.findAll('button').find((button) => button.text() === 'Save .wosdx...');
    if (!save) throw new Error('Missing project save button');
    await save.trigger('click');
    expect(toolbar.emitted('command')).toEqual([['save-project']]);
  } finally {
    source.unmount();
    toolbar.unmount();
    localization.stop();
    await f.dispose();
  }
});

function floatWav(): Uint8Array {
  const bytes = new Uint8Array(44 + 8);
  const view = new DataView(bytes.buffer);
  writeWavHeader(view, 8, 3, 1, 48000, 32);
  view.setFloat32(44, 0.5, true);
  view.setFloat32(48, -0.5, true);
  return bytes;
}

it.each([
  { bytes: wavBytesDepth([128, 255], 48000, 8), label: 'WAV PCM 8-bit' },
  { bytes: wavBytesDepth([0, 32767], 48000, 16), label: 'WAV PCM 16-bit' },
  { bytes: wavBytesDepth([0, 0x7fffff], 48000, 24), label: 'WAV PCM 24-bit' },
  { bytes: wavBytesDepth([0, 0x7fffffff], 48000, 32), label: 'WAV PCM 32-bit' },
  { bytes: floatWav(), label: 'WAV Float 32-bit' },
])(
  'shows the decoded source format separately from processing/output: $label',
  async ({ bytes, label }) => {
    const f = fixture();
    const localization = setupI18n(f.pinia, { storage: null, locales: ['en'] });
    const wrapper = mount(SourceInfo, {
      global: {
        plugins: [f.pinia, localization.i18n],
        provide: { [workspaceKey]: f.workspace },
      },
    });
    try {
      await f.workspace.loadAudio({ name: 'source.wav', bytes, reference: null });
      await flushPromises();
      const rows = wrapper.findAll('tr');
      expect(rows.find((row) => row.text().includes('Source format'))?.text()).toContain(label);
      expect(rows.find((row) => row.text().includes('Processing / output'))?.text()).toContain(
        'PCM 16-bit',
      );
      expect(f.editor.source?.data[0]).toBeInstanceOf(Int16Array);
    } finally {
      wrapper.unmount();
      localization.stop();
      await f.dispose();
    }
  },
);
