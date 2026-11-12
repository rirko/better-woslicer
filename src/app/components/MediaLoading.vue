<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { LoadingActivity } from '../../workspace/workspace';

// A media-scoped row can also sit above an individual track in a multi-track layout.
defineProps<{ activity: LoadingActivity }>();
const { t } = useI18n();
</script>

<template>
  <section
    class="media-loading"
    role="status"
    aria-live="polite"
    aria-atomic="true"
    :data-media-id="activity.mediaId"
  >
    <span
      class="loading-spinner"
      aria-hidden="true"
    />
    <div class="loading-copy">
      <strong>{{ t(`loading.${activity.stage}`) }}</strong>
      <span
        v-if="activity.name"
        class="loading-name"
        :title="activity.name"
        >{{ activity.name }}</span
      >
      <span class="loading-hint">{{ t('loading.hint') }}</span>
    </div>
  </section>
</template>

<style scoped>
.media-loading {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-color-primary-light-5);
  border-inline-start: 4px solid var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--el-text-color-primary);
}
.loading-copy {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 3px 12px;
  min-width: 0;
}
.loading-name {
  overflow-wrap: anywhere;
}
.loading-hint {
  flex-basis: 100%;
  font-size: 12px;
  color: var(--el-text-color-regular);
}
.loading-spinner {
  flex: 0 0 20px;
  height: 20px;
  border: 3px solid var(--el-color-primary-light-7);
  border-top-color: var(--el-color-primary);
  border-radius: 50%;
  animation: loading-spin 0.9s linear infinite;
}
@keyframes loading-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .loading-spinner {
    animation: none;
  }
}
</style>
