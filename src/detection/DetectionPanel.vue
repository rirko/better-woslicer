<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { BAND_NAMES, type BandName } from '../core/bands';
import { useWorkspace } from '../workspace/workspace';

const { t } = useI18n();
const workspace = useWorkspace();
const editor = workspace.editor;
const threshold = computed({ get: () => editor.bandThresholdDb, set: (value: number | undefined) => { if (value !== undefined && Number.isFinite(value) && value >= 0 && value <= 120) editor.bandThresholdDb = value; } });
const selectedBands = computed({ get: () => BAND_NAMES.filter(band => editor.bandDetectBands[band]), set: (bands: BandName[]) => { editor.bandDetectBands = { low: bands.includes('low'), mid: bands.includes('mid'), high: bands.includes('high') }; } });
const bandLabels = { low: 'chrome.bandLow', mid: 'chrome.bandMid', high: 'chrome.bandHigh' };
const range = computed(() => editor.selectionStartTick === null || editor.selectionEndTick === null ? null : `${Math.min(editor.selectionStartTick, editor.selectionEndTick)}–${Math.max(editor.selectionStartTick, editor.selectionEndTick)}`);
watch(() => [editor.bandsVisible, editor.source], () => { if (editor.bandsVisible && editor.source) void workspace.ensureBands(); });
</script>

<template>
  <section class="detection-panel" :aria-label="t('chrome.bandDetect')" data-testid="detection-panel">
    <el-checkbox v-model="editor.bandsVisible">{{ t('chrome.bands') }}</el-checkbox>
    <el-checkbox v-model="editor.rmsVisible">{{ t('chrome.titleRms') }}</el-checkbox>
    <el-form label-position="top" size="small">
      <el-form-item :label="t('chrome.bandDetect')">
        <el-checkbox-group v-model="selectedBands">
          <el-checkbox v-for="band in BAND_NAMES" :key="band" :value="band">{{ t(bandLabels[band]) }}</el-checkbox>
        </el-checkbox-group>
      </el-form-item>
      <el-form-item :label="t('chrome.riseLabel')">
        <el-input-number v-model="threshold" :min="0" :max="120" :step="1" :aria-label="t('chrome.riseLabel')" />
      </el-form-item>
      <el-form-item :label="t('chrome.minGapLabel')">
        <el-select v-model="editor.bandMinGapUnits" :aria-label="t('chrome.minGapLabel')">
          <el-option v-for="n in [1, 2, 4, 8]" :key="n" :value="n" :label="t(`chrome.gap${n}Grid`)" />
        </el-select>
      </el-form-item>
      <el-checkbox v-model="editor.bandSnap">{{ t('chrome.bandSnapLabel') }}</el-checkbox>
      <p class="scope">{{ range ? `${t('status.bandDetectInSelection')}: ${range}` : t('chrome.bandScopeWhole') }}</p>
      <el-button type="primary" :loading="editor.bandBusy" :disabled="!editor.source || !selectedBands.length" @click="workspace.detect()">{{ t(editor.bandBusy ? 'chrome.detecting' : 'chrome.detect') }}</el-button>
      <el-button :disabled="!editor.source || editor.bandBusy" @click="workspace.edgeDetect()">{{ t('chrome.edgeDetect') }}</el-button>
    </el-form>
  </section>
</template>

<style scoped>
.detection-panel { display: grid; gap: 8px; padding: 12px; }
.scope { color: var(--el-text-color-secondary); font-size: 12px; }
</style>
