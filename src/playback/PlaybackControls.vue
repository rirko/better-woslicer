<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElButton, ElCheckbox, ElOption, ElSelect, ElSlider } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { useEditorStore, type CueMode } from '../slicing/editor-store';
import { PLAYBACK_RATES, formatRate } from '../core/rate';
import { ampToDb, dbToAmp, dbToSlider, sliderToDb } from '../core/volume';
import { usePlayback } from './index';

const editor = useEditorStore();
const playback = usePlayback();
const { t } = useI18n();
const disabled = computed(() => !editor.source || editor.phase.kind === 'loading');
const volume = computed(() => dbToSlider(ampToDb(editor.volume)));
const cueVolume = computed(() => dbToSlider(ampToDb(editor.cueVolume)));
// ElSlider re-emits the stale modelValue with its change event under a one-way
// binding, so drags are tracked locally and committed once on release.
const volumeDrag = ref<number | null>(null);
const cueDrag = ref<number | null>(null);
const cues: { value: CueMode; label: string }[] = [
  { value: 'off', label: 'chrome.cueOff' }, { value: 'cowbell', label: 'chrome.cueCowbell' },
  { value: 'triangle', label: 'chrome.cueTriangle' }, { value: 'metronome', label: 'chrome.cueMetronome' },
];
function onVolumeUpdate(value: number | number[]): void { if (typeof value === 'number') volumeDrag.value = value; }
function onCueVolumeUpdate(value: number | number[]): void { if (typeof value === 'number') cueDrag.value = value; }
function commitVolume(): void {
  const target = volumeDrag.value ?? volume.value;
  volumeDrag.value = null;
  editor.setVolume(dbToAmp(sliderToDb(target)));
}
function commitCueVolume(): void {
  const target = cueDrag.value ?? cueVolume.value;
  cueDrag.value = null;
  editor.setCueVolume(dbToAmp(sliderToDb(target)));
}
function setRate(value: unknown): void { if (typeof value === 'number') playback.setRate(value); }
function setCue(value: unknown): void {
  if (value === 'off' || value === 'cowbell' || value === 'triangle' || value === 'metronome') editor.cueMode = value;
}
const formatVolume = (position: number) => `${sliderToDb(position).toFixed(1)} dB`;
</script>

<template>
  <div class="playback-controls" role="group" :aria-label="t('chrome.titlePlay')">
    <ElButton :disabled="disabled" :type="editor.playing ? 'primary' : 'default'" :aria-pressed="editor.playing" :title="t('chrome.titlePlay')" @click="playback.togglePlayPause()">{{ t('chrome.play') }}</ElButton>
    <ElButton :disabled="disabled" @click="playback.stop()">{{ t('chrome.stop') }}</ElButton>
    <ElSlider class="volume-slider" :model-value="volumeDrag ?? volume" :format-tooltip="formatVolume" :aria-label="t('chrome.titleVolume')" :title="t('chrome.titleVolume')" @update:model-value="onVolumeUpdate" @change="commitVolume" />
    <label class="control-label">{{ t('chrome.rateLabel') }}
      <ElSelect class="rate-select" :model-value="editor.playbackRate" :aria-label="t('chrome.titleRate')" @update:model-value="setRate">
        <ElOption v-for="rate in PLAYBACK_RATES" :key="rate" :value="rate" :label="formatRate(rate)" />
      </ElSelect>
    </label>
    <label class="control-label">{{ t('chrome.cueLabel') }}
      <ElSelect class="cue-select" :model-value="editor.cueMode" :aria-label="t('chrome.cueLabel')" @update:model-value="setCue">
        <ElOption v-for="cue in cues" :key="cue.value" :value="cue.value" :label="t(cue.label)" />
      </ElSelect>
    </label>
    <ElSlider class="volume-slider" :model-value="cueDrag ?? cueVolume" :format-tooltip="formatVolume" :aria-label="t('chrome.titleCueVolume')" :title="t('chrome.titleCueVolume')" @update:model-value="onCueVolumeUpdate" @change="commitCueVolume" />
    <ElCheckbox v-model="editor.followPlayhead" :title="t('chrome.titleFollow')">{{ t('chrome.follow') }}</ElCheckbox>
  </div>
</template>

<style scoped>
.playback-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; min-width: 0; }
.playback-controls :deep(.el-button + .el-button) { margin-left: 0; }
.volume-slider { width: 90px; flex: 0 0 90px; margin: 0 6px; }
.control-label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
.rate-select { width: 90px; }
.cue-select { width: 120px; }
</style>
