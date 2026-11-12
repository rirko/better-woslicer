<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElTabPane, ElTabs } from 'element-plus';
import { useI18n } from 'vue-i18n';
import type { Platform } from '../../platform/contracts';
import { useEditorStore } from '../../slicing/editor-store';
import MarkerList from '../../slicing/MarkerList.vue';
import DetectionPanel from '../../detection/DetectionPanel.vue';
import OutputPanel from '../../export/OutputPanel.vue';
import BMHelperPanel from '../../bmhelper/BMHelperPanel.vue';
import SourceInfo from './SourceInfo.vue';
defineProps<{ platform: Platform }>();
const editor = useEditorStore();
const { t } = useI18n();
const activeTab = ref('source');
const bpm = computed(() => { void editor.docRevision; return editor.doc.bpm; });
function applyCuts(payload: { bpm: number; ticks: number[] }): void {
  const accepted = [...new Set(payload.ticks.filter(editor.legalTick))];
  const dropped = payload.ticks.filter(tick => !editor.legalTick(tick)).length;
  if (!accepted.length) { editor.setStatus('bmhNoDivision', true); return; }
  editor.setTicks(accepted);
  editor.setSelectedTicks([]); editor.setSelection(null, null);
  // MIDI has no reliable source tempo here. Preserve the current document BPM.
  editor.setStatus(dropped ? 'bmhAppliedDropped' : 'bmhApplied', { count: accepted.length, dropped });
}
</script>
<template>
  <aside class="side-panel">
    <ElTabs v-model="activeTab" stretch>
      <ElTabPane name="source" :label="t('chrome.tabSource')"><SourceInfo /></ElTabPane>
      <ElTabPane name="cuts" :label="t('chrome.tabCuts')"><MarkerList v-if="activeTab === 'cuts'" /></ElTabPane>
      <ElTabPane name="detect" :label="t('chrome.bandDetect')"><DetectionPanel v-if="activeTab === 'detect'" /></ElTabPane>
      <ElTabPane name="output" :label="t('chrome.tabOutput')"><OutputPanel v-if="activeTab === 'output'" /></ElTabPane>
      <ElTabPane name="bmhelper" :label="t('chrome.tabBmhelper')"><BMHelperPanel v-if="activeTab === 'bmhelper'" :bpm="bpm" @apply-cuts="applyCuts" /></ElTabPane>
    </ElTabs>
  </aside>
</template>
<style scoped>
.side-panel { min-width: 0; min-height: 0; overflow: auto; border-left: 1px solid var(--el-border-color); }
.side-panel > .el-tabs { height: 100%; }
:deep(.el-tabs__content) { padding: 10px; overflow: auto; }
:deep(.el-tabs__header) { margin-bottom: 0; }
:deep(.el-tabs__item) { padding: 0 10px; font-size: 12px; }
</style>
