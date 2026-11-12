<script setup lang="ts">
import { ElOption, ElSegmented, ElSelect } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { LANGUAGES, LANGUAGE_LABELS } from '../../core/language';
import { useUiPreferencesStore } from '../../ui/preferences';
const preferences = useUiPreferencesStore();
const { t } = useI18n();
</script>
<template>
  <div class="preferences-controls">
    <ElSelect :model-value="preferences.language" :aria-label="t('chrome.titleLanguage')" size="small" @update:model-value="preferences.setLanguage">
      <ElOption value="auto" :label="t('chrome.languageAuto')" />
      <ElOption v-for="language in LANGUAGES" :key="language" :value="language" :label="LANGUAGE_LABELS[language]" />
    </ElSelect>
    <ElSegmented :model-value="preferences.theme" :aria-label="t('chrome.titleTheme')" :options="[{ label: t('chrome.themeLight'), value: 'light' }, { label: t('chrome.themeDark'), value: 'dark' }]" size="small" @update:model-value="preferences.setTheme" />
  </div>
</template>
<style scoped>
.preferences-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.el-select { width: 126px; }
</style>
