<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue';
import { useDevicePixelRatio, useResizeObserver } from '@vueuse/core';
import { ElSlider } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { useEditorStore } from '../slicing/editor-store';
import { usePlayback } from '../playback';
import { useUiPreferencesStore } from '../ui/preferences';
import { paletteFor } from '../ui/palette';
import { MAX_TICKS, tickToSampleExport } from '../core/timebase';
import { createTimelineGestures, type TimelinePointer } from './gestures';
import { drawOverview, drawOverlay, drawRuler, drawTimeline, OVERVIEW_HEIGHT, RULER_HEIGHT, setupCanvas } from './render';
import { sampleToTick } from './waveform';

const editor = useEditorStore();
const playback = usePlayback();
const preferences = useUiPreferencesStore();
const { t } = useI18n();
const palette = computed(() => paletteFor(preferences.theme));
const viewport = useTemplateRef<HTMLElement>('viewport');
const ruler = useTemplateRef<HTMLCanvasElement>('ruler');
const wave = useTemplateRef<HTMLCanvasElement>('wave');
const overlay = useTemplateRef<HTMLCanvasElement>('overlay');
const overview = useTemplateRef<HTMLCanvasElement>('overview');
const { pixelRatio } = useDevicePixelRatio();
const dimensions = shallowRef({ width: 0, height: 0 });
const gestures = createTimelineGestures(editor);
const { ghost, cursor } = gestures;
let frame = 0, fullDraw = false, activePointer: number | null = null;
let overviewPointer: number | null = null;
const scrollMaximum = computed(() => Math.max(0, MAX_TICKS - dimensions.value.width / editor.pxPerTick));
function invalidate(all = true): void {
  fullDraw ||= all;
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const size = { ...dimensions.value, dpr: pixelRatio.value || 1 };
    if (size.width <= 0 || size.height <= 0) { fullDraw = false; return; }
    if (fullDraw) {
      if (wave.value) { const context = setupCanvas(wave.value, size); if (context) drawTimeline(context, editor, size, palette.value); }
      if (ruler.value) { const context = setupCanvas(ruler.value, { ...size, height: RULER_HEIGHT }); if (context) drawRuler(context, editor, size.width, palette.value); }
      if (overview.value) { const context = setupCanvas(overview.value, { ...size, height: OVERVIEW_HEIGHT }); if (context) drawOverview(context, editor, size.width, palette.value); }
    }
    if (overlay.value) { const context = setupCanvas(overlay.value, size); if (context) drawOverlay(context, editor, size, palette.value, ghost.value); }
    fullDraw = false;
  });
}
function measure(): void {
  if (viewport.value) dimensions.value = { width: viewport.value.clientWidth, height: viewport.value.clientHeight };
}
useResizeObserver(viewport, measure);
onMounted(measure);
watch([dimensions, pixelRatio, palette, () => editor.docRevision, () => editor.previewTicks, () => editor.source, () => editor.peaks, () => editor.grid, () => editor.pxPerTick, () => editor.scrollTick, () => editor.selectedTicks, () => editor.selectionStartTick, () => editor.selectionEndTick, () => editor.rmsVisible, () => editor.bandsVisible, () => editor.bandAnalysis], () => invalidate());
watch([() => editor.playheadSample, () => editor.cursorTick, ghost], () => invalidate(false));
watch([() => editor.playheadSample, () => editor.followPlayhead], () => {
  if (!editor.playing || !editor.followPlayhead || !editor.source || dimensions.value.width <= 0) return;
  const tick = sampleToTick(editor.playheadSample, { bpm: editor.doc.bpm, shift: editor.doc.shift, sampleRate: editor.source.sampleRate });
  const span = dimensions.value.width / editor.pxPerTick;
  if (tick < editor.scrollTick || tick > editor.scrollTick + span * .95) editor.setScrollTick(Math.max(0, tick - span * .1));
});
function point(event: PointerEvent): TimelinePointer {
  const rect = viewport.value?.getBoundingClientRect();
  return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0), button: event.button, altKey: event.altKey, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey || event.metaKey };
}
function pointerDown(event: PointerEvent): void {
  if (activePointer !== null || event.button > 2) return;
  event.preventDefault(); viewport.value?.focus();
  activePointer = event.pointerId; viewport.value?.setPointerCapture(event.pointerId);
  gestures.begin(point(event));
}
function pointerMove(event: PointerEvent): void {
  if (activePointer !== null && event.pointerId !== activePointer) return;
  gestures.move(point(event));
}
function pointerUp(event: PointerEvent): void {
  if (event.pointerId !== activePointer) return;
  gestures.end(point(event)); activePointer = null;
  if (viewport.value?.hasPointerCapture(event.pointerId)) viewport.value.releasePointerCapture(event.pointerId);
}
function cancelGesture(): void { gestures.cancel(); activePointer = null; }
function keydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && gestures.cancel()) { activePointer = null; event.preventDefault(); event.stopPropagation(); }
}
function wheel(event: WheelEvent, rulerZoom = false): void {
  event.preventDefault();
  const rect = viewport.value?.getBoundingClientRect();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? dimensions.value.width : 1;
  gestures.wheel(event.clientX - (rect?.left ?? 0), event.deltaX * unit, event.deltaY * unit, rulerZoom || event.ctrlKey || event.metaKey);
}
function seek(event: PointerEvent): void {
  if (event.button !== 0) return;
  const rect = ruler.value?.getBoundingClientRect();
  const tick = editor.snapTick(editor.scrollTick + (event.clientX - (rect?.left ?? 0)) / editor.pxPerTick);
  editor.setCursorTick(tick);
  if (editor.source) playback.seekSample(tickToSampleExport(editor.cursorTick, { bpm: editor.doc.bpm, shift: editor.doc.shift, sampleRate: editor.source.sampleRate }));
}
function overviewSeek(event: PointerEvent): void {
  const element = overview.value;
  if (!element || element.clientWidth <= 0) return;
  const ratio = (event.clientX - element.getBoundingClientRect().left) / element.clientWidth;
  editor.setScrollTick(Math.max(0, Math.min(scrollMaximum.value, ratio * MAX_TICKS - dimensions.value.width / editor.pxPerTick / 2)));
}
function overviewDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  overviewPointer = event.pointerId; overview.value?.setPointerCapture(event.pointerId); overviewSeek(event);
}
function scroll(value: number | number[]): void { if (typeof value === 'number') editor.setScrollTick(value); }
onBeforeUnmount(() => { cancelGesture(); gestures.dispose(); cancelAnimationFrame(frame); });
</script>

