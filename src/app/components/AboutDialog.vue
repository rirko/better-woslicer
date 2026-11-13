<script setup lang="ts">
import {
  ElAlert,
  ElButton,
  ElDescriptions,
  ElDescriptionsItem,
  ElDialog,
  ElTag,
} from 'element-plus';
import { shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BuildIdentity } from '../../platform/contracts';
import { getPlatform } from '../../platform';
import { creditLinks, type AboutLink } from '../../platform/about-links';
import { openTauriAboutLink } from '../../platform/tauri';
defineProps<{ modelValue: boolean; identity: BuildIdentity | null }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
// Build identity comes from the parent; closing flows through update:modelValue.
const { t } = useI18n();
const linkError = shallowRef(false);
function openLink(event: MouseEvent, link: AboutLink): void {
  if (getPlatform().kind !== 'tauri') return;
  event.preventDefault();
  linkError.value = false;
  void openTauriAboutLink(link).catch(() => {
    linkError.value = true;
  });
}
</script>
<template>
  <ElDialog
    :model-value="modelValue"
    :title="t('menu.about')"
    width="min(560px, 95vw)"
    class="about-dialog"
    top="24px"
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
      <p>
        <a
          v-if="identity.repositoryUrl"
          :href="identity.repositoryUrl"
          target="_blank"
          rel="noopener noreferrer"
          @click="openLink($event, 'project')"
          >{{ t('chrome.aboutProjectLink') }}</a
        >
        <span v-else>{{ t('chrome.aboutProjectUnavailable') }}</span>
      </p>
    </template>
    <h3>{{ t('chrome.aboutCredits') }}</h3>
    <ul class="credits">
      <li>
        <a
          :href="creditLinks.woslicer"
          target="_blank"
          rel="noopener noreferrer"
          @click="openLink($event, 'woslicer')"
          >woslicer II/III — wosderge</a
        ><br />{{ t('chrome.aboutWoslicerCredit') }}
      </li>
      <li>
        <a
          :href="creditLinks.bmhelper"
          target="_blank"
          rel="noopener noreferrer"
          @click="openLink($event, 'bmhelper')"
          >Be-Music Helper — exclusion</a
        ><br />{{ t('chrome.aboutBmhelperCredit') }}
      </li>
      <li>
        <a
          :href="creditLinks.audacity"
          target="_blank"
          rel="noopener noreferrer"
          @click="openLink($event, 'audacity')"
          >Audacity</a
        ><br />{{ t('chrome.aboutAudacityCredit') }}
      </li>
    </ul>
    <p class="link-note">{{ t('chrome.aboutExternalLinks') }}</p>
    <ElAlert
      v-if="linkError"
      :title="t('chrome.aboutLinkFailed')"
      type="error"
      :closable="false"
    />
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
.credits {
  padding-left: 20px;
}
.credits li + li {
  margin-top: 12px;
}
a {
  color: var(--el-color-primary);
  text-decoration: underline;
}
.link-note {
  color: var(--el-text-color-secondary);
}
</style>

<style>
.about-dialog {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 48px);
}
.about-dialog .el-dialog__body {
  min-height: 0;
  overflow-y: auto;
}
</style>
