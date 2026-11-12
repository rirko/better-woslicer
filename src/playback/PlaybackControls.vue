<script setup lang="ts">
import { computed } from 'vue';
import { ElButton, ElCheckbox, ElOption, ElSelect, ElSlider } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { useEditorStore, type CueMode } from '../slicing/editor-store';
import { PLAYBACK_RATES, formatRate } from '../core/rate';
import { ampToDb, dbToAmp, dbToSlider, sliderToDb } from '../core/volume';
import { usePlayback } from './index';
import { useSliderDraft } from './use-slider-draft';

const editor = useEditorStore();
const playback = usePlayback();
const { t } = useI18n();
// Transport controls stay disabled until an audio source is loaded.
const disabled = computed(() => !editor.source || editor.phase.kind === 'loading');
// The store keeps linear amplitudes; sliders show a 0..100 position over a -60..0 dB fader.
const volume = computed(() => dbToSlider(ampToDb(editor.volume)));
const cueVolume = computed(() => dbToSlider(ampToDb(editor.cueVolume)));
// ElSlider re-emits the stale modelValue with its change event under a one-way
// binding, so drags are tracked locally and committed once on release.
// The shared draft helper manages slider positions only; dB/amp conversion
// stays here, and each call below keeps an independent draft per slider.
const {
  displayValue: volumeDisplay,
  onUpdate: onVolumeUpdate,
  commit: commitVolume,
} = useSliderDraft(
  () => volume.value,
  (position) => {
    editor.setVolume(dbToAmp(sliderToDb(position)));
  },
);
const {
  displayValue: cueDisplay,
  onUpdate: onCueVolumeUpdate,
  commit: commitCueVolume,
} = useSliderDraft(
  () => cueVolume.value,
  (position) => {
    editor.setCueVolume(dbToAmp(sliderToDb(position)));
  },
);
// Cue monitor modes offered by the select.
const cues: { value: CueMode; label: string }[] = [
  { value: 'off', label: 'chrome.cueOff' },
  { value: 'cowbell', label: 'chrome.cueCowbell' },
  { value: 'triangle', label: 'chrome.cueTriangle' },
  { value: 'metronome', label: 'chrome.cueMetronome' },
];
// Select payloads are narrowed before they reach playback or the store.
function setRate(value: unknown): void {
  if (typeof value === 'number') playback.setRate(value);
}
function setCue(value: unknown): void {
  if (value === 'off' || value === 'cowbell' || value === 'triangle' || value === 'metronome')
    editor.cueMode = value;
}
// Slider tooltip: the dB fader value for the hovered position.
const formatVolume = (position: number) => `${sliderToDb(position).toFixed(1)} dB`;
</script>

<template>
  <div
    class="playback-controls"
    role="group"
    :aria-label="t('chrome.titlePlay')"
  >
    <!-- transport: play/pause and stop -->
    <ElButton
      :disabled="disabled"
      :type="editor.playing ? 'primary' : 'default'"
      :aria-pressed="editor.playing"
      :title="t('chrome.titlePlay')"
      @click="playback.togglePlayPause()"
      >{{ t('chrome.play') }}</ElButton
    >
    <ElButton
      :disabled="disabled"
      @click="playback.stop()"
      >{{ t('chrome.stop') }}</ElButton
    >
    <!-- master volume: drag drafts locally, commits once on release -->
    <ElSlider
      class="volume-slider"
      :model-value="volumeDisplay"
      :format-tooltip="formatVolume"
      :aria-label="t('chrome.titleVolume')"
      :title="t('chrome.titleVolume')"
      @update:model-value="onVolumeUpdate"
      @change="commitVolume"
    />
    <!-- playback rate select (monitoring only) -->
    <label class="control-label"
      >{{ t('chrome.rateLabel') }}
      <ElSelect
        class="rate-select"
        :model-value="editor.playbackRate"
        :aria-label="t('chrome.titleRate')"
        @update:model-value="setRate"
      >
        <ElOption
          v-for="rate in PLAYBACK_RATES"
          :key="rate"
          :value="rate"
          :label="formatRate(rate)"
        />
      </ElSelect>
    </label>
    <!-- cue monitor mode select -->
    <label class="control-label"
      >{{ t('chrome.cueLabel') }}
      <ElSelect
        class="cue-select"
        :model-value="editor.cueMode"
        :aria-label="t('chrome.cueLabel')"
        @update:model-value="setCue"
      >
        <ElOption
          v-for="cue in cues"
          :key="cue.value"
          :value="cue.value"
          :label="t(cue.label)"
        />
      </ElSelect>
    </label>
    <!-- cue volume: same draft protocol as the master slider, independent draft -->
    <ElSlider
      class="volume-slider"
      :model-value="cueDisplay"
      :format-tooltip="formatVolume"
      :aria-label="t('chrome.titleCueVolume')"
      :title="t('chrome.titleCueVolume')"
      @update:model-value="onCueVolumeUpdate"
      @change="commitCueVolume"
    />
    <!-- follow playhead toggle (session preference on the editor store) -->
    <ElCheckbox
      v-model="editor.followPlayhead"
      :title="t('chrome.titleFollow')"
      >{{ t('chrome.follow') }}</ElCheckbox
    >
  </div>
</template>

<style scoped>
/* Playback strip: one wrapping row of transport, sliders and selects. */
.playback-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}

/* Override Element Plus adjacent-button margin inside the strip. */
.playback-controls :deep(.el-button + .el-button) {
  margin-left: 0;
}

/* Volume sliders share one fixed width between transport and selects. */
.volume-slider {
  width: 90px;
  flex: 0 0 90px;
  margin: 0 6px;
}

/* Inline label wrapping each select. */
.control-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

/* Fixed widths keep the strip layout stable while wrapping. */
.rate-select {
  width: 90px;
}
.cue-select {
  width: 120px;
}
</style>
