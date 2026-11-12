<script setup lang="ts">
import { computed, shallowRef, watch, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { tickToSampleExport } from '../core/timebase';
import { useWorkspace } from '../workspace/workspace';
const { t } = useI18n();
const workspace = useWorkspace();
const editor = workspace.editor;
const viewport = useTemplateRef<HTMLDivElement>('viewport');
const offset = shallowRef(0);
const rowHeight = 32;
const first = computed(() => Math.max(0, Math.floor(offset.value / rowHeight) - 3));
const rows = computed(() => editor.ticks.slice(first.value, first.value + 22));
const selected = computed(() => new Set(editor.selectedTicks));
function scroll(event: Event): void { if (event.currentTarget instanceof HTMLElement) offset.value = event.currentTarget.scrollTop; }
function choose(tick: number, event: MouseEvent): void {
  editor.setCursorTick(tick);
  editor.setSelectedTicks(event.ctrlKey || event.metaKey ? selected.value.has(tick) ? editor.selectedTicks.filter(t => t !== tick) : [...editor.selectedTicks, tick] : [tick]);
  editor.setScrollTick(Math.max(0, tick - 24));
  if (editor.source && !editor.playing) editor.setPlayheadSample(tickToSampleExport(tick, { bpm: editor.doc.bpm, shift: editor.doc.shift, sampleRate: editor.source.sampleRate }));
}
watch(() => editor.ticks.length, count => { if (offset.value > count * rowHeight) { offset.value = 0; if (viewport.value) viewport.value.scrollTop = 0; } });
</script>

<template>
  <section class="marker-list" :aria-label="t('chrome.tabCuts')" data-testid="marker-list">
    <div class="marker-actions">
      <el-button size="small" :disabled="!editor.selectedTicks.length" @click="workspace.actions.quantizeSelection()">{{ t('chrome.quantize') }}</el-button>
      <el-button size="small" :disabled="!editor.ticks.length" @click="workspace.actions.clearMarkers()">{{ t('chrome.clearMarkers') }}</el-button>
    </div>
    <div ref="viewport" class="marker-viewport" @scroll="scroll">
      <div class="marker-spacer" :style="{ height: `${editor.ticks.length * rowHeight}px` }">
        <div class="marker-window" :style="{ transform: `translateY(${first * rowHeight}px)` }">
          <el-button v-for="tick in rows" :key="tick" class="marker-row" :class="{ selected: selected.has(tick) }" :aria-pressed="selected.has(tick)" @click="choose(tick, $event)">
            {{ t('chrome.readoutTick', { measure: Math.floor(tick / 192) + 1, tick }) }}
          </el-button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.marker-list { padding: 12px; }
.marker-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.marker-actions :deep(.el-button) { margin: 0; }
.marker-viewport { height: 384px; max-height: 40vh; overflow-y: auto; overflow-x: hidden; }
.marker-spacer { position: relative; }
.marker-window { position: absolute; inset: 0 0 auto; }
.marker-row { display: flex; width: 100%; height: 32px; margin: 0; border-radius: 0; justify-content: flex-start; font-variant-numeric: tabular-nums; }
.marker-row.selected { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
</style>
