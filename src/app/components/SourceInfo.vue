<script setup lang="ts">
import { computed } from 'vue';
import { ElButton, ElDescriptions, ElDescriptionsItem, ElEmpty } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { useEditorStore } from '../../slicing/editor-store';
import { useWorkspace } from '../../workspace/workspace';
import { activeMedia } from '../../workspace/project-media';
const editor = useEditorStore();
const workspace = useWorkspace();
// Resolved missing-media descriptor; null while a source is loaded.
const missing = computed(() => (editor.source ? null : activeMedia(editor.document)));
const { t } = useI18n();
const sourceFormat = computed(() => {
  const format = editor.source?.sourceFormat;
  if (!format) return '';
  switch (format.kind) {
    case 'pcm':
      return t('chrome.srcPcm', { bits: format.bits });
    case 'float':
      return t('chrome.srcFloat', { bits: format.bits });
    case 'vorbis':
      return 'Ogg Vorbis';
  }
});
// Length in seconds at fixed precision; "0" while no source is loaded.
const duration = computed(() =>
  editor.source ? (editor.source.length / editor.source.sampleRate).toFixed(3) : '0',
);
</script>
<template>
  <section
    :aria-label="t('chrome.tabSource')"
    class="source-info"
  >
    <!-- loaded source: file details table -->
    <ElDescriptions
      v-if="editor.source"
      :column="1"
      border
      size="small"
    >
      <ElDescriptionsItem :label="t('chrome.fileLabel')"
        ><span class="source-name">{{ editor.source.name }}</span></ElDescriptionsItem
      >
      <ElDescriptionsItem :label="t('chrome.formatLabel')"
        >{{ editor.source.sampleRate }} Hz ·
        {{
          t('chrome.srcFormat', { format: sourceFormat, channels: editor.source.channels })
        }}</ElDescriptionsItem
      >
      <ElDescriptionsItem :label="t('chrome.processingFormatLabel')">PCM 16-bit</ElDescriptionsItem>
      <ElDescriptionsItem :label="t('chrome.lengthLabel')">{{
        t('chrome.framesCount', { count: editor.source.length.toLocaleString() })
      }}</ElDescriptionsItem>
      <ElDescriptionsItem :label="t('chrome.durationLabel')">{{ duration }} s</ElDescriptionsItem>
    </ElDescriptions>
    <!-- missing media: relink entry -->
    <ElEmpty
      v-else-if="missing"
      :description="t('chrome.mediaMissing', { name: missing.name })"
      :image-size="64"
    >
      <ElButton
        type="primary"
        @click="workspace.relinkAudio"
        >{{ t('menu.relinkAudio') }}</ElButton
      >
    </ElEmpty>
    <!-- no media yet: drop-or-open hint -->
    <ElEmpty
      v-else
      :description="t('chrome.hintDropOrOpen')"
      :image-size="64"
    />
  </section>
</template>
<style scoped>
/* File names wrap instead of stretching the descriptions table. */
.source-name {
  overflow-wrap: anywhere;
}
</style>
