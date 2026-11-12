<script setup lang="ts">
import { ElButton, ElDescriptions, ElDescriptionsItem, ElDialog, ElTag } from 'element-plus';
import { useI18n } from 'vue-i18n';
import type { BuildIdentity } from '../../platform/contracts';
defineProps<{ modelValue: boolean; identity: BuildIdentity | null }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
// Build identity comes from the parent; closing flows through update:modelValue.
const { t } = useI18n();
</script>
<template>
  <ElDialog
    :model-value="modelValue"
    :title="t('menu.about')"
    width="min(560px, 95vw)"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- build identity: name/version, dirty tag, commit and build time -->
    <template v-if="identity">
      <h2>{{ identity.name }} <small>v{{ identity.version }}</small></h2>
      <ElTag
        v-if="identity.dirty"
        type="warning"
        >{{ t('chrome.aboutDirtyLabel') }}</ElTag
      >
      <ElDescriptions
        :column="1"
        border
        class="build-details"
      >
        <ElDescriptionsItem :label="t('chrome.aboutCommitLabel')"
          ><code>{{ identity.commit }}</code></ElDescriptionsItem
        >
        <ElDescriptionsItem :label="t('chrome.aboutDateLabel')">{{
          identity.builtAt
        }}</ElDescriptionsItem>
      </ElDescriptions>
    </template>
    <!-- footer close button -->
    <template #footer
      ><ElButton @click="emit('update:modelValue', false)">{{
        t('chrome.close')
      }}</ElButton></template
    >
  </ElDialog>
</template>
<style scoped>
/* Spacing between the heading and the details table. */
.build-details {
  margin-top: 16px;
}

/* Long commit hashes wrap instead of overflowing the dialog. */
code {
  overflow-wrap: anywhere;
}

/* Tightened heading; the version suffix stays unbolded. */
h2 {
  margin-top: 0;
}
small {
  font-weight: normal;
}
</style>
