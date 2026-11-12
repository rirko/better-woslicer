<script setup lang="ts">
import { computed } from 'vue';
import { ElButton, ElDropdown, ElDropdownItem, ElDropdownMenu } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { useEditorStore } from '../../slicing/editor-store';
import { createApplicationMenu } from '../menu';
import { isMenuCommand, type MenuCommand } from '../command-types';

const emit = defineEmits<{ command: [command: MenuCommand] }>();
const { t } = useI18n();
const editor = useEditorStore();
const groups = computed(() => createApplicationMenu(editor));
function dispatch(value: unknown): void {
  if (
    isMenuCommand(value) &&
    groups.value.some((group) => group.commands.some((item) => item.id === value))
  )
    emit('command', value);
}
</script>
<template>
  <nav
    class="application-menu"
    :aria-label="t('menu.application')"
    role="menubar"
  >
    <ElDropdown
      v-for="group in groups"
      :key="group.label"
      trigger="click"
      :show-timeout="0"
      :hide-timeout="100"
      @command="dispatch"
    >
      <ElButton
        text
        role="menuitem"
        >{{ t(group.label) }}</ElButton
      >
      <template #dropdown>
        <ElDropdownMenu>
          <ElDropdownItem
            v-for="item in group.commands"
            :key="item.id"
            :command="item.id"
            :disabled="!item.enabled()"
            >{{ t(item.key) }}</ElDropdownItem
          >
        </ElDropdownMenu>
      </template>
    </ElDropdown>
  </nav>
</template>
<style scoped>
.application-menu {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 32px;
  padding: 0 8px;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.application-menu :deep(.el-button) {
  margin: 0;
  padding: 5px 10px;
  color: var(--el-text-color-primary);
}
</style>
