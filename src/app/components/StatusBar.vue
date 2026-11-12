<script setup lang="ts">
import { computed } from 'vue';
import { ElButton } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { MEASURE_TICKS } from '../../core/timebase';
import type { BuildIdentity } from '../../platform/contracts';
import { useEditorStore } from '../../slicing/editor-store';
defineProps<{ identity: BuildIdentity | null }>();
const emit = defineEmits<{ about: [] }>();
const editor = useEditorStore();
const { t } = useI18n();
const status = computed(() =>
  editor.status.segments
    .map((segment) => t(`status.${segment.key}`, segment.params ?? {}))
    .join(' · '),
);
</script>
<template>
  <footer
    class="statusbar"
    :class="{ 'status-error': editor.isError }"
  >
    <span
      class="status-message"
      role="status"
      aria-live="polite"
      :title="status"
      >{{ status }}</span
    >
    <span>{{
      t('chrome.readoutTick', {
        measure: Math.floor(editor.cursorTick / MEASURE_TICKS) + 1,
        tick: editor.cursorTick,
      })
    }}</span>
    <span>{{ t('chrome.tabCuts') }}: {{ editor.ticks.length }}</span>
    <ElButton
      v-if="identity"
      link
      size="small"
      :title="t('menu.about')"
      @click="emit('about')"
      >v{{ identity.version }}{{ identity.dirty ? '*' : '' }}</ElButton
    >
  </footer>
</template>
<style scoped>
.statusbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 16px;
  min-height: 28px;
  padding: 5px 10px;
  border-top: 1px solid var(--el-border-color);
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.status-message {
  flex: 1 1 300px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.status-error .status-message {
  color: var(--el-color-danger);
}
</style>
