import { afterEach, describe, expect, it } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import ElementPlus, { ElCheckbox, ElInput, ElInputNumber } from 'element-plus';
import { createI18n } from 'vue-i18n';
import en from '../../src/i18n/en.json';
import MarkerList from '../../src/slicing/MarkerList.vue';
import OutputPanel from '../../src/export/OutputPanel.vue';
import DetectionPanel from '../../src/detection/DetectionPanel.vue';
import { workspaceKey } from '../../src/workspace/workspace';
import { fixture, audioFile } from '../app/workspace-fixture';

const fixtures: ReturnType<typeof fixture>[] = [];
const wrappers: VueWrapper[] = [];
function setup() {
  const f = fixture();
  fixtures.push(f);
  const options = {
    global: {
      plugins: [
        f.pinia,
        ElementPlus,
        createI18n({ legacy: false, locale: 'en', messages: { en } }),
      ],
      provide: { [workspaceKey]: f.workspace },
    },
  };
  return { f, options };
}
afterEach(async () => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  for (const f of fixtures.splice(0)) await f.dispose();
});

describe('editor panels with real Element Plus controls', () => {
  it('routes output controls through undoable document edits and reflects undo in the form', async () => {
    const { f, options } = setup();
    const wrapper = mount(OutputPanel, options);
    wrappers.push(wrapper);
    const input = wrapper.getComponent(ElInput);
    input.vm.$emit('update:modelValue', 'custom');
    await flushPromises();
    expect(f.editor.document.output.baseName).toBe('custom');
    f.workspace.actions.undo();
    await flushPromises();
    expect(input.props('modelValue')).toBe('slice');
    f.workspace.actions.redo();
    await flushPromises();
    expect(input.props('modelValue')).toBe('custom');
    input.vm.$emit('update:modelValue', '');
    await flushPromises();
    expect(f.editor.baseName).toBe('');
    f.workspace.actions.undo();
    expect(f.editor.baseName).toBe('custom');
    const checks = wrapper.findAllComponents(ElCheckbox);
    checks[0].vm.$emit('update:modelValue', false);
    await flushPromises();
    expect(f.editor.noisegateEnabled).toBe(false);
    f.workspace.actions.undo();
    await flushPromises();
    expect(checks[0].props('modelValue')).toBe(true);
    checks[1].vm.$emit('update:modelValue', true);
    await flushPromises();
    expect(f.editor.useFfNumbering).toBe(true);
    f.workspace.actions.undo();
    expect(f.editor.useFfNumbering).toBe(false);
    const numbers = wrapper.findAllComponents(ElInputNumber);
    numbers[2].vm.$emit('update:modelValue', 17);
    await flushPromises();
    expect(f.editor.clipStartNumber).toBe(17);
    f.workspace.actions.undo();
    expect(f.editor.clipStartNumber).toBe(1);
  });
  it('virtualizes large cut lists and selects a clicked cut', async () => {
    const { f, options } = setup();
    f.editor.addTicks(Array.from({ length: 10000 }, (_, i) => i));
    const wrapper = mount(MarkerList, options);
    wrappers.push(wrapper);
    expect(wrapper.findAll('.marker-row').length).toBeLessThanOrEqual(22);
    await wrapper.findAll('.marker-row')[5].trigger('click');
    expect(f.editor.cursorTick).toBe(5);
    expect(f.editor.selectedTicks).toEqual([5]);
    await wrapper.findAll('.marker-row')[7].trigger('click', { ctrlKey: true });
    expect(f.editor.selectedTicks).toEqual([5, 7]);
    f.workspace.actions.clearMarkers();
    await flushPromises();
    expect(wrapper.findAll('.marker-row')).toHaveLength(0);
  });
  it('toggles cuts with ctrl and meta, freezes the playhead while playing, and numbers measures at 192 ticks', async () => {
    const { f, options } = setup();
    f.editor.setSource({
      name: 'example',
      reference: null,
      sampleRate: 48000,
      channels: 1,
      length: 48000,
      data: [new Int16Array(48000)],
      floatData: [new Float32Array(48000)],
    });
    f.editor.addTicks([191, 192, 383]);
    const wrapper = mount(MarkerList, options);
    wrappers.push(wrapper);
    const rows = wrapper.findAll('.marker-row');
    // Tick 191 closes measure 1; tick 192 opens measure 2.
    expect(rows[0].text()).toContain('M1');
    expect(rows[0].text()).toContain('191');
    expect(rows[1].text()).toContain('M2');
    // Plain click replaces; Ctrl adds; Meta removes the already-selected tick.
    await rows[0].trigger('click');
    expect(f.editor.selectedTicks).toEqual([191]);
    await rows[1].trigger('click', { ctrlKey: true });
    expect(f.editor.selectedTicks).toEqual([191, 192]);
    await rows[1].trigger('click', { metaKey: true });
    expect(f.editor.selectedTicks).toEqual([191]);
    // The playhead only follows clicks while playback is stopped.
    f.editor.setPlaying(true);
    f.editor.setPlayheadSample(12345);
    await rows[2].trigger('click');
    expect(f.editor.cursorTick).toBe(383);
    expect(f.editor.playheadSample).toBe(12345);
    f.editor.setPlaying(false);
    await rows[2].trigger('click');
    expect(f.editor.playheadSample).not.toBe(12345);
  });
  it('disables export without audio and exports real WAV bytes through its button', async () => {
    const { f, options } = setup();
    const wrapper = mount(OutputPanel, options);
    wrappers.push(wrapper);
    const button = wrapper.findAll('button').find((item) => item.text() === 'Export');
    if (!button) throw new Error('Missing export button');
    expect(button.attributes('disabled')).toBeDefined();
    await f.workspace.loadAudio(audioFile());
    f.workspace.actions.setMarker(0);
    await flushPromises();
    expect(button.attributes('disabled')).toBeUndefined();
    await button.trigger('click');
    await flushPromises();
    expect(f.exported).toHaveLength(1);
    expect(new TextDecoder().decode(f.exported[0].bytes.slice(0, 4))).toBe('RIFF');
  });
  it('keeps detection disabled without a source and performs real band analysis after load', async () => {
    const { f, options } = setup();
    const wrapper = mount(DetectionPanel, options);
    wrappers.push(wrapper);
    const button = wrapper.findAll('button').find((item) => item.text() === 'Detect');
    if (!button) throw new Error('Missing detect button');
    expect(button.attributes('disabled')).toBeDefined();
    await f.workspace.loadAudio(audioFile('short.wav', 4800));
    await flushPromises();
    expect(button.attributes('disabled')).toBeUndefined();
    await button.trigger('click');
    await flushPromises();
    expect(f.editor.bandAnalysis).not.toBeNull();
    expect(f.editor.bandBusy).toBe(false);
    expect(f.editor.bandEstimate).not.toBeNull();
  });
});
