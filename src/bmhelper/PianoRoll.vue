<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { MidiNoteEvent } from '../core/smf';
import { useUiPreferencesStore } from '../ui/preferences';
import { paletteFor } from '../ui/palette';
const props = defineProps<{ notes: readonly MidiNoteEvent[]; quantize: number }>();
const canvas = ref<HTMLCanvasElement | null>(null);
const preferences = useUiPreferencesStore();
let observer: ResizeObserver | undefined;
let firstBeat = 0;
let pxPerBeat = 24;
function draw(): void {
  const element = canvas.value;
  const context = element?.getContext('2d');
  if (!element || !context) return;
  const width = element.clientWidth;
  const height = element.clientHeight;
  if (!width || !height) return;
  const dpr = window.devicePixelRatio || 1;
  element.width = Math.max(1, Math.round(width * dpr));
  element.height = Math.max(1, Math.round(height * dpr));
  context.setTransform(element.width / width, 0, 0, element.height / height, 0, 0);
  const palette = paletteFor(preferences.theme);
  context.fillStyle = palette.app;
  context.fillRect(0, 0, width, height);
  if (!props.notes.length || props.quantize <= 0) return;
  for (
    let sub = Math.floor(firstBeat * 4);
    sub <= Math.ceil((firstBeat + width / pxPerBeat) * 4);
    sub++
  ) {
    context.fillStyle =
      sub % 16 === 0 ? palette.surface3 : sub % 4 === 0 ? palette.surface2 : palette.surface1;
    context.fillRect((sub / 4 - firstBeat) * pxPerBeat, 0, 1, height);
  }
  let low = 127;
  let high = 0;
  for (const note of props.notes) {
    low = Math.min(low, note.nn);
    high = Math.max(high, note.nn);
  }
  low -= 2;
  const span = Math.max(12, high + 2 - low);
  const barHeight = Math.max(2, height / span - 1);
  for (const note of props.notes) {
    const x = (note.position / props.quantize - firstBeat) * pxPerBeat;
    const w = Math.max(2, (note.gate / props.quantize) * pxPerBeat);
    if (x + w < 0 || x > width) continue;
    context.fillStyle = palette.waveBright;
    context.globalAlpha = 0.35 + (Math.min(127, Math.max(0, note.vel)) / 127) * 0.65;
    context.fillRect(x, height - ((note.nn - low + 1) / span) * height - barHeight, w, barHeight);
  }
  context.globalAlpha = 1;
}
function wheel(event: WheelEvent): void {
  if (event.ctrlKey)
    pxPerBeat = Math.max(4, Math.min(256, pxPerBeat * (event.deltaY < 0 ? 1.25 : 0.8)));
  else firstBeat = Math.max(0, firstBeat + (event.deltaY + event.deltaX) / pxPerBeat);
  draw();
}
watch(() => [props.notes, props.quantize, preferences.theme], draw, { deep: true, flush: 'post' });
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(draw);
    if (canvas.value) observer.observe(canvas.value);
  }
  window.addEventListener('resize', draw);
  draw();
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener('resize', draw);
});
</script>
<template>
  <canvas
    ref="canvas"
    class="piano-roll"
    tabindex="0"
    aria-label="MIDI piano roll"
    @wheel.prevent="wheel"
  />
</template>
<style scoped>
.piano-roll {
  width: 100%;
  height: 220px;
  display: block;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
}
</style>