<template>
  <section class="timeline" :aria-label="t('chrome.tabCuts')">
    <canvas ref="ruler" class="timeline-ruler" @pointerdown="seek" @wheel="wheel($event, true)" />
    <div ref="viewport" class="timeline-viewport" tabindex="0" :style="{ cursor }" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="cancelGesture" @lostpointercapture="cancelGesture" @contextmenu.prevent @wheel="wheel($event)" @keydown="keydown">
      <canvas ref="wave" class="timeline-canvas" />
      <canvas ref="overlay" class="timeline-canvas timeline-overlay" />
      <div v-if="!editor.source" class="timeline-empty">{{ t('chrome.emptySub') }}</div>
    </div>
    <canvas ref="overview" class="timeline-overview" @pointerdown="overviewDown" @pointermove="overviewPointer === $event.pointerId && overviewSeek($event)" @pointerup="overviewPointer = null" @pointercancel="overviewPointer = null" @lostpointercapture="overviewPointer = null" />
    <ElSlider class="timeline-scroll" :model-value="Math.min(editor.scrollTick, scrollMaximum)" :max="scrollMaximum || 1" :disabled="scrollMaximum === 0" :show-tooltip="false" :aria-label="t('chrome.tabCuts')" @update:model-value="scroll" />
  </section>
</template>

<style scoped>
.timeline { min-width: 0; min-height: 160px; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.timeline-ruler { flex: 0 0 28px; cursor: pointer; }
.timeline-viewport { position: relative; flex: 1; min-height: 80px; min-width: 0; overflow: hidden; touch-action: none; outline-offset: -2px; }
.timeline-canvas { position: absolute; inset: 0; pointer-events: none; }
.timeline-overlay { z-index: 1; }
.timeline-empty { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; color: var(--el-text-color-secondary); font-size: 13px; }
.timeline-overview { flex: 0 0 36px; cursor: pointer; touch-action: none; }
.timeline-scroll { flex: 0 0 20px; width: calc(100% - 16px); margin: 0 8px; }
</style>
