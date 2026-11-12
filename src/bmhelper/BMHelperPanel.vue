<script setup lang="ts">
import { computed, reactive, ref, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ElAlert,
  ElButton,
  ElCheckbox,
  ElCheckboxGroup,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElOption,
  ElSelect,
} from 'element-plus';
import type { OpenedFile } from '../platform/contracts';
import { useWorkspace } from '../workspace/workspace';
import {
  bmsSequenceClipboard,
  cutPositionsClipboard,
  defaultDivisionSetting,
  wavDefinitionText,
  zzToString,
  type SortType,
} from '../core/bmhelper';
import type { SmfTrackInfo } from '../core/smf';
import { useBmhelperStore } from './store';
import PianoRoll from './PianoRoll.vue';

const props = withDefaults(defineProps<{ bpm?: number }>(), { bpm: 120 });
const emit = defineEmits<{ applyCuts: [value: { bpm: number; ticks: number[] }] }>();
const { t } = useI18n();
const store = useBmhelperStore();
// The workspace service is injected once by the app shell and stays stable
// across panel remounts, so in-flight dialog actions keep one platform identity.
const platform = useWorkspace().platform;
const busy = ref(false);
const error = ref('');
const settingsOpen = ref(false);
const definitionsOpen = ref(false);
const pending = shallowRef<OpenedFile | null>(null);
const tracks = ref<SmfTrackInfo[]>([]);
const track = ref(0);
const channels = ref<number[]>(Array.from({ length: 16 }, (_, index) => index));
const filename = ref('');
const startNumber = ref('01');
const settings = reactive({
  name: '',
  srcCopy: false,
  headMargin: 0,
  minInterval: 1,
  sortType: 'nn_gate_vel' as SortType,
  gateThreshold: 0.125,
  velocityThreshold: 5,
  zzDefinition: true,
  mlDefinition: true,
  startDefinition: '01',
  mlThreshold: 0.5,
});
const sorts: SortType[] = [
  'none',
  'nn_gate_vel',
  'nn_vel_gate',
  'gate_nn_vel',
  'gate_vel_nn',
  'vel_nn_gate',
  'vel_gate_nn',
];
const definitionText = computed(() =>
  store.selectedDivision ? wavDefinitionText(store.selectedDivision, filename.value) : '',
);
const numericSettings = [
  { field: 'headMargin', key: 'bmhHeadMargin', step: 0.125 },
  { field: 'minInterval', key: 'bmhMinInterval', step: 0.125 },
  { field: 'gateThreshold', key: 'bmhGateThreshold', step: 0.125 },
  { field: 'velocityThreshold', key: 'bmhVelThreshold', step: 1 },
  { field: 'mlThreshold', key: 'bmhMlThreshold', step: 0.125 },
] as const;
async function run(action: () => void | Promise<void>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (cause: unknown) {
    error.value = t('status.bmhOpenFailed', {
      message: cause instanceof Error ? cause.message : String(cause),
    });
  } finally {
    busy.value = false;
  }
}
function resetSettings(): void {
  const defaults = defaultDivisionSetting(
    `division ${(store.project?.divisions.length ?? 0) + 1}`,
    480,
  );
  Object.assign(settings, defaults, {
    headMargin: defaults.headMargin / 480,
    minInterval: defaults.minInterval / 480,
    gateThreshold: defaults.gateThreshold / 480,
    mlThreshold: defaults.mlThreshold / 480,
    startDefinition: zzToString(defaults.startDefinition),
  });
}
async function openMidi(): Promise<void> {
  await run(async () => {
    const file = await platform.openFile('midi');
    if (!file) return;
    const inspection = store.inspectMidi(file.bytes);
    pending.value = file;
    tracks.value = inspection.tracks;
    track.value = inspection.tracks.find((value) => value.noteCount > 0)?.index ?? 0;
    channels.value = Array.from({ length: 16 }, (_, index) => index);
    resetSettings();
    settingsOpen.value = true;
  });
}
function newDivision(): void {
  pending.value = null;
  resetSettings();
  settingsOpen.value = true;
}
function parseStart(value: string): number {
  if (!/^[0-9a-z]{1,2}$/i.test(value.trim())) throw new Error('invalid-start');
  return parseInt(value.trim(), 36);
}
async function create(): Promise<void> {
  await run(() => {
    const start = parseStart(settings.startDefinition);
    if (pending.value && !channels.value.length) throw new Error('no-notes');
    for (const { field } of numericSettings)
      if (!Number.isFinite(settings[field]) || settings[field] < 0)
        throw new Error('invalid-setting');
    if (pending.value)
      store.importMidi(
        pending.value.bytes,
        pending.value.name,
        track.value,
        new Set(channels.value),
      );
    const quantize = store.project?.source.quantize;
    if (!quantize) throw new Error('no-project');
    store.addDivision({
      ...settings,
      name: settings.name.trim() || 'division',
      startDefinition: start,
      headMargin: Math.trunc(settings.headMargin * quantize),
      minInterval: Math.trunc(settings.minInterval * quantize),
      gateThreshold: Math.trunc(settings.gateThreshold * quantize),
      mlThreshold: Math.trunc(settings.mlThreshold * quantize),
      velocityThreshold: Math.trunc(settings.velocityThreshold),
    });
    settingsOpen.value = false;
    pending.value = null;
  });
}
async function openProject(): Promise<void> {
  await run(async () => {
    const file = await platform.openFile('bmh');
    if (file) store.openProject(file.bytes, file.name);
  });
}
async function saveProject(): Promise<void> {
  await run(async () => {
    const saved = await store.saveBmhProject((bytes) =>
      platform.saveFile('bmh', `${store.name || 'project'}.bmh`, bytes),
    );
    if (!saved) store.dirty = true;
  });
}
async function exportMidi(): Promise<void> {
  await run(async () => {
    await platform.saveFile(
      'midi',
      `${store.selectedDivision?.name ?? 'recording'}.mid`,
      store.exportMidiBytes(),
    );
  });
}
async function copy(kind: 'cuts' | 'bms' | 'definitions'): Promise<void> {
  await run(async () => {
    const division = store.selectedDivision;
    const source = store.project?.source;
    if (!division || !source) return;
    await platform.writeClipboard(
      kind === 'cuts'
        ? cutPositionsClipboard(division)
        : kind === 'bms'
          ? bmsSequenceClipboard(division, source)
          : definitionText.value,
    );
  });
}
function showDefinitions(): void {
  filename.value = store.name;
  definitionsOpen.value = true;
}
</script>

