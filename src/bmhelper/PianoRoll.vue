<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { MidiNoteEvent } from '../core/smf';
import { useUiPreferencesStore } from '../ui/preferences';
import { paletteFor } from '../ui/palette';
// Canvas preview of the selected division's recording; redraws on resize and edits.
const props = defineProps<{ notes: readonly MidiNoteEvent[]; quantize: number }>();
const canvas = ref<HTMLCanvasElement | null>(null);
const preferences = useUiPreferencesStore();
// View state: firstBeat is the left edge in beats, pxPerBeat the horizontal zoom.
let observer: ResizeObserver | undefined;
let firstBeat = 0;
let pxPerBeat = 24;
// Full repaint: size the backing store to device pixels, fill the app background,
// draw one grid line per quarter beat (heavier each beat, heaviest each measure),
// then one bar per note with alpha following velocity.
function draw(): void {
  const element = canvas.value;
  const context = element?.getContext('2d');
  if (!element || !context) return;
  const width = element.clientWidth;
  const height = element.clientHeight;
  if (!width || !height) return;
  // Backing store sized to device pixels; the transform keeps CSS-pixel coordinates.
  const dpr = window.devicePixelRatio || 1;
  element.width = Math.max(1, Math.round(width * dpr));
  element.height = Math.max(1, Math.round(height * dpr));
  context.setTransform(element.width / width, 0, 0, element.height / height, 0, 0);
  const palette = paletteFor(preferences.theme);
  context.fillStyle = palette.app;
  context.fillRect(0, 0, width, height);
  if (!props.notes.length || props.quantize <= 0) return;
  // Quarter-beat grid lines across the visible beat window.
  for (
    let sub = Math.floor(firstBeat * 4);
    sub <= Math.ceil((firstBeat + width / pxPerBeat) * 4);
    sub++
  ) {
    context.fillStyle =
      sub % 16 === 0 ? palette.surface3 : sub % 4 === 0 ? palette.surface2 : palette.surface1;
    context.fillRect((sub / 4 - firstBeat) * pxPerBeat, 0, 1, height);
  }
  // Vertical note range: pad two semitones, at least 12 semitones tall.
  let low = 127;
  let high = 0;
  for (const note of props.notes) {
    low = Math.min(low, note.nn);
    high = Math.max(high, note.nn);
  }
  low -= 2;
  const span = Math.max(12, high + 2 - low);
  const barHeight = Math.max(2, height / span - 1);
  // One bar per note; notes scrolled out of the window are skipped.
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
// Ctrl+wheel zooms (4..256 px per beat); plain wheel pans the window in beats.
function wheel(event: WheelEvent): void {
  if (event.ctrlKey)
    pxPerBeat = Math.max(4, Math.min(256, pxPerBeat * (event.deltaY < 0 ? 1.25 : 0.8)));
  else firstBeat = Math.max(0, firstBeat + (event.deltaY + event.deltaX) / pxPerBeat);
  draw();
}
// Redraw after DOM updates when notes, quantize or theme change.
watch(() => [props.notes, props.quantize, preferences.theme], draw, { deep: true, flush: 'post' });
// Resize handling: an observer on the canvas plus window resizes, with an initial draw.
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(draw);
    if (canvas.value) observer.observe(canvas.value);
  }
  window.addEventListener('resize', draw);
  draw();
});
// Drop the observer and the window listener on unmount.
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener('resize', draw);
});
</script>
<template>
  <!-- wheel pans, Ctrl+wheel zooms; redrawn on resize and data changes -->
  <canvas
    ref="canvas"
    class="piano-roll"
    tabindex="0"
    aria-label="MIDI piano roll"
    @wheel.prevent="wheel"
  />
</template>
<style scoped>
/* Fixed-height preview strip filling the panel width. */
.piano-roll {
  width: 100%;
  height: 220px;
  display: block;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
}
</style>
