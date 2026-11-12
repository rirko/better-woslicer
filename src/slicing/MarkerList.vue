<script setup lang="ts">
import { computed, shallowRef, watch, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { MEASURE_TICKS, tickToSampleExport } from '../core/timebase';
import { useWorkspace } from '../workspace/workspace';
const { t } = useI18n();
const workspace = useWorkspace();
const editor = workspace.editor;
// Virtual list: a window of rows is derived from the viewport scroll offset.
const viewport = useTemplateRef<HTMLDivElement>('viewport');
const offset = shallowRef(0);
const rowHeight = 32;
const first = computed(() => Math.max(0, Math.floor(offset.value / rowHeight) - 3));
const rows = computed(() => editor.ticks.slice(first.value, first.value + 22));
const selected = computed(() => new Set(editor.selectedTicks));
// Viewport scroll drives the rendered window.
function scroll(event: Event): void {
  if (event.currentTarget instanceof HTMLElement) offset.value = event.currentTarget.scrollTop;
}
// Click protocol: plain click replaces the selection; Ctrl/Meta toggles the clicked tick.
// Afterwards: cursor, scroll keep-alive, and playhead update only while playback is stopped.
function choose(tick: number, event: MouseEvent): void {
  editor.setCursorTick(tick);
  editor.setSelectedTicks(nextSelection(tick, event));
  editor.setScrollTick(Math.max(0, tick - 24));
  if (editor.source && !editor.playing)
    editor.setPlayheadSample(
      tickToSampleExport(tick, {
        bpm: editor.doc.bpm,
        shift: editor.doc.shift,
        sampleRate: editor.source.sampleRate,
      }),
    );
}
// Selection branch of the click protocol.
function nextSelection(tick: number, event: MouseEvent): number[] {
  if (!event.ctrlKey && !event.metaKey) return [tick];
  if (!selected.value.has(tick)) return [...editor.selectedTicks, tick];
  return editor.selectedTicks.filter((t) => t !== tick);
}
// Reset the scroll window when the tick list shrinks below the current offset.
watch(
  () => editor.ticks.length,
  (count) => {
    if (offset.value > count * rowHeight) {
      offset.value = 0;
      if (viewport.value) viewport.value.scrollTop = 0;
    }
  },
);
</script>

<template>
  <section
    class="marker-list"
    :aria-label="t('chrome.tabCuts')"
    data-testid="marker-list"
  >
    <!-- marker actions: quantize selection, clear all -->
    <div class="marker-actions">
      <el-button
        size="small"
        :disabled="!editor.selectedTicks.length"
        @click="workspace.actions.quantizeSelection()"
        >{{ t('chrome.quantize') }}</el-button
      >
      <el-button
        size="small"
        :disabled="!editor.ticks.length"
        @click="workspace.actions.clearMarkers()"
        >{{ t('chrome.clearMarkers') }}</el-button
      >
    </div>
    <!-- virtualized list: spacer keeps the scroll height, window offsets the visible rows -->
    <div
      ref="viewport"
      class="marker-viewport"
      @scroll="scroll"
    >
      <div
        class="marker-spacer"
        :style="{ height: `${editor.ticks.length * rowHeight}px` }"
      >
        <div
          class="marker-window"
          :style="{ transform: `translateY(${first * rowHeight}px)` }"
        >
          <el-button
            v-for="tick in rows"
            :key="tick"
            class="marker-row"
            :class="{ selected: selected.has(tick) }"
            :aria-pressed="selected.has(tick)"
            @click="choose(tick, $event)"
          >
            {{ t('chrome.readoutTick', { measure: Math.floor(tick / MEASURE_TICKS) + 1, tick }) }}
          </el-button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Panel padding and marker action buttons. */
.marker-list {
  padding: 12px;
}
.marker-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.marker-actions :deep(.el-button) {
  margin: 0;
}

/* Virtual scroll scaffold: fixed-height viewport, spacer, offset window. */
.marker-viewport {
  height: 384px;
  max-height: 40vh;
  overflow-y: auto;
  overflow-x: hidden;
}
.marker-spacer {
  position: relative;
}
.marker-window {
  position: absolute;
  inset: 0 0 auto;
}

/* Row buttons: full-width, square, tabular numerals; selected highlight. */
.marker-row {
  display: flex;
  width: 100%;
  height: 32px;
  margin: 0;
  border-radius: 0;
  justify-content: flex-start;
  font-variant-numeric: tabular-nums;
}
.marker-row.selected {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
</style>
