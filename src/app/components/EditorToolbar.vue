<script setup lang="ts">
import { ElButton } from 'element-plus';
import { useI18n } from 'vue-i18n';
import type { AppCommand } from '../command-types';
import { useEditorStore } from '../../slicing/editor-store';
import DocumentOptions from './DocumentOptions.vue';
import PreferencesControls from './PreferencesControls.vue';
const emit = defineEmits<{ command: [command: AppCommand]; calibrate: [] }>();
const props = defineProps<{ calibrating: boolean }>();
const editor = useEditorStore();
const { t } = useI18n();
</script>
<template>
  <header class="editor-toolbar">
    <!-- top row: file actions and preferences -->
    <div class="toolbar-top">
      <div class="file-actions">
        <ElButton @click="emit('command', 'open-project')">{{ t('menu.openProject') }}</ElButton>
        <!-- save button shows a star (aria-labelled below) while the project has unsaved changes -->
        <ElButton @click="emit('command', 'save-project')"
          >{{ t('menu.saveProject')
          }}<span
            v-if="editor.isDirty"
            :aria-label="t('chrome.projectUnsaved')"
          >
            *</span
          ></ElButton
        >
        <ElButton
          type="primary"
          :title="t('chrome.titleOpen')"
          @click="emit('command', 'open-audio')"
          >{{ t('chrome.open') }}</ElButton
        >
        <ElButton
          :title="t('chrome.titleClose')"
          @click="emit('command', 'close-project')"
          >{{ t('chrome.close') }}</ElButton
        >
        <ElButton
          :disabled="!editor.canUndo"
          :title="t('chrome.titleUndo')"
          @click="emit('command', 'undo')"
          >{{ t('chrome.undo') }}</ElButton
        >
        <ElButton
          :disabled="!editor.canRedo"
          :title="t('chrome.titleRedo')"
          @click="emit('command', 'redo')"
          >{{ t('chrome.redo') }}</ElButton
        >
        <ElButton @click="emit('command', 'import-wos')">{{ t('menu.importWos') }}</ElButton>
        <ElButton @click="emit('command', 'export-wos')">{{ t('menu.exportWos') }}</ElButton>
        <ElButton
          :disabled="!editor.source || props.calibrating"
          @click="emit('calibrate')"
          >{{ t('chrome.calibrate') }}</ElButton
        >
        <ElButton @click="emit('command', 'about')">{{ t('menu.about') }}</ElButton>
      </div>
      <PreferencesControls />
    </div>
    <!-- document options row -->
    <DocumentOptions />
  </header>
</template>
<style scoped>
/* Toolbar layout: options row below the top row. */
.editor-toolbar {
  display: grid;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
/* Top row: file actions on the left, preferences on the right. */
.toolbar-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
}
.file-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
/* Override Element Plus adjacent-button margin and default padding inside the actions row. */
.file-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.file-actions :deep(.el-button) {
  padding: 8px 10px;
}
</style>
