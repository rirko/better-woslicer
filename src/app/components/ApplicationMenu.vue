<script setup lang="ts">
import { ElButton, ElDropdown, ElDropdownItem, ElDropdownMenu } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { useEditorStore } from '../../slicing/editor-store';
import { APPLICATION_MENU, isMenuCommand, menuCommandEnabled, type MenuCommand } from '../menu';

const emit = defineEmits<{ command: [command: MenuCommand] }>();
const { t } = useI18n();
const editor = useEditorStore();
function dispatch(value: unknown): void {
  if (isMenuCommand(value)) emit('command', value);
}
</script>
<template>
  <!-- menu bar: one dropdown trigger per command group -->
  <nav
    class="application-menu"
    :aria-label="t('menu.application')"
    role="menubar"
  >
    <ElDropdown
      v-for="group in APPLICATION_MENU"
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
            :disabled="!menuCommandEnabled(item.id, editor)"
            >{{ t(item.key) }}</ElDropdownItem
          >
        </ElDropdownMenu>
      </template>
    </ElDropdown>
  </nav>
</template>
<style scoped>
/* Menu bar strip: dropdown triggers laid out horizontally. */
.application-menu {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 32px;
  padding: 0 8px;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}

/* Element Plus button override: remove default margin/padding inside the bar. */
.application-menu :deep(.el-button) {
  margin: 0;
  padding: 5px 10px;
  color: var(--el-text-color-primary);
}
</style>
