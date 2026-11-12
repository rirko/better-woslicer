import { mount } from '@vue/test-utils';
import { createPinia, disposePinia } from 'pinia';
import { nextTick } from 'vue';
import { ElInputNumber, ElSelect, ElOption, ElTabs } from 'element-plus';
import { describe, expect, it, vi } from 'vitest';
import DocumentOptions from '../../src/app/components/DocumentOptions.vue';
import EditorToolbar from '../../src/app/components/EditorToolbar.vue';
import WorkspacePanels from '../../src/app/components/WorkspacePanels.vue';
import AboutDialog from '../../src/app/components/AboutDialog.vue';
import ApplicationMenu from '../../src/app/components/ApplicationMenu.vue';
import { createApplicationMenu } from '../../src/app/menu';
import { setupI18n } from '../../src/i18n/setup';
import { useEditorStore } from '../../src/slicing/editor-store';
import { useBmhelperStore } from '../../src/bmhelper/store';
import { useUiPreferencesStore } from '../../src/ui/preferences';
import { GRID_DENSITIES } from '../../src/core/gridlines';
import { MAX_TICKS } from '../../src/core/timebase';
import { type Platform } from '../../src/platform/contracts';
import { APP_COMMANDS, isMenuCommand } from '../../src/app/command-types';
import BMHelperPanel from '../../src/bmhelper/BMHelperPanel.vue';

function setup() {
  const pinia = createPinia();
  const localization = setupI18n(pinia, { storage: null, locales: ['en'] });
  const editor = useEditorStore(pinia);
  return {
    pinia,
    localization,
    editor,
    global: { plugins: [pinia, localization.i18n] },
    dispose() {
      localization.stop();
      disposePinia(pinia);
    },
  };
}
const source = {
  name: 'example',
  reference: null,
  sampleRate: 48000,
  channels: 1,
  length: 48000,
  data: [new Int16Array(48000)],
  floatData: [new Float32Array(48000)],
};