<template>
  <section
    class="bmhelper"
    :aria-label="t('chrome.tabBmhelper')"
  >
    <div class="actions">
      <ElButton
        :disabled="busy"
        @click="openMidi"
        >{{ t('chrome.bmhOpen') }}</ElButton
      >
      <ElButton
        :disabled="busy"
        @click="openProject"
        >{{ t('chrome.bmhOpenProject') }}</ElButton
      >
      <ElButton
        :disabled="busy || !store.project"
        @click="saveProject"
        >{{ t('chrome.bmhSaveProject') }}</ElButton
      >
      <ElButton
        :disabled="busy || !store.project"
        @click="newDivision"
        >{{ t('chrome.bmhNewDivision') }}</ElButton
      >
    </div>
    <ElAlert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
      role="alert"
    />
    <template v-if="store.project">
      <p>
        {{ t('chrome.bmhSourceLabel') }}: {{ store.name }} · {{ store.project.source.notes.length }}
        <span v-if="store.dirty">*</span>
      </p>
      <div class="actions">
        <ElSelect
          :model-value="store.selectedIndex"
          :aria-label="t('chrome.bmhNameLabel')"
          @change="store.selectDivision"
        >
          <ElOption
            v-for="(division, index) in store.project.divisions"
            :key="index"
            :label="division.name"
            :value="index"
          />
        </ElSelect>
        <ElButton
          :disabled="!store.selectedDivision || busy"
          @click="store.deleteDivision()"
          >{{ t('chrome.bmhDelete') }}</ElButton
        >
      </div>
      <template v-if="store.selectedDivision">
        <PianoRoll
          :notes="store.selectedDivision.recording"
          :quantize="store.selectedDivision.quantize"
        />
        <div class="actions">
          <ElButton
            :disabled="busy"
            @click="exportMidi"
            >{{ t('chrome.bmhExportMidi') }}</ElButton
          >
          <ElButton
            :disabled="busy"
            @click="emit('applyCuts', { bpm: props.bpm, ticks: store.cutTicks() })"
            >{{ t('chrome.bmhApply') }}</ElButton
          >
          <ElButton
            :disabled="busy"
            @click="copy('cuts')"
            >{{ t('chrome.bmhCopyCuts') }}</ElButton
          >
          <ElButton
            :disabled="busy"
            @click="copy('bms')"
            >{{ t('chrome.bmhCopyBms') }}</ElButton
          >
          <ElButton @click="showDefinitions">{{ t('chrome.bmhCopyDefs') }}</ElButton>
        </div>
        <div class="actions">
          <ElButton
            aria-label="−1"
            @click="store.transpose(-1)"
            >−1</ElButton
          >
          <ElButton
            aria-label="+1"
            @click="store.transpose(1)"
            >+1</ElButton
          >
          <ElInput
            v-model="startNumber"
            maxlength="2"
            :aria-label="t('chrome.bmhStartNumber')"
            class="start-number"
          />
          <ElButton @click="run(() => store.setStart(parseStart(startNumber)))">{{
            t('chrome.bmhStartNumber')
          }}</ElButton>
          <span class="definitions">{{
            store.selectedDivision.definitions.map((def) => zzToString(def.zz)).join(' · ')
          }}</span>
        </div>
      </template>
    </template>
    <ElDialog
      v-model="settingsOpen"
      :title="t('chrome.bmhNewDivision')"
      width="min(620px, 95vw)"
      :close-on-click-modal="false"
      append-to-body
      destroy-on-close
      @closed="pending = null"
    >
      <ElForm
        label-position="top"
        @submit.prevent="create"
      >
        <template v-if="pending">
          <ElFormItem label="MIDI"
            ><ElSelect v-model="track"
              ><ElOption
                v-for="item in tracks"
                :key="item.index"
                :value="item.index"
                :label="`${item.index + 1}: ${item.name} (${item.noteCount})`"
                :disabled="!item.noteCount" /></ElSelect
          ></ElFormItem>
          <ElCheckboxGroup
            v-model="channels"
            aria-label="MIDI channels"
            ><ElCheckbox
              v-for="channel in 16"
              :key="channel"
              :value="channel - 1"
              >{{ channel }}</ElCheckbox
            ></ElCheckboxGroup
          >
        </template>
        <ElFormItem :label="t('chrome.bmhNameLabel')"
          ><ElInput v-model="settings.name"
        /></ElFormItem>
        <ElCheckbox v-model="settings.srcCopy">{{ t('chrome.bmhSrcCopy') }}</ElCheckbox>
        <div class="settings-grid">
          <ElFormItem
            v-for="item in numericSettings"
            :key="item.field"
            :label="t(`chrome.${item.key}`)"
            ><ElInputNumber
              v-model="settings[item.field]"
              :min="0"
              :step="item.step"
          /></ElFormItem>
          <ElFormItem :label="t('chrome.bmhSortLabel')"
            ><ElSelect v-model="settings.sortType"
              ><ElOption
                v-for="sort in sorts"
                :key="sort"
                :value="sort"
                :label="sort === 'none' ? t('chrome.bmhSortNone') : sort" /></ElSelect
          ></ElFormItem>
          <ElFormItem :label="t('chrome.bmhStartDefinitionLabel')"
            ><ElInput
              v-model="settings.startDefinition"
              maxlength="2"
          /></ElFormItem>
        </div>
        <ElCheckbox v-model="settings.zzDefinition">{{ t('chrome.bmhZzDefinition') }}</ElCheckbox>
        <ElCheckbox v-model="settings.mlDefinition">{{ t('chrome.bmhMlDefinition') }}</ElCheckbox>
        <ElAlert
          v-if="error"
          :title="error"
          type="error"
          :closable="false"
        />
      </ElForm>
      <template #footer
        ><ElButton @click="settingsOpen = false">{{ t('chrome.closeCancel') }}</ElButton
        ><ElButton
          type="primary"
          :loading="busy"
          @click="create"
          >{{ t('chrome.bmhOk') }}</ElButton
        ></template
      >
    </ElDialog>
    <ElDialog
      v-model="definitionsOpen"
      :title="t('chrome.bmhDefsTitle')"
      width="min(620px, 95vw)"
      append-to-body
    >
      <ElFormItem :label="t('chrome.bmhFileNameLabel')"><ElInput v-model="filename" /></ElFormItem>
      <ElInput
        :model-value="definitionText"
        type="textarea"
        :rows="12"
        readonly
      />
      <template #footer
        ><ElButton @click="definitionsOpen = false">{{ t('chrome.close') }}</ElButton
        ><ElButton
          :loading="busy"
          @click="copy('definitions')"
          >{{ t('chrome.copy') }}</ElButton
        ></template
      >
    </ElDialog>
  </section>
</template>
<style scoped>
.bmhelper {
  display: grid;
  gap: 12px;
  padding: 12px;
  min-width: 0;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.actions :deep(.el-select) {
  width: 240px;
}
.start-number {
  width: 72px;
}
.definitions {
  overflow-wrap: anywhere;
  font-family: monospace;
}
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
</style>
