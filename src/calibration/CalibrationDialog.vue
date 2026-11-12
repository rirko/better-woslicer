<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElAlert, ElButton, ElDialog } from 'element-plus';
import type { CalibrationResult } from '../core/calibration';
import { TapCalibrator } from './TapCalibrator';

const props = defineProps<{
  modelValue: boolean;
  audioContext: AudioContext | null;
  offsetMs: number;
  bpm: number;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; apply: [offsetMs: number] }>();
const { t } = useI18n();
// Calibration session state: running flag, async-start guard, live result,
// elapsed beats and the last failure message.
const active = ref(false);
const starting = ref(false);
const result = shallowRef<CalibrationResult | null>(null);
const elapsed = ref(0);
const error = ref('');
// The calibrator instance, its 50 ms polling timer, and a generation token that
// invalidates in-flight async starts after any stop.
let calibrator: TapCalibrator | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let generation = 0;
// Localized progress summary; distinguishes unmatched taps from live/final results.
const summary = computed(() => {
  const value = result.value;
  if (!value) return '';
  if (!value.matched) return t('chrome.noTapsMatched', { total: value.total });
  return t(active.value ? 'chrome.tapsLive' : 'chrome.tapsFinal', {
    matched: value.matched,
    total: value.total,
    median: value.medianMs.toFixed(1),
    mean: value.meanMs.toFixed(1),
    spread: value.stdMs.toFixed(1),
  });
});
// Stop everything: bump the generation so a stale start() aborts itself,
// clear the polling timer and the calibrator, and reset the active/starting flags.
function stop(): void {
  generation++;
  starting.value = false;
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
  calibrator?.cancel();
  calibrator = null;
  active.value = false;
}
// Poll step: keeps audio scheduling alive and refreshes the displayed result.
function update(): void {
  if (!calibrator) return;
  calibrator.ensureScheduled();
  result.value = calibrator.currentResult();
  elapsed.value = calibrator.elapsedBeats();
}
// Start a fresh calibration: resume audio, create the calibrator, begin polling.
// A stop in between (generation mismatch or dialog closed) makes the attempt abort quietly.
async function start(): Promise<void> {
  stop();
  result.value = null;
  elapsed.value = 0;
  error.value = '';
  const context = props.audioContext;
  if (!context || !props.modelValue) return;
  const token = generation;
  starting.value = true;
  try {
    if (context.state === 'suspended') await context.resume();
    if (token !== generation || !props.modelValue) return;
    calibrator = new TapCalibrator(context);
    calibrator.start(props.bpm);
    active.value = true;
    update();
    timer = setInterval(update, 50);
  } catch (cause: unknown) {
    if (token === generation) {
      stop();
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  } finally {
    if (token === generation) starting.value = false;
  }
}
// Finish freezes the final result, then runs the same stop path.
function finish(): void {
  if (calibrator) result.value = calibrator.finish();
  stop();
}
// Closing the dialog also stops any active calibration.
function close(): void {
  stop();
  emit('update:modelValue', false);
}
// Apply forwards the rounded median offset to the parent, then closes.
function apply(): void {
  if (!result.value?.matched) return;
  emit('apply', Math.round(result.value.medianMs));
  close();
}
// Capture-phase window handler so calibration keys win over app shortcuts.
function keydown(event: KeyboardEvent): void {
  if (!props.modelValue) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
    return;
  }
  if (!['Enter', ',', '.'].includes(event.key)) return;
  // The modal owns tap keys even after Finish: never leak a timeline marker.
  event.preventDefault();
  event.stopImmediatePropagation();
  if (
    event.repeat ||
    event.isComposing ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    !active.value
  )
    return;
  calibrator?.tap();
  update();
}
// Dialog visibility drives the window key listener and the calibration lifecycle.
watch(
  () => [props.modelValue, props.audioContext] as const,
  ([open]) => {
    window.removeEventListener('keydown', keydown, true);
    if (open) {
      window.addEventListener('keydown', keydown, true);
      void start();
    } else stop();
  },
  { immediate: true },
);
// Unmount removes the key listener and stops calibration and polling.
onBeforeUnmount(() => {
  window.removeEventListener('keydown', keydown, true);
  stop();
});
</script>
<template>
  <ElDialog
    :model-value="modelValue"
    :title="t('chrome.calibrationTitle')"
    width="min(620px, 95vw)"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    append-to-body
    destroy-on-close
    @update:model-value="close"
  >
    <!-- instructions, current offset and live tap progress -->
    <p>{{ t('chrome.calibrationHintPrefix') }} {{ bpm }} {{ t('chrome.calibrationHintBody') }}</p>
    <p>{{ t('chrome.offsetDisplay', { ms: offsetMs }) }}</p>
    <p>{{ t('chrome.beat') }} {{ elapsed }} · {{ t('chrome.taps') }} {{ result?.total ?? 0 }}</p>
    <p
      role="status"
      aria-live="polite"
    >
      {{ summary }}
    </p>
    <!-- warnings: missing audio context, failed start -->
    <ElAlert
      v-if="!audioContext"
      :title="t('status.calibrationNeedsSource')"
      type="warning"
      :closable="false"
    />
    <ElAlert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
    />
    <!-- footer actions: restart, finish, apply, close -->
    <template #footer>
      <ElButton
        :disabled="!audioContext || starting"
        @click="start"
        >{{ t('chrome.restart') }}</ElButton
      >
      <ElButton
        :disabled="!active"
        @click="finish"
        >{{ t('chrome.finish') }}</ElButton
      >
      <ElButton
        :disabled="!result?.matched"
        type="primary"
        @click="apply"
        >{{ t('chrome.apply') }}</ElButton
      >
      <ElButton @click="close">{{ t('chrome.close') }}</ElButton>
    </template>
  </ElDialog>
</template>