describe('application controls', () => {
  it('commits document fields through validation and exposes every canonical grid density', async () => {
    const instance = setup();
    const wrapper = mount(DocumentOptions, { global: instance.global });
    try {
      const numbers = wrapper.findAllComponents(ElInputNumber);
      const oldBpm = instance.editor.doc.bpm;
      const revision = instance.editor.docRevision;
      numbers[0].vm.$emit('update:modelValue', Number.NaN);
      await nextTick();
      expect(instance.editor.doc.bpm).toBe(oldBpm);
      numbers[0].vm.$emit('update:modelValue', 175);
      await nextTick();
      expect(instance.editor.doc.bpm).toBe(175);
      expect(instance.editor.docRevision).toBeGreaterThan(revision);
      numbers[2].vm.$emit('update:modelValue', -1);
      await nextTick();
      expect(instance.editor.doc.fadeoutMs).toBeGreaterThanOrEqual(0);
      expect(wrapper.findAllComponents(ElOption).map((option) => option.props('value'))).toEqual(
        GRID_DENSITIES,
      );
      wrapper.findComponent(ElSelect).vm.$emit('update:modelValue', 12);
      await nextTick();
      expect(instance.editor.grid).toBe(12);
      wrapper.findComponent(ElSelect).vm.$emit('update:modelValue', 3);
      await nextTick();
      expect(instance.editor.grid).toBe(12);
      instance.editor.setDocumentOptions({ bpm: 140 });
      await nextTick();
      expect(numbers[0].props('modelValue')).toBe(140);
    } finally {
      wrapper.unmount();
      instance.dispose();
    }
  });
  it('keeps legacy WOS import/export visible without audio and provides calibration when media exists', async () => {
    const instance = setup();
    const wrapper = mount(EditorToolbar, {
      props: { calibrating: false },
      global: instance.global,
    });
    try {
      const button = (label: string) => {
        const found = wrapper.findAll('button').find((item) => item.text() === label);
        if (!found) throw new Error(`missing ${label}`);
        return found;
      };
      expect(button('Import .wos settings...').attributes('disabled')).toBeUndefined();
      expect(button('Export .wos...').attributes('disabled')).toBeUndefined();
      await button('Import .wos settings...').trigger('click');
      expect(wrapper.emitted('command')).toEqual([['import-wos']]);
      expect(button('Calibrate').attributes('disabled')).toBeDefined();
      instance.editor.setSource(source);
      await nextTick();
      await button('Calibrate').trigger('click');
      expect(wrapper.emitted('calibrate')).toHaveLength(1);
    } finally {
      wrapper.unmount();
      instance.dispose();
    }
  });
  it('renders the application menu in every locale and keeps its commands inside the app command set', async () => {
    const instance = setup();
    const wrapper = mount(ApplicationMenu, { global: instance.global });
    try {
      const groups = createApplicationMenu(instance.editor);
      const menuCommands = groups.flatMap((group) => group.commands.map((item) => item.id));
      expect(new Set(menuCommands).size).toBe(menuCommands.length);
      expect(menuCommands.every(isMenuCommand)).toBe(true);
      expect(menuCommands.every((command) => APP_COMMANDS.includes(command))).toBe(true);
      expect(wrapper.find('[role="menubar"]').exists()).toBe(true);
      const translate = instance.localization.i18n.global.t;
      for (const language of ['en', 'zh', 'ja', 'ko']) {
        useUiPreferencesStore(instance.pinia).setLanguage(language);
        await nextTick();
        for (const group of groups) {
          // Group buttons render immediately; dropdown items mount on open, so their
          // labels are verified through the same translator the component uses.
          expect(wrapper.text()).toContain(translate(group.label));
          for (const item of group.commands)
            expect(translate(item.key)).not.toMatch(/^(menu|chrome)\./);
        }
      }
    } finally {
      wrapper.unmount();
      instance.dispose();
    }
  });
  it('keeps limited projects saving while disabling editing and media menu entries', () => {
    const instance = setup();
    try {
      const groups = createApplicationMenu(instance.editor);
      const find = (id: string) =>
        groups.flatMap((group) => group.commands).find((item) => item.id === id);
      if (!find) throw new Error('Missing menu items');
      instance.editor.setTicks([24]);
      expect(find('open-audio')?.enabled()).toBe(true);
      expect(find('clear-markers')?.enabled()).toBe(true);
      instance.editor.setLimited(true);
      expect(find('open-audio')?.enabled()).toBe(false);
      expect(find('import-wos')?.enabled()).toBe(false);
      expect(find('export-wos')?.enabled()).toBe(false);
      expect(find('clear-markers')?.enabled()).toBe(false);
      expect(find('select-cut')?.enabled()).toBe(false);
      expect(find('select-paste')?.enabled()).toBe(false);
      expect(find('save-project')?.enabled()).toBe(true);
      expect(find('open-project')?.enabled()).toBe(true);
      expect(find('about')?.enabled()).toBe(true);
      instance.editor.setLimited(false);
      expect(find('open-audio')?.enabled()).toBe(true);
    } finally {
      instance.dispose();
    }
  });
  it('filters BMHelper cuts with one undo entry and preserves BPM and project across tabs', async () => {
    const instance = setup();
    const platform = { kind: 'browser' } as Platform;
    const wrapper = mount(WorkspacePanels, {
      props: { platform },
      global: {
        ...instance.global,
        stubs: {
          BMHelperPanel: true,
          SourceInfo: true,
          MarkerList: true,
          DetectionPanel: true,
          OutputPanel: true,
        },
      },
    });
    try {
      instance.editor.setDocumentOptions({ bpm: 120 });
      instance.editor.setTicks([24]);
      instance.editor.setSource(source);
      wrapper.findComponent(ElTabs).vm.$emit('update:modelValue', 'bmhelper');
      await nextTick();
      wrapper
        .findComponent(BMHelperPanel)
        .vm.$emit('applyCuts', { bpm: 999, ticks: [-1, 0, 48, 1000, MAX_TICKS, 0.5] });
      await nextTick();
      expect(instance.editor.ticks).toEqual([0, 48]);
      expect(instance.editor.doc.bpm).toBe(120);
      expect(instance.editor.status.segments[0]).toMatchObject({
        key: 'bmhAppliedDropped',
        params: { count: 2, dropped: 4 },
      });
      instance.editor.undo();
      expect(instance.editor.ticks).toEqual([24]);
      const bmh = useBmhelperStore(instance.pinia);
      bmh.name = 'retained';
      wrapper.findComponent(ElTabs).vm.$emit('update:modelValue', 'source');
      await nextTick();
      wrapper.findComponent(ElTabs).vm.$emit('update:modelValue', 'bmhelper');
      await nextTick();
      expect(bmh.name).toBe('retained');
      bmh.reset();
      expect(bmh.name).toBe('');
      expect(bmh.project).toBeNull();
    } finally {
      wrapper.unmount();
      instance.dispose();
    }
  });
  it('shows the full bundled build identity in About', () => {
    const instance = setup();
    const wrapper = mount(AboutDialog, {
      props: {
        modelValue: true,
        identity: {
          name: 'woslicer-dx',
          version: '0.3.0',
          commit: '0123456789abcdef0123456789abcdef01234567',
          dirty: true,
          builtAt: '2026-01-01T00:00:00Z',
        },
      },
      global: {
        ...instance.global,
        stubs: { ElDialog: { template: '<div><slot /><slot name="footer" /></div>' } },
      },
    });
    try {
      expect(wrapper.text()).toContain('0123456789abcdef0123456789abcdef01234567');
      expect(wrapper.text()).toContain('2026-01-01T00:00:00Z');
      expect(wrapper.text()).toContain('modified working tree');
      expect(wrapper.text()).toContain('v0.3.0');
    } finally {
      wrapper.unmount();
      instance.dispose();
    }
  });
});
